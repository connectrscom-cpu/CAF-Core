import { describe, expect, it } from "vitest";
import {
  buildProductBibleSlice,
  isProductBibleEnabledForCandidate,
  parseProductBibleV1,
  pickProductKeyFromCandidate,
} from "./product-bible-v1.js";
import { emptyProductBibleDraft, buildProductBibleSnapshot } from "./product-bible.js";

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
    const slice = buildProductBibleSlice(true, "mod", 2, snapshot);
    const parsed = parseProductBibleV1(slice);
    expect(parsed?.enabled).toBe(true);
    expect(parsed?.bible_version).toBe(2);
    expect(parsed?.product_key).toBe("mod");
    expect(parsed?.bible_snapshot?.products).toHaveLength(1);
  });
});
