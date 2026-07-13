/**
 * Apify actor input builders — aligned with n8n INPUTS scraper flows.
 * Stored in `inputs_scraper_config.config_json` and edited from Admin → Inputs → Scrapers.
 */

export const LINKEDIN_ACTOR_IDS = {
  posts: "harvestapi/linkedin-profile-posts",
  profileSearch: "harvestapi/linkedin-profile-search",
} as const;

export const DEFAULT_ACTOR_IDS = {
  instagram: "shu8hvrXbJbY3Eb9W",
  tiktok: "GdWCkxBtKWOsKjdch",
  facebook: "KoJrdxJCTtpon81KY",
  reddit: "oAuCIx3ItNrs2okjQ",
  linkedin_posts: LINKEDIN_ACTOR_IDS.posts,
  linkedin_profile_search: LINKEDIN_ACTOR_IDS.profileSearch,
} as const;

export interface ApifyGlobalConfig {
  useApifyProxy?: boolean;
  proxyCountryCode?: string;
  /** Max seconds to wait for actor run completion (Apify sync wait). */
  waitForFinishSec?: number;
}

export interface InstagramScraperConfig {
  enabled?: boolean;
  actorId?: string;
  /** Run one Apify call per account (n8n loop) or batch all URLs (improved IG flows). */
  runMode?: "per_account" | "batch";
  resultsType?: "posts" | "comments" | "details" | "mentions" | "reels";
  resultsLimit?: number;
  scrapePosts?: boolean;
  scrapeReels?: boolean;
  scrapeStories?: boolean;
  datasetLimit?: number;
}

export interface TiktokScraperConfig {
  enabled?: boolean;
  actorId?: string;
  oldestPostDateUnified?: string;
  resultsPerPage?: number;
  profileSorting?: "latest" | "popular" | "oldest";
  profileScrapeSections?: string[];
  commentsPerPost?: number;
  maxRepliesPerComment?: number;
  maxFollowersPerProfile?: number;
  maxFollowingPerProfile?: number;
  excludePinnedPosts?: boolean;
  scrapeRelatedVideos?: boolean;
  shouldDownloadAvatars?: boolean;
  shouldDownloadCovers?: boolean;
  shouldDownloadMusicCovers?: boolean;
  shouldDownloadSlideshowImages?: boolean;
  shouldDownloadVideos?: boolean;
  videoKvStoreIdOrName?: string;
  downloadSubtitlesOptions?: string;
  maxProfilesPerQuery?: number;
  searchSection?: string;
  /** Merge hashtags from Sources → Hashtags tab. */
  useHashtagsFromSources?: boolean;
  /** Extra hashtags (n8n static list), one per line or comma-separated. */
  extraHashtags?: string[];
  /** Extra profile handles beyond TikTokAccounts sources. */
  extraProfiles?: string[];
  datasetLimit?: number;
}

export interface RedditScraperConfig {
  enabled?: boolean;
  actorId?: string;
  sortTime?: "hour" | "day" | "week" | "month" | "year" | "all";
  maxPostCount?: number;
  maxComments?: number;
  maxItems?: number;
  commentSort?: "top" | "new" | "controversial" | "old" | "qa";
  scrollTimeout?: number;
  searchPosts?: boolean;
  searchComments?: boolean;
  searchCommunities?: boolean;
  searchUsers?: boolean;
  datasetLimit?: number;
}

export interface FacebookScraperConfig {
  enabled?: boolean;
  actorId?: string;
  resultsLimit?: number;
  minLikes?: number;
  requireCaption?: boolean;
  datasetLimit?: number;
}

export interface HtmlScraperConfig {
  enabled?: boolean;
  fetchTimeoutMs?: number;
  userAgent?: string;
  minParagraphChars?: number;
  maxMainTextChars?: number;
}

