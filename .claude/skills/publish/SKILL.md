---
name: publish
description: "Use when a paper draft exists and needs to be prepared for venue submission or arxiv preprint"
complexity: high
model-minimum: gpt-5
disable-model-invocation: false
allowed-tools: ["Read", "Grep", "Glob", "WebSearch", "WebFetch", "Bash", "Write", "Edit"]
argument-hint: "[project name or paper path]"
---

# /publish <project name or paper path>

You are preparing a research paper for submission. Your job is to take an existing draft through a structured publication pipeline: verify completeness, check citations, format for the target venue, create figures, anonymize, and produce a submission-ready artifact.

The argument is a project name (reads `publications/` directory) or a direct path to a paper file.

## Step 0: Locate and assess the paper

1. Find the paper draft. If given a project name, look in `projects/<name>/publications/`. If given a path, read it directly.
2. Read the paper and identify:
   - Current state (draft, formatted, submission-ready)
   - Target venue (check for venue selection experiment or task notes)
   - Deadline (check TASKS.md for deadline notes)
   - Content completeness (are all sections filled in?)
3. Read the project README and TASKS.md for context on what the paper covers.

## Step 0.5: Synthesis pre-flight audit (mandatory)

Before assessing content, verify that the upstream data the paper builds on is actually correct. Follow the procedure at `docs/sops/synthesis-preflight-audit.md`:

1. **Enumerate upstream sources** — list every experiment, analysis, and literature note the paper cites
2. **Flag provisional data** — check `status:` and `data_quality:` fields in EXPERIMENT.md frontmatter
3. **Verify key numerical claims** — for numbers that appear in the abstract, tables, or drive conclusions, trace to the computational source (script + data file) and re-verify. Do NOT accept numbers copied from text.
4. **Verify literature citations** — check `Verified:` field in literature notes; fetch URLs for any unverified citations
5. **Check cross-experiment comparisons** — verify denominators match and are explicitly stated
6. **Gate decision** — if any key claim is unverifiable or mismatched, fix before proceeding to Step 1

This step catches the most common synthesis failure: treating prior session outputs as verified ground truth when they may contain contaminated data, stale numbers, or fabricated citations (7 documented incidents — see `projects/youji/feedback/feedback-incorrect-experiment-contamination-analysis-2026-03-01.md`).

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
- Every citation has a verified URL/DOI (check `verified` field in literature notes)
- No claims sourced from parametric memory alone

**Missing content flags:**
- Sections with placeholder text or TODOs
- Results referenced but not presented
- Figures referenced but not created
- Related work entries without verified citations

Report gaps as a checklist. If critical gaps exist, stop and list them before proceeding.

## Step 2: Citation verification

Run `/audit-references` on the paper or manually verify:
1. Every in-text citation maps to a reference entry
2. Every reference entry has a verified URL/DOI
3. No orphan references (listed but never cited)
4. No orphan citations (cited but not in reference list)

If unverified citations exist, flag them. For submissions, all citations must be verified.

## Step 3: Venue formatting

Based on the target venue:

1. **Identify format requirements:**
   - Page limit (content pages vs total including refs)
   - Template/style file (LaTeX class, author kit)
   - Anonymization requirements (double-blind, single-blind, open)
   - Supplemental materials policy
   - Figure/table formatting guidelines

2. **Check tool availability:**
   - LaTeX compiler available? (`which pdflatex xelatex lualatex tectonic 2>/dev/null`)
   - Plotting tools? (`python -c "import matplotlib" 2>/dev/null`)
   - If tools are missing, note this as a blocker and file a tool-access request to `APPROVAL_QUEUE.md` if not already filed.

3. **If tools are available, format the paper:**
   - Convert markdown to LaTeX using the venue template
   - Create figures from data (tables → charts where appropriate)
   - Verify page count fits venue limits
   - Generate PDF and check formatting

4. **If tools are NOT available:**
   - Prepare the markdown content to be as close to submission-ready as possible
   - Create figure specifications (what each figure should show, data source, chart type)
   - Document the exact formatting steps needed when tools become available
   - Ensure all content fits estimated page count

## Step 4: Anonymization (if required)

For double-blind venues:
1. Remove author names and affiliations
2. Replace self-references with anonymous placeholders ("We previously showed [Anonymous, 2026]")
3. Remove repository URLs that identify authors
4. Check acknowledgments section
5. Remove or anonymize any identifying information in supplemental materials
6. Search for project name, author names, and repo URLs throughout the document

For open review venues: skip this step.

## Step 5: Self-review checklist

Before declaring submission-ready, verify:

- [ ] Abstract accurately reflects the paper's content and results
- [ ] All figures and tables are referenced in the text
- [ ] All figures have descriptive captions
- [ ] Notation is consistent throughout
- [ ] Related work fairly represents prior art (not just citation-padding)
- [ ] Limitations section is honest about what the work does NOT show
- [ ] Conclusion does not overclaim (claims match evidence strength)
- [ ] References are formatted consistently
- [ ] Paper fits within page limits
- [ ] Supplemental materials (if any) are self-contained

## Step 6: Produce submission artifacts

Create the submission directory:
```
projects/<project>/publications/<paper-name>/<venue>/
  paper.tex (or paper.md if no LaTeX)
  figures/
  supplemental/
  submission-checklist.md
```

The `submission-checklist.md` records:
- Venue name and deadline
- Submission format (PDF, LaTeX source, etc.)
- Anonymization status
- Tool access status (what's available, what's missing)
- Outstanding items before submission
- Venue-specific requirements checklist

## Output

After completing all steps, report:
1. Paper state (ready, near-ready with gaps listed, blocked)
2. Outstanding items (as a numbered list with effort estimates)
3. Any approval items filed

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "The citation is probably correct, I'll skip verification" | Hallucinated citations are the #1 quality risk. Verify every citation mechanically. |
| "We can fix formatting later" | Formatting reveals content gaps (figures that don't exist, results that don't fit). Format early. |
| "Anonymization is trivial" | One missed self-reference or repo URL can reveal authorship. Use systematic search. |
| "The page limit is a soft guideline" | Venues desk-reject papers that exceed page limits. Treat limits as hard constraints. |

## Commit

Follow `docs/sops/commit-workflow.md`. Commit message: `publish: <paper-name> — <venue> submission preparation`
