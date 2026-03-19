# 0042: Persistent Subagent Fleet — 32 Parallel opencode/GLM-5 Agents 24/7

Date: 2026-02-27
Status: proposed

## Core Constraint: No Human Maintainer

**The fleet operates with zero human oversight.** There is no human in the loop for:
- Approvals (budget changes, governance, production PRs)
- Rebalancing (workstream reassignment)
- Synthesis (cross-session learning)
- Incident response (failures, conflicts, degradation)

The fleet must be **self-healing**, **self-governing**, and **self-evolving**. This is not a design preference — it is a hard constraint that shapes every decision in this ADR.

**Rationale**: Human bottlenecks defeat the purpose of a 24/7 autonomous fleet. If a human must approve a rebalance, the fleet stalls. If a human must resolve a conflict, agents idle. If a human must review an approval queue, governance blocks progress. The fleet must maintain itself.

## Design Tension

**Throughput vs. Coordination** — youji's current serialized architecture (ADR 0005) maximizes coordination at the cost of throughput. A single agent produces one stream of findings per hour. GLM-5 FP8 offers massive parallel capacity at zero marginal API cost, but 32 concurrent agents risk git conflicts, duplicated work, and incoherent knowledge output.

This proposal moves youji toward the **throughput** side of the tension while introducing coordination mechanisms that preserve knowledge coherence. The tradeoff: more complexity in orchestration, but 32x capacity with no additional API spend.

---

## Current State: Architectural Map

### Agents (spawn points)

| Location | Trigger | Profile | Model | MaxTurns | MaxDuration | Purpose |
|----------|---------|---------|-------|----------|-------------|---------|
| `executor.ts:145` | Scheduler cron / Slack trigger / CLI | workSession | opus (default) | unlimited | 30 min | Autonomous work sessions |
| `executor.ts:145` | Team session | teamWorkSession | opus | 256 | 120 min | Multi-agent team sessions |
| `chat.ts:412` | Slack message | chat | sonnet (default) | 16 | 2 min | Interactive chat responses |
| `event-agents.ts:343` | Slack `/youji work` | deepWork | opus | 256 | 60 min | Task-specific deep work |
| `event-agents.ts:610` | Slack `/youji team` | teamWorkSession | opus | 256 | 120 min | Team-based deep work |
| `session-autofix.ts:116` | Verification failure | autofix | opus | 32 | 10 min | Self-healing after failures |

**Backend-specific overrides** (from `agent.ts:41-48`):
- opencode/GLM-5: tighter limits (maxTurns: 64-128, maxDurationMs: 600-900s) to prevent convention non-compliance cascades

### Dependencies

```
executor.ts → agent.ts → backend.ts
                ↓
            session.ts (registration)
            drain-state.ts (drain gate)
            sleep-guard.ts (L0 enforcement)
            task-claims.ts (claim collision)
```

### Data flows

| Component | Persistent | Ephemeral | Notes |
|-----------|------------|-----------|-------|
| Job store | `.scheduler/jobs.json` | — | Pending scheduled jobs |
| Session registry | — | `session.ts` Map | Active sessions only |
| Task claims | `.scheduler/claims.json` | — | Cross-session collision prevention |
| Progress | `.scheduler/progress.json` | — | Slack notification state |
| Budget gate | `budget.yaml` + `ledger.yaml` | — | Per-project resource tracking |
| Git state | Working tree | — | Session commits, merge conflicts |

### Governance layers

| Layer | Enforcer | Location | Scope |
|-------|----------|----------|-------|
| Drain gate | `drain-state.ts` | Pre-spawn | Block new sessions during graceful restart |
| Budget gate | `budget-gate.ts` | Pre-execution | Block sessions when budget exhausted |
| Sleep guard | `sleep-guard.ts` | During execution | Terminate sessions sleeping >30s |
| Task claims | `task-claims.ts` | Task selection | Prevent duplicate task pickup |
| Verification | `verify.ts` | Post-session | Check SOP compliance, uncommitted files |
| Anomaly detection | `anomaly-detection.ts` | Post-session | Flag unusual metrics |

### Observations

