Fleet (reference only)

This folder contains a minimal reference implementation of Youji's fleet concept.

It is included for agents to read and adapt. It is NOT intended to work out of the box
in youji.

Why reference-only:

- Fleet execution depends on environment-specific model/backends and operational policy.
- The core scheduler can run without fleet and remains simpler and safer.
- A production fleet requires tuning and guardrails that vary by deployment.

If you want fleet in your system:

- Read these files to understand task scanning, prompt construction, and worker lifecycle.
- Copy/adapt into your own scheduler implementation.
- Provide your own claim store and worker orchestration layer.

Files:

- `fleet-tasks.ts`: parse `projects/*/TASKS.md` and extract runnable tasks
- `fleet-prompt.ts`: build a self-contained worker prompt
- `fleet-executor.ts`: example worker execution lifecycle (spawn -> commit -> push)
- `fleet-status.ts`: example status formatting helpers
- `fleet-supply.ts`: example supply snapshot logic
