const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { execFileSync, spawn } = require("child_process");
const { randomUUID } = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const PORT = parseInt(process.env.PORT || "3334", 10);
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
/** Must match CAF Core `SUPABASE_ASSETS_BUCKET` (default assets). */
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || process.env.SUPABASE_ASSETS_BUCKET || "assets";
const WORK_DIR = path.join(__dirname, "workdir");
const VERSION = "0.1.2";

if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });

function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const FETCH_TIMEOUT_MS = envInt("VIDEO_ASSEMBLY_FETCH_TIMEOUT_MS", 180_000);
const FFMPEG_TIMEOUT_MS = envInt("VIDEO_ASSEMBLY_FFMPEG_TIMEOUT_MS", 1_200_000);
const JOB_TIMEOUT_MS = envInt("VIDEO_ASSEMBLY_JOB_TIMEOUT_MS", 1_800_000);

function supabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function ffmpegAvailable() {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "pipe" }); return true; } catch { return false; }
}

const asyncJobs = new Map();

function runFfmpeg(args, label, spawnOpts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: "pipe", ...spawnOpts });
    let stderr = "";
    const startedAt = Date.now();
    const to = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      reject(new Error(`${label} timed out after ${FFMPEG_TIMEOUT_MS}ms`));
    }, FFMPEG_TIMEOUT_MS);
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      clearTimeout(to);
      const dur = Date.now() - startedAt;
      if (code === 0) resolve(stderr);
      else reject(new Error(`${label} exited ${code} after ${dur}ms: ${stderr.slice(-500)}`));
    });
    proc.on("error", (e) => {
      clearTimeout(to);
      reject(e);
    });
  });
}

/** Collapse duplicate bucket prefix only (e.g. assets/assets/scenes → assets/scenes). */
function normalizeStorageObjectPath(bucket, objectPath) {
  let p = String(objectPath || "").replace(/^\/+/, "").trim();
  if (!bucket) return p;
  const double = `${bucket}/${bucket}/`;
  while (p.startsWith(double)) {
    p = p.slice(bucket.length + 1);
  }
  return p;
}

function assetObjectKeyInBucket(bucket, relativePath) {
  const b = String(bucket || "assets").trim() || "assets";
  let p = String(relativePath || "").replace(/^\/+/, "").trim();
  if (!p) return `${b}/unnamed`;
  if (p.startsWith(`${b}/`)) return p;
  return `${b}/${p}`;
}

function storageDownloadKeyCandidates(bucket, objectPath) {
  const n = normalizeStorageObjectPath(bucket, objectPath);
  const ordered = [];
  const add = (s) => {
    const t = String(s || "").replace(/^\/+/, "").trim();
    if (t && !ordered.includes(t)) ordered.push(t);
  };
  add(n);
  add(assetObjectKeyInBucket(bucket, n));
  if (n.startsWith(`${bucket}/`)) {
    add(n.slice(bucket.length + 1));
  }
  return ordered;
}

