/**
 * Multi-scene video: HeyGen per scene → concat (video-assembly) → optional TTS/mux → assets.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { qOne } from "../db/queries.js";
import { listHeygenConfig } from "../repositories/project-config.js";
import { insertAsset } from "../repositories/assets.js";
import { uploadBuffer, downloadUrl } from "./supabase-storage.js";
import {
  mergeHeygenConfig,
  buildHeyGenRequestBody,
  runHeygenVideoWithBody,
} from "./heygen-renderer.js";
import { tryInsertApiCallAudit } from "../repositories/api-call-audit.js";
import { ensureSceneBundleInPayload } from "./scene-assembly-generator.js";
import { buildRoughSrt } from "./caption-generator.js";
import { synthesizeSpeechToStorage } from "./tts-service.js";

export async function pollVideoAssemblyJob(
  baseUrl: string,
  requestId: string,
  maxMs = 600_000
): Promise<{ public_url?: string; local_path?: string }> {
  const start = Date.now();
  let delay = 2000;
  while (Date.now() - start < maxMs) {
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/status/${requestId}`);
    const j = (await r.json()) as { status?: string; error?: string; public_url?: string; local_path?: string };
    if (j.status === "done") return { public_url: j.public_url, local_path: j.local_path };
    if (j.status === "error") throw new Error(j.error ?? "video-assembly error");
    await new Promise((x) => setTimeout(x, delay));
    delay = Math.min(delay * 2, 30_000);
  }
  throw new Error("video-assembly async timeout");
}

export async function runScenePipeline(
  db: Pool,
  config: AppConfig,
  videoAssemblyBaseUrl: string,
  job: {
    id: string;
    task_id: string;
    project_id: string;
    run_id: string;
    flow_type: string;
    platform: string | null;
    generation_payload: Record<string, unknown>;
  },
): Promise<void> {
  await ensureSceneBundleInPayload(db, config, job.id);
  const fresh = await qOne<{
    id: string;
    task_id: string;
    project_id: string;
    run_id: string;
    flow_type: string;
    platform: string | null;
    generation_payload: Record<string, unknown>;
  }>(db, `SELECT * FROM caf_core.content_jobs WHERE id = $1`, [job.id]);
  if (!fresh) throw new Error("job missing after scene bundle");
  job = fresh;

  const gen = (job.generation_payload.generated_output as Record<string, unknown>) ?? {};
  const bundle = (gen.scene_bundle as Record<string, unknown>) ?? {};
  const scenes = (bundle.scenes as unknown[]) ?? [];
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error("scene_bundle.scenes is empty — configure scene assembly prompts or payload");
  }

  if (!config.HEYGEN_API_KEY?.trim()) {
    throw new Error("SCENE pipeline requires HEYGEN_API_KEY");
  }

  const rows = await listHeygenConfig(db, job.project_id);
  const renderMode = String(job.generation_payload.render_mode ?? gen.render_mode ?? "HEYGEN_AVATAR");
  const mergedCfg = mergeHeygenConfig(rows, job.platform, job.flow_type, renderMode);

  const sceneUrls: string[] = [];
  let ord = 0;
  for (const raw of scenes) {
    if (!raw || typeof raw !== "object") continue;
    const sc = raw as Record<string, unknown>;
    const prompt = String(sc.video_prompt ?? sc.prompt ?? sc.direction ?? "").trim();
    if (!prompt) continue;

    const body = buildHeyGenRequestBody(
      mergedCfg,
      { ...gen, video_prompt: prompt },
      { video_inputs: [{ prompt }] },
      { defaultVoiceId: config.HEYGEN_DEFAULT_VOICE_ID }
    );
    const { videoUrl, videoId } = await runHeygenVideoWithBody(config, body, {
      db,
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      step: `heygen_scene_clip_${ord}`,
      scene_index: ord,
    });
    const buf = await downloadUrl(videoUrl);
    const safeTask = job.task_id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeRun = job.run_id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const sid = String(sc.scene_id ?? ord).replace(/[^a-zA-Z0-9_-]/g, "_");
    const objectPath = `assets/scenes/${safeRun}/${safeTask}/scene_${sid}_${videoId}.mp4`;
    let publicUrl: string | null = null;
    try {
      const up = await uploadBuffer(config, objectPath, buf, "video/mp4");
      publicUrl = up.public_url;
    } catch {
      publicUrl = videoUrl;
    }

    await insertAsset(db, {
      asset_id: `${job.task_id}__SCENE_${ord}_v1`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
      task_id: job.task_id,
      project_id: job.project_id,
      asset_type: "SCENE_VIDEO",
      position: ord,
      bucket: config.SUPABASE_ASSETS_BUCKET,
      object_path: objectPath,
      public_url: publicUrl,
      provider: "heygen_scene",
      metadata_json: { scene_id: sc.scene_id, video_id: videoId },
    });

    if (publicUrl) sceneUrls.push(publicUrl);
    ord++;
  }

  if (sceneUrls.length === 0) throw new Error("no scene clips produced");

  const concatEndpoint = `${videoAssemblyBaseUrl.replace(/\/$/, "")}/concat-videos?async=1`;
  const concatPayload = { video_urls: sceneUrls, task_id: job.task_id, run_id: job.run_id };
  const concatRes = await fetch(concatEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(concatPayload),
  });
  const concatJson = (await concatRes.json()) as { request_id?: string; ok?: boolean };
  if (!concatRes.ok || !concatJson.request_id) {
    throw new Error(`concat-videos failed: ${await concatRes.text()}`);
  }
  const merged = await pollVideoAssemblyJob(videoAssemblyBaseUrl, concatJson.request_id);
  await tryInsertApiCallAudit(db, {
    projectId: job.project_id,
    runId: job.run_id,
    taskId: job.task_id,
    step: "video_assembly_concat",
    provider: "video_assembly",
    model: null,
    ok: true,
    requestJson: { endpoint: concatEndpoint, body: concatPayload },
    responseJson: { request_id: concatJson.request_id, public_url: merged.public_url },
  });
  let mergedUrl = merged.public_url;
  if (!mergedUrl && merged.local_path) {
    throw new Error("concat completed without public_url — configure Supabase on video-assembly or use sync concat from CAF Core");
  }

  if (mergedUrl) {
    const finalBuf = await downloadUrl(mergedUrl);
    const safeTask = job.task_id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeRun = job.run_id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const finalPath = `assets/videos/${safeRun}/${safeTask}/scene_merged.mp4`;
    let finalPublic: string | null = null;
    try {
      const up = await uploadBuffer(config, finalPath, finalBuf, "video/mp4");
      finalPublic = up.public_url;
    } catch {
      finalPublic = mergedUrl;
    }

    await insertAsset(db, {
      asset_id: `${job.task_id}__VIDEO_MERGED_v1`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
      task_id: job.task_id,
      project_id: job.project_id,
      asset_type: "VIDEO",
      position: 100,
      bucket: config.SUPABASE_ASSETS_BUCKET,
      object_path: finalPath,
      public_url: finalPublic,
      provider: "scene_concat",
      metadata_json: { scene_count: sceneUrls.length },
    });

    const script = String(gen.spoken_script ?? gen.script ?? "").trim();
    const apiKey = config.OPENAI_API_KEY;
    if (script && apiKey && finalPublic) {
      try {
        const audioPath = `assets/audios/${safeRun}/${safeTask}/voiceover.mp3`;
        const tts = await synthesizeSpeechToStorage(config, apiKey, script, audioPath);
        await tryInsertApiCallAudit(db, {
          projectId: job.project_id,
          runId: job.run_id,
          taskId: job.task_id,
          step: "openai_tts_voiceover",
          provider: "openai",
          model: config.OPENAI_TTS_MODEL,
          ok: true,
          requestJson: {
            endpoint: "https://api.openai.com/v1/audio/speech",
            voice: config.OPENAI_TTS_VOICE,
            input_excerpt: script.slice(0, 8000),
          },
          responseJson: { object_path: tts.object_path, public_url: tts.public_url },
        });
        const { srt } = buildRoughSrt(script, 60);
        const srtPath = `assets/subtitles/${safeRun}/${safeTask}/captions.srt`;
        await uploadBuffer(config, srtPath, Buffer.from(srt, "utf8"), "text/plain");

        const muxEndpoint = `${videoAssemblyBaseUrl.replace(/\/$/, "")}/mux?async=1`;
        const muxPayload = {
          video_url: finalPublic,
          audio_url: tts.public_url,
          task_id: job.task_id,
          run_id: job.run_id,
        };
        const muxRes = await fetch(muxEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(muxPayload),
        });
        const muxJson = (await muxRes.json()) as { request_id?: string };
        if (muxRes.ok && muxJson.request_id) {
          const muxed = await pollVideoAssemblyJob(videoAssemblyBaseUrl, muxJson.request_id);
          await tryInsertApiCallAudit(db, {
            projectId: job.project_id,
            runId: job.run_id,
            taskId: job.task_id,
            step: "video_assembly_mux",
            provider: "video_assembly",
            model: null,
            ok: true,
            requestJson: { endpoint: muxEndpoint, body: muxPayload },
            responseJson: { request_id: muxJson.request_id, public_url: muxed.public_url },
          });
          if (muxed.public_url) {
            const muxBuf = await downloadUrl(muxed.public_url);
            const outPath = `assets/videos/${safeRun}/${safeTask}/final_muxed.mp4`;
            const up = await uploadBuffer(config, outPath, muxBuf, "video/mp4");
            await insertAsset(db, {
              asset_id: `${job.task_id}__VIDEO_FINAL_v1`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
              task_id: job.task_id,
              project_id: job.project_id,
              asset_type: "VIDEO",
              position: 200,
              bucket: config.SUPABASE_ASSETS_BUCKET,
              object_path: outPath,
              public_url: up.public_url,
              provider: "mux",
              metadata_json: {},
            });
          }
        }
      } catch {
        // optional post-process
      }
    }
  }

  await db.query(
    `UPDATE caf_core.content_jobs SET scene_bundle_state = $1::jsonb, updated_at = now() WHERE id = $2`,
    [
      JSON.stringify({
        status: "completed",
        scene_count: sceneUrls.length,
        merged_url: mergedUrl ?? null,
      }),
      job.id,
    ]
  );

}
