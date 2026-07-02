"use client";

import { useMemo } from "react";
import { JsonTreeViewer } from "@/components/JsonTreeViewer";
import { buildMarketIntelligenceView } from "@/lib/marketer/market-intelligence-adapters";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function ResearchBriefPanel({ pack }: { pack: Record<string, unknown> | null }) {
  const derived = useMemo(() => asRecord(pack?.derived_globals_json), [pack]);
  const miRaw = useMemo(() => asRecord(derived?.market_intelligence_v1), [derived]);
  const view = useMemo(() => buildMarketIntelligenceView(pack, []), [pack]);

  if (!miRaw || miRaw.schema_version !== 1) {
    return (
      <p style={{ color: "var(--muted)", fontSize: 13, maxWidth: 720, lineHeight: 1.5 }}>
        No <code style={{ fontSize: 12 }}>market_intelligence_v1</code> on this pack yet. Complete{" "}
        <strong>Insights</strong> in Processing, then <strong>build the signal pack</strong> — the research brief is
        compiled from insights and top performers when the pack is created. You can also re-run{" "}
        <strong>Research briefing (AI)</strong> in Processing after the pack exists.
      </p>
    );
  }

  const llmPolished = miRaw.llm_polished === true;

  return (
    <section style={{ maxWidth: 900 }}>
      <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>
        From <code style={{ fontSize: 12 }}>derived_globals_json.market_intelligence_v1</code>
        {view.rowsAnalyzed != null ? ` · ${view.rowsAnalyzed} posts analyzed` : ""}
        {llmPolished ? " · AI polished" : " · deterministic synthesis"}
      </p>

      {view.researchBriefTitle ? (
        <h3 style={{ margin: "0 0 12px", fontSize: 18, fontWeight: 600 }}>{view.researchBriefTitle}</h3>
      ) : null}

      {view.marketOverview ? (
        <BriefBlock title="Market overview">
          <p style={{ margin: 0, lineHeight: 1.55 }}>{view.marketOverview}</p>
        </BriefBlock>
      ) : null}

      {view.whatWorked ? (
        <BriefBlock title="What worked">
          <p style={{ margin: 0, lineHeight: 1.55 }}>{view.whatWorked}</p>
        </BriefBlock>
      ) : null}

      {view.summaryBullets.length > 0 ? (
        <BriefBlock title="Executive summary">
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.5 }}>
            {view.summaryBullets.map((b, i) => (
              <li key={i} style={{ marginBottom: 6 }}>
                {b}
              </li>
            ))}
          </ul>
        </BriefBlock>
      ) : null}

      {view.actionPlaybook && view.actionPlaybook.length > 0 ? (
        <BriefBlock title="Action playbook">
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.5 }}>
            {view.actionPlaybook.map((a, i) => (
              <li key={i} style={{ marginBottom: 6 }}>
                {a}
              </li>
            ))}
          </ul>
        </BriefBlock>
      ) : null}

      {view.competitiveLandscape ? (
        <BriefBlock title="Competitive landscape">
          <p style={{ margin: "0 0 12px", lineHeight: 1.55 }}>{view.competitiveLandscape.overview}</p>
          {view.competitiveLandscape.brands.map((b) => (
            <div
              key={b.handle}
              style={{
                marginBottom: 10,
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--surface-2, #151515)",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {b.handle} <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {b.platform}</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.45 }}>
                {b.signatureMoves.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
              {b.standoutExample ? (
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>
                  Example: {b.standoutExample}
                </p>
              ) : null}
            </div>
          ))}
        </BriefBlock>
      ) : null}

      {view.winningPatterns.length > 0 ? (
        <BriefBlock title="Winning patterns">
          <PatternList items={view.winningPatterns} />
        </BriefBlock>
      ) : null}

      {view.hooks.length > 0 ? (
        <BriefBlock title="Hooks">
          <PatternList items={view.hooks} />
        </BriefBlock>
      ) : null}

      {view.avoid.length > 0 ? (
        <BriefBlock title="What to avoid">
          <PatternList items={view.avoid} />
        </BriefBlock>
      ) : null}

      {view.hooksDigest?.keyTakeaways && view.hooksDigest.keyTakeaways.length > 0 ? (
        <BriefBlock title="Hook strategy">
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.5 }}>
            {view.hooksDigest.keyTakeaways.map((t, i) => (
              <li key={i} style={{ marginBottom: 6 }}>
                {t}
              </li>
            ))}
          </ul>
        </BriefBlock>
      ) : null}

      {view.topPerformers.length > 0 ? (
        <BriefBlock title="Top performer highlights">
          {view.topPerformers.map((tp) => (
            <div
              key={tp.id}
              style={{
                marginBottom: 10,
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}
            >
              <div style={{ fontWeight: 600 }}>{tp.title}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                {tp.platform} · {tp.format}
              </div>
              {tp.why ? <p style={{ margin: "0 0 6px", fontSize: 13, lineHeight: 1.45 }}>{tp.why}</p> : null}
              {tp.applyThis ? (
                <p style={{ margin: 0, fontSize: 12 }}>
                  <strong>Apply:</strong> {tp.applyThis}
                </p>
              ) : null}
            </div>
          ))}
        </BriefBlock>
      ) : null}

      <details style={{ marginTop: 20 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--muted)" }}>Raw market_intelligence_v1</summary>
        <div style={{ marginTop: 10 }}>
          <JsonTreeViewer data={miRaw} />
        </div>
      </details>
    </section>
  );
}

function BriefBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h4 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)" }}>
        {title}
      </h4>
      {children}
    </div>
  );
}

function PatternList({ items }: { items: { id: string; title: string; summary: string; evidenceCount?: number }[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.slice(0, 12).map((p) => (
        <div
          key={p.id}
          style={{
            padding: "10px 12px",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--surface-2, #151515)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{p.title}</div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: "var(--fg-secondary, var(--fg))" }}>
            {p.summary}
          </p>
          {p.evidenceCount != null && p.evidenceCount > 0 ? (
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted)" }}>
              {p.evidenceCount} {p.evidenceCount === 1 ? "post" : "posts"}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
