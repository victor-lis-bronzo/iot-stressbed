#!/usr/bin/env python3
"""Exporta um CSV wide (uma linha por run_id) reunindo todos os KPIs de Track A
e Track B — Fase 5, Entregável 1 (docs/specs/data-analysis.md).

Lê SOMENTE (nunca escreve) de duas fontes já povoadas pelos tracks anteriores:

  - Postgres  : `experiment_runs` + `run_kpis` (join 1:1 por run_id).
  - InfluxDB  : measurements `broker_metrics` e `telemetry`, via as queries Flux
                versionadas em scripts/analysis/flux/*.flux (placeholders
                __BUCKET__/__RUN_ID__/__BROKER__/__START__/__STOP__).

Produz `out/run_metrics.csv` na raiz do repositório (cria `out/` se preciso).

Segurança: todo run_id interpolado em Flux é validado com o MESMO regex de UUID
do guard `assertSafeRunId` do adapter TS
(apps/api/src/metrics/adapters/influxdb-telemetry-query.adapter.ts) ANTES da
substituição — Flux não tem query parametrizada, a composição é string pura.

Convenção de nulos no CSV: um KPI que NÃO SE APLICA àquela run (ex.: KPI de
Track B numa run de Track A, ou jsonb parcial/ausente) sai como célula vazia,
NUNCA como `0`. Booleanos saem como `true`/`false` (minúsculas), de modo que um
`false` medido nunca se confunda com "não se aplica" (vazio). Ver "Casos de
Borda" na spec.

Uso:
    python export_run_metrics.py --run-id <uuid>
    python export_run_metrics.py --all

As dependências pesadas (psycopg2, influxdb-client) são importadas de forma
preguiçosa dentro das funções de I/O, para que a lógica pura deste módulo
(derivação, achatamento de jsonb, geração de linha) seja importável e testável
sem Postgres/Influx instalados.
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
FLUX_DIR = Path(__file__).resolve().parent / "flux"
OUT_DIR = REPO_ROOT / "out"
OUT_CSV = OUT_DIR / "run_metrics.csv"

# Mesmo regex do guard assertSafeRunId() do adapter TS (case-insensitive).
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

# Literal de tempo Flux aceito em __START__/__STOP__: RFC3339 (composto por este
# script) ou duração relativa (-1h). Validado antes de entrar na string da query.
FLUX_TIME_RE = re.compile(
    r"^(?:-?\d+(?:ns|us|ms|s|m|h|d|w|y)|"
    r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))$"
)

VALID_BROKERS = ("plain", "secure")

# Estados de container tratados como "não-saudáveis" na derivação (spec).
UNHEALTHY_STATUSES = frozenset({"restarting", "paused", "exited", "dead"})
HEALTHY_STATUS = "running"

# Ordem EXATA das colunas do catálogo de KPIs da spec. `recovered` é incluída
# logo após `recovery_time_ms` porque a "Regra de derivação" a exige como flag
# distinta de `broker_survived`.
CSV_COLUMNS: Tuple[str, ...] = (
    "run_id",
    "mode",
    "attack_type",
    "params",
    "started_at",
    "ended_at",
    "notes",
    "interception_coverage_pct",
    "entropy_bits",
    "payload_readability_classification",
    "injection_success_rate_pct",
    "injection_connect_status",
    "time_to_first_capture_ms",
    "track_b_attack_type",
    "track_b_attack_started_at",
    "track_b_attack_finished_at",
    "connections_attempted",
    "connections_established",
    "connections_rejected",
    "connection_success_rate",
    "message_flood_attempted",
    "message_flood_accepted",
    "message_flood_success_rate",
    "message_flood_achieved_rate",
    "message_flood_elapsed_seconds",
    "malformed_mode",
    "malformed_attempted",
    "malformed_publish_accepted",
    "malformed_disconnected_after_publish",
    "malformed_broker_response_summary",
    "cpu_usage_percent_avg",
    "mem_usage_bytes_avg",
    "mem_limit_bytes",
    "net_rx_bytes_per_s_avg",
    "net_tx_bytes_per_s_avg",
    "restart_count",
    "time_to_degradation_ms",
    "broker_survived",
    "recovery_time_ms",
    "recovered",
    "telemetry_captured_count",
    "first_capture_at",
)

# Mapeamento jsonb -> colunas do CSV, por track_b_attack_type. Cada tupla é
# (coluna_csv, campo_no_jsonb). Campo ausente no jsonb vira None (spec: jsonb
# parcial/ausente nunca lança exceção).
TRACK_B_FIELD_MAP: Dict[str, Tuple[Tuple[str, str], ...]] = {
    "connection-flood": (
        ("connections_attempted", "connections_attempted"),
        ("connections_established", "connections_established"),
        ("connections_rejected", "connections_rejected"),
        ("connection_success_rate", "success_rate"),
    ),
    "message-flood": (
        ("message_flood_attempted", "attempted"),
        ("message_flood_accepted", "accepted"),
        ("message_flood_success_rate", "success_rate"),
        ("message_flood_achieved_rate", "achieved_rate"),
        ("message_flood_elapsed_seconds", "elapsed_seconds"),
    ),
    "malformed-payload": (
        ("malformed_mode", "mode"),
        ("malformed_attempted", "attempted"),
        ("malformed_publish_accepted", "publish_accepted"),
        ("malformed_disconnected_after_publish", "disconnected_after_publish"),
        ("malformed_broker_response_summary", "broker_response_summary"),
    ),
}

# Todas as colunas alimentadas exclusivamente pelo jsonb de Track B — usadas para
# inicializar a linha com None antes de preencher só o subconjunto aplicável.
_ALL_TRACK_B_COLUMNS: Tuple[str, ...] = tuple(
    col for pairs in TRACK_B_FIELD_MAP.values() for col, _ in pairs
)


class AnalysisError(Exception):
    """Erro de configuração/conexão/query reportável ao usuário sem stack trace."""


# --------------------------------------------------------------------------- #
# Validação / canonicalização (lógica pura, testável)
# --------------------------------------------------------------------------- #

def assert_safe_run_id(run_id: str) -> None:
    """Equivalente Python de assertSafeRunId() do adapter TS."""
    if not isinstance(run_id, str) or not UUID_RE.match(run_id):
        raise ValueError(f"invalid runId for Flux query: {run_id}")


def assert_safe_broker(broker: str) -> None:
    if broker not in VALID_BROKERS:
        raise ValueError(f"invalid broker for Flux query: {broker}")


def assert_safe_flux_time(value: str) -> None:
    if not FLUX_TIME_RE.match(value):
        raise ValueError(f"invalid Flux time literal: {value}")


def canonical_json_params(params: Optional[Any]) -> Optional[str]:
    """JSON compacto e determinístico de `params` (chaves ordenadas).

    Técnica única de canonicalização, compartilhada com build_comparison_table.py
    (Entregável 3) — a chave de pareamento plain/secure deve ser idêntica
    independentemente da ordem de inserção dos campos no jsonb. Retorna None
    quando params é None (célula vazia no CSV, não a string "null").
    """
    if params is None:
        return None
    return json.dumps(
        params,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    )


# --------------------------------------------------------------------------- #
# Achatamento do jsonb track_b_result (lógica pura, testável)
# --------------------------------------------------------------------------- #

def flatten_track_b_result(
    track_b_attack_type: Optional[str],
    track_b_result: Optional[Dict[str, Any]],
) -> Dict[str, Optional[Any]]:
    """Achata run_kpis.track_b_result nas colunas do catálogo.

    Todas as colunas de Track B começam None; só o subconjunto correspondente ao
    track_b_attack_type é preenchido. Campo ausente dentro do jsonb (jsonb
    parcial) permanece None, sem exceção. jsonb None => tudo None.
    """
    row: Dict[str, Optional[Any]] = {col: None for col in _ALL_TRACK_B_COLUMNS}

    field_map = TRACK_B_FIELD_MAP.get(track_b_attack_type or "")
    if field_map is None or not isinstance(track_b_result, dict):
        return row

    for csv_col, jsonb_field in field_map:
        row[csv_col] = track_b_result.get(jsonb_field)
    return row


# --------------------------------------------------------------------------- #
# Derivação de degradação/recuperação (lógica pura, testável)
# --------------------------------------------------------------------------- #

def derive_broker_health(
    transitions: List[Dict[str, Any]],
    attack_started_at: Optional[datetime],
    attack_finished_at: Optional[datetime],
) -> Dict[str, Optional[Any]]:
    """Deriva time_to_degradation_ms / recovery_time_ms + flags.

    `transitions` é a série ordenada por _time crescente de
    container_status_transitions.flux — lista de dicts {"time": datetime,
    "status": str}. A janela de observação já vem limitada pela query a
    [attack_started_at, attack_finished_at + margem].

    Só se aplica a runs de Track B (com janela de ataque). Fora disso, todos os
    KPIs derivados são None — distinguindo "não se aplica" de "sobreviveu".

    Regras (spec "Regra de derivação"):
      - Degradação: primeira transição running -> estado não-saudável, com
        _time <= attack_finished_at. Sem degradação => broker_survived=True.
      - Recuperação: só quando houve degradação. Primeira volta a `running` que
        se sustente até o fim da janela observada (nenhum estado não-saudável
        depois). Sem recuperação => recovered=False.
    """
    empty = {
        "time_to_degradation_ms": None,
        "broker_survived": None,
        "recovery_time_ms": None,
        "recovered": None,
    }

    if attack_started_at is None or attack_finished_at is None:
        # Run de Track A (ou sem janela de ataque): derivação não se aplica.
        return dict(empty)

    # Ordena defensivamente (a query já ordena, mas não confiamos cegamente).
    series = sorted(
        (t for t in transitions if t.get("time") is not None),
        key=lambda t: t["time"],
    )

    if not series:
        # Sem série de container_status: não dá para afirmar sobrevivência.
        return dict(empty)

    # --- Degradação -------------------------------------------------------- #
    degradation_idx: Optional[int] = None
    prev_status: Optional[str] = None
    for i, point in enumerate(series):
        status = point.get("status")
        if (
            status in UNHEALTHY_STATUSES
            and prev_status == HEALTHY_STATUS
            and point["time"] <= attack_finished_at
        ):
            degradation_idx = i
            break
        prev_status = status

    if degradation_idx is None:
        # Nunca saiu de running dentro da janela do ataque: resultado válido.
        return {
            "time_to_degradation_ms": None,
            "broker_survived": True,
            "recovery_time_ms": None,
            "recovered": None,
        }

    t_degradation = series[degradation_idx]["time"]
    time_to_degradation_ms = _delta_ms(attack_started_at, t_degradation)

    # --- Recuperação ------------------------------------------------------- #
    # Primeira volta a `running` que se sustente até o fim da janela observada
    # (nenhum estado não-saudável em nenhum ponto posterior da série).
    recovery_time_ms: Optional[int] = None
    recovered = False
    for i in range(degradation_idx + 1, len(series)):
        if series[i].get("status") != HEALTHY_STATUS:
            continue
        later_unhealthy = any(
            series[j].get("status") in UNHEALTHY_STATUSES
            for j in range(i + 1, len(series))
        )
        if not later_unhealthy:
            recovery_time_ms = _delta_ms(t_degradation, series[i]["time"])
            recovered = True
            break

    return {
        "time_to_degradation_ms": time_to_degradation_ms,
        "broker_survived": False,
        "recovery_time_ms": recovery_time_ms,
        "recovered": recovered,
    }


def _delta_ms(start: datetime, end: datetime) -> int:
    """Diferença end-start em milissegundos inteiros (arredondados)."""
    return int(round((end - start).total_seconds() * 1000))


# --------------------------------------------------------------------------- #
# Carregamento de blocos Flux (.flux versionados)
# --------------------------------------------------------------------------- #

_FLUX_CODE_RE = re.compile(r"^\s*(from\(|\|>)")


def load_flux_block(flux_path: Path, block_id: str) -> str:
    """Extrai o pipeline Flux de um bloco `// >>> BLOCK: <id>` de um .flux.

    Os arquivos .flux têm vários blocos; só o primeiro fica ativo (executável),
    os demais ficam comentados com prefixo `// `. Esta função localiza o bloco
    pelo marcador e devolve apenas as LINHAS DE CÓDIGO Flux (from(...)/|> ...),
    removendo um nível de comentário quando presente e descartando as linhas de
    prosa/documentação — funcionando igual para o bloco ativo e os comentados.
    """
    text = flux_path.read_text(encoding="utf-8")
    start_marker = f">>> BLOCK: {block_id}"
    end_marker = f"<<< END BLOCK: {block_id}"

    lines = text.splitlines()
    inside = False
    code_lines: List[str] = []
    found = False
    for line in lines:
        if start_marker in line:
            inside = True
            found = True
            continue
        if end_marker in line:
            inside = False
            continue
        if not inside:
            continue
        # Remove um único nível de comentário (`// `) para inspecionar/reativar.
        content = re.sub(r"^(\s*)//\s?", r"\1", line)
        if _FLUX_CODE_RE.match(content):
            code_lines.append(content)

    if not found:
        raise AnalysisError(
            f"bloco Flux '{block_id}' não encontrado em {flux_path.name}"
        )
    if not code_lines:
        raise AnalysisError(
            f"bloco Flux '{block_id}' em {flux_path.name} não tem linhas de código"
        )
    return "\n".join(code_lines)


def render_flux(
    template: str,
    *,
    bucket: str,
    run_id: str,
    broker: str,
    start: Optional[str] = None,
    stop: Optional[str] = None,
) -> str:
    """Substitui os placeholders de um bloco Flux, validando antes de compor.

    run_id/broker/start/stop são validados aqui (guard anti-injeção) porque a
    substituição em Flux é composição de string pura.
    """
    assert_safe_run_id(run_id)
    assert_safe_broker(broker)
    rendered = template.replace("__BUCKET__", bucket)
    rendered = rendered.replace("__RUN_ID__", run_id)
    rendered = rendered.replace("__BROKER__", broker)
    if "__START__" in rendered:
        if start is None:
            raise AnalysisError("__START__ presente mas nenhum 'start' fornecido")
        assert_safe_flux_time(start)
        rendered = rendered.replace("__START__", start)
    if "__STOP__" in rendered:
        if stop is None:
            raise AnalysisError("__STOP__ presente mas nenhum 'stop' fornecido")
        assert_safe_flux_time(stop)
        rendered = rendered.replace("__STOP__", stop)
    return rendered


# --------------------------------------------------------------------------- #
# Serialização de valores para o CSV (lógica pura, testável)
# --------------------------------------------------------------------------- #

def to_csv_value(value: Any) -> str:
    """Converte um valor Python para célula CSV.

    None -> "" (célula vazia = não se aplica / nulo). bool -> "true"/"false"
    (minúsculas, para nunca confundir um false medido com nulo). datetime ->
    ISO 8601. dict/list -> JSON compacto. Demais -> str().
    """
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value)


def build_csv_row(record: Dict[str, Any]) -> List[str]:
    """Projeta um dict de KPIs na ordem exata de CSV_COLUMNS (célula por célula)."""
    return [to_csv_value(record.get(col)) for col in CSV_COLUMNS]


# --------------------------------------------------------------------------- #
# Utilidades de tempo
# --------------------------------------------------------------------------- #

def _as_datetime(value: Any) -> Optional[datetime]:
    """Normaliza timestamptz do Postgres / string ISO para datetime tz-aware."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return None


