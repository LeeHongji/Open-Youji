/** Tests for recommendation extraction from experiments, diagnoses, and postmortems. */

import { describe, it, expect } from "vitest";
import {
  extractRecommendationSections,
  extractSourceId,
  parseRecommendations,
  formatAsTask,
  deduplicateAgainstExisting,
  extractFindingsSection,
  splitFindings,
  detectImpliedTaskPatterns,
  extractImpliedTasks,
  detectPhases,
  formatImpliedTaskAsCandidate,
  type Recommendation,
  type TaskCandidate,
} from "./recommendations.js";

// ---------------------------------------------------------------------------
// extractRecommendationSections
// ---------------------------------------------------------------------------

describe("extractRecommendationSections", () => {
  it("extracts a ## Recommendations section", () => {
    const content = `---
id: test-exp
status: completed
date: 2026-02-19
project: youji
consumes_resources: false
---

# Test Experiment

## Findings

Finding 1.

## Recommendations

1. **Implement burst mode** as a CLI extension.
2. **Add compound metric** to session tracking.
`;
    const sections = extractRecommendationSections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.header).toBe("Recommendations");
    expect(sections[0]!.body).toContain("Implement burst mode");
    expect(sections[0]!.body).toContain("Add compound metric");
  });

  it("extracts ## Proposal: prefixed headers", () => {
    const content = `---
id: ralph-loop
status: completed
date: 2026-02-19
project: youji
consumes_resources: false
---

## Proposal: Strengthen Self-Evolution

### Change 1: Add compound phase
Do X.

### Change 2: Add burst mode
Do Y.

## Some other section
`;
    const sections = extractRecommendationSections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.header).toContain("Proposal");
    expect(sections[0]!.body).toContain("Add compound phase");
  });

  it("extracts ## Prevention section", () => {
    const content = `---
id: postmortem-test
status: completed
date: 2026-02-19
project: youji
consumes_resources: false
---

## Problem
Something broke.

## Prevention

1. Add a guard.
2. Update SOP.
`;
    const sections = extractRecommendationSections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.header).toBe("Prevention");
  });

  it("extracts ## Next steps section", () => {
    const content = `---
id: diag-test
status: completed
date: 2026-02-19
project: youji
consumes_resources: false
---

## Next steps

1. Fix the bug.
2. Add regression test.
`;
    const sections = extractRecommendationSections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.header).toBe("Next steps");
  });

  it("extracts ## Implications for... section", () => {
    const content = `---
id: crowd-perf
status: completed
date: 2026-02-19
project: youji
consumes_resources: false
---

## Implications for downstream analyses

- Stratify by taxonomy.
- Separately analyze mesh-domain and texture-domain.
`;
    const sections = extractRecommendationSections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.header).toContain("Implications");
  });

  it("extracts multiple recommendation sections from one file", () => {
    const content = `---
id: multi-rec
status: completed
date: 2026-02-19
project: youji
consumes_resources: false
---

## Recommendations

1. Do A.

## Next steps

1. Do B.
`;
    const sections = extractRecommendationSections(content);
    expect(sections).toHaveLength(2);
  });

  it("returns empty array when no recommendation sections exist", () => {
    const content = `---
id: no-rec
status: completed
date: 2026-02-19
project: youji
consumes_resources: false
---

## Findings

1. Something interesting.

## Reproducibility

Run the script.
`;
    const sections = extractRecommendationSections(content);
    expect(sections).toHaveLength(0);
  });

  it("is case-insensitive for header matching", () => {
    const content = `---
id: case-test
status: completed
date: 2026-02-19
project: youji
consumes_resources: false
---

## RECOMMENDATIONS

1. Do something.
`;
    const sections = extractRecommendationSections(content);
    expect(sections).toHaveLength(1);
  });

  it("handles ### level headers", () => {
    const content = `---
id: h3-test
status: completed
date: 2026-02-19
project: youji
consumes_resources: false
---

## Section

### Recommendation

Use depth 8 as default.
`;
    const sections = extractRecommendationSections(content);
    expect(sections).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// parseRecommendations
// ---------------------------------------------------------------------------

describe("parseRecommendations", () => {
  it("parses numbered recommendations", () => {
    const body = `1. **Implement burst mode** as a CLI extension.
2. **Add compound metric** to session tracking.
3. **Do NOT unify** the job systems.`;
    const recs = parseRecommendations(body, "test-exp", "Recommendations");
    expect(recs).toHaveLength(3);
    expect(recs[0]!.text).toContain("Implement burst mode");
    expect(recs[0]!.sourceId).toBe("test-exp");
  });

  it("parses bulleted recommendations", () => {
    const body = `- Stratify by taxonomy categories.
- Separately analyze mesh-domain and texture-domain dimensions.`;
    const recs = parseRecommendations(body, "crowd-perf", "Implications");
    expect(recs).toHaveLength(2);
  });

  it("parses checkbox-style recommendations", () => {
    const body = `- [ ] Check model-b's van renders more carefully.
- [ ] Test whether adding wireframe views improves correctness.`;
    const recs = parseRecommendations(body, "task-067", "Recommendations");
    expect(recs).toHaveLength(2);
    expect(recs[0]!.text).not.toContain("[ ]");
  });

  it("handles multi-line recommendations (continuation lines)", () => {
    const body = `1. **Implement burst mode** as a CLI extension.
   Reuses executeJob() in a loop with cost/session stop conditions.
2. **Add compound metric** to session tracking.`;
    const recs = parseRecommendations(body, "test-exp", "Recommendations");
    expect(recs).toHaveLength(2);
    expect(recs[0]!.text).toContain("Reuses executeJob");
  });

  it("returns empty array for empty body", () => {
    const recs = parseRecommendations("", "test-exp", "Recommendations");
    expect(recs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// formatAsTask
// ---------------------------------------------------------------------------

describe("formatAsTask", () => {
  it("formats a recommendation as a schema-compliant task", () => {
    const rec: Recommendation = {
      sourceId: "job-unification-analysis",
      sectionHeader: "Recommendations",
      text: "Implement burst mode as a CLI extension. Reuses executeJob() in a loop.",
    };
    const task = formatAsTask(rec);
    expect(task).not.toBeNull();
    expect(task!.line).toMatch(/^- \[ \] /);
    expect(task!.why).toContain("From job-unification-analysis");
    expect(task!.sourceId).toBe("job-unification-analysis");
  });

  it("skips negative recommendations (Do NOT/Do not)", () => {
    const rec: Recommendation = {
      sourceId: "job-unification",
      sectionHeader: "Recommendations",
      text: "Do NOT unify the job systems. The execution model mismatch makes unification a net-negative.",
    };
    const task = formatAsTask(rec);
    expect(task).toBeNull();
  });

  it("skips observation-only recommendations without actions", () => {
    const rec: Recommendation = {
      sourceId: "crowd-perf",
      sectionHeader: "Implications",
      text: "Vehicle and Mechanical categories warrant special attention in future analyses.",
    };
    const task = formatAsTask(rec);
    expect(task).toBeNull();
  });

  it("adds [zero-resource] tag for documentation/analysis tasks", () => {
    const rec: Recommendation = {
      sourceId: "test-exp",
      sectionHeader: "Recommendations",
      text: "Document the per-category breakdown in analysis/per-category-results.md.",
    };
    const task = formatAsTask(rec);
    expect(task).not.toBeNull();
    expect(task!.tags).toContain("zero-resource");
  });

  it("adds [approval-needed] tag for governance changes", () => {
    const rec: Recommendation = {
      sourceId: "test-exp",
      sectionHeader: "Recommendations",
      text: "Update CLAUDE.md provenance section with the new verification procedure.",
    };
    const task = formatAsTask(rec);
    expect(task).not.toBeNull();
    expect(task!.tags).toContain("approval-needed");
  });

  it("formats task from diagnosis source with sourceId", () => {
    const rec: Recommendation = {
      sourceId: "diagnosis-low-synthesis-rate-2026-02-22",
      sectionHeader: "Recommendations",
      text: "Add synthesis mention to CLAUDE.md for persistent awareness across sessions.",
    };
    const task = formatAsTask(rec);
    expect(task).not.toBeNull();
    expect(task!.why).toContain("From diagnosis-low-synthesis-rate-2026-02-22");
    expect(task!.sourceId).toBe("diagnosis-low-synthesis-rate-2026-02-22");
  });

  it("formats task from postmortem Prevention section", () => {
    const rec: Recommendation = {
      sourceId: "postmortem-flash-240-retry-waste-2026-02-20",
      sectionHeader: "Prevention",
      text: "Add retry progress guard to experiment runner to detect stalled retries.",
    };
    const task = formatAsTask(rec);
    expect(task).not.toBeNull();
    expect(task!.why).toContain("From postmortem-flash-240-retry-waste-2026-02-20");
    expect(task!.sourceId).toBe("postmortem-flash-240-retry-waste-2026-02-20");
  });
});

// ---------------------------------------------------------------------------
// deduplicateAgainstExisting
// ---------------------------------------------------------------------------

describe("deduplicateAgainstExisting", () => {
  const existingTasks = `## Next actions

- [x] Implement burst mode as CLI extension [zero-resource]
  Why: From job-unification-analysis — enables rapid iteration
  Done when: CLI burst command exists
  Priority: low

- [ ] Add compound engineering metric to session metrics [zero-resource]
  Why: From ralph-loop-architecture-analysis — need to measure compound activity
  Done when: compoundActions field in SessionMetrics
  Priority: low
`;

  it("detects duplicate by source-id match in Why field", () => {
    const candidate: TaskCandidate = {
      line: "- [ ] Implement burst mode CLI",
      why: "From job-unification-analysis — burst mode for rapid iteration",
      doneWhen: "CLI burst command works",
      sourceId: "job-unification-analysis",
      tags: ["zero-resource"],
    };
    const isDup = deduplicateAgainstExisting(candidate, existingTasks);
    expect(isDup).toBe(true);
  });

  it("detects duplicate by keyword overlap", () => {
    const candidate: TaskCandidate = {
      line: "- [ ] Add compound engineering metric to session tracking",
      why: "From some-other-experiment — measure compound activity",
      doneWhen: "compoundActions field exists",
      sourceId: "some-other-experiment",
      tags: [],
    };
    const isDup = deduplicateAgainstExisting(candidate, existingTasks);
    expect(isDup).toBe(true);
  });

  it("does not flag unique tasks as duplicates", () => {
    const candidate: TaskCandidate = {
      line: "- [ ] Implement automatic experiment cost estimation",
      why: "From cost-analysis — predict API costs before running",
      doneWhen: "Cost estimate shown before experiment launch",
      sourceId: "cost-analysis",
      tags: [],
    };
    const isDup = deduplicateAgainstExisting(candidate, existingTasks);
    expect(isDup).toBe(false);
  });

  it("handles empty existing tasks", () => {
    const candidate: TaskCandidate = {
      line: "- [ ] Something new",
      why: "From exp-1 — description",
      doneWhen: "It works",
      sourceId: "exp-1",
      tags: [],
    };
    const isDup = deduplicateAgainstExisting(candidate, "## Next actions\n\n");
    expect(isDup).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractSourceId
// ---------------------------------------------------------------------------

describe("extractSourceId", () => {
  it("extracts experiment ID from EXPERIMENT.md path", () => {
    expect(extractSourceId("projects/youji/experiments/eval-v2/EXPERIMENT.md"))
      .toBe("eval-v2");
  });

  it("extracts diagnosis slug from diagnosis file path", () => {
    expect(extractSourceId("projects/youji/diagnosis/diagnosis-budget-gap-2026-02-17.md"))
      .toBe("diagnosis-budget-gap-2026-02-17");
  });

  it("extracts postmortem slug from postmortem file path", () => {
    expect(extractSourceId("projects/sample-project/postmortem/postmortem-retry-waste-2026-02-20.md"))
      .toBe("postmortem-retry-waste-2026-02-20");
  });

  it("extracts analysis slug from analysis file path", () => {
    expect(extractSourceId("projects/youji/analysis/task-discovery-workflow-gap-2026-02-22.md"))
      .toBe("task-discovery-workflow-gap-2026-02-22");
  });

  it("extracts feedback slug from feedback file path", () => {
    expect(extractSourceId("projects/youji/feedback/feedback-domain-knowledge-consolidation.md"))
      .toBe("feedback-domain-knowledge-consolidation");
  });

  it("handles Windows-style backslash paths", () => {
    expect(extractSourceId("projects\\youji\\experiments\\eval-v2\\EXPERIMENT.md"))
      .toBe("eval-v2");
  });

  it("handles bare filename without directory", () => {
    expect(extractSourceId("diagnosis-test.md")).toBe("diagnosis-test");
  });
});

// ---------------------------------------------------------------------------
// Diagnosis file content extraction
// ---------------------------------------------------------------------------

describe("extractRecommendationSections on diagnosis files", () => {
  it("extracts Recommendations section from a diagnosis file", () => {
    const content = `# Diagnosis: Feature Synthesis Only Triggered Once

Date: 2026-02-22

## Root Causes

### 1. Prompt architecture issue
The priming block is ambient, not structural.

## Recommendations

### R1: Add synthesis as a substep in the compound phase
Add a dedicated substep to the compound step.

### R2: Add a synthesis mention to CLAUDE.md
Add a brief section in CLAUDE.md.

## CI Layer Attribution

- L2 (Workflow): Primary.
`;
    const sections = extractRecommendationSections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.header).toBe("Recommendations");
    expect(sections[0]!.body).toContain("Add synthesis as a substep");
    expect(sections[0]!.body).toContain("Add a synthesis mention");
  });

  it("extracts Next steps from a diagnosis file", () => {
    const content = `# Diagnosis: Budget Discrepancy

Date: 2026-02-17

## Root Cause

Ledger recorded design estimates.

## Next steps

1. Fix the ledger entry.
2. Add consumption audit to run.py.
`;
    const sections = extractRecommendationSections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.header).toBe("Next steps");
  });
});

// ---------------------------------------------------------------------------
// Postmortem file content extraction
// ---------------------------------------------------------------------------

describe("extractRecommendationSections on postmortem files", () => {
  it("extracts Prevention section from a postmortem file", () => {
    const content = `# Postmortem: flash-240 retry logic caused resource waste

Date: 2026-02-20

## The flaw

The experiment consumed excess API calls.

## Root cause

Three L2 workflow deficiencies compounded.

## Prevention

### Existing convention missed

- Findings provenance: analyses reported metrics without verifying deduplication.

### New conventions needed

1. **Retry progress guard in experiment runner:** After each retry, compare unique evaluation count.
2. **Ledger records actual consumption:** Write or correct ledger after completion.
3. **Resume logic must preserve string types:** Specify dtype=str for ID columns.

## Severity

High — 34,254 wasted calls.
`;
    const sections = extractRecommendationSections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.header).toBe("Prevention");
    expect(sections[0]!.body).toContain("Retry progress guard");
    expect(sections[0]!.body).toContain("Ledger records actual consumption");
  });

  it("parses recommendations from postmortem Prevention with sub-sections", () => {
    const content = `### New conventions needed

1. **Add retry progress guard** to experiment runner.
2. **Fix ledger recording** to use actual consumption.
3. **Preserve string types** for ID columns in CSV loading.`;
    const recs = parseRecommendations(content, "postmortem-flash-240", "Prevention");
    expect(recs).toHaveLength(3);
    expect(recs[0]!.sourceId).toBe("postmortem-flash-240");
    expect(recs[0]!.text).toContain("Add retry progress guard");
  });
});

// ---------------------------------------------------------------------------
// End-to-end: diagnosis → parse → format
// ---------------------------------------------------------------------------

describe("end-to-end diagnosis recommendation pipeline", () => {
  it("extracts, parses, and formats a diagnosis recommendation as a task", () => {
    const diagnosisContent = `# Diagnosis: Experiment Infra Gap

Date: 2026-02-16

## Root Cause

Missing canary execution before full experiments.

## Recommendations

1. Add canary execution step to experiment runner before full launch.
2. Implement budget pre-check in experiment submission workflow.
`;
    const sections = extractRecommendationSections(diagnosisContent);
    expect(sections).toHaveLength(1);

    const sourceId = extractSourceId(
      "projects/youji/diagnosis/diagnosis-experiment-infra-gap-2026-02-16.md",
    );
    expect(sourceId).toBe("diagnosis-experiment-infra-gap-2026-02-16");

    const recs = parseRecommendations(sections[0]!.body, sourceId, sections[0]!.header);
    expect(recs).toHaveLength(2);

    const task = formatAsTask(recs[0]!);
    expect(task).not.toBeNull();
    expect(task!.why).toContain("From diagnosis-experiment-infra-gap-2026-02-16");
    expect(task!.sourceId).toBe("diagnosis-experiment-infra-gap-2026-02-16");
    expect(task!.line).toContain("Add canary execution step");
  });
});

// ---------------------------------------------------------------------------
// extractFindingsSection
// ---------------------------------------------------------------------------

describe("extractFindingsSection", () => {
  it("extracts a ## Findings section", () => {
    const content = `---
id: test-exp
status: completed
---

## Design

Some design text.

## Findings

1. The model achieved 85% accuracy.
2. Performance varied across categories.

## Reproducibility

Run the script.
`;
    const findings = extractFindingsSection(content);
    expect(findings).not.toBeNull();
    expect(findings).toContain("85% accuracy");
    expect(findings).toContain("Performance varied");
    expect(findings).not.toContain("Run the script");
  });

  it("returns null when no Findings section exists", () => {
    const content = `## Design\n\nSome text.\n\n## Reproducibility\n\nRun it.\n`;
    expect(extractFindingsSection(content)).toBeNull();
  });

  it("returns null for empty Findings section", () => {
    const content = `## Findings\n\n## Reproducibility\n\nRun it.\n`;
    expect(extractFindingsSection(content)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// splitFindings
// ---------------------------------------------------------------------------

describe("splitFindings", () => {
  it("splits numbered findings", () => {
    const body = `1. First finding about accuracy.
2. Second finding about latency.
3. Third finding about cost.`;
    const findings = splitFindings(body);
    expect(findings).toHaveLength(3);
    expect(findings[0]).toContain("First finding");
    expect(findings[2]).toContain("Third finding");
  });

  it("splits findings with continuation lines", () => {
    const body = `1. **Finding 1**: The accuracy was 85%.
   This is a continuation of finding 1.
2. **Finding 2**: The latency was 200ms.`;
    const findings = splitFindings(body);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toContain("continuation");
  });

  it("returns single finding for non-list content", () => {
    const body = `The experiment showed that accuracy was unexpectedly low.`;
    const findings = splitFindings(body);
    expect(findings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// detectImpliedTaskPatterns
// ---------------------------------------------------------------------------

describe("detectImpliedTaskPatterns", () => {
  it("detects failed success criterion (FAIL)", () => {
    const text = "Finding 3: Mesh quality accuracy was 45%, which is a FAIL against the 60% threshold.";
    const implied = detectImpliedTaskPatterns(text, "mesh-eval-v2");
    expect(implied.length).toBeGreaterThanOrEqual(1);
    expect(implied[0]!.pattern).toBe("failed-success-criterion");
    expect(implied[0]!.sourceId).toBe("mesh-eval-v2");
  });

  it("detects failed success criterion (does not meet)", () => {
    const text = "The result does not meet the pre-registered success criterion of α ≥ 0.6.";
    const implied = detectImpliedTaskPatterns(text, "alpha-test");
    expect(implied.some((i) => i.pattern === "failed-success-criterion")).toBe(true);
  });

  it("detects failed success criterion (below threshold)", () => {
    const text = "Cohen's kappa was 0.32, below threshold for acceptable agreement.";
    const implied = detectImpliedTaskPatterns(text, "kappa-test");
    expect(implied.some((i) => i.pattern === "failed-success-criterion")).toBe(true);
  });

  it("detects insufficient sample (N too small)", () => {
    const text = "With N too small (only 6 transcripts), we cannot generalize these results.";
    const implied = detectImpliedTaskPatterns(text, "transcript-eval");
    expect(implied.some((i) => i.pattern === "insufficient-sample")).toBe(true);
  });

  it("detects insufficient sample (N=2)", () => {
    const text = "Only N=2 sessions exhibited this pattern, so the finding is preliminary.";
    const implied = detectImpliedTaskPatterns(text, "pattern-study");
    expect(implied.some((i) => i.pattern === "insufficient-sample")).toBe(true);
  });

  it("detects insufficient sample (cannot draw conclusions)", () => {
    const text = "We cannot draw conclusions from such a limited dataset.";
    const implied = detectImpliedTaskPatterns(text, "small-study");
    expect(implied.some((i) => i.pattern === "insufficient-sample")).toBe(true);
  });

  it("detects identified confound", () => {
    const text = "There is a temporal confound: sessions that received treatment also ran later in the day.";
    const implied = detectImpliedTaskPatterns(text, "priming-phase3");
    expect(implied.some((i) => i.pattern === "identified-confound")).toBe(true);
  });

  it("detects identified confound (cannot separate)", () => {
    const text = "We cannot separate the effect of model version from the effect of prompt changes.";
    const implied = detectImpliedTaskPatterns(text, "model-comparison");
    expect(implied.some((i) => i.pattern === "identified-confound")).toBe(true);
  });

  it("detects partial confirmation", () => {
    const text = "Hypothesis partially confirmed: the priming effect is statistically significant (p=0.013) but smaller than the pre-registered 0.5-point threshold.";
    const implied = detectImpliedTaskPatterns(text, "priming-phase3");
    expect(implied.some((i) => i.pattern === "partial-confirmation")).toBe(true);
  });

  it("detects partial confirmation (effect exists but)", () => {
    const text = "The effect exists but is too small to be practically significant.";
    const implied = detectImpliedTaskPatterns(text, "small-effect");
    expect(implied.some((i) => i.pattern === "partial-confirmation")).toBe(true);
  });

  it("detects unexplained result", () => {
    const text = "The mechanism is unclear: why does adding wireframe views reduce accuracy for some categories?";
    const implied = detectImpliedTaskPatterns(text, "wireframe-eval");
    expect(implied.some((i) => i.pattern === "unexplained-result")).toBe(true);
  });

  it("detects unexplained result (contrary to)", () => {
    const text = "Contrary to expectations, the larger model performed worse on mesh quality tasks.";
    const implied = detectImpliedTaskPatterns(text, "model-size");
    expect(implied.some((i) => i.pattern === "unexplained-result")).toBe(true);
  });

  it("detects unexplained result (unexpected)", () => {
    const text = "An unexpected drop in accuracy occurred after the protocol change.";
    const implied = detectImpliedTaskPatterns(text, "protocol-change");
    expect(implied.some((i) => i.pattern === "unexplained-result")).toBe(true);
  });

  it("detects multi-phase plan", () => {
    const text = "Phase 1 is complete. Phase 2 will extend the evaluation to 500 sessions. Phase 3 will validate with human raters.";
    const implied = detectImpliedTaskPatterns(text, "multi-phase-exp");
    expect(implied.some((i) => i.pattern === "multi-phase-plan")).toBe(true);
  });

  it("returns empty array for findings without implied tasks", () => {
    const text = "The accuracy was 92%, exceeding the 80% threshold. All success criteria met.";
    const implied = detectImpliedTaskPatterns(text, "good-exp");
    expect(implied).toHaveLength(0);
  });

  it("detects multiple patterns in a single finding", () => {
    const text = "The hypothesis was partially confirmed but the mechanism is unclear and there is a temporal confound.";
    const implied = detectImpliedTaskPatterns(text, "complex-exp");
    expect(implied.length).toBeGreaterThanOrEqual(2);
    const patterns = implied.map((i) => i.pattern);
    expect(patterns).toContain("partial-confirmation");
    expect(patterns).toContain("identified-confound");
    expect(patterns).toContain("unexplained-result");
  });

  it("truncates findingText to 200 chars", () => {
    const text = "A".repeat(300) + " FAIL";
    const implied = detectImpliedTaskPatterns(text, "long-exp");
    expect(implied.length).toBeGreaterThanOrEqual(1);
    expect(implied[0]!.findingText.length).toBeLessThanOrEqual(200);
  });
});

// ---------------------------------------------------------------------------
// extractImpliedTasks (integration)
// ---------------------------------------------------------------------------

describe("extractImpliedTasks", () => {
  it("extracts implied tasks from a complete EXPERIMENT.md", () => {
    const content = `---
id: creative-context-injection
status: completed
date: 2026-02-22
project: youji
consumes_resources: true
---

## Design

Test whether context priming affects creative scores.

## Findings

1. Hypothesis partially confirmed: priming effect is statistically significant (p=0.013, d=0.38) but smaller than pre-registered 0.5-point threshold.
2. Context document exceeded all growth targets (742 words, 11 themes).
3. The mechanism is unclear: why do primed sessions show more creative variance?
4. With N=2 sessions showing score 4+, we cannot draw conclusions about the high end.

## Reproducibility

Run phase3-analysis.py.
`;
    const implied = extractImpliedTasks(content, "creative-context-injection");
    expect(implied.length).toBeGreaterThanOrEqual(3);

    const patterns = implied.map((i) => i.pattern);
    expect(patterns).toContain("partial-confirmation");
    expect(patterns).toContain("unexplained-result");
    expect(patterns).toContain("insufficient-sample");
  });

  it("returns empty array when no Findings section exists", () => {
    const content = `---
id: no-findings
status: planned
---

## Design

Will test something.
`;
    const implied = extractImpliedTasks(content, "no-findings");
    expect(implied).toHaveLength(0);
  });

  it("returns empty array when findings have no implied tasks", () => {
    const content = `---
id: clean-exp
status: completed
---

## Findings

1. All success criteria met. Accuracy was 95%.
2. Performance was consistent across categories.
`;
    const implied = extractImpliedTasks(content, "clean-exp");
    expect(implied).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// detectPhases
// ---------------------------------------------------------------------------

describe("detectPhases", () => {
  it("detects phase numbers from content", () => {
    const content = `Phase 1 is complete. Phase 2 will extend the scope. Phase 3 validates.`;
    const phases = detectPhases(content);
    expect(phases).toEqual([1, 2, 3]);
  });

  it("deduplicates repeated phase mentions", () => {
    const content = `Phase 1 started. Phase 1 is done. Phase 2 next.`;
    const phases = detectPhases(content);
    expect(phases).toEqual([1, 2]);
  });

  it("returns empty array for content without phases", () => {
    const content = `The experiment ran for 3 hours and produced 100 results.`;
    const phases = detectPhases(content);
    expect(phases).toHaveLength(0);
  });

  it("is case-insensitive", () => {
    const content = `phase 1 and PHASE 2 and Phase 3.`;
    const phases = detectPhases(content);
    expect(phases).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// formatImpliedTaskAsCandidate
// ---------------------------------------------------------------------------

describe("formatImpliedTaskAsCandidate", () => {
  it("formats a failed-success-criterion implied task", () => {
    const candidate = formatImpliedTaskAsCandidate({
      pattern: "failed-success-criterion",
      findingText: "Accuracy was 45%, a FAIL against the 60% threshold.",
      sourceId: "mesh-eval-v2",
      suggestedTaskType: "Refined experiment or protocol redesign",
    });
    expect(candidate.line).toContain("Investigate failed success criterion");
    expect(candidate.why).toContain("From mesh-eval-v2");
    expect(candidate.tags).toContain("zero-resource");
    expect(candidate.sourceId).toBe("mesh-eval-v2");
  });

  it("formats an insufficient-sample implied task", () => {
    const candidate = formatImpliedTaskAsCandidate({
      pattern: "insufficient-sample",
      findingText: "N too small to generalize.",
      sourceId: "small-study",
      suggestedTaskType: "Larger-scale replication",
    });
    expect(candidate.line).toContain("larger-scale replication");
    expect(candidate.doneWhen).toContain("Larger-scale replication");
  });

  it("truncates long finding text in why field", () => {
    const longText = "A".repeat(100);
    const candidate = formatImpliedTaskAsCandidate({
      pattern: "unexplained-result",
      findingText: longText,
      sourceId: "long-exp",
      suggestedTaskType: "Investigation or diagnosis",
    });
    expect(candidate.why.length).toBeLessThan(200);
  });
});
