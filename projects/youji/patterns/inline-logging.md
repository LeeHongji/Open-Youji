Design pattern for same-turn recording of discoveries, preventing knowledge loss from implementation momentum.

<!-- staleness-signal: inline-logging-refs
     source-files: CLAUDE.md, decisions/0004-inline-logging.md, .claude/skills/compound/SKILL.md, .claude/skills/review-findings/SKILL.md
     last-verified: 2026-02-20
     checklist-items: 5 (CLAUDE.md "Inline logging checklist")
     findings-provenance: CLAUDE.md checklist item 5 -->

# Pattern: Inline Logging

## Summary

When an agent discovers a non-obvious fact during execution, it writes the finding to the relevant project file in the same turn — before proceeding to the next step. End-of-session summaries are a fallback, not the primary logging mechanism.

## Problem

LLM agents exhibit "implementation momentum" — once engaged in a multi-step task (writing code, running experiments, analyzing data), they defer recording intermediate discoveries until the session ends. This creates two knowledge-loss risks:

1. **Session interruption**: if the session ends unexpectedly (timeout, error, context limit), unrecorded discoveries are lost permanently.
2. **Compression bias**: end-of-session summaries compress rich operational discoveries into brief retrospective notes, losing the specific details (exact commands, error messages, configuration values) that future sessions need.

The problem was first observed in a research project: an agent completed an entire API gateway integration without logging any findings until prompted by a human. The lost finding — "OpenAI SDK appends `/chat/completions` to `base_url`" — was exactly the kind of operational knowledge future sessions need.

## Solution

### The inline logging checklist

Five rules encoded in CLAUDE.md (see [decisions/0004-inline-logging.md](../../../decisions/0004-inline-logging.md)):

1. **Discovery of a non-obvious fact** → write to project file in the same turn, before proceeding.
2. **Config/env change** → log entry with before/after and rationale, immediately.
3. **Successful verification** → log the exact command and output (not just "tested successfully").
4. **Log incrementally** throughout the session. A single end-of-session summary is a fallback, not the primary mechanism.
5. **Findings provenance**: every numerical claim in an EXPERIMENT.md Findings section must include either (a) the script + data file that produces it, or (b) inline arithmetic from referenced data. Claims without provenance are unverifiable.

### Where to log

The destination depends on the finding type:

| Finding type | Destination |
|---|---|
| Operational discovery (API behavior, config quirk) | Project README log entry or `existing-data.md` |
| Experiment result | `EXPERIMENT.md` Findings section |
| Convention/rule refinement | Relevant CLAUDE.md section or decision record |
| Open question | Project README "Open questions" section |

### Provenance as anti-hallucination

Rule 5 (findings provenance) was added after the hallucination incident (7/15 fabricated literature references). By requiring every numerical claim to trace to a specific script, data file, or inline arithmetic, the convention creates a mechanical verification path. Future sessions can re-run the computation and confirm the claim — or discover it was fabricated.

## Forces and trade-offs

### Recording cost vs. knowledge preservation

Inline logging interrupts the agent's execution flow. Writing a finding mid-task takes time and context that could be spent on the task itself. The trade-off is justified empirically: sessions without inline logging produce 0-1 recoverable findings; sessions with inline logging produce 3-5 findings (based on automated detection metrics).

### Precision vs. speed

The provenance requirement (rule 5) adds significant overhead — every number must be traced to its source. This slows finding production but dramatically increases finding reliability. The hallucination incident demonstrated that speed without provenance produces unreliable knowledge.

### Convention vs. enforcement

Inline logging is a convention (L2), not enforced by code (L0). There is no runtime check that logging actually happened. The `/compound` skill performs end-of-session checks for findings that should have been logged, but this is advisory — it can detect missing logs but cannot retroactively create them.

## Evidence

**Sample research project:** The inline logging discipline was created after an agent completed an entire API gateway integration without logging any findings until prompted by a human. The lost finding — "OpenAI SDK appends `/chat/completions` to `base_url`" — was exactly the kind of operational knowledge future sessions need. After the convention was established, subsequent sessions produced 3-5 findings per session in project analyses.

