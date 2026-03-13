---
name: feedback
description: "Use when the researcher provides feedback, corrections, or direction on Youji's work"
argument-hint: "<feedback message describing what went wrong or should change>"
---

# /feedback <message>

Process researcher feedback to make Youji better. The researcher is the authority who governs research direction, quality standards, and operational parameters. Their feedback is not a suggestion; it is an instruction.

Your job: understand what the researcher wants, figure out what should change, make the change, and record the learning so it never needs to be said again.

**If no feedback message is provided, stop immediately.** Say: "No feedback provided. Usage: `/feedback <what went wrong or should change>`" and do nothing else.

---

## Step 1: Parse the feedback

Read the feedback message and classify it:

| Type | Signal | Example |
|---|---|---|
| **Correction** | "Don't do X", "X was wrong" | "Don't modify decisions/ without asking" |
| **Complaint** | "X didn't work", "X is broken" | "Skills aren't being invoked properly" |
| **Directive** | "Always do X", "Start doing X" | "Always verify URLs before citing" |
| **Observation** | "I noticed X", "X seems off" | "The literature notes are sometimes fabricated" |
| **Strategy** | "Pivot to X", "Drop project Y" | "Pause sample-project, focus on agents" |
| **Knowledge** | "FYI X", "We now have X" | "We just got access to GPT-5 API" |
| **Calibration** | "Quality is too low", "Be more rigorous" | "Stop producing surface-level findings" |

State the feedback type and a one-sentence restatement to confirm understanding.

## Step 2: Investigate

The depth of investigation depends on the feedback type.

**Full investigation** (correction, complaint, observation): Trace the root cause.

1. **Find the code path.** Grep for relevant functions, skills, decisions, and conventions.
2. **Find the history.** Check `git log` for recent changes. Check project logs for context.
3. **Find prior feedback.** Search for similar issues in project diagnosis files and postmortems.
4. **Attribute to layer:**
   - L1 Model: LLM capability limitation
   - L2 Workflow: process or procedure gap
   - L3 Interface: prompt or UX issue
   - L4 Evaluation: metrics or validation gap
   - L5 Human: governance or communication gap
5. **State the root cause** in one sentence.

**Light investigation** (directive, strategy, knowledge, calibration): Verify feasibility and find the right files.

## Step 3: Determine the fix

| Fix type | When to use | Example |
|---|---|---|
| **Convention/rule** | Behavior should be followed by Youji | Add rule to CLAUDE.md or skill |
| **Skill change** | Workflow should shift | Add step to relevant skill |
| **Decision record** | A policy needs to be established | Write to `decisions/` |
| **Documentation** | Knowledge needs to be captured | Add to project README or knowledge/ |
| **Project change** | Researcher is reshaping the portfolio | Create/pause/complete project |
| **Config change** | Researcher is tuning parameters | Edit relevant config |

## Step 4: Implement

Apply the fix following the appropriate workflow:

### Convention/skill changes
1. Edit the relevant CLAUDE.md section or SKILL.md file
2. Propagate to all related locations
3. Commit

### Decision records
1. Write `decisions/NNNN-title.md`
2. If the ADR includes unimplemented action items, create corresponding tasks
3. Commit

### Project changes

**Pause a project:** Set `Status: paused`, add log entry.
**Resume a project:** Set `Status: active`, add log entry.
**Start a new project:** Create `projects/<name>/README.md` and `TASKS.md` following schemas.
**Complete a project:** Set `Status: completed`, add final log entry.

### Knowledge injection

New external facts that change what's possible:
1. Record the fact in the most relevant project file
2. Assess impact: does this change priorities? Unblock tasks? Invalidate assumptions?
3. Create tasks in affected project's TASKS.md
4. Commit

### Quality calibration

1. Find the relevant conventions (CLAUDE.md, skills, decisions)
2. Write or update the convention to encode the new bar with a concrete, checkable criterion
3. Propagate to all relevant locations. Commit.

## Step 5: Record the learning

**MANDATORY.** Every feedback cycle must produce a persistent record.

Create or update a file at: `knowledge/feedback/feedback-<slug>.md`

```markdown
## Problem

Feedback: "<exact quote>"
Type: <type>
Interpretation: <one-sentence restatement>

## Root Cause

<What causes the current behavior. Layer attribution. Reference files by path.>

## Fix

<What was changed. File-by-file summary.>

## Verification

<How correctness was confirmed.>

## Learning

<One-paragraph summary: what principle does this encode? How does it generalize?>
```

The **Learning** section is the most important part. It should capture the general principle, not just the specific fix.

### Step 5b: Propagation check

After recording, assess whether the learning should propagate:

1. **Cross-project applicability**: Does this apply to multiple projects? -> Propagate to CLAUDE.md or a skill
2. **Skill update check**: Does this belong in an existing skill? -> Add to the appropriate step
3. Document propagation in the feedback record

## Step 6: Verify the loop is closed

Before finishing, check:

1. **Is the fix applied?** Is it in all relevant files?
2. **Is the learning recorded?** Does the feedback record exist?
3. **Would the same feedback trigger the same problem again?** If yes, the fix is insufficient.
4. **Would a fresh session know about this?** Read only the repo — is the learning discoverable?
5. **Were tasks created?** If the feedback implies actionable work, verify tasks exist.

---

## Constraints

- **No feedback = no action.** Exit immediately if the argument is empty.
- **Researcher authority.** Feedback is instructions, not requests. Execute them.
- **Evidence first.** For corrections and complaints, never assume the root cause.
- **Record everything.** The feedback record is not optional.
- **Inline logging.** Record discoveries to repo files in the same turn.
- **Check decisions/.** Do not contradict established decisions without the researcher explicitly overriding them.

## Commit

Commit message: `feedback: <brief summary of what was addressed>`
