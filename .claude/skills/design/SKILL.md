---
name: design
description: "Use when designing a new experiment or research protocol and need to ensure methodological rigor"
complexity: opus-only
model-minimum: opus
disable-model-invocation: false
allowed-tools: ["Read", "Grep", "Glob", "WebSearch"]
---

# /design <research question or project path>

You are designing a rigorous empirical study. Your job is to turn a research question into a concrete experiment design that follows the experiment-design schema in CLAUDE.md — but with the methodological judgment to fill it well, not just structurally.

The argument is a research question, an open question from a project, or a project path. If a project path, read the README to find the relevant open questions and existing results.

## Step 0: Knowledge framing

Before any design work:
- What knowledge does this experiment/change produce?
- If this is an infrastructure change: it is an experiment on the system itself.
  The knowledge output is "does this design pattern work?" Findings are about
  the system's behavior, not about code correctness.
- State the knowledge output explicitly before proceeding.

## Step 1: Understand the question

- Read relevant project READMEs, logs, and existing results.
- Identify which CI layers are involved. State them explicitly.
- Check `decisions/` for prior methodological choices that constrain the design.
- Check existing results — are there baselines, pilot data, or error analyses that inform the design?

## Step 2: Formulate the hypothesis

Write a falsifiable hypothesis. A good hypothesis:
- Makes a specific, directional prediction ("Rubric prompts will increase agreement by >5pp" not "Rubric prompts might help")
- Is grounded in prior evidence or reasoning (cite the evidence)
- Can be refuted by an achievable experiment

If the question is exploratory (no clear prediction possible), say so explicitly and frame it as a measurement study with defined quantities of interest rather than forcing a hypothesis.

## Step 3: Choose variables and metrics

**Independent variables:** What are you varying? Justify why these variables and not others. Name alternatives you considered and why you rejected them.

