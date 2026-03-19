# 0039: Production Code Discovery

Date: 2026-02-26
Status: accepted

## Context

Agents repeatedly struggle to find the correct production code paths when working across projects. Specific incidents:

1. **Generation pipeline mismatch** (postmortem-eval-config-mismatch-production-2026-02-25.md): Agent used `modules/<webapp>/batch_eval/pipeline.py` instead of the production path `modules/<serving>/src/generate.py`. Three files with the same name existed; agent anchored on the wrong one.

2. **User image access mismatch** (first attempt at this ADR, reverted in efb9dc7): ADR documented `_download_image()` from `modules/<serving>/gradio/utils.py` as the user image access pattern, but actual project code uses Databricks SQL + `aws s3 cp` (via data collection scripts). The ADR itself demonstrated the root cause it was trying to fix — even the agent writing the discovery docs used the wrong paths.

3. **Dependency search incomplete** (diagnosis-dependency-search-incomplete-2026-02-26.md): Agent relied on architecture overview docs instead of ground-truth `pyproject.toml` files, missing package-level dependencies.

Root cause: agents anchor on files that "look authoritative" (batch scripts, architecture docs, helper functions in serving code) without verifying against actual working implementations. Two failure modes:
- **Attractive nuisances**: Files that look official but don't match production (e.g., `batch_eval/pipeline.py`)
- **Plausible but unused paths**: Code that exists and works but isn't what projects actually use (e.g., helper functions in serving code vs. the actual data access pattern)

This is particularly acute for smaller models like GLM-5 which may not reliably follow L2 conventions.

## Decision

1. **Production entry point documentation**: Projects that interact with production code must maintain a `production-code.md` file in their project directory documenting:
   - Exact file paths to production entry points (not batch scripts, not test utilities)
   - Pipeline architecture (which code path is actually deployed)
   - Common pitfalls (files that look authoritative but aren't)
   - For user data access: the actual pattern used by youji project scripts, verified against existing implementations

2. **Full path provenance**: When referencing production code in experiment designs, documentation, or task descriptions, use full file paths including the exact function/class:
   - Bad: "from `pipeline.py`" (ambiguous — multiple files match)
   - Good: "from `modules/<your-service>/src/generate.py:GenerationConfig.get_512_config()`"

3. **Verification against working code**: Before documenting a production code path in `production-code.md`, verify it against an existing working implementation in the project. Check:
   - Does any actual project script use this path? (grep for imports/references)
   - If no existing script uses it, is the path from production deployment or from a helper/batch script?
   - Cross-reference credentials: does the documented path use credentials that are actually configured in `infra/.env`?

4. **"DO NOT USE" sections**: `production-code.md` files MUST include a `## DO NOT USE` (or `### DO NOT USE`) section listing known attractive nuisances:
   - Files that exist and look authoritative but are not used in production
   - Deprecated or legacy code paths
   - Batch scripts with different defaults than production
   
   Format:
   ```markdown
   ## DO NOT USE (Non-Production Paths)
   
   | File | Why it's wrong |
   |------|----------------|
   | `modules/<example-webapp>/batch_eval/pipeline.py` | Legacy Draft endpoint defaults, bare generation actor that doesn't exist in production |
   ```

5. **L1 code enforcement**: A validator in `infra/experiment-validator/validate.py` checks `production-code.md` files:
   - Paths must exist in the repo (error if not)
   - Paths must be referenced in at least one project script (warning if not)
   - Paths in "DO NOT USE" sections are exempt from usage verification
   - Runs as part of `pixi run validate`

6. **/design skill verification step**: Before anchoring on any production code path, the /design skill requires:
   - Reading `production-code.md` first if it exists
   - Verifying path existence with `ls -la` or equivalent
   - Verifying usage in project scripts with `rg "<path>" projects/<project>/`
   - Never anchoring on batch scripts, deprecated files, or test utilities

## Consequences

- New convention for projects working with production modules
- Existing downstream projects have `production-code.md` files
- Reduces risk of experiment config mismatches with production
- Adds documentation burden, but pays off in reduced investigation time and fewer invalid experiments
- The verification step prevents the recursive failure where discovery docs themselves contain wrong paths
- L1 enforcement catches missing usage at commit time, protecting smaller models that may miss L2 conventions
