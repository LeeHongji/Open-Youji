/** Idle exploration task generation — produces knowledge-producing tasks for fleet
 *  workers when the explicit task queue is empty (ADR 0048).
 *
 *  Topics are gathered from project READMEs (open questions, research areas, stale
 *  blockers) and filtered by a cooldown to avoid redundant exploration. */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { extractProjectContext } from "./fleet-prompt.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type ExplorationType =
  | "horizon-scan"
  | "self-audit"
  | "stale-blocker-check"
  | "open-question"
  | "cross-ref-verify"
  | "doc-coherence"
  | "convention-enforcement";

export interface ExplorationTopic {
  type: ExplorationType;
  project: string;
  /** Human-readable context: the research area, open question, or blocker text. */
  context: string;
  /** Selection weight (higher = more likely to be picked). */
  weight: number;
}

// ── Weight constants ─────────────────────────────────────────────────────────

const TYPE_WEIGHTS: Record<ExplorationType, number> = {
  "cross-ref-verify": 4,
  "doc-coherence": 4,
  "convention-enforcement": 2,  // reduced from 4 (33% commit rate — R4)
  "horizon-scan": 3,
  "open-question": 2,
  "self-audit": 1,
  "stale-blocker-check": 1,
};

/** Exploration types that require Opus-level reasoning to produce useful output.
 *  Based on empirical data (diagnosis-fleet-idle-exploration-zero-knowledge-2026-03-03):
 *  - open-question: 95% zero-knowledge on Fast Model (requires research synthesis)
 *  - self-audit: 100% zero-knowledge on Fast Model (conventions already well-maintained)
 *  Knowledge engine types (cross-ref-verify, doc-coherence, convention-enforcement)
 *  use Fast Model's strongest skills (RECORD/PERSIST at 83-85%) and remain available to all backends.
 *  Note: 24h validation (2026-03-06) showed actual commit rates of 33-61%, well below
 *  83%. The gap is structural: skill scores measure task completion ability, not defect
 *  detection rate. Well-maintained projects produce legitimately empty sessions. */
export const REQUIRES_OPUS_EXPLORATION: Set<ExplorationType> = new Set([
  "open-question",
  "self-audit",
]);

// ── Cooldown ─────────────────────────────────────────────────────────────────

export const IDLE_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours (default)

/** Per-type cooldown periods tuned by empirical success rates.
 *  Updated 2026-03-06 per knowledge-engine-24h-validation analysis (R1-R5).
 *  Actual 24h commit rates: doc-coherence 61%, cross-ref-verify 51%,
 *  convention-enforcement 33%, horizon-scan 81%. */
export const TYPE_COOLDOWN_MS: Record<ExplorationType, number> = {
  "cross-ref-verify": 60 * 60 * 1000,        // 1h (51% commit rate — R2)
  "doc-coherence": 30 * 60 * 1000,           // 30 min (61% commit rate, best KE type — R3)
  "convention-enforcement": 2 * 60 * 60 * 1000,  // 2h (33% commit rate, over-sampled — R1)
  "horizon-scan": 60 * 60 * 1000,            // 1h (81% commit rate, highest success — R5)
  "open-question": 6 * 60 * 60 * 1000,      // 6 hours (5% success rate)
  "self-audit": 24 * 60 * 60 * 1000,        // 24 hours (0% success rate)
  "stale-blocker-check": 6 * 60 * 60 * 1000, // 6 hours (7% success rate)
};

export function topicKey(topic: ExplorationTopic): string {
  return `${topic.type}:${topic.project}:${topic.context.slice(0, 60)}`;
}

function getCooldownMs(topic: ExplorationTopic): number {
  return TYPE_COOLDOWN_MS[topic.type] ?? IDLE_COOLDOWN_MS;
}

function isOnCooldown(topic: ExplorationTopic, cooldownMap: Map<string, number>, now: number): boolean {
  const lastExplored = cooldownMap.get(topicKey(topic));
  if (lastExplored === undefined) return false;
  return (now - lastExplored) < getCooldownMs(topic);
}

// ── Cooldown persistence ────────────────────────────────────────────────────

const COOLDOWN_FILE = ".scheduler/idle-cooldown.json";

