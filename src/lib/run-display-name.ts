/** Human label for a run, stored in `caf_core.runs.metadata_json.display_name` (stable key remains `run_id`). */
export const RUN_DISPLAY_NAME_METADATA_KEY = "display_name" as const;

const MAX_LEN = 200;

export function trimRunDisplayName(value: unknown): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  if (!s) return undefined;
  return s.length > MAX_LEN ? s.slice(0, MAX_LEN) : s;
}

export function getRunDisplayName(metadata: Record<string, unknown> | undefined): string | undefined {
  if (!metadata) return undefined;
  return trimRunDisplayName(metadata[RUN_DISPLAY_NAME_METADATA_KEY]);
}
