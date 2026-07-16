"use client";

/**
 * Post-scrape research pipeline for marketers:
 * pick scrape run → cutoff → broad insights → optional top-performer deep analysis.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

export type PipelineStep = "cutoff" | "analyzing" | "top_performers" | "done";

const KIND_LABELS: Record<string, string> = {
  instagram_post: "Instagram",
  tiktok_video: "TikTok",
  facebook_post: "Facebook",
  linkedin_post: "LinkedIn",
  reddit_post: "Reddit",
  scraped_page: "Web / blogs",
};

const SOCIAL_KINDS = new Set([
  "instagram_post",
  "tiktok_video",
  "facebook_post",
  "linkedin_post",
  "reddit_post",
]);

export interface ResearchScrapeRunOption {
  id: string;
  scraper_key: string;
  status: string;
  started_at: string | null;
  finished_at?: string | null;
  error_message: string | null;
  evidence_import_id?: string | null;
  platforms?: string[];
}

export interface ResearchEvidenceImportOption {
  id: string;
  filename: string | null;
  createdAt: string;
  rowCount: number;
}

interface KindCutoff {
  evidence_kind: string;
  label: string;
  rowsInKind: number;
  minScore: number;
  afterCutoff: number | null;
  profileMin: number;
  loading: boolean;
}

interface ResearchPipelinePanelProps {
  slug: string;
  /** Preferred default import (latest completed scrape). */
  defaultImportId: string | null;
  scraperRuns: ResearchScrapeRunOption[];
  evidenceImports: ResearchEvidenceImportOption[];
  scraperRunning: boolean;
  scraperStatusText: string | null;
}

