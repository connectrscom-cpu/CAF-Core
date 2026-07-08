import { describe, expect, it } from "vitest";
import { carouselMediaItemsFromPreviewRows, type TaskAssetPreview } from "./media-url";

describe("carouselMediaItemsFromPreviewRows", () => {
  it("indexes by asset position so slide N maps to position N-1", () => {
    const rows: TaskAssetPreview[] = [
      { position: 2, public_url: "https://cdn/slide-3.png", kind: "image" },
      { position: 0, public_url: "https://cdn/slide-1.png", kind: "image" },
      { position: 1, public_url: "https://cdn/slide-2.png", kind: "image" },
    ];
    const items = carouselMediaItemsFromPreviewRows(rows);
    expect(items).toHaveLength(3);
    expect(items[0]?.url).toBe("https://cdn/slide-1.png");
    expect(items[1]?.url).toBe("https://cdn/slide-2.png");
    expect(items[2]?.url).toBe("https://cdn/slide-3.png");
  });

  it("leaves null holes for missing positions", () => {
    const rows: TaskAssetPreview[] = [
      { position: 0, public_url: "https://cdn/slide-1.png", kind: "image" },
      { position: 2, public_url: "https://cdn/slide-3.png", kind: "image" },
    ];
    const items = carouselMediaItemsFromPreviewRows(rows);
    expect(items).toHaveLength(3);
    expect(items[1]).toBeNull();
  });
});
