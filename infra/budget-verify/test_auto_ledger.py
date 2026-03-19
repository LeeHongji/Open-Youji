"""Tests for auto-ledger.py ledger audit and generation.

Covers: (1) ledger entry parsing, (2) consumption aggregation, (3) audit discrepancy detection.
"""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import textwrap
from pathlib import Path

_auto_ledger_path = Path(__file__).parent / "auto-ledger.py"
_spec = importlib.util.spec_from_file_location("auto_ledger", _auto_ledger_path)
auto_ledger = importlib.util.module_from_spec(_spec)
sys.modules["auto_ledger"] = auto_ledger
_spec.loader.exec_module(auto_ledger)


class TestLedgerEntryParsing:
    """Test read_ledger and ledger_total_for_experiment."""

    def setup_method(self):
        self.tmpdir = Path(tempfile.mkdtemp())

    def teardown_method(self):
        import shutil
        shutil.rmtree(self.tmpdir)

    def test_read_ledger_returns_empty_list_when_missing(self):
        result = auto_ledger.read_ledger(self.tmpdir)
        assert result == []

    def test_read_ledger_parses_single_entry(self):
        (self.tmpdir / "ledger.yaml").write_text(textwrap.dedent("""\
            entries:
              - date: "2026-01-15"
                experiment: exp1
                resource: llm_api_calls
                amount: 100
        """))
        result = auto_ledger.read_ledger(self.tmpdir)
        assert len(result) == 1
        assert result[0]["experiment"] == "exp1"
        assert result[0]["amount"] == 100
        assert result[0]["resource"] == "llm_api_calls"

    def test_read_ledger_parses_multiple_entries(self):
        (self.tmpdir / "ledger.yaml").write_text(textwrap.dedent("""\
            entries:
              - date: "2026-01-15"
                experiment: exp1
                resource: llm_api_calls
                amount: 100
              - date: "2026-01-16"
                experiment: exp2
                resource: llm_api_calls
                amount: 250
              - date: "2026-01-17"
                experiment: exp1
                resource: gen_3d_api_calls
                amount: 50
        """))
        result = auto_ledger.read_ledger(self.tmpdir)
        assert len(result) == 3

    def test_read_ledger_handles_empty_entries(self):
        (self.tmpdir / "ledger.yaml").write_text("entries: []\n")
        result = auto_ledger.read_ledger(self.tmpdir)
        assert result == []

    def test_ledger_total_for_experiment_single_match(self):
        entries = [
            {"experiment": "exp1", "resource": "llm_api_calls", "amount": 100},
            {"experiment": "exp2", "resource": "llm_api_calls", "amount": 200},
        ]
        result = auto_ledger.ledger_total_for_experiment(entries, "exp1", "llm_api_calls")
        assert result == 100

    def test_ledger_total_for_experiment_multiple_matches(self):
        entries = [
            {"experiment": "exp1", "resource": "llm_api_calls", "amount": 100},
            {"experiment": "exp1", "resource": "llm_api_calls", "amount": 50},
            {"experiment": "exp2", "resource": "llm_api_calls", "amount": 200},
        ]
        result = auto_ledger.ledger_total_for_experiment(entries, "exp1", "llm_api_calls")
        assert result == 150

    def test_ledger_total_for_experiment_no_match(self):
        entries = [
            {"experiment": "exp1", "resource": "llm_api_calls", "amount": 100},
        ]
        result = auto_ledger.ledger_total_for_experiment(entries, "exp_missing", "llm_api_calls")
        assert result == 0

    def test_ledger_total_for_experiment_resource_filter(self):
        entries = [
            {"experiment": "exp1", "resource": "llm_api_calls", "amount": 100},
            {"experiment": "exp1", "resource": "gen_3d_api_calls", "amount": 50},
        ]
        result = auto_ledger.ledger_total_for_experiment(entries, "exp1", "llm_api_calls")
        assert result == 100

    def test_ledger_total_for_experiment_empty_entries(self):
        result = auto_ledger.ledger_total_for_experiment([], "exp1", "llm_api_calls")
        assert result == 0


