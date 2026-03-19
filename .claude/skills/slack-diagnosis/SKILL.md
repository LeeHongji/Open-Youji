---
name: slack-diagnosis
description: "Use when a Slack thread shows the bot behaving incorrectly and the root cause needs investigation"
complexity: medium
model-minimum: glm-5
disable-model-invocation: false
allowed-tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash(curl *)", "Bash(jq *)", "Bash(wc *)", "Bash(cat *)", "Bash(cd * && npx tsc --noEmit)"]
argument-hint: "[problem description, thread URL, channel:timestamp, or 'recent']"
---

# /slack-diagnosis <argument>

Diagnose Slack bot issues by reading actual Slack messages, correlating with system logs, and implementing fixes.

The argument is context about what to investigate — a problem description, a thread URL, a `channel:timestamp` pair, or `recent`. Regardless of argument type, **always start by fetching real Slack messages**.

## Step 0: Verify runtime environment (ALWAYS do this first)

Before analyzing application logs, verify the process topology. This catches orphan processes, duplicate instances, and deployment issues that application logs alone cannot reveal.

```bash
pm2 list
```

Check for scheduler processes outside PM2:

```bash
ps aux | grep -E 'cli.js|scheduler' | grep -v grep
```

If multiple instances found:
- This is likely the root cause.
- Document which PIDs are running.
- Check when they started: `ps -o pid,lstart,cmd -p <PID>`
- Identify which log files each uses.

Check for orphan log files:

```bash
ls -la /tmp/youji-*.log
```

**If orphan log files exist or multiple scheduler processes are running:**
- Cross-reference their timestamps with the issue being diagnosed.
- Messages may have been handled by the orphan process (logged to `/tmp/`) instead of PM2 logs.
- This explains "ghost sessions" where Slack shows bot responses but PM2 logs are empty.

**Only proceed to Step 1 if the runtime environment is clean (single PM2-managed instance, no orphan logs).**

## Step 1: Fetch Slack messages

The DM channel ID is `D0AF4CX9U3U`. The bot token is read inline from `infra/scheduler/.env`.

**Always fetch recent DM history first** to see the latest conversations:

```bash
curl -s "https://slack.com/api/conversations.history?channel=D0AF4CX9U3U&limit=20" \
  -H "Authorization: Bearer $(grep '^SLACK_BOT_TOKEN=' infra/scheduler/.env | cut -d= -f2)" | jq '.messages[] | {ts, user, bot_id, text: (.text // "" | .[0:200]), thread_ts, reply_count}'
```

Then, for any message that has `thread_ts` (i.e., is part of a thread) and looks relevant to the reported issue, fetch the full thread:

```bash
curl -s "https://slack.com/api/conversations.replies?channel=D0AF4CX9U3U&ts=THREAD_TS&limit=100" \
  -H "Authorization: Bearer $(grep '^SLACK_BOT_TOKEN=' infra/scheduler/.env | cut -d= -f2)" | jq '.messages[] | {ts, user, bot_id, text: (.text // "" | .[0:500])}'
```

If a specific `channel:timestamp` or thread URL was provided, fetch that thread too. But always start with recent history to get the full picture.

**Identify the relevant thread(s):** match the argument's problem description against the fetched messages. Look for threads where the described issue occurred.

## Step 2: Correlate with system logs

For the same time window as the relevant thread(s):

1. **Interaction log**: Read `.scheduler/metrics/interactions.jsonl` — filter entries whose `threadKey` matches the thread's `channel:timestamp`. Fields to examine:
   - `action`, `result`, `detail` — what the bot did and whether it succeeded
   - `turnsBeforeAction` — how many user messages preceded this action (high = friction)
   - `userCorrected` — whether the user had to rephrase
   - `intentFulfilled` — auto-classified as fulfilled/partial/failed/abandoned
   - `intentType` — status/approval/experiment/session/job/other

2. **PM2 application log**: Read the tail of `~/.pm2/logs/youji-out.log` around the thread's time window. Look for `[chat]`, `[agent]`, `[experiments]`, `[slack]`, or `[autofix]` entries that correlate with the conversation.

3. **Chat agent source**: If the bot did something unexpected, cross-reference with:
   - `infra/scheduler/src/chat.ts` — action dispatch, confirmation flow, context gathering
   - `infra/scheduler/src/agent.ts` — agent profiles (model, turns, duration), spawn logic
   - `infra/scheduler/src/event-agents.ts` — event-triggered agents (experiment completion → deep work escalation)
   - `infra/scheduler/src/slack.ts` — Slack message delivery, experiment watcher callbacks

## Step 3: Map the conversation flow

For each message exchange in the relevant thread(s), annotate:

- **User intent**: What was the user trying to accomplish?
- **Bot interpretation**: How did the bot interpret the request?
- **Bot response**: Was it accurate, timely, and helpful?
- **System behavior**: Did the underlying system behave correctly?
- **Friction points**: Where did the user need to clarify, repeat, or work around the bot?

## Step 4: Classify issues

For each issue found, classify:

| Category | Description | Example |
|---|---|---|
| **Misunderstanding** | Bot parsed the wrong intent | User said "restart the experiment" but bot showed status instead |
| **Missing capability** | User wanted something the bot can't do yet | "Show me the experiment logs" but no log-viewing action exists |
| **Poor feedback** | Bot did the right thing but communicated it badly | Launched experiment but didn't confirm which command was run |
| **Error handling** | System error was not surfaced or handled gracefully | API call failed silently, user got no response |
| **Latency/UX** | Response was too slow or required too many steps | User had to send 3 messages to accomplish one action |
| **Incorrect behavior** | Bot or system did the wrong thing entirely | Approved the wrong item, launched wrong experiment |
| **Information gap** | Bot lacked context it should have had | Didn't know experiment was already running |
| **Escalation issue** | Deep work escalation triggered incorrectly or task description was poor | Deep work spawned but couldn't complete due to missing context |

