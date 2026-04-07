import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import {
  getProjectBySlug,
  ensureProject,
  getConstraints,
  upsertConstraints,
  mergeConstraintUpdate,
  type ConstraintsPatch,
} from "../repositories/core.js";
import { listRuns, getRunByRunId } from "../repositories/runs.js";
import { listLearningRules } from "../repositories/learning.js";
import {
  getFullProjectProfile, upsertStrategyDefaults, upsertBrandConstraints,
  upsertPlatformConstraints, deletePlatformConstraint,
  upsertRiskRule, deleteRiskRule,
  upsertAllowedFlowType, deleteAllowedFlowType,
  upsertReferencePost, deleteReferencePost,
  upsertHeygenConfig, deleteHeygenConfig,
} from "../repositories/project-config.js";
import {
  listFlowDefinitions, upsertFlowDefinition, deleteFlowDefinition,
  listPromptTemplates, upsertPromptTemplate, deletePromptTemplate,
  listOutputSchemas, upsertOutputSchema, deleteOutputSchema,
  listCarouselTemplates, upsertCarouselTemplate, deleteCarouselTemplate,
  listQcChecks, upsertQcCheck, deleteQcChecklist,
  listRiskPolicies, upsertRiskPolicy, deleteRiskPolicy,
} from "../repositories/flow-engine.js";
import { q } from "../db/queries.js";
import {
  getJobStats,
  listJobs,
  getJobAdminDetail,
  listDecisionTraces,
  listAllPromptVersions,
  listAllSuppressionRules,
  getRunCount,
  getJobFacets,
  listDecisionTracesForRun,
} from "../repositories/admin.js";
import { listApiCallAuditsForTask, listApiCallAuditsForRun } from "../repositories/api-call-audit.js";
import { getSignalPackById } from "../repositories/signal-packs.js";
import { buildJobContentPreview } from "../services/content-transparency-preview.js";
import { buildTransparencyTraceView } from "../services/planning-transparency.js";

interface Deps { db: Pool; config: AppConfig; }

interface ProjectRow { id: string; slug: string; display_name: string | null; active: boolean; }

async function listProjects(db: Pool): Promise<ProjectRow[]> {
  return q<ProjectRow>(db, `SELECT id, slug, display_name, active FROM caf_core.projects ORDER BY slug`);
}

/** Trim and strip CR/LF (pasted URLs / form noise); empty → undefined */
function normalizeProjectSlugParam(slug: string | undefined | null): string | undefined {
  if (slug == null) return undefined;
  const cleaned = String(slug).replace(/[\r\n\t\v\f\u0085\u2028\u2029]+/g, "").trim();
  return cleaned === "" ? undefined : cleaned;
}

async function resolveProject(db: Pool, slugParam: string | undefined): Promise<ProjectRow | null> {
  const slug = normalizeProjectSlugParam(slugParam);
  if (!slug) {
    const projects = await listProjects(db);
    return projects[0] ?? null;
  }
  return getProjectBySlug(db, slug);
}

// ── Shared HTML helpers ────────────────────────────────────────────────────

function css(): string {
  return `
:root{--bg:#09090b;--bg2:#0f0f12;--fg:#fafafa;--fg2:#a1a1aa;--accent:#3b82f6;--accent2:#2563eb;
--card:#141418;--card2:#1a1a1f;--border:#27272a;--border2:#1e1e22;--muted:#71717a;
--green:#22c55e;--green-bg:rgba(34,197,94,.1);--red:#ef4444;--red-bg:rgba(239,68,68,.1);
--yellow:#eab308;--yellow-bg:rgba(234,179,8,.1);--blue-bg:rgba(59,130,246,.1);--purple:#a855f7;--purple-bg:rgba(168,85,247,.1);
--sidebar:260px}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--fg);min-height:100vh;
font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;font-size:14px;line-height:1.5}
a{color:var(--accent);text-decoration:none}a:hover{color:var(--accent2)}
.shell{display:flex;min-height:100vh}
.sb{width:var(--sidebar);background:var(--bg2);border-right:1px solid var(--border);position:fixed;top:0;left:0;bottom:0;z-index:50;display:flex;flex-direction:column;overflow-y:auto}
.sb-brand{padding:20px 20px 16px;border-bottom:1px solid var(--border)}
.sb-brand h1{font-size:15px;font-weight:700;letter-spacing:-.02em}
.sb-brand span{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;display:block;margin-top:2px}
.sb-nav{padding:12px 8px;flex:1;display:flex;flex-direction:column;gap:2px}
.sb-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:16px 12px 6px}
.sb-link{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;font-size:13px;font-weight:500;color:var(--fg2);transition:all .15s;text-decoration:none}
.sb-link:hover{background:var(--card);color:var(--fg);text-decoration:none}
.sb-link.active{background:var(--accent);color:#fff}
.sb-project-sel{margin:12px 8px 0;padding:8px 12px;display:flex;flex-direction:column;gap:6px}
.sb-project-sel label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.sb-project-sel select{background:var(--card);color:var(--fg);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:13px;width:100%;outline:none;font-family:inherit}
.sb-project-sel select:focus{border-color:var(--accent)}
.sb-new-project{display:block;margin:6px 8px 0;padding:7px 12px;border-radius:8px;font-size:12px;font-weight:500;color:var(--accent);background:var(--blue-bg);text-align:center;border:1px solid transparent;cursor:pointer;transition:all .15s}
.sb-new-project:hover{border-color:var(--accent);background:rgba(59,130,246,.15)}
.main{margin-left:var(--sidebar);flex:1;min-width:0}
.ph{display:flex;align-items:center;justify-content:space-between;padding:20px 28px 0}
.ph h2{font-size:22px;font-weight:700;letter-spacing:-.02em}
.ph-sub{font-size:13px;color:var(--muted)}
.content{padding:20px 28px 28px}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:20px;margin-bottom:16px}
.card-h{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--border)}
.info-row{display:flex;justify-content:space-between;padding:7px 0;font-size:13px;border-bottom:1px solid var(--border2)}
.info-row:last-child{border-bottom:none}
.info-l{color:var(--muted);flex-shrink:0;margin-right:12px}.info-v{font-weight:500;text-align:right;word-break:break-word}
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
.btn-sm{padding:5px 12px;font-size:12px}
.btn-danger{background:var(--red);color:#fff}.btn-danger:hover{background:#dc2626}
.btn-ghost{background:transparent;color:var(--fg2);border:1px solid var(--border);font-size:12px;padding:5px 14px}
.btn-ghost:hover{color:var(--fg);border-color:var(--fg2);background:var(--card)}
.filter-row{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;align-items:flex-end}
.filter-row>div{display:flex;flex-direction:column;gap:4px}
.filter-row label{font-size:12px;font-weight:500;color:var(--fg2)}
.filter-row select,.filter-row input{width:180px}
.page-btns{display:flex;gap:8px;margin-top:16px;align-items:center}
.page-btns span{font-size:13px;color:var(--muted)}
pre.json{font-size:11px;overflow:auto;max-height:300px;background:var(--bg);padding:12px;border-radius:8px;border:1px solid var(--border);font-family:'SF Mono','Fira Code',monospace;color:var(--fg2)}
.form-group{margin-bottom:14px;display:flex;flex-direction:column}
.form-group label{display:block;font-size:12px;font-weight:500;color:var(--fg2);margin-bottom:5px}
.config-form{max-width:640px}
.config-form input,.config-form textarea,.config-form select{width:100%}
.config-form textarea{resize:vertical;min-height:60px}
.form-actions{display:flex;align-items:center;gap:12px;margin-top:8px;padding-top:12px;border-top:1px solid var(--border2)}
.form-msg{font-size:13px;font-weight:500}
.tabs{display:flex;gap:2px;padding:16px 28px 0;border-bottom:1px solid var(--border)}
.tab{padding:8px 16px;font-size:13px;font-weight:500;color:var(--fg2);cursor:pointer;border-bottom:2px solid transparent;transition:all .15s;background:none;border-radius:0}
.tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.tab:hover{color:var(--fg)}
.tab-panel{display:none}.tab-panel.active{display:block}
dialog{background:var(--card);color:var(--fg);border:1px solid var(--border);border-radius:12px;padding:24px;max-width:480px;width:90%}
dialog::backdrop{background:rgba(0,0,0,.6)}
dialog h3{font-size:16px;font-weight:600;margin-bottom:16px}
@media(max-width:1024px){.sb{display:none}.main{margin-left:0}}
`;
}

function sidebar(active: string, projects: ProjectRow[], currentSlug: string): string {
  const projectOptions = projects.map(p =>
    `<option value="${esc(p.slug)}"${p.slug === currentSlug ? " selected" : ""}>${esc(p.display_name || p.slug)}${p.active ? "" : " (inactive)"}</option>`
  ).join("");

  const pq = currentSlug ? `?project=${encodeURIComponent(currentSlug)}` : "";

  const projectLinks = [
    { href: `/admin${pq}`, label: "Overview", key: "overview" },
    { href: `/admin/runs${pq}`, label: "Runs", key: "runs" },
    { href: `/admin/jobs${pq}`, label: "Jobs", key: "jobs" },
    { href: `/admin/config${pq}`, label: "Project Config", key: "config" },
  ];

  const globalLinks = [
    { href: "/admin/engine", label: "Decision Engine", key: "engine" },
    { href: "/admin/flow-engine", label: "Flow Engine", key: "flow-engine" },
  ];

  return `<aside class="sb">
  <div class="sb-brand"><h1>CAF Core</h1><span>Admin Dashboard</span></div>
  <div class="sb-project-sel">
    <label>Active project</label>
    <select id="project-sel" onchange="switchProject(this.value)">${projectOptions}</select>
  </div>
  <a href="/admin/new-project" class="sb-new-project">+ New Project</a>
  <nav class="sb-nav">
    <div class="sb-title">Project</div>
    ${projectLinks.map(l => `<a href="${l.href}" class="sb-link${l.key === active ? " active" : ""}">${l.label}</a>`).join("\n    ")}
    <div class="sb-title" style="margin-top:16px">CAF Core</div>
    ${globalLinks.map(l => `<a href="${l.href}" class="sb-link${l.key === active ? " active" : ""}">${l.label}</a>`).join("\n    ")}
    <div class="sb-title" style="margin-top:auto;padding-top:24px">External</div>
    <a href="/" class="sb-link" target="_blank">API Root</a>
    <a href="/health" class="sb-link" target="_blank">Health</a>
  </nav>
</aside>
<script>
function switchProject(slug){
  const s=String(slug||'').replace(/[\r\n\t\v\f\u0085\u2028\u2029]+/g,'').trim();
  const url=new URL(window.location.href);
  if(s)url.searchParams.set('project',s);else url.searchParams.delete('project');
  window.location.href=url.toString();
}
</script>`;
}

function page(title: string, activeSidebar: string, body: string, projects: ProjectRow[], currentSlug: string, headExtra = ""): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — CAF Core</title><style>${css()}</style>${headExtra}</head>
<body><div class="shell">${sidebar(activeSidebar, projects, currentSlug)}<main class="main">${body}</main></div></body></html>`;
}

/** Injected in &lt;head&gt;: global cafFetch() adds x-caf-core-token when CAF_CORE_REQUIRE_AUTH and token are set. */
function adminHeadTokenScript(config: AppConfig): string {
  const tokenJs =
    config.CAF_CORE_REQUIRE_AUTH && config.CAF_CORE_API_TOKEN
      ? `window.__CAF_CORE_FETCH_TOKEN=${JSON.stringify(config.CAF_CORE_API_TOKEN)};`
      : "window.__CAF_CORE_FETCH_TOKEN='';";
  return `<script>${tokenJs}