class TestConsumptionAggregation:
    """Test count_csv_rows, read_n_runs, and compute_experiment_consumption."""

    def setup_method(self):
        self.tmpdir = Path(tempfile.mkdtemp())

    def teardown_method(self):
        import shutil
        shutil.rmtree(self.tmpdir)

    def test_count_csv_rows_empty_file(self):
        csv_file = self.tmpdir / "data.csv"
        csv_file.write_text("")
        result = auto_ledger.count_csv_rows(csv_file)
        assert result == 0

    def test_count_csv_rows_header_only(self):
        csv_file = self.tmpdir / "data.csv"
        csv_file.write_text("col1,col2,col3\n")
        result = auto_ledger.count_csv_rows(csv_file)
        assert result == 0

    def test_count_csv_rows_single_data_row(self):
        csv_file = self.tmpdir / "data.csv"
        csv_file.write_text("col1,col2,col3\nval1,val2,val3\n")
        result = auto_ledger.count_csv_rows(csv_file)
        assert result == 1

    def test_count_csv_rows_multiple_data_rows(self):
        csv_file = self.tmpdir / "data.csv"
        csv_file.write_text("col1,col2,col3\nval1,val2,val3\nval4,val5,val6\nval7,val8,val9\n")
        result = auto_ledger.count_csv_rows(csv_file)
        assert result == 3

    def test_count_csv_rows_handles_empty_lines(self):
        csv_file = self.tmpdir / "data.csv"
        csv_file.write_text("col1,col2\nval1,val2\n\nval3,val4\n")
        result = auto_ledger.count_csv_rows(csv_file)
        assert result == 3

    def test_read_n_runs_default_one(self):
        exp_dir = self.tmpdir / "exp1"
        exp_dir.mkdir()
        result = auto_ledger.read_n_runs(exp_dir)
        assert result == 1

    def test_read_n_runs_from_config(self):
        exp_dir = self.tmpdir / "exp1"
        exp_dir.mkdir()
        (exp_dir / "config.json").write_text('{"n_runs": 5}')
        result = auto_ledger.read_n_runs(exp_dir)
        assert result == 5

    def test_read_n_runs_invalid_json_uses_default(self):
        exp_dir = self.tmpdir / "exp1"
        exp_dir.mkdir()
        (exp_dir / "config.json").write_text("not valid json")
        result = auto_ledger.read_n_runs(exp_dir)
        assert result == 1

    def test_compute_experiment_consumption_no_csv_files(self):
        exp_dir = self.tmpdir / "exp1"
        exp_dir.mkdir()
        (exp_dir / "EXPERIMENT.md").write_text("---\nstatus: completed\n---\n# Experiment")
        result = auto_ledger.compute_experiment_consumption(exp_dir)
        assert result is None

    def test_compute_experiment_consumption_single_csv(self):
        exp_dir = self.tmpdir / "exp1"
        exp_dir.mkdir()
        (exp_dir / "EXPERIMENT.md").write_text("---\nstatus: completed\n---\n# Experiment")
        results_dir = exp_dir / "results"
        results_dir.mkdir()
        (results_dir / "results.csv").write_text("col1,col2\nval1,val2\nval3,val4\n")
        (exp_dir / "config.json").write_text('{"n_runs": 2}')
        result = auto_ledger.compute_experiment_consumption(exp_dir)
        assert result["total_rows"] == 2
        assert result["total_calls"] == 4
        assert len(result["csv_files"]) == 1
        assert result["n_runs"] == 2

    def test_compute_experiment_consumption_multiple_csvs(self):
        exp_dir = self.tmpdir / "exp1"
        exp_dir.mkdir()
        (exp_dir / "EXPERIMENT.md").write_text("---\nstatus: completed\n---\n# Experiment")
        results_dir = exp_dir / "results"
        results_dir.mkdir()
        (results_dir / "results1.csv").write_text("col1,col2\nv1,v2\nv3,v4\nv5,v6\n")
        (results_dir / "results2.csv").write_text("col1,col2\nv1,v2\n")
        result = auto_ledger.compute_experiment_consumption(exp_dir)
        assert result["total_rows"] == 4
        assert result["total_calls"] == 4

    def test_compute_experiment_consumption_ignores_non_csv(self):
        exp_dir = self.tmpdir / "exp1"
        exp_dir.mkdir()
        (exp_dir / "EXPERIMENT.md").write_text("---\nstatus: completed\n---\n# Experiment")
        results_dir = exp_dir / "results"
        results_dir.mkdir()
        (results_dir / "results.csv").write_text("col1,col2\nv1,v2\n")
        (results_dir / "data.txt").write_text("some text content\n")
        result = auto_ledger.compute_experiment_consumption(exp_dir)
        assert len(result["csv_files"]) == 1
        assert result["total_rows"] == 1