def _to_rfc3339(dt: datetime) -> str:
    """datetime -> RFC3339 UTC com sufixo Z (literal aceito por __START__)."""
    return (
        dt.astimezone(timezone.utc)
        .replace(microsecond=0)
        .strftime("%Y-%m-%dT%H:%M:%SZ")
    )


def parse_duration_seconds(text: str) -> float:
    """Converte uma duração estilo Go/Telegraf ('5s', '250ms', '2m') em segundos."""
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(ns|us|ms|s|m|h)?\s*", text)
    if not match:
        raise ValueError(f"duração inválida: {text!r}")
    value = float(match.group(1))
    unit = match.group(2) or "s"
    factor = {
        "ns": 1e-9,
        "us": 1e-6,
        "ms": 1e-3,
        "s": 1.0,
        "m": 60.0,
        "h": 3600.0,
    }[unit]
    return value * factor


# --------------------------------------------------------------------------- #
# I/O: Postgres (import preguiçoso de psycopg2)
# --------------------------------------------------------------------------- #

def _pg_connect():
    try:
        import psycopg2  # type: ignore
        import psycopg2.extras  # type: ignore
    except ImportError as exc:  # pragma: no cover - depende do ambiente
        raise AnalysisError(
            "psycopg2 não instalado. Rode: pip install -r scripts/requirements.txt"
        ) from exc

    host = os.environ.get("POSTGRES_HOST", "localhost")
    port = int(os.environ.get("POSTGRES_PORT", "5432"))
    user = os.environ.get("POSTGRES_USER", "stressbed")
    password = os.environ.get("POSTGRES_PASSWORD", "")
    dbname = os.environ.get("POSTGRES_DB", "stressbed")
    try:
        return psycopg2.connect(
            host=host,
            port=port,
            user=user,
            password=password,
            dbname=dbname,
        )
    except Exception as exc:
        raise AnalysisError(
            f"falha ao conectar no Postgres em {host}:{port}/{dbname}: {exc}"
        ) from exc


