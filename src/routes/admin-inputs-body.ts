/** Inner HTML + script for GET /admin/inputs — uploads, source registry, Apify scrapers. */

import { adminCafTermHtml, adminOptionsLinkHtml, adminOptionsMenuHtml, adminPageHeaderHtml } from "./admin-ui-shared.js";

const SOURCE_TABS = [
  { id: "all_sources", label: "All Sources" },
  { id: "websites_blogs", label: "Websites + Blogs" },
  { id: "igaccounts", label: "IG Accounts" },
  { id: "tiktokaccounts", label: "TikTok Accounts" },
  { id: "subreddits", label: "SubReddits" },
  { id: "facebook", label: "Facebook" },
  { id: "linkedinaccounts", label: "LinkedIn Accounts" },
  { id: "linkedinsearches", label: "LinkedIn Searches" },
  { id: "linkedinkeywords", label: "LinkedIn Keywords" },
  { id: "hashtags", label: "Hashtags" },
] as const;

const CFG_SECTIONS: Array<{ id: string; title: string }> = [
  { id: "instagram", title: "Instagram · apify/instagram-scraper" },
  { id: "tiktok", title: "TikTok · clockworks/tiktok-scraper" },
  { id: "reddit", title: "Reddit · trudax/reddit-scraper-lite" },
  { id: "facebook", title: "Facebook · apify/facebook-posts-scraper" },
  { id: "linkedin", title: "LinkedIn · harvestapi/profile-posts + profile-search" },
  { id: "html", title: "HTML / blogs (HTTP, no Apify)" },
];

/** Pretty JSON strings for Apify actor input (must stay strings — never assign raw objects to textarea.value). */
const DEFAULT_ACTOR_JSON: Record<string, string> = {
  instagram: JSON.stringify(
    {
      directUrls: [],
      resultsType: "posts",
      resultsLimit: 10,
      scrapePosts: true,
      scrapeReels: true,
      scrapeStories: false,
      proxyConfiguration: { useApifyProxy: true },
      searchType: "hashtag",
      addParentData: false,
    },
    null,
    2
  ),
  tiktok: JSON.stringify(
    {
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
    },
    null,
    2
  ),
  reddit: JSON.stringify(
    {
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
    },
    null,
    2
  ),
  facebook: JSON.stringify(
    {
      startUrls: [],
      resultsLimit: 30,
      proxyConfiguration: { useApifyProxy: true },
    },
    null,
    2
  ),
  html: JSON.stringify(
    {
      enabled: true,
      fetchTimeoutMs: 30000,
      userAgent: "Mozilla/5.0 (compatible; CAF-Core/1.0; +https://caf.local)",
      minParagraphChars: 30,
      maxMainTextChars: 30000,
    },
    null,
    2
  ),
  linkedin: JSON.stringify(
    {
      targetUrls: [],
      maxPosts: 20,
      postedLimit: "month",
      searchQuery: "content marketing director",
      maxItems: 20,
    },
    null,
    2
  ),
};

