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
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "public";
const WORK_DIR = path.join(__dirname, "workdir");
const VERSION = "0.1.0";

if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });

function supabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function ffmpegAvailable() {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "pipe" }); return true; } catch { return false; }
}

const asyncJobs = new Map();

function runFfmpeg(args, label) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: "pipe" });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`${label} exited ${code}: ${stderr.slice(-500)}`));
    });
    proc.on("error", reject);
  });
}

async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${url} (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}

async function uploadToSupabase(localPath, remotePath) {
  const sb = supabase();
  if (!sb) return null;
  const file = fs.readFileSync(localPath);
  const { data, error } = await sb.storage.from(SUPABASE_BUCKET).upload(remotePath, file, {
    contentType: "video/mp4",
    upsert: true,
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data: urlData } = sb.storage.from(SUPABASE_BUCKET).getPublicUrl(remotePath);
  return urlData.publicUrl;
}

async function stitchImages(imageUrls, outputOptions = {}) {
  const jobDir = path.join(WORK_DIR, randomUUID());
  fs.mkdirSync(jobDir, { recursive: true });

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

  return { localPath: outPath, jobDir };
}

async function muxAudio(videoPath, audioUrl, outputOptions = {}) {
  const jobDir = path.dirname(videoPath);
  const audioExt = audioUrl.match(/\.(mp3|wav|m4a|aac|ogg)/i)?.[1] || "mp3";
  const audioPath = path.join(jobDir, `audio.${audioExt}`);
  await downloadFile(audioUrl, audioPath);

  const outPath = path.join(jobDir, "final.mp4");
  const args = ["-i", videoPath, "-i", audioPath];
  if (outputOptions.max_duration_s) {
    args.push("-t", String(outputOptions.max_duration_s));
  }
  args.push(
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
    "-map", "0:v:0", "-map", "1:a:0", "-shortest",
    "-movflags", "+faststart", "-y", outPath,
  );
  await runFfmpeg(args, "mux");
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

app.post("/stitch", async (req, res) => {
  try {
    const { image_urls, task_id, run_id, options } = req.body;
    if (!image_urls?.length) return res.status(400).json({ ok: false, error: "image_urls required" });

    const isAsync = req.query.async === "1";
    if (isAsync) {
      const requestId = randomUUID();
      asyncJobs.set(requestId, { status: "pending" });
      (async () => {
        try {
          const { localPath, jobDir } = await stitchImages(image_urls, options);
          let publicUrl = null;
          if (SUPABASE_URL) {
            const remotePath = `videos/${run_id || "default"}/${task_id || randomUUID()}/slideshow.mp4`;
            publicUrl = await uploadToSupabase(localPath, remotePath);
          }
          asyncJobs.set(requestId, { status: "done", public_url: publicUrl, local_path: localPath });
          setTimeout(() => { asyncJobs.delete(requestId); cleanupJob(jobDir); }, 3600000);
        } catch (e) {
          asyncJobs.set(requestId, { status: "error", error: e.message });
        }
      })();
      return res.status(202).json({ ok: true, request_id: requestId, status: "pending" });
    }

    const { localPath, jobDir } = await stitchImages(image_urls, options);
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

app.post("/mux", async (req, res) => {
  try {
    const { video_url, audio_url, task_id, run_id, options } = req.body;
    if (!video_url || !audio_url) return res.status(400).json({ ok: false, error: "video_url and audio_url required" });

    const isAsync = req.query.async === "1";
    if (isAsync) {
      const requestId = randomUUID();
      asyncJobs.set(requestId, { status: "pending" });
      (async () => {
        try {
          const jobDir = path.join(WORK_DIR, randomUUID());
          fs.mkdirSync(jobDir, { recursive: true });
          const vidPath = path.join(jobDir, "video.mp4");
          await downloadFile(video_url, vidPath);
          const muxed = await muxAudio(vidPath, audio_url, options);
          let publicUrl = null;
          if (SUPABASE_URL) {
            const remotePath = `videos/${run_id || "default"}/${task_id || randomUUID()}/final.mp4`;
            publicUrl = await uploadToSupabase(muxed, remotePath);
          }
          asyncJobs.set(requestId, { status: "done", public_url: publicUrl, local_path: muxed });
          setTimeout(() => { asyncJobs.delete(requestId); cleanupJob(jobDir); }, 3600000);
        } catch (e) {
          asyncJobs.set(requestId, { status: "error", error: e.message });
        }
      })();
      return res.status(202).json({ ok: true, request_id: requestId, status: "pending" });
    }

    const jobDir = path.join(WORK_DIR, randomUUID());
    fs.mkdirSync(jobDir, { recursive: true });
    const vidPath = path.join(jobDir, "video.mp4");
    await downloadFile(video_url, vidPath);
    const muxed = await muxAudio(vidPath, audio_url, options);
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

    const { localPath: slideshowPath, jobDir } = await stitchImages(image_urls, stitch_options);

    let finalPath = slideshowPath;
    if (audio_url) {
      finalPath = await muxAudio(slideshowPath, audio_url, mux_options);
    }

    let publicUrl = null;
    if (SUPABASE_URL) {
      const remotePath = `videos/${run_id || "default"}/${task_id || randomUUID()}/final.mp4`;
      publicUrl = await uploadToSupabase(finalPath, remotePath);
      cleanupJob(jobDir);
    }
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
