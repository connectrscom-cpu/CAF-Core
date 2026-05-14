import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { ensureProject } from "../repositories/core.js";
import {
  countEvidenceRowsForReadModel,
  getEvidenceRowByIdForProject,
  getInputsEvidenceImport,
  listEvidenceRowsForReadModel,
  listInputsEvidenceImports,
} from "../repositories/inputs-evidence.js";
import { foldMediaPreviews, listEvidenceMediaPreviewForRows } from "../repositories/inputs-evidence-media.js";
import {
  getEvidenceRowInsightById,
  listEvidenceRowInsightsEnriched,
  listInsightRefsForEvidenceRow,
  type EvidenceRowInsightEnrichedRow,
} from "../repositories/inputs-evidence-insights.js";
import type { EvidenceInsightTier } from "../repositories/inputs-evidence-insights.js";
import { getSignalPackById, getSignalPackByRunId } from "../repositories/signal-packs.js";
import { buildEvidenceReadModelItem, evidenceKindFromPlatformQuery } from "../domain/evidence-read-model.js";
import { buildInsightReadModelItem, type InsightReadType } from "../domain/insights-read-model.js";
import { deriveEvidenceDisplayKind, deriveEvidencePostFormat } from "../services/inputs-evidence-post-format.js";
import { postUrlForTopPerformerPreview } from "../services/inputs-top-performer-qualifying-preview.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TIER_VALUES = ["broad_llm", "top_performer_deep", "top_performer_video", "top_performer_carousel"] as const;

function isEvidenceInsightTier(s: string): s is EvidenceInsightTier {
  return (TIER_VALUES as readonly string[]).includes(s);
}

async function resolveImportAndPackContext(
  db: Pool,
  projectId: string,
  opts: { import_id?: string | null; signal_pack_id?: string | null; run_id?: string | null }
): Promise<{ import_id: string; signal_pack_id: string | null; run_id: string | null } | null> {
  if (opts.import_id && UUID_RE.test(opts.import_id)) {
    const imp = await getInputsEvidenceImport(db, projectId, opts.import_id);
    if (!imp) return null;
    return { import_id: opts.import_id, signal_pack_id: null, run_id: null };
  }
  if (opts.signal_pack_id && UUID_RE.test(opts.signal_pack_id)) {
    const pack = await getSignalPackById(db, opts.signal_pack_id);
    if (!pack || pack.project_id !== projectId) return null;
    const imp = pack.source_inputs_import_id;
    if (!imp || !UUID_RE.test(imp)) return null;
    return { import_id: imp, signal_pack_id: pack.id, run_id: pack.run_id ?? null };
  }
  if (opts.run_id?.trim()) {
    const pack = await getSignalPackByRunId(db, projectId, opts.run_id.trim());
    if (!pack) return null;
    const imp = pack.source_inputs_import_id;
    if (!imp || !UUID_RE.test(imp)) return null;
    return { import_id: imp, signal_pack_id: pack.id, run_id: opts.run_id.trim() };
  }
  return null;
}

