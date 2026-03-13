# youji: Meta-Project for Self-Improvement

Status: active
Mission: Study and improve the Youji autonomous research system itself.
Done when: The system demonstrates self-directed capability improvement by identifying gaps from operational data, implementing changes, and measuring whether autonomy and knowledge output improve over time.

## Context

Youji's core idea is that the research system should study itself.

This project is the meta-project for Youji. Its subject is not an external benchmark or domain problem. Its subject is the behavior of the autonomous system itself: how sessions execute, where they fail, how human intervention changes over time, and which infrastructure or convention changes actually improve performance.

Youji operates as a single-researcher companion invoked via `claude -p` on a cron schedule. Each session is stateless — the repo is the only persistent memory. This meta-project treats that operational loop as a research object: measuring session quality, convention compliance, self-improvement loops, and the system's ability to compound its own capabilities.

The artifacts here are adapted from the OpenAkari meta-project patterns. They serve as both starting templates and examples of what it looks like when an AI-native software system treats its own operations as a research object.

## Log

### 2026-03-14

Initialized the youji meta-project from OpenAkari patterns. Created project README, task list, self-improvement measurement plan, 7 design pattern documents (repo-as-cognitive-state, autonomous-execution, skills-architecture, inline-logging, layered-budget-enforcement, gravity-driven-migration, structured-work-records), and 2 example artifacts (human-intervention-rate analysis, self-observation diagnosis). Adapted all references from akari/OpenAkari to Youji's context, removed fleet-specific and multi-backend references, updated for single-researcher + `claude -p` operation.

### 2026-03-14 (session 2)

Ran first self-audit (compliance-audit-2026-03-14.md). 6/8 checks passing. Two violations:
(1) infra-only commits had no project log entry — structural gap; (2) monolithic init commit
accepted as bootstrapping exception. Committed orphaned output-capture scheduler changes from
prior session. Identified convention gap: infra changes must log to projects/youji/README.md.
Sources: git log, compliance-audit-2026-03-14.md

### 2026-03-14 (session 3)

Completed both high-priority tasks. (1) Documented infra-only session logging convention in
session-discipline.md — closes the structural gap from the first self-audit. (2) Grounded
self-improvement measurement plan with 5 concrete metrics (M1: Convention Compliance at 75%,
M2: Gap Detection at 0.75/session, M3: Gap Closure at 50-100%, M4: Human Intervention at
0.0/session, M5: System Learning at 1.0/session), each with explicit data sources, computation
formulas, and baselines from the first 4 sessions. All metrics piggyback on self-audit — no
separate collection infrastructure needed. This session itself demonstrates a mini self-improvement
loop: self-audit detected gap → task created → convention fixed → measurement plan grounded.
Sources: session-discipline.md, plans/self-improvement-measurement.md, TASKS.md

### 2026-03-14 (session 4)

Completed all 3 remaining meta-project tasks in a single autonomous session. (1) Measured human
intervention rate (M4): 0.33/session overall, driven by a single critical infrastructure bug (stdin
blocking). Trend: 1.0 pre-fix to 0.0 post-fix — zero task-level interventions needed.
(2) Documented first complete self-improvement loop: self-audit detected infra-logging convention gap
-> task created -> convention fixed -> verified in subsequent sessions. 4-stage loop, zero human
intervention. (3) Diagnosed orphaned commit attribution loss: 40% of git history (273 lines) carried
generic auto-commit messages, traced to interactive sessions not committing incrementally. Proposed
3 fixes with monitoring follow-up task. Compound step updated M4 measurement plan with git author
caveat.
Sources: findings/human-intervention-rate-2026-03-14.md, findings/self-improvement-loop-001-infra-logging.md, diagnosis/orphaned-commit-attribution-loss.md, plans/self-improvement-measurement.md

### 2026-03-14 (session 5)

