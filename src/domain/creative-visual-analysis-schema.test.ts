import { describe, expect, it } from "vitest";
import { parseCreativeVisualAnalysisLlm, creativeVisualAnalysisLlmSchema } from "./creative-visual-analysis-schema.js";

describe("parseCreativeVisualAnalysisLlm", () => {
  it("parses a minimal valid payload", () => {
    const raw = {
      visual_summary: "Bold high-contrast carousel",
      style_tags: ["bold", "minimal"],
      layout: { text_density: "low", type: "centered_hook" },
      color_palette: { dominant: ["#111111"], contrast: "high" },
    };
    expect(parseCreativeVisualAnalysisLlm(raw)).not.toBeNull();
    expect(creativeVisualAnalysisLlmSchema.safeParse(raw).success).toBe(true);
  });
});
