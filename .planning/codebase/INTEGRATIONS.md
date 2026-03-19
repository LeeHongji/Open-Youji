# External Integrations

**Analysis Date:** 2026-03-17

## APIs & External Services

**LLM Agent Backends:**

The scheduler supports three agent backends with automatic fallback (Claude → Cursor → opencode). Configured via `AGENT_BACKEND` env var or persisted preference in `.scheduler/backend-preference.json`.

- **Claude Code / Claude Agent SDK** — primary backend
  - SDK: `@anthropic-ai/claude-agent-sdk` ^0.2.42
  - Auth: inherited from Claude Code installation (ANTHROPIC_API_KEY used by claude CLI, not set by scheduler directly)
  - Interface: `infra/scheduler/src/sdk.ts` wraps `query()` from SDK
  - Cost tracking: full USD cost + per-model token usage reported via SDK result messages

- **Cursor Agent CLI** — secondary backend (fallback on rate limits)
  - Binary: `agent` (must be in PATH)
  - Auth: inherited from Cursor installation
  - Interface: `infra/scheduler/src/backend.ts` (`CursorBackend`) — spawns `agent -p --output-format stream-json --yolo --trust`
  - Default model: `opus-4.6-thinking`
  - Cost tracking: not supported (Cursor does not report cost)

- **opencode CLI** — tertiary backend (fleet workers, local/self-hosted LLM)
  - Binary: `$OPENCODE_BIN` (default: `/home/user/.opencode/bin/opencode`)
  - Auth: configured within opencode installation
  - Interface: `infra/scheduler/src/backend.ts` (`OpenCodeBackend`) — spawns `opencode run --format json --model glm5/zai-org/GLM-5-FP8`
  - Default model: `glm5/zai-org/GLM-5-FP8` (self-hosted GLM-5)
  - Cost tracking: reads from opencode's SQLite DB at `~/.local/share/opencode/opencode.db` via `infra/scheduler/src/opencode-db.ts`

## Data Storage

**Databases:**

- **opencode SQLite DB** — read-only, cost attribution
  - Path: `~/.local/share/opencode/opencode.db`
  - Client: `better-sqlite3` ^12.6.2
  - Access: `infra/scheduler/src/opencode-db.ts` — queries `message` table for token counts per session

- **Scheduler job store** — local JSON file
  - Path: `infra/scheduler/.scheduler/jobs.json` (relative to repo root)
  - Client: Node.js `fs/promises` built-in, atomic write via `.tmp` + rename
  - Schema: `Store { version: 1; jobs: Job[] }` — defined in `infra/scheduler/src/types.ts`

- **Session metrics store** — append-only NDJSON
  - Path: `.scheduler/metrics/sessions.jsonl`
  - Client: Node.js `fs` built-in (append writes)
  - Used by: report engine in `infra/scheduler/src/report/`

**File Storage:**
- Local filesystem only — all project data, experiments, logs, and metrics are files in the git repo or adjacent directories

**Caching:**
- None — all reads go directly to files or the opencode SQLite DB

## Authentication & Identity

**Auth Provider:**
- None — youji does not implement its own auth
- Agent backends authenticate through their respective CLIs (Claude Code, Cursor, opencode)
- Anthropic API key is managed by the Claude Code installation, not directly by youji

## Monitoring & Observability

**Error Tracking:**
- None — errors logged to stdout/stderr and optionally to `.scheduler/logs/`

**Logs:**
- Session logs: `.scheduler/logs/` — captured stdout from agent sessions
- Session metrics: `.scheduler/metrics/sessions.jsonl` — structured per-session data (cost, turns, backend, duration, verification scores)
- Inline git commit log — each session commits progress; `git log` is the primary operational heartbeat

**Reporting:**
- Built-in report engine: `infra/scheduler/src/report/` — generates Slack Block Kit messages with charts for session efficiency, budget status, experiment status. Chart rendering uses `chartjs-node-canvas`.

## CI/CD & Deployment

**Hosting:**
- Self-hosted — scheduler runs on the operator's machine or server
- Process manager: pm2 (`pm2 start infra/scheduler/ecosystem.config.js`)

**CI Pipeline:**
- None detected in repo — no `.github/workflows/` or similar

## Environment Configuration

**Required env vars (for production operation):**
- At least one agent backend available (Claude Code, Cursor, or opencode installed)
- `AGENT_BACKEND` — backend preference (optional; defaults to `auto`)
- `OPENCODE_BIN` — required if using opencode backend on non-default path

**For Slack notifications (reference implementation):**
- `SLACK_BOT_TOKEN` — Slack Bot OAuth token
- `SLACK_APP_TOKEN` — Slack App-level token (Socket Mode)
- `SLACK_USER_ID` — Slack user ID for DM notifications
- `SLACK_CHAT_CHANNELS` — comma-separated channel IDs for chat mode
- `SLACK_DEV_CHANNELS` — comma-separated channel IDs for dev mode

**Secrets location:**
- `infra/.env` — shared infra secrets (not committed)
- `infra/scheduler/.env` — scheduler-specific secrets (not committed)
- Agent backend auth (Anthropic API key, Cursor auth) managed outside this repo

## Webhooks & Callbacks

**Incoming:**
- Local HTTP control API at `127.0.0.1:8420` (or `SCHEDULER_PORT`)
  - `GET /api/status` — scheduler and session status
  - `POST /api/push/enqueue` — enqueue a git push request from fleet workers
  - `GET /api/push/status/:sessionId` — check push result
  - `POST /api/experiments/register` — register a running experiment for polling
  - Server: `infra/scheduler/src/api/server.ts` — plain Node.js `http.Server`

**Outgoing:**
- Git push to remote — serialized through push queue (`infra/scheduler/src/push-queue.ts`)
- Slack DMs and channel messages — via `@slack/bolt` in reference implementation (`infra/scheduler/reference-implementations/slack/`)
- No other outbound HTTP calls from the scheduler core

## Slack Integration (Reference Implementation)

Slack is **not active** in the shipped scheduler. The production `infra/scheduler/src/slack.ts` is a no-op stub that logs a hint message. The full implementation lives in `infra/scheduler/reference-implementations/slack/` and uses `@slack/bolt` with Socket Mode.

When enabled, Slack provides:
- Session completion notifications (with cost, duration, backend, commit summary)
- Approval queue alerts (pending `APPROVAL_QUEUE.md` items)
- Budget status reports
- Interactive commands: backend switching, burst approval, chat Q&A on approval items
- Experiment completion events via file watcher

---

*Integration audit: 2026-03-17*
