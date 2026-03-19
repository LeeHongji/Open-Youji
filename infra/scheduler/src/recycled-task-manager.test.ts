import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  RECYCLED_TASK_TEMPLATES,
  loadRecycledState,
  saveRecycledState,
  getEligibleRecycledTasks,
  markCompleted,
  generateRecycledTasks,
  type RecycledState,
  type RecycledTaskResult,
} from "./recycled-task-manager.js";

// ── Test helpers ─────────────────────────────────────────────────────────────

let tmpDir: string;

function createProject(name: string) {
  const projectDir = join(tmpDir, "projects", name);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "README.md"), `# ${name}\nStatus: active\n`);
  writeFileSync(join(projectDir, "TASKS.md"), `# ${name} — Tasks\n`);
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "recycled-tasks-test-"));
  mkdirSync(join(tmpDir, "projects"), { recursive: true });
  mkdirSync(join(tmpDir, ".scheduler"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── RECYCLED_TASK_TEMPLATES ──────────────────────────────────────────────────

describe("RECYCLED_TASK_TEMPLATES", () => {
  it("has expected template types", () => {
    expect(RECYCLED_TASK_TEMPLATES).toHaveProperty("self-audit");
    expect(RECYCLED_TASK_TEMPLATES).toHaveProperty("doc-coherence");
    expect(RECYCLED_TASK_TEMPLATES).toHaveProperty("cross-ref-verify");
    expect(RECYCLED_TASK_TEMPLATES).toHaveProperty("stale-blocker-check");
  });

  it("each template has required fields", () => {
    for (const [type, template] of Object.entries(RECYCLED_TASK_TEMPLATES)) {
      expect(template).toHaveProperty("description");
      expect(template).toHaveProperty("skill");
      expect(template).toHaveProperty("cooldownMs");
      expect(typeof template.cooldownMs).toBe("number");
      expect(template.cooldownMs).toBeGreaterThan(0);
    }
  });
});

// ── loadRecycledState / saveRecycledState ────────────────────────────────────

describe("loadRecycledState", () => {
  it("returns empty state when file does not exist", () => {
    const state = loadRecycledState(tmpDir);
    expect(state.tasks).toEqual({});
  });

  it("loads existing state from disk", () => {
    const state: RecycledState = {
      tasks: {
        "self-audit:alpha": {
          lastCompleted: "2026-03-06T12:00:00Z",
          completionCount: 3,
          lastResult: "commit",
        },
      },
    };
    writeFileSync(
      join(tmpDir, ".scheduler", "recycled-tasks.json"),
      JSON.stringify(state),
    );
    const loaded = loadRecycledState(tmpDir);
    expect(loaded.tasks["self-audit:alpha"]).toBeDefined();
    expect(loaded.tasks["self-audit:alpha"].completionCount).toBe(3);
    expect(loaded.tasks["self-audit:alpha"].lastResult).toBe("commit");
  });

  it("handles malformed JSON gracefully", () => {
    writeFileSync(
      join(tmpDir, ".scheduler", "recycled-tasks.json"),
      "not json {{{",
    );
    const state = loadRecycledState(tmpDir);
    expect(state.tasks).toEqual({});
  });
});

describe("saveRecycledState", () => {
  it("persists state to disk", () => {
    const state: RecycledState = {
      tasks: {
        "doc-coherence:beta": {
          lastCompleted: "2026-03-07T08:00:00Z",
          completionCount: 1,
          lastResult: "no-change",
        },
      },
    };
    saveRecycledState(tmpDir, state);
    const filePath = join(tmpDir, ".scheduler", "recycled-tasks.json");
    expect(existsSync(filePath)).toBe(true);
    const loaded = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(loaded.tasks["doc-coherence:beta"].completionCount).toBe(1);
  });

  it("creates .scheduler directory if missing", () => {
    rmSync(join(tmpDir, ".scheduler"), { recursive: true, force: true });
    const state: RecycledState = { tasks: {} };
    saveRecycledState(tmpDir, state);
    expect(existsSync(join(tmpDir, ".scheduler", "recycled-tasks.json"))).toBe(true);
  });
});

// ── getEligibleRecycledTasks ─────────────────────────────────────────────────

describe("getEligibleRecycledTasks", () => {
  it("returns tasks for all projects when no completion history exists", () => {
    createProject("alpha");
    createProject("beta");
    const state: RecycledState = { tasks: {} };
    const tasks = getEligibleRecycledTasks(tmpDir, state, Date.now());
    // Should have at least 1 task per project per template type
    expect(tasks.length).toBeGreaterThan(0);
    // Each task should have required fields
    for (const task of tasks) {
      expect(task).toHaveProperty("id");
      expect(task).toHaveProperty("type");
      expect(task).toHaveProperty("project");
      expect(task).toHaveProperty("description");
      expect(task).toHaveProperty("skill");
    }
  });

  it("filters out tasks within cooldown period", () => {
    createProject("alpha");
    const now = Date.now();
    const recentCompletion = new Date(now - 1000).toISOString(); // 1 second ago
    const state: RecycledState = {
      tasks: {
        "self-audit:alpha": {
          lastCompleted: recentCompletion,
          completionCount: 1,
          lastResult: "commit",
        },
      },
    };
    const tasks = getEligibleRecycledTasks(tmpDir, state, now);
    const selfAuditAlpha = tasks.find(
      (t) => t.type === "self-audit" && t.project === "alpha",
    );
    expect(selfAuditAlpha).toBeUndefined(); // Should be filtered out (within cooldown)
  });

  it("includes tasks that have passed cooldown", () => {
    createProject("alpha");
    const now = Date.now();
    const selfAuditCooldown = RECYCLED_TASK_TEMPLATES["self-audit"].cooldownMs;
    const oldCompletion = new Date(now - selfAuditCooldown - 1000).toISOString();
    const state: RecycledState = {
      tasks: {
        "self-audit:alpha": {
          lastCompleted: oldCompletion,
          completionCount: 5,
          lastResult: "commit",
        },
      },
    };
    const tasks = getEligibleRecycledTasks(tmpDir, state, now);
    const selfAuditAlpha = tasks.find(
      (t) => t.type === "self-audit" && t.project === "alpha",
    );
    expect(selfAuditAlpha).toBeDefined();
  });

  it("does not return tasks for non-existent projects", () => {
    // No projects created
    const state: RecycledState = { tasks: {} };
    const tasks = getEligibleRecycledTasks(tmpDir, state, Date.now());
    expect(tasks.length).toBe(0);
  });
});

// ── markCompleted ────────────────────────────────────────────────────────────

describe("markCompleted", () => {
  it("creates new entry for first completion", () => {
    const state: RecycledState = { tasks: {} };
    const now = Date.now();
    const updated = markCompleted(state, "self-audit:alpha", "commit", now);
    expect(updated.tasks["self-audit:alpha"]).toBeDefined();
    expect(updated.tasks["self-audit:alpha"].completionCount).toBe(1);
    expect(updated.tasks["self-audit:alpha"].lastResult).toBe("commit");
  });

  it("increments completion count for existing entry", () => {
    const state: RecycledState = {
      tasks: {
        "self-audit:alpha": {
          lastCompleted: "2026-03-06T12:00:00Z",
          completionCount: 3,
          lastResult: "no-change",
        },
      },
    };
    const now = Date.now();
    const updated = markCompleted(state, "self-audit:alpha", "commit", now);
    expect(updated.tasks["self-audit:alpha"].completionCount).toBe(4);
    expect(updated.tasks["self-audit:alpha"].lastResult).toBe("commit");
  });

  it("updates lastCompleted timestamp", () => {
    const state: RecycledState = {
      tasks: {
        "doc-coherence:beta": {
          lastCompleted: "2026-03-01T00:00:00Z",
          completionCount: 1,
          lastResult: "commit",
        },
      },
    };
    const now = new Date("2026-03-07T12:00:00Z").getTime();
    const updated = markCompleted(state, "doc-coherence:beta", "no-change", now);
    expect(updated.tasks["doc-coherence:beta"].lastCompleted).toBe(
      "2026-03-07T12:00:00.000Z",
    );
  });
});

// ── generateRecycledTasks ────────────────────────────────────────────────────

describe("generateRecycledTasks", () => {
  it("generates tasks from all templates for each project", () => {
    createProject("alpha");
    const tasks = generateRecycledTasks(tmpDir);
    const templateCount = Object.keys(RECYCLED_TASK_TEMPLATES).length;
    expect(tasks.length).toBe(templateCount); // 1 project × N templates
  });

  it("generates tasks for multiple projects", () => {
    createProject("alpha");
    createProject("beta");
    const tasks = generateRecycledTasks(tmpDir);
    const templateCount = Object.keys(RECYCLED_TASK_TEMPLATES).length;
    expect(tasks.length).toBe(templateCount * 2); // 2 projects × N templates
  });

  it("generates task IDs in format type:project", () => {
    createProject("alpha");
    const tasks = generateRecycledTasks(tmpDir);
    for (const task of tasks) {
      expect(task.id).toMatch(/^recycle:/);
      expect(task.id).toContain(":alpha");
    }
  });
});
