Design pattern for autonomous LLM agent research sessions, extracted from youji's operating experience.

<!-- staleness-signal: autonomous-execution-refs
     source-files: docs/sops/autonomous-work-cycle.md, infra/scheduler/src/cli.ts, infra/scheduler/src/executor.ts, infra/scheduler/src/budget-gate.ts, infra/scheduler/src/verify.ts, infra/scheduler/src/evolution.ts
     last-verified: 2026-02-17
     scope-categories: ROUTINE, RESOURCE, STRUCTURAL-verifiable, STRUCTURAL-non-verifiable, EXTERNAL-blocking, EXTERNAL-non-blocking
     approval-gate-file: APPROVAL_QUEUE.md -->

# Pattern: Autonomous Execution

## Summary

Stateless LLM agents conduct research sessions on a repo without human initiation, following a fixed protocol that gates high-stakes decisions through an approval queue. The repo itself is the only shared state between sessions.

## Problem

LLM agents are stateless — each session starts from zero context. Research projects need continuous progress. Human-initiated sessions create a bottleneck: work only happens when a person is available to start and supervise a session.

The challenge is making agents autonomous while preventing three failure modes:
1. **Drift**: agents work on the wrong thing because they lack context.
2. **Thrash**: consecutive sessions undo each other's partial work.
3. **Uncontrolled risk**: agents make expensive or irreversible decisions without oversight.

## Solution

### The repo as cognitive state

The repo is both workspace and memory. Agents read the repo to orient, write to the repo to record, and commit to the repo as their only persistent output. No external databases, no session history, no workflow state files outside the repo.

