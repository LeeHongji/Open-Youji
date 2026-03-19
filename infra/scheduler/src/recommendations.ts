/** Extract actionable recommendations and implied tasks from markdown files. */

/** A recommendation section found in a markdown file. */
export interface RecommendationSection {
  /** The header text (e.g., "Recommendations", "Next steps"). */
  header: string;
  /** The body content under the header. */
  body: string;
}

/** A single parsed recommendation from any source file. */
export interface Recommendation {
  /** Source identifier derived from the file path or frontmatter. */
  sourceId: string;
  /** The section header this recommendation came from. */
  sectionHeader: string;
  /** The recommendation text. */
  text: string;
}

/** @deprecated Use Recommendation instead. */
export type ExperimentRecommendation = Recommendation;

/** A schema-compliant task candidate ready for TASKS.md insertion. */
export interface TaskCandidate {
  /** The checkbox line: `- [ ] <imperative verb phrase>`. */
  line: string;
  /** The Why field with provenance. */
  why: string;
  /** The Done when condition. */
  doneWhen: string;
  /** Source identifier (experiment ID, diagnosis slug, postmortem slug). */
  sourceId: string;
  /** Tags like zero-resource, approval-needed. */
  tags: string[];
}

/**
 * An implied task detected from signal phrases in a Findings section.
 * These represent follow-up work implied by experiment results but not
 * captured in a formal Recommendations header.
 */
export interface ImpliedTask {
  /** Which pattern was matched. */
  pattern: ImpliedTaskPattern;
  /** The finding text that triggered the match. */
  findingText: string;
  /** Source identifier (experiment ID, etc.). */
  sourceId: string;
  /** Suggested task type based on the pattern. */
  suggestedTaskType: string;
}

/** The six pattern categories for implied-task detection. */
export type ImpliedTaskPattern =
  | "failed-success-criterion"
  | "insufficient-sample"
  | "identified-confound"
  | "partial-confirmation"
  | "unexplained-result"
  | "multi-phase-plan";

/** Signal phrase patterns mapped to implied-task categories. */
const IMPLIED_TASK_PATTERNS: {
  pattern: ImpliedTaskPattern;
  signals: RegExp[];
  suggestedTaskType: string;
}[] = [
  {
    pattern: "failed-success-criterion",
    signals: [
      /\bFAIL\b/,
      /\bdoes\s+not\s+meet\b/i,
      /\bbelow\s+threshold\b/i,
      /\bfails?\s+(?:the\s+)?success\s+criteri/i,
      /\bdid\s+not\s+(?:meet|pass|satisfy|achieve)\b/i,
      /\bnot\s+met\b/i,
    ],
    suggestedTaskType: "Refined experiment or protocol redesign",
  },
  {
    pattern: "insufficient-sample",
    signals: [
      /\bN\s+too\s+small\b/i,
      /\bN\s*=\s*[12]\b/,
      /\bcannot\s+draw\s+conclusions?\b/i,
      /\binsufficient\s+(?:data|sample|evidence)\b/i,
      /\btoo\s+few\s+(?:samples?|data\s+points?|observations?)\b/i,
      /\bsample\s+size\s+(?:is\s+)?(?:too\s+)?(?:small|limited|insufficient)\b/i,
    ],
    suggestedTaskType: "Larger-scale replication",
  },
  {
    pattern: "identified-confound",
    signals: [
      /\bconfound\b/i,
      /\bcannot\s+separate\b/i,
      /\bambiguous\s+causal\s+direction\b/i,
      /\btemporal\s+confound\b/i,
      /\bcannot\s+(?:disentangle|isolate|distinguish)\b/i,
      /\bconfounding\s+(?:variable|factor)\b/i,
    ],
    suggestedTaskType: "Controlled follow-up experiment",
  },
  {
    pattern: "partial-confirmation",
    signals: [
      /\bpartially\s+confirmed\b/i,
      /\bpartially\s+supported\b/i,
      /\beffect\s+exists?\s+but\b/i,
      /\bpartial(?:ly)?\s+(?:validated?|verified)\b/i,
      /\bhypothesis\s+(?:is\s+)?partially\b/i,
    ],
    suggestedTaskType: "Refined hypothesis or targeted investigation",
  },
  {
    pattern: "unexplained-result",
    signals: [
      /\bunexpected(?:ly)?\b/i,
      /\bcontrary\s+to\b/i,
      /\bmechanism\s+(?:is\s+)?unclear\b/i,
      /\breason\s+unknown\b/i,
      /\bsurprising(?:ly)?\b/i,
      /\bunexplained\b/i,
      /\bcause\s+(?:is\s+)?(?:unknown|unclear)\b/i,
    ],
    suggestedTaskType: "Investigation or diagnosis",
  },
  {
    pattern: "multi-phase-plan",
    signals: [/\bPhase\s+\d+\b/i],
    suggestedTaskType: "Check if all phases have TASKS.md entries",
  },
];

