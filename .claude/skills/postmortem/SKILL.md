---
name: postmortem
description: "Use when an agent produced a flawed output and you need to understand why the reasoning went wrong"
complexity: opus-only
model-minimum: opus
disable-model-invocation: false
allowed-tools: ["Read", "Grep", "Glob"]
argument-hint: "[file path, log entry, or description of the failure]"
---

# /postmortem <path or failure description>

Analyze why an agent (LLM or pipeline) produced a flawed output. The goal is not to explain the technical mechanism but to identify the reasoning failure that led to the flaw being produced and not caught. The argument is a file path or description of the failure. Read relevant files first.

## When to use this vs alternatives

- **Use `/postmortem`** when an agent or pipeline produced a flawed output that was *presented as correct* — the question is "why wasn't this caught?" not "what went wrong in the data?"
- **Use `/diagnose`** when the focus is on understanding *empirical results* — error distributions, root-cause hypotheses, validity. Diagnose analyzes data; postmortem analyzes agent reasoning.
- **Use `/critique`** for a broad review of an artifact's quality. Critique is proactive ("find problems"); postmortem is reactive ("explain this specific failure").

## Key distinction

The question is never "why is the output wrong?" — it is "why was this output presented as correct?"

A wrong prediction is expected. A wrong prediction reported as a finding, deployed to a dashboard, or used to make a decision is a reasoning failure worth analyzing.

## Procedure

### 1. Identify the flaw

State precisely what was wrong, with evidence. Quote the flawed output.

### 2. Trace the production chain

Walk backward through the chain that produced the flaw:
- **Who generated it?** (which agent, script, or pipeline step)
- **What inputs did they have?** (were the inputs sufficient to detect the flaw?)
- **What checks were skipped?** (was there a review step that should have caught it?)
- **What structural condition enabled it?** (missing verification gate, context window limits, anchoring on prior output, pattern-matching without verification, ungrounded generation beyond reliable recall)

### 3. Classify the failure mode

Which of these caused the flaw?

- **Design-as-discovery**: A constraint of the experimental setup was reported as an empirical finding. The agent failed to ask "could this have been different?"
- **Layer misattribution**: A property of one CI layer was attributed to another (e.g., L4 evaluation constraint reported as L1 model behavior)
- **Momentum override**: The agent was executing a plan and did not pause to verify intermediate results. Production outpaced reflection.
- **Anchoring**: The agent saw a number or pattern and built a narrative around it without checking the generating process.
- **Missing mental model**: The agent lacked understanding of how the metric/system works and could not detect the flaw even in principle.
- **Context loss**: The relevant information existed but was not in the agent's working context when the decision was made (e.g., schema defined in a different file than the analysis).
- **Social proof**: The agent reported something because it looked like what a finding "should" look like, not because it was verified.
- **Ungrounded generation**: The model produced plausible but factually false content because autoregressive generation cannot distinguish retrieval from novel generation. This is the default behavior of foundation models, not a situational failure — any generation task that exceeds reliably grounded knowledge will produce hallucinated output.

**Anti-anthropomorphism constraint:** Never attribute model failures to human psychological states (pressure, confusion, fatigue, rushing, carelessness). LLMs do not experience these. Use mechanistic explanations grounded in model architecture: ungrounded generation, token probability vs truth, context window limits, training distribution mismatch, missing verification gate. Anthropomorphic framings foreclose deeper investigation by implying the fix is "less pressure" rather than architectural safeguards.

### 4. Identify the prevention

What specific check, convention, or tool would have caught this flaw before it was produced?

- Is there an existing convention in CLAUDE.md that was not followed?
- Should a new convention be added? If so, propagate it to all locations where it applies (CLAUDE.md, SOPs, decision records, skills) in the same turn.
- Would a skill (`/review`, `/critique`) have caught it?
- Should the pipeline itself include a validation step?

If the prevention involves creating a decision record (ADR), and the ADR includes action items not implemented in this session, create corresponding tasks in the relevant project's `TASKS.md` before committing (ADR task bridge — see CLAUDE.md Decisions section).

### 5. Record model limits (if L1 root cause)

If the failure mode or root cause involves L1 (Model) — including ungrounded generation, missing mental model due to model capability gaps, or any structural condition attributable to model architecture — record it in the same turn.

Youji does not ship a shared model capability registry. Record model-specific limits in one of:

1. The relevant project README (as an open question or warning)
2. The postmortem itself (with evidence and mitigation)
3. A local model-notes doc in your own fork

Skip this step only if the root cause is entirely at L2-L5 with no L1 component.

## Output format

```
## Postmortem: <brief title>

### The flaw
<what was wrong, with direct quote>

### Production chain
1. <step> — <what happened>
2. <step> — <what happened>
3. <step> — <where the flaw was introduced or missed>

### Failure mode
<classified type>: <specific explanation>

### Root cause
<one sentence: why the flaw was produced AND not caught>

### Prevention
- Existing convention missed: <reference or "none">
- New convention needed: <specific proposal or "none">
- Skill that would catch this: <name or "none">
- Pipeline change needed: <specific proposal or "none">

### Downstream Impact
<If the postmortem corrects previously-reported findings, list downstream consumers per ADR 0051.
Omit this section if the error did not produce any cited findings.>

### Severity
<high | medium | low> — <consequence if the flaw had not been caught>

### Model-limit notes
<"Recorded model-specific limit: <what was added/changed>" or "No L1 component — skip">
```

## Save to disk

Write the postmortem to `projects/<project>/postmortem/postmortem-<brief-slug>-YYYY-MM-DD.md`. Create the `postmortem/` directory if it doesn't exist yet. Use the project where the failure occurred.

## Task Bridge

After saving the postmortem to disk, convert prevention actions to tasks:

1. For each item in the "Prevention" section:
   - If "New convention needed" → create a task to update the relevant convention/skill
   - If "Pipeline change needed" → create a task for the code change
   - If "Skill that would catch this" → check if the skill already exists; if not, create a task
   - Check the project's TASKS.md for existing tasks covering the same action before creating duplicates
2. Tag each task:
   - Convention/skill updates → `[fleet-eligible] [skill: record]`
   - Code changes → `[fleet-eligible] [skill: execute]` or `[requires-opus]` if complex
   - `Done when:` derived from the prevention specification
   - `Why:` referencing this postmortem file path
3. If the postmortem results in an ADR with migration steps, the ADR task bridge (existing convention) also applies

This ensures prevention actions are executed rather than rediscovered in future postmortems of the same failure mode.

## Commit

Follow `docs/sops/commit-workflow.md`. Commit message: `postmortem: <brief title of the failure analyzed>`
