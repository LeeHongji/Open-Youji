# Project Research Summary

**Project:** Youji — Slack Bot + Claude CLI Migration
**Domain:** Autonomous AI research agent with Slack interface and self-evolution capability
**Researched:** 2026-03-15
**Confidence:** HIGH

## Executive Summary

Youji is a migration project, not a greenfield build. The existing `infra/scheduler/` TypeScript daemon already implements the cron-based execution loop, budget gate, push queue, and a comprehensive Slack reference implementation. The core change is replacing a multi-backend fallback chain (Claude SDK, Cursor, opencode) with a single `claude` CLI subprocess backend, and promoting the reference Slack integration from `reference-implementations/` to production. The migration is subtractive (delete three backends and the Agent SDK dependency) plus additive (wire the Slack bot into the daemon startup). The architecture is already sound; the implementation is already partially done.

The recommended approach follows the existing code's own patterns: `spawn("claude", ["-p", "--output-format", "stream-json", ...])` replaces `sdk.ts`, identical to how `OpenCodeBackend` and `CursorBackend` already work. The Slack layer from `reference-implementations/slack/` (700+ lines) ports to `src/` with minimal rewrites — the component boundaries, Block Kit patterns, living message state machine, and action tag system are production-ready. The `@slack/bolt` v4 + Socket Mode combination is confirmed correct for a local Mac deployment that cannot expose a public HTTP endpoint.

The key risks are cost (each Claude CLI subprocess re-injects 50K+ tokens of context per session, creating a 5-10x budget burn multiplier if turn limits are not enforced), message reliability (Slack Socket Mode drops events silently during reconnection, requiring an emoji-acknowledgment heartbeat pattern), and self-evolution safety (direct code modification must be blocked in favor of PR-only evolution to prevent the scheduler from bricking itself). All three risks have documented mitigations available in the codebase or via known patterns — they are implementation discipline problems, not architectural unknowns.

## Key Findings

### Recommended Stack

The stack is already largely correct in the existing codebase. The single mandatory addition is `@slack/bolt@^4.6.0` (promoted from reference to production dependency). The single mandatory removal is `@anthropic-ai/claude-agent-sdk` (adds 12s overhead per call, introduces a dependency on npm package resolving a CLI binary path, and wraps the exact same `spawn` pattern the codebase already implements for Cursor and opencode). All other dependencies — `better-sqlite3`, `croner`, `chartjs-node-canvas`, `vitest`, TypeScript — stay as-is.

**Core technologies:**
- `@slack/bolt` v4.6.0: Slack event routing, Socket Mode WebSocket connection, slash commands, Block Kit message posting — Socket Mode is critical for local Mac (no public URL required)
- `claude` CLI via `node:child_process.spawn`: Sole execution engine for all agent sessions — provides native MCP, skill invocation, CLAUDE.md loading, and full tool access that raw Anthropic API cannot match
- PM2 v5.x: Daemon lifecycle management on macOS — abstracts launchd, handles log rotation and auto-restart with `--max-restarts` / `--min-uptime` crash-loop detection
- `better-sqlite3` + `croner`: Existing session tracking and cron scheduling — extend schema to distinguish Slack-triggered vs. scheduled sessions, no framework changes needed

**Remove:** `@anthropic-ai/claude-agent-sdk` and the `sdk.ts` wrapper. Claude CLI spawned directly is simpler, faster, and matches the codebase's existing `OpenCodeBackend` pattern.

### Expected Features

All research is grounded in the existing codebase and PROJECT.md — confidence is uniformly HIGH.

**Must have (table stakes) — Phase 1 core loop:**
- Slack message intake via Bolt Socket Mode (T1) — no intake means no interaction
- On-demand session trigger from Slack (T8) — the core "assign a task" UX
- Summary + thread response pattern (T2) — prevents Slack noise; mentor expects clean channel
- Scheduled autonomous sessions with Claude CLI backend (T3) — core to autonomous identity
- Git commit on every session (T6) — repo is the permanent memory; Slack is ephemeral
- Budget gate enforcement (T5) — silent cost spiraling is unacceptable
- Graceful session timeout (T10) — runaway sessions burn budget and block the scheduler
- Error reporting to Slack (T7) — mentor must know when sessions fail

