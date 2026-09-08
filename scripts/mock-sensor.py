#!/usr/bin/env python3
"""Publica leituras simuladas de temperatura/umidade nos dois brokers MQTT.

Tópico: sensors/<sensor-id>/telemetry
Payload: {"temperature": <float>, "humidity": <float>}
"""

import argparse
import json
import os
import random
import ssl
import sys
import time
from pathlib import Path

import paho.mqtt.client as mqtt

REPO_ROOT = Path(__file__).resolve().parent.parent
CERTS_DIR = REPO_ROOT / "infra" / "mosquitto" / "secure" / "certs"

TEMPERATURE_RANGE = (22.0, 26.0)
HUMIDITY_RANGE = (40.0, 60.0)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Sensor mock que publica telemetria nos brokers plain e secure."
    )
    parser.add_argument(
        "--sensor-id",
        default=os.environ.get("MOCK_SENSOR_ID", "sensor-mock-01"),
        help="Identificador do sensor usado no tópico (default: sensor-mock-01).",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=float(os.environ.get("MOCK_SENSOR_INTERVAL", "2")),
        help="Segundos entre publicações (default: 2).",
    )
    parser.add_argument(
        "--plain-host",
        default=os.environ.get("MQTT_PLAIN_HOST", "localhost"),
        help="Host do broker plain (default: localhost).",
    )
    parser.add_argument(
        "--plain-port",
        type=int,
        default=int(os.environ.get("MQTT_PLAIN_PORT", "1883")),
        help="Porta do broker plain (default: 1883).",
    )
    parser.add_argument(
        "--secure-host",
        default=os.environ.get("MQTT_SECURE_HOST", "localhost"),
        help="Host do broker secure (default: localhost).",
    )
    parser.add_argument(
        "--secure-port",
        type=int,
        default=int(os.environ.get("MQTT_SECURE_PORT", "8883")),
        help="Porta do broker secure (default: 8883).",
    )
    parser.add_argument(
        "--only",
        choices=("plain", "secure"),
        help="Publica em apenas um dos brokers.",
    )
    return parser.parse_args()


def connect_plain(host, port, sensor_id):
    client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id=f"{sensor_id}-plain",
    )
    client.connect(host, port, keepalive=30)
    client.loop_start()
    return client


def connect_secure(host, port, sensor_id):
    username = os.environ.get("MQTT_SECURE_USERNAME")
    password = os.environ.get("MQTT_SECURE_PASSWORD")
    missing = [
        name
        for name, value in (
            ("MQTT_SECURE_USERNAME", username),
            ("MQTT_SECURE_PASSWORD", password),
        )
        if not value
    ]
    if missing:
        raise RuntimeError(
            f"variável de ambiente faltando: {', '.join(missing)}"
        )

    for path in ("ca.crt", "client-test.crt", "client-test.key"):
        if not (CERTS_DIR / path).is_file():
            raise RuntimeError(
                f"certificado ausente: {CERTS_DIR / path} (rode ./scripts/gen-certs.sh)"
            )

    # O broker secure está fixado em `tls_version tlsv1.2`; PROTOCOL_TLS_CLIENT
    # negocia a versão e o piso 1.2 impede um downgrade, sem travar um teto que
    # inviabilizaria o handshake.
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_verify_locations(cafile=str(CERTS_DIR / "ca.crt"))
    context.load_cert_chain(
        certfile=str(CERTS_DIR / "client-test.crt"),
        keyfile=str(CERTS_DIR / "client-test.key"),
    )
    # O certificado do servidor é emitido para o hostname do container, não para
    # o "localhost" pelo qual o script alcança a porta publicada.
    context.check_hostname = False

    client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id=f"{sensor_id}-secure",
    )
    client.username_pw_set(username, password)
    client.tls_set_context(context)
    client.connect(host, port, keepalive=30)
    client.loop_start()
    return client


def next_reading(previous):
    temperature, humidity = previous
    temperature = min(
        TEMPERATURE_RANGE[1],
        max(TEMPERATURE_RANGE[0], temperature + random.gauss(0, 0.25)),
    )
    humidity = min(
        HUMIDITY_RANGE[1],
        max(HUMIDITY_RANGE[0], humidity + random.gauss(0, 0.8)),
    )
    return round(temperature, 2), round(humidity, 2)


def main():
    args = parse_args()

    # Um único sensor-id publicando nos dois brokers ao mesmo tempo é uma
    # conveniência de dev: dá pra comparar as duas trilhas de captura com dados
    # idênticos. Em produção o ESP32 fala com um broker só.
    topic = f"sensors/{args.sensor_id}/telemetry"

    clients = {}
    wanted = ("plain", "secure") if args.only is None else (args.only,)

    if "plain" in wanted:
        try:
            clients["plain"] = connect_plain(
                args.plain_host, args.plain_port, args.sensor_id
            )
            print(f"[plain] conectado em {args.plain_host}:{args.plain_port}")
        except Exception as error:
            print(
                f"[plain] falha ao conectar em {args.plain_host}:{args.plain_port}: {error}",
                file=sys.stderr,
            )

    if "secure" in wanted:
        try:
            clients["secure"] = connect_secure(
                args.secure_host, args.secure_port, args.sensor_id
            )
            print(f"[secure] conectado em {args.secure_host}:{args.secure_port}")
        except Exception as error:
            print(
                f"[secure] falha ao conectar em {args.secure_host}:{args.secure_port}: {error}",
                file=sys.stderr,
            )

    if not clients:
        print("nenhum broker disponível; encerrando.", file=sys.stderr)
        return 1

    print(f"publicando em {topic} a cada {args.interval}s (Ctrl+C para parar)")

    reading = (
        random.uniform(*TEMPERATURE_RANGE),
        random.uniform(*HUMIDITY_RANGE),
    )
    try:
        while True:
            reading = next_reading(reading)
            temperature, humidity = reading
            payload = json.dumps({"temperature": temperature, "humidity": humidity})

            for broker, client in clients.items():
                info = client.publish(topic, payload, qos=0)
                if info.rc == mqtt.MQTT_ERR_SUCCESS:
                    print(
                        f"[{broker}] {args.sensor_id} temp={temperature}C "
                        f"hum={humidity}%"
                    )
                else:
                    print(
                        f"[{broker}] publish falhou (rc={info.rc}: "
                        f"{mqtt.error_string(info.rc)})",
                        file=sys.stderr,
                    )

            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nencerrando...")
    finally:
        for client in clients.values():
            client.loop_stop()
            client.disconnect()

    return 0


if __name__ == "__main__":
    sys.exit(main())
