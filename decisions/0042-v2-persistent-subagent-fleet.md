# 0042-v2: Persistent Subagent Fleet — 1 Opus + 32 Fast Model, 24/7 Autonomous Execution

Date: 2026-02-27
Status: accepted
Supersedes: 0042

Implementation: `projects/youji/plans/fleet-bootstrap-implementation.md`
Tasks: `projects/youji/TASKS.md` § Heterogeneous Agent Fleet

## Context

youji currently runs autonomous sessions sequentially via a single cron job (every 30
minutes, `maxConcurrentSessions: 1`). Sessions use the "auto" backend fallback chain
(Claude → Cursor → opencode/Fast Model), each running ~5-30 minutes.

The Fast Model backend supports high concurrency at low marginal cost. When capacity is
available but idle, it is waste. Yet the scheduler fills at most 1 of 32 available slots.

The task supply is rich: 54 open tasks across 5 active projects. With current throughput
of ~48 sessions/day (one every 30 minutes), the backlog grows faster than the system
clears it. Concurrent execution would transform wall-clock throughput: 32 agents running
5-minute sessions produce 160 agent-minutes of work in 5 wall-clock minutes — equivalent
to 3.3 hours of sequential execution.

**Four forces converge to make this the right time:**

1. **Economic imperative.** Fast Model capacity is fixed-cost (e.g., reserved compute).
   Running 1/32 of capacity wastes most of that capacity. This is not an optimization —
   it is a correction of waste.

2. **Infrastructure readiness.** The scheduler already has: `maxConcurrentSessions` config,
   task claiming with atomic assignment, git rebase-before-push for concurrent commits,
   backend-specific agent profile overrides for Fast Model, burst mode with autofix, and the
   full opencode backend integration. The concurrency-safety architecture document
   addresses all four race categories. The scaffolding exists; it needs to be activated.

3. **Empirical evidence on model-adapted workflows.** The past 48 hours have produced
   critical feedback records on Fast Model operational behavior:
   - Fast Model sessions average ~6.5 turns, ~280s — fast but shallow
   - L2 convention compliance degrades under Fast Model (root cause analysis in
     `feedback-frequent-human-interventions-root-cause-2026-02-27.md`)
   - Backend-specific profile overrides already implemented (15 min, 64 turns for work sessions)
   - Task decomposition and external scaffolding strategies documented

   These findings inform the design below — the fleet is designed around Fast Model's actual
   operational characteristics, not hypothetical ones.

4. **Opus scarcity constraint.** Opus 4.6 is API-hosted, making it expensive per-session
   and rate-limited. At most 1 Opus agent can run concurrently.
   This eliminates designs that rely on multiple concurrent Opus agents (as V1 does with
   its Synthesizer and Approval Handler). The fleet must be entirely self-hosted (Fast Model)
   with Opus reserved as a single, time-shared strategic supervisor.

## Decision

### Hard Constraint: Single Opus Slot

**Opus 4.6 is API-hosted. At most 1 Opus agent may run concurrently at any time.**
This is a non-negotiable infrastructure constraint — API rate limits and per-session
cost make concurrent Opus usage impractical and wasteful.
The Opus supervisor IS the single Opus slot. No other fleet component may use Opus.
All other agents in the fleet MUST use Fast Model (low-cost, high-throughput).

This constraint shapes the entire architecture: the Opus supervisor is a scarce,
high-value resource that must be time-shared across its responsibilities (strategic
planning, quality auditing, escalation handling), not parallelized.

### Architecture: Supervisor + Fleet

The system uses a two-tier architecture:

**Tier 1 — Opus Supervisor** (exactly 1 agent, Claude backend — the sole Opus slot)
The scheduler's existing cron job continues running as-is, using Claude Opus 4.6. This
is the ONLY Opus agent in the system. No other agent may use the Opus/Claude backend
concurrently. This session handles:
- Full /orient with strategic assessment
- Complex multi-step tasks requiring deep reasoning
- Research synthesis, experiment design, literature review
- Tasks marked `[requires-opus]` or exceeding Fast Model's capability band
- Postmortem analysis and convention evolution
- Any task the fleet agents have failed at (escalation)

The Opus supervisor runs on its existing schedule (every 30 minutes). It is the "brain"
that maintains research direction and the ONLY Opus agent in the system. Its role does
not change — but the single-slot constraint means its time must be carefully allocated
across strategic planning, quality auditing, and escalation handling.

**Tier 2 — Fast Model Fleet** (N agents, opencode backend, N=32 target, ALL self-hosted)
A pool of concurrent opencode/Fast Model agents running continuously 24/7 via the scheduler.
All fleet agents MUST use Fast Model — no fleet agent may use the Opus/Claude backend
(the single Opus slot is reserved exclusively for the Tier 1 supervisor).
Each fleet agent:
- Receives a task assignment from the scheduler (not self-selected via /orient)
- Executes a single, well-scoped task with explicit instructions
- Commits work and exits
- Is replaced by a new agent that picks up the next task

Fleet agents do NOT run /orient, /compound, or any meta-reasoning skill. They are
execution workers, not strategists. Their prompts are pre-built by the scheduler with
explicit instructions derived from TASKS.md entries.

