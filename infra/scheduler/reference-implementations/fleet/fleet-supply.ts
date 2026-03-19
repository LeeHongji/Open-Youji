/** Fleet task supply monitoring — scans TASKS.md files and reports fleet-eligible task availability (ADR 0042-v2). */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ── Tag patterns (from fleet-tasks.ts) ────────────────────────────────────────

const BLOCKED_RE = /\[blocked-by:\s*([^\]]+)\]/i;
const IN_PROGRESS_RE = /\[in-progress:\s*[^\]]+\]/i;
const APPROVAL_NEEDED_RE = /\[approval-needed\]/i;
const APPROVED_RE = /\[approved:\s*[^\]]+\]/i;
const REQUIRES_OPUS_RE = /\[requires-opus\]/i;
const FLEET_ELIGIBLE_RE = /\[fleet-eligible\]/i;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DecomposableTask {
  /** First line of the task text. */
  text: string;
  /** Project the task belongs to. */
  project: string;
  /** Why this task is decomposable (trigger matched). */
  trigger: "multiple-steps" | "multiple-files" | "mixed-work";
}

export interface TaskSupplySnapshot {
  /** Total fleet-eligible tasks that are unblocked and ready. */
  fleetEligibleUnblocked: number;
  /** Total fleet-eligible tasks that are blocked. */
  fleetEligibleBlocked: number;
  /** Blocked task summary: blocker description -> count. */
  blockedSummary: Record<string, number>;
  /** Tasks without [fleet-eligible] or [requires-opus] tag. */
  untaggedCount: number;
  /** Tasks with [requires-opus] tag. */
  requiresOpusCount: number;
  /** Total open tasks scanned. */
  totalOpenTasks: number;
  /** Per-project breakdown. */
  byProject: Record<string, ProjectTaskSupply>;
  /** Requires-opus tasks that could be decomposed into fleet-eligible subtasks (ADR 0053). */
  decomposableTasks: DecomposableTask[];
}

export interface ProjectTaskSupply {
  fleetEligibleUnblocked: number;
  fleetEligibleBlocked: number;
  untagged: number;
  requiresOpus: number;
}

// ── Task parsing ──────────────────────────────────────────────────────────────

function isOpenTaskLine(line: string): boolean {
  return /^\s*-\s+\[ \]\s+/.test(line);
}

function isIndentedContinuation(line: string): boolean {
  return /^\s{2,}/.test(line) && !isOpenTaskLine(line) && !/^\s*-\s+\[/.test(line);
}

function extractTaskText(line: string): string {
  return line.replace(/^\s*-\s+\[ \]\s+/, "").trim();
}

interface ParsedTask {
  text: string;
  blockedBy: string | null;
  inProgress: boolean;
  approvalNeeded: boolean;
  approved: boolean;
  fleetEligible: boolean;
  requiresOpus: boolean;
}

function parseTaskBlock(taskLine: string, continuations: string[]): ParsedTask {
  const fullText = [taskLine, ...continuations.map((l) => l.trim())].join(" ");

  const blockedMatch = fullText.match(BLOCKED_RE);
  const blockedBy = blockedMatch ? blockedMatch[1].trim() : null;

  return {
    text: taskLine,
    blockedBy,
    inProgress: IN_PROGRESS_RE.test(fullText),
    approvalNeeded: APPROVAL_NEEDED_RE.test(fullText),
    approved: APPROVED_RE.test(fullText),
    fleetEligible: FLEET_ELIGIBLE_RE.test(fullText),
    requiresOpus: REQUIRES_OPUS_RE.test(fullText),
  };
}

function parseTasksFile(content: string): ParsedTask[] {
  const lines = content.split("\n");
  const tasks: ParsedTask[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!isOpenTaskLine(line)) {
      i++;
      continue;
    }

    const taskText = extractTaskText(line);
    const continuationLines: string[] = [];

    let j = i + 1;
    while (j < lines.length && isIndentedContinuation(lines[j])) {
      continuationLines.push(lines[j]);
      j++;
    }

    tasks.push(parseTaskBlock(taskText, continuationLines));
    i = j;
  }

  return tasks;
}

