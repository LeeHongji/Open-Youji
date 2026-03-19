Design pattern for multi-layer resource budget enforcement preventing uncontrolled API spending.

<!-- staleness-signal: layered-budget-enforcement-refs
     source-files: CLAUDE.md, decisions/0006-resource-constraints.md, decisions/0027-experiment-resource-safeguards.md, infra/scheduler/src/budget-gate.ts, infra/experiment-runner/run.py, infra/experiment-validator/validate.py
     last-verified: 2026-02-20
     enforcement-layers: convention, validation, pre-execution-gate, scheduler-gate
     budget-files: budget.yaml, ledger.yaml -->

# Pattern: Layered Budget Enforcement

## Summary

Resource budgets are enforced through four complementary layers — convention (agents check budgets before planning), validation (commit-time consistency checks), pre-execution gates (experiment runner budget check), and scheduler gates (session-level budget check). Defense in depth compensates for any single layer's failure.

## Problem

LLM agents operating autonomously can consume expensive API calls rapidly. A single misconfigured experiment consumed 2,735 API calls (37% over budget) before anyone noticed. The root causes revealed that no single enforcement mechanism is sufficient:

1. **Convention failure**: the agent was supposed to check budget before running, but "implementation momentum" caused it to skip the check.
2. **Estimation error**: the agent miscounted required API calls (assumed 78 evaluations, actual 156 — missed C(4,2)=6 pairs per task).
3. **Ledger error**: consumption tracking had 328% error (counted CSV rows, not rows × n_runs).
4. **No automated gate**: nothing blocked the experiment from running even though budget was exceeded.

The lesson: budget enforcement must operate at multiple layers so that when one layer fails (and it will), another catches the overspend.

## Solution

### Four enforcement layers

| Layer | Mechanism | When it acts | What it catches |
|---|---|---|---|
| **L2: Convention** | Agents read `budget.yaml` before planning | During task classification | Prevents most overspends through awareness |
| **L0: Validation** | `pixi run validate` checks ledger consistency | At commit time | Catches ledger errors, budget exceedances after the fact |
| **L0: Pre-execution gate** | Experiment runner `--project-dir` flag | Before experiment starts | Blocks experiments when budget is exhausted |
| **L0: Scheduler gate** | `budget-gate.ts` in scheduler | Before session starts | Blocks entire sessions for budget-exhausted projects |

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

If ANY answer is yes → `consumes_resources: true` → apply budget check protocol.
If ALL answers are no → exempt from budget gates.

### Fresh-start accounting

Historical consumption (pre-budget experiments) does not count. The ledger starts empty when `budget.yaml` is created. This lets humans set budgets that reflect remaining work, not total project history.

### Zero-resource exemption

Work tagged `[zero-resource]` or with `consumes_resources: false` proceeds even when budget is exhausted. This ensures the system can always produce knowledge through analysis, documentation, and planning — even when it can't run experiments.

### Experiment runner safeguards (ADR 0027)

The experiment runner (`infra/experiment-runner/run.py`) adds several resource protection mechanisms:

- **`--project-dir`**: enables budget pre-check AND post-completion consumption audit
- **`--max-retries`**: explicit retry limit (never rely on defaults)
- **`--watch-csv` + `--total`**: enables retry progress guard (detects stalled retries)
- **Canary execution**: runs a single item first to catch configuration errors before full-scale runs
- **Log error detection**: scans output for error patterns, tracebacks, GPU errors

## Forces and trade-offs

### Defense in depth vs. complexity

Four enforcement layers create redundancy — the budget overspend incident would have been caught by any of the three L0 layers that didn't exist yet. But four layers also create complexity: agents must understand which layer applies when, and infra developers must maintain four codepaths.

### Convention as first line of defense

Despite being the "weakest" layer (advisory, not enforced), convention is the most cost-effective. When agents check budget during orient, they avoid planning work that will be blocked later. The L0 gates are safety nets, not primary controls.

### Real-time vs. checkpoint enforcement

Budget is checked at session start and experiment start, not during execution. A long experiment that runs over budget within a session won't be stopped mid-run. Real-time enforcement would require injecting budget checks into experiment scripts, adding complexity for marginal benefit (most experiments complete quickly).

### Human bottleneck for increases

Budget limits are set by humans and increases require approval. This creates a throughput bottleneck: if the human checks the approval queue once daily, budget-blocked work waits up to 24 hours. The trade-off is intentional — budget limits are the primary mechanism for human oversight of resource consumption.

## Evidence

