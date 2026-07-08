import { describe, expect, it } from "vitest";
import {
  heygenPoolJsonFromPresenters,
  parseAvatarLookItems,
  parseAvatarsV2Payload,
  parseVoicesPayload,
} from "./heygen-catalog.js";

describe("heygenPoolJsonFromPresenters", () => {
  it("builds avatar pool json", () => {
    const json = heygenPoolJsonFromPresenters([
      { avatar_id: "av1", voice_id: "v1" },
      { avatar_id: "av2", voice_id: "" },
    ]);
    expect(JSON.parse(json)).toEqual([
      { avatar_id: "av1", voice_id: "v1" },
      { avatar_id: "av2" },
    ]);
  });
});

describe("parseAvatarLookItems", () => {
  it("maps v3 look id + preview_image_url", () => {
    const avatars = parseAvatarLookItems([
      {
        id: "look_abc",
        name: "Monica - Business",
        preview_image_url: "https://files.heygen.ai/look/preview.jpg",
        preview_video_url: "https://files.heygen.ai/look/preview.mp4",
        default_voice_id: "voice_1",
        gender: "female",
        avatar_type: "photo_avatar",
        status: "completed",
      },
      { id: "look_pending", status: "processing" },
    ]);
    expect(avatars).toHaveLength(1);
    expect(avatars[0]?.avatar_id).toBe("look_abc");
    expect(avatars[0]?.preview_image_url).toContain("preview.jpg");
    expect(avatars[0]?.preview_video_url).toContain("preview.mp4");
    expect(avatars[0]?.default_voice_id).toBe("voice_1");
  });
});

describe("parseAvatarsV2Payload", () => {
  it("flattens v2 avatars and talking_photos", () => {
    const avatars = parseAvatarsV2Payload({
      data: {
        avatars: [{ avatar_id: "a1", avatar_name: "Alex", preview_image_url: "https://x/a.png" }],
        talking_photos: [{ avatar_id: "tp1", name: "Photo 1" }],
      },
    });
    expect(avatars.map((a) => a.avatar_id)).toEqual(["a1", "tp1"]);
  });
});

describe("parseVoicesPayload", () => {
  it("maps voice preview audio", () => {
    const voices = parseVoicesPayload({
      data: {
        voices: [{ voice_id: "v1", name: "Warm EN", language: "English", preview_audio_url: "https://x/a.mp3" }],
      },
    });
    expect(voices[0]?.voice_id).toBe("v1");
    expect(voices[0]?.preview_audio_url).toContain(".mp3");
  });
});
