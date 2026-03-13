The Creative Intelligence (CI) layer framework for analyzing where problems and capabilities live in an AI system.

# Creative Intelligence (CI)

## What is Creative Intelligence?

**Creative Intelligence** is the capability of a *system* (humans + AI + tools) to:

- tackle open-ended creative and research tasks,
- generate multiple plausible options,
- iterate and refine based on feedback,
- and develop a stable sense of "what is good" for a given context.

It is *not* just a powerful model. It emerges from the model(s), the workflows and tools around them, the interfaces and languages users work through, the way we evaluate outputs, and how humans make decisions.

---

## The Creative Intelligence Layer Stack

We model a creative AI product as **five interacting layers**:

1. **Model (Layer 1)**
   - Foundation and task models (language, image, 3D, motion, etc.).
   - "Raw" generative capability and internal representations.

2. **Workflow (Layer 2)**
   - Pipelines, operators, scripts, services.
   - How models are chained, repaired, and connected to other tools.

3. **Interface (Layer 3)**
   - UI, prompts, node graphs, parameter panels, APIs.
   - How humans express intent, constrain behavior, and edit results.

4. **Evaluation (Layer 4)**
   - Metrics, test sets, QA, human review, task success rates.
   - The **reality layer**: turns probabilistic behavior into observable performance.

5. **Human (Layer 5)**
   - How humans decide what to build, what to fix, and how gravity flows.
   - How teams of humans produce structure, ownership, rituals, roadmaps.

Users never experience one layer in isolation. They experience the *system* that results from all five.

---

## Three Fundamental Principles

### Principle 1: Creative Intelligence is Distributed

What users experience as "intelligence" comes from **all layers combined**: model behavior, workflows and repair steps, interface and controls, evaluation and filters, human decisions.

**Consequences:**

- Many "model problems" are actually workflow, UX, or eval issues (and vice versa).
- Ownership must be defined per *capability* across layers, not just per function.
- When something goes wrong, name the layer. "The model is bad" is not a diagnosis. "L3 input format lacks the information needed for L1 to assess mesh topology" is.

### Principle 2: Creative Intelligence is Probabilistic

For creative and research tasks, **there is no single deterministically "correct" output**. Success must be defined as **task-level success rates**, not "this one API call is always correct."

**Consequences:**

- Creative intelligence systems must be **grounded by constraints** to learn about their capabilities.
- Product design must embrace **iteration, retries, and variation**, not "one magic button."
- Reliability is about **the whole workflow**, not one perfect generation step.
- Evaluation must focus on **distributions and coverage**, not single examples.

### Principle 3: Creative Intelligence Has Downward Gravity

Repeated manual fixes, scripts, and workflow hacks are **not stable end-states**. Over time, the system should absorb them as **deeper capabilities**:

```
manual fix --> tool/operation --> standard workflow --> model behavior
```

Intelligence "flows downward" from human practice and workarounds, into tools and pipelines, and eventually into model training and data.

**Consequences:**

- Assume that foundation model capabilities will improve and expand naturally. Workflows today will be absorbed into future models.
- Every recurring pattern of human correction is a **signal** and a **roadmap item**.
- If gravity is blocked (hacks never move down), complexity and cost explode.

---

## Secondary Conclusions

1. **Intelligence is unknown unless grounded with constraints.** A model's "raw intelligence" is not meaningful until it is tied to specific tasks, constraints, and clear success criteria.

2. **Creative success is never guaranteed.** For any non-trivial creative task, the system can only offer a **high probability** of success, never a formal guarantee. Design fallbacks, edit/repair workflows, and expectations around "most of the time, with some iteration."

---

## Practical Implications

- **Design around workflows, not single shots.** Features should support branching, variants, editing, and retries by design.

- **Make layers explicit in decisions.** For any initiative, clarify: what changes in Model, what changes in Workflow, what changes in Interface, what changes in Evaluation, who owns what.

- **Use Evaluation as the reality layer.** Define task-level metrics and test sets early. Use them to decide when models, workflows, or UX are "good enough."

- **Treat manual fixes as training signals.** Log recurring corrections and hacks. Turn them into tools, then into training/eval targets.

---

## How Youji Uses CI

The CI framework provides vocabulary for Youji's research work:

- **Layer attribution in findings**: When analyzing experiment results or diagnosing problems, attribute causes to specific CI layers. This prevents shallow analysis ("the model failed") and enables targeted interventions.

- **Experiment design**: Use CI layers to ensure experiments measure the right thing. An experiment testing L1 (model capability) must control for L2 (workflow) and L3 (interface) effects.

- **Gravity tracking**: When Youji notices recurring manual patterns (the researcher repeatedly doing the same fix), flag them as gravity candidates for migration to lower layers.

---

## Summary

Creative Intelligence views an AI creative product as a **probabilistic, multi-layer system** where intelligence is **distributed** across models, workflows, interfaces, evaluation, and organization, and where **improvements should naturally flow downward** from human practice into tools and models over time. The goal is not a perfect, single-shot model, but a system that reliably helps people reach good creative outcomes through well-designed workflows, clear constraints, honest evaluation, and deliberate choices.
