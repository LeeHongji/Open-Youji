# Domain Pitfalls

**Domain:** Autonomous AI research agent with Slack interface, CLI process spawning, and self-evolution
**Researched:** 2026-03-15
**Overall confidence:** HIGH (based on existing codebase analysis, documented issues, and verified community reports)

## Critical Pitfalls

Mistakes that cause rewrites or major issues.

### Pitfall 1: Claude CLI subprocess token burn on repeated spawning

**What goes wrong:** Each Claude CLI subprocess re-injects the full system prompt (CLAUDE.md, skills, rules) on every turn. A single subprocess turn can consume ~50K tokens before doing any work. When spawning N sessions per day with M turns each, the cost multiplier is N*M times that overhead. This was documented in community reports and confirmed by the existing codebase's `AGENT_PROFILES` turn limits.
**Why it happens:** Claude Code's `--print` mode and interactive mode both load the full project context. There is no "lightweight" mode that skips context injection. The `claude` CLI is designed for developer sessions, not as a high-frequency subprocess API.
**Consequences:** Budget exhaustion 5-10x faster than expected. A 30-turn Slack-triggered session could burn 1.5M+ tokens in context alone, before any actual work output.
**Prevention:**
- Set strict `--max-turns` on every spawned session (the existing codebase already does this via `AGENT_PROFILES` — preserve this pattern)
- Use `--print` mode for simple query-response tasks (single turn, no context accumulation)
- Reserve full interactive sessions for deep work; use `--print` with `--output-format json` for quick Slack responses
- Monitor per-session token usage and alert when a session exceeds budget thresholds
- Consider a tiered model strategy: Haiku/Sonnet for chat responses, Opus only for deep research (existing `SLACK_CHAT_MODEL` env var already supports this)
**Detection:** Token cost per session exceeding 2x the expected baseline. Slack response latency >60s for simple queries.
**Phase:** Address in Phase 1 (Claude CLI integration). This is a day-one architectural decision.

### Pitfall 2: Slack Socket Mode connection drops losing messages silently

**What goes wrong:** Slack Socket Mode WebSocket connections drop without warning — documented in bolt-js issues #1151, #1906, #2426, #2496. During the reconnection gap (up to 60 seconds), Slack does NOT replay missed events. Any mentor message sent during that window is silently lost. The existing codebase already uses Socket Mode (`socketMode: true` in `slack.ts`).
**Why it happens:** WebSocket connections are inherently unreliable. Slack's Socket Mode has no delivery guarantee — it is fire-and-forget for events. The bolt-js library's reconnection logic has known race conditions.
**Consequences:** Mentor sends a task, Youji never receives it, mentor assumes Youji is working on it. Trust erosion. For a single-user system where the mentor is the only input source, a missed message is a missed task.
**Prevention:**
- Implement a "heartbeat acknowledgment" pattern: Youji reacts to every mentor message with an emoji (e.g., `:eyes:`) immediately on receipt. If mentor sees no reaction within 10s, they know the message was lost.
- Add a periodic health-check that posts to Slack (e.g., every 15 minutes) so the mentor can see if the bot is alive
- Log all received Slack events to a local file as a secondary record
- Consider HTTP mode for production if reliability becomes a recurring issue (requires an endpoint, but ngrok or Cloudflare Tunnel works on local Mac)
- Monitor WebSocket reconnection events and alert on frequency spikes
**Detection:** Mentor reports missing responses. Gap in the local event log. WebSocket reconnection count >5/hour.
**Phase:** Address in Phase 2 (Slack bot). Build acknowledgment pattern into the initial Slack handler.

### Pitfall 3: Self-evolution breaking the running scheduler (bricking the system)

