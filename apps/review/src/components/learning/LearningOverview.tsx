"use client";

import Link from "next/link";
import { useLearningProject } from "@/components/learning/LearningProjectProvider";

function LoopCard(props: {
  title: string;
  summary: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="learning-loop" style={{ padding: 14 }}>
      <div className="learning-loop-head">
        <span>{props.title}</span>
      </div>
      <p style={{ margin: "8px 0 12px", fontSize: 13, color: "var(--fg-secondary)", lineHeight: 1.45 }}>
        {props.summary}
      </p>
      <Link href={props.href} className="btn-ghost" style={{ fontSize: 12, textDecoration: "none" }}>
        {props.cta} →
      </Link>
    </div>
  );
}

export function LearningOverview() {
  const { pending, active, llmReviews, observations, analysisResult } = useLearningProject();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {pending.length > 0 ? (
        <section className="learning-section" style={{ borderColor: "var(--accent)" }}>
          <div className="learning-section-head">
            <h3>
              <span className="pill pill-warn">action</span> {pending.length} pending rule
              {pending.length === 1 ? "" : "s"} waiting
            </h3>
            <p>Review suggestions in Inbox — Apply to ship guidance into the next run, or Drop to dismiss.</p>
          </div>
          <Link href="/learning/inbox" className="btn-primary" style={{ textDecoration: "none", display: "inline-block" }}>
            Open Inbox
          </Link>
        </section>
      ) : null}

      <section className="learning-section">
        <div className="learning-section-head">
          <h3>Learning loops</h3>
          <p>Run analyzers manually; nothing auto-applies without your confirmation.</p>
        </div>
        <ul className="learning-loop-list">
          <LoopCard
            title="Editorial"
            summary="Human review patterns → pending GENERATION_GUIDANCE and ranking rules."
            href="/learning/analyzers"
            cta="Run editorial analysis"
          />
          <LoopCard
            title="Performance"
            summary="CSV metrics → global observatory (+ optional project rules)."
            href="/learning/analyzers"
            cta="Upload CSV / analyze"
          />
          <LoopCard
            title="Nemotron review"
            summary="Approved rendered output → TP-parity insights and optional guidance rules."
            href="/learning/analyzers"
            cta="Run Nemotron batch"
          />
        </ul>
      </section>

      <section className="learning-section">
        <div className="learning-section-head">
          <h3>At a glance</h3>
        </div>
        <div className="learning-hero-stats">
          <div className="learning-stat-chip">
            <span className="k">active rules</span>
            <span className="v">{active.length}</span>
          </div>
          <div className="learning-stat-chip">
            <span className="k">nemotron reviews</span>
            <span className="v">{llmReviews.length}</span>
          </div>
          <div className="learning-stat-chip">
            <span className="k">observations</span>
            <span className="v">{observations.length}</span>
          </div>
          <div className="learning-stat-chip">
            <span className="k">last analysis</span>
            <span className="v">{analysisResult ? "yes" : "—"}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
