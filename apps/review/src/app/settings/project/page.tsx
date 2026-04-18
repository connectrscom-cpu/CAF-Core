"use client";

import { useEffect, useState, useCallback } from "react";

type Section =
  | "strategy"
  | "brand"
  | "constraints"
  | "platforms"
  | "flow-types"
  | "risk-rules"
  | "heygen-defaults"
  | "heygen-config";

const TABS: { id: Section; label: string }[] = [
  { id: "strategy", label: "Strategy" },
  { id: "brand", label: "Brand" },
  { id: "constraints", label: "System limits" },
  { id: "platforms", label: "Platforms" },
  { id: "flow-types", label: "Flow Types" },
  { id: "risk-rules", label: "Risk Rules" },
  { id: "heygen-defaults", label: "Video defaults" },
  { id: "heygen-config", label: "HeyGen" },
];

const STRATEGY_FIELDS = [
  { key: "project_type", label: "Project Type", type: "text" },
  { key: "core_offer", label: "Core Offer", type: "textarea" },
  { key: "target_audience", label: "Target Audience", type: "textarea" },
  { key: "audience_problem", label: "Audience Problem", type: "textarea" },
  { key: "transformation_promise", label: "Transformation Promise", type: "textarea" },
  { key: "positioning_statement", label: "Positioning Statement", type: "textarea" },
  { key: "primary_business_goal", label: "Primary Business Goal", type: "text" },
  { key: "primary_content_goal", label: "Primary Content Goal", type: "text" },
  { key: "north_star_metric", label: "North Star Metric", type: "text" },
  { key: "monetization_model", label: "Monetization Model", type: "text" },
  { key: "traffic_destination", label: "Traffic Destination", type: "text" },
  { key: "funnel_stage_focus", label: "Funnel Stage Focus", type: "text" },
  { key: "brand_archetype", label: "Brand Archetype", type: "text" },
  { key: "strategic_content_pillars", label: "Content Pillars", type: "textarea" },
  { key: "authority_angle", label: "Authority Angle", type: "textarea" },
  { key: "differentiation_angle", label: "Differentiation Angle", type: "textarea" },
  { key: "growth_strategy", label: "Growth Strategy", type: "text" },
  { key: "publishing_intensity", label: "Publishing Intensity", type: "text" },
  { key: "time_horizon", label: "Time Horizon", type: "text" },
  { key: "owner", label: "Owner", type: "text" },
  { key: "instagram_handle", label: "Instagram handle (for carousel CTA; optional @)", type: "text" },
  { key: "notes", label: "Notes", type: "textarea" },
] as const;

const BRAND_FIELDS = [
  { key: "tone", label: "Tone", type: "textarea" },
  { key: "voice_style", label: "Voice Style", type: "text" },
  { key: "audience_level", label: "Audience Level", type: "text" },
  { key: "emotional_intensity", label: "Emotional Intensity (1-10)", type: "number" },
  { key: "humor_level", label: "Humor Level (1-10)", type: "number" },
  { key: "emoji_policy", label: "Emoji Policy", type: "text" },
  { key: "max_emojis_per_caption", label: "Max Emojis/Caption", type: "number" },
  { key: "banned_claims", label: "Banned Claims", type: "textarea" },
  { key: "banned_words", label: "Banned Words", type: "textarea" },
  { key: "mandatory_disclaimers", label: "Mandatory Disclaimers", type: "textarea" },
  { key: "cta_style_rules", label: "CTA Style Rules", type: "textarea" },
  { key: "storytelling_style", label: "Storytelling Style", type: "text" },
  { key: "positioning_statement", label: "Positioning Statement", type: "textarea" },
  { key: "differentiation_angle", label: "Differentiation Angle", type: "textarea" },
  { key: "risk_level_default", label: "Default Risk Level", type: "text" },
  { key: "manual_review_required", label: "Manual Review Required", type: "boolean" },
  { key: "notes", label: "Notes", type: "textarea" },
] as const;

