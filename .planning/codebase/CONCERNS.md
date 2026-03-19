# Codebase Concerns

**Analysis Date:** 2026-03-17

## Tech Debt

**`_scheduleFingerprint` stored as `any` cast on typed `JobState`:**
- Issue: `JobState` in `infra/scheduler/src/types.ts` does not include `_scheduleFingerprint`. The field is written and read via `(job.state as any)._scheduleFingerprint` in three places.
- Files: `infra/scheduler/src/store.ts` (lines 86, 95, 165), `infra/scheduler/src/cli.ts` (line 400)
- Impact: TypeScript's type system cannot guard against typos or refactors that silently break schedule-change detection. The `tierPatch as any` in `cli.ts` has the same root cause — fields added at runtime are not in the schema.
- Fix approach: Extend `JobState` in `types.ts` with optional fields `_scheduleFingerprint?: string`, `lastFullOrientAt?: number | null`, and `lastFullCompoundAt?: number | null`. Remove `as any` casts.

**Non-cryptographic ID generation for job store:**
- Issue: `generateId()` in `infra/scheduler/src/store.ts` uses `Math.random().toString(36).slice(2, 10)` — only ~41 bits of entropy, non-CSPRNG.
- Files: `infra/scheduler/src/store.ts` (line 24–26)
- Impact: Theoretical collision risk if many jobs are created rapidly; `Math.random()` is predictable from output.
- Fix approach: Replace with `randomUUID()` from `node:crypto` (already imported elsewhere in the codebase) or `randomBytes(6).toString('hex')`.

**`verify.ts` is a 2,870-line monolith:**
- Issue: All post-session verification logic — footer validation, ledger checks, provenance checks, L0/L2 enforcement, stall detection, etc. — lives in one file.
- Files: `infra/scheduler/src/verify.ts`
- Impact: High cognitive load for maintainers, long test files (`verify-compliance.test.ts` at 1,516 lines, `verify-knowledge.test.ts` at 900 lines), slow to reason about individual checks.
- Fix approach: Extract each logical check family into its own module (e.g., `verify-footer.ts`, `verify-ledger.ts`, `verify-provenance.ts`). `verify.ts` becomes an orchestrator.

**`cli.ts` is a 1,283-line mixed-concern entry point:**
- Issue: `cli.ts` handles argument parsing, `.env` loading, scheduler service wiring, burst orchestration, heartbeat loops, and evolution checks all in one file.
- Files: `infra/scheduler/src/cli.ts`
- Impact: Hard to test individual behaviors; adding new commands increases the file further.
- Fix approach: Extract command handlers into separate files (e.g., `commands/burst.ts`, `commands/heartbeat.ts`). `cli.ts` becomes a thin dispatcher.

**`event-agents.ts` is a 758-line multi-concern module:**
- Issue: Combines plan-file reading, shared progress handler, autofix agent, Slack-triggered run session, Slack-triggered deep work, and experiment-launch helpers.
- Files: `infra/scheduler/src/event-agents.ts`
- Impact: Functions with unrelated concerns are tightly coupled; mock setup in tests is heavy.
- Fix approach: Split into `event-agents-autofix.ts`, `event-agents-slack.ts`, and `event-agents-shared.ts`.

**Orphaned `autofix-experiment.test.ts` without a matching source file:**
- Issue: `infra/scheduler/src/autofix-experiment.test.ts` (182 lines) tests `autoFixExperiment` imported from `event-agents.js`, but the file is named as if it tests a dedicated `autofix-experiment.ts` module that does not exist. The naming is misleading.
- Files: `infra/scheduler/src/autofix-experiment.test.ts`
- Impact: Future refactors may expect a `autofix-experiment.ts` source file and be confused.
- Fix approach: Rename test file to `event-agents-autofix.test.ts` (matching its import), or extract the function into its own file.

## Known Bugs

