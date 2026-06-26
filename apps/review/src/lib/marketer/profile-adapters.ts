import type { BrandProfile } from "./types";



function str(v: unknown): string {

  if (typeof v === "string") return v.trim();

  if (typeof v === "number") return String(v);

  return "";

}



function splitList(v: unknown, sep = /[;,\n]/): string[] {

  if (Array.isArray(v)) return v.map(str).filter(Boolean);

  const s = str(v);

  if (!s) return [];

  return s.split(sep).map((x) => x.trim()).filter(Boolean);

}



function joinList(items: string[]): string {

  return items.map((x) => x.trim()).filter(Boolean).join("; ");

}



export interface ProfileSources {

  slug: string;

  displayName: string;

  strategy: Record<string, unknown> | null;

  brand: Record<string, unknown> | null;

  product: Record<string, unknown> | null;

  platforms: Array<Record<string, unknown>> | null;

  brandProfileParsed: Record<string, unknown> | null;

}



export function toBrandProfile(src: ProfileSources): BrandProfile {

  const strategy = src.strategy ?? {};

  const brand = src.brand ?? {};

  const product = src.product ?? {};

  const bp = src.brandProfileParsed ?? {};



  const platforms = (src.platforms ?? [])

    .map((p) => str(p.platform))

    .filter(Boolean);



  return {

    slug: src.slug,

    displayName: src.displayName,

    description: str(strategy.core_offer) || str(strategy.positioning_statement),

    voice: [str(brand.tone), str(brand.voice_style)].filter(Boolean).join(" · ") || str(bp.tone),

    audience: str(strategy.target_audience) || str(product.primary_audience),

    contentGoals:

      str(strategy.primary_content_goal) || str(strategy.strategic_content_pillars),

    positioning: str(strategy.positioning_statement) || str(strategy.differentiation_angle),

    competitors: str(product.competitors),

    productName: str(product.product_name) || str(product.name),

    productUrl: str(product.product_url) || str(product.url),

    instagramHandle: str(product.instagram_handle) || str(brand.instagram_handle),

    visualStyle: str(bp.visual_style),

    colors: joinList(splitList(bp.palette)),

    domainMetaphors: joinList(splitList(bp.domain_metaphors)),

    allowedMotifs: joinList(splitList(bp.allowed_motifs)),

    forbiddenMotifs: joinList(splitList(bp.forbidden_motifs)),

    bannedWords: splitList(brand.banned_words, /[;\n]/),

    platforms,

    platformFocus: splitList(bp.platform_focus),

    hasBrandProfileVersion: Object.keys(bp).length > 0,

  };

}



export interface ProfileEditPayloads {

  strategy: Record<string, unknown>;

  brand: Record<string, unknown>;

  product: Record<string, unknown>;

  brandProfileV1: Record<string, unknown>;

}



export function fromBrandProfileEdit(edit: {

  description: string;

  voice: string;

  audience: string;

  contentGoals: string;

  positioning: string;

  bannedWords: string;

  competitors: string;

  productName: string;

  productUrl: string;

  instagramHandle: string;

  visualStyle: string;

  colors: string;

  domainMetaphors: string;

  allowedMotifs: string;

  forbiddenMotifs: string;

  platformFocus: string[];

}): ProfileEditPayloads {

  const palette = splitList(edit.colors, /[;,\n]/);

  return {

    strategy: {

      core_offer: edit.description.trim(),

      target_audience: edit.audience.trim(),

      primary_content_goal: edit.contentGoals.trim(),

      positioning_statement: edit.positioning.trim(),

    },

    brand: {

      tone: edit.voice.trim(),

      banned_words: edit.bannedWords.trim(),

      instagram_handle: edit.instagramHandle.trim().replace(/^@/, ""),

    },

    product: {

      competitors: edit.competitors.trim(),

      product_name: edit.productName.trim(),

      product_url: edit.productUrl.trim(),

      instagram_handle: edit.instagramHandle.trim().replace(/^@/, ""),

    },

    brandProfileV1: {

      schema_version: "brand_profile_v1",

      visual_style: edit.visualStyle.trim() || null,

      tone: edit.voice.trim() || null,

      palette,

      domain_metaphors: splitList(edit.domainMetaphors, /[;,\n]/),

      allowed_motifs: splitList(edit.allowedMotifs, /[;,\n]/),

      forbidden_motifs: splitList(edit.forbiddenMotifs, /[;,\n]/),

      platform_focus: edit.platformFocus ?? [],

      symbol_map: [],

      brand_name: edit.productName.trim() || null,

    },

  };

}


