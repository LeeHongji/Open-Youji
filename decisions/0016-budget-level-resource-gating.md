# 0016: Budget-Level Resource Gating

Date: 2026-02-17
Status: accepted

## Context

The approval gates included a per-experiment cost threshold: any experiment estimated at >$5 or >500 API calls required human approval. This threshold was set when the repo had no project-level budget tracking. After introducing `budget.yaml` and `ledger.yaml` (decision 0006), projects gained cumulative budget enforcement — making the per-experiment threshold redundant and counterproductive.

The per-experiment gate caused friction: agents had to queue every non-trivial experiment for approval, even when the project had ample budget remaining. This added latency (up to 24h per approval cycle) without proportional safety benefit, since the project budget already caps total spend.

Additionally, the >$5 threshold was noted as "uncomputable pre-execution" in diagnosis-2026-02-16 — agents track API calls, not dollars, making the dollar-denominated half of the gate unreliable.

## Decision

Removed the per-experiment cost threshold (>$5 or >500 API calls). Resource decision approval is now required only when:

1. **Requesting a budget increase** — modifying `budget.yaml` limits upward.
2. **Requesting a deadline extension** — modifying `budget.yaml` deadline.

Experiments within remaining project budget proceed autonomously. If an experiment would exceed the remaining budget, the agent must either scale down to fit or request a budget increase via `APPROVAL_QUEUE.md`.

Supersedes the resource decision gate in decisions 0005, 0006, and 0011.

## Consequences

- Agents can run experiments autonomously as long as they stay within the project's approved budget — no per-experiment approval delay.
- Human control is preserved through budget-setting: humans define the total envelope, agents operate within it.
- The approval queue is used less frequently for routine experiments, reducing latency.
- Risk: a single expensive experiment could consume most of a project's budget in one session. Mitigated by: budget validation at commit time, Slack alerts at >90% consumption, and agent convention to check remaining budget before planning experiments.
- Projects without a `budget.yaml` have no resource gate at all — this is intentional (such projects are either analysis-only or not yet scoped).
