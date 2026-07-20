"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandPageHeader } from "@/components/marketer/BrandPageHeader";
import { LoadingWithTip, PageTip } from "@/components/marketer/PageTip";
import type { BrandSummary } from "@/lib/marketer/types";

interface FlowDecisionStats {
  flow_type: string;
  decided: number;
  approved: number;
  needs_edit: number;
  rejected: number;
  approval_rate: number;
}

interface FormatPerformance {
  flow_type: string;
  posts_with_metrics: number;
  avg_engagement_rate: number;
  lift: number;
  significant: boolean;
  direction: "increase" | "decrease" | "neutral";
}

interface LearnedRuleSummary {
  rule_id: string;
  status: string;
  action_type: string;
  rule_family: string | null;
  scope_flow_type: string | null;
  scope_platform: string | null;
  provenance: string | null;
  headline: string;
  created_at: string;
}

interface LifecycleSuggestion {
  rule_id: string;
  suggestion: string;
  reason: string;
  evidence: string;
  approval_delta: number | null;
  decided_tasks: number;
  suggested_multiplier: number | null;
  current_multiplier: number | null;
  action_type: string | null;
  status: string | null;
}

interface PerformanceSummary {
  ok: boolean;
  window_days: number;
  editorial: {
    decided_tasks: number;
    approved: number;
    needs_edit: number;
    rejected: number;
    approval_rate: number | null;
    by_flow: FlowDecisionStats[];
  };
  performance: {
    posts_with_metrics: number;
    avg_engagement_rate: number | null;
    by_format: FormatPerformance[];
  };
  learning: {
    active_rules: number;
    pending_rules: number;
    recent_rules: LearnedRuleSummary[];
  };
  suggestions: LifecycleSuggestion[];
  evidence: { has_reviews: boolean; has_metrics: boolean; has_rules: boolean };
}

