import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { listRenderingJobs, listRenderingRuns } from "../repositories/rendering-health.js";
import { getRenderControlSnapshot } from "./render-control.js";
import { probeRendererQueue, probeRenderingDeps } from "./rendering-deps-probe.js";

export async function buildRenderingHealthSnapshot(db: Pool, config: AppConfig) {
  const [rendering, renderer_queue, db_jobs, db_runs] = await Promise.all([
    probeRenderingDeps(config),
    probeRendererQueue(config.RENDERER_BASE_URL),
    listRenderingJobs(db),
    listRenderingRuns(db),
  ]);

  const control = getRenderControlSnapshot();
  const supabaseAssets =
    Boolean(config.SUPABASE_URL?.trim()) &&
    Boolean(config.SUPABASE_SERVICE_ROLE_KEY?.trim()) &&
    Boolean(config.SUPABASE_ASSETS_BUCKET?.trim());

  return {
    ok: true,
    service: "caf-core",
    checked_at: new Date().toISOString(),
    rendering,
    renderer_queue,
    control,
    concurrency: {
      carousel_render: config.CAROUSEL_RENDER_CONCURRENCY,
      video_render: config.VIDEO_RENDER_CONCURRENCY,
    },
    video: {
      heygen_api_key_configured: Boolean(config.HEYGEN_API_KEY?.trim()),
      heygen_api_base: config.HEYGEN_API_BASE,
      supabase_assets_configured: supabaseAssets,
      openai_api_key_configured: Boolean(config.OPENAI_API_KEY?.trim()),
      openai_generation_mode: config.OPENAI_GENERATION_MODE,
    },
    db: {
      rendering_jobs: db_jobs,
      rendering_runs: db_runs,
    },
  };
}
