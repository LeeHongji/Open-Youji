/** Tests for WorktreeManager: git worktree lifecycle for worker agent isolation. */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  WorktreeManager,
  parseWorktreeList,
  type WorktreeConfig,
  type ExecFn,
} from "./worktree.js";

// ── Test helpers ─────────────────────────────────────────────────────────────

/** Build a mock exec function from a sequence of responses. */
function mockExecSequence(
  responses: Array<{ stdout?: string; stderr?: string } | Error>,
): ExecFn {
  let callIndex = 0;
  return vi.fn(async (_cmd: string, _args: string[], _opts: { cwd: string }) => {
    const resp = responses[callIndex] ?? { stdout: "" };
    callIndex++;
    if (resp instanceof Error) throw resp;
    return { stdout: resp.stdout ?? "", stderr: resp.stderr ?? "" };
  });
}

/** Build a mock exec that dispatches based on call count per-call. */
function mockExecAlternating(
  pattern: (callIndex: number) => { stdout?: string; stderr?: string } | Error,
): ExecFn {
  let callIndex = 0;
  return vi.fn(async (_cmd: string, _args: string[], _opts: { cwd: string }) => {
    const resp = pattern(callIndex);
    callIndex++;
    if (resp instanceof Error) throw resp;
    return { stdout: resp.stdout ?? "", stderr: resp.stderr ?? "" };
  });
}

function createManager(
  overrides?: Partial<WorktreeConfig> & { execFn?: ExecFn; autoCommitFn?: () => Promise<unknown> },
): { mgr: WorktreeManager; exec: ExecFn; autoCommit: ReturnType<typeof vi.fn> } {
  const execFn = overrides?.execFn ?? mockExecSequence([]);
  const autoCommitFn = overrides?.autoCommitFn ?? vi.fn(async () => null);
  const mgr = new WorktreeManager({
    repoDir: "/repo",
    maxWorktrees: 4,
    ...overrides,
    exec: execFn,
    autoCommit: autoCommitFn as any,
  });
  return { mgr, exec: execFn, autoCommit: autoCommitFn as ReturnType<typeof vi.fn> };
}