const CONSTRAINT_FIELDS = [
  { key: "max_daily_jobs", label: "Max daily jobs", type: "number" },
  { key: "min_score_to_generate", label: "Min score to generate", type: "number" },
  { key: "max_active_prompt_versions", label: "Max active prompt versions", type: "number" },
  { key: "default_variation_cap", label: "Default variation cap", type: "number" },
  { key: "auto_validation_pass_threshold", label: "Auto-validation pass threshold", type: "number" },
  { key: "max_carousel_jobs_per_run", label: "Max carousel jobs (per run plan)", type: "number" },
  { key: "max_video_jobs_per_run", label: "Max video/reel jobs (per run plan)", type: "number" },
  { key: "max_jobs_per_flow_type", label: "Per-flow caps (JSON); overrides built-in defaults (carousel types default to 5; scene + 3 HeyGen paths default to 1)", type: "textarea" },
] as const;

const PLATFORM_FIELDS = [
  { key: "platform", label: "Platform", type: "text", required: true },
  { key: "caption_max_chars", label: "Caption Max Chars", type: "number" },
  { key: "hook_must_fit_first_lines", label: "Hook Must Fit First Lines", type: "boolean" },
  { key: "hook_max_chars", label: "Hook Max Chars", type: "number" },
  { key: "slide_min_chars", label: "Slide Min Chars", type: "number" },
  { key: "slide_max_chars", label: "Slide Max Chars", type: "number" },
  { key: "slide_min", label: "Min Slides", type: "number" },
  { key: "slide_max", label: "Max Slides", type: "number" },
  { key: "max_hashtags", label: "Max Hashtags", type: "number" },
  { key: "hashtag_format_rule", label: "Hashtag Format Rule", type: "text" },
  { key: "line_break_policy", label: "Line Break Policy", type: "text" },
  { key: "formatting_rules", label: "Formatting Rules", type: "textarea" },
  { key: "posting_frequency_limit", label: "Posting Frequency", type: "text" },
  { key: "best_posting_window", label: "Best Posting Window", type: "text" },
  { key: "notes", label: "Notes", type: "textarea" },
] as const;

const FLOW_TYPE_FIELDS = [
  { key: "flow_type", label: "Flow Type", type: "text", required: true },
  { key: "enabled", label: "Enabled", type: "boolean" },
  { key: "default_variation_count", label: "Default Variations", type: "number" },
  { key: "requires_signal_pack", label: "Requires Signal Pack", type: "boolean" },
  { key: "requires_learning_context", label: "Requires Learning Context", type: "boolean" },
  { key: "allowed_platforms", label: "Allowed Platforms (comma-sep)", type: "text" },
  { key: "output_schema_version", label: "Output Schema Version", type: "text" },
  { key: "qc_checklist_version", label: "QC Checklist Version", type: "text" },
  { key: "prompt_template_id", label: "Prompt Template ID", type: "text" },
  { key: "priority_weight", label: "Priority Weight (0-1)", type: "number" },
  { key: "notes", label: "Notes", type: "textarea" },
] as const;

const RISK_RULE_FIELDS = [
  { key: "flow_type", label: "Flow Type", type: "text", required: true },
  { key: "trigger_condition", label: "Trigger Condition", type: "textarea" },
  { key: "risk_level", label: "Risk Level", type: "text" },
  { key: "auto_approve_allowed", label: "Auto Approve Allowed", type: "boolean" },
  { key: "requires_manual_review", label: "Requires Manual Review", type: "boolean" },
  { key: "escalation_level", label: "Escalation Level", type: "text" },
  { key: "sensitive_topics", label: "Sensitive Topics", type: "textarea" },
  { key: "claim_restrictions", label: "Claim Restrictions", type: "textarea" },
  { key: "rejection_reason_tag", label: "Rejection Reason Tag", type: "text" },
  { key: "rollback_flag", label: "Rollback Flag", type: "boolean" },
  { key: "notes", label: "Notes", type: "textarea" },
] as const;

