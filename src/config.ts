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
   * Embed the CAF Review Next.js workbench on the same host as Core (default on).
   * Unmatched HTTP paths proxy to the internal Review server; Core API paths stay on Fastify.
   */
  CAF_REVIEW_ENABLED: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return true;
      const s = v.trim().toLowerCase();
      if (s === "0" || s === "false" || s === "no") return false;
      return true;
    }),
  /** Loopback port for the internal Review Next.js process. */
  CAF_REVIEW_PORT: z.coerce.number().default(3000),
  /** Use `next dev` instead of the standalone build (default in development when standalone is missing). */
  CAF_REVIEW_DEV: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
  /** Directory containing Review `server.js` from `next build` (standalone output). */
  CAF_REVIEW_STANDALONE_DIR: z.string().optional(),
  /** Public URL operators use in the browser (sets Review `NEXT_PUBLIC_APP_URL`). */
  CAF_PUBLIC_URL: z.string().optional(),

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
  /**
   * Comma-separated `FROM=TO` project slug pairs. Meta publish for `FROM` uses `caf_core.project_integrations`
   * META_FB / META_IG rows from `TO` (e.g. `CUISINA=SNS` — same Facebook Page and Instagram account as SNS).
   */
  CAF_META_ACCOUNT_SOURCE_MAP: z.string().optional(),

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
   * DraftPackage contract enforcement (5A).
   * - skip: do not validate execution-readiness
   * - warn: validate and log warnings; attempt safe auto-repair where possible
   * - enforce: fail generation when the output is not execution-ready
   *
   * Keep default "warn" so existing prompts continue working while we tighten contracts.
   */
  CAF_DRAFT_PACKAGE_CONTRACT_MODE: z.enum(["skip", "warn", "enforce"]).default("warn"),
  /**
   * Rendering throughput controls (5B). Defaults keep existing sequential behavior.
   * Set to 2–4 for small parallelism; keep separate caps because HeyGen and the renderer have different limits.
   */
  CAROUSEL_RENDER_CONCURRENCY: z.coerce.number().int().min(1).max(12).default(1),
  VIDEO_RENDER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
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

  /** Creative intelligence: max bytes when downloading reference images/video for ingest. */
  CREATIVE_INTEL_MAX_DOWNLOAD_BYTES: z.coerce.number().int().min(64_000).max(500_000_000).default(80_000_000),
  /** Max images passed to OpenAI vision per analysis. */
  CREATIVE_INTEL_VISION_MAX_IMAGES: z.coerce.number().int().min(1).max(16).default(12),
  /** Max ffmpeg-extracted frames per video reference. */
  CREATIVE_INTEL_VIDEO_MAX_FRAMES: z.coerce.number().int().min(1).max(24).default(10),
  /** Optional path to ffmpeg binary; default search PATH. */
  CREATIVE_INTEL_FFMPEG_PATH: z.string().optional(),
  /** Run vision analysis inline on ingest (when false, analyses stay pending — not implemented for worker). */
  CREATIVE_INTEL_ANALYZE_INLINE: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return true;
      const s = v.trim().toLowerCase();
      if (s === "0" || s === "false" || s === "no") return false;
      return true;
    }),
  OPENAI_CREATIVE_INTEL_VISION_MODEL: z.string().default("gpt-4o-mini"),
  /** Inject creative style block from DB / signal pack into generation (see llm-generator). */
  CREATIVE_INTEL_INJECT_IN_GENERATION: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return false;
      const s = v.trim().toLowerCase();
      return s === "1" || s === "true" || s === "yes";
    }),
  LLM_CREATIVE_INTEL_GUIDANCE_MAX_CHARS: z.coerce.number().int().min(0).max(50_000).default(4000),
  /** Planner: boost past_performance when idea grounding includes ci_* creative insight refs. */
  CREATIVE_INTEL_PLANNER_PAST_PERFORMANCE_BOOST: z.coerce.number().min(0).max(1).default(0.88),

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

  /** When false (default), FLOW_TOP_PERFORMER_MIMIC_* draft/render paths stay off even if flow types are enabled. */
  MIMIC_IMAGE_ENABLED: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return false;
      const s = v.trim().toLowerCase();
      return s === "1" || s === "true" || s === "yes";
    }),
  /** Mimic render pixels: BFL FLUX Klein (default), DashScope Qwen, NVIDIA NIM, or OpenAI gpt-image-1. */
  MIMIC_IMAGE_PROVIDER: z.enum(["openai", "nvidia", "dashscope", "bfl"]).default("bfl"),
  /** Black Forest Labs API key (https://api.bfl.ai) when MIMIC_IMAGE_PROVIDER=bfl. */
  BFL_API_KEY: z.string().optional(),
  BFL_API_BASE: z.string().default("https://api.bfl.ai"),
  /** Endpoint slug, e.g. flux-2-flex (typography), flux-2-klein-4b, flux-2-pro. */
  MIMIC_IMAGE_BFL_MODEL: z.string().default("flux-2-klein-4b"),
  /** FLUX.2 [flex] only — inference steps (1–50); higher improves legible on-image text. */
  MIMIC_IMAGE_BFL_STEPS: z.coerce.number().int().min(1).max(50).default(45),
  /** FLUX.2 [flex] only — guidance scale (1.5–10); higher adheres to quoted copy. */
  MIMIC_IMAGE_BFL_GUIDANCE: z.coerce.number().min(1.5).max(10).default(7),
  MIMIC_IMAGE_BFL_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(10_000).default(500),
  MIMIC_IMAGE_BFL_POLL_MAX_MS: z.coerce.number().int().min(5_000).max(600_000).default(180_000),
  MIMIC_IMAGE_BFL_SAFETY_TOLERANCE: z.coerce.number().int().min(0).max(5).default(2),
  MIMIC_IMAGE_BFL_OUTPUT_FORMAT: z.enum(["jpeg", "png", "webp"]).default("png"),
  /** When BFL edit is moderated, optionally retry via DashScope (off by default — BFL-only). */
  MIMIC_IMAGE_BFL_FALLBACK_DASHSCOPE: z.coerce.boolean().default(false),
  /**
   * When true, mimic carousel slides use a single-pass image edit from the reference frame with baked copy
   * (BFL FLUX / configured provider) instead of Puppeteer HBS overlay or separate bg-extract + compose passes.
   */
  MIMIC_CAROUSEL_TEXT_VIA_FLUX: z.coerce.boolean().default(false),
  /**
   * When true, TP-grounded carousel copy prompts include Why Mimic strategic-function blocks
   * (and brand translation when a brand profile exists). Default false = legacy semantic-fidelity copy only.
   */
  MIMIC_WHY_COPY_ENABLED: z.coerce.boolean().default(false),
  /**
   * Why Mimic / slide_intelligence: minimum chars for per-slide `why_it_works`
   * (~3 substantive sentences). Shorter values are dropped at normalize / enriched on derive.
   */
  SIL_WHY_IT_WORKS_MIN_CHARS: z.coerce.number().int().min(0).max(800).default(144),
  /** Minimum chars for deck-level `why_analysis.strategic_thesis` (~2–3 sentences). */
  SIL_STRATEGIC_THESIS_MIN_CHARS: z.coerce.number().int().min(0).max(1200).default(240),
  /** Minimum chars for per-slide `visual_description` in SIL (imagery the LLM must reinterpret). */
  SIL_VISUAL_DESCRIPTION_MIN_CHARS: z.coerce.number().int().min(0).max(800).default(96),
  /** When true, project brand_assets palette overrides carousel paper/ink in HBS text overlay. */
  MIMIC_USE_PROJECT_BRAND_PALETTE: z.coerce.boolean().default(false),
  /** When true, Nemotron layout/visual/deck hints are appended to art-only image-model prompts. */
  MIMIC_USE_BRAND_IMAGE_STYLE_HINTS: z.coerce.boolean().default(false),
  /**
   * Mimic slide image input: `reference_edit` sends the archived frame to Flux/Qwen edit;
   * `analysis_t2i` uses LLM-written prompts from Nemotron analysis (no reference pixels).
   */
  MIMIC_IMAGE_INPUT_MODE: z.enum(["reference_edit", "analysis_t2i"]).default("reference_edit"),
  /**
   * When MIMIC_IMAGE_INPUT_MODE=analysis_t2i, run OpenAI to author per-slide Flux prompts at copy generation.
   * Set 0 to use deterministic prompts from Nemotron fields only.
   */
  MIMIC_FLUX_PROMPT_LLM: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return true;
      const s = v.trim().toLowerCase();
      if (s === "0" || s === "false" || s === "no") return false;
      return true;
    }),
  /** Target visual similarity for mimic image variants (0–100). Per-project override in Runs tab. */
  MIMIC_VISUAL_SIMILARITY_PCT: z.coerce.number().int().min(0).max(100).default(70),
  /**
   * Mimic copy length vs each reference text line (default 1× reference length).
   * Use with MIMIC_COPY_CHAR_SLACK for ± few characters tolerance.
   */
  MIMIC_FULL_BLEED_COPY_REFERENCE_SCALE: z.coerce.number().min(0.2).max(1.5).default(1),
  /** ± characters allowed vs each reference on-screen line (template_bg + full_bleed). */
  MIMIC_COPY_CHAR_SLACK: z.coerce.number().int().min(0).max(32).default(4),
  /** When true (default), OCR/heuristic QA rejects mimic background plates that still contain readable text. */
  MIMIC_PLATE_TEXT_QA_ENABLED: z.coerce.boolean().default(true),
  /** When true (default), plate text QA throws and aborts upload; when false, logs a warning only. */
  MIMIC_PLATE_TEXT_QA_FAIL_ON_DETECT: z.coerce.boolean().default(true),
  /** Extra background-plate extraction attempts after text QA failure (default 2 → 3 total tries). */
  MIMIC_PLATE_TEXT_QA_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  /**
   * After mimic carousel text_blocks[] are built, run OpenAI to suggest coherent copy groupings
   * and rewrite per-box lines. Set 0 to disable.
   */
  MIMIC_COPY_COHERENCE_LLM: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return true;
      const s = v.trim().toLowerCase();
      if (s === "0" || s === "false" || s === "no") return false;
      return true;
    }),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-1"),
  /** Alibaba DashScope (Model Studio) when MIMIC_IMAGE_PROVIDER=dashscope. */
  DASHSCOPE_API_KEY: z.string().optional(),
  /** Singapore intl default; Beijing: https://dashscope.aliyuncs.com/api/v1 */
  DASHSCOPE_API_BASE: z.string().default("https://dashscope-intl.aliyuncs.com/api/v1"),
  /** qwen-image-edit-max, qwen-image-edit-plus, qwen-image-edit, qwen-image-2.0-pro, … */
  MIMIC_IMAGE_DASHSCOPE_MODEL: z.string().default("qwen-image-edit-max"),
  /** NVIDIA build.nvidia.com model when MIMIC_IMAGE_PROVIDER=nvidia (OpenAI-compatible /images/edits). */
  MIMIC_IMAGE_NVIDIA_MODEL: z.string().default("qwen/qwen-image-edit"),
  /**
   * When NVIDIA Visual GenAI (/images/edits) is unavailable (404 on catalog), fall back to OpenAI gpt-image-1
   * if OPENAI_API_KEY is set. Nemotron insights can stay on NVIDIA while mimic pixels use OpenAI.
   */
  MIMIC_IMAGE_NVIDIA_FALLBACK_OPENAI: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return false;
      const s = v.trim().toLowerCase();
      if (s === "0" || s === "false" || s === "no") return false;
      return s === "1" || s === "true" || s === "yes";
    }),
  MIMIC_IMAGE_INPUT_FIDELITY: z.enum(["high", "low"]).default("high"),
  MIMIC_IMAGE_QUALITY: z.enum(["high", "medium", "low", "auto"]).default("high"),
  /** Instagram 4:5 default */
  MIMIC_IMAGE_DEFAULT_SIZE: z.enum(["1024x1024", "1536x1024", "1024x1536", "auto"]).default("1024x1536"),

  OPENAI_API_KEY: z.string().optional(),
  /**
   * `live` — call OpenAI chat/vision APIs when OPENAI_API_KEY is set.
   * `placeholder` — skip all OpenAI text/vision generation; return deterministic stub copy (no network).
   */
  OPENAI_GENERATION_MODE: z.enum(["live", "placeholder"]).default("live"),

  /** Apify token for INPUTS scrapers (same as n8n Apify credentials / APIFY_API_TOKEN in .env). */
  APIFY_API_TOKEN: z.string().optional(),
  /** Base URL for REST calls (chat, videos). Videos API: POST/GET `/videos`. */
  OPENAI_API_BASE: z.string().default("https://api.openai.com/v1"),
  /**
   * Top-performer **processing** vision only (carousel / image / video deep passes).
   * Mimic render uses MIMIC_IMAGE_PROVIDER; job copy and approval review use OpenAI.
   */
  PROCESSING_VISION_PROVIDER: z.enum(["openai", "nvidia"]).default("openai"),
  /** NVIDIA build.nvidia.com / integrate.api.nvidia.com key when PROCESSING_VISION_PROVIDER=nvidia. */
  NVIDIA_NIM_API_KEY: z.string().optional(),
  NVIDIA_NIM_API_BASE: z.string().default("https://integrate.api.nvidia.com/v1"),
  /** Default Nemotron VL model for processing when profile model is not an nvidia/* id. */
  PROCESSING_VISION_NVIDIA_MODEL: z.string().default("nvidia/nemotron-nano-12b-v2-vl"),
  /** Nemotron VL accepts up to 4 images per request; carousel/video frames are trimmed. */
  PROCESSING_VISION_NVIDIA_MAX_IMAGES: z.coerce.number().int().min(1).max(8).default(4),
  /** Per-request timeout for processing vision (Nemotron/OpenAI multimodal); large carousels can be slow. */
  PROCESSING_VISION_CHAT_TIMEOUT_MS: z.coerce.number().int().min(30_000).max(900_000).default(300_000),

  /**
   * Google Document AI Enterprise OCR for carousel reference + output text analysis.
   * @see https://docs.cloud.google.com/document-ai/docs/enterprise-document-ocr
   */
  DOCUMENT_AI_ENABLED: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return false;
      const s = v.trim().toLowerCase();
      return s === "1" || s === "true" || s === "yes";
    }),
  DOCUMENT_AI_PROJECT_ID: z.string().optional(),
  DOCUMENT_AI_LOCATION: z.string().default("us"),
  /** Enterprise Document OCR processor id (from Cloud Console). */
  DOCUMENT_AI_PROCESSOR_ID: z.string().optional(),
  /** Optional frozen processor version, e.g. pretrained-ocr-v2.1-2024-08-07 */
  DOCUMENT_AI_PROCESSOR_VERSION: z.string().optional(),
  /** Inline service account JSON (preferred on Fly when org policy allows keys). */
  DOCUMENT_AI_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  /**
   * Cloud Run proxy URL when org policy blocks service account keys (iam.disableServiceAccountKeyCreation).
   * Deploy services/document-ai-proxy on Cloud Run — it uses the runtime service account (no JSON key).
   */
  DOCUMENT_AI_PROXY_URL: z.string().optional(),
  /** Shared bearer token for DOCUMENT_AI_PROXY_URL (set same value on Cloud Run). */
  DOCUMENT_AI_PROXY_TOKEN: z.string().optional(),

  OPENAI_MODEL: z.string().default("gpt-4o"),
  /** Vision-capable model for post-approval content review (images + text). */
  OPENAI_APPROVAL_REVIEW_MODEL: z.string().default("gpt-4o"),
  /** Post-approval generated-output analysis: nvidia (Nemotron VL, default) or openai fallback. */
  APPROVAL_REVIEW_VISION_PROVIDER: z.enum(["nvidia", "openai"]).default("nvidia"),
  /** Nemotron model for approval review when APPROVAL_REVIEW_VISION_PROVIDER=nvidia. */
  APPROVAL_REVIEW_NVIDIA_MODEL: z.string().optional(),
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
   * Serialized `creation_pack` cap for top-performer mimic flows (signal pack + strategy + brand + hints).
   * Job-level `mimic_v1.visual_guideline` is injected separately — avoid duplicating full pack entries here.
   */
  /**
   * Serialized full `creation_pack` cap for standard carousel flows (strategy + brand + product + signal_pack).
   * Mimic flows use `LLM_MIMIC_CREATION_PACK_JSON_MAX_CHARS` instead.
   */
  LLM_CREATION_PACK_JSON_MAX_CHARS: z.coerce.number().int().min(2000).max(600_000).default(64_000),
  /** Max JSON size for mimic-flow `{{creation_pack_json}}` (visual structure lives on job `mimic_v1`). */
  LLM_MIMIC_CREATION_PACK_JSON_MAX_CHARS: z.coerce.number().int().min(2000).max(600_000).default(16_000),
  /** Tighter cap for `signal_pack` inside mimic creation packs (full pack default is too large). */
  LLM_MIMIC_SIGNAL_PACK_JSON_MAX_CHARS: z.coerce.number().int().min(2000).max(200_000).default(28_000),
  /** Max JSON chars for per-job mimic grounding (`slide_copy_layout` + deck metadata) appended to copy prompts. */
  LLM_MIMIC_GROUNDING_JSON_MAX_CHARS: z.coerce.number().int().min(4000).max(200_000).default(24_000),

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

  /**
   * HeyGen output pricing proxy ($ USD per minute of rendered video). From HeyGen plan / credits.
   * Stored on api_call_audit.estimated_cost_usd with billable_video_seconds when duration is known. 0 = skip USD.
   */
  CAF_COST_HEYGEN_USD_PER_VIDEO_MINUTE: z.coerce.number().min(0).default(0),
  /**
   * Carousel Puppeteer host ($ USD per hour of machine time). Fly invoice ÷ hours, or `fly machines list` allocatable rate.
   * Each slide: `(HTTP_latency_ms / 3_600_000) × this` — assumes one worker busy during the request. 0 = skip USD.
   */
  CAF_COST_FLY_CAROUSEL_RENDERER_USD_PER_HOUR: z.coerce.number().min(0).default(0),

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

  /**
   * **Default on:** top-performer carousel may HTTP-fetch Instagram embed HTML (`/embed/`, then
   * `/embed/captioned/`, `/embed/?omitscript=true` — merged) and extract CDN image links when
   * `payload_json` lacks child slide URLs but the row looks like a carousel (`Sidecar`, `img_index`, …).
   * Set `CAF_INSTAGRAM_EMBED_CAROUSEL_FETCH=0` (or `false` / `no` / `off`) to disable globally. Instagram may
   * block datacenters — prefer `carousel_slide_urls` in ingest when you need reliability, or
   * `CAF_INSTAGRAM_EMBED_HTTP_PROXY` for CONNECT egress.
   * Per tenant: `criteria_json.inputs_insights.instagram_embed_carousel_fetch` — explicit `false` /
   * `"false"` / `"0"` disables even when env default is on; `true` / `"true"` / `"1"` forces on.
   */
  CAF_INSTAGRAM_EMBED_CAROUSEL_FETCH: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return true;
      const s = v.trim().toLowerCase();
      if (s === "0" || s === "false" || s === "no" || s === "off") return false;
      return true;
    }),
  /** Max response bytes read from Instagram embed HTML (guard). */
  CAF_INSTAGRAM_EMBED_MAX_BYTES: z.coerce.number().int().min(50_000).max(10_000_000).default(1_500_000),
  /** HTTP timeout for Instagram embed fetch (ms). */
  CAF_INSTAGRAM_EMBED_FETCH_TIMEOUT_MS: z.coerce.number().int().min(3000).max(120_000).default(20_000),
  /** Max distinct embed HTTP GETs per deep-carousel import pass (shortcodes dedupe across rows). */
  CAF_INSTAGRAM_EMBED_MAX_FETCHES_PER_IMPORT: z.coerce.number().int().min(0).max(2000).default(400),
  /** Pause between embed GETs (ms); 0 disables. */
  CAF_INSTAGRAM_EMBED_THROTTLE_MS: z.coerce.number().int().min(0).max(5000).default(35),
  /**
   * Optional **HTTP(S) CONNECT** proxy URL for Instagram **embed** fetches only (not general Core egress).
   * Use when direct datacenter IPs get login-wall HTML with no `display_url`. Example: `http://user:pass@host:8888`.
   * Per project: `criteria_json.inputs_insights.instagram_embed_http_proxy` (non-empty string overrides env).
   * Implemented with undici `ProxyAgent` (HTTP proxy to reach `https://www.instagram.com/...`; not SOCKS5 here).
   */
  CAF_INSTAGRAM_EMBED_HTTP_PROXY: z
    .string()
    .optional()
    .transform((v) => {
      const s = v?.trim();
      return s ? s : undefined;
    }),

  /**
   * **auto** (default): archive carousel slides / video frames to Supabase when `SUPABASE_URL` + service role exist,
   * unless criteria sets `archive_top_performer_media_to_storage` to false.
   * **on** / **1** / **true**: always attempt (still no-op in DB if Supabase missing).
   * **off** / **0** / **false**: never archive.
   */
  CAF_TOP_PERFORMER_ARCHIVE_MEDIA: z
    .string()
    .optional()
    .transform((v): "auto" | "on" | "off" => {
      if (v === undefined || v === "") return "auto";
      const s = v.trim().toLowerCase();
      if (s === "0" || s === "false" || s === "no" || s === "off") return "off";
      if (s === "1" || s === "true" || s === "yes" || s === "on") return "on";
      if (s === "auto") return "auto";
      return "auto";
    }),
  /** Per-URL HTTP timeout when archiving slide/frame images to Supabase (ms). */
  CAF_TOP_PERFORMER_ARCHIVE_FETCH_TIMEOUT_MS: z.coerce.number().int().min(3000).max(120_000).default(45_000),
  /** Max bytes read per remote image when archiving (guard). */
  CAF_TOP_PERFORMER_ARCHIVE_MAX_BYTES_PER_FILE: z.coerce.number().int().min(100_000).max(25_000_000).default(12_000_000),
  /**
   * When archiving **carousel** slides only: reject downloaded bodies smaller than this (bytes).
   * Instagram embed/oEmbed often surfaces ~1–3KB logo or chrome webps; real slides are almost always larger.
   */
  CAF_TOP_PERFORMER_ARCHIVE_MIN_BYTES_CAROUSEL_IMAGE: z.coerce.number().int().min(512).max(100_000).default(6000),

  /**
   * **auto** (default): when slide/frame archiving runs for `top_performer_video`, also try to archive one
   * **source** HTTPS video file from `payload_json` (`video_url`, `source_video_url`, …) unless criteria sets
   * `archive_top_performer_source_video` to false.
   * **on** / **off**: force enable / disable source-video download+upload (frames still follow `CAF_TOP_PERFORMER_ARCHIVE_MEDIA`).
   */
  CAF_TOP_PERFORMER_ARCHIVE_SOURCE_VIDEO: z
    .string()
    .optional()
    .transform((v): "auto" | "on" | "off" => {
      if (v === undefined || v === "") return "auto";
      const s = v.trim().toLowerCase();
      if (s === "0" || s === "false" || s === "no" || s === "off") return "off";
      if (s === "1" || s === "true" || s === "yes" || s === "on") return "on";
      if (s === "auto") return "auto";
      return "auto";
    }),
  /** HTTP timeout when downloading a **full** source video for top-performer archive (ms). */
  CAF_TOP_PERFORMER_ARCHIVE_SOURCE_VIDEO_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(600_000).default(180_000),
  /** Max bytes read for one archived source video file (guard). */
  CAF_TOP_PERFORMER_ARCHIVE_MAX_BYTES_SOURCE_VIDEO: z.coerce
    .number()
    .int()
    .min(1_000_000)
    .max(500_000_000)
    .default(120_000_000),

  /**
   * **auto** (default): when top-performer video pass has no `analysis_frame_urls`, download a source
   * HTTPS video, extract JPEG frames (ffmpeg), persist rows in `evidence_media_assets`, and run vision.
   * **on** / **off**: force enable / disable (criteria `top_performer.extract_frames_from_video` can override in auto).
   */
  CAF_TOP_PERFORMER_EXTRACT_VIDEO_FRAMES: z
    .string()
    .optional()
    .transform((v): "auto" | "on" | "off" => {
      if (v === undefined || v === "") return "auto";
      const s = v.trim().toLowerCase();
      if (s === "0" || s === "false" || s === "no" || s === "off") return "off";
      if (s === "1" || s === "true" || s === "yes" || s === "on") return "on";
      if (s === "auto") return "auto";
      return "auto";
    }),

  /**
   * **auto** (default): when `video_url` exists, download source MP4 and archive to Supabase (+ ffmpeg frames)
   * even if payload already has `thumbnail_url` / `display_url`. **off** keeps thumbnail-only vision.
   */
  CAF_TOP_PERFORMER_DOWNLOAD_SOURCE_VIDEO: z
    .string()
    .optional()
    .transform((v): "auto" | "on" | "off" => {
      if (v === undefined || v === "") return "auto";
      const s = v.trim().toLowerCase();
      if (s === "0" || s === "false" || s === "no" || s === "off") return "off";
      if (s === "1" || s === "true" || s === "yes" || s === "on") return "on";
      if (s === "auto") return "auto";
      return "auto";
    }),

  /** Whisper model for optional video speech-to-text (`/v1/audio/transcriptions`). */
  OPENAI_WHISPER_MODEL: z.string().default("whisper-1"),

  /**
   * **auto** (default): run Whisper for every row with a downloadable video URL (caption length does not skip unless configured).
   * **on** / **off**: force enable / disable. Criteria `top_performer.transcribe_video_audio` overrides in auto.
   */
  CAF_TOP_PERFORMER_VIDEO_WHISPER: z
    .string()
    .optional()
    .transform((v): "auto" | "on" | "off" => {
      if (v === undefined || v === "") return "auto";
      const s = v.trim().toLowerCase();
      if (s === "0" || s === "false" || s === "no" || s === "off") return "off";
      if (s === "1" || s === "true" || s === "yes" || s === "on") return "on";
      if (s === "auto") return "auto";
      return "auto";
    }),

  /**
   * Skip Whisper when ingest caption length ≥ this (0 = never skip — transcribe every row with a video URL).
   * Legacy behavior was ~80 chars; criteria `top_performer.whisper_skip_when_caption_chars` overrides.
   */
  CAF_TOP_PERFORMER_WHISPER_SKIP_CAPTION_CHARS: z.coerce.number().int().min(0).max(50_000).default(0),
});

/** Parse `CAF_META_ACCOUNT_SOURCE_MAP` (e.g. `CUISINA=SNS,OTHER=SNS`). Keys/values normalized to uppercase. */
export function parseMetaAccountSourceMap(raw: string | undefined): Map<string, string> {
  const m = new Map<string, string>();
  if (!raw?.trim()) return m;
  for (const part of raw.split(",")) {
    const seg = part.trim();
    if (!seg) continue;
    const eq = seg.indexOf("=");
    if (eq <= 0) continue;
    const from = seg.slice(0, eq).trim().toUpperCase();
    const to = seg.slice(eq + 1).trim().toUpperCase();
    if (from && to) m.set(from, to);
  }
  return m;
}

export type AppConfig = z.infer<typeof envSchema> & {
  metaAccountSourceByProjectSlug: Map<string, string>;
};

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
    metaAccountSourceByProjectSlug: (() => {
      const m = parseMetaAccountSourceMap(d.CAF_META_ACCOUNT_SOURCE_MAP);
      /** CUISINA shares the same Meta Page / IG account as SNS unless the map sets CUISINA explicitly. */
      if (!m.has("CUISINA")) m.set("CUISINA", "SNS");
      return m;
    })(),
  };
}
