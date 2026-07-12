/**
 * Brand Bible (`brand_bible_v1`) — Brand Visual System (BVS) source of truth per project.
 *
 * Marketers edit voice/strategy in brand profile; the bible holds visual identity,
 * reference asset roles, and an application guide explaining how CAF should apply
 * the system when generating or reinterpreting content.
 */
import type { ProjectBrandAssetRow } from "../repositories/project-config.js";

export const BRAND_BIBLE_SCHEMA = "brand_bible_v1" as const;

/** Max moodboard assets described per-line in Flux image prompts when explicitly selected. */
export const FLUX_PROMPT_ASSET_MAX = 7;

/** BFL multi-reference: input_image … input_image_8 (new visual + BVS auto refs). */
export const NEW_VISUAL_BVS_FLUX_IMAGE_REF_MAX = 8;

export const BRAND_BIBLE_ASSET_ROLES = [
  "style_reference",
  "character",
  "mascot",
  "motif",
  "slide_frame",
  "background",
  "texture",
  "logo",
  "anti_reference",
] as const;

export type BrandBibleAssetRole = (typeof BRAND_BIBLE_ASSET_ROLES)[number];

export const BRAND_BIBLE_VISUAL_MODES = [
  "illustrated_cartoon",
  "minimal_editorial",
  "photography",
  "mixed",
  "custom",
] as const;

export type BrandBibleVisualMode = (typeof BRAND_BIBLE_VISUAL_MODES)[number];

export interface BrandBibleApplicationGuide {
  /** Free-text instructions: how to use assets, what the brand aims to achieve. */
  instructions: string;
  content_aims: string[];
  mimic_policy: string | null;
  original_policy: string | null;
}

export interface BrandBibleAssetRef {
  asset_id: string;
  role: BrandBibleAssetRole;
  label: string | null;
  usage_notes: string | null;
}

/** Approved HeyGen avatar + voice pairs for video content (stored on bible, synced to heygen_config pool). */
export interface BrandBibleHeygenPresenter {
  label: string | null;
  avatar_id: string;
  voice_id: string | null;
  avatar_name: string | null;
  voice_name: string | null;
  preview_image_url: string | null;
}

export interface BrandBibleResolvedAsset {
  asset_id: string;
  role: BrandBibleAssetRole;
  label: string | null;
  usage_notes: string | null;
  public_url: string | null;
  kind: string | null;
}

export interface BrandBibleV1 {
  schema_version: typeof BRAND_BIBLE_SCHEMA;
  visual_mode: BrandBibleVisualMode | null;
  visual_mode_custom: string | null;
  palette: string[];
  allowed_motifs: string[];
  forbidden_motifs: string[];
  application_guide: BrandBibleApplicationGuide;
  asset_refs: BrandBibleAssetRef[];
  heygen_presenters: BrandBibleHeygenPresenter[];
  /** Ordered asset ids (max 7) injected as per-line Flux prompt references when set. */
  flux_prompt_asset_ids: string[];
}

