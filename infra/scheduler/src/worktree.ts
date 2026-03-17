/** WorktreeManager: git worktree lifecycle for worker agent isolation. */

import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { autoCommitOrphanedFiles } from "./auto-commit.js";

const defaultExec = promisify(execFile);

// ── Types ────────────────────────────────────────────────────────────────────

/** Function signature for executing shell commands (for dependency injection). */
export type ExecFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>;

export interface WorktreeConfig {
  /** Absolute path to the main repository. */
  repoDir: string;
  /** Maximum concurrent worktrees. Default: 4. */
  maxWorktrees: number;
  /** Custom base directory for worktrees. Defaults to `{repoDir}/.worktrees`. */
  worktreeDir?: string;
  /** Override exec function (for testing). */
  exec?: ExecFn;
  /** Override autoCommit function (for testing). */
  autoCommit?: (cwd: string, activeExperimentDirs: string[]) => Promise<unknown>;
}

export interface WorktreeInfo {
  taskId: string;
  branch: string;
  path: string;
  allocatedAt: number;
  sessionId?: string;
}

export type WorktreeAllocResult =
  | { ok: true; info: WorktreeInfo }
  | { ok: false; reason: "at-capacity" | "already-exists" | "git-error"; error?: string };

export type WorktreeReleaseResult =
  | { ok: true; merged: boolean; fallbackBranch?: string }
  | { ok: false; reason: "not-found" | "cleanup-error"; error?: string };

// ── Porcelain parser ─────────────────────────────────────────────────────────

export interface WorktreeEntry {
  path: string;
  head: string;
  branch: string | null;
}

/**
 * Parse `git worktree list --porcelain` output into structured entries.
 * Each entry is separated by a blank line. Lines are:
 *   worktree <path>
 *   HEAD <hash>
 *   branch <ref>   OR   detached
 */
export function parseWorktreeList(output: string): WorktreeEntry[] {
  if (!output.trim()) return [];

  const entries: WorktreeEntry[] = [];
  const blocks = output.trim().split("\n\n");

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    let entryPath = "";
    let head = "";
    let branch: string | null = null;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        entryPath = line.slice("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        branch = line.slice("branch ".length);
      }
      // "detached" line → branch stays null
    }

    if (entryPath && head) {
      entries.push({ path: entryPath, head, branch });
    }
  }

  return entries;
}

// ── WorktreeManager ──────────────────────────────────────────────────────────

export class WorktreeManager {
  private readonly config: WorktreeConfig;
  private readonly worktreeBaseDir: string;
  private readonly allocations = new Map<string, WorktreeInfo>();
  private readonly exec: ExecFn;
  private readonly autoCommit: (cwd: string, activeExperimentDirs: string[]) => Promise<unknown>;

  /** Promise chain for serializing allocate/release calls. */
  private queue: Promise<void> = Promise.resolve();

