# 0062: Skill-Typed Organization — Benchmark-Informed Agent Routing

Date: 2026-03-05
Status: accepted
Extends: 0042-v2 (Persistent Subagent Fleet)
Evidence:
- `projects/sample-benchmark/analysis/benchmark-implications-for-agentic-organization-2026-03-05.md`
- `projects/youji/analysis/glm-utilization-maximization-2026-03-05.md`
- `projects/youji/diagnosis/diagnosis-fleet-idle-exploration-zero-knowledge-2026-03-03.md`
- `projects/youji/diagnosis/diagnosis-fleet-starvation-all-blocked-2026-03-04.md`

## Context

ADR 0042-v2 established youji's fleet architecture: 1 Opus supervisor + up to 32 GLM-5
workers, with binary task classification (`[fleet-eligible]` vs `[requires-opus]`). This
architecture has been operationally validated — 2,700+ sessions, 99.6% success rate at
N=8, push queuing for git safety at scale.

A sample benchmark (the framework's benchmark of 8 frontier LLMs across 7 research skills) has now
produced empirical evidence that the current binary classification leaves significant
value on the table. Three findings are directly actionable:

**Finding 1: Three-factor independence.** Agent capabilities cluster into three
orthogonal factors — Analytical Reasoning (ORIENT, DIAGNOSE, ANALYZE, GOVERN),
Implementation (EXECUTE), and Knowledge Management (RECORD, PERSIST). A model's
score on one factor tells you almost nothing about its score on another (ρ ≈ 0).

**Finding 2: GLM-5's capability profile is extremely lopsided.** GLM-5 scores 83.6%
on RECORD and 84.6% on PERSIST (within 1pp of Opus on knowledge management), but
only 41.5% on EXECUTE — a 42pp within-model gap, the largest in the benchmark. The
current fleet sends GLM-5 every `[fleet-eligible]` task regardless of whether it
requires implementation, knowledge management, or analysis.

**Finding 3: Skill-based routing outperforms model-homogeneous assignment.** Because
the three factors are independent, routing tasks to the cheapest model that exceeds
a quality threshold on the required skill produces better outcomes at lower cost than
assigning all tasks to a single model — even the best one.

The practical consequence: every GLM-5 session spent on an EXECUTE task (code changes,
script writing, infrastructure) has a ~58% failure probability. At N=16 with mixed
task types, this wastes approximately 30-40% of zero-cost fleet capacity on tasks
GLM-5 is empirically unsuited for.

**Operational evidence reinforces the benchmark findings.** Fleet utilization data
(97 hours, 2,143 sessions at N=16) reveals a deeper structural problem beyond routing:

- **Measured utilization: 10.8%** — 16 worker slots averaging 1.7 active workers
- **76.7% of all tasks are blocked** by external dependencies or task chains, leaving
  only 7 unblocked fleet-eligible tasks for 16 workers at any given time
- **48% of requires-opus tasks are misclassified** — 16 of 33 are mechanical work
  that GLM-5 could handle, artificially shrinking the fleet-eligible pool
- **Idle exploration produces near-zero knowledge** — 94/95 idle sessions in a
  3-hour sample produced zero output; stale-blocker-check (7% success), self-audit
  (0%), and open-question (5%) are structurally impossible for GLM-5
- **Task supply is the binding constraint** — the Opus supervisor creates 2-5
  tasks per 30-minute session; 16 workers can consume 6-10 tasks/hour. Production
  rate cannot sustain consumption rate.

This operational data shows that skill-typed routing alone is necessary but not
sufficient. The system also needs a **task supply chain** that keeps the fleet-eligible
pool deep enough to sustain continuous GLM-5 utilization.

## Decision

### Skill-Typed Task Classification

Replace the binary `[fleet-eligible]`/`[requires-opus]` system with skill-typed tags
that classify tasks by the dominant capability they require:

```
[skill: record]    → Knowledge management: documentation, status updates, archival
[skill: persist]   → State management: cross-references, inventories, monitoring
[skill: govern]    → Convention compliance: self-audits, tag validation, formatting
[skill: execute]   → Implementation: code changes, scripts, bug fixes, tests
[skill: diagnose]  → Root cause analysis: debugging, failure investigation
[skill: analyze]   → Interpretation: experiment results, cross-project synthesis
[skill: orient]    → Strategic: task selection, priority assessment, planning
[skill: multi]     → Multi-factor: requires reasoning + implementation + knowledge
```

**Backward compatibility:**
- `[fleet-eligible]` → treated as `[skill: record]` (most fleet tasks are knowledge work)
- `[requires-opus]` → treated as `[skill: multi]` (Opus handles multi-factor tasks)
- Both old tags remain valid and continue to work. Skill tags are additive.

The scheduler routes tasks to the optimal model tier based on skill type:

| Skill type | Worker role | Model tier | Cost |
|------------|------------|------------|------|
| record, persist, govern | Knowledge worker | GLM-5 | $0 (self-hosted) |
| execute | Implementation worker | Best available* | Varies |
| diagnose, analyze, orient, multi | Reasoning worker | Opus | API cost |

*Implementation worker: currently falls through to Opus supervisor. When GPT-5.2,
Composer, or Gemini arrive on the opencode backend (PI directive, Stage 2-3), EXECUTE
tasks route to those models at lower cost than Opus.

### Three Worker Roles

The fleet evolves from a homogeneous pool of "fleet workers" to three specialized roles
with distinct prompts, constraints, and success criteria:

**Knowledge Workers (GLM-5, zero cost)** — tasks requiring RECORD, PERSIST, GOVERN:

These are GLM-5's empirically strongest capabilities (83-85% on the sample benchmark, within
1pp of Opus). Knowledge workers handle:
- Documentation: README updates, log entries, status docs, paper consistency checks
- Convention enforcement: self-audits, cross-reference verification, tag validation
- Archival: log entry archival, completed task archival, branch cleanup
- Monitoring: stale blocker checks, experiment status tracking, external blocker inventory
- Literature: horizon scans, literature note creation, citation verification
- Task curation: surfacing recommendations, compiling reports, decomposing blocked tasks

