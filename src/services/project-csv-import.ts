/**
 * Import a full project definition from a key/value CSV.
 *
 * CSV shape (header required, exactly these four columns):
 *     section,row_key,field,value
 *
 * Singleton sections use an empty `row_key`:
 *   - project             → slug, display_name, color, active
 *   - strategy            → caf_core.strategy_defaults columns
 *   - brand               → caf_core.brand_constraints columns
 *   - product             → caf_core.project_product_profile columns
 *   - heygen_defaults     → voice_id | avatar_id | avatar_pool_json (writes caf_core.heygen_config rows
 *                           the same way `PUT /v1/projects/:slug/heygen-defaults` does)
 *
 * Multi-row sections use `row_key` as the natural key for that row:
 *   - platform            (row_key = platform name)         → caf_core.platform_constraints
 *   - flow_type           (row_key = flow_type)             → caf_core.allowed_flow_types
 *   - risk_rule           (row_key = flow_type)             → caf_core.risk_rules (replace-per-flow semantics)
 *   - reference_post      (row_key = reference_post_id)     → caf_core.reference_posts
 *   - integration         (row_key = platform)              → caf_core.project_integrations
 *
 * Partial updates are safe: we read the existing row (when present) and merge CSV fields on top
 * before upserting. Fields not present in the CSV are preserved. A blank `value` clears that field to NULL.
 */
import type { Pool } from "pg";
import {
  type AllowedFlowTypeRow,
  type BrandConstraintsRow,
  type PlatformConstraintsRow,
  type ProductProfileRow,
  type ReferencePostRow,
  type StrategyDefaultsRow,
  getBrandConstraints,
  getProductProfile,
  getStrategyDefaults,
  listAllowedFlowTypes,
  listPlatformConstraints,
  listReferencePosts,
  upsertAllowedFlowType,
  upsertBrandConstraints,
  upsertHeygenConfig,
  upsertPlatformConstraints,
  upsertProductProfile,
  upsertReferencePost,
  upsertRiskRule,
  upsertStrategyDefaults,
} from "../repositories/project-config.js";
import {
  ensureProject,
  getProjectBySlug,
  updateProjectBySlug,
} from "../repositories/core.js";
import {
  getProjectIntegration,
  upsertProjectIntegration,
} from "../repositories/project-integrations.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ProjectCsvImportOptions {
  /** Overrides / supplies the project slug when the CSV does not. Also wins if CSV slug differs. */
  slug_override?: string | null;
  /** Default display name used when creating a new project and the CSV did not provide one. */
  default_display_name?: string | null;
  /** Parse + validate only; do not write to the database. */
  dry_run?: boolean;
}

