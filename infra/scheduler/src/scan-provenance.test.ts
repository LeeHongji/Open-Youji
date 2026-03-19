/** Tests for standalone provenance scanner CLI tool. */

import { describe, it, expect } from "vitest";
import { scanAllExperiments, type ProvenanceScanResult } from "./scan-provenance.js";
import { mkdtemp, writeFile, rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Helper to create a minimal experiment directory with an EXPERIMENT.md file.
 */
async function createExperiment(
  baseDir: string,
  project: string,
  experiment: string,
  content: string,
): Promise<void> {
  const dir = join(baseDir, "projects", project, "experiments", experiment);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "EXPERIMENT.md"), content);
}

describe("scanAllExperiments", () => {
  it("finds violations in completed experiments with numerical claims lacking provenance", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "prov-scan-"));
    try {
      await createExperiment(tmpDir, "test-project", "bad-exp", `---
id: bad-exp
status: completed
date: 2026-03-01
project: test-project
consumes_resources: true
---

## Findings

1. Model achieved 72.5% accuracy on the test set.

2. The tie rate was 65.3%, which is surprisingly high.
`);
      const results = await scanAllExperiments(tmpDir);
      expect(results.length).toBe(1);
      expect(results[0].project).toBe("test-project");
      expect(results[0].experiment).toBe("bad-exp");
      expect(results[0].violations.length).toBe(2);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it("returns empty for experiments with proper provenance", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "prov-scan-"));
    try {
      await createExperiment(tmpDir, "test-project", "good-exp", `---
id: good-exp
status: completed
date: 2026-03-01
project: test-project
consumes_resources: false
---

## Findings

1. Success rate was 39.7% (96/242 = 39.7%).

2. Model scored 85.3%. See \`analysis/compute_accuracy.py\` for computation.
`);
      const results = await scanAllExperiments(tmpDir);
      expect(results.length).toBe(0);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it("skips non-completed experiments", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "prov-scan-"));
    try {
      await createExperiment(tmpDir, "test-project", "running-exp", `---
id: running-exp
status: running
date: 2026-03-01
project: test-project
consumes_resources: true
---

## Findings

1. Model achieved 72.5% accuracy.
`);
      const results = await scanAllExperiments(tmpDir);
      expect(results.length).toBe(0);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it("scans multiple projects and experiments", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "prov-scan-"));
    try {
      await createExperiment(tmpDir, "project-a", "exp-1", `---
id: exp-1
status: completed
date: 2026-03-01
project: project-a
consumes_resources: true
---

## Findings

1. Accuracy was 90.1%. Provenance: \`results/scores.csv\`
`);
      await createExperiment(tmpDir, "project-b", "exp-2", `---
id: exp-2
status: completed
date: 2026-03-01
project: project-b
consumes_resources: true
---

## Findings

1. Score was 4.29 with no source cited.
`);
      await createExperiment(tmpDir, "project-b", "exp-3", `---
id: exp-3
status: completed
date: 2026-03-01
project: project-b
consumes_resources: false
---

## Findings

1. Pipeline completed with 100% success. Computed from results/log.json.
`);
      const results = await scanAllExperiments(tmpDir);
      expect(results.length).toBe(1);
      expect(results[0].project).toBe("project-b");
      expect(results[0].experiment).toBe("exp-2");
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it("handles projects directory not existing", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "prov-scan-"));
    try {
      const results = await scanAllExperiments(tmpDir);
      expect(results.length).toBe(0);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it("handles experiment without Findings section", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "prov-scan-"));
    try {
      await createExperiment(tmpDir, "test-project", "no-findings", `---
id: no-findings
status: completed
date: 2026-03-01
project: test-project
consumes_resources: true
---

## Design

Some design notes.

## Results

Some results.
`);
      const results = await scanAllExperiments(tmpDir);
      expect(results.length).toBe(0);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it("filters by project when specified", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "prov-scan-"));
    try {
      await createExperiment(tmpDir, "project-a", "exp-1", `---
id: exp-1
status: completed
date: 2026-03-01
project: project-a
consumes_resources: true
---

## Findings

1. Score was 72.5% on the benchmark, exceeding our target.
`);
      await createExperiment(tmpDir, "project-b", "exp-2", `---
id: exp-2
status: completed
date: 2026-03-01
project: project-b
consumes_resources: true
---

## Findings

1. Accuracy was 85.3% on the evaluation set.
`);
      const results = await scanAllExperiments(tmpDir, { project: "project-a" });
      expect(results.length).toBe(1);
      expect(results[0].project).toBe("project-a");
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });
});
