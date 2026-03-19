# 0030: Tiered Orient (Fast / Full)

Date: 2026-02-20
Status: accepted

## Context

Orient costs ~5-7 turns ($0.27-0.41) per session. With 30-minute cron intervals (~48 sessions/day), this is $13-20/day on orientation alone. Most information orient reads — `docs/status.md`, `docs/roadmap.md`, `budget.yaml` — changes at most once per day. At 48 sessions/day, ~47/48 reads per file are redundant.

The PI raised this concern (see `projects/youji/feedback/feedback-orient-weight-and-leverage.md`). The feedback analysis identified a 2-4 hour "freshness half-life" for orient's data, creating a 4-8x impedance mismatch with the 30-minute cadence. Research question RQ5 in `projects/youji/patterns/autonomous-execution.md` also asks: "What is the minimum effective orient step?"

## Decision

Split orient into two tiers:

### Fast orient (default)

Runs on most sessions. ~2-3 turns. Reads only:

1. **`git status`** — commit orphaned work if needed
2. **`git log --oneline -5`** — recent activity awareness
3. **TASKS.md** files for active projects — task selection
4. **Budget gate check** — read `budget.yaml` + compute ledger total only if the candidate task consumes resources

Skips: `docs/status.md`, `docs/roadmap.md`, `sessions.jsonl` pattern analysis, ledger reconciliation, horizon-scan reports, compound opportunity scanning, full README log reading.

Output: abbreviated orientation with just the recommended task and any budget concerns.

### Full orient (periodic)

Runs every Nth session or on trigger. The current comprehensive orient — all 9 gather-context items, full ranking with strategic alignment and repetition penalty, model-limit awareness, compound opportunities, cross-session patterns.

### When to run full orient

Full orient runs when **any** of these conditions is true:

1. **Time-based**: ≥2 hours since the last full orient (roughly every 4th session at 30-min cadence)
2. **State-change trigger**: The scheduler detects a significant event since the last session:
   - An experiment completed (new `status: completed` in any `progress.json`)
   - An approval was resolved (change in `APPROVAL_QUEUE.md`)
   - A new ADR or decision was committed
   - A human `/feedback` was processed
3. **Explicit request**: The session prompt includes `/orient full` or the scheduler passes a `fullOrient: true` flag
4. **First session after restart**: When the scheduler has been stopped and restarted

### Implementation mechanism

The scheduler tracks `lastFullOrientAt` in `jobs.json` state. On each session:

1. Check if any full-orient trigger condition is met
2. If yes: inject `/orient` (full) into the session prompt as today
3. If no: inject `/orient fast` — the skill recognizes the `fast` argument and runs the abbreviated version

The `/orient` skill SKILL.md is updated with a `## Fast orient` section that defines the abbreviated procedure. The `fast` argument is documented alongside the existing project-scoping argument.

## Consequences

**Expected savings**: ~3-4 turns per session on 75% of sessions (those that get fast orient). At $0.04-0.06/turn and ~36 fast-orient sessions/day, this saves ~$4-8/day or $120-240/month.

**Risk**: Fast orient may miss cross-project opportunities, budget drift, or model-limit changes. Mitigated by:
- Full orient is never more than ~2 hours away
- Budget gate check still runs for resource-consuming tasks
- Deep-work sessions (Slack-triggered) use full orient or skip orient entirely

**Migration**:
- Update `/orient` SKILL.md with fast orient procedure and argument handling — done
- Update `docs/sops/autonomous-work-cycle.md` Step 1 to reference tiered orient — done
- Add `lastFullOrientAt` tracking to scheduler job state — **done (2026-02-22)**: `orient-tier.ts` module, `executor.ts` injects directives, `cli.ts` updates timestamps in job state. The broken git-log heuristic is replaced with scheduler-side tracking. `lastFullCompoundAt` also added for compound tiering.

**Not changed**: Deep-work sessions already skip orient entirely (`Do NOT run /orient`). Chat sessions don't run orient. Only scheduled work-cycle sessions are affected.
