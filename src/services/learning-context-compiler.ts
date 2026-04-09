import type { Pool } from "pg";
import { listLearningRulesMerged } from "../repositories/learning.js";
import { getGlobalLearningProjectId } from "../repositories/learning-global.js";

export interface CompiledLearning {
  global_context: string;
  project_context: string;
  merged_guidance: string;
  applied_rule_ids: string[];
}

function isGenerationRule(row: Record<string, unknown>): boolean {
  const fam = String(row.rule_family ?? "");
  const action = String(row.action_type ?? "");
  return (
    fam === "generation" ||
    /GENERATION|GUIDANCE|HINT/i.test(action)
  );
}

function matchesScope(row: Record<string, unknown>, flowType: string | null, platform: string | null): boolean {
  const sf = row.scope_flow_type as string | null | undefined;
  const sp = row.scope_platform as string | null | undefined;
  if (sf && flowType) {
    const pat = sf.includes("*")
      ? new RegExp(`^${sf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*")}$`, "i")
      : new RegExp(`^${sf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    if (!pat.test(flowType)) return false;
  }
  if (sp && platform && sp.toLowerCase() !== platform.toLowerCase()) return false;
  return true;
}

function guidanceText(payload: Record<string, unknown>): string {
  const v =
    payload.guidance ?? payload.hint ?? payload.text ?? payload.message ?? payload.summary;
  if (typeof v === "string" && v.trim()) return v.trim();
  return "";
}

export async function compileLearningContexts(
  db: Pool,
  projectId: string,
  flowType: string | null,
  platform: string | null
): Promise<CompiledLearning> {
  const globalId = await getGlobalLearningProjectId(db);
  const rules = await listLearningRulesMerged(db, projectId, globalId);
  const active = rules.filter((r) => String(r.status) === "active" && isGenerationRule(r));
  const scoped = active.filter((r) => matchesScope(r, flowType, platform));

  const parts: string[] = [];
  const ids: string[] = [];
  const globalLines: string[] = [];
  const projectLines: string[] = [];

  for (const r of scoped) {
    const rid = String(r.rule_id ?? "");
    if (rid) ids.push(rid);
    const payload = (r.action_payload as Record<string, unknown>) ?? {};
    const text = guidanceText(payload);
    if (!text) continue;
    parts.push(text);
    const slug = String(r.storage_project_slug ?? "");
    if (slug === "caf-global") globalLines.push(text);
    else projectLines.push(text);
  }

  return {
    global_context: globalLines.join("\n\n"),
    project_context: projectLines.join("\n\n"),
    merged_guidance: parts.join("\n\n"),
    applied_rule_ids: ids,
  };
}