**Simulation game:** Agents writing to savegame READMEs demonstrated effective inline logging within sessions: each experimental finding was recorded as it was discovered, creating a clear audit trail. However, some sim-game sessions failed to write log entries to the project-level README, showing that inline logging compliance depends on where the agent believes the log belongs.

**youji:** The retrospective identified that knowledge detection is "severely undercounting" — the automated detector found 0 findings for 7 of 10 youji sessions despite substantial output. This is partly because inline logs are spread across multiple files rather than structured in a single detectable format. The failure is at L4 (Evaluation): we can't measure what we can't detect.

**Measured metrics (at 83 sessions):**
- Findings per session (automated detection): 4.7 average (389 findings / 83 sessions) — improved from 1.4 at 10 sessions after knowledge metric detection was fixed (`architecture/fix-knowledge-metric-detection.md`)
- Findings per experiment (completed): 7.5 average (389 findings / 52 experiments)
- Implementation momentum incidents (pre-convention): 1 documented (Gateway integration)
- Implementation momentum incidents (post-convention): 0 documented (but detection may miss them)

## CI layer analysis

Primarily **L2 (Convention)** — a behavioral rule enforced through documentation, not code. The convention interacts with L4 (Evaluation) when detection mechanisms attempt to verify compliance.

The provenance requirement (rule 5) bridges L2 and L0: it's a convention that creates machine-verifiable traces. A future validator could check that every numerical claim in Findings sections has an associated file reference — migrating from convention to code enforcement.

## Known limitations

1. **Convention-only enforcement.** No runtime check that logging actually happened. An agent that skips logging violates the convention silently.

2. **Detection is poor.** Automated knowledge counting misses most non-EXPERIMENT.md findings. The compound metric (`architecture/compound-metric.md`) attempts to address this gap but remains experimental.

3. **Location ambiguity.** Agents sometimes log to the wrong file (savegame README vs. project README, EXPERIMENT.md vs. project-level doc). The "where to log" table provides guidance but requires judgment.

4. **Provenance overhead.** Rule 5 adds significant time to finding documentation. Sessions may under-report findings to avoid the provenance burden — producing fewer but more reliable findings.

## Self-evolution gaps

- **Human-dependent**: The initial convention was created by a human in response to an observed failure. The system could not have self-diagnosed "we're losing knowledge due to deferred logging" without external observation.
- **Self-diagnosable**: Findings-per-session rate is mechanically measurable. The system can detect when sessions produce zero findings (a proxy for logging failure). The compound metric experiment explores richer detection.
- **Gap**: No way to detect whether a finding that _should_ have been logged was actually logged. The system can count what was logged but cannot assess what was missed.

## Open questions

1. **What is the right logging granularity?** Logging every minor observation creates noise; logging only major findings risks missing operational details. Where is the threshold?

2. **Can logging compliance be enforced at L0?** A post-session hook could check that the session produced at least one finding or log entry. This would catch sessions that produce no output but cannot assess quality.

3. **Does provenance actually prevent hallucination?** Rule 5 creates a verification path, but does anyone (human or agent) actually follow it? If provenance is never checked, it's overhead without benefit.

## Related patterns

- **Repo as Cognitive State** ([patterns/repo-as-cognitive-state.md](repo-as-cognitive-state.md)) — inline logging is the write path for repo state. Without it, the repo's cognitive state decays.
- **Structured Work Records** ([patterns/structured-work-records.md](structured-work-records.md)) — EXPERIMENT.md Findings sections are the primary destination for inline-logged findings.
- **Gravity-Driven Migration** ([patterns/gravity-driven-migration.md](gravity-driven-migration.md)) — the inline logging convention itself is a gravity cascade: human observation → decision record → CLAUDE.md convention → /compound skill check.

## References

- Decision record: [decisions/0004-inline-logging.md](../../../decisions/0004-inline-logging.md)
- Knowledge metric fix: [architecture/fix-knowledge-metric-detection.md](../architecture/fix-knowledge-metric-detection.md)
- Compound metric: [architecture/compound-metric.md](../architecture/compound-metric.md)
- Hallucination incident: See internal postmortem analysis for literature fabrication incident.
- Retrospective: [analysis/first-10-sessions-retrospective.md](../analysis/first-10-sessions-retrospective.md)
