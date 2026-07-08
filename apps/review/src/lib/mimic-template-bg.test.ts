import { describe, expect, it } from "vitest";
import {
  applyMimicTemplateBgFieldEdit,
  resolveMimicTemplateBgEditorFields,
} from "./mimic-template-bg";

describe("mimic-template-bg CTA copy editing", () => {
  const piscesParagraph =
    "Pisces mothers infuse the home with imagination, intuition, and compassion. Their nurturing is dream-like—stories, little rituals, and artistic play paint everyday life in vibrant hues.";

  it("keeps CTA title edits instead of reverting to extras.cta", () => {
    const slide = {
      index: 13,
      type: "cta" as const,
      headline: piscesParagraph,
      body: piscesParagraph,
      handle: "@signandsound",
      extras: { cta: "OLD CTA TITLE" },
    };
    const edited = applyMimicTemplateBgFieldEdit(slide, 14, 14, "headline", "Pisces: True Renewal");
    expect(edited.headline).toBe("Pisces: True Renewal");
    expect(edited.extras?.cta).toBe("Pisces: True Renewal");
    expect(edited.text_blocks?.find((b) => b.role === "headline")?.text).toBe("Pisces: True Renewal");
  });

  it("keeps CTA message edits without re-inverting the paragraph", () => {
    const slide = {
      index: 13,
      type: "cta" as const,
      headline: "Pisces: True Renewal",
      body: "Old body copy",
      handle: "@signandsound",
      extras: { cta: "Pisces: True Renewal" },
      text_blocks: [
        { role: "headline", text: "Pisces: True Renewal" },
        { role: "body", text: "Old body copy" },
        { role: "handle", text: "@signandsound" },
      ],
    };
    const edited = applyMimicTemplateBgFieldEdit(slide, 14, 14, "body", piscesParagraph);
    expect(edited.body).toBe(piscesParagraph);
    expect(edited.text_blocks?.find((b) => b.role === "body")?.text).toBe(piscesParagraph);
    expect(edited.headline).toBe("Pisces: True Renewal");
  });

  it("reads CTA fields from stable text_blocks after edit", () => {
    const slide = {
      index: 13,
      type: "cta" as const,
      headline: "Pisces: True Renewal",
      body: piscesParagraph,
      handle: "@signandsound",
      text_blocks: [
        { role: "headline", text: "Pisces: True Renewal" },
        { role: "body", text: piscesParagraph },
        { role: "handle", text: "@signandsound" },
      ],
    };
    const fields = resolveMimicTemplateBgEditorFields(slide, 14, 14);
    expect(fields.find((f) => f.key === "headline")?.text).toBe("Pisces: True Renewal");
    expect(fields.find((f) => f.key === "body")?.text).toBe(piscesParagraph);
  });
});
