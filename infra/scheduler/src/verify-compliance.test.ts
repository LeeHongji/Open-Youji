/** Tests for Tier 1 convention checks and compliance verification in verify.ts. */

import { describe, it, expect } from "vitest";
import { classifyUncommittedFiles, checkPartialCompletionBan, checkFalseTaskCompletion, CODE_SIGNAL_PATTERNS, checkIncrementalCommits, checkLiteratureVerified, checkZeroTurnDurationViolation, ZERO_TURN_DURATION_THRESHOLD_MS, checkModelSelectionRationale, isL2Violation, checkRepoStaleness, verifySession, checkVisualArtifactViolation, checkActionableImplications, DIAGNOSIS_MD_RE, POSTMORTEM_MD_RE, ARCHITECTURE_MD_RE, SYNTHESIS_MD_RE, hasExampleWebappUIChanges, hasExampleWebappArtifacts } from "./verify.js";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// ── Orphaned file classification tests ────────────────────────────────────

describe("classifyUncommittedFiles", () => {
  it("classifies node_modules as expected", () => {
    const lines = ["?? node_modules/"];
    const result = classifyUncommittedFiles(lines);
    expect(result.orphaned).toEqual([]);
    expect(result.expected).toEqual(["?? node_modules/"]);
  });

  it("classifies render output directories as expected", () => {
    const lines = [
      "?? projects/sample-project/renders/model-b/003/",
      "?? projects/sample-project/renders/model-a/014/",
      "?? projects/sample-project/renders/model-c/006/",
    ];
    const result = classifyUncommittedFiles(lines);
    expect(result.orphaned).toEqual([]);
    expect(result.expected).toHaveLength(3);
  });

  it("classifies active experiment output as expected", () => {
    const lines = [
      "?? projects/sample-project/experiments/full-scale-flash-240/output.log",
      "?? projects/sample-project/experiments/full-scale-flash-240/results/",
      "?? projects/sample-project/experiments/full-scale-flash-240/progress.json",
      "?? projects/sample-project/experiments/full-scale-flash-240/canary.log",
      "?? projects/sample-project/experiments/full-scale-flash-240/runner_stderr.log",
      "?? projects/sample-project/experiments/full-scale-flash-240/.experiment.lock",
    ];
    const result = classifyUncommittedFiles(lines, [
      "projects/sample-project/experiments/full-scale-flash-240",
    ]);
    expect(result.orphaned).toEqual([]);
    expect(result.expected).toHaveLength(6);
  });

  it("classifies .failed-evolution.json as expected", () => {
    const lines = ["?? infra/scheduler/.failed-evolution.json"];
    const result = classifyUncommittedFiles(lines);
    expect(result.orphaned).toEqual([]);
    expect(result.expected).toEqual(["?? infra/scheduler/.failed-evolution.json"]);
  });

  it("classifies .scheduler/jobs.json as expected (scheduler state file)", () => {
    const lines = [" M .scheduler/jobs.json"];
    const result = classifyUncommittedFiles(lines);
    expect(result.orphaned).toEqual([]);
    expect(result.expected).toEqual([" M .scheduler/jobs.json"]);
  });

  it("classifies modified tracked files as orphaned", () => {
    const lines = [
      " M projects/youji/README.md",
      "M  projects/sample-project/analysis/results.md",
    ];
    const result = classifyUncommittedFiles(lines);
    expect(result.orphaned).toHaveLength(2);
    expect(result.expected).toEqual([]);
  });

  it("classifies untracked .md files outside active experiments as orphaned", () => {
    const lines = [
      "?? projects/youji/diagnosis/diagnosis-new-issue.md",
      "?? projects/sample-project/analysis/new-analysis.md",
    ];
    const result = classifyUncommittedFiles(lines);
    expect(result.orphaned).toHaveLength(2);
    expect(result.expected).toEqual([]);
  });

  it("classifies untracked .yaml files as orphaned", () => {
    const lines = ["?? projects/sample-project/ledger-backup.yaml"];
    const result = classifyUncommittedFiles(lines);
    expect(result.orphaned).toHaveLength(1);
    expect(result.expected).toEqual([]);
  });

  it("classifies untracked .py files as orphaned", () => {
    const lines = ["?? projects/sample-project/analysis/new-script.py"];
    const result = classifyUncommittedFiles(lines);
    expect(result.orphaned).toHaveLength(1);
    expect(result.expected).toEqual([]);
  });

  it("classifies untracked .ts files as orphaned", () => {
    const lines = ["?? infra/scheduler/src/new-module.ts"];
    const result = classifyUncommittedFiles(lines);
    expect(result.orphaned).toHaveLength(1);
    expect(result.expected).toEqual([]);
  });

  it("classifies untracked .json files outside expected paths as orphaned", () => {
    const lines = ["?? projects/youji/experiments/test/config.json"];
    const result = classifyUncommittedFiles(lines);
    expect(result.orphaned).toHaveLength(1);
    expect(result.expected).toEqual([]);
  });

  it("does not classify experiment output in non-active experiments as expected", () => {
    const lines = [
      "?? projects/sample-project/experiments/old-experiment/output.log",
      "?? projects/sample-project/experiments/old-experiment/results/",
    ];
    // No active experiments provided — these are orphaned
    const result = classifyUncommittedFiles(lines);
    expect(result.orphaned).toHaveLength(2);
    expect(result.expected).toEqual([]);
  });

  it("handles mixed orphaned and expected files correctly", () => {
    const lines = [
      "?? node_modules/",
      " M projects/youji/README.md",
      "?? projects/sample-project/renders/model-b/003/",
      "?? projects/youji/diagnosis/diagnosis-new.md",
      "?? infra/scheduler/.failed-evolution.json",
      "?? projects/sample-project/experiments/flash-240/output.log",
    ];
    const result = classifyUncommittedFiles(lines, [
      "projects/sample-project/experiments/flash-240",
    ]);
    expect(result.expected).toHaveLength(4); // node_modules, render, .failed-evolution, active experiment
    expect(result.orphaned).toHaveLength(2); // modified README, diagnosis file
  });

  it("returns empty arrays for empty input", () => {
    const result = classifyUncommittedFiles([]);
    expect(result.orphaned).toEqual([]);
    expect(result.expected).toEqual([]);
  });

  it("filters out empty strings", () => {
    const result = classifyUncommittedFiles(["", "  "]);
    expect(result.orphaned).toEqual([]);
    expect(result.expected).toEqual([]);
  });

  it("classifies untracked binary/image files as expected", () => {
    // Image files, model files, etc. are typically large artifacts, not orphaned work
    const lines = [
      "?? projects/sample-project/renders/output.png",
      "?? projects/sample-project/renders/model.glb",
    ];
    const result = classifyUncommittedFiles(lines);
    expect(result.expected).toHaveLength(2);
    expect(result.orphaned).toEqual([]);
  });

  it("classifies modified tracked files inside active experiment dirs as expected", () => {
    // A running experiment may modify a tracked CSV (e.g., session committed partial results,
    // experiment keeps appending). These should NOT be flagged as orphaned.
    const lines = [
      " M projects/sample-project/experiments/lighting-exp/results/mesh_baseline.csv",
      " M projects/sample-project/experiments/lighting-exp/results/mesh_normal.csv",
    ];
    const result = classifyUncommittedFiles(lines, [
      "projects/sample-project/experiments/lighting-exp",
    ]);
    expect(result.orphaned).toEqual([]);
    expect(result.expected).toHaveLength(2);
  });

  it("still classifies modified tracked files outside active experiment dirs as orphaned", () => {
    // Modified files in non-experiment paths or in non-active experiments remain orphaned
    const lines = [
      " M projects/youji/README.md",
      " M projects/sample-project/experiments/done-exp/results/out.csv",
    ];
    const result = classifyUncommittedFiles(lines, [
      "projects/sample-project/experiments/running-exp",
    ]);
    expect(result.orphaned).toHaveLength(2);
    expect(result.expected).toEqual([]);
  });

  it("classifies staged files inside active experiment dirs as expected", () => {
    // Staged (A, AM) files inside active experiment dirs should also be excluded
    const lines = [
      "A  projects/sample-project/experiments/running-exp/results/new-result.csv",
      "AM projects/sample-project/experiments/running-exp/output.log",
    ];
    const result = classifyUncommittedFiles(lines, [
      "projects/sample-project/experiments/running-exp",
    ]);
    expect(result.orphaned).toEqual([]);
    expect(result.expected).toHaveLength(2);
  });

  it("correctly parses paths with leading dots when status has leading space", () => {
    // Regression: git porcelain " M .scheduler/jobs.json" has a leading space in
    // the status code. If lines are trimmed before classification, the path extraction
    // (slice(3)) loses the leading dot, causing ".scheduler/jobs.json" to become
    // "scheduler/jobs.json" and miss the ALWAYS_EXPECTED_PATTERNS match.
    const lines = [" M .scheduler/jobs.json"];
    const result = classifyUncommittedFiles(lines);
    expect(result.orphaned).toEqual([]);
    expect(result.expected).toEqual([" M .scheduler/jobs.json"]);
  });

  it("handles mixed status codes with dot-prefixed paths correctly", () => {
    const lines = [
      " M .scheduler/jobs.json",
      " M .opensource-manifest.yaml",
      "?? .scheduler/metrics/new-file.json",
    ];
    const result = classifyUncommittedFiles(lines);
    expect(result.expected).toContain(" M .scheduler/jobs.json");
    // .opensource-manifest.yaml is a tracked work file, not in expected patterns
    expect(result.orphaned).toContain(" M .opensource-manifest.yaml");
    // .json has a work extension
    expect(result.orphaned).toContain("?? .scheduler/metrics/new-file.json");
  });

  it("classifies submodule directories under modules/ as expected", () => {
    const lines = [
      " M modules/example-service",
      " M modules/example-lib",
      "?? modules/new-module/",
    ];
    const result = classifyUncommittedFiles(lines);
    expect(result.orphaned).toEqual([]);
    expect(result.expected).toHaveLength(3);
  });
});

