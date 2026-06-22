/**
 * Normalize carousel / mimic slide body copy that was emitted as per-line arrays
 * or accidentally flattened with `Array.prototype.toString()` (bare commas).
 */

/** Join a per-line copy array into a body string (skips nested objects/empties). */
export function joinBodyLineArray(arr: unknown[]): string {
  return arr
    .map((x) => (x != null && typeof x !== "object" ? String(x).trim() : ""))
    .filter((s) => s.length > 0)
    .join("\n");
}

/**
 * Repair bodies produced by stringifying a line array with the default
 * `Array.prototype.toString()` — e.g. `["A.","B."]` → `"A.,B."`. Natural prose
 * commas are followed by whitespace; digit-flanked commas (e.g. `1,000`) are preserved.
 */
export function repairArrayStringifiedBody(s: string): string {
  return s.replace(/(?<=[^\s\d]),(?=[^\s\d])/g, "\n");
}

/** Coerce slide `body` / line field values into a newline-separated string. */
export function coerceSlideBodyCopyText(raw: unknown): string {
  if (raw == null) return "";
  if (Array.isArray(raw)) {
    const joined = joinBodyLineArray(raw);
    return joined.trim();
  }
  if (typeof raw === "object") return "";
  const s = String(raw).trim();
  if (!s) return "";
  return repairArrayStringifiedBody(s);
}
