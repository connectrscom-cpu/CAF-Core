import { mimicImageReferenceEligible } from "./mimic-reference-resolver.js";
import {
  FLOW_TOP_PERFORMER_MIMIC_IMAGE,
  isTopPerformerMimicImageFlow,
} from "../domain/top-performer-mimic-flow-types.js";

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).filter(Boolean);
}

/**
 * Top-performer image mimic only applies to explicit mimic picks or ideas grounded
 * to a single-frame deep reference — not every post-format pack idea.
 */
export function shouldExpandTopPerformerMimicImageForRow(
  row: Record<string, unknown>,
  derivedGlobals: Record<string, unknown> | null | undefined
): boolean {
  if (row.manual_mimic_pick === true && String(row.mimic_kind ?? "").trim() === "image") {
    return true;
  }
  if (String(row.target_flow_type ?? "").trim() === FLOW_TOP_PERFORMER_MIMIC_IMAGE) {
    return true;
  }
  const insightIds = stringList(row.grounding_insight_ids);
  if (insightIds.length === 0) return false;
  return mimicImageReferenceEligible(derivedGlobals ?? null, insightIds);
}

export function shouldSkipMimicFlowExpansion(
  flowType: string,
  row: Record<string, unknown>,
  derivedGlobals: Record<string, unknown> | null | undefined
): boolean {
  if (!isTopPerformerMimicImageFlow(flowType)) return false;
  return !shouldExpandTopPerformerMimicImageForRow(row, derivedGlobals);
}