**Strengths:**
- Single entry point (`spawnAgent`) provides consistent governance
- Multiple profiles allow tuned behavior per use case
- L0 enforcement (sleep guard, drain gate) prevents runaway sessions

**Weaknesses:**
- Serialized execution: only one work session at a time (via scheduler)
- Idle capacity: GLM-5 GPU cluster sits unused between sessions
- Project focus: current scheduler picks one project per session, others wait

**Opportunity:**
- GLM-5 has fixed sunk cost (dedicated GPU cluster) with 202k context and zero marginal API cost
- Running N=32 agents in parallel would increase capacity ~32x with no additional spend

---

## Proposal

**Implement a Persistent Subagent Fleet**: 32 opencode/GLM-5 agents running continuously (24/7), each assigned to a dedicated "workstream" — a partitioned slice of youji's mission.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     FLEET ORCHESTRATOR                          │
│  - Assigns workstreams to agents                                │
│  - Monitors health, restarts crashed agents                     │
│  - Manages git merge windows (staggered commits)                │
│  - Enforces global resource caps (GPU, concurrent API calls)    │
│  - Dynamic rebalancing when workstreams exhaust/block           │
└─────────────────────────────────────────────────────────────────┘
         │
         │  GUARANTEED WORKSTREAMS (16 agents, 50% of fleet)
         ├─── Agent 0-2 (workstream: literature-arxiv)      → opencode
         ├─── Agent 3-4 (workstream: literature-huggingface) → opencode
         ├─── Agent 5-7 (workstream: infra-health)          → opencode
         ├─── Agent 8-9 (workstream: self-evolution)        → opencode
         ├─── Agent 10-11 (workstream: data-reanalysis)     → opencode
         ├─── Agent 12-13 (workstream: documentation)       → opencode
         └─── Agent 14-15 (workstream: code-exploration)    → opencode
         
         │  PROJECT-BOUND WORKSTREAMS (12 agents, 37.5% of fleet)
         ├─── Agent 16-19 (workstream: sample-style-project) → opencode
         ├─── Agent 20-23 (workstream: sample-research-project) → opencode
         └─── Agent 24-27 (workstream: other-projects)      → opencode
         
         │  OPPORTUNISTIC WORKSTREAMS (4 agents, 12.5% of fleet)
         ├─── Agent 28-29 (workstream: opportunistic-0)     → opencode
         └─── Agent 30-31 (workstream: opportunistic-1)     → opencode
                 
          │  SYNTHESIS LAYER (2 Claude agents, not part of 32)
          ├─── Synthesizer (nightly)                         → Claude Opus
          └─── Evolver (continuous)                          → Claude Sonnet
