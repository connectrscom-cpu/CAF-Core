"use client";

import { useCallback, useEffect, useState } from "react";

export default function PlaygroundPage() {
  const [templates, setTemplates] = useState<string[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [jsonInput, setJsonInput] = useState('{\n  "cover": "5 hooks to fix your landing page",\n  "body_slides": [\n    { "headline": "1. Make it about them", "body": "Replace we/our with you/your." }\n  ],\n  "cta_text": "Save this playbook",\n  "cta_handle": "@yourbrand"\n}');
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/renderer/templates")
      .then((r) => r.json())
      .then((data: { templates?: string[] }) => {
        if (data.templates?.length) {
          setTemplates(data.templates);
          if (!selectedTemplate) setSelectedTemplate(data.templates[0]);
        }
      })
      .catch(() => {});
  }, []);

  const runPreview = useCallback(async () => {
    if (!selectedTemplate) return;
    setLoading(true);
    setError(null);
    setPreviewUrls([]);
    try {
      let data: unknown;
      try { data = JSON.parse(jsonInput); } catch { setError("Invalid JSON"); return; }
      const res = await fetch("/api/renderer/preview-carousel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: selectedTemplate, data }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; urls?: string[] };
      if (!res.ok) { setError(json.error || res.statusText); return; }
      if (json.ok && Array.isArray(json.urls)) setPreviewUrls(json.urls);
      else setError(json.error || "No slides returned");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setLoading(false);
    }
  }, [selectedTemplate, jsonInput]);

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Template Playground</h2>
          <span className="page-header-sub">Preview carousel templates with live data</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, padding: "20px 28px 28px" }}>
        <div>
          <div style={{ marginBottom: 14 }}>
            <label className="filter-label">Template</label>
            <select className="filter-select" value={selectedTemplate} onChange={(e) => setSelectedTemplate(e.target.value)}>
              {templates.length === 0 && <option value="">Loading…</option>}
              {templates.map((t) => (<option key={t} value={t}>{t}</option>))}
            </select>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label className="filter-label">Slide data (JSON)</label>
            <textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              spellCheck={false}
              style={{ height: 256, fontFamily: "'SF Mono', 'Fira Code', monospace" }}
            />
          </div>
          <button type="button" className="btn-primary" onClick={runPreview} disabled={loading || !selectedTemplate}>
            {loading ? "Rendering…" : "Preview all slides"}
          </button>
          {error && <p style={{ fontSize: 13, color: "var(--red)", marginTop: 8 }}>{error}</p>}
        </div>
        <div>
          <p style={{ fontSize: 13, fontWeight: 500, color: "var(--muted)", marginBottom: 12 }}>Preview</p>
          {previewUrls.length > 0 ? (
            <div className="card">
              <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{previewUrls.length} slide(s)</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: "70vh", overflowY: "auto" }}>
                {previewUrls.map((url, i) => (
                  <img key={i} src={url} alt={`Slide ${i + 1}`} style={{ maxHeight: 500, width: "auto", borderRadius: 6, border: "1px solid var(--border)", objectFit: "contain" }} />
                ))}
              </div>
            </div>
          ) : (
            <p style={{ fontSize: 13, color: "var(--muted)" }}>Click &quot;Preview all slides&quot; to render.</p>
          )}
        </div>
      </div>
    </>
  );
}
