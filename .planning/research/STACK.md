# Technology Stack

**Project:** Youji -- Slack Bot + Claude CLI Migration
**Researched:** 2026-03-15
**Overall confidence:** HIGH (existing codebase provides strong constraints; all recommendations verified against official docs)

## Recommended Stack

### Slack SDK

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `@slack/bolt` | ^4.6.0 | Slack bot framework (Socket Mode) | Already used in reference implementation. Socket Mode means no public HTTP endpoint needed -- critical for local Mac deployment. Bolt handles event routing, slash commands, action handlers, and Block Kit responses in a single abstraction. v4 bundles `@slack/web-api` v7 and has full TypeScript support. | HIGH |

**Do NOT use:**
- `@slack/web-api` directly -- Bolt wraps it and provides higher-level event/command routing. Using web-api alone means reimplementing Socket Mode, event parsing, and ack logic manually.
- Slack's new "next-gen platform" (Deno-based) -- requires Slack-hosted functions. Youji runs locally, needs full CLI access, and cannot be sandboxed in Slack's runtime.
- Python `slack-bolt` -- the scheduler is TypeScript. Adding a Python Slack process creates unnecessary IPC complexity.

### Claude CLI Execution

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `claude` CLI (via `node:child_process.spawn`) | Latest installed | Spawn agent sessions | Direct subprocess spawning with `claude -p "prompt" --output-format stream-json` gives NDJSON streaming events (tool calls, assistant messages, results). The existing `backend.ts` already implements this pattern for Cursor and opencode -- Claude CLI follows the same spawn-parse-resolve pattern. No SDK dependency needed; the CLI is the execution engine. | HIGH |
| `@anthropic-ai/claude-agent-sdk` | ^0.2.42 (existing) | **REMOVE** -- replaced by raw CLI spawning | The Agent SDK wraps `claude` CLI subprocess spawning with `query()`. But it adds ~12s overhead per call, debug spam on stderr, and an npm dependency that breaks when the CLI binary path changes. Raw `spawn("claude", ["-p", ...])` is simpler, matches the Cursor/opencode pattern in `backend.ts`, and gives full control over stream parsing. The reference implementation already demonstrates this approach works. | HIGH |

**CLI invocation pattern:**
```
claude -p "<prompt>" \
  --output-format stream-json \
  --verbose \
  --allowedTools "Bash,Read,Write,Edit,Glob,Grep" \
  --max-turns <N>
```

Each line of stdout is a JSON event: `{type: "assistant", ...}`, `{type: "tool_use", ...}`, `{type: "result", ...}`. Parse with `readline` on `proc.stdout` -- identical to the existing `parseOpenCodeMessage` / `parseCursorMessage` pattern.

**Do NOT use:**
- `@anthropic-ai/claude-code` npm package -- this IS the Claude Code CLI packaged as npm. It has a known broken entry point issue and is not designed to be imported as a library. Install `claude` CLI globally via `npm install -g @anthropic-ai/claude-code` and spawn it.
- Direct Anthropic API (`@anthropic-ai/sdk`) -- PROJECT.md explicitly excludes direct API calls. Claude CLI provides tool use, MCP, skills, CLAUDE.md loading, and file system access that raw API does not.

### Process Management

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| PM2 | ^5.x (latest) | Daemon lifecycle for scheduler | Already referenced in the codebase (`infra/scheduler/`). Handles auto-restart on crash, log rotation, startup scripts. On macOS, `pm2 startup` generates a launchd plist. Simple and battle-tested for single-process Node.js daemons. | HIGH |

**Do NOT use:**
- systemd -- macOS does not have systemd. launchd is the native alternative, but PM2 abstracts it and provides better DX (logs, restart, status).
- Docker -- adds unnecessary complexity for a single-process local daemon. No isolation benefit since Youji needs host filesystem and CLI access.
- `forever` / `nodemon` -- obsolete for production use. PM2 has clustering, log management, and monitoring that these lack.

