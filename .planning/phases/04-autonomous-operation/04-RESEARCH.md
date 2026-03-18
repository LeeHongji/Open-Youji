# Phase 4: Autonomous Operation - Research

**Researched:** 2026-03-18
**Domain:** Cron-triggered autonomous wake-up, proactive Slack reporting, time-based budget enforcement
**Confidence:** HIGH

## Summary

Phase 4 adds three capabilities: (1) an hourly cron job that triggers Youji to survey all active projects, (2) proactive Slack DM reports when changes are detected, and (3) time-based budget enforcement that tracks compute-minutes per project per day. All three build on well-established patterns already present in the codebase — the scheduler already uses `croner` for cron, `metrics.ts` already records `durationMs` per session, and `budget-gate.ts` already enforces resource limits. The work is primarily adaptation and wiring, not greenfield.

**Primary recommendation:** Implement in three stages: (1) time-budget tracking and enforcement in budget-gate.ts, (2) cron-triggered director wake-up in service.ts, (3) proactive report formatting and change-detection in a new `proactive-report.ts` module.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Cron schedule: `0 * * * *` (hourly), 24/7
- Full check scope: worker status + TASKS.md progress + pending approvals + time budget
- Only sends Slack DM when there are changes (no noise if nothing changed)
- Time budget unit: hours per day per project (default 4 hours/day = 240 compute-minutes)
- Budget exceeded: stop the project's worker + notify mentor. Next day auto-resets.
- Adapt existing `budget.yaml` format: change resource unit from USD to `compute-minutes`
- Adapt existing `budget-gate.ts`: check accumulated `durationMs` from `metrics.ts` for the current day
- Youji includes budget status in proactive reports

### Claude's Discretion
- Exact cron job configuration and scheduler integration
- How to aggregate metrics by day for budget enforcement
- Report message formatting details
- Whether to use a dedicated "report" thread or top-level DM for proactive reports
- How to handle timezone for "daily" budget reset

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DIR-03 | Youji periodically wakes up via cron to check project status across all active projects | Cron job in service.ts using existing `croner` + `computeNextRunAtMs()` pattern; hourly tick invokes a new `runProactiveCheck()` method |
| DIR-04 | Youji proactively reports progress, blockers, and pending approvals to mentor via Slack | New `proactive-report.ts` module builds per-project summaries; change detection via state snapshot comparison; sends via existing `dm()` / `dmBlocks()` stubs |
| RES-01 | Session duration (wall-clock minutes) is tracked as the primary resource metric | Already tracked: `SessionMetrics.durationMs` in `metrics.ts`. Need aggregation function to sum by project + day |
| RES-02 | Budget gates enforce time-based limits per project (compute-minutes) | Adapt `budget-gate.ts` to add `checkTimeBudget()` that sums today's `durationMs` from JSONL metrics and compares against `budget.yaml` compute-minutes limit |
| RES-03 | Youji includes time budget status in proactive reports to mentor | Proactive report includes per-project time budget line (e.g., "2.3h / 4h used today") using `readBudgetStatus()` + daily metrics aggregation |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| croner | ^9.0.0 | Cron expression parsing and next-run computation | Already in use by scheduler; `computeNextRunAtMs()` in schedule.ts |
| vitest | ^4.0.18 | Test framework | Already configured in vitest.config.ts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @slack/bolt | ^4.6.0 | Slack messaging (via slack-bridge.ts) | For proactive report delivery (already wired) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| croner for hourly cron | setInterval(3600000) | croner handles DST, timezone, leap seconds; setInterval drifts |
| JSONL metrics aggregation | SQLite time-series | JSONL is simpler and already in use; SQLite is overkill for daily sums |

**Installation:** No new dependencies needed. All libraries already present.

## Architecture Patterns

### Recommended Module Structure
```
src/
├── proactive-report.ts     # NEW: builds per-project status snapshots, detects changes, formats reports
├── proactive-report.test.ts # NEW: tests for report building and change detection
├── budget-gate.ts          # MODIFY: add checkTimeBudget() for compute-minutes enforcement
├── budget-gate.test.ts     # MODIFY: add time budget tests
├── service.ts              # MODIFY: add hourly cron tick for proactive check
├── service.test.ts         # NEW: test hourly cron integration
├── metrics.ts              # MODIFY: add aggregateMetricsByDay() helper
├── slack.ts                # MODIFY: add notifyProactiveReport() stub
├── worker-manager.ts       # No changes needed (stopProject() already exists)
├── director.ts             # No changes needed
```

