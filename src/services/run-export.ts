import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";
import type { RunRow } from "../repositories/runs.js";
import type { SignalPackRow } from "../repositories/signal-packs.js";
import type { RunOutputReviewRow } from "../repositories/run-output-reviews.js";

type Json = Record<string, unknown>;

function recordVal(v: unknown): Json | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Json;
}

function strVal(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function safeJsonBlock(v: unknown): string {
  try {
    return JSON.stringify(v ?? null, null, 2);
  } catch {
    return JSON.stringify({ error: "unstringifiable_value" }, null, 2);
  }
}

function mdEscapeInline(s: string): string {
  // Minimal: avoid backticks breaking inline code.
  return s.replace(/`/g, "'");
}

export type RunExportFormat = "md" | "json";

export interface RunExportData {
  project_id: string;
  project_slug: string;
  generated_at: string;
  run: RunRow;
  signal_pack: SignalPackRow | null;
  run_output_review: RunOutputReviewRow | null;
  jobs: Array<{
    job: Record<string, unknown>;
    assets: Record<string, unknown>[];
    job_drafts: Record<string, unknown>[];
    transitions: Record<string, unknown>[];
    editorial_reviews: Record<string, unknown>[];
    diagnostic_audits: Record<string, unknown>[];
    auto_validation_results: Record<string, unknown>[];
    api_call_audit: Record<string, unknown>[];
    validation_events: Record<string, unknown>[];
    publication_placements: Record<string, unknown>[];
    performance_metrics: Record<string, unknown>[];
    llm_approval_reviews: Record<string, unknown>[];
  }>;
}

export async function buildRunExportData(
  db: Pool,
  opts: { project_id: string; project_slug: string; run_id: string }
): Promise<RunExportData | null> {
  const run = await qOne<RunRow>(
    db,
    `SELECT * FROM caf_core.runs WHERE project_id = $1 AND run_id = $2`,
    [opts.project_id, opts.run_id]
  );
  if (!run) return null;

  const signal_pack = run.signal_pack_id
    ? await qOne<SignalPackRow>(db, `SELECT * FROM caf_core.signal_packs WHERE id = $1::uuid`, [run.signal_pack_id])
    : null;

  const run_output_review = await qOne<RunOutputReviewRow>(
    db,
    `SELECT * FROM caf_core.run_output_reviews WHERE project_id = $1 AND run_id = $2`,
    [opts.project_id, run.run_id]
  );

  const jobs = await q<Record<string, unknown>>(
    db,
    `SELECT * FROM caf_core.content_jobs WHERE project_id = $1 AND run_id = $2 ORDER BY task_id ASC`,
    [opts.project_id, run.run_id]
  );
  const taskIds = jobs.map((j) => strVal(j.task_id).trim()).filter(Boolean);

  // Fetch all child tables in bulk (avoid N+1).
  const [
    assets,
    drafts,
    transitions,
    editorial,
    audits,
    autoVal,
    apiAudit,
    validationEvents,
    placements,
    metrics,
    llmReviews,
  ] = await Promise.all([
    taskIds.length
      ? q<Record<string, unknown>>(
          db,
          `SELECT * FROM caf_core.assets WHERE project_id = $1 AND task_id = ANY($2::text[]) ORDER BY task_id, position ASC NULLS LAST, created_at ASC`,
          [opts.project_id, taskIds]
        )
      : Promise.resolve([]),
    // Prefer run_id for drafts (captures rework variants tied to run); keep task_id ordering for grouping.
    q<Record<string, unknown>>(
      db,
      `SELECT * FROM caf_core.job_drafts WHERE project_id = $1 AND run_id = $2 ORDER BY task_id, created_at ASC`,
      [opts.project_id, run.run_id]
    ),
    taskIds.length
      ? q<Record<string, unknown>>(
          db,
          `SELECT * FROM caf_core.job_state_transitions WHERE project_id = $1 AND task_id = ANY($2::text[]) ORDER BY task_id, created_at ASC`,
          [opts.project_id, taskIds]
        )
      : Promise.resolve([]),
    taskIds.length
      ? q<Record<string, unknown>>(
          db,
          `SELECT * FROM caf_core.editorial_reviews WHERE project_id = $1 AND task_id = ANY($2::text[]) ORDER BY task_id, created_at ASC`,
          [opts.project_id, taskIds]
        )
      : Promise.resolve([]),
    taskIds.length
      ? q<Record<string, unknown>>(
          db,
          `SELECT * FROM caf_core.diagnostic_audits WHERE project_id = $1 AND task_id = ANY($2::text[]) ORDER BY task_id, created_at ASC`,
          [opts.project_id, taskIds]
        )
      : Promise.resolve([]),
    taskIds.length
      ? q<Record<string, unknown>>(
          db,
          `SELECT * FROM caf_core.auto_validation_results WHERE project_id = $1 AND task_id = ANY($2::text[]) ORDER BY task_id, created_at ASC`,
          [opts.project_id, taskIds]
        )
      : Promise.resolve([]),
    taskIds.length
      ? q<Record<string, unknown>>(
          db,
          `SELECT * FROM caf_core.api_call_audit WHERE project_id = $1 AND task_id = ANY($2::text[]) ORDER BY task_id, created_at ASC`,
          [opts.project_id, taskIds]
        )
      : Promise.resolve([]),
    taskIds.length
      ? q<Record<string, unknown>>(
          db,
          `SELECT * FROM caf_core.validation_events WHERE project_id = $1 AND task_id = ANY($2::text[]) ORDER BY task_id, created_at ASC`,
          [opts.project_id, taskIds]
        )
      : Promise.resolve([]),
    taskIds.length
      ? q<Record<string, unknown>>(
          db,
          `SELECT * FROM caf_core.publication_placements WHERE project_id = $1 AND task_id = ANY($2::text[]) ORDER BY task_id, created_at ASC`,
          [opts.project_id, taskIds]
        )
      : Promise.resolve([]),
    taskIds.length
      ? q<Record<string, unknown>>(
          db,
          `SELECT * FROM caf_core.performance_metrics WHERE project_id = $1 AND task_id = ANY($2::text[]) ORDER BY task_id, created_at ASC`,
          [opts.project_id, taskIds]
        )
      : Promise.resolve([]),
    taskIds.length
      ? q<Record<string, unknown>>(
          db,
          `SELECT * FROM caf_core.llm_approval_reviews WHERE project_id = $1 AND task_id = ANY($2::text[]) ORDER BY task_id, created_at ASC`,
          [opts.project_id, taskIds]
        )
      : Promise.resolve([]),
  ]);

  const groupByTask = (rows: Record<string, unknown>[]) => {
    const m = new Map<string, Record<string, unknown>[]>();
    for (const r of rows) {
      const tid = strVal(r.task_id).trim();
      if (!tid) continue;
      const arr = m.get(tid) ?? [];
      arr.push(r);
      m.set(tid, arr);
    }
    return m;
  };

  const assetsBy = groupByTask(assets);
  const draftsBy = groupByTask(drafts);
  const transitionsBy = groupByTask(transitions);
  const editorialBy = groupByTask(editorial);
  const auditsBy = groupByTask(audits);
  const autoValBy = groupByTask(autoVal);
  const apiAuditBy = groupByTask(apiAudit);
  const validationEventsBy = groupByTask(validationEvents);
  const placementsBy = groupByTask(placements);
  const metricsBy = groupByTask(metrics);
  const llmReviewsBy = groupByTask(llmReviews);

  const outJobs: RunExportData["jobs"] = jobs.map((job) => {
    const tid = strVal(job.task_id).trim();
    return {
      job,
      assets: assetsBy.get(tid) ?? [],
      job_drafts: draftsBy.get(tid) ?? [],
      transitions: transitionsBy.get(tid) ?? [],
      editorial_reviews: editorialBy.get(tid) ?? [],
      diagnostic_audits: auditsBy.get(tid) ?? [],
      auto_validation_results: autoValBy.get(tid) ?? [],
      api_call_audit: apiAuditBy.get(tid) ?? [],
      validation_events: validationEventsBy.get(tid) ?? [],
      publication_placements: placementsBy.get(tid) ?? [],
      performance_metrics: metricsBy.get(tid) ?? [],
      llm_approval_reviews: llmReviewsBy.get(tid) ?? [],
    };
  });

  return {
    project_id: opts.project_id,
    project_slug: opts.project_slug,
    generated_at: new Date().toISOString(),
    run,
    signal_pack,
    run_output_review,
    jobs: outJobs,
  };
}

export function renderRunExportMarkdown(data: RunExportData): string {
  const run = data.run;

  const displayName = (() => {
    const md = recordVal(run.metadata_json) ?? {};
    const v = md.display_name;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  })();

  const title = `CAF Run Export — ${displayName ? `${displayName} (${run.run_id})` : run.run_id}`;

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`- **project_slug**: \`${mdEscapeInline(data.project_slug)}\``);
  lines.push(`- **project_id**: \`${mdEscapeInline(data.project_id)}\``);
  lines.push(`- **run_id**: \`${mdEscapeInline(run.run_id)}\``);
  lines.push(`- **status**: \`${mdEscapeInline(run.status)}\``);
  lines.push(`- **started_at**: ${run.started_at ? `\`${mdEscapeInline(run.started_at)}\`` : "—"}`);
  lines.push(`- **completed_at**: ${run.completed_at ? `\`${mdEscapeInline(run.completed_at)}\`` : "—"}`);
  lines.push(`- **signal_pack_id**: ${run.signal_pack_id ? `\`${mdEscapeInline(run.signal_pack_id)}\`` : "—"}`);
  lines.push(`- **jobs_completed / total_jobs**: ${run.jobs_completed} / ${run.total_jobs}`);
  lines.push(`- **export_generated_at**: \`${mdEscapeInline(data.generated_at)}\``);
  lines.push("");

  lines.push("## Run context snapshots");
  lines.push("");
  lines.push("### `runs.context_snapshot_json`");
  lines.push("");
  lines.push("```json");
  lines.push(safeJsonBlock((run as unknown as { context_snapshot_json?: unknown }).context_snapshot_json ?? null));
  lines.push("```");
  lines.push("");
  lines.push("### `runs.prompt_versions_snapshot`");
  lines.push("");
  lines.push("```json");
  lines.push(safeJsonBlock((run as unknown as { prompt_versions_snapshot?: unknown }).prompt_versions_snapshot ?? null));
  lines.push("```");
  lines.push("");
  lines.push("### `runs.plan_summary_json`");
  lines.push("");
  lines.push("```json");
  lines.push(safeJsonBlock((run as unknown as { plan_summary_json?: unknown }).plan_summary_json ?? null));
  lines.push("```");
  lines.push("");
  lines.push("### `runs.candidates_json` (materialized planner rows)");
  lines.push("");
  lines.push("```json");
  lines.push(safeJsonBlock((run as unknown as { candidates_json?: unknown }).candidates_json ?? null));
  lines.push("```");
  lines.push("");

  lines.push("## Signal pack (if linked)");
  lines.push("");
  lines.push("```json");
  lines.push(safeJsonBlock(data.signal_pack));
  lines.push("```");
  lines.push("");

  lines.push("## Run output review (human notes)");
  lines.push("");
  if (data.run_output_review?.body?.trim()) {
    lines.push(`- **validator**: ${data.run_output_review.validator ? `\`${mdEscapeInline(data.run_output_review.validator)}\`` : "—"}`);
    lines.push(`- **updated_at**: \`${mdEscapeInline(data.run_output_review.updated_at)}\``);
    lines.push("");
    lines.push("```text");
    lines.push(data.run_output_review.body);
    lines.push("```");
  } else {
    lines.push("_No run_output_review saved._");
  }
  lines.push("");

  lines.push("## Jobs summary");
  lines.push("");
  lines.push("Each job section below includes the full row and all stage evidence we have (drafts, transitions, audits, assets, review decisions, etc.).");
  lines.push("");

  for (const j of data.jobs) {
    const job = j.job;
    const tid = strVal(job.task_id).trim() || "(missing task_id)";
    const flow = strVal(job.flow_type).trim() || "—";
    const platform = strVal(job.platform).trim() || "—";
    const status = strVal(job.status).trim() || "—";
    const qc = strVal(job.qc_status).trim() || "—";
    const route = strVal(job.recommended_route).trim() || "—";
    const score = job.pre_gen_score != null ? String(job.pre_gen_score) : "—";

    lines.push(`## Job \`${mdEscapeInline(tid)}\``);
    lines.push("");
    lines.push(`- **flow_type / platform**: \`${mdEscapeInline(flow)}\` / \`${mdEscapeInline(platform)}\``);
    lines.push(`- **status / qc_status / route / pre_gen_score**: \`${mdEscapeInline(status)}\` / \`${mdEscapeInline(qc)}\` / \`${mdEscapeInline(route)}\` / \`${mdEscapeInline(score)}\``);
    lines.push(`- **assets**: ${j.assets.length} · **drafts**: ${j.job_drafts.length} · **transitions**: ${j.transitions.length} · **editorial_reviews**: ${j.editorial_reviews.length} · **diagnostic_audits**: ${j.diagnostic_audits.length}`);
    lines.push(`- **api_call_audit**: ${j.api_call_audit.length} · **validation_events**: ${j.validation_events.length} · **publication_placements**: ${j.publication_placements.length} · **performance_metrics**: ${j.performance_metrics.length}`);
    lines.push("");

    const gp = recordVal(job.generation_payload) ?? {};
    const contract = {
      schema_version: gp.schema_version,
      signal_pack_id: gp.signal_pack_id,
      candidate_data: gp.candidate_data,
      prompt_binding: gp.prompt_binding,
      prompt_id: gp.prompt_id,
      prompt_version_id: gp.prompt_version_id,
      prompt_version_label: gp.prompt_version_label,
      variation_index: gp.variation_index,
      generation_reason: gp.generation_reason,
      qc_result: gp.qc_result,
      generated_output: gp.generated_output,
    };

    lines.push("### Stage contract highlights (`generation_payload`)");
    lines.push("");
    lines.push("```json");
    lines.push(safeJsonBlock(contract));
    lines.push("```");
    lines.push("");

    lines.push("### Full `content_jobs` row");
    lines.push("");
    lines.push("```json");
    lines.push(safeJsonBlock(job));
    lines.push("```");
    lines.push("");

    lines.push("### Assets");
    lines.push("");
    lines.push("```json");
    lines.push(safeJsonBlock(j.assets));
    lines.push("```");
    lines.push("");

    lines.push("### Job drafts (`job_drafts`)");
    lines.push("");
    lines.push("```json");
    lines.push(safeJsonBlock(j.job_drafts));
    lines.push("```");
    lines.push("");

    lines.push("### State transitions (`job_state_transitions`)");
    lines.push("");
    lines.push("```json");
    lines.push(safeJsonBlock(j.transitions));
    lines.push("```");
    lines.push("");

    lines.push("### Editorial reviews (`editorial_reviews`)");
    lines.push("");
    lines.push("```json");
    lines.push(safeJsonBlock(j.editorial_reviews));
    lines.push("```");
    lines.push("");

    lines.push("### Diagnostic audits (`diagnostic_audits`)");
    lines.push("");
    lines.push("```json");
    lines.push(safeJsonBlock(j.diagnostic_audits));
    lines.push("```");
    lines.push("");

    lines.push("### Auto validation results (`auto_validation_results`)");
    lines.push("");
    lines.push("```json");
    lines.push(safeJsonBlock(j.auto_validation_results));
    lines.push("```");
    lines.push("");

    lines.push("### API call audit (`api_call_audit`)");
    lines.push("");
    lines.push("```json");
    lines.push(safeJsonBlock(j.api_call_audit));
    lines.push("```");
    lines.push("");

    lines.push("### Validation events (`validation_events`)");
    lines.push("");
    lines.push("```json");
    lines.push(safeJsonBlock(j.validation_events));
    lines.push("```");
    lines.push("");

    lines.push("### Publication placements (`publication_placements`)");
    lines.push("");
    lines.push("```json");
    lines.push(safeJsonBlock(j.publication_placements));
    lines.push("```");
    lines.push("");

    lines.push("### Performance metrics (`performance_metrics`)");
    lines.push("");
    lines.push("```json");
    lines.push(safeJsonBlock(j.performance_metrics));
    lines.push("```");
    lines.push("");

    lines.push("### LLM approval reviews (`llm_approval_reviews`)");
    lines.push("");
    lines.push("```json");
    lines.push(safeJsonBlock(j.llm_approval_reviews));
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

