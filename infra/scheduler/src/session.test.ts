/** Tests for session watcher lookup. */

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerSession,
  clearAll,
  addWatcher,
  findSessionByWatcher,
  getSession,
  updateSessionStats,
  incrementSessionTurns,
} from "./session.js";
import type { SessionHandle } from "./backend.js";

function mockHandle(): SessionHandle {
  return {
    backend: "claude",
    interrupt: async () => {},
    streamInput: async () => {},
  };
}

describe("findSessionByWatcher", () => {
  beforeEach(() => {
    clearAll();
  });

  it("returns session that has matching watcher key", () => {
    const session = registerSession("sess-1", "job-1", "test-job", mockHandle());
    addWatcher("sess-1", "C123:thread-abc");

    const found = findSessionByWatcher("C123:thread-abc");
    expect(found).toBeDefined();
    expect(found!.id).toBe("sess-1");
  });

  it("returns undefined when no match", () => {
    registerSession("sess-1", "job-1", "test-job", mockHandle());
    addWatcher("sess-1", "C123:thread-abc");

    const found = findSessionByWatcher("C999:other-thread");
    expect(found).toBeUndefined();
  });

  it("returns undefined when no sessions exist", () => {
    const found = findSessionByWatcher("C123:thread-abc");
    expect(found).toBeUndefined();
  });

  it("returns correct session when multiple sessions have different watchers", () => {
    registerSession("sess-1", "job-1", "test-job-1", mockHandle());
    registerSession("sess-2", "job-2", "test-job-2", mockHandle());
    addWatcher("sess-1", "C123:thread-1");
    addWatcher("sess-2", "C123:thread-2");

    const found = findSessionByWatcher("C123:thread-2");
    expect(found).toBeDefined();
    expect(found!.id).toBe("sess-2");
  });
});

describe("updateSessionStats", () => {
  beforeEach(() => {
    clearAll();
  });

  it("updates cost and turns on an existing session", () => {
    registerSession("sess-1", "job-1", "test-job", mockHandle());
    const before = getSession("sess-1");
    expect(before!.costUsd).toBe(0);
    expect(before!.numTurns).toBe(0);

    updateSessionStats("sess-1", 3.14, 42);

    const after = getSession("sess-1");
    expect(after!.costUsd).toBe(3.14);
    expect(after!.numTurns).toBe(42);
  });

  it("is a no-op for a non-existent session", () => {
    // Should not throw
    updateSessionStats("no-such-session", 1.0, 10);
  });

  it("preserves incremental turn count when result reports 0 turns (Cursor backend)", () => {
    registerSession("sess-cursor", "job-1", "test-job", mockHandle());

    // Simulate 42 assistant messages arriving (Cursor backend)
    for (let i = 0; i < 42; i++) {
      incrementSessionTurns("sess-cursor");
    }
    expect(getSession("sess-cursor")!.numTurns).toBe(42);

    // Cursor result message arrives with num_turns=0 — should NOT overwrite
    updateSessionStats("sess-cursor", 0, 0);
    expect(getSession("sess-cursor")!.numTurns).toBe(42);
  });

  it("uses authoritative turn count when result reports non-zero (Claude backend)", () => {
    registerSession("sess-claude", "job-1", "test-job", mockHandle());

    // Simulate assistant messages
    for (let i = 0; i < 10; i++) {
      incrementSessionTurns("sess-claude");
    }
    expect(getSession("sess-claude")!.numTurns).toBe(10);

    // Claude result message arrives with authoritative count — should overwrite
    updateSessionStats("sess-claude", 5.50, 10);
    expect(getSession("sess-claude")!.numTurns).toBe(10);
    expect(getSession("sess-claude")!.costUsd).toBe(5.50);
  });
});

describe("incrementSessionTurns", () => {
  beforeEach(() => {
    clearAll();
  });

  it("increments turn count on each call", () => {
    registerSession("sess-1", "job-1", "test-job", mockHandle());
    expect(getSession("sess-1")!.numTurns).toBe(0);

    incrementSessionTurns("sess-1");
    expect(getSession("sess-1")!.numTurns).toBe(1);

    incrementSessionTurns("sess-1");
    incrementSessionTurns("sess-1");
    expect(getSession("sess-1")!.numTurns).toBe(3);
  });

  it("is a no-op for non-existent session", () => {
    incrementSessionTurns("no-such-session");
  });
});
