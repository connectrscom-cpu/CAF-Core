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
import {
  ensureProject,
  getConstraints,
  getProjectBySlug,
  mergeConstraintUpdate,
  updateProjectBySlug,
  upsertConstraints,
} from "../repositories/core.js";
import { insertBrandProfileVersion } from "../repositories/brand-profiles.js";
import { insertBrandBibleVersion } from "../repositories/brand-bibles.js";
import { insertProductBibleVersion } from "../repositories/product-bibles.js";
import { replaceSourceTabRows } from "../repositories/inputs-sources.js";
import { parseBrandBible } from "../domain/brand-bible.js";
import { parseBrandProfile } from "../domain/brand-profile.js";
import { parseContentRouteLaneIdsFromText } from "../domain/content-routes.js";
import { emptyProductBibleDraft, parseProductBible } from "../domain/product-bible.js";
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
    project_type: firstNonEmpty(s["project type"] ?? "", s["audience type"] ?? ""),
    core_offer: firstNonEmpty(
      s["core offer"] ?? "",
      field(sections, "brand_snapshot", "description"),
      s["description"] ?? ""
    ),
    target_audience: firstNonEmpty(s["target audience"] ?? "", s["audience"] ?? ""),
    audience_problem: firstNonEmpty(s["audience problem"] ?? "", s["problem"] ?? ""),
    transformation_promise: firstNonEmpty(s["transformation promise"] ?? "", s["promise"] ?? ""),
    positioning_statement: firstNonEmpty(s["positioning statement"] ?? "", s["positioning"] ?? ""),
    differentiation_angle: firstNonEmpty(s["differentiation angle"] ?? "", s["differentiation"] ?? ""),
    strategic_content_pillars: firstNonEmpty(s["content pillars"] ?? "", s["strategic content pillars"] ?? ""),
    primary_content_goal: firstNonEmpty(s["primary content goal"] ?? "", s["content goal"] ?? ""),
    primary_business_goal: firstNonEmpty(s["primary business goal"] ?? "", s["business goal"] ?? ""),
    brand_archetype: s["brand archetype"] ?? "",
    publishing_intensity: s["publishing intensity"] ?? "",
    north_star_metric: firstNonEmpty(s["north-star metric"] ?? "", s["north star metric"] ?? ""),
    owner: firstNonEmpty(s["approval owner"] ?? "", s["content approval owner"] ?? ""),
    instagram_handle: firstNonEmpty(
      s["instagram handle"] ?? "",
      b["instagram handle"] ?? "",
      b["instagram"] ?? "",
      b["primary instagram handle"] ?? ""
    ).replace(/^@/, ""),
    traffic_destination: firstNonEmpty(
      s["traffic destination"] ?? "",
      field(sections, "publishing", "link-in-bio", "link in bio"),
      b["website"] ?? "",
      b["website / product url"] ?? ""
    ),
    notes: [
      s["niche vs product ratio"] ? `Niche vs product ratio: ${s["niche vs product ratio"]}` : "",
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
  const bannedClaims = [
    v["banned claims"] ?? "",
    c["banned claims"] ?? "",
  ].filter(Boolean).join("\n");
  const disclaimers = [
    v["mandatory disclaimers"] ?? "",
    v["disclaimers"] ?? "",
    c["disclosures"] ?? "",
  ].filter(Boolean).join("\n");
  return {
    tone: v["tone"] ?? "",
    voice_style: firstNonEmpty(v["voice style"] ?? "", v["tone / voice"] ?? ""),
    audience_level: firstNonEmpty(v["audience level"] ?? "", v["reading level"] ?? ""),
    storytelling_style: v["storytelling style"] ?? "",
    cta_style_rules: firstNonEmpty(v["cta style rules"] ?? "", v["cta style"] ?? ""),
    emoji_policy: v["emoji policy"] ?? "",
    banned_words: splitSemicolonList(v["banned words"] ?? ""),
    banned_claims: bannedClaims,
    mandatory_disclaimers: disclaimers,
    notes: [
      v["humor / emotional intensity"] ?? "",
      v["example captions"] ?? "",
      v["regulated category"] ? `Category: ${v["regulated category"]}` : "",
      c["category"] ? `Category: ${c["category"]}` : "",
      v["sensitive topics"] ? `Sensitive topics: ${v["sensitive topics"]}` : "",
      c["sensitive topics"] ? `Sensitive topics: ${c["sensitive topics"]}` : "",
      v["sponsor / affiliate disclosure"] ?? "",
    ]
      .filter(Boolean)
      .join("\n\n") || null,
    manual_review_required: true,
  };
}

