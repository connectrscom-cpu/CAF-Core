/** Shared Admin UI: glossary, CSS snippet, and tooltip/options-menu JS. */

export type AdminPromptLabsTab =
  | "Processing"
  | "Creation"
  | "Validation"
  | "Learning"
  | "HeyGen agent"
  | "Planning";

/** Hover title for buttons/steps that trigger an LLM call. */
export function adminLlmPromptTitle(
  promptName: string,
  promptLabsTab: AdminPromptLabsTab,
  note?: string
): string {
  const base = `Prompt: ${promptName} · Layer: ${promptLabsTab} · Find in Prompt Labs → ${promptLabsTab} tab`;
  return note ? `${base} · ${note}` : base;
}

/** Safe for HTML title="…" attributes. */
export function adminLlmPromptTitleAttr(
  promptName: string,
  promptLabsTab: AdminPromptLabsTab,
  note?: string
): string {
  return adminLlmPromptTitle(promptName, promptLabsTab, note)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export const ADMIN_CAF_GLOSSARY: Record<string, string> = {
  evidence:
    "Scraped rows from your INPUTS workbook (typically 9–10 platform sheets). Raw social and web content before analysis.",
  insights:
    "LLM analysis of evidence — patterns, hooks, top-performer findings, and strategic opportunities.",
  ideas:
    "Curated content concepts built during Processing (ideas_json). Fed into a signal pack before any run exists.",
  jobs:
    "Executable content units (content_jobs) created when you Start a run — planned from signal pack ideas × enabled flows.",
  signalPack:
    "Research bundle: curated ideas (ideas_json), visual guidelines, hashtags, and derived globals. Attached when you create a run.",
  run: "One execution cycle for a project, tied to a signal pack. Starting a run creates jobs from pack ideas.",
  runOutputs: "Post-run artifacts: exports, content log, and output review.",
  plannedJobs:
    "Jobs selected from the signal pack for a run before planning and generation start.",
  ideaPickingRules:
    "Include every idea in the signal pack. Each idea becomes a planner row using deterministic rules (format, confidence, platform, creative-intel boost) — no LLM selection at this step.",
  ideaPickingLlm:
    "OpenAI selects ideas using project strategy, brand constraints, and product config — up to every idea in the pack (same ceiling as automated rules).",
  ideaPickingManual:
    "You choose which pack ideas become planner rows on Planned jobs before Start.",
  processing:
    "Filter evidence, generate insights, build ideas, and compile a signal pack from an import.",
  inputs:
    "Evidence for this project. Upload INPUTS workbooks (.xlsx) or run Apify scrapers from the Sources + Scrapers tabs. Both paths write the same evidence import shape for Processing.",
  inputSources:
    "Project source registry (accounts, subreddits, blogs, hashtags) — synced from workbook or edited in Inputs → Sources. Scrapers read enabled rows per platform.",
  filterEvidence:
    "Step 2: Score and filter scraped rows with profile gates + cutoff (0–1). No LLM — only deterministic rules.",
  evidenceFunnel:
    "How many rows remain after each gate for the selected platform tab.",
  funnelTotal: "All evidence rows for this platform in the import.",
  funnelProfile: "Rows passing profile min score and minimum text length.",
  funnelCutoff: "Rows at or above your cutoff threshold on the blended score.",
  funnelFinal: "Rows that proceed to insights and idea steps (same as cutoff pass).",
  scoreFormula:
    "Weighted blend of normalized features (0–1) per platform. Score = Σ(feature × weight) / Σ(weights). Saved in the processing profile.",
  relativePagePerformance:
    "When on, Instagram/Facebook/TikTok scores use engagement relative to account size (followers) instead of raw likes/plays. Rows without follower data fall back to raw volume weights.",
  profileMinScore: "Hard floor (0–1) before blending — weaker rows drop out of the funnel.",
  minPrimaryTextChars: "Drop rows whose primary caption/body is shorter than this (sparse text).",
  featureWeight: "How much a normalized feature contributes to the blended score.",
  textSignal: "Text-length signal normalized 0–1; often weighted in the blend.",
  activeWeights: "Feature keys and weights currently used for this platform tab.",
  cutoffScore: "Minimum blended score (0–1) for a row to count as included.",
  showBelowCutoff: "Show sub-cutoff rows in the table (dimmed) for inspection.",
  liveFunnel: "Row counts updating live as you move the cutoff slider.",
  normColumn: "Per-feature values scaled 0–1 before weighting.",
  blendColumn: "Each feature’s share of the final blended score.",
  tableFilters: "Search and filter the scored table locally — does not change saved cutoff.",
  displayKind: "Human-readable evidence subtype (e.g. Facebook video, Instagram carousel).",
  includedColumn: "Whether the row passes the current cutoff (yes / no).",
  platformTab: "Switch platform — each tab has its own formula, cutoff, and row set.",
  broadInsights: "LLM text-only analysis (broad_llm) on filtered evidence rows.",
  topPerformers: "Deep analysis on high-rated posts — vision for images/carousels/video.",
  useCutoff: "Only send evidence that passed the cutoff into broad insight runs.",
  rescanInsights: "Re-run LLM even when insight rows already exist for a row.",
  maxInsightRows: "Cap how many evidence rows are sent per broad-insights batch.",
  buildIdeas: "LLM curates an idea list from insights (ideas_json path in Processing).",
  formatCap: "Limit how many ideas of this format go into the signal pack (blank = no cap, 0 = exclude).",
  mimicCaps: "Max planned jobs per mimic flow family when you Start a run (not during Processing).",
};

export function adminCafUiCss(): string {
  return `
.surface-info{background:linear-gradient(135deg,rgba(59,130,246,.14) 0%,rgba(59,130,246,.05) 100%);border-color:rgba(59,130,246,.32)!important}
.surface-success{background:linear-gradient(135deg,rgba(34,197,94,.14) 0%,rgba(34,197,94,.05) 100%);border-color:rgba(34,197,94,.32)!important}
.surface-warn{background:linear-gradient(135deg,rgba(234,179,8,.14) 0%,rgba(234,179,8,.05) 100%);border-color:rgba(234,179,8,.32)!important}
.surface-danger{background:linear-gradient(135deg,rgba(239,68,68,.12) 0%,rgba(239,68,68,.04) 100%);border-color:rgba(239,68,68,.28)!important}
.surface-purple{background:linear-gradient(135deg,rgba(168,85,247,.14) 0%,rgba(168,85,247,.05) 100%);border-color:rgba(168,85,247,.32)!important}
.surface-teal{background:linear-gradient(135deg,rgba(45,212,191,.14) 0%,rgba(45,212,191,.05) 100%);border-color:rgba(45,212,191,.32)!important}
.surface-orange{background:linear-gradient(135deg,rgba(251,146,60,.14) 0%,rgba(251,146,60,.05) 100%);border-color:rgba(251,146,60,.32)!important}
.surface-muted{background:linear-gradient(180deg,var(--surface-2) 0%,var(--surface-3) 100%);border-color:var(--border2)!important}
.caf-page-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
.caf-page-header-left{display:flex;flex-direction:column;gap:6px}
.caf-page-header-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.caf-stat-chips{font-size:12px;color:var(--muted);display:flex;gap:12px;flex-wrap:wrap}
.ph h2,.caf-page-header h2{font-size:20px;font-weight:600;letter-spacing:-.02em;margin:0}
.caf-pipeline-sketch{margin:0;padding:0}
.caf-pipeline-sketch-list{display:flex;flex-wrap:wrap;align-items:center;gap:0;list-style:none;margin:0;padding:0;font-size:11px;line-height:1.35}
.caf-pipeline-sketch-list>li{display:flex;align-items:center;max-width:100%}
.caf-pipeline-sketch-list>li+li::before{content:"›";color:var(--border);padding:0 5px;font-size:10px;user-select:none}
.caf-pipeline-stage{color:var(--muted);text-decoration:none;padding:2px 7px;border-radius:5px;white-space:nowrap;transition:color .12s,background .12s}
a.caf-pipeline-stage:hover{color:var(--fg);text-decoration:none;background:var(--card2)}
.caf-pipeline-stage--active,.caf-pipeline-stage.caf-pipeline-stage--active{font-weight:600}
.caf-pipeline-stage[data-pipeline-stage="evidence"].caf-pipeline-stage--active{color:var(--cyan);background:var(--cyan-bg)}
.caf-pipeline-stage[data-pipeline-stage="insights"].caf-pipeline-stage--active{color:var(--purple);background:var(--purple-bg)}
.caf-pipeline-stage[data-pipeline-stage="ideas"].caf-pipeline-stage--active{color:var(--orange);background:var(--orange-bg)}
.caf-pipeline-stage[data-pipeline-stage="signal_pack"].caf-pipeline-stage--active{color:var(--accent);background:var(--blue-bg)}
.caf-pipeline-stage[data-pipeline-stage="run"].caf-pipeline-stage--active{color:var(--green);background:var(--green-bg)}
.caf-pipeline-stage[data-pipeline-stage="validation"].caf-pipeline-stage--active{color:var(--yellow);background:var(--yellow-bg)}
.caf-pipeline-stage[data-pipeline-stage="publish"].caf-pipeline-stage--active{color:#ec4899;background:rgba(236,72,153,.12)}
.caf-pipeline-stage[data-pipeline-stage="learning"].caf-pipeline-stage--active{color:var(--teal);background:var(--teal-bg)}
span.caf-pipeline-stage{cursor:default}
.wb-shell{display:flex;flex-direction:column;height:calc(100vh - 0px);min-height:480px;background:var(--bg)}
.wb-shell-header{flex-shrink:0;padding:14px 28px 10px;border-bottom:1px solid rgba(59,130,246,.22);background:linear-gradient(135deg,rgba(59,130,246,.1) 0%,rgba(168,85,247,.06) 100%)}
.wb-shell-header-top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:6px}
.wb-shell-header h2{font-size:18px;font-weight:600;margin:0;letter-spacing:-.02em}
.wb-chrome-toggles{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.wb-chrome-btn{font-size:12px!important;padding:5px 10px!important}
.wb-chrome-btn--active{background:var(--blue-bg)!important;color:var(--accent)!important}
.shell--sb-hidden .sb{display:none}
.shell--sb-hidden .main{margin-left:0}
.wb-shell .wb-embed{flex:1;min-height:0;height:auto}
.card-h{text-transform:none;letter-spacing:0;color:var(--fg);font-size:13px;font-weight:600}
.caf-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;padding:10px 12px;background:linear-gradient(135deg,rgba(59,130,246,.12) 0%,rgba(59,130,246,.04) 100%);border:1px solid rgba(59,130,246,.28);border-radius:10px}
.caf-toolbar.surface-warn{background:linear-gradient(135deg,rgba(234,179,8,.14) 0%,rgba(234,179,8,.05) 100%);border-color:rgba(234,179,8,.32)}
.caf-term{position:relative;display:inline-flex;align-items:center}
.caf-term-label{cursor:help;border-bottom:1px dotted var(--muted);display:inline-flex;align-items:center;gap:4px}
.caf-term-icon{font-size:10px;width:14px;height:14px;border-radius:50%;background:var(--card2);color:var(--muted);display:inline-flex;align-items:center;justify-content:center;line-height:1}
.caf-tooltip{position:absolute;left:0;top:calc(100% + 6px);z-index:80;min-width:200px;max-width:320px;padding:10px 12px;font-size:12px;line-height:1.45;color:var(--fg);background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);pointer-events:none}
.caf-options-menu{position:relative;display:inline-block}
.caf-options-trigger{padding:5px 12px!important;font-size:12px!important}
.caf-options-dropdown{position:absolute;right:0;top:calc(100% + 4px);z-index:90;min-width:180px;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:4px;box-shadow:0 8px 24px rgba(0,0,0,.35)}
.caf-options-item{display:block;width:100%;text-align:left;padding:8px 12px;font-size:12px;color:var(--fg);background:none;border:none;border-radius:6px;cursor:pointer;text-decoration:none}
.caf-options-item:hover{background:var(--card2);color:var(--fg);text-decoration:none}
.caf-options-item--danger{color:var(--red)}
.caf-stepper{display:flex;gap:6px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid var(--border);margin-bottom:12px;background:linear-gradient(180deg,var(--surface-2) 0%,transparent 100%);border-radius:10px 10px 0 0}
.caf-step-pill{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;font-size:12px;font-weight:500;border-radius:9999px;border:1px solid var(--border);background:var(--surface-2);color:var(--fg2);cursor:pointer;transition:all .15s}
.caf-step-pill:hover{border-color:var(--fg2);color:var(--fg);background:var(--card2)}
.caf-step-pill.active{background:var(--accent);border-color:var(--accent);color:#fff;box-shadow:0 0 0 1px rgba(59,130,246,.35)}
.caf-step-pill.done{border-color:var(--green);color:var(--green);background:var(--green-bg)}
.caf-step-pill.locked{opacity:.45;cursor:not-allowed}
.caf-table-compact td,.caf-table-compact th{padding-top:8px;padding-bottom:8px}
.caf-run-hub-tabs{display:flex;gap:0;padding:0 28px;border-bottom:1px solid var(--border);margin-top:8px}
.caf-run-hub-tab{padding:10px 16px;font-size:13px;font-weight:500;color:var(--fg2);text-decoration:none;border-bottom:2px solid transparent;margin-bottom:-1px}
.caf-run-hub-tab:hover{color:var(--fg);text-decoration:none}
.caf-run-hub-tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.prellm-split-layout{display:flex;gap:14px;align-items:flex-start;margin-bottom:12px}
@media (max-width:960px){.prellm-split-layout{flex-direction:column}}
.prellm-sidebar{flex:0 0 min(340px,32vw);width:min(340px,32vw);max-width:100%;position:sticky;top:12px;align-self:flex-start;max-height:calc(100vh - 100px);overflow-y:auto;display:flex;flex-direction:column;gap:12px}
.prellm-main{flex:1;min-width:min(100%,280px)}
.prellm-sidebar-card{border:1px solid rgba(45,212,191,.28);border-radius:12px;padding:14px 16px;background:linear-gradient(135deg,rgba(45,212,191,.12) 0%,rgba(45,212,191,.04) 100%)}
.prellm-formula-card{border:1px solid rgba(251,146,60,.28);border-radius:12px;padding:14px 16px;background:linear-gradient(135deg,rgba(251,146,60,.12) 0%,rgba(251,146,60,.04) 100%)}
.prellm-formula-card .prellm-formula-table{font-size:13px}
.prellm-formula-card .prellm-formula-table th,.prellm-formula-card .prellm-formula-table td{padding:10px 12px;font-size:13px}
.prellm-formula-card .prellm-wt{font-size:14px!important;width:84px;padding:6px 8px}
.prellm-relative-toggle{display:flex;align-items:center;gap:8px;flex-wrap:nowrap;cursor:pointer;font-size:13px;color:var(--fg2)}
.prellm-relative-toggle input{margin:0;accent-color:var(--accent);width:16px;height:16px;flex-shrink:0;cursor:pointer}
.prellm-cutoff-wrap{display:flex;align-items:center;gap:8px;flex:1;min-width:200px}
.prellm-cutoff-range{flex:1;min-width:140px;max-width:100%;accent-color:var(--accent)}
.prellm-cutoff-endpoint{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;flex-shrink:0;min-width:1ch}
.processing-import-pick{display:flex;align-items:center;gap:10px;flex:1;min-width:min(100%,280px);max-width:min(560px,100%)}
.processing-import-pick-label{font-size:13px;font-weight:500;color:var(--fg2);white-space:nowrap}
.processing-import-pick select{flex:1;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:13px}
.prellm-cutoff-bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;margin-top:10px;padding:10px 12px;border:1px solid rgba(59,130,246,.28);border-radius:10px;background:linear-gradient(135deg,rgba(59,130,246,.08) 0%,rgba(59,130,246,.02) 100%)}
.prellm-cutoff-bar .prellm-cutoff-wrap{flex:1;min-width:min(100%,240px);max-width:520px}
.prellm-cutoff-label{font-size:13px;font-weight:600;color:var(--fg)}
.prellm-cutoff-value{font-size:14px;font-weight:600;color:var(--accent);min-width:3ch;font-variant-numeric:tabular-nums}
.tp-split-layout{display:flex;gap:14px;align-items:flex-start}
@media (max-width:960px){.tp-split-layout{flex-direction:column}}
.tp-sidebar{flex:0 0 min(300px,30vw);width:min(300px,30vw);max-width:100%;display:flex;flex-direction:column;gap:10px;position:sticky;top:12px;align-self:flex-start;max-height:calc(100vh - 88px);overflow-y:auto}
.tp-main{flex:1;min-width:min(100%,280px);min-height:360px}
.tp-sidebar-card{border:1px solid rgba(168,85,247,.28);border-radius:12px;padding:12px 14px;background:linear-gradient(135deg,rgba(168,85,247,.12) 0%,rgba(168,85,247,.04) 100%)}
.tp-pass-card{border:1px solid var(--border);border-radius:10px;padding:10px 12px;background:var(--surface-2);margin-bottom:8px}
.tp-pass-card:nth-child(odd){border-color:rgba(59,130,246,.28);background:linear-gradient(135deg,rgba(59,130,246,.1) 0%,rgba(59,130,246,.03) 100%)}
.tp-pass-card:nth-child(even){border-color:rgba(34,197,94,.28);background:linear-gradient(135deg,rgba(34,197,94,.1) 0%,rgba(34,197,94,.03) 100%)}
.tp-pass-card:last-child{margin-bottom:0}
.tp-pass-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.tp-pass-head strong{font-size:13px}
.tp-pass-status{font-size:11px;line-height:1.45;color:var(--muted);margin-top:8px;min-height:2.6em}
.tp-pass-status.is-err{color:var(--red)}
.tp-pass-status.is-run{color:var(--accent)}
.tp-pass-log{display:block;margin-top:6px;max-height:min(28vh,180px);overflow:auto;white-space:pre-wrap;font-size:10px;line-height:1.4;font-family:ui-monospace,monospace;background:var(--bg);color:var(--text);padding:8px;border-radius:6px;border:1px solid var(--border)}
.tp-pass-run{width:100%;margin-top:2px}
.tp-setting-grid{display:flex;flex-direction:column;gap:10px;font-size:12px}
.tp-setting-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.tp-tabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px;border-bottom:1px solid var(--border);padding-bottom:8px}
.tp-tab{padding:8px 14px;font-size:12px;font-weight:500;border:1px solid transparent;border-radius:8px 8px 0 0;background:transparent;color:var(--muted);cursor:pointer}
.tp-tab:hover{color:var(--fg);background:var(--bg)}
.tp-tab.active{color:var(--accent);border-color:var(--border);border-bottom-color:var(--card);background:var(--card);margin-bottom:-1px}
.tp-tab-count{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;font-size:10px;font-variant-numeric:tabular-nums;background:var(--bg);color:var(--muted)}
.tp-tab.active .tp-tab-count{background:var(--accent);color:#fff}
.tp-tab-panel{display:none}
.tp-tab-panel.active{display:block}
.tp-table-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
.tp-col-toggles{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;margin-left:auto;padding:4px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);font-size:11px;color:var(--muted)}
.tp-col-toggles strong{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--fg2);margin-right:4px}
.tp-col-toggle{display:inline-flex;align-items:center;gap:5px;cursor:pointer;white-space:nowrap;color:var(--fg2)}
.tp-col-toggle input{margin:0;accent-color:var(--accent)}
.tp-col-toggle--nemotron input{accent-color:var(--purple)}
.tp-col-toggle--docai input{accent-color:var(--green)}
.tp-insights-table-wrap{font-size:12px;width:100%;max-height:min(68vh,560px);overflow-x:auto;overflow-y:auto;border:1px solid rgba(59,130,246,.22);border-radius:8px;-webkit-overflow-scrolling:touch;background:linear-gradient(180deg,var(--surface-2) 0%,var(--card) 100%)}
.processing-workbench .carousel-insights-table thead tr.carousel-col-group-row th{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:6px 10px;border-bottom:1px solid var(--border);text-align:center}
.processing-workbench .carousel-insights-table thead tr.carousel-col-group-row th.grp-base{background:rgba(59,130,246,.12);color:var(--accent)}
.processing-workbench .carousel-insights-table thead tr.carousel-col-group-row th.grp-nemotron{background:rgba(168,85,247,.12);color:var(--purple)}
.processing-workbench .carousel-insights-table thead tr.carousel-col-group-row th.grp-docai{background:rgba(34,197,94,.12);color:var(--green)}
.processing-workbench .carousel-insights-table thead tr.carousel-col-group-row th.grp-raw{background:rgba(234,179,8,.1);color:var(--yellow)}
.processing-workbench .carousel-insights-table td.grp-nemotron{background:rgba(168,85,247,.04)}
.processing-workbench .carousel-insights-table td.grp-docai{background:rgba(34,197,94,.04)}
.processing-workbench .carousel-insights-table .carousel-slide-lines{font-size:11px;line-height:1.45;white-space:pre-wrap;word-break:break-word;max-height:8.5em;overflow:auto}
.processing-workbench .carousel-insights-table .doc-ocr-ok{color:var(--green);font-weight:600;font-size:11px}
.processing-workbench .carousel-insights-table .doc-ocr-miss{color:var(--muted);font-size:11px}
.scraper-cfg-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 14px}
.scraper-cfg-head-hint{font-weight:400;color:var(--muted);font-size:11px}
.scraper-cfg-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-left:auto}
.scraper-cfg-msg{font-size:11px;color:var(--muted);min-width:4ch}
.scraper-cfg-section{border:1px solid var(--border);border-radius:10px;padding:0 12px 12px;margin-bottom:10px;background:var(--surface-2)}
.scraper-cfg-section>summary{cursor:pointer;font-size:13px;font-weight:600;padding:10px 0;list-style-position:inside}
.scraper-cfg-summary{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px;list-style:none}
.scraper-cfg-summary::-webkit-details-marker{display:none}
.scraper-cfg-run-wrap{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-left:auto}
.scraper-cfg-run-wrap .btn-run-scraper{white-space:nowrap}
.scraper-cap-field{display:block;font-size:11px;color:var(--muted)}
.scraper-estimate-actions{display:flex;gap:8px;align-items:center;margin-bottom:8px}
.scraper-estimate-out{font-size:11px;line-height:1.45;color:var(--muted);margin-top:4px}
.scraper-estimate-out table{width:100%;border-collapse:collapse;margin-top:6px;font-size:10px}
.scraper-estimate-out th,.scraper-estimate-out td{padding:4px 6px;border-bottom:1px solid var(--border);text-align:left}
.scraper-estimate-out .est-total{color:var(--fg);font-weight:600;margin-top:6px}
.scraper-cfg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px 14px;margin-top:8px}
.scraper-cfg-grid--wide{grid-template-columns:1fr}
.scraper-cfg-json{width:100%;min-height:200px;font-size:12px;line-height:1.5;padding:12px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);resize:vertical;tab-size:2;font-family:ui-monospace,monospace}
.scraper-cfg-field{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--fg2)}
.scraper-cfg-field--wide{grid-column:1/-1}
.scraper-cfg-field--check{flex-direction:row;align-items:center;gap:8px;padding-top:18px}
.scraper-cfg-field input,.scraper-cfg-field select,.scraper-cfg-field textarea{font-size:12px;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text)}
.scraper-cfg-field textarea.mono,.scraper-cfg-field textarea{font-family:ui-monospace,monospace;font-size:11px}
.tp-qualify-compact{margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);font-size:11px;color:var(--muted);max-height:120px;overflow:auto}
.tp-qualify-compact ul{margin:4px 0 0;padding-left:16px;line-height:1.4}
.runs-ops-hint{display:none!important}
.ph-sub{display:none}
.idea-pick-grid{display:flex;flex-direction:column;gap:8px}
.idea-pick-card{display:block;cursor:pointer;border:1px solid var(--border2);border-radius:10px;padding:12px 14px;background:var(--surface-2);transition:border-color .15s,background .15s,box-shadow .15s}
.idea-pick-card:nth-child(3n+1){border-color:rgba(59,130,246,.22);background:linear-gradient(135deg,rgba(59,130,246,.08) 0%,var(--surface-2) 100%)}
.idea-pick-card:nth-child(3n+2){border-color:rgba(168,85,247,.22);background:linear-gradient(135deg,rgba(168,85,247,.08) 0%,var(--surface-2) 100%)}
.idea-pick-card:nth-child(3n+3){border-color:rgba(45,212,191,.22);background:linear-gradient(135deg,rgba(45,212,191,.08) 0%,var(--surface-2) 100%)}
.idea-pick-card:hover{border-color:var(--fg2);filter:brightness(1.04)}
.idea-pick-input{position:absolute;opacity:0;width:0;height:0;pointer-events:none}
.idea-pick-card--selected,.idea-pick-card:has(.idea-pick-input:checked){border-color:var(--accent)!important;background:var(--blue-bg)!important;box-shadow:0 0 0 1px var(--accent)}
.idea-pick-card-body{display:flex;flex-direction:column;gap:4px}
.idea-pick-card-title{font-size:13px;font-weight:600;color:var(--fg);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.idea-pick-card-desc{font-size:12px;color:var(--muted);line-height:1.45}
.idea-pick-card-extra{margin-top:10px;padding-top:10px;border-top:1px dashed var(--border)}
.idea-pick-card-extra label{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.idea-pick-card-extra input[type=number]{width:72px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text)}
.content>.card{border-left:3px solid transparent}
.content>.card:nth-of-type(4n+1){border-left-color:var(--accent)}
.content>.card:nth-of-type(4n+2){border-left-color:var(--green)}
.content>.card:nth-of-type(4n+3){border-left-color:var(--purple)}
.content>.card:nth-of-type(4n+4){border-left-color:var(--orange)}
pre.json{background:linear-gradient(180deg,var(--surface-2) 0%,var(--bg) 100%);border-color:rgba(59,130,246,.2)}
.processing-workbench{font-size:15px;line-height:1.55}
.processing-workbench .sp-modal-table{font-size:14px}
.processing-workbench .sp-modal-table th,.processing-workbench .sp-modal-table td{padding:10px 14px;font-size:14px}
.processing-workbench .caf-stat-chips{font-size:13px;color:var(--fg2)}
.processing-workbench .empty{font-size:14px}
.processing-workbench .btn-sm{font-size:13px;padding:6px 14px}
.processing-workbench .caf-step-pill{font-size:13px;padding:7px 14px}
.processing-workbench .badge{font-size:11px}
.processing-workbench label,.processing-workbench .runs-ops-hint{font-size:14px}
.processing-workbench .card-h{font-size:14px}
.processing-workbench .insights-data-table,.processing-workbench .broad-insights-table{width:100%;border-collapse:collapse;table-layout:fixed}
.processing-workbench .insights-data-table th,.processing-workbench .broad-insights-table th,.processing-workbench .insights-data-table td,.processing-workbench .broad-insights-table td{padding:8px 10px;font-size:12px}
.processing-workbench .insights-data-table thead th,.processing-workbench .broad-insights-table thead th{position:sticky;top:0;background:var(--card);z-index:2;box-shadow:0 1px 0 var(--border);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);white-space:nowrap;vertical-align:bottom;text-align:left;overflow:hidden;text-overflow:ellipsis}
.processing-workbench .insights-data-table td,.processing-workbench .broad-insights-table td{vertical-align:top;border-bottom:1px solid var(--border);line-height:1.45;overflow:hidden}
.processing-workbench .insights-data-table td.insight-cell-long,.processing-workbench .broad-insights-table td.insight-cell-long{max-width:0}
.processing-workbench .insights-data-table .insight-cell-clamp,.processing-workbench .broad-insights-table .insight-cell-clamp{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;white-space:normal}
.processing-workbench .insights-data-table .insight-clamp-3,.processing-workbench .broad-insights-table .insight-clamp-3{-webkit-line-clamp:3}
.processing-workbench .insights-data-table td.insight-cell-mono,.processing-workbench .broad-insights-table td.insight-cell-mono{white-space:nowrap;font-variant-numeric:tabular-nums}
.processing-workbench .insights-data-table td.insight-cell-score,.processing-workbench .broad-insights-table td.insight-cell-score{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.processing-workbench .insight-tags-wrap{display:flex;flex-wrap:wrap;gap:4px;max-height:5.2em;overflow:hidden}
.processing-workbench .insight-tag{display:inline-block;padding:2px 7px;border-radius:999px;font-size:10px;line-height:1.35;background:var(--bg);border:1px solid var(--border);color:var(--fg2);white-space:nowrap;max-width:140px;overflow:hidden;text-overflow:ellipsis}
.processing-workbench .insight-cell-empty{color:var(--muted)}
.broad-section{display:flex;flex-direction:column;gap:12px;margin-bottom:12px}
.broad-panel{border:1px solid var(--border);border-radius:10px;padding:12px 14px;background:var(--card)}
.broad-panel--run{border-color:rgba(59,130,246,.28);background:linear-gradient(135deg,rgba(59,130,246,.06) 0%,var(--card) 100%)}
.broad-panel-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 10px}
.broad-panel-title span{font-weight:500;text-transform:none;letter-spacing:0;color:var(--fg2);margin-left:6px}
.broad-action-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.broad-options-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px 14px;margin-top:10px;padding-top:10px;border-top:1px dashed var(--border)}
.broad-options-grid label{font-size:12px;color:var(--muted);display:flex;flex-direction:column;gap:4px}
.broad-options-grid label.broad-check-row{flex-direction:row;align-items:center;gap:8px;padding-top:4px}
.broad-options-grid input[type=number],.broad-options-grid input[type=checkbox]{margin:0}
.broad-options-grid input[type=number]{width:100%;max-width:120px;font-size:12px;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)}
.broad-status-line{font-size:12px;color:var(--muted);margin-top:8px;line-height:1.45}
.broad-status-line span{display:block;margin-top:2px}
.broad-platform-wrap .broad-kind-tabs{display:flex;gap:8px;flex-wrap:wrap}
.broad-kind-tabs .broad-kind{border-radius:9999px;font-weight:600;letter-spacing:.02em}
.broad-kind-tabs .broad-kind.btn-ghost{border-color:var(--border2);background:var(--surface-2)}
.broad-kind-tabs .broad-kind.btn-ghost:hover{border-color:var(--accent);color:var(--accent)}
.broad-view-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px 14px;align-items:end}
.broad-view-grid label{font-size:12px;color:var(--muted);display:flex;flex-direction:column;gap:4px}
.broad-view-grid select,.broad-view-grid input{font-size:12px;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)}
.broad-view-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px;padding-top:10px;border-top:1px dashed var(--border)}
.broad-table-2col{display:grid;grid-template-columns:1.05fr .95fr;gap:12px;align-items:start}
.broad-table-col{min-width:0}
@media (max-width:960px){.broad-table-2col{grid-template-columns:1fr}}
.broad-filter-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px 12px;align-items:end}
.broad-filter-grid label{font-size:12px;color:var(--muted);display:flex;flex-direction:column;gap:4px}
.broad-filter-grid input,.broad-filter-grid select{font-size:12px;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);width:100%}
.broad-filter-actions{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin-top:4px}
.caf-manual-pick-overlay{display:none;position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.55);align-items:center;justify-content:center;padding:20px;overflow:auto}
.caf-manual-pick-modal{max-width:min(960px,96vw);width:100%;max-height:min(90vh,880px);display:flex;flex-direction:column;background:linear-gradient(180deg,var(--card) 0%,var(--surface-2) 100%);border:1px solid rgba(59,130,246,.28);border-radius:14px;box-shadow:0 20px 56px rgba(0,0,0,.45);overflow:hidden}
.caf-manual-pick-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 20px;border-bottom:1px solid var(--border);flex-shrink:0;background:linear-gradient(135deg,rgba(59,130,246,.1) 0%,transparent 100%)}
.caf-manual-pick-head h3{margin:0;font-size:17px;font-weight:600}
.caf-manual-pick-summary{font-size:13px;color:var(--muted);margin-top:4px}
.caf-manual-pick-run-hint{font-size:12px;margin-top:8px;padding:8px 10px;border-radius:8px;border:1px solid rgba(234,179,8,.35);background:rgba(234,179,8,.1);color:var(--yellow)}
.caf-manual-pick-run-hint.is-error{border-color:rgba(239,68,68,.4);background:rgba(239,68,68,.12);color:var(--red)}
.caf-manual-pick-tabs{display:flex;flex-wrap:wrap;gap:6px;padding:10px 16px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--surface-2)}
.caf-manual-pick-tab{padding:7px 14px;font-size:13px;font-weight:500;border-radius:9999px;border:1px solid var(--border);background:var(--card2);color:var(--fg2);cursor:pointer;transition:all .12s}
.caf-manual-pick-tab:hover{border-color:var(--fg2);color:var(--fg)}
.caf-manual-pick-tab.active{background:var(--accent);border-color:var(--accent);color:#fff}
.caf-manual-pick-tab.tab-visual-first{border-color:rgba(168,85,247,.45);background:rgba(168,85,247,.12)}
.caf-manual-pick-tab.tab-visual-first.active{background:#9333ea;border-color:#9333ea}
.caf-manual-pick-pill--visual-first{font-size:10px;padding:2px 7px;border-radius:9999px;background:rgba(168,85,247,.22);color:#d8b4fe;margin-left:6px;vertical-align:middle}
.caf-manual-pick-tab .tab-count{display:inline-flex;min-width:18px;height:16px;padding:0 5px;margin-left:6px;border-radius:9999px;font-size:10px;font-weight:700;background:rgba(255,255,255,.2);align-items:center;justify-content:center}
.caf-manual-pick-tab:not(.active) .tab-count{background:var(--blue-bg);color:var(--accent)}
.caf-manual-pick-tab.tab-mimic:not(.active){border-color:rgba(168,85,247,.35);color:var(--purple)}
.caf-manual-pick-tab.tab-mimic.active{background:var(--purple);border-color:var(--purple);color:#fff}
.caf-manual-pick-tab.tab-mimic:not(.active) .tab-count{background:rgba(168,85,247,.15);color:var(--purple)}
.caf-manual-pick-pill{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;font-size:10px;font-weight:600;background:rgba(234,179,8,.15);color:var(--yellow);vertical-align:middle}
.caf-manual-pick-pill--ok{background:rgba(34,197,94,.15);color:var(--green)}
.caf-manual-pick-render{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap}
.caf-manual-pick-render--template{background:rgba(59,130,246,.18);color:var(--accent)}
.caf-manual-pick-render--bleed{background:rgba(168,85,247,.18);color:var(--purple)}
.caf-manual-pick-render--mixed{background:rgba(234,179,8,.15);color:var(--yellow)}
.caf-manual-pick-render--image{background:rgba(34,197,94,.15);color:var(--green)}
.sp-mimic-mode-btns{display:inline-flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:4px}
.sp-mimic-mode-btn{font-size:11px;padding:3px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer;line-height:1.2}
.sp-mimic-mode-btn:hover:not(:disabled){border-color:var(--accent)}
.sp-mimic-mode-btn.active{background:var(--accent);border-color:var(--accent);color:#fff}
.sp-mimic-mode-btn:disabled{opacity:.55;cursor:wait}
.sp-mimic-mode-btn--auto{font-size:10px;color:var(--muted)}
.caf-manual-pick-body{flex:1;min-height:200px;overflow:auto;padding:0}
.caf-manual-pick-table-wrap{overflow:auto;max-height:min(52vh,520px)}
.caf-manual-pick-table{width:100%;border-collapse:collapse;font-size:14px}
.caf-manual-pick-table thead th{position:sticky;top:0;background:var(--card);z-index:2;padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);border-bottom:1px solid var(--border);white-space:nowrap}
.caf-manual-pick-table td{padding:10px 12px;border-bottom:1px solid var(--border2);vertical-align:top}
.caf-manual-pick-table tr:hover td{background:rgba(255,255,255,.02)}
.caf-manual-pick-table tr.is-selected td{background:rgba(59,130,246,.08)}
.caf-manual-pick-table .pick-title{font-weight:600;font-size:14px;line-height:1.35;color:var(--fg)}
.caf-manual-pick-table .pick-detail{font-size:13px;color:var(--fg2);line-height:1.45;max-width:420px}
.caf-manual-pick-table .pick-id{font-family:ui-monospace,monospace;font-size:11px;color:var(--muted)}
.caf-manual-pick-table .pick-post-link{font-size:12px;font-weight:500;color:var(--accent);text-decoration:none;white-space:nowrap}
.caf-manual-pick-table .pick-post-link:hover{text-decoration:underline}
.caf-manual-pick-table .pick-post-link{display:inline-block;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--accent)}
.caf-manual-pick-table .pick-post-link:hover{text-decoration:underline}
.caf-manual-pick-foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;padding:14px 16px;border-top:1px solid var(--border);flex-shrink:0;background:var(--surface-2)}
.caf-manual-pick-foot-left,.caf-manual-pick-foot-right{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.caf-manual-pick-msg{font-size:12px;color:var(--muted);flex:1;min-width:140px}
`;
}

/** Layout toggles for admin workbench embed (controls admin sidebar + iframe filters). */
export function adminWorkbenchChromeTogglesHtml(): string {
  return `<div class="wb-chrome-toggles" data-wb-chrome-toggles role="toolbar" aria-label="Layout">
  <button type="button" class="btn-ghost btn-sm wb-chrome-btn" data-wb-chrome="sidebar">Hide nav</button>
  <button type="button" class="btn-ghost btn-sm wb-chrome-btn" data-wb-chrome="filters">Hide filters</button>
  <button type="button" class="btn-ghost btn-sm wb-chrome-btn" data-wb-chrome="focus">Focus</button>
</div>`;
}

export function adminCafUiScript(): string {
  const glossary = JSON.stringify(ADMIN_CAF_GLOSSARY);
  return `
(function(){
  var G=${glossary};
  function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
  window.__bindCafTerms=function(root){
    var scope=root||document;
    scope.querySelectorAll('[data-caf-term]').forEach(function(el){
      if(el.dataset.cafBound)return;
      el.dataset.cafBound='1';
      var key=el.getAttribute('data-caf-term')||'';
      var tip=G[key];
      if(!tip)return;
      el.classList.add('caf-term');
      el.setAttribute('title',tip);
      if(!el.querySelector('.caf-term-icon')){
        var icon=document.createElement('span');
        icon.className='caf-term-icon';
        icon.textContent='?';
        icon.setAttribute('aria-hidden','true');
        el.appendChild(icon);
      }
    });
  };
  window.__bindCafTerms();
  document.querySelectorAll('[data-caf-options]').forEach(function(root){
    if(root.dataset.cafOptsBound)return;
    root.dataset.cafOptsBound='1';
    var btn=root.querySelector('.caf-options-trigger');
    var menu=root.querySelector('.caf-options-dropdown');
    if(!btn||!menu)return;
    btn.addEventListener('click',function(e){
      e.stopPropagation();
      var open=menu.style.display==='block';
      document.querySelectorAll('.caf-options-dropdown').forEach(function(m){m.style.display='none';});
      menu.style.display=open?'none':'block';
    });
  });
  document.addEventListener('click',function(){
    document.querySelectorAll('.caf-options-dropdown').forEach(function(m){m.style.display='none';});
  });
  window.__setCafPipelineStage=function(stage){
    document.querySelectorAll('.caf-pipeline-stage').forEach(function(el){
      var on=el.getAttribute('data-pipeline-stage')===stage;
      el.classList.toggle('caf-pipeline-stage--active',on);
      if(on)el.setAttribute('aria-current','step');
      else el.removeAttribute('aria-current');
    });
  };
  var CHROME_KEY='caf-review-chrome-v1';
  function readChromeLayout(){
    try{
      var raw=localStorage.getItem(CHROME_KEY);
      if(!raw)return {hideAdminNav:false,hideWorkbenchFilters:false};
      var p=JSON.parse(raw);
      var legacy=!!p.hideSidebar;
      return {
        hideAdminNav:p.hideAdminNav!==undefined?!!p.hideAdminNav:legacy,
        hideWorkbenchFilters:!!p.hideWorkbenchFilters
      };
    }catch(_e){return {hideAdminNav:false,hideWorkbenchFilters:false};}
  }
  function readReviewSidebarHidden(){
    try{
      var raw=localStorage.getItem(CHROME_KEY);
      if(!raw)return false;
      var p=JSON.parse(raw);
      if(p.hideReviewSidebar!==undefined)return !!p.hideReviewSidebar;
      return !!p.hideSidebar;
    }catch(_e){return false;}
  }
  function writeChromeLayout(patch){
    var cur=readChromeLayout();
    var next={
      hideAdminNav:cur.hideAdminNav,
      hideReviewSidebar:readReviewSidebarHidden(),
      hideWorkbenchFilters:cur.hideWorkbenchFilters
    };
    if('hideAdminNav' in patch)next.hideAdminNav=!!patch.hideAdminNav;
    if('hideWorkbenchFilters' in patch)next.hideWorkbenchFilters=!!patch.hideWorkbenchFilters;
    try{localStorage.setItem(CHROME_KEY,JSON.stringify(next));}catch(_e){}
    return next;
  }
  function postChromeToIframe(layout){
    var f=document.querySelector('.wb-embed-frame');
    if(!f||!f.contentWindow)return;
    try{f.contentWindow.postMessage({type:'caf-review-chrome',layout:{hideWorkbenchFilters:!!layout.hideWorkbenchFilters}},'*');}catch(_e){}
  }
  function updateChromeToggleLabels(layout){
    document.querySelectorAll('[data-wb-chrome]').forEach(function(btn){
      var kind=btn.getAttribute('data-wb-chrome');
      if(kind==='sidebar'){
        btn.textContent=layout.hideAdminNav?'Show nav':'Hide nav';
        btn.classList.toggle('wb-chrome-btn--active',layout.hideAdminNav);
      }else if(kind==='filters'){
        btn.textContent=layout.hideWorkbenchFilters?'Show filters':'Hide filters';
        btn.classList.toggle('wb-chrome-btn--active',layout.hideWorkbenchFilters);
      }else if(kind==='focus'){
        var on=layout.hideAdminNav&&layout.hideWorkbenchFilters;
        btn.classList.toggle('wb-chrome-btn--active',on);
      }
    });
  }
  function applyAdminChromeSidebar(){
    var layout=readChromeLayout();
    var shell=document.querySelector('.shell');
    if(shell)shell.classList.toggle('shell--sb-hidden',layout.hideAdminNav);
    updateChromeToggleLabels(layout);
    postChromeToIframe(layout);
  }
  window.__applyAdminChromeLayout=applyAdminChromeSidebar;
  document.addEventListener('DOMContentLoaded',function(){
    applyAdminChromeSidebar();
    var toggles=document.querySelector('[data-wb-chrome-toggles]');
    if(!toggles)return;
    toggles.addEventListener('click',function(e){
      var btn=e.target&&e.target.closest?e.target.closest('[data-wb-chrome]'):null;
      if(!btn)return;
      var kind=btn.getAttribute('data-wb-chrome');
      var cur=readChromeLayout();
      if(kind==='sidebar'){
        cur=writeChromeLayout({hideAdminNav:!cur.hideAdminNav});
      }else if(kind==='filters'){
        cur=writeChromeLayout({hideWorkbenchFilters:!cur.hideWorkbenchFilters});
      }else if(kind==='focus'){
        var on=!(cur.hideAdminNav&&cur.hideWorkbenchFilters);
        cur=writeChromeLayout({hideAdminNav:on,hideWorkbenchFilters:on});
      }else return;
      applyAdminChromeSidebar();
    });
    var frame=document.querySelector('.wb-embed-frame');
    if(frame)frame.addEventListener('load',function(){postChromeToIframe(readChromeLayout());});
  });
})();
`;
}

/** HTML for a CAF term span in admin templates. */
export function adminCafTermHtml(key: string, label: string): string {
  return `<span data-caf-term="${key.replace(/"/g, "")}">${label.replace(/</g, "&lt;")}</span>`;
}

/** HTML for options menu shell; items injected by caller. */
export function adminOptionsMenuHtml(itemsHtml: string, label = "Options"): string {
  return `<div class="caf-options-menu" data-caf-options>
    <button type="button" class="btn-ghost btn-sm caf-options-trigger">⋯ ${label.replace(/</g, "&lt;")}</button>
    <div class="caf-options-dropdown" style="display:none" role="menu">${itemsHtml}</div>
  </div>`;
}

export function adminOptionsItemHtml(label: string, attrs: string): string {
  return `<button type="button" class="caf-options-item" role="menuitem" ${attrs}>${label.replace(/</g, "&lt;")}</button>`;
}

export function adminOptionsLinkHtml(label: string, href: string): string {
  return `<a class="caf-options-item" role="menuitem" href="${href.replace(/"/g, "&quot;")}">${label.replace(/</g, "&lt;")}</a>`;
}

/** Sub-navigation when viewing a run hub (Overview | Jobs | Run outputs | Planned jobs). */
export function adminRunHubTabsHtml(
  active: "overview" | "jobs" | "outputs" | "planned",
  projectSlug: string,
  runId: string
): string {
  const pq = projectSlug ? `project=${encodeURIComponent(projectSlug)}&` : "";
  const runQ = runId ? `run_id=${encodeURIComponent(runId)}` : "";
  const base = `/admin/runs?${pq}${runQ}`;
  const tabs: { id: typeof active; label: string; href: string }[] = [
    { id: "overview", label: "Overview", href: base },
    {
      id: "jobs",
      label: "Jobs",
      href: `/admin/jobs?${pq}${runQ}`,
    },
    {
      id: "outputs",
      label: "Run outputs",
      href: `/admin/workbench/runs?${pq}${runQ.replace("run_id", "run")}`,
    },
    {
      id: "planned",
      label: "Planned jobs",
      href: `/admin/run-jobs?${pq}${runQ}`,
    },
  ];
  return `<nav class="caf-run-hub-tabs" aria-label="Run views">${tabs
    .map(
      (t) =>
        `<a class="caf-run-hub-tab${t.id === active ? " active" : ""}" href="${t.href.replace(/"/g, "&quot;")}">${t.label.replace(/</g, "&lt;")}</a>`
    )
    .join("")}</nav>`;
}

/** End-to-end CAF funnel stages shown in page headers. */
export type CafPipelineStage =
  | "evidence"
  | "insights"
  | "ideas"
  | "signal_pack"
  | "run"
  | "validation"
  | "publish"
  | "learning";

const CAF_PIPELINE_STAGES: { id: CafPipelineStage; label: string }[] = [
  { id: "evidence", label: "Evidence" },
  { id: "insights", label: "Insights" },
  { id: "ideas", label: "Ideas" },
  { id: "signal_pack", label: "Signal Pack" },
  { id: "run", label: "Run (Create Jobs)" },
  { id: "validation", label: "Validation" },
  { id: "publish", label: "Publish" },
  { id: "learning", label: "Learning" },
];

function cafPipelineStageHref(stage: CafPipelineStage, projectSlug: string): string {
  const pq = projectSlug ? `?project=${encodeURIComponent(projectSlug)}` : "";
  switch (stage) {
    case "evidence":
      return `/admin/inputs${pq}`;
    case "insights":
      return `/admin/processing${pq}#insights`;
    case "ideas":
      return `/admin/processing${pq}#ideas`;
    case "signal_pack":
      return `/admin/processing${pq}#pack`;
    case "run":
      return `/admin/runs${pq}`;
    case "validation":
      return `/admin/workbench${pq}`;
    case "publish":
      return `/admin/workbench/publish${pq}`;
    case "learning":
      return `/admin/learning${pq}`;
  }
}