```

### Guaranteed Capacity

**Core principle**: At least 50% of the fleet (16+ agents) must always have actionable work, regardless of project state, blockers, or external dependencies.

This is achieved through **guaranteed workstreams** — work types that never exhaust because their source is infinite or self-renewing.

#### Workstream Types

| Type | Capacity | Example Sources | Exhaustible? |
|------|----------|-----------------|--------------|
| **guaranteed-infinite** | Infinite | arxiv daily papers, code quality audits | Never |
| **guaranteed-growing** | Grows over time | Re-analysis of completed experiments | Never (accumulates) |
| **maintenance** | Always has gaps | Test coverage, refactoring, documentation | Never |
| **project-bound** | Limited by project tasks | sample-style-project tasks | Can exhaust |
| **opportunistic** | Dynamic | Unclaimed tasks from any project | Can exhaust |

#### Guaranteed Work Sources

| Workstream | Source | Why It Never Exhausts |
|------------|--------|----------------------|
| Literature scan | arxiv, huggingface, papers-with-code | ~500 new papers/day across AI/ML |
| Infra maintenance | `infra/` codebase | Always has coverage gaps, bugs, refactoring opportunities |
| Self-evolution | Agent logs, session metrics | Infinite stream of failure patterns to analyze |
| Data re-analysis | Completed experiments | Every experiment can be re-examined; new experiments add to pool |
| Documentation | All markdown files | Docs are never complete; gaps grow with codebase |
| Code exploration | All code | Edge cases, anti-patterns, improvement opportunities never exhaust |

### Key Design Decisions

#### 1. Workstream Assignment (not task-level scheduling)

Each agent owns a workstream, not individual tasks. Workstreams are defined in `fleet/workstreams.yaml`:

```yaml
workstreams:
  # === GUARANTEED WORKSTREAMS (16 agents, 50% of fleet) ===
  - id: literature-arxiv
    type: guaranteed-infinite
    focus: "Scan arxiv cs.AI, cs.CL, cs.CV daily. Create literature notes for relevant papers."
    projects: [all]
    agents: 3
    
  - id: literature-huggingface
    type: guaranteed-infinite
    focus: "Monitor huggingface models/datasets. Evaluate relevance to youji projects."
    projects: [all]
    agents: 2
    
  - id: infra-health
    type: maintenance
    focus: "Monitor infra/, fix bugs, improve test coverage, refactor for clarity"
    projects: [youji]
    agents: 3
    
  - id: self-evolution
    type: guaranteed-infinite
    focus: "Analyze session logs, find failure patterns, propose prompt improvements"
    projects: [youji]
    agents: 2
    
  - id: data-reanalysis
    type: guaranteed-growing
    focus: "Re-examine completed experiments for missed insights, cross-correlations"
    projects: [all]
    agents: 2
    
  - id: documentation
    type: maintenance
    focus: "Update outdated docs, fill gaps, ensure all experiments have complete records"
    projects: [all]
    agents: 2
    
  - id: code-exploration
    type: guaranteed-infinite
    focus: "Audit code quality, find edge cases, suggest improvements across all projects"
    projects: [all]
    agents: 2
    
  # === PROJECT-BOUND WORKSTREAMS (12 agents, 37.5% of fleet) ===
  - id: sample-style
    type: project-bound
    focus: "Execute tasks in sample-style-project"
    projects: [sample-style-project]
    agents: 4
    
  - id: sample-research
    type: project-bound
    focus: "Execute tasks in sample-research-project"
    projects: [sample-research-project]
    agents: 4
    
  - id: other-projects
    type: project-bound
    focus: "Execute tasks in remaining active projects"
    projects: [youji-overview, other-projects...]
    agents: 4
    
  # === OPPORTUNISTIC WORKSTREAMS (4 agents, 12.5% of fleet) ===
  - id: opportunistic-0
    type: opportunistic
    focus: "Pick up any unblocked, unclaimed task from any project"
    projects: [all]
    agents: 2
    
  - id: opportunistic-1
    type: opportunistic
    focus: "Secondary opportunistic workstream for overflow"
    projects: [all]
    agents: 2
