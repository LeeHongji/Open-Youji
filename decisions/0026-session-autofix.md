# 0026: Session Autofix for Burst Mode

Date: 2026-02-20
Status: accepted

## Context

Burst mode (`burst.ts`) runs scheduler sessions in a rapid loop but stops immediately on any session error — `stopReason: "error"`, no diagnosis, no retry. The experiment subsystem already has autofix (ADR 0009, `event-agents.ts`): when an experiment fails, a diagnostic agent investigates, fixes config, and relaunches. Burst mode sessions lack this resilience.

Session failures during burst runs can be transient (rate limits, temporary git state issues, SDK hiccups) or systemic (broken environment, persistent bugs). Stopping the entire burst on the first transient failure wastes the remaining session budget and requires human intervention to restart.

## Decision

Add opt-in session autofix to burst mode via dependency injection:

1. **New module `session-autofix.ts`**: Contains `diagnoseSession()` which spawns an autofix agent (reusing `AGENT_PROFILES.autofix` from `agent.ts`) to investigate a failed session. The agent receives the session error, stdout tail, job context, and repository access.

2. **Three verdicts**: The diagnostic agent emits one of:
   - `[SESSIONFIX:retry]` — issue fixed or transient, safe to retry the session
   - `[SESSIONFIX:skip]` — issue specific to this session, skip and continue burst
   - `[SESSIONFIX:stop]` — systemic issue, halt the burst for human intervention

3. **Burst loop integration**: `burst.ts` accepts an optional `AutofixConfig` with a `diagnose` function (injected, not imported). On session failure with autofix enabled and retries remaining, the loop calls `diagnose()` and acts on the verdict: retry (re-run same session slot), skip (advance to next), or stop (break with `"error"`). A new stop reason `"autofix-exhausted"` indicates all retry attempts were consumed.

4. **Per-burst retry limit**: The `autofixAttempts` counter is shared across the entire burst run, not per-session. Default: 3 retries max.

5. **Cost tracking**: Autofix agent cost counts toward the burst's `totalCost` and `totalDurationMs`.

6. **CLI integration**: `--autofix` flag enables the feature; `--autofix-retries <N>` overrides the default retry limit.

## Consequences

- **Burst.ts stays pure.** The `diagnose` function is injected via `AutofixConfig`, not imported. Burst.ts has no dependency on `session-autofix.ts`, maintaining its testability with mock functions.

- **Different from experiment autofix.** Experiment autofix reads config files, validates, and relaunches. Session autofix triages and advises the burst loop. The agents share the same profile (`AGENT_PROFILES.autofix`) but have different prompts and output protocols (`[AUTOFIX:*]` vs `[SESSIONFIX:*]`).

- **Conservatism on final attempt.** The diagnostic prompt instructs the agent to prefer `[SESSIONFIX:stop]` on the final retry attempt, reducing the risk of wasting turns on unfixable issues.

- **Opt-in only.** Without `--autofix`, burst mode behavior is unchanged — stops immediately on error. This preserves backward compatibility.

- **No Slack integration yet.** Autofix progress is logged to console via `onAutofix` callback. Slack forwarding can be added later by wiring `onProgress` in `cmdBurst`.
