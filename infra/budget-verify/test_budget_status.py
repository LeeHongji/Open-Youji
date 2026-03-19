"""Tests for budget-status.py budget dashboard.

Covers: find_budgeted_projects discovery, missing ledger handling, overspend calculation.
"""

from __future__ import annotations

import importlib.util
import shutil
import sys
import textwrap
from pathlib import Path

import pytest

_budget_status_path = Path(__file__).parent / "budget-status.py"
_spec = importlib.util.spec_from_file_location("budget_status", _budget_status_path)
assert _spec is not None
assert _spec.loader is not None
budget_status = importlib.util.module_from_spec(_spec)
sys.modules["budget_status"] = budget_status
_spec.loader.exec_module(budget_status)


class TestFindBudgetedProjects:
    """Test find_budgeted_projects discovers budget.yaml files."""

    def test_finds_project_with_budget_yaml(self, tmp_path: Path):
        projects_dir = tmp_path / "projects"
        projects_dir.mkdir()
        project = projects_dir / "myproject"
        project.mkdir()
        (project / "budget.yaml").write_text("resources: {}\n")

        result = budget_status.find_budgeted_projects(tmp_path)

        assert len(result) == 1
        assert result[0].name == "myproject"

    def test_finds_multiple_budgeted_projects(self, tmp_path: Path):
        projects_dir = tmp_path / "projects"
        projects_dir.mkdir()
        for name in ["alpha", "beta", "gamma"]:
            project = projects_dir / name
            project.mkdir()
            (project / "budget.yaml").write_text("resources: {}\n")

        result = budget_status.find_budgeted_projects(tmp_path)

        assert len(result) == 3
        assert [p.name for p in result] == ["alpha", "beta", "gamma"]

    def test_ignores_project_without_budget_yaml(self, tmp_path: Path):
        projects_dir = tmp_path / "projects"
        projects_dir.mkdir()
        with_budget = projects_dir / "has-budget"
        with_budget.mkdir()
        (with_budget / "budget.yaml").write_text("resources: {}\n")
        without_budget = projects_dir / "no-budget"
        without_budget.mkdir()

        result = budget_status.find_budgeted_projects(tmp_path)

        assert len(result) == 1
        assert result[0].name == "has-budget"

    def test_returns_empty_list_when_no_projects_dir(self, tmp_path: Path):
        result = budget_status.find_budgeted_projects(tmp_path)
        assert result == []

    def test_returns_empty_list_when_projects_dir_empty(self, tmp_path: Path):
        (tmp_path / "projects").mkdir()
        result = budget_status.find_budgeted_projects(tmp_path)
        assert result == []

    def test_ignores_files_in_projects_dir(self, tmp_path: Path):
        projects_dir = tmp_path / "projects"
        projects_dir.mkdir()
        (projects_dir / "not-a-dir.yaml").write_text("resources: {}\n")

        result = budget_status.find_budgeted_projects(tmp_path)

        assert result == []

    def test_returns_sorted_results(self, tmp_path: Path):
        projects_dir = tmp_path / "projects"
        projects_dir.mkdir()
        for name in ["zebra", "alpha", "mike"]:
            project = projects_dir / name
            project.mkdir()
            (project / "budget.yaml").write_text("resources: {}\n")

        result = budget_status.find_budgeted_projects(tmp_path)

        assert [p.name for p in result] == ["alpha", "mike", "zebra"]


class TestBudgetStatusMissingLedger:
    """Test budget status calculation handles missing ledger.yaml."""

    def test_missing_ledger_shows_zero_consumed(self, tmp_path: Path):
        project = tmp_path / "myproject"
        project.mkdir()
        (project / "budget.yaml").write_text(textwrap.dedent("""\
            resources:
              llm_api_calls:
                limit: 1000
                unit: calls
        """))

        status = budget_status.get_project_status(project)

        assert status["resources"]["llm_api_calls"]["ledger_total"] == 0
        assert status["resources"]["llm_api_calls"]["remaining"] == 1000

    def test_missing_ledger_with_multiple_resources(self, tmp_path: Path):
        project = tmp_path / "myproject"
        project.mkdir()
        (project / "budget.yaml").write_text(textwrap.dedent("""\
            resources:
              llm_api_calls:
                limit: 5000
                unit: calls
              gen_3d_api_calls:
                limit: 100
                unit: calls
        """))

        status = budget_status.get_project_status(project)

        assert status["resources"]["llm_api_calls"]["ledger_total"] == 0
        assert status["resources"]["gen_3d_api_calls"]["ledger_total"] == 0
        assert status["resources"]["llm_api_calls"]["remaining"] == 5000
        assert status["resources"]["gen_3d_api_calls"]["remaining"] == 100

    def test_missing_ledger_no_overspend(self, tmp_path: Path):
        project = tmp_path / "myproject"
        project.mkdir()
        (project / "budget.yaml").write_text(textwrap.dedent("""\
            resources:
              llm_api_calls:
                limit: 1000
                unit: calls
        """))

        status = budget_status.get_project_status(project)

        assert status["resources"]["llm_api_calls"]["overspend_pct"] == 0
        assert status["resources"]["llm_api_calls"]["over_budget"] is False

    def test_missing_ledger_usage_pct_is_zero(self, tmp_path: Path):
        project = tmp_path / "myproject"
        project.mkdir()
        (project / "budget.yaml").write_text(textwrap.dedent("""\
            resources:
              llm_api_calls:
                limit: 1000
                unit: calls
        """))

        status = budget_status.get_project_status(project)

        assert status["resources"]["llm_api_calls"]["usage_pct"] == 0


