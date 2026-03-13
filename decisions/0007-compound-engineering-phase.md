# ADR-0007: Compound engineering phase in the autonomous work cycle

Date: 2026-03-13
Status: accepted
Adapted from: OpenAkari ADR-0014

## Context

The autonomous work cycle runs Plan (orient), Work (execute), Review (verify), Commit. There is no systematic step for absorbing session learnings back into the system. Without this, patterns that emerge during work — failure modes, convention gaps, technique improvements — are lost unless the researcher manually spots and encodes them.

Evidence from OpenAkari: 6 human improvement cycles in a single analysis session involved absorbing patterns that the system should have absorbed itself. Diagnosis recommendations sat as unactioned tasks because no mechanism migrated knowledge into operating instructions.

## Decision

Add a **compound phase** to the autonomous work cycle, between Execute and Commit. This phase is encoded as a `/compound` skill.

The compound phase performs four checks:
1. **Session learnings** — non-obvious facts, failure modes, or techniques discovered during the task.
2. **Unactioned recommendations** — recent diagnosis/postmortem recommendations that are now actionable.
3. **Convention drift** — conventions that were unhelpful or required workarounds during the session.
4. **Skill improvement candidates** — patterns that have recurred 3+ times and may warrant encoding as skills or convention updates.

The phase produces four types of output:
- **Direct updates** to CLAUDE.md, skills, or conventions (small, obviously correct changes).
- **New tasks** in project TASKS.md (larger changes needing design).
- **Skill improvement candidates** for future evaluation.
- **No action** — explicitly recording "no compound actions needed" is valid.

### Scope constraint

The compound phase should take 2-5 minutes (quick mode, default at session end). It embeds learnings from the current session; it does not execute new tasks or start investigations. Larger improvements are deferred to tasks.

## Consequences

- Every autonomous session has a systematic reflection step, closing the loop between work output and system improvement
- The orient skill reads what compound writes — orient surfaces recommendations, compound embeds them. This creates a cross-session feedback cycle.
- The 2-5 minute scope constraint prevents the compound phase from dominating sessions
- Risk: "compound theater" — making trivial updates to satisfy the step. Mitigated by the "no action" escape hatch and anti-pattern awareness.
- Risk: scope creep — using compound to start new work. Mitigated by the principle "embeds learnings from this session, does not execute new tasks."
