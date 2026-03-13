---
name: develop
description: "Use when implementing new features, fixing bugs, or writing code for research infrastructure"
argument-hint: "[feature description] or [fix <bug description>]"
---

# /develop <task>

Develop research infrastructure code using test-driven development. Covers new features, bug fixes, and tooling.

The argument determines the mode:

| Argument pattern | Mode | Example |
|---|---|---|
| `fix <description>` | Bugfix | `/develop fix analysis script crashes on empty CSV` |
| Anything else | Feature | `/develop create experiment runner script` |

---

## Mode: Feature

### Step 1: Understand

1. Read the relevant source files.
2. Check `decisions/` for constraints on the area you're changing.
3. Search for existing patterns — functions, types, utilities — that can be reused. Do not build what already exists.
4. If the scope is large (>3 files, architectural change), plan first before implementing.

### Step 2: Write tests

1. Identify or create the test file (colocated near the source file).
2. Write failing tests that describe the expected behavior. Cover:
   - Happy path (the feature works as intended)
   - Edge cases (empty inputs, missing data, error conditions)
   - Integration points (does it interact correctly with adjacent modules?)
3. Run tests to confirm they fail.

### Step 3: Implement

1. Write the minimum code to make tests pass.
2. Follow existing patterns in the codebase (naming, error handling, types).
3. Keep files under ~200 lines. Extract new modules if needed.
4. Run tests after each significant change.

### Step 4: Verify

1. All tests pass.
2. Type check passes (if applicable).
3. No unintended side effects — review your diff with `git diff`.

### Step 5: Document

1. If the change is non-trivial, add a log entry to the relevant project README.
2. If a design decision was made, check whether a decision record is warranted.
3. If you modified a convention or rule, propagate the change to all locations.

---

## Mode: Bugfix

### Step 1: Reproduce

1. Read the bug description and identify the symptom.
2. Trace the code path — read the relevant source files, follow the execution flow.
3. Identify the root cause.
4. Check logs if available for evidence.

### Step 2: Write regression test

1. Write a test that reproduces the bug.
2. The test should fail with the current code (confirming the bug exists).
3. Run tests — the new test should fail, others should pass.

### Step 3: Fix

1. Apply the minimum change to fix the root cause.
2. Run tests — all tests should now pass.

### Step 4: Verify

1. All tests pass.
2. Type check passes (if applicable).
3. Review diff — confirm the fix is targeted.
4. If the bug was in a hot path, consider whether adjacent code has the same pattern.

---

## Constraints

- **Tests first.** Never implement before writing tests. This is non-negotiable.
- **One concern per file.** Split if a file exceeds ~200 lines.
- **Check decisions/.** Do not contradict established decisions.
- **Inline logging.** Record discoveries and decisions to repo files in the same turn, not at session end.

---

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Wrote code before writing a test? Delete the code. Write the test. Watch it fail. Then reimplement.

- Do not keep the deleted code as "reference"
- Do not "adapt" it while writing tests
- Delete means delete — start fresh from what the test demands

---

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Too simple to need a test" | Simple code breaks. The test takes 30 seconds to write. |
| "I'll add tests after implementing" | Tests that pass immediately prove nothing. |
| "I already tested it manually" | Manual testing is ad-hoc. No record, can't re-run. |
| "The fix is obvious, just one line" | One-line fixes cause regressions. The test takes 2 minutes. |
| "This is just a config change" | Config changes that affect behavior need tests. |
| "The existing code has no tests" | You're improving the codebase. Add tests for what you touch. |
| "I need to explore the approach first" | Fine — prototype, then delete and start with TDD. |
| "This is urgent" | Urgency makes tests MORE important. Write the test first. |

---

## Red Flags — STOP and Reassess

If you notice any of these, stop and return to Step 2 (Write tests):

- Writing implementation code before any test exists
- A test passes immediately without any implementation change
- Rationalizing "just this once"
- Expressing confidence about correctness without running tests
- Three or more fix attempts on the same bug — investigate the design

---

## Verification Gate

Before claiming any task is complete:

1. **Run tests** — see the output, count failures
2. **Review diff** — confirm changes are targeted and complete
3. **Only then** claim the work is done

Never use "should work", "probably passes", or "looks correct". Evidence before claims.

## Commit

Commit message: `develop: <feature or fix summary>`
