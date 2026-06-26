"use client";

import { useEffect, useState } from "react";

type DossierStage = {
  label: string;
  present: boolean;
  summary: string;
  detail?: Record<string, unknown> | unknown[] | null;
};

function stageSummary(detail: unknown): string {
  if (!detail) return "—";
  if (Array.isArray(detail)) return `${detail.length} row(s)`;
  if (typeof detail === "object") {
    const o = detail as Record<string, unknown>;
    if (Array.isArray(o.assets)) return `${o.assets.length} asset(s)`;
    if (Array.isArray(o.metrics)) return `${o.metrics.length} metric row(s)`;
    if (Array.isArray(o.placements)) return `${o.placements.length} placement(s)`;
    if (o.tracking_status) return String(o.tracking_status);
    if (o.job_status) return String(o.job_status);
  }
  return "present";
}

function buildStages(dossier: Record<string, unknown>): DossierStage[] {
  const upstream = dossier.upstream as Record<string, unknown> | null;
  const planning = dossier.planning as Record<string, unknown> | null;
  const generation = dossier.generation as Record<string, unknown> | null;
  const render = dossier.render as Record<string, unknown> | null;
  const nemotron = dossier.nemotron_output as Record<string, unknown> | null;
  const editorial = dossier.editorial as unknown[] | null;
  const llmReview = dossier.llm_review as unknown[] | null;
  const publish = dossier.publish as Record<string, unknown> | null;
  const performance = dossier.performance as Record<string, unknown> | null;

  return [
    {
      label: "Upstream evidence",
      present: Boolean(upstream),
      summary: upstream?.run_id ? `run ${String(upstream.run_id)}` : stageSummary(upstream),
      detail: upstream,
    },
    {
      label: "Planning",
      present: Boolean(planning),
      summary: planning?.trace_id ? `trace ${String(planning.trace_id).slice(0, 12)}…` : stageSummary(planning),
      detail: planning,
    },
    {
      label: "Generation",
      present: Boolean(generation),
      summary: generation?.job_status ? String(generation.job_status) : stageSummary(generation),
      detail: generation,
    },
    {
      label: "Render",
      present: Boolean(render),
      summary: stageSummary(render),
      detail: render,
    },
    {
      label: "Nemotron output insights",
      present: Boolean(nemotron && Object.keys(nemotron).length > 0),
      summary: nemotron?.format_pattern ? String(nemotron.format_pattern) : stageSummary(nemotron),
      detail: nemotron,
    },
    {
      label: "Editorial",
      present: Array.isArray(editorial) && editorial.length > 0,
      summary: stageSummary(editorial),
      detail: editorial,
    },
    {
      label: "LLM review",
      present: Array.isArray(llmReview) && llmReview.length > 0,
      summary: stageSummary(llmReview),
      detail: llmReview,
    },
    {
      label: "Publish",
      present: Boolean(publish),
      summary: stageSummary(publish?.job_outcome ?? publish),
      detail: publish,
    },
    {
      label: "Performance",
      present: Boolean(performance),
      summary: stageSummary(performance),
      detail: performance,
    },
  ];
}

export function JobJourneyPanel({
  projectSlug,
  taskId,
}: {
  projectSlug: string;
  taskId: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dossier, setDossier] = useState<Record<string, unknown> | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!open || dossier) return;
    setLoading(true);
    setError(null);
    fetch(
      `/api/task/dossier?project=${encodeURIComponent(projectSlug)}&task_id=${encodeURIComponent(taskId)}`
    )
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(json.error ?? `HTTP ${res.status}`));
        return json.dossier as Record<string, unknown>;
      })
      .then((d) => setDossier(d))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open, dossier, projectSlug, taskId]);

  const stages = dossier ? buildStages(dossier) : [];

  return (
    <details
      className="card"
      style={{ marginTop: 12, padding: "10px 12px" }}
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
        Job journey (evidence → publish → performance)
      </summary>
      <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>
        Full traceability dossier from Core — upstream signal, planning, generation, Nemotron review, publish anchor,
        and metrics.
      </p>
      {loading ? <p style={{ fontSize: 12, marginTop: 8 }}>Loading dossier…</p> : null}
      {error ? (
        <p style={{ fontSize: 12, marginTop: 8, color: "var(--danger, #c44)" }}>{error}</p>
      ) : null}
      {stages.length > 0 ? (
        <ol style={{ margin: "10px 0 0", paddingLeft: 20, fontSize: 12, lineHeight: 1.5 }}>
          {stages.map((s) => (
            <li key={s.label} style={{ marginBottom: 6 }}>
              <span style={{ fontWeight: s.present ? 600 : 400, color: s.present ? "var(--fg)" : "var(--muted)" }}>
                {s.label}
              </span>
              {": "}
              <span style={{ color: "var(--fg-secondary)" }}>{s.summary}</span>
              {s.present && s.detail ? (
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ fontSize: 11, padding: "2px 8px", marginLeft: 8 }}
                  onClick={() => setExpanded(expanded === s.label ? null : s.label)}
                >
                  {expanded === s.label ? "Hide JSON" : "JSON"}
                </button>
              ) : null}
              {expanded === s.label && s.detail ? (
                <pre
                  style={{
                    marginTop: 6,
                    fontSize: 10,
                    maxHeight: 200,
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    padding: 8,
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                  }}
                >
                  {JSON.stringify(s.detail, null, 2)}
                </pre>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </details>
  );
}
