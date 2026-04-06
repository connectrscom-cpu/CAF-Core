import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { getProjectBySlug, ensureProject, getConstraints, upsertConstraints, listActiveSuppressionRules } from "../repositories/core.js";
import { listRuns } from "../repositories/runs.js";
import { listLearningRules } from "../repositories/learning.js";
import { getFullProjectProfile } from "../repositories/project-config.js";
import {
  getJobStats,
  listJobs,
  listDecisionTraces,
  listAllPromptVersions,
  listAllSuppressionRules,
  getRunCount,
  getJobFacets,
} from "../repositories/admin.js";

interface Deps {
  db: Pool;
  config: AppConfig;
}

const PROJECT_SLUG = "SNS";

// ── Shared HTML helpers ────────────────────────────────────────────────────

function css(): string {
  return `
:root{--bg:#09090b;--bg2:#0f0f12;--fg:#fafafa;--fg2:#a1a1aa;--accent:#3b82f6;--accent2:#2563eb;
--card:#141418;--card2:#1a1a1f;--border:#27272a;--border2:#1e1e22;--muted:#71717a;
--green:#22c55e;--green-bg:rgba(34,197,94,.1);--red:#ef4444;--red-bg:rgba(239,68,68,.1);
--yellow:#eab308;--yellow-bg:rgba(234,179,8,.1);--blue-bg:rgba(59,130,246,.1);--purple:#a855f7;--purple-bg:rgba(168,85,247,.1);
--sidebar:240px}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--fg);min-height:100vh;
font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;font-size:14px;line-height:1.5}
a{color:var(--accent);text-decoration:none}a:hover{color:var(--accent2)}
.shell{display:flex;min-height:100vh}
.sb{width:var(--sidebar);background:var(--bg2);border-right:1px solid var(--border);position:fixed;top:0;left:0;bottom:0;z-index:50;display:flex;flex-direction:column}
.sb-brand{padding:20px 20px 16px;border-bottom:1px solid var(--border)}
.sb-brand h1{font-size:15px;font-weight:700;letter-spacing:-.02em}
.sb-brand span{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;display:block;margin-top:2px}
.sb-nav{padding:12px 8px;flex:1;display:flex;flex-direction:column;gap:2px}
.sb-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:16px 12px 6px}
.sb-link{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;font-size:13px;font-weight:500;color:var(--fg2);transition:all .15s;text-decoration:none}
.sb-link:hover{background:var(--card);color:var(--fg);text-decoration:none}
.sb-link.active{background:var(--accent);color:#fff}
.main{margin-left:var(--sidebar);flex:1;min-width:0}
.ph{display:flex;align-items:center;justify-content:space-between;padding:20px 28px 0}
.ph h2{font-size:22px;font-weight:700;letter-spacing:-.02em}
.ph-sub{font-size:13px;color:var(--muted)}
.content{padding:20px 28px 28px}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:20px;margin-bottom:16px}
.card-h{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--border)}
.info-row{display:flex;justify-content:space-between;padding:7px 0;font-size:13px;border-bottom:1px solid var(--border2)}
.info-row:last-child{border-bottom:none}
.info-l{color:var(--muted)}.info-v{font-weight:500;text-align:right}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:10px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);border-bottom:1px solid var(--border);white-space:nowrap}
td{padding:10px 12px;font-size:13px;border-bottom:1px solid var(--border2);vertical-align:middle}
tr{transition:background .1s}tbody tr:hover{background:var(--card2)}
.badge{display:inline-flex;align-items:center;padding:3px 10px;border-radius:9999px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.02em;white-space:nowrap}
.badge-g{background:var(--green-bg);color:var(--green)}
.badge-r{background:var(--red-bg);color:var(--red)}
.badge-y{background:var(--yellow-bg);color:var(--yellow)}
.badge-b{background:var(--blue-bg);color:var(--accent)}
.badge-p{background:var(--purple-bg);color:var(--purple)}
.mono{font-family:'SF Mono','Fira Code','Cascadia Code',monospace;font-size:12px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
.stat-card{text-align:center}
.stat-card .num{font-size:28px;font-weight:700;color:var(--accent)}
.stat-card .lbl{font-size:12px;color:var(--muted);margin-top:4px}
.empty{text-align:center;padding:40px 20px;color:var(--muted);font-size:14px}
input,textarea,select{background:var(--card);color:var(--fg);border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:13px;width:100%;outline:none;transition:border-color .15s;font-family:inherit}
input:focus,textarea:focus,select:focus{border-color:var(--accent)}
button{cursor:pointer;border:none;border-radius:6px;padding:8px 16px;font-size:13px;font-weight:500;transition:all .15s}
button:hover{opacity:.9}button:disabled{opacity:.5;cursor:not-allowed}
.btn{background:var(--accent);color:#fff}.btn:hover{background:var(--accent2)}
.btn-ghost{background:transparent;color:var(--fg2);border:1px solid var(--border);font-size:12px;padding:5px 14px}
.btn-ghost:hover{color:var(--fg);border-color:var(--fg2);background:var(--card)}
.filter-row{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;align-items:flex-end}
.filter-row>div{display:flex;flex-direction:column;gap:4px}
.filter-row label{font-size:12px;font-weight:500;color:var(--fg2)}
.filter-row select,.filter-row input{width:180px}
.page-btns{display:flex;gap:8px;margin-top:16px;align-items:center}
.page-btns span{font-size:13px;color:var(--muted)}
pre.json{font-size:11px;overflow:auto;max-height:300px;background:var(--bg);padding:12px;border-radius:8px;border:1px solid var(--border);font-family:'SF Mono','Fira Code',monospace;color:var(--fg2)}
.form-group{margin-bottom:14px}
.form-group label{display:block;font-size:12px;font-weight:500;color:var(--fg2);margin-bottom:5px}
@media(max-width:1024px){.sb{display:none}.main{margin-left:0}}
`;
}

