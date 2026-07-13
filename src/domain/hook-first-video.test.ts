import { describe, expect, it } from "vitest";
import {
  clampHookClipDurationSec,
  extractHookScenePrompt,
  hookFirstBodyFlowType,
  hookFirstPayloadReady,
  isHookFirstVideoFlow,
  normalizeHookFirstGeneratedOutput,
  resolveHookClipProvider,
  resolveHookFirstBodyLane,
} from "./hook-first-video.js";
import { CANONICAL_FLOW_TYPES } from "./canonical-flow-types.js";

describe("hook-first-video", () => {
  it("detects hook-first flow type", () => {
    expect(isHookFirstVideoFlow("FLOW_VID_HOOK_FIRST")).toBe(true);
    expect(isHookFirstVideoFlow("Video_Hook_First")).toBe(true);
    expect(isHookFirstVideoFlow("FLOW_VID_SCRIPT")).toBe(false);
  });

  it("resolves body lane aliases", () => {
    expect(resolveHookFirstBodyLane("script_avatar")).toBe("script_avatar");
    expect(resolveHookFirstBodyLane("prompt")).toBe("prompt_avatar");
    expect(resolveHookFirstBodyLane("no_avatar")).toBe("no_avatar");
    expect(resolveHookFirstBodyLane(undefined)).toBe("script_avatar");
  });

  it("maps body lane to canonical HeyGen flow types", () => {
    expect(hookFirstBodyFlowType("script_avatar")).toBe(CANONICAL_FLOW_TYPES.VID_SCRIPT);
    expect(hookFirstBodyFlowType("prompt_avatar")).toBe(CANONICAL_FLOW_TYPES.VID_PROMPT);
    expect(hookFirstBodyFlowType("no_avatar")).toBe(CANONICAL_FLOW_TYPES.VID_PROMPT_NO_AVATAR);
  });

  it("extracts hook scene prompt from dedicated field or hook line", () => {
    expect(
      extractHookScenePrompt({
        hook_scene_prompt: "Extreme close-up: eyes widen as fridge opens to rainbow meal prep containers",
      })
    ).toContain("eyes widen");
    expect(extractHookScenePrompt({ hook_line: "Your brain rewires when you meal prep" })).toContain("meal prep");
  });

  it("knows when payload is render-ready", () => {
    expect(
      hookFirstPayloadReady({
        hook_scene_prompt: "Cinematic shock reaction in a modern kitchen, handheld urgency",
        spoken_script: "And that is exactly why meal prep changes everything for busy parents.",
      })
    ).toBe(true);
    expect(
      hookFirstPayloadReady({
        hook_line: "Families are finally winning the battle with dinner chaos.",
        dialogue: [
          {
            line: "If your evenings feel like a dinner disaster zone, you are not alone. Cuisina helps with personalized meal plans.",
            role: "narrator",
          },
        ],
      })
    ).toBe(true);
    expect(hookFirstPayloadReady({ hook_line: "short" })).toBe(false);
  });

  it("normalizes heygen dialogue into spoken_script and hook_scene_prompt", () => {
    const out = normalizeHookFirstGeneratedOutput({
      hook_line: "Families are finally winning the battle with dinner chaos.",
      dialogue: [{ line: "Long enough spoken body copy for the HeyGen segment after the hook.", role: "narrator" }],
    });
    expect(String(out.hook_scene_prompt ?? "")).toContain("dinner chaos");
    expect(String(out.spoken_script ?? "")).toContain("HeyGen segment");
  });

  it("defaults hook clip provider to heygen", () => {
    expect(resolveHookClipProvider({ HOOK_FIRST_CLIP_PROVIDER: "heygen" })).toBe("heygen");
    expect(resolveHookClipProvider({ HOOK_FIRST_CLIP_PROVIDER: "sora" })).toBe("sora");
  });

  it("clamps hook duration to 4–8 seconds", () => {
    expect(clampHookClipDurationSec(3)).toBe(4);
    expect(clampHookClipDurationSec(6)).toBe(6);
    expect(clampHookClipDurationSec(12)).toBe(8);
    expect(clampHookClipDurationSec(undefined, 7)).toBe(7);
  });
});