class TestAuditDiscrepancyDetection:
    """Test audit_project discrepancy detection."""

    def setup_method(self):
        self.tmpdir = Path(tempfile.mkdtemp())

    def teardown_method(self):
        import shutil
        shutil.rmtree(self.tmpdir)

    def test_audit_empty_project(self):
        result = auto_ledger.audit_project(self.tmpdir, "llm_api_calls")
        assert result == []

    def test_audit_no_discrepancy(self):
        exp_dir = self.tmpdir / "experiments" / "exp1"
        exp_dir.mkdir(parents=True)
        (exp_dir / "EXPERIMENT.md").write_text("---\nstatus: completed\n---\n# Experiment")
        results_dir = exp_dir / "results"
        results_dir.mkdir()
        (results_dir / "results.csv").write_text("col1,col2\nv1,v2\nv3,v4\n")
        (self.tmpdir / "ledger.yaml").write_text(textwrap.dedent("""\
            entries:
              - date: "2026-01-15"
                experiment: exp1
                resource: llm_api_calls
                amount: 2
        """))
        result = auto_ledger.audit_project(self.tmpdir, "llm_api_calls")
        assert result == []

    def test_audit_detects_missing_ledger_entry(self):
        exp_dir = self.tmpdir / "experiments" / "exp1"
        exp_dir.mkdir(parents=True)
        (exp_dir / "EXPERIMENT.md").write_text("---\nstatus: completed\n---\n# Experiment")
        results_dir = exp_dir / "results"
        results_dir.mkdir()
        (results_dir / "results.csv").write_text("col1,col2\nv1,v2\nv3,v4\nv5,v6\n")
        (self.tmpdir / "ledger.yaml").write_text("entries: []\n")
        result = auto_ledger.audit_project(self.tmpdir, "llm_api_calls")
        assert len(result) == 1
        assert result[0]["csv_derived"] == 3
        assert result[0]["ledger_recorded"] == 0
        assert result[0]["difference"] == 3
        assert result[0]["status"] == "completed"

    def test_audit_detects_under_recorded(self):
        exp_dir = self.tmpdir / "experiments" / "exp1"
        exp_dir.mkdir(parents=True)
        (exp_dir / "EXPERIMENT.md").write_text("---\nstatus: completed\n---\n# Experiment")
        results_dir = exp_dir / "results"
        results_dir.mkdir()
        (results_dir / "results.csv").write_text("col1,col2\nv1,v2\nv3,v4\nv5,v6\nv7,v8\n")
        (self.tmpdir / "ledger.yaml").write_text(textwrap.dedent("""\
            entries:
              - date: "2026-01-15"
                experiment: exp1
                resource: llm_api_calls
                amount: 2
        """))
        result = auto_ledger.audit_project(self.tmpdir, "llm_api_calls")
        assert len(result) == 1
        assert result[0]["csv_derived"] == 4
        assert result[0]["ledger_recorded"] == 2
        assert result[0]["difference"] == 2
        assert result[0]["status"] == "completed"

    def test_audit_detects_over_recorded(self):
        exp_dir = self.tmpdir / "experiments" / "exp1"
        exp_dir.mkdir(parents=True)
        (exp_dir / "EXPERIMENT.md").write_text("---\nstatus: completed\n---\n# Experiment")
        results_dir = exp_dir / "results"
        results_dir.mkdir()
        (results_dir / "results.csv").write_text("col1,col2\nv1,v2\n")
        (self.tmpdir / "ledger.yaml").write_text(textwrap.dedent("""\
            entries:
              - date: "2026-01-15"
                experiment: exp1
                resource: llm_api_calls
                amount: 5
        """))
        result = auto_ledger.audit_project(self.tmpdir, "llm_api_calls")
        assert len(result) == 1
        assert result[0]["csv_derived"] == 1
        assert result[0]["ledger_recorded"] == 5
        assert result[0]["difference"] == -4
        assert result[0]["status"] == "completed"

    def test_audit_multiple_experiments(self):
        exp1_dir = self.tmpdir / "experiments" / "exp1"
        exp1_dir.mkdir(parents=True)
        (exp1_dir / "EXPERIMENT.md").write_text("---\nstatus: completed\n---\n# Experiment")
        results1_dir = exp1_dir / "results"
        results1_dir.mkdir()
        (results1_dir / "results.csv").write_text("col1,col2\nv1,v2\nv3,v4\n")
        exp2_dir = self.tmpdir / "experiments" / "exp2"
        exp2_dir.mkdir(parents=True)
        (exp2_dir / "EXPERIMENT.md").write_text("---\nstatus: completed\n---\n# Experiment")
        results2_dir = exp2_dir / "results"
        results2_dir.mkdir()
        (results2_dir / "results.csv").write_text("col1,col2\nv1,v2\n")
        (self.tmpdir / "ledger.yaml").write_text(textwrap.dedent("""\
            entries:
              - date: "2026-01-15"
                experiment: exp1
                resource: llm_api_calls
                amount: 2
              - date: "2026-01-16"
                experiment: exp2
                resource: llm_api_calls
                amount: 1
        """))
        result = auto_ledger.audit_project(self.tmpdir, "llm_api_calls")
        assert result == []

    def test_audit_filters_by_resource(self):
        exp_dir = self.tmpdir / "experiments" / "exp1"
        exp_dir.mkdir(parents=True)
        (exp_dir / "EXPERIMENT.md").write_text("---\nstatus: completed\n---\n# Experiment")
        results_dir = exp_dir / "results"
        results_dir.mkdir()
        (results_dir / "results.csv").write_text("col1,col2\nv1,v2\nv3,v4\n")
        (self.tmpdir / "ledger.yaml").write_text(textwrap.dedent("""\
            entries:
              - date: "2026-01-15"
                experiment: exp1
                resource: gen_3d_api_calls
                amount: 10
        """))
        result = auto_ledger.audit_project(self.tmpdir, "llm_api_calls")
        assert len(result) == 1
        assert result[0]["csv_derived"] == 2
        assert result[0]["ledger_recorded"] == 0
        assert result[0]["status"] == "completed"

    def test_audit_with_n_runs_multiplier(self):
        exp_dir = self.tmpdir / "experiments" / "exp1"
        exp_dir.mkdir(parents=True)
        (exp_dir / "EXPERIMENT.md").write_text("---\nstatus: completed\n---\n# Experiment")
        results_dir = exp_dir / "results"
        results_dir.mkdir()
        (results_dir / "results.csv").write_text("col1,col2\nv1,v2\nv3,v4\n")
        (exp_dir / "config.json").write_text('{"n_runs": 3}')
        (self.tmpdir / "ledger.yaml").write_text(textwrap.dedent("""\
            entries:
              - date: "2026-01-15"
                experiment: exp1
                resource: llm_api_calls
                amount: 6
        """))
        result = auto_ledger.audit_project(self.tmpdir, "llm_api_calls")
        assert result == []