/**
 * Regex matching recommendation-like section headers (case-insensitive).
 * Matches: Recommendations, Recommendation, Proposed solutions, Proposal: ...,
 * Implications..., Prevention, Next steps.
 */
const RECOMMENDATION_HEADER_RE =
  /^(#{2,4})\s+(Recommendations?|Proposed\s+solutions?|Proposal:.*|Implications.*|Prevention|Next\s+steps)\s*$/i;

/**
 * Derive a human-readable source ID from a file path.
 * Handles experiment dirs, diagnosis files, postmortem files, analysis files, etc.
 *
 * Examples:
 *   "projects/youji/experiments/eval-v2/EXPERIMENT.md" → "eval-v2"
 *   "projects/youji/diagnosis/diagnosis-budget-gap-2026-02-17.md" → "diagnosis-budget-gap-2026-02-17"
 *   "projects/sample-project/postmortem/postmortem-retry-waste-2026-02-20.md" → "postmortem-retry-waste-2026-02-20"
 *   "projects/youji/analysis/task-discovery-workflow-gap-2026-02-22.md" → "task-discovery-workflow-gap-2026-02-22"
 */
export function extractSourceId(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const filename = parts[parts.length - 1] ?? "";

  if (filename === "EXPERIMENT.md") {
    return parts[parts.length - 2] ?? filename;
  }

  return filename.replace(/\.md$/, "");
}

/**
 * Extract recommendation sections from markdown content.
 * Works on any markdown file: EXPERIMENT.md, diagnosis, postmortem, analysis, etc.
 * Pure function — no I/O.
 */
export function extractRecommendationSections(
  content: string,
): RecommendationSection[] {
  const lines = content.split("\n");
  const sections: RecommendationSection[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(RECOMMENDATION_HEADER_RE);
    if (!match) continue;

    const headerLevel = match[1]!.length;
    const header = match[2]!.trim();
    const bodyLines: string[] = [];

    // Collect body until the next header of equal or higher level
    for (let j = i + 1; j < lines.length; j++) {
      const nextHeaderMatch = lines[j]!.match(/^(#{2,4})\s+/);
      if (nextHeaderMatch && nextHeaderMatch[1]!.length <= headerLevel) break;
      bodyLines.push(lines[j]!);
    }

    const body = bodyLines.join("\n").trim();
    if (body.length > 0) {
      sections.push({ header, body });
    }
  }

  return sections;
}

/**
 * Parse individual recommendations from a section body.
 * Handles numbered lists (1. ...), bullet lists (- ...), and checkbox lists (- [ ] ...).
 */
export function parseRecommendations(
  body: string,
  sourceId: string,
  sectionHeader: string,
): Recommendation[] {
  if (!body.trim()) return [];

  const lines = body.split("\n");
  const recs: Recommendation[] = [];
  let currentRec: string | null = null;

  const listItemRe = /^(?:\d+\.\s+|- \[[ x]\]\s+|- )/;

  for (const line of lines) {
    if (listItemRe.test(line)) {
      if (currentRec !== null) {
        recs.push({
          sourceId,
          sectionHeader,
          text: cleanRecommendationText(currentRec),
        });
      }
      currentRec = line.replace(/^(?:\d+\.\s+|- \[[ x]\]\s+|- )/, "").trim();
    } else if (currentRec !== null && line.match(/^\s+\S/)) {
      currentRec += " " + line.trim();
    } else if (currentRec !== null && line.trim() === "") {
      // Empty line within item — don't finalize yet
    } else if (currentRec !== null) {
      recs.push({
        sourceId,
        sectionHeader,
        text: cleanRecommendationText(currentRec),
      });
      currentRec = null;
    }
  }

  if (currentRec !== null) {
    recs.push({
      sourceId,
      sectionHeader,
      text: cleanRecommendationText(currentRec),
    });
  }

  return recs;
}

/** Strip markdown bold markers and clean up text. */
function cleanRecommendationText(text: string): string {
  return text.replace(/\*\*/g, "").trim();
}

/** Words ignored during keyword overlap comparison. */
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "must", "to", "of",
  "in", "for", "on", "with", "at", "by", "from", "as", "into", "through",
  "during", "before", "after", "and", "or", "but", "if", "than", "that",
  "this", "these", "those", "it", "its", "not", "no", "all", "each",
  "every", "both", "any", "such", "when", "where", "how", "what", "which",
]);

/** Extract meaningful keywords from text (lowercase, no stop words, no punctuation). */
function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

/** Compute Jaccard similarity between two keyword sets. */
function keywordOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) {
    if (b.has(w)) intersection++;
  }
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/** Verbs that indicate an actionable task. */
const ACTION_VERBS = new Set([
  "implement", "add", "create", "fix", "update", "remove", "refactor",
  "test", "write", "run", "design", "investigate", "build", "deploy",
  "configure", "enable", "disable", "migrate", "extract", "integrate",
  "validate", "check", "verify", "measure", "analyze", "import", "export",
  "document", "define", "extend", "introduce", "split", "merge", "rename",
  "move", "replace", "convert", "optimize", "reduce", "increase", "stratify",
  "separately", "use",
]);

