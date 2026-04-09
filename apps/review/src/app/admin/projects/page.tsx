"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ProjectRow = {
  id: string;
  slug: string;
  display_name: string | null;
  active: boolean;
  color: string | null;
  created_at: string;
  updated_at: string;
  run_count?: number;
  job_count?: number;
};

type ApiList = { ok: true; projects: ProjectRow[] } | { ok: false; error: string };

export default function AdminProjectsPage() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [editing, setEditing] = useState<ProjectRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [forceDelete, setForceDelete] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/projects", { method: "GET" });
      const json = (await res.json()) as ApiList;
      if (!res.ok || (json as any).ok === false) {
        setMessage({ type: "error", text: "Failed to load projects" });
        setProjects([]);
      } else {
        setProjects((json as any).projects ?? []);
      }
    } catch {
      setMessage({ type: "error", text: "Network error while loading projects" });
      setProjects([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return projects;
    return projects.filter((p) => {
      const dn = (p.display_name ?? "").toLowerCase();
      return p.slug.toLowerCase().includes(s) || dn.includes(s);
    });
  }, [projects, q]);

  const openEdit = (p: ProjectRow) => {
    setMessage(null);
    setEditing({ ...p, color: p.color ?? "#64748b" });
  };

  const closeEdit = () => {
    setEditing(null);
    setSaving(false);
    setDeleting(false);
    setForceDelete(false);
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/projects", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: editing.slug,
          display_name: editing.display_name,
          active: editing.active,
          color: editing.color,
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.ok === false) {
        setMessage({ type: "error", text: json?.error ? `Save failed: ${json.error}` : "Save failed" });
        setSaving(false);
        return;
      }
      setMessage({ type: "success", text: "Saved" });
      await load();
      closeEdit();
    } catch {
      setMessage({ type: "error", text: "Network error while saving" });
    }
    setSaving(false);
  };

  const del = async () => {
    if (!editing) return;
    setDeleting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/projects?slug=${encodeURIComponent(editing.slug)}&force=${forceDelete ? "true" : "false"}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || json?.ok === false) {
        const hint =
          json?.error === "project_not_empty"
            ? "Project has runs/jobs. Enable Force delete to proceed."
            : "";
        setMessage({ type: "error", text: `Delete failed${hint ? `: ${hint}` : ""}` });
        setDeleting(false);
        return;
      }
      setMessage({ type: "success", text: "Deleted" });
      await load();
      closeEdit();
    } catch {
      setMessage({ type: "error", text: "Network error while deleting" });
    }
    setDeleting(false);
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Projects</h2>
          <span className="page-header-sub">Browse and manage CAF Core projects (slug, name, active, color)</span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            className="filter-input"
            style={{ width: 320 }}
            placeholder="Search by slug or name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn-ghost" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div style={{ padding: "12px 28px 28px" }}>
        {message && (
          <div
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 13,
              fontWeight: 500,
              background: message.type === "success" ? "var(--green-bg)" : "var(--red-bg)",
              color: message.type === "success" ? "var(--green)" : "var(--red)",
            }}
          >
            {message.text}
          </div>
        )}

        {loading && <p style={{ color: "var(--muted)" }}>Loading…</p>}

        {!loading && filtered.length === 0 && (
          <div className="card" style={{ textAlign: "center", color: "var(--muted)", padding: 40 }}>
            No projects found
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Active</th>
                <th>Runs</th>
                <th>Jobs</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td style={{ maxWidth: 420 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <span
                        title={p.color ?? undefined}
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 999,
                          background: p.color ?? "#94a3b8",
                          boxShadow: "0 0 0 1px rgba(255,255,255,0.12) inset",
                        }}
                      />
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontWeight: 600 }}>{p.display_name ?? p.slug}</span>
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>{p.slug}</span>
                      </div>
                    </div>
                  </td>
                  <td>{p.active ? "Yes" : "No"}</td>
                  <td>{typeof p.run_count === "number" ? p.run_count : "—"}</td>
                  <td>{typeof p.job_count === "number" ? p.job_count : "—"}</td>
                  <td style={{ color: "var(--muted)" }}>{p.updated_at ? new Date(p.updated_at).toLocaleString() : "—"}</td>
                  <td>
                    <button className="btn-open-row" onClick={() => openEdit(p)}>
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {editing && (
          <div className="card" style={{ marginTop: 16, maxWidth: 820 }}>
            <div className="card-header">Manage project</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="filter-group">
                <label className="filter-label">Slug</label>
                <input className="filter-input" value={editing.slug} disabled />
              </div>

              <div className="filter-group">
                <label className="filter-label">Display name</label>
                <input
                  className="filter-input"
                  value={editing.display_name ?? ""}
                  onChange={(e) => setEditing((prev) => (prev ? { ...prev, display_name: e.target.value || null } : prev))}
                />
              </div>

              <div className="filter-group">
                <label className="filter-label">Color</label>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input
                    type="color"
                    value={editing.color ?? "#64748b"}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, color: e.target.value } : prev))}
                    style={{ width: 44, height: 36, padding: 0, background: "transparent", border: "none" }}
                    aria-label="Project color"
                  />
                  <input
                    className="filter-input"
                    value={editing.color ?? ""}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, color: e.target.value || null } : prev))}
                    placeholder="#RRGGBB"
                  />
                </div>
              </div>

              <div className="filter-group">
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", marginTop: 24 }}>
                  <input
                    type="checkbox"
                    checked={!!editing.active}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, active: e.target.checked } : prev))}
                    style={{ width: "auto", accentColor: "var(--accent)" }}
                  />
                  Active
                </label>
              </div>
            </div>

            <div style={{ marginTop: 18, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={forceDelete}
                    onChange={(e) => setForceDelete(e.target.checked)}
                    style={{ width: "auto", accentColor: "var(--red)" }}
                  />
                  Force delete (also deletes runs/jobs)
                </label>
                <button className="btn-ghost" onClick={del} disabled={deleting || saving} style={{ color: "var(--red)" }}>
                  {deleting ? "Deleting…" : "Delete project"}
                </button>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-ghost" onClick={closeEdit} disabled={saving || deleting}>
                  Close
                </button>
                <button className="btn-primary" onClick={save} disabled={saving || deleting}>
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

