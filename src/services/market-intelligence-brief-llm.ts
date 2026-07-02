import type { Pool } from "pg";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type {
  CompetitiveLandscapeV1,
  MarketIntelligenceV1,
  MarketIntelligencePatternV1,
  SynthesisInsightRowInput,
  TopPerformerBriefHighlight,
} from "../domain/market-intelligence-synthesis.js";
import { insightColumnLabelsFromCriteria } from "../domain/insight-column-labels.js";
import { getInputsProcessingProfile } from "../repositories/inputs-processing-profile.js";
import { openaiChat } from "./openai-chat.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import { logPipelineEvent } from "./pipeline-logger.js";

const briefOutSchema = z.object({
  research_brief_title: z.string().min(8).max(120).optional(),
  market_overview: z.string().min(40).max(900).optional(),
  what_worked: z.string().min(40).max(900).optional(),
  executive_summary: z.array(z.string().min(12).max(280)).min(3).max(6),
  action_playbook: z.array(z.string().min(12).max(220)).min(3).max(6).optional(),
  competitive_landscape: z
    .object({
      overview: z.string().min(40).max(900),
      brands: z
        .array(
          z.object({
            handle_or_name: z.string().min(2).max(80),
            platform: z.string().min(2).max(40),
            post_count: z.number().int().min(1).max(500).optional(),
            signature_moves: z.array(z.string().min(8).max(200)).min(1).max(4),
            standout_example: z.string().min(8).max(280).optional(),
          })
        )
        .min(1)
        .max(8),
    })
    .optional(),
  patterns: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(4).max(120),
        summary: z.string().min(24).max(480),
      })
    )
    .max(40),
  media_lanes: z
    .array(
      z.object({
        lane: z.enum(["carousel", "video", "image"]),
        overview: z.string().min(12).max(360),
        format_groups: z
          .array(
            z.object({
              format_key: z.string(),
              takeaways: z.array(z.string().min(8).max(220)).min(1).max(4),
            })
          )
          .max(6)
          .optional(),
      })
    )
    .max(3)
    .optional(),
  top_performer_highlights: z
    .array(
      z.object({
        insights_id: z.string().min(1),
        title: z.string().min(4).max(100),
        platform: z.string().min(2).max(40),
        format: z.string().min(2).max(60),
        summary: z.string().min(24).max(360),
        apply_this: z.string().min(8).max(160).optional(),
      })
    )
    .max(10)
    .optional(),
  opportunities: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(4).max(120),
        summary: z.string().min(12).max(420),
      })
    )
    .max(8)
    .optional(),
  avoid: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(4).max(120),
        summary: z.string().min(12).max(480),
      })
    )
    .max(10)
    .optional(),
  hooks_digest: z
    .object({
      key_takeaways: z.array(z.string().min(8).max(220)).min(1).max(5),
    })
    .optional(),
});

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function allPatterns(v1: MarketIntelligenceV1): MarketIntelligencePatternV1[] {
  return [
    ...v1.winning_patterns,
    ...v1.hooks,
    ...v1.emotions,
    ...v1.visual_patterns,
    ...v1.opportunities,
    ...v1.avoid,
  ];
}

function platformLabelFromEvidenceKind(kind: string): string {
  const k = kind.toLowerCase();
  if (k.includes("instagram")) return "Instagram";
  if (k.includes("tiktok")) return "TikTok";
  if (k.includes("facebook")) return "Facebook";
  if (k.includes("reddit")) return "Reddit";
  if (k.includes("youtube")) return "YouTube";
  return kind.replace(/_/g, " ") || "Social";
}

function normalizeCreatorHandle(raw: string | null | undefined): string | null {
  const t = str(raw).replace(/^@+/, "");
  if (!t || t.length < 2) return null;
  if (/^(unknown|n\/a|null|undefined)$/i.test(t)) return null;
  return t;
}

function rowScore(r: SynthesisInsightRowInput): number {
  return parseFloat(String(r.pre_llm_score ?? "0")) || 0;
}

/** Pick top rows per platform so every platform in the scrape is represented. */
export function stratifiedSampleByPlatform<T extends { platform: string }>(
  items: T[],
  scoreOf: (item: T) => number,
  opts?: { perPlatform?: number; maxTotal?: number }
): T[] {
  const perPlatform = opts?.perPlatform ?? 12;
  const maxTotal = opts?.maxTotal ?? 72;
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = item.platform.trim().toLowerCase() || "unknown";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(item);
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => scoreOf(b) - scoreOf(a));
  }
  const platforms = [...buckets.keys()].sort();
  const out: T[] = [];
  for (let round = 0; round < perPlatform && out.length < maxTotal; round++) {
    let added = false;
    for (const pk of platforms) {
      const pick = buckets.get(pk)?.[round];
      if (pick) {
        out.push(pick);
        added = true;
        if (out.length >= maxTotal) break;
      }
    }
    if (!added) break;
  }
  return out;
}