// ── Tier 1 convention checks (L2→L0 promotion) ─────────────────────────────

describe("checkPartialCompletionBan", () => {
  it("detects [x] with (partial) annotation in TASKS.md diff", () => {
    const diff = `diff --git a/projects/youji/TASKS.md b/projects/youji/TASKS.md
@@ -5 +5 @@
+  - [x] Implement feature X (partial)
`;
    const result = checkPartialCompletionBan(diff);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("partial");
  });

  it("detects (Partial) case-insensitive", () => {
    const diff = `diff --git a/projects/sample-project/TASKS.md b/projects/sample-project/TASKS.md
@@ -10 +10 @@
+  - [x] Run experiment (Partial — need 50 more)
`;
    const result = checkPartialCompletionBan(diff);
    expect(result).toHaveLength(1);
  });

  it("returns empty for normal task completion", () => {
    const diff = `diff --git a/projects/youji/TASKS.md b/projects/youji/TASKS.md
@@ -5 +5 @@
+  - [x] Implement feature X
`;
    const result = checkPartialCompletionBan(diff);
    expect(result).toHaveLength(0);
  });

  it("returns empty for non-TASKS.md files", () => {
    const diff = `diff --git a/projects/youji/README.md b/projects/youji/README.md
@@ -5 +5 @@
+  - [x] Completed task (partial)
`;
    const result = checkPartialCompletionBan(diff);
    expect(result).toHaveLength(0);
  });

  it("returns empty for empty diff", () => {
    const result = checkPartialCompletionBan("");
    expect(result).toHaveLength(0);
  });

  it("detects multiple violations in one diff", () => {
    const diff = `diff --git a/projects/youji/TASKS.md b/projects/youji/TASKS.md
@@ -5,2 +5,2 @@
+  - [x] Task A (partial)
+  - [x] Task B (partial — 50% done)
`;
    const result = checkPartialCompletionBan(diff);
    expect(result).toHaveLength(2);
  });
});

