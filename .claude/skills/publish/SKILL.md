---
name: publish
description: "Use when a paper draft exists and needs to be prepared for venue submission or arxiv preprint"
argument-hint: "[project name or paper path]"
---

# /publish <project name or paper path>

You are preparing a research paper for submission. Your job is to take an existing draft through a structured publication pipeline: verify completeness, check citations, format for the target venue, and produce a submission-ready artifact.

The argument is a project name (reads `papers/` or `publications/` directory) or a direct path to a paper file.

## Step 0: Locate and assess the paper

1. Find the paper draft. If given a project name, look in `projects/<name>/papers/` or `projects/<name>/publications/`. If given a path, read it directly.
2. Read the paper and identify:
   - Current state (draft, formatted, submission-ready)
   - Target venue (check for venue selection notes)
   - Deadline (check TASKS.md)
   - Content completeness (are all sections filled in?)
3. Read the project README and TASKS.md for context.

## Step 0.5: Pre-flight audit (mandatory)

Before assessing content, verify that upstream data is correct:

1. **Enumerate upstream sources** — list every experiment, analysis, and literature note the paper cites
2. **Flag provisional data** — check experiment status fields
3. **Verify key numerical claims** — for numbers in the abstract, tables, or driving conclusions, trace to computational source and re-verify. Do NOT accept numbers copied from text.
4. **Verify literature citations** — check `Verified:` field in literature notes; fetch URLs for any unverified
5. **Check cross-experiment comparisons** — verify denominators match
6. **Gate decision** — if any key claim is unverifiable or mismatched, fix before proceeding

## Step 1: Content audit

Check the paper against these requirements:

**Structure:**
- Abstract (concise, states the problem, approach, key results, and conclusion)
- Introduction (motivation, contributions, paper organization)
- Related work (positions against prior art, cites relevant work)
- Method/approach (reproducible description)
- Results (quantitative with proper metrics)
- Discussion (limitations, implications, future work)
- Conclusion

**Provenance:**
- Every numerical claim has a source (script + data file, or inline arithmetic)
- Every citation has a verified URL/DOI
- No claims sourced from parametric memory alone

**Missing content flags:**
- Sections with placeholder text or TODOs
- Results referenced but not presented
- Figures referenced but not created
- Related work entries without verified citations

Report gaps as a checklist. If critical gaps exist, stop and list them.

## Step 2: Citation verification

Run `/audit-references` on the paper or manually verify:
1. Every in-text citation maps to a reference entry
2. Every reference entry has a verified URL/DOI
3. No orphan references (listed but never cited)
4. No orphan citations (cited but not in reference list)

## Step 3: Venue formatting

Based on the target venue:
1. **Identify format requirements** (page limit, template, anonymization, supplemental policy)
2. **Check tool availability** (LaTeX compiler, plotting tools)
3. **Format the paper** if tools are available; otherwise prepare content and document formatting steps
4. **Verify page count** fits venue limits

## Step 4: Anonymization (if required)

For double-blind venues:
1. Remove author names and affiliations
2. Replace self-references with anonymous placeholders
3. Remove repository URLs that identify authors
4. Check acknowledgments section
5. Search for project name, author names, and repo URLs throughout

## Step 5: Self-review checklist

- [ ] Abstract accurately reflects the paper's content and results
- [ ] All figures and tables are referenced in the text
- [ ] All figures have descriptive captions
- [ ] Notation is consistent throughout
- [ ] Related work fairly represents prior art
- [ ] Limitations section is honest about what the work does NOT show
- [ ] Conclusion does not overclaim
- [ ] References are formatted consistently
- [ ] Paper fits within page limits
- [ ] Supplemental materials (if any) are self-contained

## Step 6: Produce submission artifacts

Create the submission directory:
```
projects/<project>/papers/<paper-name>/<venue>/
  paper.tex (or paper.md if no LaTeX)
  figures/
  supplemental/
  submission-checklist.md
```

## Output

After completing all steps, report:
1. Paper state (ready, near-ready with gaps listed, blocked)
2. Outstanding items (numbered list with effort estimates)
3. Any blockers

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "The citation is probably correct" | Hallucinated citations are the #1 quality risk. Verify mechanically. |
| "We can fix formatting later" | Formatting reveals content gaps. Format early. |
| "Anonymization is trivial" | One missed self-reference can reveal authorship. Use systematic search. |
| "The page limit is a soft guideline" | Venues desk-reject papers that exceed limits. |

## Commit

Commit message: `publish: <paper-name> — <venue> submission preparation`
