/** Tests for pre-session auto-commit of orphaned artifacts. */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildAutoCommitArgs, shouldSkipForCooldown, DEFAULT_COOLDOWN_MS, DEFAULT_MIN_FILES_TO_BYPASS, type AutoCommitResult, type OrphanProvenance, collectActiveSessionIds, formatProvenanceMessage } from "./auto-commit.js";
import type { SessionInfo } from "./session.js";

describe("buildAutoCommitArgs", () => {
  it("returns null when git status is clean", () => {
    const result = buildAutoCommitArgs([], []);
    expect(result).toBeNull();
  });

  it("returns null when only expected files exist (no orphans)", () => {
    const result = buildAutoCommitArgs(
      ["?? node_modules/foo", "?? projects/sample-project/experiments/running-exp/results/out.csv"],
      ["projects/sample-project/experiments/running-exp"],
    );
    expect(result).toBeNull();
  });

  it("returns file list for orphaned work artifacts", () => {
    const result = buildAutoCommitArgs(
      [" M projects/youji/README.md", "?? projects/sample-project/experiments/done-exp/results/out.csv"],
      [],
    );
    expect(result).not.toBeNull();
    expect(result!.files).toContain("projects/youji/README.md");
    expect(result!.files).toContain("projects/sample-project/experiments/done-exp/results/out.csv");
    expect(result!.message).toContain("auto-commit");
  });

  it("extracts file paths from git status lines correctly", () => {
    const result = buildAutoCommitArgs(
      [" M file.md", "?? new-file.yaml", "A  staged.ts"],
      [],
    );
    expect(result).not.toBeNull();
    expect(result!.files).toEqual(["file.md", "new-file.yaml", "staged.ts"]);
  });

  it("includes orphan count in commit message", () => {
    const result = buildAutoCommitArgs(
      [" M a.md", " M b.md", "?? c.yaml"],
      [],
    );
    expect(result).not.toBeNull();
    expect(result!.message).toContain("3");
  });

  it("handles mixed orphaned and expected files", () => {
    const result = buildAutoCommitArgs(
      [
        " M projects/youji/README.md",        // orphaned (modified tracked file)
        "?? node_modules/foo",                  // expected (always-expected pattern)
        "?? projects/sample-project/experiments/old-exp/data.csv", // orphaned (inactive exp)
      ],
      [],
    );
    expect(result).not.toBeNull();
    expect(result!.files).toHaveLength(2);
    expect(result!.files).toContain("projects/youji/README.md");
    expect(result!.files).toContain("projects/sample-project/experiments/old-exp/data.csv");
  });

  it("skips files inside active experiment directories", () => {
    const result = buildAutoCommitArgs(
      [
        "?? projects/sample-project/experiments/active-exp/results/out.csv",
        "?? projects/sample-project/experiments/active-exp/progress.json",
      ],
      ["projects/sample-project/experiments/active-exp"],
    );
    expect(result).toBeNull();
  });

  it("handles renamed files (-> syntax)", () => {
    const result = buildAutoCommitArgs(
      ["R  old-name.md -> new-name.md"],
      [],
    );
    expect(result).not.toBeNull();
    expect(result!.files).toContain("new-name.md");
  });

  it("excludes modified tracked files inside active experiment dirs", () => {
    const result = buildAutoCommitArgs(
      [
        " M projects/sample-project/experiments/running-exp/results/mesh.csv",
        " M projects/youji/README.md",
      ],
      ["projects/sample-project/experiments/running-exp"],
    );
    expect(result).not.toBeNull();
    // Only the README should be committed, not the active experiment CSV
    expect(result!.files).toEqual(["projects/youji/README.md"]);
    expect(result!.message).toContain("1");
  });

  it("returns null when all files are inside active experiment dirs", () => {
    const result = buildAutoCommitArgs(
      [
        " M projects/sample-project/experiments/running-exp/results/mesh.csv",
        "A  projects/sample-project/experiments/running-exp/output.log",
      ],
      ["projects/sample-project/experiments/running-exp"],
    );
    expect(result).toBeNull();
  });
});

describe("shouldSkipForCooldown", () => {
  const FIVE_MIN = DEFAULT_COOLDOWN_MS; // 300_000ms

  it("does not skip when no prior commit exists (lastCommitMs=0)", () => {
    expect(shouldSkipForCooldown(1, Date.now(), 0)).toBe(false);
  });

  it("does not skip when cooldown has expired", () => {
    const now = Date.now();
    const lastCommit = now - FIVE_MIN - 1; // 5min + 1ms ago
    expect(shouldSkipForCooldown(1, now, lastCommit)).toBe(false);
  });

  it("skips when within cooldown and fewer than min files", () => {
    const now = Date.now();
    const lastCommit = now - 60_000; // 1 minute ago
    expect(shouldSkipForCooldown(2, now, lastCommit)).toBe(true);
    expect(shouldSkipForCooldown(1, now, lastCommit)).toBe(true);
  });

  it("does not skip when file count meets bypass threshold", () => {
    const now = Date.now();
    const lastCommit = now - 60_000; // 1 minute ago, within cooldown
    expect(shouldSkipForCooldown(3, now, lastCommit)).toBe(false);
    expect(shouldSkipForCooldown(10, now, lastCommit)).toBe(false);
  });

  it("respects custom cooldown duration", () => {
    const now = Date.now();
    const lastCommit = now - 120_000; // 2 minutes ago
    // With 1-minute cooldown, 2 minutes ago is outside cooldown
    expect(shouldSkipForCooldown(1, now, lastCommit, 60_000)).toBe(false);
    // With 3-minute cooldown, 2 minutes ago is still inside
    expect(shouldSkipForCooldown(1, now, lastCommit, 180_000)).toBe(true);
  });

  it("respects custom min files threshold", () => {
    const now = Date.now();
    const lastCommit = now - 60_000; // within default cooldown
    // minFilesToBypass=2: 2 files should bypass
    expect(shouldSkipForCooldown(2, now, lastCommit, FIVE_MIN, 2)).toBe(false);
    // minFilesToBypass=5: 2 files should NOT bypass
    expect(shouldSkipForCooldown(2, now, lastCommit, FIVE_MIN, 5)).toBe(true);
  });

  it("does not skip at exact cooldown boundary", () => {
    const now = Date.now();
    const lastCommit = now - FIVE_MIN; // exactly at boundary
    expect(shouldSkipForCooldown(1, now, lastCommit)).toBe(false);
  });

  it("exports expected default values", () => {
    expect(DEFAULT_COOLDOWN_MS).toBe(300_000);
    expect(DEFAULT_MIN_FILES_TO_BYPASS).toBe(3);
  });
});

