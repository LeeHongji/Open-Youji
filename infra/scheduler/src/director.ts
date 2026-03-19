/**
 * Director intelligence module — Youji's conversational brain.
 *
 * Handles Slack messages by running Claude SDK sessions with resume support.
 * Builds Youji's persona system prompt and manages session continuity.
 */

import { runQuery } from "./sdk.js";
import type { ThreadMessage } from "./thread-store.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface DirectorMessageOpts {
  convKey: string;
  userMessage: string;
  history: ThreadMessage[];
  repoDir: string;
}

// ── Session ID storage (ephemeral, in-memory) ───────────────────────────────

const sessionMap = new Map<string, string>();

/** Exposed for testing: clear all stored session IDs. */
export function _resetSessions(): void {
  sessionMap.clear();
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Handle an incoming director message by running a Claude SDK session.
 * Uses `resume` for multi-turn context when a prior session ID exists.
 * Falls back to history injection if resume fails.
 */
export async function handleDirectorMessage(opts: DirectorMessageOpts): Promise<string> {
  const storedSessionId = sessionMap.get(opts.convKey);

  try {
    const result = await runQuery({
      prompt: opts.userMessage,
      cwd: opts.repoDir,
      model: "sonnet",
      systemPrompt: {
        type: "preset" as const,
        preset: "claude_code" as const,
        append: buildYoujiDirective(opts),
      },
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 16,
      resume: storedSessionId ?? undefined,
      settingSources: ["project"],
    });

    if (result.sessionId) {
      sessionMap.set(opts.convKey, result.sessionId);
    }

    return result.text;
  } catch (error) {
    // Resume failed — fall back to fresh session with history injection
    if (storedSessionId) {
      const historyPrompt = buildHistoryPrompt(opts.history, opts.userMessage);

      const result = await runQuery({
        prompt: historyPrompt,
        cwd: opts.repoDir,
        model: "sonnet",
        systemPrompt: {
          type: "preset" as const,
          preset: "claude_code" as const,
          append: buildYoujiDirective(opts),
        },
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        maxTurns: 16,
        settingSources: ["project"],
      });

      if (result.sessionId) {
        sessionMap.set(opts.convKey, result.sessionId);
      }

      return result.text;
    }

    // No stored session — cannot fall back, re-throw
    throw error;
  }
}

/**
 * Build the Youji directive that is appended to the claude_code system prompt.
 * Defines persona, capabilities, and constraints.
 */
export function buildYoujiDirective(opts: DirectorMessageOpts): string {
  return `
## Identity

You are Youji (优吉), the director of a research institute. You are a conversational agent communicating with your mentor via Slack.

## Communication

- Auto-detect the mentor's language from their message and respond in the same language.
- Be concise but thorough. Prefer action over discussion.
- When uncertain, ask the mentor rather than guessing.

## Task Decomposition

You proactively decompose high-level goals into concrete tasks. Do not wait for confirmation before decomposing — if you understand the goal, begin immediately.

Write tasks to the appropriate project's TASKS.md file using this format:

\`\`\`
- [ ] Task description [skill: execute] [fleet-eligible]
  Done when: <concrete, verifiable completion condition>
\`\`\`

Use existing tag conventions:
- \`[in-progress: YYYY-MM-DD]\` — task is being worked on
- \`[blocked-by: <description>]\` — cannot proceed until condition is met
- \`[skill: record]\` — documentation/status tasks
- \`[skill: execute]\` — implementation tasks
- \`[skill: analyze]\` — analysis tasks
- \`[skill: diagnose]\` — debugging tasks
- \`[fleet-eligible]\` — can be assigned to fleet workers
- \`[requires-opus]\` — needs complex reasoning

## Worker Spawning

After decomposing tasks, you can spawn workers to execute them by emitting a tag at the end of your response:

\`[spawn-worker: <project-name>]\`

Examples:
- \`[spawn-worker: myproject]\`
- \`[spawn-worker: myproject model=sonnet]\`

The slack-bridge will parse this tag and start the worker. Only emit this when tasks are ready in TASKS.md.

## Decision Making

Before making significant choices:
1. Read the \`decisions/\` directory for existing decision records
2. Follow conventions defined in CLAUDE.md
3. Respect approval gates — do not proceed with actions that require human approval

## Constraints

- You operate in the repository at: ${opts.repoDir}
- Read project state from project README files and TASKS.md
- Never modify governance files (CLAUDE.md, decisions/) without approval
- Respect approval gates defined in the project's CLAUDE.md
`.trim();
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Build a prompt that injects conversation history as a prefix.
 * Used as fallback when SDK `resume` fails.
 */
function buildHistoryPrompt(history: ThreadMessage[], newMessage: string): string {
  if (history.length === 0) {
    return newMessage;
  }

  const historyLines = history.map((msg) => {
    const role = msg.role === "user" ? "User" : "Assistant";
    return `${role}: ${msg.content}`;
  });

  return `Previous conversation:\n${historyLines.join("\n")}\n\nNew message: ${newMessage}`;
}
