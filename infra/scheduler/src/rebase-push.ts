/** Post-session git rebase-before-push: ensures local commits reach origin even under concurrency. */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RebasePushResult {
  status: "pushed" | "branch-fallback" | "nothing-to-push" | "error";
  branch?: string;
  error?: string;
}

const SESSION_BRANCH_PATTERN = /^session-/;

function isSessionBranch(branch: string): boolean {
  return SESSION_BRANCH_PATTERN.test(branch);
}

export type PushQueueResult = "queued-success" | "queued-rebase-failed" | "direct-push" | "no-push-needed";

export interface EnqueuePushResult extends RebasePushResult {
  pushQueueResult: PushQueueResult;
}

export interface EnqueuePushOptions {
  apiUrl?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  priority?: "opus" | "fleet";
}

interface EnqueueResponse {
  sessionId: string;
  position: number;
}

interface StatusResponse {
  status: "queued" | "in-progress" | "completed" | "failed";
  result?: RebasePushResult;
  error?: string;
}

/**
 * Check if the current branch has unpushed commits relative to its remote tracking branch.
 * Returns the count of unpushed commits, or 0 if up-to-date or no tracking branch.
 */
export async function countUnpushedCommits(cwd: string): Promise<number> {
  try {
    const { stdout } = await exec(
      "git", ["rev-list", "--count", "@{upstream}..HEAD"],
      { cwd },
    );
    return parseInt(stdout.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Attempt to rebase local commits onto the remote and push.
 *
 * Strategy:
 * 1. If no unpushed commits, return early.
 * 2. Run `git pull --rebase origin main`.
 * 3. If rebase succeeds, push to main.
 * 4. If rebase fails (conflict), retry up to maxRetries times with retryDelayMs delay.
 * 5. If all retries fail, abort and push to a session-specific branch.
 *
 * The branch fallback ensures no work is lost — a future session or human
 * can merge the branch. See architecture/concurrency-safety.md §3 Race 3.
 */
export async function rebaseAndPush(
  cwd: string,
  sessionId: string,
  options?: { maxRetries?: number; retryDelayMs?: number },
): Promise<RebasePushResult> {
  const maxRetries = options?.maxRetries ?? 3;
  const retryDelayMs = options?.retryDelayMs ?? 3000;
  try {
    const unpushed = await countUnpushedCommits(cwd);
    if (unpushed === 0) {
      return { status: "nothing-to-push" };
    }

    // Determine the current branch name
    const { stdout: branchOut } = await exec(
      "git", ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd },
    );
    const currentBranch = branchOut.trim();

    // Detect session-branch entrapment: if on a session branch, switch to main
    // before attempting rebase. This prevents the 84% rebase failure cascade
    // where rebaseAndPush targets origin/<session-branch> (which may not exist
    // or be stale), fails, creates another session branch, and gets stuck.
    // Source: diagnosis/diagnosis-health-monitoring-signals-2026-03-06b.md
    const targetBranch = isSessionBranch(currentBranch) ? "main" : currentBranch;
    const switchedFromSessionBranch = targetBranch !== currentBranch;
    if (switchedFromSessionBranch) {
      await exec("git", ["checkout", targetBranch], { cwd });
    }

    // Attempt rebase with retry logic
    let lastRebaseError: string | undefined;
    let rebaseSucceeded = false;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await exec("git", ["pull", "--rebase", "--autostash", "origin", targetBranch], { cwd });
        rebaseSucceeded = true;
        break;
      } catch (rebaseErr) {
        lastRebaseError = rebaseErr instanceof Error ? rebaseErr.message : String(rebaseErr);

        // Abort rebase if in progress
        try {
          await exec("git", ["rebase", "--abort"], { cwd });
        } catch {
          // rebase --abort may fail if we weren't actually mid-rebase
        }

        // Exponential backoff with jitter to desynchronize concurrent retries (ADR 0056)
        if (attempt < maxRetries) {
          const backoffMs = retryDelayMs * Math.pow(2, attempt - 1);
          const jitterMs = Math.floor(Math.random() * Math.min(retryDelayMs, 1000));
          await sleep(backoffMs + jitterMs);
        }
      }
    }

    // If all rebase attempts failed, fall back to branch push
    if (!rebaseSucceeded) {

      const fallbackBranch = `session-${sessionId}`;
      let fallbackPushed = false;
      let fallbackError: string | undefined;
      try {
        await exec("git", ["checkout", "-b", fallbackBranch], { cwd });
        await exec("git", ["push", "-u", "origin", fallbackBranch], { cwd });
        fallbackPushed = true;
      } catch (branchErr) {
        fallbackError = branchErr instanceof Error ? branchErr.message : String(branchErr);
      } finally {
        // Return to target branch (main if we switched from session branch, otherwise original)
        // Staying on a session branch permanently derails subsequent sessions.
        try {
          await exec("git", ["checkout", targetBranch], { cwd });
        } catch {
          // If even this fails, we're in a bad state but can't do much about it
        }
        // Clean up the local fallback branch to prevent accumulation
        try {
          await exec("git", ["branch", "-D", fallbackBranch], { cwd });
        } catch {
          // non-critical — scheduled cleanup will handle it
        }
      }

      if (!fallbackPushed) {
        return {
          status: "error",
          error: `Branch fallback failed: ${fallbackError}`,
        };
      }

      return {
        status: "branch-fallback",
        branch: fallbackBranch,
        error: lastRebaseError,
      };
    }

    // Rebase succeeded — push to origin
    try {
      await exec("git", ["push", "origin", targetBranch], { cwd });
    } catch (pushErr) {
      return {
        status: "error",
        error: `Push after rebase failed: ${pushErr instanceof Error ? pushErr.message : String(pushErr)}`,
      };
    }

    return { status: "pushed" };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface BackgroundPushResult {
  status: "pushed" | "nothing-to-push" | "failed";
  unpushedCount: number;
  error?: string;
}

/**
 * Background push retry: attempt to push accumulated local commits without
 * branch fallback. Unlike rebaseAndPush(), this function simply retries the
 * rebase+push and returns "failed" if it doesn't work — the caller will
 * retry on the next cycle. This prevents cascade push failures where one
 * failed push causes all subsequent session pushes to fail because origin
 * never advances. See architecture/concurrency-safety.md "Known issue."
 */
export async function backgroundPushRetry(cwd: string): Promise<BackgroundPushResult> {
  try {
    const unpushed = await countUnpushedCommits(cwd);
    if (unpushed === 0) {
      return { status: "nothing-to-push", unpushedCount: 0 };
    }

    const { stdout: branchOut } = await exec(
      "git", ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd },
    );
    const currentBranch = branchOut.trim();

    // Same session-branch entrapment prevention as rebaseAndPush
    const targetBranch = isSessionBranch(currentBranch) ? "main" : currentBranch;
    if (targetBranch !== currentBranch) {
      await exec("git", ["checkout", targetBranch], { cwd });
    }

    try {
      await exec("git", ["pull", "--rebase", "--autostash", "origin", targetBranch], { cwd });
    } catch (rebaseErr) {
      try { await exec("git", ["rebase", "--abort"], { cwd }); } catch { /* ignored */ }
      return {
        status: "failed",
        unpushedCount: unpushed,
        error: `Rebase failed: ${rebaseErr instanceof Error ? rebaseErr.message : String(rebaseErr)}`,
      };
    }

    try {
      await exec("git", ["push", "origin", targetBranch], { cwd });
    } catch (pushErr) {
      return {
        status: "failed",
        unpushedCount: unpushed,
        error: `Push failed: ${pushErr instanceof Error ? pushErr.message : String(pushErr)}`,
      };
    }

    return { status: "pushed", unpushedCount: unpushed };
  } catch (err) {
    return {
      status: "failed",
      unpushedCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Enqueue a push operation via the push queue API and poll for completion.
 *
 * Strategy:
 * 1. POST to /api/push/enqueue with sessionId and optional priority
 * 2. Poll GET /api/push/status/:sessionId until complete or timeout
 * 3. On any API failure or timeout, fall back to direct rebaseAndPush()
 *
 * This allows coordinated push queuing across concurrent sessions.
 */
export async function enqueuePushAndWait(
  cwd: string,
  sessionId: string,
  options?: EnqueuePushOptions,
): Promise<EnqueuePushResult> {
  const apiUrl = options?.apiUrl ?? "http://localhost:8420";
  const pollIntervalMs = options?.pollIntervalMs ?? 1000;
  const timeoutMs = options?.timeoutMs ?? 120000;

  async function enqueue(): Promise<EnqueueResponse | null> {
    try {
      const res = await fetch(`${apiUrl}/api/push/enqueue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          cwd,
          priority: options?.priority ?? "fleet",
        }),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function pollStatus(): Promise<StatusResponse | null> {
    try {
      const res = await fetch(`${apiUrl}/api/push/status/${sessionId}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  const enqueueResult = await enqueue();
  if (!enqueueResult) {
    const result = await rebaseAndPush(cwd, sessionId, options);
    return { ...result, pushQueueResult: "direct-push" };
  }

  let consecutiveFailures = 0;
  const maxConsecutiveFailures = 3;
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const status = await pollStatus();
    if (!status) {
      consecutiveFailures++;
      if (consecutiveFailures >= maxConsecutiveFailures) {
        const result = await rebaseAndPush(cwd, sessionId, options);
        return { ...result, pushQueueResult: "direct-push" };
      }
      await sleep(pollIntervalMs);
      continue;
    }
    consecutiveFailures = 0;

    if (status.status === "completed" && status.result) {
      const result = status.result;
      return {
        ...result,
        pushQueueResult:
          result.status === "nothing-to-push" ? "no-push-needed" :
          result.status === "pushed" ? "queued-success" :
          result.status === "branch-fallback" ? "queued-rebase-failed" :
          "queued-rebase-failed",
      };
    }

    if (status.status === "failed") {
      return {
        status: "error",
        error: status.error ?? "Push queue operation failed",
        pushQueueResult: "queued-rebase-failed",
      };
    }

    await sleep(pollIntervalMs);
  }

  const result = await rebaseAndPush(cwd, sessionId, options);
  return { ...result, pushQueueResult: "direct-push" };
}
