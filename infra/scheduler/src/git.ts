/**
 * Git operations — auto-commit orphans and rebase-push.
 */

import { execSync } from 'node:child_process';
import type { PushResult } from './types.js';

/** Patterns that should never be auto-committed. */
const SENSITIVE_PATTERNS = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*credentials*',
  '*secret*',
  '*.p12',
  '*.pfx',
];

/** Extract file paths from git status --porcelain output.
 *  Format: XY PATH  or  XY ORIG -> PATH (for renames).
 *  Uses dedicated commands for reliability instead of parsing porcelain prefixes. */
function getChangedFiles(repoDir: string): string[] {
  // Get modified tracked files + untracked files separately for reliable parsing
  const modified = execSync('git diff --name-only', { cwd: repoDir }).toString().trim();
  const staged = execSync('git diff --cached --name-only', { cwd: repoDir }).toString().trim();
  const untracked = execSync('git ls-files --others --exclude-standard', { cwd: repoDir }).toString().trim();

  const all = new Set<string>();
  for (const output of [modified, staged, untracked]) {
    if (output) {
      for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) all.add(trimmed);
      }
    }
  }
  return [...all];
}

/** Auto-commit any uncommitted files left by a previous session. */
export function autoCommitOrphans(repoDir: string): boolean {
  const files = getChangedFiles(repoDir);

  if (files.length === 0) return false;

  const safe: string[] = [];
  const blocked: string[] = [];

  for (const file of files) {
    const basename = file.split('/').pop() ?? file;
    const isSensitive = SENSITIVE_PATTERNS.some(pattern => {
      if (pattern.startsWith('*') && pattern.endsWith('*')) {
        return basename.toLowerCase().includes(pattern.slice(1, -1));
      }
      if (pattern.startsWith('*.')) {
        return basename.endsWith(pattern.slice(1));
      }
      if (pattern.endsWith('.*')) {
        return basename.startsWith(pattern.slice(0, -2) + '.');
      }
      return basename === pattern || basename.startsWith(pattern + '.');
    });

    if (isSensitive) {
      blocked.push(file);
    } else {
      safe.push(file);
    }
  }

  if (blocked.length > 0) {
    console.warn(`[auto-commit] Skipping sensitive files: ${blocked.join(', ')}`);
  }

  if (safe.length === 0) return false;

  for (const file of safe) {
    execSync(`git add -- "${file}"`, { cwd: repoDir });
  }
  execSync(
    'git commit -m "auto-commit: orphaned files from previous session"',
    { cwd: repoDir },
  );

  return true;
}

/** Rebase on remote and push. Falls back to a branch on conflict. */
export function rebasePush(repoDir: string, sessionId?: string): PushResult {
  try {
    // Check if there are unpushed commits
    const unpushed = execSync('git log origin/main..HEAD --oneline 2>/dev/null || echo ""', {
      cwd: repoDir,
    }).toString().trim();

    if (!unpushed) {
      return { status: 'nothing-to-push' };
    }

    // Try rebase and push
    try {
      execSync('git pull --rebase origin main', { cwd: repoDir, stdio: 'pipe' });
      execSync('git push origin main', { cwd: repoDir, stdio: 'pipe' });
      return { status: 'pushed' };
    } catch {
      // Rebase conflict — abort and push to fallback branch
      try {
        execSync('git rebase --abort', { cwd: repoDir, stdio: 'pipe' });
      } catch {
        // rebase --abort may fail if not in rebase state, ignore
      }

      const branch = `session-${sessionId ?? Date.now()}`;
      execSync(`git push origin HEAD:${branch}`, { cwd: repoDir, stdio: 'pipe' });
      return { status: 'branch-fallback', branch };
    }
  } catch (err) {
    return {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
