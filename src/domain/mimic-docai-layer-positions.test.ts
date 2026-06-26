import { describe, expect, it } from "vitest";
import {
  applyMimicDocAiLayerPositionOverrides,
  coerceTemplateBgInspectOverrides,
  llmSlideCopyPatchFromDocAiOverrides,
  mimicDocAiLayerPositionKey,
  mimicDocAiLayerRefKey,
  parseMimicDocAiLayerPositionsBySlide,
  patchMimicDocAiLayerFontSize,
  patchMimicDocAiLayerPxPosition,
  patchMimicDocAiLayerSize,
  patchMimicDocAiLayerText,
  sanitizeTemplateBgDocAiOverridesForInspect,
} from "./mimic-docai-layer-positions.js";
import type { MimicDocAiLayerPositionLayer } from "./mimic-docai-layer-positions.js";

function sampleLayer(overrides: Partial<MimicDocAiLayerPositionLayer> = {}): MimicDocAiLayerPositionLayer {
  return {
    text: "gets playful when bored",
    role: "body",
    x_pct: 0.1,
    y_pct: 0.2,
    w_pct: 0.3,
    h_pct: 0.08,
    x_px: 100,
    y_px: 200,
    w_px: 320,
    h_px: 80,
    layout_mode: "multi_line",
    layout_class: "mimic-docai-layer--multi-line",
    font_size_px: 48,
    ref_font_size_px: 44,
    font_weight: null,
    color_hex: "#000",
    text_align: "left",
    css_style: "left:100px;top:200px;width:320px;height:80px;font-size:48px",
    ref_x: 0.1,
    ref_y: 0.2,
    ...overrides,
  };
}

