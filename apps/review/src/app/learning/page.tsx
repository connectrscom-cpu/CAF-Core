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
}

export default function LearningPage() {
  const [rules, setRules] = useState<LearningRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [analysisResult, setAnalysisResult] = useState<Record<string, unknown> | null>(null);
  const [running, setRunning] = useState(false);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/learning?project=SNS");
      if (res.ok) {
        const json = await res.json();
        setRules(json.rules ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const runAnalysis = async (action: "editorial" | "market") => {
    setRunning(true);
    setAnalysisResult(null);
    try {
      const res = await fetch("/api/learning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, project: "SNS" }),
      });
      if (res.ok) {
        const json = await res.json();
        setAnalysisResult(json);
        fetchRules();
      }
    } finally {
      setRunning(false);
    }
  };

  const active = rules.filter((r) => r.status === "active");
  const pending = rules.filter((r) => r.status === "pending");

  return (
    <div>
      <div className="page-header">
        <h2>Learning Layer</h2>
        <p>Editorial analysis (Loop B), market performance analysis (Loop C), and learning rules.</p>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <button className="btn-primary" onClick={() => runAnalysis("editorial")} disabled={running}>
          {running ? "Running..." : "Run Editorial Analysis"}
        </button>
        <button className="btn-primary" onClick={() => runAnalysis("market")} disabled={running}>
          {running ? "Running..." : "Run Market Analysis"}
        </button>
      </div>

      {analysisResult && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3>Analysis Result</h3>
          <pre style={{ fontSize: 12, maxHeight: 300, overflow: "auto", whiteSpace: "pre-wrap" }}>
            {JSON.stringify(analysisResult, null, 2)}
          </pre>
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
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }}>Rule ID</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }}>Trigger</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }}>Action</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }}>Scope</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }}>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {active.map((rule) => (
                  <tr key={rule.rule_id}>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)", fontSize: 11, fontFamily: "monospace" }}>{rule.rule_id.slice(0, 30)}...</td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>{rule.trigger_type}</td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>{rule.action_type}</td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>{rule.scope_flow_type ?? rule.scope_platform ?? "global"}</td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>{rule.confidence != null ? (rule.confidence * 100).toFixed(0) + "%" : "—"}</td>
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
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }}>Rule ID</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }}>Trigger</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }}>Action</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }}>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((rule) => (
                  <tr key={rule.rule_id}>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)", fontSize: 11, fontFamily: "monospace" }}>{rule.rule_id.slice(0, 30)}...</td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>{rule.trigger_type}</td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>{rule.action_type}</td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>{rule.confidence != null ? (rule.confidence * 100).toFixed(0) + "%" : "—"}</td>
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
