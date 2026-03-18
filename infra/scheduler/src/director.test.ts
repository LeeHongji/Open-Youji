import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ThreadMessage } from "./thread-store.js";
import type { QueryResult } from "./sdk.js";

// ── Mock sdk.ts ─────────────────────────────────────────────────────────────

const mockRunQuery = vi.fn<(...args: unknown[]) => Promise<QueryResult>>();

vi.mock("./sdk.js", () => ({
  runQuery: (...args: unknown[]) => mockRunQuery(...args),
}));

// ── Import after mocks ──────────────────────────────────────────────────────

import { handleDirectorMessage, buildYoujiDirective } from "./director.js";
import type { DirectorMessageOpts } from "./director.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeOpts(overrides?: Partial<DirectorMessageOpts>): DirectorMessageOpts {
  return {
    convKey: "C123:1234.5678",
    userMessage: "Hello Youji",
    history: [],
    repoDir: "/tmp/test-repo",
    ...overrides,
  };
}

function makeQueryResult(overrides?: Partial<QueryResult>): QueryResult {
  return {
    text: "I understand. Let me help.",
    ok: true,
    sessionId: "session-abc-123",
    costUsd: 0.05,
    numTurns: 3,
    durationMs: 2000,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("director", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockRunQuery.mockResolvedValue(makeQueryResult());
    // Reset module-level session map between tests by clearing all stored sessions
    // We do this by calling handleDirectorMessage with a known key, so tests are isolated
  });

  // ── handleDirectorMessage ───────────────────────────────────────────

  describe("handleDirectorMessage", () => {
    it("calls runQuery with correct SDK options", async () => {
      await handleDirectorMessage(makeOpts());

      expect(mockRunQuery).toHaveBeenCalledOnce();
      const callArgs = mockRunQuery.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.model).toBe("opus");
      expect(callArgs.maxTurns).toBe(16);
      expect(callArgs.permissionMode).toBe("bypassPermissions");
      expect(callArgs.cwd).toBe("/tmp/test-repo");
      expect(callArgs.settingSources).toEqual(["project", "user"]);
      expect(callArgs.allowDangerouslySkipPermissions).toBe(true);
    });

    it("calls runQuery without resume when no stored session ID exists", async () => {
      await handleDirectorMessage(makeOpts({ convKey: "fresh-conv-key" }));

      const callArgs = mockRunQuery.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.resume).toBeUndefined();
    });

    it("calls runQuery with resume when stored session ID exists", async () => {
      // First call stores session ID
      mockRunQuery.mockResolvedValueOnce(makeQueryResult({ sessionId: "session-first" }));
      await handleDirectorMessage(makeOpts({ convKey: "resume-test-key" }));

      // Second call should use resume
      mockRunQuery.mockResolvedValueOnce(makeQueryResult({ sessionId: "session-second" }));
      await handleDirectorMessage(makeOpts({ convKey: "resume-test-key" }));

      const secondCallArgs = mockRunQuery.mock.calls[1][0] as Record<string, unknown>;
      expect(secondCallArgs.resume).toBe("session-first");
    });

    it("stores returned sessionId for future lookups", async () => {
      mockRunQuery.mockResolvedValueOnce(makeQueryResult({ sessionId: "stored-session-id" }));
      await handleDirectorMessage(makeOpts({ convKey: "store-test-key" }));

      // Next call should use the stored session ID
      mockRunQuery.mockResolvedValueOnce(makeQueryResult({ sessionId: "new-session-id" }));
      await handleDirectorMessage(makeOpts({ convKey: "store-test-key" }));

      const secondCallArgs = mockRunQuery.mock.calls[1][0] as Record<string, unknown>;
      expect(secondCallArgs.resume).toBe("stored-session-id");
    });

    it("returns response text from runQuery", async () => {
      mockRunQuery.mockResolvedValueOnce(makeQueryResult({ text: "Youji responds here" }));

      const result = await handleDirectorMessage(makeOpts());

      expect(result).toBe("Youji responds here");
    });

    it("passes user message as prompt", async () => {
      await handleDirectorMessage(makeOpts({ userMessage: "Please decompose this project" }));

      const callArgs = mockRunQuery.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.prompt).toBe("Please decompose this project");
    });

    it("uses system prompt with claude_code preset and Youji directive", async () => {
      await handleDirectorMessage(makeOpts());

      const callArgs = mockRunQuery.mock.calls[0][0] as Record<string, unknown>;
      const systemPrompt = callArgs.systemPrompt as { type: string; preset: string; append: string };
      expect(systemPrompt.type).toBe("preset");
      expect(systemPrompt.preset).toBe("claude_code");
      expect(systemPrompt.append).toContain("Youji");
    });

    // ── Resume fallback ────────────────────────────────────────────────

    it("falls back to fresh session with history injection when resume fails", async () => {
      // First call stores a session ID
      mockRunQuery.mockResolvedValueOnce(makeQueryResult({ sessionId: "old-session" }));
      await handleDirectorMessage(makeOpts({ convKey: "fallback-test-key" }));

      // Second call with resume fails
      mockRunQuery
        .mockRejectedValueOnce(new Error("Session not found"))
        .mockResolvedValueOnce(makeQueryResult({ sessionId: "fresh-session", text: "Recovered" }));

      const history: ThreadMessage[] = [
        { id: 1, convKey: "fallback-test-key", role: "user", content: "Hello", slackTs: null, createdAt: 1000 },
        { id: 2, convKey: "fallback-test-key", role: "assistant", content: "Hi there", slackTs: null, createdAt: 2000 },
      ];

      const result = await handleDirectorMessage(makeOpts({
        convKey: "fallback-test-key",
        userMessage: "Continue please",
        history,
      }));

      expect(result).toBe("Recovered");

      // The fallback call should NOT have resume
      const fallbackArgs = mockRunQuery.mock.calls[2][0] as Record<string, unknown>;
      expect(fallbackArgs.resume).toBeUndefined();

      // The fallback prompt should include history
      const prompt = fallbackArgs.prompt as string;
      expect(prompt).toContain("Hello");
      expect(prompt).toContain("Hi there");
      expect(prompt).toContain("Continue please");
    });

    it("stores new session ID after resume fallback", async () => {
      // First call stores a session ID
      mockRunQuery.mockResolvedValueOnce(makeQueryResult({ sessionId: "old-session" }));
      await handleDirectorMessage(makeOpts({ convKey: "fallback-store-key" }));

      // Second call: resume fails, then fresh session succeeds
      mockRunQuery
        .mockRejectedValueOnce(new Error("Session not found"))
        .mockResolvedValueOnce(makeQueryResult({ sessionId: "recovered-session" }));

      await handleDirectorMessage(makeOpts({ convKey: "fallback-store-key" }));

      // Third call should use the recovered session ID
      mockRunQuery.mockResolvedValueOnce(makeQueryResult());
      await handleDirectorMessage(makeOpts({ convKey: "fallback-store-key" }));

      const thirdCallArgs = mockRunQuery.mock.calls[3][0] as Record<string, unknown>;
      expect(thirdCallArgs.resume).toBe("recovered-session");
    });
  });

  // ── buildYoujiDirective ──────────────────────────────────────────────

  describe("buildYoujiDirective", () => {
    it("includes Youji persona", () => {
      const directive = buildYoujiDirective(makeOpts());
      expect(directive).toContain("Youji");
      expect(directive).toMatch(/优吉/);
    });

    it("includes TASKS.md task decomposition instructions", () => {
      const directive = buildYoujiDirective(makeOpts());
      expect(directive).toContain("TASKS.md");
    });

    it("includes decisions/ directory reference", () => {
      const directive = buildYoujiDirective(makeOpts());
      expect(directive).toContain("decisions/");
    });

    it("includes approval gate reference", () => {
      const directive = buildYoujiDirective(makeOpts());
      expect(directive).toMatch(/approval/i);
    });

    it("includes tag convention references", () => {
      const directive = buildYoujiDirective(makeOpts());
      expect(directive).toContain("[in-progress");
      expect(directive).toContain("[skill:");
    });

    it("includes spawn-worker instruction", () => {
      const directive = buildYoujiDirective(makeOpts());
      expect(directive).toContain("[spawn-worker:");
    });

    it("includes language auto-detection instruction", () => {
      const directive = buildYoujiDirective(makeOpts());
      expect(directive).toMatch(/language/i);
    });
  });
});
