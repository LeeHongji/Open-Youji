---
name: compound
description: "Use at the end of a work session, or when accumulated findings need to be embedded into conventions, skills, or patterns"
argument-hint: "[optional: 'fast', 'deep', or no argument for standard]"
---

# /compound [mode]

Compound engineering phase — turns session work into accumulated system advantage by embedding learnings into conventions, skills, and patterns.

## Tier selection

- `/compound fast` — 1-2 turns, skip cross-session scanning
- `/compound deep` — full procedure with deep-mode scope (cross-project, all active projects)
- `/compound` (no argument) — run standard compound

## Fast compound

### Step 1: Review session work
Run `git diff --stat HEAD~N..HEAD`. Identify what changed.

### Step 2: Check for session learnings
Ask the 4 questions from the full procedure: non-obvious facts, failure modes, useful techniques, convention friction.

### Step 3: Quick task discovery
If completed experiment/analysis, check EXPERIMENT.md Findings for: unresolved questions, failed criteria, "N too small", multi-phase gaps. Create task with provenance if found.

### Step 4: Act on learnings
Apply small updates directly. Larger changes become tasks. See Step 7 of full compound for growth accounting.

### Output (fast)
`Compound (fast): N actions — <summary>.` or `Compound (fast): no actions.`

---

**Pre-compound commit:** Check `git status`. Commit uncommitted session work first.

## Standard compound

## Background

Compound engineering turns individual session work into accumulated system advantage. The compound phase embeds learnings from each task into conventions, skills, and patterns — transforming linear progress into exponential improvement.

## Principles

1. **Small, correct updates over ambitious rewrites.** Fix a typo in a convention, add a one-line gotcha to a skill, note a pattern for future gravity evaluation. Don't redesign CLAUDE.md in a compound step.
2. **Evidence over intuition.** Only embed learnings that are grounded in concrete session experience. "I noticed X went wrong" becomes an update. "I think Y might be better" becomes a task for evaluation, not direct change.
3. **Classify before acting.** Every potential compound action falls into one of the output categories below. Classify first, then act.

## Full procedure

### Step 1: Review session work

Run `git diff --stat HEAD~N..HEAD` (where N is the number of commits in this session) to see what changed. If this is an end-of-session invocation, the diff is against the pre-session HEAD.

Identify:
- What task was completed (or partially completed)?
- What files were created or modified?
- Were there any surprises, workarounds, or difficulties during execution?

### Step 2: Check for session learnings

Ask these questions about the session's work:

1. **Did I discover a non-obvious fact?** (e.g., an API behaves differently than documented, a file format has an undocumented constraint, a convention is ambiguous in edge cases)
   -> If yes: should this fact live in CLAUDE.md, a skill, a knowledge file, or a project file?

