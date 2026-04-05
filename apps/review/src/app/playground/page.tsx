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
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card px-4 py-3 sm:px-6 sm:py-4">
        <h1 className="text-lg font-semibold text-card-foreground sm:text-xl">Template Playground</h1>
        <p className="text-xs text-muted-foreground sm:text-sm">Preview carousel templates with live data</p>
      </header>
      <main className="grid gap-4 p-4 sm:gap-6 sm:p-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-muted-foreground">Template</label>
            <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={selectedTemplate} onChange={(e) => setSelectedTemplate(e.target.value)}>
              {templates.length === 0 && <option value="">Loading…</option>}
              {templates.map((t) => (<option key={t} value={t}>{t}</option>))}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-muted-foreground">Slide data (JSON)</label>
            <textarea className="h-64 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm" value={jsonInput} onChange={(e) => setJsonInput(e.target.value)} spellCheck={false} />
          </div>
          <button type="button" onClick={runPreview} disabled={loading || !selectedTemplate} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {loading ? "Rendering…" : "Preview all slides"}
          </button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">Preview</h2>
          {previewUrls.length > 0 ? (
            <div className="space-y-4 rounded-lg border bg-card p-4">
              <p className="text-xs text-muted-foreground">{previewUrls.length} slide(s)</p>
              <div className="flex flex-col gap-4 overflow-auto max-h-[70vh]">
                {previewUrls.map((url, i) => (<img key={i} src={url} alt={`Slide ${i + 1}`} className="max-h-[500px] w-auto rounded border object-contain" />))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Click &quot;Preview all slides&quot; to render.</p>
          )}
        </div>
      </main>
    </div>
  );
}
