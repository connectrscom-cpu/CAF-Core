import { describe, expect, it } from "vitest";
import {
  assertMimicCopyDiffersFromReference,
  copyTooSimilarToReference,
  extractImageMimicCopyFields,
} from "./mimic-copy-guard.js";

describe("mimic-copy-guard", () => {
  it("detects near-verbatim overlap with reference hook", () => {
    const ref =
      "Tonight's energy is helping many of us see our lives more clearly. What once felt easy to carry may suddenly feel heavier.";
    const gen =
      "Tonight's energy is helping many of us see our lives more clearly. What once felt easy to carry may feel heavier while we grow.";
    expect(copyTooSimilarToReference(gen, [ref])).toBe(true);
  });

  it("passes clearly refreshed brand copy", () => {
    const ref = "New Moon in Taurus invites slow intentional change through daily habits.";
    const gen =
      "Your sign holds a quiet strength this week — notice where patience turns into progress, not pressure.";
    expect(copyTooSimilarToReference(gen, [ref])).toBe(false);
  });

  it("extracts on-image copy from cover and hook fields", () => {
    const { on_image_copy } = extractImageMimicCopyFields({
      hook_text: "Your cosmic reset starts now",
      cover: { cover_title: "Taurus season clarity", cover_subtitle: "One small habit at a time." },
    });
    expect(on_image_copy).toContain("Your cosmic reset starts now");
    expect(on_image_copy).toContain("Taurus season clarity");
  });

  it("throws when generated copy matches reference", () => {
    const hook =
      "Tonight's energy is helping many of us see our lives more clearly. What once felt easy to carry may suddenly feel heavier.";
    expect(() =>
      assertMimicCopyDiffersFromReference(
        {
          generated_output: {
            hook_text: hook,
            caption: "Fresh caption for SNS with new angle on self-awareness.",
          },
        },
        { hook_text_preview: hook }
      )
    ).toThrow(/too similar/i);
  });
});
