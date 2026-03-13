# ADR-0014: Agentic temporal reasoning

Date: 2026-03-13
Status: accepted
Adapted from: OpenAkari ADR-0044

## Context

LLMs are trained on text written by and about human organizations. This creates a systematic bias: when reasoning about timelines, durations, or project ages, LLMs default to human-organization temporal models (weeks = short, months = normal project, years = mature). This is wrong for agentic systems.

OpenAkari was created on 2026-02-14. In 14 calendar days it accumulated 1600+ commits, 7 projects, and 40+ decision records. An agent reviewing this history hallucinated "18 months" for the project age. A second agent "corrected" this to "~7 months since July 2025" — also a hallucination. The actual answer (2 weeks) was mechanically derivable from `git log --reverse | head -1`.

This reflects a structural failure mode: LLMs confabulate temporally plausible durations from parametric memory rather than deriving them from available evidence. The fabricated timelines *sound reasonable* because the output volume is what a human team would need months to produce.

## Decision

### 1. Temporal claims require mechanical verification

Any claim about duration, age, timeline, or temporal sequence in Youji artifacts must be derived from verifiable sources (git log, file timestamps, dated log entries), never from parametric memory.

### 2. Verification procedure

When writing a temporal claim:
- For repo/project age: `git log --reverse --format="%ai" | head -1`
- For project duration: first and last dated log entries in the project README
- For "how long X took": git log filtered to relevant commits
- State the source inline: "Youji has operated for N days (first commit: YYYY-MM-DD)"

### 3. Anti-pattern: human-timescale reasoning

Do not reason about Youji's operations using human-organization defaults:
- Do not assume project maturity correlates with calendar time
- Do not assume output volume requires months of operation
- Do not extrapolate durations from the "feel" of how much has been produced
- Do not use phrases like "over the past months" without checking the calendar

### 4. Use concrete metrics over duration

When describing operational characteristics, use concrete metrics (commits, sessions, experiments, decisions) rather than duration. "50 commits across 3 projects" is more accurate than "weeks of work."

## Consequences

- Temporal claims in all Youji artifacts must have mechanical provenance
- Existing documents with unverified temporal claims should be corrected when encountered
- This is a convention-level rule; future work could add automated detection of unverified temporal claims
