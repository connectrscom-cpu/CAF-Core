"use client";

import { useEffect, useMemo, useState } from "react";
import { useReviewProject } from "@/components/ReviewProjectContext";
import { isCarouselFlow, isVideoFlow, isProductVideoFlow } from "@/lib/flow-kind";

type PromptTemplate = Record<string, unknown>;
type PromptVersion = Record<string, unknown>;

function projectApiSuffix(multiProject: boolean, activeProjectSlug: string): string {
  if (multiProject && activeProjectSlug) return `?project=${encodeURIComponent(activeProjectSlug)}`;
  return "";
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function isCreationTemplate(t: PromptTemplate): boolean {
  const ft = asStr(t.flow_type).trim();
  const role = asStr(t.prompt_role).toLowerCase().trim();
  if (!ft) return false;
  // Creation layer: generator prompts for carousel/video flows (incl. product video).
  if (!(isCarouselFlow(ft) || isVideoFlow(ft) || isProductVideoFlow(ft))) return false;
  if (role && role !== "generator" && role !== "scene_assembly" && role !== "preparation") return false;
  return true;
}

function groupKey(ft: string, promptId: string): string {
  return `${ft}::${promptId}`;
}

export function ProjectPromptsPanel({ mode }: { mode: "project-prompts" | "prompt-versions" }) {
  const { ready, multiProject, activeProjectSlug } = useReviewProject();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");

  const [dlgOpen, setDlgOpen] = useState(false);
  const [tplDlgOpen, setTplDlgOpen] = useState(false);
  const [edit, setEdit] = useState<{
    flow_type: string;
    prompt_id: string;
    version: string;
    status: "active" | "test" | "deprecated";
    system_prompt: string;
    user_prompt_template: string;
    output_format_rule: string;
    prompt_template_id: string | null;
    experiment_tag: string;
  } | null>(null);
  const [tplEdit, setTplEdit] = useState<{
    prompt_name: string;
    flow_type: string;
    prompt_role: string;
    system_prompt: string;
    user_prompt_template: string;
    output_format_rule: string;
    output_schema_name: string;
    output_schema_version: string;
    temperature_default: string;
    max_tokens_default: string;
    stop_sequences: string;
    notes: string;
    active: boolean;
  } | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const suffix = projectApiSuffix(multiProject, activeProjectSlug);
      if (mode === "project-prompts") {
        const res = await fetch(`/api/project-config/project-prompts${suffix}`);
        const json = (await res.json()) as any;
        const pts = Array.isArray(json?.prompt_templates) ? (json.prompt_templates as PromptTemplate[]) : [];
        const pvs = Array.isArray(json?.prompt_versions) ? (json.prompt_versions as PromptVersion[]) : [];
        setTemplates(pts.filter(isCreationTemplate));
        setVersions(pvs);
      } else {
        const [resV, resT] = await Promise.all([
          fetch(`/api/project-config/prompt-versions${suffix}`),
          fetch(`/api/flow-engine`),
        ]);
        const jv = (await resV.json()) as any;
        const jt = (await resT.json()) as any;
        const pvs = Array.isArray(jv?.prompt_versions) ? (jv.prompt_versions as PromptVersion[]) : [];
        const pts = Array.isArray(jt?.prompts) ? (jt.prompts as PromptTemplate[]) : [];
        setTemplates(pts.filter(isCreationTemplate));
        setVersions(pvs);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!ready) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, mode, multiProject, activeProjectSlug]);

  const templatesByKey = useMemo(() => {
    const m = new Map<string, PromptTemplate>();
    for (const t of templates) {
      const ft = asStr(t.flow_type).trim();
      const pid = asStr(t.prompt_name).trim();
      if (!ft || !pid) continue;
      m.set(groupKey(ft, pid), t);
    }
    return m;
  }, [templates]);

  const versionsByKey = useMemo(() => {
    const m = new Map<string, PromptVersion[]>();
    for (const v of versions) {
      const ft = asStr(v.flow_type).trim();
      const pid = asStr(v.prompt_id).trim();
      if (!ft || !pid) continue;
      const k = groupKey(ft, pid);
      const arr = m.get(k) ?? [];
      arr.push(v);
      m.set(k, arr);
    }
    for (const [k, arr] of m.entries()) {
      arr.sort((a, b) => {
        const sa = asStr(a.status);
        const sb = asStr(b.status);
        const rank = (s: string) => (s === "active" ? 0 : s === "test" ? 1 : 2);
        const ra = rank(sa);
        const rb = rank(sb);
        if (ra !== rb) return ra - rb;
        return asStr(b.version).localeCompare(asStr(a.version));
      });
      m.set(k, arr);
    }
    return m;
  }, [versions]);

  const keysSorted = useMemo(() => {
    const keys = Array.from(templatesByKey.keys());
    keys.sort();
    return keys;
  }, [templatesByKey]);

  const currentTemplate = selectedKey ? templatesByKey.get(selectedKey) ?? null : null;
  const currentVersions = selectedKey ? versionsByKey.get(selectedKey) ?? [] : [];

  function openForkFromTemplate(t: PromptTemplate) {
    const ft = asStr(t.flow_type).trim();
    const pid = asStr(t.prompt_name).trim();
    const templateId = asStr(t.id).trim() || null;
    setEdit({
      flow_type: ft,
      prompt_id: pid,
      version: "v1",
      status: "test",
      system_prompt: asStr(t.system_prompt),
      user_prompt_template: asStr(t.user_prompt_template),
      output_format_rule: asStr(t.output_format_rule),
      prompt_template_id: templateId,
      experiment_tag: "",
    });
    setDlgOpen(true);
  }

  function openEditTemplate(t: PromptTemplate) {
    setTplEdit({
      prompt_name: asStr(t.prompt_name).trim(),
      flow_type: asStr(t.flow_type).trim(),
      prompt_role: asStr(t.prompt_role).trim(),
      system_prompt: asStr(t.system_prompt),
      user_prompt_template: asStr(t.user_prompt_template),
      output_format_rule: asStr(t.output_format_rule),
      output_schema_name: asStr(t.output_schema_name).trim(),
      output_schema_version: asStr(t.output_schema_version).trim(),
      temperature_default: asStr(t.temperature_default).trim(),
      max_tokens_default: asStr(t.max_tokens_default).trim(),
      stop_sequences: asStr(t.stop_sequences),
      notes: asStr(t.notes),
      active: t.active !== false,
    });
    setTplDlgOpen(true);
  }

  function openEditVersion(v: PromptVersion) {
    setEdit({
      flow_type: asStr(v.flow_type).trim(),
      prompt_id: asStr(v.prompt_id).trim(),
      version: asStr(v.version).trim(),
      status: (asStr(v.status) as any) || "test",
      system_prompt: asStr(v.system_prompt),
      user_prompt_template: asStr(v.user_prompt_template),
      output_format_rule: asStr(v.output_format_rule),
      prompt_template_id: asStr(v.prompt_template_id).trim() || null,
      experiment_tag: asStr(v.experiment_tag),
    });
    setDlgOpen(true);
  }

  async function saveVersion() {
    if (!edit) return;
    const suffix = projectApiSuffix(multiProject, activeProjectSlug);
    const body = {
      flow_type: edit.flow_type,
      prompt_id: edit.prompt_id,
      version: edit.version,
      status: edit.status,
      system_prompt: edit.system_prompt || null,
      user_prompt_template: edit.user_prompt_template || null,
      output_format_rule: edit.output_format_rule || null,
      prompt_template_id: edit.prompt_template_id,
      experiment_tag: edit.experiment_tag || null,
      metadata_json: { source: "project_prompts_ui" },
    };
    const res = await fetch(`/api/project-config/project-prompts${suffix}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || "Failed to save");
    }
    setDlgOpen(false);
    setEdit(null);
    await load();
  }

  async function saveTemplate() {
    if (!tplEdit) return;
    const body = {
      prompt_name: tplEdit.prompt_name,
      flow_type: tplEdit.flow_type,
      prompt_role: tplEdit.prompt_role || null,
      system_prompt: tplEdit.system_prompt || null,
      user_prompt_template: tplEdit.user_prompt_template || null,
      output_format_rule: tplEdit.output_format_rule || null,
      output_schema_name: tplEdit.output_schema_name || null,
      output_schema_version: tplEdit.output_schema_version || null,
      temperature_default:
        tplEdit.temperature_default.trim() === "" ? null : Number(tplEdit.temperature_default.trim()),
      max_tokens_default:
        tplEdit.max_tokens_default.trim() === "" ? null : Number(tplEdit.max_tokens_default.trim()),
      stop_sequences: tplEdit.stop_sequences || null,
      notes: tplEdit.notes || null,
      active: !!tplEdit.active,
    };
    const res = await fetch(`/api/flow-engine/prompts`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || "Failed to save template");
    }
    setTplDlgOpen(false);
    setTplEdit(null);
    await load();
  }

  if (loading) return <div className="card" style={{ padding: 24, color: "var(--muted)" }}>Loading…</div>;
  if (error) return <div className="card" style={{ padding: 24, color: "var(--red)" }}>{error}</div>;

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 320, flex: "1 1 320px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 700 }}>
              {mode === "project-prompts" ? "Project Prompts (Creation layer)" : "Prompt Versions"}
            </div>
          </div>
          <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 13, lineHeight: 1.45 }}>
            {mode === "project-prompts"
              ? "Fork CAF templates into project-scoped prompt versions. These versions can be enabled/selected and used to run generation experiments."
              : "Enable/test/deprecate project-scoped prompt versions. Generation picks active first, otherwise highest test."}
          </p>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Select template:</label>
            <select
              className="filter-input"
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              style={{ width: 420, maxWidth: "100%" }}
            >
              <option value="">— Choose —</option>
              {keysSorted.map((k) => {
                const t = templatesByKey.get(k)!;
                return (
                  <option key={k} value={k}>
                    {asStr(t.flow_type)} · {asStr(t.prompt_name)}
                  </option>
                );
              })}
            </select>
            {currentTemplate && (
              <>
                <button className="btn-ghost" onClick={() => openEditTemplate(currentTemplate)}>
                  Open template
                </button>
                <button className="btn-primary" onClick={() => openForkFromTemplate(currentTemplate)}>
                  + New version
                </button>
              </>
            )}
          </div>
        </div>

        <div style={{ minWidth: 340, flex: "1 1 340px" }}>
          {currentTemplate ? (
            <>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                {asStr(currentTemplate.prompt_name)} <span style={{ color: "var(--muted)", fontWeight: 500 }}>· {asStr(currentTemplate.flow_type)}</span>
              </div>

              <details style={{ marginBottom: 12 }}>
                <summary style={{ cursor: "pointer", color: "var(--muted)" }}>Template preview</summary>
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>System prompt</div>
                  <pre className="mono-block" style={{ maxHeight: 240, overflow: "auto" }}>{asStr(currentTemplate.system_prompt)}</pre>
                  <div style={{ fontSize: 12, color: "var(--muted)", margin: "10px 0 6px" }}>User prompt template</div>
                  <pre className="mono-block" style={{ maxHeight: 260, overflow: "auto" }}>{asStr(currentTemplate.user_prompt_template)}</pre>
                </div>
              </details>

              <div style={{ fontWeight: 700, marginBottom: 8 }}>Project versions ({currentVersions.length})</div>
              {currentVersions.length === 0 ? (
                <div style={{ color: "var(--muted)", fontSize: 13 }}>No project versions yet.</div>
              ) : (
                <table style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Version</th>
                      <th style={{ textAlign: "left" }}>Status</th>
                      <th style={{ textAlign: "left" }}>Experiment</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {currentVersions.map((v) => (
                      <tr key={asStr(v.id)}>
                        <td className="mono">{asStr(v.version)}</td>
                        <td>{asStr(v.status)}</td>
                        <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {asStr(v.experiment_tag) || "—"}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button className="btn-open-row" onClick={() => openEditVersion(v)}>Edit</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <div style={{ color: "var(--muted)", fontSize: 13, paddingTop: 6 }}>
              Pick a template to view/fork versions.
            </div>
          )}
        </div>
      </div>

      {dlgOpen && edit && (
        <div className="card" style={{ marginTop: 16, padding: 16, border: "1px solid var(--border)" }}>
          <div style={{ fontWeight: 800, marginBottom: 10 }}>Edit prompt version</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="filter-group">
              <label className="filter-label">flow_type</label>
              <input className="filter-input" value={edit.flow_type} onChange={(e) => setEdit({ ...edit, flow_type: e.target.value })} />
            </div>
            <div className="filter-group">
              <label className="filter-label">prompt_id</label>
              <input className="filter-input" value={edit.prompt_id} onChange={(e) => setEdit({ ...edit, prompt_id: e.target.value })} />
            </div>
            <div className="filter-group">
              <label className="filter-label">version</label>
              <input className="filter-input" value={edit.version} onChange={(e) => setEdit({ ...edit, version: e.target.value })} />
            </div>
            <div className="filter-group">
              <label className="filter-label">status</label>
              <select
                className="filter-input"
                value={edit.status}
                onChange={(e) => setEdit({ ...edit, status: e.target.value as any })}
              >
                <option value="active">active</option>
                <option value="test">test</option>
                <option value="deprecated">deprecated</option>
              </select>
            </div>
          </div>

          <div className="filter-group" style={{ marginTop: 12 }}>
            <label className="filter-label">experiment_tag (optional)</label>
            <input className="filter-input" value={edit.experiment_tag} onChange={(e) => setEdit({ ...edit, experiment_tag: e.target.value })} />
          </div>

          <div className="filter-group" style={{ marginTop: 12 }}>
            <label className="filter-label">system_prompt</label>
            <textarea className="filter-input" rows={6} value={edit.system_prompt} onChange={(e) => setEdit({ ...edit, system_prompt: e.target.value })} />
          </div>
          <div className="filter-group" style={{ marginTop: 12 }}>
            <label className="filter-label">user_prompt_template</label>
            <textarea className="filter-input" rows={8} value={edit.user_prompt_template} onChange={(e) => setEdit({ ...edit, user_prompt_template: e.target.value })} />
          </div>
          <div className="filter-group" style={{ marginTop: 12 }}>
            <label className="filter-label">output_format_rule</label>
            <textarea className="filter-input" rows={4} value={edit.output_format_rule} onChange={(e) => setEdit({ ...edit, output_format_rule: e.target.value })} />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button className="btn-ghost" onClick={() => { setDlgOpen(false); setEdit(null); }}>Cancel</button>
            <button
              className="btn-primary"
              onClick={() => saveVersion().catch((e) => setError(e instanceof Error ? e.message : String(e)))}
            >
              Save
            </button>
          </div>
        </div>
      )}

      {tplDlgOpen && tplEdit && (
        <div className="card" style={{ marginTop: 16, padding: 16, border: "1px solid var(--border)" }}>
          <div style={{ fontWeight: 800, marginBottom: 10 }}>Edit prompt template</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="filter-group">
              <label className="filter-label">flow_type</label>
              <input className="filter-input" value={tplEdit.flow_type} onChange={(e) => setTplEdit({ ...tplEdit, flow_type: e.target.value })} />
            </div>
            <div className="filter-group">
              <label className="filter-label">prompt_name</label>
              <input className="filter-input" value={tplEdit.prompt_name} onChange={(e) => setTplEdit({ ...tplEdit, prompt_name: e.target.value })} />
            </div>
            <div className="filter-group">
              <label className="filter-label">prompt_role</label>
              <input className="filter-input" value={tplEdit.prompt_role} onChange={(e) => setTplEdit({ ...tplEdit, prompt_role: e.target.value })} />
            </div>
            <div className="filter-group" style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 22 }}>
              <input
                type="checkbox"
                checked={tplEdit.active}
                onChange={(e) => setTplEdit({ ...tplEdit, active: e.target.checked })}
                style={{ width: "auto", accentColor: "var(--accent)" }}
              />
              <span style={{ fontSize: 13 }}>active</span>
            </div>
          </div>

          <div className="filter-group" style={{ marginTop: 12 }}>
            <label className="filter-label">notes</label>
            <textarea className="filter-input" rows={3} value={tplEdit.notes} onChange={(e) => setTplEdit({ ...tplEdit, notes: e.target.value })} />
          </div>

          <div className="filter-group" style={{ marginTop: 12 }}>
            <label className="filter-label">system_prompt</label>
            <textarea className="filter-input" rows={6} value={tplEdit.system_prompt} onChange={(e) => setTplEdit({ ...tplEdit, system_prompt: e.target.value })} />
          </div>
          <div className="filter-group" style={{ marginTop: 12 }}>
            <label className="filter-label">user_prompt_template</label>
            <textarea className="filter-input" rows={8} value={tplEdit.user_prompt_template} onChange={(e) => setTplEdit({ ...tplEdit, user_prompt_template: e.target.value })} />
          </div>
          <div className="filter-group" style={{ marginTop: 12 }}>
            <label className="filter-label">output_format_rule</label>
            <textarea className="filter-input" rows={4} value={tplEdit.output_format_rule} onChange={(e) => setTplEdit({ ...tplEdit, output_format_rule: e.target.value })} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <div className="filter-group">
              <label className="filter-label">output_schema_name</label>
              <input className="filter-input" value={tplEdit.output_schema_name} onChange={(e) => setTplEdit({ ...tplEdit, output_schema_name: e.target.value })} />
            </div>
            <div className="filter-group">
              <label className="filter-label">output_schema_version</label>
              <input className="filter-input" value={tplEdit.output_schema_version} onChange={(e) => setTplEdit({ ...tplEdit, output_schema_version: e.target.value })} />
            </div>
            <div className="filter-group">
              <label className="filter-label">temperature_default</label>
              <input className="filter-input" value={tplEdit.temperature_default} onChange={(e) => setTplEdit({ ...tplEdit, temperature_default: e.target.value })} />
            </div>
            <div className="filter-group">
              <label className="filter-label">max_tokens_default</label>
              <input className="filter-input" value={tplEdit.max_tokens_default} onChange={(e) => setTplEdit({ ...tplEdit, max_tokens_default: e.target.value })} />
            </div>
          </div>

          <div className="filter-group" style={{ marginTop: 12 }}>
            <label className="filter-label">stop_sequences</label>
            <input className="filter-input" value={tplEdit.stop_sequences} onChange={(e) => setTplEdit({ ...tplEdit, stop_sequences: e.target.value })} />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button className="btn-ghost" onClick={() => { setTplDlgOpen(false); setTplEdit(null); }}>Cancel</button>
            <button
              className="btn-primary"
              onClick={() => saveTemplate().catch((e) => setError(e instanceof Error ? e.message : String(e)))}
            >
              Save template
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

