# Youji Scheduler

Autonomous session daemon — wakes Youji up on a cron schedule, manages fleet workers, and handles git push coordination.

## Quick start

```bash
npm install
npm run build
node dist/index.js          # Start daemon
node dist/index.js run      # Run one session now
node dist/index.js status   # Show status
```

## Configuration

Copy `.env.example` to `.env` and adjust:

| Variable | Default | Description |
|----------|---------|-------------|
| `CRON_SCHEDULE` | `0 * * * *` | Cron expression (hourly) |
| `MAX_CONCURRENT` | `1` | Max concurrent sessions |
| `FLEET_SIZE` | `0` | Fleet workers (0 = disabled) |
| `API_PORT` | `8420` | Control API port |

## How it works

```
Every cron tick:
  1. Check: can we start a session? (max concurrent, instance lock)
  2. Auto-commit any orphaned files from previous sessions
  3. Spawn: claude -p "<supervisor prompt>" --model opus
  4. Wait for completion (max 30 min)
  5. Auto-commit any remaining orphans
  6. git pull --rebase && git push (fallback to branch on conflict)
  7. If FLEET_SIZE > 0: scan TASKS.md, spawn fleet workers for eligible tasks
```

## Fleet

Set `FLEET_SIZE=4` to enable 4 concurrent fleet workers (Sonnet model). Workers are assigned specific tasks from `TASKS.md` — they don't run /orient.

## Deployment

```bash
# PM2 (recommended)
pm2 start dist/index.js --name youji -- start
pm2 save

# Manual
node dist/index.js start &
```

## Architecture

```
index.ts      Entry point, cron setup, CLI commands
scheduler.ts  Session tracking, config, concurrency control
session.ts    Prompt building, claude -p spawning
tasks.ts      TASKS.md parsing, fleet eligibility
git.ts        Auto-commit, rebase-push
types.ts      Type definitions
```
