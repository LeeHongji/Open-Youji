/** Tests for backend abstraction and preference persistence. */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveBackend,
  getBackend,
  parseOpenCodeMessage,
  isBillingError,
  isRateLimitError,
  getEffectiveBackendName,
} from "./backend.js";
import {
  getBackendPreference,
  setBackendPreference,
  clearBackendPreference,
  setBackendPreferencePath,
  initBackendPreference,
} from "./backend-preference.js";

describe("resolveBackend", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns claude backend when preference is 'claude'", () => {
    const backend = resolveBackend("claude");
    expect(backend.name).toBe("claude");
  });

  it("returns cursor backend when preference is 'cursor'", () => {
    const backend = resolveBackend("cursor");
    expect(backend.name).toBe("cursor");
  });

  it("returns opencode backend when preference is 'opencode'", () => {
    const backend = resolveBackend("opencode");
    expect(backend.name).toBe("opencode");
  });

  it("returns fallback backend when preference is 'auto'", () => {
    const backend = resolveBackend("auto");
    expect(backend.name).toBe("claude");
  });

  it("respects AGENT_BACKEND environment variable", () => {
    process.env["AGENT_BACKEND"] = "opencode";
    const backend = resolveBackend();
    expect(backend.name).toBe("opencode");
  });

  it("defaults to auto when AGENT_BACKEND is not set", () => {
    delete process.env["AGENT_BACKEND"];
    const backend = resolveBackend();
    expect(backend.name).toBe("claude");
  });
});

describe("getBackend", () => {
  it("returns claude backend by name", () => {
    const backend = getBackend("claude");
    expect(backend.name).toBe("claude");
  });

  it("returns cursor backend by name", () => {
    const backend = getBackend("cursor");
    expect(backend.name).toBe("cursor");
  });

  it("returns opencode backend by name", () => {
    const backend = getBackend("opencode");
    expect(backend.name).toBe("opencode");
  });
});

describe("getEffectiveBackendName", () => {
  it("returns 'claude' for claude preference", () => {
    expect(getEffectiveBackendName("claude")).toBe("claude");
  });

  it("returns 'cursor' for cursor preference", () => {
    expect(getEffectiveBackendName("cursor")).toBe("cursor");
  });

  it("returns 'opencode' for opencode preference", () => {
    expect(getEffectiveBackendName("opencode")).toBe("opencode");
  });

  it("returns 'claude' for auto preference (first in fallback chain)", () => {
    expect(getEffectiveBackendName("auto")).toBe("claude");
  });

  it("returns 'claude' for undefined preference (defaults to auto)", () => {
    expect(getEffectiveBackendName(undefined)).toBe("claude");
  });
});

describe("parseOpenCodeMessage", () => {
  it("parses tool_use with bash command", () => {
    const line = JSON.stringify({
      type: "tool_use",
      part: {
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "npm test" },
        },
      },
    });
    const msg = parseOpenCodeMessage(line);
    expect(msg).not.toBeNull();
    expect(msg?.type).toBe("tool_use_summary");
    expect((msg as unknown as { summary: string }).summary).toBe("bash `npm test`");
  });

  it("parses tool_use with long bash command (truncated)", () => {
    const longCmd = "a".repeat(100);
    const line = JSON.stringify({
      type: "tool_use",
      part: {
        tool: "bash",
        state: {
          input: { command: longCmd },
        },
      },
    });
    const msg = parseOpenCodeMessage(line);
    expect(msg).not.toBeNull();
    expect((msg as unknown as { summary: string }).summary).toBe("bash `" + "a".repeat(80) + "...`");
  });

  it("parses tool_use with file_path", () => {
    const line = JSON.stringify({
      type: "tool_use",
      part: {
        tool: "read",
        state: {
          input: { file_path: "/home/user/test.ts" },
        },
      },
    });
    const msg = parseOpenCodeMessage(line);
    expect(msg).not.toBeNull();
    expect((msg as unknown as { summary: string }).summary).toBe("read /home/user/test.ts");
  });

  it("parses tool_use with pattern", () => {
    const line = JSON.stringify({
      type: "tool_use",
      part: {
        tool: "glob",
        state: {
          input: { pattern: "**/*.ts" },
        },
      },
    });
    const msg = parseOpenCodeMessage(line);
    expect(msg).not.toBeNull();
    expect((msg as unknown as { summary: string }).summary).toBe("glob **/*.ts");
  });

  it("parses tool_use without input (tool name only)", () => {
    const line = JSON.stringify({
      type: "tool_use",
      part: {
        tool: "bash",
      },
    });
    const msg = parseOpenCodeMessage(line);
    expect(msg).not.toBeNull();
    expect((msg as unknown as { summary: string }).summary).toBe("bash");
  });

  it("parses text message", () => {
    const line = JSON.stringify({
      type: "text",
      part: { text: "Hello world" },
    });
    const msg = parseOpenCodeMessage(line);
    expect(msg).not.toBeNull();
    expect(msg?.type).toBe("assistant");
  });

  it("parses error message", () => {
    const line = JSON.stringify({
      type: "error",
      error: { data: { message: "Something went wrong" } },
    });
    const msg = parseOpenCodeMessage(line);
    expect(msg).not.toBeNull();
    expect(msg?.type).toBe("result");
    expect((msg as unknown as { is_error: boolean }).is_error).toBe(true);
  });

  it("returns null for invalid JSON", () => {
    const msg = parseOpenCodeMessage("not valid json");
    expect(msg).toBeNull();
  });

  it("returns null for unknown message type", () => {
    const line = JSON.stringify({ type: "unknown_type" });
    const msg = parseOpenCodeMessage(line);
    expect(msg).toBeNull();
  });
});