/** Patterns that indicate non-actionable text. */
const NEGATIVE_PATTERNS = [
  /^do\s+not\b/i,
  /^don't\b/i,
  /\bwarrant\b.*\battention\b/i,
  /\bis\s+(the|a)\s+(strongest|weakest|dominant|primary)/i,
  /\bshows?\s+that\b/i,
  /\bsuggests?\s+that\b/i,
  /\bindicates?\s+that\b/i,
  /\bcannot\s+substitute\b/i,
  /\bno\s+better\s+than\b/i,
  /\bis\s+not\s+necessary\b/i,
  /\bnot\s+needed\b/i,
];

/** Patterns indicating the task is documentation/analysis only (zero-resource). */
const ZERO_RESOURCE_PATTERNS = [
  /\bdocument\b/i,
  /\banalysis\b/i,
  /\banalyze\b/i,
  /\bstratif/i,
  /\breport\b/i,
  /\bwrite\b.*\b(documentation|doc|notes?|readme)\b/i,
];

/** Patterns indicating governance/CLAUDE.md changes (approval-needed). */
const APPROVAL_PATTERNS = [
  /\bCLAUDE\.md\b/,
  /\bgovernance\b/i,
  /\bapproval\b.*\b(gate|workflow|process)/i,
  /\bbudget\b.*\b(increase|extend|raise)/i,
];

/**
 * Format a recommendation as a task candidate, or return null if non-actionable.
 */