Knowledge workers receive a stripped-down prompt emphasizing conventions, state management,
and documentation quality. They do NOT receive code-focused tool guidance.

**Implementation Workers (GPT-5.2/Composer/Gemini/Cursor, when available)** — EXECUTE tasks:

These models score 85-87% on EXECUTE in the sample benchmark (vs GLM-5's 41.5%). Until they arrive
on the opencode backend, EXECUTE tasks route to the Opus supervisor or Cursor sessions.
Implementation workers handle:
- Code changes: bug fixes, feature implementation, refactoring
- Script creation: analysis scripts, experiment scripts, data processing
- Test writing: unit tests, integration tests
- Infrastructure: scheduler changes, new modules, configuration
- Experiment code: writing experiment runners, experiment harnesses

Implementation workers receive a code-focused prompt emphasizing tool use, error recovery,
and test verification. They are expected to produce commits with passing tests.

**Reasoning Workers (Opus, single slot)** — DIAGNOSE, ANALYZE, ORIENT, MULTI tasks:

The existing Opus supervisor, with its role sharpened. Instead of executing arbitrary
tasks, the Opus supervisor focuses on:
- ORIENT: strategic task selection and priority assessment
- DIAGNOSE: root cause analysis (highest-variance skill, needs most capable model)
- ANALYZE: experiment result interpretation, cross-project synthesis
- Task classification: classifying untagged tasks into skill types
- Task decomposition: breaking complex tasks into knowledge + implementation subtasks
- Quality review: spot-checking implementation worker output (not knowledge worker output)
- Governance: processing approvals, budget decisions, convention evolution

This concentrates Opus's scarce capacity on high-leverage decisions where the model
quality differential is largest (ORIENT: 14.2pp spread, DIAGNOSE: 20.2pp spread).

### Knowledge Engine Mode

ADR 0048 introduced idle exploration as a fallback when the task queue is empty.
**Operational data shows this fallback has failed.** Over 200 fleet sessions:

| Exploration Type | Sessions | Zero-Knowledge Rate | Avg Turns |
|------------------|----------|---------------------|-----------|
| horizon-scan | 24 | 75% | 7.3 |
| task (none) | 74 | 68% | 4.2 |
| open-question | 39 | 95% | 3.3 |
| stale-blocker-check | 45 | 93% | 2.4 |
| self-audit | 6 | 100% | 2.2 |

Source: `projects/youji/diagnosis/diagnosis-fleet-idle-exploration-zero-knowledge-2026-03-03.md`

Root causes: stale-blocker-check requires verifying external conditions GLM-5 cannot
access (Slack messages, API endpoints). Self-audit finds nothing because conventions
are already well-maintained. Open-question requires synthesis capacity GLM-5 lacks.
The low turn counts (2-3 turns) show GLM-5 recognizes it cannot complete the task and
exits immediately — correct behavior, but it means the session slot was wasted.

The skill-typed system replaces this failing idle exploration with **knowledge engine
mode** — proactively curating the knowledge base using GLM-5's empirically strongest
capabilities (RECORD 83.6%, PERSIST 84.6%):

1. **Cross-reference verification**: Check that experiment findings are reflected in
   project READMEs and cross-referenced correctly. GLM-5 reads EXPERIMENT.md files
   and verifies summaries match — a pure RECORD/PERSIST task.
2. **Convention enforcement**: Scan recent commits for convention violations (task
   tags, log format, provenance). A GOVERN task where GLM-5 scores 73.6%.
3. **Documentation coherence**: Ensure READMEs, status docs, and decision records
   reflect actual project state (status, done-when, open questions).
4. **Directed literature search**: Horizon scans targeted at specific project open
   questions (not generic arxiv crawls). The one idle type that works — horizon-scan
   has a 25% success rate, the highest of any idle exploration type.

The key design change: knowledge engine tasks have shorter cooldowns (30 min vs 2-6h)
and higher weights than legacy idle exploration types. Types with <10% success rate
(self-audit, stale-blocker-check for external blockers, open-question) are restricted
to Opus or disabled entirely.

The idle capacity principle (ADR 0042-v2) still applies: knowledge engine work must
produce genuine value. "Commit if valuable, empty session if not" discipline is preserved.
But the work itself is now matched to GLM-5's capability profile rather than assigned
generically.

### Task Supply Chain

Skill-typed routing improves task-worker matching, but operational data reveals that
routing is only half the problem. With 76.7% of tasks blocked and the Opus supervisor
creating only 2-5 tasks per 30-minute session, the fleet-eligible pool drains faster
than it refills. Three mechanisms address the supply-side bottleneck:

**Opus as Task Factory.** The Opus supervisor's primary value-add shifts from executing
tasks to producing them. During /orient, the supervisor scans all projects for
decomposition opportunities and creates fleet-eligible subtasks. Target: every orient
session produces at least 10 new fleet-eligible tasks. This is a convention change
(free, immediate impact).

Rationale: Opus's comparative advantage is decomposition and judgment (ORIENT at 81.6%,
highest discriminability). GLM-5's is knowledge execution (RECORD 83.6%, PERSIST 84.6%).
Opus spending 10 minutes creating 10 tasks that each take GLM-5 5 minutes to execute
converts 10 minutes of Opus time into 50 agent-minutes of GLM work — a 5× leverage
multiplier.

