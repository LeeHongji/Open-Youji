# Open-Youji Feature Research

**Date:** 2026-03-17
**Purpose:** Catalog features for an autonomous research institute runtime, classified by necessity, differentiation, and anti-patterns.

**Research sources:** Existing youji codebase (67 ADRs, 90+ scheduler modules, fleet architecture at ADR 0042-v2), Anthropic Claude Agent SDK and Agent Teams documentation, ComposioHQ agent-orchestrator, Ruflo/Claude Flow, Superset IDE, ccswarm, Codex App worktree patterns, industry anti-pattern analyses (Allen Chan, Arman Kamran, MorelandConnect), guardrails literature (Authority Partners, Galileo Agent Control, Permit.io HumanLayer), and Slack agentic workflow documentation.

---

## 1. Table Stakes Features

These are non-negotiable for the system to function at all. Without any one of them, Open-Youji cannot operate as an autonomous research institute.

### 1.1 Agent Session Spawning via Claude Agent SDK

**What:** Spawn headless Claude Code sessions programmatically using `@anthropic-ai/claude-agent-sdk`. Each session gets a prompt, model selection, working directory, and permission configuration.

**Why table stakes:** This is the execution primitive. Without it, nothing runs.

**Complexity:** Low — the SDK provides `query()` and supervised mode out of the box. The existing `agent.ts` and `sdk.ts` already wrap this.

**Dependencies:** Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), local Claude Code CLI installation, active Claude subscription (no API key billing).

**Existing implementation:** `infra/scheduler/src/agent.ts`, `infra/scheduler/src/sdk.ts`

---

### 1.2 Cron-Based Scheduler

**What:** A daemon process that triggers agent sessions on a configurable schedule (cron expressions or fixed intervals). Polls for due jobs, enforces concurrency limits, and tracks job state (next run, last run, error count).

**Why table stakes:** Autonomy requires the system to act without human initiation. Without a scheduler, someone must manually start every session.

**Complexity:** Low-Medium — cron parsing, polling loop, job state persistence. The hard part is reliability (surviving restarts, handling missed jobs).

**Dependencies:** `croner` for cron parsing, filesystem for job state persistence (`jobs.json`).

**Existing implementation:** `infra/scheduler/src/service.ts`, `infra/scheduler/src/schedule.ts`, `infra/scheduler/src/store.ts`

---

### 1.3 Git-as-Memory (Repo-Centric State)

**What:** All persistent state lives in git-committed plain text files (Markdown, YAML, JSON). No external database. The repository IS the agents' shared brain — every fact, decision, plan, and finding is a committed file.

**Why table stakes:** LLM agents have zero memory between sessions. Without a structured persistence layer, every session starts from scratch. Git provides versioning, audit trail, conflict detection, and distribution for free.

**Complexity:** Low for basic usage — agents read/write files, git tracks changes. Medium for enforcing discipline (schemas, conventions, provenance requirements).

**Dependencies:** Git, a convention system that agents follow (CLAUDE.md, schemas, SOPs).

**Existing implementation:** `CLAUDE.md`, `docs/design.md`, `docs/schemas/`, `docs/conventions/`

---

### 1.4 Task System with Lifecycle Tags

**What:** A Markdown-based task management system where tasks live in `TASKS.md` files per project. Tasks have structured metadata: priority, done-when conditions, lifecycle tags (`[in-progress]`, `[blocked-by]`, `[fleet-eligible]`, `[requires-opus]`, skill types).

**Why table stakes:** Without a task system, agents cannot coordinate what to work on, what is done, and what is blocked. Duplicate work and conflicting efforts are guaranteed.

**Complexity:** Medium — the task format is simple, but the parser, claim system, and tag semantics add up. The existing `task-parser.ts` is ~300 lines.

**Dependencies:** Task claiming API (to prevent double-pickup in concurrent scenarios), convention enforcement for tag usage.

**Existing implementation:** `infra/scheduler/src/task-parser.ts`, CLAUDE.md task lifecycle section, `docs/schemas/task.md`

---

### 1.5 Git Worktree Isolation for Parallel Workers

**What:** Each worker agent operates in its own git worktree — a separate working directory checked out from the same repository. Workers can read/write files concurrently without filesystem-level conflicts.

