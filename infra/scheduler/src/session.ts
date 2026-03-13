/**
 * Session management — building prompts and spawning claude -p processes.
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { SessionConfig, SessionResult, FleetTask } from './types.js';

/** Path to the lightweight autonomous settings (disables all plugins). */
export function getAutonomousSettingsPath(repoDir: string): string {
  return resolve(repoDir, 'infra/scheduler/settings-autonomous.json');
}

/** Build the prompt for a supervisor (Opus) session. */
export function buildSupervisorPrompt(repoDir: string): string {
  return `You are Youji, an autonomous AI research assistant. This is an autonomous session — no human is present.
Skills are disabled in this session. Do NOT invoke slash commands like /orient, /compound, etc.

## Step 1: Orient (inline)

Run these in parallel:
- git log --oneline -5
- git status

Then read:
- APPROVAL_QUEUE.md (check for pending items)
- projects/youji/TASKS.md (find unblocked tasks)
- projects/youji/README.md (first 30 lines, for context)

Select the single highest-priority unblocked task. If no tasks exist, skip to step 3 with "no actionable tasks."

## Step 2: Execute

Work the selected task. Commit after each logical unit of work.

## Step 3: Log and push

1. Add a dated log entry to the project README (### YYYY-MM-DD, what you did).
2. If you completed a task, mark it [x] in TASKS.md.
3. git add and git commit.
4. git push

## Step 4: Exit

Output a one-line summary starting with "Session complete:" and STOP. Make no more tool calls after this.

## Rules
- If a task requires human approval, write to APPROVAL_QUEUE.md, commit, push, and exit.
- Never sleep more than 30 seconds.
- Budget is limited. One task per session is fine.
- Do NOT explore the repo beyond what's needed for the task.
- Do NOT modify CLAUDE.md, decisions/, or infra/ unless the task requires it.

Working directory: ${repoDir}`;
}

/** Build the prompt for a fleet worker (Sonnet) session. */
export function buildFleetPrompt(task: FleetTask): string {
  let prompt = `You are Youji, an autonomous AI research assistant. You are a fleet worker assigned a specific task.

Do NOT run /orient. Do NOT run /compound. Focus only on the assigned task.

## Assigned task

Project: ${task.project}
Task: ${task.text}
Priority: ${task.priority}`;

  if (task.doneWhen) {
    prompt += `\nDone when: ${task.doneWhen}`;
  }
  if (task.why) {
    prompt += `\nWhy: ${task.why}`;
  }

  prompt += `

## Instructions

1. Read the project README at projects/${task.project}/README.md for context.
2. Execute the task above.
3. When done, mark the task as [x] in projects/${task.project}/TASKS.md.
4. Commit your work with a descriptive message.
5. Run: git push
6. If the task is harder than expected or you are blocked, add [escalate: <reason>] to the task and commit.

Rules:
- Do NOT modify CLAUDE.md, decisions/, or infra/ code.
- Commit incrementally after each logical unit of work.
- Never sleep more than 30 seconds.`;

  return prompt;
}

/** Parse the exit code and duration of a completed session. */
export function parseSessionOutput(exitCode: number, durationMs: number): SessionResult {
  return {
    success: exitCode === 0,
    exitCode,
    durationMs,
    label: '',
  };
}

/** Spawn a claude -p session as a child process. Returns a promise that resolves when done. */
export function spawnSession(config: SessionConfig): Promise<SessionResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const args = [
      '-p', config.prompt,
      '--model', config.model,
      '--permission-mode', 'bypassPermissions',
      '--output-format', 'text',
      '--no-session-persistence',
      '--settings', getAutonomousSettingsPath(config.cwd),
      '--disable-slash-commands',
    ];

    if (config.maxBudgetUsd !== undefined && config.maxBudgetUsd > 0) {
      args.push('--max-budget-usd', String(config.maxBudgetUsd));
    }

    if (config.flags) {
      args.push(...config.flags);
    }

    // Clean environment: remove all Claude-related env vars to allow spawning
    // from within a claude session.
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    const child = spawn('claude', args, {
      cwd: config.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],  // stdin=ignore: prevent blocking on stdin
      env,
    });

    // Capture output for logging
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    // Enforce max duration
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, config.maxDurationMs);

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        success: code === 0,
        exitCode: code ?? 1,
        durationMs: Date.now() - startTime,
        label: config.label,
        output: stdout.slice(-2000),  // Last 2000 chars
        error: code !== 0 ? `Process exited with code ${code}${stderr ? ': ' + stderr.slice(-500) : ''}` : undefined,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        exitCode: 1,
        durationMs: Date.now() - startTime,
        label: config.label,
        error: err.message,
      });
    });
  });
}
