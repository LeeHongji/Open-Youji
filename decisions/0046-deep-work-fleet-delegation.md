# 0046: Deep Work → Fleet Delegation Pattern

Date: 2026-03-01
Status: accepted

## Context

ADR 0042-v2 established a two-tier execution model: 1 Opus supervisor + up to 32
GLM-5 fleet workers. ADR 0045 required all new tasks to be tagged for fleet routing.
However, the Slack bot interaction layer was designed before the fleet existed — all
user-initiated work routes through Opus deep work sessions ($3+, 5-60 min) even when
cheaper fleet workers ($0, ~5 min) could handle the request.

Three efficiency gaps were identified (feedback-deep-work-fleet-efficiency-pipeline-2026-03-01):

1. **No fleet path from Slack.** The chat agent could only spawn deep work or answer
   directly. No mechanism to create fleet tasks from user requests.
2. **Deep work unaware of fleet.** Deep work prompts didn't mention fleet workers, so
   Opus sessions did all work themselves instead of decomposing into fleet-eligible
   subtasks.
3. **Skill routing ignores complexity.** Skills declare complexity and model-minimum
   metadata, but all non-interview skills route to Opus deep work regardless of whether
   GLM-5 could handle them.

## Decision

### Three-path routing from Slack

The chat agent now has three routing options for user requests, ordered by cost:

| Path | Cost | Latency | When to use |
|------|------|---------|-------------|
| `[ACTION:create_task]` | $0 | ~30s to start | Mechanical, well-scoped work a fleet worker can handle |
| `[ACTION:deep_work]` | ~$3 | immediate | Research, analysis, complex reasoning, multi-file synthesis |
| Direct chat response | ~$0.01 | immediate | Quick lookups, status queries, simple questions |

The chat prompt includes routing guidance with cost comparison to help the chat agent
make efficient decisions.

### Fleet-awareness in deep work prompts

Deep work sessions now receive explicit fleet context in their prompts:
- Fleet workers auto-pick `[fleet-eligible]` tasks within 30 seconds
- Opus sessions should create fleet-eligible subtasks for mechanical work
- Tags `[fleet-eligible]` vs `[requires-opus]` explained with cost comparison
- "You are an expensive Opus session; fleet workers are zero-cost"

This enables Opus deep work sessions to act as decomposers: do the high-judgment work
themselves, then create fleet tasks for mechanical follow-up.

### Code-level skill routing

Skills that declare `complexity: medium` or `complexity: low` AND have
`model-minimum: glm-5` (or no model-minimum) are fleet-eligible for execution.
When such a skill is invoked from Slack, the chat agent routes to fleet via task
creation instead of spawning an Opus deep work session.

Skills with `complexity: high` or `complexity: opus-only` or `model-minimum: opus`
continue to route to Opus deep work.

Current fleet-eligible skills: `/self-audit` (medium), `/orient-simple` (medium),
`/compound-simple` (medium). Most skills require opus-class capability and remain
deep-work-only.

## Consequences

### Positive

- User requests can reach the cheapest capable execution tier
- Deep work sessions leverage fleet for mechanical follow-up ($0 vs $3)
- Skills with appropriate complexity metadata auto-route efficiently
- The Opus budget is preserved for work that genuinely needs it

### Negative

- Fleet task creation from Slack adds ~30s latency vs immediate deep work
- Fleet workers may not handle all "fleet-eligible" skills correctly
  (mitigated by escalation mechanism — workers tag tasks `[escalate]` if stuck)
- Chat agent must make routing decisions, adding complexity to the prompt

### Migration

Applied in this session:
- `[ACTION:create_task]` handler in chat.ts (commit a611bcf6)
- Fleet context in `buildDeepWorkPrompt()` (commit a611bcf6)
- Routing guidance in chat prompt (commit a611bcf6)
- Code-level skill-to-fleet routing in `processMessageInner()` (this session)
- ADR 0046 (this document)
