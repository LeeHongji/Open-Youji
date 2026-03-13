# ADR-0001: Repository as cognitive state

Date: 2026-03-13
Status: accepted

## Context

Youji (this AI research assistant) operates through Claude Code sessions that are completely stateless — all context is lost between sessions. We need a mechanism for persistent memory, knowledge accumulation, and decision consistency.

## Decision

The Git repository itself serves as Youji's persistent cognitive state. All memory, knowledge, findings, decisions, and research progress are encoded as plain text files in the repo and committed to version control.

This approach is borrowed from [OpenAkari](https://github.com/victoriacity/openakari), which demonstrated its effectiveness across hundreds of autonomous sessions.

## Consequences

- Every session must begin by reading repo state to orient
- Every session must end by committing everything learned
- The inline logging rule applies: record as you go, not at the end
- The test for session quality: "if a fresh session read only the repo, would it know everything?"
- Plain text formats (Markdown, YAML) are preferred for all artifacts
- Git history provides full audit trail of how knowledge evolved
