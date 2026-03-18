/** Proactive reporting: per-project snapshot building, change detection, Slack formatting. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTasksFile } from "./task-parser.js";
import { getProjectDailyMinutes } from "./metrics.js";
import { readBudgetStatus, getPendingApprovals } from "./notify.js";

export interface ProjectSnapshot {
  project: string;
  completedTasks: number;
  openTasks: number;
  blockedTasks: number;
  inProgressTasks: number;
  activeWorkers: number;
  pendingApprovals: number;
  computeMinutesUsed: number;
  computeMinutesLimit: number;
  budgetExceeded: boolean;
}

/**
 * Build a status snapshot for a single project.
 * Reads TASKS.md for task counts, metrics for budget, and APPROVAL_QUEUE for approvals.
 *
 * @param project - Project directory name
 * @param repoDir - Repository root directory
 * @param activeWorkerCount - Number of active workers (passed by caller who owns WorkerManager)
 * @param metricsPath - Optional override for metrics JSONL path
 */
export async function buildProjectSnapshot(
  project: string,
  repoDir: string,
  activeWorkerCount: number,
  metricsPath?: string,
): Promise<ProjectSnapshot> {
  // 1. Parse TASKS.md for task counts
  const tasksPath = join(repoDir, "projects", project, "TASKS.md");
  let completedTasks = 0;
  let openTasks = 0;
  let blockedTasks = 0;
  let inProgressTasks = 0;

  try {
    const content = readFileSync(tasksPath, "utf-8");
    const parsed = parseTasksFile(content);
    openTasks = parsed.filter((t) => !t.isBlocked && !t.isInProgress).length;
    blockedTasks = parsed.filter((t) => t.isBlocked).length;
    inProgressTasks = parsed.filter((t) => t.isInProgress).length;
    // Count completed: lines matching - [x]
    completedTasks = (content.match(/^\s*-\s+\[x\]/gim) ?? []).length;
  } catch {
    /* no TASKS.md — all counts stay 0 */
  }

  // 2. Budget status
  const today = new Date().toISOString().slice(0, 10);
  const computeMinutesUsed = await getProjectDailyMinutes(project, today, metricsPath);
  const projectDir = join(repoDir, "projects", project);
  const budgetStatus = await readBudgetStatus(projectDir);
  const timeResource = budgetStatus?.resources.find((r) => r.unit === "compute-minutes");
  const computeMinutesLimit = timeResource?.limit ?? Infinity;
  const budgetExceeded =
    computeMinutesLimit !== Infinity && computeMinutesUsed >= computeMinutesLimit;

  // 3. Pending approvals for this project
  const allApprovals = await getPendingApprovals(repoDir);
  const pendingApprovals = allApprovals.filter((a) => a.project === project).length;

  return {
    project,
    completedTasks,
    openTasks,
    blockedTasks,
    inProgressTasks,
    activeWorkers: activeWorkerCount,
    pendingApprovals,
    computeMinutesUsed,
    computeMinutesLimit,
    budgetExceeded,
  };
}

/**
 * Detect whether a project snapshot has meaningfully changed from the previous report.
 * Returns true on first report (previous is null) or when any field differs.
 * Uses a 5-minute tolerance on computeMinutesUsed to prevent noise.
 */
export function hasChanged(
  current: ProjectSnapshot,
  previous: ProjectSnapshot | null,
): boolean {
  if (!previous) return true;
  return (
    current.completedTasks !== previous.completedTasks ||
    current.openTasks !== previous.openTasks ||
    current.blockedTasks !== previous.blockedTasks ||
    current.inProgressTasks !== previous.inProgressTasks ||
    current.activeWorkers !== previous.activeWorkers ||
    current.pendingApprovals !== previous.pendingApprovals ||
    current.budgetExceeded !== previous.budgetExceeded ||
    Math.abs(current.computeMinutesUsed - previous.computeMinutesUsed) >= 5
  );
}

/**
 * Format an array of changed project snapshots into Slack mrkdwn for a proactive report.
 * Returns empty string when no snapshots are provided.
 */
export function formatProactiveReport(snapshots: ProjectSnapshot[]): string {
  if (snapshots.length === 0) return "";

  const lines: string[] = ["*Youji Hourly Status*\n"];

  for (const s of snapshots) {
    const budgetIcon = s.budgetExceeded ? ":no_entry:" : ":large_green_circle:";
    const hours = (s.computeMinutesUsed / 60).toFixed(1);
    const limitHours =
      s.computeMinutesLimit === Infinity
        ? "unlimited"
        : (s.computeMinutesLimit / 60).toFixed(0) + "h";

    lines.push(`*${s.project}*`);
    lines.push(
      `  Tasks: ${s.completedTasks} done, ${s.openTasks} open, ${s.blockedTasks} blocked`,
    );
    if (s.activeWorkers > 0) lines.push(`  Workers: ${s.activeWorkers} active`);
    lines.push(`  ${budgetIcon} Budget: ${hours}h / ${limitHours}`);
    if (s.pendingApprovals > 0) {
      lines.push(`  :bell: ${s.pendingApprovals} pending approval(s)`);
    }
  }

  return lines.join("\n");
}
