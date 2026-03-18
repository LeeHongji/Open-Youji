/**
 * Shared task-parsing utilities for TASKS.md files.
 * Extracted from fleet-tasks.ts for reuse across the scheduler.
 */

// ── Tag patterns ─────────────────────────────────────────────────────────────

export const BLOCKED_RE = /\[blocked-by:\s*[^\]]+\]/i;
export const IN_PROGRESS_RE = /\[in-progress:\s*[^\]]+\]/i;
export const APPROVAL_NEEDED_RE = /\[approval-needed\]/i;
export const APPROVED_RE = /\[approved:\s*[^\]]+\]/i;
export const REQUIRES_OPUS_RE = /\[requires-opus\]/i;
export const FLEET_ELIGIBLE_RE = /\[fleet-eligible\]/i;
export const ZERO_RESOURCE_RE = /\[zero-resource\]/i;
export const ESCALATE_RE = /\[escalate(?::\s*[^\]]+)?\]/i;

// ── Task line parsing ────────────────────────────────────────────────────────

export function isOpenTaskLine(line: string): boolean {
  return /^\s*-\s+\[ \]\s+/.test(line);
}

export function isIndentedContinuation(line: string): boolean {
  return /^\s{2,}/.test(line) && !isOpenTaskLine(line) && !/^\s*-\s+\[/.test(line);
}

export function extractTaskText(line: string): string {
  return line.replace(/^\s*-\s+\[ \]\s+/, "").trim();
}

// ── Tag extraction ──────────────────────────────────────────────────────────

const TAG_RE = /\[([^\]]+)\]/g;

const KNOWN_TAG_PREFIXES = [
  "blocked-by",
  "in-progress",
  "approval-needed",
  "approved",
  "requires-opus",
  "fleet-eligible",
  "zero-resource",
  "escalate",
  "skill",
];

function extractTags(line: string): string[] {
  const tags: string[] = [];
  let match: RegExpExecArray | null;
  // Reset lastIndex for global regex
  TAG_RE.lastIndex = 0;
  while ((match = TAG_RE.exec(line)) !== null) {
    const tagContent = match[1].toLowerCase();
    // Only include known scheduler tags, not checkbox content
    if (tagContent === " " || tagContent === "x") continue;
    if (KNOWN_TAG_PREFIXES.some((p) => tagContent.startsWith(p))) {
      tags.push(tagContent.includes(":") ? tagContent.split(":")[0].trim() : tagContent);
    }
  }
  return tags;
}

// ── File-level task parsing ─────────────────────────────────────────────────

export interface ParsedTask {
  /** Line number (0-indexed) in the original content */
  line: number;
  /** Task text (without the checkbox prefix) */
  text: string;
  /** "Done when" condition if found in continuation lines */
  doneWhen: string | null;
  /** Extracted tags (e.g., ["fleet-eligible", "requires-opus"]) */
  tags: string[];
  /** Whether the task has a [blocked-by: ...] tag */
  isBlocked: boolean;
  /** Whether the task has an [in-progress: ...] tag */
  isInProgress: boolean;
}

/**
 * Parse a TASKS.md file content into structured ParsedTask objects.
 * Only returns open tasks (- [ ] ...), not completed (- [x] ...) ones.
 */
export function parseTasksFile(content: string): ParsedTask[] {
  const lines = content.split("\n");
  const tasks: ParsedTask[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isOpenTaskLine(line)) continue;

    const text = extractTaskText(line);
    const tags = extractTags(line);
    const isBlocked = BLOCKED_RE.test(line);
    const isInProgress = IN_PROGRESS_RE.test(line);

    // Look ahead for continuation lines (e.g., "Done when: ...")
    let doneWhen: string | null = null;
    let j = i + 1;
    while (j < lines.length && isIndentedContinuation(lines[j])) {
      const trimmed = lines[j].trim();
      const doneMatch = trimmed.match(/^Done when:\s*(.+)/i);
      if (doneMatch) {
        doneWhen = doneMatch[1].trim();
      }
      j++;
    }

    tasks.push({ line: i, text, doneWhen, tags, isBlocked, isInProgress });
  }

  return tasks;
}

/**
 * Mark the Nth open task as in-progress by appending [in-progress: date] tag.
 * @param content - Full TASKS.md content
 * @param taskIndex - Index of the task among open tasks (0-based)
 * @param date - Date string in YYYY-MM-DD format
 */
export function markTaskInProgress(content: string, taskIndex: number, date: string): string {
  const lines = content.split("\n");
  let openIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    if (isOpenTaskLine(lines[i])) {
      if (openIdx === taskIndex) {
        lines[i] = `${lines[i].trimEnd()} [in-progress: ${date}]`;
        return lines.join("\n");
      }
      openIdx++;
    }
  }

  return content; // taskIndex out of range — return unchanged
}

/**
 * Mark the Nth open task as done by replacing `- [ ]` with `- [x]`.
 * @param content - Full TASKS.md content
 * @param taskIndex - Index of the task among open tasks (0-based)
 */
export function markTaskDone(content: string, taskIndex: number): string {
  const lines = content.split("\n");
  let openIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    if (isOpenTaskLine(lines[i])) {
      if (openIdx === taskIndex) {
        lines[i] = lines[i].replace(/- \[ \]/, "- [x]");
        return lines.join("\n");
      }
      openIdx++;
    }
  }

  return content; // taskIndex out of range — return unchanged
}
