"use client";

import { useEffect, useState, useCallback } from "react";

type FeTab = "flows" | "prompts" | "schemas" | "carousels" | "qc_checks" | "risk_policies";

const TABS: { id: FeTab; label: string }[] = [
  { id: "flows", label: "Flow Definitions" },
  { id: "prompts", label: "Prompt Templates" },
  { id: "schemas", label: "Output Schemas" },
  { id: "carousels", label: "Carousel Templates" },
  { id: "qc_checks", label: "QC Checklists" },
  { id: "risk_policies", label: "Risk Policies" },
];

const FLOW_COLUMNS = [
  "flow_type", "category", "description", "supported_platforms",
  "output_asset_types", "default_variation_count",
];

const PROMPT_COLUMNS = [
  "prompt_name", "flow_type", "prompt_role",
  "output_schema_name", "temperature_default", "max_tokens_default",
];

const SCHEMA_COLUMNS = [
  "output_schema_name", "output_schema_version", "flow_type",
  "required_keys", "parsing_notes",
];

const CAROUSEL_COLUMNS = [
  "template_key", "platform", "engine", "html_template_name", "adapter_key",
];

const QC_COLUMNS = [
  "qc_checklist_name", "flow_type", "check_id", "check_name",
  "check_type", "severity", "blocking",
];

const RISK_COLUMNS = [
  "risk_policy_name", "risk_category", "detection_method",
  "severity_level", "default_action", "requires_manual_review", "block_publish",
];

function getColumnsForTab(tab: FeTab): string[] {
  switch (tab) {
    case "flows": return FLOW_COLUMNS;
    case "prompts": return PROMPT_COLUMNS;
    case "schemas": return SCHEMA_COLUMNS;
    case "carousels": return CAROUSEL_COLUMNS;
    case "qc_checks": return QC_COLUMNS;
    case "risk_policies": return RISK_COLUMNS;
    default: return [];
  }
}

