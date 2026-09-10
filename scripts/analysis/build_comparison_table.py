#!/usr/bin/env python3
"""Constrói a tabela comparativa plain vs secure — Fase 5, Entregável 3
(docs/specs/data-analysis.md, seções "Schema de saída — Entregável 3",
"Regra de pareamento plain vs secure" e "Casos de Borda").

CONSOME a saída do Entregável 1 (`out/run_metrics.csv`, produzido por
export_run_metrics.py) — NÃO refaz a extração de KPIs nem conecta em
Postgres/InfluxDB. Lê o CSV wide (uma linha por run_id), agrupa as runs por
cenário, pareia o modo `plain` com o `secure` do mesmo cenário e calcula, para
cada KPI comparável, os valores lado a lado (`_plain`/`_secure`), o delta
(`secure - plain`) e uma flag `_changed`.

Produz dois arquivos em `out/` (configurável via --output-dir):
  - `out/comparison_table.csv`  — tabela wide, uma linha por cenário.
  - `out/comparison_table.md`   — a mesma tabela em Markdown, pronta para colar
                                  em documento externo.

Chave de cenário = (attack_type/flow_type, params_normalizado). O
`params_normalizado` reusa `canonical_json_params` de export_run_metrics.py
(canonicalização única compartilhada — spec: "não reimplementar duas vezes"),
de modo que duas runs com os mesmos parâmetros lógicos caiam no mesmo cenário
independentemente da ordem dos campos no jsonb.

Havendo múltiplas runs do mesmo (cenário, modo), vence a mais recente por
`started_at` (decisão já tomada na spec).

Convenção de nulos: célula vazia = não computável / não se aplica (nunca `0`).
Quando `pairing_status != paired`, o lado ausente e os respectivos
`_delta`/`_changed` ficam vazios.
"""

