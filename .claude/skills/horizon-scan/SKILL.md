---
name: horizon-scan
description: "Use when Youji needs to proactively scan for new GenAI developments — model releases, capability changes, relevant research"
argument-hint: "[focus area] — e.g., 'agent frameworks', 'LLM evaluation', or omit for broad scan"
---

# /horizon-scan [focus area]

Proactively scan external sources for GenAI developments relevant to Youji's active projects. This skill replaces ad-hoc knowledge injection for routine developments (new model releases, benchmark results, capability announcements, relevant papers).

If a focus area is provided (e.g., "agent frameworks", "LLM evaluation"), narrow the scan to that domain. Otherwise, scan broadly across all active project concerns.

## Step 1: Determine scan scope

Read the following to understand what Youji currently cares about:

1. **Active projects**: read each active project's README for Mission, Open questions, and recent log entries.
2. **Open questions**: Collect open questions from all active project READMEs. These are the knowledge gaps horizon-scan aims to fill.
3. **Cross-project knowledge**: Check `knowledge/` for established context.

From this, produce a **scan agenda**: 3-5 specific topics to search for, each tied to a project need or open question.

## Step 2: Search

For each topic in the scan agenda, run 2-3 WebSearch queries. Use time-bounded queries where possible (include the current month/year to find recent results).

Search strategy:
- **Model releases**: Search for "[model family] new release [year]", "[model family] announcement"
- **Capabilities**: Search for "[capability] benchmark results [year]", "[capability] evaluation"
- **Research**: Search for "[topic] arxiv [year]", "[topic] research paper"
- **Tools/APIs**: Search for "[tool] release", "[API] update changelog"

Collect all results. Aim for 10-20 raw results across all topics.

## Step 3: Triage and verify

For each search result, classify:

- **Actionable**: New model release, capability change, or benchmark result that directly affects a Youji project. **Must verify.**
- **Informative**: Relevant paper or technique that adds context. **Verify if creating a literature note.**
- **Noise**: Irrelevant, outdated, or redundant. **Skip.**

**Verification (mandatory for all actionable and informative items):**

1. **Fetch the URL** using WebFetch.
2. **Confirm the claim**: Does the page actually say what the search snippet claimed?
3. **Extract key facts**: dates, version numbers, benchmark scores, capability descriptions. Only record facts from the fetched page.
4. **On verification failure** (404, paywall, content doesn't match): Do NOT record as a finding.

## Step 4: Record findings

For each verified finding, determine where it belongs:

### Model releases or capability changes
- Note in the relevant project's README or a knowledge file
- **MANDATORY: Create a task** in the relevant project's TASKS.md:
```
- [ ] Evaluate [model name] against known capability baselines
  Why: Horizon-scan detected new release. [1-sentence summary].
  Done when: Model evaluated; decision recorded.
  Priority: medium
  Source: horizon-scan YYYY-MM-DD, [URL]
```

### Relevant research papers
- If load-bearing: create a literature note following the `/lit-review` schema. Mark `Verified: YYYY-MM-DD`.
- If actionable: also create a task.
- If contextual: note in the scan report only.

### Tool/API changes
- Update the relevant project file.
- If the change unblocks a task, update lifecycle tags.
- If the change enables new work, create a task.

## Step 5: Write scan report

Write to `knowledge/horizon-scans/horizon-scan-YYYY-MM-DD.md`:

```markdown
# Horizon Scan: YYYY-MM-DD

Scope: [focus area or "broad"]
Topics scanned: [list from scan agenda]
Sources checked: [count of URLs fetched and verified]

## Actionable findings

### [Finding title]
- **What**: [1-2 sentence summary]
- **Source**: [verified URL]
- **Affects**: [project name, capability, or open question]
- **Action taken**: [what was updated — task created, literature note, etc.]

## Informative findings

- [Brief summary with source URL] — relevant to [project/question]

## No-signal topics

- [Topic]: No new developments found since [last scan date or "initial scan"]

## Gaps

- [Topic where verification failed or sources were unavailable]
```

## Step 6: Impact assessment

After recording all findings, assess whether any finding changes priorities:

1. **Does a new model release warrant immediate evaluation?** Ensure a task exists.
2. **Does a finding invalidate an assumption in an active project?** Add to the project's README Open questions.
3. **Does a finding unblock a previously blocked task?** Update lifecycle tags.
4. **Does a finding suggest a new project?** Note in the report — flag for researcher review, do not create projects autonomously.

## Commit

Commit message: `horizon-scan: [date] — [N] actionable, [M] informative findings`

## Constraints

- **Verification is mandatory.** Never record a finding from search snippets alone.
- **Scope is project-bounded.** Scan for what Youji needs, not the entire GenAI landscape.
- **No hallucinated sources.** If a URL cannot be fetched, the finding is not recorded.
- **Conservative recording.** When uncertain, note in the scan report but do not create project artifacts.
- **Cost awareness.** Aim for 10-20 fetches per scan, not 50+.
- **No autonomous project creation.** Flag new research directions for researcher review.