describe("checkFalseTaskCompletion", () => {
  it("flags [x] task with code signal when only .md files committed", () => {
    const diff = `diff --git a/projects/youji/TASKS.md b/projects/youji/TASKS.md
@@ -5 +5 @@
+  - [x] Add model coverage check to run_multi_trial.sh [fleet-eligible]
`;
    const changedFiles = [
      "projects/youji/TASKS.md",
      "projects/youji/README.md",
    ];
    const result = checkFalseTaskCompletion(diff, changedFiles);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("D1");
    expect(result[0]).toContain(".sh");
  });

  it("returns empty when non-.md files are committed", () => {
    const diff = `diff --git a/projects/youji/TASKS.md b/projects/youji/TASKS.md
@@ -5 +5 @@
+  - [x] Implement pipeline in src/pipeline.py [fleet-eligible]
`;
    const changedFiles = [
      "projects/youji/TASKS.md",
      "src/pipeline.py",
    ];
    const result = checkFalseTaskCompletion(diff, changedFiles);
    expect(result).toHaveLength(0);
  });

  it("returns empty for documentation-only tasks completed with .md files", () => {
    const diff = `diff --git a/projects/youji/TASKS.md b/projects/youji/TASKS.md
@@ -5 +5 @@
+  - [x] Archive completed tasks from youji TASKS.md [fleet-eligible] [zero-resource]
`;
    const changedFiles = [
      "projects/youji/TASKS.md",
      "projects/youji/completed-tasks.md",
    ];
    const result = checkFalseTaskCompletion(diff, changedFiles);
    expect(result).toHaveLength(0);
  });

  it("returns empty for non-TASKS.md files", () => {
    const diff = `diff --git a/projects/youji/README.md b/projects/youji/README.md
@@ -5 +5 @@
+  - [x] Fix verify.ts bug
`;
    const changedFiles = ["projects/youji/README.md"];
    const result = checkFalseTaskCompletion(diff, changedFiles);
    expect(result).toHaveLength(0);
  });

  it("returns empty for empty diff", () => {
    const result = checkFalseTaskCompletion("", []);
    expect(result).toHaveLength(0);
  });

  it("returns empty when changedFiles is empty", () => {
    const diff = `diff --git a/projects/youji/TASKS.md b/projects/youji/TASKS.md
@@ -5 +5 @@
+  - [x] Write script.py [fleet-eligible]
`;
    const result = checkFalseTaskCompletion(diff, []);
    expect(result).toHaveLength(0);
  });

  it("detects multiple false completions in one diff", () => {
    const diff = `diff --git a/projects/youji/TASKS.md b/projects/youji/TASKS.md
@@ -5,2 +5,2 @@
+  - [x] Implement feature in handler.ts
+  - [x] Write test script for pipeline.py
`;
    const changedFiles = ["projects/youji/TASKS.md", "projects/youji/README.md"];
    const result = checkFalseTaskCompletion(diff, changedFiles);
    expect(result).toHaveLength(2);
  });

  it("detects code signals: .py, .ts, .sh extensions", () => {
    for (const ext of [".py", ".ts", ".sh"]) {
      const diff = `diff --git a/projects/p/TASKS.md b/projects/p/TASKS.md
@@ -1 +1 @@
+  - [x] Fix bug in file${ext} [fleet-eligible]
`;
      const result = checkFalseTaskCompletion(diff, ["projects/p/TASKS.md"]);
      expect(result).toHaveLength(1);
    }
  });

  it("detects code signals: implement, script, function, pipeline, endpoint", () => {
    const keywords = ["Implement the feature", "Write a script", "Add function to module", "Build pipeline", "Create endpoint"];
    for (const kw of keywords) {
      const diff = `diff --git a/projects/p/TASKS.md b/projects/p/TASKS.md
@@ -1 +1 @@
+  - [x] ${kw} [fleet-eligible]
`;
      const result = checkFalseTaskCompletion(diff, ["projects/p/TASKS.md"]);
      expect(result.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("does not flag tasks without code signals", () => {
    const tasks = [
      "Run /self-audit on project",
      "Archive completed tasks",
      "Update status documentation",
      "Analyze experiment results",
      "Document findings in README",
    ];
    for (const task of tasks) {
      const diff = `diff --git a/projects/p/TASKS.md b/projects/p/TASKS.md
@@ -1 +1 @@
+  - [x] ${task} [fleet-eligible]
`;
      const result = checkFalseTaskCompletion(diff, ["projects/p/TASKS.md"]);
      expect(result).toHaveLength(0);
    }
  });
});

describe("CODE_SIGNAL_PATTERNS", () => {
  it("matches file extensions", () => {
    expect(CODE_SIGNAL_PATTERNS.some((p) => p.test("fix bug in handler.ts"))).toBe(true);
    expect(CODE_SIGNAL_PATTERNS.some((p) => p.test("update run_benchmark.py"))).toBe(true);
    expect(CODE_SIGNAL_PATTERNS.some((p) => p.test("modify run.sh"))).toBe(true);
  });

  it("does not match .md extension", () => {
    expect(CODE_SIGNAL_PATTERNS.some((p) => p.test("update README.md"))).toBe(false);
  });
});

describe("checkIncrementalCommits", () => {
  it("warns when 10+ files changed with only 1 agent commit", () => {
    const result = checkIncrementalCommits(12, 1);
    expect(result).not.toBeNull();
    expect(result).toContain("12");
  });

  it("does not warn for fewer than 10 file changes", () => {
    const result = checkIncrementalCommits(9, 1);
    expect(result).toBeNull();
  });

  it("does not warn when there are multiple commits", () => {
    const result = checkIncrementalCommits(15, 2);
    expect(result).toBeNull();
  });

  it("does not warn for 0 files changed", () => {
    const result = checkIncrementalCommits(0, 0);
    expect(result).toBeNull();
  });

  it("warns for exactly 10 files with 1 commit", () => {
    const result = checkIncrementalCommits(10, 1);
    expect(result).not.toBeNull();
  });
});

describe("checkLiteratureVerified", () => {
  it("detects literature note without Verified field", () => {
    const content = `# Paper Title

Citation: Author, Title, Venue, 2024
URL/DOI: https://example.com/paper

## Key claims
- "Quote" (p. 5) — context
`;
    const result = checkLiteratureVerified(content);
    expect(result).toBe(false);
  });

  it("accepts literature note with Verified: YYYY-MM-DD", () => {
    const content = `# Paper Title

Citation: Author, Title, Venue, 2024
URL/DOI: https://example.com/paper
Verified: 2026-02-26

## Key claims
- "Quote" (p. 5) — context
`;
    const result = checkLiteratureVerified(content);
    expect(result).toBe(true);
  });

  it("accepts literature note with Verified: false", () => {
    const content = `# Paper Title

Citation: Author, Title, Venue, 2024
URL/DOI: https://example.com/paper
Verified: false

## Key claims
- "Quote" (p. 5) — context
`;
    const result = checkLiteratureVerified(content);
    expect(result).toBe(true);
  });

  it("returns true for content without Citation (not a literature note)", () => {
    const content = `# Some README

Just regular documentation.
`;
    const result = checkLiteratureVerified(content);
    expect(result).toBe(true);
  });

  it("returns true for empty content", () => {
    const result = checkLiteratureVerified("");
    expect(result).toBe(true);
  });
});

describe("checkZeroTurnDurationViolation", () => {
  it("returns true for 0 turns and duration > 60s", () => {
    const result = checkZeroTurnDurationViolation(0, 61_000);
    expect(result).toBe(true);
  });

  it("returns true for 0 turns and duration exactly 60s + 1ms", () => {
    const result = checkZeroTurnDurationViolation(0, 60_001);
    expect(result).toBe(true);
  });

  it("returns false for 0 turns and duration exactly 60s", () => {
    const result = checkZeroTurnDurationViolation(0, 60_000);
    expect(result).toBe(false);
  });

  it("returns false for 0 turns and duration < 60s", () => {
    const result = checkZeroTurnDurationViolation(0, 59_000);
    expect(result).toBe(false);
  });

  it("returns false for 1 turn even with long duration", () => {
    const result = checkZeroTurnDurationViolation(1, 120_000);
    expect(result).toBe(false);
  });

  it("returns false for null numTurns", () => {
    const result = checkZeroTurnDurationViolation(null, 120_000);
    expect(result).toBe(false);
  });

  it("returns false for undefined numTurns", () => {
    const result = checkZeroTurnDurationViolation(undefined, 120_000);
    expect(result).toBe(false);
  });

  it("returns false for null durationMs", () => {
    const result = checkZeroTurnDurationViolation(0, null);
    expect(result).toBe(false);
  });

  it("returns false for undefined durationMs", () => {
    const result = checkZeroTurnDurationViolation(0, undefined);
    expect(result).toBe(false);
  });
});

describe("checkModelSelectionRationale", () => {
  it("detects script with LLM API import but no rationale in EXPERIMENT.md", () => {
    const scriptContent = `import openai
from anthropic import Anthropic
client = openai.OpenAI()
`;
    const experimentContent = `---
id: test-exp
status: running
---
## Design
Test experiment.

## Config
Parameter: value
`;
    const result = checkModelSelectionRationale(scriptContent, experimentContent);
    expect(result).toBe(false);
  });

  it("accepts script with LLM API import and model selection rationale", () => {
    const scriptContent = `import openai
client = openai.OpenAI()
`;
    const experimentContent = `---
id: test-exp
status: running
---
## Design
Test experiment.

## Config
Model: gemini-3-flash-preview selected per Model Selection Guide — best VLM judge.
`;
    const result = checkModelSelectionRationale(scriptContent, experimentContent);
    expect(result).toBe(true);
  });

  it("accepts script without LLM API imports", () => {
    const scriptContent = `import os
import json
data = json.load(open("file.json"))
`;
    const experimentContent = `---
id: test-exp
---
## Config
No model selection needed.
`;
    const result = checkModelSelectionRationale(scriptContent, experimentContent);
    expect(result).toBe(true);
  });

  it("detects cloudflare gateway URL as LLM usage", () => {
    const scriptContent = `CF_GATEWAY_URL = "https://gateway.ai.cloudflare.com"
response = requests.post(CF_GATEWAY_URL + "/compat/...")
`;
    const experimentContent = `---
id: test-exp
---
## Config
Just params.
`;
    const result = checkModelSelectionRationale(scriptContent, experimentContent);
    expect(result).toBe(false);
  });

  it("accepts script with model-capability-limits.md reference", () => {
    const scriptContent = `import openai
`;
    const experimentContent = `---
id: test-exp
---
## Config
Model selected per docs/model-capability-limits.md evaluation data.
`;
    const result = checkModelSelectionRationale(scriptContent, experimentContent);
    expect(result).toBe(true);
  });
});

describe("isL2Violation", () => {
  it.each([
    ["partial completion ban", "Partial completion ban violation: found [x] (partial)"],
    ["incremental commit", "Incremental commit violation: 10 files changed but only 1 agent commit(s)"],
    ["model provenance", "Model provenance missing: EXPERIMENT.md is completed with consumes_resources: true"],
    ["backend provenance", "Backend provenance missing: EXPERIMENT.md is completed with consumes_resources: true"],
    ["model line missing", "Model line missing in body: EXPERIMENT.md is completed with consumes_resources: true"],
    ["orphaned approval-needed tag", "Orphaned approval-needed tag: task has no matching pending entry"],
  ])("identifies %s as L2 violation", (_name, message) => {
    expect(isL2Violation(message)).toBe(true);
  });

  it.each([
    ["literature verification (L0)", "Literature verification violation (L0): paper.md is a new literature note"],
    ["model selection rationale (L0)", "Model selection rationale violation (L0): script.py uses LLM APIs"],
    ["fire-and-forget (L0)", "Fire-and-forget violation: EXPERIMENT.md has consumes_resources: true"],
    ["log entry (L0)", "Missing log entry violation (L0): Session made commits but no project README log entry detected."],
    ["session footer", "Incomplete session footer: missing Duration field"],
    ["budget ledger (L0)", "Budget ledger inconsistency: total exceeds limit"],
    ["uncommitted files (L0)", "3 uncommitted file(s) — L0 violation: sessions must commit all work before ending"],
    ["ledger violation (L0)", "Ledger violation: Resource-consuming work on project(s) test-project but no ledger entry found for today"],
  ])("rejects %s warnings (not L2)", (_name, message) => {
    expect(isL2Violation(message)).toBe(false);
  });
});

describe("checkStaleBlockedByTags", () => {
  it("detects stale blocked-by tags with dates", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "stale-blockedby-"));
    const projectsDir = join(tmpDir, "projects", "test-proj");
    await mkdir(projectsDir, { recursive: true });
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10);
    const dateStr = oldDate.toISOString().slice(0, 10);
    const tasksContent = `- [ ] Some task
  Why: Test task
  [blocked-by: external: some issue (${dateStr})]
`;
    await writeFile(join(projectsDir, "TASKS.md"), tasksContent);
    const result = await checkRepoStaleness(tmpDir);
    expect(result.some((w) => w.type === "stale_blocked_by")).toBe(true);
    await rm(tmpDir, { recursive: true });
  });

  it("ignores fresh blocked-by tags", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "stale-blockedby-"));
    const projectsDir = join(tmpDir, "projects", "test-proj");
    await mkdir(projectsDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const tasksContent = `- [ ] Some task
  Why: Test task
  [blocked-by: external: some issue (${today})]
`;
    await writeFile(join(projectsDir, "TASKS.md"), tasksContent);
    const result = await checkRepoStaleness(tmpDir);
    expect(result.some((w) => w.type === "stale_blocked_by")).toBe(false);
    await rm(tmpDir, { recursive: true });
  });

  it("ignores blocked-by tags without dates", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "stale-blockedby-"));
    const projectsDir = join(tmpDir, "projects", "test-proj");
    await mkdir(projectsDir, { recursive: true });
    const tasksContent = `- [ ] Some task
  Why: Test task
  [blocked-by: some issue without date]
`;
    await writeFile(join(projectsDir, "TASKS.md"), tasksContent);
    const result = await checkRepoStaleness(tmpDir);
    expect(result.some((w) => w.type === "stale_blocked_by")).toBe(false);
    await rm(tmpDir, { recursive: true });
  });
});

