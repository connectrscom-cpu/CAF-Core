import { describe, expect, it } from "vitest";
import { resolveBvsOverlaysFromPlan } from "../services/bvs-render-overlays.js";
import { buildBvsRenderPlanFromSnapshot } from "../domain/bvs-render-plan.js";
import type { BrandBibleSnapshotV1 } from "../domain/brand-bible.js";
import type { AppConfig } from "../config.js";

const config = { PORT: 3847, CAF_PUBLIC_URL: "https://caf-core.fly.dev" } as AppConfig;

const snapshot: BrandBibleSnapshotV1 = {
  schema_version: "brand_bible_v1",
  visual_mode: null,
  visual_mode_custom: null,
  palette: [],
  allowed_motifs: [],
  forbidden_motifs: [],
  application_guide: {
    instructions: "",
    content_aims: [],
    mimic_policy: null,
    original_policy: null,
  },
  asset_refs: [],
  heygen_presenters: [],
  flux_prompt_asset_ids: [],
  resolved_assets: [
    {
      asset_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      role: "slide_frame",
      label: "Frame",
      usage_notes: null,
      public_url: null,
      kind: "image",
    },
  ],
};

describe("bvs-render-overlays", () => {
  it("resolves core file URLs when public_url missing", () => {
    const plan = buildBvsRenderPlanFromSnapshot(snapshot)!;
    const overlays = resolveBvsOverlaysFromPlan(config, "sns", plan, []);
    expect(overlays.frameOverlay?.url).toContain("/v1/projects/sns/brand-assets/");
    expect(overlays.frameOverlay?.url).toContain("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });
});
