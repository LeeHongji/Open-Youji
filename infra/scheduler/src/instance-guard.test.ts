import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  isPidAlive,
  checkForExistingInstance,
  acquireLock,
  releaseLock,
  getSchedulerLockfilePath,
} from './instance-guard';

describe('instance-guard', () => {
  let tempDir: string;
  let lockfilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduler-test-'));
    lockfilePath = path.join(tempDir, 'scheduler.pid');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('isPidAlive', () => {
    it('returns true for current process', () => {
      expect(isPidAlive(process.pid)).toBe(true);
    });

    it('returns false for non-existent PID', () => {
      const unlikelyPid = 9999999;
      expect(isPidAlive(unlikelyPid)).toBe(false);
    });
  });

  describe('checkForExistingInstance', () => {
    it('allows start when no lockfile exists', () => {
      const result = checkForExistingInstance(lockfilePath);
      expect(result.canStart).toBe(true);
      expect(result.existingPid).toBeUndefined();
    });

    it('allows start when lockfile contains invalid PID', () => {
      fs.writeFileSync(lockfilePath, 'not-a-pid');
      const result = checkForExistingInstance(lockfilePath);
      expect(result.canStart).toBe(true);
    });

    it('allows start when PID in lockfile is not alive', () => {
      const deadPid = 9999999;
      fs.writeFileSync(lockfilePath, deadPid.toString());
      const result = checkForExistingInstance(lockfilePath);
      expect(result.canStart).toBe(true);
      expect(result.existingPid).toBe(deadPid);
    });

    it('refuses start when PID in lockfile is alive', () => {
      fs.writeFileSync(lockfilePath, process.pid.toString());
      const result = checkForExistingInstance(lockfilePath);
      expect(result.canStart).toBe(false);
      expect(result.existingPid).toBe(process.pid);
    });
  });

  describe('acquireLock', () => {
    it('creates lockfile with current PID', () => {
      acquireLock(lockfilePath);
      expect(fs.existsSync(lockfilePath)).toBe(true);
      expect(fs.readFileSync(lockfilePath, 'utf-8').trim()).toBe(process.pid.toString());
    });

    it('creates parent directory if needed', () => {
      const nestedLockfile = path.join(tempDir, 'nested', 'dir', 'scheduler.pid');
      acquireLock(nestedLockfile);
      expect(fs.existsSync(nestedLockfile)).toBe(true);
    });
  });

  describe('releaseLock', () => {
    it('removes lockfile when PID matches', () => {
      acquireLock(lockfilePath);
      releaseLock(lockfilePath);
      expect(fs.existsSync(lockfilePath)).toBe(false);
    });

    it('does not remove lockfile when PID differs', () => {
      fs.writeFileSync(lockfilePath, '9999999');
      releaseLock(lockfilePath);
      expect(fs.existsSync(lockfilePath)).toBe(true);
    });

    it('handles missing lockfile gracefully', () => {
      expect(() => releaseLock(path.join(tempDir, 'nonexistent.pid'))).not.toThrow();
    });
  });

  describe('getSchedulerLockfilePath', () => {
    it('returns correct path', () => {
      expect(getSchedulerLockfilePath('/path/to/.scheduler')).toBe(
        '/path/to/.scheduler/scheduler.pid'
      );
    });
  });
});