window.cafFetch=function(u,o){o=o||{};o.headers=Object.assign({},o.headers||{});if(window.__CAF_CORE_FETCH_TOKEN)o.headers["x-caf-core-token"]=window.__CAF_CORE_FETCH_TOKEN;return fetch(u,o);};
</script>`;
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function statusBadge(status: string): string {
  const s = (status || "").toUpperCase().replace(/\s+/g, "_");
  let cls = "badge-b";
  if (s.includes("COMPLETE") || s === "APPROVED" || s === "ACTIVE") cls = "badge-g";
  else if (s === "FAILED" || s === "CANCELLED" || s === "REJECTED" || s === "INACTIVE" || s === "DEPRECATED") cls = "badge-r";
  else if (s.includes("EDIT") || s === "PLANNING" || s === "GENERATING" || s === "RENDERING" || s === "PENDING" || s === "TEST" || s === "SCRAPED") cls = "badge-y";
  return `<span class="badge ${cls}">${esc(status || "—")}</span>`;
}

// ── Route registration ─────────────────────────────────────────────────────

export function registerAdminRoutes(app: FastifyInstance, { db, config }: Deps): void {

  // ── JSON API endpoints ──────────────────────────────────────────────

  app.get("/v1/admin/projects", async () => {
    const projects = await listProjects(db);
    return { ok: true, projects };
  });

  app.post("/v1/admin/projects", async (request) => {
    const body = request.body as Record<string, unknown>;
    const slug = String(body.slug || "").trim().toUpperCase();
    const displayName = String(body.display_name || slug).trim();
    if (!slug) return { ok: false, error: "Slug is required" };
    if (slug.length < 2 || slug.length > 30) return { ok: false, error: "Slug must be 2-30 characters" };
    const project = await ensureProject(db, slug, displayName);
    return { ok: true, project };
  });

  app.get("/v1/admin/stats", async (request) => {
    const query = request.query as Record<string, string>;
    const project = await resolveProject(db, query.project);
    if (!project) return { ok: false, error: "Project not found" };
    const stats = await getJobStats(db, project.id);
    return { ok: true, stats };
  });

  app.get("/v1/admin/jobs", async (request) => {
    const query = request.query as Record<string, string>;
    const project = await resolveProject(db, query.project);
    if (!project) return { ok: false, error: "Project not found" };
    const pg = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "50", 10)));
    const offset = (pg - 1) * limit;
    const result = await listJobs(db, project.id, {
      status: query.status || undefined,
      platform: query.platform || undefined,
      flow_type: query.flow_type || undefined,
      run_id: query.run_id || undefined,
      search: query.search || undefined,
    }, limit, offset);
    return { ok: true, ...result, page: pg, limit };
  });

  app.get("/v1/admin/job", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const taskId = query.task_id?.trim();
    if (!taskId) return reply.code(400).send({ ok: false, error: "task_id required" });
    const project = await resolveProject(db, query.project);
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });
    const detail = await getJobAdminDetail(db, project.id, taskId);
    if (!detail) return reply.code(404).send({ ok: false, error: "job_not_found" });
    const gp = detail.job.generation_payload;
    const content_preview = buildJobContentPreview(
      detail.job.flow_type != null ? String(detail.job.flow_type) : null,
      gp
    );
    const api_audit = await listApiCallAuditsForTask(db, project.id, taskId, 120);
    return { ok: true, job: detail.job, transitions: detail.transitions, content_preview, api_audit };
  });

  app.get("/v1/admin/signal-pack", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const id = query.id?.trim();
    if (!id) return reply.code(400).send({ ok: false, error: "id required" });
    const project = await resolveProject(db, query.project);
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });
    const pack = await getSignalPackById(db, id);
    if (!pack || pack.project_id !== project.id) {
      return reply.code(404).send({ ok: false, error: "signal_pack_not_found" });
    }
    return { ok: true, signal_pack: pack };
  });

  /** Signal-pack rows in DB + decision traces (planner candidates × flows) + run-level API audit. */
  app.get("/v1/admin/run-transparency", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const runIdText = query.run_id?.trim();
    if (!runIdText) return reply.code(400).send({ ok: false, error: "run_id required" });
    const project = await resolveProject(db, query.project);
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });
    const run = await getRunByRunId(db, project.id, runIdText);
    if (!run) return reply.code(404).send({ ok: false, error: "run_not_found" });

    let signalPack: Awaited<ReturnType<typeof getSignalPackById>> = null;
    if (run.signal_pack_id) signalPack = await getSignalPackById(db, run.signal_pack_id);

    const traceRows = await listDecisionTracesForRun(db, project.id, run.run_id, 15);
    const planning_traces = traceRows.map((t) => ({
      trace_id: t.trace_id,
      created_at: t.created_at,
      engine_version: t.engine_version,
      view: buildTransparencyTraceView(t.input_snapshot, t.output_snapshot, {
        trace_id: t.trace_id,
        created_at: t.created_at,
        engine_version: t.engine_version,
      }),
      input_snapshot: t.input_snapshot,
      output_snapshot: t.output_snapshot,
    }));

    const api_audits = await listApiCallAuditsForRun(db, project.id, run.run_id, 150);

    return {
      ok: true,
      run: {
        run_id: run.run_id,
        status: run.status,
        signal_pack_id: run.signal_pack_id,
        total_jobs: run.total_jobs,
        jobs_completed: run.jobs_completed,
      },
      notes: {
        stored_signal_pack:
          "Rows below are exactly what is in Postgres (upload). Scene-router may add seeds only in memory at Start — see newest planning trace + api_audits step llm_scene_assembly_candidate_router.",
        planner:
          "Each planning trace 'candidates' list is signal-pack rows × enabled flow types (after router), with outcome planned/dropped/unknown.",
        jobs:
          "Per-job LLM prompts and renders: open Jobs, expand a task row → Content preview + API & LLM audit.",
      },
      signal_pack_overall_candidates: signalPack?.overall_candidates_json ?? [],
      signal_pack_meta: signalPack
        ? {
            id: signalPack.id,
            source_window: signalPack.source_window,
            upload_filename: signalPack.upload_filename,
            notes: signalPack.notes,
          }
        : null,
      planning_traces,
      api_audits,
    };
  });

  app.get("/v1/admin/jobs/facets", async (request) => {
    const query = request.query as Record<string, string>;
    const project = await resolveProject(db, query.project);
    if (!project) return { ok: false, error: "Project not found" };
    return { ok: true, ...(await getJobFacets(db, project.id)) };
  });

  app.get("/v1/admin/runs", async (request) => {
    const query = request.query as Record<string, string>;
    const project = await resolveProject(db, query.project);
    if (!project) return { ok: false, error: "Project not found" };
    const pg = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "50", 10)));
    const offset = (pg - 1) * limit;
    const runs = await listRuns(db, project.id, limit, offset);
    const totalCount = await getRunCount(db, project.id);
    return { ok: true, runs, total: totalCount, page: pg, limit };
  });

  app.get("/v1/admin/engine", async (request) => {
    const query = request.query as Record<string, string>;
    const project = await resolveProject(db, query.project);
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

  app.get("/v1/admin/config", async (request) => {
    const query = request.query as Record<string, string>;
    const slug = normalizeProjectSlugParam(query.project);
    const project = slug ? await ensureProject(db, slug) : await resolveProject(db, undefined);
    if (!project) return { ok: false, error: "No projects exist. Create one first." };
    const [constraints, profile] = await Promise.all([
      getConstraints(db, project.id),
      getFullProjectProfile(db, project.id),
    ]);
    return { ok: true, project, constraints, profile };
  });

  app.post("/v1/admin/config/constraints", async (request) => {
    const body = request.body as Record<string, unknown>;
    const slug = normalizeProjectSlugParam(String(body._project ?? ""));
    const project = slug ? await ensureProject(db, slug) : await resolveProject(db, undefined);
    if (!project) return { ok: false, error: "Project not found" };
    const existing = await getConstraints(db, project.id);
    const optNum = (k: string): number | null | undefined => {
      if (!(k in body)) return undefined;
      const v = body[k];
      if (v === "" || v === null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const patch: ConstraintsPatch = {
      max_daily_jobs: optNum("max_daily_jobs"),
      min_score_to_generate: optNum("min_score_to_generate"),
      max_active_prompt_versions: optNum("max_active_prompt_versions"),
      default_variation_cap: optNum("default_variation_cap"),
      auto_validation_pass_threshold: optNum("auto_validation_pass_threshold"),
      max_carousel_jobs_per_run: optNum("max_carousel_jobs_per_run"),
      max_video_jobs_per_run: optNum("max_video_jobs_per_run"),
    };
    if ("max_jobs_per_flow_type" in body) {
      patch.max_jobs_per_flow_type = body.max_jobs_per_flow_type;
    }
    await upsertConstraints(db, project.id, mergeConstraintUpdate(existing, patch));
    return { ok: true };
  });

  app.post("/v1/admin/config/strategy", async (request) => {
    const b = request.body as Record<string, unknown>;
    const slug = normalizeProjectSlugParam(String(b._project ?? ""));
    const project = slug ? await ensureProject(db, slug) : await resolveProject(db, undefined);
    if (!project) return { ok: false, error: "Project not found" };
    const str = (k: string) => (b[k] != null && String(b[k]).trim() !== "") ? String(b[k]) : null;
    await upsertStrategyDefaults(db, project.id, {
      project_type: str("project_type"), core_offer: str("core_offer"),
      target_audience: str("target_audience"), audience_problem: str("audience_problem"),
      transformation_promise: str("transformation_promise"), positioning_statement: str("positioning_statement"),
      primary_business_goal: str("primary_business_goal"), primary_content_goal: str("primary_content_goal"),
      north_star_metric: str("north_star_metric"), monetization_model: str("monetization_model"),
      traffic_destination: str("traffic_destination"), funnel_stage_focus: str("funnel_stage_focus"),
      brand_archetype: str("brand_archetype"), strategic_content_pillars: str("strategic_content_pillars"),
      authority_angle: str("authority_angle"), differentiation_angle: str("differentiation_angle"),
      growth_strategy: str("growth_strategy"), publishing_intensity: str("publishing_intensity"),
      time_horizon: str("time_horizon"), owner: str("owner"), notes: str("notes"),
    });
    return { ok: true };
  });

  app.post("/v1/admin/config/brand", async (request) => {
    const b = request.body as Record<string, unknown>;
    const slug = normalizeProjectSlugParam(String(b._project ?? ""));
    const project = slug ? await ensureProject(db, slug) : await resolveProject(db, undefined);
    if (!project) return { ok: false, error: "Project not found" };
    const str = (k: string) => (b[k] != null && String(b[k]).trim() !== "") ? String(b[k]) : null;
    const num = (k: string) => (b[k] != null && b[k] !== "") ? Number(b[k]) : null;
    const bool = (k: string) => b[k] === true || b[k] === "true" || b[k] === "1";
    await upsertBrandConstraints(db, project.id, {
      tone: str("tone"), voice_style: str("voice_style"), audience_level: str("audience_level"),
      emotional_intensity: num("emotional_intensity"), humor_level: num("humor_level"),
      emoji_policy: str("emoji_policy"), max_emojis_per_caption: num("max_emojis_per_caption"),
      banned_claims: str("banned_claims"), banned_words: str("banned_words"),
      mandatory_disclaimers: str("mandatory_disclaimers"), cta_style_rules: str("cta_style_rules"),
      storytelling_style: str("storytelling_style"), positioning_statement: str("positioning_statement"),
      differentiation_angle: str("differentiation_angle"), risk_level_default: str("risk_level_default"),
      manual_review_required: bool("manual_review_required"), notes: str("notes"),
    });
    return { ok: true };
  });

  // --- Platform Constraints CRUD ---
  app.post("/v1/admin/config/platform", async (request) => {
    const b = request.body as Record<string, unknown>;
    const slug = normalizeProjectSlugParam(String(b._project ?? ""));
    const project = slug ? await ensureProject(db, slug) : await resolveProject(db, undefined);
    if (!project) return { ok: false, error: "Project not found" };
    const str = (k: string) => (b[k] != null && String(b[k]).trim() !== "") ? String(b[k]) : null;
    const num = (k: string) => (b[k] != null && b[k] !== "") ? Number(b[k]) : null;
    const bool = (k: string) => b[k] === true || b[k] === "true" || b[k] === "1";
    if (!b.platform) return { ok: false, error: "platform is required" };
    await upsertPlatformConstraints(db, project.id, {
      platform: String(b.platform), caption_max_chars: num("caption_max_chars"),
      hook_must_fit_first_lines: bool("hook_must_fit_first_lines"), hook_max_chars: num("hook_max_chars"),
      slide_min_chars: num("slide_min_chars"), slide_max_chars: num("slide_max_chars"),
      slide_min: num("slide_min"), slide_max: num("slide_max"), max_hashtags: num("max_hashtags"),
      hashtag_format_rule: str("hashtag_format_rule"), line_break_policy: str("line_break_policy"),
      emoji_allowed: bool("emoji_allowed"), link_allowed: bool("link_allowed"), tag_allowed: bool("tag_allowed"),
      formatting_rules: str("formatting_rules"), posting_frequency_limit: str("posting_frequency_limit"),
      best_posting_window: str("best_posting_window"), notes: str("notes"),
    });
    return { ok: true };
  });

  app.post("/v1/admin/config/platform/delete", async (request) => {
    const b = request.body as Record<string, unknown>;
    const slug = normalizeProjectSlugParam(String(b._project ?? ""));
    const project = slug ? await ensureProject(db, slug) : await resolveProject(db, undefined);
    if (!project) return { ok: false, error: "Project not found" };
    await deletePlatformConstraint(db, project.id, String(b.platform));
    return { ok: true };
  });

  // --- Risk Rules CRUD ---
  app.post("/v1/admin/config/risk-rule", async (request) => {
    const b = request.body as Record<string, unknown>;
    const slug = normalizeProjectSlugParam(String(b._project ?? ""));
    const project = slug ? await ensureProject(db, slug) : await resolveProject(db, undefined);
    if (!project) return { ok: false, error: "Project not found" };
    const str = (k: string) => (b[k] != null && String(b[k]).trim() !== "") ? String(b[k]) : null;
    const bool = (k: string) => b[k] === true || b[k] === "true" || b[k] === "1";
    if (!b.flow_type) return { ok: false, error: "flow_type is required" };
    await upsertRiskRule(db, project.id, {
      flow_type: String(b.flow_type), trigger_condition: str("trigger_condition"), risk_level: str("risk_level"),
      auto_approve_allowed: bool("auto_approve_allowed"), requires_manual_review: bool("requires_manual_review"),
      escalation_level: str("escalation_level"), sensitive_topics: str("sensitive_topics"),
      claim_restrictions: str("claim_restrictions"), rejection_reason_tag: str("rejection_reason_tag"),
      rollback_flag: bool("rollback_flag"), notes: str("notes"),
    });
    return { ok: true };
  });

  app.post("/v1/admin/config/risk-rule/delete", async (request) => {
    const b = request.body as Record<string, unknown>;
    if (!b.id) return { ok: false, error: "id is required" };
    await deleteRiskRule(db, String(b.id));
    return { ok: true };
  });

  // --- Allowed Flow Types CRUD ---
  app.post("/v1/admin/config/flow-type", async (request) => {
    const b = request.body as Record<string, unknown>;
    const slug = normalizeProjectSlugParam(String(b._project ?? ""));
    const project = slug ? await ensureProject(db, slug) : await resolveProject(db, undefined);
    if (!project) return { ok: false, error: "Project not found" };
    const str = (k: string) => (b[k] != null && String(b[k]).trim() !== "") ? String(b[k]) : null;
    const num = (k: string) => (b[k] != null && b[k] !== "") ? Number(b[k]) : null;
    const bool = (k: string) => b[k] === true || b[k] === "true" || b[k] === "1";
    if (!b.flow_type) return { ok: false, error: "flow_type is required" };
    await upsertAllowedFlowType(db, project.id, {
      flow_type: String(b.flow_type), enabled: bool("enabled"),
      default_variation_count: Number(b.default_variation_count ?? 1),
      requires_signal_pack: bool("requires_signal_pack"), requires_learning_context: bool("requires_learning_context"),
      allowed_platforms: str("allowed_platforms"), output_schema_version: str("output_schema_version"),
      qc_checklist_version: str("qc_checklist_version"), prompt_template_id: str("prompt_template_id"),
      priority_weight: num("priority_weight"), notes: str("notes"),
    });
    return { ok: true };
  });

  app.post("/v1/admin/config/flow-type/delete", async (request) => {
    const b = request.body as Record<string, unknown>;
    const slug = normalizeProjectSlugParam(String(b._project ?? ""));
    const project = slug ? await ensureProject(db, slug) : await resolveProject(db, undefined);
    if (!project) return { ok: false, error: "Project not found" };
    await deleteAllowedFlowType(db, project.id, String(b.flow_type));
    return { ok: true };
  });

  // --- Reference Posts CRUD ---
  app.post("/v1/admin/config/reference-post", async (request) => {
    const b = request.body as Record<string, unknown>;
    const slug = normalizeProjectSlugParam(String(b._project ?? ""));
    const project = slug ? await ensureProject(db, slug) : await resolveProject(db, undefined);
    if (!project) return { ok: false, error: "Project not found" };
    const str = (k: string) => (b[k] != null && String(b[k]).trim() !== "") ? String(b[k]) : null;
    if (!b.reference_post_id) return { ok: false, error: "reference_post_id is required" };
    await upsertReferencePost(db, project.id, {
      reference_post_id: String(b.reference_post_id), platform: str("platform"),
      post_url: str("post_url"), status: str("status") || "pending",
      last_run_id: str("last_run_id"), notes: str("notes"),
    });
    return { ok: true };
  });

  app.post("/v1/admin/config/reference-post/delete", async (request) => {
    const b = request.body as Record<string, unknown>;
    const slug = normalizeProjectSlugParam(String(b._project ?? ""));
    const project = slug ? await ensureProject(db, slug) : await resolveProject(db, undefined);
    if (!project) return { ok: false, error: "Project not found" };
    await deleteReferencePost(db, project.id, String(b.reference_post_id));
    return { ok: true };
  });

  // --- HeyGen Config CRUD ---
  app.post("/v1/admin/config/heygen", async (request) => {
    const b = request.body as Record<string, unknown>;
    const slug = normalizeProjectSlugParam(String(b._project ?? ""));
    const project = slug ? await ensureProject(db, slug) : await resolveProject(db, undefined);
    if (!project) return { ok: false, error: "Project not found" };
    const str = (k: string) => (b[k] != null && String(b[k]).trim() !== "") ? String(b[k]) : null;
    const bool = (k: string) => b[k] === true || b[k] === "true" || b[k] === "1";
    if (!b.config_id || !b.config_key) return { ok: false, error: "config_id and config_key are required" };
    await upsertHeygenConfig(db, project.id, {
      config_id: String(b.config_id), platform: str("platform"), flow_type: str("flow_type"),
      config_key: String(b.config_key), value: str("value"), render_mode: str("render_mode"),
      value_type: str("value_type") || "string", is_active: bool("is_active"), notes: str("notes"),
    });
    return { ok: true };
  });

  app.post("/v1/admin/config/heygen/delete", async (request) => {
    const b = request.body as Record<string, unknown>;
    const slug = normalizeProjectSlugParam(String(b._project ?? ""));
    const project = slug ? await ensureProject(db, slug) : await resolveProject(db, undefined);
    if (!project) return { ok: false, error: "Project not found" };
    await deleteHeygenConfig(db, project.id, String(b.config_id));
    return { ok: true };
  });

  // --- Flow Engine CRUD (global) ---
  app.get("/v1/admin/flow-engine", async () => {
    const [flowDefs, promptTpls, schemas, carouselTpls, qcChecks, riskPolicies] = await Promise.all([
      listFlowDefinitions(db), listPromptTemplates(db), listOutputSchemas(db),
      listCarouselTemplates(db), listQcChecks(db), listRiskPolicies(db),
    ]);
    return { ok: true, flow_definitions: flowDefs, prompt_templates: promptTpls, output_schemas: schemas, carousel_templates: carouselTpls, qc_checklists: qcChecks, risk_policies: riskPolicies };
  });

  app.post("/v1/admin/flow-engine/flow-def", async (request) => {
    const b = request.body as Record<string, unknown>;
    const str = (k: string) => (b[k] != null && String(b[k]).trim() !== "") ? String(b[k]) : null;
    const bool = (k: string) => b[k] === true || b[k] === "true" || b[k] === "1";
    if (!b.flow_type) return { ok: false, error: "flow_type is required" };
    await upsertFlowDefinition(db, {
      flow_type: String(b.flow_type), description: str("description"), category: str("category"),
      supported_platforms: str("supported_platforms"), output_asset_types: str("output_asset_types"),
      requires_signal_pack: bool("requires_signal_pack"), requires_learning_context: bool("requires_learning_context"),
      requires_brand_constraints: bool("requires_brand_constraints"), required_inputs: str("required_inputs"),
      optional_inputs: str("optional_inputs"), default_variation_count: Number(b.default_variation_count ?? 1),
      output_schema_name: str("output_schema_name"), output_schema_version: str("output_schema_version"),
      qc_checklist_name: str("qc_checklist_name"), qc_checklist_version: str("qc_checklist_version"),
      risk_profile_default: str("risk_profile_default"),
      candidate_row_template: b.candidate_row_template ? String(b.candidate_row_template) : null,
      notes: str("notes"), active: b.active !== false && b.active !== "false",
    });
    return { ok: true };
  });

  app.post("/v1/admin/flow-engine/flow-def/delete", async (request) => {
    const b = request.body as Record<string, unknown>;
    await deleteFlowDefinition(db, String(b.flow_type));
    return { ok: true };
  });

  app.post("/v1/admin/flow-engine/prompt-tpl", async (request) => {
    const b = request.body as Record<string, unknown>;
    const str = (k: string) => (b[k] != null && String(b[k]).trim() !== "") ? String(b[k]) : null;
    const num = (k: string) => (b[k] != null && b[k] !== "") ? Number(b[k]) : null;
    if (!b.prompt_name || !b.flow_type) return { ok: false, error: "prompt_name and flow_type are required" };
    await upsertPromptTemplate(db, {
      prompt_name: String(b.prompt_name), flow_type: String(b.flow_type), prompt_role: str("prompt_role"),
      system_prompt: str("system_prompt"), user_prompt_template: str("user_prompt_template"),
      output_format_rule: str("output_format_rule"),
      output_schema_name: str("output_schema_name") ?? str("schema_name"),
      output_schema_version: str("output_schema_version") ?? str("schema_version"),
      temperature_default: num("temperature_default"), max_tokens_default: num("max_tokens_default"),
      stop_sequences: str("stop_sequences"), notes: str("notes"),
      active: b.active !== false && b.active !== "false",
    });
    return { ok: true };
  });

  app.post("/v1/admin/flow-engine/prompt-tpl/delete", async (request) => {
    const b = request.body as Record<string, unknown>;
    await deletePromptTemplate(db, String(b.prompt_name), String(b.flow_type));
    return { ok: true };
  });

  app.post("/v1/admin/flow-engine/output-schema", async (request) => {
    const b = request.body as Record<string, unknown>;
    const str = (k: string) => (b[k] != null && String(b[k]).trim() !== "") ? String(b[k]) : null;
    if (!b.output_schema_name || !b.output_schema_version || !b.flow_type) return { ok: false, error: "name, version, and flow_type are required" };
    await upsertOutputSchema(db, {
      output_schema_name: String(b.output_schema_name), output_schema_version: String(b.output_schema_version),
      flow_type: String(b.flow_type),
      schema_json: (typeof b.schema_json === "object" ? b.schema_json : {}) as Record<string, unknown>,
      required_keys: str("required_keys"), field_types: str("field_types"),
      example_output_json: (typeof b.example_output_json === "object" ? b.example_output_json : null) as Record<string, unknown> | null,
      parsing_notes: str("parsing_notes"), active: b.active !== false && b.active !== "false",
    });
    return { ok: true };
  });

  app.post("/v1/admin/flow-engine/carousel-tpl", async (request) => {
    const b = request.body as Record<string, unknown>;
    const str = (k: string) => (b[k] != null && String(b[k]).trim() !== "") ? String(b[k]) : null;
    const num = (k: string) => (b[k] != null && b[k] !== "") ? Number(b[k]) : null;
    if (!b.template_key) return { ok: false, error: "template_key is required" };
    await upsertCarouselTemplate(db, {
      template_key: String(b.template_key), platform: str("platform"), default_slide_count: num("default_slide_count"),
      engine: str("engine"), html_template_name: str("html_template_name"), adapter_key: str("adapter_key"),
      config_json: (typeof b.config_json === "object" ? b.config_json : {}) as Record<string, unknown>,
      notes: str("notes"), active: b.active !== false && b.active !== "false",
    });
    return { ok: true };
  });

  app.post("/v1/admin/flow-engine/qc-checklist", async (request) => {
    const b = request.body as Record<string, unknown>;
    const str = (k: string) => (b[k] != null && String(b[k]).trim() !== "") ? String(b[k]) : null;
    const bool = (k: string) => b[k] === true || b[k] === "true" || b[k] === "1";
    if (!b.check_id) return { ok: false, error: "check_id is required" };
    await upsertQcCheck(db, {
      check_id: String(b.check_id), check_name: str("check_name"), check_type: str("check_type"),
      field_path: str("field_path"), operator: str("operator"), threshold_value: str("threshold_value"),
      severity: str("severity"), blocking: bool("blocking"), failure_message: str("failure_message"),
      auto_fix_action: str("auto_fix_action"), flow_type: str("flow_type"), notes: str("notes"),
      active: b.active !== false && b.active !== "false",
    });
    return { ok: true };
  });

  app.post("/v1/admin/flow-engine/risk-policy", async (request) => {
    const b = request.body as Record<string, unknown>;
    const str = (k: string) => (b[k] != null && String(b[k]).trim() !== "") ? String(b[k]) : null;
    const bool = (k: string) => b[k] === true || b[k] === "true" || b[k] === "1";
    if (!b.risk_policy_name) return { ok: false, error: "risk_policy_name is required" };
    await upsertRiskPolicy(db, {
      risk_policy_name: String(b.risk_policy_name), risk_policy_version: String(b.risk_policy_version || "1"),
      risk_category: str("risk_category"), detection_method: str("detection_method"),
      detection_terms: str("detection_terms"), severity_level: str("severity_level"),
      default_action: str("default_action"), requires_manual_review: bool("requires_manual_review"),
      block_publish: bool("block_publish"), disclaimer_template_name: str("disclaimer_template_name"),
      notes: str("notes"), active: b.active !== false && b.active !== "false",
    });
    return { ok: true };
  });

  app.post("/v1/admin/flow-engine/output-schema/delete", async (request) => {
    const b = request.body as Record<string, unknown>;
    await deleteOutputSchema(db, String(b.output_schema_name), String(b.output_schema_version));
    return { ok: true };
  });

  app.post("/v1/admin/flow-engine/carousel-tpl/delete", async (request) => {
    const b = request.body as Record<string, unknown>;
    await deleteCarouselTemplate(db, String(b.template_key));
    return { ok: true };
  });

  app.post("/v1/admin/flow-engine/qc-checklist/delete", async (request) => {
    const b = request.body as Record<string, unknown>;
    await deleteQcChecklist(db, String(b.check_id));
    return { ok: true };
  });

  app.post("/v1/admin/flow-engine/risk-policy/delete", async (request) => {
    const b = request.body as Record<string, unknown>;
    await deleteRiskPolicy(db, String(b.risk_policy_name), String(b.risk_policy_version));
    return { ok: true };
  });

  // ── HTML pages ──────────────────────────────────────────────────────

  // --- New Project ---
  app.get("/admin/new-project", async (_, reply) => {
    const projects = await listProjects(db);
    const body = `
