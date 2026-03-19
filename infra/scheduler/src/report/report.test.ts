/** Tests for report generation: data aggregation, rendering, and engine. */

import { describe, it, expect } from "vitest";
import { aggregateSessions } from "./data-sessions.js";
import { aggregateEfficiency } from "./data-efficiency.js";
import { parseExperimentMd, scanExperiments } from "./data-experiments.js";
import { renderChart } from "./chart-render.js";
import { generateReport } from "./engine.js";
import {
  renderOperationalSlack,
  renderResearchSlack,
  renderProjectSlack,
  renderExperimentComparisonSlack,
} from "./render-slack.js";
import type {
  SessionMetrics,
} from "../metrics.js";
import type {
  ReportData,
  SessionSummary,
  KnowledgeSummary,
  BudgetSummary,
  ExperimentRecord,
  ProjectSummary,
  EfficiencySummary,
  ChartSpec,
} from "./types.js";

function makeSession(overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    timestamp: "2026-02-17T10:00:00.000Z",
    jobName: "test-job",
    runId: "test-1",
    backend: "claude",
    durationMs: 600_000,
    costUsd: 3.5,
    numTurns: 40,
    timedOut: false,
    ok: true,
    verification: null,
    knowledge: null,
    budgetGate: null,
    modelUsage: null,
    toolCounts: null,
    orientTurns: null,
    crossProject: null,
    qualityAudit: null,
    ...overrides,
  };
}

function makeKnowledge(findings: number, extra: Record<string, number> = {}) {
  return {
    newExperimentFindings: findings,
    newDecisionRecords: 0,
    newLiteratureNotes: 0,
    openQuestionsResolved: 0,
    openQuestionsDiscovered: 0,
    experimentsCompleted: 0,
    crossReferences: 0,
    newAnalysisFiles: 0,
    logEntryFindings: 0,
    infraCodeChanges: 0,
    bugfixVerifications: 0,
    compoundActions: 0,
    structuralChanges: 0,
    feedbackProcessed: 0,
    diagnosesCompleted: 0,
    ...extra,
  };
}

function makeSessionSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    totalSessions: 10,
    successRate: 0.9,
    totalCostUsd: 25.5,
    avgCostPerSession: 2.55,
    avgDurationMs: 600_000,
    avgTurns: 45,
    byDay: [
      { date: "2026-02-16", sessions: 4, successes: 4, failures: 0, totalCostUsd: 15.0, totalDurationMs: 2400000, avgTurns: 50 },
      { date: "2026-02-17", sessions: 6, successes: 5, failures: 1, totalCostUsd: 10.5, totalDurationMs: 3600000, avgTurns: 40 },
    ],
    ...overrides,
  };
}

function makeKnowledgeSummary(overrides: Partial<KnowledgeSummary> = {}): KnowledgeSummary {
  return {
    totalExperiments: 20,
    completedExperiments: 15,
    totalFindings: 40,
    decisionRecords: 10,
    avgFindingsPerExperiment: 2.7,
    ...overrides,
  };
}

function makeExperiment(overrides: Partial<ExperimentRecord> = {}): ExperimentRecord {
  return {
    id: "test-exp",
    project: "test-project",
    type: "experiment",
    status: "completed",
    date: "2026-02-17",
    tags: [],
    consumesResources: true,
    findingsCount: 3,
    title: "Test Experiment",
    path: "projects/test-project/experiments/test-exp",
    ...overrides,
  };
}

function makeEfficiency(overrides: Partial<EfficiencySummary> = {}): EfficiencySummary {
  return {
    totalSessions: 10,
    findingsPerDollar: 0.5,
    avgCostPerFinding: 2.0,
    avgTurnsPerFinding: 15.0,
    zeroKnowledgeRate: 0.3,
    genuineWasteRate: 0.05,
    highContextUtilizationRate: 0.1,
    maxContextUtilization: 0.65,
    byDay: [],
    ...overrides,
  };
}

function makeReportData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    generatedAt: "2026-02-17T12:00:00Z",
    period: { from: "2026-02-10", to: "2026-02-17" },
    sessions: makeSessionSummary(),
    budgets: [],
    experiments: [makeExperiment()],
    projects: [],
    knowledge: makeKnowledgeSummary(),
    efficiency: makeEfficiency(),
    ...overrides,
  };
}

