"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MimicImageAudit, MimicModeOverrideValue } from "@/lib/caf-core-client";

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pretty(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function pickCarouselTemplateName(generationPayload: Record<string, unknown>): string {
  const gp = generationPayload ?? {};
  const go = asRec(gp.generated_output);
  const goRender = go ? asRec(go.render) : null;
  const gpRender = asRec(gp.render);
  const v =
    goRender?.html_template_name ??
    goRender?.template_key ??
    gpRender?.html_template_name ??
    gpRender?.template_key ??
    gp.template;
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.replace(/\.hbs$/i, "") : "";
}

function auditForSlide(audits: MimicImageAudit[], slideIndex: number): MimicImageAudit | null {
  const genStep = `mimic_slide_gen_${slideIndex}`;
  const bgStep = slideIndex === 1 ? "mimic_bg_extract" : `mimic_bg_extract_${slideIndex}`;
  return (
    audits.find((a) => a.step === genStep) ??
    audits.find((a) => a.step === bgStep) ??
    null
  );
}

export interface MimicCarouselInspectPanelProps {
  job: Record<string, unknown> | null;
  taskId: string;
  projectSlug: string;
  slideCount: number;
  activeSlideIndex?: number;
  buildInspectPayload?: () => Record<string, unknown>;
  template?: string;
  instagramHandle?: string;
  getBackgroundUrl?: (slideIndex1Based: number) => string | undefined;
}

export function MimicCarouselInspectPanel({
  job,
  taskId,
  projectSlug,
  slideCount,
  activeSlideIndex = 1,
  buildInspectPayload,
  template = "",
  instagramHandle = "",
  getBackgroundUrl,
}: MimicCarouselInspectPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [selectedSlide, setSelectedSlide] = useState(activeSlideIndex);
  const [audits, setAudits] = useState<MimicImageAudit[]>([]);
  const [auditsLoading, setAuditsLoading] = useState(false);
  const [auditsError, setAuditsError] = useState<string | null>(null);
  const [renderInspect, setRenderInspect] = useState<Record<string, unknown> | null>(null);
  const [renderInspectLoading, setRenderInspectLoading] = useState(false);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [modeOverrideSaving, setModeOverrideSaving] = useState(false);
  const [modeOverrideError, setModeOverrideError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedSlide(activeSlideIndex);
  }, [activeSlideIndex]);

  const gp = useMemo(() => asRec(job?.generation_payload) ?? {}, [job]);
  const mimicV1 = useMemo(() => asRec(gp.mimic_v1), [gp]);
  const draftPackage = useMemo(() => {
    const snap = asRec(gp.draft_package_snapshot);
    if (snap?.package_type === "mimic_carousel_package") return snap;
    const go = asRec(gp.generated_output);
    if (go?.package_type === "mimic_carousel_package") return go;
    return snap;
  }, [gp]);
  const renderPlan = useMemo(() => asRec(draftPackage?.render_plan) ?? asRec(mimicV1), [draftPackage, mimicV1]);
  const templateUsed = useMemo(() => template || pickCarouselTemplateName(gp), [template, gp]);
  const renderManifest = useMemo(() => asRec(gp.render_manifest), [gp]);

  const currentModeOverride = useMemo((): MimicModeOverrideValue => {
    const v = mimicV1?.mode_override;
    if (v === "carousel_visual" || v === "template_bg") return v;
    return null;
  }, [mimicV1]);

  const handleModeOverride = useCallback(async (newMode: MimicModeOverrideValue) => {
    setModeOverrideSaving(true);
    setModeOverrideError(null);
    try {
      const res = await fetch("/api/task/mimic-mode-override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: taskId, mode_override: newMode, project: projectSlug }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as Record<string, unknown>).error as string ?? `HTTP ${res.status}`);
      }
      // Reload page to reflect new state
      window.location.reload();
    } catch (e) {
      setModeOverrideError(e instanceof Error ? e.message : "Failed to update mode");
    } finally {
      setModeOverrideSaving(false);
    }
  }, [taskId, projectSlug]);

  const slidePlans = useMemo(() => {
    const raw = renderPlan?.slide_plans ?? mimicV1?.slide_plans;
    if (!Array.isArray(raw)) return [];
    return raw.map((p) => asRec(p)).filter(Boolean) as Record<string, unknown>[];
  }, [renderPlan, mimicV1]);

  const fetchAudits = useCallback(async () => {
    if (!taskId.trim()) return;
    setAuditsLoading(true);
    setAuditsError(null);
    try {
      const qs = new URLSearchParams({ task_id: taskId });
      if (projectSlug.trim()) qs.set("project", projectSlug.trim());
      const res = await fetch(`/api/task/mimic-image-audits?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { audits?: MimicImageAudit[] };
      setAudits(json.audits ?? []);
    } catch (e) {
      setAuditsError(e instanceof Error ? e.message : "Failed to load Qwen audits");
      setAudits([]);
    } finally {
      setAuditsLoading(false);
    }
  }, [taskId, projectSlug]);

  useEffect(() => {
    fetchAudits();
  }, [fetchAudits]);

  useEffect(() => {
    if (!buildInspectPayload || !templateUsed || slideCount < 1) {
      setRenderInspect(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setRenderInspectLoading(true);
      try {
        const payload = buildInspectPayload();
        const bg = getBackgroundUrl?.(selectedSlide);
        const res = await fetch("/api/renderer/inspect-slide-context", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            template: templateUsed,
            slide_index: selectedSlide,
            payload,
            instagram_handle: instagramHandle,
            ...(bg ? { background_image_url: bg } : {}),
          }),
        });
        const json = (await res.json()) as Record<string, unknown>;
        if (cancelled) return;
        setRenderInspect(json.ok ? json : { error: json.error ?? "inspect failed" });
      } catch (e) {
        if (!cancelled) setRenderInspect({ error: e instanceof Error ? e.message : "inspect failed" });
      } finally {
        if (!cancelled) setRenderInspectLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [buildInspectPayload, templateUsed, selectedSlide, slideCount, instagramHandle, getBackgroundUrl]);

  const selectedAudit = useMemo(() => auditForSlide(audits, selectedSlide), [audits, selectedSlide]);

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyHint(label);
      window.setTimeout(() => setCopyHint(null), 2200);
    } catch {
      setCopyHint("Copy failed");
      window.setTimeout(() => setCopyHint(null), 2200);
    }
  }

  if (!job) return null;

  const mode = String(renderPlan?.mode ?? mimicV1?.mode ?? "—");
  const strategy = String(renderPlan?.strategy ?? "—");

  return (
    <div className="card mt-4 surface-amber">
      <div
        className="card-header"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
      >
        <span>Mimic carousel inspect</span>
        <button type="button" className="btn-ghost" onClick={() => setExpanded((v) => !v)} style={{ fontSize: 12 }}>
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>

      <p style={{ margin: "8px 0 12px", fontSize: 12, color: "var(--fg-secondary)", lineHeight: 1.5 }}>
        Inspect the <span className="font-mono">mimic_carousel_package</span>, per-slide Handlebars render context, and
        the exact Qwen prompt stored in <span className="font-mono">api_call_audit</span> at render time.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12, fontSize: 12 }}>
        <span className="badge">mode: {mode}</span>
        <span className="badge">strategy: {strategy}</span>
        {templateUsed ? <span className="badge">template: {templateUsed}</span> : null}
        {renderManifest?.render_type ? (
          <span className="badge">render: {String(renderManifest.render_type)}</span>
        ) : null}
      </div>

      {/* Mode override picker */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "8px 12px", background: "var(--surface-raised, rgba(0,0,0,0.04))", borderRadius: 6 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-secondary)", whiteSpace: "nowrap" }}>
          Render path:
        </label>
        <button
          type="button"
          disabled={modeOverrideSaving}
          onClick={() => handleModeOverride("carousel_visual")}
          className={mode === "carousel_visual" ? "btn-primary" : "btn-ghost"}
          style={{ fontSize: 12, padding: "4px 10px" }}
        >
          Full bleed (visual)
        </button>
        <button
          type="button"
          disabled={modeOverrideSaving}
          onClick={() => handleModeOverride("template_bg")}
          className={mode === "template_bg" ? "btn-primary" : "btn-ghost"}
          style={{ fontSize: 12, padding: "4px 10px" }}
        >
          Template bg (listicle)
        </button>
        {currentModeOverride ? (
          <button
            type="button"
            disabled={modeOverrideSaving}
            onClick={() => handleModeOverride(null)}
            className="btn-ghost"
            style={{ fontSize: 11, padding: "3px 8px", color: "var(--muted)" }}
          >
            Reset to auto
          </button>
        ) : null}
        {currentModeOverride ? (
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            (override: {currentModeOverride})
          </span>
        ) : (
          <span style={{ fontSize: 11, color: "var(--muted)" }}>(auto-classified)</span>
        )}
        {modeOverrideSaving ? <span style={{ fontSize: 11, color: "var(--muted)" }}>Saving…</span> : null}
        {modeOverrideError ? <span style={{ fontSize: 11, color: "var(--red)" }}>{modeOverrideError}</span> : null}
      </div>

      {expanded ? (
        <>
          <details open style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--fg-secondary)" }}>
              mimic_carousel_package
            </summary>
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn-ghost"
                style={{ fontSize: 12 }}
                disabled={!draftPackage}
                onClick={() => draftPackage && copyText("Package copied", pretty(draftPackage))}
              >
                Copy package JSON
              </button>
            </div>
            <pre className="slides-json" style={{ marginTop: 8, maxHeight: 360 }}>
              {pretty(draftPackage ?? { note: "draft_package_snapshot missing on this job" })}
            </pre>
          </details>

          <details open style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--fg-secondary)" }}>
              mimic_v1 (render authority)
            </summary>
            <pre className="slides-json" style={{ marginTop: 8, maxHeight: 280 }}>
              {pretty(mimicV1 ?? { note: "mimic_v1 missing — re-run Generate Jobs after mimic prep" })}
            </pre>
          </details>

          {slidePlans.length > 0 ? (
            <details open style={{ marginTop: 10 }}>
              <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--fg-secondary)" }}>
                Slide render plans
              </summary>
              <table style={{ width: "100%", marginTop: 8, fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                    <th style={{ padding: "4px 8px 4px 0" }}>Slide</th>
                    <th style={{ padding: "4px 8px" }}>render_mode</th>
                    <th style={{ padding: "4px 8px" }}>ref index</th>
                  </tr>
                </thead>
                <tbody>
                  {slidePlans.map((plan) => (
                    <tr key={String(plan.slide_index)}>
                      <td style={{ padding: "4px 8px 4px 0" }}>{String(plan.slide_index ?? "—")}</td>
                      <td style={{ padding: "4px 8px" }} className="font-mono">
                        {String(plan.render_mode ?? (mode === "template_bg" ? "hbs" : "full_bleed"))}
                      </td>
                      <td style={{ padding: "4px 8px" }}>{String(plan.reference_index ?? "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}

          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <label style={{ fontSize: 12, color: "var(--fg-secondary)" }}>
                Inspect slide{" "}
                <select
                  value={selectedSlide}
                  onChange={(e) => setSelectedSlide(Math.max(1, Number(e.target.value) || 1))}
                  style={{ marginLeft: 4 }}
                >
                  {Array.from({ length: Math.max(slideCount, 1) }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn-ghost" style={{ fontSize: 12 }} onClick={() => fetchAudits()}>
                Refresh Qwen audits
              </button>
              {copyHint ? <span style={{ fontSize: 11, color: "var(--muted)" }}>{copyHint}</span> : null}
            </div>

            <details open>
              <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--fg-secondary)" }}>
                Qwen prompt (api_call_audit)
              </summary>
              {auditsLoading ? (
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>Loading audits…</p>
              ) : auditsError ? (
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--red)" }}>{auditsError}</p>
              ) : selectedAudit ? (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6, lineHeight: 1.5 }}>
                    step <span className="font-mono">{selectedAudit.step}</span>
                    {" · "}
                    {selectedAudit.provider}/{selectedAudit.model ?? "?"}
                    {selectedAudit.latency_ms != null ? ` · ${selectedAudit.latency_ms}ms` : ""}
                    {!selectedAudit.ok ? " · FAILED" : ""}
                  </div>
                  {selectedAudit.error_message ? (
                    <p style={{ fontSize: 12, color: "var(--red)", margin: "0 0 8px" }}>{selectedAudit.error_message}</p>
                  ) : null}
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: 12, marginBottom: 8 }}
                    disabled={!selectedAudit.prompt}
                    onClick={() => selectedAudit.prompt && copyText("Qwen prompt copied", selectedAudit.prompt)}
                  >
                    Copy prompt
                  </button>
                  <pre className="slides-json" style={{ maxHeight: 220, whiteSpace: "pre-wrap" }}>
                    {selectedAudit.prompt ?? "(no prompt stored on audit row)"}
                  </pre>
                  {selectedAudit.reference_url ? (
                    <>
                      <p style={{ fontSize: 11, color: "var(--muted)", margin: "8px 0 4px" }}>Reference image URL</p>
                      <pre className="slides-json" style={{ maxHeight: 80, fontSize: 11, wordBreak: "break-all" }}>
                        {selectedAudit.reference_url}
                      </pre>
                    </>
                  ) : null}
                </div>
              ) : (
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>
                  No Qwen audit for slide {selectedSlide} yet. Re-render the job, or inspect the expected prompt below
                  (reconstructed from current copy).
                </p>
              )}

              {audits.length > 0 ? (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--muted)" }}>
                    All mimic image audits ({audits.length})
                  </summary>
                  <pre className="slides-json" style={{ marginTop: 8, maxHeight: 240 }}>
                    {pretty(audits)}
                  </pre>
                </details>
              ) : null}
            </details>

            <details open style={{ marginTop: 10 }}>
              <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--fg-secondary)" }}>
                Render package (Handlebars context)
              </summary>
              {renderInspectLoading ? (
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>Building render context…</p>
              ) : renderInspect ? (
                <div style={{ marginTop: 8 }}>
                  {renderInspect.mimic_render_mode ? (
                    <p style={{ fontSize: 12, color: "var(--fg-secondary)", margin: "0 0 8px" }}>
                      mimic_render_mode:{" "}
                      <span className="font-mono">{String(renderInspect.mimic_render_mode)}</span>
                      {renderInspect.background_image_url ? <> · bg plate set</> : null}
                    </p>
                  ) : null}
                  {typeof renderInspect.expected_qwen_prompt === "string" && renderInspect.expected_qwen_prompt ? (
                    <>
                      <p style={{ fontSize: 11, color: "var(--muted)", margin: "0 0 4px" }}>
                        Expected Qwen prompt (from current copy — matches what a re-render would send)
                      </p>
                      <button
                        type="button"
                        className="btn-ghost"
                        style={{ fontSize: 12, marginBottom: 8 }}
                        onClick={() =>
                          copyText("Expected Qwen prompt copied", String(renderInspect.expected_qwen_prompt))
                        }
                      >
                        Copy expected prompt
                      </button>
                      <pre className="slides-json" style={{ maxHeight: 180, whiteSpace: "pre-wrap", marginBottom: 10 }}>
                        {String(renderInspect.expected_qwen_prompt)}
                      </pre>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: 12, marginBottom: 8 }}
                    onClick={() => copyText("Render context copied", pretty(renderInspect.render_context))}
                  >
                    Copy render context JSON
                  </button>
                  <pre className="slides-json" style={{ maxHeight: 360 }}>
                    {pretty(renderInspect.render_context ?? renderInspect.error ?? renderInspect)}
                  </pre>
                </div>
              ) : (
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>
                  Select a slide to inspect the Handlebars context Core sends to the renderer.
                </p>
              )}
            </details>
          </div>
        </>
      ) : null}
    </div>
  );
}
