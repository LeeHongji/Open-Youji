/** Tests for disk-based living message persistence (survive pm2 restarts). */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  persistLivingMessage,
  unpersistLivingMessage,
  readPersistedLivingMessages,
  clearPersistedLivingMessages,
  type PersistedLivingMessage,
} from "./living-message-persistence.js";

describe("living-message-persistence", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "youji-living-msg-test-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  const msg: PersistedLivingMessage = {
    channel: "C12345",
    threadTs: "1700000000.000001",
    messageTs: "1700000000.000002",
    sessionId: "sess-abc123",
    startTimeMs: 1700000000000,
  };

  it("persists and reads back a message", async () => {
    await persistLivingMessage(msg, baseDir);
    const messages = await readPersistedLivingMessages(baseDir);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(msg);
  });

  it("persists multiple messages", async () => {
    const msg2: PersistedLivingMessage = {
      channel: "C67890",
      threadTs: "1700000001.000001",
      messageTs: "1700000001.000002",
      sessionId: "sess-def456",
      startTimeMs: 1700000001000,
    };
    await persistLivingMessage(msg, baseDir);
    await persistLivingMessage(msg2, baseDir);

    const messages = await readPersistedLivingMessages(baseDir);
    expect(messages).toHaveLength(2);
    const ids = messages.map((m) => m.sessionId).sort();
    expect(ids).toEqual(["sess-abc123", "sess-def456"]);
  });

  it("unpersists a message by sessionId", async () => {
    await persistLivingMessage(msg, baseDir);
    await unpersistLivingMessage(msg.sessionId, baseDir);

    const messages = await readPersistedLivingMessages(baseDir);
    expect(messages).toHaveLength(0);
  });

  it("unpersist is idempotent (no error for missing message)", async () => {
    await expect(unpersistLivingMessage("nonexistent", baseDir)).resolves.not.toThrow();
  });

  it("clears all persisted messages", async () => {
    const msg2: PersistedLivingMessage = {
      channel: "C67890",
      threadTs: "1700000001.000001",
      messageTs: "1700000001.000002",
      sessionId: "sess-def456",
      startTimeMs: 1700000001000,
    };
    await persistLivingMessage(msg, baseDir);
    await persistLivingMessage(msg2, baseDir);

    await clearPersistedLivingMessages(baseDir);
    const messages = await readPersistedLivingMessages(baseDir);
    expect(messages).toHaveLength(0);
  });

  it("returns empty array when no messages directory exists", async () => {
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

  it("skips non-JSON files when reading", async () => {
    await persistLivingMessage(msg, baseDir);

    const dir = join(baseDir, "living-messages");
    await writeFile(join(dir, "readme.txt"), "not a json file");

    const messages = await readPersistedLivingMessages(baseDir);
    expect(messages).toHaveLength(1);
    expect(messages[0].sessionId).toBe("sess-abc123");
  });

  it("clear is safe when directory does not exist", async () => {
    await expect(clearPersistedLivingMessages(baseDir)).resolves.not.toThrow();
  });
});
