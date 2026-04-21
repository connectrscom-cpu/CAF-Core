import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { ensureProject } from "../repositories/core.js";
import { tryInsertApiCallAudit } from "../repositories/api-call-audit.js";
import {
  getInputsEvidenceImport,
  insertInputsEvidenceImport,
  insertInputsEvidenceRowsBatch,
  listInputsEvidenceImports,
  listInputsEvidenceRows,
  sheetRowCountsForImport,
} from "../repositories/inputs-evidence.js";
import { parseInputsSnsWorkbookBuffer } from "../services/inputs-sns-workbook-parser.js";
import { computeInputHealth, flagSparseEvidenceRows, persistImportHealth } from "../services/input-health.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BATCH = 250;

export function registerInputsEvidenceRoutes(app: FastifyInstance, deps: { db: Pool }) {
  const { db } = deps;

  /**
   * POST /v1/inputs-evidence/upload
   * Multipart: `file` (xlsx), `project_slug`, optional `notes`.
   */
  app.post("/v1/inputs-evidence/upload", async (request, reply) => {
    const parts = request.parts();
    let fileBuffer: Buffer | null = null;
    let fileName: string | null = null;
    let projectSlug: string | null = null;
    let notes: string | null = null;

    for await (const part of parts) {
      if (part.type === "file") {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(chunk);
        }
        fileBuffer = Buffer.concat(chunks);
        fileName = part.filename;
      } else {
        if (part.fieldname === "project_slug") projectSlug = part.value as string;
        else if (part.fieldname === "notes") notes = part.value as string;
      }
    }

    if (!fileBuffer || !projectSlug?.trim()) {
      return reply.code(400).send({ ok: false, error: "Missing file or project_slug" });
    }

    const project = await ensureProject(db, projectSlug.trim());

    let parsed;
    try {
      parsed = parseInputsSnsWorkbookBuffer(fileBuffer);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(400).send({ ok: false, error: "parse_failed", message: msg });
    }

    const sheet_stats_json = {
      version: 1,
      sheets: parsed.sheets,
      total_rows: parsed.rows.length,
      workbook_sha256: parsed.workbook_sha256,
    };

    const imp = await insertInputsEvidenceImport(db, {
      project_id: project.id,
      upload_filename: fileName,
      workbook_sha256: parsed.workbook_sha256,
      sheet_stats_json,
      notes: notes?.trim() || null,
    });

    for (let i = 0; i < parsed.rows.length; i += BATCH) {
      const slice = parsed.rows.slice(i, i + BATCH).map((r) => ({
        sheet_name: r.sheet_name,
        row_index: r.row_index,
        evidence_kind: r.evidence_kind,
        dedupe_key: r.dedupe_key,
        payload_json: r.payload_json,
      }));
      await insertInputsEvidenceRowsBatch(db, project.id, imp.id, slice);
    }

    const health = await computeInputHealth(db, project.id, imp.id, sheet_stats_json as Record<string, unknown>);
    await persistImportHealth(db, project.id, imp.id, health);
    await flagSparseEvidenceRows(db, project.id, imp.id);

    await tryInsertApiCallAudit(db, {
      projectId: project.id,
      runId: null,
      taskId: null,
      signalPackId: null,
      step: "inputs_evidence_xlsx_ingest",
      provider: "internal",
      model: null,
      ok: true,
      requestJson: {
        upload_filename: fileName,
        notes: notes ?? null,
        sheet_count: parsed.sheets.length,
        row_count: parsed.rows.length,
      },
      responseJson: { inputs_evidence_import_id: imp.id, sheets: parsed.sheets },
    });

    return {
      ok: true,
      inputs_evidence_import_id: imp.id,
      total_rows: parsed.rows.length,
      sheets: parsed.sheets,
      workbook_sha256: parsed.workbook_sha256,
      input_health: health,
    };
  });

  app.get("/v1/inputs-evidence/:project_slug/:import_id/rows", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), import_id: z.string() })
      .safeParse(request.params);
    if (!params.success || !UUID_RE.test(params.data.import_id)) {
      return reply.code(400).send({ ok: false, error: "bad_params" });
    }
    const query = z
      .object({
        sheet: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .safeParse(request.query);
    if (!query.success) return reply.code(400).send({ ok: false, error: "bad_query" });

    const project = await ensureProject(db, params.data.project_slug);
    const imp = await getInputsEvidenceImport(db, project.id, params.data.import_id);
    if (!imp) return reply.code(404).send({ ok: false, error: "not_found" });

    const rows = await listInputsEvidenceRows(db, project.id, params.data.import_id, {
      sheet_name: query.data.sheet ?? null,
      limit: query.data.limit,
      offset: query.data.offset,
    });

    return { ok: true, rows, import_id: imp.id };
  });

  app.get("/v1/inputs-evidence/:project_slug/:import_id", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), import_id: z.string() })
      .safeParse(request.params);
    if (!params.success || !UUID_RE.test(params.data.import_id)) {
      return reply.code(400).send({ ok: false, error: "bad_params" });
    }
    const project = await ensureProject(db, params.data.project_slug);
    const imp = await getInputsEvidenceImport(db, project.id, params.data.import_id);
    if (!imp) return reply.code(404).send({ ok: false, error: "not_found" });
    const bySheet = await sheetRowCountsForImport(db, params.data.import_id);
    return { ok: true, import: imp, rows_by_sheet: bySheet };
  });

  app.get("/v1/inputs-evidence/:project_slug", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .safeParse(request.query);
    if (!query.success) return reply.code(400).send({ ok: false, error: "bad_query" });

    const project = await ensureProject(db, params.data.project_slug);
    const list = await listInputsEvidenceImports(db, project.id, query.data.limit, query.data.offset);
    return { ok: true, imports: list, count: list.length };
  });
}