// ── Core scanner ──────────────────────────────────────────────────────────────

/** Scan all projects/{name}/TASKS.md files and return task supply metrics. */
export function scanTaskSupply(cwd: string): TaskSupplySnapshot {
  const projectsDir = join(cwd, "projects");
  let projectDirs: string[];

  try {
    projectDirs = readdirSync(projectsDir).filter((name) => {
      try {
        return statSync(join(projectsDir, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return {
      fleetEligibleUnblocked: 0,
      fleetEligibleBlocked: 0,
      blockedSummary: {},
      untaggedCount: 0,
      requiresOpusCount: 0,
      totalOpenTasks: 0,
      byProject: {},
      decomposableTasks: [],
    };
  }

  const allTasks: Array<ParsedTask & { project: string }> = [];
  const byProject: Record<string, ProjectTaskSupply> = {};

  for (const projectName of projectDirs) {
    const tasksPath = join(projectsDir, projectName, "TASKS.md");

    let content: string;
    try {
      content = readFileSync(tasksPath, "utf-8");
    } catch {
      continue;
    }

    const tasks = parseTasksFile(content);
    for (const task of tasks) {
      allTasks.push({ ...task, project: projectName });
    }

    byProject[projectName] = {
      fleetEligibleUnblocked: 0,
      fleetEligibleBlocked: 0,
      untagged: 0,
      requiresOpus: 0,
    };
  }

  // Calculate metrics
  let fleetEligibleUnblocked = 0;
  let fleetEligibleBlocked = 0;
  let untaggedCount = 0;
  let requiresOpusCount = 0;
  const blockedSummary: Record<string, number> = {};
  const decomposableTasks: DecomposableTask[] = [];

  for (const task of allTasks) {
    const projStats = byProject[task.project];
    if (!projStats) continue;

    // Skip in-progress tasks (someone is working on them)
    if (task.inProgress) continue;

    // Skip approval-needed tasks that aren't approved
    if (task.approvalNeeded && !task.approved) continue;

    // Categorize by fleet eligibility
    if (task.fleetEligible) {
      if (task.blockedBy) {
        fleetEligibleBlocked++;
        projStats.fleetEligibleBlocked++;

        // Summarize blocker (truncate long blockers)
        const blockerKey = task.blockedBy.length > 50
          ? task.blockedBy.slice(0, 47) + "..."
          : task.blockedBy;
        blockedSummary[blockerKey] = (blockedSummary[blockerKey] || 0) + 1;
      } else {
        fleetEligibleUnblocked++;
        projStats.fleetEligibleUnblocked++;
      }
    } else if (task.requiresOpus) {
      requiresOpusCount++;
      projStats.requiresOpus++;

      // Check if this requires-opus task is decomposable (ADR 0053)
      if (!task.blockedBy) {
        const trigger = detectDecompositionTrigger(task.text);
        if (trigger) {
          decomposableTasks.push({ text: task.text, project: task.project, trigger });
        }
      }
    } else {
      // Untagged (neither fleet-eligible nor requires-opus)
      untaggedCount++;
      projStats.untagged++;
    }
  }

  return {
    fleetEligibleUnblocked,
    fleetEligibleBlocked,
    blockedSummary,
    untaggedCount,
    requiresOpusCount,
    totalOpenTasks: allTasks.filter((t) => !t.inProgress && !(t.approvalNeeded && !t.approved)).length,
    byProject,
    decomposableTasks,
  };
}

// ── Decomposition detection (ADR 0053) ───────────────────────────────────────

const STEP_INDICATORS = /\b(and|then|also|plus|additionally)\b/i;
const MULTI_FILE_INDICATORS = /\b(across|multiple files|several files|all .+ files)\b/i;
const MIXED_WORK_INDICATORS = /\b(design|implement|analyze|review|test|document)\b/gi;

/** Heuristic: detect if a task description suggests it has multiple independent steps,
 *  touches multiple files, or mixes mechanical with judgment work. */
export function detectDecompositionTrigger(
  text: string,
): "multiple-steps" | "multiple-files" | "mixed-work" | null {
  if (MULTI_FILE_INDICATORS.test(text)) return "multiple-files";

  if (STEP_INDICATORS.test(text)) return "multiple-steps";

  const workTypes = text.match(MIXED_WORK_INDICATORS);
  if (workTypes && new Set(workTypes.map((w) => w.toLowerCase())).size >= 2) return "mixed-work";

  return null;
}

// ── Formatting ────────────────────────────────────────────────────────────────

/** Format task supply for fleet status reports. */
export function formatTaskSupply(snap: TaskSupplySnapshot): string {
  const lines: string[] = [];

  // Main metrics
  lines.push(`*Fleet Task Supply:* ${snap.fleetEligibleUnblocked} ready`);

  if (snap.fleetEligibleBlocked > 0) {
    lines.push(`  Blocked: ${snap.fleetEligibleBlocked} fleet-eligible tasks waiting`);
  }

  if (snap.untaggedCount > 0) {
    lines.push(`  Untagged: ${snap.untaggedCount} tasks need fleet routing tag`);
  }

  // Blocker summary (top 3)
  const blockers = Object.entries(snap.blockedSummary);
  if (blockers.length > 0) {
    blockers.sort((a, b) => b[1] - a[1]);
    const topBlockers = blockers.slice(0, 3);
    for (const [blocker, count] of topBlockers) {
      const displayBlocker = blocker.length > 50 ? blocker.slice(0, 47) + "..." : blocker;
      lines.push(`    • "${displayBlocker}" (${count} tasks)`);
    }
  }

  // Per-project breakdown (only if multiple projects have tasks)
  const projectsWithTasks = Object.entries(snap.byProject)
    .filter(([, stats]) => stats.fleetEligibleUnblocked > 0 || stats.fleetEligibleBlocked > 0);
  if (projectsWithTasks.length > 1) {
    lines.push("");
    lines.push("*By project:*");
    for (const [name, stats] of projectsWithTasks) {
      const ready = stats.fleetEligibleUnblocked;
      const blocked = stats.fleetEligibleBlocked;
      if (ready > 0 || blocked > 0) {
        lines.push(`  • \`${name}\`: ${ready} ready${blocked > 0 ? `, ${blocked} blocked` : ""}`);
      }
    }
  }

  return lines.join("\n");
}

/** Get a one-line summary for status displays. */
export function getTaskSupplySummary(snap: TaskSupplySnapshot): string {
  return `${snap.fleetEligibleUnblocked} ready / ${snap.fleetEligibleBlocked} blocked / ${snap.untaggedCount} untagged`;
}

/** Fleet supply warning threshold ratio (supply / fleet_size). */
export const FLEET_SUPPLY_WARNING_RATIO = 1.5;

/** Check if fleet supply is low and return a warning message if so.
 *  Returns null if supply is adequate or fleet is disabled (FLEET_SIZE=0). */
export function checkFleetSupplyWarning(
  unblockedFleetEligibleTasks: number,
  fleetSize: number,
): string | null {
  if (fleetSize <= 0) return null;

  const ratio = unblockedFleetEligibleTasks / fleetSize;
  if (ratio < FLEET_SUPPLY_WARNING_RATIO) {
    return `Fleet supply warning: ${unblockedFleetEligibleTasks} unblocked fleet-eligible tasks for ${fleetSize} workers (ratio ${ratio.toFixed(2)} < ${FLEET_SUPPLY_WARNING_RATIO})`;
  }

  return null;
}
