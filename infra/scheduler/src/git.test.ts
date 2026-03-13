import { describe, it, expect, vi, beforeEach } from 'vitest';
import { autoCommitOrphans, rebasePush } from './git.js';
import * as cp from 'node:child_process';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(cp.execSync);

describe('autoCommitOrphans', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('does nothing when working tree is clean', () => {
    mockExecSync.mockReturnValueOnce(Buffer.from(''));
    const committed = autoCommitOrphans('/repo');
    expect(committed).toBe(false);
  });

  it('commits when there are uncommitted files', () => {
    mockExecSync
      .mockReturnValueOnce(Buffer.from('M  file.md\n?? new.md\n'))
      .mockReturnValueOnce(Buffer.from(''))
      .mockReturnValueOnce(Buffer.from(''));
    const committed = autoCommitOrphans('/repo');
    expect(committed).toBe(true);
    expect(mockExecSync).toHaveBeenCalledTimes(3);
  });
});

describe('rebasePush', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns pushed on success', () => {
    mockExecSync
      .mockReturnValueOnce(Buffer.from('abc123 some commit\n'))  // git log (has unpushed)
      .mockReturnValueOnce(Buffer.from(''))   // git pull --rebase
      .mockReturnValueOnce(Buffer.from(''));   // git push
    const result = rebasePush('/repo');
    expect(result.status).toBe('pushed');
  });

  it('returns nothing-to-push when no unpushed commits', () => {
    mockExecSync.mockReturnValueOnce(Buffer.from(''));  // git log (empty)
    const result = rebasePush('/repo');
    expect(result.status).toBe('nothing-to-push');
  });

  it('falls back to branch on rebase conflict', () => {
    mockExecSync
      .mockReturnValueOnce(Buffer.from('abc123 some commit\n'))  // git log (has unpushed)
      .mockImplementationOnce(() => { throw new Error('CONFLICT'); })  // git pull --rebase fails
      .mockReturnValueOnce(Buffer.from(''))   // git rebase --abort
      .mockReturnValueOnce(Buffer.from(''));   // git push to fallback branch
    const result = rebasePush('/repo', 'session-123');
    expect(result.status).toBe('branch-fallback');
    expect(result.branch).toContain('session-123');
  });
});
