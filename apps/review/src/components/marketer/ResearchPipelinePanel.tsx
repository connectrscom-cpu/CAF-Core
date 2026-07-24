"use client";

/**
 * Post-scrape research pipeline for marketers:
 * pick scrape run → cutoff + TP thresholds → Start runs broad insights then optional
 * top-performer deep analysis (carousel / video) with the same button.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

export type PipelineStep = "cutoff" | "analyzing" | "top_performers" | "done";

function clampTopPct(pct: number): number {
  return Math.min(20, Math.max(1, Math.round(pct)));
}

function topFractionFromPct(pct: number): number {
  return Math.min(0.5, Math.max(0.01, clampTopPct(pct) / 100));
}

interface ProfileSummary {
  rating_model: string;
  synth_model: string;
  max_ideas_in_signal_pack: number;
  min_llm_score_for_pack: number;
}

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
  /** Called after a signal pack is built so the briefs list can refresh. */
  onBriefCreated?: (packId: string) => void;
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

type TpResumePhase = "carousel" | "video";

type TpResumeState = {
  importId: string;
  phase: TpResumePhase;
  progressId: string;
  doCarousel: boolean;
  doVideo: boolean;
};

function tpResumeStorageKey(slug: string): string {
  return `caf-research-tp:${slug}`;
}

