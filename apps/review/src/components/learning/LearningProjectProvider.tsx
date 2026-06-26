"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useReviewProject } from "@/components/ReviewProjectContext";
import type { LearningRule } from "@/lib/learning/types";
import { copyToClipboard, mintAboveThresholdForScore, mintBelowThresholdForScore } from "@/lib/learning/helpers";


export type LearningProjectContextValue = {
  project: string;
  setProject: (p: string) => void;
  navHref: (href: string) => string;
  rules: LearningRule[];
  loading: boolean;
  active: LearningRule[];
  pending: LearningRule[];
  analysisResult: Record<string, unknown> | null;
  running: boolean;
  editorialNotes: Record<string, unknown> | null;
  notesBusy: boolean;
  csvStatus: string | null;
  setCsvStatus: (s: string | null) => void;
  mappingJson: string;
  setMappingJson: (s: string) => void;
  contextPreview: Record<string, unknown> | null;
  observations: Record<string, unknown>[];
  transparency: Record<string, unknown> | null;
  llmBusy: boolean;
  llmResult: Record<string, unknown> | null;
  llmReviews: Record<string, unknown>[];
  llmLimit: number;
  setLlmLimit: (n: number) => void;
  llmMintBelow: string;
  setLlmMintBelow: (s: string) => void;
  llmMintAbove: string;
  setLlmMintAbove: (s: string) => void;
  llmForceRereview: boolean;
  setLlmForceRereview: (b: boolean) => void;
  llmMintBusy: boolean;
  llmMintStatus: string | null;
  expandedLlmReviewId: string | null;
  setExpandedLlmReviewId: (id: string | null) => void;
  operatorHintDrafts: Record<string, string>;
  setOperatorHintDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  llmRowActionBusy: string | null;
  llmRowActionMsg: string | null;
  llmCompiledBrief: string | null;
  setLlmCompiledBrief: (s: string | null) => void;
  llmRepoAgentPrompt: string | null;
  setLlmRepoAgentPrompt: (s: string | null) => void;
  obsLogFilter: "all" | "llm_review" | "llm_upstream_recommendation" | "other";
  setObsLogFilter: (f: "all" | "llm_review" | "llm_upstream_recommendation" | "other") => void;
  expandedObservationId: string | null;
  setExpandedObservationId: (id: string | null) => void;
  persistEngineeringInsight: boolean;
  setPersistEngineeringInsight: (b: boolean) => void;
  llmNotesSynthesis: boolean;
  setLlmNotesSynthesis: (b: boolean) => void;
  autoCreatePerformanceRules: boolean;
  setAutoCreatePerformanceRules: (b: boolean) => void;
  ruleDetail: LearningRule | null;
  setRuleDetail: (r: LearningRule | null) => void;
  copyHint: string | null;
  flashCopy: (msg: string) => void;
  copyEditorialExport: (label: string, text: string) => Promise<void>;
  filteredObservations: Record<string, unknown>[];
  snapshotEntries: Array<[string, unknown]>;
  loadEditorialNotes: (windowDays: number) => Promise<void>;
  fetchObservations: () => Promise<void>;
  runAnalysis: (action: "editorial" | "market") => Promise<void>;
  loadContextPreview: () => Promise<void>;
  runLlmApprovalReview: () => Promise<void>;
  mintHintsFromLastRun: () => Promise<void>;
  mintLlmRowHints: (reviewId: string, kind: "below" | "above") => Promise<void>;
  submitOperatorLlmHint: (reviewId: string) => Promise<void>;
  applyRule: (rule: LearningRule) => Promise<void>;
  dropRule: (rule: LearningRule) => Promise<void>;
  dropAllPending: () => Promise<void>;
  eraseRule: (rule: LearningRule) => Promise<void>;
  eraseRulesAll: (status?: string) => Promise<void>;
  uploadCsv: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
};

const LearningProjectContext = createContext<LearningProjectContextValue | null>(null);

export function useLearningProject(): LearningProjectContextValue {
  const ctx = useContext(LearningProjectContext);
  if (!ctx) throw new Error("useLearningProject must be used within LearningProjectProvider");
  return ctx;
}