**What goes wrong:** When Youji modifies her own scheduler code and the change introduces a subtle bug that passes `tsc` and tests but fails at runtime (e.g., a race condition, an import path issue after build, a pm2 restart loop), the system bricks itself. The existing `evolution.ts` has safeguards (tsc check, test run, max retries, cooldown) but the CONCERNS.md already flags: "If `.pending-evolution.json` and `.failed-evolution.json` are both lost, the evolution system has no way to know its last state and will retry indefinitely."
**Why it happens:** Tests cannot catch all runtime failures. The evolution system tests the *old* code's build, then restarts into the *new* code. If the new code crashes on startup (before the evolution state file is read), the system enters a restart loop.
**Consequences:** Youji goes offline. The scheduler cannot start. Manual intervention required. If the mentor is away, Youji is dead until they return.
**Prevention:**
- The PR-based self-evolution model (in PROJECT.md) is the correct architecture — enforce it strictly. Youji proposes changes via PR; mentor merges; scheduler rebuilds from merged code. Never allow direct code modification + restart.
- Add a "canary startup" check: after building new code, start it in a subprocess for 30 seconds to verify it boots successfully before replacing the running instance
- Keep a "last known good" build artifact that pm2 can fall back to on crash-loop detection
- pm2's `--max-restarts` and `--min-uptime` settings should be configured to prevent infinite restart loops (3 restarts in 60 seconds = stop and alert)
- The existing evolution.ts `MAX_ATTEMPTS = 3` and `COOLDOWN_MS` are good — preserve them in the migration
**Detection:** pm2 restart count >3 in 5 minutes. Slack heartbeat stops. Scheduler process exits within 10 seconds of starting.
**Phase:** Address in Phase 3 (self-evolution). This is the highest-risk phase and should be the last major feature.

### Pitfall 4: Claude CLI subprocess death leaving orphan state

