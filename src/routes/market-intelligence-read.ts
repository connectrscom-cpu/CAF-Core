import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { ensureProject } from "../repositories/core.js";
import { getSignalPackById } from "../repositories/signal-packs.js";
import {
  buildMarketIntelligenceForImport,
  ensureMarketIntelligenceOnPack,
  marketIntelligenceNeedsRefresh,
  readStoredMarketIntelligenceV1,
} from "../services/market-intelligence-pack.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function registerMarketIntelligenceRoutes(app: FastifyInstance, deps: { db: Pool }) {
  const { db } = deps;

  app.get("/v1/market-intelligence/:project_slug/signal-pack/:signal_pack_id", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), signal_pack_id: z.string() })
      .safeParse(request.params);
    const query = z
      .object({ refresh: z.enum(["0", "1"]).optional(), limit: z.coerce.number().int().min(1).max(500).optional() })
      .safeParse(request.query);

    if (!params.success || !UUID_RE.test(params.data.signal_pack_id) || !query.success) {
      return reply.code(400).send({ ok: false, error: "bad_request" });
    }

    const project = await ensureProject(db, params.data.project_slug);
    const pack = await getSignalPackById(db, params.data.signal_pack_id);
    if (!pack || pack.project_id !== project.id) {
      return reply.code(404).send({ ok: false, error: "not_found" });
    }

    const importId = pack.source_inputs_import_id?.trim() || "";
    if (!importId || !UUID_RE.test(importId)) {
      return reply.code(404).send({
        ok: false,
        error: "no_import",
        message: "Signal pack is not linked to a processed evidence import.",
      });
    }

    const derived = pack.derived_globals_json ?? {};
    const force = query.data.refresh === "1";
    const config = loadConfig();
    let market_intelligence_v1 = readStoredMarketIntelligenceV1(derived);

    if (!market_intelligence_v1 || force || marketIntelligenceNeedsRefresh(market_intelligence_v1)) {
      market_intelligence_v1 = await ensureMarketIntelligenceOnPack(
        db,
        config,
        project.id,
        params.data.project_slug,
        importId,
        pack.id,
        derived,
        { persist: true, force: force || marketIntelligenceNeedsRefresh(market_intelligence_v1) }
      );
    } else if (!market_intelligence_v1.media_lanes?.length) {
      market_intelligence_v1 = await buildMarketIntelligenceForImport(
        db,
        config,
        project.id,
        params.data.project_slug,
        importId,
        {
          signal_pack_id: pack.id,
          run_id: pack.run_id ?? null,
          derived_globals: derived,
          limit: query.data.limit ?? 500,
        }
      );
    }

    return {
      ok: true,
      project_slug: params.data.project_slug,
      signal_pack_id: pack.id,
      inputs_import_id: importId,
      market_intelligence_v1,
    };
  });
}
