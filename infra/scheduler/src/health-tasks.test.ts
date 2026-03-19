/** Tests for health-tasks — converts monitoring check outputs into TASKS.md entries. */

import { describe, it, expect } from "vitest";
import {
  formatHealthTask,
  formatAnomalyTask,
  formatEscalationTask,
  formatInteractionTask,
  deduplicateHealthTask,
  isWithinTTL,
  type HealthTaskCandidate,
} from "./health-tasks.js";
import type { HealthCheck } from "./health-watchdog.js";
import type { Anomaly } from "./anomaly-detection.js";
import type { WarningEscalation } from "./warning-escalation.js";
import type { InteractionAuditCheck } from "./interaction-audit.js";

// ── HealthCheck → task ──────────────────────────────────────────────────

describe("formatHealthTask", () => {
  it("converts high_error_rate check to task", () => {
    const check: HealthCheck = {
      id: "high_error_rate",
      description: "Error rate 45% exceeds 30% threshold",
      severity: "high",
      value: 45,
      threshold: 30,
      recommendation: "Investigate recent session failures",
    };
    const task = formatHealthTask(check);
    expect(task).not.toBeNull();
    expect(task!.line).toMatch(/^- \[ \] Investigate/);
    expect(task!.line).toContain("[detected:");
    expect(task!.source).toBe("health-watchdog:high_error_rate");
    expect(task!.priority).toBe("high");
  });

  it("converts cost_spike check to task", () => {
    const check: HealthCheck = {
      id: "cost_spike",
      description: "Median cost increased 75% above baseline",
      severity: "medium",
      value: 75,
      threshold: 50,
      recommendation: "Review recent session cost drivers",
    };
    const task = formatHealthTask(check);
    expect(task).not.toBeNull();
    expect(task!.priority).toBe("medium");
    expect(task!.source).toBe("health-watchdog:cost_spike");
  });

  it("converts consecutive_failures check to task", () => {
    const check: HealthCheck = {
      id: "consecutive_failures",
      description: "4 consecutive session failures detected",
      severity: "high",
      value: 4,
      threshold: 3,
      recommendation: "Check for systemic issues",
    };
    const task = formatHealthTask(check);
    expect(task).not.toBeNull();
    expect(task!.line).toMatch(/Investigate|Diagnose|Check/);
  });

  it("converts high_zero_knowledge_rate check to task", () => {
    const check: HealthCheck = {
      id: "high_zero_knowledge_rate",
      description: "25% of sessions produced zero knowledge",
      severity: "medium",
      value: 25,
      threshold: 20,
      recommendation: "Investigate waste sessions",
    };
    const task = formatHealthTask(check);
    expect(task).not.toBeNull();
    expect(task!.source).toBe("health-watchdog:high_zero_knowledge_rate");
  });
});

// ── Anomaly → task ──────────────────────────────────────────────────────

describe("formatAnomalyTask", () => {
  it("converts cost anomaly to task", () => {
    const anomaly: Anomaly = {
      metric: "costUsd",
      sessionRunId: "abc123",
      sessionTimestamp: "2026-02-21T10:00:00Z",
      value: 3.50,
      mean: 1.20,
      stddev: 0.50,
      sigmaDeviation: 4.6,
      direction: "high",
      description: "Session abc123 cost $3.50 (4.6σ above mean $1.20)",
      method: "sigma",
    };
    const task = formatAnomalyTask(anomaly);
    expect(task).not.toBeNull();
    expect(task!.line).toContain("cost");
    expect(task!.source).toBe("anomaly-detection:costUsd");
  });

  it("converts low knowledge anomaly to task", () => {
    const anomaly: Anomaly = {
      metric: "knowledgeTotal",
      sessionRunId: "def456",
      sessionTimestamp: "2026-02-21T12:00:00Z",
      value: 0,
      mean: 5.0,
      stddev: 2.0,
      sigmaDeviation: 2.5,
      direction: "low",
      description: "Session def456 knowledge output 0 (2.5σ below mean 5.0)",
      method: "sigma",
    };
    const task = formatAnomalyTask(anomaly);
    expect(task).not.toBeNull();
    expect(task!.source).toBe("anomaly-detection:knowledgeTotal");
  });
});

// ── WarningEscalation → task ────────────────────────────────────────────

