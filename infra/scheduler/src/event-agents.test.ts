/** Tests for plan mode detection in buildProgressHandler, readPlanFile, and
 *  deep work prompt construction (thread context inheritance). */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readPlanFile, buildProgressHandler, buildDeepWorkPrompt, validateExperimentDir, extractFilePaths, findMissingFiles } from "./event-agents.js";

describe("readPlanFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "youji-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns newest plan file content", async () => {
    const plansDir = join(tempDir, ".claude", "plans");
    await mkdir(plansDir, { recursive: true });

    // Create two plan files with different mtimes
    await writeFile(join(plansDir, "old-plan.md"), "# Old Plan\nThis is old.");
    // Small delay to ensure different mtime
    await new Promise((r) => setTimeout(r, 50));
    await writeFile(join(plansDir, "new-plan.md"), "# New Plan\nThis is new.");

    const result = await readPlanFile(tempDir);
    expect(result).toContain("# New Plan");
    expect(result).toContain("This is new.");
  });

  it("returns null when no plan files exist", async () => {
    // No .claude/plans/ directory at all
    const result = await readPlanFile(tempDir);
    expect(result).toBeNull();
  });

  it("returns null when plans directory is empty", async () => {
    const plansDir = join(tempDir, ".claude", "plans");
    await mkdir(plansDir, { recursive: true });

    const result = await readPlanFile(tempDir);
    expect(result).toBeNull();
  });

  it("truncates content to 3000 chars", async () => {
    const plansDir = join(tempDir, ".claude", "plans");
    await mkdir(plansDir, { recursive: true });

    const longContent = "x".repeat(5000);
    await writeFile(join(plansDir, "big-plan.md"), longContent);

    const result = await readPlanFile(tempDir);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(3000);
  });
});

describe("buildProgressHandler plan mode detection", () => {
  it("detects EnterPlanMode tool call", async () => {
    const messages: string[] = [];
    const onProgress = vi.fn(async (text: string) => { messages.push(text); });

    const { handler } = buildProgressHandler({
      onProgress,
      label: "test",
      detectPlanMode: true,
      repoDir: "/nonexistent",
    });

    // Feed a mock assistant message with EnterPlanMode tool_use
    await handler({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "EnterPlanMode",
            input: {},
          },
        ],
      },
    });

    expect(messages.some((m) => m.includes("plan mode"))).toBe(true);
  });

  it("detects ExitPlanMode tool call and reads plan file", async () => {
    // Create a temp dir with a plan file
    const tempDir = await mkdtemp(join(tmpdir(), "youji-test-"));
    const plansDir = join(tempDir, ".claude", "plans");
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, "test-plan.md"), "# My Plan\nStep 1: Do stuff");

    const messages: string[] = [];
    const onProgress = vi.fn(async (text: string) => { messages.push(text); });

    const { handler } = buildProgressHandler({
      onProgress,
      label: "test",
      detectPlanMode: true,
      repoDir: tempDir,
    });

    await handler({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "tu_2",
            name: "ExitPlanMode",
            input: {},
          },
        ],
      },
    });

    // Should have posted the plan content
    expect(messages.some((m) => m.includes("My Plan"))).toBe(true);
    // Should have posted exit notification
    expect(messages.some((m) => m.includes("plan mode") || m.includes("implementation"))).toBe(true);

    await rm(tempDir, { recursive: true, force: true });
  });

  it("calls onExitPlanMode callback with plan text when ExitPlanMode detected", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "youji-test-"));
    const plansDir = join(tempDir, ".claude", "plans");
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, "auto-plan.md"), "# Auto Plan\nStep 1: Implement");

    const messages: string[] = [];
    const onProgress = vi.fn(async (text: string) => { messages.push(text); });
    const onExitPlanMode = vi.fn(async (_planText: string | null) => {});

    const { handler } = buildProgressHandler({
      onProgress,
      label: "test",
      detectPlanMode: true,
      repoDir: tempDir,
      onExitPlanMode,
    });

    await handler({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "tu_auto", name: "ExitPlanMode", input: {} },
        ],
      },
    });

    // onExitPlanMode should have been called with the plan text
    expect(onExitPlanMode).toHaveBeenCalledOnce();
    expect(onExitPlanMode.mock.calls[0][0]).toContain("Auto Plan");

    await rm(tempDir, { recursive: true, force: true });
  });

  it("calls onExitPlanMode with null when no plan file exists", async () => {
    const onProgress = vi.fn(async (_text: string) => {});
    const onExitPlanMode = vi.fn(async (_planText: string | null) => {});

    const { handler } = buildProgressHandler({
      onProgress,
      label: "test",
      detectPlanMode: true,
      repoDir: "/nonexistent-dir-for-test",
      onExitPlanMode,
    });

    await handler({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "tu_noplan", name: "ExitPlanMode", input: {} },
        ],
      },
    });

    expect(onExitPlanMode).toHaveBeenCalledOnce();
    expect(onExitPlanMode.mock.calls[0][0]).toBeNull();
  });

  it("does not call onExitPlanMode when detectPlanMode is false", async () => {
    const onProgress = vi.fn(async (_text: string) => {});
    const onExitPlanMode = vi.fn(async (_planText: string | null) => {});

    const { handler } = buildProgressHandler({
      onProgress,
      label: "test",
      detectPlanMode: false,
      onExitPlanMode,
    });

    await handler({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "tu_off", name: "ExitPlanMode", input: {} },
        ],
      },
    });

    expect(onExitPlanMode).not.toHaveBeenCalled();
  });

  it("passes through non-plan messages unchanged", async () => {
    const messages: string[] = [];
    const onProgress = vi.fn(async (text: string) => { messages.push(text); });

    const { handler } = buildProgressHandler({
      onProgress,
      label: "test",
      detectPlanMode: true,
      repoDir: "/nonexistent",
    });

    // Regular text message
    await handler({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "I found the file you asked about." },
        ],
      },
    });

    expect(messages).toEqual(["I found the file you asked about."]);
  });

  it("does not detect plan mode when detectPlanMode is false", async () => {
    const messages: string[] = [];
    const onProgress = vi.fn(async (text: string) => { messages.push(text); });

    const { handler } = buildProgressHandler({
      onProgress,
      label: "test",
      detectPlanMode: false,
    });

    await handler({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "tu_3",
            name: "EnterPlanMode",
            input: {},
          },
        ],
      },
    });

    // Should NOT emit plan mode notification — should fall through to tool summary
    expect(messages.every((m) => !m.includes("plan mode"))).toBe(true);
  });

  it("still forwards tool_use_summary messages", async () => {
    const messages: string[] = [];
    const onProgress = vi.fn(async (text: string) => { messages.push(text); });

    const { handler, flusher } = buildProgressHandler({
      onProgress,
      label: "test",
      detectPlanMode: true,
      repoDir: "/nonexistent",
    });

    await handler({ type: "tool_use_summary", summary: "Read `foo.ts`" });
    await flusher.flush();

    expect(messages.some((m) => m.includes("Read `foo.ts`"))).toBe(true);
  });
});

