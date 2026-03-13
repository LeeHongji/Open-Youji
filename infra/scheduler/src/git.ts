/**
 * Git operations — auto-commit orphans and rebase-push.
 */

import { execSync } from 'node:child_process';
import type { PushResult } from './types.js';

/** Auto-commit any uncommitted files left by a previous session. */
export function autoCommitOrphans(repoDir: string): boolean {
  const status = execSync('git status --porcelain', { cwd: repoDir }).toString().trim();

  if (!status) return false;

  execSync('git add -A', { cwd: repoDir });
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
