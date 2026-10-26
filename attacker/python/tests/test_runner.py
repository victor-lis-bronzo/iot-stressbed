"""Testes do runner HTTP do attacker (ADR-0012) — sem broker nem Docker.

O subprocesso é substituído por um fake; o servidor HTTP sobe numa porta efêmera
de loopback para exercitar o roteamento e os códigos de status de verdade.
"""

import json
import subprocess
import sys
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

import runner


def _argv(attack_type="connection-flood", mode="plain", args=()):
    return runner.build_argv(attack_type, mode, list(args))


class TestBuildArgv:
    def test_maps_each_attack_to_its_script_and_target(self):
        expected = {
            "injection": "injector.py",
            "connection-flood": "connection_flood.py",
            "message-flood": "message_flood.py",
            "malformed-payload": "malformed_payload.py",
        }
        for attack, script in expected.items():
            argv = _argv(attack, "secure")
            assert argv[0] == sys.executable
            assert argv[1].endswith(script)
            assert argv[2:4] == ["--target", "secure"]

    def test_flags_with_separate_and_inline_values(self):
        argv = _argv(args=["--connections", "200", "--hold-seconds=2.5"])
        assert argv[4:] == ["--connections", "200", "--hold-seconds", "2.5"]

    def test_boolean_flag_without_value(self):
        argv = _argv("injection", args=["--count", "5", "--qos"])
        assert argv[-1] == "--qos"

    def test_negative_number_is_a_value_not_a_flag(self):
        argv = _argv("injection", args=["--temperature", "-5"])
        assert argv[-2:] == ["--temperature", "-5"]

    def test_no_args_is_fine(self):
        assert len(_argv()) == 4

    @pytest.mark.parametrize("attack", ["", "rm -rf /", "Injection", "tcpdump"])
    def test_rejects_unknown_attack_type(self, attack):
        with pytest.raises(runner.RunnerError, match="attackType"):
            _argv(attack)

    @pytest.mark.parametrize("mode", ["", "both", "PLAIN"])
    def test_rejects_invalid_mode(self, mode):
        with pytest.raises(runner.RunnerError, match="mode"):
            _argv(mode=mode)

    @pytest.mark.parametrize(
        "flag",
        ["--host", "--port", "--username", "--password", "--target", "--output-format"],
    )
    def test_connection_flags_belong_to_the_runner_not_the_caller(self, flag):
        with pytest.raises(runner.RunnerError, match="não permitida"):
            _argv(args=[flag, "x"])

    def test_flag_of_another_attack_is_rejected(self):
        # --rate é do message-flood, não do connection-flood.
        with pytest.raises(runner.RunnerError, match="não permitida"):
            _argv("connection-flood", args=["--rate", "10"])

    def test_inline_form_cannot_smuggle_a_forbidden_flag(self):
        with pytest.raises(runner.RunnerError, match="não permitida"):
            _argv(args=["--host=evil"])

    def test_rejects_value_without_a_flag(self):
        with pytest.raises(runner.RunnerError, match="fora de uma flag"):
            _argv(args=["200"])

    def test_shell_metacharacters_stay_inert_values(self):
        # Sem shell: o valor chega ao script como um único argv, sem interpretação.
        argv = _argv("message-flood", args=["--sensor-id", "a; rm -rf / $(id)"])
        assert argv[-1] == "a; rm -rf / $(id)"

    def test_rejects_non_list_and_non_string_args(self):
        with pytest.raises(runner.RunnerError):
            runner.build_argv("connection-flood", "plain", "--connections 200")
        with pytest.raises(runner.RunnerError):
            runner.build_argv("connection-flood", "plain", ["--connections", 200])

    def test_rejects_too_many_args_and_oversized_or_nul_values(self):
        with pytest.raises(runner.RunnerError, match="mais de"):
            _argv(args=["--connections=1"] * (runner.MAX_ARGS + 1))
        with pytest.raises(runner.RunnerError, match="valor inválido"):
            _argv(args=["--connections", "9" * (runner.MAX_VALUE_LEN + 1)])
        with pytest.raises(runner.RunnerError, match="valor inválido"):
            _argv(args=["--connections", "1\x00"])


def _fake_run(stdout="", stderr="", returncode=0, seen=None):
    def run(argv, **kwargs):
        if seen is not None:
            seen.append((argv, kwargs))
        return subprocess.CompletedProcess(argv, returncode, stdout, stderr)

    return run