describe("isBillingError", () => {
  it.each([
    ["unpaid invoice", "Cursor agent exited with code 1: b: You have an unpaid invoice", true],
    ["payment required", "Payment required to continue", true],
    ["billing error", "Billing issue detected", true],
    ["subscription error", "Subscription expired", true],
    ["insufficient credit", "Insufficient credit balance", true],
    ["non-billing error", "Connection timeout", false],
  ])("detects %s", (_name, message, expected) => {
    const err = new Error(message);
    expect(isBillingError(err)).toBe(expected);
  });

  it.each([
    ["unpaid invoice", "unpaid invoice", true],
    ["random error", "some random error", false],
  ])("handles string error: %s", (_name, message, expected) => {
    expect(isBillingError(message)).toBe(expected);
  });
});

describe("isRateLimitError", () => {
  it.each([
    ["rate limit", "Rate limit exceeded", true],
    ["429 error", "HTTP 429 Too Many Requests", true],
    ["quota exceeded", "Quota exceeded for this API", true],
    ["overloaded", "Service overloaded, please retry", true],
    ["non-rate-limit error", "Internal server error", false],
    ["billing error", "Unpaid invoice", false],
  ])("detects %s", (_name, message, expected) => {
    const err = new Error(message);
    expect(isRateLimitError(err)).toBe(expected);
  });
});

describe("backend-preference", () => {
  let tmpDir: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "youji-backend-test-"));
    setBackendPreferencePath(join(tmpDir, "backend-preference.json"));
  });

  afterEach(async () => {
    setBackendPreferencePath(null);
    process.env = { ...originalEnv };
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no preference is set", async () => {
    await clearBackendPreference();
    expect(getBackendPreference()).toBeNull();
  });

  it("sets and retrieves a backend preference", async () => {
    await setBackendPreference("claude");
    expect(getBackendPreference()).toBe("claude");
  });

  it("persists preference across reads", async () => {
    await setBackendPreference("cursor");
    expect(getBackendPreference()).toBe("cursor");
    expect(getBackendPreference()).toBe("cursor");
  });

  it("clears preference", async () => {
    await setBackendPreference("opencode");
    expect(getBackendPreference()).toBe("opencode");

    await clearBackendPreference();
    expect(getBackendPreference()).toBeNull();
  });

  it("supports all valid backends", async () => {
    const backends = ["claude", "cursor", "opencode", "auto"] as const;
    for (const backend of backends) {
      await setBackendPreference(backend);
      expect(getBackendPreference()).toBe(backend);
    }
  });

  it("loads persisted preference from file on init", async () => {
    const prefPath = join(tmpDir, "backend-preference.json");
    await writeFile(prefPath, JSON.stringify({ backend: "cursor" }) + "\n", "utf-8");

    setBackendPreferencePath(prefPath);
    initBackendPreference();
    expect(getBackendPreference()).toBe("cursor");
  });

  it("handles missing file gracefully on init", async () => {
    setBackendPreferencePath(join(tmpDir, "nonexistent.json"));
    initBackendPreference();
    expect(getBackendPreference()).toBeNull();
  });

  it("handles invalid JSON gracefully on init", async () => {
    const prefPath = join(tmpDir, "backend-preference.json");
    await writeFile(prefPath, "not valid json", "utf-8");

    setBackendPreferencePath(prefPath);
    initBackendPreference();
    expect(getBackendPreference()).toBeNull();
  });

  it("handles invalid backend value gracefully on init", async () => {
    const prefPath = join(tmpDir, "backend-preference.json");
    await writeFile(prefPath, JSON.stringify({ backend: "invalid" }) + "\n", "utf-8");

    setBackendPreferencePath(prefPath);
    initBackendPreference();
    expect(getBackendPreference()).toBeNull();
  });

  it("writes valid JSON to file", async () => {
    const prefPath = join(tmpDir, "backend-preference.json");
    setBackendPreferencePath(prefPath);
    await setBackendPreference("claude");

    const content = await readFile(prefPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.backend).toBe("claude");
  });

  it("clears file content when preference is cleared", async () => {
    const prefPath = join(tmpDir, "backend-preference.json");
    setBackendPreferencePath(prefPath);
    await setBackendPreference("claude");
    await clearBackendPreference();

    const content = await readFile(prefPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.backend).toBeUndefined();
  });
});