### Fleet Execution Model

**Task Assignment (scheduler-driven, not agent-driven):**

The current model: agent wakes up → runs /orient (2-7 turns) → reads project READMEs
and TASKS.md → selects a task → executes. This works for Opus but wastes Fast Model's
limited reasoning budget on task selection overhead.

The fleet model: the scheduler reads TASKS.md files, selects and claims tasks via
`task-claims.ts`, then spawns agents with task-specific prompts. The agent never
needs to decide *what* to work on — it only needs to decide *how*.

```
Fleet agent prompt template:
────────────────────────────────────────
You are a fleet worker in the youji research system.
Your cwd is the youji repo root. Follow CLAUDE.md conventions.

## Your Task
Project: {project}
Task: {task_text}
Done when: {done_when}

## Context
{project_readme_excerpt}  ← mission, recent 2-3 log entries
{relevant_experiment_context}  ← if the task references an experiment

## Constraints
- Work ONLY on this specific task. Do not select a different task.
- Commit incrementally. After each logical unit of work, git add && git commit.
- Do NOT run /orient, /compound, or other meta-skills.
- If the task requires deep reasoning you cannot perform, write your findings
  to the project README log and mark the task for escalation:
  add tag [escalate: <reason>] to the task in TASKS.md.
- Maximum session: 15 minutes, 64 turns.
- Before finishing, write a 2-3 line log entry to the project README.
────────────────────────────────────────
```

This eliminates the 2-7 turn /orient overhead (saving ~30-50% of Fast Model's effective
turn budget) and constrains the agent to a well-defined scope matching its capability.

**Concurrency Control:**

The scheduler manages fleet concurrency through these mechanisms:

1. **Opus concurrency limit: 1** — the single Opus slot. The scheduler MUST NOT
   spawn a second Opus/Claude agent while one is running. This is enforced in
   `service.ts` by checking `runningJobs` for any job with `backend: "claude"`
   before launching the supervisor. If the supervisor is still running when the
   next cron tick fires, the tick is skipped for Opus (fleet refill proceeds
   independently).

2. **maxConcurrentFleetAgents: 32** (or N) — the fleet size limit, separate from
   the Opus slot. Total concurrent agents = 1 Opus + up to N Fast Model = up to 33.

3. **Task claiming** — the existing `task-claims.ts` prevents double-pickup. The
   scheduler claims tasks before spawning agents (server-side claiming, not agent-side).

4. **Project-level concurrency limit** — new. At most K agents work on the same
   project simultaneously (suggested K=4). This prevents:
   - Excessive git conflicts on project-scoped files (README.md, TASKS.md)
   - Budget overspend races within a project
   - Too many agents in a narrow task space creating coordination overhead

   The remaining N-K*P slots (where P is active project count) are distributed
   round-robin across projects with available tasks.

5. **Job type separation** — fleet agents are a distinct job type from the Opus
   supervisor. The scheduler tracks `runningJobs` by name; fleet agents use names
   like `fleet-worker-01` through `fleet-worker-32`. The Opus supervisor job
   (`auto-session`) occupies the single Opus slot and runs independently of fleet
   capacity. Fleet agents MUST use backend `"opencode"` (Fast Model); only the
   supervisor uses backend `"claude"` (Opus).

**Git Safety at Scale:**

With 32 agents committing concurrently, git conflicts are near-certain. The existing
rebase-before-push mechanism handles this, but at N=32, the conflict rate will be high
for shared files (README.md log entries, TASKS.md tags).

Mitigations:
- **Project-scoped agents write to disjoint file sets** — most agent work is
  within `projects/<project>/`, and with K=4 agents per project, conflicts are
  manageable via rebase (appends to log entries rebase cleanly).
- **Session-specific branches** — when rebase fails, the agent pushes to
  `session-{id}` branch. The next Opus supervisor session detects and merges
  unmerged branches (existing `branch-cleanup.ts` logic, enhanced).
- **Staggered commit windows** — fleet agents commit at random intervals
  throughout their session, not all at the end. The executor's rebase-push
  runs after each agent completes.
- **TASKS.md write lock** — the scheduler maintains the authoritative task
  state (claims, completion marks). Fleet agents tag tasks `[in-progress]` and
  `[x]` as they work, but the scheduler reconciles conflicts during task
  assignment. Double-marks are harmless (idempotent).

### Continuous Operation: The Refill Loop

The scheduler maintains the fleet at target capacity through a refill loop:

```
Every poll cycle (30s):
  # Fleet refill — Fast Model only (Opus supervisor runs on its own cron, max 1)
  active_fleet = count(running fleet agents)  # Fast Model agents only
  if active_fleet < N:
    available_tasks = scan_all_tasks() - claimed_tasks - blocked_tasks - opus_only_tasks
    tasks_to_launch = min(N - active_fleet, len(available_tasks))
    for each task in available_tasks[:tasks_to_launch]:
      claim(task)
      build_prompt(task)
      spawn_fleet_agent(prompt, backend="opencode")  # MUST be self-hosted/Fast Model

  # Opus supervisor — independent cron, enforced max 1 concurrent
  if opus_cron_due AND count(running opus agents) == 0:
    spawn_opus_supervisor(backend="claude")  # single slot
```