// ── Sleep violation post-session check tests ─────────────────────────────────

describe("verifySession sleep violation check", () => {
  it("flags sleep >30s in bashCommands as violation", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "verify-sleep-"));
    await mkdir(join(tmpDir, ".git"), { recursive: true });
    await writeFile(join(tmpDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(tmpDir, ".git", "config"), "[core]\nrepositoryFormatVersion = 0\n");
    const objectsDir = join(tmpDir, ".git", "objects");
    await mkdir(objectsDir, { recursive: true });
    const refsDir = join(tmpDir, ".git", "refs", "heads");
    await mkdir(refsDir, { recursive: true });
    const result = await verifySession(
      tmpDir,
      null,
      undefined,
      undefined,
      undefined,
      ["sleep 120", "echo 'hello'"],
    );
    expect(result.sleepViolation).toBe(true);
    expect(result.warnings.some((w) => w.includes("Sleep violation") && w.includes("120s"))).toBe(true);
    await rm(tmpDir, { recursive: true });
  });

  it("ignores sleep <=30s", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "verify-sleep-ok-"));
    await mkdir(join(tmpDir, ".git"), { recursive: true });
    await writeFile(join(tmpDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(tmpDir, ".git", "config"), "[core]\nrepositoryFormatVersion = 0\n");
    const objectsDir = join(tmpDir, ".git", "objects");
    await mkdir(objectsDir, { recursive: true });
    const refsDir = join(tmpDir, ".git", "refs", "heads");
    await mkdir(refsDir, { recursive: true });
    const result = await verifySession(
      tmpDir,
      null,
      undefined,
      undefined,
      undefined,
      ["sleep 30", "sleep 10", "sleep 0.5m"],
    );
    expect(result.sleepViolation).toBe(false);
    expect(result.warnings.some((w) => w.includes("Sleep violation"))).toBe(false);
    await rm(tmpDir, { recursive: true });
  });

  it("handles empty bashCommands array", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "verify-sleep-empty-"));
    await mkdir(join(tmpDir, ".git"), { recursive: true });
    await writeFile(join(tmpDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(tmpDir, ".git", "config"), "[core]\nrepositoryFormatVersion = 0\n");
    const objectsDir = join(tmpDir, ".git", "objects");
    await mkdir(objectsDir, { recursive: true });
    const refsDir = join(tmpDir, ".git", "refs", "heads");
    await mkdir(refsDir, { recursive: true });
    const result = await verifySession(
      tmpDir,
      null,
      undefined,
      undefined,
      undefined,
      [],
    );
    expect(result.sleepViolation).toBe(false);
    await rm(tmpDir, { recursive: true });
  });

  it("handles undefined bashCommands", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "verify-sleep-undef-"));
    await mkdir(join(tmpDir, ".git"), { recursive: true });
    await writeFile(join(tmpDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(tmpDir, ".git", "config"), "[core]\nrepositoryFormatVersion = 0\n");
    const objectsDir = join(tmpDir, ".git", "objects");
    await mkdir(objectsDir, { recursive: true });
    const refsDir = join(tmpDir, ".git", "refs", "heads");
    await mkdir(refsDir, { recursive: true });
    const result = await verifySession(tmpDir, null);
    expect(result.sleepViolation).toBe(false);
    await rm(tmpDir, { recursive: true });
  });

  it("detects sleep with time suffixes (1m, 2h)", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "verify-sleep-suffix-"));
    await mkdir(join(tmpDir, ".git"), { recursive: true });
    await writeFile(join(tmpDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(tmpDir, ".git", "config"), "[core]\nrepositoryFormatVersion = 0\n");
    const objectsDir = join(tmpDir, ".git", "objects");
    await mkdir(objectsDir, { recursive: true });
    const refsDir = join(tmpDir, ".git", "refs", "heads");
    await mkdir(refsDir, { recursive: true });
    const result = await verifySession(
      tmpDir,
      null,
      undefined,
      undefined,
      undefined,
      ["sleep 1m", "sleep 2h"],
    );
    expect(result.sleepViolation).toBe(true);
    expect(result.warnings.some((w) => w.includes("60s") || w.includes("7200s"))).toBe(true);
    await rm(tmpDir, { recursive: true });
  });

  it("flags sleepViolationCommand parameter as L0 violation", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "verify-sleep-cmd-"));
    await mkdir(join(tmpDir, ".git"), { recursive: true });
    await writeFile(join(tmpDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(tmpDir, ".git", "config"), "[core]\nrepositoryFormatVersion = 0\n");
    const objectsDir = join(tmpDir, ".git", "objects");
    await mkdir(objectsDir, { recursive: true });
    const refsDir = join(tmpDir, ".git", "refs", "heads");
    await mkdir(refsDir, { recursive: true });
    const result = await verifySession(
      tmpDir,
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      "sleep 120",
    );
    expect(result.sleepViolation).toBe(true);
    expect(result.warnings.some((w) => w.includes("Sleep violation") && w.includes("120s"))).toBe(true);
    await rm(tmpDir, { recursive: true });
  });

  it("prioritizes sleepViolationCommand over bashCommands", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "verify-sleep-priority-"));
    await mkdir(join(tmpDir, ".git"), { recursive: true });
    await writeFile(join(tmpDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(tmpDir, ".git", "config"), "[core]\nrepositoryFormatVersion = 0\n");
    const objectsDir = join(tmpDir, ".git", "objects");
    await mkdir(objectsDir, { recursive: true });
    const refsDir = join(tmpDir, ".git", "refs", "heads");
    await mkdir(refsDir, { recursive: true });
    const result = await verifySession(
      tmpDir,
      null,
      undefined,
      undefined,
      undefined,
      ["sleep 10"],
      "sleep 60",
    );
    expect(result.sleepViolation).toBe(true);
    expect(result.warnings.some((w) => w.includes("60s") && !w.includes("10s"))).toBe(true);
    await rm(tmpDir, { recursive: true });
  });
});