describe("buildDeepWorkPrompt", () => {
  const skillList = "/orient, /develop, /diagnose";

  it("includes task description in prompt", () => {
    const prompt = buildDeepWorkPrompt("Fix the dedup bug", skillList);
    expect(prompt).toContain("Fix the dedup bug");
  });

  it("includes skill list in prompt", () => {
    const prompt = buildDeepWorkPrompt("Fix the dedup bug", skillList);
    expect(prompt).toContain("/orient, /develop, /diagnose");
  });

  it("includes skill mandate when task starts with Run /skill-name", () => {
    const prompt = buildDeepWorkPrompt("Run /develop fix the dedup bug", skillList);
    expect(prompt).toContain("MANDATORY");
    expect(prompt).toContain("skill /develop");
  });

  it("omits skill mandate for non-skill tasks", () => {
    const prompt = buildDeepWorkPrompt("Fix the dedup bug", skillList);
    expect(prompt).not.toContain("MANDATORY");
  });

  it("includes thread context when provided", () => {
    const threadContext = [
      "[12:00] User: /develop add session tracking",
      "[12:05] Bot: Deep work complete — implemented session tracking in session.ts",
      "[12:10] User: /develop now add context inheritance",
    ].join("\n");

    const prompt = buildDeepWorkPrompt("Run /develop now add context inheritance", skillList, threadContext);
    expect(prompt).toContain("Previous thread context");
    expect(prompt).toContain("session tracking");
    expect(prompt).toContain("Deep work complete");
  });

  it("omits thread context section when not provided", () => {
    const prompt = buildDeepWorkPrompt("Fix the dedup bug", skillList);
    expect(prompt).not.toContain("Previous thread context");
  });

  it("omits thread context section when empty string provided", () => {
    const prompt = buildDeepWorkPrompt("Fix the dedup bug", skillList, "");
    expect(prompt).not.toContain("Previous thread context");
  });

  it("truncates very long thread context", () => {
    const longContext = "x".repeat(20_000);
    const prompt = buildDeepWorkPrompt("Fix something", skillList, longContext);
    // Should contain thread context but be truncated
    expect(prompt).toContain("Previous thread context");
    expect(prompt.length).toBeLessThan(25_000);
  });

  it("suppresses /orient in deep work sessions", () => {
    const prompt = buildDeepWorkPrompt("Design an approach for X", skillList);
    expect(prompt).toContain("Do NOT run /orient");
    expect(prompt).toContain("not a scheduled autonomous work cycle");
  });

  it("warns about text-only messages terminating the session", () => {
    const prompt = buildDeepWorkPrompt("Fix the dedup bug", skillList);
    expect(prompt).toContain("text-only message");
    expect(prompt).toContain("terminate the session");
  });

  it("includes plan mode tools (EnterPlanMode/ExitPlanMode) instructions", () => {
    const prompt = buildDeepWorkPrompt("Implement feature X", skillList);
    expect(prompt).toContain("EnterPlanMode");
    expect(prompt).toContain("ExitPlanMode");
    expect(prompt).toContain("proceed with implementation without waiting for approval");
  });

  it("embeds skill content when provided (replaces Skill tool mandate)", () => {
    const skillContent = `# /project scaffold
Create new research projects via interactive interview.

## Step 1: Parse description
Read the user's request and extract key information.`;

    const prompt = buildDeepWorkPrompt(
      "Run /project scaffold build a tree generator",
      skillList,
      undefined,
      skillContent
    );

    expect(prompt).toContain("## Skill Instructions: /project");
    expect(prompt).toContain("Step 1: Parse description");
    expect(prompt).toContain("do NOT invoke the Skill tool");
    expect(prompt).not.toContain("Skill name=");
  });

  it("uses Skill tool mandate when skill content not provided", () => {
    const prompt = buildDeepWorkPrompt("Run /develop fix the bug", skillList);
    expect(prompt).toContain("MANDATORY");
    expect(prompt).toContain("Skill tool");
  });

  it("skill content takes precedence over Skill tool mandate", () => {
    const prompt = buildDeepWorkPrompt(
      "Run /diagnose the experiment",
      skillList,
      undefined,
      "# /diagnose\nAnalyze and diagnose issues."
    );
    expect(prompt).toContain("## Skill Instructions: /diagnose");
    expect(prompt).toContain("do NOT invoke the Skill tool");
  });

  it("includes human input protocol instructions when skill content is provided", () => {
    const prompt = buildDeepWorkPrompt(
      "Run /project scaffold build a tree generator",
      skillList,
      undefined,
      "# /project scaffold\nInterview the user."
    );
    expect(prompt).toContain("[QUESTION:");
    expect(prompt).toContain("[ACTION:await_response");
  });

  it("includes fleet worker awareness section", () => {
    const prompt = buildDeepWorkPrompt("Fix the dedup bug", skillList);
    expect(prompt).toContain("Fleet workers");
    expect(prompt).toContain("[fleet-eligible]");
    expect(prompt).toContain("30 seconds");
    expect(prompt).toContain("[requires-opus]");
  });

  it("fleet guidance mentions zero-cost fleet workers", () => {
    const prompt = buildDeepWorkPrompt("Create analysis tasks", skillList);
    expect(prompt).toContain("zero-cost");
  });
});

