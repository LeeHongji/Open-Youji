/** Tests for wall-clock stall detection (L0 enforcement). */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StallGuard, extractShellCommands, STALL_TIMEOUT_MS } from "./stall-guard.js";

describe("extractShellCommands", () => {
  describe("Claude SDK format (assistant with tool_use blocks)", () => {
    it("extracts command from Bash tool_use", () => {
      const msg = {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Bash", input: { command: "python3 run_batch.py" } },
          ],
        },
      };
      expect(extractShellCommands(msg)).toBe("python3 run_batch.py");
    });

    it("extracts command from Shell tool_use", () => {
      const msg = {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Shell", input: { command: "npm test" } },
          ],
        },
      };
      expect(extractShellCommands(msg)).toBe("npm test");
    });

    it("extracts command from bash (lowercase) tool_use", () => {
      const msg = {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "bash", input: { command: "make build" } },
          ],
        },
      };
      expect(extractShellCommands(msg)).toBe("make build");
    });

    it("concatenates multiple shell commands", () => {
      const msg = {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Read", input: { file_path: "/tmp/x" } },
            { type: "tool_use", name: "Bash", input: { command: "git status" } },
            { type: "tool_use", name: "Bash", input: { command: "git diff" } },
          ],
        },
      };
      expect(extractShellCommands(msg)).toBe("git status; git diff");
    });

    it("returns null for non-shell tool_use blocks", () => {
      const msg = {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Read", input: { file_path: "/tmp/x" } },
            { type: "tool_use", name: "Write", input: { file_path: "/tmp/y", content: "hi" } },
          ],
        },
      };
      expect(extractShellCommands(msg)).toBeNull();
    });

    it("returns null for assistant without content", () => {
      expect(extractShellCommands({ type: "assistant" })).toBeNull();
      expect(extractShellCommands({ type: "assistant", message: {} })).toBeNull();
      expect(extractShellCommands({ type: "assistant", message: { content: [] } })).toBeNull();
    });
  });

  describe("Cursor/opencode format (tool_use_summary)", () => {
    it("extracts Shell command from summary", () => {
      const msg = { type: "tool_use_summary", summary: "Shell `python3 train.py --epochs 50`" };
      expect(extractShellCommands(msg)).toBe("python3 train.py --epochs 50");
    });

    it("extracts Bash command from summary", () => {
      const msg = { type: "tool_use_summary", summary: "Bash `python3 run_retexture_batch.py`" };
      expect(extractShellCommands(msg)).toBe("python3 run_retexture_batch.py");
    });

    it("extracts bash (lowercase) command from summary", () => {
      const msg = { type: "tool_use_summary", summary: "bash `make all`" };
      expect(extractShellCommands(msg)).toBe("make all");
    });

    it("returns null for non-shell tool_use_summary", () => {
      expect(extractShellCommands({ type: "tool_use_summary", summary: "Read `/tmp/file.txt`" })).toBeNull();
      expect(extractShellCommands({ type: "tool_use_summary", summary: "Grep `pattern`" })).toBeNull();
    });

    it("returns null for missing summary", () => {
      expect(extractShellCommands({ type: "tool_use_summary" })).toBeNull();
    });
  });

  describe("other message types", () => {
    it("returns null for result messages", () => {
      expect(extractShellCommands({ type: "result" })).toBeNull();
    });

    it("returns null for system messages", () => {
      expect(extractShellCommands({ type: "system" })).toBeNull();
    });
  });
});

describe("StallGuard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires callback after timeout with no activity", () => {
    const onStall = vi.fn();
    const guard = new StallGuard({ timeoutMs: 100, onStall });

    guard.onShellToolUse("python3 run_batch.py");
    expect(onStall).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(onStall).toHaveBeenCalledWith("python3 run_batch.py");
    expect(guard.wasTriggered).toBe(true);

    guard.dispose();
  });

  it("does not fire if activity arrives before timeout", () => {
    const onStall = vi.fn();
    const guard = new StallGuard({ timeoutMs: 100, onStall });

    guard.onShellToolUse("python3 run_batch.py");
    vi.advanceTimersByTime(50);
    guard.onActivity();
    vi.advanceTimersByTime(100);

    expect(onStall).not.toHaveBeenCalled();
    expect(guard.wasTriggered).toBe(false);

    guard.dispose();
  });

  it("resets timer on new shell tool_use", () => {
    const onStall = vi.fn();
    const guard = new StallGuard({ timeoutMs: 100, onStall });

    guard.onShellToolUse("cmd1");
    vi.advanceTimersByTime(80);
    guard.onShellToolUse("cmd2");
    vi.advanceTimersByTime(80);

    expect(onStall).not.toHaveBeenCalled();

    vi.advanceTimersByTime(20);
    expect(onStall).toHaveBeenCalledWith("cmd2");

    guard.dispose();
  });

  it("only fires once even if multiple timeouts would occur", () => {
    const onStall = vi.fn();
    const guard = new StallGuard({ timeoutMs: 100, onStall });

    guard.onShellToolUse("cmd1");
    vi.advanceTimersByTime(100);
    expect(onStall).toHaveBeenCalledTimes(1);

    guard.onShellToolUse("cmd2");
    vi.advanceTimersByTime(200);
    expect(onStall).toHaveBeenCalledTimes(1);

    guard.dispose();
  });

  it("uses default timeout when not specified", () => {
    const onStall = vi.fn();
    const guard = new StallGuard({ onStall });

    guard.onShellToolUse("slow-command");
    vi.advanceTimersByTime(STALL_TIMEOUT_MS - 1);
    expect(onStall).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onStall).toHaveBeenCalledWith("slow-command");

    guard.dispose();
  });

  it("dispose clears pending timer", () => {
    const onStall = vi.fn();
    const guard = new StallGuard({ timeoutMs: 100, onStall });

    guard.onShellToolUse("cmd");
    guard.dispose();
    vi.advanceTimersByTime(200);

    expect(onStall).not.toHaveBeenCalled();
  });

  it("wasTriggered is false before timeout", () => {
    const guard = new StallGuard({ timeoutMs: 100, onStall: vi.fn() });
    expect(guard.wasTriggered).toBe(false);
    guard.onShellToolUse("cmd");
    expect(guard.wasTriggered).toBe(false);
    guard.dispose();
  });
});