class TestExecute:
    def test_parses_stdout_json_and_exit_code(self):
        payload = runner.execute(
            "connection-flood",
            "plain",
            ["--connections", "5"],
            timeout=10,
            run=_fake_run(stdout='{"attempted": 5, "accepted": 5}\n', returncode=0),
        )
        assert payload["result"] == {"attempted": 5, "accepted": 5}
        assert payload["exitCode"] == 0

    def test_runs_without_shell_with_timeout_and_app_cwd(self):
        seen = []
        runner.execute(
            "injection", "plain", [], timeout=42, run=_fake_run(seen=seen)
        )
        argv, kwargs = seen[0]
        assert isinstance(argv, list)
        assert not kwargs.get("shell")
        assert kwargs["timeout"] == 42
        assert kwargs["cwd"] == str(runner.APP_DIR)

    def test_non_json_stdout_gives_null_result_and_keeps_stderr_tail(self):
        payload = runner.execute(
            "injection",
            "plain",
            [],
            timeout=10,
            run=_fake_run(stdout="not json", stderr="x" * 5000, returncode=1),
        )
        assert payload["result"] is None
        assert payload["exitCode"] == 1
        assert len(payload["stderr"]) == runner.STDERR_TAIL_CHARS

    def test_nonzero_exit_with_json_still_returns_the_result(self):
        # injection contra secure aceito: exit 1, mas o JSON é o achado.
        payload = runner.execute(
            "injection",
            "secure",
            [],
            timeout=10,
            run=_fake_run(stdout='{"connect_status": "connected"}', returncode=1),
        )
        assert payload["result"] == {"connect_status": "connected"}
        assert payload["exitCode"] == 1

    def test_second_attack_while_busy_is_rejected_and_lock_is_released(self):
        entered, release = threading.Event(), threading.Event()

        def blocking_run(argv, **kwargs):
            entered.set()
            release.wait(5)
            return subprocess.CompletedProcess(argv, 0, "{}", "")

        t = threading.Thread(
            target=runner.execute,
            args=("connection-flood", "plain", []),
            kwargs={"timeout": 10, "run": blocking_run},
        )
        t.start()
        assert entered.wait(5)
        with pytest.raises(runner.BusyError):
            runner.execute(
                "connection-flood", "plain", [], timeout=10, run=_fake_run("{}")
            )
        release.set()
        t.join(5)
        # liberou: o próximo ataque roda normalmente
        runner.execute("connection-flood", "plain", [], timeout=10, run=_fake_run("{}"))

    def test_lock_is_released_when_the_attack_times_out(self):
        def timing_out(argv, **kwargs):
            raise subprocess.TimeoutExpired(argv, 1)

        with pytest.raises(subprocess.TimeoutExpired):
            runner.execute("injection", "plain", [], timeout=1, run=timing_out)
        runner.execute("injection", "plain", [], timeout=1, run=_fake_run("{}"))


@pytest.fixture()
def server(monkeypatch):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), runner.Handler)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{srv.server_address[1]}"
    finally:
        srv.shutdown()
        srv.server_close()


def _post(base, body, raw=None):
    data = raw if raw is not None else json.dumps(body).encode()
    req = urllib.request.Request(
        base + "/run", data=data, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read())


class TestHttp:
    def test_health(self, server):
        with urllib.request.urlopen(server + "/health", timeout=5) as resp:
            assert resp.status == 200
            assert json.loads(resp.read()) == {"status": "ok"}

    def test_unknown_routes_are_404(self, server):
        with pytest.raises(urllib.error.HTTPError) as err:
            urllib.request.urlopen(server + "/nope", timeout=5)
        assert err.value.code == 404

    def test_invalid_attack_is_400(self, server):
        status, body = _post(server, {"attackType": "x", "mode": "plain", "args": []})
        assert status == 400
        assert "attackType" in body["error"]

    def test_forbidden_flag_is_400(self, server):
        status, body = _post(
            server,
            {"attackType": "connection-flood", "mode": "plain", "args": ["--host", "e"]},
        )
        assert status == 400
        assert "não permitida" in body["error"]

    def test_malformed_json_is_400(self, server):
        status, body = _post(server, None, raw=b"{not json")
        assert status == 400
        assert "JSON" in body["error"]

    def test_happy_path_runs_through_execute(self, server, monkeypatch):
        monkeypatch.setattr(
            runner.subprocess,
            "run",
            _fake_run(stdout='{"attempted": 3}', returncode=0),
        )
        status, body = _post(
            server,
            {"attackType": "connection-flood", "mode": "plain", "args": ["--connections", "3"]},
        )
        assert status == 200
        assert body["result"] == {"attempted": 3}
        assert body["exitCode"] == 0

    def test_busy_is_409(self, server, monkeypatch):
        assert runner._run_lock.acquire(blocking=False)
        try:
            status, _ = _post(
                server,
                {"attackType": "connection-flood", "mode": "plain", "args": []},
            )
        finally:
            runner._run_lock.release()
        assert status == 409
