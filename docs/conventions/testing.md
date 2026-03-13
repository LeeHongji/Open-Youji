Testing conventions for Youji.

## When to write tests

Tests are required when:
- Writing new infrastructure code (`infra/` directory)
- Fixing bugs (write a test that reproduces the bug first)
- Modifying existing code with tests
- Building validators or enforcement mechanisms

Tests are not required for:
- Research documentation (literature notes, experiment write-ups)
- Convention files and SOPs
- Project README updates

## TDD workflow

Follow the TDD SOP at [docs/sops/tdd-workflow.md](../sops/tdd-workflow.md):

1. Write a failing test first (RED)
2. Run the test -- it should fail
3. Write minimal implementation (GREEN)
4. Run the test -- it should pass
5. Refactor (IMPROVE)
6. Run all tests -- they should all pass

## Test organization

- Tests are colocated with source files
- TypeScript: `*.test.ts` next to `*.ts` (use vitest)
- Python: `test_*.py` next to `*.py` (use pytest)
- Test file names match source: `executor.ts` --> `executor.test.ts`

## Test types

1. **Unit tests**: Individual functions and utilities. Fast, isolated, no external dependencies.
2. **Integration tests**: Components working together. May use file I/O, databases, APIs.
3. **Validation tests**: Schema compliance, data integrity. Run at commit time.

## Coverage target

Aim for 80%+ coverage on infrastructure code. Measure with:
- TypeScript: `npm test -- --coverage`
- Python: `pytest --cov=src --cov-report=term-missing`

## Common anti-patterns

| Anti-pattern | Correct approach |
|-------------|-----------------|
| Tests written after implementation | Write test first (TDD) |
| Tests that test implementation details | Test behavior and contracts |
| Tests that require specific execution order | Each test is independent |
| Skipping tests for "urgent" fixes | Urgent fixes need tests most -- 2 minutes now saves hours later |
| Mocking everything | Mock external dependencies, test internal logic directly |

## Experiment validation

Experiment records (EXPERIMENT.md) may have their own validation:
- Required frontmatter fields present and valid
- Type-specific sections present for the given status
- ID matches directory name
- Referenced files exist
- CSV integrity (headers, non-empty)

If a validator exists, run it before committing experiment records.
