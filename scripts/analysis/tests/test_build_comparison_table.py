"""Testes unitários de build_comparison_table.py (Fase 5, Entregável 3).

Cobrem: pareamento completo, plain-only/secure-only, múltiplas runs por cenário
(mais recente vence), cálculo de delta numérico, `_changed` categórico,
arredondamento que evita ruído de ponto flutuante e geração de Markdown. Usam
CSVs sintéticos (tmp_path), sem Postgres/Influx reais — mesmo estilo/pytest de
test_export_run_metrics.py.
"""

import csv

import pytest

import build_comparison_table as bt


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

# Cabeçalho mínimo aceito; testes preenchem só as colunas relevantes.
BASE_FIELDS = list(bt._WIDE_COLUMNS) if bt._WIDE_COLUMNS else [
    "run_id",
    "mode",
    "attack_type",
    "params",
    "started_at",
]


def _row(**overrides):
    row = {field: "" for field in BASE_FIELDS}
    row.update(overrides)
    return row


def _write_csv(path, rows, fieldnames=None):
    fieldnames = fieldnames or BASE_FIELDS
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in fieldnames})
    return path


def _records_by_scenario(records):
    return {(r["attack_type"], r["params_normalized"]): r for r in records}


# --------------------------------------------------------------------------- #
# normalize_params / parse helpers
# --------------------------------------------------------------------------- #

class TestNormalizeParams:
    def test_empty_is_empty_string(self):
        assert bt.normalize_params(None) == ""
        assert bt.normalize_params("") == ""
        assert bt.normalize_params("   ") == ""

    def test_key_order_independent(self):
        a = bt.normalize_params('{"b":1,"a":2}')
        b = bt.normalize_params('{"a":2,"b":1}')
        assert a == b == '{"a":2,"b":1}'

    def test_non_json_falls_back_to_raw(self):
        assert bt.normalize_params("not-json") == "not-json"


class TestParseNumber:
    @pytest.mark.parametrize(
        "raw,expected",
        [("0", 0.0), ("10.5", 10.5), ("", None), (None, None), ("abc", None)],
    )
    def test_parse(self, raw, expected):
        assert bt.parse_number(raw) == expected

    def test_zero_is_not_none(self):
        # 0 medido != ausente.
        assert bt.parse_number("0") == 0.0


class TestFmtNumber:
    def test_integer_no_decimal(self):
        assert bt._fmt_number(100.0) == "100"

    def test_float_kept(self):
        assert bt._fmt_number(5.5) == "5.5"

    def test_none_empty(self):
        assert bt._fmt_number(None) == ""

    def test_fp_noise_rounded(self):
        # 0.1 + 0.2 - 0.3 ~ 5.55e-17 -> 0 após arredondar.
        assert bt._fmt_number(0.1 + 0.2 - 0.3) == "0"


# --------------------------------------------------------------------------- #
# Agrupamento / mais recente vence
# --------------------------------------------------------------------------- #

class TestGrouping:
    def test_scenario_key_uses_attack_type_and_params(self):
        row = _row(attack_type="connection-flood", params='{"b":1,"a":2}')
        assert bt.scenario_key(row) == ("connection-flood", '{"a":2,"b":1}')

    def test_latest_run_wins(self):
        rows = [
            _row(
                run_id="old",
                mode="plain",
                attack_type="message-flood",
                params="{}",
                started_at="2024-01-01T00:00:00+00:00",
                cpu_usage_percent_avg="10",
            ),
            _row(
                run_id="new",
                mode="plain",
                attack_type="message-flood",
                params="{}",
                started_at="2024-01-02T00:00:00+00:00",
                cpu_usage_percent_avg="99",
            ),
        ]
        grouped = bt.group_runs(rows)
        key = ("message-flood", "{}")
        assert grouped[key]["plain"]["run_id"] == "new"
        assert grouped[key]["plain"]["cpu_usage_percent_avg"] == "99"

    def test_invalid_mode_ignored(self):
        rows = [_row(run_id="a", mode="attacker", attack_type="x", params="{}")]
        assert bt.group_runs(rows) == {}


# --------------------------------------------------------------------------- #
# Pareamento
# --------------------------------------------------------------------------- #

