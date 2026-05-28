import { describe, expect, it } from "vitest";
import { FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, FLOW_TOP_PERFORMER_MIMIC_IMAGE } from "../domain/top-performer-mimic-flow-types.js";
import {
  normalizeMimicReferenceItems,
  resolveMimicReferenceFromLineage,
} from "./mimic-reference-resolver.js";
import type { JobLineageResult } from "../repositories/job-lineage.js";

function lineageWithPack(entries: Record<string, unknown>[]): JobLineageResult {
  return {
    task_id: "t1",
    project_id: "p1",
    run_id: "RUN_test",
    signal_pack_id: "sp1",
    idea_id: "idea_1",
    candidate_id: "idea_1",
    candidate_data: {
      grounding_insight_ids: ["ins_c8b866cae1_22900_broad"],
    },
    run: null,
    signal_pack: {
      derived_globals_json: {
        visual_guidelines_pack_v1: { entries },
      },
    } as JobLineageResult["signal_pack"],
    idea: null,
    grounding: [],
  };
}

const carouselEntry = {
  insights_id: "ins_c8b866cae1_22927_cdeep",
  analysis_tier: "top_performer_carousel",
  source_evidence_row_id: "22927",
  inspection_media: {
    items: [
      {
        index: 1,
        role: "carousel_slide",
        vision_fetch_url: "https://example.com/slide_01.jpg",
        bucket: "assets",
        object_path: "assets/top_performer_inspection/slide_01.jpg",
      },
    ],
  },
};

describe("normalizeMimicReferenceItems", () => {
  it("reassigns duplicate and 0-based indexes to sequential 1..N", () => {
    const normalized = normalizeMimicReferenceItems([
      { index: 1, role: "carousel_slide", vision_fetch_url: "https://example.com/slide_01.jpg" },
      { index: 1, role: "carousel_slide", vision_fetch_url: "https://example.com/slide_02.jpg" },
      { index: 2, role: "carousel_slide", vision_fetch_url: "https://example.com/slide_03.jpg" },
    ]);
    expect(normalized.map((x) => x.index)).toEqual([1, 2, 3]);
    expect(normalized[0]?.vision_fetch_url).toContain("slide_01");
    expect(normalized[1]?.vision_fetch_url).toContain("slide_02");
    expect(normalized[2]?.vision_fetch_url).toContain("slide_03");
  });
});

describe("resolveMimicReferenceFromLineage", () => {
  it("falls back to single-frame top_performer_carousel when image mimic has no deep tier", () => {
    const resolved = resolveMimicReferenceFromLineage(
      FLOW_TOP_PERFORMER_MIMIC_IMAGE,
      lineageWithPack([carouselEntry]),
      { grounding_insight_ids: ["ins_c8b866cae1_22900_broad"] }
    );
    expect(resolved.analysis_tier).toBe("top_performer_carousel");
    expect(resolved.reference_tier_fallback).toBe(true);
    expect(resolved.reference_items[0]?.vision_fetch_url).toContain("slide_01.jpg");
  });

  it("does not fall back to multi-frame carousel for image mimic", () => {
    expect(() =>
      resolveMimicReferenceFromLineage(
        FLOW_TOP_PERFORMER_MIMIC_IMAGE,
        lineageWithPack([
          {
            ...carouselEntry,
            inspection_media: {
              items: [
                {
                  index: 1,
                  role: "carousel_slide",
                  vision_fetch_url: "https://example.com/slide_01.jpg",
                },
                {
                  index: 2,
                  role: "carousel_slide",
                  vision_fetch_url: "https://example.com/slide_02.jpg",
                },
              ],
            },
          },
        ]),
        { grounding_insight_ids: ["ins_c8b866cae1_22900_broad"] }
      )
    ).toThrow(/top_performer_deep/);
  });

  it("resolves carousel mimic from pack when idea is broad-grounded", () => {
    const resolved = resolveMimicReferenceFromLineage(
      FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
      lineageWithPack([carouselEntry]),
      { grounding_insight_ids: ["ins_c8b866cae1_22900_broad"] }
    );
    expect(resolved.analysis_tier).toBe("top_performer_carousel");
    expect(resolved.reference_items).toHaveLength(1);
  });

  it("throws a helpful error when no compatible tier exists", () => {
    expect(() =>
      resolveMimicReferenceFromLineage(
        FLOW_TOP_PERFORMER_MIMIC_IMAGE,
        lineageWithPack([]),
        { grounding_insight_ids: ["ins_c8b866cae1_22900_broad"] }
      )
    ).toThrow(/Pack has tiers: none/);
  });
});
