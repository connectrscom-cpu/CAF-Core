import { describe, expect, it } from "vitest";
import {
  buildSignalPackIdeasForUi,
  carouselLaneLabel,
  formatTabLabel,
  ideaPickTabKey,
  isVisualFirstCarouselIdea,
} from "./signal-pack-ideas-ui.js";

describe("signal-pack-ideas-ui visual-first carousel", () => {
  it("detects visual_first carousel ideas", () => {
    expect(isVisualFirstCarouselIdea({ format: "carousel", carousel_style: "visual_first" })).toBe(true);
    expect(isVisualFirstCarouselIdea({ format: "carousel", execution_profile: "mixed" })).toBe(true);
    expect(isVisualFirstCarouselIdea({ format: "carousel", carousel_style: "text_heavy" })).toBe(false);
    expect(isVisualFirstCarouselIdea({ format: "video", carousel_style: "visual_first" })).toBe(false);
  });

  it("splits manual-pick tabs for visual-first vs text-heavy carousel", () => {
    expect(ideaPickTabKey({ format: "carousel", carousel_style: "visual_first" })).toBe("carousel_visual");
    expect(ideaPickTabKey({ format: "carousel", carousel_style: "text_heavy" })).toBe("carousel");
    expect(formatTabLabel("carousel_visual")).toBe("Carousel · visual-first");
    expect(formatTabLabel("carousel")).toBe("Carousel · text-heavy");
  });

  it("builds UI rows with lane metadata from ideas_json", () => {
    const rows = buildSignalPackIdeasForUi({
      ideas_json: [
        {
          id: "idea_a",
          title: "Visual deck",
          three_liner: "Hook",
          thesis: "T",
          who_for: "Fans",
          format: "carousel",
          platform: "Instagram",
          why_now: "Now",
          key_points: ["a", "b", "c"],
          novelty_angle: "N",
          cta: "Save",
          expected_outcome: "Saves",
          grounding_insight_ids: ["ins_1"],
          carousel_style: "visual_first",
        },
        {
          id: "idea_b",
          title: "Listicle",
          three_liner: "Hook",
          thesis: "T",
          who_for: "Fans",
          format: "carousel",
          platform: "Instagram",
          why_now: "Now",
          key_points: ["a", "b", "c"],
          novelty_angle: "N",
          cta: "Save",
          expected_outcome: "Saves",
          grounding_insight_ids: ["ins_2"],
          carousel_style: "text_heavy",
        },
      ],
    } as never);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.visual_first_carousel).toBe(true);
    expect(rows[0]?.carousel_lane_label).toBe("Visual-first");
    expect(carouselLaneLabel(rows[1]!)).toBe("Text-heavy");
  });
});
