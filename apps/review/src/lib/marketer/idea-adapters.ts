import { humanizeFlowType } from "./language";
import { formatBriefDate, parsePackNotes } from "./research-notes";
import type { ContentIdea, HashtagInsight, IdeaStatus, ResearchBrief, TopPerformerRef } from "./types";
import { pickInspectionMediaPreviewUrl } from "./inspection-media";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strList(v: unknown, cap = 6): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(str).filter(Boolean).slice(0, cap);
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function priorityFromScore(score: number | null): ContentIdea["priority"] {
  if (score == null) return "medium";
  if (score >= 0.7) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}

function statusFromRaw(raw: unknown): IdeaStatus {
  const s = str(raw).toLowerCase();
  if (s === "selected") return "selected";
  if (s === "rejected") return "rejected";
  return "new";
}

const FORMAT_LABELS: Record<string, string> = {
  carousel: "Carousel",
  video: "Video",
  post: "Single post",
  thread: "Thread",
  slides: "Slides",
  script: "Video script",
};

function humanizeFormat(format: string, platform: string): string {
  const f = FORMAT_LABELS[format.toLowerCase()] ?? format;
  return platform ? `${f} · ${platform}` : f;
}

function resolveFlowType(row: Record<string, unknown>, format: string): { raw: string; label: string } {
  const explicit = str(row.target_flow_type) || str(row.flow_type);
  if (explicit) return { raw: explicit, label: humanizeFlowType(explicit) };
  const profile = str(row.execution_profile) || str(row.carousel_style) || str(row.video_style);
  if (profile) {
    const raw = profile;
    return { raw, label: profile.replace(/_/g, " ") };
  }
  if (format === "carousel") return { raw: "FLOW_CAROUSEL", label: "Carousel" };
  if (format === "video") return { raw: "FLOW_VIDEO", label: "Video" };
  return { raw: "FLOW_CONTENT", label: "Content" };
}

function contentLensOf(row: Record<string, unknown>): ContentIdea["contentLens"] {
  const lens = str(row.content_lens).toLowerCase();
  if (lens === "product" || lens === "niche") return lens;
  return null;
}

export function toContentIdea(row: Record<string, unknown>, index: number): ContentIdea {
  const score = num(row.idea_score) ?? num(row.confidence_score);
  const format = str(row.format);
  const platform = str(row.platform);
  const rationaleParts = [str(row.why_now), str(row.novelty_angle)].filter(Boolean);
  const flow = resolveFlowType(row, format);

  return {
    id: str(row.id) || `idea_${index}`,
    title: str(row.title) || "Untitled idea",
    concept: str(row.three_liner) || str(row.thesis),
    rationale: rationaleParts.join(" "),
    suggestedFormat: humanizeFormat(format, platform),
    format: format || "other",
    flowType: flow.label,
    targetFlowType: flow.raw,
    contentLens: contentLensOf(row),
    emotion: str(row.emotion) || str(row.emotional_angle) || null,
    platform,
    evidenceBasis: strList(row.grounding_insight_ids, 4),
    keyPoints: strList(row.key_points, 6),
    confidence: score,
    priority: priorityFromScore(score),
    status: statusFromRaw(row.status),
  };
}

export function parseIdeasFromPack(signalPack: Record<string, unknown> | null | undefined): ContentIdea[] {
  if (!signalPack) return [];
  const raw = signalPack.ideas_json;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r, i) => toContentIdea(r, i));
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

const TIER_TO_KIND: Record<string, TopPerformerRef["mimicKind"]> = {
  top_performer_deep: "image",
  top_performer_carousel: "replica",
  top_performer_video: "video",
};

