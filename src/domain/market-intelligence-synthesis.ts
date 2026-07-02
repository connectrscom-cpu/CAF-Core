/**
 * Aggregates row-level evidence insights into marketer-facing market intelligence
 * (patterns across multiple posts, not one card per scraped row).
 */
import { buildInsightReadModelItem, type InsightReadModelItem, type InsightReadType } from "./insights-read-model.js";
import { normalizeHookType } from "./hook-type-normalize.js";
import { pickTopPerformerKnowledgeFromDerivedGlobals } from "./signal-pack-top-performer-knowledge.js";

export const MARKET_INTELLIGENCE_V1_KEY = "market_intelligence_v1";

export type MarketIntelligencePatternCategory =
  | "winning_pattern"
  | "winning_format"
  | "strong_hook"
  | "emotional_pattern"
  | "visual_pattern"
  | "opportunity"
  | "saturated_angle";

export interface MarketIntelligencePatternV1 {
  id: string;
  category: MarketIntelligencePatternCategory;
  title: string;
  summary: string;
  evidence_count: number;
  /** Pattern strength 0–1 (cluster size + scores), not raw pre-LLM rank alone. */
  confidence: number | null;
  source_insight_ids: string[];
  formats: string[];
  /** Instagram / permalink URLs supporting this pattern (when available on evidence). */
  evidence_urls?: string[];
  /** One-line actionable takeaway for creators. */
  actionable?: string | null;
}

export interface ResearchStatBucketV1 {
  key: string;
  count: number;
  /** Permalink URLs for posts in this bucket (when available). */
  evidence_urls?: string[];
  /** Insight row ids (`insights_id`) backing this bucket. */
  source_insight_ids?: string[];
}

export interface ResearchStatsV1 {
  formats: ResearchStatBucketV1[];
  hook_types: ResearchStatBucketV1[];
  emotions: ResearchStatBucketV1[];
  platforms: ResearchStatBucketV1[];
  themes: ResearchStatBucketV1[];
  distinct_creators: number;
}

export interface CustomLabelStatV1 {
  slot: 1 | 2 | 3;
  column_label: string;
  value: string;
  count: number;
  share_pct: number;
}

export interface InsightColumnLabelsV1 {
  custom_label_1: string;
  custom_label_2: string;
  custom_label_3: string;
}

export interface HooksDigestV1 {
  hooks: string[];
  key_takeaways: string[];
}

export interface MediaLaneSynthesisV1 {
  lane: "carousel" | "video" | "image";
  label: string;
  overview: string;
  format_groups: Array<{ format_key: string; label: string; takeaways: string[] }>;
}

export interface TopicDeepDiveV1 {
  topic: string;
  items: MarketIntelligencePatternV1[];
}

export interface TopPerformerBriefHighlight {
  insights_id: string;
  title: string;
  platform: string;
  format: string;
  summary: string;
  /** One-line practical takeaway for creators. */
  apply_this?: string | null;
  analysis_tier?: string | null;
}

export interface CompetitorBrandSpotlight {
  handle_or_name: string;
  platform: string;
  post_count: number;
  signature_moves: string[];
  standout_example?: string | null;
}

export interface CompetitiveLandscapeV1 {
  /** How the niche players compete — formats, hooks, positioning. */
  overview: string;
  brands: CompetitorBrandSpotlight[];
}

export interface MarketIntelligenceV1 {
  schema_version: 1;
  generated_at: string;
  /** True when copy was generated/rewritten by the research-brief LLM pass. */
  llm_polished?: boolean;
  /** Marketer-facing title for this research window (optional). */
  research_brief_title?: string;
  /** 2–4 sentence niche landscape — who the audience is and what the feed rewards. */
  market_overview?: string;
  /** Narrative synthesis of what consistently won in this research window. */
  what_worked?: string;
  /** Concrete actions the team can take this week. */
  action_playbook?: string[];
  /** Who is winning in the feed and what they are doing differently. */
  competitive_landscape?: CompetitiveLandscapeV1;
  top_performer_highlights?: TopPerformerBriefHighlight[];
  executive_summary: string[];
  winning_patterns: MarketIntelligencePatternV1[];
  hooks: MarketIntelligencePatternV1[];
  emotions: MarketIntelligencePatternV1[];
  visual_patterns: MarketIntelligencePatternV1[];
  opportunities: MarketIntelligencePatternV1[];
  avoid: MarketIntelligencePatternV1[];
  media_lanes: MediaLaneSynthesisV1[];
  deep_dive: TopicDeepDiveV1[];
  /** Distribution stats across analyzed posts (formats, emotions, custom themes). */
  research_stats?: ResearchStatsV1;
  /** Operator custom-column value frequencies with share %. */
  custom_label_stats?: CustomLabelStatV1[];
  /** Labels for custom_label_1..3 when configured in processing profile. */
  insight_column_labels?: InsightColumnLabelsV1;
  /** Compact hook list + synthesis — prefer over per-hook cards in UI. */
  hooks_digest?: HooksDigestV1;
  total_patterns: number;
  rows_analyzed: number;
}

