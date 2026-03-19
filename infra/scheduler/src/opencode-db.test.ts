/** Tests for OpenCode database integration. */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockPrepare = vi.fn();
const mockClose = vi.fn();
const mockDb = {
  prepare: mockPrepare,
  close: mockClose,
};

vi.mock("better-sqlite3", () => {
  return {
    default: vi.fn(function () {
      return mockDb;
    }),
  };
});

import {
  getOpenCodeDbPath,
  getSessionTokens,
  getModelPricing,
  calculateCost,
  getSessionCostFromDb,
  type OpenCodeSessionTokens,
  type ModelPricing,
} from "./opencode-db.js";

import Database from "better-sqlite3";

describe("opencode-db", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReset();
    mockClose.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getOpenCodeDbPath", () => {
    it("returns path to opencode database in home directory", () => {
      const path = getOpenCodeDbPath();
      expect(path).toContain(".local");
      expect(path).toContain("share");
      expect(path).toContain("opencode");
      expect(path).toContain("opencode.db");
    });

    it("returns consistent path on multiple calls", () => {
      const path1 = getOpenCodeDbPath();
      const path2 = getOpenCodeDbPath();
      expect(path1).toBe(path2);
    });
  });

  describe("getSessionTokens", () => {
    it("returns tokens when session exists with assistant messages", () => {
      mockPrepare.mockReturnValue({
        get: vi.fn(() => ({
          input_tokens: 1000,
          output_tokens: 500,
          total_tokens: 1500,
        })),
      });

      const result = getSessionTokens("test-session-123");

      expect(result).toEqual({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      });
      expect(mockClose).toHaveBeenCalled();
    });

    it("returns null when no assistant messages found for session", () => {
      mockPrepare.mockReturnValue({
        get: vi.fn(() => ({
          input_tokens: null,
          output_tokens: null,
          total_tokens: null,
        })),
      });

      const result = getSessionTokens("empty-session-456");

      expect(result).toBeNull();
      expect(mockClose).toHaveBeenCalled();
    });

    it("returns null when session not found", () => {
      mockPrepare.mockReturnValue({
        get: vi.fn(() => undefined),
      });

      const result = getSessionTokens("nonexistent-session-789");

      expect(result).toBeNull();
      expect(mockClose).toHaveBeenCalled();
    });

    it("returns null gracefully when database file missing", () => {
      const MockDb = Database as unknown as ReturnType<typeof vi.fn>;
      MockDb.mockImplementationOnce(() => {
        throw new Error("SQLITE_CANTOPEN: unable to open database file");
      });

      const result = getSessionTokens("any-session");

      expect(result).toBeNull();
    });

    it("returns null gracefully on any database error", () => {
      const MockDb = Database as unknown as ReturnType<typeof vi.fn>;
      MockDb.mockImplementationOnce(() => {
        throw new Error("Some database error");
      });

      const result = getSessionTokens("any-session");

      expect(result).toBeNull();
    });

    it("handles zero token values correctly", () => {
      mockPrepare.mockReturnValue({
        get: vi.fn(() => ({
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
        })),
      });

      const result = getSessionTokens("zero-tokens-session");

      expect(result).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      });
    });
  });

  describe("getModelPricing", () => {
    it("returns pricing for GLM-5 FP8 model", () => {
      const pricing = getModelPricing("glm5/zai-org/GLM-5-FP8");
      expect(pricing).toEqual({
        inputCostPerMillion: 0.07,
        outputCostPerMillion: 0.07,
      });
    });

    it("returns pricing for Claude Opus 4 model", () => {
      const pricing = getModelPricing("claude-opus-4-20250514");
      expect(pricing).toEqual({
        inputCostPerMillion: 15.0,
        outputCostPerMillion: 75.0,
      });
    });

    it("returns pricing for Claude Opus 4 thinking model", () => {
      const pricing = getModelPricing("claude-opus-4-20250514:thinking");
      expect(pricing).toEqual({
        inputCostPerMillion: 15.0,
        outputCostPerMillion: 75.0,
      });
    });

    it("returns pricing for Claude Sonnet 4 model", () => {
      const pricing = getModelPricing("claude-sonnet-4-20250514");
      expect(pricing).toEqual({
        inputCostPerMillion: 3.0,
        outputCostPerMillion: 15.0,
      });
    });

    it("returns pricing for Claude 3.5 Sonnet model", () => {
      const pricing = getModelPricing("claude-3-5-sonnet-20241022");
      expect(pricing).toEqual({
        inputCostPerMillion: 3.0,
        outputCostPerMillion: 15.0,
      });
    });

    it("returns undefined for unknown model", () => {
      const pricing = getModelPricing("unknown-model");
      expect(pricing).toBeUndefined();
    });

    it("returns pricing for GLM-4 Plus model", () => {
      const pricing = getModelPricing("glm-4-plus");
      expect(pricing).toEqual({
        inputCostPerMillion: 0.07,
        outputCostPerMillion: 0.07,
      });
    });
  });

  describe("calculateCost", () => {
    it("calculates cost for typical token usage", () => {
      const tokens: OpenCodeSessionTokens = {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        totalTokens: 1_500_000,
      };
      const pricing: ModelPricing = {
        inputCostPerMillion: 3.0,
        outputCostPerMillion: 15.0,
      };

      const cost = calculateCost(tokens, pricing);

      expect(cost).toBe(3.0 + 7.5);
    });

    it("calculates cost for zero tokens", () => {
      const tokens: OpenCodeSessionTokens = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      };
      const pricing: ModelPricing = {
        inputCostPerMillion: 3.0,
        outputCostPerMillion: 15.0,
      };

      const cost = calculateCost(tokens, pricing);

      expect(cost).toBe(0);
    });

    it("calculates cost correctly with GLM-5 pricing", () => {
      const tokens: OpenCodeSessionTokens = {
        inputTokens: 2_000_000,
        outputTokens: 1_000_000,
        totalTokens: 3_000_000,
      };
      const pricing: ModelPricing = {
        inputCostPerMillion: 0.07,
        outputCostPerMillion: 0.07,
      };

      const cost = calculateCost(tokens, pricing);

      expect(cost).toBeCloseTo(0.21, 10);
    });

    it("handles small token values", () => {
      const tokens: OpenCodeSessionTokens = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      };
      const pricing: ModelPricing = {
        inputCostPerMillion: 3.0,
        outputCostPerMillion: 15.0,
      };

      const cost = calculateCost(tokens, pricing);

      expect(cost).toBeCloseTo(0.0003 + 0.00075, 10);
    });
  });

  describe("getSessionCostFromDb", () => {
    it("returns null when session tokens not found", () => {
      mockPrepare.mockReturnValue({
        get: vi.fn(() => undefined),
      });

      const cost = getSessionCostFromDb("nonexistent-session");

      expect(cost).toBeNull();
    });

    it("returns cost with default pricing when no model specified", () => {
      mockPrepare.mockReturnValue({
        get: vi.fn(() => ({
          input_tokens: 1_000_000,
          output_tokens: 1_000_000,
          total_tokens: 2_000_000,
        })),
      });

      const cost = getSessionCostFromDb("test-session");

      expect(cost).toBe(0.14);
    });

    it("returns cost with model pricing for known model", () => {
      mockPrepare.mockReturnValue({
        get: vi.fn(() => ({
          input_tokens: 1_000_000,
          output_tokens: 1_000_000,
          total_tokens: 2_000_000,
        })),
      });

      const cost = getSessionCostFromDb("test-session", "claude-sonnet-4-20250514");

      expect(cost).toBe(18.0);
    });

    it("returns cost with default pricing for unknown model", () => {
      mockPrepare.mockReturnValue({
        get: vi.fn(() => ({
          input_tokens: 1_000_000,
          output_tokens: 1_000_000,
          total_tokens: 2_000_000,
        })),
      });

      const cost = getSessionCostFromDb("test-session", "unknown-model");

      expect(cost).toBe(0.14);
    });

    it("returns null on database error", () => {
      const MockDb = Database as unknown as ReturnType<typeof vi.fn>;
      MockDb.mockImplementationOnce(() => {
        throw new Error("Database error");
      });

      const cost = getSessionCostFromDb("any-session", "claude-sonnet-4-20250514");

      expect(cost).toBeNull();
    });

    it("uses Claude Opus pricing when specified", () => {
      mockPrepare.mockReturnValue({
        get: vi.fn(() => ({
          input_tokens: 1_000_000,
          output_tokens: 500_000,
          total_tokens: 1_500_000,
        })),
      });

      const cost = getSessionCostFromDb("test-session", "claude-opus-4-20250514");

      expect(cost).toBe(15.0 + 37.5);
    });
  });
});
