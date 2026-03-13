# ADR-0011: Tiered orient (fast / full)

Date: 2026-03-13
Status: accepted
Adapted from: OpenAkari ADR-0030

## Context

The orient skill reads project READMEs, TASKS.md files, status documents, budgets, and recent logs to select the next task. Most of this information changes infrequently — status documents and budgets may change at most once per day. If Youji runs multiple autonomous sessions per day, the majority of orient reads are redundant.

The insight: orient data has a "freshness half-life" of 2-4 hours. Reading everything every session is wasteful when sessions run more frequently than that.

## Decision

Split orient into two tiers:

### Fast orient (default)

Runs on most sessions. Quick and focused. Reads only:

1. **`git status`** — detect uncommitted work
2. **`git log --oneline -5`** — recent activity awareness
3. **TASKS.md** files for active projects — task selection
4. **Budget check** — read `budget.yaml` only if the candidate task consumes resources

Skips: full README logs, status documents, roadmaps, cross-session pattern analysis, horizon-scan reports, compound opportunity scanning.

Output: abbreviated orientation with the recommended task and any budget concerns.

### Full orient (periodic)

Runs periodically or on trigger. The comprehensive orientation: all context gathering, full ranking with strategic alignment, cross-session patterns, compound opportunities, mission gap analysis.

### When to run full orient

Full orient runs when **any** of these conditions is true:

1. **Time-based**: More than 2 hours since the last full orient
2. **State-change trigger**: A significant event since the last session:
   - An experiment completed
   - A decision was made or recorded
   - The researcher provided feedback
3. **Explicit request**: The session prompt includes `/orient full`
4. **First session of the day**: After a significant gap between sessions

## Consequences

- Most sessions save 3-5 minutes of orientation overhead by running fast orient
- Full orient is never more than ~2 hours away, preventing information staleness
- Budget checks still run for resource-consuming tasks regardless of orient tier
- Fast orient may miss cross-project opportunities; full orient compensates periodically
- The researcher can always force a full orient with `/orient full`