export interface SynthesisInsightRowInput {
  project_slug: string;
  inputs_import_id: string;
  signal_pack_id?: string | null;
  run_id?: string | null;
  evidence_post_format?: string | null;
  id: string;
  insights_id: string;
  analysis_tier: "broad_llm" | "top_performer_deep" | "top_performer_video" | "top_performer_carousel";
  source_evidence_row_id: string;
  evidence_kind: string;
  pre_llm_score: string | null;
  why_it_worked: string | null;
  primary_emotion: string | null;
  secondary_emotion: string | null;
  hook_type: string | null;
  hook_text: string | null;
  hashtags: string | null;
  caption_style: string | null;
  cta_type: string | null;
  custom_label_1: string | null;
  custom_label_2: string | null;
  custom_label_3: string | null;
  aesthetic_analysis_json: unknown;
  risk_flags_json: unknown;
  created_at: string;
  /** Creator / account from scraped evidence when available. */
  creator?: string | null;
  /** Permalink to the scraped post when available. */
  source_url?: string | null;
}

function nonEmpty(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t ? t : null;
}

function riskFlags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x).trim()).filter(Boolean);
}

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function patternStrength(count: number, scores: number[]): number {
  const sizeFactor = Math.min(1, count / 5);
  const scoreAvg = avg(scores) ?? 0.45;
  return Math.round(Math.min(1, sizeFactor * 0.55 + scoreAvg * 0.45) * 100) / 100;
}

function readTypeToCategory(type: InsightReadType): MarketIntelligencePatternCategory {
  switch (type) {
    case "hook_pattern":
      return "strong_hook";
    case "emotional_pattern":
      return "emotional_pattern";
    case "format_pattern":
    case "top_performer":
      return "winning_format";
    case "visual_pattern":
      return "visual_pattern";
    case "strategic_opportunity":
      return "opportunity";
    case "risk_or_warning":
      return "saturated_angle";
    default:
      return "winning_pattern";
  }
}

function clusterKey(item: InsightReadModelItem, raw: SynthesisInsightRowInput): string {
  if (item.type === "risk_or_warning") {
    const flags = riskFlags(raw.risk_flags_json);
    return `risk:${normalizeKey(flags[0] ?? "unknown")}`;
  }
  if (item.type === "hook_pattern") {
    const ht =
      normalizeKey(normalizeHookType(raw.hook_type) ?? "") ||
      normalizeKey(nonEmpty(raw.primary_emotion) ?? "hook");
    return `hook:${ht}:${normalizeKey(raw.primary_emotion ?? "any")}`;
  }
  if (item.type === "emotional_pattern") {
    return `emotion:${normalizeKey(raw.primary_emotion ?? "unknown")}`;
  }
  if (item.type === "top_performer") {
    const fmt = item.formats[0] ?? "any";
    const topic =
      normalizeKey(nonEmpty(raw.custom_label_1) ?? "") ||
      normalizeKey(nonEmpty(raw.hook_text) ?? "") ||
      normalizeKey(truncate(nonEmpty(raw.why_it_worked) ?? "", 60));
    return `tp:${fmt}:${topic || "pattern"}`;
  }
  if (item.type === "visual_pattern") {
    return `visual:${normalizeKey(truncate(item.summary, 60))}`;
  }
  if (item.type === "hashtag_cluster") {
    return `tag:${normalizeKey(nonEmpty(raw.hashtags) ?? item.title)}`;
  }
  return `row:${item.id}`;
}

function pickBestSummary(members: Array<{ item: InsightReadModelItem; raw: SynthesisInsightRowInput }>): string {
  const count = new Set(members.flatMap((m) => m.item.supporting_evidence_ids)).size;
  const synthesized = synthesizeClusterSummary(members, count);
  if (synthesized) return synthesized;

  const candidates = members
    .map((m) => summaryGist(m.item.summary.trim()))
    .filter((s) => s.length >= 12)
    .sort((a, b) => b.length - a.length);
  const best = candidates[0] ?? summaryGist(members[0]?.item.summary ?? "");
  if (!best) return count > 1 ? `Pattern seen across ${count} posts in this research.` : "Recurring content pattern.";
  if (count <= 1) return truncate(best, 420);
  if (/seen across \d+ posts/i.test(best)) return truncate(best, 420);
  return truncate(`${best} Seen across ${count} posts in this research.`, 420);
}

