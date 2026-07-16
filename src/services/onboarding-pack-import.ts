/**
 * Import a CAF Project Onboarding Pack into project config tables.
 */
import type { Pool } from "pg";
import {
  getBrandConstraints,
  getProductProfile,
  getStrategyDefaults,
  upsertBrandConstraints,
  upsertPlatformConstraints,
  upsertProductProfile,
  upsertStrategyDefaults,
  type BrandConstraintsRow,
  type StrategyDefaultsRow,
} from "../repositories/project-config.js";
import { ensureProject, getProjectBySlug, updateProjectBySlug } from "../repositories/core.js";
import { insertBrandProfileVersion } from "../repositories/brand-profiles.js";
import { insertBrandBibleVersion } from "../repositories/brand-bibles.js";
import { replaceSourceTabRows } from "../repositories/inputs-sources.js";
import { parseBrandBible } from "../domain/brand-bible.js";
import { parseBrandProfile } from "../domain/brand-profile.js";
import { parseContentRouteLaneIdsFromText } from "../domain/content-routes.js";
import {
  extractHexPalette,
  isGapValue,
  mapVisualMode,
  parseOnboardingPack,
  researchEntryToPayload,
  type OnboardingSectionKey,
  type ResearchTabKey,
} from "./onboarding-pack-parser.js";
import { applyContentRoutes } from "./content-routes-apply.js";

export interface OnboardingPackImportOptions {
  slug_override?: string | null;
  default_display_name?: string | null;
  dry_run?: boolean;
}

export interface OnboardingPackImportResult {
  ok: boolean;
  dry_run: boolean;
  project: { id: string; slug: string; display_name: string | null } | null;
  applied: Record<string, number>;
  gaps: string[];
  warnings: string[];
  errors: string[];
}

function field(section: Partial<Record<OnboardingSectionKey, Record<string, string>>>, key: OnboardingSectionKey, ...labels: string[]): string {
  const sec = section[key];
  if (!sec) return "";
  for (const label of labels) {
    const v = sec[label];
    if (v && !isGapValue(v)) return v.trim();
  }
  return "";
}

function firstNonEmpty(...values: string[]): string {
  for (const v of values) {
    if (v.trim()) return v.trim();
  }
  return "";
}

