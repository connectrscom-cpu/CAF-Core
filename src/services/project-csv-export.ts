/**
 * Export a project's full configuration as a CSV in the
 * `section,row_key,field,value` shape expected by
 * `POST /v1/projects/import-csv`.
 *
 * Designed as the inverse of {@link ./project-csv-import.ts}. The output is
 * intentionally round-trip-safe for every section the importer understands —
 * with two caveats:
 *
 *   1. Integration `account_ids_json` and `credentials_json` are per-account
 *      secrets and MUST NOT leak across projects. They are emitted as JSON
 *      objects whose values are replaced with `REPLACE_ME` placeholders.
 *      Pass `include_secrets: true` to opt out (server-only, never exposed
 *      via the public admin UI).
 *
 *   2. `caf_core.risk_rules` has no unique `(project_id, flow_type)` index,
 *      so a flow can have multiple rules (e.g. SNS has two for
 *      `Flow_Carousel_Copy`). The CSV importer does delete-then-insert per
 *      flow, so a single CSV can carry only one rule per flow. By default
 *      we pick the highest-severity rule and add a warning to the export
 *      metadata. Set `collapse_risk_rules: "keep_all"` to emit every rule
 *      (the importer will keep the LAST one after replace — use only for
 *      human inspection).
 */
import type { Pool } from "pg";
import {
  type AllowedFlowTypeRow,
  type BrandConstraintsRow,
  type HeygenConfigRow,
  type PlatformConstraintsRow,
  type ProductProfileRow,
  type ReferencePostRow,
  type RiskRuleRow,
  type StrategyDefaultsRow,
  getBrandConstraints,
  getProductProfile,
  getStrategyDefaults,
  listAllowedFlowTypes,
  listHeygenConfig,
  listPlatformConstraints,
  listReferencePosts,
  listRiskRules,
} from "../repositories/project-config.js";
import { getProjectBySlug, type ProjectRow } from "../repositories/core.js";
import {
  listProjectIntegrations,
  type ProjectIntegrationRow,
} from "../repositories/project-integrations.js";

// Field orderings must match project-csv-import.ts so a round-trip import of
// a freshly exported CSV produces an identical project.
const STRATEGY_FIELDS = [
  "project_type", "core_offer", "target_audience", "audience_problem",
  "transformation_promise", "positioning_statement", "primary_business_goal",
  "primary_content_goal", "north_star_metric", "monetization_model",
  "traffic_destination", "funnel_stage_focus", "brand_archetype",
  "strategic_content_pillars", "authority_angle", "differentiation_angle",
  "growth_strategy", "publishing_intensity", "time_horizon", "owner",
  "notes", "instagram_handle",
] as const;

const BRAND_FIELDS = [
  "tone", "voice_style", "audience_level", "emotional_intensity",
  "humor_level", "emoji_policy", "max_emojis_per_caption",
  "banned_claims", "banned_words", "mandatory_disclaimers",
  "cta_style_rules", "storytelling_style", "positioning_statement",
  "differentiation_angle", "risk_level_default", "manual_review_required",
  "notes",
] as const;

const PRODUCT_FIELDS = [
  "product_name", "product_category", "product_url", "one_liner",
  "value_proposition", "elevator_pitch", "primary_audience",
  "audience_pain_points", "audience_desires", "use_cases", "anti_audience",
  "key_features", "key_benefits", "differentiators", "proof_points",
  "social_proof", "competitors", "comparison_angles", "pricing_summary",
  "current_offer", "offer_urgency", "guarantee", "primary_cta",
  "secondary_cta", "do_say", "dont_say", "taglines", "keywords",
  "metadata_json",
] as const;

const PLATFORM_FIELDS = [
  "caption_max_chars", "hook_must_fit_first_lines", "hook_max_chars",
  "slide_min_chars", "slide_max_chars", "slide_min", "slide_max",
  "max_hashtags", "hashtag_format_rule", "line_break_policy",
  "emoji_allowed", "link_allowed", "tag_allowed", "formatting_rules",
  "posting_frequency_limit", "best_posting_window", "notes",
] as const;

