import { describe, expect, it } from "vitest";
import {
  buildProductBibleSnapshot,
  buildProductBibleVideoAgentPromptBlock,
  emptyProductBibleDraft,
  filterProductBibleSnapshotByKey,
  parseProductBible,
  resolveHeygenProductReferenceAssets,
  selectProductBibleReferenceAssets,
  slimProductBibleForCreationPack,
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
  it("lists File N lines with feature scope matching attachment order", () => {
    const draft = emptyProductBibleDraft();
    draft.application_guide.instructions = "Use real app screenshots";
    draft.products = [
      {
        key: "meal_plan",
        label: "Meal Plan",
        description: "Weekly planner view",
        one_liner: "Plan meals fast",
        features: [
          {
            key: "recipes",
            label: "Recipes",
            description: "Browse recipes",
            asset_refs: [
              {
                asset_id: "a1",
                role: "feature_demo",
                label: "Recipe detail screen",
                usage_notes: "Show when talking about recipes",
                step_order: null,
              },
            ],
          },
        ],
        asset_refs: [
          {
            asset_id: "s1",
            role: "workflow_step",
            label: "Open weekly plan",
            usage_notes: null,
            step_order: 1,
          },
        ],
      },
    ];
    const snapshot = buildProductBibleSnapshot(draft, [
      asset("a1", "https://a1"),
      asset("s1", "https://s1"),
    ]);
    const refs = resolveHeygenProductReferenceAssets(snapshot);
    expect(refs.map((r) => r.asset_id)).toEqual(["s1", "a1"]);
    const block = buildProductBibleVideoAgentPromptBlock(snapshot, refs);
    expect(block).toContain("Product bible");
    expect(block).toContain("Meal Plan");
    expect(block).toContain("Uploaded product evidence files (2 attached as File 1–2");
    expect(block).toContain("File 1 [workflow step]: Open weekly plan — flow step 1");
    expect(block).toContain("File 2 [Recipes]: Recipe detail screen — Show when talking about recipes");
    expect(block).toContain("insert this real product UI");

    const offsetBlock = buildProductBibleVideoAgentPromptBlock(snapshot, refs, { fileIndexOffset: 3 });
    expect(offsetBlock).toContain("File 4–5");
    expect(offsetBlock).toContain("File 4 [workflow step]: Open weekly plan — flow step 1");
    expect(offsetBlock).toContain("File 5 [Recipes]: Recipe detail screen");
  });
});

describe("slimProductBibleForCreationPack", () => {
  it("exposes product_evidence_files with file_index aligned to HeyGen order", () => {
    const draft = emptyProductBibleDraft();
    draft.products = [
      {
        key: "meal_plan",
        label: "Meal Plan",
        description: null,
        one_liner: null,
        features: [],
        asset_refs: [
          {
            asset_id: "s2",
            role: "workflow_step",
            label: "Step two",
            usage_notes: null,
            step_order: 2,
          },
          {
            asset_id: "s1",
            role: "workflow_step",
            label: "Step one",
            usage_notes: null,
            step_order: 1,
          },
        ],
      },
    ];
    const snapshot = buildProductBibleSnapshot(draft, [
      asset("s1", "https://s1"),
      asset("s2", "https://s2"),
    ]);
    const slim = slimProductBibleForCreationPack(snapshot);
    expect(slim?.evidence_selection?.mode).toBe("full_fallback");
    expect(slim?.product_evidence_files).toEqual([
      {
        file_index: 1,
        role: "workflow_step",
        label: "Step one",
        usage_notes: null,
        step_order: 1,
        product_key: "meal_plan",
        feature_key: null,
        scope_label: "workflow step",
      },
      {
        file_index: 2,
        role: "workflow_step",
        label: "Step two",
        usage_notes: null,
        step_order: 2,
        product_key: "meal_plan",
        feature_key: null,
        scope_label: "workflow step",
      },
    ]);
  });

  it("slims to feature-matched evidence when selection is provided", () => {
    const draft = emptyProductBibleDraft();
    draft.products = [
      {
        key: "meal_plan",
        label: "Meal Plan",
        description: null,
        one_liner: null,
        features: [
          {
            key: "recipes",
            label: "Recipes",
            description: null,
            asset_refs: [
              {
                asset_id: "a1",
                role: "feature_demo",
                label: "Recipe screen",
                usage_notes: null,
                step_order: null,
              },
            ],
          },
        ],
        asset_refs: [
          {
            asset_id: "hero",
            role: "hero_shot",
            label: "Hero",
            usage_notes: null,
            step_order: null,
          },
        ],
      },
    ];
    const snapshot = buildProductBibleSnapshot(draft, [
      asset("a1", "https://a1"),
      asset("hero", "https://hero"),
    ]);
    const selection = selectProductBibleReferenceAssets(snapshot, {
      mentionText: "Show the Recipes feature in detail",
    });
    const slim = slimProductBibleForCreationPack(snapshot, { selection });
    expect(slim?.evidence_selection?.mode).toBe("feature_match");
    expect(slim?.product_evidence_files).toHaveLength(1);
    expect(slim?.product_evidence_files?.[0]?.feature_key).toBe("recipes");
  });
});

