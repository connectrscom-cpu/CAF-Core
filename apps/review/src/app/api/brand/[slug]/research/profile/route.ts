import { brandAccessDeniedResponse } from "@/lib/brand-access-guard";
import { NextRequest, NextResponse } from "next/server";
import {
  getInputsProcessingProfile,
  putInputsProcessingProfile,
} from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  {
    const denied = await brandAccessDeniedResponse(slug);
    if (denied) return denied;
  }

  if (!slug) return NextResponse.json({ error: "Missing brand" }, { status: 400 });

  try {
    const res = await getInputsProcessingProfile(slug);
    return NextResponse.json({
      ok: true,
      profile: {
        rating_model: res.profile.rating_model,
        synth_model: res.profile.synth_model,
        max_ideas_in_signal_pack: res.profile.max_ideas_in_signal_pack,
        max_rows_for_rating: res.profile.max_rows_for_rating,
        min_llm_score_for_pack: Number(res.profile.min_llm_score_for_pack) || 0.35,
        updated_at: res.profile.updated_at,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        message: e instanceof Error ? e.message : "Could not load processing profile",
      },
      { status: 502 }
    );
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  {
    const denied = await brandAccessDeniedResponse(slug);
    if (denied) return denied;
  }

  if (!slug) return NextResponse.json({ error: "Missing brand" }, { status: 400 });

  const body = (await req.json()) as {
    max_ideas_in_signal_pack?: number;
    min_llm_score_for_pack?: number;
    rating_model?: string;
    synth_model?: string;
  };

  try {
    const patch: Parameters<typeof putInputsProcessingProfile>[1] = {};
    if (typeof body.max_ideas_in_signal_pack === "number") {
      patch.max_ideas_in_signal_pack = Math.min(200, Math.max(1, Math.floor(body.max_ideas_in_signal_pack)));
    }
    if (typeof body.min_llm_score_for_pack === "number") {
      patch.min_llm_score_for_pack = Math.min(1, Math.max(0, body.min_llm_score_for_pack));
    }
    if (typeof body.rating_model === "string" && body.rating_model.trim()) {
      patch.rating_model = body.rating_model.trim().slice(0, 80);
    }
    if (typeof body.synth_model === "string" && body.synth_model.trim()) {
      patch.synth_model = body.synth_model.trim().slice(0, 80);
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: false, message: "No profile fields to update" }, { status: 400 });
    }
    const res = await putInputsProcessingProfile(slug, patch);
    return NextResponse.json({
      ok: true,
      profile: {
        rating_model: res.profile.rating_model,
        synth_model: res.profile.synth_model,
        max_ideas_in_signal_pack: res.profile.max_ideas_in_signal_pack,
        max_rows_for_rating: res.profile.max_rows_for_rating,
        min_llm_score_for_pack: Number(res.profile.min_llm_score_for_pack) || 0.35,
        updated_at: res.profile.updated_at,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        message: e instanceof Error ? e.message : "Could not save processing profile",
      },
      { status: 502 }
    );
  }
}
