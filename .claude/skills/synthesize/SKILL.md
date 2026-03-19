---
name: synthesize
description: "Use when multiple experiments or analyses have accumulated and their findings need to be interpreted together"
complexity: opus-only
model-minimum: opus
disable-model-invocation: false
allowed-tools: ["Read", "Grep", "Glob"]
argument-hint: "[project name, time range, topic, or file paths]"
---

# /synthesize <scope>

You are synthesizing accumulated findings to surface patterns, contradictions, and insights that individual log entries or analyses miss on their own. The argument specifies the scope: a project name, a time range, a topic, or specific file paths.

## Pre-flight audit

Before writing synthesis output, run the synthesis pre-flight audit (`docs/sops/synthesis-preflight-audit.md`). Enumerate upstream sources, flag provisional data, and spot-check key numerical claims that will be cited. This prevents the most common synthesis failure: propagating contaminated or stale numbers from prior sessions.

## Gather material

Based on the scope argument:

- If a project name: read the project README (especially Log and Open questions), any files in the project directory, and related decision records.
- If a time range: scan logs across all active projects for entries in that range.
- If a topic: grep across projects, decisions, and docs for relevant material.
- If file paths: read those files directly.

Also check `decisions/` for relevant recorded choices and `docs/` for framework documents.

## Analyze across CI layers

For the gathered material, identify:

1. **Cross-layer causal chains** — Findings that connect across CI layers. (e.g., "The evaluation gap [L4] exists because the interface [L3] can't present 3D interactively to LLMs, which limits what the model [L1] can judge.")
2. **Convergent signals** — Multiple independent findings pointing to the same conclusion. What do they converge on?
3. **Contradictions** — Findings that conflict with each other. Which is better grounded? What would resolve the disagreement?
4. **Gaps** — What questions remain unasked? What CI layers are underrepresented in the findings? What experiments would fill the gaps?
5. **Gravity candidates** — Recurring patterns that should be formalized. What manual work could become automated tooling? What tooling could become model capability?

## Output format

```
## Synthesis: <scope>

### Material reviewed
<bulleted list of files/entries consulted>

### Cross-layer chains
<numbered findings, each tracing a connection across 2+ CI layers>

### Convergent signals
<what multiple findings agree on — with specific references>

### Contradictions
<conflicting findings and what would resolve them>

### Gaps
<what's missing — specific questions or unexamined CI layers>

### Gravity candidates
<patterns that should move downward — from manual to tool to model>

### Implications
<1-3 concrete recommendations for what to do next, referencing specific projects or actions>
```

Prioritize insight density over comprehensiveness. A synthesis that surfaces one genuine cross-layer insight is more valuable than one that restates what the logs already say.

## Save to disk

Write the synthesis to `projects/<project>/analysis/<scope-slug>-synthesis-YYYY-MM-DD.md`. Use the project most relevant to the synthesis scope.

## Task Bridge

After saving the synthesis, convert actionable implications to tasks:

1. For each item in the "Implications" section that contains a concrete action verb (implement, create, run, update, design, investigate, fix):
   - Check the project's TASKS.md for an existing task covering the same action
   - If no existing task, create one:
     - Imperative description derived from the implication
     - `[fleet-eligible]` or `[requires-opus]` per fleet-eligibility checklist
     - `[skill: ...]` tag matching the work type
     - `Done when:` from the implication's expected outcome
     - `Why:` referencing this synthesis file path
2. For "Gaps" that suggest specific experiments or investigations: create tasks referencing `/design` or `/diagnose`
3. For "Gravity candidates" rated "formalize now": create a task to run `/gravity` on the candidate
4. Skip implications that are purely observational or contextual

Cross-session synthesis insights are among the highest-value outputs the system produces. Converting them to tasks ensures they are acted upon rather than rediscovered.

## Commit

Follow `docs/sops/commit-workflow.md`. Commit message: `synthesize: <scope summary>`