**GLM Self-Generating Follow-ups.** After completing a task, fleet workers may create
1-2 fleet-eligible follow-up tasks when they discover adjacent mechanical work. This
makes task supply partially self-sustaining: GLM work generates GLM work. The fleet
prompt adds: "If you discover adjacent mechanical work while completing your task,
create up to 2 new fleet-eligible tasks in TASKS.md."

Constraint: follow-up tasks must be tagged `[fleet-eligible]` with a clear done-when
condition. Workers cannot create `[requires-opus]` tasks or tasks outside their current
project scope.

**Proactive Recurring Tasks.** The scheduler generates recurring maintenance tasks as
a guaranteed baseline of fleet-eligible work:

- Weekly: "Verify all project README status fields are current" (RECORD)
- Weekly: "Check for orphaned experiment directories without EXPERIMENT.md" (PERSIST)
- Weekly: "Audit task tags for consistency across all projects" (GOVERN)
- Daily: "Summarize yesterday's fleet session outcomes" (RECORD)

These always-available tasks keep GLM workers productively busy during task droughts,
replacing the low-value idle exploration that produces zero knowledge 93-100% of the
time for most exploration types. Combined, these mechanisms target a steady-state of
≥N unblocked fleet-eligible tasks (matching fleet size), up from the current 7.

