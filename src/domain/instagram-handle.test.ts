import { describe, expect, it } from "vitest";
import {
  collectInstagramHandlesFromText,
  resolveProjectInstagramHandle,
  stripLeadingInstagramHandle,
  substituteReferenceHandlesInText,
} from "./instagram-handle.js";

describe("instagram-handle", () => {
  it("stripLeadingInstagramHandle splits glued handle from body start", () => {
    const { remainder, handle } = stripLeadingInstagramHandle("@sistersvillageDeeply rooted", [
      "@sistersvillage",
    ]);
    expect(handle).toBe("@sistersvillage");
    expect(remainder).toBe("Deeply rooted");
  });

  it("collectInstagramHandlesFromText finds embedded handles", () => {
    expect(collectInstagramHandlesFromText("follow @foo_bar for more")).toEqual(["@foo_bar"]);
  });

  it("substituteReferenceHandlesInText swaps reference for project handle", () => {
    expect(substituteReferenceHandlesInText("hi @sistersvillage", ["@sistersvillage"], "@mybrand")).toBe(
      "hi @mybrand"
    );
  });

  it("resolveProjectInstagramHandle prefers payload then strategy then slug", () => {
    expect(
      resolveProjectInstagramHandle({
        generationPayload: { instagram_handle: "payload_ig" },
        strategyInstagramHandle: "strategy_ig",
        projectSlug: "slug_ig",
      })
    ).toBe("@payload_ig");
    expect(
      resolveProjectInstagramHandle({
        generationPayload: {},
        strategyInstagramHandle: "strategy_ig",
        projectSlug: "slug_ig",
      })
    ).toBe("@strategy_ig");
    expect(
      resolveProjectInstagramHandle({
        generationPayload: {},
        strategyInstagramHandle: null,
        projectSlug: "slug_ig",
      })
    ).toBe("@slug_ig");
  });
});
