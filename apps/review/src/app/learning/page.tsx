"use client";

import { useEffect, useState, useCallback } from "react";

interface LearningRule {
  rule_id: string;
  trigger_type: string;
  scope_flow_type: string | null;
  scope_platform: string | null;
  action_type: string;
  action_payload: Record<string, unknown>;
  confidence: number | null;
  status: string;
  applied_at: string | null;
  created_at: string;
  scope_type?: string;
  rule_family?: string;
  storage_project_slug?: string;
}

export default function LearningPage() {
  const [project, setProject] = useState("SNS");
  const [rules, setRules] = useState<LearningRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [analysisResult, setAnalysisResult] = useState<Record<string, unknown> | null>(null);
  const [running, setRunning] = useState(false);
  const [csvStatus, setCsvStatus] = useState<string | null>(null);
  const [mappingJson, setMappingJson] = useState("");
  const [contextPreview, setContextPreview] = useState<Record<string, unknown> | null>(null);
  const [observations, setObservations] = useState<Record<string, unknown>[]>([]);
  const [transparency, setTransparency] = useState<Record<string, unknown> | null>(null);

  const fetchTransparency = useCallback(async () => {
    const res = await fetch(`/api/learning?project=${encodeURIComponent(project)}&section=transparency`);
    if (res.ok) setTransparency(await res.json());
    else setTransparency(null);
  }, [project]);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/learning?project=${encodeURIComponent(project)}`);
      if (res.ok) {
        const json = await res.json();
        setRules(json.rules ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [project]);

  const fetchObservations = useCallback(async () => {
    const res = await fetch(`/api/learning?project=${encodeURIComponent(project)}&section=observations&limit=50`);
    if (res.ok) {
      const json = await res.json();
      setObservations(json.observations ?? []);
    }
  }, [project]);

  useEffect(() => {
    fetchRules();
    fetchObservations();
    fetchTransparency();
  }, [fetchRules, fetchObservations, fetchTransparency]);

  const runAnalysis = async (action: "editorial" | "market") => {
    setRunning(true);
    setAnalysisResult(null);
    try {
      const res = await fetch("/api/learning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, project }),
      });
      if (res.ok) {
        const json = await res.json();
        setAnalysisResult(json);
        fetchRules();
        fetchObservations();
      }
    } finally {
      setRunning(false);
    }
  };

  const loadContextPreview = async () => {
    const res = await fetch(`/api/learning?project=${encodeURIComponent(project)}&section=context`);
    if (res.ok) setContextPreview(await res.json());
  };

  const applyRule = async (rule: LearningRule) => {
    const slug = rule.storage_project_slug ?? project;
    const res = await fetch("/api/learning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply_rule", storage_project: slug, rule_id: rule.rule_id }),
    });
    if (res.ok) fetchRules();
  };

  const retireRule = async (rule: LearningRule) => {
    const slug = rule.storage_project_slug ?? project;
    const res = await fetch("/api/learning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retire_rule", storage_project: slug, rule_id: rule.rule_id }),
    });
    if (res.ok) fetchRules();
  };

  const uploadCsv = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCsvStatus(null);
    const form = e.currentTarget;
    const input = form.querySelector<HTMLInputElement>('input[type="file"]');
    const file = input?.files?.[0];
    if (!file) {
      setCsvStatus("Choose a CSV file.");
      return;
    }
    const fd = new FormData();
    fd.append("project", project);
    fd.append("file", file);
    if (mappingJson.trim()) fd.append("mapping", mappingJson.trim());
    try {
      const res = await fetch("/api/learning", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setCsvStatus(
          `Ingested ${json.ingested ?? 0} rows (${json.skipped ?? 0} skipped). Batch ${json.batch_id ?? "—"}`
        );
        fetchObservations();
        fetchRules();
      } else {
        setCsvStatus(json.error ?? `Upload failed (${res.status})`);
      }
    } catch (err) {
      setCsvStatus(err instanceof Error ? err.message : "Upload failed");
    }
    form.reset();
  };

  const active = rules.filter((r) => r.status === "active");
  const pending = rules.filter((r) => r.status === "pending");

  return (
    <div>
      <div className="page-header">
        <h2>Learning Layer</h2>
        <p>
          Evidence-backed rules, editorial and market analyzers, social CSV ingest, and compiled generation context.
        </p>
      </div>

      {transparency && (
        <div className="card" style={{ marginBottom: 20, borderLeft: "4px solid var(--accent)" }}>
          <h3 style={{ marginBottom: 8 }}>Transparency — automation and LLM role</h3>
          <p style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 14, color: "var(--fg-secondary)" }}>
            {String(transparency.summary ?? "")}
          </p>
          {transparency.snapshot && typeof transparency.snapshot === "object" && (
            <div
              style={{
                display: "flex",
                gap: 16,
                flexWrap: "wrap",
                fontSize: 13,
                marginBottom: 16,
                padding: "10px 12px",
                background: "var(--card)",
                borderRadius: 8,
                border: "1px solid var(--border)",
              }}
            >
              {Object.entries(transparency.snapshot as Record<string, unknown>).map(([k, v]) => (
                <div key={k}>
                  <span style={{ color: "var(--muted)" }}>{k.replace(/_/g, " ")}</span>{" "}
                  <strong>
                    {v === -1 && k === "observations_last_30d" ? "n/a (run DB migrations)" : String(v)}
                  </strong>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 13, lineHeight: 1.45 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>How each part runs</div>
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {(Array.isArray(transparency.loops) ? transparency.loops : []).map((loop: unknown) => {
                const L = loop as Record<string, unknown>;
                const llm = Boolean(L.llm_involved);
                return (
                  <li key={String(L.id)} style={{ marginBottom: 12 }}>
                    <strong>{String(L.name ?? L.id)}</strong>{" "}
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: llm ? "rgba(120, 80, 200, 0.2)" : "rgba(80, 120, 80, 0.2)",
                      }}
                    >
                      {llm ? "LLM consumes output" : "No LLM in analyzer"}
                    </span>
                    <div style={{ color: "var(--fg-secondary)", marginTop: 4 }}>{String(L.analyzer ?? "")}</div>
                    <div style={{ color: "var(--muted)", marginTop: 2 }}>
                      Automation: <code>{String(L.automation ?? "")}</code>
                    </div>
                    {L.llm_role ? (
                      <div style={{ marginTop: 4 }}>{String(L.llm_role)}</div>
                    ) : null}
                    <div style={{ marginTop: 4, color: "var(--fg-secondary)" }}>
                      {String(L.requires_human ?? "")}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          {Array.isArray(transparency.not_implemented_yet) && transparency.not_implemented_yet.length > 0 && (
            <div style={{ marginTop: 16, fontSize: 13 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Not automatic in Core today</div>
              <ul style={{ paddingLeft: 18, margin: 0, color: "var(--fg-secondary)" }}>
                {transparency.not_implemented_yet.map((x: unknown) => (
                  <li key={String(x)}>{String(x)}</li>
                ))}
              </ul>
            </div>
          )}
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 14, marginBottom: 0 }}>
            API: <code>GET /v1/learning/&lt;slug&gt;/transparency</code> — same data for tools and dashboards.
          </p>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 8, fontSize: 13 }}>
          Project slug
          <input
            style={{ marginLeft: 8, width: 120, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)" }}
            value={project}
            onChange={(e) => setProject(e.target.value.trim())}
          />
        </label>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <button className="btn-primary" onClick={() => runAnalysis("editorial")} disabled={running}>
          {running ? "Running..." : "Run Editorial Analysis"}
        </button>
        <button className="btn-primary" onClick={() => runAnalysis("market")} disabled={running}>
          {running ? "Running..." : "Run Market Analysis"}
        </button>
        <button type="button" className="btn-primary" onClick={loadContextPreview}>
          Preview compiled context
        </button>
      </div>

      <form className="card" style={{ marginBottom: 20 }} onSubmit={uploadCsv}>
        <h3 style={{ marginBottom: 8 }}>Upload social performance CSV</h3>
        <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
          Map platform export columns if needed (JSON). Defaults recognize{" "}
          <code>platform</code>, <code>posted_at</code>, <code>task_id</code>, metrics.
        </p>
        <input type="file" name="file" accept=".csv,text/csv" style={{ marginBottom: 8 }} />
        <textarea
          placeholder='Optional mapping JSON, e.g. {"platform":"Channel","posted_at":"Date","likes":"Likes"}'
          value={mappingJson}
          onChange={(e) => setMappingJson(e.target.value)}
          rows={2}
          style={{ width: "100%", marginBottom: 8, fontFamily: "monospace", fontSize: 12 }}
        />
        <button type="submit" className="btn-primary">
          Upload &amp; ingest
        </button>
        {csvStatus && <p style={{ marginTop: 8, fontSize: 13 }}>{csvStatus}</p>}
      </form>

      {contextPreview && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3>Compiled context preview</h3>
          <pre style={{ fontSize: 12, maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap" }}>
            {JSON.stringify(contextPreview, null, 2)}
          </pre>
        </div>
      )}

      {analysisResult && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3>Analysis Result</h3>
          <pre style={{ fontSize: 12, maxHeight: 300, overflow: "auto", whiteSpace: "pre-wrap" }}>
            {JSON.stringify(analysisResult, null, 2)}
          </pre>
        </div>
      )}

      {observations.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3>Recent observations ({observations.length})</h3>
          <ul style={{ fontSize: 12, maxHeight: 200, overflow: "auto", paddingLeft: 18 }}>
            {observations.slice(0, 15).map((o) => (
              <li key={String(o.observation_id ?? o.id)}>
                <span style={{ fontFamily: "monospace", fontSize: 11 }}>{String(o.observation_type)}</span> —{" "}
                {String(o.source_type)} (
                {String(o.observed_at ?? "").slice(0, 10)})
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Active Rules ({active.length})</h3>
          {active.length === 0 ? (
            <p style={{ color: "#888" }}>No active learning rules yet.</p>
          ) : (
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }}>
                    Rule ID
                  </th>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }}>
                    Action
                  </th>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }}>
                    Family
                  </th>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }} />
                </tr>
              </thead>
              <tbody>
                {active.map((rule) => (
                  <tr key={rule.rule_id}>
                    <td
                      style={{
                        padding: "4px 8px",
                        borderBottom: "1px solid var(--border)",
                        fontSize: 11,
                        fontFamily: "monospace",
                      }}
                    >
                      {rule.rule_id.length > 36 ? `${rule.rule_id.slice(0, 36)}…` : rule.rule_id}
                    </td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>
                      {rule.action_type}
                    </td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>
                      {rule.rule_family ?? "—"}
                    </td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>
                      <button type="button" className="btn-ghost" onClick={() => retireRule(rule)}>
                        Retire
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Pending Rules ({pending.length})</h3>
          {pending.length === 0 ? (
            <p style={{ color: "#888" }}>No pending rules.</p>
          ) : (
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }}>
                    Rule ID
                  </th>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }}>
                    Action
                  </th>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }} />
                </tr>
              </thead>
              <tbody>
                {pending.map((rule) => (
                  <tr key={rule.rule_id}>
                    <td
                      style={{
                        padding: "4px 8px",
                        borderBottom: "1px solid var(--border)",
                        fontSize: 11,
                        fontFamily: "monospace",
                      }}
                    >
                      {rule.rule_id.length > 36 ? `${rule.rule_id.slice(0, 36)}…` : rule.rule_id}
                    </td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>
                      {rule.action_type}
                    </td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>
                      <button type="button" className="btn-primary" onClick={() => applyRule(rule)}>
                        Apply
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {loading && <div style={{ marginTop: 16, textAlign: "center", color: "#888" }}>Loading rules...</div>}
    </div>
  );
}
