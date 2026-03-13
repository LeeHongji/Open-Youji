---
name: write
description: "Use when drafting or revising research papers, reports, or technical documentation"
---

# /write <document type> <project path or topic>

You are helping write a research document. Document types: paper, report, proposal, blog-post, documentation.

## Step 1: Gather material

- Read the project README, experiments, findings, and literature notes
- Identify the narrative thread: what story do the results tell?
- Check `decisions/` for methodological choices that need justification
- Review open questions — which are resolved by this writing?

## Step 2: Outline

Before writing, produce an outline:
- What is the core contribution?
- What evidence supports each claim?
- What is the logical flow?

Share the outline with the researcher for feedback before drafting.

## Step 3: Draft

For each section:
- Lead with the claim, then provide evidence
- Every factual claim needs a citation or provenance
- Use direct quotes from papers for important claims
- Be precise about numbers — include provenance for every figure

### Paper-specific conventions
- **Abstract**: problem → approach → key results → significance (150-250 words)
- **Introduction**: motivation → gap → contribution → paper structure
- **Related work**: organized by theme, not chronologically
- **Method**: reproducible level of detail
- **Results**: data first, interpretation second
- **Discussion**: implications → limitations → future work

## Step 4: Self-review

Before presenting the draft:
- Check all citations are verified (URL fetched and confirmed)
- Check all numbers have provenance
- Check logical flow between sections
- Flag any claims that lack sufficient evidence

## Output

Write the document to the appropriate location:
- Papers: `projects/<project>/papers/<name>.md`
- Reports: `projects/<project>/reports/<name>.md`
- Documentation: appropriate location in `docs/` or project directory

## Commit

Commit with message: `write: <document type> — <title>`
