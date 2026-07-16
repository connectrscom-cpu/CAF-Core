/**
 * Apply marketer content-route selections to allowed_flow_types + processing profile quotas.
 */
import type { Pool } from "pg";
import {
  CONTENT_ROUTE_LANES,
  allContentRouteFlowTypes,
  defaultEnabledContentRouteIds,
  flowTypesEnabledForLanes,
  patchCriteriaWithContentRoutes,
  readEnabledContentRouteIdsFromCriteria,
  enabledLaneIdsFromFlowTypes,
} from "../domain/content-routes.js";
import {
  getInputsProcessingProfile,
  upsertInputsProcessingProfile,
  defaultCriteriaJson,
} from "../repositories/inputs-processing-profile.js";
import {
  listAllowedFlowTypes,
  upsertAllowedFlowType,
  type AllowedFlowTypeRow,
} from "../repositories/project-config.js";

export interface ContentRoutesState {
  lanes: Array<{
    id: string;
    label: string;
    description: string;
    group: string;
    advanced: boolean;
    default_enabled: boolean;
    flow_types: string[];
    enabled: boolean;
  }>;
  enabled_lane_ids: string[];
  managed_flow_types: string[];
}

function rowDefaults(flowType: string, existing: AllowedFlowTypeRow | undefined, enabled: boolean) {
  return {
    flow_type: flowType,
    enabled,
    default_variation_count: existing?.default_variation_count ?? 1,
    requires_signal_pack: existing?.requires_signal_pack ?? true,
    requires_learning_context: existing?.requires_learning_context ?? true,
    allowed_platforms: existing?.allowed_platforms ?? null,
    output_schema_version: existing?.output_schema_version ?? null,
    qc_checklist_version: existing?.qc_checklist_version ?? null,
    prompt_template_id: existing?.prompt_template_id ?? null,
    priority_weight: existing?.priority_weight ?? 10,
    notes: existing?.notes ?? null,
    heygen_mode: existing?.heygen_mode ?? null,
  };
}

export async function getContentRoutesState(db: Pool, projectId: string): Promise<ContentRoutesState> {
  const [flows, profile] = await Promise.all([
    listAllowedFlowTypes(db, projectId),
    getInputsProcessingProfile(db, projectId),
  ]);
  const enabledFlows = new Set(flows.filter((f) => f.enabled).map((f) => f.flow_type));
  const fromCriteria = readEnabledContentRouteIdsFromCriteria(profile?.criteria_json);
  const enabledLaneIds =
    fromCriteria && fromCriteria.length > 0
      ? fromCriteria
      : enabledLaneIdsFromFlowTypes(enabledFlows).length > 0
        ? enabledLaneIdsFromFlowTypes(enabledFlows)
        : defaultEnabledContentRouteIds();

  const enabledSet = new Set(enabledLaneIds);

  return {
    lanes: CONTENT_ROUTE_LANES.map((lane) => ({
      id: lane.id,
      label: lane.label,
      description: lane.description,
      group: lane.group,
      advanced: !!lane.advanced,
      default_enabled: !!lane.default_enabled,
      flow_types: [...lane.flow_types],
      enabled: enabledSet.has(lane.id),
    })),
    enabled_lane_ids: enabledLaneIds,
    managed_flow_types: allContentRouteFlowTypes(),
  };
}

export async function applyContentRoutes(
  db: Pool,
  projectId: string,
  enabledLaneIds: string[],
  opts?: { target_idea_count?: number }
): Promise<ContentRoutesState> {
  const validIds = new Set(CONTENT_ROUTE_LANES.map((l) => l.id));
  const lanes = [...new Set(enabledLaneIds.map((id) => id.trim()).filter((id) => validIds.has(id)))];
  const shouldEnable = flowTypesEnabledForLanes(lanes);
  const managed = allContentRouteFlowTypes();
  const existing = await listAllowedFlowTypes(db, projectId);
  const byType = new Map(existing.map((r) => [r.flow_type, r]));

  for (const flowType of managed) {
    const row = byType.get(flowType);
    const enabled = shouldEnable.has(flowType);
    await upsertAllowedFlowType(db, projectId, rowDefaults(flowType, row, enabled));
  }

  const profile = await getInputsProcessingProfile(db, projectId);
  const target =
    opts?.target_idea_count ??
    profile?.max_ideas_in_signal_pack ??
    35;
  const criteria = patchCriteriaWithContentRoutes(
    profile?.criteria_json ?? defaultCriteriaJson(),
    lanes,
    target
  );
  await upsertInputsProcessingProfile(db, projectId, { criteria_json: criteria });

  return getContentRoutesState(db, projectId);
}
