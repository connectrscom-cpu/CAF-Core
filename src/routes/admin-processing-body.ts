/** Inner HTML + script for GET /admin/processing — imports, evidence by platform, insights, top-performer passes, profile. */

export function adminProcessingBody(currentSlug: string): string {
  const SLUG = JSON.stringify(currentSlug);
  const inputsPq = currentSlug ? `?project=${encodeURIComponent(currentSlug)}` : "";
  return `
<div class="ph"><div><h2>Processing</h2><span class="ph-sub">Inputs → Evidence → Insights → Ideas → Signal pack → Run</span></div></div>
<div class="content">
  <div class="card" style="margin-bottom:14px">
    <div style="padding:12px 16px 8px">
      <p class="runs-ops-hint">Work through the pipeline steps below. Raw JSON is hidden under Debug panels.</p>
      <div id="imports-toolbar" style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button type="button" class="btn btn-sm" id="btn-reload-imports">Reload imports</button>
        <a class="btn-ghost btn-sm" href="/admin/inputs${inputsPq}">Upload on Inputs</a>
        <button type="button" class="btn-ghost btn-sm" id="btn-open-profile" title="Edit processing profile caps/models and view audit logs.">Profile &amp; audit</button>
        <span id="imports-hint" style="font-size:12px;color:var(--muted)"></span>
      </div>
      <div id="imports-root" class="empty">Loading…</div>
      <div id="import-workbench" style="display:none;margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
        <div id="stepper" style="display:flex;gap:8px;border-bottom:1px solid var(--border);padding:0 0 10px;flex-wrap:wrap;align-items:center">
          <button type="button" class="btn btn-sm step-btn" id="step-select" data-step="select" title="Pick the evidence import you want to process.">
            1. Select import <span class="badge badge-y" id="step-badge-select">in progress</span>
          </button>
          <button type="button" class="btn-ghost btn-sm step-btn" id="step-evidence" data-step="evidence" title="Filter evidence using profile gates + cutoff (no LLM).">
            2. Filter evidence <span class="badge badge-b" id="step-badge-evidence">not started</span>
          </button>
          <button type="button" class="btn-ghost btn-sm step-btn" id="step-insights" data-step="insights" title="Run broad insights and top-performer extraction.">
            3. Generate insights <span class="badge badge-b" id="step-badge-insights">not started</span>
          </button>
          <button type="button" class="btn-ghost btn-sm step-btn" id="step-ideas" data-step="ideas" title="Generate and curate ideas from insights.">
            4. Extract ideas <span class="badge badge-b" id="step-badge-ideas">not started</span>
          </button>
          <button type="button" class="btn-ghost btn-sm step-btn" id="step-pack" data-step="pack" title="Build a signal pack from an idea list or full import pipeline.">
            5. Build signal pack <span class="badge badge-b" id="step-badge-pack">not started</span>
          </button>
          <button type="button" class="btn-ghost btn-sm step-btn" id="step-run" data-step="run" title="Proceed to Runs using the latest signal pack.">
            6. Run <span class="badge badge-b" id="step-badge-run">not started</span>
          </button>
        </div>
        <div id="panel-evidence" style="padding:12px 0 0">
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start;margin-bottom:12px">
            <div style="flex:1;min-width:280px">
              <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between">
                <div>
                  <div style="font-size:12px;color:var(--muted);margin-bottom:2px">Selected import</div>
                  <div style="font-size:13px;font-weight:600" id="evidence-import-label">—</div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                  <button type="button" class="btn-ghost btn-sm" id="btn-refresh-evidence" title="Reload import stats + evidence preview from the database (no LLM).">Refresh</button>
                </div>
              </div>
              <div style="margin-top:10px;border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--bg)">
                <div style="font-size:12px;font-weight:600;margin-bottom:8px">Evidence funnel</div>
                <div id="evidence-funnel" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"></div>
                <div id="evidence-funnel-hint" style="margin-top:6px;font-size:11px;color:var(--muted)"></div>
              </div>
            </div>
            <div style="flex:1;min-width:320px">
              <details id="import-stats-debug" style="margin:0">
                <summary style="cursor:pointer;font-size:12px;color:var(--muted)">Debug (import stats JSON)</summary>
                <pre id="import-stats" style="font-size:11px;background:var(--bg);padding:10px;border-radius:8px;overflow:auto;max-height:260px;margin-top:8px;white-space:pre-wrap"></pre>
              </details>
            </div>
          </div>
          <div id="prellm-root">
            <div id="prellm-kind-bar" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px"></div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start;margin-bottom:10px">
              <div style="flex:1;min-width:280px">
                <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                  <label style="font-size:13px">Cutoff for this platform <span id="prellm-min-val" class="mono">0.00</span></label>
                  <input type="range" id="prellm-min-score" min="0" max="1" step="0.01" value="0" style="width:min(420px,100%)" />
                <input id="prellm-min-score-num" type="number" min="0" max="1" step="0.01" value="0" style="width:92px;font-size:12px" title="Set cutoff value (0–1)" />
                </div>
                <div style="margin-top:6px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
                  <label style="font-size:12px;color:var(--muted);display:flex;gap:6px;align-items:center">
                    <input type="checkbox" id="prellm-show-below" /> Show rows below cutoff (still passing profile min)
                  </label>
                  <label style="font-size:12px;color:var(--muted);display:flex;gap:6px;align-items:center">
                    Sort
                    <select id="prellm-sort" style="font-size:12px">
                      <option value="score_desc">Score ↓</option>
                      <option value="score_asc">Score ↑</option>
                    </select>
                  </label>
                </div>
              </div>
              <div style="flex:1;min-width:320px;border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--bg)">
                <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:6px">
                  <strong style="font-size:12px">Formula for this platform</strong>
                  <button type="button" class="btn-ghost btn-sm" id="prellm-save-formula">Save formula</button>
                </div>
                <div id="prellm-formula-hint" style="font-size:11px;color:var(--muted);margin-bottom:8px">
                  Score is a weighted average of normalized features (0–1). Change weights/min score per platform.
                </div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
                  <label style="font-size:12px">Profile min score <input id="prellm-profile-min" type="number" min="0" max="1" step="0.01" style="width:92px;font-size:12px" /></label>
                  <label style="font-size:12px">Min primary text chars <input id="prellm-min-text" type="number" min="0" max="5000" step="1" style="width:92px;font-size:12px" /></label>
                </div>
                <div id="prellm-weights-wrap" style="max-height:220px;overflow:auto;border:1px solid var(--border);border-radius:8px"></div>
                <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                  <button type="button" class="btn-ghost btn-sm" id="prellm-add-weight">Add feature</button>
                  <span id="prellm-save-msg" style="font-size:11px;color:var(--muted)"></span>
                </div>
                <div style="margin-top:8px;font-size:11px;color:var(--muted)">
                  <span class="mono">text_signal</span> is a text-length signal (normalized 0–1) derived from title/body/caption fields. It helps favor rows with enough context for analysis.
                </div>
              </div>
            </div>
            <details id="prellm-debug" style="margin:10px 0">
              <summary style="cursor:pointer;font-size:12px;color:var(--muted)">Debug (pre-LLM preview JSON)</summary>
              <pre id="prellm-counts" style="font-size:12px;background:var(--bg);padding:10px;border-radius:8px;margin-top:8px;white-space:pre-wrap;max-height:260px;overflow:auto"></pre>
            </details>
            <div id="prellm-table-wrap" style="font-size:12px;max-height:480px;overflow:auto;border:1px solid var(--border);border-radius:8px"></div>
          </div>
        </div>
        <div id="panel-broad" style="display:none;padding:12px 0 0">
          <p class="runs-ops-hint" style="margin-bottom:10px">Broad insights are text-only LLM analysis (<span class="mono">broad_llm</span>) per <strong>social platform</strong> evidence row. Source kinds (<span class="mono">source_registry</span>, <span class="mono">scraped_page</span>) stay under <strong>Sources</strong> — they are not run here.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
            <button type="button" class="btn btn-sm" id="btn-run-broad-insights-all" title="Analyzes filtered evidence across all platform tabs, writing broad insights rows to the database. May overwrite if Rescan is enabled.">Analyze all selected evidence</button>
            <button type="button" class="btn-ghost btn-sm" id="btn-run-broad-insights" title="Analyzes the currently selected platform tab only, writing broad insights rows to the database. May overwrite if Rescan is enabled.">Analyze this platform only</button>
            <button type="button" class="btn-ghost btn-sm" id="btn-toggle-broad-prompt">Prompt & labels</button>
            <label style="font-size:12px;color:var(--muted)">Max rows <input id="broad-max-rows" type="number" min="1" max="5000" value="800" style="width:92px;font-size:12px" /></label>
            <label style="font-size:12px;color:var(--muted);display:flex;gap:6px;align-items:center"><input id="broad-rescan" type="checkbox" /> Rescan (ignore existing)</label>
            <label style="font-size:12px;color:var(--muted);display:flex;gap:6px;align-items:center"><input id="broad-use-cutoff" type="checkbox" checked /> Use cutoff</label>
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
          <div id="broad-table-wrap" style="font-size:12px;width:100%;max-height:520px;overflow-x:auto;overflow-y:auto;border:1px solid var(--border);border-radius:8px"></div>
        </div>
        <div id="panel-top" style="display:none;padding:12px 0 0">
          <p class="runs-ops-hint" style="margin-bottom:10px"><strong>Top performers</strong> — single image (<span class="mono">top_performer_deep</span>), carousel deck (<span class="mono">top_performer_carousel</span>, ≥2 <span class="mono">carousel_slide_urls</span>), video frames (<span class="mono">top_performer_video</span>). Tune caps in <span class="mono">criteria_json.top_performer</span> and <span class="mono">inputs_insights</span>.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
            <button type="button" class="btn btn-sm" id="btn-run-deep-image-insights">Run top-performer (images)</button>
            <button type="button" class="btn btn-sm" id="btn-run-deep-carousel-insights">Run top-performer (carousel)</button>
            <button type="button" class="btn btn-sm" id="btn-run-deep-video-insights">Run top-performer (video frames)</button>
            <span id="top-insight-msg" style="font-size:12px;color:var(--muted);max-width:560px"></span>
          </div>
          <h4 style="font-size:13px;margin:16px 0 8px">Image deep rows</h4>
          <button type="button" class="btn-ghost btn-sm" id="btn-reload-deep-image">Reload</button>
          <div id="deep-image-table" style="margin-top:8px;font-size:12px;width:100%;max-height:360px;overflow-x:auto;overflow-y:auto;border:1px solid var(--border);border-radius:8px"></div>
          <h4 style="font-size:13px;margin:16px 0 8px">Carousel deck rows</h4>
          <button type="button" class="btn-ghost btn-sm" id="btn-reload-deep-carousel">Reload</button>
          <div id="deep-carousel-table" style="margin-top:8px;font-size:12px;width:100%;max-height:360px;overflow-x:auto;overflow-y:auto;border:1px solid var(--border);border-radius:8px"></div>
          <h4 style="font-size:13px;margin:16px 0 8px">Video frame rows</h4>
          <button type="button" class="btn-ghost btn-sm" id="btn-reload-deep-video">Reload</button>
          <div id="deep-video-table" style="margin-top:8px;font-size:12px;width:100%;max-height:360px;overflow-x:auto;overflow-y:auto;border:1px solid var(--border);border-radius:8px"></div>
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
          <p class="runs-ops-hint" style="margin-bottom:10px">Generate a curated idea list from your insights (broad + top-performer context per profile), then review rows here. Use the <strong>Signal pack</strong> tab to build a pack from a selected list, with optional caps per <span class="mono">format</span> (carousel, video, post, etc.).</p>
          <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:12px">
            <div class="form-group" style="margin:0;min-width:200px;flex:1;max-width:360px">
              <label style="font-size:12px">List title (optional)</label>
              <input type="text" id="idea-list-title" style="width:100%;font-size:12px;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" placeholder="e.g. Jan sprint" maxlength="200"/>
            </div>
            <div class="form-group" style="margin:0;width:120px">
              <label style="font-size:12px">Target # ideas</label>
              <input type="number" id="idea-list-target" min="1" max="200" value="35" style="width:100%;font-size:12px;padding:6px 8px;border-radius:8px;border:1px solid var(--border)"/>
            </div>
            <button type="button" class="btn btn-sm" id="btn-generate-idea-list">Generate idea list (LLM)</button>
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
          <p class="runs-ops-hint" style="margin-bottom:10px">Prefer building from an <strong>idea list</strong> you created in the Ideas tab, then add per-format limits if needed. Or run the full import pipeline (rating + synthesis) when you do not have a list yet.</p>
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
            <p style="font-size:11px;color:var(--muted);margin:0 0 6px;max-width:800px">Max per format: leave <strong>blank</strong> for no cap in that bucket, <strong>0</strong> to exclude, or a number to take the top N by confidence within that format (blog, memo, slides, … use <span class="mono">Other</span>).</p>
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
            <button type="button" class="btn-ghost btn-sm" id="btn-build-pack" title="Runs rating + synthesis directly from the evidence import (ignores idea lists). Writes a new signal pack row in the database.">Build signal pack (full import)</button>
            <span id="build-msg" style="font-size:12px;color:var(--muted)"></span>
          </div>
          <details id="pack-settings-debug" style="margin:10px 0">
            <summary style="cursor:pointer;font-size:12px;color:var(--muted)">Debug (config/profile JSON)</summary>
            <pre id="pack-settings" style="font-size:12px;background:var(--bg);padding:10px;border-radius:8px;white-space:pre-wrap;max-height:320px;overflow:auto;margin-top:8px"></pre>
          </details>
          <div class="card" style="margin-top:12px">
            <div class="card-h">Inspect an existing signal pack</div>
            <div style="padding:12px 16px 16px">
              <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
                <select id="pack-inspect-select" style="min-width:320px;max-width:100%;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
                  <option value="">Loading…</option>
                </select>
                <button type="button" class="btn-ghost btn-sm" id="btn-pack-inspect-reload">Reload list</button>
              </div>
              <div id="pack-inspect-msg" style="margin-top:8px;font-size:12px;color:var(--muted)"></div>
              <details id="pack-inspect-ideas-details" style="display:none;margin-top:10px">
                <summary style="cursor:pointer;font-size:12px;color:var(--muted)">ideas_json (curated ideas)</summary>
                <div id="pack-inspect-ideas" style="margin-top:8px;font-size:12px;max-height:360px;overflow:auto;border:1px solid var(--border);border-radius:8px"></div>
              </details>
              <details id="pack-inspect-overall-details" style="display:none;margin-top:10px">
                <summary style="cursor:pointer;font-size:12px;color:var(--muted)">overall_candidates_json (legacy planner rows)</summary>
                <div id="pack-inspect-overall" style="margin-top:8px;font-size:12px;max-height:360px;overflow:auto;border:1px solid var(--border);border-radius:8px"></div>
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
                Use the latest signal pack you built to proceed to runs. This step keeps system internals hidden; open Debug only if needed.
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
const SLUG=${SLUG};
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function apiErr(d,fallback){return (d&&d.message)||(d&&d.error)||fallback;}
/** Format numeric scores from insights API (often string); em dash when missing */
function fmtInsightScore(v){
  if(v===null||v===undefined||v==='')return '—';
  var n=(typeof v==='number')?v:parseFloat(String(v));
  if(Number.isNaN(n))return esc(String(v));
  return esc(String(Math.round(n*10000)/10000));
}
let selectedImportId='';
var selectedImportLabel='';
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
    '<span class="badge badge-b">TOTAL '+esc(fmtN(total))+'</span>'+
    '<span style="color:var(--muted)">→</span>'+
    '<span class="badge badge-p">PROFILE '+esc(fmtN(passing))+'</span>'+
    '<span style="color:var(--muted)">→</span>'+
    '<span class="badge '+(after>0?'badge-g':'badge-y')+'">CUTOFF '+esc(fmtN(after))+'</span>'+
    '<span style="color:var(--muted)">→</span>'+
    '<span class="badge '+(after>0?'badge-g':'badge-y')+'">FINAL '+esc(fmtN(after))+'</span>';
  hint.textContent='Sparse text dropped: '+fmtN(sparseDrop)+' · Below profile min dropped: '+fmtN(belowDrop);
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
  var el=document.getElementById('evidence-import-label');
  if(!el)return;
  if(!selectedImportId){el.textContent='—';return;}
  var label=(selectedImportLabel||'').trim();
  el.textContent=label?label:('Import '+selectedImportId.slice(0,8));
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
    btn.className=(step===currentStep?'btn btn-sm step-btn':'btn-ghost btn-sm step-btn')+(btn.disabled?' disabled':'');
    if(btn.disabled){
      btn.title='Complete the previous step first.';
    }
  });
}

function setStep(step){
  currentStep=step;
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

  if(step==='insights'){initBroadPanel();loadDeepImageTable();loadDeepCarouselTable();loadDeepVideoTable();refreshInsightCounts();}
  if(step==='pack'){loadProfile().then(renderPackSettings);loadSignalPacksForInspector();loadIdeaListDropdowns();}
  if(step==='ideas'){loadIdeaListTab();}
  if(step==='run'){syncRunPanel();}
  renderStepper();
}

function syncRunPanel(){
  var el=document.getElementById('run-latest-pack');
  if(el){
    if(stepState.pack_id){
      el.textContent=stepState.pack_id+(stepState.pack_created_at?(' · '+String(stepState.pack_created_at)):'');
    }else{
      el.textContent='—';
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

document.getElementById('btn-open-profile')?.addEventListener('click',function(){
  var p=document.getElementById('panel-profile');
  if(!p)return;
  var isOpen=p.style.display==='block';
  p.style.display=isOpen?'none':'block';
  if(!isOpen){loadProfile();loadAudit();}
});

document.getElementById('btn-refresh-evidence')?.addEventListener('click',function(){
  loadImportStats();
  loadPrellmKindsAndPreview();
});

async function loadImports(){
  var root=document.getElementById('imports-root');
  var hint=document.getElementById('imports-hint');
  var wb=document.getElementById('import-workbench');
  if(!SLUG){root.innerHTML='<div class="empty">Select a project in the sidebar.</div>';return;}
  root.innerHTML='Loading…';
  try{
    var r=await cafFetch('/v1/inputs-evidence/'+encodeURIComponent(SLUG));
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var rows=d.imports||[];
    if(selectedImportId){
      selectedImportLabel='';
      for(var si=0;si<rows.length;si++){
        var imp=rows[si];
        if(imp&&imp.id===selectedImportId){
          selectedImportLabel=String(imp.upload_filename||'').trim();
          break;
        }
      }
    }
    if(rows.length===0){root.innerHTML='<div class="empty">No evidence imports for this project.</div>';hint.textContent='';wb.style.display='none';return;}
    var tb='<table class="sp-modal-table"><thead><tr><th>Created</th><th>File</th><th>Rows</th><th></th></tr></thead><tbody>';
    for(var i=0;i<rows.length;i++){
      var x=rows[i];
      var sel=x.id===selectedImportId?'btn btn-sm':'btn-ghost btn-sm';
      var trStyle=x.id===selectedImportId?'background:rgba(100,160,255,0.10);outline:1px solid rgba(100,160,255,0.25);':'';
      tb+='<tr style="'+trStyle+'"><td>'+esc(String(x.created_at||'').slice(0,19))+'</td><td>'+esc(x.upload_filename||'—')+'</td><td>'+esc(x.stored_row_count)+'</td><td><button type="button" class="'+sel+' sel-import" data-id="'+esc(x.id)+'">'+(x.id===selectedImportId?'Selected':'Select')+'</button></td></tr>';
    }
    tb+='</tbody></table>';
    root.innerHTML=tb;
    hint.textContent=rows.length+' import(s)';
    root.querySelectorAll('.sel-import').forEach(function(btn){
      btn.addEventListener('click',function(){
        selectedImportId=btn.getAttribute('data-id')||'';
        selectedIdeaListId='';
        stepState.evidence_valid=false;
        stepState.insights_present=false;
        stepState.ideas_present=false;
        stepState.pack_id='';
        stepState.pack_created_at='';
        try{
          var tr=btn.closest('tr');
          var tds=tr?tr.querySelectorAll('td'):null;
          selectedImportLabel=(tds&&tds.length>=2)?String(tds[1].textContent||'').trim():'';
        }catch(e){selectedImportLabel='';}
        setImportInUrl(selectedImportId);
        wb.style.display='block';
        loadImportStats();
        loadPrellmKindsAndPreview();
        setStep('evidence');
        loadImports();
        loadIdeaListDropdowns();
      });
    });
    if(selectedImportId){
      wb.style.display='block';
      loadImportStats();
      loadPrellmKindsAndPreview();
      setStep(currentStep||'evidence');
      loadIdeaListDropdowns();
    }
  }catch(e){root.innerHTML='<div class="empty" style="color:var(--red)">'+esc(e.message||e)+'</div>';}
}

async function loadImportStats(){
  var pre=document.getElementById('import-stats');
  if(!SLUG||!selectedImportId||!pre){pre.textContent='';return;}
  pre.textContent='Loading…';
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

document.getElementById('profile-form')?.addEventListener('submit',async function(e){
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
  root.textContent='Loading…';
  try{
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/audit?limit=40');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var rows=d.audits||[];
    if(rows.length===0){root.textContent='No inputs_* audit rows yet.';return;}
    var h='';
    for(var i=0;i<rows.length;i++){
      var x=rows[i];
      h+='<div style="border-bottom:1px solid var(--border);padding:6px 0"><strong>'+esc(x.step)+'</strong> · '+esc(x.provider)+' · '+(x.ok?'ok':'fail')+' · '+esc(x.created_at)+' · model '+esc(x.model||'')+'</div>';
      h+='<pre style="margin:4px 0 8px;font-size:10px;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow:auto">'+esc(JSON.stringify({request:x.request_json,response:x.response_json},null,0).slice(0,12000))+'</pre>';
    }
    root.innerHTML=h;
  }catch(e){root.textContent=String(e);}
}

document.getElementById('btn-reload-imports')?.addEventListener('click',loadImports);
document.getElementById('btn-reload-audit')?.addEventListener('click',loadAudit);

async function loadPrellmKindsAndPreview(){
  if(!SLUG||!selectedImportId)return;
  var bar=document.getElementById('prellm-kind-bar');
  if(!bar)return;
  bar.innerHTML='Loading kinds…';
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
      // Final fallback: 0.35 is a pragmatic default for “top performer” exploration.
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
  var minNum=document.getElementById('prellm-min-score-num');
  var minVal=document.getElementById('prellm-min-val');
  if(!minEl||!prellmKind)return;
  var v=prellmMinByKind[prellmKind];
  if(typeof v!=='number'){
    // Default to the suggested table (or 0.35) and keep it per-kind once changed.
    var s=PRELLM_SUGGESTED[prellmKind]||PRELLM_SUGGESTED._default;
    v=(s&&s.min_score);
    if(v==null||!Number.isFinite(v))v=0.35;
    prellmMinByKind[prellmKind]=v;
  }
  minEl.value=String(v);
  if(minNum)minNum.value=String(v);
  if(minVal)minVal.textContent=Number(v).toFixed(2);
}

function syncBroadKindsFromStats(bk){
  broadKinds=platformKindsFromStats(bk);
  if(!broadKind||broadKinds.indexOf(broadKind)<0)broadKind=broadKinds[0]||'';
}

function schedulePrellmPreview(){
  if(prellmTimer)clearTimeout(prellmTimer);
  prellmTimer=setTimeout(loadPrellmPreview,220);
}

async function loadPrellmPreview(){
  var counts=document.getElementById('prellm-counts');
  var wrap=document.getElementById('prellm-table-wrap');
  var minEl=document.getElementById('prellm-min-score');
  var minNum=document.getElementById('prellm-min-score-num');
  var minVal=document.getElementById('prellm-min-val');
  var showBelow=document.getElementById('prellm-show-below');
  var sortEl=document.getElementById('prellm-sort');
  if(!SLUG||!selectedImportId||!prellmKind||!counts||!wrap||!minEl||!sortEl)return;
  var minScore=parseFloat(minEl.value)||0;
  prellmMinByKind[prellmKind]=minScore;
  if(minNum)minNum.value=String(minScore);
  if(minVal)minVal.textContent=minScore.toFixed(2);
  counts.textContent='Loading…';
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
    if(rows.length===0){wrap.innerHTML='<div class="empty" style="padding:12px">No rows at or above this cutoff.</div>';return;}
    var tb='<table class="sp-modal-table"><thead><tr>'+
      '<th style="cursor:pointer" id="prellm-th-score">Score</th>'+
      '<th>Included</th><th>URL</th><th>Caption</th><th>Hashtags</th></tr></thead><tbody>';
    for(var i=0;i<rows.length;i++){
      var x=rows[i];
      var inc=!!x.included_by_cutoff;
      var urlCell=x.url?('<a href="'+esc(x.url)+'" target="_blank" rel="noopener">'+esc(x.url.slice(0,140))+'</a>'):'<span style="color:var(--muted)">—</span>';
      tb+='<tr style="'+(inc?'':'opacity:0.55')+'">'+
        '<td class="mono">'+esc(String(x.pre_llm_score))+'</td>'+
        '<td class="mono" style="color:'+(inc?'var(--green)':'var(--muted)')+'">'+(inc?'yes':'no')+'</td>'+
        '<td style="max-width:200px;word-break:break-all">'+urlCell+'</td>'+
        '<td style="max-width:360px;white-space:pre-wrap;word-break:break-word">'+esc(x.caption||'')+'</td>'+
        '<td style="max-width:200px;word-break:break-word">'+esc(x.hashtags||'')+'</td></tr>';
    }
    tb+='</tbody></table>';
    wrap.innerHTML=tb;
    document.getElementById('prellm-th-score')?.addEventListener('click',function(){
      var cur=document.getElementById('prellm-sort');
      if(!cur)return;
      cur.value=(cur.value==='score_desc')?'score_asc':'score_desc';
      schedulePrellmPreview();
    });
  }catch(e){counts.textContent=String(e);}
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
    if(msg){msg.textContent='Saving cutoff…';msg.style.color='';}
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

document.getElementById('prellm-min-score')?.addEventListener('input',function(){
  var minNum=document.getElementById('prellm-min-score-num');
  if(minNum)minNum.value=String(this.value||'0');
  schedulePrellmPreview();
  scheduleSavePrellmCutoff();
});
document.getElementById('prellm-min-score-num')?.addEventListener('input',function(){
  var v=parseFloat(this.value||'0');
  if(!Number.isFinite(v))v=0;
  v=Math.max(0,Math.min(1,v));
  var minEl=document.getElementById('prellm-min-score');
  if(minEl)minEl.value=String(v);
  schedulePrellmPreview();
  scheduleSavePrellmCutoff();
});
document.getElementById('prellm-show-below')?.addEventListener('change',schedulePrellmPreview);
document.getElementById('prellm-sort')?.addEventListener('change',schedulePrellmPreview);

function readBroadOverrides(){
  return {
    custom_label_1:(document.getElementById('broad-label-1')?.value||'').trim()||null,
    custom_label_2:(document.getElementById('broad-label-2')?.value||'').trim()||null,
    custom_label_3:(document.getElementById('broad-label-3')?.value||'').trim()||null,
    system_prompt:(document.getElementById('broad-system-prompt')?.value||'').trim()||null,
    user_prompt:(document.getElementById('broad-user-prompt')?.value||'').trim()||null
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
  el.textContent='Eligible evidence after cutoff: computing…';
  el.style.color='';
  try{
    var maxRows=parseInt(document.getElementById('broad-max-rows')?.value||'800',10);
    if(!Number.isFinite(maxRows)||maxRows<1)maxRows=800;
    var rescan=!!document.getElementById('broad-rescan')?.checked;
    var useCutoff=!!document.getElementById('broad-use-cutoff')?.checked;
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

    // Also compute "all platforms" total (usually 3–6 kinds), so user sees it before clicking.
    var total=0;
    for(var i=0;i<broadKinds.length;i++){
      var k=broadKinds[i];
      total+=await dryRunForKind(k);
      if(seq!==broadEligSeq)return;
    }
    el.textContent='Eligible evidence after cutoff: this tab '+String(nTab)+' · all platforms '+String(total)+'.';
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
    if(m){m.textContent='Loading…';m.style.color='';}
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
    if(m){m.textContent='Loaded. Model '+d.model+' · batch '+d.batch_size+'.';m.style.color='var(--muted)';}
  }catch(e){
    if(m){m.textContent=String(e.message||e);m.style.color='var(--red)';}
  }
}

document.getElementById('btn-toggle-broad-prompt')?.addEventListener('click',function(){
  var panel=document.getElementById('broad-prompt-panel');
  if(!panel)return;
  panel.style.display=panel.style.display==='none'?'block':'none';
  if(panel.style.display==='block'){
    // Populate immediately with current prompts if not editing.
    if(!broadPromptDirty)loadBroadPromptIntoEditor();
  }
});
document.getElementById('btn-load-broad-prompt')?.addEventListener('click',loadBroadPromptIntoEditor);
document.getElementById('btn-reset-broad-prompt')?.addEventListener('click',function(){
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

document.getElementById('btn-save-broad-labels')?.addEventListener('click',async function(){
  var m=document.getElementById('broad-prompt-msg');
  if(!SLUG){if(m){m.textContent='Select a project.';m.style.color='var(--red)';}return;}
  try{
    if(m){m.textContent='Saving labels…';m.style.color='';}
    var pc=await loadProfileForPrellm();
    if(!pc||!pc.profile)throw new Error('Profile not loaded');
    var criteria=JSON.parse(JSON.stringify(pc.criteria||{}));
    if(!criteria.insight_column_labels||typeof criteria.insight_column_labels!=='object')criteria.insight_column_labels={};
    criteria.insight_column_labels.custom_label_1=(document.getElementById('broad-label-1')?.value||'').trim();
    criteria.insight_column_labels.custom_label_2=(document.getElementById('broad-label-2')?.value||'').trim();
    criteria.insight_column_labels.custom_label_3=(document.getElementById('broad-label-3')?.value||'').trim();
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
document.getElementById('broad-label-1')?.addEventListener('input',markBroadPromptDirty);
document.getElementById('broad-label-2')?.addEventListener('input',markBroadPromptDirty);
document.getElementById('broad-label-3')?.addEventListener('input',markBroadPromptDirty);
document.getElementById('broad-system-prompt')?.addEventListener('input',markBroadPromptDirty);
document.getElementById('broad-user-prompt')?.addEventListener('input',markBroadPromptDirty);

function renderWeightsTable(weights){
  var wrap=document.getElementById('prellm-weights-wrap');
  if(!wrap)return;
  var keys=Object.keys(weights||{}).sort();
  if(keys.length===0){
    wrap.innerHTML='<div class="empty" style="padding:10px">No weights configured.</div>';
    return;
  }
  var h='<table class="sp-modal-table" style="margin:0"><thead><tr><th>Feature</th><th>Weight</th><th></th></tr></thead><tbody>';
  for(var i=0;i<keys.length;i++){
    var k=keys[i];
    h+='<tr>'+
      '<td class="mono" style="max-width:220px;word-break:break-word">'+esc(k)+'</td>'+
      '<td><input type="number" step="0.01" min="0" value="'+esc(String(weights[k]))+'" data-wkey="'+esc(k)+'" class="prellm-wt" style="width:92px;font-size:12px" /></td>'+
      '<td><button type="button" class="btn-ghost btn-sm prellm-del-wt" data-wkey="'+esc(k)+'">Remove</button></td>'+
    '</tr>';
  }
  h+='</tbody></table>';
  wrap.innerHTML=h;
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
  if(hint)hint.textContent='Score = Σ(feature_i × weight_i) / Σ(weights). Features are normalized 0–1 in code. Platform: '+prellmKind+'.';
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

document.getElementById('prellm-weights-wrap')?.addEventListener('click',function(e){
  var t=e&&e.target;
  if(!t||!t.classList||!t.classList.contains('prellm-del-wt'))return;
  var k=t.getAttribute('data-wkey')||'';
  if(!k)return;
  // Remove row in DOM
  var row=t.closest('tr');
  if(row)row.remove();
});

document.getElementById('prellm-add-weight')?.addEventListener('click',function(){
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

document.getElementById('prellm-save-formula')?.addEventListener('click',async function(){
  var msg=document.getElementById('prellm-save-msg');
  if(!SLUG||!prellmKind){if(msg)msg.textContent='Select a platform first.';return;}
  if(msg){msg.textContent='Saving…';msg.style.color='';}
  try{
    var pc=await loadProfileForPrellm();
    if(!pc||!pc.profile)throw new Error('Profile not loaded');
    var criteria=JSON.parse(JSON.stringify(pc.criteria||{})); // deep-ish clone for safety
    if(!criteria.pre_llm||typeof criteria.pre_llm!=='object')criteria.pre_llm={};
    if(!criteria.pre_llm.kinds||typeof criteria.pre_llm.kinds!=='object')criteria.pre_llm.kinds={};
    var minScore=parseFloat(document.getElementById('prellm-profile-min')?.value||'0');
    if(!Number.isFinite(minScore))minScore=0;
    minScore=Math.max(0,Math.min(1,minScore));
    var mt=parseInt(document.getElementById('prellm-min-text')?.value||'12',10);
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

document.getElementById('btn-run-broad-insights')?.addEventListener('click',async function(){
  var msg=document.getElementById('prellm-insight-msg');
  if(!SLUG||!selectedImportId){if(msg)msg.textContent='Select an import first.';return;}
  try{
    var maxRows=parseInt(document.getElementById('broad-max-rows')?.value||'800',10);
    if(!Number.isFinite(maxRows)||maxRows<1)maxRows=800;
    var rescan=!!document.getElementById('broad-rescan')?.checked;
    var useCutoff=!!document.getElementById('broad-use-cutoff')?.checked;
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
    if(msg){msg.textContent='Checking eligible evidence rows…';msg.style.color='';}
    var r0=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/run-broad-insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({},body,{dry_run:true}))});
    var d0=await r0.json().catch(function(){return {};});
    if(!r0.ok||!d0.ok)throw new Error(apiErr(d0,'HTTP '+r0.status));
    var nElig=Number(d0.rows_eligible_new||0);
    if(msg){msg.textContent='Running broad LLM (this platform tab) — will analyze '+String(nElig)+' evidence rows…';msg.style.color='';}
    scheduleBroadEligibilityEstimate();
    if(nElig<=0){loadBroadTable();return;}
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/run-broad-insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json().catch(function(){return {};});
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    if(msg)msg.textContent='Broad ('+kindLabel(kind,'insights')+') done: upserted '+String(d.upserted||0)+' · batches '+String(d.batches||0)+' · total '+String(d.broad_insights_total||0)+'.';
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
document.getElementById('btn-run-broad-insights-all')?.addEventListener('click',async function(){
  var msg=document.getElementById('prellm-insight-msg');
  if(!SLUG||!selectedImportId){if(msg)msg.textContent='Select an import first.';return;}
  if(broadAllRunning){if(msg)msg.textContent='Already running ALL platforms…';return;}
  if(!broadKinds||!broadKinds.length){if(msg)msg.textContent='No social platforms found for broad insights in this import.';return;}
  broadAllRunning=true;
  try{
    var maxRows=parseInt(document.getElementById('broad-max-rows')?.value||'800',10);
    if(!Number.isFinite(maxRows)||maxRows<1)maxRows=800;
    var rescan=!!document.getElementById('broad-rescan')?.checked;
    var useCutoff=!!document.getElementById('broad-use-cutoff')?.checked;
    var o=readBroadOverrides();
    if(rescan){
      var ok=confirm('Rescan is enabled. This will overwrite existing broad insights rows across ALL platform tabs. Continue?');
      if(!ok){broadAllRunning=false;return;}
    }

    if(msg){msg.textContent='Checking eligible evidence rows (all platforms)…';msg.style.color='';}
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
    if(msg){msg.textContent='Running broad (all platforms) — will analyze '+String(totalElig)+' evidence rows total…';msg.style.color='';}
    scheduleBroadEligibilityEstimate();
    if(totalElig<=0){loadBroadTable();return;}

    var total=0;
    var perKind=[];
    for(var i=0;i<broadKinds.length;i++){
      var kind=broadKinds[i];
      if(msg){msg.textContent='Running broad (all platforms): '+kindLabel(kind,'insights')+' ('+(i+1)+'/'+broadKinds.length+')…';msg.style.color='';}
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

document.getElementById('btn-run-deep-image-insights')?.addEventListener('click',async function(){
  var msg=document.getElementById('top-insight-msg');
  if(!SLUG||!selectedImportId){if(msg)msg.textContent='Select an import first.';return;}
  if(msg){msg.textContent='Running image vision…';msg.style.color='';}
  try{
    var minScore=parseFloat(document.getElementById('prellm-min-score')?.value||'0.35')||0.35;
    var body={max_rows:24,min_pre_llm_score:minScore,rescan:false};
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/run-deep-image-insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json().catch(function(){return {};});
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    if(msg)msg.textContent='Image deep: analyzed '+String(d.rows_analyzed||0)+' · pool '+String(d.candidates_with_image||0)+' · skipped carousel '+String(d.skipped_carousel||0)+' · skipped video-like '+String(d.skipped_video||0)+' · no image URL '+String(d.skipped_no_image||0)+' · total deep '+String(d.deep_insights_total||0)+'.';
    loadDeepImageTable();
  }catch(e){if(msg){msg.textContent=String(e.message||e);msg.style.color='var(--red)';}}
});

document.getElementById('btn-run-deep-carousel-insights')?.addEventListener('click',async function(){
  var msg=document.getElementById('top-insight-msg');
  if(!SLUG||!selectedImportId){if(msg)msg.textContent='Select an import first.';return;}
  if(msg){msg.textContent='Running carousel vision (all slides)…';msg.style.color='';}
  try{
    var minScore=parseFloat(document.getElementById('prellm-min-score')?.value||'0.35')||0.35;
    var body={max_rows:12,min_pre_llm_score:minScore,max_slides:12,rescan:false};
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/run-deep-carousel-insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json().catch(function(){return {};});
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    if(msg)msg.textContent='Carousel deep: analyzed '+String(d.rows_analyzed||0)+' · slide pool '+String(d.candidates_with_slides||0)+' · deck-shaped rows '+String(d.carousel_deck_rows||0)+' · total '+String(d.carousel_insights_total||0)+'.';
    loadDeepCarouselTable();
  }catch(e){if(msg){msg.textContent=String(e.message||e);msg.style.color='var(--red)';}}
});

document.getElementById('btn-run-deep-video-insights')?.addEventListener('click',async function(){
  var msg=document.getElementById('top-insight-msg');
  if(!SLUG||!selectedImportId){if(msg)msg.textContent='Select an import first.';return;}
  if(msg){msg.textContent='Running video frame bundle…';msg.style.color='';}
  try{
    var minScore=parseFloat(document.getElementById('prellm-min-score')?.value||'0.35')||0.35;
    var body={max_rows:16,min_pre_llm_score:minScore,max_frames:10,rescan:false};
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/run-deep-video-insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json().catch(function(){return {};});
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    if(msg)msg.textContent='Video deep: analyzed '+String(d.rows_analyzed||0)+' · frame pool '+String(d.candidates_with_frames||0)+' · video rows '+String(d.video_evidence_rows||0)+' · no-frame skips '+String(d.skipped_no_frames||0)+' · total '+String(d.video_insights_total||0)+'.';
    loadDeepVideoTable();
  }catch(e){if(msg){msg.textContent=String(e.message||e);msg.style.color='var(--red)';}}
});

async function initBroadPanel(){
  var bar=document.getElementById('broad-kind-bar');
  var meta=document.getElementById('broad-meta');
  var wrap=document.getElementById('broad-table-wrap');
  if(!bar||!SLUG||!selectedImportId)return;
  if(!broadKinds.length){
    bar.innerHTML='Loading kinds…';
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

async function loadBroadTable(){
  var meta=document.getElementById('broad-meta');
  var state=document.getElementById('broad-state');
  var wrap=document.getElementById('broad-table-wrap');
  if(!SLUG||!selectedImportId||!broadKind||!meta||!wrap)return;
  meta.textContent='Loading…';
  if(state)state.textContent='Loading…';
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
    var lastAt=rows.length?String(rows[0].updated_at||rows[0].created_at||''):'';
    if(state){
      state.textContent=
        'Rows in DB (this tab): '+String(countsTab.broad_llm||0)+
        ' · Import total broad: '+String(countsImp.broad_llm||0)+
        (lastAt?(' · Last updated: '+lastAt):'');
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
      wrap.innerHTML='<div class="empty" style="padding:12px">No broad insights for <span class="mono">'+esc(broadKind)+'</span> yet ('+String(nTab)+' in DB for this kind on this import). If other tabs have rows but this one does not, run broad for this tab with <strong>Rescan</strong> and/or turn off <strong>Use cutoff</strong> so enough rows qualify. Import-wide total (all kinds) is in the JSON as <span class="mono">counts_whole_import.broad_llm</span>.</div>';
      return;
    }
    var tb='<table class="sp-modal-table" style="width:100%;min-width:1180px;table-layout:auto"><thead><tr><th>Insight ID</th><th>Evidence row</th><th>Kind</th><th>Pre-LLM score</th><th>Row rating</th><th>Why it worked</th><th>Hook</th><th>Emotion</th></tr></thead><tbody>';
    for(var i=0;i<rows.length;i++){
      var x=rows[i];
      var insightId=String(x.insights_id||'');
      var rowId=String(x.source_evidence_row_id||'');
      tb+='<tr>'+
        '<td class="mono">'+esc(insightId)+'</td>'+
        '<td class="mono"><a href="#" class="broad-ev-link" data-row-id="'+esc(rowId)+'">'+esc(rowId)+'</a></td>'+
        '<td class="mono">'+esc(x.evidence_kind)+'</td>'+
        '<td class="mono">'+fmtInsightScore(x.pre_llm_score)+'</td>'+
        '<td class="mono">'+fmtInsightScore(x.evidence_rating_score)+'</td>'+
        '<td style="max-width:380px;white-space:pre-wrap">'+esc(x.why_it_worked||'')+'</td>'+
        '<td>'+esc(x.hook_text||'')+'</td>'+
        '<td>'+esc(x.primary_emotion||'')+'</td>'+
      '</tr>';
    }
    tb+='</tbody></table>';
    wrap.innerHTML=tb;
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
    refreshInsightCounts();
  }catch(e){meta.textContent=String(e);}
}
document.getElementById('btn-reload-broad')?.addEventListener('click',loadBroadTable);
document.getElementById('broad-insight-sort')?.addEventListener('change',loadBroadTable);
document.getElementById('broad-insight-limit')?.addEventListener('change',loadBroadTable);
document.getElementById('broad-max-rows')?.addEventListener('input',scheduleBroadEligibilityEstimate);
document.getElementById('broad-rescan')?.addEventListener('change',scheduleBroadEligibilityEstimate);
document.getElementById('broad-use-cutoff')?.addEventListener('change',scheduleBroadEligibilityEstimate);
document.getElementById('btn-pack-inspect-reload')?.addEventListener('click',loadSignalPacksForInspector);
document.getElementById('pack-inspect-select')?.addEventListener('change',loadSelectedSignalPack);
document.getElementById('pack-idea-list-select')?.addEventListener('change',function(){
  var id=(this.value||'').trim();
  if(id)selectedIdeaListId=id;
  loadIdeaListIdeasTable();
  updatePackSummary();
});

function renderInsightTable(rows,cols){
  if(!rows.length)return '<div class="empty" style="padding:12px">No rows.</div>';
  var tb='<table class="sp-modal-table" style="width:100%;min-width:980px;table-layout:auto"><thead><tr>';
  for(var c=0;c<cols.length;c++)tb+='<th>'+esc(cols[c].label)+'</th>';
  tb+='</tr></thead><tbody>';
  for(var i=0;i<rows.length;i++){
    var x=rows[i];
    tb+='<tr>';
    for(var j=0;j<cols.length;j++){
      var k=cols[j].key;
      var v=x[k];
      var cell;
      if(k==='pre_llm_score'||k==='evidence_rating_score'||k==='confidence_score')cell=fmtInsightScore(v);
      else cell=esc(typeof v==='string'?v:JSON.stringify(v!==undefined&&v!==null?v:''));
      tb+='<td style="max-width:420px;white-space:pre-wrap;word-break:break-word"'+(k==='pre_llm_score'||k==='evidence_rating_score'||k==='confidence_score'?' class="mono"':'')+'>'+cell+'</td>';
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

document.getElementById('btn-close-idea-preview')?.addEventListener('click',function(){
  var box=document.getElementById('idea-preview');
  if(box)box.style.display='none';
});

function renderIdeasTable(rows){
  if(!rows.length)return '<div class="empty" style="padding:12px">No rows in this list.</div>';
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

document.getElementById('fl-carousel')?.addEventListener('input',updatePackSummary);
document.getElementById('fl-video')?.addEventListener('input',updatePackSummary);
document.getElementById('fl-post')?.addEventListener('input',updatePackSummary);
document.getElementById('fl-thread')?.addEventListener('input',updatePackSummary);
document.getElementById('fl-other')?.addEventListener('input',updatePackSummary);
async function loadIdeaListDropdowns(){
  var s1=document.getElementById('idea-list-select');
  var s2=document.getElementById('pack-idea-list-select');
  if(!SLUG||!selectedImportId){
    if(s1){s1.innerHTML='<option value="">Select an import first</option>';s1.disabled=true;}
    if(s2){s2.innerHTML='<option value="">—</option>';s2.disabled=true;}
    return;
  }
  if(s1)s1.disabled=false;
  if(s2)s2.disabled=false;
  if(s1)s1.innerHTML='<option value="">Loading…</option>';
  if(s2)s2.innerHTML='<option value="">Loading…</option>';
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
      body+='<option value="'+esc(String(L.id||''))+'">'+esc(when+' · '+title)+'</option>';
    }
    if(s1){
      s1.innerHTML=lists.length?('<option value="">Select a list…</option>'+body):'<option value="">No idea lists yet</option>';
      if(selectedIdeaListId){
        s1.value=selectedIdeaListId;
        if(s1.value!==selectedIdeaListId)selectedIdeaListId='';
      }
      s1.value=selectedIdeaListId;
    }
    if(s2){
      s2.innerHTML=lists.length?('<option value="">—</option>'+body):'<option value="">No idea lists yet</option>';
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
    stepState.ideas_present=false;
    renderStepper();
    try{lastIdeasById={};}catch(e){}
    return;
  }
  wrap.innerHTML='Loading…';
  if(meta)meta.textContent='';
  if(state)state.textContent='Loading…';
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
    stepState.ideas_present=ideas.length>0;
    renderStepper();
    var sel=loadIdeaSelection();
    var selectedN=0;
    for(var i=0;i<ideas.length;i++){
      var id=String(ideas[i].id||'');
      if(id && sel[id])selectedN++;
    }
    if(state){
      state.textContent='Ideas: '+String(ideas.length)+' · Selected: '+String(selectedN);
    }
    wrap.innerHTML=renderIdeasTable(ideas);
    wrap.querySelectorAll('.idea-check').forEach(function(cb){
      cb.addEventListener('change',function(){
        var id=this.getAttribute('data-id')||'';
        var cur=loadIdeaSelection();
        if(this.checked)cur[id]=true;else delete cur[id];
        saveIdeaSelection(cur);
        loadIdeaListIdeasTable();
      });
    });
    wrap.querySelectorAll('.idea-row').forEach(function(tr){
      tr.addEventListener('click',function(ev){
        // ignore clicks on checkbox itself
        var t=ev && ev.target;
        if(t && t.tagName && String(t.tagName).toLowerCase()==='input')return;
        var id=this.getAttribute('data-id')||'';
        if(!id)return;
        openIdeaPreview(id);
      });
    });
    wrap.querySelector('#ideas-check-all')?.addEventListener('change',function(){
      var cur={};
      if(this.checked){
        for(var k=0;k<ideas.length;k++){
          var id=String(ideas[k].id||'');
          if(id)cur[id]=true;
        }
      }
      saveIdeaSelection(cur);
      loadIdeaListIdeasTable();
    });
  }catch(e){
    wrap.textContent=String(e.message||e);
    if(state)state.textContent='';
  }
}
async function loadSignalPacksForInspector(){
  var sel=document.getElementById('pack-inspect-select');
  var msg=document.getElementById('pack-inspect-msg');
  if(!sel||!SLUG)return;
  sel.innerHTML='<option value="">Loading…</option>';
  if(msg){msg.textContent='';msg.style.color='';}
  try{
    var r=await cafFetch('/v1/admin/signal-packs?project='+encodeURIComponent(SLUG)+'&limit=120&offset=0');
    var d=await r.json().catch(function(){return {};});
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var rows=d.rows||[];
    if(!rows.length){
      sel.innerHTML='<option value="">No signal packs for this project yet</option>';
      if(msg)msg.textContent='Build one in this tab (Build signal pack).';
      return;
    }
    var h='<option value="">Select a signal pack…</option>';
    for(var i=0;i<rows.length;i++){
      var p=rows[i]||{};
      var when=String(p.created_at||'').slice(0,19);
      var fn=p.upload_filename||p.run_id||p.id;
      var ideasN=Number(p.ideas_count||0);
      var overallN=Number(p.candidate_count||0);
      h+='<option value="'+esc(String(p.id||''))+'">'+esc(when+' · '+String(fn||'')+' (ideas '+ideasN+', overall '+overallN+')')+'</option>';
    }
    sel.innerHTML=h;
  }catch(e){
    sel.innerHTML='<option value="">Could not load signal packs</option>';
    if(msg){msg.textContent=String(e.message||e);msg.style.color='var(--red)';}
  }
}

async function loadSelectedSignalPack(){
  var sel=document.getElementById('pack-inspect-select');
  var msg=document.getElementById('pack-inspect-msg');
  var ideasD=document.getElementById('pack-inspect-ideas-details');
  var overallD=document.getElementById('pack-inspect-overall-details');
  var rawD=document.getElementById('pack-inspect-raw-details');
  var ideasWrap=document.getElementById('pack-inspect-ideas');
  var overallWrap=document.getElementById('pack-inspect-overall');
  var rawPre=document.getElementById('pack-inspect-raw');
  if(!sel||!SLUG)return;
  var id=(sel.value||'').trim();
  if(!id){
    if(ideasD)ideasD.style.display='none';
    if(overallD)overallD.style.display='none';
    if(rawD)rawD.style.display='none';
    if(msg){msg.textContent='';msg.style.color='';}
    return;
  }
  if(msg){msg.textContent='Loading pack…';msg.style.color='';}
  if(ideasWrap)ideasWrap.innerHTML='Loading…';
  if(overallWrap)overallWrap.innerHTML='Loading…';
  if(rawPre)rawPre.textContent='Loading…';
  try{
    var r=await cafFetch('/v1/admin/signal-pack?project='+encodeURIComponent(SLUG)+'&id='+encodeURIComponent(id));
    var d=await r.json().catch(function(){return {};});
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var pack=d.signal_pack||{};
    var ideas=Array.isArray(pack.ideas_json)?pack.ideas_json:[];
    var overall=Array.isArray(pack.overall_candidates_json)?pack.overall_candidates_json:[];
    if(msg)msg.textContent='Pack loaded. ideas_json '+String(ideas.length)+', overall_candidates_json '+String(overall.length)+'.';
    if(ideasD)ideasD.style.display='block';
    if(overallD)overallD.style.display='block';
    if(rawD)rawD.style.display='block';
    if(ideasWrap)ideasWrap.innerHTML=renderInsightTable(ideas.slice(0,120),[
      {key:'idea_id',label:'idea_id'},
      {key:'title',label:'title'},
      {key:'platform',label:'platform'},
      {key:'hook',label:'hook'}
    ]);
    if(overallWrap)overallWrap.innerHTML=renderInsightTable(overall.slice(0,120),[
      {key:'candidate_id',label:'candidate_id'},
      {key:'platform',label:'platform'},
      {key:'summary',label:'summary'},
      {key:'content_idea',label:'content_idea'}
    ]);
    if(rawPre)rawPre.textContent=JSON.stringify({
      id: pack.id,
      run_id: pack.run_id,
      created_at: pack.created_at,
      upload_filename: pack.upload_filename,
      source_window: pack.source_window,
      source_inputs_import_id: pack.source_inputs_import_id ?? null,
      ideas_count: ideas.length,
      overall_candidates_count: overall.length,
      ideas_json: ideas,
      overall_candidates_json: overall,
      derived_globals_json: pack.derived_globals_json ?? {},
      notes: pack.notes ?? null
    },null,2);
  }catch(e){
    if(msg){msg.textContent=String(e.message||e);msg.style.color='var(--red)';}
    if(ideasD)ideasD.style.display='none';
    if(overallD)overallD.style.display='none';
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

document.getElementById('btn-copy-broad-debug')?.addEventListener('click',async function(){
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
  pre.textContent='Loading…';
  var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/evidence-row/'+encodeURIComponent(rowId));
  var d=await r.json().catch(function(){return {};});
  if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
  var row=d.row||{};
  pre.textContent=JSON.stringify({
    id: row.id,
    evidence_kind: row.evidence_kind,
    sheet_name: row.sheet_name,
    row_index: row.row_index,
    dedupe_key: row.dedupe_key,
    payload_json: row.payload_json,
    rating_score: row.rating_score,
    rating_rationale: row.rating_rationale,
    rated_at: row.rated_at
  },null,2);
}

document.getElementById('btn-close-broad-evidence')?.addEventListener('click',function(){
  var box=document.getElementById('broad-evidence-viewer');
  if(box)box.style.display='none';
});

async function loadDeepImageTable(){
  var el=document.getElementById('deep-image-table');
  if(!SLUG||!selectedImportId||!el)return;
  el.innerHTML='Loading…';
  try{
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/evidence-insights?tier=top_performer_deep&limit=200&offset=0&sort=rating_desc');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    el.innerHTML=renderInsightTable(d.insights||[],[
      {key:'analysis_tier',label:'Tier'},
      {key:'evidence_kind',label:'Platform'},
      {key:'source_evidence_row_id',label:'Row ID'},
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
    ]);
  }catch(e){el.textContent=String(e);}
}

async function loadDeepVideoTable(){
  var el=document.getElementById('deep-video-table');
  if(!SLUG||!selectedImportId||!el)return;
  el.innerHTML='Loading…';
  try{
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/evidence-insights?tier=top_performer_video&limit=200&offset=0&sort=rating_desc');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    el.innerHTML=renderInsightTable(d.insights||[],[
      {key:'analysis_tier',label:'Tier'},
      {key:'evidence_kind',label:'Platform'},
      {key:'source_evidence_row_id',label:'Row ID'},
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
    ]);
  }catch(e){el.textContent=String(e);}
}

async function loadDeepCarouselTable(){
  var el=document.getElementById('deep-carousel-table');
  if(!SLUG||!selectedImportId||!el)return;
  el.innerHTML='Loading…';
  try{
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/evidence-insights?tier=top_performer_carousel&limit=200&offset=0&sort=rating_desc');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    el.innerHTML=renderInsightTable(d.insights||[],[
      {key:'analysis_tier',label:'Tier'},
      {key:'evidence_kind',label:'Platform'},
      {key:'source_evidence_row_id',label:'Row ID'},
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
    ]);
  }catch(e){el.textContent=String(e);}
}
document.getElementById('btn-reload-deep-image')?.addEventListener('click',loadDeepImageTable);
document.getElementById('btn-reload-deep-carousel')?.addEventListener('click',loadDeepCarouselTable);
document.getElementById('btn-reload-deep-video')?.addEventListener('click',loadDeepVideoTable);

document.getElementById('idea-list-select')?.addEventListener('change',function(){
  var s=document.getElementById('idea-list-select');
  selectedIdeaListId=(s&&s.value)?s.value.trim():'';
  var s2=document.getElementById('pack-idea-list-select');
  if(s2)s2.value=selectedIdeaListId;
  loadIdeaListIdeasTable();
});
document.getElementById('pack-idea-list-select')?.addEventListener('change',function(){
  var s=document.getElementById('pack-idea-list-select');
  selectedIdeaListId=(s&&s.value)?s.value.trim():'';
  var s1=document.getElementById('idea-list-select');
  if(s1)s1.value=selectedIdeaListId;
});
document.getElementById('btn-reload-idea-lists')?.addEventListener('click',function(){
  loadIdeaListTab();
});
document.getElementById('btn-generate-idea-list')?.addEventListener('click',async function(){
  var msg=document.getElementById('idea-list-generate-msg');
  if(!SLUG||!selectedImportId){
    if(msg)msg.textContent='Select an import first.';
    return;
  }
  if(msg){msg.textContent='Working (LLM)…';msg.style.color='';}
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
document.getElementById('btn-build-pack-from-idea-list')?.addEventListener('click',async function(){
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
  if(msg){msg.textContent='Building pack…';msg.style.color='';}
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
    if(msg)msg.innerHTML='Done. <a class="btn-ghost btn-sm" href="/admin/signal-pack?project='+encodeURIComponent(SLUG)+'&id='+encodeURIComponent(d.signal_pack_id)+'">open pack</a> · ideas in pack: '+esc(String(d.ideas_count||0))+'.';
    stepState.pack_id=String(d.signal_pack_id||'');
    stepState.pack_created_at=String(d.created_at||'');
    renderStepper();
    syncRunPanel();
    loadSignalPacksForInspector();
  }catch(e){
    if(msg){msg.textContent=String(e.message||e);msg.style.color='var(--red)';}
  }
});

document.getElementById('btn-build-pack')?.addEventListener('click',async function(){
  var msg=document.getElementById('build-msg');
  if(!SLUG||!selectedImportId){msg.textContent='Select an import first.';return;}
  var ok=confirm('This runs the full pipeline (rating + synthesis + ideas LLM) and writes a new signal pack. Continue?');
  if(!ok){msg.textContent='Cancelled.';return;}
  msg.textContent='Working (OpenAI)…';
  try{
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/build-signal-pack',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    var raw=await r.text();
    var d;try{d=JSON.parse(raw);}catch{throw new Error(raw.slice(0,400));}
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    msg.innerHTML='Done. Signal pack <a class="btn-ghost btn-sm" href="/admin/signal-pack?project='+encodeURIComponent(SLUG)+'&id='+encodeURIComponent(d.signal_pack_id)+'">open</a> · insights pack <span class="mono">'+esc(d.insights_pack_id||'')+'</span> · ideas_json '+esc(String(d.ideas_count||0))+' (LLM context '+esc(String(d.ideas_llm_context_insights||0))+' insights, '+esc(String(d.ideas_llm_top_performer_rows_in_context||0))+' w/ top-performer) · overall_candidates_json '+esc(String(d.overall_candidates_count||0))+' · rated '+d.rows_rated+'/'+d.rows_considered_for_rating+' rows.';
    stepState.pack_id=String(d.signal_pack_id||'');
    stepState.pack_created_at=String(d.created_at||'');
    renderStepper();
    syncRunPanel();
    loadSignalPacksForInspector();
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
  el.textContent='Selected ideas (UI): '+String(selectedN||0)+' · Per-format caps: '+caps;
}

async function initSourcesPanel(){
  if(!SLUG||!selectedImportId)return;
  var bar=document.getElementById('sources-kind-bar');
  var meta=document.getElementById('sources-meta');
  var wrap=document.getElementById('sources-table-wrap');
  if(!bar||!meta||!wrap)return;
  bar.innerHTML='Loading…';
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
  meta.textContent='Loading…';
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
      var urlCell=x.url?('<a href="'+esc(x.url)+'" target="_blank" rel="noopener">'+esc(x.url.slice(0,140))+'</a>'):'<span style="color:var(--muted)">—</span>';
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

readImportFromUrl();
setStep(selectedImportId?'evidence':'select');
if(SLUG)loadImports();
</script>`;
}
