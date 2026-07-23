import { describe, expect, it } from "vitest";
import {
  buildRegistryFollowerLookup,
  mergeFollowerLookups,
} from "../domain/evidence-relative-performance.js";
import type { InputsSourceRow } from "../repositories/inputs-sources.js";
import {
  collectFollowerObservations,
  planSourceFollowerUpdates,
} from "./inputs-source-followers.js";
import { evaluatePreLlmRow } from "./inputs-pre-llm-rank.js";

function sourceRow(
  rowIndex: number,
  payload: Record<string, unknown>
): InputsSourceRow {
  return {
    id: `id-${rowIndex}`,
    project_id: "p1",
    source_tab: "igaccounts",
    row_index: rowIndex,
    enabled: true,
    payload_json: payload,
    created_at: "",
    updated_at: "",
  };
}

describe("inputs-source-followers", () => {
  it("collectFollowerObservations reads IG handle and followers", () => {
    const map = collectFollowerObservations("instagram_post", [
      { owner_username: "moonomens", followers_count: 120_000 },
      { owner_username: "other", followers_count: null },
    ]);
    expect(map.get("moonomens")).toBe(120_000);
    expect(map.has("other")).toBe(false);
  });

  it("planSourceFollowerUpdates matches by profile URL handle", () => {
    const observations = new Map([["moonomens", 250_000]]);
    const planned = planSourceFollowerUpdates(
      [
        sourceRow(0, {
          Name: "@moonomens",
          Link: "https://www.instagram.com/moonomens/",
          Platform: "Instagram",
        }),
        sourceRow(1, {
          Name: "other",
          Link: "https://www.instagram.com/other/",
          Followers: 99,
        }),
      ],
      observations
    );
    expect(planned.updates).toHaveLength(1);
    expect(planned.updates[0]!.followers).toBe(250_000);
    expect(planned.updates[0]!.row.row_index).toBe(0);
    expect(planned.unmatched_handles).toBe(0);
  });

  it("planSourceFollowerUpdates does not invent updates when observation missing", () => {
    const planned = planSourceFollowerUpdates(
      [
        sourceRow(0, {
          Name: "moonomens",
          Link: "https://www.instagram.com/moonomens/",
          Followers: 50_000,
        }),
      ],
      new Map()
    );
    expect(planned.updates).toHaveLength(0);
  });

  it("mergeFollowerLookups lets import overlay win over project sources", () => {
    const project = buildRegistryFollowerLookup([
      { Link: "https://www.instagram.com/astrobrand/", Followers: "10k" },
    ]);
    const imported = buildRegistryFollowerLookup([
      { Link: "https://www.instagram.com/astrobrand/", Followers: "50k" },
    ]);
    const merged = mergeFollowerLookups(project, imported);
    expect(merged.get("astrobrand")).toBe(50_000);
  });

  it("project source Followers enable relative scoring without per-post fields", () => {
    const projectLookup = buildRegistryFollowerLookup([
      { Link: "https://www.instagram.com/astrobrand/", Followers: "50,000" },
    ]);
    const criteria = {
      pre_llm: {
        enabled: true,
        relative_page_performance: true,
        kinds: {
          instagram_post: {
            min_score: 0,
            weights: { page_relative_engagement: 1 },
          },
        },
      },
    };
    const ev = evaluatePreLlmRow(
      "instagram_post",
      {
        account_handle: "astrobrand",
        like_count: 10_000,
        comment_count: 200,
        caption: "enough text here for gate",
      },
      criteria,
      { registryFollowerLookup: projectLookup }
    );
    expect(ev.pre_llm_breakdown.has_follower_baseline).toBe(1);
    expect(ev.pre_llm_breakdown.page_relative_engagement).toBeGreaterThan(0);
  });
});
