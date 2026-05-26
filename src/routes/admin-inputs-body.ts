/** Inner HTML + script for GET /admin/inputs — uploads, source registry, Apify scrapers. */

import { adminCafTermHtml, adminOptionsLinkHtml, adminOptionsMenuHtml, adminPageHeaderHtml } from "./admin-ui-shared.js";

const SOURCE_TABS = [
  { id: "all_sources", label: "All Sources" },
  { id: "websites_blogs", label: "Websites + Blogs" },
  { id: "igaccounts", label: "IG Accounts" },
  { id: "tiktokaccounts", label: "TikTok Accounts" },
  { id: "subreddits", label: "SubReddits" },
  { id: "facebook", label: "Facebook" },
  { id: "hashtags", label: "Hashtags" },
] as const;

const CFG_SECTIONS: Array<{ id: string; title: string }> = [
  { id: "instagram", title: "Instagram · apify/instagram-scraper" },
  { id: "tiktok", title: "TikTok · clockworks/tiktok-scraper" },
  { id: "reddit", title: "Reddit · trudax/reddit-scraper-lite" },
  { id: "facebook", title: "Facebook · apify/facebook-posts-scraper" },
  { id: "html", title: "HTML / blogs (HTTP, no Apify)" },
];

function scraperConfigFormHtml(): string {
  const sections = CFG_SECTIONS.map((sec) => {
    return `<details class="scraper-cfg-section" open><summary>${sec.title}</summary><div class="scraper-cfg-grid scraper-cfg-grid--wide"><textarea id="cfg-json-${sec.id}" rows="18" class="mono" style="width:100%;min-height:200px;font-size:12px;line-height:1.5;padding:12px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);resize:vertical;tab-size:2" spellcheck="false"></textarea></div></details>`;
  }).join("");
  return sections;
}

const SCRAPERS = [
  { key: "instagram", label: "Instagram", sourceTab: "igaccounts", actor: "apify/instagram-scraper" },
  { key: "tiktok", label: "TikTok", sourceTab: "tiktokaccounts", actor: "clockworks/tiktok-scraper" },
  { key: "html", label: "HTML / Blogs", sourceTab: "websites_blogs", actor: "HTTP (no Apify)" },
  { key: "facebook", label: "Facebook", sourceTab: "facebook", actor: "apify/facebook-posts-scraper" },
  { key: "reddit", label: "Reddit", sourceTab: "subreddits", actor: "trudax/reddit-scraper-lite" },
] as const;