**Should have (differentiators) — Phase 2 research value:**
- Paper analysis workflow (D2) + deep topic dives (D3) — core research partner value
- Skill invocation from Slack (D10) — direct access to 26-skill library, low complexity
- Budget dashboard in Slack (D12) — already has `budget-status.py`; format as blocks
- Living message real-time progress (D5) — reference impl is complete; wire to CLI output
- Approval queue Slack notifications (D7) — APPROVAL_QUEUE.md exists; needs Slack UX
- Multi-session research continuity (D11) — already how the system works; make it visible

**Polish and autonomy — Phase 3:**
- PR-based self-evolution (D1) — highest value differentiator but highest risk; last for safety
- Experiment submission + async notification (D4) — experiment runner exists; needs Slack hook
- Action tag confirmation (D6) — reference impl complete; port as-is

**Defer indefinitely:**
- Session watching (D9): High complexity, niche debugging use case
- Slack command interface (D8): Natural language via T8 covers most cases
- Any multi-user, cloud deployment, web dashboard, real-time log streaming (anti-features A1-A10)

### Architecture Approach

The architecture is a single in-process Node.js daemon: Slack bot (Socket Mode) and scheduler (cron poller + executor) run together under PM2. There is no separate Slack service, no IPC, no API layer. Slack-triggered tasks are ephemeral Job objects executed immediately via `spawnDeepWork` — they do not touch the persistent jobs.json. Scheduled tasks remain cron-based and persistent. All agent sessions, regardless of trigger source, flow through a single `ClaudeCLIBackend` class implementing the existing `AgentBackend` interface. This replaces the current four-backend fallback chain.

**Major components:**
1. **Slack Bot** (`src/slack.ts` + `src/chat/`) — Socket Mode event handler, Block Kit message formatting, thread management, approval UX; communicates in-process with scheduler state
2. **Scheduler Daemon** (`src/executor.ts`, `src/agent.ts`) — cron job lifecycle, session execution, metrics recording; single source of truth for session state
3. **Claude CLI Backend** (`src/backend.ts`, new `ClaudeCLIBackend`) — spawns `claude -p --output-format stream-json`, parses NDJSON events, enforces timeouts; replaces all four current backends
4. **Task Router** — merges cron-triggered and Slack-triggered jobs into unified execution flow with budget gate pre-check
5. **Push Queue + Verify** (`src/push-queue.ts`, `src/verify.ts`) — serialized rebase-push with post-session quality check; unchanged from current

**Key patterns:** Single backend, single binary (Pattern 1). In-process Slack + Scheduler, no microservice split (Pattern 2). Event-driven ephemeral jobs for Slack requests, not persistent queue (Pattern 3). Thread-based context inheritance for multi-turn conversations (Pattern 4).

### Critical Pitfalls

1. **Token cost explosion from naive CLI spawning** — each subprocess re-injects 50K+ tokens of context; 30-turn session = 1.5M+ context tokens alone. Mitigation: enforce `--max-turns` on every spawn (already done in `AGENT_PROFILES`), use `--print` (single-turn) for chat responses, tier model selection (Haiku/Sonnet for chat, Opus for deep work). Address in Phase 1.