interface CompetitorRollupRow {
  handle_or_name: string;
  platform: string;
  post_count: number;
  avg_score: number;
  top_hooks: string[];
  formats: string[];
  why_snippets: string[];
  top_tier_posts: number;
}

function buildCompetitorRollup(rows: SynthesisInsightRowInput[], limit = 12): CompetitorRollupRow[] {
  const buckets = new Map<
    string,
    {
      handle: string;
      platform: string;
      posts: Array<{ hook: string | null; format: string; why: string | null; score: number; tier: string }>;
    }
  >();

  for (const r of rows) {
    const handle = normalizeCreatorHandle(r.creator);
    if (!handle) continue;
    const platform = platformLabelFromEvidenceKind(r.evidence_kind);
    const key = `${platform.toLowerCase()}:${handle.toLowerCase()}`;
    if (!buckets.has(key)) buckets.set(key, { handle, platform, posts: [] });
    const score = parseFloat(String(r.pre_llm_score ?? "0")) || 0;
    buckets.get(key)!.posts.push({
      hook: str(r.hook_text) || null,
      format: str(r.evidence_post_format) || "unknown",
      why: str(r.why_it_worked) || null,
      score,
      tier: r.analysis_tier,
    });
  }

  const out: CompetitorRollupRow[] = [];
  for (const b of buckets.values()) {
    if (b.posts.length < 1) continue;
    const scores = b.posts.map((p) => p.score).filter((s) => s > 0);
    const avg = scores.length ? scores.reduce((a, x) => a + x, 0) / scores.length : 0;
    const hooks = [...new Set(b.posts.map((p) => p.hook).filter(Boolean) as string[])].slice(0, 4);
    const formats = [...new Set(b.posts.map((p) => p.format).filter(Boolean))].slice(0, 4);
    const why = [...new Set(b.posts.map((p) => p.why).filter(Boolean) as string[])].slice(0, 3);
    const topTier = b.posts.filter((p) => p.tier.startsWith("top_performer")).length;
    out.push({
      handle_or_name: b.handle.startsWith("@") ? b.handle : `@${b.handle}`,
      platform: b.platform,
      post_count: b.posts.length,
      avg_score: Math.round(avg * 100) / 100,
      top_hooks: hooks.map((h) => truncate(h, 100)),
      formats,
      why_snippets: why.map((w) => truncate(w, 180)),
      top_tier_posts: topTier,
    });
  }

  return out
    .sort(
      (a, b) =>
        b.top_tier_posts - a.top_tier_posts ||
        b.post_count - a.post_count ||
        b.avg_score - a.avg_score
    )
    .slice(0, limit);
}

function compactInsightRow(r: SynthesisInsightRowInput) {
  return {
    insights_id: r.insights_id,
    creator: normalizeCreatorHandle(r.creator),
    platform: platformLabelFromEvidenceKind(r.evidence_kind),
    format: r.evidence_post_format,
    hook_text: r.hook_text,
    hook_type: r.hook_type,
    primary_emotion: r.primary_emotion,
    secondary_emotion: r.secondary_emotion,
    why_it_worked: r.why_it_worked ? truncate(r.why_it_worked, 240) : null,
    hashtags: r.hashtags ? truncate(r.hashtags, 120) : null,
    caption_style: r.caption_style,
    cta_type: r.cta_type,
    custom_label_1: r.custom_label_1,
    custom_label_2: r.custom_label_2,
    custom_label_3: r.custom_label_3,
    risk_flags: Array.isArray(r.risk_flags_json)
      ? r.risk_flags_json.map((x) => String(x).trim()).filter(Boolean).slice(0, 4)
      : [],
    source_url: r.source_url ?? null,
    score: rowScore(r),
  };
}

/** Broad per-post insights only — stratified across all platforms in the import. */
export function compactInsightsForBrief(rows: SynthesisInsightRowInput[]) {
  const broad = rows.filter((r) => r.analysis_tier === "broad_llm");
  const mapped = broad.map(compactInsightRow);
  const picked = stratifiedSampleByPlatform(mapped, (x) => x.score, { perPlatform: 12, maxTotal: 72 });
  return picked.map(({ score: _score, ...rest }) => rest);
}

