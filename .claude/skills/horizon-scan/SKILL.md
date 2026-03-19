---
name: horizon-scan
description: "Use when youji needs to proactively scan for new GenAI developments — model releases, capability changes, relevant research — rather than waiting for human input"
complexity: medium
model-minimum: glm-5
disable-model-invocation: false
allowed-tools: ["Read", "Write", "Grep", "Glob", "WebSearch", "WebFetch", "Bash(git *)"]
---

# /horizon-scan [focus area]

Proactively scan external sources for GenAI developments relevant to youji's active projects. This skill replaces human knowledge injection for routine developments (new model releases, benchmark results, capability announcements, relevant papers).

If a focus area is provided (e.g., "3D generation models", "LLM judge evaluation"), narrow the scan to that domain. Otherwise, scan broadly across all active project concerns.

## Step 1: Determine scan scope

Read the following to understand what youji currently cares about:

1. **Active projects**: `ls projects/` → read each active project's README for Mission, Open questions, and recent log entries.
2. **Model changes (if relevant)**: new model releases or API changes that might affect current work.
3. **Open questions**: Collect open questions from all active project READMEs. These are the knowledge gaps horizon-scan aims to fill.
4. **Prior scan reports**: Check `.scheduler/skill-reports/horizon-scan-*.md` for previous scans to avoid redundant coverage.

From this, produce a **scan agenda**: 3-5 specific topics to search for, each tied to a project need or open question. Example:

```
Scan agenda:
1. New model releases since last scan (if you track models)
2. 3D generation quality benchmarks or evaluations (sample-project open questions)
3. LLM agent architecture papers (youji design-patterns paper related work)
4. Multi-modal evaluation methods (sample-project judge methodology)
```

## Step 2: Search

For each topic in the scan agenda, run 2-3 WebSearch queries. Use time-bounded queries where possible (e.g., include the current month/year to find recent results).

Search strategy:
- **Model releases**: Search for "[model family] new release 2026", "[model family] announcement"
- **Capabilities**: Search for "[capability] benchmark results 2026", "[capability] evaluation"
- **Research**: Search for "[topic] arxiv 2026", "[topic] research paper"
- **Tools/APIs**: Search for "[tool] release", "[API] update changelog"

Collect all results. Aim for 10-20 raw results across all topics.

## Step 3: Triage and verify

For each search result, classify:

- **Actionable**: New model release, capability change, or benchmark result that directly affects an youji project. **Must verify.**
- **Informative**: Relevant paper or technique that adds context. **Verify if creating a literature note.**
- **Noise**: Irrelevant, outdated, or redundant. **Skip.**

**Verification (mandatory for all actionable and informative items):**

1. **Fetch the URL** using WebFetch.
2. **Confirm the claim**: Does the page actually say what the search snippet claimed? Read the fetched content carefully.
3. **Extract key facts**: dates, version numbers, benchmark scores, capability descriptions. Only record facts that appear on the fetched page.
4. **On verification failure** (404, paywall, content doesn't match claim): Do NOT record as a finding. Note the gap.

This follows the same URL verification discipline as ADR 0019 and `/lit-review`. Parametric memory is not evidence.

## Step 4: Record findings

For each verified finding, determine where it belongs:

### Model releases or capability changes
→ If you maintain a model registry in your own system, update it:
- Add new model to the Model-Specific Capabilities table (if not present)
- Note claimed improvements with source URL
- Flag for evaluation if the model affects a known capability limit
- Add to Open Tracking Questions if evaluation is warranted

→ **MANDATORY: Create a task** in the relevant project's TASKS.md:
```
- [ ] Evaluate [model name] against known capability baselines
  Why: Horizon-scan detected new release. [1-sentence summary of claimed improvements].
  Done when: Model evaluated with a documented protocol; decision recorded.
  Priority: medium
  Source: horizon-scan YYYY-MM-DD, [URL]
```

Every model release that affects an active project requires a follow-up task. If the release is irrelevant to all active projects, note this explicitly in the scan report.

### Relevant research papers
→ If load-bearing (directly addresses an open question), create a literature note following the `/lit-review` schema in the relevant project's `literature/` directory. Mark `Verified: YYYY-MM-DD`.

→ **If load-bearing and actionable**, also create a task in the relevant project's TASKS.md (follow /lit-review Step 6 format).

→ If contextual (useful background), note in the scan report but do not create a full literature note unless the project has an active literature task.

### Tool/API changes
→ Update the relevant project file (e.g., `existing-data.md`, README open questions, or a dedicated tools/APIs tracking file).

→ If the change unblocks a task, update the task's lifecycle tags.

→ If the change enables new work, create a task in the relevant project's TASKS.md.

### General GenAI developments
→ Record in the scan report only. Do not create project artifacts for developments that don't clearly affect an active project.

## Step 5: Write scan report

Write a structured report to `.scheduler/skill-reports/horizon-scan-YYYY-MM-DD.md`:

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
- **Action taken**: [what was updated — registry, task created, literature note, etc.]

### [Finding title]
...

## Informative findings

- [Brief summary with source URL] — relevant to [project/question]
- ...

## No-signal topics

- [Topic]: No new developments found since [last scan date or "initial scan"]
- ...

## Gaps

- [Topic where verification failed or sources were unavailable]
- ...
```

## Step 6: Impact assessment

After recording all findings, assess whether any finding changes priorities:

1. **Does a new model release warrant immediate evaluation?** If so, flag in the report and ensure a task exists.
2. **Does a finding invalidate an assumption in an active project?** If so, add a note to the project's README Open questions or log.
3. **Does a finding unblock a previously blocked task?** If so, update the task's lifecycle tags.
4. **Does a finding suggest a new project?** If so, note in the report — do not create projects autonomously. Flag for PI review.

## Commit

Follow `docs/sops/commit-workflow.md`. Commit message: `horizon-scan: [date] — [N] actionable, [M] informative findings`

## Constraints

- **Verification is mandatory.** Never record a finding from search snippets alone. Fetch and confirm.
- **Scope is project-bounded.** Scan for what youji needs, not the entire GenAI landscape.
- **No hallucinated sources.** If a URL cannot be fetched, the finding is not recorded. Period.
- **Conservative recording.** When uncertain whether a development is relevant, note it in the scan report but do not create project artifacts. Over-recording creates noise; under-recording is recoverable (scan again next week).
- **Cost awareness.** Each WebSearch and WebFetch call has a cost. Aim for 10-20 fetches per scan, not 50+. Broad scans are cheap to run again; expensive scans should be focused.
- **No autonomous project creation.** If a finding suggests a new research direction, flag it for PI review. Do not create new projects.