const SAMPLE_EXPERIMENT = `---
id: strategic-100
status: completed
date: 2026-02-15
project: sample-project
consumes_resources: true
tags: [multi-judge, strategic-subset]
---

# Strategic 100-Call Multi-Judge Experiment

## Design

Hypothesis: Different frontier LLM judges will show varying alignment.

## Findings

1. **gemini-3-flash is the best judge at 36.4% PC**
2. **56% of errors are shared by all 3 judges**
3. **Oracle upper bound is 52.7%**
`;

const PLANNED_EXPERIMENT = `---
id: view-augmentation
status: planned
date: 2026-02-14
project: sample-project
consumes_resources: true
---

# View Augmentation Hard Tasks

## Design

Hypothesis: Adding multiple views improves accuracy.
`;

describe("aggregateSessions", () => {
  it("returns zero summary for empty input", () => {
    const result = aggregateSessions([]);
    expect(result.totalSessions).toBe(0);
    expect(result.successRate).toBe(0);
    expect(result.totalCostUsd).toBe(0);
    expect(result.byDay).toEqual([]);
  });

  it("computes correct totals for multiple sessions", () => {
    const sessions = [
      makeSession({ timestamp: "2026-02-16T09:00:00Z", costUsd: 5.0, ok: true }),
      makeSession({ timestamp: "2026-02-16T21:00:00Z", costUsd: 3.0, ok: false }),
      makeSession({ timestamp: "2026-02-17T10:00:00Z", costUsd: 2.0, ok: true }),
    ];
    const result = aggregateSessions(sessions);

    expect(result.totalSessions).toBe(3);
    expect(result.successRate).toBeCloseTo(2 / 3);
    expect(result.totalCostUsd).toBe(10.0);
    expect(result.avgCostPerSession).toBeCloseTo(10 / 3);
  });

  it("groups sessions by day", () => {
    const sessions = [
      makeSession({ timestamp: "2026-02-16T09:00:00Z", costUsd: 5.0, ok: true }),
      makeSession({ timestamp: "2026-02-16T21:00:00Z", costUsd: 3.0, ok: false }),
      makeSession({ timestamp: "2026-02-17T10:00:00Z", costUsd: 2.0, ok: true }),
    ];
    const result = aggregateSessions(sessions);

    expect(result.byDay).toHaveLength(2);
    expect(result.byDay[0].date).toBe("2026-02-16");
    expect(result.byDay[0].sessions).toBe(2);
    expect(result.byDay[0].successes).toBe(1);
    expect(result.byDay[0].failures).toBe(1);
    expect(result.byDay[0].totalCostUsd).toBe(8.0);
    expect(result.byDay[1].date).toBe("2026-02-17");
    expect(result.byDay[1].sessions).toBe(1);
  });

  it("handles null cost and turns", () => {
    const sessions = [
      makeSession({ costUsd: null, numTurns: null }),
      makeSession({ costUsd: 2.0, numTurns: 30 }),
    ];
    const result = aggregateSessions(sessions);

    expect(result.totalCostUsd).toBe(2.0);
    expect(result.avgTurns).toBe(30);
  });

  it("computes average duration", () => {
    const sessions = [
      makeSession({ durationMs: 300_000 }),
      makeSession({ durationMs: 900_000 }),
    ];
    const result = aggregateSessions(sessions);
    expect(result.avgDurationMs).toBe(600_000);
  });
});

