import { describe, expect, it } from "vitest";
import { cartBvsOverrides, cartItemsToMaterializeBody } from "./cart-run-materialize";
import type { ContentCartItem } from "./types";

describe("cartBvsOverrides", () => {
  it("maps idea and mimic keys with default BVS on", () => {
    const items: ContentCartItem[] = [
      {
        id: "idea_abc",
        kind: "idea",
        title: "Idea",
        flowDestination: "Carousel",
        flowTypeRaw: "FLOW_CAROUSEL",
      },
      {
        id: "tp_ins1",
        kind: "top_performer",
        title: "TP",
        flowDestination: "Visual mimic",
        flowTypeRaw: "FLOW_TOP_PERFORMER_MIMIC_CAROUSEL",
        useBrandVisualSystem: false,
      },
    ];
    const overrides = cartBvsOverrides(items);
    expect(overrides).toEqual([
      { key: "abc", enabled: true },
      { key: "mimic:carousel:ins1", enabled: false },
    ]);
  });

  it("includes bvs_overrides in materialize body", () => {
    const body = cartItemsToMaterializeBody([
      {
        id: "idea_x",
        kind: "idea",
        title: "X",
        flowDestination: "Carousel",
        flowTypeRaw: "FLOW_CAROUSEL",
        useBrandVisualSystem: true,
      },
    ]);
    expect(body.bvs_overrides).toEqual([{ key: "x", enabled: true }]);
  });
});
