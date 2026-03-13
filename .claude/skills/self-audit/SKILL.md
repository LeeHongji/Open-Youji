---
name: self-audit
description: "Use when recent sessions need to be checked for compliance with CLAUDE.md conventions"
argument-hint: "[time range: 'last-session', '24h', '3d', '7d']"
---

# /self-audit [time-range]

Audit recent session work for compliance with CLAUDE.md conventions. The argument specifies the scope: `last-session` (default), `24h`, `3d`, or `7d`. Reads recent commits and diffs to identify convention violations.

## When to use this vs alternatives

- **Use `/self-audit`** when you want to check whether recent sessions followed CLAUDE.md conventions (log entries, commit discipline, experiment structure, task tags).
- **Use `/review`** when you want to check whether specific findings are valid or metric computations are meaningful. `/review` checks claim quality; `/self-audit` checks process compliance.

## Procedure

### 1. Determine scope

Parse the time-range argument:
- `last-session` (default): examine the most recent session's commits only
- `24h`, `3d`, `7d`: examine all commits in that time window

```bash
git log --oneline --since="<time>" --format="%H %s"
```

### 2. Gather session diffs

For each commit in scope:
```bash
git diff <commit>^..<commit> --stat
git diff <commit>^..<commit> -- '*.md'
```

### 3. Run compliance checks

**Check 1: Log entry completeness**
- Every session should have a dated log entry in each project README it modified
- Log entry should include: what happened, what was learned
- Read the project READMEs modified in the diff and verify log entries exist

**Check 2: Inline logging discipline**
- Large commits with many file changes but only end-of-session log entries
- Config changes without corresponding log entries in the same commit
- New experiment directories created without EXPERIMENT.md in the same commit

**Check 3: Findings provenance**
- For any EXPERIMENT.md files modified, read the Findings section
- Check each numerical claim has either:
  - A script reference (e.g., "analysis/script.py produces...")
  - Inline arithmetic (e.g., "96/242 = 39.7%")
- Flag findings with bare numbers and no provenance

**Check 4: Task lifecycle hygiene**
- Flag tasks with `[in-progress: <date>]` where the date is >3 days old (stale)
- Flag tasks marked `[x]` with "(partial)" in description (anti-pattern per CLAUDE.md)
- Flag tasks with `Done when:` conditions that appear unverifiable

**Check 5: Experiment record coverage**
- Identify commits that changed >5 files or created new directories under `experiments/`
- Verify each has a corresponding EXPERIMENT.md
- Flag significant work without experiment records

**Check 6: Archive thresholds**
- Count log entries in each project README
- Flag if any README has >5 recent entries
- Count completed tasks in TASKS.md files; flag if >15 completed tasks need archiving

**Check 7: Decision debt**
- New conventions introduced without a decision record
- CLAUDE.md modifications without corresponding ADR
- Workarounds or TODOs introduced without tracking

**Check 8: Cross-referencing discipline**
- For each log entry, check if the session created/modified experiment directories — does the log entry reference them?
- Flag log entries that mention experiments without file links

### 4. Compile report

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
| Experiment record coverage | PASS/WARN/FAIL | <count> |
| Archive thresholds | PASS/WARN/FAIL | <count> |
| Decision debt | PASS/WARN/FAIL | <count> |
| Cross-referencing discipline | PASS/WARN/FAIL | <count> |

Overall: <X/8 passing>

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

Save to `projects/<relevant-project>/diagnosis/compliance-audit-YYYY-MM-DD.md`.

### 6. Create remediation tasks

For high-severity violations, create tasks in the relevant project's TASKS.md with `Priority: high` and reference the audit report.

## Commit

Commit message: `self-audit: convention compliance report <date>`
