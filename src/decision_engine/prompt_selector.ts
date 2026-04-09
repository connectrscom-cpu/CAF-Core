import type { Pool } from "pg";
import { getPromptVersionById, listPromptVersionsForFlow } from "../repositories/core.js";

export interface SelectedPrompt {
  prompt_version_id: string;
  prompt_id: string;
  version: string;
}

export type PromptSource = "project" | "template" | "override" | "none";

export interface PromptOverride {
  prompt_version_id?: string;
  prompt_id?: string;
  template_only?: boolean;
}

export interface ResolvedPrompt {
  selected: SelectedPrompt | null;
  source: PromptSource;
  reason: string;
}

/**
 * Pick prompt version: prefer `active`, then highest version string among `test`.
 * Respects max_active_prompt_versions by taking first N — here we pick single winner.
 */
export async function selectPromptVersion(
  db: Pool,
  projectId: string,
  flowType: string,
  maxActive: number | null
): Promise<SelectedPrompt | null> {
  const rows = await listPromptVersionsForFlow(db, projectId, flowType, ["active", "test"]);
  if (rows.length === 0) return null;
  const active = rows.filter((r) => r.status === "active");
  const pool = active.length > 0 ? active : rows;
  const limit = maxActive && maxActive > 0 ? Math.min(maxActive, pool.length) : pool.length;
  const chosen = pool.slice(0, Math.max(1, limit))[0];
  if (!chosen) return null;
  return {
    prompt_version_id: chosen.id,
    prompt_id: chosen.prompt_id,
    version: chosen.version,
  };
}

function pickFromPool(
  rows: Array<{ id: string; prompt_id: string; version: string; status: string }>,
  maxActive: number | null
): SelectedPrompt | null {
  if (rows.length === 0) return null;
  const active = rows.filter((r) => r.status === "active");
  const pool = active.length > 0 ? active : rows;
  const limit = maxActive && maxActive > 0 ? Math.min(maxActive, pool.length) : pool.length;
  const chosen = pool.slice(0, Math.max(1, limit))[0];
  if (!chosen) return null;
  return { prompt_version_id: chosen.id, prompt_id: chosen.prompt_id, version: chosen.version };
}

async function pickByPromptId(
  db: Pool,
  projectId: string,
  flowType: string,
  promptId: string,
  maxActive: number | null
): Promise<SelectedPrompt | null> {
  const rows = await listPromptVersionsForFlow(db, projectId, flowType, ["active", "test"]);
  const filtered = rows.filter((r) => r.prompt_id === promptId);
  return pickFromPool(filtered, maxActive);
}

export async function resolvePromptVersion(
  db: Pool,
  params: {
    projectId: string;
    cafGlobalProjectId: string;
    flowType: string;
    maxActive: number | null;
    override?: PromptOverride;
  }
): Promise<ResolvedPrompt> {
  const o = params.override ?? {};

  if (o.prompt_version_id) {
    const row = await getPromptVersionById(db, o.prompt_version_id);
    if (
      row &&
      row.flow_type === params.flowType &&
      (row.project_id === params.projectId || row.project_id === params.cafGlobalProjectId)
    ) {
      return {
        selected: { prompt_version_id: row.id, prompt_id: row.prompt_id, version: row.version },
        source: "override",
        reason: "override.prompt_version_id matched",
      };
    }
    return { selected: null, source: "none", reason: "override.prompt_version_id not found/allowed" };
  }

  if (o.prompt_id) {
    const fromProject = await pickByPromptId(db, params.projectId, params.flowType, o.prompt_id, params.maxActive);
    if (fromProject) return { selected: fromProject, source: "override", reason: "override.prompt_id chose project version" };
    const fromTemplate = await pickByPromptId(db, params.cafGlobalProjectId, params.flowType, o.prompt_id, params.maxActive);
    if (fromTemplate) return { selected: fromTemplate, source: "override", reason: "override.prompt_id chose template version" };
    return { selected: null, source: "none", reason: "override.prompt_id not found in project/template" };
  }

  if (!o.template_only) {
    const proj = await selectPromptVersion(db, params.projectId, params.flowType, params.maxActive);
    if (proj) return { selected: proj, source: "project", reason: "default selected project prompt version" };
  }

  const tmpl = await selectPromptVersion(db, params.cafGlobalProjectId, params.flowType, params.maxActive);
  if (tmpl) return { selected: tmpl, source: "template", reason: "fallback selected caf-global template prompt version" };

  return { selected: null, source: "none", reason: "no prompt versions available for flow_type" };
}
