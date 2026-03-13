---
name: orient-simple
description: "Lightweight session-start task selection when full orient is unnecessary"
---

# orient-simple

Lightweight orient for quick task selection in <3 turns. Use when full orient recently ran or for simple continuation sessions.

## When to use

At the start of a work session when full orient is unnecessary — e.g., continuing from a recent session, or when the researcher has already indicated what to work on.

## Procedure

Execute these steps in order:

### Step 1: Check for orphaned work

Run `git status`. If there are uncommitted changes that are project work, commit them with a descriptive message.

### Step 2: Read TASKS.md files

Read all `projects/*/TASKS.md` files. For each task, note:
- `[ ]` = open, `[x]` = done
- `[in-progress: DATE]` = someone is working on it, skip
- `[blocked-by: ...]` = cannot proceed, skip

### Step 3: Check project priorities

Read the first 5 lines of each `projects/*/README.md`. Look for `Priority:` field:
- `high` = highest priority
- `medium` or no field = default priority
- `low` = lowest priority

### Step 4: Mission gap check

For each high-priority project with <=2 unblocked tasks:

1. Read the project's `Done when:` from README.md
2. Check if each `Done when` condition has a corresponding open task in TASKS.md
3. If a condition has no task AND is not already satisfied, create one:
   ```
   - [ ] <verb phrase for the gap>
      Why: Mission gap — no task for "<condition>"
      Done when: <condition from project Done when>
   ```

### Step 5: Rank unblocked tasks

For each unblocked open task, score by these criteria (in order):

1. **Project priority**: high=3, medium=2, low=1
2. **Task value**: prevents waste=3, unblocks others=2, produces knowledge=1
3. **Concrete done-when**: has clear completion condition=1, vague=0

Multiply: project_priority x task_value + concrete_done_when

### Step 6: Select the highest-scored task

The task with the highest score is your task.

### Step 7: Report selection

Output a single line in this format:

```
Selected: <task description> (project: <name>, priority: <level>, score: <N>)
```

## Common patterns

**Task with [blocked-by: external: ...]:** Skip. This is waiting on external work with uncertain timeline.

**All tasks blocked:** Check if there are tasks that might be unblocked. If all tasks are genuinely blocked, end the session with a log entry noting the blockage.

## What NOT to do

- Do NOT run the full orient skill — it's too complex for quick sessions
- Do NOT read optional files (roadmap.md, status.md)
- Do NOT attempt cross-project strategic analysis
- Do NOT scan for compound opportunities