<div class="ph"><div><h2>Create New Project</h2><span class="ph-sub">Set up a new content project</span></div></div>
<div class="content">
  <div class="card">
    <div class="card-h">Project Details</div>
    <form id="new-project-form" class="config-form">
      <div class="form-group"><label for="np-slug">Project Slug (uppercase, 2-30 chars, e.g. SNS, BRAND_X)</label><input type="text" id="np-slug" name="slug" required pattern="[A-Za-z0-9_]{2,30}" placeholder="MY_PROJECT" style="text-transform:uppercase"></div>
      <div class="form-group"><label for="np-name">Display Name</label><input type="text" id="np-name" name="display_name" placeholder="My Project"></div>
      <div class="form-actions"><button type="submit" class="btn">Create Project</button><span id="np-msg" class="form-msg"></span></div>
    </form>
  </div>
</div>
<script>
document.getElementById('new-project-form').addEventListener('submit',async(e)=>{
  e.preventDefault();
  const msg=document.getElementById('np-msg');
  const slug=document.getElementById('np-slug').value.trim().toUpperCase();
  const display_name=document.getElementById('np-name').value.trim()||slug;
  if(!slug){msg.textContent='Slug required';msg.style.color='var(--red)';return;}
  msg.textContent='Creating...';msg.style.color='var(--accent)';
  try{
    const r=await cafFetch('/v1/admin/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug,display_name})});
    const d=await r.json();
    if(d.ok){window.location.href='/admin/config?project='+encodeURIComponent(d.project.slug);}
    else{msg.textContent=d.error||'Failed';msg.style.color='var(--red)';}
  }catch(err){msg.textContent='Error: '+err.message;msg.style.color='var(--red)';}
});
</script>`;
    reply.type("text/html").send(page("New Project", "", body, projects, "", adminHeadTokenScript(config)));
  });

  // --- Overview ---
  app.get("/admin", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const projects = await listProjects(db);
    let project: ProjectRow | null;
    const pq = normalizeProjectSlugParam(query.project);
    if (pq) {
      project = await getProjectBySlug(db, pq);
    } else if (projects.length > 0) {
      project = projects[0];
    } else {
      project = null;
    }

    if (!project) {
      const body = `
<div class="ph"><div><h2>Welcome to CAF Core</h2><span class="ph-sub">No projects yet</span></div></div>
<div class="content"><div class="empty" style="padding:80px 20px"><p style="font-size:16px;margin-bottom:16px">No projects have been created yet.</p><a href="/admin/new-project" class="btn" style="display:inline-block;padding:10px 24px">Create your first project</a></div></div>`;
      reply.type("text/html").send(page("Overview", "overview", body, projects, "", adminHeadTokenScript(config)));
      return;
    }

    const currentSlug = project.slug;
    const constraints = await getConstraints(db, project.id);
    const stats = await getJobStats(db, project.id);
    const runCount = await getRunCount(db, project.id);
    const statusCards = Object.entries(stats.by_status).map(([k, v]) => `<div class="card stat-card"><div class="num">${v}</div><div class="lbl">${esc(k)}</div></div>`).join("");

    const body = `
<div class="ph"><div><h2>${esc(project.display_name || project.slug)}</h2><span class="ph-sub">Overview</span></div></div>
<div class="content">
  <div class="grid2">
    <div class="card"><div class="card-h">System</div>
      <div class="info-row"><span class="info-l">Engine version</span><span class="info-v">${esc(config.DECISION_ENGINE_VERSION)}</span></div>
      <div class="info-row"><span class="info-l">Environment</span><span class="info-v">${esc(config.NODE_ENV)}</span></div>
      <div class="info-row"><span class="info-l">Auth required</span><span class="info-v">${config.CAF_CORE_REQUIRE_AUTH ? "Yes" : "No"}</span></div>
      <div class="info-row"><span class="info-l">Port</span><span class="info-v">${config.PORT}</span></div>
    </div>
    <div class="card"><div class="card-h">Project</div>
      <div class="info-row"><span class="info-l">Slug</span><span class="info-v mono">${esc(project.slug)}</span></div>
      <div class="info-row"><span class="info-l">Display name</span><span class="info-v">${esc(project.display_name ?? "—")}</span></div>
      <div class="info-row"><span class="info-l">Active</span><span class="info-v">${project.active ? '<span class="badge badge-g">Active</span>' : '<span class="badge badge-r">Inactive</span>'}</span></div>
      <div class="info-row"><span class="info-l">ID</span><span class="info-v mono" style="font-size:11px">${esc(project.id)}</span></div>
    </div>
  </div>
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
  <div class="card"><div class="card-h">System Constraints</div>
    <div class="info-row"><span class="info-l">Max daily jobs</span><span class="info-v">${constraints?.max_daily_jobs ?? "—"}</span></div>
    <div class="info-row"><span class="info-l">Min score to generate</span><span class="info-v">${constraints?.min_score_to_generate ?? "—"}</span></div>
    <div class="info-row"><span class="info-l">Max active prompt versions</span><span class="info-v">${constraints?.max_active_prompt_versions ?? "—"}</span></div>
    <div class="info-row"><span class="info-l">Default variation cap</span><span class="info-v">${constraints?.default_variation_cap ?? "—"}</span></div>
    <div class="info-row"><span class="info-l">Auto-validation pass threshold</span><span class="info-v">${constraints?.auto_validation_pass_threshold ?? "—"}</span></div>
    <div class="info-row"><span class="info-l">Max carousel jobs / run plan</span><span class="info-v">${constraints?.max_carousel_jobs_per_run ?? "—"}</span></div>
    <div class="info-row"><span class="info-l">Max video jobs / run plan</span><span class="info-v">${constraints?.max_video_jobs_per_run ?? "—"}</span></div>
    <div class="info-row"><span class="info-l">Max jobs per flow type (JSON)</span><span class="info-v mono" style="font-size:11px;max-width:360px;word-break:break-all">${esc(JSON.stringify(constraints?.max_jobs_per_flow_type ?? {}))}</span></div>
  </div>
  <div class="card"><div class="card-h">Scoring Weights</div>
    <div class="info-row"><span class="info-l">Confidence</span><span class="info-v">${config.SCORE_WEIGHT_CONFIDENCE}</span></div>
    <div class="info-row"><span class="info-l">Platform fit</span><span class="info-v">${config.SCORE_WEIGHT_PLATFORM_FIT}</span></div>
    <div class="info-row"><span class="info-l">Novelty</span><span class="info-v">${config.SCORE_WEIGHT_NOVELTY}</span></div>
    <div class="info-row"><span class="info-l">Past performance</span><span class="info-v">${config.SCORE_WEIGHT_PAST_PERF}</span></div>
  </div>
</div>`;
    reply.type("text/html").send(page(project.slug + " — Overview", "overview", body, projects, currentSlug, adminHeadTokenScript(config)));
  });

  // --- Runs ---
  app.get("/admin/runs", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const projects = await listProjects(db);
    const project = await resolveProject(db, query.project);
    const currentSlug = project?.slug ?? "";
    const pqJs = currentSlug ? `+'&project=${encodeURIComponent(currentSlug)}'` : "";

    const body = `
<style>
.toast{margin:0 0 16px;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:500;animation:toastIn .25s ease-out}
.toast-ok{background:var(--green-bg);color:var(--green);border:1px solid rgba(34,197,94,.2)}
.toast-err{background:var(--red-bg);color:var(--red);border:1px solid rgba(239,68,68,.2)}
@keyframes toastIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
.panel{margin-bottom:16px;animation:panelSlide .2s ease-out}
@keyframes panelSlide{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
.run-actions{display:flex;gap:6px;flex-wrap:wrap}
.run-actions button{padding:4px 12px;font-size:12px}
.runs-ops{border:1px solid var(--border);border-radius:10px;padding:16px 20px;margin-bottom:16px;background:var(--card2)}
.runs-ops-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:10px}
.runs-ops-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.runs-ops-hint{font-size:12px;color:var(--muted);flex:1;min-width:220px;max-width:480px;line-height:1.45}
.sp-modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2000;align-items:center;justify-content:center;padding:24px}
.sp-modal-card{max-width:920px;max-height:90vh;overflow:auto;width:100%;position:relative}
.sp-modal-table{width:100%;border-collapse:collapse;font-size:11px;margin:8px 0}
.sp-modal-table th,.sp-modal-table td{border:1px solid var(--border);padding:6px 8px;text-align:left;vertical-align:top}
</style>
<div class="ph">
  <div><h2>${esc(project?.display_name || currentSlug || "—")}</h2><span class="ph-sub">Runs &amp; signal packs</span></div>
</div>
<div class="content">
  <div class="runs-ops">
    <div class="runs-ops-title">Operations</div>
    <div class="runs-ops-row">
      <button type="button" class="btn" onclick="togglePanel('upload-panel')">Upload signal pack (.xlsx)</button>
      <button type="button" class="btn-ghost" style="border:1px solid var(--border)" onclick="togglePanel('create-panel')">Create run (manual)</button>
      <button type="button" class="btn-ghost" style="border:1px solid var(--border)" onclick="loadRuns(runsPage)" title="Reload the runs table">Reload runs</button>
      <p class="runs-ops-hint">Upload ingests <strong>Overall</strong> rows into the DB and creates a run in <strong>CREATED</strong>. Use <strong>Start</strong> to plan jobs: aggregate <strong>${config.DEFAULT_MAX_CAROUSEL_JOBS_PER_RUN}</strong> carousel + <strong>${config.DEFAULT_MAX_VIDEO_JOBS_PER_RUN}</strong> video per run (when System limits leave those empty), and <strong>${config.DEFAULT_OTHER_FLOW_PLAN_CAP}</strong> job per other flow type. Use <strong>Re-plan</strong> to wipe jobs and plan again. <strong>Transparency:</strong> <strong>Pack</strong> = stored signal pack JSON; <strong>Candidates</strong> = Overall rows + planner rows (× flows) + run-level API audit; expand a row on <strong>Jobs</strong> for per-task LLM prompts and content preview.</p>
    </div>
  </div>
  <div id="toast-area"></div>
  <div id="sp-transparency-modal" class="sp-modal-overlay" onclick="if(event.target===this)closeSpTransparency()">
    <div class="card sp-modal-card" onclick="event.stopPropagation()">
      <div class="card-h" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <span>Signal pack ingest — what was written to the DB</span>
        <button type="button" class="btn-ghost" onclick="closeSpTransparency()">Close</button>
      </div>
      <div id="sp-transparency-body" style="padding:16px 20px 20px"></div>
    </div>
  </div>

  <div id="upload-panel" class="panel card" style="display:none;max-width:520px">
    <div class="card-h">Upload Signal Pack (.xlsx)</div>
    <form id="upload-form" enctype="multipart/form-data">
      <div class="form-group"><label>File</label><input type="file" name="file" accept=".xlsx,.xls" required style="background:transparent;border:none;padding:6px 0"></div>
      <div class="form-group"><label>Source Window (optional)</label><input type="text" name="source_window" placeholder="e.g. 2026W14"></div>
      <div class="form-group"><label>Notes (optional)</label><textarea name="notes" rows="2" placeholder="Any notes about this pack..."></textarea></div>
      <div class="form-actions"><button type="submit" class="btn" id="upload-btn">Upload &amp; Create Run</button><button type="button" class="btn-ghost" onclick="togglePanel('upload-panel')">Cancel</button><span id="upload-msg" class="form-msg"></span></div>
    </form>
  </div>

  <div id="create-panel" class="panel card" style="display:none;max-width:520px">
    <div class="card-h">Create Run Manually</div>
    <form id="create-form">
      <div class="form-group"><label>Run ID (optional, auto-generated if empty)</label><input type="text" name="run_id" placeholder="e.g. SNS_2026W14"></div>
      <div class="form-group"><label>Signal Pack ID (optional)</label><input type="text" name="signal_pack_id" placeholder="UUID of an existing signal pack"></div>
      <div class="form-group"><label>Source Window (optional)</label><input type="text" name="source_window" placeholder="e.g. 2026W14"></div>
      <div class="form-actions"><button type="submit" class="btn" id="create-btn">Create Run</button><button type="button" class="btn-ghost" onclick="togglePanel('create-panel')">Cancel</button><span id="create-msg" class="form-msg"></span></div>
    </form>
  </div>

  <div id="runs-table"><div class="empty">Loading...</div></div>
  <div class="page-btns" id="runs-pager"></div>
</div>
<script>
const SLUG=${JSON.stringify(currentSlug)};

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function runBtnId(runId,action){return 'ra-'+encodeURIComponent(runId)+'-'+action;}
function badge(s){const u=(s||'').toUpperCase();let c='badge-b';if(u.includes('COMPLETE')||u==='APPROVED')c='badge-g';else if(u==='FAILED'||u==='CANCELLED')c='badge-r';else if(u==='PLANNING'||u==='GENERATING'||u==='RENDERING')c='badge-y';return '<span class="badge '+c+'">'+esc(s||'—')+'</span>';}
function fmtDate(d){if(!d)return '—';try{return new Date(d).toLocaleString()}catch{return d}}

function togglePanel(id){
  const el=document.getElementById(id);
  if(!el)return;
  const panels=['upload-panel','create-panel'];
  panels.forEach(p=>{if(p!==id){const x=document.getElementById(p);if(x)x.style.display='none';}});
  el.style.display=el.style.display==='none'?'block':'none';
}

function showToast(msg,ok){
  const area=document.getElementById('toast-area');
  if(!area)return;
  area.innerHTML='<div class="toast '+(ok?'toast-ok':'toast-err')+'">'+esc(msg)+'</div>';
  setTimeout(function(){area.innerHTML='';},ok?5000:14000);
}
/** Prefer server message (human text) over error (machine code, e.g. run_start_failed). */
function apiErr(d,fb){
  if(d&&typeof d==='object'&&typeof d.message==='string'&&d.message)return d.message;
  if(d&&typeof d==='object'&&typeof d.error==='string'&&d.error)return d.error;
  return fb;
}

function prettyObj(v){try{return JSON.stringify(v,null,2);}catch(e){return String(v)}}
function closeSpTransparency(){
  const m=document.getElementById('sp-transparency-modal');
  if(m)m.style.display='none';
}
/** After XLSX upload: show Overall rows + full transparency payload (also stored in api_call_audit). */
function showSignalPackTransparency(d){
  const t=(d&&d.transparency)||{};
  const oc=Array.isArray(t.overall_candidates_json)?t.overall_candidates_json:[];
  let table='<table class="sp-modal-table"><thead><tr><th>#</th><th>Row preview (column → value)</th></tr></thead><tbody>';
  const max=Math.min(oc.length,100);
  for(let i=0;i<max;i++){
    const row=oc[i];
    const keys=row&&typeof row==='object'&&!Array.isArray(row)?Object.keys(row):[];
    const parts=keys.slice(0,14).map(function(k){
      const val=row[k];
      const s=val==null?'':(typeof val==='object'?prettyObj(val):String(val));
      return k+': '+s.slice(0,140)+(s.length>140?'…':'');
    });
    table+='<tr><td style="white-space:nowrap">'+(i+1)+'</td><td style="white-space:pre-wrap;word-break:break-word">'+esc(parts.join(' · '))+'</td></tr>';
  }
  table+='</tbody></table>';
  if(oc.length>100)table+='<p style="font-size:12px;color:var(--muted)">Showing first 100 of '+oc.length+' Overall rows (feeds candidate expansion × enabled flows when you Start the run).</p>';
  const sheets=Array.isArray(t.sheets_ingested)?t.sheets_ingested.join(', '):'';
  const linkPack=d.signal_pack_id?'<p style="margin:12px 0"><a class="btn btn-sm" href="/admin/signal-pack?project='+encodeURIComponent(SLUG)+'&id='+encodeURIComponent(d.signal_pack_id)+'">Open full pack viewer</a></p>':'';
  const linkCand=d.run_id?'<p style="margin:0 0 12px"><a class="btn btn-sm" href="/admin/run-candidates?project='+encodeURIComponent(SLUG)+'&run_id='+encodeURIComponent(d.run_id)+'">Planner candidates &amp; API audit (this run)</a></p>':'';
  const body=document.getElementById('sp-transparency-body');
  const modal=document.getElementById('sp-transparency-modal');
  if(!body||!modal)return;
  body.innerHTML='<p style="font-size:13px;line-height:1.5;margin:0 0 10px">'+esc(t.message||'')+'</p>'+
    '<p style="font-size:12px;color:var(--muted);margin:0 0 8px">Run: <span class="mono">'+esc(d.run_id||'')+'</span> · Sheets mapped from workbook: <span class="mono">'+esc(sheets)+'</span></p>'+
    linkCand+linkPack+
    '<h4 style="margin:14px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">Overall sheet → stored overall_candidates_json</h4>'+table+
    '<h4 style="margin:16px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">Full transparency object (summaries + globals)</h4>'+
    '<pre style="font-size:10px;line-height:1.4;max-height:260px;overflow:auto;border:1px solid var(--border);padding:10px;border-radius:8px;background:var(--bg)">'+esc(prettyObj(t))+'</pre>';
  modal.style.display='flex';
}

