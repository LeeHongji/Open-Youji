/**
 * Convention module injection based on task type.
 * 
 * When a task type is specified, the scheduler injects relevant convention
 * and schema files into the agent's input. This reduces context bloat by
 * loading only task-relevant conventions.
 */

import type { TaskType } from "./types.js";

/**
 * Convention module paths relative to repo root.
 * These files are injected into the agent prompt based on task type.
 */
const CONVENTION_BASE_PATH = "docs/conventions";
const SCHEMA_BASE_PATH = "docs/schemas";

/**
 * Module sets for each task type.
 * Each task type gets a base set of conventions plus type-specific schemas.
 */
const TASK_TYPE_MODULES: Record<TaskType, { conventions: string[]; schemas: string[] }> = {
  experiment: {
    conventions: ["session-discipline", "task-lifecycle", "resource-constraints", "provenance"],
    schemas: ["experiment", "log-entry", "task", "budget-ledger"],
  },
  analysis: {
    conventions: ["session-discipline", "task-lifecycle", "provenance"],
    schemas: ["experiment", "log-entry", "task"],
  },
  implementation: {
    conventions: ["session-discipline", "task-lifecycle", "file-conventions"],
    schemas: ["experiment", "log-entry", "task"],
  },
  bugfix: {
    conventions: ["session-discipline", "task-lifecycle", "file-conventions"],
    schemas: ["experiment", "log-entry", "task"],
  },
};

/**
 * Builds the convention module directive for injection.
 * Returns a string to prepend to the agent prompt, or empty string if no task type.
 */
export function injectConventionModules(prompt: string, taskType?: TaskType): string {
  if (!taskType) {
    return prompt;
  }

  const moduleConfig = TASK_TYPE_MODULES[taskType];
  if (!moduleConfig) {
    return prompt;
  }

  const directives: string[] = [];
  directives.push("CONVENTION_MODULES_DIRECTIVE: Load the following convention and schema files at session start:");
  directives.push("");

  if (moduleConfig.conventions.length > 0) {
    directives.push("Conventions:");
    for (const name of moduleConfig.conventions) {
      directives.push(`  - ${CONVENTION_BASE_PATH}/${name}.md`);
    }
    directives.push("");
  }

  if (moduleConfig.schemas.length > 0) {
    directives.push("Schemas:");
    for (const name of moduleConfig.schemas) {
      directives.push(`  - ${SCHEMA_BASE_PATH}/${name}.md`);
    }
    directives.push("");
  }

  directives.push("These files define the schemas and conventions relevant to this task type.");
  directives.push("END_CONVENTION_MODULES_DIRECTIVE");
  directives.push("");

  return directives.join("\n") + prompt;
}

/**
 * Returns the list of module paths that would be injected for a task type.
 * Useful for logging and debugging.
 */
export function getModulePathsForTaskType(taskType: TaskType): { conventions: string[]; schemas: string[] } {
  const config = TASK_TYPE_MODULES[taskType];
  return {
    conventions: config.conventions.map((n) => `${CONVENTION_BASE_PATH}/${n}.md`),
    schemas: config.schemas.map((n) => `${SCHEMA_BASE_PATH}/${n}.md`),
  };
}
