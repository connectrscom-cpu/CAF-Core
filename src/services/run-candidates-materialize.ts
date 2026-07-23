/**
 * Materialize `runs.candidates_json` from `signal_packs.ideas_json` (manual selection or LLM),
 * or copy legacy `overall_candidates_json` into the run.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import type { SignalPackRow } from "../repositories/signal-packs.js";
import { updateRunCandidatesJson } from "../repositories/runs.js";
import type { RunRow } from "../repositories/runs.js";
import { mapIdeasJsonToPlannerSourceRows, type SignalPackIdea } from "./signal-pack-compile-ideas.js";
import { normalizeOverallCandidateRows } from "./signal-pack-parser.js";
import { openaiChat } from "./openai-chat.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import { parseIdeasV2, parseIdeasV2Lenient } from "../domain/signal-pack-ideas-v2.js";
import { normalizeVideoStyle } from "../decision_engine/video-flow-routing.js";
import { applyIdeaStructureToPlannerRow } from "../domain/idea-structure.js";
import { readSignalPackIdeasUnion } from "../domain/jobs-json-compat.js";
import { listSignalPackSelectedIdeaIds } from "../repositories/signal-pack-ideas.js";
import { getBrandConstraints, getProductProfile, getStrategyDefaults } from "../repositories/project-config.js";
import { pickBrandSliceForSnapshot, pickStrategySliceForSnapshot } from "./run-context-snapshot.js";
import {
  mimicKindToFlowType,
  type MimicPickKind,
  findVisualGuidelineEntry,
  TIER_FOR_KIND,
  normalizeMimicPickRef,
} from "./signal-pack-mimic-ui.js";
import { platformFromEvidenceKind } from "./signal-pack-compile-ideas.js";
import {
  readTopPerformerVideoFormatPattern,
  resolveTopPerformerVideoHeygenRoute,
} from "../domain/top-performer-video-heygen-routing.js";
import { findVisualGuidelineEntryForGrounding } from "../domain/top-performer-grounding.js";
import { VISUAL_FIRST_CAROUSEL_PROVENANCE } from "../domain/visual-first-carousel-flow-types.js";
import { normalizeCarouselIdeaPlatform } from "./task-id.js";
import type { VideoPipelineIntent } from "../decision_engine/video-flow-routing.js";
import { z } from "zod";

const videoPipelineIntentSchema = z.enum(["script_avatar", "prompt_avatar", "no_avatar"]);

export type RunCandidatesMimicPick = {
  insights_id: string;
  mimic_kind: MimicPickKind;
  /** Operator HeyGen lane override for video top performers (content cart). */
  video_intent?: VideoPipelineIntent;
  /** Optional cart-assigned HeyGen presenter (avatar + paired voice). */
  heygen_avatar_id?: string;
  heygen_voice_id?: string;
};

/** Per-row BVS toggle from marketer content cart (idea_id or mimic key). */
export type RunCandidatesBvsOverride = {
  key: string;
  enabled: boolean;
};

/** Per-idea flow/platform from marketer content cart (manual picker). */
export type RunCandidatesIdeaPick = {
  idea_id: string;
  target_flow_type: string;
  platform?: string;
  use_brand_visual_system?: boolean;
  linkedin_aspect_ratio?: string;
  linkedin_image_count?: number;
  heygen_avatar_id?: string;
  heygen_voice_id?: string;
};

/** One cart line from Review — source of truth for marketer content cart materialize. */
export type CartManifestItem = {
  cart_item_id: string;
  kind: "idea" | "top_performer";
  title?: string;
  target_flow_type: string;
  platform?: string;
  format?: string;
  use_brand_visual_system?: boolean;
  linkedin_aspect_ratio?: string;
  linkedin_image_count?: number;
  insights_id?: string;
  mimic_kind?: MimicPickKind;
  video_intent?: VideoPipelineIntent;
  heygen_avatar_id?: string;
  heygen_voice_id?: string;
};

const cartManifestItemSchema = z.object({
  cart_item_id: z.string().min(1),
  kind: z.enum(["idea", "top_performer"]),
  title: z.string().optional(),
  target_flow_type: z.string().min(1),
  platform: z.string().optional(),
  format: z.string().optional(),
  use_brand_visual_system: z.boolean().optional(),
  linkedin_aspect_ratio: z.string().optional(),
  linkedin_image_count: z.coerce.number().int().min(2).max(3).optional(),
  insights_id: z.string().optional(),
  mimic_kind: z.enum(["image", "carousel", "why_carousel", "video"]).optional(),
  video_intent: videoPipelineIntentSchema.optional(),
  heygen_avatar_id: z.string().min(1).max(120).optional(),
  heygen_voice_id: z.string().min(1).max(120).optional(),
});

