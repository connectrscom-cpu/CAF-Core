import { describe, expect, it } from "vitest";
import { imageFilesFromClipboard } from "./clipboard-image-files";

describe("imageFilesFromClipboard", () => {
  it("returns empty for null clipboard", () => {
    expect(imageFilesFromClipboard(null)).toEqual([]);
  });

  it("extracts image items from clipboard", () => {
    const blob = new Blob(["x"], { type: "image/png" });
    const file = new File([blob], "image.png", { type: "image/png" });
    const dt = {
      items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
      files: [file],
    } as unknown as DataTransfer;
    const out = imageFilesFromClipboard(dt);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("image/png");
    expect(out[0]!.name).toMatch(/^screenshot-/);
  });
});
