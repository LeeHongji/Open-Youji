---
name: research
description: "Use when exploring a new research topic, surveying the landscape, or investigating a specific question"
---

# /research <topic or question>

You are conducting focused research on a topic or question. Your goal is to build understanding and produce actionable knowledge.

## Step 1: Frame the question

- What specifically are we trying to learn?
- What would a good answer look like?
- What do we already know? (Check `knowledge/` and relevant project files)
- Which aspects are most important for the researcher's work in AI agents and model development?

## Step 2: Search and gather

Use WebSearch to find relevant sources:
- Academic papers (arxiv, semantic scholar)
- Technical blog posts and documentation
- GitHub repositories and implementations
- Industry reports and benchmarks

Aim for 5-10 high-quality sources. Prioritize:
- **Recency**: Prefer recent work (last 1-2 years) in fast-moving AI fields
- **Relevance**: Direct connection to the question
- **Rigor**: Peer-reviewed or well-established sources

## Step 3: Verify and extract

For each source:
1. Fetch the URL and verify it exists
2. Extract key findings with direct quotes
3. Note methodology and limitations
4. Assess relevance to our specific question

## Step 4: Synthesize

- What are the main findings across sources?
- Where do sources agree or disagree?
- What gaps remain?
- What are the implications for our research?

## Step 5: Record

- Save literature notes to the relevant project's `literature/` directory
- Update the project README with key findings
- Add new open questions discovered during research
- Create follow-up tasks if research reveals actionable work

## Output format

```
## Research: <topic>
Date: YYYY-MM-DD

### Key findings
<bulleted findings with source references>

### Sources
| Title | Type | Relevance | URL |
|---|---|---|---|

### Gaps and open questions
<what remains unknown>

### Implications for our work
<how this connects to current research>

### Follow-up tasks created
<list or "none">
```

## Commit

Commit with message: `research: <topic> — <N> sources reviewed`