export function adminInputsBody(currentSlug: string): string {
  const SLUG = JSON.stringify(currentSlug);
  const pq = currentSlug ? `?project=${encodeURIComponent(currentSlug)}` : "";
  const optionsMenu = adminOptionsMenuHtml(
    adminOptionsLinkHtml("Open Processing", `/admin/processing${pq}`),
    "Options"
  );
  const sourceTabOptions = SOURCE_TABS.map(
    (t) => `<option value="${t.id}">${t.label}</option>`
  ).join("");
  const scraperCards = SCRAPERS.map(
    (s) =>
      `<div class="tp-pass-card"><div class="tp-pass-head"><strong>${s.label}</strong><span class="mono" style="font-size:10px;color:var(--muted)">${s.actor}</span></div><p style="font-size:11px;color:var(--muted);margin:0 0 8px">Sources: <span class="mono">${s.sourceTab}</span></p><button type="button" class="btn btn-sm tp-pass-run btn-run-scraper" data-scraper="${s.key}">Run ${s.label}</button><div class="tp-pass-status" id="scraper-status-${s.key}"></div></div>`
  ).join("");

  return `
${adminPageHeaderHtml(adminCafTermHtml("inputs", "Inputs & imports"), "evidence", currentSlug, { actionsHtml: optionsMenu })}
<div class="content">
  <div class="caf-stepper" id="inputs-tabs" role="tablist">
    <button type="button" class="caf-step-pill active" data-inputs-tab="imports">Imports</button>
    <button type="button" class="caf-step-pill" data-inputs-tab="sources">Sources</button>
    <button type="button" class="caf-step-pill" data-inputs-tab="scrapers">Scrapers</button>
  </div>

  <div id="inputs-panel-imports" class="inputs-tab-panel">
    <div class="card" style="margin-bottom:14px">
      <div style="padding:12px 16px 16px">
        <div class="caf-toolbar">
          <label class="btn btn-sm" style="position:relative;overflow:hidden;cursor:pointer;margin:0;display:inline-flex;align-items:center">
            Upload evidence .xlsx
            <input type="file" id="inputs-xlsx-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;font-size:0" title="Full INPUTS workbook → evidence import" />
          </label>
          <button type="button" class="btn btn-sm" id="btn-reload-imports">Reload</button>
          <span id="upload-busy" style="display:none;font-size:12px;color:var(--muted)">Uploading…</span>
          <span id="upload-msg" style="font-size:12px;color:var(--muted);max-width:420px"></span>
          <span id="imports-hint" class="caf-stat-chips"></span>
        </div>
        <p class="runs-ops-hint" style="margin:0 0 10px"><span data-caf-term="inputs">Upload still works exactly as before</span> — full workbook → <span class="mono">inputs_evidence_imports</span>. Use <strong>Sources</strong> to manage accounts/hashtags separately, then <strong>Scrapers</strong> to collect into a new import.</p>
        <div id="imports-root" class="empty">Loading…</div>
      </div>
    </div>
  </div>

  <div id="inputs-panel-sources" class="inputs-tab-panel" style="display:none">
    <div class="prellm-split-layout">
      <aside class="prellm-sidebar" aria-label="Source tabs">
        <div class="prellm-sidebar-card">
          <div style="font-size:12px;font-weight:600;margin-bottom:8px">Source sheet</div>
          <select id="source-tab-sel" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--fg)">
            ${sourceTabOptions}
          </select>
          <p style="font-size:11px;color:var(--muted);margin:10px 0 0">Mirrors Google Sheets tabs (IGAccounts, TikTokAccounts, …). Pick a tab to view or edit rows.</p>
        </div>
        <div class="prellm-sidebar-card">
          <div style="font-size:12px;font-weight:600;margin-bottom:8px">Sync from workbook</div>
          <label class="btn btn-sm" style="position:relative;overflow:hidden;cursor:pointer;margin:0 0 8px;display:inline-flex;width:100%;justify-content:center">
            Import source tabs only
            <input type="file" id="sources-sync-file" accept=".xlsx" style="position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;font-size:0" />
          </label>
          <p style="font-size:11px;color:var(--muted);margin:0">Updates <strong>Sources</strong> registry only — does not replace evidence upload.</p>
          <span id="sources-sync-msg" style="font-size:11px;display:block;margin-top:6px"></span>
        </div>
      </aside>
      <div class="prellm-main">
        <div class="card">
          <div style="padding:12px 16px 16px">
            <div class="caf-toolbar">
              <button type="button" class="btn btn-sm" id="btn-reload-sources">Reload</button>
              <button type="button" class="btn-ghost btn-sm" id="btn-add-source-row">+ Row</button>
              <span id="sources-hint" class="caf-stat-chips"></span>
            </div>
            <div id="sources-root" class="empty">Select a project and source tab.</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div id="inputs-panel-scrapers" class="inputs-tab-panel" style="display:none">
    <div class="tp-split-layout">
      <aside class="tp-sidebar" aria-label="Scraper config">
        <div class="tp-sidebar-card">
          <div style="font-size:12px;font-weight:600;margin-bottom:8px">Apify status</div>
          <div id="apify-status" style="font-size:12px;color:var(--muted)">Checking…</div>
          <p style="font-size:11px;color:var(--muted);margin:8px 0 0">Set <span class="mono">APIFY_API_TOKEN</span> in Core env (same account as n8n). HTML scraper uses HTTP only.</p>
        </div>
        <div class="tp-sidebar-card">
          <div style="font-size:12px;font-weight:600;margin-bottom:8px">Run all</div>
          <button type="button" class="btn btn-sm" id="btn-run-all-scrapers" style="width:100%">Run all enabled scrapers</button>
          <p style="font-size:11px;color:var(--muted);margin:8px 0 0">Creates one evidence import with all output sheets (InstagramPostData, Tiktok_Videos, …).</p>
        </div>
        <div class="tp-sidebar-card">
          <button type="button" class="btn btn-sm" id="btn-save-scraper-config" style="width:100%">Save all scraper config</button>
          <button type="button" class="btn-ghost btn-sm" id="btn-reset-scraper-config" style="width:100%;margin-top:6px">Reset to defaults</button>
          <span id="scraper-config-msg" style="font-size:11px;display:block;margin-top:8px"></span>
        </div>
      </aside>
      <div class="tp-main">
        <div class="card" style="margin-bottom:14px">
          <div class="card-h">Apify actor options <span style="font-weight:400;color:var(--muted);font-size:11px">— paste the same JSON you'd use on Apify actor input</span></div>
          <div style="padding:12px 16px" id="scraper-config-form">${scraperConfigFormHtml()}</div>
        </div>
        <div class="card" style="margin-bottom:14px">
          <div class="card-h">Run scrapers</div>
          <div style="padding:12px 16px">${scraperCards}</div>
        </div>
        <div class="card">
          <div class="card-h">Run history</div>
          <div style="padding:12px 16px">
            <button type="button" class="btn-ghost btn-sm" id="btn-reload-scraper-runs">Reload</button>
            <div id="scraper-runs-root" class="empty" style="margin-top:10px">—</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
<script>
const SLUG=${SLUG};
const SOURCE_TABS=${JSON.stringify(SOURCE_TABS)};
const CFG_SECTIONS=${JSON.stringify(CFG_SECTIONS.map((s) => s.id))};
var scraperCfgCache=null;

var DEFAULT_ACTOR_JSON={
  instagram: ${JSON.stringify({
    directUrls: [],
    resultsType: "posts",
    resultsLimit: 10,
    scrapePosts: true,
    scrapeReels: true,
    scrapeStories: false,
    proxyConfiguration: { useApifyProxy: true },
    searchType: "hashtag",
    addParentData: false,
  }, null, 2)},
  tiktok: ${JSON.stringify({
    commentsPerPost: 0,
    excludePinnedPosts: false,
    maxFollowersPerProfile: 0,
    maxFollowingPerProfile: 0,
    maxRepliesPerComment: 0,
    oldestPostDateUnified: "7 days",
    profileScrapeSections: ["videos"],
    profileSorting: "latest",
    profiles: [],
    proxyCountryCode: "US",
    resultsPerPage: 10,
    scrapeRelatedVideos: false,
    shouldDownloadAvatars: false,
    shouldDownloadCovers: true,
    shouldDownloadMusicCovers: false,
    shouldDownloadSlideshowImages: true,
    shouldDownloadVideos: true,
    videoKvStoreIdOrName: "caf-tiktok-astrology-media",
    downloadSubtitlesOptions: "DOWNLOAD_AND_TRANSCRIBE_VIDEOS_WITHOUT_SUBTITLES",
    searchSection: "",
    maxProfilesPerQuery: 10,
  }, null, 2)},
  reddit: ${JSON.stringify({
    startUrls: [],
    searchPosts: true,
    searchComments: true,
    searchCommunities: false,
    searchUsers: false,
    maxPostCount: 30,
    maxComments: 3,
    maxItems: 40,
    commentSort: "top",
    scrollTimeout: 60,
    proxy: { useApifyProxy: true },
  }, null, 2)},
  facebook: ${JSON.stringify({
    startUrls: [],
    resultsLimit: 30,
    proxyConfiguration: { useApifyProxy: true },
  }, null, 2)},
  html: ${JSON.stringify({
    enabled: true,
    fetchTimeoutMs: 30000,
    userAgent: "Mozilla/5.0 (compatible; CAF-Core/1.0; +https://caf.local)",
    minParagraphChars: 30,
    maxMainTextChars: 30000,
  }, null, 2)}
};

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function apiErr(d,fallback){return (d&&d.message)||(d&&d.error)||fallback;}
function processingHref(importId){
  var q=new URLSearchParams(window.location.search);
  if(SLUG)q.set('project',SLUG);else q.delete('project');
  if(importId)q.set('import',importId);else q.delete('import');
  return '/admin/processing'+(q.toString()?'?'+q.toString():'');
}
function showInputsTab(tab){
  document.querySelectorAll('[data-inputs-tab]').forEach(function(el){
    el.classList.toggle('active',el.getAttribute('data-inputs-tab')===tab);
  });
  ['imports','sources','scrapers'].forEach(function(t){
    var p=document.getElementById('inputs-panel-'+t);
    if(p)p.style.display=t===tab?'block':'none';
  });
  if(tab==='sources'&&SLUG)loadSources();
  if(tab==='scrapers'&&SLUG){loadScraperMeta();loadScraperRuns();}
}
document.querySelectorAll('[data-inputs-tab]').forEach(function(btn){
  btn.addEventListener('click',function(){showInputsTab(btn.getAttribute('data-inputs-tab'));});
});

async function loadImports(){
  var root=document.getElementById('imports-root');
  var hint=document.getElementById('imports-hint');
  if(!SLUG){root.innerHTML='<div class="empty">Select a project in the sidebar.</div>';return;}
  root.innerHTML='Loading…';
  try{
    var r=await cafFetch('/v1/inputs-evidence/'+encodeURIComponent(SLUG));
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var rows=d.imports||[];
    if(rows.length===0){root.innerHTML='<div class="empty">No evidence imports for this project.</div>';hint.textContent='';return;}
    var tb='<table class="sp-modal-table caf-table-compact"><thead><tr><th>Created</th><th>File</th><th>Rows</th><th></th></tr></thead><tbody>';
    for(var i=0;i<rows.length;i++){
      var x=rows[i];
      var phref=processingHref(x.id);
      var src=(x.sheet_stats_json&&x.sheet_stats_json.source==='scraper')?' <span class="tag tag-blue">scraper</span>':'';
      tb+='<tr><td>'+esc(String(x.created_at||'').slice(0,19))+'</td><td>'+esc(x.upload_filename||'—')+src+'</td><td>'+esc(x.stored_row_count)+'</td><td><a class="btn btn-sm" href="'+esc(phref)+'">Process</a></td></tr>';
    }
    tb+='</tbody></table>';
    root.innerHTML=tb;
    hint.textContent=rows.length+' import(s)';
  }catch(e){root.innerHTML='<div class="empty" style="color:var(--red)">'+esc(e.message||e)+'</div>';}
}

async function loadSources(){
  var root=document.getElementById('sources-root');
  var hint=document.getElementById('sources-hint');
  var tab=document.getElementById('source-tab-sel')?.value||'igaccounts';
  if(!SLUG){root.innerHTML='<div class="empty">Select a project.</div>';return;}
  root.innerHTML='Loading…';
  try{
    var r=await cafFetch('/v1/inputs-sources/'+encodeURIComponent(SLUG)+'/rows?tab='+encodeURIComponent(tab));
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var rows=d.rows||[];
    hint.textContent=rows.length+' row(s) · '+tab;
    if(rows.length===0){root.innerHTML='<div class="empty">No rows — sync from workbook or add a row.</div>';return;}
    var cols=new Set(['Name','Link','Platform','Enabled']);
    rows.forEach(function(x){
      Object.keys(x.payload_json||{}).forEach(function(k){cols.add(k);});
    });
    var colArr=Array.from(cols).slice(0,8);
    var tb='<div style="overflow:auto"><table class="sp-modal-table caf-table-compact"><thead><tr><th>#</th><th>On</th>';
    colArr.forEach(function(c){tb+='<th>'+esc(c)+'</th>';});
    tb+='</tr></thead><tbody>';
    rows.forEach(function(x){
      var p=x.payload_json||{};
      tb+='<tr><td>'+esc(x.row_index)+'</td><td>'+(x.enabled?'yes':'no')+'</td>';
      colArr.forEach(function(c){tb+='<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis">'+esc(p[c])+'</td>';});
      tb+='</tr>';
    });
    tb+='</tbody></table></div>';
    root.innerHTML=tb;
  }catch(e){root.innerHTML='<div class="empty" style="color:var(--red)">'+esc(e.message||e)+'</div>';}
}

function populateScraperForm(cfg){
  scraperCfgCache=cfg||{};
  var extras=cfg.actorInputExtras||{};
  CFG_SECTIONS.forEach(function(sec){
    var ta=document.getElementById('cfg-json-'+sec);
    if(!ta)return;
    var json=extras[sec];
    if(json&&typeof json==='object'&&Object.keys(json).length>0){
      ta.value=JSON.stringify(json,null,2);
    }else{
      ta.value=DEFAULT_ACTOR_JSON[sec]||'{}';
    }
  });
}
function gatherScraperForm(){
  var cfg=scraperCfgCache?JSON.parse(JSON.stringify(scraperCfgCache)):{apify:{},scrapers:{},actorInputExtras:{}};
  if(!cfg.actorInputExtras)cfg.actorInputExtras={};
  CFG_SECTIONS.forEach(function(sec){
    var ta=document.getElementById('cfg-json-'+sec);
    if(!ta)return;
    var raw=String(ta.value||'').trim();
    if(!raw||raw==='{}'){delete cfg.actorInputExtras[sec];return;}
    try{cfg.actorInputExtras[sec]=JSON.parse(raw);}catch(e){throw new Error('Invalid JSON in '+sec+': '+String(e.message||e));}
  });
  return cfg;
}

async function loadScraperMeta(){
  var el=document.getElementById('apify-status');
  if(!SLUG||!el)return;
  try{
    var r=await cafFetch('/v1/inputs-sources/'+encodeURIComponent(SLUG)+'/scraper-config');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    el.innerHTML=d.apify_configured?'<span style="color:var(--green)">Apify token configured</span>':'<span style="color:var(--yellow)">APIFY_API_TOKEN not set on Core</span>';
    populateScraperForm(d.config||{});
  }catch(e){el.textContent=String(e.message||e);}
}

async function saveScraperConfig(){
  var msg=document.getElementById('scraper-config-msg');
  if(!SLUG)return;
  try{
    var cfg=gatherScraperForm();
    var r=await cafFetch('/v1/inputs-sources/'+encodeURIComponent(SLUG)+'/scraper-config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:cfg})});
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    scraperCfgCache=cfg;
    if(msg){msg.style.color='var(--green)';msg.textContent='Saved';}
  }catch(e){if(msg){msg.style.color='var(--red)';msg.textContent=String(e.message||e);}}
}

async function resetScraperConfig(){
  if(!SLUG)return;
  if(!confirm('Reset all scraper options to CAF defaults?'))return;
  try{
    CFG_SECTIONS.forEach(function(sec){
      var ta=document.getElementById('cfg-json-'+sec);
      if(ta)ta.value=DEFAULT_ACTOR_JSON[sec]||'{}';
    });
    await saveScraperConfig();
  }catch(e){alert(String(e.message||e));}
}

async function runScraper(key){
  if(!SLUG){alert('Select a project first.');return;}
  var st=document.getElementById('scraper-status-'+key);
  if(st){st.textContent='Running… (Apify may take several minutes)';st.className='tp-pass-status is-run';}
  try{
    var r=await cafFetch('/v1/inputs-sources/'+encodeURIComponent(SLUG)+'/run-scraper',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scraper:key})});
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    if(st){
      st.innerHTML='Done: '+esc(String(d.total_rows))+' rows · <a href="'+esc(processingHref(d.evidence_import_id))+'">Process</a>';
      st.className='tp-pass-status';
    }
    await loadImports();
    await loadScraperRuns();
  }catch(e){
    if(st){st.textContent=String(e.message||e);st.className='tp-pass-status is-err';}
  }
}

async function loadScraperRuns(){
  var root=document.getElementById('scraper-runs-root');
  if(!SLUG||!root)return;
  try{
    var r=await cafFetch('/v1/inputs-sources/'+encodeURIComponent(SLUG)+'/scraper-runs?limit=20');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var rows=d.runs||[];
    if(rows.length===0){root.innerHTML='<div class="empty">No scraper runs yet.</div>';return;}
    var tb='<table class="sp-modal-table caf-table-compact"><thead><tr><th>When</th><th>Scraper</th><th>Status</th><th>Rows</th><th></th></tr></thead><tbody>';
    rows.forEach(function(x){
      var stats=x.stats_json||{};
      var n=stats.total_rows!=null?stats.total_rows:'—';
      var link=x.evidence_import_id?'<a class="btn-ghost btn-sm" href="'+esc(processingHref(x.evidence_import_id))+'">Process</a>':'';
      tb+='<tr><td>'+esc(String(x.created_at||'').slice(0,19))+'</td><td>'+esc(x.scraper_key)+'</td><td>'+esc(x.status)+'</td><td>'+esc(n)+'</td><td>'+link+'</td></tr>';
    });
    tb+='</tbody></table>';
    root.innerHTML=tb;
  }catch(e){root.innerHTML='<div class="empty" style="color:var(--red)">'+esc(e.message||e)+'</div>';}
}

document.getElementById('btn-reload-imports')?.addEventListener('click',loadImports);
document.getElementById('btn-reload-sources')?.addEventListener('click',loadSources);
document.getElementById('source-tab-sel')?.addEventListener('change',loadSources);
document.getElementById('btn-reload-scraper-runs')?.addEventListener('click',loadScraperRuns);
document.getElementById('btn-save-scraper-config')?.addEventListener('click',saveScraperConfig);
document.getElementById('btn-reset-scraper-config')?.addEventListener('click',resetScraperConfig);
document.getElementById('btn-run-all-scrapers')?.addEventListener('click',function(){runScraper('all');});
document.querySelectorAll('.btn-run-scraper').forEach(function(btn){
  btn.addEventListener('click',function(){runScraper(btn.getAttribute('data-scraper'));});
});

document.getElementById('inputs-xlsx-file')?.addEventListener('change',async function(ev){
  var input=ev.target;var file=input&&input.files&&input.files[0];
  if(input)input.value='';if(!file)return;
  if(!SLUG){alert('Select a project in the sidebar first.');return;}
  var busy=document.getElementById('upload-busy');var msg=document.getElementById('upload-msg');
  if(busy)busy.style.display='inline';if(msg){msg.textContent='';msg.style.color='';}
  try{
    var fd=new FormData();fd.append('file',file);fd.append('project_slug',SLUG);
    var r=await cafFetch('/v1/inputs-evidence/upload',{method:'POST',body:fd});
    var raw=await r.text();var d;try{d=JSON.parse(raw);}catch{throw new Error(raw.slice(0,400));}
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    if(msg){msg.style.color='var(--green)';msg.textContent='Imported '+String(d.total_rows||0)+' rows';}
    await loadImports();
  }catch(e){if(msg){msg.style.color='var(--red)';msg.textContent=String(e.message||e);}}
  finally{if(busy)busy.style.display='none';}
});

document.getElementById('sources-sync-file')?.addEventListener('change',async function(ev){
  var input=ev.target;var file=input&&input.files&&input.files[0];
  if(input)input.value='';if(!file)return;
  if(!SLUG){alert('Select a project first.');return;}
  var msg=document.getElementById('sources-sync-msg');
  if(msg){msg.textContent='Syncing…';msg.style.color='';}
  try{
    var fd=new FormData();fd.append('file',file);
    var r=await cafFetch('/v1/inputs-sources/'+encodeURIComponent(SLUG)+'/sync-from-workbook',{method:'POST',body:fd});
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    if(msg){msg.style.color='var(--green)';msg.textContent='Synced '+String(d.total_rows||0)+' source rows';}
    await loadSources();
  }catch(e){if(msg){msg.style.color='var(--red)';msg.textContent=String(e.message||e);}}
});

document.getElementById('btn-add-source-row')?.addEventListener('click',async function(){
  if(!SLUG){alert('Select a project first.');return;}
  var tab=document.getElementById('source-tab-sel')?.value||'igaccounts';
  var name=prompt('Name / handle:');if(name==null)return;
  var link=prompt('Link (URL):')||'';
  try{
    var r0=await cafFetch('/v1/inputs-sources/'+encodeURIComponent(SLUG)+'/rows?tab='+encodeURIComponent(tab));
    var d0=await r0.json();
    var next=(d0.rows||[]).length;
    var rows=(d0.rows||[]).map(function(x){return {row_index:x.row_index,enabled:x.enabled,payload_json:x.payload_json};});
    rows.push({row_index:next,enabled:true,payload_json:{Name:name,Link:link,Platform:tab}});
    var r=await cafFetch('/v1/inputs-sources/'+encodeURIComponent(SLUG)+'/rows/'+encodeURIComponent(tab),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows:rows})});
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    await loadSources();
  }catch(e){alert(String(e.message||e));}
});

if(SLUG){loadImports();}
</script>`;
}