**Budget overspend incident:** The triggering event (2,735/2,000 calls, 37% over) had root causes: (1) design estimate error (assumed 78 evals, actual 156 — missed C(4,2)=6 pairs), (2) ledger undercount (328% error — counted CSV rows, not rows × n_runs), (3) no automated pre-check. Post-incident, four enforcement layers were added. Projects have since managed budget increases via the approval queue with zero post-enforcement overspends.

**Simulation game:** Budget enforcement works identically with simulated resources (300 simulation calls, 800 cost units). The scheduler's budget gate checked all sim-game sessions and allowed them. This validates that the enforcement mechanism is project-agnostic.

**youji:** The infrastructure project has no budget.yaml (no resource-consuming work), but the enforcement code lives in youji's `infra/scheduler/` and `infra/experiment-runner/`. 748 tests across 58 test files cover the enforcement code. The experiment runner test suite (83 tests) specifically covers retry progress guards, consumption audits, budget pre-checks, canary execution, and log error detection.

**Measured metrics (at 83 sessions):**
- Budget gate checks: 83/83 sessions checked, 0 blocked (all within budget or zero-resource)
- Post-enforcement overspend incidents: 0 (vs. 1 pre-enforcement)
- Budget increase approvals: 4 processed through approval queue
- Total resource consumption tracked: 14,395 LLM API calls across 7 experiments
- Experiment runner test coverage: 83 tests across 12 test classes (ADR 0027)

## CI layer analysis

- **L0 (Code)**: experiment runner pre-check, scheduler budget gate, commit-time validator — runtime enforcement that blocks actions.
- **L2 (Convention)**: agents read budget during orient, resource-signal checklist, inline ledger entries — planning-stage checks that prevent most overspends.
- **L5 (Human)**: setting budget limits, approving increases, reviewing consumption — strategic control over resource allocation.

The pattern demonstrates effective **cross-layer reinforcement**: L2 conventions prevent most problems, L0 code catches what conventions miss, L5 humans set the boundaries.

## Known limitations

1. **No real-time tracking.** Budget is checked at session start and experiment start, not during execution. A long experiment that runs over budget within a session won't be stopped mid-run.

2. **Ledger accuracy depends on convention.** Agents must append entries to `ledger.yaml` inline. If they forget, the ledger undercounts (as happened pre-convention).

3. **Human bottleneck for increases.** Budget increases require approval queue → human review. Latency depends on human availability.

4. **Estimation remains manual.** Agents estimate API call counts before experiments. The C(4,2) miscalculation shows this is error-prone. No automated estimation tool exists.

## Self-evolution gaps

- **Human-dependent**: Budget limits and increases are set by humans. The system cannot self-adjust its own resource allocation.
- **Self-diagnosable**: Budget consumption, overspend incidents, and gate activation rates are all mechanically measurable. The system can detect its own resource health.
- **Gap**: No mechanism to detect when budget estimates are systematically wrong. The system could track estimate-vs-actual ratios across experiments to calibrate future estimates — but doesn't yet.

## Open questions

1. **Should budget estimation be automated?** Given the estimation error that caused the overspend, could the experiment runner estimate API calls from config parameters (task count × pairs × n_runs × judges)?

2. **Is four layers the right number?** Adding more layers increases safety but also complexity and maintenance burden. Is there a layer that could be removed without increasing risk?

3. **How should the system handle budget approaching exhaustion?** Currently, agents continue full-cost experiments until budget is gone. Should there be a "conservation mode" that switches to lower-cost approaches when budget is >80% consumed?

## Related patterns

- **Autonomous Execution** ([patterns/autonomous-execution.md](autonomous-execution.md)) — budget enforcement is embedded in the autonomous execution protocol (orient checks budget, classify gates resource work).
- **Structured Work Records** ([patterns/structured-work-records.md](structured-work-records.md)) — the `consumes_resources` field enables selective enforcement.
- **Gravity-Driven Migration** ([patterns/gravity-driven-migration.md](gravity-driven-migration.md)) — budget enforcement is itself a gravity cascade: human diagnosis → convention → code gates.

## References

- Decision record: [decisions/0006-resource-constraints.md](../../../decisions/0006-resource-constraints.md)
- Resource safeguards: [decisions/0027-experiment-resource-safeguards.md](../../../decisions/0027-experiment-resource-safeguards.md)
- Budget gate: [infra/scheduler/src/budget-gate.ts](../../../infra/scheduler/src/budget-gate.ts)
- Experiment runner: [infra/experiment-runner/run.py](../../../infra/experiment-runner/run.py)
- Runner test suite: [architecture/experiment-runner-test-suite.md](../architecture/experiment-runner-test-suite.md)
- L0 enforcement: [architecture/l0-enforcement-layer.md](../architecture/l0-enforcement-layer.md)
- Overspend incident: See internal project log entries for examples.
