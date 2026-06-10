import { describe, expect, it } from "vitest";
import {
  effectiveMimicBflModel,
  parseProjectMimicBflModel,
  MIMIC_BFL_MODEL_FLEX,
  MIMIC_BFL_MODEL_KLEIN_4B,
} from "./mimic-bfl-model.js";

describe("mimic-bfl-model", () => {
  it("parseProjectMimicBflModel accepts slugs and aliases", () => {
    expect(parseProjectMimicBflModel("flux-2-flex")).toBe(MIMIC_BFL_MODEL_FLEX);
    expect(parseProjectMimicBflModel("flex")).toBe(MIMIC_BFL_MODEL_FLEX);
    expect(parseProjectMimicBflModel("4b")).toBe(MIMIC_BFL_MODEL_KLEIN_4B);
    expect(parseProjectMimicBflModel("")).toBeNull();
    expect(parseProjectMimicBflModel("unknown")).toBeNull();
  });

  it("effectiveMimicBflModel prefers project override", () => {
    expect(effectiveMimicBflModel(MIMIC_BFL_MODEL_FLEX, MIMIC_BFL_MODEL_KLEIN_4B)).toBe(MIMIC_BFL_MODEL_FLEX);
    expect(effectiveMimicBflModel(null, MIMIC_BFL_MODEL_FLEX)).toBe(MIMIC_BFL_MODEL_FLEX);
  });
});
