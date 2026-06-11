import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  composeMimicTextOverlayLabFromFixture,
  renderMimicTextOverlayLabHtml,
  type MimicTextOverlayLabFixture,
} from "./mimic-text-overlay-lab.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/mimic-text-overlay");

function loadFixture(name: string): MimicTextOverlayLabFixture {
  const raw = readFileSync(join(FIXTURE_DIR, name), "utf8");
  return JSON.parse(raw) as MimicTextOverlayLabFixture;
}

describe("mimic-text-overlay-lab", () => {
  it("maps LLM copy onto Nemotron+DocAI boxes from fixture (two-block-dark-slide)", () => {
    const composed = composeMimicTextOverlayLabFromFixture(loadFixture("two-block-dark-slide.json"));
    expect(composed.has_docai_layout).toBe(true);
    expect(composed.text_layers).toHaveLength(2);
    expect(composed.text_layers[0]?.text).toBe("Your Aries friend");
    expect(composed.text_layers[0]?.x_px).toBe(130);
    expect(composed.text_layers[0]?.y_px).toBe(243);
    expect(composed.text_layers[1]?.text).toContain("adventure");
    expect(composed.render_context.mimic_use_docai_layers).toBe(true);
    expect(composed.reference_blocks).toHaveLength(2);
    expect(composed.reference_blocks[0]?.text).toContain("ARIES");
  });

  it("prefers document_ai_ocr_v1 geometry over stale text_blocks (ocr-layers-priority)", () => {
    const composed = composeMimicTextOverlayLabFromFixture(loadFixture("ocr-layers-priority.json"));
    expect(composed.text_layers).toHaveLength(1);
    expect(composed.text_layers[0]?.x_px).toBe(108);
    expect(composed.text_layers[0]?.color_hex).toBe("#ffcc00");
    expect(composed.text_layers[0]?.text_align).toBe("center");
  });

  it("renders standalone HTML with docai layers and debug boxes", () => {
    const composed = composeMimicTextOverlayLabFromFixture(loadFixture("two-block-dark-slide.json"));
    const html = renderMimicTextOverlayLabHtml(composed, { description: "fixture test" });
    expect(html).toContain('class="mimic-docai-layer');
    expect(html).toContain("left:130px");
    expect(html).toContain("Your Aries friend");
    expect(html).toContain('class="ref-debug-box"');
    expect(html).toContain("fitDocAiTextLayersToBoxes");
    expect(html).toContain("1080px");
    expect(html).toContain("1350px");
  });

  it("uses blank paper background when no background_image_url", () => {
    const composed = composeMimicTextOverlayLabFromFixture(loadFixture("two-block-dark-slide.json"));
    const html = renderMimicTextOverlayLabHtml(composed);
    expect(html).not.toContain("background-image:url");
    expect(composed.render_context.background_image_url).toBeNull();
  });
});
