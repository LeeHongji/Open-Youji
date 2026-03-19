/** Tests for experiment-related verification functions in verify.ts. */

import { describe, it, expect } from "vitest";
import { parseExperimentFrontmatter, hasConsumesResourcesWaiver, checkConsumesResources, getExperimentStatus, checkModelBackendProvenance, checkFindingsProvenance } from "./verify.js";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("parseExperimentFrontmatter", () => {
  it("parses YAML frontmatter from EXPERIMENT.md content", () => {
    const content = `---
id: test-experiment
type: experiment
status: completed
date: 2026-02-26
project: youji
consumes_resources: true
---
# Test Experiment

Some content here.`;
    const fields = parseExperimentFrontmatter(content);
    expect(fields).not.toBeNull();
    expect(fields!.get("id")).toBe("test-experiment");
    expect(fields!.get("type")).toBe("experiment");
    expect(fields!.get("status")).toBe("completed");
    expect(fields!.get("consumes_resources")).toBe("true");
  });

  it("returns null for content without frontmatter", () => {
    const content = `# Test Experiment

No frontmatter here.`;
    expect(parseExperimentFrontmatter(content)).toBeNull();
  });

  it("returns null for malformed frontmatter (no closing ---)", () => {
    const content = `---
id: test
status: running

Missing closing delimiter.`;
    expect(parseExperimentFrontmatter(content)).toBeNull();
  });

  it("handles values with colons", () => {
    const content = `---
id: test
date: 2026-02-26T12:00:00Z
detail: some: complex: value
---`;
    const fields = parseExperimentFrontmatter(content);
    expect(fields!.get("detail")).toBe("some: complex: value");
  });

  it("handles empty frontmatter", () => {
    const content = `---
---`;
    const fields = parseExperimentFrontmatter(content);
    expect(fields).not.toBeNull();
    expect(fields!.size).toBe(0);
  });

  it("handles values with spaces", () => {
    const content = `---
id: test
description: This is a long description
---`;
    const fields = parseExperimentFrontmatter(content);
    expect(fields!.get("description")).toBe("This is a long description");
  });
});

describe("hasConsumesResourcesWaiver", () => {
  it("detects standard waiver comment", () => {
    const content = `---
id: test-exp
consumes_resources: true
---
## Design
Test.
<!-- consumes-resources-waiver: API calls are <10 and complete in seconds -->
`;
    expect(hasConsumesResourcesWaiver(content)).toBe(true);
  });

  it("detects waiver with extra whitespace", () => {
    const content = `---
id: test-exp
consumes_resources: true
---
<!--  consumes-resources-waiver:  reason here  -->
`;
    expect(hasConsumesResourcesWaiver(content)).toBe(true);
  });

  it("returns false for content without waiver", () => {
    const content = `---
id: test-exp
consumes_resources: true
---
## Design
No waiver here.
`;
    expect(hasConsumesResourcesWaiver(content)).toBe(false);
  });

  it("returns false for empty reason", () => {
    const content = `<!-- consumes-resources-waiver: -->`;
    expect(hasConsumesResourcesWaiver(content)).toBe(false);
  });

  it("returns false for empty content", () => {
    expect(hasConsumesResourcesWaiver("")).toBe(false);
  });

  it("returns false for regular HTML comments", () => {
    const content = `<!-- This is a regular comment -->
<!-- Recommendations surfaced: 2026-02-27 -->`;
    expect(hasConsumesResourcesWaiver(content)).toBe(false);
  });

  it("detects waiver anywhere in content", () => {
    const content = `---
id: test-exp
status: completed
consumes_resources: true
---
## Design
Hypothesis: test

## Config
Some config.

## Results
Some results.

## Findings
1. A finding.

<!-- consumes-resources-waiver: Single API call completes in <5 seconds, not suitable for detach -->
`;
    expect(hasConsumesResourcesWaiver(content)).toBe(true);
  });
});

describe("checkConsumesResources", () => {
  it("returns true for EXPERIMENT.md with consumes_resources: true", async () => {
    const content = `---
id: test-exp
status: running
consumes_resources: true
---
## Design
Test experiment.
`;
    const tmpDir = await mkdtemp(join(tmpdir(), "ledger-test-"));
    const expPath = join(tmpDir, "EXPERIMENT.md");
    await writeFile(expPath, content);
    const result = await checkConsumesResources(tmpDir, "EXPERIMENT.md");
    expect(result).toBe(true);
    await rm(tmpDir, { recursive: true });
  });

  it("returns false for EXPERIMENT.md with consumes_resources: false", async () => {
    const content = `---
id: test-exp
status: running
consumes_resources: false
---
## Design
Test experiment.
`;
    const tmpDir = await mkdtemp(join(tmpdir(), "ledger-test-"));
    const expPath = join(tmpDir, "EXPERIMENT.md");
    await writeFile(expPath, content);
    const result = await checkConsumesResources(tmpDir, "EXPERIMENT.md");
    expect(result).toBe(false);
    await rm(tmpDir, { recursive: true });
  });

  it("returns false for EXPERIMENT.md without consumes_resources field", async () => {
    const content = `---
id: test-exp
status: running
---
## Design
Test experiment.
`;
    const tmpDir = await mkdtemp(join(tmpdir(), "ledger-test-"));
    const expPath = join(tmpDir, "EXPERIMENT.md");
    await writeFile(expPath, content);
    const result = await checkConsumesResources(tmpDir, "EXPERIMENT.md");
    expect(result).toBe(false);
    await rm(tmpDir, { recursive: true });
  });

  it("returns false for non-existent file", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "ledger-test-"));
    const result = await checkConsumesResources(tmpDir, "EXPERIMENT.md");
    expect(result).toBe(false);
    await rm(tmpDir, { recursive: true });
  });
});

