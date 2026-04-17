"use client";

import { Fragment, useEffect, useState, useCallback } from "react";
import Link from "next/link";

async function copyTaskIdToClipboard(taskId: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(taskId);
  } catch {
    window.prompt("Copy task_id (Ctrl+C, then Enter):", taskId);
  }
}

function asStringList(v: unknown, max = 24): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean).slice(0, max);
}

/** Score must be below this to mint improvement rules (threshold just above actual score). */
function mintBelowThresholdForScore(score: number): number {
  return Math.min(0.9999, Math.max(0.01, score + 0.0005));
}

/** Score must be ≥ this to mint strength rules (just below actual score). */
function mintAboveThresholdForScore(score: number): number {
  return Math.max(0.0001, Math.min(0.9999, score - 0.0005));
}

interface LearningRule {
  rule_id: string;
  trigger_type: string;
  scope_flow_type: string | null;
  scope_platform: string | null;
  action_type: string;
  action_payload: Record<string, unknown>;
  confidence: number | null;
  status: string;
  applied_at: string | null;
  created_at: string;
  scope_type?: string;
  rule_family?: string;
  storage_project_slug?: string;
  provenance?: string | null;
  source_entity_ids?: unknown;
  evidence_refs?: unknown;
}

function learningRulePlainSummary(rule: LearningRule): string {
  const p = rule.action_payload ?? {};
  const obs = typeof p.observation === "string" ? p.observation : "";
  switch (rule.action_type) {
    case "SCORE_PENALTY":
      return (
        `Lowers ranking scores for ideas that match this pattern (typically tied to rejection tag "${String(p.rejection_tag ?? "—")}"). ` +
        `Penalty: ${String(p.penalty ?? "see payload")}. ` +
        (obs ? obs : "").trim()
      );
    case "REDUCE_VOLUME":
      return (
        `Tells the planner to generate fewer jobs for flow "${String(p.flow_type ?? rule.scope_flow_type ?? "—")}" ` +
        `because human approval was weak in the analysis window. ` +
        `${String(p.recommendation ?? "")} ${obs}`.trim()
      );
    case "SCORE_BOOST":
      return `Increases ranking scores when the trigger matches (boost in payload). ${obs}`.trim();
    case "GENERATION_GUIDANCE":
    case "GENERATION_HINT":
      return typeof p.text === "string"
        ? p.text
        : `Injects generation guidance for the content LLM. ${obs}`.trim();
    default:
      return `${rule.action_type}: when trigger "${rule.trigger_type}" fires, Core applies the parameters in the payload below.`;
  }
}

/** Split merged engineering markdown into heuristic vs OpenAI blocks (same join as Core). */
function splitEngineeringMarkdown(full: string): { heuristic: string; llmSection: string } {
  const marker = "\n---\n\n## Reviewer notes";
  const idx = full.indexOf(marker);
  if (idx === -1) return { heuristic: full.trim(), llmSection: "" };
  const afterSep = idx + "\n---\n\n".length;
  return {
    heuristic: full.slice(0, idx).trim(),
    llmSection: full.slice(afterSep).trim(),
  };
}

