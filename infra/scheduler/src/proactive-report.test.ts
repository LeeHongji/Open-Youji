/** Tests for proactive-report: snapshot building, change detection, formatting. */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";

// Mock dependencies
vi.mock("./metrics.js", () => ({
  getProjectDailyMinutes: vi.fn(),
}));

vi.mock("./notify.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./notify.js")>();
  return {
    ...orig,
    readBudgetStatus: vi.fn(),
    getPendingApprovals: vi.fn(),
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:fs")>();
  return {
    ...orig,
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    existsSync: vi.fn(),
  };
});

import { buildProjectSnapshot, hasChanged, formatProactiveReport, type ProjectSnapshot } from "./proactive-report.js";
import { getProjectDailyMinutes } from "./metrics.js";
import { readBudgetStatus, getPendingApprovals } from "./notify.js";
import { readFileSync } from "node:fs";

const mockedGetProjectDailyMinutes = vi.mocked(getProjectDailyMinutes);
const mockedReadBudgetStatus = vi.mocked(readBudgetStatus);
const mockedGetPendingApprovals = vi.mocked(getPendingApprovals);
const mockedReadFileSync = vi.mocked(readFileSync);

// ── buildProjectSnapshot ─────────────────────────────────────────────────────

describe("buildProjectSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts open, blocked, in-progress, and completed tasks from TASKS.md", async () => {
    const tasksContent = [
      "# Tasks",
      "- [x] Completed task one",
      "- [x] Completed task two",
      "- [ ] Open task",
      "- [ ] Blocked task [blocked-by: something]",
      "- [ ] In progress task [in-progress: 2026-03-18]",
      "- [ ] Another open task",
    ].join("\n");

    mockedReadFileSync.mockReturnValue(tasksContent);
    mockedGetProjectDailyMinutes.mockResolvedValue(30);
    mockedReadBudgetStatus.mockResolvedValue({
      resources: [{ resource: "compute-minutes", consumed: 30, limit: 240, unit: "compute-minutes", pct: 13 }],
    });
    mockedGetPendingApprovals.mockResolvedValue([]);

    const snapshot = await buildProjectSnapshot("projA", "/repo", 0);

    expect(snapshot.completedTasks).toBe(2);
    expect(snapshot.openTasks).toBe(2); // not blocked, not in-progress
    expect(snapshot.blockedTasks).toBe(1);
    expect(snapshot.inProgressTasks).toBe(1);
  });

  it("gets compute minutes from getProjectDailyMinutes", async () => {
    mockedReadFileSync.mockReturnValue("- [ ] task\n");
    mockedGetProjectDailyMinutes.mockResolvedValue(120);
    mockedReadBudgetStatus.mockResolvedValue({
      resources: [{ resource: "compute-minutes", consumed: 120, limit: 240, unit: "compute-minutes", pct: 50 }],
    });
    mockedGetPendingApprovals.mockResolvedValue([]);

    const snapshot = await buildProjectSnapshot("projA", "/repo", 2);

    expect(snapshot.computeMinutesUsed).toBe(120);
    expect(snapshot.computeMinutesLimit).toBe(240);
    expect(snapshot.budgetExceeded).toBe(false);
    expect(snapshot.activeWorkers).toBe(2);
  });

  it("marks budgetExceeded when used >= limit", async () => {
    mockedReadFileSync.mockReturnValue("- [x] done\n");
    mockedGetProjectDailyMinutes.mockResolvedValue(250);
    mockedReadBudgetStatus.mockResolvedValue({
      resources: [{ resource: "compute-minutes", consumed: 250, limit: 240, unit: "compute-minutes", pct: 104 }],
    });
    mockedGetPendingApprovals.mockResolvedValue([]);

    const snapshot = await buildProjectSnapshot("projA", "/repo", 0);

    expect(snapshot.budgetExceeded).toBe(true);
  });

  it("counts pending approvals for the specific project", async () => {
    mockedReadFileSync.mockReturnValue("- [ ] task\n");
    mockedGetProjectDailyMinutes.mockResolvedValue(10);
    mockedReadBudgetStatus.mockResolvedValue(null);
    mockedGetPendingApprovals.mockResolvedValue([
      { date: "2026-03-18", title: "Approve X", project: "projA", type: "burst", rawBlock: "" },
      { date: "2026-03-18", title: "Approve Y", project: "projB", type: "burst", rawBlock: "" },
      { date: "2026-03-18", title: "Approve Z", project: "projA", type: "resource", rawBlock: "" },
    ] as any);

    const snapshot = await buildProjectSnapshot("projA", "/repo", 0);

    expect(snapshot.pendingApprovals).toBe(2);
  });

  it("handles missing TASKS.md gracefully", async () => {
    mockedReadFileSync.mockImplementation(() => { throw new Error("ENOENT"); });
    mockedGetProjectDailyMinutes.mockResolvedValue(0);
    mockedReadBudgetStatus.mockResolvedValue(null);
    mockedGetPendingApprovals.mockResolvedValue([]);

    const snapshot = await buildProjectSnapshot("projA", "/repo", 0);

    expect(snapshot.completedTasks).toBe(0);
    expect(snapshot.openTasks).toBe(0);
    expect(snapshot.blockedTasks).toBe(0);
    expect(snapshot.inProgressTasks).toBe(0);
  });

  it("sets computeMinutesLimit to Infinity when no budget.yaml", async () => {
    mockedReadFileSync.mockReturnValue("- [ ] task\n");
    mockedGetProjectDailyMinutes.mockResolvedValue(10);
    mockedReadBudgetStatus.mockResolvedValue(null);
    mockedGetPendingApprovals.mockResolvedValue([]);

    const snapshot = await buildProjectSnapshot("projA", "/repo", 0);

    expect(snapshot.computeMinutesLimit).toBe(Infinity);
    expect(snapshot.budgetExceeded).toBe(false);
  });
});

