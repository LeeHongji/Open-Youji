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

## Open questions

- Which self-improvement metrics are robust enough to track across Youji's early operational history?
- What is the smallest useful amount of operational logging needed to support real self-study without overwhelming orient cost?
- Which kinds of capability improvements transfer across projects, and which depend on the specific repo's history and conventions?
- How does single-researcher operation change the dynamics of self-improvement compared to multi-user systems?
