---
name: refresh-skills
description: "Use when skills may be out of date with source code, after significant infra changes, or when skill descriptions need compliance audit"
allowed-tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash(wc -l *)", "Bash(git log *)"]
argument-hint: "[skill name, 'all', or 'report']"
---

# /refresh-skills <target>

Skills encode operational guidance, but the codebase evolves faster than skills get updated. This skill audits skills against the current source code, identifies drift, and applies fixes.

The argument determines scope:

| Argument | Behavior |
|---|---|
| `all` | Audit every skill, update all that need it |
| `report` | Audit every skill, report drift but don't edit |
| `<skill-name>` | Audit and update one specific skill |
| (no argument) | Same as `all` |

## Step 1: Inventory

Read every `SKILL.md` under `.claude/skills/*/`. For each, extract:

- **Name** and description
- **Source references** — which infra files, conventions, patterns, or docs does this skill reference?
- **Status** — any noted issues?

## Step 2: Cross-reference against source

For each skill's source references, read the actual current files. Check for:

### Description compliance

Skill descriptions are injected into Claude's system prompt for skill selection. They must state ONLY triggering conditions — never summarize the skill's workflow or process.

**Rule:** Descriptions answer "When should I invoke this?" not "What does this skill do?"

**Why:** Descriptions summarizing workflow cause Claude to shortcut — following the description instead of reading the full skill body.

**Checklist for each description:**
1. Does it describe a situation, symptom, or trigger? (good)
2. Does it summarize the skill's process or output? (bad — rewrite)
3. Does it use verbs that describe the skill's actions (e.g., "analyze", "generate", "validate")? (bad — replace with triggering conditions)

### Content drift (skill says X, code/docs do Y)
- **File paths**: Do referenced files still exist at those paths?
- **Behavioral descriptions**: Does the skill describe flows that match current conventions/SOPs?
- **Tool lists**: Does the skill's `allowed-tools` match what's appropriate?

### Structural gaps (code has X, no skill covers it)
- Are there new infra modules or conventions without corresponding skill guidance?
- Have docs/conventions changed in ways skills should reflect?

### Staleness signals
- `git log --since="2 weeks ago" -- <referenced files>` — if source files changed recently but the skill hasn't, it's a drift candidate.

### Provenance review (decay mechanism)

Skills accumulate rules from incidents but lack a decay path — resolved failure modes leave permanent scar tissue. For each rule:

1. **Trace provenance.** Look for references to decisions, postmortems, diagnoses, or feedback. If no provenance, flag as `[untraced]`.
2. **Check resolution status.** If failure is now prevented by code (L0), flag as `[code-enforced]`, candidate for removal. If no recurrence in 90 days, flag as `[dormant-90d]`.
3. **Classification:** Remove (code-enforced + tested), Compress (verbose, same guidance in CLAUDE.md), Keep (still needed), Investigate (untraced).

Report provenance findings in the drift assessment.

## Step 3: Report

For each skill, produce a drift assessment:

```
### <skill-name>
Status: current | drifted | stale
References: <list of source files this skill depends on>
Last skill edit: <date from git log>
Last source edit: <date from git log for referenced files>

Drift items:
- [ ] <specific item that needs updating>

Missing coverage:
- [ ] <feature or behavior in source that this skill should mention but doesn't>
```

If target is `report`, stop here.

## Step 4: Update

For each drifted skill, apply fixes:
1. Update stale references
2. Add missing coverage
3. Remove dead references
4. Preserve voice — match existing tone and structure
5. Propagate shared content — ensure consistency across skills

## Step 5: Summarize

```
## Skill refresh summary
Date: YYYY-MM-DD

Skills audited: <N>
Skills updated: <N>
Skills current (no changes needed): <N>

### Changes made
- <skill>: <1-line summary>

### Remaining issues
- <anything needing human decision>
```

## Commit

Follow `docs/sops/commit-workflow.md`. Message: `refresh-skills: update <N> skills — <brief summary>`

## What this skill does NOT do

- **Create new skills** — that's a design decision requiring human approval
- **Delete skills** — flag obsolete skills in the report, but don't remove them
- **Change skill scope or purpose** — flag for human review
- **Edit CLAUDE.md or decisions/** — flag inconsistencies but only edit SKILL.md files
