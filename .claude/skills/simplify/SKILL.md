---
name: simplify
description: "Use when a plan or implementation feels over-engineered and needs a complexity check"
complexity: medium
model-minimum: glm-5
disable-model-invocation: false
allowed-tools: ["Read", "Grep", "Glob"]
argument-hint: "[file path, plan, or implementation directory]"
---

# /simplify <path or description>

Review a plan, implementation, or design for unnecessary complexity. The argument is a file path (plan document, README, or source directory) or a description of the artifact. Read it first.

## When to use this vs alternatives

- **Use `/simplify`** when the primary concern is whether something is over-engineered — too many components, abstractions, or dependencies for the stated mission.
- **Use `/critique`** when you want to find *correctness* problems (misattributions, grounding failures, provenance gaps). Critique asks "is this wrong?"; simplify asks "is this necessary?"
- **Use `/gravity`** when you suspect a pattern should be formalized (moved from manual to code/convention). Gravity adds structure; simplify removes it.

## Core test

For every component, feature, abstraction, dependency, or configuration:

> "If I removed this, would the stated mission fail?"

If the answer is no, it is a candidate for removal. The burden of proof is on inclusion, not exclusion.

## Procedure

### 1. Identify the mission

Find the stated goal — the project's Mission/Done-when, the plan's objective, or the feature's purpose. If there is no stated mission, flag this as the first problem.

### 2. Inventory components

List every distinct component of the artifact:
- For a plan: each step, tool, dependency, page, feature
- For an implementation: each file, dependency, abstraction layer, configuration option
- For a design: each entity, relationship, interface, constraint

### 3. Apply removal tests

For each component:

#### Must-have test
Does the mission fail without this? Be strict — "nice to have" is not "must have." Common false must-haves:
- Error handling for impossible states
- Configuration for values that never change
- Abstractions over single implementations
- Features the user didn't ask for
- Documentation no one will read
- Tests for trivial logic (i.e., tests that duplicate what the type system already guarantees — NOT tests for simple runtime behavior, which the `/develop` skill requires per its TDD rule)

#### Precedent test
Is there a simpler existing solution in the codebase or ecosystem? Check:
- Does another project in the repo solve this more simply?
- Is there a framework/library convention that eliminates this component?
- Could a simpler tool replace a complex one?

#### Complexity test
Is this component pulling in disproportionate complexity for its value?
- A dependency that requires a build step for one feature
- An abstraction layer that exists for "future flexibility"
- A configuration system for 2-3 options
- An SPA framework for a read-only dashboard

#### Coupling test
Does this component introduce coupling that constrains future changes?
- Type systems or schemas that over-specify
- Shared state that doesn't need to be shared
- Tight integration where loose would suffice

### 4. Propose cuts

For each non-essential component, propose one of:
- **Remove**: Delete entirely
- **Inline**: Collapse an abstraction into its single usage
- **Downgrade**: Replace with a simpler alternative (e.g., SPA → server-rendered, ORM → raw SQL, custom component → HTML element)
- **Defer**: Keep the idea but remove from current scope

## Output format

```
## Simplification Review: <artifact>

### Mission
<stated mission — or "MISSING: no mission found">

### Components (N total)

#### Must-have (N)
- <component>: <why it's essential>
[list]

#### Cut candidates (N)

##### <component name>
- Purpose: <what it does>
- Mission-critical: no
- Reason: <why it's not needed>
- Action: remove | inline | downgrade | defer
- Replacement: <simpler alternative, or "none needed">

[repeat for each candidate]

### Summary
- Components reviewed: N
- Must-have: N
- Cut: N
- Estimated reduction: <rough % of complexity removed>
- Highest-value cut: <the single change that removes the most complexity>
```
