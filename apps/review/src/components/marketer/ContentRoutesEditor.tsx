"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface Lane {
  id: string;
  label: string;
  description: string;
  group: string;
  advanced: boolean;
  enabled: boolean;
  flow_types: string[];
}

interface ContentRoutesEditorProps {
  slug: string;
}

const GROUP_META: Record<string, { title: string; blurb: string }> = {
  carousel: {
    title: "Carousels",
    blurb: "Multi-slide Instagram / Facebook posts.",
  },
  video: {
    title: "Video",
    blurb: "Short-form video for Reels, TikTok, and Stories.",
  },
  text: {
    title: "Text posts",
    blurb: "Copy-first posts (LinkedIn, Reddit, Threads).",
  },
};

export function ContentRoutesEditor({ slug }: ContentRoutesEditorProps) {
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/content-routes`);
      if (!res.ok) throw new Error("Could not load content routes");
      const j = (await res.json()) as { lanes: Lane[]; enabled_lane_ids: string[] };
      setLanes(j.lanes ?? []);
      setSelected(new Set(j.enabled_lane_ids ?? []));
      if ((j.lanes ?? []).some((l) => l.advanced && l.enabled)) setShowAdvanced(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setMessage(null);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/content-routes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled_lane_ids: [...selected] }),
      });
      if (!res.ok) throw new Error("Save failed");
      const j = (await res.json()) as { lanes: Lane[]; enabled_lane_ids: string[] };
      setLanes(j.lanes ?? []);
      setSelected(new Set(j.enabled_lane_ids ?? []));
      setMessage("Saved. Ideas and content jobs will only use the routes you turned on.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const visible = useMemo(
    () => lanes.filter((l) => showAdvanced || !l.advanced),
    [lanes, showAdvanced]
  );
  const enabledCount = selected.size;

  if (loading) return <p className="workspace-muted">Loading content routes…</p>;

  return (
    <div className="content-routes-editor" data-agent-id="content-routes-editor">
      <div className="content-routes-intro">
        <p>
          Prefer choosing routes in the <strong>project setup checklist</strong> when creating the brand.
          Use this screen to confirm or change which formats this brand should produce. CAF generates
          ideas and jobs only for routes that are on.
        </p>
        <p className="content-routes-count">
          {enabledCount} route{enabledCount === 1 ? "" : "s"} on
        </p>
      </div>

      {error && <p className="workspace-error">{error}</p>}
      {message && <p className="content-routes-toast">{message}</p>}

      {(["carousel", "video", "text"] as const).map((group) => {
        const groupLanes = visible.filter((l) => l.group === group);
        if (groupLanes.length === 0) return null;
        const meta = GROUP_META[group];
        return (
          <section key={group} className="content-routes-group">
            <header className="content-routes-group-head">
              <h3>{meta?.title ?? group}</h3>
              {meta?.blurb ? <p>{meta.blurb}</p> : null}
            </header>
            <div className="content-routes-grid" role="list">
              {groupLanes.map((lane) => {
                const on = selected.has(lane.id);
                return (
                  <label
                    key={lane.id}
                    className={`content-route-card${on ? " is-on" : ""}`}
                    role="listitem"
                    data-agent-id={`content-route-${lane.id}`}
                  >
                    <input
                      type="checkbox"
                      className="content-route-card__check"
                      checked={on}
                      onChange={() => toggle(lane.id)}
                      aria-label={lane.label}
                    />
                    <span className="content-route-card__body">
                      <span className="content-route-card__title">
                        {lane.label}
                        {lane.advanced ? (
                          <span className="content-route-card__badge">Advanced</span>
                        ) : null}
                      </span>
                      <span className="content-route-card__desc">{lane.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        );
      })}

      <div className="content-routes-actions">
        <button
          type="button"
          className="btn"
          onClick={() => void save()}
          disabled={saving}
          data-agent-id="content-routes-save"
        >
          {saving ? "Saving…" : "Save content routes"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setShowAdvanced((v) => !v)}
          data-agent-id="content-routes-toggle-advanced"
        >
          {showAdvanced ? "Hide advanced" : "Show advanced"}
        </button>
      </div>
    </div>
  );
}