// ── Stall violation (ADR 0017) ──────────────────────────────────────────────

describe("stallViolationCommand propagation", () => {
  it("records stallViolationCommand in VerificationResult when stallViolationCommand parameter is provided", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "verify-stall-cmd-"));
    await mkdir(join(tmpDir, ".git"), { recursive: true });
    await writeFile(join(tmpDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(tmpDir, ".git", "config"), "[core]\nrepositoryFormatVersion = 0\n");
    const objectsDir = join(tmpDir, ".git", "objects");
    await mkdir(objectsDir, { recursive: true });
    const refsDir = join(tmpDir, ".git", "refs", "heads");
    await mkdir(refsDir, { recursive: true });
    const stallCmd = "cd ~/youji && wc -l .scheduler/metrics/sessions.jsonl";
    const result = await verifySession(
      tmpDir,
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      stallCmd,
    );
    expect(result.stallViolation).toBe(true);
    expect(result.stallViolationCommand).toBe(stallCmd);
    expect(result.warnings.some((w) => w.includes("Stall violation") && w.includes("wc -l"))).toBe(true);
    await rm(tmpDir, { recursive: true });
  });

  it("does not set stallViolationCommand when parameter is undefined", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "verify-stall-none-"));
    await mkdir(join(tmpDir, ".git"), { recursive: true });
    await writeFile(join(tmpDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(tmpDir, ".git", "config"), "[core]\nrepositoryFormatVersion = 0\n");
    const objectsDir = join(tmpDir, ".git", "objects");
    await mkdir(objectsDir, { recursive: true });
    const refsDir = join(tmpDir, ".git", "refs", "heads");
    await mkdir(refsDir, { recursive: true });
    const result = await verifySession(tmpDir, null);
    expect(result.stallViolation).toBe(false);
    expect(result.stallViolationCommand).toBeUndefined();
    await rm(tmpDir, { recursive: true });
  });
});

// ── Visual artifact enforcement (ADR 0057) ─────────────────────────────────

describe("checkVisualArtifactViolation", () => {
  it("detects UI file changes without screenshot artifacts", () => {
    const changedFiles = [
      "modules/example-webapp/server/templates/rubric_launcher.html",
      "projects/bench-project/TASKS.md",
    ];
    const result = checkVisualArtifactViolation(changedFiles);
    expect(result.violation).toBe(true);
    expect(result.uiFiles).toHaveLength(1);
    expect(result.uiFiles[0]).toContain(".html");
  });

  it("accepts UI file changes when screenshots are committed", () => {
    const changedFiles = [
      "modules/example-webapp/server/templates/rubric_launcher.html",
      "modules/example-webapp/server/static/css/rubric.css",
      "projects/bench-project/artifacts/rubric-ui-screenshots/rubric-launcher.png",
    ];
    const result = checkVisualArtifactViolation(changedFiles);
    expect(result.violation).toBe(false);
    expect(result.uiFiles).toHaveLength(2);
  });

  it("returns no violation when no UI files are changed", () => {
    const changedFiles = [
      "projects/youji/README.md",
      "projects/youji/TASKS.md",
      "infra/scheduler/src/verify.ts",
    ];
    const result = checkVisualArtifactViolation(changedFiles);
    expect(result.violation).toBe(false);
    expect(result.uiFiles).toHaveLength(0);
  });

  it("detects CSS file changes", () => {
    const changedFiles = ["server/static/css/style.css"];
    const result = checkVisualArtifactViolation(changedFiles);
    expect(result.violation).toBe(true);
    expect(result.uiFiles).toHaveLength(1);
  });

  it("detects SCSS file changes", () => {
    const changedFiles = ["src/components/Button.scss"];
    const result = checkVisualArtifactViolation(changedFiles);
    expect(result.violation).toBe(true);
    expect(result.uiFiles).toHaveLength(1);
  });

  it("detects JSX and TSX file changes", () => {
    const changedFiles = [
      "src/components/Header.tsx",
      "src/views/Dashboard.jsx",
    ];
    const result = checkVisualArtifactViolation(changedFiles);
    expect(result.violation).toBe(true);
    expect(result.uiFiles).toHaveLength(2);
  });

  it("detects Jinja template changes", () => {
    const changedFiles = ["server/templates/index.jinja2"];
    const result = checkVisualArtifactViolation(changedFiles);
    expect(result.violation).toBe(true);
    expect(result.uiFiles).toHaveLength(1);
  });

  it("detects JS files in UI-specific directories", () => {
    const changedFiles = [
      "server/static/js/app.js",
      "server/templates/partials/helper.js",
    ];
    const result = checkVisualArtifactViolation(changedFiles);
    expect(result.violation).toBe(true);
    expect(result.uiFiles).toHaveLength(2);
  });

  it("does not flag JS files outside UI directories", () => {
    const changedFiles = [
      "infra/scheduler/src/verify.ts",
      "scripts/analyze.js",
    ];
    const result = checkVisualArtifactViolation(changedFiles);
    expect(result.violation).toBe(false);
    expect(result.uiFiles).toHaveLength(0);
  });

  it("accepts WebP screenshots as valid artifacts", () => {
    const changedFiles = [
      "src/components/Form.tsx",
      "artifacts/screenshots/form-view.webp",
    ];
    const result = checkVisualArtifactViolation(changedFiles);
    expect(result.violation).toBe(false);
  });

  it("accepts JPEG screenshots as valid artifacts", () => {
    const changedFiles = [
      "pages/login.html",
      "tests/artifacts/login/golden/screenshot.jpg",
    ];
    const result = checkVisualArtifactViolation(changedFiles);
    expect(result.violation).toBe(false);
  });

  it("returns empty arrays for empty input", () => {
    const result = checkVisualArtifactViolation([]);
    expect(result.violation).toBe(false);
    expect(result.uiFiles).toHaveLength(0);
  });

  it("detects Vue and Svelte component changes", () => {
    const changedFiles = ["src/components/App.vue", "src/routes/Home.svelte"];
    const result = checkVisualArtifactViolation(changedFiles);
    expect(result.violation).toBe(true);
    expect(result.uiFiles).toHaveLength(2);
  });

  it("detects Less stylesheet changes", () => {
    const changedFiles = ["styles/theme.less"];
    const result = checkVisualArtifactViolation(changedFiles);
    expect(result.violation).toBe(true);
    expect(result.uiFiles).toHaveLength(1);
  });

  it("detects TS files in component directories", () => {
    const changedFiles = ["src/components/utils/formatter.ts"];
    const result = checkVisualArtifactViolation(changedFiles);
    expect(result.violation).toBe(true);
    expect(result.uiFiles).toHaveLength(1);
  });

  it("detects TS files in pages directory", () => {
    const changedFiles = ["src/pages/admin/dashboard.ts"];
    const result = checkVisualArtifactViolation(changedFiles);
    expect(result.violation).toBe(true);
    expect(result.uiFiles).toHaveLength(1);
  });
});

