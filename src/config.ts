import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// `.env` wins over inherited OS/IDE env (e.g. wrong RENDERER_BASE_URL from the shell). Fly/production has no `.env` in the image.
loadDotenv({ override: true });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3847),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL required for CAF Core Postgres"),

  /**
   * When true (default), apply pending SQL migrations from ./migrations on API startup (idempotent, advisory-locked).
   * Set CAF_RUN_MIGRATIONS_ON_START=0 if schema is applied only via CI or `npm run migrate`.
   */
  CAF_RUN_MIGRATIONS_ON_START: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return true;
      const s = v.trim().toLowerCase();
      if (s === "0" || s === "false" || s === "no") return false;
      return true;
    }),

  CAF_CORE_API_TOKEN: z.string().optional(),
  CAF_CORE_REQUIRE_AUTH: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),

  /**
   * Publishing executor mode for the publications "start" endpoint.
   * - "none": claim placement + return n8n payload; external worker posts and calls /complete
   * - "dry_run": Core completes with a fake platform_post_id (plumbing tests)
   * - "meta": Core calls Meta Graph (Facebook Page + Instagram) using project_integrations + META_GRAPH_API_VERSION
   */
  CAF_PUBLISH_EXECUTOR: z.enum(["none", "dry_run", "meta"]).default("none"),

  /** Graph API version for Meta publishing (e.g. v21.0, v25.0). */
  META_GRAPH_API_VERSION: z.string().default("v21.0"),

  /**
   * Optional env overrides for CAF_PUBLISH_EXECUTOR=meta — one secret per channel (Fly / .env).
   * Each overrides `project_integrations` credentials_json.access_token for META_FB or META_IG only.
   */
  CAF_META_FB_PAGE_ACCESS_TOKEN: z.string().optional(),
  CAF_META_IG_PAGE_ACCESS_TOKEN: z.string().optional(),
  /**
   * Legacy single secret: if `CAF_META_FB_PAGE_ACCESS_TOKEN` (resp. IG) is unset, this is used for
   * Facebook (resp. Instagram) publishes instead, so existing deploys keep working until Fly secrets are split.
   */
  CAF_META_PAGE_ACCESS_TOKEN: z.string().optional(),

  DECISION_ENGINE_VERSION: z.string().default("v1"),

  // Default scoring weights (override per request or DB later)
  SCORE_WEIGHT_CONFIDENCE: z.coerce.number().default(0.35),
  SCORE_WEIGHT_PLATFORM_FIT: z.coerce.number().default(0.25),
  SCORE_WEIGHT_NOVELTY: z.coerce.number().default(0.2),
  SCORE_WEIGHT_PAST_PERF: z.coerce.number().default(0.2),

  DEFAULT_MIN_SCORE_TO_GENERATE: z.coerce.number().default(0.35),
  DEFAULT_MAX_VARIATIONS: z.coerce.number().int().default(1),
  DEFAULT_MAX_DAILY_JOBS: z.coerce.number().int().optional(),
  /** Aggregate cap on planned carousel jobs per run when project constraints leave these null. */
  DEFAULT_MAX_CAROUSEL_JOBS_PER_RUN: z.coerce.number().int().nonnegative().default(10),
  /** Aggregate cap on planned video/reel jobs per run when project constraints leave these null. */
  DEFAULT_MAX_VIDEO_JOBS_PER_RUN: z.coerce.number().int().nonnegative().default(4),
  /**
   * Planned jobs per flow_type for flows that are not carousel/video (or not listed in default-plan-caps).
   * Without this, each (candidate × flow) row could become a job — exploding the run plan.
   */
  DEFAULT_OTHER_FLOW_PLAN_CAP: z.coerce.number().int().nonnegative().default(1),

  RENDERER_BASE_URL: z.string().default("http://localhost:3333"),
  /**
   * Directory of carousel .hbs files served at GET /api/templates/* for the Puppeteer renderer
   * (set CAF_TEMPLATE_API_URL=https://your-caf-core-host on the renderer). Fly image uses /app/carousel-templates.
   */
  CAROUSEL_TEMPLATES_DIR: z
    .string()
    .optional()
    .transform((v) => {
      const t = v?.trim();
      if (t) return path.resolve(t);
      return path.resolve(process.cwd(), "services", "renderer", "templates");
    }),
  /** Per-slide HTTP timeout for POST /render-binary in the job pipeline (ms). */
  CAROUSEL_RENDERER_SLIDE_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  /**
   * Extra attempts when the renderer returns a transient 5xx (Puppeteer "Target closed", new tab failures, etc.).
   * Total tries = 1 + this value.
   */
  CAROUSEL_RENDERER_SLIDE_RETRY_ATTEMPTS: z.coerce.number().int().min(0).max(8).default(3),
  VIDEO_ASSEMBLY_BASE_URL: z.string().default("http://localhost:3334"),
  /**
   * How long CAF Core polls GET /status/:id after async POST /concat-videos (download scenes + ffmpeg + Supabase upload).
   * Raise if concat often hits "video-assembly async timeout" on long runs or slow storage.
   */
  VIDEO_ASSEMBLY_CONCAT_POLL_MAX_MS: z.coerce.number().int().min(60_000).max(7_200_000).default(600_000),
  /**
   * How long Core polls after async POST /mux. Subtitle burn re-encodes the full video (libx264) and often exceeds concat time.
   * Default 30m avoids giving up while ffmpeg is still healthy on the assembly worker.
   */
  VIDEO_ASSEMBLY_MUX_POLL_MAX_MS: z.coerce.number().int().min(60_000).max(7_200_000).default(1_800_000),

  OPENAI_API_KEY: z.string().optional(),
  /** Base URL for REST calls (chat, videos). Videos API: POST/GET `/videos`. */
  OPENAI_API_BASE: z.string().default("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().default("gpt-4o"),
  /** Vision-capable model for post-approval content review (images + text). */
  OPENAI_APPROVAL_REVIEW_MODEL: z.string().default("gpt-4o"),
  /** Max carousel / image assets to attach per approved job (OpenAI vision). */
  LLM_APPROVAL_REVIEW_MAX_IMAGES: z.coerce.number().int().min(0).max(16).default(14),
  /** Serialized copy bundle (hook, caption, video plan, scenes) max size before truncation. */
  LLM_APPROVAL_REVIEW_MAX_TEXT_CHARS: z.coerce.number().int().min(2000).max(200_000).default(28_000),
  /**
   * Legacy binary switch for output-schema validation.
   *
   * Unset / empty → `true` (skip) for historical reasons. Kept for backward
   * compatibility with existing deployments and docs. New deployments should
   * prefer the tri-state `CAF_OUTPUT_SCHEMA_VALIDATION_MODE` below, which
   * supports a gradual rollout: `skip → warn → enforce`.
   *
   * When `CAF_OUTPUT_SCHEMA_VALIDATION_MODE` is set explicitly it wins; this
   * flag is only consulted as the fallback.
   */
  CAF_SKIP_OUTPUT_SCHEMA_VALIDATION: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return true;
      const s = v.trim().toLowerCase();
      if (s === "0" || s === "false" || s === "no") return false;
      return s === "1" || s === "true" || s === "yes";
    }),
  /**
   * Tri-state rollout control for LLM output-schema validation:
   *   - `skip`    — do not run Flow Engine `output_schemas` validation
   *   - `warn`    — run validation, log failures to stderr, and record them
   *                 on `generation_payload.schema_validation_warnings`, but
   *                 do NOT fail the generation (safe for staging rollouts)
   *   - `enforce` — run validation and fail the generation on invalid output
   *                 (legacy `CAF_SKIP_OUTPUT_SCHEMA_VALIDATION=0` behavior)
   *
   * Leave unset to preserve the legacy binary flag's meaning. Recommended
   * rollout: `skip` → `warn` (staging) → `enforce` (prod) once warnings are
   * driven to zero.
   */
  CAF_OUTPUT_SCHEMA_VALIDATION_MODE: z
    .enum(["skip", "warn", "enforce"])
    .optional(),
  /**
   * When true (default), QC never assigns `recommended_route = AUTO_PUBLISH` for passing jobs — they get `HUMAN_REVIEW`
   * so every job is intended for the human queue (Core still ends pipeline in IN_REVIEW; this aligns DB route + QC payload).
   * Set to 0/false/no to allow legacy AUTO_PUBLISH when QC passes and risk is low.
   */
  CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return true;
      const s = v.trim().toLowerCase();
      if (s === "0" || s === "false" || s === "no") return false;
      return true;
    }),
  /**
   * Upper bound for chat.completions `max_tokens` (completion tokens). gpt-4o allows at most 16384; DB templates often use 25k+.
   */
  OPENAI_MAX_COMPLETION_TOKENS: z.coerce.number().int().positive().default(16384),

  /**
   * Soft cap on serialized `signal_pack` JSON in LLM prompts (~4 chars/token heuristic leaves room for
   * system text, `script_input`, and completion within 128k-token models).
   */
  LLM_SIGNAL_PACK_JSON_MAX_CHARS: z.coerce.number().int().min(2000).max(600_000).default(56_000),
  /** First N rows from `overall_candidates_json` included in LLM context before further shrinking. */
  LLM_SIGNAL_PACK_MAX_CANDIDATE_ROWS: z.coerce.number().int().min(1).max(2000).default(55),
  /** Truncate individual string fields in the signal pack context (e.g. embedded HTML blobs). */
  LLM_SIGNAL_PACK_MAX_STRING_FIELD_CHARS: z.coerce.number().int().min(500).max(200_000).default(14_000),

  /**
   * Learning contexts are injected both as individual placeholders and inside `{{creation_pack_json}}`.
   * Keep them bounded so we don't exceed 128k-token models when signal packs are large.
   */
  LLM_LEARNING_GLOBAL_CONTEXT_MAX_CHARS: z.coerce.number().int().min(0).max(200_000).default(12_000),
  LLM_LEARNING_PROJECT_CONTEXT_MAX_CHARS: z.coerce.number().int().min(0).max(200_000).default(12_000),
  LLM_LEARNING_GUIDANCE_MAX_CHARS: z.coerce.number().int().min(0).max(200_000).default(18_000),
  /**
   * Carousel generation: inject short “lane memory” from recent post-approval LLM reviews + stored job copy
   * (hook, title, caption excerpt, slide headlines) so the model avoids near-duplicate angles vs recently approved work.
   * Set max chars or max jobs to 0 to disable.
   */
  LLM_APPROVAL_ANTI_REPETITION_MAX_CHARS: z.coerce.number().int().min(0).max(50_000).default(3500),
  LLM_APPROVAL_ANTI_REPETITION_MAX_JOBS: z.coerce.number().int().min(0).max(40).default(6),

  /** HeyGen v2: default voice id for video_inputs[0].voice when config does not set it */
  HEYGEN_DEFAULT_VOICE_ID: z.string().optional(),

  /** Max extra signal-pack rows the scene-assembly candidate router LLM may add per run (0 disables). */
  SCENE_ASSEMBLY_ROUTER_MAX_SEEDS: z.coerce.number().int().min(0).max(20).default(5),

  /** Scene assembly: target scene count (LLM + post-trim). Default 6–7 ≈ ~24–35s at 4s/clip for short-form stack. */
  SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MIN: z.coerce.number().int().min(1).max(20).default(6),
  SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MAX: z.coerce.number().int().min(1).max(20).default(7),
  /** Per-scene clip length hint (Sora / short clip generators). */
  SCENE_ASSEMBLY_CLIP_DURATION_SEC: z.coerce.number().min(1).max(60).default(4),
  /**
   * Spoken-script length hints (merge-expand, auto “short script” detection): assumed TTS pace at 1× for timeline fit.
   * ~145 ≈ clear short-form VO; raise slightly if your copy is denser.
   */
  SCENE_VO_WORDS_PER_MINUTE: z.coerce.number().min(80).max(220).default(145),
  /**
   * Multiplier on the word budget vs nominal (wpm × seconds). Below 1.0 leaves headroom: TTS is often slower than
   * textbook wpm; the pipeline trims over-budget scripts before TTS.
   */
  SCENE_VO_WORD_BUDGET_SAFETY: z.coerce.number().min(0.45).max(1).default(0.72),
  /**
   * When true, mux may ffmpeg `atempo` so audio length matches video (alters playback speed).
   * Default false: keep 1× narration; use script length + SCENE_VO_WORDS_PER_MINUTE to match scene timeline.
   */
  SCENE_MUX_STRETCH_AUDIO_TO_VIDEO: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return false;
      const s = v.trim().toLowerCase();
      return s === "1" || s === "true" || s === "yes";
    }),
  /**
   * Scene assembly only: time-stretch TTS to match stitched video length before mux so burned subtitles
   * (locked to video) stay aligned with heard narration. Independent of SCENE_MUX_STRETCH_AUDIO_TO_VIDEO.
   */
  SCENE_ASSEMBLY_STRETCH_TTS_TO_VIDEO: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return true;
      const s = v.trim().toLowerCase();
      if (s === "0" || s === "false" || s === "no") return false;
      return true;
    }),
  /**
   * When true, trim spoken_script to a word budget before TTS (recovery / tight mux). Default false: script from the
   * script flow is authoritative; scenes and prompts adapt — do not shorten VO in the main assembly path.
   */
  SCENE_ENFORCE_SPOKEN_SCRIPT_WORD_TRIM: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return false;
      const s = v.trim().toLowerCase();
      return s === "1" || s === "true" || s === "yes";
    }),
  /**
   * Prepend full VO + bundle continuity to each Sora/HeyGen scene clip prompt so visuals match global context.
   */
  SCENE_PREPEND_GLOBAL_CONTEXT_TO_CLIP_PROMPTS: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return true;
      const s = v.trim().toLowerCase();
      if (s === "0" || s === "false" || s === "no") return false;
      return true;
    }),
  /** Scene assembly SRT: min seconds per cue; shorter windows merge adjacent sentences into one cue. */
  SCENE_SUBTITLE_MIN_CUE_SEC: z.coerce.number().min(0.35).max(5).default(1),
  /**
   * When scenes lack clip URLs: `sora` = OpenAI Videos API (Sora 2) per scene; `heygen` = HeyGen Video Agent no-avatar.
   * Sora uploads MP4s to Supabase (public URL) because `/videos/{id}/content` requires auth.
   */
  SCENE_ASSEMBLY_CLIP_PROVIDER: z.enum(["sora", "heygen"]).default("sora"),
  /** Model for `POST /v1/videos` (e.g. sora-2, sora-2-pro). */
  SORA_VIDEO_MODEL: z.string().default("sora-2"),
  /**
   * Video size for Sora (portrait short-form: 720x1280 on sora-2; sora-2-pro also supports 1080x1920).
   * See OpenAI video generation guide.
   */
  SORA_VIDEO_SIZE: z.string().default("720x1280"),
  /** Max time to poll each Sora job (`GET /videos/{id}`) before failing the scene. */
  SORA_POLL_MAX_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(900_000),
  /**
   * Opt-in: when `SCENE_ASSEMBLY_CLIP_PROVIDER=heygen`, render missing per-scene clips with HeyGen Video Agent
   * (no-avatar) before concat. Default off — use Sora (`provider=sora`) or upstream URLs on `scene_bundle.scenes[]`.
   */
  SCENE_ASSEMBLY_HEYGEN_CLIP_FALLBACK: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return false;
      const s = v.trim().toLowerCase();
      if (s === "1" || s === "true" || s === "yes") return true;
      return false;
    }),

  /** Single-take HeyGen / prompt-led videos: target spoken length band for LLM fallbacks. */
  VIDEO_TARGET_DURATION_MIN_SEC: z.coerce.number().min(5).max(300).default(30),
  VIDEO_TARGET_DURATION_MAX_SEC: z.coerce.number().min(5).max(600).default(60),
  /**
   * When true (default), HeyGen renders enforce `spoken_script` word count from VIDEO_TARGET_* × SCENE_VO_WORDS_PER_MINUTE
   * (hard trim above max; below min → one LLM expand if OPENAI_API_KEY, else fail). HeyGen avatar API has no duration field — length follows TTS.
   */
  HEYGEN_ENFORCE_SPOKEN_SCRIPT_WORD_BOUNDS: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return true;
      const s = v.trim().toLowerCase();
      if (s === "0" || s === "false" || s === "no") return false;
      return true;
    }),

  /** Supabase Storage (asset uploads from CAF Core) */
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_ASSETS_BUCKET: z.string().default("assets"),
  /**
   * Abort `fetch()` when pulling MP4s by URL (scene import, merged video download). 0 disables (not recommended in production).
   * Supabase JS `download()` uses the same limit via Promise.race in `downloadBufferFromUrl`.
   */
  STORAGE_HTTP_FETCH_TIMEOUT_MS: z.coerce.number().int().min(0).max(3_600_000).default(180_000),
  /**
   * On startup, create a tiny marker object under each known top-level prefix when that prefix is still empty,
   * so folders (scenes, videos, …) show in the Supabase Storage UI before the first real upload.
   * Set to 0/false to skip.
   */
  SUPABASE_ENSURE_ASSET_PREFIXES: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return true;
      const s = v.trim().toLowerCase();
      if (s === "0" || s === "false" || s === "no") return false;
      return true;
    }),

  HEYGEN_API_KEY: z.string().optional(),
  HEYGEN_API_BASE: z.string().default("https://api.heygen.com"),
  /**
   * When `heygen_config` has no avatar pool/id for avatar flows, merge this HeyGen avatar_id (same as prompt_avatar_id + script_avatar_id).
   * Prefer DB config per project; use env for a single brand default across projects.
   */
  HEYGEN_DEFAULT_AVATAR_ID: z.string().optional(),
  /**
   * JSON array: `[{"avatar_id":"...","voice_id":"..."}]` — used when DB has no `*_avatar_pool_json` / `*_avatar_id`.
   * voice_id optional if HEYGEN_DEFAULT_VOICE_ID or a voice row exists.
   */
  HEYGEN_DEFAULT_AVATAR_POOL_JSON: z.string().optional(),
  /**
   * HeyGen `voice.type: silence` duration (seconds) when we only have a visual `video_prompt` and no spoken script.
   * Stops TTS from narrating the entire cinematic prompt (audio-only / blank-frame artifacts). Range 1–100 per HeyGen API.
   */
  HEYGEN_VISUAL_ONLY_SILENCE_DURATION_SEC: z.coerce.number().min(1).max(100).default(15),
  /**
   * Max time to poll HeyGen generation before treating as "not ready yet".
   * IMPORTANT: A poll timeout does NOT necessarily mean HeyGen failed — long renders can exceed 10 minutes.
   */
  HEYGEN_POLL_MAX_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(2_700_000),
  /**
   * Video Agent duration hint floor for full jobs (embedded in the agent `prompt`; v3 `POST /v3/video-agents` has no `duration_sec` field).
   * Values below this (e.g. bad LLM `estimated_runtime_seconds`) are bumped so HeyGen is not asked for ultra-short renders.
   */
  HEYGEN_AGENT_MIN_DURATION_SEC: z.coerce.number().int().min(10).max(120).default(30),
  /**
   * Scene-level HeyGen Video Agent fallback: minimum duration_sec per clip. Keeps 4s assembly hints from clamping to 5s at HeyGen.
   */
  HEYGEN_SCENE_AGENT_CLIP_MIN_SEC: z.coerce.number().int().min(5).max(60).default(12),
  /**
   * HeyGen v3 `POST /v3/videos` accepts `caption: { file_format: "srt" }` which causes HeyGen to render an SRT
   * sidecar (exposed as `data.subtitle_url` in the v3 status response) — but the MP4 itself is **not** modified.
   * When this flag is on (default) CAF downloads the SRT, calls the local video-assembly `/burn-subtitles` service
   * to burn captions into the MP4 with ffmpeg, and uploads the captioned version to Supabase as the canonical asset.
   * Set to 0/false to keep the raw HeyGen MP4 (no captions). Falls back to a synthesized SRT built from
   * `spoken_script` + reported duration when HeyGen does not return one (Video Agent / silence-voice paths).
   */
  HEYGEN_BURN_SUBTITLES: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return true;
      const s = v.trim().toLowerCase();
      if (s === "0" || s === "false" || s === "no") return false;
      return true;
    }),
  /** Max time to poll video-assembly /burn-subtitles for the HeyGen post-render burn step. */
  HEYGEN_BURN_SUBTITLES_POLL_MAX_MS: z.coerce.number().int().min(60_000).max(7_200_000).default(900_000),
  /** Optional ffmpeg `force_style` for HeyGen burn-in (overrides MUX_BURN_SUBTITLE_FORCE_STYLE for HeyGen jobs only). */
  HEYGEN_BURN_SUBTITLE_FORCE_STYLE: z.string().optional(),

  /** OpenAI TTS (e.g. tts-1, tts-1-hd) */
  OPENAI_TTS_MODEL: z.string().default("tts-1"),
  OPENAI_TTS_VOICE: z.string().default("nova"),

  /**
   * When true, the API process runs editorial analysis on an interval (learning rules + engineering insight + optional OpenAI on notes).
   * Enable on production Core with Fly secrets; use EDITORIAL_ANALYSIS_CRON_PROJECT_SLUGS to limit tenants.
   */
  EDITORIAL_ANALYSIS_CRON_ENABLED: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return false;
      const s = v.trim().toLowerCase();
      return s === "1" || s === "true" || s === "yes";
    }),
  /** Milliseconds between editorial analysis runs (default 24h). */
  EDITORIAL_ANALYSIS_CRON_INTERVAL_MS: z.coerce.number().int().min(60_000).max(604_800_000).default(86_400_000),
  /** Comma-separated slugs; empty = every active project except caf-global. */
  EDITORIAL_ANALYSIS_CRON_PROJECT_SLUGS: z.string().optional(),
  /** Lookback window passed to analyzeEditorialPatterns. */
  EDITORIAL_ANALYSIS_CRON_WINDOW_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Wait after process start before the first tick (ms). */
  EDITORIAL_ANALYSIS_CRON_INITIAL_DELAY_MS: z.coerce.number().int().min(0).max(3_600_000).default(120_000),
});

