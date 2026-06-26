"use client";

import { Fragment } from "react";
import Link from "next/link";
import { taskReviewHref } from "@/lib/task-links";
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
    csvStatus, mappingJson, setMappingJson, contextPreview, observations, llmBusy, llmResult,
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

  return (
    <div>
      {(section === "analyzers") && <section className="learning-section">
        <div className="learning-section-head">
          <h3>
            <span className="pill">Editorial</span> Editorial analysis &amp; market signals
          </h3>
          <p>
            Turn reviewer history into pending <strong>GENERATION_GUIDANCE</strong> rules. Editorial analysis
            mines <code>editorial_reviews</code> (decisions, tags, overrides) and — when OpenAI synthesis is on —
            converts free-text reviewer notes into structured themes, actions, and a coding-agent brief. Performance
            analysis aggregates ingested platform metrics into the global observatory; project rule suggestions are opt-in.
          </p>
        </div>

        <div className="learning-inline-options">
          <label>
            <input
              type="checkbox"
              checked={persistEngineeringInsight}
              onChange={(e) => setPersistEngineeringInsight(e.target.checked)}
              style={{ width: "auto" }}
            />
            Save engineering brief to Core (<code>learning_insights</code>, scope <code>engineering</code>)
          </label>
          <label>
            <input
              type="checkbox"
              checked={llmNotesSynthesis}
              onChange={(e) => setLlmNotesSynthesis(e.target.checked)}
              style={{ width: "auto" }}
            />
            Run <strong>OpenAI</strong> on reviewer <code>notes</code> (themes + actions, merged into brief)
          </label>
          <label>
            <input
              type="checkbox"
              checked={autoCreatePerformanceRules}
              onChange={(e) => setAutoCreatePerformanceRules(e.target.checked)}
              style={{ width: "auto" }}
            />
            Performance analysis: also mint <strong>pending project rules</strong> (default off — observatory only)
          </label>
        </div>

        <div className="learning-action-bar">
          <button
            className="btn-primary"
            onClick={() => runAnalysis("editorial")}
            disabled={running}
            title="Analyzes human review history (APPROVED / NEEDS_EDIT / REJECTED, tags, overrides) and proposes pending learning rules that can improve future ranking/volume decisions."
          >
            {running ? "Running…" : "Run editorial analysis"}
          </button>
          <button
            className="btn-primary"
            onClick={() => runAnalysis("market")}
            disabled={running}
            title="Analyzes ingested social performance metrics and writes a caf-global observatory observation. Enable the checkbox above to also mint pending project rules."
          >
            {running ? "Running…" : "Run performance analysis"}
          </button>
          <Link href="/learning/context" className="btn-ghost" style={{ textDecoration: "none" }}>
            Context preview
          </Link>
        </div>
      </section>}

      {(section === "analyzers") && <section className="learning-section">
        <div className="learning-section-head">
          <h3>
            <span className="pill">Nemotron review</span> LLM review (approved content only)
          </h3>
          <p>
            Runs <strong>Nemotron VL</strong> on jobs whose <strong>latest</strong> editorial decision is APPROVED. Sends
            rendered image URLs when present, plus hook, caption, slides, and video frames. Writes TP-parity{" "}
            <code>output_insights_json</code> to Core, emits a global observatory row, and{" "}
            <strong>creates pending GENERATION_GUIDANCE rules immediately</strong> when scores cross thresholds
            (Core defaults: improvement if overall &lt; 0.75 with bullets; strengths if overall ≥ 0.85 with
            strengths). Leave the threshold fields blank to use those defaults, or override. On Core, carousel
            primary generation also reuses recent rows here as an <strong>anti-repetition lane memory</strong>{" "}
            (hook/caption/slide fingerprints for the same flow + platform; configure{" "}
            <code>LLM_APPROVAL_ANTI_REPETITION_MAX_CHARS</code> /{" "}
            <code>LLM_APPROVAL_ANTI_REPETITION_MAX_JOBS</code>, set to <code>0</code> to disable).
          </p>
        </div>

        <div className="learning-inline-options">
          <label>
            Batch size
            <input
              type="number"
              min={1}
              max={20}
              value={llmLimit}
              onChange={(e) => setLlmLimit(parseInt(e.target.value, 10) || 3)}
              style={{ width: 64, padding: "4px 8px" }}
            />
          </label>
          <label>
            Improvement rules if score &lt;
            <input
              placeholder="0.75"
              value={llmMintBelow}
              onChange={(e) => setLlmMintBelow(e.target.value)}
              style={{ width: 64, padding: "4px 8px" }}
            />
            <span style={{ color: "var(--muted)" }}>(blank = Core default)</span>
          </label>
          <label>
            Strength rules if score ≥
            <input
              placeholder="0.85"
              value={llmMintAbove}
              onChange={(e) => setLlmMintAbove(e.target.value)}
              style={{ width: 64, padding: "4px 8px" }}
            />
            <span style={{ color: "var(--muted)" }}>(blank = Core default)</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={llmForceRereview}
              onChange={(e) => setLlmForceRereview(e.target.checked)}
              style={{ width: "auto" }}
            />
            Force re-review (ignore 7-day skip)
          </label>
        </div>

        <div className="learning-action-bar">
          <button
            type="button"
            className="btn-primary"
            onClick={runLlmApprovalReview}
            disabled={llmBusy}
            title="Runs an LLM QA pass on approved jobs; Core writes reviews and pending GENERATION_GUIDANCE rules when score thresholds match."
          >
            {llmBusy ? "Running LLM review…" : "Run LLM review (approved)"}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={mintHintsFromLastRun}
            disabled={llmMintBusy || !llmResult}
            title="Creates pending GENERATION_GUIDANCE rules from the last run: improvement bullets when score is below the first threshold, and strength bullets when score is at or above the second."
          >
            {llmMintBusy ? "Minting…" : "Mint pending hints from results"}
          </button>
        </div>

        {llmMintStatus ? <p className="learning-copy-hint">{llmMintStatus}</p> : null}
        {llmResult && (
          <details style={{ marginTop: 4 }}>
            <summary style={{ fontSize: 12, cursor: "pointer", color: "var(--muted)" }}>
              Raw run result JSON
            </summary>
            <pre
              style={{
                marginTop: 8,
                fontSize: 11,
                maxHeight: 220,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                background: "var(--bg)",
                padding: 10,
                borderRadius: 8,
                border: "1px solid var(--border)",
              }}
            >
              {JSON.stringify(llmResult, null, 2)}
            </pre>
          </details>
        )}
      </section>}

      {(section === "reviews") && (
        llmReviews.length > 0 ? (
        <section id="llm-reviews" className="learning-section">
          <div className="learning-section-head">
            <h3>
              <span className="pill">3 · Reviews</span> Recent LLM approval reviews ({llmReviews.length})
            </h3>
            <p>
              Read the model’s summary and bullets in place. <strong>Mint fix</strong> /{" "}
              <strong>Mint strengths</strong> turns a row into <strong>pending GENERATION_GUIDANCE</strong> rules
              (then Apply in the rules tables below). <strong>Your guidance</strong> adds a free-text pending rule
              tied to the same review.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 12 }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  setLlmCompiledBrief(buildLlmReviewsCompiledMarkdown(project, llmReviews));
                  setLlmRepoAgentPrompt(buildLlmReviewsRepoAgentPrompt(project, llmReviews));
                  flashCopy("Compiled brief + repo agent prompt — see below");
                }}
                disabled={llmReviews.length === 0}
                title="Deterministic merge: dedupe bullets, frequency counts, sample task_ids, optional upstream_recommendations — paste into Cursor for Core/renderer work."
              >
                Compile all loaded reviews → CAF brief
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => void copyEditorialExport("Merged LLM brief", llmCompiledBrief ?? "")}
                disabled={!llmCompiledBrief}
              >
                Copy compiled brief
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => void copyEditorialExport("Repo agent prompt", llmRepoAgentPrompt ?? "")}
                disabled={!llmRepoAgentPrompt}
                title="Cursor Agent / Claude Code — action checklist with heuristic repo paths"
              >
                Copy repo agent prompt
              </button>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                Fetches up to 150 reviews; table scrolls. Merge + agent prompt are on-device (no extra LLM call).
              </span>
            </div>
            {llmCompiledBrief ? (
              <details open style={{ marginTop: 14 }}>
                <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                  Merged engineering brief (markdown)
                </summary>
                <textarea
                  readOnly
                  aria-label="Merged LLM reviews markdown brief"
                  value={llmCompiledBrief}
                  rows={18}
                  style={{
                    width: "100%",
                    marginTop: 10,
                    fontFamily: "monospace",
                    fontSize: 11,
                    lineHeight: 1.45,
                    padding: 12,
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    resize: "vertical",
                  }}
                />
              </details>
            ) : null}
            {llmRepoAgentPrompt ? (
              <details open style={{ marginTop: 14 }}>
                <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                  Repo agent prompt (Cursor / Claude Code)
                </summary>
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)", maxWidth: 720 }}>
                  Imperative checklist derived from the same reviews: upstream targets first, then high-frequency
                  improvements/weaknesses with heuristic paths. Paste into your agent as the task description.
                </p>
                <textarea
                  readOnly
                  aria-label="Repo agent prompt for CAF-Core"
                  value={llmRepoAgentPrompt}
                  rows={20}
                  style={{
                    width: "100%",
                    marginTop: 10,
                    fontFamily: "monospace",
                    fontSize: 11,
                    lineHeight: 1.45,
                    padding: 12,
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    resize: "vertical",
                  }}
                />
              </details>
            ) : null}
          </div>
          {llmRowActionMsg ? <p className="learning-copy-hint">{llmRowActionMsg}</p> : null}
          <div style={{ maxHeight: "min(70vh, 640px)", overflow: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
          <table className="learning-llm-table">
            <thead>
              <tr>
                <th style={{ width: "38%" }}>task_id</th>
                <th style={{ width: "7%" }}>score</th>
                <th style={{ width: "7%" }}>img</th>
                <th style={{ width: "10%" }}>minted</th>
                <th style={{ width: "14%" }}>when</th>
                <th>actions</th>
              </tr>
            </thead>
            <tbody>
              {llmReviews.map((r) => {
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
                            href={navHref(taskReviewHref("t", tid, project))}
                            className="btn-ghost"
                            style={{ fontSize: 11, padding: "4px 10px", textDecoration: "none" }}
                            title="Human editorial workbench"
                          >
                            Open task
                          </Link>
                          <Link
                            href={navHref(taskReviewHref("content", tid, project))}
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
        </section>
        ) : (
        <section className="learning-section">
          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            No Nemotron approval reviews loaded yet. Run a batch from{" "}
            <Link href="/learning/analyzers">Analyzers</Link>.
          </p>
        </section>
        )
      )}

      {(section === "analyzers") && <form className="learning-section" onSubmit={uploadCsv}>
        <div className="learning-section-head">
          <h3>
            <span className="pill">4 · Ingest</span> Upload social performance CSV
          </h3>
          <p>
            Map platform export columns if needed (JSON). Defaults recognize <code>platform</code>,{" "}
            <code>posted_at</code>, <code>task_id</code>, and metrics. Ingested rows become{" "}
            <code>performance_metrics</code> + observations for the market analyzer.
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <input type="file" name="file" accept=".csv,text/csv" style={{ width: "auto", maxWidth: 320 }} />
          <button
            type="submit"
            className="btn-primary"
            title="Uploads a social platform export CSV, maps columns to CAF metrics, writes performance_metrics rows, and creates an observation for learning/analysis."
          >
            Upload &amp; ingest
          </button>
        </div>
        <textarea
          placeholder='Optional mapping JSON, e.g. {"platform":"Channel","posted_at":"Date","likes":"Likes"}'
          value={mappingJson}
          onChange={(e) => setMappingJson(e.target.value)}
          rows={2}
          style={{ fontFamily: "monospace", fontSize: 12 }}
        />
        {csvStatus && <p className="learning-copy-hint" style={{ color: "var(--fg-secondary)" }}>{csvStatus}</p>}
      </form>}

      {(section === "context") && (
        <section className="learning-section">
          <div className="learning-section-head">
            <h3>
              <span className="pill pill-ok">preview</span> Compiled context preview
            </h3>
            <p>
              What Core injects into generation prompts for this project right now (global → project overlay).
              Active rules from <Link href="/learning/inbox">Inbox</Link> merge here at generation time.
            </p>
          </div>
          <button type="button" className="btn-primary" onClick={() => void loadContextPreview()}>
            Load context preview
          </button>
          {contextPreview ? (
          <pre
            style={{
              fontSize: 12,
              maxHeight: 320,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              background: "var(--bg)",
              padding: 12,
              borderRadius: 8,
              border: "1px solid var(--border)",
            }}
          >
            {JSON.stringify(contextPreview, null, 2)}
          </pre>
          ) : (
            <p style={{ marginTop: 12, fontSize: 13, color: "var(--muted)" }}>Click load to fetch the merged guidance block.</p>
          )}
        </section>
      )}

      {(section === "analyzers") && analysisResult && (
        <section className="learning-section">
          <div className="learning-section-head">
            <h3>
              <span className="pill">5 · Analysis</span> Last analysis result
            </h3>
            <p>
              One-click export for Claude / Cursor — triggers, workflow, and the OpenAI synthesis block all
              together, plus a raw reviewer-notes → guidelines prompt below when notes exist for the window.
            </p>
          </div>
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
        </section>
      )}

      {(section === "observatory") && (
        observations.length > 0 ? (
        <section className="learning-section" id="learning-observations-log">
          <div className="learning-section-head">
            <h3>
              <span className="pill pill-ok">log</span> Observations log ({filteredObservations.length}
              {obsLogFilter !== "all" ? ` of ${observations.length}` : ""})
            </h3>
            <p>
              Rows from <code>caf_core.learning_observations</code> (LLM reviews, upstream recs, CSV ingest, etc.).
              Expand a row for full JSON. Use the filter to focus on post-approval reviews or upstream signals.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 10 }}>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>
                Filter by source
                <select
                  value={obsLogFilter}
                  onChange={(e) =>
                    setObsLogFilter(e.target.value as "all" | "llm_review" | "llm_upstream_recommendation" | "other")
                  }
                  style={{
                    marginLeft: 8,
                    padding: "4px 8px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                    color: "var(--fg)",
                    fontSize: 12,
                  }}
                >
                  <option value="all">All sources</option>
                  <option value="llm_review">llm_review</option>
                  <option value="llm_upstream_recommendation">llm_upstream_recommendation</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <button type="button" className="btn-ghost" onClick={() => void fetchObservations()} style={{ fontSize: 12 }}>
                Refresh log
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() =>
                  void copyEditorialExport(
                    "Observations JSON",
                    JSON.stringify(filteredObservations, null, 2)
                  )
                }
                style={{ fontSize: 12 }}
              >
                Copy filtered rows (JSON)
              </button>
            </div>
          </div>
          <div style={{ maxHeight: "min(65vh, 520px)", overflow: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: "var(--card)", zIndex: 1 }}>
                <tr>
                  <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid var(--border)" }}>When</th>
                  <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid var(--border)" }}>Type</th>
                  <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid var(--border)" }}>Source</th>
                  <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid var(--border)" }}>Flow / platform</th>
                  <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid var(--border)" }}>Entity</th>
                  <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid var(--border)", width: 90 }}>
                    Payload
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredObservations.map((o, obsIdx) => {
                  const oid = String(o.observation_id ?? (o as { id?: string }).id ?? `obs-row-${obsIdx}`);
                  const open = expandedObservationId === oid;
                  return (
                    <Fragment key={oid}>
                      <tr>
                        <td style={{ padding: 8, borderBottom: "1px solid var(--border)", color: "var(--muted)", whiteSpace: "nowrap" }}>
                          {String(o.observed_at ?? "").slice(0, 19).replace("T", " ")}
                        </td>
                        <td style={{ padding: 8, borderBottom: "1px solid var(--border)", fontFamily: "monospace", fontSize: 11 }}>
                          {String(o.observation_type)}
                        </td>
                        <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{String(o.source_type)}</td>
                        <td style={{ padding: 8, borderBottom: "1px solid var(--border)", color: "var(--fg-secondary)" }}>
                          {[o.flow_type, o.platform].filter(Boolean).join(" · ") || "—"}
                        </td>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: "1px solid var(--border)",
                            fontFamily: "monospace",
                            fontSize: 10,
                            wordBreak: "break-all",
                            maxWidth: 220,
                          }}
                        >
                          {o.entity_ref != null && String(o.entity_ref).trim() !== "" ? String(o.entity_ref) : "—"}
                        </td>
                        <td style={{ padding: 8, borderBottom: "1px solid var(--border)", verticalAlign: "top" }}>
                          <button
                            type="button"
                            className="btn-ghost"
                            style={{ fontSize: 11, padding: "4px 8px" }}
                            onClick={() => setExpandedObservationId(open ? null : oid)}
                          >
                            {open ? "Hide" : "JSON"}
                          </button>
                        </td>
                      </tr>
                      {open ? (
                        <tr>
                          <td colSpan={6} style={{ padding: "0 10px 12px", background: "var(--bg-secondary)" }}>
                            <pre
                              style={{
                                margin: 0,
                                padding: 10,
                                fontSize: 11,
                                maxHeight: 280,
                                overflow: "auto",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                                borderRadius: 6,
                                border: "1px solid var(--border)",
                              }}
                            >
                              {JSON.stringify(o, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        ) : (
        <section className="learning-section">
          <p style={{ color: "var(--muted)", fontSize: 13 }}>No project observations yet. Run an analyzer or ingest CSV metrics.</p>
        </section>
        )
      )}

      {(section === "inbox") && <section id="learning-rules" className="learning-section">
        <div className="learning-section-head">
          <h3>
            <span className="pill">6 · Rules</span> Active &amp; pending rules
          </h3>
          <p>
            Rules live in <code>caf_core.learning_rules</code> and drive ranking / volume / generation guidance
            at run time. <strong>Pending</strong> rules need <strong>Apply</strong> or <strong>Drop</strong> — dropped
            rules are kept as <code>rejected</code> and never affect runs. Click Info before applying.
          </p>
        </div>
        <div className="learning-action-bar" style={{ marginBottom: 14 }}>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => void dropAllPending()}
            disabled={pending.length === 0}
          >
            Drop all pending
          </button>
          <button type="button" className="btn-ghost" onClick={() => eraseRulesAll("pending")}>
            Erase pending (permanent)
          </button>
          <button type="button" className="btn-ghost" onClick={() => eraseRulesAll("any")}>
            Erase all rules
          </button>
        </div>
        <div className="learning-rules-grid">
          <div>
            <div className="learning-section-head" style={{ marginBottom: 10 }}>
              <h3 style={{ fontSize: 14 }}>
                <span className="pill pill-ok">active</span> Active ({active.length})
              </h3>
            </div>
            {active.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>No active learning rules yet.</p>
            ) : (
              <table className="learning-rule-table">
                <thead>
                  <tr>
                    <th>Rule ID</th>
                    <th>Action</th>
                    <th>Family</th>
                    <th />
                    <th />
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {active.map((rule) => (
                    <tr key={rule.rule_id}>
                      <td className="learning-rule-id">
                        {rule.rule_id.length > 28 ? `${rule.rule_id.slice(0, 28)}…` : rule.rule_id}
                      </td>
                      <td>
                        <span
                          className={`learning-action-badge${
                            rule.rule_family === "generation" ? " family-generation" : rule.rule_family === "ranking" ? " family-ranking" : ""
                          }`}
                        >
                          {rule.action_type}
                        </span>
                      </td>
                      <td style={{ color: "var(--fg-secondary)", fontSize: 12 }}>{rule.rule_family ?? "—"}</td>
                      <td>
                        <button type="button" className="btn-ghost" onClick={() => setRuleDetail(rule)} title="Full rule id, trigger, and payload">
                          Info
                        </button>
                      </td>
                      <td>
                        <button type="button" className="btn-ghost" onClick={() => void dropRule(rule)} title="Deactivate this rule">
                          Drop
                        </button>
                      </td>
                      <td>
                        <button type="button" className="btn-ghost" onClick={() => eraseRule(rule)} title="Permanently delete this rule row">
                          Erase
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <div className="learning-section-head" style={{ marginBottom: 10 }}>
              <h3 style={{ fontSize: 14 }}>
                <span className="pill pill-warn">pending</span> Pending ({pending.length})
              </h3>
            </div>
            {pending.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>No pending rules.</p>
            ) : (
              <table className="learning-rule-table">
                <thead>
                  <tr>
                    <th>Rule ID</th>
                    <th>Action</th>
                    <th />
                    <th />
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pending.map((rule) => (
                    <tr key={rule.rule_id}>
                      <td className="learning-rule-id">
                        {rule.rule_id.length > 28 ? `${rule.rule_id.slice(0, 28)}…` : rule.rule_id}
                      </td>
                      <td>
                        <span
                          className={`learning-action-badge${
                            rule.rule_family === "generation" ? " family-generation" : rule.rule_family === "ranking" ? " family-ranking" : ""
                          }`}
                        >
                          {rule.action_type}
                        </span>
                      </td>
                      <td>
                        <button type="button" className="btn-ghost" onClick={() => setRuleDetail(rule)} title="What this rule does before you apply">
                          Info
                        </button>
                      </td>
                      <td>
                        <button type="button" className="btn-primary" onClick={() => applyRule(rule)}>
                          Apply
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => void dropRule(rule)}
                          title="Dismiss — rule will not apply (kept as rejected)"
                        >
                          Drop
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>}

      {loading && section === "inbox" && (
        <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, marginTop: 4 }}>Loading rules…</p>
      )}

      {ruleDetail ? (
        <RuleDetailModal
          rule={ruleDetail}
          onClose={() => setRuleDetail(null)}
          onDrop={(r) => void dropRule(r)}
          onApply={(r) => void applyRule(r)}
        />
      ) : null}
    </div>
  );
}
