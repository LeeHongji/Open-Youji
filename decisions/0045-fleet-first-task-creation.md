# 0045: Fleet-First Task Creation

Date: 2026-03-01
Status: accepted

## Context

ADR 0042-v2 established the fleet architecture: 1 Opus supervisor + up to 32 GLM-5
fleet workers. The fleet infrastructure is fully built and operational (Phase 0-1
complete, 45 validation sessions with 0 crashes). However, fleet validation at N=2
revealed a critical bottleneck: **zero fleet-eligible tasks exist across all 7 projects**.

The fleet scheduler requires the `[fleet-eligible]` tag to assign tasks to workers.
Without tagged tasks, the fleet runs empty — 32 available slots with nothing to execute.
The root causes:

1. **No tagging convention at creation time.** The `[fleet-eligible]` tag was documented
   in CLAUDE.md but nothing prompted task creators to apply it. It was opt-in, not default.
2. **No retroactive tagging.** All 7 projects' TASKS.md files had zero fleet-eligible
   open tasks (all previously tagged tasks were completed Phase 0 infrastructure work).
3. **Circular dependency.** The task decomposition guidance for /orient (Phase 2.3) was
   blocked behind fleet validation, but fleet validation required task supply that only
   decomposition would produce.

This is an L2 workflow gap — the infrastructure works, but the process for feeding it
doesn't exist.

## Decision

### Fleet-eligibility defaults to enabled on all new tasks

Untagged tasks default to fleet-eligible and are assigned by the fleet scheduler. Only
tasks explicitly tagged `[requires-opus]` are excluded from fleet assignment. This
default maximizes fleet utilization without requiring manual tagging for every task.

### Fleet-eligible is the default

Tag `[requires-opus]` only when the task fails the eligibility checklist:
1. Self-contained (understandable from task text + project README)
2. Clear done-when (mechanically verifiable)
3. Single concern (one thing, not a compound action)
4. No deep reasoning (no synthesis, strategic decisions, or multi-step planning)
5. No convention evolution (doesn't modify CLAUDE.md, decisions/, or infra/)

Tag `[requires-opus]` when a task genuinely needs Opus-level capability. An over-tagged
task that could run on the fleet wastes Opus capacity (scarce, expensive). An untagged
task defaults to fleet-eligible, maximizing fleet utilization.

### Skills enforce fleet-awareness

- `/orient` scans for untagged tasks during task ranking and tags them
- `/compound` tags all newly created tasks (from recommendations, implied tasks, etc.)
- Both skills report fleet task supply in their output

### Decomposition guidance is unblocked

The task decomposition guidance for /orient (previously blocked by fleet validation)
is unblocked. Decomposition is a prerequisite for fleet task supply, not a consequence
of fleet validation. Breaking the circular dependency enables the fleet to become
productive immediately.

## Consequences

### Positive

- Fleet workers can immediately find and execute tasks across all projects
- Task quality improves system-wide (fleet-eligible tasks are by definition well-scoped)
- Opus supervisor time is freed from executing mechanical tasks
- The fleet's 192× throughput multiplier becomes usable

### Negative

- Slight overhead per task creation (must assess fleet-eligibility)
- Risk of over-optimistic tagging (mitigated by escalation mechanism)
- Existing sessions must learn the new convention (mitigated by CLAUDE.md update)

### Migration

Applied in this session:
- CLAUDE.md updated with fleet-first task creation convention and checklist
- Task schema updated to show fleet routing tag as required
- All 7 projects' TASKS.md files retroactively tagged (15 tasks tagged)
- /orient skill updated with fleet decomposition scan and output section
- /compound skill updated with fleet-eligibility tagging for new tasks
- Task decomposition guidance unblocked from fleet validation dependency
