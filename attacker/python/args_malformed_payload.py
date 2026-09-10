"""Parsing de CLI/env do script de payload malformado/gigante, isolado da lógica
de rede para ser testável.

Espelha a convenção de env de args.py (MQTT_PLAIN_HOST/PORT e
MQTT_SECURE_HOST/PORT), reaproveitando seus helpers de default, e a mesma
regra de segurança: nunca lê MQTT_SECURE_USERNAME/PASSWORD do ambiente.
"""

import argparse
from dataclasses import dataclass
from typing import Optional

from args import _default_host, _default_port

DEFAULT_SENSOR_ID = "sensor-mock-01"
# ~10MB: MQTT permite pacotes até ~256MB, mas brokers costumam limitar bem
# abaixo disso via message_size_limit. Esse default mira provocar esse limite,
# não o teto do protocolo.
DEFAULT_SIZE_BYTES = 10_000_000
MODES = ("giant", "invalid-utf8", "invalid-json", "null-bytes")


@dataclass(frozen=True)
class MalformedPayloadArgs:
    target: str
    host: str
    port: int
    sensor_id: str
    mode: str
    size_bytes: int
    count: int
    qos: int
    client_id: str
    username: Optional[str]
    password: Optional[str]
    output_format: str


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Envia payloads malformados ou anormalmente grandes ao tópico do "
            "sensor e reporta a resposta do broker (aceite, erro, desconexão)."
        )
    )
    parser.add_argument(
        "--target",
        choices=("plain", "secure"),
        required=True,
        help="Broker alvo (obrigatório).",
    )
    parser.add_argument(
        "--mode",
        choices=MODES,
        required=True,
        help="Forma do payload adversarial a enviar (obrigatório).",
    )
    parser.add_argument(
        "--sensor-id",
        default=DEFAULT_SENSOR_ID,
        help=f"Sensor cujo tópico será alvo (default: {DEFAULT_SENSOR_ID}).",
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
        "--size-bytes",
        type=int,
        default=DEFAULT_SIZE_BYTES,
        help=f"Tamanho do payload em bytes, só para --mode giant (default: {DEFAULT_SIZE_BYTES}).",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=1,
        help="Número de publicações malformadas a enviar (default: 1).",
    )
    parser.add_argument(
        "--qos",
        type=int,
        default=0,
        help="QoS do publish (default: 0).",
    )
    parser.add_argument(
        "--client-id",
        default="malformed-payload",
        help="Client ID MQTT (default: malformed-payload).",
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


def parse_args(argv=None) -> MalformedPayloadArgs:
    parsed = build_parser().parse_args(argv)
    host = parsed.host if parsed.host is not None else _default_host(parsed.target)
    port = parsed.port if parsed.port is not None else _default_port(parsed.target)
    return MalformedPayloadArgs(
        target=parsed.target,
        host=host,
        port=port,
        sensor_id=parsed.sensor_id,
        mode=parsed.mode,
        size_bytes=parsed.size_bytes,
        count=parsed.count,
        qos=parsed.qos,
        client_id=parsed.client_id,
        # username/password ficam None de propósito quando não passados na CLI:
        # o atacante não possui a credencial legítima, então não a lemos do env.
        username=parsed.username,
        password=parsed.password,
        output_format=parsed.output_format,
    )
