# 0053: Fleet Supply Decomposition Obligation

Date: 2026-03-02
Status: accepted

## Context

The fleet of 8 GLM-5 workers was consistently starving — 0 unblocked fleet-eligible
tasks available — while decomposable `[requires-opus]` tasks sat undecomposed in
TASKS.md files. A monolithic `[requires-opus]` task was a
concrete example: it sat undecomposed for a full day while
the fleet ran 30+ zero-output sessions. A human had to explicitly request decomposition.

Root cause: a convention contradiction in the orient skill. The fleet supply generation
step (ADR 0047) said "Decompose requires-opus tasks: Split tasks with >2 independent
steps into fleet-eligible subtasks." But a later step in the same skill said "Do not
edit TASKS.md during orient. Decomposition proposals go in the orient output." Agents
followed the prohibition. The proposals existed only as ephemeral conversation text
that died with the session. No subsequent session read them.

Additional contributing factors:
- orient-simple's fleet supply generation step didn't list decomposition at all
- The starvation alert (notifyFleetStarvation) was generic — didn't identify which
  tasks were decomposable
- No L0 (code-enforced) check detected the combination of fleet starvation +
  decomposable tasks
- Mission gap analysis tasks were written directly to TASKS.md, but decomposition
  proposals were output-only — an inconsistency within the same skill

Prior feedback and diagnostics:
- `feedback-fleet-utilization-75-percent-2026-03-01.md` — PI directive for 75% fleet utilization
- `diagnosis-fleet-task-starvation-2026-03-01.md` — diagnosed root cause as task supply exhaustion
- `fleet-idle-rate-analysis-2026-03-02.md` — confirmed 0% fleet supply with decomposable tasks present
- ADR 0047 — established fleet supply maintenance obligation (but with contradiction in execution)

## Decision

### Convention: Decomposition WRITES to TASKS.md

The orient skill's decomposition step is changed from "propose in output" to "write
directly to TASKS.md." Specifically:

1. **Fleet supply generation** (both orient and orient-simple): When decomposing
   `[requires-opus]` tasks to replenish fleet supply, write the subtasks directly
   to TASKS.md. Replace the original task with its decomposed subtasks.

2. **Decomposition scan** (full orient only): Always runs, regardless of fleet supply
   level. When decomposable tasks are found, write subtasks to TASKS.md — do not
   just propose in output. Proposals that exist only in orient output die with the
   session.

3. **Justification**: Same as mission gap analysis (ADR 0049) — "these represent work
   the project/fleet structurally requires." The fleet cannot consume tasks that are
   never written to files.

### L0: Starvation alert includes decomposable tasks (code-enforced)

`notifyFleetStarvation()` now includes specific decomposable task suggestions when
fleet supply is 0 and `[requires-opus]` tasks with decomposition triggers exist.
This makes the alert actionable — the next Opus session knows exactly what to decompose.

### L0: Post-session verification (code-enforced)

`verify.ts` now checks for fleet starvation + decomposable tasks after every session.
When fleet supply is 0 AND decomposable `[requires-opus]` tasks exist, a warning is
emitted. This provides cross-session visibility and detects when the obligation is
not being met.

### Decomposition triggers

A `[requires-opus]` task is decomposable when ANY of these are true:
1. **>2 independent steps** — description contains conjunctions suggesting multiple actions
2. **>3 files** — description mentions "multiple files" or "across" patterns
3. **Mixed mechanical + judgment work** — description contains both mechanical verbs
   (implement, write, test) and judgment verbs (design, analyze, review)

The `detectDecompositionTrigger()` function in `fleet-supply.ts` implements heuristic
detection. This is L0 assistance — the agent can and should also identify decomposable
tasks that the heuristic misses.

## Consequences

1. Fleet supply generation becomes effective — it can actually create the tasks it
   identifies as needed, instead of proposing them into the void.

2. Orient sessions will take slightly longer when decomposition triggers are found,
   but this cost is amortized across many fleet worker sessions that would otherwise
   be idle.

3. The starvation alert becomes actionable — a concrete list of "decompose these"
   instead of a generic "create tasks."

4. Cross-session detection closes the loop — if an orient session fails to decompose
   despite supply being 0, the next session's verification will flag it.

### Migration

- [x] Updated `/orient` SKILL.md — removed "Do not edit TASKS.md" contradiction,
  made decomposition write directly to TASKS.md
- [x] Updated `/orient-simple` SKILL.md — added decomposition as supply source,
  removed "flag for later" behavior
- [x] Added `detectDecompositionTrigger()` and `decomposableTasks` to `fleet-supply.ts`
- [x] Updated `notifyFleetStarvation()` in `slack.ts` to include decomposable task info
- [x] Updated `fleet-scheduler.ts` to pass decomposable tasks to starvation alert
- [x] Added fleet supply starvation check to `verify.ts`
- [x] Updated CLAUDE.md enforcement layers table
