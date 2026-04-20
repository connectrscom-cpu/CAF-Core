/**
 * NEEDS_EDIT review fields for HeyGen single-take flows: merge avatar/voice into `generation_payload.heygen_request`
 * (consumed by {@link buildHeyGenRequestBody} / {@link buildHeyGenVideoAgentRequestBody}).
 */

export function buildHeyGenRequestPatchFromReviewOverrides(overrides: Record<string, unknown>): Record<string, unknown> {
  const avatar = typeof overrides.heygen_avatar_id === "string" ? overrides.heygen_avatar_id.trim() : "";
  const voice = typeof overrides.heygen_voice_id === "string" ? overrides.heygen_voice_id.trim() : "";
  const out: Record<string, unknown> = {};
  if (avatar) {
    out.avatar_id = avatar;
    out.script_avatar_id = avatar;
    out.prompt_avatar_id = avatar;
  }
  if (voice) {
    out.voice_id = voice;
    out.script_voice_id = voice;
    out.default_voice_id = voice;
  }
  return out;
}

export function mergeHeyGenRequestIntoGenerationPayload(
  gp: Record<string, unknown>,
  overrides: Record<string, unknown>
): void {
  const patch = buildHeyGenRequestPatchFromReviewOverrides(overrides);
  if (Object.keys(patch).length === 0) return;
  const cur =
    typeof gp.heygen_request === "object" && gp.heygen_request !== null && !Array.isArray(gp.heygen_request)
      ? ({ ...(gp.heygen_request as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  gp.heygen_request = { ...cur, ...patch };
}

/** Avatar/voice ids stored on the NEEDS_EDIT row (not merged into `generated_output` verbatim). */
export function hasNonEmptyHeyGenIdOverrides(overrides: Record<string, unknown> | null | undefined): boolean {
  if (!overrides) return false;
  const a = typeof overrides.heygen_avatar_id === "string" ? overrides.heygen_avatar_id.trim() : "";
  const v = typeof overrides.heygen_voice_id === "string" ? overrides.heygen_voice_id.trim() : "";
  return Boolean(a || v);
}

export function heygenForceRerenderRequested(overrides: Record<string, unknown> | null | undefined): boolean {
  return overrides?.heygen_force_rerender === true;
}

/**
 * Single-take HeyGen jobs (not multi-scene assembly).
 *
 * FLOW_PRODUCT_* render through HeyGen as a single take too — include them so a
 * spoken-script edit on a product video triggers the fast HeyGen re-render path instead
 * of a full reprocess. (Regex alone doesn't match FLOW_PRODUCT_* because they don't
 * contain "heygen" in the name.)
 */
export function isHeyGenSingleTakeReworkFlow(flowType: string | null | undefined): boolean {
  const ft = flowType ?? "";
  if (/scene_assembly|FLOW_SCENE|Video_Scene_Assembly/i.test(ft)) return false;
  if (/^FLOW_PRODUCT_/i.test(ft)) return true;
  return /heygen|HeyGen|Video_Script_HeyGen|Video_Prompt_HeyGen/i.test(ft);
}