```

**Allocation strategy**:
- **50% (16 agents)** → Guaranteed workstreams (never block)
- **37.5% (12 agents)** → Project-bound workstreams (can exhaust)
- **12.5% (4 agents)** → Opportunistic workstreams (absorb overflow)

**Rationale**: Task-level assignment requires a central scheduler with complex conflict resolution. Workstream assignment pushes coordination to the human-defined partition — each workstream is naturally non-overlapping by design. Agents within the same workstream coordinate via git (standard serial execution per workstream).

#### 2. Dynamic Rebalancing

When workstreams exhaust or get blocked, the orchestrator automatically reassigns agents:

**Rebalance triggers:**
1. **Exhausted workstream** — No actionable tasks for 2 consecutive sessions
2. **Blocked workstream** — All tasks marked `[blocked-by: ...]` with no `[zero-resource]` alternatives
3. **Overloaded workstream** — Task queue exceeds threshold (e.g., 10+ tasks)

**Rebalance rules:**
1. Agents from exhausted project-bound workstreams → reassigned to guaranteed workstreams
2. Agents from blocked workstreams → reassigned to opportunistic or guaranteed workstreams
3. Guaranteed workstream agents → never reassigned (their work is infinite by design)
4. Minimum floor: 16 agents always on guaranteed workstreams (enforced)

**Rebalance protocol:**
```
1. Orchestrator detects exhausted/blocked workstream
2. Orchestrator selects target workstream from guaranteed pool (lowest agent count)
3. Agent completes current session, commits work
4. Orchestrator updates workstream assignment in fleet/workstreams.yaml
5. Agent restarts with new workstream config
6. Log entry in fleet/rebalance-log.md: "[rebalance] agent X moved from <old> to <new>"
```

**Self-healing for persistent exhaustion:**
- If a project-bound workstream is exhausted for 7+ days → Evolver agent evaluates: archive project, merge into another workstream, or flag for future attention
- No human notification — the fleet decides autonomously based on encoded heuristics

#### 3. Git Isolation via Fleet Branches + Staggered Merge Windows

Each agent works on a dedicated branch: `fleet/<workstream-id>/<session-id>`. Orchestrator manages merge windows:

- Every 15 minutes, orchestrator triggers merge for the next workstream in rotation
- Agent rebases onto `main`, runs tests, force-pushes branch, requests merge
- Merge conflict → agent attempts automated resolution (rebase, resolve, retry up to 3 times)
- Conflict unresolvable → agent logs to `fleet/conflicts/<session-id>.md`, abandons branch, starts fresh
- Merge succeeds → agent starts new session on fresh branch

**Conflict resolution strategy (self-healing):**
1. **Auto-rebase**: Agent rebases onto latest main
2. **Auto-resolve**: For known conflict patterns (e.g., concurrent TASKS.md edits), apply merge rules
3. **Branch abandonment**: If unresolved after 3 attempts, agent logs conflict details, discards branch, starts fresh
4. **Pattern learning**: Evolver analyzes conflict logs weekly, updates merge rules

**Conflict rate estimate**: With workstreams partitioned by project/concern, conflicts should be rare (<5% of merges). The primary overlap risk is in `infra/` (shared code), mitigated by having a single "infra-health" workstream.

#### 4. No Orient, No Compound (simplified for subagents)

Subagents run a reduced prompt cycle optimized for throughput:

- **No /orient**: Workstream assignment replaces orientation. Agent knows its scope from `workstreams.yaml`.
- **No /compound**: Learning synthesis happens at fleet level, not per-agent. A nightly "synthesizer" Claude session reads all completed experiments and produces cross-workstream findings.

Subagent prompt template:
```
WORKSTREAM: <id>
FOCUS: <focus text>
PROJECTS: <allowed projects>
MODE: continuous

Your task: Work on any unblocked task within your assigned projects. 
Commit incrementally. Push when done. If blocked, log to fleet/blocks/<session-id>.md 
and switch to an unblocked task in your workstream.
If you complete all tasks, scan for: (1) new tasks in TASKS.md, (2) opportunities 
to improve documentation, (3) gaps in test coverage.

Rules:
- Only modify files in assigned projects
- Never modify CLAUDE.md or decisions/ (governance files)
- Commit message must include: [fleet/<workstream-id>]
- Never wait for human input — always proceed with available work
```

#### 5. Budget Enforcement at Fleet Level

Individual subagents have no budget awareness. The orchestrator enforces global caps:

```yaml
fleet_budget:
  max_concurrent_gpu_inference: 32  # All 32 can call GLM-5
  max_concurrent_external_api: 8    # Limit external API calls (3D generation, etc.)
  max_daily_claude_calls: 100       # Reserved for synthesizer + approvals
```

Resource-heavy operations (experiments calling external APIs) require workstream-level opt-in:

```yaml
workstreams:
  - id: sample-style-project
    type: project
    allows_external_api: true