describe("selectProductBibleReferenceAssets", () => {
  function mealPlanSnapshot() {
    const draft = emptyProductBibleDraft();
    draft.products = [
      {
        key: "meal_plan",
        label: "Meal Plan",
        description: null,
        one_liner: "Plan meals fast",
        features: [
          {
            key: "recipes",
            label: "Recipes",
            description: "Browse recipes",
            asset_refs: [
              {
                asset_id: "feat",
                role: "feature_demo",
                label: "Recipe detail",
                usage_notes: null,
                step_order: null,
              },
            ],
          },
          {
            key: "grocery",
            label: "Grocery List",
            description: null,
            asset_refs: [
              {
                asset_id: "groc",
                role: "ui_screen",
                label: "Grocery UI",
                usage_notes: null,
                step_order: null,
              },
            ],
          },
        ],
        asset_refs: [
          {
            asset_id: "hero",
            role: "hero_shot",
            label: "App hero",
            usage_notes: null,
            step_order: null,
          },
        ],
      },
      {
        key: "other",
        label: "Other Module",
        description: null,
        one_liner: null,
        features: [],
        asset_refs: [
          {
            asset_id: "other1",
            role: "screenshot",
            label: "Other",
            usage_notes: null,
            step_order: null,
          },
        ],
      },
    ];
    return buildProductBibleSnapshot(draft, [
      asset("feat", "https://feat"),
      asset("groc", "https://groc"),
      asset("hero", "https://hero"),
      asset("other1", "https://other"),
    ]);
  }

  it("prefers feature-matched screenshots when the script mentions a feature", () => {
    const snapshot = mealPlanSnapshot();
    const selection = selectProductBibleReferenceAssets(snapshot, {
      mentionText: "Today we walk through Recipes and how to save a meal.",
    });
    expect(selection.selection_mode).toBe("feature_match");
    expect(selection.assets.map((a) => a.asset_id)).toEqual(["feat"]);
    expect(selection.matched_feature_keys).toContain("recipes");
  });

  it("falls back to product module assets when only the product is mentioned", () => {
    const snapshot = mealPlanSnapshot();
    const selection = selectProductBibleReferenceAssets(snapshot, {
      mentionText: "Introducing Meal Plan for busy parents.",
    });
    expect(selection.selection_mode).toBe("product_module");
    expect(selection.assets.map((a) => a.asset_id)).toEqual(["hero", "feat", "groc"]);
  });

  it("falls back to full ordered evidence when nothing matches", () => {
    const snapshot = mealPlanSnapshot();
    const selection = selectProductBibleReferenceAssets(snapshot, {
      mentionText: "Completely unrelated topic about hiking boots.",
    });
    expect(selection.selection_mode).toBe("full_fallback");
    expect(selection.assets.map((a) => a.asset_id)).toEqual(["hero", "feat", "groc", "other1"]);
  });

  it("honors explicit featureKeys and unions with mention matches", () => {
    const snapshot = mealPlanSnapshot();
    const selection = selectProductBibleReferenceAssets(snapshot, {
      featureKeys: ["grocery"],
      mentionText: "Recipes are amazing",
    });
    expect(selection.selection_mode).toBe("feature_match");
    expect(selection.assets.map((a) => a.asset_id).sort()).toEqual(["feat", "groc"]);
  });
});