/** POST /v1/runs/.../jobs and /candidates body validation. */
export const runCandidatesMaterializeBodySchema = z.union([
  z
    .object({
      mode: z.literal("manual"),
      cart_manifest: z.array(cartManifestItemSchema).optional(),
      idea_ids: z.array(z.string()).optional(),
      idea_picks: z
        .array(
          z.object({
            idea_id: z.string().min(1),
            target_flow_type: z.string().min(1),
            platform: z.string().optional(),
            use_brand_visual_system: z.boolean().optional(),
            heygen_avatar_id: z.string().min(1).max(120).optional(),
            heygen_voice_id: z.string().min(1).max(120).optional(),
          })
        )
        .optional(),
      mimic_picks: z
        .array(
          z.object({
            insights_id: z.string().min(1),
            mimic_kind: z.enum(["image", "carousel", "why_carousel", "video"]),
            video_intent: videoPipelineIntentSchema.optional(),
            heygen_avatar_id: z.string().min(1).max(120).optional(),
            heygen_voice_id: z.string().min(1).max(120).optional(),
          })
        )
        .optional(),
      bvs_overrides: z
        .array(
          z.object({
            key: z.string().min(1),
            enabled: z.boolean(),
          })
        )
        .optional(),
    })
    .refine(
      (b) =>
        (b.cart_manifest?.length ?? 0) > 0 ||
        (b.idea_ids?.length ?? 0) > 0 ||
        (b.mimic_picks?.length ?? 0) > 0 ||
        (b.idea_picks?.length ?? 0) > 0,
      {
      message: "cart_manifest, idea_ids, idea_picks, or mimic_picks required for manual mode",
    }),
  z.object({ mode: z.literal("llm"), max_ideas: z.number().int().min(1).max(100).optional() }),
  z.object({ mode: z.literal("from_pack_ideas_all") }),
  z.object({ mode: z.literal("from_pack_overall") }),
]);

export type RunCandidatesMaterializeBodyParsed = z.infer<typeof runCandidatesMaterializeBodySchema>;

export const STEP_RUN_CANDIDATES_FROM_IDEAS_LLM = "inputs_run_candidates_from_ideas_llm";

export const RUN_CANDIDATES_FROM_IDEAS_SYSTEM_PROMPT = `You pick which content ideas from a signal pack should become planner rows for a generation run.
Return ONLY valid JSON: {"idea_ids":["..."]}
Rules:
- Each id MUST appear exactly in the input list (use the "idea_id" field from each row).
- Apply the project strategy, brand constraints, and product profile in the user message.
- Exclude ideas that violate banned words/claims, off-brand tone, or clear strategy mismatches.
- Include every idea that qualifies — up to {{MAX_PICK}} ids (the full signal pack; same ceiling as automated logical rules).
- When multiple ideas qualify, prefer a diverse mix of platforms, formats, and angles.`;

export const RUN_CANDIDATES_FROM_IDEAS_USER_PROMPT_TEMPLATE = `Project context (JSON):
{{PROJECT_CONTEXT_JSON}}

Ideas (JSON):
{{ROWS_JSON}}`;

export type RunCandidatesMaterializeMode =
  | "manual"
  | "llm"
  | "from_pack_ideas_all"
  | "from_pack_selected_ideas_v2"
  | "from_pack_overall";

export interface RunCandidatesMaterializeBody {
  mode: RunCandidatesMaterializeMode;
  /** Marketer content cart — one row per UI line (preferred for cart runs). */
  cart_manifest?: CartManifestItem[];
  /** Required when mode === manual (unless mimic_picks is non-empty). */
  idea_ids?: string[];
  /** Per-idea flow/platform overrides from marketer content cart. */
  idea_picks?: RunCandidatesIdeaPick[];
  /** Top-performer references to plan as mimic-only jobs (manual picker mimic tabs). */
  mimic_picks?: RunCandidatesMimicPick[];
  /** Marketer per-idea Brand Visual System toggles from content cart. */
  bvs_overrides?: RunCandidatesBvsOverride[];
  /** When mode === llm; defaults to all ideas in the pack (same ceiling as automated rules). */
  max_ideas?: number;
}

function ideasForLlmPick(pack: SignalPackRow): { id: string; row: Record<string, unknown> }[] {
  const rich = ideasJsonAsRich(pack);
  if (rich.length > 0) {
    return rich
      .map((i) => {
        const id = String(i.id ?? i.idea_id ?? "").trim();
        const contentIdea = String(i.content_idea ?? i.three_liner ?? i.thesis ?? i.title ?? "").trim();
        const summary = String(i.summary ?? i.three_liner ?? "").trim();
        return {
          id,
          row: {
            idea_id: id,
            title: i.title,
            platform: i.platform,
            format: i.format,
            content_idea: contentIdea.slice(0, 400),
            summary: summary.slice(0, 300),
            confidence_score: i.confidence_score ?? i.idea_score,
            risk_flags: i.risk_flags,
          },
        };
      })
      .filter((x) => x.id);
  }
  return ideasArray(pack)
    .map((i) => {
      const id = String(i.idea_id ?? "").trim();
      return {
        id,
        row: {
          idea_id: i.idea_id,
          platform: i.platform,
          content_idea: (i.content_idea ?? "").slice(0, 400),
          summary: (i.summary ?? "").slice(0, 300),
        },
      };
    })
    .filter((x) => x.id);
}