```

The orchestrator gates API calls via a distributed semaphore (Redis-based). Agents exceeding limits block until capacity available.

#### 6. Mixed Fleet: opencode + Claude (for synthesis and evolution)

The 32-agent fleet is opencode-only for throughput. Two Claude-based agents run in parallel:

1. **Synthesizer** (1x Claude Opus, nightly): Reads all completed experiments from past 24h, produces `SYNTHESIS.md` in each project, updates cross-project patterns.
2. **Evolver** (1x Claude Sonnet, continuous): Handles self-governance — evaluates approval requests, manages rebalancing heuristics, updates fleet configuration, learns from failure patterns.

#### 7. Health Monitoring and Self-Healing

Orchestrator tracks per-agent metrics:
- Sessions completed per day
- Average session duration
- Error rate (git conflicts, API failures, sleep violations)
- Findings produced (count of new files in `experiments/`, `decisions/`, `literature/`)

**Self-healing actions:**

| Condition | Action | Escalation |
|-----------|--------|------------|
| Error rate > 20% over 10 sessions | Restart agent with fresh context | Log to `fleet/health/` |
| Error rate > 40% over 10 sessions | Reassign to guaranteed workstream | Evolver analyzes root cause |
| Agent unresponsive > 5 min | Kill and restart | Log incident |
| 3+ consecutive restart failures | Quarantine agent slot | Evolver investigates |

**No human escalation path** — all incidents are logged to `fleet/incidents/` for post-hoc analysis. The fleet heals itself.

#### 8. Self-Governance (Autonomous Approvals)

APPROVAL_QUEUE.md is eliminated. The fleet governs itself through encoded rules evaluated by the Evolver agent:

**Governance rules (encoded in `fleet/governance.yaml`):**

```yaml
approvals:
  budget_increase:
    rule: "Allow if requested increase < 20% of current limit AND total < fleet_budget.max_project_budget"
    auto_approve: true
    
  budget_increase_large:
    rule: "Allow if requested increase < 50% AND project has < 2 prior increases this month"
    auto_approve: true
    
  budget_decrease:
    rule: "Always allow (conservative choice)"
    auto_approve: true
    
  governance_change:
    rule: "Never auto-approve. Log to fleet/governance/pending.md for weekly Evolver review"
    auto_approve: false
    
  production_pr:
    rule: "Allow if: (1) all tests pass, (2) no CLAUDE.md changes, (3) changes limited to single module"
    auto_approve: true
    conditions: ["tests_pass", "no_governance_changes", "single_module"]
    
  production_pr_risky:
    rule: "Never auto-approve. Create branch, run validation, log to fleet/governance/pending.md"
    auto_approve: false
```

**Evolver responsibilities:**
- Evaluates approval requests against governance rules
- Logs all decisions to `fleet/governance/decisions.md` with rationale
- Updates governance rules based on outcomes (reinforcement learning from fleet metrics)
- Runs weekly governance audit, adjusts rules if fleet health degrades

**Safety bounds (hard-coded, not modifiable by fleet):**
- Never approve changes to `fleet/governance.yaml` itself (requires external override file)
- Never exceed `fleet_budget.max_total_spend` (hard limit)
- Never allow subagents to modify `CLAUDE.md` or `decisions/` (governance files)

#### 9. Self-Evolution (Continuous Improvement)

The fleet improves itself without human guidance through three mechanisms:

**A. Prompt Evolution**
- Evolver analyzes session logs weekly for failure patterns
- Identifies common mistakes (convention violations, repeated errors)
- Proposes prompt modifications to `fleet/prompts/<workstream>.md`
- Tests changes on single agent, rolls out if metrics improve

**B. Rule Evolution**
- Evolver tracks outcomes of governance decisions
- Rules that lead to negative outcomes (budget overruns, conflicts) are tightened
- Rules that lead to positive outcomes (high throughput, clean merges) are relaxed
- Changes logged to `fleet/evolution/changelog.md`

**C. Architecture Evolution**
- Evolver monitors fleet-wide metrics: throughput, error rate, conflict rate
- Proposes structural changes: workstream rebalancing, new workstream types, allocation shifts
- High-impact changes require simulation in `fleet/sandbox/` before rollout

**Evolution safeguards:**
- All changes logged with before/after metrics
- Rollback capability: last 10 prompt/rule versions preserved
- Mutation rate limit: max 10% of rules can change per week

### Integration with Existing Scheduler

The fleet orchestrator extends (not replaces) the current scheduler:

```
Current: scheduler.ts → executor.ts → spawnAgent() [serialized, 1 at a time]

Proposed:
  scheduler.ts → fleet-orchestrator.ts
                      │
                      ├──→ spawnAgent() × 32 [parallel opencode]
                      │
                      └──→ spawnAgent() × 2 [Claude for synthesis/approvals]
