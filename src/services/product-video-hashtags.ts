/**
 * Product video flows: hashtags must come from the signal-pack-derived allowlist in the creation pack.
 */
import { bareHashtagToken } from "../domain/signal-hashtag-sanitize.js";

function normBare(raw: unknown): string {
  return bareHashtagToken(String(raw ?? ""));
}

function asBareArray(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.map((t) => normBare(t)).filter(Boolean);
}

/**
 * Keep LLM-chosen tags that appear in the allowlist; pad from allowlist order until `max`.
 * If allowlist is empty, returns normalized model tags unchanged (caller should still cap length).
 */
export function clampHashtagsToSignalPackAllowlist(
  modelTags: unknown,
  allowlist: string[] | null | undefined,
  max: number
): string[] {
  const cap = Number.isFinite(max) && max >= 0 ? Math.floor(max) : 10;
  const allowNorm = new Set((allowlist ?? []).map((x) => normBare(x)).filter(Boolean));
  const picked = asBareArray(modelTags).filter((t) => allowNorm.has(t));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of picked) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= cap) return out;
  }
  for (const a of allowlist ?? []) {
    const t = normBare(a);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}
