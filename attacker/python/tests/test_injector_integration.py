"""Testes de integração do injetor contra Mosquitto real (plain e secure).

Exige `docker compose up -d mosquitto-plain mosquitto-secure`. Rode com
`python -m pytest -m integration`.
"""

import os
import re
import threading
from pathlib import Path

import paho.mqtt.client as mqtt
import pytest

from args import HUMIDITY_RANGE, TEMPERATURE_RANGE, InjectorArgs
from injector import run

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent

pytestmark = pytest.mark.integration


def load_env():
    # Mesma leitura manual linha-a-linha do .env que o teste de integração do
    # capture usa (apps/api/test/capture.integration.spec.ts), sem sobrescrever
    # o que já está no ambiente do processo.
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


def _args(**overrides) -> InjectorArgs:
    base = dict(
        target="plain",
        sensor_id="itest-inject",
        host="localhost",
        port=int(ENV.get("MQTT_PLAIN_PORT", "1883")),
        count=10,
        interval=0.0,
        qos=0,
        temperature=None,
        humidity=None,
        temperature_range=TEMPERATURE_RANGE,
        humidity_range=HUMIDITY_RANGE,
        username=None,
        password=None,
        output_format="json",
    )
    base.update(overrides)
    return InjectorArgs(**base)


def test_plain_injection_is_accepted():
    topic = "sensors/itest-inject-plain/telemetry"
    received = []
    lock = threading.Lock()

    def on_message(client, userdata, message):
        with lock:
            received.append(message.topic)

    verifier = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="verify-plain")
    verifier.on_message = on_message
    verifier.connect("localhost", int(ENV.get("MQTT_PLAIN_PORT", "1883")), keepalive=30)
    verifier.subscribe(topic)
    verifier.loop_start()

    result = run(_args(sensor_id="itest-inject-plain"))

    deadline = threading.Event()
    for _ in range(50):
        with lock:
            if len(received) >= 10:
                break
        deadline.wait(0.1)

    verifier.loop_stop()
    verifier.disconnect()

    assert result.connect_status == "connected"
    assert result.attempted == 10
    assert result.success_rate == 1.0
    with lock:
        assert len(received) == 10


def test_secure_injection_without_credentials_is_rejected():
    result = run(
        _args(
            target="secure",
            sensor_id="itest-inject-secure",
            port=int(ENV.get("MQTT_SECURE_PORT", "8883")),
            username=None,
            password=None,
        )
    )
    assert result.connect_status == "rejected"
    assert result.accepted == 0
    assert result.success_rate is None


def test_secure_injection_with_valid_creds_but_no_client_cert_is_still_rejected():
    # mTLS (require_certificate true) aborta o handshake antes da senha; ter a
    # credencial correta não ajuda sem certificado de cliente.
    result = run(
        _args(
            target="secure",
            sensor_id="itest-inject-secure-creds",
            port=int(ENV.get("MQTT_SECURE_PORT", "8883")),
            username=ENV.get("MQTT_SECURE_USERNAME"),
            password=ENV.get("MQTT_SECURE_PASSWORD"),
        )
    )
    assert result.connect_status == "rejected"
