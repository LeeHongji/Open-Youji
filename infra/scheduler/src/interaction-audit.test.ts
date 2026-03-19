/** Tests for the interaction quality audit — detects degrading chat quality. */

import { describe, it, expect } from "vitest";
import {
  analyzeInteractions,
  formatInteractionReport,
  detectEvidenceGrading,
  type InteractionAuditCheck,
  type InteractionAuditOpts,
} from "./interaction-audit.js";
import type { InteractionRecord } from "./metrics.js";

// ── Test helpers ───────────────────────────────────────────────────────────

function interaction(overrides: Partial<InteractionRecord> = {}): InteractionRecord {
  return {
    timestamp: "2026-02-21T00:00:00.000Z",
    action: "generate_report",
    args: {},
    source: "chat_agent",
    threadKey: "t-1",
    result: "ok",
    intentFulfilled: "fulfilled",
    userCorrected: false,
    turnsBeforeAction: 1,
    intentType: "status",
    ...overrides,
  };
}

function failedInteraction(overrides: Partial<InteractionRecord> = {}): InteractionRecord {
  return interaction({
    result: "error",
    intentFulfilled: "failed",
    ...overrides,
  });
}

function correctedInteraction(overrides: Partial<InteractionRecord> = {}): InteractionRecord {
  return interaction({
    userCorrected: true,
    turnsBeforeAction: 3,
    ...overrides,
  });
}

// ── analyzeInteractions tests ──────────────────────────────────────────────