export type AppConfig = z.infer<typeof envSchema>;

export type OutputSchemaValidationMode = "skip" | "warn" | "enforce";

/**
 * Resolve the output-schema validation rollout mode from the new tri-state
 * env (`CAF_OUTPUT_SCHEMA_VALIDATION_MODE`) with fallback to the legacy
 * `CAF_SKIP_OUTPUT_SCHEMA_VALIDATION` flag. Centralizing this here keeps the
 * rollout semantics in one file instead of scattered across callers.
 */
export function resolveOutputSchemaValidationMode(
  config: Pick<AppConfig, "CAF_OUTPUT_SCHEMA_VALIDATION_MODE" | "CAF_SKIP_OUTPUT_SCHEMA_VALIDATION">
): OutputSchemaValidationMode {
  if (config.CAF_OUTPUT_SCHEMA_VALIDATION_MODE) return config.CAF_OUTPUT_SCHEMA_VALIDATION_MODE;
  return config.CAF_SKIP_OUTPUT_SCHEMA_VALIDATION ? "skip" : "enforce";
}

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment: ${JSON.stringify(msg)}`);
  }
  const d = parsed.data;
  const sceneLo = Math.min(d.SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MIN, d.SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MAX);
  const sceneHi = Math.max(d.SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MIN, d.SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MAX);
  const vidLo = Math.min(d.VIDEO_TARGET_DURATION_MIN_SEC, d.VIDEO_TARGET_DURATION_MAX_SEC);
  const vidHi = Math.max(d.VIDEO_TARGET_DURATION_MIN_SEC, d.VIDEO_TARGET_DURATION_MAX_SEC);
  return {
    ...d,
    SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MIN: sceneLo,
    SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MAX: sceneHi,
    VIDEO_TARGET_DURATION_MIN_SEC: vidLo,
    VIDEO_TARGET_DURATION_MAX_SEC: vidHi,
  };
}
