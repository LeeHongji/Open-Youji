# Phase 2: Slack Bridge - Research

**Researched:** 2026-03-18
**Domain:** Slack Socket Mode bot with thread-based session routing and SQLite persistence
**Confidence:** HIGH

## Summary

Phase 2 builds the communication channel between the mentor and Youji via Slack DMs. The technical stack is well-established: `@slack/bolt` provides a mature Socket Mode framework with built-in WebSocket reconnection, `better-sqlite3` (already a dependency) handles synchronous thread state persistence, and the reference implementation at `infra/scheduler/reference-implementations/slack/` provides battle-tested patterns for every major concern.

The core challenge is mapping Slack's event-driven message model to a "fresh session per message" architecture: each incoming DM triggers a new Claude Agent SDK query with the last 20 messages from the thread loaded as context. Thread isolation is achieved via `channel:thread_ts` composite keys, and concurrency is controlled by a promise-based per-thread mutex (already proven in the reference implementation's `ConversationLock` class).

**Primary recommendation:** Adapt the reference implementation patterns into `infra/scheduler/src/slack.ts` (replacing the current no-op stub), adding a new `thread-store.ts` for SQLite-backed thread state, and wiring the bridge into `service.ts` startup.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Thread-to-session state stored in SQLite via `better-sqlite3` (already a dependency)
- Load last 20 messages from thread history as context for each new invocation
- Director sessions are rebuilt fresh each time (no SDK `resume`) — inject thread history into prompt
- This aligns with the "event-driven director" decision: each message triggers a fresh Claude session with repo + thread context
- Socket Mode (WebSocket) — no public URL needed, works behind NAT on mentor's local machine
- DMs only — Youji listens exclusively in direct messages, not channels
- Events subscribed: `message.im` (DM messages) + `reaction_added` (for quick approvals like checkmark)
- Use `@slack/bolt` as the Slack framework (reference implementation already uses it)
- Regular messages: Slack mrkdwn (markdown) — simple, readable, easy to generate from LLM output
- Action messages (approvals, status reports): Block Kit with buttons/sections for structured interaction
- Youji is concise by default (2-5 sentences). Detailed only when explicitly asked.
- Living messages for long tasks: update a single message with progress instead of spamming multiple messages (reference `living-message.ts` provides the pattern)
- Top-level DM messages: Youji always creates a thread to reply — keeps DM clean, each conversation is a thread
- Thread sessions never expire — context always available in SQLite. New message in old thread resumes that session.
- Per-thread mutex to prevent concurrent message handling races (same pattern as existing ADR 0008)

### Claude's Discretion
- SQLite schema design for thread state
- Exact Slack app manifest scopes and permissions
- Reconnection backoff strategy
- How to handle Slack API rate limits
- Error message formatting when Claude session fails

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SLACK-01 | Slack bot connects via Socket Mode (no public HTTP endpoint needed) | `@slack/bolt` with `socketMode: true` and `appToken` — verified pattern in Context7 and reference implementation |
| SLACK-02 | Messages in a Slack thread are routed to the same director session context | `channel:thread_ts` composite key for conversation routing; SQLite stores thread history; last 20 messages loaded as context |
| SLACK-03 | New Slack threads create new session contexts | Top-level DMs get `thread_ts = message.ts`; new threads create fresh SQLite rows; reference pattern at line 181 of `slack.ts` |
| SLACK-04 | Bot reconnects automatically on WebSocket disconnect without losing conversation state | Bolt's SocketModeReceiver handles reconnection automatically; state in SQLite survives restarts; `app.error()` for logging |
| SLACK-05 | Per-thread mutex prevents concurrent message handling races | `ConversationLock` class from reference `chat.ts` (promise-based, zero-dependency); key is `channel:thread_ts` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@slack/bolt` | `^4.1.0` | Slack app framework (Socket Mode, events, actions) | Official Slack SDK; built-in SocketModeReceiver; handles WebSocket lifecycle and reconnection; used by reference implementation |
| `better-sqlite3` | `^12.6.2` | Thread state persistence (synchronous SQLite) | Already a dependency; synchronous API avoids async complexity in mutex-guarded paths; WAL mode for concurrent reads |
| `@anthropic-ai/claude-agent-sdk` | `^0.2.42` | Claude session spawning | Already a dependency; `sdk.ts` wrapper provides `runQuery`/`runQuerySupervised` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none needed) | — | — | All supporting needs covered by core stack and Node.js builtins |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@slack/bolt` | `@slack/socket-mode` + `@slack/web-api` raw | More control but significantly more boilerplate; Bolt wraps both with middleware patterns |
| `better-sqlite3` | In-memory `Map` | Loses state on restart; violates SLACK-04 requirement for surviving reconnections |
| SQLite for thread state | JSON files | No atomic writes, no query capability, poor concurrent access |

