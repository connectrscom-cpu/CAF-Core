import type { Pool } from "pg";
import { ensureProject } from "../repositories/core.js";
import { insertSignalPack } from "../repositories/signal-packs.js";
import { createRun } from "../repositories/runs.js";
import { trimRunDisplayName } from "../lib/run-display-name.js";
import { materializeRunCandidates } from "./run-candidates-materialize.js";
import type { AppConfig } from "../config.js";
import { getInputsIdeaListById, listInputsIdeasForList } from "../repositories/inputs-idea-lists.js";
import { getSignalPackById } from "../repositories/signal-packs.js";
import { computeHashtagLeaderboardForEvidenceImport } from "./hashtag-leaderboard.js";

export type IdeaFormatLimitBucket = "carousel" | "video" | "post" | "thread" | "other";

export type IdeaFormatLimits = Partial<Record<IdeaFormatLimitBucket, number>>;

function bucketForIdeaFormat(fmt: string): IdeaFormatLimitBucket {
  const f = String(fmt || "")
    .toLowerCase()
    .trim();
  if (f === "carousel") return "carousel";
  if (f === "video") return "video";
  if (f === "post") return "post";
  if (f === "thread") return "thread";
  return "other";
}

function ideaConfidence(obj: Record<string, unknown>): number {
  const c = obj.confidence_score ?? obj.idea_score;
  if (typeof c === "number" && !Number.isNaN(c)) return c;
  const p = parseFloat(String(c ?? ""));
  return Number.isNaN(p) ? 0 : p;
}

/**
 * When `limits` is null/empty, returns all ideas unchanged.
 * Otherwise: for each format bucket, `limit` undefined = all ideas in bucket; 0 = none; N>0 = top N by confidence.
 */
export function selectIdeasByFormatLimits(ideas: unknown[], limits: IdeaFormatLimits | null | undefined): unknown[] {
  if (!limits || Object.keys(limits).length === 0) return ideas;
  const buckets: Record<IdeaFormatLimitBucket, Array<{ obj: Record<string, unknown>; conf: number }>> = {
    carousel: [],
    video: [],
    post: [],
    thread: [],
    other: [],
  };
  for (const raw of ideas) {
    const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const b = bucketForIdeaFormat(String(obj.format ?? ""));
    buckets[b].push({ obj, conf: ideaConfidence(obj) });
  }
  const order = (a: { conf: number }, b: { conf: number }) => b.conf - a.conf;
  const orderBuckets: IdeaFormatLimitBucket[] = ["carousel", "video", "post", "thread", "other"];
  const out: unknown[] = [];
  for (const bk of orderBuckets) {
    const max = limits[bk];
    const arr = buckets[bk].slice().sort(order);
    if (max === undefined) {
      for (const x of arr) out.push(x.obj);
    } else if (max === 0) {
      continue;
    } else {
      for (const x of arr.slice(0, max)) out.push(x.obj);
    }
  }
  return out;
}

export async function buildSignalPackFromIdeaList(
  db: Pool,
  config: AppConfig,
  projectSlug: string,
  ideaListId: string,
  opts?: {
    run_name?: string | null;
    notes?: string | null;
    format_limits?: IdeaFormatLimits | null;
  }
): Promise<{ signal_pack_id: string; run_id: string; idea_list_id: string; ideas_count: number }> {
  const project = await ensureProject(db, projectSlug);
  const list = await getInputsIdeaListById(db, ideaListId);
  if (!list) throw new Error(`Idea list not found: ${ideaListId}`);
  if (list.project_id !== project.id) throw new Error("Idea list does not belong to this project");

  const ideas = await listInputsIdeasForList(db, project.id, ideaListId, 500, 0);
  let ideasJson = ideas.map((r) => r.idea_json) as unknown[];
  const before = ideasJson.length;
  if (opts?.format_limits && Object.keys(opts.format_limits).length > 0) {
    ideasJson = selectIdeasByFormatLimits(ideasJson, opts.format_limits);
  }
  if (ideasJson.length === 0) {
    throw new Error(
      "No ideas left after applying format limits. Leave limits blank to include all ideas, or increase caps."
    );
  }

  const runId = `SIG_IDEAS_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}_${Date.now().toString(36).toUpperCase()}`;
  const hashtagStats = await computeHashtagLeaderboardForEvidenceImport(db, project.id, list.inputs_import_id, {
    max_rows: 5000,
    limit: 120,
  });
  const pack = await insertSignalPack(db, {
    run_id: runId,
    project_id: project.id,
    source_window: null,
    overall_candidates_json: [],
    ideas_json: ideasJson,
    selected_idea_ids_json: [],
    source_inputs_idea_list_id: ideaListId,
    derived_globals_json: {
      from_inputs_idea_list_id: ideaListId,
      from_inputs_import_id: list.inputs_import_id,
      ideas_count: ideasJson.length,
      ideas_count_before_format_limits: before,
      hashtag_leaderboard_v1: hashtagStats.leaderboard,
      hashtag_leaderboard_rows_scanned: hashtagStats.rows_scanned,
      format_limits: opts?.format_limits && Object.keys(opts.format_limits).length > 0 ? opts.format_limits : undefined,
      created_at: new Date().toISOString(),
    },
    notes: opts?.notes ?? `Built from inputs idea list ${ideaListId}`,
    upload_filename: `from_idea_list:${ideaListId}`,
    source_inputs_import_id: list.inputs_import_id,
  });

  const displayName = trimRunDisplayName(opts?.run_name ?? null);
  const run = await createRun(db, {
    run_id: runId,
    project_id: project.id,
    source_window: null,
    signal_pack_id: pack.id,
    metadata_json: {
      ...(displayName ? { display_name: displayName } : {}),
      from_inputs_idea_list_id: ideaListId,
      ideas_count: ideasJson.length,
    },
  });

  const packRow = await getSignalPackById(db, pack.id);
  if (packRow) {
    // Use canonical pack ideas_json for planner rows.
    await materializeRunCandidates(db, config, project.id, run, packRow, { mode: "from_pack_ideas_all" });
  }

  return {
    signal_pack_id: pack.id,
    run_id: run.run_id,
    idea_list_id: ideaListId,
    ideas_count: ideasJson.length,
  };
}

