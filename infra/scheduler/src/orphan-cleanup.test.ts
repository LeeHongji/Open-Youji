import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  findOrphanedOpenCodeProcesses,
  isProcessOrphaned,
  killOrphanedOpenCodeProcesses,
} from "./orphan-cleanup.js";
import { spawn } from "node:child_process";

// Mock child_process
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

describe("orphan-cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("findOrphanedOpenCodeProcesses", () => {
    it("returns empty array when no opencode processes found", async () => {
      const mockProc = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === "close") {
            cb(1); // pgrep returns 1 when no processes found
          }
        }),
      };
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ReturnType<typeof spawn>);

      const result = await findOrphanedOpenCodeProcesses();
      expect(result).toEqual([]);
    });

    it("returns PIDs when opencode processes found", async () => {
      const mockProc = {
        stdout: {
          on: vi.fn((event: string, cb: (data: Buffer) => void) => {
            if (event === "data") {
              cb(Buffer.from("12345\n67890\n"));
            }
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === "close") {
            cb(0); // pgrep returns 0 when processes found
          }
        }),
      };
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ReturnType<typeof spawn>);

      const result = await findOrphanedOpenCodeProcesses();
      expect(result).toEqual([12345, 67890]);
    });

    it("uses correct pgrep pattern", async () => {
      const mockProc = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === "close") cb(1);
        }),
      };
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ReturnType<typeof spawn>);

      await findOrphanedOpenCodeProcesses();

      expect(spawn).toHaveBeenCalledWith(
        "pgrep",
        ["-f", "opencode.*run.*--format json"],
        expect.any(Object)
      );
    });

    it("handles pgrep errors gracefully", async () => {
      const mockProc = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (err: Error) => void) => {
          if (event === "error") {
            cb(new Error("pgrep not found"));
          }
        }),
      };
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ReturnType<typeof spawn>);

      const result = await findOrphanedOpenCodeProcesses();
      expect(result).toEqual([]);
    });
  });

  describe("isProcessOrphaned", () => {
    it("returns true for orphaned process (PPID=1)", async () => {
      const mockProc = {
        stdout: {
          on: vi.fn((event: string, cb: (data: Buffer) => void) => {
            if (event === "data") {
              // Format: pid (comm) state ppid ...
              // 12345 (opencode) S 1 ...
              cb(Buffer.from("12345 (opencode) S 1 1 1 0 -1 4194304 ..."));
            }
          }),
        },
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === "close") cb(0);
        }),
      };
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ReturnType<typeof spawn>);

      const result = await isProcessOrphaned(12345);
      expect(result).toBe(true);
    });

    it("returns false for non-orphaned process (PPID != 1)", async () => {
      const mockProc = {
        stdout: {
          on: vi.fn((event: string, cb: (data: Buffer) => void) => {
            if (event === "data") {
              // PPID is 1234, not 1
              cb(Buffer.from("12345 (opencode) S 1234 1234 ..."));
            }
          }),
        },
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === "close") cb(0);
        }),
      };
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ReturnType<typeof spawn>);

      const result = await isProcessOrphaned(12345);
      expect(result).toBe(false);
    });

    it("returns false when process does not exist", async () => {
      const mockProc = {
        stdout: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === "close") cb(1); // cat /proc/... fails
        }),
      };
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ReturnType<typeof spawn>);

      const result = await isProcessOrphaned(12345);
      expect(result).toBe(false);
    });

    it("handles process names with spaces and parentheses", async () => {
      const mockProc = {
        stdout: {
          on: vi.fn((event: string, cb: (data: Buffer) => void) => {
            if (event === "data") {
              // Process name with parentheses: /usr/bin/opencode
              cb(Buffer.from("12345 (/usr/bin/opencode) S 1 ..."));
            }
          }),
        },
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === "close") cb(0);
        }),
      };
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ReturnType<typeof spawn>);

      const result = await isProcessOrphaned(12345);
      expect(result).toBe(true);
    });
  });

  describe("killOrphanedOpenCodeProcesses", () => {
    it("returns empty result when no orphaned processes", async () => {
      // Mock findOrphanedOpenCodeProcesses to return empty
      const mockProc = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === "close") cb(1);
        }),
      };
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ReturnType<typeof spawn>);

      const result = await killOrphanedOpenCodeProcesses();
      expect(result.killed).toBe(0);
      expect(result.pids).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it("only kills orphaned processes (PPID=1)", async () => {
      let callCount = 0;
      const mockProc = {
        stdout: {
          on: vi.fn((event: string, cb: (data: Buffer) => void) => {
            if (event === "data") {
              callCount++;
              if (callCount === 1) {
                // First call: findOrphanedOpenCodeProcesses returns PIDs
                cb(Buffer.from("12345\n67890\n"));
              } else if (callCount === 2) {
                // Second call: isProcessOrphaned for PID 12345 - PPID=1 (orphan)
                cb(Buffer.from("12345 (opencode) S 1 ..."));
              } else if (callCount === 3) {
                // Third call: isProcessOrphaned for PID 67890 - PPID=100 (not orphan)
                cb(Buffer.from("67890 (opencode) S 100 ..."));
              }
            }
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === "close") cb(0);
        }),
      };
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ReturnType<typeof spawn>);

      // Mock process.kill
      const originalKill = process.kill;
      const killedPids: number[] = [];
      process.kill = vi.fn((pid: number) => {
        killedPids.push(pid);
        return true;
      });

      try {
        const result = await killOrphanedOpenCodeProcesses();
        expect(result.killed).toBe(1);
        expect(result.pids).toEqual([12345]);
        expect(killedPids).toContain(12345);
        expect(killedPids).not.toContain(67890);
      } finally {
        process.kill = originalKill;
      }
    });

    it("records errors when kill fails", async () => {
      let callCount = 0;
      const mockProc = {
        stdout: {
          on: vi.fn((event: string, cb: (data: Buffer) => void) => {
            if (event === "data") {
              callCount++;
              if (callCount === 1) {
                cb(Buffer.from("12345\n"));
              } else if (callCount === 2) {
                cb(Buffer.from("12345 (opencode) S 1 ..."));
              }
            }
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === "close") cb(0);
        }),
      };
      vi.mocked(spawn).mockReturnValue(mockProc as unknown as ReturnType<typeof spawn>);

      // Mock process.kill to throw
      const originalKill = process.kill;
      process.kill = vi.fn(() => {
        throw new Error("EPERM: Operation not permitted");
      });

      try {
        const result = await killOrphanedOpenCodeProcesses();
        expect(result.killed).toBe(0);
        expect(result.pids).toEqual([]);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain("EPERM");
      } finally {
        process.kill = originalKill;
      }
    });
  });
});
