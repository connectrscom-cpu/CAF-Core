import { describe, expect, it } from "vitest";
import { mergeVideoInsightChunks, normalizeVideoInsightsLlmJson } from "./video-insights-llm-normalize.js";

describe("normalizeVideoInsightsLlmJson", () => {
  it("unwraps video_wide_summary and hoists video-wide fields", () => {
    const out = normalizeVideoInsightsLlmJson({
      video_wide_summary: {
        video_arc: "Static inspirational quote",
        format_pattern: "text_on_screen",
        why_it_worked: "Bold contrast",
        cta_clarity: "Drop a heart",
        frames: [{ frame_index: 1, on_screen_text_transcript: "Hello", hot_type: "text_overlay" }],
      },
    });
    expect(out?.format_pattern).toBe("text_on_screen");
    expect(out?.why_it_worked).toBe("Bold contrast");
    expect((out?.frames as Record<string, unknown>[])[0]?.shot_type).toBe("text_overlay");
  });

  it("unwraps video_wide wrapper", () => {
    const out = normalizeVideoInsightsLlmJson({
      video_wide: {
        video_arc: "Comedic premise",
        risk_flags: [],
        format_pattern: "mixed",
      },
    });
    expect(out?.video_arc).toBe("Comedic premise");
    expect(out?.format_pattern).toBe("mixed");
  });

  it("rejects garbage cmd/zoom payloads without salvage fields", () => {
    expect(
      normalizeVideoInsightsLlmJson({
        cmd: "",
        zoom: "scene",
        error: "missing_frame_pattern",
      })
    ).toBeNull();
  });

  it("merges frame chunks with deck summary from first chunk", () => {
    const merged = mergeVideoInsightChunks([
      {
        format_pattern: "talking_head",
        why_it_worked: "Expert + hook",
        frames: [
          { frame_index: 1, on_screen_text_transcript: "One" },
          { frame_index: 2, on_screen_text_transcript: "Two" },
        ],
      },
      {
        frames: [{ frame_index: 3, on_screen_text_transcript: "Three" }],
      },
    ]);
    expect(merged.format_pattern).toBe("talking_head");
    expect(merged.frames).toHaveLength(3);
  });
});
