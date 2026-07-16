/**
 * UGC video domain helpers.
 */
import { describe, expect, it } from "vitest";
import {
  extractUgcOnScreenHook,
  isUgcVideoFlow,
  normalizeUgcGeneratedOutput,
  ugcPayloadReady,
  ugcPreferProductPresenterPool,
} from "./ugc-video.js";

describe("isUgcVideoFlow", () => {
  it("matches FLOW_VID_UGC", () => {
    expect(isUgcVideoFlow("FLOW_VID_UGC")).toBe(true);
    expect(isUgcVideoFlow("FLOW_VID_SCRIPT")).toBe(false);
  });
});

describe("normalizeUgcGeneratedOutput", () => {
  it("fills spoken_script and on_screen_hook", () => {
    const out = normalizeUgcGeneratedOutput({
      script: "I almost threw away my meal plan until I tried this.",
      hook_line: "I could kiss whoever showed me this",
      setting_vibe: "car passenger seat selfie",
    });
    expect(out.spoken_script).toContain("meal plan");
    expect(out.on_screen_hook).toContain("kiss");
    expect(out.ugc_setting).toContain("car");
    expect(ugcPayloadReady(out)).toBe(true);
  });
});

describe("ugcPreferProductPresenterPool", () => {
  it("prefers product pool for product lens", () => {
    expect(ugcPreferProductPresenterPool({ content_lens: "product" })).toBe(true);
    expect(ugcPreferProductPresenterPool({ content_lens: "niche" })).toBe(false);
  });
});

describe("extractUgcOnScreenHook", () => {
  it("reads on_screen_hook first", () => {
    expect(extractUgcOnScreenHook({ on_screen_hook: "Wait for it", hook_line: "other" })).toBe("Wait for it");
  });
});
