# ADR-0022: Full autonomy standard for task completion

Date: 2026-03-13
Status: accepted
Adapted from: OpenAkari ADR-0058

## Context

Youji aims for autonomous operation. In practice, some tasks require human intervention at unexpected points — merge conflict resolution, deployment verification, PR creation failures, authentication gaps. Each point of human intervention represents a capability gap that should be closed.

OpenAkari's first production feature shipped successfully but required human intervention at four points: merge conflict resolution, server restart, PR creation (auth failure), and approval queue delay. The lesson: autonomous systems must identify and systematically close capability gaps.

## Decision

### 1. Full autonomy is the standard

Tasks should complete end-to-end without human intervention. When a task requires human help, that is a capability gap to be documented and closed, not normal operation.

### 2. Capability gap tracking

When human intervention is required during a task, record:
- What the intervention was
- Why the system couldn't handle it autonomously
- What capability would eliminate the need for intervention
- A task to close the gap

### 3. The full pipeline

The autonomy standard extends across the entire task pipeline:

```
Task selection -> Planning -> Implementation ->
Testing/Verification -> Commit -> Push -> Done
```

Every step must be executable by Youji without human help. When a step fails, the system should either fix the issue or create a clear, actionable error report — not silently stall.

### 4. Recognize milestones

When a new category of work is completed fully autonomously for the first time, record it as a milestone. This tracks the expanding envelope of autonomous capability.

## Consequences

- Clear standard: "zero human intervention" is an unambiguous bar
- Capability gaps are tracked and systematically closed
- Infrastructure investment is justified — closing gaps benefits all future tasks
- Risk surface increases with more autonomy — mitigated by testing, verification, and the commit-based safety model (everything is revertible)