export interface LinkedInScraperConfig {
  enabled?: boolean;
  /** harvestapi/linkedin-profile-posts */
  postsActorId?: string;
  /** harvestapi/linkedin-profile-search — optional niche/profile discovery */
  profileSearchActorId?: string;
  /** Run profile search on `linkedinsearches` sources before post scrape. */
  profileSearchEnabled?: boolean;
  /** Max posts per profile/company URL (Apify `maxPosts`). */
  maxPosts?: number;
  /** Max profiles returned per search query (Apify `maxItems`). */
  profileSearchMaxItems?: number;
  /** Apify `postedLimit` — 24h | week | month | 3months | 6months | year */
  postedLimit?: string;
  includeQuotePosts?: boolean;
  includeReposts?: boolean;
  scrapeReactions?: boolean;
  maxReactions?: number;
  scrapeComments?: boolean;
  maxComments?: number;
  datasetLimit?: number;
}

export interface ScraperProjectConfig {
  apify?: ApifyGlobalConfig;
  scrapers?: {
    instagram?: InstagramScraperConfig;
    tiktok?: TiktokScraperConfig;
    reddit?: RedditScraperConfig;
    facebook?: FacebookScraperConfig;
    html?: HtmlScraperConfig;
    linkedin?: LinkedInScraperConfig;
  };
  /** Deep-merge overrides onto built actor input (power users). */
  actorInputExtras?: Partial<
    Record<
      "instagram" | "tiktok" | "reddit" | "facebook" | "linkedin_posts" | "linkedin_profile_search",
      Record<string, unknown>
    >
  >;
}

export function defaultScraperConfig(): ScraperProjectConfig {
  return {
    apify: {
      useApifyProxy: true,
      proxyCountryCode: "US",
      waitForFinishSec: 600,
    },
    scrapers: {
      instagram: {
        enabled: true,
        runMode: "per_account",
        resultsType: "posts",
        resultsLimit: 10,
        scrapePosts: true,
        scrapeReels: true,
        scrapeStories: false,
        datasetLimit: 500,
      },
      tiktok: {
        enabled: true,
        oldestPostDateUnified: "7 days",
        resultsPerPage: 10,
        profileSorting: "latest",
        profileScrapeSections: ["videos"],
        commentsPerPost: 0,
        maxRepliesPerComment: 0,
        maxFollowersPerProfile: 0,
        maxFollowingPerProfile: 0,
        excludePinnedPosts: false,
        scrapeRelatedVideos: false,
        shouldDownloadAvatars: false,
        shouldDownloadCovers: true,
        shouldDownloadMusicCovers: false,
        shouldDownloadSlideshowImages: true,
        shouldDownloadVideos: true,
        videoKvStoreIdOrName: "caf-tiktok-astrology-media",
        downloadSubtitlesOptions: "DOWNLOAD_AND_TRANSCRIBE_VIDEOS_WITHOUT_SUBTITLES",
        maxProfilesPerQuery: 10,
        searchSection: "",
        useHashtagsFromSources: true,
        extraHashtags: [],
        extraProfiles: [],
        datasetLimit: 2000,
      },
      reddit: {
        enabled: true,
        sortTime: "week",
        maxPostCount: 30,
        maxComments: 3,
        maxItems: 40,
        commentSort: "top",
        scrollTimeout: 60,
        searchPosts: true,
        searchComments: true,
        searchCommunities: false,
        searchUsers: false,
        datasetLimit: 5000,
      },
      facebook: {
        enabled: true,
        resultsLimit: 30,
        minLikes: 5,
        requireCaption: true,
        datasetLimit: 500,
      },
      html: {
        enabled: true,
        fetchTimeoutMs: 30_000,
        userAgent: "Mozilla/5.0 (compatible; CAF-Core/1.0; +https://caf.local)",
        minParagraphChars: 30,
        maxMainTextChars: 30_000,
      },
      linkedin: {
        enabled: true,
        profileSearchEnabled: true,
        maxPosts: 20,
        profileSearchMaxItems: 20,
        postedLimit: "month",
        includeQuotePosts: false,
        includeReposts: false,
        scrapeReactions: false,
        maxReactions: 5,
        scrapeComments: false,
        maxComments: 5,
        datasetLimit: 2000,
      },
    },
    actorInputExtras: {},
  };
}