### Pattern 1: Timestamp-Throttled Periodic Check (Existing Pattern)
**What:** service.ts already uses `lastWorkerCheckMs` + `WORKER_CHECK_INTERVAL_MS` for 60s throttling. The hourly cron check should follow the same pattern.
**When to use:** Any periodic background task that runs inside the polling tick.
**Example:**
```typescript
// Existing pattern in service.ts (line 278-283)
private lastCronCheckMs = 0;
private readonly CRON_CHECK_INTERVAL_MS = 3_600_000; // 1 hour

private shouldRunCronCheck(): boolean {
  const now = Date.now();
  if (now - this.lastCronCheckMs < this.CRON_CHECK_INTERVAL_MS) return false;
  this.lastCronCheckMs = now;
  return true;
}
```

**Recommendation:** Use the timestamp-throttle pattern (not a separate cron job in jobs.json). The hourly check is an internal scheduler concern, not a user-configured job. This avoids polluting the job store and keeps the logic self-contained in service.ts.

### Pattern 2: Change Detection via State Snapshot Diff
**What:** Before sending a report, compute a snapshot of current state (task counts, worker statuses, approval count, budget usage) and compare against the last-sent snapshot. Only send if diff is non-empty.
**When to use:** Preventing notification noise.
**Example:**
```typescript
interface ProjectSnapshot {
  completedTasks: number;
  openTasks: number;
  blockedTasks: number;
  inProgressTasks: number;
  activeWorkers: number;
  pendingApprovals: number;
  computeMinutesUsed: number;
  budgetExceeded: boolean;
}

// Store last-sent snapshot in memory (acceptable — ephemeral, worst case = one redundant report after restart)
const lastSnapshots = new Map<string, ProjectSnapshot>();
```

### Pattern 3: Daily Metrics Aggregation
**What:** Sum `durationMs` from JSONL metrics file, filtering by project name prefix in `jobName` and by today's date in `timestamp`.
**When to use:** Time budget enforcement and reporting.
**Example:**
```typescript
async function getTodayComputeMinutes(project: string, metricsPath?: string): Promise<number> {
  const todayPrefix = new Date().toISOString().slice(0, 10); // "2026-03-18"
  const metrics = await readMetrics({ since: `${todayPrefix}T00:00:00`, metricsPath });
  const projectMs = metrics
    .filter(m => m.jobName.includes(project) || m.worktreeTaskId?.includes(project))
    .reduce((sum, m) => sum + m.durationMs, 0);
  return Math.round(projectMs / 60_000); // convert to minutes
}
```