const FLOW_FIELDS = [
  "enabled", "default_variation_count", "requires_signal_pack",
  "requires_learning_context", "allowed_platforms", "output_schema_version",
  "qc_checklist_version", "prompt_template_id", "priority_weight", "notes",
] as const;

const RISK_FIELDS = [
  "trigger_condition", "risk_level", "auto_approve_allowed",
  "requires_manual_review", "escalation_level", "sensitive_topics",
  "claim_restrictions", "rejection_reason_tag", "rollback_flag", "notes",
] as const;

const REFERENCE_FIELDS = [
  "platform", "post_url", "status", "last_run_id", "notes",
] as const;

const INTEGRATION_FIELDS = [
  "display_name", "is_enabled", "account_ids_json", "credentials_json", "config_json",
] as const;

// Higher index = higher severity, so sort descending.
const RISK_LEVEL_RANK: Record<string, number> = {
  CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1,
};

function riskSeverityScore(row: RiskRuleRow): number {
  const key = (row.risk_level ?? "").toUpperCase();
  return RISK_LEVEL_RANK[key] ?? 0;
}

export interface ProjectCsvExportOptions {
  /** Overwrites `project.slug` in the output (so the CSV re-imports as a new project). */
  new_slug?: string | null;
  /** Overwrites `project.display_name`. */
  new_display_name?: string | null;
  /** Overwrites `project.color`. */
  new_color?: string | null;
  /** Overwrites `strategy.instagram_handle`. */
  new_instagram_handle?: string | null;
  /** Overwrites `strategy.traffic_destination` and `product.product_url`. */
  new_product_url?: string | null;
  /** Overwrites `product.product_name`. */
  new_product_name?: string | null;
  /**
   * Secret handling for integrations. Defaults to `"placeholder"` which
   * replaces every key inside `account_ids_json` / `credentials_json` with
   * `"REPLACE_ME"`. Use `"include"` ONLY for server-to-server backups.
   */
  secrets?: "placeholder" | "include";
  /**
   * How to handle multiple risk rules per flow_type:
   * - `"highest_severity"` (default): emit only the most severe rule per flow.
   *   Safe to round-trip through the importer.
   * - `"keep_all"`: emit every rule with the same `row_key` (= flow_type).
   *   The importer will only keep the last one on re-import. Useful for
   *   diffs / human inspection.
   */
  collapse_risk_rules?: "highest_severity" | "keep_all";
}

export interface ProjectCsvExportResult {
  csv: string;
  /** Suggested file name (e.g. `caf-project-SNS-2026-04-20.csv`). */
  filename: string;
  rows: number;
  warnings: string[];
  /** Per-section row count (singleton rows counted as rowKeys; each field = 1 row). */
  metadata: {
    project_id: string;
    source_slug: string;
    target_slug: string;
    applied: Record<string, number>;
  };
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (typeof value === "string") s = value;
  else if (typeof value === "number" || typeof value === "boolean") s = String(value);
  else s = JSON.stringify(value);
  if (s === "") return "";
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

type CsvRow = readonly [string, string, string, unknown];

function emit(rows: CsvRow[], section: string, rowKey: string, field: string, value: unknown): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string" && value === "") return;
  rows.push([section, rowKey, field, value] as const);
}

function stripSecrets(obj: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!obj || typeof obj !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) out[k] = "REPLACE_ME";
  return out;
}

