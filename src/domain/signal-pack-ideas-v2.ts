import { z } from "zod";

export const ideaPlatformSchema = z
  .enum(["Instagram", "TikTok", "Reddit", "Facebook", "Multi"])
  .or(z.string().min(1));

export const ideaFormatSchema = z
  .enum(["carousel", "video", "post", "thread", "blog", "memo", "slides", "script"])
  .or(z.string().min(1));

/**
 * Canonical rich idea schema stored in `signal_packs.ideas_json`.
 *
 * Note: file name kept for compatibility with the earlier iteration, but this is no longer a "v2 variant" —
 * it is the main idea contract.
 */
export const signalPackIdeaSchema = z.object({
  id: z.string().min(1),
  created_at: z.string().min(1).optional(),
  run_id: z.string().min(1).optional(),

  title: z.string().min(1).max(200),
  three_liner: z.string().min(1).max(1200),
  thesis: z.string().min(1).max(800),

  who_for: z.string().min(1).max(200),
  format: ideaFormatSchema,
  platform: ideaPlatformSchema,

  why_now: z.string().min(1).max(800),
  key_points: z.array(z.string().min(1).max(280)).min(3).max(10),
  novelty_angle: z.string().min(1).max(800),
  cta: z.string().min(1).max(200),

  grounding_insight_ids: z.array(z.string().min(1)).min(1).max(10),
  expected_outcome: z.string().min(1).max(400),

  risk_flags: z.array(z.string().min(1).max(60)).default([]),
  status: z.enum(["proposed", "selected", "rejected"]).default("proposed"),

  confidence_score: z.number().min(0).max(1).optional(),
  idea_score: z.number().min(0).max(1).optional(),
});

export type SignalPackIdeaV2 = z.infer<typeof signalPackIdeaSchema>;

export const signalPackIdeasV2ArraySchema = z.array(signalPackIdeaSchema);

export function parseIdeasV2(raw: unknown): SignalPackIdeaV2[] {
  const parsed = signalPackIdeasV2ArraySchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

export function parseSelectedIdeaIds(raw: unknown): string[] {
  const parsed = z.array(z.string().min(1)).safeParse(raw);
  if (!parsed.success) return [];
  // preserve order, drop empties/dupes
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of parsed.data.map((s) => s.trim()).filter(Boolean)) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

