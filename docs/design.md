Design rationale for the youji repo structure.

## Core premise

This repo is not just storage — it is the agents' shared brain. Human researchers keep state in their heads; LLM agents lose all state between sessions. Every design choice follows from this asymmetry.

## Agents are not humans

| Property | Human researcher | LLM agent | Design implication |
|---|---|---|---|
| Memory | Persistent across months | None between sessions | Repo must encode cognitive state explicitly |
| Context | Can hold an entire project mentally | Limited window, ~100-200 pages | Files must be small, self-contained, and skimmable |
| Accuracy | Occasionally wrong, knows it | Confidently fabricates | All claims require traceable provenance |
| Consistency | Builds stable judgment over time | Stochastic, may contradict prior sessions | Decisions must be recorded to prevent re-litigation |
| Initiative | Self-directed, notices things | Only acts when invoked | Next actions must be written down or they won't happen |
| Throughput | One person, sequential | Many agents, parallel | Projects must be independent to avoid conflicts |

## Key mechanisms

**Log as continuity.** The reverse-chronological log in each project README is the primary mechanism for inter-session memory. An agent reads the last few entries and is immediately oriented. This is cheaper and more robust than maintaining a complex state document.

**Provenance as hallucination defense.** Every factual claim is leashed to a source. This is not academic rigor for its own sake — it is a structural defense against the most dangerous failure mode of autonomous agents.

**Decisions as consistency anchor.** The `decisions/` directory prevents two agents from independently making incompatible choices. Once a choice is recorded, it is the default until explicitly superseded.

**Schemas as convention.** The log, task, SOP, and decision schemas in CLAUDE.md reduce the space of choices agents must make. Less freedom means less drift.

## Principles

1. **Everything is plain text.** Diff-friendly, grep-able, LLM-native.
2. **Projects are self-contained.** An agent pointed at one project directory has full context.
3. **Research code lives elsewhere.** Projects hold research orchestration: plans, surveys, configs, analysis, write-ups. Implementation code is imported from external libraries.
4. **Shared tooling lives in `infra/`.** Experiment harnesses, data pipelines, and utilities that serve multiple projects are the one exception to "code lives elsewhere." Each tool gets its own subdirectory with the same README schema as projects.
5. **Grow structure on demand.** Don't create directories or files until they're needed. An agent can always create them later.
