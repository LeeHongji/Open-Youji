/** Fleet prompt builder — constructs self-contained task prompts for fleet workers (ADR 0042-v2, ADR 0062). */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FleetTask, WorkerRole } from "./types.js";

/** Context passed to the prompt builder alongside the task. */
export interface FleetPromptContext {
  /** Pre-generated session ID for task claiming. */
  sessionId: string;
  /** Absolute path to the repo root. */
  cwd: string;
  /** Worker role for prompt specialization (ADR 0062). Defaults to "default". */
  workerRole?: WorkerRole;
}

/** Extract mission and recent log entries from a project README. */
export function extractProjectContext(readmePath: string): string {
  let content: string;
  try {
    content = readFileSync(readmePath, "utf-8");
  } catch {
    return "(Project README not available)";
  }

  const lines = content.split("\n");
  const parts: string[] = [];

  // Extract header fields (Status, Priority, Mission, Done when)
  for (const line of lines) {
    if (/^(Status|Priority|Mission|Done when):/i.test(line)) {
      parts.push(line.trim());
    }
  }

  // Extract last 3 log entries (### YYYY-MM-DD headers)
  const logStart = lines.findIndex((l) => /^## Log/i.test(l));
  if (logStart !== -1) {
    const logEntries: string[] = [];
    let entryCount = 0;
    let currentEntry: string[] = [];

    for (let i = logStart + 1; i < lines.length && entryCount < 3; i++) {
      const line = lines[i];
      // Stop at next top-level section
      if (/^## /.test(line) && !/^### /.test(line)) break;

      if (/^### \d{4}-\d{2}-\d{2}/.test(line)) {
        if (currentEntry.length > 0) {
          logEntries.push(currentEntry.join("\n"));
          entryCount++;
        }
        currentEntry = [line];
      } else if (currentEntry.length > 0) {
        currentEntry.push(line);
      }
    }
    // Push the last entry
    if (currentEntry.length > 0 && entryCount < 3) {
      logEntries.push(currentEntry.join("\n"));
    }

    if (logEntries.length > 0) {
      parts.push("");
      parts.push("Recent log entries:");
      parts.push(logEntries.join("\n\n"));
    }
  }

  return parts.join("\n") || "(No project context available)";
}

/** Build task detail lines shared across all prompt roles. */
function buildTaskDetails(task: FleetTask): string {
  const lines = [
    `Project: ${task.project}`,
    `Task: ${task.text}`,
    task.why ? `Why: ${task.why}` : "",
    task.doneWhen ? `Done when: ${task.doneWhen}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/** Constraints shared by all fleet worker roles. */
const SHARED_CONSTRAINTS = `- Work ONLY on this specific task. Do not select a different task.
- Do NOT run /orient, /compound, or other meta-skills.
- Commit incrementally. After each logical unit of work, git add && git commit.
- When done, mark the task as completed in TASKS.md: change \`- [ ]\` to \`- [x]\`
  and add a \`Completed: YYYY-MM-DD\` line. This is CRITICAL — unmarked tasks
  get re-assigned to other workers, wasting sessions.
- If the task requires deep reasoning you cannot perform, write your findings
  to the project README log and mark the task for escalation:
  add tag [escalate: <reason>] to the task in TASKS.md.
- Before finishing, write a 2-3 line log entry to the project README.
- Do NOT push to remote — pushing is handled by the scheduler post-session.`;

/** Build a knowledge worker prompt (RECORD/PERSIST/GOVERN tasks on Fast Model). */
function buildKnowledgeWorkerPrompt(
  taskDetails: string,
  projectContext: string,
  sessionId: string,
): string {
  return `You are a knowledge worker in the youji research system.
Your role is documentation, state management, and convention enforcement.
Your cwd is the youji repo root. Follow CLAUDE.md conventions strictly.

Your strengths are RECORD (documentation, log entries, archival), PERSIST (cross-references,
inventories, status tracking), and GOVERN (convention compliance, tag validation, audits).
Focus on accuracy, completeness, and consistency — not code generation.

Relevant skills: /self-audit, /review, /audit-references, /horizon-scan. Use them when the task calls for it.

## Your Task
${taskDetails}

## Project Context
${projectContext}

## Constraints
${SHARED_CONSTRAINTS}
- If you discover adjacent mechanical work while completing your task, create up to 2
  new fleet-eligible tasks in TASKS.md with clear Done-when conditions.

## Quality Standards
- Every factual claim must be traceable to a source (file path, git log, data file).
- Cross-references must use explicit relative paths — never assume a file exists without checking.
- When updating status or documentation, verify current state before overwriting.
- Preserve existing formatting conventions (YAML frontmatter, markdown headers, log entry schema).
- When archiving, keep the original content intact — move, do not delete.

## Session
SESSION_ID=${sessionId}`;
}

/** Build the default fleet worker prompt (backward-compatible, for unclassified tasks). */
function buildDefaultPrompt(
  taskDetails: string,
  projectContext: string,
  sessionId: string,
): string {
  return `You are a fleet worker in the youji research system.
Your cwd is the youji repo root. Follow CLAUDE.md conventions.
You have access to all project skills: /architecture, /audit-references, /compound, /compound-simple, /coordinator, /critique, /design, /develop, /diagnose, /feedback, /gravity, /horizon-scan, /lit-review, /orient, /orient-simple, /postmortem, /project, /publish, /refresh-skills, /report, /review, /self-audit, /simplify, /slack-diagnosis, /synthesize. Use them when relevant to the task.

## Your Task
${taskDetails}

## Project Context
${projectContext}

## Constraints
${SHARED_CONSTRAINTS}
- If you discover adjacent mechanical work while completing your task, create up to 2
  new fleet-eligible tasks in TASKS.md with clear Done-when conditions.

## Session
SESSION_ID=${sessionId}`;
}

/** Build an implementation worker prompt (EXECUTE tasks on Fast Model fleet). */
function buildImplementationWorkerPrompt(
  taskDetails: string,
  projectContext: string,
  sessionId: string,
): string {
  return `You are an implementation worker in the youji research system.
Your role is executing well-scoped code changes, scripts, and mechanical tasks.
Your cwd is the youji repo root. Follow CLAUDE.md conventions strictly.

Your strengths are EXECUTE tasks: writing scripts, fixing bugs, implementing features,
refactoring code, and creating test files. Focus on correctness and completeness.

Relevant skills: /develop, /design. Use them when the task calls for it.

## Your Task
${taskDetails}

## Project Context
${projectContext}

## Constraints
${SHARED_CONSTRAINTS}
- If you discover adjacent mechanical work while completing your task, create up to 2
  new fleet-eligible tasks in TASKS.md with clear Done-when conditions.

## Quality Standards
- Write clean, well-tested code that follows existing patterns in the codebase.
- Run any existing tests after making changes to verify nothing is broken.
- If the task requires deep reasoning you cannot perform, write your findings
  to the project README log and mark the task for escalation.

## Session
SESSION_ID=${sessionId}`;
}

/** Build a self-contained prompt for a fleet worker session.
 *  Prompt content varies by workerRole (ADR 0062):
 *  - "knowledge": stripped-down prompt for RECORD/PERSIST/GOVERN tasks
 *  - "implementation": code-focused prompt for EXECUTE tasks
 *  - "default": backward-compatible general prompt
 */
export function buildFleetPrompt(task: FleetTask, context: FleetPromptContext): string {
  const readmePath = join(context.cwd, "projects", task.project, "README.md");
  const projectContext = extractProjectContext(readmePath);
  const taskDetails = buildTaskDetails(task);
  const role = context.workerRole ?? "default";

  switch (role) {
    case "knowledge":
      return buildKnowledgeWorkerPrompt(taskDetails, projectContext, context.sessionId);
    case "implementation":
      return buildImplementationWorkerPrompt(taskDetails, projectContext, context.sessionId);
    default:
      return buildDefaultPrompt(taskDetails, projectContext, context.sessionId);
  }
}
