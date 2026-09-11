"""Testes unitários da lógica pura de export_run_metrics.py.

Cobrem derivação de degradação/recuperação, achatamento do jsonb de Track B,
canonicalização de params, serialização de célula CSV, geração de linha e
extração/renderização de blocos Flux — tudo sem Postgres/InfluxDB reais.
"""

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

import export_run_metrics as ex


UTC = timezone.utc


def _t(seconds: int) -> datetime:
    """Helper: instante base + N segundos, tz-aware."""
    return datetime(2024, 1, 1, 0, 0, 0, tzinfo=UTC) + timedelta(seconds=seconds)


def _series(pairs):
    """[(offset_s, status), ...] -> lista de dicts {time, status}."""
    return [{"time": _t(off), "status": st} for off, st in pairs]


# --------------------------------------------------------------------------- #
# assert_safe_run_id / brokers / tempos
# --------------------------------------------------------------------------- #

class TestGuards:
    def test_valid_uuid_passes(self):
        ex.assert_safe_run_id("3f2b1c8a-1234-4abc-89de-0123456789ab")

    @pytest.mark.parametrize(
        "bad",
        [
            "",
            "not-a-uuid",
            '3f2b1c8a" or true',  # tentativa de injeção Flux
            "3f2b1c8a-1234-4abc-89de-0123456789",  # curto demais
        ],
    )
    def test_invalid_uuid_raises(self, bad):
        with pytest.raises(ValueError):
            ex.assert_safe_run_id(bad)

    def test_broker_guard(self):
        ex.assert_safe_broker("plain")
        ex.assert_safe_broker("secure")
        with pytest.raises(ValueError):
            ex.assert_safe_broker("attacker")

    def test_flux_time_guard(self):
        ex.assert_safe_flux_time("2024-01-01T00:00:00Z")
        ex.assert_safe_flux_time("-1h")
        with pytest.raises(ValueError):
            ex.assert_safe_flux_time("now()")  # injeção via literal de tempo


# --------------------------------------------------------------------------- #
# canonical_json_params
# --------------------------------------------------------------------------- #

class TestCanonicalJson:
    def test_none_stays_none(self):
        assert ex.canonical_json_params(None) is None

    def test_keys_sorted_deterministic(self):
        a = ex.canonical_json_params({"b": 1, "a": 2})
        b = ex.canonical_json_params({"a": 2, "b": 1})
        assert a == b == '{"a":2,"b":1}'

    def test_nested_sorted(self):
        out = ex.canonical_json_params({"z": {"y": 1, "x": 2}, "a": 3})
        assert out == '{"a":3,"z":{"x":2,"y":1}}'


# --------------------------------------------------------------------------- #
# flatten_track_b_result
# --------------------------------------------------------------------------- #

class TestFlattenTrackB:
    def test_connection_flood(self):
        result = {
            "connections_attempted": 100,
            "connections_established": 80,
            "connections_rejected": 20,
            "success_rate": 0.8,
        }
        row = ex.flatten_track_b_result("connection-flood", result)
        assert row["connections_attempted"] == 100
        assert row["connections_established"] == 80
        assert row["connections_rejected"] == 20
        assert row["connection_success_rate"] == 0.8
        # Colunas de outros tracks ficam None.
        assert row["message_flood_attempted"] is None
        assert row["malformed_mode"] is None

    def test_message_flood(self):
        result = {
            "attempted": 5000,
            "accepted": 4900,
            "success_rate": 0.98,
            "achieved_rate": 1200.5,
            "elapsed_seconds": 4.1,
        }
        row = ex.flatten_track_b_result("message-flood", result)
        assert row["message_flood_attempted"] == 5000
        assert row["message_flood_accepted"] == 4900
        assert row["message_flood_success_rate"] == 0.98
        assert row["message_flood_achieved_rate"] == 1200.5
        assert row["message_flood_elapsed_seconds"] == 4.1
        assert row["connections_attempted"] is None

    def test_malformed_payload(self):
        result = {
            "mode": "giant",
            "attempted": 10,
            "publish_accepted": 3,
            "disconnected_after_publish": True,
            "broker_response_summary": "conn reset",
        }
        row = ex.flatten_track_b_result("malformed-payload", result)
        assert row["malformed_mode"] == "giant"
        assert row["malformed_attempted"] == 10
        assert row["malformed_publish_accepted"] == 3
        assert row["malformed_disconnected_after_publish"] is True
        assert row["malformed_broker_response_summary"] == "conn reset"

    def test_partial_jsonb_missing_field_is_none(self):
        # success_rate ausente (script antigo) -> None, sem exceção.
        row = ex.flatten_track_b_result(
            "connection-flood",
            {"connections_attempted": 100, "connections_established": 100},
        )
        assert row["connections_attempted"] == 100
        assert row["connection_success_rate"] is None
        assert row["connections_rejected"] is None

    def test_none_result_all_none(self):
        row = ex.flatten_track_b_result("connection-flood", None)
        assert all(v is None for v in row.values())

    def test_none_attack_type_all_none(self):
        row = ex.flatten_track_b_result(None, {"connections_attempted": 1})
        assert all(v is None for v in row.values())

    def test_unknown_attack_type_all_none(self):
        row = ex.flatten_track_b_result("something-else", {"x": 1})
        assert all(v is None for v in row.values())


