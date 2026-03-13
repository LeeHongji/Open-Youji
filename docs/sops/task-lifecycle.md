Standard procedure for task lifecycle management in the Youji repo.

## Task Lifecycle

When: Managing tasks in project `TASKS.md` files during sessions.
Requires: A task in a `TASKS.md` file that may need lifecycle management.

### 1. Understanding lifecycle tags

Tags coordinate task work across sequential sessions:

| Tag | Meaning | Who adds | Who removes |
|-----|---------|----------|-------------|
| `[in-progress: YYYY-MM-DD]` | Currently being worked on | Youji claiming task | Youji completing/abandoning task |
| `[blocked-by: <desc>]` | Cannot proceed until condition met | Youji identifying blocker | Youji verifying blocker resolved |
| `[approval-needed]` | Requires researcher sign-off before execution | Youji | Researcher grants or denies approval |
| `[approved: YYYY-MM-DD]` | Researcher has approved execution | Researcher | N/A (execution removes all tags) |
| `[denied: YYYY-MM-DD]` | Researcher has denied execution | Researcher | N/A (task closed or reformulated) |
| `[zero-resource]` | Consumes no budget resources | Task creator | N/A (permanent property) |

### 2. Claiming a task

Before starting work, add `[in-progress: YYYY-MM-DD]` to the task in TASKS.md:

```markdown
- [ ] Run analysis on experiment results [in-progress: 2026-02-27]
```

This signals to future sessions that the task is being worked on.

> Output: Task marked in-progress with current date

### 3. Handling blockers

**Internal blockers** (Youji can resolve): Do NOT use `[blocked-by]`. Installation steps, code changes, configuration -- these are part of executing the task, not blockers.

**External blockers** (requires action outside Youji's control): Add `[blocked-by: <description>]`:

```markdown
- [ ] Deploy to production [blocked-by: researcher approval for deployment]
```

When using `[blocked-by:]`: (1) decompose to identify preparatory work that can proceed, (2) document pending work in project README, (3) check for stale blockers (7+ days) during orient.

> Output: Blocker documented, task skipped for now

### 4. Requesting approval

For tasks requiring researcher decision (resource increases, governance changes):

1. Write entry to `APPROVAL_QUEUE.md` with type, request, context
2. Add `[approval-needed]` to the task
3. End session or select a different task

CRITICAL: Steps 1-2 must complete before step 3. Never exit with an orphaned `[approval-needed]` tag -- a tag without a matching APPROVAL_QUEUE.md entry is invisible and will never be resolved.

After approval is recorded in APPROVAL_QUEUE.md:
- Researcher updates tag to `[approved: YYYY-MM-DD]`
- Youji sees approved task and proceeds

> Output: Approval request queued, task blocked until approved

### 5. Handling denied approval

When an approval request is denied in APPROVAL_QUEUE.md:

1. **Close the task**: Mark `[x]` with "Denied: <date>. <brief reason>"
2. **Or reformulate**: If the denial was due to scope/approach (not fundamental rejection), create a new task with revised scope, tag `[approval-needed]`, and file a new APPROVAL_QUEUE.md entry

```markdown
- [x] Add feature X mention to CLAUDE.md
  Denied: 2026-02-26. Rejected by researcher. See APPROVAL_QUEUE.md.
```

> Output: Denied task closed, no dangling approval-needed tag

### 6. Completing a task

When done, mark the task complete and remove all lifecycle tags:

```markdown
- [x] Run analysis on experiment results
  Completed: 2026-02-27. Key findings: ...
```

**Never mark `[x]` with "(partial)" annotation.** If partially done, keep `[ ]` and update description with remaining work, or split into completed subtask + new open task.

> Output: Task marked complete, all lifecycle tags removed

### 7. Task decomposition

When a task spans multiple independent work streams:

1. Split into independently actionable subtasks
2. Check if downstream tasks also need splitting
3. Each subtask gets its own "Done when" condition

**Decomposition triggers** -- decompose a task when:
- It has more than 2 independent steps
- It combines blocked and unblocked work
- It mixes mechanical work with judgment-requiring work

Example:
```
Before (single complex task):
- [ ] Run experiment on test set and analyze results
  Done when: Experiment results and analysis documented

After (decomposed):
- [ ] Set up experiment directory
  Done when: EXPERIMENT.md with status: planned exists
- [ ] Write experiment script
  Done when: Script runs without error on 1 sample
- [ ] Run experiment
  Done when: Experiment submitted with results generated
- [ ] Analyze experiment results
  Done when: Findings section in EXPERIMENT.md with analysis
```

> Output: Tasks decomposed for independent execution

Check: All task lifecycle tags follow the format specified, and stale tags (in-progress >3 days, approval-needed with resolved approval) are flagged and cleaned.
