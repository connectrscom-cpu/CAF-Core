/**
 * `generation_payload.reddit_post_v1` — Reddit title + body copy.
 */
export const REDDIT_POST_V1_KEY = "reddit_post_v1";

export interface RedditPostV1 {
  title: string;
  body: string;
  subreddit_hint?: string | null;
  flair_hint?: string | null;
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

export function pickRedditPostV1(payload: Record<string, unknown> | null | undefined): RedditPostV1 | null {
  const raw = payload?.[REDDIT_POST_V1_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const title = str(row.title);
  const body = str(row.body);
  if (!title || !body) return null;
  return {
    title,
    body,
    subreddit_hint: str(row.subreddit_hint) || null,
    flair_hint: str(row.flair_hint) || null,
  };
}

export function buildRedditPostV1FromGenerated(generated: Record<string, unknown>): RedditPostV1 {
  const title =
    str(generated.title) ||
    str(generated.reddit_title) ||
    str(generated.headline) ||
    str(generated.hook) ||
    "Discussion post";

  const body =
    str(generated.body) ||
    str(generated.reddit_body) ||
    str(generated.post_text) ||
    str(generated.text) ||
    str(generated.caption) ||
    [str(generated.intro), str(generated.body_text)].filter(Boolean).join("\n\n");

  return {
    title: title.slice(0, 300),
    body,
    subreddit_hint: str(generated.subreddit_hint) || str(generated.subreddit) || null,
    flair_hint: str(generated.flair_hint) || str(generated.flair) || null,
  };
}

export function mergeRedditPostV1(payload: Record<string, unknown>, slice: RedditPostV1): Record<string, unknown> {
  return { ...payload, [REDDIT_POST_V1_KEY]: slice };
}

export const REDDIT_POST_LLM_SYSTEM_APPENDIX = `You are writing a **Reddit post** (text post, not a link/image meme).

Return valid JSON with:
- "title": string — Reddit post title (≤300 chars, specific, curiosity or value-led; no clickbait ALL CAPS).
- "body": string — post body in Reddit markdown (short paragraphs, bullets ok, conversational but substantive).
- "subreddit_hint": string (optional) — e.g. "r/Entrepreneur" when grounded in evidence.
- "flair_hint": string (optional) — suggested flair label if obvious from context.

Tone: community-native, helpful, not salesy. No Instagram hashtags. No "link in bio". Avoid emoji spam.`;