# --------------------------------------------------------------------------- #
# derive_broker_health
# --------------------------------------------------------------------------- #

class TestDeriveBrokerHealth:
    def test_track_a_run_all_none(self):
        # Sem janela de ataque -> derivação não se aplica.
        out = ex.derive_broker_health([], None, None)
        assert out == {
            "time_to_degradation_ms": None,
            "broker_survived": None,
            "recovery_time_ms": None,
            "recovered": None,
        }

    def test_survived_never_degraded(self):
        series = _series([(0, "running"), (5, "running"), (10, "running")])
        out = ex.derive_broker_health(series, _t(0), _t(10))
        assert out["time_to_degradation_ms"] is None
        assert out["broker_survived"] is True
        assert out["recovery_time_ms"] is None
        assert out["recovered"] is None

    def test_degraded_and_recovered(self):
        series = _series(
            [
                (0, "running"),
                (5, "running"),
                (10, "exited"),      # degradação em t=10
                (15, "restarting"),
                (20, "running"),     # recuperação em t=20
                (25, "running"),
            ]
        )
        out = ex.derive_broker_health(series, _t(0), _t(25))
        assert out["time_to_degradation_ms"] == 10_000
        assert out["broker_survived"] is False
        assert out["recovery_time_ms"] == 10_000  # 20 - 10
        assert out["recovered"] is True

    def test_degraded_never_recovered(self):
        series = _series(
            [(0, "running"), (5, "running"), (10, "dead"), (15, "dead")]
        )
        out = ex.derive_broker_health(series, _t(0), _t(15))
        assert out["time_to_degradation_ms"] == 10_000
        assert out["broker_survived"] is False
        assert out["recovery_time_ms"] is None
        assert out["recovered"] is False

    def test_recovery_not_sustained_then_final_recovery(self):
        # Volta a running em t=15 mas cai de novo em t=20; recuperação real t=25.
        series = _series(
            [
                (0, "running"),
                (10, "exited"),
                (15, "running"),     # não sustentada
                (20, "exited"),
                (25, "running"),     # sustentada até o fim
            ]
        )
        out = ex.derive_broker_health(series, _t(0), _t(30))
        assert out["time_to_degradation_ms"] == 10_000
        assert out["recovery_time_ms"] == 15_000  # 25 - 10
        assert out["recovered"] is True

    def test_degradation_after_attack_finish_ignored(self):
        # A degradação em t=20 está fora da janela do ataque [0, 10] -> ignorada.
        series = _series(
            [(0, "running"), (5, "running"), (20, "exited")]
        )
        out = ex.derive_broker_health(series, _t(0), _t(10))
        assert out["broker_survived"] is True
        assert out["time_to_degradation_ms"] is None

    def test_empty_series_with_window_all_none(self):
        out = ex.derive_broker_health([], _t(0), _t(10))
        assert out["broker_survived"] is None
        assert out["time_to_degradation_ms"] is None

    def test_unsorted_input_is_sorted(self):
        series = _series(
            [(20, "running"), (0, "running"), (10, "exited")]
        )
        out = ex.derive_broker_health(series, _t(0), _t(20))
        assert out["time_to_degradation_ms"] == 10_000
        assert out["recovery_time_ms"] == 10_000


# --------------------------------------------------------------------------- #
# to_csv_value / build_csv_row
# --------------------------------------------------------------------------- #

