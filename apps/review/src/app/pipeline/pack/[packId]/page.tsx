"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useReviewProject } from "@/components/ReviewProjectContext";
import {
  VisualGuidelinesPanel,
  type VisualGuidelinesPackView,
} from "@/components/VisualGuidelinesPanel";
import { CafPageHeader } from "@/components/CafOptionsMenu";
import { CafTerm } from "@/components/CafTerm";
import { JsonTreeViewer } from "@/components/JsonTreeViewer";

type PackView = "ideas" | "hashtags" | "visual" | "raw";

type HashtagLeaderboardEntry = {
  hashtag: string;
  count: number;
  weight: number;
  avg_rating_score: number | null;
};


function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export default function SignalPackDetailPage() {
  const params = useParams();
  const packId = String(params.packId ?? "");
  const { activeProjectSlug, lockedSlug, navHref } = useReviewProject();
  const slug = (activeProjectSlug || lockedSlug || "").trim();
  const qs = useMemo(() => (slug ? `?project=${encodeURIComponent(slug)}` : ""), [slug]);

  const [pack, setPack] = useState<Record<string, unknown> | null>(null);
  const [view, setView] = useState<PackView>("ideas");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!packId || !slug) return;
    setError(null);
    try {
      const hydrateQs = qs ? `${qs}&hydrate_visual_media=1` : "?hydrate_visual_media=1";
      const res = await fetch(`/api/pipeline/signal-packs/${packId}${hydrateQs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const j = (await res.json()) as { signal_pack: Record<string, unknown> };
      setPack(j.signal_pack ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }, [packId, qs, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const derived = useMemo(() => asRecord(pack?.derived_globals_json), [pack]);

  const hashtagLeaderboard = useMemo((): HashtagLeaderboardEntry[] => {
    const raw = asArray(derived?.hashtag_leaderboard_v1);
    const out: HashtagLeaderboardEntry[] = [];
    for (const row of raw) {
      const r = asRecord(row);
      if (!r || typeof r.hashtag !== "string") continue;
      out.push({
        hashtag: r.hashtag,
        count: Number(r.count) || 0,
        weight: Number(r.weight) || 0,
        avg_rating_score:
          r.avg_rating_score == null || r.avg_rating_score === ""
            ? null
            : Number(r.avg_rating_score),
      });
    }
    return out;
  }, [derived]);

  const visualPack = useMemo((): VisualGuidelinesPackView | null => {
    const v = asRecord(derived?.visual_guidelines_pack_v1);
    if (!v) return null;
    const entries = asArray(v.entries).filter((x): x is Record<string, unknown> => asRecord(x) != null) as Record<
      string,
      unknown
    >[];
    const cues = asArray(v.visual_guideline_cues)
      .map((x) => String(x ?? "").trim())
      .filter(Boolean);
    const cuesByFormat = asArray(v.visual_guideline_cues_by_format)
      .map((g) => asRecord(g))
      .filter((g): g is Record<string, unknown> => g != null)
      .map((g) => ({
        format_pattern: String(g.format_pattern ?? "unknown"),
        format_key: String(g.format_key ?? "unknown"),
        cues: asArray(g.cues).map((x) => String(x ?? "").trim()).filter(Boolean),
        example_insights_ids: asArray(g.example_insights_ids)
          .map((x) => String(x ?? "").trim())
          .filter(Boolean),
      }));
    return {
      version: typeof v.version === "number" ? v.version : undefined,
      generated_at: typeof v.generated_at === "string" ? v.generated_at : undefined,
      inputs_import_id: typeof v.inputs_import_id === "string" ? v.inputs_import_id : undefined,
      insights_scanned: typeof v.insights_scanned === "number" ? v.insights_scanned : undefined,
      entries,
      visual_guideline_cues: cues,
      visual_guideline_cues_by_format: cuesByFormat,
    };
  }, [derived]);

  const importIdForPack = useMemo(() => {
    const fromDerived = derived?.from_inputs_evidence_import_id;
    if (typeof fromDerived === "string" && fromDerived.trim()) return fromDerived.trim();
    return visualPack?.inputs_import_id ?? null;
  }, [derived, visualPack?.inputs_import_id]);

  const ideasJson = useMemo(() => {
    const ideas = pack?.ideas_json;
    if (Array.isArray(ideas) && ideas.length > 0) {
      return ideas.filter((x): x is Record<string, unknown> => x != null && typeof x === "object");
    }
    const legacyJobs = pack?.jobs_json;
    if (Array.isArray(legacyJobs) && legacyJobs.length > 0) {
      return legacyJobs.filter((x): x is Record<string, unknown> => x != null && typeof x === "object");
    }
    return [] as Record<string, unknown>[];
  }, [pack?.ideas_json, pack?.jobs_json]);

  const rows = ideasJson;

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(q));
  }, [rows, filter]);

  const columns = useMemo(() => {
    const keys = new Set<string>();
    for (const r of filtered.slice(0, 400)) {
      for (const k of Object.keys(r)) {
        keys.add(k);
        if (keys.size >= 16) break;
      }
      if (keys.size >= 16) break;
    }
    const preferred = [
      "id",
      "title",
      "format",
      "platform",
      "status",
      "thesis",
      "three_liner",
      "why_now",
      "novelty_angle",
      "who_for",
      "key_points",
      "cta",
      "confidence_score",
      "run_id",
      "created_at",
    ];
    const discovered = Array.from(keys);
    return discovered.sort((a, b) => {
      const ia = preferred.indexOf(a.toLowerCase());
      const ib = preferred.indexOf(b.toLowerCase());
      if (ia >= 0 || ib >= 0) {
        if (ia < 0) return 1;
        if (ib < 0) return -1;
        return ia - ib;
      }
      return a.localeCompare(b);
    });
  }, [filtered]);

  const ideasFromInsightsMeta = useMemo(() => asRecord(derived?.ideas_from_insights_llm), [derived]);

  const cueCount = visualPack?.visual_guideline_cues?.length ?? 0;
  const entryCount = visualPack?.entries?.length ?? 0;

  return (
    <>
      <div style={{ padding: "16px 28px 0" }}>
        <Link href={navHref("/pipeline?tab=packs")} className="detail-back" style={{ fontSize: 13 }}>
          ← Signal packs
        </Link>
      </div>
      <CafPageHeader
        title={<CafTerm term="signalPack">Signal pack</CafTerm>}
        chips={
          <>
            <span>{(pack?.upload_filename as string) || packId.slice(0, 8)}</span>
            <span>{ideasJson.length} ideas</span>
            {hashtagLeaderboard.length > 0 ? <span>{hashtagLeaderboard.length} hashtags</span> : null}
            {entryCount > 0 ? <span>{entryCount} visual entries</span> : null}
          </>
        }
      />

      <ViewTabs view={view} setView={setView} />

      <div style={{ padding: "12px 28px 28px" }}>
        {error && <p style={{ color: "var(--red)", marginBottom: 12 }}>{error}</p>}
        {!slug && <p style={{ color: "var(--muted)" }}>Select a project in the sidebar.</p>}

        {view === "ideas" && (
          <IdeasPanel filter={filter} setFilter={setFilter} rows={rows} filtered={filtered} columns={columns} />
        )}

        {view === "hashtags" && (
          <HashtagsPanel
            leaderboard={hashtagLeaderboard}
            rowsScanned={derived?.hashtag_leaderboard_rows_scanned}
            importId={derived?.from_inputs_evidence_import_id}
          />
        )}

        {view === "visual" &&
          (visualPack ? (
            <VisualGuidelinesPanel
              visualPack={visualPack}
              ideasFromInsightsMeta={ideasFromInsightsMeta}
              importId={importIdForPack}
              navHref={navHref}
              signalPackId={packId}
              onOverrideChanged={load}
            />
          ) : (
            <p style={{ color: "var(--muted)", fontSize: 13, maxWidth: 720 }}>
              No <code style={{ fontSize: 12 }}>visual_guidelines_pack_v1</code> on this pack. Run top-performer
              carousel/video on the import, then rebuild the signal pack.
            </p>
          ))}

        {view === "raw" && derived && (
          <>
            <MimicModeOverridesInspect derived={derived} />
            <JsonTreeViewer data={derived} />
          </>
        )}
        {view === "raw" && !derived && <p style={{ color: "var(--muted)", fontSize: 13 }}>No derived globals on this pack.</p>}
      </div>
    </>
  );
}

function ViewTabs({ view, setView }: { view: PackView; setView: (v: PackView) => void }) {
  const tabs: { id: PackView; label: string }[] = [
    { id: "ideas", label: "Ideas" },
    { id: "hashtags", label: "Hashtags" },
    { id: "visual", label: "Visual guidelines" },
    { id: "raw", label: "Raw data" },
  ];
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        padding: "0 28px",
        borderBottom: "1px solid var(--border)",
        flexWrap: "wrap",
      }}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setView(t.id)}
          style={{
            padding: "10px 14px",
            fontSize: 13,
            border: "none",
            borderBottom: view === t.id ? "2px solid var(--accent)" : "2px solid transparent",
            marginBottom: -1,
            background: "transparent",
            color: view === t.id ? "var(--fg)" : "var(--muted)",
            cursor: "pointer",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function IdeasPanel(props: {
  filter: string;
  setFilter: (s: string) => void;
  rows: Record<string, unknown>[];
  filtered: Record<string, unknown>[];
  columns: string[];
}) {
  const { filter, setFilter, rows, filtered, columns } = props;

  return (
    <>
      <div className="caf-toolbar" style={{ marginBottom: 14 }}>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search ideas…"
          className="filter-input"
          style={{ maxWidth: 280 }}
        />
        <span className="caf-stat-chips">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {filtered.length > 0 && (
        <HorizontalScrollTable>
          <table className="caf-table-compact" style={{ width: "max-content", minWidth: "100%" }}>
            <thead>
              <tr>
                <Th style={{ minWidth: 44 }}>#</Th>
                {columns.map((c) => (
                  <Th key={c} style={columnHeaderStyle(c)}>
                    {c}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, idx) => (
                <tr key={idx}>
                  <Td style={{ minWidth: 44 }}>{idx + 1}</Td>
                  {columns.map((c) => (
                    <Td key={c} style={columnCellStyle(c)}>
                      {c.toLowerCase() === "format" ? formatCellValue(row[c], row) : cellStr(row[c], c)}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </HorizontalScrollTable>
      )}

      {rows.length === 0 && <p style={{ color: "var(--muted)" }}>This pack has no ideas yet.</p>}
    </>
  );
}

function HashtagsPanel(props: {
  leaderboard: HashtagLeaderboardEntry[];
  rowsScanned: unknown;
  importId: unknown;
}) {
  const { leaderboard, rowsScanned, importId } = props;

  if (leaderboard.length === 0) {
    return (
      <p style={{ color: "var(--muted)", fontSize: 13, maxWidth: 720 }}>
        No <code style={{ fontSize: 12 }}>hashtag_leaderboard_v1</code> on this pack. Rebuild the pack from Processing
        (full import) so Core aggregates hashtags from evidence captions.
      </p>
    );
  }

  return (
    <section>
      <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12, maxWidth: 720 }}>
        From <code style={{ fontSize: 12 }}>derived_globals_json.hashtag_leaderboard_v1</code>
        {rowsScanned != null ? ` · ${String(rowsScanned)} evidence rows scanned` : ""}
        {importId ? (
          <>
            {" "}
            · import <code style={{ fontSize: 12 }}>{String(importId).slice(0, 8)}…</code>
          </>
        ) : null}
        . Used as hashtag seeds during generation.
      </p>
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--surface-2, #151515)" }}>
              <Th>#</Th>
              <Th>Hashtag</Th>
              <Th>Count</Th>
              <Th>Weight</Th>
              <Th>Avg rating</Th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((row, i) => (
              <tr key={row.hashtag} style={{ borderTop: "1px solid var(--border)" }}>
                <Td>{i + 1}</Td>
                <Td style={{ fontFamily: "var(--font-mono, monospace)" }}>{row.hashtag}</Td>
                <Td>{row.count}</Td>
                <Td>{row.weight.toFixed(2)}</Td>
                <Td>{row.avg_rating_score != null ? row.avg_rating_score.toFixed(3) : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--muted)" }}>Raw JSON</summary>
        <JsonPre value={leaderboard} />
      </details>
    </section>
  );
}

function DerivedGlobalsPanel({ derived }: { derived: Record<string, unknown> | null }) {
  if (!derived) {
    return (
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        No <code style={{ fontSize: 12 }}>derived_globals_json</code> on this pack.
      </p>
    );
  }
  return (
    <section>
      <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>
        Full <code style={{ fontSize: 12 }}>derived_globals_json</code> — includes hashtag leaderboard, visual
        guidelines, ideas-from-insights stats, and import metadata.
      </p>
      <JsonPre value={derived} maxHeight={640} />
    </section>
  );
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
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function JsonPre({ value, maxHeight = 420 }: { value: unknown; maxHeight?: number }) {
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
      {prettyJson(value)}
    </pre>
  );
}

function MimicModeOverridesInspect({ derived }: { derived: Record<string, unknown> }) {
  const overrides = asRecord(derived.mimic_mode_overrides);
  if (!overrides || Object.keys(overrides).length === 0) return null;

  const entries = Object.entries(overrides).filter(
    ([, v]) => v != null && typeof v === "string" && v.trim() !== ""
  );
  if (entries.length === 0) return null;

  return (
    <div
      style={{
        marginBottom: 16,
        padding: "12px 14px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--surface-2, #111)",
      }}
    >
      <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 600, color: "var(--accent)" }}>
        Mimic mode overrides ({entries.length})
      </p>
      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--muted)", fontWeight: 500, borderBottom: "1px solid var(--border)" }}>
              insights_id
            </th>
            <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--muted)", fontWeight: 500, borderBottom: "1px solid var(--border)" }}>
              mode
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([id, mode]) => (
            <tr key={id}>
              <td style={{ padding: "4px 8px", fontFamily: "var(--font-mono, monospace)", fontSize: 11 }}>
                {id}
              </td>
              <td style={{ padding: "4px 8px" }}>
                <span
                  style={{
                    display: "inline-block",
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600,
                    background: String(mode) === "carousel_visual" ? "rgba(59,130,246,0.15)" : "rgba(168,85,247,0.15)",
                    color: String(mode) === "carousel_visual" ? "#60a5fa" : "#c084fc",
                  }}
                >
                  {String(mode)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const EXTRA_WIDE_COLUMNS = new Set(["thesis", "three_liner", "novelty_angle"]);
const WIDE_COLUMNS = new Set([
  "title",
  "why_now",
  "who_for",
  "key_points",
  "cta",
  "expected_outcome",
  ...EXTRA_WIDE_COLUMNS,
]);

function isWideColumn(col: string): boolean {
  return WIDE_COLUMNS.has(col.toLowerCase());
}

function columnHeaderStyle(col: string): CSSProperties {
  const key = col.toLowerCase();
  if (EXTRA_WIDE_COLUMNS.has(key)) return { minWidth: 340, maxWidth: 480 };
  if (WIDE_COLUMNS.has(key)) return { minWidth: 220, maxWidth: 360 };
  if (key === "format") return { minWidth: 120, maxWidth: 160 };
  return { minWidth: 88, maxWidth: 180 };
}

function columnCellStyle(col: string): CSSProperties {
  const base: CSSProperties = {
    verticalAlign: "top",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    ...columnHeaderStyle(col),
  };
  return base;
}

function HorizontalScrollTable({ children }: { children: ReactNode }) {
  const topRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  const syncScrollWidth = useCallback(() => {
    const content = contentRef.current;
    const top = topRef.current;
    const body = bodyRef.current;
    if (!content || !top || !body) return;
    const w = content.scrollWidth;
    const spacer = top.firstElementChild as HTMLElement | null;
    if (spacer) spacer.style.width = `${w}px`;
    top.scrollLeft = body.scrollLeft;
  }, []);

  useLayoutEffect(() => {
    syncScrollWidth();
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => syncScrollWidth());
    ro.observe(content);
    return () => ro.disconnect();
  }, [children, syncScrollWidth]);

  const onTopScroll = () => {
    if (syncing.current || !topRef.current || !bodyRef.current) return;
    syncing.current = true;
    bodyRef.current.scrollLeft = topRef.current.scrollLeft;
    syncing.current = false;
  };

  const onBodyScroll = () => {
    if (syncing.current || !topRef.current || !bodyRef.current) return;
    syncing.current = true;
    topRef.current.scrollLeft = bodyRef.current.scrollLeft;
    syncing.current = false;
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
      <div
        ref={topRef}
        onScroll={onTopScroll}
        aria-hidden
        style={{
          overflowX: "auto",
          overflowY: "hidden",
          height: 14,
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-2, #151515)",
        }}
      >
        <div style={{ height: 1 }} />
      </div>
      <div ref={bodyRef} onScroll={onBodyScroll} style={{ overflowX: "auto" }}>
        <div ref={contentRef}>{children}</div>
      </div>
    </div>
  );
}

function formatFamilyLabel(raw: string): string {
  const key = raw.toLowerCase().replace(/\s+/g, "_");
  const labels: Record<string, string> = {
    carousel: "Carousel",
    video: "Video",
    single_image: "Single image",
    post: "Post",
    thread: "Thread",
    blog: "Blog",
    memo: "Memo",
    slides: "Slides",
    script: "Script",
  };
  return labels[key] ?? raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatSubtitleFromRow(row: Record<string, unknown>): string | null {
  for (const key of ["format_style", "format_subtype", "format_pattern", "visual_style", "hook_type"]) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function formatCellValue(formatRaw: unknown, row: Record<string, unknown>): ReactNode {
  const family = formatRaw == null ? "—" : formatFamilyLabel(String(formatRaw));
  const subtitle = formatSubtitleFromRow(row);
  if (!subtitle) return family;
  const sub = subtitle.includes("_") ? formatFamilyLabel(subtitle) : subtitle;
  return (
    <span>
      <span style={{ display: "block", fontWeight: 600 }}>{family}</span>
      <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{sub}</span>
    </span>
  );
}

function Th({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "8px 10px",
        fontWeight: 600,
        fontSize: 11,
        color: "var(--muted)",
        ...style,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <td style={{ padding: "8px 10px", ...style }}>{children}</td>;
}

function cellStr(v: unknown, col?: string): string {
  if (v == null) return "—";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (col && isWideColumn(col)) return s;
  if (s.length <= 240) return s;
  return `${s.slice(0, 240)}…`;
}
