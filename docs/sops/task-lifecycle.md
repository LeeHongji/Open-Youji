Standard procedure for task lifecycle tags in the youji repo.

## Task Lifecycle

When: Managing tasks in project `TASKS.md` files during autonomous sessions.
Requires: A task in a `TASKS.md` file that may need lifecycle management.

### 1. Understanding lifecycle tags

Tags coordinate task work across concurrent and sequential sessions:

| Tag | Meaning | Who adds | Who removes |
|-----|---------|----------|-------------|
| `[in-progress: YYYY-MM-DD]` | Currently being worked on | Agent claiming task | Agent completing/abandoning task |
| `[blocked-by: <desc>]` | Cannot proceed until condition met | Agent identifying blocker | Agent verifying blocker resolved |
| `[blocked-by: external: <desc>]` | Waiting on external team | Agent identifying external blocker | Agent verifying external work done |
| `[approval-needed]` | Requires human sign-off before execution | Agent or human | Human grants or denies approval |
| `[approved: YYYY-MM-DD]` | Human has approved execution | Human | N/A (execution removes all tags) |
| `[denied: YYYY-MM-DD]` | Human has denied execution | Human | N/A (task closed or reformulated) |
| `[zero-resource]` | Consumes no budget resources | Task creator | N/A (permanent property) |

### 2. Claiming a task

Before starting work, claim the task via the scheduler API:

```bash
curl -s -X POST http://localhost:8420/api/tasks/claim \
  -H 'Content-Type: application/json' \
  -d '{"taskText":"<first line of task>","project":"<project>","agentId":"<SESSION_ID>"}'
```

- **200**: Claim succeeded — proceed with task
- **409**: Already claimed — select a different task
- **Connection refused**: API unavailable — proceed without claiming (graceful degradation)

→ Output: Task claimed, preventing concurrent sessions from picking the same task

### 3. Marking in-progress

After claiming, add `[in-progress: YYYY-MM-DD]` to the task in TASKS.md:

```markdown
- [ ] Run analysis on experiment results [in-progress: 2026-02-27]
```

This signals to other sessions that the task is being worked on.

→ Output: Task marked in-progress with current date

### 4. Handling blockers

**Internal blockers** (agent can resolve): Do NOT use `[blocked-by]`. Installation steps, code changes, configuration — these are part of executing the task, not blockers.

**External blockers** (requires action outside agent control): Add `[blocked-by: <description>]`:

```markdown
- [ ] Deploy to production [blocked-by: PR approval for feature/xyz]
```

**External team blockers**: Add `[blocked-by: external: <description>]`:

```markdown
- [ ] Analyze experiment results [blocked-by: external: human researcher completing review (~48h)]
```

When using `[blocked-by: external:]`: (1) decompose to identify preparatory work, (2) document pending work in project README, (3) check for stale requests (7+ days) during orient.

→ Output: Blocker documented, task skipped for now

### 5. Requesting approval

For tasks requiring human decision (resource increases, governance changes, production PRs):

1. Write entry to `APPROVAL_QUEUE.md` with type, request, context
2. Add `[approval-needed]` to the task (prevents concurrent pickup while awaiting approval)
3. End session or select a different task

CRITICAL: Steps 1-2 must complete before step 3. Never exit with an orphaned `[approval-needed]` tag — a tag without a matching APPROVAL_QUEUE.md entry is invisible to humans and will never be resolved. The validator (`verify.ts`) checks for orphaned tags after each session.

After approval is recorded in APPROVAL_QUEUE.md:
- Human updates tag to `[approved: YYYY-MM-DD]`
- Agent sees approved task and proceeds

→ Output: Approval request queued, task blocked until approved

### 6. Handling denied approval

When an approval request is denied in APPROVAL_QUEUE.md:

1. **Close the task**: Mark `[x]` with "Denied: <date>. <brief reason from APPROVAL_QUEUE.md>"
2. **Or reformulate**: If the denial was due to scope/approach (not fundamental rejection), create a new task with revised scope, tag `[approval-needed]`, and file a new APPROVAL_QUEUE.md entry

The validator (`verify.ts`) detects orphaned `[approval-needed]` tags where the corresponding approval was denied.

```markdown
- [x] Add feature X mention to CLAUDE.md
  Denied: 2026-02-26. Rejected by user request. See APPROVAL_QUEUE.md.
```

→ Output: Denied task closed, no dangling approval-needed tag

### 7. Completing a task

When done, mark the task complete and remove all lifecycle tags:

```markdown
- [x] Run analysis on experiment results
  Completed: 2026-02-27. Key findings: ...
```

**Never mark `[x]` with "(partial)" annotation.** If partially done, keep `[ ]` and update description with remaining work, or split into completed subtask + new open task.

→ Output: Task marked complete, all lifecycle tags removed

### 8. Task decomposition

When a task spans multiple independent work streams with different dependency states:

1. Split into independently actionable subtasks
2. Check if downstream tasks also need splitting
3. Each subtask gets its own "Done when" condition

Example: "Collect and analyze data" → "Collect dataset A" + "Collect dataset B" + "Analyze A" + "Analyze B" (where analysis tasks are `[blocked-by: collection]`)

→ Output: Tasks decomposed for parallel execution

Check: All task lifecycle tags follow the format specified, and stale tags (in-progress >3 days, approval-needed with resolved approval) are flagged and cleaned.