class TestCsvSerialization:
    def test_none_is_empty(self):
        assert ex.to_csv_value(None) == ""

    def test_bool_lowercase(self):
        assert ex.to_csv_value(True) == "true"
        assert ex.to_csv_value(False) == "false"

    def test_zero_is_not_empty(self):
        # Distinção crítica: 0 medido != None (vazio).
        assert ex.to_csv_value(0) == "0"

    def test_datetime_iso(self):
        assert ex.to_csv_value(_t(0)) == "2024-01-01T00:00:00+00:00"

    def test_row_follows_column_order(self):
        record = {"run_id": "r1", "mode": "plain", "broker_survived": True}
        row = ex.build_csv_row(record)
        assert len(row) == len(ex.CSV_COLUMNS)
        assert row[ex.CSV_COLUMNS.index("run_id")] == "r1"
        assert row[ex.CSV_COLUMNS.index("mode")] == "plain"
        assert row[ex.CSV_COLUMNS.index("broker_survived")] == "true"
        # Colunas ausentes no record viram célula vazia.
        assert row[ex.CSV_COLUMNS.index("entropy_bits")] == ""

    def test_write_csv_roundtrip(self, tmp_path):
        import csv

        records = [
            {
                "run_id": "3f2b1c8a-1234-4abc-89de-0123456789ab",
                "mode": "plain",
                "connections_attempted": 0,
                "broker_survived": False,
                "entropy_bits": None,
            }
        ]
        out = tmp_path / "sub" / "run_metrics.csv"
        ex.write_csv(records, out)
        with out.open(encoding="utf-8", newline="") as fh:
            rows = list(csv.DictReader(fh))
        assert list(rows[0].keys()) == list(ex.CSV_COLUMNS)
        assert rows[0]["connections_attempted"] == "0"  # 0 preservado
        assert rows[0]["broker_survived"] == "false"
        assert rows[0]["entropy_bits"] == ""             # None -> vazio


# --------------------------------------------------------------------------- #
# parse_duration_seconds
# --------------------------------------------------------------------------- #

class TestParseDuration:
    @pytest.mark.parametrize(
        "text,expected",
        [
            ("5s", 5.0),
            ("250ms", 0.25),
            ("2m", 120.0),
            ("1h", 3600.0),
            ("10", 10.0),  # sem unidade -> segundos
        ],
    )
    def test_valid(self, text, expected):
        assert ex.parse_duration_seconds(text) == pytest.approx(expected)

    def test_invalid_raises(self):
        with pytest.raises(ValueError):
            ex.parse_duration_seconds("abc")


# --------------------------------------------------------------------------- #
# load_flux_block / render_flux (contra os .flux reais versionados)
# --------------------------------------------------------------------------- #

FLUX_DIR = ex.FLUX_DIR


class TestLoadFluxBlock:
    def test_active_block_extracts_only_code(self):
        flux = ex.load_flux_block(FLUX_DIR / "broker_metrics_by_run.flux", "cpu_mean")
        assert flux.startswith("from(bucket:")
        assert "|> mean()" in flux
        # Nenhuma linha de prosa/comentário deve sobrar.
        for line in flux.splitlines():
            assert line.lstrip().startswith(("from(", "|>"))

    def test_commented_block_is_uncommented(self):
        flux = ex.load_flux_block(
            FLUX_DIR / "broker_metrics_by_run.flux", "mem_usage_mean"
        )
        assert flux.startswith("from(bucket:")
        assert "//" not in flux  # totalmente descomentado
        assert '_field == "usage"' in flux

    def test_net_rate_block_has_derivative(self):
        flux = ex.load_flux_block(
            FLUX_DIR / "broker_metrics_by_run.flux", "net_rate_mean"
        )
        assert "derivative(" in flux
        assert "//" not in flux

    def test_transitions_block(self):
        flux = ex.load_flux_block(
            FLUX_DIR / "container_status_transitions.flux",
            "container_status_series",
        )
        assert flux.startswith("from(bucket:")
        assert 'sort(columns: ["_time"])' in flux

    def test_missing_block_raises(self):
        with pytest.raises(ex.AnalysisError):
            ex.load_flux_block(
                FLUX_DIR / "broker_metrics_by_run.flux", "does_not_exist"
            )

    def test_render_substitutes_and_validates(self):
        template = ex.load_flux_block(
            FLUX_DIR / "broker_metrics_by_run.flux", "cpu_mean"
        )
        rendered = ex.render_flux(
            template,
            bucket="stressbed",
            run_id="3f2b1c8a-1234-4abc-89de-0123456789ab",
            broker="plain",
            start="2024-01-01T00:00:00Z",
            stop="2024-01-01T00:10:00Z",
        )
        assert "__BUCKET__" not in rendered
        assert "__RUN_ID__" not in rendered
        assert "__START__" not in rendered
        assert 'r.run_id == "3f2b1c8a-1234-4abc-89de-0123456789ab"' in rendered
        assert 'bucket: "stressbed"' in rendered

    def test_render_rejects_bad_run_id(self):
        template = ex.load_flux_block(
            FLUX_DIR / "broker_metrics_by_run.flux", "cpu_mean"
        )
        with pytest.raises(ValueError):
            ex.render_flux(
                template,
                bucket="stressbed",
                run_id='x" or true',
                broker="plain",
                start="-1h",
                stop="now",
            )
