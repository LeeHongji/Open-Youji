# Technology Stack

**Analysis Date:** 2026-03-17

## Languages

**Primary:**
- TypeScript 5.9.x — all scheduler source (`infra/scheduler/src/`)
- Python 3.12.x — infra utilities (`infra/budget-verify/`, `infra/experiment-runner/`, `infra/experiment-validator/`)

**Secondary:**
- YAML — budget/ledger schema files (`budget.yaml`, `ledger.yaml` in project dirs)
- JSON — scheduler job store (`.scheduler/jobs.json`), NDJSON session metrics (`.scheduler/metrics/sessions.jsonl`)
- Markdown — all project memory, task lists, decision records, experiment records

## Runtime

**Environment:**
- Node.js 18+ required (v25.7.0 detected on dev machine) — for scheduler
- Python 3.12.x via pixi (conda-forge) — for infra utilities

**Package Manager:**
- npm — `infra/scheduler/` (lockfile: not detected in repo, `node_modules/` gitignored)
- pixi — `infra/budget-verify/`, `infra/experiment-validator/` (lockfiles committed: `pixi.lock`)

## Frameworks

**Core:**
- None (scheduler is intentionally minimal — Node.js built-ins + croner only)

**Testing:**
- vitest ^4.0.18 — test runner for scheduler (`infra/scheduler/vitest.config.ts`)
- pytest ^8 — test runner for Python infra utilities

**Build/Dev:**
- TypeScript compiler (`tsc`) — build target ES2022, module Node16
- No bundler (output is plain `.js` ESM files in `dist/`)

## Key Dependencies

**Critical:**
- `@anthropic-ai/claude-agent-sdk` ^0.2.42 — primary agent execution backend; wraps `claude -p` sessions with cost tracking, message streaming, and session supervision (`infra/scheduler/src/sdk.ts`)
- `croner` ^9.0.0 — cron expression parsing and next-run computation (`infra/scheduler/src/schedule.ts`)
- `better-sqlite3` ^12.6.2 — reads opencode's SQLite session database at `~/.local/share/opencode/opencode.db` for cost attribution (`infra/scheduler/src/opencode-db.ts`)

**Infrastructure:**
- `chart.js` ^4.5.1 + `chartjs-node-canvas` ^5.0.0 — server-side chart rendering for session reports (`infra/scheduler/src/report/chart-render.ts`)
- `pyyaml` >=6 — YAML parsing in Python infra tools (budget/ledger files)

**Reference Implementation Only (not active):**
- `@slack/bolt` — Slack bot SDK; used in `infra/scheduler/reference-implementations/slack/` but not shipped in production scheduler. The active `infra/scheduler/src/slack.ts` is a no-op stub.

## Configuration

**Environment:**
- Two-layer `.env` loading in `infra/scheduler/src/cli.ts`:
  - `infra/.env` — shared infra vars (Databricks, AWS, etc.)
  - `infra/scheduler/.env` — scheduler-specific vars
- System env vars always override `.env` values
- No `.env` files committed (gitignored)

**Key env vars:**
- `AGENT_BACKEND` — selects backend: `claude` | `cursor` | `opencode` | `auto` (default: `auto`)
- `OPENCODE_BIN` — path to opencode binary (default: `/home/user/.opencode/bin/opencode`)
- `SCHEDULER_PORT` — control API port (default: `8420`)
- `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_USER_ID` — Slack integration (reference impl only)
- `SLACK_CHAT_CHANNELS`, `SLACK_DEV_CHANNELS` — channel mode configuration
- `SLACK_CHAT_MODEL` — model for chat sessions (default: `sonnet`)
- `REPORT_DAILY_CRON`, `REPORT_WEEKLY_CRON` — cron schedules for reports
- `BRANCH_CLEANUP_CRON` — cron for branch cleanup (default: `Mon 00:00`)
- `RECURRING_TASKS_CRON` — cron for recurring tasks (default: `Sun 00:00`)

**Build:**
- `infra/scheduler/tsconfig.json` — strict TypeScript, ES2022 target, Node16 module resolution
- Test files excluded from build output (`src/**/*.test.ts`)

## Platform Requirements

**Development:**
- Node.js 18+, npm
- Python 3.12+, pixi (for budget-verify, experiment-validator)
- At least one agent CLI installed: `claude` (Claude Code), `agent` (Cursor), or `opencode`

**Production:**
- pm2 — process manager for scheduler daemon (`pm2 start infra/scheduler/ecosystem.config.js`)
- Git — required; the repo is the system's persistent memory
- Linux/macOS (pixi targets: `linux-64`, `linux-aarch64`, `osx-arm64`)

---

*Stack analysis: 2026-03-17*
