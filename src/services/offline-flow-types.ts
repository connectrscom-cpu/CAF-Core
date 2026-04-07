/**
 * Flow types that are temporarily excluded from planning and from the CAF job pipeline.
 * Re-enable by removing matches here (or moving to env-driven list later).
 */
const OFFLINE_FLOW_EXACT = new Set<string>([
  "Reel_Script",
  "FLOW_REEL_SCRIPT",
  "Flow_Reel_Script",
  "Flow_Hook_Variations",
  "FLOW_HOOK_VARIATIONS",
  "Flow_Hook_Variation",
  "FLOW_HOOK_VARIATION",
]);

export function isOfflinePipelineFlow(flowType: string): boolean {
  const t = (flowType ?? "").trim();
  if (!t) return false;
  if (OFFLINE_FLOW_EXACT.has(t)) return true;
  if (/reel_script/i.test(t)) return true;
  if (/hook_variations?|variation.*hook|hook.*variation/i.test(t)) return true;
  const l = t.toLowerCase();
  if (l.includes("reel") && l.includes("script")) return true;
  if (l.includes("hook") && l.includes("variation")) return true;
  return false;
}
