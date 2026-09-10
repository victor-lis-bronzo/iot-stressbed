"""Parsing de CLI/env do connection-flood, isolado da lógica de rede.

Reaproveita `_default_host`/`_default_port` de args.py (mesma convenção de env
MQTT_PLAIN_HOST/PORT e MQTT_SECURE_HOST/PORT) e mantém a mesma regra de
segurança do injetor: nunca lê MQTT_SECURE_USERNAME/PASSWORD do ambiente — o
objetivo do connection-flood é esgotar slots de conexão, não autenticar de
verdade, então herdar credencial legítima do processo mascararia o que o
experimento precisa medir.
"""

import argparse
from dataclasses import dataclass
from typing import Optional

from args import _default_host, _default_port

DEFAULT_CLIENT_ID_PREFIX = "flood"


@dataclass(frozen=True)
class ConnectionFloodArgs:
    target: str
    host: str
    port: int
    connections: int
    client_id_prefix: str
    hold_seconds: float
    connect_timeout: float
    username: Optional[str]
    password: Optional[str]
    output_format: str


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Abre N conexões MQTT simultâneas para esgotar slots de conexão do "
            "broker e reporta a taxa de sucesso/falha de CONNECT."
        )
    )
    parser.add_argument(
        "--target",
        choices=("plain", "secure"),
        required=True,
        help="Broker alvo (obrigatório).",
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
        "--connections",
        type=int,
        default=100,
        help="Número de conexões simultâneas a abrir (default: 100).",
    )
    parser.add_argument(
        "--client-id-prefix",
        default=DEFAULT_CLIENT_ID_PREFIX,
        help=f"Prefixo dos client_id gerados (default: {DEFAULT_CLIENT_ID_PREFIX}).",
    )
    parser.add_argument(
        "--hold-seconds",
        type=float,
        default=5.0,
        help="Segundos que as conexões estabelecidas ficam abertas antes de "
        "desconectar (default: 5.0).",
    )
    parser.add_argument(
        "--connect-timeout",
        type=float,
        default=10.0,
        help="Segundos de espera por CONNACK por conexão (default: 10.0).",
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


def parse_args(argv=None) -> ConnectionFloodArgs:
    parsed = build_parser().parse_args(argv)
    host = parsed.host if parsed.host is not None else _default_host(parsed.target)
    port = parsed.port if parsed.port is not None else _default_port(parsed.target)
    return ConnectionFloodArgs(
        target=parsed.target,
        host=host,
        port=port,
        connections=parsed.connections,
        client_id_prefix=parsed.client_id_prefix,
        hold_seconds=parsed.hold_seconds,
        connect_timeout=parsed.connect_timeout,
        # username/password ficam None de propósito quando não passados na CLI:
        # o atacante não possui a credencial legítima, então não a lemos do env.
        username=parsed.username,
        password=parsed.password,
        output_format=parsed.output_format,
    )
