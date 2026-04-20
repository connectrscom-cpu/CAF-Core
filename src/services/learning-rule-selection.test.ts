import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getLearningRulesForPlanning,
  getLearningContextForGeneration,
} from "./learning-rule-selection.js";

const here = dirname(fileURLToPath(import.meta.url));
const decisionEngineIndex = readFileSync(
  resolve(here, "../decision_engine/index.ts"),
  "utf8"
);
const llmGenerator = readFileSync(resolve(here, "llm-generator.ts"), "utf8");
const learningRoutes = readFileSync(
  resolve(here, "../routes/learning.ts"),
  "utf8"
);

describe("learning-rule-selection facade", () => {
  it("exports the two-sided API with clear names", () => {
    expect(typeof getLearningRulesForPlanning).toBe("function");
    expect(typeof getLearningContextForGeneration).toBe("function");
  });

  it("is the only place decision_engine/index.ts looks up planning rules", () => {
    expect(decisionEngineIndex).toMatch(/getLearningRulesForPlanning/);
    expect(decisionEngineIndex).not.toMatch(/listActiveAppliedLearningRules/);
  });

  it("is the only place llm-generator.ts compiles generation guidance", () => {
    expect(llmGenerator).toMatch(/getLearningContextForGeneration/);
    expect(llmGenerator).not.toMatch(/from "\.\/learning-context-compiler/);
  });

  it("is used by the learning context-preview route too", () => {
    expect(learningRoutes).toMatch(/getLearningContextForGeneration/);
    expect(learningRoutes).not.toMatch(/from "\.\.\/services\/learning-context-compiler/);
  });
});
