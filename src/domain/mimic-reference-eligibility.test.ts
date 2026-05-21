import { describe, expect, it } from "vitest";
import {
  assertImageMimicSingleReference,
  assertMimicReferenceEligibleForFlow,
} from "./mimic-reference-eligibility.js";
import { FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, FLOW_TOP_PERFORMER_MIMIC_IMAGE } from "./top-performer-mimic-flow-types.js";

describe("mimic-reference-eligibility", () => {
  it("allows single-frame reference for image mimic", () => {
    expect(() =>
      assertImageMimicSingleReference([
        { index: 1, role: "reference", vision_fetch_url: "https://x/a.jpg" },
      ])
    ).not.toThrow();
  });

  it("rejects multi-frame reference for image mimic", () => {
    expect(() =>
      assertImageMimicSingleReference([
        { index: 1, role: "carousel_slide", vision_fetch_url: "https://x/1.jpg" },
        { index: 2, role: "carousel_slide", vision_fetch_url: "https://x/2.jpg" },
      ])
    ).toThrow(/FLOW_TOP_PERFORMER_MIMIC_CAROUSEL/);
  });

  it("skips carousel flow", () => {
    expect(() =>
      assertMimicReferenceEligibleForFlow(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, [
        { index: 1, role: "carousel_slide", vision_fetch_url: "https://x/1.jpg" },
        { index: 2, role: "carousel_slide", vision_fetch_url: "https://x/2.jpg" },
      ])
    ).not.toThrow();
  });

  it("guards image flow", () => {
    expect(() =>
      assertMimicReferenceEligibleForFlow(FLOW_TOP_PERFORMER_MIMIC_IMAGE, [
        { index: 1, role: "carousel_slide", vision_fetch_url: "https://x/1.jpg" },
        { index: 2, role: "carousel_slide", vision_fetch_url: "https://x/2.jpg" },
      ])
    ).toThrow(/multiple archived frames/i);
  });
});