Key state artifacts:
- **Project READMEs** — log entries (what happened), next actions (what to do), open questions (what's unknown)
- **`APPROVAL_QUEUE.md`** — pending requests for human decisions
- **Task lifecycle tags** — coordination markers in next-actions lists (`[in-progress: YYYY-MM-DD]`, `[blocked-by: ...]`, `[approval-needed]`, `[approved: YYYY-MM-DD]`)

### The five-step session protocol

Every autonomous session follows the same SOP ([docs/sops/autonomous-work-cycle.md](../../../docs/sops/autonomous-work-cycle.md)):

1. **Orient** — read status, project READMEs, approval queue, budgets. Produce a priority recommendation.
2. **Select task** — pick a concrete, unblocked task from a project's next-actions list. Skip in-progress and blocked tasks.
3. **Classify scope** — categorize the task as ROUTINE, RESOURCE, STRUCTURAL (verifiable or non-verifiable), or EXTERNAL.
4. **Execute** — if ROUTINE or STRUCTURAL-verifiable, do the work. Otherwise, write to `APPROVAL_QUEUE.md` and stop.
5. **Commit and close** — git commit, append a log entry with a machine-parseable metrics footer.

### Approval gates

The critical safety mechanism. Four scope categories determine what an agent may do autonomously:

| Scope | Examples | Agent action |
|---|---|---|
| ROUTINE | Documentation, analysis, log entries, running existing pipelines | Proceed |
| RESOURCE | Budget-exceeding work, budget increase or deadline extension requests | Write to approval queue, stop |
| STRUCTURAL (verifiable) | Infra code changes, decision records, validator extensions — correctness confirmed by static checks (types, tests, validators) | Proceed after verification |
| STRUCTURAL (non-verifiable) | New projects, CLAUDE.md edits, schema changes to external contracts — correctness requires human judgment | Write to approval queue, stop |
| EXTERNAL (blocking) | Resource decisions, governance changes | Write to approval queue, stop |
| EXTERNAL (non-blocking) | GitHub releases, version tags | Write to approval queue, continue |

ROUTINE and verifiable-STRUCTURAL work proceed without human sign-off. Git push does not require approval — sessions commit and push freely. The key principle: **if a machine can confirm the change is correct, gating on human review adds latency without safety value.** Non-verifiable structural changes — where correctness requires human judgment about intent, scope, or downstream effects — still go through the approval queue. GitHub releases and version tags require a non-blocking approval queue entry (write for visibility, but continue working).

### Scheduling

A minimal cron scheduler (`infra/scheduler/`) triggers sessions at fixed intervals (default: hourly, `0 * * * *`). Design choices:
- **Frequent, serialized sessions**: hourly cadence with serialized execution (one session at a time) balances throughput with anti-thrash.
- **Isolated sessions**: each session is a fresh `claude -p` invocation. No shared process state.
- **Push freely**: sessions commit and push without approval. No approval queue entry needed.

### Budget enforcement

Projects may declare resource budgets (`budget.yaml`) and track consumption (`ledger.yaml`), per [decisions/0006-resource-constraints.md](../../../decisions/0006-resource-constraints.md). The project budget is the single resource gate — there is no per-experiment cost threshold.

**How it works:**
- `budget.yaml` declares resource limits (e.g., 1000 LLM API calls) and an optional deadline. Set by humans; modifying it is a structural change requiring approval.
- `ledger.yaml` is an append-only consumption log. Agents append entries during execution (inline, not deferred).
- During orient, agents compute remaining budget per resource and time to deadline. If any resource is 100% consumed or the deadline has passed, the project is non-actionable.
- During classify, an experiment that would exceed remaining budget is classified as RESOURCE. The agent must scale down or request a budget increase via the approval queue.

**Fresh-start accounting:** historical consumption (pre-budget experiments) does not count. The ledger starts empty when `budget.yaml` is created. This lets humans set budgets that reflect remaining work, not total project history.

**Layered enforcement:** convention (agents read budget before planning), validation script (`pixi run validate`), SOP steps (orient reports status, classify catches overages), and scheduler notifications (Slack alerts at >90% consumption or <24h to deadline). No hard runtime enforcement — agents follow convention, validation catches mistakes at commit time.

### Session metrics

Every session log entry includes a structured footer:

```
Session-type: autonomous
Duration: <minutes>
Task-selected: <task description or "none">
Task-completed: yes | partial | no
Approvals-created: <count>
Files-changed: <count>
Commits: <count>
Resources-consumed: <resource: amount, ...> or "none"
Budget-remaining: <resource: remaining/limit, ...> or "n/a"
```

This enables future analysis of session efficiency without building dedicated tracking infrastructure.

## Forces and trade-offs

### Anti-drift: orient step
The orient step forces every session to read the current state before acting. This is expensive (many file reads) but prevents the agent from working on stale or incorrect assumptions. Without it, agents default to inventing plausible-sounding tasks.

### Anti-thrash: task lifecycle tags
Tags like `[in-progress: YYYY-MM-DD]` prevent two sessions from picking up the same task. `[blocked-by: ...]` prevents work on tasks whose prerequisites aren't met. The cost is coordination overhead in README files, but this is minimal compared to the cost of wasted sessions.

### Safety vs. throughput: approval gates
The gate boundary is **verifiability**: if static checks (type checker, tests, validators) can confirm a change is correct, it proceeds without approval. If correctness requires human judgment (intent, scope, downstream effects), it goes through the approval queue. This replaced an earlier design where all structural work required approval — that created unnecessary latency for infra improvements that were mechanically verifiable. Humans can still pre-approve work via `[approved: YYYY-MM-DD]` tags.

### Prompt directiveness
A critical empirical finding: referencing the SOP document is insufficient. Agents must receive an explicit enumeration of all expected steps in the session prompt. In prototype testing:
- Vague prompt ("Begin with /orient") → 2/7 SOP steps completed
- Explicit prompt (enumerate all 5 steps) → 7/7 SOP steps completed

This is a general principle for LLM agent workflows: **the invocation prompt must be as directive as the protocol requires**, not just a pointer to documentation.

## Evidence

### Prototype validation (2026-02-15)

Two runs tested the protocol end-to-end:

| Run | Prompt style | SOP steps completed | Duration | Outcome |
|---|---|---|---|---|
| 1 | Vague ("Begin with /orient") | 2/7 | 34s | Orient only, no task execution |
| 2 | Explicit (enumerate 5 steps) | 7/7 | 90s | Full cycle: orient → select → classify → execute → commit |

Run 2 committed 19 files (1,152 insertions) — the autonomous execution architecture itself. The task was simple (committing completed work), so this validates protocol adherence but not task difficulty handling.

### Observations from early sessions

1. **Scope classification has gray areas.** Run 2 classified "commit the architecture" as ROUTINE. Committing 1,152 insertions including a CLAUDE.md edit could arguably be STRUCTURAL. The agent's reasoning (completed work from a prior session, no new decisions) was defensible. This gray area needs monitoring.

2. **Session metrics footers are useful but imperfect.** The metrics footer from Run 2 reported 1 commit when 2 were actually made. Automated counting would be more reliable than self-reporting.

3. **Budget checks add minimal overhead.** Reading `budget.yaml` and `ledger.yaml` is fast. The enforcement value (preventing runaway spending) far outweighs the cost.

### Multi-backend resilience (2026-02-16)

The scheduler now supports both Claude SDK and Cursor Agent CLI backends, with automatic fallback. When Claude is unavailable (rate limits, usage caps), sessions transparently retry on Cursor. This addresses a practical availability concern: autonomous sessions should not silently fail because one provider is temporarily down. The `auto` mode makes backend selection invisible to the session protocol — the SOP and approval gates work identically regardless of which backend executes them.

## CI layer analysis

This pattern operates primarily at:
- **L2 (Convention)** — the SOP, lifecycle tags, and approval queue are conventions enforced through documentation and agent compliance.
- **L3 (Skill)** — the `/orient` skill encodes the judgment needed for Step 1. Task selection and scope classification require judgment that lives in the session prompt.
- **L5 (Human)** — humans set budgets, resolve approval queue items, and push commits. The pattern explicitly preserves human control at decision boundaries.

A notable absence: **L0 (Code)** enforcement is minimal. The protocol relies on agent compliance, not programmatic enforcement. A future evolution might validate session outputs (e.g., checking that a commit was actually made, that the log entry has a metrics footer) via post-session hooks.

## Known limitations

1. **Single-agent only.** The protocol assumes one session at a time. Concurrent sessions could pick up the same task despite lifecycle tags (race condition on file reads). The scheduler serializes execution to prevent this.

2. **No rollback mechanism.** If a session commits and pushes bad work, there's no automated way to revert. Humans must review commits. Git reflog and revert provide manual recovery paths.

3. **Approval queue latency.** Non-ROUTINE tasks are blocked until a human reviews the queue. If the human checks once daily, this adds up to 24 hours of latency. For time-sensitive work, this is a bottleneck.

4. **Self-reported metrics.** Agents report their own session duration, files changed, etc. These could be inaccurate. Automated metric collection (post-commit hooks, git diff counting) would be more reliable.

5. **No learning across sessions.** Each session starts fresh. Patterns that emerge across sessions (e.g., "task X is always blocked") are only visible to humans reading logs. The system doesn't automatically detect or act on cross-session patterns.

6. **Convention-only enforcement.** The protocol relies on agent compliance with documented conventions, not programmatic checks. An agent that ignores the SOP or misclassifies scope has no runtime guardrail. Post-session validation hooks could close this gap.

## Open questions about effectiveness

These are research questions the youji meta-project tracks. Answering them requires empirical data from multiple autonomous sessions.

1. **Does the protocol produce useful research work?** The prototype validated protocol adherence (7/7 SOP steps), but the task was trivial (committing already-completed work). Can agents autonomously execute substantive research tasks — literature reviews, data analyses, experiment design — at a quality level that advances the project?

2. **What is the right approval gate granularity?** The gates now split STRUCTURAL into verifiable (proceed) and non-verifiable (approve). The per-experiment cost threshold (>$5 or >500 calls) was removed in favor of budget-level gating — experiments within remaining project budget proceed autonomously, and approval is only needed for budget increases or deadline extensions. After more sessions, does this relaxation improve throughput without increasing risk? Are there cases where individual experiments should still be gated?

3. **How effective is task selection?** Agents pick tasks based on a priority heuristic (unblocked, concrete done-when, mission-aligned). Do they consistently pick the highest-value task? Do they ever pick tasks that turn out to be wasted effort? How often does an agent session end with "no actionable tasks"?

4. **Does the anti-thrash mechanism work?** Lifecycle tags prevent duplicate pickup, but do consecutive sessions build on each other's work, or do they produce disconnected increments? Does the log-as-memory mechanism actually transfer enough context for coherent multi-session projects?

5. **What is the minimum effective orient step?** Orient reads every project README, status.md, and approval queue — potentially hundreds of lines. Is all of that necessary? Could a lighter orient (e.g., only the recommended project's README) reduce cost without losing effectiveness?

6. **Do session metrics predict anything useful?** The metrics footer captures duration, task completion, file counts, and resource consumption. Across many sessions, do these metrics correlate with session quality? Can they identify failure modes (e.g., long sessions with no commits = thrashing)?

7. **How does budget enforcement affect research planning?** The resource constraint system (budget.yaml + ledger.yaml) is new. Does knowing the remaining budget cause agents to plan more efficiently, or does it cause them to be overly conservative? Does the deadline mechanism effectively prevent late-project waste?

Measurement plan: the youji project will track these questions across the first 10 autonomous sessions, using the session metrics footer as the primary data source and log entry quality as a subjective assessment.

## Related patterns

- **Skills Architecture** ([decisions/0003-skills-architecture.md](../../../decisions/0003-skills-architecture.md)) — the four-layer capability model (L0-L3) that determines where capabilities live. Autonomous execution is the protocol that activates these capabilities on a schedule.
- **Inline Logging** ([decisions/0004-inline-logging.md](../../../decisions/0004-inline-logging.md)) — the convention for recording discoveries immediately. Autonomous sessions depend on this to prevent knowledge loss between sessions.

## References

- Decision record: [decisions/0005-autonomous-execution.md](../../../decisions/0005-autonomous-execution.md)
- Resource constraints: [decisions/0006-resource-constraints.md](../../../decisions/0006-resource-constraints.md)
- SOP: [docs/sops/autonomous-work-cycle.md](../../../docs/sops/autonomous-work-cycle.md)
- Scheduler: [infra/scheduler/README.md](../../../infra/scheduler/README.md)
- Approval queue: [APPROVAL_QUEUE.md](../../../APPROVAL_QUEUE.md)
- Prototype results: [projects/youji/README.md](../README.md) log entry 2026-02-15 (e)
