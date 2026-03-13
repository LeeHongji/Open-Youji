# ADR-0010: Autonomous knowledge acquisition

Date: 2026-03-13
Status: accepted
Adapted from: OpenAkari ADR-0029

## Context

Youji currently acquires external knowledge about research developments only through:
1. **Researcher injection** — the researcher provides information during sessions
2. **Reactive discovery** — failures and investigations reveal new information
3. **Manual literature review** — triggered by a task, never autonomously

Youji has WebSearch and WebFetch tools available but only uses them reactively. No workflow proactively monitors the research landscape relevant to active projects. This creates a knowledge staleness risk: the system can only know what the researcher tells it or what it discovers through operational issues.

## Decision

### 1. Create a `/horizon-scan` skill

A periodic skill for scanning developments relevant to Youji's active research projects. The skill uses WebSearch to find new model releases, capability announcements, benchmark results, and research papers relevant to active projects, then records verified findings as knowledge entries in the repo.

### 2. Schedule as a periodic task

Run `/horizon-scan` on a weekly cadence as an autonomous session. Use the `claude -p` execution mode with a focused prompt.

### 3. Scope is bounded by active projects

Horizon-scan does not do open-ended monitoring. It scans for developments relevant to:
- Models and tools used by Youji's projects
- Open questions in active project READMEs
- Topics in active project `literature/` directories
- Research areas the researcher has indicated interest in

### 4. Follow the URL verification pipeline (ADR-0009)

All external claims discovered by horizon-scan must be mechanically verified (URL fetch + title/author match) before being recorded. Unverifiable claims are flagged, not recorded as facts.

### 5. Integration with orient

Horizon-scan writes reports to a known location. The orient skill checks for recent reports during orientation, so findings influence task selection.

## Consequences

- Youji gains the ability to proactively discover new developments without researcher injection
- Weekly cadence is conservative — research moves fast but weekly scanning catches major developments within days
- Risk of hallucinated findings is mitigated by mandatory URL verification (ADR-0009)
- The orient integration means horizon-scan findings can trigger new research tasks
- This establishes the first proactive external knowledge skill, creating a pattern for future autonomous information acquisition
