"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

const MAX_CUES_PER_FORMAT = 10;

type FormatFamily = "carousel" | "video" | "single_image" | "mixed" | "other";

const FORMAT_FAMILY_ORDER: FormatFamily[] = ["carousel", "video", "single_image", "mixed", "other"];

const CAROUSEL_FORMAT_KEYS = new Set([
  "educational",
  "listicle",
  "story",
  "before_after",
  "promo",
  "meme grid",
  "meme_grid",
]);
const VIDEO_FORMAT_KEYS = new Set(["talking_head", "b_roll", "text_on_screen", "ugc", "product_demo"]);

const FORMAT_FAMILY_LABELS: Record<FormatFamily, string> = {
  carousel: "Carousel",
  video: "Video",
  single_image: "Single image",
  mixed: "Mixed",
  other: "Other",
};

const FORMAT_HINTS: Record<string, string> = {
  listicle:
    "Listicle = swipeable carousel where each slide is one list item (e.g. one zodiac sign, one tip).",
  educational: "Educational = teaches something step-by-step across slides.",
  text_on_screen: "Text on screen = the hook is mostly written text on the image/video.",
  talking_head: "Talking head = creator speaks to camera; face is the main visual.",
  mixed: "Mixed = combination of talking head, B-roll, and text overlays.",
};

type InspectionMedia = {
  storage_bucket?: string | null;
  folder_prefix?: string | null;
  storage_folder_label?: string | null;
  skipped_reason?: string | null;
  items?: Array<{
    role?: string;
    object_path?: string | null;
    bucket?: string | null;
    public_url?: string | null;
    vision_fetch_url?: string | null;
    index?: number | null;
  }>;
};

export type VisualGuidelineEntry = Record<string, unknown> & {
  insights_id?: string;
  format_pattern?: string;
  format_key?: string;
  source_evidence_row_id?: string;
  evidence_kind?: string;
  evidence_post_url?: string | null;
  why_it_worked?: string;
  inspection_media?: InspectionMedia;
};

const THUMBNAIL_ROLES = ["carousel_slide", "video_frame", "evidence_media"];

function pickInspectionMediaPreviewUrl(media: InspectionMedia | null): string | null {
  if (!media?.items?.length) return null;
  const items = media.items;
  const ranked = [
    ...items.filter((it) => THUMBNAIL_ROLES.includes(String(it.role ?? ""))),
    ...items,
  ];
  const seen = new Set<string>();
  for (const it of ranked) {
    const u = (it.vision_fetch_url ?? it.public_url ?? "").trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    return u;
  }
  return null;
}

function normalizeInstagramPostUrl(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t.startsWith("http")) return null;
  if (!/instagram\.com/i.test(t)) return t;
  try {
    const u = new URL(t);
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return t;
  }
}

export type VisualGuidelineCueGroup = {
  format_pattern: string;
  format_key: string;
  cues: string[];
  example_insights_ids: string[];
};

