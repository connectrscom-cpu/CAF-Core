import { brandAccessDeniedResponse } from "@/lib/brand-access-guard";
import { NextRequest, NextResponse } from "next/server";
import {
  createRunForPack,
  getSignalPackForProject,
  materializeRunJobs,
  processRunForProject,
  renderRunForProject,
  setSignalPackMimicModeOverride,
  startRunForProject,
} from "@/lib/caf-core-client";
import { cartItemsToMaterializeBody, cartMimicRenderOverrides } from "@/lib/marketer/cart-run-materialize";
import { normalizeCartItemFlow } from "@/lib/marketer/cart-flow-resolve";
import type { ContentCartItem } from "@/lib/marketer/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const STALE_BRIEF_MESSAGE =
  "This research brief is no longer available on CAF Core. On Ideas, pick a current brief from Research context, re-add items to your cart, then try again.";

function isStaleBriefError(message: string): boolean {
  return (
    message.includes("invalid_signal_pack") ||
    message.includes("Signal pack not found") ||
    message.includes('"error":"not_found"')
  );
}

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  {
    const denied = await brandAccessDeniedResponse(slug);
    if (denied) return denied;
  }

  if (!slug) return NextResponse.json({ error: "Missing brand" }, { status: 400 });

  const body = (await req.json()) as {
    packId?: string;
    items?: ContentCartItem[];
    runName?: string;
  };

  const packId = String(body.packId ?? "").trim();
  const items = (body.items ?? []).map(normalizeCartItemFlow);

  if (!packId) {
    return NextResponse.json(
      { ok: false, error: "missing_pack", message: "Select a research brief before starting." },
      { status: 400 }
    );
  }
  if (!items.length) {
    return NextResponse.json(
      { ok: false, error: "empty_cart", message: "Add at least one idea or top performer to the cart." },
      { status: 400 }
    );
  }

  const { idea_ids, idea_picks, mimic_picks, bvs_overrides, cart_manifest } = cartItemsToMaterializeBody(items);
  if (!cart_manifest.length) {
    return NextResponse.json(
      { ok: false, error: "invalid_cart", message: "Could not map cart items to planner rows." },
      { status: 400 }
    );
  }

  try {
    try {
      await getSignalPackForProject(slug, packId);
    } catch {
      return NextResponse.json(
        { ok: false, error: "stale_brief", message: STALE_BRIEF_MESSAGE, pack_id: packId },
        { status: 400 }
      );
    }

    for (const override of cartMimicRenderOverrides(items)) {
      await setSignalPackMimicModeOverride(slug, packId, override.insights_id, override.mode_override);
    }

    const runLabel =
      body.runName?.trim() ||
      `Cart run · ${new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;

    const created = await createRunForPack(slug, {
      signal_pack_id: packId,
      name: runLabel,
      idea_picking_mode: "manual",
      metadata_json: {
        source: "marketer_content_cart",
        cart_item_count: items.length,
        pack_id: packId,
        cart_manifest,
      },
    });

    const runId = created.run.run_id;

    const materializeResult = await materializeRunJobs(slug, runId, {
      mode: "manual",
      cart_manifest,
      bvs_overrides: bvs_overrides.length ? bvs_overrides : undefined,
    });

    const plannerRows = materializeResult.planner_rows ?? 0;
    if (plannerRows !== items.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "materialize_count_mismatch",
          message:
            `Cart has ${items.length} items but CAF materialized ${plannerRows} planner rows. ` +
            "Re-attach the research brief on Ideas, refresh the cart, and try again.",
          expected_rows: items.length,
          planner_rows: plannerRows,
          planner_summary: {
            ideas: idea_ids.length,
            idea_picks: idea_picks.length,
            mimic_picks: mimic_picks.length,
          },
        },
        { status: 502 }
      );
    }

    const startResult = await startRunForProject(slug, runId);
    const jobsCreated = startResult.planned_jobs ?? startResult.jobs_created ?? 0;
    if (jobsCreated !== items.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "job_count_mismatch",
          message:
            `Cart materialized ${plannerRows} rows but CAF planned ${jobsCreated} jobs (expected ${items.length}). ` +
            "Check Admin → Runs → Planned jobs for this run.",
          run_id: runId,
          expected_jobs: items.length,
          planner_rows: plannerRows,
          jobs_created: jobsCreated,
        },
        { status: 502 }
      );
    }

    await processRunForProject(slug, runId);
    await renderRunForProject(slug, runId);

    return NextResponse.json({
      ok: true,
      run_id: runId,
      run_uuid: created.run.id,
      jobs_created: jobsCreated,
      planned_jobs: startResult.planned_jobs ?? jobsCreated,
      planner_rows: materializeResult.planner_rows ?? null,
      planner_summary: {
        ideas: idea_ids.length,
        idea_picks: idea_picks.length,
        mimic_picks: mimic_picks.length,
      },
      message:
        "Run started. Draft generation and rendering are running in the background — check Content in a few minutes.",
      content_url: `/brand/${encodeURIComponent(slug)}/content`,
      admin_runs_url: `/admin/runs?project=${encodeURIComponent(slug)}`,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to start run from cart";
    if (isStaleBriefError(message)) {
      return NextResponse.json(
        { ok: false, error: "stale_brief", message: STALE_BRIEF_MESSAGE, pack_id: packId },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: false, error: "cart_start_failed", message }, { status: 502 });
  }
}
