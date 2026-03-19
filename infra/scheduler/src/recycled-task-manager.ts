/** Recycled task manager — generates periodic maintenance tasks with cooldown-based
 *  re-eligibility for fleet workers (from plans/task-recycling-mechanism.md).
 *
 *  Recycled tasks fill the gap between explicit TASKS.md tasks (consumed quickly)
 *  and idle exploration (low value), providing structured periodic maintenance with
 *  explicit tracking, cooldown management, and measurable throughput.
 *
 *  See: projects/youji/analysis/fleet-idle-exploration-trend.md R5 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────────

export type RecycledTaskType =
  | "self-audit"
  | "doc-coherence"
  | "cross-ref-verify"
  | "stale-blocker-check";

export interface RecycledTaskTemplate {
  /** Human-readable description template (use {project} placeholder). */
  description: string;
  /** Skill tag for routing (ADR 0062). */
  skill: string;
  /** Cooldown in milliseconds before the task is eligible for re-dispatch. */
  cooldownMs: number;
}

export interface RecycledTaskCompletion {
  /** ISO 8601 timestamp of last completion. */
  lastCompleted: string;
  /** Total number of times this task has been completed. */
  completionCount: number;
  /** Result of last completion. */
  lastResult: RecycledTaskResult;
}

export type RecycledTaskResult = "commit" | "no-change" | "failed";

export interface RecycledState {
  /** Map of task ID (type:project) to completion history. */
  tasks: Record<string, RecycledTaskCompletion>;
}

export interface RecycledTask {
  /** Unique ID in format "recycle:type:project". */
  id: string;
  /** Task type from template. */
  type: RecycledTaskType;
  /** Project this task applies to. */
  project: string;
  /** Human-readable description. */
  description: string;
  /** Skill tag for routing. */
  skill: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STATE_FILE = ".scheduler/recycled-tasks.json";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Recycled task templates — periodic maintenance tasks for fleet workers.
 *  Cooldowns tuned from fleet idle exploration empirical data:
 *  - self-audit: 7d (convention violations accumulate slowly)
 *  - doc-coherence: 7d (documentation drift is gradual)
 *  - cross-ref-verify: 3d (cross-references change more frequently)
 *  - stale-blocker-check: 1d (blocked tasks need frequent re-evaluation) */
export const RECYCLED_TASK_TEMPLATES: Record<RecycledTaskType, RecycledTaskTemplate> = {
  "self-audit": {
    description: "Run convention compliance audit on {project} and fix violations",
    skill: "govern",
    cooldownMs: 7 * MS_PER_DAY,
  },
  "doc-coherence": {
    description: "Check documentation consistency in {project}: README status matches TASKS.md state, log entries reference existing experiments",
    skill: "govern",
    cooldownMs: 7 * MS_PER_DAY,
  },
  "cross-ref-verify": {
    description: "Verify cross-references in {project} project files point to existing paths",
    skill: "govern",
    cooldownMs: 3 * MS_PER_DAY,
  },
  "stale-blocker-check": {
    description: "Check if external blockers in {project} TASKS.md have been resolved",
    skill: "persist",
    cooldownMs: 1 * MS_PER_DAY,
  },
};

// ── State persistence ────────────────────────────────────────────────────────

/** Load recycled task state from disk. Returns empty state if file doesn't exist. */
export function loadRecycledState(cwd: string): RecycledState {
  const filePath = join(cwd, STATE_FILE);
  try {
    if (!existsSync(filePath)) return { tasks: {} };
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    if (data && typeof data === "object" && data.tasks) {
      return data as RecycledState;
    }
    return { tasks: {} };
  } catch {
    return { tasks: {} };
  }
}

/** Save recycled task state to disk. */
export function saveRecycledState(cwd: string, state: RecycledState): void {
  const dirPath = join(cwd, ".scheduler");
  try {
    mkdirSync(dirPath, { recursive: true });
    writeFileSync(join(cwd, STATE_FILE), JSON.stringify(state, null, 2) + "\n");
  } catch {
    // Non-critical — state still works in-memory
  }
}

// ── Task generation ──────────────────────────────────────────────────────────

/** Discover active projects (those with a README.md in projects/). */
function discoverProjects(cwd: string): string[] {
  const projectsDir = join(cwd, "projects");
  try {
    return readdirSync(projectsDir).filter((name) => {
      try {
        const dir = join(projectsDir, name);
        return statSync(dir).isDirectory() && existsSync(join(dir, "README.md"));
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

/** Generate all possible recycled tasks (one per template per project). */
export function generateRecycledTasks(cwd: string): RecycledTask[] {
  const projects = discoverProjects(cwd);
  const tasks: RecycledTask[] = [];

  for (const project of projects) {
    for (const [type, template] of Object.entries(RECYCLED_TASK_TEMPLATES)) {
      tasks.push({
        id: `recycle:${type}:${project}`,
        type: type as RecycledTaskType,
        project,
        description: template.description.replace("{project}", project),
        skill: template.skill,
      });
    }
  }

  return tasks;
}

// ── Eligibility filtering ────────────────────────────────────────────────────

/** Get recycled tasks that are eligible for dispatch (cooldown has elapsed).
 *  @param cwd - Repository root directory
 *  @param state - Current recycled task state
 *  @param now - Current timestamp (ms since epoch) */
export function getEligibleRecycledTasks(
  cwd: string,
  state: RecycledState,
  now: number,
): RecycledTask[] {
  const allTasks = generateRecycledTasks(cwd);

  return allTasks.filter((task) => {
    const taskKey = `${task.type}:${task.project}`;
    const completion = state.tasks[taskKey];
    if (!completion) return true; // Never completed — eligible

    const lastCompletedMs = new Date(completion.lastCompleted).getTime();
    const cooldownMs = RECYCLED_TASK_TEMPLATES[task.type].cooldownMs;
    return (now - lastCompletedMs) >= cooldownMs;
  });
}

// ── Completion tracking ──────────────────────────────────────────────────────

/** Mark a recycled task as completed and return updated state.
 *  Does NOT persist — caller must call saveRecycledState().
 *  @param state - Current state (not mutated — returns new object)
 *  @param taskKey - Task key in format "type:project"
 *  @param result - Completion result
 *  @param now - Current timestamp (ms since epoch) */
export function markCompleted(
  state: RecycledState,
  taskKey: string,
  result: RecycledTaskResult,
  now: number,
): RecycledState {
  const existing = state.tasks[taskKey];
  return {
    tasks: {
      ...state.tasks,
      [taskKey]: {
        lastCompleted: new Date(now).toISOString(),
        completionCount: (existing?.completionCount ?? 0) + 1,
        lastResult: result,
      },
    },
  };
}
