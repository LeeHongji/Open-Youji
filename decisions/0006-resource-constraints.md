# 0006: Project Resource & Time Constraints

Date: 2026-02-15
Status: accepted

## Context

The youji repo has approval gates for resource decisions but no project-level budget tracking. Agents can freely consume resources across sessions without knowing the cumulative total or remaining allocation. As projects scale (e.g., a sample project planning a 4,320-call full evaluation), there's no mechanism to say "this project has X calls and must finish by date Y" and have that enforced.

## Decision

### Two files per project

**`budget.yaml`** declares resource limits and deadline. Set by humans; modifying it is a structural change requiring approval. **`ledger.yaml`** is an append-only consumption log written by agents during execution.

The validator computes totals from ledger entries and checks against budget limits. No cached totals — simplicity over performance.

### Fresh-start accounting

Historical consumption (pre-budget experiments) does not count against the budget. The ledger starts empty when `budget.yaml` is created. Old experiments are documented in their EXPERIMENT.md files but don't appear in the ledger. This avoids retroactive accounting disputes and lets humans set budgets that reflect remaining work, not total project history.

### Convention + validation enforcement

Enforcement is layered:
1. **Convention** (CLAUDE.md): agents read budget before planning experiments.
2. **Validation script**: `pixi run validate` checks sums ≤ limits and deadline.
3. **SOP steps**: orient reports budget status; classify catches over-budget experiments.
4. **Scheduler notification**: Slack alerts when >90% consumed or deadline <24h.

No hard runtime enforcement — agents follow convention, and validation catches mistakes at commit time. This matches the existing pattern for experiment validation.

### Wall-clock deadline

Deadlines are ISO 8601 datetimes. Work must complete by this time. This is simpler than tracking "agent hours" and matches how humans think about project timelines.

### Budget as the single resource gate

There is no per-experiment cost threshold. The project budget (declared in `budget.yaml`) is the single resource gate. Experiments that fit within remaining budget proceed autonomously. If an experiment would exceed the budget, the agent must scale down or request a budget increase via the approval queue.

## Consequences

- Agents can track and respect project resource limits across sessions.
- Humans set budgets once and get automatic enforcement + alerts.
- The validation script catches budget violations at commit time.
- Slack notifications surface budget warnings without requiring manual checking.
- New resource types are extensible — just add new keys to `budget.yaml`.
- The EXPERIMENT.md optional `## Cost` section connects individual experiment records to the ledger.
