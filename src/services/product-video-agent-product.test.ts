import { describe, expect, it } from "vitest";
import type { ProductProfileRow } from "../repositories/project-config.js";
import {
  buildProductProfileVideoAgentPromptBlock,
  buildProductProfileVideoAgentLines,
} from "./product-video-agent-product.js";

function minimalProduct(overrides: Partial<ProductProfileRow> = {}): ProductProfileRow {
  return {
    id: "p1",
    project_id: "proj",
    product_name: "Widget",
    product_category: "Tools",
    product_url: null,
    one_liner: "The fastest widget.",
    value_proposition: "Save hours weekly.",
    elevator_pitch: null,
    primary_audience: "Busy founders",
    audience_pain_points: "Too much manual work.",
    audience_desires: "Automation.",
    use_cases: "Morning standup prep. Weekly review. Launch checklist.",
    anti_audience: null,
    key_features: "Feature A does X. Feature B does Y. Feature C does Z.",
    key_benefits: "Cuts setup time in half.",
    differentiators: "Only widget with Z.",
    proof_points: "4.9 stars.",
    social_proof: "Used by 10k teams.",
    competitors: "BigCo",
    comparison_angles: "Simpler than BigCo.",
    pricing_summary: "$29/mo",
    current_offer: "2 months free",
    offer_urgency: "Ends Friday",
    guarantee: "30-day refund",
    primary_cta: "Try free",
    secondary_cta: "Book demo",
    do_say: null,
    dont_say: null,
    taglines: null,
    keywords: null,
    metadata_json: {},
    ...overrides,
  };
}

describe("buildProductProfileVideoAgentLines", () => {
  it("FEATURE angle focuses on one feature, not a feature list", () => {
    const lines = buildProductProfileVideoAgentLines(minimalProduct(), "FLOW_PRODUCT_FEATURE");
    const featLine = lines.find((l) => l.includes("Single feature focus"));
    expect(featLine).toBeTruthy();
    expect(featLine).not.toMatch(/Feature B/);
  });

  it("SOCIAL_PROOF angle prioritizes proof and audience reaction fields", () => {
    const lines = buildProductProfileVideoAgentLines(minimalProduct(), "FLOW_PRODUCT_SOCIAL_PROOF");
    const joined = lines.join("\n");
    expect(joined).toMatch(/Social proof:/);
    expect(joined).toMatch(/Proof points:/);
    expect(joined).toMatch(/Primary CTA:/);
  });
});

describe("buildProductProfileVideoAgentPromptBlock", () => {
  it("uses structured lines, not a raw metadata_json dump", () => {
    const block = buildProductProfileVideoAgentPromptBlock(
      minimalProduct({ metadata_json: { huge: "x".repeat(5000) } }),
      "FLOW_PRODUCT_USECASE"
    );
    expect(block).toBeTruthy();
    expect(block).toContain("PRODUCT FACTS / PRODUCT STORY");
    expect(block).not.toContain('"huge"');
    expect(block!.length).toBeLessThan(4000);
  });
});
