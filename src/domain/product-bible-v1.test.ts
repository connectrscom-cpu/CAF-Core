import { describe, expect, it } from "vitest";
import {
  buildProductBibleSlice,
  buildProductEvidenceMentionCorpus,
  isProductBibleEnabledForCandidate,
  parseProductBibleV1,
  pickFeatureKeysFromCandidate,
  pickProductKeyFromCandidate,
  selectProductEvidenceForPayload,
} from "./product-bible-v1.js";
import { emptyProductBibleDraft, buildProductBibleSnapshot } from "./product-bible.js";
import type { ProjectBrandAssetRow } from "../repositories/project-config.js";

function asset(id: string, url: string): ProjectBrandAssetRow {
  return {
    id,
    project_id: "p1",
    kind: "reference_image",
    label: `Asset ${id}`,
    public_url: url,
    storage_path: `brand-kit/p/${id}.png`,
    heygen_asset_id: null,
    heygen_synced_at: null,
    metadata_json: {},
    created_at: "",
    updated_at: "",
  };
}

describe("isProductBibleEnabledForCandidate", () => {
  it("enables for explicit flag", () => {
    expect(isProductBibleEnabledForCandidate({ use_product_bible: true })).toBe(true);
  });

  it("enables for product content lens", () => {
    expect(isProductBibleEnabledForCandidate({ content_lens: "product" })).toBe(true);
  });

  it("enables for FLOW_PRODUCT_* flow type", () => {
    expect(
      isProductBibleEnabledForCandidate({}, { flowType: "FLOW_PRODUCT_FEATURE" })
    ).toBe(true);
  });
});

describe("pickProductKeyFromCandidate", () => {
  it("reads product_key and normalizes", () => {
    expect(pickProductKeyFromCandidate({ product_key: "Weekly Plan" })).toBe("weekly_plan");
    expect(pickProductKeyFromCandidate({ productModule: "Grocery List" })).toBe("grocery_list");
  });
});

describe("pickFeatureKeysFromCandidate", () => {
  it("reads single and multi feature keys", () => {
    expect(pickFeatureKeysFromCandidate({ feature_key: "Recipe Detail" })).toEqual(["recipe_detail"]);
    expect(pickFeatureKeysFromCandidate({ feature_keys: ["recipes", "grocery"] })).toEqual([
      "recipes",
      "grocery",
    ]);
  });
});

describe("buildProductEvidenceMentionCorpus", () => {
  it("joins candidate + generated output text", () => {
    const corpus = buildProductEvidenceMentionCorpus({
      candidateData: { title: "Recipes walkthrough", thesis: "Save time" },
      generatedOutput: { spoken_script: "Open the Recipes screen first." },
    });
    expect(corpus).toContain("Recipes walkthrough");
    expect(corpus).toContain("Open the Recipes screen first.");
  });
});

describe("selectProductEvidenceForPayload", () => {
  it("selects feature screenshots from payload snapshot + mention corpus", () => {
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
                label: null,
                usage_notes: null,
                step_order: null,
              },
            ],
          },
        ],
        asset_refs: [],
      },
    ];
    const snapshot = buildProductBibleSnapshot(draft, [asset("a1", "https://a1")]);
    const slice = buildProductBibleSlice(true, "meal_plan", 1, snapshot);
    const payload = {
      product_bible_v1: slice,
      candidate_data: { title: "Show Recipes", content_lens: "product" },
      generated_output: { spoken_script: "Here is Recipes in action." },
    };
    const { selection, assets } = selectProductEvidenceForPayload(payload);
    expect(selection.selection_mode).toBe("feature_match");
    expect(assets.map((a) => a.asset_id)).toEqual(["a1"]);
  });
});

describe("parseProductBibleV1", () => {
  it("parses job slice", () => {
    const draft = emptyProductBibleDraft();
    draft.products = [
      {
        key: "mod",
        label: "Mod",
        description: null,
        one_liner: null,
        features: [],
        asset_refs: [],
      },
    ];
    const snapshot = buildProductBibleSnapshot(draft, []);
    const slice = buildProductBibleSlice(true, "mod", 2, snapshot, { featureKeys: ["recipes"] });
    const parsed = parseProductBibleV1(slice);
    expect(parsed?.enabled).toBe(true);
    expect(parsed?.bible_version).toBe(2);
    expect(parsed?.product_key).toBe("mod");
    expect(parsed?.feature_keys).toEqual(["recipes"]);
    expect(parsed?.bible_snapshot?.products).toHaveLength(1);
  });
});