let runsPage=1;
async function loadRuns(p){
  runsPage=p||1;
  const el=document.getElementById('runs-table');
  if(!el)return;
  const pgEl=document.getElementById('runs-pager');
  el.innerHTML='<div class="empty">Loading...</div>';
  if(pgEl)pgEl.innerHTML='';
  try{
  if(!SLUG){
    el.innerHTML='<div class="empty" style="color:var(--yellow)">No project slug in this page. Use the sidebar or open <span class="mono">/admin/runs?project=SNS</span></div>';
    return;
  }
  const ac=new AbortController();
  const to=setTimeout(function(){ac.abort();},45000);
  let r;
  try{
    r=await cafFetch('/v1/admin/runs?page='+runsPage+'&limit=50'${pqJs},{signal:ac.signal});
  }finally{clearTimeout(to);}
  const raw=await r.text();
  let d; try{ d=JSON.parse(raw);}catch{ throw new Error(r.ok?'Invalid JSON from server':'HTTP '+r.status+' — '+raw.slice(0,120)); }
  if(!r.ok)throw new Error(apiErr(d,'HTTP '+r.status));
  if(!d.ok){el.innerHTML='<div class="empty">'+esc(apiErr(d,'Request failed'))+'</div>';return;}
  const runs=Array.isArray(d.runs)?d.runs:[];
  if(!runs.length){el.innerHTML='<div class="empty">No runs yet. Upload a signal pack or create a run to get started.</div>';return;}
  let h='<table><thead><tr><th>Run ID</th><th>Status</th><th>Jobs</th><th>Created</th><th>Started</th><th>Completed</th><th>Actions</th></tr></thead><tbody>';
  for(const run of runs){
    const canStart=run.status==='CREATED';
    const canProcess=['GENERATING','RENDERING','PLANNED'].includes(run.status);
    const canCancel=!['COMPLETED','FAILED','CANCELLED'].includes(run.status);
    const canReplan=!!run.signal_pack_id&&run.status!=='PLANNING'&&!(run.status==='CREATED'&&(!run.total_jobs||run.total_jobs===0));
    h+='<tr><td class="mono" style="color:var(--accent)"><a href="/admin/jobs?run_id='+encodeURIComponent(run.run_id)+'&project='+encodeURIComponent(SLUG)+'">'+esc(run.run_id)+'</a>';
    if(run.source_window)h+='<br><span style="font-size:11px;color:var(--muted)">'+esc(run.source_window)+'</span>';
    h+='</td>';
    h+='<td>'+badge(run.status)+'</td>';
    h+='<td>'+run.jobs_completed+'/'+run.total_jobs+'</td>';
    h+='<td>'+fmtDate(run.created_at)+'</td><td>'+fmtDate(run.started_at)+'</td><td>'+fmtDate(run.completed_at)+'</td>';
    h+='<td><div class="run-actions">';
    h+='<a class="btn-ghost" style="font-size:11px;padding:4px 10px;text-decoration:none;border:1px solid var(--border);border-radius:6px" href="/admin/run-candidates?project='+encodeURIComponent(SLUG)+'&run_id='+encodeURIComponent(run.run_id)+'">Candidates</a> ';
    if(run.signal_pack_id)h+='<a class="btn-ghost" style="font-size:11px;padding:4px 10px;text-decoration:none;border:1px solid var(--border);border-radius:6px" href="/admin/signal-pack?project='+encodeURIComponent(SLUG)+'&id='+encodeURIComponent(run.signal_pack_id)+'">Pack</a> ';
    if(canStart)h+="<button type='button' class='btn' id='"+runBtnId(run.run_id,'start')+"' onclick='runAction("+JSON.stringify(run.run_id)+","+JSON.stringify("start")+")'>Start</button>";
    if(canProcess)h+="<button type='button' class='btn-ghost' id='"+runBtnId(run.run_id,'process')+"' onclick='runAction("+JSON.stringify(run.run_id)+","+JSON.stringify("process")+")'>Process</button>";
    if(canReplan)h+="<button type='button' class='btn-ghost' id='"+runBtnId(run.run_id,'replan')+"' onclick='runAction("+JSON.stringify(run.run_id)+","+JSON.stringify("replan")+")' title="+JSON.stringify("Delete all jobs and run the decision engine again")+">Re-plan</button>";
    if(canCancel)h+="<button type='button' class='btn-ghost' id='"+runBtnId(run.run_id,'cancel')+"' onclick='runAction("+JSON.stringify(run.run_id)+","+JSON.stringify("cancel")+")' style='color:var(--red)'>Cancel</button>";
    h+="<button type='button' class='btn-ghost' id='"+runBtnId(run.run_id,'delete')+"' onclick='runAction("+JSON.stringify(run.run_id)+","+JSON.stringify("delete")+")' style='color:var(--red)' title='Remove run row and all jobs'>Delete</button>";
    h+='</div></td></tr>';
  }
  h+='</tbody></table>';
  el.innerHTML=h;
  const pageNum=d.page||1;
  const lim=d.limit||50;
  const totalPages=Math.ceil((d.total||0)/lim);
  let pg='<span>Page '+pageNum+' of '+Math.max(1,totalPages)+' ('+(d.total||0)+' total)</span>';
  if(pageNum>1)pg+=' <button class="btn-ghost" onclick="loadRuns('+(pageNum-1)+')">Prev</button>';
  if(pageNum<totalPages)pg+=' <button class="btn-ghost" onclick="loadRuns('+(pageNum+1)+')">Next</button>';
  if(pgEl)pgEl.innerHTML=pg;
  }catch(err){
    const msg=(err&&err.name==='AbortError')?'Request timed out — try again.':(err.message||String(err));
    el.innerHTML='<div class="empty" style="color:var(--red)">Could not load runs: '+esc(msg)+'</div>';
    if(pgEl)pgEl.innerHTML='';
  }
}

