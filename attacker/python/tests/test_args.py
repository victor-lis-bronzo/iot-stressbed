import pytest

from args import DEFAULT_SENSOR_ID, parse_args


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


def test_secure_never_reads_credentials_from_env(monkeypatch):
    monkeypatch.setenv("MQTT_SECURE_USERNAME", "x")
    monkeypatch.setenv("MQTT_SECURE_PASSWORD", "y")
    args = parse_args(["--target", "secure"])
    assert args.username is None
    assert args.password is None


def test_fixed_temperature_overrides_range():
    args = parse_args(["--target", "plain", "--temperature", "99.9"])
    assert args.temperature == 99.9


def test_numeric_flags_convert_and_default(monkeypatch):
    monkeypatch.delenv("MQTT_PLAIN_PORT", raising=False)
    defaults = parse_args(["--target", "plain"])
    assert defaults.count == 10
    assert defaults.interval == 0.0
    assert defaults.qos == 0
    assert defaults.output_format == "json"

    args = parse_args(
        ["--target", "plain", "--count", "5", "--interval", "1.5", "--qos", "1"]
    )
    assert isinstance(args.count, int) and args.count == 5
    assert isinstance(args.interval, float) and args.interval == 1.5
    assert isinstance(args.qos, int) and args.qos == 1
