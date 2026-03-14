/** Tests for backend message parsing. */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseCursorMessage, parseClaudeCliMessage, ClaudeCliBackend } from "./backend.js";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

const mockSpawn = vi.mocked(spawn);

function createMockProcess(): ReturnType<typeof spawn> {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const proc = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    killed: false,
    kill: vi.fn(),
  });
  return proc as ReturnType<typeof spawn>;
}

describe("parseCursorMessage", () => {
  describe("tool_call.completed events", () => {
    it("emits tool_call_completed message for tool_call.completed subtype", () => {
      const line = JSON.stringify({
        type: "tool_call",
        subtype: "completed",
        tool_call: { id: "call_123", name: "Bash" },
      });
      const result = parseCursorMessage(line);
      expect(result).toEqual({ type: "tool_call_completed" });
    });

    it("emits tool_call_completed even without tool_call data", () => {
      const line = JSON.stringify({
        type: "tool_call",
        subtype: "completed",
      });
      const result = parseCursorMessage(line);
      expect(result).toEqual({ type: "tool_call_completed" });
    });
  });

  describe("tool_call.started events", () => {
    it("parses shell tool calls into tool_use_summary", () => {
      const line = JSON.stringify({
        type: "tool_call",
        subtype: "started",
        tool_call: {
          shellToolCall: {
            args: { command: "ls -la" },
          },
        },
      });
      const result = parseCursorMessage(line);
      expect(result).toMatchObject({ type: "tool_use_summary" });
      expect((result as Record<string, unknown>).summary).toContain("Shell");
    });
  });

  describe("other event types", () => {
    it("passes through system/init messages", () => {
      const line = JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "test-session",
      });
      const result = parseCursorMessage(line);
      expect(result).toMatchObject({ type: "system" });
    });

    it("passes through assistant messages with content", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Hello" }] },
      });
      const result = parseCursorMessage(line);
      expect(result).toMatchObject({ type: "assistant" });
    });

    it("passes through result messages", () => {
      const line = JSON.stringify({
        type: "result",
        subtype: "success",
        result: "Done",
      });
      const result = parseCursorMessage(line);
      expect(result).toMatchObject({ type: "result" });
    });

    it("returns null for unknown message types", () => {
      const line = JSON.stringify({ type: "unknown_type" });
      const result = parseCursorMessage(line);
      expect(result).toBeNull();
    });

    it("returns null for malformed JSON", () => {
      const result = parseCursorMessage("not valid json");
      expect(result).toBeNull();
    });
  });
});

describe("OpenCodeBackend spawn environment", () => {
  let mockProc: ReturnType<typeof spawn>;

  beforeEach(() => {
    vi.resetAllMocks();
    mockProc = createMockProcess();
    mockSpawn.mockReturnValue(mockProc);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes GIT_CONFIG env vars to disable gc.auto", async () => {
    const { getBackend } = await import("./backend.js");
    const backend = getBackend("opencode");

    const queryPromise = backend.runQuery({
      prompt: "test",
      cwd: "/tmp",
    });

    expect(mockSpawn).toHaveBeenCalled();
    const spawnCall = mockSpawn.mock.calls[0];
    const env = spawnCall[2]?.env as Record<string, string>;

    expect(env["GIT_CONFIG_COUNT"]).toBe("1");
    expect(env["GIT_CONFIG_KEY_0"]).toBe("gc.auto");
    expect(env["GIT_CONFIG_VALUE_0"]).toBe("0");

    mockProc.emit("close", 0);
    await queryPromise;
  });

  it("preserves existing environment variables", async () => {
    const { getBackend } = await import("./backend.js");
    const backend = getBackend("opencode");

    const queryPromise = backend.runQuery({
      prompt: "test",
      cwd: "/tmp",
    });

    const spawnCall = mockSpawn.mock.calls[0];
    const env = spawnCall[2]?.env as Record<string, string>;

    expect(env["PATH"]).toBe(process.env["PATH"]);
    expect(env["OPENCODE_PERMISSION"]).toBe('{"*":"allow"}');

    mockProc.emit("close", 0);
    await queryPromise;
  });
});

// ── parseClaudeCliMessage tests ─────────────────────────────────────────────

