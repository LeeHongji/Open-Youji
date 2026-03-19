# ADR 0065: Benchmark model routing integrity

Date: 2026-03-06
Status: accepted
Triggered by: PI feedback — "Benchmark results must not be affected by infra errors. Data needs to be always reported with actual successful opencode GLM runs"

## Context

GLM-5 benchmark results were corrupted because the benchmark harness routed GLM-5 through cursor-agent, which doesn't support it. cursor-agent returned error JSON with exit code 0, which the harness treated as valid model output. Judges scored this error JSON at floor level (~33%), contaminating all GLM-5 benchmark data.

The root cause was duplicated: model routing logic existed in some experiment scripts (benchmark-execution-expanded, benchmark-skill-expansion) but not in the shared harness module (sandbox.py) or the primary benchmark script (run_benchmark.py).

This produced 84+ invalid evaluations across the rc-decorrelation-redesign experiment and affected all GLM-5 scores in the multi-trial benchmark.

## Decision

1. **Centralized model routing in sandbox.py.** The shared sandbox module now contains `call_model()` which auto-routes models to the correct backend. GLM-5 routes to SGLang API; other models route to cursor-agent. All benchmark scripts MUST use `call_model()` for model calls (judge calls still use cursor-agent directly since judges are always cursor-agent-supported models).

2. **Error detection for cursor-agent.** Both `sandbox.py:call_cursor_agent()` and `model_runner.py:CursorAgentBackend` now detect cursor-agent error JSON responses (exit 0 with `{"type":"error"...}` on stdout). These are treated as errors, not valid output.

3. **GLM-5 removed from CursorAgentBackend.CURSOR_MODEL_MAP.** Prevents accidental routing through cursor-agent in the library's async API.

4. **Convention: every model evaluated in the benchmark must produce data through a backend that actually supports it.** If a model is added to the benchmark, a corresponding backend entry must exist in `SGLANG_MODELS` (sandbox.py) or be a cursor-agent-supported model. Adding a model without backend support is a configuration error that must be caught before evaluation starts.

## Consequences

- All future benchmark runs will correctly route GLM-5 to SGLang.
- cursor-agent infrastructure errors will be detected and reported as errors rather than silently scored.
- Experiment scripts that still use their own `call_cursor_agent()` directly (legacy) will benefit from the error detection if they import from sandbox.py, but should be migrated to `call_model()` for new experiments.
- Historical data with GLM-5 floor scores should be flagged/excluded in analysis scripts. The rc-decorrelation-redesign experiment already handles this via the `run_glm5_rerun.py` script.

## Migration

- `run_benchmark.py` (primary script): Updated to use `call_model()`.
- Other experiment scripts (benchmark-execution-expanded, benchmark-skill-expansion): Already have their own routing. No change needed but they could be simplified by importing from sandbox.py.
- Analysis scripts: Should check for and exclude error responses (content starting with `{"type":"error"`) when computing scores.
