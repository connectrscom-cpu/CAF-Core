"use client";

import { useEffect, useState, useCallback } from "react";
import { BrandAssetsPanel } from "@/components/BrandAssetsPanel";
import { useReviewProject } from "@/components/ReviewProjectContext";

function projectApiSuffix(multiProject: boolean, activeProjectSlug: string): string {
  if (multiProject && activeProjectSlug) return `?project=${encodeURIComponent(activeProjectSlug)}`;
  return "";
}

type Section =
  | "strategy"
  | "brand"
  | "product"
  | "constraints"
  | "platforms"
  | "flow-types"
  | "project-risk-rules"
  | "heygen-defaults"
  | "heygen-config";

const TABS: { id: Section; label: string }[] = [
  { id: "strategy", label: "Strategy" },
  { id: "brand", label: "Brand" },
  { id: "product", label: "Product" },
  { id: "constraints", label: "System limits" },
  { id: "platforms", label: "Platforms" },
  { id: "flow-types", label: "Flow Types" },
  { id: "project-risk-rules", label: "Project risk rules" },
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

const PRODUCT_FIELDS = [
  // What the product is
  { key: "product_name", label: "Product name", type: "text" },
  { key: "product_category", label: "Product category (SaaS, course, app, physical…)", type: "text" },
  { key: "product_url", label: "Product URL", type: "text" },
  { key: "one_liner", label: "One-liner (10–20 words)", type: "textarea" },
  { key: "value_proposition", label: "Value proposition (what / to whom / outcome)", type: "textarea" },
  { key: "elevator_pitch", label: "Elevator pitch (2–3 sentences)", type: "textarea" },
  // Audience
  { key: "primary_audience", label: "Primary audience", type: "textarea" },
  { key: "audience_pain_points", label: "Audience pain points", type: "textarea" },
  { key: "audience_desires", label: "Audience desires", type: "textarea" },
  { key: "use_cases", label: "Top use cases / scenarios (1 per line)", type: "textarea" },
  { key: "anti_audience", label: "Who this is NOT for", type: "textarea" },
  // Differentiation
  { key: "key_features", label: "Key features (1 per line — concrete)", type: "textarea" },
  { key: "key_benefits", label: "Key benefits (what the user gets)", type: "textarea" },
  { key: "differentiators", label: "Differentiators (why you, not them)", type: "textarea" },
  { key: "proof_points", label: "Proof points (numbers, case studies)", type: "textarea" },
  { key: "social_proof", label: "Social proof (testimonials, reviews)", type: "textarea" },
  { key: "competitors", label: "Competitors", type: "textarea" },
  { key: "comparison_angles", label: "Comparison angles", type: "textarea" },
  // Commercial
  { key: "pricing_summary", label: "Pricing summary", type: "text" },
  { key: "current_offer", label: "Current offer (discount / bonus / bundle)", type: "textarea" },
  { key: "offer_urgency", label: "Urgency (deadline / scarcity)", type: "text" },
  { key: "guarantee", label: "Guarantee (refund / trial / warranty)", type: "text" },
  { key: "primary_cta", label: "Primary CTA", type: "text" },
  { key: "secondary_cta", label: "Secondary CTA", type: "text" },
  // Language
  { key: "do_say", label: "Always say / preferred phrasing", type: "textarea" },
  { key: "dont_say", label: "Never say / forbidden phrasing", type: "textarea" },
  { key: "taglines", label: "Approved taglines (1 per line)", type: "textarea" },
  { key: "keywords", label: "SEO / talking-point keywords", type: "textarea" },
] as const;

const CONSTRAINT_FIELDS = [
  { key: "max_daily_jobs", label: "Max daily jobs", type: "number" },
  { key: "min_score_to_generate", label: "Min score to generate", type: "number" },
  { key: "max_active_prompt_versions", label: "Max active prompt versions", type: "number" },
  { key: "default_variation_cap", label: "Default variation cap", type: "number" },
  { key: "auto_validation_pass_threshold", label: "Auto-validation pass threshold", type: "number" },
  { key: "max_carousel_jobs_per_run", label: "Max carousel jobs (per run plan)", type: "number" },
  { key: "max_video_jobs_per_run", label: "Max video/reel jobs (per run plan)", type: "number" },
  { key: "max_jobs_per_flow_type", label: "Per-flow caps (JSON); overrides built-in defaults (carousel types default to 10; scene + 4 HeyGen paths default to 1)", type: "textarea" },
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
  {
    key: "heygen_mode",
    label: "HeyGen mode (product videos only — leave blank for code default)",
    type: "select",
    options: [
      { value: "", label: "Default (FEATURE/COMPARISON/OFFER/USECASE → script-led; PROBLEM/SOCIAL_PROOF → prompt-led)" },
      { value: "script_led", label: "script_led — /v3/videos, avatar reads spoken_script verbatim" },
      { value: "prompt_led", label: "prompt_led — /v3/video-agents, HeyGen writes and speaks its own VO" },
    ],
  },
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

type FieldDef = {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  /** For `type: "select"` — rendered as a `<select>` with these `<option>`s. */
  options?: ReadonlyArray<{ value: string; label: string }>;
};

export default function ProjectConfigPage() {
  const { ready: projectReady, multiProject, activeProjectSlug } = useReviewProject();
  const [activeTab, setActiveTab] = useState<Section>("strategy");
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [listData, setListData] = useState<Record<string, unknown>[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const isSingleton =
    activeTab === "strategy" ||
    activeTab === "brand" ||
    activeTab === "product" ||
    activeTab === "constraints" ||
    activeTab === "heygen-defaults";

  const loadSection = useCallback(async (section: Section) => {
    setLoading(true);
    setMessage(null);
    try {
      const suffix = projectApiSuffix(multiProject, activeProjectSlug);
      if (section === "heygen-defaults") {
        const res = await fetch(`/api/project-config/heygen-config${suffix}`);
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

      const res = await fetch(`/api/project-config/${section}${suffix}`);
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
        setData(json.strategy ?? json.brand ?? json.product ?? {});
        setListData(null);
      } else {
        setListData(json.platforms ?? json.flow_types ?? json.risk_rules ?? json.heygen_config ?? []);
        setData(null);
      }
    } catch {
      setMessage({ text: "Failed to load config", type: "error" });
    }
    setLoading(false);
  }, [multiProject, activeProjectSlug]);

  useEffect(() => {
    if (!projectReady) return;
    loadSection(activeTab);
  }, [activeTab, loadSection, projectReady]);

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

      const method = activeTab === "project-risk-rules" ? "POST" : "PUT";
      const suffix = projectApiSuffix(multiProject, activeProjectSlug);
      const res = await fetch(`/api/project-config/${activeTab}${suffix}`, {
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

  if (field.type === "select") {
    const options = field.options ?? [];
    const current = value == null ? "" : String(value);
    return (
      <div className="filter-group">
        <label className="filter-label">{field.label}</label>
        <select
          className="filter-input"
          value={current}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
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
  return section === "strategy" || section === "brand" || section === "product";
}

function getFieldsForSection(section: Section): FieldDef[] {
  switch (section) {
    case "strategy": return [...STRATEGY_FIELDS];
    case "brand": return [...BRAND_FIELDS];
    case "product": return [...PRODUCT_FIELDS];
    case "constraints": return [...CONSTRAINT_FIELDS];
    case "platforms": return [...PLATFORM_FIELDS];
    case "flow-types": return [...FLOW_TYPE_FIELDS];
    case "project-risk-rules": return [...RISK_RULE_FIELDS];
    case "heygen-defaults": return [...HEYGEN_DEFAULTS_FIELDS];
    case "heygen-config": return [...HEYGEN_FIELDS];
  }
}

function renderCellValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}
