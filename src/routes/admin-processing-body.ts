/** Inner HTML + script for GET /admin/processing — imports, evidence by platform, insights, top-performer passes, profile. */

import { adminCafTermHtml, adminLlmPromptTitleAttr, adminPipelineSketchHtml } from "./admin-ui-shared.js";

export function adminProcessingBody(currentSlug: string): string {
  const SLUG = JSON.stringify(currentSlug);
  const inputsPq = currentSlug ? `?project=${encodeURIComponent(currentSlug)}` : "";
  const T = adminCafTermHtml;
  const PL = adminLlmPromptTitleAttr;
  return `
<div class="caf-page-header ph"><div class="caf-page-header-left"><h2><span data-caf-term="processing">Processing</span></h2>${adminPipelineSketchHtml("evidence", currentSlug)}</div></div>
<div class="content">
  <div class="card processing-workbench" style="margin-bottom:14px">
    <div style="padding:12px 16px 8px">
      <div class="caf-toolbar" id="imports-toolbar" style="margin-bottom:10px;flex-wrap:wrap">
        <label class="processing-import-pick" for="imports-select">
          <span class="processing-import-pick-label">Import</span>
          <select id="imports-select" aria-label="Pick an evidence import">
            <option value="">Loading…</option>
          </select>
        </label>
        <button type="button" class="btn btn-sm" id="btn-reload-imports">Reload</button>
        <a class="btn-ghost btn-sm" href="/admin/inputs${inputsPq}">Inputs</a>
        <div class="caf-options-menu" data-caf-options style="margin-left:auto">
          <button type="button" class="btn-ghost btn-sm caf-options-trigger">⋯ Options</button>
          <div class="caf-options-dropdown" style="display:none" role="menu">
            <button type="button" class="caf-options-item" role="menuitem" id="btn-open-profile">Profile &amp; audit</button>
            <button type="button" class="caf-options-item" role="menuitem" id="btn-toggle-operator-lens">Operator lens</button>
            <button type="button" class="caf-options-item" role="menuitem" id="btn-toggle-activity-log">Activity log</button>
          </div>
        </div>
        <span id="imports-hint" class="caf-stat-chips"></span>
      </div>
      <div id="processing-activity-wrap" style="display:none;margin:0 0 12px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--card);font-size:13px;line-height:1.45">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin-bottom:6px">
          <strong style="font-size:12px">Activity</strong>
          <button type="button" class="btn-ghost btn-sm" id="btn-clear-activity-log">Clear</button>
        </div>
        <div id="processing-activity-current" style="font-family:ui-monospace,monospace;word-break:break-all;color:var(--text);min-height:1.35em;padding:6px 8px;border-radius:6px;background:var(--bg);border:1px solid var(--border)">Waiting for JavaScript…</div>
        <details id="processing-activity-details" style="margin-top:8px">
          <summary style="cursor:pointer;font-size:12px;color:var(--muted)">Full log</summary>
          <pre id="processing-activity-log" style="margin:8px 0 0;max-height:min(40vh,320px);overflow:auto;white-space:pre-wrap;font-size:10px;background:var(--bg);padding:8px;border-radius:6px;border:1px solid var(--border);color:var(--text)"></pre>
        </details>
      </div>
      <div id="imports-root" style="display:none" aria-hidden="true"></div>
      <div id="import-workbench" style="display:none;margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
        <div id="stepper" class="caf-stepper">
          <button type="button" class="caf-step-pill step-btn active" id="step-select" data-step="select" title="Pick the evidence import you want to process.">
            1 Select import <span class="badge badge-y" id="step-badge-select">in progress</span>
          </button>
          <button type="button" class="caf-step-pill step-btn" id="step-evidence" data-step="evidence" title="Filter evidence using profile gates + cutoff (no LLM).">
            2 ${T("filterEvidence", "Filter evidence")} <span class="badge badge-b" id="step-badge-evidence">not started</span>
          </button>
          <button type="button" class="caf-step-pill step-btn" id="step-insights" data-step="insights" title="${PL("INSIGHTS__Broad_LLM_v1 (+ top-performer passes)", "Processing", "Broad insights + image/carousel/video deep passes")}">
            3 <span data-caf-term="insights">Insights</span> <span class="badge badge-b" id="step-badge-insights">not started</span>
          </button>
          <button type="button" class="caf-step-pill step-btn" id="step-ideas" data-step="ideas" title="${PL("IDEAS__From_Insights_v1", "Processing")}">
            4 Build <span data-caf-term="ideas">ideas</span> <span class="badge badge-b" id="step-badge-ideas">not started</span>
          </button>
          <button type="button" class="caf-step-pill step-btn" id="step-pack" data-step="pack" title="${PL("SIGNAL_PACK__Rating_Batch_v1 + SIGNAL_PACK__Synthesize_Candidates_v1", "Processing", "Full import also runs IDEAS__From_Insights_v1")}">
            5 <span data-caf-term="signalPack">Signal pack</span> <span class="badge badge-b" id="step-badge-pack">not started</span>
          </button>
          <button type="button" class="caf-step-pill step-btn" id="step-run" data-step="run" title="Proceed to Runs — jobs are created when you start a run from the signal pack.">
            6 <span data-caf-term="run">Run</span> <span class="badge badge-b" id="step-badge-run">not started</span>
          </button>
        </div>
        <details id="operator-read-lens" style="margin:0 0 14px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--bg);display:none">
          <summary style="cursor:pointer;font-size:13px;font-weight:600">Operator lens — readable evidence &amp; insights</summary>
          <p class="runs-ops-hint" style="margin:8px 0 10px">Uses <span class="mono">GET /v1/evidence/…</span> and <span class="mono">GET /v1/insights/…</span>. Pick platform, filters, and sort; open a row for every field. Select an import first.</p>
          <div style="border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:10px;background:var(--card)">
            <div style="font-size:12px;font-weight:600;margin-bottom:8px">Evidence</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:8px">
              <label style="font-size:11px;color:var(--muted)">Platform<br />
                <select id="op-lens-ev-platform" style="font-size:12px;min-width:140px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
                  <option value="">All platforms</option>
                  <option value="facebook">Facebook</option>
                  <option value="instagram">Instagram</option>
                  <option value="tiktok">TikTok</option>
                  <option value="reddit">Reddit</option>
                  <option value="web">Web (scraped)</option>
                  <option value="source_registry">Sources (registry)</option>
                  <option value="reference_pool">Reference pool</option>
                </select>
              </label>
              <label style="font-size:11px;color:var(--muted)">Format<br />
                <select id="op-lens-ev-format" style="font-size:12px;min-width:120px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
                  <option value="">Any format</option>
                  <option value="video">video</option>
                  <option value="carousel">carousel</option>
                  <option value="single_image">single_image</option>
                  <option value="text_native">text_native</option>
                  <option value="article_or_page">article_or_page</option>
                  <option value="unknown">unknown</option>
                </select>
              </label>
              <label style="font-size:11px;color:var(--muted)">Sort<br />
                <select id="op-lens-ev-sort" style="font-size:12px;min-width:130px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
                  <option value="rating_desc">Rating ↓</option>
                  <option value="rating_asc">Rating ↑</option>
                  <option value="created_desc">Created ↓</option>
                  <option value="created_asc">Created ↑</option>
                </select>
              </label>
              <label style="font-size:11px;color:var(--muted)">Min rating<br /><input id="op-lens-ev-min-rating" type="number" min="0" max="1" step="0.01" placeholder="any" style="width:88px;font-size:12px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" title="Uses evidence row rating_score when present" /></label>
              <label style="font-size:11px;color:var(--muted)">Search<br /><input id="op-lens-ev-search" type="search" placeholder="Caption, payload…" style="width:min(220px,40vw);font-size:12px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" /></label>
              <label style="font-size:11px;color:var(--muted)">Limit<br /><input id="op-lens-ev-limit" type="number" min="1" max="200" value="50" style="width:64px;font-size:12px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" /></label>
              <label style="font-size:11px;color:var(--muted)">Offset<br /><input id="op-lens-ev-offset" type="number" min="0" value="0" style="width:64px;font-size:12px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" /></label>
              <label style="font-size:11px;color:var(--muted);display:flex;gap:6px;align-items:center;align-self:center;margin-top:14px">
                <input type="checkbox" id="op-lens-ev-all-cols" checked /> Wide table
              </label>
              <button type="button" class="btn-ghost btn-sm" id="btn-op-lens-ev-sync-tab" title="Set Platform from the Filter evidence tab (FB / IG / …)">Sync platform tab</button>
              <button type="button" class="btn btn-sm" id="btn-op-lens-evidence">Load evidence</button>
            </div>
          </div>
          <div style="border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:10px;background:var(--card)">
            <div style="font-size:12px;font-weight:600;margin-bottom:8px">Insights</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:8px">
              <label style="font-size:11px;color:var(--muted)">Platform<br />
                <select id="op-lens-in-platform" style="font-size:12px;min-width:140px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
                  <option value="">All</option>
                  <option value="facebook">Facebook</option>
                  <option value="instagram">Instagram</option>
                  <option value="tiktok">TikTok</option>
                  <option value="reddit">Reddit</option>
                </select>
              </label>
              <label style="font-size:11px;color:var(--muted)">Analysis tier<br />
                <select id="op-lens-in-tier" style="font-size:12px;min-width:160px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
                  <option value="">All tiers</option>
                  <option value="broad_llm">broad_llm</option>
                  <option value="top_performer_deep">top_performer_deep</option>
                  <option value="top_performer_carousel">top_performer_carousel</option>
                  <option value="top_performer_video">top_performer_video</option>
                </select>
              </label>
              <label style="font-size:11px;color:var(--muted)">Insight type<br />
                <select id="op-lens-in-type" style="font-size:12px;min-width:160px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
                  <option value="">Any type</option>
                  <option value="top_performer">top_performer</option>
                  <option value="hook_pattern">hook_pattern</option>
                  <option value="emotional_pattern">emotional_pattern</option>
                  <option value="visual_pattern">visual_pattern</option>
                  <option value="hashtag_cluster">hashtag_cluster</option>
                  <option value="strategic_opportunity">strategic_opportunity</option>
                  <option value="risk_or_warning">risk_or_warning</option>
                  <option value="market_row_analysis">market_row_analysis</option>
                </select>
              </label>
              <label style="font-size:11px;color:var(--muted)">Min confidence<br /><input id="op-lens-in-conf" type="number" min="0" max="1" step="0.05" placeholder="any" style="width:88px;font-size:12px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" title="From pre-LLM score when present" /></label>
              <label style="font-size:11px;color:var(--muted)">Search<br /><input id="op-lens-in-search" type="search" placeholder="Title, summary…" style="width:min(200px,36vw);font-size:12px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" /></label>
              <label style="font-size:11px;color:var(--muted)">Sort (loaded page)<br />
                <select id="op-lens-in-sort" style="font-size:12px;min-width:150px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
                  <option value="created_desc">Created ↓</option>
                  <option value="created_asc">Created ↑</option>
                  <option value="confidence_desc">Confidence ↓</option>
                  <option value="confidence_asc">Confidence ↑</option>
                  <option value="title_asc">Title A→Z</option>
                </select>
              </label>
              <label style="font-size:11px;color:var(--muted)">Limit<br /><input id="op-lens-in-limit" type="number" min="1" max="200" value="50" style="width:64px;font-size:12px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" /></label>
              <label style="font-size:11px;color:var(--muted)">Offset<br /><input id="op-lens-in-offset" type="number" min="0" value="0" style="width:64px;font-size:12px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" /></label>
              <button type="button" class="btn-ghost btn-sm" id="btn-op-lens-insights">Load insights</button>
              <button type="button" class="btn-ghost btn-sm" id="btn-copy-op-lens-tsv" title="Tab-separated values from the table below">Copy table</button>
              <button type="button" class="btn-ghost btn-sm" id="btn-copy-op-lens-json" title="JSON for the last load">Copy JSON</button>
            </div>
          </div>
          <div id="op-lens-out" class="runs-ops-hint" style="min-height:2em">—</div>
        </details>
        <div id="panel-evidence" style="padding:12px 0 0">
          <div style="margin-bottom:12px">
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:flex-end;margin-bottom:8px">
              <button type="button" class="btn-ghost btn-sm" id="btn-refresh-evidence" title="Reload import stats + evidence preview from the database (no LLM).">Refresh</button>
            </div>
            <div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;background:var(--bg)">
              <div style="font-size:13px;font-weight:600;margin-bottom:8px">${T("evidenceFunnel", "Evidence funnel")}</div>
              <div id="evidence-funnel" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"></div>
              <div id="evidence-funnel-hint" style="margin-top:6px;font-size:12px;color:var(--muted)"></div>
            </div>
            <div id="evidence-cutoff-bar" class="prellm-cutoff-bar">
              <span class="prellm-cutoff-label">${T("cutoffScore", "Cutoff")}</span>
              <span id="prellm-min-val" class="mono prellm-cutoff-value">0.00</span>
              <div class="prellm-cutoff-wrap">
                <span class="prellm-cutoff-endpoint" aria-hidden="true">0</span>
                <input type="range" id="prellm-min-score" class="prellm-cutoff-range" min="0" max="1" step="0.01" value="0" aria-valuemin="0" aria-valuemax="1" />
                <span class="prellm-cutoff-endpoint" aria-hidden="true">1</span>
              </div>
            </div>
            <details id="import-stats-debug" style="margin:10px 0 0">
              <summary style="cursor:pointer;font-size:12px;color:var(--muted)">Debug (import stats JSON)</summary>
              <pre id="import-stats" style="font-size:11px;background:var(--bg);padding:10px;border-radius:8px;overflow:auto;max-height:260px;margin-top:8px;white-space:pre-wrap"></pre>
            </details>
          </div>
          <div id="prellm-root">
            <style>
              .prellm-evidence-table{width:100%;border-collapse:separate;border-spacing:0}
              .prellm-evidence-table thead th{position:sticky;top:0;background:var(--card);z-index:2;box-shadow:0 1px 0 var(--border);padding:10px 12px;font-size:14px;white-space:nowrap;vertical-align:bottom}
              .prellm-evidence-table td{padding:10px 12px;vertical-align:top;border-bottom:1px solid var(--border);font-size:14px}
              .prellm-evidence-table tr.prellm-row-dim{opacity:0.55}
              .prellm-cell-clamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;max-width:min(320px,36vw);line-height:1.4;word-break:break-word;white-space:pre-wrap}
              .prellm-cell-hashtags{max-width:min(180px,22vw);font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}
              .prellm-cell-norm{font-size:10px;line-height:1.35;max-width:min(120px,14vw)}
              .prellm-cell-url{max-width:min(120px,14vw);word-break:break-all;font-size:11px}
              .prellm-score-cell{white-space:nowrap;font-variant-numeric:tabular-nums}
            </style>
            <div class="prellm-split-layout">
              <aside class="prellm-sidebar" aria-label="Scoring controls">
                <div class="prellm-sidebar-card">
                  <div style="font-size:13px;font-weight:600;margin-bottom:10px">${T("liveFunnel", "Live funnel")}</div>
                  <div id="prellm-live-totals" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-variant-numeric:tabular-nums"></div>
                </div>
                <div class="prellm-formula-card">
                  <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start;margin-bottom:10px">
                    <strong style="font-size:15px">${T("scoreFormula", "Score formula")}</strong>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                      <button type="button" class="btn btn-sm" id="prellm-save-formula">Save</button>
                      <button type="button" class="btn-ghost btn-sm" id="prellm-save-cutoff-snapshot" title="Writes cutoff + funnel counts to this import">Save cutoff</button>
                    </div>
                  </div>
                  <div id="prellm-formula-hint" class="runs-ops-hint" style="margin-bottom:8px;font-size:13px;line-height:1.45"></div>
                  <div style="font-size:12px;color:var(--muted);margin-bottom:6px">${T("activeWeights", "Active weights")}</div>
                  <div id="prellm-active-weights-strip" style="font-size:13px;color:var(--fg2);margin-bottom:12px;min-height:1.2em;line-height:1.5"></div>
                  <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:12px">
                    <label style="font-size:13px;display:flex;flex-wrap:wrap;align-items:center;gap:8px">${T("profileMinScore", "Profile min score")} <input id="prellm-profile-min" type="number" min="0" max="1" step="0.01" style="width:96px;font-size:14px;padding:6px 8px" /></label>
                    <label style="font-size:13px;display:flex;flex-wrap:wrap;align-items:center;gap:8px">${T("minPrimaryTextChars", "Min primary text chars")} <input id="prellm-min-text" type="number" min="0" max="5000" step="1" style="width:96px;font-size:14px;padding:6px 8px" /></label>
                  </div>
                  <div id="prellm-weights-wrap" style="max-height:220px;overflow:auto;border:1px solid var(--border);border-radius:8px;background:var(--bg)"></div>
                  <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                    <button type="button" class="btn-ghost btn-sm" id="prellm-add-weight">Add feature</button>
                    <span id="prellm-save-msg" style="font-size:12px;color:var(--muted)"></span>
                  </div>
                  <span id="prellm-cutoff-snapshot-msg" style="display:block;margin-top:8px;font-size:12px;color:var(--muted)"></span>
                </div>
                <details id="prellm-debug" style="margin:0">
                  <summary style="cursor:pointer;font-size:12px;color:var(--muted)">Debug (pre-LLM preview JSON)</summary>
                  <pre id="prellm-counts" style="font-size:12px;background:var(--bg);padding:10px;border-radius:8px;margin-top:8px;white-space:pre-wrap;max-height:260px;overflow:auto"></pre>
                </details>
              </aside>
              <div class="prellm-main">
                <div id="prellm-kind-bar" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px"></div>
                <div id="prellm-table-toolbar" style="margin:0 0 10px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--card)">
                  <div style="font-size:13px;font-weight:600;margin-bottom:8px">${T("tableFilters", "Table filters")}</div>
                  <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
                    <label style="font-size:13px;color:var(--fg2);display:flex;gap:6px;align-items:center">
                      <input type="checkbox" id="prellm-show-below" style="margin:0" />
                      <span>${T("showBelowCutoff", "Below cutoff")}</span>
                    </label>
                    <label style="font-size:13px;color:var(--fg2);display:flex;gap:6px;align-items:center">
                      Sort
                      <select id="prellm-sort" style="font-size:13px;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text)">
                        <option value="score_desc">Score ↓</option>
                        <option value="score_asc">Score ↑</option>
                      </select>
                    </label>
                    <label style="font-size:13px;color:var(--fg2)">Search
                      <input id="prellm-filter-search" type="search" placeholder="Caption, hashtags, URL..." style="display:block;margin-top:4px;width:min(220px,40vw);font-size:13px;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" />
                    </label>
                    <label style="font-size:13px;color:var(--fg2)">${T("displayKind", "Display kind")}
                      <select id="prellm-filter-kind" style="display:block;margin-top:4px;font-size:13px;min-width:140px;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
                        <option value="">Any</option>
                      </select>
                    </label>
                    <label style="font-size:13px;color:var(--fg2)">${T("includedColumn", "Included")}
                      <select id="prellm-filter-included" style="display:block;margin-top:4px;font-size:13px;min-width:100px;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
                        <option value="any">Any</option>
                        <option value="yes">yes</option>
                        <option value="no">no</option>
                      </select>
                    </label>
                    <label style="font-size:13px;color:var(--fg2)">${T("cutoffScore", "Min score")}
                      <input id="prellm-filter-min-score" type="number" min="0" max="1" step="0.01" placeholder="any" style="display:block;margin-top:4px;width:92px;font-size:13px;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" />
                    </label>
                    <button type="button" class="btn-ghost btn-sm" id="prellm-filter-clear" style="align-self:flex-end">Clear filters</button>
                  </div>
                  <p id="prellm-filter-summary" class="runs-ops-hint" style="margin:8px 0 0;font-size:11px">Load evidence to filter rows in the table below.</p>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 8px">
                  <button type="button" class="btn-ghost btn-sm" id="btn-copy-prellm-tsv" title="Tab-separated values from the scored evidence table">Copy table</button>
                  <button type="button" class="btn-ghost btn-sm" id="btn-copy-prellm-json" title="JSON rows from the filtered evidence table">Copy JSON</button>
                  <span id="prellm-copy-msg" style="font-size:11px;color:var(--muted)"></span>
                </div>
                <div id="prellm-table-wrap" style="font-size:12px;max-height:min(72vh,720px);overflow:auto;border:1px solid var(--border);border-radius:8px"></div>
              </div>
            </div>
          </div>
        </div>
        <div id="panel-broad" style="display:none;padding:12px 0 0">
          <div style="font-size:13px;font-weight:600;margin-bottom:10px">${T("broadInsights", "Broad insights")}</div>
          <details id="inspect-api-details" style="margin:0 0 14px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--bg)">
            <summary style="cursor:pointer;font-size:13px;font-weight:600">Inspect — load live API JSON here (same auth as this page)</summary>
            <p class="runs-ops-hint" style="margin:8px 0 10px">Use this to see raw responses without curl. Server-side logs: <span class="mono">fly logs -a caf-core</span> (or your host); search for <span class="mono">inputs_top_performer</span> / OpenAI step names in <span class="mono">api_call_audit</span>.</p>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;align-items:center">
              <button type="button" class="btn-ghost btn-sm" id="btn-inspect-import-stats">Import stats</button>
              <button type="button" class="btn-ghost btn-sm" id="btn-inspect-profile">Processing profile</button>
              <button type="button" class="btn-ghost btn-sm" id="btn-inspect-audit">API audit (recent)</button>
              <button type="button" class="btn-ghost btn-sm" id="btn-inspect-tp-deep">Insights · top_performer_deep</button>
              <button type="button" class="btn-ghost btn-sm" id="btn-inspect-tp-carousel">Insights · top_performer_carousel</button>
              <button type="button" class="btn-ghost btn-sm" id="btn-inspect-tp-video">Insights · top_performer_video</button>
              <button type="button" class="btn-ghost btn-sm" id="btn-inspect-prellm-sample">Pre-LLM sample rows</button>
              <button type="button" class="btn-ghost btn-sm" id="btn-inspect-copy-pre">Copy response body</button>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
              <label style="font-size:12px;color:var(--muted)">Evidence row id
                <input id="inspect-row-id" type="text" class="mono" placeholder="caf_core.inputs_evidence.id (uuid)" style="width:min(360px,94vw);font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--text)" />
              </label>
              <button type="button" class="btn btn-sm" id="btn-inspect-evidence-row">Fetch evidence row</button>
            </div>
            <pre id="inspect-api-pre" style="font-size:11px;background:var(--card);padding:10px;border-radius:8px;max-height:460px;overflow:auto;white-space:pre-wrap;border:1px solid var(--border);margin:0;color:var(--text)">Click a button above.</pre>
          </details>
          <p class="runs-ops-hint" style="margin-bottom:10px">Broad insights are text-only LLM analysis (<span class="mono">broad_llm</span>) per <strong>social platform</strong> evidence row. Source kinds (<span class="mono">source_registry</span>, <span class="mono">scraped_page</span>) stay under <strong>Sources</strong> — they are not run here.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
            <button type="button" class="btn btn-sm" id="btn-run-broad-insights-all" title="${PL("INSIGHTS__Broad_LLM_v1", "Processing", "All platform tabs — may overwrite if Rescan is on")}">Analyze all selected evidence</button>
            <button type="button" class="btn-ghost btn-sm" id="btn-run-broad-insights" title="${PL("INSIGHTS__Broad_LLM_v1", "Processing", "Current platform tab only — may overwrite if Rescan is on")}">Analyze this platform only</button>
            <button type="button" class="btn-ghost btn-sm" id="btn-toggle-broad-prompt">Prompt & labels</button>
            <label style="font-size:12px;color:var(--muted);display:flex;gap:6px;align-items:center">${T("maxInsightRows", "Max rows")} <input id="broad-max-rows" type="number" min="1" max="5000" value="800" style="width:92px;font-size:12px" /></label>
            <label style="font-size:12px;color:var(--muted);display:flex;gap:6px;align-items:center"><input id="broad-rescan" type="checkbox" /> ${T("rescanInsights", "Rescan")}</label>
            <label style="font-size:12px;color:var(--muted);display:flex;gap:6px;align-items:center"><input id="broad-use-cutoff" type="checkbox" checked /> ${T("useCutoff", "Use cutoff")}</label>
            <span id="broad-eligible-msg" style="font-size:12px;color:var(--muted);max-width:520px"></span>
            <span id="prellm-insight-msg" style="font-size:12px;color:var(--muted);max-width:520px"></span>
          </div>
          <div id="broad-prompt-panel" style="display:none;border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--bg);margin-bottom:10px">
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-bottom:8px">
              <strong style="font-size:12px">Prompt preview + overrides</strong>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                <button type="button" class="btn-ghost btn-sm" id="btn-load-broad-prompt">Load current prompt</button>
                <button type="button" class="btn-ghost btn-sm" id="btn-reset-broad-prompt">Reset overrides</button>
                <button type="button" class="btn-ghost btn-sm" id="btn-save-broad-labels">Save labels</button>
              </div>
            </div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:8px">
              You can edit the prompts and labels below. Use <span class="mono">{{ROWS_JSON}}</span> to control where the batch payload is inserted (otherwise it’s appended).
              Labels can also be referenced as <span class="mono">{{CUSTOM_LABEL_1}}</span>, <span class="mono">{{CUSTOM_LABEL_2}}</span>, <span class="mono">{{CUSTOM_LABEL_3}}</span>.
              <span style="display:block;margin-top:6px">If you loaded a prompt preview, don’t keep a hard-coded <span class="mono">Rows (JSON): …</span> snapshot in your override — it will go stale across batches. Prefer <span class="mono">{{ROWS_JSON}}</span> (or leave the default user prompt alone).</span>
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
              <label style="font-size:12px;color:var(--muted)">custom_label_1 <input id="broad-label-1" type="text" maxlength="120" style="width:220px;font-size:12px" placeholder="e.g. Angle / Theme" /></label>
              <label style="font-size:12px;color:var(--muted)">custom_label_2 <input id="broad-label-2" type="text" maxlength="120" style="width:220px;font-size:12px" /></label>
              <label style="font-size:12px;color:var(--muted)">custom_label_3 <input id="broad-label-3" type="text" maxlength="120" style="width:220px;font-size:12px" /></label>
              <span id="broad-prompt-msg" style="font-size:11px;color:var(--muted)"></span>
            </div>
            <div style="display:grid;grid-template-columns:1fr;gap:10px">
              <div>
                <div style="font-size:12px;color:var(--muted);margin-bottom:6px">System prompt</div>
                <textarea id="broad-system-prompt" rows="6" style="width:100%;font-family:ui-monospace,monospace;font-size:11px"></textarea>
              </div>
              <div>
                <div style="font-size:12px;color:var(--muted);margin-bottom:6px">User prompt</div>
                <textarea id="broad-user-prompt" rows="8" style="width:100%;font-family:ui-monospace,monospace;font-size:11px"></textarea>
              </div>
            </div>
          </div>
          <div id="broad-kind-bar" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px"></div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
            <button type="button" class="btn-ghost btn-sm" id="btn-reload-broad">Reload broad insights</button>
            <label style="font-size:12px;color:var(--muted);display:flex;gap:6px;align-items:center">Sort
              <select id="broad-insight-sort" style="font-size:12px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
                <option value="rating_desc">Row rating ↓</option>
                <option value="pre_llm_desc">Pre-LLM score ↓</option>
                <option value="updated_desc">Updated ↓</option>
              </select>
            </label>
            <label style="font-size:12px;color:var(--muted);display:flex;gap:6px;align-items:center">Rows
              <select id="broad-insight-limit" style="font-size:12px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
                <option value="80">80</option>
                <option value="120">120</option>
                <option value="200" selected>200</option>
              </select>
            </label>
            <button type="button" class="btn-ghost btn-sm" id="btn-copy-broad-tsv" title="Tab-separated values from the broad insights table">Copy table</button>
            <button type="button" class="btn-ghost btn-sm" id="btn-copy-broad-json" title="JSON rows from the filtered insights table">Copy JSON</button>
            <button type="button" class="btn-ghost btn-sm" id="btn-copy-broad-debug" style="display:none">Copy last run debug</button>
            <span class="runs-ops-hint" style="margin:0;font-size:11px;max-width:640px"><strong>Reload broad insights</strong> re-fetches the table below from the database (no LLM). Use it after a run finishes or if another session wrote rows.</span>
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:stretch;margin:10px 0">
            <div style="flex:1;min-width:320px;border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--bg)">
              <div style="font-size:12px;font-weight:600;margin-bottom:6px">State</div>
              <div id="broad-state" style="font-size:12px;color:var(--muted)"></div>
            </div>
            <details id="broad-meta-debug" style="flex:1;min-width:320px;margin:0">
              <summary style="cursor:pointer;font-size:12px;color:var(--muted)">Debug (broad meta JSON)</summary>
              <pre id="broad-meta" style="font-size:12px;background:var(--bg);padding:10px;border-radius:8px;margin-top:8px;white-space:pre-wrap;max-height:260px;overflow:auto"></pre>
            </details>
          </div>
          <details id="broad-debug-details" style="display:none;margin:10px 0">
            <summary style="cursor:pointer;font-size:12px;color:var(--muted)">Last broad run debug (copy/paste this into chat)</summary>
            <pre id="broad-debug-pre" style="font-size:12px;background:var(--bg);padding:10px;border-radius:8px;margin:10px 0;white-space:pre-wrap;max-height:360px;overflow:auto"></pre>
          </details>
          <div id="broad-evidence-viewer" style="display:none;margin:10px 0;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);font-size:12px">
            <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;margin-bottom:6px">
              <div id="broad-evidence-title" class="mono" style="font-size:12px;color:var(--muted)"></div>
              <button type="button" class="btn-ghost btn-sm" id="btn-close-broad-evidence">Close</button>
            </div>
            <pre id="broad-evidence-pre" style="margin:0;white-space:pre-wrap;word-break:break-word;max-height:360px;overflow:auto"></pre>
          </div>
          <style>
            .insights-data-table,.broad-insights-table{width:100%;border-collapse:separate;border-spacing:0;table-layout:auto}
            .insights-data-table thead th,.broad-insights-table thead th{position:sticky;top:0;background:var(--card);z-index:2;box-shadow:0 1px 0 var(--border);padding:8px 10px;font-size:11px;white-space:nowrap;vertical-align:bottom}
            .insights-data-table td,.broad-insights-table td{padding:8px 10px;vertical-align:top;border-bottom:1px solid var(--border);font-size:12px}
            .insights-data-table .insight-cell-clamp,.broad-insights-table .insight-cell-clamp,.insights-data-table .insight-cell-long,.broad-insights-table .insight-cell-long{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;max-width:min(320px,36vw);min-width:min(160px,24vw);line-height:1.4;word-break:break-word;white-space:normal}
            .insights-data-table .insight-cell-mono,.broad-insights-table .insight-cell-mono{white-space:nowrap;font-variant-numeric:tabular-nums}
          </style>
          <div id="broad-table-toolbar" style="margin:10px 0;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--card)">
            <div style="font-size:12px;font-weight:600;margin-bottom:8px">Table filters</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
              <label style="font-size:12px;color:var(--muted)">Search
                <input id="broad-filter-search" type="search" placeholder="Why, hook, hashtags, ID..." style="display:block;margin-top:4px;width:min(220px,40vw);font-size:12px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" />
              </label>
              <label style="font-size:12px;color:var(--muted)">Display kind
                <select id="broad-filter-kind" style="display:block;margin-top:4px;font-size:12px;min-width:140px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
                  <option value="">Any</option>
                </select>
              </label>
              <label style="font-size:12px;color:var(--muted)">Emotion
                <select id="broad-filter-emotion" style="display:block;margin-top:4px;font-size:12px;min-width:120px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
                  <option value="">Any</option>
                </select>
              </label>
              <label style="font-size:12px;color:var(--muted)">Hook type
                <select id="broad-filter-hook-type" style="display:block;margin-top:4px;font-size:12px;min-width:120px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
                  <option value="">Any</option>
                </select>
              </label>
              <label style="font-size:12px;color:var(--muted)">Min pre-LLM
                <input id="broad-filter-min-prellm" type="number" min="0" max="1" step="0.01" placeholder="any" style="display:block;margin-top:4px;width:88px;font-size:12px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" />
              </label>
              <label style="font-size:12px;color:var(--muted)">Min rating
                <input id="broad-filter-min-rating" type="number" min="0" max="1" step="0.01" placeholder="any" style="display:block;margin-top:4px;width:88px;font-size:12px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" />
              </label>
              <button type="button" class="btn-ghost btn-sm" id="broad-filter-clear" style="align-self:flex-end">Clear filters</button>
            </div>
            <p id="broad-filter-summary" class="runs-ops-hint" style="margin:8px 0 0;font-size:11px">Reload broad insights to filter rows in the table below.</p>
          </div>
          <div id="broad-hscroll-bar" style="display:none;margin:0 0 8px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg)">
            <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
              <label style="font-size:12px;color:var(--muted);flex:1;min-width:240px">Scroll table horizontally
                <input type="range" id="broad-table-hscroll" min="0" max="100" value="0" style="display:block;margin-top:6px;width:min(480px,72vw)" />
              </label>
              <span class="runs-ops-hint" style="font-size:11px;margin:0">Drag the slider, or Shift+mousewheel on the table. All insight columns are shown.</span>
            </div>
          </div>
          <div id="broad-table-wrap" style="font-size:12px;width:100%;max-height:520px;overflow-x:auto;overflow-y:auto;border:1px solid var(--border);border-radius:8px;-webkit-overflow-scrolling:touch"></div>
        </div>
        <div id="panel-top" style="display:none;padding:12px 0 0">
          <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px">
            <div style="font-size:13px;font-weight:600">${T("topPerformers", "Top performers")}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button type="button" class="btn-ghost btn-sm" id="btn-delete-carousel-insights-import" title="Delete top_performer_carousel rows for this import">Delete carousel</button>
              <button type="button" class="btn-ghost btn-sm" id="btn-delete-top-performer-insights-import" title="Delete all top-performer insight tiers for this import">Delete all</button>
            </div>
          </div>
          <div class="tp-split-layout">
            <aside class="tp-sidebar" aria-label="Top performer runs">
              <div class="tp-sidebar-card">
                <div class="tp-pass-card" data-tp-pass="image">
                  <div class="tp-pass-head"><strong>Image</strong><span id="tp-badge-image" class="badge badge-b">idle</span></div>
                  <button type="button" class="btn btn-sm tp-pass-run" id="btn-run-deep-image-insights" title="${PL("INSIGHTS__Top_Performer_Image_v1", "Processing")}">Run image pass</button>
                  <div id="tp-st-image" class="tp-pass-status">Single-image vision on top-rated rows.</div>
                </div>
                <div class="tp-pass-card" data-tp-pass="carousel">
                  <div class="tp-pass-head"><strong>Carousel</strong><span id="tp-badge-carousel" class="badge badge-b">idle</span></div>
                  <button type="button" class="btn btn-sm tp-pass-run" id="btn-run-deep-carousel-insights" title="${PL("INSIGHTS__Top_Performer_Carousel_v1", "Processing")}">Run carousel pass</button>
                  <div id="tp-st-carousel" class="tp-pass-status">Multi-slide deck vision — needs ≥2 HTTPS slide URLs in evidence.</div>
                  <div id="tp-qualify-carousel-wrap" style="display:none" class="tp-qualify-compact">
                    <div data-tp-qualify-title="1" style="font-weight:600;color:var(--text)">Qualifying rows</div>
                    <ul id="tp-qualify-carousel-list"></ul>
                  </div>
                </div>
                <div class="tp-pass-card" data-tp-pass="video">
                  <div class="tp-pass-head"><strong>Video</strong><span id="tp-badge-video" class="badge badge-b">idle</span></div>
                  <button type="button" class="btn btn-sm tp-pass-run" id="btn-run-deep-video-insights" title="${PL("INSIGHTS__Top_Performer_Video_Frames_v1", "Processing")}">Run video pass</button>
                  <div id="tp-st-video" class="tp-pass-status">Frame bundle vision — needs frame or poster URLs on evidence rows.</div>
                  <div id="tp-qualify-video-wrap" style="display:none" class="tp-qualify-compact">
                    <div data-tp-qualify-title="1" style="font-weight:600;color:var(--text)">Qualifying rows</div>
                    <ul id="tp-qualify-video-list"></ul>
                  </div>
                </div>
              </div>
              <div class="tp-sidebar-card">
                <div style="font-size:12px;font-weight:600;margin-bottom:10px">Run settings</div>
                <div class="tp-setting-grid">
                  <div class="tp-setting-row">
                    <label style="white-space:nowrap" title="Top fraction of media-eligible rows to run vision on">Top %</label>
                    <input id="tp-rating-top-pct" type="number" min="0.01" max="50" step="any" value="3" placeholder="profile" style="width:72px;font-size:12px;padding:5px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" />
                    <span style="font-size:11px;color:var(--muted)">of eligible rows (per format)</span>
                  </div>
                  <label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;color:var(--fg2)">
                    <input id="tp-vision-rescan" type="checkbox" style="margin-top:3px" />
                    <span>Rescan rows that already have this tier</span>
                  </label>
                  <label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;color:var(--fg2)">
                    <input id="tp-rating-gate-off" type="checkbox" style="margin-top:3px" />
                    <span>Legacy gate only (disable top-%)</span>
                  </label>
                </div>
              </div>
              <details style="font-size:12px;color:var(--muted)">
                <summary style="cursor:pointer;font-weight:500;color:var(--fg2)">Debug &amp; requirements</summary>
                <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">
                  <button type="button" class="btn-ghost btn-sm" id="btn-copy-top-log-image">Copy image log</button>
                  <button type="button" class="btn-ghost btn-sm" id="btn-copy-top-log-carousel">Copy carousel log</button>
                  <button type="button" class="btn-ghost btn-sm" id="btn-copy-top-log-video">Copy video log</button>
                  <button type="button" class="btn-ghost btn-sm" id="btn-copy-top-log-all">Copy all logs</button>
                </div>
                <pre id="top-perf-debug-pre" style="font-size:10px;background:var(--bg);padding:8px;border-radius:8px;margin:8px 0 0;white-space:pre-wrap;max-height:200px;overflow:auto;color:var(--muted);border:1px solid var(--border)">{}</pre>
                <p style="margin:10px 0 0;font-size:11px;line-height:1.45">Carousel needs slide URLs in <span class="mono">payload_json</span>. Video needs <span class="mono">frame_urls</span> or poster fields. Full API responses live in debug logs above.</p>
              </details>
            </aside>
            <div class="tp-main">
              <div class="tp-tabs" role="tablist">
                <button type="button" class="tp-tab active" data-tp-tab="image" role="tab" aria-selected="true">Image <span id="tp-count-image" class="tp-tab-count">—</span></button>
                <button type="button" class="tp-tab" data-tp-tab="carousel" role="tab">Carousel <span id="tp-count-carousel" class="tp-tab-count">—</span></button>
                <button type="button" class="tp-tab" data-tp-tab="video" role="tab">Video <span id="tp-count-video" class="tp-tab-count">—</span></button>
              </div>
              <div class="tp-tab-panel active" data-tp-panel="image">
                <div class="tp-table-toolbar">
                  <button type="button" class="btn-ghost btn-sm" id="btn-reload-deep-image">Reload</button>
                  <button type="button" class="btn-ghost btn-sm" id="btn-copy-deep-image-tsv">Copy table</button>
                  <button type="button" class="btn-ghost btn-sm" id="btn-copy-deep-image-json">Copy JSON</button>
                </div>
                <div id="deep-image-table" class="tp-insights-table-wrap"></div>
              </div>
              <div class="tp-tab-panel" data-tp-panel="carousel">
                <div class="tp-table-toolbar">
                  <button type="button" class="btn-ghost btn-sm" id="btn-reload-deep-carousel">Reload</button>
                  <button type="button" class="btn-ghost btn-sm" id="btn-copy-deep-carousel-tsv">Copy table</button>
                  <button type="button" class="btn-ghost btn-sm" id="btn-copy-deep-carousel-json">Copy JSON</button>
                </div>
                <div id="deep-carousel-table" class="tp-insights-table-wrap"></div>
              </div>
              <div class="tp-tab-panel" data-tp-panel="video">
                <div class="tp-table-toolbar">
                  <button type="button" class="btn-ghost btn-sm" id="btn-reload-deep-video">Reload</button>
                  <button type="button" class="btn-ghost btn-sm" id="btn-copy-deep-video-tsv">Copy table</button>
                  <button type="button" class="btn-ghost btn-sm" id="btn-copy-deep-video-json">Copy JSON</button>
                </div>
                <div id="deep-video-table" class="tp-insights-table-wrap"></div>
              </div>
            </div>
          </div>
        </div>
        <div id="panel-profile" style="display:none;padding:12px 0 0">
          <p class="runs-ops-hint">Models, caps, <span class="mono">criteria_json</span> (pre-LLM, top_performer, insight column labels). <strong>Ideas from insights</strong> passes up to <span class="mono">max_insights_for_ideas_llm</span> insight rows into the LLM (including at least <span class="mono">min_top_performer_insights_for_ideas_llm</span> top-performer–enriched rows when available), then writes up to <span class="mono">max_ideas_in_signal_pack</span> rows into <span class="mono">ideas_json</span>. Uses the same <span class="mono">synth_model</span> as overall synthesis.</p>
          <form id="profile-form" class="config-form" style="max-width:720px">
            <div class="form-group"><label>Rating model</label><input type="text" name="rating_model" id="pf-rating-model" placeholder="gpt-4o-mini"></div>
            <div class="form-group"><label>Synthesis model</label><input type="text" name="synth_model" id="pf-synth-model" placeholder="gpt-4o-mini"></div>
            <div class="form-group"><label>Max rows to rate (per import)</label><input type="number" name="max_rows_for_rating" id="pf-max-rows" min="1" max="5000"></div>
            <div class="form-group"><label>Rows per OpenAI batch</label><input type="number" name="max_rows_per_llm_batch" id="pf-batch" min="1" max="80"></div>
            <div class="form-group"><label>Max ideas in signal pack (<span class="mono">ideas_json</span> output count)</label><input type="number" name="max_ideas_in_signal_pack" id="pf-ideas" min="1" max="200"></div>
            <div class="form-group"><label>Max insights for idea-creation LLM</label><input type="number" name="max_insights_for_ideas_llm" id="pf-insights-ctx" min="20" max="2000" title="Cap on evidence-level insight rows sent as context to the ideas LLM"></div>
            <div class="form-group"><label>Min top-performer rows in that context</label><input type="number" name="min_top_performer_insights_for_ideas_llm" id="pf-min-tp-ctx" min="0" max="500" title="Target minimum context rows that include top-performer analysis; must be ≤ max insights"></div>
            <div class="form-group"><label>Min LLM score to include before synthesis pool</label><input type="number" name="min_llm_score_for_pack" id="pf-min" step="0.01" min="0" max="1"></div>
            <div class="form-group"><label>criteria_json (JSON)</label><textarea name="criteria_json" id="pf-criteria" rows="8" style="width:100%;font-family:ui-monospace,monospace;font-size:11px"></textarea></div>
            <div class="form-group"><label>Extra instructions (prepended to rating prompt)</label><textarea name="extra_instructions" id="pf-extra" rows="4" style="width:100%"></textarea></div>
            <button type="submit" class="btn">Save profile</button>
          </form>
          <h3 style="font-size:14px;margin:20px 0 8px">Recent OpenAI / pipeline audit</h3>
          <button type="button" class="btn-ghost btn-sm" id="btn-reload-audit">Refresh audit</button>
          <div id="audit-root" style="margin-top:10px;font-size:11px;max-height:420px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px">Loading…</div>
        </div>
        <div id="panel-sources" style="display:none;padding:12px 0 0">
          <p class="runs-ops-hint" style="margin-bottom:10px">Sources are non-social evidence kinds like <span class="mono">source_registry</span> and <span class="mono">scraped_page</span>.</p>
          <div id="sources-kind-bar" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px"></div>
          <pre id="sources-meta" style="font-size:12px;background:var(--bg);padding:10px;border-radius:8px;margin:10px 0;white-space:pre-wrap"></pre>
          <div id="sources-table-wrap" style="font-size:12px;max-height:520px;overflow:auto;border:1px solid var(--border);border-radius:8px"></div>
        </div>
        <div id="panel-ideas" style="display:none;padding:12px 0 0">
          <div style="font-size:13px;font-weight:600;margin-bottom:10px">${T("buildIdeas", "Build ideas")}</div>
          <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:12px">
            <div class="form-group" style="margin:0;min-width:200px;flex:1;max-width:360px">
              <label style="font-size:12px">List title (optional)</label>
              <input type="text" id="idea-list-title" style="width:100%;font-size:12px;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" placeholder="e.g. Jan sprint" maxlength="200"/>
            </div>
            <div class="form-group" style="margin:0;width:120px">
              <label style="font-size:12px">Target # ideas</label>
              <input type="number" id="idea-list-target" min="1" max="200" value="35" style="width:100%;font-size:12px;padding:6px 8px;border-radius:8px;border:1px solid var(--border)"/>
            </div>
            <button type="button" class="btn btn-sm" id="btn-generate-idea-list" title="${PL("IDEAS__From_Insights_v1", "Processing")}">Generate idea list (LLM)</button>
            <span id="idea-list-generate-msg" style="font-size:12px;color:var(--muted)"></span>
          </div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
            <label style="font-size:12px;color:var(--muted)">Idea list
              <select id="idea-list-select" style="min-width:min(100%,400px);max-width:100%;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
                <option value="">Select an import first</option>
              </select>
            </label>
            <button type="button" class="btn-ghost btn-sm" id="btn-reload-idea-lists">Reload</button>
            <span id="ideas-state" style="font-size:12px;color:var(--muted)"></span>
          </div>
          <div id="ideas-toolbar" style="margin:0 0 10px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--card)">
            <div style="font-size:12px;font-weight:600;margin-bottom:8px">Review &amp; filter ideas</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end">
              <label style="font-size:11px;color:var(--muted)">Search<br />
                <input id="ideas-filter-search" type="search" placeholder="Title, hook, 3-liner…" style="width:min(220px,40vw);font-size:12px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" />
              </label>
              <label style="font-size:11px;color:var(--muted)">Format<br />
                <select id="ideas-filter-format" style="font-size:12px;min-width:120px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
                  <option value="">Any</option>
                  <option value="carousel">carousel</option>
                  <option value="video">video</option>
                  <option value="post">post</option>
                  <option value="thread">thread</option>
                </select>
              </label>
              <label style="font-size:11px;color:var(--muted)">Platform<br />
                <select id="ideas-filter-platform" style="font-size:12px;min-width:130px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
                  <option value="">Any</option>
                </select>
              </label>
              <label style="font-size:11px;color:var(--muted);display:flex;gap:6px;align-items:center;align-self:center;margin-top:14px">
                <input type="checkbox" id="ideas-filter-selected" /> Selected only
              </label>
              <label style="font-size:11px;color:var(--muted)">Sort<br />
                <select id="ideas-sort" style="font-size:12px;min-width:150px;padding:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
                  <option value="confidence_desc">Confidence ↓</option>
                  <option value="confidence_asc">Confidence ↑</option>
                  <option value="title_asc">Title A→Z</option>
                  <option value="title_desc">Title Z→A</option>
                  <option value="format_asc">Format</option>
                  <option value="platform_asc">Platform</option>
                </select>
              </label>
              <button type="button" class="btn-ghost btn-sm" id="btn-ideas-clear-filters" title="Reset search and filters">Clear filters</button>
              <button type="button" class="btn-ghost btn-sm" id="btn-copy-ideas-tsv" title="Tab-separated values from the visible table">Copy table</button>
              <button type="button" class="btn-ghost btn-sm" id="btn-copy-ideas-json" title="JSON for ideas currently shown (after filters)">Copy JSON</button>
            </div>
            <p id="ideas-filter-summary" class="runs-ops-hint" style="margin:8px 0 0;font-size:11px">Load or generate an idea list to review rows here.</p>
          </div>
          <details id="idea-list-debug" style="margin:0 0 8px">
            <summary style="cursor:pointer;font-size:12px;color:var(--muted)">Debug (idea list JSON)</summary>
            <pre id="idea-list-list-meta" style="font-size:12px;background:var(--bg);padding:8px 10px;border-radius:8px;white-space:pre-wrap;max-height:160px;overflow:auto;margin-top:8px"></pre>
          </details>
          <div id="idea-preview" style="display:none;margin:10px 0;border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--bg)">
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-bottom:8px">
              <div style="min-width:240px">
                <div style="font-size:12px;color:var(--muted)">Selected idea</div>
                <div id="idea-preview-title" style="font-size:13px;font-weight:600"></div>
              </div>
              <button type="button" class="btn-ghost btn-sm" id="btn-close-idea-preview">Close</button>
            </div>
            <div id="idea-preview-body" style="font-size:12px;white-space:pre-wrap;word-break:break-word"></div>
            <details style="margin-top:10px">
              <summary style="cursor:pointer;font-size:12px;color:var(--muted)">Debug (raw idea_json)</summary>
              <pre id="idea-preview-json" style="font-size:11px;background:var(--bg);padding:10px;border-radius:8px;margin-top:8px;white-space:pre-wrap;max-height:320px;overflow:auto"></pre>
            </details>
          </div>
          <div id="idea-list-table-wrap" style="margin-top:8px;width:100%;max-height:480px;overflow-x:auto;overflow-y:auto;border:1px solid var(--border);border-radius:8px"></div>
        </div>
        <div id="panel-pack" style="display:none;padding:12px 0 0">
          <p class="runs-ops-hint" style="margin-bottom:10px">Prefer building from an <strong>idea list</strong> from step 4 (Build ideas), then add per-format limits if needed. The signal pack stores <span class="mono">ideas_json</span> — jobs are created when you start a run.</p>
          <div style="border:1px solid var(--border);border-radius:10px;padding:12px;background:var(--bg);margin-bottom:12px">
            <div style="font-size:13px;font-weight:600;margin-bottom:8px">Build from idea list</div>
            <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:8px">
              <label style="font-size:12px;color:var(--muted)">Idea list
                <select id="pack-idea-list-select" style="min-width:min(100%,400px);max-width:100%;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text)">
                  <option value="">—</option>
                </select>
              </label>
            </div>
            <div id="pack-summary" style="font-size:12px;color:var(--muted);margin:0 0 8px"></div>
            <p style="font-size:12px;color:var(--muted);margin:0 0 6px;max-width:800px">${T("formatCap", "Max per format")}: leave <strong>blank</strong> for no cap, <strong>0</strong> to exclude, or a number for top N by confidence within that format.</p>
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px">
              <label class="fl-cap" style="font-size:11px">Carousel <input type="number" id="fl-carousel" min="0" max="200" step="1" placeholder="—" style="width:64px;font-size:12px;padding:4px 6px;border-radius:6px;border:1px solid var(--border)"/></label>
              <label class="fl-cap" style="font-size:11px">Video <input type="number" id="fl-video" min="0" max="200" step="1" placeholder="—" style="width:64px;font-size:12px;padding:4px 6px;border-radius:6px;border:1px solid var(--border)"/></label>
              <label class="fl-cap" style="font-size:11px">Post <input type="number" id="fl-post" min="0" max="200" step="1" placeholder="—" style="width:64px;font-size:12px;padding:4px 6px;border-radius:6px;border:1px solid var(--border)"/></label>
              <label class="fl-cap" style="font-size:11px">Thread <input type="number" id="fl-thread" min="0" max="200" step="1" placeholder="—" style="width:64px;font-size:12px;padding:4px 6px;border-radius:6px;border:1px solid var(--border)"/></label>
              <label class="fl-cap" style="font-size:11px">Other <input type="number" id="fl-other" min="0" max="200" step="1" placeholder="—" style="width:64px;font-size:12px;padding:4px 6px;border-radius:6px;border:1px solid var(--border)"/></label>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <button type="button" class="btn btn-sm" id="btn-build-pack-from-idea-list" title="Builds a signal pack from the selected idea list (and optional per-format caps). Writes a new signal pack row in the database.">Build signal pack from idea list</button>
              <span id="build-from-ideas-msg" style="font-size:12px;color:var(--muted)"></span>
            </div>
          </div>
          <p class="runs-ops-hint" style="margin-bottom:8px"><strong>Full pipeline</strong> — rate + synthesize + idea LLM in one go (ignores idea lists). Review profile caps first.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
            <button type="button" class="btn-ghost btn-sm" id="btn-build-pack" title="${PL("SIGNAL_PACK__Rating_Batch_v1 + SIGNAL_PACK__Synthesize_Candidates_v1 + IDEAS__From_Insights_v1", "Processing", "Full import pipeline — rating, synthesize, then ideas LLM")}">Build signal pack (full import)</button>
            <span id="build-msg" style="font-size:12px;color:var(--muted)"></span>
          </div>
          <details id="pack-settings-debug" style="margin:10px 0">
            <summary style="cursor:pointer;font-size:12px;color:var(--muted)">Debug (config/profile JSON)</summary>
            <pre id="pack-settings" style="font-size:12px;background:var(--bg);padding:10px;border-radius:8px;white-space:pre-wrap;max-height:320px;overflow:auto;margin-top:8px"></pre>
          </details>
          <div class="card" style="margin-top:12px">
            <div class="card-h">Inspect signal pack</div>
            <div style="padding:12px 16px 16px">
              <p style="font-size:12px;color:var(--muted);margin:0 0 8px">Browse all packs in the sidebar under <strong>Processing → Signal packs</strong>. Packs hold curated <span class="mono">ideas_json</span> — not jobs.</p>
              <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px">
                <label style="font-size:12px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                  <span data-caf-term="signalPack">Signal pack</span>
                  <select id="pack-inspect-select" style="min-width:min(280px,50vw);max-width:100%;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:12px">
                    <option value="">—</option>
                  </select>
                </label>
                <button type="button" class="btn-ghost btn-sm" id="btn-pack-inspect-reload" title="Reload signal packs for this project">Reload</button>
              </div>
              <div id="pack-inspect-msg" style="margin-top:8px;font-size:12px;color:var(--muted)"></div>
              <details id="pack-inspect-ideas-details" style="display:none;margin-top:10px">
                <summary style="cursor:pointer;font-size:14px;color:var(--muted)">ideas_json (curated ideas)</summary>
                <div id="pack-inspect-ideas" style="margin-top:8px;font-size:14px;max-height:360px;overflow:auto;border:1px solid var(--border);border-radius:8px"></div>
              </details>
              <details id="pack-inspect-raw-details" style="display:none;margin-top:10px">
                <summary style="cursor:pointer;font-size:12px;color:var(--muted)">Raw signal pack JSON</summary>
                <pre id="pack-inspect-raw" style="margin-top:8px;font-size:11px;background:var(--bg);padding:10px;border-radius:8px;white-space:pre-wrap;max-height:360px;overflow:auto"></pre>
              </details>
            </div>
          </div>
        </div>
        <div id="panel-run" style="display:none;padding:12px 0 0">
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start">
            <div style="flex:1;min-width:320px">
              <h3 style="font-size:14px;margin:0 0 8px">Run</h3>
              <p class="runs-ops-hint" style="margin:0 0 12px">
                Use the signal pack from the toolbar dropdown (or the one you just built). On <strong>Runs</strong>, pick that pack and <strong>Start</strong> — that is when jobs are created from ideas.
              </p>
              <div class="card" style="padding:12px 14px;margin:0">
                <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between">
                  <div>
                    <div style="font-size:12px;color:var(--muted);margin-bottom:4px">Latest signal pack</div>
                    <div class="mono" id="run-latest-pack">—</div>
                  </div>
                  <a class="btn btn-sm" id="btn-go-runs" href="/admin/runs" title="Go to Runs to start or inspect generation runs.">Go to Runs</a>
                </div>
              </div>
              <details id="run-debug-details" style="margin-top:10px;display:none">
                <summary style="cursor:pointer;font-size:12px;color:var(--muted)">Debug (JSON)</summary>
                <pre id="run-debug-pre" style="font-size:11px;background:var(--bg);padding:10px;border-radius:8px;margin-top:8px;white-space:pre-wrap;max-height:360px;overflow:auto"></pre>
              </details>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
<script>
(function(){
  function showProcErr(msg){
    var cur=document.getElementById("processing-activity-current");
    var log=document.getElementById("processing-activity-log");
    var det=document.getElementById("processing-activity-details");
    if(cur){
      cur.textContent=String(msg||"error");
      cur.style.color="#e85c4a";
      cur.style.borderColor="#e85c4a";
    }
    if(log){log.textContent=(log.textContent?log.textContent+"\\n":"")+String(msg||"");}
    if(det)det.open=true;
  }
  window.addEventListener("error",function(ev){
    var m=ev&&ev.message?String(ev.message):"error";
    var loc=ev&&ev.filename?String(ev.filename):"(inline script)";
    if(ev&&ev.lineno)loc=loc+":"+ev.lineno;
    if(ev&&ev.colno)loc=loc+":"+ev.colno;
    showProcErr("JS error: "+m+" @ "+loc);
  });
  window.addEventListener("unhandledrejection",function(ev){
    var r=ev&&ev.reason;
    showProcErr("Unhandled promise: "+(r&&r.message?String(r.message):String(r)));
  });
  var cur=document.getElementById("processing-activity-current");
  if(cur){cur.textContent="Boot OK - loading Processing script...";cur.style.color="var(--muted)";cur.style.borderColor="var(--border)";}
})();
</script>
<script>
const SLUG=${SLUG};
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function apiErr(d,fallback){return (d&&d.message)||(d&&d.error)||fallback;}
function bind(id,ev,fn){var e=document.getElementById(id);if(e)e.addEventListener(ev,fn);}
function val(id){var e=document.getElementById(id);return e?e.value:'';}
function chk(id){var e=document.getElementById(id);return !!(e&&e.checked);}
/** Optional fields for POST …/run-deep-{image,carousel,video}-insights (merges into request body). */
function tpRatingGateRequestFields(){
  var o={};
  var el=document.getElementById('tp-rating-top-pct');
  var pctRaw=el?String(el.value||'').trim():'';
  if(pctRaw!==''){
    var pct=parseFloat(pctRaw);
    if(Number.isFinite(pct)&&pct>0) o.rating_top_fraction=Math.min(0.5,Math.max(0.0001,pct/100));
  }
  var offEl=document.getElementById('tp-rating-gate-off');
  if(offEl&&offEl.checked) o.disable_rating_percentile_gate=true;
  return o;
}
function tpPercentileStatusSnippet(d){
  if(!d||typeof d!=='object') return 'top % off';
  var active=d.percentile_gate_active!=null?d.percentile_gate_active:d.rating_gate_active;
  if(active===false) return 'top % off ('+String(d.percentile_gate_disabled||d.rating_gate_disabled||'')+')';
  var frac=d.percentile_top_fraction!=null?d.percentile_top_fraction:d.rating_top_fraction;
  var pct=Math.round(10000*(frac||0))/100;
  var basis=String(d.percentile_score_basis||'');
  var uni=Number(d.percentile_universe_count||0);
  var cap=Number(d.percentile_cap||d.rating_gate_cap||0);
  var skipped=Number(d.skipped_percentile_selection!=null?d.skipped_percentile_selection:d.skipped_rating_gate||0);
  var groups=Array.isArray(d.percentile_format_groups)?d.percentile_format_groups:[];
  var groupTxt=groups.length?(' · '+groups.map(function(g){return String(g.format_family||'?')+' '+Number(g.selected_count||0)+'/'+Number(g.universe_count||0);}).join(', ')):('');
  return 'top '+pct+'% per format family ('+basis+(basis?'':'score')+', universe '+uni+', cap '+cap+', below '+skipped+')'+groupTxt;
}
var __cafActBuf=[];
var __cafActMax=48;
function cafTs(){
  try{return new Date().toISOString().replace('T',' ').slice(0,23);}catch(e){return'';}
}
function pushProcessingActivity(line,isErr){
  var s=String(line||'');
  __cafActBuf.unshift(s);
  if(__cafActBuf.length>__cafActMax)__cafActBuf.length=__cafActMax;
  var cur=document.getElementById('processing-activity-current');
  var log=document.getElementById('processing-activity-log');
  var det=document.getElementById('processing-activity-details');
  if(cur){
    cur.textContent=s;
    cur.style.color=isErr?'var(--red)':'var(--text)';
    cur.style.borderColor=isErr?'var(--red)':'var(--border)';
  }
  if(log)log.textContent=__cafActBuf.join('\\n');
  if(det && isErr)det.open=true;
}
(function wrapCafFetchForActivity(){
  var inner=window.cafFetch;
  if(typeof inner!=='function'){
    pushProcessingActivity(cafTs()+' [setup] window.cafFetch is missing - admin layout may not have loaded; API calls will fail.',true);
    return;
  }
  window.cafFetch=function(u,o){
    o=o||{};
    var t0=Date.now();
    var method=String(o.method||'GET').toUpperCase();
    var path=String(u||'');
    try{if(path.indexOf('http')!==0)path=(window.location.origin||'')+path;}catch(e0){}
    return inner.call(window,u,o).then(function(r){
      var ms=Date.now()-t0;
      var ok=r&&r.ok;
      pushProcessingActivity(cafTs()+' '+method+' '+path+' -> HTTP '+(r?r.status:'?')+' ('+ms+'ms)',!ok);
      return r;
    },function(err){
      var ms=Date.now()-t0;
      pushProcessingActivity(cafTs()+' '+method+' '+path+' -> network error ('+ms+'ms): '+String((err&&err.message)||err),true);
      throw err;
    });
  };
})();
pushProcessingActivity(cafTs()+' [ready] Processing UI loaded | project='+(SLUG||'(none - pick sidebar or ?project=)')+' | x-caf-core-token: '+(window.__CAF_CORE_FETCH_TOKEN?'set':'not set - API may return 401 without token'),false);
bind('btn-clear-activity-log','click',function(){
  __cafActBuf=[];
  var log=document.getElementById('processing-activity-log');
  var cur=document.getElementById('processing-activity-current');
  if(log)log.textContent='';
  if(cur){cur.textContent='(log cleared)';cur.style.color='var(--muted)';cur.style.borderColor='var(--border)';}
});
/** Format numeric scores from insights API (often string); em dash when missing */
function fmtInsightScore(v){
  if(v===null||v===undefined||v==='')return '-';
  var n=(typeof v==='number')?v:parseFloat(String(v));
  if(Number.isNaN(n))return esc(String(v));
  return esc(String(Math.round(n*10000)/10000));
}
let selectedImportId='';
var selectedImportLabel='';
var importRowsCache=[];
var selectedIdeaListId='';
var prellmKind='';
var prellmKinds=[];
var broadKind='';
var broadKinds=[];
function isSourceEvidenceKind(k){
  return k==='source_registry'||k==='scraped_page';
}
function platformKindsFromStats(bk){
  return Object.keys(bk||{}).filter(function(k){return (bk[k]||0)>0&&!isSourceEvidenceKind(k);}).sort();
}
var prellmTimer=null;
var lastPrellmAllRows=null;
var lastPrellmDisplayRows=null;
var prellmTableFilterTimer=null;
var currentStep='select';
var prellmMinByKind={};
var profileCache=null; // { profile, criteria }
// Suggested defaults (mirror server-side defaults in inputs-pre-llm-rank.ts)
var PRELLM_SUGGESTED={
  reddit_post:{min_score:0.08,weights:{reddit_score:0.35,reddit_comments:0.25,reddit_upvote_ratio:0.2,text_signal:0.2}},
  tiktok_video:{min_score:0.1,weights:{tt_plays:0.35,tt_likes:0.2,tt_comments:0.15,tt_author_followers:0.15,text_signal:0.15}},
  instagram_post:{min_score:0.08,weights:{ig_likes:0.45,ig_comments:0.25,text_signal:0.3}},
  facebook_post:{min_score:0.06,weights:{fb_likes:0.35,fb_comments:0.25,fb_shares:0.2,text_signal:0.2}},
  scraped_page:{min_score:0.05,weights:{scraped_main:0.55,scraped_title:0.15,text_signal:0.3}},
  source_registry:{min_score:0.02,weights:{registry_has_link:0.35,registry_topic:0.35,registry_followers:0.3}},
  _default:{min_score:0,weights:{text_signal:1}}
};

function kindLabel(kind,mode){
  var base=String(kind||'').trim();
  var map={
    instagram_post:'IG',
    facebook_post:'FB',
    reddit_post:'RDT',
    tiktok_video:'TT',
    scraped_page:'WEB',
    source_registry:'SRC'
  };
  var p=map[base]||base.toUpperCase().slice(0,6);
  if(mode==='evidence')return p+' (platform)';
  if(mode==='insights')return p+' (broad tab)';
  if(mode==='top')return p+' Top';
  return p;
}

function readImportFromUrl(){
  try{
    var u=new URLSearchParams(window.location.search);
    var imp=u.get('import');
    if(imp&&/^[0-9a-f-]{36}$/i.test(imp))selectedImportId=imp;
  }catch(e){}
}

function setImportInUrl(id){
  var url=new URL(window.location.href);
  if(id)url.searchParams.set('import',id);else url.searchParams.delete('import');
  window.history.replaceState({},'',url.toString());
}

function fmtN(n){
  var x=parseInt(String(n||'0'),10);
  if(!Number.isFinite(x))x=0;
  return x.toLocaleString();
}

function bindCafTerms(root){if(typeof window.__bindCafTerms==='function')window.__bindCafTerms(root||document);}

function renderFunnel(totals){
  var root=document.getElementById('evidence-funnel');
  var hint=document.getElementById('evidence-funnel-hint');
  if(!root||!hint)return;
  var t=totals||{};
  var total=Number(t.rows_in_kind||0);
  var passing=Number(t.passing_profile_min||0);
  var after=Number(t.after_user_cutoff||0);
  var sparseDrop=Number(t.sparse_text_dropped||0);
  var belowDrop=Number(t.below_profile_min_dropped||0);
  root.innerHTML=
    '<span class="badge badge-b" data-caf-term="funnelTotal">TOTAL '+esc(fmtN(total))+'</span>'+
    '<span style="color:var(--muted)">-></span>'+
    '<span class="badge badge-p" data-caf-term="funnelProfile">PROFILE '+esc(fmtN(passing))+'</span>'+
    '<span style="color:var(--muted)">-></span>'+
    '<span class="badge '+(after>0?'badge-g':'badge-y')+'" data-caf-term="funnelCutoff">CUTOFF '+esc(fmtN(after))+'</span>'+
    '<span style="color:var(--muted)">-></span>'+
    '<span class="badge '+(after>0?'badge-g':'badge-y')+'" data-caf-term="funnelFinal">FINAL '+esc(fmtN(after))+'</span>';
  hint.textContent='Sparse text dropped: '+fmtN(sparseDrop)+' | Below profile min dropped: '+fmtN(belowDrop);
  bindCafTerms(root);
}

async function refreshInsightCounts(){
  try{
    if(!SLUG||!selectedImportId)return;
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/evidence-insights?tier=broad_llm&limit=1&offset=0');
    var d=await r.json().catch(function(){return {};});
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var c=d.counts||{};
    var total=(Number(c.broad_llm||0)+Number(c.top_performer_deep||0)+Number(c.top_performer_video||0)+Number(c.top_performer_carousel||0));
    stepState.insights_present=total>0;
  }catch(e){
    // no-op
  }finally{
    renderStepper();
  }
}

function syncEvidenceHeader(){
  syncImportSelect();
}

function syncImportSelect(){
  var sel=document.getElementById('imports-select');
  if(!sel)return;
  if(selectedImportId&&sel.value!==selectedImportId){
    var has=false;
    for(var i=0;i<sel.options.length;i++){
      if(sel.options[i].value===selectedImportId){has=true;break;}
    }
    if(has)sel.value=selectedImportId;
  }
}

function applyImportSelection(id){
  if(!id)return;
  if(id===selectedImportId){
    syncImportSelect();
    return;
  }
  selectedImportId=id;
  selectedImportLabel='';
  for(var i=0;i<importRowsCache.length;i++){
    var imp=importRowsCache[i];
    if(imp&&imp.id===id){
      selectedImportLabel=String(imp.upload_filename||'').trim();
      break;
    }
  }
  selectedIdeaListId='';
  stepState.evidence_valid=false;
  stepState.insights_present=false;
  stepState.ideas_present=false;
  stepState.pack_id='';
  stepState.pack_created_at='';
  setImportInUrl(selectedImportId);
  var wb=document.getElementById('import-workbench');
  if(wb)wb.style.display='block';
  syncImportSelect();
  loadImportStats();
  loadPrellmKindsAndPreview();
  setStep('evidence');
  loadIdeaListDropdowns();
}

var stepState={
  evidence_valid:false,
  insights_present:false,
  ideas_present:false,
  pack_id:'',
  pack_created_at:'',
  last_import_stats:null,
  last_prellm_preview:null
};

/** Last top-performer vision run per button (admin /processing -> Insights -> Top performers). */
var lastTopPerfLogs={image:null,carousel:null,video:null};
function refreshTopPerfDebugPre(){
  var pre=document.getElementById('top-perf-debug-pre');
  if(!pre)return;
  pre.textContent=JSON.stringify(
    {
      _note:'Re-run a button to refresh that slot. Use copy buttons for one pass or all.',
      project_slug:SLUG||null,
      inputs_import_id:selectedImportId||null,
      runs:{image:lastTopPerfLogs.image,carousel:lastTopPerfLogs.carousel,video:lastTopPerfLogs.video},
    },
    null,
    2
  );
}
function setTopPerfRunLog(kind,entry){
  if(kind==='image'||kind==='carousel'||kind==='video'){
    lastTopPerfLogs[kind]=entry;
    refreshTopPerfDebugPre();
  }
}
/** Top-level Storage archive summary for copy-to-clipboard debug JSON (carousel + video passes). */
function tpMediaArchiveFromResponse(d, passSlug){
  if(!d||typeof d!=='object')return null;
  var req=d.top_performer_media_archive_requested;
  var sup=d.top_performer_media_supabase_configured;
  var saved=Number(d.top_performer_media_archive_files_saved||0);
  var errs=Number(d.top_performer_media_archive_errors||0);
  var summary='';
  if(req===false) summary='Storage archiving disabled (env or criteria).';
  else if(!req) summary='Storage archive not requested.';
  else if(!sup) summary='Supabase not configured; no uploads.';
  else if(passSlug==='top_performer_carousel'){
    summary='Carousel: '+String(saved)+' slide image file(s) uploaded to Storage.';
    if(errs>0) summary+=' '+String(errs)+' error(s) on failed slide(s).';
  }else if(passSlug==='top_performer_video'){
    var fr=Number(d.top_performer_media_archive_frame_files_saved||0);
    var sv=Number(d.top_performer_media_archive_source_video_files_saved||0);
    summary='Video: '+String(fr)+' frame image(s) + '+String(sv)+' source video file(s) uploaded ('+String(saved)+' total OK).';
    if(errs>0) summary+=' '+String(errs)+' error(s).';
  }else{
    summary=String(saved)+' file(s) uploaded.';
    if(errs>0) summary+=' '+String(errs)+' error(s).';
  }
  var out={
    pass:passSlug,
    requested:!!req,
    supabase_configured:!!sup,
    files_saved:saved,
    upload_errors:errs,
    summary:summary
  };
  if(passSlug==='top_performer_video'){
    out.frame_files_saved=Number(d.top_performer_media_archive_frame_files_saved||0);
    out.source_video_files_saved=Number(d.top_performer_media_archive_source_video_files_saved||0);
  }
  return out;
}
async function adminCopyTextToClipboard(text){
  var t=String(text||'');
  if(!t){
    window.alert('Nothing to copy.');
    return false;
  }
  try{
    if(navigator.clipboard&&typeof navigator.clipboard.writeText==='function'){
      await navigator.clipboard.writeText(t);
      return true;
    }
  }catch(_e){/* fall through */}
  try{
    var ta=document.createElement('textarea');
    ta.value=t;
    ta.setAttribute('readonly','');
    ta.style.position='fixed';
    ta.style.left='-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    var ok=document.execCommand('copy');
    document.body.removeChild(ta);
    if(ok)return true;
  }catch(_e2){/* fall through */}
  window.alert(
    'Clipboard copy failed (browser blocked it or no secure context). Open the debug <pre> below, tap/click inside it, Select All, then Copy - or use desktop Chrome.'
  );
  try{
    var det=document.getElementById('processing-activity-details');
    if(det)det.open=true;
  }catch(_o){}
  return false;
}

function tableElementToTsv(table){
  if(!table)return '';
  var trs=table.querySelectorAll('tr');
  var lines=[];
  for(var i=0;i<trs.length;i++){
    var cells=trs[i].querySelectorAll('th,td');
    var parts=[];
    for(var j=0;j<cells.length;j++){
      var t=(cells[j].innerText||cells[j].textContent||'').replace(/\s+/g,' ').trim();
      if(t.indexOf('\\t')>=0||t.indexOf('\\n')>=0||t.indexOf('"')>=0)t='"'+t.replace(/"/g,'""')+'"';
      parts.push(t);
    }
    if(parts.length)lines.push(parts.join('\\t'));
  }
  return lines.join('\\n');
}
async function adminCopyTableFromWrap(wrapId){
  var wrap=document.getElementById(wrapId);
  if(!wrap){window.alert('Nothing to copy.');return false;}
  var table=wrap.tagName==='TABLE'?wrap:wrap.querySelector('table');
  if(!table){window.alert('Load the table first.');return false;}
  var tsv=tableElementToTsv(table);
  if(!tsv){window.alert('Table is empty.');return false;}
  return adminCopyTextToClipboard(tsv);
}
function flashAdminCopyMsg(elId,ok){
  var el=document.getElementById(elId);
  if(!el||!ok)return;
  el.textContent='Copied.';
  el.style.color='var(--muted)';
  setTimeout(function(){if(el.textContent==='Copied.')el.textContent='';},2200);
}

var lastBroadInsightsRows=null;
var lastBroadInsightsAllRows=null;
var lastBroadInsightsDisplayRows=null;
var broadTableFilterTimer=null;
var broadHscrollSyncing=false;
var BROAD_INSIGHT_TABLE_COLS=[
  {key:'insights_id',label:'Insight ID'},
  {key:'source_evidence_row_id',label:'Evidence row'},
  {key:'evidence_post_url',label:'Post URL'},
  {key:'evidence_kind',label:'Kind'},
  {key:'pre_llm_score',label:'Pre-LLM score'},
  {key:'evidence_rating_score',label:'Row rating'},
  {key:'llm_model',label:'Model'},
  {key:'updated_at',label:'Updated'},
  {key:'hook_type',label:'Hook type'},
  {key:'cta_type',label:'CTA type'},
  {key:'caption_style',label:'Caption style'},
  {key:'hashtags',label:'Hashtags'},
  {key:'why_it_worked',label:'Why it worked'},
  {key:'hook_text',label:'Hook'},
  {key:'primary_emotion',label:'Emotion'},
  {key:'secondary_emotion',label:'Emotion (2)'},
  {key:'custom_label_1',label:'Label 1'},
  {key:'custom_label_2',label:'Label 2'},
  {key:'custom_label_3',label:'Label 3'},
  {key:'risk_flags_json',label:'Risk flags'}
];
var TOP_PERFORMER_INSIGHT_TABLE_COLS=[
  {key:'analysis_tier',label:'Tier'},
  {key:'evidence_kind',label:'Platform'},
  {key:'source_evidence_row_id',label:'Row ID'},
  {key:'evidence_post_url',label:'Post URL'},
  {key:'insights_id',label:'Insight ID'},
  {key:'llm_model',label:'Model'},
  {key:'updated_at',label:'Updated'},
  {key:'pre_llm_score',label:'Pre-LLM'},
  {key:'evidence_rating_score',label:'Row rating'},
  {key:'hook_type',label:'Hook type'},
  {key:'cta_type',label:'CTA type'},
  {key:'caption_style',label:'Caption style'},
  {key:'hashtags',label:'Hashtags'},
  {key:'why_it_worked',label:'Why'},
  {key:'hook_text',label:'Hook text'},
  {key:'primary_emotion',label:'Emotion (1)'},
  {key:'secondary_emotion',label:'Emotion (2)'},
  {key:'custom_label_1',label:'Label 1'},
  {key:'custom_label_2',label:'Label 2'},
  {key:'custom_label_3',label:'Label 3'},
  {key:'risk_flags_json',label:'Risk flags'},
  {key:'aesthetic_analysis_json',label:'Aesthetic'},
  {key:'raw_llm_json',label:'Raw LLM'}
];
var lastOpLensPayload=null;
var lastInspectBody='';
async function runInspectApi(label,url,needImport){
  var pre=document.getElementById('inspect-api-pre');
  if(!pre)return;
  if(!SLUG){
    pre.textContent='Add ?project=YOUR_SLUG to the Processing URL.';
    pre.style.color='var(--red)';
    lastInspectBody='';
    return;
  }
  if(needImport&&!selectedImportId){
    pre.textContent='Select an import (step 1) first.';
    pre.style.color='var(--red)';
    lastInspectBody='';
    return;
  }
  pre.style.color='';
  pre.textContent='Loading '+label+'...';
  try{
    var r=await cafFetch(url);
    var txt=await r.text();
    var pretty=txt;
    try{
      pretty=JSON.stringify(JSON.parse(txt),null,2);
    }catch(_e){}
    lastInspectBody=pretty;
    pre.textContent=label+' | HTTP '+r.status+'\\n\\n'+pretty;
    if(!r.ok)pre.style.color='var(--red)';
  }catch(e){
    lastInspectBody='';
    pre.textContent=String(e.message||e);
    pre.style.color='var(--red)';
    try{pushProcessingActivity(cafTs()+' Inspect '+label+': '+String(e.message||e),true);}catch(_b){}
  }
}

/** Top-performer panel: compact status + badge per pass. */
function tpPassBadge(which,state){
  var id='tp-badge-'+(which==='image'?'image':which==='carousel'?'carousel':'video');
  var el=document.getElementById(id);
  if(!el)return;
  var labels={idle:['badge-b','idle'],running:['badge-y','running'],ok:['badge-g','done'],err:['badge-r','error']};
  var m=labels[state]||labels.idle;
  el.className='badge '+m[0];
  el.textContent=m[1];
}
function tpSelectTab(which){
  document.querySelectorAll('.tp-tab').forEach(function(btn){
    var on=(btn.getAttribute('data-tp-tab')||'')===which;
    btn.classList.toggle('active',on);
    btn.setAttribute('aria-selected',on?'true':'false');
  });
  document.querySelectorAll('.tp-tab-panel').forEach(function(p){
    p.classList.toggle('active',(p.getAttribute('data-tp-panel')||'')===which);
  });
}
function tpSetTabCount(which,n){
  var id='tp-count-'+(which==='image'?'image':which==='carousel'?'carousel':'video');
  var el=document.getElementById(id);
  if(el)el.textContent=String(n);
}
function tpSetRunning(which,on){
  var card=document.querySelector('[data-tp-pass="'+which+'"]');
  if(!card)return;
  var btn=card.querySelector('.tp-pass-run');
  if(btn)btn.disabled=!!on;
}
function tpCompactPercentile(d){
  if(!d||typeof d!=='object')return '';
  var active=d.percentile_gate_active!=null?d.percentile_gate_active:d.rating_gate_active;
  if(active===false)return '';
  var frac=d.percentile_top_fraction!=null?d.percentile_top_fraction:d.rating_top_fraction;
  return ' · top '+String(Math.round(10000*(frac||0))/100)+'%';
}
function tpCompactImageStatus(d){
  return 'Analyzed '+String(d.rows_analyzed||0)+' · pool '+String(d.candidates_with_image||0)+' · total '+String(d.deep_insights_total||0)+tpCompactPercentile(d);
}
function tpCompactCarouselStatus(d){
  var s='Analyzed '+String(d.rows_analyzed||0)+' · decks '+String(d.carousel_deck_rows||0)+' · total '+String(d.carousel_insights_total||0)+tpCompactPercentile(d);
  var z=d.deep_carousel_zero_work_summary;
  if(z)s+=' · '+String(z).slice(0,72)+(String(z).length>72?'…':'');
  return s;
}
function tpCompactVideoStatus(d){
  var s='Analyzed '+String(d.rows_analyzed||0)+' · frames '+String(d.candidates_with_frames||0)+' · total '+String(d.video_insights_total||0)+tpCompactPercentile(d);
  var z=d.deep_video_zero_work_summary;
  if(z)s+=' · '+String(z).slice(0,72)+(String(z).length>72?'…':'');
  return s;
}
function setTpStatus(which,text,isErr,mode){
  var id=which==='image'?'tp-st-image':which==='carousel'?'tp-st-carousel':'tp-st-video';
  var el=document.getElementById(id);
  var st=mode||(isErr?'err':(/running|\\.\\.\\./i.test(String(text||''))?'running':'ok'));
  tpPassBadge(which,st==='idle'?'idle':st);
  if(el){
    el.textContent=String(text||'');
    el.className='tp-pass-status'+(st==='err'||isErr?' is-err':(st==='running'?' is-run':''));
    el.title=String(text||'').length>140?String(text):'';
  }
  if(st==='ok'&&!isErr)tpSelectTab(which);
}

/** After carousel or video top-performer runs: renders API qualifying_carousel_rows / qualifying_video_rows. */
function renderTpQualifyingList(which,rows){
  var wrapId=which==='carousel'?'tp-qualify-carousel-wrap':'tp-qualify-video-wrap';
  var listId=which==='carousel'?'tp-qualify-carousel-list':'tp-qualify-video-list';
  var wrap=document.getElementById(wrapId);
  var ul=document.getElementById(listId);
  if(!wrap||!ul)return;
  if(!Array.isArray(rows)||!rows.length){
    wrap.style.display='none';
    ul.innerHTML='';
    return;
  }
  wrap.style.display='block';
  var titleEl=wrap.querySelector('[data-tp-qualify-title]');
  if(titleEl){
    titleEl.textContent=(which==='carousel'?'Carousel':'Video')+' · '+rows.length+' qualifying';
  }
  ul.innerHTML=rows.slice(0,12).map(function(x){
    var tag=x.already_has_tier_insight?' · has insight':'';
    return '<li><span class="mono">'+esc(String(x.row_id||'').slice(0,12))+'</span> · '+esc(x.evidence_kind||'')+' · '+Number(x.pre_llm_score||0).toFixed(2)+tag+'</li>';
  }).join('')+(rows.length>12?('<li style="color:var(--muted)">+'+(rows.length-12)+' more…</li>'):'');
}

function setBadge(id,text,kind){
  var el=document.getElementById(id);
  if(!el)return;
  el.textContent=text;
  el.className='badge '+(kind||'badge-b');
}

function computeStepStatus(){
  var hasImport=!!selectedImportId;
  var evidenceOk=!!stepState.evidence_valid;
  var insightsOk=!!stepState.insights_present;
  var ideasOk=!!stepState.ideas_present;
  var packOk=!!stepState.pack_id;
  return {hasImport,evidenceOk,insightsOk,ideasOk,packOk};
}

function renderStepper(){
  var s=computeStepStatus();
  setBadge('step-badge-select',s.hasImport?'completed':'in progress',s.hasImport?'badge-g':'badge-y');
  setBadge('step-badge-evidence',s.evidenceOk?'completed':(s.hasImport?'in progress':'not started'),s.evidenceOk?'badge-g':(s.hasImport?'badge-y':'badge-b'));
  setBadge('step-badge-insights',s.insightsOk?'completed':(s.evidenceOk?'in progress':'not started'),s.insightsOk?'badge-g':(s.evidenceOk?'badge-y':'badge-b'));
  setBadge('step-badge-ideas',s.ideasOk?'completed':(s.insightsOk?'in progress':'not started'),s.ideasOk?'badge-g':(s.insightsOk?'badge-y':'badge-b'));
  setBadge('step-badge-pack',s.packOk?'completed':(s.ideasOk?'in progress':'not started'),s.packOk?'badge-g':(s.ideasOk?'badge-y':'badge-b'));
  setBadge('step-badge-run',s.packOk?'in progress':'not started',s.packOk?'badge-y':'badge-b');

  /**
   * Allow opening the Signal Pack inspector without completing prior stages.
   * Building packs still requires an import / idea list, but inspection should be always available.
   */
  var unlock={select:true,evidence:s.hasImport,insights:s.evidenceOk,ideas:s.insightsOk,pack:true,run:s.packOk};
  var buttons=document.querySelectorAll('.step-btn');
  buttons.forEach(function(btn){
    var step=btn.getAttribute('data-step')||'';
    var ok=!!unlock[step];
    btn.disabled=!ok && step!=='select';
    btn.className='caf-step-pill step-btn'+(step===currentStep?' active':'')+(btn.disabled?' locked':'');
    if(btn.disabled){
      btn.title='Complete the previous step first.';
    }
  });
}

function pipelineStageForStep(step){
  if(step==='insights')return 'insights';
  if(step==='ideas')return 'ideas';
  if(step==='pack')return 'signal_pack';
  if(step==='run')return 'run';
  return 'evidence';
}

function setStep(step){
  currentStep=step;
  if(typeof window.__setCafPipelineStage==='function')window.__setCafPipelineStage(pipelineStageForStep(step));
  syncEvidenceHeader();
  document.getElementById('panel-evidence').style.display=step==='evidence'?'block':'none';
  var showInsights=step==='insights';
  document.getElementById('panel-broad').style.display=showInsights?'block':'none';
  document.getElementById('panel-top').style.display=showInsights?'block':'none';
  document.getElementById('panel-ideas').style.display=step==='ideas'?'block':'none';
  document.getElementById('panel-pack').style.display=step==='pack'?'block':'none';
  document.getElementById('panel-run').style.display=step==='run'?'block':'none';
  // keep these as auxiliary panels opened via the toolbar button
  document.getElementById('panel-sources').style.display='none';
  document.getElementById('panel-profile').style.display='none';
  var lens=document.getElementById('operator-read-lens');
  if(lens)lens.style.display=showInsights?'block':'none';

  if(step==='insights'){
    initBroadPanel();
    loadDeepImageTable();
    loadDeepCarouselTable();
    loadDeepVideoTable();
    refreshInsightCounts();
    refreshTopPerfDebugPre();
  }
  if(step==='pack'){loadProfile().then(renderPackSettings);loadPackInspectDropdown();loadIdeaListDropdowns();if(getPackInspectSelectId())loadSelectedSignalPack();}
  if(step==='ideas'){loadIdeaListTab();}
  if(step==='run'){syncRunPanel();}
  renderStepper();
}

function syncRunPanel(){
  var el=document.getElementById('run-latest-pack');
  if(el){
    if(stepState.pack_id){
      el.textContent=stepState.pack_id+(stepState.pack_created_at?(' | '+String(stepState.pack_created_at)):'');
    }else{
      el.textContent='-';
    }
  }
  var link=document.getElementById('btn-go-runs');
  if(link){
    var href='/admin/runs';
    if(SLUG)href+='?project='+encodeURIComponent(SLUG);
    link.setAttribute('href',href);
  }
  var dbgDetails=document.getElementById('run-debug-details');
  var dbgPre=document.getElementById('run-debug-pre');
  if(dbgDetails&&dbgPre){
    if(stepState.pack_id){
      dbgDetails.style.display='block';
      dbgPre.textContent=JSON.stringify({signal_pack_id:stepState.pack_id,created_at:stepState.pack_created_at||null},null,2);
    }else{
      dbgDetails.style.display='none';
      dbgPre.textContent='';
    }
  }
}

document.querySelectorAll('.step-btn').forEach(function(btn){
  btn.addEventListener('click',function(){
    var step=btn.getAttribute('data-step')||'select';
    setStep(step);
  });
});

bind('btn-open-profile','click',function(){
  var p=document.getElementById('panel-profile');
  if(!p)return;
  var isOpen=p.style.display==='block';
  p.style.display=isOpen?'none':'block';
  if(!isOpen){loadProfile();loadAudit();}
});

bind('btn-toggle-operator-lens','click',function(){
  var el=document.getElementById('operator-read-lens');
  if(!el)return;
  el.style.display=el.style.display==='none'||!el.style.display?'block':'none';
});

bind('btn-toggle-activity-log','click',function(){
  var el=document.getElementById('processing-activity-wrap');
  if(!el)return;
  el.style.display=el.style.display==='none'||!el.style.display?'block':'none';
});

bind('btn-refresh-evidence','click',function(){
  loadImportStats();
  loadPrellmKindsAndPreview();
});

async function loadImports(){
  var sel=document.getElementById('imports-select');
  var root=document.getElementById('imports-root');
  var hint=document.getElementById('imports-hint');
  var wb=document.getElementById('import-workbench');
  if(!sel){try{pushProcessingActivity(cafTs()+' loadImports: #imports-select missing from DOM',true);}catch(_r){}return;}
  if(!SLUG){
    sel.innerHTML='<option value="">Select a project in the sidebar</option>';
    if(wb)wb.style.display='none';
    return;
  }
  sel.innerHTML='<option value="">Loading…</option>';
  sel.disabled=true;
  if(hint)hint.textContent='GET /v1/inputs-evidence/'+encodeURIComponent(SLUG)+' ...';
  try{pushProcessingActivity(cafTs()+' loadImports: requesting /v1/inputs-evidence/'+encodeURIComponent(SLUG),false);}catch(_p){}
  var ac=new AbortController();
  var to=setTimeout(function(){try{ac.abort();}catch(e){}},90000);
  try{
    var r=await cafFetch('/v1/inputs-evidence/'+encodeURIComponent(SLUG),{signal:ac.signal});
    var raw=await r.text();
    var d=null;
    try{d=raw?JSON.parse(raw):null;}catch(pe){
      pushProcessingActivity(cafTs()+' loadImports: response was not JSON (HTTP '+r.status+'). First 240 chars: '+String(raw||'').slice(0,240),true);
      throw new Error('Server returned non-JSON (often HTML login, 502, or CDN). Check Activity log and network tab.');
    }
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var rows=d.imports||[];
    importRowsCache=rows;
    if(selectedImportId){
      selectedImportLabel='';
      for(var si=0;si<rows.length;si++){
        var imp0=rows[si];
        if(imp0&&imp0.id===selectedImportId){
          selectedImportLabel=String(imp0.upload_filename||'').trim();
          break;
        }
      }
    }
    if(rows.length===0){
      sel.innerHTML='<option value="">No evidence imports for this project</option>';
      sel.disabled=true;
      if(hint)hint.textContent='';
      if(wb)wb.style.display='none';
      if(root)root.innerHTML='';
      return;
    }
    var h='<option value="">Pick an import…</option>';
    for(var i=0;i<rows.length;i++){
      var x=rows[i];
      var when=String(x.created_at||'').slice(0,19).replace('T',' ');
      var fn=String(x.upload_filename||'-');
      var label=when+' · '+fn+' ('+String(x.stored_row_count||0)+' rows)';
      h+='<option value="'+esc(x.id)+'"'+(x.id===selectedImportId?' selected':'')+'>'+esc(label)+'</option>';
    }
    sel.innerHTML=h;
    sel.disabled=false;
    if(hint)hint.textContent=rows.length+' import(s)';
    if(root)root.innerHTML='';
    if(selectedImportId){
      if(wb)wb.style.display='block';
      loadImportStats();
      loadPrellmKindsAndPreview();
      setStep(currentStep||'evidence');
      loadIdeaListDropdowns();
    }else if(wb)wb.style.display='none';
  }catch(e){
    var msg=String(e.message||e);
    if(msg==='AbortError'||msg.indexOf('aborted')>=0)msg='Request timed out (90s). Check Core is up, network, and auth token.';
    try{pushProcessingActivity(cafTs()+' loadImports failed: '+msg,true);}catch(_a){}
    if(hint)hint.textContent='Last error: '+msg;
    sel.innerHTML='<option value="">Could not load imports</option>';
    sel.disabled=true;
    if(root){
      root.style.display='block';
      root.innerHTML='<div class="empty" style="color:var(--red);padding:8px 0">'+esc(msg)+'</div>';
    }
  }finally{
    clearTimeout(to);
    sel.disabled=sel.options.length<=1;
  }
}

async function loadImportStats(){
  var pre=document.getElementById('import-stats');
  if(!SLUG||!selectedImportId||!pre){pre.textContent='';return;}
  pre.textContent='Loading...';
  try{
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/stats');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    pre.textContent=JSON.stringify(d,null,2);
    stepState.last_import_stats=d;
    syncEvidenceHeader();
    renderStepper();
  }catch(e){pre.textContent=String(e);}
}

async function loadProfile(){
  if(!SLUG)return;
  try{
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/profile');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var p=d.profile;
    profileCache={profile:p,criteria:(p.criteria_json||{})};
    document.getElementById('pf-rating-model').value=p.rating_model||'';
    document.getElementById('pf-synth-model').value=p.synth_model||'';
    document.getElementById('pf-max-rows').value=p.max_rows_for_rating;
    document.getElementById('pf-batch').value=p.max_rows_per_llm_batch;
    document.getElementById('pf-ideas').value=p.max_ideas_in_signal_pack;
    document.getElementById('pf-insights-ctx').value=p.max_insights_for_ideas_llm!=null?p.max_insights_for_ideas_llm:200;
    document.getElementById('pf-min-tp-ctx').value=p.min_top_performer_insights_for_ideas_llm!=null?p.min_top_performer_insights_for_ideas_llm:20;
    document.getElementById('pf-min').value=p.min_llm_score_for_pack;
    document.getElementById('pf-criteria').value=JSON.stringify(p.criteria_json||{},null,2);
    document.getElementById('pf-extra').value=p.extra_instructions||'';
  }catch(e){alert(e.message||e);}
}

async function loadProfileForPrellm(){
  if(profileCache&&profileCache.criteria)return profileCache;
  await loadProfile();
  return profileCache;
}

bind('profile-form','submit',async function(e){
  e.preventDefault();
  if(!SLUG){alert('Select a project');return;}
  var criteria;
  try{criteria=JSON.parse(document.getElementById('pf-criteria').value||'{}');}catch(err){alert('criteria_json must be valid JSON');return;}
  var body={
    rating_model:document.getElementById('pf-rating-model').value||undefined,
    synth_model:document.getElementById('pf-synth-model').value||undefined,
    max_rows_for_rating:parseInt(document.getElementById('pf-max-rows').value,10),
    max_rows_per_llm_batch:parseInt(document.getElementById('pf-batch').value,10),
    max_ideas_in_signal_pack:parseInt(document.getElementById('pf-ideas').value,10),
    max_insights_for_ideas_llm:parseInt(document.getElementById('pf-insights-ctx').value,10),
    min_top_performer_insights_for_ideas_llm:parseInt(document.getElementById('pf-min-tp-ctx').value,10),
    min_llm_score_for_pack:parseFloat(document.getElementById('pf-min').value),
    criteria_json:criteria,
    extra_instructions:document.getElementById('pf-extra').value||null
  };
  var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  var d=await r.json().catch(function(){return {};});
  if(!r.ok||!d.ok){alert(apiErr(d,'Save failed'));return;}
  alert('Saved');
});

async function loadAudit(){
  var root=document.getElementById('audit-root');
  if(!SLUG){root.textContent='Select a project.';return;}
  root.textContent='Loading...';
  try{
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/audit?limit=40');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var rows=d.audits||[];
    if(rows.length===0){root.textContent='No inputs_* audit rows yet.';return;}
    var h='';
    for(var i=0;i<rows.length;i++){
      var x=rows[i];
      h+='<div style="border-bottom:1px solid var(--border);padding:6px 0"><strong>'+esc(x.step)+'</strong> | '+esc(x.provider)+' | '+(x.ok?'ok':'fail')+' | '+esc(x.created_at)+' | model '+esc(x.model||'')+'</div>';
      h+='<pre style="margin:4px 0 8px;font-size:10px;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow:auto">'+esc(JSON.stringify({request:x.request_json,response:x.response_json},null,0).slice(0,12000))+'</pre>';
    }
    root.innerHTML=h;
  }catch(e){root.textContent=String(e);}
}

bind('btn-reload-imports','click',loadImports);
bind('imports-select','change',function(){
  var id=String(this.value||'');
  if(!id){
    selectedImportId='';
    selectedImportLabel='';
    setImportInUrl('');
    var wb=document.getElementById('import-workbench');
    if(wb)wb.style.display='none';
    return;
  }
  applyImportSelection(id);
});
bind('btn-reload-audit','click',loadAudit);

async function loadPrellmKindsAndPreview(){
  if(!SLUG||!selectedImportId)return;
  var bar=document.getElementById('prellm-kind-bar');
  if(!bar)return;
  bar.innerHTML='Loading kinds...';
  try{
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/stats');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var bk=d.stats&&d.stats.by_kind||{};
    prellmKinds=platformKindsFromStats(bk);
    if(prellmKinds.length===0){bar.innerHTML='<span class="empty">No rows in this import.</span>';return;}
    if(!prellmKind||prellmKinds.indexOf(prellmKind)<0)prellmKind=prellmKinds[0];

    // Preload per-kind cutoff defaults from the saved profile (or suggested table) so switching
    // platforms doesn't inherit the previous slider position.
    await ensurePrellmMinByKindDefaults(prellmKinds);

    var h='';
    for(var i=0;i<prellmKinds.length;i++){
      var k=prellmKinds[i];
      h+='<button type="button" class="'+(k===prellmKind?'btn btn-sm':'btn-ghost btn-sm')+' prellm-kind" data-kind="'+esc(k)+'">'+
        esc(kindLabel(k,'evidence'))+' <span style="color:var(--muted)">('+String(bk[k]||0)+')</span></button>';
    }
    bar.innerHTML=h;
    bar.querySelectorAll('.prellm-kind').forEach(function(btn){
      btn.addEventListener('click',function(){
        var next=btn.getAttribute('data-kind')||'';
        if(!next||next===prellmKind)return;
        prellmKind=next;
        // Toggle active styles without re-fetching stats (faster experimentation).
        bar.querySelectorAll('.prellm-kind').forEach(function(b2){
          var k2=b2.getAttribute('data-kind')||'';
          b2.className=(k2===prellmKind?'btn btn-sm':'btn-ghost btn-sm')+' prellm-kind';
        });
        syncPrellmSliderFromKind();
        renderPrellmFormulaEditor();
        schedulePrellmPreview();
        scheduleBroadEligibilityEstimate();
      });
    });
    syncPrellmSliderFromKind();
    await renderPrellmFormulaEditor();
    schedulePrellmPreview();
    syncBroadKindsFromStats(bk);
  }catch(e){bar.innerHTML='<span style="color:var(--red)">'+esc(e.message||e)+'</span>';}
}

async function ensurePrellmMinByKindDefaults(kinds){
  try{
    if(!Array.isArray(kinds)||kinds.length===0)return;
    var pc=await loadProfileForPrellm();
    var criteria=(pc&&pc.criteria)||{};
    var pre=(criteria.pre_llm&&typeof criteria.pre_llm==='object')?criteria.pre_llm:{};
    var ck=(pre.kinds&&typeof pre.kinds==='object')?pre.kinds:{};
    for(var i=0;i<kinds.length;i++){
      var k=String(kinds[i]||'').trim();
      if(!k)continue;
      if(typeof prellmMinByKind[k]==='number')continue;
      var prof=(ck[k]&&typeof ck[k]==='object')?ck[k]:null;
      var suggested=PRELLM_SUGGESTED[k]||PRELLM_SUGGESTED._default;
      var v=(prof&&typeof prof.min_score==='number')?prof.min_score:undefined;
      if(v==null||!Number.isFinite(v))v=(suggested&&suggested.min_score);
      // Final fallback: 0.35 is a pragmatic default for "top performer" exploration.
      if(v==null||!Number.isFinite(v))v=0.35;
      v=Math.max(0,Math.min(1,Number(v)));
      prellmMinByKind[k]=v;
    }
  }catch(e){
    // Non-fatal; UI will fall back to 0.35 in syncPrellmSliderFromKind.
  }
}

function syncPrellmSliderFromKind(){
  var minEl=document.getElementById('prellm-min-score');
  var minVal=document.getElementById('prellm-min-val');
  if(!minEl||!prellmKind)return;
  var v=prellmMinByKind[prellmKind];
  if(typeof v!=='number'){
    var s=PRELLM_SUGGESTED[prellmKind]||PRELLM_SUGGESTED._default;
    v=(s&&s.min_score);
    if(v==null||!Number.isFinite(v))v=0.35;
    prellmMinByKind[prellmKind]=v;
  }
  minEl.value=String(v);
  if(minVal)minVal.textContent=Number(v).toFixed(2);
  minEl.setAttribute('aria-valuenow',String(v));
}

function syncBroadKindsFromStats(bk){
  broadKinds=platformKindsFromStats(bk);
  if(!broadKind||broadKinds.indexOf(broadKind)<0)broadKind=broadKinds[0]||'';
}

function renderPrellmLiveTotals(totals){
  var el=document.getElementById('prellm-live-totals');
  if(!el)return;
  var t=totals||{};
  if(!t||typeof t.rows_in_kind!=='number'){
    el.innerHTML='<span style="color:var(--muted);font-size:12px">-</span>';
    return;
  }
  el.innerHTML=
    '<span class="badge badge-b" style="font-size:13px" data-caf-term="funnelTotal">TOTAL '+esc(fmtN(t.rows_in_kind))+'</span>'+
    '<span style="color:var(--muted)">-></span>'+
    '<span class="badge badge-p" style="font-size:13px" data-caf-term="funnelProfile">PROFILE '+esc(fmtN(t.passing_profile_min))+'</span>'+
    '<span style="color:var(--muted)">-></span>'+
    '<span class="badge badge-g" style="font-size:13px" data-caf-term="funnelCutoff">PASS CUTOFF '+esc(fmtN(t.after_user_cutoff))+'</span>';
  bindCafTerms(el);
}
function renderActiveWeightsStrip(d){
  var el=document.getElementById('prellm-active-weights-strip');
  if(!el)return;
  var w=d&&d.active_weights&&typeof d.active_weights==='object'?d.active_weights:null;
  if(!w||!Object.keys(w).length){el.textContent='';return;}
  var parts=[];
  var keys=Object.keys(w).sort();
  for(var i=0;i<keys.length;i++){
    var k=keys[i];
    parts.push('<span class="mono">'+esc(k)+'</span>=<strong>'+esc(String(w[k]))+'</strong>');
  }
  el.innerHTML='Active weights | '+parts.join(' <span style="color:var(--muted)">|</span> ');
}
function fmtPrellmNormBreakdown(b){
  if(!b||typeof b!=='object')return '\u2014';
  var keys=Object.keys(b).sort();
  if(!keys.length)return '\u2014';
  var out=[];
  for(var i=0;i<keys.length;i++){
    var k=keys[i];
    out.push('<span class="mono">'+esc(k)+'</span> '+esc(Number(b[k]).toFixed(3)));
  }
  return out.join('<br/>');
}
function fmtPrellmContrib(c){
  if(!c||typeof c!=='object')return '\u2014';
  var keys=Object.keys(c).sort();
  if(!keys.length)return '\u2014';
  var out=[];
  for(var i=0;i<keys.length;i++){
    var k=keys[i];
    out.push('<span class="mono">'+esc(k)+'</span> '+esc(Number(c[k]).toFixed(3)));
  }
  return out.join('<br/>');
}

function escAttr(s){
  return esc(s).replace(/"/g,'&quot;');
}
function truncPrellmText(s,max){
  var t=String(s||'').trim();
  if(t.length<=max)return t;
  return t.slice(0,max)+'...';
}
function prellmUrlLabel(url){
  if(!url)return '';
  try{
    var u=new URL(String(url));
    var h=u.hostname;
    if(h.indexOf('www.')===0)h=h.slice(4);
    return h.length>28?h.slice(0,28)+'...':h;
  }catch(e){
    return truncPrellmText(url,28);
  }
}
function readPrellmTableFilters(){
  var searchEl=document.getElementById('prellm-filter-search');
  var kindEl=document.getElementById('prellm-filter-kind');
  var incEl=document.getElementById('prellm-filter-included');
  var minEl=document.getElementById('prellm-filter-min-score');
  var minScore=null;
  if(minEl){
    var raw=String(minEl.value||'').trim();
    if(raw!==''){
      var n=parseFloat(raw);
      if(Number.isFinite(n))minScore=n;
    }
  }
  return {
    search:searchEl?String(searchEl.value||'').trim().toLowerCase():'',
    kind:kindEl?String(kindEl.value||'').trim().toLowerCase():'',
    included:incEl?String(incEl.value||'any'):'any',
    minScore:minScore
  };
}
function applyPrellmTableFilters(rows){
  var f=readPrellmTableFilters();
  var out=[];
  for(var i=0;i<rows.length;i++){
    var x=rows[i];
    if(f.kind){
      var k=String(x.evidence_display_kind||'').trim()||String(x.evidence_kind||'');
      if(k.toLowerCase()!==f.kind)continue;
    }
    if(f.included==='yes'&&!x.included_by_cutoff)continue;
    if(f.included==='no'&&x.included_by_cutoff)continue;
    if(f.minScore!=null&&Number(x.pre_llm_score)<f.minScore)continue;
    if(f.search){
      var blob=(String(x.caption||'')+' '+String(x.hashtags||'')+' '+String(x.url||'')).toLowerCase();
      if(blob.indexOf(f.search)<0)continue;
    }
    out.push(x);
  }
  return out;
}
function populatePrellmKindFilter(rows){
  var sel=document.getElementById('prellm-filter-kind');
  if(!sel)return;
  var cur=String(sel.value||'');
  var set={};
  for(var i=0;i<rows.length;i++){
    var k=String(rows[i].evidence_display_kind||'').trim()||String(rows[i].evidence_kind||'');
    if(k)set[k.toLowerCase()]=k;
  }
  var keys=Object.keys(set).sort();
  var html='<option value="">Any</option>';
  for(var j=0;j<keys.length;j++){
    var lk=keys[j];
    var label=set[lk];
    html+='<option value="'+esc(lk)+'">'+esc(label)+'</option>';
  }
  sel.innerHTML=html;
  if(cur&&set[cur])sel.value=cur;
}
function updatePrellmFilterSummary(total,filtered){
  var el=document.getElementById('prellm-filter-summary');
  if(!el)return;
  if(!total){
    el.textContent='Load evidence to filter rows in the table below.';
    return;
  }
  if(filtered===total){
    el.textContent='Showing all '+String(total)+' loaded row'+(total===1?'':'s')+'.';
    return;
  }
  el.textContent='Showing '+String(filtered)+' of '+String(total)+' loaded rows.';
}
function renderPrellmTable(rows){
  var wrap=document.getElementById('prellm-table-wrap');
  if(!wrap)return;
  if(!rows.length){
    var msg=lastPrellmAllRows&&lastPrellmAllRows.length?'No rows match the current table filters.':'No rows at or above this cutoff.';
    wrap.innerHTML='<div class="empty" style="padding:12px">'+esc(msg)+'</div>';
    return;
  }
  var tb='<table class="sp-modal-table prellm-evidence-table"><thead><tr>'+
    '<th style="cursor:pointer" id="prellm-th-score">Score</th>'+
    '<th style="font-size:12px"><span data-caf-term="normColumn">Norm</span></th>'+
    '<th style="font-size:12px"><span data-caf-term="blendColumn">Blend</span></th>'+
    '<th><span data-caf-term="displayKind">Kind</span></th><th><span data-caf-term="includedColumn">Inc.</span></th><th>URL</th><th>Caption</th><th>Hashtags</th></tr></thead><tbody>';
  for(var i=0;i<rows.length;i++){
    var x=rows[i];
    var inc=!!x.included_by_cutoff;
    var kindCell=String(x.evidence_display_kind||'').trim()||String(x.evidence_kind||'');
    var bd=x.pre_llm_breakdown&&typeof x.pre_llm_breakdown==='object'?x.pre_llm_breakdown:{};
    var ct=x.pre_llm_contributions&&typeof x.pre_llm_contributions==='object'?x.pre_llm_contributions:{};
    var cap=String(x.caption||'');
    var tags=String(x.hashtags||'');
    var url=x.url?String(x.url):'';
    var urlCell=url?('<a class="prellm-cell-url" href="'+esc(url)+'" target="_blank" rel="noopener" title="'+escAttr(url)+'">'+esc(prellmUrlLabel(url))+'</a>'):'<span style="color:var(--muted)">-</span>';
    var capCell='<div class="prellm-cell-clamp" title="'+escAttr(cap)+'">'+esc(cap)+'</div>';
    if(cap.length>220){
      capCell='<details><summary class="mono" style="font-size:11px;cursor:pointer;color:var(--muted)">'+esc(truncPrellmText(cap,72))+'</summary>'+
        '<div class="prellm-cell-clamp" style="-webkit-line-clamp:unset;max-height:200px;overflow:auto;margin-top:6px">'+esc(cap)+'</div></details>';
    }
    var tagsCell=tags?('<span class="prellm-cell-hashtags" title="'+escAttr(tags)+'">'+esc(tags)+'</span>'):'<span style="color:var(--muted)">-</span>';
    tb+='<tr class="'+(inc?'':'prellm-row-dim')+'">'+
      '<td class="mono prellm-score-cell">'+esc(String(x.pre_llm_score))+'</td>'+
      '<td class="prellm-cell-norm">'+fmtPrellmNormBreakdown(bd)+'</td>'+
      '<td class="prellm-cell-norm">'+fmtPrellmContrib(ct)+'</td>'+
      '<td class="mono" style="font-size:11px;white-space:nowrap">'+esc(kindCell)+'</td>'+
      '<td class="mono" style="font-size:11px;color:'+(inc?'var(--green)':'var(--muted)')+';white-space:nowrap">'+(inc?'yes':'no')+'</td>'+
      '<td>'+urlCell+'</td>'+
      '<td>'+capCell+'</td>'+
      '<td>'+tagsCell+'</td></tr>';
  }
  tb+='</tbody></table>';
  wrap.innerHTML=tb;
  bindCafTerms(wrap);
  bind('prellm-th-score','click',function(){
    var cur=document.getElementById('prellm-sort');
    if(!cur)return;
    cur.value=(cur.value==='score_desc')?'score_asc':'score_desc';
    schedulePrellmPreview();
  });
}
function rerenderPrellmTableFromCache(){
  if(!lastPrellmAllRows)return;
  var filtered=applyPrellmTableFilters(lastPrellmAllRows);
  lastPrellmDisplayRows=filtered;
  updatePrellmFilterSummary(lastPrellmAllRows.length,filtered.length);
  renderPrellmTable(filtered);
}
function storeAndRenderPrellmRows(rows){
  lastPrellmAllRows=rows||[];
  populatePrellmKindFilter(lastPrellmAllRows);
  rerenderPrellmTableFromCache();
}
function schedulePrellmFilterRerender(){
  if(prellmTableFilterTimer)clearTimeout(prellmTableFilterTimer);
  prellmTableFilterTimer=setTimeout(rerenderPrellmTableFromCache,180);
}
function clearPrellmTableFilters(){
  var searchEl=document.getElementById('prellm-filter-search');
  var kindEl=document.getElementById('prellm-filter-kind');
  var incEl=document.getElementById('prellm-filter-included');
  var minEl=document.getElementById('prellm-filter-min-score');
  if(searchEl)searchEl.value='';
  if(kindEl)kindEl.value='';
  if(incEl)incEl.value='any';
  if(minEl)minEl.value='';
  rerenderPrellmTableFromCache();
}

function schedulePrellmPreview(){
  if(prellmTimer)clearTimeout(prellmTimer);
  prellmTimer=setTimeout(loadPrellmPreview,220);
}

async function loadPrellmPreview(){
  var counts=document.getElementById('prellm-counts');
  var wrap=document.getElementById('prellm-table-wrap');
  var minEl=document.getElementById('prellm-min-score');
  var minVal=document.getElementById('prellm-min-val');
  var showBelow=document.getElementById('prellm-show-below');
  var sortEl=document.getElementById('prellm-sort');
  if(!SLUG||!selectedImportId||!prellmKind||!counts||!wrap||!minEl||!sortEl)return;
  var minScore=parseFloat(minEl.value)||0;
  prellmMinByKind[prellmKind]=minScore;
  if(minVal)minVal.textContent=minScore.toFixed(2);
  counts.textContent='Loading...';
  wrap.innerHTML='';
  try{
    var q='evidence_kind='+encodeURIComponent(prellmKind)+'&min_score='+encodeURIComponent(String(minScore))+
      '&include_below_cutoff='+(showBelow&&showBelow.checked?'1':'0')+
      '&sort='+encodeURIComponent(sortEl.value||'score_desc')+
      '&limit=120&offset=0';
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/pre-llm-evidence?'+q);
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    stepState.last_prellm_preview=d;
    var t=d.totals||{};
    stepState.evidence_valid=!!t.after_user_cutoff && Number(t.after_user_cutoff)>0;
    renderFunnel(t);
    renderPrellmLiveTotals(t);
    renderActiveWeightsStrip(d);
    renderStepper();
    counts.textContent=JSON.stringify({
      evidence_kind:d.evidence_kind,
      min_score_cutoff:d.min_score_cutoff,
      profile_min_score:d.profile_min_score,
      rows_in_kind:t.rows_in_kind,
      sparse_text_dropped:t.sparse_text_dropped,
      below_profile_min_dropped:t.below_profile_min_dropped,
      passing_profile_min:t.passing_profile_min,
      after_user_cutoff:t.after_user_cutoff,
      showing_page:d.rows?d.rows.length:0
    },null,2);
    var rows=d.rows||[];
    lastPrellmDisplayRows=null;
    if(!rows.length){
      lastPrellmAllRows=[];
      updatePrellmFilterSummary(0,0);
      wrap.innerHTML='<div class="empty" style="padding:12px">No rows at or above this cutoff.</div>';
      return;
    }
    storeAndRenderPrellmRows(rows);
  }catch(e){
    counts.textContent=String(e);
    renderPrellmLiveTotals({});
    renderActiveWeightsStrip(null);
  }
}
var prellmCutoffSaveTimer=null;
async function savePrellmCutoffToProfile(){
  var msg=document.getElementById('prellm-save-msg');
  try{
    if(!SLUG||!prellmKind)return;
    var minEl=document.getElementById('prellm-min-score');
    if(!minEl)return;
    var v=parseFloat(minEl.value||'0');
    if(!Number.isFinite(v))v=0;
    v=Math.max(0,Math.min(1,v));
    if(msg){msg.textContent='Saving cutoff...';msg.style.color='';}
    var pc=await loadProfileForPrellm();
    if(!pc||!pc.profile)throw new Error('Profile not loaded');
    var criteria=JSON.parse(JSON.stringify(pc.criteria||{}));
    if(!criteria.pre_llm||typeof criteria.pre_llm!=='object')criteria.pre_llm={};
    if(!criteria.pre_llm.kinds||typeof criteria.pre_llm.kinds!=='object')criteria.pre_llm.kinds={};
    if(!criteria.pre_llm.kinds[prellmKind]||typeof criteria.pre_llm.kinds[prellmKind]!=='object')criteria.pre_llm.kinds[prellmKind]={};
    criteria.pre_llm.enabled=true;
    criteria.pre_llm.kinds[prellmKind].min_score=v;
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({criteria_json:criteria})});
    var d=await r.json().catch(function(){return {};});
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'Save failed'));
    profileCache={profile:d.profile,criteria:(d.profile&&d.profile.criteria_json)||criteria};
    if(msg){msg.textContent='Saved cutoff.';msg.style.color='var(--muted)';}
  }catch(e){
    if(msg){msg.textContent=String(e.message||e);msg.style.color='var(--red)';}
  }
}
function scheduleSavePrellmCutoff(){
  try{
    if(prellmCutoffSaveTimer)clearTimeout(prellmCutoffSaveTimer);
    prellmCutoffSaveTimer=setTimeout(savePrellmCutoffToProfile,600);
  }catch(e){}
}

bind('prellm-min-score','input',function(){
  var minVal=document.getElementById('prellm-min-val');
  if(minVal)minVal.textContent=Number(parseFloat(this.value||'0')||0).toFixed(2);
  schedulePrellmPreview();
  scheduleSavePrellmCutoff();
});
bind('prellm-show-below','change',schedulePrellmPreview);
bind('prellm-sort','change',schedulePrellmPreview);
bind('prellm-filter-search','input',schedulePrellmFilterRerender);
bind('prellm-filter-kind','change',rerenderPrellmTableFromCache);
bind('prellm-filter-included','change',rerenderPrellmTableFromCache);
bind('prellm-filter-min-score','input',schedulePrellmFilterRerender);
bind('prellm-filter-clear','click',clearPrellmTableFilters);

function readBroadOverrides(){
  return {
    custom_label_1:(val('broad-label-1')||'').trim()||null,
    custom_label_2:(val('broad-label-2')||'').trim()||null,
    custom_label_3:(val('broad-label-3')||'').trim()||null,
    system_prompt:(val('broad-system-prompt')||'').trim()||null,
    user_prompt:(val('broad-user-prompt')||'').trim()||null
  };
}

var broadPromptDirty=false;
var broadPromptLoadedKind='';

var broadEligTimer=null;
var broadEligSeq=0;
function scheduleBroadEligibilityEstimate(){
  try{
    if(broadEligTimer)clearTimeout(broadEligTimer);
    broadEligTimer=setTimeout(loadBroadEligibilityEstimate,250);
  }catch(e){}
}

async function loadBroadEligibilityEstimate(){
  var el=document.getElementById('broad-eligible-msg');
  if(!el)return;
  if(!SLUG||!selectedImportId||!broadKind||!broadKinds||!broadKinds.length){el.textContent='';return;}
  if(isSourceEvidenceKind(broadKind)){el.textContent='';return;}
  var seq=++broadEligSeq;
  el.textContent='Eligible evidence after cutoff: computing...';
  el.style.color='';
  try{
    var maxRows=parseInt(val('broad-max-rows')||'800',10);
    if(!Number.isFinite(maxRows)||maxRows<1)maxRows=800;
    var rescan=chk('broad-rescan');
    var useCutoff=chk('broad-use-cutoff');
    var o=readBroadOverrides();

    async function dryRunForKind(kind){
      var cutoff=(useCutoff&&prellmMinByKind[kind]!=null)?Number(prellmMinByKind[kind]):null;
      var body={
        evidence_kind:kind,
        max_rows:maxRows,
        rescan:rescan,
        min_pre_llm_score:(useCutoff&&cutoff!=null&&Number.isFinite(cutoff))?cutoff:undefined,
        custom_label_1:o.custom_label_1,
        custom_label_2:o.custom_label_2,
        custom_label_3:o.custom_label_3,
        system_prompt:o.system_prompt,
        user_prompt:o.user_prompt,
        dry_run:true
      };
      var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/run-broad-insights',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
      });
      var d=await r.json().catch(function(){return {};});
      if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
      return Number(d.rows_eligible_new||0);
    }

    var nTab=await dryRunForKind(broadKind);
    if(seq!==broadEligSeq)return;

    // Also compute "all platforms" total (usually 3-6 kinds), so user sees it before clicking.
    var total=0;
    for(var i=0;i<broadKinds.length;i++){
      var k=broadKinds[i];
      total+=await dryRunForKind(k);
      if(seq!==broadEligSeq)return;
    }
    el.textContent='Eligible evidence after cutoff: this tab '+String(nTab)+' | all platforms '+String(total)+'.';
  }catch(e){
    if(seq!==broadEligSeq)return;
    el.textContent='Eligible evidence after cutoff: '+String(e.message||e);
    el.style.color='var(--red)';
  }
}

async function loadBroadPromptIntoEditor(){
  var m=document.getElementById('broad-prompt-msg');
  var msg=document.getElementById('prellm-insight-msg');
  if(!SLUG||!selectedImportId){if(msg)msg.textContent='Select an import first.';return;}
  try{
    if(m){m.textContent='Loading...';m.style.color='';}
    var kRaw=broadKind||prellmKind||'';
    var k=isSourceEvidenceKind(kRaw)?(broadKinds[0]||''):kRaw;
    var o=readBroadOverrides();
    var body={
      evidence_kind:k||null,
      custom_label_1:o.custom_label_1,
      custom_label_2:o.custom_label_2,
      custom_label_3:o.custom_label_3
    };
    if(broadPromptDirty){
      body.system_prompt=o.system_prompt;
      body.user_prompt=o.user_prompt;
    }
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/broad-insights-prompt',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    // Always show "what we're using" as the preview; if user edits, we stop auto-overwriting.
    if(!broadPromptDirty){
      document.getElementById('broad-label-1').value=d.labels&&d.labels.l1||'';
      document.getElementById('broad-label-2').value=d.labels&&d.labels.l2||'';
      document.getElementById('broad-label-3').value=d.labels&&d.labels.l3||'';
      document.getElementById('broad-system-prompt').value=d.system_prompt||'';
      document.getElementById('broad-user-prompt').value=d.user_prompt||'';
      broadPromptLoadedKind=k;
    }
    if(m){m.textContent='Loaded. Model '+d.model+' | batch '+d.batch_size+'.';m.style.color='var(--muted)';}
  }catch(e){
    if(m){m.textContent=String(e.message||e);m.style.color='var(--red)';}
  }
}

bind('btn-toggle-broad-prompt','click',function(){
  var panel=document.getElementById('broad-prompt-panel');
  if(!panel)return;
  panel.style.display=panel.style.display==='none'?'block':'none';
  if(panel.style.display==='block'){
    // Populate immediately with current prompts if not editing.
    if(!broadPromptDirty)loadBroadPromptIntoEditor();
  }
});
bind('btn-load-broad-prompt','click',loadBroadPromptIntoEditor);
bind('btn-reset-broad-prompt','click',function(){
  document.getElementById('broad-label-1').value='';
  document.getElementById('broad-label-2').value='';
  document.getElementById('broad-label-3').value='';
  document.getElementById('broad-system-prompt').value='';
  document.getElementById('broad-user-prompt').value='';
  broadPromptDirty=false;
  broadPromptLoadedKind='';
  var m=document.getElementById('broad-prompt-msg');
  if(m){m.textContent='Overrides cleared (not saved).';m.style.color='var(--muted)';}
  loadBroadPromptIntoEditor();
});

bind('btn-save-broad-labels','click',async function(){
  var m=document.getElementById('broad-prompt-msg');
  if(!SLUG){if(m){m.textContent='Select a project.';m.style.color='var(--red)';}return;}
  try{
    if(m){m.textContent='Saving labels...';m.style.color='';}
    var pc=await loadProfileForPrellm();
    if(!pc||!pc.profile)throw new Error('Profile not loaded');
    var criteria=JSON.parse(JSON.stringify(pc.criteria||{}));
    if(!criteria.insight_column_labels||typeof criteria.insight_column_labels!=='object')criteria.insight_column_labels={};
    criteria.insight_column_labels.custom_label_1=(val('broad-label-1')||'').trim();
    criteria.insight_column_labels.custom_label_2=(val('broad-label-2')||'').trim();
    criteria.insight_column_labels.custom_label_3=(val('broad-label-3')||'').trim();
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({criteria_json:criteria})});
    var d=await r.json().catch(function(){return {};});
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'Save failed'));
    profileCache={profile:d.profile,criteria:(d.profile&&d.profile.criteria_json)||criteria};
    if(m){m.textContent='Saved labels to profile.';m.style.color='var(--muted)';}
    broadPromptDirty=false;
    loadBroadPromptIntoEditor();
  }catch(e){
    if(m){m.textContent=String(e.message||e);m.style.color='var(--red)';}
  }
});

function markBroadPromptDirty(){
  broadPromptDirty=true;
  var m=document.getElementById('broad-prompt-msg');
  if(m){m.textContent='Editing overrides (will apply on Run).';m.style.color='var(--muted)';}
}
bind('broad-label-1','input',markBroadPromptDirty);
bind('broad-label-2','input',markBroadPromptDirty);
bind('broad-label-3','input',markBroadPromptDirty);
bind('broad-system-prompt','input',markBroadPromptDirty);
bind('broad-user-prompt','input',markBroadPromptDirty);

function renderWeightsTable(weights){
  var wrap=document.getElementById('prellm-weights-wrap');
  if(!wrap)return;
  var keys=Object.keys(weights||{}).sort();
  if(keys.length===0){
    wrap.innerHTML='<div class="empty" style="padding:10px">No weights configured.</div>';
    return;
  }
  var h='<table class="sp-modal-table prellm-formula-table" style="margin:0"><thead><tr><th>Feature</th><th><span data-caf-term="featureWeight">Weight</span></th><th></th></tr></thead><tbody>';
  for(var i=0;i<keys.length;i++){
    var k=keys[i];
    h+='<tr>'+
      '<td class="mono" style="max-width:180px;word-break:break-word;font-size:13px">'+esc(k)+'</td>'+
      '<td><input type="number" step="0.01" min="0" value="'+esc(String(weights[k]))+'" data-wkey="'+esc(k)+'" class="prellm-wt" style="width:84px;font-size:14px;padding:6px 8px" /></td>'+
      '<td><button type="button" class="btn-ghost btn-sm prellm-del-wt" data-wkey="'+esc(k)+'">Remove</button></td>'+
    '</tr>';
  }
  h+='</tbody></table>';
  wrap.innerHTML=h;
  bindCafTerms(wrap);
}

async function renderPrellmFormulaEditor(){
  if(!SLUG||!prellmKind)return;
  var hint=document.getElementById('prellm-formula-hint');
  var minEl=document.getElementById('prellm-profile-min');
  var minTextEl=document.getElementById('prellm-min-text');
  var saveMsg=document.getElementById('prellm-save-msg');
  if(!minEl||!minTextEl)return;
  var pc=await loadProfileForPrellm();
  var criteria=(pc&&pc.criteria)||{};
  var pre=(criteria.pre_llm&&typeof criteria.pre_llm==='object')?criteria.pre_llm:{};
  var kinds=(pre.kinds&&typeof pre.kinds==='object')?pre.kinds:{};
  var prof=(kinds[prellmKind]&&typeof kinds[prellmKind]==='object')?kinds[prellmKind]:null;
  var hasCustom=!!(prof&&prof.weights&&typeof prof.weights==='object'&&Object.keys(prof.weights||{}).length);
  var suggested=PRELLM_SUGGESTED[prellmKind]||PRELLM_SUGGESTED._default;
  var weights=(prof&&prof.weights&&typeof prof.weights==='object')?prof.weights:{};
  if(!hasCustom)weights=(suggested&&suggested.weights)||{};
  var minScore=(prof&&typeof prof.min_score==='number')?prof.min_score:undefined;
  if(minScore==null||!Number.isFinite(minScore))minScore=(suggested&&suggested.min_score)||0;
  minEl.value=String(Math.max(0,Math.min(1,minScore)));
  var mt=(typeof pre.min_primary_text_chars==='number')?pre.min_primary_text_chars:12;
  minTextEl.value=String(mt);
  if(hint)hint.textContent='Score = sum(feature_i x weight_i) / sum(weights). Features are normalized 0-1 in code. Platform: '+prellmKind+'.';
  if(saveMsg){
    saveMsg.textContent=hasCustom?'':'Suggested defaults loaded (not saved yet).';
    saveMsg.style.color=hasCustom?'var(--muted)':'var(--muted)';
  }
  renderWeightsTable(weights);
}

function readWeightsFromEditor(){
  var weights={};
  document.querySelectorAll('.prellm-wt').forEach(function(inp){
    var k=inp.getAttribute('data-wkey')||'';
    if(!k)return;
    var v=parseFloat(inp.value||'0');
    if(!Number.isFinite(v)||v<0)v=0;
    weights[k]=v;
  });
  return weights;
}

bind('prellm-weights-wrap','click',function(e){
  var t=e&&e.target;
  if(!t||!t.classList||!t.classList.contains('prellm-del-wt'))return;
  var k=t.getAttribute('data-wkey')||'';
  if(!k)return;
  // Remove row in DOM
  var row=t.closest('tr');
  if(row)row.remove();
});

bind('prellm-add-weight','click',function(){
  var key=prompt('Feature key (e.g. ig_likes, tt_plays, text_signal)');
  if(!key)return;
  key=String(key).trim();
  if(!key)return;
  var wrap=document.getElementById('prellm-weights-wrap');
  if(!wrap)return;
  // If table empty, re-render from scratch with single key.
  var weights=readWeightsFromEditor();
  if(weights[key]!=null){alert('That feature already exists.');return;}
  weights[key]=0.1;
  renderWeightsTable(weights);
});

bind('prellm-save-formula','click',async function(){
  var msg=document.getElementById('prellm-save-msg');
  if(!SLUG||!prellmKind){if(msg)msg.textContent='Select a platform first.';return;}
  if(msg){msg.textContent='Saving...';msg.style.color='';}
  try{
    var pc=await loadProfileForPrellm();
    if(!pc||!pc.profile)throw new Error('Profile not loaded');
    var criteria=JSON.parse(JSON.stringify(pc.criteria||{})); // deep-ish clone for safety
    if(!criteria.pre_llm||typeof criteria.pre_llm!=='object')criteria.pre_llm={};
    if(!criteria.pre_llm.kinds||typeof criteria.pre_llm.kinds!=='object')criteria.pre_llm.kinds={};
    var minScore=parseFloat(val('prellm-profile-min')||'0');
    if(!Number.isFinite(minScore))minScore=0;
    minScore=Math.max(0,Math.min(1,minScore));
    var mt=parseInt(val('prellm-min-text')||'12',10);
    if(!Number.isFinite(mt)||mt<0)mt=12;
    criteria.pre_llm.min_primary_text_chars=mt;
    criteria.pre_llm.enabled=true;
    criteria.pre_llm.kinds[prellmKind]={min_score:minScore,weights:readWeightsFromEditor()};
    var body={criteria_json:criteria};
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json().catch(function(){return {};});
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'Save failed'));
    profileCache={profile:d.profile,criteria:(d.profile&&d.profile.criteria_json)||criteria};
    if(msg){msg.textContent='Saved.';msg.style.color='var(--muted)';}
    // Refresh counts/table because profile min score might change results.
    schedulePrellmPreview();
  }catch(e){
    if(msg){msg.textContent=String(e.message||e);msg.style.color='var(--red)';}
  }
});

bind('prellm-save-cutoff-snapshot','click',async function(){
  var m=document.getElementById('prellm-cutoff-snapshot-msg');
  var d=stepState.last_prellm_preview;
  if(!SLUG||!selectedImportId||!prellmKind){
    if(m){m.textContent='Load evidence first.';m.style.color='var(--red)';}
    return;
  }
  if(!d||!d.ok){
    if(m){m.textContent='No preview loaded. Wait for the table to finish loading.';m.style.color='var(--red)';}
    return;
  }
  try{
    if(m){m.textContent='Saving...';m.style.color='';}
    var t=d.totals||{};
    var body={
      evidence_kind:prellmKind,
      min_score_cutoff:Number(d.min_score_cutoff),
      profile_min_score:Number(d.profile_min_score),
      totals:{
        rows_in_kind:Number(t.rows_in_kind)||0,
        sparse_text_dropped:Number(t.sparse_text_dropped)||0,
        below_profile_min_dropped:Number(t.below_profile_min_dropped)||0,
        passing_profile_min:Number(t.passing_profile_min)||0,
        after_user_cutoff:Number(t.after_user_cutoff)||0
      },
      active_weights:d.active_weights&&typeof d.active_weights==='object'?d.active_weights:null
    };
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/operator-cutoff-snapshot',{
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
    var j=await r.json().catch(function(){return {};});
    if(!r.ok||!j.ok)throw new Error(apiErr(j,'HTTP '+r.status));
    if(m){m.textContent='Saved cutoff & pass counts on this import.';m.style.color='var(--muted)';}
  }catch(e){
    if(m){m.textContent=String(e.message||e);m.style.color='var(--red)';}
  }
});

bind('btn-run-broad-insights','click',async function(){
  var msg=document.getElementById('prellm-insight-msg');
  if(!SLUG||!selectedImportId){if(msg)msg.textContent='Select an import first.';return;}
  try{
    var maxRows=parseInt(val('broad-max-rows')||'800',10);
    if(!Number.isFinite(maxRows)||maxRows<1)maxRows=800;
    var rescan=chk('broad-rescan');
    var useCutoff=chk('broad-use-cutoff');
    if(rescan){
      var ok=confirm('Rescan is enabled. This will overwrite existing broad insights rows for this platform tab. Continue?');
      if(!ok)return;
    }
    var kind=broadKind||prellmKind||null;
    if(kind&&isSourceEvidenceKind(kind))throw new Error('Broad insights apply to social platforms only. Use the Sources tab for '+kind+'.');
    var cutoff=(kind&&prellmMinByKind[kind]!=null)?Number(prellmMinByKind[kind]):null;
    var o=readBroadOverrides();
    var body={
      evidence_kind:kind,
      max_rows:maxRows,
      rescan:rescan,
      debug:true,
      min_pre_llm_score:(useCutoff&&cutoff!=null&&Number.isFinite(cutoff))?cutoff:undefined,
      custom_label_1:o.custom_label_1,
      custom_label_2:o.custom_label_2,
      custom_label_3:o.custom_label_3,
      system_prompt:o.system_prompt,
      user_prompt:o.user_prompt
    };
    if(msg){msg.textContent='Checking eligible evidence rows...';msg.style.color='';}
    var r0=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/run-broad-insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({},body,{dry_run:true}))});
    var d0=await r0.json().catch(function(){return {};});
    if(!r0.ok||!d0.ok)throw new Error(apiErr(d0,'HTTP '+r0.status));
    var nElig=Number(d0.rows_eligible_new||0);
    if(msg){msg.textContent='Running broad LLM (this platform tab) - will analyze '+String(nElig)+' evidence rows...';msg.style.color='';}
    scheduleBroadEligibilityEstimate();
    if(nElig<=0){loadBroadTable();return;}
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/run-broad-insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json().catch(function(){return {};});
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    if(msg)msg.textContent='Broad ('+kindLabel(kind,'insights')+') done: upserted '+String(d.upserted||0)+' | batches '+String(d.batches||0)+' | total '+String(d.broad_insights_total||0)+'.';
    setBroadRunDebug({
      at:new Date().toISOString(),
      mode:'this_tab',
      project_slug:SLUG,
      inputs_import_id:selectedImportId,
      upload_filename:selectedImportLabel||null,
      evidence_kind:kind,
      request_body:body,
      response:d
    });
    scheduleBroadEligibilityEstimate();
    refreshInsightCounts();
  }catch(e){if(msg){msg.textContent=String(e.message||e);msg.style.color='var(--red)';}}
});

var broadAllRunning=false;
bind('btn-run-broad-insights-all','click',async function(){
  var msg=document.getElementById('prellm-insight-msg');
  if(!SLUG||!selectedImportId){if(msg)msg.textContent='Select an import first.';return;}
  if(broadAllRunning){if(msg)msg.textContent='Already running ALL platforms...';return;}
  if(!broadKinds||!broadKinds.length){if(msg)msg.textContent='No social platforms found for broad insights in this import.';return;}
  broadAllRunning=true;
  try{
    var maxRows=parseInt(val('broad-max-rows')||'800',10);
    if(!Number.isFinite(maxRows)||maxRows<1)maxRows=800;
    var rescan=chk('broad-rescan');
    var useCutoff=chk('broad-use-cutoff');
    var o=readBroadOverrides();
    if(rescan){
      var ok=confirm('Rescan is enabled. This will overwrite existing broad insights rows across ALL platform tabs. Continue?');
      if(!ok){broadAllRunning=false;return;}
    }

    if(msg){msg.textContent='Checking eligible evidence rows (all platforms)...';msg.style.color='';}
    var totalElig=0;
    for(var j=0;j<broadKinds.length;j++){
      var k0=broadKinds[j];
      var cutoff0=(useCutoff&&prellmMinByKind[k0]!=null)?Number(prellmMinByKind[k0]):null;
      var body0={
        evidence_kind:k0,
        max_rows:maxRows,
        rescan:rescan,
        min_pre_llm_score:(useCutoff&&cutoff0!=null&&Number.isFinite(cutoff0))?cutoff0:undefined,
        custom_label_1:o.custom_label_1,
        custom_label_2:o.custom_label_2,
        custom_label_3:o.custom_label_3,
        system_prompt:o.system_prompt,
        user_prompt:o.user_prompt,
        dry_run:true
      };
      var rr=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/run-broad-insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body0)});
      var dd=await rr.json().catch(function(){return {};});
      if(!rr.ok||!dd.ok)throw new Error(kindLabel(k0,'insights')+': '+apiErr(dd,'HTTP '+rr.status));
      totalElig+=Number(dd.rows_eligible_new||0);
    }
    if(msg){msg.textContent='Running broad (all platforms) - will analyze '+String(totalElig)+' evidence rows total...';msg.style.color='';}
    scheduleBroadEligibilityEstimate();
    if(totalElig<=0){loadBroadTable();return;}

    var total=0;
    var perKind=[];
    for(var i=0;i<broadKinds.length;i++){
      var kind=broadKinds[i];
      if(msg){msg.textContent='Running broad (all platforms): '+kindLabel(kind,'insights')+' ('+(i+1)+'/'+broadKinds.length+')...';msg.style.color='';}
      var cutoff=(useCutoff&&prellmMinByKind[kind]!=null)?Number(prellmMinByKind[kind]):null;
      var body={
        evidence_kind:kind,
        max_rows:maxRows,
        rescan:rescan,
        debug:true,
        min_pre_llm_score:(useCutoff&&cutoff!=null&&Number.isFinite(cutoff))?cutoff:undefined,
        custom_label_1:o.custom_label_1,
        custom_label_2:o.custom_label_2,
        custom_label_3:o.custom_label_3,
        system_prompt:o.system_prompt,
        user_prompt:o.user_prompt
      };
      var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/run-broad-insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      var d=await r.json().catch(function(){return {};});
      if(!r.ok||!d.ok)throw new Error(kindLabel(kind,'insights')+': '+apiErr(d,'HTTP '+r.status));
      total+=Number(d.upserted||0);
      perKind.push({evidence_kind:kind,upserted:d.upserted||0,batches:d.batches||0,rows_eligible_new:d.rows_eligible_new||0,rows_sent:d.rows_sent||0,debug:d.debug||null});
    }
    if(msg){msg.textContent='All social platforms done. Total upserted '+String(total)+'.';}
    // Refresh current view
    loadBroadTable();
    setBroadRunDebug({
      at:new Date().toISOString(),
      mode:'all_platforms',
      project_slug:SLUG,
      inputs_import_id:selectedImportId,
      upload_filename:selectedImportLabel||null,
      request:{max_rows:maxRows,rescan:rescan,use_cutoff:useCutoff},
      per_kind:perKind
    });
    scheduleBroadEligibilityEstimate();
  }catch(e){
    if(msg){msg.textContent=String(e.message||e);msg.style.color='var(--red)';}
  }finally{
    broadAllRunning=false;
    refreshInsightCounts();
  }
});

bind('btn-run-deep-image-insights','click',async function(){
  if(!SLUG||!selectedImportId){setTpStatus('image','Select an import first.',true);return;}
  tpSetRunning('image',true);
  setTpStatus('image','Running image vision…',false,'running');
  var body=Object.assign({max_rows:24,rescan:chk('tp-vision-rescan')},tpRatingGateRequestFields());
  var endpoint='/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/run-deep-image-insights';
  var r=null;
  var d=null;
  try{
    r=await cafFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    d=await r.json().catch(function(){return {};});
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    setTopPerfRunLog('image',{
      at:new Date().toISOString(),
      pass:'top_performer_deep',
      success:true,
      project_slug:SLUG,
      import_id:selectedImportId,
      http_status:r.status,
      endpoint:endpoint,
      request_body:body,
      response:d,
    });
    setTpStatus('image',tpCompactImageStatus(d),false,'ok');
    loadDeepImageTable();
  }catch(e){
    setTopPerfRunLog('image',{
      at:new Date().toISOString(),
      pass:'top_performer_deep',
      success:false,
      project_slug:SLUG,
      import_id:selectedImportId,
      http_status:r?r.status:null,
      endpoint:endpoint,
      request_body:body,
      error:String(e.message||e),
      response_json:d,
    });
    setTpStatus('image',String(e.message||e),true,'err');
    try{pushProcessingActivity(cafTs()+' top-performer (image): '+String(e.message||e),true);}catch(_c){}
  }finally{tpSetRunning('image',false);}
});

bind('btn-run-deep-carousel-insights','click',async function(){
  if(!SLUG||!selectedImportId){setTpStatus('carousel','Select an import first.',true);return;}
  renderTpQualifyingList('carousel',[]);
  tpSetRunning('carousel',true);
  setTpStatus('carousel','Running carousel vision…',false,'running');
  var body=Object.assign({max_rows:12,max_slides:12,rescan:chk('tp-vision-rescan')},tpRatingGateRequestFields());
  var endpoint='/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/run-deep-carousel-insights';
  var r=null;
  var d=null;
  try{
    r=await cafFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    d=await r.json().catch(function(){return {};});
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var maCar=tpMediaArchiveFromResponse(d,'top_performer_carousel');
    setTopPerfRunLog('carousel',{
      at:new Date().toISOString(),
      pass:'top_performer_carousel',
      success:true,
      project_slug:SLUG,
      import_id:selectedImportId,
      http_status:r.status,
      endpoint:endpoint,
      request_body:body,
      response:d,
      media_archive:maCar,
    });
    setTpStatus('carousel',tpCompactCarouselStatus(d),false,'ok');
    renderTpQualifyingList('carousel',d.qualifying_carousel_rows||[]);
    loadDeepCarouselTable();
  }catch(e){
    setTopPerfRunLog('carousel',{
      at:new Date().toISOString(),
      pass:'top_performer_carousel',
      success:false,
      project_slug:SLUG,
      import_id:selectedImportId,
      http_status:r?r.status:null,
      endpoint:endpoint,
      request_body:body,
      error:String(e.message||e),
      response_json:d,
      media_archive:d&&typeof d==='object'?tpMediaArchiveFromResponse(d,'top_performer_carousel'):null,
    });
    setTpStatus('carousel',String(e.message||e),true,'err');
    renderTpQualifyingList('carousel',[]);
    try{pushProcessingActivity(cafTs()+' top-performer (carousel): '+String(e.message||e),true);}catch(_d){}
  }finally{tpSetRunning('carousel',false);}
});

bind('btn-delete-carousel-insights-import','click',async function(){
  if(!SLUG||!selectedImportId){setTpStatus('carousel','Select an import first.',true);return;}
  if(!window.confirm('Delete ALL top_performer_carousel insight rows for this import from Postgres? This cannot be undone.'))return;
  var endpoint='/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/delete-evidence-insights';
  var body={analysis_tier:'top_performer_carousel',confirm:true};
  try{
    var r=await cafFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json().catch(function(){return {};});
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    setTpStatus('carousel','Deleted '+String(d.deleted||0)+' top_performer_carousel insight row(s) for this import.',false);
    try{pushProcessingActivity(cafTs()+' Deleted '+String(d.deleted||0)+' carousel insight row(s) for import '+selectedImportId,false);}catch(_e){}
    loadDeepCarouselTable();
  }catch(e){
    setTpStatus('carousel',String(e.message||e),true);
    try{pushProcessingActivity(cafTs()+' delete carousel insights failed: '+String(e.message||e),true);}catch(_e2){}
  }
});

bind('btn-delete-top-performer-insights-import','click',async function(){
  if(!SLUG||!selectedImportId){setTpStatus('carousel','Select an import first.',true);return;}
  if(!window.confirm('Delete ALL top_performer_carousel, top_performer_video, and top_performer_deep insight rows for this import? This cannot be undone.'))return;
  var endpoint='/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/delete-evidence-insights';
  var body={analysis_tiers:['top_performer_carousel','top_performer_video','top_performer_deep'],confirm:true};
  try{
    var r=await cafFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json().catch(function(){return {};});
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var n=String(d.deleted||0);
    setTpStatus('carousel','Deleted '+n+' top-performer insight row(s) total (carousel+video+deep).',false);
    setTpStatus('video','Deleted '+n+' top-performer insight row(s) total (carousel+video+deep).',false);
    setTpStatus('image','Deleted '+n+' top-performer insight row(s) total (carousel+video+deep).',false);
    try{pushProcessingActivity(cafTs()+' Deleted '+n+' top-performer insight row(s) (all tiers) for import '+selectedImportId,false);}catch(_e){}
    loadDeepCarouselTable();
    loadDeepVideoTable();
    loadDeepImageTable();
  }catch(e){
    setTpStatus('carousel',String(e.message||e),true);
    try{pushProcessingActivity(cafTs()+' delete top-performer insights failed: '+String(e.message||e),true);}catch(_e2){}
  }
});

bind('btn-run-deep-video-insights','click',async function(){
  if(!SLUG||!selectedImportId){setTpStatus('video','Select an import first.',true);return;}
  renderTpQualifyingList('video',[]);
  tpSetRunning('video',true);
  setTpStatus('video','Running video frame vision…',false,'running');
  var body=Object.assign({max_rows:16,max_frames:10,rescan:chk('tp-vision-rescan')},tpRatingGateRequestFields());
  var endpoint='/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/run-deep-video-insights';
  var r=null;
  var d=null;
  try{
    r=await cafFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    d=await r.json().catch(function(){return {};});
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var maVid=tpMediaArchiveFromResponse(d,'top_performer_video');
    setTopPerfRunLog('video',{
      at:new Date().toISOString(),
      pass:'top_performer_video',
      success:true,
      project_slug:SLUG,
      import_id:selectedImportId,
      http_status:r.status,
      endpoint:endpoint,
      request_body:body,
      response:d,
      media_archive:maVid,
    });
    setTpStatus('video',tpCompactVideoStatus(d),false,'ok');
    renderTpQualifyingList('video',d.qualifying_video_rows||[]);
    loadDeepVideoTable();
  }catch(e){
    setTopPerfRunLog('video',{
      at:new Date().toISOString(),
      pass:'top_performer_video',
      success:false,
      project_slug:SLUG,
      import_id:selectedImportId,
      http_status:r?r.status:null,
      endpoint:endpoint,
      request_body:body,
      error:String(e.message||e),
      response_json:d,
      media_archive:d&&typeof d==='object'?tpMediaArchiveFromResponse(d,'top_performer_video'):null,
    });
    setTpStatus('video',String(e.message||e),true,'err');
    renderTpQualifyingList('video',[]);
    try{pushProcessingActivity(cafTs()+' top-performer (video): '+String(e.message||e),true);}catch(_e2){}
  }finally{tpSetRunning('video',false);}
});

bind('btn-copy-top-log-image','click',async function(){
  try{
    if(!lastTopPerfLogs.image){
      window.alert('No image run logged yet. Click "Run top-performer (images)" first, then copy.');
      return;
    }
    var ok=await adminCopyTextToClipboard(JSON.stringify(Object.assign({caf_admin_top_performer_log:'image'},lastTopPerfLogs.image||{}),null,2));
    if(ok)try{pushProcessingActivity(cafTs()+' Copied image top-performer debug JSON to clipboard.',false);}catch(_x){}
  }catch(err){
    window.alert('Copy failed: '+String(err&&err.message||err));
  }
});
bind('btn-copy-top-log-carousel','click',async function(){
  try{
    if(!lastTopPerfLogs.carousel){
      window.alert('No carousel run logged yet. Click "Run top-performer (carousel)" first, then copy.');
      return;
    }
    var ok=await adminCopyTextToClipboard(JSON.stringify(Object.assign({caf_admin_top_performer_log:'carousel'},lastTopPerfLogs.carousel||{}),null,2));
    if(ok)try{pushProcessingActivity(cafTs()+' Copied carousel top-performer debug JSON to clipboard.',false);}catch(_x){}
  }catch(err){
    window.alert('Copy failed: '+String(err&&err.message||err));
  }
});
bind('btn-copy-top-log-video','click',async function(){
  try{
    if(!lastTopPerfLogs.video){
      window.alert('No video run logged yet. Click "Run top-performer (video frames)" first, then copy.');
      return;
    }
    var ok=await adminCopyTextToClipboard(JSON.stringify(Object.assign({caf_admin_top_performer_log:'video'},lastTopPerfLogs.video||{}),null,2));
    if(ok)try{pushProcessingActivity(cafTs()+' Copied video top-performer debug JSON to clipboard.',false);}catch(_x){}
  }catch(err){
    window.alert('Copy failed: '+String(err&&err.message||err));
  }
});
bind('btn-copy-top-log-all','click',async function(){
  try{
    var ok=await adminCopyTextToClipboard(
      JSON.stringify(
        {
          caf_admin_top_performer_logs_all:true,
          project_slug:SLUG||null,
          inputs_import_id:selectedImportId||null,
          runs:{image:lastTopPerfLogs.image,carousel:lastTopPerfLogs.carousel,video:lastTopPerfLogs.video},
        },
        null,
        2
      )
    );
    if(ok)try{pushProcessingActivity(cafTs()+' Copied combined top-performer debug JSON to clipboard.',false);}catch(_x){}
  }catch(err){
    window.alert('Copy failed: '+String(err&&err.message||err));
  }
});

bind('btn-inspect-import-stats','click',function(){
  runInspectApi(
    'GET import/stats',
    '/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/stats',
    true
  );
});
bind('btn-inspect-profile','click',function(){
  runInspectApi('GET profile','/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/profile',false);
});
bind('btn-inspect-audit','click',function(){
  runInspectApi('GET audit','/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/audit?limit=80',false);
});
bind('btn-inspect-tp-deep','click',function(){
  runInspectApi(
    'GET evidence-insights tier=top_performer_deep',
    '/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/evidence-insights?tier=top_performer_deep&limit=50&offset=0&sort=rating_desc',
    true
  );
});
bind('btn-inspect-tp-carousel','click',function(){
  runInspectApi(
    'GET evidence-insights tier=top_performer_carousel',
    '/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/evidence-insights?tier=top_performer_carousel&limit=50&offset=0&sort=rating_desc',
    true
  );
});
bind('btn-inspect-tp-video','click',function(){
  runInspectApi(
    'GET evidence-insights tier=top_performer_video',
    '/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/evidence-insights?tier=top_performer_video&limit=50&offset=0&sort=rating_desc',
    true
  );
});
bind('btn-inspect-prellm-sample','click',function(){
  var k=prellmKind||(broadKinds&&broadKinds.length?broadKinds[0]:'')||'instagram_post';
  var q='evidence_kind='+encodeURIComponent(k)+'&min_score=0&include_below_cutoff=1&sort=score_desc&limit=25&offset=0';
  runInspectApi(
    'GET pre-llm-evidence ('+k+')',
    '/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/pre-llm-evidence?'+q,
    true
  );
});
bind('btn-copy-prellm-tsv','click',async function(){
  var ok=await adminCopyTableFromWrap('prellm-table-wrap');
  flashAdminCopyMsg('prellm-copy-msg',ok);
});
bind('btn-copy-prellm-json','click',async function(){
  var rows=lastPrellmDisplayRows&&lastPrellmDisplayRows.length?lastPrellmDisplayRows:(lastPrellmAllRows||null);
  if(!rows||!rows.length){window.alert('Load the evidence table first.');return;}
  var ok=await adminCopyTextToClipboard(JSON.stringify(rows,null,2));
  flashAdminCopyMsg('prellm-copy-msg',ok);
});
bind('btn-copy-broad-tsv','click',function(){adminCopyTableFromWrap('broad-table-wrap');});
bind('btn-copy-broad-json','click',async function(){
  var rows=lastBroadInsightsDisplayRows&&lastBroadInsightsDisplayRows.length?lastBroadInsightsDisplayRows:(lastBroadInsightsAllRows||null);
  if(!rows||!rows.length){window.alert('Reload broad insights first.');return;}
  await adminCopyTextToClipboard(JSON.stringify(rows,null,2));
});
bind('btn-copy-op-lens-tsv','click',function(){adminCopyTableFromWrap('op-lens-out');});
bind('btn-copy-op-lens-json','click',async function(){
  if(!lastOpLensPayload){window.alert('Load evidence or insights in Operator lens first.');return;}
  await adminCopyTextToClipboard(JSON.stringify(lastOpLensPayload,null,2));
});
bind('btn-copy-deep-image-tsv','click',function(){adminCopyTableFromWrap('deep-image-table');});
bind('btn-copy-deep-carousel-tsv','click',function(){adminCopyTableFromWrap('deep-carousel-table');});
bind('btn-copy-deep-video-tsv','click',function(){adminCopyTableFromWrap('deep-video-table');});
bind('btn-inspect-copy-pre','click',async function(){
  if(!lastInspectBody){
    window.alert('Load something with the buttons above first.');
    return;
  }
  await adminCopyTextToClipboard(lastInspectBody);
});
bind('btn-inspect-evidence-row','click',function(){
  var idEl=document.getElementById('inspect-row-id');
  var id=idEl&&String(idEl.value||'').trim();
  if(!id){
    window.alert('Paste an evidence row UUID (from a table "Row ID" column or the database).');
    return;
  }
  runInspectApi(
    'GET evidence-row/'+id,
    '/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/evidence-row/'+encodeURIComponent(id),
    true
  );
});

function prellmKindToOpLensPlatform(k){
  if(!k)return '';
  var m={instagram_post:'instagram',facebook_post:'facebook',tiktok_video:'tiktok',reddit_post:'reddit',scraped_page:'web',html_summary:'web',source_registry:'source_registry',reference_pool:'reference_pool'};
  return m[k]||'';
}
function buildOpLensEvidenceUrl(){
  var qs=['import_id='+encodeURIComponent(selectedImportId)];
  var p=(document.getElementById('op-lens-ev-platform')||{}).value||'';
  if(p==='source_registry'||p==='reference_pool')qs.push('source_type='+encodeURIComponent(p));
  else if(p)qs.push('platform='+encodeURIComponent(p));
  var fmt=(document.getElementById('op-lens-ev-format')||{}).value||'';
  if(fmt)qs.push('format='+encodeURIComponent(fmt));
  var sort=(document.getElementById('op-lens-ev-sort')||{}).value||'rating_desc';
  qs.push('sort='+encodeURIComponent(sort));
  var mr=(document.getElementById('op-lens-ev-min-rating')||{}).value;
  if(mr!==''&&mr!=null&&String(mr).trim()!==''&&!isNaN(parseFloat(mr)))qs.push('min_engagement='+encodeURIComponent(String(mr).trim()));
  var s=(document.getElementById('op-lens-ev-search')||{}).value||'';
  if(String(s).trim())qs.push('search='+encodeURIComponent(String(s).trim()));
  var lim=parseInt(String((document.getElementById('op-lens-ev-limit')||{}).value||'50'),10);
  var off=parseInt(String((document.getElementById('op-lens-ev-offset')||{}).value||'0'),10);
  if(!isNaN(lim)&&lim>=1)qs.push('limit='+encodeURIComponent(String(Math.min(200,lim))));
  if(!isNaN(off)&&off>=0)qs.push('offset='+encodeURIComponent(String(off)));
  return '/v1/evidence/'+encodeURIComponent(SLUG)+'?'+qs.join('&');
}
function buildOpLensInsightsUrl(){
  var qs=['import_id='+encodeURIComponent(selectedImportId)];
  var p=(document.getElementById('op-lens-in-platform')||{}).value||'';
  if(p)qs.push('platform='+encodeURIComponent(p));
  var tier=(document.getElementById('op-lens-in-tier')||{}).value||'';
  if(tier)qs.push('analysis_tier='+encodeURIComponent(tier));
  var typ=(document.getElementById('op-lens-in-type')||{}).value||'';
  if(typ)qs.push('type='+encodeURIComponent(typ));
  var cf=(document.getElementById('op-lens-in-conf')||{}).value||'';
  if(cf!==''&&cf!=null&&String(cf).trim()!==''&&!isNaN(parseFloat(cf)))qs.push('confidence_min='+encodeURIComponent(String(cf).trim()));
  var s=(document.getElementById('op-lens-in-search')||{}).value||'';
  if(String(s).trim())qs.push('search='+encodeURIComponent(String(s).trim()));
  var lim=parseInt(String((document.getElementById('op-lens-in-limit')||{}).value||'50'),10);
  var off=parseInt(String((document.getElementById('op-lens-in-offset')||{}).value||'0'),10);
  if(!isNaN(lim)&&lim>=1)qs.push('limit='+encodeURIComponent(String(Math.min(200,lim))));
  if(!isNaN(off)&&off>=0)qs.push('offset='+encodeURIComponent(String(off)));
  return '/v1/insights/'+encodeURIComponent(SLUG)+'?'+qs.join('&');
}
function opLensFmtMetrics(m){
  if(!m||typeof m!=='object')return '\u2014';
  var parts=[];
  if(m.likes!=null)parts.push('L'+m.likes);
  if(m.comments!=null)parts.push('C'+m.comments);
  if(m.shares!=null)parts.push('Sh'+m.shares);
  if(m.saves!=null)parts.push('Sv'+m.saves);
  if(m.views!=null)parts.push('V'+m.views);
  if(m.engagement_rate!=null)parts.push('ER'+m.engagement_rate);
  return parts.length?parts.join(' '):'\u2014';
}
function opLensEvidenceFieldTable(it){
  var keys=Object.keys(it).sort();
  var rows=keys.map(function(k){
    var v=it[k];
    var s=v!=null&&typeof v==='object'?JSON.stringify(v):String(v);
    if(s.length>2400)s=s.slice(0,2400)+'...';
    return '<tr><td class="mono" style="vertical-align:top;white-space:nowrap">'+esc(k)+'</td><td style="word-break:break-word;font-size:11px">'+esc(s)+'</td></tr>';
  }).join('');
  return '<table class="sp-modal-table" style="width:100%;font-size:11px;margin-top:6px">'+rows+'</table>';
}
function renderOpLensEvidence(j){
  var el=document.getElementById('op-lens-out');
  if(!el)return;
  if(!j||!j.ok||!Array.isArray(j.items)){
    el.innerHTML='<span style="color:var(--red)">Unexpected response</span>';
    return;
  }
  var wide=document.getElementById('op-lens-ev-all-cols')&&document.getElementById('op-lens-ev-all-cols').checked;
  var note=j.note?'<p class="runs-ops-hint" style="margin:0 0 6px;color:var(--muted)">'+esc(String(j.note))+'</p>':'';
  var head='<p class="runs-ops-hint" style="margin:0 0 8px">Total (SQL filters): '+esc(String(j.total!=null?j.total:'?'))+' · showing '+esc(String(j.items.length))+'</p>'+note;
  var rows=j.items.map(function(it){
    var u=it.source_url?String(it.source_url):'';
    var link=u?'<a target="_blank" rel="noopener noreferrer" href="'+esc(u)+'">open</a>':'\u2014';
    var thumb=it.thumbnail_url?'<img src="'+esc(String(it.thumbnail_url))+'" alt="" style="max-width:48px;max-height:48px;border-radius:6px;object-fit:cover" loading="lazy" />':'\u2014';
    var tags=Array.isArray(it.hashtags)?it.hashtags.slice(0,24).map(function(t){return '#'+esc(String(t));}).join(' '):'\u2014';
    var cap=it.caption?String(it.caption):'';
    var det='<details style="margin-top:6px"><summary style="cursor:pointer;font-size:11px;color:var(--muted)">All fields</summary>'+opLensEvidenceFieldTable(it)+'</details>';
    if(!wide){
      return '<tr><td class="mono">'+esc(String(it.id||''))+'</td><td>'+esc(String(it.platform||''))+'</td><td class="mono" style="font-size:10px">'+esc(String(it.source_type||''))+'</td><td>'+esc(String(it.format||''))+'</td><td>'+(it.rating_score!=null&&it.rating_score!==''?esc(String(it.rating_score)):'\u2014')+'</td><td style="max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+esc(cap)+'">'+esc(String(it.hook||it.caption||'\u2014'))+'</td><td>'+link+'</td><td style="vertical-align:top">'+det+'</td></tr>';
    }
    return '<tr><td class="mono">'+esc(String(it.id||''))+'</td><td>'+thumb+'</td><td>'+esc(String(it.platform||''))+'</td><td class="mono" style="font-size:10px">'+esc(String(it.source_type||''))+'</td><td>'+esc(String(it.format||''))+'</td><td>'+(it.rating_score!=null&&it.rating_score!==''?esc(String(it.rating_score)):'\u2014')+'</td><td style="max-width:100px;overflow:hidden;font-size:10px" title="'+esc(String(it.creator||''))+'">'+esc(String(it.creator||'\u2014'))+'</td><td style="font-size:10px">'+esc(opLensFmtMetrics(it.metrics))+'</td><td style="max-width:120px;font-size:10px;word-break:break-word">'+tags+'</td><td style="max-width:140px;font-size:10px;white-space:nowrap;overflow:hidden" title="'+esc(cap)+'">'+esc(String(it.hook||'\u2014'))+'</td><td style="max-width:160px;font-size:10px;word-break:break-word" title="'+esc(cap)+'">'+esc(cap.slice(0,180)+(cap.length>180?'...':''))+'</td><td style="font-size:10px">'+esc(String(it.scraped_at||'\u2014'))+'</td><td style="font-size:10px">'+esc(String(it.created_at||'').slice(0,19))+'</td><td>'+link+'</td><td style="vertical-align:top;font-size:10px">'+esc(String((it.media_urls&&it.media_urls.length)||0))+' urls</td><td style="vertical-align:top">'+det+'</td></tr>';
  }).join('');
  var th=wide
    ?'<thead><tr><th>ID</th><th>Thumb</th><th>Plat</th><th>Source type</th><th>Format</th><th>Rating</th><th>Creator</th><th>Metrics</th><th>Tags</th><th>Hook</th><th>Caption</th><th>Scraped</th><th>Created</th><th>URL</th><th>Media</th><th>Fields</th></tr></thead>'
    :'<thead><tr><th>ID</th><th>Plat</th><th>Source type</th><th>Format</th><th>Rating</th><th>Hook / caption</th><th>URL</th><th>Fields</th></tr></thead>';
  el.innerHTML=head+'<div style="max-height:min(70vh,520px);overflow:auto;border:1px solid var(--border);border-radius:8px"><table class="sp-modal-table" style="width:100%;font-size:12px">'+th+'<tbody>'+rows+'</tbody></table></div>';
  lastOpLensPayload=j;
}
function opLensSortInsights(items,mode){
  var out=items.slice();
  function conf(x){return x.confidence!=null&&!isNaN(Number(x.confidence))?Number(x.confidence):-1;}
  function ts(x){return String(x.created_at||'');}
  if(mode==='confidence_desc')out.sort(function(a,b){return conf(b)-conf(a);});
  else if(mode==='confidence_asc')out.sort(function(a,b){return conf(a)-conf(b);});
  else if(mode==='created_asc')out.sort(function(a,b){return ts(a).localeCompare(ts(b));});
  else if(mode==='title_asc')out.sort(function(a,b){return String(a.title||'').localeCompare(String(b.title||''));});
  else out.sort(function(a,b){return ts(b).localeCompare(ts(a));});
  return out;
}
function renderOpLensInsights(j){
  var el=document.getElementById('op-lens-out');
  if(!el)return;
  if(!j||!j.ok||!Array.isArray(j.items)){
    el.innerHTML='<span style="color:var(--red)">Unexpected response</span>';
    return;
  }
  var sortMode=(document.getElementById('op-lens-in-sort')||{}).value||'created_desc';
  var items=opLensSortInsights(j.items,sortMode);
  var note=(j.note?'<p class="runs-ops-hint" style="margin:0 0 6px;color:var(--muted)">'+esc(String(j.note))+'</p>':'')+'<p class="runs-ops-hint" style="margin:0 0 8px;font-size:11px;color:var(--muted)">Sorted on this page: '+esc(sortMode)+'</p>';
  var cards=items.map(function(it){
    var ev=(it.supporting_evidence_ids&&it.supporting_evidence_ids[0])?String(it.supporting_evidence_ids[0]):'';
    var cf=it.confidence!=null?esc(String(it.confidence)):'\u2014';
    var det='<details style="margin-top:8px"><summary style="cursor:pointer;font-size:11px;color:var(--muted)">All fields (JSON)</summary><pre style="font-size:10px;white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto;margin:6px 0 0;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">'+esc(JSON.stringify(it,null,2))+'</pre></details>';
    return '<div style="border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px;background:var(--card)"><div style="font-size:11px;color:var(--muted)">'+esc(String(it.type||''))+' · '+esc(String(it.analysis_tier||''))+' · confidence '+cf+'</div><div style="font-weight:600;margin:4px 0">'+esc(String(it.title||''))+'</div><div style="font-size:12px;line-height:1.45;color:var(--text)">'+esc(String(it.summary||''))+'</div><div style="margin-top:6px;font-size:11px;color:var(--muted)">Evidence row <span class="mono">'+esc(ev)+'</span> · formats '+esc(JSON.stringify(it.formats||[]))+' · platforms '+esc(JSON.stringify(it.platforms||[]))+'</div>'+det+'</div>';
  }).join('');
  el.innerHTML=note+(cards||'<span class="empty">No insights in this window.</span>');
  lastOpLensPayload=j;
}
bind('btn-op-lens-ev-sync-tab','click',function(){
  var sel=document.getElementById('op-lens-ev-platform');
  if(!sel)return;
  sel.value=prellmKindToOpLensPlatform(prellmKind);
});
bind('btn-op-lens-evidence','click',async function(){
  var el=document.getElementById('op-lens-out');
  if(!SLUG||!selectedImportId){window.alert('Select an import first.');return;}
  var url=buildOpLensEvidenceUrl();
  if(el)el.textContent='Loading...';
  try{pushProcessingActivity(cafTs()+' GET /v1/evidence (read model)',false);}catch(_e){}
  try{
    var r=await cafFetch(url);
    var j=await r.json();
    if(!r.ok||!j.ok)throw new Error(apiErr(j,'HTTP '+r.status));
    renderOpLensEvidence(j);
  }catch(e){if(el)el.innerHTML='<span style="color:var(--red)">'+esc(e.message||e)+'</span>';}
});
bind('btn-op-lens-insights','click',async function(){
  var el=document.getElementById('op-lens-out');
  if(!SLUG||!selectedImportId){window.alert('Select an import first.');return;}
  var url=buildOpLensInsightsUrl();
  if(el)el.textContent='Loading...';
  try{pushProcessingActivity(cafTs()+' GET /v1/insights (read model)',false);}catch(_e){}
  try{
    var r=await cafFetch(url);
    var j=await r.json();
    if(!r.ok||!j.ok)throw new Error(apiErr(j,'HTTP '+r.status));
    renderOpLensInsights(j);
  }catch(e){if(el)el.innerHTML='<span style="color:var(--red)">'+esc(e.message||e)+'</span>';}
});

async function initBroadPanel(){
  var bar=document.getElementById('broad-kind-bar');
  var meta=document.getElementById('broad-meta');
  var wrap=document.getElementById('broad-table-wrap');
  if(!bar||!SLUG||!selectedImportId)return;
  if(!broadKinds.length){
    bar.innerHTML='Loading kinds...';
    try{
      var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/stats');
      var d=await r.json();
      if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
      syncBroadKindsFromStats((d.stats&&d.stats.by_kind)||{});
    }catch(e){
      bar.innerHTML='<span style="color:var(--red)">'+esc(e.message||e)+'</span>';
      return;
    }
  }
  if(!broadKinds.length){
    bar.innerHTML='<span class="empty">No social platform rows for broad insights. Source rows are under Sources.</span>';
    if(meta)meta.textContent='';
    if(wrap)wrap.innerHTML='';
    return;
  }
  var h='';
  for(var i=0;i<broadKinds.length;i++){
    var k=broadKinds[i];
    h+='<button type="button" class="'+(k===broadKind?'btn btn-sm':'btn-ghost btn-sm')+' broad-kind" data-kind="'+esc(k)+'">'+esc(kindLabel(k,'insights'))+'</button>';
  }
  bar.innerHTML=h;
  bar.querySelectorAll('.broad-kind').forEach(function(btn){
    btn.addEventListener('click',function(){
      broadKind=btn.getAttribute('data-kind')||'';
      initBroadPanel();
    });
  });
  // Keep prompt preview in sync with platform unless user is editing.
  if(!broadPromptDirty)loadBroadPromptIntoEditor();
  loadBroadTable();
  scheduleBroadEligibilityEstimate();
}

function readBroadTableFilters(){
  var searchEl=document.getElementById('broad-filter-search');
  var kindEl=document.getElementById('broad-filter-kind');
  var emoEl=document.getElementById('broad-filter-emotion');
  var hookEl=document.getElementById('broad-filter-hook-type');
  var minPreEl=document.getElementById('broad-filter-min-prellm');
  var minRatEl=document.getElementById('broad-filter-min-rating');
  function readMin(el){
    if(!el)return null;
    var raw=String(el.value||'').trim();
    if(raw==='')return null;
    var n=parseFloat(raw);
    return Number.isFinite(n)?n:null;
  }
  return {
    search:searchEl?String(searchEl.value||'').trim().toLowerCase():'',
    kind:kindEl?String(kindEl.value||'').trim().toLowerCase():'',
    emotion:emoEl?String(emoEl.value||'').trim().toLowerCase():'',
    hookType:hookEl?String(hookEl.value||'').trim().toLowerCase():'',
    minPrellm:readMin(minPreEl),
    minRating:readMin(minRatEl)
  };
}
function broadDisplayKind(x){
  return String(x.evidence_display_kind||'').trim()||String(x.evidence_kind||'');
}
function applyBroadTableFilters(rows){
  var f=readBroadTableFilters();
  var out=[];
  for(var i=0;i<rows.length;i++){
    var x=rows[i];
    if(f.kind&&broadDisplayKind(x).toLowerCase()!==f.kind)continue;
    if(f.emotion&&String(x.primary_emotion||'').trim().toLowerCase()!==f.emotion)continue;
    if(f.hookType&&String(x.hook_type||'').trim().toLowerCase()!==f.hookType)continue;
    if(f.minPrellm!=null){
      var ps=parseFloat(String(x.pre_llm_score));
      if(!Number.isFinite(ps)||ps<f.minPrellm)continue;
    }
    if(f.minRating!=null){
      var rs=parseFloat(String(x.evidence_rating_score));
      if(!Number.isFinite(rs)||rs<f.minRating)continue;
    }
    if(f.search){
      var blob=(
        String(x.insights_id||'')+' '+String(x.source_evidence_row_id||'')+' '+
        String(x.why_it_worked||'')+' '+String(x.hook_text||'')+' '+String(x.hashtags||'')+' '+
        String(x.primary_emotion||'')+' '+String(x.secondary_emotion||'')+' '+String(x.hook_type||'')+' '+
        String(x.cta_type||'')+' '+String(x.caption_style||'')+' '+String(x.custom_label_1||'')+' '+
        String(x.custom_label_2||'')+' '+String(x.custom_label_3||'')+' '+String(x.evidence_post_url||'')
      ).toLowerCase();
      if(blob.indexOf(f.search)<0)continue;
    }
    out.push(x);
  }
  return out;
}
function populateBroadFilterSelect(selId,rows,getter){
  var sel=document.getElementById(selId);
  if(!sel)return;
  var cur=String(sel.value||'');
  var set={};
  for(var i=0;i<rows.length;i++){
    var v=String(getter(rows[i])||'').trim();
    if(v)set[v.toLowerCase()]=v;
  }
  var keys=Object.keys(set).sort();
  var html='<option value="">Any</option>';
  for(var j=0;j<keys.length;j++){
    var lk=keys[j];
    html+='<option value="'+esc(lk)+'">'+esc(set[lk])+'</option>';
  }
  sel.innerHTML=html;
  if(cur&&set[cur])sel.value=cur;
}
function populateBroadFilterSelects(rows){
  populateBroadFilterSelect('broad-filter-kind',rows,broadDisplayKind);
  populateBroadFilterSelect('broad-filter-emotion',rows,function(x){return x.primary_emotion;});
  populateBroadFilterSelect('broad-filter-hook-type',rows,function(x){return x.hook_type;});
}
function updateBroadFilterSummary(total,filtered){
  var el=document.getElementById('broad-filter-summary');
  if(!el)return;
  if(!total){
    el.textContent='Reload broad insights to filter rows in the table below.';
    return;
  }
  if(filtered===total){
    el.textContent='Showing all '+String(total)+' loaded row'+(total===1?'':'s')+'.';
    return;
  }
  el.textContent='Showing '+String(filtered)+' of '+String(total)+' loaded rows.';
}
function bindBroadEvidenceRowLinks(wrap){
  if(!wrap)return;
  wrap.querySelectorAll('.broad-ev-link').forEach(function(a){
    a.addEventListener('click',async function(ev){
      ev.preventDefault();
      try{
        var id=this.getAttribute('data-row-id');
        if(!id)return;
        await showBroadEvidenceRow(id);
      }catch(e){
        var pre=document.getElementById('broad-evidence-pre');
        var box=document.getElementById('broad-evidence-viewer');
        if(box)box.style.display='block';
        if(pre)pre.textContent=String(e.message||e);
      }
    });
  });
}
function updateBroadHscrollBar(){
  var wrap=document.getElementById('broad-table-wrap');
  var bar=document.getElementById('broad-hscroll-bar');
  var rng=document.getElementById('broad-table-hscroll');
  if(!wrap||!bar||!rng)return;
  var maxScroll=Math.max(0,wrap.scrollWidth-wrap.clientWidth);
  if(maxScroll<8){
    bar.style.display='none';
    rng.value='0';
    return;
  }
  bar.style.display='block';
  var pct=Math.round((wrap.scrollLeft/maxScroll)*100);
  broadHscrollSyncing=true;
  rng.value=String(pct);
  broadHscrollSyncing=false;
}
function syncBroadWrapFromHscroll(){
  if(broadHscrollSyncing)return;
  var wrap=document.getElementById('broad-table-wrap');
  var rng=document.getElementById('broad-table-hscroll');
  if(!wrap||!rng)return;
  var maxScroll=Math.max(0,wrap.scrollWidth-wrap.clientWidth);
  if(maxScroll<1)return;
  wrap.scrollLeft=Math.round((parseInt(rng.value,10)||0)/100*maxScroll);
}
function rerenderBroadTableFromCache(){
  var wrap=document.getElementById('broad-table-wrap');
  if(!wrap||!lastBroadInsightsAllRows)return;
  var filtered=applyBroadTableFilters(lastBroadInsightsAllRows);
  lastBroadInsightsDisplayRows=filtered;
  lastBroadInsightsRows=filtered;
  updateBroadFilterSummary(lastBroadInsightsAllRows.length,filtered.length);
  if(!filtered.length){
    wrap.innerHTML='<div class="empty" style="padding:12px">'+(lastBroadInsightsAllRows.length?'No rows match the current table filters.':'No rows.')+'</div>';
    updateBroadHscrollBar();
    return;
  }
  wrap.innerHTML=renderInsightTable(filtered,BROAD_INSIGHT_TABLE_COLS,{
    tableClass:'insights-data-table',
    minWidth:2800,
    rowEvidenceLink:true,
    emptyMsg:'No rows.'
  });
  bindBroadEvidenceRowLinks(wrap);
  wrap.scrollLeft=0;
  updateBroadHscrollBar();
}
function storeAndRenderBroadRows(rows){
  lastBroadInsightsAllRows=rows||[];
  populateBroadFilterSelects(lastBroadInsightsAllRows);
  rerenderBroadTableFromCache();
}
function scheduleBroadFilterRerender(){
  if(broadTableFilterTimer)clearTimeout(broadTableFilterTimer);
  broadTableFilterTimer=setTimeout(rerenderBroadTableFromCache,180);
}
function clearBroadTableFilters(){
  var searchEl=document.getElementById('broad-filter-search');
  var kindEl=document.getElementById('broad-filter-kind');
  var emoEl=document.getElementById('broad-filter-emotion');
  var hookEl=document.getElementById('broad-filter-hook-type');
  var minPreEl=document.getElementById('broad-filter-min-prellm');
  var minRatEl=document.getElementById('broad-filter-min-rating');
  if(searchEl)searchEl.value='';
  if(kindEl)kindEl.value='';
  if(emoEl)emoEl.value='';
  if(hookEl)hookEl.value='';
  if(minPreEl)minPreEl.value='';
  if(minRatEl)minRatEl.value='';
  rerenderBroadTableFromCache();
}

async function loadBroadTable(){
  var meta=document.getElementById('broad-meta');
  var state=document.getElementById('broad-state');
  var wrap=document.getElementById('broad-table-wrap');
  if(!SLUG||!selectedImportId||!broadKind||!meta||!wrap)return;
  meta.textContent='Loading...';
  if(state)state.textContent='Loading...';
  wrap.innerHTML='';
  try{
    var sortSel=document.getElementById('broad-insight-sort');
    var limitSel=document.getElementById('broad-insight-limit');
    var sort=(sortSel&&sortSel.value)?sortSel.value:'rating_desc';
    var limRaw=(limitSel&&limitSel.value)?parseInt(limitSel.value,10):200;
    var limit=(!Number.isFinite(limRaw)||limRaw<1)?200:Math.min(200,limRaw);
    var q='tier=broad_llm&evidence_kind='+encodeURIComponent(broadKind)+'&limit='+encodeURIComponent(String(limit))+'&offset=0&sort='+encodeURIComponent(sort);
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/evidence-insights?'+q);
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var countsTab=d.counts||{};
    var countsImp=d.counts_import||d.counts||{};
    var rows=d.insights||[];
    lastBroadInsightsDisplayRows=null;
    var lastAt=rows.length?String(rows[0].updated_at||rows[0].created_at||''):'';
    if(state){
      state.textContent=
        'Rows in DB (this tab): '+String(countsTab.broad_llm||0)+
        ' | Import total broad: '+String(countsImp.broad_llm||0)+
        (lastAt?(' | Last updated: '+lastAt):'');
    }
    meta.textContent=JSON.stringify({
      project_slug:SLUG,
      inputs_import_id:selectedImportId,
      upload_filename:selectedImportLabel||null,
      evidence_kind:broadKind,
      counts_this_tab:countsTab,
      counts_whole_import:countsImp,
      last_updated_at:lastAt||null
    },null,2);
    var nTab=(d.counts&&typeof d.counts.broad_llm==='number')?d.counts.broad_llm:0;
    if(rows.length===0){
      lastBroadInsightsAllRows=[];
      lastBroadInsightsRows=[];
      updateBroadFilterSummary(0,0);
      wrap.innerHTML='<div class="empty" style="padding:12px">No broad insights for <span class="mono">'+esc(broadKind)+'</span> yet ('+String(nTab)+' in DB for this kind on this import). If other tabs have rows but this one does not, run broad for this tab with <strong>Rescan</strong> and/or turn off <strong>Use cutoff</strong> so enough rows qualify. Import-wide total (all kinds) is in the JSON as <span class="mono">counts_whole_import.broad_llm</span>.</div>';
      updateBroadHscrollBar();
      return;
    }
    storeAndRenderBroadRows(rows);
    if(!wrap._broadScrollBound){
      wrap._broadScrollBound=true;
      wrap.addEventListener('scroll',updateBroadHscrollBar);
    }
    refreshInsightCounts();
  }catch(e){meta.textContent=String(e);}
}
bind('btn-reload-broad','click',loadBroadTable);
bind('broad-insight-sort','change',loadBroadTable);
bind('broad-insight-limit','change',loadBroadTable);
bind('broad-filter-search','input',scheduleBroadFilterRerender);
bind('broad-filter-kind','change',rerenderBroadTableFromCache);
bind('broad-filter-emotion','change',rerenderBroadTableFromCache);
bind('broad-filter-hook-type','change',rerenderBroadTableFromCache);
bind('broad-filter-min-prellm','input',scheduleBroadFilterRerender);
bind('broad-filter-min-rating','input',scheduleBroadFilterRerender);
bind('broad-filter-clear','click',clearBroadTableFilters);
bind('broad-table-hscroll','input',syncBroadWrapFromHscroll);
bind('broad-max-rows','input',scheduleBroadEligibilityEstimate);
bind('broad-rescan','change',scheduleBroadEligibilityEstimate);
bind('broad-use-cutoff','change',scheduleBroadEligibilityEstimate);
bind('btn-pack-inspect-reload','click',loadPackInspectDropdown);
bind('pack-inspect-select','change',loadSelectedSignalPack);
bind('pack-idea-list-select','change',function(){
  var id=(this.value||'').trim();
  if(id)selectedIdeaListId=id;
  loadIdeaListIdeasTable();
  updatePackSummary();
});

function renderInsightTable(rows,cols,opts){
  opts=opts||{};
  if(!rows.length)return '<div class="empty" style="padding:12px">'+(opts.emptyMsg||'No rows.')+'</div>';
  var minW=opts.minWidth||980;
  var tblCls='sp-modal-table'+(opts.tableClass?(' '+opts.tableClass):'');
  var longKeys={why_it_worked:1,hook_text:1,hashtags:1,caption_style:1,custom_label_1:1,custom_label_2:1,custom_label_3:1};
  var jsonKeys={risk_flags_json:1,aesthetic_analysis_json:1,raw_llm_json:1};
  var tb='<table class="'+tblCls+'" style="width:max-content;min-width:'+minW+'px;table-layout:auto"><thead><tr>';
  for(var c=0;c<cols.length;c++)tb+='<th>'+esc(cols[c].label)+'</th>';
  tb+='</tr></thead><tbody>';
  for(var i=0;i<rows.length;i++){
    var x=rows[i];
    tb+='<tr>';
    for(var j=0;j<cols.length;j++){
      var k=cols[j].key;
      var v=x[k];
      var cell;
      var tdCls='insight-cell-mono';
      if(k==='source_evidence_row_id'&&opts.rowEvidenceLink){
        cell='<a href="#" class="broad-ev-link" data-row-id="'+esc(String(v||''))+'">'+esc(String(v||''))+'</a>';
      }else if(k==='evidence_post_url'){
        var pu=typeof v==='string'?v.trim():'';
        if(pu)cell='<a href="'+esc(pu)+'" target="_blank" rel="noopener noreferrer" class="mono" style="font-size:12px" title="'+escAttr(pu)+'">'+esc(pu.length>56?pu.slice(0,53)+'...':pu)+'</a>';
        else cell='<span style="color:var(--muted)">-</span>';
      }else if(k==='evidence_kind'){
        var dk=typeof x.evidence_display_kind==='string'?x.evidence_display_kind.trim():'';
        var rawK=typeof v==='string'?v:String(v||'');
        cell=esc(dk||rawK);
      }else if(k==='pre_llm_score'||k==='evidence_rating_score'||k==='confidence_score'){
        cell=fmtInsightScore(v);
      }else if(k==='insights_id'||k==='llm_model'||k==='updated_at'||k==='created_at'||k==='hook_type'||k==='cta_type'||k==='primary_emotion'||k==='secondary_emotion'||k==='analysis_tier'){
        cell=esc(typeof v==='string'?v:String(v!=null?v:''));
      }else if(jsonKeys[k]){
        tdCls='insight-cell-long';
        var js=v!==undefined&&v!==null?JSON.stringify(v):'';
        var full=js;
        if(js.length>96)js=js.slice(0,93)+'...';
        cell='<span class="mono" style="font-size:10px" title="'+escAttr(full)+'">'+esc(js||'-')+'</span>';
      }else if(longKeys[k]&&typeof v==='string'&&v.length){
        tdCls='insight-cell-long';
        cell='<div class="insight-cell-clamp" title="'+escAttr(v)+'">'+esc(v)+'</div>';
      }else{
        cell=esc(typeof v==='string'?v:JSON.stringify(v!==undefined&&v!==null?v:''));
      }
      tb+='<td class="'+tdCls+'">'+cell+'</td>';
    }
    tb+='</tr>';
  }
  tb+='</tbody></table>';
  return tb;
}

function ideaSelKey(){
  return 'caf.inputs_processing.idea_selection.'+String(SLUG||'')+'.'+String(selectedImportId||'')+'.'+String(selectedIdeaListId||'');
}

function loadIdeaSelection(){
  try{
    var raw=localStorage.getItem(ideaSelKey());
    if(!raw)return {};
    var obj=JSON.parse(raw);
    return (obj&&typeof obj==='object')?obj:{};
  }catch(e){return {};}
}

function saveIdeaSelection(sel){
  try{
    localStorage.setItem(ideaSelKey(),JSON.stringify(sel||{}));
  }catch(e){}
}

var lastIdeasById={};
var lastIdeasAllRows=null;
var lastIdeasDisplayRows=null;
var ideasFilterTimer=null;

function readIdeasFilters(){
  var searchEl=document.getElementById('ideas-filter-search');
  var fmtEl=document.getElementById('ideas-filter-format');
  var platEl=document.getElementById('ideas-filter-platform');
  var selEl=document.getElementById('ideas-filter-selected');
  var sortEl=document.getElementById('ideas-sort');
  return {
    search:searchEl?String(searchEl.value||'').trim().toLowerCase():'',
    format:fmtEl?String(fmtEl.value||'').trim().toLowerCase():'',
    platform:platEl?String(platEl.value||'').trim().toLowerCase():'',
    selectedOnly:!!(selEl&&selEl.checked),
    sort:sortEl?String(sortEl.value||'confidence_desc'):'confidence_desc'
  };
}
function ideaConfNum(x){
  var v=x&&x.confidence_score;
  if(v==null||v==='')return -1;
  var n=Number(v);
  return Number.isFinite(n)?n:-1;
}
function sortIdeasRows(rows,mode){
  var out=rows.slice();
  if(mode==='confidence_asc'){
    out.sort(function(a,b){return ideaConfNum(a)-ideaConfNum(b);});
  }else if(mode==='title_asc'){
    out.sort(function(a,b){return String(a.title||'').localeCompare(String(b.title||''));});
  }else if(mode==='title_desc'){
    out.sort(function(a,b){return String(b.title||'').localeCompare(String(a.title||''));});
  }else if(mode==='format_asc'){
    out.sort(function(a,b){
      var c=String(a.format||'').localeCompare(String(b.format||''));
      return c!==0?c:String(a.title||'').localeCompare(String(b.title||''));
    });
  }else if(mode==='platform_asc'){
    out.sort(function(a,b){
      var c=String(a.platform||'').localeCompare(String(b.platform||''));
      return c!==0?c:String(a.title||'').localeCompare(String(b.title||''));
    });
  }else{
    out.sort(function(a,b){return ideaConfNum(b)-ideaConfNum(a);});
  }
  return out;
}
function applyIdeasFiltersAndSort(ideas){
  var f=readIdeasFilters();
  var sel=loadIdeaSelection();
  var out=[];
  for(var i=0;i<ideas.length;i++){
    var x=ideas[i];
    var id=String(x.id||'');
    if(f.selectedOnly&&(!id||!sel[id]))continue;
    if(f.format&&String(x.format||'').toLowerCase()!==f.format)continue;
    if(f.platform&&String(x.platform||'').toLowerCase()!==f.platform)continue;
    if(f.search){
      var blob=(String(x.title||'')+' '+String(x.hook||'')+' '+String(x.three_liner||'')).toLowerCase();
      if(blob.indexOf(f.search)<0)continue;
    }
    out.push(x);
  }
  return sortIdeasRows(out,f.sort);
}
function populateIdeasPlatformFilter(ideas){
  var sel=document.getElementById('ideas-filter-platform');
  if(!sel)return;
  var cur=String(sel.value||'');
  var set={};
  for(var i=0;i<ideas.length;i++){
    var p=String(ideas[i].platform||'').trim();
    if(p)set[p.toLowerCase()]=p;
  }
  var keys=Object.keys(set).sort();
  var html='<option value="">Any</option>';
  for(var j=0;j<keys.length;j++){
    var k=keys[j];
    var label=set[k];
    html+='<option value="'+esc(k)+'">'+esc(label)+'</option>';
  }
  sel.innerHTML=html;
  if(cur&&set[cur])sel.value=cur;
}
function countIdeasByFormat(ideas){
  var c={};
  for(var i=0;i<ideas.length;i++){
    var f=String(ideas[i].format||'other').toLowerCase()||'other';
    c[f]=(c[f]||0)+1;
  }
  return c;
}
function updateIdeasFilterSummary(total,filtered,allIdeas){
  var el=document.getElementById('ideas-filter-summary');
  if(!el)return;
  if(!total){
    el.textContent='Load or generate an idea list to review rows here.';
    return;
  }
  var sel=loadIdeaSelection();
  var selectedN=0;
  for(var i=0;i<allIdeas.length;i++){
    var id=String(allIdeas[i].id||'');
    if(id&&sel[id])selectedN++;
  }
  var byFmt=countIdeasByFormat(allIdeas);
  var fmtParts=[];
  var fk=Object.keys(byFmt).sort();
  for(var j=0;j<fk.length;j++)fmtParts.push(fk[j]+' '+byFmt[fk[j]]);
  el.textContent=
    'Showing '+String(filtered.length)+' of '+String(total)+' ideas'+
    (selectedN?' · '+String(selectedN)+' selected':'')+
    (fmtParts.length?' · '+fmtParts.join(' · '):'');
}
function bindIdeasTableInteractions(ideasForSelectAll){
  var wrap=document.getElementById('idea-list-table-wrap');
  if(!wrap)return;
  wrap.querySelectorAll('.idea-check').forEach(function(cb){
    cb.addEventListener('change',function(){
      var id=this.getAttribute('data-id')||'';
      var cur=loadIdeaSelection();
      if(this.checked)cur[id]=true;else delete cur[id];
      saveIdeaSelection(cur);
      rerenderIdeasTableFromCache();
    });
  });
  wrap.querySelectorAll('.idea-row').forEach(function(tr){
    tr.addEventListener('click',function(ev){
      var t=ev&&ev.target;
      if(t&&t.tagName&&String(t.tagName).toLowerCase()==='input')return;
      var id=this.getAttribute('data-id')||'';
      if(!id)return;
      openIdeaPreview(id);
    });
  });
  var q=wrap.querySelector('#ideas-check-all');
  if(q){
    q.addEventListener('change',function(){
      var cur={};
      if(this.checked){
        for(var k=0;k<ideasForSelectAll.length;k++){
          var id=String(ideasForSelectAll[k].id||'');
          if(id)cur[id]=true;
        }
      }
      saveIdeaSelection(cur);
      rerenderIdeasTableFromCache();
    });
  }
}
function rerenderIdeasTableFromCache(){
  var wrap=document.getElementById('idea-list-table-wrap');
  var state=document.getElementById('ideas-state');
  if(!wrap||!lastIdeasAllRows)return;
  var filtered=applyIdeasFiltersAndSort(lastIdeasAllRows);
  lastIdeasDisplayRows=filtered;
  updateIdeasFilterSummary(lastIdeasAllRows.length,filtered.length,lastIdeasAllRows);
  var sel=loadIdeaSelection();
  var selectedN=0;
  for(var i=0;i<lastIdeasAllRows.length;i++){
    var id=String(lastIdeasAllRows[i].id||'');
    if(id&&sel[id])selectedN++;
  }
  if(state){
    state.textContent='Ideas: '+String(lastIdeasAllRows.length)+' | Selected: '+String(selectedN)+' | Showing: '+String(filtered.length);
  }
  wrap.innerHTML=renderIdeasTable(filtered,{filteredFromTotal:!!(lastIdeasAllRows.length&&filtered.length===0)});
  bindIdeasTableInteractions(filtered);
}
function scheduleIdeasFilterRerender(){
  if(ideasFilterTimer)clearTimeout(ideasFilterTimer);
  ideasFilterTimer=setTimeout(rerenderIdeasTableFromCache,180);
}
function pickIdeaText(j){
  if(!j||typeof j!=='object')return '';
  var lines=[];
  if(j.title)lines.push(String(j.title));
  if(j.hook)lines.push('Hook: '+String(j.hook));
  if(j.three_liner)lines.push(String(j.three_liner));
  if(j.content_idea)lines.push(String(j.content_idea));
  if(j.angle)lines.push('Angle: '+String(j.angle));
  if(j.script_outline)lines.push('Outline: '+String(j.script_outline));
  return lines.filter(Boolean).join('\\n');
}

function openIdeaPreview(id){
  var box=document.getElementById('idea-preview');
  var title=document.getElementById('idea-preview-title');
  var body=document.getElementById('idea-preview-body');
  var pre=document.getElementById('idea-preview-json');
  if(!box||!title||!body||!pre)return;
  var row=lastIdeasById && lastIdeasById[id];
  if(!row){box.style.display='none';return;}
  box.style.display='block';
  var t=String(row.title||'').trim()||String(id||'');
  title.textContent=t;
  body.textContent=pickIdeaText(row.raw||row);
  pre.textContent=JSON.stringify(row.raw||row,null,2);
}

bind('btn-close-idea-preview','click',function(){
  var box=document.getElementById('idea-preview');
  if(box)box.style.display='none';
});

function renderIdeasTable(rows,opts){
  if(!rows.length){
    if(opts&&opts.filteredFromTotal){
      return '<div class="empty" style="padding:12px">No ideas match the current filters. Try clearing filters or broadening search.</div>';
    }
    return '<div class="empty" style="padding:12px">No rows in this list.</div>';
  }
  var sel=loadIdeaSelection();
  var checkedAll=true;
  for(var i=0;i<rows.length;i++){
    var id=String(rows[i].id||'');
    if(!id)continue;
    if(!sel[id]){checkedAll=false;break;}
  }
  var tb='<table class="sp-modal-table" style="width:100%;min-width:1500px;table-layout:auto"><thead><tr>'+
    '<th style="width:44px"><input type="checkbox" id="ideas-check-all" '+(checkedAll?'checked':'')+' title="Select/deselect all ideas in this list"/></th>'+
    '<th>Title</th><th>Format</th><th>Platform</th><th>Hook</th><th>3-liner</th><th class="mono">Conf.</th><th class="mono">ID</th></tr></thead><tbody>';
  for(var j=0;j<rows.length;j++){
    var x=rows[j];
    var id2=String(x.id||'');
    var on=!!sel[id2];
    tb+='<tr class="idea-row" data-id="'+esc(id2)+'" style="cursor:pointer;'+(on?'':'opacity:0.65')+'">'+
      '<td><input class="idea-check" type="checkbox" data-id="'+esc(id2)+'" '+(on?'checked':'')+' /></td>'+
      '<td style="max-width:340px;white-space:pre-wrap">'+esc(x.title||id2)+'</td>'+
      '<td class="mono">'+esc(x.format||'')+'</td>'+
      '<td class="mono">'+esc(x.platform||'')+'</td>'+
      '<td style="max-width:300px;white-space:pre-wrap;word-break:break-word">'+esc(x.hook||'')+'</td>'+
      '<td style="max-width:520px;white-space:pre-wrap;word-break:break-word">'+esc(x.three_liner||'')+'</td>'+
      '<td class="mono">'+fmtInsightScore(x.confidence_score)+'</td>'+
      '<td class="mono">'+esc(id2)+'</td>'+
    '</tr>';
  }
  tb+='</tbody></table>';
  return tb;
}

function readFormatLimitsPayload(){
  var map=[['fl-carousel','carousel'],['fl-video','video'],['fl-post','post'],['fl-thread','thread'],['fl-other','other']];
  var o={};
  for(var i=0;i<map.length;i++){
    var el=document.getElementById(map[i][0]);
    if(!el)continue;
    var t=String(el.value||'').trim();
    if(t==='')continue;
    var n=parseInt(t,10);
    if(!Number.isFinite(n))continue;
    o[map[i][1]]=Math.min(200,Math.max(0,n));
  }
  return Object.keys(o).length?o:null;
}

bind('fl-carousel','input',updatePackSummary);
bind('fl-video','input',updatePackSummary);
bind('fl-post','input',updatePackSummary);
bind('fl-thread','input',updatePackSummary);
bind('fl-other','input',updatePackSummary);
async function loadIdeaListDropdowns(){
  var s1=document.getElementById('idea-list-select');
  var s2=document.getElementById('pack-idea-list-select');
  if(!SLUG||!selectedImportId){
    if(s1){s1.innerHTML='<option value="">Select an import first</option>';s1.disabled=true;}
    if(s2){s2.innerHTML='<option value="">-</option>';s2.disabled=true;}
    return;
  }
  if(s1)s1.disabled=false;
  if(s2)s2.disabled=false;
  if(s1)s1.innerHTML='<option value="">Loading...</option>';
  if(s2)s2.innerHTML='<option value="">Loading...</option>';
  try{
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/idea-lists?limit=50&offset=0');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var lists=d.idea_lists||[];
    var body='';
    for(var i=0;i<lists.length;i++){
      var L=lists[i]||{};
      var when=String(L.created_at||'').slice(0,19);
      var title=String(L.title||'Untitled').trim()||'Untitled';
      body+='<option value="'+esc(String(L.id||''))+'">'+esc(when+' | '+title)+'</option>';
    }
    if(s1){
      s1.innerHTML=lists.length?('<option value="">Select a list...</option>'+body):'<option value="">No idea lists yet</option>';
      if(selectedIdeaListId){
        s1.value=selectedIdeaListId;
        if(s1.value!==selectedIdeaListId)selectedIdeaListId='';
      }
      s1.value=selectedIdeaListId;
    }
    if(s2){
      s2.innerHTML=lists.length?('<option value="">-</option>'+body):'<option value="">No idea lists yet</option>';
      s2.value=selectedIdeaListId||'';
    }
  }catch(e){
    if(s1)s1.innerHTML='<option value="">Could not load</option>';
    if(s2)s2.innerHTML='<option value="">Could not load</option>';
  }
}
function loadIdeaListTab(){
  loadIdeaListDropdowns().then(function(){
    loadIdeaListIdeasTable();
    updatePackSummary();
  });
}
async function loadIdeaListIdeasTable(){
  var wrap=document.getElementById('idea-list-table-wrap');
  var meta=document.getElementById('idea-list-list-meta');
  var state=document.getElementById('ideas-state');
  if(!SLUG||!selectedImportId||!wrap)return;
  var listId=selectedIdeaListId;
  if(!listId){
    wrap.innerHTML='';
    if(meta)meta.textContent='';
    if(state)state.textContent='';
    lastIdeasAllRows=null;
    lastIdeasDisplayRows=null;
    updateIdeasFilterSummary(0,0,[]);
    stepState.ideas_present=false;
    renderStepper();
    try{lastIdeasById={};}catch(e){}
    return;
  }
  wrap.innerHTML='Loading...';
  if(meta)meta.textContent='';
  if(state)state.textContent='Loading...';
  try{
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/idea-lists/'+encodeURIComponent(listId)+'/ideas?limit=200&offset=0');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var list=d.idea_list||{};
    var ideas=(d.ideas||[]).map(function(row){
      var j=row.idea_json||{};
      return {
        id:j.id||row.idea_id||'',
        title:j.title||'',
        format:j.format||'',
        platform:j.platform||'',
        hook:j.hook||j.hook_text||'',
        confidence_score:j.confidence_score,
        three_liner:String(j.three_liner||''),
        raw:j
      };
    });
    lastIdeasById={};
    for(var ii=0;ii<ideas.length;ii++){
      var idX=String(ideas[ii].id||'');
      if(idX)lastIdeasById[idX]=ideas[ii];
    }
    if(meta)meta.textContent=JSON.stringify({list_id:list.id,title:list.title,created_at:list.created_at,params_json:list.params_json,derived_globals_json:list.derived_globals_json},null,2);
    lastIdeasAllRows=ideas;
    populateIdeasPlatformFilter(ideas);
    stepState.ideas_present=ideas.length>0;
    renderStepper();
    rerenderIdeasTableFromCache();
  }catch(e){
    wrap.textContent=String(e.message||e);
    if(state)state.textContent='';
  }
}
async function loadPackInspectDropdown(){
  var sel=document.getElementById('pack-inspect-select');
  var msg=document.getElementById('pack-inspect-msg');
  if(!sel||!SLUG)return;
  var prev=(sel.value||'').trim();
  sel.innerHTML='<option value="">Loading...</option>';
  if(msg&&currentStep!=='pack'){msg.textContent='';msg.style.color='';}
  try{
    var r=await cafFetch('/v1/admin/signal-packs?project='+encodeURIComponent(SLUG)+'&limit=120&offset=0');
    var d=await r.json().catch(function(){return {};});
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var rows=d.rows||[];
    if(!rows.length){
      sel.innerHTML='<option value="">No signal packs for this project yet</option>';
      if(msg&&currentStep==='pack')msg.textContent='Build one in this step (Build signal pack).';
      return;
    }
    var h='<option value="">Select a signal pack...</option>';
    for(var i=0;i<rows.length;i++){
      var p=rows[i]||{};
      var when=String(p.created_at||'').slice(0,19);
      var fn=p.upload_filename||p.run_id||p.id;
      var ideasN=Number(p.ideas_count||0);
      h+='<option value="'+esc(String(p.id||''))+'">'+esc(when+' | '+String(fn||'')+' ('+ideasN+' ideas)')+'</option>';
    }
    sel.innerHTML=h;
    if(prev&&sel.querySelector('option[value="'+prev.replace(/"/g,'')+'"]'))sel.value=prev;
    else if(stepState.pack_id&&sel.querySelector('option[value="'+String(stepState.pack_id).replace(/"/g,'')+'"]'))sel.value=stepState.pack_id;
    if(sel.value)loadSelectedSignalPack();
  }catch(e){
    sel.innerHTML='<option value="">Could not load signal packs</option>';
    if(msg&&currentStep==='pack'){msg.textContent=String(e.message||e);msg.style.color='var(--red)';}
  }
}

function getPackInspectSelectId(){
  var sel=document.getElementById('pack-inspect-select');
  return sel?String(sel.value||'').trim():'';
}

async function loadSelectedSignalPack(){
  var sel=document.getElementById('pack-inspect-select');
  var msg=document.getElementById('pack-inspect-msg');
  var ideasD=document.getElementById('pack-inspect-ideas-details');
  var rawD=document.getElementById('pack-inspect-raw-details');
  var ideasWrap=document.getElementById('pack-inspect-ideas');
  var rawPre=document.getElementById('pack-inspect-raw');
  if(!sel||!SLUG)return;
  var id=(sel.value||'').trim();
  if(!id){
    if(ideasD)ideasD.style.display='none';
    if(rawD)rawD.style.display='none';
    if(msg){msg.textContent='';msg.style.color='';}
    return;
  }
  if(msg){msg.textContent='Loading pack...';msg.style.color='';}
  if(ideasWrap)ideasWrap.innerHTML='Loading...';
  if(rawPre)rawPre.textContent='Loading...';
  try{
    var r=await cafFetch('/v1/admin/signal-pack?project='+encodeURIComponent(SLUG)+'&id='+encodeURIComponent(id));
    var d=await r.json().catch(function(){return {};});
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var pack=d.signal_pack||{};
    var ideas=Array.isArray(pack.ideas_json)?pack.ideas_json:[];
    if(msg)msg.textContent='Pack loaded — '+String(ideas.length)+' ideas in ideas_json.';
    if(ideasD)ideasD.style.display='block';
    if(rawD)rawD.style.display='block';
    if(ideasWrap)ideasWrap.innerHTML=renderInsightTable(ideas.slice(0,120),[
      {key:'idea_id',label:'idea_id'},
      {key:'title',label:'title'},
      {key:'platform',label:'platform'},
      {key:'hook',label:'hook'}
    ]);
    if(rawPre)rawPre.textContent=JSON.stringify({
      id: pack.id,
      run_id: pack.run_id,
      created_at: pack.created_at,
      upload_filename: pack.upload_filename,
      source_window: pack.source_window,
      source_inputs_import_id: (pack.source_inputs_import_id!=null?pack.source_inputs_import_id:null),
      ideas_count: ideas.length,
      ideas_json: ideas,
      derived_globals_json: (pack.derived_globals_json!=null?pack.derived_globals_json:{}),
      notes: (pack.notes!=null?pack.notes:null)
    },null,2);
    stepState.pack_id=id;
    stepState.pack_created_at=String(pack.created_at||'');
    renderStepper();
    syncRunPanel();
  }catch(e){
    if(msg){msg.textContent=String(e.message||e);msg.style.color='var(--red)';}
    if(ideasD)ideasD.style.display='none';
    if(rawD)rawD.style.display='none';
  }
}

var lastBroadRunDebug=null;
function setBroadRunDebug(obj){
  lastBroadRunDebug=obj||null;
  var btn=document.getElementById('btn-copy-broad-debug');
  var det=document.getElementById('broad-debug-details');
  var pre=document.getElementById('broad-debug-pre');
  if(btn)btn.style.display=lastBroadRunDebug?'inline-flex':'none';
  if(det)det.style.display=lastBroadRunDebug?'block':'none';
  if(pre)pre.textContent=lastBroadRunDebug?JSON.stringify(lastBroadRunDebug,null,2):'';
}

bind('btn-copy-broad-debug','click',async function(){
  if(!lastBroadRunDebug)return;
  var text=JSON.stringify(lastBroadRunDebug,null,2);
  try{
    await navigator.clipboard.writeText(text);
  }catch(e){
    try{
      var ta=document.createElement('textarea');
      ta.value=text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }catch(e2){}
  }
});

async function showBroadEvidenceRow(rowId){
  var box=document.getElementById('broad-evidence-viewer');
  var pre=document.getElementById('broad-evidence-pre');
  var title=document.getElementById('broad-evidence-title');
  if(!box||!pre||!title)return;
  if(!SLUG||!selectedImportId)throw new Error('Select an import first.');
  box.style.display='block';
  title.textContent='Evidence row '+String(rowId||'');
  pre.textContent='Loading...';
  var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/evidence-row/'+encodeURIComponent(rowId));
  var d=await r.json().catch(function(){return {};});
  if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
  var row=d.row||{};
  pre.textContent=JSON.stringify({
    id: row.id,
    evidence_kind: row.evidence_kind,
    evidence_display_kind: row.evidence_display_kind || null,
    evidence_post_url: row.evidence_post_url || null,
    sheet_name: row.sheet_name,
    row_index: row.row_index,
    dedupe_key: row.dedupe_key,
    payload_json: row.payload_json,
    rating_score: row.rating_score,
    rating_rationale: row.rating_rationale,
    rated_at: row.rated_at
  },null,2);
}

bind('btn-close-broad-evidence','click',function(){
  var box=document.getElementById('broad-evidence-viewer');
  if(box)box.style.display='none';
});

async function loadDeepInsightTable(elId,tier,tabKey){
  var el=document.getElementById(elId);
  if(!SLUG||!selectedImportId||!el)return;
  el.innerHTML='<div class="empty" style="padding:12px">Loading…</div>';
  try{
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/evidence-insights?tier='+encodeURIComponent(tier)+'&limit=200&offset=0&sort=rating_desc');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var rows=d.insights||[];
    if(tabKey)tpSetTabCount(tabKey,rows.length);
    el.innerHTML=rows.length?renderInsightTable(rows,TOP_PERFORMER_INSIGHT_TABLE_COLS,{
      tableClass:'insights-data-table',
      minWidth:3400,
      emptyMsg:'No top-performer rows for this pass yet.'
    }):'<div class="empty" style="padding:12px">No rows yet — run the pass on the left.</div>';
  }catch(e){
    if(tabKey)tpSetTabCount(tabKey,'!');
    el.innerHTML='<div class="empty" style="padding:12px;color:var(--red)">'+esc(String(e.message||e))+'</div>';
  }
}
async function loadDeepImageTable(){
  return loadDeepInsightTable('deep-image-table','top_performer_deep','image');
}
async function loadDeepVideoTable(){
  return loadDeepInsightTable('deep-video-table','top_performer_video','video');
}
async function loadDeepCarouselTable(){
  return loadDeepInsightTable('deep-carousel-table','top_performer_carousel','carousel');
}
bind('btn-reload-deep-image','click',loadDeepImageTable);
bind('btn-reload-deep-carousel','click',loadDeepCarouselTable);
bind('btn-reload-deep-video','click',loadDeepVideoTable);
document.querySelectorAll('.tp-tab').forEach(function(btn){
  btn.addEventListener('click',function(){
    tpSelectTab(btn.getAttribute('data-tp-tab')||'image');
  });
});

async function copyDeepInsightsJson(tier,labelShort){
  if(!SLUG||!selectedImportId){
    window.alert('Select a project and import first.');
    return;
  }
  try{
    var url='/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/evidence-insights?tier='+encodeURIComponent(tier)+'&limit=200&offset=0&sort=rating_desc';
    var r=await cafFetch(url);
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var rows=d.insights||[];
    var text=JSON.stringify(rows,null,2);
    var ok=await adminCopyTextToClipboard(text);
    if(ok){
      try{pushProcessingActivity(cafTs()+' Copied '+String(rows.length)+' '+labelShort+' insight row(s) as JSON.',false);}catch(_){}
    }else{
      window.alert('Clipboard not available in this browser context.');
    }
  }catch(e){window.alert(String(e.message||e));}
}
bind('btn-copy-deep-image-json','click',function(){copyDeepInsightsJson('top_performer_deep','image');});
bind('btn-copy-deep-carousel-json','click',function(){copyDeepInsightsJson('top_performer_carousel','carousel');});
bind('btn-copy-deep-video-json','click',function(){copyDeepInsightsJson('top_performer_video','video');});

bind('idea-list-select','change',function(){
  var s=document.getElementById('idea-list-select');
  selectedIdeaListId=(s&&s.value)?s.value.trim():'';
  var s2=document.getElementById('pack-idea-list-select');
  if(s2)s2.value=selectedIdeaListId;
  loadIdeaListIdeasTable();
});
bind('pack-idea-list-select','change',function(){
  var s=document.getElementById('pack-idea-list-select');
  selectedIdeaListId=(s&&s.value)?s.value.trim():'';
  var s1=document.getElementById('idea-list-select');
  if(s1)s1.value=selectedIdeaListId;
});
bind('btn-reload-idea-lists','click',function(){
  loadIdeaListTab();
});
bind('ideas-filter-search','input',scheduleIdeasFilterRerender);
bind('ideas-filter-format','change',rerenderIdeasTableFromCache);
bind('ideas-filter-platform','change',rerenderIdeasTableFromCache);
bind('ideas-filter-selected','change',rerenderIdeasTableFromCache);
bind('ideas-sort','change',rerenderIdeasTableFromCache);
bind('btn-ideas-clear-filters','click',function(){
  var s=document.getElementById('ideas-filter-search');
  var f=document.getElementById('ideas-filter-format');
  var p=document.getElementById('ideas-filter-platform');
  var sel=document.getElementById('ideas-filter-selected');
  var sort=document.getElementById('ideas-sort');
  if(s)s.value='';
  if(f)f.value='';
  if(p)p.value='';
  if(sel)sel.checked=false;
  if(sort)sort.value='confidence_desc';
  rerenderIdeasTableFromCache();
});
bind('btn-copy-ideas-tsv','click',function(){adminCopyTableFromWrap('idea-list-table-wrap');});
bind('btn-copy-ideas-json','click',async function(){
  if(!lastIdeasDisplayRows||!lastIdeasDisplayRows.length){
    window.alert('Load an idea list and ensure rows are visible (check filters).');
    return;
  }
  var payload=lastIdeasDisplayRows.map(function(x){return x.raw||x;});
  await adminCopyTextToClipboard(JSON.stringify(payload,null,2));
});
bind('btn-generate-idea-list','click',async function(){
  var msg=document.getElementById('idea-list-generate-msg');
  if(!SLUG||!selectedImportId){
    if(msg)msg.textContent='Select an import first.';
    return;
  }
  if(msg){msg.textContent='Working (LLM)...';msg.style.color='';}
  try{
    var titleEl=document.getElementById('idea-list-title');
    var tgtEl=document.getElementById('idea-list-target');
    var title=titleEl&&titleEl.value?String(titleEl.value).trim():'';
    var tRaw=tgtEl?parseInt(tgtEl.value,10):35;
    var target=Number.isFinite(tRaw)?Math.min(200,Math.max(1,tRaw)):35;
    var body={target_idea_count:target};
    if(title)body.title=title;
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/build-ideas-list',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    if(msg)msg.textContent='Done. '+d.ideas_count+' ideas stored.';
    if(d.idea_list_id)selectedIdeaListId=d.idea_list_id;
    loadIdeaListTab();
    refreshInsightCounts();
  }catch(e){
    if(msg){msg.textContent=String(e.message||e);msg.style.color='var(--red)';}
  }
});
bind('btn-build-pack-from-idea-list','click',async function(){
  var msg=document.getElementById('build-from-ideas-msg');
  if(!SLUG||!selectedImportId){
    if(msg)msg.textContent='Select an import first.';
    return;
  }
  var s=document.getElementById('pack-idea-list-select');
  var lid=(s&&s.value)?s.value.trim():'';
  if(!lid)lid=selectedIdeaListId;
  if(!lid){
    if(msg)msg.textContent='Select an idea list, or create one in the Ideas tab.';
    return;
  }
  if(msg){msg.textContent='Building pack...';msg.style.color='';}
  try{
    var sel=loadIdeaSelection();
    var selectedN=Object.keys(sel||{}).length;
    if(selectedN>0){
      var ok=confirm('You have '+String(selectedN)+' ideas selected in the Ideas step. Build signal pack uses the full idea list in the backend (selection is UI-only). Continue?');
      if(!ok){if(msg)msg.textContent='Cancelled.';return;}
    }
    var fl=readFormatLimitsPayload();
    var body={idea_list_id:lid};
    if(fl)body.format_limits=fl;
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/build-signal-pack',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var raw=await r.text();
    var d;try{d=JSON.parse(raw);}catch{throw new Error(raw.slice(0,400));}
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    if(msg)msg.innerHTML='Done. <a class="btn-ghost btn-sm" href="/admin/signal-pack?project='+encodeURIComponent(SLUG)+'&id='+encodeURIComponent(d.signal_pack_id)+'">open pack</a> | ideas in pack: '+esc(String(d.ideas_count||0))+'.';
    stepState.pack_id=String(d.signal_pack_id||'');
    stepState.pack_created_at=String(d.created_at||'');
    renderStepper();
    syncRunPanel();
    loadPackInspectDropdown();
  }catch(e){
    if(msg){msg.textContent=String(e.message||e);msg.style.color='var(--red)';}
  }
});

bind('btn-build-pack','click',async function(){
  var msg=document.getElementById('build-msg');
  if(!SLUG||!selectedImportId){msg.textContent='Select an import first.';return;}
  var ok=confirm('This runs the full pipeline (rating + synthesis + ideas LLM) and writes a new signal pack. Continue?');
  if(!ok){msg.textContent='Cancelled.';return;}
  msg.textContent='Working (OpenAI)...';
  try{
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/build-signal-pack',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    var raw=await r.text();
    var d;try{d=JSON.parse(raw);}catch{throw new Error(raw.slice(0,400));}
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    msg.innerHTML='Done. Signal pack <a class="btn-ghost btn-sm" href="/admin/signal-pack?project='+encodeURIComponent(SLUG)+'&id='+encodeURIComponent(d.signal_pack_id)+'">open</a> | insights pack <span class="mono">'+esc(d.insights_pack_id||'')+'</span> | ideas_json '+esc(String(d.ideas_count||0))+' (LLM context '+esc(String(d.ideas_llm_context_insights||0))+' insights, '+esc(String(d.ideas_llm_top_performer_rows_in_context||0))+' w/ top-performer) | rated '+d.rows_rated+'/'+d.rows_considered_for_rating+' rows.';
    stepState.pack_id=String(d.signal_pack_id||'');
    stepState.pack_created_at=String(d.created_at||'');
    renderStepper();
    syncRunPanel();
    loadPackInspectDropdown();
  }catch(e){msg.textContent=String(e);msg.style.color='var(--red)';}
});

function renderPackSettings(){
  var pre=document.getElementById('pack-settings');
  if(!pre)return;
  var c=(profileCache&&profileCache.profile)?profileCache.profile:{};
  pre.textContent=JSON.stringify({
    rating_model:c.rating_model||'',
    synth_model:c.synth_model||'',
    max_rows_for_rating:c.max_rows_for_rating,
    max_rows_per_llm_batch:c.max_rows_per_llm_batch,
    min_llm_score_for_pack:c.min_llm_score_for_pack,
    max_ideas_in_signal_pack:c.max_ideas_in_signal_pack,
    max_insights_for_ideas_llm:c.max_insights_for_ideas_llm,
    min_top_performer_insights_for_ideas_llm:c.min_top_performer_insights_for_ideas_llm
  },null,2);
}

function updatePackSummary(){
  var el=document.getElementById('pack-summary');
  if(!el)return;
  if(!selectedIdeaListId){
    el.textContent='Pick an idea list to build from.';
    return;
  }
  var sel=loadIdeaSelection();
  var selectedN=Object.keys(sel||{}).length;
  var fl=readFormatLimitsPayload();
  var caps=fl?JSON.stringify(fl):'none';
  el.textContent='Selected ideas (UI): '+String(selectedN||0)+' | Per-format caps: '+caps;
}

async function initSourcesPanel(){
  if(!SLUG||!selectedImportId)return;
  var bar=document.getElementById('sources-kind-bar');
  var meta=document.getElementById('sources-meta');
  var wrap=document.getElementById('sources-table-wrap');
  if(!bar||!meta||!wrap)return;
  bar.innerHTML='Loading...';
  try{
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/stats');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var bk=d.stats&&d.stats.by_kind||{};
    var kinds=Object.keys(bk).filter(function(k){return (bk[k]||0)>0 && (k==='source_registry'||k==='scraped_page');}).sort();
    if(kinds.length===0){bar.innerHTML='<span class="empty">No source rows in this import.</span>';meta.textContent='';wrap.innerHTML='';return;}
    var cur=kinds[0];
    var h='';
    for(var i=0;i<kinds.length;i++){
      var k=kinds[i];
      h+='<button type="button" class="'+(k===cur?'btn btn-sm':'btn-ghost btn-sm')+' src-kind" data-kind="'+esc(k)+'">'+esc((k==='source_registry'?'Registry':'Web page'))+'</button>';
    }
    bar.innerHTML=h;
    bar.querySelectorAll('.src-kind').forEach(function(btn){
      btn.addEventListener('click',function(){
        var k=btn.getAttribute('data-kind')||'';
        loadSourcesEvidence(k);
      });
    });
    loadSourcesEvidence(cur);
  }catch(e){
    bar.innerHTML='<span style="color:var(--red)">'+esc(e.message||e)+'</span>';
  }
}

async function loadSourcesEvidence(kind){
  var meta=document.getElementById('sources-meta');
  var wrap=document.getElementById('sources-table-wrap');
  if(!meta||!wrap||!kind)return;
  meta.textContent='Loading...';
  wrap.innerHTML='';
  try{
    var minScore=prellmMinByKind[kind]||0;
    var q='evidence_kind='+encodeURIComponent(kind)+'&min_score='+encodeURIComponent(String(minScore))+'&include_below_cutoff=1&sort=score_desc&limit=120&offset=0';
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/pre-llm-evidence?'+q);
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    meta.textContent=JSON.stringify({kind:kind,label:kindLabel(kind,'evidence'),counts:d.totals},null,2);
    var rows=d.rows||[];
    if(rows.length===0){wrap.innerHTML='<div class="empty" style="padding:12px">No rows.</div>';return;}
    var tb='<table class="sp-modal-table"><thead><tr><th>Score</th><th>Included</th><th>URL</th><th>Caption</th><th>Hashtags</th></tr></thead><tbody>';
    for(var i=0;i<rows.length;i++){
      var x=rows[i];
      var inc=!!x.included_by_cutoff;
      var urlCell=x.url?('<a href="'+esc(x.url)+'" target="_blank" rel="noopener">'+esc(x.url.slice(0,140))+'</a>'):'<span style="color:var(--muted)">-</span>';
      tb+='<tr style="'+(inc?'':'opacity:0.55')+'">'+
        '<td class="mono">'+esc(String(x.pre_llm_score))+'</td>'+
        '<td class="mono" style="color:'+(inc?'var(--green)':'var(--muted)')+'">'+(inc?'yes':'no')+'</td>'+
        '<td style="max-width:200px;word-break:break-all">'+urlCell+'</td>'+
        '<td style="max-width:360px;white-space:pre-wrap;word-break:break-word">'+esc(x.caption||'')+'</td>'+
        '<td style="max-width:200px;word-break:break-word">'+esc(x.hashtags||'')+'</td></tr>';
    }
    tb+='</tbody></table>';
    wrap.innerHTML=tb;
  }catch(e){meta.textContent=String(e);}
}

try{
  readImportFromUrl();
  var hashStep=(location.hash||'').replace(/^#/,'').trim();
  var hashOk=['insights','ideas','pack','run','evidence','select'].indexOf(hashStep)>=0;
  setStep(hashOk?hashStep:(selectedImportId?'evidence':'select'));
  if(SLUG){
    loadImports();
    bindCafTerms(document.getElementById('import-workbench')||document);
  }else{
    var root0=document.getElementById('imports-root');
    var hint0=document.getElementById('imports-hint');
    if(root0){
      root0.innerHTML='<div class="empty">Pick a project in the sidebar, or open <span class="mono">/admin/processing?project=YOUR_SLUG</span>. Imports cannot load until a project is selected.</div>';
    }
    if(hint0)hint0.textContent='';
  }
}catch(bootErr){
  try{pushProcessingActivity(cafTs()+' Page startup failed: '+String(bootErr&&bootErr.message||bootErr),true);}catch(_q){}
  var rootBoot=document.getElementById('imports-root');
  if(rootBoot){
    rootBoot.innerHTML='<div class="empty" style="color:var(--red)">'+esc(String(bootErr&&bootErr.message||bootErr))+'</div>'+
      '<p style="margin:10px 0 0;font-size:12px;color:var(--muted)">Check <strong>Activity</strong> above (or browser console). A tiny boot script should have shown <strong>Boot OK</strong> before this.</p>';
  }
}
</script>`;
}
