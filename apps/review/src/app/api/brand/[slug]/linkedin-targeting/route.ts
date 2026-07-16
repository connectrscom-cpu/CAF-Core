import { NextRequest, NextResponse } from "next/server";
import { compileLinkedInTargeting } from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  let body: { free_text?: string; persist?: boolean; apply_to_sources?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const freeText = String(body.free_text ?? "").trim();
  if (!freeText) {
    return NextResponse.json({ ok: false, error: "free_text_required" }, { status: 400 });
  }
  try {
    const result = await compileLinkedInTargeting(slug, {
      free_text: freeText,
      persist: body.persist !== false,
      apply_to_sources: Boolean(body.apply_to_sources),
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "compile_failed" },
      { status: 502 }
    );
  }
}
