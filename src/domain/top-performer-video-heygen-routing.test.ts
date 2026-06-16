import { describe, expect, it } from "vitest";
import { CANONICAL_FLOW_TYPES } from "./canonical-flow-types.js";
import {
  heygenLaneLabelForIntent,
  readTopPerformerVideoFormatPattern,
  resolveTopPerformerVideoHeygenRoute,
} from "./top-performer-video-heygen-routing.js";

describe("resolveTopPerformerVideoHeygenRoute", () => {
  it("maps talking_head to script avatar flow", () => {
    const route = resolveTopPerformerVideoHeygenRoute({ format_pattern: "talking_head" });
    expect(route.intent).toBe("script_avatar");
    expect(route.flow_type).toBe(CANONICAL_FLOW_TYPES.VID_SCRIPT);
  });

  it("maps b_roll to no-avatar flow", () => {
    const route = resolveTopPerformerVideoHeygenRoute({
      aesthetic_analysis_json: { format_pattern: "b_roll" },
    });
    expect(route.intent).toBe("no_avatar");
    expect(route.flow_type).toBe(CANONICAL_FLOW_TYPES.VID_PROMPT_NO_AVATAR);
  });

  it("maps product_demo to prompt avatar flow", () => {
    const route = resolveTopPerformerVideoHeygenRoute({ format_pattern: "product_demo" });
    expect(route.intent).toBe("prompt_avatar");
    expect(route.flow_type).toBe(CANONICAL_FLOW_TYPES.VID_PROMPT);
  });

  it("falls back to default intent when pattern unknown", () => {
    const route = resolveTopPerformerVideoHeygenRoute({ format_pattern: "unknown" }, "no_avatar");
    expect(route.intent).toBe("no_avatar");
    expect(route.flow_type).toBe(CANONICAL_FLOW_TYPES.VID_PROMPT_NO_AVATAR);
  });
});

describe("readTopPerformerVideoFormatPattern", () => {
  it("reads nested aesthetic format_pattern", () => {
    expect(
      readTopPerformerVideoFormatPattern({
        aesthetic_analysis_json: { format_pattern: "ugc" },
      })
    ).toBe("ugc");
  });
});

describe("heygenLaneLabelForIntent", () => {
  it("labels script avatar lane", () => {
    expect(heygenLaneLabelForIntent("script_avatar")).toContain("Script");
  });
});
