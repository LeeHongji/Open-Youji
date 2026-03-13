---
name: architecture
description: "Use when a file or module is too large, responsibilities are tangled, or a cross-cutting redesign is needed"
argument-hint: "[file, module, 'scan', 'map', 'auto', or redesign description]"
---

# /architecture <target>

Analyze and evolve Youji's infrastructure and codebase — from targeted refactoring of a single file to cross-cutting architectural redesign. This skill operates at four levels:

- **Auto** (autonomous diagnosis) — detect, prioritize, and implement architecture improvements autonomously
- **Refactor** (structural, behavior-preserving) — split files, extract modules, reduce coupling
- **Map** (analytical, read-only) — trace data flows, module dependencies, system boundaries
- **Redesign** (behavioral, architectural) — propose and implement changes to how components interact

The argument determines the mode:

| Argument | Mode | Example |
|---|---|---|
| `auto` or empty | Autonomous diagnosis | `/architecture auto` or `/architecture` |
| File path or module name | Refactor | `/architecture scheduler.py` |
| `scan` | Refactor scan | `/architecture scan` |
| `map` or `map <subsystem>` | Architectural map | `/architecture map` |
| Anything else | Redesign | `/architecture unify config handling` |

## When to use

- **vs `/simplify`**: simplify removes; architecture restructures.
- **vs `/gravity`**: gravity adds capabilities; architecture reorganizes existing ones.
- **vs `/design`**: design is for experiment methodology; architecture is for infrastructure code.
- **vs `/develop`**: develop implements features/fixes; architecture restructures existing code.

---

## Mode: Auto (Autonomous Diagnosis and Improvement)

When invoked without specific instructions, autonomously diagnose architectural health and implement improvements following the hierarchy: **safety > clarity > efficiency**.

### Step 1: Scan for architectural issues

Survey the codebase for issues across five dimensions:

1. **File size violations** — files exceeding ~200 lines that mix concerns
2. **Duplication** — repeated code patterns across files
3. **Coupling** — modules with excessive cross-dependencies or circular imports
4. **Clarity gaps** — missing documentation, unclear interfaces, inconsistent naming
5. **Type safety violations** — any files with weak typing where specific types belong

For each issue found:
- Severity: **critical** (breaks constraints), **high** (blocks development), **medium** (degrades maintainability), **low** (nice to have)
- Impact radius: how many files/modules affected
- Fix effort: **trivial** (<30 min), **moderate** (30 min - 2 hrs), **substantial** (>2 hrs)

### Step 2: Prioritize by safety-clarity-efficiency hierarchy

**Priority 1 (SAFETY)** — must fix:
- Type safety violations
- Security issues
- Data integrity problems

**Priority 2 (CLARITY)** — blocks understanding:
- File size violations (>200 lines)
- Missing or misleading documentation
- Unclear interfaces between components
- Duplication that obscures source of truth

**Priority 3 (EFFICIENCY)** — degrades performance:
- Unnecessary recomputation
- Resource leaks
- Inefficient algorithms where complexity matters

Within each priority tier, prefer: **lower effort x larger impact radius**.

### Step 3: Implement highest-priority fix

For the single highest-priority issue:
1. **Verify the problem** — read relevant files, check that the issue exists
2. **Propose the fix** — state what will change and why
3. **Check dependencies** — grep for imports/references that will be affected
4. **Implement** — make the change (behavior-preserving for refactors)
5. **Verify** — run tests if available, check no imports broke
6. **Document** — note whether a decision record is needed

**Implementation constraint:** Only implement ONE fix per `/architecture auto` invocation.

### Step 4: Save report to disk

Write the full issues report to `projects/<relevant-project>/diagnosis/architecture-scan-YYYY-MM-DD.md`.

### Step 5: Task Bridge

For each P1/P2 issue NOT fixed in this session:
- Create a task in the relevant TASKS.md
- `Done when:` derived from the issue description
- `Why:` referencing the architecture scan report

### Output format

```
## Architecture Auto-Diagnosis — YYYY-MM-DD
Files: <N> | Issues: <N>
### Issues (safety > clarity > efficiency)
- [<SEVERITY>] <issue> | Files: <affected> | Effort: <estimate>
### Fix: <issue + files changed + verification>
### Next: <highest-priority remaining, or "Architecture health: good">
```

**Stop:** No Priority 1/2 issues -> report "Architecture health: good" and make no changes.

---

## Mode: Map

Produce an architectural map of the system or a subsystem. Read-only — no changes.

### Procedure

1. **Read all source files** in the target subsystem.
2. **Trace imports** to build a dependency graph.
3. **Identify data flows** — how state moves between components (files, databases, APIs, in-memory).
4. **Identify boundaries** — where does the system interact with external services?

### Output format

```
## Architectural map: <scope> — YYYY-MM-DD
### Components: <module: purpose>
### Dependencies: <module graph>
### Data flow: <persistent vs ephemeral vs hybrid>
### Boundaries: <external interfaces>
### Observations: <strengths, weaknesses, opportunities>
```

---

## Mode: Redesign

Propose and implement architectural changes that alter behavior.

### Step 1: Map the current state
Run the Map procedure for the affected subsystem.

### Step 2: Identify the design tension
Frame as a tension between two or more forces:
- **Duplication vs specialization**
- **Autonomy vs safety**
- **Simplicity vs capability**
- **Coupling vs cohesion**

Name the tension explicitly.

### Step 3: Propose the redesign

For each proposed change:
- **What changes** — concrete: which files, functions, types, data flows
- **Why it's better** — which side of the design tension does it resolve, and what's the tradeoff
- **What breaks** — which existing behaviors change
- **Migration path** — can this be done incrementally?
- **Verification** — how to confirm the new architecture works

Present the full proposal and **wait for researcher approval** before implementing.

### Step 4: Implement incrementally

Break the redesign into atomic steps. Each step must:
1. Leave the system in a working state
2. Be small enough to review

### Step 5: Record the decision

Write `decisions/NNNN-<title>.md` with context, decision, consequences.

---

## Mode: Refactor (behavior-preserving)

### If argument is "scan"

Survey source code for refactoring candidates:
1. Read files and note line counts.
2. Identify files exceeding ~200 lines — assess whether they have multiple concerns.
3. Check for code duplication, tight coupling, unclear interfaces.
4. Produce a prioritized candidate list.

Stop after scan — do not implement unless asked.

### For a specific file or module

1. **Read** the file and its dependents completely.
2. **Check `decisions/`** for constraints on this module.
3. **Identify** concern groups, duplication, coupling, interface problems.
4. **Plan** each extraction: what moves, new interface, import updates.
5. **Implement** one extraction at a time, verifying between each.
6. **Verify**: final check, git diff --stat, produce summary.

---

## Safety rules (all modes)

- **Verify after every step.** Not at the end — after every step.
- **Never remove exports without grepping all callers.**
- **Refactoring must not change behavior.** Note bugs found during refactoring but fix them separately.
- **Redesigns require researcher approval** before implementation.
- **>5 files touched -> pause and confirm** with the researcher.
- **Check `decisions/`** before contradicting any established pattern.

## Commit

Commit message: `architecture: <mode> — <brief summary of changes>`