// ── hasChanged ───────────────────────────────────────────────────────────────

describe("hasChanged", () => {
  const base: ProjectSnapshot = {
    project: "projA",
    completedTasks: 5,
    openTasks: 3,
    blockedTasks: 1,
    inProgressTasks: 1,
    activeWorkers: 1,
    pendingApprovals: 0,
    computeMinutesUsed: 100,
    computeMinutesLimit: 240,
    budgetExceeded: false,
  };

  it("returns true when previous is null (first report)", () => {
    expect(hasChanged(base, null)).toBe(true);
  });

  it("returns false when snapshots are identical", () => {
    expect(hasChanged(base, { ...base })).toBe(false);
  });

  it("returns true when completedTasks changes", () => {
    expect(hasChanged({ ...base, completedTasks: 6 }, base)).toBe(true);
  });

  it("returns true when openTasks changes", () => {
    expect(hasChanged({ ...base, openTasks: 4 }, base)).toBe(true);
  });

  it("returns true when blockedTasks changes", () => {
    expect(hasChanged({ ...base, blockedTasks: 2 }, base)).toBe(true);
  });

  it("returns true when activeWorkers changes", () => {
    expect(hasChanged({ ...base, activeWorkers: 2 }, base)).toBe(true);
  });

  it("returns true when pendingApprovals changes", () => {
    expect(hasChanged({ ...base, pendingApprovals: 1 }, base)).toBe(true);
  });

  it("returns true when budgetExceeded changes", () => {
    expect(hasChanged({ ...base, budgetExceeded: true }, base)).toBe(true);
  });

  it("returns true when computeMinutesUsed changes by >= 5", () => {
    expect(hasChanged({ ...base, computeMinutesUsed: 105 }, base)).toBe(true);
  });

  it("returns false when computeMinutesUsed changes by < 5", () => {
    expect(hasChanged({ ...base, computeMinutesUsed: 103 }, base)).toBe(false);
  });
});

// ── formatProactiveReport ────────────────────────────────────────────────────