function parseOptionalNumber(raw: string): number | null {
  const t = raw.trim();
  if (!t || /^\[(?:REC|GAP|FACT)\]/i.test(t) || /use caf defaults/i.test(t) || /^n\/a$/i.test(t)) {
    return null;
  }
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseOptionalBool(raw: string): boolean | null {
  const t = raw.trim().toLowerCase();
  if (!t || /use caf defaults/i.test(t) || /^n\/a$/i.test(t) || /^\[(?:rec|gap|fact)\]/i.test(t)) {
    return null;
  }
  if (["true", "yes", "1"].includes(t)) return true;
  if (["false", "no", "0"].includes(t)) return false;
  return null;
}

function buildConstraintsPatch(
  sections: ReturnType<typeof parseOnboardingPack>["sections"]
): Parameters<typeof mergeConstraintUpdate>[1] | null {
  const s = sections.system_limits ?? {};
  if (Object.keys(s).length === 0) return null;

  const patch: Parameters<typeof mergeConstraintUpdate>[1] = {};
  const setNum = (key: keyof Parameters<typeof mergeConstraintUpdate>[1], ...labels: string[]) => {
    for (const label of labels) {
      const n = parseOptionalNumber(s[label] ?? "");
      if (n != null) {
        (patch as Record<string, unknown>)[key] = n;
        return;
      }
    }
  };

  setNum("max_daily_jobs", "max daily jobs");
  setNum("min_score_to_generate", "min score to generate");
  setNum("max_active_prompt_versions", "max active prompt versions");
  setNum("default_variation_cap", "default variation cap");
  setNum("auto_validation_pass_threshold", "auto-validation pass threshold");
  setNum("max_carousel_jobs_per_run", "max carousel jobs (per run plan)", "max carousel jobs");
  setNum("max_video_jobs_per_run", "max video/reel jobs (per run plan)", "max video jobs");

  const perFlowRaw = firstNonEmpty(
    s["per-flow caps (json)"] ?? "",
    s["per-flow caps"] ?? "",
    s["max jobs per flow type"] ?? ""
  );
  if (perFlowRaw && !/use caf defaults/i.test(perFlowRaw)) {
    try {
      patch.max_jobs_per_flow_type = JSON.parse(perFlowRaw);
    } catch {
      /* ignore invalid JSON */
    }
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function pickProductField(
  p: Record<string, string>,
  ...labels: string[]
): string {
  for (const label of labels) {
    const v = p[label];
    if (v && !isGapValue(v) && v.trim().toLowerCase() !== "n/a") return v.trim();
  }
  return "";
}

function buildProductPatch(sections: ReturnType<typeof parseOnboardingPack>["sections"]): Record<string, unknown> {
  const p = sections.product ?? {};
  const b = sections.brand_snapshot ?? {};
  const r = sections.research ?? {};
  const hasDedicated = Object.keys(p).length > 0;

  return {
    product_name: firstNonEmpty(
      pickProductField(p, "product name"),
      b["product/app name"] ?? "",
      b["product or app name"] ?? "",
      b["display name"] ?? ""
    ),
    product_category: pickProductField(p, "product category"),
    product_url: firstNonEmpty(
      pickProductField(p, "product url"),
      b["website"] ?? "",
      b["website / product url"] ?? ""
    ),
    one_liner: firstNonEmpty(pickProductField(p, "one-liner", "one liner"), hasDedicated ? "" : b["description"] ?? ""),
    value_proposition: pickProductField(p, "value proposition"),
    elevator_pitch: pickProductField(p, "elevator pitch"),
    primary_audience: pickProductField(p, "primary audience"),
    audience_pain_points: pickProductField(p, "audience pain points"),
    audience_desires: pickProductField(p, "audience desires"),
    use_cases: pickProductField(p, "top use cases / scenarios", "use cases", "top use cases"),
    key_features: firstNonEmpty(
      pickProductField(p, "key features"),
      b["core product capabilities"] ?? ""
    ),
    key_benefits: pickProductField(p, "key benefits"),
    differentiators: pickProductField(p, "differentiators"),
    proof_points: pickProductField(p, "proof points"),
    social_proof: pickProductField(p, "social proof"),
    competitors: firstNonEmpty(pickProductField(p, "competitors"), r["competitors"] ?? ""),
    comparison_angles: pickProductField(p, "comparison angles"),
    pricing_summary: pickProductField(p, "pricing summary"),
    current_offer: pickProductField(p, "current offer"),
    offer_urgency: pickProductField(p, "urgency", "offer urgency"),
    guarantee: pickProductField(p, "guarantee"),
    primary_cta: pickProductField(p, "primary cta"),
    secondary_cta: pickProductField(p, "secondary cta"),
    do_say: pickProductField(p, "always say / preferred phrasing", "always say"),
    dont_say: pickProductField(p, "never say / forbidden phrasing", "never say"),
    taglines: b["existing product language"] ?? b["existing strategic product language"] ?? "",
    keywords: field(sections, "publishing", "hashtag sets"),
    metadata_json: {
      handles: {
        instagram: firstNonEmpty(b["instagram handle"] ?? "", b["instagram"] ?? "").replace(/^@/, "") || null,
        tiktok: firstNonEmpty(b["tiktok handle"] ?? "").replace(/^@/, "") || null,
        facebook: firstNonEmpty(b["facebook handle / page"] ?? "", b["facebook handle"] ?? "") || null,
        linkedin: firstNonEmpty(b["linkedin handle / page"] ?? "", b["linkedin handle"] ?? "") || null,
        reddit: firstNonEmpty(b["reddit username"] ?? "") || null,
        x_twitter: firstNonEmpty(b["x / twitter handle"] ?? "", b["twitter handle"] ?? "").replace(/^@/, "") || null,
        youtube: firstNonEmpty(b["youtube handle"] ?? "") || null,
      },
      other_handles: b["other handles"] ?? null,
      instagram_handle: firstNonEmpty(b["instagram handle"] ?? "", b["instagram"] ?? "").replace(/^@/, "") || null,
    },
  };
}

function slugProductKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function buildProductBibleJson(
  sections: ReturnType<typeof parseOnboardingPack>["sections"]
): Record<string, unknown> | null {
  const pb = sections.product_bible ?? {};
  if (Object.keys(pb).length === 0) return null;

  const draft = emptyProductBibleDraft();
  draft.application_guide.instructions =
    pickProductField(pb, "instructions") || draft.application_guide.instructions;
  draft.application_guide.heygen_policy =
    pickProductField(pb, "heygen / video policy", "heygen / video policy", "heygen policy") || null;
  draft.application_guide.flux_policy =
    pickProductField(pb, "flux / image policy", "flux policy", "image policy") || null;

  // Flat module fields: "key", "label", "one-liner", "description" (first module only from field map).
  // Multi-module tables are pasted in Review; import captures guide + optional first module.
  const key = pickProductField(pb, "key");
  const label = pickProductField(pb, "label");
  if (key && label) {
    draft.products.push({
      key: slugProductKey(key) || slugProductKey(label),
      label,
      description: pickProductField(pb, "description") || null,
      one_liner: pickProductField(pb, "one-liner", "one liner") || null,
      features: [],
      asset_refs: [],
    });
  }

  const hostsRaw = pickProductField(pb, "product ugc hosts");
  if (hostsRaw) {
    for (const line of hostsRaw.split("\n")) {
      const parts = line.split("|").map((x) => x.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      const [hostLabel, avatarId, voiceId] = parts.length === 2
        ? [null, parts[0], parts[1]]
        : [parts[0], parts[1], parts[2] ?? null];
      if (!avatarId) continue;
      draft.heygen_ugc_presenters.push({
        label: hostLabel,
        avatar_id: avatarId,
        voice_id: voiceId,
        avatar_name: null,
        voice_name: null,
        preview_image_url: null,
      });
    }
  }

  const parsed = parseProductBible(draft);
  if (!parsed) return null;
  const hasGuide =
    Boolean(parsed.application_guide.instructions.trim()) ||
    Boolean(parsed.application_guide.heygen_policy) ||
    Boolean(parsed.application_guide.flux_policy);
  if (!hasGuide && parsed.products.length === 0 && parsed.heygen_ugc_presenters.length === 0) {
    return null;
  }
  return parsed as unknown as Record<string, unknown>;
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
  if (parsed.sections.product || parsed.sections.brand_snapshot || parsed.sections.research) applied.product = 1;
  if (parsed.sections.product_bible) applied.product_bible = 1;
  if (parsed.sections.visual) {
    applied.brand_profile = 1;
    applied.brand_bible = 1;
  }
  const researchCount = Object.values(parsed.researchLists).reduce((n, xs) => n + (xs?.length ?? 0), 0);
  if (researchCount > 0) applied.research_sources = researchCount;
  if (parsed.sections.formats) applied.platform = 1;
  if (parsed.sections.platforms) applied.platform = 1;
  if (parsed.sections.system_limits) applied.system_limits = 1;
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
  const { metadata_json: _metaIgnore, ...productCols } = productPatch;
  const hasProduct = Object.values(productCols).some((v) => v != null && String(v).trim().length > 0);
  if (hasProduct) {
    const existing = await getProductProfile(db, project.id);
    const existingMeta =
      existing?.metadata_json && typeof existing.metadata_json === "object" && !Array.isArray(existing.metadata_json)
        ? (existing.metadata_json as Record<string, unknown>)
        : {};
    const meta = (productPatch.metadata_json as Record<string, unknown> | undefined) ?? {};
    await upsertProductProfile(db, project.id, {
      ...(existing ?? {}),
      ...productPatch,
      metadata_json: { ...existingMeta, ...meta },
    });
    result.applied.product = 1;
  }

  const productBibleJson = buildProductBibleJson(parsed.sections);
  if (productBibleJson) {
    await insertProductBibleVersion(db, project.id, productBibleJson, "Onboarding pack import");
    result.applied.product_bible = 1;
  }

  const constraintsPatch = buildConstraintsPatch(parsed.sections);
  if (constraintsPatch) {
    const existingConstraints = await getConstraints(db, project.id);
    const merged = mergeConstraintUpdate(existingConstraints, constraintsPatch);
    await upsertConstraints(db, project.id, merged);
    result.applied.system_limits = 1;
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

  const formatsText =
    parsed.sections.platforms?.["formatting rules"] ??
    parsed.sections.formats?.["instagram rules"] ??
    "";
  const enabledRoutesText =
    parsed.sections.formats?.["enabled content routes"] ??
    parsed.sections.formats?.["enabled formats"] ??
    "";
  const plat = parsed.sections.platforms ?? {};
  const hasPlatformDetail = Object.keys(plat).length > 0 || formatsText.trim() || enabledRoutesText.trim();
  if (hasPlatformDetail) {
    await upsertPlatformConstraints(db, project.id, {
      platform: firstNonEmpty(plat["platform"] ?? "", "Instagram"),
      caption_max_chars: parseOptionalNumber(plat["caption max chars"] ?? ""),
      hook_must_fit_first_lines:
        parseOptionalBool(plat["hook must fit first lines"] ?? "") ?? true,
      hook_max_chars: parseOptionalNumber(plat["hook max chars"] ?? ""),
      slide_min_chars: parseOptionalNumber(plat["slide min chars"] ?? ""),
      slide_max_chars: parseOptionalNumber(plat["slide max chars"] ?? ""),
      slide_min: parseOptionalNumber(plat["min slides"] ?? ""),
      slide_max: parseOptionalNumber(plat["max slides"] ?? ""),
      max_hashtags: parseOptionalNumber(plat["max hashtags"] ?? ""),
      hashtag_format_rule: firstNonEmpty(plat["hashtag format rule"] ?? "") || null,
      line_break_policy: firstNonEmpty(plat["line break policy"] ?? "") || null,
      emoji_allowed: true,
      link_allowed: false,
      tag_allowed: true,
      formatting_rules: formatsText || null,
      posting_frequency_limit: null,
      best_posting_window: null,
      notes: enabledRoutesText || null,
      carousel_headline_font_px: parseOptionalNumber(plat["carousel headline size (px)"] ?? ""),
      carousel_body_font_px: parseOptionalNumber(plat["carousel body size (px)"] ?? ""),
      carousel_kicker_font_px: parseOptionalNumber(plat["carousel kicker size (px)"] ?? ""),
      carousel_cta_font_px: parseOptionalNumber(plat["carousel cta size (px)"] ?? ""),
      carousel_handle_font_px: parseOptionalNumber(plat["carousel handle size (px)"] ?? ""),
      carousel_font_scale: parseOptionalNumber(plat["carousel font scale"] ?? ""),
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