function llmCodingAgentMarkdownOnly(result: Record<string, unknown>): string {
  const llm = result.llm_notes_synthesis;
  if (!llm || typeof llm !== "object" || "skipped" in llm) return "";
  const cam = (llm as { coding_agent_markdown?: string }).coding_agent_markdown;
  return typeof cam === "string" ? cam.trim() : "";
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function RuleDetailModal({ rule, onClose }: { rule: LearningRule; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const scope = [rule.scope_flow_type, rule.scope_platform].filter(Boolean).join(" · ") || "—";
  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-labelledby="rule-detail-title"
        style={{
          background: "var(--card)",
          color: "var(--fg)",
          borderRadius: 12,
          border: "1px solid var(--border)",
          maxWidth: 560,
          width: "100%",
          maxHeight: "min(85vh, 720px)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 48px rgba(0,0,0,0.35)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border)" }}>
          <h3 id="rule-detail-title" style={{ margin: 0, fontSize: 17 }}>
            Rule details
          </h3>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>
            Read this before applying — pending rules change ranking or volume once active.
          </p>
        </div>
        <div style={{ padding: 16, overflow: "auto", fontSize: 13, lineHeight: 1.5 }}>
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px" }}>
            <dt style={{ color: "var(--muted)" }}>Rule ID</dt>
            <dd style={{ margin: 0, fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}>
              {rule.rule_id}
            </dd>
            <dt style={{ color: "var(--muted)" }}>Trigger</dt>
            <dd style={{ margin: 0 }}>{rule.trigger_type}</dd>
            <dt style={{ color: "var(--muted)" }}>Scope</dt>
            <dd style={{ margin: 0 }}>{scope}</dd>
            <dt style={{ color: "var(--muted)" }}>Action</dt>
            <dd style={{ margin: 0 }}>
              <strong>{rule.action_type}</strong>
              {rule.rule_family ? (
                <span style={{ color: "var(--muted)" }}> · {rule.rule_family}</span>
              ) : null}
            </dd>
            <dt style={{ color: "var(--muted)" }}>Confidence</dt>
            <dd style={{ margin: 0 }}>{rule.confidence != null ? Number(rule.confidence).toFixed(2) : "—"}</dd>
            {rule.provenance ? (
              <>
                <dt style={{ color: "var(--muted)" }}>Provenance</dt>
                <dd style={{ margin: 0 }}>{rule.provenance}</dd>
              </>
            ) : null}
            {rule.storage_project_slug ? (
              <>
                <dt style={{ color: "var(--muted)" }}>Stored under</dt>
                <dd style={{ margin: 0, fontFamily: "monospace", fontSize: 12 }}>
                  project <code>{rule.storage_project_slug}</code> (use Apply with this slug if shown)
                </dd>
              </>
            ) : null}
          </dl>
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>What it does</div>
            <p style={{ margin: 0, color: "var(--fg-secondary)" }}>{learningRulePlainSummary(rule)}</p>
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Payload (JSON)</div>
            <pre
              style={{
                margin: 0,
                padding: 10,
                fontSize: 11,
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                overflow: "auto",
                maxHeight: 220,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {JSON.stringify(rule.action_payload ?? {}, null, 2)}
            </pre>
          </div>
        </div>
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function buildNotesOnlyGuidelinesPrompt(input: {
  projectSlug: string;
  windowDays: number;
  notes: Array<{
    task_id: string;
    decision: string | null;
    flow_type: string | null;
    platform: string | null;
    carousel_template_name: string | null;
    carousel_template_path_hint?: string | null;
    rejection_tags: unknown[];
    notes: string | null;
    created_at: string;
  }>;
}): string {
  const allowedDecisions = new Set(["APPROVED", "NEEDS_EDIT", "REJECTED"]);
  const rows = (input.notes ?? [])
    // Only include the rows that were analyzed (human decisions). Excludes history/audit rows.
    .filter((r) => (r.decision ? allowedDecisions.has(String(r.decision).trim().toUpperCase()) : false))
    .filter((r) => (r.notes ?? "").trim().length > 0)
    .slice(0, 80)
    .map((r) => {
      const note = String(r.notes ?? "").trim().replace(/\s+/g, " ");
      const tags = Array.isArray(r.rejection_tags) ? r.rejection_tags.map((t) => String(t)).slice(0, 8) : [];
      const meta = [
        r.decision ? `decision=${r.decision}` : null,
        r.flow_type ? `flow=${r.flow_type}` : null,
        r.platform ? `platform=${r.platform}` : null,
        r.carousel_template_name ? `template=${r.carousel_template_name}` : null,
        tags.length ? `tags=${tags.join(",")}` : null,
        r.created_at ? `at=${String(r.created_at).slice(0, 10)}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return `- ${r.task_id}${meta ? ` (${meta})` : ""}\n  ${note}`;
    })
    .join("\n");

  return [
    "# CAF — guidelines + code changes (from reviewer notes)",
    "",
    `**Project:** \`${input.projectSlug}\``,
    `**Window:** last ${input.windowDays} days`,
    "",
    "## What to do",
    "Turn these notes into **(A) guidelines to feed back into generation** and **(B) concrete codebase changes** when needed.",
    "",
    "## Output (strict)",
    "1) **Guidelines** (bullet list). Each guideline must include:",
    "- scope: flow/platform and (if relevant) `carousel_template_name`",
    "- rule text: what to enforce/avoid",
    "- evidence: 2-5 `task_id` examples",
    "",
    "2) **Proposed changes** as a list of small PRs. For each PR include:",
    "- title",
    "- files/paths likely to change (e.g. `services/renderer/templates/<template>.hbs`, generator prompt files, review UI)",
    "- concrete changes",
    "- acceptance criteria",
    "- evidence: 3-6 `task_id` examples",
    "",
    "## Where issues usually live (mapping)",
    "- If `carousel_template_name=carousel_xxx`: check `services/renderer/templates/carousel_xxx.hbs`",
    "- Template selection / fallback logic: `src/services/carousel-render-pack.ts`",
    "- Editorial learning loop: `src/services/editorial-learning.ts` and `src/services/editorial-notes-llm-synthesis.ts`",
    "- Review UI: `apps/review/src/app/learning/page.tsx` and related components",
    "",
    "## Constraints",
    "- Do not rename `task_id` / text-ID schemes; preserve CAF join patterns.",
    "- If visuals are mentioned (fonts, caption overlays, spacing, cropping), anchor changes to the specific template named in the notes.",
    "- Prefer the smallest verifiable change; avoid unrelated refactors.",
    "",
    "## Notes (evidence)",
    rows || "_No non-empty notes found in this window._",
    "",
  ].join("\n");
}

export default function LearningPage() {
  const [project, setProject] = useState("SNS");
  const [rules, setRules] = useState<LearningRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [analysisResult, setAnalysisResult] = useState<Record<string, unknown> | null>(null);
  const [running, setRunning] = useState(false);
  const [editorialNotes, setEditorialNotes] = useState<Record<string, unknown> | null>(null);
  const [notesBusy, setNotesBusy] = useState(false);
  const [csvStatus, setCsvStatus] = useState<string | null>(null);
  const [mappingJson, setMappingJson] = useState("");
  const [contextPreview, setContextPreview] = useState<Record<string, unknown> | null>(null);
  const [observations, setObservations] = useState<Record<string, unknown>[]>([]);
  const [transparency, setTransparency] = useState<Record<string, unknown> | null>(null);
  const [llmBusy, setLlmBusy] = useState(false);
  const [llmResult, setLlmResult] = useState<Record<string, unknown> | null>(null);
  const [llmReviews, setLlmReviews] = useState<Record<string, unknown>[]>([]);
  const [llmLimit, setLlmLimit] = useState(3);
  const [llmMintBelow, setLlmMintBelow] = useState("");
  const [llmMintAbove, setLlmMintAbove] = useState("");
  const [llmForceRereview, setLlmForceRereview] = useState(false);
  const [llmMintBusy, setLlmMintBusy] = useState(false);
  const [llmMintStatus, setLlmMintStatus] = useState<string | null>(null);
  const [expandedLlmReviewId, setExpandedLlmReviewId] = useState<string | null>(null);
  const [operatorHintDrafts, setOperatorHintDrafts] = useState<Record<string, string>>({});
  const [llmRowActionBusy, setLlmRowActionBusy] = useState<string | null>(null);
  const [llmRowActionMsg, setLlmRowActionMsg] = useState<string | null>(null);
  const [persistEngineeringInsight, setPersistEngineeringInsight] = useState(true);
  const [llmNotesSynthesis, setLlmNotesSynthesis] = useState(true);
  const [ruleDetail, setRuleDetail] = useState<LearningRule | null>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);

  const flashCopy = (message: string) => {
    setCopyHint(message);
    window.setTimeout(() => setCopyHint(null), 2600);
  };

  const copyEditorialExport = async (label: string, text: string) => {
    const ok = await copyToClipboard(text);
    flashCopy(ok ? `Copied: ${label}` : "Copy failed — select text in the box below");
  };

  const loadEditorialNotes = async (windowDays: number) => {
    setNotesBusy(true);
    setEditorialNotes(null);
    try {
      const res = await fetch(
        `/api/learning?project=${encodeURIComponent(project)}&section=editorial_notes&window_days=${encodeURIComponent(String(windowDays))}&limit=250`
      );
      if (res.ok) setEditorialNotes(await res.json());
    } finally {
      setNotesBusy(false);
    }
  };

  const fetchTransparency = useCallback(async () => {
    const res = await fetch(`/api/learning?project=${encodeURIComponent(project)}&section=transparency`);
    if (res.ok) setTransparency(await res.json());
    else setTransparency(null);
  }, [project]);

  const fetchLlmReviews = useCallback(async () => {
    const res = await fetch(
      `/api/learning?project=${encodeURIComponent(project)}&section=llm_approval_reviews&limit=25`
    );
    if (res.ok) {
      const j = await res.json();
      setLlmReviews(j.reviews ?? []);
    }
  }, [project]);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/learning?project=${encodeURIComponent(project)}`);
      if (res.ok) {
        const json = await res.json();
        setRules(json.rules ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [project]);

  const fetchObservations = useCallback(async () => {
    const res = await fetch(`/api/learning?project=${encodeURIComponent(project)}&section=observations&limit=50`);
    if (res.ok) {
      const json = await res.json();
      setObservations(json.observations ?? []);
    }
  }, [project]);

  useEffect(() => {
    fetchRules();
    fetchObservations();
    fetchTransparency();
    fetchLlmReviews();
  }, [fetchRules, fetchObservations, fetchTransparency, fetchLlmReviews]);

  const runAnalysis = async (action: "editorial" | "market") => {
    setRunning(true);
    setAnalysisResult(null);
    setEditorialNotes(null);
    try {
      const body: Record<string, unknown> = { action, project };
      if (action === "editorial") {
        body.persist_engineering_insight = persistEngineeringInsight;
        body.llm_notes_synthesis = llmNotesSynthesis;
      }
      const res = await fetch("/api/learning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const json = await res.json();
        setAnalysisResult(json);
        fetchRules();
        fetchObservations();
        if (action === "editorial") {
          const wd =
            typeof json?.window_days === "number" && Number.isFinite(json.window_days) ? json.window_days : 30;
          loadEditorialNotes(wd).catch(() => {});
        }
      }
    } finally {
      setRunning(false);
    }
  };

  const loadContextPreview = async () => {
    const res = await fetch(`/api/learning?project=${encodeURIComponent(project)}&section=context`);
    if (res.ok) setContextPreview(await res.json());
  };

  const runLlmApprovalReview = async () => {
    setLlmBusy(true);
    setLlmResult(null);
    setLlmMintStatus(null);
    try {
      const body: Record<string, unknown> = {
        action: "llm_review_approved",
        project,
        limit: llmLimit,
        force_rereview: llmForceRereview,
      };
      const trimmed = llmMintBelow.trim();
      if (trimmed !== "") {
        const n = parseFloat(trimmed);
        if (!Number.isNaN(n)) body.mint_pending_hints_below_score = n;
      }
      body.auto_mint_pending_hints = false;
      const res = await fetch("/api/learning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      setLlmResult(json);
      fetchLlmReviews();
      fetchRules();
    } finally {
      setLlmBusy(false);
    }
  };

  const mintHintsFromLastRun = async () => {
    const belowN = llmMintBelow.trim() === "" ? NaN : parseFloat(llmMintBelow.trim());
    const aboveN = llmMintAbove.trim() === "" ? NaN : parseFloat(llmMintAbove.trim());
    if (Number.isNaN(belowN) && Number.isNaN(aboveN)) {
      window.alert("Set at least one threshold: score < (fixes) and/or score ≥ (strengths), e.g. 0.55 and 0.85.");
      return;
    }
    const results = Array.isArray((llmResult as { results?: unknown }).results)
      ? (((llmResult as { results?: unknown }).results ?? []) as Array<Record<string, unknown>>)
      : [];
    const reviewIds = results.map((r) => String(r.review_id ?? "")).filter(Boolean);
    if (reviewIds.length === 0) {
      window.alert("No review_ids found in the last run.");
      return;
    }
    setLlmMintBusy(true);
    setLlmMintStatus(null);
    try {
      const res = await fetch("/api/learning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "llm_mint_hints",
          project,
          review_ids: reviewIds,
          ...(Number.isFinite(belowN) ? { mint_below_score: belowN } : {}),
          ...(Number.isFinite(aboveN) ? { mint_above_score: aboveN } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setLlmMintStatus(`Minted ${String(json.minted ?? 0)} pending rule(s) (skipped ${String(json.skipped ?? 0)}).`);
        fetchRules();
        fetchLlmReviews();
      } else {
        setLlmMintStatus(String(json.error ?? `Mint failed (${res.status})`));
      }
    } finally {
      setLlmMintBusy(false);
    }
  };

  const mintLlmRowHints = async (reviewId: string, kind: "below" | "above") => {
    const row = llmReviews.find((x) => String(x.review_id) === reviewId);
    const score = row && row.overall_score != null ? Number(row.overall_score) : NaN;
    if (!Number.isFinite(score)) {
      window.alert("This row has no numeric score; set thresholds above and use “Mint pending hints from results” after a batch run.");
      return;
    }
    setLlmRowActionBusy(`${reviewId}:${kind}`);
    setLlmRowActionMsg(null);
    try {
      const body: Record<string, unknown> = {
        action: "llm_mint_hints",
        project,
        review_ids: [reviewId],
      };
      if (kind === "below") body.mint_below_score = mintBelowThresholdForScore(score);
      if (kind === "above") body.mint_above_score = mintAboveThresholdForScore(score);
      const res = await fetch("/api/learning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setLlmRowActionMsg(`Minted ${String(json.minted ?? 0)} pending rule(s), skipped ${String(json.skipped ?? 0)}.`);
        fetchRules();
        fetchLlmReviews();
      } else {
        setLlmRowActionMsg(String(json.error ?? `Mint failed (${res.status})`));
      }
    } finally {
      setLlmRowActionBusy(null);
    }
  };

  const submitOperatorLlmHint = async (reviewId: string) => {
    const text = (operatorHintDrafts[reviewId] ?? "").trim();
    if (text.length < 3) {
      window.alert("Enter at least 3 characters of guidance.");
      return;
    }
    setLlmRowActionBusy(`op:${reviewId}`);
    setLlmRowActionMsg(null);
    try {
      const res = await fetch("/api/learning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "llm_operator_hint",
          project,
          review_id: reviewId,
          guidance_text: text,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setLlmRowActionMsg(
          `Created pending rule ${String(json.rule_id ?? "")}. Scroll to “Active / Pending rules” and Apply when ready.`
        );
        setOperatorHintDrafts((d) => ({ ...d, [reviewId]: "" }));
        fetchRules();
      } else {
        setLlmRowActionMsg(String(json.error ?? `Failed (${res.status})`));
      }
    } finally {
      setLlmRowActionBusy(null);
    }
  };

  const applyRule = async (rule: LearningRule) => {
    const slug = rule.storage_project_slug ?? project;
    const res = await fetch("/api/learning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply_rule", storage_project: slug, rule_id: rule.rule_id }),
    });
    if (res.ok) fetchRules();
  };

  const retireRule = async (rule: LearningRule) => {
    const slug = rule.storage_project_slug ?? project;
    const res = await fetch("/api/learning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retire_rule", storage_project: slug, rule_id: rule.rule_id }),
    });
    if (res.ok) fetchRules();
  };

  const eraseRule = async (rule: LearningRule) => {
    const slug = rule.storage_project_slug ?? project;
    const ok = window.confirm(
      `Erase rule "${rule.rule_id}"?\n\nThis permanently deletes it from project "${slug}".\n(Use Retire if you only want to deactivate.)`
    );
    if (!ok) return;
    const res = await fetch("/api/learning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "erase_rule", storage_project: slug, rule_id: rule.rule_id }),
    });
    if (res.ok) fetchRules();
  };

  const eraseRulesAll = async (status?: string) => {
    const slug = project;
    const label = status ? `ALL ${status.toUpperCase()} rules` : "ALL rules";
    const ok = window.confirm(
      `Erase ${label} for project "${slug}"?\n\nThis permanently deletes rows from Core.\n(Use Retire to keep history.)`
    );
    if (!ok) return;
    const res = await fetch("/api/learning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "erase_rules_all", storage_project: slug, status: status ?? "any" }),
    });
    if (res.ok) {
      const j = (await res.json().catch(() => ({}))) as { erased?: number; status?: string };
      flashCopy(`Erased ${j.erased ?? "?"} rule(s) (${String(j.status ?? status ?? "any")})`);
      fetchRules();
      return;
    }
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    window.alert(err.error ?? `Erase failed (${res.status})`);
  };

  const uploadCsv = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCsvStatus(null);
    const form = e.currentTarget;
    const input = form.querySelector<HTMLInputElement>('input[type="file"]');
    const file = input?.files?.[0];
    if (!file) {
      setCsvStatus("Choose a CSV file.");
      return;
    }
    const fd = new FormData();
    fd.append("project", project);
    fd.append("file", file);
    if (mappingJson.trim()) fd.append("mapping", mappingJson.trim());
    try {
      const res = await fetch("/api/learning", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setCsvStatus(
          `Ingested ${json.ingested ?? 0} rows (${json.skipped ?? 0} skipped). Batch ${json.batch_id ?? "—"}`
        );
        fetchObservations();
        fetchRules();
      } else {
        setCsvStatus(json.error ?? `Upload failed (${res.status})`);
      }
    } catch (err) {
      setCsvStatus(err instanceof Error ? err.message : "Upload failed");
    }
    form.reset();
  };

  const active = rules.filter((r) => r.status === "active");
  const pending = rules.filter((r) => r.status === "pending");

  return (
    <div>
      <div className="page-header">
        <h2>Learning Layer</h2>
        <p>
          Evidence-backed rules, editorial and market analyzers, social CSV ingest, and compiled generation context.
        </p>
      </div>

      {transparency && (
        <div className="card" style={{ marginBottom: 20, borderLeft: "4px solid var(--accent)" }}>
          <h3 style={{ marginBottom: 8 }}>Transparency — automation and LLM role</h3>
          <p style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 14, color: "var(--fg-secondary)" }}>
            {String(transparency.summary ?? "")}
          </p>
          {transparency.snapshot != null &&
          typeof transparency.snapshot === "object" &&
          !Array.isArray(transparency.snapshot) ? (
            <div
              style={{
                display: "flex",
                gap: 16,
                flexWrap: "wrap",
                fontSize: 13,
                marginBottom: 16,
                padding: "10px 12px",
                background: "var(--card)",
                borderRadius: 8,
                border: "1px solid var(--border)",
              }}
            >
              {Object.entries(transparency.snapshot as Record<string, unknown>).map(([k, v]) => (
                <div key={k}>
                  <span style={{ color: "var(--muted)" }}>{k.replace(/_/g, " ")}</span>{" "}
                  <strong>
                    {v === -1 && k === "observations_last_30d" ? "n/a (run DB migrations)" : String(v)}
                  </strong>
                </div>
              ))}
            </div>
          ) : null}
          <div style={{ fontSize: 13, lineHeight: 1.45 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>How each part runs</div>
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {(Array.isArray(transparency.loops) ? transparency.loops : []).map((loop: unknown) => {
                const L = loop as Record<string, unknown>;
                const llm = Boolean(L.llm_involved);
                return (
                  <li key={String(L.id)} style={{ marginBottom: 12 }}>
                    <strong>{String(L.name ?? L.id)}</strong>{" "}
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: llm ? "rgba(120, 80, 200, 0.2)" : "rgba(80, 120, 80, 0.2)",
                      }}
                    >
                      {llm ? "LLM consumes output" : "No LLM in analyzer"}
                    </span>
                    <div style={{ color: "var(--fg-secondary)", marginTop: 4 }}>{String(L.analyzer ?? "")}</div>
                    <div style={{ color: "var(--muted)", marginTop: 2 }}>
                      Automation: <code>{String(L.automation ?? "")}</code>
                    </div>
                    {L.llm_role ? (
                      <div style={{ marginTop: 4 }}>{String(L.llm_role)}</div>
                    ) : null}
                    <div style={{ marginTop: 4, color: "var(--fg-secondary)" }}>
                      {String(L.requires_human ?? "")}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          {Array.isArray(transparency.not_implemented_yet) && transparency.not_implemented_yet.length > 0 && (
            <div style={{ marginTop: 16, fontSize: 13 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Not automatic in Core today</div>
              <ul style={{ paddingLeft: 18, margin: 0, color: "var(--fg-secondary)" }}>
                {transparency.not_implemented_yet.map((x: unknown) => (
                  <li key={String(x)}>{String(x)}</li>
                ))}
              </ul>
            </div>
          )}
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 14, marginBottom: 0 }}>
            API: <code>GET /v1/learning/&lt;slug&gt;/transparency</code> — same data for tools and dashboards.
          </p>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 8, fontSize: 13 }}>
          Project slug
          <input
            style={{ marginLeft: 8, width: 120, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)" }}
            value={project}
            onChange={(e) => setProject(e.target.value.trim())}
          />
        </label>
      </div>

      <div className="card" style={{ marginBottom: 12, fontSize: 13, display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={persistEngineeringInsight}
            onChange={(e) => setPersistEngineeringInsight(e.target.checked)}
          />
          After editorial analysis, save engineering brief to Core (<code>learning_insights</code>, scope{" "}
          <code>engineering</code>) when there is content to persist
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={llmNotesSynthesis}
            onChange={(e) => setLlmNotesSynthesis(e.target.checked)}
          />
          Run <strong>OpenAI</strong> on reviewer <code>notes</code> (requires Core <code>OPENAI_API_KEY</code>; themes +
          actions JSON; merged into engineering markdown)
        </label>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <button
          className="btn-primary"
          onClick={() => runAnalysis("editorial")}
          disabled={running}
          title="Analyzes human review history (APPROVED / NEEDS_EDIT / REJECTED, tags, overrides) and proposes pending learning rules that can improve future ranking/volume decisions."
        >
          {running ? "Running..." : "Run Editorial Analysis"}
        </button>
        <button
          className="btn-primary"
          onClick={() => runAnalysis("market")}
          disabled={running}
          title="Analyzes ingested social performance metrics (likes/saves/shares/etc.) and proposes pending learning rules to boost or penalize patterns/flows that perform better or worse."
        >
          {running ? "Running..." : "Run Market Analysis"}
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={loadContextPreview}
          title="Shows the compiled learning context that will be injected into generation prompts (global → project). This is a preview only; it does not change rules."
        >
          Preview compiled context
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => eraseRulesAll("pending")}
          title="Hard-deletes all pending rules for this project (does not touch caf-global rules)."
        >
          Erase pending rules
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => eraseRulesAll("any")}
          title="Hard-deletes all rules for this project (does not touch caf-global rules)."
        >
          Erase ALL rules
        </button>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 8 }}>LLM review (approved content only)</h3>
        <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
          Uses OpenAI vision + text on jobs whose <strong>latest</strong> editorial decision is APPROVED. Sends
          rendered image URLs when present, plus hook, caption, slides, video prompts, and scene bundles. Writes
          scores to Core, creates a <code>learning_observations</code> row, and can mint <strong>pending</strong>{" "}
          generation hints from low scores (fixes) or high scores (strengths to preserve),{" "}
          <em>after you choose thresholds and mint</em> (same pending → Apply flow as editorial rules). On Core,
          carousel primary generation also reuses recent rows here as an <strong>anti-repetition lane memory</strong>{" "}
          (hook/caption/slide fingerprints for the same flow + platform; configure{" "}
          <code>LLM_APPROVAL_ANTI_REPETITION_MAX_CHARS</code> / <code>LLM_APPROVAL_ANTI_REPETITION_MAX_JOBS</code>, set
          to <code>0</code> to disable).
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <label style={{ fontSize: 13 }}>
            Batch size{" "}
            <input
              type="number"
              min={1}
              max={20}
              value={llmLimit}
              onChange={(e) => setLlmLimit(parseInt(e.target.value, 10) || 3)}
              style={{ width: 56, padding: 4, marginLeft: 6 }}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            Mint fixes if score &lt;{" "}
            <input
              placeholder="off"
              value={llmMintBelow}
              onChange={(e) => setLlmMintBelow(e.target.value)}
              style={{ width: 56, padding: 4 }}
            />{" "}
            <span style={{ color: "var(--muted)" }}>(e.g. 0.55)</span>
          </label>
          <label style={{ fontSize: 13 }}>
            Mint strengths if score ≥{" "}
            <input
              placeholder="off"
              value={llmMintAbove}
              onChange={(e) => setLlmMintAbove(e.target.value)}
              style={{ width: 56, padding: 4 }}
            />{" "}
            <span style={{ color: "var(--muted)" }}>(e.g. 0.85)</span>
          </label>
          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={llmForceRereview}
              onChange={(e) => setLlmForceRereview(e.target.checked)}
            />
            Force re-review (ignore 7-day skip)
          </label>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={runLlmApprovalReview}
          disabled={llmBusy}
          title="Runs an LLM QA pass on content whose latest editorial decision is APPROVED. Uses text + (optional) image assets to produce a score and improvement bullets; can mint pending generation hints if configured."
        >
          {llmBusy ? "Running LLM review…" : "Run LLM review (approved)"}
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={mintHintsFromLastRun}
          disabled={llmMintBusy || !llmResult}
          title="Creates pending GENERATION_GUIDANCE rules from the last run: improvement bullets when score is below the first threshold, and strength bullets when score is at or above the second. Apply in the rules list before they affect generation."
          style={{ marginLeft: 10 }}
        >
          {llmMintBusy ? "Minting…" : "Mint pending hints from results"}
        </button>
        {llmMintStatus ? (
          <p style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>{llmMintStatus}</p>
        ) : null}
        {llmResult && (
          <pre
            style={{
              marginTop: 12,
              fontSize: 11,
              maxHeight: 220,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              background: "var(--card)",
              padding: 8,
              borderRadius: 6,
              border: "1px solid var(--border)",
            }}
          >
            {JSON.stringify(llmResult, null, 2)}
          </pre>
        )}
      </div>

      {llmReviews.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginBottom: 8 }}>Recent LLM approval reviews ({llmReviews.length})</h3>
          <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>
            Read the model’s summary and bullets in place. Use <strong>Mint fix</strong> / <strong>Mint strengths</strong> to turn
            this row into <strong>pending GENERATION_GUIDANCE</strong> rules (then Apply in the rules tables below).{" "}
            <strong>Your guidance</strong> adds a free-text pending rule tied to the same review. Full <code>task_id</code> for
            copy / workbench.
          </p>
          {llmRowActionMsg ? (
            <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>{llmRowActionMsg}</p>
          ) : null}
          <p style={{ margin: "0 0 8px", fontSize: 11, color: "var(--muted)" }}>
            <Link href="#learning-rules" style={{ color: "var(--accent)" }}>
              Jump to Active / Pending rules
            </Link>
          </p>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", tableLayout: "fixed" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid var(--border)", width: "38%" }}>
                  task_id
                </th>
                <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid var(--border)", width: "7%" }}>score</th>
                <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid var(--border)", width: "7%" }}>img</th>
                <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid var(--border)", width: "10%" }}>minted</th>
                <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid var(--border)", width: "14%" }}>when</th>
                <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid var(--border)" }}>actions</th>
              </tr>
            </thead>
            <tbody>
              {llmReviews.slice(0, 15).map((r) => {
                const rid = String(r.review_id);
                const tid = String(r.task_id);
                const open = expandedLlmReviewId === rid;
                const scoreN = r.overall_score != null ? Number(r.overall_score) : NaN;
                const imgLen = Array.isArray(r.vision_image_urls) ? r.vision_image_urls.length : 0;
                return (
                  <Fragment key={rid}>
                    <tr>
                      <td
                        style={{
                          padding: 6,
                          borderBottom: "1px solid var(--border)",
                          fontFamily: "monospace",
                          fontSize: 11,
                          wordBreak: "break-all",
                          verticalAlign: "top",
                        }}
                      >
                        <div style={{ userSelect: "text" }}>{tid}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                          <button
                            type="button"
                            className="btn-ghost"
                            style={{ fontSize: 11, padding: "4px 10px" }}
                            onClick={() => void copyTaskIdToClipboard(tid)}
                            title="Copy full task_id to the clipboard"
                          >
                            Copy ID
                          </button>
                          <Link
                            href={`/t/${encodeURIComponent(tid)}`}
                            className="btn-ghost"
                            style={{ fontSize: 11, padding: "4px 10px", textDecoration: "none" }}
                            title="Human editorial workbench"
                          >
                            Open task
                          </Link>
                          <Link
                            href={`/content/${encodeURIComponent(tid)}`}
                            className="btn-ghost"
                            style={{ fontSize: 11, padding: "4px 10px", textDecoration: "none" }}
                            title="Approved content view (read-only)"
                          >
                            Read content
                          </Link>
                        </div>
                      </td>
                      <td style={{ padding: 6, borderBottom: "1px solid var(--border)", verticalAlign: "top" }}>
                        {Number.isFinite(scoreN) ? scoreN.toFixed(2) : "—"}
                      </td>
                      <td style={{ padding: 6, borderBottom: "1px solid var(--border)", verticalAlign: "top" }}>{imgLen}</td>
                      <td style={{ padding: 6, borderBottom: "1px solid var(--border)", verticalAlign: "top" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                          {r.minted_pending_rule ? (
                            <span
                              style={{
                                fontSize: 10,
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: "var(--accent)",
                                color: "#fff",
                              }}
                              title="A pending improvement rule was minted from this review"
                            >
                              fix
                            </span>
                          ) : null}
                          {r.minted_pending_positive_rule ? (
                            <span
                              style={{
                                fontSize: 10,
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: "var(--green)",
                                color: "#0a0a0a",
                              }}
                              title="A pending strength rule was minted from this review"
                            >
                              str
                            </span>
                          ) : null}
                          {!r.minted_pending_rule && !r.minted_pending_positive_rule ? (
                            <span style={{ color: "var(--muted)" }}>—</span>
                          ) : null}
                        </div>
                      </td>
                      <td
                        style={{
                          padding: 6,
                          borderBottom: "1px solid var(--border)",
                          color: "var(--muted)",
                          verticalAlign: "top",
                        }}
                      >
                        {String(r.created_at ?? "").slice(0, 16)}
                      </td>
                      <td style={{ padding: 6, borderBottom: "1px solid var(--border)", verticalAlign: "top" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                          <button
                            type="button"
                            className="btn-ghost"
                            style={{ fontSize: 11, padding: "4px 8px" }}
                            onClick={() => setExpandedLlmReviewId(open ? null : rid)}
                          >
                            {open ? "Hide review" : "Read review"}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost"
                            style={{ fontSize: 11, padding: "4px 8px" }}
                            disabled={!Number.isFinite(scoreN) || llmRowActionBusy !== null}
                            title="Mint pending GENERATION_GUIDANCE from improvement bullets (score treated as below threshold)"
                            onClick={() => void mintLlmRowHints(rid, "below")}
                          >
                            {llmRowActionBusy === `${rid}:below` ? "…" : "Mint fix"}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost"
                            style={{ fontSize: 11, padding: "4px 8px" }}
                            disabled={!Number.isFinite(scoreN) || llmRowActionBusy !== null}
                            title="Mint pending guidance from strengths (score treated as at/above threshold)"
                            onClick={() => void mintLlmRowHints(rid, "above")}
                          >
                            {llmRowActionBusy === `${rid}:above` ? "…" : "Mint strengths"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {open ? (
                      <tr>
                        <td colSpan={6} style={{ padding: "10px 12px 14px", background: "var(--bg-secondary)", borderBottom: "1px solid var(--border)" }}>
                          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
                            Review <code>{rid}</code>
                            {typeof r.model === "string" && r.model ? ` · model ${r.model}` : ""}
                          </div>
                          {typeof r.summary === "string" && r.summary.trim() ? (
                            <p style={{ margin: "0 0 10px", fontSize: 13, lineHeight: 1.45 }}>{r.summary.trim()}</p>
                          ) : (
                            <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--muted)" }}>No summary on this row.</p>
                          )}
                          {asStringList(r.improvement_bullets).length > 0 ? (
                            <div style={{ marginBottom: 10 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Improvements</div>
                              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.45 }}>
                                {asStringList(r.improvement_bullets).map((b) => (
                                  <li key={b}>{b}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          {asStringList(r.strengths).length > 0 ? (
                            <div style={{ marginBottom: 10 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Strengths</div>
                              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.45 }}>
                                {asStringList(r.strengths).map((b) => (
                                  <li key={b}>{b}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          {asStringList(r.weaknesses).length > 0 ? (
                            <div style={{ marginBottom: 10 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Weaknesses</div>
                              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.45 }}>
                                {asStringList(r.weaknesses).map((b) => (
                                  <li key={b}>{b}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          {asStringList(r.risk_flags).length > 0 ? (
                            <div style={{ marginBottom: 10 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Risk flags</div>
                              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.45 }}>
                                {asStringList(r.risk_flags).map((b) => (
                                  <li key={b}>{b}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          {typeof r.raw_assistant_text === "string" && r.raw_assistant_text.trim() ? (
                            <details style={{ marginBottom: 12, fontSize: 11 }}>
                              <summary style={{ cursor: "pointer", color: "var(--accent)" }}>Raw model output (truncated)</summary>
                              <pre
                                style={{
                                  marginTop: 8,
                                  maxHeight: 200,
                                  overflow: "auto",
                                  whiteSpace: "pre-wrap",
                                  fontSize: 11,
                                  padding: 8,
                                  borderRadius: 6,
                                  border: "1px solid var(--border)",
                                  background: "var(--card)",
                                }}
                              >
                                {r.raw_assistant_text.length > 6000
                                  ? `${r.raw_assistant_text.slice(0, 6000)}…`
                                  : r.raw_assistant_text}
                              </pre>
                            </details>
                          ) : null}
                          <label style={{ fontSize: 11, fontWeight: 600, display: "block", marginBottom: 4 }}>
                            Your generation guidance (pending rule)
                          </label>
                          <textarea
                            value={operatorHintDrafts[rid] ?? ""}
                            onChange={(e) => setOperatorHintDrafts((d) => ({ ...d, [rid]: e.target.value }))}
                            placeholder="e.g. Always keep hooks under 12 words for this brand; avoid medical claims on slide 2…"
                            rows={3}
                            style={{
                              width: "100%",
                              maxWidth: 720,
                              fontSize: 12,
                              padding: 8,
                              borderRadius: 6,
                              border: "1px solid var(--border)",
                              marginBottom: 8,
                            }}
                          />
                          <button
                            type="button"
                            className="btn-primary"
                            style={{ fontSize: 12 }}
                            disabled={llmRowActionBusy !== null}
                            onClick={() => void submitOperatorLlmHint(rid)}
                          >
                            {llmRowActionBusy === `op:${rid}` ? "Saving…" : "Save as pending guidance rule"}
                          </button>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <form className="card" style={{ marginBottom: 20 }} onSubmit={uploadCsv}>
        <h3 style={{ marginBottom: 8 }}>Upload social performance CSV</h3>
        <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
          Map platform export columns if needed (JSON). Defaults recognize{" "}
          <code>platform</code>, <code>posted_at</code>, <code>task_id</code>, metrics.
        </p>
        <input type="file" name="file" accept=".csv,text/csv" style={{ marginBottom: 8 }} />
        <textarea
          placeholder='Optional mapping JSON, e.g. {"platform":"Channel","posted_at":"Date","likes":"Likes"}'
          value={mappingJson}
          onChange={(e) => setMappingJson(e.target.value)}
          rows={2}
          style={{ width: "100%", marginBottom: 8, fontFamily: "monospace", fontSize: 12 }}
        />
        <button
          type="submit"
          className="btn-primary"
          title="Uploads a social platform export CSV, maps columns to CAF metrics, writes performance_metrics rows, and creates an observation for learning/analysis."
        >
          Upload &amp; ingest
        </button>
        {csvStatus && <p style={{ marginTop: 8, fontSize: 13 }}>{csvStatus}</p>}
      </form>

      {contextPreview && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3>Compiled context preview</h3>
          <pre style={{ fontSize: 12, maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap" }}>
            {JSON.stringify(contextPreview, null, 2)}
          </pre>
        </div>
      )}

      {analysisResult && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3>Analysis Result</h3>
          {typeof analysisResult.engineering_prompt_markdown === "string" &&
            analysisResult.engineering_prompt_markdown.length > 0 && (
              <div
                style={{
                  marginBottom: 16,
                  padding: 14,
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "rgba(120, 140, 200, 0.06)",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: 16 }}>Prompt engineering export</h4>
                    <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--muted)", maxWidth: 520 }}>
                      One-click copy for Claude / Cursor. Full brief includes template triggers + OpenAI notes when enabled.
                    </p>
                  </div>
                  {analysisResult.engineering_insight_id ? (
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      Core insight <code>{String(analysisResult.engineering_insight_id)}</code>
                    </span>
                  ) : null}
                </div>
                {(() => {
                  const full = String(analysisResult.engineering_prompt_markdown);
                  const { heuristic, llmSection } = splitEngineeringMarkdown(full);
                  const codingOnly = llmCodingAgentMarkdownOnly(analysisResult);
                  return (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12, alignItems: "center" }}>
                      <button
                        type="button"
                        className="btn-primary"
                        title="Everything below: triggers + workflow + OpenAI synthesis"
                        onClick={() => copyEditorialExport("full prompt brief", full)}
                      >
                        Copy full brief
                      </button>
                      {heuristic.length > 0 && llmSection.length > 0 ? (
                        <button
                          type="button"
                          className="btn-ghost"
                          title="Heuristic repo paths only (before reviewer-notes section)"
                          onClick={() => copyEditorialExport("template-trigger section", heuristic)}
                        >
                          Copy trigger section
                        </button>
                      ) : null}
                      {llmSection.length > 0 ? (
                        <button
                          type="button"
                          className="btn-ghost"
                          title="OpenAI synthesis block only (themes, actions, coding brief)"
                          onClick={() => copyEditorialExport("OpenAI notes section", llmSection)}
                        >
                          Copy OpenAI section
                        </button>
                      ) : null}
                      {codingOnly.length > 0 ? (
                        <button
                          type="button"
                          className="btn-ghost"
                          title="Raw coding_agent_markdown from the model (subset of OpenAI section)"
                          onClick={() => copyEditorialExport("coding agent markdown", codingOnly)}
                        >
                          Copy coding brief only
                        </button>
                      ) : null}
                    </div>
                  );
                })()}
                {copyHint ? (
                  <p style={{ margin: "10px 0 0", fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>
                    {copyHint}
                  </p>
                ) : null}
                <textarea
                  readOnly
                  aria-label="Full prompt engineering markdown for export"
                  value={String(analysisResult.engineering_prompt_markdown)}
                  rows={16}
                  style={{
                    width: "100%",
                    marginTop: 12,
                    fontFamily: "monospace",
                    fontSize: 12,
                    padding: 10,
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                    resize: "vertical",
                  }}
                />
                <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, marginBottom: 0 }}>
                  Triggers live in Core: <code>src/config/editorial-engineering-triggers.ts</code>. Carousel copy bar:{" "}
                  <code>src/services/carousel-copy-prompt-policy.ts</code>.
                </p>
              </div>
            )}

          {editorialNotes &&
            typeof editorialNotes === "object" &&
            Array.isArray((editorialNotes as { notes?: unknown }).notes) && (
              <div
                style={{
                  marginBottom: 16,
                  padding: 14,
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "rgba(120, 200, 160, 0.06)",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: 16 }}>Reviewer notes (raw, with template)</h4>
                    <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--muted)", maxWidth: 560 }}>
                      These are human <code>editorial_reviews.notes</code> rows enriched with <code>carousel_template_name</code> when available.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => loadEditorialNotes(Number((analysisResult as { window_days?: number }).window_days ?? 30))}
                    disabled={notesBusy}
                    title="Refresh notes for this window"
                  >
                    {notesBusy ? "Loading…" : "Refresh notes"}
                  </button>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12, alignItems: "center" }}>
                  <button
                    type="button"
                    className="btn-primary"
                    title="Copy a prompt to extract guidelines + concrete repo changes from notes"
                    onClick={() => {
                      const wd = Number((editorialNotes as { window_days?: number }).window_days ?? 30);
                      const notes = (editorialNotes as { notes: unknown[] }).notes as Array<Record<string, unknown>>;
                      const text = buildNotesOnlyGuidelinesPrompt({
                        projectSlug: project,
                        windowDays: Number.isFinite(wd) ? wd : 30,
                        notes: notes.map((n) => ({
                          task_id: String(n.task_id ?? ""),
                          decision: (n.decision ?? null) as string | null,
                          flow_type: (n.flow_type ?? null) as string | null,
                          platform: (n.platform ?? null) as string | null,
                          carousel_template_name: (n.carousel_template_name ?? null) as string | null,
                          carousel_template_path_hint: (n.carousel_template_path_hint ?? null) as string | null,
                          rejection_tags: Array.isArray(n.rejection_tags) ? n.rejection_tags : [],
                          notes: (n.notes ?? null) as string | null,
                          created_at: String(n.created_at ?? ""),
                        })),
                      });
                      copyEditorialExport("guidelines + code-change prompt (notes)", text);
                    }}
                  >
                    Copy notes → guidelines prompt
                  </button>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    Showing {((editorialNotes as { notes: unknown[] }).notes ?? []).length} rows
                  </span>
                </div>

                <textarea
                  readOnly
                  aria-label="Reviewer notes rows (JSON)"
                  value={JSON.stringify((editorialNotes as { notes: unknown[] }).notes ?? [], null, 2)}
                  rows={10}
                  style={{
                    width: "100%",
                    marginTop: 12,
                    fontFamily: "monospace",
                    fontSize: 11,
                    padding: 10,
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                    resize: "vertical",
                  }}
                />
              </div>
            )}
          <pre style={{ fontSize: 12, maxHeight: 300, overflow: "auto", whiteSpace: "pre-wrap" }}>
            {JSON.stringify(
              (() => {
                const r = { ...analysisResult };
                const md = r.engineering_prompt_markdown;
                if (typeof md === "string" && md.length > 0) {
                  r.engineering_prompt_markdown = `[${md.length} characters — copied via button above]`;
                }
                const llm = r.llm_notes_synthesis;
                if (
                  llm &&
                  typeof llm === "object" &&
                  !("skipped" in llm) &&
                  typeof (llm as { coding_agent_markdown?: string }).coding_agent_markdown === "string"
                ) {
                  const cam = (llm as { coding_agent_markdown: string }).coding_agent_markdown;
                  if (cam.length > 0) {
                    (r as { llm_notes_synthesis: Record<string, unknown> }).llm_notes_synthesis = {
                      ...(llm as Record<string, unknown>),
                      coding_agent_markdown: `[${cam.length} chars — merged into engineering prompt above]`,
                    };
                  }
                }
                return r;
              })(),
              null,
              2
            )}
          </pre>
        </div>
      )}

      {observations.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3>Recent observations ({observations.length})</h3>
          <ul style={{ fontSize: 12, maxHeight: 200, overflow: "auto", paddingLeft: 18 }}>
            {observations.slice(0, 15).map((o) => (
              <li key={String(o.observation_id ?? o.id)}>
                <span style={{ fontFamily: "monospace", fontSize: 11 }}>{String(o.observation_type)}</span> —{" "}
                {String(o.source_type)} (
                {String(o.observed_at ?? "").slice(0, 10)})
              </li>
            ))}
          </ul>
        </div>
      )}

      <div id="learning-rules" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Active Rules ({active.length})</h3>
          {active.length === 0 ? (
            <p style={{ color: "#888" }}>No active learning rules yet.</p>
          ) : (
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }}>
                    Rule ID
                  </th>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }}>
                    Action
                  </th>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }}>
                    Family
                  </th>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }}>
                    Info
                  </th>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }} />
                </tr>
              </thead>
              <tbody>
                {active.map((rule) => (
                  <tr key={rule.rule_id}>
                    <td
                      style={{
                        padding: "4px 8px",
                        borderBottom: "1px solid var(--border)",
                        fontSize: 11,
                        fontFamily: "monospace",
                      }}
                    >
                      {rule.rule_id.length > 36 ? `${rule.rule_id.slice(0, 36)}…` : rule.rule_id}
                    </td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>
                      {rule.action_type}
                    </td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>
                      {rule.rule_family ?? "—"}
                    </td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>
                      <button type="button" className="btn-ghost" onClick={() => setRuleDetail(rule)} title="Full rule id, trigger, and payload">
                        Info
                      </button>
                    </td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>
                      <button type="button" className="btn-ghost" onClick={() => retireRule(rule)}>
                        Retire
                      </button>
                    </td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>
                      <button type="button" className="btn-ghost" onClick={() => eraseRule(rule)} title="Hard-delete this rule row">
                        Erase
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Pending Rules ({pending.length})</h3>
          {pending.length === 0 ? (
            <p style={{ color: "#888" }}>No pending rules.</p>
          ) : (
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }}>
                    Rule ID
                  </th>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }}>
                    Action
                  </th>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }}>
                    Info
                  </th>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }} />
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid var(--border)" }} />
                </tr>
              </thead>
              <tbody>
                {pending.map((rule) => (
                  <tr key={rule.rule_id}>
                    <td
                      style={{
                        padding: "4px 8px",
                        borderBottom: "1px solid var(--border)",
                        fontSize: 11,
                        fontFamily: "monospace",
                      }}
                    >
                      {rule.rule_id.length > 36 ? `${rule.rule_id.slice(0, 36)}…` : rule.rule_id}
                    </td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>
                      {rule.action_type}
                    </td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>
                      <button type="button" className="btn-ghost" onClick={() => setRuleDetail(rule)} title="What this rule does before you apply">
                        Info
                      </button>
                    </td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>
                      <button type="button" className="btn-primary" onClick={() => applyRule(rule)}>
                        Apply
                      </button>
                    </td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>
                      <button type="button" className="btn-ghost" onClick={() => eraseRule(rule)} title="Hard-delete this rule row">
                        Erase
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {loading && <div style={{ marginTop: 16, textAlign: "center", color: "#888" }}>Loading rules...</div>}

      {ruleDetail ? <RuleDetailModal rule={ruleDetail} onClose={() => setRuleDetail(null)} /> : null}
    </div>
  );
}