**`isProcessOrphaned` uses wrong `spawn` arguments — `/proc` path is split incorrectly:**
- Symptoms: `/proc/<pid>/stat` is accessed as `spawn("cat", ["/proc", pid.toString(), "stat"])` — three arguments treated as separate path components, which `cat` will not join. This would fail to read the stat file on Linux.
- Files: `infra/scheduler/src/orphan-cleanup.ts` (line 73)
- Trigger: Any call to `killOrphanedOpenCodeProcesses()` — triggered at scheduler startup and during orphan cleanup cycles.
- Workaround: The function catches errors and returns `false`, so orphan detection silently fails rather than crashing. Orphaned opencode processes would not be killed.

## Security Considerations

**All agent sessions run with `allowDangerouslySkipPermissions: true`:**
- Risk: The Claude SDK permission bypass is unconditional for every spawned session. If a session produces a malicious prompt injection, it has full filesystem and shell access.
- Files: `infra/scheduler/src/agent.ts` (line 179)
- Current mitigation: L0 sleep guard (blocks `sleep >30s`), L0 pm2 guard (blocks `pm2 stop/delete`), `validateShellCommand` in `security.ts` blocks a blocklist of executables for Slack-triggered commands. These checks only apply to the scheduler-side message interceptor, not inside the agent process.
- Recommendations: Scope permission bypass to documented agent profiles only. Consider enabling `bypassPermissions` only for specific allowed tool sets rather than globally.

**Cursor backend passes `--yolo --trust` flags unconditionally:**
- Risk: `--yolo` and `--trust` disable all Cursor Agent safety confirmations. Any session using the Cursor backend runs without confirmation prompts.
- Files: `infra/scheduler/src/backend.ts` (line 160)
- Current mitigation: Cursor backend is only used when explicitly configured or when Claude is rate-limited and falls back.
- Recommendations: Document this as an intentional operational decision. Consider a comment indicating this is equivalent to `allowDangerouslySkipPermissions` for the Cursor path.

**opencode backend sets `OPENCODE_PERMISSION: '{"*":"allow"}'`:**
- Risk: All tool permissions are pre-approved for every opencode fleet session.
- Files: `infra/scheduler/src/backend.ts` (line 402)
- Current mitigation: Fleet workers use opencode only; they are sandboxed to a specific repo directory via `--dir`. The scheduler-side security module (`security.ts`) guards Slack-triggered commands but not opencode sessions.
- Recommendations: Document explicitly. Consider whether `allowShells: false` equivalent can be enforced at the opencode layer.

**`validatePidOwnership` reads `/proc/<pid>/status` — Linux-only:**
- Risk: On macOS or any non-Linux host, this function silently returns `false` (catches all errors), meaning PID ownership validation is never enforced on developer machines.
- Files: `infra/scheduler/src/security.ts` (line 266–278)
- Current mitigation: The function is only called for Slack-triggered process-management commands. An error causes the validation to fail open (returns false = not verified).
- Recommendations: Add platform detection; on macOS use `ps -p <pid> -o uid=` instead.

**`isProcessOrphaned` also reads `/proc/<pid>/stat` — Linux-only:**
- Risk: Same platform limitation as `validatePidOwnership`. On macOS the orphan cleanup silently does nothing.
- Files: `infra/scheduler/src/orphan-cleanup.ts` (line 72–103)
- Current mitigation: Failure is silent, but orphan cleanup simply does not run.
- Recommendations: Document as Linux-only, or add cross-platform PPID check.

## Performance Bottlenecks

**SQLite database opened and closed on every cost lookup:**
- Problem: `getSessionCostFromDb()` opens a new `better-sqlite3` connection, executes a query, and closes it on every call. This is called from inside the `proc.on("close")` handler at the end of every opencode session.
- Files: `infra/scheduler/src/opencode-db.ts` (line 18–37)
- Cause: No connection pooling or module-level singleton.
- Improvement path: Cache the database connection as a module-level singleton with lazy initialization. Add a `closeDb()` function for graceful shutdown.

**`verify.ts` runs multiple sequential `git diff` invocations:**
- Problem: `verifySession()` calls `git diff --name-only` multiple times (for log entry detection, footer detection, ledger check, etc.) in separate `exec` calls. Each invocation spawns a subprocess.
- Files: `infra/scheduler/src/verify.ts`
- Cause: Each check was added independently without consolidating the git diff call.
- Improvement path: Run `git diff --name-only` once at the top of `verifySession()`, cache the file list, and pass it to all sub-checks.

