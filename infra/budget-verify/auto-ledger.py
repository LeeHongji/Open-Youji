#!/usr/bin/env python3
"""Generate and audit ledger entries from experiment result CSVs.

Scans experiment directories for result CSVs, reads n_runs from config.json,
computes actual API call consumption (rows × n_runs), and either generates
new ledger entries or audits existing ones for discrepancies.

Usage:
    # Generate ledger entries for all experiments in a project
    python auto-ledger.py projects/sample-project/

    # Generate for a single experiment
    python auto-ledger.py projects/sample-project/experiments/model-comparison-focused-v2/

    # Audit existing ledger against CSV-derived totals
    python auto-ledger.py projects/sample-project/ --audit

    # Output as YAML (ready to append to ledger.yaml)
    python auto-ledger.py projects/sample-project/ --yaml

    # Machine-readable JSON
    python auto-ledger.py projects/sample-project/ --json
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml


# ---------------------------------------------------------------------------
# CSV consumption counting
# ---------------------------------------------------------------------------

def count_csv_rows(path: Path) -> int:
    """Count data rows in a result CSV (excludes header)."""
    if not path.exists():
        return 0
    with open(path) as f:
        reader = csv.reader(f)
        header = next(reader, None)
        if header is None:
            return 0
        return sum(1 for _ in reader)


def read_n_runs(experiment_dir: Path) -> int:
    """Read n_runs from config.json. Defaults to 1 if absent."""
    config_path = experiment_dir / "config.json"
    if not config_path.exists():
        return 1
    try:
        with open(config_path) as f:
            config = json.load(f)
        return int(config.get("n_runs", 1))
    except (json.JSONDecodeError, ValueError, TypeError):
        return 1


def read_experiment_date(experiment_dir: Path) -> str:
    """Read date from EXPERIMENT.md frontmatter. Falls back to today."""
    exp_md = experiment_dir / "EXPERIMENT.md"
    if not exp_md.exists():
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        with open(exp_md) as f:
            in_fm = False
            for line in f:
                if line.strip() == "---":
                    if in_fm:
                        break
                    in_fm = True
                    continue
                if in_fm and line.startswith("date:"):
                    return line.split(":", 1)[1].strip().strip('"')
    except OSError:
        pass
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


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


def compute_experiment_consumption(experiment_dir: Path) -> dict | None:
    """Compute API call consumption from result CSVs and config.

    Returns dict with experiment name, CSV details, n_runs, and total calls,
    or None if no results found.
    """
    results_dir = experiment_dir / "results"
    if not results_dir.exists():
        return None

    csv_files = sorted(results_dir.glob("*.csv"))
    if not csv_files:
        return None

    n_runs = read_n_runs(experiment_dir)
    date = read_experiment_date(experiment_dir)
    status = read_experiment_status(experiment_dir)

    csv_details = []
    total_rows = 0
    for csv_file in csv_files:
        rows = count_csv_rows(csv_file)
        total_rows += rows
        csv_details.append({
            "file": csv_file.name,
            "rows": rows,
        })

    total_calls = total_rows * n_runs

    return {
        "experiment": experiment_dir.name,
        "date": date,
        "status": status,
        "n_runs": n_runs,
        "csv_files": csv_details,
        "total_rows": total_rows,
        "total_calls": total_calls,
    }


# ---------------------------------------------------------------------------
# Ledger reading
# ---------------------------------------------------------------------------

def read_ledger(project_dir: Path) -> list[dict]:
    """Read entries from ledger.yaml."""
    ledger_path = project_dir / "ledger.yaml"
    if not ledger_path.exists():
        return []
    try:
        with open(ledger_path) as f:
            data = yaml.safe_load(f)
        return data.get("entries", []) or []
    except (yaml.YAMLError, OSError):
        return []


def ledger_total_for_experiment(entries: list[dict], experiment_id: str, resource: str) -> float:
    """Sum ledger entries for a specific experiment and resource."""
    total = 0.0
    for entry in entries:
        if entry.get("experiment", "").startswith(experiment_id) and entry.get("resource") == resource:
            total += entry.get("amount", 0)
    return total


# ---------------------------------------------------------------------------
# Budget reading
# ---------------------------------------------------------------------------

def read_budget_resources(project_dir: Path) -> dict[str, dict]:
    """Read resource definitions from budget.yaml."""
    budget_path = project_dir / "budget.yaml"
    if not budget_path.exists():
        return {}
    try:
        with open(budget_path) as f:
            data = yaml.safe_load(f)
        return data.get("resources", {}) or {}
    except (yaml.YAMLError, OSError):
        return {}


# ---------------------------------------------------------------------------
# Experiment discovery
# ---------------------------------------------------------------------------

def find_experiments(root: Path) -> list[Path]:
    """Find experiment directories. Handles both project dir and single experiment."""
    # Single experiment directory
    if (root / "EXPERIMENT.md").exists():
        return [root]

    # Project directory — look in experiments/
    experiments_dir = root / "experiments"
    if not experiments_dir.exists():
        return []

    results = []
    for d in sorted(experiments_dir.iterdir()):
        if d.is_dir() and (d / "EXPERIMENT.md").exists():
            results.append(d)
    return results


def find_project_dir(path: Path) -> Path:
    """Walk up from path to find the project directory (contains budget.yaml or is under projects/)."""
    current = path.resolve()
    while current.parent != current:
        if (current / "budget.yaml").exists():
            return current
        if current.parent.name == "projects":
            return current
        current = current.parent
    return path.resolve()


# ---------------------------------------------------------------------------
# Entry generation
# ---------------------------------------------------------------------------

def generate_entry(consumption: dict, resource: str = "llm_api_calls") -> dict:
    """Generate a ledger entry dict from consumption data."""
    detail_parts = []
    for csv_info in consumption["csv_files"]:
        detail_parts.append(f"{csv_info['file']}: {csv_info['rows']} rows")
    detail = f"{consumption['total_rows']} rows × {consumption['n_runs']} n_runs = {consumption['total_calls']} calls ({', '.join(detail_parts)})"

    return {
        "date": consumption["date"],
        "experiment": consumption["experiment"],
        "resource": resource,
        "amount": consumption["total_calls"],
        "detail": detail,
    }


def format_yaml_entry(entry: dict) -> str:
    """Format a single ledger entry as YAML text."""
    lines = [
        f'  - date: "{entry["date"]}"',
        f'    experiment: {entry["experiment"]}',
        f'    resource: {entry["resource"]}',
        f'    amount: {entry["amount"]}',
        f'    detail: "{entry["detail"]}"',
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------

def audit_project(project_dir: Path, resource: str = "llm_api_calls") -> list[dict]:
    """Audit existing ledger entries against CSV-derived consumption.

    Returns list of discrepancy dicts.
    """
    experiments = find_experiments(project_dir)
    ledger_entries = read_ledger(project_dir)
    discrepancies = []

    for exp_dir in experiments:
        consumption = compute_experiment_consumption(exp_dir)
        if consumption is None:
            continue

        # Only audit completed/failed experiments (running may still have partial CSVs)
        if consumption["status"] not in ("completed", "failed"):
            continue

        csv_total = consumption["total_calls"]
        ledger_total = ledger_total_for_experiment(ledger_entries, exp_dir.name, resource)

        if csv_total != ledger_total:
            discrepancies.append({
                "experiment": exp_dir.name,
                "csv_derived": csv_total,
                "ledger_recorded": int(ledger_total),
                "difference": csv_total - int(ledger_total),
                "status": consumption["status"],
                "detail": f"CSV: {consumption['total_rows']} rows × {consumption['n_runs']} n_runs = {csv_total}; ledger: {int(ledger_total)}",
            })

    return discrepancies


# ---------------------------------------------------------------------------
# Display
# ---------------------------------------------------------------------------

def print_consumption_report(consumptions: list[dict], project_dir: Path, resource: str) -> None:
    """Print human-readable consumption report."""
    print(f"\n{'='*60}")
    print(f"  Auto-ledger: {project_dir.name}")
    print(f"{'='*60}\n")

    if not consumptions:
        print("No experiments with result CSVs found.\n")
        return

    total_calls = 0
    for c in consumptions:
        icon = {"completed": "+", "failed": "x", "running": "~", "planned": " "}.get(c["status"], "?")
        print(f"  [{icon}] {c['experiment']} ({c['status']})")
        for csv_info in c["csv_files"]:
            print(f"      {csv_info['file']}: {csv_info['rows']} rows")
        print(f"      n_runs: {c['n_runs']}")
        print(f"      Total: {c['total_rows']} rows × {c['n_runs']} = {c['total_calls']} {resource}")
        total_calls += c["total_calls"]
        print()

    # Budget context
    resources = read_budget_resources(project_dir)
    if resource in resources:
        limit = resources[resource].get("limit", 0)
        unit = resources[resource].get("unit", "")
        print(f"  CSV-derived total: {total_calls} {unit}")
        print(f"  Budget limit: {limit} {unit}")
        remaining = limit - total_calls
        pct = round(100 * total_calls / limit, 1) if limit > 0 else 0
        status = "OVER BUDGET" if remaining < 0 else "within budget"
        print(f"  Status: {total_calls}/{limit} ({pct}%) — {status}")
        if remaining < 0:
            print(f"  Overspend: {-remaining} {unit}")
    print()


def print_audit_report(discrepancies: list[dict]) -> None:
    """Print human-readable audit report."""
    if not discrepancies:
        print("  Audit: No discrepancies found. Ledger matches CSV-derived totals.\n")
        return

    print(f"  Audit: {len(discrepancies)} discrepancy(ies) found:\n")
    for d in discrepancies:
        direction = "UNDER" if d["difference"] > 0 else "OVER"
        print(f"  [{direction}] {d['experiment']}")
        print(f"      CSV-derived: {d['csv_derived']} calls")
        print(f"      Ledger:      {d['ledger_recorded']} calls")
        print(f"      Difference:  {d['difference']:+d} calls")
        print(f"      Detail:      {d['detail']}")
        print()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate and audit ledger entries from experiment result CSVs"
    )
    parser.add_argument("path", type=Path,
                        help="Project directory or single experiment directory")
    parser.add_argument("--resource", default="llm_api_calls",
                        help="Resource type for ledger entries (default: llm_api_calls)")
    parser.add_argument("--audit", action="store_true",
                        help="Audit existing ledger against CSV-derived totals")
    parser.add_argument("--yaml", action="store_true",
                        help="Output entries as YAML (ready to append to ledger.yaml)")
    parser.add_argument("--json", action="store_true",
                        help="Output as JSON")
    args = parser.parse_args()

    if not args.path.exists():
        print(f"Error: {args.path} does not exist", file=sys.stderr)
        return 1

    project_dir = find_project_dir(args.path)
    experiments = find_experiments(args.path)

    # Compute consumption for all experiments
    consumptions = []
    for exp_dir in experiments:
        consumption = compute_experiment_consumption(exp_dir)
        if consumption is not None:
            consumptions.append(consumption)

    if args.audit:
        discrepancies = audit_project(project_dir, args.resource)
        if args.json:
            print(json.dumps(discrepancies, indent=2))
        else:
            print_consumption_report(consumptions, project_dir, args.resource)
            print_audit_report(discrepancies)
        return 1 if discrepancies else 0

    if args.json:
        print(json.dumps(consumptions, indent=2))
        return 0

    if args.yaml:
        entries = [generate_entry(c, args.resource) for c in consumptions]
        for entry in entries:
            print(format_yaml_entry(entry))
        return 0

    # Default: human-readable report
    print_consumption_report(consumptions, project_dir, args.resource)

    # Also show generated entries
    if consumptions:
        print("Generated ledger entries (append to ledger.yaml):\n")
        entries = [generate_entry(c, args.resource) for c in consumptions]
        for entry in entries:
            print(format_yaml_entry(entry))
            print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
