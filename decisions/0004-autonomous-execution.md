# ADR-0004: Autonomous execution via claude CLI

Date: 2026-03-13
Status: accepted

## Context

Youji needs to run 24/7 without human trigger. The researcher has a Claude Max plan that supports concurrent `claude -p` sessions. The Claude Agent SDK would require a separate API key and per-token billing.

## Decision

Use `claude -p` (the CLI's non-interactive mode) as the execution backend, driven by a Node.js scheduler with cron timing. This leverages the existing Max plan at no additional cost.

Architecture:
- **Scheduler**: Node.js daemon with croner for timing, spawns `claude -p` as child processes
- **Supervisor session**: Opus model, runs on cron schedule (e.g., hourly), runs /orient to select and execute tasks
- **Fleet workers**: Multiple concurrent `claude -p` processes, each given a specific task, using Sonnet model for cost efficiency
- **Push queue**: Serialized git push to prevent concurrent conflicts
- **Approval queue**: APPROVAL_QUEUE.md for decisions requiring human judgment

## Consequences

- No dependency on Claude Agent SDK or separate API key
- Fleet parallelism limited only by Max plan's concurrent session support
- Scheduler is a simple Node.js process (~300-500 lines total)
- Can be deployed via PM2, systemd, or manual `node dist/index.js`
- Future self-hosted model backends can be added by implementing the spawn interface