export function parseTopPerformersFromPack(
  signalPack: Record<string, unknown> | null | undefined
): TopPerformerRef[] {
  if (!signalPack) return [];
  const derived = asRecord(signalPack.derived_globals_json);
  const vg = asRecord(derived?.visual_guidelines_pack_v1);
  const entries = asArray(vg?.entries);
  const out: TopPerformerRef[] = [];

  for (const raw of entries) {
    const entry = asRecord(raw);
    if (!entry) continue;
    const tier = str(entry.analysis_tier);
    let mimicKind = TIER_TO_KIND[tier];
    if (!mimicKind) continue;
    const insightsId = str(entry.insights_id);
    if (!insightsId) continue;

    const formatPattern = str(entry.format_pattern) || tier.replace(/_/g, " ");
    const title =
      str(entry.title) ||
      str(entry.caption_snippet) ||
      str(entry.hook_snippet) ||
      `Top performer · ${formatPattern}`;

    const whyHint = str(entry.why_mimic_hint) || str(entry.strategic_summary);
    if (whyHint && /why/i.test(whyHint)) mimicKind = "why_carousel";

    const platform = str(entry.platform) || str(entry.evidence_platform) || "Instagram";
    const postUrl = str(entry.evidence_post_url) || str(entry.post_url) || null;
    const im = asRecord(entry.inspection_media);
    const thumbnailUrl = pickInspectionMediaPreviewUrl(
      im
        ? {
            items: asArray(im.items).map((it) => {
              const o = asRecord(it);
              return o
                ? {
                    role: str(o.role),
                    public_url: str(o.public_url) || null,
                    vision_fetch_url: str(o.vision_fetch_url) || null,
                  }
                : null;
            }).filter((x): x is NonNullable<typeof x> => x != null),
          }
        : null
    );

    out.push({
      id: insightsId,
      insightsId,
      title,
      platform,
      format: formatPattern,
      mimicKind,
      renderLabel:
        mimicKind === "why_carousel"
          ? "Why mimic"
          : mimicKind === "replica"
            ? "Replica mimic"
            : mimicKind === "video"
              ? "Video mimic"
              : "Image mimic",
      detail:
        mimicKind === "why_carousel"
          ? "Recreates the strategic structure and argument — not a pixel-perfect copy."
          : mimicKind === "replica"
            ? "Closely follows the visual layout and style of the reference post."
            : str(entry.aesthetic_summary) || "High-performing reference from your research.",
      postUrl,
      thumbnailUrl,
    });
  }

  return out;
}

export function parseHashtagsFromPack(
  signalPack: Record<string, unknown> | null | undefined,
  limit = 20
): HashtagInsight[] {
  const derived = asRecord(signalPack?.derived_globals_json);
  const raw = asArray(derived?.hashtag_leaderboard_v1);
  const rowsScanned =
    typeof derived?.hashtag_leaderboard_rows_scanned === "number"
      ? derived.hashtag_leaderboard_rows_scanned
      : null;
  const out: HashtagInsight[] = [];
  for (const row of raw) {
    const r = asRecord(row);
    if (!r) continue;
    const hashtag = str(r.hashtag);
    if (!hashtag) continue;
    const count = Number(r.count) || 0;
    const weight = typeof r.weight === "number" ? r.weight : count;
    const sharePct =
      rowsScanned && rowsScanned > 0 ? Math.round((count / rowsScanned) * 1000) / 10 : null;
    out.push({
      hashtag: hashtag.startsWith("#") ? hashtag : `#${hashtag}`,
      count,
      avgScore: r.avg_rating_score == null ? null : Number(r.avg_rating_score),
      sharePct: r.avg_rating_score == null ? sharePct : null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function toResearchBrief(
  row: {
    id: string;
    created_at?: string;
    source_window?: string | null;
    notes?: string | null;
    ideas_count?: number;
    upload_filename?: string | null;
    derived_globals_json?: unknown;
    source_inputs_import_id?: string | null;
  },
  brandDisplayName?: string
): ResearchBrief {
  const derived = asRecord(row.derived_globals_json);
  const importId =
    str(derived?.from_inputs_evidence_import_id) ||
    str(row.source_inputs_import_id) ||
    null;
  const created = str(row.created_at);
  const { plain, marketer } = parsePackNotes(row.notes);

  const meta = asRecord(derived?.marketer_research_meta);
  const platformsFromDerived = asArray(derived?.platforms_found)
    .map((p) => str(p))
    .filter(Boolean);
  const platforms =
    marketer.platforms?.length
      ? marketer.platforms
      : asArray(meta?.platforms)
          .map((p) => str(p))
          .filter(Boolean).length
        ? asArray(meta?.platforms).map((p) => str(p)).filter(Boolean)
        : platformsFromDerived;

  const postMaxAgeDays =
    marketer.postMaxAgeDays ??
    (typeof meta?.postMaxAgeDays === "number" ? meta.postMaxAgeDays : null);

  const autoTitle =
    str(row.upload_filename)?.replace(/\.[^.]+$/, "") ||
    (created ? `Research ${created.slice(0, 10)}` : "Market research");
  const userTitle = marketer.marketer_title || plain || autoTitle;
  const brand = (brandDisplayName ?? "").trim() || "Brand";
  const label = `${brand} · ${userTitle} · ${formatBriefDate(created || new Date().toISOString())}`;

  return {
    id: row.id,
    createdAt: created,
    label,
    ideasCount: row.ideas_count ?? 0,
    sourceWindow: row.source_window ?? null,
    notes: row.notes ?? null,
    importId,
    userTitle,
    platforms,
    postMaxAgeDays,
  };
}

export { humanizeFlowType };
