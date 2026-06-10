import { describe, expect, it } from "vitest";
import {
  buildJobGenerationPlaceholderOutput,
  buildGenericOpenAiPlaceholderContent,
  isOpenAiPlaceholderMode,
  isOpenAiPlaceholderModeForProject,
} from "./openai-generation-placeholder.js";
import { FLOW_TOP_PERFORMER_MIMIC_CAROUSEL } from "../domain/top-performer-mimic-flow-types.js";
import { slideOnImageCopyFromSlides } from "./mimic-carousel-render.js";

describe("openai-generation-placeholder", () => {
  it("isOpenAiPlaceholderMode respects config and env", () => {
    const prev = process.env.OPENAI_GENERATION_MODE;
    try {
      delete process.env.OPENAI_GENERATION_MODE;
      expect(isOpenAiPlaceholderMode({ OPENAI_GENERATION_MODE: "placeholder" })).toBe(true);
      expect(isOpenAiPlaceholderMode({ OPENAI_GENERATION_MODE: "live" })).toBe(false);
      process.env.OPENAI_GENERATION_MODE = "placeholder";
      expect(isOpenAiPlaceholderMode({ OPENAI_GENERATION_MODE: "live" })).toBe(true);
      process.env.OPENAI_GENERATION_MODE = "live";
      expect(isOpenAiPlaceholderMode({ OPENAI_GENERATION_MODE: "placeholder" })).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.OPENAI_GENERATION_MODE;
      else process.env.OPENAI_GENERATION_MODE = prev;
    }
  });

  it("isOpenAiPlaceholderModeForProject uses project override over server env", () => {
    const prev = process.env.OPENAI_GENERATION_MODE;
    try {
      process.env.OPENAI_GENERATION_MODE = "placeholder";
      expect(isOpenAiPlaceholderModeForProject("live", { OPENAI_GENERATION_MODE: "placeholder" })).toBe(
        false
      );
      expect(isOpenAiPlaceholderModeForProject("placeholder", { OPENAI_GENERATION_MODE: "live" })).toBe(
        true
      );
      delete process.env.OPENAI_GENERATION_MODE;
      expect(isOpenAiPlaceholderModeForProject(null, { OPENAI_GENERATION_MODE: "live" })).toBe(false);
      process.env.OPENAI_GENERATION_MODE = "placeholder";
      expect(isOpenAiPlaceholderModeForProject(null, { OPENAI_GENERATION_MODE: "live" })).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.OPENAI_GENERATION_MODE;
      else process.env.OPENAI_GENERATION_MODE = prev;
    }
  });

  it("buildJobGenerationPlaceholderOutput honors mimic slide_copy_layout length", () => {
    const out = buildJobGenerationPlaceholderOutput({
      flowType: FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
      payload: {
        mimic_render_context: { target_slide_count: 3 },
        mimic_job_grounding: {
          slide_copy_layout: [
            { slide_index: 1, reference_on_screen_text: "aries\nrage" },
            { slide_index: 2, reference_on_screen_text: "taurus\ncalm" },
            { slide_index: 3, reference_on_screen_text: "gemini\nchaos" },
          ],
        },
      },
      mimicSlideCopyLayout: [
        { reference_on_screen_text: "aries\nrage" },
        { reference_on_screen_text: "taurus\ncalm" },
        { reference_on_screen_text: "gemini\nchaos" },
      ],
    });
    const slides = out.slides as Record<string, unknown>[];
    expect(slides).toHaveLength(3);
    expect(slides[0]?.headline).toBe("");
    expect(slides[0]?.body).toBe("aries\nrage");
    expect(slides[1]?.body).toBe("taurus\ncalm");
    expect(String(out.caption)).toContain("[PLACEHOLDER]");
    expect(String(out.caption)).toContain("aries");
  });

  it("mimic placeholder body matches reference transcript for Flux on-image copy", () => {
    const transcript = "how it feels to be an\naries @glossy_zodiac rage is consuming me";
    const out = buildJobGenerationPlaceholderOutput({
      flowType: FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
      payload: {
        mimic_job_grounding: {
          slide_copy_layout: [{ slide_index: 1, reference_on_screen_text: transcript }],
        },
      },
    });
    const slides = out.slides as Record<string, unknown>[];
    expect(slides[0]?.body).toBe(transcript);
    expect(slides[0]?.headline).toBe("");
    expect(slideOnImageCopyFromSlides(slides, 1)).toBe(transcript);
  });

  it("buildGenericOpenAiPlaceholderContent returns JSON when requested", () => {
    const raw = buildGenericOpenAiPlaceholderContent({ response_format: "json_object" } as never);
    const parsed = JSON.parse(raw);
    expect(parsed.placeholder).toBe(true);
  });
});
