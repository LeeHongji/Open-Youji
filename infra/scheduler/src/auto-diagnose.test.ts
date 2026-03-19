/** Tests for autonomous diagnosis triggering from health monitoring. */

import { describe, it, expect } from "vitest";
import {
  shouldTriggerDiagnosis,
  buildDiagnosisPrompt,
  type DiagnosisTriggerInput,
} from "./auto-diagnose.js";
import type { HealthCheck } from "./health-watchdog.js";
import type { Anomaly } from "./anomaly-detection.js";
import type { WarningEscalation } from "./warning-escalation.js";

// ── shouldTriggerDiagnosis ──────────────────────────────────────────────

describe("shouldTriggerDiagnosis", () => {
  it("returns true when at least one high-severity health check exists", () => {
    const input: DiagnosisTriggerInput = {
      healthChecks: [
        {
          id: "high_error_rate",
          description: "Error rate 45% exceeds 30% threshold",
          severity: "high",
          value: 45,
          threshold: 30,
          recommendation: "Investigate failing sessions.",
        },
      ],
      anomalies: [],
      escalations: [],
      lastDiagnosisTimestamp: null,
    };
    expect(shouldTriggerDiagnosis(input)).toBe(true);
  });

  it("returns true when 2+ medium-severity signals exist (compound signal)", () => {
    const input: DiagnosisTriggerInput = {
      healthChecks: [
        {
          id: "cost_spike",
          description: "Cost spike 60%",
          severity: "medium",
          value: 60,
          threshold: 50,
          recommendation: "Check costs.",
        },
        {
          id: "high_zero_knowledge_rate",
          description: "Zero-knowledge rate 25%",
          severity: "medium",
          value: 25,
          threshold: 20,
          recommendation: "Review task selection.",
        },
      ],
      anomalies: [],
      escalations: [],
      lastDiagnosisTimestamp: null,
    };
    expect(shouldTriggerDiagnosis(input)).toBe(true);
  });

  it("returns false when only one medium-severity check exists", () => {
    const input: DiagnosisTriggerInput = {
      healthChecks: [
        {
          id: "cost_spike",
          description: "Cost spike 60%",
          severity: "medium",
          value: 60,
          threshold: 50,
          recommendation: "Check costs.",
        },
      ],
      anomalies: [],
      escalations: [],
      lastDiagnosisTimestamp: null,
    };
    expect(shouldTriggerDiagnosis(input)).toBe(false);
  });

  it("returns false when no checks exist", () => {
    const input: DiagnosisTriggerInput = {
      healthChecks: [],
      anomalies: [],
      escalations: [],
      lastDiagnosisTimestamp: null,
    };
    expect(shouldTriggerDiagnosis(input)).toBe(false);
  });

  it("returns false when within cooldown period (< 6 hours since last diagnosis)", () => {
    const fiveHoursAgo = Date.now() - 5 * 60 * 60 * 1000;
    const input: DiagnosisTriggerInput = {
      healthChecks: [
        {
          id: "consecutive_failures",
          description: "5 consecutive failures",
          severity: "high",
          value: 5,
          threshold: 3,
          recommendation: "Check infrastructure.",
        },
      ],
      anomalies: [],
      escalations: [],
      lastDiagnosisTimestamp: fiveHoursAgo,
    };
    expect(shouldTriggerDiagnosis(input)).toBe(false);
  });

  it("returns true when cooldown has elapsed (>= 6 hours since last diagnosis)", () => {
    const sevenHoursAgo = Date.now() - 7 * 60 * 60 * 1000;
    const input: DiagnosisTriggerInput = {
      healthChecks: [
        {
          id: "high_error_rate",
          description: "Error rate 40%",
          severity: "high",
          value: 40,
          threshold: 30,
          recommendation: "Investigate.",
        },
      ],
      anomalies: [],
      escalations: [],
      lastDiagnosisTimestamp: sevenHoursAgo,
    };
    expect(shouldTriggerDiagnosis(input)).toBe(true);
  });

  it("counts anomalies as medium signals for compound threshold", () => {
    const input: DiagnosisTriggerInput = {
      healthChecks: [
        {
          id: "cost_spike",
          description: "Cost spike 60%",
          severity: "medium",
          value: 60,
          threshold: 50,
          recommendation: "Check costs.",
        },
      ],
      anomalies: [
        {
          metric: "costUsd",
          sessionRunId: "abc-5",
          sessionTimestamp: "2026-02-22T10:00:00Z",
          value: 12.5,
          mean: 5.0,
          stddev: 2.0,
          sigmaDeviation: 3.75,
          direction: "high",
          description: "Cost $12.50 is 3.8σ above mean $5.00",
          method: "sigma",
        },
      ],
      escalations: [],
      lastDiagnosisTimestamp: null,
    };
    expect(shouldTriggerDiagnosis(input)).toBe(true);
  });

  it("counts escalations as medium signals for compound threshold", () => {
    const input: DiagnosisTriggerInput = {
      healthChecks: [],
      anomalies: [],
      escalations: [
        {
          warningType: "orphaned_files",
          description: "orphaned_files appeared in 5/10 sessions",
          occurrences: 5,
          severity: "medium",
          recommendation: "Fix orphaned file management.",
          sessionTimestamps: [],
        },
        {
          warningType: "no_log_entry",
          description: "no_log_entry appeared in 4/10 sessions",
          occurrences: 4,
          severity: "medium",
          recommendation: "Fix missing log entries.",
          sessionTimestamps: [],
        },
      ],
      lastDiagnosisTimestamp: null,
    };
    expect(shouldTriggerDiagnosis(input)).toBe(true);
  });
});

