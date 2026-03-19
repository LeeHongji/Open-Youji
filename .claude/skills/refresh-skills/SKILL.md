---
name: refresh-skills
description: "Use when skills may be out of date with source code, after significant infra changes, or when skill descriptions need CSO compliance audit"
complexity: medium
model-minimum: glm-5
disable-model-invocation: false
allowed-tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash(cd * && npx tsc --noEmit)", "Bash(wc -l *)", "Bash(git log *)"]
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
- **Source references** — which infra files, functions, types, or patterns does this skill reference? (Look for file paths, function names, type names, action tags, command examples, tool lists)
- **Status** — is it marked `draft`?

## Step 2: Cross-reference against source

For each skill's source references, read the actual current code. Check for:

### Description compliance (CSO convention)

Skill descriptions are injected into Claude's system prompt for skill selection. They must state ONLY triggering conditions — never summarize the skill's workflow or process.

**Rule:** Descriptions answer "When should I invoke this?" not "What does this skill do?"

**Why:** Testing (cross-project skill-pollination experiment, Finding 1) showed that descriptions summarizing workflow cause Claude to shortcut — following the description instead of reading the full skill body. A description saying "code review between tasks" caused Claude to do ONE review when the skill required TWO.

**Checklist for each description:**
1. Does it describe a situation, symptom, or trigger? (good)
2. Does it summarize the skill's process or output? (bad — rewrite)
3. Does it use verbs that describe the skill's actions (e.g., "analyze", "generate", "validate")? (bad — replace with triggering conditions)

**Format:**
```yaml
# ❌ BAD: Summarizes workflow
description: "Process human feedback — investigate root cause, log learnings, and implement improvements"

# ✅ GOOD: Triggering condition only
description: "Use when the PI or a human provides feedback, corrections, or direction on agent work"

# ❌ BAD: Describes what the skill does
description: "Generate reports — operational dashboard, research digest, project status"

# ✅ GOOD: Triggering condition
description: "Use when a status report, digest, or dashboard is needed for human review"
```

Flag non-compliant descriptions in the drift report and rewrite them in Step 4.

### Content drift (skill says X, code does Y)
- **Action tags**: Does the skill list action tags that match `chat.ts`'s regex patterns and `buildChatPrompt()`? Are any missing or removed?
- **Function signatures**: Does the skill reference functions that still exist with the same name/behavior?
- **File paths**: Do referenced files still exist at those paths?
- **Type definitions**: Do referenced TypeScript interfaces still have the fields the skill describes?
- **Behavioral descriptions**: Does the skill describe flows (e.g., "launch requires confirmation") that match the current code path?
- **Tool lists**: Does the skill's `allowed-tools` frontmatter match what the agent profile actually permits?
- **Agent profiles**: If the skill references agent capabilities (model, maxTurns, duration), check `agent.ts` AGENT_PROFILES.

### Structural gaps (code has X, no skill covers it)
- Are there agent types or action handlers in `chat.ts` that no skill documents?
- Are there new infra modules without corresponding skill guidance?
- Has `buildChatPrompt()` or the system prompt changed in ways skills should reflect?

### Staleness signals
- `git log --since="2 weeks ago" -- <referenced files>` — if source files changed recently but the skill hasn't, it's a drift candidate.
- Skills marked `status: draft` that reference stable, shipped code — ready for promotion?

### Provenance review (decay mechanism)

Skills accumulate rules from incidents (postmortems, diagnoses, PI feedback) but lack a decay path — resolved failure modes leave permanent scar tissue. For each rule or instruction in the skill body:

1. **Trace provenance.** Look for references to decisions (`decisions/NNNN`), postmortems (`postmortem-*.md`), diagnoses (`diagnosis-*.md`), feedback (`feedback-*.md`), or inline comments explaining why the rule exists. If no provenance is found, flag as `[untraced]`.

2. **Check resolution status.** If the rule was motivated by a specific failure mode:
   - Is the failure now prevented by code (L0 enforcement — validator, test, type check)? If yes → flag as `[code-enforced]`, candidate for removal from skill (the code handles it).
   - Has the failure recurred in the last 90 days? Check `git log --since="90 days ago"` for related postmortems/diagnoses. If no recurrence → flag as `[dormant-90d]`.

3. **Classification.** Assign each flagged rule to one of:
   - **Remove** — failure mode is now code-enforced AND the code path is tested. Safe to remove from skill.
   - **Compress** — rule is valid but verbose; the same guidance exists in CLAUDE.md or another authoritative source. Replace with a cross-reference.
   - **Keep** — rule addresses a failure mode that is still possible and not code-enforced.
   - **Investigate** — provenance is unclear (`[untraced]`); cannot determine if rule is still needed.

Report provenance findings in the drift assessment (Step 3) under a `Provenance:` sub-section.

## Step 3: Report

For each skill, produce a drift assessment:

```
### <skill-name>
Status: current | drifted | stale | draft
References: <list of source files this skill depends on>
Last skill edit: <date from git log>
Last source edit: <date from git log for referenced files>

Drift items:
- [ ] <specific item that needs updating — quote the stale text and the current truth>

Missing coverage:
- [ ] <feature or behavior in source that this skill should mention but doesn't>
```

If target is `report`, stop here.

## Step 4: Update

For each drifted skill, apply fixes using Edit:

1. **Update stale references** — correct file paths, function names, type fields, action tag syntax
2. **Add missing coverage** — document new capabilities, action types, agent behaviors
3. **Remove dead references** — delete guidance about features that no longer exist
4. **Preserve voice** — match the existing tone and structure of each skill; don't rewrite what isn't broken
5. **Propagate shared content** — if the same guidance appears in multiple skills (e.g., action tag syntax in both coordinator and buildChatPrompt), ensure consistency

After each edit, verify the skill still reads coherently.

## Step 5: Verify and summarize

After all updates:

1. Confirm no TypeScript was broken: `cd infra/scheduler && npx tsc --noEmit`
2. Produce a summary:

```
## Skill refresh summary
Date: YYYY-MM-DD

Skills audited: <N>
Skills updated: <N>
Skills current (no changes needed): <N>
Skills still draft: <N>

### Changes made
- <skill>: <1-line summary of what changed>

### Remaining issues
- <anything that needs human decision or is beyond this skill's scope>
```

## Commit

Follow `docs/sops/commit-workflow.md`. Commit message: `refresh-skills: update <N> skills — <brief summary of changes>`

## What this skill does NOT do

- **Create new skills** — that's a design decision requiring human approval
- **Delete skills** — flag obsolete skills in the report, but don't remove them
- **Change skill scope or purpose** — if a skill's mission has shifted, flag it for human review
- **Edit CLAUDE.md or decisions/** — flag inconsistencies but only edit SKILL.md files