Also identify **what worked well**.

## Step 5: Recommend improvements

For each issue, propose a concrete fix. Classify by layer:

- **L0 Code** — bug fix in chat.ts, agent.ts, slack.ts, experiments.ts, etc.
- **L2 Workflow** — change to how the bot processes or routes messages
- **L3 Interface** — change to message formatting, confirmations, or help text
- **System** — change to scheduler, runner, or infrastructure behavior

Prioritize by: impact x frequency.

## Output format

```
## Slack Thread Diagnosis: <brief description>
Date: YYYY-MM-DD
Thread: <channel:timestamp or URL>
Messages analyzed: <count>

### Conversation summary
<2-3 sentences describing what the thread was about>

### What worked well
<bulleted list of positive observations>

### Issues found

#### Issue 1: <title>
Category: <from table above>
Layer: <L0/L2/L3/System>
Severity: high | medium | low
Evidence: <quote from thread or log>
Impact: <what went wrong for the user>
Fix: <concrete change — file, function, and what to change>

[repeat for each issue]

### System log correlation
<any interesting findings from interactions.jsonl or PM2 logs>

### Improvement roadmap
1. <highest priority fix — what and where>
2. ...

### Patterns
<any recurring patterns that suggest deeper issues>
```

## Step 6: Save diagnosis to disk

**MANDATORY:** Write the diagnosis to a file before implementing any fixes.

**File path:** `projects/<project>/diagnosis/diagnosis-<brief-slug>-YYYY-MM-DD.md`

Create the `diagnosis/` directory if it doesn't exist yet. Use the project most relevant to the issue being diagnosed (usually `youji` for infrastructure issues).

**Diagnosis vs postmortem:** Use `diagnosis/` for operational investigations (unexpected behavior, thread analysis). If the investigation reveals a serious incident — resource waste, systemic failure, or flawed agent reasoning — escalate to a `/postmortem` record in `projects/<project>/postmortem/` instead.

Example: `projects/youji/diagnosis/diagnosis-slack-thread-model-comparison-focused-v2-2026-02-16.md`

The diagnosis file must contain the complete output from Steps 1-5, formatted as markdown.

This ensures:
- Diagnoses are not lost when the conversation ends
- Future sessions can reference past diagnoses
- Patterns can be identified across multiple diagnoses
- The knowledge produced by diagnosis work persists in the repo

## Step 6b: Task Bridge

After saving the diagnosis, convert improvement roadmap items to tasks for items NOT fixed in this session:

1. Review the "Improvement roadmap" section
2. For each item you will fix in Steps 7-8: skip (it will be done in-session)
3. For each remaining item (deferred, lower priority, or requiring separate work):
   - Create a task in the relevant project's TASKS.md
   - Tag: `[fleet-eligible] [skill: execute]` for code fixes, `[skill: record]` for documentation
   - `Done when:` derived from the fix description
   - `Why:` referencing this diagnosis file path
4. For "Patterns" section items suggesting deeper systemic issues: create `[requires-opus]` investigation tasks

This ensures lower-priority improvements from slack diagnoses enter the task pipeline rather than being forgotten after the urgent fix is applied.

## Step 7: Write regression test BEFORE fixing

**This step is mandatory for L0 code fixes.** 33% of TDD violations originate from Slack diagnosis urgency — the "user is waiting" pressure bypasses test discipline. Writing the test first takes ~2 minutes and prevents regressions.

1. Identify the test file: colocated `<module>.test.ts` next to the source file being fixed.
2. Write a test that **reproduces the bug** — it should fail with the current code.
3. Run `cd infra/scheduler && npm test` to confirm the test fails (or target a specific file: `cd infra/scheduler && npx vitest run <file>`).
4. Only then proceed to Step 8 to implement the fix.

**Skip this step ONLY if** the fix is purely non-behavioral: prompt text changes, log message wording, or configuration value changes with no testable code path.

| Excuse | Reality |
|--------|---------|
| "The user is waiting / this is urgent" | Urgency makes regression tests MORE important. The next occurrence won't have a user watching to verify. The test takes 2 minutes. |
| "I already verified it in the Slack thread" | Manual thread verification is ad-hoc, non-repeatable, and leaves no regression guard. |
| "The fix is obvious, just one line" | One-line fixes cause regressions. The regression test takes 2 minutes. |

## Step 8: Implement fixes

After diagnosis is saved and regression test is written, implement fixes that are safe to apply autonomously.

**Safe to fix autonomously (L0 code fixes):**
- Bug fixes in chat.ts, agent.ts, slack.ts, experiments.ts, etc.
- Prompt/system prompt improvements
- Error message improvements
- run.sh parameter changes
- Configuration fixes

**Requires approval (write to APPROVAL_QUEUE.md instead):**
- New files that introduce new architectural patterns
- Schema changes affecting external contracts
- Security-related changes (auth, permissions, token handling)
- Changes to CLAUDE.md or decision records

**After any TypeScript edit**, run `cd infra/scheduler && npx tsc --noEmit` to verify the code compiles.

**After implementing fixes:**
1. Run `cd infra/scheduler && npm test` to confirm the regression test now passes.
2. Add a summary to the diagnosis file documenting what was changed.

## Step 9: Commit

Follow `docs/sops/commit-workflow.md`. Commit message: `slack-diagnosis: <brief summary of findings and fixes>`