_RUNS_SELECT = """
    SELECT
        er.id               AS run_id,
        er.mode             AS mode,
        er.attack_type      AS attack_type,
        er.params           AS params,
        er.started_at       AS started_at,
        er.ended_at         AS ended_at,
        er.notes            AS notes,
        k.interception_coverage_pct,
        k.entropy_bits,
        k.payload_readability_classification,
        k.injection_success_rate_pct,
        k.injection_connect_status,
        k.time_to_first_capture_ms,
        k.track_b_attack_type,
        k.attack_started_at  AS track_b_attack_started_at,
        k.attack_finished_at AS track_b_attack_finished_at,
        k.track_b_result     AS track_b_result
    FROM experiment_runs er
    LEFT JOIN run_kpis k ON k.run_id = er.id
"""


def fetch_runs(conn, run_id: Optional[str]) -> List[Dict[str, Any]]:
    """Lê experiment_runs (LEFT JOIN run_kpis). run_id None => todas as runs."""
    import psycopg2.extras  # type: ignore

    sql = _RUNS_SELECT
    params: Tuple[Any, ...] = ()
    if run_id is not None:
        sql += " WHERE er.id = %s"
        params = (run_id,)
    sql += " ORDER BY er.started_at ASC"

    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]
    except Exception as exc:
        raise AnalysisError(f"falha ao consultar o Postgres: {exc}") from exc


