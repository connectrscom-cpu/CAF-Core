/**
 * Ready-to-publish (RTP) aggregates from editorial_reviews + content_jobs.
 * RTP (strict): APPROVED with no overrides_json keys (empty object).
 */
import type { Pool } from "pg";
import { q } from "../db/queries.js";
import { isCarouselFlow, isVideoFlow } from "../decision_engine/flow-kind.js";

export interface RtpBucket {
  flow_bucket: "carousel" | "video" | "other";
  reviewed: number;
  rtp_strict: number;
  approved: number;
  needs_edit: number;
  rejected: number;
}

export interface RtpTotals {
  reviewed: number;
  rtp_strict: number;
  approved: number;
  needs_edit: number;
  rejected: number;
}

function bucketForFlow(flowType: string | null): "carousel" | "video" | "other" {
  if (!flowType) return "other";
  if (isCarouselFlow(flowType)) return "carousel";
  if (isVideoFlow(flowType)) return "video";
  return "other";
}

function overridesEmpty(o: unknown): boolean {
  if (o == null) return true;
  if (typeof o !== "object" || Array.isArray(o)) return false;
  return Object.keys(o as Record<string, unknown>).length === 0;
}

export async function getRtpSummaryForProject(
  db: Pool,
  projectId: string,
  windowDays: number
): Promise<{ window_days: number; buckets: RtpBucket[]; totals: RtpTotals }> {
  const rows = await q<{ flow_type: string | null; decision: string | null; overrides_json: unknown }>(
    db,
    `SELECT j.flow_type, r.decision, r.overrides_json
       FROM caf_core.editorial_reviews r
       INNER JOIN caf_core.content_jobs j
         ON j.task_id = r.task_id AND j.project_id = r.project_id
      WHERE r.project_id = $1
        AND r.submitted_at IS NOT NULL
        AND r.submitted_at > now() - make_interval(days => $2)`,
    [projectId, windowDays]
  );

  const map = new Map<string, RtpBucket>();
  const ensure = (key: "carousel" | "video" | "other"): RtpBucket => {
    let b = map.get(key);
    if (!b) {
      b = { flow_bucket: key, reviewed: 0, rtp_strict: 0, approved: 0, needs_edit: 0, rejected: 0 };
      map.set(key, b);
    }
    return b;
  };

  const totals: RtpTotals = {
    reviewed: 0,
    rtp_strict: 0,
    approved: 0,
    needs_edit: 0,
    rejected: 0,
  };

  for (const row of rows) {
    const bucket = bucketForFlow(row.flow_type);
    const b = ensure(bucket);
    b.reviewed += 1;
    totals.reviewed += 1;
    const d = (row.decision ?? "").toUpperCase();
    if (d === "APPROVED") {
      b.approved += 1;
      totals.approved += 1;
      if (overridesEmpty(row.overrides_json)) {
        b.rtp_strict += 1;
        totals.rtp_strict += 1;
      }
    } else if (d === "NEEDS_EDIT") {
      b.needs_edit += 1;
      totals.needs_edit += 1;
    } else if (d === "REJECTED") {
      b.rejected += 1;
      totals.rejected += 1;
    }
  }

  const buckets = [ensure("carousel"), ensure("video"), ensure("other")];
  return { window_days: windowDays, buckets, totals };
}