function flowLabel(flowType: string): string {
  const t = (flowType ?? "").trim();
  if (!t || t === "unknown") return "Other";
  return t
    .replace(/^FLOW_/i, "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

function engagement(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

function suggestionLabel(kind: string): string {
  switch (kind) {
    case "retire":
      return "Consider retiring";
    case "renew":
      return "Working — keep";
    case "adjust_weight":
      return "Adjust weight";
    case "dead_rule":
      return "Not matching anything";
    default:
      return kind.replaceAll("_", " ");
  }
}

function suggestionTone(kind: string): string {
  if (kind === "retire" || kind === "dead_rule") return "perf-chip--bad";
  if (kind === "renew") return "perf-chip--good";
  return "perf-chip--warn";
}

export default function BrandPerformancePage() {
  const params = useParams();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const [brand, setBrand] = useState<BrandSummary | null>(null);
  const [summary, setSummary] = useState<PerformanceSummary | null>(null);
  const [windowDays, setWindowDays] = useState(60);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [mintPendingRules, setMintPendingRules] = useState(false);
  const [includeFailureLane, setIncludeFailureLane] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!slug) return;
    fetch("/api/workspace/brands?lite=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setBrand(j?.brands?.find((b: BrandSummary) => b.slug === slug) ?? null))
      .catch(() => setBrand(null));
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    fetch(`/api/brand/${encodeURIComponent(slug)}/performance?window_days=${windowDays}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: PerformanceSummary) => setSummary(j))
      .catch(() => setError("Could not load performance data. Is CAF Core reachable?"))
      .finally(() => setLoading(false));
  }, [slug, windowDays, refreshKey]);

  async function runAction(action: string, extra?: Record<string, unknown>) {
    if (!slug || busy) return;
    setBusy(action);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/performance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, window_days: windowDays, ...extra }),
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || j.error) {
        setActionMsg(String(j.error ?? `Request failed (HTTP ${res.status})`));
        return;
      }
      if (action === "performance_analysis") {
        const insights = Array.isArray(j.insights) ? j.insights.length : 0;
        const rules = typeof j.rules_created === "number" ? j.rules_created : 0;
        setActionMsg(
          `Performance analysis done — ${insights} insight${insights === 1 ? "" : "s"}${
            mintPendingRules ? `, ${rules} pending rule${rules === 1 ? "" : "s"} minted` : ""
          }.`
        );
      } else if (action === "llm_review") {
        const results = Array.isArray(j.results) ? j.results : [];
        const done = results.filter((r) => (r as { ok?: boolean; skipped?: boolean }).ok && !(r as { skipped?: boolean }).skipped).length;
        const skipped = results.filter((r) => (r as { skipped?: boolean }).skipped).length;
        const minted = results.filter((r) => (r as { minted_pending_rule?: boolean; minted_pending_positive_rule?: boolean }).minted_pending_rule || (r as { minted_pending_positive_rule?: boolean }).minted_pending_positive_rule).length;
        setActionMsg(
          `AI content review done — ${done} reviewed${skipped ? `, ${skipped} skipped` : ""}${
            minted ? `, ${minted} pending learning${minted === 1 ? "" : "s"} created` : ""
          }.`
        );
      } else if (action === "pull_metrics") {
        const pulled = typeof j.pulled === "number" ? j.pulled : typeof j.ingested === "number" ? j.ingested : null;
        setActionMsg(
          pulled != null
            ? `Pulled metrics for ${pulled} published post${pulled === 1 ? "" : "s"}.`
            : "Metrics pull finished."
        );
      } else {
        setActionMsg("Done.");
      }
      setRefreshKey((k) => k + 1);
    } catch {
      setActionMsg("Request failed — is CAF Core reachable?");
    } finally {
      setBusy(null);
    }
  }

  const base = `/brand/${encodeURIComponent(slug)}`;
  const significantFormats = summary?.performance.by_format.filter((f) => f.significant) ?? [];

  return (
    <div className="brand-section-page" data-agent-id="performance-learning-page">
      {brand && (
        <BrandPageHeader
          displayName={brand.displayName}
          slug={slug}
          accentColor={brand.accentColor}
          subtitle="What worked, what didn't, and what to try next"
        />
      )}

      <div className="perf-toolbar">
        <h2>Performance &amp; learning</h2>
        <label className="perf-window-select">
          Window
          <select value={windowDays} onChange={(e) => setWindowDays(parseInt(e.target.value, 10))}>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
          </select>
        </label>
      </div>

      <section className="perf-actions" data-agent-id="perf-run-actions">
        <h3>Run learning</h3>
        <p className="perf-note">
          Pull fresh engagement numbers, analyze what&apos;s working, or have CAF review your approved content
          with vision AI (Nemotron) so it can mint pending learnings.
        </p>
        <div className="perf-action-options">
          <label>
            <input
              type="checkbox"
              checked={mintPendingRules}
              onChange={(e) => setMintPendingRules(e.target.checked)}
            />
            Performance analysis: also mint pending rules
          </label>
          <label>
            <input
              type="checkbox"
              checked={includeFailureLane}
              onChange={(e) => setIncludeFailureLane(e.target.checked)}
            />
            AI review: also include rejected / needs-edit drafts
          </label>
        </div>
        <div className="perf-action-bar">
          <button
            type="button"
            className="btn-ghost"
            disabled={!!busy}
            onClick={() => runAction("pull_metrics")}
            title="Fetches likes, comments, shares, saves, and reach from Meta for published posts."
          >
            {busy === "pull_metrics" ? "Pulling…" : "Pull Meta metrics"}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!!busy}
            onClick={() =>
              runAction("performance_analysis", { auto_create_rules: mintPendingRules })
            }
            title="Analyzes ingested engagement by format and writes observatory insights."
          >
            {busy === "performance_analysis" ? "Analyzing…" : "Run performance analysis"}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!!busy}
            onClick={() =>
              runAction("llm_review", {
                include_failure_lane: includeFailureLane,
                limit: 5,
              })
            }
            title="Runs Nemotron VL on approved content (and optionally rejected/needs-edit) to create pending generation guidance."
          >
            {busy === "llm_review" ? "Reviewing…" : "Run AI content review"}
          </button>
        </div>
        {actionMsg && <p className="perf-action-msg">{actionMsg}</p>}
      </section>

      {loading && <LoadingWithTip page="performance" label="Loading performance data…" />}
      {error && <p className="perf-error">{error}</p>}

      {!loading && !error && summary && (
        <>
          <PageTip page="performance" salt="banner" className="page-tip-banner" />
          <div className="dashboard-stat-grid">
            <div className="dashboard-stat-card">
              <span className="dashboard-stat-value">{pct(summary.editorial.approval_rate)}</span>
              <span className="dashboard-stat-label">Approval rate</span>
            </div>
            <div className="dashboard-stat-card">
              <span className="dashboard-stat-value">{summary.editorial.decided_tasks}</span>
              <span className="dashboard-stat-label">Drafts reviewed</span>
            </div>
            <div className="dashboard-stat-card">
              <span className="dashboard-stat-value">{summary.performance.posts_with_metrics}</span>
              <span className="dashboard-stat-label">Posts with metrics</span>
            </div>
            <div className="dashboard-stat-card">
              <span className="dashboard-stat-value">{engagement(summary.performance.avg_engagement_rate)}</span>
              <span className="dashboard-stat-label">Avg engagement</span>
            </div>
            <div className="dashboard-stat-card">
              <span className="dashboard-stat-value">{summary.learning.active_rules}</span>
              <span className="dashboard-stat-label">Active learnings</span>
            </div>
          </div>

          {/* ── What worked / what didn't ─────────────────────────────── */}
          <section className="perf-section" data-agent-id="perf-what-worked">
            <h3>What worked and what did not</h3>
            {summary.evidence.has_metrics ? (
              <table className="perf-table">
                <thead>
                  <tr>
                    <th>Format</th>
                    <th>Posts</th>
                    <th>Avg engagement</th>
                    <th>Vs your average</th>
                    <th>Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.performance.by_format.map((f) => (
                    <tr key={f.flow_type}>
                      <td>{flowLabel(f.flow_type)}</td>
                      <td>{f.posts_with_metrics}</td>
                      <td>{engagement(f.avg_engagement_rate)}</td>
                      <td className={f.lift > 0 ? "perf-pos" : f.lift < 0 ? "perf-neg" : ""}>
                        {f.lift > 0 ? "+" : ""}
                        {Math.round(f.lift * 100)}%
                      </td>
                      <td>
                        {f.direction === "increase" && <span className="perf-chip perf-chip--good">Do more</span>}
                        {f.direction === "decrease" && <span className="perf-chip perf-chip--bad">Do less</span>}
                        {f.direction === "neutral" && <span className="perf-chip">Too early to say</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="perf-empty">
                <p>
                  No engagement metrics yet. Metrics appear after you publish content — CAF can pull them
                  automatically from Meta, or you can upload a CSV from the learning tools.
                </p>
                <Link href={`${base}/publishing`} className="btn-ghost">
                  Go to publishing
                </Link>
              </div>
            )}
          </section>

          {/* ── Editorial funnel ──────────────────────────────────────── */}
          <section className="perf-section" data-agent-id="perf-editorial">
            <h3>How your reviews went</h3>
            {summary.evidence.has_reviews ? (
              <table className="perf-table">
                <thead>
                  <tr>
                    <th>Format</th>
                    <th>Reviewed</th>
                    <th>Approved</th>
                    <th>Needs edit</th>
                    <th>Rejected</th>
                    <th>Approval rate</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.editorial.by_flow.map((f) => (
                    <tr key={f.flow_type}>
                      <td>{flowLabel(f.flow_type)}</td>
                      <td>{f.decided}</td>
                      <td>{f.approved}</td>
                      <td>{f.needs_edit}</td>
                      <td>{f.rejected}</td>
                      <td className={f.approval_rate >= 0.6 ? "perf-pos" : f.approval_rate < 0.4 ? "perf-neg" : ""}>
                        {pct(f.approval_rate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="perf-empty">
                <p>No reviewed drafts in this window. Once you approve or reject content, your feedback shows up here.</p>
                <Link href={`${base}/content`} className="btn-ghost">
                  Review content
                </Link>
              </div>
            )}
          </section>

          {/* ── What CAF learned ──────────────────────────────────────── */}
          <section className="perf-section" data-agent-id="perf-learnings">
            <h3>What CAF learned from your feedback</h3>
            {summary.evidence.has_rules ? (
              <>
                <p className="perf-note">
                  {summary.learning.active_rules} active learning{summary.learning.active_rules === 1 ? "" : "s"} shaping
                  new content
                  {summary.learning.pending_rules > 0 && (
                    <> · {summary.learning.pending_rules} pending your approval in the <Link href="/learning">learning tools</Link></>
                  )}
                </p>
                <ul className="perf-rule-list">
                  {summary.learning.recent_rules.map((r) => (
                    <li key={r.rule_id}>
                      <span className={`perf-chip ${r.status === "active" ? "perf-chip--good" : "perf-chip--warn"}`}>
                        {r.status}
                      </span>
                      <span className="perf-rule-headline">{r.headline}</span>
                      <span className="perf-rule-scope">
                        {r.scope_flow_type ? flowLabel(r.scope_flow_type) : "All formats"}
                        {r.scope_platform ? ` · ${r.scope_platform}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="perf-empty">
                <p>
                  Nothing learned yet. Learnings are created from your review decisions, edits, published-post
                  metrics, and CAF&apos;s own quality reviews — they build up as you use the pipeline.
                </p>
              </div>
            )}
          </section>

          {/* ── Suggestions for next cycle ────────────────────────────── */}
          <section className="perf-section" data-agent-id="perf-suggestions">
            <h3>Suggestions for the next content cycle</h3>
            {summary.suggestions.length > 0 || significantFormats.length > 0 ? (
              <ul className="perf-suggestion-list">
                {significantFormats.map((f) => (
                  <li key={`fmt_${f.flow_type}`}>
                    <span className={`perf-chip ${f.direction === "increase" ? "perf-chip--good" : "perf-chip--bad"}`}>
                      {f.direction === "increase" ? "Do more" : "Do less"}
                    </span>
                    <span>
                      {flowLabel(f.flow_type)} is {f.lift > 0 ? "outperforming" : "underperforming"} your average by{" "}
                      {Math.abs(Math.round(f.lift * 100))}% across {f.posts_with_metrics} posts.
                    </span>
                  </li>
                ))}
                {summary.suggestions.map((s) => (
                  <li key={s.rule_id}>
                    <span className={`perf-chip ${suggestionTone(s.suggestion)}`}>{suggestionLabel(s.suggestion)}</span>
                    <span>{s.reason}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="perf-empty">
                <p>
                  No recommendations yet — CAF needs more reviewed and published content in this window before it can
                  say what to change with confidence.
                </p>
              </div>
            )}
          </section>

          <div className="section-stub-actions">
            <Link href={`${base}/content`} className="btn-primary">
              Review content
            </Link>
            <Link href={`${base}/publishing`} className="btn-ghost">
              Publishing
            </Link>
            <Link href="/learning" className="btn-ghost">
              Learning tools
            </Link>
            <Link href={base} className="btn-ghost">
              Dashboard
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
