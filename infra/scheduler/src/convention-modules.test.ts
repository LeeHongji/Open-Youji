import { describe, it, expect } from "vitest";
import { injectConventionModules, getModulePathsForTaskType } from "./convention-modules.js";
import type { TaskType } from "./types.js";

describe("convention-modules", () => {
  describe("injectConventionModules", () => {
    it("returns prompt unchanged when taskType is undefined", () => {
      const prompt = "Hello, agent!";
      const result = injectConventionModules(prompt, undefined);
      expect(result).toBe(prompt);
    });

    it("injects convention modules for experiment task type", () => {
      const prompt = "Run the agent";
      const result = injectConventionModules(prompt, "experiment");
      
      expect(result).toContain("CONVENTION_MODULES_DIRECTIVE");
      expect(result).toContain("docs/conventions/session-discipline.md");
      expect(result).toContain("docs/schemas/experiment.md");
      expect(result).toContain("Run the agent");
    });

    it("injects convention modules for analysis task type", () => {
      const prompt = "Analyze results";
      const result = injectConventionModules(prompt, "analysis");
      
      expect(result).toContain("CONVENTION_MODULES_DIRECTIVE");
      expect(result).toContain("docs/conventions/provenance.md");
      expect(result).toContain("docs/schemas/experiment.md");
      expect(result).not.toContain("docs/conventions/resource-constraints.md");
    });

    it("injects convention modules for implementation task type", () => {
      const prompt = "Build feature X";
      const result = injectConventionModules(prompt, "implementation");
      
      expect(result).toContain("CONVENTION_MODULES_DIRECTIVE");
      expect(result).toContain("docs/conventions/file-conventions.md");
      expect(result).toContain("docs/schemas/experiment.md");
    });

    it("injects convention modules for bugfix task type", () => {
      const prompt = "Fix bug Y";
      const result = injectConventionModules(prompt, "bugfix");
      
      expect(result).toContain("CONVENTION_MODULES_DIRECTIVE");
      expect(result).toContain("docs/conventions/file-conventions.md");
      expect(result).toContain("docs/schemas/experiment.md");
    });

    it("prepends directive to prompt", () => {
      const prompt = "Original prompt";
      const result = injectConventionModules(prompt, "experiment");
      
      expect(result.startsWith("CONVENTION_MODULES_DIRECTIVE")).toBe(true);
      expect(result.endsWith("Original prompt")).toBe(true);
    });

    it("includes END directive marker", () => {
      const prompt = "Test";
      const result = injectConventionModules(prompt, "experiment");
      
      expect(result).toContain("END_CONVENTION_MODULES_DIRECTIVE");
    });
  });

  describe("getModulePathsForTaskType", () => {
    it("returns correct paths for experiment task type", () => {
      const paths = getModulePathsForTaskType("experiment");
      
      expect(paths.conventions).toContain("docs/conventions/session-discipline.md");
      expect(paths.conventions).toContain("docs/conventions/task-lifecycle.md");
      expect(paths.conventions).toContain("docs/conventions/resource-constraints.md");
      expect(paths.conventions).toContain("docs/conventions/provenance.md");
      expect(paths.schemas).toContain("docs/schemas/experiment.md");
      expect(paths.schemas).toContain("docs/schemas/budget-ledger.md");
    });

    it("returns correct paths for analysis task type", () => {
      const paths = getModulePathsForTaskType("analysis");
      
      expect(paths.conventions).not.toContain("docs/conventions/resource-constraints.md");
      expect(paths.schemas).not.toContain("docs/schemas/budget-ledger.md");
    });

    it("returns correct paths for implementation task type", () => {
      const paths = getModulePathsForTaskType("implementation");
      
      expect(paths.conventions).toContain("docs/conventions/file-conventions.md");
      expect(paths.conventions).not.toContain("docs/conventions/resource-constraints.md");
    });

    it("returns correct paths for bugfix task type", () => {
      const paths = getModulePathsForTaskType("bugfix");
      
      expect(paths.conventions).toContain("docs/conventions/file-conventions.md");
      expect(paths.conventions).not.toContain("docs/conventions/resource-constraints.md");
    });
  });
});