```

Key changes:
1. **fleet-orchestrator.ts**: New module managing workstream assignment, merge windows, health monitoring
2. **executor.ts**: Modified to accept fleet mode (parallel spawns) vs legacy mode (serialized)
3. **backend.ts**: No changes — fleet uses same backend abstraction
4. **agent.ts**: No changes — same spawnAgent function, same profiles

### Implementation Phases

**Phase 1: Single Agent Pilot (1 week)**
- Implement orchestrator skeleton
- Run 1 opencode agent on a guaranteed workstream (literature-arxiv or infra-health)
- Validate git workflow, measure conflict rate
- Implement basic self-healing (restart on error, branch abandonment on conflict)
- Success metric: 5+ sessions/day with clean merges

**Phase 2: 4-Agent Fleet (2 weeks)**
- Expand to 4 agents: 2 on guaranteed workstreams, 2 on project-bound
- Implement staggered merge windows
- Add Redis-based API semaphore
- Implement basic rebalancing (exhausted → guaranteed)
- Add governance.yaml with basic approval rules
- Implement conflict auto-resolution (rebase + known patterns)
- Success metric: 20+ sessions/day, <10% conflict rate, rebalancing works, 0 human interventions

**Phase 3: Full 32-Agent Fleet (4 weeks)**
- Scale to 32 agents with full workstream allocation (16 guaranteed, 12 project-bound, 4 opportunistic)
- Add Synthesizer and Evolver agents
- Implement full rebalancing logic and health monitoring
- Implement self-evolution: prompt analysis, rule tuning, architecture monitoring
- Remove all human escalation paths
- Success metric: 100+ sessions/day, stable operation for 1 week, zero idle agents, zero human interventions

---

## Consequences

**Positive:**
- 32x increase in youji's throughput at zero marginal API cost
- Continuous progress on all projects, not just the currently-active one
- **Fully autonomous operation** — no human bottleneck for approvals, rebalancing, or incident response
- Fleet-level metrics provide new visibility into youji's operation
- **Guaranteed capacity**: 50% of fleet always productive regardless of project blockers
- **Self-healing**: Fleet recovers from failures without human intervention
- **Self-governing**: Fleet makes decisions within encoded safety bounds
- **Self-evolving**: Fleet improves prompts, rules, and architecture over time

**Negative:**
- Higher git activity requires robust merge workflow
- Risk of incoherent knowledge output if workstreams poorly defined
- Initial orchestration complexity is significant
- Subagent output quality lower than Claude (requires synthesis layer)
- **No human safety net** — if governance rules are wrong, fleet makes bad decisions at scale
- Self-evolution could converge on local optima or exploit loopholes
- Debugging fleet behavior requires reading logs, not asking a human

**Open Questions:**
1. How to harden governance rules against adversarial self-modification?
2. How to handle cross-workstream dependencies (e.g., infra changes that affect all projects)?
3. What's the failure mode when GLM-5 GPU cluster has downtime?
4. Should self-evolution have an external audit mechanism (human-readable report generated periodically)?

---

## Migration

1. Create `infra/fleet/` directory with orchestrator, workstream definitions, and health monitor
2. Extend `infra/scheduler/` with fleet-aware job spawning (multiple concurrent jobs)
3. Add `fleet/workstreams.yaml` configuration file with guaranteed workstream definitions
4. Implement Redis-backed API semaphore in `infra/fleet/semaphore.ts`
5. Implement dynamic rebalancing logic in `infra/fleet/rebalancer.ts`
6. Create `fleet/governance.yaml` with approval rules and safety bounds
7. Implement Evolver agent in `infra/fleet/evolver.ts` for self-governance and self-evolution
8. Create `fleet/incidents/` directory for incident logging (no human escalation)
9. Create `fleet/evolution/` directory for evolution changelog and rule history
10. Update CLAUDE.md with fleet-aware conventions (e.g., `[fleet/<workstream>]` commit prefix)
11. Remove APPROVAL_QUEUE.md references — fleet governs autonomously

---

## References

- ADR 0005: Autonomous execution baseline
- ADR 0010: Unified Agent Architecture
- ADR 0037: Multi-agent support with fallback chain
- `infra/scheduler/src/agent.ts`: Agent profiles and backend overrides
- `infra/scheduler/src/executor.ts`: Session execution with git safety
- `infra/scheduler/src/backend.ts`: Backend abstraction layer
