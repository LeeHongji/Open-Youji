# 0007: Gateway-verified resource budgets

Date: 2026-02-16
Status: accepted

## Context

A sample project's budget tracking relied on manual ledger entries (agents self-reporting API call counts). This failed in practice:

1. The `model-comparison-focused` experiment crashed at 19% with no results saved and no ledger entry — ~15 API calls consumed with zero audit trail.
2. Earlier experiments consumed ~3,500+ API calls before `budget.yaml` existed, with no retrospective accounting possible.
3. Experiments were split across two different Cloudflare AI Gateway accounts (`research` and `youji`), and only one was API-queryable.
4. Some experiments routed Gemini calls direct to Google (no `--base-url`), bypassing the gateway entirely.

Manual self-reporting is inherently unreliable for autonomous agents. When an experiment crashes, the agent that launched it is gone — there's no one to write the ledger entry.

## Decision

1. **Single gateway**: All API calls (LLM and 3D generation) route through the `research` CF gateway (account `<your-cloudflare-account-id>`). The `youji` gateway is retired.

2. **Per-provider endpoints**: OpenAI calls use `/openai`, Gemini calls use `/google-ai-studio`. Both endpoints are on the same gateway and queryable with the same API token.

3. **Verification tool**: `infra/budget-verify/verify.py` cross-references three sources:
   - CF gateway logs (provider-filtered, via REST API)
   - Result CSV row counts (artifact-backed)
   - Ledger entries (declared)

4. **Resource type → provider mapping**: `budget.yaml` resource types map to CF gateway provider names. Currently: `llm_api_calls` → `[openai, google-ai-studio, anthropic]`, `gen_3d_api_calls` → `[custom-baihai]`. New resource types (GPU, 2D gen) get new mappings when their providers are added to the gateway.

5. **Experiments must use `--base-url`**: Every experiment run.sh must pass the gateway URL for every provider. No direct API calls.

## Consequences

- Budget verification is now machine-checkable, not trust-based.
- Failed experiments still leave an audit trail in gateway logs.
- The ledger becomes a convenience summary, not the source of truth.
- Adding new resource types (GPU, 2D generation) requires: (a) routing through the gateway, (b) adding the provider mapping to the verify script.
- The `youji` gateway's historical logs are inaccessible — those calls are unverifiable.