function loadTpResume(slug: string): TpResumeState | null {
  try {
    const raw = sessionStorage.getItem(tpResumeStorageKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TpResumeState;
    if (!parsed?.importId || !parsed?.progressId || !parsed?.phase) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveTpResume(slug: string, state: TpResumeState): void {
  try {
    sessionStorage.setItem(tpResumeStorageKey(slug), JSON.stringify(state));
  } catch {
    /* ignore quota / private mode */
  }
}

function clearTpResume(slug: string): void {
  try {
    sessionStorage.removeItem(tpResumeStorageKey(slug));
  } catch {
    /* ignore */
  }
}

type ProgressLine = { at?: string; message: string; stage?: string };

type TpPassKind = "carousel" | "video" | "broad";

/** Admin-style run log for a research pipeline pass (expandable in Review). */
type TpPassReport = {
  at: string;
  pass: "broad_insights" | "top_performer_carousel" | "top_performer_video";
  success: boolean;
  project_slug: string;
  import_id: string | null;
  progress_id?: string | null;
  http_status?: number | null;
  endpoint?: string;
  request_body?: Record<string, unknown>;
  response?: unknown;
  error?: string;
  progress?: {
    started_at?: string | null;
    finished_at?: string | null;
    ok?: boolean | null;
    lines: ProgressLine[];
  };
  status_timeline?: string[];
};

type PassReports = Partial<Record<TpPassKind, TpPassReport>>;

function passLabel(kind: TpPassKind): string {
  if (kind === "broad") return "Broad insights";
  if (kind === "carousel") return "Carousel deep analysis";
  return "Video deep analysis";
}

function ResearchPassDiagnostics({
  reports,
  statusLines,
  progressLog,
  error,
  defaultOpen = false,
}: {
  reports: PassReports;
  statusLines: string[];
  progressLog: string[];
  error: string | null;
  defaultOpen?: boolean;
}) {
  const entries = (["broad", "carousel", "video"] as const)
    .map((k) => (reports[k] ? ([k, reports[k]!] as const) : null))
    .filter((x): x is readonly [TpPassKind, TpPassReport] => x != null);

  if (!error && entries.length === 0 && statusLines.length === 0 && progressLog.length === 0) {
    return null;
  }

  const bundle = {
    caf_review_research_pipeline_log: true,
    error,
    status_timeline: statusLines,
    live_progress_tail: progressLog,
    runs: {
      broad: reports.broad ?? null,
      carousel: reports.carousel ?? null,
      video: reports.video ?? null,
    },
  };

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="research-diag" data-agent-id="research-pass-diagnostics">
      {error && <p className="workspace-error research-diag__error">{error}</p>}
      <div className="research-diag__toolbar">
        <span className="research-diag__title">Analysis logs &amp; reports</span>
        <button type="button" className="btn-ghost btn-sm" onClick={() => void copyAll()}>
          Copy all JSON
        </button>
      </div>

      {(statusLines.length > 0 || progressLog.length > 0) && (
        <details className="research-diag__details" open={defaultOpen || !!error}>
          <summary>Status timeline &amp; live progress</summary>
          <ul className="research-status-log">
            {statusLines.map((line, i) => (
              <li key={`st-${i}`}>{line}</li>
            ))}
            {progressLog.map((line, i) => (
              <li key={`pl-${i}`} className="workspace-muted">
                {line}
              </li>
            ))}
          </ul>
        </details>
      )}

      {entries.map(([kind, report]) => (
        <details
          key={kind}
          className="research-diag__details"
          open={defaultOpen || (!report.success && !!error)}
        >
          <summary>
            {passLabel(kind)}
            <span
              className={
                report.success ? "research-diag__badge research-diag__badge--ok" : "research-diag__badge research-diag__badge--err"
              }
            >
              {report.success ? "ok" : "failed"}
            </span>
          </summary>
          {report.error && <p className="workspace-error" style={{ marginTop: 8 }}>{report.error}</p>}
          {report.progress_id && (
            <p className="workspace-muted mono" style={{ fontSize: 12 }}>
              progress_id: {report.progress_id}
            </p>
          )}
          {report.progress?.lines && report.progress.lines.length > 0 && (
            <details className="research-diag__nested" open={!report.success}>
              <summary>Progress log ({report.progress.lines.length} lines)</summary>
              <ul className="research-status-log research-diag__progress-lines">
                {report.progress.lines.map((l, i) => (
                  <li key={`${kind}-line-${i}`}>
                    {l.at ? (
                      <span className="research-diag__ts">{l.at.slice(11, 19)} </span>
                    ) : null}
                    {l.stage ? <span className="research-diag__stage">[{l.stage}] </span> : null}
                    {l.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details className="research-diag__nested">
            <summary>Full report JSON (admin-style)</summary>
            <pre className="research-diag__pre">{JSON.stringify(report, null, 2)}</pre>
            <button
              type="button"
              className="btn-ghost btn-sm"
              style={{ marginTop: 6 }}
              onClick={() =>
                void navigator.clipboard.writeText(JSON.stringify(report, null, 2)).catch(() => {})
              }
            >
              Copy this pass
            </button>
          </details>
        </details>
      ))}
    </div>
  );
}

export function ResearchPipelinePanel({
  slug,
  defaultImportId,
  scraperRuns,
  evidenceImports,
  scraperRunning,
  scraperStatusText,
  onBriefCreated,
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
  const [tpCarouselTopPct, setTpCarouselTopPct] = useState(5);
  const [tpVideoTopPct, setTpVideoTopPct] = useState(5);
  const [tpCarouselMax, setTpCarouselMax] = useState(30);
  const [tpVideoMax, setTpVideoMax] = useState(16);
  const [doCarousel, setDoCarousel] = useState(true);
  const [doVideo, setDoVideo] = useState(true);
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [passReports, setPassReports] = useState<PassReports>({});
  const previewTimers = useRef<Record<string, number>>({});
  const evidenceFileRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [builtPackId, setBuiltPackId] = useState<string | null>(null);
  const [evidenceUploading, setEvidenceUploading] = useState(false);
  const resumeAttempted = useRef(false);
  const pollAbortRef = useRef(false);
  const lastProgressRef = useRef<{
    progress_id: string;
    started_at?: string | null;
    finished_at?: string | null;
    ok?: boolean | null;
    lines: ProgressLine[];
  } | null>(null);

  function upsertPassReport(kind: TpPassKind, entry: TpPassReport) {
    setPassReports((prev) => ({ ...prev, [kind]: entry }));
  }

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

  useEffect(() => {
    let cancelled = false;
    setProfileLoading(true);
    fetch(`/api/brand/${encodeURIComponent(slug)}/research/profile`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok?: boolean; profile?: ProfileSummary } | null) => {
        if (cancelled || !j?.ok || !j.profile) return;
        setProfile(j.profile);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setProfileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const pushStatus = useCallback((line: string) => {
    setStatusLines((prev) => [...prev.slice(-12), line]);
  }, []);

  const loadKinds = useCallback(
    async (id: string) => {
      setLoadingKinds(true);
      setError(null);
      setKinds([]);
      const resuming = loadTpResume(slug)?.importId === id;
      if (!resuming) setStep("cutoff");
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
    if (run.evidence_import_id !== importId) clearTpResume(slug);
    setSelectedRunId(runId);
    setImportId(run.evidence_import_id);
    setStep("cutoff");
    setStatusLines([]);
    setProgressLog([]);
    setPassReports({});
    setError(null);
  }

  async function runTopPerformersAfterInsights(activeImportId: string) {
    if (!doCarousel && !doVideo) {
      pushStatus("Skipped top-performer deep analysis (carousel and video both off).");
      clearTpResume(slug);
      return;
    }
    setStep("top_performers");
    setProgressLog([]);
    lastProgressRef.current = null;
    pushStatus(
      "Insights ready — starting top-performer deep analysis. Running in the background on CAF — safe to leave this tab open; progress updates below."
    );
    if (doCarousel) {
      const carouselPct = clampTopPct(tpCarouselTopPct);
      const requestBody = {
        action: "run_tp_carousel",
        importId: activeImportId,
        max_rows: tpCarouselMax,
        rating_top_fraction: topFractionFromPct(carouselPct),
      };
      const endpoint = `/api/brand/${encodeURIComponent(slug)}/research/pipeline`;
      pushStatus(
        `Starting carousel deep analysis (top ${carouselPct}%, up to ${tpCarouselMax})…`
      );
      let httpStatus: number | null = null;
      let responseJson: unknown = null;
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        httpStatus = res.status;
        const j = (await res.json()) as {
          ok?: boolean;
          message?: string;
          progress_id?: string;
          accepted?: boolean;
        };
        responseJson = j;
        if (!res.ok || !j.ok || !j.progress_id) {
          throw new Error(j.message ?? "Carousel analysis failed to start");
        }
        saveTpResume(slug, {
          importId: activeImportId,
          phase: "carousel",
          progressId: j.progress_id,
          doCarousel,
          doVideo,
        });
        const progress = await pollProgress(j.progress_id);
        upsertPassReport("carousel", {
          at: new Date().toISOString(),
          pass: "top_performer_carousel",
          success: true,
          project_slug: slug,
          import_id: activeImportId,
          progress_id: j.progress_id,
          http_status: httpStatus,
          endpoint,
          request_body: requestBody,
          response: j,
          progress,
          status_timeline: statusLines.slice(-20),
        });
        pushStatus("Carousel analysis done.");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        upsertPassReport("carousel", {
          at: new Date().toISOString(),
          pass: "top_performer_carousel",
          success: false,
          project_slug: slug,
          import_id: activeImportId,
          progress_id: lastProgressRef.current?.progress_id ?? null,
          http_status: httpStatus,
          endpoint,
          request_body: requestBody,
          response: responseJson,
          error: msg,
          progress: lastProgressRef.current
            ? {
                started_at: lastProgressRef.current.started_at,
                finished_at: lastProgressRef.current.finished_at,
                ok: lastProgressRef.current.ok,
                lines: lastProgressRef.current.lines,
              }
            : undefined,
          status_timeline: statusLines.slice(-20),
        });
        throw e;
      }
    }
    if (doVideo) {
      const videoPct = clampTopPct(tpVideoTopPct);
      const requestBody = {
        action: "run_tp_video",
        importId: activeImportId,
        max_rows: tpVideoMax,
        rating_top_fraction: topFractionFromPct(videoPct),
      };
      const endpoint = `/api/brand/${encodeURIComponent(slug)}/research/pipeline`;
      pushStatus(`Starting video deep analysis (top ${videoPct}%, up to ${tpVideoMax})…`);
      let httpStatus: number | null = null;
      let responseJson: unknown = null;
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        httpStatus = res.status;
        const j = (await res.json()) as {
          ok?: boolean;
          message?: string;
          progress_id?: string;
          accepted?: boolean;
        };
        responseJson = j;
        if (!res.ok || !j.ok || !j.progress_id) {
          throw new Error(j.message ?? "Video analysis failed to start");
        }
        saveTpResume(slug, {
          importId: activeImportId,
          phase: "video",
          progressId: j.progress_id,
          doCarousel,
          doVideo,
        });
        const progress = await pollProgress(j.progress_id);
        upsertPassReport("video", {
          at: new Date().toISOString(),
          pass: "top_performer_video",
          success: true,
          project_slug: slug,
          import_id: activeImportId,
          progress_id: j.progress_id,
          http_status: httpStatus,
          endpoint,
          request_body: requestBody,
          response: j,
          progress,
          status_timeline: statusLines.slice(-20),
        });
        pushStatus("Video analysis done.");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        upsertPassReport("video", {
          at: new Date().toISOString(),
          pass: "top_performer_video",
          success: false,
          project_slug: slug,
          import_id: activeImportId,
          progress_id: lastProgressRef.current?.progress_id ?? null,
          http_status: httpStatus,
          endpoint,
          request_body: requestBody,
          response: responseJson,
          error: msg,
          progress: lastProgressRef.current
            ? {
                started_at: lastProgressRef.current.started_at,
                finished_at: lastProgressRef.current.finished_at,
                ok: lastProgressRef.current.ok,
                lines: lastProgressRef.current.lines,
              }
            : undefined,
          status_timeline: statusLines.slice(-20),
        });
        throw e;
      }
    }
    clearTpResume(slug);
  }

  async function startAnalysis() {
    if (!importId) return;
    setBusy(true);
    setError(null);
    setStep("analyzing");
    setStatusLines([]);
    setProgressLog([]);
    setPassReports({});
    lastProgressRef.current = null;
    clearTpResume(slug);
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
      const tpPlan =
        doCarousel || doVideo
          ? [
              doCarousel ? `carousels top ${clampTopPct(tpCarouselTopPct)}%` : null,
              doVideo ? `videos top ${clampTopPct(tpVideoTopPct)}%` : null,
            ]
              .filter(Boolean)
              .join(", ")
          : "no top-performer pass";
      pushStatus(
        `Analyzing ~${poolForAnalysis} posts across ${kinds.length} platform(s). After insights, CAF will run deep analysis (${tpPlan}). This can take several minutes.`
      );
      const broadBody = {
        action: "run_broad_all",
        importId,
        max_rows: maxRows,
        cutoffs: Object.fromEntries(kinds.map((k) => [k.evidence_kind, k.minScore])),
      };
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/research/pipeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(broadBody),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        message?: string;
        summary?: string;
        total_sent?: number;
      };
      upsertPassReport("broad", {
        at: new Date().toISOString(),
        pass: "broad_insights",
        success: !!(res.ok && j.ok),
        project_slug: slug,
        import_id: importId,
        http_status: res.status,
        endpoint: `/api/brand/${encodeURIComponent(slug)}/research/pipeline`,
        request_body: broadBody,
        response: j,
        error: res.ok && j.ok ? undefined : j.message ?? "Analysis failed",
        status_timeline: [],
      });
      if (!res.ok || !j.ok) throw new Error(j.message ?? "Analysis failed");
      pushStatus(j.summary ?? "Broad analysis finished.");
      await runTopPerformersAfterInsights(importId);
      setStep("done");
      pushStatus(
        "Research brief foundation is ready. Create a research brief below, or open Intelligence to explore patterns."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
      setStep("cutoff");
      clearTpResume(slug);
    } finally {
      setBusy(false);
    }
  }

  async function pollProgress(progressId: string): Promise<{
    started_at?: string | null;
    finished_at: string | null;
    ok: boolean | null;
    lines: ProgressLine[];
  }> {
    const started = Date.now();
    while (Date.now() - started < 60 * 60_000) {
      if (pollAbortRef.current) throw new Error("Progress polling cancelled");
      await new Promise((r) => setTimeout(r, 2000));
      const res = await fetch(
        `/api/brand/${encodeURIComponent(slug)}/research/pipeline?action=pass_progress&progressId=${encodeURIComponent(progressId)}`
      );
      if (!res.ok) continue;
      const j = (await res.json()) as {
        ok?: boolean;
        progress?: {
          started_at?: string;
          finished_at: string | null;
          ok: boolean | null;
          lines?: ProgressLine[];
        };
      };
      const lines = j.progress?.lines ?? [];
      lastProgressRef.current = {
        progress_id: progressId,
        started_at: j.progress?.started_at ?? null,
        finished_at: j.progress?.finished_at ?? null,
        ok: j.progress?.ok ?? null,
        lines,
      };
      if (lines.length) {
        setProgressLog(lines.slice(-12).map((l) => l.message));
      }
      if (j.progress?.finished_at) {
        if (j.progress.ok === false) {
          const last = lines.length ? lines[lines.length - 1]?.message : null;
          throw new Error(last || "Top-performer analysis failed");
        }
        return {
          started_at: j.progress.started_at ?? null,
          finished_at: j.progress.finished_at,
          ok: j.progress.ok,
          lines,
        };
      }
    }
    throw new Error("Top-performer analysis timed out while waiting for progress");
  }

  useEffect(() => {
    if (!importId || resumeAttempted.current) return;
    const saved = loadTpResume(slug);
    if (!saved || saved.importId !== importId) return;
    resumeAttempted.current = true;
    pollAbortRef.current = false;

    void (async () => {
      setBusy(true);
      setError(null);
      setStep("top_performers");
      setDoCarousel(saved.doCarousel);
      setDoVideo(saved.doVideo);
      setStatusLines([]);
      setProgressLog([]);
      pushStatus(
        "Resuming top-performer analysis already running on CAF — progress updates below. Safe to leave this tab open."
      );
      try {
        const checkRes = await fetch(
          `/api/brand/${encodeURIComponent(slug)}/research/pipeline?action=pass_progress&progressId=${encodeURIComponent(saved.progressId)}`
        );
        if (!checkRes.ok) {
          clearTpResume(slug);
          setStep("cutoff");
          pushStatus(
            "Previous background job is no longer available (Core may have restarted). Start research analysis again if needed."
          );
          return;
        }
        const checkJson = (await checkRes.json()) as {
          progress?: {
            finished_at: string | null;
            ok: boolean | null;
            lines?: Array<{ message: string }>;
          };
        };
        const lines = checkJson.progress?.lines ?? [];
        if (lines.length) setProgressLog(lines.slice(-8).map((l) => l.message));

        if (!checkJson.progress?.finished_at) {
          await pollProgress(saved.progressId);
        } else if (checkJson.progress.ok === false) {
          const last = lines.length ? lines[lines.length - 1]?.message : null;
          throw new Error(last || "Top-performer analysis failed");
        }

        if (saved.phase === "carousel") {
          pushStatus("Carousel analysis done.");
          if (saved.doVideo) {
            const videoPct = clampTopPct(tpVideoTopPct);
            pushStatus(`Starting video deep analysis (top ${videoPct}%, up to ${tpVideoMax})…`);
            const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/research/pipeline`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "run_tp_video",
                importId: saved.importId,
                max_rows: tpVideoMax,
                rating_top_fraction: topFractionFromPct(videoPct),
              }),
            });
            const j = (await res.json()) as {
              ok?: boolean;
              message?: string;
              progress_id?: string;
            };
            if (!res.ok || !j.ok || !j.progress_id) {
              throw new Error(j.message ?? "Video analysis failed to start");
            }
            saveTpResume(slug, {
              importId: saved.importId,
              phase: "video",
              progressId: j.progress_id,
              doCarousel: saved.doCarousel,
              doVideo: saved.doVideo,
            });
            await pollProgress(j.progress_id);
            pushStatus("Video analysis done.");
          }
        } else {
          pushStatus("Video analysis done.");
        }

        clearTpResume(slug);
        setStep("done");
        pushStatus(
          "Research brief foundation is ready. Create a research brief below, or open Intelligence to explore patterns."
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Analysis failed";
        const kind: TpPassKind = saved.phase === "video" ? "video" : "carousel";
        upsertPassReport(kind, {
          at: new Date().toISOString(),
          pass: kind === "video" ? "top_performer_video" : "top_performer_carousel",
          success: false,
          project_slug: slug,
          import_id: saved.importId,
          progress_id: lastProgressRef.current?.progress_id ?? saved.progressId,
          error: msg,
          progress: lastProgressRef.current
            ? {
                started_at: lastProgressRef.current.started_at,
                finished_at: lastProgressRef.current.finished_at,
                ok: lastProgressRef.current.ok,
                lines: lastProgressRef.current.lines,
              }
            : undefined,
        });
        setError(msg);
        setStep("cutoff");
        clearTpResume(slug);
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot resume when importId first matches saved progress
  }, [importId, slug]);

  async function createResearchBrief() {
    if (!importId) return;
    setBusy(true);
    setError(null);
    setBuiltPackId(null);
    pushStatus("Creating research brief from insights…");
    try {
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/research/pipeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "build_signal_pack",
          importId,
        }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        message?: string;
        signal_pack_id?: string;
        ideas_count?: number;
        step?: string;
        next_action?: string;
      };
      if (!res.ok || !j.ok || !j.signal_pack_id) {
        const step = j.step ? `[${j.step}] ` : "";
        const next = j.next_action ? ` Next: ${j.next_action}` : "";
        throw new Error(`${step}${j.message ?? "Could not create research brief."}${next}`);
      }
      setBuiltPackId(j.signal_pack_id);
      pushStatus(j.message ?? `Brief ${j.signal_pack_id} ready.`);
      onBriefCreated?.(j.signal_pack_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create research brief");
    } finally {
      setBusy(false);
    }
  }

  async function uploadEvidenceWorkbook(file: File) {
    setEvidenceUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/research/evidence-upload`, {
        method: "POST",
        body: fd,
      });
      const j = (await res.json()) as {
        ok?: boolean;
        message?: string;
        importId?: string;
        totalRows?: number;
      };
      if (!res.ok || !j.ok || !j.importId) {
        throw new Error(
          j.message ??
            "Evidence upload failed. Use a CAF evidence .xlsx, or run scrapers instead."
        );
      }
      pushStatus(j.message ?? `Imported ${j.totalRows ?? 0} rows.`);
      onBriefCreated?.(j.importId);
    } catch (e) {
      setError(
        e instanceof Error
          ? `Evidence upload: ${e.message}`
          : "Evidence upload failed"
      );
    } finally {
      setEvidenceUploading(false);
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
          Start a scrape on the Scrapers tab, or upload an evidence .xlsx workbook here. When evidence is ready,
          you&apos;ll set cutoffs and top-performer thresholds, run analysis, then create a research brief.
        </p>
        {error && <p className="workspace-error">{error}</p>}
        <div className="research-upload-panel" style={{ marginTop: 12 }}>
          <input
            ref={evidenceFileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="research-upload-input-hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void uploadEvidenceWorkbook(file);
            }}
          />
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={evidenceUploading}
            onClick={() => evidenceFileRef.current?.click()}
            data-agent-id="research-evidence-upload"
          >
            {evidenceUploading ? "Uploading…" : "Upload evidence .xlsx"}
          </button>
          <Link href={`/brand/${encodeURIComponent(slug)}/research?tab=scrapers`} className="btn-ghost btn-sm">
            Go to scrapers
          </Link>
        </div>
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
        Pick a completed scrape run, tune cutoffs and top-performer thresholds, then start analysis. One click runs
        insights first, then deep carousel/video analysis with the thresholds you set.
      </p>
      {error && Object.keys(passReports).length === 0 && (
        <p className="workspace-error">{error}</p>
      )}

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

          <h4 style={{ marginTop: 20 }}>3. Top performer thresholds</h4>
          <p className="workspace-muted">
            Set how selective the deep pass should be. These only run after insights finish — same Start button
            chains both. Uncheck a format to skip it.
          </p>
          <div className="research-tp-toggles">
            <label>
              <input
                type="checkbox"
                checked={doCarousel}
                onChange={(e) => setDoCarousel(e.target.checked)}
                disabled={busy}
                data-agent-id="research-tp-carousel"
              />{" "}
              Carousels
            </label>
            <label>
              <input
                type="checkbox"
                checked={doVideo}
                onChange={(e) => setDoVideo(e.target.checked)}
                disabled={busy}
                data-agent-id="research-tp-video"
              />{" "}
              Videos
            </label>
          </div>
          {doCarousel && (
            <div className="research-tp-format-settings">
              <label className="research-cutoff-slider">
                <span>Carousel top performers: top {clampTopPct(tpCarouselTopPct)}%</span>
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={1}
                  value={tpCarouselTopPct}
                  onChange={(e) => setTpCarouselTopPct(Number(e.target.value))}
                  disabled={busy}
                  data-agent-id="research-tp-carousel-pct"
                />
              </label>
              <label className="research-cutoff-slider">
                <span>
                  Carousel max rows:{" "}
                  <input
                    type="number"
                    min={1}
                    max={40}
                    value={tpCarouselMax}
                    onChange={(e) => setTpCarouselMax(Number(e.target.value))}
                    disabled={busy}
                    style={{ width: 56 }}
                    data-agent-id="research-tp-carousel-max"
                  />
                </span>
              </label>
            </div>
          )}
          {doVideo && (
            <div className="research-tp-format-settings">
              <label className="research-cutoff-slider">
                <span>Video top performers: top {clampTopPct(tpVideoTopPct)}%</span>
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={1}
                  value={tpVideoTopPct}
                  onChange={(e) => setTpVideoTopPct(Number(e.target.value))}
                  disabled={busy}
                  data-agent-id="research-tp-video-pct"
                />
              </label>
              <label className="research-cutoff-slider">
                <span>
                  Video max rows:{" "}
                  <input
                    type="number"
                    min={1}
                    max={40}
                    value={tpVideoMax}
                    onChange={(e) => setTpVideoMax(Number(e.target.value))}
                    disabled={busy}
                    style={{ width: 56 }}
                    data-agent-id="research-tp-video-max"
                  />
                </span>
              </label>
            </div>
          )}
          {!doCarousel && !doVideo && (
            <p className="workspace-muted" style={{ marginTop: 8 }}>
              Both formats off — Start will run insights only, then go straight to creating a research brief.
            </p>
          )}

          <button
            type="button"
            className="btn-primary"
            disabled={busy || kinds.length === 0 || poolForAnalysis === 0}
            onClick={() => void startAnalysis()}
            data-agent-id="research-start-analysis"
            style={{ marginTop: 16 }}
          >
            {busy
              ? "Starting…"
              : doCarousel || doVideo
                ? `Start research analysis (~${poolForAnalysis})`
                : `Start insights only (~${poolForAnalysis})`}
          </button>
        </div>
      )}

      {(step === "analyzing" || step === "top_performers") && (
        <div className="research-chill-card">
          <p className="research-chill-title">
            {step === "analyzing"
              ? "Analyzing every selected post"
              : "Deep top-performer analysis"}
          </p>
          <p className="research-lead">
            {step === "analyzing"
              ? "CAF is reading captions and engagement signals platform by platform. When insights finish, the top-performer pass starts automatically with the thresholds you set."
              : "Deep analysis runs in the background on CAF. Keep this tab open for live progress, or leave and come back — we will resume polling if the job is still running."}
          </p>
          <ul className="research-status-log">
            {statusLines.slice(-6).map((line, i) => (
              <li key={`${i}-${line.slice(0, 24)}`}>{line}</li>
            ))}
            {progressLog.slice(-6).map((line, i) => (
              <li key={`p-${i}`} className="workspace-muted">
                {line}
              </li>
            ))}
          </ul>
          <ResearchPassDiagnostics
            reports={passReports}
            statusLines={statusLines}
            progressLog={progressLog}
            error={null}
          />
          <div className="research-pulse" aria-hidden />
        </div>
      )}

      {step === "cutoff" && (error || Object.keys(passReports).length > 0) && (
        <ResearchPassDiagnostics
          reports={passReports}
          statusLines={statusLines}
          progressLog={progressLog}
          error={error}
          defaultOpen
        />
      )}

      {step === "done" && (
        <div className="research-pipeline-step" data-agent-id="research-pipeline-done">
          <h4>Create research brief</h4>
          <p className="research-lead">
            Compile market intelligence from this analysis into a research brief. Create ideas later on Market
            Intelligence — not here.
          </p>
          {error && <p className="workspace-error">{error}</p>}
          <ResearchPassDiagnostics
            reports={passReports}
            statusLines={statusLines}
            progressLog={progressLog}
            error={null}
          />
          <div className="research-profile-confirm">
            <p className="research-profile-confirm__title">Processing profile</p>
            {profileLoading && !profile ? (
              <p className="workspace-muted">Loading profile defaults…</p>
            ) : (
              <p className="workspace-muted">
                Models: <strong>{profile?.rating_model ?? "gpt-4o-mini"}</strong> (rating) ·{" "}
                <strong>{profile?.synth_model ?? "gpt-4o-mini"}</strong> (synth). Min pack score:{" "}
                {(profile?.min_llm_score_for_pack ?? 0.35).toFixed(2)}.
              </p>
            )}
          </div>
          {!builtPackId ? (
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !importId}
              onClick={() => void createResearchBrief()}
              data-agent-id="research-create-brief"
              style={{ marginTop: 12 }}
            >
              {busy ? "Creating brief…" : "Create research brief"}
            </button>
          ) : (
            <div className="research-chill-card research-chill-card--done" style={{ marginTop: 12 }}>
              <p className="research-chill-title">Research brief ready</p>
              <p className="research-lead">
                Pack <code className="mono">{builtPackId}</code>. Open Market Intelligence to explore patterns and
                create ideas for this brief.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Link
                  className="btn-primary"
                  href={`/brand/${encodeURIComponent(slug)}/intelligence?packId=${encodeURIComponent(builtPackId)}`}
                  data-agent-id="research-goto-intelligence"
                >
                  Open Market Intelligence →
                </Link>
              </div>
            </div>
          )}
          {busy && <div className="research-pulse" aria-hidden />}
        </div>
      )}
    </section>
  );
}
