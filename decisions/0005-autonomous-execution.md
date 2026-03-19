# 0005: Autonomous Research Execution

Date: 2026-02-15
Status: accepted (approval gates narrowed by 0011, 0016, 0021)

## Context

youji sessions are human-initiated: a person runs Claude Code, picks a task, and works. The repo has strong conventions for within-session discipline (inline logging, provenance, decision records) but no mechanism for sessions to happen without a human trigger.

Research projects should progress autonomously. An agent wakes up on a schedule, reads the repo to determine what to work on, does the work, logs what it learned, and stops — with human checkpoints only for high-stakes decisions.

## Decision

### Scheduling

Sessions are triggered by cron via `infra/scheduler/` — a minimal standalone scheduler that uses croner for cron expression parsing and spawns `claude -p` sessions. Default schedule: hourly (`0 * * * *`). Each session is isolated — no shared state across sessions except through the repo.

Why hourly: research throughput benefits from frequent, focused sessions. The scheduler serializes sessions (one at a time), so higher frequency does not cause thrash. Hourly cadence provides faster iteration on multi-session tasks while keeping each session focused.

### Session protocol

Every autonomous session follows the SOP at [docs/sops/autonomous-work-cycle.md](../docs/sops/autonomous-work-cycle.md): orient, select task, classify scope, execute, commit and close.

### Task selection

Tasks come from project README "Next actions" sections. Priority: (1) project recommended by /orient, (2) unblocked tasks, (3) concrete done-when conditions, (4) routine before resource-intensive.

### Approval gates

Autonomous sessions must not proceed with resource decisions (budget increases or deadline extensions), non-verifiable structural decisions (new projects, CLAUDE.md changes, schema changes to external contracts), or tool access requests (tools, APIs, or models not currently configured). Resource and governance items are session-blocking — write the request to `APPROVAL_QUEUE.md` at repo root and end the session. Tool access items are task-blocking — write the request, tag the task `[blocked-by: tool-access approval for <tool>]`, and attempt another task (see [0024](0024-tool-access-approval.md)). Humans edit the file directly to approve/deny.

Creating GitHub releases or version tags requires a non-blocking approval queue entry — write to `APPROVAL_QUEUE.md` for visibility but continue working without waiting.

Git push does not require approval. Sessions commit and push freely. Experiments within remaining project budget proceed autonomously — there is no per-experiment cost threshold.

Structural changes whose correctness can be statically verified (type checks, tests, validators) do not require approval. The principle: if a machine can confirm the change is correct, gating on human review adds latency without safety value. Examples: infra code changes that pass `tsc --noEmit`, decision records documenting completed work, validator extensions with tests.

Why not Lobster approval gates: Lobster is for deterministic multi-step tool chains. Research sessions require judgment at every step. The approval queue is simpler, repo-native, and readable by any agent or human.

### State management

The repo is the only state store. No external database, no session history dependency, no workflow state files outside the repo. `APPROVAL_QUEUE.md`, README next actions, and log entries are all the state needed.

### Session metrics

Each autonomous session log entry includes a machine-parseable footer (session-type, duration, task-selected, task-completed, approvals-created, files-changed, commits). This enables future analysis without building infrastructure now.

### Task lifecycle tags

Tags in "Next actions" coordinate across sessions:
- `[in-progress: YYYY-MM-DD]` — prevents duplicate pickup
- `[blocked-by: <description>]` — cannot proceed until condition is met
- `[approval-needed]` — requires human sign-off
- `[approved: YYYY-MM-DD]` — human approved, ready to execute

## Consequences

- Agents can now operate without human initiation, accelerating research throughput.
- Humans retain control over high-stakes decisions via the approval queue.
- The hourly cadence provides rapid iteration while the scheduler serializes sessions to prevent overlap.
- Scheduling infrastructure is minimal and self-contained (`infra/scheduler/`, ~400 lines, one npm dependency). All coordination state lives in markdown files in the repo.
- Future enhancements (parallel agents, Lobster sub-workflows, auto-push) can be added incrementally once the single-agent protocol is validated.
- Session metrics accumulate in log entries, feeding the youji meta-project's research on session efficiency.
