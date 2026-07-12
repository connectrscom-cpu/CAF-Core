/**
 * Parse a CAF Project Onboarding Pack (markdown or plain text).
 *
 * Accepts ChatGPT output from `apps/review/CHATGPT_PROJECT_SETUP_GUIDE.md` §10
 * and operator-authored packs with the same section structure.
 */
export type OnboardingSectionKey =
  | "brand_snapshot"
  | "strategy"
  | "voice"
  | "visual"
  | "research"
  | "formats"
  | "publishing"
  | "compliance"
  | "gaps";

export type ResearchTabKey =
  | "igaccounts"
  | "tiktokaccounts"
  | "hashtags"
  | "subreddits"
  | "facebook"
  | "websites_blogs";

export interface ParsedOnboardingPack {
  title: string | null;
  readiness: string | null;
  /** Normalized section → field label (lowercase) → value text. */
  sections: Partial<Record<OnboardingSectionKey, Record<string, string>>>;
  researchLists: Partial<Record<ResearchTabKey, string[]>>;
  gaps: string[];
  warnings: string[];
  errors: string[];
}

const SECTION_ALIASES: Array<{ key: OnboardingSectionKey; patterns: RegExp[] }> = [
  {
    key: "brand_snapshot",
    patterns: [/brand\s*snapshot/i, /brand\s*identity/i],
  },
  {
    key: "strategy",
    patterns: [/^strategy(?:\s*&\s*positioning)?$/i, /^strategy$/i],
  },
  {
    key: "voice",
    patterns: [/voice\s*(?:&|and)\s*(?:compliance|copy)/i, /^voice$/i],
  },
  {
    key: "visual",
    patterns: [/visual\s*system/i, /visual\s*identity/i],
  },
  {
    key: "research",
    patterns: [/research\s*(?:watchlist|&)/i, /competitive\s*intelligence/i],
  },
  {
    key: "formats",
    patterns: [/formats?\s*(?:&|and)\s*platforms?/i],
  },
  {
    key: "publishing",
    patterns: [/^publishing$/i],
  },
  {
    key: "compliance",
    patterns: [/^(?:legal,?\s*)?(?:risk\s*&\s*)?compliance$/i, /legal,?\s*risk/i],
  },
  {
    key: "gaps",
    patterns: [/gaps?\s*(?:&|and)\s*next\s*steps?/i, /gaps?\s*&\s*recommendations/i],
  },
];

const RESEARCH_SUBSECTION_ALIASES: Array<{ key: ResearchTabKey; patterns: RegExp[] }> = [
  { key: "igaccounts", patterns: [/instagram\s*accounts?/i] },
  { key: "tiktokaccounts", patterns: [/tiktok\s*accounts?/i] },
  { key: "hashtags", patterns: [/^hashtags?$/i] },
  { key: "subreddits", patterns: [/reddit(?:\s*communities?)?/i, /^reddit$/i] },
  { key: "facebook", patterns: [/facebook(?:\s*pages?|\s*groups?)?/i] },
  { key: "websites_blogs", patterns: [/websites?\s*(?:&|and)\s*blogs?/i] },
];

