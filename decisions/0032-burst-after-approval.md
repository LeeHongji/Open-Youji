# 0032: Autonomous Burst Mode After Approval

Date: 2026-02-22
Status: accepted

## Context

Burst mode (`node dist/cli.js burst ...`) runs multiple autonomous sessions in rapid succession with stop conditions (max sessions, max cost, no actionable tasks, errors). Previously it could only be triggered manually via CLI.

Users wanted a way to request a burst of sessions through the approval queue — submit a request, have a human approve it, and have the scheduler automatically launch the burst without further manual intervention.

## Decision

Add a `burst` type to the APPROVAL_QUEUE.md schema with burst-specific fields (Job, Max-sessions, Max-cost, Autofix, Autofix-retries). The scheduler's poll loop (`onTick`) checks for approved-but-unexecuted burst items on every tick (30s). When found:

1. The item is marked with `Executed: YYYY-MM-DD` to prevent re-triggering
2. A Slack notification announces the burst launch
3. `runBurst()` executes with the approved parameters
4. A summary notification is posted on completion

Only one burst runs at a time (guarded by `burstInProgress` flag). The first un-executed approved burst is picked up; subsequent ones wait.

## Consequences

- Agents can request burst execution via APPROVAL_QUEUE.md with `Type: burst`
- Humans approve/deny via existing Slack-based approval workflow
- No new CLI commands needed — the existing burst infrastructure is reused
- The `heartbeat` CLI command now also reports pending approved bursts
- Guard prevents overlapping bursts; multiple approved bursts execute sequentially across ticks