/** Load cooldown map from disk. Returns empty map if file doesn't exist. */
export function loadCooldownMap(cwd: string, nowOverride?: number): Map<string, number> {
  const filePath = join(cwd, COOLDOWN_FILE);
  try {
    if (!existsSync(filePath)) return new Map();
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    const map = new Map<string, number>();
    const now = nowOverride ?? Date.now();
    const maxCooldown = Math.max(...Object.values(TYPE_COOLDOWN_MS));
    for (const [key, ts] of Object.entries(data)) {
      if (typeof ts === "number" && (now - ts) < maxCooldown) {
        map.set(key, ts);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Save cooldown map to disk. Prunes expired entries. */
export function saveCooldownMap(cwd: string, map: Map<string, number>): void {
  const filePath = join(cwd, COOLDOWN_FILE);
  const now = Date.now();
  const maxCooldown = Math.max(...Object.values(TYPE_COOLDOWN_MS));
  const obj: Record<string, number> = {};
  for (const [key, ts] of map.entries()) {
    if ((now - ts) < maxCooldown) {
      obj[key] = ts;
    }
  }
  try {
    mkdirSync(join(cwd, ".scheduler"), { recursive: true });
    writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n");
  } catch {
    // Non-critical — cooldown still works in-memory
  }
}

// ── Topic gathering ──────────────────────────────────────────────────────────

/** Extract open questions from a project README. */
function extractOpenQuestions(readmePath: string): string[] {
  let content: string;
  try {
    content = readFileSync(readmePath, "utf-8");
  } catch {
    return [];
  }

  const lines = content.split("\n");
  const oqIdx = lines.findIndex((l) => /^## Open questions/i.test(l));
  if (oqIdx === -1) return [];

  const questions: string[] = [];
  for (let i = oqIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^## /.test(line) && !/^### /.test(line)) break;
    const match = line.match(/^- (?!\*\*Resolved|\~\~)(.+)/);
    if (match) {
      const q = match[1].trim();
      if (q.length > 10 && !q.startsWith("~~")) {
        questions.push(q);
      }
    }
  }
  return questions;
}

/** Extract the Mission: line from a project README. */
function extractMission(readmePath: string): string | null {
  let content: string;
  try {
    content = readFileSync(readmePath, "utf-8");
  } catch {
    return null;
  }

  const match = content.match(/^Mission:\s*(.+)/im);
  return match ? match[1].trim() : null;
}

/** Check if a blocker can be mechanically verified by a fleet worker.
 *  Returns true for date-based and task-reference blockers.
 *  Returns false for human-dependent blockers (human researchers, PI, external teams).
 *  See diagnosis-fleet-idle-exploration-zero-knowledge-2026-03-03 R2. */
function isVerifiableBlocker(blockerText: string): boolean {
  const lower = blockerText.toLowerCase();
  // Date-based blockers: "date: March 20", "2026-03-20", "after YYYY-MM-DD"
  if (/\bdate:\s/i.test(blockerText) || /\b\d{4}-\d{2}-\d{2}\b/.test(blockerText)) return true;
  // Task-reference blockers: "task X complete", "X marked [x]"
  if (/\btask\b.*\bcomplete/i.test(blockerText) || /\bmarked\s+\[x\]/i.test(blockerText)) return true;
  // File-existence blockers
  if (/\bexists?\b/i.test(blockerText) && /\.(md|json|yaml|csv|py|ts)\b/.test(blockerText)) return true;
  // Human-dependent patterns: human researcher, PI, annotator, scheduling, recruitment
  if (/\b(human researcher|PI |annotat|scheduling|recruit|human|manual)\b/i.test(lower)) return false;
  // External team patterns: "pending since", "waiting on"
  if (/\b(pending since|waiting on|awaiting)\b/i.test(lower)) return false;
  // Default: not verifiable (conservative — avoid wasted sessions)
  return false;
}

/** Extract stale external blockers from a TASKS.md file.
 *  Only returns blockers that can be mechanically verified by a fleet worker. */
function extractStaleBlockers(tasksPath: string): string[] {
  let content: string;
  try {
    content = readFileSync(tasksPath, "utf-8");
  } catch {
    return [];
  }

  const blockers: string[] = [];
  const re = /\[blocked-by:\s*external:\s*([^\]]+)\]/gi;
  let m;
  while ((m = re.exec(content)) !== null) {
    const text = m[1].trim();
    if (isVerifiableBlocker(text)) {
      blockers.push(text);
    }
  }
  return blockers;
}

/** Count cross-references (relative paths) in a file that may need verification. */
function hasCrossReferences(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, "utf-8");
    return /\]\([.\/]/.test(content) || /See [`']?[a-z].*\.(md|yaml|json|py|ts)/.test(content);
  } catch {
    return false;
  }
}

/** Gather all exploration topics across projects. */
export function gatherExplorationTopics(cwd: string): ExplorationTopic[] {
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

  const topics: ExplorationTopic[] = [];

  for (const project of projectDirs) {
    const readmePath = join(projectsDir, project, "README.md");
    const tasksPath = join(projectsDir, project, "TASKS.md");

    // Horizon scan topics (from project mission)
    const mission = extractMission(readmePath);
    if (mission) {
      topics.push({
        type: "horizon-scan",
        project,
        context: mission,
        weight: TYPE_WEIGHTS["horizon-scan"],
      });
    }

    // Open question topics
    const questions = extractOpenQuestions(readmePath);
    for (const q of questions) {
      topics.push({
        type: "open-question",
        project,
        context: q,
        weight: TYPE_WEIGHTS["open-question"],
      });
    }

    // Self-audit topic (one per project)
    topics.push({
      type: "self-audit",
      project,
      context: `Convention compliance audit for project ${project}`,
      weight: TYPE_WEIGHTS["self-audit"],
    });

    // Stale blocker check topics
    const blockers = extractStaleBlockers(tasksPath);
    for (const b of blockers) {
      topics.push({
        type: "stale-blocker-check",
        project,
        context: b,
        weight: TYPE_WEIGHTS["stale-blocker-check"],
      });
    }

    // Knowledge engine topics: cross-ref-verify, doc-coherence, convention-enforcement
    if (hasCrossReferences(readmePath)) {
      topics.push({
        type: "cross-ref-verify",
        project,
        context: `Verify cross-references in ${project} project files point to existing paths`,
        weight: TYPE_WEIGHTS["cross-ref-verify"],
      });
    }

    topics.push({
      type: "doc-coherence",
      project,
      context: `Check documentation consistency: README status matches TASKS.md state, log entries reference existing experiments`,
      weight: TYPE_WEIGHTS["doc-coherence"],
    });

    if (existsSync(tasksPath)) {
      topics.push({
        type: "convention-enforcement",
        project,
        context: `Verify task formatting: fleet routing tags present, Done when conditions, imperative verbs, no stale [in-progress] tags`,
        weight: TYPE_WEIGHTS["convention-enforcement"],
      });
    }
  }

  return topics;
}

// ── Topic selection ──────────────────────────────────────────────────────────

/** Select up to `count` topics, filtered by cooldown and backend capability, weighted by type.
 *  Uses weighted random selection without replacement.
 *  @param backend - When "opencode" (Fast Model), filters out exploration types that require
 *    Opus-level reasoning. See diagnosis-fleet-idle-exploration-zero-knowledge-2026-03-03. */
export function selectTopics(
  topics: ExplorationTopic[],
  cooldownMap: Map<string, number>,
  count: number,
  now: number = Date.now(),
  backend?: string,
): ExplorationTopic[] {
  let available = topics.filter((t) => !isOnCooldown(t, cooldownMap, now));

  // Filter out exploration types that require Opus when running on a non-Opus backend
  if (backend === "opencode") {
    available = available.filter((t) => !REQUIRES_OPUS_EXPLORATION.has(t.type));
  }

  if (available.length === 0) return [];

  const selected: ExplorationTopic[] = [];
  const remaining = [...available];

  while (selected.length < count && remaining.length > 0) {
    const totalWeight = remaining.reduce((sum, t) => sum + t.weight, 0);
    let roll = Math.random() * totalWeight;

    let pick = 0;
    for (let i = 0; i < remaining.length; i++) {
      roll -= remaining[i].weight;
      if (roll <= 0) {
        pick = i;
        break;
      }
    }

    selected.push(remaining[pick]);
    remaining.splice(pick, 1);
  }

  return selected;
}

// NOTE: Cooldown persistence functions are defined above (lines 66-104).
// Duplicate block removed — was introduced by fleet worker merge conflict.

// ── Prompt building ──────────────────────────────────────────────────────────

const PROMPT_TEMPLATES: Record<ExplorationType, (topic: ExplorationTopic) => string> = {
  "cross-ref-verify": (topic) => `## Knowledge Engine Task
Type: Cross-reference verification
Project: ${topic.project}

## What to do
Verify that cross-references (relative paths in markdown links, "See X" references,
file citations) in the project's key files point to files that actually exist.

Check these files in order:
1. projects/${topic.project}/README.md — all relative links and path references
2. projects/${topic.project}/TASKS.md — references to experiment dirs, analysis files, diagnosis files
3. Recent log entries — references to experiment directories and analysis files

For each broken reference:
- Determine if the target was moved, renamed, or deleted
- Fix the reference if the target can be found nearby (e.g., different directory)
- Remove the reference if the target no longer exists

## Output rules
- If you find and fix broken references: commit the fixes with a descriptive message.
  Add a brief log entry listing fixes made.
- If all references are valid: end with ZERO commits. Valid cross-references are good.`,

  "doc-coherence": (topic) => `## Knowledge Engine Task
Type: Documentation coherence check
Project: ${topic.project}

## What to do
Check that the project's documentation is internally consistent:

1. **README status matches reality**: Does the Status field match the actual state?
   Are completed milestones reflected? Are "Current Status" sections current?
2. **Log entries reference real artifacts**: Do recent log entries (last 3-5) reference
   experiment directories, analysis files, or diagnosis files that actually exist?
3. **TASKS.md consistency**: Are completed tasks ([x]) properly documented with
   completion dates? Do "Done when" conditions match what was actually done?
4. **Open questions freshness**: Are any "Open questions" already answered by
   completed experiments or analysis files?

## Output rules
- If you find and fix inconsistencies: commit fixes with a descriptive message.
  Add a brief log entry listing what was corrected.
- If documentation is consistent: end with ZERO commits. Consistency is good.
- Maximum 1 commit per session — batch all fixes together.`,

  "convention-enforcement": (topic) => `## Knowledge Engine Task
Type: Convention enforcement
Project: ${topic.project}

## What to do
Verify that TASKS.md follows youji conventions:

1. **Fleet routing tags**: Every open task (- [ ]) should have [fleet-eligible] or
   [requires-opus]. Tag any untagged tasks using the fleet-eligibility checklist.
2. **Done when conditions**: Every task should have a "Done when:" line with a
   verifiable completion condition.
3. **Imperative verb**: Task descriptions should start with an imperative verb
   (Add, Fix, Write, Run, Update, etc.).
4. **Stale [in-progress] tags**: Check for [in-progress: YYYY-MM-DD] tags older
   than 3 days — these may be orphaned from timed-out sessions. Remove if no
   active session is working on them.
5. **Skill tags**: Add [skill: record|persist|govern|execute|diagnose|analyze|orient|multi]
   tags to tasks that lack them, using the ADR 0062 heuristic table.

## Output rules
- If you find and fix convention violations: commit fixes with a descriptive message.
  Add a brief log entry listing violations found and fixed.
- If all conventions are followed: end with ZERO commits. Compliance is good.
- Only fix mechanical issues (missing tags, formatting). Do not change task content.`,

  "horizon-scan": (topic) => `## Exploration Task
Type: Horizon scan
Project: ${topic.project}
Research area: ${topic.context}

## What to do
Search for recent papers, tools, or developments related to the research area above.
Use WebFetch to check https://arxiv.org/search/ (or https://scholar.google.com/) for
recent papers. Focus on:
- Papers published in the last 3 months
- Developments directly relevant to the project's mission and open questions
- New tools, models, datasets, or methods that could be useful

## Output rules
- If you find a genuinely relevant paper or development:
  - Create a literature note in projects/${topic.project}/literature/ following the
    literature note schema in CLAUDE.md
  - Verify the URL (fetch the page, confirm title and at least one author match)
  - Add a brief log entry to the project README under ## Log
  - Commit your changes
- If you find nothing relevant: end the session with ZERO commits.
  A clean session with no findings is better than noise.`,

  "self-audit": (topic) => `## Exploration Task
Type: Convention compliance audit
Project: ${topic.project}

## What to do
Read the project's README.md and TASKS.md. Check for compliance with CLAUDE.md conventions:
- README has required sections (Status, Mission, Done when, Context, Log, Open questions)
- Tasks follow the task schema (imperative verb, Done when, fleet routing tag)
- Log entries follow the log entry schema (### YYYY-MM-DD header, Sources line)
- No orphaned [blocked-by] tags referencing resolved conditions
- No tasks missing fleet routing tags ([fleet-eligible] or [requires-opus])

## Output rules
- If you find violations: add a log entry to the project README listing the findings
  and fix any mechanical issues (add missing tags, fix formatting). Commit.
- If the project is fully compliant: end with ZERO commits. Compliance is good news
  but doesn't need documenting.`,

  "stale-blocker-check": (topic) => `## Exploration Task
Type: Stale blocker verification
Project: ${topic.project}
Blocker: ${topic.context}

## What to do
Check whether the external blocker described above has been resolved.
- Read the project README and TASKS.md for context
- If the blocker references a tool, API, or external resource: try to verify its
  availability (check URLs, read recent log entries)
- If the blocker references another task: check if that task is complete
- If the blocker references a human action: check APPROVAL_QUEUE.md for resolution

## Output rules
- If the blocker IS resolved: remove the [blocked-by: external: ...] tag from the
  task in TASKS.md. Add a log entry. Commit.
- If the blocker is NOT resolved or you cannot determine: end with ZERO commits.`,

  "open-question": (topic) => `## Exploration Task
Type: Open question investigation
Project: ${topic.project}
Question: ${topic.context}

## What to do
Research the open question above. Use available tools:
- Read existing project files, experiment records, and literature notes for context
- Use WebFetch to search for relevant papers or resources
- Check if other projects in the repo have addressed similar questions

## Output rules
- If you find a substantive insight or answer (not just restating the question):
  - Add a log entry to the project README with your finding
  - If you found a relevant paper, create a literature note (with URL verification)
  - Commit your changes
- If you don't find anything new: end with ZERO commits.
  The question remains open — that's fine.`,
};

/** Knowledge engine exploration types — use GLM's strongest skills (RECORD/PERSIST/GOVERN)
 *  for directed knowledge curation. Unlike research-oriented exploration, these are
 *  mechanical verification tasks with high expected success rates. */
export const KNOWLEDGE_ENGINE_TYPES: Set<ExplorationType> = new Set([
  "cross-ref-verify",
  "doc-coherence",
  "convention-enforcement",
]);

/** Build a self-contained prompt for an idle exploration session. */
export function buildIdlePrompt(
  topic: ExplorationTopic,
  sessionId: string,
  cwd: string,
): string {
  const readmePath = join(cwd, "projects", topic.project, "README.md");
  const projectContext = extractProjectContext(readmePath);
  const taskSection = PROMPT_TEMPLATES[topic.type](topic);

  const tasksConstraint = KNOWLEDGE_ENGINE_TYPES.has(topic.type)
    ? "- You MAY modify TASKS.md for mechanical fixes only (adding tags, fixing formatting, correcting paths)"
    : "- Do NOT modify TASKS.md (except removing resolved [blocked-by] tags for stale-blocker-check)";

  return `You are a fleet worker in the youji research system performing idle exploration.
Your cwd is the youji repo root. Follow CLAUDE.md conventions.

${taskSection}

## Project Context
${projectContext}

## Critical constraints
${tasksConstraint}
- Do NOT create experiment directories or EXPERIMENT.md files
- Do NOT run /orient, /compound, or other meta-skills
- Do NOT create new tasks
- Maximum 1 literature note or 1 log entry per session
- Only commit verified, genuinely valuable findings
- **Pre-exit checklist**: Before ending with zero commits, verify ALL of these:
  1. ✓ Attempted exploration (used at least one tool relevant to the task type)
  2. ✓ Searched for information (WebFetch for horizon-scan/open-question, file reads for self-audit/stale-blocker-check)
  3. ✓ Can document why nothing was found (you genuinely checked and found nothing)
  If you cannot check all three items above, you have NOT genuinely explored — continue working.
- An empty session is valid ONLY after completing the checklist. Do not skip exploration.
- Do NOT push to remote — pushing is handled by the scheduler post-session.

## Session
SESSION_ID=${sessionId}
EXPLORATION_TYPE=${topic.type}`;
}
