import pytest

from args_connection_flood import DEFAULT_CLIENT_ID_PREFIX, parse_args


def test_target_is_required():
    with pytest.raises(SystemExit):
        parse_args([])


def test_plain_defaults_without_env(monkeypatch):
    monkeypatch.delenv("MQTT_PLAIN_HOST", raising=False)
    monkeypatch.delenv("MQTT_PLAIN_PORT", raising=False)
    args = parse_args(["--target", "plain"])
    assert args.target == "plain"
    assert args.host == "localhost"
    assert args.port == 1883
    assert args.client_id_prefix == DEFAULT_CLIENT_ID_PREFIX
    assert args.connections == 100
    assert args.hold_seconds == 5.0
    assert args.connect_timeout == 10.0
    assert args.output_format == "json"


def test_secure_defaults_without_env(monkeypatch):
    monkeypatch.delenv("MQTT_SECURE_HOST", raising=False)
    monkeypatch.delenv("MQTT_SECURE_PORT", raising=False)
    args = parse_args(["--target", "secure"])
    assert args.host == "localhost"
    assert args.port == 8883


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


def test_explicit_host_port_override_env(monkeypatch):
    monkeypatch.setenv("MQTT_PLAIN_HOST", "broker.local")
    monkeypatch.setenv("MQTT_PLAIN_PORT", "12345")
    args = parse_args(
        ["--target", "plain", "--host", "other.local", "--port", "1"]
    )
    assert args.host == "other.local"
    assert args.port == 1


def test_secure_never_reads_credentials_from_env(monkeypatch):
    monkeypatch.setenv("MQTT_SECURE_USERNAME", "x")
    monkeypatch.setenv("MQTT_SECURE_PASSWORD", "y")
    args = parse_args(["--target", "secure"])
    assert args.username is None
    assert args.password is None


def test_username_password_only_from_cli():
    args = parse_args(
        ["--target", "secure", "--username", "u", "--password", "p"]
    )
    assert args.username == "u"
    assert args.password == "p"


def test_numeric_flags_convert_and_default(monkeypatch):
    monkeypatch.delenv("MQTT_PLAIN_PORT", raising=False)
    defaults = parse_args(["--target", "plain"])
    assert isinstance(defaults.connections, int) and defaults.connections == 100
    assert isinstance(defaults.hold_seconds, float) and defaults.hold_seconds == 5.0
    assert (
        isinstance(defaults.connect_timeout, float)
        and defaults.connect_timeout == 10.0
    )

    args = parse_args(
        [
            "--target",
            "plain",
            "--connections",
            "250",
            "--hold-seconds",
            "1.5",
            "--connect-timeout",
            "2.5",
        ]
    )
    assert isinstance(args.connections, int) and args.connections == 250
    assert isinstance(args.hold_seconds, float) and args.hold_seconds == 1.5
    assert isinstance(args.connect_timeout, float) and args.connect_timeout == 2.5


def test_client_id_prefix_override():
    args = parse_args(["--target", "plain", "--client-id-prefix", "custom"])
    assert args.client_id_prefix == "custom"
