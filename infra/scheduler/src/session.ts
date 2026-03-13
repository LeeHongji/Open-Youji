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

Execute the autonomous work cycle:

1. Run /orient fast to assess repo state and select the highest-leverage task.
2. Execute the selected task. Commit incrementally after each logical unit of work.
3. Write a session log entry to the project README.
4. Commit and run: git push

Do NOT run /compound — it is too expensive for autonomous sessions. Knowledge embedding happens during interactive sessions.

Rules:
- Check APPROVAL_QUEUE.md for pending items at the start.
- If a task requires human approval (budget increase, governance change, tool access), write to APPROVAL_QUEUE.md and end the session.
- Never sleep more than 30 seconds.
- Commit incrementally — do not defer all commits to the end.
- If no actionable tasks exist, log "no actionable tasks" and end cleanly.
- Budget is limited. Be efficient — prefer /orient fast over /orient full.
- After writing the session log, push immediately. Do not do additional work after the log entry.

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
