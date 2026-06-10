/** Supported BFL FLUX slugs for top-performer mimic image edits. */
export const MIMIC_BFL_MODEL_KLEIN_4B = "flux-2-klein-4b";
export const MIMIC_BFL_MODEL_FLEX = "flux-2-flex";

export type MimicBflModelSlug = typeof MIMIC_BFL_MODEL_KLEIN_4B | typeof MIMIC_BFL_MODEL_FLEX;

export const MIMIC_BFL_MODEL_OPTIONS: readonly { id: MimicBflModelSlug; label: string }[] = [
  { id: MIMIC_BFL_MODEL_KLEIN_4B, label: "4b (Klein — fast)" },
  { id: MIMIC_BFL_MODEL_FLEX, label: "Flex (typography / on-image text)" },
];

export function isMimicBflModelSlug(v: string): v is MimicBflModelSlug {
  return v === MIMIC_BFL_MODEL_KLEIN_4B || v === MIMIC_BFL_MODEL_FLEX;
}

/** Parse admin/DB value; empty/null → null (use server env default). */
export function parseProjectMimicBflModel(raw: unknown): MimicBflModelSlug | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (s === "4b" || s === "klein" || s === MIMIC_BFL_MODEL_KLEIN_4B) return MIMIC_BFL_MODEL_KLEIN_4B;
  if (s === "flex" || s === MIMIC_BFL_MODEL_FLEX) return MIMIC_BFL_MODEL_FLEX;
  return isMimicBflModelSlug(s) ? s : null;
}

/** Effective slug: project override wins, else env default from AppConfig. */
export function effectiveMimicBflModel(
  projectModel: MimicBflModelSlug | null | undefined,
  envDefault: string
): string {
  if (projectModel) return projectModel;
  const d = envDefault.trim();
  if (isMimicBflModelSlug(d)) return d;
  if (d === "flex" || d.endsWith("-flex")) return MIMIC_BFL_MODEL_FLEX;
  return MIMIC_BFL_MODEL_KLEIN_4B;
}
