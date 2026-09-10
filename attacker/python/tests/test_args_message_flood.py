import pytest

from args_message_flood import DEFAULT_SENSOR_ID, parse_args


def test_target_is_required():
    with pytest.raises(SystemExit):
        parse_args([])


def test_plain_defaults_without_env(monkeypatch):
    monkeypatch.delenv("MQTT_PLAIN_HOST", raising=False)
    monkeypatch.delenv("MQTT_PLAIN_PORT", raising=False)
    args = parse_args(["--target", "plain"])
    assert args.target == "plain"
    assert args.sensor_id == DEFAULT_SENSOR_ID
    assert args.host == "localhost"
    assert args.port == 1883


def test_plain_host_port_from_env(monkeypatch):
    monkeypatch.setenv("MQTT_PLAIN_HOST", "broker.local")
    monkeypatch.setenv("MQTT_PLAIN_PORT", "12345")
    args = parse_args(["--target", "plain"])
    assert args.host == "broker.local"
    assert args.port == 12345


def test_secure_host_port_from_env(monkeypatch):
    monkeypatch.setenv("MQTT_SECURE_HOST", "secure.local")
    monkeypatch.setenv("MQTT_SECURE_PORT", "9999")
    args = parse_args(["--target", "secure"])
    assert args.host == "secure.local"
    assert args.port == 9999


def test_secure_never_reads_credentials_from_env(monkeypatch):
    monkeypatch.setenv("MQTT_SECURE_USERNAME", "x")
    monkeypatch.setenv("MQTT_SECURE_PASSWORD", "y")
    args = parse_args(["--target", "secure"])
    assert args.username is None
    assert args.password is None


def test_numeric_flags_convert_and_default(monkeypatch):
    monkeypatch.delenv("MQTT_PLAIN_PORT", raising=False)
    defaults = parse_args(["--target", "plain"])
    assert defaults.rate == 100.0
    assert defaults.duration_seconds == 30.0
    assert defaults.payload_size_bytes == 64
    assert defaults.qos == 0
    assert defaults.client_id == "message-flood"
    assert defaults.output_format == "json"

    args = parse_args(
        [
            "--target",
            "plain",
            "--rate",
            "250",
            "--duration-seconds",
            "5",
            "--payload-size-bytes",
            "128",
            "--qos",
            "1",
        ]
    )
    assert isinstance(args.rate, float) and args.rate == 250.0
    assert isinstance(args.duration_seconds, float) and args.duration_seconds == 5.0
    assert isinstance(args.payload_size_bytes, int) and args.payload_size_bytes == 128
    assert isinstance(args.qos, int) and args.qos == 1


def test_client_id_override():
    args = parse_args(["--target", "plain", "--client-id", "custom-flood"])
    assert args.client_id == "custom-flood"