describe("hasExampleWebappUIChanges", () => {
  it("detects template file changes in example-webapp", () => {
    const changedFiles = ["modules/example-webapp/templates/base.html"];
    expect(hasExampleWebappUIChanges(changedFiles)).toBe(true);
  });

  it("detects CSS file changes in example-webapp static", () => {
    const changedFiles = ["modules/example-webapp/static/css/rubric.css"];
    expect(hasExampleWebappUIChanges(changedFiles)).toBe(true);
  });

  it("detects JS file changes in example-webapp static", () => {
    const changedFiles = ["modules/example-webapp/static/js/app.js"];
    expect(hasExampleWebappUIChanges(changedFiles)).toBe(true);
  });

  it("returns false for non-example-webapp UI files", () => {
    const changedFiles = ["projects/foo/templates/index.html"];
    expect(hasExampleWebappUIChanges(changedFiles)).toBe(false);
  });

  it("returns false for non-UI files in example-webapp", () => {
    const changedFiles = ["modules/example-webapp/server/routes.py"];
    expect(hasExampleWebappUIChanges(changedFiles)).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(hasExampleWebappUIChanges([])).toBe(false);
  });
});

describe("hasExampleWebappArtifacts", () => {
  it("detects artifacts in tests/artifacts/", () => {
    const changedFiles = ["modules/example-webapp/tests/artifacts/rubric/golden/screenshot.png"];
    expect(hasExampleWebappArtifacts(changedFiles)).toBe(true);
  });

  it("detects artifacts in screenshots/", () => {
    const changedFiles = ["modules/example-webapp/screenshots/rubric-launcher.webp"];
    expect(hasExampleWebappArtifacts(changedFiles)).toBe(true);
  });

  it("returns false for artifacts outside artifact directories", () => {
    const changedFiles = ["modules/example-webapp/docs/images/screenshot.png"];
    expect(hasExampleWebappArtifacts(changedFiles)).toBe(false);
  });

  it("returns false for non-example-webapp artifacts", () => {
    const changedFiles = ["projects/foo/tests/artifacts/screenshot.png"];
    expect(hasExampleWebappArtifacts(changedFiles)).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(hasExampleWebappArtifacts([])).toBe(false);
  });
});

// ── Actionable implication task gate (ADR 0060) ─────────────────────────

