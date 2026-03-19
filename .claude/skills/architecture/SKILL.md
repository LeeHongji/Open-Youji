---
name: architecture
description: "Use when a file or module is too large, responsibilities are tangled, or a cross-cutting redesign is needed"
complexity: high
model-minimum: gpt-5
disable-model-invocation: false
allowed-tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash(cd * && npx tsc --noEmit)", "Bash(wc -l *)", "Bash(wc *)", "Bash(git diff *)", "Bash(git log *)"]
argument-hint: "[file, module, 'scan', 'map', 'auto', or redesign description]"
---

# /architecture <target>

Analyze and evolve the youji infrastructure — from targeted refactoring of a single file to cross-cutting architectural redesign. This skill operates at four levels:

- **Auto** (autonomous diagnosis) — detect, prioritize, and implement architecture improvements autonomously
- **Refactor** (structural, behavior-preserving) — split files, extract modules, reduce coupling
- **Map** (analytical, read-only) — trace agent types, data flows, module dependencies, system boundaries
- **Redesign** (behavioral, architectural) — propose and implement changes to how components interact, what agents exist, how data flows

The argument determines the mode:

| Argument | Mode | Example |
|---|---|---|
| `auto` or empty | Autonomous diagnosis | `/architecture auto` or `/architecture` |
| File path or module name | Refactor | `/architecture chat.ts` |
| `scan` | Refactor scan | `/architecture scan` |
| `map` or `map <subsystem>` | Architectural map | `/architecture map agents` |
| Anything else | Redesign | `/architecture unify chat and autofix agents` |

## When to use

- **vs `/simplify`**: simplify removes; architecture restructures.
- **vs `/gravity`**: gravity adds capabilities; architecture reorganizes existing ones.
- **vs `/design`**: design is for experiment methodology; architecture is for infrastructure code.

---

## Mode: Auto (Autonomous Diagnosis and Improvement)

When invoked without specific instructions (`/architecture` or `/architecture auto`), autonomously diagnose the infrastructure's architectural health and implement improvements following the hierarchy: **safety > clarity > efficiency**.

### Step 1: Scan for architectural issues

Survey the entire `infra/` directory structure for issues across five dimensions:

1. **File size violations** — files exceeding ~150 lines that mix concerns
2. **Duplication** — repeated code patterns across files (use `Grep` for common function signatures, error patterns, config handling)
3. **Coupling** — modules with excessive cross-dependencies or circular imports (trace imports)
4. **Clarity gaps** — missing documentation, unclear interfaces, inconsistent naming
5. **Type safety violations** — any files that would fail `tsc --noEmit` or have `any` types where specific types belong

For each issue found:
- Severity: **critical** (breaks constraints, fails type check), **high** (blocks development), **medium** (degrades maintainability), **low** (nice to have)
- Impact radius: how many files/modules affected
- Fix effort: **trivial** (<30 min), **moderate** (30 min - 2 hrs), **substantial** (>2 hrs)

### Step 2: Check constraint compliance

Verify compliance against architectural constraints (Section "Architectural constraints" below):
- Source code only in `infra/` (not in `projects/`)
- No contradictions with `decisions/*.md`
- Files under ~150 lines
- One file, one concern
- Type safety (`tsc --noEmit` passes)
- Atomic writes for persistence
- Backend abstraction maintained
- Security boundary respected

Flag any violations as **critical** severity.

### Step 3: Prioritize by safety-clarity-efficiency hierarchy

Rank all discovered issues:

**Priority 1 (SAFETY)** — must fix, prevents correctness or data loss:
- Type safety violations
- Broken atomicity in persistence
- Security boundary violations
- Contradictions with decisions

**Priority 2 (CLARITY)** — blocks understanding and modification:
- File size violations (>200 lines)
- Missing or misleading documentation
- Unclear interfaces between components
- Duplication that obscures source of truth

**Priority 3 (EFFICIENCY)** — degrades performance or resource usage:
- Unnecessary recomputation
- Memory leaks or resource leaks
- Inefficient algorithms where complexity matters

Within each priority tier, prefer: **lower effort × larger impact radius**.

### Step 4: Implement highest-priority fix

For the single highest-priority issue:

1. **Verify the problem** — read relevant files, check that the issue exists and is as described
2. **Propose the fix** — state what will change and why (1-3 sentences)
3. **Check dependencies** — grep for imports/references that will be affected
4. **Implement** — make the change using Refactor mode (structural, behavior-preserving). If the fix requires Redesign mode (behavioral change needing plan mode + user approval), log the issue to the report file (Step 5) and skip to the next highest-priority issue that can be resolved via Refactor. Auto mode cannot enter Redesign — it would require pausing for approval, which conflicts with autonomous flow.
5. **Verify** — run `tsc --noEmit` if touching TypeScript, check that no imports broke
6. **Document** — if the fix resolves a design tension or establishes a pattern, note whether a decision record is needed

**Implementation constraint:** Only implement ONE fix per `/architecture auto` invocation. This prevents cascading changes and keeps each improvement reviewable.

### Step 5: Save report to disk

Write the full issues report to `projects/youji/diagnosis/architecture-scan-YYYY-MM-DD.md` (using today's date). This ensures discovered issues persist across sessions — the report in session output is ephemeral and lost when the session ends.

### Step 5b: Task Bridge

After saving the report, convert unfixed issues to tasks:

1. For each P1/P2 issue NOT fixed in this session (Auto only implements one fix):
   - Create a task in the youji project's TASKS.md
   - `[fleet-eligible] [skill: execute]` for code fixes, `[requires-opus]` for redesigns
   - `Done when:` derived from the issue description and verification criteria
   - `Why:` referencing the architecture scan report file path
2. Skip issues that are P3 (efficiency) unless effort is "trivial"
3. Skip issues that already have matching open tasks in TASKS.md

This ensures architecture issues persist as actionable tasks rather than only as report entries that require future `/architecture auto` invocations to rediscover.

### Step 6: Report findings and next action

Even if you implement a fix, report ALL discovered issues prioritized, so the next session knows what remains.

### Output format

```
## Architecture Auto-Diagnosis — YYYY-MM-DD
Files: <N> | Issues: <N>
### Issues (safety > clarity > efficiency)
- [<SEVERITY>] <issue> | Files: <affected> | Effort: <estimate>
### Constraints: <pass/fail status>
### Fix: <issue + files changed + verification>
### Next: <highest-priority remaining, or "Architecture health: good">
```
**Stop:** No Priority 1/2 issues → report "Architecture health: good" and make no changes.

---

## Architectural constraints

Before changing anything, internalize these:

1. **Source code lives only in `infra/`**. Projects contain research artifacts, not code.
2. **`decisions/` are binding.** Read decisions relevant to the code you're touching. Do not contradict them. If a decision is wrong, note it but do not override.
3. **File size convention**: ~150 lines per file. Files above this are split candidates.
4. **One file, one concern**. Cross-cutting state is passed via arguments or injected at startup, not via module-level globals (exception: in-memory caches).
5. **Type safety**: Every edit must pass `cd infra/scheduler && npx tsc --noEmit`.
6. **Crash safety**: Persistence uses atomic write (.tmp + rename). No new write patterns.
7. **Backend abstraction**: `backend.ts` provides a unified interface over Claude SDK and Cursor CLI. Do not break the backend-agnostic contract.
8. **Security boundary**: `security.ts` validates all external input. Validation must happen before execution, never after.

---

## Mode: Map

Produce a complete architectural map of the system or a subsystem. Read-only — no changes.

### Procedure

1. **Read all source files** in the target subsystem (default: `infra/scheduler/src/`).
2. **Trace imports** to build a dependency graph.
3. **Identify every agent spawn point** — everywhere the system creates a Claude/Cursor session (check `agent.ts`, `chat.ts`, `event-agents.ts`, `executor.ts`). For each:
   - Trigger: what causes it to spawn (cron, Slack message, experiment failure, CLI command)
   - System prompt: what instructions does it get (read the actual prompt-building code)
   - Tools: what `allowedTools` array is passed
   - Model: what model string is used
   - Turns: `maxTurns` limit
   - Permissions: `permissionMode` and `allowDangerouslySkipPermissions`
   - Lifecycle: how it starts, how it ends (timeout, turn limit, interruption)
   - Communication: how it reports results (callbacks, Slack DM, stdout, file writes)
4. **Identify data flows** — how state moves between components (job store, progress.json, session registry, conversation buffers, approval queue, metrics).
5. **Identify governance layers** — budget gate, approval gate, security checks, verification.

### Output format

```
## Architectural map: <scope> — YYYY-MM-DD
### Agents (spawn, prompt, tools, model, maxTurns, permissions, lifecycle, communication, unique capability)
### Dependencies: <module graph>
### Data flow: <persistent vs ephemeral vs hybrid>
### Governance: <budget, approval, security, verification layers>
### Observations: <strengths, weaknesses, opportunities>
```

---

## Mode: Redesign

Propose and implement architectural changes that alter behavior, introduce new patterns, or change how components interact. This goes beyond refactoring — it may change what agents exist, what they can do, and how they communicate.

### Step 1: Map the current state

Run the Map procedure (above) for the affected subsystem. You need a complete picture before proposing changes.

### Step 1.5: Enter plan mode

Use `EnterPlanMode`, write map findings + design tension + proposal + draft ADR, then `ExitPlanMode` for user approval before implementing.

### Step 2: Identify the design tension

What's wrong with the current architecture? Frame as a tension between two or more forces:

- **Duplication vs specialization** — multiple agents do similar things with different prompts
- **Autonomy vs safety** — more capable agents need fewer human checkpoints but have more blast radius
- **Simplicity vs capability** — fewer components are easier to understand but may lack features
- **Coupling vs cohesion** — tightly coupled components are harder to change but may perform better together

Name the tension explicitly. Vague "this should be better" is not a design tension.

### Step 3: Propose the redesign

For each proposed change:

- **What changes** — concrete: which files, functions, types, data flows
- **Why it's better** — which side of the design tension does it resolve, and what's the tradeoff
- **What breaks** — which existing behaviors change, and what callers need updating
- **Migration path** — can this be done incrementally, or is it all-or-nothing?
- **Verification** — how to confirm the new architecture works (tsc, manual test, behavioral check)

Present the full proposal and **wait for user approval** before implementing. Redesigns are not auto-approved — they introduce new patterns that may have non-obvious consequences.

### Step 4: Implement incrementally

Break the redesign into atomic steps. Each step must:

1. Leave the system in a working state (compiles, existing behavior preserved until intentionally changed)
2. Be type-checked: `cd infra/scheduler && npx tsc --noEmit`
3. Be small enough to review — if a step touches >5 files, break it down further

Order of operations for a typical redesign:
1. **Add** new modules, types, and interfaces (additive, nothing breaks)
2. **Migrate** callers one at a time to the new interface
3. **Remove** old code only after all callers have migrated
4. **Verify** the full system compiles and behaves correctly

### Step 5: Record the decision

Write `decisions/NNNN-<title>.md` with context, decision, consequences. **ADR task bridge:** If ADR has unimplemented Migration steps, create corresponding tasks. **Convention propagation:** If redesign modified a cross-file convention, propagate to all locations.

### Output format

```
## Redesign: <title> — YYYY-MM-DD
### Current state: <map findings>
### Design tension: <name + why current falls wrong side>
### Proposal: <changes with what/why/breaks/migration/verification>
### Migration: <steps>
### ADR: <draft decisions/NNNN-title.md>
```

---

## Mode: Refactor (behavior-preserving)

For `scan` or a specific file/module target. Pure structural improvement — no behavioral changes.

### If argument is "scan"

Survey all infra source code for refactoring candidates:

1. Read every `.ts` file in `infra/scheduler/src/` and note line counts.
2. Identify files exceeding ~150 lines — assess whether they have multiple concerns.
3. Check for code duplication, tight coupling, unclear interfaces.
4. Produce a prioritized candidate list.

```
## Refactoring scan — YYYY-MM-DD
### Candidates: <file | lines | issue | risk | effort | sketch>
### Dependencies: <module map>
### Recommendation: <next action>
```
Stop after scan — do not implement unless asked.

### For a specific file or module

1. **Read** the file and its dependents completely.
2. **Check `decisions/`** for constraints on this module.
3. **Identify** concern groups, duplication, coupling, interface problems.
4. **Plan** each extraction: what moves, new interface, import updates, behavioral invariant.
5. **Implement** one extraction at a time, type-checking between each.
6. **Verify**: final tsc, git diff --stat, produce summary.

```
## Refactoring: <what> — YYYY-MM-DD
### Changes: <file: what/why>
### New modules: <file: purpose>
### Behavioral: None
### Verification: tsc pass, <N> files changed
```

---

## Commit

Follow `docs/sops/commit-workflow.md`. Commit message: `architecture: <mode> — <brief summary of changes>`

## Safety rules (all modes)

- **Type-check after every step.** Not at the end — after every step.
- **Never remove exports without grepping all callers.**
- **Refactoring must not change behavior.** Note bugs found during refactoring but fix them separately.
- **Redesigns MUST use plan mode** — enter with `EnterPlanMode`, exit with `ExitPlanMode` for user approval.
- **Redesigns require a decision record** after implementation completes.
- **>5 files touched → pause and confirm** with the user.
- **Check `decisions/`** before contradicting any established pattern.