const HEYGEN_FIELDS = [
  { key: "config_id", label: "Config ID", type: "text", required: true },
  { key: "platform", label: "Platform", type: "text" },
  { key: "flow_type", label: "Flow Type", type: "text" },
  { key: "config_key", label: "Config Key", type: "text", required: true },
  { key: "value", label: "Value", type: "textarea" },
  { key: "render_mode", label: "Render Mode", type: "text" },
  { key: "value_type", label: "Value Type", type: "text" },
  { key: "is_active", label: "Active", type: "boolean" },
  { key: "notes", label: "Notes", type: "textarea" },
] as const;

const HEYGEN_DEFAULTS_FIELDS = [
  { key: "voice_id", label: "Default HeyGen voice_id (paste ID)", type: "text" },
  { key: "avatar_id", label: "Default HeyGen avatar_id (paste ID; ignored if pool is set)", type: "text" },
  {
    key: "avatar_pool_json",
    label:
      "Avatar pool JSON (preferred). Example: [{\"avatar_id\":\"...\",\"voice_id\":\"...\"}]",
    type: "textarea",
  },
  {
    key: "avatar_pool_helper",
    label:
      "Pool helper (one avatar_id per line). If Avatar pool JSON is empty, we’ll convert this to a pool automatically.",
    type: "textarea",
  },
] as const;

type FieldDef = { key: string; label: string; type: string; required?: boolean };