function synthesizeClusterSummary(
  members: Array<{ item: InsightReadModelItem; raw: SynthesisInsightRowInput }>,
  evidenceCount: number
): string | null {
  const type = members[0]?.item.type;
  const emotions = [...new Set(members.map((m) => nonEmpty(m.raw.primary_emotion)).filter(Boolean))];
  const hooks = members.map((m) => nonEmpty(m.raw.hook_text)).filter(Boolean) as string[];
  const whyLines = members.map((m) => nonEmpty(m.raw.why_it_worked)).filter(Boolean) as string[];

  if (type === "hook_pattern" && hooks.length > 0) {
    const hookSample = truncate(hooks[0]!, 72);
    const emotion = emotions[0];
    let line = `Recurring hooks like “${hookSample}”`;
    if (emotion) line += ` drive ${emotion.toLowerCase()} and comment engagement.`;
    else line += ` pull readers into the carousel.`;
    if (evidenceCount >= 2) line += ` Seen across ${evidenceCount} posts in this research.`;
    return truncate(line, 420);
  }

  if (type === "emotional_pattern" && emotions.length > 0) {
    const emotion = emotions[0]!;
    let line = `Content that leans into ${emotion.toLowerCase()} resonates repeatedly in this brief.`;
    if (whyLines[0]) line = `${whyLines[0].replace(/\.$/, "")}. Primary emotion: ${emotion.toLowerCase()}.`;
    if (evidenceCount >= 2) line += ` Seen across ${evidenceCount} posts in this research.`;
    return truncate(line, 420);
  }

  if ((type === "top_performer" || type === "format_pattern") && whyLines.length > 0) {
    const gist = truncate(summaryGist(whyLines.sort((a, b) => b.length - a.length)[0]!), 280);
    if (evidenceCount >= 2) {
      return truncate(`${gist} Seen across ${evidenceCount} top posts in this research.`, 420);
    }
    return truncate(gist, 420);
  }

  if (type === "risk_or_warning") {
    const flags = members.flatMap((m) => riskFlags(m.raw.risk_flags_json));
    if (flags[0]) {
      let line = `Watch for ${flags[0].toLowerCase()}.`;
      if (evidenceCount >= 2) line += ` Flagged on ${evidenceCount} posts.`;
      return truncate(line, 420);
    }
  }

  return null;
}

function pickBestTitle(members: Array<{ item: InsightReadModelItem; raw: SynthesisInsightRowInput }>): string {
  const titles = members.map((m) => m.item.title.trim()).filter(Boolean);
  const generic = /^top performer|^hook pattern:|^emotional signal:|^risk or weak|^market row/i;
  const specific = titles.find((t) => !generic.test(t));
  if (specific) return truncate(specific, 100);
  if (members[0]?.item.type === "hook_pattern") {
    const hook = members.map((m) => nonEmpty(m.raw.hook_text)).find(Boolean);
    if (hook) return truncate(`Hook: ${hook}`, 100);
    const ht = members.map((m) => normalizeHookType(m.raw.hook_type)).find(Boolean);
    if (ht) return truncate(`Hook style: ${ht}`, 100);
  }
  return truncate(titles[0] ?? "Pattern", 100);
}

