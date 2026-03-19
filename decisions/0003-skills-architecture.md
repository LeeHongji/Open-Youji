# 0003: Skills architecture, CI conventions, and capability layers

Date: 2026-02-15
Status: accepted

## Context

After bootstrapping the repo structure (0001) and shared infra (0002), the group has two gaps:

1. **No encoded judgment.** CLAUDE.md encodes conventions (schemas, provenance rules) but not the higher-order judgment a researcher applies — weighing priorities, critiquing artifacts, synthesizing across findings, triaging literature. Each agent session starts from scratch on these cognitive tasks.

2. **No shared vocabulary for reasoning about creative AI systems.** The Creative Intelligence framework ([docs/creative-intelligence.md](../docs/creative-intelligence.md)) defines a five-layer model (Model, Workflow, Interface, Evaluation, Human) and three principles (distributed, probabilistic, downward gravity). This vocabulary needs to be woven into the agent's operating instructions so it informs daily work, not just sits in a document.

Three approaches considered for encoding judgment: (A) longer CLAUDE.md instructions, (B) Claude Code custom slash commands (skills), (C) external scripts invoked via bash. Option A bloats the always-loaded context. Option C loses access to Claude's reasoning. Option B encodes judgment as reusable, invocable prompts with tool access — closest to how a human researcher develops and applies heuristics.

## Decision

Implement a **four-layer capability model** mapping researcher qualities onto the agent environment:

| Layer | What it encodes | Mechanism | Example |
|---|---|---|---|
| L0: Code | Computation | Python in `infra/` | experiment pipeline |
| L1: Schema | Structure | Templates in CLAUDE.md | Log entry, task, decision record |
| L2: Convention | Rules | Bullet lists in CLAUDE.md | Provenance rules, CI principles |
| L3: Skill | Judgment | `.claude/skills/*/SKILL.md` | orient, critique, synthesize, lit-review, design, diagnose, gravity |

**Seven skills** are created at L3, in two waves:

Initial four (session management and research analysis):
- **orient** — session-start situational awareness. Auto-invocable. Injects git context dynamically, reads status and project logs, produces a priority judgment.
- **critique** — adversarial internal review. User-triggered. Applies CI-specific failure dimensions (layer misattribution, interaction blindness, grounding failure, etc.) to any artifact.
- **synthesize** — cross-layer interpretation. User-triggered. Reads accumulated findings within a scope and identifies causal chains, convergent signals, contradictions, and gravity candidates.
- **lit-review** — literature triage with CI mapping. User-triggered. Searches, reads, triages papers, maps claims to CI layers, identifies gaps.

Three additional (empirical research methodology and system evolution):
- **design** — experiment and protocol design. User-triggered. Guides methodological reasoning: hypothesis formation, variable/metric selection with statistical justification, validity threat analysis, cost estimation. Consumes the experiment-design schema but adds the judgment to fill it well.
- **diagnose** — error analysis and interpretive reasoning. User-triggered. Takes empirical results, characterizes error distributions, generates CI-layer-attributed root-cause hypotheses, assesses validity, recommends next steps. Analytical complement to synthesize (which works across findings; diagnose works within one result set).
- **gravity** — capability migration assessment. User-triggered. Evaluates whether recurring patterns should be formalized and at what layer. Orient *detects* gravity signals; gravity *evaluates* them — recurrence frequency, stability, migration cost/benefit, target layer, and migration plan.

**CI conventions** are added to CLAUDE.md as an L2 layer — four unconditional rules that apply to all agent work.

**Two new schemas** are added at L1 — experiment design and literature note — to support the research workflows that the skills operate on.

## Consequences

- Agent sessions can invoke `/orient` to immediately get situated, reducing ramp-up time.
- `/critique` provides a structured adversarial check that catches CI-specific failure modes, reducing the risk of shallow analysis.
- `/synthesize` and `/lit-review` encode the judgment patterns most likely to produce research insight.
- `/design` prevents the common failure of under-specified experiments — forcing explicit metric justification, validity threat analysis, and cost estimation.
- `/diagnose` encodes the empirical research loop (error pattern → root cause → intervention) with CI-layer attribution, preventing the default of blaming the model for everything.
- `/gravity` operationalizes the CI principle of downward gravity with a concrete recurrence threshold (3× before formalization) and cost-benefit framework, preventing both premature optimization and stalled evolution.
- The four-layer model (L0-L3) provides a vocabulary for discussing where new capabilities should live.
- CI conventions in CLAUDE.md mean every agent session — not just ones that read the CI doc — operates with the framework's vocabulary.
- The two new schemas (experiment design, literature note) standardize the artifacts that skills produce and consume.
- Risk: skills may encode premature judgment patterns. Mitigated by the `projects/youji` meta-project, which tracks what works and what doesn't.