class TestPairing:
    def test_paired(self):
        rows = [
            _row(run_id="p", mode="plain", attack_type="cf", params="{}",
                 cpu_usage_percent_avg="10"),
            _row(run_id="s", mode="secure", attack_type="cf", params="{}",
                 cpu_usage_percent_avg="15"),
        ]
        rec = _records_by_scenario(bt.build_comparison_records(rows))[("cf", "{}")]
        assert rec["pairing_status"] == "paired"
        assert rec["run_id_plain"] == "p"
        assert rec["run_id_secure"] == "s"

    def test_plain_only(self):
        rows = [_row(run_id="p", mode="plain", attack_type="cf", params="{}",
                     cpu_usage_percent_avg="10")]
        rec = bt.build_comparison_records(rows)[0]
        assert rec["pairing_status"] == "plain-only"
        assert rec["run_id_plain"] == "p"
        assert rec["run_id_secure"] == ""
        # Lado ausente e delta/changed ficam vazios (não computáveis).
        assert rec["cpu_usage_percent_avg_secure"] == ""
        assert rec["cpu_usage_percent_avg_delta"] == ""
        assert rec["cpu_usage_percent_avg_changed"] == ""
        # Lado presente preservado.
        assert rec["cpu_usage_percent_avg_plain"] == "10"

    def test_secure_only(self):
        rows = [_row(run_id="s", mode="secure", attack_type="cf", params="{}",
                     cpu_usage_percent_avg="15")]
        rec = bt.build_comparison_records(rows)[0]
        assert rec["pairing_status"] == "secure-only"
        assert rec["run_id_plain"] == ""
        assert rec["run_id_secure"] == "s"
        assert rec["cpu_usage_percent_avg_plain"] == ""
        assert rec["cpu_usage_percent_avg_delta"] == ""
        assert rec["cpu_usage_percent_avg_changed"] == ""

    def test_distinct_params_are_distinct_scenarios(self):
        rows = [
            _row(run_id="p1", mode="plain", attack_type="cf", params='{"n":1}'),
            _row(run_id="s2", mode="secure", attack_type="cf", params='{"n":2}'),
        ]
        records = bt.build_comparison_records(rows)
        assert len(records) == 2
        for rec in records:
            assert rec["pairing_status"] in ("plain-only", "secure-only")


# --------------------------------------------------------------------------- #
# Delta numérico
# --------------------------------------------------------------------------- #

class TestNumericDelta:
    def _pair(self, plain_val, secure_val, kpi="cpu_usage_percent_avg"):
        rows = [
            _row(run_id="p", mode="plain", attack_type="cf", params="{}",
                 **{kpi: plain_val}),
            _row(run_id="s", mode="secure", attack_type="cf", params="{}",
                 **{kpi: secure_val}),
        ]
        return bt.build_comparison_records(rows)[0]

    def test_delta_secure_minus_plain(self):
        rec = self._pair("10", "15.5")
        assert rec["cpu_usage_percent_avg_plain"] == "10"
        assert rec["cpu_usage_percent_avg_secure"] == "15.5"
        assert rec["cpu_usage_percent_avg_delta"] == "5.5"
        assert rec["cpu_usage_percent_avg_changed"] == "true"

    def test_negative_delta(self):
        rec = self._pair("20", "5")
        assert rec["cpu_usage_percent_avg_delta"] == "-15"
        assert rec["cpu_usage_percent_avg_changed"] == "true"

    def test_zero_delta_not_changed(self):
        rec = self._pair("10", "10")
        assert rec["cpu_usage_percent_avg_delta"] == "0"
        assert rec["cpu_usage_percent_avg_changed"] == "false"

    def test_fp_noise_below_one_decimal_not_changed(self):
        # delta = 0.03 -> arredondado a 1 casa = 0.0 -> not changed.
        rec = self._pair("10.02", "10.05")
        assert rec["cpu_usage_percent_avg_delta"] == "0.03"
        assert rec["cpu_usage_percent_avg_changed"] == "false"

    def test_delta_at_one_decimal_boundary_is_changed(self):
        rec = self._pair("10.0", "10.1")
        assert rec["cpu_usage_percent_avg_changed"] == "true"

    def test_missing_one_side_delta_null(self):
        # KPI de Track A presente só no plain (secure sem valor) -> não computável.
        rec = self._pair("10", "")
        assert rec["cpu_usage_percent_avg_plain"] == "10"
        assert rec["cpu_usage_percent_avg_secure"] == ""
        assert rec["cpu_usage_percent_avg_delta"] == ""
        assert rec["cpu_usage_percent_avg_changed"] == ""


# --------------------------------------------------------------------------- #
# Categórico (igualdade, sem delta)
# --------------------------------------------------------------------------- #

class TestCategorical:
    def _pair(self, plain_val, secure_val, kpi="payload_readability_classification"):
        rows = [
            _row(run_id="p", mode="plain", attack_type="interception", params="{}",
                 **{kpi: plain_val}),
            _row(run_id="s", mode="secure", attack_type="interception", params="{}",
                 **{kpi: secure_val}),
        ]
        return bt.build_comparison_records(rows)[0]

    def test_no_delta_column_exists(self):
        assert "payload_readability_classification_delta" not in bt.OUTPUT_COLUMNS

    def test_changed_when_different(self):
        rec = self._pair("legivel", "ciphertext")
        assert rec["payload_readability_classification_plain"] == "legivel"
        assert rec["payload_readability_classification_secure"] == "ciphertext"
        assert rec["payload_readability_classification_changed"] == "true"

    def test_not_changed_when_equal(self):
        rec = self._pair("ciphertext", "ciphertext")
        assert rec["payload_readability_classification_changed"] == "false"

    def test_boolean_kpi_equality(self):
        rec = self._pair("true", "false", kpi="broker_survived")
        assert rec["broker_survived_changed"] == "true"

    def test_missing_side_changed_null(self):
        rec = self._pair("legivel", "")
        assert rec["payload_readability_classification_changed"] == ""


