Standard procedure for committing work in the Youji repo.

## Commit Workflow

When: Any work unit is complete (feature implementation, bugfix, experiment setup, documentation update).
Requires: Git repo in clean state or with staged/unstaged changes ready to commit.

### 1. Stage changes

- Review `git status` to identify all modified and untracked files
- Stage relevant files: `git add <files>` or `git add .` for all changes
- **Do not stage files that should not be committed**: `.env`, credentials, secrets, large binary artifacts

> Output: All relevant changes staged

### 2. Verify before commit

- If any tests exist for modified code, run them to confirm they pass
- If adding/modifying infrastructure code, run relevant validation
- Review staged diff for obvious errors

> Output: All validation checks pass

### 3. Write commit message

- Use imperative mood: "add feature" not "added feature"
- Start with a tag: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`
- Keep first line under 72 characters
- If commit closes an issue, reference it: "fix: resolve timeout issue (closes #123)"

> Output: Descriptive commit message ready

### 4. Commit

```
git commit -m "type: description"
```

> Output: Changes committed with descriptive message

### 5. Push

- `git push` to publish changes
- If working on a branch: `git push -u origin <branch-name>`

> Output: Changes synchronized with remote

Check: `git status` shows "nothing to commit, working tree clean" (or only intentionally uncommitted files like `.env`).

## Task Completion: Combine Ceremony

When completing a task, combine all task-closing changes into a single commit with the work:

- Task marking: updating `[ ]` --> `[x]` in TASKS.md with `Completed:` line
- Log entry: adding dated summary to project README
- Work changes: code, docs, config changes from the task itself

**Correct pattern (single commit):**
```
git add src/feature.ts projects/myproject/TASKS.md projects/myproject/README.md
git commit -m "feat: add feature X

- Implement X logic
- Mark task complete in TASKS.md
- Add log entry to README"
```

**Anti-pattern (multiple commits):**
```
git add src/feature.ts
git commit -m "feat: add feature X"
git add projects/myproject/TASKS.md
git commit -m "chore: mark task complete"
git add projects/myproject/README.md
git commit -m "docs: add log entry"
```

Rationale: Separate ceremony commits clutter history. A task completion is one logical unit of work.
