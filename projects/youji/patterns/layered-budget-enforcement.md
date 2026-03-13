Design pattern for multi-layer resource budget enforcement preventing uncontrolled API spending.

# Pattern: Layered Budget Enforcement

## Summary

Resource budgets are enforced through complementary layers — convention (agents check budgets before planning), validation (consistency checks), and orient-step checks (session-level budget verification). Defense in depth compensates for any single layer's failure. Code-level enforcement (scheduler budget gate, pre-execution checks) is a future goal.

## Problem

LLM agents operating autonomously can consume expensive API calls rapidly. Without enforcement, a single misconfigured experiment can exceed budget significantly before anyone notices. The root causes reveal that no single enforcement mechanism is sufficient:

1. **Convention failure**: the agent was supposed to check budget before running, but "implementation momentum" caused it to skip the check.
2. **Estimation error**: the agent miscounted required API calls (combinatorial miscalculation, wrong multipliers).
3. **Ledger error**: consumption tracking had significant error (wrong counting methodology).
4. **No automated gate**: nothing blocked the experiment from running even though budget was exceeded.

The lesson: budget enforcement must operate at multiple layers so that when one layer fails (and it will), another catches the overspend.

## Solution

### Enforcement layers

Youji currently operates with convention-level and orient-check enforcement. Code-level enforcement is planned:

| Layer | Mechanism | When it acts | What it catches | Status |
|---|---|---|---|---|
| **L2: Convention** | Agents read `budget.yaml` before planning | During task classification | Prevents most overspends through awareness | Active |
| **L2: Orient check** | Orient step reports budget status | At session start | Catches budget-exhausted projects before work begins | Active |
| **L0: Validation** | Commit-time consistency checks | At commit time | Catches ledger errors, budget exceedances after the fact | Future |
| **L0: Scheduler gate** | Budget gate in scheduler | Before session starts | Blocks entire sessions for budget-exhausted projects | Future |

### Budget and ledger files

**`budget.yaml`** — declares resource limits and deadline. Set by humans; modifying is a structural change requiring approval.

```yaml
resources:
  llm_api_calls:
    limit: 20000
    unit: calls
deadline: 2026-03-01T00:00:00Z
```

**`ledger.yaml`** — append-only consumption log. Agents append entries inline during execution.

```yaml
entries:
  - date: "2026-02-16"
    experiment: strategic-100-v2
    resource: llm_api_calls
    amount: 90
    detail: "30 calls x 3 judges"
```

### Resource-signal checklist

Before planning any task, agents determine whether it consumes resources:

1. LLM API calls?
2. External API calls?
3. GPU compute?
4. Long-running compute (>10 min)?

If ANY answer is yes -> `consumes_resources: true` -> apply budget check protocol.
If ALL answers are no -> exempt from budget gates.

### Fresh-start accounting

Historical consumption (pre-budget experiments) does not count. The ledger starts empty when `budget.yaml` is created. This lets humans set budgets that reflect remaining work, not total project history.

### Zero-resource exemption

Work tagged `[zero-resource]` or with `consumes_resources: false` proceeds even when budget is exhausted. This ensures the system can always produce knowledge through analysis, documentation, and planning — even when it can't run experiments.

## Forces and trade-offs

### Defense in depth vs. complexity

Multiple enforcement layers create redundancy — a budget overspend incident would be caught by any of the operational layers. But multiple layers also create complexity: agents must understand which layer applies when.

### Convention as first line of defense

Despite being the "weakest" layer (advisory, not enforced), convention is the most cost-effective. When agents check budget during orient, they avoid planning work that will be blocked later. Code-level gates are safety nets, not primary controls.

### Real-time vs. checkpoint enforcement

Budget is checked at session start, not during execution. A long experiment that runs over budget within a session won't be stopped mid-run. Real-time enforcement would require injecting budget checks into experiment scripts, adding complexity for marginal benefit (most experiments complete quickly).

### Human bottleneck for increases

Budget limits are set by humans and increases require approval. This creates a throughput bottleneck: if the human checks the approval queue once daily, budget-blocked work waits up to 24 hours. The trade-off is intentional — budget limits are the primary mechanism for human oversight of resource consumption.

## Evidence

Evidence from the OpenAkari system:

**Budget overspend incident:** A triggering event (37% over budget) had root causes: design estimate error, ledger undercount, and no automated pre-check. Post-incident, multiple enforcement layers were added. Projects managed budget increases via the approval queue with zero post-enforcement overspends.

**Zero-resource exemption:** Budget enforcement works identically with simulated resources. The enforcement mechanism is project-agnostic.

Youji-specific evidence will be collected as operational history accumulates. Key metrics to track: budget gate activation rate, overspend incidents, budget increase approval latency, estimate-vs-actual accuracy.

## CI layer analysis

- **L0 (Code)**: planned — scheduler budget gate, commit-time validator (future).
- **L2 (Convention)**: agents read budget during orient, resource-signal checklist, inline ledger entries — planning-stage checks that prevent most overspends.
- **L5 (Human)**: setting budget limits, approving increases, reviewing consumption — strategic control over resource allocation.

The pattern demonstrates effective **cross-layer reinforcement**: L2 conventions prevent most problems, L0 code (when implemented) catches what conventions miss, L5 humans set the boundaries.

## Known limitations

1. **No real-time tracking.** Budget is checked at session start, not during execution. A long experiment that runs over budget within a session won't be stopped mid-run.

2. **Ledger accuracy depends on convention.** Agents must append entries to `ledger.yaml` inline. If they forget, the ledger undercounts.

3. **Human bottleneck for increases.** Budget increases require approval queue -> human review. Latency depends on human availability.

4. **Estimation remains manual.** Agents estimate API call counts before experiments. Combinatorial miscalculations are common. No automated estimation tool exists.

5. **No code-level enforcement yet.** Youji currently relies on convention and orient checks. The scheduler budget gate and commit-time validator are future infrastructure goals.

## Self-evolution gaps

- **Human-dependent**: Budget limits and increases are set by humans. The system cannot self-adjust its own resource allocation.
- **Self-diagnosable**: Budget consumption, overspend incidents, and gate activation rates are all mechanically measurable. The system can detect its own resource health.
- **Gap**: No mechanism to detect when budget estimates are systematically wrong. The system could track estimate-vs-actual ratios across experiments to calibrate future estimates — but doesn't yet.

## Open questions

1. **Should budget estimation be automated?** Given estimation errors, could a tool estimate API calls from config parameters (task count x pairs x n_runs x judges)?

2. **When should code-level enforcement be built?** Convention-only enforcement works at small scale but becomes risky as session volume grows. What is the threshold where code-level gates become necessary?

3. **How should the system handle budget approaching exhaustion?** Currently, agents continue full-cost experiments until budget is gone. Should there be a "conservation mode" that switches to lower-cost approaches when budget is >80% consumed?

## Related patterns

- **Autonomous Execution** ([patterns/autonomous-execution.md](autonomous-execution.md)) — budget enforcement is embedded in the autonomous execution protocol (orient checks budget, classify gates resource work).
- **Structured Work Records** ([patterns/structured-work-records.md](structured-work-records.md)) — the `consumes_resources` field enables selective enforcement.
- **Gravity-Driven Migration** ([patterns/gravity-driven-migration.md](gravity-driven-migration.md)) — budget enforcement is itself a gravity cascade: human diagnosis -> convention -> code gates (future).
