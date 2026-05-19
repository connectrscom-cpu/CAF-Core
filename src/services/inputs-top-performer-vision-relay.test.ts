import { describe, expect, it } from "vitest";
import { isOpenAiDirectFetchableImageUrl, shouldRelayImageUrlForOpenAi } from "./inputs-top-performer-vision-relay.js";

describe("inputs-top-performer-vision-relay", () => {
  it("flags Instagram CDN URLs for relay", () => {
    const ig =
      "https://scontent-lax7-1.cdninstagram.com/v/t51.82787-15/683874357_18452782261112293_4904324466257824806_n.jpg";
    expect(isOpenAiDirectFetchableImageUrl(ig)).toBe(false);
    expect(shouldRelayImageUrlForOpenAi(ig)).toBe(true);
  });

  it("allows data URLs and signed storage URLs", () => {
    expect(isOpenAiDirectFetchableImageUrl("data:image/jpeg;base64,abc")).toBe(true);
    expect(
      isOpenAiDirectFetchableImageUrl(
        "https://xyz.supabase.co/storage/v1/object/sign/assets/foo.jpg?token=abc"
      )
    ).toBe(true);
  });
});