# --------------------------------------------------------------------------- #
# I/O: InfluxDB (import preguiçoso de influxdb-client)
# --------------------------------------------------------------------------- #

class InfluxReader:
    """Encapsula as queries Flux de broker_metrics/telemetry por run."""

    def __init__(self, client, bucket: str):
        self._query_api = client.query_api()
        self._bucket = bucket
        self._broker_flux = FLUX_DIR / "broker_metrics_by_run.flux"
        self._telemetry_flux = FLUX_DIR / "telemetry_by_run.flux"
        self._transitions_flux = FLUX_DIR / "container_status_transitions.flux"

    def _run(self, flux: str) -> List[Dict[str, Any]]:
        try:
            tables = self._query_api.query(flux)
        except Exception as exc:
            raise AnalysisError(f"falha ao executar query Flux: {exc}") from exc
        rows: List[Dict[str, Any]] = []
        for table in tables:
            for record in table.records:
                rows.append(dict(record.values))
        return rows

    def broker_metrics(
        self, run_id: str, broker: str, start: str, stop: str
    ) -> Dict[str, Optional[Any]]:
        result: Dict[str, Optional[Any]] = {
            "cpu_usage_percent_avg": None,
            "mem_usage_bytes_avg": None,
            "mem_limit_bytes": None,
            "net_rx_bytes_per_s_avg": None,
            "net_tx_bytes_per_s_avg": None,
            "restart_count": None,
        }

        def scalar(block_id: str) -> Optional[Any]:
            flux = render_flux(
                load_flux_block(self._broker_flux, block_id),
                bucket=self._bucket,
                run_id=run_id,
                broker=broker,
                start=start,
                stop=stop,
            )
            rows = self._run(flux)
            return rows[0].get("_value") if rows else None

        result["cpu_usage_percent_avg"] = scalar("cpu_mean")
        result["mem_usage_bytes_avg"] = scalar("mem_usage_mean")
        result["mem_limit_bytes"] = scalar("mem_limit_last")

        net_flux = render_flux(
            load_flux_block(self._broker_flux, "net_rate_mean"),
            bucket=self._bucket,
            run_id=run_id,
            broker=broker,
            start=start,
            stop=stop,
        )
        for row in self._run(net_flux):
            if row.get("_field") == "rx_bytes":
                result["net_rx_bytes_per_s_avg"] = row.get("_value")
            elif row.get("_field") == "tx_bytes":
                result["net_tx_bytes_per_s_avg"] = row.get("_value")

        restart_flux = render_flux(
            load_flux_block(self._broker_flux, "restart_count_last"),
            bucket=self._bucket,
            run_id=run_id,
            broker=broker,
            start=start,
            stop=stop,
        )
        restart_rows = self._run(restart_flux)
        if restart_rows:
            row = restart_rows[0]
            result["restart_count"] = row.get("restart_count", row.get("_value"))
        return result

    def telemetry(self, run_id: str, broker: str) -> Dict[str, Optional[Any]]:
        count_flux = render_flux(
            load_flux_block(self._telemetry_flux, "count_captured_points"),
            bucket=self._bucket,
            run_id=run_id,
            broker=broker,
        )
        count_rows = self._run(count_flux)
        # count() devolve uma linha por série remanescente: somar (igual TS).
        total = sum(int(r.get("_value") or 0) for r in count_rows)

        first_flux = render_flux(
            load_flux_block(self._telemetry_flux, "first_point_timestamp"),
            bucket=self._bucket,
            run_id=run_id,
            broker=broker,
        )
        first_rows = self._run(first_flux)
        first_at = first_rows[0].get("_time") if first_rows else None

        return {
            "telemetry_captured_count": total if count_rows else None,
            "first_capture_at": _as_datetime(first_at),
        }

    def container_transitions(
        self, run_id: str, broker: str, start: str, stop: str
    ) -> List[Dict[str, Any]]:
        flux = render_flux(
            load_flux_block(self._transitions_flux, "container_status_series"),
            bucket=self._bucket,
            run_id=run_id,
            broker=broker,
            start=start,
            stop=stop,
        )
        transitions: List[Dict[str, Any]] = []
        for row in self._run(flux):
            transitions.append(
                {
                    "time": _as_datetime(row.get("_time")),
                    "status": row.get("container_status"),
                }
            )
        return transitions


