import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.js";

vi.mock("./supabase-storage.js", () => ({
  getSupabaseStorageClient: vi.fn(),
  uploadBuffer: vi.fn(async () => ({
    bucket: "assets",
    object_path: "assets/top_performer_inspection/SNS/test/top_performer_carousel/row_1/slide_01.jpg",
    public_url: "https://example.test/storage/v1/object/public/assets/x.jpg",
  })),
}));

import {
  archiveTopPerformerVisionMedia,
  resolveTopPerformerArchiveMedia,
  resolveTopPerformerArchiveSourceVideo,
  sniffImageMedia,
  sniffVideoMedia,
} from "./inputs-top-performer-media-archive.js";
import { getSupabaseStorageClient, uploadBuffer } from "./supabase-storage.js";

beforeEach(() => {
  vi.mocked(getSupabaseStorageClient).mockImplementation((config: AppConfig) => {
    const url = config.SUPABASE_URL?.trim();
    const key = config.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) return null;
    return {} as any;
  });
  vi.mocked(uploadBuffer).mockImplementation(async () => ({
    bucket: "assets",
    object_path: "assets/top_performer_inspection/SNS/test/top_performer_carousel/row_1/slide_01.jpg",
    public_url: "https://example.test/storage/v1/object/public/assets/x.jpg",
  }));
});

function miniConfig(over: Partial<AppConfig> = {}): AppConfig {
  return {
    CAF_TOP_PERFORMER_ARCHIVE_FETCH_TIMEOUT_MS: 8000,
    CAF_TOP_PERFORMER_ARCHIVE_MAX_BYTES_PER_FILE: 2_000_000,
    CAF_TOP_PERFORMER_ARCHIVE_MIN_BYTES_CAROUSEL_IMAGE: 10,
    CAF_TOP_PERFORMER_ARCHIVE_SOURCE_VIDEO: "auto",
    CAF_TOP_PERFORMER_ARCHIVE_SOURCE_VIDEO_TIMEOUT_MS: 60_000,
    CAF_TOP_PERFORMER_ARCHIVE_MAX_BYTES_SOURCE_VIDEO: 50_000_000,
    SUPABASE_ASSETS_BUCKET: "assets",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "srk",
    CAF_TOP_PERFORMER_ARCHIVE_MEDIA: "auto",
    ...over,
  } as AppConfig;
}

describe("sniffImageMedia", () => {
  it("detects JPEG", () => {
    const b = Buffer.alloc(16, 0);
    b[0] = 0xff;
    b[1] = 0xd8;
    b[2] = 0xff;
    b[3] = 0xe0;
    expect(sniffImageMedia(b)).toEqual({ contentType: "image/jpeg", ext: ".jpg" });
  });

  it("detects PNG signature", () => {
    const b = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(sniffImageMedia(b)?.ext).toBe(".png");
  });

  it("returns null for random bytes", () => {
    expect(sniffImageMedia(Buffer.from("hello world"))).toBeNull();
  });
});

describe("sniffVideoMedia", () => {
  it("detects MP4 / ISO BMFF ftyp", () => {
    const b = Buffer.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, 0x69, 0x73, 0x6f, 0x6d,
      0x69, 0x73, 0x6f, 0x32,
    ]);
    expect(sniffVideoMedia(b)).toEqual({ contentType: "video/mp4", ext: ".mp4" });
  });

  it("detects QuickTime brand as .mov", () => {
    const b = Buffer.alloc(24, 0);
    b.writeUInt32BE(24, 0);
    b.write("ftyp", 4);
    b.write("qt  ", 8);
    expect(sniffVideoMedia(b)).toEqual({ contentType: "video/quicktime", ext: ".mov" });
  });

  it("detects Matroska vs WebM via DocType string", () => {
    const mk = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("matroska")]);
    expect(sniffVideoMedia(mk)?.ext).toBe(".mkv");
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("something")]);
    expect(sniffVideoMedia(webm)?.ext).toBe(".webm");
  });
});

describe("resolveTopPerformerArchiveSourceVideo", () => {
  it("is false when env off", () => {
    expect(resolveTopPerformerArchiveSourceVideo(miniConfig({ CAF_TOP_PERFORMER_ARCHIVE_SOURCE_VIDEO: "off" }), {})).toBe(
      false
    );
  });

  it("is true when env on", () => {
    expect(resolveTopPerformerArchiveSourceVideo(miniConfig({ CAF_TOP_PERFORMER_ARCHIVE_SOURCE_VIDEO: "on" }), {})).toBe(
      true
    );
  });

  it("auto respects criteria disable", () => {
    expect(
      resolveTopPerformerArchiveSourceVideo(miniConfig(), {
        inputs_insights: { archive_top_performer_source_video: false },
      })
    ).toBe(false);
  });

  it("auto defaults to true", () => {
    expect(resolveTopPerformerArchiveSourceVideo(miniConfig(), {})).toBe(true);
  });
});