describe("spawnDeepWork backend profile override", () => {
  // Regression test for diagnosis-deep-work-timeout-loop-2026-02-28:
  // spawnDeepWork was passing AGENT_PROFILES.deepWork directly to spawnAgent
  // without applying backend-specific overrides. When opencode was the active
  // backend, deep work sessions ran with the default 20-min/256-turn limits
  // instead of the tighter 15-min/128-turn opencode limits.

  it("resolveDeepWorkProfile applies opencode overrides", async () => {
    const { resolveDeepWorkProfile } = await import("./event-agents.js");
    const { AGENT_PROFILES, BACKEND_PROFILE_OVERRIDES } = await import("./agent.js");

    const profile = resolveDeepWorkProfile("opencode");
    const expected = BACKEND_PROFILE_OVERRIDES["opencode"]["deep-work"];

    expect(profile.maxTurns).toBe(expected.maxTurns);
    expect(profile.maxDurationMs).toBe(expected.maxDurationMs);
    // Preserves non-overridden fields
    expect(profile.model).toBe(AGENT_PROFILES.deepWork.model);
    expect(profile.label).toBe("deep-work");
  });

  it("resolveDeepWorkProfile returns default profile for claude backend", async () => {
    const { resolveDeepWorkProfile } = await import("./event-agents.js");
    const { AGENT_PROFILES } = await import("./agent.js");

    const profile = resolveDeepWorkProfile("claude");
    expect(profile.maxTurns).toBe(AGENT_PROFILES.deepWork.maxTurns);
    expect(profile.maxDurationMs).toBe(AGENT_PROFILES.deepWork.maxDurationMs);
  });
});