describe("collectActiveSessionIds", () => {
  const createSession = (id: string): SessionInfo => ({
    id,
    jobId: `job-${id}`,
    jobName: "test-job",
    sessionId: id,
    startedAtMs: Date.now(),
    elapsedMs: 0,
  });

  it("returns empty array when no sessions provided", () => {
    expect(collectActiveSessionIds([])).toEqual([]);
  });

  it("extracts session IDs from active sessions", () => {
    const sessions = [createSession("session-1"), createSession("session-2")];
    expect(collectActiveSessionIds(sessions)).toEqual(["session-1", "session-2"]);
  });

  it("excludes specified session ID", () => {
    const sessions = [createSession("session-1"), createSession("session-2"), createSession("session-3")];
    expect(collectActiveSessionIds(sessions, "session-2")).toEqual(["session-1", "session-3"]);
  });

  it("filters out sessions with null sessionId", () => {
    const sessions: SessionInfo[] = [
      { id: "a", jobId: "j1", jobName: "test", sessionId: "session-1", startedAtMs: 0, elapsedMs: 0 },
      { id: "b", jobId: "j2", jobName: "test", sessionId: null, startedAtMs: 0, elapsedMs: 0 },
      { id: "c", jobId: "j3", jobName: "test", sessionId: "session-2", startedAtMs: 0, elapsedMs: 0 },
    ];
    expect(collectActiveSessionIds(sessions)).toEqual(["session-1", "session-2"]);
  });
});

describe("formatProvenanceMessage", () => {
  it("returns empty string for empty provenance", () => {
    const provenance: OrphanProvenance = {
      activeSessionIds: [],
      fileTimestamps: new Map(),
    };
    expect(formatProvenanceMessage(provenance)).toBe("");
  });

  it("includes active session IDs", () => {
    const provenance: OrphanProvenance = {
      activeSessionIds: ["session-1", "session-2"],
      fileTimestamps: new Map(),
    };
    const result = formatProvenanceMessage(provenance);
    expect(result).toContain("Active sessions: session-1, session-2");
  });

  it("includes triggering session ID", () => {
    const provenance: OrphanProvenance = {
      triggeringSessionId: "trigger-session",
      activeSessionIds: [],
      fileTimestamps: new Map(),
    };
    const result = formatProvenanceMessage(provenance);
    expect(result).toContain("Triggering session: trigger-session");
  });

  it("includes file timeline when files present", () => {
    const timestamps = new Map<string, { created?: number; modified: number }>();
    timestamps.set("file1.md", { modified: 1709500000000 });
    timestamps.set("file2.md", { modified: 1709600000000 });
    const provenance: OrphanProvenance = {
      activeSessionIds: [],
      fileTimestamps: timestamps,
    };
    const result = formatProvenanceMessage(provenance);
    expect(result).toContain("File timeline:");
    expect(result).toContain("to");
  });

  it("combines all provenance fields", () => {
    const timestamps = new Map<string, { created?: number; modified: number }>();
    timestamps.set("test.md", { modified: Date.now() });
    const provenance: OrphanProvenance = {
      triggeringSessionId: "trigger",
      activeSessionIds: ["active-1", "active-2"],
      fileTimestamps: timestamps,
    };
    const result = formatProvenanceMessage(provenance);
    expect(result).toContain("Active sessions: active-1, active-2");
    expect(result).toContain("Triggering session: trigger");
    expect(result).toContain("File timeline:");
  });
});

describe("buildAutoCommitArgs with provenance", () => {
  it("includes provenance in commit message when provided", () => {
    const timestamps = new Map<string, { created?: number; modified: number }>();
    timestamps.set("test.md", { modified: Date.now() });
    const provenance: OrphanProvenance = {
      triggeringSessionId: "session-123",
      activeSessionIds: ["session-456"],
      fileTimestamps: timestamps,
    };
    const result = buildAutoCommitArgs([" M test.md"], [], provenance);
    expect(result).not.toBeNull();
    expect(result!.message).toContain("Active sessions: session-456");
    expect(result!.message).toContain("Triggering session: session-123");
    expect(result!.message).toContain("File timeline:");
  });

  it("works without provenance (backward compatible)", () => {
    const result = buildAutoCommitArgs([" M test.md"], []);
    expect(result).not.toBeNull();
    expect(result!.message).toContain("auto-commit");
    expect(result!.message).not.toContain("Active sessions");
  });
});