const SECTION_HEADER_RE = /^(?:#{1,3}\s*)?(\d+\.\s*)?(.+?)\s*$/;
const FIELD_LINE_RE = /^(?:[-*•]\s+)?([A-Za-z][A-Za-z0-9 /&'()–—-]+?):\s*(.*)$/;

function normalizeFieldKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, " / ");
}

function resolveSectionKey(title: string): OnboardingSectionKey | null {
  const cleaned = title
    .replace(/^#{1,3}\s*/, "")
    .replace(/^\d+\.\s*/, "")
    .trim();
  for (const { key, patterns } of SECTION_ALIASES) {
    for (const pat of patterns) {
      if (pat.test(cleaned)) return key;
    }
  }
  return null;
}

function resolveResearchTab(title: string): ResearchTabKey | null {
  const cleaned = title.replace(/^#{1,3}\s*/, "").trim();
  for (const { key, patterns } of RESEARCH_SUBSECTION_ALIASES) {
    for (const pat of patterns) {
      if (pat.test(cleaned)) return key;
    }
  }
  return null;
}

export function isGapValue(value: string): boolean {
  const v = value.trim();
  return /^\[GAP\b/i.test(v) || /\bGAP\s*[—–-]\s*not in project knowledge\b/i.test(v);
}

function isSkippableLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^>{1,3}\s/.test(t)) return true;
  if (/^---+$/.test(t)) return true;
  if (/^#+\s*CAF Project Onboarding Pack/i.test(t)) return true;
  if (/^Compiled from\b/i.test(t)) return true;
  if (/^Readiness:\s*/i.test(t)) return true;
  return false;
}

function isSectionHeaderLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/^#{1,3}\s*\d+\.\s+\S/.test(t)) return true;
  if (/^\d+\.\s+[A-Z]/.test(t) && !FIELD_LINE_RE.test(t)) return true;
  return false;
}

function isFieldStartLine(line: string): boolean {
  return FIELD_LINE_RE.test(line.trim());
}

function parseFieldLine(line: string): { key: string; value: string } | null {
  const m = line.trim().match(FIELD_LINE_RE);
  if (!m) return null;
  return { key: normalizeFieldKey(m[1]!), value: (m[2] ?? "").trim() };
}

function splitIntoSections(text: string): Array<{ title: string; body: string }> {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const sections: Array<{ title: string; body: string }> = [];
  let currentTitle: string | null = null;
  let currentBody: string[] = [];

  const flush = () => {
    if (currentTitle) {
      sections.push({ title: currentTitle, body: currentBody.join("\n").trim() });
    }
    currentBody = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (isSkippableLine(line)) continue;

    if (isSectionHeaderLine(line)) {
      flush();
      const m = line.trim().match(SECTION_HEADER_RE);
      currentTitle = m ? m[2]!.trim() : line.trim();
      continue;
    }

    if (currentTitle) currentBody.push(line);
  }
  flush();
  return sections;
}

function parseSectionFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const lines = body.split("\n");
  let currentKey: string | null = null;
  let currentValue: string[] = [];

  const flush = () => {
    if (!currentKey) return;
    const value = currentValue.join("\n").trim();
    if (value && !isGapValue(value)) {
      fields[currentKey] = fields[currentKey] ? `${fields[currentKey]}\n${value}` : value;
    } else if (isGapValue(value)) {
      // gap — skip field
    }
    currentValue = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      if (currentKey) currentValue.push("");
      continue;
    }

    // Subsection headers inside a section (e.g. ### Instagram accounts) end current field.
    if (/^#{1,3}\s+\S/.test(line.trim())) {
      flush();
      currentKey = null;
      continue;
    }

    const field = parseFieldLine(line);
    if (field && (field.value || !line.startsWith(" "))) {
      flush();
      currentKey = field.key;
      currentValue = field.value ? [field.value] : [];
      continue;
    }

    if (currentKey) {
      currentValue.push(line.trim());
    }
  }
  flush();
  return fields;
}

