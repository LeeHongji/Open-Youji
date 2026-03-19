# 0014: Compound engineering phase in the autonomous work cycle

Date: 2026-02-17
Status: accepted

## Context

The ralph loop architecture analysis (`projects/youji/experiments/ralph-loop-architecture-analysis/EXPERIMENT.md`) identified compound engineering as youji's largest architectural gap (Finding 2). The ralph loop pattern defines a four-phase cycle: Plan, Work, Review, Compound. Youji's autonomous work cycle SOP implemented Plan (orient), Work (execute), and a partial Review (verify.ts), but had no systematic compound phase.

Evidence of the gap:
- 6 human improvement cycles in the gravity analysis (2026-02-16) involved absorbing patterns that agents should have absorbed themselves.
- `evolution.ts` has never fired because no mechanism generates evolution proposals.
- Diagnosis recommendations sit as unactioned tasks — knowledge exists in the repo but doesn't migrate into operating instructions.

The existing `/gravity` skill evaluates specific formalization candidates, and `/synthesize` interprets accumulated findings, but neither runs systematically at the end of every session. The gap is orchestration, not capability.

## Decision

Add a **compound phase** (Step 5) to the autonomous work cycle SOP, between Execute (Step 4) and Commit (Step 6, formerly Step 5). Create a new `/compound` skill that encodes the procedure.

The compound phase performs four checks:
1. **Session learnings** — non-obvious facts, failure modes, or techniques discovered during the task.
2. **Unactioned recommendations** — recent diagnosis/postmortem recommendations that are now actionable.
3. **Convention drift** — conventions that were unhelpful or required workarounds.
4. **Gravity candidates** — patterns that have recurred 3+ times and may warrant formalization.

The phase produces four types of output:
- **Direct updates** to CLAUDE.md, skills, or conventions (small, obviously correct changes).
- **New tasks** in project "Next actions" (larger changes needing design).
- **Gravity candidates** for future `/gravity` evaluation.
- **Evolution candidates** via `.pending-evolution.json` (infra code changes).

Two modes: "quick" (2-5 min, default end-of-session) and "deep" (10-15 min, standalone).

A new session metric `Compound-actions` is added to the session summary footer to track compound engineering output.

## Consequences

- Every autonomous session now has a systematic reflection step, closing the loop between work output and system improvement.
- The `/orient` skill reads what `/compound` writes — orient surfaces recommendations, compound embeds them. This creates a feedback cycle across sessions.
- The 2-5 minute scope constraint prevents the compound phase from dominating sessions. Larger improvements are deferred to tasks, maintaining the one-task-per-session discipline.
- `/compound` complements existing skills: it identifies gravity candidates (defers to `/gravity`), checks postmortem recommendations (doesn't redo `/postmortem`), and operates on single-session learnings (defers to `/synthesize` for cross-session patterns).
- Risk: "compound theater" — agents making trivial updates to satisfy the step. Mitigated by the anti-patterns section in the skill and the "no compound actions" escape hatch.
- Risk: scope creep — using compound to start new work. Mitigated by the explicit principle "embeds learnings from this session, does not execute new tasks."
- The skill is convention-level (L3), not code-enforced. A future evolution could wire it into `verify.ts` to detect whether compound was performed, similar to how verify currently checks for log entries and commits.
