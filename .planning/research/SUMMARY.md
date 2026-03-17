# Project Research Summary

**Project:** Open-Youji
**Domain:** Autonomous agent orchestration (research institute runtime)
**Researched:** 2026-03-17
**Confidence:** HIGH

## Executive Summary

Open-Youji is a director-worker agent orchestration system where a persistent "director" agent (Youji) communicates with a human mentor via Slack and dispatches ephemeral worker agents to execute tasks in isolated git worktrees. The system is built on top of the Claude Agent SDK (local CLI, not API), meaning the real resource constraint is wall-clock compute time on the mentor's machine, not API token costs. The existing `infra/scheduler/` codebase provides roughly 60-70% of the needed infrastructure -- agent spawning, push queue, session management, metrics, and a reference Slack implementation all exist and are battle-tested across 1400+ fleet sessions.

The recommended approach is to extend the existing scheduler rather than build from scratch. Only one new dependency is needed (`@slack/bolt@^4.1.0`); everything else reuses existing libraries (`better-sqlite3`, `croner`, `vitest`) or built-in git capabilities (worktrees). The director should be **event-driven, not a persistent LLM session** -- each Slack message or cron trigger invokes a fresh Claude session with context loaded from the repo and Slack thread history. This avoids session timeout issues and aligns with the "repo is memory" philosophy that the existing system has proven effective.

The critical risks are: (1) git merge conflicts at scale -- solved architecturally by the existing push queue, but worktree lifecycle management is entirely new code; (2) resource contention on a single machine -- Youji's operational history shows N<=4 concurrent workers is the safe threshold, not the theoretical N=32; (3) Claude SDK session resume behavior for long-lived director conversations is unvalidated and needs a fallback strategy. The anti-features list is equally important: do NOT build a web dashboard, inter-agent messaging, plugin architecture, or agent memory beyond git. These are scope traps that would consume months without advancing the core value proposition.

## Key Findings

### Recommended Stack

The stack is almost entirely drawn from existing dependencies. The only new addition is `@slack/bolt` for the Slack interface.

