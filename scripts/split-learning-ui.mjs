import fs from "node:fs";
import path from "node:path";

const root = path.resolve("apps/review/src");
const sectionsPath = path.join(root, "components/learning/LearningSections.tsx");
const s = fs.readFileSync(sectionsPath, "utf8");

const fnStart = s.indexOf("export default function LearningPage");
const fnBodyStart = s.indexOf("{", fnStart) + 1;
const returnStart = s.indexOf("\n  return (\n", fnBodyStart);
const beforeFn = s.slice(0, fnStart);
const returnBlock = s.slice(returnStart);

const providerImports = `"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useReviewProject } from "@/components/ReviewProjectContext";
import type { LearningRule } from "@/lib/learning/types";

`;

const helpersPart = beforeFn.replace(/^"use client";\n\n/, "");
fs.writeFileSync(path.join(root, "lib/learning/helpers.ts"), helpersPart);

const stateBlock = s.slice(fnBodyStart, returnStart);

const provider = `${providerImports}
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
${stateBlock}
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
`;

fs.writeFileSync(path.join(root, "components/learning/LearningProjectProvider.tsx"), provider);

const sectionsOut = `"use client";

import { Fragment } from "react";
import Link from "next/link";
import type { LearningSectionId } from "@/lib/learning/types";
import { RuleDetailModal } from "@/components/learning/RuleDetailModal";
import {
  asStringList,
  buildLlmReviewsCompiledMarkdown,
  buildLlmReviewsRepoAgentPrompt,
  buildNotesOnlyGuidelinesPrompt,
  copyTaskIdToClipboard,
  llmCodingAgentMarkdownOnly,
  mintAboveThresholdForScore,
  mintBelowThresholdForScore,
  splitEngineeringMarkdown,
} from "@/lib/learning/helpers";
import { useLearningProject } from "@/components/learning/LearningProjectProvider";

export function LearningSectionContent({ section }: { section: LearningSectionId }) {
  const ctx = useLearningProject();
  const {
    project, navHref, loading, active, pending, analysisResult, running, editorialNotes, notesBusy,
    csvStatus, mappingJson, setMappingJson, contextPreview, observations, transparency, llmBusy, llmResult,
    llmReviews, llmLimit, setLlmLimit, llmMintBelow, setLlmMintBelow, llmMintAbove, setLlmMintAbove,
    llmForceRereview, setLlmForceRereview, llmMintBusy, llmMintStatus, expandedLlmReviewId,
    setExpandedLlmReviewId, operatorHintDrafts, setOperatorHintDrafts, llmRowActionBusy, llmRowActionMsg,
    llmCompiledBrief, setLlmCompiledBrief, llmRepoAgentPrompt, setLlmRepoAgentPrompt, obsLogFilter,
    setObsLogFilter, expandedObservationId, setExpandedObservationId, persistEngineeringInsight,
    setPersistEngineeringInsight, llmNotesSynthesis, setLlmNotesSynthesis, autoCreatePerformanceRules,
    setAutoCreatePerformanceRules, ruleDetail, setRuleDetail, copyHint, flashCopy, copyEditorialExport,
    filteredObservations, loadEditorialNotes, fetchObservations, runAnalysis, loadContextPreview,
    runLlmApprovalReview, mintHintsFromLastRun, mintLlmRowHints, submitOperatorLlmHint, applyRule,
    dropRule, dropAllPending, eraseRule, eraseRulesAll, uploadCsv,
  } = ctx;
${returnBlock.replace(
  '<div className="learning-root">',
  '<div>'
).replace(
  /      <header className="learning-hero">[\s\S]*?      <\/header>\n\n/,
  ""
)}
`;

// Wrap sections with conditionals - marker-based surgery
let out = sectionsOut;
const markers = [
  { id: "analyzers", start: '<section className="learning-section">\n        <div className="learning-section-head">\n          <h3>\n            <span className="pill">1 · Editorial</span>', end: "      </section>\n\n      <section className=\"learning-section\">\n        <div className=\"learning-section-head\">\n          <h3>\n            <span className=\"pill\">2 · LLM review</span>" },
];
// Simpler: wrap major blocks manually in output file - for now use section checks at key points via replace

out = out.replace(
  '      <section className="learning-section">\n        <div className="learning-section-head">\n          <h3>\n            <span className="pill">1 · Editorial</span>',
  '      {(section === "analyzers") && <section className="learning-section">\n        <div className="learning-section-head">\n          <h3>\n            <span className="pill">Editorial</span>'
);
out = out.replace(
  '      </section>\n\n      <section className="learning-section">\n        <div className="learning-section-head">\n          <h3>\n            <span className="pill">2 · LLM review</span>',
  '      </section>}\n\n      {(section === "analyzers") && <section className="learning-section">\n        <div className="learning-section-head">\n          <h3>\n            <span className="pill">Nemotron review</span>'
);
out = out.replace(
  '      </section>\n\n      {llmReviews.length > 0 && (\n        <section id="llm-reviews"',
  '      </section>}\n\n      {(section === "reviews") && llmReviews.length > 0 && (\n        <section id="llm-reviews"'
);
out = out.replace(
  '      <form className="learning-section" onSubmit={uploadCsv}>',
  '      {(section === "analyzers") && <form className="learning-section" onSubmit={uploadCsv}>'
);
out = out.replace(
  '      </form>\n\n      {contextPreview && (',
  '      </form>}\n\n      {(section === "context") && contextPreview && ('
);
out = out.replace(
  '      {analysisResult && (',
  '      {(section === "analyzers") && analysisResult && ('
);
out = out.replace(
  '      {observations.length > 0 && (\n        <section className="learning-section" id="learning-observations-log"',
  '      {(section === "observatory") && observations.length > 0 && (\n        <section className="learning-section" id="learning-observations-log"'
);
out = out.replace(
  '      <section id="learning-rules" className="learning-section">',
  '      {(section === "inbox") && <section id="learning-rules" className="learning-section">'
);
out = out.replace(
  '      </section>\n\n      {loading && (',
  '      </section>}\n\n      {loading && section === "inbox" && ('
);
out = out.replace(
  '{transparency && (\n        <details className="learning-accordion">',
  '{false && transparency && (\n        <details className="learning-accordion">'
);
out = out.replace(
  "export default function LearningPage",
  "export function __unused"
);

out = out.replace(/\}\s*$/, "}\n");

fs.writeFileSync(sectionsPath, out);
console.log("split complete");