function isNearDuplicate(a: string, b: string): boolean {
  const na = normalizeKey(a);
  const nb = normalizeKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length > 24 && nb.length > 24 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

function dedupePatterns(patterns: MarketIntelligencePatternV1[]): MarketIntelligencePatternV1[] {
  const out: MarketIntelligencePatternV1[] = [];
  for (const p of patterns) {
    if (out.some((x) => isNearDuplicate(x.summary, p.summary) || isNearDuplicate(x.title, p.title))) continue;
    out.push(p);
  }
  return out;
}

function collectEvidenceUrls(
  members: Array<{ item: InsightReadModelItem; raw: SynthesisInsightRowInput }>
): string[] {
  const urls = new Set<string>();
  for (const m of members) {
    const u = nonEmpty(m.raw.source_url);
    if (u && /^https?:\/\//i.test(u)) urls.add(u);
  }
  return [...urls].slice(0, 8);
}

function actionableFromPattern(
  type: InsightReadType,
  summary: string,
  members: Array<{ item: InsightReadModelItem; raw: SynthesisInsightRowInput }>
): string | null {
  const applyMatch = /apply:\s*([^.]+)/i.exec(summary);
  if (applyMatch?.[1]) return truncate(applyMatch[1].trim(), 160);
  if (type === "hook_pattern") {
    const hook = members.map((m) => nonEmpty(m.raw.hook_text)).find(Boolean);
    if (hook) return truncate(`Test a hook in this style: “${hook.slice(0, 60)}”`, 160);
  }
  if (type === "top_performer" || type === "format_pattern") {
    const why = members.map((m) => nonEmpty(m.raw.why_it_worked)).find(Boolean);
    if (why) return truncate(`Replicate: ${summaryGist(why)}`, 160);
  }
  return null;
}

function aggregateCluster(
  key: string,
  members: Array<{ item: InsightReadModelItem; raw: SynthesisInsightRowInput }>
): MarketIntelligencePatternV1 {
  const evidenceIds = [...new Set(members.flatMap((m) => m.item.supporting_evidence_ids))];
  const insightIds = [...new Set(members.map((m) => m.item.insights_id))];
  const scores = members
    .map((m) => m.item.confidence)
    .filter((c): c is number => c != null && Number.isFinite(c));
  const formats = [...new Set(members.flatMap((m) => m.item.formats))].filter(Boolean);
  const type = members[0]!.item.type;

  return {
    id: `pat_${normalizeKey(key).replace(/\s+/g, "_").slice(0, 48)}_${evidenceIds.length}`,
    category: readTypeToCategory(type),
    title: pickBestTitle(members),
    summary: pickBestSummary(members),
    evidence_count: evidenceIds.length,
    confidence: patternStrength(evidenceIds.length, scores),
    source_insight_ids: insightIds,
    formats,
    evidence_urls: collectEvidenceUrls(members),
    actionable: actionableFromPattern(type, pickBestSummary(members), members),
  };
}

function clusterInsights(
  rows: Array<{ item: InsightReadModelItem; raw: SynthesisInsightRowInput }>,
  opts?: { minClusterSize?: number; allowSingletonTiers?: Set<string> }
): MarketIntelligencePatternV1[] {
  const minSize = opts?.minClusterSize ?? 2;
  const allowSingleton = opts?.allowSingletonTiers ?? new Set(["top_performer_deep", "top_performer_video", "top_performer_carousel"]);

  const buckets = new Map<string, Array<{ item: InsightReadModelItem; raw: SynthesisInsightRowInput }>>();
  for (const row of rows) {
    const key = clusterKey(row.item, row.raw);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(row);
  }

  const patterns: MarketIntelligencePatternV1[] = [];
  for (const [key, members] of buckets) {
    const count = new Set(members.flatMap((m) => m.item.supporting_evidence_ids)).size;
    const tier = members[0]!.raw.analysis_tier;
    const highScore = members.some((m) => (m.item.confidence ?? 0) >= 0.65);
    if (count < minSize) {
      if (!allowSingleton.has(tier) && !highScore) continue;
      if (members[0]!.item.type === "market_row_analysis") continue;
    }
    patterns.push(aggregateCluster(key, members));
  }

  return dedupePatterns(
    patterns.sort((a, b) => b.evidence_count - a.evidence_count || (b.confidence ?? 0) - (a.confidence ?? 0))
  );
}

function humanFormatKey(key: string): string {
  const k = key.trim().toLowerCase();
  if (!k || k === "unknown") return "General";
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanLaneLabel(lane: string): string {
  if (lane === "carousel") return "Carousel";
  if (lane === "video") return "Video";
  if (lane === "image") return "Image";
  return lane;
}

function sanitizeCue(cue: string, max = 200): string | null {
  const t = cue.replace(/\s+/g, " ").trim();
  if (t.length < 8) return null;
  if (/^(create|design|use canva|batch|obtain copyright)/i.test(t)) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function synthesizeLaneOverview(
  lane: string,
  formatGroups: MediaLaneSynthesisV1["format_groups"],
  postCount: number
): string {
  if (!formatGroups.length) {
    return `Limited ${humanLaneLabel(lane).toLowerCase()} patterns in this brief.`;
  }
  const formatNames = formatGroups.slice(0, 3).map((g) => g.label.toLowerCase());
  const themes = formatGroups
    .flatMap((g) => g.takeaways)
    .slice(0, 2)
    .map((t) => summaryGist(t))
    .filter(Boolean);
  const formatPart =
    formatNames.length === 1
      ? `${formatNames[0]} ${humanLaneLabel(lane).toLowerCase()}s`
      : `${humanLaneLabel(lane).toLowerCase()} posts (${formatNames.join(", ")})`;

  if (themes.length >= 2) {
    return truncate(
      `Across ${postCount} top ${formatPart}, winners combine ${themes[0]!.toLowerCase()} with ${themes[1]!.toLowerCase()}.`,
      320
    );
  }
  if (themes[0]) {
    return truncate(`Top ${formatPart} lean on ${themes[0].toLowerCase()}.`, 320);
  }
  return truncate(`Clear patterns emerged in ${formatPart} from your research window.`, 320);
}

function synthesizeMediaLanes(derivedGlobals: Record<string, unknown> | null | undefined): MediaLaneSynthesisV1[] {
  const tpk = pickTopPerformerKnowledgeFromDerivedGlobals(derivedGlobals ?? {});
  if (!tpk) return [];
  const out: MediaLaneSynthesisV1[] = [];

  for (const lane of ["carousel", "video", "image"] as const) {
    const slice = tpk.media_lanes[lane];
    const formatGroups: MediaLaneSynthesisV1["format_groups"] = [];
    const seen = new Set<string>();

    for (const g of slice.content_format_groups ?? []) {
      const formatKey = String(g.content_format_key ?? g.content_format_pattern ?? "unknown");
      const takeaways: string[] = [];
      for (const c of g.cues ?? []) {
        const t = sanitizeCue(String(c));
        if (!t || seen.has(normalizeKey(t))) continue;
        seen.add(normalizeKey(t));
        takeaways.push(t);
        if (takeaways.length >= 4) break;
      }
      if (!takeaways.length) continue;
      formatGroups.push({
        format_key: formatKey,
        label: humanFormatKey(formatKey),
        takeaways,
      });
    }

    const laneCues = (slice.visual_guideline_cues ?? [])
      .map((c) => sanitizeCue(String(c)))
      .filter((x): x is string => !!x)
      .filter((c) => !seen.has(normalizeKey(c)))
      .slice(0, 2);

    if (!formatGroups.length && !laneCues.length) continue;

    const postCount = Math.max(
      1,
      formatGroups.reduce((n, g) => n + g.takeaways.length, 0)
    );
    const overview = synthesizeLaneOverview(lane, formatGroups, postCount);

    out.push({
      lane,
      label: humanLaneLabel(lane),
      overview,
      format_groups: formatGroups.slice(0, 6),
    });
  }

  return out;
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

export function buildResearchStats(rows: SynthesisInsightRowInput[]): ResearchStatsV1 {
  type StatAcc = { count: number; urls: Set<string>; insightIds: Set<string> };

  const bump = (m: Map<string, StatAcc>, key: string, r: SynthesisInsightRowInput) => {
    if (!key) return;
    let acc = m.get(key);
    if (!acc) {
      acc = { count: 0, urls: new Set(), insightIds: new Set() };
      m.set(key, acc);
    }
    acc.count += 1;
    const url = nonEmpty(r.source_url);
    if (url && /^https?:\/\//i.test(url)) acc.urls.add(url);
    const iid = str(r.insights_id);
    if (iid) acc.insightIds.add(iid);
  };

  const formatCounts = new Map<string, StatAcc>();
  const hookTypes = new Map<string, StatAcc>();
  const emotions = new Map<string, StatAcc>();
  const platforms = new Map<string, StatAcc>();
  const themes = new Map<string, StatAcc>();
  const creators = new Set<string>();

  for (const r of rows) {
    bump(formatCounts, str(r.evidence_post_format) || "unknown", r);
    const ht = str(r.hook_type);
    if (ht) bump(hookTypes, ht, r);
    const em = str(r.primary_emotion);
    if (em) bump(emotions, em, r);
    bump(platforms, platformLabelFromEvidenceKind(r.evidence_kind), r);
    const theme = str(r.custom_label_1);
    if (theme) bump(themes, theme, r);
    const creator = str(r.creator);
    if (creator) creators.add(creator.toLowerCase());
  }

  const topN = (m: Map<string, StatAcc>, n: number): ResearchStatBucketV1[] =>
    [...m.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, n)
      .map(([key, acc]) => ({
        key,
        count: acc.count,
        evidence_urls: [...acc.urls].slice(0, 12),
        source_insight_ids: [...acc.insightIds].slice(0, 48),
      }));

  return {
    formats: topN(formatCounts, 8),
    hook_types: topN(hookTypes, 8),
    emotions: topN(emotions, 8),
    platforms: topN(platforms, 4),
    themes: topN(themes, 12),
    distinct_creators: creators.size,
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function buildCustomLabelStats(
  rows: SynthesisInsightRowInput[],
  labels: InsightColumnLabelsV1 | null | undefined
): CustomLabelStatV1[] {
  if (!labels) return [];
  const slots: Array<{ slot: 1 | 2 | 3; label: string; field: keyof SynthesisInsightRowInput }> = [];
  if (labels.custom_label_1) slots.push({ slot: 1, label: labels.custom_label_1, field: "custom_label_1" });
  if (labels.custom_label_2) slots.push({ slot: 2, label: labels.custom_label_2, field: "custom_label_2" });
  if (labels.custom_label_3) slots.push({ slot: 3, label: labels.custom_label_3, field: "custom_label_3" });
  if (!slots.length) return [];

  const out: CustomLabelStatV1[] = [];
  for (const { slot, label, field } of slots) {
    const counts = new Map<string, number>();
    let total = 0;
    for (const r of rows) {
      const v = str(r[field]);
      if (!v) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
      total += 1;
    }
    if (!total) continue;
    for (const [value, count] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      out.push({
        slot,
        column_label: label,
        value,
        count,
        share_pct: Math.round((count / total) * 1000) / 10,
      });
    }
  }
  return out;
}

function hookTextFromPatternTitle(title: string): string {
  const m = /^Hook:\s*(.+)/i.exec(title.trim());
  return m ? m[1]!.trim() : title.replace(/^Hook:\s*/i, "").trim();
}

export function buildHooksDigest(
  hooks: MarketIntelligencePatternV1[],
  hookRows: Array<{ item: InsightReadModelItem; raw: SynthesisInsightRowInput }>
): HooksDigestV1 {
  const hookSet = new Set<string>();
  for (const h of hooks) {
    const t = hookTextFromPatternTitle(h.title);
    if (t) hookSet.add(t);
  }
  for (const r of hookRows) {
    const t = nonEmpty(r.raw.hook_text);
    if (t) hookSet.add(t);
  }
  const hookList = [...hookSet].slice(0, 14);

  const takeaways: string[] = [];
  for (const h of hooks.filter((p) => p.evidence_count >= 2).slice(0, 3)) {
    const gist = summaryGist(h.summary);
    if (gist && !takeaways.some((t) => isNearDuplicate(t, gist))) takeaways.push(truncate(gist, 200));
  }
  const typeCounts = new Map<string, number>();
  for (const r of hookRows) {
    const ht = str(r.raw.hook_type);
    if (ht) typeCounts.set(ht, (typeCounts.get(ht) ?? 0) + 1);
  }
  const topType = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topType && takeaways.length < 4) {
    takeaways.push(
      `${humanFormatKey(topType[0])} hooks appear most often (${topType[1]} posts) — lean into that opening style.`
    );
  }
  if (!takeaways.length && hookList.length) {
    takeaways.push("Reuse proven opening lines from the list below — match tone and punctuation closely.");
  }

  return { hooks: hookList, key_takeaways: takeaways.slice(0, 4) };
}

function rowToTopicPattern(r: SynthesisInsightRowInput): MarketIntelligencePatternV1 {
  const score = parseFloat(String(r.pre_llm_score ?? "0")) || null;
  const url = nonEmpty(r.source_url);
  const why = nonEmpty(r.why_it_worked);
  return {
    id: `row_${r.insights_id}`,
    category: "winning_pattern",
    title: truncate(nonEmpty(r.hook_text) || nonEmpty(r.custom_label_1) || "Post insight", 100),
    summary: truncate(why || "High-performing reference in this research window.", 360),
    evidence_count: 1,
    confidence: score != null && Number.isFinite(score) ? score : null,
    source_insight_ids: [r.insights_id],
    formats: [str(r.evidence_post_format) || "unknown"].filter((f) => f !== "unknown"),
    evidence_urls: url && /^https?:\/\//i.test(url) ? [url] : [],
    actionable: why ? truncate(`Study: ${summaryGist(why)}`, 160) : null,
  };
}

function patternsForInsightIds(
  patterns: MarketIntelligencePatternV1[],
  insightIds: Set<string>
): MarketIntelligencePatternV1[] {
  return patterns.filter((p) => p.source_insight_ids.some((id) => insightIds.has(id)));
}

function topicFromPattern(p: MarketIntelligencePatternV1): string {
  const t = `${p.title} ${p.summary}`.toLowerCase();
  if (/relationship|dating|crush|love/.test(t)) return "Relationships";
  if (/zodiac|astrology|horoscope|sign/.test(t)) return "Astrology & signs";
  if (/education|learn|tip|how to|educational/.test(t)) return "Education";
  if (/trend|viral|rising|meme/.test(t)) return "Trends & memes";
  if (/product|offer|promo|app\b/.test(t)) return "Product & offers";
  return "General themes";
}

function summaryGist(summary: string): string {
  return summary.replace(/\s*Seen across \d+ posts in this research brief\.?/i, "").trim();
}

function executiveLineFromPattern(p: MarketIntelligencePatternV1): string {
  const gist = summaryGist(p.summary);
  if (p.category === "strong_hook") {
    return truncate(
      p.evidence_count >= 2
        ? `Across ${p.evidence_count} posts, a recurring hook pattern: ${gist}`
        : gist || p.title,
      240
    );
  }
  if (p.evidence_count >= 2) {
    return truncate(`Across ${p.evidence_count} posts: ${gist || p.title}`, 240);
  }
  return truncate(gist || p.title, 240);
}

function looksLikeGenuineRisk(summary: string): boolean {
  const lower = summary.toLowerCase();
  if (/^(the video excels|captures attention|strong hook|visually striking|excels in|works well|high engagement)/i.test(lower)) {
    return false;
  }
  if (/\b(oversaturat|weak hook|misleading|brand safety|avoid|saturated|low engagement|poor)\b/i.test(lower)) {
    return true;
  }
  return summary.trim().length >= 12;
}

function prioritizeMultiPostPatterns(
  patterns: MarketIntelligencePatternV1[],
  limit: number
): MarketIntelligencePatternV1[] {
  const multi = patterns.filter((p) => p.evidence_count >= 2);
  const single = patterns.filter((p) => p.evidence_count < 2);
  if (multi.length >= 3) return multi.slice(0, limit);
  return [...multi, ...single].slice(0, limit);
}

function buildExecutiveSummary(
  patterns: MarketIntelligencePatternV1[],
  mediaLanes: MediaLaneSynthesisV1[],
  stats?: ResearchStatsV1 | null
): string[] {
  const bullets: string[] = [];
  const ranked = [...patterns]
    .filter((p) => p.category !== "saturated_angle" && p.category !== "strong_hook")
    .sort((a, b) => b.evidence_count - a.evidence_count || (b.confidence ?? 0) - (a.confidence ?? 0));

  if (stats?.formats.length) {
    const top = stats.formats.slice(0, 2).map((f) => `${humanFormatKey(f.key)} (${f.count} posts)`).join(" and ");
    bullets.push(`Formats that dominate this brief: ${top}.`);
  }
  if (stats?.emotions.length && bullets.length < 5) {
    const top = stats.emotions.slice(0, 3).map((e) => `${e.key} (${e.count})`).join(", ");
    bullets.push(`Emotional territory that wins: ${top}.`);
  }

  for (const p of ranked) {
    if (bullets.length >= 5) break;
    if (p.evidence_count < 2 && (p.confidence ?? 0) < 0.55) continue;
    const line = executiveLineFromPattern(p);
    if (!line || bullets.some((b) => isNearDuplicate(b, line))) continue;
    bullets.push(line);
  }

  const hookPatterns = patterns.filter((p) => p.category === "strong_hook" && p.evidence_count >= 2);
  if (hookPatterns[0] && bullets.length < 6) {
    const line = executiveLineFromPattern(hookPatterns[0]);
    if (line && !bullets.some((b) => isNearDuplicate(b, line))) bullets.push(line);
  }

  for (const lane of mediaLanes) {
    if (bullets.length >= 6) break;
    if (!lane.overview || bullets.some((b) => isNearDuplicate(b, lane.overview))) continue;
    bullets.push(truncate(`${lane.label}: ${lane.overview}`, 240));
  }

  return bullets.slice(0, 6);
}

function groupRowsByField(
  rows: SynthesisInsightRowInput[],
  field: "custom_label_1" | "custom_label_2" | "custom_label_3" | "primary_emotion"
): Map<string, SynthesisInsightRowInput[]> {
  const map = new Map<string, SynthesisInsightRowInput[]>();
  for (const r of rows) {
    const v = str(r[field]);
    if (!v) continue;
    if (!map.has(v)) map.set(v, []);
    map.get(v)!.push(r);
  }
  return map;
}

function buildDeepDive(
  patterns: MarketIntelligencePatternV1[],
  insightRows: SynthesisInsightRowInput[],
  columnLabels?: InsightColumnLabelsV1 | null
): TopicDeepDiveV1[] {
  const topics = new Map<string, MarketIntelligencePatternV1[]>();
  const usedPatternIds = new Set<string>();

  const addTopic = (topic: string, items: MarketIntelligencePatternV1[]) => {
    if (!items.length) return;
    const existing = topics.get(topic) ?? [];
    for (const item of items) {
      if (usedPatternIds.has(item.id)) continue;
      existing.push(item);
      usedPatternIds.add(item.id);
    }
    if (existing.length) topics.set(topic, existing.slice(0, 6));
  };

  if (columnLabels?.custom_label_1) {
    for (const [value, rows] of groupRowsByField(insightRows, "custom_label_1")) {
      if (rows.length < 2) continue;
      const ids = new Set(rows.map((r) => r.insights_id));
      const matched = patternsForInsightIds(patterns, ids);
      const items = matched.length ? matched : rows.map(rowToTopicPattern);
      addTopic(`${columnLabels.custom_label_1}: ${value}`, items);
    }
  }

  for (const [emotion, rows] of groupRowsByField(insightRows, "primary_emotion")) {
    if (rows.length < 2) continue;
    const ids = new Set(rows.map((r) => r.insights_id));
    const matched = patternsForInsightIds(patterns, ids).filter((p) => !usedPatternIds.has(p.id));
    if (matched.length) addTopic(`Emotion: ${emotion}`, matched);
  }

  if (columnLabels?.custom_label_2) {
    for (const [value, rows] of groupRowsByField(insightRows, "custom_label_2")) {
      if (rows.length < 2) continue;
      const ids = new Set(rows.map((r) => r.insights_id));
      const matched = patternsForInsightIds(patterns, ids).filter((p) => !usedPatternIds.has(p.id));
      if (matched.length) addTopic(`${columnLabels.custom_label_2}: ${value}`, matched);
    }
  }

  const byRegex = new Map<string, MarketIntelligencePatternV1[]>();
  for (const p of patterns) {
    if (usedPatternIds.has(p.id)) continue;
    const topic = topicFromPattern(p);
    if (!byRegex.has(topic)) byRegex.set(topic, []);
    byRegex.get(topic)!.push(p);
  }
  for (const [topic, items] of byRegex) {
    if (items.length < 2) continue;
    addTopic(topic, items);
  }

  const entries = Array.from(topics.entries())
    .map(([topic, items]) => ({ topic, items: items.slice(0, 5) }))
    .sort((a, b) => b.items.length - a.items.length);

  const specific = entries.filter((e) => e.topic !== "General themes");
  if (specific.length >= 2) return specific.slice(0, 8);
  return entries.slice(0, 8);
}

export function buildMarketIntelligenceV1(input: {
  insightRows: SynthesisInsightRowInput[];
  derivedGlobals?: Record<string, unknown> | null;
  insight_column_labels?: InsightColumnLabelsV1 | null;
}): MarketIntelligenceV1 {
  const paired = input.insightRows.map((raw) => ({
    raw,
    item: buildInsightReadModelItem({
      project_slug: raw.project_slug,
      inputs_import_id: raw.inputs_import_id,
      signal_pack_id: raw.signal_pack_id ?? null,
      run_id: raw.run_id ?? null,
      evidence_post_format: raw.evidence_post_format ?? null,
      id: raw.id,
      insights_id: raw.insights_id,
      analysis_tier: raw.analysis_tier,
      source_evidence_row_id: raw.source_evidence_row_id,
      evidence_kind: raw.evidence_kind,
      pre_llm_score: raw.pre_llm_score,
      why_it_worked: raw.why_it_worked,
      primary_emotion: raw.primary_emotion,
      secondary_emotion: raw.secondary_emotion,
      hook_type: raw.hook_type,
      hook_text: raw.hook_text,
      hashtags: raw.hashtags,
      caption_style: raw.caption_style,
      cta_type: raw.cta_type,
      custom_label_1: raw.custom_label_1,
      custom_label_2: raw.custom_label_2,
      custom_label_3: raw.custom_label_3,
      aesthetic_analysis_json: raw.aesthetic_analysis_json,
      risk_flags_json: raw.risk_flags_json,
      created_at: raw.created_at,
    }),
  }));

  const riskRows = paired.filter((p) => p.item.type === "risk_or_warning");
  const hookRows = paired.filter((p) => p.item.type === "hook_pattern");
  const emotionRows = paired.filter((p) => p.item.type === "emotional_pattern");
  const tpRows = paired.filter((p) => p.item.type === "top_performer");
  const visualRows = paired.filter((p) => p.item.type === "visual_pattern");
  const oppRows = paired.filter((p) => p.item.type === "strategic_opportunity");

  const tpAndFormat = [...tpRows, ...paired.filter((p) => p.item.type === "format_pattern")];
  let winningPatternsRaw = clusterInsights(tpAndFormat, { minClusterSize: 2 });
  if (winningPatternsRaw.length < 3) {
    winningPatternsRaw = clusterInsights(tpAndFormat, { minClusterSize: 1 });
  }
  const winningPatterns = prioritizeMultiPostPatterns(winningPatternsRaw, 12);

  const hooks = prioritizeMultiPostPatterns(clusterInsights(hookRows, { minClusterSize: 2 }), 10);
  const emotions = prioritizeMultiPostPatterns(clusterInsights(emotionRows, { minClusterSize: 2 }), 10);
  const visualPatterns = prioritizeMultiPostPatterns(clusterInsights(visualRows, { minClusterSize: 2 }), 8);
  const opportunities = clusterInsights(oppRows, { minClusterSize: 1 }).slice(0, 6);
  const avoid = clusterInsights(riskRows, { minClusterSize: 1, allowSingletonTiers: new Set() })
    .filter((p) => looksLikeGenuineRisk(p.summary))
    .slice(0, 10);

  const media_lanes = synthesizeMediaLanes(input.derivedGlobals);

  const allPatterns = dedupePatterns([
    ...winningPatterns,
    ...hooks,
    ...emotions,
    ...visualPatterns,
    ...opportunities,
  ]);

  const research_stats = buildResearchStats(input.insightRows);
  const columnLabels = input.insight_column_labels ?? null;
  const custom_label_stats = buildCustomLabelStats(input.insightRows, columnLabels);
  const hooks_digest = buildHooksDigest(hooks, hookRows);

  const executive_summary = buildExecutiveSummary(allPatterns, media_lanes, research_stats);

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    executive_summary,
    winning_patterns: winningPatterns,
    hooks,
    emotions,
    visual_patterns: visualPatterns,
    opportunities,
    avoid,
    media_lanes,
    deep_dive: buildDeepDive(allPatterns, input.insightRows, columnLabels),
    research_stats,
    custom_label_stats: custom_label_stats.length ? custom_label_stats : undefined,
    insight_column_labels: columnLabels ?? undefined,
    hooks_digest,
    total_patterns: allPatterns.length,
    rows_analyzed: input.insightRows.length,
  };
}