describe("aggregateEfficiency", () => {
  it("returns zero summary for empty input", () => {
    const result = aggregateEfficiency([]);
    expect(result.totalSessions).toBe(0);
    expect(result.findingsPerDollar).toBe(0);
    expect(result.avgCostPerFinding).toBe(0);
    expect(result.avgTurnsPerFinding).toBe(0);
    expect(result.zeroKnowledgeRate).toBe(0);
    expect(result.genuineWasteRate).toBe(0);
    expect(result.byDay).toEqual([]);
  });

  it("computes findings-per-dollar from knowledge sessions", () => {
    const sessions = [
      makeSession({ costUsd: 5.0, knowledge: makeKnowledge(3) }),
      makeSession({ costUsd: 3.0, knowledge: makeKnowledge(0) }),
      makeSession({ costUsd: 2.0, knowledge: makeKnowledge(2) }),
    ];
    const result = aggregateEfficiency(sessions);
    expect(result.findingsPerDollar).toBeCloseTo(0.5);
  });

  it("computes cost-per-finding and turns-per-finding", () => {
    const sessions = [
      makeSession({ costUsd: 4.0, numTurns: 60, knowledge: makeKnowledge(4) }),
      makeSession({ costUsd: 6.0, numTurns: 80, knowledge: makeKnowledge(1) }),
    ];
    const result = aggregateEfficiency(sessions);
    expect(result.avgCostPerFinding).toBeCloseTo(2.0);
    expect(result.avgTurnsPerFinding).toBeCloseTo(47.5);
  });

  it("computes zero-knowledge rate", () => {
    const sessions = [
      makeSession({ knowledge: makeKnowledge(0) }),
      makeSession({ knowledge: makeKnowledge(0) }),
      makeSession({ knowledge: makeKnowledge(3) }),
      makeSession({ knowledge: null }),
    ];
    const result = aggregateEfficiency(sessions);
    expect(result.zeroKnowledgeRate).toBeCloseTo(2 / 3);
  });

  it("counts genuine waste — zero knowledge, no orphans, low file changes, claude backend", () => {
    const sessions = [
      makeSession({
        backend: "claude",
        knowledge: makeKnowledge(0),
        verification: {
          uncommittedFiles: 0, orphanedFiles: 0, hasLogEntry: true, hasCommit: false,
          hasCompleteFooter: true, ledgerConsistent: true, filesChanged: 0, commitCount: 0, agentCommitCount: 0, warningCount: 0,
          l2ViolationCount: 0, l2ChecksPerformed: 0,
        },
      }),
      makeSession({
        backend: "claude",
        knowledge: makeKnowledge(0),
        verification: {
          uncommittedFiles: 0, orphanedFiles: 5, hasLogEntry: true, hasCommit: true,
          hasCompleteFooter: true, ledgerConsistent: true, filesChanged: 3, commitCount: 1, agentCommitCount: 1, warningCount: 0,
          l2ViolationCount: 0, l2ChecksPerformed: 0,
        },
      }),
      makeSession({
        backend: "claude",
        knowledge: makeKnowledge(0),
        verification: {
          uncommittedFiles: 0, orphanedFiles: 0, hasLogEntry: true, hasCommit: true,
          hasCompleteFooter: true, ledgerConsistent: true, filesChanged: 100, commitCount: 1, agentCommitCount: 1, warningCount: 0,
          l2ViolationCount: 0, l2ChecksPerformed: 0,
        },
      }),
      makeSession({
        backend: "cursor",
        knowledge: makeKnowledge(0),
        verification: {
          uncommittedFiles: 0, orphanedFiles: 0, hasLogEntry: true, hasCommit: true,
          hasCompleteFooter: true, ledgerConsistent: true, filesChanged: 3, commitCount: 1, agentCommitCount: 1, warningCount: 0,
          l2ViolationCount: 0, l2ChecksPerformed: 0,
        },
      }),
      makeSession({
        backend: "claude",
        knowledge: makeKnowledge(2),
        verification: {
          uncommittedFiles: 0, orphanedFiles: 0, hasLogEntry: true, hasCommit: true,
          hasCompleteFooter: true, ledgerConsistent: true, filesChanged: 3, commitCount: 1, agentCommitCount: 1, warningCount: 0,
          l2ViolationCount: 0, l2ChecksPerformed: 0,
        },
      }),
    ];
    const result = aggregateEfficiency(sessions);
    expect(result.genuineWasteRate).toBeCloseTo(0.2);
  });

  it("groups efficiency by day", () => {
    const sessions = [
      makeSession({ timestamp: "2026-02-16T09:00:00Z", costUsd: 5.0, knowledge: makeKnowledge(3) }),
      makeSession({ timestamp: "2026-02-16T21:00:00Z", costUsd: 3.0, knowledge: makeKnowledge(0) }),
      makeSession({ timestamp: "2026-02-17T10:00:00Z", costUsd: 2.0, knowledge: makeKnowledge(2) }),
    ];
    const result = aggregateEfficiency(sessions);
    expect(result.byDay).toHaveLength(2);
    expect(result.byDay[0].date).toBe("2026-02-16");
    expect(result.byDay[0].totalFindings).toBe(3);
    expect(result.byDay[0].findingsPerDollar).toBeCloseTo(3 / 8);
    expect(result.byDay[1].date).toBe("2026-02-17");
    expect(result.byDay[1].totalFindings).toBe(2);
    expect(result.byDay[1].findingsPerDollar).toBeCloseTo(1.0);
  });

  it("counts all knowledge fields for total knowledge sum", () => {
    const sessions = [
      makeSession({
        costUsd: 1.0,
        knowledge: makeKnowledge(2, {
          newDecisionRecords: 1,
          logEntryFindings: 3,
          compoundActions: 1,
          structuralChanges: 2,
        }),
      }),
    ];
    const result = aggregateEfficiency(sessions);
    expect(result.findingsPerDollar).toBeCloseTo(5.0);
  });

  it("handles null cost gracefully", () => {
    const sessions = [
      makeSession({ costUsd: null, knowledge: makeKnowledge(3) }),
    ];
    const result = aggregateEfficiency(sessions);
    expect(result.findingsPerDollar).toBe(0);
    expect(result.avgCostPerFinding).toBe(0);
  });
});

