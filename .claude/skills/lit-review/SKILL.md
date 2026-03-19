---
name: lit-review
description: "Use when a research topic needs literature review, or when papers need to be found and documented for a project"
complexity: medium
model-minimum: glm-5
disable-model-invocation: false
allowed-tools: ["Read", "Write", "Grep", "Glob", "WebSearch", "WebFetch", "Bash(git *)"]
---

# /lit-review <topic> [project path]

You are conducting a literature review on the given topic. If a project path is provided, focus the review on that project's needs — read the project README first to understand the mission, open questions, and what's already known.

## Step 1: Understand the need

- If a project path is given, read its README. Identify open questions and gaps that literature could address.
- Identify which CI layers are most relevant to the topic.

## Step 2: Search

Use WebSearch to find relevant papers, technical reports, and blog posts. Search for:
- The topic directly
- The topic combined with CI-relevant terms (e.g., "LLM judge evaluation metrics", "3D asset quality benchmark")
- Key authors or venues if known from prior literature notes

Aim for breadth first — collect 8-15 candidate sources.

## Step 3: Triage

For each candidate, make a quick judgment:

- **Load-bearing**: Directly addresses an open question or gap. Must read in detail.
- **Contextual**: Provides useful background or methodology. Worth a note.
- **Incremental**: Minor variation on known work. Skip unless nothing better exists.

Read load-bearing and contextual papers using WebFetch. Skip incremental ones.

## Step 4: Verify and write literature notes

For each paper worth keeping, you MUST mechanically verify the URL before creating a note. This is mandatory — never create notes from memory alone.

**Verification procedure (per paper):**

1. **Fetch the URL** using WebFetch. For arxiv URLs, fetch the abstract page (e.g., `https://arxiv.org/abs/XXXX.XXXXX`).
2. **Title match**: Compare the fetched page title against the claimed title. Minor formatting differences are acceptable; a completely different topic is a FAIL.
3. **Author match**: Confirm at least one claimed author appears on the fetched page.
4. **On PASS**: Create the literature note with `Verified: YYYY-MM-DD` (today's date).
5. **On FAIL**: Do NOT create a literature note. Record the topic as a gap in the review summary. Never substitute a fabricated citation.
6. **On inconclusive** (paywall, 404, timeout): Create the note with `Verified: false` and flag for manual verification. Do not cite in publications until verified.

Save verified notes to `literature/` within the project directory (create it if needed), or to `docs/literature/` if not project-specific. Follow the literature note schema in CLAUDE.md.

Key requirements:
- **Mechanical URL verification is mandatory.** Parametric memory ("I know this paper exists") is not verification. You must fetch the URL and confirm title + author.
- **Direct quotes for key claims.** Do not paraphrase — quote the authors and cite the page or section.
- **CI layer mapping.** State which CI layers the paper addresses and how.

## Step 5: Gap analysis

After reviewing the literature, identify:
- What questions from the project remain unanswered by the literature?
- Which CI layers are well-covered vs. under-studied?
- Are there methodological patterns across papers that we should adopt or avoid?

## Step 6: Create follow-up tasks

**MANDATORY.** Literature reviews often reveal actionable findings that require follow-up work. You must create tasks to ensure this work happens.

For each load-bearing paper that addresses an open question or enables new work:

1. **Identify the action**: What does this paper enable or suggest? (e.g., "Evaluate method X on our dataset", "Implement technique Y", "Compare our approach to baseline Z")

2. **Create a task** in the relevant project's `TASKS.md`:
   ```
   - [ ] <action verb phrase>
     Why: Literature review finding — <paper title> enables/suggests <brief rationale>.
     Done when: <observable condition>
     Priority: medium
     Source: lit-review YYYY-MM-DD, <paper title>
   ```

3. **If no tasks are warranted** (literature fully answers questions with no follow-up needed), state this explicitly in the review summary: "No follow-up tasks: literature fully addressed the inquiry."

This gate ensures literature discoveries become actionable work, not forgotten knowledge.

## Output format

```
## Literature review: <topic>
Scope: <project name or "general">
Date: YYYY-MM-DD

### Papers reviewed
| Title | Type | CI Layers | Verdict |
|---|---|---|---|
| <title> | load-bearing / contextual / incremental | L1-L5 | <1-line summary> |

### Key findings
<bulleted list of the most important things learned, with paper references>

### Gap analysis
<what remains unknown, which CI layers are under-studied>

### Follow-up tasks
<list of tasks created in project TASKS.md files, or "None: literature fully addressed the inquiry.">

### Recommended reading order
<if someone has limited time, which 2-3 papers matter most and why>

### Notes saved
<list of literature note files created, with paths>
```

Prioritize quality over quantity. Three well-analyzed load-bearing papers are worth more than ten superficial summaries.

## Commit

Follow `docs/sops/commit-workflow.md`. Commit message: `lit-review: <topic> — <N> papers reviewed`
