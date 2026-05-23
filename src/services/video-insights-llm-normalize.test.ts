import { describe, expect, it } from "vitest";
import {
  assessVideoInsightQuality,
  extractHashtagsFromVideoInsight,
  finalizeVideoInsightParsed,
  isGibberishInsightText,
  mergeVideoInsightChunks,
  normalizeVideoInsightsLlmJson,
} from "./video-insights-llm-normalize.js";

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

  it("unwraps video_wide wrapper and merges instructions replication", () => {
    const out = normalizeVideoInsightsLlmJson({
      video_wide: {
        video_arc: "Comedic premise",
        risk_flags: [],
        format_pattern: "mixed",
      },
      instructions: {
        how_to_recreate: ["Film reading paper", "Add Virgo captions"],
        asset_sources: ["phone camera"],
      },
    });
    expect(out?.video_arc).toBe("Comedic premise");
    expect(out?.format_pattern).toBe("mixed");
    expect(out?.replication_blueprint).toEqual({
      steps_to_remake: ["Film reading paper", "Add Virgo captions"],
      asset_sources: ["phone camera"],
    });
  });

  it("maps visual_system to video_visual_system", () => {
    const out = normalizeVideoInsightsLlmJson({
      format_pattern: "mixed",
      why_it_worked: "meme",
      visual_system: { canvas_aspect: "portrait_9_16", overall_aesthetic: "meme" },
    });
    expect(out?.video_visual_system).toEqual({
      canvas_aspect: "portrait_9_16",
      overall_aesthetic: "meme",
    });
    expect(out?.visual_system).toBeUndefined();
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

describe("isGibberishInsightText", () => {
  it("flags nemotron collapse patterns", () => {
    expect(isGibberishInsightText("emanuela utteranceUnknown traitor persistent dialogue")).toBe(true);
    expect(isGibberishInsightText("pruning weapon bonito DaVinci resident")).toBe(true);
  });

  it("allows normal insight prose", () => {
    expect(isGibberishInsightText("Zodiac rivalry meme with talk-show pose and bold labels.")).toBe(false);
  });
});

describe("finalizeVideoInsightParsed", () => {
  it("replaces temporal fields for single-frame samples", () => {
    const out = finalizeVideoInsightParsed(
      {
        format_pattern: "text_on_screen",
        hook_visual: "Gradient quote card",
        why_it_worked: "Relatable copy",
        video_arc: "Hook then body escalation with cuts",
        opening_vs_body: "Hook differs from later movement",
        pacing_notes: "Jump cuts build tension",
        frames: [{ frame_index: 1, on_screen_text_transcript: "Hello #gemini" }],
      },
      { frameCount: 1, captionTranscript: "#astrology launch" }
    );

    expect(out.parsed?.video_arc).toContain("Single-frame sample");
    expect(out.parsed?._inference_limits).toMatchObject({ single_frame_only: true });
    expect(out.hashtags?.split(" ").sort()).toEqual(["#astrology", "#gemini"].sort());
    expect(out.quality.ok).toBe(true);
  });

  it("rejects payloads missing core fields after normalize", () => {
    const out = finalizeVideoInsightParsed(
      {
        video_wide_summary: {
          cta_clarity: "Drop a heart",
        },
      },
      { frameCount: 1 }
    );
    expect(out.parsed).toBeNull();
    expect(out.quality.ok).toBe(false);
    expect(out.quality.reasons).toContain("missing_format_and_hook");
  });

  it("strips degenerate nemotron keys and gibberish spoken_hook", () => {
    const out = finalizeVideoInsightParsed(
      {
        format_pattern: "mixed",
        hook_visual: "Protest graphic",
        why_it_worked: "Bold messaging",
        spoken_hook: "emanuela utteranceUnknown traitor persistent dialogue stream utteranceUnknown",
        alternative_tsla_alphabet_home: "x".repeat(5000),
        frames: [{ frame_index: 1, on_screen_text_transcript: "WE ARE RACIST" }],
      },
      { frameCount: 1 }
    );
    expect(out.parsed).not.toBeNull();
    expect(out.parsed?.spoken_hook).toBeUndefined();
    expect(out.parsed?.alternative_tsla_alphabet_home).toBeUndefined();
    expect(out.quality.ok).toBe(true);
  });

  it("sanitizes nonsense replication tooling notes", () => {
    const out = finalizeVideoInsightParsed(
      {
        format_pattern: "mixed",
        hook_visual: "Documentary poster",
        message_clarity: "Teaser for social issue doc",
        replication_blueprint: {
          tooling_notes: ["pruning weapon bonito", "CapCut"],
          steps_to_remake: ["Design title card"],
        },
        frames: [{ frame_index: 1, on_screen_text_transcript: "ANATOMY OF A FUCKBOY" }],
      },
      { frameCount: 1 }
    );
    expect(out.quality.ok).toBe(true);
    const bp = out.parsed?.replication_blueprint as Record<string, unknown>;
    expect(bp.tooling_notes).toEqual(["CapCut"]);
  });
});

describe("extractHashtagsFromVideoInsight", () => {
  it("collects hashtags from frames and caption", () => {
    const tags = extractHashtagsFromVideoInsight(
      {
        frames: [{ on_screen_text_transcript: "#Gemini #memes" }],
      },
      "Launch #KnowTheZodiac"
    );
    expect(tags?.split(" ").sort()).toEqual(["#gemini", "#knowthezodiac", "#memes"].sort());
  });
});

describe("assessVideoInsightQuality", () => {
  it("passes when format and rationale exist", () => {
    const q = assessVideoInsightQuality(
      {
        format_pattern: "text_on_screen",
        why_it_worked: "Minimal quote design",
        frames: [{ frame_index: 1 }],
      },
      { frameCount: 1 }
    );
    expect(q.ok).toBe(true);
  });
});
