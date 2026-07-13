import { describe, expect, it } from "vitest";
import { readSignalPackIdeasUnion } from "./jobs-json-compat.js";

describe("readSignalPackIdeasUnion", () => {
  it("prefers ideas_json over a partial stale jobs_json", () => {
    const pack = {
      jobs_json: [
        { id: "idea_712_MRIA25ST_19", title: "Stale hook", format: "video", platform: "Instagram" },
        { id: "idea_712_MRIA25ST_18", title: "Stale hook 2", format: "video", platform: "Instagram" },
        { id: "idea_712_MRIA25ST_20", title: "Stale hook 3", format: "video", platform: "Instagram" },
      ],
      ideas_json: [
        { id: "idea_712_MRIA25ST_19", title: "The Secret to Meal Variety", format: "video", platform: "Instagram" },
        { id: "idea_712_MRIA25ST_18", title: "Dinner Time Dilemmas Solved", format: "video", platform: "Instagram" },
        { id: "idea_712_MRIA25ST_8", title: "Healthy Comfort Food", format: "carousel", platform: "Facebook" },
        { id: "idea_712_MRIA25ST_9", title: "Rotating Themed Dinner", format: "carousel", platform: "Instagram" },
      ],
    };

    const union = readSignalPackIdeasUnion(pack);
    expect(union.length).toBeGreaterThanOrEqual(4);
    expect(union.find((r) => r.id === "idea_712_MRIA25ST_8")?.title).toBe("Healthy Comfort Food");
    expect(union.find((r) => r.id === "idea_712_MRIA25ST_19")?.title).toBe("The Secret to Meal Variety");
    expect(union.find((r) => r.id === "idea_712_MRIA25ST_20")?.title).toBe("Stale hook 3");
  });
});
