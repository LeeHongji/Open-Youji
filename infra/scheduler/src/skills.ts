/** Dynamic skill enumeration — reads .claude/skills/ at runtime to prevent
 *  stale hardcoded skill lists in prompts. See projects/youji/experiments/
 *  doc-code-discrepancy-analysis for the motivation (27% staleness gap). */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface SkillInfo {
  name: string;
  description: string;
  /** When true, the chat agent conducts an interview before delegating to deep work. */
  interview: boolean;
  /** Instructions for the chat agent's interview, extracted from ## Chat Interview in SKILL.md. */
  interviewPrompt?: string;
  /** Skill complexity level: opus-only, high, medium, low. */
  complexity?: "opus-only" | "high" | "medium" | "low";
  /** Minimum model capability required. */
  modelMinimum?: "opus" | "sonnet" | "glm-5";
}

/** Path to the skills directory, resolved relative to the repo root.
 *  The scheduler always runs from the repo root. */
function skillsDir(repoDir: string): string {
  return join(repoDir, ".claude", "skills");
}

const MAX_SKILL_CONTENT_CHARS = 8000;

/** Read the SKILL.md content for a specific skill.
 *  Returns null if the skill doesn't exist or has no SKILL.md.
 *  Content is truncated to 8000 chars to avoid prompt bloat. */
export async function readSkillContent(
  repoDir: string,
  skillName: string,
): Promise<string | null> {
  const skillMdPath = join(skillsDir(repoDir), skillName, "SKILL.md");
  try {
    let content = await readFile(skillMdPath, "utf-8");
    if (content.length > MAX_SKILL_CONTENT_CHARS) {
      content = content.slice(0, MAX_SKILL_CONTENT_CHARS);
    }
    return content;
  } catch {
    return null;
  }
}

/** Read all skills from .claude/skills/. Each subdirectory with a SKILL.md
 *  is a skill. The description is extracted from YAML frontmatter. Cached
 *  for 5 minutes to avoid excessive filesystem reads. */
let cachedSkills: SkillInfo[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Clear the skill cache. For testing only. */
export function _clearSkillCache(): void {
  cachedSkills = null;
  cacheTimestamp = 0;
}

export async function listSkills(repoDir: string): Promise<SkillInfo[]> {
  const now = Date.now();
  if (cachedSkills && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedSkills;
  }

  const dir = skillsDir(repoDir);
  const skills: SkillInfo[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const skillMd = await readFile(join(dir, entry.name, "SKILL.md"), "utf-8");
        const descMatch = skillMd.match(/^description:\s*"([^"]+)"/m);
        const interviewMatch = skillMd.match(/^interview:\s*true\s*$/m);
        const interviewPrompt = interviewMatch ? extractInterviewSection(skillMd) : undefined;
        const complexityMatch = skillMd.match(/^complexity:\s*(opus-only|high|medium|low)\s*$/m);
        const modelMinimumMatch = skillMd.match(/^model-minimum:\s*(opus|sonnet|glm-5)\s*$/m);
        skills.push({
          name: entry.name,
          description: descMatch?.[1] ?? "(no description)",
          interview: !!interviewMatch,
          interviewPrompt: interviewPrompt ?? undefined,
          complexity: complexityMatch?.[1] as SkillInfo["complexity"] | undefined,
          modelMinimum: modelMinimumMatch?.[1] as SkillInfo["modelMinimum"] | undefined,
        });
      } catch {
        // No SKILL.md — skip
      }
    }
  } catch {
    console.warn("[skills] Could not read skills directory:", dir);
    return [];
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  cachedSkills = skills;
  cacheTimestamp = now;
  return skills;
}

/** Format the skill list for inclusion in a prompt.
 *  @param exclude Skills to exclude from the list (e.g., "coordinator" for deep work). */
export function formatSkillList(skills: SkillInfo[], exclude?: string[]): string {
  const filtered = exclude
    ? skills.filter((s) => !exclude.includes(s.name))
    : skills;
  return filtered.map((s) => `/${s.name}`).join(", ");
}

/** Detect if a message is invoking a skill. Returns the skill name and the
 *  full message as task description, or null if no skill is detected.
 *  Three detection modes:
 *  1. Slash prefix: "/orient", "run /diagnose ...", "use /develop fix ..."
 *  2. Bare first word: "orient", "feedback the bot is slow", "Feedback: context"
 *     (Slack intercepts /commands, so users type skill names without slash)
 *     Strips trailing punctuation (colon, comma, etc.) before matching.
 *  3. Verb + skill: "Use feedback skill for this", "Run diagnose on the experiment"
 *     Matches "use/run/invoke <skill-name>" as second word.
 *  Excludes "coordinator" which runs inline in chat. */
