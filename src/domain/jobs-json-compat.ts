/**
 * Dual-read / dual-write helpers for jobs-centric JSON fields.
 * Prefer `jobs_json` / `planned_jobs_json`; fall back to legacy columns during migration.
 */

export function readSignalPackJobsJson(pack: Record<string, unknown> | null | undefined): unknown[] {
  if (!pack) return [];
  const jobs = pack.jobs_json;
  if (Array.isArray(jobs) && jobs.length > 0) return jobs;
  const ideas = pack.ideas_json;
  if (Array.isArray(ideas)) return ideas;
  return [];
}

export function readSignalPackJobsCount(pack: Record<string, unknown> | null | undefined): number {
  return readSignalPackJobsJson(pack).length;
}

export function readRunPlannedJobsJson(run: Record<string, unknown> | null | undefined): unknown[] {
  if (!run) return [];
  const planned = run.planned_jobs_json;
  if (Array.isArray(planned) && planned.length > 0) return planned;
  const legacy = run.candidates_json;
  if (Array.isArray(legacy)) return legacy;
  return [];
}

/** Write both canonical and legacy signal-pack job columns. */
export function dualWriteSignalPackJobs(jobs: unknown[]): { jobs_json: unknown[]; ideas_json: unknown[] } {
  const rows = Array.isArray(jobs) ? jobs : [];
  return { jobs_json: rows, ideas_json: rows };
}

/** Write both canonical and legacy run planned-job columns. */
export function dualWriteRunPlannedJobs(rows: unknown[]): { planned_jobs_json: unknown[]; candidates_json: unknown[] } {
  const list = Array.isArray(rows) ? rows : [];
  return { planned_jobs_json: list, candidates_json: list };
}

/** API shape: primary jobs fields with optional legacy when requested. */
export function signalPackJobsApiFields(
  pack: Record<string, unknown>,
  includeLegacy: boolean
): Record<string, unknown> {
  const jobs = readSignalPackJobsJson(pack);
  const out: Record<string, unknown> = {
    ...pack,
    jobs_json: jobs,
    jobs_count: jobs.length,
  };
  if (includeLegacy) {
    out._legacy = {
      ideas_json: pack.ideas_json,
      ideas_count: Array.isArray(pack.ideas_json) ? pack.ideas_json.length : 0,
      overall_candidates_json: pack.overall_candidates_json,
    };
  }
  return out;
}

export function runPlannedJobsApiFields(
  run: Record<string, unknown>,
  includeLegacy: boolean
): Record<string, unknown> {
  const planned = readRunPlannedJobsJson(run);
  const out: Record<string, unknown> = {
    ...run,
    planned_jobs_json: planned,
    planned_jobs_count: planned.length,
  };
  if (includeLegacy) {
    out._legacy = { candidates_json: run.candidates_json };
  }
  return out;
}