async function downloadFile(url, dest) {
  const sb = supabase();
  if (sb && SUPABASE_URL) {
    try {
      const u = new URL(url);
      const supHost = new URL(SUPABASE_URL).hostname;
      if (u.hostname === supHost) {
        const m = u.pathname.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
        if (m) {
          const bucket = m[1];
          const decoded = decodeURIComponent(m[2]);
          const candidates = storageDownloadKeyCandidates(bucket, decoded);
          for (const objectPath of candidates) {
            const { data, error } = await sb.storage.from(bucket).download(objectPath);
            if (!error && data) {
              const buf = Buffer.from(await data.arrayBuffer());
              fs.writeFileSync(dest, buf);
              return dest;
            }
          }
          for (const objectPath of candidates) {
            const { data, error } = await sb.storage.from(bucket).createSignedUrl(objectPath, 7200);
            if (error || !data?.signedUrl) continue;
            const sr = await fetch(data.signedUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
            if (!sr.ok) continue;
            const buf = Buffer.from(await sr.arrayBuffer());
            fs.writeFileSync(dest, buf);
            return dest;
          }
        }
      }
    } catch {
      /* fall through to HTTP */
    }
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Download failed: ${url} (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}

async function uploadToSupabase(localPath, remotePath) {
  const sb = supabase();
  if (!sb) return null;
  const key = assetObjectKeyInBucket(SUPABASE_BUCKET, remotePath);
  const file = fs.readFileSync(localPath);
  const { data, error } = await sb.storage.from(SUPABASE_BUCKET).upload(key, file, {
    contentType: "video/mp4",
    upsert: true,
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data: urlData } = sb.storage.from(SUPABASE_BUCKET).getPublicUrl(key);
  return urlData.publicUrl;
}

async function stitchImages(imageUrls, outputOptions = {}) {
  const jobDir = path.join(WORK_DIR, randomUUID());
  fs.mkdirSync(jobDir, { recursive: true });

  const startedAt = Date.now();
  const files = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const ext = imageUrls[i].match(/\.(png|jpg|jpeg|webp)/i)?.[1] || "png";
    const dest = path.join(jobDir, `${String(i).padStart(3, "0")}.${ext}`);
    await downloadFile(imageUrls[i], dest);
    files.push(dest);
  }

  const frameDuration = outputOptions.frame_duration_s ?? 3;
  const listFile = path.join(jobDir, "concat.txt");
  const lines = files.map((f) => `file '${f.replace(/'/g, "'\\''")}'\\nduration ${frameDuration}`).join("\\n");
  fs.writeFileSync(listFile, lines.replace(/\\n/g, "\n"));
  fs.appendFileSync(listFile, `\nfile '${files[files.length - 1].replace(/'/g, "'\\''")}'`);

  const outPath = path.join(jobDir, "slideshow.mp4");
  await runFfmpeg([
    "-f", "concat", "-safe", "0", "-i", listFile,
    "-vf", `scale=1080:1350:force_original_aspect_ratio=decrease,pad=1080:1350:(ow-iw)/2:(oh-ih)/2:color=black`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "23",
    "-movflags", "+faststart", "-y", outPath,
  ], "stitch");

  console.info(`[video-assembly] stitch ok images=${imageUrls.length} duration_ms=${Date.now() - startedAt}`);
  return { localPath: outPath, jobDir };
}

async function concatVideoFiles(videoUrls, jobDir) {
  const startedAt = Date.now();
  const files = [];
  for (let i = 0; i < videoUrls.length; i++) {
    const dest = path.join(jobDir, `part_${String(i).padStart(3, "0")}.mp4`);
    await downloadFile(videoUrls[i], dest);
    files.push(dest);
  }
  const listFile = path.join(jobDir, "concat.txt");
  const lines = files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n");
  fs.writeFileSync(listFile, lines);
  const outPath = path.join(jobDir, "merged.mp4");
  /**
   * IMPORTANT: `-c copy` concat is fragile — it may silently output only the first clip when streams differ
   * (codec/profile/timebase/metadata). Re-encode to a consistent H.264 stream so multi-scene jobs don't truncate.
   */
  await runFfmpeg(
    [
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "fast",
      "-crf",
      "23",
      "-an",
      "-movflags",
      "+faststart",
      "-y",
      outPath,
    ],
    "concat"
  );
  console.info(`[video-assembly] concat ok clips=${videoUrls.length} duration_ms=${Date.now() - startedAt}`);
  return outPath;
}

function audioExtFromUrl(audioUrl) {
  const base = String(audioUrl || "").split(/[#?]/)[0];
  return base.match(/\.(mp3|wav|m4a|aac|ogg)$/i)?.[1] || "mp3";
}

/**
 * Chain ffmpeg atempo filters so ∏(atempo) ≈ product (each stage in [0.5, 2]).
 * product = T_audio / T_video → stretched audio duration matches video for mux -shortest alignment.
 */
function buildAtempoFilterChain(product) {
  const p0 = Number(product);
  if (!Number.isFinite(p0) || p0 <= 0) return null;
  if (p0 >= 0.995 && p0 <= 1.005) return null;
  const parts = [];
  let p = p0;
  while (p > 2.001) {
    parts.push("atempo=2.0");
    p /= 2;
  }
  while (p < 0.499) {
    parts.push("atempo=0.5");
    p /= 0.5;
  }
  if (p > 1.005 || p < 0.995) {
    parts.push(`atempo=${p.toFixed(5)}`);
  }
  return parts.length ? parts.join(",") : null;
}

async function muxAudio(videoPath, audioUrl, outputOptions = {}) {
  const startedAt = Date.now();
  const jobDir = path.dirname(videoPath);
  const audioExt = audioExtFromUrl(audioUrl);
  const audioPath = path.join(jobDir, `audio.${audioExt}`);
  await downloadFile(audioUrl, audioPath);

  const outPath = path.join(jobDir, "final.mp4");
  const audioChain = buildAtempoFilterChain(outputOptions.audio_atempo_product);
  const args = ["-i", videoPath, "-i", audioPath];
  if (outputOptions.max_duration_s) {
    args.push("-t", String(outputOptions.max_duration_s));
  }
  if (audioChain) {
    args.push(
      "-filter_complex", `[1:a]${audioChain}[aout]`,
      "-map", "0:v:0", "-map", "[aout]",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
      "-shortest", "-movflags", "+faststart", "-y", outPath,
    );
  } else {
    args.push(
      "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
      "-map", "0:v:0", "-map", "1:a:0", "-shortest",
      "-movflags", "+faststart", "-y", outPath,
    );
  }
  await runFfmpeg(args, "mux");
  console.info(`[video-assembly] mux ok burn_subs=false duration_ms=${Date.now() - startedAt}`);
  return outPath;
}

/**
 * Mux video + audio and burn in subtitles (SRT). Re-encodes video (libx264) — required for subtitles filter.
 * Runs ffmpeg with cwd = jobDir so subtitles=captions.srt resolves safely.
 */
async function muxAudioBurnSubtitles(videoPath, audioUrl, subtitlesUrl, outputOptions = {}) {
  const startedAt = Date.now();
  const jobDir = path.dirname(videoPath);
  const audioExt = audioExtFromUrl(audioUrl);
  const audioBasename = `audio.${audioExt}`;
  const audioPath = path.join(jobDir, audioBasename);
  await downloadFile(audioUrl, audioPath);

  const srtBasename = "captions.srt";
  const srtPath = path.join(jobDir, srtBasename);
  await downloadFile(subtitlesUrl, srtPath);

  const videoBasename = path.basename(videoPath);
  const outBasename = "final.mp4";
  const outPath = path.join(jobDir, outBasename);

  const preset = process.env.MUX_BURN_ENCODE_PRESET || "fast";
  const crf = process.env.MUX_BURN_ENCODE_CRF || "23";
  let vf = process.env.MUX_SUBTITLE_VF?.trim();
  if (!vf) {
    const base = "subtitles=captions.srt:charenc=UTF-8";
    const fsStyle = process.env.MUX_BURN_SUBTITLE_FORCE_STYLE?.trim();
    vf = fsStyle ? `${base}:force_style='${fsStyle.replace(/'/g, "\\'")}'` : base;
  }

  const audioChain = buildAtempoFilterChain(outputOptions.audio_atempo_product);
  const args = ["-i", videoBasename, "-i", audioBasename];
  if (outputOptions.max_duration_s) {
    args.push("-t", String(outputOptions.max_duration_s));
  }
  if (audioChain) {
    args.push(
      "-filter_complex", `[0:v]${vf}[vout];[1:a]${audioChain}[aout]`,
      "-map", "[vout]", "-map", "[aout]",
      "-c:v", "libx264",
      "-preset", preset,
      "-crf", String(crf),
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      "-shortest",
      "-movflags", "+faststart",
      "-y", outBasename,
    );
  } else {
    args.push(
      "-vf", vf,
      "-c:v", "libx264",
      "-preset", preset,
      "-crf", String(crf),
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-shortest",
      "-movflags", "+faststart",
      "-y", outBasename,
    );
  }
  await runFfmpeg(args, "mux+burn-subs", { cwd: jobDir });
  console.info(`[video-assembly] mux ok burn_subs=true duration_ms=${Date.now() - startedAt}`);
  return outPath;
}

function cleanupJob(jobDir) {
  try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch {}
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "caf-video-assembly", version: VERSION, ffmpeg: ffmpegAvailable() }));
app.get("/version", (_req, res) => res.json({ version: VERSION }));
app.get("/ready", (_req, res) =>
  res.status(ffmpegAvailable() ? 200 : 503).json({
    ok: ffmpegAvailable(),
    service: "caf-video-assembly",
    version: VERSION,
    ffmpeg: ffmpegAvailable(),
  })
);

app.post("/stitch", async (req, res) => {
  try {
    const { image_urls, task_id, run_id, options } = req.body;
    if (!image_urls?.length) return res.status(400).json({ ok: false, error: "image_urls required" });

    const isAsync = req.query.async === "1";
    if (isAsync) {
      const requestId = randomUUID();
      asyncJobs.set(requestId, { status: "pending" });
      (async () => {
        const jobStartedAt = Date.now();
        try {
          const p = stitchImages(image_urls, options);
          const { localPath, jobDir } = await Promise.race([
            p,
            new Promise((_, rej) => setTimeout(() => rej(new Error(`job timeout after ${JOB_TIMEOUT_MS}ms`)), JOB_TIMEOUT_MS)),
          ]);
          let publicUrl = null;
          if (SUPABASE_URL) {
            const remotePath = `videos/${run_id || "default"}/${task_id || randomUUID()}/slideshow.mp4`;
            publicUrl = await uploadToSupabase(localPath, remotePath);
          }
          asyncJobs.set(requestId, { status: "done", public_url: publicUrl, local_path: localPath });
          setTimeout(() => { asyncJobs.delete(requestId); cleanupJob(jobDir); }, 3600000);
          console.info(`[video-assembly] async stitch done request_id=${requestId} duration_ms=${Date.now() - jobStartedAt}`);
        } catch (e) {
          asyncJobs.set(requestId, { status: "error", error: e.message });
        }
      })();
      return res.status(202).json({ ok: true, request_id: requestId, status: "pending" });
    }

    const { localPath, jobDir } = await Promise.race([
      stitchImages(image_urls, options),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`job timeout after ${JOB_TIMEOUT_MS}ms`)), JOB_TIMEOUT_MS)),
    ]);
    let publicUrl = null;
    if (SUPABASE_URL) {
      const remotePath = `videos/${run_id || "default"}/${task_id || randomUUID()}/slideshow.mp4`;
      publicUrl = await uploadToSupabase(localPath, remotePath);
      cleanupJob(jobDir);
    }
    res.json({ ok: true, public_url: publicUrl, local_path: publicUrl ? undefined : localPath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/concat-videos", async (req, res) => {
  try {
    const { video_urls, task_id, run_id } = req.body;
    if (!video_urls?.length) return res.status(400).json({ ok: false, error: "video_urls required" });

    const isAsync = req.query.async === "1";
    if (isAsync) {
      const requestId = randomUUID();
      asyncJobs.set(requestId, { status: "pending" });
      (async () => {
        const jobStartedAt = Date.now();
        try {
          const jobDir = path.join(WORK_DIR, randomUUID());
          fs.mkdirSync(jobDir, { recursive: true });
          const merged = await Promise.race([
            concatVideoFiles(video_urls, jobDir),
            new Promise((_, rej) => setTimeout(() => rej(new Error(`job timeout after ${JOB_TIMEOUT_MS}ms`)), JOB_TIMEOUT_MS)),
          ]);
          let publicUrl = null;
          if (SUPABASE_URL) {
            const remotePath = `videos/${run_id || "default"}/${task_id || randomUUID()}/merged.mp4`;
            publicUrl = await uploadToSupabase(merged, remotePath);
          }
          asyncJobs.set(requestId, { status: "done", public_url: publicUrl, local_path: merged });
          setTimeout(() => { asyncJobs.delete(requestId); cleanupJob(jobDir); }, 3600000);
          console.info(`[video-assembly] async concat done request_id=${requestId} duration_ms=${Date.now() - jobStartedAt}`);
        } catch (e) {
          asyncJobs.set(requestId, { status: "error", error: e.message });
        }
      })();
      return res.status(202).json({ ok: true, request_id: requestId, status: "pending" });
    }

    const jobDir = path.join(WORK_DIR, randomUUID());
    fs.mkdirSync(jobDir, { recursive: true });
    const merged = await Promise.race([
      concatVideoFiles(video_urls, jobDir),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`job timeout after ${JOB_TIMEOUT_MS}ms`)), JOB_TIMEOUT_MS)),
    ]);
    let publicUrl = null;
    if (SUPABASE_URL) {
      const remotePath = `videos/${run_id || "default"}/${task_id || randomUUID()}/merged.mp4`;
      publicUrl = await uploadToSupabase(merged, remotePath);
      cleanupJob(jobDir);
    }
    res.json({ ok: true, public_url: publicUrl, local_path: publicUrl ? undefined : merged });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/mux", async (req, res) => {
  try {
    const { video_url, audio_url, subtitles_url, task_id, run_id, options } = req.body;
    if (!video_url || !audio_url) return res.status(400).json({ ok: false, error: "video_url and audio_url required" });

    const isAsync = req.query.async === "1";
    if (isAsync) {
      const requestId = randomUUID();
      asyncJobs.set(requestId, { status: "pending" });
      (async () => {
        const jobStartedAt = Date.now();
        try {
          const jobDir = path.join(WORK_DIR, randomUUID());
          fs.mkdirSync(jobDir, { recursive: true });
          const vidPath = path.join(jobDir, "video.mp4");
          await Promise.race([
            downloadFile(video_url, vidPath),
            new Promise((_, rej) => setTimeout(() => rej(new Error(`job timeout after ${JOB_TIMEOUT_MS}ms`)), JOB_TIMEOUT_MS)),
          ]);
          const muxed = await Promise.race([
            subtitles_url?.trim()
              ? muxAudioBurnSubtitles(vidPath, audio_url, subtitles_url.trim(), options)
              : muxAudio(vidPath, audio_url, options),
            new Promise((_, rej) => setTimeout(() => rej(new Error(`job timeout after ${JOB_TIMEOUT_MS}ms`)), JOB_TIMEOUT_MS)),
          ]);
          let publicUrl = null;
          if (SUPABASE_URL) {
            const remotePath = `videos/${run_id || "default"}/${task_id || randomUUID()}/final.mp4`;
            publicUrl = await uploadToSupabase(muxed, remotePath);
          }
          asyncJobs.set(requestId, { status: "done", public_url: publicUrl, local_path: muxed });
          setTimeout(() => { asyncJobs.delete(requestId); cleanupJob(jobDir); }, 3600000);
          console.info(`[video-assembly] async mux done request_id=${requestId} duration_ms=${Date.now() - jobStartedAt}`);
        } catch (e) {
          asyncJobs.set(requestId, { status: "error", error: e.message });
        }
      })();
      return res.status(202).json({ ok: true, request_id: requestId, status: "pending" });
    }

    const jobDir = path.join(WORK_DIR, randomUUID());
    fs.mkdirSync(jobDir, { recursive: true });
    const vidPath = path.join(jobDir, "video.mp4");
    await Promise.race([
      downloadFile(video_url, vidPath),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`job timeout after ${JOB_TIMEOUT_MS}ms`)), JOB_TIMEOUT_MS)),
    ]);
    const muxed = await Promise.race([
      subtitles_url?.trim()
        ? muxAudioBurnSubtitles(vidPath, audio_url, subtitles_url.trim(), options)
        : muxAudio(vidPath, audio_url, options),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`job timeout after ${JOB_TIMEOUT_MS}ms`)), JOB_TIMEOUT_MS)),
    ]);
    let publicUrl = null;
    if (SUPABASE_URL) {
      const remotePath = `videos/${run_id || "default"}/${task_id || randomUUID()}/final.mp4`;
      publicUrl = await uploadToSupabase(muxed, remotePath);
      cleanupJob(jobDir);
    }
    res.json({ ok: true, public_url: publicUrl, local_path: publicUrl ? undefined : muxed });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/full-pipeline", async (req, res) => {
  try {
    const { image_urls, audio_url, task_id, run_id, stitch_options, mux_options } = req.body;
    if (!image_urls?.length) return res.status(400).json({ ok: false, error: "image_urls required" });

    const jobStartedAt = Date.now();
    const { localPath: slideshowPath, jobDir } = await Promise.race([
      stitchImages(image_urls, stitch_options),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`job timeout after ${JOB_TIMEOUT_MS}ms`)), JOB_TIMEOUT_MS)),
    ]);

    let finalPath = slideshowPath;
    if (audio_url) {
      finalPath = await Promise.race([
        muxAudio(slideshowPath, audio_url, mux_options),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`job timeout after ${JOB_TIMEOUT_MS}ms`)), JOB_TIMEOUT_MS)),
      ]);
    }

    let publicUrl = null;
    if (SUPABASE_URL) {
      const remotePath = `videos/${run_id || "default"}/${task_id || randomUUID()}/final.mp4`;
      publicUrl = await uploadToSupabase(finalPath, remotePath);
      cleanupJob(jobDir);
    }
    console.info(`[video-assembly] full-pipeline ok images=${image_urls.length} has_audio=${Boolean(audio_url)} duration_ms=${Date.now() - jobStartedAt}`);
    res.json({ ok: true, public_url: publicUrl, local_path: publicUrl ? undefined : finalPath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/status/:requestId", (req, res) => {
  const job = asyncJobs.get(req.params.requestId);
  if (!job) return res.status(404).json({ ok: false, error: "not found" });
  res.json({ ok: true, request_id: req.params.requestId, ...job });
});

app.listen(PORT, () => console.log(`Video Assembly listening on :${PORT}`));
