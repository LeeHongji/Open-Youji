/** Tests for experiment tracking: registerExperiment API, discovery blind spot fix, and shell command normalization. */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  trackExperiment,
  setNewExperimentCallback,
  startExperimentWatcher,
  stopExperimentWatcher,
  normalizeShellCommand,
  type ExperimentEvent,
} from "./experiments.js";

const TEST_DIR = join(tmpdir(), `experiments-test-${Date.now()}`);

describe("trackExperiment", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    stopExperimentWatcher();
  });

  afterEach(async () => {
    stopExperimentWatcher();
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("registered experiment receives completion event via fast polling", async () => {
    // Set up an experiment directory with a "running" progress.json
    const expDir = join(TEST_DIR, "projects", "test-proj", "experiments", "test-exp");
    await mkdir(expDir, { recursive: true });
    await writeFile(
      join(expDir, "progress.json"),
      JSON.stringify({
        status: "running",
        pid: process.pid, // use our own PID so it appears alive
        started_at: new Date().toISOString(),
      }),
    );

    const events: ExperimentEvent[] = [];
    startExperimentWatcher((e) => events.push(e), undefined, TEST_DIR);

    // Register the experiment — this should enable fast 10s polling
    trackExperiment(expDir, "test-proj", "test-exp");

    // Now mark the experiment as completed
    await writeFile(
      join(expDir, "progress.json"),
      JSON.stringify({
        status: "completed",
        finished_at: new Date().toISOString(),
        duration_s: 5,
      }),
    );

    // Wait for the fast poll to pick it up (10s interval, give it 15s)
    await new Promise((r) => setTimeout(r, 15_000));

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].project).toBe("test-proj");
    expect(events[0].id).toBe("test-exp");
    expect(events[0].status).toBe("completed");
  }, 20_000);
});

describe("discovery RECENT_MS vs interval", () => {
  it("RECENT_MS should exceed the discovery interval to prevent blind spots", async () => {
    // The discovery runs every DISCOVERY_EVERY_N_POLLS * SLOW_INTERVAL_MS.
    // RECENT_MS must be >= this value to avoid missing fast-failing experiments.
    // We verify this by importing the constants. Since they're not exported,
    // we test the behavior: an experiment that finished 5 minutes ago should
    // still be discovered.

    const expDir = join(TEST_DIR, "projects", "timing-proj", "experiments", "timing-exp");
    await mkdir(expDir, { recursive: true });

    // Experiment finished 5 minutes ago — previously this was in the blind spot
    const finishedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await writeFile(
      join(expDir, "progress.json"),
      JSON.stringify({
        status: "failed",
        finished_at: finishedAt,
        error: "command not found",
        exit_code: 127,
      }),
    );

    const events: ExperimentEvent[] = [];
    startExperimentWatcher((e) => events.push(e), undefined, TEST_DIR);

    // Wait a moment for the initial discovery scan
    await new Promise((r) => setTimeout(r, 500));

    // The experiment finished 5 min ago — with the fix (RECENT_MS = 7 min),
    // it should be discovered. With old code (RECENT_MS = 2 min), this would fail.
    expect(events.length).toBe(1);
    expect(events[0].project).toBe("timing-proj");
    expect(events[0].id).toBe("timing-exp");
    expect(events[0].status).toBe("failed");
  });
});

