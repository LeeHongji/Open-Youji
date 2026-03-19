/** Tests for autoFixExperiment — experiment-level autofix with relaunch. */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock external dependencies before importing the module under test
vi.mock("./agent.js", () => ({
  spawnAgent: vi.fn(),
  AGENT_PROFILES: {
    autofix: { model: "opus", maxTurns: 32, maxDurationMs: 600_000, label: "autofix" },
    deepWork: { model: "opus", maxTurns: 256, maxDurationMs: 1200_000, label: "deep-work" },
  },
  resolveProfileForBackend: vi.fn((profile: unknown) => profile),
  summarizeToolUses: vi.fn(() => []),
  createToolBatchFlusher: vi.fn(() => ({
    push: vi.fn(),
    flush: vi.fn(async () => {}),
  })),
}));

vi.mock("./experiments.js", () => ({
  launchExperiment: vi.fn(),
  trackExperiment: vi.fn(),
}));

vi.mock("./metrics.js", () => ({
  recordInteraction: vi.fn(async () => {}),
}));

vi.mock("./security.js", () => ({
  validateShellCommand: vi.fn(),
  validateCommand: vi.fn(),
  SecurityError: class SecurityError extends Error {},
}));

vi.mock("./sleep-guard.js", () => ({
  SHELL_TOOL_NAMES: new Set(["Bash"]),
}));

import { autoFixExperiment } from "./event-agents.js";
import { spawnAgent } from "./agent.js";
import { launchExperiment, trackExperiment } from "./experiments.js";
import { recordInteraction } from "./metrics.js";

const mockedSpawnAgent = vi.mocked(spawnAgent);
const mockedLaunchExperiment = vi.mocked(launchExperiment);
const mockedTrackExperiment = vi.mocked(trackExperiment);
const mockedRecordInteraction = vi.mocked(recordInteraction);

function mockAgentFixed() {
  mockedSpawnAgent.mockReturnValue({
    sessionId: "autofix-test-123",
    handle: { interrupt: vi.fn(), backend: "claude" as never },
    result: Promise.resolve({
      text: "## Diagnosis\nFixed the config.\n## Action\nUpdated config.yaml.\n[AUTOFIX:fixed]",
      costUsd: 0.50,
      numTurns: 5,
      durationMs: 30_000,
      timedOut: false,
    }),
  });
}

describe("autoFixExperiment relaunch", () => {
  let tempDir: string;
  let experimentDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "youji-autofix-test-"));
    // Create a fake experiment dir structure: projects/<project>/experiments/<id>
    experimentDir = join(tempDir, "projects", "test-project", "experiments", "test-exp");
    await mkdir(experimentDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("passes watchCsv, total, and projectDir from progress.json to launchExperiment", async () => {
    // Write a progress.json with all the fields the runner would store
    await writeFile(
      join(experimentDir, "progress.json"),
      JSON.stringify({
        status: "failed",
        command: ["python3", "run_batch.py"],
        max_retries: 2,
        watch_csv: "/path/to/results.csv",
        total: 100,
        experiment_dir: experimentDir,
      }),
    );

    mockAgentFixed();
    mockedLaunchExperiment.mockResolvedValue({ pid: 42 });

    const messages: string[] = [];

    await autoFixExperiment({
      project: "test-project",
      expId: "test-exp",
      experimentDir,
      error: "Command failed",
      logTail: "some error output",
      repoDir: tempDir,
      onMessage: async (text) => { messages.push(text); },
    });

    // launchExperiment should have been called with all mandatory fields
    expect(mockedLaunchExperiment).toHaveBeenCalledOnce();
    const opts = mockedLaunchExperiment.mock.calls[0][0];
    expect(opts.experimentDir).toBe(experimentDir);
    expect(opts.command).toEqual(["python3", "run_batch.py"]);
    expect(opts.maxRetries).toBe(2);
    expect(opts.watchCsv).toBe("/path/to/results.csv");
    expect(opts.total).toBe(100);
    // projectDir should be derived from experimentDir path structure
    expect(opts.projectDir).toMatch(/projects\/test-project$/);
  });

  it("derives projectDir from experimentDir when not in progress.json", async () => {
    await writeFile(
      join(experimentDir, "progress.json"),
      JSON.stringify({
        status: "failed",
        command: ["bash", "run.sh"],
        max_retries: 1,
        // No project_dir, watch_csv, or total
      }),
    );

    mockAgentFixed();
    mockedLaunchExperiment.mockResolvedValue({ pid: 99 });

    await autoFixExperiment({
      project: "test-project",
      expId: "test-exp",
      experimentDir,
      error: "Exit code 1",
      logTail: "",
      repoDir: tempDir,
      onMessage: async () => {},
    });

    expect(mockedLaunchExperiment).toHaveBeenCalledOnce();
    const opts = mockedLaunchExperiment.mock.calls[0][0];
    // projectDir should still be derived even without progress.json field
    expect(opts.projectDir).toMatch(/projects\/test-project$/);
  });

  it("reports successful relaunch with PID", async () => {
    await writeFile(
      join(experimentDir, "progress.json"),
      JSON.stringify({
        status: "failed",
        command: ["python3", "run.py"],
        max_retries: 0,
      }),
    );

    mockAgentFixed();
    mockedLaunchExperiment.mockResolvedValue({ pid: 12345 });

    const messages: string[] = [];

    await autoFixExperiment({
      project: "test-project",
      expId: "test-exp",
      experimentDir,
      error: "Crash",
      logTail: "",
      repoDir: tempDir,
      onMessage: async (text) => { messages.push(text); },
    });

    expect(messages.some((m) => m.includes("PID 12345"))).toBe(true);
    expect(messages.some((m) => m.includes("Re-launched"))).toBe(true);
    expect(mockedTrackExperiment).toHaveBeenCalledOnce();
  });
});
