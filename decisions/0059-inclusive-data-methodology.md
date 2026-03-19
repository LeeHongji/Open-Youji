# 0059: Benchmark Inclusive Data Methodology

Date: 2026-03-04
Status: accepted

## Context

The benchmark multi-trial experiment (5 runs, 8 models, 4086 scored records) suffered infrastructure failures in Runs 3-4 that caused several models to drop out (exec-phase API failures via cursor-agent). The expansion skills (EXECUTE, RECORD, PERSIST) were added starting in Run 2, meaning Run 1 has only 4 of 7 skills.

The initial analysis adopted a conservative approach: scope down to 38 "core tasks" (4 skills from Run 1), filter to runs with ≥80% coverage, yielding valid CIs for all 8 models — but only on 4 of 7 skill categories.

The PI asked which approach is more beneficial: (1) cut scope/abort failed data for tight CIs, or (2) use all available data and add more runs as needed.

Two problems with the conservative approach:
1. The paper's central contribution — the two-cluster finding (analytical vs. implementation skills with near-zero cross-correlation, F6) and the model profile typology — depends on expansion skills that have NO multi-trial statistical backing.
2. Sections 6.1-6.5 present 7-skill results but Section 6.6 provides CIs for only 4 skills, creating an internal coherence gap that reviewers will flag.

The expansion skills already have 4 runs of data (Runs 2-5). Budget is 73.3% remaining (14,663 of 20,000 calls). Failed runs were caused by transient infrastructure issues, not fundamental limitations.

## Decision

Adopt the inclusive data methodology (Approach 2): use all available results across all 7 skill categories and add targeted experiment runs to fill coverage gaps.

Specifically:
1. Build a unified 7-skill CI analysis that incorporates multi-trial data from both the original 4 skills AND the 3 expansion skills.
2. For the 4 original skills, use 38 core tasks across all 5 runs (existing methodology).
3. For the 3 expansion skills, use 24 expansion tasks across runs 2-5 (4 runs of data), with the same ≥80% coverage filter per model per run.
4. Report CIs for all 7 skill categories. Accept that expansion skills have 4 runs max instead of 5 (Run 1 predates them).
5. Run targeted re-runs for model-skill combinations where coverage dropped below 80% in runs 3-4 (exec-phase models on expansion skills).
6. Allow different models to have different numbers of valid runs — this is standard practice. Report n transparently per model per skill.
7. The paper should present a unified 7-skill CI framework in Section 6.6, not a split between "4-skill CIs" and "3-skill anecdotes."

## Consequences

1. Section 6.6 of the paper must be rewritten to present 7-skill CIs. The current 4-skill-only tables (Tables 5-7) will be replaced with comprehensive 7-skill versions.
2. A new analysis script (`seven_skill_ci_analysis.py`) is needed to consolidate data across both skill sets.
3. Targeted re-runs may consume ~200-500 API calls from the remaining 14,663 budget. Well within limits.
4. The two-cluster finding (F6), model profile typology (Section 6.5), and EXECUTE discrimination claims will gain statistical backing, strengthening the paper's novel contributions.
5. CIs for expansion skills may be slightly wider (4 runs vs 5 for original skills, and potentially fewer valid runs for models that failed in runs 3-4). This is acceptable — wider CIs on real data are preferable to no CIs at all.
6. New tasks needed: (a) audit expansion skill coverage across runs 2-5, (b) write 7-skill CI analysis script, (c) targeted re-runs for gaps, (d) update paper Section 6.6.