function escTextareaContent(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

const SCRAPERS = [
  { key: "instagram", label: "Instagram", sourceTab: "igaccounts", actor: "apify/instagram-scraper" },
  { key: "tiktok", label: "TikTok", sourceTab: "tiktokaccounts", actor: "clockworks/tiktok-scraper" },
  { key: "html", label: "HTML / Blogs", sourceTab: "websites_blogs", actor: "HTTP (no Apify)" },
  { key: "facebook", label: "Facebook", sourceTab: "facebook", actor: "apify/facebook-posts-scraper" },
  { key: "reddit", label: "Reddit", sourceTab: "subreddits", actor: "trudax/reddit-scraper-lite" },
  {
    key: "linkedin",
    label: "LinkedIn",
    sourceTab: "linkedinaccounts",
    actor: "harvestapi/linkedin-profile-posts + linkedin-profile-search",
  },
] as const;

const SCRAPER_LABEL: Record<string, string> = Object.fromEntries(SCRAPERS.map((s) => [s.key, s.label]));

function scraperConfigFormHtml(): string {
  const sections = CFG_SECTIONS.map((sec) => {
    const initial = escTextareaContent(DEFAULT_ACTOR_JSON[sec.id] ?? "{}");
    const runLabel = SCRAPER_LABEL[sec.id] ?? sec.id;
    return `<details class="scraper-cfg-section" open><summary class="scraper-cfg-summary"><span>${sec.title}</span><span class="scraper-cfg-run-wrap"><button type="button" class="btn btn-sm btn-run-scraper" data-scraper="${sec.id}">Run ${runLabel}</button></span></summary><div class="scraper-cfg-grid scraper-cfg-grid--wide"><textarea id="cfg-json-${sec.id}" rows="18" class="mono scraper-cfg-json" spellcheck="false">${initial}</textarea><div class="tp-pass-status" id="scraper-status-${sec.id}"></div></div></details>`;
  }).join("");
  return sections;
}

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

  return `
<style>
.scraper-inspect-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2000;align-items:center;justify-content:center;padding:24px}
.scraper-inspect-overlay.open{display:flex}
.scraper-inspect-card{max-width:1100px;max-height:90vh;overflow:auto;width:100%;position:relative}
.scraper-inspect-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px}
.scraper-inspect-rows-wrap{overflow:auto;max-height:52vh}
.scraper-inspect-row{cursor:pointer}
.scraper-inspect-row.is-selected{background:var(--blue-bg)!important}
</style>
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
          <div style="font-size:12px;font-weight:600;margin-bottom:8px">Source cap</div>
          <label class="scraper-cap-field" for="scraper-max-sources">Max accounts / sources per scraper</label>
          <input type="number" id="scraper-max-sources" min="1" max="500" step="1" placeholder="All enabled" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--fg);margin:6px 0 8px" />
          <p style="font-size:11px;color:var(--muted);margin:0 0 8px">Leave empty to scrape every enabled row in Sources. Applies to each <strong>Run</strong> button and <strong>Run all</strong>.</p>
          <div class="scraper-estimate-actions">
            <select id="scraper-estimate-key" style="flex:1;min-width:0;padding:7px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--fg)">
              <option value="all">All scrapers</option>
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
              <option value="reddit">Reddit</option>
              <option value="facebook">Facebook</option>
              <option value="html">HTML / Blogs</option>
            </select>
            <button type="button" class="btn btn-sm" id="btn-estimate-scraper">Estimate cost</button>
          </div>
          <div id="scraper-estimate-out" class="scraper-estimate-out"></div>
        </div>
        <div class="tp-sidebar-card">
          <div style="font-size:12px;font-weight:600;margin-bottom:8px">Run all</div>
          <button type="button" class="btn btn-sm" id="btn-run-all-scrapers" style="width:100%">Run all enabled scrapers</button>
          <button type="button" class="btn btn-sm btn-danger" id="btn-abort-scraper" style="width:100%;margin-top:8px;display:none">Abort running scraper</button>
          <div class="tp-pass-status" id="scraper-status-all" style="margin-top:8px"></div>
          <p style="font-size:11px;color:var(--muted);margin:8px 0 0">Creates one evidence import with all output sheets (InstagramPostData, Tiktok_Videos, …).</p>
        </div>
        <div class="tp-sidebar-card">
          <div style="font-size:12px;font-weight:600;margin-bottom:8px">Recover Apify run</div>
          <p style="font-size:11px;color:var(--muted);margin:0 0 8px">Import a finished Apify dataset without re-scraping. Paste the run ID from <a href="https://console.apify.com/actors/runs" target="_blank" rel="noopener noreferrer">Apify console</a> (profile-posts actor for LinkedIn).</p>
          <label class="scraper-cap-field" for="recover-apify-scraper">Platform</label>
          <select id="recover-apify-scraper" style="width:100%;padding:7px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--fg);margin:0 0 8px">
            <option value="linkedin">LinkedIn</option>
            <option value="instagram">Instagram</option>
            <option value="tiktok">TikTok</option>
            <option value="reddit">Reddit</option>
            <option value="facebook">Facebook</option>
          </select>
          <label class="scraper-cap-field" for="recover-apify-run-ids">Apify run ID(s)</label>
          <input type="text" id="recover-apify-run-ids" placeholder="e.g. abc123XYZ (comma-separated)" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--fg);margin:0 0 8px" />
          <button type="button" class="btn btn-sm" id="btn-recover-apify-import" style="width:100%">Recover import</button>
          <div class="tp-pass-status" id="recover-apify-status" style="margin-top:8px"></div>
        </div>
      </aside>
      <div class="tp-main">
        <div class="card" style="margin-bottom:14px">
          <div class="card-h scraper-cfg-head">
            <span>Apify actor options <span class="scraper-cfg-head-hint">— paste the same JSON you'd use on Apify actor input</span></span>
            <div class="scraper-cfg-actions">
              <button type="button" class="btn btn-sm" id="btn-save-scraper-config">Save all</button>
              <button type="button" class="btn-ghost btn-sm" id="btn-reset-scraper-config">Reset to defaults</button>
              <span id="scraper-config-msg" class="scraper-cfg-msg"></span>
            </div>
          </div>
          <div style="padding:12px 16px" id="scraper-config-form">${scraperConfigFormHtml()}</div>
        </div>
        <div class="card" style="margin-bottom:14px">
          <div class="card-h scraper-cfg-head">
            <span>Evidence pack</span>
            <div class="scraper-cfg-actions">
              <button type="button" class="btn btn-sm" id="btn-build-evidence-pack">Build import</button>
              <button type="button" class="btn-ghost btn-sm" id="btn-reload-evidence-packs">Reload</button>
            </div>
          </div>
          <div style="padding:12px 16px">
            <p class="runs-ops-hint" style="margin:0 0 10px">Pick <strong>one completed scraper run per platform</strong>. Build merges them into a single <span class="mono">inputs_evidence_import</span> — same sheets/rows as an XLSX upload. Use that import in <strong>Processing</strong>.</p>
            <label class="scraper-cap-field" for="evidence-pack-label">Pack label (optional)</label>
            <input type="text" id="evidence-pack-label" placeholder="evidence-pack-2026-06-03" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--fg);margin:0 0 10px" />
            <div id="evidence-pack-slots" class="empty">Loading run options…</div>
            <div class="tp-pass-status" id="evidence-pack-status" style="margin-top:8px"></div>
            <div id="evidence-packs-root" style="margin-top:14px"></div>
          </div>
        </div>
        <div class="card">
          <div class="card-h scraper-cfg-head">
            <span>Run history</span>
            <div class="scraper-cfg-actions">
              <a class="btn-ghost btn-sm" href="https://console.apify.com/actors/runs" target="_blank" rel="noopener noreferrer">Apify console ↗</a>
              <button type="button" class="btn-ghost btn-sm" id="btn-reload-scraper-runs">Reload</button>
            </div>
          </div>
          <div style="padding:12px 16px">
            <div id="scraper-runs-root" class="empty">—</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
<div id="scraper-inspect-modal" class="scraper-inspect-overlay" onclick="if(event.target===this)closeScraperInspect()">
  <div class="card scraper-inspect-card" onclick="event.stopPropagation()">
    <div class="card-h" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <span id="scraper-inspect-title">Scraped results</span>
      <div style="display:flex;gap:8px;align-items:center">
        <a id="scraper-inspect-process" class="btn btn-sm" href="#" style="display:none">Process</a>
        <button type="button" class="btn-ghost btn-sm" onclick="closeScraperInspect()">Close</button>
      </div>
    </div>
    <div style="padding:12px 16px 16px">
      <div id="scraper-inspect-meta" class="runs-ops-hint" style="margin:0 0 10px">—</div>
      <div class="scraper-inspect-toolbar">
        <label style="font-size:12px;color:var(--muted)">Sheet</label>
        <select id="scraper-inspect-sheet" style="width:auto;min-width:180px;padding:6px 10px"></select>
        <span id="scraper-inspect-sheet-count" style="font-size:12px;color:var(--muted)"></span>
      </div>
      <div id="scraper-inspect-rows" class="scraper-inspect-rows-wrap empty">Loading…</div>
      <details id="scraper-inspect-json-wrap" style="margin-top:12px;display:none">
        <summary style="cursor:pointer;font-size:12px;color:var(--muted)">Selected row JSON</summary>
        <pre id="scraper-inspect-json" class="json" style="max-height:240px;margin-top:8px"></pre>
      </details>
    </div>
  </div>
</div>
<script>
const SLUG=${SLUG};
const SOURCE_TABS=${JSON.stringify(SOURCE_TABS)};
const CFG_SECTIONS=${JSON.stringify(CFG_SECTIONS.map((s) => s.id))};
const APIFY_CONSOLE_RUNS='https://console.apify.com/actors/runs';
var scraperCfgCache=null;
var DEFAULT_ACTOR_JSON=${JSON.stringify(DEFAULT_ACTOR_JSON)};
var activeScraperRunId=null;
var scraperPollTimer=null;
var scraperInspectImportId=null;
var scraperInspectRowsCache=[];
var SCRAPER_PREVIEW_KEYS=['post_url','url','link','account_handle','handle','caption','title','media_type','like_count','comment_count','hashtags','subreddit','page_name','source_url'];
var EVIDENCE_PACK_PLATFORMS=['instagram','tiktok','reddit','facebook','linkedin','html'];
var EVIDENCE_PACK_LABELS={instagram:'Instagram',tiktok:'TikTok',reddit:'Reddit',facebook:'Facebook',linkedin:'LinkedIn',html:'HTML / Blogs'};

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function defaultActorJsonText(sec){
  var d=DEFAULT_ACTOR_JSON[sec];
  return typeof d==='string'?d:'{}';
}
function jsonToTextarea(v,sec){
  if(v==null||v==='')return defaultActorJsonText(sec);
  if(typeof v==='string'){
    var t=v.trim();
    if(!t)return defaultActorJsonText(sec);
    if(t==='[object Object]')return defaultActorJsonText(sec);
    try{return JSON.stringify(JSON.parse(t),null,2);}catch(_e){return t;}
  }
  if(typeof v==='object')return JSON.stringify(v,null,2);
  return String(v);
}
function apiErr(d,fallback){return (d&&d.message)||(d&&d.error)||fallback;}
function apifyRunConsoleUrl(runId){return APIFY_CONSOLE_RUNS+'/'+encodeURIComponent(String(runId||''));}
function readScraperMaxSources(){
  var el=document.getElementById('scraper-max-sources');
  if(!el)return null;
  var n=parseInt(String(el.value||'').trim(),10);
  return Number.isFinite(n)&&n>0?n:null;
}
function formatUsdRange(cost){
  if(!cost)return '—';
  if(cost.mid<=0&&cost.max<=0)return '$0';
  if(cost.min===cost.max)return '$'+cost.mid.toFixed(2);
  return '$'+cost.min.toFixed(2)+'–$'+cost.max.toFixed(2)+' (~$'+cost.mid.toFixed(2)+')';
}
function renderScraperEstimate(est){
  var out=document.getElementById('scraper-estimate-out');
  if(!out)return;
  if(!est||!est.lines){out.innerHTML='';return;}
  var lines=(est.lines||[]).filter(function(l){return l.enabled&&(l.enabled_sources>0||l.scraper_key==='html');});
  if(lines.length===0){out.innerHTML='<div class="empty">No enabled sources for this scraper.</div>';return;}
  var capNote=est.max_sources!=null?(' · cap '+est.max_sources+' per scraper'):' · no cap';
  var tb='<table><thead><tr><th>Scraper</th><th>Sources</th><th>Apify runs</th><th>Est.</th></tr></thead><tbody>';
  lines.forEach(function(l){
    var src=l.enabled_sources;
    if(l.max_sources!=null&&l.sources_after_cap<src)src=l.sources_after_cap+' / '+l.enabled_sources;
    tb+='<tr><td>'+esc(l.scraper_key)+'</td><td>'+esc(String(src))+'</td><td>'+esc(String(l.apify_runs_estimated))+'</td><td>'+esc(formatUsdRange(l.cost_estimate_usd))+'</td></tr>';
  });
  tb+='</tbody></table>';
  tb+='<div class="est-total">Total: ~'+esc(String(est.totals.apify_runs_estimated))+' Apify runs · '+esc(formatUsdRange(est.totals.cost_estimate_usd))+capNote+'</div>';
  tb+='<p style="margin:6px 0 0;font-size:10px">'+esc(est.disclaimer||'')+'</p>';
  out.innerHTML=tb;
}
async function loadScraperEstimate(scraperKey){
  var out=document.getElementById('scraper-estimate-out');
  if(!SLUG||!out)return;
  var key=scraperKey||document.getElementById('scraper-estimate-key')?.value||'all';
  var max=readScraperMaxSources();
  out.innerHTML='Estimating…';
  try{
    var q=new URLSearchParams({scraper:key});
    if(max!=null)q.set('max_sources',String(max));
    var r=await cafFetch('/v1/inputs-sources/'+encodeURIComponent(SLUG)+'/scraper-estimate?'+q.toString());
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    renderScraperEstimate(d.estimate);
  }catch(e){out.innerHTML='<span style="color:var(--red)">'+esc(e.message||e)+'</span>';}
}
function formatApifyRunLinks(stats,scraperKey){
  var runs=(stats&&stats.apify_runs)||[];
  if(runs.length){
    return runs.map(function(r){
      var id=String(r.run_id||'');
      var href=String(r.console_url||apifyRunConsoleUrl(id));
      var label=id.length>10?id.slice(0,8)+'…':id;
      return '<a href="'+esc(href)+'" target="_blank" rel="noopener noreferrer" title="'+esc(id)+'">'+esc(label)+'</a>';
    }).join(' ');
  }
  if(scraperKey==='html')return '<span style="color:var(--muted)">—</span>';
  return '<a href="'+esc(APIFY_CONSOLE_RUNS)+'" target="_blank" rel="noopener noreferrer">Console</a>';
}
function processingHref(importId){
  var q=new URLSearchParams(window.location.search);
  if(SLUG)q.set('project',SLUG);else q.delete('project');
  if(importId)q.set('import',importId);else q.delete('import');
  return '/admin/processing'+(q.toString()?'?'+q.toString():'');
}
function inspectImportButton(importId,label){
  if(!importId)return '';
  return '<button type="button" class="btn-ghost btn-sm btn-inspect-scrape" data-import-id="'+esc(importId)+'" data-import-label="'+esc(label||'')+'">'+esc(label||'Inspect')+'</button>';
}
function closeScraperInspect(){
  var m=document.getElementById('scraper-inspect-modal');
  if(m)m.classList.remove('open');
  scraperInspectImportId=null;
  scraperInspectRowsCache=[];
}
function pickScraperPreviewCols(rows){
  var keys=[];
  SCRAPER_PREVIEW_KEYS.forEach(function(k){
    if(rows.some(function(r){var p=r.payload_json||{};return p[k]!=null&&String(p[k]).trim()!=='';}))keys.push(k);
  });
  if(keys.length<3){
    rows.slice(0,25).forEach(function(r){
      Object.keys(r.payload_json||{}).forEach(function(k){
        if(keys.length<8&&keys.indexOf(k)<0)keys.push(k);
      });
    });
  }
  return keys.slice(0,8);
}
function formatPreviewCell(v){
  if(v==null)return '—';
  var s=String(v);
  if(s.length>120)return esc(s.slice(0,117))+'…';
  if(/^https?:\\/\\//i.test(s))return '<a href="'+esc(s)+'" target="_blank" rel="noopener noreferrer">'+esc(s.length>48?s.slice(0,45)+'…':s)+'</a>';
  return esc(s);
}
function renderScraperInspectRows(rows){
  var root=document.getElementById('scraper-inspect-rows');
  var jsonWrap=document.getElementById('scraper-inspect-json-wrap');
  if(!root)return;
  scraperInspectRowsCache=rows||[];
  if(!rows||rows.length===0){root.innerHTML='<div class="empty">No rows on this sheet.</div>';if(jsonWrap)jsonWrap.style.display='none';return;}
  var cols=pickScraperPreviewCols(rows);
  var tb='<table class="sp-modal-table caf-table-compact"><thead><tr><th>#</th>';
  cols.forEach(function(c){tb+='<th>'+esc(c)+'</th>';});
  tb+='</tr></thead><tbody>';
  rows.forEach(function(r){
    var p=r.payload_json||{};
    tb+='<tr class="scraper-inspect-row" data-row-id="'+esc(r.id)+'"><td>'+esc(r.row_index)+'</td>';
    cols.forEach(function(c){tb+='<td style="max-width:220px;overflow:hidden;text-overflow:ellipsis">'+formatPreviewCell(p[c])+'</td>';});
    tb+='</tr>';
  });
  tb+='</tbody></table>';
  root.innerHTML=tb;
  root.querySelectorAll('.scraper-inspect-row').forEach(function(tr){
    tr.addEventListener('click',function(){
      root.querySelectorAll('.scraper-inspect-row').forEach(function(x){x.classList.remove('is-selected');});
      tr.classList.add('is-selected');
      var row=scraperInspectRowsCache.find(function(x){return x.id===tr.getAttribute('data-row-id');});
      var pre=document.getElementById('scraper-inspect-json');
      if(pre&&row)pre.textContent=JSON.stringify(row,null,2);
      if(jsonWrap)jsonWrap.style.display=row?'block':'none';
    });
  });
}
async function loadScraperInspectSheet(sheet){
  if(!SLUG||!scraperInspectImportId)return;
  var root=document.getElementById('scraper-inspect-rows');
  var countEl=document.getElementById('scraper-inspect-sheet-count');
  if(root)root.innerHTML='Loading…';
  try{
    var q=new URLSearchParams({limit:'100'});
    if(sheet)q.set('sheet',sheet);
    var r=await cafFetch('/v1/inputs-evidence/'+encodeURIComponent(SLUG)+'/'+encodeURIComponent(scraperInspectImportId)+'/rows?'+q.toString());
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    renderScraperInspectRows(d.rows||[]);
    if(countEl)countEl.textContent=(d.rows||[]).length+' row(s) shown (max 100)';
  }catch(e){
    if(root)root.innerHTML='<div class="empty" style="color:var(--red)">'+esc(e.message||e)+'</div>';
  }
}
async function openScraperInspect(importId,label){
  if(!SLUG||!importId)return;
  scraperInspectImportId=importId;
  var modal=document.getElementById('scraper-inspect-modal');
  var title=document.getElementById('scraper-inspect-title');
  var meta=document.getElementById('scraper-inspect-meta');
  var sheetSel=document.getElementById('scraper-inspect-sheet');
  var proc=document.getElementById('scraper-inspect-process');
  var jsonWrap=document.getElementById('scraper-inspect-json-wrap');
  if(title)title.textContent=label?'Scraped results — '+label:'Scraped results';
  if(meta)meta.textContent='Loading import…';
  if(sheetSel)sheetSel.innerHTML='';
  if(proc){proc.href=processingHref(importId);proc.style.display='inline-flex';}
  if(jsonWrap)jsonWrap.style.display='none';
  if(modal)modal.classList.add('open');
  try{
    var r=await cafFetch('/v1/inputs-evidence/'+encodeURIComponent(SLUG)+'/'+encodeURIComponent(importId));
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var imp=d.import||{};
    var bySheet=d.rows_by_sheet||{};
    var sheetNames=Object.keys(bySheet).sort();
    var total=imp.stored_row_count!=null?imp.stored_row_count:sheetNames.reduce(function(n,k){return n+(bySheet[k]||0);},0);
    if(meta){
      meta.textContent=(imp.upload_filename||'import')+' · '+total+' row(s) · '+(sheetNames.length?sheetNames.join(', '):'no sheets');
    }
    if(sheetSel){
      sheetSel.innerHTML=sheetNames.map(function(s){
        return '<option value="'+esc(s)+'">'+esc(s)+' ('+esc(String(bySheet[s]||0))+')</option>';
      }).join('');
      sheetSel.onchange=function(){loadScraperInspectSheet(sheetSel.value);};
    }
    await loadScraperInspectSheet(sheetNames[0]||'');
  }catch(e){
    if(meta)meta.textContent=String(e.message||e);
    var root=document.getElementById('scraper-inspect-rows');
    if(root)root.innerHTML='<div class="empty" style="color:var(--red)">'+esc(e.message||e)+'</div>';
  }
}
function bindInspectScrapeButtons(root){
  if(!root)return;
  root.querySelectorAll('.btn-inspect-scrape').forEach(function(btn){
    btn.addEventListener('click',function(){
      openScraperInspect(btn.getAttribute('data-import-id'),btn.getAttribute('data-import-label')||'');
    });
  });
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
  if(tab==='scrapers'&&SLUG){loadScraperMeta();loadScraperRuns();loadEvidencePackOptions();loadEvidencePacks();}
}
function importSourceTag(sheetStats){
  var src=sheetStats&&sheetStats.source;
  if(src==='scraper')return ' <span class="badge badge-b">scraper</span>';
  if(src==='evidence_pack')return ' <span class="badge badge-p">evidence pack</span>';
  return '';
}
async function loadEvidencePackOptions(){
  var root=document.getElementById('evidence-pack-slots');
  if(!SLUG||!root)return;
  root.innerHTML='Loading…';
  try{
    var r=await cafFetch('/v1/inputs-sources/'+encodeURIComponent(SLUG)+'/evidence-pack-run-options');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var opts=d.options||{};
    var html='';
    EVIDENCE_PACK_PLATFORMS.forEach(function(p){
      var runs=opts[p]||[];
      html+='<div style="margin:0 0 8px"><label style="font-size:12px;display:block;margin-bottom:4px">'+esc(EVIDENCE_PACK_LABELS[p]||p)+'</label>';
      html+='<select class="evidence-pack-slot" data-platform="'+esc(p)+'" style="width:100%;padding:7px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--fg)">';
      html+='<option value="">— skip —</option>';
      runs.forEach(function(run){
        var when=String(run.created_at||'').slice(0,16).replace('T',' ');
        var rows=run.total_rows!=null?String(run.total_rows)+' rows':'';
        var allHint=run.scraper_key==='all'?' · all-run':'';
        html+='<option value="'+esc(run.scraper_run_id)+'">'+esc(when)+(rows?' · '+esc(rows):'')+esc(allHint)+'</option>';
      });
      html+='</select></div>';
    });
    root.innerHTML=html||'<div class="empty">No completed runs yet — run scrapers first.</div>';
  }catch(e){root.innerHTML='<div class="empty" style="color:var(--red)">'+esc(e.message||e)+'</div>';}
}
function gatherEvidencePackSlots(){
  var slots={};
  document.querySelectorAll('.evidence-pack-slot').forEach(function(sel){
    var p=sel.getAttribute('data-platform');
    var v=String(sel.value||'').trim();
    if(p&&v)slots[p]=v;
  });
  return slots;
}
async function buildEvidencePack(){
  if(!SLUG){alert('Select a project first.');return;}
  var st=document.getElementById('evidence-pack-status');
  var slots=gatherEvidencePackSlots();
  if(!Object.keys(slots).length){alert('Select at least one platform run.');return;}
  var label=document.getElementById('evidence-pack-label')?.value||'';
  if(st){st.textContent='Building import…';st.className='tp-pass-status is-run';}
  try{
    var body={slots:slots};
    if(String(label).trim())body.label=String(label).trim();
    var r=await cafFetch('/v1/inputs-sources/'+encodeURIComponent(SLUG)+'/evidence-packs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    if(st){
      st.innerHTML='Built: '+esc(String(d.total_rows))+' rows · '+inspectImportButton(d.evidence_import_id,'Inspect')+' · <a href="'+esc(processingHref(d.evidence_import_id))+'">Open in Processing</a>';
      st.className='tp-pass-status';
      bindInspectScrapeButtons(st);
    }
    await loadImports();
    await loadEvidencePacks();
  }catch(e){
    if(st){st.textContent=String(e.message||e);st.className='tp-pass-status is-err';}
  }
}
async function loadEvidencePacks(){
  var root=document.getElementById('evidence-packs-root');
  if(!SLUG||!root)return;
  try{
    var r=await cafFetch('/v1/inputs-sources/'+encodeURIComponent(SLUG)+'/evidence-packs?limit=10');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var rows=d.packs||[];
    if(rows.length===0){root.innerHTML='';return;}
    var tb='<div style="font-size:12px;font-weight:600;margin-bottom:6px">Recent packs</div><table class="sp-modal-table caf-table-compact"><thead><tr><th>When</th><th>Label</th><th>Rows</th><th>Platforms</th><th></th></tr></thead><tbody>';
    rows.forEach(function(x){
      var stats=x.stats_json||{};
      var platforms=(stats.platforms||Object.keys(x.slots_json||{})).join(', ');
      var n=stats.total_rows!=null?stats.total_rows:'—';
      var actions=x.evidence_import_id?(inspectImportButton(x.evidence_import_id,'Inspect')+' <a class="btn-ghost btn-sm" href="'+esc(processingHref(x.evidence_import_id))+'">Processing</a>'):'';
      tb+='<tr><td>'+esc(String(x.created_at||'').slice(0,19))+'</td><td>'+esc(x.label||'—')+'</td><td>'+esc(n)+'</td><td>'+esc(platforms)+'</td><td>'+actions+'</td></tr>';
    });
    tb+='</tbody></table>';
    root.innerHTML=tb;
    bindInspectScrapeButtons(root);
  }catch(e){root.innerHTML='';}
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
      var src=importSourceTag(x.sheet_stats_json);
      tb+='<tr><td>'+esc(String(x.created_at||'').slice(0,19))+'</td><td>'+esc(x.upload_filename||'—')+src+'</td><td>'+esc(x.stored_row_count)+'</td><td>'+inspectImportButton(x.id,'Inspect')+' <a class="btn btn-sm" href="'+esc(phref)+'">Process</a></td></tr>';
    }
    tb+='</tbody></table>';
    root.innerHTML=tb;
    bindInspectScrapeButtons(root);
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
    if(json&&typeof json==='object'&&!Array.isArray(json)&&Object.keys(json).length>0){
      ta.value=JSON.stringify(json,null,2);
    }else if(json!=null&&json!==''){
      ta.value=jsonToTextarea(json,sec);
    }else{
      ta.value=defaultActorJsonText(sec);
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
      if(ta)ta.value=defaultActorJsonText(sec);
    });
    await saveScraperConfig();
  }catch(e){alert(String(e.message||e));}
}

function updateAbortScraperUi(){
  var btn=document.getElementById('btn-abort-scraper');
  if(btn)btn.style.display=activeScraperRunId?'block':'none';
}
function stopScraperPoll(){
  if(scraperPollTimer){clearInterval(scraperPollTimer);scraperPollTimer=null;}
}
function startScraperPoll(){
  stopScraperPoll();
  scraperPollTimer=setInterval(function(){loadScraperRuns({silent:true});},3000);
}
function onScraperRunFinished(run){
  activeScraperRunId=null;
  stopScraperPoll();
  updateAbortScraperUi();
  return run;
}
function renderScraperRunDone(st,d){
  var apifyHtml='';
  if(Array.isArray(d.apify_runs)&&d.apify_runs.length){
    apifyHtml=' · Apify: '+d.apify_runs.map(function(ar){
      return '<a href="'+esc(String(ar.console_url||apifyRunConsoleUrl(ar.run_id)))+'" target="_blank" rel="noopener noreferrer">'+esc(String(ar.run_id||'').slice(0,8))+'…</a>';
    }).join(' ');
  }
  if(st){
    st.innerHTML='Done: '+esc(String(d.total_rows))+' rows · <button type="button" class="btn-ghost btn-sm btn-inspect-scrape" data-import-id="'+esc(d.evidence_import_id)+'" data-import-label="latest run">Inspect</button> · <a href="'+esc(processingHref(d.evidence_import_id))+'">Process</a>'+apifyHtml;
    bindInspectScrapeButtons(st);
    st.className='tp-pass-status';
  }
}
function apifyRunIdsFromStats(stats, platform){
  var runs=(stats&&stats.apify_runs)||[];
  if(!Array.isArray(runs))return [];
  var out=[];
  runs.forEach(function(r){
    if(!r)return;
    if(platform&&r.scraper_key&&r.scraper_key!==platform)return;
    var id=String(r.run_id||'').trim();
    if(id)out.push(id);
  });
  return out;
}
async function recoverScraperRun(runId, scraperKey){
  if(!SLUG||!runId)return;
  var scraper=String(scraperKey||'linkedin');
  if(scraper==='all'){
    scraper=window.prompt('Which platform to recover from this run?','linkedin');
    if(!scraper)return;
  }
  var extra=window.prompt(
    'Apify run ID(s) to import — paste from Apify console (profile-posts for LinkedIn). Leave blank to use IDs saved on this CAF run if available:',
    ''
  );
  if(extra===null)return;
  var ids=String(extra||'').split(/[\s,;]+/).map(function(s){return s.trim();}).filter(Boolean);
  var body={scraper:scraper};
  if(ids.length)body.apify_run_ids=ids;
  var st=document.getElementById('recover-apify-status');
  if(st){st.textContent='Recovering…';st.className='tp-pass-status is-run';}
  try{
    var url='/v1/inputs-sources/'+encodeURIComponent(SLUG)+'/scraper-runs/'+encodeURIComponent(runId)+'/recover';
    var r=await cafFetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    if(st){
      st.innerHTML='Recovered: '+esc(String(d.total_rows))+' rows · '+inspectImportButton(d.evidence_import_id,'Inspect')+' · <a href="'+esc(processingHref(d.evidence_import_id))+'">Process</a>';
      st.className='tp-pass-status';
    }
    await loadScraperRuns();
    await loadEvidencePackOptions();
    await loadImports();
  }catch(e){
    if(st){st.textContent=String(e.message||e);st.className='tp-pass-status is-err';}
    else alert(String(e.message||e));
  }
}
async function recoverApifyImportStandalone(){
  if(!SLUG){alert('Select a project first.');return;}
  var scraper=document.getElementById('recover-apify-scraper')?.value||'linkedin';
  var raw=String(document.getElementById('recover-apify-run-ids')?.value||'').trim();
  var ids=raw.split(/[\s,;]+/).map(function(s){return s.trim();}).filter(Boolean);
  if(!ids.length){alert('Paste at least one Apify run ID.');return;}
  var st=document.getElementById('recover-apify-status');
  if(st){st.textContent='Recovering…';st.className='tp-pass-status is-run';}
  try{
    var r=await cafFetch('/v1/inputs-sources/'+encodeURIComponent(SLUG)+'/recover-apify-import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scraper:scraper,apify_run_ids:ids})});
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    if(st){
      st.innerHTML='Recovered: '+esc(String(d.total_rows))+' rows · '+inspectImportButton(d.evidence_import_id,'Inspect')+' · <a href="'+esc(processingHref(d.evidence_import_id))+'">Process</a>';
      st.className='tp-pass-status';
    }
    await loadScraperRuns();
    await loadEvidencePackOptions();
    await loadImports();
  }catch(e){
    if(st){st.textContent=String(e.message||e);st.className='tp-pass-status is-err';}
  }
}
async function abortScraperRun(runId){
  if(!SLUG||!runId)return;
  if(!confirm('Abort this scraper run?'))return;
  try{
    var r=await cafFetch('/v1/inputs-sources/'+encodeURIComponent(SLUG)+'/scraper-runs/'+encodeURIComponent(runId)+'/abort',{method:'POST'});
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    if(runId===activeScraperRunId){
      activeScraperRunId=null;
      stopScraperPoll();
      updateAbortScraperUi();
      var st=document.getElementById('scraper-status-all');
      if(st){st.textContent='Aborted';st.className='tp-pass-status is-err';}
    }
    await loadScraperRuns();
  }catch(e){alert(String(e.message||e));}
}
async function runScraper(key){
  if(!SLUG){alert('Select a project first.');return;}
  var st=document.getElementById('scraper-status-'+key);
  var max=readScraperMaxSources();
  if(st){st.textContent='Starting…';st.className='tp-pass-status is-run';}
  try{
    var body={scraper:key};
    if(max!=null)body.max_sources=max;
    var r=await cafFetch('/v1/inputs-sources/'+encodeURIComponent(SLUG)+'/run-scraper',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    if(d.status==='running'&&d.scraper_run_id){
      activeScraperRunId=d.scraper_run_id;
      updateAbortScraperUi();
      startScraperPoll();
      if(st){st.textContent='Running… (use Abort or wait)';st.className='tp-pass-status is-run';}
      await loadScraperRuns();
      return;
    }
    renderScraperRunDone(st,d);
    await loadImports();
    await loadScraperRuns();
  }catch(e){
    if(st){st.textContent=String(e.message||e);st.className='tp-pass-status is-err';}
  }
}

async function loadScraperRuns(opts){
  var root=document.getElementById('scraper-runs-root');
  if(!SLUG||!root)return;
  try{
    var r=await cafFetch('/v1/inputs-sources/'+encodeURIComponent(SLUG)+'/scraper-runs?limit=20');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var rows=d.runs||[];
    var hasRunning=false;
    if(rows.length===0){root.innerHTML='<div class="empty">No scraper runs yet.</div>';activeScraperRunId=null;stopScraperPoll();updateAbortScraperUi();return;}
    var tb='<table class="sp-modal-table caf-table-compact"><thead><tr><th>When</th><th>Scraper</th><th>Status</th><th>Rows</th><th>Apify</th><th></th></tr></thead><tbody>';
    rows.forEach(function(x){
      var stats=x.stats_json||{};
      var n=stats.total_rows!=null?stats.total_rows:'—';
      var apify=formatApifyRunLinks(stats,x.scraper_key);
      var link=x.evidence_import_id?(inspectImportButton(x.evidence_import_id,'Inspect')+' <a class="btn-ghost btn-sm" href="'+esc(processingHref(x.evidence_import_id))+'">Process</a>'):'';
      var abort='';
      var recover='';
      if(x.status==='running'||x.status==='pending'){
        hasRunning=true;
        if(!activeScraperRunId)activeScraperRunId=x.id;
        abort=' <button type="button" class="btn-ghost btn-sm btn-abort-scraper-run" data-run-id="'+esc(x.id)+'">Abort</button>';
      }
      if((x.status==='failed'||x.status==='cancelled')&&!x.evidence_import_id){
        recover=' <button type="button" class="btn btn-sm btn-recover-scraper-run" data-run-id="'+esc(x.id)+'" data-scraper-key="'+esc(x.scraper_key)+'">Recover</button>';
      }
      var statusCls=x.status==='cancelled'?' style="color:var(--yellow)"':(x.status==='failed'?' style="color:var(--red)"':'');
      var statusLabel=x.status;
      if(x.status==='failed'&&x.error_message)statusLabel=x.status+' — '+x.error_message;
      tb+='<tr><td>'+esc(String(x.created_at||'').slice(0,19))+'</td><td>'+esc(x.scraper_key)+'</td><td'+statusCls+'>'+esc(statusLabel)+'</td><td>'+esc(n)+'</td><td>'+apify+'</td><td>'+link+recover+abort+'</td></tr>';
    });
    tb+='</tbody></table>';
    root.innerHTML=tb;
    root.querySelectorAll('.btn-abort-scraper-run').forEach(function(btn){
      btn.addEventListener('click',function(){abortScraperRun(btn.getAttribute('data-run-id'));});
    });
    root.querySelectorAll('.btn-recover-scraper-run').forEach(function(btn){
      btn.addEventListener('click',function(){
        recoverScraperRun(btn.getAttribute('data-run-id'), btn.getAttribute('data-scraper-key'));
      });
    });
    bindInspectScrapeButtons(root);
    if(hasRunning){
      updateAbortScraperUi();
      if(!scraperPollTimer)startScraperPoll();
    }else if(activeScraperRunId){
      var tracked=rows.find(function(x){return x.id===activeScraperRunId;});
      if(tracked&&tracked.status==='completed'){
        renderScraperRunDone(document.getElementById('scraper-status-all'),{
          total_rows:(tracked.stats_json&&tracked.stats_json.total_rows)||0,
          evidence_import_id:tracked.evidence_import_id,
          apify_runs:(tracked.stats_json&&tracked.stats_json.apify_runs)||[]
        });
        onScraperRunFinished(tracked);
        await loadImports();
      }else if(tracked&&(tracked.status==='failed'||tracked.status==='cancelled')){
        var st=document.getElementById('scraper-status-all');
        if(st){st.textContent=tracked.status==='cancelled'?'Aborted':(tracked.error_message||'Failed');st.className='tp-pass-status is-err';}
        onScraperRunFinished(tracked);
      }else{
        onScraperRunFinished(null);
      }
    }else{
      stopScraperPoll();
      updateAbortScraperUi();
    }
  }catch(e){
    if(!opts||!opts.silent)root.innerHTML='<div class="empty" style="color:var(--red)">'+esc(e.message||e)+'</div>';
  }
}

document.getElementById('btn-reload-imports')?.addEventListener('click',loadImports);
document.getElementById('btn-reload-sources')?.addEventListener('click',loadSources);
document.getElementById('source-tab-sel')?.addEventListener('change',loadSources);
document.getElementById('btn-reload-scraper-runs')?.addEventListener('click',loadScraperRuns);
document.getElementById('btn-reload-evidence-packs')?.addEventListener('click',function(){loadEvidencePackOptions();loadEvidencePacks();});
document.getElementById('btn-build-evidence-pack')?.addEventListener('click',buildEvidencePack);
document.getElementById('btn-save-scraper-config')?.addEventListener('click',saveScraperConfig);
document.getElementById('btn-reset-scraper-config')?.addEventListener('click',resetScraperConfig);
document.getElementById('btn-run-all-scrapers')?.addEventListener('click',function(){runScraper('all');});
document.getElementById('btn-recover-apify-import')?.addEventListener('click',recoverApifyImportStandalone);
document.getElementById('btn-abort-scraper')?.addEventListener('click',function(){
  if(activeScraperRunId)abortScraperRun(activeScraperRunId);
});
document.getElementById('btn-estimate-scraper')?.addEventListener('click',function(){loadScraperEstimate();});
document.getElementById('scraper-max-sources')?.addEventListener('change',function(){
  var out=document.getElementById('scraper-estimate-out');
  if(out&&out.innerHTML)loadScraperEstimate();
});
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
