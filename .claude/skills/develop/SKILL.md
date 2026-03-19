---
name: develop
description: "Use when implementing new features, fixing bugs, or modifying code in infra/"
complexity: high
model-minimum: gpt-5
allowed-tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash(cd infra/scheduler && npm test)", "Bash(cd infra/scheduler && npx tsc --noEmit)", "Bash(cd infra/scheduler && npm run build)", "Bash(cd infra/scheduler && npm install *)", "Bash(git diff *)", "Bash(git log *)", "Bash(git status)", "Bash(git add *)", "Bash(git commit *)", "Bash(git push)", "Bash(curl *)"]
argument-hint: "[feature description] or [fix <bug description>]"
---

# /develop <task>

Develop youji infrastructure code using test-driven development. Covers new features and bug fixes in `infra/`.

The argument determines the mode:

| Argument pattern | Mode | Example |
|---|---|---|
| `fix <description>` | Bugfix | `/develop fix living message shows no final text` |
| Anything else | Feature | `/develop mid-run message forwarding via streamInput` |

---

## Mode: Feature

### Step 1: Understand

1. Read the relevant source files in `infra/scheduler/src/`.
2. Check `decisions/` for constraints on the area you're changing.
3. Search for existing patterns — functions, types, utilities — that can be reused. Do not build what already exists.
4. **Config and access patterns:** When encountering "not configured" or "unavailable" errors, check:
   - `infra/*/docs/` for documented patterns (e.g., `provider-quirks.md` for API key BYOK)
   - Other projects' logs and experiments via `grep -r "<capability>" projects/`
   - `decisions/` for constraints on credentials and access
5. If the scope is large (>3 files, architectural change), use `EnterPlanMode` to plan first.

### Step 2: Write tests

1. Identify the test file — colocated as `<module>.test.ts` next to the source file.
2. Write failing tests that describe the expected behavior. Cover:
   - Happy path (the feature works as intended)
   - Edge cases (empty inputs, missing data, error conditions)
   - Integration points (does it interact correctly with adjacent modules?)
3. Run tests to confirm they fail: `cd infra/scheduler && npm test`

### Step 3: Implement

1. Write the minimum code to make tests pass.
2. Follow existing patterns in the codebase (naming, error handling, types).
3. Keep files under ~150 lines. Extract new modules if needed.
4. Run tests after each significant change: `cd infra/scheduler && npm test`

### Step 4: Verify

1. All tests pass: `cd infra/scheduler && npm test`
2. Type check passes: `cd infra/scheduler && npx tsc --noEmit`
3. No unintended side effects — review your diff with `git diff`.

### Step 5: Deploy

1. Commit: `git add <files> && git commit -m "<message>"`
2. Push: `git push`
3. Build: `cd infra/scheduler && npm run build`
4. Restart: `curl -s -X POST http://localhost:8420/api/restart` (triggers graceful drain per ADR 0018 — waits for concurrent sessions to finish before exiting)

Never skip steps — the scheduler is a long-running pm2 process; code changes without build + restart have no effect.

### Step 6: Document

1. If the change is non-trivial, add a log entry to the relevant project README.
2. If a design decision was made, check whether a decision record is warranted. If writing an ADR with Migration or Consequences containing unimplemented action items, create corresponding tasks in the relevant project's `TASKS.md` before committing (ADR task bridge — see CLAUDE.md Decisions section).
3. If you modified a convention or rule that appears in multiple documents (CLAUDE.md, SOPs, decision records, skills), propagate the change to all locations in the same turn.

---

## Mode: Bugfix

### Step 1: Reproduce

1. Read the bug description and identify the symptom.
2. Trace the code path — read the relevant source files, follow the execution flow.
3. Identify the root cause. Attribute to CI layer if applicable.
4. Check logs (pm2, output.log) if available for evidence.

### Step 2: Write regression test

1. Write a test in the colocated `<module>.test.ts` that reproduces the bug.
2. The test should fail with the current code (confirming the bug exists).
3. Run tests: `cd infra/scheduler && npm test` — the new test should fail, others should pass.

### Step 3: Fix

1. Apply the minimum change to fix the root cause.
2. Run tests: `cd infra/scheduler && npm test` — all tests should now pass.
3. Type check: `cd infra/scheduler && npx tsc --noEmit`

### Step 4: Verify

1. All tests pass.
2. Type check passes.
3. Review diff — confirm the fix is targeted and doesn't introduce new issues.
4. If the bug was in a hot path, consider whether adjacent code has the same pattern.

### Step 5: Deploy

1. Commit: `git add <files> && git commit -m "<message>"`
2. Push: `git push`
3. Build: `cd infra/scheduler && npm run build`
4. Restart: `curl -s -X POST http://localhost:8420/api/restart` (graceful drain — ADR 0018)

---

## Constraints

- **Tests first.** Never implement before writing tests. This is enforced by CLAUDE.md.
- **Type safety.** Every change must pass `tsc --noEmit`.
- **One concern per file.** Split if a file exceeds ~150 lines.
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

**Violating the letter of this rule is violating the spirit.**

---

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Too simple to need a test" | Simple code breaks. The test takes 30 seconds to write. |
| "I'll add tests after implementing" | Tests that pass immediately prove nothing — you never saw them catch the bug. |
| "I already tested it manually" | Manual testing is ad-hoc. No record, can't re-run, easy to miss cases. |
| "The fix is obvious, just one line" | One-line fixes cause regressions. The regression test takes 2 minutes. |
| "This is just a config change" | Config changes that affect behavior need tests. If it can break, test it. |
| "I'm almost done, adding tests now would slow me down" | Sunk cost fallacy. Tests now prevent debugging later. |
| "Keep the code as reference, then write tests" | You'll adapt it instead of starting fresh. That's testing after, not TDD. |
| "The existing code has no tests, why start now?" | You're improving the codebase. Add tests for what you touch. |
| "This is infrastructure, not business logic" | Infrastructure bugs take down everything. Test it more, not less. |
| "I need to explore the approach first" | Fine — prototype, then delete it and start with TDD. Exploration is not implementation. |
| "The user is waiting / this is urgent" | Urgency makes regression tests MORE important, not less. The next occurrence won't have a user watching to verify. Write the test first — it takes 2 minutes. |

---

## Red Flags — STOP and Reassess

If you notice any of these, stop and return to Step 2 (Write tests):

- Writing implementation code before any test exists
- A test passes immediately without any implementation change
- Rationalizing "just this once" or "this case is different"
- Expressing confidence about correctness without running `npm test`
- Wanting to commit before all tests pass and type check succeeds
- Three or more fix attempts on the same bug — this signals an architectural problem, not a simple bug. Stop fixing and investigate the design.
- Claiming "tests after achieve the same goals" — tests-after verify what you built; tests-first verify what's required. They are not equivalent.

---

## Verification Gate

Before claiming any task is complete:

1. **Run tests**: `cd infra/scheduler && npm test` — see the output, count failures
2. **Run type check**: `cd infra/scheduler && npx tsc --noEmit` — confirm zero errors
3. **Review diff**: `git diff` — confirm changes are targeted and complete
4. **Only then** claim the work is done

Never use "should work", "probably passes", or "looks correct". Evidence before claims.
