import { describe, expect, it } from "vitest";
import {
  applyLayoutQaPatchesToOverrides,
  detectBoxCollisions,
  detectDuplicateLayers,
  detectMarginViolations,
  detectMissingText,
  detectSubjectOverlap,
  layoutBoxFromLayer,
  proposeLayoutNudgePatches,
  scoreLayoutFindings,
  slidePassesLayoutQa,
  visibleLayoutBoxes,
} from "./mimic-composite-layout-qa.js";
import {
  mimicDocAiLayerPositionKey,
  type MimicDocAiLayerPositionLayer,
} from "./mimic-docai-layer-positions.js";

function layer(partial: Partial<MimicDocAiLayerPositionLayer> & { text: string }): MimicDocAiLayerPositionLayer {
  return {
    role: "body",
    x_pct: 0.1,
    y_pct: 0.1,
    x_px: 96,
    y_px: 120,
    w_px: 400,
    h_px: 120,
    css_style: "left:96px;top:120px;width:400px;height:120px",
    layout_mode: "single_line",
    layout_class: "mimic-docai-layer--single-line",
    ...partial,
  };
}

describe("mimic-composite-layout-qa", () => {
  it("detects overlapping boxes as soft warnings", () => {
    const boxes = visibleLayoutBoxes([
      layer({ role: "headline", text: "Hook", x_px: 96, y_px: 100, w_px: 400, h_px: 100 }),
      layer({ role: "body", text: "Body", x_px: 96, y_px: 150, w_px: 400, h_px: 120 }),
    ]);
    const findings = detectBoxCollisions(boxes);
    expect(findings.some((f) => f.check === "collision")).toBe(true);
    expect(slidePassesLayoutQa(findings)).toBe(true);
  });

  it("detects margin overflow as soft warning", () => {
    const boxes = visibleLayoutBoxes([
      layer({ text: "Edge", x_px: 4, y_px: 4, w_px: 400, h_px: 80 }),
    ]);
    const findings = detectMarginViolations(boxes);
    expect(findings.length).toBeGreaterThan(0);
    expect(slidePassesLayoutQa(findings)).toBe(true);
  });

  it("detects center subject overlap", () => {
    const boxes = visibleLayoutBoxes([
      layer({
        role: "headline",
        text: "Centered",
        x_px: 400,
        y_px: 450,
        w_px: 280,
        h_px: 100,
      }),
    ]);
    expect(detectSubjectOverlap(boxes).length).toBeGreaterThan(0);
  });

  it("proposes nudge patches for collisions", () => {
    const a = layoutBoxFromLayer(
      layer({ role: "headline", text: "A", x_px: 96, y_px: 200, w_px: 400, h_px: 100 })
    );
    const b = layoutBoxFromLayer(
      layer({ role: "body", text: "B", x_px: 96, y_px: 240, w_px: 400, h_px: 120 })
    );
    const findings = detectBoxCollisions([a, b]);
    const patches = proposeLayoutNudgePatches([a, b], findings);
    expect(patches.length).toBeGreaterThan(0);
    expect(patches[0]!.y_px).toBeGreaterThan(b.y_px);
  });

  it("detects missing copy only when layout boxes are empty", () => {
    const boxes = visibleLayoutBoxes([layer({ role: "body", text: "Only body here", x_px: 96, y_px: 900 })]);
    const findings = detectMissingText(boxes, { headline: "Unique hook phrase", body: "Only body here" });
    expect(findings.length).toBe(0);

    const empty = detectMissingText([], { headline: "Unique hook phrase", body: "Body copy here" });
    expect(empty.some((f) => f.check === "missing_text")).toBe(true);
    expect(slidePassesLayoutQa(empty)).toBe(false);
  });

  it("flags duplicate layers at same ref position", () => {
    const boxes = visibleLayoutBoxes([
      layer({ role: "body", text: "One", x_px: 96, y_px: 200 }),
      layer({ role: "body", text: "Two", x_px: 96, y_px: 200 }),
    ]);
    expect(detectDuplicateLayers(boxes).length).toBeGreaterThan(0);
  });

  it("applyLayoutQaPatchesToOverrides updates positions", () => {
    const base = [layer({ role: "headline", text: "Hook", x_px: 96, y_px: 200 })];
    const key = mimicDocAiLayerPositionKey(base[0]!);
    const patches = [{ layer_key: key, x_px: 120, y_px: 880, fix_reason: "margin" as const }];
    const out = applyLayoutQaPatchesToOverrides(base, null, patches);
    expect(out[0]?.y_px).toBe(880);
  });

  it("slidePassesLayoutQa rejects hard failures only", () => {
    const soft = detectMarginViolations(
      visibleLayoutBoxes([layer({ text: "x", x_px: 4, y_px: 4 })])
    );
    expect(slidePassesLayoutQa(soft)).toBe(true);

    const hard = detectMissingText([], { headline: "Hook line", body: "Body copy" });
    expect(slidePassesLayoutQa(hard)).toBe(false);
    expect(scoreLayoutFindings(hard)).toBeLessThan(0.8);
  });
});