export default function ProjectConfigPage() {
  const [activeTab, setActiveTab] = useState<Section>("strategy");
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [listData, setListData] = useState<Record<string, unknown>[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const isSingleton =
    activeTab === "strategy" ||
    activeTab === "brand" ||
    activeTab === "constraints" ||
    activeTab === "heygen-defaults";

  const loadSection = useCallback(async (section: Section) => {
    setLoading(true);
    setMessage(null);
    try {
      if (section === "heygen-defaults") {
        const res = await fetch(`/api/project-config/heygen-config`);
        const json = (await res.json()) as { heygen_config?: Record<string, unknown>[] };
        const rows = Array.isArray(json.heygen_config) ? json.heygen_config : [];

        const isBroad = (r: Record<string, unknown>) =>
          !String(r.platform ?? "").trim() && !String(r.flow_type ?? "").trim() && !String(r.render_mode ?? "").trim();

        const pickValue = (key: string): string => {
          const row = rows.find((r) => isBroad(r) && String(r.config_key ?? "") === key);
          return row && typeof row.value === "string" ? row.value : "";
        };

        const voice = pickValue("voice");
        const avatarId = pickValue("avatar_id");
        const poolJson = pickValue("avatar_pool_json");

        let helper = "";
        if (poolJson.trim().startsWith("[")) {
          try {
            const parsed = JSON.parse(poolJson) as unknown;
            if (Array.isArray(parsed)) {
              helper = parsed
                .map((x) => {
                  if (!x || typeof x !== "object" || Array.isArray(x)) return "";
                  const o = x as Record<string, unknown>;
                  return String(o.avatar_id ?? o.avatarId ?? "").trim();
                })
                .filter(Boolean)
                .join("\n");
            }
          } catch {
            helper = "";
          }
        }

        setData({
          voice_id: voice,
          avatar_id: avatarId,
          avatar_pool_json: poolJson,
          avatar_pool_helper: helper,
        });
        setListData(null);
        setLoading(false);
        return;
      }

      const res = await fetch(`/api/project-config/${section}`);
      const json = await res.json();
      if (section === "constraints") {
        const c = (json as { constraints?: Record<string, unknown> | null }).constraints ?? {};
        setData({
          ...c,
          max_jobs_per_flow_type:
            c.max_jobs_per_flow_type != null && typeof c.max_jobs_per_flow_type === "object"
              ? JSON.stringify(c.max_jobs_per_flow_type, null, 2)
              : "",
        });
        setListData(null);
      } else if (isSingletonSection(section)) {
        setData(json.strategy ?? json.brand ?? {});
        setListData(null);
      } else {
        setListData(json.platforms ?? json.flow_types ?? json.risk_rules ?? json.heygen_config ?? []);
        setData(null);
      }
    } catch {
      setMessage({ text: "Failed to load config", type: "error" });
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadSection(activeTab); }, [activeTab, loadSection]);

  const handleTabChange = (tab: Section) => {
    setActiveTab(tab);
    setData(null);
    setListData(null);
  };

  const handleSave = async (formData: Record<string, unknown>) => {
    setSaving(true);
    setMessage(null);
    try {
      let payload: Record<string, unknown> = formData;
      if (activeTab === "constraints") {
        let perFlow: Record<string, number> = {};
        const raw = formData.max_jobs_per_flow_type;
        if (typeof raw === "string" && raw.trim()) {
          try {
            const parsed = JSON.parse(raw) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
                const n = typeof v === "number" ? v : Number(v);
                if (Number.isFinite(n) && n >= 0) perFlow[k] = Math.floor(n);
              }
            }
          } catch {
            setMessage({ text: "Invalid JSON for per-flow caps", type: "error" });
            setSaving(false);
            return;
          }
        }
        payload = { ...formData, max_jobs_per_flow_type: perFlow };
      }

      if (activeTab === "heygen-defaults") {
        const voiceId = typeof formData.voice_id === "string" ? formData.voice_id.trim() : "";
        const avatarId = typeof formData.avatar_id === "string" ? formData.avatar_id.trim() : "";
        const poolJsonRaw = typeof formData.avatar_pool_json === "string" ? formData.avatar_pool_json.trim() : "";
        const helperRaw = typeof formData.avatar_pool_helper === "string" ? formData.avatar_pool_helper.trim() : "";

        let poolJsonFinal = poolJsonRaw;
        if (!poolJsonFinal && helperRaw) {
          const ids = helperRaw
            .split(/\r?\n/)
            .map((x) => x.trim())
            .filter(Boolean);
          poolJsonFinal = JSON.stringify(ids.map((id) => ({ avatar_id: id })));
        }

        if (poolJsonFinal) {
          try {
            const parsed = JSON.parse(poolJsonFinal) as unknown;
            if (!Array.isArray(parsed)) throw new Error("avatar_pool_json must be a JSON array");
            const count = parsed.filter((x) => x && typeof x === "object" && !Array.isArray(x) && String((x as Record<string, unknown>).avatar_id ?? (x as Record<string, unknown>).avatarId ?? "").trim()).length;
            if (count === 0) throw new Error("avatar_pool_json must include at least one entry with avatar_id");
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setMessage({ text: `Invalid Avatar pool JSON: ${msg}`, type: "error" });
            setSaving(false);
            return;
          }
        }

        payload = {
          voice_id: voiceId || null,
          avatar_id: poolJsonFinal ? null : avatarId || null,
          avatar_pool_json: poolJsonFinal || null,
        };
      }

      const method = activeTab === "risk-rules" ? "POST" : "PUT";
      const res = await fetch(`/api/project-config/${activeTab}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setMessage({ text: "Saved successfully", type: "success" });
        loadSection(activeTab);
      } else {
        setMessage({ text: "Failed to save", type: "error" });
      }
    } catch {
      setMessage({ text: "Network error", type: "error" });
    }
    setSaving(false);
  };

  const fields = getFieldsForSection(activeTab);

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Project Configuration</h2>
          <span className="page-header-sub">Manage project profiles, brand rules, platform constraints and more</span>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => handleTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ padding: "20px 28px 28px", maxWidth: 900 }}>
        {message && (
          <div style={{
            padding: "10px 16px",
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 13,
            fontWeight: 500,
            background: message.type === "success" ? "var(--green-bg)" : "var(--red-bg)",
            color: message.type === "success" ? "var(--green)" : "var(--red)",
          }}>
            {message.text}
          </div>
        )}

        {loading && <p style={{ color: "var(--muted)" }}>Loading…</p>}

        {!loading && isSingleton && (
          <SingletonForm
            fields={fields}
            data={data ?? {}}
            onSave={handleSave}
            saving={saving}
          />
        )}

        {!loading && !isSingleton && (
          <ListForm
            fields={fields}
            items={listData ?? []}
            onSave={handleSave}
            saving={saving}
            section={activeTab}
          />
        )}

        {!loading && activeTab === "brand" && <BrandAssetsPanel />}
      </div>
    </>
  );
}

type BrandAssetKind = "logo" | "reference_image" | "palette" | "font" | "other";
const BRAND_ASSET_KINDS: BrandAssetKind[] = ["logo", "reference_image", "palette", "font", "other"];

type BrandAsset = {
  id: string;
  kind: BrandAssetKind;
  label: string | null;
  sort_order: number;
  public_url: string | null;
  storage_path: string | null;
  heygen_asset_id: string | null;
  heygen_synced_at: string | null;
  metadata_json?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

function BrandAssetsPanel() {
  const [assets, setAssets] = useState<BrandAsset[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<BrandAsset> | null>(null);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/project-config/brand-assets`);
      const json = (await res.json()) as { brand_assets?: BrandAsset[] };
      setAssets(Array.isArray(json.brand_assets) ? json.brand_assets : []);
    } catch {
      setMessage({ text: "Failed to load brand assets", type: "error" });
      setAssets([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const startNew = () => {
    setEditing({ kind: "reference_image", label: "", public_url: "", sort_order: assets?.length ?? 0 });
    setMessage(null);
  };

  const startEdit = (row: BrandAsset) => {
    setEditing({ ...row });
    setMessage(null);
  };

  const cancel = () => {
    setEditing(null);
  };

  const submit = async () => {
    if (!editing) return;
    setSaving(true);
    setMessage(null);
    try {
      const payload: Record<string, unknown> = {
        kind: editing.kind ?? "other",
        label: typeof editing.label === "string" ? editing.label : null,
        public_url: typeof editing.public_url === "string" ? editing.public_url : null,
        storage_path: typeof editing.storage_path === "string" ? editing.storage_path : null,
        sort_order: typeof editing.sort_order === "number" ? editing.sort_order : undefined,
      };
      const isEdit = typeof editing.id === "string" && editing.id.length > 0;
      const res = await fetch(
        isEdit ? `/api/project-config/brand-assets/${encodeURIComponent(editing.id!)}` : `/api/project-config/brand-assets`,
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const t = await res.text();
        setMessage({ text: `Save failed: ${t.slice(0, 240)}`, type: "error" });
      } else {
        setMessage({ text: "Saved", type: "success" });
        setEditing(null);
        await load();
      }
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Network error", type: "error" });
    }
    setSaving(false);
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this brand asset?")) return;
    setBusyId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/project-config/brand-assets/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const t = await res.text();
        setMessage({ text: `Delete failed: ${t.slice(0, 240)}`, type: "error" });
      } else {
        await load();
      }
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Network error", type: "error" });
    }
    setBusyId(null);
  };

  const syncHeygen = async (id: string) => {
    setBusyId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/project-config/brand-assets/${encodeURIComponent(id)}/sync-heygen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        const t = await res.text();
        setMessage({ text: `HeyGen sync failed: ${t.slice(0, 320)}`, type: "error" });
      } else {
        setMessage({ text: "Uploaded to HeyGen", type: "success" });
        await load();
      }
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Network error", type: "error" });
    }
    setBusyId(null);
  };

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16 }}>Brand Assets</h3>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
            Logos, reference images, palettes, fonts. HeyGen Video Agent flows can use entries with a <code>heygen_asset_id</code>.
          </div>
        </div>
        {!editing && (
          <button className="btn-primary" onClick={startNew}>+ Add brand asset</button>
        )}
      </div>

      {message && (
        <div style={{
          padding: "8px 12px",
          borderRadius: 8,
          marginBottom: 12,
          fontSize: 13,
          background: message.type === "success" ? "var(--green-bg)" : "var(--red-bg)",
          color: message.type === "success" ? "var(--green)" : "var(--red)",
        }}>
          {message.text}
        </div>
      )}

      {editing && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">{editing.id ? "Edit brand asset" : "Add brand asset"}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="filter-group">
              <label className="filter-label">Kind</label>
              <select
                className="filter-input"
                value={editing.kind ?? "other"}
                onChange={(e) => setEditing((p) => (p ? { ...p, kind: e.target.value as BrandAssetKind } : p))}
              >
                {BRAND_ASSET_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div className="filter-group">
              <label className="filter-label">Label</label>
              <input
                type="text"
                className="filter-input"
                value={editing.label ?? ""}
                onChange={(e) => setEditing((p) => (p ? { ...p, label: e.target.value } : p))}
                placeholder="e.g. Primary logo · light"
              />
            </div>
            <div className="filter-group">
              <label className="filter-label">Public URL</label>
              <input
                type="text"
                className="filter-input"
                value={editing.public_url ?? ""}
                onChange={(e) => setEditing((p) => (p ? { ...p, public_url: e.target.value } : p))}
                placeholder="https://…"
              />
            </div>
            <div className="filter-group">
              <label className="filter-label">Storage path (optional)</label>
              <input
                type="text"
                className="filter-input"
                value={editing.storage_path ?? ""}
                onChange={(e) => setEditing((p) => (p ? { ...p, storage_path: e.target.value } : p))}
                placeholder="bucket/path.png"
              />
            </div>
            <div className="filter-group">
              <label className="filter-label">Sort order</label>
              <input
                type="number"
                className="filter-input"
                value={editing.sort_order ?? 0}
                onChange={(e) => setEditing((p) => (p ? { ...p, sort_order: Number(e.target.value) } : p))}
              />
            </div>
          </div>
          <div style={{ marginTop: 18, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn-ghost" onClick={cancel} disabled={saving}>Cancel</button>
            <button className="btn-primary" onClick={submit} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {loading && <p style={{ color: "var(--muted)" }}>Loading brand assets…</p>}

      {!loading && !editing && (assets?.length ?? 0) === 0 && (
        <div className="card" style={{ textAlign: "center", color: "var(--muted)", padding: 32 }}>
          No brand assets yet. Add a logo, reference image, palette or font so HeyGen/LLM flows can reference it.
        </div>
      )}

      {!loading && (assets?.length ?? 0) > 0 && (
        <table>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Label</th>
              <th>Public URL</th>
              <th>HeyGen</th>
              <th>Order</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(assets ?? []).map((a) => {
              const hasUrl = typeof a.public_url === "string" && a.public_url.trim().length > 0;
              const synced = typeof a.heygen_asset_id === "string" && a.heygen_asset_id.length > 0;
              return (
                <tr key={a.id}>
                  <td>{a.kind}</td>
                  <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a.label ?? "—"}
                  </td>
                  <td style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {hasUrl ? (
                      <a href={a.public_url ?? "#"} target="_blank" rel="noreferrer">{a.public_url}</a>
                    ) : "—"}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {synced ? (
                      <span title={a.heygen_synced_at ?? undefined} style={{ color: "var(--green)" }}>
                        ✓ {String(a.heygen_asset_id).slice(0, 10)}…
                      </span>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>not synced</span>
                    )}
                  </td>
                  <td>{a.sort_order}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <button className="btn-open-row" onClick={() => startEdit(a)}>Edit</button>
                    <button
                      className="btn-open-row"
                      disabled={!hasUrl || busyId === a.id}
                      title={hasUrl ? "Upload file to HeyGen and store asset_id" : "Set Public URL first"}
                      onClick={() => syncHeygen(a.id)}
                    >
                      {busyId === a.id ? "Syncing…" : synced ? "Re-sync HeyGen" : "Sync HeyGen"}
                    </button>
                    <button className="btn-open-row" disabled={busyId === a.id} onClick={() => remove(a.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SingletonForm({ fields, data, onSave, saving }: {
  fields: FieldDef[];
  data: Record<string, unknown>;
  onSave: (d: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<Record<string, unknown>>(data);

  useEffect(() => { setForm(data); }, [data]);

  const update = (key: string, value: unknown) => setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="card">
      <div className="card-header">Configuration</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {fields.map((f) => (
          <FieldInput key={f.key} field={f} value={form[f.key]} onChange={(v) => update(f.key, v)} />
        ))}
      </div>
      <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
        <button className="btn-primary" onClick={() => onSave(form)} disabled={saving}>
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

function ListForm({ fields, items, onSave, saving, section }: {
  fields: FieldDef[];
  items: Record<string, unknown>[];
  onSave: (d: Record<string, unknown>) => void;
  saving: boolean;
  section: string;
}) {
  const [editItem, setEditItem] = useState<Record<string, unknown> | null>(null);
  const [showForm, setShowForm] = useState(false);

  const startNew = () => {
    const blank: Record<string, unknown> = {};
    fields.forEach((f) => {
      blank[f.key] = f.type === "boolean" ? false : f.type === "number" ? null : "";
    });
    setEditItem(blank);
    setShowForm(true);
  };

  const startEdit = (item: Record<string, unknown>) => {
    setEditItem({ ...item });
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!editItem) return;
    onSave(editItem);
    setShowForm(false);
    setEditItem(null);
  };

  const primaryKey = fields[0]?.key ?? "id";
  const displayFields = fields.slice(0, 4);

  return (
    <>
      {showForm && editItem && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">{editItem.id ? "Edit" : "Add"} {section.replace("-", " ")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {fields.map((f) => (
              <FieldInput
                key={f.key}
                field={f}
                value={editItem[f.key]}
                onChange={(v) => setEditItem((prev) => prev ? { ...prev, [f.key]: v } : prev)}
              />
            ))}
          </div>
          <div style={{ marginTop: 20, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn-ghost" onClick={() => { setShowForm(false); setEditItem(null); }}>Cancel</button>
            <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <button className="btn-primary" onClick={startNew}>+ Add {section.replace("-", " ")}</button>
      </div>

      {items.length === 0 && !showForm && (
        <div className="card" style={{ textAlign: "center", color: "var(--muted)", padding: 40 }}>
          No {section.replace("-", " ")} configured yet
        </div>
      )}

      {items.length > 0 && (
        <table>
          <thead>
            <tr>
              {displayFields.map((f) => <th key={f.key}>{f.label}</th>)}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={String(item.id ?? i)}>
                {displayFields.map((f) => (
                  <td key={f.key} style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {renderCellValue(item[f.key])}
                  </td>
                ))}
                <td>
                  <button className="btn-open-row" onClick={() => startEdit(item)}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function FieldInput({ field, value, onChange }: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (field.type === "boolean") {
    return (
      <div className="filter-group">
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            style={{ width: "auto", accentColor: "var(--accent)" }}
          />
          {field.label}
        </label>
      </div>
    );
  }

  if (field.type === "textarea") {
    return (
      <div className="filter-group">
        <label className="filter-label">{field.label}</label>
        <textarea
          className="filter-input"
          rows={3}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value || null)}
        />
      </div>
    );
  }

  if (field.type === "number") {
    return (
      <div className="filter-group">
        <label className="filter-label">{field.label}</label>
        <input
          type="number"
          className="filter-input"
          value={value != null ? String(value) : ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
          step="any"
        />
      </div>
    );
  }

  return (
    <div className="filter-group">
      <label className="filter-label">{field.label}</label>
      <input
        type="text"
        className="filter-input"
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value || null)}
      />
    </div>
  );
}

function isSingletonSection(section: Section): boolean {
  return section === "strategy" || section === "brand";
}

function getFieldsForSection(section: Section): FieldDef[] {
  switch (section) {
    case "strategy": return [...STRATEGY_FIELDS];
    case "brand": return [...BRAND_FIELDS];
    case "constraints": return [...CONSTRAINT_FIELDS];
    case "platforms": return [...PLATFORM_FIELDS];
    case "flow-types": return [...FLOW_TYPE_FIELDS];
    case "risk-rules": return [...RISK_RULE_FIELDS];
    case "heygen-defaults": return [...HEYGEN_DEFAULTS_FIELDS];
    case "heygen-config": return [...HEYGEN_FIELDS];
  }
}

function renderCellValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}
