# 0004: Inline logging discipline

Date: 2026-02-15
Status: accepted

## Context

During a Cloudflare AI Gateway integration (experiment-pipeline, 2026-02-15), an agent completed all code changes and environment verification but did not log findings, decisions, or verification results until explicitly prompted by a human. The existing CLAUDE.md work-cycle rules ("record as you go, not at the end") were correct but too abstract to prevent the failure. The agent treated logging as a post-hoc summary step rather than an inline activity interleaved with implementation.

The root cause: implementation momentum. Once an agent starts writing code and running tests, the bias is to keep going until the task is "done," then summarize. This loses intermediate findings (e.g., "the OpenAI SDK appends `/chat/completions` to `base_url`") that are exactly the kind of operational knowledge the repo must capture.

## Decision

Strengthen the CLAUDE.md work-cycle section with concrete, checkable rules:

1. **Same-turn recording.** When you discover a non-obvious fact, write it to the relevant project file in the same tool-call turn — before proceeding to the next implementation step.
2. **Config/env changes require log entries.** Any change to `.env`, config files, or deployment settings gets a log entry with before/after values and rationale.
3. **Verification = provenance.** Log the exact command and its output. "Tested end-to-end" is insufficient; the command that proved it must be in the log.
4. **Incremental, not batched.** Multiple smaller log entries during a session are correct. One summary at session end is a fallback, not the primary mechanism.

## Consequences

- CLAUDE.md work-cycle section gets a concrete checklist appended after the existing bullet points.
- Agents will produce more verbose README logs. This is acceptable — logs can be archived to `log/YYYY-MM.md` per existing convention when they grow past ~150 lines.
- The auto-memory file at `.claude/projects/.../memory/MEMORY.md` retains a copy as a session-start reminder, but the authoritative source is CLAUDE.md.