function resolveTopPerformerPlatform(e: Record<string, unknown>): string {
  const explicit = str(e.platform) || str(e.evidence_platform);
  if (explicit) return platformLabelFromEvidenceKind(explicit);
  const kind = str(e.evidence_kind);
  if (kind) return platformLabelFromEvidenceKind(kind);
  return "Unknown";
}

/** Vision-analyzed top performers — stratified across all platforms. */
export function compactTopPerformersForBrief(derivedGlobals: Record<string, unknown> | null | undefined) {
  const vg = asRecord(derivedGlobals?.visual_guidelines_pack_v1);
  const entries = asArray(vg?.entries);
  const mapped: Array<Record<string, unknown> & { platform: string; score: number }> = [];
  for (const raw of entries) {
    const e = asRecord(raw);
    if (!e) continue;
    const tier = str(e.analysis_tier);
    if (!tier.startsWith("top_performer")) continue;
    mapped.push({
      insights_id: str(e.insights_id),
      analysis_tier: tier,
      platform: resolveTopPerformerPlatform(e),
      format: str(e.format_pattern) || tier.replace(/_/g, " "),
      creator: str(e.creator) || str(e.account_handle) || str(e.owner_username) || null,
      title: str(e.title) || str(e.hook_snippet) || str(e.caption_snippet),
      hook: str(e.hook_snippet) || str(e.hook_text),
      why_it_worked: str(e.why_it_worked) || str(e.why_mimic_hint) || str(e.strategic_summary),
      aesthetic_summary: str(e.aesthetic_summary),
      deck_summary: str(e.deck_as_whole_summary),
      caption_style: str(e.caption_style),
      cta_type: str(e.cta_type),
      score: parseFloat(String(e.pre_llm_score ?? e.score ?? "0")) || 0.5,
    });
  }
  const picked = stratifiedSampleByPlatform(mapped, (x) => x.score, { perPlatform: 6, maxTotal: 30 });
  return picked.map(({ score: _score, ...rest }) => rest);
}

function compactDraftForLlm(
  draft: MarketIntelligenceV1,
  derivedGlobals: Record<string, unknown> | null | undefined,
  insightRows: SynthesisInsightRowInput[]
) {
  const insights = compactInsightsForBrief(insightRows);
  const top_performers = compactTopPerformersForBrief(derivedGlobals);
  const platforms = [
    ...new Set([
      ...insights.map((r) => r.platform),
      ...top_performers.map((r) => String(r.platform)),
    ]),
  ].filter(Boolean);

  return {
    rows_analyzed: draft.rows_analyzed,
    platforms_in_evidence: platforms,
    insights,
    top_performers,
    /** Existing cluster ids the brief must patch — synthesize copy from insights + top_performers only. */
    pattern_ids: allPatterns(draft).map((p) => ({
      id: p.id,
      category: p.category,
      evidence_count: p.evidence_count,
    })),
  };
}

function mergePatternText(
  original: MarketIntelligencePatternV1,
  patch: { title: string; summary: string }
): MarketIntelligencePatternV1 {
  return {
    ...original,
    title: truncate(patch.title, 100),
    summary: truncate(patch.summary, 480),
  };
}

function mergePatternList(
  list: MarketIntelligencePatternV1[],
  patchById: Map<string, { title: string; summary: string }>
) {
  return list.map((p) => {
    const patch = patchById.get(p.id);
    return patch ? mergePatternText(p, patch) : p;
  });
}

function mergeCompetitiveLandscape(
  generated: z.infer<typeof briefOutSchema>["competitive_landscape"],
  rollup: CompetitorRollupRow[]
): CompetitiveLandscapeV1 | undefined {
  if (!generated?.brands?.length) return undefined;
  const rollupKeys = new Set(rollup.map((r) => r.handle_or_name.toLowerCase().replace(/^@+/, "")));

  const brands = generated.brands
    .map((b) => {
      const handle = str(b.handle_or_name);
      const normalized = handle.replace(/^@+/, "").toLowerCase();
      const inRollup = rollupKeys.has(normalized);
      if (!inRollup && rollup.length >= 2) return null;
      const rollupMatch = rollup.find((r) => r.handle_or_name.toLowerCase().replace(/^@+/, "") === normalized);
      return {
        handle_or_name: handle.startsWith("@") ? truncate(handle, 80) : `@${truncate(handle, 78)}`,
        platform: truncate(b.platform, 40),
        post_count: b.post_count ?? rollupMatch?.post_count ?? 1,
        signature_moves: b.signature_moves.map((m) => truncate(m, 200)).slice(0, 4),
        standout_example: b.standout_example ? truncate(b.standout_example, 280) : rollupMatch?.top_hooks[0] ?? null,
      };
    })
    .filter((b): b is NonNullable<typeof b> => b != null)
    .slice(0, 8);

  if (!brands.length) return undefined;
  return {
    overview: truncate(generated.overview, 900),
    brands,
  };
}