/** Compact pipeline sketch for page headers; pass `null` active to show all stages muted. */
export function adminPipelineSketchHtml(
  active: CafPipelineStage | null,
  projectSlug = ""
): string {
  const items = CAF_PIPELINE_STAGES.map((s) => {
    const isActive = active === s.id;
    const cls = `caf-pipeline-stage${isActive ? " caf-pipeline-stage--active" : ""}`;
    const label = s.label.replace(/</g, "&lt;");
    if (projectSlug) {
      const href = cafPipelineStageHref(s.id, projectSlug).replace(/"/g, "&quot;");
      return `<li><a href="${href}" class="${cls}" data-pipeline-stage="${s.id}"${isActive ? ' aria-current="step"' : ""}>${label}</a></li>`;
    }
    return `<li><span class="${cls}" data-pipeline-stage="${s.id}"${isActive ? ' aria-current="step"' : ""}>${label}</span></li>`;
  }).join("");
  return `<nav class="caf-pipeline-sketch" id="caf-pipeline-sketch" aria-label="Content pipeline"><ol class="caf-pipeline-sketch-list">${items}</ol></nav>`;
}

/** Standard page header: title + pipeline sketch (+ optional subtitle / actions). */
export function adminPageHeaderHtml(
  titleHtml: string,
  pipelineStage: CafPipelineStage | null,
  projectSlug = "",
  opts?: { subtitleHtml?: string; actionsHtml?: string }
): string {
  const sub = opts?.subtitleHtml ? `<span class="ph-sub">${opts.subtitleHtml}</span>` : "";
  const actions = opts?.actionsHtml
    ? `<div class="caf-page-header-actions">${opts.actionsHtml}</div>`
    : "";
  return `<div class="caf-page-header ph"><div class="caf-page-header-left"><h2>${titleHtml}</h2>${adminPipelineSketchHtml(pipelineStage, projectSlug)}${sub}</div>${actions}</div>`;
}

/** `.ph` block with pipeline (legacy pages using ph instead of caf-page-header). */
export function adminPhWithPipelineHtml(
  titleHtml: string,
  pipelineStage: CafPipelineStage | null,
  projectSlug = "",
  subtitleHtml = ""
): string {
  const sub = subtitleHtml ? `<span class="ph-sub">${subtitleHtml}</span>` : "";
  return `<div class="ph"><div class="caf-page-header-left"><h2>${titleHtml}</h2>${adminPipelineSketchHtml(pipelineStage, projectSlug)}${sub}</div></div>`;
}

/** Modal shell for format-tab manual idea picking (Runs + Planned jobs). */
export function adminManualIdeaPickModalHtml(): string {
  return `<div id="caf-manual-pick-overlay" class="caf-manual-pick-overlay" role="dialog" aria-modal="true" aria-labelledby="caf-manual-pick-title">
  <div class="caf-manual-pick-modal">
    <div class="caf-manual-pick-head">
      <div>
        <h3 id="caf-manual-pick-title">Pick ideas &amp; mimic references</h3>
        <div class="caf-manual-pick-summary" id="caf-manual-pick-summary">Select ideas by format (<strong>Carousel · visual-first</strong> is separate from text-heavy). Manual mimic picks use the Mimic tabs. <strong>Apply &amp; start run</strong> saves picks and creates planned content jobs (run must still be CREATED — before Start).</div>
        <div id="caf-manual-pick-run-hint" class="caf-manual-pick-run-hint" style="display:none"></div>
      </div>
      <button type="button" class="btn-ghost btn-sm" id="caf-manual-pick-close" aria-label="Close">✕</button>
    </div>
    <nav class="caf-manual-pick-tabs" id="caf-manual-pick-tabs" aria-label="Idea formats"></nav>
    <div class="caf-manual-pick-body" id="caf-manual-pick-body">
      <div class="empty" style="padding:24px">Loading ideas…</div>
    </div>
    <div class="caf-manual-pick-foot">
      <div class="caf-manual-pick-foot-left">
        <span class="caf-manual-pick-msg" id="caf-manual-pick-msg"></span>
      </div>
      <div class="caf-manual-pick-foot-right">
        <button type="button" class="btn-ghost btn-sm" id="caf-manual-pick-cancel">Cancel</button>
        <button type="button" class="btn-ghost btn-sm" id="caf-manual-pick-tab-none">Clear tab</button>
        <button type="button" class="btn-ghost btn-sm" id="caf-manual-pick-tab-all">Select all in tab</button>
        <button type="button" class="btn btn-sm" id="caf-manual-pick-tab-save">Save tab</button>
        <button type="button" class="btn btn-sm" id="caf-manual-pick-apply">Apply &amp; start run</button>
      </div>
    </div>
  </div>
</div>`;
}

/** Client JS for manual idea picker — include after page defines SLUG and cafFetch. */
export function adminManualIdeaPickScript(): string {
  return `
(function(){
  var FORMAT_ORDER=['video','carousel_visual','carousel','post','thread','blog','slides','script','memo','other'];
  var MIMIC_TAB_ORDER=['mimic_image','mimic_carousel','mimic_why_carousel','mimic_video'];
  function mimicTabLabel(tab){
    if(tab==='mimic_image')return 'Mimic · Image';
    if(tab==='mimic_carousel')return 'Mimic · Carousel';
    if(tab==='mimic_why_carousel')return 'Mimic · Why Carousel';
    if(tab==='mimic_video')return 'Mimic · Video';
    return tab;
  }
  function isMimicTab(tab){return MIMIC_TAB_ORDER.indexOf(tab)>=0;}
  function mimicKindForTab(tab){
    if(tab==='mimic_image')return 'image';
    if(tab==='mimic_carousel')return 'carousel';
    if(tab==='mimic_why_carousel')return 'why_carousel';
    return 'video';
  }
  /** Legacy picker keys used pick_id (e.g. ins_xxx__why_mimic); API expects bare insights_id. */
  function normalizeMimicInsightsId(rawId, kind){
    var id=String(rawId||'').trim();
    if(!id)return '';
    if(id.slice(-11)==='__why_mimic'){
      return {id:id.slice(0,-11),kind:'why_carousel'};
    }
    return {id:id,kind:kind};
  }
  function formatPickApiError(d,fallback){
    if(d&&d.message)return String(d.message);
    if(d&&d.details){
      try{
        var flat=d.details.body&&d.details.body.fieldErrors?d.details.body.fieldErrors:null;
        if(flat&&flat.mimic_picks)return 'Invalid mimic picks: '+flat.mimic_picks.join(' ');
        return 'Invalid request: '+JSON.stringify(d.details);
      }catch(e){}
    }
    return String((d&&d.error)||fallback||'Request failed');
  }
  function mpEsc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function mpEscAttr(s){return mpEsc(s).replace(/"/g,'&quot;');}
  function normFormat(f){
    var x=String(f||'').trim().toLowerCase();
    if(!x)return 'other';
    if(x.indexOf('carousel')>=0)return 'carousel';
    if(x.indexOf('video')>=0||x.indexOf('reel')>=0||x.indexOf('short')>=0)return 'video';
    if(x.indexOf('thread')>=0)return 'thread';
    if(x.indexOf('post')>=0||x.indexOf('static')>=0||x.indexOf('image')>=0)return 'post';
    if(x.indexOf('blog')>=0)return 'blog';
    if(x.indexOf('slide')>=0)return 'slides';
    if(x.indexOf('script')>=0)return 'script';
    if(x.indexOf('memo')>=0)return 'memo';
    if(FORMAT_ORDER.indexOf(x)>=0)return x;
    return 'other';
  }
  function carouselStyle(it){
    return String((it&&it.carousel_style)||(it&&it.execution_profile)||'').trim().toLowerCase().replace(/-/g,'_');
  }
  function isVisualFirstCarouselIdea(it){
    return normFormat(it&&it.format)==='carousel'&&(carouselStyle(it)==='visual_first'||carouselStyle(it)==='mixed');
  }
  function ideaPickTab(it){
    if(isVisualFirstCarouselIdea(it))return 'carousel_visual';
    return normFormat(it&&it.format);
  }
  function fmtLabel(tab){
    if(tab==='carousel_visual')return 'Carousel · visual-first';
    if(tab==='carousel')return 'Carousel · text-heavy';
    return tab==='other'?'Other':tab.charAt(0).toUpperCase()+tab.slice(1);
  }
  var st={
    runId:null,runStatus:'CREATED',signalPackId:null,ideas:[],mimicRefs:[],byTab:{},savedByTab:{},draftByTab:{},activeTab:null,
    onApplied:null,statusElId:null,busy:false
  };
  function overlay(){return document.getElementById('caf-manual-pick-overlay');}
  function setMsg(text,isErr){
    var el=document.getElementById('caf-manual-pick-msg');
    if(el){el.textContent=text||'';el.style.color=isErr?'var(--red)':'var(--muted)';}
    if(st.statusElId){
      var ext=document.getElementById(st.statusElId);
      if(ext&&text){ext.textContent=text;ext.style.color=isErr?'var(--red)':'var(--muted)';}
    }
  }
  function updateSummary(){
    var el=document.getElementById('caf-manual-pick-summary');
    if(!el)return;
    var ids={};
    var tabs=Object.keys(st.savedByTab);
    for(var ti=0;ti<tabs.length;ti++){
      var set=st.savedByTab[tabs[ti]]||{};
      Object.keys(set).forEach(function(id){if(set[id])ids[id]=1;});
    }
    var n=Object.keys(ids).length;
    var mCount=countSavedMimicPicks();
    el.textContent=n||mCount
      ?('Overall: '+n+' idea(s)'+(mCount?(' + '+mCount+' mimic reference(s)'):'')+' saved — apply when ready.')
      :'Select pack ideas and/or top performers to mimic. Save each tab, then apply overall.';
  }
  function countSavedMimicPicks(){
    var n=0;
    for(var mi=0;mi<MIMIC_TAB_ORDER.length;mi++){
      var tab=MIMIC_TAB_ORDER[mi];
      var set=st.savedByTab[tab]||{};
      n+=Object.keys(set).filter(function(k){return set[k];}).length;
    }
    return n;
  }
  function renderTabs(){
    var nav=document.getElementById('caf-manual-pick-tabs');
    if(!nav)return;
    var ideaTabs=FORMAT_ORDER.filter(function(t){return (st.byTab[t]||[]).length>0;});
    var mimicTabs=MIMIC_TAB_ORDER.filter(function(t){return (st.byTab[t]||[]).length>0;});
    var tabs=ideaTabs.concat(mimicTabs);
    if(!tabs.length){nav.innerHTML='';return;}
    if(!st.activeTab||tabs.indexOf(st.activeTab)<0)st.activeTab=tabs[0];
    var h='';
    for(var i=0;i<tabs.length;i++){
      var t=tabs[i];
      var saved=st.savedByTab[t]||{};
      var savedN=Object.keys(saved).filter(function(k){return saved[k];}).length;
      var draft=st.draftByTab[t]||{};
      var draftN=Object.keys(draft).filter(function(k){return draft[k];}).length;
      var count=savedN||draftN;
      var label=isMimicTab(t)?mimicTabLabel(t):fmtLabel(t);
      var cls='caf-manual-pick-tab'+(t===st.activeTab?' active':'')+(savedN>0?' tab-saved':'')+(isMimicTab(t)?' tab-mimic':'')+(t==='carousel_visual'?' tab-visual-first':'');
      h+='<button type="button" class="'+cls+'" data-mp-tab="'+mpEscAttr(t)+'">'+mpEsc(label);
      if(count)h+='<span class="tab-count">'+count+'</span>';
      h+='</button>';
    }
    nav.innerHTML=h;
    nav.querySelectorAll('[data-mp-tab]').forEach(function(btn){
      btn.addEventListener('click',function(){
        persistDraftTab();
        st.activeTab=btn.getAttribute('data-mp-tab');
        renderTabs();
        renderTable();
      });
    });
  }
  function persistDraftTab(){
    if(!st.activeTab)return;
    var draft={};
    document.querySelectorAll('.caf-manual-pick-cb:checked').forEach(function(el){
      draft[el.value]=true;
    });
    st.draftByTab[st.activeTab]=draft;
  }
  function renderTable(){
    var body=document.getElementById('caf-manual-pick-body');
    if(!body)return;
    var tab=st.activeTab;
    var rows=tab?st.byTab[tab]||[]:[];
    if(!rows.length){
      body.innerHTML='<div class="empty" style="padding:24px">'+(isMimicTab(tab||'')
        ?'No top-performer references for this mimic type. Run top-performer insights and rebuild the signal pack.'
        :'No ideas for this format.')+'</div>';
      return;
    }
    var draft=st.draftByTab[tab]||{};
    var saved=st.savedByTab[tab]||{};
    var mimic=isMimicTab(tab);
    var showStyle=!mimic;
    var h='<div class="caf-manual-pick-table-wrap"><table class="caf-manual-pick-table"><thead><tr>';
    h+='<th style="width:36px"><input type="checkbox" id="caf-manual-pick-head-cb" title="Toggle all in tab"/></th>';
    h+='<th>'+(mimic?'Reference':'Title')+'</th><th>Platform</th>';
    if(mimic)h+='<th>Original post</th>';
    if(showStyle)h+='<th>Style</th>';
    if(mimic)h+='<th>Render</th>';
    h+='<th>Summary</th><th>'+(mimic?'Insights ID':'Idea ID')+'</th></tr></thead><tbody>';
    for(var i=0;i<rows.length;i++){
      var it=rows[i];
      var id=String(mimic?(it.insights_id||it.pick_id||''):(it.idea_id||''));
      var on=!!(draft[id]||saved[id]);
      h+='<tr class="'+(on?'is-selected':'')+'">';
      h+='<td><input type="checkbox" class="caf-manual-pick-cb" value="'+mpEscAttr(id)+'"'+(on?' checked':'')+'/></td>';
      h+='<td><div class="pick-title">'+mpEsc(it.title||id);
      if(!mimic&&isVisualFirstCarouselIdea(it)){
        h+=' <span class="caf-manual-pick-pill--visual-first">FLOW_VISUAL_FIRST</span>';
      }
      if(mimic){
        var mediaOk=!!it.has_inspection_media;
        h+=' <span class="caf-manual-pick-pill'+(mediaOk?' caf-manual-pick-pill--ok':'')+'">'+(mediaOk?'media':'no media')+'</span>';
      }
      h+='</div></td>';
      h+='<td><span class="badge badge-b">'+mpEsc(it.platform||'—')+'</span></td>';
      if(mimic){
        var postUrl=String(it.evidence_post_url||'').trim();
        h+='<td>';
        if(postUrl){
          h+='<a href="'+mpEscAttr(postUrl)+'" target="_blank" rel="noopener noreferrer" class="pick-post-link" title="'+mpEscAttr(postUrl)+'">Open post</a>';
        }else{
          h+='<span class="mono" style="font-size:11px;color:var(--muted)">—</span>';
        }
        h+='</td>';
      }
      if(showStyle){
        var lane=String(it.carousel_lane_label||carouselStyle(it)||it.video_style||'—');
        if(lane!=='—'&&lane.indexOf('_')>=0)lane=lane.replace(/_/g,' ');
        h+='<td><span class="mono" style="font-size:11px">'+mpEsc(lane)+'</span></td>';
      }
      if(mimic){
        var rl=String(it.predicted_render_label||'—');
        var rCls='caf-manual-pick-render';
        if(rl==='Template')rCls+=' caf-manual-pick-render--template';
        else if(rl==='Full bleed')rCls+=' caf-manual-pick-render--bleed';
        else if(rl==='Mixed')rCls+=' caf-manual-pick-render--mixed';
        else if(rl==='Image')rCls+=' caf-manual-pick-render--image';
        h+='<td><span class="'+rCls+'">'+mpEsc(rl)+'</span>';
        if(it.predicted_render_detail){
          h+='<div class="pick-detail" style="margin-top:4px;max-width:200px;font-size:11px;color:var(--muted)">'+mpEsc(it.predicted_render_detail)+'</div>';
        }
        if(it.mimic_kind==='carousel'&&st.signalPackId&&typeof window.cafMimicModeOverrideButtonsHtml==='function'){
          var mo=it.mode_override;
          if(mo!=='carousel_visual'&&mo!=='template_bg')mo=null;
          var insightsId=String(it.insights_id||'').trim();
          h+='<div style="margin-top:6px">'+window.cafMimicModeOverrideButtonsHtml(st.signalPackId,insightsId,mo)+'</div>';
        }
        h+='</td>';
      }
      h+='<td><div class="pick-detail">'+mpEsc(it.detail||'—')+'</div></td>';
      h+='<td><span class="pick-id">'+mpEsc(id)+'</span></td></tr>';
    }
    h+='</tbody></table></div>';
    body.innerHTML=h;
    var headCb=document.getElementById('caf-manual-pick-head-cb');
    if(headCb){
      headCb.addEventListener('change',function(){
        var on=headCb.checked;
        document.querySelectorAll('.caf-manual-pick-cb').forEach(function(el){el.checked=on;el.closest('tr')?.classList.toggle('is-selected',on);});
      });
    }
    body.querySelectorAll('.caf-manual-pick-cb').forEach(function(el){
      el.addEventListener('change',function(){
        el.closest('tr')?.classList.toggle('is-selected',el.checked);
      });
    });
  }
  function groupIdeas(ideas){
    st.byTab={};
    for(var i=0;i<ideas.length;i++){
      var it=ideas[i]||{};
      var tab=ideaPickTab(it);
      if(!st.byTab[tab])st.byTab[tab]=[];
      st.byTab[tab].push(it);
    }
  }
  function groupMimicRefs(refs){
    for(var ri=0;ri<(refs||[]).length;ri++){
      var row=refs[ri]||{};
      var kind=String(row.mimic_kind||'');
      var tab=kind==='image'?'mimic_image':kind==='carousel'?'mimic_carousel':kind==='why_carousel'?'mimic_why_carousel':kind==='video'?'mimic_video':null;
      if(!tab)continue;
      if(!st.byTab[tab])st.byTab[tab]=[];
      st.byTab[tab].push(row);
    }
  }
  function allSavedIds(){
    var out={};
    var tabs=Object.keys(st.byTab);
    for(var i=0;i<tabs.length;i++){
      if(isMimicTab(tabs[i]))continue;
      var tab=tabs[i];
      var saved=st.savedByTab[tab]||{};
      var draft=st.draftByTab[tab]||{};
      Object.keys(saved).forEach(function(id){if(saved[id])out[id]=1;});
      Object.keys(draft).forEach(function(id){if(draft[id])out[id]=1;});
    }
    return Object.keys(out);
  }
  function allSavedMimicPicks(){
    var picks=[];
    for(var mi=0;mi<MIMIC_TAB_ORDER.length;mi++){
      var tab=MIMIC_TAB_ORDER[mi];
      var saved=st.savedByTab[tab]||{};
      var draft=st.draftByTab[tab]||{};
      var kind=mimicKindForTab(tab);
      var seen={};
      function addFrom(set){
        Object.keys(set).forEach(function(rawKey){
          if(!set[rawKey])return;
          var norm=normalizeMimicInsightsId(rawKey,kind);
          var normId=norm.id;
          var pickKind=norm.kind;
          if(!normId)return;
          var dedupeKey=pickKind+':'+normId;
          if(seen[dedupeKey])return;
          seen[dedupeKey]=1;
          picks.push({insights_id:normId,mimic_kind:pickKind});
        });
      }
      addFrom(saved);
      addFrom(draft);
    }
    return picks;
  }
  function renderRunHint(){
    var el=document.getElementById('caf-manual-pick-run-hint');
    if(!el)return;
    if(st.runStatus&&st.runStatus!=='CREATED'){
      el.style.display='block';
      el.className='caf-manual-pick-run-hint is-error';
      el.textContent='Run status is '+st.runStatus+' — picks can only be applied before Start. Create a new run (manual picking) or use Re-plan after changing planned jobs.';
      return;
    }
    el.style.display='none';
    el.textContent='';
  }
  function closePicker(){
    var ov=overlay();
    if(ov)ov.style.display='none';
    st.runId=null;st.busy=false;
  }
  window.cafOpenManualIdeaPicker=async function(runId,opts){
    opts=opts||{};
    if(typeof SLUG==='undefined'||!SLUG){setMsg('Select a project first.',true);return;}
    if(!runId){setMsg('Missing run.',true);return;}
    st.runId=runId;
    st.signalPackId=null;
    st.onApplied=opts.onApplied||null;
    st.statusElId=opts.statusElId||null;
    st.savedByTab={};
    st.draftByTab={};
    st.activeTab=null;
    st.mimicRefs=[];
    var ov=overlay();
    if(!ov)return;
    ov.style.display='flex';
    setMsg('Loading pack ideas…',false);
    var body=document.getElementById('caf-manual-pick-body');
    if(body)body.innerHTML='<div class="empty" style="padding:24px">Loading…</div>';
    try{
      var r=await cafFetch('/v1/admin/run-transparency?project='+encodeURIComponent(SLUG)+'&run_id='+encodeURIComponent(runId));
      var d=await r.json();
      if(!r.ok||!d.ok)throw new Error((d&&d.error)||'Failed to load ideas');
      st.ideas=Array.isArray(d.signal_pack_ideas_ui)?d.signal_pack_ideas_ui:[];
      st.mimicRefs=Array.isArray(d.signal_pack_mimic_references_ui)?d.signal_pack_mimic_references_ui:[];
      st.signalPackId=(d.signal_pack_meta&&d.signal_pack_meta.id)||(d.run&&d.run.signal_pack_id)||null;
      st.runStatus=d.run&&d.run.status?String(d.run.status):'CREATED';
      st.byTab={};
      groupIdeas(st.ideas);
      groupMimicRefs(st.mimicRefs);
      if(!st.ideas.length&&!st.mimicRefs.length)throw new Error('Signal pack has no ideas_json and no top-performer references — build insights and rebuild the pack.');
      renderRunHint();
      renderTabs();
      renderTable();
      updateSummary();
      setMsg('',false);
    }catch(e){
      setMsg(String(e.message||e),true);
      if(body)body.innerHTML='<div class="empty" style="padding:24px;color:var(--red)">'+mpEsc(String(e.message||e))+'</div>';
    }
  };
  window.cafCloseManualIdeaPicker=closePicker;
  document.getElementById('caf-manual-pick-close')?.addEventListener('click',closePicker);
  document.getElementById('caf-manual-pick-cancel')?.addEventListener('click',closePicker);
  overlay()?.addEventListener('click',function(ev){if(ev.target===overlay())closePicker();});
  document.getElementById('caf-manual-pick-tab-all')?.addEventListener('click',function(){
    document.querySelectorAll('.caf-manual-pick-cb').forEach(function(el){el.checked=true;el.closest('tr')?.classList.add('is-selected');});
  });
  document.getElementById('caf-manual-pick-tab-none')?.addEventListener('click',function(){
    document.querySelectorAll('.caf-manual-pick-cb').forEach(function(el){el.checked=false;el.closest('tr')?.classList.remove('is-selected');});
  });
  document.getElementById('caf-manual-pick-tab-save')?.addEventListener('click',function(){
    if(!st.activeTab)return;
    persistDraftTab();
    var draft=st.draftByTab[st.activeTab]||{};
    st.savedByTab[st.activeTab]=Object.assign({},draft);
    var n=Object.keys(draft).filter(function(k){return draft[k];}).length;
    setMsg((isMimicTab(st.activeTab)?mimicTabLabel(st.activeTab):fmtLabel(st.activeTab))+': saved '+n+' selection(s).',false);
    renderTabs();
    updateSummary();
  });
  document.getElementById('caf-manual-pick-apply')?.addEventListener('click',async function(){
    persistDraftTab();
    if(st.runStatus&&st.runStatus!=='CREATED'){
      setMsg('Run is already '+st.runStatus+' — create a new run or Re-plan. Manual pick only works before Start.',true);
      return;
    }
    var ids=allSavedIds();
    var mimicPicks=allSavedMimicPicks();
    if(!ids.length&&!mimicPicks.length){
      setMsg('Select at least one idea or mimic reference, then Apply & start run.',true);
      return;
    }
    if(st.busy)return;
    st.busy=true;
    var total=ids.length+mimicPicks.length;
    setMsg('Saving '+total+' selection(s) and starting run…',false);
    try{
      var body={mode:'manual'};
      if(ids.length)body.idea_ids=ids;
      if(mimicPicks.length)body.mimic_picks=mimicPicks;
      var r=await cafFetch('/v1/runs/'+encodeURIComponent(SLUG)+'/'+encodeURIComponent(st.runId)+'/jobs',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body)
      });
      var d=await r.json();
      if(!r.ok||!d.ok){
        var errMsg=formatPickApiError(d,'HTTP '+r.status);
        if(String(errMsg).toLowerCase().indexOf('created')>=0){
          throw new Error('Run already started — manual pick only works before Start. Create a new run with Manual picking.');
        }
        throw new Error(errMsg);
      }
      var startR=await cafFetch('/v1/runs/'+encodeURIComponent(SLUG)+'/'+encodeURIComponent(st.runId)+'/start',{
        method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
      });
      var startD=await startR.json();
      if(!startR.ok||!startD.ok)throw new Error((startD&&startD.message)||(startD&&startD.error)||'Start failed after saving picks');
      var planned=startD.planned_jobs!=null?startD.planned_jobs:0;
      setMsg('Saved '+d.planner_rows+' planner row(s) · '+planned+' job(s) planned. Starting generation and rendering…',false);
      var procR=await cafFetch('/v1/runs/'+encodeURIComponent(SLUG)+'/'+encodeURIComponent(st.runId)+'/process',{
        method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
      });
      var procD=await procR.json();
      if(!procR.ok||!procD.ok)throw new Error((procD&&procD.message)||(procD&&procD.error)||'Generate failed after start');
      var renderR=await cafFetch('/v1/runs/'+encodeURIComponent(SLUG)+'/'+encodeURIComponent(st.runId)+'/render',{
        method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
      });
      var renderD=await renderR.json();
      if(!renderR.ok||!renderD.ok)throw new Error((renderD&&renderD.message)||(renderD&&renderD.error)||'Render failed after start');
      setMsg('Saved '+d.planner_rows+' planner row(s) · '+planned+' job(s) planned. Generation and rendering started in the background.',false);
      closePicker();
      if(typeof st.onApplied==='function')st.onApplied(Object.assign({},d,{start:startD,process:procD,render:renderD}));
      else if(typeof showToast==='function')showToast('Run started: '+planned+' job(s). Generation and rendering are running in the background.',true,16000);
    }catch(e){
      setMsg(String(e.message||e),true);
    }finally{st.busy=false;}
  });
  window.rcOpenManualPicker=function(){
    if(typeof RUN_ID!=='undefined'&&RUN_ID){
      window.cafOpenManualIdeaPicker(RUN_ID,{statusElId:'rc-mat-msg',onApplied:function(){if(typeof loadRunTransparency==='function')loadRunTransparency();}});
    }
  };
  var prevCafMimicModeSaved=window.cafOnSignalPackMimicModeSaved;
  window.cafOnSignalPackMimicModeSaved=function(insightsId,mode){
    if(typeof prevCafMimicModeSaved==='function')prevCafMimicModeSaved(insightsId,mode);
    for(var mi=0;mi<st.mimicRefs.length;mi++){
      if(String(st.mimicRefs[mi].insights_id||'')===insightsId)st.mimicRefs[mi].mode_override=mode;
    }
    var ov=overlay();
    if(ov&&ov.style.display!=='none')renderTable();
  };
})();
`;
}

/** Save / display signal-pack mimic mode overrides (Full bleed vs Template) in admin. */
export function adminSignalPackMimicModeScript(): string {
  return `
(function(){
  function escAttr(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function normMode(m){
    if(m==='carousel_visual'||m==='template_bg')return m;
    return null;
  }
  window.cafMimicModeOverrideButtonsHtml=function(packId,insightsId,currentMode){
    if(!packId||!insightsId)return '';
    var cur=normMode(currentMode);
    var h='<span class="sp-mimic-mode-btns" data-insights-id="'+escAttr(insightsId)+'">';
    h+='<button type="button" class="sp-mimic-mode-btn'+(cur==='carousel_visual'?' active':'')+'" data-pack-id="'+escAttr(packId)+'" data-insights-id="'+escAttr(insightsId)+'" data-mode="carousel_visual">Full bleed</button>';
    h+='<button type="button" class="sp-mimic-mode-btn'+(cur==='template_bg'?' active':'')+'" data-pack-id="'+escAttr(packId)+'" data-insights-id="'+escAttr(insightsId)+'" data-mode="template_bg">Template</button>';
    if(cur)h+='<button type="button" class="sp-mimic-mode-btn sp-mimic-mode-btn--auto" data-pack-id="'+escAttr(packId)+'" data-insights-id="'+escAttr(insightsId)+'" data-mode="">Auto</button>';
    h+='</span>';
    return h;
  };
  window.cafSignalPackMimicModeOverride=async function(packId,insightsId,mode,statusEl,btnNodes){
    if(typeof SLUG==='undefined'||!SLUG||!packId||!insightsId){
      if(statusEl){statusEl.textContent='Missing project, pack, or insights id.';statusEl.style.color='var(--red)';}
      return false;
    }
    var btns=btnNodes||[];
    for(var bi=0;bi<btns.length;bi++)btns[bi].disabled=true;
    if(statusEl){statusEl.textContent='Saving…';statusEl.style.color='var(--muted)';}
    try{
      var r=await cafFetch('/v1/signal-packs/'+encodeURIComponent(SLUG)+'/'+encodeURIComponent(packId)+'/mimic-mode-override',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({insights_id:insightsId,mode_override:mode})
      });
      var d=await r.json().catch(function(){return {};});
      if(!r.ok||d.ok===false)throw new Error((d&&d.error)||(d&&d.message)||'HTTP '+r.status);
      if(statusEl){statusEl.textContent='Saved '+insightsId+' → '+(mode||'auto');statusEl.style.color='var(--green)';}
      if(typeof window.cafOnSignalPackMimicModeSaved==='function')window.cafOnSignalPackMimicModeSaved(insightsId,mode);
      return true;
    }catch(e){
      if(statusEl){statusEl.textContent=String(e.message||e);statusEl.style.color='var(--red)';}
      return false;
    }finally{
      for(var bj=0;bj<btns.length;bj++)btns[bj].disabled=false;
    }
  };
  window.cafRenderPackMimicOverridesPanel=function(pack,containerId,msgId){
    var wrap=document.getElementById(containerId||'');
    var msg=msgId?document.getElementById(msgId):null;
    if(!wrap)return;
    var p=pack||{};
    var packId=String(p.id||'').trim();
    var dg=(p.derived_globals_json&&typeof p.derived_globals_json==='object'&&!Array.isArray(p.derived_globals_json))?p.derived_globals_json:{};
    var overrides=(dg.mimic_mode_overrides&&typeof dg.mimic_mode_overrides==='object')?dg.mimic_mode_overrides:{};
    var vgp=(dg.visual_guidelines_pack_v1&&typeof dg.visual_guidelines_pack_v1==='object')?dg.visual_guidelines_pack_v1:null;
    var ents=vgp&&Array.isArray(vgp.entries)?vgp.entries:[];
    var rows=[];
    for(var i=0;i<ents.length;i++){
      var e=ents[i]||{};
      if(String(e.analysis_tier||'')!=='top_performer_carousel')continue;
      var insId=String(e.insights_id||'').trim();
      if(!insId)continue;
      var title=String(e.hook_text_preview||e.why_it_worked||e.format_pattern||insId).slice(0,100);
      rows.push({insId:insId,title:title,cur:normMode(overrides[insId])});
    }
    if(!rows.length){wrap.innerHTML='<p class="runs-ops-hint" style="margin:0">No top-performer carousel entries on this pack.</p>';return;}
    var h='<p class="runs-ops-hint" style="margin:0 0 10px">Pin mimic render mode before starting a run. Stored on <span class="mono">derived_globals_json.mimic_mode_overrides</span>.</p>';
    h+='<div class="plan-cap-row plan-cap-row--select" style="margin:0 0 12px;max-width:520px">';
    h+='<label for="sp-mimic-text-flux" style="font-size:12px">Mimic text rendering (project)</label>';
    h+='<select id="sp-mimic-text-flux" style="width:100%;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">';
    h+='<option value="">Server / project default</option>';
    h+='<option value="0">Generate copy + HTML/CSS overlay (strip ref text)</option>';
    h+='<option value="1">Image model bakes copy</option>';
    h+='</select>';
    h+='<button type="button" class="btn btn-sm" id="sp-mimic-text-flux-save" style="margin-top:8px">Save text rendering</button>';
    h+='</div>';
    h+='<table class="caf-manual-pick-table"><thead><tr><th>Reference</th><th>insights_id</th><th>Render mode</th></tr></thead><tbody>';
    for(var ri=0;ri<rows.length;ri++){
      var row=rows[ri];
      h+='<tr><td>'+esc(row.title)+'</td><td class="pick-id">'+esc(row.insId)+'</td><td>';
      if(typeof window.cafMimicModeOverrideButtonsHtml==='function')h+=window.cafMimicModeOverrideButtonsHtml(packId,row.insId,row.cur);
      h+='</td></tr>';
    }
    h+='</tbody></table>';
    wrap.innerHTML=h;
    if(msg&&!msg.textContent)msg.textContent='';
    if(typeof SLUG!=='undefined'&&SLUG){
      cafFetch('/v1/admin/config?project='+encodeURIComponent(SLUG)).then(function(r){return r.json();}).then(function(d){
        if(!d.ok)return;
        var sel=document.getElementById('sp-mimic-text-flux');
        if(!sel)return;
        var fluxRaw=d.constraints&&d.constraints.mimic_carousel_text_via_flux;
        sel.value=(fluxRaw===true)?'1':(fluxRaw===false)?'0':'';
      }).catch(function(){});
    }
    var saveBtn=document.getElementById('sp-mimic-text-flux-save');
    if(saveBtn){
      saveBtn.addEventListener('click',async function(){
        if(typeof SLUG==='undefined'||!SLUG){if(msg){msg.textContent='Pick a project.';msg.style.color='var(--red)';}return;}
        var sel=document.getElementById('sp-mimic-text-flux');
        var pick=sel?(sel.value||'').trim():'';
        if(msg){msg.textContent='Saving text rendering…';msg.style.color='var(--muted)';}
        try{
          var r=await cafFetch('/v1/admin/config/constraints',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({_project:SLUG,mimic_carousel_text_via_flux:pick===''?'':pick==='1'})});
          var d=await r.json().catch(function(){return {};});
          if(!r.ok||!d.ok)throw new Error((d&&d.error)||'Save failed');
          if(msg){msg.textContent='Saved mimic text rendering for project.';msg.style.color='var(--green)';}
        }catch(e){
          if(msg){msg.textContent=String(e.message||e);msg.style.color='var(--red)';}
        }
      });
    }
  };
  document.addEventListener('click',function(ev){
    var t=ev.target;
    if(!t||!t.classList||!t.classList.contains('sp-mimic-mode-btn'))return;
    var packId=t.getAttribute('data-pack-id');
    var insId=t.getAttribute('data-insights-id');
    var modeAttr=t.getAttribute('data-mode');
    var mode=modeAttr===''?null:modeAttr;
    var status=document.getElementById('pack-inspect-mimic-msg')||document.getElementById('sp-mimic-mode-msg')||document.getElementById('caf-manual-pick-msg');
    var grp=t.closest? t.closest('.sp-mimic-mode-btns'):null;
    var btnNodes=grp?Array.prototype.slice.call(grp.querySelectorAll('button')):[];
    window.cafSignalPackMimicModeOverride(packId,insId,mode,status,btnNodes);
  });
})();
`;
}