**Blocker Chain Depth Limit.** Blocked tasks compound the supply problem: task A
blocks B blocks C blocks D — a 4-deep chain where completing A unblocks only one task.
Convention: avoid blocker chains deeper than 2. When creating tasks, prefer parallel
independent tasks over serial chains. If task C depends on A and B, and B depends on A,
restructure so C depends only on B (not transitively on A).

### Auto-Classification Heuristics

To reduce the manual tagging burden, the scheduler auto-classifies untagged tasks using
text heuristics:

```
RECORD indicators:  "update", "document", "write log", "archive", "move to",
                    "add to README", "refresh", "format", "consistency check"
PERSIST indicators: "cross-reference", "check status", "monitor", "inventory",
                    "report on", "compile", "list", "summarize existing"
GOVERN indicators:  "compliance", "convention", "validate tags", "audit"
EXECUTE indicators: "implement", "write script", "fix bug", "add feature",
                    "write function", "refactor code", "write test", "modify"
DIAGNOSE indicators: "diagnose", "root cause", "investigate", "debug",
                     "why did", "failure analysis", "troubleshoot"
ANALYZE indicators:  "analyze results", "interpret", "synthesize",
                     "compare findings", "evaluate", "review findings"
```

When multiple indicators match, the highest-cost skill wins (DIAGNOSE > ANALYZE >
EXECUTE > GOVERN > PERSIST > RECORD). This errs on the side of routing to more
capable models, which is the safer failure mode.

Auto-classification is a heuristic, not a guarantee. The Opus supervisor refines
classifications during its /orient step when it notices misrouted tasks.

### Cross-Model Verification

The sample benchmark found self-evaluation bias (Opus +5.3pp, GPT-5.2 +3.8pp on own outputs).
The skill-typed system introduces targeted cross-model verification:

1. **Knowledge worker → knowledge worker**: GLM-5 peer-reviews another GLM-5's
   knowledge output (convention compliance check). Zero cost, leverages GLM-5's
   strongest skill to verify its own class of work.

2. **Implementation worker → Opus**: Opus spot-checks implementation output during
   /compound. Focuses on code correctness, test coverage, behavioral changes —
   the high-value verification that only the reasoning tier can provide.

3. **Reasoning worker → mechanical verification**: Opus output is verified by
   "done when" conditions (file exists, test passes, number matches). This is
   the cheapest verification because it's automated.

This replaces the current model where Opus audits all fleet output equally. Instead,
verification effort is proportional to the risk: implementation work (highest failure
rate) gets the most expensive verification; knowledge work (highest success rate)
gets the cheapest.

### What This Changes vs. ADR 0042-v2

| Dimension | ADR 0042-v2 | This proposal |
|-----------|-------------|---------------|
| Task classification | Binary (fleet-eligible / requires-opus) | Skill-typed (7 skills → 3 worker roles) |
| Worker prompt | One prompt for all fleet workers | Role-specific prompts (knowledge / implementation / reasoning) |
| GLM-5's role | General-purpose fleet worker | Knowledge management specialist |
| Idle capacity | Idle exploration (ADR 0048) as fallback | Knowledge engine as primary mode |
| Opus's execution role | Executes any [requires-opus] task | Task factory + ORIENT/DIAGNOSE (10+ fleet tasks per orient) |
| Task production | Opus creates tasks as side-effect of /orient | Explicit task supply chain: Opus factory + GLM follow-ups + recurring tasks |
| Verification | Opus audits all fleet output | Cross-model: peer review for knowledge, Opus for implementation |
| Multi-model readiness | "Future consideration" | Explicit routing matrix with model capability profiles |
| Blocker management | No chain depth guidance | Max depth 2; prefer parallel over serial task chains |

### What This Does NOT Change

1. **Supervisor schedule** — Opus runs every 30 min, single slot (unchanged)
2. **Task lifecycle** — TASKS.md based, task claims, done-when conditions (unchanged)
3. **Git strategy** — rebase-push with push queue (unchanged)
4. **Governance** — APPROVAL_QUEUE.md, human-set budgets, production PR gates (unchanged)
5. **Project structure** — self-contained project directories (unchanged)
6. **Artifact-mediated coordination** — repo-as-shared-brain (validated by sample benchmark F3)
7. **Fire-and-forget execution** — workers complete and exit, no babysitting (unchanged)