def _influx_connect():
    try:
        from influxdb_client import InfluxDBClient  # type: ignore
    except ImportError as exc:  # pragma: no cover - depende do ambiente
        raise AnalysisError(
            "influxdb-client não instalado. Rode: "
            "pip install -r scripts/requirements.txt"
        ) from exc

    url = os.environ.get("INFLUXDB_URL", "http://localhost:8086")
    token = os.environ.get("INFLUXDB_TOKEN", "")
    org = os.environ.get("INFLUXDB_ORG", "stressbed")
    if not token:
        raise AnalysisError("INFLUXDB_TOKEN não definido no ambiente")
    try:
        return InfluxDBClient(url=url, token=token, org=org)
    except Exception as exc:
        raise AnalysisError(
            f"falha ao conectar no InfluxDB em {url}: {exc}"
        ) from exc


# --------------------------------------------------------------------------- #
# Montagem da linha de uma run
# --------------------------------------------------------------------------- #

def build_run_record(
    run_row: Dict[str, Any],
    influx: "InfluxReader",
    *,
    bucket: str,
    recovery_read_margin_seconds: float,
) -> Dict[str, Any]:
    """Reúne Postgres + InfluxDB numa única linha de KPIs para uma run."""
    run_id = str(run_row["run_id"])
    mode = run_row["mode"]

    record: Dict[str, Any] = {
        "run_id": run_id,
        "mode": mode,
        "attack_type": run_row.get("attack_type"),
        "params": canonical_json_params(run_row.get("params")),
        "started_at": _as_datetime(run_row.get("started_at")),
        "ended_at": _as_datetime(run_row.get("ended_at")),
        "notes": run_row.get("notes"),
        "interception_coverage_pct": run_row.get("interception_coverage_pct"),
        "entropy_bits": run_row.get("entropy_bits"),
        "payload_readability_classification": run_row.get(
            "payload_readability_classification"
        ),
        "injection_success_rate_pct": run_row.get("injection_success_rate_pct"),
        "injection_connect_status": run_row.get("injection_connect_status"),
        "time_to_first_capture_ms": run_row.get("time_to_first_capture_ms"),
        "track_b_attack_type": run_row.get("track_b_attack_type"),
        "track_b_attack_started_at": _as_datetime(
            run_row.get("track_b_attack_started_at")
        ),
        "track_b_attack_finished_at": _as_datetime(
            run_row.get("track_b_attack_finished_at")
        ),
    }

    record.update(
        flatten_track_b_result(
            run_row.get("track_b_attack_type"),
            run_row.get("track_b_result"),
        )
    )

    # Janela para as métricas de recurso: janela do ataque (Track B) ou
    # [started_at, ended_at] fora de Track B (spec, catálogo de KPIs).
    attack_start = record["track_b_attack_started_at"]
    attack_finish = record["track_b_attack_finished_at"]
    window_start_dt = attack_start or record["started_at"]
    window_stop_dt = attack_finish or record["ended_at"] or datetime.now(timezone.utc)

    if window_start_dt is not None:
        start_lit = _to_rfc3339(window_start_dt)
        stop_lit = _to_rfc3339(window_stop_dt)
        record.update(
            influx.broker_metrics(run_id, mode, start_lit, stop_lit)
        )
    else:
        record.update(
            {
                "cpu_usage_percent_avg": None,
                "mem_usage_bytes_avg": None,
                "mem_limit_bytes": None,
                "net_rx_bytes_per_s_avg": None,
                "net_tx_bytes_per_s_avg": None,
                "restart_count": None,
            }
        )

    # Derivação de degradação/recuperação: só runs de Track B (janela de ataque).
    if attack_start is not None and attack_finish is not None:
        from datetime import timedelta

        margin_stop = attack_finish + timedelta(seconds=recovery_read_margin_seconds)
        transitions = influx.container_transitions(
            run_id,
            mode,
            _to_rfc3339(attack_start),
            _to_rfc3339(margin_stop),
        )
        record.update(
            derive_broker_health(transitions, attack_start, attack_finish)
        )
    else:
        record.update(
            {
                "time_to_degradation_ms": None,
                "broker_survived": None,
                "recovery_time_ms": None,
                "recovered": None,
            }
        )

    record.update(influx.telemetry(run_id, mode))
    return record