  constructor(config: WorktreeConfig) {
    this.config = config;
    this.worktreeBaseDir = config.worktreeDir ?? path.join(config.repoDir, ".worktrees");
    this.exec = config.exec ?? defaultExec;
    this.autoCommit = config.autoCommit ?? autoCommitOrphanedFiles;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Allocate a worktree for a task. Creates branch `worker/{taskId}` and
   * worktree at `.worktrees/{taskId}`.
   *
   * Concurrent calls are serialized via internal promise chain.
   */
  allocate(taskId: string, sessionId?: string): Promise<WorktreeAllocResult> {
    return this.enqueue(() => this.doAllocate(taskId, sessionId));
  }

  /**
   * Release a worktree: auto-commit orphaned files, merge back to main
   * (or create fallback branch on conflict), then clean up.
   */
  release(taskId: string): Promise<WorktreeReleaseResult> {
    return this.enqueue(() => this.doRelease(taskId));
  }

  /** List currently allocated worktrees. */
  list(): WorktreeInfo[] {
    return [...this.allocations.values()];
  }

  /** Get current and max capacity. */
  getCapacity(): { current: number; max: number } {
    return { current: this.allocations.size, max: this.config.maxWorktrees };
  }

  /**
   * Recover stale worktrees from crashed sessions.
   * Scans `git worktree list --porcelain`, auto-commits orphaned files,
   * removes worktrees, and deletes branches.
   *
   * Should be called on startup.
   */
  async recover(): Promise<number> {
    try {
      const { stdout } = await this.exec("git", ["worktree", "list", "--porcelain"], {
        cwd: this.config.repoDir,
      });

      const entries = parseWorktreeList(stdout);
      let recovered = 0;

      for (const entry of entries) {
        // Only recover worker/* branches in .worktrees/ directory
        if (!entry.branch || !entry.branch.includes("worker/")) continue;
        if (!entry.path.includes(".worktrees/")) continue;

        const branchName = entry.branch.replace("refs/heads/", "");
        const taskId = branchName.replace("worker/", "");

        console.log(`[worktree] Recovering stale worktree: ${taskId}`);

        // Auto-commit orphaned files
        try {
          await this.autoCommit(entry.path, []);
        } catch {
          // Best-effort
        }

        // Remove worktree and delete branch
        try {
          await this.exec("git", ["worktree", "remove", "--force", entry.path], {
            cwd: this.config.repoDir,
          });
        } catch {
          console.log(`[worktree] Warning: failed to remove worktree ${entry.path}`);
        }

        try {
          await this.exec("git", ["branch", "-D", branchName], {
            cwd: this.config.repoDir,
          });
        } catch {
          // Branch may already be gone
        }

        recovered++;
      }

      // Safety net: prune any lingering worktree metadata
      try {
        await this.exec("git", ["worktree", "prune"], { cwd: this.config.repoDir });
      } catch {
        // Non-critical
      }

      if (recovered > 0) {
        console.log(`[worktree] Recovered ${recovered} stale worktree(s)`);
      }

      return recovered;
    } catch (err) {
      console.error(
        `[worktree] Recovery error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  /** Enqueue an operation on the serialization chain. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue = this.queue
        .then(() => fn())
        .then(resolve, reject);
    });
  }

  private async doAllocate(
    taskId: string,
    sessionId?: string,
  ): Promise<WorktreeAllocResult> {
    // Check if already allocated
    if (this.allocations.has(taskId)) {
      return { ok: false, reason: "already-exists" };
    }

    // Check capacity
    if (this.allocations.size >= this.config.maxWorktrees) {
      return { ok: false, reason: "at-capacity" };
    }

    const branchName = `worker/${taskId}`;
    const worktreePath = path.join(this.worktreeBaseDir, taskId);

    try {
      // Check if branch already exists (stale from previous crash)
      try {
        await this.exec("git", ["rev-parse", "--verify", branchName], {
          cwd: this.config.repoDir,
        });
        // Branch exists but no active allocation — delete stale branch
        console.log(`[worktree] Cleaning up stale branch: ${branchName}`);
        await this.exec("git", ["branch", "-D", branchName], {
          cwd: this.config.repoDir,
        });
      } catch {
        // Branch doesn't exist — good, proceed
      }

      // Ensure worktree base directory exists
      try {
        await mkdir(this.worktreeBaseDir, { recursive: true });
      } catch {
        // May already exist
      }

      // Create worktree with new branch based on main
      await this.exec(
        "git",
        ["worktree", "add", "-b", branchName, worktreePath, "main"],
        { cwd: this.config.repoDir },
      );

      const info: WorktreeInfo = {
        taskId,
        branch: branchName,
        path: worktreePath,
        allocatedAt: Date.now(),
        sessionId,
      };

      this.allocations.set(taskId, info);
      console.log(`[worktree] Allocated: ${taskId} at ${worktreePath}`);

      return { ok: true, info };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[worktree] Allocate failed for ${taskId}: ${error}`);
      return { ok: false, reason: "git-error", error };
    }
  }

  private async doRelease(taskId: string): Promise<WorktreeReleaseResult> {
    const info = this.allocations.get(taskId);
    if (!info) {
      return { ok: false, reason: "not-found" };
    }

    try {
      // Auto-commit any uncommitted changes in worktree
      try {
        await this.autoCommit(info.path, []);
      } catch {
        // Best-effort
      }

      // Check if worker branch has commits ahead of main
      const { stdout: countOut } = await this.exec(
        "git",
        ["rev-list", "--count", `main..${info.branch}`],
        { cwd: this.config.repoDir },
      );
      const commitCount = parseInt(countOut.trim(), 10) || 0;

      let merged = false;
      let fallbackBranch: string | undefined;

      if (commitCount > 0) {
        // Attempt to rebase and merge
        try {
          // Fetch latest main
          await this.exec("git", ["fetch", "origin", "main"], {
            cwd: this.config.repoDir,
          });

          // Rebase worker branch onto origin/main
          await this.exec("git", ["rebase", "origin/main"], {
            cwd: info.path,
          });

          // Checkout main in the main repo and merge ff-only
          await this.exec("git", ["checkout", "main"], {
            cwd: this.config.repoDir,
          });
          await this.exec("git", ["merge", "--ff-only", info.branch], {
            cwd: this.config.repoDir,
          });

          merged = true;
        } catch {
          // Rebase conflict — abort and create fallback branch
          try {
            await this.exec("git", ["rebase", "--abort"], { cwd: info.path });
          } catch {
            // May not be mid-rebase
          }

          fallbackBranch = `session-${taskId}`;
          try {
            await this.exec(
              "git",
              ["branch", fallbackBranch, info.branch],
              { cwd: this.config.repoDir },
            );
          } catch {
            // Best-effort fallback branch creation
          }

          console.log(
            `[worktree] Rebase conflict for ${taskId}, created fallback: ${fallbackBranch}`,
          );
        }
      }

      // Always clean up: remove worktree and delete worker branch
      try {
        await this.exec("git", ["worktree", "remove", "--force", info.path], {
          cwd: this.config.repoDir,
        });
      } catch {
        console.log(`[worktree] Warning: failed to remove worktree ${info.path}`);
      }

      try {
        await this.exec("git", ["branch", "-D", info.branch], {
          cwd: this.config.repoDir,
        });
      } catch {
        // Branch may already be gone
      }

      this.allocations.delete(taskId);
      console.log(`[worktree] Released: ${taskId} (merged: ${merged})`);

      return { ok: true, merged, fallbackBranch };
    } catch (err) {
      // Even on error, try to clean up
      this.allocations.delete(taskId);
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[worktree] Release error for ${taskId}: ${error}`);
      return { ok: false, reason: "cleanup-error", error };
    }
  }
}