### Phased Rollout

**Phase 1a: Skill Tags + Knowledge Worker Prompts (immediate, GLM-5 only)**
- Add `[skill: ...]` tag parsing to `fleet-tasks.ts`
- Add knowledge worker prompt template to `fleet-prompt.ts`
- Update `CLAUDE.md` task lifecycle with skill tag definitions
- Backward compatibility: existing `[fleet-eligible]` maps to knowledge worker
- Add auto-classification heuristics to `fleet-tasks.ts`
- Reclassify ~16 misclassified `[requires-opus]` tasks that are mechanical work
- Metric: GLM-5 task completion rate on knowledge tasks should exceed 85%

**Phase 1b: Task Supply Chain (immediate, convention + prompt changes)**
- Update /orient skill: Opus scans all projects for decomposition, creates 10+
  fleet-eligible subtasks per session
- Update fleet prompt: GLM workers create 1-2 follow-up fleet-eligible tasks when
  discovering adjacent work
- Convention: blocker chain depth ≤ 2; prefer parallel independent tasks
- Replace failing idle exploration types (self-audit 0%, stale-blocker-check 7%,
  open-question 5%) with knowledge engine tasks
- Metric: steady-state unblocked fleet-eligible task count ≥ fleet size (N)

**Phase 1c: Knowledge Engine Mode (code change, idle-tasks.ts)**
- Add knowledge-engine exploration types: cross-reference verification, convention
  enforcement, documentation coherence
- Restrict stale-blocker-check to mechanically verifiable blockers (date, file existence)
- Disable self-audit for GLM-5 workers (0% success rate)
- Set knowledge-engine cooldowns to 30 min (vs 2-6h for legacy idle types)
- Add proactive recurring tasks (weekly: README audit, experiment inventory, tag audit;
  daily: fleet session summary)
- Metric: idle exploration zero-knowledge rate drops from 68-100% to <40%

**Phase 2: Implementation Worker Routing (when models arrive on opencode)**
- Add model capability matrix to scheduler
- Route `[skill: execute]` to implementation-tier models (GPT-5.2, Composer, Gemini)
- Add implementation worker prompt template
- Target distribution: GLM 60-70% of sessions, implementation model 20-30%, Opus 5-10%
- Metric: implementation task completion rate >80% on capable models

**Phase 3: Verification Circuit + Dynamic Routing (after Phase 2)**
- Add cross-model verification in fleet-executor.ts post-session checks
- Track per-skill, per-model quality metrics
- Dynamic routing based on empirical success rates (not just benchmark profiles)
- Utilization-aware fleet sizing: auto-alert when rolling 1h utilization <25%
- Metric: overall escalation rate <10%, fleet utilization >50%

## Consequences

### Positive

- **Higher GLM-5 success rate**: Routing GLM-5 to knowledge tasks (83-85% capability)
  instead of mixed tasks (including 41.5% EXECUTE) should increase fleet success rate
  from ~70% to ~85% on routed tasks.
- **Better use of free capacity**: GLM-5's zero-cost capacity is spent on tasks it
  excels at, not wasted on tasks it fails at.
- **Reduced escalation rate**: Fewer EXECUTE tasks misrouted to GLM-5 means fewer
  escalations to the Opus supervisor.
- **Higher Opus leverage**: Opus shifts from executing tasks to producing them. Creating
  10+ fleet tasks per orient session converts 10 min of Opus time into 50+ agent-minutes
  of GLM work — a 5× leverage multiplier.
- **Self-sustaining task supply**: GLM follow-up task creation and proactive recurring
  tasks reduce dependency on the single Opus supervisor for task production.
- **Idle exploration waste eliminated**: Replacing failing idle types (0-7% success)
  with knowledge engine tasks matched to GLM-5's capabilities should eliminate the
  94/95 zero-knowledge-output pattern observed in operational data.
- **Multi-model ready**: When GPT-5.2/Composer/Gemini arrive, the routing infrastructure
  is already in place — just add model profiles to the capability matrix.
- **Empirically grounded**: Design derived from youji's own benchmark data AND
  operational fleet metrics, not intuition.
