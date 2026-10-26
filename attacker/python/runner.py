#!/usr/bin/env python3
"""Runner HTTP do container `attacker` (ADR-0012).

O nestjs-api orquestra a run (start -> ataque -> KPI -> stop) e chama este
servidor pela rede interna `stressbed-net` para executar o script do ataque. O
runner NUNCA decide quando rodar: só executa o que o api manda, então o api
continua sendo a única fonte da run ativa (ADR-0006).

Superfície deliberadamente pequena:
  - POST /run  {"attackType", "mode", "args": ["--flag", "valor", ...]}
  - GET  /health

Segurança: sem shell (os args vão como lista para subprocess), `attackType` e
`mode` contra listas fechadas, e uma allowlist de flags por ataque. As flags de
conexão (--host/--port/--username/--password/--target) são do runner, não do
chamador: o atacante não herda credencial nenhuma (ver args.py). O servidor não
é publicado no host (`expose`, nunca `ports`).

Resultado: o JSON que o script imprime em stdout, mais o exit code. Os scripts
logam em stderr e imprimem o resultado em stdout, nessa ordem.
"""

import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable, Dict, FrozenSet, List, Optional, Tuple

PYTHON_DIR = Path(__file__).resolve().parent
APP_DIR = PYTHON_DIR.parent

MODES = ("plain", "secure")

# attackType -> (script, flags permitidas). Mesmo mapa do antigo
# scripts/run-experiment.sh; as flags são as de args*.py menos as de conexão.
ATTACKS: Dict[str, Tuple[str, FrozenSet[str]]] = {
    "injection": (
        "injector.py",
        frozenset(
            {"--count", "--interval", "--sensor-id", "--temperature", "--humidity", "--qos"}
        ),
    ),
    "connection-flood": (
        "connection_flood.py",
        frozenset(
            {"--connections", "--hold-seconds", "--connect-timeout", "--client-id-prefix"}
        ),
    ),
    "message-flood": (
        "message_flood.py",
        frozenset(
            {
                "--rate",
                "--duration-seconds",
                "--payload-size-bytes",
                "--sensor-id",
                "--client-id",
                "--qos",
            }
        ),
    ),
    "malformed-payload": (
        "malformed_payload.py",
        frozenset(
            {"--mode", "--size-bytes", "--count", "--sensor-id", "--client-id", "--qos"}
        ),
    ),
}

MAX_BODY_BYTES = 64 * 1024
MAX_ARGS = 32
MAX_VALUE_LEN = 128
STDERR_TAIL_CHARS = 2000


class RunnerError(Exception):
    """Pedido inválido (vira HTTP 400)."""


class BusyError(Exception):
    """Já há um ataque em execução neste container (vira HTTP 409)."""


def build_argv(attack_type: str, mode: str, args: List[str]) -> List[str]:
    """Valida o pedido e monta o argv do script. Lança RunnerError se inválido."""
    if attack_type not in ATTACKS:
        raise RunnerError(f"attackType inválido: {attack_type!r}")
    if mode not in MODES:
        raise RunnerError(f"mode inválido: {mode!r} (esperado: plain|secure)")
    if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
        raise RunnerError("args deve ser uma lista de strings")
    if len(args) > MAX_ARGS:
        raise RunnerError(f"args com mais de {MAX_ARGS} itens")

    script, allowed = ATTACKS[attack_type]
    argv: List[str] = [
        sys.executable,
        str(PYTHON_DIR / script),
        "--target",
        mode,
    ]

    i = 0
    while i < len(args):
        token = args[i]
        flag, has_eq, inline_value = token.partition("=")
        if not flag.startswith("--"):
            raise RunnerError(f"argumento fora de uma flag: {token!r}")
        if flag not in allowed:
            raise RunnerError(f"flag não permitida para {attack_type}: {flag}")
        if has_eq:
            value: Optional[str] = inline_value
            i += 1
        elif i + 1 < len(args) and not args[i + 1].startswith("--"):
            value = args[i + 1]
            i += 2
        else:
            value = None  # flag sem valor
            i += 1
        if value is not None:
            if len(value) > MAX_VALUE_LEN or "\x00" in value:
                raise RunnerError(f"valor inválido para {flag}")
            argv.extend([flag, value])
        else:
            argv.append(flag)
    return argv


_run_lock = threading.Lock()


def execute(
    attack_type: str,
    mode: str,
    args: List[str],
    *,
    timeout: float,
    run: Optional[Callable[..., subprocess.CompletedProcess]] = None,
) -> Dict[str, object]:
    """Roda o ataque como subprocesso e devolve {result, exitCode, stderr}.

    Subprocesso (e não import) para que um crash/OOM do ataque não derrube o
    runner. O lock garante um ataque por vez no container (defesa em
    profundidade: o api já serializa pela run única do ADR-0006).
    """
    argv = build_argv(attack_type, mode, args)
    # Resolvido na chamada (não como default do parâmetro) para ser substituível.
    run = run or subprocess.run
    if not _run_lock.acquire(blocking=False):
        raise BusyError("já existe um ataque em execução neste container")
    try:
        proc = run(
            argv,
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    finally:
        _run_lock.release()

    result: Optional[object] = None
    stdout = (proc.stdout or "").strip()
    if stdout:
        try:
            result = json.loads(stdout)
        except ValueError:
            result = None
    return {
        "result": result,
        "exitCode": proc.returncode,
        "stderr": (proc.stderr or "")[-STDERR_TAIL_CHARS:],
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "stressbed-attacker-runner"
    timeout_seconds = float(os.environ.get("RUNNER_TIMEOUT_SECONDS", "3600"))

    def _send(self, status: int, payload: Dict[str, object]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 (API do BaseHTTPRequestHandler)
        if self.path == "/health":
            self._send(200, {"status": "ok"})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/run":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY_BYTES:
            self._send(400, {"error": "corpo ausente ou grande demais"})
            return
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise ValueError("o corpo deve ser um objeto JSON")
            payload = execute(
                str(body.get("attackType", "")),
                str(body.get("mode", "")),
                body.get("args", []),
                timeout=self.timeout_seconds,
            )
        except RunnerError as exc:
            self._send(400, {"error": str(exc)})
        except ValueError as exc:
            self._send(400, {"error": f"JSON inválido: {exc}"})
        except BusyError as exc:
            self._send(409, {"error": str(exc)})
        except subprocess.TimeoutExpired:
            self._send(504, {"error": "ataque excedeu o tempo limite do runner"})
        else:
            self._send(200, payload)

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write("[runner] " + (fmt % args) + "\n")


def main() -> int:
    port = int(os.environ.get("RUNNER_PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    sys.stderr.write(f"[runner] escutando em 0.0.0.0:{port}\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