function mergeSection<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown> | undefined): T {
  if (!patch || typeof patch !== "object") return base;
  return { ...base, ...patch } as T;
}

export function mergeScraperConfig(stored: Record<string, unknown> | null | undefined): ScraperProjectConfig {
  const base = defaultScraperConfig();
  if (!stored || typeof stored !== "object") return base;
  const scrapersIn = stored.scrapers as Record<string, Record<string, unknown>> | undefined;
  const mergedScrapers: NonNullable<ScraperProjectConfig["scrapers"]> = {};
  for (const key of ["instagram", "tiktok", "reddit", "facebook", "html", "linkedin"] as const) {
    mergedScrapers[key] = mergeSection(
      (base.scrapers?.[key] ?? {}) as Record<string, unknown>,
      scrapersIn?.[key]
    ) as NonNullable<ScraperProjectConfig["scrapers"]>[typeof key];
  }
  return {
    apify: mergeSection(
      (base.apify ?? {}) as Record<string, unknown>,
      stored.apify as Record<string, unknown> | undefined
    ) as ApifyGlobalConfig,
    scrapers: mergedScrapers,
    actorInputExtras: {
      ...(base.actorInputExtras ?? {}),
      ...((stored.actorInputExtras as ScraperProjectConfig["actorInputExtras"]) ?? {}),
    },
  };
}

/** CAF injects these at run time from Sources — empty arrays in saved JSON must not wipe them. */
const ACTOR_INJECT_ARRAY_KEYS = new Set(["directUrls", "profiles", "startUrls"]);

