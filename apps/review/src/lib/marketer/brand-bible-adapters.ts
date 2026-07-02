import type {
  BrandBible,
  BrandBibleApplicationGuide,
  BrandBibleAssetRef,
  BrandBibleAssetRole,
  BrandBibleVisualMode,
} from "./types";

function splitList(text: string, sep = /[;,\n]/): string[] {
  return text
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinList(items: string[]): string {
  return items.map((x) => x.trim()).filter(Boolean).join("; ");
}

const CONTENT_AIM_IDS = [
  "awareness",
  "education",
  "community",
  "engagement",
  "conversion",
  "authority",
] as const;

export const BRAND_BIBLE_VISUAL_MODES: { id: BrandBibleVisualMode; label: string }[] = [
  { id: "illustrated_cartoon", label: "Illustrated / cartoon" },
  { id: "minimal_editorial", label: "Minimal editorial" },
  { id: "photography", label: "Photography" },
  { id: "mixed", label: "Mixed media" },
  { id: "custom", label: "Custom" },
];

export const BRAND_BIBLE_CONTENT_AIMS = [
  { id: "awareness", label: "Awareness" },
  { id: "education", label: "Education" },
  { id: "community", label: "Community" },
  { id: "engagement", label: "Engagement" },
  { id: "conversion", label: "Conversion" },
  { id: "authority", label: "Authority" },
] as const;

export const BRAND_BIBLE_ASSET_ROLES: { id: BrandBibleAssetRole; label: string }[] = [
  { id: "style_reference", label: "Style reference" },
  { id: "character", label: "Character / mascot" },
  { id: "motif", label: "Motif / element" },
  { id: "texture", label: "Texture / background" },
  { id: "logo", label: "Logo usage" },
  { id: "anti_reference", label: "Do not use (anti-reference)" },
];

function parseGuide(raw: Record<string, unknown> | null | undefined): BrandBibleApplicationGuide {
  const g = raw ?? {};
  const aims = Array.isArray(g.content_aims)
    ? (g.content_aims as unknown[]).map(String).filter((a) => CONTENT_AIM_IDS.includes(a as (typeof CONTENT_AIM_IDS)[number]))
    : [];
  return {
    instructions: String(g.instructions ?? "").trim(),
    contentAims: aims,
    mimicPolicy: String(g.mimic_policy ?? "").trim(),
    originalPolicy: String(g.original_policy ?? "").trim(),
  };
}

function parseAssetRefs(raw: unknown): BrandBibleAssetRef[] {
  if (!Array.isArray(raw)) return [];
  const out: BrandBibleAssetRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const assetId = String(rec.asset_id ?? rec.assetId ?? "").trim();
    if (!assetId) continue;
    out.push({
      assetId,
      role: (String(rec.role ?? "style_reference") as BrandBibleAssetRole) || "style_reference",
      label: String(rec.label ?? "").trim(),
      usageNotes: String(rec.usage_notes ?? rec.usageNotes ?? "").trim(),
    });
  }
  return out;
}

export function toBrandBible(
  slug: string,
  parsed: Record<string, unknown> | null | undefined,
  version: number | null
): BrandBible {
  const p = parsed ?? {};
  const palette = Array.isArray(p.palette)
    ? (p.palette as unknown[]).map(String).filter(Boolean)
    : splitList(String(p.colors ?? ""));
  return {
    slug,
    visualMode: (String(p.visual_mode ?? "") as BrandBibleVisualMode) || "",
    visualModeCustom: String(p.visual_mode_custom ?? "").trim(),
    palette,
    allowedMotifs: joinList(Array.isArray(p.allowed_motifs) ? (p.allowed_motifs as string[]) : splitList(String(p.allowed_motifs ?? ""))),
    forbiddenMotifs: joinList(
      Array.isArray(p.forbidden_motifs) ? (p.forbidden_motifs as string[]) : splitList(String(p.forbidden_motifs ?? ""))
    ),
    applicationGuide: parseGuide(p.application_guide as Record<string, unknown> | undefined),
    assetRefs: parseAssetRefs(p.asset_refs),
    hasActiveVersion: version != null,
    version,
  };
}

export function emptyBrandBible(slug: string): BrandBible {
  return toBrandBible(slug, null, null);
}

export function toBrandBibleJson(edit: BrandBible): Record<string, unknown> {
  return {
    schema_version: "brand_bible_v1",
    visual_mode: edit.visualMode || null,
    visual_mode_custom: edit.visualMode === "custom" ? edit.visualModeCustom.trim() || null : edit.visualModeCustom.trim() || null,
    palette: edit.palette.filter(Boolean),
    allowed_motifs: splitList(edit.allowedMotifs),
    forbidden_motifs: splitList(edit.forbiddenMotifs),
    application_guide: {
      instructions: edit.applicationGuide.instructions.trim(),
      content_aims: edit.applicationGuide.contentAims,
      mimic_policy: edit.applicationGuide.mimicPolicy.trim() || null,
      original_policy: edit.applicationGuide.originalPolicy.trim() || null,
    },
    asset_refs: edit.assetRefs.map((r) => ({
      asset_id: r.assetId,
      role: r.role,
      label: r.label.trim() || null,
      usage_notes: r.usageNotes.trim() || null,
    })),
  };
}

export function brandBibleIsConfigured(bible: BrandBible): boolean {
  const g = bible.applicationGuide;
  return (
    bible.palette.length > 0 ||
    bible.assetRefs.length > 0 ||
    bible.allowedMotifs.length > 0 ||
    bible.forbiddenMotifs.length > 0 ||
    Boolean(bible.visualMode) ||
    g.instructions.length > 0 ||
    g.mimicPolicy.length > 0 ||
    g.originalPolicy.length > 0
  );
}
