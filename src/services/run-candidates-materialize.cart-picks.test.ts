import { describe, expect, it } from "vitest";
import { plannerRowsFromCartIdeaPicks } from "./run-candidates-materialize.js";
import type { SignalPackRow } from "../repositories/signal-packs.js";

function mockPack(ideas: Record<string, unknown>[]): SignalPackRow {
  return {
    id: "pack-1",
    project_id: "proj-1",
    run_id: "712_MRIA25ST",
    ideas_json: ideas,
    jobs_json: ideas,
    overall_candidates_json: [],
    derived_globals_json: {},
  } as unknown as SignalPackRow;
}

describe("plannerRowsFromCartIdeaPicks", () => {
  const idea = (id: string, format: string, platform: string) => ({
    id,
    title: `Title ${id}`,
    three_liner: "Hook line one two three",
    thesis: "Thesis",
    who_for: "Home cooks",
    format,
    platform,
    why_now: "Trending",
    key_points: ["a", "b", "c"],
    novelty_angle: "Fresh",
    cta: "Try it",
    grounding_insight_ids: ["ci_1"],
    expected_outcome: "Engagement",
  });

  it("returns one stamped row per pick in cart order", () => {
    const pack = mockPack([
      idea("idea_712_MRIA25ST_19", "video", "Instagram"),
      idea("idea_712_MRIA25ST_1", "carousel", "Instagram"),
    ]);

    const rows = plannerRowsFromCartIdeaPicks(
      pack,
      [
        {
          idea_id: "idea_712_MRIA25ST_19",
          target_flow_type: "FLOW_VID_HOOK_FIRST",
          platform: "Instagram",
        },
        {
          idea_id: "idea_712_MRIA25ST_1",
          target_flow_type: "FLOW_CAROUSEL",
          platform: "Instagram",
          use_brand_visual_system: false,
        },
      ],
      "RUN_TEST"
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.target_flow_type).toBe("FLOW_VID_HOOK_FIRST");
    expect(rows[0]?.content_cart_pick).toBe(true);
    expect(rows[1]?.target_flow_type).toBe("FLOW_CAROUSEL");
    expect(rows[1]?.use_brand_visual_system).toBe(false);
  });

  it("resolves cart ids with extra idea_ prefix", () => {
    const pack = mockPack([idea("idea_712_MRIA25ST_9", "carousel", "Instagram")]);
    const rows = plannerRowsFromCartIdeaPicks(
      pack,
      [
        {
          idea_id: "idea_712_MRIA25ST_9",
          target_flow_type: "FLOW_VISUAL_FIRST_CAROUSEL",
          platform: "Instagram",
        },
      ],
      "RUN_TEST"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.target_flow_type).toBe("FLOW_VISUAL_FIRST_CAROUSEL");
  });

  it("throws when a pick cannot be resolved in the pack", () => {
    const pack = mockPack([idea("idea_712_MRIA25ST_1", "carousel", "Instagram")]);
    expect(() =>
      plannerRowsFromCartIdeaPicks(
        pack,
        [
          {
            idea_id: "idea_712_MRIA25ST_1",
            target_flow_type: "FLOW_CAROUSEL",
          },
          {
            idea_id: "idea_712_MRIA25ST_99",
            target_flow_type: "FLOW_CAROUSEL",
          },
        ],
        "RUN_TEST"
      )
    ).toThrow(/could not resolve/);
  });

  it("resolves ideas from ideas_json when jobs_json is a stale subset", () => {
    const pack = {
      id: "pack-1",
      project_id: "proj-1",
      run_id: "712_MRIA25ST",
      jobs_json: [idea("idea_712_MRIA25ST_19", "video", "Instagram")],
      ideas_json: [
        idea("idea_712_MRIA25ST_19", "video", "Instagram"),
        idea("idea_712_MRIA25ST_8", "carousel", "Facebook"),
      ],
      overall_candidates_json: [],
      derived_globals_json: {},
    } as unknown as SignalPackRow;

    const rows = plannerRowsFromCartIdeaPicks(
      pack,
      [
        {
          idea_id: "idea_712_MRIA25ST_19",
          target_flow_type: "FLOW_VID_HOOK_FIRST",
          platform: "Instagram",
        },
        {
          idea_id: "idea_712_MRIA25ST_8",
          target_flow_type: "FLOW_VISUAL_FIRST_CAROUSEL",
          platform: "Facebook",
        },
      ],
      "RUN_TEST"
    );

    expect(rows).toHaveLength(2);
    expect(rows[1]?.target_flow_type).toBe("FLOW_VISUAL_FIRST_CAROUSEL");
  });

  it("resolves loose pack rows that fail strict ideas_v2 array parse", () => {
    const pack = mockPack([
      {
        id: "idea_712_MRIA25ST_19",
        title: "The Secret to Meal Variety",
        format: "video",
        platform: "Instagram",
      },
      {
        id: "idea_712_MRIA25ST_8",
        title: "Healthy Comfort Food Reimagined",
        format: "carousel",
        platform: "Facebook",
      },
    ]);

    const rows = plannerRowsFromCartIdeaPicks(
      pack,
      [
        {
          idea_id: "idea_712_MRIA25ST_19",
          target_flow_type: "FLOW_VID_HOOK_FIRST",
          platform: "Instagram",
        },
        {
          idea_id: "idea_712_MRIA25ST_8",
          target_flow_type: "FLOW_VISUAL_FIRST_CAROUSEL",
          platform: "Facebook",
        },
      ],
      "RUN_TEST"
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.target_flow_type).toBe("FLOW_VID_HOOK_FIRST");
    expect(rows[1]?.target_flow_type).toBe("FLOW_VISUAL_FIRST_CAROUSEL");
    expect(rows[1]?.platform).toBe("Facebook");
  });
});
