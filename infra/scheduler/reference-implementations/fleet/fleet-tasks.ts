/** Fleet task scanner — reads TASKS.md files and extracts fleet-assignable tasks (ADR 0042-v2). */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { taskIdFromText } from "./task-claims.js";
import type { FleetTask, SkillType } from "./types.js";

// ── Tag patterns ─────────────────────────────────────────────────────────────

const BLOCKED_RE = /\[blocked-by:\s*[^\]]+\]/i;
const IN_PROGRESS_RE = /\[in-progress:\s*[^\]]+\]/i;
const APPROVAL_NEEDED_RE = /\[approval-needed\]/i;
const APPROVED_RE = /\[approved:\s*[^\]]+\]/i;
const REQUIRES_OPUS_RE = /\[requires-opus\]/i;
const FLEET_ELIGIBLE_RE = /\[fleet-eligible\]/i;
const ZERO_RESOURCE_RE = /\[zero-resource\]/i;
const SKILL_RE = /\[skill:\s*(record|persist|govern|execute|diagnose|analyze|orient|multi)\]/i;

/** Valid skill types for validation (ADR 0062). */
const VALID_SKILL_TYPES = new Set<SkillType>([
  "record", "persist", "govern", "execute", "diagnose", "analyze", "orient", "multi",
]);

/** Extract [skill: ...] tag from task text. Returns null if no valid tag found. */
function extractSkillType(text: string): SkillType | null {
  const match = text.match(SKILL_RE);
  if (!match) return null;
  const candidate = match[1].toLowerCase() as SkillType;
  return VALID_SKILL_TYPES.has(candidate) ? candidate : null;
}

// ── Auto-classification heuristics (ADR 0062) ───────────────────────────────

/**
 * Auto-classify task skill type from text heuristics.
 * Returns the highest-cost matching skill, or null if no heuristic matches.
 * Priority order (highest-cost first): DIAGNOSE > ANALYZE > EXECUTE > GOVERN > PERSIST > RECORD.
 * Conservative: returns null rather than guessing when uncertain.
 * orient and multi are never auto-classified — they require explicit tags.
 */
export function classifyTaskSkill(text: string): SkillType | null {
  const checks: ReadonlyArray<[SkillType, RegExp]> = [
    ["diagnose", /\b(?:diagnos[ei]|root\s+cause|investigat[ei]|debug(?:ging)?|why\s+did|failure\s+analysis|troubleshoot)/i],
    ["analyze",  /\b(?:analyz[ei]\b|interpret\b|synthesiz[ei]\b|compare\s+findings?|evaluat[ei]\b|review\s+findings?)/i],
    ["execute",  /\b(?:implement\b|write\s+(?:script|function|test)|fix\s+(?:bug|error|issue)|add\s+(?:feature|endpoint|handler|check\b)|refactor\b|write\s+code|modif[yi]\s+\S+\.(?:ts|js|py))/i],
    ["govern",   /\b(?:compliance\b|convention\b|validate\s+tags?|(?:self[- ]?)?audit\b)/i],
    ["persist",  /\b(?:cross[- ]?referenc|check\s+status|monitor(?:ing)?\b|inventory\b|report\s+on\b|compile\b(?!\s+code)|summariz[ei]\s+existing)/i],
    ["record",   /\b(?:update\s+(?:docs?|readme|status)|document\b|write\s+log|archiv[ei]|move\s+to\b|add\s+to\s+readme|refresh\b|format\s|consistency\s+check)/i],
  ];

  for (const [skill, pattern] of checks) {
    if (pattern.test(text)) return skill;
  }
  return null;
}

/** Priority ordering for sorting. Lower number = higher priority. */
const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

// ── Task line parsing ────────────────────────────────────────────────────────

/** Check if a line starts an open task (`- [ ]`). */
function isOpenTaskLine(line: string): boolean {
  return /^\s*-\s+\[ \]\s+/.test(line);
}

