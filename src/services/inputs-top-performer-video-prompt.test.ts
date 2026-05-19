import { describe, expect, it } from "vitest";
import { buildVideoAestheticAnalysisJson, parseTopPerformerVideoRiskFlags } from "./inputs-top-performer-video-prompt.js";

describe("buildVideoAestheticAnalysisJson", () => {
  it("keeps frames and replication_blueprint", () => {
    const aesthetic = buildVideoAestheticAnalysisJson({
      hook_visual: "bold opener",
      video_as_whole_summary: "summary",
      frames: [{ frame_index: 1, timestamp_sec: 0 }],
      replication_blueprint: { steps_to_remake: ["step 1"] },
      risk_flags: ["none"],
    });
    expect(aesthetic.frames).toHaveLength(1);
    expect(aesthetic.replication_blueprint).toEqual({ steps_to_remake: ["step 1"] });
    expect(aesthetic.style_summary).toBe("summary");
  });
});

describe("parseTopPerformerVideoRiskFlags", () => {
  it("filters placeholder risks", () => {
    expect(parseTopPerformerVideoRiskFlags(["none", "medical claim"])).toEqual(["medical claim"]);
  });
});
