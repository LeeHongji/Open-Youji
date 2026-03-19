# 0038: Chat Interview Pattern for Skills

Date: 2026-02-26
Status: accepted

## Context

Skills like `/project scaffold` require multi-turn user interviews before execution.
Previously, ALL skills (except coordinator) were immediately escalated to deep work — a
single-shot opus session with no conversation state. When deep work needed user input,
it used `[ACTION:await_response]` or `[QUESTION:]` markers, both of which kill the
session and spawn a new one per round. This is fragile and expensive for multi-round
interviews.

## Decision

Let the chat agent (which already has multi-turn conversation state) conduct the
interview, then delegate to deep work with complete context for execution.

Skills opt in by declaring `interview: true` in their SKILL.md frontmatter and providing
a `## Chat Interview` section with instructions for the chat agent.

**New flow for interview skills:**
1. User invokes a skill (e.g., `/project scaffold my project`)
2. `processMessageInner()` detects the skill via `detectSkillInvocation()`
3. Checks `skill.interview === true` → sets `conv.activeInterview` instead of spawning deep work
4. Falls through to normal chat path with interview instructions injected into prompt
5. Chat agent asks questions, user answers over multiple turns
6. When done, chat agent emits `[ACTION:deep_work task="Run /project scaffold ... <complete context>"]`
7. Existing deep_work handler spawns opus session with full context — no round-trips needed

**Changes:**
- `skills.ts`: Added `interview`, `interviewPrompt` to `SkillInfo`; `extractInterviewSection()` and `readInterviewPrompt()` helpers
- `chat.ts`: Added `activeInterview` to `ConversationState`; route interview skills to chat path; clear interview state on deep_work spawn
- `chat-prompt.ts`: Added `InterviewContext` type and `interviewContext` parameter to `buildChatPrompt()`; inject interview instructions or skill invocation check conditionally
- `SKILL.md` (project): Added `interview: true` frontmatter and `## Chat Interview` section

## Consequences

- Interview skills no longer waste opus sessions per question round
- Chat agent handles the lightweight interview; deep work gets a single, context-rich delegation
- Non-interview skills are unaffected — they still escalate immediately to deep work
- New skills can opt in by adding `interview: true` and a `## Chat Interview` section
- The `activeInterview` state persists in the conversation until deep work is spawned, so follow-up messages during the interview don't re-trigger skill detection