export async function exportProjectAsCsv(
  db: Pool,
  slug: string,
  options: ProjectCsvExportOptions = {}
): Promise<ProjectCsvExportResult> {
  const project: ProjectRow | null = await getProjectBySlug(db, slug);
  if (!project) {
    throw new Error(`project not found: ${slug}`);
  }
  const warnings: string[] = [];
  const rows: CsvRow[] = [];
  const applied: Record<string, number> = {};

  const targetSlug = (options.new_slug ?? project.slug).toUpperCase();
  const targetDisplayName = options.new_display_name ?? project.display_name ?? targetSlug;
  const targetColor = options.new_color ?? project.color ?? null;

  // project ------------------------------------------------------------------
  emit(rows, "project", "", "slug", targetSlug);
  emit(rows, "project", "", "display_name", targetDisplayName);
  if (targetColor) emit(rows, "project", "", "color", targetColor);
  emit(rows, "project", "", "active", project.active ? "true" : "false");
  applied.project = 1;

  // strategy -----------------------------------------------------------------
  const strategy: StrategyDefaultsRow | null = await getStrategyDefaults(db, project.id);
  if (strategy) {
    for (const field of STRATEGY_FIELDS) {
      let value = (strategy as unknown as Record<string, unknown>)[field];
      if (field === "instagram_handle" && options.new_instagram_handle) {
        value = options.new_instagram_handle;
      }
      if (field === "traffic_destination" && options.new_product_url) {
        value = options.new_product_url;
      }
      emit(rows, "strategy", "", field, value);
    }
    applied.strategy = 1;
  }

  // brand --------------------------------------------------------------------
  const brand: BrandConstraintsRow | null = await getBrandConstraints(db, project.id);
  if (brand) {
    for (const field of BRAND_FIELDS) {
      const value = (brand as unknown as Record<string, unknown>)[field];
      emit(rows, "brand", "", field, value);
    }
    applied.brand = 1;
  }

  // product ------------------------------------------------------------------
  const product: ProductProfileRow | null = await getProductProfile(db, project.id);
  if (product) {
    for (const field of PRODUCT_FIELDS) {
      let value = (product as unknown as Record<string, unknown>)[field];
      if (field === "product_name" && options.new_product_name) value = options.new_product_name;
      if (field === "product_url" && options.new_product_url) value = options.new_product_url;
      emit(rows, "product", "", field, value);
    }
    applied.product = 1;
  }

  // platform -----------------------------------------------------------------
  const platforms: PlatformConstraintsRow[] = await listPlatformConstraints(db, project.id);
  for (const row of platforms) {
    for (const field of PLATFORM_FIELDS) {
      const value = (row as unknown as Record<string, unknown>)[field];
      emit(rows, "platform", row.platform, field, value);
    }
  }
  applied.platform = platforms.length;

  // flow_type ----------------------------------------------------------------
  const flows: AllowedFlowTypeRow[] = await listAllowedFlowTypes(db, project.id);
  for (const row of flows) {
    for (const field of FLOW_FIELDS) {
      const value = (row as unknown as Record<string, unknown>)[field];
      emit(rows, "flow_type", row.flow_type, field, value);
    }
  }
  applied.flow_type = flows.length;

  // risk_rule ----------------------------------------------------------------
  const rules: RiskRuleRow[] = await listRiskRules(db, project.id);
  const byFlow = new Map<string, RiskRuleRow[]>();
  for (const r of rules) {
    const bucket = byFlow.get(r.flow_type) ?? [];
    bucket.push(r);
    byFlow.set(r.flow_type, bucket);
  }
  let riskCount = 0;
  const mode = options.collapse_risk_rules ?? "highest_severity";
  for (const [flowType, bucket] of byFlow.entries()) {
    if (bucket.length > 1 && mode === "highest_severity") {
      bucket.sort((a, b) => riskSeverityScore(b) - riskSeverityScore(a));
      const kept = bucket[0];
      warnings.push(
        `risk_rule.${flowType} had ${bucket.length} rules; exported only the highest severity (${kept.risk_level ?? "n/a"}/${kept.rejection_reason_tag ?? "no-tag"}).`
      );
      for (const field of RISK_FIELDS) {
        const value = (kept as unknown as Record<string, unknown>)[field];
        emit(rows, "risk_rule", flowType, field, value);
      }
      riskCount += 1;
    } else {
      for (const rule of bucket) {
        for (const field of RISK_FIELDS) {
          const value = (rule as unknown as Record<string, unknown>)[field];
          emit(rows, "risk_rule", flowType, field, value);
        }
        riskCount += 1;
      }
    }
  }
  applied.risk_rule = riskCount;

  // reference_post -----------------------------------------------------------
  const refs: ReferencePostRow[] = await listReferencePosts(db, project.id);
  for (const row of refs) {
    for (const field of REFERENCE_FIELDS) {
      const value = (row as unknown as Record<string, unknown>)[field];
      emit(rows, "reference_post", row.reference_post_id, field, value);
    }
  }
  applied.reference_post = refs.length;

  // heygen_defaults ----------------------------------------------------------
  // We only serialise the project-level, non-platform/flow defaults that the
  // importer knows how to restore (voice_id, avatar_id, avatar_pool_json).
  const heygenRows: HeygenConfigRow[] = await listHeygenConfig(db, project.id);
  const heygenDefaults = heygenRows.filter(
    (r) => r.platform === null && r.flow_type === null && r.render_mode === null
  );
  let heygenApplied = 0;
  for (const row of heygenDefaults) {
    if (!row.value) continue;
    if (row.config_id === "defaults_voice") {
      emit(rows, "heygen_defaults", "", "voice_id", row.value);
      heygenApplied = 1;
    } else if (row.config_id === "defaults_avatar_id" && row.is_active) {
      emit(rows, "heygen_defaults", "", "avatar_id", row.value);
      heygenApplied = 1;
    } else if (row.config_id === "defaults_avatar_pool" && row.is_active) {
      emit(rows, "heygen_defaults", "", "avatar_pool_json", row.value);
      heygenApplied = 1;
    }
  }
  if (heygenApplied) applied.heygen_defaults = heygenApplied;

  // integration --------------------------------------------------------------
  const integrations: ProjectIntegrationRow[] = await listProjectIntegrations(db, project.id);
  const secretsMode = options.secrets ?? "placeholder";
  for (const row of integrations) {
    const displayName = row.display_name && project.display_name && targetDisplayName !== project.display_name
      ? row.display_name.replace(new RegExp(project.display_name, "gi"), targetDisplayName)
      : row.display_name;
    for (const field of INTEGRATION_FIELDS) {
      let value: unknown;
      if (field === "display_name") value = displayName;
      else if (field === "is_enabled") value = row.is_enabled ? "true" : "false";
      else if (field === "account_ids_json") {
        value = JSON.stringify(secretsMode === "include" ? (row.account_ids_json ?? {}) : stripSecrets(row.account_ids_json));
      } else if (field === "credentials_json") {
        value = JSON.stringify(secretsMode === "include" ? (row.credentials_json ?? {}) : stripSecrets(row.credentials_json));
      } else if (field === "config_json") {
        value = JSON.stringify(row.config_json ?? {});
      }
      emit(rows, "integration", row.platform, field, value);
    }
  }
  applied.integration = integrations.length;
  if (integrations.length > 0 && secretsMode === "placeholder") {
    warnings.push(
      `${integrations.length} integration(s) exported with placeholder secrets. Edit the CSV before importing.`
    );
  }

  // Build CSV ----------------------------------------------------------------
  const header = "section,row_key,field,value";
  const body = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const csv = rows.length > 0 ? `${header}\n${body}\n` : `${header}\n`;

  const datePart = new Date().toISOString().slice(0, 10);
  const filename = `caf-project-${targetSlug.toLowerCase()}-${datePart}.csv`;

  return {
    csv,
    filename,
    rows: rows.length,
    warnings,
    metadata: {
      project_id: project.id,
      source_slug: project.slug,
      target_slug: targetSlug,
      applied,
    },
  };
}