describe("newExperimentCallback", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    stopExperimentWatcher();
  });

  afterEach(async () => {
    stopExperimentWatcher();
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("fires with source=api when trackExperiment is called", () => {
    const notifications: Array<{ project: string; id: string; source: string }> = [];
    startExperimentWatcher(() => {}, undefined, TEST_DIR);
    setNewExperimentCallback((info) => notifications.push(info));

    trackExperiment("/fake/dir", "my-proj", "exp-1");

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toEqual({
      project: "my-proj",
      id: "exp-1",
      dir: "/fake/dir",
      source: "api",
    });
  });

  it("does not fire on duplicate trackExperiment calls", () => {
    const notifications: Array<{ project: string; id: string; source: string }> = [];
    startExperimentWatcher(() => {}, undefined, TEST_DIR);
    setNewExperimentCallback((info) => notifications.push(info));

    trackExperiment("/fake/dir", "my-proj", "exp-dup");
    trackExperiment("/fake/dir", "my-proj", "exp-dup");

    expect(notifications).toHaveLength(1);
  });

  it("fires with source=discovery when a running experiment is found on disk", async () => {
    const expDir = join(TEST_DIR, "projects", "disc-proj", "experiments", "disc-exp");
    await mkdir(expDir, { recursive: true });
    await writeFile(
      join(expDir, "progress.json"),
      JSON.stringify({
        status: "running",
        pid: process.pid,
        started_at: new Date().toISOString(),
      }),
    );

    const notifications: Array<{ project: string; id: string; source: string }> = [];
    setNewExperimentCallback((info) => notifications.push(info));
    startExperimentWatcher(() => {}, undefined, TEST_DIR);

    // Wait for initial discovery scan
    await new Promise((r) => setTimeout(r, 500));

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toEqual({
      project: "disc-proj",
      id: "disc-exp",
      dir: expDir,
      source: "discovery",
    });
  });
});

describe("normalizeShellCommand", () => {
  it("passes through simple argv commands unchanged", () => {
    expect(normalizeShellCommand(["./run.sh"])).toEqual(["./run.sh"]);
    expect(normalizeShellCommand(["python3", "script.py", "--flag"])).toEqual(["python3", "script.py", "--flag"]);
  });

  it("wraps commands with && operator in bash -c", () => {
    // This is the exact pattern that caused the incident:
    // "cd /path && export FOO=bar && python3 script.py" split on whitespace
    const cmd = ["cd", "/home/user/youji/projects/foo", "&&", "export", "SEDASHIM_ANYCALL_ENDPOINT=staging", "&&", "python3", "run.py"];
    const result = normalizeShellCommand(cmd);
    expect(result).toEqual(["bash", "-c", "cd /home/user/youji/projects/foo && export SEDASHIM_ANYCALL_ENDPOINT=staging && python3 run.py"]);
  });

  it("wraps commands starting with cd in bash -c", () => {
    const cmd = ["cd", "/some/path"];
    expect(normalizeShellCommand(cmd)).toEqual(["bash", "-c", "cd /some/path"]);
  });

  it("wraps commands starting with export in bash -c", () => {
    const cmd = ["export", "FOO=bar"];
    expect(normalizeShellCommand(cmd)).toEqual(["bash", "-c", "export FOO=bar"]);
  });

  it("wraps commands with pipe operator in bash -c", () => {
    const cmd = ["cat", "file.txt", "|", "grep", "pattern"];
    expect(normalizeShellCommand(cmd)).toEqual(["bash", "-c", "cat file.txt | grep pattern"]);
  });

  it("wraps commands with || operator in bash -c", () => {
    const cmd = ["./run.sh", "||", "echo", "failed"];
    expect(normalizeShellCommand(cmd)).toEqual(["bash", "-c", "./run.sh || echo failed"]);
  });

  it("wraps commands with semicolons in bash -c", () => {
    const cmd = ["echo", "hello", ";", "echo", "world"];
    expect(normalizeShellCommand(cmd)).toEqual(["bash", "-c", "echo hello ; echo world"]);
  });

  it("wraps commands with redirects in bash -c", () => {
    const cmd = ["echo", "hello", ">", "output.txt"];
    expect(normalizeShellCommand(cmd)).toEqual(["bash", "-c", "echo hello > output.txt"]);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeShellCommand([])).toEqual([]);
  });

  it("does not wrap bash -c commands that are already wrapped", () => {
    // If someone already passed ["bash", "-c", "cd /path && python3 run.py"],
    // we should not double-wrap it. "bash" is not a shell builtin or operator.
    const cmd = ["bash", "-c", "cd /path && python3 run.py"];
    expect(normalizeShellCommand(cmd)).toEqual(["bash", "-c", "cd /path && python3 run.py"]);
  });
});
