# ADR-0003: Inline logging — record as you go

Date: 2026-03-13
Status: accepted

## Context

Session summaries written at the end are the primary knowledge-loss pattern. If a session times out, crashes, or runs out of context, end-of-session summaries never get written.

## Decision

Record findings, decisions, and discoveries inline — immediately when they happen, not at session end.

The inline logging checklist:
1. Discovery of non-obvious fact → write to project file in the same turn
2. Config/env change → log entry with before/after immediately
3. Successful verification → log exact command and output
4. Log incrementally throughout the session
5. Every claim needs provenance

## Consequences

- Session end summaries become a fallback, not the primary mechanism
- Incremental commits protect against session failure
- Knowledge is preserved even if the session terminates unexpectedly
- Slightly more overhead per turn, but dramatically less knowledge loss