describe("analyzeInteractions", () => {
  it("returns empty array when no records", () => {
    expect(analyzeInteractions([])).toEqual([]);
  });

  it("returns empty array when all interactions are healthy", () => {
    const records = Array.from({ length: 20 }, (_, i) =>
      interaction({ timestamp: `2026-02-21T0${Math.floor(i / 10)}:${(i % 10) * 5}0:00.000Z`, threadKey: `t-${i}` }),
    );
    const checks = analyzeInteractions(records);
    expect(checks).toEqual([]);
  });

  // ── Low fulfillment rate ─────────────────────────────────────────────

  describe("low fulfillment rate", () => {
    it("flags fulfillment rate below 70%", () => {
      const records = [
        ...Array.from({ length: 3 }, (_, i) =>
          interaction({ threadKey: `ok-${i}` }),
        ),
        ...Array.from({ length: 7 }, (_, i) =>
          failedInteraction({ threadKey: `fail-${i}` }),
        ),
      ];
      const checks = analyzeInteractions(records);
      const check = checks.find((c) => c.id === "low_fulfillment_rate");
      expect(check).toBeDefined();
      expect(check!.severity).toBe("high");
      expect(check!.value).toBe(30); // 3/10 = 30%
    });

    it("does not flag fulfillment rate at 70%", () => {
      const records = [
        ...Array.from({ length: 7 }, (_, i) =>
          interaction({ threadKey: `ok-${i}` }),
        ),
        ...Array.from({ length: 3 }, (_, i) =>
          failedInteraction({ threadKey: `fail-${i}` }),
        ),
      ];
      const checks = analyzeInteractions(records);
      expect(checks.find((c) => c.id === "low_fulfillment_rate")).toBeUndefined();
    });

    it("counts partial as non-fulfilled", () => {
      const records = [
        ...Array.from({ length: 3 }, (_, i) =>
          interaction({ threadKey: `ok-${i}` }),
        ),
        ...Array.from({ length: 7 }, (_, i) =>
          interaction({ threadKey: `partial-${i}`, intentFulfilled: "partial" }),
        ),
      ];
      const checks = analyzeInteractions(records);
      const check = checks.find((c) => c.id === "low_fulfillment_rate");
      expect(check).toBeDefined();
    });

    it("skips records without intentFulfilled field", () => {
      const records = [
        interaction({ intentFulfilled: undefined }),
        interaction({ intentFulfilled: undefined }),
        interaction({ intentFulfilled: "fulfilled" }),
      ];
      // Only 1 record with intentFulfilled, and it's fulfilled → 100%
      const checks = analyzeInteractions(records);
      expect(checks.find((c) => c.id === "low_fulfillment_rate")).toBeUndefined();
    });
  });

  // ── High correction rate ─────────────────────────────────────────────

  describe("high correction rate", () => {
    it("flags correction rate above 25%", () => {
      const records = [
        ...Array.from({ length: 3 }, (_, i) =>
          correctedInteraction({ threadKey: `corr-${i}` }),
        ),
        ...Array.from({ length: 7 }, (_, i) =>
          interaction({ threadKey: `ok-${i}` }),
        ),
      ];
      const checks = analyzeInteractions(records);
      const check = checks.find((c) => c.id === "high_correction_rate");
      expect(check).toBeDefined();
      expect(check!.severity).toBe("medium");
      expect(check!.value).toBe(30); // 3/10 = 30%
    });

    it("does not flag correction rate at 20%", () => {
      const records = [
        ...Array.from({ length: 2 }, (_, i) =>
          correctedInteraction({ threadKey: `corr-${i}` }),
        ),
        ...Array.from({ length: 8 }, (_, i) =>
          interaction({ threadKey: `ok-${i}` }),
        ),
      ];
      const checks = analyzeInteractions(records);
      expect(checks.find((c) => c.id === "high_correction_rate")).toBeUndefined();
    });
  });

  // ── Problem threads ──────────────────────────────────────────────────

  describe("problem threads", () => {
    it("flags threads with >2 rephrases", () => {
      const records = [
        // Thread with 3 corrections (rephrase >2)
        correctedInteraction({ threadKey: "problem-t1" }),
        correctedInteraction({ threadKey: "problem-t1" }),
        correctedInteraction({ threadKey: "problem-t1" }),
        // Normal threads (enough to meet minRecords)
        interaction({ threadKey: "ok-t1" }),
        interaction({ threadKey: "ok-t2" }),
      ];
      const checks = analyzeInteractions(records);
      const check = checks.find((c) => c.id === "problem_threads");
      expect(check).toBeDefined();
      expect(check!.severity).toBe("medium");
      expect(check!.value).toBe(1); // 1 problem thread
    });

    it("does not flag threads with <=2 corrections", () => {
      const records = [
        correctedInteraction({ threadKey: "ok-t1" }),
        correctedInteraction({ threadKey: "ok-t1" }),
        interaction({ threadKey: "ok-t2" }),
      ];
      const checks = analyzeInteractions(records);
      expect(checks.find((c) => c.id === "problem_threads")).toBeUndefined();
    });

    it("includes thread keys in check details", () => {
      const records = [
        correctedInteraction({ threadKey: "bad-t1" }),
        correctedInteraction({ threadKey: "bad-t1" }),
        correctedInteraction({ threadKey: "bad-t1" }),
        interaction({ threadKey: "ok-t1" }),
        interaction({ threadKey: "ok-t2" }),
      ];
      const checks = analyzeInteractions(records);
      const check = checks.find((c) => c.id === "problem_threads");
      expect(check).toBeDefined();
      expect(check!.threadKeys).toContain("bad-t1");
    });
  });

  // ── High error rate ──────────────────────────────────────────────────

  describe("high error rate", () => {
    it("flags error rate above 30%", () => {
      const records = [
        ...Array.from({ length: 4 }, (_, i) =>
          failedInteraction({ threadKey: `err-${i}`, result: "error" }),
        ),
        ...Array.from({ length: 6 }, (_, i) =>
          interaction({ threadKey: `ok-${i}` }),
        ),
      ];
      const checks = analyzeInteractions(records);
      const check = checks.find((c) => c.id === "high_error_rate");
      expect(check).toBeDefined();
      expect(check!.severity).toBe("high");
      expect(check!.value).toBe(40);
    });

    it("does not flag error rate at 30%", () => {
      const records = [
        ...Array.from({ length: 3 }, (_, i) =>
          failedInteraction({ threadKey: `err-${i}`, result: "error" }),
        ),
        ...Array.from({ length: 7 }, (_, i) =>
          interaction({ threadKey: `ok-${i}` }),
        ),
      ];
      const checks = analyzeInteractions(records);
      expect(checks.find((c) => c.id === "high_error_rate")).toBeUndefined();
    });
  });

  // ── Custom thresholds ────────────────────────────────────────────────

  describe("custom thresholds", () => {
    it("respects custom fulfillmentRateThreshold", () => {
      const records = [
        ...Array.from({ length: 8 }, (_, i) =>
          interaction({ threadKey: `ok-${i}` }),
        ),
        ...Array.from({ length: 2 }, (_, i) =>
          failedInteraction({ threadKey: `fail-${i}` }),
        ),
      ];
      const opts: InteractionAuditOpts = { fulfillmentRateThreshold: 90 };
      const checks = analyzeInteractions(records, opts);
      // 80% < 90% → should flag
      expect(checks.find((c) => c.id === "low_fulfillment_rate")).toBeDefined();
    });

    it("respects custom correctionRateThreshold", () => {
      const records = [
        correctedInteraction({ threadKey: "corr-1" }),
        ...Array.from({ length: 9 }, (_, i) =>
          interaction({ threadKey: `ok-${i}` }),
        ),
      ];
      const opts: InteractionAuditOpts = { correctionRateThreshold: 5 };
      const checks = analyzeInteractions(records, opts);
      // 10% > 5% → should flag
      expect(checks.find((c) => c.id === "high_correction_rate")).toBeDefined();
    });
  });

  // ── Sorting ──────────────────────────────────────────────────────────

  it("sorts results by severity: high before medium", () => {
    // Trigger both high (low fulfillment, high error) and medium (correction)
    const records = Array.from({ length: 10 }, (_, i) =>
      failedInteraction({
        threadKey: `t-${i}`,
        result: "error",
        userCorrected: true,
      }),
    );
    const checks = analyzeInteractions(records);
    expect(checks.length).toBeGreaterThanOrEqual(2);
    const severities = checks.map((c) => c.severity);
    const highIdx = severities.indexOf("high");
    const medIdx = severities.lastIndexOf("medium");
    if (highIdx >= 0 && medIdx >= 0) {
      expect(highIdx).toBeLessThan(medIdx);
    }
  });

  // ── Minimum records ──────────────────────────────────────────────────

  it("requires minimum 5 records before flagging", () => {
    // 4 records, all failed — but too few to be reliable
    const records = Array.from({ length: 4 }, (_, i) =>
      failedInteraction({ threadKey: `t-${i}`, result: "error" }),
    );
    const checks = analyzeInteractions(records);
    expect(checks).toEqual([]);
  });
});