describe("parseExperimentMd", () => {
  it("parses frontmatter and findings from completed experiment", () => {
    const result = parseExperimentMd(SAMPLE_EXPERIMENT, "projects/sample-project/experiments/strategic-100");

    expect(result.id).toBe("strategic-100");
    expect(result.status).toBe("completed");
    expect(result.date).toBe("2026-02-15");
    expect(result.project).toBe("sample-project");
    expect(result.consumesResources).toBe(true);
    expect(result.tags).toEqual(["multi-judge", "strategic-subset"]);
    expect(result.findingsCount).toBe(3);
    expect(result.title).toBe("Strategic 100-Call Multi-Judge Experiment");
    expect(result.path).toBe("projects/sample-project/experiments/strategic-100");
  });

  it("parses planned experiment with zero findings", () => {
    const result = parseExperimentMd(PLANNED_EXPERIMENT, "projects/sample-project/experiments/view-augmentation");

    expect(result.id).toBe("view-augmentation");
    expect(result.status).toBe("planned");
    expect(result.findingsCount).toBe(0);
    expect(result.tags).toEqual([]);
  });

  it("defaults type to experiment when missing", () => {
    const result = parseExperimentMd(SAMPLE_EXPERIMENT, "test/path");
    expect(result.type).toBe("experiment");
  });
});

describe("scanExperiments", () => {
  it("returns empty array for nonexistent directory", async () => {
    const result = await scanExperiments("/nonexistent/path/xyzzy");
    expect(result).toEqual([]);
  });
});

describe("renderChart", () => {
  it("renders a simple bar chart to PNG buffer", async () => {
    const spec: ChartSpec = {
      id: "test-bar",
      title: "Test Bar Chart",
      config: {
        type: "bar",
        data: {
          labels: ["A", "B", "C"],
          datasets: [{ label: "Values", data: [10, 20, 30] }],
        },
        options: { animation: false },
      },
      width: 400,
      height: 300,
    };

    const buffer = await renderChart(spec);

    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50);
    expect(buffer[2]).toBe(0x4e);
    expect(buffer[3]).toBe(0x47);
    expect(buffer.length).toBeGreaterThan(100);
  });

  it("renders a line chart", async () => {
    const spec: ChartSpec = {
      id: "test-line",
      title: "Test Line",
      config: {
        type: "line",
        data: {
          labels: ["Jan", "Feb", "Mar"],
          datasets: [{ label: "Cost", data: [1.5, 2.3, 3.1] }],
        },
        options: { animation: false },
      },
    };

    const buffer = await renderChart(spec);
    expect(buffer[0]).toBe(0x89);
    expect(buffer.length).toBeGreaterThan(100);
  });

  it("uses default dimensions when not specified", async () => {
    const spec: ChartSpec = {
      id: "test-default",
      title: "Defaults",
      config: {
        type: "doughnut",
        data: {
          labels: ["Done", "Remaining"],
          datasets: [{ data: [70, 30] }],
        },
        options: { animation: false },
      },
    };

    const buffer = await renderChart(spec);
    expect(buffer[0]).toBe(0x89);
  });
});

