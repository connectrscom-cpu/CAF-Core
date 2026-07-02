import { describe, expect, it } from "vitest";
import {
  customLabelPromptInstructions,
  customLabelUserPromptBlock,
  insightColumnLabelsFromCriteria,
  sanitizeCustomLabelAnswer,
} from "./insight-column-labels.js";

describe("insightColumnLabelsFromCriteria", () => {
  it("reads operator column headers from criteria", () => {
    expect(
      insightColumnLabelsFromCriteria({
        insight_column_labels: { custom_label_1: "Zodiac", custom_label_2: "Audience" },
      })
    ).toEqual({ l1: "Zodiac", l2: "Audience", l3: "" });
  });
});

describe("sanitizeCustomLabelAnswer", () => {
  it("drops values that echo the column title", () => {
    expect(sanitizeCustomLabelAnswer("Zodiac", "Zodiac")).toBeNull();
    expect(sanitizeCustomLabelAnswer("audience", "Audience")).toBeNull();
  });

  it("keeps substantive answers", () => {
    expect(sanitizeCustomLabelAnswer("Gemini", "Zodiac")).toBe("Gemini");
    expect(sanitizeCustomLabelAnswer("Gen Z women", "Audience")).toBe("Gen Z women");
  });
});

describe("custom label prompts", () => {
  const labels = { l1: "Zodiac", l2: "Audience", l3: "" };

  it("frames labels as questions in user block", () => {
    const block = customLabelUserPromptBlock(labels);
    expect(block).toContain('column **"Zodiac"**');
    expect(block).toContain('column **"Audience"**');
    expect(block).toContain("never echo the column title");
  });

  it("instructs model not to repeat titles in system block", () => {
    const block = customLabelPromptInstructions(labels);
    expect(block).toContain("Do NOT repeat the column title");
    expect(block).toContain('"Zodiac"');
  });
});
