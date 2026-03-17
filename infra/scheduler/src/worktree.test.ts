/** Tests for WorktreeManager: git worktree lifecycle for worker agent isolation. */

import { describe, it, expect, vi, beforeEach } from "vitest";

// We'll mock child_process and fs before importing the module
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  access: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock("./auto-commit.js", () => ({
  autoCommitOrphanedFiles: vi.fn().mockResolvedValue(null),
}));

import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { autoCommitOrphanedFiles } from "./auto-commit.js";
import {
  WorktreeManager,
  parseWorktreeList,
  type WorktreeConfig,
  type WorktreeInfo,
  type WorktreeAllocResult,
  type WorktreeReleaseResult,
} from "./worktree.js";

const mockExecFile = vi.mocked(execFile);
const mockAccess = vi.mocked(access);
const mockMkdir = vi.mocked(mkdir);
const mockAutoCommit = vi.mocked(autoCommitOrphanedFiles);

/** Helper: make execFile resolve with stdout/stderr. */
function mockExec(stdout = "", stderr = ""): void {
  mockExecFile.mockImplementation(
    ((_cmd: unknown, _args: unknown, _opts: unknown, cb?: Function) => {
      if (cb) {
        cb(null, stdout, stderr);
        return undefined as any;
      }
      // promisify path
      return undefined as any;
    }) as any,
  );
}

/**
 * Helper: make execFile calls resolve based on arguments.
 * Takes a map of "command arg1 arg2..." -> { stdout, stderr } or Error.
 */
function mockExecMulti(
  responses: Record<string, { stdout?: string; stderr?: string } | Error>,
  fallback: { stdout?: string; stderr?: string } = { stdout: "" },
): void {
  mockExecFile.mockImplementation(
    ((cmd: string, args: string[], _opts: unknown, cb?: Function) => {
      const key = `${cmd} ${args.join(" ")}`;
      // Find matching key (prefix match for flexibility)
      const matchKey = Object.keys(responses).find((k) => key.startsWith(k) || key.includes(k));
      const response = matchKey ? responses[matchKey] : fallback;

      if (cb) {
        if (response instanceof Error) {
          cb(response, "", "");
        } else {
          cb(null, response.stdout ?? "", response.stderr ?? "");
        }
        return undefined as any;
      }
      return undefined as any;
    }) as any,
  );
}

/**
 * Create a WorktreeManager with promisified exec mocked to handle call sequences.
 */
function createManager(config?: Partial<WorktreeConfig>): WorktreeManager {
  return new WorktreeManager({
    repoDir: "/repo",
    maxWorktrees: 4,
    ...config,
  });
}

/** Setup: make promisify(execFile) return a mock function we can control per-call. */
function setupExecQueue(responses: Array<{ stdout?: string; stderr?: string } | Error>): void {
  let callIndex = 0;
  mockExecFile.mockImplementation(
    ((_cmd: unknown, _args: unknown, _opts: unknown, cb?: Function) => {
      const resp = responses[callIndex] ?? { stdout: "" };
      callIndex++;
      if (cb) {
        if (resp instanceof Error) {
          cb(resp, "", "");
        } else {
          cb(null, resp.stdout ?? "", resp.stderr ?? "");
        }
        return undefined as any;
      }
      return undefined as any;
    }) as any,
  );
}

describe("parseWorktreeList", () => {
  it("parses empty output", () => {
    expect(parseWorktreeList("")).toEqual([]);
  });

  it("parses single worktree entry", () => {
    const output = `worktree /repo
HEAD abc1234
branch refs/heads/main

`;
    const result = parseWorktreeList(output);
    expect(result).toEqual([
      { path: "/repo", head: "abc1234", branch: "refs/heads/main" },
    ]);
  });

  it("parses multiple worktree entries", () => {
    const output = `worktree /repo
HEAD abc1234
branch refs/heads/main

worktree /repo/.worktrees/task-1
HEAD def5678
branch refs/heads/worker/task-1

worktree /repo/.worktrees/task-2
HEAD 9ab0123
branch refs/heads/worker/task-2

`;
    const result = parseWorktreeList(output);
    expect(result).toHaveLength(3);
    expect(result[1]).toEqual({
      path: "/repo/.worktrees/task-1",
      head: "def5678",
      branch: "refs/heads/worker/task-1",
    });
  });

  it("handles detached HEAD (no branch line)", () => {
    const output = `worktree /repo/.worktrees/detached
HEAD abc1234
detached

`;
    const result = parseWorktreeList(output);
    expect(result[0].branch).toBeNull();
  });
});