**Dependent variables / metrics:** What are you measuring? For each metric:
- What does it capture? (agreement, accuracy, ranking consistency, etc.)
- What are its assumptions? (e.g., Cohen's kappa assumes nominal categories; Kendall's tau assumes ordinal ranking; Pearson's r assumes interval scale and linearity)
- What are its failure modes? (e.g., kappa is sensitive to prevalence; accuracy ignores ties)
- Why this metric over alternatives?

If multiple metrics are plausible, recommend a primary metric and state why, then list secondary metrics.

**Controlled variables:** What must be held fixed for the comparison to be valid? Be specific — "same dataset" is insufficient; specify which subset, what preprocessing, what exclusion criteria.

## Step 4: Design the method

Write a step-by-step procedure. For each step:
- Reference specific infra tools, scripts, or commands where they exist
- Specify exact parameters (model names, prompt versions, number of runs, thresholds)
- Identify where randomization or counterbalancing is needed

**Production code path verification** (MANDATORY before anchoring on any production path):
Before referencing any production code path in the design:
1. Check if the project has a `production-code.md` file. If so, read it first.
2. For any path referenced from production modules:
   - Use full file paths including exact function/class (e.g., `modules/example-service/src/config.py:ServiceConfig.get_default_config()`)
   - Verify the path exists: `ls -la <path>` or equivalent
   - Verify the path is used in project scripts: `rg "<path_or_module>" projects/<project>/`
   - If no usage found, check if the path is in a "DO NOT USE" section of production-code.md
   - Never anchor on batch scripts (`batch_eval/`), deprecated files (`*_deprecated.py`), or test utilities
3. Cross-reference credentials: verify that required environment variables exist in `infra/.env`

**Why this matters:** Agents (especially smaller models like Fast Model) may anchor on files that "look authoritative" without verifying actual usage. The verification step prevents config mismatches that would invalidate experiments. See ADR 0039 for incident details.

**Upstream limitations review** (MANDATORY when consuming prior experiment outputs):
Before designing an experiment that uses outputs from prior experiments:

1. Identify all upstream experiments whose outputs will be consumed
2. Read each upstream EXPERIMENT.md's "Limitations" section (if present)
3. Document in the new experiment's Design section:
   - "Upstream limitations reviewed: [list experiment IDs or 'none']"
   - "Limitations affecting this experiment: [list or 'none']"
   - "Mitigation: [how addressed or why acceptable]"

If no upstream experiments are consumed, state: "Upstream limitations reviewed: none (no prior experiment outputs consumed)".

**Why this matters:** EXPERIMENT.md "Limitations" sections document known issues that may invalidate downstream results. Without explicit review, agents assume upstream outputs are valid, leading to cascading failures. See `projects/sample-project/diagnosis/diagnosis-input-validation-gap-2026-02-26.md` for incident details.

**Model selection verification** (MANDATORY when the experiment calls an external model):
If the experiment design involves calling any external model (LLM or VLM):
1. Select the model intentionally (do not copy identifiers from old scripts without verifying they still exist and match your intent)
2. Document the selection rationale in the Config section: which model, why, and what evidence you have
3. Note any known failure modes or limitations and mitigation plans

**Why this matters:** Model naming is confusing (e.g., `gemini-2.0-flash` vs `gemini-3-flash-preview` are different models with different capabilities). youji has accumulated empirical data on model performance that must be leveraged. See `projects/sample-project/postmortem/postmortem-vlm-model-selection-no-capability-lookup-2026-02-26.md`.

Address these validity threats explicitly:
- **Position bias**: If the experiment involves pairwise comparison, how is presentation order handled?
- **Sample size**: How many observations are needed? If you can estimate statistical power, do so. If not, state the minimum useful sample size and why.
- **Confounds**: What other variables could explain the results? How are they controlled or measured?
- **Construct validity**: Does the measurement actually capture the thing you claim to measure? Where is the gap between operationalization and construct?
- **Config fidelity** (when experimenting against a production system): Does the experiment config match production? Start by reading the project's `production-code.md` if it exists (see [ADR 0039](../../../decisions/0039-production-code-discovery.md)). Include: (1) exact file path and function/class of the production config, (2) parameter-by-parameter comparison confirming the experiment config matches, (3) pipeline architecture match (single-stage vs. multi-stage, model checkpoints). Ambiguous references like "from config.py" are insufficient when multiple files share the same name. Verify paths against existing working project scripts, not just production module code. See `projects/sample-project/postmortem/postmortem-eval-config-mismatch-production-2026-02-25.md`.

## Step 5: Estimate costs

- API calls: number of calls × approximate cost per call
- Compute time: wall-clock estimate for the full run
- Human time: any manual steps required
- State whether the experiment can be run in a single agent session or requires multiple

## Step 6: Define success criteria

**Deployment gates** (preconditions — must be true to ship, not research):
- Type correctness, test passage, smoke tests
- These are binary pass/fail, checked once at deploy time

**Evaluation metrics** (research — measured over N sessions):
- Behavioral outcomes observable from session metrics JSONL
- Must be quantitative, comparable across time windows
- Always include at least one knowledge output metric (findings/session,
  questions resolved, hypotheses tested)
- State observation window (minimum 10-20 sessions)

What result would confirm the hypothesis? What would refute it? What would be ambiguous? Be specific about thresholds or effect sizes.

## Output format

Produce the experiment using the schema from CLAUDE.md:

```
## Experiment: <title>

Hypothesis: <falsifiable statement — or "Measurement study" with defined quantities>
CI layers: <which layers are involved and how>

Variables:
- Independent: <what we vary, with justification>
- Dependent: <what we measure, with metric properties and alternatives considered>
- Controlled: <what we hold fixed, with specifics>

Method:
1. <step with tool/command references>
2. ...

Validity threats:
- <threat>: <how addressed>

Cost estimate:
- API calls: <N calls × $X = $total>
- Compute: <estimate>
- Human time: <estimate>
- Sessions: <single or multi-session>

Success criteria:
- Confirmed if: <specific threshold or pattern>
- Refuted if: <specific threshold or pattern>
- Ambiguous if: <what would leave the question open>
```

After the schema output, add a brief **Design rationale** section explaining the key judgment calls you made and what alternatives you rejected.

## Task design for analysis

When the experiment involves a long-running process (>5 minutes), the analysis task must be split per [decisions/0023-incremental-analysis-throttling.md](../../../decisions/0023-incremental-analysis-throttling.md):

- Create a **preliminary analysis** task (satisfiable mid-experiment, e.g., "Analyze at ~50% completion")
- Create a **final analysis** task (blocked-by experiment completion)

This prevents monolithic analysis tasks from being perpetually re-selected by /orient with diminishing returns. A single "Analyze results" task with a Done-when achievable only at completion will loop indefinitely.

## Headless rendering for visual validation

When an experiment requires visual validation (rendering GLB/FBX models, generating images from 3D scenes), an agent can use:

```bash
xvfb-run -a python3 -c "
import trimesh
scene = trimesh.load('model.glb')
result = scene.save_image(resolution=[1280, 960])
with open('output.png', 'wb') as f:
    f.write(result)
"
```

Do not assume visual rendering is blocked in headless environments. The xvfb + trimesh combination enables headless visual validation.

## Commit

Follow `docs/sops/commit-workflow.md`. Commit message: `design: <experiment title> — status: planned`
