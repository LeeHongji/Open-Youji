/** Proactive recurring task generation — creates maintenance tasks when fleet supply is low.
 *
 *  Guarantees baseline fleet utilization by generating weekly maintenance tasks:
 *  - README status verification
 *  - Orphaned experiment detection
 *  - Task tag audit
 *  - Session outcome summary
 *
 *  Tasks are self-contained with clear done-when conditions and marked [fleet-eligible]. */

import { readFile, writeFile } from "node:fs/promises";
import { readdirSync, statSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RecurringTaskTemplate {
  id: string;
  text: string;
  why: string;
  doneWhen: string;
  priority: "high" | "medium" | "low";
  cooldownDays: number;
}

export interface RecurringTask extends RecurringTaskTemplate {
  project: string;
  generatedAt: string;
}

// ── Recurring task templates ──────────────────────────────────────────────────

export const RECURRING_TEMPLATES: RecurringTaskTemplate[] = [
  {
    id: "readme-status-verify",
    text: "Verify README status section matches current project state",
    why: "README status sections drift from reality as projects evolve. Periodic verification catches stale metrics and outdated status claims.",
    doneWhen: "README status section reviewed. Any stale metrics updated or verified as current. Log entry added with changes or confirmation.",
    priority: "low",
    cooldownDays: 7,
  },
  {
    id: "orphaned-experiment-detect",
    text: "Detect orphaned experiment directories without recent progress",
    why: "Experiments can be abandoned mid-run. Detecting orphaned directories enables cleanup or recovery.",
    doneWhen: "All experiment directories under projects/*/experiments/ scanned. Orphaned experiments (no progress.json update in 7+ days) listed. Report saved to analysis/orphaned-experiments-YYYY-MM-DD.md.",
    priority: "low",
    cooldownDays: 7,
  },
  {
    id: "task-tag-audit",
    text: "Audit tasks for missing fleet routing tags",
    why: "Untagged tasks are invisible to fleet workers. Periodic audit ensures new tasks get proper routing tags.",
    doneWhen: "All open tasks in projects/*/TASKS.md scanned. Untagged tasks listed. At least 50% of untagged tasks receive appropriate [fleet-eligible] or [requires-opus] tags.",
    priority: "low",
    cooldownDays: 7,
  },
  {
    id: "session-outcome-summary",
    text: "Summarize recent session outcomes for project status tracking",
    why: "Session outcomes are scattered across log entries. Weekly summary consolidates progress for status reporting.",
    doneWhen: "Last 7 days of sessions from sessions.jsonl analyzed. Summary report at analysis/session-outcomes-YYYY-MM-DD.md with: task completion count, success rate, knowledge output metrics. Log entry added to project README.",
    priority: "low",
    cooldownDays: 7,
  },
];

// ── Cooldown tracking ─────────────────────────────────────────────────────────

const COOLDOWN_FILE = ".scheduler/recurring-cooldown.json";

interface CooldownState {
  [key: string]: string; // `${templateId}:${project}` -> ISO timestamp
}

function loadCooldownState(cwd: string): CooldownState {
  const filePath = join(cwd, COOLDOWN_FILE);
  try {
    if (!existsSync(filePath)) return {};
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

function saveCooldownState(cwd: string, state: CooldownState): void {
  const filePath = join(cwd, COOLDOWN_FILE);
  try {
    mkdirSync(join(cwd, ".scheduler"), { recursive: true });
    writeFileSync(filePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
  } catch {
    // Non-critical
  }
}

function isOnCooldown(
  templateId: string,
  project: string,
  state: CooldownState,
  now: Date,
): boolean {
  const key = `${templateId}:${project}`;
  const lastRun = state[key];
  if (!lastRun) return false;

  const template = RECURRING_TEMPLATES.find((t) => t.id === templateId);
  if (!template) return false;

  const cooldownMs = template.cooldownDays * 24 * 60 * 60 * 1000;
  const lastRunTime = new Date(lastRun).getTime();
  return now.getTime() - lastRunTime < cooldownMs;
}

// ── Project discovery ─────────────────────────────────────────────────────────

function discoverProjects(cwd: string): string[] {
  const projectsDir = join(cwd, "projects");
  try {
    return readdirSync(projectsDir).filter((name) => {
      try {
        return statSync(join(projectsDir, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

// ── Task generation ───────────────────────────────────────────────────────────

const SUPPLY_THRESHOLD = 5;

function countOpenTasks(cwd: string): number {
  const projects = discoverProjects(cwd);
  let total = 0;

  for (const project of projects) {
    const tasksPath = join(cwd, "projects", project, "TASKS.md");
    try {
      const content = readFileSync(tasksPath, "utf-8");
      // Count unchecked markdown task items.
      // Keep it simple: open task lines in this repo follow `- [ ]`.
      const matches = content.match(/^- \[ \]/gm);
      total += matches ? matches.length : 0;
    } catch {
      // ignore missing/unreadable TASKS.md
    }
  }

  return total;
}

export function shouldGenerateRecurringTasks(cwd: string): boolean {
  const openTasks = countOpenTasks(cwd);
  return openTasks < SUPPLY_THRESHOLD;
}

export interface GenerateRecurringTasksOpts {
  cwd: string;
  maxTasks?: number;
  now?: Date;
}

export function generateRecurringTaskCandidates(
  opts: GenerateRecurringTasksOpts,
): RecurringTask[] {
  const { cwd, maxTasks = 4, now = new Date() } = opts;

  const projects = discoverProjects(cwd);
  const cooldownState = loadCooldownState(cwd);
  const candidates: RecurringTask[] = [];

  for (const project of projects) {
    for (const template of RECURRING_TEMPLATES) {
      if (isOnCooldown(template.id, project, cooldownState, now)) continue;

      candidates.push({
        ...template,
        project,
        generatedAt: now.toISOString(),
      });
    }
  }

  // Prioritize: rotate through projects, one template per project
  // This ensures diverse coverage across the project portfolio
  const selected: RecurringTask[] = [];
  const usedProjects = new Set<string>();
  const usedTemplates = new Set<string>();

  // First pass: one task per project (if supply is very low)
  for (const candidate of candidates) {
    if (selected.length >= maxTasks) break;
    if (usedProjects.has(candidate.project)) continue;

    selected.push(candidate);
    usedProjects.add(candidate.project);
    usedTemplates.add(candidate.id);
  }

  // Second pass: fill remaining slots with any available
  for (const candidate of candidates) {
    if (selected.length >= maxTasks) break;
    if (selected.includes(candidate)) continue;

    selected.push(candidate);
  }

  return selected;
}

// ── Task formatting ───────────────────────────────────────────────────────────

export function formatRecurringTaskBlock(task: RecurringTask): string {
  return [
    `- [ ] ${task.text} [fleet-eligible] [skill: record] [recurring: ${task.id}]`,
    `  Why: ${task.why}`,
    `  Done when: ${task.doneWhen}`,
    `  Priority: ${task.priority}`,
  ].join("\n");
}

// ── Task injection ─────────────────────────────────────────────────────────────

export async function injectRecurringTasks(
  cwd: string,
  tasks: RecurringTask[],
): Promise<number> {
  if (tasks.length === 0) return 0;

  // Group tasks by project
  const byProject = new Map<string, RecurringTask[]>();
  for (const task of tasks) {
    const existing = byProject.get(task.project) ?? [];
    existing.push(task);
    byProject.set(task.project, existing);
  }

  // Update cooldown state
  const cooldownState = loadCooldownState(cwd);
  const now = new Date().toISOString();
  for (const task of tasks) {
    cooldownState[`${task.id}:${task.project}`] = now;
  }
  saveCooldownState(cwd, cooldownState);

  // Inject tasks into each project's TASKS.md
  let totalInjected = 0;

  for (const [project, projectTasks] of byProject) {
    const tasksPath = join(cwd, "projects", project, "TASKS.md");

    let existing = "";
    try {
      existing = await readFile(tasksPath, "utf-8");
    } catch {
      continue;
    }

    // Check for existing recurring tasks with same IDs
    const existingIds = new Set<string>();
    const recurringRe = /\[recurring:\s*([^\]]+)\]/g;
    let match;
    while ((match = recurringRe.exec(existing)) !== null) {
      existingIds.add(match[1]);
    }

    // Filter out tasks that already exist
    const newTasks = projectTasks.filter((t) => !existingIds.has(t.id));
    if (newTasks.length === 0) continue;

    // Find insertion point: after ## heading or at end
    const lines = existing.split("\n");
    let insertIdx = lines.length;

    for (let i = 0; i < lines.length; i++) {
      if (/^##\s/.test(lines[i]!)) {
        insertIdx = i + 1;
      }
    }

    // Find next blank line after heading for clean insertion
    while (insertIdx < lines.length && lines[insertIdx]?.trim() !== "") {
      insertIdx++;
    }
    insertIdx++;

    // Insert tasks
    const blocks = newTasks.map(formatRecurringTaskBlock);
    const insertion = "\n" + blocks.join("\n\n") + "\n";
    lines.splice(insertIdx, 0, insertion);

    await writeFile(tasksPath, lines.join(""), "utf-8");
    totalInjected += newTasks.length;
  }

  return totalInjected;
}

// ── Main orchestration ────────────────────────────────────────────────────────

export interface RunRecurringTasksOpts {
  cwd: string;
  force?: boolean;
  maxTasks?: number;
}

export interface RunRecurringTasksResult {
  generated: number;
  injected: number;
  reason: string;
}

export async function runRecurringTasks(
  opts: RunRecurringTasksOpts,
): Promise<RunRecurringTasksResult> {
  const { cwd, force = false, maxTasks = 4 } = opts;

  // Check supply threshold
  if (!force && !shouldGenerateRecurringTasks(cwd)) {
    return {
      generated: 0,
      injected: 0,
      reason: "Task supply sufficient, skipping recurring task generation",
    };
  }

  // Generate candidates
  const candidates = generateRecurringTaskCandidates({ cwd, maxTasks });
  if (candidates.length === 0) {
    return {
      generated: 0,
      injected: 0,
      reason: "No recurring tasks due for generation (all on cooldown)",
    };
  }

  // Inject tasks
  const injected = await injectRecurringTasks(cwd, candidates);

  return {
    generated: candidates.length,
    injected,
    reason: force
      ? `Force-generated ${candidates.length} recurring task(s)`
      : `Low open task supply (${countOpenTasks(cwd)} open), generated ${candidates.length} recurring task(s)`,
  };
}