function productProfileSliceForLlmPick(
  product: Awaited<ReturnType<typeof getProductProfile>>
): Record<string, unknown> | null {
  if (!product) return null;
  const out: Record<string, unknown> = {};
  const keys = [
    "product_name",
    "product_category",
    "one_liner",
    "value_proposition",
    "primary_audience",
    "key_benefits",
    "differentiators",
  ] as const;
  for (const k of keys) {
    const v = (product as unknown as Record<string, unknown>)[k];
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function ideasArray(pack: SignalPackRow): SignalPackIdea[] {
  const raw = readSignalPackIdeasUnion(pack as unknown as Record<string, unknown>);
  if (raw.length === 0) return [];
  return raw as unknown as SignalPackIdea[];
}

function ideasJsonAsRich(pack: SignalPackRow): Record<string, unknown>[] {
  const raw = readSignalPackIdeasUnion(pack as unknown as Record<string, unknown>);
  if (raw.length === 0) return [];
  const strict = parseIdeasV2(raw);
  if (strict.length > 0) return strict as unknown as Record<string, unknown>[];
  return parseIdeasV2Lenient(raw);
}

function packIdeaIdentity(row: Record<string, unknown>): string {
  return String(row.id ?? row.idea_id ?? "").trim();
}

/** Raw pack ideas for cart materialize — same union as Review `parseIdeasFromPack`. */
function packIdeasForMaterialize(pack: SignalPackRow): Record<string, unknown>[] {
  return readSignalPackIdeasUnion(pack as unknown as Record<string, unknown>).filter(
    (r) => packIdeaIdentity(r).length > 0
  );
}

function ideasV2Array(pack: SignalPackRow): Record<string, unknown>[] {
  const raw = pack.ideas_v2_json;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw as Record<string, unknown>[];
}

function selectedIdeaIds(pack: SignalPackRow): string[] {
  const raw = pack.selected_idea_ids_json;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw.map((x) => String(x).trim()).filter(Boolean);
}

function mapIdeasV2ToPlannerSourceRows(
  ideas: Record<string, unknown>[],
  config?: AppConfig,
  pack?: SignalPackRow
): Record<string, unknown>[] {
  const derived =
    pack?.derived_globals_json &&
    typeof pack.derived_globals_json === "object" &&
    !Array.isArray(pack.derived_globals_json)
      ? (pack.derived_globals_json as Record<string, unknown>)
      : null;

  return ideas.map((i) => {
    const id = String(i.id ?? "").trim() || String(i.idea_id ?? "").trim();
    const title = String(i.title ?? "").trim();
    const three = String(i.three_liner ?? i["3_liner"] ?? "").trim();
    const thesis = String(i.thesis ?? "").trim();
    const platformRaw = String(i.platform ?? "Multi").trim() || "Multi";
    const format = String(i.format ?? "post").trim();
    const platform =
      format === "carousel" ? normalizeCarouselIdeaPlatform(platformRaw) : platformRaw;
    const cta = String(i.cta ?? "").trim();
    const whyNow = String(i.why_now ?? "").trim();
    const novelty = String(i.novelty_angle ?? "").trim();
    const keyPoints = Array.isArray(i.key_points) ? i.key_points.map((x) => String(x).trim()).filter(Boolean) : [];
    const confidence = typeof i.confidence_score === "number" ? i.confidence_score : undefined;
    const ideaScore = typeof i.idea_score === "number" ? i.idea_score : undefined;
    const riskFlags = Array.isArray(i.risk_flags) ? i.risk_flags.map((x) => String(x).trim()).filter(Boolean) : [];
    const grounding = Array.isArray(i.grounding_insight_ids)
      ? i.grounding_insight_ids.map((x) => String(x).trim()).filter(Boolean)
      : [];
    const hasCreativeIntelGrounding = grounding.some((g) => String(g).startsWith("ci_"));
    const pastPerformance =
      hasCreativeIntelGrounding && config
        ? Math.min(0.99, config.CREATIVE_INTEL_PLANNER_PAST_PERFORMANCE_BOOST)
        : 0.5;

    let videoStyle = normalizeVideoStyle(i.video_style ?? i.video_pipeline);
    if (!videoStyle && format === "video" && derived && grounding.length > 0) {
      const tpEntry = findVisualGuidelineEntryForGrounding(derived, grounding[0]!);
      if (tpEntry && String(tpEntry.analysis_tier ?? "").trim() === "top_performer_video") {
        videoStyle = resolveTopPerformerVideoHeygenRoute(tpEntry).intent;
      }
    }

    const carouselStyle = String(i.carousel_style ?? i.execution_profile ?? "").trim();

    // Planner expects a loose "overall_candidates_json-like" row shape.
    const contentIdea = title || thesis || three || id || "Selected idea";
    const summary = three || [whyNow, novelty].filter(Boolean).join(" — ") || contentIdea;

    return applyIdeaStructureToPlannerRow({
      idea_id: id,
      candidate_id: id,
      platform,
      target_platform: platform,
      format,
      content_lens: i.content_lens,
      execution_profile: i.execution_profile,
      carousel_style: i.carousel_style,
      video_style: videoStyle ?? i.video_style,
      visual_first_carousel_lane:
        format === "carousel" &&
        (carouselStyle === "visual_first" || carouselStyle === "mixed") &&
        grounding.length > 0
          ? true
          : undefined,
      product_angle: i.product_angle,
      content_idea: contentIdea,
      summary,
      confidence_score: confidence ?? ideaScore ?? 0.8,
      confidence: confidence ?? ideaScore ?? 0.8,
      novelty_score: 0.6,
      platform_fit: 0.75,
      past_performance: pastPerformance,
      recommended_route: "HUMAN_REVIEW",
      cta,
      why_now: whyNow || undefined,
      novelty_angle: novelty || undefined,
      key_points: keyPoints.length ? keyPoints : undefined,
      hook_opener_concept: i.hook_opener_concept,
      risk_flags: riskFlags.length ? riskFlags : undefined,
      grounding_insight_ids: grounding.length ? grounding : undefined,
      provenance:
        format === "carousel" &&
        (carouselStyle === "visual_first" || carouselStyle === "mixed")
          ? VISUAL_FIRST_CAROUSEL_PROVENANCE
          : "signal_pack.ideas_json",
    });
  });
}

function normalizePlannerRows(rows: Record<string, unknown>[], runIdHint: string): Record<string, unknown>[] {
  return normalizeOverallCandidateRows(rows as unknown[], runIdHint);
}

export function plannerRowsFromIdeaSubset(
  pack: SignalPackRow,
  ideaIds: string[],
  runIdHint: string,
  config?: AppConfig
): Record<string, unknown>[] {
  const want = new Set<string>();
  for (const raw of ideaIds) {
    for (const k of plannerIdeaKeyVariants(raw)) want.add(k);
  }
  const matchesId = (i: Record<string, unknown>) =>
    plannerIdeaKeyVariants(packIdeaIdentity(i)).some((k) => want.has(k));
  const loose = packIdeasForMaterialize(pack).filter(matchesId);
  if (loose.length > 0) {
    const mapped = mapIdeasV2ToPlannerSourceRows(loose, config, pack);
    return normalizePlannerRows(mapped, runIdHint);
  }
  const legacy = ideasArray(pack).filter((i) =>
    plannerIdeaKeyVariants(packIdeaIdentity(i as unknown as Record<string, unknown>)).some((k) =>
      want.has(k)
    )
  );
  if (legacy.length === 0) return [];
  const mappedLegacy = mapIdeasJsonToPlannerSourceRows(legacy);
  return normalizePlannerRows(mappedLegacy as unknown as Record<string, unknown>[], runIdHint);
}

/**
 * One planner row per content-cart idea pick (preserves cart order, stamps target_flow_type).
 * Throws when a pick cannot be resolved in the signal pack — avoids silent 1-job cart runs.
 */
export function plannerRowsFromCartIdeaPicks(
  pack: SignalPackRow,
  picks: RunCandidatesIdeaPick[],
  runIdHint: string,
  config?: AppConfig
): Record<string, unknown>[] {
  const mapped: Record<string, unknown>[] = [];
  const missing: string[] = [];

  for (const pick of picks) {
    const rows = plannerRowsFromIdeaSubset(pack, [pick.idea_id], runIdHint, config);
    if (!rows.length) {
      missing.push(pick.idea_id);
      continue;
    }
    mapped.push(stampIdeaPickOnPlannerRow(rows[0]!, pick));
  }

  if (missing.length) {
    const sample = missing.slice(0, 6).join(", ");
    throw new Error(
      `Cart idea_picks could not resolve ${missing.length} id(s) in the signal pack (${sample}${missing.length > 6 ? "…" : ""}). ` +
        "On Ideas, attach the current research brief, re-add cart items, then start again."
    );
  }

  return mapped;
}

function stringField(v: unknown, max = 800): string {
  if (typeof v !== "string") return "";
  const t = v.trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Planner rows for manually picked top-performer mimic references (one row → one mimic flow). */
export function plannerRowsFromMimicPicks(
  pack: SignalPackRow,
  picks: RunCandidatesMimicPick[],
  runIdHint: string
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const pick of picks) {
    const normalized = normalizeMimicPickRef(pick.insights_id, pick.mimic_kind);
    const insightsId = normalized.insights_id;
    const mimicKind = normalized.mimic_kind;
    if (!insightsId) continue;
    const dedupeKey = `${mimicKind}:${insightsId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const entry = findVisualGuidelineEntry(pack, insightsId);
    if (!entry) {
      throw new Error(`No visual guideline entry for insights_id ${insightsId} — rebuild the signal pack.`);
    }
    const tier = stringField(entry.analysis_tier, 80);
    const expectedTier = TIER_FOR_KIND[mimicKind];
    if (tier && expectedTier && tier !== expectedTier) {
      throw new Error(
        `insights_id ${insightsId} is tier ${tier}, not ${expectedTier} — pick it under the matching mimic tab.`
      );
    }

    const flowType =
      mimicKind === "video"
        ? resolveTopPerformerVideoHeygenRoute(entry, {
            forceIntent: pick.video_intent,
          }).flow_type
        : mimicKindToFlowType(mimicKind);
    const rowId = stringField(entry.source_evidence_row_id, 40);
    const hook = stringField(entry.hook_text_preview, 400);
    const why = stringField(entry.why_it_worked, 600);
    const formatPattern = stringField(entry.format_pattern, 120);
    const platform = platformFromEvidenceKind(stringField(entry.evidence_kind, 80) || "instagram_post");
    const ideaId = `mimic_${insightsId}`;
    const contentIdea = hook || why.slice(0, 400) || `Mimic ${mimicKind} · ${insightsId}`;
    const format =
      mimicKind === "carousel" || mimicKind === "why_carousel"
        ? "carousel"
        : mimicKind === "video"
          ? "video"
          : "post";

    const videoRoute =
      mimicKind === "video"
        ? resolveTopPerformerVideoHeygenRoute(entry, { forceIntent: pick.video_intent })
        : null;

    rows.push({
      idea_id: ideaId,
      candidate_id: ideaId,
      sign: ideaId,
      topic: ideaId,
      platform,
      target_platform: platform,
      format,
      content_idea: contentIdea,
      summary: why || contentIdea,
      confidence: 0.88,
      confidence_score: 0.88,
      novelty_score: 0.55,
      platform_fit: 0.82,
      past_performance: 0.85,
      recommended_route: "HUMAN_REVIEW",
      source_evidence_row_id: rowId || undefined,
      analysis_tier: tier || expectedTier,
      grounding_insight_ids: [insightsId],
      target_flow_type: flowType,
      video_style: videoRoute?.intent,
      top_performer_video_route_reason: videoRoute?.reason,
      manual_mimic_pick: true,
      mimic_kind: mimicKind,
      provenance: "signal_pack.visual_guidelines_pack_v1",
      ...(String(pick.heygen_avatar_id ?? "").trim()
        ? {
            heygen_avatar_id: String(pick.heygen_avatar_id).trim(),
            ...(String(pick.heygen_voice_id ?? "").trim()
              ? { heygen_voice_id: String(pick.heygen_voice_id).trim() }
              : {}),
          }
        : {}),
    });
  }

  return normalizePlannerRows(rows, runIdHint);
}

function bvsKeyForPlannerRow(row: Record<string, unknown>): string | null {
  if (row.manual_mimic_pick === true) {
    const kind = String(row.mimic_kind ?? "carousel").trim();
    const ids = row.grounding_insight_ids;
    const ins = Array.isArray(ids) ? String(ids[0] ?? "").trim() : "";
    if (ins) return `mimic:${kind}:${ins}`;
  }
  const ideaId = String(row.idea_id ?? "").trim();
  return ideaId || null;
}

export function applyBvsOverridesToPlannerRows(
  rows: Record<string, unknown>[],
  overrides: RunCandidatesBvsOverride[] | undefined
): Record<string, unknown>[] {
  if (!overrides?.length) return rows;
  const map = new Map(overrides.map((o) => [o.key.trim(), o.enabled]));
  return rows.map((row) => {
    const key = bvsKeyForPlannerRow(row);
    if (!key || !map.has(key)) return row;
    return { ...row, use_brand_visual_system: map.get(key) === true };
  });
}

/** Match cart / pack idea ids (`idea_x`, `x`, `idea_idea_x`). */
export function plannerIdeaKeyVariants(raw: string): string[] {
  const t = String(raw ?? "").trim();
  if (!t) return [];
  const stripped = t.replace(/^(idea_)+/i, "");
  const keys = new Set<string>([t]);
  if (stripped) {
    keys.add(stripped);
    keys.add(`idea_${stripped}`);
  }
  return [...keys];
}

function stampHeygenPresenterOnPlannerRow(
  row: Record<string, unknown>,
  avatarId: string | undefined,
  voiceId: string | undefined
): Record<string, unknown> {
  const avatar = String(avatarId ?? "").trim();
  if (!avatar) return row;
  const voice = String(voiceId ?? "").trim();
  return {
    ...row,
    heygen_avatar_id: avatar,
    ...(voice ? { heygen_voice_id: voice } : {}),
  };
}

function stampIdeaPickOnPlannerRow(
  row: Record<string, unknown>,
  pick: RunCandidatesIdeaPick
): Record<string, unknown> {
  const ideaKey = pick.idea_id.trim();
  const out: Record<string, unknown> = {
    ...row,
    idea_id: String(row.idea_id ?? ideaKey).trim() || ideaKey,
    target_flow_type: pick.target_flow_type,
    content_cart_pick: true,
  };
  if (pick.platform?.trim()) {
    out.platform = pick.platform.trim();
    out.target_platform = pick.platform.trim();
  }
  if (pick.use_brand_visual_system !== undefined) {
    out.use_brand_visual_system = pick.use_brand_visual_system;
  }
  if (pick.linkedin_aspect_ratio?.trim()) {
    out.linkedin_aspect_ratio = pick.linkedin_aspect_ratio.trim();
  }
  if (pick.linkedin_image_count != null) {
    out.linkedin_image_count = pick.linkedin_image_count;
  }
  return stampHeygenPresenterOnPlannerRow(out, pick.heygen_avatar_id, pick.heygen_voice_id);
}

export function normalizeCartIdeaIdFromItemId(raw: string): string {
  const core = String(raw ?? "")
    .trim()
    .replace(/^(idea_)+/i, "");
  return core ? `idea_${core}` : "";
}

function normalizeTpInsightsId(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/^tp_/i, "");
}

function formatForCartManifest(targetFlowType: string, format?: string): string {
  const explicit = String(format ?? "")
    .trim()
    .toLowerCase();
  if (explicit) return explicit;
  const ft = targetFlowType.toUpperCase();
  if (ft.includes("CAROUSEL")) return "carousel";
  if (ft.includes("LINKEDIN_TEXT")) return "linkedin_text";
  if (ft.includes("LINKEDIN_DOCUMENT") || ft.includes("LINKEDIN")) return "linkedin_document";
  if (ft.includes("REDDIT")) return "reddit_post";
  if (ft.includes("INSTAGRAM_THREAD") || ft.includes("THREAD")) return "instagram_thread";
  if (ft.includes("VID") || ft.includes("VIDEO")) return "video";
  return "post";
}

function syntheticPlannerRowFromCartManifest(
  item: CartManifestItem,
  ideaId: string
): Record<string, unknown> {
  const format = formatForCartManifest(item.target_flow_type, item.format);
  const platformRaw = item.platform ?? "Instagram";
  const platform = format === "carousel" ? normalizeCarouselIdeaPlatform(platformRaw) : platformRaw;
  const title = String(item.title ?? ideaId).trim() || ideaId;
  const base = applyIdeaStructureToPlannerRow({
    idea_id: ideaId,
    candidate_id: ideaId,
    platform,
    target_platform: platform,
    format,
    content_idea: title,
    summary: title,
    confidence_score: 0.85,
    confidence: 0.85,
    novelty_score: 0.6,
    platform_fit: 0.75,
    past_performance: 0.5,
    recommended_route: "HUMAN_REVIEW",
    provenance: "marketer_content_cart.manifest",
    target_flow_type: item.target_flow_type,
    ...(item.linkedin_aspect_ratio ? { linkedin_aspect_ratio: item.linkedin_aspect_ratio } : {}),
    ...(item.linkedin_image_count != null ? { linkedin_image_count: item.linkedin_image_count } : {}),
  });
  return base;
}

function plannerRowFromManifestMimicItem(
  pack: SignalPackRow,
  item: CartManifestItem,
  runIdHint: string
): Record<string, unknown> {
  const insightsId = String(item.insights_id ?? normalizeTpInsightsId(item.cart_item_id)).trim();
  const mimicKind = item.mimic_kind;
  if (insightsId && mimicKind) {
    const rows = plannerRowsFromMimicPicks(
      pack,
      [
        {
          insights_id: insightsId,
          mimic_kind: mimicKind,
          ...(item.video_intent ? { video_intent: item.video_intent } : {}),
          ...(item.heygen_avatar_id ? { heygen_avatar_id: item.heygen_avatar_id } : {}),
          ...(item.heygen_voice_id ? { heygen_voice_id: item.heygen_voice_id } : {}),
        },
      ],
      runIdHint
    );
    if (rows[0]) {
      return { ...rows[0], content_cart_pick: true, target_flow_type: item.target_flow_type };
    }
  }
  const fallbackId = insightsId || normalizeTpInsightsId(item.cart_item_id);
  throw new Error(
    `Cart top_performer pick could not resolve insights_id ${fallbackId} (${item.mimic_kind ?? "mimic"}) in the signal pack visual_guidelines_pack_v1. ` +
      "Rebuild the signal pack or re-add the reference from Market Intelligence before starting the cart run."
  );
}

/**
 * One planner row per cart manifest line (cart order). Enriches from pack when possible;
 * otherwise builds rows from the cart payload so job count matches the UI.
 */
export function plannerRowsFromCartManifest(
  pack: SignalPackRow,
  manifest: CartManifestItem[],
  runIdHint: string,
  config?: AppConfig
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const item of manifest) {
    if (item.kind === "idea") {
      const ideaId = normalizeCartIdeaIdFromItemId(item.cart_item_id);
      if (!ideaId) {
        throw new Error(`Cart manifest idea missing id: ${item.cart_item_id}`);
      }
      let base = plannerRowsFromIdeaSubset(pack, [ideaId], runIdHint, config)[0];
      if (!base) {
        base = syntheticPlannerRowFromCartManifest(item, ideaId);
      }
      rows.push(
        stampIdeaPickOnPlannerRow(base, {
          idea_id: ideaId,
          target_flow_type: item.target_flow_type,
          platform: item.platform,
          use_brand_visual_system: item.use_brand_visual_system,
          linkedin_aspect_ratio: item.linkedin_aspect_ratio,
          linkedin_image_count: item.linkedin_image_count,
          heygen_avatar_id: item.heygen_avatar_id,
          heygen_voice_id: item.heygen_voice_id,
        })
      );
      continue;
    }
    rows.push(plannerRowFromManifestMimicItem(pack, item, runIdHint));
  }
  return rows;
}

export function applyIdeaPicksToPlannerRows(
  rows: Record<string, unknown>[],
  picks: RunCandidatesIdeaPick[] | undefined,
  ideaIdsOrder?: string[]
): Record<string, unknown>[] {
  if (!picks?.length) return rows;

  const pickByKey = new Map<string, RunCandidatesIdeaPick>();
  for (const p of picks) {
    for (const k of plannerIdeaKeyVariants(p.idea_id)) {
      pickByKey.set(k, p);
    }
  }

  const resolvePick = (row: Record<string, unknown>, idx: number): RunCandidatesIdeaPick | undefined => {
    const rowKeys = plannerIdeaKeyVariants(
      String(row.idea_id ?? row.candidate_id ?? row.id ?? "")
    );
    for (const k of rowKeys) {
      const hit = pickByKey.get(k);
      if (hit) return hit;
    }
    const orderKey = ideaIdsOrder?.[idx];
    if (orderKey) {
      for (const k of plannerIdeaKeyVariants(orderKey)) {
        const hit = pickByKey.get(k);
        if (hit) return hit;
      }
    }
    if (picks.length === rows.length) return picks[idx];
    return undefined;
  };

  return rows.map((row, idx) => {
    const pick = resolvePick(row, idx);
    if (!pick) return row;
    return stampIdeaPickOnPlannerRow(row, pick);
  });
}

export async function materializeRunCandidates(
  db: Pool,
  config: AppConfig,
  projectId: string,
  run: Pick<RunRow, "id" | "run_id" | "signal_pack_id">,
  pack: SignalPackRow,
  body: RunCandidatesMaterializeBody
): Promise<{ planner_rows: number; candidates_provenance: Record<string, unknown> }> {
  if (!run.signal_pack_id || run.signal_pack_id !== pack.id) {
    throw new Error("Run signal_pack_id must match the provided pack");
  }

  let rows: Record<string, unknown>[] = [];
  let provenance: Record<string, unknown> = { mode: body.mode };

  if (body.mode === "from_pack_overall") {
    const oc = pack.overall_candidates_json;
    const list = Array.isArray(oc) ? (oc as unknown[]) : [];
    rows = normalizeOverallCandidateRows(list, run.run_id) as Record<string, unknown>[];
    provenance = { ...provenance, source: "signal_pack.overall_candidates_json", row_count: rows.length };
  } else if (body.mode === "from_pack_ideas_all") {
    // Canonical: rich ideas are stored in ideas_json.
    const rich = ideasJsonAsRich(pack);
    if (rich.length > 0) {
      const mapped = mapIdeasV2ToPlannerSourceRows(rich, config, pack);
      rows = normalizePlannerRows(mapped, run.run_id);
      provenance = { ...provenance, source: "signal_pack.ideas_json", idea_count: rich.length, row_count: rows.length };
    } else {
      const ideas = ideasArray(pack);
      if (ideas.length === 0) {
        throw new Error("signal_pack.ideas_json is empty — build a pack in Processing or use from_pack_overall");
      }
      const mapped = mapIdeasJsonToPlannerSourceRows(ideas);
      rows = normalizePlannerRows(mapped as unknown as Record<string, unknown>[], run.run_id);
      provenance = { ...provenance, source: "signal_pack.ideas_json(legacy)", idea_count: ideas.length, row_count: rows.length };
    }
  } else if (body.mode === "from_pack_selected_ideas_v2") {
    // Prefer the new join table selection; fall back to legacy JSON column.
    let ids: string[] = [];
    try {
      ids = await listSignalPackSelectedIdeaIds(db, { project_id: projectId, signal_pack_id: pack.id });
    } catch {
      ids = [];
    }
    if (ids.length === 0) ids = selectedIdeaIds(pack);
    if (ids.length === 0) throw new Error("signal_pack.selected_idea_ids_json is empty");

    // Prefer canonical storage in ideas_json; keep fallback to deprecated ideas_v2_json.
    const want = new Set(ids);
    const richIdeas = ideasJsonAsRich(pack);
    let chosen = richIdeas.filter((i) => want.has(String(i.id ?? i.idea_id ?? "").trim()));
    let source = "signal_pack.selected_idea_ids_json + ideas_json";
    if (chosen.length === 0) {
      const deprecated = ideasV2Array(pack);
      chosen = deprecated.filter((i) => want.has(String(i.id ?? i.idea_id ?? "").trim()));
      source = "signal_pack.selected_idea_ids_json + ideas_v2_json(deprecated)";
    }
    if (chosen.length === 0) throw new Error("No matching ideas_v2_json rows for selected_idea_ids_json");
    const mapped = mapIdeasV2ToPlannerSourceRows(chosen, config, pack);
    rows = normalizePlannerRows(mapped, run.run_id);
    provenance = {
      ...provenance,
      source,
      idea_count: chosen.length,
      row_count: rows.length,
    };
  } else if (body.mode === "manual") {
    const ids = body.idea_ids ?? [];
    const mimicPicks = body.mimic_picks ?? [];
    const hasCartManifest = (body.cart_manifest?.length ?? 0) > 0;
    if (
      !hasCartManifest &&
      ids.length === 0 &&
      mimicPicks.length === 0 &&
      !body.idea_picks?.length
    ) {
      throw new Error("cart_manifest, idea_ids, idea_picks, or mimic_picks required when mode=manual");
    }
    const merged: Record<string, unknown>[] = [];
    if (hasCartManifest) {
      merged.push(...plannerRowsFromCartManifest(pack, body.cart_manifest!, run.run_id, config));
    } else if (body.idea_picks?.length) {
      merged.push(...plannerRowsFromCartIdeaPicks(pack, body.idea_picks, run.run_id, config));
    } else if (ids.length > 0) {
      const ideaRows = plannerRowsFromIdeaSubset(pack, ids, run.run_id, config);
      if (ideaRows.length === 0) throw new Error("No matching ideas for the given idea_ids");
      merged.push(...applyIdeaPicksToPlannerRows(ideaRows, body.idea_picks, ids));
    }
    if (!hasCartManifest && mimicPicks.length > 0) {
      merged.push(...plannerRowsFromMimicPicks(pack, mimicPicks, run.run_id));
    }
    rows = merged;
    provenance = {
      ...provenance,
      ...(body.cart_manifest?.length ? { cart_manifest: body.cart_manifest, source: "marketer_content_cart.manifest" } : {}),
      ...(ids.length ? { idea_ids: ids } : {}),
      ...(body.idea_picks?.length ? { idea_picks: body.idea_picks } : {}),
      ...(mimicPicks.length ? { mimic_picks: mimicPicks } : {}),
      row_count: rows.length,
    };
  } else if (body.mode === "llm") {
    const entries = ideasForLlmPick(pack);
    if (entries.length === 0) {
      throw new Error("signal_pack.ideas_json is empty — nothing for the LLM to select from");
    }
    const maxPick = Math.min(
      200,
      Math.max(1, body.max_ideas ?? entries.length)
    );
    const apiKey = config.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error("OPENAI_API_KEY is required for mode=llm");

    const [brand, strategy, product] = await Promise.all([
      getBrandConstraints(db, projectId),
      getStrategyDefaults(db, projectId),
      getProductProfile(db, projectId),
    ]);
    const projectContext = {
      strategy: pickStrategySliceForSnapshot(
        (strategy as unknown as Record<string, unknown> | null) ?? null
      ),
      brand_constraints: pickBrandSliceForSnapshot(
        (brand as unknown as Record<string, unknown> | null) ?? null
      ),
      product_profile: productProfileSliceForLlmPick(product),
    };

    const compact = entries.map((e) => e.row);

    const system = RUN_CANDIDATES_FROM_IDEAS_SYSTEM_PROMPT.replace(/\{\{MAX_PICK\}\}/g, String(maxPick));

    const user = RUN_CANDIDATES_FROM_IDEAS_USER_PROMPT_TEMPLATE.replace(
      "{{PROJECT_CONTEXT_JSON}}",
      JSON.stringify(projectContext, null, 0)
    ).replace("{{ROWS_JSON}}", JSON.stringify(compact, null, 0));

    const out = await openaiChat(
      apiKey,
      {
        model: "gpt-4o-mini",
        system_prompt: system,
        user_prompt: user,
        max_tokens: 2048,
        response_format: "json_object",
      },
      {
        db,
        projectId,
        runId: run.run_id,
        taskId: null,
        signalPackId: run.signal_pack_id,
        step: STEP_RUN_CANDIDATES_FROM_IDEAS_LLM,
      }
    );

    const parsed = parseJsonObjectFromLlmText(out.content) as { idea_ids?: unknown } | null;
    const rawIds = parsed && Array.isArray(parsed.idea_ids) ? parsed.idea_ids : [];
    const picked = rawIds.map((x) => String(x).trim()).filter(Boolean);
    if (picked.length === 0) throw new Error("LLM returned no idea_ids");
    rows = plannerRowsFromIdeaSubset(pack, picked.slice(0, maxPick), run.run_id, config);
    if (rows.length === 0) throw new Error("LLM idea_ids did not match any pack ideas");
    provenance = {
      ...provenance,
      source: "llm",
      llm_idea_ids: picked.slice(0, maxPick),
      row_count: rows.length,
      model: out.model,
      project_context: projectContext,
      pack_idea_count: entries.length,
      max_pick: maxPick,
    };
  } else {
    throw new Error(`Unknown mode: ${(body as RunCandidatesMaterializeBody).mode}`);
  }

  rows = applyBvsOverridesToPlannerRows(rows, body.bvs_overrides);
  if (body.bvs_overrides?.length) {
    provenance = { ...provenance, bvs_overrides: body.bvs_overrides };
  }

  await updateRunCandidatesJson(db, run.id, rows, provenance);
  return { planner_rows: rows.length, candidates_provenance: provenance };
}
