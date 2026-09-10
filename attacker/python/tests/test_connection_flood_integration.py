"""Testes de integração do connection-flood contra Mosquitto real (plain).

Exige `docker compose up -d mosquitto-plain`. Rode com
`python -m pytest -m integration`.

Mesmo padrão de `test_injector_integration.py`: chama `run(args)` diretamente
(sem subprocess) contra o broker plain real, com um N pequeno e seguro — o
objetivo aqui não é achar o ponto real de exaustão de conexões do broker (isso
é experimento manual, ver docs/specs/track-b-availability-dos.md, seção
"Testing Decisions"), só confirmar que, dado N conexões simultâneas
configuradas, o script abre N conexões e reporta taxa de sucesso/falha
corretamente.
"""

import dataclasses
import json
import os
import re
from pathlib import Path

import pytest

from args_connection_flood import ConnectionFloodArgs
from connection_flood import run

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent

pytestmark = pytest.mark.integration


def load_env():
    # Mesma leitura manual linha-a-linha do .env que test_injector_integration.py
    # usa, sem sobrescrever o que já está no ambiente do processo.
    env = dict(os.environ)
    env_path = REPO_ROOT / ".env"
    if env_path.is_file():
        pattern = re.compile(r"^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$")
        with open(env_path, encoding="utf8") as handle:
            for line in handle:
                match = pattern.match(line)
                if match and match.group(1) not in env:
                    env[match.group(1)] = match.group(2).strip()
    return env


ENV = load_env()


def _args(**overrides) -> ConnectionFloodArgs:
    base = dict(
        target="plain",
        host="localhost",
        port=int(ENV.get("MQTT_PLAIN_PORT", "1883")),
        connections=10,
        client_id_prefix="itest-flood",
        hold_seconds=0.5,
        # Margem generosa (script default é 10.0): quando a suíte inteira roda
        # em sequência, o broker/host já vem de dezenas de conexões MQTT dos
        # testes anteriores, e 10 CONNECTs concorrentes ocasionalmente
        # ultrapassam 10s de espera por CONNACK sob essa contenção — não é
        # rejeição do broker (ver relatório desta tarefa para o achado
        # detalhado), só falta de margem para ambiente sob carga.
        connect_timeout=20.0,
        username=None,
        password=None,
        output_format="json",
    )
    base.update(overrides)
    return ConnectionFloodArgs(**base)


def test_plain_connection_flood_opens_all_requested_connections():
    n = 10
    result = run(_args(connections=n))

    # Broker plain não tem `max_connections` (infra/mosquitto/plain/mosquitto.conf
    # documenta isso de propósito), então as N conexões devem ser aceitas.
    assert result.connections_attempted == n
    assert result.connections_established == n
    assert result.connections_rejected == 0
    assert result.success_rate == 1.0
    assert result.errors == []
    assert result.target == "plain"
    assert result.port == int(ENV.get("MQTT_PLAIN_PORT", "1883"))

    # O JSON de resultado (o que main() imprime em stdout) precisa carregar
    # todos os campos que o critério de sucesso do spec exige.
    payload = json.loads(json.dumps(dataclasses.asdict(result)))
    assert payload["connections_attempted"] == n
    assert payload["connections_established"] == n
    assert payload["connections_rejected"] == 0
    assert payload["success_rate"] == 1.0
    assert set(payload.keys()) == {
        "target",
        "host",
        "port",
        "connections_attempted",
        "connections_established",
        "connections_rejected",
        "success_rate",
        "errors",
        "started_at",
        "finished_at",
    }


def test_plain_connection_flood_respects_small_n():
    # N diferente do teste anterior, para confirmar que o resultado reportado
    # acompanha o parâmetro configurado (não é um valor fixo/hardcoded).
    n = 5
    result = run(_args(connections=n, hold_seconds=0.0))

    assert result.connections_attempted == n
    assert result.connections_established == n
    assert result.connections_rejected == 0
    assert result.success_rate == 1.0
