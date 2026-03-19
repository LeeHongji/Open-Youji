import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PushQueue, type PushRequest, type PushResult } from "./push-queue.js";

describe("PushQueue", () => {
  let queue: PushQueue;

  beforeEach(() => {
    queue = new PushQueue();
  });

  afterEach(() => {
    queue.clearQueue();
    queue.clearResults();
  });

  describe("enqueue", () => {
    it("adds request to queue and returns position", () => {
      const result = queue.enqueue({
        sessionId: "session-1",
        cwd: "/test/path",
        priority: "fleet",
      });

      expect(result.position).toBe(1);
      expect(queue.getQueueDepth()).toBe(1);
    });

    it("returns correct position for multiple requests", () => {
      const r1 = queue.enqueue({ sessionId: "s1", cwd: "/a", priority: "fleet" });
      const r2 = queue.enqueue({ sessionId: "s2", cwd: "/b", priority: "fleet" });
      const r3 = queue.enqueue({ sessionId: "s3", cwd: "/c", priority: "fleet" });

      expect(r1.position).toBe(1);
      expect(r2.position).toBe(2);
      expect(r3.position).toBe(3);
    });

    it("sets enqueuedAt timestamp automatically", () => {
      const before = Date.now();
      queue.enqueue({ sessionId: "s1", cwd: "/a", priority: "fleet" });
      const after = Date.now();

      const snapshot = queue.getQueueSnapshot();
      expect(snapshot[0].enqueuedAt).toBeGreaterThanOrEqual(before);
      expect(snapshot[0].enqueuedAt).toBeLessThanOrEqual(after);
    });
  });

  describe("priority sorting (opus before fleet)", () => {
    it("processes opus requests before fleet requests", () => {
      queue.enqueue({ sessionId: "fleet-1", cwd: "/a", priority: "fleet" });
      queue.enqueue({ sessionId: "opus-1", cwd: "/b", priority: "opus" });
      queue.enqueue({ sessionId: "fleet-2", cwd: "/c", priority: "fleet" });

      const snapshot = queue.getQueueSnapshot();
      expect(snapshot[0].sessionId).toBe("opus-1");
      expect(snapshot[1].sessionId).toBe("fleet-1");
      expect(snapshot[2].sessionId).toBe("fleet-2");
    });

    it("maintains FIFO order within same priority", () => {
      queue.enqueue({ sessionId: "fleet-1", cwd: "/a", priority: "fleet" });
      queue.enqueue({ sessionId: "fleet-2", cwd: "/b", priority: "fleet" });
      queue.enqueue({ sessionId: "fleet-3", cwd: "/c", priority: "fleet" });

      const snapshot = queue.getQueueSnapshot();
      expect(snapshot[0].sessionId).toBe("fleet-1");
      expect(snapshot[1].sessionId).toBe("fleet-2");
      expect(snapshot[2].sessionId).toBe("fleet-3");
    });

    it("maintains FIFO order within opus priority", () => {
      queue.enqueue({ sessionId: "opus-1", cwd: "/a", priority: "opus" });
      queue.enqueue({ sessionId: "opus-2", cwd: "/b", priority: "opus" });
      queue.enqueue({ sessionId: "opus-3", cwd: "/c", priority: "opus" });

      const snapshot = queue.getQueueSnapshot();
      expect(snapshot[0].sessionId).toBe("opus-1");
      expect(snapshot[1].sessionId).toBe("opus-2");
      expect(snapshot[2].sessionId).toBe("opus-3");
    });

    it("handles mixed priorities correctly", () => {
      queue.enqueue({ sessionId: "fleet-1", cwd: "/a", priority: "fleet" });
      queue.enqueue({ sessionId: "opus-1", cwd: "/b", priority: "opus" });
      queue.enqueue({ sessionId: "fleet-2", cwd: "/c", priority: "fleet" });
      queue.enqueue({ sessionId: "opus-2", cwd: "/d", priority: "opus" });

      const snapshot = queue.getQueueSnapshot();
      expect(snapshot.map((r) => r.sessionId)).toEqual([
        "opus-1",
        "opus-2",
        "fleet-1",
        "fleet-2",
      ]);
    });
  });

  describe("getResult", () => {
    it("returns null for non-existent session", () => {
      const result = queue.getResult("non-existent");
      expect(result).toBeNull();
    });

    it("returns stored result after processQueue completes", async () => {
      const mockExecutePush = vi.fn().mockResolvedValue({
        status: "pushed",
      } as PushResult);

      queue.enqueue({ sessionId: "s1", cwd: "/a", priority: "fleet" });
      await queue.processQueue(mockExecutePush);

      const result = queue.getResult("s1");
      expect(result).not.toBeNull();
      expect(result!.status).toBe("pushed");
      expect(result!.sessionId).toBe("s1");
    });

    it("includes waitMs and queueDepth in result", async () => {
      const mockExecutePush = vi.fn().mockResolvedValue({
        status: "pushed",
      } as PushResult);

      queue.enqueue({ sessionId: "s1", cwd: "/a", priority: "fleet" });
      queue.enqueue({ sessionId: "s2", cwd: "/b", priority: "fleet" });

      await queue.processQueue(mockExecutePush);

      const result1 = queue.getResult("s1");
      expect(result1!.waitMs).toBeGreaterThanOrEqual(0);
      expect(result1!.queueDepth).toBe(1); // 1 remaining after s1 processed

      const result2 = queue.getResult("s2");
      expect(result2!.queueDepth).toBe(0); // 0 remaining after s2 processed
    });
  });

  describe("getQueueDepth", () => {
    it("returns 0 for empty queue", () => {
      expect(queue.getQueueDepth()).toBe(0);
    });

    it("returns correct count after enqueues", () => {
      queue.enqueue({ sessionId: "s1", cwd: "/a", priority: "fleet" });
      expect(queue.getQueueDepth()).toBe(1);

      queue.enqueue({ sessionId: "s2", cwd: "/b", priority: "fleet" });
      expect(queue.getQueueDepth()).toBe(2);
    });

    it("decreases after processQueue", async () => {
      const mockExecutePush = vi.fn().mockResolvedValue({ status: "pushed" });

      queue.enqueue({ sessionId: "s1", cwd: "/a", priority: "fleet" });
      queue.enqueue({ sessionId: "s2", cwd: "/b", priority: "fleet" });

      expect(queue.getQueueDepth()).toBe(2);

      await queue.processQueue(mockExecutePush);

      expect(queue.getQueueDepth()).toBe(0);
    });
  });

  describe("processQueue", () => {
    it("processes requests in priority order", async () => {
      const processedOrder: string[] = [];
      const mockExecutePush = vi.fn().mockImplementation(async (req: PushRequest) => {
        processedOrder.push(req.sessionId);
        return { status: "pushed" } as PushResult;
      });

      queue.enqueue({ sessionId: "fleet-1", cwd: "/a", priority: "fleet" });
      queue.enqueue({ sessionId: "opus-1", cwd: "/b", priority: "opus" });
      queue.enqueue({ sessionId: "fleet-2", cwd: "/c", priority: "fleet" });

      await queue.processQueue(mockExecutePush);

      expect(processedOrder).toEqual(["opus-1", "fleet-1", "fleet-2"]);
    });

    it("does not start if already processing", async () => {
      const mockExecutePush = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ status: "pushed" }), 10)),
      );

      queue.enqueue({ sessionId: "s1", cwd: "/a", priority: "fleet" });
      queue.enqueue({ sessionId: "s2", cwd: "/b", priority: "fleet" });

      const promise1 = queue.processQueue(mockExecutePush);
      const promise2 = queue.processQueue(mockExecutePush);

      await Promise.all([promise1, promise2]);

      expect(mockExecutePush).toHaveBeenCalledTimes(2);
    });

    it("continues processing after errors", async () => {
      const mockExecutePush = vi
        .fn()
        .mockResolvedValueOnce({ status: "error", error: "failed" } as PushResult)
        .mockResolvedValueOnce({ status: "pushed" } as PushResult);

      queue.enqueue({ sessionId: "s1", cwd: "/a", priority: "fleet" });
      queue.enqueue({ sessionId: "s2", cwd: "/b", priority: "fleet" });

      await queue.processQueue(mockExecutePush);

      const result1 = queue.getResult("s1");
      const result2 = queue.getResult("s2");

      expect(result1!.status).toBe("error");
      expect(result2!.status).toBe("pushed");
    });
  });

  describe("result TTL cleanup", () => {
    it("removes results after TTL expires", async () => {
      vi.useFakeTimers();

      const shortTtlQueue = new PushQueue({ resultTtlMs: 1000 });
      const mockExecutePush = vi.fn().mockResolvedValue({ status: "pushed" } as PushResult);

      shortTtlQueue.enqueue({ sessionId: "s1", cwd: "/a", priority: "fleet" });
      await shortTtlQueue.processQueue(mockExecutePush);

      expect(shortTtlQueue.getResult("s1")).not.toBeNull();

      vi.advanceTimersByTime(1000);

      expect(shortTtlQueue.getResult("s1")).toBeNull();

      vi.useRealTimers();
    });

    it("keeps results before TTL expires", async () => {
      vi.useFakeTimers();

      const shortTtlQueue = new PushQueue({ resultTtlMs: 1000 });
      const mockExecutePush = vi.fn().mockResolvedValue({ status: "pushed" } as PushResult);

      shortTtlQueue.enqueue({ sessionId: "s1", cwd: "/a", priority: "fleet" });
      await shortTtlQueue.processQueue(mockExecutePush);

      vi.advanceTimersByTime(999);

      expect(shortTtlQueue.getResult("s1")).not.toBeNull();

      vi.useRealTimers();
    });

    it("cleans up each result independently", async () => {
      vi.useFakeTimers();

      const shortTtlQueue = new PushQueue({ resultTtlMs: 1000 });
      const mockExecutePush = vi.fn().mockResolvedValue({ status: "pushed" } as PushResult);

      shortTtlQueue.enqueue({ sessionId: "s1", cwd: "/a", priority: "fleet" });
      await shortTtlQueue.processQueue(mockExecutePush);

      vi.advanceTimersByTime(500);

      shortTtlQueue.enqueue({ sessionId: "s2", cwd: "/b", priority: "fleet" });
      await shortTtlQueue.processQueue(mockExecutePush);

      vi.advanceTimersByTime(600);

      expect(shortTtlQueue.getResult("s1")).toBeNull();
      expect(shortTtlQueue.getResult("s2")).not.toBeNull();

      vi.useRealTimers();
    });
  });

  describe("isProcessing", () => {
    it("returns false initially", () => {
      expect(queue.isProcessing()).toBe(false);
    });

    it("returns true while processing", async () => {
      vi.useFakeTimers();

      const mockExecutePush = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ status: "pushed" }), 100)),
      );

      queue.enqueue({ sessionId: "s1", cwd: "/a", priority: "fleet" });

      const processPromise = queue.processQueue(mockExecutePush);

      expect(queue.isProcessing()).toBe(true);

      vi.runAllTimers();
      await processPromise;

      expect(queue.isProcessing()).toBe(false);

      vi.useRealTimers();
    });
  });

  describe("getProcessingSessionId", () => {
    it("returns null when idle", () => {
      expect(queue.getProcessingSessionId()).toBeNull();
    });

    it("returns the session ID of the currently processing request", async () => {
      let capturedSessionId: string | null = null;
      const mockExecutePush = vi.fn().mockImplementation(async (req: PushRequest) => {
        capturedSessionId = queue.getProcessingSessionId();
        return { status: "pushed" } as PushResult;
      });

      queue.enqueue({ sessionId: "s1", cwd: "/a", priority: "fleet" });
      await queue.processQueue(mockExecutePush);

      expect(capturedSessionId).toBe("s1");
      expect(queue.getProcessingSessionId()).toBeNull();
    });

    it("tracks each session as it is processed sequentially", async () => {
      const capturedIds: (string | null)[] = [];
      const mockExecutePush = vi.fn().mockImplementation(async () => {
        capturedIds.push(queue.getProcessingSessionId());
        return { status: "pushed" } as PushResult;
      });

      queue.enqueue({ sessionId: "s1", cwd: "/a", priority: "fleet" });
      queue.enqueue({ sessionId: "s2", cwd: "/b", priority: "fleet" });
      await queue.processQueue(mockExecutePush);

      expect(capturedIds).toEqual(["s1", "s2"]);
      expect(queue.getProcessingSessionId()).toBeNull();
    });

    it("is cleared on error in processQueue", async () => {
      const mockExecutePush = vi.fn().mockRejectedValue(new Error("boom"));

      queue.enqueue({ sessionId: "s1", cwd: "/a", priority: "fleet" });
      await expect(queue.processQueue(mockExecutePush)).rejects.toThrow("boom");

      expect(queue.getProcessingSessionId()).toBeNull();
      expect(queue.isProcessing()).toBe(false);
    });
  });

  describe("clearQueue and clearResults", () => {
    it("clearQueue removes all queued requests", () => {
      queue.enqueue({ sessionId: "s1", cwd: "/a", priority: "fleet" });
      queue.enqueue({ sessionId: "s2", cwd: "/b", priority: "fleet" });

      expect(queue.getQueueDepth()).toBe(2);

      queue.clearQueue();

      expect(queue.getQueueDepth()).toBe(0);
    });

    it("clearResults removes all stored results", async () => {
      const mockExecutePush = vi.fn().mockResolvedValue({ status: "pushed" } as PushResult);

      queue.enqueue({ sessionId: "s1", cwd: "/a", priority: "fleet" });
      await queue.processQueue(mockExecutePush);

      expect(queue.getResult("s1")).not.toBeNull();

      queue.clearResults();

      expect(queue.getResult("s1")).toBeNull();
    });
  });
});