export function formatAsTask(
  rec: Recommendation,
): TaskCandidate | null {
  const text = rec.text;

  for (const pattern of NEGATIVE_PATTERNS) {
    if (pattern.test(text)) return null;
  }

  const firstWord = text.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "");
  const hasActionVerb =
    (firstWord && ACTION_VERBS.has(firstWord)) ||
    text.split(/[.;]\s+/).some((sentence) => {
      const w = sentence.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "");
      return w ? ACTION_VERBS.has(w) : false;
    });

  if (!hasActionVerb) return null;

  const tags: string[] = [];
  for (const pattern of ZERO_RESOURCE_PATTERNS) {
    if (pattern.test(text)) {
      tags.push("zero-resource");
      break;
    }
  }
  for (const pattern of APPROVAL_PATTERNS) {
    if (pattern.test(text)) {
      tags.push("approval-needed");
      break;
    }
  }

  const taskDesc = truncateToActionable(text);
  const tagStr = tags.length > 0 ? " " + tags.map((t) => `[${t}]`).join(" ") : "";

  return {
    line: `- [ ] ${taskDesc}${tagStr}`,
    why: `From ${rec.sourceId} — ${summarize(text)}`,
    doneWhen: deriveDoneWhen(text),
    sourceId: rec.sourceId,
    tags,
  };
}

/** Truncate recommendation text to a concise imperative task description. */
function truncateToActionable(text: string): string {
  // Take first sentence (up to first period followed by space or end)
  const firstSentence = text.match(/^[^.]+(?:\.|$)/)?.[0] ?? text;
  // Capitalize first letter
  const capitalized =
    firstSentence.charAt(0).toUpperCase() + firstSentence.slice(1);
  // Truncate to 120 chars
  return capitalized.length > 120
    ? capitalized.slice(0, 117) + "..."
    : capitalized.replace(/\.$/, "");
}

/** Derive a "Done when" condition from the recommendation text. */
function deriveDoneWhen(text: string): string {
  // The Done when is a restatement of the recommendation as a verifiable condition
  const firstSentence = text.match(/^[^.]+(?:\.|$)/)?.[0]?.replace(/\.$/, "") ?? text;
  return `${firstSentence} is complete and verified`;
}

/** Summarize recommendation text for the Why field (max 80 chars). */
function summarize(text: string): string {
  const firstSentence = text.match(/^[^.]+(?:\.|$)/)?.[0]?.replace(/\.$/, "") ?? text;
  return firstSentence.length > 80
    ? firstSentence.slice(0, 77) + "..."
    : firstSentence;
}

/**
 * Check if a task candidate is a duplicate of an existing task.
 * Uses two signals: source-id provenance match and keyword overlap (>0.5 Jaccard).
 */
export function deduplicateAgainstExisting(
  candidate: TaskCandidate,
  existingTasksContent: string,
): boolean {
  if (existingTasksContent.includes(candidate.sourceId)) {
    const lines = existingTasksContent.split("\n");
    for (const line of lines) {
      if (line.includes(candidate.sourceId) && line.match(/Why:|From /)) {
        return true;
      }
    }
  }

  // Signal 2: keyword overlap with existing task lines
  const candidateKeywords = extractKeywords(candidate.line);
  const existingLines = existingTasksContent.split("\n");
  for (const line of existingLines) {
    if (!line.match(/^- \[[ x]\]/)) continue;
    const lineKeywords = extractKeywords(line);
    if (keywordOverlap(candidateKeywords, lineKeywords) > 0.5) {
      return true;
    }
  }

  return false;
}

/**
 * Format a TaskCandidate as a full markdown task block.
 */