// ── formatInteractionReport tests ──────────────────────────────────────────

describe("formatInteractionReport", () => {
  it("returns all-clear message when no issues", () => {
    const { summary, details } = formatInteractionReport([], { totalRecords: 20, fulfillmentRate: 95, correctionRate: 5, evidenceGradingRate: -1 });
    expect(summary).toContain("all clear");
    expect(details).toContain("all clear");
  });

  it("includes check details when issues exist", () => {
    const checks: InteractionAuditCheck[] = [
      {
        id: "low_fulfillment_rate",
        description: "Fulfillment rate 50% below 70% threshold",
        severity: "high",
        value: 50,
        threshold: 70,
        recommendation: "Investigate",
      },
    ];
    const { summary, details } = formatInteractionReport(checks, { totalRecords: 10, fulfillmentRate: 50, correctionRate: 10, evidenceGradingRate: -1 });
    expect(summary).toContain("1 issue(s)");
    expect(summary).toContain("1 high");
    expect(details).toContain("low_fulfillment_rate");
    expect(details).toContain("50");
  });

  it("includes summary statistics in details", () => {
    const { details } = formatInteractionReport([], { totalRecords: 42, fulfillmentRate: 85, correctionRate: 12, evidenceGradingRate: -1 });
    expect(details).toContain("42");
    expect(details).toContain("85");
  });

  it("includes evidence grading rate when available", () => {
    const { details } = formatInteractionReport([], { totalRecords: 20, fulfillmentRate: 90, correctionRate: 5, evidenceGradingRate: 75 });
    expect(details).toContain("Evidence grading: 75%");
  });

  it("omits evidence grading rate when no chat-mode data", () => {
    const { details } = formatInteractionReport([], { totalRecords: 20, fulfillmentRate: 90, correctionRate: 5, evidenceGradingRate: -1 });
    expect(details).not.toContain("Evidence grading");
  });
});

// ── detectEvidenceGrading tests ────────────────────────────────────────────

