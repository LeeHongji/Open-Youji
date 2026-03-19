# Architecture

**Analysis Date:** 2026-03-17

## Pattern Overview

**Overall:** Autonomous Research Operations System — a repo-centric agent orchestration architecture where the repository itself serves as the sole persistent memory and cognitive state across stateless LLM agent sessions.

**Key Characteristics:**
- Sessions are stateless; all state lives in git-committed files (Markdown, YAML)
- A cron-based scheduler (`infra/scheduler/`) triggers agent sessions on schedule
- Human interaction is minimal — agents self-direct via the autonomous work cycle SOP
- Governance is enforced at four layers: code (L0), schema (L1), convention (L2), skill (L3)
- Knowledge output (findings/dollar) is the primary efficiency metric, not task throughput

## Layers

**L0 — Code (Computation):**
- Purpose: Deterministic enforcement and automation that cannot be expressed as rules
- Location: `infra/scheduler/src/`, `infra/experiment-runner/`, `infra/budget-verify/`
- Contains: Scheduler daemon, budget gates, post-session verification, push queue, experiment runner
- Depends on: Node.js built-ins, `@anthropic-ai/claude-agent-sdk`, `croner`
- Used by: All agent sessions (triggered externally); CLI users

**L1 — Schema (Structure):**
- Purpose: Structural templates that constrain the shape of documents agents produce
- Location: `docs/schemas/`, `CLAUDE.md` (inline schemas)
- Contains: Log entry schema, task schema, EXPERIMENT.md frontmatter, budget/ledger schemas, decision record schema
- Depends on: Nothing (Markdown conventions)
- Used by: Every agent session that creates or updates a structured document

**L2 — Convention (Rules):**
- Purpose: Unconditional behavioral rules for all agent sessions
- Location: `CLAUDE.md`, `docs/conventions/`
- Contains: Session discipline, task lifecycle tags, approval gate rules, inline logging checklist, provenance requirements
- Depends on: L0 (some conventions are also L0-enforced via `verify.ts`)
- Used by: Every autonomous agent session

**L3 — Skill (Judgment):**
- Purpose: On-demand judgment procedures for specific analytical tasks — encoding reasoning that cannot be reduced to rules
- Location: `.claude/skills/<name>/SKILL.md`
- Contains: 25 skills covering session management, adversarial review, analytical reasoning, research methodology, infrastructure, system evolution, and failure analysis
- Depends on: L0, L1, L2 (skills reference conventions and schemas)
- Used by: Agent sessions that invoke a specific skill (e.g., `/orient`, `/design`, `/critique`)

## Data Flow

**Autonomous Work Cycle (per session):**

