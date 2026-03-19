# 0048: Fleet Idle Exploration

Date: 2026-03-01
Status: accepted

## Context

ADR 0047 addressed fleet supply maintenance — the obligation to keep the task queue
populated. However, there will always be periods when all tasks are blocked, consumed,
or the Opus session hasn't created new ones yet. During these windows, fleet workers
(FLEET_SIZE=4, polling every 30s) sit completely idle: zero throughput at full cost.

PI feedback: "Is there any way to keep fleet workers always busy when there are no
tasks, still make them possible to produce knowledge (external knowledge as well),
while do not introduce noise to the repo? It is fine if the knowledge is only obtained
probabilistically as long as there is meaningful output at idle time."

Key constraints:
- Workers must produce knowledge, not busy-work
- External knowledge acquisition (literature, developments) is desired
- Noise to the repo must be avoided
- Probabilistic output is acceptable (not every session needs to produce output)

## Decision

When the fleet task queue is empty, workers are assigned **idle exploration tasks**
from a curated pool. These are ephemeral (not written to TASKS.md), produce output
only when genuinely valuable, and use existing repo structures for output.

### Exploration types

| Type | What it does | Output location | GLM-5 suitability |
|------|-------------|----------------|-------------------|
| `horizon-scan` | Search arxiv/web for papers relevant to a project's research area | `projects/<project>/literature/` | Good (structured search) |
| `self-audit` | Run convention compliance check on a project | Project README log entry | Good (rule-following) |
| `stale-blocker-check` | Verify whether `[blocked-by: external]` conditions are resolved | TASKS.md tag updates | Good (mechanical verification) |
| `open-question` | Research an open question from a project README | Project README log entry | Moderate (depends on complexity) |

### Topic selection

1. Gather topics from all projects (open questions, research areas, stale blockers)
2. Filter out recently explored topics (cooldown: 6 hours per project+type)
3. Weight by type: `horizon-scan` (3x), `open-question` (2x), `self-audit` (1x), `stale-blocker-check` (1x)
4. Select up to `slotsAvailable` topics

### Noise prevention

1. **Commit-if-valuable prompt**: Idle workers are instructed: "If you find nothing
   genuinely new, end the session with ZERO commits. An empty session is expected
   and acceptable."
2. **No TASKS.md creation**: Idle workers do not create new tasks. They only produce
   knowledge artifacts (literature notes, log entries) or update existing task tags
   (stale blocker removal).
3. **Existing repo structures**: Output goes to designated project areas (literature/,
   README logs) — no new file structures are introduced.
4. **Single-artifact limit**: Each idle session produces at most one literature note
   or one log entry. This prevents bulk low-quality output.

### Lifecycle

- Idle tasks use the same fleet executor (spawn, auto-commit, rebase-push)
- No task claim is needed (no TASKS.md entry to protect)
- Results are tagged `isIdle: true` for separate metrics tracking
- Starvation alerts still fire (humans should still create real tasks) but workers
  don't sit idle waiting

### Priority

Real tasks always take priority over idle exploration. When `refill()` finds both
assignable tasks and idle workers can run, assignable tasks fill slots first. Idle
workers finish their current session naturally (typically 3-5 minutes) and the slot
becomes available for real tasks on the next refill cycle.

## Consequences

- Fleet utilization approaches 100% even when the task queue is empty
- The system continuously acquires external knowledge (literature, developments)
- Noise is controlled by the commit-if-valuable discipline and single-artifact limit
- The 6-hour cooldown prevents redundant exploration of the same topic
- Metrics can distinguish task work from idle exploration for efficiency analysis
- The starvation alert remains — idle exploration is a complement to task supply
  maintenance, not a replacement
