import type { Pool } from "pg";
import {
  getEvidenceRowInsightByInsightsId,
  pickSourceVideoUrlFromStoredInspectionMedia,
} from "../repositories/inputs-evidence-insights.js";
import { getJobLineageByTaskId } from "../repositories/job-lineage.js";
import {
  findVisualGuidelinePackEntry,
  groundingInsightIdsFromCandidate,
} from "../domain/mimic-job-grounding.js";
import {
  isTopPerformerCarouselGroundedRow,
  isTopPerformerVideoGroundedRow,
} from "../domain/top-performer-grounding.js";

export interface TopPerformerReviewReference {
  kind: "video" | "carousel" | "image";
  insights_id: string | null;
  hook_text_preview: string | null;
  format_pattern: string | null;
  /** Archived source video for top_performer_video mimic / grounded jobs. */
  source_video_url: string | null;
  /** Frame / slide URLs for side-by-side review (carousel + video frames). */
  reference_frame_urls: string[];
}

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pickFrameUrl(item: Record<string, unknown>): string {
  for (const key of ["vision_fetch_url", "public_url", "preview_url", "source_url"]) {
    const u = String(item[key] ?? "").trim();
    if (u) return u;
  }
  return "";
}

function frameUrlsFromStoredInspection(stored: unknown, limit = 24): string[] {
  const rec = asRec(stored);
  const items = Array.isArray(rec?.items) ? rec!.items : [];
  const out: string[] = [];
  for (const raw of items) {
    const item = asRec(raw);
    if (!item || item.ok === false) continue;
    const role = String(item.role ?? "").trim();
    if (role === "source_video") continue;
    const url = pickFrameUrl(item);
    if (url) out.push(url);
    if (out.length >= limit) break;
  }
  return out;
}

function inspectionMediaFromGuidelineEntry(entry: Record<string, unknown> | null): unknown {
  if (!entry) return null;
  return entry.stored_inspection_media_json ?? entry.inspection_media ?? null;
}

export async function resolveTopPerformerReviewReference(
  db: Pool,
  projectId: string,
  job: {
    task_id: string;
    flow_type: string | null;
    generation_payload: Record<string, unknown>;
  }
): Promise<TopPerformerReviewReference | null> {
  const gp = job.generation_payload ?? {};
  const candidate = asRec(gp.candidate_data);
  const mimicKind = String(candidate?.mimic_kind ?? "").trim().toLowerCase();
  const manualMimic = candidate?.manual_mimic_pick === true;

  const lineage = await getJobLineageByTaskId(db, projectId, job.task_id);
  const derivedGlobals = asRec(lineage?.signal_pack?.derived_globals_json);

  const insightIds = groundingInsightIdsFromCandidate(candidate);
  const isVideoGrounded =
    manualMimic && mimicKind === "video"
      ? true
      : isTopPerformerVideoGroundedRow(candidate ?? {}, derivedGlobals);
  const isCarouselGrounded =
    manualMimic && mimicKind === "carousel"
      ? true
      : isTopPerformerCarouselGroundedRow(candidate ?? {}, derivedGlobals);

  if (!isVideoGrounded && !isCarouselGrounded && !manualMimic && insightIds.length === 0) {
    const mimicV1 = asRec(gp.mimic_v1);
    if (!mimicV1?.reference_items) return null;
  }

  let insightsId = insightIds[0] ?? null;
  if (!insightsId && candidate) {
    const cid = String(candidate.candidate_id ?? candidate.idea_id ?? "").trim();
    const m = cid.match(/\bins_[a-zA-Z0-9]+(?:_[0-9]+(?:_[a-z]+)?)?/);
    if (m?.[0]) insightsId = m[0];
  }

  let hook: string | null = null;
  let formatPattern: string | null = null;
  let sourceVideo: string | null = null;
  let frames: string[] = [];

  const packEntry = findVisualGuidelinePackEntry(derivedGlobals, insightIds);
  if (packEntry) {
    const resolvedId = String(packEntry.insights_id ?? "").trim();
    if (resolvedId) insightsId = resolvedId;
    hook = String(packEntry.hook_text_preview ?? "").trim() || null;
    formatPattern = String(packEntry.format_pattern ?? "").trim() || null;
    const stored = inspectionMediaFromGuidelineEntry(packEntry);
    sourceVideo = pickSourceVideoUrlFromStoredInspectionMedia(stored);
    frames = frameUrlsFromStoredInspection(stored);
  }

  const lookupIds = [
    ...(packEntry ? [String(packEntry.insights_id ?? "").trim()] : []),
    ...insightIds,
  ].filter(Boolean);
  const seenLookup = new Set<string>();
  for (const lookupId of lookupIds) {
    if (!lookupId || seenLookup.has(lookupId)) continue;
    seenLookup.add(lookupId);
    const insightRow = await getEvidenceRowInsightByInsightsId(db, projectId, lookupId);
    if (!insightRow) continue;
    hook = hook || String(insightRow.hook_text ?? "").trim() || null;
    sourceVideo =
      sourceVideo || pickSourceVideoUrlFromStoredInspectionMedia(insightRow.stored_inspection_media_json);
    if (frames.length === 0) {
      frames = frameUrlsFromStoredInspection(insightRow.stored_inspection_media_json);
    }
    break;
  }

  const mimicV1 = asRec(gp.mimic_v1);
  if (mimicV1) {
    const refItems = Array.isArray(mimicV1.reference_items) ? mimicV1.reference_items : [];
    for (const raw of refItems) {
      const item = asRec(raw);
      if (!item) continue;
      const url = pickFrameUrl(item);
      if (url) frames.push(url);
    }
  }

  const kind: TopPerformerReviewReference["kind"] =
    sourceVideo || isVideoGrounded || mimicKind === "video"
      ? "video"
      : mimicKind === "image"
        ? "image"
        : "carousel";

  if (!sourceVideo && frames.length === 0 && !hook && !insightsId) return null;

  return {
    kind,
    insights_id: insightsId,
    hook_text_preview: hook,
    format_pattern: formatPattern,
    source_video_url: sourceVideo,
    reference_frame_urls: [...new Set(frames)].slice(0, 24),
  };
}
