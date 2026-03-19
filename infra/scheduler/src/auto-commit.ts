/** Pre-session auto-commit: commits orphaned artifacts before spawning an agent session. */

import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import { classifyUncommittedFiles } from "./verify.js";
import { listSessions, type SessionInfo } from "./session.js";

const exec = promisify(execFile);

/** Default: skip auto-commit if last one was less than 5 minutes ago. */
export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;
/** Default: always commit if ≥3 orphaned files regardless of cooldown. */
export const DEFAULT_MIN_FILES_TO_BYPASS = 3;

/** Timestamp of the last successful auto-commit. Module-level state. */
let lastAutoCommitMs = 0;

/** Reset cooldown state (for testing). */
export function resetCooldown(): void {
  lastAutoCommitMs = 0;
}

/**
 * Check whether the auto-commit should be skipped due to cooldown.
 * Pure function — takes all inputs as parameters for testability.
 *
 * Returns true if the commit should be SKIPPED (cooldown active and file count is low).
 */
export function shouldSkipForCooldown(
  orphanedFileCount: number,
  nowMs: number,
  lastCommitMs: number,
  cooldownMs: number = DEFAULT_COOLDOWN_MS,
  minFilesToBypass: number = DEFAULT_MIN_FILES_TO_BYPASS,
): boolean {
  if (lastCommitMs === 0) return false; // Never committed before — don't skip
  const elapsed = nowMs - lastCommitMs;
  if (elapsed >= cooldownMs) return false; // Cooldown expired
  if (orphanedFileCount >= minFilesToBypass) return false; // Enough files to bypass
  return true;
}

export interface AutoCommitResult {
  filesCommitted: number;
  commitHash: string;
}

export interface AutoCommitArgs {
  files: string[];
  message: string;
}

export interface OrphanProvenance {
  triggeringSessionId?: string;
  activeSessionIds: string[];
  fileTimestamps: Map<string, { created?: number; modified: number }>;
}

export interface OrphanProvenanceContext {
  triggeringSessionId?: string;
  cwd: string;
}

export async function collectFileTimestamps(
  files: string[],
  cwd: string,
): Promise<Map<string, { created?: number; modified: number }>> {
  const timestamps = new Map<string, { created?: number; modified: number }>();
  for (const file of files) {
    try {
      const stats = await stat(`${cwd}/${file}`);
      timestamps.set(file, {
        created: stats.birthtimeMs,
        modified: stats.mtimeMs,
      });
    } catch {
      timestamps.set(file, { modified: Date.now() });
    }
  }
  return timestamps;
}

export function collectActiveSessionIds(sessions: SessionInfo[], excludeSessionId?: string): string[] {
  return sessions
    .filter((s) => s.sessionId != null && s.sessionId !== excludeSessionId)
    .map((s) => s.sessionId as string);
}

export function formatProvenanceMessage(provenance: OrphanProvenance): string {
  const lines: string[] = [];
  
  if (provenance.activeSessionIds.length > 0) {
    lines.push(`Active sessions: ${provenance.activeSessionIds.join(", ")}`);
  }
  
  if (provenance.triggeringSessionId) {
    lines.push(`Triggering session: ${provenance.triggeringSessionId}`);
  }
  
  if (provenance.fileTimestamps.size > 0) {
    const oldest = [...provenance.fileTimestamps.entries()]
      .sort((a, b) => a[1].modified - b[1].modified)[0];
    const newest = [...provenance.fileTimestamps.entries()]
      .sort((a, b) => b[1].modified - a[1].modified)[0];
    lines.push(`File timeline: ${new Date(oldest[1].modified).toISOString()} to ${new Date(newest[1].modified).toISOString()}`);
  }
  
  return lines.length > 0 ? `\n\n${lines.join("\n")}` : "";
}