function parseCodeBlockLists(body: string): Partial<Record<ResearchTabKey, string[]>> {
  const lists: Partial<Record<ResearchTabKey, string[]>> = {};
  const lines = body.split("\n");
  let currentTab: ResearchTabKey | null = null;
  let inCode = false;
  let codeLines: string[] = [];

  const flushCode = () => {
    if (!currentTab || codeLines.length === 0) {
      codeLines = [];
      inCode = false;
      return;
    }
    const entries = codeLines
      .map((l) => l.trim())
      .filter((l) => l && !isGapValue(l) && !/^\[GAP\b/i.test(l));
    if (entries.length > 0) {
      const prev = lists[currentTab] ?? [];
      lists[currentTab] = [...prev, ...entries];
    }
    codeLines = [];
    inCode = false;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (/^```/.test(line)) {
      if (inCode) flushCode();
      else inCode = true;
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const sub = resolveResearchTab(line.replace(/^#{1,3}\s*/, ""));
    if (sub) {
      flushCode();
      currentTab = sub;
      continue;
    }

    // Inline list items after a research subsection header (non-code).
    if (currentTab && /^[-*#]/.test(line)) {
      const entry = line.replace(/^[-*#]+\s*/, "").trim();
      if (entry && !isGapValue(entry)) {
        const prev = lists[currentTab] ?? [];
        lists[currentTab] = [...prev, entry];
      }
    }
  }
  flushCode();
  return lists;
}

function collectGaps(text: string, sections: ParsedOnboardingPack["sections"]): string[] {
  const gaps: string[] = [];
  const gapRe = /\[GAP[^\]]*\]/gi;
  for (const m of text.matchAll(gapRe)) {
    const g = m[0]!.trim();
    if (!gaps.includes(g)) gaps.push(g);
  }
  const gapsSection = sections.gaps;
  if (gapsSection?.gaps) {
    for (const line of gapsSection.gaps.split("\n")) {
      const t = line.replace(/^[-*•\d.]+\s*/, "").trim();
      if (t && !gaps.includes(t)) gaps.push(t);
    }
  }
  return gaps;
}

export function parseOnboardingPack(text: string): ParsedOnboardingPack {
  const result: ParsedOnboardingPack = {
    title: null,
    readiness: null,
    sections: {},
    researchLists: {},
    gaps: [],
    warnings: [],
    errors: [],
  };

  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    result.errors.push("empty document");
    return result;
  }

  const titleMatch = normalized.match(/^#\s+CAF Project Onboarding Pack\s*[—–-]\s*(.+)$/m);
  if (titleMatch) result.title = titleMatch[1]!.trim();

  const readinessMatch = normalized.match(/^>\s*Readiness:\s*(.+)$/im)
    ?? normalized.match(/Readiness:\s*(MVP|Production-ready|Not ready)/i);
  if (readinessMatch) result.readiness = readinessMatch[1]!.trim();

  const rawSections = splitIntoSections(normalized);
  if (rawSections.length === 0) {
    result.errors.push("no numbered sections found — expected headers like `## 1. Brand snapshot`");
    return result;
  }

  for (const { title, body } of rawSections) {
    const key = resolveSectionKey(title);
    if (!key) {
      result.warnings.push(`unrecognized section "${title}" — skipped`);
      continue;
    }
    result.sections[key] = parseSectionFields(body);
    if (key === "research") {
      const lists = parseCodeBlockLists(body);
      for (const [tab, entries] of Object.entries(lists)) {
        const k = tab as ResearchTabKey;
        result.researchLists[k] = [...(result.researchLists[k] ?? []), ...(entries ?? [])];
      }
    }
  }

  if (!result.sections.brand_snapshot?.slug && !result.sections.brand_snapshot?.["display name"]) {
    result.warnings.push("brand snapshot missing slug/display name — supply via slug override at import");
  }

  result.gaps = collectGaps(normalized, result.sections);
  return result;
}

/** Build a workbook-style payload row for a research list entry. */
export function researchEntryToPayload(tab: ResearchTabKey, entry: string): Record<string, string> {
  const raw = entry.trim();
  if (!raw) return { Name: "", Link: "", Platform: "" };

  if (tab === "hashtags") {
    const tag = raw.replace(/^#+/, "").trim();
    return { Name: tag, Link: `#${tag}`, Platform: "Multi-platform" };
  }

  if (tab === "subreddits") {
    const name = raw.replace(/^r\//i, "").replace(/^https?:\/\/(?:www\.)?reddit\.com\/r\//i, "").replace(/\/$/, "");
    return {
      Name: name,
      Link: raw.startsWith("http") ? raw : `https://www.reddit.com/r/${name}/`,
      Platform: "Reddit",
    };
  }

  if (tab === "igaccounts") {
    const handle = raw.replace(/^@/, "").replace(/^https?:\/\/(?:www\.)?instagram\.com\//i, "").replace(/\/$/, "");
    return {
      Name: handle,
      Link: raw.startsWith("http") ? raw : `https://www.instagram.com/${handle}/`,
      Platform: "Instagram",
    };
  }

  if (tab === "tiktokaccounts") {
    const handle = raw.replace(/^@/, "").replace(/^https?:\/\/(?:www\.)?tiktok\.com\/@?/i, "").replace(/\/$/, "");
    return {
      Name: handle,
      Link: raw.startsWith("http") ? raw : `https://www.tiktok.com/@${handle}`,
      Platform: "TikTok",
    };
  }

  if (tab === "facebook") {
    return {
      Name: raw.replace(/^https?:\/\/(?:www\.)?facebook\.com\//i, "").replace(/\/$/, "") || raw,
      Link: raw.startsWith("http") ? raw : `https://www.facebook.com/${raw}`,
      Platform: "Facebook",
    };
  }

  // websites_blogs
  if (/^https?:\/\//i.test(raw)) {
    let name = raw;
    try {
      name = new URL(raw).hostname.replace(/^www\./, "");
    } catch {
      /* keep raw */
    }
    return { Name: name, Link: raw, Platform: "Web" };
  }
  return { Name: raw, Link: raw, Platform: "Web" };
}

export function extractHexPalette(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/#([0-9A-Fa-f]{6})\b/g)) {
    const hex = `#${m[1]}`;
    if (!out.includes(hex)) out.push(hex);
  }
  return out;
}

export function mapVisualMode(text: string): string | null {
  const s = text.trim().toLowerCase();
  if (!s || isGapValue(text)) return null;
  if (s.includes("mixed")) return "mixed";
  if (s.includes("photo")) return "photography";
  if (s.includes("illustrat") || s.includes("cartoon")) return "illustrated_cartoon";
  if (s.includes("minimal") || s.includes("editorial")) return "minimal_editorial";
  if (s.includes("custom")) return "custom";
  return "custom";
}

export const ONBOARDING_PACK_TEMPLATE = `# CAF Project Onboarding Pack — MY_BRAND

> Compiled from brand knowledge on {date}.
> Readiness: MVP

## 1. Brand snapshot
- Display name: My Brand
- Slug: MY_BRAND
- Description: One-line core offer.
- Instagram: mybrand
- Website: https://example.com
- Product/app name: My Brand

## 2. Strategy
- Audience: Who you serve.
- Audience type: B2C
- Problem: What pain you solve.
- Promise: Transformation promise.
- Positioning: Positioning statement.
- Differentiation: How you differ.
- Content pillars: Pillar one; pillar two; pillar three.
- Content goal: Awareness
- Business goal: Acquire users.
- Publishing intensity: 3 carousels per week on Instagram.
- North-star metric: Saves per carousel.
- Approval owner: Marketing lead

## 3. Voice & compliance
- Tone: Calm, useful, conversational.
- Reading level: Plain consumer English.
- Storytelling style: Listicles; tutorials.
- CTA style: One primary CTA per asset.
- Emoji policy: Max 1–2 per caption.
- Banned words: miracle; guaranteed
- Banned claims: Guaranteed outcomes.
- Disclaimers: Nutrition values are estimates.
- Example captions:
  1. Example caption one.
  2. Example caption two.

## 4. Visual system
- Style: Minimal, bright, food-led.
- Palette (hex + roles): #16a34a primary; #1a1a1a text; #f5f5f5 background.
- Domain metaphors: Chaos becoming order.
- Allowed motifs: Grocery lists; meal calendars.
- Forbidden motifs: Medical imagery; shame-based visuals.
- Visual mode: Mixed
- Application instructions: One idea per frame; mobile legibility first.
- Content aims: Make planning feel easier.
- Mimic policy: Copy structure, not identity.
- Original policy: Wordmark + one accent color on every carousel.

## 5. Research watchlist
### Instagram accounts
\`\`\`
competitor.handle
inspiration.handle
\`\`\`
### Hashtags
\`\`\`
#easyrecipes
#mealplan
\`\`\`
### Reddit
\`\`\`
r/MealPrepSunday
\`\`\`
### Websites & blogs
\`\`\`
https://www.example.com/
\`\`\`
- Competitors: Competitor A — why it matters.
- Winning formats: Carousels; short-form video.

## 6. Formats & platforms
- Enabled formats: Instagram carousels: Yes; HeyGen video: Yes.
- Instagram rules: 1080×1350 canvas; 5–9 slides; 3–8 hashtags at end.
- Other platform rules: TikTok hook in first 3 seconds.

## 7. Publishing
- Channels: Instagram; TikTok.
- Link-in-bio: https://example.com
- Hashtag sets: #MyBrand; #mealplan
- Posting schedule: 3 carousels per week.

## 8. Compliance
- Category: Food and meal planning.
- Banned claims: Medical outcomes.
- Sensitive topics: Eating disorders.
- Disclosures: Disclose paid partnerships.

## 9. Gaps & next steps
- Gaps: [GAP] Approved hex palette.
- Conflicts: None noted.
- Priority actions: Upload logo assets.
`;
