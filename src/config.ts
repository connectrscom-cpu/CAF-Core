import path from "node:path";
import { z } from "zod";
import "dotenv/config";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3847),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL required for CAF Core Postgres"),

  CAF_CORE_API_TOKEN: z.string().optional(),
  CAF_CORE_REQUIRE_AUTH: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),

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
  DEFAULT_MAX_CAROUSEL_JOBS_PER_RUN: z.coerce.number().int().nonnegative().default(5),
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
  CAROUSEL_RENDERER_SLIDE_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  VIDEO_ASSEMBLY_BASE_URL: z.string().default("http://localhost:3334"),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o"),
  /**
   * When true, LLM JSON is still parsed and normalized but not checked against Flow Engine output_schemas.
   * Unset defaults to true (skip) for easier iteration; set CAF_SKIP_OUTPUT_SCHEMA_VALIDATION=0 to enforce schemas.
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
   * Upper bound for chat.completions `max_tokens` (completion tokens). gpt-4o allows at most 16384; DB templates often use 25k+.
   */
  OPENAI_MAX_COMPLETION_TOKENS: z.coerce.number().int().positive().default(16384),

  /** HeyGen v2: default voice id for video_inputs[0].voice when config does not set it */
  HEYGEN_DEFAULT_VOICE_ID: z.string().optional(),

  /** Max extra signal-pack rows the scene-assembly candidate router LLM may add per run (0 disables). */
  SCENE_ASSEMBLY_ROUTER_MAX_SEEDS: z.coerce.number().int().min(0).max(20).default(5),

  /** Supabase Storage (asset uploads from CAF Core) */
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_ASSETS_BUCKET: z.string().default("assets"),

  HEYGEN_API_KEY: z.string().optional(),
  HEYGEN_API_BASE: z.string().default("https://api.heygen.com"),

  /** OpenAI TTS (e.g. tts-1, tts-1-hd) */
  OPENAI_TTS_MODEL: z.string().default("tts-1"),
  OPENAI_TTS_VOICE: z.string().default("nova"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment: ${JSON.stringify(msg)}`);
  }
  return parsed.data;
}