export function formatTaskBlock(candidate: TaskCandidate): string {
  return [
    candidate.line,
    `  Why: ${candidate.why}`,
    `  Done when: ${candidate.doneWhen}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Findings-implied-task extraction (compound Step 3 Part B)
// ---------------------------------------------------------------------------

/** Regex matching a Findings section header. */
const FINDINGS_HEADER_RE = /^(#{2,4})\s+Findings\s*$/i;

/**
 * Extract the Findings section body from markdown content.
 * Returns the text under the first ## Findings header, or null if none found.
 */
export function extractFindingsSection(content: string): string | null {
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(FINDINGS_HEADER_RE);
    if (!match) continue;

    const headerLevel = match[1]!.length;
    const bodyLines: string[] = [];

    for (let j = i + 1; j < lines.length; j++) {
      const nextHeaderMatch = lines[j]!.match(/^(#{2,4})\s+/);
      if (nextHeaderMatch && nextHeaderMatch[1]!.length <= headerLevel) break;
      bodyLines.push(lines[j]!);
    }

    const body = bodyLines.join("\n").trim();
    return body.length > 0 ? body : null;
  }

  return null;
}

/**
 * Split a Findings section into individual findings.
 * Handles numbered items (1. ...), bold-prefixed items (1. **Finding**:),
 * and sub-headed findings (### Finding N).
 */
export function splitFindings(findingsBody: string): string[] {
  const lines = findingsBody.split("\n");
  const findings: string[] = [];
  let current: string[] = [];

  const findingStartRe = /^(?:\d+\.\s+|###?\s+(?:Finding\s+)?\d+)/i;

  for (const line of lines) {
    if (findingStartRe.test(line)) {
      if (current.length > 0) {
        findings.push(current.join("\n").trim());
      }
      current = [line];
    } else if (current.length > 0) {
      current.push(line);
    } else if (line.trim().length > 0) {
      current.push(line);
    }
  }

  if (current.length > 0) {
    findings.push(current.join("\n").trim());
  }

  return findings.filter((f) => f.length > 0);
}

/**
 * Detect implied-task patterns in a single finding text.
 * Returns all matching patterns (a finding can match multiple patterns).
 */
export function detectImpliedTaskPatterns(
  findingText: string,
  sourceId: string,
): ImpliedTask[] {
  const results: ImpliedTask[] = [];

  for (const { pattern, signals, suggestedTaskType } of IMPLIED_TASK_PATTERNS) {
    for (const signal of signals) {
      if (signal.test(findingText)) {
        results.push({
          pattern,
          findingText: findingText.slice(0, 200),
          sourceId,
          suggestedTaskType,
        });
        break;
      }
    }
  }

  return results;
}

/**
 * Extract all implied tasks from a markdown file's Findings section.
 * This is the main entry point for compound Step 3 Part B.
 */
export function extractImpliedTasks(
  content: string,
  sourceId: string,
): ImpliedTask[] {
  const findingsBody = extractFindingsSection(content);
  if (!findingsBody) return [];

  const findings = splitFindings(findingsBody);
  const allImplied: ImpliedTask[] = [];

  for (const finding of findings) {
    const implied = detectImpliedTaskPatterns(finding, sourceId);
    allImplied.push(...implied);
  }

  return allImplied;
}

/**
 * Detect phase references in markdown content and return the phase numbers.
 * Used for multi-phase plan checking (compound Step 3 Part B).
 */
export function detectPhases(content: string): number[] {
  const phaseRe = /\bPhase\s+(\d+)\b/gi;
  const phases = new Set<number>();
  let match: RegExpExecArray | null;

  while ((match = phaseRe.exec(content)) !== null) {
    phases.add(parseInt(match[1]!, 10));
  }

  return [...phases].sort((a, b) => a - b);
}

/**
 * Format an ImpliedTask as a TaskCandidate for TASKS.md insertion.
 */
export function formatImpliedTaskAsCandidate(
  implied: ImpliedTask,
): TaskCandidate {
  const descriptions: Record<ImpliedTaskPattern, string> = {
    "failed-success-criterion":
      "Investigate failed success criterion and redesign experiment protocol",
    "insufficient-sample":
      "Run larger-scale replication with sufficient sample size",
    "identified-confound":
      "Design controlled follow-up experiment to isolate confound",
    "partial-confirmation":
      "Refine hypothesis and run targeted investigation",
    "unexplained-result":
      "Investigate unexplained result and diagnose root cause",
    "multi-phase-plan":
      "Verify all phases have corresponding TASKS.md entries",
  };

  const desc = descriptions[implied.pattern];
  const preview = implied.findingText.slice(0, 80).replace(/\n/g, " ");

  return {
    line: `- [ ] ${desc}`,
    why: `From ${implied.sourceId} — "${preview}..."`,
    doneWhen: `${implied.suggestedTaskType} is complete and verified`,
    sourceId: implied.sourceId,
    tags: ["zero-resource"],
  };
}