describe("checkActionableImplications", () => {
  const makeExpDiff = (addedLines: string[]) => {
    const lines = [
      "diff --git a/projects/bench/experiments/exp-1/EXPERIMENT.md b/projects/bench/experiments/exp-1/EXPERIMENT.md",
      "--- a/projects/bench/experiments/exp-1/EXPERIMENT.md",
      "+++ b/projects/bench/experiments/exp-1/EXPERIMENT.md",
      "@@ -10,0 +11,5 @@",
      "+## Findings",
      ...addedLines.map((l) => `+${l}`),
    ];
    return lines.join("\n");
  };

  it("detects 'should use' in Findings without TASKS.md modification", () => {
    const diff = makeExpDiff(["Final paper tables should use multi-trial averages for all 7 skills."]);
    const changedFiles = ["projects/bench/experiments/exp-1/EXPERIMENT.md"];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("should use");
  });

  it("detects 'needs to' in Implications section", () => {
    const lines = [
      "diff --git a/projects/bench/experiments/exp-1/EXPERIMENT.md b/projects/bench/experiments/exp-1/EXPERIMENT.md",
      "--- a/projects/bench/experiments/exp-1/EXPERIMENT.md",
      "+++ b/projects/bench/experiments/exp-1/EXPERIMENT.md",
      "@@ -20,0 +21,3 @@",
      "+## Implications",
      "+The analysis needs to be extended to cover expansion skills.",
    ];
    const diff = lines.join("\n");
    const changedFiles = ["projects/bench/experiments/exp-1/EXPERIMENT.md"];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(1);
  });

  it("detects 'gap' keyword", () => {
    const diff = makeExpDiff(["There is a gap in coverage for expansion skills."]);
    const changedFiles = ["projects/bench/experiments/exp-1/EXPERIMENT.md"];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(1);
  });

  it("detects 'follow-up' keyword", () => {
    const diff = makeExpDiff(["A follow-up experiment is warranted."]);
    const changedFiles = ["projects/bench/experiments/exp-1/EXPERIMENT.md"];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(1);
  });

  it("passes when TASKS.md is also modified", () => {
    const diff = makeExpDiff(["Final paper tables should use multi-trial averages."]);
    const changedFiles = [
      "projects/bench/experiments/exp-1/EXPERIMENT.md",
      "projects/bench/TASKS.md",
    ];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(0);
  });

  it("passes when no EXPERIMENT.md is in changed files", () => {
    const diff = "diff --git a/README.md b/README.md\n+++ b/README.md\n+should use better metrics";
    const changedFiles = ["README.md"];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(0);
  });

  it("passes when findings have no actionable language", () => {
    const diff = makeExpDiff(["F1: Opus scored 84.5% overall (see analysis/scores.csv)."]);
    const changedFiles = ["projects/bench/experiments/exp-1/EXPERIMENT.md"];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(0);
  });

  it("only flags lines within Findings/Implications sections, not other sections", () => {
    const lines = [
      "diff --git a/projects/bench/experiments/exp-1/EXPERIMENT.md b/projects/bench/experiments/exp-1/EXPERIMENT.md",
      "--- a/projects/bench/experiments/exp-1/EXPERIMENT.md",
      "+++ b/projects/bench/experiments/exp-1/EXPERIMENT.md",
      "@@ -5,0 +6,4 @@",
      "+## Config",
      "+The model should use temperature 0.",
      "+## Findings",
      "+F1: Results are consistent across runs.",
    ];
    const diff = lines.join("\n");
    const changedFiles = ["projects/bench/experiments/exp-1/EXPERIMENT.md"];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(0);
  });

  it("reports at most one violation per file", () => {
    const diff = makeExpDiff([
      "This should be extended. There is a gap. Follow-up needed.",
      "The analysis needs to cover all skills.",
    ]);
    const changedFiles = ["projects/bench/experiments/exp-1/EXPERIMENT.md"];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(1);
  });

  // ── Diagnosis file tests ────────────────────────────────────────────────

  it("detects 'should' in diagnosis Recommendations section", () => {
    const lines = [
      "diff --git a/projects/test/diagnosis/diagnosis-bug-2026-03-01.md b/projects/test/diagnosis/diagnosis-bug-2026-03-01.md",
      "--- a/projects/test/diagnosis/diagnosis-bug-2026-03-01.md",
      "+++ b/projects/test/diagnosis/diagnosis-bug-2026-03-01.md",
      "@@ -20,0 +21,3 @@",
      "+## Recommendations",
      "+The system should use a retry mechanism for API calls.",
    ];
    const diff = lines.join("\n");
    const changedFiles = ["projects/test/diagnosis/diagnosis-bug-2026-03-01.md"];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("Recommendations/Next steps");
  });

  it("detects 'needs to' in diagnosis Next steps section", () => {
    const lines = [
      "diff --git a/projects/test/diagnosis/diagnosis-foo.md b/projects/test/diagnosis/diagnosis-foo.md",
      "--- a/projects/test/diagnosis/diagnosis-foo.md",
      "+++ b/projects/test/diagnosis/diagnosis-foo.md",
      "@@ -10,0 +11,3 @@",
      "+## Next steps",
      "+The investigation needs to be extended to cover edge cases.",
    ];
    const diff = lines.join("\n");
    const changedFiles = ["projects/test/diagnosis/diagnosis-foo.md"];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(1);
  });

  it("passes for diagnosis file without actionable language", () => {
    const lines = [
      "diff --git a/projects/test/diagnosis/diagnosis-ok.md b/projects/test/diagnosis/diagnosis-ok.md",
      "--- a/projects/test/diagnosis/diagnosis-ok.md",
      "+++ b/projects/test/diagnosis/diagnosis-ok.md",
      "@@ -10,0 +11,3 @@",
      "+## Recommendations",
      "+Root cause identified as race condition in worker threads.",
    ];
    const diff = lines.join("\n");
    const changedFiles = ["projects/test/diagnosis/diagnosis-ok.md"];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(0);
  });

  it("passes for diagnosis file when TASKS.md is also modified", () => {
    const lines = [
      "diff --git a/projects/test/diagnosis/diagnosis-bar.md b/projects/test/diagnosis/diagnosis-bar.md",
      "--- a/projects/test/diagnosis/diagnosis-bar.md",
      "+++ b/projects/test/diagnosis/diagnosis-bar.md",
      "@@ -10,0 +11,3 @@",
      "+## Recommendations",
      "+The system should implement exponential backoff.",
    ];
    const diff = lines.join("\n");
    const changedFiles = [
      "projects/test/diagnosis/diagnosis-bar.md",
      "projects/test/TASKS.md",
    ];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(0);
  });

  // ── Postmortem file tests ───────────────────────────────────────────────

  it("detects 'should' in postmortem Recommendations section", () => {
    const lines = [
      "diff --git a/projects/test/postmortem/postmortem-outage-2026-03-01.md b/projects/test/postmortem/postmortem-outage-2026-03-01.md",
      "--- a/projects/test/postmortem/postmortem-outage-2026-03-01.md",
      "+++ b/projects/test/postmortem/postmortem-outage-2026-03-01.md",
      "@@ -30,0 +31,3 @@",
      "+## Recommendations",
      "+We should add automated health monitoring for all services.",
    ];
    const diff = lines.join("\n");
    const changedFiles = ["projects/test/postmortem/postmortem-outage-2026-03-01.md"];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("Recommendations/Next steps");
  });

  it("detects 'gap' in postmortem Next steps section", () => {
    const lines = [
      "diff --git a/projects/test/postmortem/postmortem-incident.md b/projects/test/postmortem/postmortem-incident.md",
      "--- a/projects/test/postmortem/postmortem-incident.md",
      "+++ b/projects/test/postmortem/postmortem-incident.md",
      "@@ -15,0 +16,3 @@",
      "+## Next steps",
      "+There is a gap in our monitoring coverage for batch jobs.",
    ];
    const diff = lines.join("\n");
    const changedFiles = ["projects/test/postmortem/postmortem-incident.md"];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(1);
  });

  it("passes for postmortem file without actionable language", () => {
    const lines = [
      "diff --git a/projects/test/postmortem/postmortem-ok.md b/projects/test/postmortem/postmortem-ok.md",
      "--- a/projects/test/postmortem/postmortem-ok.md",
      "+++ b/projects/test/postmortem/postmortem-ok.md",
      "@@ -20,0 +21,3 @@",
      "+## Recommendations",
      "+Incident resolved by restarting the scheduler service.",
    ];
    const diff = lines.join("\n");
    const changedFiles = ["projects/test/postmortem/postmortem-ok.md"];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(0);
  });

  it("passes for postmortem file when TASKS.md is also modified", () => {
    const lines = [
      "diff --git a/projects/test/postmortem/postmortem-bar.md b/projects/test/postmortem/postmortem-bar.md",
      "--- a/projects/test/postmortem/postmortem-bar.md",
      "+++ b/projects/test/postmortem/postmortem-bar.md",
      "@@ -10,0 +11,3 @@",
      "+## Recommendations",
      "+We should implement circuit breaker pattern.",
    ];
    const diff = lines.join("\n");
    const changedFiles = [
      "projects/test/postmortem/postmortem-bar.md",
      "projects/test/TASKS.md",
    ];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(0);
  });

  // ── Regex pattern tests ────────────────────────────────────────────────

  it("DIAGNOSIS_MD_RE matches correct paths", () => {
    expect(DIAGNOSIS_MD_RE.test("projects/youji/diagnosis/diagnosis-test-2026-03-01.md")).toBe(true);
    expect(DIAGNOSIS_MD_RE.test("projects/foo/diagnosis/diagnosis-bar.md")).toBe(true);
    expect(DIAGNOSIS_MD_RE.test("projects/youji/experiments/exp/EXPERIMENT.md")).toBe(false);
    expect(DIAGNOSIS_MD_RE.test("docs/diagnosis-test.md")).toBe(false);
  });

  it("POSTMORTEM_MD_RE matches correct paths", () => {
    expect(POSTMORTEM_MD_RE.test("projects/youji/postmortem/postmortem-outage-2026-03-01.md")).toBe(true);
    expect(POSTMORTEM_MD_RE.test("projects/foo/postmortem/postmortem-bar.md")).toBe(true);
    expect(POSTMORTEM_MD_RE.test("projects/youji/diagnosis/diagnosis-test.md")).toBe(false);
    expect(POSTMORTEM_MD_RE.test("docs/postmortem-test.md")).toBe(false);
  });

  // ── Architecture file tests ────────────────────────────────────────────────

  it("detects 'should' in architecture Recommendation section", () => {
    const lines = [
      "diff --git a/projects/youji/architecture/architecture-api-redesign.md b/projects/youji/architecture/architecture-api-redesign.md",
      "--- a/projects/youji/architecture/architecture-api-redesign.md",
      "+++ b/projects/youji/architecture/architecture-api-redesign.md",
      "@@ -30,0 +31,3 @@",
      "+## Recommendation",
      "+The system should use a layered architecture pattern.",
    ];
    const diff = lines.join("\n");
    const changedFiles = ["projects/youji/architecture/architecture-api-redesign.md"];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("Recommendation/Implementation Priority/Risk Assessment");
  });

  it("detects 'needs to' in architecture Implementation Priority section", () => {
    const lines = [
      "diff --git a/projects/test/architecture/architecture-migration.md b/projects/test/architecture/architecture-migration.md",
      "--- a/projects/test/architecture/architecture-migration.md",
      "+++ b/projects/test/architecture/architecture-migration.md",
      "@@ -20,0 +21,3 @@",
      "+## Implementation Priority",
      "+The migration needs to be completed before the Q2 release.",
    ];
    const diff = lines.join("\n");
    const changedFiles = ["projects/test/architecture/architecture-migration.md"];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(1);
  });

  it("detects 'gap' in architecture Risk Assessment section", () => {
    const lines = [
      "diff --git a/projects/foo/architecture/architecture-security.md b/projects/foo/architecture/architecture-security.md",
      "--- a/projects/foo/architecture/architecture-security.md",
      "+++ b/projects/foo/architecture/architecture-security.md",
      "@@ -40,0 +41,3 @@",
      "+## Risk Assessment",
      "+There is a gap in our authentication coverage for service accounts.",
    ];
    const diff = lines.join("\n");
    const changedFiles = ["projects/foo/architecture/architecture-security.md"];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(1);
  });

  it("passes for architecture file without actionable language", () => {
    const lines = [
      "diff --git a/projects/test/architecture/architecture-ok.md b/projects/test/architecture/architecture-ok.md",
      "--- a/projects/test/architecture/architecture-ok.md",
      "+++ b/projects/test/architecture/architecture-ok.md",
      "@@ -20,0 +21,3 @@",
      "+## Recommendation",
      "+Current architecture is well-suited for the workload.",
    ];
    const diff = lines.join("\n");
    const changedFiles = ["projects/test/architecture/architecture-ok.md"];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(0);
  });

  it("passes for architecture file when TASKS.md is also modified", () => {
    const lines = [
      "diff --git a/projects/test/architecture/architecture-bar.md b/projects/test/architecture/architecture-bar.md",
      "--- a/projects/test/architecture/architecture-bar.md",
      "+++ b/projects/test/architecture/architecture-bar.md",
      "@@ -10,0 +11,3 @@",
      "+## Recommendation",
      "+We should implement circuit breaker pattern.",
    ];
    const diff = lines.join("\n");
    const changedFiles = [
      "projects/test/architecture/architecture-bar.md",
      "projects/test/TASKS.md",
    ];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(0);
  });

  // ── Synthesis file tests ────────────────────────────────────────────────

  it("detects 'should' in synthesis Implications section", () => {
    const lines = [
      "diff --git a/projects/youji/analysis/2026-03-synthesis-findings.md b/projects/youji/analysis/2026-03-synthesis-findings.md",
      "--- a/projects/youji/analysis/2026-03-synthesis-findings.md",
      "+++ b/projects/youji/analysis/2026-03-synthesis-findings.md",
      "@@ -30,0 +31,3 @@",
      "+## Implications",
      "+Future experiments should include multi-model comparison baselines.",
    ];
    const diff = lines.join("\n");
    const changedFiles = ["projects/youji/analysis/2026-03-synthesis-findings.md"];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("Implications");
  });

  it("detects 'follow-up' in synthesis Implications section", () => {
    const lines = [
      "diff --git a/projects/bench/analysis/results-synthesis-2026-q1.md b/projects/bench/analysis/results-synthesis-2026-q1.md",
      "--- a/projects/bench/analysis/results-synthesis-2026-q1.md",
      "+++ b/projects/bench/analysis/results-synthesis-2026-q1.md",
      "@@ -20,0 +21,3 @@",
      "+## Implications",
      "+A follow-up study is warranted for the edge cases.",
    ];
    const diff = lines.join("\n");
    const changedFiles = ["projects/bench/analysis/results-synthesis-2026-q1.md"];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(1);
  });

  it("passes for synthesis file without actionable language", () => {
    const lines = [
      "diff --git a/projects/test/analysis/synthesis-ok.md b/projects/test/analysis/synthesis-ok.md",
      "--- a/projects/test/analysis/synthesis-ok.md",
      "+++ b/projects/test/analysis/synthesis-ok.md",
      "@@ -20,0 +21,3 @@",
      "+## Implications",
      "+Results are consistent across all tested conditions.",
    ];
    const diff = lines.join("\n");
    const changedFiles = ["projects/test/analysis/synthesis-ok.md"];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(0);
  });

  it("passes for synthesis file when TASKS.md is also modified", () => {
    const lines = [
      "diff --git a/projects/test/analysis/synthesis-bar.md b/projects/test/analysis/synthesis-bar.md",
      "--- a/projects/test/analysis/synthesis-bar.md",
      "+++ b/projects/test/analysis/synthesis-bar.md",
      "@@ -10,0 +11,3 @@",
      "+## Implications",
      "+The pipeline needs to be optimized for larger datasets.",
    ];
    const diff = lines.join("\n");
    const changedFiles = [
      "projects/test/analysis/synthesis-bar.md",
      "projects/test/TASKS.md",
    ];
    const violations = checkActionableImplications(diff, changedFiles);
    expect(violations).toHaveLength(0);
  });

  // ── Regex pattern tests for architecture and synthesis ───────────────────

  it("ARCHITECTURE_MD_RE matches correct paths", () => {
    expect(ARCHITECTURE_MD_RE.test("projects/youji/architecture/architecture-api-redesign.md")).toBe(true);
    expect(ARCHITECTURE_MD_RE.test("projects/foo/architecture/architecture-bar.md")).toBe(true);
    expect(ARCHITECTURE_MD_RE.test("projects/youji/diagnosis/diagnosis-test.md")).toBe(false);
    expect(ARCHITECTURE_MD_RE.test("docs/architecture-test.md")).toBe(false);
  });

  it("SYNTHESIS_MD_RE matches correct paths", () => {
    expect(SYNTHESIS_MD_RE.test("projects/youji/analysis/2026-03-synthesis-findings.md")).toBe(true);
    expect(SYNTHESIS_MD_RE.test("projects/bench/analysis/results-synthesis-2026-q1.md")).toBe(true);
    expect(SYNTHESIS_MD_RE.test("projects/youji/analysis/synthesis-report.md")).toBe(true);
    expect(SYNTHESIS_MD_RE.test("projects/youji/analysis/findings.md")).toBe(false);
    expect(SYNTHESIS_MD_RE.test("docs/synthesis-test.md")).toBe(false);
  });
});