# --------------------------------------------------------------------------- #
# Escrita do CSV
# --------------------------------------------------------------------------- #

def write_csv(records: List[Dict[str, Any]], out_path: Path) -> None:
    import csv

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(CSV_COLUMNS)
        for record in records:
            writer.writerow(build_csv_row(record))


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Exporta out/run_metrics.csv (uma linha por run_id) com os KPIs de "
            "Track A e Track B (Fase 5, Entregável 1)."
        )
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--run-id",
        default=None,
        help="UUID de uma única run a exportar.",
    )
    group.add_argument(
        "--all",
        action="store_true",
        help="Exporta todas as runs de experiment_runs.",
    )
    parser.add_argument(
        "--recovery-read-margin-seconds",
        type=float,
        default=None,
        help=(
            "Margem de leitura pós-attack_finished_at para procurar a recuperação "
            "do broker (default: 3x TELEGRAF_INTERVAL, ou 15s se ausente). "
            "Parâmetro nomeado — não é número mágico."
        ),
    )
    parser.add_argument(
        "--output",
        default=str(OUT_CSV),
        help=f"Caminho do CSV de saída (default: {OUT_CSV}).",
    )
    return parser


def _default_recovery_margin() -> float:
    raw = os.environ.get("TELEGRAF_INTERVAL", "5s")
    try:
        return 3.0 * parse_duration_seconds(raw)
    except ValueError:
        return 15.0


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)

    if args.run_id is not None:
        try:
            assert_safe_run_id(args.run_id)
        except ValueError as exc:
            print(f"erro: {exc}", file=sys.stderr)
            return 2

    margin = args.recovery_read_margin_seconds
    if margin is None:
        margin = _default_recovery_margin()

    bucket = os.environ.get("INFLUXDB_BUCKET", "stressbed")
    out_path = Path(args.output)

    pg_conn = None
    influx_client = None
    try:
        pg_conn = _pg_connect()
        runs = fetch_runs(pg_conn, args.run_id)
        if not runs:
            target = args.run_id if args.run_id else "experiment_runs"
            print(f"erro: nenhuma run encontrada ({target})", file=sys.stderr)
            return 1

        influx_client = _influx_connect()
        reader = InfluxReader(influx_client, bucket)

        records: List[Dict[str, Any]] = []
        for run_row in runs:
            records.append(
                build_run_record(
                    run_row,
                    reader,
                    bucket=bucket,
                    recovery_read_margin_seconds=margin,
                )
            )

        write_csv(records, out_path)
    except AnalysisError as exc:
        print(f"erro: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # rede/driver inesperado: sem stack trace bruto
        print(f"erro inesperado: {exc}", file=sys.stderr)
        return 1
    finally:
        if influx_client is not None:
            try:
                influx_client.close()
            except Exception:
                pass
        if pg_conn is not None:
            try:
                pg_conn.close()
            except Exception:
                pass

    print(
        f"[export_run_metrics] {len(records)} run(s) exportada(s) para {out_path}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
