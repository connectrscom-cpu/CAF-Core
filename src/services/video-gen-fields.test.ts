import { describe, expect, it } from "vitest";
import {
  extractSpokenScriptText,
  extractVideoPromptText,
  synthesizeVideoPromptFromPlan,
} from "./video-gen-fields.js";

describe("video-gen-fields", () => {
  it("extractVideoPromptText synthesizes from production-plan shape when video_prompt absent", () => {
    const gen = {
      hook: "Unlock daily wellness in under a minute!",
      visual_direction: {
        scene_style: "bright and vibrant",
        lighting: "natural daylight",
        background: "minimalist living room",
      },
      camera_instructions: {
        framing: "medium close-up on host",
        movement: "slow pan",
      },
      on_screen_text: ["Welcome", "Morning Stretch"],
    };
    expect(synthesizeVideoPromptFromPlan(gen).length).toBeGreaterThan(10);
    expect(extractVideoPromptText(gen as Record<string, unknown>, 10).length).toBeGreaterThanOrEqual(10);
  });

  it("synthesizes when visual_direction is a JSON string", () => {
    const gen = {
      hook: "Test hook long enough",
      visual_direction: JSON.stringify({
        scene_style: "cozy indoor",
        lighting: "soft",
        background: "bookshelf",
      }),
    };
    expect(extractVideoPromptText(gen as Record<string, unknown>, 10).length).toBeGreaterThanOrEqual(10);
  });

  it("extractSpokenScriptText reads spoken_script", () => {
    const gen = { spoken_script: "Hello world this is long enough for default min" };
    expect(extractSpokenScriptText(gen, 20)).toContain("Hello world");
  });

  it("extractSpokenScriptText joins dialogue lines when no spoken_script", () => {
    const gen = {
      dialogue: [
        { role: "narrator", line: "First line of narration here." },
        { role: "narrator", line: "Second line continues the voiceover script." },
      ],
    };
    expect(extractSpokenScriptText(gen as Record<string, unknown>, 20).length).toBeGreaterThanOrEqual(20);
  });
});