**Why table stakes:** If two agents edit the same file in the same working directory, one overwrites the other. Worktrees provide filesystem isolation while sharing the git object store. This is the standard pattern for parallel AI coding agents (used by Codex App, Superset IDE, ComposioHQ agent-orchestrator, ccswarm).

**Complexity:** Medium — creating/destroying worktrees is straightforward (`git worktree add/remove`), but managing the lifecycle (cleanup on crash, branch naming, worktree limits) requires care. Merging worktree branches back to main is where complexity lives.

**Dependencies:** Git worktree support (built into git), branch naming convention, merge/rebase strategy.

**Existing implementation:** The current youji system does NOT use worktrees — it uses a single working directory with rebase-before-push (ADR 0042-v2). This is a new capability for Open-Youji.

---

### 1.6 Serialized Push Queue

**What:** Workers commit locally but do not push directly. Push requests are enqueued to a central coordinator that executes them sequentially, handling rebase, conflict detection, and retry with backoff.

**Why table stakes:** Concurrent `git push` from multiple workers causes non-fast-forward errors, merge conflicts, and repository corruption. Even with worktrees providing filesystem isolation, the push to remote must be serialized.

**Complexity:** Medium — queue data structure, conflict detection, retry logic, fallback branch creation. The existing implementation is ~200 lines.

**Dependencies:** Git worktree isolation (upstream), HTTP API for enqueue/status endpoints.

**Existing implementation:** `infra/scheduler/src/push-queue.ts`, `infra/scheduler/src/rebase-push.ts`, ADR 0061

---

### 1.7 Slack Interface for Human-Director Communication

**What:** The Youji director agent communicates with the human mentor exclusively via Slack. Threads map to conversation contexts. The mentor sends questions and instructions; Youji reports progress, asks for approvals, and surfaces blockers.

**Why table stakes:** The core interaction model is "human talks to Youji, Youji manages workers." Without a communication channel, the human cannot steer or observe the system. Slack is specified as the sole human interface.

**Complexity:** Medium-High — Slack API integration (Bot tokens, event subscriptions, thread management), message formatting, thread-to-session mapping, handling Slack's rate limits and webhook delivery guarantees.

**Dependencies:** Slack Bot token, Slack App configuration, event subscription endpoint (or Socket Mode for local development).

**Existing implementation:** `infra/scheduler/reference-implementations/slack/` exists as a starting point. The main `slack.ts` in the scheduler is a no-op stub.

---

### 1.8 Session Timeout and Resource Guards

**What:** Every agent session has a maximum duration. Sessions that exceed the limit are forcibly terminated. Additional guards prevent sleep loops, stalled shell commands, and runaway token consumption.

