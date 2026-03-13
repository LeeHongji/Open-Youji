# ADR-0005: Project resource and time constraints

Date: 2026-03-13
Status: accepted
Adapted from: OpenAkari ADR-0006

## Context

Youji operates autonomously on a Claude Max plan, which provides generous but finite session capacity. Without explicit resource tracking, sessions can over-consume API calls, compute time, or context on a single project without awareness of cumulative spending. Projects that involve experiments (API calls, model evaluations, data processing) need a mechanism to say "this project has X resources and must finish by date Y."

## Decision

### Budget convention per project

Projects that consume external resources (API calls, compute, paid services) should declare constraints in a `budget.yaml` file:

```yaml
limits:
  api_calls: 5000
  deadline: 2026-04-15T00:00:00Z
notes: "Covers evaluation runs for the benchmark study"
```

A companion `ledger.yaml` tracks consumption as an append-only log:

```yaml
entries:
  - date: 2026-03-14
    type: api_calls
    amount: 120
    source: experiments/eval-run-01
    note: "Initial evaluation batch"
```

### Enforcement layers

1. **Convention**: Sessions read `budget.yaml` before planning resource-consuming work.
2. **Orient check**: The orient skill reports budget status for the selected project.
3. **Session discipline**: If work would exceed remaining budget, scale down or flag for researcher review.

### Zero-resource work is exempt

Work that consumes no external resources (analysis, documentation, planning, literature review) proceeds regardless of budget status. Use the resource-signal checklist:
1. Does the task call any language model API?
2. Does the task call any third-party API?
3. Does the task run compute-intensive processes?
4. Does the task involve processes expected to run >10 minutes?

If all answers are no, the work is zero-resource and exempt from budget gates.

### Fresh-start accounting

Historical consumption before `budget.yaml` creation does not count. The ledger starts empty when the budget is declared.

## Consequences

- Projects with resource budgets get explicit tracking across sessions
- The researcher sets budgets; Youji respects them autonomously
- Zero-resource work (analysis, documentation, planning) continues even when budget is exhausted
- Budget status is surfaced during orientation, preventing accidental overspend
- Deadlines use ISO 8601 datetime for unambiguous interpretation