function sidebar(active: string): string {
  const links = [
    { href: "/admin", label: "Overview", key: "overview" },
    { href: "/admin/runs", label: "Runs", key: "runs" },
    { href: "/admin/jobs", label: "Jobs", key: "jobs" },
    { href: "/admin/engine", label: "Decision Engine", key: "engine" },
    { href: "/admin/config", label: "Project Config", key: "config" },
  ];
  return `<aside class="sb">
  <div class="sb-brand"><h1>CAF Core</h1><span>Admin Dashboard</span></div>
  <nav class="sb-nav">
    <div class="sb-title">Dashboard</div>
    ${links.map((l) => `<a href="${l.href}" class="sb-link${l.key === active ? " active" : ""}">${l.label}</a>`).join("\n    ")}
    <div class="sb-title" style="margin-top:auto;padding-top:24px">External</div>
    <a href="/" class="sb-link" target="_blank">API Root</a>
    <a href="/health" class="sb-link" target="_blank">Health</a>
  </nav>
</aside>`;
}

function page(title: string, activeSidebar: string, body: string, headExtra = ""): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — CAF Core</title><style>${css()}</style>${headExtra}</head>
<body><div class="shell">${sidebar(activeSidebar)}<main class="main">${body}</main></div></body></html>`;
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function statusBadge(status: string): string {
  const s = (status || "").toUpperCase().replace(/\s+/g, "_");
  let cls = "badge-b";
  if (s.includes("COMPLETE") || s === "APPROVED") cls = "badge-g";
  else if (s === "FAILED" || s === "CANCELLED" || s === "REJECTED") cls = "badge-r";
  else if (s.includes("EDIT") || s === "PLANNING" || s === "GENERATING" || s === "RENDERING") cls = "badge-y";
  else if (s === "CREATED" || s.includes("REVIEW")) cls = "badge-b";
  return `<span class="badge ${cls}">${esc(status || "—")}</span>`;
}

// ── Route registration ─────────────────────────────────────────────────────

export function registerAdminRoutes(app: FastifyInstance, { db, config }: Deps): void {
  // ── JSON API endpoints for client-side fetch ─────────────────────────

  app.get("/v1/admin/stats", async () => {
    const project = await getProjectBySlug(db, PROJECT_SLUG);
    if (!project) return { ok: false, error: "Project not found" };
    const stats = await getJobStats(db, project.id);
    return { ok: true, stats };
  });

  app.get("/v1/admin/jobs", async (request) => {
    const project = await getProjectBySlug(db, PROJECT_SLUG);
    if (!project) return { ok: false, error: "Project not found" };
    const query = request.query as Record<string, string>;
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "50", 10)));
    const offset = (page - 1) * limit;
    const result = await listJobs(db, project.id, {
      status: query.status || undefined,
      platform: query.platform || undefined,
      flow_type: query.flow_type || undefined,
      run_id: query.run_id || undefined,
      search: query.search || undefined,
    }, limit, offset);
    return { ok: true, ...result, page, limit };
  });

  app.get("/v1/admin/jobs/facets", async () => {
    const project = await getProjectBySlug(db, PROJECT_SLUG);
    if (!project) return { ok: false, error: "Project not found" };
    return { ok: true, ...(await getJobFacets(db, project.id)) };
  });

  app.get("/v1/admin/runs", async (request) => {
    const project = await getProjectBySlug(db, PROJECT_SLUG);
    if (!project) return { ok: false, error: "Project not found" };
    const query = request.query as Record<string, string>;
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "50", 10)));
    const offset = (page - 1) * limit;
    const runs = await listRuns(db, project.id, limit, offset);
    const totalCount = await getRunCount(db, project.id);
    return { ok: true, runs, total: totalCount, page, limit };
  });

  app.get("/v1/admin/engine", async () => {
    const project = await getProjectBySlug(db, PROJECT_SLUG);
    if (!project) return { ok: false, error: "Project not found" };
    const [suppression, learning, prompts, traces] = await Promise.all([
      listAllSuppressionRules(db, project.id),
      listLearningRules(db, project.id),
      listAllPromptVersions(db, project.id),
      listDecisionTraces(db, project.id, 50),
    ]);
    return {
      ok: true,
      suppression_rules: suppression,
      learning_rules: learning,
      prompt_versions: prompts,
      decision_traces: traces,
      scoring_weights: {
        confidence: config.SCORE_WEIGHT_CONFIDENCE,
        platform_fit: config.SCORE_WEIGHT_PLATFORM_FIT,
        novelty: config.SCORE_WEIGHT_NOVELTY,
        past_performance: config.SCORE_WEIGHT_PAST_PERF,
      },
      engine_version: config.DECISION_ENGINE_VERSION,
    };
  });

  app.get("/v1/admin/config", async () => {
    const project = await getProjectBySlug(db, PROJECT_SLUG);
    if (!project) return { ok: false, error: "Project not found" };
    const [constraints, profile] = await Promise.all([
      getConstraints(db, project.id),
      getFullProjectProfile(db, project.id),
    ]);
    return { ok: true, project, constraints, profile };
  });

  app.post("/v1/admin/config/constraints", async (request) => {
    const project = await ensureProject(db, PROJECT_SLUG);
    const body = request.body as Record<string, unknown>;
    await upsertConstraints(db, project.id, {
      max_daily_jobs: body.max_daily_jobs != null ? Number(body.max_daily_jobs) : null,
      min_score_to_generate: body.min_score_to_generate != null ? Number(body.min_score_to_generate) : null,
      max_active_prompt_versions: body.max_active_prompt_versions != null ? Number(body.max_active_prompt_versions) : null,
      default_variation_cap: Number(body.default_variation_cap ?? 1),
      auto_validation_pass_threshold: body.auto_validation_pass_threshold != null ? Number(body.auto_validation_pass_threshold) : null,
    });
    return { ok: true };
  });

  // ── HTML pages ───────────────────────────────────────────────────────

  // --- Overview ---
  app.get("/admin", async (_, reply) => {
    const project = await getProjectBySlug(db, PROJECT_SLUG);
    const constraints = project ? await getConstraints(db, project.id) : null;
    const stats = project ? await getJobStats(db, project.id) : null;
    const runCount = project ? await getRunCount(db, project.id) : 0;

    const statusCards = stats
      ? Object.entries(stats.by_status).map(([k, v]) => `<div class="card stat-card"><div class="num">${v}</div><div class="lbl">${esc(k)}</div></div>`).join("")
      : "";

    const body = `
