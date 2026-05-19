"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useReviewProject } from "@/components/ReviewProjectContext";
import {
  VisualGuidelinesPanel,
  type VisualGuidelinesPackView,
} from "@/components/VisualGuidelinesPanel";

type PackView = "ideas" | "hashtags" | "visual" | "derived";

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
  const [source, setSource] = useState<"ideas_json" | "overall_candidates_json">("ideas_json");
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
    const v = pack?.ideas_json;
    if (!Array.isArray(v)) return [] as Record<string, unknown>[];
    return v.filter((x): x is Record<string, unknown> => x != null && typeof x === "object");
  }, [pack]);

  const overallCandidates = useMemo(() => {
    const v = pack?.overall_candidates_json;
    if (!Array.isArray(v)) return [] as Record<string, unknown>[];
    return v.filter((x): x is Record<string, unknown> => x != null && typeof x === "object");
  }, [pack]);

  const rows = useMemo(() => {
    if (source === "overall_candidates_json") return overallCandidates;
    return ideasJson;
  }, [ideasJson, overallCandidates, source]);

  useEffect(() => {
    if (ideasJson.length > 0) setSource("ideas_json");
    else setSource("overall_candidates_json");
  }, [ideasJson.length, packId]);

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
    return Array.from(keys);
  }, [filtered]);

  const ideasFromInsightsMeta = useMemo(() => asRecord(derived?.ideas_from_insights_llm), [derived]);

  const cueCount = visualPack?.visual_guideline_cues?.length ?? 0;
  const entryCount = visualPack?.entries?.length ?? 0;

  return (
    <>
      <div className="page-header">
        <div>
          <Link href={navHref("/pipeline?tab=ideas")} className="detail-back" style={{ fontSize: 13 }}>
            ← Signal packs
          </Link>
          <h2 style={{ marginTop: 8 }}>Signal pack</h2>
          <span className="page-header-sub">
            {(pack?.upload_filename as string) || packId.slice(0, 8)} ·{" "}
            {ideasJson.length > 0 ? `${ideasJson.length} ideas_json` : `${overallCandidates.length} overall candidates`}
            {hashtagLeaderboard.length > 0 ? ` · ${hashtagLeaderboard.length} hashtags` : ""}
            {entryCount > 0 ? ` · ${entryCount} visual entries` : ""}
            {cueCount > 0 ? ` · ${cueCount} cues` : ""}
          </span>
        </div>
      </div>

      <ViewTabs view={view} setView={setView} />

      <div style={{ padding: "12px 28px 28px" }}>
        {error && <p style={{ color: "var(--red)", marginBottom: 12 }}>{error}</p>}
        {!slug && <p style={{ color: "var(--muted)" }}>Select a project in the sidebar.</p>}

        {view === "ideas" && (
          <IdeasPanel
            pack={pack}
            source={source}
            setSource={setSource}
            filter={filter}
            setFilter={setFilter}
            ideasJson={ideasJson}
            overallCandidates={overallCandidates}
            rows={rows}
            filtered={filtered}
            columns={columns}
          />
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
            />
          ) : (
            <p style={{ color: "var(--muted)", fontSize: 13, maxWidth: 720 }}>
              No <code style={{ fontSize: 12 }}>visual_guidelines_pack_v1</code> on this pack. Run top-performer
              carousel/video on the import, then rebuild the signal pack.
            </p>
          ))}

        {view === "derived" && <DerivedGlobalsPanel derived={derived} />}
      </div>
    </>
  );
}

function ViewTabs({ view, setView }: { view: PackView; setView: (v: PackView) => void }) {
  const tabs: { id: PackView; label: string }[] = [
    { id: "ideas", label: "Ideas" },
    { id: "hashtags", label: "Hashtags" },
    { id: "visual", label: "Visual guidelines" },
    { id: "derived", label: "derived_globals_json" },
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
  pack: Record<string, unknown> | null;
  source: "ideas_json" | "overall_candidates_json";
  setSource: (s: "ideas_json" | "overall_candidates_json") => void;
  filter: string;
  setFilter: (s: string) => void;
  ideasJson: Record<string, unknown>[];
  overallCandidates: Record<string, unknown>[];
  rows: Record<string, unknown>[];
  filtered: Record<string, unknown>[];
  columns: string[];
}) {
  const {
    pack,
    source,
    setSource,
    filter,
    setFilter,
    ideasJson,
    overallCandidates,
    rows,
    filtered,
    columns,
  } = props;

  return (
    <>
      {pack && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <label style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 8 }}>
              Source
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as "ideas_json" | "overall_candidates_json")}
                style={{
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "inherit",
                  fontSize: 13,
                }}
              >
                <option value="ideas_json" disabled={ideasJson.length === 0}>
                  ideas_json ({ideasJson.length})
                </option>
                <option value="overall_candidates_json" disabled={overallCandidates.length === 0}>
                  overall_candidates_json ({overallCandidates.length})
                </option>
              </select>
            </label>

            <label style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 8 }}>
              Filter rows
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Substring match on full row JSON"
                style={{ padding: "8px 12px", minWidth: 280, borderRadius: 6, border: "1px solid var(--border)" }}
              />
            </label>

            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              Showing {filtered.length} of {rows.length}
            </span>
          </div>
        </div>
      )}

      {filtered.length > 0 && (
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "var(--surface-2, #151515)" }}>
                <Th>idx</Th>
                {columns.map((c) => (
                  <Th key={c}>{c}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, idx) => (
                <tr key={idx} style={{ borderTop: "1px solid var(--border)" }}>
                  <Td>{idx + 1}</Td>
                  {columns.map((c) => (
                    <Td key={c} style={{ maxWidth: 260, verticalAlign: "top" }}>
                      {cellStr(row[c])}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pack && rows.length === 0 && (
        <p style={{ color: "var(--muted)" }}>
          This pack has no {source} rows.
          {source === "overall_candidates_json" && ideasJson.length > 0 ? " Try switching to ideas_json." : ""}
          {source === "ideas_json" && overallCandidates.length > 0
            ? " Try switching to overall_candidates_json."
            : ""}
        </p>
      )}
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

function Th({ children }: { children: ReactNode }) {
  return (
    <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 600, fontSize: 11, color: "var(--muted)" }}>
      {children}
    </th>
  );
}

function Td({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <td style={{ padding: "8px 10px", ...style }}>{children}</td>;
}

function cellStr(v: unknown): string {
  if (v == null) return "—";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s.length <= 240) return s;
  return `${s.slice(0, 240)}…`;
}