// ── Tests ────────────────────────────────────────────────────────────────────

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
  describe("allocate", () => {
    it("creates worktree and returns info on success", async () => {
      const { mgr } = createManager({
        execFn: mockExecSequence([
          new Error("branch not found"),  // git rev-parse --verify worker/task-1
          { stdout: "" },                  // git worktree add
        ]),
      });

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
      const { mgr } = createManager({
        execFn: mockExecSequence([
          new Error("branch not found"),
          { stdout: "" },
        ]),
      });

      await mgr.allocate("task-1");

      const result = await mgr.allocate("task-1");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("already-exists");
      }
    });

    it("returns at-capacity when maxWorktrees reached", async () => {
      const { mgr } = createManager({
        maxWorktrees: 1,
        execFn: mockExecSequence([
          new Error("not found"),
          { stdout: "" },
        ]),
      });

      await mgr.allocate("task-1");

      const result = await mgr.allocate("task-2");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("at-capacity");
      }
    });

    it("cleans up stale branch before allocating", async () => {
      const execFn = mockExecSequence([
        { stdout: "abc123\n" },   // git rev-parse --verify → branch exists
        { stdout: "" },            // git branch -D (delete stale)
        { stdout: "" },            // git worktree add
      ]);
      const { mgr } = createManager({ execFn });

      const result = await mgr.allocate("task-1");
      expect(result.ok).toBe(true);
      // Verify branch -D was called
      expect(execFn).toHaveBeenCalledTimes(3);
    });

    it("returns git-error on worktree add failure", async () => {
      const { mgr } = createManager({
        execFn: mockExecSequence([
          new Error("not found"),                    // branch check
          new Error("fatal: worktree add failed"),   // worktree add fails
        ]),
      });

      const result = await mgr.allocate("task-1");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("git-error");
        expect(result.error).toBeDefined();
      }
    });

    it("serializes concurrent allocate calls", async () => {
      const execFn = mockExecAlternating((i) => {
        // Alternates: branch check (error) → worktree add (success)
        if (i % 2 === 0) return new Error("not found");
        return { stdout: "" };
      });
      const { mgr } = createManager({ maxWorktrees: 2, execFn });

      const [r1, r2] = await Promise.all([
        mgr.allocate("task-1"),
        mgr.allocate("task-2"),
      ]);

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      expect(mgr.getCapacity().current).toBe(2);
    });

    it("concurrent allocates respect capacity limit", async () => {
      const execFn = mockExecAlternating((i) => {
        if (i % 2 === 0) return new Error("not found");
        return { stdout: "" };
      });
      const { mgr } = createManager({ maxWorktrees: 1, execFn });

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
      const { mgr } = createManager();
      const result = await mgr.release("nonexistent");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("not-found");
      }
    });

    it("releases worktree with no new commits (no merge)", async () => {
      // Allocate first, then release
      let callIndex = 0;
      const execFn: ExecFn = vi.fn(async (_cmd, args) => {
        callIndex++;
        // Call 1: rev-parse (allocate) → not found
        if (callIndex === 1) throw new Error("not found");
        // Call 2: worktree add (allocate)
        if (callIndex === 2) return { stdout: "", stderr: "" };
        // Call 3: rev-list count (release) → 0
        if (callIndex === 3) return { stdout: "0\n", stderr: "" };
        // Call 4+: cleanup (worktree remove, branch -D)
        return { stdout: "", stderr: "" };
      });
      const { mgr } = createManager({ execFn });

      await mgr.allocate("task-1");

      const result = await mgr.release("task-1");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.merged).toBe(false);
      }
      expect(mgr.getCapacity().current).toBe(0);
    });

    it("merges worker branch into main on release with commits", async () => {
      let callIndex = 0;
      const execFn: ExecFn = vi.fn(async (_cmd, args) => {
        callIndex++;
        // Allocate phase
        if (callIndex === 1) throw new Error("not found");   // rev-parse
        if (callIndex === 2) return { stdout: "", stderr: "" }; // worktree add
        // Release phase
        if (callIndex === 3) return { stdout: "2\n", stderr: "" }; // rev-list count
        if (callIndex === 4) return { stdout: "", stderr: "" };    // fetch origin main
        if (callIndex === 5) return { stdout: "", stderr: "" };    // rebase
        if (callIndex === 6) return { stdout: "", stderr: "" };    // checkout main
        if (callIndex === 7) return { stdout: "", stderr: "" };    // merge --ff-only
        // Cleanup
        return { stdout: "", stderr: "" };
      });
      const { mgr } = createManager({ execFn });

      await mgr.allocate("task-1");

      const result = await mgr.release("task-1");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.merged).toBe(true);
      }
    });

    it("falls back to session branch on rebase conflict", async () => {
      let callIndex = 0;
      const execFn: ExecFn = vi.fn(async (_cmd, args) => {
        callIndex++;
        // Allocate
        if (callIndex === 1) throw new Error("not found");
        if (callIndex === 2) return { stdout: "", stderr: "" };
        // Release
        if (callIndex === 3) return { stdout: "1\n", stderr: "" };  // rev-list
        if (callIndex === 4) return { stdout: "", stderr: "" };      // fetch
        if (callIndex === 5) throw new Error("CONFLICT");            // rebase fails
        if (callIndex === 6) return { stdout: "", stderr: "" };      // rebase --abort
        if (callIndex === 7) return { stdout: "", stderr: "" };      // branch session-task-1
        // Cleanup
        return { stdout: "", stderr: "" };
      });
      const { mgr } = createManager({ execFn });

      await mgr.allocate("task-1");

      const result = await mgr.release("task-1");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.merged).toBe(false);
        expect(result.fallbackBranch).toBe("session-task-1");
      }
    });

    it("calls autoCommit before release", async () => {
      let callIndex = 0;
      const execFn: ExecFn = vi.fn(async () => {
        callIndex++;
        if (callIndex === 1) throw new Error("not found");
        if (callIndex === 2) return { stdout: "", stderr: "" };
        if (callIndex === 3) return { stdout: "0\n", stderr: "" };
        return { stdout: "", stderr: "" };
      });
      const autoCommitFn = vi.fn(async () => null);
      const { mgr } = createManager({ execFn, autoCommitFn });

      await mgr.allocate("task-1");
      await mgr.release("task-1");

      expect(autoCommitFn).toHaveBeenCalledWith(
        "/repo/.worktrees/task-1",
        [],
      );
    });
  });

  describe("list", () => {
    it("returns empty array initially", () => {
      const { mgr } = createManager();
      expect(mgr.list()).toEqual([]);
    });

    it("returns allocated worktrees", async () => {
      const { mgr } = createManager({
        execFn: mockExecSequence([
          new Error("not found"),
          { stdout: "" },
        ]),
      });
      await mgr.allocate("task-1", "session-x");

      const items = mgr.list();
      expect(items).toHaveLength(1);
      expect(items[0].taskId).toBe("task-1");
      expect(items[0].sessionId).toBe("session-x");
    });
  });

  describe("getCapacity", () => {
    it("returns current and max", async () => {
      const { mgr } = createManager({
        maxWorktrees: 3,
        execFn: mockExecSequence([
          new Error("not found"),
          { stdout: "" },
        ]),
      });
      expect(mgr.getCapacity()).toEqual({ current: 0, max: 3 });

      await mgr.allocate("task-1");
      expect(mgr.getCapacity()).toEqual({ current: 1, max: 3 });
    });
  });

  describe("recover", () => {
    it("recovers stale worktrees from git worktree list", async () => {
      const porcelainOutput = `worktree /repo
HEAD abc1234
branch refs/heads/main

worktree /repo/.worktrees/stale-task
HEAD def5678
branch refs/heads/worker/stale-task

`;
      let callIndex = 0;
      const execFn: ExecFn = vi.fn(async () => {
        callIndex++;
        if (callIndex === 1) return { stdout: porcelainOutput, stderr: "" };
        return { stdout: "", stderr: "" };
      });
      const autoCommitFn = vi.fn(async () => null);
      const { mgr } = createManager({ execFn, autoCommitFn });

      const count = await mgr.recover();
      expect(count).toBe(1);
      expect(autoCommitFn).toHaveBeenCalled();
    });

    it("returns 0 when no stale worktrees exist", async () => {
      const porcelainOutput = `worktree /repo
HEAD abc1234
branch refs/heads/main

`;
      const execFn: ExecFn = vi.fn(async () => {
        return { stdout: porcelainOutput, stderr: "" };
      });
      const { mgr } = createManager({ execFn });

      const count = await mgr.recover();
      expect(count).toBe(0);
    });

    it("recovers multiple stale worktrees", async () => {
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
      let callIndex = 0;
      const execFn: ExecFn = vi.fn(async () => {
        callIndex++;
        if (callIndex === 1) return { stdout: porcelainOutput, stderr: "" };
        return { stdout: "", stderr: "" };
      });
      const autoCommitFn = vi.fn(async () => null);
      const { mgr } = createManager({ execFn, autoCommitFn });

      const count = await mgr.recover();
      expect(count).toBe(2);
    });
  });
});
