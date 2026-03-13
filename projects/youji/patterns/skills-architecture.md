Design pattern for encoding researcher judgment as reusable LLM agent skills, adapted from OpenAkari's operating experience.

# Pattern: Skills Architecture

## Summary

Researcher capabilities are decomposed into four layers by formalization level — code, schema, convention, skill — where skills (L3) encode the judgment that cannot be reduced to deterministic computation, structural templates, or unconditional rules. Each skill is a reusable prompt with scoped tool access, invocable on demand.

## Problem

LLM agents are general-purpose reasoners, but research work requires specific judgment patterns: triaging literature, designing experiments, diagnosing error distributions, critiquing artifacts for specific failure modes. Without encoded judgment, each agent session must rediscover these patterns from scratch, leading to:

1. **Shallow analysis**: agents produce plausible-sounding but superficial outputs because they lack the specific heuristics a domain researcher would apply (e.g., checking for tautological findings, attributing errors to the correct CI layer).
2. **Inconsistent quality**: the same analytical task produces different-quality results across sessions depending on whether the agent happens to reason carefully about a particular dimension.
3. **Lost institutional knowledge**: judgment patterns discovered in one session (e.g., "always check whether a metric is degenerate given the experimental constraints") are not available to the next session unless manually encoded somewhere.

The challenge is encoding judgment without either (a) bloating the always-loaded context with rarely-needed instructions, or (b) losing access to the agent's reasoning capability by externalizing logic to scripts.

## Solution

### The four-layer capability model

Every capability the agent needs is placed at one of four layers, based on what it encodes and how it is implemented:

| Layer | What it encodes | Mechanism | Example |
|---|---|---|---|
| L0: Code | Computation | Scripts in `infra/` | scheduler, validators |
| L1: Schema | Structure | Templates in CLAUDE.md | Log entry, task, decision record, experiment design |
| L2: Convention | Rules | Bullet lists in CLAUDE.md | Provenance rules, CI principles, inline logging |
| L3: Skill | Judgment | `.claude/skills/<name>/SKILL.md` | orient, critique, design, diagnose |

The placement rule: a capability belongs at the lowest layer that can fully express it. Judgment that can be reduced to a deterministic check belongs in code (L0). Structural patterns belong in schemas (L1). Unconditional rules belong in conventions (L2). Only the irreducibly judgmental — the reasoning that requires weighing competing considerations, generating hypotheses, or applying domain-specific heuristics — belongs in skills (L3).

### What a skill is

A skill is a Markdown file at `.claude/skills/<name>/SKILL.md` with:

- **YAML frontmatter**: description, tool permissions (`allowed-tools`), invocation mode (`disable-model-invocation: false` for auto-invocable, `true` for user-triggered), argument hint.
- **Structured procedure**: step-by-step instructions that encode the judgment pattern — what to gather, what to analyze, what failure modes to check, how to structure the output.
- **Output format**: a template that ensures consistent, comparable outputs across sessions.
- **When-to-use guidance**: explicit differentiation from related skills, preventing misapplication.

Skills are not generic prompts. Each encodes a specific judgment pattern with specific failure dimensions, tests, or analytical steps that a general-purpose agent would not reliably apply without guidance.

### The skill inventory

Twenty-five skills organized by function:

**Session management:**
- **orient** / **orient-simple** — session-start situational awareness. Reads git state, project READMEs, and status to produce a priority recommendation. Explicitly checks for uncommitted work, decision debt, infra gaps, and gravity signals.

**Adversarial review (3 skills with explicit differentiation):**
- **critique** — broad adversarial review across multiple failure dimensions (layer misattribution, interaction blindness, grounding failure, single-example reasoning, stalled gravity, provenance gaps, scope drift, missing uncertainty, schema violations). Wide but shallow per dimension.
- **review** — unified experiment validation with two modes: metrics-first (upstream validation of metric definitions against experimental constraints) then findings (deep validation of individual findings). Ensures rigor in experimental work.
- **audit-references** — mechanical verification of literature note citations by fetching URLs and confirming paper identity (title match + author match). Pre-publication gate and hallucination detection.

**Analytical reasoning (2 skills):**
- **synthesize** — cross-layer interpretation of accumulated findings. Identifies causal chains across CI layers, convergent signals, contradictions, gaps, and gravity candidates.
- **diagnose** — error analysis within a single result set. Characterizes error distributions, generates CI-layer-attributed root-cause hypotheses, assesses validity, recommends next steps.

**Research methodology (4 skills):**
- **design** — experiment and protocol design with methodological rigor. Guides hypothesis formation, metric selection with statistical justification, validity threat analysis, and cost estimation.
- **lit-review** — literature triage with CI layer mapping. Auto-invocable. Searches, triages (load-bearing / contextual / incremental), writes structured literature notes with verified citations and direct quotes.
- **project** — unified project creation with two modes: `propose` (agent-initiated gap analysis) and `scaffold` (human-initiated interview -> project directory).
- **research** — structured research investigation and knowledge synthesis.