/**
 * Classify git status lines and build commit arguments for orphaned files.
 * Pure function — no I/O. Returns null if no orphaned files found.
 *
 * @param statusLines - git status --porcelain output lines
 * @param activeExperimentDirs - relative paths of running experiments
 * @param provenance - optional provenance metadata for commit message
 */
export function buildAutoCommitArgs(
  statusLines: string[],
  activeExperimentDirs: string[],
  provenance?: OrphanProvenance | null,
): AutoCommitArgs | null {
  const nonEmpty = statusLines.filter((l) => l.trim());
  if (nonEmpty.length === 0) return null;

  const { orphaned } = classifyUncommittedFiles(nonEmpty, activeExperimentDirs);
  if (orphaned.length === 0) return null;

  const files = orphaned.map((line) => {
    const path = line.slice(3).trim();
    const parts = path.split(" -> ");
    return parts[parts.length - 1];
  });

  let message = `[scheduler] auto-commit ${orphaned.length} orphaned artifact(s) before session`;
  if (provenance) {
    message += formatProvenanceMessage(provenance);
  }

  return { files, message };
}

/**
 * Auto-commit orphaned files before a session starts.
 * Best-effort: returns null on any error without throwing.
 *
 * Applies a cooldown: if the last auto-commit was <5 minutes ago and there are
 * fewer than 3 orphaned files, the commit is skipped to reduce trivial commits.
 * Both thresholds are configurable. See diagnosis/diagnosis-commit-volume-ceremony-overhead-2026-03-04.md.
 *
 * @param cwd - working directory (repo root)
 * @param activeExperimentDirs - relative paths of running experiments
 * @param cooldownMs - minimum interval between auto-commits (default: 5 min)
 * @param minFilesToBypass - file count that bypasses cooldown (default: 3)
 * @param provenanceContext - optional context for tracking orphan provenance
 */
export async function autoCommitOrphanedFiles(
  cwd: string,
  activeExperimentDirs: string[] = [],
  cooldownMs: number = DEFAULT_COOLDOWN_MS,
  minFilesToBypass: number = DEFAULT_MIN_FILES_TO_BYPASS,
  provenanceContext?: OrphanProvenanceContext,
): Promise<AutoCommitResult | null> {
  try {
    const { stdout: statusOutput } = await exec("git", ["status", "--porcelain"], { cwd });
    const statusLines = statusOutput.split("\n");

    const baseArgs = buildAutoCommitArgs(statusLines, activeExperimentDirs);
    if (!baseArgs) return null;

    if (shouldSkipForCooldown(baseArgs.files.length, Date.now(), lastAutoCommitMs, cooldownMs, minFilesToBypass)) {
      console.log(`[auto-commit] Skipping: ${baseArgs.files.length} file(s) within cooldown window`);
      return null;
    }

    console.log(`[auto-commit] Found ${baseArgs.files.length} orphaned file(s), committing...`);

    let provenance: OrphanProvenance | null = null;
    if (provenanceContext) {
      const [fileTimestamps, activeSessions] = await Promise.all([
        collectFileTimestamps(baseArgs.files, cwd),
        Promise.resolve(listSessions()),
      ]);
      provenance = {
        triggeringSessionId: provenanceContext.triggeringSessionId,
        activeSessionIds: collectActiveSessionIds(activeSessions, provenanceContext.triggeringSessionId),
        fileTimestamps,
      };
    }

    const args = buildAutoCommitArgs(statusLines, activeExperimentDirs, provenance);

    await exec("git", ["add", ...args!.files], { cwd });

    await exec("git", ["commit", "-m", args!.message], { cwd });

    const { stdout: hash } = await exec("git", ["log", "-1", "--format=%H"], { cwd });

    lastAutoCommitMs = Date.now();

    console.log(`[auto-commit] Committed: ${hash.trim().slice(0, 7)}`);

    return {
      filesCommitted: args!.files.length,
      commitHash: hash.trim(),
    };
  } catch (err) {
    console.error(`[auto-commit] Error (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