describe("WorktreeManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockAutoCommit.mockResolvedValue(null);
  });

  describe("allocate", () => {
    it("creates worktree and returns info on success", async () => {
      const mgr = createManager();
      // Mock sequence: git rev-parse (check branch), git worktree add
      setupExecQueue([
        new Error("branch not found"),    // git rev-parse --verify worker/task-1 → not found
        { stdout: "" },                    // git worktree add
      ]);

      const result = await mgr.allocate("task-1", "session-abc");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.info.taskId).toBe("task-1");
        expect(result.info.branch).toBe("worker/task-1");
        expect(result.info.path).toBe("/repo/.worktrees/task-1");
        expect(result.info.sessionId).toBe("session-abc");
      }
    });

    it("returns already-exists if worktree is already allocated", async () => {
      const mgr = createManager();
      setupExecQueue([
        new Error("branch not found"),
        { stdout: "" },
      ]);

      await mgr.allocate("task-1");

      const result = await mgr.allocate("task-1");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("already-exists");
      }
    });

    it("returns at-capacity when maxWorktrees reached", async () => {
      const mgr = createManager({ maxWorktrees: 1 });
      setupExecQueue([
        new Error("not found"),
        { stdout: "" },
      ]);

      await mgr.allocate("task-1");

      const result = await mgr.allocate("task-2");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("at-capacity");
      }
    });

    it("cleans up stale branch before allocating", async () => {
      const mgr = createManager();
      // Branch exists but no worktree for it in allocations
      setupExecQueue([
        { stdout: "abc123\n" },   // git rev-parse --verify → branch exists
        { stdout: "" },            // git branch -D (delete stale)
        { stdout: "" },            // git worktree add
      ]);

      const result = await mgr.allocate("task-1");
      expect(result.ok).toBe(true);
    });

    it("returns git-error on worktree add failure", async () => {
      const mgr = createManager();
      setupExecQueue([
        new Error("not found"),                    // branch check
        new Error("fatal: worktree add failed"),   // worktree add fails
      ]);

      const result = await mgr.allocate("task-1");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("git-error");
        expect(result.error).toBeDefined();
      }
    });

    it("serializes concurrent allocate calls", async () => {
      const mgr = createManager({ maxWorktrees: 2 });
      let callCount = 0;
      mockExecFile.mockImplementation(
        ((_cmd: unknown, _args: unknown, _opts: unknown, cb?: Function) => {
          callCount++;
          if (cb) {
            if (callCount % 2 === 1) {
              // Branch check: not found
              cb(new Error("not found"), "", "");
            } else {
              // Worktree add: success
              cb(null, "", "");
            }
            return undefined as any;
          }
          return undefined as any;
        }) as any,
      );

      const [r1, r2] = await Promise.all([
        mgr.allocate("task-1"),
        mgr.allocate("task-2"),
      ]);

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      expect(mgr.getCapacity().current).toBe(2);
    });

    it("concurrent allocates respect capacity limit", async () => {
      const mgr = createManager({ maxWorktrees: 1 });
      let callCount = 0;
      mockExecFile.mockImplementation(
        ((_cmd: unknown, _args: unknown, _opts: unknown, cb?: Function) => {
          callCount++;
          if (cb) {
            if (callCount % 2 === 1) {
              cb(new Error("not found"), "", "");
            } else {
              cb(null, "", "");
            }
            return undefined as any;
          }
          return undefined as any;
        }) as any,
      );

      const [r1, r2] = await Promise.all([
        mgr.allocate("task-1"),
        mgr.allocate("task-2"),
      ]);

      const oks = [r1, r2].filter((r) => r.ok);
      const fails = [r1, r2].filter((r) => !r.ok);
      expect(oks).toHaveLength(1);
      expect(fails).toHaveLength(1);
      if (!fails[0].ok) {
        expect(fails[0].reason).toBe("at-capacity");
      }
    });
  });

  describe("release", () => {
    it("returns not-found for unknown taskId", async () => {
      const mgr = createManager();
      const result = await mgr.release("nonexistent");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("not-found");
      }
    });

    it("releases worktree with no new commits (no merge)", async () => {
      const mgr = createManager();
      // Allocate first
      setupExecQueue([
        new Error("not found"),   // branch check
        { stdout: "" },            // worktree add
      ]);
      await mgr.allocate("task-1");

      // Release: auto-commit, rev-list count=0, worktree remove, branch delete
      setupExecQueue([
        { stdout: "0\n" },        // git rev-list --count main..worker/task-1 → 0
        { stdout: "" },            // git worktree remove
        { stdout: "" },            // git branch -D
      ]);

      const result = await mgr.release("task-1");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.merged).toBe(false);
      }
      expect(mgr.getCapacity().current).toBe(0);
    });

    it("merges worker branch into main on release with commits", async () => {
      const mgr = createManager();
      setupExecQueue([
        new Error("not found"),
        { stdout: "" },
      ]);
      await mgr.allocate("task-1");

      // Release: rev-list=2, fetch, rebase, checkout main, merge ff-only, worktree remove, branch -D
      setupExecQueue([
        { stdout: "2\n" },        // rev-list count
        { stdout: "" },            // git fetch origin main
        { stdout: "" },            // git rebase origin/main (in worktree)
        { stdout: "" },            // git checkout main
        { stdout: "" },            // git merge --ff-only worker/task-1
        { stdout: "" },            // git worktree remove
        { stdout: "" },            // git branch -D
      ]);

      const result = await mgr.release("task-1");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.merged).toBe(true);
      }
    });

    it("falls back to session branch on rebase conflict", async () => {
      const mgr = createManager();
      setupExecQueue([
        new Error("not found"),
        { stdout: "" },
      ]);
      await mgr.allocate("task-1");

      // Release: rev-list=1, fetch, rebase FAILS, abort rebase, push fallback branch, worktree remove, branch -D
      setupExecQueue([
        { stdout: "1\n" },                        // rev-list count
        { stdout: "" },                             // git fetch
        new Error("CONFLICT"),                      // git rebase fails
        { stdout: "" },                             // git rebase --abort
        { stdout: "" },                             // git branch session-task-1
        { stdout: "" },                             // git push (not done in worktree manager but we verify fallback)
        { stdout: "" },                             // git worktree remove
        { stdout: "" },                             // git branch -D worker/task-1
      ]);

      const result = await mgr.release("task-1");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.merged).toBe(false);
        expect(result.fallbackBranch).toBe("session-task-1");
      }
    });

    it("calls autoCommitOrphanedFiles before release", async () => {
      const mgr = createManager();
      setupExecQueue([
        new Error("not found"),
        { stdout: "" },
      ]);
      await mgr.allocate("task-1");

      setupExecQueue([
        { stdout: "0\n" },
        { stdout: "" },
        { stdout: "" },
      ]);

      await mgr.release("task-1");
      expect(mockAutoCommit).toHaveBeenCalledWith(
        "/repo/.worktrees/task-1",
        [],
      );
    });
  });

  describe("list", () => {
    it("returns empty array initially", () => {
      const mgr = createManager();
      expect(mgr.list()).toEqual([]);
    });

    it("returns allocated worktrees", async () => {
      const mgr = createManager();
      setupExecQueue([
        new Error("not found"),
        { stdout: "" },
      ]);
      await mgr.allocate("task-1", "session-x");

      const items = mgr.list();
      expect(items).toHaveLength(1);
      expect(items[0].taskId).toBe("task-1");
      expect(items[0].sessionId).toBe("session-x");
    });
  });

  describe("getCapacity", () => {
    it("returns current and max", async () => {
      const mgr = createManager({ maxWorktrees: 3 });
      expect(mgr.getCapacity()).toEqual({ current: 0, max: 3 });

      setupExecQueue([
        new Error("not found"),
        { stdout: "" },
      ]);
      await mgr.allocate("task-1");
      expect(mgr.getCapacity()).toEqual({ current: 1, max: 3 });
    });
  });

  describe("recover", () => {
    it("recovers stale worktrees from git worktree list", async () => {
      const mgr = createManager();
      const porcelainOutput = `worktree /repo
HEAD abc1234
branch refs/heads/main

worktree /repo/.worktrees/stale-task
HEAD def5678
branch refs/heads/worker/stale-task

`;
      setupExecQueue([
        { stdout: porcelainOutput },   // git worktree list --porcelain
        // For stale-task recovery:
        { stdout: "" },                 // git worktree remove --force
        { stdout: "" },                 // git branch -D
        { stdout: "" },                 // git worktree prune
      ]);

      const count = await mgr.recover();
      expect(count).toBe(1);
      expect(mockAutoCommit).toHaveBeenCalled();
    });

    it("returns 0 when no stale worktrees exist", async () => {
      const mgr = createManager();
      const porcelainOutput = `worktree /repo
HEAD abc1234
branch refs/heads/main

`;
      setupExecQueue([
        { stdout: porcelainOutput },
        { stdout: "" },    // git worktree prune
      ]);

      const count = await mgr.recover();
      expect(count).toBe(0);
    });

    it("recovers multiple stale worktrees", async () => {
      const mgr = createManager();
      const porcelainOutput = `worktree /repo
HEAD abc1234
branch refs/heads/main

worktree /repo/.worktrees/task-a
HEAD 111111
branch refs/heads/worker/task-a

worktree /repo/.worktrees/task-b
HEAD 222222
branch refs/heads/worker/task-b

`;
      setupExecQueue([
        { stdout: porcelainOutput },
        // task-a recovery
        { stdout: "" },  // worktree remove
        { stdout: "" },  // branch -D
        // task-b recovery
        { stdout: "" },  // worktree remove
        { stdout: "" },  // branch -D
        // prune
        { stdout: "" },
      ]);

      const count = await mgr.recover();
      expect(count).toBe(2);
    });
  });
});