/** Apply LLM-generated copy onto deterministic draft — preserves evidence metadata. */
export function applyResearchBriefLlmOutput(
  draft: MarketIntelligenceV1,
  generated: z.infer<typeof briefOutSchema>,
  opts?: { competitorRollup?: CompetitorRollupRow[] }
): MarketIntelligenceV1 {
  const patchById = new Map(generated.patterns.map((p) => [p.id, p]));

  const next: MarketIntelligenceV1 = {
    ...draft,
    llm_polished: true,
    research_brief_title: generated.research_brief_title
      ? truncate(generated.research_brief_title, 120)
      : draft.research_brief_title,
    market_overview: generated.market_overview ? truncate(generated.market_overview, 900) : draft.market_overview,
    what_worked: generated.what_worked ? truncate(generated.what_worked, 900) : draft.what_worked,
    executive_summary: generated.executive_summary.map((s) => truncate(s, 280)).slice(0, 6),
    action_playbook: generated.action_playbook?.map((s) => truncate(s, 220)).slice(0, 6) ?? draft.action_playbook,
    winning_patterns: mergePatternList(draft.winning_patterns, patchById),
    hooks: mergePatternList(draft.hooks, patchById),
    emotions: mergePatternList(draft.emotions, patchById),
    visual_patterns: mergePatternList(draft.visual_patterns, patchById),
    opportunities: mergePatternList(draft.opportunities, patchById),
    avoid: mergePatternList(draft.avoid, patchById),
  };

  const competitive = mergeCompetitiveLandscape(
    generated.competitive_landscape,
    opts?.competitorRollup ?? []
  );
  if (competitive) next.competitive_landscape = competitive;

  if (generated.media_lanes?.length) {
    const lanePatch = new Map(generated.media_lanes.map((l) => [l.lane, l]));
    next.media_lanes = draft.media_lanes.map((lane) => {
      const patch = lanePatch.get(lane.lane);
      if (!patch) return lane;
      const formatPatch = new Map((patch.format_groups ?? []).map((g) => [g.format_key, g.takeaways]));
      return {
        ...lane,
        overview: truncate(patch.overview, 360),
        format_groups: lane.format_groups.map((g) => {
          const takeaways = formatPatch.get(g.format_key);
          return takeaways?.length ? { ...g, takeaways: takeaways.map((t) => truncate(t, 220)) } : g;
        }),
      };
    });
  }

  if (generated.opportunities?.length) {
    const existingIds = new Set(next.opportunities.map((p) => p.id));
    for (const opp of generated.opportunities) {
      if (existingIds.has(opp.id)) {
        const idx = next.opportunities.findIndex((p) => p.id === opp.id);
        if (idx >= 0) {
          next.opportunities[idx] = mergePatternText(next.opportunities[idx]!, opp);
        }
        continue;
      }
      next.opportunities.push({
        id: opp.id,
        category: "opportunity",
        title: truncate(opp.title, 100),
        summary: truncate(opp.summary, 420),
        evidence_count: 1,
        confidence: 0.5,
        source_insight_ids: [],
        formats: [],
      });
    }
  }

  if (generated.avoid?.length) {
    const avoidPatch = new Map(generated.avoid.map((a) => [a.id, a]));
    next.avoid = next.avoid.map((p) => {
      const patch = avoidPatch.get(p.id);
      return patch ? mergePatternText(p, patch) : p;
    });
    for (const a of generated.avoid) {
      if (!next.avoid.some((p) => p.id === a.id)) {
        next.avoid.push({
          id: a.id,
          category: "saturated_angle",
          title: truncate(a.title, 100),
          summary: truncate(a.summary, 480),
          evidence_count: 1,
          confidence: 0.45,
          source_insight_ids: [],
          formats: [],
        });
      }
    }
    next.avoid = next.avoid.slice(0, 10);
  }

  if (generated.hooks_digest?.key_takeaways?.length && next.hooks_digest) {
    next.hooks_digest = {
      ...next.hooks_digest,
      key_takeaways: generated.hooks_digest.key_takeaways.map((t) => truncate(t, 220)).slice(0, 5),
    };
  }

  if (generated.top_performer_highlights?.length) {
    next.top_performer_highlights = generated.top_performer_highlights.map((h) => ({
      insights_id: h.insights_id,
      title: truncate(h.title, 100),
      platform: truncate(h.platform, 40),
      format: truncate(h.format, 60),
      summary: truncate(h.summary, 360),
      apply_this: h.apply_this ? truncate(h.apply_this, 160) : null,
    })) satisfies TopPerformerBriefHighlight[];
  }

  return next;
}