**Metrics file is scanned from beginning on every read:**
- Problem: `readMetrics()` in `infra/scheduler/src/metrics.ts` reads the entire `sessions.jsonl` file and parses every line on each call. The watchdog, anomaly detection, pattern detection, and report generation all call this independently.
- Files: `infra/scheduler/src/metrics.ts`, `infra/scheduler/src/health-watchdog.ts`, `infra/scheduler/src/patterns.ts`
- Cause: Simple append-only JSONL with full-scan reads; no index or in-memory cache.
- Improvement path: Add an in-memory LRU cache with a configurable TTL (e.g. 60s) to avoid redundant full-file reads within a scheduler tick.

## Fragile Areas

**`parsePendingItems()` uses regex against raw markdown — brittle to formatting changes:**
- Files: `infra/scheduler/src/notify.ts` (lines 41–100)
- Why fragile: The approval queue parser uses `content.match(/## Pending\n([\s\S]*?)(?=\n## Resolved|$)/)` and per-field regexes. A stray blank line, different heading capitalization, or an extra `#` will silently drop items.
- Safe modification: Always test changes with `parsePendingItems.test.ts`. Avoid adding new field names that conflict with existing regex patterns.
- Test coverage: Covered by tests but edge cases (multi-line fields, missing sections) may not be exhaustive.

**`evolution.ts` uses `process.exit(0)` after a successful build:**
- Files: `infra/scheduler/src/cli.ts` (line 434), `infra/scheduler/src/evolution.ts`
- Why fragile: The evolution restart path calls `await service.startDrain()` then `process.exit(0)`. If pm2 does not restart the process (misconfigured ecosystem file), the scheduler silently dies and no sessions run.
- Safe modification: Add a fallback notification or watchdog ping before calling `process.exit`. Ensure pm2 ecosystem file is always present.
- Test coverage: Evolution logic has a test file (`evolution.test.ts`) but the `process.exit` path is not testable in unit tests.

**`rebaseAndPush` creates branch fallbacks silently:**
- Files: `infra/scheduler/src/rebase-push.ts`
- Why fragile: When all rebase retries fail, commits are pushed to a `session-*` branch. If the branch fallback is never merged, knowledge is permanently stranded. The fallback is logged but no alert is sent (Slack is a stub).
- Safe modification: Ensure Slack notifications work before running concurrent sessions that could trigger race conditions.
- Test coverage: `rebase-push.test.ts` exists but integration with actual concurrent pushes is not tested.

**`JobStore` uses in-memory state with a single JSON file — no concurrency safety:**
- Files: `infra/scheduler/src/store.ts`
- Why fragile: Multiple CLI invocations (e.g., running `youji run` while `youji start` is active) can read/write `jobs.json` concurrently. The write path uses an atomic rename (`tmp` → main), but the read path has no locking. Concurrent `updateState` calls during burst sessions may interleave.
- Safe modification: The single-process `maxConcurrentSessions: 1` default prevents most races. Adding concurrency or running multiple CLI processes against the same store increases risk.
- Test coverage: `store.test.ts` tests individual methods but not concurrent access.

## Scaling Limits

**Metrics JSONL grows unboundedly:**
- Current capacity: The file at `.scheduler/metrics/sessions.jsonl` is append-only with no rotation or truncation.
- Limit: Large files increase read latency for every `readMetrics()` call. At high session frequencies (e.g., fleet mode at ~100 sessions/day), the file reaches 1 MB within weeks.
- Scaling path: Add log rotation in `recordMetrics()` (e.g., rotate at 10 MB or 10,000 entries) or switch to a SQLite-backed store.

**Fleet worker task scanner reads all TASKS.md files on every tick:**
- Current capacity: Adequate for tens of projects.
- Limit: Task scanning is O(projects × tasks) per poll cycle. At 100+ projects with dense TASKS.md files, the 30-second poll interval accumulates meaningful I/O.
- Scaling path: Cache the task scan result and invalidate on file modification time change.

