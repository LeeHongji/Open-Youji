Resource constraint conventions for Youji.

## Budget and ledger files

Projects may declare resource budgets and track consumption:

**`budget.yaml`** -- declares resource limits and deadline. Set by the researcher; modifying it is a structural change requiring approval.

```yaml
resources:
  llm_api_calls:
    limit: 20000
    unit: calls
deadline: 2026-03-01T00:00:00Z
```

**`ledger.yaml`** -- append-only consumption log. Youji appends entries inline during execution.

```yaml
entries:
  - date: "2026-02-16"
    experiment: baseline-eval-v1
    resource: llm_api_calls
    amount: 90
    detail: "30 calls x 3 judges"
```

## Resource-signal checklist

Before planning any task, determine whether it consumes resources:

1. **LLM API calls** -- calling any language model?
2. **External API calls** -- calling any third-party API?
3. **GPU compute** -- running inference, training, or rendering?
4. **Long-running compute** -- processes expected to run >10 minutes?

If ANY answer is yes --> `consumes_resources: true` --> apply budget check.
If ALL answers are no --> exempt from budget gates. Tag `[zero-resource]`.

## Budget check protocol

During orient:
- Compute remaining budget per resource and time to deadline
- If any resource is 100% consumed or the deadline has passed, the project is non-actionable for resource-consuming tasks
- `[zero-resource]` tasks may still proceed

During classify:
- An experiment that would exceed remaining budget is classified as RESOURCE
- Scale down to fit remaining budget, or request a budget increase via APPROVAL_QUEUE.md

## Fresh-start accounting

Historical consumption (pre-budget experiments) does not count. The ledger starts empty when `budget.yaml` is created. This lets the researcher set budgets that reflect remaining work, not total project history.

## Zero-resource exemption

Work tagged `[zero-resource]` or with `consumes_resources: false` proceeds even when budget is exhausted. This ensures the system can always produce knowledge through analysis, documentation, and planning -- even when it can't run experiments.

## Inline ledger recording

Record resource consumption inline during execution, not deferred to end of session. Each ledger entry must include:
- Date
- Experiment/task identifier
- Resource type
- Amount consumed
- Detail (how the amount was calculated)

## Cost estimation

Before running resource-consuming experiments, estimate the cost:
- Count the expected API calls, GPU hours, etc.
- Show the arithmetic (e.g., "30 tasks x 6 pairs x 3 judges = 540 calls")
- Compare against remaining budget
- If the estimate exceeds budget, scale down or request approval

Estimation errors are common. When in doubt, overestimate by 20%.