describe("resolveTopPerformerArchiveMedia", () => {
  it("is true when env mode is on", () => {
    expect(resolveTopPerformerArchiveMedia(miniConfig({ CAF_TOP_PERFORMER_ARCHIVE_MEDIA: "on" }), {})).toBe(true);
  });

  it("is false when env mode is off", () => {
    expect(resolveTopPerformerArchiveMedia(miniConfig({ CAF_TOP_PERFORMER_ARCHIVE_MEDIA: "off" }), {})).toBe(false);
  });

  it("auto is false when supabase not configured", () => {
    expect(
      resolveTopPerformerArchiveMedia(
        {
          ...miniConfig(),
          SUPABASE_URL: undefined,
          SUPABASE_SERVICE_ROLE_KEY: undefined,
        } as AppConfig,
        {}
      )
    ).toBe(false);
  });

  it("auto is true when supabase keys present (default)", () => {
    expect(resolveTopPerformerArchiveMedia(miniConfig(), {})).toBe(true);
  });

  it("criteria can force off in auto mode", () => {
    expect(
      resolveTopPerformerArchiveMedia(miniConfig(), {
        inputs_insights: { archive_top_performer_media_to_storage: false },
      })
    ).toBe(false);
  });

  it("criteria can force on without supabase client (resolve true; upload step still skips)", () => {
    expect(
      resolveTopPerformerArchiveMedia(miniConfig(), {
        inputs_insights: { archive_top_performer_media_to_storage: true },
      })
    ).toBe(true);
  });
});

describe("archiveTopPerformerVisionMedia", () => {
  beforeEach(() => {
    vi.mocked(uploadBuffer).mockClear();
  });

  it("returns skipped when supabase client missing", async () => {
    const res = await archiveTopPerformerVisionMedia(
      {
        ...miniConfig(),
        SUPABASE_URL: undefined,
        SUPABASE_SERVICE_ROLE_KEY: undefined,
      } as AppConfig,
      {
        projectSlug: "SNS",
        inputsImportId: "6dd40804-fe61-42f1-9fcf-e6b4d683c125",
        sourceEvidenceRowId: "1",
        tier: "top_performer_carousel",
        role: "carousel_slide",
        urls: ["https://cdn.example/a.jpg"],
      }
    );
    expect(res.skipped_reason).toBe("supabase_not_configured");
    expect(res.items).toHaveLength(0);
  });

  it("fetches each URL and uploads with sniffed image/jpeg", async () => {
    const jpegBody = Buffer.alloc(32, 0);
    jpegBody[0] = 0xff;
    jpegBody[1] = 0xd8;
    jpegBody[2] = 0xff;
    jpegBody[3] = 0xe0;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(jpegBody, {
            status: 200,
            headers: { "Content-Type": "application/octet-stream" },
          })
      ) as typeof fetch
    );
    const res = await archiveTopPerformerVisionMedia(miniConfig(), {
      projectSlug: "SNS",
      inputsImportId: "6dd40804-fe61-42f1-9fcf-e6b4d683c125",
      sourceEvidenceRowId: "42",
      tier: "top_performer_carousel",
      role: "carousel_slide",
      urls: ["https://cdn.example/a", "https://cdn.example/b"],
    });
    expect(res.items).toHaveLength(2);
    expect(res.items.every((x) => x.ok)).toBe(true);
    expect(uploadBuffer).toHaveBeenCalledTimes(2);
    const firstCall = vi.mocked(uploadBuffer).mock.calls[0];
    expect(firstCall[2]).toBeInstanceOf(Buffer);
    expect(firstCall[3]).toBe("image/jpeg");
    vi.unstubAllGlobals();
  });

  it("archives source_video after frames for top_performer_video", async () => {
    const jpegBody = Buffer.alloc(32, 0);
    jpegBody[0] = 0xff;
    jpegBody[1] = 0xd8;
    jpegBody[2] = 0xff;
    jpegBody[3] = 0xe0;
    const mp4Head = Buffer.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, 0x69, 0x73, 0x6f, 0x6d,
      0x69, 0x73, 0x6f, 0x32,
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const s = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();
        const body = s.includes("source-video") ? mp4Head : jpegBody;
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" },
        });
      }) as typeof fetch
    );
    const res = await archiveTopPerformerVisionMedia(miniConfig(), {
      projectSlug: "SNS",
      inputsImportId: "6dd40804-fe61-42f1-9fcf-e6b4d683c125",
      sourceEvidenceRowId: "7",
      tier: "top_performer_video",
      role: "video_frame",
      urls: ["https://cdn.example/frame.jpg"],
      archive_source_video: true,
      source_video_url: "https://cdn.example/source-video.bin",
    });
    expect(res.items).toHaveLength(2);
    expect(res.items[0].ok && res.items[0].role === "video_frame").toBe(true);
    expect(res.items[1].role).toBe("source_video");
    expect(res.items[1].ok).toBe(true);
    expect(uploadBuffer).toHaveBeenCalledTimes(2);
    const videoCall = vi.mocked(uploadBuffer).mock.calls[1];
    expect(videoCall[3]).toBe("video/mp4");
    expect(String(videoCall[1])).toContain("/source.mp4");
    vi.unstubAllGlobals();
  });
});
