/** Tests for living message persistence and finalization. */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createLivingMessage,
  finalizeLivingMessage,
  findLivingMessage,
  setPersistenceDir,
  _resetForTesting,
} from "./living-message.js";
import {
  persistLivingMessage,
  unpersistLivingMessage,
  readPersistedLivingMessages,
  clearPersistedLivingMessages,
  type PersistedLivingMessage,
} from "./living-message-persistence.js";

function mockClient() {
  return {
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ok: true, ts: "1700000001.000000" }),
      update: vi.fn().mockResolvedValue({ ok: true }),
    },
  } as any;
}

describe("living-message-persistence", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "youji-lm-persist-test-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  const msg: PersistedLivingMessage = {
    channel: "C123ABC",
    threadTs: "1700000000.000000",
    messageTs: "1700000001.000000",
    sessionId: "sess-abc123",
    startTimeMs: 1700000000000,
  };

  it("persists and reads back a living message", async () => {
    await persistLivingMessage(msg, baseDir);
    const messages = await readPersistedLivingMessages(baseDir);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(msg);
  });

  it("persists multiple living messages", async () => {
    const msg2: PersistedLivingMessage = {
      channel: "C456DEF",
      threadTs: "1700000002.000000",
      messageTs: "1700000003.000000",
      sessionId: "sess-def456",
      startTimeMs: 1700000002000,
    };
    await persistLivingMessage(msg, baseDir);
    await persistLivingMessage(msg2, baseDir);

    const messages = await readPersistedLivingMessages(baseDir);
    expect(messages).toHaveLength(2);
    const ids = messages.map((m) => m.sessionId).sort();
    expect(ids).toEqual(["sess-abc123", "sess-def456"]);
  });

  it("unpersists a living message by session ID", async () => {
    await persistLivingMessage(msg, baseDir);
    await unpersistLivingMessage(msg.sessionId, baseDir);

    const messages = await readPersistedLivingMessages(baseDir);
    expect(messages).toHaveLength(0);
  });

  it("unpersist is idempotent (no error for missing message)", async () => {
    await expect(unpersistLivingMessage("nonexistent", baseDir)).resolves.not.toThrow();
  });

  it("clears all persisted living messages", async () => {
    const msg2: PersistedLivingMessage = {
      channel: "C456DEF",
      threadTs: "1700000002.000000",
      messageTs: "1700000003.000000",
      sessionId: "sess-def456",
      startTimeMs: 1700000002000,
    };
    await persistLivingMessage(msg, baseDir);
    await persistLivingMessage(msg2, baseDir);

    await clearPersistedLivingMessages(baseDir);
    const messages = await readPersistedLivingMessages(baseDir);
    expect(messages).toHaveLength(0);
  });

  it("returns empty array when no directory exists", async () => {
    const messages = await readPersistedLivingMessages(baseDir);
    expect(messages).toEqual([]);
  });

  it("skips malformed JSON files gracefully", async () => {
    await persistLivingMessage(msg, baseDir);

    const dir = join(baseDir, "living-messages");
    await writeFile(join(dir, "bad-msg.json"), "not valid json{{{");

    const messages = await readPersistedLivingMessages(baseDir);
    expect(messages).toHaveLength(1);
    expect(messages[0].sessionId).toBe("sess-abc123");
  });

  it("creates directory on first persist", async () => {
    await persistLivingMessage(msg, baseDir);
    const entries = await readdir(join(baseDir, "living-messages"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toBe("sess-abc123.json");
  });

  it("overwrites on re-persist with same session ID", async () => {
    await persistLivingMessage(msg, baseDir);
    const updated = { ...msg, messageTs: "1700000099.000000" };
    await persistLivingMessage(updated, baseDir);

    const messages = await readPersistedLivingMessages(baseDir);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageTs).toBe("1700000099.000000");
  });
});

describe("living-message persistence integration", () => {
  let baseDir: string;
  let client: ReturnType<typeof mockClient>;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "youji-lm-test-"));
    client = mockClient();
    setPersistenceDir(baseDir);
    _resetForTesting();
  });

  afterEach(async () => {
    _resetForTesting();
    setPersistenceDir(null);
    await rm(baseDir, { recursive: true, force: true });
  });

  it("createLivingMessage persists to disk", async () => {
    await createLivingMessage({
      client,
      channel: "C123",
      threadTs: "1700000000.000000",
      sessionId: "sess-abc",
    });

    const persisted = await readPersistedLivingMessages(baseDir);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].sessionId).toBe("sess-abc");
    expect(persisted[0].messageTs).toBe("1700000001.000000");
  });

  it("finalizeLivingMessage cleans up disk record on normal finalize", async () => {
    await createLivingMessage({
      client,
      channel: "C123",
      threadTs: "1700000000.000000",
      sessionId: "sess-abc",
    });

    await finalizeLivingMessage(client, "sess-abc", {
      state: "complete",
      costUsd: 1.23,
      turnCount: 10,
    });

    expect(findLivingMessage("sess-abc")).toBeUndefined();
    const persisted = await readPersistedLivingMessages(baseDir);
    expect(persisted).toHaveLength(0);
  });

  it("finalizeLivingMessage falls back to disk when in-memory is missing", async () => {
    await persistLivingMessage({
      channel: "C123",
      threadTs: "1700000000.000000",
      messageTs: "1700000001.000000",
      sessionId: "sess-orphan",
      startTimeMs: Date.now() - 60000,
    }, baseDir);

    expect(findLivingMessage("sess-orphan")).toBeUndefined();

    await finalizeLivingMessage(client, "sess-orphan", {
      state: "complete",
      costUsd: 2.50,
      turnCount: 20,
      workSummary: "Fixed the bug",
    });

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C123",
        thread_ts: "1700000000.000000",
      }),
    );
    const postCall = client.chat.postMessage.mock.calls.find(
      (c: any[]) => c[0].thread_ts === "1700000000.000000",
    );
    expect(postCall).toBeDefined();
    expect(postCall[0].text).toContain("Complete");

    const persisted = await readPersistedLivingMessages(baseDir);
    expect(persisted).toHaveLength(0);
  });

  it("finalizeLivingMessage disk fallback includes work summary", async () => {
    await persistLivingMessage({
      channel: "C123",
      threadTs: "1700000000.000000",
      messageTs: "1700000001.000000",
      sessionId: "sess-orphan",
      startTimeMs: Date.now() - 120000,
    }, baseDir);

    await finalizeLivingMessage(client, "sess-orphan", {
      state: "failed",
      turnCount: 5,
      error: "context limit exceeded",
    });

    const postCall = client.chat.postMessage.mock.calls.find(
      (c: any[]) => c[0].thread_ts === "1700000000.000000",
    );
    expect(postCall).toBeDefined();
    expect(postCall[0].text).toContain("Failed");
    expect(postCall[0].text).toContain("context limit exceeded");
  });

  it("finalizeLivingMessage with no in-memory and no disk record is a no-op", async () => {
    await finalizeLivingMessage(client, "sess-nonexistent", {
      state: "complete",
      turnCount: 0,
    });

    expect(client.chat.update).not.toHaveBeenCalled();
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });
});
