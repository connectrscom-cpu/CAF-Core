import { describe, expect, it } from "vitest";
import {
  pickFromCarouselTemplatePool,
  type CarouselTemplatePoolEntry,
} from "./carousel-template-pool.js";

describe("carousel-template-pool", () => {
  it("picks deterministically from mixed hbs + composite pool", () => {
    const pool: CarouselTemplatePoolEntry[] = [
      { kind: "hbs", pool_id: "carousel_a", hbs_base: "carousel_a" },
      { kind: "composite", pool_id: "composite:mimic_x", composite: { template_key: "mimic_x" } as never },
      { kind: "hbs", pool_id: "carousel_b", hbs_base: "carousel_b" },
    ];
    const a = pickFromCarouselTemplatePool(pool, "SNS_2026W09__Instagram__FLOW_CAROUSEL__row0001__v1");
    const b = pickFromCarouselTemplatePool(pool, "SNS_2026W09__Instagram__FLOW_CAROUSEL__row0001__v1");
    expect(a).toBe(b);
    expect(a?.kind).toBeDefined();
  });

  it("returns null for empty pool", () => {
    expect(pickFromCarouselTemplatePool([], "seed")).toBeNull();
  });
});
