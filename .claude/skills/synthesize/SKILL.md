---
name: synthesize
description: "Use when multiple experiments or analyses have accumulated and their findings need to be interpreted together"
argument-hint: "[project name, time range, topic, or file paths]"
---

# /synthesize <scope>

You are synthesizing accumulated findings to surface patterns, contradictions, and insights that individual log entries or analyses miss on their own. The argument specifies the scope: a project name, a time range, a topic, or specific file paths.

## Pre-flight audit

Before writing synthesis output, enumerate upstream sources, flag provisional data, and spot-check key numerical claims that will be cited. This prevents the most common synthesis failure: propagating contaminated or stale numbers from prior sessions.

## Gather material

Based on the scope argument:

- If a project name: read the project README (especially Log and Open questions), all files in the project directory, and related decision records.
- If a time range: scan logs across all active projects for entries in that range.
- If a topic: grep across projects, decisions, and knowledge files for relevant material.
- If file paths: read those files directly.

Also check `decisions/` for relevant recorded choices and `knowledge/` for cross-project insights.

## Analyze across CI layers

For the gathered material, identify:

1. **Cross-layer causal chains** — Findings that connect across CI layers. (e.g., "The evaluation gap [L4] exists because the interface [L3] can't present 3D interactively to LLMs, which limits what the model [L1] can judge.")
2. **Convergent signals** — Multiple independent findings pointing to the same conclusion. What do they converge on?
3. **Contradictions** — Findings that conflict with each other. Which is better grounded? What would resolve the disagreement?
4. **Gaps** — What questions remain unasked? What CI layers are underrepresented in the findings? What experiments would fill the gaps?
5. **Gravity candidates** — Recurring patterns that should be formalized. What manual work could become automated tooling? What tooling could become convention?

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
<patterns that should move downward — from manual to tool to convention>

### Implications
<1-3 concrete recommendations for what to do next, referencing specific projects or actions>
```

Prioritize insight density over comprehensiveness. A synthesis that surfaces one genuine cross-layer insight is more valuable than one that restates what the logs already say.

## Save to disk

Write the synthesis to `projects/<project>/analysis/<scope-slug>-synthesis-YYYY-MM-DD.md`. Use the project most relevant to the synthesis scope.

## Task Bridge

After saving the synthesis, convert actionable implications to tasks:

1. For each item in "Implications" with a concrete action verb (implement, create, run, update, design, investigate, fix):
   - Check the project's TASKS.md for an existing task covering the same action
   - If no existing task, create one with `Done when:` and `Why:` referencing this synthesis
2. For "Gaps" that suggest experiments: create tasks referencing `/design` or `/diagnose`
3. For "Gravity candidates" rated "formalize now": create a task to run `/gravity`
4. Skip implications that are purely observational or contextual

Cross-session synthesis insights are among the highest-value outputs the system produces. Converting them to tasks ensures they are acted upon.

## Commit

Commit message: `synthesize: <scope summary>`
