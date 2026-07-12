"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useContentCart } from "@/components/marketer/ContentCartContext";
import { buildCartCreationPayload, normalizeCartItemFlow } from "@/lib/marketer/cart-flow-resolve";
import { GENERATION_STRATEGY_OPTIONS } from "@/lib/marketer/generation-strategy";
import { isVideoTopPerformerItem } from "@/lib/marketer/video-lane";

type StartPhase = "idle" | "starting" | "done" | "error";

export function ContentCartReviewModal({ slug }: { slug: string }) {
  const { items, briefPackId, detachBriefPackId, reviewOpen, setReviewOpen, setDrawerOpen, clear } = useContentCart();
  const [phase, setPhase] = useState<StartPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    run_id: string;
    content_url: string;
    admin_runs_url: string;
    message: string;
  } | null>(null);

  const normalized = useMemo(() => items.map(normalizeCartItemFlow), [items]);
  const payload = useMemo(() => buildCartCreationPayload(slug, normalized), [slug, normalized]);

  const close = useCallback(() => {
    setReviewOpen(false);
    setPhase("idle");
    setError(null);
    setResult(null);
  }, [setReviewOpen]);

  useEffect(() => {
    if (briefPackId && error) setError(null);
  }, [briefPackId, error]);

  if (!reviewOpen) return null;

  const needsBrief = !briefPackId && normalized.length > 0;
  const canStart = Boolean(briefPackId) && normalized.length > 0 && phase !== "starting";

  async function handleStart() {
    if (!briefPackId || !normalized.length) return;
    setPhase("starting");
    setError(null);
    try {
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/cart/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId: briefPackId, items: normalized }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        if (j.error === "stale_brief") detachBriefPackId();
        throw new Error(j.message ?? j.error ?? "Failed to start run");
      }
      setResult({
        run_id: j.run_id,
        content_url: j.content_url,
        admin_runs_url: j.admin_runs_url,
        message: j.message,
      });
      setPhase("done");
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Failed to start run");
    }
  }

  return (
    <div className="content-cart-review-overlay" role="presentation" onClick={close}>
      <div
        className="content-cart-review-modal"
        role="dialog"
        aria-label="Review content cart"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="content-cart-review-header">
          <div>
            <h2>Review &amp; start creation</h2>
            <p className="content-cart-review-sub">
              {normalized.length} item{normalized.length === 1 ? "" : "s"} → plan jobs, generate drafts, and render
              media.
            </p>
            {briefPackId ? (
              <p className="content-cart-review-brief">Saved to this research brief</p>
            ) : needsBrief ? (
              <p className="content-cart-review-error">
                Cart items kept —{" "}
                <Link href={`/brand/${encodeURIComponent(slug)}/ideas`} onClick={close}>
                  pick a research brief on Ideas
                </Link>{" "}
                before starting.
              </p>
            ) : normalized.length === 0 ? (
              <p className="content-cart-review-sub">Add ideas or top performers from Ideas first.</p>
            ) : null}
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={close}>
            Close
          </button>
        </header>

        <div className="content-cart-review-body">
          <section className="content-cart-review-summary">
            <h3>What will be created</h3>
            <ul className="content-cart-review-lines">
              {normalized.map((item) => {
                const strategyLabel = GENERATION_STRATEGY_OPTIONS.find(
                  (o) => o.id === item.generationStrategy
                )?.label;
                return (
                  <li key={item.id}>
                    <strong>{item.title}</strong>
                    <span>
                      {item.flowDestination}
                      {item.kind === "idea" && strategyLabel ? ` · ${strategyLabel}` : ""}
                      {item.kind === "top_performer" && isVideoTopPerformerItem(item)
                        ? " · Video"
                        : item.kind === "top_performer" && item.mimicMode === "why_carousel"
                          ? " · Why mimic"
                          : item.kind === "top_performer"
                            ? " · Replica"
                            : ""}
                    </span>
                    <code>{item.flowTypeRaw}</code>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="content-cart-review-payload">
            <h3>Run payload</h3>
            <pre>{JSON.stringify(payload, null, 2)}</pre>
          </section>
        </div>

        <footer className="content-cart-review-footer">
          {phase === "done" && result ? (
            <div className="content-cart-review-success-block">
              <p className="content-cart-review-success">
                <strong>Run {result.run_id}</strong> is in progress. {result.message}
              </p>
              <div className="content-cart-review-links">
                <Link href={result.content_url} className="btn-primary btn-sm" onClick={close}>
                  Go to Content
                </Link>
                <a href={result.admin_runs_url} className="btn-ghost btn-sm" target="_blank" rel="noopener noreferrer">
                  Operator runs view
                </a>
              </div>
            </div>
          ) : phase === "starting" ? (
            <p className="content-cart-review-sub">Starting run — planning jobs and kicking off generation…</p>
          ) : (
            <p className="section-stub-note">
              This creates a CAF run from your cart, materializes planner rows, starts the run, then runs generation
              and rendering in the background.
            </p>
          )}
          {error ? <p className="content-cart-review-error">{error}</p> : null}
          <div className="content-cart-review-actions">
            <button type="button" className="btn-ghost" onClick={() => setDrawerOpen(true)} disabled={phase === "starting"}>
              Edit cart
            </button>
            {phase === "done" ? (
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  clear();
                  close();
                }}
              >
                Clear cart &amp; close
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary content-cart-start-btn"
                disabled={!canStart}
                onClick={() => void handleStart()}
              >
                {phase === "starting" ? "Starting…" : "Start generation run"}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
