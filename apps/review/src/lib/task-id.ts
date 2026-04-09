/** Next/Fastify may leave `%` sequences as-is; avoid throwing on malformed encodings. */
export function decodeTaskIdParam(raw: string): string {
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}