describe("mimic-docai-layer-positions", () => {
  it("mimicDocAiLayerPositionKey is stable for role+ref+text", () => {
    const layer = sampleLayer();
    expect(mimicDocAiLayerPositionKey(layer)).toBe("body@100,200:gets playful when bored");
  });

  it("patchMimicDocAiLayerPxPosition updates css left/top", () => {
    const next = patchMimicDocAiLayerPxPosition(sampleLayer(), 48, 900);
    expect(next.x_px).toBe(48);
    expect(next.y_px).toBe(900);
    expect(next.css_style).toContain("left:48px");
    expect(next.css_style).toContain("top:900px");
  });

  it("applyMimicDocAiLayerPositionOverrides moves matching layers only", () => {
    const layers = [sampleLayer(), sampleLayer({ text: "other", role: "cta", ref_x: 0.5, ref_y: 0.9, x_px: 400, y_px: 1200 })];
    const key = mimicDocAiLayerPositionKey(layers[0]!);
    const out = applyMimicDocAiLayerPositionOverrides(layers, [{ layer_key: key, x_px: 32, y_px: 880 }]);
    expect(out[0]!.x_px).toBe(32);
    expect(out[0]!.y_px).toBe(880);
    expect(out[1]!.x_px).toBe(400);
  });

  it("applyMimicDocAiLayerPositionOverrides matches by ref key after text edit", () => {
    const layer = sampleLayer();
    const refKey = mimicDocAiLayerRefKey(layer);
    const out = applyMimicDocAiLayerPositionOverrides(
      [layer],
      [{ layer_key: `${refKey}:old copy`, x_px: 12, y_px: 34, text: "new copy", font_size_px: 62, box_locked: true }]
    );
    expect(out[0]!.x_px).toBe(12);
    expect(out[0]!.text).toBe("new copy");
    expect(out[0]!.font_size_px).toBe(62);
  });

  it("patchMimicDocAiLayerFontSize and patchMimicDocAiLayerText update layer fields", () => {
    const sized = patchMimicDocAiLayerFontSize(sampleLayer(), 72);
    expect(sized.font_size_px).toBe(72);
    expect(sized.css_style).toContain("font-size:72px");
    const edited = patchMimicDocAiLayerText(sampleLayer(), "  edited line  ");
    expect(edited.text).toBe("edited line");
  });

  it("patchMimicDocAiLayerSize updates css width/height", () => {
    const next = patchMimicDocAiLayerSize(sampleLayer(), 400, 120);
    expect(next.w_px).toBe(400);
    expect(next.h_px).toBe(120);
    expect(next.css_style).toContain("width:400px");
    expect(next.css_style).toContain("height:120px");
  });

  it("applyMimicDocAiLayerPositionOverrides applies box size when box_locked", () => {
    const layer = sampleLayer();
    const key = mimicDocAiLayerPositionKey(layer);
    const out = applyMimicDocAiLayerPositionOverrides(
      [layer],
      [{ layer_key: key, x_px: 100, y_px: 200, w_px: 280, h_px: 96, box_locked: true }]
    );
    expect(out[0]!.w_px).toBe(280);
    expect(out[0]!.h_px).toBe(96);
    expect(out[0]!.reviewer_box_locked).toBe(true);
    expect(out[0]!.skip_center_avoid).toBe(true);
  });

  it("applyMimicDocAiLayerPositionOverrides omits hidden layers on reprint", () => {
    const layer = sampleLayer();
    const extra = sampleLayer({ text: "duplicate phrase", ref_x: 0.5, ref_y: 0.5, x_px: 500, y_px: 600 });
    const key = mimicDocAiLayerPositionKey(extra);
    const out = applyMimicDocAiLayerPositionOverrides([layer, extra], [
      { layer_key: key, x_px: 500, y_px: 600, hidden: true },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe(layer.text);
  });

  it("llmSlideCopyPatchFromDocAiOverrides builds text_blocks from saved layout copy", () => {
    const patch = llmSlideCopyPatchFromDocAiOverrides([
      { layer_key: "body@0.1,0.2:old", x_px: 10, y_px: 20, text: "test 4" },
      { layer_key: "body@0.1,0.5:old2", x_px: 10, y_px: 80, text: "line two" },
    ]);
    expect(patch).toMatchObject({
      text_blocks: [
        { role: "body", text: "test 4" },
        { role: "body", text: "line two" },
      ],
      body: "test 4\nline two",
    });
  });

  it("applyMimicDocAiLayerPositionOverrides applies saved copy without box_locked on full-bleed reprint", () => {
    const layer = sampleLayer();
    const key = mimicDocAiLayerPositionKey(layer);
    const out = applyMimicDocAiLayerPositionOverrides(
      [layer],
      [{ layer_key: key, x_px: 12, y_px: 34, text: "test 4" }],
      { applySavedTextOnBaseLayers: true }
    );
    expect(out[0]?.text).toBe("test 4");
  });

  it("applyMimicDocAiLayerPositionOverrides does not lock box on position-only nudge", () => {
    const layer = sampleLayer();
    const key = mimicDocAiLayerPositionKey(layer);
    const out = applyMimicDocAiLayerPositionOverrides([layer], [{ layer_key: key, x_px: 64, y_px: 512 }]);
    expect(out[0]!.w_px).toBe(320);
    expect(out[0]!.h_px).toBe(80);
    expect(out[0]!.reviewer_box_locked).toBeUndefined();
    expect(out[0]!.skip_center_avoid).toBe(true);
  });

  it("applyMimicDocAiLayerPositionOverrides appends custom reviewer-added text boxes", () => {
    const layer = sampleLayer();
    const out = applyMimicDocAiLayerPositionOverrides([layer], [
      {
        layer_key: "custom@body@abc123",
        x_px: 220,
        y_px: 480,
        w_px: 300,
        h_px: 80,
        font_size_px: 64,
        text: "Extra line",
        box_locked: true,
      },
    ]);
    expect(out).toHaveLength(2);
    expect(out[1]?.text).toBe("Extra line");
    expect(out[1]?.x_px).toBe(220);
    expect(out[1]?.w_px).toBe(300);
  });

  it("parseMimicDocAiLayerPositionsBySlide preserves hidden reviewer deletions", () => {
    const layer = sampleLayer();
    const key = mimicDocAiLayerPositionKey(layer);
    const parsed = parseMimicDocAiLayerPositionsBySlide({
      "2": [{ layer_key: key, x_px: 100, y_px: 200, hidden: true }],
    });
    expect(parsed?.["2"]?.[0]?.hidden).toBe(true);
  });

  it("applyMimicDocAiLayerPositionOverrides can keep mapped copy when applySavedTextOnBaseLayers is false", () => {
    const layer = sampleLayer();
    const key = mimicDocAiLayerPositionKey(layer);
    const out = applyMimicDocAiLayerPositionOverrides(
      [layer],
      [{ layer_key: key, x_px: 12, y_px: 34, text: "@stalehandle", box_locked: true }],
      { applySavedTextOnBaseLayers: false }
    );
    expect(out[0]!.x_px).toBe(12);
    expect(out[0]!.text).toBe("gets playful when bored");
  });

  it("applyMimicDocAiLayerPositionOverrides omits hidden layers matched by ref key", () => {
    const layer = sampleLayer({ text: "THE ARIES MOTHER" });
    const refKey = mimicDocAiLayerRefKey(layer);
    const out = applyMimicDocAiLayerPositionOverrides([layer], [
      { layer_key: refKey, x_px: 100, y_px: 200, hidden: true },
    ]);
    expect(out).toHaveLength(0);
  });

  it("coerceTemplateBgInspectOverrides strips hidden markers for template_bg inspect", () => {
    const layer = sampleLayer({ text: "THE ARIES MOTHER" });
    const refKey = mimicDocAiLayerRefKey(layer);
    const coerced = coerceTemplateBgInspectOverrides([layer], [
      { layer_key: refKey, x_px: 100, y_px: 200, hidden: true },
    ]);
    expect(coerced.some((o) => o.hidden)).toBe(false);
    const visible = applyMimicDocAiLayerPositionOverrides([layer], coerced, {
      applySavedTextOnBaseLayers: false,
    });
    expect(visible).toHaveLength(1);
  });

  it("sanitizeTemplateBgDocAiOverridesForInspect drops placeholder custom layers and OCR text", () => {
    const layer = sampleLayer();
    const key = mimicDocAiLayerPositionKey(layer);
    const out = sanitizeTemplateBgDocAiOverridesForInspect([
      { layer_key: key, x_px: 10, y_px: 20, text: "@stale", box_locked: true },
      { layer_key: "custom@body@abc", x_px: 1, y_px: 2, text: "New text", box_locked: true },
      { layer_key: "custom@body@def", x_px: 3, y_px: 4, text: "Real custom", box_locked: true },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]?.text).toBeUndefined();
    expect(out[1]?.text).toBe("Real custom");
  });
});
