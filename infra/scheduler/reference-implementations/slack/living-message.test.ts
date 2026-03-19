import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  createLivingMessage,
  scheduleLivingMessageUpdate,
  finalizeLivingMessage,
  findLivingMessage,
  isLivingMessageEnabled,
  countActiveLivingMessages,
  getLivingMessageSessionIds,
  removeOrphanedLivingMessage,
  setPersistenceDir,
  getPersistenceDir,
  _resetForTesting,
} from "./living-message.js";

vi.mock("./living-message-persistence.js", () => ({
  persistLivingMessage: vi.fn().mockResolvedValue(undefined),
  unpersistLivingMessage: vi.fn().mockResolvedValue(undefined),
  readPersistedLivingMessages: vi.fn().mockResolvedValue([]),
}));

function createMockClient() {
  return {
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ok: true, ts: "123.456" }),
      update: vi.fn().mockResolvedValue({ ok: true }),
    },
  } as unknown as ReturnType<typeof createMockClient>;
}

describe("living-message", () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    _resetForTesting();
    vi.clearAllMocks();
    mockClient = createMockClient();
    delete process.env.SLACK_LIVING_MESSAGE;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("message creation", () => {
    it("creates a living message with required fields", async () => {
      const result = await createLivingMessage({
        client: mockClient,
        channel: "C123",
        threadTs: "100.200",
        sessionId: "session-1",
      });

      expect(result.channel).toBe("C123");
      expect(result.threadTs).toBe("100.200");
      expect(result.sessionId).toBe("session-1");
      expect(result.state).toBe("working");
      expect(result.turnCount).toBe(0);
      expect(result.costUsd).toBe(0);
    });

    it("stores the messageTs from Slack response", async () => {
      const result = await createLivingMessage({
        client: mockClient,
        channel: "C123",
        threadTs: "100.200",
        sessionId: "session-1",
      });

      expect(result.messageTs).toBe("123.456");
    });

    it("sets maxTurns when provided", async () => {
      const result = await createLivingMessage({
        client: mockClient,
        channel: "C123",
        threadTs: "100.200",
        sessionId: "session-1",
        maxTurns: 50,
      });

      expect(result.maxTurns).toBe(50);
    });

    it("sets maxTurns to null when not provided", async () => {
      const result = await createLivingMessage({
        client: mockClient,
        channel: "C123",
        threadTs: "100.200",
        sessionId: "session-1",
      });

      expect(result.maxTurns).toBeNull();
    });

    it("calls postMessage with correct parameters", async () => {
      await createLivingMessage({
        client: mockClient,
        channel: "C456",
        threadTs: "200.300",
        sessionId: "session-2",
      });

      expect(mockClient.chat.postMessage).toHaveBeenCalledWith({
        channel: "C456",
        thread_ts: "200.300",
        text: expect.any(String),
      });
    });

    it("throws when postMessage fails", async () => {
      mockClient.chat.postMessage = vi.fn().mockResolvedValue({ ok: false, error: "channel_not_found" });

      await expect(
        createLivingMessage({
          client: mockClient,
          channel: "C123",
          threadTs: "100.200",
          sessionId: "session-1",
        }),
      ).rejects.toThrow();
    });

    it("throws when postMessage returns no ts", async () => {
      mockClient.chat.postMessage = vi.fn().mockResolvedValue({ ok: true, ts: undefined });

      await expect(
        createLivingMessage({
          client: mockClient,
          channel: "C123",
          threadTs: "100.200",
          sessionId: "session-1",
        }),
      ).rejects.toThrow();
    });

    it("stores the living message for retrieval", async () => {
      await createLivingMessage({
        client: mockClient,
        channel: "C123",
        threadTs: "100.200",
        sessionId: "session-1",
      });

      const found = findLivingMessage("session-1");
      expect(found).toBeDefined();
      expect(found?.sessionId).toBe("session-1");
    });

    it("increments active living message count", async () => {
      expect(countActiveLivingMessages()).toBe(0);

      await createLivingMessage({
        client: mockClient,
        channel: "C123",
        threadTs: "100.200",
        sessionId: "session-1",
      });

      expect(countActiveLivingMessages()).toBe(1);
    });
  });

  describe("update batching", () => {
    it("schedules update with pending patch", async () => {
      await createLivingMessage({
        client: mockClient,
        channel: "C123",
        threadTs: "100.200",
        sessionId: "session-1",
      });

      scheduleLivingMessageUpdate(mockClient, "session-1", {
        turnCount: 5,
        lastTool: "Read file.ts",
      });

      const found = findLivingMessage("session-1");
      expect(found?.turnCount).toBe(5);
      expect(found?.lastTool).toBe("Read file.ts");
    });

    it("merges multiple patches", async () => {
      await createLivingMessage({
        client: mockClient,
        channel: "C123",
        threadTs: "100.200",
        sessionId: "session-1",
      });

      scheduleLivingMessageUpdate(mockClient, "session-1", { turnCount: 3 });
      scheduleLivingMessageUpdate(mockClient, "session-1", { costUsd: 0.25 });
      scheduleLivingMessageUpdate(mockClient, "session-1", { lastActivity: "working..." });

      const found = findLivingMessage("session-1");
      expect(found?.turnCount).toBe(3);
      expect(found?.costUsd).toBe(0.25);
      expect(found?.lastActivity).toBe("working...");
    });

    it("does nothing when session not found", async () => {
      scheduleLivingMessageUpdate(mockClient, "nonexistent", { turnCount: 5 });

      expect(mockClient.chat.update).not.toHaveBeenCalled();
    });

    it("flushes immediately when MIN_UPDATE_INTERVAL elapsed", async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      await createLivingMessage({
        client: mockClient,
        channel: "C123",
        threadTs: "100.200",
        sessionId: "session-1",
      });

      mockClient.chat.update.mockClear();

      vi.setSystemTime(now + 5000);

      scheduleLivingMessageUpdate(mockClient, "session-1", { turnCount: 5 });

      expect(mockClient.chat.update).toHaveBeenCalled();
    });

    it("first update always flushes immediately", async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      await createLivingMessage({
        client: mockClient,
        channel: "C123",
        threadTs: "100.200",
        sessionId: "session-1",
      });

      mockClient.chat.update.mockClear();

      scheduleLivingMessageUpdate(mockClient, "session-1", { turnCount: 5 });

      expect(mockClient.chat.update).toHaveBeenCalled();
    });

    it("schedules timer when update called quickly after previous flush", async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const mockUpdate = vi.fn().mockImplementation(() => {
        return Promise.resolve({ ok: true });
      });
      mockClient.chat.update = mockUpdate;

      await createLivingMessage({
        client: mockClient,
        channel: "C123",
        threadTs: "100.200",
        sessionId: "session-1",
      });

      vi.setSystemTime(now + 5000);

      scheduleLivingMessageUpdate(mockClient, "session-1", { turnCount: 1 });

      await vi.waitFor(() => expect(mockUpdate).toHaveBeenCalled());

      vi.setSystemTime(now + 5500);

      mockUpdate.mockClear();

      scheduleLivingMessageUpdate(mockClient, "session-1", { turnCount: 5 });

      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe("cleanup", () => {
    it("finalizes message with complete state", async () => {
      await createLivingMessage({
        client: mockClient,
        channel: "C123",
        threadTs: "100.200",
        sessionId: "session-1",
      });

      await finalizeLivingMessage(mockClient, "session-1", {
        state: "complete",
        costUsd: 1.5,
        turnCount: 10,
        workSummary: "Task completed",
      });

      expect(mockClient.chat.update).toHaveBeenCalledWith({
        channel: "C123",
        ts: "123.456",
        text: expect.stringContaining("Complete"),
      });
    });

    it("finalizes message with failed state", async () => {
      await createLivingMessage({
        client: mockClient,
        channel: "C123",
        threadTs: "100.200",
        sessionId: "session-1",
      });

      await finalizeLivingMessage(mockClient, "session-1", {
        state: "failed",
        error: "Something went wrong",
      });

      expect(mockClient.chat.update).toHaveBeenCalledWith({
        channel: "C123",
        ts: "123.456",
        text: expect.stringContaining("Failed"),
      });
    });

    it("removes living message after finalization", async () => {
      await createLivingMessage({
        client: mockClient,
        channel: "C123",
        threadTs: "100.200",
        sessionId: "session-1",
      });

      expect(findLivingMessage("session-1")).toBeDefined();

      await finalizeLivingMessage(mockClient, "session-1", { state: "complete" });

      expect(findLivingMessage("session-1")).toBeUndefined();
    });

    it("decrements active count after finalization", async () => {
      await createLivingMessage({
        client: mockClient,
        channel: "C123",
        threadTs: "100.200",
        sessionId: "session-1",
      });

      expect(countActiveLivingMessages()).toBe(1);

      await finalizeLivingMessage(mockClient, "session-1", { state: "complete" });

      expect(countActiveLivingMessages()).toBe(0);
    });

    it("cancels pending timer on finalization", async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      await createLivingMessage({
        client: mockClient,
        channel: "C123",
        threadTs: "100.200",
        sessionId: "session-1",
      });

      scheduleLivingMessageUpdate(mockClient, "session-1", { turnCount: 1 });
      await vi.runAllTimersAsync();

      mockClient.chat.update.mockClear();

      vi.setSystemTime(now + 1000);
      scheduleLivingMessageUpdate(mockClient, "session-1", { turnCount: 5 });

      expect(mockClient.chat.update).not.toHaveBeenCalled();

      await finalizeLivingMessage(mockClient, "session-1", { state: "complete" });

      vi.advanceTimersByTime(5000);

      expect(mockClient.chat.update).toHaveBeenCalledTimes(1);
    });

    it("removes orphaned living message by sessionId", async () => {
      await createLivingMessage({
        client: mockClient,
        channel: "C123",
        threadTs: "100.200",
        sessionId: "session-1",
      });

      const removed = removeOrphanedLivingMessage("session-1");

      expect(removed).toBe(true);
      expect(findLivingMessage("session-1")).toBeUndefined();
    });

    it("returns false when removing nonexistent session", () => {
      const removed = removeOrphanedLivingMessage("nonexistent");
      expect(removed).toBe(false);
    });

    it("clears all state for orphaned message", async () => {
      vi.useFakeTimers();

      await createLivingMessage({
        client: mockClient,
        channel: "C123",
        threadTs: "100.200",
        sessionId: "session-1",
      });

      scheduleLivingMessageUpdate(mockClient, "session-1", { turnCount: 5 });

      removeOrphanedLivingMessage("session-1");

      expect(countActiveLivingMessages()).toBe(0);
      expect(getLivingMessageSessionIds()).toHaveLength(0);
    });
  });

  describe("utility functions", () => {
    it("isLivingMessageEnabled returns true by default", () => {
      expect(isLivingMessageEnabled()).toBe(true);
    });

    it("isLivingMessageEnabled returns false when SLACK_LIVING_MESSAGE=0", () => {
      process.env.SLACK_LIVING_MESSAGE = "0";
      expect(isLivingMessageEnabled()).toBe(false);
    });

    it("getLivingMessageSessionIds returns all session IDs", async () => {
      await createLivingMessage({
        client: mockClient,
        channel: "C123",
        threadTs: "100.200",
        sessionId: "session-1",
      });
      await createLivingMessage({
        client: mockClient,
        channel: "C456",
        threadTs: "200.300",
        sessionId: "session-2",
      });

      const ids = getLivingMessageSessionIds();
      expect(ids).toContain("session-1");
      expect(ids).toContain("session-2");
    });

    it("setPersistenceDir sets and getPersistenceDir returns", () => {
      setPersistenceDir("/tmp/test");
      expect(getPersistenceDir()).toBe("/tmp/test");

      setPersistenceDir(null);
      expect(getPersistenceDir()).toBeNull();
    });
  });

  describe("persistence integration", () => {
    it("persists to disk when persistenceDir is set", async () => {
      setPersistenceDir("/tmp/test");

      await createLivingMessage({
        client: mockClient,
        channel: "C123",
        threadTs: "100.200",
        sessionId: "session-1",
      });

      const { persistLivingMessage } = await import("./living-message-persistence.js");
      expect(persistLivingMessage).toHaveBeenCalled();

      setPersistenceDir(null);
    });

    it("calls unpersistLivingMessage on finalization", async () => {
      setPersistenceDir("/tmp/test");

      await createLivingMessage({
        client: mockClient,
        channel: "C123",
        threadTs: "100.200",
        sessionId: "session-1",
      });

      await finalizeLivingMessage(mockClient, "session-1", { state: "complete" });

      const { unpersistLivingMessage } = await import("./living-message-persistence.js");
      expect(unpersistLivingMessage).toHaveBeenCalledWith("session-1", "/tmp/test");

      setPersistenceDir(null);
    });
  });

  describe("fallback finalization from disk", () => {
    it("posts new message when in-memory record missing", async () => {
      setPersistenceDir("/tmp/test");

      const { readPersistedLivingMessages } = await import("./living-message-persistence.js");
      vi.mocked(readPersistedLivingMessages).mockResolvedValueOnce([
        {
          channel: "C123",
          threadTs: "100.200",
          messageTs: "999.888",
          sessionId: "session-1",
          startTimeMs: Date.now(),
        },
      ]);

      await finalizeLivingMessage(mockClient, "session-1", { state: "complete" });

      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C123",
          thread_ts: "100.200",
        }),
      );

      setPersistenceDir(null);
    });

    it("does nothing when no persistence dir and no in-memory record", async () => {
      setPersistenceDir(null);

      await finalizeLivingMessage(mockClient, "nonexistent", { state: "complete" });

      expect(mockClient.chat.postMessage).not.toHaveBeenCalled();
      expect(mockClient.chat.update).not.toHaveBeenCalled();
    });
  });
});
