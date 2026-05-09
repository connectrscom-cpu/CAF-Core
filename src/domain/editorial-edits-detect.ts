import { partitionEditorialOverrides } from "../services/editorial-copy-apply.js";

const HEYGEN_RENDER_META = ["heygen_avatar_id", "heygen_voice_id", "heygen_force_rerender"] as const;

/**
 * True if reviewer supplied copy/script overrides (flat keys) that imply human editing.
 */
export function overridesImplyCopyEdit(flat: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(flat)) {
    if (k === "rewrite_copy" && v === true) return true;
    if (typeof v === "string" && v.trim().length > 0) return true;
  }
  return false;
}

/**
 * Structural overrides (non-flat) or explicit HeyGen meta changes → treated as render-path edits for RTP.
 */
export function overridesImplyRenderEdit(
  fullOverrides: Record<string, unknown>,
  structural: Record<string, unknown>
): boolean {
  if (Object.keys(structural).length > 0) return true;
  for (const k of HEYGEN_RENDER_META) {
    const v = fullOverrides[k];
    if (v === true) return true;
    if (typeof v === "string" && v.trim().length > 0) return true;
  }
  return false;
}

/** Approved as-is: no copy edits and no render/meta edits on the approval row. */
export function isReadyToPublishApproval(overridesJson: unknown): boolean {
  if (!overridesJson || typeof overridesJson !== "object" || Array.isArray(overridesJson)) return true;
  const o = overridesJson as Record<string, unknown>;
  const { flat, structural } = partitionEditorialOverrides(o);
  if (overridesImplyCopyEdit(flat)) return false;
  if (overridesImplyRenderEdit(o, structural)) return false;
  return true;
}
