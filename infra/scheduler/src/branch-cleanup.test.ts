import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BranchInfo, CleanupResult } from "./branch-cleanup.js";

const mockExecFile = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

vi.mock("node:util", () => ({
  promisify: (fn: unknown) => fn,
}));

describe("branch-cleanup", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("listSessionBranches", () => {
    it("returns branches matching session-* pattern (work-session)", async () => {
      const { listSessionBranches } = await import("./branch-cleanup.js");
      
      mockExecFile.mockResolvedValueOnce({
        stdout: `
  origin/HEAD -> origin/main
  origin/main
  origin/session-work-session-mm1h7qpl
  origin/session-work-session-mm1iabhf
  origin/feature-xyz
  origin/session-work-session-mm1jcwd5
`.trim(),
      });

      mockExecFile.mockResolvedValueOnce({
        stdout: `
origin/session-work-session-mm1h7qpl
origin/session-work-session-mm1iabhf
origin/feature-xyz
`.trim(),
      });

      const result = await listSessionBranches("/repo");

      expect(result).toHaveLength(3);
      expect(result[0]!.name).toBe("session-work-session-mm1h7qpl");
      expect(result[1]!.name).toBe("session-work-session-mm1iabhf");
      expect(result[2]!.name).toBe("session-work-session-mm1jcwd5");
    });

    it("returns branches matching session-* pattern (fleet-worker)", async () => {
      const { listSessionBranches } = await import("./branch-cleanup.js");
      
      mockExecFile.mockResolvedValueOnce({
        stdout: `
  origin/HEAD -> origin/main
  origin/main
  origin/session-fleet-worker-mmabfqiy71ee
  origin/session-fleet-worker-mmabebx8a299
  origin/feature-xyz
`.trim(),
      });

      mockExecFile.mockResolvedValueOnce({
        stdout: `origin/session-fleet-worker-mmabfqiy71ee`,
      });

      const result = await listSessionBranches("/repo");

      expect(result).toHaveLength(2);
      expect(result[0]!.name).toBe("session-fleet-worker-mmabfqiy71ee");
      expect(result[1]!.name).toBe("session-fleet-worker-mmabebx8a299");
    });

    it("returns branches matching session-* pattern (deep-work)", async () => {
      const { listSessionBranches } = await import("./branch-cleanup.js");
      
      mockExecFile.mockResolvedValueOnce({
        stdout: `
  origin/HEAD -> origin/main
  origin/main
  origin/session-deep-work-mmabc123def
  origin/session-deep-work-mmdef456ghi
  origin/feature-xyz
`.trim(),
      });

      mockExecFile.mockResolvedValueOnce({ stdout: "" });

      const result = await listSessionBranches("/repo");

      expect(result).toHaveLength(2);
      expect(result[0]!.name).toBe("session-deep-work-mmabc123def");
      expect(result[1]!.name).toBe("session-deep-work-mmdef456ghi");
    });

    it("returns branches matching session-* pattern (chat)", async () => {
      const { listSessionBranches } = await import("./branch-cleanup.js");
      
      mockExecFile.mockResolvedValueOnce({
        stdout: `
  origin/HEAD -> origin/main
  origin/main
  origin/session-chat-mmxyz789abc
  origin/feature-xyz
`.trim(),
      });

      mockExecFile.mockResolvedValueOnce({ stdout: "" });

      const result = await listSessionBranches("/repo");

      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("session-chat-mmxyz789abc");
    });

    it("returns empty array when no matching branches exist", async () => {
      const { listSessionBranches } = await import("./branch-cleanup.js");

      mockExecFile.mockResolvedValueOnce({
        stdout: "  origin/main\n  origin/feature-xyz",
      });
      mockExecFile.mockResolvedValueOnce({ stdout: "" });

      const result = await listSessionBranches("/repo");

      expect(result).toHaveLength(0);
    });
  });

  describe("isBranchMerged", () => {
    it("returns true when branch is merged to main", async () => {
      const { isBranchMerged } = await import("./branch-cleanup.js");

      mockExecFile.mockResolvedValueOnce({
        stdout: "origin/session-work-session-abc",
      });

      const result = await isBranchMerged("/repo", "session-work-session-abc");

      expect(result).toBe(true);
      expect(mockExecFile).toHaveBeenCalledWith(
        "git",
        ["branch", "-r", "--merged", "main"],
        { cwd: "/repo" },
      );
    });

    it("returns false when branch is not merged to main", async () => {
      const { isBranchMerged } = await import("./branch-cleanup.js");

      mockExecFile.mockResolvedValueOnce({ stdout: "" });

      const result = await isBranchMerged("/repo", "session-work-session-xyz");

      expect(result).toBe(false);
    });
  });

  describe("deleteRemoteBranch", () => {
    it("deletes branch from remote", async () => {
      const { deleteRemoteBranch } = await import("./branch-cleanup.js");

      mockExecFile.mockResolvedValueOnce({ stdout: "", stderr: "" });

      await deleteRemoteBranch("/repo", "session-work-session-abc");

      expect(mockExecFile).toHaveBeenCalledWith(
        "git",
        ["push", "origin", "--delete", "session-work-session-abc"],
        { cwd: "/repo" },
      );
    });

    it("throws error when delete fails", async () => {
      const { deleteRemoteBranch } = await import("./branch-cleanup.js");

      mockExecFile.mockRejectedValueOnce(new Error("remote ref does not exist"));

      await expect(
        deleteRemoteBranch("/repo", "session-work-session-xyz"),
      ).rejects.toThrow("remote ref does not exist");
    });
  });

  describe("cleanupLocalBranches", () => {
    it("deletes merged local session branches", async () => {
      const { cleanupLocalBranches } = await import("./branch-cleanup.js");

      mockExecFile.mockResolvedValueOnce({
        stdout: "  session-fleet-worker-abc\n  session-work-session-def\n  feature-xyz\n* main\n",
      });
      mockExecFile.mockResolvedValue({ stdout: "", stderr: "" });

      const count = await cleanupLocalBranches("/repo", false);

      expect(count).toBe(2);
    });

    it("skips deletion in dry-run mode", async () => {
      const { cleanupLocalBranches } = await import("./branch-cleanup.js");

      mockExecFile.mockResolvedValueOnce({
        stdout: "  session-fleet-worker-abc\n* main\n",
      });

      const count = await cleanupLocalBranches("/repo", true);

      expect(count).toBe(1);
      expect(mockExecFile).toHaveBeenCalledTimes(1);
    });

    it("returns 0 when no session branches exist", async () => {
      const { cleanupLocalBranches } = await import("./branch-cleanup.js");

      mockExecFile.mockResolvedValueOnce({ stdout: "* main\n  feature-xyz\n" });

      const count = await cleanupLocalBranches("/repo", false);

      expect(count).toBe(0);
    });
  });

  describe("runBranchCleanup", () => {
    it("deletes merged branches regardless of age", async () => {
      const { runBranchCleanup } = await import("./branch-cleanup.js");

      mockExecFile
        // cleanupLocalBranches: git branch --merged main
        .mockResolvedValueOnce({ stdout: "* main\n" })
        // listSessionBranches: git branch -r
        .mockResolvedValueOnce({
          stdout: `
  origin/session-work-session-old
  origin/session-work-session-new
`.trim(),
        })
        // listSessionBranches: git branch -r --merged main
        .mockResolvedValueOnce({ stdout: "" })
        // isBranchMerged for old
        .mockResolvedValueOnce({
          stdout: "origin/session-work-session-old",
        })
        // deleteRemoteBranch for old
        .mockResolvedValueOnce({ stdout: "", stderr: "" })
        // isBranchMerged for new
        .mockResolvedValueOnce({ stdout: "" })
        // getBranchLastCommitDate for new (recent)
        .mockResolvedValueOnce({ stdout: new Date().toISOString() });

      const result = await runBranchCleanup("/repo", { keepDays: 7, dryRun: false });

      expect(result.deleted).toHaveLength(1);
      expect(result.deleted[0]!.branch).toBe("session-work-session-old");
      expect(result.deleted[0]!.reason).toBe("merged");
      expect(result.kept).toHaveLength(1);
      expect(result.kept[0]!.branch).toBe("session-work-session-new");
      expect(result.kept[0]!.reason).toBe("not-merged-and-within-keep-window");
    });

    it("deletes old unmerged branches beyond keepDays", async () => {
      const { runBranchCleanup } = await import("./branch-cleanup.js");

      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

      mockExecFile
        // cleanupLocalBranches: git branch --merged main
        .mockResolvedValueOnce({ stdout: "* main\n" })
        // listSessionBranches: git branch -r
        .mockResolvedValueOnce({
          stdout: "  origin/session-work-session-old",
        })
        // listSessionBranches: git branch -r --merged main
        .mockResolvedValueOnce({ stdout: "" })
        // isBranchMerged for old
        .mockResolvedValueOnce({ stdout: "" })
        // getBranchLastCommitDate for old
        .mockResolvedValueOnce({
          stdout: `${oldDate.toISOString()}\n`,
        })
        // deleteRemoteBranch for old
        .mockResolvedValueOnce({ stdout: "", stderr: "" });

      const result = await runBranchCleanup("/repo", { keepDays: 7, dryRun: false });

      expect(result.deleted).toHaveLength(1);
      expect(result.deleted[0]!.reason).toBe("old-unmerged");
    });

    it("does not delete in dry-run mode", async () => {
      const { runBranchCleanup } = await import("./branch-cleanup.js");

      mockExecFile
        // cleanupLocalBranches: git branch --merged main
        .mockResolvedValueOnce({ stdout: "* main\n" })
        // listSessionBranches: git branch -r
        .mockResolvedValueOnce({
          stdout: "  origin/session-work-session-merged",
        })
        // listSessionBranches: git branch -r --merged main
        .mockResolvedValueOnce({ stdout: "" })
        // isBranchMerged for merged
        .mockResolvedValueOnce({
          stdout: "origin/session-work-session-merged",
        });

      const result = await runBranchCleanup("/repo", { keepDays: 7, dryRun: true });

      expect(result.deleted).toHaveLength(1);
      expect(result.deleted[0]!.branch).toBe("session-work-session-merged");
      expect(result.deleted[0]!.reason).toBe("merged");
      expect(mockExecFile).not.toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["push", "origin", "--delete"]),
        expect.anything(),
      );
    });

    it("includes localDeleted count in result", async () => {
      const { runBranchCleanup } = await import("./branch-cleanup.js");

      mockExecFile
        // cleanupLocalBranches: git branch --merged main
        .mockResolvedValueOnce({ stdout: "  session-fleet-worker-abc\n* main\n" })
        // cleanupLocalBranches: git branch -d
        .mockResolvedValueOnce({ stdout: "", stderr: "" })
        // listSessionBranches: git branch -r
        .mockResolvedValueOnce({ stdout: "" })
        // listSessionBranches: git branch -r --merged main
        .mockResolvedValueOnce({ stdout: "" });

      const result = await runBranchCleanup("/repo", { keepDays: 7, dryRun: false });

      expect(result.localDeleted).toBe(1);
      expect(result.deleted).toHaveLength(0);
    });
  });
});
