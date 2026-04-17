/**
 * Builds an "anti-repetition lane memory" block from recent post-approval LLM reviews + stored job copy,
 * injected into carousel system prompts so new drafts diversify from recently approved work in the same flow/platform.
 */
import type { Pool } from "pg";
import { listLlmApprovalReviewsForAntiRepetition } from "../repositories/llm-approval-reviews.js";

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function trunc(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function pickHookCaptionTitle(gp: Record<string, unknown>): { hook: string; title: string; caption: string } {
  const go = asRec(gp.generated_output) ?? {};
  const hook = str(gp.hook) || str(gp.generated_hook) || str(go.hook) || str(go.generated_hook);
  const title = str(gp.title) || str(gp.generated_title) || str(go.title) || str(go.generated_title);
  let caption =
    str(gp.caption) ||
    str(gp.generated_caption) ||
    str(go.caption) ||
    str(go.generated_caption) ||
    str(asRec(go.carousel)?.caption) ||
    str(asRec(go.publish)?.caption);
  if (!caption) {
    const nestKeys = ["content", "publish", "publication", "post", "variation"];
    for (const k of nestKeys) {
      const n = asRec(go[k]);
      if (n) {
        caption = str(n.caption) || str(n.post_caption) || str(n.description);
        if (caption) break;
      }
    }
  }
  return { hook, title, caption: trunc(caption, 220) };
}

function slideHeadlinesFromPayload(gp: Record<string, unknown>, maxSlides: number, maxEach: number): string[] {
  const merged: Record<string, unknown> = { ...gp };
  const go = asRec(gp.generated_output);
  if (go) Object.assign(merged, go);

  const headlines: string[] = [];
  const pushFromSlide = (o: unknown) => {
    const r = asRec(o);
    if (!r) return;
    const h =
      str(r.headline) ||
      str(r.title) ||
      str(r.heading) ||
      str(r.hook) ||
      str(r.slide_headline);
    if (h) headlines.push(trunc(h, maxEach));
  };

  const tryArray = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const s of arr) {
      if (headlines.length >= maxSlides) return;
      pushFromSlide(s);
    }
  };

  tryArray(merged.slides);
  const deck = asRec(merged.slide_deck);
  if (deck) tryArray(deck.slides);
  const variation = asRec(merged.variation);
  if (variation) tryArray(variation.slides);
  const car = merged.carousel;
  if (Array.isArray(car)) tryArray(car);
  const carRec = asRec(car);
  if (carRec) tryArray(carRec.slides);
  const content = asRec(merged.content);
  if (content) tryArray(content.slides);

  return headlines.slice(0, maxSlides);
}

function formatStrengthsLine(strengths: unknown): string {
  if (!Array.isArray(strengths)) return "";
  const parts = strengths.map((x) => String(x).trim()).filter(Boolean).slice(0, 3);
  if (!parts.length) return "";
  return `Notable traits (do not mirror): ${parts.join(" · ")}`;
}

export async function buildLlmApprovalAntiRepetitionBlock(
  db: Pool,
  projectId: string,
  flowType: string | null,
  platform: string | null,
  opts: { excludeTaskId?: string | null; maxJobs: number; maxChars: number }
): Promise<string> {
  if (opts.maxChars <= 0 || opts.maxJobs <= 0) return "";
  const ft = (flowType ?? "").trim();
  if (!ft) return "";

  const rows = await listLlmApprovalReviewsForAntiRepetition(db, projectId, ft, platform, {
    excludeTaskId: opts.excludeTaskId,
    limit: opts.maxJobs,
  });
  if (rows.length === 0) return "";

  const chunks: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const gp = (r.generation_payload ?? {}) as Record<string, unknown>;
    const { hook, title, caption } = pickHookCaptionTitle(gp);
    const heads = slideHeadlinesFromPayload(gp, 5, 72);
    const scoreN = r.overall_score != null ? Number(r.overall_score) : NaN;
    const scoreLabel = Number.isFinite(scoreN) ? scoreN.toFixed(2) : "?";
    const sum = typeof r.summary === "string" ? trunc(r.summary, 280) : "";
    const strengthLine = formatStrengthsLine(r.strengths);
    const lines = [
      `${i + 1}) task ${r.task_id} (post-approval review score ${scoreLabel})`,
      hook ? `Hook fingerprint: ${trunc(hook, 160)}` : "",
      title ? `Title: ${trunc(title, 120)}` : "",
      caption ? `Caption excerpt: ${caption}` : "",
      heads.length ? `Slide headlines: ${heads.join(" | ")}` : "",
      sum ? `Reviewer summary: ${sum}` : "",
      strengthLine,
    ].filter(Boolean);
    chunks.push(lines.join("\n"));
  }

  let body = chunks.join("\n\n");
  if (body.length > opts.maxChars) {
    body = `${body.slice(0, opts.maxChars)}…`;
  }
  return body.trim();
}