This runs regardless of project schedules, blockers, or progress. As long as there
are open tasks in any project, the fleet stays full. When all tasks are complete or
blocked, the fleet naturally drains — agents aren't spawned with nothing to do.

**24/7 operation** means the fleet refill loop runs continuously with Fast Model agents.
The single Opus supervisor runs on its own 30-minute cron cycle, occupying the sole
Opus API slot only while active. The fleet does not depend on /orient to identify
work — it reads TASKS.md directly. This decouples execution velocity (Fast Model fleet,
self-hosted, massively parallel) from strategic planning velocity (Opus supervisor,
API-hosted, strictly serial).

**When tasks run out — the Idle Capacity Principle:**

**Idle capacity is preferred over low-value work.** When genuine work runs out,
agents drain to idle. This is correct behavior, not a bug. Low-value work has
negative expected value because every file written taxes future sessions' context
windows. The repo is the agents' memory — noise in the repo is noise in their
thinking. Manufacturing busywork to fill slots actively degrades the system.

If all tasks across all projects are completed, blocked, or claimed:
1. The fleet drains naturally (no new agents spawned)
2. The Opus supervisor continues running on schedule
3. The supervisor's /compound step discovers implied tasks from completed work
4. New tasks appear in TASKS.md → the fleet refills

**The one exception: zero-resource compound work.** When the fleet has idle
capacity, it MAY select zero-resource knowledge work that is genuinely valuable:
- Reviewing existing findings for missed insights or contradictions
- Improving documentation accuracy (correcting errors, not padding)
- Decomposing blocked tasks into unblocked subtasks
- Cross-referencing experiment results across projects

This is not busywork — it is compound work that improves the quality of the
knowledge base. But it must be selected by the same priority system, not
manufactured to fill slots. The test: "Would a human researcher do this if
they had free time, or would they take a break?" If the latter, the agent
should idle.

**Fleet utilization <50% is not an alert condition.** It means the system is
honest about what's worth doing. The fleet's value comes from throughput when
there IS real work, not from staying perpetually busy.

### Hybrid Model: Opus + Fast Model Coordination

The single Opus supervisor and Fast Model fleet are not independent — they form a
producer-consumer relationship. Because Opus is API-hosted with a strict concurrency
limit of 1, this relationship is necessarily serial: the Opus supervisor runs on its
30-minute cron cycle, produces tasks and quality audits, then yields. The fleet runs
continuously in between. They never compete for the same compute.