<div class="ph"><div><h2>Overview</h2><span class="ph-sub">System status and project summary</span></div></div>
<div class="content">
  <div class="grid2">
    <div class="card"><div class="card-h">System</div>
      <div class="info-row"><span class="info-l">Engine version</span><span class="info-v">${esc(config.DECISION_ENGINE_VERSION)}</span></div>
      <div class="info-row"><span class="info-l">Environment</span><span class="info-v">${esc(config.NODE_ENV)}</span></div>
      <div class="info-row"><span class="info-l">Auth required</span><span class="info-v">${config.CAF_CORE_REQUIRE_AUTH ? "Yes" : "No"}</span></div>
      <div class="info-row"><span class="info-l">Port</span><span class="info-v">${config.PORT}</span></div>
    </div>
    <div class="card"><div class="card-h">Project</div>
      ${project ? `
      <div class="info-row"><span class="info-l">Slug</span><span class="info-v mono">${esc(project.slug)}</span></div>
      <div class="info-row"><span class="info-l">Display name</span><span class="info-v">${esc(project.display_name ?? "—")}</span></div>
      <div class="info-row"><span class="info-l">Active</span><span class="info-v">${project.active ? '<span class="badge badge-g">Active</span>' : '<span class="badge badge-r">Inactive</span>'}</span></div>
      <div class="info-row"><span class="info-l">ID</span><span class="info-v mono" style="font-size:11px">${esc(project.id)}</span></div>
      ` : `<div class="empty">Project "${PROJECT_SLUG}" not found. It will be created on first API call.</div>`}
    </div>
  </div>

  ${stats ? `
  <div class="card"><div class="card-h">Job Stats</div>
    <div class="grid3">
      <div class="stat-card"><div class="num">${stats.total}</div><div class="lbl">Total jobs</div></div>
      <div class="stat-card"><div class="num">${stats.today}</div><div class="lbl">Created today</div></div>
      <div class="stat-card"><div class="num">${runCount}</div><div class="lbl">Total runs</div></div>
    </div>
  </div>
  <div class="card"><div class="card-h">Jobs by Status</div>
    <div class="grid3">${statusCards || '<div class="empty">No jobs yet</div>'}</div>
  </div>
  ` : ""}

  ${constraints ? `
  <div class="card"><div class="card-h">System Constraints</div>
    <div class="info-row"><span class="info-l">Max daily jobs</span><span class="info-v">${constraints.max_daily_jobs ?? "—"}</span></div>
    <div class="info-row"><span class="info-l">Min score to generate</span><span class="info-v">${constraints.min_score_to_generate ?? "—"}</span></div>
    <div class="info-row"><span class="info-l">Max active prompt versions</span><span class="info-v">${constraints.max_active_prompt_versions ?? "—"}</span></div>
    <div class="info-row"><span class="info-l">Default variation cap</span><span class="info-v">${constraints.default_variation_cap}</span></div>
    <div class="info-row"><span class="info-l">Auto-validation pass threshold</span><span class="info-v">${constraints.auto_validation_pass_threshold ?? "—"}</span></div>
  </div>
  ` : ""}

  <div class="card"><div class="card-h">Scoring Weights (env defaults)</div>
    <div class="info-row"><span class="info-l">Confidence</span><span class="info-v">${config.SCORE_WEIGHT_CONFIDENCE}</span></div>
    <div class="info-row"><span class="info-l">Platform fit</span><span class="info-v">${config.SCORE_WEIGHT_PLATFORM_FIT}</span></div>
    <div class="info-row"><span class="info-l">Novelty</span><span class="info-v">${config.SCORE_WEIGHT_NOVELTY}</span></div>
    <div class="info-row"><span class="info-l">Past performance</span><span class="info-v">${config.SCORE_WEIGHT_PAST_PERF}</span></div>
  </div>
