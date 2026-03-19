# 0047: Fleet Supply Maintenance

Date: 2026-03-01
Status: accepted

## Context

The fleet of 4 GLM-5 workers (ADR 0042-v2) was 0% utilized despite being correctly
configured and fully functional. All 26 fleet-eligible tasks were blocked by external
dependencies (external team evaluations, PI confirmations, date gates, infrastructure issues).
The system had no mechanism to detect or respond to fleet starvation — workers polled
every 30 seconds, found nothing, and sat idle.

The root cause is structural: task supply is generated opportunistically (during orient
decomposition or manual creation) but consumed deterministically (fleet workers pick up
tasks within seconds). Without a replenishment obligation, the fleet starves whenever
all existing tasks are blocked or consumed.

PI directive: fleet of 4 should reach ≥75% utilization and maintain it constantly.

## Decision

Fleet supply maintenance is a top-level system obligation, enforced at three layers:

### L0: Scheduler alerting (code-enforced)

The fleet scheduler emits a Slack alert when fleet task supply drops to 0 and
fleet is enabled (FLEET_SIZE > 0). Alert fires at most once per 30 minutes to
avoid spam. The alert includes the current fleet size and a prompt to create tasks.

### L2: Orient supply generation (convention)

When /orient detects fleet supply < FLEET_SIZE, it MUST generate fleet-eligible tasks
before proceeding to its normal task selection. Sources for task generation (in priority
order):

1. **Unblock stale blockers** — tasks with `[blocked-by]` tags referencing conditions
   that have been resolved (completed prerequisite tasks, resolved infrastructure issues)
2. **Decompose requires-opus tasks** — split complex tasks into fleet-eligible subtasks
3. **Create project maintenance tasks** — compliance audits, documentation updates,
   test coverage, cross-project analysis
4. **Create recurring analysis tasks** — session data analysis, experiment follow-ups,
   cross-project synthesis

Target: leave fleet supply ≥ FLEET_SIZE after orient completes.

### L2: Session supply obligation (convention)

Every Opus session (autonomous or deep work) should check fleet task supply before
ending. If supply < FLEET_SIZE, create fleet-eligible tasks to replenish. This is a
SHOULD, not a MUST — sessions that are themselves creating fleet work naturally
satisfy this.

### Fleet-eligible task sources (standing inventory)

These task types are always valid and can be created when supply is low:

| Task type | Template | Frequency |
|-----------|----------|-----------|
| Compliance audit | Run /self-audit on `<project>` | Per project, weekly |
| Cross-project synthesis | Synthesize findings across `<project-set>` | Monthly |
| Documentation update | Update `<project>` README with current status | Per project, as needed |
| Session data analysis | Analyze last N fleet sessions for patterns | Weekly |
| Test coverage | Write tests for `<module>` in infra/scheduler | Per module, once |
| Stale blocker review | Re-verify `[blocked-by: external]` tags older than 7 days | Weekly |

## Consequences

- Fleet utilization should reach and maintain ≥75% (3/4 workers busy) as long as
  Opus sessions run at least every 30 minutes (current schedule).
- The Slack alert provides immediate visibility when supply drops — humans or
  scheduled Opus sessions can respond.
- The standing inventory prevents "all tasks blocked" starvation by ensuring there
  is always something useful for fleet workers to do.
- Task quality matters: fleet-eligible tasks must produce genuine value (knowledge,
  artifacts, fixes), not busy-work. The fleet-eligibility checklist (ADR 0045)
  ensures tasks are well-scoped.
