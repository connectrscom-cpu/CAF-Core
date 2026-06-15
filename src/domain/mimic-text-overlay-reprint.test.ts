import { describe, expect, it } from "vitest";
import {
  isReviewRetainStatusDuringTextOverlayReprint,
  isTextOverlayReprintInProgress,
  MIMIC_TEXT_OVERLAY_REPRINT_PHASE,
  textOverlayReprintSummary,
} from "./mimic-text-overlay-reprint.js";

describe("mimic-text-overlay-reprint", () => {
  it("retains IN_REVIEW and related queue statuses during text reprint", () => {
    expect(isReviewRetainStatusDuringTextOverlayReprint("IN_REVIEW")).toBe(true);
    expect(isReviewRetainStatusDuringTextOverlayReprint("READY_FOR_REVIEW")).toBe(true);
    expect(isReviewRetainStatusDuringTextOverlayReprint("GENERATED")).toBe(true);
    expect(isReviewRetainStatusDuringTextOverlayReprint("RENDERING")).toBe(false);
  });

  it("detects pending text overlay reprint from render_state", () => {
    expect(
      isTextOverlayReprintInProgress({
        phase: MIMIC_TEXT_OVERLAY_REPRINT_PHASE,
        status: "pending",
      })
    ).toBe(true);
    expect(
      textOverlayReprintSummary({
        phase: MIMIC_TEXT_OVERLAY_REPRINT_PHASE,
        status: "pending",
        requested_at: "2026-06-15T10:00:00.000Z",
        slide_indices: [1, 2],
      })
    ).toMatchObject({ active: true, failed: false, slide_indices: "1, 2" });
  });
});
