"""Testes de integração do malformed-payload contra Mosquitto real (plain).

Exige `docker compose up -d mosquitto-plain`. Rode com
`python -m pytest -m integration`.

Mesmo padrão de `test_injector_integration.py`: chama `run(args)` diretamente
contra o broker plain real. Cobre 3 dos 4 modos de `args_malformed_payload.py`
(`invalid-utf8`, `null-bytes`, `giant`) e documenta o comportamento REAL
observado do Mosquitto plain — que, nesta configuração (ver
infra/mosquitto/plain/mosquitto.conf: sem `message_size_limit`, protocolo
MQTT trata o payload como bytes opacos, sem validação de conteúdo), aceita
todos eles sem desconectar. Isso não é um valor assumido/hardcoded: foi
confirmado rodando os 4 modos manualmente contra o broker real antes de
escrever este teste (ver relatório desta tarefa).
"""

import dataclasses
import json
import os
import re
import threading
import time
from pathlib import Path

import paho.mqtt.client as mqtt
import pytest

from args_malformed_payload import MalformedPayloadArgs
from malformed_payload import build_payload, run

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


def _args(**overrides) -> MalformedPayloadArgs:
    base = dict(
        target="plain",
        host="localhost",
        port=int(ENV.get("MQTT_PLAIN_PORT", "1883")),
        sensor_id="itest-malformed",
        mode="invalid-utf8",
        size_bytes=200_000,
        count=1,
        qos=0,
        client_id="itest-malformed",
        username=None,
        password=None,
        output_format="json",
    )
    base.update(overrides)
    return MalformedPayloadArgs(**base)


@pytest.mark.parametrize("mode", ["invalid-utf8", "null-bytes", "giant"])
def test_plain_malformed_payload_is_accepted_without_disconnect(mode):
    # Payload pequeno também para o modo "giant": o objetivo não é achar o
    # limite real do broker (isso é experimento manual, ver
    # docs/specs/track-b-availability-dos.md), só confirmar que o script
    # reporta corretamente a reação do broker a um payload pequeno e seguro.
    args = _args(mode=mode, count=2, client_id=f"itest-malformed-{mode}")
    result = run(args)

    assert result.connect_status == "connected"
    assert result.connect_error is None
    assert result.mode == mode
    assert result.attempted == 2

    # Comportamento real observado: o Mosquitto plain, sem `message_size_limit`
    # configurado e sem validação de conteúdo (payload MQTT é opaco ao
    # protocolo), aceita todos os 4 modos sem derrubar a conexão.
    assert result.publish_accepted == 2
    assert result.disconnected_after_publish is False
    assert result.broker_response_summary == "aceito sem erro aparente"

    payload = json.loads(json.dumps(dataclasses.asdict(result)))
    assert set(payload.keys()) == {
        "target",
        "topic",
        "host",
        "port",
        "mode",
        "connect_status",
        "connect_error",
        "attempted",
        "publish_accepted",
        "disconnected_after_publish",
        "broker_response_summary",
        "started_at",
        "finished_at",
    }


def test_plain_malformed_payload_bytes_arrive_unmodified_on_wire():
    # Confirma não só que o cliente reportou aceite, mas que o broker de fato
    # encaminhou os bytes malformados sem alterá-los (payload MQTT é binário
    # opaco) — vai além do rc do publish() e verifica o dado real no wire.
    mode = "invalid-utf8"
    topic = "sensors/itest-malformed-wire/telemetry"
    received = []
    lock = threading.Lock()

    def on_message(client, userdata, message):
        with lock:
            received.append(message.payload)

    verifier = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="verify-malformed")
    verifier.on_message = on_message
    verifier.connect("localhost", int(ENV.get("MQTT_PLAIN_PORT", "1883")), keepalive=30)
    verifier.subscribe(topic)
    verifier.loop_start()

    args = _args(
        mode=mode,
        sensor_id="itest-malformed-wire",
        count=1,
        client_id="itest-malformed-wire",
    )
    result = run(args)
    expected_payload = build_payload(args)

    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline:
        with lock:
            if received:
                break
        time.sleep(0.1)

    verifier.loop_stop()
    verifier.disconnect()

    assert result.publish_accepted == 1
    assert result.disconnected_after_publish is False
    with lock:
        assert len(received) == 1
        assert received[0] == expected_payload
