import { describe, expect, it } from "vitest";
import {
  buildVideoInsightSynthesisEvidencePack,
  mergeFullVideoAnalysisIntoParsed,
  shouldRunVideoInsightFullAnalysis,
} from "./video-insight-full-analysis.js";

describe("buildVideoInsightSynthesisEvidencePack", () => {
  it("includes whisper and per-frame OCR summaries", () => {
    const pack = buildVideoInsightSynthesisEvidencePack({
      captionTranscript: "caption",
      whisperTranscript: "Hello world",
      frameCount: 2,
      frameTimestampsSec: [0, 3],
      visionParsed: {
        why_it_worked: "weak",
        frames: [
          { frame_index: 1, on_screen_text_transcript: "HOOK", visual_description: "face close-up" },
          { frame_index: 2, on_screen_text_transcript: "CTA", visual_description: "product" },
        ],
      },
    });
    expect(pack.whisper_transcript).toBe("Hello world");
    expect(pack.frames).toHaveLength(2);
    expect((pack.frames as Array<Record<string, unknown>>)[0]?.on_screen_text).toBe("HOOK");
  });
});

describe("mergeFullVideoAnalysisIntoParsed", () => {
  it("overwrites weak why_it_worked with synthesis prose", () => {
    const merged = mergeFullVideoAnalysisIntoParsed(
      { why_it_worked: "short", format_pattern: "talking_head", frames: [] },
      {
        why_it_worked: "Detailed retention story across the full clip.",
        narrative_arc: "Opens with contrast hook, then proof, then CTA.",
        message_thesis: "Gemini updates matter for creators.",
        spoken_hook: "May Gemini vs June Gemini?",
        hook_analysis: { spoken: "May Gemini vs June Gemini?", visual: "split face", on_screen: "" },
        on_screen_text_script: "HOOK\n\nCTA",
      }
    );
    expect(merged.why_it_worked).toContain("retention");
    expect(merged.spoken_hook).toBe("May Gemini vs June Gemini?");
    expect(merged.full_video_analysis).toBeTruthy();
    expect(merged._full_video_synthesis).toBe(true);
  });
});

describe("shouldRunVideoInsightFullAnalysis", () => {
  it("requires OpenAI key and some evidence", () => {
    expect(
      shouldRunVideoInsightFullAnalysis({
        openAiApiKey: "",
        frameCount: 8,
        whisperTranscript: "hi",
        captionTranscript: "",
        visionParsed: { why_it_worked: "x" },
      })
    ).toBe(false);
    expect(
      shouldRunVideoInsightFullAnalysis({
        openAiApiKey: "sk-test",
        frameCount: 1,
        whisperTranscript: "",
        captionTranscript: "",
        visionParsed: null,
      })
    ).toBe(false);
    expect(
      shouldRunVideoInsightFullAnalysis({
        openAiApiKey: "sk-test",
        frameCount: 1,
        whisperTranscript: "spoken",
        captionTranscript: "",
        visionParsed: { frames: [] },
      })
    ).toBe(true);
  });
});