export function detectSkillInvocation(
  message: string,
  skills: SkillInfo[],
): { skillName: string; taskDescription: string } | null {
  const excludes = new Set(["coordinator"]);
  const skillNames = new Set(skills.filter((s) => !excludes.has(s.name)).map((s) => s.name));

  // Mode 1: /skill-name anywhere in the message
  const slashMatch = message.match(/\/([a-z][a-z0-9-]*)/);
  if (slashMatch) {
    const candidate = slashMatch[1];
    if (skillNames.has(candidate)) {
      const rest = message.replace(slashMatch[0], "").trim();
      return {
        skillName: candidate,
        taskDescription: `Run /${candidate}${rest ? " " + rest : ""}`,
      };
    }
  }

  const words = message.trim().split(/\s+/);

  // Mode 2: bare skill name as first word (strip trailing punctuation)
  const firstWordRaw = words[0] ?? "";
  const firstWord = firstWordRaw.replace(/[:,.!?;]+$/, "").toLowerCase();
  if (firstWord && skillNames.has(firstWord)) {
    const rest = message.trim().slice(firstWordRaw.length).trim();
    return {
      skillName: firstWord,
      taskDescription: `Run /${firstWord}${rest ? " " + rest : ""}`,
    };
  }

  // Mode 3: "use/run/invoke <skill-name> ..." where skill is second word
  const verbPrefixes = new Set(["use", "run", "invoke", "apply"]);
  if (words.length >= 2 && verbPrefixes.has(firstWordRaw.toLowerCase())) {
    const secondWord = words[1].replace(/[:,.!?;]+$/, "").toLowerCase();
    if (skillNames.has(secondWord)) {
      const rest = words.slice(2).join(" ").trim();
      return {
        skillName: secondWord,
        taskDescription: `Run /${secondWord}${rest ? " " + rest : ""}`,
      };
    }
  }

  return null;
}

/** Extract the ## Chat Interview section from a SKILL.md file.
 *  Returns null if the section is not found. */
export function extractInterviewSection(content: string): string | null {
  const startIdx = content.indexOf("## Chat Interview");
  if (startIdx === -1) return null;
  // Find end of heading line
  const afterHeading = content.indexOf("\n", startIdx);
  if (afterHeading === -1) return null;
  const bodyStart = afterHeading + 1;
  // Find end: next ## heading or --- separator
  const rest = content.slice(bodyStart);
  const nextSection = rest.search(/\n## /);
  const nextSeparator = rest.search(/\n---\s*$/m);
  let endOffset = rest.length;
  if (nextSection !== -1) endOffset = Math.min(endOffset, nextSection);
  if (nextSeparator !== -1) endOffset = Math.min(endOffset, nextSeparator);
  const result = rest.slice(0, endOffset).trim();
  return result || null;
}

/** Read the interview prompt for a specific skill from its SKILL.md.
 *  Returns null if the skill doesn't exist, has no SKILL.md, or has no ## Chat Interview section. */
export async function readInterviewPrompt(
  repoDir: string,
  skillName: string,
): Promise<string | null> {
  const content = await readSkillContent(repoDir, skillName);
  if (!content) return null;
  return extractInterviewSection(content);
}

/** Format a detailed skill list with descriptions for prompt context. */
export function formatSkillListDetailed(skills: SkillInfo[], exclude?: string[]): string {
  const filtered = exclude
    ? skills.filter((s) => !exclude.includes(s.name))
    : skills;
  return filtered.map((s) => `- /${s.name} — ${s.description}`).join("\n");
}

/** Check if a skill can be routed to fleet workers instead of requiring Opus deep work.
 *  Fleet-eligible skills have complexity medium/low and model-minimum glm-5 (or unset). */
export function isFleetEligibleSkill(skill: SkillInfo): boolean {
  if (!skill.complexity || skill.complexity === "high" || skill.complexity === "opus-only") {
    return false;
  }
  if (skill.modelMinimum === "opus" || skill.modelMinimum === "sonnet") {
    return false;
  }
  return true;
}

/** Backend capability tiers. Higher values can run more complex skills. */
const BACKEND_TIER: Record<string, number> = {
  claude: 3,    // Opus-class: can run all skills
  cursor: 3,    // Opus-class: can run all skills
  opencode: 1,  // GLM-5: can run medium/low only
};

/** Skill complexity tiers. Higher values require more capable backends. */
const COMPLEXITY_TIER: Record<string, number> = {
  "opus-only": 3,
  high: 2,
  medium: 1,
  low: 0,
};

/** Check if a skill can run on the given backend.
 *  Returns { canRun: true } if the skill is compatible, or
 *  { canRun: false, reason: string } explaining why not. */
export function canRunSkill(
  skill: SkillInfo,
  backendName: string,
): { canRun: boolean; reason?: string } {
  const backendTier = BACKEND_TIER[backendName] ?? 1;
  
  if (skill.modelMinimum) {
    const minimumTier = skill.modelMinimum === "opus" ? 3 : skill.modelMinimum === "sonnet" ? 2 : 1;
    if (backendTier < minimumTier) {
      return {
        canRun: false,
        reason: `/${skill.name} requires ${skill.modelMinimum} but ${backendName} provides lower capability`,
      };
    }
  }
  
  if (skill.complexity) {
    const complexityTier = COMPLEXITY_TIER[skill.complexity] ?? 0;
    if (backendTier < complexityTier) {
      return {
        canRun: false,
        reason: `/${skill.name} has complexity "${skill.complexity}" but ${backendName} cannot run it`,
      };
    }
  }
  
  return { canRun: true };
}