// ── buildDiagnosisPrompt ────────────────────────────────────────────────

describe("buildDiagnosisPrompt", () => {
  it("includes health check descriptions in the prompt", () => {
    const checks: HealthCheck[] = [
      {
        id: "high_error_rate",
        description: "Error rate 45% exceeds 30% threshold",
        severity: "high",
        value: 45,
        threshold: 30,
        recommendation: "Investigate failing sessions.",
      },
    ];
    const prompt = buildDiagnosisPrompt({
      healthChecks: checks,
      anomalies: [],
      escalations: [],
    });
    expect(prompt).toContain("high_error_rate");
    expect(prompt).toContain("Error rate 45%");
    expect(prompt).toContain("/diagnose");
  });

  it("includes anomalies in the prompt", () => {
    const anomalies: Anomaly[] = [
      {
        metric: "costUsd",
        sessionRunId: "abc-5",
        sessionTimestamp: "2026-02-22T10:00:00Z",
        value: 12.5,
        mean: 5.0,
        stddev: 2.0,
        sigmaDeviation: 3.75,
        direction: "high",
        description: "Cost $12.50 is 3.8σ above mean",
        method: "sigma",
      },
    ];
    const prompt = buildDiagnosisPrompt({
      healthChecks: [],
      anomalies,
      escalations: [],
    });
    expect(prompt).toContain("costUsd");
    expect(prompt).toContain("3.8σ");
  });

  it("includes escalations in the prompt", () => {
    const escalations: WarningEscalation[] = [
      {
        warningType: "orphaned_files",
        description: "orphaned_files appeared in 5/10 sessions",
        occurrences: 5,
        severity: "medium",
        recommendation: "Fix orphaned file management.",
        sessionTimestamps: [],
      },
    ];
    const prompt = buildDiagnosisPrompt({
      healthChecks: [],
      anomalies: [],
      escalations,
    });
    expect(prompt).toContain("orphaned_files");
    expect(prompt).toContain("5/10 sessions");
  });

  it("instructs the agent to run /diagnose and commit results", () => {
    const prompt = buildDiagnosisPrompt({
      healthChecks: [
        {
          id: "high_error_rate",
          description: "Error rate 45%",
          severity: "high",
          value: 45,
          threshold: 30,
          recommendation: "Investigate.",
        },
      ],
      anomalies: [],
      escalations: [],
    });
    expect(prompt).toContain("diagnose");
    expect(prompt).toContain("commit");
    expect(prompt).toContain("sessions.jsonl");
  });

  it("includes all signal types when present", () => {
    const prompt = buildDiagnosisPrompt({
      healthChecks: [
        {
          id: "high_error_rate",
          description: "Error rate 45%",
          severity: "high",
          value: 45,
          threshold: 30,
          recommendation: "Investigate.",
        },
      ],
      anomalies: [
        {
          metric: "durationMs",
          sessionRunId: "abc-1",
          sessionTimestamp: "2026-02-22T10:00:00Z",
          value: 1800000,
          mean: 600000,
          stddev: 200000,
          sigmaDeviation: 6.0,
          direction: "high",
          description: "Duration 1800s is 6.0σ above mean",
          method: "percentile",
        },
      ],
      escalations: [
        {
          warningType: "no_commit",
          description: "no_commit appeared in 4/10 sessions",
          occurrences: 4,
          severity: "medium",
          recommendation: "Fix missing commits.",
          sessionTimestamps: [],
        },
      ],
    });
    expect(prompt).toContain("Health checks");
    expect(prompt).toContain("Anomalies");
    expect(prompt).toContain("Warning escalations");
  });
});