### Message Formatting

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Slack Block Kit (via Bolt's `say()` / `client.chat.postMessage()`) | N/A (Slack API) | Rich message formatting | Block Kit is Slack's standard for structured messages. Supports sections, dividers, code blocks, context lines, buttons, and threaded replies. The reference implementation already uses Block Kit extensively (`buildSessionBlocks`, `buildApprovalBlocks`). No additional library needed -- Bolt's `say()` accepts Block Kit JSON directly. | HIGH |
| `chartjs-node-canvas` | ^5.0.0 (existing) | Server-side chart rendering for reports | Already in `package.json`. Generates PNG charts that are uploaded to Slack threads via `files.uploadV2`. Keep as-is. | HIGH |

**Do NOT use:**
- Slack's `mrkdwn` alone -- too limited for structured reports (no tables, no side-by-side layout). Block Kit sections with `mrkdwn` text fields are the correct granularity.
- External templating libraries (Handlebars, EJS) for Slack messages -- Block Kit is JSON, not HTML. Build helper functions that return Block Kit JSON arrays (the reference implementation demonstrates this pattern well).

### Supporting Libraries (New)

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| `croner` | ^9.0.0 (existing) | Cron scheduling | Already handles scheduled session triggers. Extend for Slack-triggered on-demand sessions by combining cron jobs with Slack event handlers. | HIGH |
| `better-sqlite3` | ^12.6.2 (existing) | Session/cost tracking | Keep for cost tracking. May extend schema to track Slack-initiated sessions vs. scheduled sessions. | HIGH |
| `node:child_process` | Built-in | CLI spawning | Core of the new Claude backend. `spawn()` with `stdio: ["pipe", "pipe", "pipe"]` for stdin prompt delivery and stdout NDJSON parsing. | HIGH |

### Libraries to Remove

| Library | Reason |
|---------|--------|
| `@anthropic-ai/claude-agent-sdk` | Replaced by direct `claude` CLI spawning. Removes the 12s overhead, stderr debug spam, and npm dependency. The `sdk.ts` file and `ClaudeBackend` class in `backend.ts` should be rewritten to use raw `spawn("claude", [...])`. |

## Architecture Decisions

### Socket Mode over HTTP Mode

Socket Mode establishes a WebSocket connection from the bot to Slack's servers. This means:
- No public URL or ngrok needed (critical for local Mac deployment)
- No TLS certificate management
- Firewall-friendly (outbound-only connections)
- Already configured in the reference implementation's app manifest

**Tradeoff:** Socket Mode requires an App-Level Token (`xapp-...`) in addition to the Bot Token (`xoxb-...`). Both are already documented in the reference implementation's env vars.

### Claude CLI Output Parsing Strategy

The `stream-json` output format provides real-time events. The recommended parsing approach:

1. Spawn `claude -p "<prompt>" --output-format stream-json --verbose`
2. Read stdout line-by-line via `node:readline`
3. Parse each line as JSON
4. Map to the existing `SDKMessage`-compatible interface (same pattern as `parseCursorMessage` and `parseOpenCodeMessage`)
5. On process exit, resolve the `QueryResult` promise

This is a direct port of the existing `OpenCodeBackend.spawnAgent()` method. The only change is the binary name and CLI flags.

### Slack Message Pattern: Summary + Thread

Per PROJECT.md requirements:
- **Channel message:** Clean summary (Block Kit sections with status, cost, key findings)
- **Thread replies:** Detailed logs, tool call traces, full output
- **Living messages:** Update the channel message in-place during execution (already implemented in reference)

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Slack SDK | `@slack/bolt` (JS) | `slack-bolt` (Python) | Scheduler is TypeScript; adding Python Slack process creates IPC overhead and split-brain state |
| Slack SDK | `@slack/bolt` (JS) | Slack next-gen platform (Deno) | Requires Slack-hosted functions; Youji needs local CLI access |
| Slack transport | Socket Mode | HTTP Mode (Events API) | Requires public URL or ngrok; local Mac has no stable public endpoint |
| Claude execution | Raw CLI spawn | `@anthropic-ai/claude-agent-sdk` | 12s overhead per call, debug spam, extra dependency; raw spawn matches existing Cursor/opencode pattern |
| Claude execution | Raw CLI spawn | Direct Anthropic API | Loses Claude Code's tool use, MCP, skills, CLAUDE.md, file system access |
| Process manager | PM2 | Docker | Unnecessary isolation overhead; Youji needs host FS and CLI access |
| Process manager | PM2 | launchd (raw) | PM2 abstracts launchd with better DX (logs, status, restart commands) |
| Message format | Block Kit JSON | Custom HTML/templates | Block Kit is Slack's native format; no rendering engine needed |

## Installation

```bash
# In infra/scheduler/
# Add Slack dependency (was reference-only, now production)
npm install @slack/bolt@^4.6.0

# Remove deprecated SDK (after migration)
npm uninstall @anthropic-ai/claude-agent-sdk

# Existing dependencies stay as-is
# better-sqlite3, croner, chart.js, chartjs-node-canvas -- all kept

# Dev dependencies stay as-is
# typescript, vitest, @types/better-sqlite3, @types/node
```

```bash
# Claude CLI (global, already installed on host)
# Verify: claude --version
# If missing: npm install -g @anthropic-ai/claude-code
```

```bash
# PM2 (global, for daemon management)
npm install -g pm2
pm2 startup  # generates launchd plist for macOS auto-start
```

## Environment Variables (New/Modified)

```bash
# Required for Slack (move from reference to production)
SLACK_BOT_TOKEN=xoxb-...        # Bot OAuth token
SLACK_APP_TOKEN=xapp-...        # App-level token for Socket Mode
SLACK_USER_ID=U...              # Mentor's Slack user ID (for DM routing)

# Optional Slack config (carried from reference)
SLACK_DEV_CHANNELS=C...         # Development channel IDs (comma-separated)
SLACK_CHAT_CHANNELS=C...        # Chat-mode channel IDs
SLACK_CHAT_MODEL=sonnet         # Model for chat sessions
SLACK_LIVING_MESSAGE=1          # Enable living messages (default: enabled)

# Modified backend config
AGENT_BACKEND=claude            # Lock to Claude-only (remove auto/cursor/opencode fallback)
```

## Sources

- [@slack/bolt npm page](https://www.npmjs.com/package/@slack/bolt) -- v4.6.0 confirmed (HIGH)
- [Slack Bolt.js official docs](https://docs.slack.dev/tools/bolt-js/) -- Socket Mode, events, commands (HIGH)
- [Claude Code headless mode docs](https://code.claude.com/docs/en/headless) -- `--output-format stream-json`, `-p` flag (HIGH)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference) -- CLI flags and options (HIGH)
- [Slack Block Kit docs](https://docs.slack.dev/block-kit/) -- Message formatting reference (HIGH)
- [Claude Agent SDK TypeScript repo](https://github.com/anthropics/claude-agent-sdk-typescript) -- 12s overhead issue, subprocess spawning internals (MEDIUM)
- [Slack app manifest reference](https://docs.slack.dev/tools/bolt-js/getting-started/) -- Socket Mode setup (HIGH)
- Existing codebase: `infra/scheduler/reference-implementations/slack/` -- production-tested Slack patterns (HIGH)
- Existing codebase: `infra/scheduler/src/backend.ts` -- CLI spawn pattern to replicate (HIGH)

---
*Stack research: 2026-03-15*
