/** Tests for disk-based deep work session persistence (survive pm2 restarts). */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  persistSession,
  unpersistSession,
  readPersistedSessions,
  clearPersistedSessions,
  type PersistedSession,
} from "./session-persistence.js";

describe("session-persistence", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "youji-persist-test-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  const session: PersistedSession = {
    sessionId: "sess-abc123",
    task: "Fix the dedup bug in chat.ts",
    threadKey: "C123:1700000000.000000",
    startedAtMs: 1700000000000,
  };

  it("persists and reads back a session", async () => {
    await persistSession(session, baseDir);
    const sessions = await readPersistedSessions(baseDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toEqual(session);
  });

  it("persists multiple sessions", async () => {
    const session2: PersistedSession = {
      sessionId: "sess-def456",
      task: "Run /orient",
      threadKey: "C456:1700000001.000000",
      startedAtMs: 1700000001000,
    };
    await persistSession(session, baseDir);
    await persistSession(session2, baseDir);

    const sessions = await readPersistedSessions(baseDir);
    expect(sessions).toHaveLength(2);
    const ids = sessions.map((s) => s.sessionId).sort();
    expect(ids).toEqual(["sess-abc123", "sess-def456"]);
  });

  it("unpersists a session by ID", async () => {
    await persistSession(session, baseDir);
    await unpersistSession(session.sessionId, baseDir);

    const sessions = await readPersistedSessions(baseDir);
    expect(sessions).toHaveLength(0);
  });

  it("unpersist is idempotent (no error for missing session)", async () => {
    await expect(unpersistSession("nonexistent", baseDir)).resolves.not.toThrow();
  });

  it("clears all persisted sessions", async () => {
    const session2: PersistedSession = {
      sessionId: "sess-def456",
      task: "Run /orient",
      threadKey: "C456:1700000001.000000",
      startedAtMs: 1700000001000,
    };
    await persistSession(session, baseDir);
    await persistSession(session2, baseDir);

    await clearPersistedSessions(baseDir);
    const sessions = await readPersistedSessions(baseDir);
    expect(sessions).toHaveLength(0);
  });

  it("returns empty array when no sessions directory exists", async () => {
    const sessions = await readPersistedSessions(baseDir);
    expect(sessions).toEqual([]);
  });

  it("skips malformed JSON files gracefully", async () => {
    // First persist a valid session to create the directory
    await persistSession(session, baseDir);

    // Write a malformed file directly
    const { writeFile } = await import("node:fs/promises");
    const dir = join(baseDir, "active-sessions");
    await writeFile(join(dir, "bad-session.json"), "not valid json{{{");

    const sessions = await readPersistedSessions(baseDir);
    // Should get the valid session, skip the bad one
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe("sess-abc123");
  });

  it("creates directory on first persist", async () => {
    await persistSession(session, baseDir);
    const entries = await readdir(join(baseDir, "active-sessions"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toBe("sess-abc123.json");
  });
});
