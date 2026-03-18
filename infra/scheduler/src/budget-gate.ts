/** Pre-execution budget gate — blocks sessions when all budgeted projects are exhausted or past deadline. */

import { join } from "node:path";
import { readAllBudgetStatuses, readBudgetStatus } from "./notify.js";
import { getProjectDailyMinutes } from "./metrics.js";
import { EXCLUDED_PROJECTS } from "./constants.js";
import type { Job } from "./types.js";

export interface BudgetGateResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check whether a job should be allowed to run based on project budget status.
 * Blocks only when ALL budgeted projects have resources at 100%+ OR deadline past.
 * If no projects have budgets, always allows.
 */
export async function checkBudget(job: Job): Promise<BudgetGateResult> {
  const repoDir = job.payload.cwd ?? process.cwd();

  let budgets: Awaited<ReturnType<typeof readAllBudgetStatuses>>;
  try {
    budgets = await readAllBudgetStatuses(repoDir, EXCLUDED_PROJECTS);
  } catch {
    // If we can't read budgets, don't block — fail open
    return { allowed: true, reason: "budget check failed, allowing by default" };
  }

  // No budgeted projects — nothing to gate
  if (budgets.length === 0) {
    return { allowed: true };
  }

  // Check if every budgeted project is exhausted or past deadline
  const exhausted = budgets.filter((b) => {
    const allResourcesSpent = b.status.resources.length > 0 &&
      b.status.resources.every((r) => r.pct >= 100);
    const pastDeadline = b.status.hoursToDeadline !== undefined &&
      b.status.hoursToDeadline <= 0;
    return allResourcesSpent || pastDeadline;
  });

  if (exhausted.length === budgets.length) {
    const names = exhausted.map((b) => b.project).join(", ");
    return {
      allowed: false,
      reason: `All budgeted projects exhausted or past deadline: ${names}`,
    };
  }

  return { allowed: true };
}

// ── Time-based budget gate ──────────────────────────────────────────────────

export interface TimeBudgetResult {
  allowed: boolean;
  usedMinutes: number;
  limitMinutes: number;
  reason?: string;
}

/**
 * Check whether a project has exceeded its daily compute-minutes budget.
 * Reads budget.yaml from projects/<project>/budget.yaml and looks for a
 * resource with unit "compute-minutes". Compares against today's aggregated
 * session minutes from the JSONL metrics file.
 */
export async function checkTimeBudget(
  project: string,
  repoDir: string,
  metricsPath?: string,
): Promise<TimeBudgetResult> {
  const projectDir = join(repoDir, "projects", project);
  const budgetStatus = await readBudgetStatus(projectDir);
  if (!budgetStatus) {
    return { allowed: true, usedMinutes: 0, limitMinutes: Infinity };
  }
  const timeResource = budgetStatus.resources.find((r) => r.unit === "compute-minutes");
  if (!timeResource) {
    return { allowed: true, usedMinutes: 0, limitMinutes: Infinity };
  }
  const today = new Date().toISOString().slice(0, 10);
  const usedMinutes = await getProjectDailyMinutes(project, today, metricsPath);
  const limitMinutes = timeResource.limit;
  if (usedMinutes >= limitMinutes) {
    return {
      allowed: false,
      usedMinutes,
      limitMinutes,
      reason: `Time budget exceeded: ${usedMinutes}/${limitMinutes} compute-minutes used today`,
    };
  }
  return { allowed: true, usedMinutes, limitMinutes };
}
