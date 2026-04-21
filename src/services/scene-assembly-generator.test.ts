import { describe, expect, it } from "vitest";
import { normalizeSceneBundleScenes, splitScriptIntoSceneNarrationLines } from "./scene-assembly-generator.js";

describe("normalizeSceneBundleScenes", () => {
  it("keeps scenes[] when entries have video_prompt", () => {
    const out = normalizeSceneBundleScenes(
      {
        scenes: [{ scene_id: "a", order: 1, video_prompt: "one" }, { scene_id: "b", order: 2, video_prompt: "two" }],
      },
      {}
    );
    expect(out).toHaveLength(2);
    expect(out[0].video_prompt).toBe("one");
  });

  it("maps scene_prompt to video_prompt inside scenes[]", () => {
    const out = normalizeSceneBundleScenes(
      { scenes: [{ scene_id: "1", scene_prompt: "park at dawn" }] },
      {}
    );
    expect(out).toHaveLength(1);
    expect(out[0].video_prompt).toBe("park at dawn");
  });

  it("synthesizes one scene from flat scene_prompt when scenes[] is empty", () => {
    const out = normalizeSceneBundleScenes(
      {
        scenes: [],
        scene_prompt: "mirror bedroom",
        negative_prompt: "harsh",
        continuity_notes: "same wardrobe",
      },
      {}
    );
    expect(out).toHaveLength(1);
    expect(out[0].video_prompt).toBe("mirror bedroom");
    expect(out[0].negative_prompt).toBe("harsh");
    expect(out[0].continuity_notes).toBe("same wardrobe");
  });

  it("falls back to generated_output.scene_prompt when bundle has no prompt", () => {
    const out = normalizeSceneBundleScenes({ scenes: [] }, { scene_prompt: "from gen" });
    expect(out).toHaveLength(1);
    expect(out[0].video_prompt).toBe("from gen");
  });

  it("prefers bundle scene_prompt over gen when both exist", () => {
    const out = normalizeSceneBundleScenes({ scene_prompt: "bundle wins" }, { scene_prompt: "gen loses" });
    expect(out[0].video_prompt).toBe("bundle wins");
  });

  it("returns [] when nothing usable", () => {
    expect(normalizeSceneBundleScenes({ scenes: [] }, {})).toEqual([]);
  });

  it("keeps scenes that only have a public clip URL (post upstream render)", () => {
    const out = normalizeSceneBundleScenes(
      { scenes: [{ scene_id: "1", video_url: "https://cdn.example.com/a.mp4" }] },
      {}
    );
    expect(out).toHaveLength(1);
    expect(out[0].video_url).toBe("https://cdn.example.com/a.mp4");
  });
});

describe("splitScriptIntoSceneNarrationLines", () => {
  it("partitions by sentence when there are at least as many sentences as scenes", () => {
    const script = "First line here. Second beat goes. Third closes strong.";
    const lines = splitScriptIntoSceneNarrationLines(script, 3);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("First line here");
    expect(lines[1]).toContain("Second beat");
    expect(lines[2]).toContain("Third closes");
  });

  it("does not split a single sentence across scenes when three scenes and one sentence", () => {
    const lines = splitScriptIntoSceneNarrationLines("Only one sentence without breaks", 3);
    expect(lines).toHaveLength(3);
    expect(lines.filter(Boolean).join(" ")).toContain("Only one sentence");
  });
});