1. Scheduler (`service.ts`) detects a due job via 30-second polling loop
2. `executor.ts` pre-processes: auto-commits orphaned files, injects session ID, role, orient/compound tier directives, convention modules
3. `agent.ts` spawns the agent via selected backend (Claude SDK, opencode CLI, or cursor CLI with auto-fallback)
4. Agent runs the 6-step SOP: Orient → Select Task → Classify Scope → Execute → Compound → Commit and Close
5. During execution, agent reads/writes repo files (projects/*, TASKS.md, decisions/, etc.)
6. After session: executor auto-commits orphaned files, enqueues git push via push queue, writes metrics to `.scheduler/metrics/sessions.jsonl`
7. Slack DM sent with session summary and any pending approvals

**Task Selection Flow:**

1. Agent reads `APPROVAL_QUEUE.md` and project `TASKS.md` files
2. Filters by: unblocked, not in-progress, not approval-needed, concrete done-when condition
3. Claims selected task via `POST http://localhost:8420/api/tasks/claim` (prevents double-pickup)
4. Executes task following CLAUDE.md conventions
5. Marks task `[x]` on completion or updates description on partial completion

**Fleet Worker Flow:**

1. Fleet scheduler scans all `projects/*/TASKS.md` for `[fleet-eligible]` tasks
2. Spawns up to `maxWorkers` concurrent workers (default backend: opencode/GLM-5)
3. Each worker runs a stripped-down session (no `/orient`, direct task execution)
4. Workers commit locally, push via serialized push queue at `POST /api/push/enqueue`
5. Skills-tagged tasks route to skill-typed workers: `[skill: record]` → knowledge worker, `[skill: execute]` → implementation worker, `[skill: analyze]` → reasoning worker

**State Management:**
- All persistent state lives in committed git files — no external database
- Job state (schedules, run counts, timestamps) lives in `.scheduler/jobs.json`
- Session metrics live in `.scheduler/metrics/sessions.jsonl`
- Project knowledge state lives in `projects/*/README.md` (log), `projects/*/TASKS.md`, `projects/*/experiments/*/EXPERIMENT.md`
- Global governance state lives in `APPROVAL_QUEUE.md`, `decisions/`

## Key Abstractions

**Job (`types.ts` — `Job` interface):**
- Purpose: A scheduled recurring agent session with configuration and runtime state
- Examples: `infra/scheduler/src/types.ts`
- Pattern: Immutable schedule + mutable state (next/last run, error, count) stored in `jobs.json`

**AgentBackend (`backend.ts` — `AgentBackend` interface):**
- Purpose: Abstraction over three agent execution backends (Claude SDK, opencode CLI, cursor CLI)
- Examples: `infra/scheduler/src/backend.ts`
- Pattern: Strategy pattern — `ClaudeBackend`, `CursorBackend`, `OpenCodeBackend` implement `AgentBackend`; `resolveBackend("auto")` returns a `FallbackBackend`

**AgentProfile (`agent.ts` — `AGENT_PROFILES`):**
- Purpose: Named configuration bundles (model, turn limits, duration) per session type
- Examples: `workSession`, `fleetWorker`, `chat`, `deepWork`, `skillCycle` in `infra/scheduler/src/agent.ts`
- Pattern: Constant record with optional backend-specific overrides via `BACKEND_PROFILE_OVERRIDES`

**FleetTask (`types.ts` — `FleetTask` interface):**
- Purpose: A task scanned from TASKS.md that is ready for fleet worker assignment
- Examples: `infra/scheduler/src/types.ts`
- Pattern: Stable hash ID from normalized text; carries priority, eligibility flags, and skill type for routing

**Skill (`.claude/skills/<name>/SKILL.md`):**
- Purpose: Reusable judgment procedure invocable by the agent during a session
- Examples: `.claude/skills/orient/`, `.claude/skills/design/`, `.claude/skills/critique/`
- Pattern: YAML frontmatter (description, allowed-tools, invocation mode) + structured procedure + output template

## Entry Points

**Scheduler Daemon:**
- Location: `infra/scheduler/src/cli.ts` (`start` command)
- Triggers: `node dist/cli.js start` or pm2 via `infra/scheduler/ecosystem.config.js`
- Responsibilities: Loads job store, starts `SchedulerService` polling loop, starts HTTP control API on port 8420, manages drain/restart lifecycle

**Manual Job Execution:**
- Location: `infra/scheduler/src/cli.ts` (`run <job-id>` command)
- Triggers: `node dist/cli.js run <id>`
- Responsibilities: Executes a single job immediately outside the schedule (for testing/debugging)

**Control API:**
- Location: `infra/scheduler/src/api/server.ts`
- Triggers: HTTP requests to `http://127.0.0.1:8420`
- Responsibilities: Status queries (`GET /api/status`), push queue management (`POST /api/push/enqueue`), task claiming (`POST /api/tasks/claim`), experiment registration (`POST /api/experiments/register`)

**Experiment Runner:**
- Location: `infra/experiment-runner/run.py`
- Triggers: `python infra/experiment-runner/run.py --detach ...`
- Responsibilities: Fire-and-forget experiment subprocess submission with budget pre-check, progress tracking, retry guards, and post-completion consumption audit

**Budget Verification:**
- Location: `infra/budget-verify/budget-status.py`, `infra/budget-verify/verify.py`
- Triggers: Manual invocation or automated post-session checks
- Responsibilities: Cross-reference project resource consumption against ledger.yaml and Cloudflare AI Gateway logs

## Error Handling

**Strategy:** Fail-open for non-critical checks, fail-closed for governance gates. Errors that would cause resource waste are hard-blocked; errors that would cause monitoring gaps are logged and skipped.

**Patterns:**
- Budget gate fails open: `checkBudget` returns `allowed: true` if budget.yaml is unreadable (avoids blocking sessions on infra issues)
- Agent session errors are logged to `.scheduler/logs/<job-name>-<timestamp>.log` and reported to Slack; the session result is `ok: false` but does not crash the daemon
- Push failures are retried with backoff; if rebase fails, a fallback branch `session-{id}` is created and the human is notified
- Sleep/stall violations (agent sleeping >30s or shell command running >120s) are detected post-session by `sleep-guard.ts` and `stall-guard.ts` and set the session result to `ok: false`
- Auto-commit (`auto-commit.ts`) recovers orphaned files pre/post session; errors are logged but do not block execution

## Cross-Cutting Concerns

**Session Logging:** Sessions produce JSONL metrics in `.scheduler/metrics/sessions.jsonl` (structured) and text logs in `.scheduler/logs/` (unstructured). Knowledge output is tracked per session: new experiment findings, decision records, literature notes, diagnoses, postmortems.

**Convention Enforcement:** `verify.ts` performs post-session git-observed checks: uncommitted files, orphaned files, log entry presence, session footer completeness, ledger consistency. Results flow into `VerificationMetrics` stored with session metrics.

**Budget Enforcement:** Four-layer enforcement — L2 convention (agent self-checks), L0 pre-session gate (`budget-gate.ts`), L0 post-session ledger audit (`infra/experiment-runner`), external verification (`infra/budget-verify`).

**Authentication:** Not applicable — the scheduler runs locally. Agent sessions authenticate via environment variables loaded from `infra/.env` and `infra/scheduler/.env`. The `ANTHROPIC_API_KEY` is required for the Claude backend. Fleet workers use opencode with its own configuration.

---

*Architecture analysis: 2026-03-17*
