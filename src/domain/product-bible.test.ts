import { describe, expect, it } from "vitest";
import {
  buildProductBibleSnapshot,
  buildProductBibleVideoAgentPromptBlock,
  emptyProductBibleDraft,
  filterProductBibleSnapshotByKey,
  parseProductBible,
  resolveHeygenProductReferenceAssets,
} from "./product-bible.js";
import type { ProjectBrandAssetRow } from "../repositories/project-config.js";

function asset(id: string, url: string): ProjectBrandAssetRow {
  return {
    id,
    project_id: "p1",
    kind: "reference_image",
    label: `Asset ${id}`,
    public_url: url,
    storage_path: `brand-kit/cuisina/${id}.png`,
    heygen_asset_id: null,
    heygen_synced_at: null,
    metadata_json: {},
    created_at: "",
    updated_at: "",
  };
}

describe("parseProductBible", () => {
  it("returns null for empty input", () => {
    expect(parseProductBible(null)).toBeNull();
    expect(parseProductBible({})).toBeNull();
  });

  it("parses modules, features, and asset refs", () => {
    const parsed = parseProductBible({
      schema_version: "product_bible_v1",
      application_guide: { instructions: "Show real UI" },
      products: [
        {
          key: "Weekly Plan",
          label: "Weekly Meal Plan",
          one_liner: "Plan your week",
          features: [
            {
              key: "recipe_detail",
              label: "Recipe detail",
              asset_refs: [{ asset_id: "a1", role: "ui_screen" }],
            },
          ],
          asset_refs: [{ asset_id: "a2", role: "workflow_step", step_order: 1 }],
        },
      ],
    });
    expect(parsed?.products).toHaveLength(1);
    expect(parsed?.products[0]?.key).toBe("weekly_plan");
    expect(parsed?.products[0]?.features[0]?.key).toBe("recipe_detail");
    expect(parsed?.products[0]?.asset_refs[0]?.step_order).toBe(1);
  });
});

describe("buildProductBibleSnapshot", () => {
  it("resolves asset URLs from brand kit rows", () => {
    const bible = parseProductBible({
      products: [
        {
          key: "grocery_list",
          label: "Grocery List",
          asset_refs: [{ asset_id: "a1", role: "screenshot" }],
        },
      ],
    })!;
    const snapshot = buildProductBibleSnapshot(bible, [asset("a1", "https://cdn.example/a1.png")]);
    expect(snapshot.resolved_assets).toHaveLength(1);
    expect(snapshot.resolved_assets[0]?.public_url).toBe("https://cdn.example/a1.png");
    expect(snapshot.resolved_assets[0]?.product_key).toBe("grocery_list");
  });
});

describe("filterProductBibleSnapshotByKey", () => {
  it("keeps one module and its assets", () => {
    const draft = emptyProductBibleDraft();
    draft.products = [
      {
        key: "mod_a",
        label: "A",
        description: null,
        one_liner: null,
        features: [],
        asset_refs: [{ asset_id: "a1", role: "screenshot", label: null, usage_notes: null, step_order: null }],
      },
      {
        key: "mod_b",
        label: "B",
        description: null,
        one_liner: null,
        features: [],
        asset_refs: [{ asset_id: "a2", role: "screenshot", label: null, usage_notes: null, step_order: null }],
      },
    ];
    const snapshot = buildProductBibleSnapshot(draft, [
      asset("a1", "https://a1"),
      asset("a2", "https://a2"),
    ]);
    const filtered = filterProductBibleSnapshotByKey(snapshot, "mod_a");
    expect(filtered.products).toHaveLength(1);
    expect(filtered.products[0]?.key).toBe("mod_a");
    expect(filtered.resolved_assets.map((a) => a.asset_id)).toEqual(["a1"]);
  });
});

describe("resolveHeygenProductReferenceAssets", () => {
  it("orders workflow_step refs before other roles", () => {
    const draft = emptyProductBibleDraft();
    draft.products = [
      {
        key: "how_it_works",
        label: "How it works",
        description: null,
        one_liner: null,
        features: [],
        asset_refs: [
          { asset_id: "hero", role: "hero_shot", label: null, usage_notes: null, step_order: null },
          { asset_id: "s2", role: "workflow_step", label: null, usage_notes: null, step_order: 2 },
          { asset_id: "s1", role: "workflow_step", label: null, usage_notes: null, step_order: 1 },
        ],
      },
    ];
    const snapshot = buildProductBibleSnapshot(draft, [
      asset("hero", "https://hero"),
      asset("s1", "https://s1"),
      asset("s2", "https://s2"),
    ]);
    const refs = resolveHeygenProductReferenceAssets(snapshot);
    expect(refs.map((r) => r.asset_id)).toEqual(["s1", "s2", "hero"]);
  });
});

describe("buildProductBibleVideoAgentPromptBlock", () => {
  it("includes module labels and screenshot hint", () => {
    const draft = emptyProductBibleDraft();
    draft.application_guide.instructions = "Use real app screenshots";
    draft.products = [
      {
        key: "meal_plan",
        label: "Meal Plan",
        description: "Weekly planner view",
        one_liner: "Plan meals fast",
        features: [{ key: "recipes", label: "Recipes", description: "Browse recipes", asset_refs: [] }],
        asset_refs: [{ asset_id: "a1", role: "screenshot", label: "Plan view", usage_notes: null, step_order: null }],
      },
    ];
    const snapshot = buildProductBibleSnapshot(draft, [asset("a1", "https://a1")]);
    const block = buildProductBibleVideoAgentPromptBlock(snapshot);
    expect(block).toContain("Product bible");
    expect(block).toContain("Meal Plan");
    expect(block).toContain("Attached screenshots");
  });
});