export interface BrandBibleSnapshotV1 extends BrandBibleV1 {
  resolved_assets: BrandBibleResolvedAsset[];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown, max = 4000): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function strList(v: unknown, max: number, cap = 120): string[] {
  const out: string[] = [];
  for (const x of asArray(v)) {
    const s = str(x, cap);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function parseVisualMode(raw: unknown): BrandBibleVisualMode | null {
  const s = str(raw, 40);
  if (!s) return null;
  return (BRAND_BIBLE_VISUAL_MODES as readonly string[]).includes(s) ? (s as BrandBibleVisualMode) : "custom";
}

function parseAssetRole(raw: unknown): BrandBibleAssetRole {
  const s = str(raw, 40);
  if (s && (BRAND_BIBLE_ASSET_ROLES as readonly string[]).includes(s)) return s as BrandBibleAssetRole;
  return "style_reference";
}

function parseApplicationGuide(raw: unknown): BrandBibleApplicationGuide {
  const rec = asRecord(raw);
  return {
    instructions: str(rec?.instructions, 8000) ?? "",
    content_aims: strList(rec?.content_aims, 12, 60),
    mimic_policy: str(rec?.mimic_policy, 2000),
    original_policy: str(rec?.original_policy, 2000),
  };
}

function parseHeygenPresenters(raw: unknown): BrandBibleHeygenPresenter[] {
  const out: BrandBibleHeygenPresenter[] = [];
  for (const item of asArray(raw)) {
    const rec = asRecord(item);
    if (!rec) continue;
    const avatar_id = str(rec.avatar_id ?? rec.avatarId, 120);
    if (!avatar_id) continue;
    out.push({
      label: str(rec.label, 120),
      avatar_id,
      voice_id: str(rec.voice_id ?? rec.voiceId, 120),
      avatar_name: str(rec.avatar_name ?? rec.avatarName, 120),
      voice_name: str(rec.voice_name ?? rec.voiceName, 120),
      preview_image_url: str(rec.preview_image_url ?? rec.previewImageUrl, 800),
    });
    if (out.length >= 12) break;
  }
  return out;
}

function parseFluxPromptAssetIds(raw: unknown): string[] {
  const out: string[] = [];
  for (const item of asArray(raw)) {
    const id = str(item, 80);
    if (id && !out.includes(id)) out.push(id);
    if (out.length >= FLUX_PROMPT_ASSET_MAX) break;
  }
  return out;
}

function parseAssetRefs(raw: unknown): BrandBibleAssetRef[] {
  const out: BrandBibleAssetRef[] = [];
  for (const item of asArray(raw)) {
    const rec = asRecord(item);
    if (!rec) continue;
    const assetId = str(rec.asset_id ?? rec.id, 80);
    if (!assetId) continue;
    out.push({
      asset_id: assetId,
      role: parseAssetRole(rec.role),
      label: str(rec.label, 120),
      usage_notes: str(rec.usage_notes ?? rec.notes, 400),
    });
    if (out.length >= 40) break;
  }
  return out;
}

/** Tolerant parser. Returns null when there is no usable bible signal. */
export function parseBrandBible(raw: unknown): BrandBibleV1 | null {
  const rec = asRecord(raw);
  if (!rec) return null;

  const bible: BrandBibleV1 = {
    schema_version: BRAND_BIBLE_SCHEMA,
    visual_mode: parseVisualMode(rec.visual_mode),
    visual_mode_custom: str(rec.visual_mode_custom ?? rec.visual_mode_label, 200),
    palette: strList(rec.palette ?? rec.colors, 16, 40),
    allowed_motifs: strList(rec.allowed_motifs ?? rec.allowed, 24, 80),
    forbidden_motifs: strList(rec.forbidden_motifs ?? rec.forbidden, 24, 80),
    application_guide: parseApplicationGuide(rec.application_guide),
    asset_refs: parseAssetRefs(rec.asset_refs ?? rec.assets),
    heygen_presenters: parseHeygenPresenters(rec.heygen_presenters),
    flux_prompt_asset_ids: parseFluxPromptAssetIds(rec.flux_prompt_asset_ids),
  };

  const guide = bible.application_guide;
  const hasSignal =
    bible.visual_mode ||
    bible.palette.length > 0 ||
    bible.allowed_motifs.length > 0 ||
    bible.forbidden_motifs.length > 0 ||
    bible.asset_refs.length > 0 ||
    bible.heygen_presenters.length > 0 ||
    bible.flux_prompt_asset_ids.length > 0 ||
    guide.instructions.length > 0 ||
    guide.mimic_policy ||
    guide.original_policy ||
    guide.content_aims.length > 0;

  return hasSignal ? bible : null;
}

export function emptyBrandBibleDraft(): BrandBibleV1 {
  return {
    schema_version: BRAND_BIBLE_SCHEMA,
    visual_mode: null,
    visual_mode_custom: null,
    palette: [],
    allowed_motifs: [],
    forbidden_motifs: [],
    application_guide: {
      instructions: "",
      content_aims: [],
      mimic_policy: null,
      original_policy: null,
    },
    asset_refs: [],
    heygen_presenters: [],
    flux_prompt_asset_ids: [],
  };
}

const DEFAULT_MIMIC_BVS_POLICY =
  "Copy the reference hook and slide structure only — replace all visuals, colors, and illustration style with this brand's moodboard and palette. Never reproduce the competitor look.";

/** Pull hex swatches from brand-kit palette asset rows. */
export function extractPaletteFromBrandAssets(brandAssets: ProjectBrandAssetRow[]): string[] {
  const colors: string[] = [];
  for (const row of brandAssets) {
    if (row.kind !== "palette") continue;
    const raw = row.metadata_json?.colors;
    if (!Array.isArray(raw)) continue;
    for (const c of raw) {
      const hex = typeof c === "string" ? c.trim() : "";
      if (!/^#[0-9a-fA-F]{6}$/i.test(hex)) continue;
      if (!colors.includes(hex)) colors.push(hex);
    }
  }
  return colors.slice(0, 5);
}

/** Auto-map uploaded moodboard files to bible asset roles when the marketer has not assigned roles yet. */
export function defaultAssetRefsFromBrandKit(brandAssets: ProjectBrandAssetRow[]): BrandBibleAssetRef[] {
  const out: BrandBibleAssetRef[] = [];
  for (const row of brandAssets) {
    if (row.kind === "logo") {
      out.push({
        asset_id: row.id,
        role: "logo",
        label: row.label,
        usage_notes: "Brand logo from moodboard",
      });
    } else if (row.kind === "reference_image" || row.kind === "other") {
      out.push({
        asset_id: row.id,
        role: "style_reference",
        label: row.label,
        usage_notes: null,
      });
    }
    if (out.length >= 16) break;
  }
  return out;
}

/** Build a usable bible from moodboard uploads alone (no saved brand_bibles row). */
export function buildBibleFromBrandAssets(brandAssets: ProjectBrandAssetRow[]): BrandBibleV1 | null {
  const palette = extractPaletteFromBrandAssets(brandAssets);
  const asset_refs = defaultAssetRefsFromBrandKit(brandAssets);
  if (palette.length === 0 && asset_refs.length === 0) return null;
  return (
    parseBrandBible({
      schema_version: BRAND_BIBLE_SCHEMA,
      palette,
      asset_refs,
      application_guide: {
        instructions: "",
        content_aims: [],
        mimic_policy: DEFAULT_MIMIC_BVS_POLICY,
        original_policy: null,
      },
    }) ?? null
  );
}

/** Fill gaps in a saved bible from moodboard assets (palette rows, unassigned references). */
export function enrichBrandBibleFromAssets(bible: BrandBibleV1, brandAssets: ProjectBrandAssetRow[]): BrandBibleV1 {
  const palette = bible.palette.length > 0 ? bible.palette : extractPaletteFromBrandAssets(brandAssets);
  const existingIds = new Set(bible.asset_refs.map((r) => r.asset_id));
  const refs = [...bible.asset_refs];
  for (const ref of defaultAssetRefsFromBrandKit(brandAssets)) {
    if (!existingIds.has(ref.asset_id)) refs.push(ref);
  }
  const mimic_policy = bible.application_guide.mimic_policy?.trim() || DEFAULT_MIMIC_BVS_POLICY;
  return {
    ...bible,
    palette,
    asset_refs: refs.slice(0, 40),
    application_guide: { ...bible.application_guide, mimic_policy },
  };
}

export function resolveBrandBibleAssets(
  bible: BrandBibleV1,
  brandAssets: ProjectBrandAssetRow[]
): BrandBibleResolvedAsset[] {
  const byId = new Map(brandAssets.map((a) => [a.id, a]));
  const out: BrandBibleResolvedAsset[] = [];
  for (const ref of bible.asset_refs) {
    const row = byId.get(ref.asset_id);
    out.push({
      asset_id: ref.asset_id,
      role: ref.role,
      label: ref.label ?? row?.label ?? null,
      usage_notes: ref.usage_notes,
      public_url: row?.public_url ?? null,
      kind: row?.kind ?? null,
    });
  }
  return out;
}

export function buildBrandBibleSnapshot(
  bible: BrandBibleV1,
  brandAssets: ProjectBrandAssetRow[]
): BrandBibleSnapshotV1 {
  return {
    ...bible,
    resolved_assets: resolveBrandBibleAssets(bible, brandAssets),
  };
}

export function visualModeLabel(bible: Pick<BrandBibleV1, "visual_mode" | "visual_mode_custom">): string | null {
  if (bible.visual_mode === "custom") return bible.visual_mode_custom;
  if (!bible.visual_mode) return bible.visual_mode_custom;
  return bible.visual_mode.replace(/_/g, " ");
}

function roleLabelForPrompt(role: BrandBibleAssetRole): string {
  return role.replace(/_/g, " ");
}

/** Resolve explicitly selected Flux prompt assets (ordered). Empty when marketer has not picked any. */
export function resolveExplicitFluxPromptAssets(
  snapshot: BrandBibleSnapshotV1
): BrandBibleResolvedAsset[] {
  const ids = snapshot.flux_prompt_asset_ids ?? [];
  if (ids.length === 0) return [];
  const byId = new Map(snapshot.resolved_assets.map((a) => [a.asset_id, a]));
  const out: BrandBibleResolvedAsset[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (row && row.role !== "anti_reference") out.push(row);
  }
  return out;
}

function formatFluxPromptAssetLine(asset: BrandBibleResolvedAsset, index1Based: number): string {
  const role = roleLabelForPrompt(asset.role);
  const label = asset.label?.trim();
  const notes = asset.usage_notes?.trim();
  const parts = [`${index1Based}. [${role}]`];
  if (label) parts.push(label);
  if (notes) parts.push(`— ${notes}`);
  return `  ${parts.join(" ")}`;
}

function hasResolvableBrandAssetUrl(asset: BrandBibleResolvedAsset): boolean {
  return Boolean(asset.public_url?.trim());
}

/**
 * New visual carousel + BVS: backgrounds, design elements (motifs), and mascots sent as Flux image refs.
 * Order: backgrounds → motifs → mascots/characters (stable, capped at BFL multi-ref limit).
 */
export function resolveNewVisualBvsFluxImageReferenceAssets(
  snapshot: BrandBibleSnapshotV1 | null | undefined
): BrandBibleResolvedAsset[] {
  if (!snapshot) return [];
  const resolved = Array.isArray(snapshot.resolved_assets) ? snapshot.resolved_assets : [];
  const backgrounds = resolved.filter(
    (a) => (a.role === "background" || a.role === "texture") && hasResolvableBrandAssetUrl(a)
  );
  const motifs = resolved.filter((a) => a.role === "motif" && hasResolvableBrandAssetUrl(a));
  const mascots = resolved.filter(
    (a) => (a.role === "mascot" || a.role === "character") && hasResolvableBrandAssetUrl(a)
  );
  const out: BrandBibleResolvedAsset[] = [];
  const seen = new Set<string>();
  for (const asset of [...backgrounds, ...motifs, ...mascots]) {
    const id = String(asset.asset_id ?? "").trim();
    const url = asset.public_url!.trim();
    const key = id || url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(asset);
    if (out.length >= NEW_VISUAL_BVS_FLUX_IMAGE_REF_MAX) break;
  }
  return out;
}

export function resolveNewVisualBvsFluxImageReferenceUrls(
  snapshot: BrandBibleSnapshotV1 | null | undefined
): string[] {
  return resolveNewVisualBvsFluxImageReferenceAssets(snapshot)
    .map((a) => a.public_url!.trim())
    .filter(Boolean);
}

/** Prompt block naming each attached reference image (image 1, image 2, …). */
export function buildNewVisualBvsFluxImageReferencePromptBlock(
  assets: BrandBibleResolvedAsset[]
): string | null {
  if (assets.length === 0) return null;
  const lines = [
    `Brand asset reference images (${assets.length} attached to Flux — match palette/mood/style; invent a fresh hero subject; do not collage or copy pixels verbatim):`,
  ];
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i]!;
    const role = roleLabelForPrompt(asset.role);
    const label = asset.label?.trim();
    const notes = asset.usage_notes?.trim();
    const detail = [label, notes].filter(Boolean).join(" — ");
    lines.push(`- Image ${i + 1} [${role}]${detail ? `: ${detail}` : ""}`);
  }
  return lines.join("\n");
}

/** Prompt block for LLM copy / Flux when BVS is enabled. */
/** Brand assets to attach on HeyGen Video Agent `files[]` (ordered; capped by caller). */
export function resolveHeygenBvsReferenceAssets(
  snapshot: BrandBibleSnapshotV1 | null | undefined
): BrandBibleResolvedAsset[] {
  if (!snapshot) return [];
  const explicit = resolveExplicitFluxPromptAssets(snapshot).filter((a) => a.role !== "anti_reference");
  if (explicit.length > 0) return explicit.filter((a) => hasResolvableBrandAssetUrl(a));

  const resolved = Array.isArray(snapshot.resolved_assets) ? snapshot.resolved_assets : [];
  const roleOrder: BrandBibleAssetRole[] = [
    "logo",
    "style_reference",
    "character",
    "mascot",
    "motif",
    "background",
    "texture",
    "slide_frame",
  ];
  const out: BrandBibleResolvedAsset[] = [];
  const seen = new Set<string>();
  for (const role of roleOrder) {
    for (const asset of resolved) {
      if (asset.role !== role || asset.role === "anti_reference") continue;
      if (!hasResolvableBrandAssetUrl(asset)) continue;
      if (seen.has(asset.asset_id)) continue;
      seen.add(asset.asset_id);
      out.push(asset);
    }
  }
  return out;
}

function formatHeygenPromptAssetLine(asset: BrandBibleResolvedAsset, index1Based: number): string {
  const role = roleLabelForPrompt(asset.role);
  const label = asset.label?.trim();
  const notes = asset.usage_notes?.trim();
  const detail = [label, notes].filter(Boolean).join(" — ");
  return `- File ${index1Based} [${role}]${detail ? `: ${detail}` : ""} — use as brand reference (palette/mood/style); do not paste pixels verbatim unless the role is logo.`;
}

/** Prompt block appended to HeyGen Video Agent production briefs when BVS is available. */
export function buildBrandBibleHeygenPromptBlock(
  snapshot: BrandBibleSnapshotV1 | null | undefined,
  attachedAssets: BrandBibleResolvedAsset[]
): string | null {
  if (!snapshot) return null;

  const lines: string[] = [
    "Brand Visual System (BVS) — apply this brand's visual identity to motion graphics, b-roll, overlays, and end cards:",
  ];

  const mode = visualModeLabel(snapshot);
  if (mode) lines.push(`- Visual mode: ${mode}`);
  if (snapshot.palette.length) lines.push(`- Palette (use consistently): ${snapshot.palette.join(", ")}`);
  if (snapshot.allowed_motifs.length) lines.push(`- Allowed motifs: ${snapshot.allowed_motifs.join("; ")}`);
  if (snapshot.forbidden_motifs.length) lines.push(`- Forbidden motifs: ${snapshot.forbidden_motifs.join("; ")}`);

  const guide = snapshot.application_guide;
  if (guide.content_aims.length) lines.push(`- Content aims: ${guide.content_aims.join(", ")}`);
  if (guide.original_policy) lines.push(`- Original content policy: ${guide.original_policy}`);
  if (guide.instructions) {
    lines.push("- Marketer application guide:");
    lines.push(guide.instructions);
  }

  if (attachedAssets.length > 0) {
    lines.push(
      `- Uploaded brand asset files (${attachedAssets.length} attached on this request — match role instructions below):`
    );
    for (let i = 0; i < attachedAssets.length; i++) {
      lines.push(formatHeygenPromptAssetLine(attachedAssets[i]!, i + 1));
    }
  } else {
    const styleRefs = snapshot.resolved_assets.filter((a) => a.role === "style_reference" && a.public_url);
    const logos = snapshot.resolved_assets.filter((a) => a.role === "logo" && a.public_url);
    const mascots = snapshot.resolved_assets.filter(
      (a) => (a.role === "mascot" || a.role === "character") && a.public_url
    );
    if (logos.length) lines.push(`- Brand logos (${logos.length}): use on end cards and lower-thirds when relevant.`);
    if (styleRefs.length) {
      lines.push(`- Style references (${styleRefs.length}): match illustration/photo look — not competitor pixels.`);
    }
    if (mascots.length) {
      lines.push(`- Brand characters/mascots (${mascots.length}): use in motion overlays when relevant.`);
    }
  }

  if (snapshot.heygen_presenters?.length) {
    const names = snapshot.heygen_presenters
      .map((p) => p.label ?? p.avatar_name ?? p.avatar_id)
      .filter(Boolean)
      .slice(0, 4);
    if (names.length) {
      lines.push(`- Video presenters (HeyGen): ${names.join("; ")} — prefer approved avatar+voice pairs when routing allows.`);
    }
  }

  lines.push(
    "- INVARIANT: stay on-brand for every scene — palette, motifs, and tone; never invent off-brand neon, stock clichés, or competitor looks."
  );

  if (lines.length <= 1) return null;
  return lines.join("\n").trim();
}

export function buildBrandBiblePromptBlock(
  snapshot: BrandBibleSnapshotV1 | null | undefined,
  opts?: { forMimic?: boolean; forNewVisual?: boolean }
): string | null {
  if (!snapshot) return null;

  const forNewVisual = opts?.forNewVisual === true;
  const forMimic = !forNewVisual && opts?.forMimic === true;

  const lines: string[] = [
    forNewVisual
      ? "Brand Visual System (BVS) — subject-first original carousel plates (NOT competitor mimic):"
      : "Brand Visual System (BVS) — enforce this brand's visual identity on all generated visuals:",
  ];

  const mode = visualModeLabel(snapshot);
  if (mode) lines.push(`- Visual mode: ${mode}`);
  if (snapshot.palette.length) lines.push(`- Palette (use consistently): ${snapshot.palette.join(", ")}`);
  if (snapshot.allowed_motifs.length) lines.push(`- Allowed motifs: ${snapshot.allowed_motifs.join("; ")}`);
  if (snapshot.forbidden_motifs.length) lines.push(`- Forbidden motifs: ${snapshot.forbidden_motifs.join("; ")}`);

  const guide = snapshot.application_guide;
  if (guide.content_aims.length) lines.push(`- Content aims: ${guide.content_aims.join(", ")}`);
  if (forNewVisual && guide.original_policy) {
    lines.push(`- Original content policy: ${guide.original_policy}`);
  } else if (forMimic && guide.mimic_policy) {
    lines.push(`- When mimicking references: ${guide.mimic_policy}`);
  } else if (!forMimic && !forNewVisual && guide.original_policy) {
    lines.push(`- Original content policy: ${guide.original_policy}`);
  }
  if (guide.instructions) {
    lines.push("- Marketer application guide:");
    lines.push(guide.instructions);
  }

  const explicitFluxAssets = resolveExplicitFluxPromptAssets(snapshot);
  if (explicitFluxAssets.length > 0) {
    lines.push(
      `- Flux prompt references (${explicitFluxAssets.length} selected — match style/subject cues below, not competitor pixels):`
    );
    for (let i = 0; i < explicitFluxAssets.length; i++) {
      lines.push(formatFluxPromptAssetLine(explicitFluxAssets[i]!, i + 1));
    }
  } else {
  const styleRefs = snapshot.resolved_assets.filter((a) => a.role === "style_reference" && a.public_url);
  const characters = snapshot.resolved_assets.filter((a) => a.role === "character" && a.public_url);
  if (styleRefs.length) {
    lines.push(
      `- Style references (${styleRefs.length}): match illustration/photo style — not competitor pixels.`
    );
  }
  if (characters.length) {
    lines.push(`- Brand characters (${characters.length}): use consistently across slides when relevant.`);
  }

  const mascots = snapshot.resolved_assets.filter(
    (a) => (a.role === "mascot" || a.role === "character") && (a.public_url || a.label)
  );
  const frames = snapshot.resolved_assets.filter((a) => a.role === "slide_frame" && (a.public_url || a.label));
  const backgrounds = snapshot.resolved_assets.filter(
    (a) => (a.role === "background" || a.role === "texture") && (a.public_url || a.label)
  );
  const designElements = snapshot.resolved_assets.filter((a) => a.role === "motif" && (a.public_url || a.label));
  if (mascots.length) {
    lines.push(`- Brand mascots (${mascots.length}): use on tip/CTA slides when relevant — not full-bleed unless guide says so.`);
  }
  if (frames.length) {
    lines.push(`- Slide frames/borders (${frames.length}): apply as overlay framing on listicle slides when relevant.`);
  }
  if (backgrounds.length) {
    lines.push(
      forNewVisual
        ? `- Background references (${backgrounds.length}): mood/lighting cues only — always pair with a concrete hero subject (person, animal, object, or landscape); never output empty gradient/starfield plates.`
        : `- Background plates (${backgrounds.length}): star fields, gradients, or scene backdrops for slide generation.`
    );
  }
  if (designElements.length) {
    lines.push(
      forNewVisual
        ? `- Design elements (${designElements.length}): subtle accents inside a real scene only — never the entire background.`
        : `- Design elements (${designElements.length}): glyphs, ornaments, stickers — accent overlays when relevant.`
    );
  }
  }

  if (snapshot.heygen_presenters?.length) {
    const names = snapshot.heygen_presenters
      .map((p) => p.label ?? p.avatar_name ?? p.avatar_id)
      .filter(Boolean)
      .slice(0, 4);
    if (names.length) {
      lines.push(`- Video presenters (HeyGen): ${names.join("; ")} — use approved avatar+voice pairs for video flows.`);
    }
  }

  if (forMimic) {
    lines.push(
      "- INVARIANT: copy the reference deck's structure and persuasion; execute ALL visuals in this brand's style — never reproduce the competitor's look."
    );
  }
  if (forNewVisual) {
    lines.push(
      "- INVARIANT: brand-original plates — vivid hero subjects (people, animals, objects, landscapes) with this palette/mood; no abstract zodiac wallpaper or constellation templates."
    );
  }

  if (lines.length <= 1) return null;
  return lines.join("\n").trim();
}

export function appendBrandBibleToFluxPrompt(
  basePrompt: string,
  snapshot: BrandBibleSnapshotV1 | null | undefined,
  opts?: { forMimic?: boolean; forNewVisual?: boolean }
): string {
  let prompt = basePrompt.trim();
  const block = buildBrandBiblePromptBlock(snapshot, opts);
  if (block) prompt = `${prompt}\n\n${block}`;
  if (opts?.forNewVisual) {
    const refBlock = buildNewVisualBvsFluxImageReferencePromptBlock(
      resolveNewVisualBvsFluxImageReferenceAssets(snapshot)
    );
    if (refBlock) prompt = `${prompt}\n\n${refBlock}`;
  }
  return prompt;
}

/** @deprecated Prefer appendBrandBibleToFluxPrompt with explicit opts. */
export function appendBrandBibleToMimicFluxPrompt(basePrompt: string, snapshot: BrandBibleSnapshotV1 | null | undefined): string {
  return appendBrandBibleToFluxPrompt(basePrompt, snapshot, { forMimic: true });
}

export function paletteFromBrandBibleSnapshot(snapshot: BrandBibleSnapshotV1 | null | undefined): string[] {
  if (!snapshot?.palette?.length) return [];
  return snapshot.palette.filter((c) => typeof c === "string" && c.trim().length > 0);
}

/** Moodboard plates usable as carousel backgrounds (background + texture roles). */
export function listBrandBibleBackgroundPlates(
  snapshot: BrandBibleSnapshotV1 | null | undefined
): BrandBibleResolvedAsset[] {
  if (!snapshot) return [];
  const resolved = Array.isArray(snapshot.resolved_assets) ? snapshot.resolved_assets : [];
  return resolved.filter(
    (a) => (a.role === "background" || a.role === "texture") && hasResolvableBrandAssetUrl(a)
  );
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic background pick — stable per task/slot, varies across slots when multiple plates exist. */
export function pickBrandBibleBackgroundForSlide(
  snapshot: BrandBibleSnapshotV1 | null | undefined,
  seed: string,
  slideIndex: number
): BrandBibleResolvedAsset | null {
  const plates = listBrandBibleBackgroundPlates(snapshot);
  if (plates.length === 0) return null;
  const idx = fnv1a32(`${seed}:${slideIndex}`) % plates.length;
  return plates[idx] ?? plates[0] ?? null;
}