</div>`;
    reply.type("text/html").send(page("Overview", "overview", body));
  });

  // --- Runs ---
  app.get("/admin/runs", async (_, reply) => {
    const body = `
<div class="ph"><div><h2>Runs</h2><span class="ph-sub">All generation runs</span></div></div>
<div class="content">
  <div id="runs-table"><div class="empty">Loading...</div></div>
  <div class="page-btns" id="runs-pager"></div>
</div>
<script>
let runsPage=1;
async function loadRuns(p){
  runsPage=p||1;
  const r=await fetch('/v1/admin/runs?page='+runsPage+'&limit=50');
  const d=await r.json();
  if(!d.ok){document.getElementById('runs-table').innerHTML='<div class="empty">'+d.error+'</div>';return;}
  if(!d.runs.length){document.getElementById('runs-table').innerHTML='<div class="empty">No runs yet</div>';return;}
  let h='<table><thead><tr><th>Run ID</th><th>Status</th><th>Created</th><th>Started</th><th>Completed</th><th>Total jobs</th><th>Completed</th></tr></thead><tbody>';
  for(const r of d.runs){
    h+='<tr><td class="mono" style="color:var(--accent)"><a href="/admin/jobs?run_id='+encodeURIComponent(r.run_id)+'">'+esc(r.run_id)+'</a></td>';
    h+='<td>'+badge(r.status)+'</td>';
    h+='<td>'+fmtDate(r.created_at)+'</td><td>'+fmtDate(r.started_at)+'</td><td>'+fmtDate(r.completed_at)+'</td>';
    h+='<td>'+r.total_jobs+'</td><td>'+r.jobs_completed+'</td></tr>';
  }
  h+='</tbody></table>';
  document.getElementById('runs-table').innerHTML=h;
  const totalPages=Math.ceil(d.total/d.limit);
  let pg='<span>Page '+d.page+' of '+totalPages+' ('+d.total+' total)</span>';
  if(d.page>1)pg+=' <button class="btn-ghost" onclick="loadRuns('+(d.page-1)+')">Prev</button>';
  if(d.page<totalPages)pg+=' <button class="btn-ghost" onclick="loadRuns('+(d.page+1)+')">Next</button>';
  document.getElementById('runs-pager').innerHTML=pg;
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function badge(s){
  const u=(s||'').toUpperCase();
  let c='badge-b';
  if(u.includes('COMPLETE')||u==='APPROVED')c='badge-g';
  else if(u==='FAILED'||u==='CANCELLED')c='badge-r';
  else if(u==='PLANNING'||u==='GENERATING'||u==='RENDERING')c='badge-y';
  return '<span class="badge '+c+'">'+esc(s||'—')+'</span>';
}
function fmtDate(d){if(!d)return '—';try{return new Date(d).toLocaleString()}catch{return d}}
loadRuns(1);
</script>`;
    reply.type("text/html").send(page("Runs", "runs", body));
  });

  // --- Jobs ---
  app.get("/admin/jobs", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const initialRunId = query.run_id || "";

    const body = `
<div class="ph"><div><h2>Jobs</h2><span class="ph-sub">All content jobs — your Google Sheets replacement</span></div></div>
<div class="content">
  <div class="filter-row" id="filters">
    <div><label>Search</label><input type="text" id="f-search" placeholder="task_id or run_id..." value=""></div>
    <div><label>Status</label><select id="f-status"><option value="">All</option></select></div>
    <div><label>Platform</label><select id="f-platform"><option value="">All</option></select></div>
    <div><label>Flow type</label><select id="f-flow"><option value="">All</option></select></div>
    <div><label>Run ID</label><select id="f-run"><option value="">All</option></select></div>
    <div><button class="btn" onclick="loadJobs(1)">Filter</button></div>
  </div>
  <div id="jobs-table"><div class="empty">Loading...</div></div>
  <div class="page-btns" id="jobs-pager"></div>
</div>
<script>
const initRunId="${esc(initialRunId)}";
let jobsPage=1;
async function loadFacets(){
  const r=await fetch('/v1/admin/jobs/facets');const d=await r.json();
  if(!d.ok)return;
  fillSelect('f-status',d.statuses);
  fillSelect('f-platform',d.platforms);
  fillSelect('f-flow',d.flow_types);
  fillSelect('f-run',d.run_ids);
  if(initRunId)document.getElementById('f-run').value=initRunId;
}
function fillSelect(id,vals){
  const el=document.getElementById(id);
  for(const v of vals){const o=document.createElement('option');o.value=v;o.textContent=v;el.appendChild(o);}
}
async function loadJobs(p){
  jobsPage=p||1;
  const params=new URLSearchParams();
  params.set('page',String(jobsPage));params.set('limit','50');
  const search=document.getElementById('f-search').value.trim();if(search)params.set('search',search);
  const status=document.getElementById('f-status').value;if(status)params.set('status',status);
  const platform=document.getElementById('f-platform').value;if(platform)params.set('platform',platform);
  const flow=document.getElementById('f-flow').value;if(flow)params.set('flow_type',flow);
  const run=document.getElementById('f-run').value;if(run)params.set('run_id',run);
  const r=await fetch('/v1/admin/jobs?'+params.toString());const d=await r.json();
  if(!d.ok){document.getElementById('jobs-table').innerHTML='<div class="empty">'+d.error+'</div>';return;}
  if(!d.rows.length){document.getElementById('jobs-table').innerHTML='<div class="empty">No jobs match filters</div>';return;}
  let h='<table><thead><tr><th>Task ID</th><th>Run</th><th>Platform</th><th>Flow</th><th>Status</th><th>Route</th><th>Score</th><th>QC</th><th>Created</th></tr></thead><tbody>';
  for(const j of d.rows){
    h+='<tr><td class="mono" style="color:var(--accent);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(j.task_id)+'">'+esc(j.task_id)+'</td>';
    h+='<td class="mono" style="font-size:11px">'+esc(j.run_id||'—')+'</td>';
    h+='<td>'+esc(j.platform||'—')+'</td><td>'+esc(j.flow_type||'—')+'</td>';
    h+='<td>'+badge(j.status)+'</td>';
    h+='<td>'+esc(j.recommended_route||'—')+'</td>';
    h+='<td>'+esc(j.pre_gen_score||'—')+'</td>';
    h+='<td>'+esc(j.qc_status||'—')+'</td>';
    h+='<td>'+fmtDate(j.created_at)+'</td></tr>';
  }
  h+='</tbody></table>';
  document.getElementById('jobs-table').innerHTML=h;
  const totalPages=Math.ceil(d.total/d.limit);
  let pg='<span>Page '+d.page+' of '+totalPages+' ('+d.total+' total)</span>';
  if(d.page>1)pg+=' <button class="btn-ghost" onclick="loadJobs('+(d.page-1)+')">Prev</button>';
  if(d.page<totalPages)pg+=' <button class="btn-ghost" onclick="loadJobs('+(d.page+1)+')">Next</button>';
  document.getElementById('jobs-pager').innerHTML=pg;
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function badge(s){
  const u=(s||'').toUpperCase();let c='badge-b';
  if(u.includes('APPROVED')||u.includes('COMPLETE'))c='badge-g';
  else if(u==='REJECTED'||u==='FAILED')c='badge-r';
  else if(u.includes('EDIT')||u==='GENERATING'||u==='RENDERING')c='badge-y';
  return '<span class="badge '+c+'">'+esc(s||'—')+'</span>';
}
function fmtDate(d){if(!d)return '—';try{return new Date(d).toLocaleString()}catch{return d}}
loadFacets().then(()=>loadJobs(1));
</script>`;
    reply.type("text/html").send(page("Jobs", "jobs", body));
  });

  // --- Decision Engine ---
  app.get("/admin/engine", async (_, reply) => {
    const body = `
<div class="ph"><div><h2>Decision Engine</h2><span class="ph-sub">Suppression, learning, prompts, and traces</span></div></div>
<div class="content" id="engine-content"><div class="empty">Loading...</div></div>
<script>
async function loadEngine(){
  const r=await fetch('/v1/admin/engine');const d=await r.json();
  if(!d.ok){document.getElementById('engine-content').innerHTML='<div class="empty">'+d.error+'</div>';return;}
  let h='';

  // Scoring weights
  h+='<div class="card"><div class="card-h">Scoring Weights (v'+esc(d.engine_version)+')</div>';
  const w=d.scoring_weights;
  h+='<div class="info-row"><span class="info-l">Confidence</span><span class="info-v">'+w.confidence+'</span></div>';
  h+='<div class="info-row"><span class="info-l">Platform fit</span><span class="info-v">'+w.platform_fit+'</span></div>';
  h+='<div class="info-row"><span class="info-l">Novelty</span><span class="info-v">'+w.novelty+'</span></div>';
  h+='<div class="info-row"><span class="info-l">Past performance</span><span class="info-v">'+w.past_performance+'</span></div>';
  h+='</div>';

  // Suppression rules
  h+='<div class="card"><div class="card-h">Suppression Rules ('+d.suppression_rules.length+')</div>';
  if(d.suppression_rules.length){
    h+='<table><thead><tr><th>Type</th><th>Scope</th><th>Threshold</th><th>Window</th><th>Action</th><th>Active</th></tr></thead><tbody>';
    for(const r of d.suppression_rules){
      const scope=[r.scope_flow_type,r.scope_platform].filter(Boolean).join(' / ')||'—';
      h+='<tr><td>'+esc(r.rule_type)+'</td><td>'+esc(scope)+'</td><td>'+esc(r.threshold_numeric||'—')+'</td>';
      h+='<td>'+(r.window_days||'—')+' days</td><td>'+esc(r.action)+'</td>';
      h+='<td>'+(r.active?'<span class="badge badge-g">Active</span>':'<span class="badge badge-r">Inactive</span>')+'</td></tr>';
    }
    h+='</tbody></table>';
  }else h+='<div class="empty">No suppression rules</div>';
  h+='</div>';

  // Learning rules
  h+='<div class="card"><div class="card-h">Learning Rules ('+d.learning_rules.length+')</div>';
  if(d.learning_rules.length){
    h+='<table><thead><tr><th>Rule ID</th><th>Trigger</th><th>Scope</th><th>Action</th><th>Status</th><th>Applied</th></tr></thead><tbody>';
    for(const r of d.learning_rules){
      const scope=[r.scope_flow_type,r.scope_platform].filter(Boolean).join(' / ')||'—';
      h+='<tr><td class="mono">'+esc(r.rule_id)+'</td><td>'+esc(r.trigger_type)+'</td><td>'+esc(scope)+'</td>';
      h+='<td>'+esc(r.action_type)+'</td><td>'+badge(r.status)+'</td>';
      h+='<td>'+fmtDate(r.applied_at)+'</td></tr>';
    }
    h+='</tbody></table>';
  }else h+='<div class="empty">No learning rules</div>';
  h+='</div>';

  // Prompt versions
  h+='<div class="card"><div class="card-h">Prompt Versions ('+d.prompt_versions.length+')</div>';
  if(d.prompt_versions.length){
    h+='<table><thead><tr><th>Prompt ID</th><th>Version</th><th>Flow Type</th><th>Status</th><th>Created</th></tr></thead><tbody>';
    for(const p of d.prompt_versions){
      h+='<tr><td class="mono">'+esc(p.prompt_id)+'</td><td>'+esc(p.version)+'</td>';
      h+='<td>'+esc(p.flow_type)+'</td><td>'+badge(p.status)+'</td><td>'+fmtDate(p.created_at)+'</td></tr>';
    }
    h+='</tbody></table>';
  }else h+='<div class="empty">No prompt versions</div>';
  h+='</div>';

  // Decision traces
  h+='<div class="card"><div class="card-h">Recent Decision Traces (last '+d.decision_traces.length+')</div>';
  if(d.decision_traces.length){
    h+='<table><thead><tr><th>Trace ID</th><th>Run</th><th>Engine</th><th>Created</th><th>Details</th></tr></thead><tbody>';
    for(const t of d.decision_traces){
      h+='<tr><td class="mono" style="font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(t.trace_id)+'">'+esc(t.trace_id)+'</td>';
      h+='<td class="mono" style="font-size:11px">'+esc(t.run_id||'—')+'</td><td>'+esc(t.engine_version)+'</td><td>'+fmtDate(t.created_at)+'</td>';
      h+='<td><details><summary style="cursor:pointer;color:var(--accent);font-size:12px">View</summary>';
      h+='<div style="margin-top:8px"><p style="font-size:11px;color:var(--muted);margin-bottom:4px">Input:</p><pre class="json">'+esc(JSON.stringify(t.input_snapshot,null,2))+'</pre>';
      h+='<p style="font-size:11px;color:var(--muted);margin:8px 0 4px">Output:</p><pre class="json">'+esc(JSON.stringify(t.output_snapshot,null,2))+'</pre></div>';
      h+='</details></td></tr>';
    }
    h+='</tbody></table>';
  }else h+='<div class="empty">No decision traces</div>';
  h+='</div>';

  document.getElementById('engine-content').innerHTML=h;
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function badge(s){
  const u=(s||'').toUpperCase();let c='badge-b';
  if(u==='ACTIVE'||u==='APPROVED')c='badge-g';
  else if(u==='PENDING'||u==='TEST')c='badge-y';
  else if(u==='INACTIVE'||u==='DEPRECATED')c='badge-r';
  return '<span class="badge '+c+'">'+esc(s||'—')+'</span>';
}
function fmtDate(d){if(!d)return '—';try{return new Date(d).toLocaleString()}catch{return d}}
loadEngine();
</script>`;
    reply.type("text/html").send(page("Decision Engine", "engine", body));
  });

  // --- Project Config ---
  app.get("/admin/config", async (_, reply) => {
    const body = `
<div class="ph"><div><h2>Project Config</h2><span class="ph-sub">Constraints, strategy, brand, platforms, and flow types</span></div></div>
<div class="content" id="config-content"><div class="empty">Loading...</div></div>
<script>
async function loadConfig(){
  const r=await fetch('/v1/admin/config');const d=await r.json();
  if(!d.ok){document.getElementById('config-content').innerHTML='<div class="empty">'+(d.error||'Error')+'</div>';return;}
  let h='';

  // System constraints (editable)
  const c=d.constraints||{};
  h+='<div class="card"><div class="card-h">System Constraints <span style="font-size:11px;color:var(--fg2);text-transform:none;letter-spacing:0;font-weight:400">(editable)</span></div>';
  h+='<form id="constraints-form">';
  h+=fg('max_daily_jobs','Max daily jobs',c.max_daily_jobs||'','number');
  h+=fg('min_score_to_generate','Min score to generate',c.min_score_to_generate||'','number','0.01');
  h+=fg('max_active_prompt_versions','Max active prompt versions',c.max_active_prompt_versions||'','number');
  h+=fg('default_variation_cap','Default variation cap',c.default_variation_cap||1,'number');
  h+=fg('auto_validation_pass_threshold','Auto-validation pass threshold',c.auto_validation_pass_threshold||'','number','0.01');
  h+='<button type="submit" class="btn" style="margin-top:8px">Save constraints</button>';
  h+='<span id="constraints-msg" style="margin-left:12px;font-size:13px"></span>';
  h+='</form></div>';

  // Strategy defaults
  const s=d.profile?.strategy;
  h+='<div class="card"><div class="card-h">Strategy Defaults</div>';
  if(s){
    const fields=['project_type','core_offer','target_audience','audience_problem','transformation_promise',
      'positioning_statement','primary_business_goal','primary_content_goal','north_star_metric',
      'monetization_model','traffic_destination','funnel_stage_focus','brand_archetype',
      'strategic_content_pillars','authority_angle','differentiation_angle','growth_strategy',
      'publishing_intensity','time_horizon','owner','notes'];
    for(const f of fields)h+='<div class="info-row"><span class="info-l">'+f.replace(/_/g,' ')+'</span><span class="info-v">'+esc(s[f]||'—')+'</span></div>';
  }else h+='<div class="empty">No strategy defaults configured</div>';
  h+='</div>';

  // Brand constraints
  const b=d.profile?.brand;
  h+='<div class="card"><div class="card-h">Brand Constraints</div>';
  if(b){
    const fields=['tone','voice_style','audience_level','emotional_intensity','humor_level',
      'emoji_policy','max_emojis_per_caption','banned_claims','banned_words','mandatory_disclaimers',
      'cta_style_rules','storytelling_style','positioning_statement','differentiation_angle',
      'risk_level_default','manual_review_required','notes'];
    for(const f of fields)h+='<div class="info-row"><span class="info-l">'+f.replace(/_/g,' ')+'</span><span class="info-v">'+esc(String(b[f]??'—'))+'</span></div>';
  }else h+='<div class="empty">No brand constraints configured</div>';
  h+='</div>';

  // Platform constraints
  const pl=d.profile?.platforms||[];
  h+='<div class="card"><div class="card-h">Platform Constraints ('+pl.length+')</div>';
  if(pl.length){
    h+='<table><thead><tr><th>Platform</th><th>Caption max</th><th>Hook max</th><th>Slides</th><th>Hashtags</th><th>Frequency</th></tr></thead><tbody>';
    for(const p of pl){
      h+='<tr><td><strong>'+esc(p.platform)+'</strong></td><td>'+esc(p.caption_max_chars||'—')+'</td>';
      h+='<td>'+esc(p.hook_max_chars||'—')+'</td>';
      h+='<td>'+(p.slide_min||'—')+' – '+(p.slide_max||'—')+'</td>';
      h+='<td>'+esc(p.max_hashtags||'—')+'</td>';
      h+='<td>'+esc(p.posting_frequency_limit||'—')+'</td></tr>';
    }
    h+='</tbody></table>';
  }else h+='<div class="empty">No platform constraints</div>';
  h+='</div>';

  // Allowed flow types
  const ft=d.profile?.flow_types||[];
  h+='<div class="card"><div class="card-h">Allowed Flow Types ('+ft.length+')</div>';
  if(ft.length){
    h+='<table><thead><tr><th>Flow type</th><th>Enabled</th><th>Variations</th><th>Priority</th><th>Platforms</th></tr></thead><tbody>';
    for(const f of ft){
      h+='<tr><td><strong>'+esc(f.flow_type)+'</strong></td>';
      h+='<td>'+(f.enabled?'<span class="badge badge-g">Yes</span>':'<span class="badge badge-r">No</span>')+'</td>';
      h+='<td>'+f.default_variation_count+'</td><td>'+esc(f.priority_weight||'—')+'</td>';
      h+='<td>'+esc(f.allowed_platforms||'—')+'</td></tr>';
    }
    h+='</tbody></table>';
  }else h+='<div class="empty">No flow types configured</div>';
  h+='</div>';

  // Risk rules
  const rr=d.profile?.risk_rules||[];
  h+='<div class="card"><div class="card-h">Risk Rules ('+rr.length+')</div>';
  if(rr.length){
    h+='<table><thead><tr><th>Flow type</th><th>Risk level</th><th>Auto-approve</th><th>Manual review</th><th>Escalation</th></tr></thead><tbody>';
    for(const r of rr){
      h+='<tr><td>'+esc(r.flow_type)+'</td><td>'+esc(r.risk_level||'—')+'</td>';
      h+='<td>'+(r.auto_approve_allowed?'Yes':'No')+'</td>';
      h+='<td>'+(r.requires_manual_review?'Yes':'No')+'</td>';
      h+='<td>'+esc(r.escalation_level||'—')+'</td></tr>';
    }
    h+='</tbody></table>';
  }else h+='<div class="empty">No risk rules</div>';
  h+='</div>';

  // Reference posts
  const rp=d.profile?.reference_posts||[];
  if(rp.length){
    h+='<div class="card"><div class="card-h">Reference Posts ('+rp.length+')</div>';
    h+='<table><thead><tr><th>Post ID</th><th>Platform</th><th>Status</th><th>URL</th></tr></thead><tbody>';
    for(const p of rp){
      h+='<tr><td class="mono">'+esc(p.reference_post_id)+'</td><td>'+esc(p.platform||'—')+'</td>';
      h+='<td>'+badge(p.status)+'</td>';
      h+='<td>'+(p.post_url?'<a href="'+esc(p.post_url)+'" target="_blank">Link</a>':'—')+'</td></tr>';
    }
    h+='</tbody></table></div>';
  }

  document.getElementById('config-content').innerHTML=h;

  // Constraints form handler
  document.getElementById('constraints-form')?.addEventListener('submit',async(e)=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const body={};
    for(const[k,v]of fd.entries())body[k]=v===''?null:Number(v);
    const msg=document.getElementById('constraints-msg');
    msg.textContent='Saving...';msg.style.color='var(--accent)';
    const r=await fetch('/v1/admin/config/constraints',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();
    if(d.ok){msg.textContent='Saved!';msg.style.color='var(--green)'}
    else{msg.textContent=d.error||'Failed';msg.style.color='var(--red)'}
    setTimeout(()=>msg.textContent='',3000);
  });
}
function fg(name,label,value,type,step){
  return '<div class="form-group"><label for="'+name+'">'+label+'</label>'
    +'<input type="'+(type||'text')+'" name="'+name+'" id="'+name+'" value="'+esc(value)+'"'
    +(step?' step="'+step+'"':'')
    +' style="max-width:300px"></div>';
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function badge(s){
  const u=(s||'').toUpperCase();let c='badge-b';
  if(u==='ACTIVE'||u==='APPROVED')c='badge-g';
  else if(u==='PENDING'||u==='SCRAPED')c='badge-y';
  else if(u==='INACTIVE'||u==='DEPRECATED')c='badge-r';
  return '<span class="badge '+c+'">'+esc(s||'—')+'</span>';
}
function fmtDate(d){if(!d)return '—';try{return new Date(d).toLocaleString()}catch{return d}}
loadConfig();
</script>`;
    reply.type("text/html").send(page("Project Config", "config", body));
  });
}