import argparse
import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Reusa a ÚNICA função de canonicalização de params (spec: não reimplementar
# duas vezes). export_run_metrics.py está no mesmo diretório; os testes já
# inserem esse diretório no sys.path (conftest.py) e o próprio módulo resolve
# ao ser rodado a partir de scripts/analysis/.
try:
    from export_run_metrics import canonical_json_params
except ImportError:  # rodando de outro cwd: garante o diretório no sys.path
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from export_run_metrics import canonical_json_params

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = REPO_ROOT / "out"
DEFAULT_INPUT = OUT_DIR / "run_metrics.csv"

VALID_MODES = ("plain", "secure")

# Colunas do CSV wide que são metadados de run / chave de cenário / timestamps
# absolutos — NÃO entram na comparação de KPIs. `attack_type` e `params` viram
# a chave de cenário; os timestamps absolutos (started_at, *_at) não fazem
# sentido comparar entre runs distintas.
METADATA_COLUMNS = frozenset(
    {
        "run_id",
        "mode",
        "attack_type",
        "params",
        "started_at",
        "ended_at",
        "notes",
        "track_b_attack_type",
        "track_b_attack_started_at",
        "track_b_attack_finished_at",
        "first_capture_at",
    }
)

# KPIs não-numéricos (categóricos/booleanos): só `_plain`/`_secure`/`_changed`
# (igualdade), sem `_delta` (spec).
CATEGORICAL_KPIS = frozenset(
    {
        "payload_readability_classification",
        "injection_connect_status",
        "malformed_mode",
        "malformed_broker_response_summary",
        "malformed_disconnected_after_publish",
        "broker_survived",
        "recovered",
    }
)

# Colunas mínimas que o CSV de entrada precisa ter para ser interpretável.
REQUIRED_INPUT_COLUMNS = ("run_id", "mode", "attack_type", "params", "started_at")

# Ordem canônica das colunas do CSV wide do Entregável 1. Importada de
# export_run_metrics para manter a ordem/catálogo em sincronia sem duplicar.
try:
    from export_run_metrics import CSV_COLUMNS as _WIDE_COLUMNS
except ImportError:  # pragma: no cover - só se o módulo mudar de forma
    _WIDE_COLUMNS = ()


class ComparisonError(Exception):
    """Erro reportável ao usuário (mensagem limpa, sem stack trace bruto)."""


# --------------------------------------------------------------------------- #
# Catálogo de KPIs a comparar (derivado da ordem canônica do CSV wide)
# --------------------------------------------------------------------------- #

def _ordered_kpis() -> List[Tuple[str, bool]]:
    """Lista (nome_kpi, is_numeric) na ordem do catálogo, sem os metadados."""
    kpis: List[Tuple[str, bool]] = []
    for col in _WIDE_COLUMNS:
        if col in METADATA_COLUMNS:
            continue
        kpis.append((col, col not in CATEGORICAL_KPIS))
    return kpis


ORDERED_KPIS: List[Tuple[str, bool]] = _ordered_kpis()


def output_columns() -> List[str]:
    """Ordem exata das colunas da tabela comparativa (CSV e Markdown)."""
    cols = [
        "attack_type",
        "params_normalized",
        "pairing_status",
        "run_id_plain",
        "run_id_secure",
    ]
    for kpi, is_numeric in ORDERED_KPIS:
        cols.append(f"{kpi}_plain")
        cols.append(f"{kpi}_secure")
        if is_numeric:
            cols.append(f"{kpi}_delta")
        cols.append(f"{kpi}_changed")
    return cols


OUTPUT_COLUMNS: List[str] = output_columns()


# --------------------------------------------------------------------------- #
# Normalização / parsing (lógica pura, testável)
# --------------------------------------------------------------------------- #

def normalize_params(raw: Optional[str]) -> str:
    """Normaliza a célula `params` do CSV numa chave determinística.

    A célula já vem canonicalizada por export_run_metrics.py, mas reaplicamos
    canonical_json_params para robustez (mesma técnica única). Retorna "" quando
    não há params. Se a célula não for JSON válido, cai para o texto cru (ainda
    determinístico como chave).
    """
    if raw is None:
        return ""
    text = raw.strip()
    if text == "":
        return ""
    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return text
    canonical = canonical_json_params(parsed)
    return canonical if canonical is not None else ""


def parse_number(raw: Optional[str]) -> Optional[float]:
    """Converte uma célula em float; None/""/inparseável -> None."""
    if raw is None:
        return None
    text = raw.strip()
    if text == "":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_started_at(raw: Optional[str]) -> datetime:
    """Parseia started_at (ISO 8601) tz-aware; ausente/inválido -> datetime mínimo."""
    floor = datetime.min.replace(tzinfo=timezone.utc)
    if raw is None:
        return floor
    text = raw.strip()
    if text == "":
        return floor
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return floor
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _fmt_number(value: Optional[float]) -> str:
    """Formata um número para célula, matando ruído de ponto flutuante.

    Arredonda a 6 casas (o `_changed` usa 1 casa; 6 é só para o display do
    delta) e mostra inteiros sem `.0`.
    """
    if value is None:
        return ""
    rounded = round(value, 6)
    if rounded == int(rounded):
        return str(int(rounded))
    return repr(rounded)


# --------------------------------------------------------------------------- #
# Chave de cenário / agrupamento / pareamento (lógica pura, testável)
# --------------------------------------------------------------------------- #

def scenario_key(row: Dict[str, str]) -> Tuple[str, str]:
    """(attack_type/flow_type, params_normalizado) — chave de cenário."""
    attack_type = (row.get("attack_type") or "").strip()
    return (attack_type, normalize_params(row.get("params")))


def _recency(row: Dict[str, str]) -> Tuple[datetime, str]:
    """Chave de ordenação para "mais recente vence" (desempate por run_id)."""
    return (parse_started_at(row.get("started_at")), str(row.get("run_id") or ""))


def group_runs(rows: List[Dict[str, str]]) -> Dict[Tuple[str, str], Dict[str, Dict[str, str]]]:
    """Agrupa por cenário -> {modo: run_mais_recente}.

    Runs com `mode` fora de (plain, secure) são ignoradas. Para cada
    (cenário, modo) com múltiplas runs, mantém a mais recente por started_at.
    """
    grouped: Dict[Tuple[str, str], Dict[str, Dict[str, str]]] = {}
    for row in rows:
        mode = (row.get("mode") or "").strip()
        if mode not in VALID_MODES:
            continue
        key = scenario_key(row)
        bucket = grouped.setdefault(key, {})
        existing = bucket.get(mode)
        if existing is None or _recency(row) > _recency(existing):
            bucket[mode] = row
    return grouped


def _cell(row: Optional[Dict[str, str]], kpi: str) -> Optional[str]:
    """Valor cru de um KPI para um lado (None quando o lado não existe)."""
    if row is None:
        return None
    return row.get(kpi)


def _is_null_cell(raw: Optional[str]) -> bool:
    return raw is None or raw.strip() == ""


def build_comparison_record(
    key: Tuple[str, str],
    bucket: Dict[str, Dict[str, str]],
) -> Dict[str, str]:
    """Monta a linha de saída (célula por célula, já como string) de um cenário."""
    plain_row = bucket.get("plain")
    secure_row = bucket.get("secure")

    if plain_row is not None and secure_row is not None:
        status = "paired"
    elif plain_row is not None:
        status = "plain-only"
    else:
        status = "secure-only"

    record: Dict[str, str] = {
        "attack_type": key[0],
        "params_normalized": key[1],
        "pairing_status": status,
        "run_id_plain": (plain_row or {}).get("run_id", "") if plain_row else "",
        "run_id_secure": (secure_row or {}).get("run_id", "") if secure_row else "",
    }

    for kpi, is_numeric in ORDERED_KPIS:
        plain_raw = _cell(plain_row, kpi)
        secure_raw = _cell(secure_row, kpi)
        record[f"{kpi}_plain"] = "" if _is_null_cell(plain_raw) else plain_raw.strip()
        record[f"{kpi}_secure"] = (
            "" if _is_null_cell(secure_raw) else secure_raw.strip()
        )

        if is_numeric:
            plain_num = parse_number(plain_raw)
            secure_num = parse_number(secure_raw)
            if plain_num is not None and secure_num is not None:
                delta = secure_num - plain_num
                record[f"{kpi}_delta"] = _fmt_number(delta)
                # `_changed`: delta != 0 após arredondar a 1 casa (evita ruído
                # de ponto flutuante).
                record[f"{kpi}_changed"] = (
                    "true" if round(delta, 1) != 0.0 else "false"
                )
            else:
                record[f"{kpi}_delta"] = ""
                record[f"{kpi}_changed"] = ""
        else:
            # Categórico: `_changed` por igualdade, só quando ambos os lados
            # existem (senão não é computável -> vazio).
            if not _is_null_cell(plain_raw) and not _is_null_cell(secure_raw):
                record[f"{kpi}_changed"] = (
                    "true" if plain_raw.strip() != secure_raw.strip() else "false"
                )
            else:
                record[f"{kpi}_changed"] = ""

    return record


def build_comparison_records(rows: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Agrupa, pareia e produz uma linha de saída por cenário (ordenada)."""
    grouped = group_runs(rows)
    records: List[Dict[str, str]] = []
    for key in sorted(grouped.keys()):
        records.append(build_comparison_record(key, grouped[key]))
    return records


# --------------------------------------------------------------------------- #
# Leitura do CSV de entrada
# --------------------------------------------------------------------------- #

def load_rows(input_path: Path) -> List[Dict[str, str]]:
    """Lê o CSV wide do Entregável 1, validando existência/estrutura."""
    if not input_path.exists():
        raise ComparisonError(
            f"CSV de entrada não encontrado: {input_path}. "
            "Rode export_run_metrics.py primeiro."
        )
    try:
        with input_path.open(encoding="utf-8", newline="") as fh:
            reader = csv.DictReader(fh)
            fieldnames = reader.fieldnames
            if not fieldnames:
                raise ComparisonError(
                    f"CSV de entrada vazio ou sem cabeçalho: {input_path}"
                )
            missing = [c for c in REQUIRED_INPUT_COLUMNS if c not in fieldnames]
            if missing:
                raise ComparisonError(
                    f"CSV de entrada malformado ({input_path}): "
                    f"colunas obrigatórias ausentes: {', '.join(missing)}"
                )
            rows = [dict(r) for r in reader]
    except ComparisonError:
        raise
    except OSError as exc:
        raise ComparisonError(f"falha ao ler {input_path}: {exc}") from exc
    except csv.Error as exc:
        raise ComparisonError(
            f"CSV de entrada malformado ({input_path}): {exc}"
        ) from exc

    if not rows:
        raise ComparisonError(
            f"CSV de entrada sem linhas de dados: {input_path}"
        )
    return rows


# --------------------------------------------------------------------------- #
# Escrita dos entregáveis (CSV + Markdown)
# --------------------------------------------------------------------------- #

def write_csv(records: List[Dict[str, str]], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(OUTPUT_COLUMNS)
        for record in records:
            writer.writerow([record.get(col, "") for col in OUTPUT_COLUMNS])


def _md_escape(cell: str) -> str:
    """Escapa o que quebraria uma célula de tabela Markdown."""
    return cell.replace("\\", "\\\\").replace("|", "\\|").replace("\n", " ")


def render_markdown(records: List[Dict[str, str]]) -> str:
    """Renderiza a tabela comparativa como tabela Markdown."""
    header = "| " + " | ".join(_md_escape(c) for c in OUTPUT_COLUMNS) + " |"
    separator = "| " + " | ".join("---" for _ in OUTPUT_COLUMNS) + " |"
    lines = [header, separator]
    for record in records:
        cells = [_md_escape(record.get(col, "")) for col in OUTPUT_COLUMNS]
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines) + "\n"


def write_markdown(records: List[Dict[str, str]], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(render_markdown(records), encoding="utf-8")


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Constrói a tabela comparativa plain vs secure (Fase 5, "
            "Entregável 3) a partir do out/run_metrics.csv."
        )
    )
    parser.add_argument(
        "--input",
        default=str(DEFAULT_INPUT),
        help=f"CSV wide de entrada (default: {DEFAULT_INPUT}).",
    )
    parser.add_argument(
        "--output-dir",
        default=str(OUT_DIR),
        help=(
            "Diretório de saída para comparison_table.csv/.md "
            f"(default: {OUT_DIR})."
        ),
    )
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)

    input_path = Path(args.input)
    output_dir = Path(args.output_dir)
    csv_out = output_dir / "comparison_table.csv"
    md_out = output_dir / "comparison_table.md"

    try:
        rows = load_rows(input_path)
        records = build_comparison_records(rows)
        if not records:
            raise ComparisonError(
                "nenhum cenário com modo plain/secure encontrado no CSV de "
                "entrada — nada a comparar."
            )
        write_csv(records, csv_out)
        write_markdown(records, md_out)
    except ComparisonError as exc:
        print(f"erro: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # inesperado: sem stack trace bruto
        print(f"erro inesperado: {exc}", file=sys.stderr)
        return 1

    print(
        f"[build_comparison_table] {len(records)} cenário(s) -> "
        f"{csv_out} e {md_out}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
