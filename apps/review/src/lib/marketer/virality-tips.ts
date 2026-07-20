/**
 * Educational tips for Meta organic reach (IG / FB).
 * Display-only — does not change planning, generation, or flows.
 */

export type ViralityTipPage =
  | "ideas"
  | "research"
  | "intelligence"
  | "content"
  | "publishing"
  | "performance"
  | "profile"
  | "workspace"
  | "cart";

export type ViralityTipSource = "meta_public" | "benchmark";

export interface ViralityTip {
  id: string;
  page: ViralityTipPage;
  title: string;
  body: string;
  source: ViralityTipSource;
  priority: number;
}

export const VIRALITY_TIPS: ViralityTip[] = [
  // Ideas / Cart
  {
    id: "ideas-reels-discovery",
    page: "ideas",
    title: "Reels drive discovery",
    body: "On Instagram and Facebook, short video (especially Reels) is the main path to non-followers. Mix video ideas in when growth is the goal.",
    source: "meta_public",
    priority: 10,
  },
  {
    id: "ideas-share-worthy",
    page: "ideas",
    title: "Design for sends",
    body: "Ask: would someone DM this to a friend? Shares/sends matter alongside likes for organic reach.",
    source: "meta_public",
    priority: 20,
  },
  {
    id: "ideas-topic-lane",
    page: "ideas",
    title: "Stay in one interest lane",
    body: "Recommenders match content to inferred interests. Jumping niches makes it harder for the system to know who should see you next.",
    source: "meta_public",
    priority: 30,
  },
  {
    id: "cart-share-test",
    page: "cart",
    title: "Cart check",
    body: "Before generating: is the hook clear in three seconds, and is there a reason to send this? Weak shareability rarely goes far beyond followers.",
    source: "meta_public",
    priority: 10,
  },

  // Research
  {
    id: "research-keywords",
    page: "research",
    title: "Make topics legible",
    body: "Instagram advises relevant keywords in content, captions, bio, and hashtags so search and recommendations can place you in the right interest buckets.",
    source: "meta_public",
    priority: 10,
  },
  {
    id: "research-consistency",
    page: "research",
    title: "Stable niche signals",
    body: "Watchlists and briefs work best when they reinforce one coherent topic lane — that helps interest matching over time.",
    source: "meta_public",
    priority: 20,
  },

  // Intelligence
  {
    id: "intel-watch-sends",
    page: "intelligence",
    title: "Watch what retains and gets sent",
    body: "For creators optimizing reach, prioritize average watch time, like rate, and sends per reach — not vanity likes alone.",
    source: "meta_public",
    priority: 10,
  },
  {
    id: "intel-originality",
    page: "intelligence",
    title: "Original beats recycled",
    body: "Low-effort edits, visible watermarks, and clearly reposted clips are less likely to be recommended. Prefer native, original patterns.",
    source: "meta_public",
    priority: 20,
  },

  // Content review
  {
    id: "content-first-3s",
    page: "content",
    title: "Win the first three seconds",
    body: "Instagram and Facebook both stress an early hook. If viewers bounce immediately, ranking rarely recovers.",
    source: "meta_public",
    priority: 10,
  },
  {
    id: "content-mute-safe",
    page: "content",
    title: "Design for silent viewing",
    body: "Many people watch without sound. On-screen text and clear captions keep comprehension high on mute.",
    source: "meta_public",
    priority: 20,
  },
  {
    id: "content-native-original",
    page: "content",
    title: "Native and original",
    body: "Upload clean native media. Third-party watermarks and recycled clips reduce recommendation eligibility.",
    source: "meta_public",
    priority: 30,
  },

  // Publishing
  {
    id: "pub-cadence-ig",
    page: "publishing",
    title: "Instagram cadence (baseline)",
    body: "A common industry baseline is about 3–5 feed posts per week plus 1–2 Stories a day. Consistency beats random bursts — this is a benchmark, not a Meta rule.",
    source: "benchmark",
    priority: 10,
  },
  {
    id: "pub-cadence-fb",
    page: "publishing",
    title: "Facebook cadence (baseline)",
    body: "Benchmarks often suggest about 1–2 Facebook posts per day. Quality still matters more than hitting a rigid daily quota.",
    source: "benchmark",
    priority: 20,
  },
  {
    id: "pub-reels-vs-links",
    page: "publishing",
    title: "Reels for reach, links for conversion",
    body: "Native Reels are built for discovery. Outbound-link posts are better treated as conversion tools than virality tools — most Feed views stay on-platform.",
    source: "meta_public",
    priority: 30,
  },
  {
    id: "pub-consistency",
    page: "publishing",
    title: "Learning velocity",
    body: "Post often enough to give the model fresh evidence of what works — but not so often that hooks and edit quality collapse.",
    source: "meta_public",
    priority: 40,
  },

  // Performance
  {
    id: "perf-mosseri-metrics",
    page: "performance",
    title: "Metrics that matter for reach",
    body: "Track average watch time (Reels), like rate, and sends per reach. Those are the creator-facing signals Meta elevates most clearly.",
    source: "meta_public",
    priority: 10,
  },
  {
    id: "perf-test-hooks",
    page: "performance",
    title: "Test hooks, don’t guess",
    body: "Use variants and early-view signals (e.g. 3-second views on Facebook) to judge whether openings hold attention.",
    source: "meta_public",
    priority: 20,
  },
  {
    id: "perf-volume-quality",
    page: "performance",
    title: "Volume only if quality holds",
    body: "More posts create more learning data — but only if each one is strong enough to teach you something useful.",
    source: "meta_public",
    priority: 30,
  },

  // Profile
  {
    id: "profile-niche",
    page: "profile",
    title: "Keep the niche coherent",
    body: "Brand voice and content routes should reinforce one recognizable topic lane so recommenders know who your next post is for.",
    source: "meta_public",
    priority: 10,
  },
  {
    id: "profile-video-lanes",
    page: "profile",
    title: "Video lanes for growth",
    body: "If organic discovery is a goal on Instagram or Facebook, keep short-video / Reels-capable routes enabled alongside carousels.",
    source: "meta_public",
    priority: 20,
  },

  // Workspace
  {
    id: "workspace-four-gates",
    page: "workspace",
    title: "Organic reach in one line",
    body: "Eligible (original, native) → immediate hook → enough watch/retain → worth sending. Virality is clearing those gates repeatedly — not one secret algorithm.",
    source: "meta_public",
    priority: 10,
  },
  {
    id: "workspace-reels",
    page: "workspace",
    title: "Format matters",
    body: "Meta frames Reels as the clearest organic discovery format on Instagram and Facebook. Plan brands with video in the mix when growth is the goal.",
    source: "meta_public",
    priority: 20,
  },
];

function daySeed(): number {
  const d = new Date();
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable tip for a page for the current UTC day (rotates daily). */
export function pickViralityTip(page: ViralityTipPage, salt = ""): ViralityTip | null {
  const pool = VIRALITY_TIPS.filter((t) => t.page === page).sort((a, b) => a.priority - b.priority);
  if (pool.length === 0) return null;
  const idx = hashString(`${page}:${daySeed()}:${salt}`) % pool.length;
  return pool[idx] ?? null;
}

export function sourceLabel(source: ViralityTipSource): string {
  return source === "benchmark" ? "Industry baseline" : "Meta-backed";
}