describe("formatProactiveReport", () => {
  it("returns empty string for empty snapshots array", () => {
    expect(formatProactiveReport([])).toBe("");
  });

  it("includes per-project summary with budget status as Xh / Yh", () => {
    const report = formatProactiveReport([{
      project: "projA",
      completedTasks: 5,
      openTasks: 3,
      blockedTasks: 1,
      inProgressTasks: 1,
      activeWorkers: 1,
      pendingApprovals: 0,
      computeMinutesUsed: 138,
      computeMinutesLimit: 240,
      budgetExceeded: false,
    }]);

    expect(report).toContain("projA");
    expect(report).toContain("5 done");
    expect(report).toContain("3 open");
    expect(report).toContain("1 blocked");
    expect(report).toContain("2.3h");
    expect(report).toContain("4h");
    expect(report).toContain(":large_green_circle:");
  });

  it("shows red icon when budget exceeded", () => {
    const report = formatProactiveReport([{
      project: "projA",
      completedTasks: 5,
      openTasks: 0,
      blockedTasks: 0,
      inProgressTasks: 0,
      activeWorkers: 0,
      pendingApprovals: 0,
      computeMinutesUsed: 250,
      computeMinutesLimit: 240,
      budgetExceeded: true,
    }]);

    expect(report).toContain(":no_entry:");
  });

  it("shows pending approvals with bell icon when > 0", () => {
    const report = formatProactiveReport([{
      project: "projA",
      completedTasks: 2,
      openTasks: 1,
      blockedTasks: 0,
      inProgressTasks: 0,
      activeWorkers: 0,
      pendingApprovals: 3,
      computeMinutesUsed: 60,
      computeMinutesLimit: 240,
      budgetExceeded: false,
    }]);

    expect(report).toContain(":bell:");
    expect(report).toContain("3 pending approval");
  });

  it("does not show bell icon when pendingApprovals is 0", () => {
    const report = formatProactiveReport([{
      project: "projA",
      completedTasks: 2,
      openTasks: 1,
      blockedTasks: 0,
      inProgressTasks: 0,
      activeWorkers: 0,
      pendingApprovals: 0,
      computeMinutesUsed: 60,
      computeMinutesLimit: 240,
      budgetExceeded: false,
    }]);

    expect(report).not.toContain(":bell:");
  });

  it("shows unlimited when computeMinutesLimit is Infinity", () => {
    const report = formatProactiveReport([{
      project: "projA",
      completedTasks: 0,
      openTasks: 1,
      blockedTasks: 0,
      inProgressTasks: 0,
      activeWorkers: 0,
      pendingApprovals: 0,
      computeMinutesUsed: 30,
      computeMinutesLimit: Infinity,
      budgetExceeded: false,
    }]);

    expect(report).toContain("unlimited");
  });

  it("shows active workers when > 0", () => {
    const report = formatProactiveReport([{
      project: "projA",
      completedTasks: 0,
      openTasks: 1,
      blockedTasks: 0,
      inProgressTasks: 0,
      activeWorkers: 2,
      pendingApprovals: 0,
      computeMinutesUsed: 30,
      computeMinutesLimit: 240,
      budgetExceeded: false,
    }]);

    expect(report).toContain("2 active");
  });

  it("formats multiple projects", () => {
    const report = formatProactiveReport([
      {
        project: "projA",
        completedTasks: 5,
        openTasks: 3,
        blockedTasks: 1,
        inProgressTasks: 0,
        activeWorkers: 0,
        pendingApprovals: 0,
        computeMinutesUsed: 60,
        computeMinutesLimit: 240,
        budgetExceeded: false,
      },
      {
        project: "projB",
        completedTasks: 2,
        openTasks: 4,
        blockedTasks: 0,
        inProgressTasks: 1,
        activeWorkers: 1,
        pendingApprovals: 1,
        computeMinutesUsed: 120,
        computeMinutesLimit: 240,
        budgetExceeded: false,
      },
    ]);

    expect(report).toContain("projA");
    expect(report).toContain("projB");
    expect(report).toContain("Youji Hourly Status");
  });
});
