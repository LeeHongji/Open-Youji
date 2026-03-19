/**
 * Standalone provenance scanner for EXPERIMENT.md files.
 *
 * Scans all completed experiments in the repo for findings with numerical claims
 * that lack provenance markers. Reuses the checkFindingsProvenance logic from verify.ts.
 *
 * Usage:
 *   npx tsx src/scan-provenance.ts [--project <name>] [--json]
 *
 * Output:
 *   Lists experiments with provenance violations, grouped by project.
 *   Exit code 0 if no violations, 1 if violations found.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { checkFindingsProvenance } from "./verify.js";

export interface ProvenanceScanResult {
  project: string;
  experiment: string;
  filePath: string;
  violations: string[];
}

export interface ScanOptions {
  /** Filter to a single project. */
  project?: string;
}

/**
 * Scan all completed EXPERIMENT.md files for provenance violations.
 *
 * @param cwd - Repository root directory
 * @param options - Optional filters
 * @returns Array of experiments with violations (empty if all clean)
 */
export async function scanAllExperiments(
  cwd: string,
  options: ScanOptions = {},
): Promise<ProvenanceScanResult[]> {
  const results: ProvenanceScanResult[] = [];
  const projectsDir = join(cwd, "projects");

  let projects: string[];
  try {
    const entries = await readdir(projectsDir);
    projects = options.project ? entries.filter((e) => e === options.project) : entries;
  } catch {
    return results;
  }

  for (const project of projects) {
    const experimentsDir = join(projectsDir, project, "experiments");
    let experiments: string[];
    try {
      experiments = await readdir(experimentsDir);
    } catch {
      continue;
    }

    for (const experiment of experiments) {
      const filePath = join(experimentsDir, experiment, "EXPERIMENT.md");
      try {
        const s = await stat(filePath);
        if (!s.isFile()) continue;
      } catch {
        continue;
      }

      try {
        const content = await readFile(filePath, "utf-8");
        const violations = checkFindingsProvenance(content);
        if (violations.length > 0) {
          const relPath = `projects/${project}/experiments/${experiment}/EXPERIMENT.md`;
          results.push({ project, experiment, filePath: relPath, violations });
        }
      } catch {
        continue;
      }
    }
  }

  return results;
}

// ── CLI entry point ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options: ScanOptions = {};
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--project" && args[i + 1]) {
      options.project = args[++i];
    } else if (args[i] === "--json") {
      jsonOutput = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log("Usage: npx tsx src/scan-provenance.ts [--project <name>] [--json]");
      console.log("");
      console.log("Scans all completed EXPERIMENT.md files for findings");
      console.log("with numerical claims that lack provenance markers.");
      process.exit(0);
    }
  }

  const cwd = process.cwd();
  const results = await scanAllExperiments(cwd, options);

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    if (results.length === 0) {
      console.log("✓ No provenance violations found.");
    } else {
      console.log(`Found provenance violations in ${results.length} experiment(s):\n`);
      const byProject = new Map<string, ProvenanceScanResult[]>();
      for (const r of results) {
        const list = byProject.get(r.project) || [];
        list.push(r);
        byProject.set(r.project, list);
      }
      for (const [project, exps] of byProject) {
        console.log(`  ${project}/`);
        for (const exp of exps) {
          console.log(`    ${exp.experiment} (${exp.violations.length} violation(s))`);
          for (const v of exp.violations) {
            console.log(`      - ${v}`);
          }
        }
      }
      console.log(`\nTotal: ${results.reduce((s, r) => s + r.violations.length, 0)} violation(s) in ${results.length} experiment(s).`);
    }
  }

  process.exit(results.length > 0 ? 1 : 0);
}

// Only run CLI when executed directly (not imported)
const isMain = process.argv[1]?.endsWith("scan-provenance.ts") ||
  process.argv[1]?.endsWith("scan-provenance.js");
if (isMain) {
  main().catch((err) => {
    console.error("Error:", err);
    process.exit(2);
  });
}
