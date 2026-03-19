---
name: self-audit
description: "Use when sessions have committed code and you need to check compliance with CLAUDE.md conventions, log entry standards, and experiment validation"
complexity: medium
model-minimum: glm-5
disable-model-invocation: false
allowed-tools: ["Read", "Grep", "Glob", "Bash"]
argument-hint: "[time range, e.g. '24h' or '3d', or 'last-session']"
---

# /self-audit [time-range]

Audit recent session work for compliance with CLAUDE.md conventions. The argument specifies the scope: `last-session` (default), `24h`, `3d`, or `7d`. Reads recent commits and diffs to identify convention violations.

## When to use this vs alternatives

- **Use `/self-audit`** when you want to check whether recent sessions followed CLAUDE.md conventions (log entries, commit discipline, experiment structure, task tags). Works on committed history.
- **Use `pixi run validate`** when you want to check experiment YAML frontmatter and structural validity. Validate checks schema; self-audit checks behavioral conventions.
- **Use `/review`** when you want to check whether specific findings are valid or metric computations are meaningful. `/review` checks claim quality and methodology; `/self-audit` checks process compliance and workflow adherence.

## Scope

This skill checks conventions that are NOT already enforced by code:

| Convention | Enforced by code? | Self-audit checks? |
|---|---|---|
| EXPERIMENT.md frontmatter schema | Yes (`pixi run validate`) | No — defer to validator |
| Session footer presence | Yes (`verify.ts`) | No — defer to verifier |
| Orphaned files | Yes (`verify.ts`, `auto-commit.ts`) | No — defer to verifier |
| Log entry per session | Partially (`verify.ts` checks modified READMEs) | Yes — deeper check |
| Inline logging (discovery → file) | No | Yes |
| Cross-referencing (log entries → experiment dirs) | No | Yes |
| Findings provenance (script or arithmetic) | Yes (`verify.ts`) | No — defer to verifier |
| Task lifecycle tags (`[in-progress]` cleared) | Yes (`verify.ts`) | No — defer to verifier |
| Decision debt (implicit choices) | No | Yes |
| Budget check before resource work | No | Yes |
| Experiment record created for non-trivial work | No | Yes |
| Archive threshold (README log >5 entries) | No | Yes |
| Partial completion anti-pattern | No | Yes |

## Procedure

### 1. Determine scope

Parse the time-range argument:
- `last-session` (default): examine the most recent session's commits only
- `24h`, `3d`, `7d`: examine all commits in that time window

```bash
# Get commits in scope
git log --oneline --since="<time>" --format="%H %s"
```

### 2. Gather session diffs

For each commit in scope, collect the diff:

```bash
git diff <commit>^..<commit> --stat
git diff <commit>^..<commit> -- '*.md'
```

### 3. Run compliance checks

For each session (identified by session footer blocks in README log entries), check:

**Check 1: Log entry completeness**
- Every session should have a dated log entry in each project README it modified
- Log entry should include: what happened, what was learned, session metadata block
- Read the project READMEs modified in the diff and verify log entries exist for the session date

**Check 2: Inline logging discipline**
- Scan diffs for patterns suggesting deferred logging:
  - Large commits with many file changes but only end-of-session log entries
  - Config changes without corresponding log entries in the same commit
  - New experiment directories created without EXPERIMENT.md in the same commit

**Check 3: Findings provenance**
- For any EXPERIMENT.md files modified in the diff, read the Findings section
- Check each numerical claim has either:
  - A script reference (e.g., "analysis/script.py produces...")
  - Inline arithmetic (e.g., "96/242 = 39.7%")
- Flag findings with bare numbers and no provenance

**Check 4: Task lifecycle hygiene**
- Read all `TASKS.md` files
- Flag tasks with `[in-progress: <date>]` where the date is >3 days old (stale)
- Flag tasks marked `[x]` with "(partial)" in description (anti-pattern per CLAUDE.md)
- Flag tasks with `Done when:` conditions that appear unverifiable
- **Flag stale `[approval-needed]` tags**: For tasks with `[approval-needed]`, search APPROVAL_QUEUE.md for resolved approvals matching the task text. If found, the tag should be `[approved: YYYY-MM-DD]` instead. This detects the gap where approvals are granted but task tags are not updated.

**Check 5: Budget compliance**
- For projects with `budget.yaml`, check whether resource-consuming work in the diff period was preceded by a ledger entry
- Flag experiments launched without corresponding `ledger.yaml` entries

**Check 6: Experiment record coverage**
- Identify commits that changed >5 files or created new directories under `experiments/`
- Verify each has a corresponding EXPERIMENT.md
- Flag significant work (new analysis scripts, new data files) without experiment records

**Check 7: Archive thresholds**
- Count log entries in each project README
- Flag if any README has >5 recent entries (archive threshold per ADR 0020)
- Count open tasks in TASKS.md files; flag if >15 completed tasks need archiving

**Check 8: Decision debt**
- Scan diffs for patterns suggesting implicit decisions:
  - New conventions introduced without a decision record
  - CLAUDE.md modifications without corresponding ADR
  - Workarounds or TODOs introduced without tracking

**Check 9: Cross-referencing discipline**
- For each log entry in README files within scope, check:
  - If the session created/modified experiment directories, does the log entry contain links to those directories?
  - If the session reports findings from experiments, does the log entry reference the specific EXPERIMENT.md file?
  - If the session analyzed data files, does the log entry link to the analysis location?
- Pattern to check: Log entries should use relative paths when referencing project files (e.g., "Analysis at `experiments/foo/analysis.md`" or "See `experiments/bar/EXPERIMENT.md`")
- Flag log entries that mention experiments/work without corresponding file links
- Exception: Zero-resource tasks or routine maintenance work without substantive experiment artifacts

### 4. Compile report

Produce a structured compliance report:

```markdown
## Convention Compliance Report — YYYY-MM-DD

Scope: <time range>
Sessions audited: <count>
Commits examined: <count>

### Summary
| Check | Status | Violations |
|-------|--------|------------|
| Log entry completeness | PASS/WARN/FAIL | <count> |
| Inline logging discipline | PASS/WARN/FAIL | <count> |
| Findings provenance | PASS/WARN/FAIL | <count> |
| Task lifecycle hygiene | PASS/WARN/FAIL | <count> |
| Budget compliance | PASS/WARN/FAIL | <count> |
| Experiment record coverage | PASS/WARN/FAIL | <count> |
| Archive thresholds | PASS/WARN/FAIL | <count> |
| Decision debt | PASS/WARN/FAIL | <count> |
| Cross-referencing discipline | PASS/WARN/FAIL | <count> |

Overall: <X/9 passing>

### Violations

#### <Check name>
- **Violation**: <what was wrong>
  **Location**: <file:line or commit hash>
  **Convention**: <which CLAUDE.md section>
  **Severity**: low | medium | high
  **Suggested fix**: <concrete action>

### Trends
<If auditing >24h, note patterns: are violations improving or recurring?>
```

### 5. Write report to file

Save the report to `projects/youji/diagnosis/compliance-audit-<date>.md`.

### 6. Create remediation tasks

For high-severity violations, create tasks in the relevant project's TASKS.md with `Priority: high` and reference the audit report.

## Commit

Follow `docs/sops/commit-workflow.md`. Commit message: `self-audit: convention compliance report <date>`