**Installation:**
```bash
cd infra/scheduler && npm install @slack/bolt
```

Note: `better-sqlite3` and `@anthropic-ai/claude-agent-sdk` are already in `package.json`.

## Architecture Patterns

### Recommended File Structure
```
src/
├── slack.ts              # Replace no-op stub: Bolt app init, event handlers, public API
├── thread-store.ts       # SQLite schema + CRUD for thread messages and metadata
├── thread-mutex.ts       # ConversationLock (per-thread promise-based mutex)
├── slack.test.ts         # Tests for event routing, thread key derivation
├── thread-store.test.ts  # Tests for SQLite operations
├── thread-mutex.test.ts  # Tests for mutex serialization
└── sdk.ts                # (existing) Claude Agent SDK wrapper — no changes needed
```

### Pattern 1: Thread Key Derivation
**What:** Every Slack message maps to a conversation key `channel:thread_ts`. Top-level DMs use the message's own `ts` as `thread_ts`.
**When to use:** Every incoming `message.im` event.
**Example:**
```typescript
// Source: reference-implementations/slack/slack.ts line 181
const threadTs = message.thread_ts ?? message.ts;
const convKey = `${message.channel}:${threadTs}`;
```

### Pattern 2: Per-Thread Mutex
**What:** A promise-chain lock keyed by `convKey` that serializes message processing per thread.
**When to use:** Before processing any message in a thread.
**Example:**
```typescript
// Source: reference-implementations/slack/chat/chat.ts lines 102-118
class ConversationLock {
  private locks = new Map<string, Promise<void>>();

  async acquire(key: string): Promise<() => void> {
    while (this.locks.has(key)) {
      await this.locks.get(key);
    }
    let release!: () => void;
    const promise = new Promise<void>((resolve) => { release = resolve; });
    this.locks.set(key, promise);
    return () => {
      this.locks.delete(key);
      release();
    };
  }
}
```

### Pattern 3: Fresh Session with Thread History
**What:** Each message spawns a new Claude session. The last 20 messages from the thread (stored in SQLite) are injected into the system prompt as conversation context.
**When to use:** Every message handler invocation.
**Example:**
```typescript
// Pseudocode — actual implementation in Phase 3 (Director) will add intelligence
const history = threadStore.getMessages(convKey, { limit: 20 });
const contextBlock = history
  .map(m => `[${m.role}]: ${m.content}`)
  .join("\n");

const result = await runQuery({
  prompt: userMessage,
  cwd: repoDir,
  systemPrompt: `You are Youji.\n\nConversation history:\n${contextBlock}`,
  maxTurns: 10,
});

// Store both user message and assistant response
threadStore.addMessage(convKey, { role: "user", content: userMessage, ts: message.ts });
threadStore.addMessage(convKey, { role: "assistant", content: result.text, ts: Date.now().toString() });
```

### Pattern 4: SQLite Thread Store Schema
**What:** Two tables — `threads` for metadata and `thread_messages` for conversation history.
**When to use:** Database initialization at startup.
**Example:**
```typescript
// Source: better-sqlite3 Context7 docs + opencode-db.ts patterns
import Database from "better-sqlite3";

function initThreadDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS threads (
      conv_key TEXT PRIMARY KEY,      -- "channel:thread_ts"
      channel TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_activity_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS thread_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conv_key TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      slack_ts TEXT,                   -- Slack message timestamp (for dedup)
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (conv_key) REFERENCES threads(conv_key)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_thread_messages_conv_key
    ON thread_messages(conv_key, created_at DESC)
  `);

  return db;
}
```

### Pattern 5: Slack App Initialization (Socket Mode, DM Only)
**What:** Minimal Bolt app configured for Socket Mode with DM-only event handling.
**When to use:** Application startup.
**Example:**
```typescript
// Source: Context7 @slack/bolt docs + reference slack-app-manifest.yaml
import { App, LogLevel } from "@slack/bolt";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.WARN,
});

