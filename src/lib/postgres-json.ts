const NULL_CHAR_RE = /\u0000/g;
/** Lone UTF-16 surrogates — rejected by PostgreSQL json/jsonb parsers. */
const LONE_SURROGATE_RE = /[\uD800-\uDFFF]/g;

/** Strip characters PostgreSQL json/jsonb cannot store in string values. */
export function sanitizeStringForPostgresJson(s: string): string {
  return s.replace(NULL_CHAR_RE, "").replace(LONE_SURROGATE_RE, "");
}

/**
 * Deep-clone a JSON-serializable value, removing null bytes / lone surrogates from strings
 * and normalizing non-finite numbers and bigint.
 */
export function sanitizeForPostgresJson<T>(value: T): T {
  if (value == null) return value;
  if (typeof value === "string") return sanitizeStringForPostgresJson(value) as T;
  if (typeof value === "bigint") return value.toString() as T;
  if (typeof value === "number") {
    return (Number.isFinite(value) ? value : null) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForPostgresJson(item)) as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = sanitizeForPostgresJson(v);
    }
    return out as T;
  }
  return value;
}

/** JSON.stringify safe for PostgreSQL `::jsonb` casts. */
export function stringifyForPostgresJson(value: unknown): string {
  return JSON.stringify(sanitizeForPostgresJson(value));
}
