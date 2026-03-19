/** Orphaned opencode process cleanup.
 *
 *  When the scheduler restarts, child process handles are lost. Orphaned opencode
 *  processes continue running and holding database locks, blocking all new sessions.
 *  This module provides cleanup functionality to kill orphaned processes at startup.
 *
 *  See diagnosis-opencode-fleet-total-failure-2026-03-06.md Hypothesis 2. */

import { spawn } from "node:child_process";

export interface OrphanCleanupResult {
  killed: number;
  pids: number[];
  errors: string[];
}

/** Find PIDs of orphaned opencode processes matching the fleet worker pattern.
 *  Orphaned processes have PPID=1 (reparented to init after parent died).
 *
 *  Pattern: `opencode run --format json` identifies fleet worker processes.
 *  The full command line is: `opencode run --format json --dir <cwd> --model <model> --title fleet <prompt>`
 */
export async function findOrphanedOpenCodeProcesses(): Promise<number[]> {
  return new Promise((resolve) => {
    const pids: number[] = [];

    // Use pgrep to find opencode processes, then filter for our pattern
    // pgrep -f matches against the full command line
    const proc = spawn("pgrep", ["-f", "opencode.*run.*--format json"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    if (proc.stdout) {
      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
    }

    if (proc.stderr) {
      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
    }

    proc.on("close", (code) => {
      // pgrep returns 0 if processes found, 1 if none found
      if (code === 0 && stdout.trim()) {
        for (const line of stdout.trim().split("\n")) {
          const pid = parseInt(line.trim(), 10);
          if (!isNaN(pid) && pid > 0) {
            pids.push(pid);
          }
        }
      }
      resolve(pids);
    });

    proc.on("error", () => {
      // If pgrep fails, return empty array
      resolve([]);
    });
  });
}

/** Check if a process is orphaned (PPID=1).
 *  Orphaned processes have been reparented to init after their parent died. */
export async function isProcessOrphaned(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    // Read /proc/<pid>/stat to get PPID
    const proc = spawn("cat", ["/proc", pid.toString(), "stat"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0 || !stdout.trim()) {
        resolve(false);
        return;
      }

      // /proc/<pid>/stat format: pid (comm) state ppid ...
      // We need to parse PPID which is the 4th field
      // The comm field can contain spaces and parentheses, so we need to find the last )
      const match = stdout.match(/\)\s+\S+\s+(\d+)/);
      if (match) {
        const ppid = parseInt(match[1], 10);
        resolve(ppid === 1);
      } else {
        resolve(false);
      }
    });

    proc.on("error", () => {
      resolve(false);
    });
  });
}

/** Kill orphaned opencode processes that would block new fleet workers.
 *
 *  Process matching criteria:
 *  1. Command line matches `opencode run --format json` (fleet worker pattern)
 *  2. Process is orphaned (PPID=1, meaning parent scheduler died)
 *
 *  Returns count of killed processes and their PIDs for logging. */
export async function killOrphanedOpenCodeProcesses(): Promise<OrphanCleanupResult> {
  const result: OrphanCleanupResult = {
    killed: 0,
    pids: [],
    errors: [],
  };

  const candidates = await findOrphanedOpenCodeProcesses();

  for (const pid of candidates) {
    const isOrphan = await isProcessOrphaned(pid);
    if (!isOrphan) {
      continue;
    }

    // Kill the orphaned process
    try {
      process.kill(pid, "SIGTERM");

      // Give it 2 seconds to exit gracefully, then force kill
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            // Process already dead
          }
          resolve();
        }, 2000);

        // Poll to see if process died
        const checkInterval = setInterval(() => {
          try {
            process.kill(pid, 0); // Check if process exists
          } catch {
            // Process is dead
            clearTimeout(timeout);
            clearInterval(checkInterval);
            resolve();
          }
        }, 200);
      });

      result.killed++;
      result.pids.push(pid);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Failed to kill PID ${pid}: ${errMsg}`);
    }
  }

  return result;
}