export function LearningProjectProvider({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const { navHref, ready, multiProject, lockedSlug, activeProjectSlug } = useReviewProject();
  const projectFromUrl = searchParams.get("project")?.trim() ?? "";
  const scopedProject =
    projectFromUrl || (multiProject ? activeProjectSlug : lockedSlug) || "SNS";
  const [project, setProject] = useState(scopedProject);
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
  const [llmCompiledBrief, setLlmCompiledBrief] = useState<string | null>(null);
  const [llmRepoAgentPrompt, setLlmRepoAgentPrompt] = useState<string | null>(null);
  const [obsLogFilter, setObsLogFilter] = useState<"all" | "llm_review" | "llm_upstream_recommendation" | "other">(
    "all"
  );
  const [expandedObservationId, setExpandedObservationId] = useState<string | null>(null);
  const [persistEngineeringInsight, setPersistEngineeringInsight] = useState(true);
  const [llmNotesSynthesis, setLlmNotesSynthesis] = useState(true);
  const [autoCreatePerformanceRules, setAutoCreatePerformanceRules] = useState(false);
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
      `/api/learning?project=${encodeURIComponent(project)}&section=llm_approval_reviews&limit=150`
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
    const res = await fetch(`/api/learning?project=${encodeURIComponent(project)}&section=observations&limit=200`);
    if (res.ok) {
      const json = await res.json();
      setObservations(json.observations ?? []);
    }
  }, [project]);

  const filteredObservations = useMemo(() => {
    if (obsLogFilter === "all") return observations;
    return observations.filter((o) => {
      const st = String(o.source_type ?? "");
      if (obsLogFilter === "llm_review") return st === "llm_review";
      if (obsLogFilter === "llm_upstream_recommendation") return st === "llm_upstream_recommendation";
      return st !== "llm_review" && st !== "llm_upstream_recommendation";
    });
  }, [observations, obsLogFilter]);

  useEffect(() => {
    if (!ready) return;
    const next =
      projectFromUrl || (multiProject ? activeProjectSlug : lockedSlug) || "SNS";
    setProject((prev) => (prev === next ? prev : next));
  }, [ready, projectFromUrl, multiProject, activeProjectSlug, lockedSlug]);

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
      if (action === "market") {
        body.auto_create_rules = autoCreatePerformanceRules;
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

  const loadContextPreview = useCallback(async () => {
    const res = await fetch(`/api/learning?project=${encodeURIComponent(project)}&section=context`);
    if (res.ok) setContextPreview(await res.json());
  }, [project]);

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
      const trimmedBelow = llmMintBelow.trim();
      if (trimmedBelow !== "") {
        const n = parseFloat(trimmedBelow);
        if (!Number.isNaN(n)) body.mint_pending_hints_below_score = n;
      }
      const trimmedAbove = llmMintAbove.trim();
      if (trimmedAbove !== "") {
        const n = parseFloat(trimmedAbove);
        if (!Number.isNaN(n)) body.mint_positive_hints_above_score = n;
      }
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

  const dropRule = async (rule: LearningRule) => {
    const slug = rule.storage_project_slug ?? project;
    if (rule.status === "active") {
      const ok = window.confirm(
        `Drop active rule "${rule.rule_id}"?\n\nIt will be deactivated (expired) and stop affecting planning/generation.`
      );
      if (!ok) return;
    }
    const res = await fetch("/api/learning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss_rule", storage_project: slug, rule_id: rule.rule_id }),
    });
    if (res.ok) {
      flashCopy(rule.status === "pending" ? "Rule dropped — it will not apply." : "Rule deactivated.");
      fetchRules();
    }
  };

  const dropAllPending = async () => {
    if (pending.length === 0) return;
    const ok = window.confirm(
      `Drop all ${pending.length} pending rule(s) for "${project}"?\n\nThey will not apply. Rows are kept as rejected for audit.`
    );
    if (!ok) return;
    const res = await fetch("/api/learning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss_pending", storage_project: project }),
    });
    if (res.ok) {
      const j = (await res.json().catch(() => ({}))) as { dismissed?: number };
      flashCopy(`Dropped ${j.dismissed ?? pending.length} pending rule(s).`);
      fetchRules();
    }
  };

  const eraseRule = async (rule: LearningRule) => {
    const slug = rule.storage_project_slug ?? project;
    const ok = window.confirm(
      `Permanently erase rule "${rule.rule_id}"?\n\nThis deletes the row from project "${slug}".\n(Use Drop to dismiss without deleting.)`
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
      `Erase ${label} for project "${slug}"?\n\nThis permanently deletes rows from Core.\n(Use Drop all pending for a soft dismiss.)`
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

  const snapshotEntries: Array<[string, unknown]> =
    transparency &&
    transparency.snapshot != null &&
    typeof transparency.snapshot === "object" &&
    !Array.isArray(transparency.snapshot)
      ? Object.entries(transparency.snapshot as Record<string, unknown>)
      : [];

  const value: LearningProjectContextValue = {
    project, setProject, navHref, rules, loading, active, pending, analysisResult, running,
    editorialNotes, notesBusy, csvStatus, setCsvStatus, mappingJson, setMappingJson, contextPreview,
    observations, transparency, llmBusy, llmResult, llmReviews, llmLimit, setLlmLimit, llmMintBelow,
    setLlmMintBelow, llmMintAbove, setLlmMintAbove, llmForceRereview, setLlmForceRereview, llmMintBusy,
    llmMintStatus, expandedLlmReviewId, setExpandedLlmReviewId, operatorHintDrafts, setOperatorHintDrafts,
    llmRowActionBusy, llmRowActionMsg, llmCompiledBrief, setLlmCompiledBrief, llmRepoAgentPrompt,
    setLlmRepoAgentPrompt, obsLogFilter, setObsLogFilter, expandedObservationId, setExpandedObservationId,
    persistEngineeringInsight, setPersistEngineeringInsight, llmNotesSynthesis, setLlmNotesSynthesis,
    autoCreatePerformanceRules, setAutoCreatePerformanceRules, ruleDetail, setRuleDetail, copyHint, flashCopy,
    copyEditorialExport, filteredObservations, snapshotEntries, loadEditorialNotes, fetchObservations,
    runAnalysis, loadContextPreview, runLlmApprovalReview, mintHintsFromLastRun, mintLlmRowHints,
    submitOperatorLlmHint, applyRule, dropRule, dropAllPending, eraseRule, eraseRulesAll, uploadCsv,
  };
  return <LearningProjectContext.Provider value={value}>{children}</LearningProjectContext.Provider>;
}
