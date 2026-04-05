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
