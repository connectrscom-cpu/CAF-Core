import { describe, expect, it } from "vitest";
import {
  CONTENT_ROUTE_LANES,
  defaultEnabledContentRouteIds,
  filterIdeaQuotasByEnabledLanes,
  flowTypesEnabledForLanes,
  ideaQuotasForEnabledLanes,
  isFlowTypeAllowedForContentRoutes,
  parseContentRouteLaneIdsFromText,
  patchCriteriaWithContentRoutes,
  readEnabledContentRouteIdsFromCriteria,
} from "./content-routes.js";
import { CANONICAL_FLOW_TYPES } from "./canonical-flow-types.js";
import { FLOW_VISUAL_FIRST_CAROUSEL } from "./visual-first-carousel-flow-types.js";
import { FLOW_TOP_PERFORMER_MIMIC_CAROUSEL } from "./top-performer-mimic-flow-types.js";

describe("content-routes", () => {
  it("lists marketer lanes without FLOW_IMG", () => {
    expect(CONTENT_ROUTE_LANES.length).toBeGreaterThan(8);
    for (const lane of CONTENT_ROUTE_LANES) {
      expect(lane.flow_types.every((ft) => !ft.startsWith("FLOW_IMG_"))).toBe(true);
    }
  });

  it("defaults enable niche + visual-first (+ any other default_enabled lanes)", () => {
    const ids = defaultEnabledContentRouteIds();
    expect(ids).toContain("niche_carousels");
    expect(ids).toContain("visual_first_carousels");
    expect(ids).toEqual(CONTENT_ROUTE_LANES.filter((l) => l.default_enabled).map((l) => l.id));
  });

  it("parses lane labels and ids from onboarding pack text", () => {
    expect(
      parseContentRouteLaneIdsFromText("Niche carousels; Brand visual carousels; why_mimic_carousels")
    ).toEqual(["niche_carousels", "visual_first_carousels", "why_mimic_carousels"]);
    expect(parseContentRouteLaneIdsFromText("Avatar video (script): Yes; LinkedIn posts: No")).toEqual([
      "avatar_video_script",
    ]);
  });

  it("enables FLOW_CAROUSEL when either niche or product carousel is on", () => {
    expect(flowTypesEnabledForLanes(["niche_carousels"]).has(CANONICAL_FLOW_TYPES.CAROUSEL)).toBe(
      true
    );
    expect(flowTypesEnabledForLanes(["product_carousels"]).has(CANONICAL_FLOW_TYPES.CAROUSEL)).toBe(
      true
    );
    expect(flowTypesEnabledForLanes(["visual_first_carousels"]).has(CANONICAL_FLOW_TYPES.CAROUSEL)).toBe(
      false
    );
    expect(
      flowTypesEnabledForLanes(["visual_first_carousels"]).has(FLOW_VISUAL_FIRST_CAROUSEL)
    ).toBe(true);
  });

  it("builds idea quotas only for enabled lane buckets", () => {
    const q = ideaQuotasForEnabledLanes(["niche_carousels", "visual_first_carousels"], 20);
    expect((q.buckets.niche_carousel_text ?? 0) + (q.buckets.niche_carousel_visual ?? 0)).toBeGreaterThan(
      0
    );
    expect(q.buckets.niche_video_script_avatar ?? 0).toBe(0);
    expect(q.buckets.product_video ?? 0).toBe(0);
  });

  it("filters existing quotas by lanes", () => {
    const filtered = filterIdeaQuotasByEnabledLanes(
      {
        buckets: { niche_carousel_text: 5, niche_video_script_avatar: 4 },
        product_angles_enabled: false,
      },
      ["niche_carousels"]
    );
    expect(filtered.buckets.niche_carousel_text).toBe(5);
    expect(filtered.buckets.niche_video_script_avatar).toBe(0);
  });

  it("allows unmanaged flow types", () => {
    expect(isFlowTypeAllowedForContentRoutes("FLOW_TEXT", [])).toBe(true);
    expect(
      isFlowTypeAllowedForContentRoutes(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, ["niche_carousels"])
    ).toBe(false);
  });

  it("patches criteria_json with routes + idea_generation", () => {
    const next = patchCriteriaWithContentRoutes({}, ["niche_carousels"], 10);
    expect(readEnabledContentRouteIdsFromCriteria(next)).toEqual(["niche_carousels"]);
    const ig = next.idea_generation as { buckets: Record<string, number> };
    expect(ig.buckets.niche_carousel_text).toBeGreaterThan(0);
  });
});
