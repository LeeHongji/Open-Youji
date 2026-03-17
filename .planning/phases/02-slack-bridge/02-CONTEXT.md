# Phase 2: Slack Bridge - Context

**Gathered:** 2026-03-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the Slack Socket Mode connection with thread-to-session routing, conversation state persistence, and automatic reconnection. The mentor can send messages to Youji in Slack DMs and receive responses. This phase delivers the communication channel only — director intelligence and worker spawning are Phase 3.

</domain>

<decisions>
## Implementation Decisions

### Session persistence
- Thread-to-session state stored in SQLite via `better-sqlite3` (already a dependency)
- Load last 20 messages from thread history as context for each new invocation
- Director sessions are rebuilt fresh each time (no SDK `resume`) — inject thread history into prompt
- This aligns with the "event-driven director" decision: each message triggers a fresh Claude session with repo + thread context

### Slack app setup
- Socket Mode (WebSocket) — no public URL needed, works behind NAT on mentor's local machine
- DMs only — Youji listens exclusively in direct messages, not channels
- Events subscribed: `message.im` (DM messages) + `reaction_added` (for quick approvals like checkmark)
- Use `@slack/bolt` as the Slack framework (reference implementation already uses it)

### Message format
- Regular messages: Slack mrkdwn (markdown) — simple, readable, easy to generate from LLM output
- Action messages (approvals, status reports): Block Kit with buttons/sections for structured interaction
- Youji is concise by default (2-5 sentences). Detailed only when explicitly asked.
- Living messages for long tasks: update a single message with progress instead of spamming multiple messages (reference `living-message.ts` provides the pattern)

### Thread boundaries
- Top-level DM messages: Youji always creates a thread to reply — keeps DM clean, each conversation is a thread
- Thread sessions never expire — context always available in SQLite. New message in old thread resumes that session.
- Per-thread mutex to prevent concurrent message handling races (same pattern as existing ADR 0008)

### Claude's Discretion
- SQLite schema design for thread state
- Exact Slack app manifest scopes and permissions
- Reconnection backoff strategy
- How to handle Slack API rate limits
- Error message formatting when Claude session fails

</decisions>

<specifics>
## Specific Ideas

- Reference implementation at `infra/scheduler/reference-implementations/slack/` provides patterns for: Slack bot wiring (`slack.ts`), chat thread handling (`chat/chat.ts`), living message updates (`living-message.ts`), and app manifest (`slack-app-manifest.yaml`)
- The mentor wants Youji to feel like a responsive colleague in Slack, not a command-line tool wrapped in chat

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `reference-implementations/slack/slack.ts`: Slack bot wiring, notification patterns, event handlers
- `reference-implementations/slack/chat/chat.ts`: Thread-to-context mapping, message routing
- `reference-implementations/slack/chat/thread-turns.ts`: Thread history fetching
- `reference-implementations/slack/living-message.ts`: Updatable "living" messages with persistence
- `reference-implementations/slack/slack-app-manifest.yaml`: App configuration template
- `better-sqlite3`: Already in dependencies, used by `opencode-db.ts` — patterns for schema creation and sync queries

### Established Patterns
- ESM with `.js` imports, 2-space indent, kebab-case files
- Console logging with `[module-name]` prefix
- Error handling: try/catch with best-effort fallback
- Named exports only
- Options objects for complex configurations

### Integration Points
- `infra/scheduler/src/slack.ts`: Currently a no-op stub — this is where the real Slack bridge will live
- `service.ts`: Scheduler service startup — Slack bridge initializes alongside the polling loop
- `cli.ts`: Environment variable loading from `infra/scheduler/.env` — SLACK_BOT_TOKEN, SLACK_APP_TOKEN loaded here
- `api/server.ts`: Control API — may need endpoints for Slack bridge status

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-slack-bridge*
*Context gathered: 2026-03-17*
