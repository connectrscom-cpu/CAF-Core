function optEnv(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

export const CAF_CORE_URL = optEnv("CAF_CORE_URL", "http://localhost:3847");
export const CAF_CORE_TOKEN = optEnv("CAF_CORE_TOKEN");
export const REVIEW_WRITE_TOKEN = optEnv("REVIEW_WRITE_TOKEN");
export const APP_URL = optEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
export const PROJECT_SLUG = optEnv("PROJECT_SLUG", "SNS");
