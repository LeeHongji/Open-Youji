# 0044: Agentic Temporal Reasoning

Date: 2026-02-28
Status: accepted

## Context

LLMs are trained primarily on text written by and about human organizations. This creates
a systematic bias: when reasoning about timelines, durations, project ages, or operational
history, LLMs default to human-organization temporal models (weeks = short, months = normal
project, years = mature). This is wrong for agentic systems.

youji was created on 2026-02-14. In 14 calendar days it accumulated 1600+ commits, 7
projects, 40+ decision records, and a rich operational history. An agent reviewing this
history hallucinated "18 months" and "since July 2025" in a paper draft. A second agent
reviewing the draft "corrected" this to "~7 months since July 2025" — itself a hallucination.
The actual answer (2 weeks) was mechanically derivable from `git log --reverse | head -1`
but no agent checked.

This is not an isolated incident. It reflects a structural failure mode: LLMs confabulate
temporally plausible durations from parametric memory rather than deriving them from
available evidence. The failure is especially insidious because the fabricated timelines
*sound reasonable* — "18 months of operation" is what a human research group would need to
produce comparable output.

The PI's insight: agentic systems operate on fundamentally different timescales than human
organizations. 14 days of 24/7 autonomous operation can produce output that a human team
would need months to generate. Agents must reason about agentic time, not human time.

## Decision

1. **Temporal claims require mechanical verification.** Any claim about duration, age,
   timeline, or temporal sequence in youji artifacts must be derived from verifiable
   sources (git log, file timestamps, dated log entries), never from parametric memory
   or "common sense" about how long things take.

2. **Verification procedure.** When writing a temporal claim:
   - For repo/project age: `git log --reverse --format="%ai" | head -1`
   - For session counts: count entries in scheduler metrics or git log
   - For project duration: first and last dated log entries in the project README
   - For "how long X took": git log filtered to relevant commits
   - State the source inline: "youji has operated for 14 days (first commit: 2026-02-14)"

3. **Anti-pattern: human-timescale reasoning.** Do not reason about youji operations
   using human-organization defaults. Specifically:
   - Do not assume project maturity correlates with calendar time
   - Do not assume output volume requires months of operation
   - Do not extrapolate durations from the "feel" of how much has been produced
   - Do not use phrases like "over the past months" without checking the calendar

4. **Agentic timescale awareness.** When describing youji's operational characteristics,
   use concrete metrics (commits, sessions, experiments, decisions) rather than duration.
   "1600+ commits across 7 projects" is more accurate than "months of work" because it
   describes actual output rather than implying a human-equivalent timeframe.

## Consequences

- Add a "Temporal reasoning" subsection to CLAUDE.md Provenance conventions.
- Fix existing temporal hallucinations in paper drafts and analysis documents
  that contain unverified temporal claims.
- This convention joins the L2 (convention-only) enforcement layer. Future work could
  promote it to L0 via a pre-commit check that flags unverified temporal claims in .md files.