- **Backward compatible**: Existing task tags continue to work. Migration is gradual.

### Negative

- **Classification accuracy**: Auto-classification heuristics will misclassify some
  tasks. Mitigation: conservative heuristics (route to more capable tier when uncertain),
  Opus refines during /orient.
- **EXECUTE task bottleneck**: Until implementation-tier models arrive on opencode,
  EXECUTE tasks queue for the scarce Opus slot. Mitigation: Opus supervisor actively
  decomposes EXECUTE tasks into knowledge + implementation subtasks when possible.
  Example: "Write analysis script" → (knowledge: create EXPERIMENT.md) + (implementation:
  write the script). The knowledge subtask proceeds immediately on GLM-5.
- **Task inflation risk**: GLM follow-up creation and Opus's 10+ target could
  generate low-value tasks that pollute TASKS.md. Mitigation: follow-ups must have
  clear done-when conditions; Opus reviews task quality during /orient.
- **Additional prompt maintenance**: Three prompt templates instead of one. Mitigation:
  prompts share a common base with role-specific additions.
- **Metrics complexity**: Per-skill, per-model metrics require more tracking. Mitigation:
  existing fleet-status.ts infrastructure extends naturally.

### Risk Matrix

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Auto-classification misroutes tasks | Medium | Low | Conservative heuristic, Opus refinement |
| EXECUTE tasks starve without implementation tier | Medium | Medium | Opus handles; active decomposition |
| Task inflation from GLM follow-ups | Medium | Low | Done-when requirement, Opus review |
| Knowledge engine mode produces busywork | Low | Medium | Same "commit if valuable" discipline as ADR 0042-v2 |
| Opus task factory convention not followed | Medium | Medium | Track tasks-created-per-orient metric |
| Knowledge worker prompt too narrow | Low | Low | Iterative prompt refinement |
| Transition period confusion (old + new tags) | Low | Low | Full backward compatibility |
| Benchmark profiles don't generalize to real tasks | Low | Medium | Phase 1 measures empirical rates, adjusts |
| Blocker chain depth limit creates awkward decompositions | Low | Low | Guideline, not hard rule |

## Open Questions

1. **What is the optimal auto-classification confidence threshold?** Below what
   confidence should the scheduler defer to Opus for classification?

2. ~~**Should knowledge engine mode have a daily knowledge production target?**~~
   **Resolved:** Operational data (94/95 idle sessions producing zero output) shows
   the problem is not missing targets but mismatched task types. Knowledge engine mode
   addresses this by matching tasks to GLM-5's capability profile. A fixed target
   risks the busy-work problem ADR 0042-v2 warns against. Instead, the metric is
   zero-knowledge rate: target <40% (down from 68-100%).

3. **When implementation-tier models arrive, what is the cost ceiling per EXECUTE
   task?** GLM-5 is free but bad at EXECUTE. GPT-5.2 is good but costs money.
   The breakeven depends on the value of a completed EXECUTE task vs. the cost.

4. **Does per-skill routing reduce the task decomposition burden?** Currently Opus
   must decompose complex tasks into fleet-sized subtasks. If the scheduler routes
   by skill, can tasks stay larger (e.g., "analyze and document results" = ANALYZE
   component for Opus + RECORD component for GLM-5)?

5. **Should the capability matrix be static (from benchmark) or dynamic (learned
   from fleet metrics)?** Static is simpler but may not generalize. Dynamic adapts
   but requires statistical significance per model-skill pair.

6. **What is the optimal Opus task-creation-to-execution ratio?** With the "Opus as
   task factory" convention, the supervisor must balance between creating tasks for
   the fleet and executing its own ORIENT/DIAGNOSE tasks. If Opus spends all its time
   creating tasks, strategic decisions are delayed. If it spends too little, the fleet
   starves. The right ratio likely depends on current fleet utilization — create more
   tasks when utilization is low, execute more when utilization is high.

7. **Can GLM follow-up task quality be verified cheaply?** GLM-5 workers creating
   follow-up tasks introduces a task quality risk. Low-quality tasks waste fleet
   capacity. Options: Opus reviews during /orient (current plan), or another GLM-5
   worker peer-reviews the task description (zero cost, leverages GOVERN skill).
