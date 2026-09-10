"""Parsing de CLI/env do message-flood, isolado da lógica de rede para ser
testável.

Reaproveita a convenção de env de args.py (MQTT_PLAIN_HOST/PORT e
MQTT_SECURE_HOST/PORT) e a mesma regra de segurança: nunca lê
MQTT_SECURE_USERNAME/PASSWORD do ambiente — o atacante não tem a credencial
legítima por definição, então herdá-la do processo mascararia a rejeição que
o experimento precisa comprovar.
"""

import argparse
from dataclasses import dataclass
from typing import Optional

from args import _default_host, _default_port

DEFAULT_SENSOR_ID = "sensor-mock-01"


@dataclass(frozen=True)
class MessageFloodArgs:
    target: str
    sensor_id: str
    host: str
    port: int
    rate: float
    duration_seconds: float
    payload_size_bytes: int
    qos: int
    client_id: str
    username: Optional[str]
    password: Optional[str]
    output_format: str


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Publica mensagens em taxa configurável (msg/s) por uma duração "
            "configurável, para medir throughput sustentado até a degradação "
            "do broker."
        )
    )
    parser.add_argument(
        "--target",
        choices=("plain", "secure"),
        required=True,
        help="Broker alvo (obrigatório).",
    )
    parser.add_argument(
        "--sensor-id",
        default=DEFAULT_SENSOR_ID,
        help=f"Tópico alvo sensors/<sensor_id>/telemetry (default: {DEFAULT_SENSOR_ID}).",
    )
    parser.add_argument(
        "--host",
        default=None,
        help="Host do broker (default: env conforme o target, senão localhost).",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help="Porta do broker (default: env conforme o target, senão 1883/8883).",
    )
    parser.add_argument(
        "--rate",
        type=float,
        default=100.0,
        help="Mensagens por segundo (default: 100.0).",
    )
    parser.add_argument(
        "--duration-seconds",
        type=float,
        default=30.0,
        help="Duração do flood em segundos (default: 30.0).",
    )
    parser.add_argument(
        "--payload-size-bytes",
        type=int,
        default=64,
        help="Tamanho em bytes de cada payload publicado (default: 64).",
    )
    parser.add_argument(
        "--qos",
        type=int,
        default=0,
        help="QoS do publish (default: 0).",
    )
    parser.add_argument(
        "--client-id",
        default="message-flood",
        help="Client ID MQTT (default: message-flood).",
    )
    parser.add_argument(
        "--username",
        default=None,
        help="Usuário MQTT (default: None — nunca herdado do ambiente).",
    )
    parser.add_argument(
        "--password",
        default=None,
        help="Senha MQTT (default: None — nunca herdada do ambiente).",
    )
    parser.add_argument(
        "--output-format",
        default="json",
        help="Formato do resultado em stdout (default: json).",
    )
    return parser


def parse_args(argv=None) -> MessageFloodArgs:
    parsed = build_parser().parse_args(argv)
    host = parsed.host if parsed.host is not None else _default_host(parsed.target)
    port = parsed.port if parsed.port is not None else _default_port(parsed.target)
    return MessageFloodArgs(
        target=parsed.target,
        sensor_id=parsed.sensor_id,
        host=host,
        port=port,
        rate=parsed.rate,
        duration_seconds=parsed.duration_seconds,
        payload_size_bytes=parsed.payload_size_bytes,
        qos=parsed.qos,
        client_id=parsed.client_id,
        # username/password ficam None de propósito quando não passados na CLI:
        # o atacante não possui a credencial legítima, então não a lemos do env.
        username=parsed.username,
        password=parsed.password,
        output_format=parsed.output_format,
    )