function llmBriefEnabled(config: AppConfig, criteria: Record<string, unknown>): boolean {
  const nested = criteria.market_intelligence;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const flag = (nested as Record<string, unknown>).llm_brief;
    if (flag === false || flag === "false" || flag === 0) return false;
    const legacy = (nested as Record<string, unknown>).llm_polish;
    if (legacy === false || legacy === "false" || legacy === 0) return false;
  }
  return Boolean(config.OPENAI_API_KEY?.trim());
}

function resolveBriefModel(criteria: Record<string, unknown>, synthModel: string | null | undefined): string {
  const nested = criteria.market_intelligence;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const m = str((nested as Record<string, unknown>).brief_model);
    if (m) return m;
  }
  return synthModel?.trim() || "gpt-4o";
}

const SYSTEM_PROMPT = `You write premium market research briefs for brand marketers — the kind a senior strategist delivers after analyzing scraped social evidence.

Your ONLY source material is:
1. **insights** — per-post broad analysis rows (hooks, emotions, why_it_worked, formats, creators) across every platform in the scrape.
2. **top_performers** — vision-analyzed reference posts (deck/aesthetic summaries, deeper creative detail).

Do NOT rely on pre-written summaries, stats tables, hashtag leaderboards, or brand profile fields — synthesize everything from insights + top_performers.

MULTI-PLATFORM (required):
- **platforms_in_evidence** lists every platform present. Your brief must cover **all** of them — not an Instagram-only narrative when TikTok, Reddit, Facebook, YouTube, etc. are also in the data.
- Call out platform-specific wins and format differences where the evidence supports it.
- research_brief_title should reflect the dominant platform mix (e.g. "Instagram + TikTok · humor hooks · Jun 2026"), not assume a single network.

OUTPUT QUALITY BAR:
- Write like a strategist, not a data dump. Complete sentences. Specific to themes visible in the rows.
- Every claim must trace to an insights_id, creator, or top_performer entry — do not invent accounts, metrics, or posts.
- Pattern summaries use: "What: … Why it works: … Apply: …" (one paragraph, under 480 chars).
- market_overview: niche landscape across platforms — audiences, dominant formats per platform, emotional territory.
- what_worked: winning playbook synthesized from insights + top_performers.
- executive_summary: 4–6 bullets mixing platforms, formats, emotions, hooks. Cite post counts from pattern_ids.evidence_count when patching patterns.
- action_playbook: 4–6 testable actions for the content team this week.
- hooks_digest.key_takeaways: 3–5 bullets on hook strategy across platforms.
- avoid: expand risks grounded in insight risk_flags; use pattern ids from pattern_ids when present.
- competitive_landscape: when insights name 2+ distinct creators, spotlight 3–6 accounts using ONLY handles seen in insights or top_performers. Group by platform when helpful.
- top_performer_highlights: 5–8 posts from top_performers; include apply_this per post. insights_id must match input.
- media_lanes: derive carousel / video / image takeaways from format fields in insights and top_performers.

RULES:
- Return ONLY valid JSON matching the user schema.
- Do NOT change pattern ids, lane names, format_key values, or insights_id values.
- Every pattern in "patterns" MUST use an id from pattern_ids.
- Avoid operator jargon (task_id, pipeline, DocAI, FLUX, etc.).
- Synthesize polished prose — do not copy raw fragments verbatim.`;

