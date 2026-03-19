#!/usr/bin/env python3
"""Verify and reconcile resource consumption against CF gateway logs and result artifacts."""

import argparse
import csv
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import yaml


# ---------------------------------------------------------------------------
# CF Gateway API
# ---------------------------------------------------------------------------

CF_ACCOUNT = os.environ.get(
    "CF_ACCOUNT_ID", "<your-cloudflare-account-id>"
)
CF_GATEWAY = os.environ.get("CF_GATEWAY_NAME", "research")
CF_TOKEN = os.environ.get("CF_TOKEN", "")

# Maps budget resource types → CF gateway provider names.
# Each resource type can map to one or more gateway providers.
RESOURCE_PROVIDER_MAP = {
    "llm_api_calls": ["openai", "google-ai-studio", "anthropic"],
    "gen_3d_api_calls": ["custom-baihai"],
}


def _build_api_url() -> str:
    return (
        f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}"
        f"/ai-gateway/gateways/{CF_GATEWAY}/logs"
    )


def _fetch_gateway_page(
    page: int = 1,
    per_page: int = 50,
    provider: Optional[str] = None,
    success: Optional[bool] = None,
) -> dict:
    params = f"per_page={per_page}&page={page}"
    if provider:
        params += f"&provider={provider}"
    if success is not None:
        params += f"&success={'true' if success else 'false'}"
    url = f"{_build_api_url()}?{params}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {CF_TOKEN}",
        "User-Agent": "budget-verify/1.0",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def gateway_count(
    provider: Optional[str] = None,
    success: Optional[bool] = None,
) -> int:
    """Get total log count for a provider (fast — single API call)."""
    data = _fetch_gateway_page(1, 1, provider=provider, success=success)
    return data.get("result_info", {}).get("total_count", 0)


def gateway_fetch_all(
    provider: Optional[str] = None,
    success: Optional[bool] = None,
    max_pages: int = 100,
) -> list[dict]:
    """Fetch all gateway logs for a provider. Use only when count is manageable."""
    all_logs: list[dict] = []
    for page in range(1, max_pages + 1):
        data = _fetch_gateway_page(page, 50, provider=provider, success=success)
        logs = data.get("result", [])
        if not logs:
            break
        all_logs.extend(logs)
        total = data.get("result_info", {}).get("total_count", 0)
        if len(all_logs) >= total:
            break
    return all_logs


# ---------------------------------------------------------------------------
# Result CSV counting
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


def count_experiment_csv_calls(experiment_dir: Path) -> dict[str, int]:
    """Count API calls from result CSVs in an experiment."""
    results_dir = experiment_dir / "results"
    if not results_dir.exists():
        return {}
    counts = {}
    for csv_file in sorted(results_dir.glob("*.csv")):
        counts[csv_file.name] = count_csv_rows(csv_file)
    return counts


# ---------------------------------------------------------------------------
# Budget / ledger
# ---------------------------------------------------------------------------

def read_yaml(path: Path) -> dict:
    if not path.exists():
        return {}
    with open(path) as f:
        return yaml.safe_load(f) or {}


def compute_ledger_totals(ledger: dict) -> dict[str, float]:
    """Sum ledger entries by resource type."""
    totals: dict[str, float] = {}
    for entry in ledger.get("entries", []) or []:
        resource = entry.get("resource", "unknown")
        totals[resource] = totals.get(resource, 0) + entry.get("amount", 0)
    return totals


# ---------------------------------------------------------------------------
# Experiment parsing
# ---------------------------------------------------------------------------

def parse_experiment_status(experiment_dir: Path) -> str:
    exp_md = experiment_dir / "EXPERIMENT.md"
    if not exp_md.exists():
        return "unknown"
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
    return "unknown"


# ---------------------------------------------------------------------------
# Project-level verification
# ---------------------------------------------------------------------------

