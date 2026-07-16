import type { BrandBibleAssetRole } from "./types";

export type BrandBibleAssetCategory = {
  id: string;
  title: string;
  hint: string;
  emptyLabel: string;
  /** Bible roles shown in this section (supports legacy aliases). */
  roles: BrandBibleAssetRole[];
  /** Role assigned when uploading into this section. */
  defaultRole: BrandBibleAssetRole;
  uploadLabelPrefix: string;
  /** Shown in category nav badge. */
  shortLabel: string;
};

export const BRAND_BIBLE_ASSET_CATEGORIES: BrandBibleAssetCategory[] = [
  {
    id: "style_reference",
    shortLabel: "Style",
    title: "Style references",
    hint: "Overall illustration or photo direction — line weight, color grading, composition. Prefer 1080×1350 (4:5) finished carousel mockups. CAF matches this look, not competitor pixels.",
    emptyLabel: "No style references yet — upload 2–3 carousel screenshots at 1080×1350 that define your visual lane.",
    roles: ["style_reference"],
    defaultRole: "style_reference",
    uploadLabelPrefix: "Style reference",
  },
  {
    id: "background",
    shortLabel: "Backgrounds",
    title: "Backgrounds",
    hint: "Star fields, midnight gradients, nebula plates, or full-bleed backdrops for slide generation.",
    emptyLabel: "No backgrounds yet — upload cosmic plates or gradient PNGs/JPGs.",
    roles: ["background", "texture"],
    defaultRole: "background",
    uploadLabelPrefix: "Background",
  },
  {
    id: "design_element",
    shortLabel: "Elements",
    title: "Design elements",
    hint: "Zodiac glyphs, sparkles, orbit stickers, corner ornaments. Use transparent PNG (no baked-in captions).",
    emptyLabel: "No design elements yet — upload PNG stickers or motifs with transparent backgrounds.",
    roles: ["motif"],
    defaultRole: "motif",
    uploadLabelPrefix: "Design element",
  },
  {
    id: "mascot",
    shortLabel: "Mascots",
    title: "Mascots & characters",
    hint: "Upload multiple poses per mascot (e.g. “Cosmic guide — waving”, “Cosmic guide — pointing”). PNG with transparency works best.",
    emptyLabel: "No mascots yet — upload your zodiac guide or brand character in different poses.",
    roles: ["mascot", "character"],
    defaultRole: "mascot",
    uploadLabelPrefix: "Mascot",
  },
  {
    id: "slide_frame",
    shortLabel: "Frames",
    title: "Slide frames & borders",
    hint: "Border overlays from your brand bible — toggle per slide or apply to all slides in the text layout editor.",
    emptyLabel: "No frames yet — upload border or frame PNGs.",
    roles: ["slide_frame"],
    defaultRole: "slide_frame",
    uploadLabelPrefix: "Slide frame",
  },
  {
    id: "logo",
    shortLabel: "Logos",
    title: "Logos & marks",
    hint: "Primary logo, wordmark, or icon. Prefer transparent PNG/SVG — upload light, dark, and mono variants, plus one on a solid brand-color background.",
    emptyLabel: "No logos yet — upload transparent PNG/SVG logo files (light + dark variants).",
    roles: ["logo"],
    defaultRole: "logo",
    uploadLabelPrefix: "Logo",
  },
];