function deepMergeActorInput(
  base: Record<string, unknown>,
  extras: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!extras) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(extras)) {
    if (Array.isArray(v) && v.length === 0 && ACTOR_INJECT_ARRAY_KEYS.has(k)) continue;
    if (v != null && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object" && out[k] != null && !Array.isArray(out[k])) {
      out[k] = { ...(out[k] as Record<string, unknown>), ...(v as Record<string, unknown>) };
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function resolveActorId(
  scraper: keyof typeof DEFAULT_ACTOR_IDS,
  cfg: { actorId?: string } | undefined
): string {
  const id = cfg?.actorId?.trim();
  return id || DEFAULT_ACTOR_IDS[scraper];
}

export function resolveLinkedInPostsActorId(cfg: LinkedInScraperConfig | undefined): string {
  return cfg?.postsActorId?.trim() || LINKEDIN_ACTOR_IDS.posts;
}

export function resolveLinkedInProfileSearchActorId(cfg: LinkedInScraperConfig | undefined): string {
  return cfg?.profileSearchActorId?.trim() || LINKEDIN_ACTOR_IDS.profileSearch;
}

export function buildInstagramApifyInput(
  cfg: ScraperProjectConfig,
  directUrls: string[]
): Record<string, unknown> {
  const ig = cfg.scrapers?.instagram ?? {};
  const apify = cfg.apify ?? {};
  const input: Record<string, unknown> = {
    directUrls,
    resultsType: ig.resultsType ?? "posts",
    resultsLimit: ig.resultsLimit ?? 10,
    scrapePosts: ig.scrapePosts !== false,
    scrapeReels: ig.scrapeReels !== false,
    scrapeStories: ig.scrapeStories === true,
    proxyConfiguration: { useApifyProxy: apify.useApifyProxy !== false },
  };
  return deepMergeActorInput(input, cfg.actorInputExtras?.instagram);
}

export function parseHashtagList(raw: string | string[] | undefined): string[] {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((h) => String(h).trim().replace(/^#/, "")).filter(Boolean))];
  }
  if (!raw?.trim()) return [];
  return [
    ...new Set(
      raw
        .split(/[\n,;]+/)
        .map((h) => h.trim().replace(/^#/, ""))
        .filter(Boolean)
    ),
  ];
}

export function hashtagsFromSourceRows(rows: Record<string, unknown>[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    for (const key of ["Hashtag", "hashtag", "Name", "name", "Tag", "tag", "Link", "link"]) {
      const v = String(row[key] ?? "")
        .trim()
        .replace(/^#/, "");
      if (!v || v.includes("http")) continue;
      out.push(v);
    }
  }
  return [...new Set(out)];
}

export function buildTiktokApifyInput(
  cfg: ScraperProjectConfig,
  profiles: string[],
  hashtagRows: Record<string, unknown>[]
): Record<string, unknown> {
  const tt = cfg.scrapers?.tiktok ?? {};
  const apify = cfg.apify ?? {};
  const hashtags: string[] = [];
  if (tt.useHashtagsFromSources !== false) {
    hashtags.push(...hashtagsFromSourceRows(hashtagRows));
  }
  hashtags.push(
    ...parseHashtagList(
      Array.isArray(tt.extraHashtags) ? tt.extraHashtags.join("\n") : String(tt.extraHashtags ?? "")
    )
  );
  const allProfiles = [
    ...profiles.map((p) => p.replace(/^@+/, "")),
    ...parseHashtagList(
      Array.isArray(tt.extraProfiles) ? tt.extraProfiles.join("\n") : String(tt.extraProfiles ?? "")
    ).map((p) => p.replace(/^@+/, "")),
  ].filter(Boolean);
  const uniqueProfiles = [...new Set(allProfiles)];

  const input: Record<string, unknown> = {
    commentsPerPost: tt.commentsPerPost ?? 0,
    excludePinnedPosts: tt.excludePinnedPosts === true,
    maxFollowersPerProfile: tt.maxFollowersPerProfile ?? 0,
    maxFollowingPerProfile: tt.maxFollowingPerProfile ?? 0,
    maxRepliesPerComment: tt.maxRepliesPerComment ?? 0,
    oldestPostDateUnified: tt.oldestPostDateUnified ?? "7 days",
    profileScrapeSections: tt.profileScrapeSections?.length ? tt.profileScrapeSections : ["videos"],
    profileSorting: tt.profileSorting ?? "latest",
    profiles: uniqueProfiles,
    proxyCountryCode: apify.proxyCountryCode ?? "US",
    resultsPerPage: tt.resultsPerPage ?? 10,
    scrapeRelatedVideos: tt.scrapeRelatedVideos === true,
    shouldDownloadAvatars: tt.shouldDownloadAvatars === true,
    shouldDownloadCovers: tt.shouldDownloadCovers !== false,
    shouldDownloadMusicCovers: tt.shouldDownloadMusicCovers === true,
    shouldDownloadSlideshowImages: tt.shouldDownloadSlideshowImages !== false,
    shouldDownloadVideos: tt.shouldDownloadVideos !== false,
    videoKvStoreIdOrName: tt.videoKvStoreIdOrName ?? "caf-tiktok-astrology-media",
    downloadSubtitlesOptions:
      tt.downloadSubtitlesOptions ?? "DOWNLOAD_AND_TRANSCRIBE_VIDEOS_WITHOUT_SUBTITLES",
    searchSection: tt.searchSection ?? "",
    maxProfilesPerQuery: tt.maxProfilesPerQuery ?? 10,
  };
  if (hashtags.length > 0) input.hashtags = hashtags;
  return deepMergeActorInput(input, cfg.actorInputExtras?.tiktok);
}

export function buildRedditApifyInputFromConfig(
  cfg: ScraperProjectConfig,
  subredditLinks: string[]
): Record<string, unknown> {
  const rd = cfg.scrapers?.reddit ?? {};
  const apify = cfg.apify ?? {};
  const sortTime = rd.sortTime ?? "week";
  const urls = subredditLinks
    .filter(Boolean)
    .map((u) => u.trim().replace(/\/+$/, ""))
    .map((u) => u.replace(/\/(new|hot|top|rising)(\/.*)?$/i, ""))
    .map((u) => `${u}/top/?t=${sortTime}`);

  const input: Record<string, unknown> = {
    startUrls: urls.map((url) => ({ url })),
    searchPosts: rd.searchPosts !== false,
    searchComments: rd.searchComments !== false,
    searchCommunities: rd.searchCommunities === true,
    searchUsers: rd.searchUsers === true,
    maxPostCount: rd.maxPostCount ?? 30,
    maxComments: rd.maxComments ?? 3,
    maxItems: rd.maxItems ?? 40,
    commentSort: rd.commentSort ?? "top",
    scrollTimeout: rd.scrollTimeout ?? 60,
    proxy: { useApifyProxy: apify.useApifyProxy !== false },
  };
  return deepMergeActorInput(input, cfg.actorInputExtras?.reddit);
}

/** LinkedIn HarvestAPI `postedLimit` from marketer post-age days. */
export function daysToLinkedInPostedLimit(days: number): NonNullable<LinkedInScraperConfig["postedLimit"]> {
  const d = Math.max(1, Math.floor(days));
  if (d <= 1) return "24h";
  if (d <= 7) return "week";
  if (d <= 30) return "month";
  if (d <= 90) return "3months";
  if (d <= 180) return "6months";
  return "year";
}

export function buildLinkedInPostsApifyInput(
  cfg: ScraperProjectConfig,
  targetUrls: string[]
): Record<string, unknown> {
  const li = cfg.scrapers?.linkedin ?? {};
  const input: Record<string, unknown> = {
    targetUrls: [...new Set(targetUrls.map((u) => u.trim()).filter(Boolean))],
    maxPosts: li.maxPosts ?? 20,
  };
  if (li.postedLimit?.trim()) input.postedLimit = li.postedLimit.trim();
  if (li.includeQuotePosts === true) input.includeQuotePosts = true;
  if (li.includeReposts === true) input.includeReposts = true;
  if (li.scrapeReactions === true) {
    input.scrapeReactions = true;
    if (li.maxReactions != null) input.maxReactions = li.maxReactions;
  }
  if (li.scrapeComments === true) {
    input.scrapeComments = true;
    if (li.maxComments != null) input.maxComments = li.maxComments;
  }
  return deepMergeActorInput(input, cfg.actorInputExtras?.linkedin_posts);
}

export function buildLinkedInProfileSearchApifyInput(
  cfg: ScraperProjectConfig,
  sourceRow: Record<string, unknown>
): Record<string, unknown> | null {
  const li = cfg.scrapers?.linkedin ?? {};
  const searchQuery = String(
    sourceRow.searchQuery ??
      sourceRow.SearchQuery ??
      sourceRow.query ??
      sourceRow.Name ??
      sourceRow.name ??
      ""
  ).trim();
  if (!searchQuery) return null;

  const input: Record<string, unknown> = {
    searchQuery,
    maxItems: li.profileSearchMaxItems ?? 20,
  };

  const passthroughKeys = [
    "locations",
    "currentCompanies",
    "pastCompanies",
    "schools",
    "currentJobTitles",
    "pastJobTitles",
    "industryIds",
    "functionIds",
    "seniorityLevelIds",
    "profileLanguages",
    "companyHeadcount",
    "recentlyPostedOnLinkedIn",
  ] as const;
  for (const key of passthroughKeys) {
    const v = sourceRow[key];
    if (v != null && v !== "") input[key] = v;
  }

  return deepMergeActorInput(input, cfg.actorInputExtras?.linkedin_profile_search);
}

export function buildFacebookApifyInput(
  cfg: ScraperProjectConfig,
  startUrl: string
): Record<string, unknown> {
  const fb = cfg.scrapers?.facebook ?? {};
  const apify = cfg.apify ?? {};
  const input: Record<string, unknown> = {
    startUrls: [{ url: startUrl }],
    resultsLimit: fb.resultsLimit ?? 30,
    proxyConfiguration: { useApifyProxy: apify.useApifyProxy !== false },
  };
  return deepMergeActorInput(input, cfg.actorInputExtras?.facebook);
}

export function apifyWaitSec(cfg: ScraperProjectConfig): number {
  const w = cfg.apify?.waitForFinishSec;
  if (w == null || !Number.isFinite(w)) return 600;
  return Math.min(Math.max(w, 30), 3600);
}

export function datasetLimitFor(
  cfg: ScraperProjectConfig,
  scraper: "instagram" | "tiktok" | "reddit" | "facebook" | "linkedin"
): number {
  const n = cfg.scrapers?.[scraper]?.datasetLimit;
  if (n == null || !Number.isFinite(n)) {
    const defaults: Record<string, number> = {
      instagram: 500,
      tiktok: 2000,
      reddit: 5000,
      facebook: 500,
      linkedin: 2000,
    };
    return defaults[scraper] ?? 1000;
  }
  return Math.min(Math.max(n, 1), 20_000);
}

/** UI field metadata for Admin scraper config form. */
export const SCRAPER_CONFIG_FIELDS = {
  apify: [
    { key: "useApifyProxy", label: "Use Apify proxy", type: "checkbox" as const },
    { key: "proxyCountryCode", label: "Proxy country code", type: "text" as const, placeholder: "US" },
    { key: "waitForFinishSec", label: "Wait for actor (seconds)", type: "number" as const, min: 30, max: 3600 },
  ],
  instagram: [
    { key: "enabled", label: "Enabled", type: "checkbox" as const },
    { key: "actorId", label: "Actor ID override", type: "text" as const, placeholder: DEFAULT_ACTOR_IDS.instagram },
    { key: "runMode", label: "Run mode", type: "select" as const, options: ["per_account", "batch"] },
    { key: "resultsType", label: "resultsType", type: "select" as const, options: ["posts", "comments", "details", "mentions", "reels"] },
    { key: "resultsLimit", label: "resultsLimit", type: "number" as const, min: 1, max: 200 },
    { key: "scrapePosts", label: "scrapePosts", type: "checkbox" as const },
    { key: "scrapeReels", label: "scrapeReels", type: "checkbox" as const },
    { key: "scrapeStories", label: "scrapeStories", type: "checkbox" as const },
    { key: "datasetLimit", label: "Dataset fetch limit", type: "number" as const, min: 1, max: 20000 },
  ],
  tiktok: [
    { key: "enabled", label: "Enabled", type: "checkbox" as const },
    { key: "actorId", label: "Actor ID override", type: "text" as const, placeholder: DEFAULT_ACTOR_IDS.tiktok },
    { key: "oldestPostDateUnified", label: "oldestPostDateUnified", type: "text" as const, placeholder: "7 days" },
    { key: "resultsPerPage", label: "resultsPerPage", type: "number" as const, min: 1, max: 100 },
    { key: "profileSorting", label: "profileSorting", type: "select" as const, options: ["latest", "popular", "oldest"] },
    { key: "profileScrapeSections", label: "profileScrapeSections (comma)", type: "text" as const, placeholder: "videos" },
    { key: "commentsPerPost", label: "commentsPerPost", type: "number" as const, min: 0, max: 100 },
    { key: "maxRepliesPerComment", label: "maxRepliesPerComment", type: "number" as const, min: 0, max: 100 },
    { key: "maxProfilesPerQuery", label: "maxProfilesPerQuery", type: "number" as const, min: 1, max: 50 },
    { key: "excludePinnedPosts", label: "excludePinnedPosts", type: "checkbox" as const },
    { key: "scrapeRelatedVideos", label: "scrapeRelatedVideos", type: "checkbox" as const },
    { key: "shouldDownloadCovers", label: "shouldDownloadCovers", type: "checkbox" as const },
    { key: "shouldDownloadSlideshowImages", label: "shouldDownloadSlideshowImages", type: "checkbox" as const },
    { key: "shouldDownloadVideos", label: "shouldDownloadVideos", type: "checkbox" as const },
    { key: "shouldDownloadAvatars", label: "shouldDownloadAvatars", type: "checkbox" as const },
    { key: "shouldDownloadMusicCovers", label: "shouldDownloadMusicCovers", type: "checkbox" as const },
    { key: "videoKvStoreIdOrName", label: "videoKvStoreIdOrName", type: "text" as const },
    { key: "downloadSubtitlesOptions", label: "downloadSubtitlesOptions", type: "text" as const },
    { key: "searchSection", label: "searchSection", type: "text" as const },
    { key: "useHashtagsFromSources", label: "Use hashtags from Sources tab", type: "checkbox" as const },
    { key: "extraHashtags", label: "Extra hashtags (comma or newline)", type: "textarea" as const },
    { key: "extraProfiles", label: "Extra profiles (comma or newline, no @ required)", type: "textarea" as const },
    { key: "datasetLimit", label: "Dataset fetch limit", type: "number" as const, min: 1, max: 20000 },
  ],
  reddit: [
    { key: "enabled", label: "Enabled", type: "checkbox" as const },
    { key: "actorId", label: "Actor ID override", type: "text" as const, placeholder: DEFAULT_ACTOR_IDS.reddit },
    { key: "sortTime", label: "Listing window (/top/?t=)", type: "select" as const, options: ["hour", "day", "week", "month", "year", "all"] },
    { key: "maxPostCount", label: "maxPostCount", type: "number" as const, min: 1, max: 500 },
    { key: "maxComments", label: "maxComments", type: "number" as const, min: 0, max: 50 },
    { key: "maxItems", label: "maxItems", type: "number" as const, min: 1, max: 500 },
    { key: "commentSort", label: "commentSort", type: "select" as const, options: ["top", "new", "controversial", "old", "qa"] },
    { key: "scrollTimeout", label: "scrollTimeout (sec)", type: "number" as const, min: 10, max: 300 },
    { key: "searchPosts", label: "searchPosts", type: "checkbox" as const },
    { key: "searchComments", label: "searchComments", type: "checkbox" as const },
    { key: "searchCommunities", label: "searchCommunities", type: "checkbox" as const },
    { key: "searchUsers", label: "searchUsers", type: "checkbox" as const },
    { key: "datasetLimit", label: "Dataset fetch limit", type: "number" as const, min: 1, max: 20000 },
  ],
  facebook: [
    { key: "enabled", label: "Enabled", type: "checkbox" as const },
    { key: "actorId", label: "Actor ID override", type: "text" as const, placeholder: DEFAULT_ACTOR_IDS.facebook },
    { key: "resultsLimit", label: "resultsLimit", type: "number" as const, min: 1, max: 500 },
    { key: "minLikes", label: "Post-filter min likes", type: "number" as const, min: 0, max: 100000 },
    { key: "requireCaption", label: "Require caption (post-filter)", type: "checkbox" as const },
    { key: "datasetLimit", label: "Dataset fetch limit", type: "number" as const, min: 1, max: 20000 },
  ],
  html: [
    { key: "enabled", label: "Enabled", type: "checkbox" as const },
    { key: "fetchTimeoutMs", label: "Fetch timeout (ms)", type: "number" as const, min: 5000, max: 120000 },
    { key: "userAgent", label: "User-Agent", type: "text" as const },
    { key: "minParagraphChars", label: "Min paragraph length", type: "number" as const, min: 10, max: 500 },
    { key: "maxMainTextChars", label: "Max main_text chars", type: "number" as const, min: 1000, max: 100000 },
  ],
  linkedin: [
    { key: "enabled", label: "Enabled", type: "checkbox" as const },
    {
      key: "postsActorId",
      label: "Posts actor ID",
      type: "text" as const,
      placeholder: LINKEDIN_ACTOR_IDS.posts,
    },
    {
      key: "profileSearchActorId",
      label: "Profile search actor ID",
      type: "text" as const,
      placeholder: LINKEDIN_ACTOR_IDS.profileSearch,
    },
    { key: "profileSearchEnabled", label: "Run profile search (linkedinsearches tab)", type: "checkbox" as const },
    { key: "maxPosts", label: "maxPosts (per profile/company)", type: "number" as const, min: 1, max: 100 },
    { key: "profileSearchMaxItems", label: "maxItems (per search query)", type: "number" as const, min: 1, max: 500 },
    {
      key: "postedLimit",
      label: "postedLimit",
      type: "select" as const,
      options: ["24h", "week", "month", "3months", "6months", "year"],
    },
    { key: "includeQuotePosts", label: "includeQuotePosts", type: "checkbox" as const },
    { key: "includeReposts", label: "includeReposts", type: "checkbox" as const },
    { key: "scrapeReactions", label: "scrapeReactions", type: "checkbox" as const },
    { key: "maxReactions", label: "maxReactions", type: "number" as const, min: 0, max: 100 },
    { key: "scrapeComments", label: "scrapeComments", type: "checkbox" as const },
    { key: "maxComments", label: "maxComments", type: "number" as const, min: 0, max: 100 },
    { key: "datasetLimit", label: "Dataset fetch limit", type: "number" as const, min: 1, max: 20000 },
  ],
} as const;

export type ScraperPlatformKey = "instagram" | "tiktok" | "html" | "facebook" | "reddit" | "linkedin";

/** Human-facing post age → Apify `oldestPostDateUnified` / `onlyPostsNewerThan` label. */
export function daysToOldestPostDateLabel(days: number): string {
  const d = Math.max(1, Math.floor(days));
  if (d === 1) return "1 day";
  if (d < 30) return `${d} days`;
  if (d <= 45) return "1 month";
  if (d <= 75) return "2 months";
  if (d <= 105) return "3 months";
  if (d <= 200) return "6 months";
  return "1 year";
}

/** Reddit listing window from marketer post-age days. */
export function daysToRedditSortTime(days: number): RedditScraperConfig["sortTime"] {
  const d = Math.max(1, Math.floor(days));
  if (d <= 1) return "day";
  if (d <= 7) return "week";
  if (d <= 30) return "month";
  if (d <= 365) return "year";
  return "all";
}

/** Apply per-run post age limits without persisting project scraper config. */
export function applyPostMaxAgeToConfig(
  cfg: ScraperProjectConfig,
  days: number,
  platforms?: ScraperPlatformKey[]
): ScraperProjectConfig {
  const out: ScraperProjectConfig = JSON.parse(JSON.stringify(cfg)) as ScraperProjectConfig;
  const ageLabel = daysToOldestPostDateLabel(days);
  const platformSet = platforms?.length ? new Set(platforms) : null;

  const forPlatform = (key: ScraperPlatformKey): boolean => !platformSet || platformSet.has(key);

  if (forPlatform("tiktok")) {
    out.scrapers = out.scrapers ?? {};
    out.scrapers.tiktok = { ...out.scrapers.tiktok, oldestPostDateUnified: ageLabel };
  }
  if (forPlatform("reddit")) {
    out.scrapers = out.scrapers ?? {};
    out.scrapers.reddit = { ...out.scrapers.reddit, sortTime: daysToRedditSortTime(days) };
  }
  if (forPlatform("instagram")) {
    out.actorInputExtras = out.actorInputExtras ?? {};
    out.actorInputExtras.instagram = {
      ...(out.actorInputExtras.instagram ?? {}),
      onlyPostsNewerThan: ageLabel,
    };
  }
  if (forPlatform("facebook")) {
    out.actorInputExtras = out.actorInputExtras ?? {};
    out.actorInputExtras.facebook = {
      ...(out.actorInputExtras.facebook ?? {}),
      onlyPostsNewerThan: ageLabel,
    };
  }
  if (forPlatform("linkedin")) {
    out.scrapers = out.scrapers ?? {};
    out.scrapers.linkedin = {
      ...out.scrapers.linkedin,
      postedLimit: daysToLinkedInPostedLimit(days),
    };
  }
  return out;
}