export interface ProjectCsvImportResult {
  ok: boolean;
  dry_run: boolean;
  project: { id: string; slug: string; display_name: string | null } | null;
  /** Per-section count of rows effectively applied (or that would be applied, in dry-run). */
  applied: Record<string, number>;
  warnings: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------

type FieldType = "string" | "bool" | "int" | "number" | "json";

/** Canonical section name → aliases accepted in the CSV `section` column. */
const SECTION_ALIASES: Record<string, string> = {
  project: "project",
  projects: "project",
  strategy: "strategy",
  strategy_defaults: "strategy",
  brand: "brand",
  brand_constraints: "brand",
  product: "product",
  product_profile: "product",
  platform: "platform",
  platforms: "platform",
  platform_constraints: "platform",
  flow_type: "flow_type",
  flow_types: "flow_type",
  allowed_flow_types: "flow_type",
  risk_rule: "risk_rule",
  risk_rules: "risk_rule",
  reference_post: "reference_post",
  reference_posts: "reference_post",
  heygen_defaults: "heygen_defaults",
  heygen: "heygen_defaults",
  integration: "integration",
  integrations: "integration",
};

const PROJECT_FIELDS: Record<string, FieldType> = {
  slug: "string",
  display_name: "string",
  color: "string",
  active: "bool",
};

const STRATEGY_FIELDS: Record<string, FieldType> = {
  project_type: "string",
  core_offer: "string",
  target_audience: "string",
  audience_problem: "string",
  transformation_promise: "string",
  positioning_statement: "string",
  primary_business_goal: "string",
  primary_content_goal: "string",
  north_star_metric: "string",
  monetization_model: "string",
  traffic_destination: "string",
  funnel_stage_focus: "string",
  brand_archetype: "string",
  strategic_content_pillars: "string",
  authority_angle: "string",
  differentiation_angle: "string",
  growth_strategy: "string",
  publishing_intensity: "string",
  time_horizon: "string",
  owner: "string",
  notes: "string",
  instagram_handle: "string",
};

const BRAND_FIELDS: Record<string, FieldType> = {
  tone: "string",
  voice_style: "string",
  audience_level: "string",
  emotional_intensity: "number",
  humor_level: "number",
  emoji_policy: "string",
  max_emojis_per_caption: "int",
  banned_claims: "string",
  banned_words: "string",
  mandatory_disclaimers: "string",
  cta_style_rules: "string",
  storytelling_style: "string",
  positioning_statement: "string",
  differentiation_angle: "string",
  risk_level_default: "string",
  manual_review_required: "bool",
  notes: "string",
};

const PRODUCT_FIELDS: Record<string, FieldType> = {
  product_name: "string",
  product_category: "string",
  product_url: "string",
  one_liner: "string",
  value_proposition: "string",
  elevator_pitch: "string",
  primary_audience: "string",
  audience_pain_points: "string",
  audience_desires: "string",
  use_cases: "string",
  anti_audience: "string",
  key_features: "string",
  key_benefits: "string",
  differentiators: "string",
  proof_points: "string",
  social_proof: "string",
  competitors: "string",
  comparison_angles: "string",
  pricing_summary: "string",
  current_offer: "string",
  offer_urgency: "string",
  guarantee: "string",
  primary_cta: "string",
  secondary_cta: "string",
  do_say: "string",
  dont_say: "string",
  taglines: "string",
  keywords: "string",
  metadata_json: "json",
};

const PLATFORM_FIELDS: Record<string, FieldType> = {
  caption_max_chars: "int",
  hook_must_fit_first_lines: "bool",
  hook_max_chars: "int",
  slide_min_chars: "int",
  slide_max_chars: "int",
  slide_min: "int",
  slide_max: "int",
  max_hashtags: "int",
  hashtag_format_rule: "string",
  line_break_policy: "string",
  emoji_allowed: "bool",
  link_allowed: "bool",
  tag_allowed: "bool",
  formatting_rules: "string",
  posting_frequency_limit: "string",
  best_posting_window: "string",
  notes: "string",
};

const FLOW_TYPE_FIELDS: Record<string, FieldType> = {
  enabled: "bool",
  default_variation_count: "int",
  requires_signal_pack: "bool",
  requires_learning_context: "bool",
  allowed_platforms: "string",
  output_schema_version: "string",
  qc_checklist_version: "string",
  prompt_template_id: "string",
  priority_weight: "number",
  notes: "string",
  heygen_mode: "string",
};

const RISK_RULE_FIELDS: Record<string, FieldType> = {
  trigger_condition: "string",
  risk_level: "string",
  auto_approve_allowed: "bool",
  requires_manual_review: "bool",
  escalation_level: "string",
  sensitive_topics: "string",
  claim_restrictions: "string",
  rejection_reason_tag: "string",
  rollback_flag: "bool",
  notes: "string",
};

const REFERENCE_POST_FIELDS: Record<string, FieldType> = {
  platform: "string",
  post_url: "string",
  status: "string",
  last_run_id: "string",
  notes: "string",
};

const HEYGEN_DEFAULTS_FIELDS: Record<string, FieldType> = {
  voice_id: "string",
  avatar_id: "string",
  avatar_pool_json: "string",
};

const INTEGRATION_FIELDS: Record<string, FieldType> = {
  display_name: "string",
  is_enabled: "bool",
  account_ids_json: "json",
  credentials_json: "json",
  config_json: "json",
};

// ---------------------------------------------------------------------------
// CSV parser (RFC 4180-ish, supports quoted fields and embedded newlines/commas)
// ---------------------------------------------------------------------------

/** Parse a CSV string into a 2D array. Strips a trailing blank line if present. */
export function parseCsv(input: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let sawAnyCellInRow = false;

  const pushCell = () => {
    row.push(cell);
    cell = "";
    sawAnyCellInRow = true;
  };
  const pushRow = () => {
    if (sawAnyCellInRow) {
      // Drop purely-empty lines (single empty cell with no content).
      const nonEmpty = row.some((c) => c.length > 0);
      if (nonEmpty) out.push(row);
    }
    row = [];
    sawAnyCellInRow = false;
  };

  const s = input.replace(/^\uFEFF/, ""); // strip BOM
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushCell();
    } else if (ch === "\n") {
      pushCell();
      pushRow();
    } else if (ch === "\r") {
      // swallow (paired with \n or a lone Mac-style terminator)
      if (s[i + 1] !== "\n") {
        pushCell();
        pushRow();
      }
    } else {
      cell += ch;
      sawAnyCellInRow = true;
    }
  }
  if (sawAnyCellInRow || cell.length > 0) {
    pushCell();
    pushRow();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Value coercion
// ---------------------------------------------------------------------------

interface CoerceResult {
  ok: boolean;
  value: unknown;
  error?: string;
}

function coerceValue(raw: string, type: FieldType): CoerceResult {
  const trimmed = raw.trim();
  // Blank → explicit null (matches how the PUT routes coerce missing fields).
  if (trimmed === "") {
    if (type === "json") return { ok: true, value: {} };
    return { ok: true, value: null };
  }
  switch (type) {
    case "string":
      return { ok: true, value: trimmed };
    case "bool": {
      const lower = trimmed.toLowerCase();
      if (["true", "t", "1", "yes", "y"].includes(lower)) return { ok: true, value: true };
      if (["false", "f", "0", "no", "n"].includes(lower)) return { ok: true, value: false };
      return { ok: false, value: null, error: `not a boolean: "${raw}"` };
    }
    case "int": {
      const n = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(n)) return { ok: false, value: null, error: `not an integer: "${raw}"` };
      return { ok: true, value: n };
    }
    case "number": {
      const n = Number.parseFloat(trimmed);
      if (!Number.isFinite(n)) return { ok: false, value: null, error: `not a number: "${raw}"` };
      return { ok: true, value: n };
    }
    case "json": {
      try {
        return { ok: true, value: JSON.parse(trimmed) };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, value: null, error: `invalid JSON (${msg})` };
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

interface ParsedCsv {
  /** section → rowKey → field → coerced value */
  data: Map<string, Map<string, Map<string, unknown>>>;
  errors: string[];
  warnings: string[];
}

function fieldsFor(section: string): Record<string, FieldType> | null {
  switch (section) {
    case "project": return PROJECT_FIELDS;
    case "strategy": return STRATEGY_FIELDS;
    case "brand": return BRAND_FIELDS;
    case "product": return PRODUCT_FIELDS;
    case "platform": return PLATFORM_FIELDS;
    case "flow_type": return FLOW_TYPE_FIELDS;
    case "risk_rule": return RISK_RULE_FIELDS;
    case "reference_post": return REFERENCE_POST_FIELDS;
    case "heygen_defaults": return HEYGEN_DEFAULTS_FIELDS;
    case "integration": return INTEGRATION_FIELDS;
    default: return null;
  }
}

function isMultiRowSection(section: string): boolean {
  return section === "platform"
    || section === "flow_type"
    || section === "risk_rule"
    || section === "reference_post"
    || section === "integration";
}

function parseAndGroup(csv: string): ParsedCsv {
  const errors: string[] = [];
  const warnings: string[] = [];
  const data = new Map<string, Map<string, Map<string, unknown>>>();

  const rows = parseCsv(csv);
  if (rows.length === 0) {
    errors.push("CSV is empty");
    return { data, errors, warnings };
  }

  const header = rows[0]!.map((c) => c.trim().toLowerCase());
  const expected = ["section", "row_key", "field", "value"];
  const missing = expected.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    errors.push(`CSV header is missing required columns: ${missing.join(", ")} (got: ${header.join(",")})`);
    return { data, errors, warnings };
  }
  const idxSection = header.indexOf("section");
  const idxRowKey = header.indexOf("row_key");
  const idxField = header.indexOf("field");
  const idxValue = header.indexOf("value");

  for (let i = 1; i < rows.length; i++) {
    const line = rows[i]!;
    // Access with bounds safety since CSVs may have trailing blank cells.
    const sectionRaw = (line[idxSection] ?? "").trim().toLowerCase();
    const rowKeyRaw = (line[idxRowKey] ?? "").trim();
    const fieldRaw = (line[idxField] ?? "").trim();
    const valueRaw = line[idxValue] ?? "";

    // Skip fully-empty rows (defensive; parseCsv already drops those).
    if (!sectionRaw && !rowKeyRaw && !fieldRaw && !valueRaw.trim()) continue;

    const canonical = SECTION_ALIASES[sectionRaw];
    if (!canonical) {
      errors.push(`line ${i + 1}: unknown section "${sectionRaw}"`);
      continue;
    }
    const spec = fieldsFor(canonical);
    if (!spec) {
      errors.push(`line ${i + 1}: no field spec for section "${canonical}"`);
      continue;
    }
    if (!fieldRaw) {
      errors.push(`line ${i + 1}: missing field name (section=${canonical})`);
      continue;
    }
    const fieldKey = fieldRaw.toLowerCase();
    const type = spec[fieldKey];
    if (!type) {
      errors.push(`line ${i + 1}: unknown field "${fieldRaw}" for section "${canonical}"`);
      continue;
    }

    const multi = isMultiRowSection(canonical);
    if (multi && !rowKeyRaw) {
      errors.push(`line ${i + 1}: section "${canonical}" requires a non-empty row_key`);
      continue;
    }
    if (!multi && rowKeyRaw) {
      warnings.push(`line ${i + 1}: section "${canonical}" is singleton; row_key "${rowKeyRaw}" ignored`);
    }

    const coerced = coerceValue(valueRaw, type);
    if (!coerced.ok) {
      errors.push(`line ${i + 1}: field "${fieldRaw}" ${coerced.error}`);
      continue;
    }

    const rowKey = multi ? rowKeyRaw : "_";
    let perSection = data.get(canonical);
    if (!perSection) {
      perSection = new Map();
      data.set(canonical, perSection);
    }
    let fieldMap = perSection.get(rowKey);
    if (!fieldMap) {
      fieldMap = new Map();
      perSection.set(rowKey, fieldMap);
    }
    fieldMap.set(fieldKey, coerced.value);
  }

  return { data, errors, warnings };
}

// ---------------------------------------------------------------------------
// HeyGen defaults helper (mirrors PUT /v1/projects/:slug/heygen-defaults)
// ---------------------------------------------------------------------------

function normalizeAvatarPoolJson(raw: string): { normalized: string; count: number } {
  const t = raw.trim();
  if (!t) return { normalized: "[]", count: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    throw new Error("avatar_pool_json must be valid JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("avatar_pool_json must be a JSON array");
  const out: Array<{ avatar_id: string; voice_id?: string }> = [];
  for (const x of parsed) {
    if (!x || typeof x !== "object" || Array.isArray(x)) continue;
    const o = x as Record<string, unknown>;
    const aid = String(o.avatar_id ?? o.avatarId ?? "").trim();
    const vid = String(o.voice_id ?? o.voiceId ?? "").trim();
    if (!aid) continue;
    out.push(vid ? { avatar_id: aid, voice_id: vid } : { avatar_id: aid });
  }
  return { normalized: JSON.stringify(out), count: out.length };
}

async function applyHeygenDefaults(
  db: Pool,
  projectId: string,
  fields: Map<string, unknown>
): Promise<void> {
  const voiceId = typeof fields.get("voice_id") === "string" ? (fields.get("voice_id") as string).trim() : "";
  const avatarId = typeof fields.get("avatar_id") === "string" ? (fields.get("avatar_id") as string).trim() : "";
  const avatarPoolRaw =
    typeof fields.get("avatar_pool_json") === "string" ? (fields.get("avatar_pool_json") as string).trim() : "";

  let avatarPoolNormalized: string | null = null;
  if (avatarPoolRaw) {
    const parsed = normalizeAvatarPoolJson(avatarPoolRaw);
    if (parsed.count === 0) {
      throw new Error("heygen_defaults.avatar_pool_json parsed but contained no valid avatar_id entries");
    }
    avatarPoolNormalized = parsed.normalized;
  }

  if (voiceId) {
    await upsertHeygenConfig(db, projectId, {
      config_id: "defaults_voice",
      platform: null,
      flow_type: null,
      config_key: "voice",
      value: voiceId,
      render_mode: null,
      value_type: "string",
      is_active: true,
      notes: "Project-level default voice (managed by CSV import)",
    });
  }

  if (avatarPoolNormalized) {
    await upsertHeygenConfig(db, projectId, {
      config_id: "defaults_avatar_pool",
      platform: null,
      flow_type: null,
      config_key: "avatar_pool_json",
      value: avatarPoolNormalized,
      render_mode: null,
      value_type: "string",
      is_active: true,
      notes: "Project-level default avatar pool (managed by CSV import)",
    });
    await upsertHeygenConfig(db, projectId, {
      config_id: "defaults_avatar_id",
      platform: null,
      flow_type: null,
      config_key: "avatar_id",
      value: null,
      render_mode: null,
      value_type: "string",
      is_active: false,
      notes: "Disabled because defaults_avatar_pool is active",
    });
  } else if (avatarId) {
    await upsertHeygenConfig(db, projectId, {
      config_id: "defaults_avatar_id",
      platform: null,
      flow_type: null,
      config_key: "avatar_id",
      value: avatarId,
      render_mode: null,
      value_type: "string",
      is_active: true,
      notes: "Project-level default avatar id (managed by CSV import)",
    });
    await upsertHeygenConfig(db, projectId, {
      config_id: "defaults_avatar_pool",
      platform: null,
      flow_type: null,
      config_key: "avatar_pool_json",
      value: null,
      render_mode: null,
      value_type: "string",
      is_active: false,
      notes: "Disabled because defaults_avatar_id is active",
    });
  }
}

// ---------------------------------------------------------------------------
// Merge helpers (existing row ⊕ CSV overrides → upsert payload)
// ---------------------------------------------------------------------------

function pick<T extends object>(obj: T | null, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!obj) {
    for (const k of keys) out[k] = null;
    return out;
  }
  const src = obj as Record<string, unknown>;
  for (const k of keys) out[k] = src[k] ?? null;
  return out;
}

function merge<T extends Record<string, unknown>>(base: T, overrides: Map<string, unknown>): T {
  const out = { ...base };
  for (const [k, v] of overrides.entries()) {
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function importProjectFromCsv(
  db: Pool,
  csvText: string,
  opts: ProjectCsvImportOptions = {}
): Promise<ProjectCsvImportResult> {
  const result: ProjectCsvImportResult = {
    ok: false,
    dry_run: Boolean(opts.dry_run),
    project: null,
    applied: {},
    warnings: [],
    errors: [],
  };

  const parsed = parseAndGroup(csvText);
  result.warnings.push(...parsed.warnings);
  result.errors.push(...parsed.errors);
  if (result.errors.length > 0) return result;

  // Resolve slug
  const projectSingleton = parsed.data.get("project")?.get("_") ?? null;
  const csvSlugRaw = projectSingleton?.get("slug");
  const csvSlug = typeof csvSlugRaw === "string" ? csvSlugRaw.trim() : "";
  const overrideSlug = (opts.slug_override ?? "").trim();
  const slug = overrideSlug || csvSlug;
  if (!slug) {
    result.errors.push("project slug missing — set `project,,slug,YOURSLUG` in the CSV or pass a slug override");
    return result;
  }
  if (overrideSlug && csvSlug && overrideSlug !== csvSlug) {
    result.warnings.push(
      `slug_override "${overrideSlug}" does not match CSV slug "${csvSlug}"; using "${overrideSlug}"`
    );
  }

  const csvDisplayNameRaw = projectSingleton?.get("display_name");
  const csvDisplayName = typeof csvDisplayNameRaw === "string" ? csvDisplayNameRaw : undefined;
  const initialDisplayName = csvDisplayName ?? opts.default_display_name ?? undefined;

  if (result.dry_run) {
    // Plan only — don't ensureProject (which would create the row).
    const existing = await getProjectBySlug(db, slug);
    result.project = existing
      ? { id: existing.id, slug: existing.slug, display_name: existing.display_name }
      : { id: "(pending)", slug, display_name: initialDisplayName ?? null };
    result.applied = summarizePlan(parsed.data);
    result.ok = true;
    return result;
  }

  // Create / fetch the project (ensureProject also runs ensureDefaultProjectProfileData).
  const project = await ensureProject(db, slug, initialDisplayName);

  // Apply project metadata (display_name, color, active) if provided.
  if (projectSingleton) {
    const patch: { display_name?: string | null; active?: boolean; color?: string | null } = {};
    let patchUsed = false;
    if (projectSingleton.has("display_name")) {
      patch.display_name = (projectSingleton.get("display_name") as string | null) ?? null;
      patchUsed = true;
    }
    if (projectSingleton.has("color")) {
      patch.color = (projectSingleton.get("color") as string | null) ?? null;
      patchUsed = true;
    }
    if (projectSingleton.has("active")) {
      patch.active = Boolean(projectSingleton.get("active"));
      patchUsed = true;
    }
    if (patchUsed) {
      await updateProjectBySlug(db, slug, patch);
      result.applied.project = 1;
    }
  }

  // Strategy
  const strategy = parsed.data.get("strategy")?.get("_");
  if (strategy && strategy.size > 0) {
    const existing = await getStrategyDefaults(db, project.id);
    const base = pick<StrategyDefaultsRow>(existing, Object.keys(STRATEGY_FIELDS)) as Omit<
      StrategyDefaultsRow,
      "id" | "project_id"
    >;
    const merged = merge(base as unknown as Record<string, unknown>, strategy) as unknown as Omit<
      StrategyDefaultsRow,
      "id" | "project_id"
    >;
    await upsertStrategyDefaults(db, project.id, merged);
    result.applied.strategy = 1;
  }

  // Brand
  const brand = parsed.data.get("brand")?.get("_");
  if (brand && brand.size > 0) {
    const existing = await getBrandConstraints(db, project.id);
    const base = pick<BrandConstraintsRow>(existing, Object.keys(BRAND_FIELDS)) as Omit<
      BrandConstraintsRow,
      "id" | "project_id"
    >;
    const merged = merge(base as unknown as Record<string, unknown>, brand) as Omit<
      BrandConstraintsRow,
      "id" | "project_id"
    >;
    // manual_review_required is NOT NULL in the table; default to true if null.
    if (typeof merged.manual_review_required !== "boolean") {
      merged.manual_review_required = true;
    }
    await upsertBrandConstraints(db, project.id, merged);
    result.applied.brand = 1;
  }

  // Product
  const product = parsed.data.get("product")?.get("_");
  if (product && product.size > 0) {
    const existing = await getProductProfile(db, project.id);
    const baseObj: Record<string, unknown> = {};
    for (const k of Object.keys(PRODUCT_FIELDS)) {
      baseObj[k] = existing ? ((existing as unknown as Record<string, unknown>)[k] ?? null) : null;
    }
    const merged = merge(baseObj, product);
    const metadata =
      merged.metadata_json && typeof merged.metadata_json === "object" && !Array.isArray(merged.metadata_json)
        ? (merged.metadata_json as Record<string, unknown>)
        : {};
    await upsertProductProfile(db, project.id, {
      ...(merged as Partial<Omit<ProductProfileRow, "id" | "project_id">>),
      metadata_json: metadata,
    });
    result.applied.product = 1;
  }

  // Platforms
  const platforms = parsed.data.get("platform");
  if (platforms && platforms.size > 0) {
    const existingList = await listPlatformConstraints(db, project.id);
    const byPlatform = new Map<string, PlatformConstraintsRow>(
      existingList.map((r) => [r.platform.toLowerCase(), r])
    );
    let n = 0;
    for (const [rowKey, fields] of platforms.entries()) {
      const existing = byPlatform.get(rowKey.toLowerCase()) ?? null;
      const base = pick<PlatformConstraintsRow>(existing, Object.keys(PLATFORM_FIELDS)) as Omit<
        PlatformConstraintsRow,
        "id" | "project_id" | "platform"
      >;
      const merged = merge(base as unknown as Record<string, unknown>, fields) as Omit<
        PlatformConstraintsRow,
        "id" | "project_id" | "platform"
      >;
      // Apply NOT NULL-ish defaults to booleans that the repo treats as booleans.
      const payload: Omit<PlatformConstraintsRow, "id" | "project_id"> = {
        platform: rowKey,
        caption_max_chars: merged.caption_max_chars ?? null,
        hook_must_fit_first_lines: typeof merged.hook_must_fit_first_lines === "boolean"
          ? merged.hook_must_fit_first_lines
          : true,
        hook_max_chars: merged.hook_max_chars ?? null,
        slide_min_chars: merged.slide_min_chars ?? null,
        slide_max_chars: merged.slide_max_chars ?? null,
        slide_min: merged.slide_min ?? null,
        slide_max: merged.slide_max ?? null,
        max_hashtags: merged.max_hashtags ?? null,
        hashtag_format_rule: merged.hashtag_format_rule ?? null,
        line_break_policy: merged.line_break_policy ?? null,
        emoji_allowed: typeof merged.emoji_allowed === "boolean" ? merged.emoji_allowed : true,
        link_allowed: typeof merged.link_allowed === "boolean" ? merged.link_allowed : false,
        tag_allowed: typeof merged.tag_allowed === "boolean" ? merged.tag_allowed : true,
        formatting_rules: merged.formatting_rules ?? null,
        posting_frequency_limit: merged.posting_frequency_limit ?? null,
        best_posting_window: merged.best_posting_window ?? null,
        notes: merged.notes ?? null,
      };
      await upsertPlatformConstraints(db, project.id, payload);
      n++;
    }
    result.applied.platform = n;
  }

  // Flow types
  const flows = parsed.data.get("flow_type");
  if (flows && flows.size > 0) {
    const existingList = await listAllowedFlowTypes(db, project.id);
    const byFlow = new Map<string, AllowedFlowTypeRow>(existingList.map((r) => [r.flow_type, r]));
    let n = 0;
    for (const [rowKey, fields] of flows.entries()) {
      const existing = byFlow.get(rowKey) ?? null;
      const base = pick<AllowedFlowTypeRow>(existing, Object.keys(FLOW_TYPE_FIELDS));
      const merged = merge(base, fields);
      const payload: Omit<AllowedFlowTypeRow, "id" | "project_id"> = {
        flow_type: rowKey,
        enabled: typeof merged.enabled === "boolean" ? merged.enabled : true,
        default_variation_count:
          typeof merged.default_variation_count === "number" ? merged.default_variation_count : 1,
        requires_signal_pack: typeof merged.requires_signal_pack === "boolean" ? merged.requires_signal_pack : true,
        requires_learning_context:
          typeof merged.requires_learning_context === "boolean" ? merged.requires_learning_context : true,
        allowed_platforms: (merged.allowed_platforms as string | null | undefined) ?? null,
        output_schema_version: (merged.output_schema_version as string | null | undefined) ?? null,
        qc_checklist_version: (merged.qc_checklist_version as string | null | undefined) ?? null,
        prompt_template_id: (merged.prompt_template_id as string | null | undefined) ?? null,
        priority_weight: (merged.priority_weight as number | null | undefined) ?? null,
        notes: (merged.notes as string | null | undefined) ?? null,
        heygen_mode: (() => {
          const v = typeof merged.heygen_mode === "string" ? merged.heygen_mode.trim().toLowerCase() : "";
          return v === "script_led" || v === "prompt_led" ? (v as "script_led" | "prompt_led") : null;
        })(),
      };
      await upsertAllowedFlowType(db, project.id, payload);
      n++;
    }
    result.applied.flow_type = n;
  }

  // Risk rules — replace-per-flow semantics (table has no (project_id, flow_type) unique constraint).
  const risk = parsed.data.get("risk_rule");
  if (risk && risk.size > 0) {
    let n = 0;
    for (const [rowKey, fields] of risk.entries()) {
      await db.query(
        `DELETE FROM caf_core.risk_rules WHERE project_id = $1 AND flow_type = $2`,
        [project.id, rowKey]
      );
      await upsertRiskRule(db, project.id, {
        flow_type: rowKey,
        trigger_condition: (fields.get("trigger_condition") as string | null | undefined) ?? null,
        risk_level: (fields.get("risk_level") as string | null | undefined) ?? null,
        auto_approve_allowed:
          typeof fields.get("auto_approve_allowed") === "boolean"
            ? (fields.get("auto_approve_allowed") as boolean)
            : false,
        requires_manual_review:
          typeof fields.get("requires_manual_review") === "boolean"
            ? (fields.get("requires_manual_review") as boolean)
            : true,
        escalation_level: (fields.get("escalation_level") as string | null | undefined) ?? null,
        sensitive_topics: (fields.get("sensitive_topics") as string | null | undefined) ?? null,
        claim_restrictions: (fields.get("claim_restrictions") as string | null | undefined) ?? null,
        rejection_reason_tag: (fields.get("rejection_reason_tag") as string | null | undefined) ?? null,
        rollback_flag:
          typeof fields.get("rollback_flag") === "boolean" ? (fields.get("rollback_flag") as boolean) : false,
        notes: (fields.get("notes") as string | null | undefined) ?? null,
      });
      n++;
    }
    result.applied.risk_rule = n;
    if (n > 0 && !opts.dry_run) {
      // Operators frequently expect `risk_rules` to gate QC. They do not —
      // see `docs/RISK_RULES.md`. Surface that here so an import warning is
      // visible in the CSV flow, not only on the API response.
      result.warnings.push(
        `${n} risk_rule row(s) were imported, but these are NOT applied by the QC runtime. QC only enforces risk_policies + brand banned_words. See docs/RISK_RULES.md and GET /v1/projects/:slug/risk-qc-status.`
      );
    }
  }

  // Reference posts
  const refs = parsed.data.get("reference_post");
  if (refs && refs.size > 0) {
    const existingList = await listReferencePosts(db, project.id);
    const byRef = new Map<string, ReferencePostRow>(existingList.map((r) => [r.reference_post_id, r]));
    let n = 0;
    for (const [rowKey, fields] of refs.entries()) {
      const existing = byRef.get(rowKey) ?? null;
      const base = pick<ReferencePostRow>(existing, Object.keys(REFERENCE_POST_FIELDS));
      const merged = merge(base, fields);
      await upsertReferencePost(db, project.id, {
        reference_post_id: rowKey,
        platform: (merged.platform as string | null | undefined) ?? null,
        post_url: (merged.post_url as string | null | undefined) ?? null,
        status: typeof merged.status === "string" && merged.status ? (merged.status as string) : "pending",
        last_run_id: (merged.last_run_id as string | null | undefined) ?? null,
        notes: (merged.notes as string | null | undefined) ?? null,
      });
      n++;
    }
    result.applied.reference_post = n;
  }

  // HeyGen defaults
  const heygen = parsed.data.get("heygen_defaults")?.get("_");
  if (heygen && heygen.size > 0) {
    try {
      await applyHeygenDefaults(db, project.id, heygen);
      result.applied.heygen_defaults = 1;
    } catch (e) {
      result.errors.push(`heygen_defaults: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Integrations
  const integrations = parsed.data.get("integration");
  if (integrations && integrations.size > 0) {
    let n = 0;
    for (const [rowKey, fields] of integrations.entries()) {
      const existing = await getProjectIntegration(db, project.id, rowKey);
      const displayName = fields.has("display_name")
        ? ((fields.get("display_name") as string | null) ?? null)
        : (existing?.display_name ?? null);
      const isEnabled = fields.has("is_enabled")
        ? Boolean(fields.get("is_enabled"))
        : (existing?.is_enabled ?? true);
      const account = fields.has("account_ids_json")
        ? ((fields.get("account_ids_json") as Record<string, unknown>) ?? {})
        : (existing?.account_ids_json ?? {});
      const creds = fields.has("credentials_json")
        ? ((fields.get("credentials_json") as Record<string, unknown>) ?? {})
        : (existing?.credentials_json ?? {});
      const config = fields.has("config_json")
        ? ((fields.get("config_json") as Record<string, unknown>) ?? {})
        : (existing?.config_json ?? {});
      await upsertProjectIntegration(db, {
        project_id: project.id,
        platform: rowKey,
        display_name: displayName,
        is_enabled: isEnabled,
        account_ids_json: account,
        credentials_json: creds,
        config_json: config,
      });
      n++;
    }
    result.applied.integration = n;
  }

  result.project = { id: project.id, slug: project.slug, display_name: project.display_name };
  result.ok = result.errors.length === 0;
  return result;
}

function summarizePlan(
  data: Map<string, Map<string, Map<string, unknown>>>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [section, perKey] of data.entries()) {
    if (section === "project") {
      // Count as 1 if any non-slug field is present.
      const singleton = perKey.get("_");
      const hasMetadata = singleton && Array.from(singleton.keys()).some((k) => k !== "slug");
      out.project = hasMetadata ? 1 : 0;
      continue;
    }
    if (isMultiRowSection(section)) {
      out[section] = perKey.size;
    } else {
      const singleton = perKey.get("_");
      out[section] = singleton && singleton.size > 0 ? 1 : 0;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sample CSV template
// ---------------------------------------------------------------------------

export const PROJECT_IMPORT_CSV_TEMPLATE = `section,row_key,field,value
project,,slug,ACME
project,,display_name,Acme Demo
project,,color,#1a73e8
project,,active,true
strategy,,project_type,Consulting
strategy,,core_offer,AI-assisted advisory
strategy,,target_audience,B2B founders
strategy,,primary_content_goal,authority
brand,,tone,authoritative
brand,,voice_style,direct
brand,,emoji_policy,minimal
brand,,max_emojis_per_caption,2
brand,,manual_review_required,true
product,,product_name,Acme Assistant
product,,one_liner,Your always-on research analyst
product,,value_proposition,Cut research time 90%
product,,primary_cta,Start free trial
platform,Instagram,caption_max_chars,2200
platform,Instagram,slide_min,5
platform,Instagram,slide_max,10
platform,Instagram,max_hashtags,8
platform,TikTok,caption_max_chars,2200
platform,TikTok,max_hashtags,5
flow_type,Flow_Carousel_Copy,enabled,true
flow_type,Flow_Carousel_Copy,default_variation_count,1
flow_type,Video_Script_Generator,enabled,true
flow_type,Video_Script_Generator,default_variation_count,1
risk_rule,Flow_Carousel_Copy,risk_level,medium
risk_rule,Flow_Carousel_Copy,requires_manual_review,true
risk_rule,Flow_Carousel_Copy,trigger_condition,Claims touching finance or health
reference_post,ref_001,platform,Instagram
reference_post,ref_001,post_url,https://instagram.com/p/xxxx
reference_post,ref_001,status,pending
heygen_defaults,,voice_id,
heygen_defaults,,avatar_pool_json,"[]"
integration,META_IG,display_name,Acme IG
integration,META_IG,is_enabled,true
integration,META_IG,account_ids_json,"{""ig_business_account_id"":""...""}"
integration,META_IG,credentials_json,"{""access_token"":""...""}"
`;