export async function generateResearchBriefWithLlm(
  db: Pool,
  config: AppConfig,
  projectId: string,
  projectSlug: string,
  draft: MarketIntelligenceV1,
  opts: {
    derived_globals?: Record<string, unknown> | null;
    insight_rows: SynthesisInsightRowInput[];
    signal_pack_id?: string | null;
    import_id?: string | null;
    brand_display_name?: string | null;
  }
): Promise<MarketIntelligenceV1> {
  const profile = await getInputsProcessingProfile(db, projectId).catch(() => null);
  const criteria = profile?.criteria_json ?? {};
  if (!llmBriefEnabled(config, criteria)) return draft;

  const apiKey = config.OPENAI_API_KEY!.trim();
  const model = resolveBriefModel(criteria, profile?.synth_model);
  const brand = (opts.brand_display_name ?? projectSlug).trim();
  const competitorRollup = buildCompetitorRollup(opts.insight_rows, 12);
  const columnLabels = insightColumnLabelsFromCriteria(criteria);
  const compact = compactDraftForLlm(draft, opts.derived_globals ?? null, opts.insight_rows);
  if (columnLabels.l1 || columnLabels.l2 || columnLabels.l3) {
    (compact as Record<string, unknown>).insight_column_labels = columnLabels;
  }

  const user = `Brand label (display only): ${brand}
Posts analyzed: ${draft.rows_analyzed}
Platforms in evidence: ${(compact.platforms_in_evidence as string[]).join(", ") || "unknown"}

Synthesize the research brief from insights + top_performers only (all platforms above).

Generate JSON:
{
  "research_brief_title": "...",
  "market_overview": "...",
  "what_worked": "...",
  "executive_summary": ["...", ...],
  "action_playbook": ["...", ...],
  "competitive_landscape": {
    "overview": "...",
    "brands": [{"handle_or_name":"@...", "platform":"...", "post_count":3, "signature_moves":["..."], "standout_example":"..."}]
  },
  "patterns": [{"id":"...", "title":"...", "summary":"What: ... Why it works: ... Apply: ..."}],
  "media_lanes": [{"lane":"carousel|video|image", "overview":"...", "format_groups":[{"format_key":"...", "takeaways":["..."]}]}],
  "top_performer_highlights": [{"insights_id":"...", "title":"...", "platform":"...", "format":"...", "summary":"...", "apply_this":"..."}],
  "opportunities": [{"id":"opp_1", "title":"...", "summary":"..."}],
  "avoid": [{"id":"...", "title":"...", "summary":"What to avoid: ... Why: ... Alternative: ..."}],
  "hooks_digest": {"key_takeaways": ["...", "..."]}
}

Source material JSON:
${JSON.stringify(compact).slice(0, 98_000)}`;

  try {
    const out = await openaiChat(
      apiKey,
      {
        model,
        system_prompt: SYSTEM_PROMPT,
        user_prompt: user,
        max_tokens: 12000,
        response_format: "json_object",
      },
      {
        db,
        projectId,
        runId: null,
        taskId: null,
        signalPackId: opts.signal_pack_id ?? null,
        step: "market_intelligence_brief",
      }
    );

    const raw = parseJsonObjectFromLlmText(out.content);
    const parsed = briefOutSchema.safeParse(raw);
    if (!parsed.success) {
      logPipelineEvent("warn", "plan", "LLM brief schema rejected — using deterministic draft", {
        project_id: projectId,
        data: { signal_pack_id: opts.signal_pack_id ?? undefined },
      });
      return draft;
    }

    const knownIds = new Set(allPatterns(draft).map((p) => p.id));
    const validPatches = parsed.data.patterns.filter((p) => knownIds.has(p.id));
    if (validPatches.length < Math.min(2, knownIds.size)) {
      logPipelineEvent("warn", "plan", "Too few pattern patches — using deterministic draft", {
        project_id: projectId,
        data: { patched: validPatches.length, expected: knownIds.size },
      });
      return draft;
    }

    const tpIds = new Set(
      compactTopPerformersForBrief(opts.derived_globals)
        .map((t) => str(t.insights_id))
        .filter(Boolean)
    );
    const highlights = (parsed.data.top_performer_highlights ?? []).filter((h) => tpIds.has(h.insights_id));

    return applyResearchBriefLlmOutput(
      draft,
      {
        ...parsed.data,
        patterns: validPatches,
        top_performer_highlights: highlights.length ? highlights : parsed.data.top_performer_highlights,
      },
      {
        competitorRollup,
      }
    );
  } catch (err) {
    logPipelineEvent("warn", "plan", "LLM brief generation failed — using deterministic draft", {
      project_id: projectId,
      data: {
        signal_pack_id: opts.signal_pack_id ?? undefined,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return draft;
  }
}