**Production and communication (3 skills):**
- **write** — structured writing for research artifacts.
- **publish** — publication preparation and quality gates.
- **report** — session and project reporting.

**Development (2 skills):**
- **develop** — implementation work following TDD and coding conventions.
- **architecture** — analyze, redesign, and refactor infrastructure code. Operates in four modes: Auto (autonomous diagnosis and fixes), Map (dependency tracing), Refactor (behavior-preserving improvement), Redesign (architectural changes).

**Infrastructure (2 skills):**
- **self-audit** — convention compliance checking. Reads recent session diffs and checks against CLAUDE.md conventions (log entries, findings provenance, task lifecycle tags, budget compliance, experiment record coverage). Auto-invocable.
- **analyze** — data analysis and operational measurement.

**System evolution (2 skills):**
- **gravity** — capability migration assessment. Evaluates whether recurring patterns should be formalized (Manual -> Convention -> Skill -> Code). Uses a 3x recurrence threshold, cost-benefit framework, and migration plan template.
- **simplify** — complexity review. Tests every component against "if I removed this, would the mission fail?" The counterbalance to gravity — where gravity adds structure, simplify removes it.

**Failure analysis and learning (3 skills):**
- **postmortem** — root-cause analysis of agent reasoning failures. Traces the production chain of a flawed output, classifies the failure mode, and identifies preventive checks.
- **compound** / **compound-simple** — end-of-session knowledge compounding. Ensures learnings are embedded into skills, conventions, or knowledge files rather than lost.
- **feedback** — processing and integrating researcher feedback into system improvements.

**Knowledge management (2 skills):**
- **horizon-scan** — environmental scanning for relevant developments in AI/agents research.
- **Researcher feedback integration** via the feedback skill.

### Key design decisions

**Skill granularity: specific > general.** Each skill addresses one analytical mode. Overlapping skills are differentiated with explicit "when to use this vs. alternatives" sections. This prevents a common failure: invoking a broad skill when a specific one would be more effective. Where two skills share the same pipeline, they are merged into a single skill with modes (e.g., `/review`).

**Tool scoping.** Each skill declares which tools it may use (`allowed-tools`). Most analytical skills are read-only (`Read`, `Grep`, `Glob`). Skills that produce artifacts add `Write`. Skills that need computation add `Bash(python *)`. This prevents skills from having side effects beyond their intended purpose.

**Output templates.** Every skill specifies an output format. This serves three purposes: (a) ensures consistency across sessions so outputs are comparable, (b) forces the agent to cover all required dimensions rather than stopping at the first insight, (c) creates machine-parseable sections for future automated analysis.

**Auto-invocable vs. user-triggered.** `/orient` and `/lit-review` are auto-invocable (can be invoked by the model without explicit slash-command). All other skills require explicit invocation. This prevents bloating every session with judgment patterns that may not be needed — skills are loaded on demand, not permanently.

**Autonomous diagnosis modes.** Some skills support autonomous operation when invoked without specific instructions. The `/architecture` skill's `auto` mode scans infrastructure for issues across safety/clarity/efficiency dimensions, prioritizes them, and implements the highest-priority fix autonomously.

## Forces and trade-offs

### Judgment encoding vs. context cost

Skills solve the problem of encoding judgment without bloating the always-loaded context. CLAUDE.md contains conventions (always loaded, low per-item cost, unconditional). Skills contain judgment (loaded on demand, high per-item value, conditional on task). The trade-off: a skill that should be a convention wastes the user's invocation; a convention that should be a skill wastes context on every session.

**Heuristic for placement:** If the rule applies to every session regardless of task, it belongs in CLAUDE.md as a convention. If it applies only when performing a specific analytical task, it belongs in a skill.

### Prompt-encoded judgment vs. code-encoded logic

Skills encode judgment as natural-language procedures in prompts, not as code. This has advantages: the agent can reason flexibly about edge cases, combine multiple judgment patterns, and apply the skill to novel artifacts. But it also means the judgment is advisory — the agent can ignore or misapply the skill's instructions. Code (L0) enforces deterministically; skills (L3) guide probabilistically.

The four-layer model explicitly acknowledges this: capabilities migrate downward from skill to code as the judgment crystallizes into deterministic rules. A skill is the right layer for judgment that is still evolving or irreducibly contextual.

### Specificity vs. coverage

With 25 skills, choosing the right one requires understanding the differentiation between overlapping skills. The orient skill includes a skill selection guide for the common case of "I have results, which skill do I use next?"

Mitigation: every overlapping skill includes a "when to use this vs. alternatives" section. Three clusters of related skills have explicit differentiation:

1. **Adversarial review cluster**: critique (broad, multiple dimensions) vs. review (deep, per-metric and per-finding validity) vs. audit-references (citation verification, mechanical URL checking)
2. **Result interpretation cluster**: diagnose (error analysis, single result set) vs. synthesize (cross-finding patterns) vs. postmortem (agent reasoning failures, not data)
3. **System evolution cluster**: gravity (add structure) vs. simplify (remove structure)

