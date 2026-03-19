# 0060: Actionable Implication Task Gate

Date: 2026-03-04
Status: accepted

## Context

The 7-skill CI integration gap in a sample benchmark project (root cause analysis: `projects/sample-benchmark/diagnosis/root-cause-7skill-integration-gap-2026-03-04.md`) revealed a systemic failure mode: **observations about missing work die as annotations in EXPERIMENT.md findings instead of becoming tasks.**

The skill expansion experiment explicitly noted: "Final paper tables should use multi-trial averages for all 8 models across all 7 skills" (implications #5). This was recorded per convention as a finding annotation. But because no task was created, no future session picked it up. The insight died in the findings section.

This is the highest-leverage failure point in the causal chain because:

1. **It's the root of the other two problems.** "Local optimization without global coherence" and "scope creep without methodology restart" only matter because the observation-to-task pipeline is broken. If the session that wrote implication #5 had also created a task, a future session would have executed it.

2. **The mechanism already exists at L2.** The `/compound` skill (Step 3, Part B) scans for implied tasks in findings sections. `recommendations.ts` has pattern matching for signal phrases. But both are convention-only — they depend on agents running `/compound` thoroughly and converting findings.

3. **L2-only fixes recur ~60% of the time** before L0 enforcement arrives (enforcement-layers.md "Feedback-driven fix default"). Mathematical analysis shows clean session probability drops to 4% with 20 L2 conventions at 85% compliance.

4. **The check is mechanically verifiable.** If a session modifies EXPERIMENT.md with actionable language in Findings/Implications sections, we can detect whether any TASKS.md was also modified. This is the same diff-based approach used by existing L0 checks.

## Decision

Add an L0 check to `verify.ts` that detects when a session writes EXPERIMENT.md content containing actionable implication language but does not also modify any `TASKS.md` file in the same session.

### Detection logic

**Trigger condition:** Session diff modifies an EXPERIMENT.md file AND the added lines in that file's Findings or Implications section contain actionable signal phrases.

**Actionable signal phrases** (patterns that indicate missing work):

- Future-directive: "should", "needs to", "must", "requires"
- Gap-identifying: "gap", "missing", "not yet", "no task", "not covered"
- Work-identifying: "next step", "follow-up", "future work", "remains to be"

**Exemption:** The check passes (no violation) if ANY `TASKS.md` file was also modified in the same session. The check does not verify that the specific implication was converted — it only checks that the session engaged with the task pipeline at all. This avoids false positives from sessions that correctly created tasks through a different mechanism (e.g., inline task creation while writing findings).

**Severity:** L0 warning, not blocking. The warning surfaces in verification output and session metrics. It does not prevent the session from completing — some implications are legitimately informational ("this approach should generalize to other domains") rather than task-generating. The warning prompts review.

### Integration

1. Pure function `checkActionableImplications(diff: string, changedFiles: string[]): string[]` in `verify.ts`
2. Called in `verifySession()` alongside existing L0 checks
3. New field `actionableImplicationViolation: boolean` in `VerificationResult`
4. Warning format: `Actionable implication without task (L0): <file> — Findings/Implications contain "<phrase>" but no TASKS.md was modified. Per ADR 0060, observations about missing work must generate tasks.`

## Consequences

1. **Sessions that write "should do X" in findings are prompted to also create a task.** This converts the ~40% of `/compound` sessions that miss implied tasks into a code-detected reminder.

2. **False positive rate is manageable.** The check triggers only when EXPERIMENT.md is modified with specific signal phrases AND no TASKS.md is touched. Sessions that write routine findings without actionable language won't trigger it. Sessions that create tasks (even for unrelated reasons) won't trigger it.

3. **Compound skill becomes backup, not primary.** Today, `/compound` Step 3 Part B is the only mechanism for implied task extraction. After this ADR, the L0 check catches the failure mode at session end; `/compound` remains the deeper scan for edge cases the regex misses.

4. **Enforcement-layers.md must be updated** to add this check to the L0 table.

5. **The same pattern can be extended** to diagnosis files, postmortems, and analysis files that contain "Recommendations" or "Next steps" sections without corresponding task modifications. This ADR covers EXPERIMENT.md only; extension is a future task.