2. **Did I encounter a failure mode that future sessions should avoid?** (e.g., a command that silently fails, a configuration that looks correct but isn't, a common mistake in a workflow)
   -> If yes: add a gotcha/warning to the relevant skill or convention.

3. **Did I develop a technique or approach that worked well?** (e.g., a debugging strategy, an analysis pattern, a verification method)
   -> If yes and it generalizes beyond this one task: note it as a gravity candidate or add to a skill.

4. **Did I work around a convention that didn't fit?** (e.g., a CLAUDE.md rule that was unhelpful, a schema that was too rigid, a skill instruction that was misleading)
   -> If yes: update the convention/skill to handle the edge case, or note the friction for future evaluation.

### Step 3: Scan for unactioned recommendations and implied tasks (standard: last 7 days, deep: last 14 days)

This step has two parts: (A) explicit recommendation sections, and (B) implied tasks from findings.

#### Part A: Explicit recommendation sections

Search recent files for "Recommendations", "Prevention", "Proposal", "Migration", or "Next steps" sections:

```
projects/*/diagnosis/diagnosis-*.md, projects/*/postmortem/postmortem-*.md
projects/*/experiments/*/EXPERIMENT.md (status: completed in last N days)
decisions/*.md (with Migration or Consequences action items)
```

For each file: check if recommendations are relevant to this session's area and trivially actionable.

For actionable recommendations:
1. Parse numbered/bulleted items as separate recommendations
2. Skip non-actionable items ("Do not", purely observational, no action verb)
3. Format as tasks: `- [ ] <imperative> Why: From <source> — <summary> Done when: <condition>`
4. Deduplicate against existing TASKS.md entries
5. Mark processed: `<!-- Recommendations surfaced: YYYY-MM-DD -->`

#### Part B: Implied tasks from experiment findings

Completed experiments often have implied follow-up work in Findings sections that lack a formal "Recommendations" header. Scan for:

| Pattern | Signal phrases | Implied task |
|---------|----------------|--------------|
| Failed criterion | "FAIL", "below threshold" | Refined experiment |
| Insufficient sample | "N too small", "cannot draw conclusions" | Larger replication |
| Confound | "confound", "cannot separate" | Controlled follow-up |
| Partial confirmation | "partially confirmed", "effect exists but" | Targeted investigation |
| Unexplained result | "unexpected", "mechanism unclear" | Diagnosis |
| Multi-phase plan | "Phase N" in body | Check phase-tasks exist |

For each pattern: check TASKS.md for existing follow-up; create task candidate with experiment provenance if missing.

### Step 4: Surface research questions

Extract implicit research questions from these sources. In standard mode: current session/project only. In deep mode: all active projects.

#### Source 1: Experiment findings with unexplained results

Scan EXPERIMENT.md Findings sections for implicit questions:

| Pattern | Signal phrases | Question form |
|---------|----------------|---------------|
| Unexplained result | "unexpected", "mechanism unclear" | "Why does X despite Y?" |
| Untestable hypothesis | "cannot be tested", "future work" | "Under what conditions does H hold?" |
| Methodology confound | "protocol asymmetry", "cannot separate" | "How to disentangle X from Y?" |

For each: state question clearly, reference source, note what data/methodology would resolve it.

#### Source 2: Literature gaps

Check `projects/*/literature/synthesis.md` and recent `/lit-review` outputs for gap analysis sections. Formulate questions for gaps not already in "Open questions".

#### Deduplication

Before proposing: read target project's "Open questions", check for semantic overlap, skip questions already covered.

### Step 5: Detect gravity candidates

Check whether the current session's work reveals a pattern that has recurred 3+ times:

- Did you do something manually that a script or validator could do?
- Did you apply judgment that has become routine enough to be a convention?
- Did you follow a multi-step procedure that could be simplified into a skill or tool?

In standard mode: only note candidates for future `/gravity` evaluation.
In deep mode: evaluate each candidate using the `/gravity` procedure (recurrence, stability, cost-benefit).

### Step 6: Check artifact complexity (deep mode only)

Measure line counts for high-read-frequency artifacts:

| Artifact | Threshold | Rationale |
|----------|-----------|-----------|
| `CLAUDE.md` | >400 | Read every session |
| `projects/*/README.md` | >200 | Read during orient |
| `projects/*/TASKS.md` | >150 | Read during task selection |
| `.claude/skills/*/SKILL.md` | >300 | Loaded on invocation |

For each artifact exceeding threshold: check TASKS.md for existing simplification task; create one if missing.

### Step 7: Check domain knowledge synthesis needs (deep mode only)

In deep mode, check whether any active project has accumulated enough experiment records to warrant domain knowledge synthesis.

1. Count completed experiments per active project
2. Check whether the project has a `knowledge.md`
3. If 10+ completed experiments AND no `knowledge.md` (or it's stale): create a synthesis task

### Step 8: Act

For each compound opportunity, classify and act:

| Category | Criterion | Action |
|----------|-----------|--------|
| Direct update | Small, verifiable | Apply now |
| New task | Larger, needs design | Add to TASKS.md |
| Gravity candidate | Recurring pattern | Add task: "Run `/gravity` on: <pattern>" |

**Direct update rules:**
- Additions preferred over modifications (gotchas safer than rewrites)
- Self-contained updates (future agent understands without this session's context)
- Propagate changes to all locations (CLAUDE.md, SOPs, skills) in same turn
- **Growth accounting**: When adding 10+ lines, identify lines to compress or remove. **Gate**: If target skill >400 lines, simplify before adding (run `/simplify` first).

## Output format

```
### Compound phase

**Learnings embedded:** <count>
<bulleted list or "none">

**Recommendations actioned:** <count>
<bulleted list or "none">

**Research questions surfaced:** <count>
<bulleted list or "none">

**Gravity candidates noted:** <count>
<bulleted list or "none">

**Tasks created:** <count>
<bulleted list or "none">
```

If no compound actions: `### Compound phase\nNo compound actions warranted this session.`

## Relationship to other skills

- **/gravity**: Evaluates whether a pattern should be formalized. `/compound` identifies candidates; `/gravity` evaluates them.
- **/postmortem**: Analyzes flawed outputs. `/compound` checks if postmortem recommendations were actioned.
- **/synthesize**: Interprets cross-session findings. `/compound` operates on single-session learnings.
- **/orient**: Session-start awareness. `/compound` session-end embedding — orient reads what compound wrote.

## Commit

Commit changes with `git add <files> && git commit -m "compound: <summary>"`.

## Anti-patterns

- **Compound theater**: Trivial updates to show activity. If nothing learned, log "no compound actions".
- **Scope creep**: Executing the work that tasks describe. Compound creates tasks and embeds learnings — it does not do the work itself.
- **Ungrounded proposals**: Convention changes from single data point. Need 3x recurrence per `/gravity`.
- **Skipping**: Most common failure. Even "routine work" may have friction worth documenting.