export default function FlowEnginePage() {
  const [activeTab, setActiveTab] = useState<FeTab>("flows");
  const [data, setData] = useState<Record<string, Record<string, unknown>[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  const [filterFlowType, setFilterFlowType] = useState<string>("");
  const [editRow, setEditRow] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string>("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/flow-engine");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const items = data[activeTab] ?? [];
  const columns = getColumnsForTab(activeTab);

  const allFlowTypes = Array.from(
    new Set(
      (data.flows ?? []).map((f) => String(f.flow_type ?? "")).filter(Boolean)
    )
  ).sort();

  const filteredItems = filterFlowType
    ? items.filter((item) => {
        const ft = String(item.flow_type ?? "");
        return ft === filterFlowType;
      })
    : items;

  return (
    <div>
      <div className="page-header">
        <h2>Flow Engine</h2>
        <p>CAF-level flow definitions, prompt templates, output schemas, carousel templates, QC checklists, and risk policies.</p>
      </div>

      <div className="tabs" style={{ marginBottom: 16 }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => { setActiveTab(tab.id); setSelectedRow(null); setFilterFlowType(""); }}
          >
            {tab.label}
            {data[tab.id] ? <span className="tab-count">{data[tab.id].length}</span> : null}
          </button>
        ))}
      </div>

      {(activeTab === "prompts" || activeTab === "qc_checks" || activeTab === "schemas") && allFlowTypes.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <label className="filter-label" style={{ marginRight: 8 }}>Filter by flow_type:</label>
          <select className="filter-input" value={filterFlowType} onChange={(e) => setFilterFlowType(e.target.value)} style={{ width: 260 }}>
            <option value="">All</option>
            {allFlowTypes.map((ft) => <option key={ft} value={ft}>{ft}</option>)}
          </select>
        </div>
      )}

      {loading ? (
        <div className="card" style={{ padding: 32, textAlign: "center" }}>Loading...</div>
      ) : (
        <div className="card" style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col} style={{ textAlign: "left", padding: "8px 12px", borderBottom: "2px solid var(--border)", whiteSpace: "nowrap" }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item, idx) => (
                <tr
                  key={idx}
                  style={{ cursor: "pointer", background: selectedRow === item ? "var(--surface-hover, #f0f4ff)" : undefined }}
                  onClick={() => setSelectedRow(selectedRow === item ? null : item)}
                >
                  {columns.map((col) => (
                    <td key={col} style={{ padding: "6px 12px", borderBottom: "1px solid var(--border)", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {renderCell(item[col])}
                    </td>
                  ))}
                </tr>
              ))}
              {filteredItems.length === 0 && (
                <tr><td colSpan={columns.length} style={{ padding: 24, textAlign: "center", color: "#888" }}>No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selectedRow && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h3 style={{ marginBottom: 12 }}>Detail View</h3>
            {activeTab === "prompts" ? (
              <button className="btn-primary" onClick={() => { setEditRow({ ...selectedRow }); setMsg(""); }}>
                Edit
              </button>
            ) : null}
          </div>
          <table style={{ width: "100%", fontSize: 13 }}>
            <tbody>
              {Object.entries(selectedRow).map(([key, value]) => {
                if (key === "id" || key === "created_at" || key === "updated_at") return null;
                return (
                  <tr key={key}>
                    <td style={{ fontWeight: 600, padding: "4px 12px 4px 0", verticalAlign: "top", whiteSpace: "nowrap", width: 200, color: "#666" }}>{key}</td>
                    <td style={{ padding: "4px 0" }}>
                      {typeof value === "object" && value !== null ? (
                        <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, background: "var(--surface)", padding: 8, borderRadius: 4, maxHeight: 300, overflow: "auto" }}>
                          {JSON.stringify(value, null, 2)}
                        </pre>
                      ) : (
                        <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{String(value ?? "")}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editRow && activeTab === "prompts" && (
        <div className="card" style={{ marginTop: 16, padding: 16, border: "1px solid var(--border)" }}>
          <div style={{ fontWeight: 800, marginBottom: 10 }}>Edit prompt template</div>
          {msg ? <div style={{ fontSize: 12, color: msg.startsWith("Saved") ? "var(--green)" : "var(--red)", marginBottom: 10 }}>{msg}</div> : null}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="filter-group">
              <label className="filter-label">prompt_name</label>
              <input className="filter-input" value={String(editRow.prompt_name ?? "")} onChange={(e) => setEditRow({ ...editRow, prompt_name: e.target.value })} />
            </div>
            <div className="filter-group">
              <label className="filter-label">flow_type</label>
              <input className="filter-input" value={String(editRow.flow_type ?? "")} onChange={(e) => setEditRow({ ...editRow, flow_type: e.target.value })} />
            </div>
            <div className="filter-group">
              <label className="filter-label">prompt_role</label>
              <input className="filter-input" value={String(editRow.prompt_role ?? "")} onChange={(e) => setEditRow({ ...editRow, prompt_role: e.target.value })} />
            </div>
            <div className="filter-group" style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 22 }}>
              <input
                type="checkbox"
                checked={editRow.active !== false}
                onChange={(e) => setEditRow({ ...editRow, active: e.target.checked })}
                style={{ width: "auto", accentColor: "var(--accent)" }}
              />
              <span style={{ fontSize: 13 }}>active</span>
            </div>
          </div>

          <div className="filter-group" style={{ marginTop: 12 }}>
            <label className="filter-label">notes</label>
            <textarea className="filter-input" rows={3} value={String(editRow.notes ?? "")} onChange={(e) => setEditRow({ ...editRow, notes: e.target.value })} />
          </div>
          <div className="filter-group" style={{ marginTop: 12 }}>
            <label className="filter-label">system_prompt</label>
            <textarea className="filter-input" rows={6} value={String(editRow.system_prompt ?? "")} onChange={(e) => setEditRow({ ...editRow, system_prompt: e.target.value })} />
          </div>
          <div className="filter-group" style={{ marginTop: 12 }}>
            <label className="filter-label">user_prompt_template</label>
            <textarea className="filter-input" rows={8} value={String(editRow.user_prompt_template ?? "")} onChange={(e) => setEditRow({ ...editRow, user_prompt_template: e.target.value })} />
          </div>
          <div className="filter-group" style={{ marginTop: 12 }}>
            <label className="filter-label">output_format_rule</label>
            <textarea className="filter-input" rows={4} value={String(editRow.output_format_rule ?? "")} onChange={(e) => setEditRow({ ...editRow, output_format_rule: e.target.value })} />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button className="btn-ghost" onClick={() => { setEditRow(null); setMsg(""); }}>Cancel</button>
            <button
              className="btn-primary"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                setMsg("");
                try {
                  const res = await fetch("/api/flow-engine/prompts", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(editRow),
                  });
                  if (!res.ok) throw new Error(await res.text());
                  setMsg("Saved");
                  setEditRow(null);
                  await fetchData();
                } catch (e) {
                  const m = e instanceof Error ? e.message : String(e);
                  setMsg(m || "Failed to save");
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function renderCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value).slice(0, 60) + "...";
  return String(value);
}
