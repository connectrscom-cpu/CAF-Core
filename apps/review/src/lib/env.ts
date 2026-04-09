function optEnv(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

export const CAF_CORE_URL = optEnv("CAF_CORE_URL", "http://localhost:3847");
export const CAF_CORE_TOKEN = optEnv("CAF_CORE_TOKEN");
export const REVIEW_WRITE_TOKEN = optEnv("REVIEW_WRITE_TOKEN");
export const APP_URL = optEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
/** Empty = workbench loads every **active** project’s queue from Core. Set to e.g. `SNS` to lock one tenant. */
export const PROJECT_SLUG = optEnv("PROJECT_SLUG", "").trim();
/** If `1`/`true`, use the cross-project queue even when `PROJECT_SLUG` is set. */
export const REVIEW_ALL_PROJECTS = /^(1|true|yes)$/i.test(optEnv("REVIEW_ALL_PROJECTS", ""));

export function reviewUsesAllProjects(): boolean {
  return REVIEW_ALL_PROJECTS || !PROJECT_SLUG;
}
