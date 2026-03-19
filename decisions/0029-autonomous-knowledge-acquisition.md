# 0029: Autonomous Knowledge Acquisition

Date: 2026-02-20
Status: accepted

## Context

Youji currently acquires external knowledge about GenAI developments only through:
1. **Human injection** — PI provides information via `/feedback` (type: knowledge)
2. **Reactive discovery** — postmortems and diagnoses reveal model limitations
3. **Manual lit-review** — triggered by a human or a task, never autonomously

The system has WebSearch and WebFetch tools available but only uses them reactively
inside `/lit-review` and `/audit-references`. No scheduled job or workflow proactively
monitors the GenAI landscape. This creates a knowledge staleness risk: the system
can only know what humans tell it or what it discovers through operational failures.

PI feedback: "There have been a few feedback items about new knowledge in GenAI.
How to make Youji capable of not relying on human input to supply this knowledge?"

This is a strategic gap. Youji's mission is fully autonomous research, but knowledge
acquisition — one of the most fundamental research activities — is fully
human-dependent.

## Decision

1. **Create a `/horizon-scan` skill** for periodic autonomous scanning of GenAI
   developments. The skill uses WebSearch to find new model releases, capability
   announcements, benchmark results, and research papers relevant to youji's active
   projects, then records verified findings as knowledge entries in the repo.

2. **Schedule `/horizon-scan` as a periodic skill cycle** using the lightweight
   analytical job architecture from the multi-schedule analysis (Option 3). It runs
   on a weekly cadence using the `skillCycle` agent profile (sonnet model, 15-minute
   timeout, 48 max turns).

3. **Integrate with /orient** so that horizon-scan findings are surfaced to work
   sessions. Horizon-scan writes structured reports to `.scheduler/skill-reports/`;
   `/orient` checks this directory for recent reports.

4. **Follow the verification pipeline from ADR 0019.** All external claims discovered
   by horizon-scan must be mechanically verified (URL fetch + title/author match)
   before being recorded. Unverifiable claims are flagged, not recorded as facts.

5. **Scope is bounded by active projects.** Horizon-scan does not do open-ended
   GenAI monitoring. It scans for developments relevant to:
   - Models used by youji (Claude, Gemini, GPT families)
    - Model and tooling changes that could affect current work
   - Open questions in active project READMEs
   - Topics in active project `literature/` directories

6. **Implementation is phased:**
   - Phase 1: Write the skill and test it manually (done 2026-02-20)
   - Phase 2: Add to scheduler as a weekly job (done 2026-02-20 — added `profile`
     field to `JobPayload`, `horizon-scan-weekly` job in `jobs.json`, `/orient`
     integration with skill-reports)
   - Phase 3: Add event triggers (e.g., scan on new model release detection)

## Consequences

- Youji gains the ability to proactively discover new GenAI developments without
  human injection. This directly addresses the PI's feedback.
- The weekly cadence is conservative — GenAI moves fast but weekly scanning catches
  major releases within days. Cadence can be tuned based on finding rate.
- Cost is low: sonnet + WebSearch + WebFetch for a 15-minute session is ~$0.10-0.30.
  Weekly = ~$0.40-1.20/month.
- Risk of hallucinated findings is mitigated by mandatory URL verification (ADR 0019).
  If a claimed development cannot be verified by fetching the source, it is not recorded.
- This establishes the first proactive external knowledge skill, creating a pattern
  for future skills that acquire information from outside the repo (e.g., benchmark
  monitoring, competitor analysis, tool/API changelog monitoring).
- The `/orient` integration means horizon-scan findings influence task selection:
  a new model release could trigger a capability evaluation (per the model-capability
  evaluation SOP), and a new relevant paper could unblock a literature task.
- Phase 2 completed: `skillCycle` profile, `horizon-scan-weekly` job, and `/orient`
  integration are live. First automated scan expected Sunday 2026-02-22 06:00 UTC.