async function runAction(runId,action){
  if(!SLUG){showToast('Select a project in the sidebar first.',false);return;}
  if(action==='replan'&&!confirm('Delete all jobs for this run and re-plan with current caps? This cannot be undone.'))return;
  if(action==='delete'&&!confirm('Permanently delete this run, its signal packs, and all related jobs in the database?'))return;
  const btnId=runBtnId(runId,action);
  const btn=document.getElementById(btnId);
  if(btn){btn.disabled=true;btn.textContent='...';}
  try{
    const base='/v1/runs/'+encodeURIComponent(SLUG)+'/'+encodeURIComponent(runId);
    const isDelete=action==='delete';
    const r=await cafFetch(isDelete?base:base+'/'+action,isDelete?{method:'DELETE'}:{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const raw=await r.text();
    let d;try{d=JSON.parse(raw);}catch{throw new Error(r.ok?'Invalid JSON':'HTTP '+r.status+' '+raw.slice(0,80));}
    if(!r.ok||!d.ok)throw new Error(apiErr(d,action+' failed'));
    const msgs={start:'Run started — '+(d.planned_jobs||0)+' jobs planned',cancel:'Run cancelled',process:'Pipeline processing triggered',replan:'Re-planned — removed '+(d.deleted_jobs||0)+', '+(d.planned_jobs||0)+' jobs planned',delete:'Run deleted — '+((d.content_jobs_deleted!=null)?d.content_jobs_deleted:0)+' job row(s) removed'};
    showToast(msgs[action]||'Done',true);
    loadRuns(runsPage);
  }catch(err){showToast(err.message,false);}
  finally{if(btn){btn.disabled=false;btn.textContent=action==='start'?'Start':action==='process'?'Process':action==='replan'?'Re-plan':action==='delete'?'Delete':'Cancel';}}
}

loadRuns(1);
window.addEventListener('pageshow',function(ev){if(ev.persisted)setTimeout(function(){loadRuns(runsPage);},0);});

document.getElementById('upload-form')?.addEventListener('submit',async(e)=>{
  e.preventDefault();
  if(!SLUG){showToast('Select a project in the sidebar (or open /admin/runs?project=YOUR_SLUG)',false);return;}
  const btn=document.getElementById('upload-btn');
  if(btn){btn.disabled=true;btn.textContent='Uploading...';}
  try{
    const fd=new FormData(e.target);
    fd.append('project_slug',SLUG);
    const r=await cafFetch('/v1/signal-packs/upload',{method:'POST',body:fd});
    const raw=await r.text();
    let d;try{d=JSON.parse(raw);}catch{throw new Error(r.ok?'Invalid response':'HTTP '+r.status+' '+raw.slice(0,120));}
    if(!r.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    if(!d.ok)throw new Error(apiErr(d,'Upload failed'));
    showToast('Signal pack uploaded — Run '+d.run_id+' created ('+d.total_candidates+' candidates)',true);
    if(d.transparency)showSignalPackTransparency(d);
    const up=document.getElementById('upload-panel');if(up)up.style.display='none';
    e.target.reset();
    loadRuns(1);
  }catch(err){showToast(err.message,false);}
  finally{if(btn){btn.disabled=false;btn.textContent='Upload & Create Run';}}
});

document.getElementById('create-form')?.addEventListener('submit',async(e)=>{
  e.preventDefault();
  if(!SLUG){showToast('Select a project in the sidebar',false);return;}
  const btn=document.getElementById('create-btn');
  if(btn){btn.disabled=true;btn.textContent='Creating...';}
  try{
    const fd=new FormData(e.target);
    const body={};
    for(const[k,v]of fd.entries())if(v)body[k]=v;
    const r=await cafFetch('/v1/runs/'+encodeURIComponent(SLUG),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const raw=await r.text();
    let d;try{d=JSON.parse(raw);}catch{throw new Error(r.ok?'Invalid response':'HTTP '+r.status);}
    if(!r.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    if(!d.ok)throw new Error(apiErr(d,'Create failed'));
    showToast('Run created: '+(d.run?.run_id||''),true);
    const cp=document.getElementById('create-panel');if(cp)cp.style.display='none';
    e.target.reset();
    loadRuns(1);
  }catch(err){showToast(err.message,false);}
  finally{if(btn){btn.disabled=false;btn.textContent='Create Run';}}
});
</script>`;
    reply
      .header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
      .type("text/html")
      .send(page("Runs", "runs", body, projects, currentSlug, adminHeadTokenScript(config)));
  });

  app.get("/admin/signal-pack", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const projects = await listProjects(db);
    const project = await resolveProject(db, query.project);
    const currentSlug = project?.slug ?? "";
    const packId = (query.id ?? "").trim();
    const pqJs = currentSlug ? `+'&project=${encodeURIComponent(currentSlug)}'` : "";

    const body = `
<div class="ph"><div><h2>Signal pack</h2><span class="ph-sub">Stored payload — what feeds the planner (Overall × flows)</span></div></div>
<div class="content">
<p class="runs-ops-hint">Use <span class="mono">?project=SLUG&amp;id=SIGNAL_PACK_UUID</span> from Runs → Pack. Scene-router LLM seeds are logged at run start under <span class="mono">api_call_audit</span> with step <span class="mono">llm_scene_assembly_candidate_router</span>.</p>
<div id="sp-view-root"><div class="empty">Loading…</div></div>
</div>
<script>
const SLUG=${JSON.stringify(currentSlug)};
const PACK_ID=${JSON.stringify(packId)};
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function pretty(v){try{return JSON.stringify(v,null,2);}catch(e){return String(v)}}
async function loadPackView(){
  const root=document.getElementById('sp-view-root');
  if(!root)return;
  if(!SLUG||!PACK_ID){
    root.innerHTML='<div class="empty">Missing <span class="mono">project</span> or <span class="mono">id</span> query parameter.</div>';
    return;
  }
  try{
    const r=await cafFetch('/v1/admin/signal-pack?project='+encodeURIComponent(SLUG)+'&id='+encodeURIComponent(PACK_ID));
    const d=await r.json();
    if(!r.ok||!d.ok){
      root.innerHTML='<div class="empty" style="color:var(--red)">'+(d&&d.error?esc(d.error):'Failed to load')+'</div>';
      return;
    }
    const p=d.signal_pack;
    const oc=Array.isArray(p.overall_candidates_json)?p.overall_candidates_json:[];
    let tb='<table class="sp-modal-table"><thead><tr><th>#</th><th>Overall row</th></tr></thead><tbody>';
    const n=Math.min(oc.length,150);
    for(let i=0;i<n;i++){
      const row=oc[i];
      tb+='<tr><td>'+(i+1)+'</td><td><pre style="margin:0;font-size:10px;white-space:pre-wrap;word-break:break-word">'+esc(pretty(row))+'</pre></td></tr>';
    }
    tb+='</tbody></table>';
    if(oc.length>150)tb+='<p style="color:var(--muted);font-size:12px">Showing 150 of '+oc.length+' rows.</p>';
    const rest={...p};
    delete rest.overall_candidates_json;
    root.innerHTML='<div class="card" style="margin-bottom:16px"><div class="card-h">overall_candidates_json ('+oc.length+' rows)</div><div style="padding:12px 16px 16px">'+tb+'</div></div>'+
      '<div class="card"><div class="card-h">Other pack fields (IG / TikTok / Reddit / HTML summaries, globals, …)</div><div style="padding:12px 16px 16px"><pre style="font-size:10px;line-height:1.45;max-height:480px;overflow:auto;margin:0">'+esc(pretty(rest))+'</pre></div></div>';
  }catch(e){
    root.innerHTML='<div class="empty" style="color:var(--red)">'+esc(e.message||String(e))+'</div>';
  }
}
loadPackView();
</script>`;
    reply
      .header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
      .type("text/html")
      .send(page("Signal pack", "runs", body, projects, currentSlug, adminHeadTokenScript(config)));
  });

  app.get("/admin/run-candidates", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const projects = await listProjects(db);
    const project = await resolveProject(db, query.project);
    const currentSlug = project?.slug ?? "";
    const runIdQ = (query.run_id ?? "").trim();

    const body = `
<div class="ph"><div><h2>Run transparency</h2><span class="ph-sub">Stored Overall rows · planner candidates (× flows) · run-level API audit</span></div></div>
<div class="content">
<p class="runs-ops-hint">Open from <strong>Runs</strong> → <strong>Candidates</strong>, or use <span class="mono">?project=SLUG&amp;run_id=RUN_ID</span>. Per-task prompts: <a href="/admin/jobs?project=${encodeURIComponent(currentSlug)}${runIdQ ? `&run_id=${encodeURIComponent(runIdQ)}` : ""}">Jobs</a> → expand a row.</p>
<div id="rc-root"><div class="empty">Loading…</div></div>
</div>
<script>
const SLUG=${JSON.stringify(currentSlug)};
const RUN_ID=${JSON.stringify(runIdQ)};
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function pretty(v){try{return JSON.stringify(v,null,2);}catch(e){return String(v)}}
function trunc(s,n){s=String(s||'');return s.length>n?s.slice(0,n)+'…':s}
function outBadge(o){
  if(o==='planned')return '<span class="badge badge-g">planned</span>';
  if(o==='dropped')return '<span class="badge badge-r">dropped</span>';
  return '<span class="badge badge-b">'+(esc(o||'unknown'))+'</span>';
}
async function loadRunTransparency(){
  const root=document.getElementById('rc-root');
  if(!root)return;
  if(!SLUG||!RUN_ID){
    root.innerHTML='<div class="empty">Missing <span class="mono">project</span> or <span class="mono">run_id</span>. Open this page from Runs → Candidates.</div>';
    return;
  }
  try{
    const r=await cafFetch('/v1/admin/run-transparency?project='+encodeURIComponent(SLUG)+'&run_id='+encodeURIComponent(RUN_ID));
    const d=await r.json();
    if(!r.ok||!d.ok){
      root.innerHTML='<div class="empty" style="color:var(--red)">'+(d&&d.error?esc(d.error):'Failed to load')+'</div>';
      return;
    }
    const notes=d.notes||{};
    let h='<div class="card" style="margin-bottom:14px"><div class="card-h">Run</div><div style="padding:12px 16px 16px;font-size:13px">'+
      '<p style="margin:0 0 8px"><span class="mono">'+esc(d.run.run_id)+'</span> · '+esc(d.run.status)+' · jobs '+esc(String(d.run.jobs_completed))+'/'+esc(String(d.run.total_jobs))+'</p>'+
      '<ul style="margin:0;padding-left:18px;color:var(--muted);font-size:12px;line-height:1.5">'+
      '<li>'+esc(notes.stored_signal_pack||'')+'</li><li>'+esc(notes.planner||'')+'</li><li>'+esc(notes.jobs||'')+'</li></ul></div></div>';

    const oc=Array.isArray(d.signal_pack_overall_candidates)?d.signal_pack_overall_candidates:[];
    h+='<div class="card" style="margin-bottom:14px"><div class="card-h">Signal pack — overall_candidates_json ('+oc.length+' rows in DB)</div><div style="padding:12px 16px 16px">';
    if(!oc.length)h+='<p class="empty" style="margin:0">No rows (run may have no pack attached).</p>';
    else{
      let tb='<table class="sp-modal-table"><thead><tr><th>#</th><th>Row (preview)</th></tr></thead><tbody>';
      const n=Math.min(oc.length,80);
      for(let i=0;i<n;i++){
        const row=oc[i];
        const prev=typeof row==='object'&&row?trunc(pretty(row),420):esc(String(row));
        tb+='<tr><td>'+(i+1)+'</td><td><pre style="margin:0;font-size:10px;white-space:pre-wrap;word-break:break-word">'+esc(prev)+'</pre></td></tr>';
      }
      tb+='</tbody></table>';
      h+=tb;
      if(oc.length>80)h+='<p style="color:var(--muted);font-size:12px">Showing 80 of '+oc.length+'.</p>';
    }
    h+='</div></div>';

    const traces=Array.isArray(d.planning_traces)?d.planning_traces:[];
    h+='<div class="card" style="margin-bottom:14px"><div class="card-h">Decision traces — planner input/output ('+traces.length+')</div><div style="padding:12px 16px 16px">';
    if(!traces.length)h+='<p class="empty" style="margin:0">No traces yet. Use <strong>Start</strong> on the run so the decision engine records a trace.</p>';
    else for(let ti=0;ti<traces.length;ti++){
      const tr=traces[ti];
      const v=tr.view;
      h+='<div style="margin-bottom:18px;padding-bottom:18px;border-bottom:1px solid var(--border)">'+
        '<p style="margin:0 0 8px;font-size:12px;color:var(--muted)"><span class="mono">'+esc(tr.trace_id)+'</span> · '+esc(tr.created_at)+' · engine '+esc(tr.engine_version)+'</p>';
      if(!v){
        h+='<p style="color:var(--yellow);font-size:12px">Could not build a structured view (unexpected trace shape). Raw snapshots:</p>'+
          '<details style="margin-top:8px"><summary style="cursor:pointer;font-size:12px">input_snapshot</summary><pre style="font-size:10px;max-height:240px;overflow:auto">'+esc(pretty(tr.input_snapshot))+'</pre></details>'+
          '<details style="margin-top:8px"><summary style="cursor:pointer;font-size:12px">output_snapshot</summary><pre style="font-size:10px;max-height:240px;overflow:auto">'+esc(pretty(tr.output_snapshot))+'</pre></details>';
      }else{
        const cands=Array.isArray(v.candidates)?v.candidates:[];
        let tb='<table class="sp-modal-table"><thead><tr><th>candidate_id</th><th>platform</th><th>flow</th><th>outcome</th><th>score</th><th>idea</th></tr></thead><tbody>';
        const m=Math.min(cands.length,200);
        for(let i=0;i<m;i++){
          const c=cands[i];
          tb+='<tr><td class="mono" style="font-size:10px">'+esc(c.candidate_id)+'</td><td>'+esc(c.platform||c.target_platform||'')+'</td><td>'+esc(c.flow_type||'')+'</td><td>'+outBadge(c.outcome)+(c.outcome_detail?'<div style="font-size:10px;color:var(--muted);margin-top:4px">'+esc(trunc(c.outcome_detail,120))+'</div>':'')+'</td><td>'+esc(c.pre_gen_score!=null?String(c.pre_gen_score):'—')+'</td><td style="font-size:10px;max-width:280px;word-break:break-word">'+esc(trunc(c.content_idea||'',180))+'</td></tr>';
        }
        tb+='</tbody></table>';
        h+=tb;
        if(cands.length>200)h+='<p style="color:var(--muted);font-size:12px">Showing 200 of '+cands.length+' planner rows.</p>';
        h+='<details style="margin-top:10px"><summary style="cursor:pointer;font-size:12px">Plan meta &amp; suppression</summary><pre style="font-size:10px;max-height:280px;overflow:auto;margin-top:8px">'+esc(pretty(v.plan_output))+'</pre></details>';
      }
      h+='</div>';
    }
    h+='</div></div>';

    const audits=Array.isArray(d.api_audits)?d.api_audits:[];
    h+='<div class="card"><div class="card-h">API &amp; LLM audit for this run ('+audits.length+' rows)</div><div style="padding:12px 16px 16px">';
    if(!audits.length)h+='<p class="empty" style="margin:0">No audited calls with <span class="mono">run_id</span> yet.</p>';
    else{
      let tb='<table class="sp-modal-table"><thead><tr><th>When</th><th>Step</th><th>task_id</th><th>Provider</th><th>OK</th><th>Request (preview)</th></tr></thead><tbody>';
      for(let i=0;i<audits.length;i++){
        const a=audits[i];
        const reqP=trunc(pretty(a.request_json),500);
        tb+='<tr><td style="white-space:nowrap;font-size:10px">'+esc(a.created_at)+'</td><td style="font-size:10px">'+esc(a.step)+'</td><td class="mono" style="font-size:9px;word-break:break-all">'+esc(a.task_id||'—')+'</td><td>'+esc(a.provider)+'</td><td>'+(a.ok?'<span class="badge badge-g">ok</span>':'<span class="badge badge-r">err</span>')+'</td><td><pre style="margin:0;font-size:9px;white-space:pre-wrap;word-break:break-word">'+esc(reqP)+'</pre></td></tr>';
      }
      tb+='</tbody></table>';
      h+=tb;
    }
    h+='</div></div>';

    root.innerHTML=h;
  }catch(e){
    root.innerHTML='<div class="empty" style="color:var(--red)">'+esc(e.message||String(e))+'</div>';
  }
}
loadRunTransparency();
</script>`;
    reply
      .header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
      .type("text/html")
      .send(page("Run candidates", "runs", body, projects, currentSlug, adminHeadTokenScript(config)));
  });

  // --- Jobs ---
  app.get("/admin/jobs", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const projects = await listProjects(db);
    const project = await resolveProject(db, query.project);
    const currentSlug = project?.slug ?? "";
    const initialRunId = query.run_id || "";
    const pqJs = currentSlug ? `+'&project=${encodeURIComponent(currentSlug)}'` : "";

    const body = `
<div class="ph"><div><h2>${esc(project?.display_name || currentSlug || "—")}</h2><span class="ph-sub">Jobs — your Google Sheets replacement</span></div></div>
<div class="content">
<style>
.job-row{cursor:pointer}
.job-row:hover td{background:var(--card2)}
.job-detail-row td{background:var(--bg2);border-bottom:1px solid var(--border);vertical-align:top;padding:12px 14px}
.job-detail-pre{margin:0;padding:12px;font-size:11px;line-height:1.45;overflow:auto;max-height:280px;border-radius:8px;border:1px solid var(--border);background:var(--bg);white-space:pre-wrap;word-break:break-word}
.job-err-cell{max-width:360px;vertical-align:top}
.job-err-inner{display:flex;align-items:flex-start;gap:8px;min-width:0}
.job-err-text{color:var(--red);font-size:12px;flex:1;min-width:0;white-space:pre-wrap;word-break:break-word}
.job-err-copy{padding:2px 8px;font-size:10px;line-height:1.2;flex-shrink:0;margin-top:1px}
.job-h{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:10px 0 6px}
.jobs-live-row{display:flex;align-items:center;gap:14px;margin-bottom:14px;flex-wrap:wrap;font-size:13px;color:var(--fg2)}
</style>
  <div class="filter-row" id="filters">
    <div><label>Search</label><input type="text" id="f-search" placeholder="task_id or run_id..." value=""></div>
    <div><label>Status</label><select id="f-status"><option value="">All</option></select></div>
    <div><label>Platform</label><select id="f-platform"><option value="">All</option></select></div>
    <div><label>Flow type</label><select id="f-flow"><option value="">All</option></select></div>
    <div><label>Run ID</label><select id="f-run"><option value="">All</option></select></div>
    <div><button class="btn" onclick="loadJobs(1)">Filter</button></div>
  </div>
  <div class="jobs-live-row">
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="jobs-live" checked> Auto-refresh every 4s (only when this tab is visible)</label>
    <span id="jobs-live-status" style="font-size:12px;color:var(--muted)"></span>
  </div>
  <p style="font-size:12px;color:var(--muted);line-height:1.45;margin:0 0 12px;max-width:920px"><strong>Phase</strong> shows where the job is in the pipeline (LLM → QC → render → review). Expand a row for <code>render_state</code>, transitions, and API audit.</p>
  <div id="jobs-table"><div class="empty">Loading...</div></div>
  <div class="page-btns" id="jobs-pager"></div>
</div>
<script>
const initRunId=${JSON.stringify(initialRunId)};
const JOB_SLUG=${JSON.stringify(currentSlug)};
let jobsPage=1;
let jobRowTaskIds=[];
/** Full last_error per row index (same order as table); used for one-click copy. */
let jobLastErrors=[];
/** When set, list auto-refresh is paused and this row is re-opened after each reload. */
let jobDetailOpenTaskId=null;
let jobsPollTimer=null;
let jobsListGen=0;
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function escAttr(s){return esc(s).replace(/"/g,'&quot;');}
function trunc(s,n){if(s==null||s==='')return '—';s=String(s);return s.length<=n?s:s.slice(0,Math.max(0,n-1))+'…';}
function fallbackCopyPlainText(text){
  var ta=document.createElement('textarea');
  ta.value=text;
  ta.setAttribute('readonly','');
  ta.style.position='fixed';
  ta.style.left='-9999px';
  document.body.appendChild(ta);
  ta.select();
  try{document.execCommand('copy');}catch(e){}
  document.body.removeChild(ta);
}
function copyJobLastErr(ev,ix){
  if(ev)ev.stopPropagation();
  var t=jobLastErrors[ix];
  if(t==null||t==='')return;
  var btn=ev&&ev.currentTarget;
  function flashOk(){
    if(btn&&btn.tagName==='BUTTON'){
      var o=btn.textContent;
      btn.textContent='Copied';
      btn.disabled=true;
      setTimeout(function(){btn.textContent=o;btn.disabled=false;},1400);
    }
  }
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(String(t)).then(flashOk).catch(function(){fallbackCopyPlainText(String(t));flashOk();});
  }else{
    fallbackCopyPlainText(String(t));
    flashOk();
  }
}
/** Copy expanded job detail (summary, content preview, API audit, render state, etc.) as plain text for debugging. */
function copyJobDetailFull(ev){
  if(ev)ev.stopPropagation();
  var btn=ev&&ev.currentTarget;
  var root=btn&&btn.closest('.job-detail-body');
  if(!root)return;
  var parts=[];
  for(var i=0;i<root.children.length;i++){
    var n=root.children[i];
    if(n.classList&&n.classList.contains('job-detail-toolbar'))continue;
    var chunk=(n.innerText!=null?n.innerText:String(n.textContent||'')).trim();
    if(chunk)parts.push(chunk);
  }
  var text=parts.join('\\n\\n');
  if(!text)return;
  function flashOk(){
    if(btn&&btn.tagName==='BUTTON'){
      var o=btn.textContent;
      btn.textContent='Copied';
      btn.disabled=true;
      setTimeout(function(){btn.textContent=o;btn.disabled=false;},1400);
    }
  }
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(flashOk).catch(function(){fallbackCopyPlainText(text);flashOk();});
  }else{
    fallbackCopyPlainText(text);
    flashOk();
  }
}
function prettyJson(v){if(v==null)return '—';if(typeof v==='object'){try{return JSON.stringify(v,null,2);}catch(e){return String(v)}}return String(v);}
function badge(s){const u=(s||'').toUpperCase();let c='badge-b';if(u.includes('APPROVED')||u.includes('COMPLETE'))c='badge-g';else if(u==='REJECTED'||u==='FAILED')c='badge-r';else if(u.includes('EDIT')||u==='GENERATING'||u==='RENDERING')c='badge-y';return '<span class="badge '+c+'">'+esc(s||'—')+'</span>';}
function fmtDate(d){if(!d)return '—';try{return new Date(d).toLocaleString()}catch(e){return d}}
function restartJobsPoll(){
  if(jobsPollTimer){clearInterval(jobsPollTimer);jobsPollTimer=null;}
  const el=document.getElementById('jobs-live');
  if(!el||!el.checked)return;
  if(jobDetailOpenTaskId)return;
  jobsPollTimer=setInterval(function(){
    if(document.visibilityState!=='visible')return;
    if(jobDetailOpenTaskId)return;
    loadJobs(jobsPage,true);
  },4000);
}
document.addEventListener('visibilitychange',function(){
  var st=document.getElementById('jobs-live-status');
  if(st)st.textContent=document.visibilityState==='visible'?'':'(tab in background — refresh paused)';
});
async function loadFacets(){
  const r=await cafFetch('/v1/admin/jobs/facets?project=${encodeURIComponent(currentSlug)}');const d=await r.json();
  if(!d.ok)return;
  fillSelect('f-status',d.statuses);fillSelect('f-platform',d.platforms);
  fillSelect('f-flow',d.flow_types);fillSelect('f-run',d.run_ids);
  if(initRunId)document.getElementById('f-run').value=initRunId;
}
function fillSelect(id,vals){const el=document.getElementById(id);if(!el)return;el.innerHTML='<option value="">All</option>';for(const v of vals){const o=document.createElement('option');o.value=v;o.textContent=v;el.appendChild(o);}}
function renderJobDetailHtml(d){
  const j=d.job||{};
  var gen=prettyJson(j.generation_payload);
  if(gen.length>14000)gen=gen.slice(0,14000)+'\\n… truncated';
  var lines=[];
  lines.push('<div class="job-detail-toolbar" style="display:flex;gap:8px;align-items:center;margin:0 0 12px;flex-wrap:wrap">');
  lines.push('<button type="button" class="btn btn-sm" onclick="copyJobDetailFull(event)">Copy all for debug</button>');
  lines.push('<span style="font-size:11px;color:var(--muted)">Summary, content preview, API audit, render state, payloads, transitions</span>');
  lines.push('</div>');
  lines.push('<div class="job-h">Summary</div>');
  lines.push('<pre class="job-detail-pre">'+esc(prettyJson({task_id:j.task_id,run_id:j.run_id,status:j.status,flow_type:j.flow_type,platform:j.platform,candidate_id:j.candidate_id,variation_name:j.variation_name,render_provider:j.render_provider,render_status:j.render_status,asset_id:j.asset_id,recommended_route:j.recommended_route,qc_status:j.qc_status,created_at:j.created_at,updated_at:j.updated_at}))+'</pre>');
  if(d.content_preview){
    lines.push('<div class="job-h">Content preview (carousel slides · video script/prompt · scene assembly)</div>');
    lines.push('<pre class="job-detail-pre">'+esc(prettyJson(d.content_preview))+'</pre>');
  }
  if(d.api_audit&&d.api_audit.length){
    lines.push('<div class="job-h">API &amp; LLM audit ('+d.api_audit.length+') — stored prompts &amp; request bodies</div>');
    for(var ai=0;ai<d.api_audit.length;ai++){
      var a=d.api_audit[ai];
      lines.push('<div style="margin:10px 0;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--card2)">');
      lines.push('<div style="font-weight:600;font-size:12px;margin-bottom:6px">'+esc(a.step)+' <span style="color:var(--muted);font-weight:400">'+esc(a.provider)+'</span>'+(a.model?' <span style="color:var(--muted)">'+esc(a.model)+'</span>':'')+' · '+(a.ok===false?'<span style="color:var(--red)">failed</span>':'<span style="color:var(--green)">ok</span>')+' · <span style="color:var(--muted);font-size:11px">'+esc(a.created_at)+'</span></div>');
      lines.push('<pre class="job-detail-pre" style="max-height:220px">'+esc(prettyJson({request:a.request_json,response:a.response_json,error:a.error_message}))+'</pre>');
      lines.push('</div>');
    }
  }
  lines.push('<div class="job-h">render_state</div>');
  lines.push('<pre class="job-detail-pre">'+esc(prettyJson(j.render_state))+'</pre>');
  lines.push('<div class="job-h">generation_payload</div>');
  lines.push('<pre class="job-detail-pre">'+esc(gen)+'</pre>');
  lines.push('<div class="job-h">scene_bundle_state</div>');
  lines.push('<pre class="job-detail-pre">'+esc(prettyJson(j.scene_bundle_state))+'</pre>');
  lines.push('<div class="job-h">review_snapshot</div>');
  lines.push('<pre class="job-detail-pre">'+esc(prettyJson(j.review_snapshot))+'</pre>');
  lines.push('<div class="job-h">State transitions (newest first)</div>');
  lines.push('<pre class="job-detail-pre">'+esc(prettyJson(d.transitions||[]))+'</pre>');
  return lines.join('');
}
async function fetchJobDetailInto(bodyEl,taskId){
  bodyEl.innerHTML='<div class="empty">Loading detail…</div>';
  try{
    const r=await cafFetch('/v1/admin/job?project='+encodeURIComponent(JOB_SLUG)+'&task_id='+encodeURIComponent(taskId));
    const raw=await r.text();
    var dj;try{dj=JSON.parse(raw);}catch(e){throw new Error('Bad JSON');}
    if(!r.ok||!dj.ok)throw new Error((dj&&dj.message)||(dj&&dj.error)||('HTTP '+r.status));
    bodyEl.innerHTML=renderJobDetailHtml(dj);
    bodyEl.setAttribute('data-loaded','1');
  }catch(err){
    bodyEl.innerHTML='<div class="empty" style="color:var(--red)">'+esc(err.message||String(err))+'</div>';
  }
}
async function toggleJobDetail(ix){
  const tid=jobRowTaskIds[ix];
  if(!tid)return;
  const detailRow=document.getElementById('job-detail-'+ix);
  const bodyEl=document.getElementById('job-detail-body-'+ix);
  if(!detailRow||!bodyEl)return;
  const wasOpen=detailRow.style.display==='table-row';
  document.querySelectorAll('.job-detail-row').forEach(function(r){r.style.display='none';});
  if(wasOpen&&jobDetailOpenTaskId===tid){
    jobDetailOpenTaskId=null;
    restartJobsPoll();
    return;
  }
  jobDetailOpenTaskId=tid;
  if(jobsPollTimer){clearInterval(jobsPollTimer);jobsPollTimer=null;}
  detailRow.style.display='table-row';
  if(bodyEl.getAttribute('data-loaded')==='1')return;
  await fetchJobDetailInto(bodyEl,tid);
}
async function loadJobs(p,silent){
  jobsListGen++;
  const myGen=jobsListGen;
  jobsPage=p||1;
  const params=new URLSearchParams();params.set('page',String(jobsPage));params.set('limit','50');
  params.set('project','${encodeURIComponent(currentSlug)}');
  const search=document.getElementById('f-search').value.trim();if(search)params.set('search',search);
  const status=document.getElementById('f-status').value;if(status)params.set('status',status);
  const platform=document.getElementById('f-platform').value;if(platform)params.set('platform',platform);
  const flow=document.getElementById('f-flow').value;if(flow)params.set('flow_type',flow);
  const run=document.getElementById('f-run').value;if(run)params.set('run_id',run);
  if(!silent)document.getElementById('jobs-table').innerHTML='<div class="empty">Loading...</div>';
  const r=await cafFetch('/v1/admin/jobs?'+params.toString());const d=await r.json();
  if(myGen!==jobsListGen)return;
  if(!d.ok){document.getElementById('jobs-table').innerHTML='<div class="empty">'+esc(d.error)+'</div>';return;}
  if(!d.rows.length){
    document.getElementById('jobs-table').innerHTML='<div class="empty">No jobs match filters</div>';
    jobRowTaskIds=[];
    jobLastErrors=[];
    jobDetailOpenTaskId=null;
    restartJobsPoll();
    return;
  }
  jobRowTaskIds=d.rows.map(function(j){return j.task_id;});
  jobLastErrors=d.rows.map(function(j){return j.last_error!=null?String(j.last_error):'';});
  var preserveTask=jobDetailOpenTaskId;
  var scrollY=window.scrollY||document.documentElement.scrollTop||0;
  var h='<table class="jobs-main-table"><thead><tr><th>Task</th><th>Run</th><th>Platform</th><th>Flow</th><th>Status</th><th>Phase</th><th>Render</th><th>Error / last failure</th><th>Route</th><th>Score</th><th>QC</th><th>Updated</th></tr></thead><tbody>';
  for(var i=0;i<d.rows.length;i++){
    var j=d.rows[i];
    var rph=[j.render_provider,j.render_status,j.render_phase].filter(Boolean).join(' · ');
    h+='<tr class="job-row" onclick="toggleJobDetail('+i+')"><td class="mono" style="color:var(--accent);max-width:160px" title="'+escAttr(j.task_id)+'">'+esc(trunc(j.task_id,40))+' <span style="opacity:.5">▸</span></td>';
    h+='<td class="mono" style="font-size:11px">'+esc(j.run_id||'—')+'</td>';
    h+='<td>'+esc(j.platform||'—')+'</td><td style="font-size:12px">'+esc(j.flow_type||'—')+'</td>';
    h+='<td>'+badge(j.status)+'</td>';
    h+='<td style="font-size:11px;line-height:1.35;color:var(--fg2);max-width:220px" title="'+escAttr(j.pipeline_phase||'')+'">'+esc(trunc(j.pipeline_phase||'—',120))+'</td>';
    h+='<td style="font-size:11px;color:var(--muted)">'+esc(rph||'—')+'</td>';
    h+='<td class="job-err-cell"><div class="job-err-inner"><span class="job-err-text" title="'+escAttr(j.last_error||'')+'">'+esc(trunc(j.last_error,200))+'</span>';
    if(j.last_error){
      h+='<button type="button" class="btn-ghost job-err-copy" title="Copy full error text" onclick="copyJobLastErr(event,'+i+')">Copy</button>';
    }
    h+='</div></td>';
    h+='<td style="font-size:12px">'+esc(j.recommended_route||'—')+'</td>';
    h+='<td>'+esc(j.pre_gen_score||'—')+'</td>';
    h+='<td>'+esc(j.qc_status||'—')+'</td>';
    h+='<td style="font-size:11px;color:var(--muted)">'+fmtDate(j.updated_at)+'</td></tr>';
    h+='<tr class="job-detail-row" id="job-detail-'+i+'" style="display:none" onclick="event.stopPropagation()"><td colspan="12"><div id="job-detail-body-'+i+'" class="job-detail-body" data-loaded="0" onclick="event.stopPropagation()"></div></td></tr>';
  }
  h+='</tbody></table>';
  document.getElementById('jobs-table').innerHTML=h;
  window.requestAnimationFrame(function(){window.scrollTo(0,scrollY);});
  if(preserveTask){
    var reopen=-1;
    for(var ri=0;ri<d.rows.length;ri++){if(d.rows[ri].task_id===preserveTask){reopen=ri;break;}}
    if(reopen>=0){
      var dr=document.getElementById('job-detail-'+reopen);
      var bd=document.getElementById('job-detail-body-'+reopen);
      if(dr&&bd){
        dr.style.display='table-row';
        jobDetailOpenTaskId=preserveTask;
        bd.setAttribute('data-loaded','0');
        fetchJobDetailInto(bd,preserveTask);
      }
    }else{
      jobDetailOpenTaskId=null;
    }
  }
  var st=document.getElementById('jobs-live-status');
  if(st)st.textContent='Updated '+new Date().toLocaleTimeString();
  var totalPages=Math.ceil(d.total/d.limit);
  var pg='<span>Page '+d.page+' of '+totalPages+' ('+d.total+' total)</span>';
  if(d.page>1)pg+=' <button class="btn-ghost" onclick="loadJobs('+(d.page-1)+')">Prev</button>';
  if(d.page<totalPages)pg+=' <button class="btn-ghost" onclick="loadJobs('+(d.page+1)+')">Next</button>';
  document.getElementById('jobs-pager').innerHTML=pg;
  restartJobsPoll();
}
document.getElementById('jobs-live')?.addEventListener('change',restartJobsPoll);
loadFacets().then(function(){return loadJobs(1);});
window.addEventListener('pageshow',function(ev){if(ev.persisted)setTimeout(function(){loadFacets().then(function(){return loadJobs(jobsPage);});},0);});
</script>`;
    reply
      .header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
      .type("text/html")
      .send(page("Jobs", "jobs", body, projects, currentSlug, adminHeadTokenScript(config)));
  });

  // --- Decision Engine (global, not project-scoped) ---
  app.get("/admin/engine", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const projects = await listProjects(db);
    const project = await resolveProject(db, query.project);
    const currentSlug = project?.slug ?? projects[0]?.slug ?? "";
    const pqJs = currentSlug ? `+'&project=${encodeURIComponent(currentSlug)}'` : "";

    const body = `
<div class="ph"><div><h2>Decision Engine</h2><span class="ph-sub">Suppression rules, learning rules, prompts, and decision traces</span></div></div>
<div class="content" id="engine-content"><div class="empty">Loading...</div></div>
<script>
async function loadEngine(){
  const r=await cafFetch('/v1/admin/engine?project=${encodeURIComponent(currentSlug)}');const d=await r.json();
  if(!d.ok){document.getElementById('engine-content').innerHTML='<div class="empty">'+esc(d.error||'Error')+'</div>';return;}
  let h='';
  h+='<div class="card"><div class="card-h">Scoring Weights (v'+esc(d.engine_version)+')</div>';
  const w=d.scoring_weights;
  h+='<div class="info-row"><span class="info-l">Confidence</span><span class="info-v">'+w.confidence+'</span></div>';
  h+='<div class="info-row"><span class="info-l">Platform fit</span><span class="info-v">'+w.platform_fit+'</span></div>';
  h+='<div class="info-row"><span class="info-l">Novelty</span><span class="info-v">'+w.novelty+'</span></div>';
  h+='<div class="info-row"><span class="info-l">Past performance</span><span class="info-v">'+w.past_performance+'</span></div>';
  h+='</div>';
  h+='<div class="card"><div class="card-h">Suppression Rules ('+d.suppression_rules.length+')</div>';
  if(d.suppression_rules.length){h+='<table><thead><tr><th>Type</th><th>Scope</th><th>Threshold</th><th>Window</th><th>Action</th><th>Active</th></tr></thead><tbody>';
  for(const r of d.suppression_rules){const scope=[r.scope_flow_type,r.scope_platform].filter(Boolean).join(' / ')||'—';h+='<tr><td>'+esc(r.rule_type)+'</td><td>'+esc(scope)+'</td><td>'+esc(r.threshold_numeric||'—')+'</td><td>'+(r.window_days||'—')+' days</td><td>'+esc(r.action)+'</td><td>'+(r.active?'<span class="badge badge-g">Active</span>':'<span class="badge badge-r">Inactive</span>')+'</td></tr>';}
  h+='</tbody></table>';}else h+='<div class="empty">No suppression rules</div>';h+='</div>';
  h+='<div class="card"><div class="card-h">Learning Rules ('+d.learning_rules.length+')</div>';
  if(d.learning_rules.length){h+='<table><thead><tr><th>Rule ID</th><th>Trigger</th><th>Scope</th><th>Action</th><th>Status</th><th>Applied</th></tr></thead><tbody>';
  for(const r of d.learning_rules){const scope=[r.scope_flow_type,r.scope_platform].filter(Boolean).join(' / ')||'—';h+='<tr><td class="mono">'+esc(r.rule_id)+'</td><td>'+esc(r.trigger_type)+'</td><td>'+esc(scope)+'</td><td>'+esc(r.action_type)+'</td><td>'+badge(r.status)+'</td><td>'+fmtDate(r.applied_at)+'</td></tr>';}
  h+='</tbody></table>';}else h+='<div class="empty">No learning rules</div>';h+='</div>';
  h+='<div class="card"><div class="card-h">Prompt Versions ('+d.prompt_versions.length+')</div>';
  if(d.prompt_versions.length){h+='<table><thead><tr><th>Prompt ID</th><th>Version</th><th>Flow Type</th><th>Status</th><th>Created</th></tr></thead><tbody>';
  for(const p of d.prompt_versions){h+='<tr><td class="mono">'+esc(p.prompt_id)+'</td><td>'+esc(p.version)+'</td><td>'+esc(p.flow_type)+'</td><td>'+badge(p.status)+'</td><td>'+fmtDate(p.created_at)+'</td></tr>';}
  h+='</tbody></table>';}else h+='<div class="empty">No prompt versions</div>';h+='</div>';
  h+='<div class="card"><div class="card-h">Recent Decision Traces ('+d.decision_traces.length+')</div>';
  if(d.decision_traces.length){h+='<table><thead><tr><th>Trace ID</th><th>Run</th><th>Engine</th><th>Created</th><th>Details</th></tr></thead><tbody>';
  for(const t of d.decision_traces){h+='<tr><td class="mono" style="font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(t.trace_id)+'">'+esc(t.trace_id)+'</td>';
  h+='<td class="mono" style="font-size:11px">'+esc(t.run_id||'—')+'</td><td>'+esc(t.engine_version)+'</td><td>'+fmtDate(t.created_at)+'</td>';
  h+='<td><details><summary style="cursor:pointer;color:var(--accent);font-size:12px">View</summary><div style="margin-top:8px"><p style="font-size:11px;color:var(--muted);margin-bottom:4px">Input:</p><pre class="json">'+esc(JSON.stringify(t.input_snapshot,null,2))+'</pre><p style="font-size:11px;color:var(--muted);margin:8px 0 4px">Output:</p><pre class="json">'+esc(JSON.stringify(t.output_snapshot,null,2))+'</pre></div></details></td></tr>';}
  h+='</tbody></table>';}else h+='<div class="empty">No decision traces</div>';h+='</div>';
  document.getElementById('engine-content').innerHTML=h;
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function badge(s){const u=(s||'').toUpperCase();let c='badge-b';if(u==='ACTIVE'||u==='APPROVED')c='badge-g';else if(u==='PENDING'||u==='TEST')c='badge-y';else if(u==='INACTIVE'||u==='DEPRECATED')c='badge-r';return '<span class="badge '+c+'">'+esc(s||'—')+'</span>';}
function fmtDate(d){if(!d)return '—';try{return new Date(d).toLocaleString()}catch{return d}}
loadEngine();
</script>`;
    reply.type("text/html").send(page("Decision Engine", "engine", body, projects, currentSlug, adminHeadTokenScript(config)));
  });

  // --- Flow Engine (global, CAF-Core level) ---
  app.get("/admin/flow-engine", async (_, reply) => {
    const projects = await listProjects(db);
    const body = `
<div class="ph"><div><h2>Flow Engine</h2><span class="ph-sub">Global catalog — shared across all projects</span></div></div>
<div class="tabs" id="fe-tabs">
  <button class="tab active" onclick="feTab('flow-defs',this)">Flow Definitions</button>
  <button class="tab" onclick="feTab('prompt-tpl',this)">Prompt Templates</button>
  <button class="tab" onclick="feTab('schemas',this)">Output Schemas</button>
  <button class="tab" onclick="feTab('carousel-tpl',this)">Carousel Templates</button>
  <button class="tab" onclick="feTab('qc',this)">QC Checklists</button>
  <button class="tab" onclick="feTab('risk',this)">Risk Policies</button>
</div>
<div class="content" id="fe-content"><div class="empty">Loading...</div></div>
<script>
function feTab(id,btn){
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('#fe-tabs .tab').forEach(t=>t.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  btn.classList.add('active');
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function badge(s){const u=(s||'').toUpperCase();let c='badge-b';if(u==='ACTIVE'||u==='APPROVED'||u==='TRUE')c='badge-g';else if(u==='INACTIVE'||u==='DEPRECATED'||u==='FALSE')c='badge-r';else if(u==='PENDING'||u==='TEST')c='badge-y';return '<span class="badge '+c+'">'+esc(s||'—')+'</span>';}
function fg(name,label,value,type,step){return '<div class="form-group"><label for="'+name+'">'+label+'</label><input type="'+(type||'text')+'" name="'+name+'" id="'+name+'" value="'+esc(value)+'"'+(step?' step="'+step+'"':'')+'></div>';}
function fgTa(name,label,value){return '<div class="form-group"><label for="'+name+'">'+label+'</label><textarea name="'+name+'" id="'+name+'" rows="3">'+esc(value)+'</textarea></div>';}
function fgCheck(name,label,checked){return '<div class="form-group" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="'+name+'" id="'+name+'"'+(checked?' checked':'')+' style="width:auto"><label for="'+name+'" style="margin:0">'+label+'</label></div>';}

const FE_FIELDS={
  'flow-def':[{k:'flow_type',l:'Flow Type',r:1},{k:'description',l:'Description',ta:1},{k:'category',l:'Category'},{k:'supported_platforms',l:'Supported Platforms'},{k:'output_asset_types',l:'Output Asset Types'},{k:'requires_signal_pack',l:'Requires Signal Pack',t:'checkbox'},{k:'requires_learning_context',l:'Requires Learning Context',t:'checkbox'},{k:'requires_brand_constraints',l:'Requires Brand Constraints',t:'checkbox'},{k:'required_inputs',l:'Required Inputs',ta:1},{k:'optional_inputs',l:'Optional Inputs',ta:1},{k:'default_variation_count',l:'Default Variation Count',t:'number'},{k:'output_schema_name',l:'Output Schema Name'},{k:'output_schema_version',l:'Output Schema Version'},{k:'qc_checklist_name',l:'QC Checklist Name'},{k:'qc_checklist_version',l:'QC Checklist Version'},{k:'risk_profile_default',l:'Risk Profile Default'},{k:'notes',l:'Notes',ta:1}],
  'prompt-tpl':[{k:'prompt_name',l:'Prompt Name',r:1},{k:'flow_type',l:'Flow Type',r:1},{k:'prompt_role',l:'Prompt Role'},{k:'system_prompt',l:'System Prompt',ta:1},{k:'user_prompt_template',l:'User Prompt Template',ta:1},{k:'output_format_rule',l:'Output Format Rule',ta:1},{k:'schema_name',l:'Schema Name'},{k:'schema_version',l:'Schema Version'},{k:'temperature_default',l:'Temperature',t:'number',step:'0.01'},{k:'max_tokens_default',l:'Max Tokens',t:'number'},{k:'stop_sequences',l:'Stop Sequences'},{k:'notes',l:'Notes',ta:1}],
  'carousel-tpl':[{k:'template_key',l:'Template Key',r:1},{k:'platform',l:'Platform'},{k:'default_slide_count',l:'Default Slide Count',t:'number'},{k:'engine',l:'Engine'},{k:'html_template_name',l:'HTML Template Name'},{k:'adapter_key',l:'Adapter Key'}],
  'qc-checklist':[{k:'check_id',l:'Check ID',r:1},{k:'check_name',l:'Check Name'},{k:'check_type',l:'Check Type'},{k:'field_path',l:'Field Path'},{k:'operator',l:'Operator'},{k:'threshold_value',l:'Threshold Value'},{k:'severity',l:'Severity'},{k:'blocking',l:'Blocking',t:'checkbox'},{k:'failure_message',l:'Failure Message',ta:1},{k:'auto_fix_action',l:'Auto-fix Action'},{k:'flow_type',l:'Flow Type'},{k:'notes',l:'Notes',ta:1}],
  'risk-policy':[{k:'risk_policy_name',l:'Policy Name',r:1},{k:'risk_policy_version',l:'Version'},{k:'risk_category',l:'Category'},{k:'detection_method',l:'Detection Method'},{k:'detection_terms',l:'Detection Terms',ta:1},{k:'severity_level',l:'Severity Level'},{k:'default_action',l:'Default Action'},{k:'requires_manual_review',l:'Requires Manual Review',t:'checkbox'},{k:'block_publish',l:'Block Publish',t:'checkbox'},{k:'disclaimer_template_name',l:'Disclaimer Template Name'},{k:'notes',l:'Notes',ta:1}]
};

async function loadFE(){
  const r=await cafFetch('/v1/admin/flow-engine');const d=await r.json();
  if(!d.ok){document.getElementById('fe-content').innerHTML='<div class="empty">Error loading</div>';return;}
  let h='';

  // Flow Definitions
  const fd=d.flow_definitions||[];
  h+='<div id="flow-defs" class="tab-panel active"><div class="card"><div class="card-h">Flow Definitions ('+fd.length+') <button class="btn btn-sm" style="float:right;text-transform:none;letter-spacing:0" onclick="feEdit(\\'flow-def\\',{active:true})">+ Add</button></div>';
  if(fd.length){h+='<div style="overflow-x:auto"><table><thead><tr><th>Flow Type</th><th>Category</th><th>Platforms</th><th>Variations</th><th>Notes</th><th></th></tr></thead><tbody>';
  for(const f of fd){h+='<tr><td><strong>'+esc(f.flow_type)+'</strong></td><td>'+esc(f.category||'—')+'</td><td>'+esc(f.supported_platforms||'—')+'</td><td>'+f.default_variation_count+'</td><td>'+esc(f.notes||'—')+'</td><td style="white-space:nowrap"><button class="btn-ghost" onclick="feEdit(\\'flow-def\\','+esc(JSON.stringify(f))+')">Edit</button> <button class="btn-ghost" style="color:var(--red)" onclick="feDel(\\'flow-def\\','+esc(JSON.stringify({flow_type:f.flow_type}))+')">Del</button></td></tr>';}
  h+='</tbody></table></div>';}else h+='<div class="empty">No flow definitions yet.</div>';
  h+='</div></div>';

  // Prompt Templates
  const pt=d.prompt_templates||[];
  h+='<div id="prompt-tpl" class="tab-panel"><div class="card"><div class="card-h">Prompt Templates ('+pt.length+') <button class="btn btn-sm" style="float:right;text-transform:none;letter-spacing:0" onclick="feEdit(\\'prompt-tpl\\',{active:true})">+ Add</button></div>';
  if(pt.length){h+='<div style="overflow-x:auto"><table><thead><tr><th>Prompt Name</th><th>Flow Type</th><th>Role</th><th>Temp</th><th>Max Tokens</th><th></th></tr></thead><tbody>';
  for(const p of pt){h+='<tr><td class="mono">'+esc(p.prompt_name)+'</td><td>'+esc(p.flow_type)+'</td><td>'+esc(p.prompt_role||'—')+'</td><td>'+esc(p.temperature_default||'—')+'</td><td>'+esc(p.max_tokens_default||'—')+'</td><td style="white-space:nowrap"><button class="btn-ghost" onclick="feEdit(\\'prompt-tpl\\','+esc(JSON.stringify(p))+')">Edit</button> <button class="btn-ghost" style="color:var(--red)" onclick="feDel(\\'prompt-tpl\\','+esc(JSON.stringify({prompt_name:p.prompt_name,flow_type:p.flow_type}))+')">Del</button></td></tr>';}
  h+='</tbody></table></div>';}else h+='<div class="empty">No prompt templates yet.</div>';
  h+='</div></div>';

  // Output Schemas
  const os=d.output_schemas||[];
  h+='<div id="schemas" class="tab-panel"><div class="card"><div class="card-h">Output Schemas ('+os.length+')</div>';
  if(os.length){h+='<table><thead><tr><th>Name</th><th>Version</th><th>Flow Type</th></tr></thead><tbody>';
  for(const s of os){h+='<tr><td>'+esc(s.output_schema_name)+'</td><td>'+esc(s.output_schema_version)+'</td><td>'+esc(s.flow_type)+'</td></tr>';}
  h+='</tbody></table>';}else h+='<div class="empty">No output schemas yet.</div>';
  h+='</div></div>';

  // Carousel Templates
  const ct=d.carousel_templates||[];
  h+='<div id="carousel-tpl" class="tab-panel"><div class="card"><div class="card-h">Carousel Templates ('+ct.length+') <button class="btn btn-sm" style="float:right;text-transform:none;letter-spacing:0" onclick="feEdit(\\'carousel-tpl\\',{active:true})">+ Add</button></div>';
  if(ct.length){h+='<table><thead><tr><th>Template Key</th><th>Platform</th><th>Slides</th><th>Engine</th><th></th></tr></thead><tbody>';
  for(const c of ct){h+='<tr><td class="mono">'+esc(c.template_key)+'</td><td>'+esc(c.platform||'—')+'</td><td>'+esc(c.default_slide_count||'—')+'</td><td>'+esc(c.engine||'—')+'</td><td><button class="btn-ghost" onclick="feEdit(\\'carousel-tpl\\','+esc(JSON.stringify(c))+')">Edit</button></td></tr>';}
  h+='</tbody></table>';}else h+='<div class="empty">No carousel templates yet.</div>';
  h+='</div></div>';

  // QC Checklists
  const qc=d.qc_checklists||[];
  h+='<div id="qc" class="tab-panel"><div class="card"><div class="card-h">QC Checklists ('+qc.length+') <button class="btn btn-sm" style="float:right;text-transform:none;letter-spacing:0" onclick="feEdit(\\'qc-checklist\\',{active:true})">+ Add</button></div>';
  if(qc.length){h+='<div style="overflow-x:auto"><table><thead><tr><th>Check ID</th><th>Name</th><th>Type</th><th>Severity</th><th>Blocking</th><th>Flow Type</th><th></th></tr></thead><tbody>';
  for(const c of qc){h+='<tr><td class="mono">'+esc(c.check_id)+'</td><td>'+esc(c.check_name||'—')+'</td><td>'+esc(c.check_type||'—')+'</td><td>'+esc(c.severity||'—')+'</td><td>'+(c.blocking?'Yes':'No')+'</td><td>'+esc(c.flow_type||'—')+'</td><td><button class="btn-ghost" onclick="feEdit(\\'qc-checklist\\','+esc(JSON.stringify(c))+')">Edit</button></td></tr>';}
  h+='</tbody></table></div>';}else h+='<div class="empty">No QC checklists yet.</div>';
  h+='</div></div>';

  // Risk Policies
  const rp=d.risk_policies||[];
  h+='<div id="risk" class="tab-panel"><div class="card"><div class="card-h">Risk Policies ('+rp.length+') <button class="btn btn-sm" style="float:right;text-transform:none;letter-spacing:0" onclick="feEdit(\\'risk-policy\\',{active:true})">+ Add</button></div>';
  if(rp.length){h+='<div style="overflow-x:auto"><table><thead><tr><th>Name</th><th>Version</th><th>Category</th><th>Severity</th><th>Action</th><th>Manual</th><th>Block</th><th></th></tr></thead><tbody>';
  for(const r of rp){h+='<tr><td>'+esc(r.risk_policy_name)+'</td><td>'+esc(r.risk_policy_version)+'</td><td>'+esc(r.risk_category||'—')+'</td><td>'+esc(r.severity_level||'—')+'</td><td>'+esc(r.default_action||'—')+'</td><td>'+(r.requires_manual_review?'Yes':'No')+'</td><td>'+(r.block_publish?'Yes':'No')+'</td><td><button class="btn-ghost" onclick="feEdit(\\'risk-policy\\','+esc(JSON.stringify(r))+')">Edit</button></td></tr>';}
  h+='</tbody></table></div>';}else h+='<div class="empty">No risk policies yet.</div>';
  h+='</div></div>';

  document.getElementById('fe-content').innerHTML=h;
}

function feEdit(type,data){
  const fields=FE_FIELDS[type];if(!fields)return;
  let h='<dialog id="fe-dlg" open><h3>'+(data&&data.id?'Edit':'Add')+' '+type.replace(/-/g,' ')+'</h3>';
  h+='<form id="fe-form" class="config-form" style="max-width:100%">';
  for(const f of fields){
    const v=data[f.k]!=null?data[f.k]:'';
    if(f.t==='checkbox')h+=fgCheck('fe_'+f.k,f.l,!!v);
    else if(f.ta)h+=fgTa('fe_'+f.k,f.l,v);
    else h+=fg('fe_'+f.k,f.l,v,f.t||'text',f.step);
  }
  h+='<div class="form-actions"><button type="submit" class="btn">Save</button> <button type="button" class="btn-ghost" onclick="document.getElementById(\\'fe-dlg\\').remove()">Cancel</button><span id="fe-msg" class="form-msg"></span></div>';
  h+='</form></dialog>';
  document.body.insertAdjacentHTML('beforeend',h);
  document.getElementById('fe-form').addEventListener('submit',async(e)=>{
    e.preventDefault();
    const body={};
    for(const f of fields){
      const el=document.getElementById('fe_'+f.k);
      if(!el)continue;
      if(el.type==='checkbox')body[f.k]=el.checked;
      else body[f.k]=el.value;
    }
    const msg=document.getElementById('fe-msg');
    msg.textContent='Saving...';msg.style.color='var(--accent)';
    try{
      const r=await cafFetch('/v1/admin/flow-engine/'+type,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const d=await r.json();
      if(d.ok){msg.textContent='Saved!';msg.style.color='var(--green)';setTimeout(()=>{document.getElementById('fe-dlg')?.remove();loadFE();},800);}
      else{msg.textContent=d.error||'Failed';msg.style.color='var(--red)';}
    }catch(err){msg.textContent='Error: '+err.message;msg.style.color='var(--red)';}
  });
}

async function feDel(type,identifiers){
  if(!confirm('Delete this '+type.replace(/-/g,' ')+'?'))return;
  try{
    const r=await cafFetch('/v1/admin/flow-engine/'+type+'/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(identifiers)});
    const d=await r.json();if(d.ok)loadFE();else alert(d.error||'Failed');
  }catch(err){alert('Error: '+err.message);}
}

loadFE();
</script>`;
    reply.type("text/html").send(page("Flow Engine", "flow-engine", body, projects, "", adminHeadTokenScript(config)));
  });

  // --- Project Config (tabbed: constraints, strategy, brand, platforms, flow types, risk rules, prompts, reference posts, heygen) ---
  app.get("/admin/config", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const projects = await listProjects(db);
    const project = await resolveProject(db, query.project);
    if (!project) {
      const body = `<div class="ph"><div><h2>Project Config</h2><span class="ph-sub">No project selected</span></div></div><div class="content"><div class="empty" style="padding:80px 20px"><p style="font-size:16px;margin-bottom:16px">No projects exist yet.</p><a href="/admin/new-project" class="btn" style="display:inline-block;padding:10px 24px">Create your first project</a></div></div>`;
      reply.type("text/html").send(page("Project Config", "config", body, projects, "", adminHeadTokenScript(config)));
      return;
    }
    const currentSlug = project.slug;

    const body = `
<style>
tr.cfg-row-active td{background:rgba(59,130,246,.08)!important}
tr.cfg-inline-expand td{border-top:1px solid var(--border)}
</style>
<div class="ph"><div><h2>${esc(project.display_name || project.slug)}</h2><span class="ph-sub">Project Config — like your Google Sheets project config workbook</span></div></div>
<div class="tabs" id="config-tabs">
  <button class="tab active" onclick="cfgTab('tab-strategy',this)">Strategy Defaults</button>
  <button class="tab" onclick="cfgTab('tab-brand',this)">Brand Constraints</button>
  <button class="tab" onclick="cfgTab('tab-constraints',this)">System Constraints</button>
  <button class="tab" onclick="cfgTab('tab-platforms',this)">Platform Constraints</button>
  <button class="tab" onclick="cfgTab('tab-flows',this)">Allowed Flow Types</button>
  <button class="tab" onclick="cfgTab('tab-risk',this)">Risk Rules</button>
  <button class="tab" onclick="cfgTab('tab-prompts',this)">Prompt Versions</button>
  <button class="tab" onclick="cfgTab('tab-refposts',this)">Reference Posts</button>
  <button class="tab" onclick="cfgTab('tab-heygen',this)">HeyGen Config</button>
</div>
<div class="content" id="config-content"><div class="empty">Loading...</div></div>
<script>
const SLUG=${JSON.stringify(currentSlug)};

const STRATEGY_FIELDS=[
  {k:'project_type',l:'Project Type'},
  {k:'core_offer',l:'Core Offer',ta:true},
  {k:'target_audience',l:'Target Audience',ta:true},
  {k:'audience_problem',l:'Audience Problem',ta:true},
  {k:'transformation_promise',l:'Transformation Promise',ta:true},
  {k:'positioning_statement',l:'Positioning Statement',ta:true},
  {k:'primary_business_goal',l:'Primary Business Goal'},
  {k:'primary_content_goal',l:'Primary Content Goal'},
  {k:'north_star_metric',l:'North Star Metric'},
  {k:'monetization_model',l:'Monetization Model'},
  {k:'traffic_destination',l:'Traffic Destination'},
  {k:'funnel_stage_focus',l:'Funnel Stage Focus'},
  {k:'brand_archetype',l:'Brand Archetype'},
  {k:'strategic_content_pillars',l:'Strategic Content Pillars',ta:true},
  {k:'authority_angle',l:'Authority Angle',ta:true},
  {k:'differentiation_angle',l:'Differentiation Angle',ta:true},
  {k:'growth_strategy',l:'Growth Strategy'},
  {k:'publishing_intensity',l:'Publishing Intensity'},
  {k:'time_horizon',l:'Time Horizon'},
  {k:'owner',l:'Owner'},
  {k:'notes',l:'Notes',ta:true}
];

const BRAND_FIELDS=[
  {k:'tone',l:'Tone'},
  {k:'voice_style',l:'Voice Style'},
  {k:'audience_level',l:'Audience Level'},
  {k:'emotional_intensity',l:'Emotional Intensity (1-10)',t:'number'},
  {k:'humor_level',l:'Humor Level (1-10)',t:'number'},
  {k:'emoji_policy',l:'Emoji Policy'},
  {k:'max_emojis_per_caption',l:'Max Emojis per Caption',t:'number'},
  {k:'banned_claims',l:'Banned Claims',ta:true},
  {k:'banned_words',l:'Banned Words',ta:true},
  {k:'mandatory_disclaimers',l:'Mandatory Disclaimers',ta:true},
  {k:'cta_style_rules',l:'CTA Style Rules',ta:true},
  {k:'storytelling_style',l:'Storytelling Style'},
  {k:'positioning_statement',l:'Positioning Statement',ta:true},
  {k:'differentiation_angle',l:'Differentiation Angle',ta:true},
  {k:'risk_level_default',l:'Risk Level Default'},
  {k:'manual_review_required',l:'Manual Review Required',t:'checkbox'},
  {k:'notes',l:'Notes',ta:true}
];

function fg(name,label,value,type,step){
  return '<div class="form-group"><label for="'+name+'">'+label+'</label>'
    +'<input type="'+(type||'text')+'" name="'+name+'" id="'+name+'" value="'+esc(value)+'"'
    +(step?' step="'+step+'"':'')+'></div>';
}
function fgTa(name,label,value){
  return '<div class="form-group"><label for="'+name+'">'+label+'</label>'
    +'<textarea name="'+name+'" id="'+name+'" rows="3">'+esc(value)+'</textarea></div>';
}
function fgCheck(name,label,checked){
  return '<div class="form-group" style="flex-direction:row;align-items:center;gap:8px">'
    +'<input type="checkbox" name="'+name+'" id="'+name+'"'+(checked?' checked':'')+' style="width:auto">'
    +'<label for="'+name+'" style="margin:0">'+label+'</label></div>';
}

function cfgTab(id,btn){
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('#config-tabs .tab').forEach(t=>t.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  btn.classList.add('active');
}

async function loadConfig(){
  const r=await cafFetch('/v1/admin/config?project='+encodeURIComponent(SLUG));const d=await r.json();
  if(!d.ok){document.getElementById('config-content').innerHTML='<div class="empty">'+(d.error||'Error')+'</div>';return;}
  let h='';

  // === Strategy Defaults (editable) ===
  const s=d.profile?.strategy||{};
  h+='<div id="tab-strategy" class="tab-panel active">';
  h+='<div class="card"><div class="card-h">Strategy Defaults</div>';
  h+='<form id="strategy-form" class="config-form">';
  for(const f of STRATEGY_FIELDS){
    if(f.ta) h+=fgTa('s_'+f.k,f.l,s[f.k]||'');
    else h+=fg('s_'+f.k,f.l,s[f.k]||'','text');
  }
  h+='<div class="form-actions"><button type="submit" class="btn">Save Strategy Defaults</button><span id="strategy-msg" class="form-msg"></span></div>';
  h+='</form></div></div>';

  // === Brand Constraints (editable) ===
  const b=d.profile?.brand||{};
  h+='<div id="tab-brand" class="tab-panel">';
  h+='<div class="card"><div class="card-h">Brand Constraints</div>';
  h+='<form id="brand-form" class="config-form">';
  for(const f of BRAND_FIELDS){
    if(f.t==='checkbox') h+=fgCheck('b_'+f.k,f.l,!!b[f.k]);
    else if(f.ta) h+=fgTa('b_'+f.k,f.l,b[f.k]||'');
    else h+=fg('b_'+f.k,f.l,b[f.k]!=null?b[f.k]:'',f.t||'text');
  }
  h+='<div class="form-actions"><button type="submit" class="btn">Save Brand Constraints</button><span id="brand-msg" class="form-msg"></span></div>';
  h+='</form></div></div>';

  // === System Constraints (editable) ===
  const c=d.constraints||{};
  h+='<div id="tab-constraints" class="tab-panel">';
  h+='<div class="card"><div class="card-h">System Constraints</div>';
  h+='<form id="constraints-form" class="config-form">';
  h+=fg('max_daily_jobs','Max Daily Jobs',c.max_daily_jobs||'','number');
  h+=fg('min_score_to_generate','Min Score to Generate',c.min_score_to_generate||'','number','0.01');
  h+=fg('max_active_prompt_versions','Max Active Prompt Versions',c.max_active_prompt_versions||'','number');
  h+=fg('default_variation_cap','Default Variation Cap',c.default_variation_cap||1,'number');
  h+=fg('auto_validation_pass_threshold','Auto-validation Pass Threshold',c.auto_validation_pass_threshold||'','number','0.01');
  h+=fg('max_carousel_jobs_per_run','Max carousel jobs (per run plan)',c.max_carousel_jobs_per_run??'','number');
  h+=fg('max_video_jobs_per_run','Max video/reel jobs (per run plan)',c.max_video_jobs_per_run??'','number');
  h+=fgTa('max_jobs_per_flow_type','Max jobs per flow type (JSON; overrides defaults — carousel flows default to 5 each, scene assembly + 3 HeyGen paths default to 1)',JSON.stringify(c.max_jobs_per_flow_type&&typeof c.max_jobs_per_flow_type==='object'?c.max_jobs_per_flow_type:{},null,2));
  h+='<div class="form-actions"><button type="submit" class="btn">Save Constraints</button><span id="constraints-msg" class="form-msg"></span></div>';
  h+='</form></div></div>';

  // === Platform Constraints (editable table) ===
  const pl=d.profile?.platforms||[];
  h+='<div id="tab-platforms" class="tab-panel"><div class="card"><div class="card-h">Platform Constraints ('+pl.length+') <button type="button" class="btn btn-sm" style="float:right;text-transform:none;letter-spacing:0" onclick="cfgBeginInlineAdd(this,\\'platform\\')">+ Add Platform</button></div>';
  if(pl.length){
    h+='<div style="overflow-x:auto"><table><thead><tr><th>Platform</th><th>Caption Max</th><th>Hook Max</th><th>Slides</th><th>Hashtags</th><th>Frequency</th><th>Notes</th><th></th></tr></thead><tbody>';
    for(const p of pl){
      h+='<tr><td><strong>'+esc(p.platform)+'</strong></td><td>'+esc(p.caption_max_chars||'—')+'</td>';
      h+='<td>'+esc(p.hook_max_chars||'—')+'</td>';
      h+='<td>'+(p.slide_min||'—')+' – '+(p.slide_max||'—')+'</td>';
      h+='<td>'+esc(p.max_hashtags||'—')+'</td>';
      h+='<td>'+esc(p.posting_frequency_limit||'—')+'</td>';
      h+='<td>'+esc(p.notes||'—')+'</td>';
      h+='<td style="white-space:nowrap"><button type="button" class="btn-ghost" onclick="cfgBeginInlineEdit(this,\\'platform\\',\\''+encodeURIComponent(JSON.stringify(p))+'\\')">Edit</button> ';
      h+='<button type="button" class="btn-ghost" style="color:var(--red)" onclick="cfgDel(\\'platform\\',\\''+encodeURIComponent(JSON.stringify({platform:p.platform}))+'\\')">Del</button></td></tr>';
    }
    h+='</tbody></table></div>';
  }else h+='<div class="empty">No platform constraints yet.</div>';
  h+='</div></div>';

  // === Allowed Flow Types (editable table) ===
  const ft=d.profile?.flow_types||[];
  h+='<div id="tab-flows" class="tab-panel"><div class="card"><div class="card-h">Allowed Flow Types ('+ft.length+') <button type="button" class="btn btn-sm" style="float:right;text-transform:none;letter-spacing:0" onclick="cfgBeginInlineAdd(this,\\'flow-type\\')">+ Add Flow Type</button></div>';
  if(ft.length){
    h+='<div style="overflow-x:auto"><table><thead><tr><th>Flow Type</th><th>Enabled</th><th>Variations</th><th>Platforms</th><th>Priority</th><th>Prompt Template</th><th>Notes</th><th></th></tr></thead><tbody>';
    for(const f of ft){
      h+='<tr><td><strong>'+esc(f.flow_type)+'</strong></td>';
      h+='<td>'+(f.enabled?'<span class="badge badge-g">Yes</span>':'<span class="badge badge-r">No</span>')+'</td>';
      h+='<td>'+f.default_variation_count+'</td>';
      h+='<td>'+esc(f.allowed_platforms||'—')+'</td>';
      h+='<td>'+esc(f.priority_weight||'—')+'</td>';
      h+='<td class="mono">'+esc(f.prompt_template_id||'—')+'</td>';
      h+='<td>'+esc(f.notes||'—')+'</td>';
      h+='<td style="white-space:nowrap"><button type="button" class="btn-ghost" onclick="cfgBeginInlineEdit(this,\\'flow-type\\',\\''+encodeURIComponent(JSON.stringify(f))+'\\')">Edit</button> ';
      h+='<button type="button" class="btn-ghost" style="color:var(--red)" onclick="cfgDel(\\'flow-type\\',\\''+encodeURIComponent(JSON.stringify({flow_type:f.flow_type}))+'\\')">Del</button></td></tr>';
    }
    h+='</tbody></table></div>';
  }else h+='<div class="empty">No flow types yet.</div>';
  h+='</div></div>';

  // === Risk Rules (editable table) ===
  const rr=d.profile?.risk_rules||[];
  h+='<div id="tab-risk" class="tab-panel"><div class="card"><div class="card-h">Risk Rules ('+rr.length+') <button type="button" class="btn btn-sm" style="float:right;text-transform:none;letter-spacing:0" onclick="cfgBeginInlineAdd(this,\\'risk-rule\\')">+ Add Risk Rule</button></div>';
  if(rr.length){
    h+='<div style="overflow-x:auto"><table><thead><tr><th>Flow Type</th><th>Trigger</th><th>Risk Level</th><th>Auto-approve</th><th>Manual Review</th><th>Notes</th><th></th></tr></thead><tbody>';
    for(const r of rr){
      h+='<tr><td>'+esc(r.flow_type)+'</td><td>'+esc(r.trigger_condition||'—')+'</td><td>'+esc(r.risk_level||'—')+'</td>';
      h+='<td>'+(r.auto_approve_allowed?'Yes':'No')+'</td><td>'+(r.requires_manual_review?'Yes':'No')+'</td>';
      h+='<td>'+esc(r.notes||'—')+'</td>';
      h+='<td style="white-space:nowrap"><button type="button" class="btn-ghost" onclick="cfgBeginInlineEdit(this,\\'risk-rule\\',\\''+encodeURIComponent(JSON.stringify(r))+'\\')">Edit</button> ';
      h+='<button type="button" class="btn-ghost" style="color:var(--red)" onclick="cfgDel(\\'risk-rule\\',\\''+encodeURIComponent(JSON.stringify({id:r.id}))+'\\')">Del</button></td></tr>';
    }
    h+='</tbody></table></div>';
  }else h+='<div class="empty">No risk rules yet.</div>';
  h+='</div></div>';

  // === Prompt Versions ===
  h+='<div id="tab-prompts" class="tab-panel"><div class="card"><div class="card-h">Prompt Versions</div>';
  h+='<div class="empty">Prompt versions are managed on the <a href="/admin/engine">Decision Engine</a> page.</div>';
  h+='</div></div>';

  // === Reference Posts (editable table) ===
  const rp=d.profile?.reference_posts||[];
  h+='<div id="tab-refposts" class="tab-panel"><div class="card"><div class="card-h">Reference Posts ('+rp.length+') <button type="button" class="btn btn-sm" style="float:right;text-transform:none;letter-spacing:0" onclick="cfgBeginInlineAdd(this,\\'reference-post\\')">+ Add Post</button></div>';
  if(rp.length){
    h+='<table><thead><tr><th>Post ID</th><th>Platform</th><th>Status</th><th>URL</th><th>Notes</th><th></th></tr></thead><tbody>';
    for(const p of rp){
      h+='<tr><td class="mono">'+esc(p.reference_post_id)+'</td><td>'+esc(p.platform||'—')+'</td>';
      h+='<td>'+badge(p.status)+'</td>';
      h+='<td>'+(p.post_url?'<a href="'+esc(p.post_url)+'" target="_blank" style="max-width:200px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(p.post_url)+'</a>':'—')+'</td>';
      h+='<td>'+esc(p.notes||'—')+'</td>';
      h+='<td style="white-space:nowrap"><button type="button" class="btn-ghost" onclick="cfgBeginInlineEdit(this,\\'reference-post\\',\\''+encodeURIComponent(JSON.stringify(p))+'\\')">Edit</button> ';
      h+='<button type="button" class="btn-ghost" style="color:var(--red)" onclick="cfgDel(\\'reference-post\\',\\''+encodeURIComponent(JSON.stringify({reference_post_id:p.reference_post_id}))+'\\')">Del</button></td></tr>';
    }
    h+='</tbody></table>';
  }else h+='<div class="empty">No reference posts yet.</div>';
  h+='</div></div>';

  // === HeyGen Config (editable table) ===
  const hc=d.profile?.heygen_config||[];
  h+='<div id="tab-heygen" class="tab-panel"><div class="card"><div class="card-h">HeyGen Config ('+hc.length+') <button type="button" class="btn btn-sm" style="float:right;text-transform:none;letter-spacing:0" onclick="cfgBeginInlineAdd(this,\\'heygen\\')">+ Add Config</button></div>';
  if(hc.length){
    h+='<table><thead><tr><th>Config ID</th><th>Key</th><th>Value</th><th>Platform</th><th>Render Mode</th><th>Active</th><th></th></tr></thead><tbody>';
    for(const c of hc){
      h+='<tr><td class="mono" style="font-size:11px">'+esc(c.config_id)+'</td><td>'+esc(c.config_key)+'</td>';
      h+='<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(c.value)+'">'+esc(c.value||'—')+'</td>';
      h+='<td>'+esc(c.platform||'—')+'</td>';
      h+='<td>'+esc(c.render_mode||'—')+'</td>';
      h+='<td>'+(c.is_active?'<span class="badge badge-g">Active</span>':'<span class="badge badge-r">Off</span>')+'</td>';
      h+='<td style="white-space:nowrap"><button type="button" class="btn-ghost" onclick="cfgBeginInlineEdit(this,\\'heygen\\',\\''+encodeURIComponent(JSON.stringify(c))+'\\')">Edit</button> ';
      h+='<button type="button" class="btn-ghost" style="color:var(--red)" onclick="cfgDel(\\'heygen\\',\\''+encodeURIComponent(JSON.stringify({config_id:c.config_id}))+'\\')">Del</button></td></tr>';
    }
    h+='</tbody></table>';
  }else h+='<div class="empty">No HeyGen configuration yet.</div>';
  h+='</div></div>';

  document.getElementById('config-content').innerHTML=h;
  bindForms();
}

function bindForms(){
  document.getElementById('constraints-form')?.addEventListener('submit',async(e)=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const numField=(name)=>{const v=fd.get(name);if(v===''||v==null)return null;const n=Number(v);return Number.isFinite(n)?n:null;};
    const body={_project:SLUG,
      max_daily_jobs:numField('max_daily_jobs'),
      min_score_to_generate:numField('min_score_to_generate'),
      max_active_prompt_versions:numField('max_active_prompt_versions'),
      default_variation_cap:numField('default_variation_cap')??1,
      auto_validation_pass_threshold:numField('auto_validation_pass_threshold'),
      max_carousel_jobs_per_run:numField('max_carousel_jobs_per_run'),
      max_video_jobs_per_run:numField('max_video_jobs_per_run'),
    };
    const jt=String(fd.get('max_jobs_per_flow_type')||'').trim();
    if(jt){
      try{body.max_jobs_per_flow_type=JSON.parse(jt);}catch(err){alert('Invalid JSON in max jobs per flow type');return;}
    }else body.max_jobs_per_flow_type={};
    await postForm('/v1/admin/config/constraints',body,'constraints-msg');
  });
  document.getElementById('strategy-form')?.addEventListener('submit',async(e)=>{
    e.preventDefault();
    const fd=new FormData(e.target);const body={_project:SLUG};
    for(const[k,v]of fd.entries())body[k.replace('s_','')]=v;
    await postForm('/v1/admin/config/strategy',body,'strategy-msg');
  });
  document.getElementById('brand-form')?.addEventListener('submit',async(e)=>{
    e.preventDefault();
    const body={_project:SLUG};
    for(const f of document.getElementById('brand-form').elements){
      if(!f.name)continue;
      const key=f.name.replace('b_','');
      if(f.type==='checkbox')body[key]=f.checked;
      else body[key]=f.value;
    }
    await postForm('/v1/admin/config/brand',body,'brand-msg');
  });
}

async function postForm(url,body,msgId){
  const msg=document.getElementById(msgId);
  msg.textContent='Saving...';msg.style.color='var(--accent)';
  try{
    const r=await cafFetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();
    if(d.ok){msg.textContent='Saved!';msg.style.color='var(--green)'}
    else{msg.textContent=d.error||'Failed';msg.style.color='var(--red)'}
  }catch(err){msg.textContent='Error: '+err.message;msg.style.color='var(--red)'}
  setTimeout(()=>msg.textContent='',4000);
}

const FORM_FIELDS={
  'platform':[{k:'platform',l:'Platform',r:true},{k:'caption_max_chars',l:'Caption Max Chars',t:'number'},{k:'hook_max_chars',l:'Hook Max Chars',t:'number'},{k:'hook_must_fit_first_lines',l:'Hook Must Fit First Lines',t:'checkbox'},{k:'slide_min_chars',l:'Slide Min Chars',t:'number'},{k:'slide_max_chars',l:'Slide Max Chars',t:'number'},{k:'slide_min',l:'Slide Min',t:'number'},{k:'slide_max',l:'Slide Max',t:'number'},{k:'max_hashtags',l:'Max Hashtags',t:'number'},{k:'hashtag_format_rule',l:'Hashtag Format Rule'},{k:'line_break_policy',l:'Line Break Policy'},{k:'emoji_allowed',l:'Emoji Allowed',t:'checkbox'},{k:'link_allowed',l:'Link Allowed',t:'checkbox'},{k:'tag_allowed',l:'Tag Allowed',t:'checkbox'},{k:'formatting_rules',l:'Formatting Rules',ta:true},{k:'posting_frequency_limit',l:'Posting Frequency Limit'},{k:'best_posting_window',l:'Best Posting Window'},{k:'notes',l:'Notes',ta:true}],
  'flow-type':[{k:'flow_type',l:'Flow Type',r:true},{k:'enabled',l:'Enabled',t:'checkbox'},{k:'default_variation_count',l:'Default Variation Count',t:'number'},{k:'requires_signal_pack',l:'Requires Signal Pack',t:'checkbox'},{k:'requires_learning_context',l:'Requires Learning Context',t:'checkbox'},{k:'allowed_platforms',l:'Allowed Platforms'},{k:'output_schema_version',l:'Output Schema Version'},{k:'qc_checklist_version',l:'QC Checklist Version'},{k:'prompt_template_id',l:'Prompt Template ID'},{k:'priority_weight',l:'Priority Weight',t:'number',step:'0.01'},{k:'notes',l:'Notes',ta:true}],
  'risk-rule':[{k:'flow_type',l:'Flow Type',r:true},{k:'trigger_condition',l:'Trigger Condition',ta:true},{k:'risk_level',l:'Risk Level'},{k:'auto_approve_allowed',l:'Auto Approve Allowed',t:'checkbox'},{k:'requires_manual_review',l:'Requires Manual Review',t:'checkbox'},{k:'escalation_level',l:'Escalation Level'},{k:'sensitive_topics',l:'Sensitive Topics',ta:true},{k:'claim_restrictions',l:'Claim Restrictions',ta:true},{k:'rejection_reason_tag',l:'Rejection Reason Tag'},{k:'rollback_flag',l:'Rollback Flag',t:'checkbox'},{k:'notes',l:'Notes',ta:true}],
  'reference-post':[{k:'reference_post_id',l:'Reference Post ID',r:true},{k:'platform',l:'Platform'},{k:'post_url',l:'Post URL'},{k:'status',l:'Status'},{k:'last_run_id',l:'Last Run ID'},{k:'notes',l:'Notes',ta:true}],
  'heygen':[{k:'config_id',l:'Config ID',r:true},{k:'config_key',l:'Config Key',r:true},{k:'value',l:'Value',ta:true},{k:'platform',l:'Platform'},{k:'flow_type',l:'Flow Type'},{k:'render_mode',l:'Render Mode'},{k:'value_type',l:'Value Type'},{k:'is_active',l:'Active',t:'checkbox'},{k:'notes',l:'Notes',ta:true}]
};

function cfgDel(type,enc){
  try{
    delRow(type,JSON.parse(decodeURIComponent(enc)));
  }catch(e){
    alert('Could not delete: '+e.message);
  }
}

function cfgDismissInline(){
  document.querySelectorAll('tr.cfg-inline-expand').forEach(function(r){r.remove();});
  document.querySelectorAll('.cfg-inline-add-panel').forEach(function(r){r.remove();});
  document.querySelectorAll('tr.cfg-row-active').forEach(function(r){r.classList.remove('cfg-row-active');});
}

function cfgTableColCount(btn){
  var ths=btn.closest('.card').querySelectorAll('table thead th');
  return ths.length||8;
}

function cfgInlineFormFieldsHtml(type,data){
  var fields=FORM_FIELDS[type];
  if(!fields)return '';
  var inner='';
  for(var i=0;i<fields.length;i++){
    var f=fields[i];
    var v=data[f.k]!=null&&data[f.k]!==''?data[f.k]:'';
    var id='inline_e_'+f.k;
    if(f.t==='checkbox')inner+=fgCheck(id,f.l,v===true||v==='true'||v===1||v==='1');
    else if(f.ta)inner+=fgTa(id,f.l,v);
    else inner+=fg(id,f.l,v,f.t||'text',f.step);
  }
  inner+='<div class="form-actions" style="margin-top:14px"><button type="submit" class="btn">Save</button> <button type="button" class="btn-ghost cfg-inline-cancel">Cancel</button> <span class="form-msg cfg-inline-msg"></span></div>';
  return inner;
}

function cfgWireInlineForm(form,type){
  var fields=FORM_FIELDS[type];
  form.querySelector('.cfg-inline-cancel').onclick=function(){cfgDismissInline();loadConfig();};
  form.addEventListener('submit',async function(e){
    e.preventDefault();
    var msg=form.querySelector('.cfg-inline-msg');
    var body={_project:SLUG};
    for(var i=0;i<fields.length;i++){
      var f=fields[i];
      var el=document.getElementById('inline_e_'+f.k);
      if(!el)continue;
      if(el.type==='checkbox')body[f.k]=el.checked;
      else if(el.type==='number')body[f.k]=el.value===''?null:Number(el.value);
      else body[f.k]=el.value;
    }
    msg.textContent='Saving...';msg.style.color='var(--accent)';
    try{
      var r=await cafFetch('/v1/admin/config/'+type,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      var d=await r.json();
      if(d.ok){cfgDismissInline();loadConfig();}
      else{msg.textContent=d.error||'Failed';msg.style.color='var(--red)';}
    }catch(err){msg.textContent=err.message;msg.style.color='var(--red)';}
  });
}

function cfgBeginInlineEdit(btn,type,enc){
  cfgDismissInline();
  var data;
  try{data=JSON.parse(decodeURIComponent(enc));}
  catch(e){alert('Could not open editor: '+e.message);return;}
  var tr=btn.closest('tr');
  if(!tr)return;
  var ncol=tr.cells.length;
  tr.classList.add('cfg-row-active');
  var editTr=document.createElement('tr');
  editTr.className='cfg-inline-expand';
  editTr.innerHTML='<td colspan="'+ncol+'" style="background:var(--card2);padding:16px 20px;border-bottom:1px solid var(--border)"><form class="config-form cfg-inline-form">'+cfgInlineFormFieldsHtml(type,data)+'</form></td>';
  tr.insertAdjacentElement('afterend',editTr);
  cfgWireInlineForm(editTr.querySelector('form'),type);
}

function cfgBeginInlineAdd(btn,type){
  cfgDismissInline();
  var card=btn.closest('.card');
  var data={};
  var tbody=card.querySelector('tbody');
  var ncol=cfgTableColCount(btn);
  var title='<p style="font-size:12px;font-weight:600;color:var(--muted);margin:0 0 12px;text-transform:uppercase;letter-spacing:.04em">New '+String(type).replace(/-/g,' ')+'</p>';
  var formInner=title+cfgInlineFormFieldsHtml(type,data);
  if(tbody){
    var editTr=document.createElement('tr');
    editTr.className='cfg-inline-expand';
    editTr.innerHTML='<td colspan="'+ncol+'" style="background:var(--card2);padding:16px 20px;border-bottom:1px solid var(--border)"><form class="config-form cfg-inline-form">'+formInner+'</form></td>';
    tbody.appendChild(editTr);
    cfgWireInlineForm(editTr.querySelector('form'),type);
  }else{
    var panel=document.createElement('div');
    panel.className='cfg-inline-add-panel';
    panel.style.cssText='padding:16px 20px;background:var(--card2);border-bottom:1px solid var(--border)';
    panel.innerHTML='<form class="config-form cfg-inline-form">'+formInner+'</form>';
    var empty=card.querySelector('.empty');
    if(empty)empty.insertAdjacentElement('beforebegin',panel);
    else card.appendChild(panel);
    cfgWireInlineForm(panel.querySelector('form'),type);
  }
}

async function delRow(type,identifiers){
  if(!confirm('Delete this '+type.replace(/-/g,' ')+'?'))return;
  const body={_project:SLUG,...identifiers};
  try{
    const r=await cafFetch('/v1/admin/config/'+type+'/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();
    if(d.ok)loadConfig();
    else alert(d.error||'Failed to delete');
  }catch(err){alert('Error: '+err.message);}
}

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function badge(s){const u=(s||'').toUpperCase();let c='badge-b';if(u==='ACTIVE'||u==='APPROVED')c='badge-g';else if(u==='PENDING'||u==='SCRAPED')c='badge-y';else if(u==='INACTIVE'||u==='DEPRECATED')c='badge-r';return '<span class="badge '+c+'">'+esc(s||'—')+'</span>';}
function fmtDate(d){if(!d)return '—';try{return new Date(d).toLocaleString()}catch{return d}}
loadConfig();
</script>`;
    reply.type("text/html").send(page(currentSlug + " — Config", "config", body, projects, currentSlug, adminHeadTokenScript(config)));
  });
}
