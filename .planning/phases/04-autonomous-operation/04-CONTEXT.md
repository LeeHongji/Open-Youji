# Phase 4: Autonomous Operation - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Youji operates independently via cron-triggered wake-ups, proactively reports project status to the mentor in Slack, and enforces time-based resource budgets per project. This phase makes Youji self-driving — she checks on projects, reports changes, and stops workers when budgets are exhausted.

</domain>

<decisions>
## Implementation Decisions

### Cron schedule
- Youji wakes up every hour (cron: `0 * * * *`) to check all active projects
- Runs 24/7 — workers can do tasks overnight, Youji reports in the morning
- Full check scope: worker status + TASKS.md progress + pending approvals + time budget
- Only sends Slack DM when there are changes (new completions, failures, approvals needed, budget warnings). No noise if nothing changed.

### Time budget
- Unit: **hours per day per project** (e.g., project X gets 4 hours/day of agent compute)
- Default: **4 hours/day** (~16 worker sessions of 15 min each)
- Budget exceeded → stop the project's worker + notify mentor. Next day auto-resets.
- Adapt existing `budget.yaml` format: change resource unit from USD to `compute-minutes` (240 min = 4 hours)
- Adapt existing `budget-gate.ts`: check accumulated `durationMs` from `metrics.ts` for the current day
- Youji includes budget status in proactive reports (e.g., "Project X: 2.3h / 4h used today")

### Proactive reporting (from Phase 2/3 decisions)
- Format: concise mrkdwn for status, Block Kit for actions needing approval
- Report content: per-project summary (tasks completed since last report, worker status, blockers, budget)
- Living messages not needed for reports (reports are point-in-time snapshots)

### Claude's Discretion
- Exact cron job configuration and scheduler integration
- How to aggregate metrics by day for budget enforcement
- Report message formatting details
- Whether to use a dedicated "report" thread or top-level DM for proactive reports
- How to handle timezone for "daily" budget reset

</decisions>

<specifics>
## Specific Ideas

- The hourly check is Youji's "morning standup" — she surveys all projects and only speaks up when there's news
- Budget enforcement should feel like a helpful constraint, not a punishment: "Project X has used 3.8h of 4h today. Worker will stop at limit."
- Auto-reset at midnight (mentor's local timezone) keeps it simple

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `service.ts`: Scheduler polling loop — already has `checkAndRespawnWorkers()` running every 60s. Add cron-triggered director wake-up alongside.
- `metrics.ts`: `SessionMetrics` with `durationMs` field — sum by day for budget tracking
- `budget-gate.ts`: Budget enforcement gate — refactor from USD to compute-minutes
- `slack.ts`: Notification stubs — add `notifyProactiveReport()` stub
- `director.ts`: `handleDirectorMessage()` — reuse for cron-triggered "check all projects" session
- `worker-manager.ts`: `stopProject()` — called when budget exceeded

### Established Patterns
- Existing scheduler cron via `croner` library and `jobs.json` persistence
- Budget YAML format: `budget.yaml` with resource limits per project
- Metrics JSONL: append-only, can be summed/filtered by date

### Integration Points
- `service.ts`: Add hourly cron tick that invokes director in "report mode"
- `budget-gate.ts`: Add time-based check before worker session starts
- `slack-bridge.ts`: Route proactive reports through existing Slack notification path
- `worker-manager.ts`: `startProject()` should check budget before spawning

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 04-autonomous-operation*
*Context gathered: 2026-03-18*