def verify_project(
    project_dir: Path,
    fetch_gateway: bool = True,
) -> dict:
    """Full budget verification for a project."""
    budget = read_yaml(project_dir / "budget.yaml")
    ledger = read_yaml(project_dir / "ledger.yaml")
    ledger_totals = compute_ledger_totals(ledger)

    # Find all experiments
    experiments_dir = project_dir / "experiments"
    exp_results = []
    total_csv_calls = 0
    if experiments_dir.exists():
        for exp_dir in sorted(experiments_dir.iterdir()):
            if not exp_dir.is_dir() or not (exp_dir / "EXPERIMENT.md").exists():
                continue
            status = parse_experiment_status(exp_dir)
            csv_counts = count_experiment_csv_calls(exp_dir)
            csv_total = sum(csv_counts.values())
            total_csv_calls += csv_total
            exp_results.append({
                "experiment": exp_dir.name,
                "status": status,
                "csv_counts": csv_counts,
                "csv_total": csv_total,
            })

    # Gateway counts per resource type
    gateway_data = {}
    if fetch_gateway and CF_TOKEN:
        for resource_type, providers in RESOURCE_PROVIDER_MAP.items():
            total = 0
            successful = 0
            by_model = {}
            cost = 0.0
            for prov in providers:
                try:
                    prov_total = gateway_count(provider=prov)
                    prov_success = gateway_count(provider=prov, success=True)
                    total += prov_total
                    successful += prov_success
                    # Fetch detailed logs only for LLM calls (small count)
                    if resource_type == "llm_api_calls" and prov_total <= 5000:
                        logs = gateway_fetch_all(provider=prov)
                        for log in logs:
                            model = log.get("model", "unknown")
                            by_model[model] = by_model.get(model, 0) + 1
                            cost += log.get("cost", 0) or 0
                except Exception as e:
                    by_model[f"error:{prov}"] = str(e)
            gateway_data[resource_type] = {
                "total": total,
                "successful": successful,
                "failed": total - successful,
                "by_model": by_model,
                "cost_usd": round(cost, 4),
            }

    # Budget status
    resources = budget.get("resources", {})
    budget_status = {}
    for rtype, rconfig in resources.items():
        limit = rconfig.get("limit", 0)
        ledgered = ledger_totals.get(rtype, 0)
        gw = gateway_data.get(rtype, {})
        budget_status[rtype] = {
            "limit": limit,
            "unit": rconfig.get("unit", ""),
            "ledgered": ledgered,
            "gateway_successful": gw.get("successful"),
            "gateway_total": gw.get("total"),
            "gateway_failed": gw.get("failed"),
            "remaining_by_ledger": limit - ledgered,
        }

    # Deadline
    deadline_raw = budget.get("deadline")
    deadline = str(deadline_raw) if deadline_raw else None
    time_remaining = None
    if deadline_raw:
        try:
            if isinstance(deadline_raw, datetime):
                dl = deadline_raw.replace(tzinfo=timezone.utc) if deadline_raw.tzinfo is None else deadline_raw
            else:
                dl = datetime.fromisoformat(str(deadline_raw).replace("Z", "+00:00"))
            hours = (dl - datetime.now(timezone.utc)).total_seconds() / 3600
            time_remaining = f"{hours:.1f}h" if hours > 0 else "EXPIRED"
        except Exception:
            pass

    return {
        "project": project_dir.name,
        "budget_status": budget_status,
        "deadline": deadline,
        "time_remaining": time_remaining,
        "ledger_totals": ledger_totals,
        "csv_total_calls": total_csv_calls,
        "gateway": gateway_data,
        "experiments": exp_results,
    }


# ---------------------------------------------------------------------------
# Display
# ---------------------------------------------------------------------------

def print_report(report: dict) -> None:
    print(f"\n{'='*60}")
    print(f"  Budget Verification: {report['project']}")
    print(f"{'='*60}\n")

    # Budget
    print("Budget:")
    for rtype, s in report.get("budget_status", {}).items():
        line = f"  {rtype}: {s['ledgered']}/{s['limit']} {s['unit']}"
        if s.get("gateway_successful") is not None:
            line += f"  (gateway: {s['gateway_successful']} ok, {s['gateway_failed']} err)"
        print(line)
    if report.get("deadline"):
        print(f"  Deadline: {report['deadline']} ({report.get('time_remaining', '?')} left)")
    print()

    # Gateway detail
    for rtype, gw in report.get("gateway", {}).items():
        print(f"Gateway [{rtype}]:")
        print(f"  Total: {gw['total']}  Successful: {gw['successful']}  Failed: {gw['failed']}")
        if gw.get("cost_usd"):
            print(f"  Cost: ${gw['cost_usd']:.4f}")
        if gw.get("by_model"):
            print(f"  By model:")
            for model, count in sorted(gw["by_model"].items(), key=lambda x: -x[1]):
                print(f"    {model}: {count}")
        print()

    # Experiments
    print("Experiments:")
    icons = {"completed": "+", "failed": "x", "running": "~", "planned": " ", "abandoned": "-"}
    for exp in report.get("experiments", []):
        icon = icons.get(exp["status"], "?")
        print(f"  [{icon}] {exp['experiment']} ({exp['status']})")
        if exp.get("csv_counts"):
            for fname, count in exp["csv_counts"].items():
                print(f"      {fname}: {count} rows")
            print(f"      Total: {exp['csv_total']} API calls")
        elif exp["status"] in ("completed", "failed"):
            print(f"      No result CSVs")
    print()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Verify project resource consumption against CF gateway and CSV artifacts"
    )
    parser.add_argument("project_dir", type=Path,
                        help="Path to project directory")
    parser.add_argument("--no-gateway", action="store_true",
                        help="Skip CF gateway query (offline mode)")
    parser.add_argument("--json", action="store_true",
                        help="Output as JSON")
    args = parser.parse_args()

    if not args.project_dir.exists():
        print(f"Error: {args.project_dir} does not exist", file=sys.stderr)
        sys.exit(1)

    global CF_TOKEN
    if not CF_TOKEN and not args.no_gateway:
        env_path = args.project_dir.parent.parent / "infra" / "experiment-pipeline" / ".env"
        if env_path.exists():
            with open(env_path) as f:
                for line in f:
                    if line.startswith("CF_TOKEN="):
                        CF_TOKEN = line.strip().split("=", 1)[1]
                        break

    report = verify_project(args.project_dir, fetch_gateway=not args.no_gateway)

    if args.json:
        print(json.dumps(report, indent=2, default=str))
    else:
        print_report(report)


if __name__ == "__main__":
    main()
