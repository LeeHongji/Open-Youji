/** Tests for sleep duration L0 enforcement (ADR 0017). */

import { describe, it, expect } from "vitest";
import { detectSleepViolation, checkMessageForSleepViolation } from "./sleep-guard.js";

describe("detectSleepViolation", () => {
  describe("detects violations (>30s)", () => {
    it.each([
      ["sleep 120", 120, "bare sleep >30"],
      ["sleep 120 && python3 -c 'check()'", 120, "sleep in pipeline"],
      ["echo hi ; sleep 60 ; echo done", 60, "sleep after semicolon"],
      ["sleep 60s", 60, "sleep with s suffix"],
      ["sleep 2m", 120, "sleep with m suffix"],
      ["sleep 1h", 3600, "sleep with h suffix"],
      ["sleep 31", 31, "just over threshold"],
      ["sleep 0.6m", 36, "fractional minutes"],
      ["while true; do sleep 120; done", 120, "sleep in while loop"],
    ])("%s", (input, expected) => {
      expect(detectSleepViolation(input)).toBe(expected);
    });
  });

  describe("returns null for non-violations", () => {
    it.each([
      ["sleep 30", "sleep <=30"],
      ["sleep 5", "sleep 5"],
      ["sleep 1", "sleep 1"],
      ["echo hello && python3 run.py", "no sleep command"],
      ["", "empty string"],
      ["sleep 0.5m", "0.5m = 30s"],
      ["echo sleeping 120", "'sleeping' word not matched"],
      ["python -c 'import time; time.sleep(120)'", "sleep inside quoted string arg"],
    ])("%s", (input, _desc) => {
      expect(detectSleepViolation(input)).toBeNull();
    });
  });
});

describe("checkMessageForSleepViolation", () => {
  it.each([
    [
      "detects sleep in Bash tool_use block",
      "Bash",
      "sleep 120 && python3 -c 'check()'",
      120,
    ],
    [
      "detects sleep in Shell tool_use (Cursor)",
      "Shell",
      "sleep 120 && echo done",
      120,
    ],
    [
      "detects sleep in bash tool_use (opencode)",
      "bash",
      "sleep 60",
      60,
    ],
  ])("%s", (_desc, toolName, command, expectedSeconds) => {
    const msg = {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: toolName,
            input: { command },
          },
        ],
      },
    };
    const result = checkMessageForSleepViolation(msg);
    expect(result).not.toBeNull();
    expect(result!.seconds).toBe(expectedSeconds);
  });

  it.each([
    [
      "ignores non-shell tool_use blocks",
      "Read",
      { file_path: "/tmp/sleep" },
    ],
    [
      "ignores Bash without sleep",
      "Bash",
      { command: "git status" },
    ],
    [
      "ignores Bash with sleep <=30",
      "Bash",
      { command: "sleep 10 && echo done" },
    ],
  ])("%s", (_desc, toolName, input) => {
    const msg = {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: toolName, input }],
      },
    };
    expect(checkMessageForSleepViolation(msg)).toBeNull();
  });

  it("ignores non-assistant messages", () => {
    expect(checkMessageForSleepViolation({ type: "result" })).toBeNull();
  });

  it("detects violation among multiple tool_use blocks", () => {
    const msg = {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Read", input: { file_path: "/tmp/x" } },
          { type: "tool_use", name: "Bash", input: { command: "echo hello" } },
          { type: "tool_use", name: "Bash", input: { command: "sleep 90 && curl http://example.com" } },
        ],
      },
    };
    const result = checkMessageForSleepViolation(msg);
    expect(result).not.toBeNull();
    expect(result!.seconds).toBe(90);
  });

  it.each([
    [{ type: "assistant" }, "missing message"],
    [{ type: "assistant", message: {} }, "missing content"],
    [{ type: "assistant", message: { content: [] } }, "empty content array"],
  ])("handles missing content gracefully: %s", (msg, _desc) => {
    expect(checkMessageForSleepViolation(msg)).toBeNull();
  });
});
