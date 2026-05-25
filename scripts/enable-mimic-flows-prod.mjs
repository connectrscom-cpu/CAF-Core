/**
 * One-off: enable top-performer mimic flows + plan caps on a project (production SSH).
 * Usage on Fly: cd /app && node /tmp/enable-mimic-flows-prod.mjs [PROJECT_SLUG]
 */
import pg from "pg";
import { getProjectBySlug, getConstraints, upsertConstraints, mergeConstraintUpdate } from "./dist/repositories/core.js";
import {
  ensureMissingAllowedFlowRowsForPlanning,
  ensureMimicFlowsEnabledWhenCapped,
  listAllowedFlowTypes,
} from "./dist/repositories/project-config.js";
import {
  FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
  FLOW_TOP_PERFORMER_MIMIC_IMAGE,
} from "./dist/domain/top-performer-mimic-flow-types.js";
import { DEFAULT_TOP_PERFORMER_MIMIC_FLOW_PLAN_CAP } from "./dist/decision_engine/default-plan-caps.js";

const slug = (process.argv[2] || "SNS").trim();
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const project = await getProjectBySlug(db, slug);
  if (!project) throw new Error(`Project not found: ${slug}`);

  const inserted = await ensureMissingAllowedFlowRowsForPlanning(db, project.id);
  const existing = await getConstraints(db, project.id);
  const existingCaps = existing?.max_jobs_per_flow_type ?? {};
  const mergedCaps = {
    ...existingCaps,
    [FLOW_TOP_PERFORMER_MIMIC_CAROUSEL]:
      existingCaps[FLOW_TOP_PERFORMER_MIMIC_CAROUSEL] ?? DEFAULT_TOP_PERFORMER_MIMIC_FLOW_PLAN_CAP,
    [FLOW_TOP_PERFORMER_MIMIC_IMAGE]:
      existingCaps[FLOW_TOP_PERFORMER_MIMIC_IMAGE] ?? DEFAULT_TOP_PERFORMER_MIMIC_FLOW_PLAN_CAP,
  };

  await upsertConstraints(
    db,
    project.id,
    mergeConstraintUpdate(existing, { max_jobs_per_flow_type: mergedCaps })
  );
  await ensureMimicFlowsEnabledWhenCapped(db, project.id);

  const rows = await listAllowedFlowTypes(db, project.id);
  const mimic = rows
    .filter((r) => r.flow_type.includes("MIMIC"))
    .map((r) => ({ flow_type: r.flow_type, enabled: r.enabled, priority: r.priority_weight }));

  console.log(
    JSON.stringify(
      {
        ok: true,
        project: slug,
        inserted_flow_rows: inserted,
        mimic_caps: {
          [FLOW_TOP_PERFORMER_MIMIC_CAROUSEL]: mergedCaps[FLOW_TOP_PERFORMER_MIMIC_CAROUSEL],
          [FLOW_TOP_PERFORMER_MIMIC_IMAGE]: mergedCaps[FLOW_TOP_PERFORMER_MIMIC_IMAGE],
        },
        mimic_flows: mimic,
      },
      null,
      2
    )
  );
} finally {
  await db.end();
}
