/** Shared Admin UI: glossary, CSS snippet, and tooltip/options-menu JS. */

export const ADMIN_CAF_GLOSSARY: Record<string, string> = {
  evidence:
    "Scraped rows from your INPUTS workbook (typically 9–10 platform sheets). Raw social and web content before analysis.",
  insights:
    "LLM analysis of evidence — patterns, hooks, top-performer findings, and strategic opportunities.",
  jobs:
    "Content units that travel from signal pack → run planning → generation. The same concept throughout the pipeline.",
  signalPack:
    "Bundle attached to a run: jobs, visual guidelines, hashtags, and derived globals.",
  run: "One execution cycle for a project, tied to a signal pack.",
  runOutputs: "Post-run artifacts: exports, content log, and output review.",
  plannedJobs:
    "Jobs selected from the signal pack for a run before planning and generation start.",
  processing:
    "Filter evidence, generate insights, build jobs, and compile a signal pack from an import.",
  inputs: "Upload INPUTS workbooks and browse import history before processing.",
};

export function adminCafUiCss(): string {
  return `
.caf-page-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
.caf-page-header-left{display:flex;flex-direction:column;gap:6px}
.caf-page-header-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.caf-stat-chips{font-size:12px;color:var(--muted);display:flex;gap:12px;flex-wrap:wrap}
.ph h2,.caf-page-header h2{font-size:20px;font-weight:600;letter-spacing:-.02em}
.card-h{text-transform:none;letter-spacing:0;color:var(--fg);font-size:13px;font-weight:600}
.caf-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;padding:10px 12px;background:var(--bg2);border:1px solid var(--border2);border-radius:10px}
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
.caf-stepper{display:flex;gap:6px;flex-wrap:wrap;padding:0 0 12px;border-bottom:1px solid var(--border);margin-bottom:12px}
.caf-step-pill{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;font-size:12px;font-weight:500;border-radius:9999px;border:1px solid var(--border);background:var(--bg);color:var(--fg2);cursor:pointer;transition:all .15s}
.caf-step-pill:hover{border-color:var(--fg2);color:var(--fg)}
.caf-step-pill.active{background:var(--accent);border-color:var(--accent);color:#fff}
.caf-step-pill.done{border-color:var(--green);color:var(--green)}
.caf-step-pill.locked{opacity:.45;cursor:not-allowed}
.caf-table-compact td,.caf-table-compact th{padding-top:8px;padding-bottom:8px}
.caf-run-hub-tabs{display:flex;gap:0;padding:0 28px;border-bottom:1px solid var(--border);margin-top:8px}
.caf-run-hub-tab{padding:10px 16px;font-size:13px;font-weight:500;color:var(--fg2);text-decoration:none;border-bottom:2px solid transparent;margin-bottom:-1px}
.caf-run-hub-tab:hover{color:var(--fg);text-decoration:none}
.caf-run-hub-tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.runs-ops-hint{display:none!important}
.ph-sub{display:none}
`;
}

export function adminCafUiScript(): string {
  const glossary = JSON.stringify(ADMIN_CAF_GLOSSARY);
  return `
(function(){
  var G=${glossary};
  function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
  document.querySelectorAll('[data-caf-term]').forEach(function(el){
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
