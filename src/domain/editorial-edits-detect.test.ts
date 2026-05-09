import { describe, expect, it } from "vitest";
import { isReadyToPublishApproval, overridesImplyCopyEdit } from "./editorial-edits-detect.js";

describe("isReadyToPublishApproval", () => {
  it("returns true for empty overrides", () => {
    expect(isReadyToPublishApproval({})).toBe(true);
    expect(isReadyToPublishApproval(null)).toBe(true);
  });

  it("returns false when title override present", () => {
    expect(
      isReadyToPublishApproval({
        final_title_override: "Edited",
      })
    ).toBe(false);
  });

  it("returns false when structural payload present", () => {
    expect(
      isReadyToPublishApproval({
        custom_payload: { x: 1 },
      })
    ).toBe(false);
  });

  it("returns false when heygen_voice_id set", () => {
    expect(
      isReadyToPublishApproval({
        heygen_voice_id: "v1",
      })
    ).toBe(false);
  });
});

describe("overridesImplyCopyEdit", () => {
  it("detects rewrite_copy", () => {
    expect(overridesImplyCopyEdit({ rewrite_copy: true })).toBe(true);
    expect(overridesImplyCopyEdit({ rewrite_copy: false })).toBe(false);
  });
});