export type VisualGuidelinesPackView = {
  version?: number;
  generated_at?: string;
  inputs_import_id?: string;
  insights_scanned?: number;
  entries: VisualGuidelineEntry[];
  visual_guideline_cues?: string[];
  visual_guideline_cues_by_format?: VisualGuidelineCueGroup[];
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function parseInspectionMedia(v: unknown): InspectionMedia | null {
  const r = asRecord(v);
  if (!r) return null;
  const items = Array.isArray(r.items)
    ? r.items.map((it) => {
        const o = asRecord(it);
        if (!o) return null;
        return {
          role: String(o.role ?? ""),
          object_path: typeof o.object_path === "string" ? o.object_path : null,
          bucket: typeof o.bucket === "string" ? o.bucket : null,
          public_url: typeof o.public_url === "string" ? o.public_url : null,
          vision_fetch_url: typeof o.vision_fetch_url === "string" ? o.vision_fetch_url : null,
          index: typeof o.index === "number" ? o.index : null,
        };
      }).filter((x): x is NonNullable<typeof x> => x != null)
    : [];
  return {
    storage_bucket: typeof r.storage_bucket === "string" ? r.storage_bucket : null,
    folder_prefix: typeof r.folder_prefix === "string" ? r.folder_prefix : null,
    storage_folder_label: typeof r.storage_folder_label === "string" ? r.storage_folder_label : null,
    skipped_reason: typeof r.skipped_reason === "string" ? r.skipped_reason : null,
    items,
  };
}

function cueStringsFromEntry(e: VisualGuidelineEntry): string[] {
  const out: string[] = [];
  const push = (s: string | null | undefined) => {
    const t = (s ?? "").trim();
    if (t.length >= 4) out.push(t.length > 220 ? `${t.slice(0, 220)}…` : t);
  };
  push(typeof e.why_it_worked === "string" ? e.why_it_worked : null);
  push(typeof e.visual_consistency === "string" ? e.visual_consistency : null);
  const rb = asRecord(e.replication_blueprint);
  if (rb && Array.isArray(rb.steps_to_remake)) {
    for (const step of rb.steps_to_remake) push(String(step));
  }
  return out;
}

function buildCueGroupsFromEntries(entries: VisualGuidelineEntry[]): VisualGuidelineCueGroup[] {
  const byKey = new Map<string, VisualGuidelineCueGroup>();
  for (const e of entries) {
    const fp = String(e.format_pattern ?? "unknown");
    const key = String(e.format_key ?? fp.split("|")[0]?.trim() ?? "unknown");
    let g = byKey.get(key);
    if (!g) {
      g = { format_pattern: fp, format_key: key, cues: [], example_insights_ids: [] };
      byKey.set(key, g);
    }
    const id = String(e.insights_id ?? "").trim();
    if (id && !g.example_insights_ids.includes(id) && g.example_insights_ids.length < 12) {
      g.example_insights_ids.push(id);
    }
    const seen = new Set(g.cues.map((c) => c.toLowerCase()));
    for (const c of cueStringsFromEntry(e)) {
      const k = c.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      g.cues.push(c);
    }
  }
  return [...byKey.values()].sort((a, b) => b.cues.length - a.cues.length);
}

function cueFingerprint(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNearDuplicateCue(candidate: string, existing: string[]): boolean {
  const fc = cueFingerprint(candidate);
  if (fc.length < 10) return false;
  for (const e of existing) {
    const fe = cueFingerprint(e);
    if (fc === fe) return true;
    const shorter = fc.length <= fe.length ? fc : fe;
    const longer = fc.length > fe.length ? fc : fe;
    if (shorter.length >= 36 && longer.includes(shorter)) return true;
    const sw = shorter.split(" ").filter((w) => w.length > 3);
    const lw = new Set(longer.split(" ").filter((w) => w.length > 3));
    let hit = 0;
    for (const w of sw) if (lw.has(w)) hit++;
    if (sw.length >= 4 && hit / sw.length >= 0.72) return true;
    const perf = /\b(humor|relat|engag|audience|resonat)\b/;
    if (perf.test(fc) && perf.test(fe) && hit / Math.max(sw.length, 1) >= 0.4) return true;
  }
  return false;
}

function compactCuesForDisplay(cues: string[], max: number): string[] {
  const unique: string[] = [];
  for (const raw of cues) {
    const t = raw.trim();
    if (t.length < 4) continue;
    const line = t.length > 220 ? `${t.slice(0, 220)}…` : t;
    if (isNearDuplicateCue(line, unique)) continue;
    unique.push(line);
  }
  const score = (s: string) => {
    if (/^(create|use|choose|select|ensure|add|design|craft)\b/i.test(s)) return 4;
    if (s.length <= 90) return 3;
    if (/^(the deck|the carousel|this instagram)\b/i.test(s)) return 0;
    return 1;
  };
  unique.sort((a, b) => score(b) - score(a));
  const out: string[] = [];
  for (const c of unique) {
    if (isNearDuplicateCue(c, out)) continue;
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

function entryIdsForGroup(group: VisualGuidelineCueGroup, entries: VisualGuidelineEntry[]): VisualGuidelineEntry[] {
  const ids = new Set(group.example_insights_ids);
  return entries.filter((e) => {
    const ins = String(e.insights_id ?? "");
    const key = String(e.format_key ?? String(e.format_pattern ?? "").split("|")[0]?.trim());
    return ids.has(ins) || key === group.format_key;
  });
}

function humanizeFormatKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function inferFormatFamilyFromTier(tier: string): FormatFamily | null {
  const t = tier.toLowerCase();
  if (t.includes("carousel")) return "carousel";
  if (t.includes("video")) return "video";
  if (t.includes("deep") || t.includes("image")) return "single_image";
  return null;
}

function inferFormatFamilyFromKey(formatKey: string): FormatFamily | null {
  const key = formatKey.toLowerCase().trim();
  if (CAROUSEL_FORMAT_KEYS.has(key)) return "carousel";
  if (VIDEO_FORMAT_KEYS.has(key)) return "video";
  if (key === "mixed") return "mixed";
  return null;
}

function inferFormatFamilyFromEntry(entry: VisualGuidelineEntry): FormatFamily {
  const fromTier = inferFormatFamilyFromTier(String(entry.analysis_tier ?? ""));
  if (fromTier) return fromTier;
  const formatKey = String(entry.format_key ?? String(entry.format_pattern ?? "").split("|")[0]?.trim() ?? "");
  const fromKey = inferFormatFamilyFromKey(formatKey);
  if (fromKey) return fromKey;
  const media = parseInspectionMedia(entry.inspection_media);
  const roles = new Set((media?.items ?? []).map((it) => String(it.role ?? "")));
  if (roles.has("carousel_slide")) return "carousel";
  if (roles.has("video_frame") || roles.has("source_video")) return "video";
  if (roles.has("evidence_media")) return "single_image";
  return "other";
}

function inferFormatFamilyForGroup(group: VisualGuidelineCueGroup, entries: VisualGuidelineEntry[]): FormatFamily {
  const related = entryIdsForGroup(group, entries);
  const tallies = new Map<FormatFamily, number>();
  for (const entry of related) {
    const fam = inferFormatFamilyFromEntry(entry);
    tallies.set(fam, (tallies.get(fam) ?? 0) + 1);
  }
  let best: FormatFamily = "other";
  let bestCount = -1;
  for (const [fam, count] of tallies) {
    if (count > bestCount) {
      best = fam;
      bestCount = count;
    }
  }
  if (bestCount > 0) return best;
  const fromKey = inferFormatFamilyFromKey(group.format_key);
  if (fromKey) return fromKey;
  const fromPattern = inferFormatFamilyFromKey(group.format_pattern.split("|")[0]?.trim() ?? "");
  return fromPattern ?? "other";
}

function groupCueGroupsByFamily(
  groups: VisualGuidelineCueGroup[],
  entries: VisualGuidelineEntry[]
): Array<{ family: FormatFamily; groups: VisualGuidelineCueGroup[] }> {
  const byFamily = new Map<FormatFamily, VisualGuidelineCueGroup[]>();
  for (const group of groups) {
    const family = inferFormatFamilyForGroup(group, entries);
    const list = byFamily.get(family) ?? [];
    list.push(group);
    byFamily.set(family, list);
  }
  for (const list of byFamily.values()) {
    list.sort((a, b) => b.cues.length - a.cues.length || a.format_key.localeCompare(b.format_key));
  }
  return FORMAT_FAMILY_ORDER.filter((family) => byFamily.has(family)).map((family) => ({
    family,
    groups: byFamily.get(family)!,
  }));
}

function entryFormatSubtitle(entry: VisualGuidelineEntry): string {
  const key = String(entry.format_key ?? String(entry.format_pattern ?? "").split("|")[0]?.trim() ?? "unknown");
  return humanizeFormatKey(key);
}

export function VisualGuidelinesPanel(props: {
  visualPack: VisualGuidelinesPackView;
  ideasFromInsightsMeta: Record<string, unknown> | null;
  importId: string | null;
  navHref: (path: string) => string;
}) {
  const { visualPack, ideasFromInsightsMeta, importId, navHref } = props;
  const entries = visualPack.entries ?? [];
  const [expandedFormat, setExpandedFormat] = useState<string | null>(null);

  const cueGroups = useMemo(() => {
    const raw =
      visualPack.visual_guideline_cues_by_format?.length
        ? visualPack.visual_guideline_cues_by_format
        : buildCueGroupsFromEntries(entries);
    const groups =
      raw.length > 0
        ? raw
        : visualPack.visual_guideline_cues?.length
          ? [{ format_pattern: "mixed", format_key: "all", cues: visualPack.visual_guideline_cues, example_insights_ids: [] }]
          : [];
    return groups.map((g) => ({
      ...g,
      cues: compactCuesForDisplay(g.cues, MAX_CUES_PER_FORMAT),
    }));
  }, [visualPack.visual_guideline_cues_by_format, visualPack.visual_guideline_cues, entries]);

  const flatCueCount =
    visualPack.visual_guideline_cues?.length ??
    cueGroups.reduce((n, g) => n + g.cues.length, 0);

  const cueGroupsByFamily = useMemo(
    () => groupCueGroupsByFamily(cueGroups, entries),
    [cueGroups, entries]
  );

  const familyCount = cueGroupsByFamily.length;

  return (
    <section>
      <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12, maxWidth: 820 }}>
        Top-performer vision distilled into cues and per-post entries. Open{" "}
        <strong>Storage folder</strong> links to inspect archived slides/frames in Supabase (
        <code style={{ fontSize: 12 }}>top_performer_inspection/</code> or{" "}
        <code style={{ fontSize: 12 }}>evidence_media/</code>).
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 10,
          marginBottom: 16,
          fontSize: 13,
        }}
      >
        <MetaChip label="Version" value={String(visualPack.version ?? "—")} />
        <MetaChip label="Insights scanned" value={String(visualPack.insights_scanned ?? "—")} />
        <MetaChip label="Entries" value={String(entries.length)} />
        <MetaChip label="Format families" value={String(familyCount)} />
        <MetaChip label="Format styles" value={String(cueGroups.length)} />
        <MetaChip label="Cues" value={String(flatCueCount)} />
        {visualPack.generated_at ? <MetaChip label="Generated" value={fmt(visualPack.generated_at)} /> : null}
        {ideasFromInsightsMeta?.top_performer_rows_in_context != null ? (
          <MetaChip label="TP in ideas LLM" value={String(ideasFromInsightsMeta.top_performer_rows_in_context)} />
        ) : null}
      </div>

      <h3 style={{ fontSize: 14, margin: "8px 0 10px" }}>Cues by format</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 24 }}>
        {cueGroupsByFamily.map(({ family, groups }) => (
          <div key={family}>
            <h4 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 8px", color: "var(--fg)" }}>
              {FORMAT_FAMILY_LABELS[family]}
              <span style={{ color: "var(--muted)", fontWeight: 500, marginLeft: 8 }}>
                {groups.length} style{groups.length === 1 ? "" : "s"}
              </span>
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {groups.map((group) => {
                const expandKey = `${family}:${group.format_key}`;
                const open = expandedFormat === expandKey;
                const examples = entryIdsForGroup(group, entries).slice(0, 6);
                return (
                  <div
                    key={expandKey}
                    style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedFormat(open ? null : expandKey)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        background: "var(--surface-2, #151515)",
                        border: "none",
                        color: "inherit",
                        cursor: "pointer",
                        fontSize: 13,
                      }}
                    >
                      <strong>{humanizeFormatKey(group.format_key)}</strong>
                      <span style={{ color: "var(--muted)", marginLeft: 8 }}>
                        {group.cues.length} cues · {examples.length} example{examples.length === 1 ? "" : "s"}
                      </span>
                      <span style={{ float: "right", color: "var(--muted)" }}>{open ? "▾" : "▸"}</span>
                    </button>
                    {open && (
                      <div style={{ padding: "12px 14px" }}>
                        {FORMAT_HINTS[group.format_key] ? (
                          <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 10px" }}>
                            {FORMAT_HINTS[group.format_key]}
                          </p>
                        ) : null}
                        {group.format_pattern !== group.format_key && (
                          <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
                            Full pattern: <code>{group.format_pattern}</code>
                          </p>
                        )}
                        <p style={{ fontSize: 11, color: "var(--muted)", margin: "0 0 8px" }}>
                          Showing up to {MAX_CUES_PER_FORMAT} non-redundant cues. Per-post JSON and assets are under
                          Examples.
                        </p>
                        <ul style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 13 }}>
                          {group.cues.map((c, i) => (
                            <li key={i} style={{ marginBottom: 6 }}>
                              {c}
                            </li>
                          ))}
                        </ul>
                        {examples.length > 0 && (
                          <>
                            <p style={{ fontSize: 12, fontWeight: 600, margin: "0 0 8px" }}>Examples</p>
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                              {examples.map((ex) => (
                                <EntryMediaCard
                                  key={String(ex.insights_id)}
                                  entry={ex}
                                  importId={importId}
                                  navHref={navHref}
                                  compact
                                />
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 14, margin: "8px 0 10px" }}>All entries ({entries.length})</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {entries.map((entry, i) => (
          <EntryMediaCard
            key={String(entry.insights_id ?? i)}
            entry={entry}
            importId={importId}
            navHref={navHref}
          />
        ))}
      </div>

      <details style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--muted)" }}>
          Full visual_guidelines_pack_v1 JSON
        </summary>
        <JsonPre value={visualPack} />
      </details>
    </section>
  );
}

function EntryMediaCard(props: {
  entry: VisualGuidelineEntry;
  importId: string | null;
  navHref: (path: string) => string;
  compact?: boolean;
}) {
  const { entry, importId, navHref, compact } = props;
  const media = parseInspectionMedia(entry.inspection_media);
  const previewUrl = pickInspectionMediaPreviewUrl(media);
  const instagramUrl = normalizeInstagramPostUrl(
    typeof entry.evidence_post_url === "string" ? entry.evidence_post_url : null
  );
  const thumbSize = compact ? 48 : 72;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: compact ? "8px 10px" : "10px 12px",
        fontSize: 13,
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      {previewUrl ? (
        <a href={previewUrl} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt=""
            style={{
              width: thumbSize,
              height: thumbSize,
              objectFit: "cover",
              borderRadius: 6,
              border: "1px solid var(--border)",
            }}
          />
        </a>
      ) : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ marginBottom: 4 }}>
          <strong>{FORMAT_FAMILY_LABELS[inferFormatFamilyFromEntry(entry)]}</strong>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{entryFormatSubtitle(entry)}</div>
          {entry.evidence_kind ? (
            <span style={{ color: "var(--muted)", fontSize: 11, marginLeft: 0, display: "block", marginTop: 2 }}>
              {String(entry.evidence_kind)}
            </span>
          ) : null}
        </div>
        {instagramUrl ? (
          <p style={{ margin: "0 0 6px", fontSize: 12 }}>
            <a
              href={instagramUrl}
              target="_blank"
              rel="noreferrer"
              className="detail-back"
              style={{ fontSize: 12, wordBreak: "break-all" }}
            >
              Open on Instagram ↗
            </a>
          </p>
        ) : null}
        {entry.why_it_worked ? (
          <p style={{ margin: "0 0 6px", color: "var(--muted)", fontSize: 12 }}>
            {String(entry.why_it_worked).slice(0, compact ? 120 : 280)}
            {String(entry.why_it_worked).length > (compact ? 120 : 280) ? "…" : ""}
          </p>
        ) : null}
        <MediaLinks media={media} />
        {importId && entry.source_evidence_row_id ? (
          <p style={{ margin: "6px 0 0", fontSize: 11 }}>
            <Link
              href={navHref(`/pipeline/evidence/${importId}`)}
              className="detail-back"
              style={{ fontSize: 11 }}
            >
              Evidence import
            </Link>
            <span style={{ color: "var(--muted)" }}> · row {String(entry.source_evidence_row_id)}</span>
          </p>
        ) : null}
        {!compact && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", fontSize: 11, color: "var(--muted)" }}>Entry JSON</summary>
            <JsonPre value={entry} maxHeight={280} />
          </details>
        )}
      </div>
    </div>
  );
}

function MediaLinks({ media }: { media: InspectionMedia | null }) {
  if (!media) {
    return (
      <p style={{ margin: 0, fontSize: 11, color: "var(--yellow)" }}>
        No archived media on this entry — re-run top-performer with archive enabled, then refresh.
      </p>
    );
  }
  if (media.skipped_reason) {
    return (
      <p style={{ margin: 0, fontSize: 11, color: "var(--yellow)" }}>
        Archive skipped: {media.skipped_reason}
      </p>
    );
  }

  const folder = media.storage_folder_label ?? media.folder_prefix;
  const firstOpen = pickInspectionMediaPreviewUrl(media);

  return (
    <div style={{ fontSize: 11 }}>
      {folder ? (
        <p style={{ margin: "0 0 4px" }}>
          <span style={{ color: "var(--muted)" }}>Storage folder: </span>
          <code style={{ wordBreak: "break-all" }}>{folder}</code>
        </p>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {firstOpen && (
          <a href={firstOpen} target="_blank" rel="noreferrer" className="detail-back" style={{ fontSize: 11 }}>
            Open asset
          </a>
        )}
        {(media.items ?? []).slice(0, compactMaxItems(media.items?.length ?? 0)).map((it, i) => {
          const url = (it.vision_fetch_url ?? it.public_url)?.trim() || null;
          if (!url) return null;
          const label = it.role ? `${it.role}${it.index != null ? ` ${it.index}` : ""}` : `file ${i + 1}`;
          return (
            <a key={`${url}-${i}`} href={url} target="_blank" rel="noreferrer" className="detail-back" style={{ fontSize: 11 }}>
              {label}
            </a>
          );
        })}
        {(media.items?.length ?? 0) > 6 ? (
          <span style={{ color: "var(--muted)" }}>+{(media.items?.length ?? 0) - 6} more in JSON</span>
        ) : null}
      </div>
    </div>
  );
}

function compactMaxItems(n: number): number {
  return Math.min(n, 6);
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--surface-2, #151515)",
      }}
    >
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: 12 }}>{value}</div>
    </div>
  );
}

function JsonPre({ value, maxHeight = 420 }: { value: unknown; maxHeight?: number }) {
  let text = "";
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return (
    <pre
      style={{
        marginTop: 10,
        fontSize: 11,
        lineHeight: 1.45,
        maxHeight,
        overflow: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        padding: 12,
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--surface-2, #111)",
      }}
    >
      {text}
    </pre>
  );
}

function fmt(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}
