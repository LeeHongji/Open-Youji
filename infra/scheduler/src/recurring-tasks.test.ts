/** Tests for proactive recurring task generation. */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RECURRING_TEMPLATES,
  shouldGenerateRecurringTasks,
  generateRecurringTaskCandidates,
  formatRecurringTaskBlock,
  injectRecurringTasks,
  runRecurringTasks,
  type RecurringTask,
} from "./recurring-tasks.js";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const TEST_DIR = join(process.cwd(), ".test-recurring-tasks");

function setupTestDir(): void {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });

  // Create .scheduler directory
  mkdirSync(join(TEST_DIR, ".scheduler"), { recursive: true });

  // Create projects
  mkdirSync(join(TEST_DIR, "projects", "project-a"), { recursive: true });
  mkdirSync(join(TEST_DIR, "projects", "project-b"), { recursive: true });

  // Create TASKS.md files
  writeFileSync(
    join(TEST_DIR, "projects", "project-a", "TASKS.md"),
    `# project-a Tasks\n\n## Open\n\n- [ ] Existing task\n  Done when: Done\n`,
  );
  writeFileSync(
    join(TEST_DIR, "projects", "project-b", "TASKS.md"),
    `# project-b Tasks\n\n## Open\n\n`,
  );
}

function teardownTestDir(): void {
  rmSync(TEST_DIR, { recursive: true, force: true });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("recurring-tasks", () => {
  beforeEach(setupTestDir);
  afterEach(teardownTestDir);

  describe("RECURRING_TEMPLATES", () => {
    it("defines at least 4 recurring task templates", () => {
      expect(RECURRING_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    });

    it("templates have required fields", () => {
      for (const template of RECURRING_TEMPLATES) {
        expect(template.id).toBeDefined();
        expect(template.text).toBeDefined();
        expect(template.why).toBeDefined();
        expect(template.doneWhen).toBeDefined();
        expect(template.priority).toMatch(/^(high|medium|low)$/);
        expect(template.cooldownDays).toBeGreaterThan(0);
      }
    });

    it("templates have clear done-when conditions", () => {
      for (const template of RECURRING_TEMPLATES) {
        expect(template.doneWhen.length).toBeGreaterThan(20);
        expect(template.doneWhen).toMatch(/\b(done|complete|saved|updated|listed|scanned|analyzed|added|reported)\b/i);
      }
    });
  });

  describe("shouldGenerateRecurringTasks", () => {
    it("returns true when fleet supply is low", () => {
      // Low supply: no fleet-eligible unblocked tasks
      const result = shouldGenerateRecurringTasks(TEST_DIR);
      expect(result).toBe(true);
    });

    it("returns true when supply is at threshold", () => {
      // Add exactly 4 fleet-eligible tasks (below threshold of 5)
      const tasks = Array(4)
        .fill(null)
        .map((_, i) => `- [ ] Task ${i} [fleet-eligible]\n  Done when: Done\n`)
        .join("\n");

      writeFileSync(
        join(TEST_DIR, "projects", "project-a", "TASKS.md"),
        `# project-a Tasks\n\n## Open\n\n${tasks}`,
      );

      // Below threshold should generate
      const result = shouldGenerateRecurringTasks(TEST_DIR);
      expect(result).toBe(true);
    });

    it("returns false when supply is above threshold", () => {
      // Add exactly 10 fleet-eligible tasks (above threshold of 5)
      const tasks = Array(10)
        .fill(null)
        .map((_, i) => `- [ ] Task ${i} [fleet-eligible]\n  Done when: Done\n`)
        .join("\n");

      writeFileSync(
        join(TEST_DIR, "projects", "project-a", "TASKS.md"),
        `# project-a Tasks\n\n## Open\n\n${tasks}`,
      );

      // Above threshold should skip
      const result = shouldGenerateRecurringTasks(TEST_DIR);
      expect(result).toBe(false);
    });
  });

  describe("generateRecurringTaskCandidates", () => {
    it("generates tasks for multiple projects", () => {
      const candidates = generateRecurringTaskCandidates({
        cwd: TEST_DIR,
        maxTasks: 4,
      });

      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.length).toBeLessThanOrEqual(4);

      // Should include [fleet-eligible] and [skill: record] tags
      for (const candidate of candidates) {
        expect(candidate.project).toBeDefined();
        expect(candidate.id).toBeDefined();
      }
    });

    it("respects maxTasks limit", () => {
      const candidates = generateRecurringTaskCandidates({
        cwd: TEST_DIR,
        maxTasks: 2,
      });

      expect(candidates.length).toBeLessThanOrEqual(2);
    });

    it("rotates through projects for diversity", () => {
      const candidates = generateRecurringTaskCandidates({
        cwd: TEST_DIR,
        maxTasks: 4,
      });

      const projects = new Set(candidates.map((c) => c.project));
      // With 2 projects and maxTasks=4, should cover both projects
      expect(projects.size).toBeGreaterThan(1);
    });

    it("respects cooldown period", () => {
      // Generate once
      const first = generateRecurringTaskCandidates({
        cwd: TEST_DIR,
        maxTasks: 4,
        now: new Date(),
      });

      // Inject to set cooldown
      injectRecurringTasks(TEST_DIR, first);

      // Generate again immediately - should get fewer/no candidates
      const second = generateRecurringTaskCandidates({
        cwd: TEST_DIR,
        maxTasks: 4,
        now: new Date(),
      });

      // Same template-project combos should be filtered
      const firstKeys = new Set(first.map((t) => `${t.id}:${t.project}`));
      const secondKeys = new Set(second.map((t) => `${t.id}:${t.project}`));

      for (const key of firstKeys) {
        expect(secondKeys.has(key)).toBe(false);
      }
    });
  });

  describe("formatRecurringTaskBlock", () => {
    it("formats task with required tags", () => {
      const task: RecurringTask = {
        id: "test-task",
        text: "Test task description",
        why: "Test reason",
        doneWhen: "Test done condition",
        priority: "low",
        cooldownDays: 7,
        project: "test-project",
        generatedAt: "2026-01-01T00:00:00Z",
      };

      const block = formatRecurringTaskBlock(task);

      expect(block).toContain("[fleet-eligible]");
      expect(block).toContain("[skill: record]");
      expect(block).toContain("[recurring: test-task]");
      expect(block).toContain("Why: Test reason");
      expect(block).toContain("Done when: Test done condition");
      expect(block).toContain("Priority: low");
    });
  });

  describe("injectRecurringTasks", () => {
    it("injects tasks into TASKS.md", async () => {
      const task: RecurringTask = {
        id: "readme-status-verify",
        text: "Verify README status",
        why: "Test reason",
        doneWhen: "Verified",
        priority: "low",
        cooldownDays: 7,
        project: "project-a",
        generatedAt: new Date().toISOString(),
      };

      const count = await injectRecurringTasks(TEST_DIR, [task]);
      expect(count).toBe(1);

      const content = readFileSync(
        join(TEST_DIR, "projects", "project-a", "TASKS.md"),
        "utf-8",
      );

      expect(content).toContain("[recurring: readme-status-verify]");
    });

    it("skips duplicate recurring tasks", async () => {
      const task: RecurringTask = {
        id: "readme-status-verify",
        text: "Verify README status",
        why: "Test reason",
        doneWhen: "Verified",
        priority: "low",
        cooldownDays: 7,
        project: "project-a",
        generatedAt: new Date().toISOString(),
      };

      // Inject twice
      await injectRecurringTasks(TEST_DIR, [task]);
      const secondCount = await injectRecurringTasks(TEST_DIR, [task]);

      expect(secondCount).toBe(0);
    });

    it("updates cooldown state", async () => {
      const task: RecurringTask = {
        id: "readme-status-verify",
        text: "Verify README status",
        why: "Test reason",
        doneWhen: "Verified",
        priority: "low",
        cooldownDays: 7,
        project: "project-a",
        generatedAt: new Date().toISOString(),
      };

      await injectRecurringTasks(TEST_DIR, [task]);

      const cooldownPath = join(TEST_DIR, ".scheduler", "recurring-cooldown.json");
      expect(existsSync(cooldownPath)).toBe(true);

      const state = JSON.parse(readFileSync(cooldownPath, "utf-8"));
      expect(state["readme-status-verify:project-a"]).toBeDefined();
    });
  });

  describe("runRecurringTasks", () => {
    it("generates and injects tasks when supply is low", async () => {
      const result = await runRecurringTasks({ cwd: TEST_DIR });

      expect(result.generated).toBeGreaterThan(0);
      expect(result.injected).toBeGreaterThan(0);
      expect(result.reason).toContain("Low open task supply");
    });

    it("respects force flag", async () => {
      // Add supply to skip normal generation
      const tasks = Array(10)
        .fill(null)
        .map((_, i) => `- [ ] Task ${i} [fleet-eligible]\n  Done when: Done\n`)
        .join("\n");

      writeFileSync(
        join(TEST_DIR, "projects", "project-a", "TASKS.md"),
        `# project-a Tasks\n\n## Open\n\n${tasks}`,
      );

      // Without force, should skip
      const normalResult = await runRecurringTasks({ cwd: TEST_DIR });
      expect(normalResult.generated).toBe(0);

      // With force, should generate
      const forceResult = await runRecurringTasks({ cwd: TEST_DIR, force: true });
      expect(forceResult.generated).toBeGreaterThan(0);
      expect(forceResult.reason).toContain("Force-generated");
    });

    it("respects maxTasks parameter", async () => {
      const result = await runRecurringTasks({ cwd: TEST_DIR, maxTasks: 2 });

      expect(result.generated).toBeLessThanOrEqual(2);
    });
  });
});