describe("parseClaudeCliMessage", () => {
  describe("system.init events", () => {
    it("parses system.init event with session_id", () => {
      const line = JSON.stringify({
        type: "system",
        subtype: "init",
        cwd: "/tmp/test",
        session_id: "abc-123-def",
        model: "claude-sonnet-4-6",
        tools: [],
        mcp_servers: [],
      });
      const result = parseClaudeCliMessage(line);
      expect(result).not.toBeNull();
      expect(result!.type).toBe("system");
      expect((result as Record<string, unknown>).subtype).toBe("init");
      expect((result as Record<string, unknown>).session_id).toBe("abc-123-def");
    });
  });

  describe("assistant events", () => {
    it("parses assistant event with text content", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-sonnet-4-6",
          id: "msg_abc",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "Hello world" }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        session_id: "sess-1",
      });
      const result = parseClaudeCliMessage(line);
      expect(result).not.toBeNull();
      expect(result!.type).toBe("assistant");
    });

    it("parses assistant event with tool_use content and emits tool_use_summary", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-sonnet-4-6",
          id: "msg_abc",
          type: "message",
          role: "assistant",
          content: [
            { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls -la" } },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        session_id: "sess-1",
      });
      const result = parseClaudeCliMessage(line);
      expect(result).not.toBeNull();
      // Should return the assistant message (tool_use is in content blocks)
      expect(result!.type).toBe("assistant");
    });
  });

  describe("result events", () => {
    it("parses result.success event with cost and turn data", () => {
      const line = JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 12345,
        num_turns: 3,
        result: "Task completed",
        session_id: "sess-1",
        total_cost_usd: 0.127,
        modelUsage: {
          "claude-sonnet-4-6": {
            inputTokens: 1000,
            outputTokens: 500,
            costUSD: 0.127,
          },
        },
      });
      const result = parseClaudeCliMessage(line);
      expect(result).not.toBeNull();
      expect(result!.type).toBe("result");
      const r = result as unknown as Record<string, unknown>;
      expect(r.subtype).toBe("success");
      expect(r.is_error).toBe(false);
      expect(r.total_cost_usd).toBe(0.127);
      expect(r.num_turns).toBe(3);
      expect(r.session_id).toBe("sess-1");
      expect(r.duration_ms).toBe(12345);
      expect(r.modelUsage).toBeDefined();
    });

    it("parses result.error_during_execution with is_error and errors array", () => {
      const line = JSON.stringify({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        duration_ms: 500,
        num_turns: 0,
        result: "",
        session_id: "sess-1",
        total_cost_usd: 0,
        errors: ["No conversation found with session ID: abc-123"],
      });
      const result = parseClaudeCliMessage(line);
      expect(result).not.toBeNull();
      expect(result!.type).toBe("result");
      const r = result as unknown as Record<string, unknown>;
      expect(r.is_error).toBe(true);
      expect(r.subtype).toBe("error_during_execution");
      expect(r.errors).toEqual(["No conversation found with session ID: abc-123"]);
    });
  });

  describe("filtered events", () => {
    it("returns null for system.hook_started events", () => {
      const line = JSON.stringify({
        type: "system",
        subtype: "hook_started",
        hook_id: "h1",
        hook_name: "SessionStart",
        session_id: "sess-1",
      });
      expect(parseClaudeCliMessage(line)).toBeNull();
    });

    it("returns null for system.hook_response events", () => {
      const line = JSON.stringify({
        type: "system",
        subtype: "hook_response",
        hook_id: "h1",
        hook_name: "SessionStart",
        session_id: "sess-1",
      });
      expect(parseClaudeCliMessage(line)).toBeNull();
    });

    it("returns null for rate_limit_event", () => {
      const line = JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: { status: "allowed" },
        session_id: "sess-1",
      });
      expect(parseClaudeCliMessage(line)).toBeNull();
    });
  });

  describe("malformed input", () => {
    it("returns null for malformed JSON", () => {
      expect(parseClaudeCliMessage("not valid json{")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseClaudeCliMessage("")).toBeNull();
    });
  });
});

// ── ClaudeCliBackend.buildArgs tests ────────────────────────────────────────

describe("ClaudeCliBackend.buildArgs", () => {
  let backend: ClaudeCliBackend;

  beforeEach(() => {
    backend = new ClaudeCliBackend();
  });

  it("produces required base flags: -p, --output-format, --verbose, --dangerously-skip-permissions", () => {
    const args = backend.buildArgs({ prompt: "hello", cwd: "/tmp" });
    expect(args).toContain("-p");
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args).toContain("--verbose");
    expect(args).toContain("--dangerously-skip-permissions");
  });

  it("includes --setting-sources project", () => {
    const args = backend.buildArgs({ prompt: "hello", cwd: "/tmp" });
    const idx = args.indexOf("--setting-sources");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("project");
  });

  it("includes --model flag", () => {
    const args = backend.buildArgs({ prompt: "hello", cwd: "/tmp", model: "opus" });
    const idx = args.indexOf("--model");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("opus");
  });

  it("generates --session-id UUID for new sessions (no resume)", () => {
    const args = backend.buildArgs({ prompt: "hello", cwd: "/tmp" });
    const idx = args.indexOf("--session-id");
    expect(idx).toBeGreaterThan(-1);
    // Value should be a UUID-like string
    const uuid = args[idx + 1];
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("uses --resume UUID when resume option is provided", () => {
    const resumeId = "existing-session-uuid";
    const args = backend.buildArgs({ prompt: "hello", cwd: "/tmp", resume: resumeId });
    expect(args).toContain("--resume");
    expect(args).toContain(resumeId);
    expect(args).not.toContain("--session-id");
  });

  it("adds --system-prompt when systemPromptText provided", () => {
    const args = backend.buildArgs({
      prompt: "hello",
      cwd: "/tmp",
      systemPromptText: "You are a helpful assistant",
    });
    const idx = args.indexOf("--system-prompt");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("You are a helpful assistant");
  });

  it("adds --max-budget-usd when maxBudgetUsd provided", () => {
    const args = backend.buildArgs({
      prompt: "hello",
      cwd: "/tmp",
      maxBudgetUsd: 0.5,
    });
    const idx = args.indexOf("--max-budget-usd");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("0.5");
  });

  it("places prompt as last positional argument", () => {
    const args = backend.buildArgs({ prompt: "do the thing", cwd: "/tmp" });
    expect(args[args.length - 1]).toBe("do the thing");
  });

  it("does not include --max-budget-usd when not provided", () => {
    const args = backend.buildArgs({ prompt: "hello", cwd: "/tmp" });
    expect(args).not.toContain("--max-budget-usd");
  });

  it("does not include --system-prompt when not provided", () => {
    const args = backend.buildArgs({ prompt: "hello", cwd: "/tmp" });
    expect(args).not.toContain("--system-prompt");
  });
});
