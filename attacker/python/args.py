"""Parsing de CLI/env do injetor, isolado da lógica de rede para ser testável.

Espelha a convenção de env do scripts/mock-sensor.py (MQTT_PLAIN_HOST/PORT e
MQTT_SECURE_HOST/PORT), mas com uma diferença deliberada de segurança: nunca lê
MQTT_SECURE_USERNAME/PASSWORD do ambiente — o atacante não tem a credencial
legítima por definição, então herdá-la do processo mascararia a rejeição que o
experimento precisa comprovar.
"""

import argparse
import os
from dataclasses import dataclass
from typing import Optional, Tuple

DEFAULT_SENSOR_ID = "sensor-mock-01"
TEMPERATURE_RANGE = (22.0, 26.0)
HUMIDITY_RANGE = (40.0, 60.0)


@dataclass(frozen=True)
class InjectorArgs:
    target: str
    sensor_id: str
    host: str
    port: int
    count: int
    interval: float
    qos: int
    temperature: Optional[float]
    humidity: Optional[float]
    temperature_range: Tuple[float, float]
    humidity_range: Tuple[float, float]
    username: Optional[str]
    password: Optional[str]
    output_format: str


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Injeta leituras forjadas no tópico do sensor legítimo. Aceito no "
            "broker plain; rejeitado no secure (mTLS)."
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
        help=f"Sensor cujo tópico será falsificado (default: {DEFAULT_SENSOR_ID}).",
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
        "--count",
        type=int,
        default=10,
        help="Número de mensagens forjadas a publicar (default: 10).",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=0.0,
        help="Segundos entre publicações (default: 0 — é um ataque, não simulação).",
    )
    parser.add_argument(
        "--qos",
        type=int,
        default=0,
        help="QoS do publish (default: 0).",
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=None,
        help="Temperatura fixa; se setada, ignora --temperature-range.",
    )
    parser.add_argument(
        "--humidity",
        type=float,
        default=None,
        help="Umidade fixa; se setada, ignora --humidity-range.",
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


def _default_host(target: str) -> str:
    key = "MQTT_PLAIN_HOST" if target == "plain" else "MQTT_SECURE_HOST"
    return os.environ.get(key, "localhost")


def _default_port(target: str) -> int:
    if target == "plain":
        return int(os.environ.get("MQTT_PLAIN_PORT", "1883"))
    return int(os.environ.get("MQTT_SECURE_PORT", "8883"))


def parse_args(argv=None) -> InjectorArgs:
    parsed = build_parser().parse_args(argv)
    host = parsed.host if parsed.host is not None else _default_host(parsed.target)
    port = parsed.port if parsed.port is not None else _default_port(parsed.target)
    return InjectorArgs(
        target=parsed.target,
        sensor_id=parsed.sensor_id,
        host=host,
        port=port,
        count=parsed.count,
        interval=parsed.interval,
        qos=parsed.qos,
        temperature=parsed.temperature,
        humidity=parsed.humidity,
        temperature_range=TEMPERATURE_RANGE,
        humidity_range=HUMIDITY_RANGE,
        # username/password ficam None de propósito quando não passados na CLI:
        # o atacante não possui a credencial legítima, então não a lemos do env.
        username=parsed.username,
        password=parsed.password,
        output_format=parsed.output_format,
    )