**Why table stakes:** Without timeouts, a single stuck session blocks the entire system indefinitely. A runaway agent can consume unbounded compute time (and with Claude subscription, monopolize the user's Claude Code access).

**Complexity:** Low-Medium — timer-based kill, plus post-session verification of sleep/stall violations.

**Dependencies:** Agent spawning mechanism (to send interrupt signals), metrics recording.

**Existing implementation:** `maxDurationMs` in `JobPayload`, `infra/scheduler/src/sleep-guard.ts`, `infra/scheduler/src/stall-guard.ts`

---

### 1.9 Approval Gates

**What:** Certain actions require human approval before proceeding: budget increases, governance changes, production deployments, tool access requests. Agents write requests to `APPROVAL_QUEUE.md` and either block (session-blocking) or continue (non-blocking) depending on severity.

**Why table stakes:** Fully autonomous agents with no approval mechanism will eventually make an expensive or irreversible mistake. Approval gates are the minimal safety boundary between "autonomous" and "uncontrolled."

**Complexity:** Low-Medium — the queue is a Markdown file; the enforcement is a convention that agents follow plus L0 code checks for the most critical gates.

**Dependencies:** Slack integration (to notify the mentor of pending approvals), convention system (to define what requires approval).

**Existing implementation:** `APPROVAL_QUEUE.md`, CLAUDE.md approval gates section, `infra/scheduler/src/notify.ts`

---

### 1.10 Session Logging and Metrics

**What:** Every session produces structured metrics (duration, cost, turn count, success/failure, model usage, tool invocations) and unstructured logs (agent output). Metrics are append-only JSONL; logs are per-session text files.

**Why table stakes:** Without observability, you cannot tell if the system is working, degrading, or broken. Metrics are the feedback loop for every other feature.

**Complexity:** Low — append to a file after each session. The complexity is in what to measure, not how.

**Dependencies:** Session spawning (upstream), filesystem.

**Existing implementation:** `.scheduler/metrics/sessions.jsonl`, `.scheduler/logs/`, `infra/scheduler/src/metrics.ts`

---

## 2. Differentiating Features

These provide competitive advantage over raw Claude Code sessions, other agent orchestration frameworks, or manual research workflows. They are what make Open-Youji an "autonomous research institute" rather than just "a script that runs Claude Code on a timer."

### 2.1 Director-Worker Hierarchy

**What:** A persistent director agent (Youji) acts as the institute's leader — she understands the full research program, decomposes goals into tasks, dispatches work to ephemeral worker agents, audits their output, and reports to the human mentor. Workers are headless executors that receive a specific task and return results.

**Why differentiating:** Most multi-agent frameworks (CrewAI, AutoGen, LangGraph) use peer-to-peer or flat hierarchies. Claude Agent Teams uses a "team lead" but it is ephemeral (per-session). Youji's director is persistent across sessions, accumulating context via the git repo. This mirrors how real research labs work: a PI directs postdocs and grad students.

**Complexity:** High — the director needs to maintain strategic context across sessions, decompose goals into well-scoped tasks, route tasks to appropriate workers, handle escalations, and synthesize findings. This is the core intellectual challenge of Open-Youji.

**Dependencies:** All table stakes features (scheduler, task system, git-as-memory, Slack interface, worktrees).

**Existing implementation:** Partially — the existing "Opus supervisor" in ADR 0042-v2 is a proto-director, but it lacks Slack-based interaction and persistent session context.

---

### 2.2 Skill-Typed Task Routing

**What:** Tasks are tagged with skill types (`[skill: record]`, `[skill: execute]`, `[skill: diagnose]`, `[skill: analyze]`, etc.) that determine which worker role handles them. Knowledge tasks go to cheap/fast workers; reasoning tasks go to capable workers; implementation tasks go to the best available coding model.

**Why differentiating:** Most orchestrators route by agent identity (fixed agents with fixed roles). Open-Youji routes by task characteristic — any worker can handle any task type, but the scheduler optimizes model selection and prompt construction per skill type. This is more flexible and cost-efficient.

**Complexity:** Medium — requires a task classifier (currently tag-based, could evolve to heuristic), prompt templates per skill type, and model routing logic.

**Dependencies:** Task system (1.4), worker spawning (1.1), model configuration.

**Existing implementation:** ADR 0062 skill-typed organization, `SkillType` and `WorkerRole` types in `types.ts`, prompt templates in fleet scheduler.

---

### 2.3 Convention and Schema Enforcement (L0-L3)

**What:** A four-layer enforcement system ensures agents produce consistent, high-quality output:
- **L0 (Code-enforced):** Budget gates, sleep guards, file size limits — agents cannot bypass these.
- **L1 (Schema):** Structured templates for logs, tasks, experiments, decisions — agents follow these formats.
- **L2 (Convention):** Behavioral rules in CLAUDE.md — agents self-enforce these (with post-session verification).
- **L3 (Skill):** On-demand judgment procedures — agents invoke these for complex analytical tasks.

**Why differentiating:** Most agent frameworks have no convention system at all — agents produce whatever output format they want. Open-Youji's layered enforcement produces a coherent, navigable knowledge base that improves with every session, rather than a pile of unstructured files.

**Complexity:** Medium — individual checks are simple, but the system of conventions is large (CLAUDE.md alone is ~500 lines). The real complexity is in maintaining conventions as the system evolves.

**Dependencies:** Post-session verification (`verify.ts`), CLAUDE.md, skills system.

**Existing implementation:** Fully built — `infra/scheduler/src/verify.ts`, `docs/conventions/`, `docs/schemas/`, `.claude/skills/`

---

### 2.4 Knowledge-Optimized Metrics (Findings per Dollar)

**What:** The primary efficiency metric is not "tasks completed" or "sessions run" but "knowledge produced per unit of resource consumed." Metrics track: new experiment findings, decision records, literature notes, diagnoses, and postmortems per session. Operational health (error rates, uptime) is a supporting indicator.

**Why differentiating:** Every other orchestration framework optimizes for throughput (tasks/hour) or utilization (% of compute used). Open-Youji optimizes for the actual output of a research institute: knowledge. This changes incentives — idle capacity is preferred over low-value busywork, because noise in the repo degrades every future session.

**Complexity:** Medium — defining and measuring "knowledge output" is subjective. The existing system uses heuristics (did the session produce a finding? a decision? a new experiment?).

**Dependencies:** Session metrics (1.10), post-session verification.

**Existing implementation:** `KnowledgeMetrics` in `metrics.ts`, the "Idle Capacity Principle" from ADR 0042-v2.

---

### 2.5 Decision Records as Consistency Anchors

**What:** Significant design choices are recorded as numbered ADRs (Architectural Decision Records) in `decisions/`. Once recorded, a decision is the default until explicitly superseded. Agents are instructed not to re-litigate recorded decisions.

**Why differentiating:** Stateless agents independently making incompatible choices is the #1 cause of knowledge fragmentation in multi-agent systems. Decision records prevent this by creating a canonical record that all agents reference. This is the "agentic" equivalent of institutional knowledge.

**Complexity:** Low — writing a Markdown file is trivial. The value comes from the convention that agents respect decisions, which is enforced socially (via CLAUDE.md) and structurally (decisions are loaded into agent context).

**Dependencies:** Convention system, agent prompt construction.

**Existing implementation:** 67 decision records in `decisions/`, CLAUDE.md decision conventions, `docs/conventions/decisions.md`

---

### 2.6 Proactive Director Reporting

**What:** Youji does not wait to be asked — she periodically wakes up, surveys project status, and reports to the mentor via Slack. Reports include: progress since last report, blockers requiring human input, pending approvals, budget status, and recommended next priorities.

**Why differentiating:** Most agent systems are reactive (you ask, they answer). A director that proactively surfaces information mirrors how a good research manager operates — the PI does not have to ask "what's the status?" every day.

**Complexity:** Medium — requires synthesizing project state from multiple files (README logs, TASKS.md, APPROVAL_QUEUE.md, budget.yaml), formatting for Slack, and deciding what is worth reporting vs. noise.

**Dependencies:** Scheduler (cron-triggered), Slack integration, git-as-memory (reading project state).

**Existing implementation:** The existing scheduler has a "heartbeat" mode and Slack notification stubs, but no synthesized reporting.

---

### 2.7 Self-Evolution

**What:** The system can modify its own infrastructure code, rebuild itself, and restart with the new version — all autonomously. The scheduler detects changes to `infra/scheduler/src/`, runs `npm run build`, drains active sessions, and restarts via pm2.

**Why differentiating:** Most agent frameworks are static — they run the code they were deployed with. Open-Youji can improve its own scheduler, add new skills, evolve conventions, and fix its own bugs. This is a key ingredient for a truly autonomous system.

**Complexity:** High — safe self-modification requires: build verification, drain/restart orchestration, rollback on failure, and governance gates (agents cannot modify governance rules without approval).

**Dependencies:** Build system (TypeScript compilation), process manager (pm2), approval gates for governance changes.

**Existing implementation:** `infra/scheduler/src/evolution.ts`, ADR 0031 (proactive self-evolution).

---

### 2.8 Autonomous Work Cycle SOP

**What:** Every agent session follows a structured 6-step standard operating procedure: Orient (assess state) -> Select Task -> Classify Scope -> Execute -> Compound (synthesize learnings) -> Commit and Close. This ensures consistent behavior across sessions regardless of which agent or model runs them.

**Why differentiating:** Raw Claude Code sessions are open-ended — the agent does whatever the prompt says. The SOP transforms a general-purpose LLM into a disciplined research worker that always knows what to do first, what to do last, and how to hand off to the next session.

**Complexity:** Medium — the SOP itself is a Markdown file, but encoding it into agent behavior requires careful prompt engineering and post-session verification.

**Dependencies:** Skills system (skills like `/orient`, `/compound`), convention system, task system.

**Existing implementation:** `docs/sops/autonomous-work-cycle.md`, skills in `.claude/skills/`

---

### 2.9 Experiment Framework

**What:** A structured system for running, tracking, and analyzing experiments. Experiments have a standard directory structure, EXPERIMENT.md with frontmatter (status, hypothesis, method, findings), fire-and-forget submission via the experiment runner, and incremental analysis at defined checkpoints (25%, 50%, 75%, 100%).

**Why differentiating:** This is what makes Open-Youji a research institute rather than a task runner. The experiment framework encodes the scientific method into the agent workflow — hypothesize, test, record, analyze, iterate.

**Complexity:** Medium — experiment setup and tracking are straightforward; the hard parts are provenance (ensuring findings are traceable to data) and analysis throttling (preventing agents from over-analyzing incomplete experiments).

**Dependencies:** Task system, git-as-memory, experiment runner (`infra/experiment-runner/`).

**Existing implementation:** `docs/schemas/experiment.md`, `infra/experiment-runner/run.py`, ADR 0023 (incremental analysis throttling), ADR 0027 (resource safeguards).

---

### 2.10 Time-Based Resource Accounting

**What:** Replace API-cost-based budget tracking with wall-clock time budgets. Since all execution uses the Claude Code subscription (no per-token billing), the real scarce resource is compute time — how long the user's machine (or a dedicated machine) is occupied running agents.

**Why differentiating:** This is specific to the Claude SDK-only execution model. Other frameworks track token costs; Open-Youji tracks the actual constrained resource. This enables more honest capacity planning ("how many hours of agent compute do we allocate to this project this week?").

**Complexity:** Low-Medium — time tracking is trivial; budget enforcement with time-based gates requires defining what "budget exhausted" means (total session-hours per project per period).

**Dependencies:** Session metrics (duration tracking already exists), budget gate refactoring.

**Existing implementation:** Partially — duration tracking exists in `ExecutionResult.durationMs` and `FleetWorkerResult.durationMs`. Budget gates currently track API cost, not time.

---

## 3. Anti-Features

Things to deliberately NOT build. Each entry explains why building this would be a mistake.

### 3.1 DO NOT: Build a Web Dashboard

**Why not:** Slack is the sole human interface by design. A dashboard creates a second source of truth, requires frontend maintenance, introduces authentication/authorization complexity, and splits the mentor's attention. The mentor should talk to Youji in Slack, not stare at graphs.

**What to do instead:** Youji summarizes system status in Slack messages. If the mentor wants details, they ask Youji, who reads the metrics and reports back. For developer debugging, the CLI (`node dist/cli.js status`) suffices.

**Risk of building it:** Maintenance burden, feature drift (dashboard gets features Slack does not), security surface area.

---

### 3.2 DO NOT: Build Inter-Agent Messaging

**Why not:** Workers do not need to talk to each other. Each worker gets a self-contained task, executes it, and exits. If work requires coordination between workers, the director (Youji) handles it — she decomposes the work so workers are independent. Direct worker-to-worker communication creates hidden state, race conditions, and debugging nightmares.

**What to do instead:** Coordination happens through the repo (shared files) and through the director (task decomposition and sequencing). A worker that discovers something relevant to another project writes it to a file; a future session picks it up.

**Risk of building it:** Emergent complexity — agents talking to agents creates conversation chains that are hard to observe, debug, or interrupt. The industry anti-pattern literature (Allen Chan 2026, Arman Kamran 2025) identifies "unstructured agent-to-agent chatter" as a top cause of multi-agent system failures.

---

### 3.3 DO NOT: Build Guaranteed-Utilization Workstreams

**Why not:** ADR 0042-v2 explicitly rejected this approach from V1. Guaranteed-infinite workstreams (arxiv scanning, documentation padding, code exploration) optimize for GPU utilization, not knowledge output. Low-value work has negative expected value because every file written taxes future sessions' context windows. The repo is the agents' memory — noise is cognitive pollution.

**What to do instead:** Follow the Idle Capacity Principle — when genuine tasks run out, agents drain to idle. This is correct behavior. The director creates new tasks when research directions warrant it.

**Risk of building it:** Knowledge base degradation. 500 unread literature notes per day makes it harder, not easier, for agents to find relevant information. Utilization metrics look good while actual research velocity declines.

---

### 3.4 DO NOT: Build Complex Agent Role Systems

**Why not:** Agents are ephemeral and fungible. Assigning persistent identities, specializations, or "personalities" to workers adds complexity without value. A worker does not need to be "Agent Sarah, the documentation specialist" — it needs a prompt, a task, and a working directory.

**What to do instead:** Route by task skill type, not by agent identity. The scheduler selects the right model and prompt template for the task. Workers are interchangeable.

**Risk of building it:** Brittleness — a "specialist" agent fails, and its domain has no coverage until someone reconfigures the system. Anthropomorphization leads to design decisions that serve the metaphor rather than the architecture.

---

### 3.5 DO NOT: Build Multi-User Access Control

**Why not:** Open-Youji has one mentor. Youji is the single point of contact. Adding user management, role-based access, team permissions, and audit logging for multiple humans is enterprise middleware that does not serve the core use case.

**What to do instead:** The mentor authenticates via Slack (Slack handles auth). Youji trusts the mentor. If the system ever needs multi-user support, it should be a separate layer on top, not baked into the core.

**Risk of building it:** Scope explosion. Auth systems attract feature requests (SSO, OAuth, audit logs, permission matrices) that are infinite in scope and zero in research value.

---

### 3.6 DO NOT: Build a Custom LLM Routing/Inference Layer

**Why not:** Open-Youji uses Claude Agent SDK exclusively — no API calls, no model routing between providers, no token-level billing optimization. Building a routing layer (like LiteLLM, or a custom gateway) adds complexity for a feature the system does not need.

**What to do instead:** Use the Claude Agent SDK's model parameter to select models. If future models become available through Claude Code, they are automatically accessible.

**Risk of building it:** Premature abstraction. The SDK handles model selection; wrapping it in another abstraction layer creates two places to configure the same thing.

---

### 3.7 DO NOT: Build Real-Time Agent Streaming to the Mentor

**Why not:** The mentor does not need to watch agents type in real-time. Streaming agent output to Slack creates noise, consumes Slack API rate limits, and encourages micromanagement. The mentor's time is the most scarce resource — do not waste it watching agents work.

**What to do instead:** Youji reports results, not process. When a worker finishes, Youji summarizes what happened. If the mentor wants to see raw output, they can read the session logs. Streaming is available for developer debugging via the control API, not for production mentor interaction.

**Risk of building it:** Attention drain on the mentor. The whole point of autonomy is that the mentor does NOT need to watch.

---

### 3.8 DO NOT: Build Plugin/Extension Architecture

**Why not:** Extensibility sounds good in theory but creates maintenance burden, versioning headaches, and security risks. Open-Youji's extension mechanism is the repo itself — add a skill, add a convention, add an SOP. These are plain text files that agents read, not code modules that must be loaded, versioned, and sandboxed.

**What to do instead:** Skills (`.claude/skills/`) are the extension point. They are Markdown files with structured procedures. Adding a new capability means writing a new skill file, not building a plugin system.

**Risk of building it:** Second-system effect. Plugin architectures are where simple systems go to die.

---

### 3.9 DO NOT: Build Automatic Conflict Resolution

**Why not:** Git merge conflicts between workers should be resolved by the push queue's rebase strategy or, when rebase fails, by creating a fallback branch for manual (or director-initiated) resolution. Attempting to automatically resolve semantic merge conflicts (where two agents changed the same logic in incompatible ways) requires understanding intent, which is a research-hard problem.

**What to do instead:** Prevent conflicts through good task decomposition (workers operate on disjoint files). When conflicts occur, the push queue detects them, creates a fallback branch, and the director resolves them in a subsequent session.

**Risk of building it:** Silent data corruption. An automatic resolver that merges incorrectly produces a repo state that looks clean but contains logical inconsistencies — the worst failure mode for a system where "the repo is the brain."

---

### 3.10 DO NOT: Build Agent Memory Beyond Git

**Why not:** External memory systems (vector databases, knowledge graphs, embedding stores) add infrastructure complexity and create state that is not version-controlled, not auditable, and not human-readable. The git repo already provides persistent, versioned, diffable, greppable memory.

**What to do instead:** If an agent needs to recall something, it reads a file. If the file does not exist, the information was not recorded (and that is a process problem, not a tooling problem). The convention system ensures agents record important findings in the same turn they discover them.

**Risk of building it:** Split-brain state. Information in the vector DB but not in git (or vice versa) creates confusion. Embeddings go stale when the source files change. The debugging surface area doubles.

---

## Summary Matrix

| # | Feature | Category | Complexity | Key Dependency |
|---|---------|----------|------------|----------------|
| 1.1 | Agent session spawning | Table stakes | Low | Claude Agent SDK |
| 1.2 | Cron-based scheduler | Table stakes | Low-Med | croner, filesystem |
| 1.3 | Git-as-memory | Table stakes | Low-Med | Git, conventions |
| 1.4 | Task system | Table stakes | Medium | Task parser, claim API |
| 1.5 | Git worktree isolation | Table stakes | Medium | Git worktree, branch strategy |
| 1.6 | Serialized push queue | Table stakes | Medium | Git, HTTP API |
| 1.7 | Slack interface | Table stakes | Med-High | Slack API, Bot token |
| 1.8 | Session timeouts/guards | Table stakes | Low-Med | Agent spawning |
| 1.9 | Approval gates | Table stakes | Low-Med | Slack, conventions |
| 1.10 | Session logging/metrics | Table stakes | Low | Filesystem |
| 2.1 | Director-worker hierarchy | Differentiating | High | All table stakes |
| 2.2 | Skill-typed task routing | Differentiating | Medium | Task system, models |
| 2.3 | L0-L3 enforcement | Differentiating | Medium | verify.ts, conventions |
| 2.4 | Knowledge-optimized metrics | Differentiating | Medium | Session metrics |
| 2.5 | Decision records | Differentiating | Low | Convention system |
| 2.6 | Proactive director reporting | Differentiating | Medium | Scheduler, Slack |
| 2.7 | Self-evolution | Differentiating | High | Build system, pm2 |
| 2.8 | Autonomous work cycle SOP | Differentiating | Medium | Skills, conventions |
| 2.9 | Experiment framework | Differentiating | Medium | Task system, runner |
| 2.10 | Time-based resource accounting | Differentiating | Low-Med | Metrics refactoring |
| 3.1 | Web dashboard | Anti-feature | -- | -- |
| 3.2 | Inter-agent messaging | Anti-feature | -- | -- |
| 3.3 | Guaranteed-utilization workstreams | Anti-feature | -- | -- |
| 3.4 | Complex agent role systems | Anti-feature | -- | -- |
| 3.5 | Multi-user access control | Anti-feature | -- | -- |
| 3.6 | Custom LLM routing layer | Anti-feature | -- | -- |
| 3.7 | Real-time streaming to mentor | Anti-feature | -- | -- |
| 3.8 | Plugin/extension architecture | Anti-feature | -- | -- |
| 3.9 | Automatic conflict resolution | Anti-feature | -- | -- |
| 3.10 | Agent memory beyond git | Anti-feature | -- | -- |

## Implementation Priority

**Phase 0 — Minimal Viable Director (table stakes only):**
1.1 Agent spawning, 1.2 Scheduler, 1.3 Git-as-memory, 1.4 Task system, 1.7 Slack interface, 1.8 Session guards, 1.10 Logging/metrics

**Phase 1 — Parallel Workers:**
1.5 Git worktree isolation, 1.6 Push queue, 1.9 Approval gates

**Phase 2 — Research Institute:**
2.1 Director-worker hierarchy, 2.6 Proactive reporting, 2.8 Autonomous work cycle SOP, 2.10 Time-based accounting

**Phase 3 — Differentiation:**
2.2 Skill-typed routing, 2.3 L0-L3 enforcement, 2.4 Knowledge metrics, 2.5 Decision records, 2.9 Experiment framework

**Phase 4 — Self-Improvement:**
2.7 Self-evolution

---

*Research completed: 2026-03-17*
