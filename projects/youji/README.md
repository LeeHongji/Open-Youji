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

## Open questions

- ~~Which self-improvement metrics are robust enough to track across Youji's early operational history?~~ → Answered: see plans/self-improvement-measurement.md (5 metrics with baselines)
- What is the smallest useful amount of operational logging needed to support real self-study without overwhelming orient cost?
- Which kinds of capability improvements transfer across projects, and which depend on the specific repo's history and conventions?
- How does single-researcher operation change the dynamics of self-improvement compared to multi-user systems?