# --------------------------------------------------------------------------- #
# Leitura de CSV / erros
# --------------------------------------------------------------------------- #

class TestLoadRows:
    def test_missing_file_raises(self, tmp_path):
        with pytest.raises(bt.ComparisonError):
            bt.load_rows(tmp_path / "nope.csv")

    def test_empty_file_raises(self, tmp_path):
        path = tmp_path / "empty.csv"
        path.write_text("", encoding="utf-8")
        with pytest.raises(bt.ComparisonError):
            bt.load_rows(path)

    def test_missing_required_columns_raises(self, tmp_path):
        path = tmp_path / "bad.csv"
        path.write_text("foo,bar\n1,2\n", encoding="utf-8")
        with pytest.raises(bt.ComparisonError):
            bt.load_rows(path)

    def test_header_only_no_data_raises(self, tmp_path):
        path = tmp_path / "headeronly.csv"
        _write_csv(path, [])
        with pytest.raises(bt.ComparisonError):
            bt.load_rows(path)

    def test_valid_roundtrip(self, tmp_path):
        path = _write_csv(
            tmp_path / "ok.csv",
            [_row(run_id="p", mode="plain", attack_type="cf", params="{}")],
        )
        rows = bt.load_rows(path)
        assert len(rows) == 1
        assert rows[0]["run_id"] == "p"


# --------------------------------------------------------------------------- #
# Markdown
# --------------------------------------------------------------------------- #

class TestMarkdown:
    def test_markdown_structure(self):
        rows = [
            _row(run_id="p", mode="plain", attack_type="cf", params="{}",
                 cpu_usage_percent_avg="10"),
            _row(run_id="s", mode="secure", attack_type="cf", params="{}",
                 cpu_usage_percent_avg="15"),
        ]
        records = bt.build_comparison_records(rows)
        md = bt.render_markdown(records)
        lines = md.strip().splitlines()
        # Header + separador + 1 linha de dados.
        assert len(lines) == 3
        assert lines[0].startswith("| attack_type |")
        assert set(lines[1].replace(" ", "").replace("|", "")) == {"-"}
        assert "| cf |" in lines[2]
        # Uma célula por coluna (contando os separadores de borda).
        assert lines[0].count("|") == len(bt.OUTPUT_COLUMNS) + 1

    def test_pipe_is_escaped(self):
        rows = [_row(run_id="p", mode="plain", attack_type="a|b", params="{}")]
        md = bt.render_markdown(bt.build_comparison_records(rows))
        assert "a\\|b" in md


# --------------------------------------------------------------------------- #
# End-to-end via main()
# --------------------------------------------------------------------------- #

class TestMain:
    def test_end_to_end(self, tmp_path):
        input_csv = _write_csv(
            tmp_path / "run_metrics.csv",
            [
                _row(run_id="p", mode="plain", attack_type="cf", params="{}",
                     started_at="2024-01-01T00:00:00+00:00",
                     cpu_usage_percent_avg="10",
                     payload_readability_classification="legivel"),
                _row(run_id="s", mode="secure", attack_type="cf", params="{}",
                     started_at="2024-01-01T00:00:00+00:00",
                     cpu_usage_percent_avg="15",
                     payload_readability_classification="ciphertext"),
            ],
        )
        out_dir = tmp_path / "out"
        rc = bt.main(["--input", str(input_csv), "--output-dir", str(out_dir)])
        assert rc == 0
        csv_out = out_dir / "comparison_table.csv"
        md_out = out_dir / "comparison_table.md"
        assert csv_out.exists()
        assert md_out.exists()
        with csv_out.open(encoding="utf-8", newline="") as fh:
            rows = list(csv.DictReader(fh))
        assert len(rows) == 1
        assert rows[0]["pairing_status"] == "paired"
        assert rows[0]["cpu_usage_percent_avg_delta"] == "5"
        assert rows[0]["payload_readability_classification_changed"] == "true"

    def test_missing_input_returns_nonzero(self, tmp_path, capsys):
        rc = bt.main(["--input", str(tmp_path / "nope.csv"),
                      "--output-dir", str(tmp_path)])
        assert rc == 1
        assert "erro:" in capsys.readouterr().err
