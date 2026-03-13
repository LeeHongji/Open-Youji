## Convention Compliance Report — 2026-03-14

Scope: all sessions (repo initialized this date)
Sessions audited: 2 (init session + post-init session)
Commits examined: 3

### Summary

| Check | Status | Violations |
|-------|--------|------------|
| Log entry completeness | WARN | 1 |
| Inline logging discipline | WARN | 1 |
| Findings provenance | PASS | 0 |
| Task lifecycle hygiene | PASS | 0 |
| Experiment record coverage | PASS | 0 |
| Archive thresholds | PASS | 0 |
| Decision debt | PASS | 0 |
| Cross-referencing discipline | PASS | 0 |

Overall: 6/8 passing

### Violations

#### Log entry completeness

- **Violation**: Commits `b120409` and `b60c0f0` modified `infra/scheduler/src/session.ts`
  and `types.ts` (output capture feature) with no corresponding log entry in any project README.
  **Location**: `projects/youji/README.md` — no entry covering the output capture work.
  **Convention**: CLAUDE.md § Work cycle — "Finding → file, immediately"; every session should
  add a dated log entry to every project README touched.
  **Severity**: medium
  **Suggested fix**: Add a 2026-03-14 log entry to `projects/youji/README.md` documenting
  the output capture change (already done in this session — see remediation below).

#### Inline logging discipline

- **Violation**: Initialization commit `4930053` bundles 110 files in a single commit.
  CLAUDE.md requires "commit incrementally after each logical unit of work."
  **Location**: commit `4930053`
  **Convention**: CLAUDE.md § Session discipline — "Commit incrementally."
  **Severity**: low (one-time bootstrapping event; monolithic init commits are an accepted
  exception in practice because the system doesn't exist yet to commit incrementally)
  **Suggested fix**: Document this exception in ADR or getting-started notes. Subsequent
  sessions must not repeat the pattern.

### Trends

No trend data yet — this is the first audit. Establish baseline:
- Convention compliance rate: 6/8 = 75%
- Log entry coverage: 1 project README × 1 session covered = gap for infra-only sessions
- Inline logging: 1 monolithic commit (bootstrapping), 2 incremental commits thereafter

Key observation: sessions that only touch `infra/` files don't naturally produce a project
log entry because no project directory is modified. A convention gap exists: infra changes
should log to `projects/youji/README.md` or a dedicated `infra/CHANGELOG.md`. This is a
structural gap, not individual negligence.

### Remediation tasks created

See TASKS.md — added task to document the infra-change logging gap.
