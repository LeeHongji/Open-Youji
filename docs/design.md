Design rationale for the Youji repo structure.

## Core premise

This repo is not just storage — it is Youji's brain. Human researchers keep state in their heads; LLM agents lose all state between sessions. Every design choice follows from this asymmetry.

## Agents are not humans

| Property | Human researcher | LLM agent (Youji) | Design implication |
|---|---|---|---|
| Memory | Persistent across months | None between sessions | Repo must encode cognitive state explicitly |
| Context | Can hold an entire project mentally | Limited window | Files must be small, self-contained, and skimmable |
| Accuracy | Occasionally wrong, knows it | Confidently fabricates | All claims require traceable provenance |
| Consistency | Builds stable judgment over time | Stochastic, may contradict prior sessions | Decisions must be recorded to prevent re-litigation |
| Initiative | Self-directed, notices things | Only acts when invoked | Next actions must be written down or they won't happen |

## Key mechanisms

**Log as continuity.** The reverse-chronological log in each project README is the primary mechanism for inter-session memory.

**Provenance as hallucination defense.** Every factual claim is leashed to a source.

**Decisions as consistency anchor.** The `decisions/` directory prevents incompatible choices across sessions.

**Schemas as convention.** Reduces the space of choices Youji must make. Less freedom means less drift.

## Self-evolution

Youji can research and evolve herself. Maintaining this repo's infrastructure IS research on the system itself. Findings about Youji's operation (session efficiency, convention drift, skill gaps) are knowledge output.

The `projects/` directory can contain a meta-project studying Youji's own behavior — this is how OpenAkari was built, and how Youji should grow.

## Principles

1. **Everything is plain text.** Diff-friendly, grep-able, LLM-native.
2. **Projects are self-contained.** Youji pointed at one project directory has full context.
3. **Grow structure on demand.** Don't create directories or files until they're needed.
4. **Knowledge compounds.** Cross-project insights go to `knowledge/`.
5. **The researcher governs.** Important decisions require human approval via APPROVAL_QUEUE.md.

## Lineage

Adapted from [OpenAkari](https://github.com/victoriacity/openakari). Key adaptations:

- **Simplified**: Single Node.js scheduler using `claude -p` instead of Agent SDK + multi-backend abstraction
- **Retained**: Repo-as-brain, inline logging, decision records, skills, provenance, fleet, approval queue
- **Added**: Self-evolution principle, Max plan integration (no API key needed)
