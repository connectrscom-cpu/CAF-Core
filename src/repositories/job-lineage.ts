import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";
import type { IdeaRow } from "./ideas.js";
import type { EvidenceRowInsightRow } from "./inputs-evidence-insights.js";
import type { SignalPackRow } from "./signal-packs.js";
import type { RunRow } from "./runs.js";

export interface JobLineageResult {
  task_id: string;
  project_id: string;
  run_id: string | null;
  signal_pack_id: string | null;
  idea_id: string | null;
  candidate_id: string | null;
  candidate_data: Record<string, unknown> | null;
  run: RunRow | null;
  signal_pack: SignalPackRow | null;
  idea: IdeaRow | null;
  grounding: Array<{
    insight_row: EvidenceRowInsightRow;
    evidence_row: {
      id: string;
      import_id: string;
      evidence_kind: string;
      payload_json: Record<string, unknown>;
      rating_score: string | null;
      pre_llm_score: string | null;
    } | null;
  }>;
}

function recordVal(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function strVal(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function pickIdeaIdFromCandidateData(candidateData: Record<string, unknown> | null): string | null {
  if (!candidateData) return null;
  const ideaId = strVal(candidateData.idea_id).trim();
  if (ideaId) return ideaId;
  const candidateId = strVal(candidateData.candidate_id).trim();
  if (candidateId) return candidateId;
  return null;
}

/**
 * Resolve the upstream lineage for a content job so operators can inspect the full structure:
 * job → run → signal_pack → idea → grounding insights → evidence rows.
 *
 * This intentionally returns verbose nested JSON for inspection; use list endpoints for operator tables.
 */
export async function getJobLineageByTaskId(
  db: Pool,
  projectId: string,
  taskId: string
): Promise<JobLineageResult | null> {
  const tid = taskId.trim();
  if (!tid) return null;

  const job = await qOne<{
    task_id: string;
    project_id: string;
    run_id: string | null;
    candidate_id: string | null;
    generation_payload: Record<string, unknown> | null;
  }>(db, `SELECT task_id, project_id::text, run_id, candidate_id, generation_payload FROM caf_core.content_jobs WHERE project_id = $1 AND task_id = $2`, [
    projectId,
    tid,
  ]);
  if (!job) return null;

  const gp = recordVal(job.generation_payload) ?? {};
  const signalPackId = strVal(gp.signal_pack_id).trim() || null;
  const candidateData = recordVal(gp.candidate_data) ?? null;
  const ideaId = pickIdeaIdFromCandidateData(candidateData);

  const run = job.run_id
    ? await qOne<RunRow>(
        db,
        `SELECT * FROM caf_core.runs WHERE project_id = $1 AND run_id = $2`,
        [projectId, job.run_id]
      )
    : null;

  const signalPack = signalPackId
    ? await qOne<SignalPackRow>(db, `SELECT * FROM caf_core.signal_packs WHERE id = $1::uuid`, [signalPackId])
    : null;

  const idea = ideaId
    ? await qOne<IdeaRow>(db, `SELECT * FROM caf_core.ideas WHERE project_id = $1 AND idea_id = $2`, [projectId, ideaId])
    : null;

  const grounding: JobLineageResult["grounding"] = [];
  if (idea?.id) {
    const rows = await q<
      EvidenceRowInsightRow & {
        evidence_row_id: string;
        evidence_import_id: string;
        evidence_kind: string;
        evidence_payload_json: Record<string, unknown>;
        evidence_rating_score: string | null;
        evidence_pre_llm_score: string | null;
      }
    >(
      db,
      `SELECT
         i.id::text,
         i.project_id::text,
         i.inputs_import_id::text,
         i.source_evidence_row_id::text,
         i.insights_id,
         i.analysis_tier,
         i.pre_llm_score::text,
         i.llm_model,
         i.why_it_worked,
         i.primary_emotion,
         i.secondary_emotion,
         i.hook_type,
         i.custom_label_1,
         i.custom_label_2,
         i.custom_label_3,
         i.cta_type,
         i.hashtags,
         i.caption_style,
         i.hook_text,
         i.risk_flags_json,
         i.aesthetic_analysis_json,
         i.raw_llm_json,
         i.created_at::text,
         i.updated_at::text,
         r.id::text AS evidence_row_id,
         r.import_id::text AS evidence_import_id,
         r.evidence_kind,
         r.payload_json AS evidence_payload_json,
         r.rating_score::text AS evidence_rating_score,
         r.pre_llm_score::text AS evidence_pre_llm_score
       FROM caf_core.idea_grounding_insights g
       JOIN caf_core.inputs_evidence_row_insights i
         ON i.id = g.insight_row_id
        AND i.project_id = g.project_id
       JOIN caf_core.inputs_evidence_rows r
         ON r.id = i.source_evidence_row_id
        AND r.import_id = i.inputs_import_id
        AND r.project_id = i.project_id
      WHERE g.project_id = $1 AND g.idea_id = $2::uuid
      ORDER BY i.updated_at DESC
      LIMIT 100`,
      [projectId, idea.id]
    );
    for (const r of rows) {
      const {
        evidence_row_id,
        evidence_import_id,
        evidence_kind,
        evidence_payload_json,
        evidence_rating_score,
        evidence_pre_llm_score,
        ...insight
      } = r;
      grounding.push({
        insight_row: insight,
        evidence_row: {
          id: evidence_row_id,
          import_id: evidence_import_id,
          evidence_kind,
          payload_json: evidence_payload_json ?? {},
          rating_score: evidence_rating_score,
          pre_llm_score: evidence_pre_llm_score,
        },
      });
    }
  }

  return {
    task_id: job.task_id,
    project_id: job.project_id,
    run_id: job.run_id,
    signal_pack_id: signalPackId,
    idea_id: ideaId,
    candidate_id: job.candidate_id,
    candidate_data: candidateData,
    run,
    signal_pack: signalPack,
    idea,
    grounding,
  };
}