function formatRunWhen(iso: string | null | undefined): string {
  if (!iso) return "Unknown time";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function platformSummary(platforms: string[] | undefined): string {
  if (!platforms?.length) return "";
  return platforms
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(", ");
}

export function ResearchPipelinePanel({
  slug,
  defaultImportId,
  scraperRuns,
  evidenceImports,
  scraperRunning,
  scraperStatusText,
}: ResearchPipelinePanelProps) {
  const selectableRuns = useMemo(() => {
    const fromScrapers = scraperRuns.filter(
      (r) => r.status === "completed" && Boolean(r.evidence_import_id)
    );
    if (fromScrapers.length > 0) return fromScrapers;
    // Fallback: evidence imports without a linked scraper run (manual uploads).
    return evidenceImports.map((imp) => ({
      id: `import:${imp.id}`,
      scraper_key: "evidence_import",
      status: "completed",
      started_at: imp.createdAt,
      finished_at: imp.createdAt,
      error_message: null,
      evidence_import_id: imp.id,
      platforms: [] as string[],
    }));
  }, [scraperRuns, evidenceImports]);

  const failedRuns = useMemo(
    () => scraperRuns.filter((r) => r.status === "failed").slice(0, 3),
    [scraperRuns]
  );

  const importById = useMemo(() => {
    const map = new Map(evidenceImports.map((i) => [i.id, i]));
    return map;
  }, [evidenceImports]);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [step, setStep] = useState<PipelineStep>("cutoff");
  const [kinds, setKinds] = useState<KindCutoff[]>([]);
  const [maxRows, setMaxRows] = useState(500);
  const [busy, setBusy] = useState(false);
  const [loadingKinds, setLoadingKinds] = useState(false);
  const [statusLines, setStatusLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tpTopPct, setTpTopPct] = useState(5);
  const [tpCarouselMax, setTpCarouselMax] = useState(30);
  const [tpVideoMax, setTpVideoMax] = useState(16);
  const [doCarousel, setDoCarousel] = useState(true);
  const [doVideo, setDoVideo] = useState(true);
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const previewTimers = useRef<Record<string, number>>({});

  // Pick default completed run whenever options change.
  useEffect(() => {
    if (selectableRuns.length === 0) {
      setSelectedRunId(null);
      setImportId(null);
      return;
    }
    const preferred =
      selectableRuns.find((r) => r.evidence_import_id === defaultImportId) ?? selectableRuns[0];
    setSelectedRunId((prev) => {
      if (prev && selectableRuns.some((r) => r.id === prev)) return prev;
      return preferred.id;
    });
    setImportId((prev) => {
      const stillValid = selectableRuns.some((r) => r.evidence_import_id === prev);
      if (stillValid && prev) return prev;
      return preferred.evidence_import_id ?? null;
    });
  }, [selectableRuns, defaultImportId]);

  const pushStatus = useCallback((line: string) => {
    setStatusLines((prev) => [...prev.slice(-12), line]);
  }, []);

  const loadKinds = useCallback(
    async (id: string) => {
      setLoadingKinds(true);
      setError(null);
      setKinds([]);
      setStep("cutoff");
      try {
        const res = await fetch(
          `/api/brand/${encodeURIComponent(slug)}/research/pipeline?importId=${encodeURIComponent(id)}&action=stats`
        );
        const j = (await res.json()) as {
          ok?: boolean;
          by_kind?: Record<string, number>;
          message?: string;
        };
        if (!res.ok || !j.ok) throw new Error(j.message ?? "Could not load evidence stats");
        const byKind = j.by_kind ?? {};
        const next: KindCutoff[] = Object.entries(byKind)
          .filter(([k, n]) => SOCIAL_KINDS.has(k) && n > 0)
          .map(([evidence_kind, rowsInKind]) => ({
            evidence_kind,
            label: KIND_LABELS[evidence_kind] ?? evidence_kind,
            rowsInKind,
            minScore: 0.35,
            afterCutoff: null,
            profileMin: 0.35,
            loading: true,
          }))
          .sort((a, b) => a.label.localeCompare(b.label));
        setKinds(next);
        // Prime cutoff counts for this import (await all so totals show quickly).
        await Promise.all(
          next.map(async (k) => {
            try {
              const prevRes = await fetch(`/api/brand/${encodeURIComponent(slug)}/research/pipeline`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "preview_cutoff",
                  importId: id,
                  evidence_kind: k.evidence_kind,
                  min_score: k.minScore,
                }),
              });
              const pj = (await prevRes.json()) as {
                ok?: boolean;
                after_user_cutoff?: number;
                profile_min_score?: number;
                rows_in_kind?: number;
              };
              if (!prevRes.ok || !pj.ok) {
                setKinds((prev) =>
                  prev.map((x) =>
                    x.evidence_kind === k.evidence_kind ? { ...x, loading: false, afterCutoff: 0 } : x
                  )
                );
                return;
              }
              setKinds((prev) =>
                prev.map((x) =>
                  x.evidence_kind === k.evidence_kind
                    ? {
                        ...x,
                        loading: false,
                        afterCutoff: pj.after_user_cutoff ?? 0,
                        rowsInKind: pj.rows_in_kind ?? x.rowsInKind,
                        profileMin: pj.profile_min_score ?? 0.35,
                      }
                    : x
                )
              );
            } catch {
              setKinds((prev) =>
                prev.map((x) =>
                  x.evidence_kind === k.evidence_kind ? { ...x, loading: false, afterCutoff: 0 } : x
                )
              );
            }
          })
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load evidence");
      } finally {
        setLoadingKinds(false);
      }
    },
    [slug]
  );

  useEffect(() => {
    if (importId && !scraperRunning) void loadKinds(importId);
  }, [importId, scraperRunning, loadKinds]);

  const refreshCutoff = useCallback(
    async (kind: string, minScore: number) => {
      if (!importId) return;
      setKinds((prev) =>
        prev.map((k) => (k.evidence_kind === kind ? { ...k, loading: true, minScore } : k))
      );
      try {
        const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/research/pipeline`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "preview_cutoff",
            importId,
            evidence_kind: kind,
            min_score: minScore,
          }),
        });
        const j = (await res.json()) as {
          ok?: boolean;
          after_user_cutoff?: number;
          profile_min_score?: number;
          rows_in_kind?: number;
          message?: string;
        };
        if (!res.ok || !j.ok) throw new Error(j.message ?? "Cutoff preview failed");
        setKinds((prev) =>
          prev.map((k) =>
            k.evidence_kind === kind
              ? {
                  ...k,
                  loading: false,
                  minScore,
                  afterCutoff: j.after_user_cutoff ?? 0,
                  rowsInKind: j.rows_in_kind ?? k.rowsInKind,
                  profileMin: j.profile_min_score ?? 0.35,
                }
              : k
          )
        );
      } catch (e) {
        setKinds((prev) =>
          prev.map((k) => (k.evidence_kind === kind ? { ...k, loading: false } : k))
        );
        setError(e instanceof Error ? e.message : "Cutoff preview failed");
      }
    },
    [importId, slug]
  );

  const scheduleCutoffPreview = useCallback(
    (kind: string, minScore: number) => {
      const existing = previewTimers.current[kind];
      if (existing) window.clearTimeout(existing);
      previewTimers.current[kind] = window.setTimeout(() => {
        void refreshCutoff(kind, minScore);
      }, 220);
    },
    [refreshCutoff]
  );

  useEffect(() => {
    return () => {
      for (const t of Object.values(previewTimers.current)) window.clearTimeout(t);
    };
  }, []);
  const totalAfterCutoff = useMemo(
    () => kinds.reduce((sum, k) => sum + (k.afterCutoff ?? 0), 0),
    [kinds]
  );
  const poolForAnalysis = Math.min(totalAfterCutoff, maxRows);

  function selectRun(runId: string) {
    const run = selectableRuns.find((r) => r.id === runId);
    if (!run?.evidence_import_id) return;
    setSelectedRunId(runId);
    setImportId(run.evidence_import_id);
    setStep("cutoff");
    setStatusLines([]);
    setProgressLog([]);
    setError(null);
  }

  async function startAnalysis() {
    if (!importId) return;
    setBusy(true);
    setError(null);
    setStep("analyzing");
    setStatusLines([]);
    pushStatus("Saving your evidence cutoffs…");
    try {
      for (const k of kinds) {
        await fetch(`/api/brand/${encodeURIComponent(slug)}/research/pipeline`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save_cutoff",
            importId,
            evidence_kind: k.evidence_kind,
            min_score: k.minScore,
          }),
        });
      }
      pushStatus(
        `Analyzing ~${poolForAnalysis} posts across ${kinds.length} platform(s). This can take several minutes — go do something else; CAF will keep working.`
      );
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/research/pipeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "run_broad_all",
          importId,
          max_rows: maxRows,
          cutoffs: Object.fromEntries(kinds.map((k) => [k.evidence_kind, k.minScore])),
        }),
      });
      const j = (await res.json()) as { ok?: boolean; message?: string; summary?: string };
      if (!res.ok || !j.ok) throw new Error(j.message ?? "Analysis failed");
      pushStatus(j.summary ?? "Broad analysis finished.");
      setStep("top_performers");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
      setStep("cutoff");
    } finally {
      setBusy(false);
    }
  }

  async function runTopPerformers() {
    if (!importId) return;
    if (!doCarousel && !doVideo) {
      setStep("done");
      return;
    }
    setBusy(true);
    setError(null);
    setProgressLog([]);
    const fraction = Math.min(0.5, Math.max(0.01, tpTopPct / 100));
    pushStatus(
      "Deep top-performer analysis is the longest step. Grab a coffee — we’ll show progress as carousels and videos are inspected."
    );
    try {
      if (doCarousel) {
        pushStatus(`Starting carousel deep analysis (top ${tpTopPct}%, up to ${tpCarouselMax})…`);
        const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/research/pipeline`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "run_tp_carousel",
            importId,
            max_rows: tpCarouselMax,
            rating_top_fraction: fraction,
          }),
        });
        const j = (await res.json()) as {
          ok?: boolean;
          message?: string;
          progress_id?: string;
          qualifying?: number;
        };
        if (!res.ok || !j.ok) throw new Error(j.message ?? "Carousel analysis failed");
        if (j.progress_id) {
          await pollProgress(j.progress_id);
        }
        pushStatus(
          j.qualifying != null
            ? `Carousel analysis done (${j.qualifying} qualifying).`
            : "Carousel analysis done."
        );
      }
      if (doVideo) {
        pushStatus(`Starting video deep analysis (top ${tpTopPct}%, up to ${tpVideoMax})…`);
        const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/research/pipeline`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "run_tp_video",
            importId,
            max_rows: tpVideoMax,
            rating_top_fraction: fraction,
          }),
        });
        const j = (await res.json()) as { ok?: boolean; message?: string; qualifying?: number };
        if (!res.ok || !j.ok) throw new Error(j.message ?? "Video analysis failed");
        pushStatus(
          j.qualifying != null
            ? `Video analysis done (${j.qualifying} qualifying).`
            : "Video analysis done."
        );
      }
      setStep("done");
      pushStatus("Research brief foundation is ready. Open Intelligence to explore patterns and generate ideas.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Top performer analysis failed");
    } finally {
      setBusy(false);
    }
  }

  async function pollProgress(progressId: string) {
    const started = Date.now();
    while (Date.now() - started < 15 * 60_000) {
      await new Promise((r) => setTimeout(r, 2000));
      const res = await fetch(
        `/api/brand/${encodeURIComponent(slug)}/research/pipeline?action=pass_progress&progressId=${encodeURIComponent(progressId)}`
      );
      if (!res.ok) continue;
      const j = (await res.json()) as {
        ok?: boolean;
        progress?: { finished_at: string | null; lines?: Array<{ message: string }> };
      };
      const lines = j.progress?.lines ?? [];
      if (lines.length) {
        setProgressLog(lines.slice(-8).map((l) => l.message));
      }
      if (j.progress?.finished_at) break;
    }
  }

  if (scraperRunning) {
    return (
      <section className="research-section research-pipeline" data-agent-id="research-pipeline-scraper">
        <h3>Market research in progress</h3>
        <div className="research-chill-card">
          <p className="research-chill-title">Scrapers are running — you can chill</p>
          <p className="research-lead">
            {scraperStatusText ??
              "CAF is collecting posts from your watchlists. Typical runs take 5–20 minutes depending on platforms and how far back you look."}
          </p>
          <p className="workspace-muted">
            Leave this page open or come back later. When the scrape finishes, open{" "}
            <strong>Research analysis</strong> to pick that run and set cutoffs.
          </p>
          <div className="research-pulse" aria-hidden />
        </div>
      </section>
    );
  }

  if (selectableRuns.length === 0) {
    return (
      <section className="research-section research-pipeline" data-agent-id="research-pipeline-empty">
        <h3>Build your research brief</h3>
        <p className="research-lead">
          Start a scrape above first. When a run completes, you&apos;ll pick it here, set how many posts to keep
          per platform, then run analysis.
        </p>
        {failedRuns.length > 0 && (
          <ul className="research-runs">
            {failedRuns.map((run) => (
              <li key={run.id}>
                <span className="research-run-status research-run-status--failed">failed</span>
                {formatRunWhen(run.started_at)}
                {run.error_message ? ` — ${run.error_message}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <section className="research-section research-pipeline" data-agent-id="research-pipeline">
      <h3>Build your research brief</h3>
      <p className="research-lead">
        Pick a completed scrape run, tune how many posts pass the cutoff per platform, then start analysis.
      </p>
      {error && <p className="workspace-error">{error}</p>}

      {(step === "cutoff" || step === "analyzing") && (
        <div className="research-pipeline-step">
          <h4>1. Choose scrape run</h4>
          <div className="research-run-picker" role="listbox" aria-label="Completed scrape runs">
            {selectableRuns.map((run) => {
              const imp = run.evidence_import_id ? importById.get(run.evidence_import_id) : undefined;
              const plats = platformSummary(run.platforms);
              const selected = selectedRunId === run.id;
              return (
                <button
                  key={run.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`research-run-option${selected ? " is-selected" : ""}`}
                  onClick={() => selectRun(run.id)}
                  disabled={busy || step === "analyzing"}
                  data-agent-id={`research-pick-run-${run.id}`}
                >
                  <span className="research-run-option__status">completed</span>
                  <span className="research-run-option__when">{formatRunWhen(run.started_at)}</span>
                  <span className="research-run-option__meta">
                    {plats || run.scraper_key}
                    {imp?.rowCount ? ` · ${imp.rowCount} posts collected` : ""}
                  </span>
                </button>
              );
            })}
          </div>
          {failedRuns.length > 0 && (
            <details className="research-failed-runs">
              <summary>Failed runs ({failedRuns.length})</summary>
              <ul className="research-runs">
                {failedRuns.map((run) => (
                  <li key={run.id}>
                    <span className="research-run-status research-run-status--failed">failed</span>
                    {formatRunWhen(run.started_at)}
                    {run.error_message ? ` — ${run.error_message}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {step === "cutoff" && (
        <div className="research-pipeline-step">
          <h4>2. Evidence pool (cutoff)</h4>
          <p className="workspace-muted">
            Drag the slider: higher = fewer, stronger posts; lower = larger pool. The count updates as you move
            it — those posts go into research analysis.
          </p>
          {loadingKinds ? (
            <p className="workspace-muted">Loading platforms for this run…</p>
          ) : kinds.length === 0 ? (
            <p className="workspace-muted">No social posts found on this run.</p>
          ) : (
            <ul className="research-cutoff-list">
              {kinds.map((k) => (
                <li key={k.evidence_kind} className="research-cutoff-row">
                  <div className="research-cutoff-row__head">
                    <strong>{k.label}</strong>
                    <span className="research-cutoff-row__counts">
                      <span className="research-cutoff-pass">
                        {k.afterCutoff == null
                          ? k.loading
                            ? "…"
                            : "—"
                          : k.afterCutoff}
                      </span>
                      <span className="workspace-muted">
                        {" "}
                        pass cutoff / {k.rowsInKind} collected
                        {k.loading ? " · updating…" : ""}
                      </span>
                    </span>
                  </div>
                  <label className="research-cutoff-slider">
                    <span>Keep score ≥ {k.minScore.toFixed(2)}</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={k.minScore}
                      data-agent-id={`research-cutoff-${k.evidence_kind}`}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setKinds((prev) =>
                          prev.map((x) =>
                            x.evidence_kind === k.evidence_kind
                              ? { ...x, minScore: v, loading: true }
                              : x
                          )
                        );
                        scheduleCutoffPreview(k.evidence_kind, v);
                      }}
                    />
                  </label>
                </li>
              ))}
            </ul>
          )}
          <label className="research-cutoff-slider" style={{ marginTop: 12, display: "block" }}>
            <span>Max posts to analyze overall: {maxRows}</span>
            <input
              type="range"
              min={50}
              max={2000}
              step={50}
              value={maxRows}
              onChange={(e) => setMaxRows(Number(e.target.value))}
            />
          </label>
          <p className="research-cutoff-summary">
            Into research analysis: <strong>~{poolForAnalysis}</strong> posts
            {totalAfterCutoff > maxRows ? ` (${totalAfterCutoff} pass cutoffs, capped at ${maxRows})` : ""}.
          </p>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || kinds.length === 0 || poolForAnalysis === 0}
            onClick={() => void startAnalysis()}
            data-agent-id="research-start-analysis"
          >
            {busy ? "Starting…" : `Start research analysis (~${poolForAnalysis})`}
          </button>
        </div>
      )}

      {step === "analyzing" && (
        <div className="research-chill-card">
          <p className="research-chill-title">Analyzing every selected post</p>
          <p className="research-lead">
            CAF is reading captions and engagement signals platform by platform. This often takes 5–15 minutes.
            You don’t need to watch the screen — we’ll unlock the next step when it’s done.
          </p>
          <ul className="research-status-log">
            {statusLines.map((line, i) => (
              <li key={`${i}-${line.slice(0, 24)}`}>{line}</li>
            ))}
          </ul>
          <div className="research-pulse" aria-hidden />
        </div>
      )}

      {step === "top_performers" && (
        <div className="research-pipeline-step">
          <h4>3. Top performer deep analysis (optional)</h4>
          <p className="research-lead">
            This is the longest step. CAF inspects winning carousels and videos so mimic and visual routes have
            strong references. Skip if you only need text patterns for now.
          </p>
          <label className="research-cutoff-slider">
            <span>Top performers: top {tpTopPct}% of eligible media</span>
            <input
              type="range"
              min={1}
              max={20}
              step={1}
              value={tpTopPct}
              onChange={(e) => setTpTopPct(Number(e.target.value))}
              disabled={busy}
            />
          </label>
          <div className="research-tp-toggles">
            <label>
              <input
                type="checkbox"
                checked={doCarousel}
                onChange={(e) => setDoCarousel(e.target.checked)}
                disabled={busy}
              />{" "}
              Carousels (up to{" "}
              <input
                type="number"
                min={1}
                max={40}
                value={tpCarouselMax}
                onChange={(e) => setTpCarouselMax(Number(e.target.value))}
                disabled={busy}
                style={{ width: 56 }}
              />
              )
            </label>
            <label>
              <input
                type="checkbox"
                checked={doVideo}
                onChange={(e) => setDoVideo(e.target.checked)}
                disabled={busy}
              />{" "}
              Videos (up to{" "}
              <input
                type="number"
                min={1}
                max={40}
                value={tpVideoMax}
                onChange={(e) => setTpVideoMax(Number(e.target.value))}
                disabled={busy}
                style={{ width: 56 }}
              />
              )
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void runTopPerformers()}
              data-agent-id="research-run-tp"
            >
              {busy ? "Analyzing…" : "Run deep analysis"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => setStep("done")}
            >
              Skip for now
            </button>
          </div>
          {(statusLines.length > 0 || progressLog.length > 0) && (
            <ul className="research-status-log">
              {statusLines.map((line, i) => (
                <li key={`s-${i}`}>{line}</li>
              ))}
              {progressLog.map((line, i) => (
                <li key={`p-${i}`} className="workspace-muted">
                  {line}
                </li>
              ))}
            </ul>
          )}
          {busy && <div className="research-pulse" aria-hidden />}
        </div>
      )}

      {step === "done" && (
        <div className="research-chill-card research-chill-card--done">
          <p className="research-chill-title">Ready for Intelligence</p>
          <p className="research-lead">
            Broad insights are in. Open Intelligence to browse patterns, then generate ideas for your enabled
            content routes.
          </p>
          <Link className="btn-primary" href={`/brand/${encodeURIComponent(slug)}/intelligence`}>
            Open Intelligence →
          </Link>
        </div>
      )}
    </section>
  );
}
