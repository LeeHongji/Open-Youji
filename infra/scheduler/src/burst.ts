/** Burst mode — run sessions in a rapid loop until a stop condition is met. */

import type { Job } from "./types.js";
import type { ExecutionResult } from "./executor.js";

// ── Autofix types (dependency-injected) ──────────────────────────────────────

export interface DiagnoseOpts {
  job: Job;
  result: ExecutionResult;
  sessionNumber: number;
  attempt: number;
  maxAttempts: number;
  repoDir: string;
}

export interface DiagnoseResult {
  verdict: "retry" | "skip" | "stop";
  summary: string;
  costUsd: number;
  durationMs: number;
}

export interface AutofixConfig {
  maxRetries: number;
  diagnose: (opts: DiagnoseOpts) => Promise<DiagnoseResult>;
  repoDir: string;
}

// ── Burst types ──────────────────────────────────────────────────────────────

export interface BurstOptions {
  job: Job;
  maxSessions: number;
  maxCost: number;
  execute: (job: Job) => Promise<ExecutionResult>;
  onSessionComplete?: (sessionNumber: number, result: ExecutionResult, totalCost: number) => void;
  autofix?: AutofixConfig;
  onAutofix?: (attempt: number, fixResult: DiagnoseResult) => void;
}

export type StopReason = "max-sessions" | "max-cost" | "no-actionable-tasks" | "error" | "autofix-exhausted";

export interface BurstResult {
  sessionsRun: number;
  totalCost: number;
  totalDurationMs: number;
  stopReason: StopReason;
  sessionResults: ExecutionResult[];
  autofixAttempts: number;
}

const NO_TASKS_PATTERNS = [
  /no actionable tasks/i,
  /no actionable tasks exist/i,
];

function detectNoActionableTasks(stdout: string): boolean {
  return NO_TASKS_PATTERNS.some((pattern) => pattern.test(stdout));
}

export async function runBurst(opts: BurstOptions): Promise<BurstResult> {
  const { job, maxSessions, maxCost, execute, onSessionComplete } = opts;
  const sessionResults: ExecutionResult[] = [];
  let totalCost = 0;
  let totalDurationMs = 0;
  let stopReason: StopReason = "max-sessions";
  let autofixAttempts = 0;

  for (let i = 0; i < maxSessions; i++) {
    const result = await execute(job);
    const sessionCost = result.costUsd ?? 0;
    totalCost += sessionCost;
    totalDurationMs += result.durationMs;
    sessionResults.push(result);

    onSessionComplete?.(i + 1, result, totalCost);

    // Check stop conditions in priority order
    if (!result.ok) {
      // Autofix: attempt diagnosis if configured and retries remain
      if (opts.autofix && autofixAttempts < opts.autofix.maxRetries) {
        autofixAttempts++;
        const fixResult = await opts.autofix.diagnose({
          job,
          result,
          sessionNumber: i + 1,
          attempt: autofixAttempts,
          maxAttempts: opts.autofix.maxRetries,
          repoDir: opts.autofix.repoDir,
        });

        totalCost += fixResult.costUsd;
        totalDurationMs += fixResult.durationMs;
        opts.onAutofix?.(autofixAttempts, fixResult);

        if (fixResult.verdict === "retry") {
          i--; // retry same session slot
          continue;
        } else if (fixResult.verdict === "skip") {
          continue; // advance to next session
        }
        // verdict === "stop" — fall through to break
      }

      stopReason = opts.autofix && autofixAttempts >= opts.autofix.maxRetries
        ? "autofix-exhausted"
        : "error";
      break;
    }

    if (detectNoActionableTasks(result.stdout)) {
      stopReason = "no-actionable-tasks";
      break;
    }

    if (totalCost >= maxCost) {
      stopReason = "max-cost";
      break;
    }
  }

  return {
    sessionsRun: sessionResults.length,
    totalCost,
    totalDurationMs,
    stopReason,
    sessionResults,
    autofixAttempts,
  };
}
