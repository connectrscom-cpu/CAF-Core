import { describe, expect, it } from "vitest";
import {
  contentPreviewMissing,
  contentPreviewReady,
  resolveEvidencePreview,
  resolveIdeaPreview,
  resolveQueueRowPreview,
} from "./preview-resolver";

describe("resolveEvidencePreview", () => {
  it("picks inspection_media carousel_slide over post permalink", () => {
    const preview = resolveEvidencePreview({
      kind: "inspection_media",
      media: {
        items: [
          { role: "thumbnail", public_url: "https://instagram.com/p/abc123/" },
          { role: "carousel_slide", public_url: "https://cdn.example.com/slide1.jpg" },
        ],
      },
    });
    expect(preview.status).toBe("ready");
    expect(preview.thumbnailUrl).toContain("cdn.example.com");
  });

  it("returns missing when no renderable URL", () => {
    const preview = resolveEvidencePreview({
      kind: "urls",
      urls: ["https://instagram.com/p/abc123/"],
    });
    expect(preview.status).toBe("missing");
  });
});

describe("resolveIdeaPreview", () => {
  it("uses first grounding insight thumbnail", () => {
    const map = new Map([["ins_1", "https://cdn.example.com/ref.jpg"]]);
    const preview = resolveIdeaPreview(
      { format: "carousel", targetFlowType: "FLOW_VISUAL_FIRST_CAROUSEL", evidenceBasis: ["ins_1"] },
      map
    );
    expect(preview.status).toBe("ready");
    expect(preview.kind).toBe("carousel");
  });

  it("returns explicit missing for visual formats without evidence thumb", () => {
    const preview = resolveIdeaPreview(
      { format: "video", targetFlowType: "FLOW_VIDEO", evidenceBasis: [] },
      new Map()
    );
    expect(preview.status).toBe("missing");
    expect(preview.kind).toBe("video");
  });
});

describe("resolveQueueRowPreview", () => {
  it("marks ready when preview_url present", () => {
    const preview = resolveQueueRowPreview({
      preview_url: "https://cdn.example.com/thumb.jpg",
      review_status: "IN_REVIEW",
    });
    expect(preview.status).toBe("ready");
  });

  it("never returns silent blank — missing is explicit", () => {
    const preview = resolveQueueRowPreview({ review_status: "IN_REVIEW" });
    expect(preview.status).toBe("missing");
    expect(preview.thumbnailUrl).toBeNull();
  });

  it("detects rendering pending without thumb", () => {
    const preview = resolveQueueRowPreview({ review_status: "RENDERING" });
    expect(preview.status).toBe("pending");
  });
});

describe("contentPreviewReady fallback", () => {
  it("empty URL is treated as missing", () => {
    expect(contentPreviewReady(" ").status).toBe("missing");
    expect(contentPreviewMissing().thumbnailUrl).toBeNull();
  });
});
