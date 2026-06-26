import { NextRequest, NextResponse } from "next/server";
import { getQueueCounts, listPublicationPlacements } from "@/lib/caf-core-client";
import { toScheduledPosts } from "@/lib/marketer/publishing-adapters";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!slug) return NextResponse.json({ error: "Missing brand" }, { status: 400 });

  const [counts, scheduled, published] = await Promise.all([
    getQueueCounts(slug).catch(() => ({ in_review: 0, approved: 0, rejected: 0, needs_edit: 0 })),
    listPublicationPlacements(slug, { upcoming_only: true, limit: 100 }).catch(() => ({
      ok: true,
      placements: [],
    })),
    listPublicationPlacements(slug, { status: "published", limit: 100 }).catch(() => ({
      ok: true,
      placements: [],
    })),
  ]);

  return NextResponse.json({
    ok: true,
    approvedCount: counts.approved,
    scheduled: toScheduledPosts(scheduled.placements ?? []),
    published: toScheduledPosts(published.placements ?? []),
  });
}