**What goes wrong:** When a `claude` CLI process is killed (OOM, timeout, macOS sleep/wake, SIGKILL), it leaves behind: incomplete git changes (staged but uncommitted), lock files, partial JSONL session files, and the spawning process (scheduler) has no way to know the session's final state. The existing codebase already has this problem — CONCERNS.md documents the orphan-cleanup using fragile `pgrep` pattern matching.
**Why it happens:** CLI processes are not transactional. There is no "undo" for a process that was mid-way through writing files when killed. macOS aggressive memory management can OOM-kill Claude Code processes (documented in anthropics/claude-code#13126). Mac sleep suspends processes, and upon wake, timeouts may have expired.
**Consequences:** Repository left in dirty state. Next session sees uncommitted changes and gets confused. Git conflicts. Duplicate work. Potential data corruption in experiment tracking files.
**Prevention:**
- Always spawn `claude` sessions with `--max-turns` to bound execution time
- Implement a pre-session cleanup: before spawning a new session, check for dirty git state and stash/reset if needed
- Use a session lock file that records PID + start time. On next session start, check if the lock is stale (PID dead or start time >max duration ago) and clean up
- Set macOS `caffeinate` when spawning long sessions to prevent sleep-induced kills
- After session exit (regardless of exit code), run a cleanup routine: check git status, check for lock files, log the session outcome
**Detection:** `git status` shows uncommitted changes when no session is active. Stale `.claude` session files. Process exit code non-zero.
**Phase:** Address in Phase 1 (Claude CLI integration). Build cleanup into the session lifecycle from the start.

### Pitfall 5: Slack message length limits truncating research results

**What goes wrong:** Slack messages have a hard 40,000 character limit (and a practical readability limit much lower). Research results, experiment analyses, and log outputs easily exceed this. The existing codebase's "living message" pattern (`living-message.ts`) handles progressive updates but does not address the truncation problem for final results.
**Why it happens:** Agent output is unbounded. A research summary with citations, code snippets, and data tables can easily be 10,000+ characters. Thread replies have the same limit.
**Consequences:** Truncated results lose the most important content (often at the end — conclusions and recommendations). Mentor gets incomplete information. Formatting breaks mid-message creating unreadable output.
**Prevention:**
- Design the Slack response format as: short summary in channel (under 2000 chars), detailed results posted as a Slack file/snippet in thread (no length limit for file uploads)
- Use the existing `slack-files.ts` upload mechanism for long outputs
- Implement a `formatForSlack(result, maxLength)` function that intelligently truncates with a "Full results in thread" link
- For structured data (tables, lists), use Slack Block Kit which handles formatting better than raw text
- Store full results in the repo (as the akari pattern already does) and link to the file in Slack
**Detection:** Slack API returns `msg_too_long` error. Output string length >4000 chars before posting.
**Phase:** Address in Phase 2 (Slack bot). Design the response format before building message handlers.

## Moderate Pitfalls

### Pitfall 6: Environment variable leakage between parent and child processes

**What goes wrong:** The Claude CLI subprocess inherits all environment variables from the parent (scheduler) process. This includes `CLAUDECODE=1` (which prevents nested Claude Code sessions — documented in anthropics/claude-agent-sdk-python#573), proxy settings, API keys, and Slack tokens. A session that reads `SLACK_BOT_TOKEN` from env could theoretically post to Slack directly, bypassing the scheduler's message formatting.
**Prevention:**
- Explicitly construct the child process environment: whitelist only the variables the CLI needs (PATH, HOME, ANTHROPIC_API_KEY or equivalent)
- Strip `CLAUDECODE=1` if spawning `claude` from within a Claude Code context
- Never pass Slack tokens to agent sessions
**Detection:** Agent session logs show Slack API calls. `CLAUDECODE=1` error on subprocess spawn.
**Phase:** Phase 1 (Claude CLI integration).

### Pitfall 7: Git conflicts from concurrent sessions modifying the same files

**What goes wrong:** If two sessions run concurrently (e.g., a scheduled session + a Slack-triggered session), both modify the same file, and the second to push gets a merge conflict. The existing push queue (`infra/scheduler/`) serializes pushes but does not prevent concurrent edits to the same files.
**Prevention:**
- Enforce single-session execution for write operations (the existing scheduler's concurrency model)
- If allowing concurrent sessions, scope them to different project directories
- Use git worktrees for concurrent sessions operating on different branches
- Implement file-level locking for critical shared files (TASKS.md, README.md)
**Detection:** Push queue failures. Git merge conflict errors in session logs.
**Phase:** Phase 1 (Claude CLI integration). Decide the concurrency model before building the Slack trigger path.

### Pitfall 8: Slack rate limiting during result reporting

**What goes wrong:** Slack enforces 1 message per second per channel (and 50 API calls per minute per token). When a session completes and posts a summary + multiple thread replies + file uploads, the burst can hit rate limits. The existing `living-message.ts` updates during long sessions can also accumulate API calls.
**Prevention:**
- Batch thread replies: post one comprehensive thread message instead of multiple small ones
- Add exponential backoff retry logic to all Slack API calls (bolt-js has built-in retry, but verify it's configured)
- Queue outbound messages with a minimum 1.5s delay between posts to the same channel
- Use file uploads for large content (single API call) instead of multiple messages
**Detection:** Slack API returns `429 Too Many Requests`. Messages appear out of order or are missing.
**Phase:** Phase 2 (Slack bot).

### Pitfall 9: PR-based self-evolution creating merge conflicts with in-flight work

**What goes wrong:** Youji creates a PR to modify her own code. Meanwhile, a scheduled session makes other changes to the repo. When the mentor merges the PR, the main branch has diverged. Subsequent sessions may operate on stale code, or the PR may become unmergeable.
**Prevention:**
- Self-evolution PRs should be small and focused (single-concern changes)
- Auto-rebase evolution PRs before presenting to mentor (or flag "needs rebase")
- Self-evolution changes should target only `.claude/` (skills, rules) and `infra/` (scheduler code), never project content
- Implement a "merge window" — evolution PRs are only created when no sessions are active
**Detection:** PR shows merge conflicts. `git pull` fails after PR merge.
**Phase:** Phase 3 (self-evolution).

### Pitfall 10: Mentor intent misinterpretation in Slack messages

**What goes wrong:** Natural language task assignment is ambiguous. "Look into the transformer paper" could mean: read "Attention Is All You Need," survey recent transformer architectures, or investigate a specific paper the mentor discussed yesterday. The agent picks the wrong interpretation, executes for 30 minutes, and delivers irrelevant results.
**Prevention:**
- Implement a "task confirmation" step: Youji restates its understanding of the task before executing. Mentor confirms or corrects. This adds latency but prevents wasted sessions.
- For ambiguous commands, ask a clarifying question in-thread before spawning a session
- Build a context window: include the last N Slack messages in the thread as context for the prompt
- Allow the mentor to provide structured task templates (e.g., `/research paper:... question:...`)
**Detection:** Mentor responds with "that's not what I meant." Task output does not match the implicit intent.
**Phase:** Phase 2 (Slack bot). Design the command parsing and confirmation flow early.

## Minor Pitfalls

### Pitfall 11: macOS-specific process management quirks

**What goes wrong:** macOS handles process signals differently from Linux. `SIGTERM` behavior, process group semantics, and the lack of `/proc` filesystem (already flagged in CONCERNS.md for `validatePidOwnership`) create cross-platform inconsistencies. Since Youji runs on a local Mac exclusively, Linux-only patterns will silently fail.
**Prevention:**
- Use macOS-native process management: `ps -o pid,ppid,uid` instead of `/proc`
- Test all process lifecycle code on macOS specifically
- Use `caffeinate -i` to prevent idle sleep during long sessions
**Phase:** Phase 1.

### Pitfall 12: Slack thread context accumulation for long conversations

**What goes wrong:** Multi-turn Slack conversations (mentor asks follow-up questions in a thread) accumulate context. Each follow-up spawns a new Claude CLI session that needs the full thread history. Thread history retrieval via Slack API + injection into CLI prompt can exceed Claude's context window for long threads.
**Prevention:**
- Limit thread history to last N messages (the existing `thread-turns.ts` has turn limits — preserve this)
- Summarize earlier messages rather than including them verbatim
- Set a hard cap on thread length and suggest starting a new thread
**Phase:** Phase 2.

### Pitfall 13: Scheduled sessions and Slack-triggered sessions competing for resources

**What goes wrong:** A scheduled autonomous session is running when the mentor sends a Slack task. The Slack task is either queued (delayed response, mentor frustrated) or runs concurrently (resource contention, git conflicts).
**Prevention:**
- Implement priority preemption: Slack-triggered tasks from the mentor preempt scheduled sessions (or queue with a clear ETA response to Slack)
- Show the mentor what's currently running when they send a task ("I'm currently working on X, expected to finish in ~10 min. Should I stop and switch to your task?")
**Phase:** Phase 2.

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Phase 1: Claude CLI integration | Token cost explosion from naive spawning (#1) | Tier session types, set --max-turns, use --print for simple tasks |
| Phase 1: Claude CLI integration | Subprocess death leaving dirty state (#4) | Pre/post session cleanup, session lock files, caffeinate |
| Phase 1: Claude CLI integration | Env var leakage to child processes (#6) | Whitelist env vars, strip CLAUDECODE=1 |
| Phase 2: Slack bot | Socket Mode message loss (#2) | Emoji acknowledgment, health heartbeat, event logging |
| Phase 2: Slack bot | Message truncation (#5) | Summary + file upload pattern, Block Kit |
| Phase 2: Slack bot | Rate limiting during bursts (#8) | Batch messages, backoff retry, 1.5s delay |
| Phase 2: Slack bot | Ambiguous task interpretation (#10) | Confirmation step, clarifying questions |
| Phase 2: Slack bot | Session resource contention (#13) | Priority preemption, status reporting |
| Phase 3: Self-evolution | Bricking the scheduler (#3) | PR-only model, canary startup, pm2 crash-loop detection |
| Phase 3: Self-evolution | PR merge conflicts (#9) | Small PRs, auto-rebase, merge windows |

## Sources

- Existing codebase: `infra/scheduler/src/agent.ts`, `evolution.ts`, `reference-implementations/slack/slack.ts`
- Existing concerns analysis: `.planning/codebase/CONCERNS.md`
- [Claude CLI subprocess token burn (community report)](https://dev.to/jungjaehoon/why-claude-code-subagents-waste-50k-tokens-per-turn-and-how-to-fix-it-41ma) — HIGH confidence (documented with data)
- [Claude CLI subprocess death issue](https://github.com/zed-industries/claude-agent-acp/issues/338) — HIGH confidence (GitHub issue with reproduction)
- [Claude Code OOM kill issue](https://github.com/anthropics/claude-code/issues/13126) — HIGH confidence (GitHub issue)
- [CLAUDECODE=1 env inheritance bug](https://github.com/anthropics/claude-agent-sdk-python/issues/573) — HIGH confidence (GitHub issue)
- [Slack Socket Mode unreliability](https://github.com/slackapi/bolt-js/issues/1151) — HIGH confidence (multiple corroborating issues: #1906, #2426, #2496)
- [Slack Socket Mode pong timeout](https://github.com/slackapi/bolt-js/issues/2496) — HIGH confidence
- [Claude Code non-interactive best practices](https://code.claude.com/docs/en/best-practices) — HIGH confidence (official docs)
- [Autonomous multi-agent conflict reality](https://dev.to/aviad_rozenhek_cba37e0660/the-reality-of-autonomous-multi-agent-development-266a) — MEDIUM confidence (practitioner report)
- [Self-modifying AI risks (ISACA)](https://www.isaca.org/resources/news-and-trends/isaca-now-blog/2025/unseen-unchecked-unraveling-inside-the-risky-code-of-self-modifying-ai) — MEDIUM confidence (industry analysis)
