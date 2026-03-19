/** Tests for post-session git rebase-before-push. */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("rebase-push", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper: make execFile behave like a callback-based function that promisify can wrap
  function mockExecSuccess(stdout = "") {
    return (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
      if (cb) {
        cb(null, { stdout, stderr: "" });
      }
    };
  }

  function mockExecError(message: string) {
    return (_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
      if (cb) {
        cb(new Error(message), { stdout: "", stderr: "" });
      }
    };
  }

  describe("countUnpushedCommits", () => {
    it("returns 0 when no unpushed commits", async () => {
      mockExecFile.mockImplementation(mockExecSuccess("0\n"));

      const { countUnpushedCommits } = await import("./rebase-push.js");
      const count = await countUnpushedCommits("/repo");
      expect(count).toBe(0);
    });

    it("returns count of unpushed commits", async () => {
      mockExecFile.mockImplementation(mockExecSuccess("3\n"));

      const { countUnpushedCommits } = await import("./rebase-push.js");
      const count = await countUnpushedCommits("/repo");
      expect(count).toBe(3);
    });

    it("returns 0 on error (no upstream)", async () => {
      mockExecFile.mockImplementation(mockExecError("no upstream"));

      const { countUnpushedCommits } = await import("./rebase-push.js");
      const count = await countUnpushedCommits("/repo");
      expect(count).toBe(0);
    });
  });

  describe("rebaseAndPush", () => {
    it("returns nothing-to-push when no unpushed commits", async () => {
      // rev-list returns 0
      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
          if (args.includes("--count")) {
            cb?.(null, { stdout: "0\n", stderr: "" });
          } else {
            cb?.(null, { stdout: "", stderr: "" });
          }
        },
      );

      const { rebaseAndPush } = await import("./rebase-push.js");
      const result = await rebaseAndPush("/repo", "test-123");
      expect(result.status).toBe("nothing-to-push");
    });

    it("pushes successfully after rebase", async () => {
      const calls: string[] = [];
      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
          const key = args.join(" ");
          calls.push(key);

          if (args.includes("--count")) {
            cb?.(null, { stdout: "1\n", stderr: "" });
          } else if (args.includes("--abbrev-ref")) {
            cb?.(null, { stdout: "main\n", stderr: "" });
          } else {
            cb?.(null, { stdout: "", stderr: "" });
          }
        },
      );

      const { rebaseAndPush } = await import("./rebase-push.js");
      const result = await rebaseAndPush("/repo", "test-123");
      expect(result.status).toBe("pushed");
      // Should have called pull --rebase and then push
      expect(calls).toContain("pull --rebase --autostash origin main");
      expect(calls).toContain("push origin main");
    });

    it("falls back to branch on rebase conflict", async () => {
      const calls: string[] = [];
      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
          const key = args.join(" ");
          calls.push(key);

          if (args.includes("--count")) {
            cb?.(null, { stdout: "1\n", stderr: "" });
          } else if (args.includes("--abbrev-ref")) {
            cb?.(null, { stdout: "main\n", stderr: "" });
          } else if (args[0] === "pull" && args[1] === "--rebase") {
            cb?.(new Error("CONFLICT"), { stdout: "", stderr: "" });
          } else {
            cb?.(null, { stdout: "", stderr: "" });
          }
        },
      );

      const { rebaseAndPush } = await import("./rebase-push.js");
      const result = await rebaseAndPush("/repo", "test-123", { maxRetries: 1, retryDelayMs: 0 });
      expect(result.status).toBe("branch-fallback");
      expect(result.branch).toBe("session-test-123");
      expect(calls).toContain("rebase --abort");
      expect(calls).toContain("checkout -b session-test-123");
      expect(calls).toContain("push -u origin session-test-123");
      expect(calls).toContain("checkout main");
    });

    it("returns error when push after rebase fails", async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
          if (args.includes("--count")) {
            cb?.(null, { stdout: "1\n", stderr: "" });
          } else if (args.includes("--abbrev-ref")) {
            cb?.(null, { stdout: "main\n", stderr: "" });
          } else if (args[0] === "push") {
            cb?.(new Error("push rejected"), { stdout: "", stderr: "" });
          } else {
            cb?.(null, { stdout: "", stderr: "" });
          }
        },
      );

      const { rebaseAndPush } = await import("./rebase-push.js");
      const result = await rebaseAndPush("/repo", "test-123");
      expect(result.status).toBe("error");
      expect(result.error).toContain("push rejected");
    });

    it("returns error when branch fallback fails", async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
          if (args.includes("--count")) {
            cb?.(null, { stdout: "1\n", stderr: "" });
          } else if (args.includes("--abbrev-ref")) {
            cb?.(null, { stdout: "main\n", stderr: "" });
          } else if (args[0] === "pull" && args[1] === "--rebase") {
            cb?.(new Error("CONFLICT"), { stdout: "", stderr: "" });
          } else if (args[0] === "checkout" && args[1] === "-b") {
            cb?.(new Error("branch exists"), { stdout: "", stderr: "" });
          } else {
            cb?.(null, { stdout: "", stderr: "" });
          }
        },
      );

      const { rebaseAndPush } = await import("./rebase-push.js");
      const result = await rebaseAndPush("/repo", "test-123", { maxRetries: 1, retryDelayMs: 0 });
      expect(result.status).toBe("error");
      expect(result.error).toContain("Branch fallback failed");
    });

    it("handles non-main branch names", async () => {
      const calls: string[] = [];
      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
          calls.push(args.join(" "));
          if (args.includes("--count")) {
            cb?.(null, { stdout: "2\n", stderr: "" });
          } else if (args.includes("--abbrev-ref")) {
            cb?.(null, { stdout: "feature-branch\n", stderr: "" });
          } else {
            cb?.(null, { stdout: "", stderr: "" });
          }
        },
      );

      const { rebaseAndPush } = await import("./rebase-push.js");
      const result = await rebaseAndPush("/repo", "test-123");
      expect(result.status).toBe("pushed");
      expect(calls).toContain("pull --rebase --autostash origin feature-branch");
      expect(calls).toContain("push origin feature-branch");
    });

    it("switches to main when on a session branch", async () => {
      const calls: string[] = [];
      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
          calls.push(args.join(" "));
          if (args.includes("--count")) {
            cb?.(null, { stdout: "3\n", stderr: "" });
          } else if (args.includes("--abbrev-ref")) {
            cb?.(null, { stdout: "session-fleet-worker-abc123\n", stderr: "" });
          } else {
            cb?.(null, { stdout: "", stderr: "" });
          }
        },
      );

      const { rebaseAndPush } = await import("./rebase-push.js");
      const result = await rebaseAndPush("/repo", "test-456");
      expect(result.status).toBe("pushed");
      expect(calls).toContain("checkout main");
      expect(calls).toContain("pull --rebase --autostash origin main");
      expect(calls).toContain("push origin main");
    });

    it("stays on main after branch fallback when switched from session branch", async () => {
      const calls: string[] = [];
      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
          calls.push(args.join(" "));
          if (args.includes("--count")) {
            cb?.(null, { stdout: "1\n", stderr: "" });
          } else if (args.includes("--abbrev-ref")) {
            cb?.(null, { stdout: "session-stuck-branch\n", stderr: "" });
          } else if (args[0] === "pull" && args[1] === "--rebase") {
            cb?.(new Error("CONFLICT"), { stdout: "", stderr: "" });
          } else {
            cb?.(null, { stdout: "", stderr: "" });
          }
        },
      );

      const { rebaseAndPush } = await import("./rebase-push.js");
      const result = await rebaseAndPush("/repo", "test-789", { maxRetries: 1, retryDelayMs: 0 });
      expect(result.status).toBe("branch-fallback");
      expect(calls).toContain("checkout main");
      expect(calls).toContain("rebase --abort");
      expect(calls).toContain("checkout -b session-test-789");
      // After fallback, should return to main (not the session branch)
      expect(calls).toContain("checkout main");
    });

    it("retries rebase on transient failure", async () => {
      const calls: string[] = [];
      let rebaseAttempts = 0;

      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
          const key = args.join(" ");
          calls.push(key);

          if (args.includes("--count")) {
            cb?.(null, { stdout: "1\n", stderr: "" });
          } else if (args.includes("--abbrev-ref")) {
            cb?.(null, { stdout: "main\n", stderr: "" });
          } else if (args[0] === "pull" && args[1] === "--rebase") {
            rebaseAttempts++;
            if (rebaseAttempts === 1) {
              cb?.(new Error("CONFLICT (transient)"), { stdout: "", stderr: "" });
            } else {
              cb?.(null, { stdout: "", stderr: "" });
            }
          } else {
            cb?.(null, { stdout: "", stderr: "" });
          }
        },
      );

      const { rebaseAndPush } = await import("./rebase-push.js");
      const result = await rebaseAndPush("/repo", "test-123", { maxRetries: 3, retryDelayMs: 0 });
      expect(result.status).toBe("pushed");
      expect(rebaseAttempts).toBe(2);
      expect(calls).toContain("rebase --abort");
    });

    it("retries up to maxRetries before fallback", async () => {
      const calls: string[] = [];
      let rebaseAttempts = 0;

      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
          const key = args.join(" ");
          calls.push(key);

          if (args.includes("--count")) {
            cb?.(null, { stdout: "1\n", stderr: "" });
          } else if (args.includes("--abbrev-ref")) {
            cb?.(null, { stdout: "main\n", stderr: "" });
          } else if (args[0] === "pull" && args[1] === "--rebase") {
            rebaseAttempts++;
            cb?.(new Error("CONFLICT"), { stdout: "", stderr: "" });
          } else {
            cb?.(null, { stdout: "", stderr: "" });
          }
        },
      );

      const { rebaseAndPush } = await import("./rebase-push.js");
      const result = await rebaseAndPush("/repo", "test-123", { maxRetries: 3, retryDelayMs: 0 });
      expect(result.status).toBe("branch-fallback");
      expect(rebaseAttempts).toBe(3);
      expect(calls.filter(c => c === "rebase --abort")).toHaveLength(3);
    });

    it("succeeds on third retry attempt", async () => {
      const calls: string[] = [];
      let rebaseAttempts = 0;

      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
          const key = args.join(" ");
          calls.push(key);

          if (args.includes("--count")) {
            cb?.(null, { stdout: "1\n", stderr: "" });
          } else if (args.includes("--abbrev-ref")) {
            cb?.(null, { stdout: "main\n", stderr: "" });
          } else if (args[0] === "pull" && args[1] === "--rebase") {
            rebaseAttempts++;
            if (rebaseAttempts < 3) {
              cb?.(new Error("CONFLICT"), { stdout: "", stderr: "" });
            } else {
              cb?.(null, { stdout: "", stderr: "" });
            }
          } else {
            cb?.(null, { stdout: "", stderr: "" });
          }
        },
      );

      const { rebaseAndPush } = await import("./rebase-push.js");
      const result = await rebaseAndPush("/repo", "test-123", { maxRetries: 3, retryDelayMs: 0 });
      expect(result.status).toBe("pushed");
      expect(rebaseAttempts).toBe(3);
    });
  });

  describe("backgroundPushRetry", () => {
    it("returns nothing-to-push when no unpushed commits", async () => {
      mockExecFile.mockImplementation(mockExecSuccess("0\n"));

      const { backgroundPushRetry } = await import("./rebase-push.js");
      const result = await backgroundPushRetry("/repo");
      expect(result.status).toBe("nothing-to-push");
      expect(result.unpushedCount).toBe(0);
    });

    it("pushes successfully when there are unpushed commits", async () => {
      const calls: string[] = [];
      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
          calls.push(args.join(" "));
          if (args.includes("--count")) {
            cb?.(null, { stdout: "5\n", stderr: "" });
          } else if (args.includes("--abbrev-ref")) {
            cb?.(null, { stdout: "main\n", stderr: "" });
          } else {
            cb?.(null, { stdout: "", stderr: "" });
          }
        },
      );

      const { backgroundPushRetry } = await import("./rebase-push.js");
      const result = await backgroundPushRetry("/repo");
      expect(result.status).toBe("pushed");
      expect(result.unpushedCount).toBe(5);
      expect(calls).toContain("pull --rebase --autostash origin main");
      expect(calls).toContain("push origin main");
    });

    it("returns failed on rebase error without branch fallback", async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
          if (args.includes("--count")) {
            cb?.(null, { stdout: "3\n", stderr: "" });
          } else if (args.includes("--abbrev-ref")) {
            cb?.(null, { stdout: "main\n", stderr: "" });
          } else if (args[0] === "pull" && args[1] === "--rebase") {
            cb?.(new Error("CONFLICT"), { stdout: "", stderr: "" });
          } else {
            cb?.(null, { stdout: "", stderr: "" });
          }
        },
      );

      const { backgroundPushRetry } = await import("./rebase-push.js");
      const result = await backgroundPushRetry("/repo");
      expect(result.status).toBe("failed");
      expect(result.unpushedCount).toBe(3);
      expect(result.error).toContain("Rebase failed");
    });

    it("returns failed on push error", async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
          if (args.includes("--count")) {
            cb?.(null, { stdout: "2\n", stderr: "" });
          } else if (args.includes("--abbrev-ref")) {
            cb?.(null, { stdout: "main\n", stderr: "" });
          } else if (args[0] === "push") {
            cb?.(new Error("remote hung up"), { stdout: "", stderr: "" });
          } else {
            cb?.(null, { stdout: "", stderr: "" });
          }
        },
      );

      const { backgroundPushRetry } = await import("./rebase-push.js");
      const result = await backgroundPushRetry("/repo");
      expect(result.status).toBe("failed");
      expect(result.unpushedCount).toBe(2);
      expect(result.error).toContain("Push failed");
    });

    it("does not create fallback branch on failure", async () => {
      const calls: string[] = [];
      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
          calls.push(args.join(" "));
          if (args.includes("--count")) {
            cb?.(null, { stdout: "1\n", stderr: "" });
          } else if (args.includes("--abbrev-ref")) {
            cb?.(null, { stdout: "main\n", stderr: "" });
          } else if (args[0] === "pull" && args[1] === "--rebase") {
            cb?.(new Error("CONFLICT"), { stdout: "", stderr: "" });
          } else {
            cb?.(null, { stdout: "", stderr: "" });
          }
        },
      );

      const { backgroundPushRetry } = await import("./rebase-push.js");
      await backgroundPushRetry("/repo");
      expect(calls.filter(c => c.includes("checkout -b"))).toHaveLength(0);
    });

    it("switches to main when on a session branch", async () => {
      const calls: string[] = [];
      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
          calls.push(args.join(" "));
          if (args.includes("--count")) {
            cb?.(null, { stdout: "4\n", stderr: "" });
          } else if (args.includes("--abbrev-ref")) {
            cb?.(null, { stdout: "session-old-worker\n", stderr: "" });
          } else {
            cb?.(null, { stdout: "", stderr: "" });
          }
        },
      );

      const { backgroundPushRetry } = await import("./rebase-push.js");
      const result = await backgroundPushRetry("/repo");
      expect(result.status).toBe("pushed");
      expect(result.unpushedCount).toBe(4);
      expect(calls).toContain("checkout main");
      expect(calls).toContain("pull --rebase --autostash origin main");
      expect(calls).toContain("push origin main");
    });
  });

  describe("enqueuePushAndWait", () => {
    it("enqueues and returns result on success", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ sessionId: "test-123", position: 1 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ status: "completed", result: { status: "pushed" } }),
        });

      const { enqueuePushAndWait } = await import("./rebase-push.js");
      const result = await enqueuePushAndWait("/repo", "test-123", { pollIntervalMs: 0 });

      expect(result.status).toBe("pushed");
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const enqueueCall = mockFetch.mock.calls[0];
      const body = JSON.parse(enqueueCall[1]?.body as string);
      expect(body.cwd).toBe("/repo");
      expect(body.sessionId).toBe("test-123");
    });

    it("falls back to rebaseAndPush when enqueue fails", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });
      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
          if (args.includes("--count")) {
            cb?.(null, { stdout: "0\n", stderr: "" });
          } else {
            cb?.(null, { stdout: "", stderr: "" });
          }
        },
      );

      const { enqueuePushAndWait } = await import("./rebase-push.js");
      const result = await enqueuePushAndWait("/repo", "test-123");

      expect(result.status).toBe("nothing-to-push");
    });

    it("falls back to rebaseAndPush on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("network error"));
      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
          if (args.includes("--count")) {
            cb?.(null, { stdout: "0\n", stderr: "" });
          } else {
            cb?.(null, { stdout: "", stderr: "" });
          }
        },
      );

      const { enqueuePushAndWait } = await import("./rebase-push.js");
      const result = await enqueuePushAndWait("/repo", "test-123");

      expect(result.status).toBe("nothing-to-push");
    });

    it("falls back on timeout", async () => {
      let pollCount = 0;
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ sessionId: "test-123", position: 1 }),
        })
        .mockImplementation(() => {
          pollCount++;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ status: "queued" }),
          });
        });

      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
          if (args.includes("--count")) {
            cb?.(null, { stdout: "0\n", stderr: "" });
          } else {
            cb?.(null, { stdout: "", stderr: "" });
          }
        },
      );

      const { enqueuePushAndWait } = await import("./rebase-push.js");
      const result = await enqueuePushAndWait("/repo", "test-123", {
        pollIntervalMs: 0,
        timeoutMs: 10,
      });

      expect(result.status).toBe("nothing-to-push");
    });

    it("returns error when status is failed", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ sessionId: "test-123", position: 1 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ status: "failed", error: "push failed" }),
        });

      const { enqueuePushAndWait } = await import("./rebase-push.js");
      const result = await enqueuePushAndWait("/repo", "test-123", { pollIntervalMs: 0 });

      expect(result.status).toBe("error");
      expect(result.error).toBe("push failed");
    });

    it("falls back on poll status error", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ sessionId: "test-123", position: 1 }),
        })
        .mockResolvedValueOnce({ ok: false });

      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
          if (args.includes("--count")) {
            cb?.(null, { stdout: "0\n", stderr: "" });
          } else {
            cb?.(null, { stdout: "", stderr: "" });
          }
        },
      );

      const { enqueuePushAndWait } = await import("./rebase-push.js");
      const result = await enqueuePushAndWait("/repo", "test-123");

      expect(result.status).toBe("nothing-to-push");
    });

    it("polls until completed status", async () => {
      let pollCount = 0;
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ sessionId: "test-123", position: 1 }),
        })
        .mockImplementation(() => {
          pollCount++;
          if (pollCount < 3) {
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({ status: "in-progress" }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ status: "completed", result: { status: "pushed" } }),
          });
        });

      const { enqueuePushAndWait } = await import("./rebase-push.js");
      const result = await enqueuePushAndWait("/repo", "test-123", { pollIntervalMs: 0 });

      expect(result.status).toBe("pushed");
      expect(pollCount).toBe(3);
    });
  });
});
