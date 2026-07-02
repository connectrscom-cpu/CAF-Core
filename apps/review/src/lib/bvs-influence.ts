/**
 * Read Brand Visual System (`generation_payload.bvs_v1`) for Review explainability panels.
 */
import { BRAND_BIBLE_ASSET_ROLES } from "@/lib/marketer/brand-bible-adapters";

export type BvsResolvedAsset = {
  asset_id: string;
  role: string;
  label: string | null;
  usage_notes: string | null;
  public_url: string | null;
  kind: string | null;
};

export type BvsSnapshot = {
  visual_mode: string | null;
  visual_mode_custom: string | null;
  palette: string[];
  allowed_motifs: string[];
  forbidden_motifs: string[];
  application_guide: {
    instructions: string;
    content_aims: string[];
    mimic_policy: string | null;
    original_policy: string | null;
  };
  resolved_assets: BvsResolvedAsset[];
};

export type BvsInfluenceContext = {
  enabled: boolean;
  bible_version: number | null;
  snapshot: BvsSnapshot | null;
  mimicEnabled: boolean;
};

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
}

export function parseBvsSnapshot(raw: unknown): BvsSnapshot | null {
  const rec = asRec(raw);
  if (!rec || rec.schema_version !== "brand_bible_v1") return null;

  const guide = asRec(rec.application_guide) ?? {};
  const resolved: BvsResolvedAsset[] = [];
  if (Array.isArray(rec.resolved_assets)) {
    for (const row of rec.resolved_assets) {
      const r = asRec(row);
      if (!r) continue;
      resolved.push({
        asset_id: String(r.asset_id ?? ""),
        role: String(r.role ?? ""),
        label: str(r.label),
        usage_notes: str(r.usage_notes),
        public_url: str(r.public_url),
        kind: str(r.kind),
      });
    }
  }

  return {
    visual_mode: str(rec.visual_mode),
    visual_mode_custom: str(rec.visual_mode_custom),
    palette: strList(rec.palette),
    allowed_motifs: strList(rec.allowed_motifs),
    forbidden_motifs: strList(rec.forbidden_motifs),
    application_guide: {
      instructions: str(guide.instructions) ?? "",
      content_aims: strList(guide.content_aims),
      mimic_policy: str(guide.mimic_policy),
      original_policy: str(guide.original_policy),
    },
    resolved_assets: resolved,
  };
}

export function parseBvsFromGenerationPayload(
  payload: Record<string, unknown> | null | undefined,
  mimicV1?: Record<string, unknown> | null
): BvsInfluenceContext {
  const bvs = asRec(payload?.bvs_v1);
  const enabled = bvs?.enabled === true;
  const versionRaw = bvs?.bible_version;
  const bible_version =
    typeof versionRaw === "number" && Number.isFinite(versionRaw) ? Math.trunc(versionRaw) : null;

  let snapshot = parseBvsSnapshot(bvs?.bible_snapshot);
  const mimicSnap = parseBvsSnapshot(mimicV1?.bvs_bible_snapshot);
  if (!snapshot && mimicSnap) snapshot = mimicSnap;

  const mimicEnabled = mimicV1?.bvs_enabled === true || enabled;

  return { enabled, bible_version, snapshot, mimicEnabled };
}

export function visualModeLabel(snapshot: BvsSnapshot | null): string | null {
  if (!snapshot) return null;
  if (snapshot.visual_mode === "custom" && snapshot.visual_mode_custom) return snapshot.visual_mode_custom;
  if (snapshot.visual_mode) return snapshot.visual_mode.replace(/_/g, " ");
  return snapshot.visual_mode_custom;
}

export function roleLabel(role: string): string {
  return BRAND_BIBLE_ASSET_ROLES.find((r) => r.id === role)?.label ?? role.replace(/_/g, " ");
}

export function bvsPromptWasApplied(prompt: string | null | undefined): boolean {
  if (!prompt) return false;
  return /Brand Visual System \(BVS\)/i.test(prompt);
}

export type BvsInfluenceSection = {
  title: string;
  lines: string[];
};