Ran second measurement cycle (cycle 002) to produce first trend data for all 5 self-improvement
metrics. Results: M1 compliance improved 75% to 100% (convention gaps fixed). M2 gap detection
healthy at 1.0/session. M3 closure at 67% (1 gap still in monitoring). M4 human intervention
stable at 0.0. M5 system learning declined from 1.0 to 0.5 — expected as obvious gaps are
exhausted, but flagged for monitoring. Key finding from orphaned commit analysis: all 5 orphaned
auto-commits are from interactive sessions, not autonomous ones (0% autonomous orphan rate).
This is the first session that demonstrates "measuring improvement over time" — the mission's
third requirement — by comparing metrics across two data points.
Sources: findings/measurement-cycle-002-2026-03-14.md, TASKS.md, git log

### 2026-03-14 (session 6)

No actionable tasks. Both open tasks are time-gated: orphaned commit monitoring needs 3 more
autonomous sessions, measurement cycle 003 needs 5 more. Pushed 1 unpushed commit from prior
session (129c080, another orphaned-files auto-commit from interactive session — consistent with
cycle 002 finding that all orphaned commits originate from interactive sessions). This session
counts toward the required accumulation for both time-gated tasks. Session 1 of 5 toward
cycle 003; session 1 of 3 toward orphaned commit final decision.
Sources: git log, TASKS.md

### 2026-03-14 (session 7)

No actionable tasks. Both open tasks remain time-gated: orphaned commit monitoring needs 1 more
autonomous session, measurement cycle 003 needs 3 more. Pushed 1 unpushed commit from prior
interactive session (f416161, orphaned-files auto-commit — continues the pattern: all orphaned
commits originate from interactive sessions, 0% from autonomous). Session 2 of 5 toward
cycle 003; session 2 of 3 toward orphaned commit final decision. Next session (8) will be the
final data point for orphaned commit monitoring — that task becomes actionable then.
Sources: git log, TASKS.md

### 2026-03-14 (session 8)

Completed orphaned commit monitoring task. Final data: 34.8% orphaned rate (8/23 commits), all
from interactive sessions (0% autonomous). Rate exceeded the 20% threshold from the diagnosis,
so implemented Fix 1: descriptive auto-commit messages. Modified `buildOrphanSummary()` in
`infra/scheduler/src/git.ts` — auto-commits now list changed file names instead of generic
text. All 32 tests pass. Also pushed 1 prior unpushed commit (4977edb, another interactive
orphaned commit — consistent with finding). Session 3 of 5 toward measurement cycle 003.
Sources: findings/orphaned-commit-monitoring-conclusion.md, git.ts, git.test.ts, TASKS.md

### 2026-03-14 (session 10)

Completed measurement cycle 003 — third data point for all 5 self-improvement metrics. Results:
M1 compliance stable at 100% (ceiling), M3 gap closure improved 67%→100% (all gaps resolved),
M4 intervention stable at 0.0 (9 consecutive zero-intervention sessions). M2 gap detection declined
1.0→0.2/session (expected gap exhaustion after early obvious fixes). M5 system learning declined
0.5→0.4/session — root cause is empty task queue (60% of sessions had no actionable tasks), not
compound step failure. Key finding: the system has stabilized and needs new task sources or expanded
audit scope to prevent idle sessions. Created follow-up task for task generation.
Sources: findings/measurement-cycle-003-2026-03-14.md, TASKS.md, git log (28 commits)

### 2026-03-14 (session 9)

No actionable tasks. Measurement cycle 003 needs 1 more autonomous session (this is session 4
of 5). Pushed 1 unpushed commit from prior session (7b77be8, auto-commit with descriptive
message for orphaned session.ts changes — Fix 1 from session 8 is working as intended).
Sources: git log, TASKS.md

## Open questions

- ~~Which self-improvement metrics are robust enough to track across Youji's early operational history?~~ → Answered: see plans/self-improvement-measurement.md (5 metrics with baselines)
- What is the smallest useful amount of operational logging needed to support real self-study without overwhelming orient cost?
- Which kinds of capability improvements transfer across projects, and which depend on the specific repo's history and conventions?
- How does single-researcher operation change the dynamics of self-improvement compared to multi-user systems?