### Pattern 4: Budget Enforcement at Worker Start
**What:** Check time budget in `WorkerManager.startProject()` (or the scheduler's `checkAndRespawnWorkers()`) before spawning a worker. If budget is exceeded, call `stopProject()` + notify.
**When to use:** Before every worker session starts.
**Example:**
```typescript
// In service.ts checkAndRespawnWorkers(), before calling wm.startProject():
const budgetResult = await checkTimeBudget(project, repoDir);
if (!budgetResult.allowed) {
  wm.stopProject(project);
  await notifyBudgetExceeded(project, budgetResult.reason);
  continue;
}
```

### Anti-Patterns to Avoid
- **Director session for cron check:** Do NOT invoke `handleDirectorMessage()` for the hourly check. The proactive check is a pure data aggregation task — no LLM reasoning needed. Building the report programmatically is faster, cheaper, and deterministic.
- **Persistent cron job in jobs.json:** Do NOT add the hourly check as a user-visible job. It is an internal scheduler mechanism, not a configurable job.
- **Blocking the tick loop:** The proactive check must be non-blocking. Use fire-and-forget for the Slack notification, catch errors.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron next-run calculation | Custom interval math | `croner` via `computeNextRunAtMs()` | DST, timezone, leap second edge cases |
| YAML parsing for budget.yaml | Full YAML parser | Existing line-based parsing in `notify.ts` `readBudgetStatus()` | Already battle-tested, consistent with codebase |
| Slack message formatting | Raw JSON blocks | Existing `buildBudgetBlocks()` in notify.ts as template | Consistent formatting, tested |
| Task parsing | Custom regex | `parseTasksFile()` from task-parser.ts | Already handles all task tag variants |

**Key insight:** Every component needed for Phase 4 already has a foundation in the codebase. The work is adaptation and wiring, not invention.

## Common Pitfalls

### Pitfall 1: Timezone Confusion for Daily Budget Reset
**What goes wrong:** "Today" computed in UTC vs. mentor's local timezone yields different reset boundaries. A worker running at 11 PM local time might see 0 budget used (new UTC day) while the mentor expects the old day's budget.
**Why it happens:** Server runs in UTC, mentor is in a specific timezone.
**How to avoid:** Use the mentor's timezone (configurable, e.g., `Asia/Shanghai`) for day-boundary calculation. Store the timezone in config or budget.yaml. Default to UTC if not set.
**Warning signs:** Budget resets at unexpected times from the mentor's perspective.

### Pitfall 2: Metrics File Growing Unbounded
**What goes wrong:** `readMetrics({ since: todayPrefix })` reads the entire JSONL file on every budget check, which gets slow as the file grows over months.
**Why it happens:** JSONL is append-only with no index.
**How to avoid:** Use the existing `readTailLines()` optimization for recent metrics. Since we only need today's data, read the last N lines (e.g., 1000) which will cover a full day of sessions easily.
**Warning signs:** Budget check latency increasing over time.

### Pitfall 3: Race Between Budget Check and Worker Spawn
**What goes wrong:** Two concurrent checks both pass the budget gate, then both spawn workers that push the project over budget.
**Why it happens:** Budget check and worker start are not atomic.
**How to avoid:** Check budget in `checkAndRespawnWorkers()` which is the single entry point for automated spawning. The existing `activeWorkers.has(project)` guard in WorkerManager already prevents double-spawn for the same project.
**Warning signs:** Project slightly exceeding budget (by one session's worth).

### Pitfall 4: Report Spam After Restart
**What goes wrong:** After a scheduler restart, the in-memory snapshot map is empty, so the first cron check sends reports for every project (even if nothing changed).
**Why it happens:** Snapshot state is ephemeral.
**How to avoid:** Accept one report per restart as tolerable. Alternatively, persist last-report timestamp and skip if within the last hour.
**Warning signs:** Duplicate reports after restarts.

### Pitfall 5: Filtering Metrics by Project Name
**What goes wrong:** `jobName` format varies: `fleet-worker:projectA`, `worker-task-abc123`, scheduled job names. Naive string matching misses sessions.
**Why it happens:** Multiple code paths create metrics with different naming conventions.
**How to avoid:** Use a combination of: (1) `jobName` contains project name, (2) `worktreeTaskId` field present on worker sessions, (3) explicit project field if added. Consider adding a `project` field to `SessionMetrics` for clean filtering.
**Warning signs:** Budget showing 0 usage when workers have clearly been running.

## Code Examples

### Daily Metrics Aggregation Function
```typescript
// In metrics.ts — new export
export async function getProjectDailyMinutes(
  project: string,
  dayIso: string, // "2026-03-18"
  metricsPath?: string,
): Promise<number> {
  const since = `${dayIso}T00:00:00`;
  const nextDay = new Date(dayIso);
  nextDay.setDate(nextDay.getDate() + 1);
  const until = nextDay.toISOString().slice(0, 10) + "T00:00:00";

  const metrics = await readMetrics({ since, metricsPath });
  const projectMs = metrics
    .filter(m => m.timestamp < until)
    .filter(m => m.jobName.includes(project))
    .reduce((sum, m) => sum + m.durationMs, 0);
  return Math.round(projectMs / 60_000);
}
```

### Time Budget Check Function
```typescript
// In budget-gate.ts — new export
export interface TimeBudgetResult {
  allowed: boolean;
  usedMinutes: number;
  limitMinutes: number;
  reason?: string;
}

export async function checkTimeBudget(
  project: string,
  repoDir: string,
  metricsPath?: string,
): Promise<TimeBudgetResult> {
  const projectDir = join(repoDir, "projects", project);
  const budgetStatus = await readBudgetStatus(projectDir);
  if (!budgetStatus) {
    return { allowed: true, usedMinutes: 0, limitMinutes: Infinity };
  }

  const timeResource = budgetStatus.resources.find(r => r.unit === "compute-minutes");
  if (!timeResource) {
    return { allowed: true, usedMinutes: 0, limitMinutes: Infinity };
  }

  const today = new Date().toISOString().slice(0, 10);
  const usedMinutes = await getProjectDailyMinutes(project, today, metricsPath);
  const limitMinutes = timeResource.limit;

  if (usedMinutes >= limitMinutes) {
    return {
      allowed: false,
      usedMinutes,
      limitMinutes,
      reason: `Time budget exceeded: ${usedMinutes}/${limitMinutes} compute-minutes used today`,
    };
  }

  return { allowed: true, usedMinutes, limitMinutes };
}
```

### Proactive Report Builder
```typescript
// In proactive-report.ts
export interface ProjectReport {
  project: string;
  tasksCompleted: number; // since last report
  tasksOpen: number;
  tasksBlocked: number;
  activeWorkers: number;
  pendingApprovals: number;
  computeMinutesUsed: number;
  computeMinutesLimit: number;
  budgetExceeded: boolean;
}

export function formatReport(reports: ProjectReport[]): string {
  const lines: string[] = ["*Youji Hourly Status*\n"];
  for (const r of reports) {
    const budgetIcon = r.budgetExceeded ? ":no_entry:" : ":large_green_circle:";
    const hours = (r.computeMinutesUsed / 60).toFixed(1);
    const limitHours = (r.computeMinutesLimit / 60).toFixed(0);
    lines.push(`*${r.project}*`);
    lines.push(`  Tasks: ${r.tasksCompleted} completed, ${r.tasksOpen} open, ${r.tasksBlocked} blocked`);
    lines.push(`  Workers: ${r.activeWorkers} active`);
    lines.push(`  ${budgetIcon} Budget: ${hours}h / ${limitHours}h`);
    if (r.pendingApprovals > 0) {
      lines.push(`  :bell: ${r.pendingApprovals} pending approval(s)`);
    }
  }
  return lines.join("\n");
}
```

### Budget YAML Format (compute-minutes)
```yaml
# budget.yaml — time-based budget for autonomous operation
resources:
  compute_time:
    limit: 240
    unit: compute-minutes
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| USD-based budget in budget.yaml | Time-based (compute-minutes) | Phase 4 | Budget.yaml resources use `compute-minutes` unit; budget-gate checks durationMs |
| No proactive reporting | Hourly cron check with change detection | Phase 4 | Youji sends Slack DM only when project state changed |
| Manual project monitoring | Automated cron survey | Phase 4 | Mentor receives updates without asking |

## Open Questions

1. **Metrics project attribution**
   - What we know: `SessionMetrics.jobName` contains project name for fleet workers (`fleet-worker:projectA`) but not consistently for all session types
   - What's unclear: Whether all worker session metrics can be reliably attributed to a project using `jobName` alone
   - Recommendation: Add explicit `project?: string` field to `SessionMetrics` for clean filtering. Or use the task-based naming in `worktreeTaskId` which includes the project indirectly. For Phase 4, start with `jobName.includes(project)` and refine if attribution gaps are found.

2. **Timezone configuration location**
   - What we know: `croner` supports timezone via `tz` option. Budget reset needs a consistent "day" boundary.
   - What's unclear: Where to store the mentor's timezone preference (env var, config file, budget.yaml)
   - Recommendation: Use an environment variable `YOUJI_TIMEZONE` (default `UTC`). Keep it simple — one timezone for the entire system. The mentor can set this to their local timezone.

3. **Budget YAML migration**
   - What we know: Existing budget.yaml uses arbitrary resource names (llm_api_calls, gpu_hours). Phase 4 adds `compute-minutes` as a new resource type.
   - What's unclear: Whether to replace existing resources or add alongside them
   - Recommendation: Add `compute_time` as a new resource alongside existing ones. The budget gate checks for `unit: compute-minutes` specifically. Existing USD/call resources continue to work via the existing `checkBudget()` path.

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `service.ts`, `metrics.ts`, `budget-gate.ts`, `notify.ts`, `schedule.ts`, `worker-manager.ts`, `slack-bridge.ts`, `director.ts` — all read in full
- `croner` ^9.0.0 — already in package.json, used in schedule.ts
- Existing `budget.yaml` example at `examples/my-research-project/budget.yaml`

### Secondary (MEDIUM confidence)
- `readTailLines()` optimization in metrics.ts — verified in source but not load-tested with large files

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in use, no new dependencies
- Architecture: HIGH — patterns directly derived from existing codebase patterns (timestamp-throttle, metrics JSONL, budget-gate)
- Pitfalls: HIGH — derived from reading actual code and identifying concrete edge cases

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (stable — no external dependency changes expected)