describe("generateReport", () => {
  it("generates operational markdown report from real repo data", async () => {
    const repoDir = new URL("../../../..", import.meta.url).pathname.replace(/\/$/, "");

    const result = await generateReport({
      type: "operational",
      format: "markdown",
      repoDir,
    });

    expect(result.content).toContain("# Operational Report");
    expect(result.content).toContain("Session");
    expect(result.content).toMatch(/##/);
  });

  it("generates research digest from real repo data", async () => {
    const repoDir = new URL("../../../..", import.meta.url).pathname.replace(/\/$/, "");

    const result = await generateReport({
      type: "research",
      format: "markdown",
      repoDir,
    });

    expect(result.content).toContain("# Research Digest");
    expect(result.content).toMatch(/experiment/i);
  });

  it("generates project status report", async () => {
    const repoDir = new URL("../../../..", import.meta.url).pathname.replace(/\/$/, "");

    const result = await generateReport({
      type: "project",
      format: "markdown",
      repoDir,
    });

    expect(result.content).toContain("# Project Status");
  });

  it("generates experiment comparison report", async () => {
    const repoDir = new URL("../../../..", import.meta.url).pathname.replace(/\/$/, "");

    const result = await generateReport({
      type: "experiment-comparison",
      format: "markdown",
      repoDir,
    });

    expect(result.content).toContain("# Experiment Comparison");
  });

  it("returns charts with markdown reports", async () => {
    const repoDir = new URL("../../../..", import.meta.url).pathname.replace(/\/$/, "");

    const result = await generateReport({
      type: "operational",
      format: "markdown",
      repoDir,
    });

    expect(result.charts.length).toBeGreaterThanOrEqual(0);
    for (const chart of result.charts) {
      expect(chart.id).toBeTruthy();
      expect(chart.buffer.length).toBeGreaterThan(0);
    }
  });
});

describe("renderOperationalSlack", () => {
  it("returns Block Kit blocks with header and session stats", () => {
    const data = makeReportData();
    const blocks = renderOperationalSlack(data);

    expect(blocks.length).toBeGreaterThan(0);
    const header = blocks[0] as { type: string; text: { text: string } };
    expect(header.type).toBe("header");
    expect(header.text.text).toContain("Operational Report");

    const sections = blocks.filter((b) => (b as { type: string }).type === "section");
    expect(sections.length).toBeGreaterThan(0);
  });

  it("includes budget warnings when budget data present", () => {
    const budget: BudgetSummary = {
      project: "test-project",
      resources: [{ resource: "llm_api_calls", consumed: 800, limit: 1000, unit: "calls", pct: 80 }],
      deadline: "2026-03-01T00:00:00Z",
      hoursToDeadline: 240,
    };
    const data = makeReportData({ budgets: [budget] });
    const blocks = renderOperationalSlack(data);

    const text = JSON.stringify(blocks);
    expect(text).toContain("test-project");
    expect(text).toContain("80%");
  });

  it("includes text progress bars as fallback", () => {
    const budget: BudgetSummary = {
      project: "eval-project",
      resources: [{ resource: "api_calls", consumed: 700, limit: 1000, unit: "calls", pct: 70 }],
    };
    const data = makeReportData({ budgets: [budget] });
    const blocks = renderOperationalSlack(data);
    const text = JSON.stringify(blocks);
    expect(text).toContain("▓");
  });
});

describe("renderResearchSlack", () => {
  it("returns blocks with knowledge summary", () => {
    const data = makeReportData();
    const blocks = renderResearchSlack(data);

    expect(blocks.length).toBeGreaterThan(0);
    const header = blocks[0] as { type: string; text: { text: string } };
    expect(header.type).toBe("header");
    expect(header.text.text).toContain("Research Digest");
  });

  it("lists completed experiments", () => {
    const data = makeReportData({
      experiments: [
        makeExperiment({ id: "exp-1", findingsCount: 5 }),
        makeExperiment({ id: "exp-2", status: "planned", findingsCount: 0 }),
      ],
    });
    const blocks = renderResearchSlack(data);
    const text = JSON.stringify(blocks);
    expect(text).toContain("exp-1");
  });
});

describe("renderProjectSlack", () => {
  it("renders single project status", () => {
    const project: ProjectSummary = {
      name: "test-proj",
      status: "active",
      mission: "Test the things",
      doneWhen: "Things are tested",
      logEntries: [],
      tasks: [
        { text: "Do something", done: false, tags: [] },
        { text: "Already done", done: true, tags: [] },
      ],
      openQuestions: ["What is the meaning?"],
      experiments: [makeExperiment()],
    };
    const data = makeReportData({ projects: [project] });
    const blocks = renderProjectSlack(data, "test-proj");

    expect(blocks.length).toBeGreaterThan(0);
    const text = JSON.stringify(blocks);
    expect(text).toContain("test-proj");
    expect(text).toContain("active");
    expect(text).toContain("1/2");
  });
});

describe("renderExperimentComparisonSlack", () => {
  it("renders comparison table", () => {
    const data = makeReportData({
      experiments: [
        makeExperiment({ id: "exp-a", findingsCount: 5 }),
        makeExperiment({ id: "exp-b", findingsCount: 3 }),
      ],
    });
    const blocks = renderExperimentComparisonSlack(data);

    expect(blocks.length).toBeGreaterThan(0);
    const text = JSON.stringify(blocks);
    expect(text).toContain("exp-a");
    expect(text).toContain("exp-b");
  });
});