// DM messages only — message.im events
app.message(async ({ message, say, client }) => {
  if (message.subtype || !("text" in message)) return;
  // ... route to thread handler
});

// Reaction approvals
app.event("reaction_added", async ({ event }) => {
  // event.reaction, event.user, event.item.ts, event.item.channel
});

// Global error handler
app.error(async (error) => {
  console.error("[slack] Unhandled error:", error);
});

await app.start();
```

### Anti-Patterns to Avoid
- **Storing thread state in memory only:** Violates SLACK-04. Process restart loses all context. SQLite is mandatory.
- **Using SDK `resume` for multi-message conversations:** User explicitly decided against this. Fresh session per message with history injection.
- **Processing messages without mutex:** Race condition where two rapid messages in the same thread spawn overlapping sessions that interleave responses.
- **Subscribing to channel events:** User decided DMs only. Do not handle `message.channels`, `message.groups`, or `app_mention`.
- **Posting responses as top-level DMs:** Always reply in thread (`thread_ts`). Top-level messages create a new thread; replies go into existing threads.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket connection management | Custom WebSocket client with heartbeat/reconnect | `@slack/bolt` Socket Mode | Handles reconnection, heartbeat, backoff automatically; battle-tested at scale |
| Slack API rate limiting | Custom retry/backoff logic | Bolt's built-in retry handler | `@slack/bolt` automatically retries rate-limited requests with proper backoff |
| Message deduplication | Custom dedup logic for retried events | Slack's `event_id` + SQLite `slack_ts` UNIQUE constraint | Slack may retry events; store `slack_ts` and use INSERT OR IGNORE |
| Thread history pagination | Manual cursor-based Slack API pagination | `conversations.replies` API with `limit` param | Slack API handles pagination; but we primarily read from SQLite, not Slack API |
| Living message rate limiting | Custom timer for message updates | Reference `living-message.ts` coalesced update pattern | Already implements 3-second minimum interval with pending update merging |

**Key insight:** Bolt handles the hard parts of Slack integration (WebSocket lifecycle, event parsing, retry logic, rate limiting). The custom code is limited to thread-state persistence and session spawning — both well-understood patterns.

## Common Pitfalls

### Pitfall 1: Message Subtype Filtering
**What goes wrong:** Bot processes its own messages, edited messages, or system messages, causing infinite loops or crashes.
**Why it happens:** Slack sends `message.im` events for ALL message subtypes including `bot_message`, `message_changed`, `message_deleted`.
**How to avoid:** Guard every message handler with `if (message.subtype || !("text" in message)) return;` — this is the first line of the reference implementation's handler.
**Warning signs:** Bot responding to itself, duplicate processing, errors on missing `text` field.

### Pitfall 2: thread_ts vs ts Confusion
**What goes wrong:** Thread routing breaks — messages in the same thread get different `convKey` values.
**Why it happens:** A message's `ts` is its own timestamp; `thread_ts` is the parent thread's timestamp. Top-level messages have no `thread_ts`. Replies have both.
**How to avoid:** Always use `message.thread_ts ?? message.ts` for thread identification. The fallback to `message.ts` handles top-level messages that start new threads.
**Warning signs:** Each message creating a new conversation context instead of continuing existing threads.

### Pitfall 3: Socket Mode Token Confusion
**What goes wrong:** App fails to connect with "invalid_auth" or similar errors.
**Why it happens:** Socket Mode requires TWO tokens: a Bot Token (`xoxb-...`) for API calls and an App-Level Token (`xapp-...`) for the WebSocket connection. They are configured in different places in Slack's admin UI.
**How to avoid:** Document clearly in `.env.example`: `SLACK_BOT_TOKEN=xoxb-...` and `SLACK_APP_TOKEN=xapp-...`. The App-Level Token needs `connections:write` scope, generated under Basic Information > App-Level Tokens.
**Warning signs:** Bolt constructor throws immediately, or WebSocket fails to establish.

### Pitfall 4: Forgetting to Reply in Thread
**What goes wrong:** Bot's response creates a new top-level message instead of replying in the thread.
**Why it happens:** `say()` without `thread_ts` posts to the channel root. For DMs this creates clutter instead of threaded conversations.
**How to avoid:** Always pass `thread_ts` to `say()`: `say({ text: response, thread_ts: threadTs })`. The reference implementation does this consistently.
**Warning signs:** DM channel fills with flat messages instead of organized threads.

### Pitfall 5: SQLite Concurrent Write Contention
**What goes wrong:** "SQLITE_BUSY" errors when multiple threads write simultaneously.
**Why it happens:** SQLite in default journal mode locks the entire database during writes. Even WAL mode can contend under high write load.
**How to avoid:** Enable WAL mode (`PRAGMA journal_mode = WAL`) and set `PRAGMA busy_timeout = 5000` to retry on contention. The per-thread mutex also helps by serializing writes per conversation.
**Warning signs:** Intermittent database errors under concurrent message load.

### Pitfall 6: Event Retry Causing Duplicate Processing
**What goes wrong:** Slack retries unacknowledged events, causing the same message to be processed twice.
**Why it happens:** If the handler takes too long (>3 seconds for Socket Mode), Slack may redeliver the event. Bolt acknowledges events before handler execution, but edge cases exist.
**How to avoid:** Store `slack_ts` in `thread_messages` with a UNIQUE constraint. Before processing, check if the message is already stored. Use INSERT OR IGNORE.
**Warning signs:** Duplicate bot responses in threads.

## Code Examples

### Slack App Manifest (DM-Only, Socket Mode)
```yaml
# Source: reference-implementations/slack/slack-app-manifest.yaml (adapted for DM-only)
display_information:
  name: Youji
  description: Autonomous research group assistant
  background_color: "#2c2d30"