describe("detectEvidenceGrading", () => {
  it("detects 'Established' grade label", () => {
    expect(detectEvidenceGrading("This is an established finding from our tests.")).toBe(true);
  });

  it("detects 'Measured' grade label", () => {
    expect(detectEvidenceGrading("We measured this across 50 samples.")).toBe(true);
  });

  it("detects 'Preliminary' grade label", () => {
    expect(detectEvidenceGrading("This is still preliminary — small sample.")).toBe(true);
  });

  it("detects 'Hypothesis' grade label", () => {
    expect(detectEvidenceGrading("This is a hypothesis based on related findings.")).toBe(true);
  });

  it("detects 'Unknown' grade label", () => {
    expect(detectEvidenceGrading("The effect on texture quality is unknown.")).toBe(true);
  });

  it("detects contextual phrase 'We've tested this extensively'", () => {
    expect(detectEvidenceGrading("We've tested this extensively across multiple experiments.")).toBe(true);
  });

  it("detects 'In our experiment with N='", () => {
    expect(detectEvidenceGrading("In our experiment with N=200, the accuracy was 63%.")).toBe(true);
  });

  it("detects 'Early results suggest'", () => {
    expect(detectEvidenceGrading("Early results suggest a 5pp improvement.")).toBe(true);
  });

  it("detects 'Based on what we know'", () => {
    expect(detectEvidenceGrading("Based on what we know about the model, this should work.")).toBe(true);
  });

  it("detects 'We haven't tested'", () => {
    expect(detectEvidenceGrading("We haven't tested this specific combination yet.")).toBe(true);
  });

  it("returns false for text without evidence grading", () => {
    expect(detectEvidenceGrading("The pipeline generates 3D models from images.")).toBe(false);
  });

  it("returns false for empty text", () => {
    expect(detectEvidenceGrading("")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(detectEvidenceGrading("PRELIMINARY results show improvement.")).toBe(true);
  });
});

// ── Evidence grading audit check tests ─────────────────────────────────────

describe("low evidence grading rate check", () => {
  function chatInteraction(overrides: Partial<InteractionRecord> = {}): InteractionRecord {
    return interaction({
      isChatMode: true,
      evidenceGraded: true,
      ...overrides,
    });
  }

  it("flags when evidence grading rate is below 50%", () => {
    const records = [
      ...Array.from({ length: 2 }, (_, i) =>
        chatInteraction({ threadKey: `graded-${i}`, evidenceGraded: true }),
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        chatInteraction({ threadKey: `ungraded-${i}`, evidenceGraded: false }),
      ),
    ];
    const checks = analyzeInteractions(records);
    const check = checks.find((c) => c.id === "low_evidence_grading_rate");
    expect(check).toBeDefined();
    expect(check!.severity).toBe("medium");
    expect(check!.value).toBe(20); // 2/10 = 20%
  });

  it("does not flag when evidence grading rate is at 60%", () => {
    const records = [
      ...Array.from({ length: 6 }, (_, i) =>
        chatInteraction({ threadKey: `graded-${i}`, evidenceGraded: true }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        chatInteraction({ threadKey: `ungraded-${i}`, evidenceGraded: false }),
      ),
    ];
    const checks = analyzeInteractions(records);
    expect(checks.find((c) => c.id === "low_evidence_grading_rate")).toBeUndefined();
  });

  it("ignores non-chat-mode records", () => {
    const records = [
      ...Array.from({ length: 8 }, (_, i) =>
        interaction({ threadKey: `dev-${i}`, evidenceGraded: false }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        chatInteraction({ threadKey: `chat-${i}`, evidenceGraded: true }),
      ),
    ];
    const checks = analyzeInteractions(records);
    expect(checks.find((c) => c.id === "low_evidence_grading_rate")).toBeUndefined();
  });

  it("skips check when fewer than minRecords chat-mode interactions", () => {
    const records = [
      chatInteraction({ threadKey: "chat-1", evidenceGraded: false }),
      chatInteraction({ threadKey: "chat-2", evidenceGraded: false }),
      interaction({ threadKey: "dev-1" }),
      interaction({ threadKey: "dev-2" }),
      interaction({ threadKey: "dev-3" }),
    ];
    const checks = analyzeInteractions(records);
    expect(checks.find((c) => c.id === "low_evidence_grading_rate")).toBeUndefined();
  });

  it("respects custom evidenceGradingRateThreshold", () => {
    const records = Array.from({ length: 10 }, (_, i) =>
      chatInteraction({ threadKey: `chat-${i}`, evidenceGraded: i < 7 }),
    );
    const opts: InteractionAuditOpts = { evidenceGradingRateThreshold: 80 };
    const checks = analyzeInteractions(records, opts);
    // 70% < 80% → should flag
    expect(checks.find((c) => c.id === "low_evidence_grading_rate")).toBeDefined();
  });

  it("ignores records where evidenceGraded is undefined", () => {
    const records = [
      ...Array.from({ length: 5 }, (_, i) =>
        chatInteraction({ threadKey: `with-${i}`, evidenceGraded: true }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        interaction({ threadKey: `without-${i}`, isChatMode: true, evidenceGraded: undefined }),
      ),
    ];
    const checks = analyzeInteractions(records);
    // Only 5 records with evidenceGraded set, all graded → 100% → no flag
    expect(checks.find((c) => c.id === "low_evidence_grading_rate")).toBeUndefined();
  });
});
