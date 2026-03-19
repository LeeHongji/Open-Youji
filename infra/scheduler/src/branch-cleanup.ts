/** Scheduled cleanup for old session-* branches (remote and local). */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface BranchInfo {
  name: string;
  merged: boolean;
  lastCommitDate?: Date;
}

export interface CleanupResult {
  deleted: Array<{ branch: string; reason: "merged" | "old-unmerged" }>;
  kept: Array<{ branch: string; reason: string }>;
  localDeleted: number;
  dryRun: boolean;
}

const SESSION_BRANCH_PATTERN = /^session-.+/;

export async function listSessionBranches(cwd: string): Promise<BranchInfo[]> {
  const { stdout: branchList } = await exec("git", ["branch", "-r"], { cwd });
  
  const mergedOut = await exec("git", ["branch", "-r", "--merged", "main"], { cwd }).catch(() => ({ stdout: "" }));
  const mergedSet = new Set(
    mergedOut.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("origin/"))
      .map((l) => l.replace(/^origin\//, "")),
  );

  const branches: BranchInfo[] = [];
  for (const line of branchList.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("origin/")) continue;
    
    const branchName = trimmed.replace(/^origin\//, "");
    if (!SESSION_BRANCH_PATTERN.test(branchName)) continue;

    branches.push({
      name: branchName,
      merged: mergedSet.has(branchName),
    });
  }

  return branches;
}

export async function getBranchLastCommitDate(
  cwd: string,
  branchName: string,
): Promise<Date | null> {
  try {
    const { stdout } = await exec(
      "git",
      ["log", "-1", "--format=%aI", `origin/${branchName}`],
      { cwd },
    );
    const dateStr = stdout.trim();
    if (!dateStr) return null;
    return new Date(dateStr);
  } catch {
    return null;
  }
}

export async function isBranchMerged(
  cwd: string,
  branchName: string,
): Promise<boolean> {
  try {
    const { stdout } = await exec(
      "git",
      ["branch", "-r", "--merged", "main"],
      { cwd },
    );
    return stdout
      .split("\n")
      .map((l) => l.trim().replace(/^origin\//, ""))
      .includes(branchName);
  } catch {
    return false;
  }
}

export async function deleteRemoteBranch(
  cwd: string,
  branchName: string,
): Promise<void> {
  await exec("git", ["push", "origin", "--delete", branchName], { cwd });
}

/**
 * Delete local session-* branches that are fully merged into main.
 * Skips the currently checked-out branch.
 */
export async function cleanupLocalBranches(
  cwd: string,
  dryRun: boolean,
): Promise<number> {
  try {
    const { stdout } = await exec("git", ["branch", "--merged", "main"], { cwd });
    const branches = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => !l.startsWith("*") && SESSION_BRANCH_PATTERN.test(l));

    if (branches.length === 0) return 0;
    if (dryRun) return branches.length;

    for (const branch of branches) {
      try {
        await exec("git", ["branch", "-d", branch], { cwd });
      } catch {
        // branch may have been deleted concurrently
      }
    }
    return branches.length;
  } catch {
    return 0;
  }
}

export interface CleanupOptions {
  /** Number of days to keep unmerged branches (default: 7) */
  keepDays?: number;
  /** If true, don't actually delete anything */
  dryRun?: boolean;
}

export async function runBranchCleanup(
  cwd: string,
  opts: CleanupOptions = {},
): Promise<CleanupResult> {
  const keepDays = opts.keepDays ?? 7;
  const dryRun = opts.dryRun ?? false;
  const cutoffDate = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000);

  const localDeleted = await cleanupLocalBranches(cwd, dryRun);

  const branches = await listSessionBranches(cwd);
  const result: CleanupResult = {
    deleted: [],
    kept: [],
    localDeleted,
    dryRun,
  };

  for (const branch of branches) {
    const merged = await isBranchMerged(cwd, branch.name);

    if (merged) {
      if (!dryRun) {
        await deleteRemoteBranch(cwd, branch.name);
      }
      result.deleted.push({ branch: branch.name, reason: "merged" });
      continue;
    }

    const lastCommitDate = await getBranchLastCommitDate(cwd, branch.name);
    
    if (lastCommitDate && lastCommitDate < cutoffDate) {
      if (!dryRun) {
        await deleteRemoteBranch(cwd, branch.name);
      }
      result.deleted.push({ branch: branch.name, reason: "old-unmerged" });
      continue;
    }

    result.kept.push({
      branch: branch.name,
      reason: "not-merged-and-within-keep-window",
    });
  }

  return result;
}

export function formatCleanupReport(result: CleanupResult): string {
  const lines: string[] = [];

  if (result.dryRun) {
    lines.push(":mag: *Branch cleanup (dry-run)*");
  } else {
    lines.push(":broom: *Branch cleanup executed*");
  }

  if (result.deleted.length > 0) {
    lines.push("");
    lines.push(`*Deleted (${result.deleted.length}):*`);
    for (const d of result.deleted) {
      lines.push(`  - \`${d.branch}\` (${d.reason})`);
    }
  }

  if (result.kept.length > 0) {
    lines.push("");
    lines.push(`*Kept (${result.kept.length}):*`);
    for (const k of result.kept) {
      lines.push(`  - \`${k.branch}\` (${k.reason})`);
    }
  }

  if (result.localDeleted > 0) {
    lines.push("");
    lines.push(`*Local branches cleaned: ${result.localDeleted}*`);
  }

  if (result.deleted.length === 0 && result.kept.length === 0 && result.localDeleted === 0) {
    lines.push("");
    lines.push("No session branches found.");
  }

  return lines.join("\n");
}
