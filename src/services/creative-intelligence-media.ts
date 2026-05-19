import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { uploadBuffer } from "./supabase-storage.js";

const execFileAsync = promisify(execFile);

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const VIDEO_MIMES = new Set(["video/mp4", "video/quicktime", "application/octet-stream"]);

export interface DownloadResult {
  buffer: Buffer;
  mime: string;
  contentLength?: number;
}

export async function downloadUrlBytes(
  urlStr: string,
  maxBytes: number,
  timeoutMs: number
): Promise<DownloadResult | null> {
  const u = urlStr.trim();
  if (!u.startsWith("https://")) return null;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(u, { signal: ac.signal, redirect: "follow" });
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") ?? "").split(";")[0]?.trim() || "application/octet-stream";
    const len = parseInt(res.headers.get("content-length") ?? "0", 10);
    if (len > maxBytes) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) return null;
    return { buffer: buf, mime, contentLength: buf.length };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export function isImageMime(m: string): boolean {
  return IMAGE_MIMES.has(m.split(";")[0]?.trim().toLowerCase() || "");
}

export function isVideoMime(m: string): boolean {
  const x = m.split(";")[0]?.trim().toLowerCase() || "";
  return VIDEO_MIMES.has(x) || x.startsWith("video/");
}

function ffmpegBin(config: AppConfig): string {
  return config.CREATIVE_INTEL_FFMPEG_PATH?.trim() || "ffmpeg";
}

/**
 * Extract JPEG frames at given timestamps (seconds). Writes temp MP4 to disk.
 */
/**
 * Extract mono MP3 audio from a video file for Whisper (capped duration).
 */
export async function extractAudioMp3FromVideo(
  config: AppConfig,
  videoPath: string,
  maxDurationSec = 120
): Promise<Buffer | null> {
  const ffmpeg = ffmpegBin(config);
  const cap = Math.max(5, Math.min(maxDurationSec, 600));
  try {
    const { stdout } = await execFileAsync(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        videoPath,
        "-vn",
        "-t",
        String(cap),
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "mp3",
        "pipe:1",
      ],
      { encoding: "buffer", maxBuffer: 12_000_000 }
    );
    if (stdout && stdout.length > 500) return stdout;
    return null;
  } catch {
    return null;
  }
}

export async function extractVideoFramesJpeg(
  config: AppConfig,
  videoPath: string,
  timestampsSec: number[]
): Promise<Buffer[]> {
  const ffmpeg = ffmpegBin(config);
  const out: Buffer[] = [];
  for (const ts of timestampsSec) {
    try {
      const { stdout } = await execFileAsync(
        ffmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-ss",
          String(Math.max(0, ts)),
          "-i",
          videoPath,
          "-frames:v",
          "1",
          "-f",
          "image2pipe",
          "-vcodec",
          "mjpeg",
          "pipe:1",
        ],
        { encoding: "buffer", maxBuffer: config.CREATIVE_INTEL_MAX_DOWNLOAD_BYTES }
      );
      if (stdout && stdout.length > 1000) out.push(stdout);
    } catch {
      /* skip frame */
    }
  }
  return out;
}

export async function withTempVideoFile(
  buf: Buffer,
  suffix: string,
  fn: (filePath: string) => Promise<void>
): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "caf-ci-"));
  const fp = path.join(dir, `vid${suffix}`);
  await writeFile(fp, buf);
  try {
    await fn(fp);
  } finally {
    await unlink(fp).catch(() => {});
  }
}

export async function uploadCreativeIntelBuffer(
  config: AppConfig,
  projectSlug: string,
  sourceGroupId: string,
  fileName: string,
  body: Buffer,
  contentType: string
): Promise<{ bucket: string; object_path: string; public_url: string | null }> {
  const rel = `creative_intel/${projectSlug.replace(/[^a-zA-Z0-9_-]/g, "_")}/${sourceGroupId}/${fileName}`;
  return uploadBuffer(config, rel, body, contentType);
}

/** Build ~uniform timestamps from [0..dur] capped. */
export function videoSampleTimestamps(durationSec: number | null, maxFrames: number): number[] {
  const d = durationSec && durationSec > 0 ? durationSec : 12;
  const n = Math.max(1, Math.min(maxFrames, 12));
  const out: number[] = [0, Math.min(0.5, d * 0.02)];
  if (n <= 2) return out.slice(0, n);
  for (let i = 2; i < n; i++) {
    const t = (d * i) / Math.max(n - 1, 1);
    out.push(Math.min(t, d - 0.1));
  }
  return [...new Set(out.map((x) => Math.round(x * 100) / 100))].sort((a, b) => a - b).slice(0, n);
}
