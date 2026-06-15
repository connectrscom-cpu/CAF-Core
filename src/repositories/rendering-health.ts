import type { Pool } from "pg";

export interface RenderingJobRow {
  task_id: string;
  run_id: string;
  flow_type: string;
  status: string;
  project_slug: string;
  updated_at: string;
  render_state: Record<string, unknown> | null;
}

export interface RenderingRunRow {
  run_id: string;
  project_slug: string;
  status: string;
  updated_at: string;
}

export async function listRenderingJobs(db: Pool, limit = 80): Promise<RenderingJobRow[]> {
  const { rows } = await db.query<RenderingJobRow>(
    `SELECT c.task_id, c.run_id, c.flow_type, c.status, p.slug AS project_slug,
            c.updated_at::text AS updated_at,
            c.render_state AS render_state
       FROM caf_core.content_jobs c
       JOIN caf_core.projects p ON p.id = c.project_id
      WHERE c.status = 'RENDERING'
      ORDER BY c.updated_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    ...r,
    render_state:
      r.render_state && typeof r.render_state === "object" && !Array.isArray(r.render_state)
        ? (r.render_state as Record<string, unknown>)
        : null,
  }));
}

export async function listRenderingRuns(db: Pool, limit = 40): Promise<RenderingRunRow[]> {
  const { rows } = await db.query<RenderingRunRow>(
    `SELECT r.run_id, p.slug AS project_slug, r.status, r.updated_at::text AS updated_at
       FROM caf_core.runs r
       JOIN caf_core.projects p ON p.id = r.project_id
      WHERE r.status = 'RENDERING'
      ORDER BY r.updated_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}
