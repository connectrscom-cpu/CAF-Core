import { describe, expect, it } from "vitest";
import {
  buildBvsRenderPlanFromSnapshot,
  bvsTemplateBgUsesInventedPlates,
  bvsTextCarouselUsesBibleAssetPlates,
  enrichMimicWithBvsRenderPlan,
  parseBvsRenderPlan,
} from "./bvs-render-plan.js";
import type { BrandBibleSnapshotV1 } from "./brand-bible.js";

const snapshot: BrandBibleSnapshotV1 = {
  schema_version: "brand_bible_v1",
  visual_mode: "illustrated_cartoon",
  visual_mode_custom: null,
  palette: ["#1a1a2e", "#e94560"],
  allowed_motifs: ["stars"],
  forbidden_motifs: [],
  application_guide: {
    instructions: "Use cosmic motifs.",
    content_aims: [],
    mimic_policy: "Brand skin only.",
    original_policy: null,
  },
  asset_refs: [],
  heygen_presenters: [],
  flux_prompt_asset_ids: [],
  resolved_assets: [
    {
      asset_id: "frame-1",
      role: "slide_frame",
      label: "Cover frame",
      usage_notes: null,
      public_url: "https://cdn.example/frame.png",
      kind: "image",
    },
    {
      asset_id: "logo-1",
      role: "logo",
      label: "Logo",
      usage_notes: null,
      public_url: "https://cdn.example/logo.png",
      kind: "image",
    },
  ],
};

describe("bvs-render-plan", () => {
  it("builds invent plan with frame and logo", () => {
    const plan = buildBvsRenderPlanFromSnapshot(snapshot);
    expect(plan?.background_mode).toBe("invent");
    expect(plan?.frame?.asset_id).toBe("frame-1");
    expect(plan?.logo?.asset_id).toBe("logo-1");
    expect(plan?.palette).toEqual(["#1a1a2e", "#e94560"]);
  });

  it("detects BVS template_bg invented plates", () => {
    const mimic = enrichMimicWithBvsRenderPlan(
      {
        schema_version: 1,
        mode: "template_bg",
        classified_at: "",
        source_insights_id: "x",
        analysis_tier: "cdeep",
        reference_items: [{ index: 1, role: "ref", vision_fetch_url: "https://x" }],
        twist_brief: { visual_only: true, legal_note: "" },
      },
      snapshot
    );
    expect(bvsTemplateBgUsesInventedPlates(mimic)).toBe(true);
    expect(bvsTemplateBgUsesInventedPlates({ ...mimic, bvs_enabled: false })).toBe(false);
    expect(
      bvsTemplateBgUsesInventedPlates({
        ...mimic,
        execution_mode: "why_mimic",
      })
    ).toBe(false);
  });

  it("round-trips parseBvsRenderPlan", () => {
    const built = buildBvsRenderPlanFromSnapshot(snapshot)!;
    const parsed = parseBvsRenderPlan(built);
    expect(parsed?.frame?.asset_id).toBe("frame-1");
    expect(parsed?.logo?.position).toBe("br");
  });

  it("bvsTextCarouselUsesBibleAssetPlates respects background_mode", () => {
    expect(
      bvsTextCarouselUsesBibleAssetPlates({
        bvs_render_plan: {
          schema_version: "bvs_render_plan_v1",
          enabled: true,
          background_mode: "bible_asset",
          frame: null,
          logo: null,
          palette: [],
        },
      })
    ).toBe(true);
    expect(
      bvsTextCarouselUsesBibleAssetPlates({
        bvs_render_plan: {
          schema_version: "bvs_render_plan_v1",
          enabled: true,
          background_mode: "invent",
          frame: null,
          logo: null,
          palette: [],
        },
      })
    ).toBe(false);
  });
});