**Opus produces (single agent, time-shared across responsibilities):**
- Strategic task decomposition (breaking complex tasks into fleet-sized subtasks)
- Research direction (which projects to prioritize)
- Quality review of fleet output (checking convention compliance)
- Escalation handling (tasks the fleet couldn't complete)
- New task creation from experiment findings

**Fleet consumes (up to 32 Fast Model agents, all self-hosted):**
- Well-scoped tasks with clear done-when conditions
- Routine operations (documentation, file organization, data analysis)
- Verification and validation work
- Experiment setup and configuration
- Simple code changes and bugfixes

**Task classification for routing:**

| Characteristic | Route to Opus | Route to Fleet |
|---|---|---|
| Requires multi-step planning | Yes | No |
| Has clear, mechanical steps | No | Yes |
| Involves research synthesis | Yes | No |
| Is tagged `[zero-resource]` | Rarely | Often |
| Requires reading >5 files | Yes | Maybe (with explicit file list) |
| Has a template or checklist | No | Yes |
| Involves convention evolution | Yes | No |
| Is a subtask of a decomposed task | No | Yes |
| Requires external API calls | Depends on complexity | Simple calls only |

The scheduler performs this routing automatically based on task metadata:
- Tasks tagged `[requires-opus]` → queued for the single Opus supervisor slot
  (executed during the supervisor's next cron cycle, not in parallel)
- Tasks tagged `[fleet-eligible]` → Fast Model fleet preferred
- Untagged tasks → Fast Model fleet attempts first; escalated to Opus on failure

### Task Decomposition Protocol

For the fleet to be effective, tasks must be fleet-sized. The Opus supervisor's
/orient and /compound steps should actively decompose complex tasks:

**Before (single complex task):**
```
- [ ] Run baseline experiment on sample-benchmark scoring interface
  Done when: Baseline results for 6 rubric dimensions documented
```

**After (fleet-decomposed):**
```
- [ ] Prepare sample-benchmark rubric experiment config [fleet-eligible]
  Done when: Config file exists at experiments/rubric-baseline/config.yaml
- [ ] Write sample-benchmark rubric experiment script [fleet-eligible]
  Done when: Script runs without error on 1 sample
- [ ] Set up rubric experiment directory [fleet-eligible]
  Done when: EXPERIMENT.md with status: planned exists
- [ ] Launch rubric experiment via experiment runner [requires-opus]
  Done when: Experiment submitted with progress.json showing status: running
- [ ] Analyze rubric experiment results [requires-opus]
  Done when: Findings section in EXPERIMENT.md with per-dimension scores
```

This decomposition is the Opus supervisor's primary value-add to the fleet.
Without it, the fleet has no well-scoped work. With it, the fleet multiplies
throughput on mechanical subtasks.

### Model Diversity in Fleet Composition

The V1/V2 design process (see Model Attribution below) revealed that different models
surface different tradeoffs when reasoning about the same problem. This insight extends
beyond proposal generation into fleet operation itself.

**Mixed-model composition.** The fleet need not be homogeneous, but it IS constrained:
Opus 4.6 is API-hosted with a hard concurrency limit of 1, so the Opus supervisor is
the sole Opus slot. All fleet workers MUST be self-hosted models (currently Fast Model).

- **Opus 4.6 supervisor (1 agent, API-hosted, exclusive slot)** — strategic reasoning,
  task decomposition, quality auditing, convention evolution. High per-session cost,
  high reasoning depth. Cannot be parallelized — the single Opus slot is time-shared.
- **Fast Model workers (up to 32 agents, self-hosted)** — fast execution of well-scoped
  tasks, high throughput, zero marginal cost on prepaid infrastructure.
- **Future: additional self-hosted model tiers** — if other zero-cost or low-cost
  models become available (e.g., different open-weight models on the same GPU
  infrastructure), they can be added as additional worker pools. The scheduler routes
  tasks based on task complexity and model capability, not model identity. Note: any
  API-hosted model would share the same concurrency concern as Opus — only self-hosted
  models can scale to N=32 at zero marginal cost.

This is not a hypothetical optimization — it is a consequence of the architecture.
Because V2 treats workers as ephemeral and task assignment is scheduler-driven, the
scheduler can route tasks to any self-hosted backend that can handle them. The `backend`
field in `JobPayload` already supports this. A task tagged `[requires-opus]` queues for
the single Opus supervisor slot; a task tagged `[fleet-eligible]` goes to whatever
self-hosted fleet backend is available.

**Convergent governance as robustness signal.** The fact that Fast Model (V1) and Opus 4.6
(V2) independently converged on the same governance structures (APPROVAL_QUEUE, human-set
budgets, production PR gates) is evidence that these structures should be treated as
load-bearing — they are not arbitrary conventions but structural necessities that
multiple reasoning systems independently derive from the problem constraints. Any
future fleet evolution proposal that removes these structures should carry a high
burden of proof.

### Implementation: What Changes

**service.ts:**
- Add `maxConcurrentFleetAgents: 32` (configurable via env var `FLEET_SIZE`)
- Enforce Opus concurrency limit of 1: check `runningJobs` for any `backend: "claude"`
  job before launching the Opus supervisor. Skip supervisor launch if one is running.
- Add fleet refill logic in `onTick` callback (fleet agents are always Fast Model/opencode)
- Change job execution from sequential `await` to concurrent `Promise` launches
  (the `await executeJob` in the `for` loop becomes fire-and-forget with tracking)

**New: fleet-scheduler.ts (~150 lines):**
- `scanAvailableTasks()`: reads all TASKS.md files, returns unclaimed/unblocked tasks
- `buildFleetPrompt(task, project)`: constructs the fleet agent prompt template
- `refillFleet(targetN, currentActive)`: spawns agents up to target capacity
- `classifyTask(task)`: determines opus-only vs fleet-eligible routing

**executor.ts:**
- Add `fleet` trigger source alongside existing `scheduler | slack | manual`
- Fleet agents use the `workSession` profile with opencode backend overrides
  (64 turns, 15 min — already configured in `BACKEND_PROFILE_OVERRIDES`)

**agent.ts:**
- New profile: `fleetWorker` — same as opencode-overridden `workSession` but
  with `label: "fleet-worker"` for metric attribution

**types.ts:**
- Add `fleet` to `JobPayload.backend` options (optional, defaults to "opencode")
- Fleet backend MUST resolve to a self-hosted model (Fast Model). Never to "claude"/Opus.

**task-claims.ts:**
- Already works — no changes needed. The scheduler claims tasks server-side
  before spawning fleet agents.

**concurrency-safety.md:**
- Update with fleet-specific concurrency design (this ADR serves as the design doc)

**CLAUDE.md:**
- Add fleet section explaining the two-tier model and single-Opus constraint
- Add `[fleet-eligible]` and `[requires-opus]` tag definitions to task lifecycle tags
- Document that `[requires-opus]` tasks queue for the single Opus slot (not parallel)
- Add fleet worker prompt conventions

### Monitoring and Safety

**Utilization metric:**
```
fleet_utilization = active_fleet_agents / target_fleet_size
```
Informational only — not a target. Low utilization means low task supply, which is
healthy (see Idle Capacity Principle). Track for capacity planning, not as a KPI.

**Quality metric:**
```
fleet_success_rate = sessions_with_commit / total_fleet_sessions
```
Target: >70%. If below 50%, reduce fleet size or improve task decomposition.

**Escalation rate:**
```
escalation_rate = tasks_escalated_to_opus / total_fleet_tasks
```
Target: <20%. If above 30%, task routing needs recalibration.

**Safety gates:**
- Fleet agents have the same L0 enforcement as all agents (sleep guard, budget
  gate, pre-commit file size check)
- Fleet agents cannot modify CLAUDE.md, decisions/, or infra/ code (enforced
  via `disallowedTools` or prompt constraint)
- The Opus supervisor audits fleet output during /compound (checking for
  convention drift, incomplete work, or conflicting changes)

**Kill switch:**
- Set `FLEET_SIZE=0` in .env → no fleet agents spawned on next tick
- The Opus supervisor continues running independently
- All existing fleet sessions complete naturally (no forced termination)

### Cost Analysis

**Current state (sequential, N=1):**
- ~48 sessions/day × ~5 min/session = 240 agent-minutes/day
- Fast Model utilization: ~17% of capacity (5 min active per 30 min cycle)
- Opus cost: $2-5/session × ~48 sessions = ~$96-240/day (when using Claude)

**Fleet state (1 Opus + 32 Fast Model concurrent):**
- Fast Model fleet: 32 agents × 5 min/session × 12 sessions/hour = 1,920 agent-minutes/hour
- ~46,080 Fast Model agent-minutes/day (192× current throughput)
- Fast Model utilization: >80% of capacity
- Fast Model marginal cost: $0 (prepaid hourly server, self-hosted)
- Opus supervisor: exactly 1 concurrent agent, same cron schedule (~48 sessions/day)
- Opus cost unchanged (~$2-5/session × 48/day, API-hosted)
- Opus cannot be parallelized to increase throughput — it is API-rate-limited

**Net effect:** ~192× throughput increase at near-zero marginal cost for fleet work.
The Opus supervisor cost is unchanged and represents the only API expense. The Fast Model
fleet uses prepaid self-hosted capacity that is currently wasted. The single Opus
slot is a bottleneck for strategic work but not for execution throughput — the
architecture routes the vast majority of tasks to the zero-cost fleet.

### Phased Rollout

**Phase 0: Validate (1 day)**
- Set `maxConcurrentFleetAgents: 4` (Fast Model only, Opus remains at 1 concurrent)
- Run 4 concurrent Fast Model agents + 1 Opus supervisor for 24 hours
- Measure: git conflict rate, task completion rate, escalation rate
- Success criteria: >60% sessions produce commits, <5% git conflicts unresolvable

**Phase 1: Fleet scaffolding (2-3 days)**
- Implement `fleet-scheduler.ts` with task scanning and prompt building
- Add fleet refill logic to `onTick` (Fast Model fleet only; Opus supervisor unchanged)
- Enforce single-Opus-slot guard in `service.ts`
- Test with N=8 Fast Model fleet agents for 48 hours
- Success criteria: >70% fleet utilization, >65% success rate

**Phase 2: Scale to N=16 (1 week)**
- Monitor and tune project-level concurrency limits
- Implement Opus supervisor task decomposition for fleet consumption
- Add `[fleet-eligible]` / `[requires-opus]` routing
- Success criteria: >75% fleet utilization, <25% escalation rate

**Phase 3: Full fleet N=32 (ongoing)**
- Scale to target capacity
- Allow fleet to drain to idle when tasks are exhausted (per Idle Capacity Principle)
- Implement fleet quality auditing in /compound
- Success criteria: >70% success rate on active sessions, <20% escalation

## Consequences

### Positive

- **192× throughput increase** at near-zero marginal cost (prepaid Fast Model capacity)
- **24/7 operation** decoupled from cron schedule — continuous progress on all projects
- **Full utilization** of self-hosted GPU infrastructure (from ~17% to >80%)
- **Scarce Opus slot preserved** for strategic work — the single API-hosted Opus
  agent focuses on high-value tasks while routine work runs on zero-cost fleet
- **Task backlog cleared faster** — 54 open tasks processable in hours, not weeks
- **Research velocity** — experiment setup, data analysis, documentation all parallelized
- **Natural task decomposition incentive** — the fleet creates pressure to write
  well-scoped tasks, improving task quality system-wide

### Negative

- **Git conflict rate increases** — mitigated by project-scoped concurrency limits
  and rebase-before-push, but some manual resolution may be needed
- **Convention compliance risk** — Fast Model follows L2 conventions less reliably.
  Mitigated by: (a) constrained fleet prompts that don't require meta-reasoning,
  (b) L0 enforcement gates, (c) Opus supervisor quality auditing
- **Task supply dependency** — the fleet is only as productive as the task backlog.
  Requires active task decomposition by the Opus supervisor. When tasks run out,
  the fleet drains to idle by design (see Idle Capacity Principle). Zero-resource
  compound work provides a natural floor of genuinely valuable activity.
- **Monitoring overhead** — 32 concurrent agents produce more noise in metrics and
  Slack notifications. May need notification batching or fleet-specific quiet mode.
- **Debugging complexity** — when something goes wrong with 32 agents, root cause
  analysis is harder. Session logs and metrics must clearly attribute fleet vs supervisor.
- **Single Opus bottleneck** — strategic tasks (decomposition, synthesis, escalation
  handling) can only be processed by 1 Opus agent at a time. If the fleet generates
  escalations faster than the Opus supervisor can process them, a queue builds up.
  Mitigated by: prioritizing fleet-eligible tasks, good task decomposition to reduce
  escalation rate, and the Opus supervisor's /compound step batching multiple reviews.

### Risk Matrix

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Git merge conflicts at scale | High | Medium | Rebase-push, branch fallback, project concurrency limit |
| Fleet agents producing low-quality work | Medium | Medium | Constrained prompts, L0 gates, Opus audit |
| Task supply exhaustion | Medium | Low | Natural drain to idle (by design); zero-resource compound work as floor |
| Fast Model server overload at 32 concurrent | Low | High | Gradual scaling (Phase 0-3), utilization monitoring |
| Convention drift from fleet volume | Medium | Medium | Opus /compound auditing, fleet-specific constraints |
| Infinite retry loops on bad tasks | Low | Medium | Task failure counter, auto-skip after 3 fleet failures |
| Opus supervisor bottleneck (escalation queue) | Medium | Medium | Good task decomposition, batch review in /compound, escalation rate monitoring |

## V1 vs V2 Comparison

ADR 0042 (V1, drafted with a fast model backend, commit 341f88ff) and this document
(V2, drafted with Opus 4.6) both address the same problem: how
to run N=32 concurrent Fast Model agents 24/7. They share more common ground than
they diverge — both retain human governance and recognize Fast Model's strengths and
limitations. The differences are architectural: how agents are organized, how
work is assigned, and what happens when tasks run out. The model diversity in
authorship is itself evidence — see "Model Attribution and Diversity Evidence"
below.

*(Note: V1 was later revised (commit 41805c9c) to add a "No Human Maintainer"
constraint with autonomous self-governance. This comparison uses the original
V1 which retains human governance hooks, for a fairer apples-to-apples comparison.)*

### Design Philosophy

**V1: Domain-partitioned fleet with guaranteed capacity.** V1 organizes agents
into workstreams — persistent domain assignments (e.g., "literature-arxiv",
"infra-health", "sample-style"). Half the fleet (16 agents) is allocated to
"guaranteed-infinite" workstreams that never exhaust (arxiv scanning, documentation,
code exploration). Human governance is preserved via the existing APPROVAL_QUEUE.md.
A nightly Claude Opus "Synthesizer" and an on-demand Claude Sonnet "Approval Handler"
run alongside the fleet (note: this implies multiple concurrent Opus/Claude agents,
which V2 identifies as infeasible — see Hard Constraint: Single Opus Slot).

**V2: Supervisor-driven task execution.** V2 retains the existing Opus supervisor
running on its current cron schedule, with the fleet as a task-execution tier beneath
it. Agents receive individual tasks from the scheduler, execute them, and exit.
No persistent domain assignment — agents are ephemeral workers. Human governance
is preserved identically to V1 (APPROVAL_QUEUE.md, budget.yaml, project priorities).

**Assessment:** Both designs preserve human governance — neither removes APPROVAL_QUEUE
or auto-approves budget increases. The core difference is organizational: V1
partitions the problem space into domains and assigns agents to domains; V2 treats
agents as a fungible pool executing whatever task the scheduler selects. V1's
domain partitioning provides natural isolation but can lead to underutilization
within a domain. V2's fungible pool maximizes task throughput but requires smarter
scheduling.

### Architecture

| Dimension | V1 | V2 |
|-----------|----|----|
| **Assignment model** | Workstream-based (agents own a domain) | Task-based (agents receive a single task) |
| **Agent persistence** | Semi-persistent (owns a workstream across sessions) | Ephemeral (one task, one session, replaced) |
| **Task selection** | Agent selects within its workstream | Scheduler selects and assigns task to agent |
| **Strategic reasoning** | Eliminated (no /orient for fleet agents) | Preserved in Opus supervisor |
| **Knowledge synthesis** | Nightly Claude Opus "Synthesizer" agent | Opus supervisor's /compound step |
| **Human governance** | Preserved (APPROVAL_QUEUE.md, human-set budgets) | Preserved (APPROVAL_QUEUE.md, human-set budgets) |
| **Git strategy** | Dedicated branches per workstream, 15-min merge windows | Shared main branch, rebase-before-push |
| **Concurrency control** | Workstream partitioning (disjoint by design) | Project-level concurrency limits (K=4 per project) |
| **External infrastructure** | Requires Redis for API semaphore | No new infrastructure dependencies |
| **Opus/Claude concurrency** | 3 concurrent (Synthesizer + Approval Handler + fleet routing) — **violates single-Opus constraint** | 1 (Opus supervisor serves all roles within single slot) |

### Task Supply and Idle Capacity

**V1: Guaranteed 50% utilization via infinite workstreams.** V1 allocates half the
fleet (16 agents) to "guaranteed-infinite" workstreams: arxiv scanning, documentation
improvement, code exploration, data re-analysis. These never exhaust because their
source material is unbounded. The remaining 50% handles project tasks and opportunistic
work. Dynamic rebalancing moves agents from exhausted project workstreams into
guaranteed workstreams.

**V2: Drain to idle when real work runs out.** V2 treats idle capacity as correct
behavior. Low-value work has negative expected value — every file written taxes
future context windows. The only exception is zero-resource compound work
(reviewing findings, improving documentation accuracy, decomposing blocked tasks),
which genuinely improves the knowledge base.

**Assessment:** This is the sharpest design disagreement. V1 optimizes for GPU
utilization (every slot filled) by defining work categories that are infinite by
nature. V2 optimizes for knowledge value per session (only genuine work justifies
a session). V1's "infinite workstreams" risk producing high-volume output of
uncertain value: literature notes that may not be read, documentation that adds
words without clarity, code audits that find nothing actionable. V2 accepts lower
utilization in exchange for higher signal-to-noise in the repo. Since the repo IS
the agents' memory, noise reduction compounds across every future session.

Neither design is clearly wrong — the answer depends on whether guaranteed-infinite
workstreams like arxiv scanning actually produce net-positive knowledge. If they
do, V1's approach is more efficient. If they don't, V2's idle discipline avoids
waste.

### Complexity and Implementation Risk

**V1 is substantially more complex:**
- New fleet orchestrator module with workstream management
- Redis-based distributed API semaphore
- Dynamic rebalancing engine (exhaustion detection, agent reassignment)
- Dedicated branch management with 15-minute merge windows
- Workstream configuration system (`fleet/workstreams.yaml`)
- Two additional Claude/Opus agents (Synthesizer + Approval Handler) — this is
  infeasible under the single-Opus constraint (Opus is API-hosted; only 1 may
  run concurrently). V1 would need to serialize these roles into the single Opus
  slot or substitute Fast Model, which may lack the synthesis capability.

**V2 extends existing infrastructure:**
- Adds `maxConcurrentFleetAgents: 32` for Fast Model fleet (Opus stays at 1)
- Adds ~150 lines of fleet-scheduler.ts (task scanning + prompt building)
- Uses existing task-claims.ts, executor.ts, and rebase-push mechanisms
- No new external dependencies

**Assessment:** V1's implementation surface is roughly 5-7× larger. The workstream
management, rebalancing engine, and Redis dependency introduce operational complexity
that must be maintained. V2's incremental approach carries less risk and can be
rolled out in days rather than weeks. However, V1's branch-per-workstream strategy
may handle git conflicts more gracefully at scale than V2's rebase-on-main approach.

### Governance and Safety

**V1 preserves human governance.** APPROVAL_QUEUE.md is maintained. Budget limits
are human-set. Fleet agents cannot modify governance files. The Approval Handler
(Claude Sonnet) drafts responses for human review but does not auto-approve.
However, V1 implicitly requires multiple concurrent Opus/Claude agents (Synthesizer,
Approval Handler, plus the main supervisor), which violates the single-Opus
infrastructure constraint.

**V2 preserves human governance identically.** APPROVAL_QUEUE.md continues to
function. Production PRs still require human sign-off. Budget limits are human-set.
Fleet agents cannot modify CLAUDE.md, decisions/, or infra/ code.

**Assessment:** Both designs maintain the same governance posture. Neither
auto-approves budgets or production PRs. The primary safety difference is
operational, not governance: V1's workstream isolation means a misbehaving agent
affects only its domain, while V2's fungible pool means any agent could work on
any project (bounded by the project concurrency limit K=4).

### Mission Alignment

youji's mission is to achieve fully autonomous research through self-evolution and
AI-native research infrastructure. The repo is both artifact storage and cognitive
state — the agents' persistent memory between sessions. CLAUDE.md establishes
that the fundamental efficiency metric is *findings per dollar*, and that every
plan, experiment, and session should be evaluated by the knowledge it produces.

Evaluated against these axioms, V2 better aligns with youji's mission on three axes:

**1. Knowledge value over throughput.**
youji's core metric is findings per dollar, not sessions per day or GPU utilization.
V2's Idle Capacity Principle directly embodies this — it refuses to generate noise
just to fill slots. V1's guaranteed-infinite workstreams (arxiv scanning, documentation
padding, code exploration) optimize for utilization, which is an *operational* metric,
not a *knowledge* metric. Scanning 500 arxiv papers per day without a research question
to answer produces literature notes that no one reads. That is precisely the low-value
work that CLAUDE.md warns against — "noise in the repo is noise in their thinking."
V2 accepts lower utilization in exchange for higher signal-to-noise, which compounds
across every future session because the repo IS the agents' memory.

**2. Architectural simplicity as research contribution.**
youji is not just a task-completion engine — it is a research contribution about how to
structure repos for stateless agents. V2's simplicity (~150 new lines, no new dependencies)
is itself a finding: the minimum viable fleet architecture for an autonomous research
group is a scheduler refill loop on top of existing infrastructure. This is a reproducible
insight that other research groups could adopt. V1's 5-7× larger implementation surface
(workstream management, Redis semaphore, rebalancing engine, dedicated branch strategy)
may be necessary at larger scale, but it obscures the core architectural insight under
operational complexity. V2 answers a research question ("what is the simplest fleet
architecture that preserves knowledge integrity?") while V1 answers an engineering
question ("how do we maximize utilization of 32 GPUs?").

**3. Compound knowledge integrity.**
The repo-as-cognitive-state pattern (ADR 0001, `docs/design.md`) requires that the
repo remain a coherent, low-noise knowledge base. V2's rebase-on-main strategy preserves
a single linear history — the canonical cognitive state. V1's branch-per-workstream
strategy creates parallel histories that must be periodically reconciled, introducing
merge complexity and potential for knowledge fragmentation. V2's ephemeral agents write
directly to the shared knowledge base; V1's domain-partitioned agents write to isolated
branches that a separate Synthesizer must later integrate. The additional indirection
increases the risk that findings are lost in translation or delayed in integration.

**Assessment:** V2 treats the fleet as an accelerator for an existing well-designed
system. V1 treats the fleet as a system unto itself that must be independently managed.
For a research group whose output IS the repo, V2's approach of keeping the repo clean
and simple — even at the cost of idle compute — better serves the mission.

### Summary

V1 and V2 share the same core insight — Fast Model's fixed-cost compute is being wasted
at N=1, and parallel execution is the obvious correction — and the same governance
posture (human oversight preserved). They differ on fleet organization and idle
capacity philosophy.

**V1 bets on domain partitioning and guaranteed utilization.** Workstreams provide
natural isolation, the fleet always has something to do, and a separate synthesis
layer consolidates findings. The cost is higher implementation complexity and the
risk that guaranteed-infinite workstreams produce noise.

**V2 bets on task-level scheduling and idle discipline.** The scheduler drives
all assignment, agents are ephemeral, and idle capacity is preferred over low-value
work. The cost is a smarter scheduler and a willingness to leave compute unused.
The benefit is simpler architecture and a higher knowledge-per-session ratio.

A practical note: V1's design requires multiple concurrent Opus/Claude agents
(Synthesizer, Approval Handler, plus the main supervisor), which is infeasible
under the single-Opus constraint. Opus 4.6 is API-hosted and cannot run more than
1 concurrent agent. V2's design respects this constraint natively — the single Opus
supervisor handles all strategic roles (synthesis, approval routing, quality audit)
within one time-shared slot. V1 would require significant redesign to operate under
this constraint, likely converging toward V2's single-supervisor architecture.

A hybrid is possible: V2's task-based execution model with V1's branch-per-domain
git strategy and a curated subset of V1's guaranteed workstreams (e.g., arxiv
scanning only, not the full 50% allocation).

### Model Attribution and Diversity Evidence

**V1 was drafted with a fast model backend. V2 was drafted with Opus 4.6.**

This is itself a finding worth recording. Two different language models, with different
training data, architectures, and reasoning styles, were asked the same design question
("how to run N=32 agents 24/7") against the same codebase. The resulting proposals
share striking structural convergence on governance:

- Both preserve APPROVAL_QUEUE.md as the human governance interface
- Both retain human-set budget.yaml limits without auto-approval
- Both recognize Fast Model's strengths (speed, throughput) and limitations (convention compliance)
- Both propose an Opus-tier agent for strategic reasoning and a Fast Model-tier for execution
- Both identify task decomposition as the critical enabler for fleet effectiveness

This convergence across independently-derived proposals from different model families
is evidence that these governance structures are robust — they emerge from the problem
constraints, not from a single model's biases or training artifacts. If only one model
had proposed APPROVAL_QUEUE preservation, it might be a learned pattern. When two
independently arrive at it, it is more likely a structural necessity of the domain.

The proposals diverge on implementation philosophy (domain partitioning vs fungible
pool, guaranteed utilization vs idle discipline), which is exactly where model diversity
provides value: different models surface different design tradeoffs. This suggests that
the fleet design process itself benefits from soliciting proposals from multiple models
before committing to an architecture.

## Open Questions

1. **Task complexity classifier** — how to automatically determine if a task is
   fleet-eligible? Initial approach: tag-based (human or Opus tags tasks). Future:
   heuristic based on task text complexity and referenced file count.

2. **Fleet notification policy** — should fleet sessions post to Slack? At 32
   concurrent, that's high noise. Proposal: only notify on failure/escalation,
   batch success notifications into a periodic digest.

3. **Cross-project coordination** — when fleet agents on different projects need
   to reference each other's work, how do they coordinate? Answer: they don't.
   Cross-project tasks are Opus-only.

4. **Fast Model context window** — at 202k tokens with 4k output, how does the fleet
   prompt + CLAUDE.md + project context fit? Need to measure and potentially
   create a reduced CLAUDE.md for fleet agents.

5. **Mixed-model fleet composition** — when additional zero-cost models become
   available on the self-hosted infrastructure, should the scheduler route tasks
   based on empirical model-task fit? The architecture supports this (scheduler-
   driven assignment, backend field in JobPayload), but the task complexity
   classifier would need model-specific capability profiles. Note: only self-hosted
   models can join the fleet at scale. Any API-hosted model shares the same
   concurrency constraint as Opus (cost and rate limits prevent N>1).

6. **Multi-model proposal solicitation** — the V1/V2 process surfaced value in
   asking different models the same design question. Should this become a standard
   practice for architectural decisions? Cost: 2-3× the design time. Benefit:
   diverse perspectives and convergence-as-evidence for robust structures.
