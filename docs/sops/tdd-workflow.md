Standard procedure for test-driven development in the Youji repo.

## TDD Workflow

When: Writing new code (new features, bugfixes, behavioral changes).
Requires: A code change to implement or bug to fix.

### 1. Identify the test location

- Tests are colocated with source files: `*.test.ts` next to `*.ts` (TypeScript), `test_*.py` next to `*.py` (Python)
- Test file names match source: `executor.ts` --> `executor.test.ts`

> Output: Test file path identified

### 2. Write a failing test first

**For new features:**
- Write a test that calls the function/method you're about to implement
- The test must fail (function doesn't exist, returns wrong value, throws)
- One test per behavior, not one test per function

**For bugfixes:**
- Write a test that reproduces the bug exactly as reported
- The test must fail, demonstrating the bug exists
- Include the issue/bug context in the test description

```
// Example: bugfix test
it('should handle empty input array without crashing', () => {
  // Bug: processItems() throws on empty array
  expect(() => processItems([])).not.toThrow();
});
```

> Output: Failing test that captures the required behavior

### 3. Run the test to confirm failure

```bash
# TypeScript (vitest)
npm test -- --run path/to/test.test.ts

# Python (pytest)
pytest path/to/test_file.py -x
```

- Confirm the test fails for the expected reason
- If test passes unexpectedly, the test is wrong -- fix it before implementing

> Output: Confirmed failing test

### 4. Implement the minimum code to pass

- Write only enough code to make the test pass
- Don't add features not covered by tests
- Don't refactor during this step -- just make it pass

> Output: Implementation that passes the test

### 5. Run all tests

```bash
# TypeScript
npm test

# Python
pytest
```

- New test must pass
- All existing tests must still pass
- If any test fails, fix the implementation (not the test)

> Output: All tests passing

### 6. Refactor if needed

- Now that tests pass, refactor for clarity/performance
- Run tests after each refactor step
- Tests provide safety net for changes

> Output: Clean implementation with tests still passing

### 7. Commit with test provenance

Commit message should mention the test:

```
feat: add input validation to processItems

- Add test for empty array handling (reproduces issue #123)
- Add guard clause for empty input
```

> Output: Committed change with test-first provenance

Check: Every code change has a corresponding test file with passing tests.

## Rationale

TDD prevents regressions and documents intent. Writing tests first ensures:
1. The test actually tests the behavior you care about
2. You understand the problem before solving it
3. Future changes are protected by the test suite

## Common anti-patterns to avoid

| What you might say | Why it's wrong |
|-------------------|----------------|
| "I'll add tests after" | You won't. Tests written after catch fewer bugs and are often skipped. |
| "Keep the code as reference, then write tests" | That's testing after, not TDD. You'll adapt existing code instead of testing intent. |
| "I need to explore the approach first" | Fine -- prototype, then delete it and start with TDD. Exploration is not implementation. |
| "This is urgent, skip tests" | Urgent fixes without tests become urgent re-fixes. 2 minutes now saves hours later. |