**Core technologies:**
- **`@slack/bolt` v4.x (Socket Mode):** Slack interface -- official framework, avoids needing a public HTTP endpoint, reference implementation already exists
- **`better-sqlite3` (existing):** Session persistence and time-series logging -- synchronous, already proven in the codebase
- **`git worktree` CLI:** Worker isolation -- native git feature, no library needed, called via `child_process.execFile()`
- **Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`):** Agent spawning -- existing `spawnAgent()` with custom `cwd` for worktree isolation
- **Existing push queue (`push-queue.ts`, `rebase-push.ts`):** Git push serialization -- solved the conflict problem at scale (ADR 0061)
- **Existing budget system (`budget.yaml`, `budget-gate.ts`):** Resource accounting -- adapt from USD to compute-minutes

### Expected Features

**Must have (table stakes):**
- Agent session spawning via Claude SDK (exists)
- Cron-based scheduler (exists)
- Git-as-memory with conventions (exists)
- Task system with lifecycle tags (exists)
- Git worktree isolation for parallel workers (NEW)
- Serialized push queue (exists)
- Slack interface for human-director communication (NEW, reference exists)
- Session timeout and resource guards (exists)
- Approval gates (exists)
- Session logging and metrics (exists)

**Should have (differentiating):**
- Director-worker hierarchy with task decomposition (partially exists as Opus supervisor)
- Skill-typed task routing (schema exists, routing logic needed)
- Proactive director reporting via Slack (stubs exist)
- Time-based resource accounting (metrics exist, gate needs refactoring)
- Convention and schema enforcement L0-L3 (fully exists)
- Autonomous work cycle SOP (fully exists)

**Defer (v2+):**
- Self-evolution (safe self-modification is high complexity, high risk)
- Experiment framework integration (exists but not critical for initial Open-Youji release)
- Knowledge-optimized metrics / findings-per-dollar tracking (needs director maturity first)
- SDK Agent Teams for worker spawning (Path A -- wait for cwd isolation validation)

**Anti-features (never build):**
- Web dashboard, inter-agent messaging, guaranteed-utilization workstreams, complex agent roles, multi-user access control, custom LLM routing, real-time streaming to mentor, plugin architecture, automatic conflict resolution, agent memory beyond git

### Architecture Approach

Four components with clear boundaries: Slack Bridge (event ingestion), Director (decision-making), Worker Pool (task execution in worktrees), and Scheduler (infrastructure host). The director is event-driven -- invoked per Slack message or cron trigger, not a persistent session. Workers are ephemeral `spawnAgent()` calls with `cwd` set to isolated worktrees. All coordination flows through git (shared state) and the scheduler (infrastructure). Workers never communicate directly with each other or with Slack.

**Major components:**
1. **Slack Bridge** -- Socket Mode WebSocket connection, routes messages to director, posts responses to threads
2. **Youji Director** -- Claude session invoked per-event, reads repo state, decomposes tasks, spawns workers, reports to mentor
3. **Worker Pool** -- N concurrent Claude sessions, each in an isolated git worktree, executing single tasks
4. **Scheduler** -- Runtime host, worktree lifecycle, push queue, capacity management, control API (port 8420)

### Critical Pitfalls

1. **Merge conflicts at scale** -- Push serialization via the existing push queue is mandatory from day one. Retry-with-backoff does NOT work (proven by Youji: 7% -> 36.3% conflict rate). Per-project concurrency limit of K=4.
2. **Zombie workers and orphan processes** -- Hard timeout per session (15 min workers, 60 min director). Orphan cleanup at scheduler startup. Each Claude Code process uses 270-370MB RAM; at N>4 workers, resource exhaustion is likely.
3. **Slack WebSocket disconnects losing state** -- Conversation state must be stored externally (SQLite or repo), not in-memory. Use Slack's `conversations.replies` API to rebuild thread context on reconnect.
4. **Concurrent message handling races** -- Per-conversation mutex with generation counter. Without this, interleaved async operations corrupt state (Youji ADR 0008).
5. **Task double-pickup** -- Server-side atomic task claiming in the scheduler, not in the worker agent. Workers never choose their own tasks.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation and Scaffolding
**Rationale:** Everything depends on being able to spawn agents in worktrees and talk to Slack. These are the two new capabilities; everything else is reuse.
**Delivers:** Project structure, build tooling, ability to `spawnAgent()` from the new package, worktree manager with allocate/cleanup/merge-back.
**Addresses:** Features 1.1, 1.5 (worktree isolation), 1.6 (push queue integration)
**Avoids:** Pitfall 1.3 (stale worktrees) by designing cleanup into the lifecycle from the start

### Phase 2: Slack Bridge and Basic Director
**Rationale:** The Slack bridge can be built in parallel with worktree work (no dependency), but the director needs both worktrees and Slack to be useful. This phase delivers the first user-visible functionality: talking to Youji in Slack.
**Delivers:** Slack Socket Mode connection, message routing, director invocation with thread context, basic conversation capability.
**Addresses:** Features 1.7 (Slack interface), 1.9 (approval gate notifications)
**Avoids:** Pitfalls 3.1 (WebSocket disconnects), 3.2 (thread context), 3.3 (concurrent message races)

### Phase 3: Worker Orchestration
**Rationale:** With worktrees and Slack working, add the ability for the director to spawn and monitor workers. This is the core value proposition.
**Delivers:** Worker spawning from director, worker pool management, merge-back flow, task claiming, worker result reporting to Slack.
**Addresses:** Features 2.1 (director-worker hierarchy), 1.4 (task system), 1.8 (session guards)
**Avoids:** Pitfalls 4.1 (zombie workers), 4.3 (double-pickup), 4.4 (graceful shutdown), 6.1 (CPU/memory exhaustion -- start with N=2)

### Phase 4: Autonomous Operation
**Rationale:** Once the human-triggered flow works (mentor asks Youji to do something, Youji spawns workers), add cron-triggered autonomous operation where Youji wakes up, surveys state, and acts independently.
**Delivers:** Cron-triggered director sessions, proactive Slack reporting, time-based resource accounting, budget enforcement.
**Addresses:** Features 1.2 (scheduler integration), 2.6 (proactive reporting), 2.10 (time-based accounting), 2.8 (autonomous work cycle)
**Avoids:** Pitfalls 5.1 (resource accounting), 5.2 (sleep-polling), 5.3 (budget races)

### Phase 5: Production Hardening and Differentiation
**Rationale:** With the system running autonomously, harden it and add differentiating features that require operational maturity.
**Delivers:** Skill-typed task routing, convention enforcement, error recovery, observability, decision record integration.
**Addresses:** Features 2.2, 2.3, 2.4, 2.5
**Avoids:** Pitfall 1.4 (agents blind to each other) via file-level tracking

### Phase Ordering Rationale

- **Worktrees before workers:** Workers need worktree isolation to function safely. Building the worktree manager first (Phase 1) means worker orchestration (Phase 3) can focus on the coordination logic, not filesystem mechanics.
- **Slack before director intelligence:** A working Slack bridge (Phase 2) enables manual testing of the director by talking to it directly. This provides fast feedback before investing in autonomous operation.
- **Human-triggered before autonomous:** Getting the "mentor asks, Youji acts" flow working first (Phases 2-3) validates the core architecture. Adding cron triggers (Phase 4) is incremental once the execution pipeline is proven.
- **Phase 1 and Phase 2 can run in parallel:** Worktree manager and Slack bridge have no dependency on each other. This is the main opportunity for parallel development.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Slack Bridge):** Claude SDK `resume` behavior for long-lived conversations needs validation. The fallback (inject thread history into prompt) is well-understood, but the primary path (session resume across hours/days) is MEDIUM confidence (70%).
- **Phase 3 (Worker Orchestration):** Optimal concurrency limits on the target machine need empirical testing. Start with N=2 and measure. Also, Agent Teams `cwd` isolation needs testing to determine if Path A (SDK subagents) is viable or if Path B (scheduler-managed workers) is the permanent approach.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** Git worktrees are well-documented. The existing codebase provides clear patterns for `spawnAgent()`, push queue, and session management. Implementation is straightforward extraction and adaptation.
- **Phase 4 (Autonomous Operation):** The existing scheduler already does this. The work is primarily wiring the new director/worker architecture into the existing cron infrastructure.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Nearly all dependencies already exist in the codebase. Only `@slack/bolt` is new, and it has a working reference implementation. |
| Features | HIGH | Feature list is grounded in 67 ADRs and 1400+ operational sessions. Table stakes are proven; anti-features are backed by concrete failure stories. |
| Architecture | HIGH | Component boundaries are clear and validated by the existing system. The event-driven director pattern is the safer choice over persistent sessions. |
| Pitfalls | HIGH | Sourced from real operational incidents with specific ADR references. Concurrency limits (N<=4), push queue necessity, and orphan cleanup are empirically validated. |

**Overall confidence:** HIGH

### Gaps to Address

- **Claude SDK `resume` for multi-day conversations:** MEDIUM confidence (70%). Validate during Phase 2 with a simple test: create a session, wait 24 hours, attempt resume. If it fails, the fallback (thread history injection) is ready.
- **Agent Teams `cwd` isolation:** MEDIUM confidence (70%). Validate during Phase 3. If SDK subagents cannot operate in different directories, Path B (scheduler-managed workers) is the permanent approach -- no architectural rework needed.
- **Optimal concurrent worker count on target hardware:** Unknown until measured. Start with N=2, measure RAM/CPU usage, increase cautiously. Youji's N<=4 threshold is a guide, not a guarantee for different hardware.
- **Slack Socket Mode reliability for always-on operation:** The reference implementation has been used for chat but not as a mission-critical always-on director interface. Monitor reconnection frequency in Phase 2.

## Sources

### Primary (HIGH confidence)
- Existing youji codebase (`infra/scheduler/`) -- 90+ modules, 67 ADRs, 1400+ fleet sessions
- Claude Agent SDK source (`agent.ts`, `sdk.ts`, `team-session.ts`) -- direct code inspection
- Youji ADRs 0042-v2, 0055, 0056, 0061 -- fleet architecture, branch management, push serialization

### Secondary (MEDIUM confidence)
- Slack `@slack/bolt` documentation and Socket Mode guide
- ComposioHQ agent-orchestrator, Codex App, ccswarm -- worktree patterns for parallel agents
- Youji reference Slack implementation (`reference-implementations/slack/`)
- Allen Chan (2026), Arman Kamran (2025) -- multi-agent anti-pattern analyses

### Tertiary (LOW confidence)
- Claude SDK `resume` option behavior for long-lived sessions -- needs empirical validation
- Agent Teams `cwd` isolation behavior -- needs empirical validation

---
*Research completed: 2026-03-17*
*Ready for roadmap: yes*
