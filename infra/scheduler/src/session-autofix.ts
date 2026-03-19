/** Diagnose and triage failed burst sessions — spawns an autofix agent to investigate. */

import { spawnAgent, AGENT_PROFILES } from "./agent.js";
import type { ExecutionResult } from "./executor.js";
import type { Job } from "./types.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type SessionFixVerdict = "retry" | "skip" | "stop";

export interface SessionFixResult {
  verdict: SessionFixVerdict;
  summary: string;
  costUsd: number;
  durationMs: number;
}

export interface DiagnoseSessionOpts {
  job: Job;
  result: ExecutionResult;
  sessionNumber: number;
  attempt: number;
  maxAttempts: number;
  repoDir: string;
  onProgress?: (text: string) => Promise<void>;
}

// ── Prompt builder ───────────────────────────────────────────────────────────

const MAX_STDOUT_CHARS = 3000;
const MAX_PROMPT_CHARS = 500;

export function buildSessionDiagnosticPrompt(opts: DiagnoseSessionOpts): string {
  const { job, result, sessionNumber, attempt, maxAttempts } = opts;

  let stdout = result.stdout ?? "";
  if (stdout.length > MAX_STDOUT_CHARS) {
    stdout = stdout.slice(-MAX_STDOUT_CHARS);
  }

  let jobPrompt = job.payload.message ?? "";
  if (jobPrompt.length > MAX_PROMPT_CHARS) {
    jobPrompt = jobPrompt.slice(0, MAX_PROMPT_CHARS) + "...";
  }

  const timedOutNote = result.timedOut ? "Yes — session timed out" : "No";
  const isFinalAttempt = attempt >= maxAttempts;

  const lines = [
    `You are Youji's session diagnostic agent. A burst mode session just failed and you need to investigate.`,
    ``,
    `## Failed session`,
    `- Job: ${job.name}`,
    `- Session #: ${sessionNumber}`,
    `- Working directory: ${job.payload.cwd ?? opts.repoDir}`,
    `- Error: ${result.error ?? "unknown"}`,
    `- Timed out: ${timedOutNote}`,
    `- Exit code: ${result.exitCode ?? "unknown"}`,
    `- Autofix attempt: ${attempt}/${maxAttempts}`,
    ``,
    `## Session output (last ${MAX_STDOUT_CHARS} chars)`,
    "```",
    stdout || "(no output)",
    "```",
    ``,
    `## Job prompt (first ${MAX_PROMPT_CHARS} chars)`,
    jobPrompt,
    ``,
    `## Instructions`,
    `1. Investigate the error and the repository state using your tools.`,
    `2. If the issue is fixable (broken git state, partial files, env issues), fix it.`,
    `3. Structure your response with ## Diagnosis and ## Action sections.`,
    `4. End with exactly one tag:`,
    `   - \`[SESSIONFIX:retry]\` — issue fixed or transient, safe to retry the session`,
    `   - \`[SESSIONFIX:skip]\` — issue is specific to this session's work, skip and continue burst`,
    `   - \`[SESSIONFIX:stop]\` — systemic issue, stop the burst (human intervention needed)`,
  ];

  if (isFinalAttempt) {
    lines.push(
      ``,
      `This is the final autofix attempt (${attempt}/${maxAttempts}). Be conservative — prefer [SESSIONFIX:stop] unless you are confident the fix will resolve the issue.`,
    );
  }

  lines.push(``, `Diagnose concisely — focus on the fix, not lengthy analysis.`);

  return lines.join("\n");
}

// ── Verdict parsing ──────────────────────────────────────────────────────────

function parseVerdict(response: string): SessionFixVerdict {
  if (/\[SESSIONFIX:retry\]/.test(response)) return "retry";
  if (/\[SESSIONFIX:skip\]/.test(response)) return "skip";
  return "stop";
}

/** Extract structured summary from agent response.
 *  Prefers ## Diagnosis section; falls back to last paragraph truncated. */
function extractSummary(response: string): string {
  const diagMatch = response.match(/## Diagnosis\s*\n([\s\S]*?)(?=\n## |\n\[SESSIONFIX:|$)/);
  if (diagMatch) return diagMatch[1].trim();

  const clean = response.replace(/\[SESSIONFIX:\w+\]/, "").trim();
  const paragraphs = clean.split(/\n{2,}/).filter((p) => p.trim());
  const last = paragraphs[paragraphs.length - 1] ?? clean;
  return last.length > 500 ? last.slice(-500) : last;
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function diagnoseSession(opts: DiagnoseSessionOpts): Promise<SessionFixResult> {
  const prompt = buildSessionDiagnosticPrompt(opts);

  const { result } = spawnAgent({
    profile: AGENT_PROFILES.autofix,
    prompt,
    cwd: opts.repoDir,
    onMessage: opts.onProgress
      ? async (msg) => {
          const m = msg as { type?: string; message?: { content?: Array<{ type: string; text?: string }> } };
          if (m.type === "assistant" && m.message?.content) {
            for (const block of m.message.content) {
              if (block.type === "text" && block.text?.trim()) {
                await opts.onProgress!(block.text.trim());
              }
            }
          }
        }
      : undefined,
  });

  try {
    const agentResult = await result;
    const response = agentResult.text || "";

    return {
      verdict: parseVerdict(response),
      summary: extractSummary(response),
      costUsd: agentResult.costUsd,
      durationMs: agentResult.durationMs,
    };
  } catch (err) {
    return {
      verdict: "stop",
      summary: `Autofix agent failed: ${err instanceof Error ? err.message : String(err)}`,
      costUsd: 0,
      durationMs: 0,
    };
  }
}
