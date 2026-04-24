/** Inner HTML + script for GET /admin/processing — imports, evidence by platform, insights, top-performer passes, profile. */

export function adminProcessingBody(currentSlug: string): string {
  const SLUG = JSON.stringify(currentSlug);
  const inputsPq = currentSlug ? `?project=${encodeURIComponent(currentSlug)}` : "";
  return `
<div class="ph"><div><h2>Processing</h2><span class="ph-sub">Evidence cutoffs & formulas · Broad insights · Top performers · Sources · Signal pack · Profile</span></div></div>
<div class="content">
  <div class="card" style="margin-bottom:14px">
    <div style="padding:12px 16px 8px">
      <p class="runs-ops-hint">Select an import, then use the segments below. Carousels need ≥2 HTTPS URLs (e.g. <span class="mono">carousel_slide_urls</span>). Video uses <span class="mono">analysis_frame_urls</span> + transcript — no raw MP4 in Core.</p>
      <div id="imports-toolbar" style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button type="button" class="btn btn-sm" id="btn-reload-imports">Reload imports</button>
        <a class="btn-ghost btn-sm" href="/admin/inputs${inputsPq}">Upload on Inputs</a>
        <span id="imports-hint" style="font-size:12px;color:var(--muted)"></span>
      </div>
      <div id="imports-root" class="empty">Loading…</div>
      <div id="import-workbench" style="display:none;margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
        <div style="display:flex;gap:8px;border-bottom:1px solid var(--border);padding:0 0 8px;flex-wrap:wrap">
          <button type="button" class="btn btn-sm" id="seg-evidence" style="border-radius:8px 8px 0 0">Evidence</button>
          <button type="button" class="btn-ghost btn-sm" id="seg-broad" style="border-radius:8px 8px 0 0">Insights (broad)</button>
          <button type="button" class="btn-ghost btn-sm" id="seg-top" style="border-radius:8px 8px 0 0">Top performers</button>
          <button type="button" class="btn-ghost btn-sm" id="seg-sources" style="border-radius:8px 8px 0 0">Sources</button>
          <button type="button" class="btn-ghost btn-sm" id="seg-pack" style="border-radius:8px 8px 0 0">Signal pack</button>
          <button type="button" class="btn-ghost btn-sm" id="seg-profile" style="border-radius:8px 8px 0 0">Profile &amp; audit</button>
        </div>
        <div id="panel-evidence" style="padding:12px 0 0">
          <pre id="import-stats" style="font-size:11px;background:var(--bg);padding:10px;border-radius:8px;overflow:auto;max-height:180px;margin-bottom:12px"></pre>
          <div id="prellm-root">
            <div id="prellm-kind-bar" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px"></div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start;margin-bottom:10px">
              <div style="flex:1;min-width:280px">
                <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                  <label style="font-size:13px">Cutoff for this platform <span id="prellm-min-val" class="mono">0.00</span></label>
                  <input type="range" id="prellm-min-score" min="0" max="1" step="0.01" value="0" style="width:min(420px,100%)" />
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
            <pre id="prellm-counts" style="font-size:12px;background:var(--bg);padding:10px;border-radius:8px;margin-bottom:10px;white-space:pre-wrap"></pre>
            <div id="prellm-table-wrap" style="font-size:12px;max-height:480px;overflow:auto;border:1px solid var(--border);border-radius:8px"></div>
          </div>
        </div>
        <div id="panel-broad" style="display:none;padding:12px 0 0">
          <p class="runs-ops-hint" style="margin-bottom:10px">Broad insights are text-only LLM analysis (<span class="mono">broad_llm</span>) per <strong>social platform</strong> evidence row. Source kinds (<span class="mono">source_registry</span>, <span class="mono">scraped_page</span>) stay under <strong>Sources</strong> — they are not run here.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
            <button type="button" class="btn btn-sm" id="btn-run-broad-insights-all">Run broad LLM — all platforms</button>
            <button type="button" class="btn-ghost btn-sm" id="btn-run-broad-insights">Run broad LLM — this platform tab only</button>
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
            <button type="button" class="btn-ghost btn-sm" id="btn-copy-broad-debug" style="display:none">Copy last run debug</button>
            <span class="runs-ops-hint" style="margin:0;font-size:11px;max-width:640px"><strong>Reload broad insights</strong> re-fetches the table below from the database (no LLM). Use it after a run finishes or if another session wrote rows.</span>
          </div>
          <pre id="broad-meta" style="font-size:12px;background:var(--bg);padding:10px;border-radius:8px;margin:10px 0;white-space:pre-wrap"></pre>
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
          <div id="broad-table-wrap" style="font-size:12px;max-height:520px;overflow:auto;border:1px solid var(--border);border-radius:8px"></div>
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
          <div id="deep-image-table" style="margin-top:8px;font-size:12px;max-height:360px;overflow:auto;border:1px solid var(--border);border-radius:8px"></div>
          <h4 style="font-size:13px;margin:16px 0 8px">Carousel deck rows</h4>
          <button type="button" class="btn-ghost btn-sm" id="btn-reload-deep-carousel">Reload</button>
          <div id="deep-carousel-table" style="margin-top:8px;font-size:12px;max-height:360px;overflow:auto;border:1px solid var(--border);border-radius:8px"></div>
          <h4 style="font-size:13px;margin:16px 0 8px">Video frame rows</h4>
          <button type="button" class="btn-ghost btn-sm" id="btn-reload-deep-video">Reload</button>
          <div id="deep-video-table" style="margin-top:8px;font-size:12px;max-height:360px;overflow:auto;border:1px solid var(--border);border-radius:8px"></div>
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
        <div id="panel-pack" style="display:none;padding:12px 0 0">
          <p class="runs-ops-hint" style="margin-bottom:10px">Build a signal pack from this import (rating + synthesis + ideas). Review settings first.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
            <button type="button" class="btn btn-sm" id="btn-build-pack">Build signal pack</button>
            <span id="build-msg" style="font-size:12px;color:var(--muted)"></span>
          </div>
          <pre id="pack-settings" style="font-size:12px;background:var(--bg);padding:10px;border-radius:8px;white-space:pre-wrap;max-height:320px;overflow:auto"></pre>
        </div>
      </div>
    </div>
  </div>
</div>
<script>
const SLUG=${SLUG};
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function apiErr(d,fallback){return (d&&d.message)||(d&&d.error)||fallback;}
let selectedImportId='';
var selectedImportLabel='';
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
var currentSeg='evidence';
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

function showSeg(which){
  currentSeg=which;
  document.getElementById('panel-evidence').style.display=which==='evidence'?'block':'none';
  document.getElementById('panel-broad').style.display=which==='broad'?'block':'none';
  document.getElementById('panel-top').style.display=which==='top'?'block':'none';
  document.getElementById('panel-sources').style.display=which==='sources'?'block':'none';
  document.getElementById('panel-pack').style.display=which==='pack'?'block':'none';
  document.getElementById('panel-profile').style.display=which==='profile'?'block':'none';
  var ids=[['seg-evidence','evidence'],['seg-broad','broad'],['seg-top','top'],['seg-sources','sources'],['seg-pack','pack'],['seg-profile','profile']];
  for(var i=0;i<ids.length;i++){
    var el=document.getElementById(ids[i][0]);
    if(!el)continue;
    el.className='btn btn-sm'+(which===ids[i][1]?'':' btn-ghost');
  }
  if(which==='broad')initBroadPanel();
  if(which==='top'){loadDeepImageTable();loadDeepCarouselTable();loadDeepVideoTable();}
  if(which==='profile'){loadProfile();loadAudit();}
  if(which==='pack'){loadProfile().then(renderPackSettings);}
  if(which==='sources'){initSourcesPanel();}
}

document.getElementById('seg-evidence')?.addEventListener('click',function(){showSeg('evidence');});
document.getElementById('seg-broad')?.addEventListener('click',function(){showSeg('broad');});
document.getElementById('seg-top')?.addEventListener('click',function(){showSeg('top');});
document.getElementById('seg-sources')?.addEventListener('click',function(){showSeg('sources');});
document.getElementById('seg-pack')?.addEventListener('click',function(){showSeg('pack');});
document.getElementById('seg-profile')?.addEventListener('click',function(){showSeg('profile');});

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
        try{
          var tr=btn.closest('tr');
          var tds=tr?tr.querySelectorAll('td'):null;
          selectedImportLabel=(tds&&tds.length>=2)?String(tds[1].textContent||'').trim():'';
        }catch(e){selectedImportLabel='';}
        setImportInUrl(selectedImportId);
        wb.style.display='block';
        loadImportStats();
        loadPrellmKindsAndPreview();
        showSeg(currentSeg);
        loadImports();
      });
    });
    if(selectedImportId){
      wb.style.display='block';
      loadImportStats();
      loadPrellmKindsAndPreview();
      showSeg(currentSeg);
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
    var h='';
    for(var i=0;i<prellmKinds.length;i++){
      var k=prellmKinds[i];
      h+='<button type="button" class="'+(k===prellmKind?'btn btn-sm':'btn-ghost btn-sm')+' prellm-kind" data-kind="'+esc(k)+'">'+
        esc(kindLabel(k,'evidence'))+' <span style="color:var(--muted)">('+String(bk[k]||0)+')</span></button>';
    }
    bar.innerHTML=h;
    bar.querySelectorAll('.prellm-kind').forEach(function(btn){
      btn.addEventListener('click',function(){
        prellmKind=btn.getAttribute('data-kind')||'';
        syncPrellmSliderFromKind();
        renderPrellmFormulaEditor();
        loadPrellmKindsAndPreview();
      });
    });
    syncPrellmSliderFromKind();
    await renderPrellmFormulaEditor();
    schedulePrellmPreview();
    syncBroadKindsFromStats(bk);
  }catch(e){bar.innerHTML='<span style="color:var(--red)">'+esc(e.message||e)+'</span>';}
}

function syncPrellmSliderFromKind(){
  var minEl=document.getElementById('prellm-min-score');
  var minVal=document.getElementById('prellm-min-val');
  if(!minEl||!prellmKind)return;
  var v=prellmMinByKind[prellmKind];
  if(typeof v!=='number'){
    // Default to 0.35 (useful for top-performer actions) but keep it per-kind once changed.
    v=parseFloat(minEl.value||'0.35');
    if(!Number.isFinite(v))v=0.35;
    prellmMinByKind[prellmKind]=v;
  }
  minEl.value=String(v);
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
  var minVal=document.getElementById('prellm-min-val');
  var showBelow=document.getElementById('prellm-show-below');
  var sortEl=document.getElementById('prellm-sort');
  if(!SLUG||!selectedImportId||!prellmKind||!counts||!wrap||!minEl||!sortEl)return;
  var minScore=parseFloat(minEl.value)||0;
  prellmMinByKind[prellmKind]=minScore;
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
    var t=d.totals||{};
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
document.getElementById('prellm-min-score')?.addEventListener('input',schedulePrellmPreview);
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
  var wrap=document.getElementById('broad-table-wrap');
  if(!SLUG||!selectedImportId||!broadKind||!meta||!wrap)return;
  meta.textContent='Loading…';
  wrap.innerHTML='';
  try{
    var q='tier=broad_llm&evidence_kind='+encodeURIComponent(broadKind)+'&limit=80&offset=0';
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/evidence-insights?'+q);
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    meta.textContent=JSON.stringify({
      project_slug:SLUG,
      inputs_import_id:selectedImportId,
      upload_filename:selectedImportLabel||null,
      evidence_kind:broadKind,
      counts_this_tab:d.counts,
      counts_whole_import:d.counts_import||d.counts
    },null,2);
    var rows=d.insights||[];
    var nTab=(d.counts&&typeof d.counts.broad_llm==='number')?d.counts.broad_llm:0;
    if(rows.length===0){
      wrap.innerHTML='<div class="empty" style="padding:12px">No broad insights for <span class="mono">'+esc(broadKind)+'</span> yet ('+String(nTab)+' in DB for this kind on this import). If other tabs have rows but this one does not, run broad for this tab with <strong>Rescan</strong> and/or turn off <strong>Use cutoff</strong> so enough rows qualify. Import-wide total (all kinds) is in the JSON as <span class="mono">counts_whole_import.broad_llm</span>.</div>';
      return;
    }
    var tb='<table class="sp-modal-table"><thead><tr><th>Insight ID</th><th>Evidence row</th><th>Kind</th><th>Why it worked</th><th>Hook</th><th>Emotion</th></tr></thead><tbody>';
    for(var i=0;i<rows.length;i++){
      var x=rows[i];
      var insightId=String(x.insights_id||'');
      var rowId=String(x.source_evidence_row_id||'');
      tb+='<tr>'+
        '<td class="mono">'+esc(insightId)+'</td>'+
        '<td class="mono"><a href="#" class="broad-ev-link" data-row-id="'+esc(rowId)+'">'+esc(rowId)+'</a></td>'+
        '<td class="mono">'+esc(x.evidence_kind)+'</td>'+
        '<td style="max-width:360px;white-space:pre-wrap">'+esc(x.why_it_worked||'')+'</td>'+
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
  }catch(e){meta.textContent=String(e);}
}
document.getElementById('btn-reload-broad')?.addEventListener('click',loadBroadTable);
document.getElementById('broad-max-rows')?.addEventListener('input',scheduleBroadEligibilityEstimate);
document.getElementById('broad-rescan')?.addEventListener('change',scheduleBroadEligibilityEstimate);
document.getElementById('broad-use-cutoff')?.addEventListener('change',scheduleBroadEligibilityEstimate);

function renderInsightTable(rows,cols){
  if(!rows.length)return '<div class="empty" style="padding:12px">No rows.</div>';
  var tb='<table class="sp-modal-table"><thead><tr>';
  for(var c=0;c<cols.length;c++)tb+='<th>'+esc(cols[c].label)+'</th>';
  tb+='</tr></thead><tbody>';
  for(var i=0;i<rows.length;i++){
    var x=rows[i];
    tb+='<tr>';
    for(var j=0;j<cols.length;j++){
      var v=x[cols[j].key];
      tb+='<td style="max-width:420px;white-space:pre-wrap;word-break:break-word">'+esc(typeof v==='string'?v:JSON.stringify(v||''))+'</td>';
    }
    tb+='</tr>';
  }
  tb+='</tbody></table>';
  return tb;
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
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/evidence-insights?tier=top_performer_deep&limit=80&offset=0');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    el.innerHTML=renderInsightTable(d.insights||[],[
      {key:'evidence_kind',label:'Platform'},
      {key:'why_it_worked',label:'Why'},
      {key:'caption_style',label:'Caption style'},
      {key:'hook_text',label:'Hook'}
    ]);
  }catch(e){el.textContent=String(e);}
}

async function loadDeepVideoTable(){
  var el=document.getElementById('deep-video-table');
  if(!SLUG||!selectedImportId||!el)return;
  el.innerHTML='Loading…';
  try{
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/evidence-insights?tier=top_performer_video&limit=80&offset=0');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    el.innerHTML=renderInsightTable(d.insights||[],[
      {key:'evidence_kind',label:'Platform'},
      {key:'why_it_worked',label:'Why'},
      {key:'hook_text',label:'Hook visual'},
      {key:'hook_type',label:'Format'}
    ]);
  }catch(e){el.textContent=String(e);}
}

async function loadDeepCarouselTable(){
  var el=document.getElementById('deep-carousel-table');
  if(!SLUG||!selectedImportId||!el)return;
  el.innerHTML='Loading…';
  try{
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/evidence-insights?tier=top_performer_carousel&limit=80&offset=0');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    el.innerHTML=renderInsightTable(d.insights||[],[
      {key:'evidence_kind',label:'Platform'},
      {key:'why_it_worked',label:'Why'},
      {key:'hook_text',label:'Slide arc'},
      {key:'cta_type',label:'CTA clarity'}
    ]);
  }catch(e){el.textContent=String(e);}
}
document.getElementById('btn-reload-deep-image')?.addEventListener('click',loadDeepImageTable);
document.getElementById('btn-reload-deep-carousel')?.addEventListener('click',loadDeepCarouselTable);
document.getElementById('btn-reload-deep-video')?.addEventListener('click',loadDeepVideoTable);

document.getElementById('btn-build-pack')?.addEventListener('click',async function(){
  var msg=document.getElementById('build-msg');
  if(!SLUG||!selectedImportId){msg.textContent='Select an import first.';return;}
  msg.textContent='Working (OpenAI)…';
  try{
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/build-signal-pack',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    var raw=await r.text();
    var d;try{d=JSON.parse(raw);}catch{throw new Error(raw.slice(0,400));}
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    msg.innerHTML='Done. Signal pack <a class="btn-ghost btn-sm" href="/admin/signal-pack?project='+encodeURIComponent(SLUG)+'&id='+encodeURIComponent(d.signal_pack_id)+'">open</a> · insights pack <span class="mono">'+esc(d.insights_pack_id||'')+'</span> · ideas_json '+esc(String(d.ideas_count||0))+' (LLM context '+esc(String(d.ideas_llm_context_insights||0))+' insights, '+esc(String(d.ideas_llm_top_performer_rows_in_context||0))+' w/ top-performer) · overall_candidates_json '+esc(String(d.overall_candidates_count||0))+' · rated '+d.rows_rated+'/'+d.rows_considered_for_rating+' rows.';
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
showSeg('evidence');
if(SLUG)loadImports();
</script>`;
}
