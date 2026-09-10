import pytest

from args_malformed_payload import DEFAULT_SENSOR_ID, DEFAULT_SIZE_BYTES, parse_args


def test_target_is_required():
    with pytest.raises(SystemExit):
        parse_args(["--mode", "giant"])


def test_mode_is_required():
    with pytest.raises(SystemExit):
        parse_args(["--target", "plain"])


def test_mode_rejects_invalid_choice():
    with pytest.raises(SystemExit):
        parse_args(["--target", "plain", "--mode", "not-a-real-mode"])


def test_plain_defaults_without_env(monkeypatch):
    monkeypatch.delenv("MQTT_PLAIN_HOST", raising=False)
    monkeypatch.delenv("MQTT_PLAIN_PORT", raising=False)
    args = parse_args(["--target", "plain", "--mode", "giant"])
    assert args.target == "plain"
    assert args.mode == "giant"
    assert args.sensor_id == DEFAULT_SENSOR_ID
    assert args.host == "localhost"
    assert args.port == 1883


def test_secure_defaults_without_env(monkeypatch):
    monkeypatch.delenv("MQTT_SECURE_HOST", raising=False)
    monkeypatch.delenv("MQTT_SECURE_PORT", raising=False)
    args = parse_args(["--target", "secure", "--mode", "invalid-json"])
    assert args.host == "localhost"
    assert args.port == 8883


def test_host_port_from_env(monkeypatch):
    monkeypatch.setenv("MQTT_PLAIN_HOST", "broker.local")
    monkeypatch.setenv("MQTT_PLAIN_PORT", "12345")
    args = parse_args(["--target", "plain", "--mode", "null-bytes"])
    assert args.host == "broker.local"
    assert args.port == 12345


def test_secure_never_reads_credentials_from_env(monkeypatch):
    monkeypatch.setenv("MQTT_SECURE_USERNAME", "x")
    monkeypatch.setenv("MQTT_SECURE_PASSWORD", "y")
    args = parse_args(["--target", "secure", "--mode", "invalid-utf8"])
    assert args.username is None
    assert args.password is None


def test_numeric_flags_convert_and_default(monkeypatch):
    monkeypatch.delenv("MQTT_PLAIN_PORT", raising=False)
    defaults = parse_args(["--target", "plain", "--mode", "giant"])
    assert defaults.size_bytes == DEFAULT_SIZE_BYTES
    assert defaults.count == 1
    assert defaults.qos == 0
    assert defaults.client_id == "malformed-payload"
    assert defaults.output_format == "json"

    args = parse_args(
        [
            "--target",
            "plain",
            "--mode",
            "giant",
            "--size-bytes",
            "2048",
            "--count",
            "3",
            "--qos",
            "1",
        ]
    )
    assert isinstance(args.size_bytes, int) and args.size_bytes == 2048
    assert isinstance(args.count, int) and args.count == 3
    assert isinstance(args.qos, int) and args.qos == 1


def test_all_modes_are_accepted():
    for mode in ("giant", "invalid-utf8", "invalid-json", "null-bytes"):
        args = parse_args(["--target", "plain", "--mode", mode])
        assert args.mode == mode
