# budget-verify

Verify and reconcile project resource consumption against Cloudflare AI Gateway logs and result artifacts.

## How it works

Three sources of truth, cross-referenced:

1. **CF Gateway logs** (primary) — every LLM API call routed through the gateway is logged with model, provider, tokens, cost, and timestamp. Queryable via REST API.
2. **Result CSV rows** (artifact-backed) — each row in an experiment's result CSV = 1 API call. Works for completed experiments only.
3. **Ledger entries** (declared) — manual/automated entries in `ledger.yaml`. Should match the above sources.

## Budget Status Dashboard

Quick visibility into resource consumption across all budgeted projects.

```bash
# All budgeted projects
pixi run budget-status
# or: python infra/budget-verify/budget-status.py

# Single project
pixi run budget-status -- projects/sample-project/

# JSON output
pixi run budget-status -- --json
```

Shows for each resource: limit, ledger total, CSV-derived total (for ledgered experiments only), discrepancy between ledger and CSV, pre-budget consumption (experiments without ledger entries), remaining budget, and overspend %. Exits with code 1 if any project is over budget or past deadline.

## Verification

```bash
# Full verification (queries CF gateway)
python infra/budget-verify/verify.py projects/sample-project/

# With time range filter
python infra/budget-verify/verify.py projects/sample-project/ \
  --start-date 2026-02-15T00:00:00Z \
  --end-date 2026-02-16T00:00:00Z

# Offline mode (CSV + ledger only, no gateway query)
python infra/budget-verify/verify.py projects/sample-project/ --no-gateway

# JSON output (for automation)
python infra/budget-verify/verify.py projects/sample-project/ --json
```

## Environment

- `CF_TOKEN` — Cloudflare API token (auto-loaded from `infra/experiment-pipeline/.env` if not set)
- `CF_ACCOUNT_ID` — Cloudflare account ID (default: research gateway account)
- `CF_GATEWAY_NAME` — Gateway name (default: `research`)

## Gateway routing requirement

For verifiable tracking, ALL experiment API calls must route through the CF research gateway:

- OpenAI models: `--base-url https://gateway.ai.cloudflare.com/v1/{account}/research/openai`
- Gemini models: `--base-url https://gateway.ai.cloudflare.com/v1/{account}/research/google-ai-studio`

See run.sh templates in experiment directories for examples.

## Resource types

Currently tracks `llm_api_calls`. The budget.yaml schema supports arbitrary resource types — future additions may include `gpu_hours`, `gen_3d_api_calls`, `gen_2d_api_calls`. Each type needs its own verification source (CF gateway covers LLM calls; other types need equivalent audit trails).

## Dependencies

- Python 3.10+
- PyYAML (`pip install pyyaml`)
- No other dependencies (uses stdlib urllib for CF API)