## Evidence

### Design rationale

The four-layer model emerged from mapping researcher qualities onto agent mechanisms:

- **Computation** -> Code (L0): deterministic, reproducible, no judgment needed
- **Structure** -> Schema (L1): recurring shapes that constrain content
- **Rules** -> Convention (L2): unconditional guidelines for all sessions
- **Judgment** -> Skill (L3): conditional reasoning for specific tasks

### Skill usage observations

**orient** is the most-used skill. Every autonomous session invokes it as Step 1 of the protocol. Without explicit orient invocation, agents lack context and produce shallow output. With orient, agents correctly assess state and select appropriate tasks.

**Skills as reactive design:** Many skills were created in response to observed reasoning failures, not speculatively. This validates the "grow structure on demand" principle but also means skill coverage is biased toward failure modes that have already occurred.

## CI layer analysis

The skills architecture itself spans multiple CI layers:

- **L0 (Code)**: the `.claude/skills/` directory structure and YAML frontmatter are infrastructure that Claude Code interprets to make skills invocable.
- **L1 (Schema)**: each skill's output format template is a schema — it structures what the skill produces.
- **L2 (Convention)**: the four-layer placement rule, the "when to use" guidance, and the skill selection guide in orient are conventions about how to use the system.
- **L3 (Skill)**: the skill procedures themselves — the judgment they encode about what to check, what patterns to look for, and how to structure analysis.
- **L5 (Human)**: humans decide when to create new skills, when existing skills need revision, and when a skill should be retired or migrated to a lower layer.

A notable gap: **L4 (Evaluation)** is underrepresented. There is no systematic measurement of skill effectiveness — no metrics comparing analysis quality with vs. without skill invocation, no tracking of which skills are invoked and how often, no measurement of whether skill outputs are acted upon. This is identified as a future research question.

## Known limitations

1. **No effectiveness measurement.** Skills are assumed to improve analysis quality, but this has not been measured. Systematic A/B comparison of skill-guided vs. unguided analysis would be needed to validate the approach.

2. **Advisory, not enforced.** Skills are prompts, not programs. An agent can misapply a skill or ignore it entirely. There is no runtime check that a skill's procedure was followed. Post-hoc review of skill outputs is the only quality mechanism.

3. **Selection burden.** With 25 skills, choosing the right one requires understanding the differentiation between overlapping skills. A wrong skill choice wastes a skill invocation and may miss the specific check that was needed.

4. **Reactive coverage.** Skills are created in response to observed failures, which means the inventory is biased toward past failure modes. Novel failure modes that haven't occurred yet have no corresponding skill. This is by design (grow structure on demand) but means the system's coverage is inherently backward-looking.

5. **No cross-skill composition.** Skills are invoked individually. There is no mechanism for chaining skills automatically. Where a natural pipeline exists, the skills are merged into a single skill with modes. For other combinations, the orient skill recommends a sequence, but execution is manual.

6. **Stale skills.** As the repo evolves, skills may become outdated (referencing file paths that no longer exist, encoding judgment patterns that have been superseded). There is no automated mechanism for detecting skill staleness or triggering skill review.

7. **Single-repo scope.** The skills encode judgment specific to Youji's domain (research methodology, CI framework). The four-layer model is general, but the specific skills are not portable without adaptation.

## Open questions

1. **Does the four-layer model hold up?** Are there capabilities that don't fit any layer, or layers that should be split or merged? After sufficient sessions, does the placement heuristic consistently produce the right assignment?

2. **When should a skill become a convention?** The gravity skill has a 3x recurrence threshold for formalization. Does the same threshold apply to skills becoming conventions? If a skill's judgment crystallizes into "always do X," it should migrate to CLAUDE.md. But how do you detect this?

3. **What is the right skill granularity?** 25 skills may be too many (selection burden) or too few (coverage gaps). Is there a natural cluster size? Should related skills be merged into larger skills with internal modes, or kept separate for specificity?

4. **How do skills interact with model capability?** As LLMs improve, some judgment encoded in skills may become redundant (the model already does it without prompting). How do you detect this and retire skills? This is a form of upward gravity — model capability absorbing skill judgment — which is the reverse of the usual downward direction.

## Related patterns

- **Autonomous Execution** ([patterns/autonomous-execution.md](autonomous-execution.md)) — the protocol that activates skills on a schedule. Orient is the skill that bridges the two patterns: it is both a skill (encoding situational awareness judgment) and a protocol step (Step 1 of the autonomous work cycle).
- **Inline Logging** ([patterns/inline-logging.md](inline-logging.md)) — the convention that skills produce outputs which are immediately logged, not deferred. Skills that analyze results feed directly into log entries.
- **Creative Intelligence Framework** ([docs/creative-intelligence.md](../../../docs/creative-intelligence.md)) — the five-layer model (L1-L5) that skills reference when attributing findings to CI layers. The skills architecture's four layers (L0-L3) describe formalization levels, not CI layers — the two hierarchies are orthogonal.
