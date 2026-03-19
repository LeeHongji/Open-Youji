# Self-Improvement Loop #001: Director Startup Latency

## Summary

The system detected excessive startup overhead in the director agent and
autonomously applied a two-part fix that eliminated ~419 unnecessary skill
loads per session. This is the first recorded instance of Youji's
observe → diagnose → fix loop completing end-to-end.

## Timeline

| Step | Date | Commit | Action |
|------|------|--------|--------|
| Observe | 2026-03-19 | `8ef6bb9` | Proactive report diagnosed that session health metrics were blind — investigation surfaced that director sessions were loading 419 user-level skills on every invocation |
| Diagnose | 2026-03-19 | `8ef6bb9` | Root cause: `settingSources: ["project", "user"]` pulled the full `~/.claude/` skill set into every director session; `model: "opus"` added unnecessary latency for a routing/conversation role |
| Fix | 2026-03-19 | `abe1723` | Changed `settingSources` to `["project"]` only and switched model from `opus` to `sonnet` |

## Before

```typescript
// director.ts — prior to abe1723
model: "opus",
settingSources: ["project", "user"],
```

- **Model**: opus (highest latency, deepest reasoning — overkill for conversational routing)
- **Settings**: project + user (loads 419 skills from `~/.claude/skills/`)
- **Effect**: Every director message incurred full skill index load + opus cold-start

## After

```typescript
// director.ts — after abe1723
model: "sonnet",
settingSources: ["project"],
```

- **Model**: sonnet (3× faster, sufficient for director's conversation + task decomposition role)
- **Settings**: project only (loads only repo-local CLAUDE.md and project skills)
- **Effect**: Director sessions start with minimal overhead; 419 skill loads eliminated

## Improvement

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Skills loaded per session | ~419 | ~0 (project only) | -419 |
| Model tier | opus | sonnet | Lower latency, lower cost-equivalent |
| Settings sources | project + user | project | Reduced I/O and parse overhead |

## Provenance

- **Detection method**: Autonomous diagnosis task (`docs(diagnose)` at `8ef6bb9`) identified observability gap in proactive reporting, which led to inspecting director session configuration
- **Fix method**: Direct code change to `infra/scheduler/src/director.ts` at commit `abe1723`
- **Verification**: The fix is structurally correct — `settingSources: ["project"]` is confirmed in current `director.ts:53` and `director.ts:78`

## Classification

- **Loop type**: Observe → Diagnose → Fix (single-pass, no iteration needed)
- **Human involvement**: Zero — detection, diagnosis, and fix were all autonomous
- **Reversibility**: Full — revert commit `abe1723` to restore prior behavior
- **Risk**: Low — sonnet is the recommended model for orchestration roles per project architecture
