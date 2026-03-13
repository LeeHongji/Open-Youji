---
name: report
description: "Use when a status report, research digest, or experiment comparison is needed for review"
argument-hint: "<type> [project=<name>] [from=YYYY-MM-DD] [to=YYYY-MM-DD]"
---

# /report <type> [options]

Generate a formatted report from Youji's data sources.

## Report types

| Type | Argument | What it shows |
|------|----------|---------------|
| Research digest | `research` | Experiments completed, findings, decisions, knowledge output |
| Project status | `project [project=<name>]` | Per-project health, tasks, experiments, log entries |
| Experiment comparison | `experiment-comparison [ids=<id1,id2>]` | Side-by-side experiment results and parameter diffs |
| Session review | `session` | Recent session activity, what was accomplished, what's pending |

## Procedure

### Step 1: Parse arguments

Extract from the user's message:
- **type**: one of `research`, `project`, `experiment-comparison`, `session` (default: `research`)
- **project**: optional project name filter
- **from**: optional start date (ISO format, default: 7 days ago)
- **to**: optional end date (ISO format, default: today)
- **ids**: optional comma-separated experiment IDs (for `experiment-comparison`)

### Step 2: Gather data

Based on report type:

**Research digest:**
- Read all active project READMEs (Log sections for the time range)
- Read completed EXPERIMENT.md files in the time range
- Read any new decision records
- Read recent knowledge/ updates
- Compile: experiments completed, key findings, decisions made, open questions surfaced

**Project status:**
- Read the specified project's README, TASKS.md, experiments/, decisions/
- Compile: task completion rate, active experiments, recent log entries, budget status (if budget.yaml exists), open questions

**Experiment comparison:**
- Read the specified EXPERIMENT.md files
- Compare: hypotheses, methods, metrics, results, findings
- Highlight: where results agree/disagree, methodological differences, which produced more knowledge

**Session review:**
- Read git log for the time range
- Read project README log entries
- Compile: sessions run, tasks completed, findings produced, tasks created, open items

### Step 3: Write the report

Write to `reports/<type>-YYYY-MM-DD.md` (create `reports/` if needed):

```markdown
# <Report Type>: <scope>

Date: YYYY-MM-DD
Period: <from> to <to>

## Summary
<2-3 sentence overview of key developments>

## Details

### <Section 1>
<content varies by report type>

### <Section 2>
...

## Highlights
<top 3 most important findings or developments>

## Concerns
<anything stalled, blocked, or drifting>

## Next steps
<recommended priorities for the next period>
```

### Step 4: Present to researcher

1. Read the generated report
2. Present key findings and highlights
3. Note any concerns or recommended priority changes

## Examples

- `/report research` — research digest for the last 7 days
- `/report research from=2026-02-10` — research digest since Feb 10
- `/report project project=agent-bench` — agent-bench status
- `/report experiment-comparison ids=exp-a,exp-b` — compare two experiments
- `/report session` — recent session activity review

## Commit

If the researcher wants to preserve the report:
Commit message: `report: <type> <date>`