features:
  bot_user:
    display_name: Youji
    always_online: true

oauth_config:
  scopes:
    bot:
      - chat:write          # Send messages, update living messages
      - im:history          # Receive DM message events
      - im:write            # Open DM conversations
      - reactions:read      # Detect reaction_added events
      - reactions:write     # Acknowledge with emoji reactions
      - users:read          # Resolve user display names

settings:
  event_subscriptions:
    bot_events:
      - message.im          # DM messages
      - reaction_added      # Quick approvals via emoji
  interactivity:
    is_enabled: true        # Required for Block Kit buttons
  org_deploy_enabled: false
  socket_mode_enabled: true
  token_rotation_enabled: false
```

### Environment Variables
```bash
# Required in infra/scheduler/.env
SLACK_BOT_TOKEN=xoxb-...        # Bot User OAuth Token (OAuth & Permissions page)
SLACK_APP_TOKEN=xapp-...        # App-Level Token with connections:write (Basic Information page)
```

### Global Error Handler
```typescript
// Source: Context7 @slack/bolt error handling docs
app.error(async (error) => {
  console.error("[slack] Unhandled Bolt error:", error);
  // Don't throw — let Bolt continue running
});
```

### Acknowledging Messages with Reactions
```typescript
// Source: Context7 @slack/bolt + reference-implementations/slack/slack.ts
// Quick visual feedback while processing
try {
  await client.reactions.add({
    channel: message.channel,
    timestamp: message.ts,
    name: "eyes",  // Shows "processing"
  });
} catch {
  // Best-effort — don't fail if reaction can't be added
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| HTTP Request URL (public endpoint) | Socket Mode (WebSocket) | Bolt v3.0.0+ | No public URL needed; works behind NAT/firewall |
| `@slack/rtm-api` (RTM) | Socket Mode via `@slack/bolt` | 2021 (RTM deprecated for new apps) | RTM deprecated; Socket Mode is the replacement |
| Manual event acknowledgment | Bolt handles ack automatically | Bolt v1.0+ | No risk of event retry from slow ack |
| `require('@slack/bolt')` | ESM `import { App } from "@slack/bolt"` | Bolt v4.0+ | Aligns with project's ESM-only codebase |

**Deprecated/outdated:**
- **RTM API:** Deprecated for new Slack apps. Socket Mode is the replacement.
- **HTTP-based event subscriptions:** Still supported but unnecessary for single-workspace bots behind NAT.

## Open Questions

1. **Interactivity toggle for Block Kit buttons**
   - What we know: Block Kit buttons require `interactivity: is_enabled: true` in the manifest. The reference manifest has `is_enabled: false`.
   - What's unclear: Whether reaction_added alone suffices for Phase 2 approvals, or whether Block Kit buttons are needed now.
   - Recommendation: Enable interactivity in the manifest (no cost). Implement Block Kit button handlers only if needed by Phase 2 requirements. Since Phase 2 is "communication channel only" and director intelligence is Phase 3, reactions may suffice. Defer Block Kit action handlers to Phase 3.

2. **Database file location**
   - What we know: `opencode-db.ts` uses `~/.local/share/opencode/opencode.db`. Thread state needs its own database.
   - What's unclear: Whether to co-locate with the scheduler data or use a separate path.
   - Recommendation: Store at `{repoDir}/.youji/threads.db` — keeps thread state with the repository, survives scheduler reinstalls, and aligns with the "repo is the brain" principle. Create the directory if it doesn't exist.

3. **Living message in Phase 2 scope**
   - What we know: User decided to use living messages for long tasks. Reference implementation provides the pattern.
   - What's unclear: Whether living messages belong in Phase 2 (communication channel) or Phase 3 (director intelligence).
   - Recommendation: Phase 2 should include the living message infrastructure (create/update/finalize) since it's a Slack-layer concern. Phase 3 hooks into it when spawning workers. Stub the update triggers in Phase 2.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `infra/scheduler/vitest.config.ts` |
| Quick run command | `cd infra/scheduler && npx vitest run --testPathPattern slack\|thread` |
| Full suite command | `cd infra/scheduler && npx vitest run` |

### Phase Requirements Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SLACK-01 | Socket Mode connection with correct tokens | unit (mock Bolt App) | `npx vitest run src/slack.test.ts -t "connects via Socket Mode"` | Wave 0 |
| SLACK-02 | Thread messages route to same convKey | unit | `npx vitest run src/slack.test.ts -t "routes thread messages"` | Wave 0 |
| SLACK-03 | New threads create new contexts | unit | `npx vitest run src/slack.test.ts -t "creates new context"` | Wave 0 |
| SLACK-04 | State survives reconnection (SQLite persistence) | integration | `npx vitest run src/thread-store.test.ts -t "persists across"` | Wave 0 |
| SLACK-05 | Per-thread mutex serializes concurrent messages | unit | `npx vitest run src/thread-mutex.test.ts -t "serializes"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd infra/scheduler && npx vitest run --testPathPattern slack\|thread`
- **Per wave merge:** `cd infra/scheduler && npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/slack.test.ts` — covers SLACK-01, SLACK-02, SLACK-03 (event routing, thread key derivation)
- [ ] `src/thread-store.test.ts` — covers SLACK-04 (SQLite CRUD, persistence, last-20 query)
- [ ] `src/thread-mutex.test.ts` — covers SLACK-05 (serialization, no deadlock, cleanup)
- [ ] `@slack/bolt` added to dependencies: `npm install @slack/bolt`

## Sources

### Primary (HIGH confidence)
- Context7 `/websites/slack_dev_tools_bolt-js` — Socket Mode initialization, `app.message()`, `app.event()`, error handling patterns
- Context7 `/wiselibs/better-sqlite3` — WAL mode, prepared statements, table creation, synchronous API
- `infra/scheduler/reference-implementations/slack/slack.ts` — Production-tested Slack bot wiring (1600+ lines)
- `infra/scheduler/reference-implementations/slack/chat/chat.ts` — ConversationLock mutex, conversation state management
- `infra/scheduler/reference-implementations/slack/living-message.ts` — Living message create/update/finalize with rate limiting
- `infra/scheduler/reference-implementations/slack/slack-app-manifest.yaml` — App manifest with Socket Mode config
- `infra/scheduler/src/opencode-db.ts` — better-sqlite3 usage patterns in the existing codebase
- `infra/scheduler/src/sdk.ts` — Claude Agent SDK wrapper (`runQuery`, `runQuerySupervised`)

### Secondary (MEDIUM confidence)
- `infra/scheduler/reference-implementations/slack/chat/thread-turns.ts` — Thread turn counting (simpler than needed for Phase 2)

### Tertiary (LOW confidence)
- None — all findings verified against primary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified in Context7 and already used in reference implementation
- Architecture: HIGH — patterns directly adapted from production reference implementation
- Pitfalls: HIGH — documented from real issues visible in reference code comments (e.g., double-fire diagnosis comment at line 515)

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (stable stack, no fast-moving dependencies)
