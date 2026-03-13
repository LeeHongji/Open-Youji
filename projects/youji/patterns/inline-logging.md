Design pattern for same-turn recording of discoveries, preventing knowledge loss from implementation momentum.

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

Five rules encoded in CLAUDE.md:

1. **Discovery of a non-obvious fact** -> write to project file in the same turn, before proceeding.
2. **Config/env change** -> log entry with before/after and rationale, immediately.
3. **Successful verification** -> log the exact command and output (not just "tested successfully").
4. **Log incrementally** throughout the session. A single end-of-session summary is a fallback, not the primary mechanism.
5. **Findings provenance**: every numerical claim in an EXPERIMENT.md Findings section must include either (a) the script + data file that produces it, or (b) inline arithmetic from referenced data. Claims without provenance are unverifiable.

### Where to log

The destination depends on the finding type:

| Finding type | Destination |
|---|---|
| Operational discovery (API behavior, config quirk) | Project README log entry or relevant knowledge file |
| Experiment result | `EXPERIMENT.md` Findings section |
| Convention/rule refinement | Relevant CLAUDE.md section or decision record |
| Open question | Project README "Open questions" section |

### Provenance as anti-hallucination

Rule 5 (findings provenance) addresses the risk of fabricated claims. By requiring every numerical claim to trace to a specific script, data file, or inline arithmetic, the convention creates a mechanical verification path. Future sessions can re-run the computation and confirm the claim — or discover it was fabricated.

## Forces and trade-offs

### Recording cost vs. knowledge preservation

Inline logging interrupts the agent's execution flow. Writing a finding mid-task takes time and context that could be spent on the task itself. The trade-off is justified empirically: sessions without inline logging produce few recoverable findings; sessions with inline logging produce significantly more.

### Precision vs. speed

The provenance requirement (rule 5) adds significant overhead — every number must be traced to its source. This slows finding production but dramatically increases finding reliability.

### Convention vs. enforcement

Inline logging is a convention (L2), not enforced by code (L0). There is no runtime check that logging actually happened. The `/compound` skill performs end-of-session checks for findings that should have been logged, but this is advisory — it can detect missing logs but cannot retroactively create them.

## Evidence

The inline logging discipline was created after an agent completed an entire API gateway integration without logging any findings until prompted by a human. After the convention was established, subsequent sessions showed markedly improved knowledge capture. Findings-per-session rates increase substantially when the convention is actively followed.

Youji-specific evidence will be collected as operational history accumulates. Key metrics to track: findings per session, implementation momentum incidents (sessions that defer all logging to end-of-session), and provenance compliance rate.

## CI layer analysis

Primarily **L2 (Convention)** — a behavioral rule enforced through documentation, not code. The convention interacts with L4 (Evaluation) when detection mechanisms attempt to verify compliance.

The provenance requirement (rule 5) bridges L2 and L0: it's a convention that creates machine-verifiable traces. A future validator could check that every numerical claim in Findings sections has an associated file reference — migrating from convention to code enforcement.

## Known limitations

1. **Convention-only enforcement.** No runtime check that logging actually happened. An agent that skips logging violates the convention silently.

2. **Detection is poor.** Automated knowledge counting may miss non-EXPERIMENT.md findings. Findings spread across multiple files are harder to detect and count.

3. **Location ambiguity.** Agents sometimes log to the wrong file. The "where to log" table provides guidance but requires judgment.

4. **Provenance overhead.** Rule 5 adds significant time to finding documentation. Sessions may under-report findings to avoid the provenance burden — producing fewer but more reliable findings.

## Self-evolution gaps

- **Human-dependent**: The initial convention was created by a human in response to an observed failure. The system could not have self-diagnosed "we're losing knowledge due to deferred logging" without external observation.
- **Self-diagnosable**: Findings-per-session rate is mechanically measurable. The system can detect when sessions produce zero findings (a proxy for logging failure).
- **Gap**: No way to detect whether a finding that _should_ have been logged was actually logged. The system can count what was logged but cannot assess what was missed.

## Open questions

1. **What is the right logging granularity?** Logging every minor observation creates noise; logging only major findings risks missing operational details. Where is the threshold?

2. **Can logging compliance be enforced at L0?** A post-session hook could check that the session produced at least one finding or log entry. This would catch sessions that produce no output but cannot assess quality.

3. **Does provenance actually prevent hallucination?** Rule 5 creates a verification path, but does anyone (human or agent) actually follow it? If provenance is never checked, it's overhead without benefit.

## Related patterns

- **Repo as Cognitive State** ([patterns/repo-as-cognitive-state.md](repo-as-cognitive-state.md)) — inline logging is the write path for repo state. Without it, the repo's cognitive state decays.
- **Structured Work Records** ([patterns/structured-work-records.md](structured-work-records.md)) — EXPERIMENT.md Findings sections are the primary destination for inline-logged findings.
- **Gravity-Driven Migration** ([patterns/gravity-driven-migration.md](gravity-driven-migration.md)) — the inline logging convention itself is a gravity cascade: human observation -> decision record -> CLAUDE.md convention -> /compound skill check.