/** Human-readable explanation of how BVS affected this job. */
export function buildBvsInfluenceSections(
  ctx: BvsInfluenceContext,
  opts?: {
    slideIndex?: number;
    generatedCopy?: string | null;
    renderPalette?: string[];
    imagePromptApplied?: boolean;
  }
): BvsInfluenceSection[] {
  if (!ctx.enabled && !ctx.mimicEnabled) {
    return [
      {
        title: "Brand Visual System",
        lines: [
          "BVS was off for this piece — CAF followed the reference post structure and visuals without applying your brand bible.",
          "Enable “Use Brand Visual System” when queueing ideas or top performers to stamp your moodboard rules onto the job.",
        ],
      },
    ];
  }

  const snap = ctx.snapshot;
  const sections: BvsInfluenceSection[] = [];

  const statusLines = [
    ctx.bible_version != null ? `Brand bible v${ctx.bible_version} was frozen onto this job at plan time.` : "BVS was enabled, but no active brand bible snapshot was found on this job.",
    "The reference carousel still drives slide structure and persuasion; BVS steers how visuals and copy are reinterpreted in your brand’s look.",
  ];
  sections.push({ title: "What was applied", lines: statusLines });

  if (snap) {
    const bibleLines: string[] = [];
    const mode = visualModeLabel(snap);
    if (mode) bibleLines.push(`Visual mode: ${mode}`);
    if (snap.palette.length) bibleLines.push(`Palette: ${snap.palette.join(", ")}`);
    if (snap.allowed_motifs.length) bibleLines.push(`Allowed motifs: ${snap.allowed_motifs.join("; ")}`);
    if (snap.forbidden_motifs.length) bibleLines.push(`Avoid: ${snap.forbidden_motifs.join("; ")}`);
    if (snap.application_guide.instructions) {
      bibleLines.push(`Application guide: ${snap.application_guide.instructions}`);
    }
    if (snap.application_guide.mimic_policy) {
      bibleLines.push(`Mimic policy: ${snap.application_guide.mimic_policy}`);
    }
    const withRoles = snap.resolved_assets.filter((a) => a.public_url || a.label);
    if (withRoles.length) {
      bibleLines.push(
        `Moodboard roles (${withRoles.length}): ${withRoles
          .map((a) => `${roleLabel(a.role)}${a.label ? ` — ${a.label}` : ""}`)
          .join("; ")}`
      );
    }
    if (bibleLines.length) sections.push({ title: "Your brand bible", lines: bibleLines });
  }

  const copyLines = [
    "Copy is reinterpreted from the reference — not copied verbatim. BVS merges your bible into the brand profile used during mimic prep (tone, motifs, application guide).",
  ];
  if (snap?.application_guide.mimic_policy) {
    copyLines.push(`Policy in effect: ${snap.application_guide.mimic_policy}`);
  }
  if (opts?.generatedCopy?.trim()) {
    copyLines.push(`On slide ${opts.slideIndex ?? "?"} you’re seeing: “${opts.generatedCopy.trim().slice(0, 220)}${opts.generatedCopy.trim().length > 220 ? "…" : ""}”`);
  }
  sections.push({ title: "How it influenced copy", lines: copyLines });

  const visualLines = [
    "Slide backgrounds are regenerated with Flux. When BVS is on, the image prompt includes your palette, motifs, and mimic policy — not the competitor’s pixels.",
    "Carousel theming can pull colors from your bible palette for template slides and typography accents.",
  ];
  if (opts?.imagePromptApplied) {
    visualLines.push("Confirmed: the image prompt for this slide includes the Brand Visual System block.");
  } else if (opts?.imagePromptApplied === false) {
    visualLines.push("Image prompt audit did not show a BVS block yet — regen may predate BVS or audits may still be loading.");
  }
  const palette = opts?.renderPalette?.length ? opts.renderPalette : snap?.palette ?? [];
  if (palette.length) {
    visualLines.push(`Colors in play: ${palette.join(", ")}`);
  }
  sections.push({ title: "How it influenced visuals", lines: visualLines });

  sections.push({
    title: "What you’re looking at",
    lines: [
      "Structure and slide beats come from the reference (“Why this works”). Look, palette, and motifs should match your brand bible when BVS is on.",
      "If visuals still feel off-reference, edit the bible’s mimic policy or assign style-reference roles on moodboard assets, then regenerate slides.",
    ],
  });

  return sections;
}
