"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type LearningSummary = {
  ok: boolean;
  project_slug: string;
  rules: { total: number; active: number; pending: number; expired: number };
  evidence: { observations: number; insights: number; hypotheses: number; trials: number };
  attribution: number;
};

type LearningRule = {
  rule_id: string;
  action_type: string;
  action_payload: Record<string, unknown>;
  status: string;
  rule_family?: string;
  scope_flow_type?: string | null;
  scope_platform?: string | null;
  confidence?: number | null;
  created_at?: string;
  applied_at?: string | null;
  storage_project_slug?: string;
  evidence_refs?: unknown[];
};

function StatCard(props: { label: string; value: string | number; sub?: string }) {
  return (
    <div
      className="card"
      style={{
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 160,
      }}
    >
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{props.label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>{props.value}</div>
      {props.sub ? <div style={{ fontSize: 12, color: "var(--fg-secondary)" }}>{props.sub}</div> : null}
    </div>
  );
}

export default function GlobalLearningPage() {
  const globalSlug = "caf-global";
  const [summary, setSummary] = useState<LearningSummary | null>(null);
  const [rules, setRules] = useState<LearningRule[]>([]);
  const [observations, setObservations] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  const [previewProjectSlug, setPreviewProjectSlug] = useState("SNS");
  const [contextPreview, setContextPreview] = useState<Record<string, unknown> | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, rulesRes, obsRes] = await Promise.all([
        fetch(`/api/learning?project=${encodeURIComponent(globalSlug)}&section=summary`),
        fetch(`/api/learning?project=${encodeURIComponent(globalSlug)}`),
        fetch(`/api/learning?project=${encodeURIComponent(globalSlug)}&section=observations&limit=200`),
      ]);
      if (sumRes.ok) setSummary((await sumRes.json()) as LearningSummary);
      if (rulesRes.ok) {
        const j = (await rulesRes.json()) as { rules?: LearningRule[] };
        setRules(j.rules ?? []);
      }
      if (obsRes.ok) {
        const j = (await obsRes.json()) as { observations?: Record<string, unknown>[] };
        setObservations(j.observations ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const activeGlobalRules = useMemo(
    () => rules.filter((r) => (r.storage_project_slug ?? globalSlug) === globalSlug && r.status === "active"),
    [rules]
  );

  const pendingGlobalRules = useMemo(
    () => rules.filter((r) => (r.storage_project_slug ?? globalSlug) === globalSlug && r.status === "pending"),
    [rules]
  );

  const loadPreview = async () => {
    setContextPreview(null);
    const res = await fetch(
      `/api/learning?project=${encodeURIComponent(previewProjectSlug)}&section=context`
    );
    if (res.ok) setContextPreview(await res.json());
  };

  return (
    <div>
      <div className="page-header">
        <h2>Global Learning</h2>
        <p>
          CAF-wide rules and evidence stored in <code>caf-global</code>. Use this to set defaults that all projects
          inherit (and to preview the merged generation context for a project).
        </p>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div className="card" style={{ padding: 14, flex: "1 1 420px" }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Storage</div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 13, color: "var(--fg-secondary)" }}>Project slug</div>
              <div style={{ fontFamily: "monospace" }}>{globalSlug}</div>
            </div>
            <div>
              <div style={{ fontSize: 13, color: "var(--fg-secondary)" }}>Display name</div>
              <div>CAF Global Learning</div>
            </div>
            <div>
              <div style={{ fontSize: 13, color: "var(--fg-secondary)" }}>System project</div>
              <div
                style={{
                  display: "inline-block",
                  fontSize: 12,
                  padding: "2px 8px",
                  borderRadius: 999,
                  border: "1px solid var(--border)",
                  background: "rgba(100, 150, 255, 0.12)",
                }}
              >
                SYSTEM
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 14, flex: "1 1 420px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Preview merged context</div>
              <div style={{ fontSize: 13, color: "var(--fg-secondary)" }}>
                Pick a project slug to see how global + project rules compile into generation guidance.
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                value={previewProjectSlug}
                onChange={(e) => setPreviewProjectSlug(e.target.value.trim())}
                placeholder="SNS"
                style={{
                  width: 140,
                  padding: "6px 8px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--card)",
                  color: "var(--fg)",
                  fontFamily: "monospace",
                  fontSize: 12,
                }}
              />
              <button className="btn-primary" type="button" onClick={loadPreview}>
                Preview
              </button>
            </div>
          </div>
          {contextPreview ? (
            <pre
              style={{
                marginTop: 10,
                fontSize: 11,
                maxHeight: 220,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                background: "var(--card)",
                padding: 8,
                borderRadius: 6,
                border: "1px solid var(--border)",
              }}
            >
              {JSON.stringify(contextPreview, null, 2)}
            </pre>
          ) : null}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <StatCard label="Rules" value={summary?.rules.total ?? "—"} sub={`active ${summary?.rules.active ?? "—"} · pending ${summary?.rules.pending ?? "—"}`} />
        <StatCard label="Observations" value={summary?.evidence.observations ?? "—"} />
        <StatCard label="Insights" value={summary?.evidence.insights ?? "—"} />
        <StatCard label="Hypotheses" value={summary?.evidence.hypotheses ?? "—"} />
        <StatCard label="Trials" value={summary?.evidence.trials ?? "—"} />
        <StatCard label="Attribution" value={summary?.attribution ?? "—"} sub="generation attributions (system-wide)" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ marginBottom: 12 }}>Active global rules ({activeGlobalRules.length})</h3>
            <button className="btn-ghost" type="button" onClick={fetchAll} disabled={loading}>
              Refresh
            </button>
          </div>
          {activeGlobalRules.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No active global rules yet.</p>
          ) : (
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid var(--border)" }}>rule_id</th>
                  <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid var(--border)" }}>action</th>
                  <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid var(--border)" }}>scope</th>
                  <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid var(--border)" }}>evidence</th>
                </tr>
              </thead>
              <tbody>
                {activeGlobalRules.slice(0, 25).map((r) => (
                  <tr key={r.rule_id}>
                    <td style={{ padding: 6, borderBottom: "1px solid var(--border)", fontFamily: "monospace" }}>
                      {r.rule_id.length > 42 ? `${r.rule_id.slice(0, 42)}…` : r.rule_id}
                    </td>
                    <td style={{ padding: 6, borderBottom: "1px solid var(--border)" }}>{r.action_type}</td>
                    <td style={{ padding: 6, borderBottom: "1px solid var(--border)", color: "var(--fg-secondary)" }}>
                      {(r.scope_flow_type ?? "*") + " · " + (r.scope_platform ?? "*")}
                    </td>
                    <td style={{ padding: 6, borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
                      {Array.isArray(r.evidence_refs) ? r.evidence_refs.length : 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Pending global rules ({pendingGlobalRules.length})</h3>
          {pendingGlobalRules.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No pending global rules.</p>
          ) : (
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid var(--border)" }}>rule_id</th>
                  <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid var(--border)" }}>action</th>
                  <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid var(--border)" }}>scope</th>
                </tr>
              </thead>
              <tbody>
                {pendingGlobalRules.slice(0, 25).map((r) => (
                  <tr key={r.rule_id}>
                    <td style={{ padding: 6, borderBottom: "1px solid var(--border)", fontFamily: "monospace" }}>
                      {r.rule_id.length > 42 ? `${r.rule_id.slice(0, 42)}…` : r.rule_id}
                    </td>
                    <td style={{ padding: 6, borderBottom: "1px solid var(--border)" }}>{r.action_type}</td>
                    <td style={{ padding: 6, borderBottom: "1px solid var(--border)", color: "var(--fg-secondary)" }}>
                      {(r.scope_flow_type ?? "*") + " · " + (r.scope_platform ?? "*")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 10 }}>Recent global observations ({observations.length})</h3>
        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
          Up to 200 rows from <code>caf_core.learning_observations</code> for <code>caf-global</code>. Use per-project
          Learning for filters and full JSON.
        </p>
        {observations.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No observations yet.</p>
        ) : (
          <div style={{ maxHeight: 400, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: "var(--card)", zIndex: 1 }}>
                <tr>
                  <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid var(--border)" }}>When</th>
                  <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid var(--border)" }}>Type</th>
                  <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid var(--border)" }}>Source</th>
                </tr>
              </thead>
              <tbody>
                {observations.map((o, i) => (
                  <tr key={String(o.observation_id ?? `gobs-${i}`)}>
                    <td style={{ padding: 6, borderBottom: "1px solid var(--border)", color: "var(--muted)", whiteSpace: "nowrap" }}>
                      {String(o.observed_at ?? "").slice(0, 19).replace("T", " ")}
                    </td>
                    <td style={{ padding: 6, borderBottom: "1px solid var(--border)", fontFamily: "monospace", fontSize: 11 }}>
                      {String(o.observation_type)}
                    </td>
                    <td style={{ padding: 6, borderBottom: "1px solid var(--border)" }}>{String(o.source_type)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {loading ? <div style={{ marginTop: 14, color: "var(--muted)" }}>Loading…</div> : null}
    </div>
  );
}