## Dependencies at Risk

**`@anthropic-ai/claude-agent-sdk` is pinned to `^0.2.42` — pre-1.0 semver:**
- Risk: The `^0.2.x` range allows minor version bumps that may introduce breaking changes in a pre-1.0 SDK. The SDK's `query()`, `Options`, and `SDKMessage` types are used extensively.
- Impact: A minor version bump could silently break session spawning, message parsing, or cost reporting.
- Migration plan: Monitor SDK changelog closely. Pin to an exact version in production if stability is required (`"@anthropic-ai/claude-agent-sdk": "0.2.42"`).

**`better-sqlite3` requires native compilation:**
- Risk: `better-sqlite3` is a native Node.js addon. It will fail to install in environments without build tools (`python3`, `make`, `g++`) or in Docker images that skip native builds.
- Impact: If the opencode database cost lookup fails, cost tracking silently returns `null` and sessions proceed without accurate cost reporting.
- Migration plan: The `try/catch` in `getSessionTokens()` handles this gracefully. Document the native dependency requirement in `infra/scheduler/README.md`.

## Missing Critical Features

**Slack integration is a stub — all notifications are no-ops:**
- Problem: `infra/scheduler/src/slack.ts` exports a complete interface but every function is a no-op. All Slack DMs, burst notifications, approval alerts, and error notifications are silently dropped.
- Blocks: Operators cannot receive session status updates, approval queue notifications, or cost alerts without wiring up the reference implementation at `infra/scheduler/reference-implementations/slack/`.
- Note: This is intentional by design (youji ships Slack as a reference implementation), but anyone deploying without reading the documentation will have silent operational failures.

**No structured logging — 227 `console.log/error/warn` calls in production code:**
- Problem: All operational output goes to `console.log`. There is no log level control, structured JSON output, or log rotation.
- Blocks: Production diagnostics require grepping raw stdout; no way to filter by severity or module.
- Files: Throughout `infra/scheduler/src/` (all non-test files)
- Fix approach: Introduce a lightweight logger module (e.g., wrapping `console` with level filtering and optional JSON format). Replace `console.log` calls with `log.info/warn/error` progressively.

## Test Coverage Gaps

**`autofix-experiment.test.ts` tests behavior in `event-agents.ts` but file naming implies a separate module:**
- What's not tested: The test file exists but the matching source file does not. If `autoFixExperiment` is ever extracted from `event-agents.ts`, the test import will break silently until build.
- Files: `infra/scheduler/src/autofix-experiment.test.ts`
- Risk: Refactors to `event-agents.ts` that move `autoFixExperiment` may break without immediate test failures.
- Priority: Low

**`orphan-cleanup.ts` has a test file but the `/proc` bug is not caught:**
- What's not tested: The `spawn("cat", ["/proc", pid.toString(), "stat"])` bug — the orphan detection path — is not exercised by `orphan-cleanup.test.ts` against a real `/proc` filesystem.
- Files: `infra/scheduler/src/orphan-cleanup.ts`, `infra/scheduler/src/orphan-cleanup.test.ts`
- Risk: Orphaned processes accumulate silently after scheduler restarts, blocking fleet sessions.
- Priority: High

**`cli.ts` has no test file:**
- What's not tested: The main CLI entry point — argument parsing, burst scheduling, heartbeat loop, evolution trigger, approval burst execution — has no corresponding test file.
- Files: `infra/scheduler/src/cli.ts`
- Risk: CLI argument parsing regressions and multi-step orchestration bugs (e.g., evolution drain race) are caught only in production.
- Priority: Medium

**`evolution.ts` `process.exit(0)` path is not testable:**
- What's not tested: The scheduler drain + restart path after a successful self-evolution build.
- Files: `infra/scheduler/src/evolution.ts`, `infra/scheduler/src/cli.ts`
- Risk: A regression in evolution drain logic would silently kill the scheduler without restart.
- Priority: Medium

---

*Concerns audit: 2026-03-17*