/** Check if a line is a continuation of the previous task (indented, not a new list item). */
function isIndentedContinuation(line: string): boolean {
  return /^\s{2,}/.test(line) && !isOpenTaskLine(line) && !/^\s*-\s+\[/.test(line);
}

/** Extract the task text from a `- [ ]` line. */
function extractTaskText(line: string): string {
  return line.replace(/^\s*-\s+\[ \]\s+/, "").trim();
}

/** Extract priority from a continuation line like `Priority: high`. */
function extractPriority(lines: string[]): "high" | "medium" | "low" {
  for (const line of lines) {
    const match = line.match(/^\s*Priority:\s*(high|medium|low)/i);
    if (match) return match[1].toLowerCase() as "high" | "medium" | "low";
  }
  return "medium";
}

/** Extract "Done when:" condition from continuation lines. */
function extractDoneWhen(lines: string[]): string | null {
  for (const line of lines) {
    const match = line.match(/^\s*Done when:\s*(.+)/i);
    if (match) return match[1].trim();
  }
  return null;
}

/** Extract "Why:" context from continuation lines. */
function extractWhy(lines: string[]): string | null {
  for (const line of lines) {
    const match = line.match(/^\s*Why:\s*(.+)/i);
    if (match) return match[1].trim();
  }
  return null;
}

/** Common file extensions to check for file-existence conditions. */
const FILE_EXTENSIONS = [
  ".md", ".txt", ".json", ".yaml", ".yml",
  ".ts", ".js", ".tsx", ".jsx",
  ".py", ".toml", ".cfg", ".ini",
  ".csv", ".tsv", ".log",
];

/** Citation markers that precede file paths used as references, not completion conditions.
 *  Matches patterns like "See `experiments/foo.md`", "per foo.md", "cf. bar.md".
 *  See diagnosis-fleet-starvation-file-existence-false-positive-2026-03-02. */
const CITATION_BEFORE_RE = /\b(?:see|per|cf\.?|from)\s+`?$/i;

/** Extract a file path from "Done when:" text if it contains a file-existence condition.
 *  Returns the file path if found, null otherwise.
 *  Only matches when either: (a) the path contains a directory separator (/), indicating
 *  a new file in a subdirectory, or (b) the text contains existence language ("exists",
 *  "created", "status: planned") near the path.
 *  Skips file paths in citation context ("See X for details") to avoid false positives
 *  where existing reference files cause tasks to be incorrectly filtered. */
function extractFilePathFromDoneWhen(doneWhen: string | null): string | null {
  if (!doneWhen) return null;

  const hasExistenceLanguage = /\b(exists?|created|status:\s*planned)\b/i.test(doneWhen);

  for (const ext of FILE_EXTENSIONS) {
    const pattern = new RegExp(`([a-zA-Z0-9_\\-./]+\\${ext})`);
    const match = doneWhen.match(pattern);
    if (match) {
      const filePath = match[1];

      // Skip file paths in citation context (e.g., "See experiments/foo/EXPERIMENT.md for details")
      const beforeMatch = doneWhen.slice(0, match.index!);
      if (CITATION_BEFORE_RE.test(beforeMatch)) {
        continue;
      }

      // Accept if path has a directory component (new file in subdir)
      // or if the text uses existence language (explicit creation check)
      if (filePath.includes("/") || hasExistenceLanguage) {
        return filePath;
      }
    }
  }

  return null;
}

/** Check if a file exists relative to the project directory. */
function checkFileExists(projectDir: string, filePath: string): boolean {
  try {
    const fullPath = join(projectDir, filePath);
    return existsSync(fullPath);
  } catch {
    return false;
  }
}

/** ISO 8601 datetime pattern for detecting time-gated tasks. */
const ISO_DATETIME_RE = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)\b/g;

/** Detect if a "Done when:" condition references a future timestamp, indicating
 *  the task cannot be completed until that time. This prevents fleet gridlock
 *  on time-gated tasks like "monitor X for 48 hours".
 *  See diagnosis-fleet-gridlock-on-time-gated-task-2026-03-02. */
function isTimeGated(doneWhen: string | null): boolean {
  if (!doneWhen) return false;

  const gateKeywords = /\b(after|elapsed|until|wait|expires?)\b/i;
  if (!gateKeywords.test(doneWhen)) return false;

  const now = Date.now();
  const matches = doneWhen.matchAll(ISO_DATETIME_RE);
  for (const m of matches) {
    try {
      const ts = new Date(m[1]).getTime();
      if (!isNaN(ts) && ts > now) return true;
    } catch { /* ignore parse failures */ }
  }
  return false;
}

// ── Project priority ─────────────────────────────────────────────────────────

/** Read a project README.md and extract the Priority field. */
export function readProjectPriority(projectDir: string): "high" | "medium" | "low" {
  try {
    const readme = readFileSync(join(projectDir, "README.md"), "utf-8");
    const match = readme.match(/^Priority:\s*(high|medium|low)/im);
    if (match) return match[1].toLowerCase() as "high" | "medium" | "low";
  } catch {
    // README doesn't exist or is unreadable
  }
  return "medium";
}

// ── Core scanner ─────────────────────────────────────────────────────────────

/** Parse a single TASKS.md file and return open, unblocked tasks.
 *  @param content - The TASKS.md file content
 *  @param project - The project name
 *  @param projectDir - Optional project directory path for file-existence checks */
export function parseTasksFile(content: string, project: string, projectDir?: string): FleetTask[] {
  const lines = content.split("\n");
  const tasks: FleetTask[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!isOpenTaskLine(line)) {
      i++;
      continue;
    }

    const taskText = extractTaskText(line);
    const continuationLines: string[] = [];

    // Collect continuation lines (indented lines after the task)
    let j = i + 1;
    while (j < lines.length && isIndentedContinuation(lines[j])) {
      continuationLines.push(lines[j]);
      j++;
    }

    // Combine task text + continuations for tag checking
    const fullText = [taskText, ...continuationLines.map((l) => l.trim())].join(" ");

    // Skip blocked tasks
    if (BLOCKED_RE.test(fullText)) {
      i = j;
      continue;
    }

    // Skip in-progress tasks
    if (IN_PROGRESS_RE.test(fullText)) {
      i = j;
      continue;
    }

    // Skip approval-needed tasks without approval
    if (APPROVAL_NEEDED_RE.test(fullText) && !APPROVED_RE.test(fullText)) {
      i = j;
      continue;
    }

    const requiresOpus = REQUIRES_OPUS_RE.test(fullText);
    const fleetEligible = !requiresOpus;
    const zeroResource = ZERO_RESOURCE_RE.test(fullText);
    const skillType = extractSkillType(fullText) ?? classifyTaskSkill(fullText);
    const priority = extractPriority(continuationLines);
    const doneWhen = extractDoneWhen(continuationLines);
    const why = extractWhy(continuationLines);
    const taskId = taskIdFromText(taskText);

    // Skip tasks where "Done when" references an existing file
    if (projectDir && doneWhen) {
      const filePath = extractFilePathFromDoneWhen(doneWhen);
      if (filePath && checkFileExists(projectDir, filePath)) {
        i = j;
        continue;
      }
    }

    // Skip time-gated tasks whose completion date is in the future
    if (isTimeGated(doneWhen)) {
      i = j;
      continue;
    }

    tasks.push({
      taskId,
      text: taskText,
      doneWhen,
      why,
      project,
      priority,
      fleetEligible,
      requiresOpus,
      zeroResource,
      skillType,
    });

    i = j;
  }

  return tasks;
}

/** Scan all projects/{name}/TASKS.md files and return fleet-assignable tasks.
 *  Tasks are sorted by: project priority > task priority > fleet-eligible first. */
export function scanAvailableTasks(cwd: string): FleetTask[] {
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
    return [];
  }

  const allTasks: FleetTask[] = [];
  const projectPriorities = new Map<string, "high" | "medium" | "low">();

  for (const projectName of projectDirs) {
    const projectDir = join(projectsDir, projectName);
    const tasksPath = join(projectDir, "TASKS.md");

    let content: string;
    try {
      content = readFileSync(tasksPath, "utf-8");
    } catch {
      continue; // No TASKS.md
    }

    const projectPriority = readProjectPriority(projectDir);
    projectPriorities.set(projectName, projectPriority);

    const tasks = parseTasksFile(content, projectName, projectDir);
    allTasks.push(...tasks);
  }

  // Sort: project priority > task priority > fleet-eligible first
  allTasks.sort((a, b) => {
    const projPrioA = PRIORITY_ORDER[projectPriorities.get(a.project) ?? "medium"];
    const projPrioB = PRIORITY_ORDER[projectPriorities.get(b.project) ?? "medium"];
    if (projPrioA !== projPrioB) return projPrioA - projPrioB;

    const taskPrioA = PRIORITY_ORDER[a.priority];
    const taskPrioB = PRIORITY_ORDER[b.priority];
    if (taskPrioA !== taskPrioB) return taskPrioA - taskPrioB;

    // Fleet-eligible tasks first (when priority is equal)
    if (a.fleetEligible !== b.fleetEligible) return a.fleetEligible ? -1 : 1;

    return 0;
  });

  return allTasks;
}