class TestOverspendCalculation:
    """Test overspend % computed correctly."""

    def test_no_overspend_when_under_limit(self, tmp_path: Path):
        project = tmp_path / "myproject"
        project.mkdir()
        (project / "budget.yaml").write_text(textwrap.dedent("""\
            resources:
              llm_api_calls:
                limit: 1000
                unit: calls
        """))
        (project / "ledger.yaml").write_text(textwrap.dedent("""\
            entries:
              - date: "2026-01-01"
                experiment: exp1
                resource: llm_api_calls
                amount: 500
        """))

        status = budget_status.get_project_status(project)

        assert status["resources"]["llm_api_calls"]["overspend_pct"] == 0
        assert status["resources"]["llm_api_calls"]["over_budget"] is False

    def test_no_overspend_when_exactly_at_limit(self, tmp_path: Path):
        project = tmp_path / "myproject"
        project.mkdir()
        (project / "budget.yaml").write_text(textwrap.dedent("""\
            resources:
              llm_api_calls:
                limit: 1000
                unit: calls
        """))
        (project / "ledger.yaml").write_text(textwrap.dedent("""\
            entries:
              - date: "2026-01-01"
                experiment: exp1
                resource: llm_api_calls
                amount: 1000
        """))

        status = budget_status.get_project_status(project)

        assert status["resources"]["llm_api_calls"]["overspend_pct"] == 0
        assert status["resources"]["llm_api_calls"]["over_budget"] is False

    def test_overspend_ten_percent(self, tmp_path: Path):
        project = tmp_path / "myproject"
        project.mkdir()
        (project / "budget.yaml").write_text(textwrap.dedent("""\
            resources:
              llm_api_calls:
                limit: 1000
                unit: calls
        """))
        (project / "ledger.yaml").write_text(textwrap.dedent("""\
            entries:
              - date: "2026-01-01"
                experiment: exp1
                resource: llm_api_calls
                amount: 1100
        """))

        status = budget_status.get_project_status(project)

        assert status["resources"]["llm_api_calls"]["overspend_pct"] == 10.0
        assert status["resources"]["llm_api_calls"]["over_budget"] is True

    def test_overspend_fifty_percent(self, tmp_path: Path):
        project = tmp_path / "myproject"
        project.mkdir()
        (project / "budget.yaml").write_text(textwrap.dedent("""\
            resources:
              llm_api_calls:
                limit: 200
                unit: calls
        """))
        (project / "ledger.yaml").write_text(textwrap.dedent("""\
            entries:
              - date: "2026-01-01"
                experiment: exp1
                resource: llm_api_calls
                amount: 300
        """))

        status = budget_status.get_project_status(project)

        assert status["resources"]["llm_api_calls"]["overspend_pct"] == 50.0
        assert status["resources"]["llm_api_calls"]["over_budget"] is True

    def test_overspend_from_multiple_entries(self, tmp_path: Path):
        project = tmp_path / "myproject"
        project.mkdir()
        (project / "budget.yaml").write_text(textwrap.dedent("""\
            resources:
              llm_api_calls:
                limit: 1000
                unit: calls
        """))
        (project / "ledger.yaml").write_text(textwrap.dedent("""\
            entries:
              - date: "2026-01-01"
                experiment: exp1
                resource: llm_api_calls
                amount: 600
              - date: "2026-01-02"
                experiment: exp2
                resource: llm_api_calls
                amount: 600
        """))

        status = budget_status.get_project_status(project)

        assert status["resources"]["llm_api_calls"]["overspend_pct"] == 20.0
        assert status["resources"]["llm_api_calls"]["over_budget"] is True

    def test_overspend_fractional_percentage_rounded(self, tmp_path: Path):
        project = tmp_path / "myproject"
        project.mkdir()
        (project / "budget.yaml").write_text(textwrap.dedent("""\
            resources:
              llm_api_calls:
                limit: 1000
                unit: calls
        """))
        (project / "ledger.yaml").write_text(textwrap.dedent("""\
            entries:
              - date: "2026-01-01"
                experiment: exp1
                resource: llm_api_calls
                amount: 1234
        """))

        status = budget_status.get_project_status(project)

        assert status["resources"]["llm_api_calls"]["overspend_pct"] == 23.4
        assert status["resources"]["llm_api_calls"]["over_budget"] is True

    def test_overspend_with_limit_one(self, tmp_path: Path):
        project = tmp_path / "myproject"
        project.mkdir()
        (project / "budget.yaml").write_text(textwrap.dedent("""\
            resources:
              llm_api_calls:
                limit: 1
                unit: calls
        """))
        (project / "ledger.yaml").write_text(textwrap.dedent("""\
            entries:
              - date: "2026-01-01"
                experiment: exp1
                resource: llm_api_calls
                amount: 5
        """))

        status = budget_status.get_project_status(project)

        assert status["resources"]["llm_api_calls"]["overspend_pct"] == 400.0
        assert status["resources"]["llm_api_calls"]["over_budget"] is True

    def test_zero_limit_no_overspend_pct(self, tmp_path: Path):
        project = tmp_path / "myproject"
        project.mkdir()
        (project / "budget.yaml").write_text(textwrap.dedent("""\
            resources:
              llm_api_calls:
                limit: 0
                unit: calls
        """))
        (project / "ledger.yaml").write_text(textwrap.dedent("""\
            entries:
              - date: "2026-01-01"
                experiment: exp1
                resource: llm_api_calls
                amount: 100
        """))

        status = budget_status.get_project_status(project)

        assert status["resources"]["llm_api_calls"]["overspend_pct"] == 0
        assert status["resources"]["llm_api_calls"]["over_budget"] is True
