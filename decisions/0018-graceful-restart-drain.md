# 0018: Graceful Restart with Session Drain

Date: 2026-02-18
Status: accepted

## Context

When the youji scheduler restarts — via self-evolution, pm2 `restart`, SIGTERM, or
memory limit — all concurrent agent sessions are killed. Deep work and autonomous
work sessions lose their in-progress work. The scheduler's stateless-agent design
means sessions cannot be resumed after restart (by design — see architecture docs),
but we can prevent unnecessary interruptions by waiting for active sessions to
complete before exiting.

An alternative (session state serialization + pickup) was considered and rejected
because it violates the foundational design principle that agents are stateless and
all state lives in the repository. See thread discussion 2026-02-18.

## Decision

Add a **drain mode** to the scheduler. Before any restart, the scheduler:

1. Enters drain mode — stops accepting new sessions (spawn gate in `spawnAgent()`)
2. Stops executing new scheduled jobs (tick loop short-circuits when draining)
3. Waits up to 5 minutes for active sessions to complete
4. Then exits (pm2 restarts it)

Implementation:
- `drain-state.ts` — shared boolean flag, readable without circular imports
- `service.ts` — `startDrain(timeoutMs?)` method: sets drain flag, polls for
  running job count to reach zero, resolves after completion or timeout
- `agent.ts` — spawn gate: throws if `isDraining()` is true
- `cli.ts` — SIGTERM/SIGINT handlers call `startDrain()` before exiting;
  evolution triggers drain instead of requiring zero active sessions
- `dashboard/routes.ts` — `POST /api/restart` endpoint for programmatic restart
- `ecosystem.config.cjs` — `kill_timeout: 330000` (5.5 min) so pm2 waits for drain
- 8 tests covering: drain state, drain with running jobs, drain timeout,
  idempotent drain, and spawn gate

## Consequences

- Active sessions are no longer killed during normal restarts (evolution, SIGTERM,
  API restart). They get up to 5 minutes to complete.
- New sessions are refused during drain. Callers (Slack bot, scheduled jobs) will
  see an error if they try to spawn during drain. This is acceptable because the
  restart completes within minutes and pm2 restarts the scheduler.
- pm2 `kill_timeout` of 330000ms (5.5 min) gives the drain timeout (5 min) plus
  a 30-second buffer before pm2 force-kills.
- The `POST /api/restart` endpoint allows agents or humans to trigger a graceful
  restart programmatically.