const listQuery = z.object({
  import_id: z.string().optional(),
  signal_pack_id: z.string().optional(),
  run_id: z.string().optional(),
  platform: z.string().max(40).optional(),
  source_type: z.string().max(80).optional(),
  format: z.string().max(40).optional(),
  min_engagement: z.coerce.number().min(0).max(1).optional(),
  search: z.string().max(400).optional(),
  sort: z.enum(["rating_desc", "rating_asc", "created_desc", "created_asc"]).default("rating_desc"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const insightsListQuery = listQuery.extend({
  type: z.string().max(40).optional(),
  analysis_tier: z.string().max(40).optional(),
  confidence_min: z.coerce.number().min(0).max(1).optional(),
});

async function evidenceListHandler(
  db: Pool,
  projectSlug: string,
  queryIn: z.infer<typeof listQuery> & { signal_pack_id?: string; run_id?: string }
) {
  const project = await ensureProject(db, projectSlug);
  const qd = queryIn;
  const hasScope = !!(qd.import_id || qd.signal_pack_id || qd.run_id);
  if (!hasScope) {
    const imports = await listInputsEvidenceImports(db, project.id, 40, 0);
    return {
      ok: true as const,
      project_slug: projectSlug,
      imports: imports.map((i) => ({
        id: i.id,
        upload_filename: i.upload_filename,
        created_at: i.created_at,
        stored_row_count: i.stored_row_count,
      })),
      hint: "Pass import_id, signal_pack_id, or run_id to list normalized evidence items.",
    };
  }
  const ctx = await resolveImportAndPackContext(db, project.id, {
    import_id: qd.import_id ?? null,
    signal_pack_id: qd.signal_pack_id ?? null,
    run_id: qd.run_id ?? null,
  });
  if (!ctx) {
    return { ok: false as const, status: 404, error: "not_found", message: "Could not resolve evidence import" };
  }

  const kindFilter = qd.source_type?.trim() || evidenceKindFromPlatformQuery(qd.platform) || null;
  const minRating = qd.min_engagement ?? null;
  const rows = await listEvidenceRowsForReadModel(db, project.id, ctx.import_id, {
    evidence_kind: kindFilter,
    search: qd.search ?? null,
    min_rating: minRating,
    sort: qd.sort,
    limit: qd.limit,
    offset: qd.offset,
  });
  const fmtFilter = qd.format?.trim().toLowerCase() || null;
  const mediaRows = await listEvidenceMediaPreviewForRows(
    db,
    project.id,
    rows.map((r) => r.id)
  );
  const mediaMap = foldMediaPreviews(mediaRows);

  let items = rows.map((r) => {
    const m = mediaMap.get(r.id);
    return buildEvidenceReadModelItem({
      project_slug: projectSlug,
      inputs_import_id: ctx.import_id,
      signal_pack_id: ctx.signal_pack_id,
      run_id: ctx.run_id,
      id: r.id,
      evidence_kind: r.evidence_kind,
      payload_json: r.payload_json,
      created_at: r.created_at,
      rating_score: r.rating_score,
      thumbnail_url: m?.thumbnail ?? null,
      media_urls: m?.urls ?? [],
    });
  });
  if (fmtFilter) {
    items = items.filter((it) => it.format === fmtFilter);
  }
  const total = await countEvidenceRowsForReadModel(db, project.id, ctx.import_id, {
    evidence_kind: kindFilter,
    search: qd.search ?? null,
    min_rating: minRating,
  });

  return {
    ok: true as const,
    project_slug: projectSlug,
    inputs_import_id: ctx.import_id,
    signal_pack_id: ctx.signal_pack_id,
    run_id: ctx.run_id,
    items,
    total,
    limit: qd.limit,
    offset: qd.offset,
    note:
      fmtFilter && fmtFilter.length > 0
        ? "format filter is applied after fetch; totals reflect SQL filters only."
        : undefined,
  };
}

export function registerEvidenceInsightsReadRoutes(app: FastifyInstance, deps: { db: Pool }) {
  const { db } = deps;

  app.get("/v1/evidence/:project_slug", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const query = listQuery.safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.code(400).send({ ok: false, error: "bad_request" });
    }
    const out = await evidenceListHandler(db, params.data.project_slug, query.data);
    if (!out.ok) return reply.code(out.status).send({ ok: false, error: out.error, message: out.message });
    return out;
  });

  app.get("/v1/evidence/:project_slug/signal-pack/:signal_pack_id", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), signal_pack_id: z.string() }).safeParse(request.params);
    const query = listQuery.omit({ signal_pack_id: true }).safeParse(request.query);
    if (!params.success || !UUID_RE.test(params.data.signal_pack_id) || !query.success) {
      return reply.code(400).send({ ok: false, error: "bad_request" });
    }
    const out = await evidenceListHandler(db, params.data.project_slug, {
      ...query.data,
      signal_pack_id: params.data.signal_pack_id,
    });
    if (!out.ok) return reply.code(out.status).send({ ok: false, error: out.error, message: out.message });
    return out;
  });

  app.get("/v1/evidence/:project_slug/run/:run_id", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), run_id: z.string() }).safeParse(request.params);
    const query = listQuery.omit({ run_id: true }).safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.code(400).send({ ok: false, error: "bad_request" });
    }
    const out = await evidenceListHandler(db, params.data.project_slug, {
      ...query.data,
      run_id: params.data.run_id,
    });
    if (!out.ok) return reply.code(out.status).send({ ok: false, error: out.error, message: out.message });
    return out;
  });

  app.get("/v1/evidence/:project_slug/:evidence_row_id", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), evidence_row_id: z.string() })
      .safeParse(request.params);
    if (!params.success || !/^\d+$/.test(params.data.evidence_row_id)) {
      return reply.code(400).send({ ok: false, error: "bad_params" });
    }
    const project = await ensureProject(db, params.data.project_slug);
    const row = await getEvidenceRowByIdForProject(db, project.id, params.data.evidence_row_id);
    if (!row) return reply.code(404).send({ ok: false, error: "not_found" });

    const mediaRows = await listEvidenceMediaPreviewForRows(db, project.id, [row.id]);
    const mediaMap = foldMediaPreviews(mediaRows);
    const m = mediaMap.get(row.id);
    const item = buildEvidenceReadModelItem({
      project_slug: params.data.project_slug,
      inputs_import_id: row.import_id,
      signal_pack_id: null,
      run_id: null,
      id: row.id,
      evidence_kind: row.evidence_kind,
      payload_json: row.payload_json,
      created_at: row.created_at,
      rating_score: row.rating_score,
      thumbnail_url: m?.thumbnail ?? null,
      media_urls: m?.urls ?? [],
    });
    const insight_refs = await listInsightRefsForEvidenceRow(db, project.id, row.id);
    return { ok: true, item, insight_refs };
  });

  async function insightsListHandler(
    projectSlug: string,
    queryIn: z.infer<typeof insightsListQuery> & { signal_pack_id?: string; run_id?: string }
  ) {
    const project = await ensureProject(db, projectSlug);
    const qd = queryIn;
    const hasScope = !!(qd.import_id || qd.signal_pack_id || qd.run_id);
    if (!hasScope) {
      const imports = await listInputsEvidenceImports(db, project.id, 40, 0);
      return {
        ok: true as const,
        project_slug: projectSlug,
        imports: imports.map((i) => ({
          id: i.id,
          upload_filename: i.upload_filename,
          created_at: i.created_at,
          stored_row_count: i.stored_row_count,
        })),
        hint: "Pass import_id, signal_pack_id, or run_id to list normalized insights.",
      };
    }
    const ctx = await resolveImportAndPackContext(db, project.id, {
      import_id: qd.import_id ?? null,
      signal_pack_id: qd.signal_pack_id ?? null,
      run_id: qd.run_id ?? null,
    });
    if (!ctx) {
      return { ok: false as const, status: 404, error: "not_found", message: "Could not resolve evidence import" };
    }

    const kindFilter = qd.source_type?.trim() || evidenceKindFromPlatformQuery(qd.platform) || null;
    let tier: EvidenceInsightTier | null = null;
    if (qd.analysis_tier && isEvidenceInsightTier(qd.analysis_tier)) tier = qd.analysis_tier;

    const raw = (await listEvidenceRowInsightsEnriched(db, project.id, ctx.import_id, {
      tier,
      evidence_kind: kindFilter,
      limit: qd.limit,
      offset: qd.offset,
    })) as Array<EvidenceRowInsightEnrichedRow & { evidence_payload_json?: unknown }>;

    const typeFilter = (qd.type?.trim() as InsightReadType | undefined) ?? undefined;
    const confMin = qd.confidence_min;
    const search = qd.search?.trim().toLowerCase() || null;

    let items = raw.map((r) => {
      const payload =
        r.evidence_payload_json != null && typeof r.evidence_payload_json === "object" && !Array.isArray(r.evidence_payload_json)
          ? (r.evidence_payload_json as Record<string, unknown>)
          : {};
      const evidenceFmt = deriveEvidencePostFormat(r.evidence_kind, payload);
      return buildInsightReadModelItem({
        project_slug: projectSlug,
        inputs_import_id: ctx.import_id,
        signal_pack_id: ctx.signal_pack_id,
        run_id: ctx.run_id,
        evidence_post_format: evidenceFmt,
        id: r.id,
        insights_id: r.insights_id,
        analysis_tier: r.analysis_tier,
        source_evidence_row_id: r.source_evidence_row_id,
        evidence_kind: r.evidence_kind,
        pre_llm_score: r.pre_llm_score,
        why_it_worked: r.why_it_worked,
        primary_emotion: r.primary_emotion,
        secondary_emotion: r.secondary_emotion,
        hook_type: r.hook_type,
        hook_text: r.hook_text,
        hashtags: r.hashtags,
        caption_style: r.caption_style,
        cta_type: r.cta_type,
        custom_label_1: r.custom_label_1,
        custom_label_2: r.custom_label_2,
        custom_label_3: r.custom_label_3,
        aesthetic_analysis_json: r.aesthetic_analysis_json,
        risk_flags_json: r.risk_flags_json,
        created_at: r.created_at,
      });
    });

    if (typeFilter) {
      items = items.filter((it) => it.type === typeFilter);
    }
    if (confMin != null && Number.isFinite(confMin)) {
      items = items.filter((it) => it.confidence != null && it.confidence >= confMin);
    }
    if (search) {
      items = items.filter(
        (it) =>
          it.title.toLowerCase().includes(search) ||
          it.summary.toLowerCase().includes(search) ||
          (it.creative_implication && it.creative_implication.toLowerCase().includes(search))
      );
    }

    return {
      ok: true as const,
      project_slug: projectSlug,
      inputs_import_id: ctx.import_id,
      signal_pack_id: ctx.signal_pack_id,
      run_id: ctx.run_id,
      items,
      limit: qd.limit,
      offset: qd.offset,
      note:
        typeFilter || confMin != null || search
          ? "type, confidence_min, and search filters apply after SQL pagination; widen limit if results look sparse."
          : undefined,
    };
  }

  app.get("/v1/insights/:project_slug", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const query = insightsListQuery.safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.code(400).send({ ok: false, error: "bad_request" });
    }
    const out = await insightsListHandler(params.data.project_slug, query.data);
    if (!out.ok) return reply.code(out.status).send({ ok: false, error: out.error, message: out.message });
    return out;
  });

  app.get("/v1/insights/:project_slug/signal-pack/:signal_pack_id", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), signal_pack_id: z.string() }).safeParse(request.params);
    const query = insightsListQuery.omit({ signal_pack_id: true }).safeParse(request.query);
    if (!params.success || !UUID_RE.test(params.data.signal_pack_id) || !query.success) {
      return reply.code(400).send({ ok: false, error: "bad_request" });
    }
    const out = await insightsListHandler(params.data.project_slug, {
      ...query.data,
      signal_pack_id: params.data.signal_pack_id,
    });
    if (!out.ok) return reply.code(out.status).send({ ok: false, error: out.error, message: out.message });
    return out;
  });

  app.get("/v1/insights/:project_slug/run/:run_id", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), run_id: z.string() }).safeParse(request.params);
    const query = insightsListQuery.omit({ run_id: true }).safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.code(400).send({ ok: false, error: "bad_request" });
    }
    const out = await insightsListHandler(params.data.project_slug, {
      ...query.data,
      run_id: params.data.run_id,
    });
    if (!out.ok) return reply.code(out.status).send({ ok: false, error: out.error, message: out.message });
    return out;
  });

  app.get("/v1/insights/:project_slug/:insight_row_id", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), insight_row_id: z.string() })
      .safeParse(request.params);
    if (!params.success || !/^\d+$/.test(params.data.insight_row_id)) {
      return reply.code(400).send({ ok: false, error: "bad_params" });
    }
    const project = await ensureProject(db, params.data.project_slug);
    const r = await getEvidenceRowInsightById(db, project.id, params.data.insight_row_id);
    if (!r) return reply.code(404).send({ ok: false, error: "not_found" });

    const payload =
      r.evidence_payload_json != null && typeof r.evidence_payload_json === "object" && !Array.isArray(r.evidence_payload_json)
        ? (r.evidence_payload_json as Record<string, unknown>)
        : {};
    const evidenceFmt = deriveEvidencePostFormat(r.evidence_kind, payload);
    const item = buildInsightReadModelItem({
      project_slug: params.data.project_slug,
      inputs_import_id: r.inputs_import_id,
      signal_pack_id: null,
      run_id: null,
      evidence_post_format: evidenceFmt,
      id: r.id,
      insights_id: r.insights_id,
      analysis_tier: r.analysis_tier,
      source_evidence_row_id: r.source_evidence_row_id,
      evidence_kind: r.evidence_kind,
      pre_llm_score: r.pre_llm_score,
      why_it_worked: r.why_it_worked,
      primary_emotion: r.primary_emotion,
      secondary_emotion: r.secondary_emotion,
      hook_type: r.hook_type,
      hook_text: r.hook_text,
      hashtags: r.hashtags,
      caption_style: r.caption_style,
      cta_type: r.cta_type,
      custom_label_1: r.custom_label_1,
      custom_label_2: r.custom_label_2,
      custom_label_3: r.custom_label_3,
      aesthetic_analysis_json: r.aesthetic_analysis_json,
      risk_flags_json: r.risk_flags_json,
      created_at: r.created_at,
    });

    const evidence_post_url = postUrlForTopPerformerPreview(r.evidence_kind, payload);
    const evidence_display_kind = deriveEvidenceDisplayKind(r.evidence_kind, payload);
    return {
      ok: true,
      item,
      evidence_context: {
        evidence_row_id: r.source_evidence_row_id,
        evidence_kind: r.evidence_kind,
        evidence_display_kind,
        evidence_post_url,
      },
      debug_raw_llm_json: r.raw_llm_json,
    };
  });
}
