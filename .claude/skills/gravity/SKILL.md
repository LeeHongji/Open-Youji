---
name: gravity
description: "Use when a manual fix or workaround keeps recurring and might need to be formalized into infrastructure"
argument-hint: "<pattern description or 'scan'>"
---

# /gravity <pattern description or "scan">

You are evaluating whether recurring patterns should move downward in the capability stack — from manual practice into tools, workflows, or conventions. The `/orient` and `/compound` skills *detect* gravity signals; this skill *evaluates* them.

The argument is either a specific pattern to evaluate (e.g., "agents keep manually computing metric breakdowns") or "scan" to search for gravity candidates across the repo.

## If argument is "scan"

Search for gravity signals across the repo:

1. Read all active project READMEs (Log sections) and `TASKS.md` files.
2. Grep for recurring patterns:
   - Similar commands or procedures appearing in multiple log entries
   - Manual steps described repeatedly
   - Workarounds or hacks mentioned in logs or open questions
   - TODOs that keep reappearing across sessions
3. Check `.claude/skills/` — are any skills encoding judgment that has matured enough to become convention or code?
4. Check for patterns in project code that should be extracted into shared tooling.

Produce a candidate list, then evaluate each candidate below.

## For each gravity candidate

### Step 1: Establish recurrence

- **How many times** has this pattern appeared? Cite specific log entries, files, or sessions.
- **How consistent** is it? Same pattern each time, or variations?
- **Is it still evolving?** A pattern that changes each time it appears is not yet stable enough to formalize.

A pattern must appear at least 3 times in substantially similar form before formalization is justified. If it has appeared fewer than 3 times, note it as "watch" rather than "act."

### Step 2: Identify current layer and target layer

Where does the pattern currently live?

| Current state | Gravity layer |
|---|---|
| Researcher does it manually each session | Manual |
| Written as a convention/rule in CLAUDE.md | Convention |
| Encoded as a skill prompt | Skill |
| Implemented as a script or tool | Code |

Where should it move to?

| Target | When appropriate |
|---|---|
| Skill -> Convention | The judgment has crystallized into a rule that always applies |
| Skill -> Code | The judgment can be computed deterministically |
| Convention -> Schema | The rule has become a structural template |
| Manual -> Skill | A recurring human judgment pattern can be encoded as a prompt |
| Manual -> Code | A recurring manual procedure can be automated |

### Step 3: Evaluate migration cost and benefit

**Benefit:**
- How much time/effort does the manual pattern cost per occurrence?
- How likely is the pattern to recur? (weekly? every session? every project?)
- What is the risk of the manual version being done inconsistently or incorrectly?

**Cost:**
- How much effort to formalize? (writing a skill: ~30 min; writing a schema: ~10 min; writing code: hours-days)
- Does formalization risk premature optimization? (encoding a pattern that hasn't stabilized yet)
- Does it add complexity that makes the system harder to understand?

**Decision rule:** Formalize when `(frequency x cost_per_occurrence x inconsistency_risk) > formalization_effort`. When in doubt, wait — premature formalization is worse than repeated manual work.

### Step 4: Design the migration

If the candidate passes the cost-benefit check:

- What exactly gets created? (new skill, new schema, new convention, new code)
- What gets removed or simplified? (gravity should simplify the layer above, not just add to the layer below)
- What is the verification? How do you confirm the formalization actually captures the pattern?

## Output format

```
## Gravity assessment
Date: YYYY-MM-DD

### Candidates evaluated

#### <pattern name>
Recurrence: <N times — cite evidence>
Stability: stable | evolving | premature
Current level: Manual | Convention | Skill | Code
Target level: Manual | Convention | Skill | Code
Frequency: <how often it recurs>
Cost per occurrence: <low | medium | high>
Formalization effort: <low | medium | high>
Verdict: **formalize now** | **watch** | **decline**
Rationale: <1-2 sentences>
Migration plan: <what to create, what to simplify — or "n/a" if watch/decline>

[repeat for each candidate]

### Summary
- Formalize now: <list>
- Watch: <list>
- Decline: <list>
```

Be conservative. The repo convention is "grow structure on demand" — do not formalize patterns that are still evolving or that have appeared fewer than 3 times.

## Task Bridge (recommended)

For candidates with verdict "formalize now":
1. Create a task in the relevant project's TASKS.md for the migration plan
2. `Done when:` the pattern has been formalized at the target level
3. `Why:` referencing this gravity assessment

For candidates with verdict "watch": no task — these are noted for future evaluation.

## Commit

Commit message: `gravity: assess <pattern name(s)>`
