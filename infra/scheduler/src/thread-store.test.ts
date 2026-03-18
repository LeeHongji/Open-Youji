import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ThreadStore } from "./thread-store.js";

describe("ThreadStore", () => {
  let store: ThreadStore;
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "thread-store-test-"));
    dbPath = join(tmpDir, "threads.db");
    store = new ThreadStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("ensureThread", () => {
    it("creates a new thread record", () => {
      store.ensureThread("C123:ts456", "C123", "ts456");
      const thread = store.getThread("C123:ts456");
      expect(thread).not.toBeNull();
      expect(thread!.convKey).toBe("C123:ts456");
      expect(thread!.channel).toBe("C123");
      expect(thread!.threadTs).toBe("ts456");
      expect(thread!.createdAt).toBeGreaterThan(0);
      expect(thread!.lastActivityAt).toBeGreaterThan(0);
    });

    it("updates lastActivityAt on existing thread", () => {
      store.ensureThread("C123:ts456", "C123", "ts456");
      const first = store.getThread("C123:ts456");
      // Call again to update activity
      store.ensureThread("C123:ts456", "C123", "ts456");
      const second = store.getThread("C123:ts456");
      expect(second).not.toBeNull();
      // lastActivityAt should be >= first (may be same second)
      expect(second!.lastActivityAt).toBeGreaterThanOrEqual(first!.lastActivityAt);
    });
  });

  describe("addMessage + getMessages", () => {
    it("stores and retrieves messages in chronological order", () => {
      store.ensureThread("C1:t1", "C1", "t1");
      store.addMessage("C1:t1", { role: "user", content: "hello", slackTs: "1.1" });
      store.addMessage("C1:t1", { role: "assistant", content: "hi there", slackTs: "1.2" });
      store.addMessage("C1:t1", { role: "user", content: "how are you?", slackTs: "1.3" });

      const msgs = store.getMessages("C1:t1");
      expect(msgs).toHaveLength(3);
      expect(msgs[0].role).toBe("user");
      expect(msgs[0].content).toBe("hello");
      expect(msgs[1].role).toBe("assistant");
      expect(msgs[1].content).toBe("hi there");
      expect(msgs[2].role).toBe("user");
      expect(msgs[2].content).toBe("how are you?");
    });

    it("returns last N messages with limit option", () => {
      store.ensureThread("C1:t1", "C1", "t1");
      for (let i = 0; i < 10; i++) {
        store.addMessage("C1:t1", { role: "user", content: `msg-${i}`, slackTs: `ts-${i}` });
      }

      const msgs = store.getMessages("C1:t1", { limit: 3 });
      expect(msgs).toHaveLength(3);
      // Should be the LAST 3 messages in chronological order
      expect(msgs[0].content).toBe("msg-7");
      expect(msgs[1].content).toBe("msg-8");
      expect(msgs[2].content).toBe("msg-9");
    });

    it("defaults to 20 message limit", () => {
      store.ensureThread("C1:t1", "C1", "t1");
      for (let i = 0; i < 25; i++) {
        store.addMessage("C1:t1", { role: "user", content: `msg-${i}`, slackTs: `ts-${i}` });
      }

      const msgs = store.getMessages("C1:t1");
      expect(msgs).toHaveLength(20);
      // Should be the last 20
      expect(msgs[0].content).toBe("msg-5");
      expect(msgs[19].content).toBe("msg-24");
    });
  });

  describe("deduplication", () => {
    it("silently ignores duplicate slack_ts", () => {
      store.ensureThread("C1:t1", "C1", "t1");
      store.addMessage("C1:t1", { role: "user", content: "first", slackTs: "dup-ts" });
      store.addMessage("C1:t1", { role: "user", content: "duplicate", slackTs: "dup-ts" });

      const msgs = store.getMessages("C1:t1");
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe("first");
    });

    it("allows messages without slack_ts (no dedup on null)", () => {
      store.ensureThread("C1:t1", "C1", "t1");
      store.addMessage("C1:t1", { role: "assistant", content: "response 1" });
      store.addMessage("C1:t1", { role: "assistant", content: "response 2" });

      const msgs = store.getMessages("C1:t1");
      expect(msgs).toHaveLength(2);
    });
  });

  describe("getThread", () => {
    it("returns null for unknown key", () => {
      const thread = store.getThread("nonexistent");
      expect(thread).toBeNull();
    });
  });

  describe("persistence across close/reopen", () => {
    it("data survives close and reopen", () => {
      store.ensureThread("C1:t1", "C1", "t1");
      store.addMessage("C1:t1", { role: "user", content: "persistent msg", slackTs: "p1" });
      store.close();

      // Reopen with same path
      const store2 = new ThreadStore(dbPath);
      const thread = store2.getThread("C1:t1");
      expect(thread).not.toBeNull();
      expect(thread!.channel).toBe("C1");

      const msgs = store2.getMessages("C1:t1");
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe("persistent msg");
      store2.close();
    });
  });
});