function normalizeSlug(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

function splitSemicolonList(text: string): string {
  if (!text.trim()) return "";
  return text
    .split(/[;\n]/)
    .map((x) => x.replace(/^[-*•\d.]+\s*/, "").trim())
    .filter((x) => x && !isGapValue(x))
    .join("; ");
}

function buildStrategyPatch(sections: ReturnType<typeof parseOnboardingPack>["sections"], brand: ReturnType<typeof parseOnboardingPack>["sections"]["brand_snapshot"]): Partial<Omit<StrategyDefaultsRow, "id" | "project_id">> {
  const s = sections.strategy ?? {};
  const b = brand ?? sections.brand_snapshot ?? {};
  return {
    core_offer: firstNonEmpty(field(sections, "brand_snapshot", "description"), s["description"] ?? ""),
    target_audience: firstNonEmpty(s["audience"] ?? "", s["target audience"] ?? ""),
    audience_problem: s["problem"] ?? "",
    transformation_promise: s["promise"] ?? "",
    positioning_statement: s["positioning"] ?? "",
    differentiation_angle: s["differentiation"] ?? "",
    strategic_content_pillars: s["content pillars"] ?? "",
    primary_content_goal: s["content goal"] ?? "",
    primary_business_goal: s["business goal"] ?? "",
    publishing_intensity: s["publishing intensity"] ?? "",
    north_star_metric: firstNonEmpty(s["north-star metric"] ?? "", s["north star metric"] ?? ""),
    owner: s["approval owner"] ?? "",
    project_type: s["audience type"] ?? "",
    instagram_handle: firstNonEmpty(b["instagram"] ?? "", b["primary instagram handle"] ?? "").replace(/^@/, ""),
    traffic_destination: firstNonEmpty(
      field(sections, "publishing", "link-in-bio", "link in bio"),
      b["website"] ?? "",
      b["website / product url"] ?? ""
    ),
    notes: [
      field(sections, "publishing", "channels"),
      field(sections, "publishing", "posting schedule"),
      field(sections, "publishing", "hashtag sets"),
    ]
      .filter(Boolean)
      .join("\n\n") || null,
  };
}

function buildBrandPatch(sections: ReturnType<typeof parseOnboardingPack>["sections"]): Partial<Omit<BrandConstraintsRow, "id" | "project_id">> {
  const v = sections.voice ?? {};
  const c = sections.compliance ?? {};
  const bannedClaims = [v["banned claims"] ?? "", c["banned claims"] ?? ""].filter(Boolean).join("\n");
  const disclaimers = [v["disclaimers"] ?? "", c["disclosures"] ?? ""].filter(Boolean).join("\n");
  return {
    tone: v["tone"] ?? "",
    audience_level: v["reading level"] ?? "",
    storytelling_style: v["storytelling style"] ?? "",
    cta_style_rules: v["cta style"] ?? "",
    emoji_policy: v["emoji policy"] ?? "",
    banned_words: splitSemicolonList(v["banned words"] ?? ""),
    banned_claims: bannedClaims,
    mandatory_disclaimers: disclaimers,
    notes: [
      v["humor / emotional intensity"] ?? "",
      v["example captions"] ?? "",
      c["category"] ? `Category: ${c["category"]}` : "",
      c["sensitive topics"] ? `Sensitive topics: ${c["sensitive topics"]}` : "",
    ]
      .filter(Boolean)
      .join("\n\n") || null,
    manual_review_required: true,
  };
}

function buildProductPatch(sections: ReturnType<typeof parseOnboardingPack>["sections"]): Record<string, unknown> {
  const b = sections.brand_snapshot ?? {};
  const r = sections.research ?? {};
  return {
    product_name: firstNonEmpty(b["product/app name"] ?? "", b["product or app name"] ?? "", b["display name"] ?? ""),
    product_url: firstNonEmpty(b["website"] ?? "", b["website / product url"] ?? ""),
    one_liner: b["description"] ?? "",
    competitors: r["competitors"] ?? "",
    key_features: b["core product capabilities"] ?? "",
    taglines: b["existing product language"] ?? b["existing strategic product language"] ?? "",
    keywords: field(sections, "publishing", "hashtag sets"),
    instagram_handle: firstNonEmpty(b["instagram"] ?? "").replace(/^@/, ""),
    metadata_json: {
      other_handles: b["other handles"] ?? null,
      onboarding_readiness: sections.gaps ? null : null,
    },
  };
}

function buildBrandProfileJson(sections: ReturnType<typeof parseOnboardingPack>["sections"], displayName: string): Record<string, unknown> | null {
  const visual = sections.visual ?? {};
  const voice = sections.voice ?? {};
  const paletteText =
    visual["palette (hex + roles)"] ?? visual["palette (hex and roles)"] ?? visual["palette"] ?? "";
  const profile = {
    schema_version: "brand_profile_v1",
    brand_name: displayName || null,
    visual_style: visual["style"] ?? null,
    tone: voice["tone"] ?? null,
    palette: extractHexPalette(paletteText),
    domain_metaphors: splitSemicolonList(visual["domain metaphors"] ?? "")
      .split("; ")
      .filter(Boolean),
    allowed_motifs: splitSemicolonList(visual["allowed motifs"] ?? "")
      .split("; ")
      .filter(Boolean),
    forbidden_motifs: splitSemicolonList(visual["forbidden motifs"] ?? "")
      .split("; ")
      .filter(Boolean),
    symbol_map: [],
    platform_focus: visual["platform visual focus"]
      ? visual["platform visual focus"].split(/[;,]/).map((x) => x.trim()).filter(Boolean)
      : [],
  };
  return parseBrandProfile(profile) ? profile : null;
}

function buildBrandBibleJson(sections: ReturnType<typeof parseOnboardingPack>["sections"]): Record<string, unknown> | null {
  const visual = sections.visual ?? {};
  const paletteText =
    visual["palette (hex + roles)"] ?? visual["palette (hex and roles)"] ?? visual["palette"] ?? "";
  const contentAims = visual["content aims"] ?? "";
  const bible = {
    schema_version: "brand_bible_v1",
    visual_mode: mapVisualMode(visual["visual mode"] ?? ""),
    visual_mode_custom: visual["visual mode"] ?? null,
    palette: extractHexPalette(paletteText),
    allowed_motifs: splitSemicolonList(visual["allowed motifs"] ?? "")
      .split("; ")
      .filter(Boolean),
    forbidden_motifs: splitSemicolonList(visual["forbidden motifs"] ?? "")
      .split("; ")
      .filter(Boolean),
    application_guide: {
      instructions: visual["application instructions"] ?? "",
      content_aims: contentAims
        ? contentAims.split(/[;\n]/).map((x) => x.trim()).filter(Boolean)
        : [],
      mimic_policy: visual["mimic policy"] ?? null,
      original_policy: visual["original policy"] ?? null,
    },
    asset_refs: [],
    heygen_presenters: [],
    heygen_ugc_presenters: [],
    flux_prompt_asset_ids: [],
  };
  return parseBrandBible(bible) ? bible : null;
}

async function applyResearchLists(
  db: Pool,
  projectId: string,
  lists: Partial<Record<ResearchTabKey, string[]>>
): Promise<number> {
  let total = 0;
  for (const [tab, entries] of Object.entries(lists) as Array<[ResearchTabKey, string[] | undefined]>) {
    if (!entries?.length) continue;
    const rows = entries
      .map((entry, row_index) => ({
        row_index,
        enabled: true,
        payload_json: researchEntryToPayload(tab, entry),
      }))
      .filter((r) => r.payload_json.Name || r.payload_json.Link);
    if (rows.length === 0) continue;
    await replaceSourceTabRows(db, projectId, tab, rows);
    total += rows.length;
  }
  return total;
}

function summarizePlan(parsed: ReturnType<typeof parseOnboardingPack>): Record<string, number> {
  const applied: Record<string, number> = {};
  if (parsed.sections.brand_snapshot) applied.project = 1;
  if (parsed.sections.strategy || parsed.sections.brand_snapshot) applied.strategy = 1;
  if (parsed.sections.voice || parsed.sections.compliance) applied.brand = 1;
  if (parsed.sections.brand_snapshot || parsed.sections.research) applied.product = 1;
  if (parsed.sections.visual) {
    applied.brand_profile = 1;
    applied.brand_bible = 1;
  }
  const researchCount = Object.values(parsed.researchLists).reduce((n, xs) => n + (xs?.length ?? 0), 0);
  if (researchCount > 0) applied.research_sources = researchCount;
  if (parsed.sections.formats) applied.platform = 1;
  const routeText =
    parsed.sections.formats?.["enabled content routes"] ??
    parsed.sections.formats?.["enabled formats"] ??
    "";
  if (parseContentRouteLaneIdsFromText(routeText).length > 0) applied.content_routes = 1;
  return applied;
}

export async function importProjectFromOnboardingPack(
  db: Pool,
  text: string,
  opts: OnboardingPackImportOptions = {}
): Promise<OnboardingPackImportResult> {
  const result: OnboardingPackImportResult = {
    ok: false,
    dry_run: Boolean(opts.dry_run),
    project: null,
    applied: {},
    gaps: [],
    warnings: [],
    errors: [],
  };

  const parsed = parseOnboardingPack(text);
  result.warnings.push(...parsed.warnings);
  result.errors.push(...parsed.errors);
  result.gaps = parsed.gaps;
  if (result.errors.length > 0) return result;

  const brandSnap = parsed.sections.brand_snapshot ?? {};
  const csvSlug = normalizeSlug(brandSnap["slug"] ?? "");
  const overrideSlug = normalizeSlug(opts.slug_override ?? "");
  const slug = overrideSlug || csvSlug;
  if (!slug) {
    result.errors.push("project slug missing — set Slug in section 1 or pass a slug override");
    return result;
  }
  if (overrideSlug && csvSlug && overrideSlug !== csvSlug) {
    result.warnings.push(`slug_override "${overrideSlug}" does not match pack slug "${csvSlug}"; using "${overrideSlug}"`);
  }

  const displayName =
    opts.default_display_name?.trim() ||
    brandSnap["display name"]?.trim() ||
    parsed.title?.trim() ||
    slug;

  if (result.dry_run) {
    const existing = await getProjectBySlug(db, slug);
    result.project = existing
      ? { id: existing.id, slug: existing.slug, display_name: existing.display_name }
      : { id: "(pending)", slug, display_name: displayName };
    result.applied = summarizePlan(parsed);
    result.ok = true;
    return result;
  }

  const project = await ensureProject(db, slug, displayName);
  result.project = { id: project.id, slug: project.slug, display_name: project.display_name };

  if (displayName && displayName !== project.display_name) {
    await updateProjectBySlug(db, slug, { display_name: displayName });
    result.applied.project = 1;
  }

  const strategyPatch = buildStrategyPatch(parsed.sections, brandSnap);
  const hasStrategy = Object.values(strategyPatch).some((v) => v != null && String(v).trim());
  if (hasStrategy) {
    const existing = await getStrategyDefaults(db, project.id);
    await upsertStrategyDefaults(db, project.id, {
      ...(existing ?? {}),
      ...strategyPatch,
    } as Omit<StrategyDefaultsRow, "id" | "project_id">);
    result.applied.strategy = 1;
  }

  const brandPatch = buildBrandPatch(parsed.sections);
  const hasBrand = Object.values(brandPatch).some((v) => v != null && String(v).trim());
  if (hasBrand) {
    const existing = await getBrandConstraints(db, project.id);
    await upsertBrandConstraints(db, project.id, {
      ...(existing ?? {}),
      ...brandPatch,
      manual_review_required: true,
    } as Omit<BrandConstraintsRow, "id" | "project_id">);
    result.applied.brand = 1;
  }

  const productPatch = buildProductPatch(parsed.sections);
  const hasProduct = Object.values(productPatch).some((v) => v != null && String(v).trim());
  if (hasProduct) {
    const existing = await getProductProfile(db, project.id);
    const existingMeta =
      existing?.metadata_json && typeof existing.metadata_json === "object" && !Array.isArray(existing.metadata_json)
        ? (existing.metadata_json as Record<string, unknown>)
        : {};
    await upsertProductProfile(db, project.id, {
      ...(existing ?? {}),
      ...productPatch,
      metadata_json: { ...existingMeta, ...(productPatch.metadata_json as Record<string, unknown>) },
    });
    result.applied.product = 1;
  }

  const profileJson = buildBrandProfileJson(parsed.sections, displayName);
  if (profileJson) {
    await insertBrandProfileVersion(db, project.id, profileJson, "Onboarding pack import");
    result.applied.brand_profile = 1;
  }

  const bibleJson = buildBrandBibleJson(parsed.sections);
  if (bibleJson) {
    await insertBrandBibleVersion(db, project.id, bibleJson, "Onboarding pack import");
    result.applied.brand_bible = 1;
  }

  const researchCount = await applyResearchLists(db, project.id, parsed.researchLists);
  if (researchCount > 0) result.applied.research_sources = researchCount;

  const formatsText = parsed.sections.formats?.["instagram rules"] ?? "";
  const enabledRoutesText =
    parsed.sections.formats?.["enabled content routes"] ??
    parsed.sections.formats?.["enabled formats"] ??
    "";
  if (formatsText.trim() || enabledRoutesText.trim()) {
    await upsertPlatformConstraints(db, project.id, {
      platform: "Instagram",
      caption_max_chars: null,
      hook_must_fit_first_lines: true,
      hook_max_chars: null,
      slide_min_chars: null,
      slide_max_chars: null,
      slide_min: null,
      slide_max: null,
      max_hashtags: null,
      hashtag_format_rule: null,
      line_break_policy: null,
      emoji_allowed: true,
      link_allowed: false,
      tag_allowed: true,
      formatting_rules: formatsText || null,
      posting_frequency_limit: null,
      best_posting_window: null,
      notes: enabledRoutesText || null,
      carousel_headline_font_px: null,
      carousel_body_font_px: null,
      carousel_kicker_font_px: null,
      carousel_cta_font_px: null,
      carousel_handle_font_px: null,
      carousel_font_scale: null,
    });
    result.applied.platform = 1;
  }

  const laneIds = parseContentRouteLaneIdsFromText(enabledRoutesText);
  if (laneIds.length > 0) {
    await applyContentRoutes(db, project.id, laneIds);
    result.applied.content_routes = laneIds.length;
  }

  if (parsed.readiness) {
    result.warnings.push(`Pack readiness: ${parsed.readiness}`);
  }

  result.ok = true;
  return result;
}