describe("getExperimentStatus", () => {
  it("returns status from EXPERIMENT.md frontmatter", async () => {
    const content = `---
id: test-exp
status: running
consumes_resources: true
---
## Design
Test experiment.
`;
    const tmpDir = await mkdtemp(join(tmpdir(), "status-test-"));
    const expPath = join(tmpDir, "EXPERIMENT.md");
    await writeFile(expPath, content);
    const result = await getExperimentStatus(tmpDir, "EXPERIMENT.md");
    expect(result).toBe("running");
    await rm(tmpDir, { recursive: true });
  });

  it("returns null for EXPERIMENT.md without status field", async () => {
    const content = `---
id: test-exp
consumes_resources: true
---
## Design
Test experiment.
`;
    const tmpDir = await mkdtemp(join(tmpdir(), "status-test-"));
    const expPath = join(tmpDir, "EXPERIMENT.md");
    await writeFile(expPath, content);
    const result = await getExperimentStatus(tmpDir, "EXPERIMENT.md");
    expect(result).toBe(null);
    await rm(tmpDir, { recursive: true });
  });

  it("returns null for non-existent file", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "status-test-"));
    const result = await getExperimentStatus(tmpDir, "EXPERIMENT.md");
    expect(result).toBe(null);
    await rm(tmpDir, { recursive: true });
  });

  it("returns completed status", async () => {
    const content = `---
id: test-exp
status: completed
---
## Design
Test experiment.
`;
    const tmpDir = await mkdtemp(join(tmpdir(), "status-test-"));
    const expPath = join(tmpDir, "EXPERIMENT.md");
    await writeFile(expPath, content);
    const result = await getExperimentStatus(tmpDir, "EXPERIMENT.md");
    expect(result).toBe("completed");
    await rm(tmpDir, { recursive: true });
  });

  it("returns planned status", async () => {
    const content = `---
id: test-exp
status: planned
---
## Design
Test experiment.
`;
    const tmpDir = await mkdtemp(join(tmpdir(), "status-test-"));
    const expPath = join(tmpDir, "EXPERIMENT.md");
    await writeFile(expPath, content);
    const result = await getExperimentStatus(tmpDir, "EXPERIMENT.md");
    expect(result).toBe("planned");
    await rm(tmpDir, { recursive: true });
  });
});

describe("checkModelBackendProvenance", () => {
  it("returns missing fields for completed resource-consuming record without model/backend", () => {
    const content = `---
id: test-exp
status: completed
date: 2026-02-27
project: test
consumes_resources: true
---
## Config
Some config without Model: line.
`;
    const result = checkModelBackendProvenance(content);
    expect(result).not.toBeNull();
    expect(result!.missingModel).toBe(true);
    expect(result!.missingBackend).toBe(true);
    expect(result!.missingModelLine).toBe(true);
  });

  it("returns no missing fields when model and backend present in frontmatter and body", () => {
    const content = `---
id: test-exp
status: completed
date: 2026-02-27
project: test
consumes_resources: true
model: gemini-3-flash
backend: cf-gateway
---
## Config
Model: gemini-3-flash via CF Gateway (selected per Model Selection Guide)
`;
    const result = checkModelBackendProvenance(content);
    expect(result).not.toBeNull();
    expect(result!.missingModel).toBe(false);
    expect(result!.missingBackend).toBe(false);
    expect(result!.missingModelLine).toBe(false);
  });

  it("returns null for planned experiments (no check needed)", () => {
    const content = `---
id: test-exp
status: planned
consumes_resources: true
---
## Design
Test.
`;
    const result = checkModelBackendProvenance(content);
    expect(result).toBeNull();
  });

  it("returns null for non-resource-consuming records", () => {
    const content = `---
id: test-exp
status: completed
consumes_resources: false
---
## Question
Test.
`;
    const result = checkModelBackendProvenance(content);
    expect(result).toBeNull();
  });

  it("detects Model: line in Method section", () => {
    const content = `---
id: test-exp
status: completed
consumes_resources: true
model: claude-opus-4.6
backend: claude-sdk
---
## Method
Model: claude-opus-4.6 via claude-sdk
Analysis details.
`;
    const result = checkModelBackendProvenance(content);
    expect(result).not.toBeNull();
    expect(result!.missingModelLine).toBe(false);
  });

  it("returns null for content without frontmatter", () => {
    const content = `# Just a regular file
No frontmatter here.
`;
    const result = checkModelBackendProvenance(content);
    expect(result).toBeNull();
  });
});