2. **Slack Socket Mode silent message loss** — WebSocket drops do not replay missed events (bolt-js issues #1151, #1906, #2426, #2496). Mitigation: react to every mentor message with emoji immediately on receipt; add 15-minute health heartbeat post; log all events locally. Address in Phase 2 (build into initial Slack handler, not as an afterthought).

3. **Self-evolution bricking the scheduler** — scheduler modifying its own code can enter a pm2 restart loop if the new build has a runtime-only failure. Mitigation: enforce PR-only evolution strictly (no direct push of scheduler code), configure pm2 `--max-restarts 3 --min-uptime 60s`, add canary startup check. Address in Phase 3 (last feature, highest risk).

4. **Claude CLI subprocess death leaving dirty git state** — OOM kills, macOS sleep, SIGKILL leave uncommitted changes and stale lock files. Mitigation: pre-session cleanup check for dirty state, session lock file with PID+timestamp, `caffeinate -i` on long sessions, post-session cleanup routine. Address in Phase 1.

5. **Slack message length truncation** — research output routinely exceeds 40K char limit; structured data breaks mid-message. Mitigation: summary in channel (under 2000 chars) + full results as Slack file upload in thread; store full results in repo and link from Slack. Address in Phase 2 before building message handlers.

## Implications for Roadmap

Based on combined research, 4 phases are recommended. The phase ordering follows strict dependency chains: execution engine must precede Slack integration; cleanup should follow validation; Slack must be stable before self-evolution is introduced.

### Phase 1: Claude CLI Backend Foundation

**Rationale:** Everything downstream depends on the execution engine. Replacing the Agent SDK with direct CLI spawning is the load-bearing change. The existing `AgentBackend` interface means this is a drop-in swap — all downstream code (executor, event-agents, scheduler) continues to work unchanged. This phase can be validated entirely without Slack.

**Delivers:** A working scheduler that runs Claude CLI sessions via cron. All table-stakes execution features (T3, T5, T6, T10). Existing scheduled jobs run on the new backend.

**Addresses:** T3 (scheduled sessions), T5 (budget gate), T6 (git commit), T10 (graceful timeout)

**Avoids:**
- Pitfall 1: Token cost explosion — set `--max-turns` and session profiles from day one
- Pitfall 4: Subprocess death + dirty state — build pre/post-session cleanup and lock files into initial implementation
- Pitfall 6 (moderate): Env var leakage — whitelist child process env, strip `CLAUDECODE=1`

**Research flag:** Standard patterns. Direct CLI spawning is documented in Claude Code headless docs and already implemented in `OpenCodeBackend`. No additional research needed.

### Phase 2: Backend Cleanup

**Rationale:** After Phase 1 validates the new backend, remove all dead code. Mechanical deletion (Agent SDK, Cursor, opencode backends, sdk.ts, opencode-db.ts, fallback logic). Low risk if tests pass. This phase pays down technical debt before the Slack integration adds complexity.

**Delivers:** Clean `backend.ts` with only `ClaudeCLIBackend`. Passing test suite. Removed `@anthropic-ai/claude-agent-sdk` npm dependency. Reduced build size and maintenance surface.

**Addresses:** Architecture simplification (Pattern 1: single backend, single binary)

**Research flag:** No research needed. Pure deletion of well-understood code.

### Phase 3: Slack Bot Integration

**Rationale:** The reference implementation is comprehensive and production-tested. This phase is primarily wiring (move files, update imports, connect to CLI backend, wire into `cli.ts` startup). Message reliability (Pitfall 2) and truncation (Pitfall 5) must be designed in from the start, not retrofitted.

**Delivers:** Full Slack interaction loop — mentor sends DM/message, Youji spawns Claude CLI session, results appear in channel summary + thread. All table-stakes Slack features (T1, T2, T7, T8, T4). Living message progress (D5). On-demand skill invocation (D10). Budget dashboard (D12). Approval queue notifications (D7).

**Addresses:** T1, T2, T4, T7, T8, D5, D7, D10, D11, D12

**Avoids:**
- Pitfall 2: Socket Mode message loss — emoji acknowledgment and health heartbeat built into initial handler
- Pitfall 5: Message truncation — summary + file upload pattern designed before building handlers
- Pitfall 8 (moderate): Rate limiting — batch thread replies, 1.5s delay between posts
- Pitfall 10 (moderate): Intent misinterpretation — task confirmation step, thread context injection
- Pitfall 13 (minor): Session resource contention — priority preemption for mentor-triggered tasks

**Research flag:** Low research need. Reference implementation covers the Slack patterns. Bolt v4 Socket Mode is well-documented. The one area needing care is Socket Mode reliability — review bolt-js issues #1151/#2496 for the exact reconnection behavior before writing the heartbeat logic.

### Phase 4: Polish and Self-Evolution

**Rationale:** These are quality-of-life and autonomy features. The system is fully functional after Phase 3. Self-evolution (D1) is intentionally last — it is the highest-risk feature and must not be introduced until the execution and Slack layers are stable and trusted. A buggy self-evolution system on an unstable base is a bricking risk.

**Delivers:** PR-based self-evolution (D1), experiment async notifications (D4), action tag confirmation (D6). Full autonomous operation with human oversight via Slack.

**Addresses:** D1, D4, D6

**Avoids:**
- Pitfall 3: Scheduler bricking — PR-only evolution, pm2 crash-loop configuration, canary startup check
- Pitfall 9 (moderate): PR merge conflicts — small focused PRs, auto-rebase, merge windows

**Research flag:** Self-evolution (D1) warrants a focused research pass during Phase 4 planning. The existing `evolution.ts` CONCERNS.md flags specific failure modes. Review those before designing the PR creation workflow. The `gh` CLI PR creation pattern is standard and does not need research.

### Phase Ordering Rationale

- Phase 1 before Phase 3: You cannot wire Slack to a backend that does not exist yet
- Phase 2 before Phase 3: Removing dead backends before adding Slack complexity prevents confusion about which backend is executing
- Phase 4 last: Self-evolution modifies the scheduler code. If the Slack integration has bugs in Phase 3, a self-evolution that modifies the scheduler could mask those bugs or introduce new ones in the same pass
- Phases 1-2 together are fast (estimated 1-2 days): The pattern is already implemented in OpenCodeBackend; this is a port with a different binary name and flag set

### Research Flags

Needs focused research during planning:
- **Phase 4 (self-evolution):** Review `evolution.ts` CONCERNS.md flags, pm2 crash-loop configuration (`--max-restarts`, `--min-uptime`), and canary startup patterns before designing the PR workflow

Standard patterns (skip research-phase):
- **Phase 1 (Claude CLI backend):** Headless mode is documented in Claude Code docs; the spawn pattern is already in `OpenCodeBackend`
- **Phase 2 (cleanup):** Pure deletion, no new patterns
- **Phase 3 (Slack bot):** Reference implementation is comprehensive; Bolt v4 Socket Mode is well-documented

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All recommendations verified against official docs and existing codebase. No speculative choices. |
| Features | HIGH | Grounded entirely in existing codebase analysis + PROJECT.md requirements. No market research needed — the mentor is the sole user. |
| Architecture | HIGH | Existing codebase analysis of 66 ADRs + first-party reference implementation. Architecture is already decided and documented. |
| Pitfalls | HIGH | Critical pitfalls have GitHub issue citations (bolt-js #1151, claude-code #13126, claude-agent-sdk-python #573) and community reports with data. |

**Overall confidence:** HIGH

### Gaps to Address

- **Claude CLI `--output-format stream-json` exact event types:** The architecture research cites the Cursor/opencode CLI NDJSON convention as analogous, but the exact field names for Claude CLI's stream-json output should be verified with a test spawn before writing the parser. Run `claude -p "hello" --output-format stream-json` and capture a sample output before implementing the parser.
- **Slack Socket Mode reconnection window duration:** The 60-second figure cited in PITFALLS.md is from community reports, not official Slack documentation. Verify the actual reconnection window and event replay behavior in the bolt-js docs before designing the heartbeat acknowledgment pattern.
- **pm2 crash-loop configuration for self-evolution:** The `--max-restarts` and `--min-uptime` values in PITFALLS.md are suggested, not verified against pm2 v5 docs. Confirm correct flag syntax during Phase 4 planning.

## Sources

### Primary (HIGH confidence)

- Existing codebase: `infra/scheduler/src/backend.ts`, `executor.ts`, `event-agents.ts`, `agent.ts`, `sdk.ts` — architecture and backend patterns
- Reference implementation: `infra/scheduler/reference-implementations/slack/` — Slack integration patterns
- Project definition: `.planning/PROJECT.md` — requirements and constraints
- Architecture decisions: `decisions/` (66 ADRs) — documented rationale
- Claude Code headless mode docs: https://code.claude.com/docs/en/headless — `--output-format stream-json`, `-p` flag
- Slack Bolt.js docs: https://docs.slack.dev/tools/bolt-js/ — Socket Mode, events, commands
- @slack/bolt npm: https://www.npmjs.com/package/@slack/bolt — v4.6.0 confirmed

### Secondary (MEDIUM confidence)

- [Claude CLI subprocess token burn](https://dev.to/jungjaehoon/why-claude-code-subagents-waste-50k-tokens-per-turn-and-how-to-fix-it-41ma) — 50K token overhead per turn (practitioner report with data)
- [Autonomous multi-agent conflict reality](https://dev.to/aviad_rozenhek_cba37e0660/the-reality-of-autonomous-multi-agent-development-266a) — git conflict and concurrency patterns
- [Self-modifying AI risks](https://www.isaca.org/resources/news-and-trends/isaca-now-blog/2025/unseen-unchecked-unraveling-inside-the-risky-code-of-self-modifying-ai) — self-evolution safety analysis

### Tertiary (GitHub issues — HIGH for cited issues)

- bolt-js #1151, #1906, #2426, #2496 — Socket Mode WebSocket reliability
- anthropics/claude-code #13126 — macOS OOM kill of Claude Code processes
- anthropics/claude-agent-sdk-python #573 — CLAUDECODE=1 env inheritance bug

---
*Research completed: 2026-03-15*
*Ready for roadmap: yes*