describe("formatEscalationTask", () => {
  it("converts no_commit escalation to task", () => {
    const esc: WarningEscalation = {
      warningType: "no_commit",
      description: "5 of 20 sessions had no commit",
      occurrences: 5,
      severity: "high",
      recommendation: "Check if sessions are completing normally",
      sessionTimestamps: ["2026-02-20T00:00:00Z", "2026-02-20T06:00:00Z"],
    };
    const task = formatEscalationTask(esc);
    expect(task).not.toBeNull();
    expect(task!.source).toBe("warning-escalation:no_commit");
    expect(task!.line).toContain("[detected:");
  });

  it("converts orphaned_files escalation to task", () => {
    const esc: WarningEscalation = {
      warningType: "orphaned_files",
      description: "4 of 20 sessions left orphaned files",
      occurrences: 4,
      severity: "medium",
      recommendation: "Investigate why files are not being committed",
      sessionTimestamps: [],
    };
    const task = formatEscalationTask(esc);
    expect(task).not.toBeNull();
    expect(task!.priority).toBe("medium");
  });
});

// ── InteractionAuditCheck → task ────────────────────────────────────────

describe("formatInteractionTask", () => {
  it("converts low_fulfillment_rate check to task", () => {
    const check: InteractionAuditCheck = {
      id: "low_fulfillment_rate",
      description: "Intent fulfillment rate 55% below 70% threshold",
      severity: "high",
      value: 55,
      threshold: 70,
      recommendation: "Review recent interactions for common failure patterns",
    };
    const task = formatInteractionTask(check);
    expect(task).not.toBeNull();
    expect(task!.source).toBe("interaction-audit:low_fulfillment_rate");
    expect(task!.priority).toBe("high");
  });
});

// ── Deduplication ───────────────────────────────────────────────────────

describe("deduplicateHealthTask", () => {
  it("detects duplicate by source ID in existing tasks", () => {
    const candidate: HealthTaskCandidate = {
      line: "- [ ] Investigate high session error rate [detected: 2026-02-21]",
      why: "health-watchdog:high_error_rate detected error rate 45% (threshold 30%)",
      doneWhen: "Error rate drops below 30% threshold or root cause documented",
      source: "health-watchdog:high_error_rate",
      priority: "high",
    };
    const existingTasks = `
- [ ] Investigate high session error rate [detected: 2026-02-20]
  Why: health-watchdog:high_error_rate detected error rate 40% (threshold 30%)
  Done when: Error rate drops below 30% threshold or root cause documented
`;
    expect(deduplicateHealthTask(candidate, existingTasks)).toBe(true);
  });

  it("does not flag different source IDs as duplicates", () => {
    const candidate: HealthTaskCandidate = {
      line: "- [ ] Investigate session cost spike [detected: 2026-02-21]",
      why: "health-watchdog:cost_spike detected cost increase 75% (threshold 50%)",
      doneWhen: "Cost spike cause identified",
      source: "health-watchdog:cost_spike",
      priority: "medium",
    };
    const existingTasks = `
- [ ] Investigate high session error rate [detected: 2026-02-20]
  Why: health-watchdog:high_error_rate detected error rate 40% (threshold 30%)
`;
    expect(deduplicateHealthTask(candidate, existingTasks)).toBe(false);
  });

  it("detects duplicate even if task wording differs slightly", () => {
    const candidate: HealthTaskCandidate = {
      line: "- [ ] Investigate high error rate [detected: 2026-02-21]",
      why: "health-watchdog:high_error_rate detected ...",
      doneWhen: "...",
      source: "health-watchdog:high_error_rate",
      priority: "high",
    };
    const existingTasks = `
- [ ] Fix session error rate issue
  Why: health-watchdog:high_error_rate — error rate too high
`;
    expect(deduplicateHealthTask(candidate, existingTasks)).toBe(true);
  });
});

// ── TTL ─────────────────────────────────────────────────────────────────

describe("isWithinTTL", () => {
  it("returns true if same source detected within 7 days", () => {
    const existingTasks = `
- [ ] Investigate high session error rate [detected: 2026-02-18]
  Why: health-watchdog:high_error_rate detected error rate 45%
`;
    expect(isWithinTTL("health-watchdog:high_error_rate", existingTasks, new Date("2026-02-21"))).toBe(true);
  });

  it("returns false if same source detected more than 7 days ago", () => {
    const existingTasks = `
- [ ] Investigate high session error rate [detected: 2026-02-10]
  Why: health-watchdog:high_error_rate detected error rate 45%
`;
    expect(isWithinTTL("health-watchdog:high_error_rate", existingTasks, new Date("2026-02-21"))).toBe(false);
  });

  it("returns false if source not found in existing tasks", () => {
    const existingTasks = `
- [ ] Some other task
  Why: something else
`;
    expect(isWithinTTL("health-watchdog:high_error_rate", existingTasks, new Date("2026-02-21"))).toBe(false);
  });

  it("handles completed tasks (should still respect TTL)", () => {
    const existingTasks = `
- [x] Investigate high session error rate [detected: 2026-02-19]
  Why: health-watchdog:high_error_rate detected error rate 45%
`;
    expect(isWithinTTL("health-watchdog:high_error_rate", existingTasks, new Date("2026-02-21"))).toBe(true);
  });
});
