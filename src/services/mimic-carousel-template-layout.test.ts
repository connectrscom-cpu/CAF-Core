import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { MimicPayloadV1 } from "../domain/mimic-payload.js";
import {
  injectMimicBackgroundPlateSupport,
  pickMimicLayoutBaseTemplate,
} from "./mimic-carousel-template-layout.js";

const tplDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../services/renderer/templates");

function mimic(partial: Partial<MimicPayloadV1>): MimicPayloadV1 {
  return {
    schema_version: 1,
    mode: "template_bg",
    classified_at: "2026-01-01T00:00:00.000Z",
    source_insights_id: "ins_1",
    analysis_tier: "top_performer_carousel",
    reference_items: [{ index: 1, role: "carousel_slide", vision_fetch_url: "https://x/a.jpg" }],
    twist_brief: { visual_only: true, legal_note: "pattern only" },
    ...partial,
  };
}

describe("pickMimicLayoutBaseTemplate", () => {
  it("prefers numbered_system for listicle format when pinned", () => {
    const base = pickMimicLayoutBaseTemplate(
      mimic({
        visual_guideline: { format_pattern: "listicle", deck_visual_system: { repeated_template: "text blocks" } },
      }),
      ["carousel_sns_numbered_system.hbs", "carousel_notes_app_minimal.hbs"]
    );
    expect(base).toBe("carousel_sns_numbered_system");
  });

  it("prefers chat_story when deck cues match and template is pinned", () => {
    const base = pickMimicLayoutBaseTemplate(
      mimic({
        visual_guideline: { deck_visual_system: { overall_aesthetic: "dm chat thread bubbles" } },
      }),
      ["carousel_sns_chat_story"]
    );
    expect(base).toBe("carousel_sns_chat_story");
  });
});

describe("injectMimicBackgroundPlateSupport", () => {
  it("injects slide-bg layers into carousel_notes_app_minimal", async () => {
    const raw = await readFile(path.join(tplDir, "carousel_notes_app_minimal.hbs"), "utf8");
    const out = injectMimicBackgroundPlateSupport(raw);
    expect(out).toContain(".slide-bg");
    expect(out).toContain("{{{background_image_url}}}");
    expect(out).toContain("{{{../background_image_url}}}");
    expect(out).toMatch(/<div class="slide cover">\s*\n\s*\{\{#if background_image_url\}\}/);
  });

  it("injects slide-bg into carousel_sns_bold_text (frame layout)", async () => {
    const raw = await readFile(path.join(tplDir, "carousel_sns_bold_text.hbs"), "utf8");
    const out = injectMimicBackgroundPlateSupport(raw);
    expect(out).toContain(".slide > .frame");
    expect(out).toMatch(/<div class="slide">\s*\n\s*\{\{#if background_image_url\}\}/);
  });
});
