#!/usr/bin/env python3
"""Budget status dashboard — shows limit, ledger total, CSV-derived total, discrepancy, remaining, overspend %.

Scans all projects with budget.yaml and produces a consolidated status report.
Designed for quick visibility into resource consumption across the repo.

Usage:
    python infra/budget-verify/budget-status.py                    # All budgeted projects
    python infra/budget-verify/budget-status.py projects/sample-project/ # Single project
    python infra/budget-verify/budget-status.py --json             # Machine-readable output
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml


def find_repo_root() -> Path:
    """Walk up from script location to find repo root (contains CLAUDE.md)."""
    current = Path(__file__).resolve().parent
    while current.parent != current:
        if (current / "CLAUDE.md").exists():
            return current
        current = current.parent
    return Path.cwd()


def find_budgeted_projects(repo_root: Path) -> list[Path]:
    """Find all project directories containing budget.yaml."""
    projects_dir = repo_root / "projects"
    if not projects_dir.exists():
        return []
    results = []
    for item in sorted(projects_dir.iterdir()):
        if item.is_dir() and (item / "budget.yaml").exists():
            results.append(item)
    return results


def read_yaml_safe(path: Path) -> dict:
    """Read YAML file, returning empty dict on any error."""
    if not path.exists():
        return {}
    try:
        with open(path) as f:
            return yaml.safe_load(f) or {}
    except (yaml.YAMLError, OSError):
        return {}


def compute_ledger_totals(ledger: dict) -> dict[str, float]:
    """Sum ledger entries by resource type."""
    totals: dict[str, float] = {}
    for entry in ledger.get("entries", []) or []:
        resource = entry.get("resource", "unknown")
        totals[resource] = totals.get(resource, 0) + entry.get("amount", 0)
    return totals


def read_n_runs(experiment_dir: Path) -> int:
    """Read n_runs from config.json. Defaults to 1 if absent."""
    config_path = experiment_dir / "config.json"
    if not config_path.exists():
        return 1
    try:
        with open(config_path) as f:
            config = json.load(f)
        return int(config.get("n_runs", 1))
    except (json.JSONDecodeError, ValueError, TypeError, OSError):
        return 1


def count_csv_rows(path: Path) -> int:
    """Count data rows in a CSV (excludes header)."""
    import csv
    if not path.exists():
        return 0
    try:
        with open(path) as f:
            reader = csv.reader(f)
            header = next(reader, None)
            if header is None:
                return 0
            return sum(1 for _ in reader)
    except (OSError, csv.Error):
        return 0


def read_experiment_status(experiment_dir: Path) -> str:
    """Read status from EXPERIMENT.md frontmatter."""
    exp_md = experiment_dir / "EXPERIMENT.md"
    if not exp_md.exists():
        return "unknown"
    try:
        with open(exp_md) as f:
            in_fm = False
            for line in f:
                if line.strip() == "---":
                    if in_fm:
                        break
                    in_fm = True
                    continue
                if in_fm and line.startswith("status:"):
                    return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return "unknown"


def get_ledgered_experiments(ledger: dict) -> set[str]:
    """Get set of experiment IDs that have ledger entries."""
    ids: set[str] = set()
    for entry in ledger.get("entries", []) or []:
        exp = entry.get("experiment", "")
        if exp:
            ids.add(exp)
    return ids


def compute_csv_consumption(project_dir: Path, ledger: dict) -> tuple[int, int, list[dict]]:
    """Compute API calls from experiment result CSVs.

    Returns (ledgered_csv_total, all_csv_total, per_experiment_details).
    ledgered_csv_total only counts experiments that appear in the ledger
    (excludes pre-budget experiments for fair discrepancy comparison).
    """
    experiments_dir = project_dir / "experiments"
    if not experiments_dir.exists():
        return 0, 0, []

    ledgered_exps = get_ledgered_experiments(ledger)
    ledgered_total = 0
    all_total = 0
    details = []
    for exp_dir in sorted(experiments_dir.iterdir()):
        if not exp_dir.is_dir() or not (exp_dir / "EXPERIMENT.md").exists():
            continue
        results_dir = exp_dir / "results"
        if not results_dir.exists():
            continue
        csv_files = sorted(results_dir.glob("*.csv"))
        if not csv_files:
            continue

        n_runs = read_n_runs(exp_dir)
        status = read_experiment_status(exp_dir)
        exp_rows = 0
        file_details = []
        for csv_file in csv_files:
            rows = count_csv_rows(csv_file)
            exp_rows += rows
            file_details.append({"file": csv_file.name, "rows": rows})

        exp_calls = exp_rows * n_runs
        in_ledger = exp_dir.name in ledgered_exps
        all_total += exp_calls
        if in_ledger:
            ledgered_total += exp_calls
        details.append({
            "experiment": exp_dir.name,
            "status": status,
            "n_runs": n_runs,
            "total_rows": exp_rows,
            "total_calls": exp_calls,
            "in_ledger": in_ledger,
            "files": file_details,
        })

    return ledgered_total, all_total, details


def get_project_status(project_dir: Path) -> dict:
    """Compute full budget status for a project."""
    budget = read_yaml_safe(project_dir / "budget.yaml")
    ledger = read_yaml_safe(project_dir / "ledger.yaml")
    ledger_totals = compute_ledger_totals(ledger)
    csv_ledgered, csv_all, csv_details = compute_csv_consumption(project_dir, ledger)

    resources = budget.get("resources", {})
    resource_status = {}
    for rtype, spec in resources.items():
        if not isinstance(spec, dict):
            continue
        limit = spec.get("limit", 0)
        unit = spec.get("unit", "")
        ledgered = ledger_totals.get(rtype, 0)
        remaining = limit - ledgered
        overspend_pct = round(100 * (ledgered - limit) / limit, 1) if ledgered > limit and limit > 0 else 0
        usage_pct = round(100 * ledgered / limit, 1) if limit > 0 else 0

        # CSV-derived total (only for llm_api_calls; uses ledgered experiments only for fair comparison)
        csv_derived = csv_ledgered if rtype == "llm_api_calls" else None
        csv_all_total = csv_all if rtype == "llm_api_calls" else None
        discrepancy = None
        if csv_derived is not None:
            discrepancy = int(ledgered - csv_derived)

        resource_status[rtype] = {
            "limit": limit,
            "unit": unit,
            "ledger_total": int(ledgered),
            "csv_derived": csv_derived,
            "csv_all": csv_all_total,
            "discrepancy": discrepancy,
            "remaining": int(remaining),
            "usage_pct": usage_pct,
            "overspend_pct": overspend_pct,
            "over_budget": ledgered > limit,
        }

    # Deadline
    deadline_raw = budget.get("deadline")
    deadline_info = None
    if deadline_raw:
        try:
            if isinstance(deadline_raw, datetime):
                dl = deadline_raw.replace(tzinfo=timezone.utc) if deadline_raw.tzinfo is None else deadline_raw
            else:
                dl = datetime.fromisoformat(str(deadline_raw).replace("Z", "+00:00"))
            delta = dl - datetime.now(timezone.utc)
            hours = delta.total_seconds() / 3600
            if hours <= 0:
                time_str = "EXPIRED"
            elif hours < 24:
                time_str = f"{hours:.1f}h remaining"
            else:
                days = delta.days
                time_str = f"{days}d {int(hours % 24)}h remaining"
            deadline_info = {
                "deadline": dl.isoformat(),
                "time_remaining": time_str,
                "expired": hours <= 0,
            }
        except (ValueError, TypeError):
            deadline_info = {"deadline": str(deadline_raw), "time_remaining": "?", "expired": False}

    return {
        "project": project_dir.name,
        "path": str(project_dir),
        "resources": resource_status,
        "deadline": deadline_info,
        "csv_experiments": csv_details,
    }


def print_status(statuses: list[dict]) -> None:
    """Print human-readable budget status dashboard."""
    print()
    print("=" * 64)
    print("  BUDGET STATUS DASHBOARD")
    print("=" * 64)

    for status in statuses:
        print()
        print(f"  Project: {status['project']}")
        print(f"  {'─' * 56}")

        # Deadline
        dl = status.get("deadline")
        if dl:
            icon = "X" if dl.get("expired") else ">"
            print(f"  [{icon}] Deadline: {dl['deadline']}  ({dl['time_remaining']})")

        # Resources
        for rtype, rs in status.get("resources", {}).items():
            print()
            if rs["over_budget"]:
                bar = "OVER BUDGET"
            elif rs["usage_pct"] >= 90:
                bar = "WARNING (>90%)"
            else:
                bar = "OK"

            print(f"  {rtype} [{bar}]")
            print(f"    Limit:        {rs['limit']:>8} {rs['unit']}")
            print(f"    Ledger total: {rs['ledger_total']:>8} {rs['unit']}  ({rs['usage_pct']}%)")

            if rs.get("csv_derived") is not None:
                print(f"    CSV-derived:  {rs['csv_derived']:>8} {rs['unit']}  (ledgered experiments only)")
                disc = rs.get("discrepancy", 0)
                if disc != 0:
                    direction = "ledger > CSV" if disc > 0 else "ledger < CSV"
                    print(f"    Discrepancy:  {disc:>+8} {rs['unit']}  ({direction})")
                else:
                    print(f"    Discrepancy:  {0:>8} {rs['unit']}  (match)")
                if rs.get("csv_all") is not None and rs["csv_all"] != rs["csv_derived"]:
                    pre_budget = rs["csv_all"] - rs["csv_derived"]
                    print(f"    Pre-budget:   {pre_budget:>8} {rs['unit']}  (not tracked in ledger)")

            print(f"    Remaining:    {rs['remaining']:>8} {rs['unit']}")

            if rs["over_budget"]:
                print(f"    Overspend:    {rs['overspend_pct']:>7}%")

        # CSV experiment breakdown
        exps = status.get("csv_experiments", [])
        if exps:
            print()
            print(f"  Experiment breakdown (CSV-derived):")
            icons = {"completed": "+", "failed": "x", "running": "~", "planned": " ", "abandoned": "-"}
            for exp in exps:
                icon = icons.get(exp["status"], "?")
                calls_str = f"{exp['total_rows']}r x {exp['n_runs']}n = {exp['total_calls']} calls"
                tag = "" if exp.get("in_ledger") else "  (pre-budget)"
                print(f"    [{icon}] {exp['experiment']:<40} {calls_str}{tag}")

    print()
    print("=" * 64)
    print()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Budget status dashboard — shows limit, ledger, CSV-derived, discrepancy, remaining"
    )
    parser.add_argument("path", nargs="?", type=Path, default=None,
                        help="Project directory (default: all budgeted projects)")
    parser.add_argument("--json", action="store_true",
                        help="Output as JSON")
    args = parser.parse_args()

    repo_root = find_repo_root()

    if args.path:
        project_dirs = [args.path.resolve()]
    else:
        project_dirs = find_budgeted_projects(repo_root)

    if not project_dirs:
        print("No budgeted projects found.", file=sys.stderr)
        return 1

    statuses = []
    for pdir in project_dirs:
        if not (pdir / "budget.yaml").exists():
            print(f"Warning: {pdir} has no budget.yaml, skipping", file=sys.stderr)
            continue
        statuses.append(get_project_status(pdir))

    if args.json:
        print(json.dumps(statuses, indent=2, default=str))
    else:
        print_status(statuses)

    # Exit 1 if any project is over budget
    for s in statuses:
        for rs in s.get("resources", {}).values():
            if rs.get("over_budget"):
                return 1
        if s.get("deadline", {}).get("expired"):
            return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