describe("checkFindingsProvenance", () => {
  it("returns empty for non-completed experiments", () => {
    const content = `---
id: test-exp
status: running
date: 2026-03-01
project: test
consumes_resources: true
---

## Findings

1. Model scored 72.5% accuracy.
`;
    expect(checkFindingsProvenance(content)).toEqual([]);
  });

  it("returns empty when no Findings section exists", () => {
    const content = `---
id: test-exp
status: completed
date: 2026-03-01
project: test
consumes_resources: true
---

## Design

Some design info.
`;
    expect(checkFindingsProvenance(content)).toEqual([]);
  });

  it("returns empty for findings with no numerical claims", () => {
    const content = `---
id: test-exp
status: completed
date: 2026-03-01
project: test
consumes_resources: false
---

## Findings

1. The pipeline works correctly and produces valid output.

2. All images were processed without errors.
`;
    expect(checkFindingsProvenance(content)).toEqual([]);
  });

  it("detects finding with percentage but no provenance", () => {
    const content = `---
id: test-exp
status: completed
date: 2026-03-01
project: test
consumes_resources: true
---

## Findings

1. Model achieved 72.5% accuracy on the test set, exceeding the baseline.
`;
    const violations = checkFindingsProvenance(content);
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain("Finding 1");
  });

  it("accepts finding with inline Provenance marker", () => {
    const content = `---
id: test-exp
status: completed
date: 2026-03-01
project: test
consumes_resources: true
---

## Findings

1. Model achieved 72.5% accuracy on the test set.
Provenance: \`analysis/evaluate.py\` → \`results/scores.csv\`
`;
    expect(checkFindingsProvenance(content)).toEqual([]);
  });

  it("accepts finding with arithmetic derivation", () => {
    const content = `---
id: test-exp
status: completed
date: 2026-03-01
project: test
consumes_resources: true
---

## Findings

1. Success rate was 39.7% (96/242 = 39.7%).
`;
    expect(checkFindingsProvenance(content)).toEqual([]);
  });

  it("accepts finding with script file reference", () => {
    const content = `---
id: test-exp
status: completed
date: 2026-03-01
project: test
consumes_resources: true
---

## Findings

1. Model accuracy is 85.3%. See \`analysis/compute_accuracy.py\` for computation.
`;
    expect(checkFindingsProvenance(content)).toEqual([]);
  });

  it("accepts finding with data file reference", () => {
    const content = `---
id: test-exp
status: completed
date: 2026-03-01
project: test
consumes_resources: true
---

## Findings

1. Mean score was 4.29 across all dimensions. Computed from results/scores.csv.
`;
    expect(checkFindingsProvenance(content)).toEqual([]);
  });

  it("detects multiple findings without provenance", () => {
    const content = `---
id: test-exp
status: completed
date: 2026-03-01
project: test
consumes_resources: true
---

## Findings

1. Accuracy was 72.5% overall.

2. The tie rate is 65.5%, dominating results.

3. Pipeline works correctly. All outputs are valid.
`;
    const violations = checkFindingsProvenance(content);
    expect(violations.length).toBe(2);
    expect(violations[0]).toContain("Finding 1");
    expect(violations[1]).toContain("Finding 2");
  });

  it("handles bold finding headers like **F1:**", () => {
    const content = `---
id: test-exp
status: completed
date: 2026-03-01
project: test
consumes_resources: true
---

## Findings

**F1: Model achieved 72.5% accuracy with no improvement.**
This is a significant result that challenges prior assumptions.
`;
    const violations = checkFindingsProvenance(content);
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain("Finding 1");
  });

  it("accepts bold finding with provenance on subsequent line", () => {
    const content = `---
id: test-exp
status: completed
date: 2026-03-01
project: test
consumes_resources: true
---

## Findings

**F1: Model achieved 72.5% accuracy.**
Provenance: \`analysis/evaluate.py --scores results/scores.csv\`
`;
    expect(checkFindingsProvenance(content)).toEqual([]);
  });

  it("stops at next section heading", () => {
    const content = `---
id: test-exp
status: completed
date: 2026-03-01
project: test
consumes_resources: true
---

## Findings

1. Accuracy was 72.5%. See \`results/data.csv\`.

## Reproducibility

Run \`python evaluate.py\` to reproduce.
`;
    expect(checkFindingsProvenance(content)).toEqual([]);
  });

  it("accepts finding with backtick-quoted path containing slash", () => {
    const content = `---
id: test-exp
status: completed
date: 2026-03-01
project: test
consumes_resources: true
---

## Findings

1. Overall score was 4.29 across 217 assets. Data from \`experiments/baseline/results/\`.
`;
    expect(checkFindingsProvenance(content)).toEqual([]);
  });

  it("returns empty for content without frontmatter", () => {
    const content = `# Some file

## Findings

1. Score was 72.5% with no provenance.
`;
    expect(checkFindingsProvenance(content)).toEqual([]);
  });
});