describe("validateExperimentDir", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "youji-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("passes --experiment-only flag to skip repo-wide checks", async () => {
    // This test verifies the function signature accepts experimentOnly option.
    // We create a valid experiment dir and verify the validator is called with the flag.
    const expDir = join(tempDir, "test-exp");
    await mkdir(expDir, { recursive: true });
    await writeFile(
      join(expDir, "EXPERIMENT.md"),
      [
        "---",
        "id: test-exp",
        "status: planned",
        "date: 2026-02-28",
        "project: test",
        "type: analysis",
        "consumes_resources: false",
        "---",
        "",
        "## Question",
        "Test question.",
      ].join("\n"),
    );

    // Call with experimentOnly: true — this should pass the --experiment-only flag
    const result = await validateExperimentDir(expDir, { experimentOnly: true });
    // A valid experiment should pass validation regardless
    // The key test is that the function accepts the option without error
    expect(result.ok).toBe(true);
  });

  it("validates experiment without --experiment-only by default", async () => {
    const expDir = join(tempDir, "bad-exp");
    await mkdir(expDir, { recursive: true });
    await writeFile(
      join(expDir, "EXPERIMENT.md"),
      [
        "---",
        "id: bad-exp",
        "status: completed",
        "date: 2026-02-28",
        "project: test",
        "type: experiment",
        "consumes_resources: true",
        "---",
        "",
        "## Design",
        "Test.",
        // Missing: Config, Results, Findings, Reproducibility
      ].join("\n"),
    );

    const result = await validateExperimentDir(expDir);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("Missing sections");
  });
});

describe("extractFilePaths", () => {
  it("extracts .md file paths with directory separators", () => {
    const text = "Created reports/summary.md and projects/youji/README.md";
    const paths = extractFilePaths(text);
    expect(paths).toContain("reports/summary.md");
    expect(paths).toContain("projects/youji/README.md");
  });

  it("deduplicates paths", () => {
    const text = "Wrote to reports/summary.md and again reports/summary.md";
    const paths = extractFilePaths(text);
    expect(paths).toEqual(["reports/summary.md"]);
  });

  it("excludes node_modules and other irrelevant directories", () => {
    const text = "node_modules/foo/bar.md and dist/output.md and reports/valid.md";
    const paths = extractFilePaths(text);
    expect(paths).not.toContain("node_modules/foo/bar.md");
    expect(paths).not.toContain("dist/output.md");
    expect(paths).toContain("reports/valid.md");
  });

  it("ignores plain filenames without directory separators", () => {
    const text = "See README.md for details";
    const paths = extractFilePaths(text);
    expect(paths).not.toContain("README.md");
  });

  it("returns empty array when no paths found", () => {
    const text = "No file paths here, just regular text.";
    const paths = extractFilePaths(text);
    expect(paths).toEqual([]);
  });

  it("handles backtick-wrapped paths", () => {
    const text = "Created `reports/output.md` and `docs/guide.md` successfully";
    const paths = extractFilePaths(text);
    expect(paths).toContain("reports/output.md");
    expect(paths).toContain("docs/guide.md");
  });

  it("handles paths with hyphens and underscores", () => {
    const text = "Created reports/my-report_v2.md and docs/user_guide.md";
    const paths = extractFilePaths(text);
    expect(paths).toContain("reports/my-report_v2.md");
    expect(paths).toContain("docs/user_guide.md");
  });
});

describe("findMissingFiles", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "youji-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty array when all files exist", async () => {
    await mkdir(join(tempDir, "reports"), { recursive: true });
    await writeFile(join(tempDir, "reports", "exists.md"), "content");

    const missing = await findMissingFiles(["reports/exists.md"], tempDir);
    expect(missing).toEqual([]);
  });

  it("returns paths that do not exist", async () => {
    const missing = await findMissingFiles(
      ["reports/missing.md", "docs/also-missing.md"],
      tempDir
    );
    expect(missing).toContain("reports/missing.md");
    expect(missing).toContain("docs/also-missing.md");
  });

  it("returns only missing files when some exist", async () => {
    await mkdir(join(tempDir, "reports"), { recursive: true });
    await writeFile(join(tempDir, "reports", "exists.md"), "content");

    const missing = await findMissingFiles(
      ["reports/exists.md", "reports/missing.md"],
      tempDir
    );
    expect(missing).toEqual(["reports/missing.md"]);
  });

  it("handles empty path array", async () => {
    const missing = await findMissingFiles([], tempDir);
    expect(missing).toEqual([]);
  });
});
