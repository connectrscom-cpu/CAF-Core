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
import { listRuns, getRunByRunId, updateRunStatus } from "../repositories/runs.js";
import { listLearningRules } from "../repositories/learning.js";
import {
  getFullProjectProfile, upsertStrategyDefaults, upsertBrandConstraints,
  upsertProductProfile,
  upsertPlatformConstraints, deletePlatformConstraint,
  upsertRiskRule, deleteRiskRule,
  upsertAllowedFlowType, deleteAllowedFlowType,
  upsertReferencePost, deleteReferencePost,
  upsertHeygenConfig, deleteHeygenConfig,
  addProjectCarouselTemplate,
  removeProjectCarouselTemplate,
  setProjectCarouselTemplates,
} from "../repositories/project-config.js";
import {
  listFlowDefinitions, upsertFlowDefinition, deleteFlowDefinition,
  listPromptTemplates, upsertPromptTemplate, deletePromptTemplate,
  listOutputSchemas, upsertOutputSchema, deleteOutputSchema,
  listCarouselTemplates, upsertCarouselTemplate, deleteCarouselTemplate,
  listQcChecks, upsertQcCheck, deleteQcChecklist,
  listRiskPolicies, upsertRiskPolicy, deleteRiskPolicy,
} from "../repositories/flow-engine.js";
import { riskRulesNotEnforcedNotice } from "../services/risk-qc-status.js";
import { q, qOne } from "../db/queries.js";
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
  listTaskIdsMatchingJobFilters,
} from "../repositories/admin.js";
import { listApiCallAuditsForTask, listApiCallAuditsForRun } from "../repositories/api-call-audit.js";
import { listRunContentOutcomes } from "../repositories/run-content-outcomes.js";
import { getSignalPackById, listSignalPacks } from "../repositories/signal-packs.js";
import { buildJobContentPreview } from "../services/content-transparency-preview.js";
import { qcDetailFromGenerationPayload } from "../services/qc-runtime.js";
import { buildTransparencyTraceView } from "../services/planning-transparency.js";
import { runSceneAssemblyLabNew, runSceneAssemblyLabRegenerate } from "../services/scene-assembly-lab.js";
import {
  runSceneAssemblyMergeClipsFromStorage,
  runSceneAssemblyResumePipelineFromJobPayload,
} from "../services/scene-merge-from-storage.js";
import { processJobByTaskId, reprocessJobFromScratch } from "../services/job-pipeline.js";
import { executeRework } from "../services/rework-orchestrator.js";
import {
  deleteAllJobsForRun,
  deleteAllContentJobsForProject,
  deleteContentJobByTaskId,
  deleteContentJobsByTaskIds,
  getContentJobByTaskId,
} from "../repositories/jobs.js";
import {
  appendVideoUserPromptDurationHardFooter,
  withSceneAssemblyPolicy,
  withVideoPromptDurationPolicy,
  withVideoScriptDurationPolicy,
} from "../services/video-content-policy.js";
import { PUBLICATION_SYSTEM_ADDENDUM } from "../services/publish-metadata-enrich.js";
import { HEYGEN_VIDEO_AGENT_RUBRIC_LINES } from "../services/heygen-renderer.js";
import { APPROVED_CONTENT_LLM_REVIEW_SYSTEM_PROMPT } from "../services/approved-content-llm-review.js";
import { EDITORIAL_NOTES_LLM_SYNTHESIS_SYSTEM_PROMPT } from "../services/editorial-notes-llm-synthesis.js";
import {
  HEYGEN_FLOW_TYPES,
  isHeygenFlowType,
  PROMPT_LABS_CORE_LAYER_META,
  PROMPT_LABS_ENV_HINTS,
  PROMPT_LABS_HEYGEN_INTRO,
  promptTemplateRoleHint,
} from "../services/prompt-labs-meta.js";
import { VIDEO_PLAN_CAP_GROUPS, DEFAULT_VIDEO_FLOW_PLAN_CAP } from "../decision_engine/default-plan-caps.js";
import { isOfflinePipelineFlow } from "../services/offline-flow-types.js";
import { z } from "zod";

interface Deps { db: Pool; config: AppConfig; }

interface ProjectRow {
  id: string;
  slug: string;
  display_name: string | null;
  active: boolean;
  color?: string | null;
  is_system?: boolean;
  updated_at?: string;
  run_count?: number | string | null;
  job_count?: number | string | null;
}

async function listProjects(db: Pool, opts?: { include_system?: boolean }): Promise<ProjectRow[]> {
  const includeSystem = opts?.include_system === true;
  return q<ProjectRow>(
    db,
    `
      SELECT
        p.id,
        p.slug,
        p.display_name,
        p.active,
        p.color,
        p.is_system,
        p.updated_at,
        (SELECT count(*) FROM caf_core.runs r WHERE r.project_id = p.id) AS run_count,
        (SELECT count(*) FROM caf_core.content_jobs j WHERE j.project_id = p.id) AS job_count
      FROM caf_core.projects p
      WHERE ($1::boolean = true) OR (COALESCE(p.is_system,false) = false)
      ORDER BY p.slug
    `,
    [includeSystem]
  );
}

/** Trim and strip CR/LF (pasted URLs / form noise); empty → undefined */
function normalizeProjectSlugParam(slug: string | undefined | null): string | undefined {
  if (slug == null) return undefined;
  const cleaned = String(slug).replace(/[\r\n\t\v\f\u0085\u2028\u2029]+/g, "").trim();
  return cleaned === "" ? undefined : cleaned;
}

/** Like normalizeProjectSlugParam, but preserves empty string (for cleaning up corrupted rows). */
function cleanSlugLoose(slug: string | undefined | null): string | undefined {
  if (slug == null) return undefined;
  return String(slug).replace(/[\r\n\t\v\f\u0085\u2028\u2029]+/g, "").trim();
}

/** Renderer `.hbs` basename allowed for project carousel pins (admin). */
function isSafeCarouselHbsFilename(name: string): boolean {
  return /^[a-zA-Z0-9_.-]+\.hbs$/.test(name);
}

async function resolveProject(db: Pool, slugParam: string | undefined): Promise<ProjectRow | null> {
  const slug = normalizeProjectSlugParam(slugParam);
  if (!slug) {
    const projects = await listProjects(db);
    return projects[0] ?? null;
  }
  return qOne<ProjectRow>(
    db,
    `SELECT id, slug, display_name, active, color, is_system
     FROM caf_core.projects
     WHERE lower(regexp_replace(slug, '[\\r\\n\\t\\v\\f\\u0085\\u2028\\u2029]+', '', 'g')) = lower($1)
     LIMIT 1`,
    [slug]
  );
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
.sb-sublink{margin-left:14px;padding-left:18px;font-size:12px;color:var(--muted);position:relative}
.sb-sublink::before{content:"";position:absolute;left:6px;top:0;bottom:0;width:1px;background:var(--border)}
.sb-sublink:hover{color:var(--fg)}
.sb-sublink.active{background:var(--accent);color:#fff}
.sb-sublink.active::before{background:var(--accent)}
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
  const projectOptions = projects.map(p => {
    const slug = normalizeProjectSlugParam(p.slug) ?? String(p.slug ?? "");
    const label = p.display_name || slug;
    return `<option value="${esc(slug)}"${slug === currentSlug ? " selected" : ""}>${esc(label)}${p.active ? "" : " (inactive)"}</option>`;
  }).join("");

  const pq = currentSlug ? `?project=${encodeURIComponent(currentSlug)}` : "";

  const projectLinks = [
    { href: `/admin${pq}`, label: "Overview", key: "overview" },
    { href: `/admin/runs${pq}`, label: "Runs", key: "runs" },
    { href: `/admin/scene-lab${pq}`, label: "Scene lab", key: "scene-lab" },
    { href: `/admin/jobs${pq}`, label: "Jobs", key: "jobs" },
    { href: `/admin/config${pq}`, label: "Project Config", key: "config" },
  ];

  type GlobalLink = { href: string; label: string; key: string; children?: GlobalLink[] };
  const globalLinks: GlobalLink[] = [
    { href: "/admin/projects", label: "Projects", key: "projects" },
    {
      href: "/admin/global-learning",
      label: "Global Learning",
      key: "global-learning",
      // Sub-pages live under the Global Learning hub — the Decision Engine surfaces the rules
      // and traces driving learning, and Learning Prompts shows the exact system prompts used
      // by the LLM reviewers that feed the learning store.
      children: [
        { href: "/admin/engine", label: "Decision Engine", key: "engine" },
        { href: "/admin/learning-prompts", label: "Learning Prompts", key: "learning-prompts" },
      ],
    },
    { href: "/admin/flow-engine", label: "Flow Engine", key: "flow-engine" },
    { href: "/admin/prompt-labs", label: "Prompt labs", key: "prompt-labs" },
    { href: "/admin/carousel-templates", label: "Carousel templates", key: "carousel-templates" },
  ];

  const LEARNING_CHILD_KEYS = new Set(["engine", "learning-prompts"]);
  const isParentActive = (link: GlobalLink): boolean => {
    if (link.key === active) return true;
    if (link.key === "global-learning" && LEARNING_CHILD_KEYS.has(active)) return true;
    return false;
  };
  const renderGlobalLink = (link: GlobalLink): string => {
    const activeCls = isParentActive(link) ? " active" : "";
    let out = `<a href="${link.href}" class="sb-link${activeCls}">${link.label}</a>`;
    if (link.children && link.children.length > 0) {
      out += link.children
        .map(
          (c) =>
            `<a href="${c.href}" class="sb-link sb-sublink${c.key === active ? " active" : ""}">${c.label}</a>`
        )
        .join("\n    ");
    }
    return out;
  };

  return `<aside class="sb">
  <div class="sb-brand"><h1>CAF Core</h1><span>Admin Dashboard</span></div>
  <div class="sb-project-sel">
    <label>Active project</label>
    <select id="project-sel" name="project" aria-label="Active project">${projectOptions}</select>
  </div>
  <a href="/admin/new-project" class="sb-new-project">+ New Project</a>
  <nav class="sb-nav">
    <div class="sb-title">Project</div>
    ${projectLinks.map(l => `<a href="${l.href}" class="sb-link${l.key === active ? " active" : ""}">${l.label}</a>`).join("\n    ")}
    <div class="sb-title" style="margin-top:16px">CAF Core</div>
    ${globalLinks.map(renderGlobalLink).join("\n    ")}
    <div class="sb-title" style="margin-top:auto;padding-top:24px">External</div>
    <a href="/" class="sb-link" target="_blank">API Root</a>
    <a href="/health" class="sb-link" target="_blank">Health</a>
    <a href="/health/rendering" class="sb-link" target="_blank">Rendering deps</a>
  </nav>
</aside>`;
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
window.cafSwitchProject=function(slug){
  var s=String(slug||"").replace(/[\\r\\n\\t\\v\\f\\u0085\\u2028\\u2029]+/g,"").trim();
  var url=new URL(window.location.href);
  if(s)url.searchParams.set("project",s);else url.searchParams.delete("project");
  window.location.assign(url.toString());
};
document.addEventListener("DOMContentLoaded",function(){
  var sel=document.getElementById("project-sel");
  if(!sel)return;
  sel.addEventListener("change",function(){
    window.cafSwitchProject(sel.value);
  });
});
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

  app.get("/v1/admin/projects", async (request) => {
    const query = request.query as Record<string, string>;
    const includeSystem = query.include_system === "1" || query.include_system === "true";
    const projects = await listProjects(db, { include_system: includeSystem });
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

  app.put("/v1/admin/projects", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const slug = cleanSlugLoose(body.slug != null ? String(body.slug) : undefined);
    if (slug === undefined) return reply.code(400).send({ ok: false, error: "Slug is required" });
    if (slug === "") return reply.code(400).send({ ok: false, error: "Slug is required" });

    const existing = await qOne<{ id: string; is_system: boolean }>(
      db,
      `SELECT id, COALESCE(is_system,false) AS is_system
       FROM caf_core.projects
       WHERE lower(regexp_replace(slug, '[\\r\\n\\t\\v\\f\\u0085\\u2028\\u2029]+', '', 'g')) = lower($1)
       LIMIT 1`,
      [slug]
    );
    if (!existing) return reply.code(404).send({ ok: false, error: "project_not_found" });
    if ((existing as any).is_system === true) {
      return reply.code(400).send({ ok: false, error: "cannot_update_system_project" });
    }

    const displayNameRaw = body.display_name != null ? String(body.display_name).trim() : "";
    const display_name = displayNameRaw === "" ? null : displayNameRaw;
    const active = body.active === true || body.active === "true" || body.active === "1";

    const colorRaw = body.color != null ? String(body.color).trim() : "";
    const color = colorRaw === "" ? null : colorRaw;
    if (color != null && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
      return reply.code(400).send({ ok: false, error: "Color must be a hex string like #RRGGBB" });
    }

    const rows = await q<{ id: string }>(
      db,
      `UPDATE caf_core.projects
       SET display_name = $2, active = $3, color = $4, updated_at = now()
       WHERE lower(regexp_replace(slug, '[\\r\\n\\t\\v\\f\\u0085\\u2028\\u2029]+', '', 'g')) = lower($1)
       RETURNING id`,
      [slug, display_name, active, color]
    );
    if (!rows[0]) return reply.code(404).send({ ok: false, error: "project_not_found" });
    return { ok: true };
  });

  app.delete("/v1/admin/projects", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const hasSlugParam = Object.prototype.hasOwnProperty.call(query, "slug");
    const slug = hasSlugParam ? cleanSlugLoose(query.slug) : undefined;
    const force = query.force === "true" || query.force === "1";
    if (slug === undefined) return reply.code(400).send({ ok: false, error: "slug required" });

    const proj = await qOne<ProjectRow>(
      db,
      `SELECT id, slug, display_name, active, color, is_system
       FROM caf_core.projects
       WHERE lower(regexp_replace(slug, '[\\r\\n\\t\\v\\f\\u0085\\u2028\\u2029]+', '', 'g')) = lower($1)
       LIMIT 1`,
      [slug]
    );
    if (!proj) return reply.code(404).send({ ok: false, error: "project_not_found" });
    if (proj.is_system) return reply.code(400).send({ ok: false, error: "cannot_delete_system_project" });

    if (!force) {
      const runs = await q<{ c: number | string }>(db, `SELECT count(*)::int AS c FROM caf_core.runs WHERE project_id = $1`, [proj.id]);
      const jobs = await q<{ c: number | string }>(db, `SELECT count(*)::int AS c FROM caf_core.content_jobs WHERE project_id = $1`, [proj.id]);
      const runCount = Number((runs[0] as any)?.c ?? 0);
      const jobCount = Number((jobs[0] as any)?.c ?? 0);
      if (runCount > 0 || jobCount > 0) {
        return reply.code(400).send({ ok: false, error: "project_not_empty" });
      }
    }

    await q(db, `DELETE FROM caf_core.projects WHERE id = $1`, [proj.id]);
    return { ok: true };
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

  /** Remove all jobs (and related rows) for a run id — works even if the `runs` row is already gone (orphan cleanup). */
  app.post("/v1/admin/jobs/delete-by-run", async (request, reply) => {
    const bodySchema = z.object({
      project: z.string().min(1),
      run_id: z.string().min(1),
    });
    const parsed = bodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const project = await resolveProject(db, parsed.data.project);
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });
    try {
      const content_jobs_deleted = await deleteAllJobsForRun(db, project.id, parsed.data.run_id);
      return { ok: true, run_id: parsed.data.run_id, content_jobs_deleted };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ ok: false, error: "delete_failed", message });
    }
  });

  /**
   * Delete every job that matches the same filters as GET /v1/admin/jobs (search, run, status, …).
   * Requires at least one filter so we never wipe the whole project by accident from an empty form.
   */
  app.post("/v1/admin/jobs/delete-matching-filters", async (request, reply) => {
    const bodySchema = z.object({
      project: z.string().min(1),
      status: z.string().optional(),
      platform: z.string().optional(),
      flow_type: z.string().optional(),
      run_id: z.string().optional(),
      search: z.string().optional(),
    });
    const parsed = bodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const b = parsed.data;
    const hasFilter = !!(
      b.status?.trim() ||
      b.platform?.trim() ||
      b.flow_type?.trim() ||
      b.run_id?.trim() ||
      b.search?.trim()
    );
    if (!hasFilter) {
      return reply.code(400).send({
        ok: false,
        error: "filters_required",
        message: "Set at least one filter (search, run id, status, platform, or flow) before erasing matching jobs.",
      });
    }
    const project = await resolveProject(db, b.project);
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });
    const filters = {
      status: b.status?.trim() || undefined,
      platform: b.platform?.trim() || undefined,
      flow_type: b.flow_type?.trim() || undefined,
      run_id: b.run_id?.trim() || undefined,
      search: b.search?.trim() || undefined,
    };
    try {
      const { task_ids, cap_hit } = await listTaskIdsMatchingJobFilters(db, project.id, filters);
      if (task_ids.length === 0) {
        return { ok: true, content_jobs_deleted: 0, cap_hit, matched: 0 };
      }
      let deleted = 0;
      const chunk = 400;
      for (let i = 0; i < task_ids.length; i += chunk) {
        const slice = task_ids.slice(i, i + chunk);
        deleted += await deleteContentJobsByTaskIds(db, project.id, slice);
      }
      return { ok: true, content_jobs_deleted: deleted, cap_hit, matched: task_ids.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ ok: false, error: "delete_failed", message });
    }
  });

  /** Delete one job and its drafts, audits, assets, etc. */
  app.post("/v1/admin/jobs/delete-one", async (request, reply) => {
    const bodySchema = z.object({
      project: z.string().min(1),
      task_id: z.string().min(1),
    });
    const parsed = bodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const project = await resolveProject(db, parsed.data.project);
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });
    const taskId = parsed.data.task_id.trim();
    const existing = await getContentJobByTaskId(db, project.id, taskId);
    if (!existing) return reply.code(404).send({ ok: false, error: "job_not_found" });
    try {
      const content_jobs_deleted = await deleteContentJobByTaskId(db, project.id, taskId);
      return { ok: true, task_id: taskId, content_jobs_deleted };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ ok: false, error: "delete_failed", message });
    }
  });

  /**
   * POST /v1/admin/jobs/reprocess-full
   * Clear generated output, QC, renders, assets, and machine audits for one task_id, set status PLANNED,
   * then run the full pipeline (same as Process for a single job).
   *
   * Returns **202 Accepted** immediately and runs the pipeline in the background so Fly/browser proxies
   * do not drop the connection while LLM + render run (often several minutes).
   */
  app.post("/v1/admin/jobs/reprocess-full", async (request, reply) => {
    const bodySchema = z.object({
      project: z.string().min(1),
      task_id: z.string().min(1),
    });
    const parsed = bodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const project = await resolveProject(db, parsed.data.project);
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });
    const taskId = parsed.data.task_id.trim();
    const existing = await getContentJobByTaskId(db, project.id, taskId);
    if (!existing) return reply.code(404).send({ ok: false, error: "job_not_found" });
    if (isOfflinePipelineFlow(String(existing.flow_type ?? ""))) {
      return reply.code(400).send({
        ok: false,
        error: "offline_flow_not_supported",
        message: "This flow is not run by the online pipeline; re-run is not applicable.",
      });
    }

    void reprocessJobFromScratch(db, config, project.id, taskId).catch((err) => {
      request.log.error({ err, taskId, projectId: project.id }, "reprocess-full background failed");
    });

    return reply.code(202).send({
      ok: true,
      accepted: true,
      task_id: taskId,
      message:
        "Re-run started in the background (LLM + QC + render can take several minutes). Keep this tab open or refresh the Jobs table to watch status.",
    });
  });

  /**
   * POST /v1/admin/jobs/resume
   * Resume a job without clearing payload/QC/assets.
   *
   * Practical use: jobs stuck in RENDERING due to upstream timeouts (e.g. Sora poll timeout).
   * This re-runs the normal per-task pipeline, which will continue from current state and
   * only render the missing parts.
   *
   * Returns **202 Accepted** immediately and runs in the background (can take minutes).
   */
  app.post("/v1/admin/jobs/resume", async (request, reply) => {
    const bodySchema = z.object({
      project: z.string().min(1),
      task_id: z.string().min(1),
    });
    const parsed = bodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const project = await resolveProject(db, parsed.data.project);
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });
    const taskId = parsed.data.task_id.trim();
    const existing = await getContentJobByTaskId(db, project.id, taskId);
    if (!existing) return reply.code(404).send({ ok: false, error: "job_not_found" });
    if (isOfflinePipelineFlow(String(existing.flow_type ?? ""))) {
      return reply.code(400).send({
        ok: false,
        error: "offline_flow_not_supported",
        message: "This flow is not run by the online pipeline; resume is not applicable.",
      });
    }

    void processJobByTaskId(db, config, project.id, taskId).catch((err) => {
      request.log.error({ err, taskId, projectId: project.id }, "resume job background failed");
    });

    return reply.code(202).send({
      ok: true,
      accepted: true,
      task_id: taskId,
      message:
        "Resume started in the background. Refresh the Jobs table to watch status (job should remain RENDERING until clips/mux complete).",
    });
  });

  /** Delete every job in the project. `confirm_slug` must equal the project slug (safety). */
  app.post("/v1/admin/jobs/delete-all", async (request, reply) => {
    const bodySchema = z.object({
      project: z.string().min(1),
      confirm_slug: z.string().min(1),
    });
    const parsed = bodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const project = await resolveProject(db, parsed.data.project);
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });
    if (parsed.data.confirm_slug.trim() !== project.slug) {
      return reply.code(400).send({ ok: false, error: "confirm_slug_mismatch", message: "Type the project slug exactly to confirm." });
    }
    try {
      const content_jobs_deleted = await deleteAllContentJobsForProject(db, project.id);
      return { ok: true, content_jobs_deleted };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ ok: false, error: "delete_failed", message });
    }
  });

  /**
   * POST /v1/admin/rework/pending
   * Rework every job with `content_jobs.status = 'NEEDS_EDIT'` (no filter on latest editorial row — avoids stale job rows skipped by the queue).
   *
   * Returns **202** and runs each rework **in the background** (sequential queue) so Fly/browser proxies do not
   * time out while LLM + carousel renders run (often several minutes per job).
   *
   * Full/partial modes reset the same `task_id`, append a new `job_drafts` row, and run LLM → QC → render.
   * Override-only merges `overrides_json` into `generated_output` on the same job (no regen).
   */
  app.post("/v1/admin/rework/pending", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const projectSlug = typeof body.project_slug === "string" ? body.project_slug : undefined;
    const limitRaw = typeof body.limit === "number" ? body.limit : undefined;
    const limit = Math.min(500, Math.max(1, Math.floor(limitRaw ?? 200)));

    const project = await resolveProject(db, projectSlug);
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });

    /** Any row with `status = NEEDS_EDIT` qualifies. Do not filter by latest editorial row — that row can be APPROVED/NULL while the job row is stale, which made batch rework queue 0 jobs. */
    const rows = await q<{ task_id: string }>(
      db,
      `
        SELECT j.task_id
        FROM caf_core.content_jobs j
        WHERE j.project_id = $1 AND j.status = 'NEEDS_EDIT'
        ORDER BY j.updated_at DESC
        LIMIT $2
      `,
      [project.id, limit]
    );

    const taskIds = rows.map((r) => String(r.task_id || "").trim()).filter(Boolean);
    const log = request.server.log;

    void (async () => {
      const delayMs = 2000;
      for (let i = 0; i < taskIds.length; i++) {
        const taskId = taskIds[i]!;
        if (i > 0 && delayMs > 0) {
          await new Promise<void>((r) => setTimeout(r, delayMs));
        }
        try {
          log.info({ taskId, index: i + 1, total: taskIds.length }, "rework/pending: starting job");
          const out = await executeRework(db, config, project.id, taskId);
          if (!out.ok) {
            log.warn({ taskId, error: out.error, mode: out.mode }, "rework/pending: job failed");
          } else {
            log.info({ taskId, mode: out.mode }, "rework/pending: job finished");
          }
        } catch (err) {
          log.error({ err, taskId }, "rework/pending: job threw");
        }
      }
      log.info({ total: taskIds.length }, "rework/pending: batch complete");
    })();

    return reply.code(202).send({
      ok: true,
      accepted: true,
      project_slug: project.slug,
      queued: taskIds.length,
      message:
        taskIds.length === 0
          ? "No qualifying NEEDS_EDIT jobs to rework (check latest editorial decision vs job status)."
          : `Queued ${taskIds.length} rework job(s) in the background (sequential). Refresh the Jobs table to watch status — LLM + render often take several minutes per task.`,
    });
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
    const qc_detail = qcDetailFromGenerationPayload(gp as Record<string, unknown>);
    const api_audit = await listApiCallAuditsForTask(db, project.id, taskId, 120);
    return {
      ok: true,
      job: detail.job,
      transitions: detail.transitions,
      drafts: detail.drafts,
      editorial_timeline: detail.editorial_timeline,
      content_preview,
      qc_detail,
      api_audit,
    };
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

  app.get("/v1/admin/signal-packs", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const project = await resolveProject(db, query.project);
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "80", 10)));
    const offset = Math.max(0, parseInt(query.offset ?? "0", 10));
    const rows = await listSignalPacks(db, project.id, limit, offset);
    return {
      ok: true,
      rows: rows.map((p) => ({
        id: p.id,
        run_id: p.run_id,
        source_window: p.source_window,
        upload_filename: p.upload_filename,
        notes: p.notes,
        created_at: p.created_at,
        candidate_count: Array.isArray(p.overall_candidates_json) ? p.overall_candidates_json.length : 0,
      })),
    };
  });

  const sceneAssemblyLabBodySchema = z
    .object({
      mode: z.enum(["new", "regenerate"]).default("new"),
      project_slug: z.string().min(1),
      signal_pack_id: z.string().uuid().optional(),
      task_id: z.string().min(1).optional(),
      platform: z.string().optional(),
      candidate_data: z.record(z.unknown()).optional(),
      variation_name: z.string().optional(),
      /** When true (default), after successful LLM generation run QC + scene-pipeline (clips, voice, subtitles, mux). */
      start_pipeline: z.boolean().optional().default(true),
    })
    .superRefine((b, ctx) => {
      if (b.mode === "regenerate") {
        if (!b.task_id?.trim()) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "task_id required when mode=regenerate" });
        }
      } else if (!b.signal_pack_id?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "signal_pack_id required when mode=new" });
      }
    });

  /** Scene assembly lab: LLM script prep + scene bundle; by default then QC + full scene-pipeline (see start_pipeline). */
  app.post("/v1/admin/scene-assembly-lab", async (request, reply) => {
    const parsed = sceneAssemblyLabBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const b = parsed.data;
    const project = await getProjectBySlug(db, b.project_slug.trim().toUpperCase());
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });

    const startPipeline = b.start_pipeline !== false;

    if (b.mode === "regenerate") {
      const out = await runSceneAssemblyLabRegenerate(db, config, {
        projectId: project.id,
        taskId: b.task_id!.trim(),
        startPipeline,
        candidateData: b.candidate_data,
      });
      if (!out.ok) return reply.code(400).send(out);
      const okOut = out as unknown as {
        ok: true;
        mode?: string;
        run_id?: string;
        run_uuid?: string;
        task_id: string;
        job_id?: string;
        generation?: unknown;
      };
      let pipeline: { ran: boolean; ok?: boolean; job_status?: string; skipped?: boolean; error?: string } = {
        ran: false,
      };
      if (startPipeline) {
        pipeline = { ran: true };
        try {
          const pr = await processJobByTaskId(db, config, project.id, okOut.task_id);
          pipeline.ok = true;
          pipeline.job_status = pr.status;
          if (pr.skipped) pipeline.skipped = true;
          if (okOut.run_uuid) {
            const runState = pr.status === "FAILED" ? "FAILED" : "REVIEWING";
            await updateRunStatus(db, okOut.run_uuid, runState, {
              completed_at: new Date().toISOString(),
              jobs_completed: pr.status === "FAILED" ? 0 : 1,
              total_jobs: 1,
            });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          pipeline.ok = false;
          pipeline.error = msg;
          if (okOut.run_uuid) {
            await updateRunStatus(db, okOut.run_uuid, "FAILED", {
              completed_at: new Date().toISOString(),
              jobs_completed: 0,
              total_jobs: 1,
            });
          }
        }
      }
      return {
        ok: true,
        mode: okOut.mode,
        run_id: okOut.run_id,
        run_uuid: okOut.run_uuid,
        task_id: okOut.task_id,
        job_id: okOut.job_id,
        generation: okOut.generation,
        start_pipeline: startPipeline,
        pipeline,
      };
    }

    const out = await runSceneAssemblyLabNew(db, config, {
      projectId: project.id,
      signalPackId: b.signal_pack_id!.trim(),
      platform: b.platform,
      candidateData: b.candidate_data,
      variationName: b.variation_name,
      startPipeline,
    });
    if (!out.ok) return reply.code(400).send(out);
    const okOut = out as unknown as {
      ok: true;
      mode?: string;
      run_id?: string;
      run_uuid?: string;
      task_id: string;
      job_id?: string;
      generation?: unknown;
    };
    let pipeline: { ran: boolean; ok?: boolean; job_status?: string; skipped?: boolean; error?: string } = {
      ran: false,
    };
    if (startPipeline) {
      pipeline = { ran: true };
      try {
        const pr = await processJobByTaskId(db, config, project.id, okOut.task_id);
        pipeline.ok = true;
        pipeline.job_status = pr.status;
        if (pr.skipped) pipeline.skipped = true;
        if (okOut.run_uuid) {
          const runState = pr.status === "FAILED" ? "FAILED" : "REVIEWING";
          await updateRunStatus(db, okOut.run_uuid, runState, {
            completed_at: new Date().toISOString(),
            jobs_completed: pr.status === "FAILED" ? 0 : 1,
            total_jobs: 1,
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        pipeline.ok = false;
        pipeline.error = msg;
        if (okOut.run_uuid) {
          await updateRunStatus(db, okOut.run_uuid, "FAILED", {
            completed_at: new Date().toISOString(),
            jobs_completed: 0,
            total_jobs: 1,
          });
        }
      }
    }
    return {
      ok: true,
      mode: okOut.mode,
      run_id: okOut.run_id,
      run_uuid: okOut.run_uuid,
      task_id: okOut.task_id,
      job_id: okOut.job_id,
      generation: okOut.generation,
      start_pipeline: startPipeline,
      pipeline,
    };
  });

  const sceneAssemblyMergeStorageBodySchema = z.object({
    project_slug: z.string().min(1),
    task_id: z.string().min(1),
    /** auto: LLM expand when word count looks short for scene count; always / never override */
    expand_voiceover: z.enum(["auto", "always", "never"]).optional(),
  });

  /**
   * Use MP4s already in Supabase under scenes/{run}/{task}/ (e.g. sora_scene_0.mp4): concat → voiceover → mux.
   * Does not call Sora; updates job scene URLs from storage then runs the same scene-pipeline tail as Process.
   */
  app.post("/v1/admin/scene-assembly-merge-from-storage", async (request, reply) => {
    const parsed = sceneAssemblyMergeStorageBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const b = parsed.data;
    const project = await getProjectBySlug(db, b.project_slug.trim().toUpperCase());
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });
    const result = await runSceneAssemblyMergeClipsFromStorage(db, config, project.id, b.task_id.trim(), {
      expand_voiceover: b.expand_voiceover,
    });
    if (!result.ok) {
      return reply.code(400).send(result);
    }
    return result;
  });

  const sceneAssemblyResumePipelineBodySchema = z.object({
    project_slug: z.string().min(1),
    task_id: z.string().min(1),
  });

  /**
   * Re-run scene concat → TTS → mux from URLs already on `generation_payload.generated_output.scene_bundle.scenes[]`.
   * Does **not** call Sora/HeyGen when every scene has `rendered_scene_url` / `video_url` (same tail as Process after clips exist).
   */
  app.post("/v1/admin/scene-assembly-resume-pipeline", async (request, reply) => {
    const parsed = sceneAssemblyResumePipelineBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const b = parsed.data;
    const project = await getProjectBySlug(db, b.project_slug.trim().toUpperCase());
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });
    const result = await runSceneAssemblyResumePipelineFromJobPayload(db, config, project.id, b.task_id.trim());
    if (!result.ok) {
      return reply.code(400).send(result);
    }
    return result;
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
        prompt_versions_snapshot: run.prompt_versions_snapshot ?? {},
      },
      notes: {
        stored_signal_pack:
          "Rows below are exactly what is in Postgres (upload). Scene-router may add seeds only in memory at Start — see newest planning trace + api_audits step llm_scene_assembly_candidate_router.",
        planner:
          "Each planning trace 'candidates' list is signal-pack rows × enabled flow types (after router), with outcome planned/dropped/unknown.",
        jobs:
          "Per-job LLM prompts and renders: open Jobs, expand a task row → Content preview + API & LLM audit.",
        prompt_versions_snapshot:
          "run.prompt_versions_snapshot records which caf_core.prompt_versions row was selected per flow_type when jobs were planned (decision engine or scene lab). Join prompt_version_id for experiments / learning.",
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

  /** Per-job carousel/video pipeline outcomes (slide counts, copy/script preview, errors) for a run. */
  app.get("/v1/admin/runs/content-outcomes", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const runIdText = query.run_id?.trim();
    if (!runIdText) return reply.code(400).send({ ok: false, error: "run_id required" });
    const project = await resolveProject(db, query.project);
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });
    const limit = Math.min(500, Math.max(1, parseInt(query.limit ?? "300", 10)));
    const outcomes = await listRunContentOutcomes(db, project.id, runIdText, limit);
    return { ok: true, outcomes };
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
      instagram_handle: str("instagram_handle"),
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

  app.post("/v1/admin/config/product", async (request) => {
    const b = request.body as Record<string, unknown>;
    const slug = normalizeProjectSlugParam(String(b._project ?? ""));
    const project = slug ? await ensureProject(db, slug) : await resolveProject(db, undefined);
    if (!project) return { ok: false, error: "Project not found" };
    const str = (k: string) => (b[k] != null && String(b[k]).trim() !== "") ? String(b[k]) : null;
    await upsertProductProfile(db, project.id, {
      product_name: str("product_name"),
      product_category: str("product_category"),
      product_url: str("product_url"),
      one_liner: str("one_liner"),
      value_proposition: str("value_proposition"),
      elevator_pitch: str("elevator_pitch"),
      primary_audience: str("primary_audience"),
      audience_pain_points: str("audience_pain_points"),
      audience_desires: str("audience_desires"),
      use_cases: str("use_cases"),
      anti_audience: str("anti_audience"),
      key_features: str("key_features"),
      key_benefits: str("key_benefits"),
      differentiators: str("differentiators"),
      proof_points: str("proof_points"),
      social_proof: str("social_proof"),
      competitors: str("competitors"),
      comparison_angles: str("comparison_angles"),
      pricing_summary: str("pricing_summary"),
      current_offer: str("current_offer"),
      offer_urgency: str("offer_urgency"),
      guarantee: str("guarantee"),
      primary_cta: str("primary_cta"),
      secondary_cta: str("secondary_cta"),
      do_say: str("do_say"),
      dont_say: str("dont_say"),
      taglines: str("taglines"),
      keywords: str("keywords"),
      metadata_json: {},
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
    return { ok: true, risk_qc: riskRulesNotEnforcedNotice() };
  });

  app.post("/v1/admin/config/risk-rule/delete", async (request) => {
    const b = request.body as Record<string, unknown>;
    if (!b.id) return { ok: false, error: "id is required" };
    await deleteRiskRule(db, String(b.id));
    return { ok: true, risk_qc: riskRulesNotEnforcedNotice() };
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
    const heygenModeIn = typeof b.heygen_mode === "string" ? b.heygen_mode.trim().toLowerCase() : "";
    const heygenMode =
      heygenModeIn === "script_led" || heygenModeIn === "prompt_led"
        ? (heygenModeIn as "script_led" | "prompt_led")
        : null;
    await upsertAllowedFlowType(db, project.id, {
      flow_type: String(b.flow_type), enabled: bool("enabled"),
      default_variation_count: Number(b.default_variation_count ?? 1),
      requires_signal_pack: bool("requires_signal_pack"), requires_learning_context: bool("requires_learning_context"),
      allowed_platforms: str("allowed_platforms"), output_schema_version: str("output_schema_version"),
      qc_checklist_version: str("qc_checklist_version"), prompt_template_id: str("prompt_template_id"),
      priority_weight: num("priority_weight"), notes: str("notes"),
      heygen_mode: heygenMode,
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

  app.post("/v1/admin/config/project-carousel-template", async (request, reply) => {
    try {
      const b = (request.body ?? {}) as Record<string, unknown>;
      const slug = normalizeProjectSlugParam(String(b._project ?? ""));
      if (!slug) return reply.code(400).send({ ok: false, error: "Project slug required" });
      const htmlName = String(b.html_template_name ?? "").trim();
      if (!htmlName || !isSafeCarouselHbsFilename(htmlName)) {
        return reply.code(400).send({ ok: false, error: "Invalid html_template_name" });
      }
      const project = await resolveProject(db, slug);
      if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });
      await addProjectCarouselTemplate(db, project.id, htmlName);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      request.log.warn({ err: e }, "project-carousel-template");
      return reply.code(500).send({ ok: false, error: msg });
    }
  });

  app.post("/v1/admin/config/project-carousel-template/delete", async (request, reply) => {
    const b = request.body as Record<string, unknown>;
    const slug = normalizeProjectSlugParam(String(b._project ?? ""));
    if (!slug) return reply.code(400).send({ ok: false, error: "Project slug required" });
    const htmlName = String(b.html_template_name ?? "").trim();
    if (!htmlName || !isSafeCarouselHbsFilename(htmlName)) {
      return reply.code(400).send({ ok: false, error: "Invalid html_template_name" });
    }
    const project = await resolveProject(db, slug);
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });
    await removeProjectCarouselTemplate(db, project.id, htmlName);
    return { ok: true };
  });

  /** Replace the full set of pinned carousel `.hbs` files for a project (Project Config checklist). */
  app.post("/v1/admin/config/project-carousel-templates", async (request, reply) => {
    try {
      const b = (request.body ?? {}) as Record<string, unknown>;
      const slug = normalizeProjectSlugParam(String(b._project ?? ""));
      if (!slug) return reply.code(400).send({ ok: false, error: "Project slug required" });
      const raw = b.html_template_names;
      const names = Array.isArray(raw)
        ? raw.map((x) => String(x ?? "").trim()).filter((s) => s.length > 0)
        : [];
      for (const n of names) {
        if (!isSafeCarouselHbsFilename(n)) {
          return reply.code(400).send({ ok: false, error: `Invalid template name: ${n}` });
        }
      }
      const project = await resolveProject(db, slug);
      if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });
      await setProjectCarouselTemplates(db, project.id, names);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      request.log.warn({ err: e }, "project-carousel-templates");
      return reply.code(500).send({ ok: false, error: msg });
    }
  });

  // --- Flow Engine CRUD (global) ---
  app.get("/v1/admin/flow-engine", async () => {
    const [flowDefs, promptTpls, schemas, carouselTpls, qcChecks, riskPolicies] = await Promise.all([
      listFlowDefinitions(db), listPromptTemplates(db), listOutputSchemas(db),
      listCarouselTemplates(db), listQcChecks(db), listRiskPolicies(db),
    ]);
    return { ok: true, flow_definitions: flowDefs, prompt_templates: promptTpls, output_schemas: schemas, carousel_templates: carouselTpls, qc_checklists: qcChecks, risk_policies: riskPolicies };
  });

  /** Prompt / script / HeyGen assembly reference for operators (templates + runtime addenda). */
  app.get("/v1/admin/prompt-labs", async () => {
    const [promptTemplates, flowDefs, carouselTpls] = await Promise.all([
      listPromptTemplates(db),
      listFlowDefinitions(db),
      listCarouselTemplates(db),
    ]);
    const cfg = config;
    const flow_description_by_type: Record<string, string> = {};
    for (const f of flowDefs) {
      if (f.flow_type) flow_description_by_type[f.flow_type] = (f.description ?? "").trim();
    }
    const prompt_templates_enriched = promptTemplates.map((p) => {
      const flowDesc = flow_description_by_type[p.flow_type] ?? "";
      const roleHint = promptTemplateRoleHint(p.prompt_role, p.prompt_name);
      const notes = (p.notes ?? "").trim();
      return {
        ...p,
        labs_flow_description: flowDesc,
        labs_role_hint: roleHint,
        labs_short_description: notes || roleHint || flowDesc || "Add a description in the Notes field (editable below).",
        labs_is_heygen: isHeygenFlowType(p.flow_type),
      };
    });
    return {
      ok: true,
      env_tuning: {
        VIDEO_TARGET_DURATION_MIN_SEC: cfg.VIDEO_TARGET_DURATION_MIN_SEC,
        VIDEO_TARGET_DURATION_MAX_SEC: cfg.VIDEO_TARGET_DURATION_MAX_SEC,
        HEYGEN_ENFORCE_SPOKEN_SCRIPT_WORD_BOUNDS: cfg.HEYGEN_ENFORCE_SPOKEN_SCRIPT_WORD_BOUNDS,
        SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MIN: cfg.SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MIN,
        SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MAX: cfg.SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MAX,
        SCENE_ASSEMBLY_CLIP_DURATION_SEC: cfg.SCENE_ASSEMBLY_CLIP_DURATION_SEC,
      },
      env_hints: PROMPT_LABS_ENV_HINTS,
      core_layer_meta: PROMPT_LABS_CORE_LAYER_META,
      core_addenda: {
        publication_system_addendum: PUBLICATION_SYSTEM_ADDENDUM,
        video_script_system_suffix: withVideoScriptDurationPolicy("", cfg).trim(),
        video_prompt_system_suffix: withVideoPromptDurationPolicy("", cfg).trim(),
        scene_assembly_system_suffix: withSceneAssemblyPolicy("", cfg).trim(),
        user_footer_script_json: appendVideoUserPromptDurationHardFooter(
          "(Flow Engine user_prompt_template appears above this line in the real request.)",
          cfg,
          "script_json"
        ),
        user_footer_video_plan: appendVideoUserPromptDurationHardFooter(
          "(Flow Engine user_prompt_template appears above this line in the real request.)",
          cfg,
          "video_plan"
        ),
      },
      heygen_video_agent: {
        intro: PROMPT_LABS_HEYGEN_INTRO,
        rubric_lines: [...HEYGEN_VIDEO_AGENT_RUBRIC_LINES],
        note:
          "POST /v3/video-agents: prompt text is rubric lines plus hook, spoken_script, video_prompt, structured fields, CTA/caption/hashtags. Script-led avatar jobs use POST /v3/videos (type avatar) — no duration field; CAF enforces min/max spoken word counts from VIDEO_TARGET_* × SCENE_VO_WORDS_PER_MINUTE when HEYGEN_ENFORCE_SPOKEN_SCRIPT_WORD_BOUNDS is true. Silence-voice visual-only jobs still use legacy POST /v2/video/generate (see heygen-renderer).",
      },
      prompt_templates: prompt_templates_enriched,
      flow_definitions: flowDefs,
      flow_description_by_type,
      heygen_flow_types: [...HEYGEN_FLOW_TYPES],
      carousel_templates: carouselTpls,
    };
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
      applies_to_flow_type: str("applies_to_flow_type"),
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

  // ── Carousel template previews (proxied to the Puppeteer renderer) ─────────
  // UI flow: GET source shows the `.hbs` Handlebars text; POST preview pipes a
  // small sample payload through `/preview-template` so the admin sees the
  // actual rendered slide 1 as a PNG streamed back from the renderer.
  /** Snappy timeout for non-render proxy calls (template list / template source) — a dead renderer must not hang the admin page. */
  const carouselAdminRendererFetchMs = 10_000;
  /**
   * Longer timeout for actual slide renders. The renderer queues Puppeteer renders serially,
   * so during a cold-start (first visit after deploy) a request that lands deep in the queue
   * can wait several seconds behind older renders. 60s comfortably covers ~19 templates × 3 slides
   * even with the Puppeteer browser warming up.
   */
  const carouselAdminRenderFetchMs = 60_000;
  app.get<{ Querystring: { name?: string } }>("/v1/admin/carousel-template-source", async (request, reply) => {
    const name = String(request.query?.name ?? "").trim();
    if (!name || !/^[a-zA-Z0-9_-]+\.hbs$/.test(name.endsWith(".hbs") ? name : `${name}.hbs`)) {
      return reply.code(400).send({ ok: false, error: "invalid_template_name" });
    }
    const base = (config.RENDERER_BASE_URL || "").replace(/\/$/, "");
    const safe = name.endsWith(".hbs") ? name : `${name}.hbs`;
    try {
      const res = await fetch(`${base}/templates/source/${encodeURIComponent(safe)}`, {
        signal: AbortSignal.timeout(carouselAdminRendererFetchMs),
      });
      if (!res.ok) return reply.code(res.status).send({ ok: false, error: "renderer_status_" + res.status });
      const data = (await res.json().catch(() => null)) as { name?: string; source?: string } | null;
      if (!data?.source) return reply.code(502).send({ ok: false, error: "renderer_no_source" });
      return { ok: true, name: data.name ?? safe, source: data.source };
    } catch (err) {
      return reply.code(502).send({ ok: false, error: err instanceof Error ? err.message : "proxy_failed" });
    }
  });

  app.get("/v1/admin/carousel-template-list", async (_request, reply) => {
    const base = (config.RENDERER_BASE_URL || "").replace(/\/$/, "");
    try {
      const res = await fetch(`${base}/templates`, { signal: AbortSignal.timeout(carouselAdminRendererFetchMs) });
      if (!res.ok) return reply.code(res.status).send({ ok: false, error: "renderer_status_" + res.status });
      const data = (await res.json().catch(() => null)) as { templates?: string[] } | null;
      return { ok: true, templates: Array.isArray(data?.templates) ? data!.templates : [] };
    } catch (err) {
      return reply.code(502).send({ ok: false, error: err instanceof Error ? err.message : "proxy_failed" });
    }
  });

  // Sample data used when the admin hits "Preview" without providing custom JSON.
  // Works with default.hbs and the SNS-style carousels that expect `cover_slide`,
  // `body_slides`, and `cta_slide` (or their `cover` / `cta_text` aliases).
  const CAROUSEL_PREVIEW_SAMPLE_DATA = {
    cover: "Preview slide — carousel template",
    cover_slide: {
      headline: "Preview slide",
      body: "This is a sample cover generated by Prompt labs so you can see how the template looks before shipping.",
    },
    body_slides: [
      {
        headline: "Body slide 1",
        body: "Replace we/our with you/your. Short, sharp lines that earn the next tap.",
      },
      {
        headline: "Body slide 2",
        body: "Second body slide. Keep the rhythm tight; one idea per slide.",
      },
    ],
    cta_slide: { body: "Save this for later", handle: "@cafcore" },
    cta_text: "Save this for later",
    cta_handle: "@cafcore",
    title: "Preview slide — carousel template",
    items: [
      { title: "Body slide 1", body: "Replace we/our with you/your." },
      { title: "Body slide 2", body: "Keep the rhythm tight." },
    ],
  } as const;

  /**
   * Proxy a single preview slide image from the carousel renderer.
   * Shared by both POST (custom data) and GET (admin UI, browser-cacheable) handlers.
   */
  async function proxyCarouselPreview(opts: {
    template: string;
    slideIndex: number;
    data?: Record<string, unknown>;
    force: boolean;
  }): Promise<
    | { ok: true; buffer: Buffer; cached: boolean }
    | { ok: false; status: number; error: string }
  > {
    const base = (config.RENDERER_BASE_URL || "").replace(/\/$/, "");
    const data = opts.data ?? CAROUSEL_PREVIEW_SAMPLE_DATA;
    const url = `${base}/preview-template${opts.force ? "?force=1" : ""}`;
    try {
      const rendererRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: opts.template, slide_index: opts.slideIndex, data }),
        signal: AbortSignal.timeout(carouselAdminRenderFetchMs),
      });
      const rendererJson = (await rendererRes.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        result_url?: string;
        resultUrl?: string;
        cached?: boolean;
      };
      const resultUrl = rendererJson.result_url ?? rendererJson.resultUrl;
      if (!rendererRes.ok || !rendererJson.ok || !resultUrl) {
        return {
          ok: false,
          status: rendererRes.ok ? 502 : rendererRes.status,
          error: rendererJson.error || "renderer_no_result_url",
        };
      }
      const imgUrl = resultUrl.startsWith("http") ? resultUrl : `${base}${resultUrl}`;
      const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(carouselAdminRenderFetchMs) });
      if (!imgRes.ok) return { ok: false, status: 502, error: "renderer_image_fetch_failed" };
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      return { ok: true, buffer, cached: rendererJson.cached === true };
    } catch (err) {
      return { ok: false, status: 502, error: err instanceof Error ? err.message : "proxy_failed" };
    }
  }

  function normalizeSlideIndex(raw: unknown): number {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
  }

  app.post<{ Body: { template?: string; slide_index?: number; data?: unknown; force?: boolean } }>(
    "/v1/admin/carousel-template-preview",
    async (request, reply) => {
      const body = request.body ?? {};
      const template = String(body.template ?? "").trim();
      if (!template) return reply.code(400).send({ ok: false, error: "template_required" });
      const slideIndex = normalizeSlideIndex(body.slide_index);
      const customData =
        body.data && typeof body.data === "object" && !Array.isArray(body.data)
          ? (body.data as Record<string, unknown>)
          : undefined;
      const force = body.force === true || customData != null;
      const result = await proxyCarouselPreview({ template, slideIndex, data: customData, force });
      if (!result.ok) return reply.code(result.status).send({ ok: false, error: result.error });
      reply.header("Content-Type", "image/png").header("Cache-Control", "no-store");
      return reply.send(result.buffer);
    }
  );

  /**
   * GET twin used by the admin Carousel Templates page: cacheable URL the browser can store.
   * Pair with the renderer's deterministic `__previews__/<template>/<NNN>_slide.png` path so
   * repeat visits hit the browser HTTP cache (or, on a cold browser, the renderer disk cache).
   * `?force=1` bypasses both the renderer disk cache AND the browser cache (`Cache-Control: no-store`).
   */
  app.get<{ Querystring: { template?: string; slide_index?: string; force?: string; v?: string } }>(
    "/v1/admin/carousel-template-preview",
    async (request, reply) => {
      const q = request.query ?? {};
      const template = String(q.template ?? "").trim();
      if (!template) return reply.code(400).send({ ok: false, error: "template_required" });
      const slideIndex = normalizeSlideIndex(q.slide_index);
      const force = q.force === "1" || q.force === "true";
      const result = await proxyCarouselPreview({ template, slideIndex, force });
      if (!result.ok) return reply.code(result.status).send({ ok: false, error: result.error });
      reply.header("Content-Type", "image/png");
      // Force-refresh path: never cache so the user sees the freshly rendered tile.
      // Otherwise: long-lived browser cache; the `v=` query param is the bust knob.
      reply.header(
        "Cache-Control",
        force ? "no-store" : "public, max-age=86400, immutable",
      );
      return reply.send(result.buffer);
    },
  );

  // ── HTML pages ──────────────────────────────────────────────────────

  // --- New Project ---
  app.get("/admin/new-project", async (_, reply) => {
    const projects = await listProjects(db);
    // Non-system projects only, for the "clone from" dropdown.
    const cloneableProjects = projects
      .filter((p: any) => !p.is_system)
      .map((p: any) => ({ slug: p.slug, display_name: p.display_name || p.slug }));
    const cloneOptions = cloneableProjects
      .map((p) => `<option value="${esc(p.slug)}">${esc(p.display_name)} (${esc(p.slug)})</option>`)
      .join("");

    const body = `
<div class="ph"><div><h2>Create New Project</h2><span class="ph-sub">Three ways: from scratch, clone an existing project, or import a CSV</span></div></div>
<div class="content">

  <!-- 1. Create blank project ──────────────────────────────────── -->
  <div class="card">
    <div class="card-h">Option 1 — Create a blank project</div>
    <p style="color:var(--muted);font-size:13px;margin:-6px 0 14px">
      Creates an empty shell. You fill in strategy / brand / product / platforms afterwards.
    </p>
    <form id="new-project-form" class="config-form">
      <div class="form-group"><label for="np-slug">Project Slug (uppercase, 2-30 chars, e.g. SNS, BRAND_X)</label><input type="text" id="np-slug" name="slug" required pattern="[A-Za-z0-9_]{2,30}" placeholder="MY_PROJECT" style="text-transform:uppercase"></div>
      <div class="form-group"><label for="np-name">Display Name</label><input type="text" id="np-name" name="display_name" placeholder="My Project"></div>
      <div class="form-actions"><button type="submit" class="btn">Create Project</button><span id="np-msg" class="form-msg"></span></div>
    </form>
  </div>

  <!-- 2. Clone from existing ───────────────────────────────────── -->
  <div class="card">
    <div class="card-h">Option 2 — Clone an existing project</div>
    <p style="color:var(--muted);font-size:13px;margin:-6px 0 14px">
      Copies every configured value (strategy, brand, product, platform constraints, flow types,
      risk rules, reference posts, HeyGen defaults) from the source project. Integration secrets
      (<code>account_ids_json</code>, <code>credentials_json</code>) are replaced with
      <code>REPLACE_ME</code> placeholders — edit them after cloning.
    </p>
    <form id="clone-form" class="config-form">
      <div class="form-group">
        <label for="cl-source">Source project</label>
        <select id="cl-source" required>${cloneOptions || '<option value="">(no projects to clone yet)</option>'}</select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label for="cl-slug">New slug *</label><input type="text" id="cl-slug" required pattern="[A-Za-z0-9_]{2,30}" placeholder="NEW_PROJECT" style="text-transform:uppercase"></div>
        <div class="form-group"><label for="cl-name">New display name *</label><input type="text" id="cl-name" required placeholder="New Project"></div>
      </div>
      <details style="margin:6px 0 14px"><summary style="cursor:pointer;color:var(--fg2);font-size:13px">Optional identity overrides (product name, URL, Instagram handle, colour)</summary>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px">
          <div class="form-group"><label for="cl-pname">Product name</label><input type="text" id="cl-pname" placeholder="(defaults to new display name)"></div>
          <div class="form-group"><label for="cl-purl">Product URL</label><input type="url" id="cl-purl" placeholder="https://example.com"></div>
          <div class="form-group"><label for="cl-ig">Instagram handle</label><input type="text" id="cl-ig" placeholder="@your_handle"></div>
          <div class="form-group"><label for="cl-color">Colour (hex)</label><input type="text" id="cl-color" pattern="#[0-9A-Fa-f]{6}" placeholder="#1a73e8"></div>
        </div>
      </details>
      <div class="form-actions">
        <button type="button" id="cl-download" class="btn-ghost btn">Download CSV only</button>
        <button type="submit" class="btn">Clone &amp; create now</button>
        <span id="cl-msg" class="form-msg"></span>
      </div>
    </form>
  </div>

  <!-- 3. Import CSV ────────────────────────────────────────────── -->
  <div class="card">
    <div class="card-h">Option 3 — Import from CSV</div>
    <p style="color:var(--muted);font-size:13px;margin:-6px 0 14px">
      Upload a key-value CSV (<code>section,row_key,field,value</code>). Fields not in the CSV
      are preserved on existing projects; missing singleton sections are created for new ones.
      <a href="#" id="dl-blank">Download a blank template</a>.
    </p>
    <form id="import-form" class="config-form">
      <div class="form-group">
        <label for="imp-file">CSV file</label>
        <input type="file" id="imp-file" accept=".csv,text/csv" required>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label for="imp-slug">Slug override (optional — overrides <code>project,,slug,</code> row)</label><input type="text" id="imp-slug" pattern="[A-Za-z0-9_]{2,30}" placeholder="leave blank to use the CSV" style="text-transform:uppercase"></div>
        <div class="form-group"><label for="imp-name">Display name override (optional)</label><input type="text" id="imp-name" placeholder="leave blank to use the CSV"></div>
      </div>
      <div class="form-actions">
        <button type="button" id="imp-dry" class="btn-ghost btn">Dry-run preview</button>
        <button type="submit" class="btn">Import</button>
        <span id="imp-msg" class="form-msg"></span>
      </div>
      <pre id="imp-result" style="display:none;margin-top:12px;padding:12px;background:var(--card2,#111);border:1px solid var(--border);border-radius:8px;font-size:12px;max-height:260px;overflow:auto;white-space:pre-wrap"></pre>
    </form>
  </div>

</div>

<script>
// ── helpers ───────────────────────────────────────────────────────────
function setMsg(el, text, kind){
  el.textContent = text || '';
  el.style.color = kind==='err' ? 'var(--red)' : (kind==='ok' ? 'var(--green,#16a34a)' : 'var(--accent)');
}
async function downloadBlob(url, fallbackName){
  const r = await cafFetch(url);
  if (!r.ok) {
    const txt = await r.text().catch(()=>String(r.status));
    throw new Error('HTTP '+r.status+': '+txt.slice(0,200));
  }
  const disp = r.headers.get('content-disposition') || '';
  const m = /filename="?([^";]+)"?/i.exec(disp);
  const name = (m && m[1]) || fallbackName;
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();}, 500);
}

// ── 1. blank project ──────────────────────────────────────────────────
document.getElementById('new-project-form').addEventListener('submit',async(e)=>{
  e.preventDefault();
  const msg=document.getElementById('np-msg');
  const slug=document.getElementById('np-slug').value.trim().toUpperCase();
  const display_name=document.getElementById('np-name').value.trim()||slug;
  if(!slug){setMsg(msg,'Slug required','err');return;}
  setMsg(msg,'Creating…');
  try{
    const r=await cafFetch('/v1/admin/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug,display_name})});
    const d=await r.json();
    if(d.ok){window.location.href='/admin/config?project='+encodeURIComponent(d.project.slug);}
    else{setMsg(msg,d.error||'Failed','err');}
  }catch(err){setMsg(msg,'Error: '+err.message,'err');}
});

// ── 2. clone from existing ────────────────────────────────────────────
function buildExportUrl(){
  const src=document.getElementById('cl-source').value.trim();
  if(!src) throw new Error('Pick a source project');
  const newSlug=document.getElementById('cl-slug').value.trim().toUpperCase();
  const newName=document.getElementById('cl-name').value.trim();
  if(!newSlug) throw new Error('New slug is required');
  if(!newName) throw new Error('New display name is required');
  const params=new URLSearchParams();
  params.set('new_slug', newSlug);
  params.set('new_display_name', newName);
  const pname=document.getElementById('cl-pname').value.trim();
  const purl=document.getElementById('cl-purl').value.trim();
  const ig=document.getElementById('cl-ig').value.trim();
  const color=document.getElementById('cl-color').value.trim();
  if (pname) params.set('new_product_name', pname);
  if (purl) params.set('new_product_url', purl);
  if (ig) params.set('new_instagram_handle', ig);
  if (color) params.set('new_color', color);
  return { src, url: '/v1/projects/'+encodeURIComponent(src)+'/export-csv?'+params.toString(), newSlug, newName };
}

document.getElementById('cl-download').addEventListener('click', async () => {
  const msg=document.getElementById('cl-msg');
  try{
    const { url, newSlug } = buildExportUrl();
    setMsg(msg,'Preparing CSV…');
    await downloadBlob(url, 'caf-project-'+newSlug.toLowerCase()+'.csv');
    setMsg(msg,'CSV downloaded — edit if needed, then upload it in Option 3.','ok');
  }catch(err){setMsg(msg,'Error: '+err.message,'err');}
});

document.getElementById('clone-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg=document.getElementById('cl-msg');
  try{
    const { url, newSlug, newName } = buildExportUrl();
    setMsg(msg,'Fetching source config…');
    const r1 = await cafFetch(url+'&format=json');
    const d1 = await r1.json();
    if (!d1.ok) { setMsg(msg, d1.error||'Export failed','err'); return; }
    setMsg(msg,'Importing as new project…');
    const r2 = await cafFetch('/v1/projects/import-csv?slug='+encodeURIComponent(newSlug),{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ csv: d1.csv }),
    });
    const d2 = await r2.json();
    if (!d2.ok) { setMsg(msg, (d2.errors&&d2.errors.join('; '))||d2.error||'Import failed','err'); return; }
    setMsg(msg,'Created '+newSlug+' — redirecting…','ok');
    window.location.href = '/admin/config?project='+encodeURIComponent(newSlug);
  }catch(err){setMsg(msg,'Error: '+err.message,'err');}
});

// ── 3. CSV import ─────────────────────────────────────────────────────
document.getElementById('dl-blank').addEventListener('click', async (e) => {
  e.preventDefault();
  try { await downloadBlob('/v1/projects/import-csv/template','caf-project-template.csv'); }
  catch(err){ alert('Error: '+err.message); }
});

async function submitImport(dryRun){
  const msg=document.getElementById('imp-msg');
  const out=document.getElementById('imp-result');
  out.style.display='none';
  const file = document.getElementById('imp-file').files[0];
  if(!file){ setMsg(msg,'Pick a CSV file','err'); return; }
  const slugOverride=document.getElementById('imp-slug').value.trim().toUpperCase();
  const nameOverride=document.getElementById('imp-name').value.trim();
  const params=new URLSearchParams();
  if (dryRun) params.set('dry_run','true');
  if (slugOverride) params.set('slug', slugOverride);
  if (nameOverride) params.set('default_display_name', nameOverride);
  setMsg(msg, dryRun?'Parsing…':'Importing…');
  try{
    const fd = new FormData(); fd.append('file', file, file.name);
    const r = await cafFetch('/v1/projects/import-csv'+(params.toString()?'?'+params.toString():''), { method:'POST', body: fd });
    const d = await r.json();
    out.textContent = JSON.stringify(d, null, 2);
    out.style.display = 'block';
    if (!d.ok) { setMsg(msg, (d.errors&&d.errors.join('; '))||d.error||'Failed','err'); return; }
    if (dryRun) { setMsg(msg,'Dry-run OK. Review the plan below, then click Import.','ok'); return; }
    setMsg(msg,'Imported — redirecting…','ok');
    const slug = (d.project && d.project.slug) || slugOverride;
    setTimeout(()=>{ window.location.href = '/admin/config?project='+encodeURIComponent(slug); }, 500);
  }catch(err){setMsg(msg,'Error: '+err.message,'err');}
}
document.getElementById('imp-dry').addEventListener('click', ()=>submitImport(true));
document.getElementById('import-form').addEventListener('submit', (e)=>{ e.preventDefault(); submitImport(false); });
</script>`;
    reply.type("text/html").send(page("New Project", "", body, projects, "", adminHeadTokenScript(config)));
  });

  // --- Projects list / management ---
  app.get("/admin/projects", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const showSystem = query.show_system === "1" || query.show_system === "true";
    const projects = await listProjects(db, { include_system: showSystem });
    const project = await resolveProject(db, query.project);
    const currentSlug = normalizeProjectSlugParam(project?.slug) ?? "";

    const rows = projects.map((p) => {
      const slug = cleanSlugLoose(p.slug) ?? String(p.slug ?? "");
      const runCount = p.run_count ?? "—";
      const jobCount = p.job_count ?? "—";
      const updated = p.updated_at ? new Date(p.updated_at).toLocaleString() : "—";
      const color = (p.color ?? "#94a3b8").trim();
      return `<tr>
  <td style="max-width:520px">
    <div style="display:flex;gap:10px;align-items:center">
      <span title="${esc(color)}" style="width:10px;height:10px;border-radius:999px;background:${esc(color)};box-shadow:0 0 0 1px rgba(255,255,255,0.12) inset"></span>
      <div style="display:flex;flex-direction:column">
        <span style="font-weight:600">${esc(p.display_name ?? p.slug)}</span>
        <span style="color:var(--muted);font-size:12px">${esc(slug)}</span>
      </div>
    </div>
  </td>
  <td>${p.active ? "Yes" : "No"}</td>
  <td>${esc(runCount)}</td>
  <td>${esc(jobCount)}</td>
  <td style="color:var(--muted)">${esc(updated)}</td>
  <td>
    <button class="btn" style="padding:8px 12px" data-manage="1"
      data-slug="${esc(slug)}"
      data-display-name="${esc(p.display_name ?? "")}"
      data-active="${p.active ? "1" : "0"}"
      data-color="${esc(p.color ?? "#64748b")}"
    >Manage</button>
    <a class="btn" style="padding:8px 12px;margin-left:8px;background:transparent;border:1px solid var(--border);color:var(--fg2)"
      href="/admin?project=${encodeURIComponent(slug)}">Open</a>
  </td>
</tr>`;
    }).join("\n");

    const body = `
<div class="ph">
  <div>
    <h2>Projects</h2>
    <span class="ph-sub">Browse and manage CAF Core projects (slug, name, active, color)</span>
  </div>
  <div class="page-actions" style="display:flex;gap:10px;align-items:center">
    <a href="/admin/new-project" class="btn">+ New Project</a>
  </div>
</div>

<div class="content">
  <div id="p-msg" class="card" style="display:none;margin-bottom:16px"></div>
  <div class="card">
    <div class="card-h">All projects</div>
    <table>
      <thead>
        <tr>
          <th>Project</th>
          <th>Active</th>
          <th>Runs</th>
          <th>Jobs</th>
          <th>Updated</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="6" style="color:var(--muted);padding:24px">No projects found</td></tr>`}
      </tbody>
    </table>
  </div>
</div>

<dialog id="p-dlg">
  <h3>Manage project</h3>
  <div class="form-group"><label>Slug</label><input id="p-slug" disabled></div>
  <div class="form-group"><label>Display name</label><input id="p-name" placeholder="Optional"></div>
  <div class="form-group">
    <label>Color</label>
    <div style="display:flex;gap:10px;align-items:center">
      <input id="p-color" type="color" value="#64748b" style="width:44px;height:36px;padding:0;background:transparent;border:none" aria-label="Project color">
      <input id="p-color-hex" placeholder="#RRGGBB">
    </div>
  </div>
  <div class="form-group" style="flex-direction:row;align-items:center;gap:10px">
    <input id="p-active" type="checkbox" style="width:auto;accent-color:var(--accent)">
    <label for="p-active" style="margin:0">Active</label>
  </div>
  <div class="form-group" style="flex-direction:row;align-items:center;gap:10px;margin-top:8px">
    <input id="p-force" type="checkbox" style="width:auto;accent-color:var(--red)">
    <label for="p-force" style="margin:0">Force delete (also deletes runs/jobs)</label>
  </div>
  <div class="form-actions" style="justify-content:space-between">
    <button id="p-del" class="btn" style="background:transparent;border:1px solid var(--border);color:var(--red)">Delete</button>
    <div style="display:flex;gap:10px;align-items:center">
      <button id="p-close" class="btn" style="background:transparent;border:1px solid var(--border);color:var(--fg2)">Close</button>
      <button id="p-save" class="btn">Save changes</button>
    </div>
  </div>
  <div id="p-dlg-msg" class="form-msg" style="margin-top:10px"></div>
</dialog>

<script>
(function(){
  var dlg = document.getElementById('p-dlg');
  var msg = document.getElementById('p-msg');
  var dlgMsg = document.getElementById('p-dlg-msg');
  var slugEl = document.getElementById('p-slug');
  var nameEl = document.getElementById('p-name');
  var activeEl = document.getElementById('p-active');
  var colorEl = document.getElementById('p-color');
  var colorHexEl = document.getElementById('p-color-hex');
  var forceEl = document.getElementById('p-force');

  function showTopMessage(type, text){
    msg.style.display = 'block';
    msg.style.padding = '10px 16px';
    msg.style.borderRadius = '10px';
    msg.style.border = '1px solid var(--border)';
    msg.style.background = type === 'success' ? 'var(--green-bg)' : 'var(--red-bg)';
    msg.style.color = type === 'success' ? 'var(--green)' : 'var(--red)';
    msg.textContent = text;
  }
  function setDlgMessage(type, text){
    dlgMsg.textContent = text || '';
    dlgMsg.style.color = type === 'success' ? 'var(--green)' : (type === 'error' ? 'var(--red)' : 'var(--muted)');
  }

  function openManage(btn){
    slugEl.value = btn.getAttribute('data-slug') || '';
    nameEl.value = btn.getAttribute('data-display-name') || '';
    activeEl.checked = (btn.getAttribute('data-active') || '0') === '1';
    var c = btn.getAttribute('data-color') || '#64748b';
    if(!/^#[0-9A-Fa-f]{6}$/.test(c)) c = '#64748b';
    colorEl.value = c;
    colorHexEl.value = c;
    forceEl.checked = false;
    setDlgMessage('', '');
    dlg.showModal();
  }

  document.querySelectorAll('button[data-manage="1"]').forEach(function(b){
    b.addEventListener('click', function(){ openManage(b); });
  });

  colorEl.addEventListener('input', function(){ colorHexEl.value = colorEl.value; });
  colorHexEl.addEventListener('input', function(){
    var v = String(colorHexEl.value || '').trim();
    if(/^#[0-9A-Fa-f]{6}$/.test(v)) colorEl.value = v;
  });

  document.getElementById('p-close').addEventListener('click', function(){
    dlg.close();
  });

  document.getElementById('p-save').addEventListener('click', async function(){
    var slug = String(slugEl.value || '').trim().toUpperCase();
    var display_name = String(nameEl.value || '').trim();
    var active = !!activeEl.checked;
    var color = String(colorHexEl.value || '').trim();
    if(color !== '' && !/^#[0-9A-Fa-f]{6}$/.test(color)){
      setDlgMessage('error', 'Color must be like #RRGGBB');
      return;
    }
    setDlgMessage('', 'Saving…');
    try{
      var r = await cafFetch('/v1/admin/projects', {
        method: 'PUT',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ slug: slug, display_name: display_name || null, active: active, color: color || null })
      });
      var d = await r.json();
      if(!r.ok || d.ok === false){
        setDlgMessage('error', d.error || 'Save failed');
        return;
      }
      dlg.close();
      showTopMessage('success','Saved');
      window.location.reload();
    }catch(err){
      setDlgMessage('error', 'Network error while saving');
    }
  });

  document.getElementById('p-del').addEventListener('click', async function(){
    var slug = String(slugEl.value || '').trim().toUpperCase();
    var force = !!forceEl.checked;
    if(!confirm(force ? 'Delete project AND all runs/jobs? This cannot be undone.' : 'Delete project?')) return;
    setDlgMessage('', 'Deleting…');
    try{
      var r = await cafFetch('/v1/admin/projects?slug='+encodeURIComponent(slug)+'&force='+(force?'true':'false'), { method:'DELETE' });
      var d = await r.json();
      if(!r.ok || d.ok === false){
        var hint = d.error === 'project_not_empty' ? 'Project has runs/jobs. Enable Force delete to proceed.' : (d.error || 'Delete failed');
        setDlgMessage('error', hint);
        return;
      }
      dlg.close();
      showTopMessage('success','Deleted');
      window.location.reload();
    }catch(err){
      setDlgMessage('error', 'Network error while deleting');
    }
  });
})();
</script>
`;

    reply.type("text/html").send(page("Projects", "projects", body, projects, currentSlug, adminHeadTokenScript(config)));
  });

  // --- Global Learning (system-level learning store) ---
  app.get("/admin/global-learning", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const projects = await listProjects(db);
    const project = await resolveProject(db, query.project);
    const currentSlug = project?.slug ?? "";

    const globalProject = await qOne<ProjectRow>(
      db,
      `SELECT id, slug, display_name, active, color, is_system
       FROM caf_core.projects
       WHERE slug = 'caf-global'
       LIMIT 1`
    );

    if (!globalProject) {
      const body = `
<div class="ph"><div><h2>Global Learning</h2><span class="ph-sub">System-wide learning store</span></div></div>
<div class="content">
  <div class="card">
    <div class="card-h">Missing system project</div>
    <div class="empty">The <span class="mono">caf-global</span> project was not found. Run migration <span class="mono">010</span> (and <span class="mono">013</span>).</div>
  </div>
</div>`;
      return reply.type("text/html").send(page("Global Learning", "global-learning", body, projects, currentSlug, adminHeadTokenScript(config)));
    }

    const [rulesCount, obsCount, insightsCount, hypothesesCount] = await Promise.all([
      qOne<{ c: number }>(db, `SELECT count(*)::int AS c FROM caf_core.learning_rules WHERE project_id = $1`, [globalProject.id]),
      qOne<{ c: number }>(db, `SELECT count(*)::int AS c FROM caf_core.learning_observations WHERE project_id = $1`, [globalProject.id]),
      qOne<{ c: number }>(db, `SELECT count(*)::int AS c FROM caf_core.learning_insights WHERE project_id = $1`, [globalProject.id]),
      qOne<{ c: number }>(db, `SELECT count(*)::int AS c FROM caf_core.learning_hypotheses WHERE project_id = $1`, [globalProject.id]),
    ]);

    const body = `
<div class="ph">
  <div>
    <h2>Global Learning</h2>
    <span class="ph-sub">System-wide learning store (rules/evidence that apply across projects)</span>
  </div>
</div>

<div class="content">
  <div class="card">
    <div class="card-h">Storage</div>
    <div class="info-row"><span class="info-l">Project slug</span><span class="info-v mono">${esc(globalProject.slug)}</span></div>
    <div class="info-row"><span class="info-l">Display name</span><span class="info-v">${esc(globalProject.display_name ?? "—")}</span></div>
    <div class="info-row"><span class="info-l">System project</span><span class="info-v">${globalProject.is_system ? statusBadge("SYSTEM") : statusBadge("NO")}</span></div>
  </div>

  <div class="card">
    <div class="card-h">Global evidence counts</div>
    <div class="grid3">
      <div class="stat-card"><div class="num">${Number((rulesCount as any)?.c ?? 0)}</div><div class="lbl">Rules</div></div>
      <div class="stat-card"><div class="num">${Number((obsCount as any)?.c ?? 0)}</div><div class="lbl">Observations</div></div>
      <div class="stat-card"><div class="num">${Number((insightsCount as any)?.c ?? 0)}</div><div class="lbl">Insights</div></div>
    </div>
    <div class="grid3" style="margin-top:16px">
      <div class="stat-card"><div class="num">${Number((hypothesesCount as any)?.c ?? 0)}</div><div class="lbl">Hypotheses</div></div>
      <div class="stat-card"><div class="num">—</div><div class="lbl">Trials</div></div>
      <div class="stat-card"><div class="num">—</div><div class="lbl">Attribution</div></div>
    </div>
  </div>

  <div class="card">
    <div class="card-h">Sub-sections</div>
    <p style="color:var(--fg2);margin:0 0 12px">The learning store is fed and introspected by two sub-sections, also reachable directly from the sidebar.</p>
    <div class="grid2">
      <a href="/admin/engine" class="sb-link" style="justify-content:space-between;border:1px solid var(--border);padding:14px 16px">
        <span><strong style="color:var(--fg)">Decision Engine</strong><br><span style="color:var(--muted);font-size:12px">Suppression rules, learning rules, prompt versions, and decision traces.</span></span>
        <span style="color:var(--accent)">&rarr;</span>
      </a>
      <a href="/admin/learning-prompts" class="sb-link" style="justify-content:space-between;border:1px solid var(--border);padding:14px 16px">
        <span><strong style="color:var(--fg)">Learning Prompts</strong><br><span style="color:var(--muted);font-size:12px">The exact system prompts used by the LLM reviewers (carousel + video) that emit learning signal.</span></span>
        <span style="color:var(--accent)">&rarr;</span>
      </a>
    </div>
  </div>

  <div class="card">
    <div class="card-h">API endpoints</div>
    <div class="info-row"><span class="info-l">Merged rules for a content project</span><span class="info-v mono">GET /v1/learning/&lt;project_slug&gt;/rules</span></div>
    <div class="info-row"><span class="info-l">Context preview</span><span class="info-v mono">GET /v1/learning/&lt;project_slug&gt;/context-preview</span></div>
  </div>
</div>`;

    return reply.type("text/html").send(page("Global Learning", "global-learning", body, projects, currentSlug, adminHeadTokenScript(config)));
  });

  // --- Learning prompts (global) ---
  app.get("/admin/learning-prompts", async (_request, reply) => {
    const projects = await listProjects(db);
    const body = `
<div class="ph"><div><h2>Learning prompts</h2><span class="ph-sub">The exact prompt strings used by learning analyzers and LLM review</span></div></div>
<div class="content">
  <div class="card">
    <div class="card-h">LLM review (approved content) — system prompt</div>
    <p style="color:var(--fg2);margin-bottom:10px">Used by <span class="mono">/v1/learning/:slug/llm-review-approved</span>. Vision + text for carousel/image flows when asset URLs are available; for video flows the prompt scores the plan, script, scene bundle, captions, and CTA as a proxy (the chat API cannot ingest the rendered video). Scores <span class="mono">visual_execution_score</span>, <span class="mono">video_plan_score</span>, and <span class="mono">video_execution_score</span> are nulled when a dimension does not apply.</p>
    <pre class="json" style="white-space:pre-wrap;word-break:break-word;max-height:none">${esc(APPROVED_CONTENT_LLM_REVIEW_SYSTEM_PROMPT)}</pre>
  </div>

  <div class="card">
    <div class="card-h">Editorial notes synthesis (optional OpenAI) — system prompt</div>
    <p style="color:var(--fg2);margin-bottom:10px">Used by Editorial analysis when <span class="mono">llm_notes_synthesis</span> is enabled and there are non-empty reviewer notes. Separates carousel and video failure modes and routes video issues (flat opener, voice/visual drift, caption wall, weak CTA, wrong avatar/voice) to the HeyGen / scene-pipeline repo paths instead of carousel templates.</p>
    <pre class="json" style="white-space:pre-wrap;word-break:break-word;max-height:none">${esc(EDITORIAL_NOTES_LLM_SYNTHESIS_SYSTEM_PROMPT)}</pre>
  </div>

  <div class="card">
    <div class="card-h">Editorial engineering brief (deterministic markdown builder)</div>
    <p style="color:var(--fg2);margin-bottom:10px">This is not an LLM prompt; it’s a deterministic markdown export used for engineering remediation.</p>
    <p class="mono" style="color:var(--muted);margin-bottom:0">Source: <span class="mono">src/services/editorial-engineering-prompt.ts</span></p>
  </div>
</div>`;
    reply.type("text/html").send(page("Learning prompts", "learning-prompts", body, projects, "", adminHeadTokenScript(config)));
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
    const videoPlanCapRowsHtml = VIDEO_PLAN_CAP_GROUPS.map(
      (g) => `
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px">
      <label for="plan-cap-video-${esc(g.id)}" style="font-size:12px;min-width:200px;max-width:340px;color:var(--text)">${esc(g.label)}</label>
      <input type="number" id="plan-cap-video-${esc(g.id)}" min="0" step="1" style="width:72px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text)" title="Planner cap for this video family (all listed flow_type synonyms). Empty = default ${DEFAULT_VIDEO_FLOW_PLAN_CAP}."/>
    </div>`
    ).join("");

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
      <p class="runs-ops-hint">Upload ingests <strong>Overall</strong> rows into the DB and creates a run in <strong>CREATED</strong> (no jobs yet — only <strong>Start</strong> writes <code>content_jobs</code>). Use <strong>Start</strong> to plan jobs: aggregate <strong>${config.DEFAULT_MAX_CAROUSEL_JOBS_PER_RUN}</strong> carousel + <strong>${config.DEFAULT_MAX_VIDEO_JOBS_PER_RUN}</strong> video per run (when System limits leave those empty), and <strong>${config.DEFAULT_OTHER_FLOW_PLAN_CAP}</strong> job per other flow type. Use <strong>Re-plan</strong> to wipe jobs and plan again. On the <strong>Jobs</strong> tab, filter by <strong>Run</strong> so you are not looking at a different run’s rows. <strong>Transparency:</strong> <strong>Pack</strong> = stored signal pack JSON; <strong>Candidates</strong> = Overall rows + planner rows (× flows) + run-level API audit; expand a row on <strong>Jobs</strong> for per-task LLM prompts and content preview.</p>
    </div>
    <div class="runs-ops-row" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);align-items:flex-start">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
        <label for="plan-cap-carousel" style="font-size:13px;white-space:nowrap">Max carousel jobs / run</label>
        <input type="number" id="plan-cap-carousel" min="0" step="1" style="width:80px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text)" title="Saved in System limits for this project. Empty uses server default."/>
        <button type="button" class="btn-ghost" id="plan-cap-carousel-save" onclick="saveCarouselCap()" style="border:1px solid var(--border)">Save cap</button>
      </div>
      <p id="plan-cap-carousel-hint" class="runs-ops-hint" style="margin:0;max-width:none">Loading…</p>
    </div>
    <div class="runs-ops-row" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);flex-direction:column;align-items:stretch;gap:10px">
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">Video planning caps</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
        <label for="plan-cap-video-agg" style="font-size:13px;white-space:nowrap">Max video jobs / run (all types)</label>
        <input type="number" id="plan-cap-video-agg" min="0" step="1" style="width:80px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text)" title="Aggregate cap across video/reel jobs. Empty uses server default."/>
        <button type="button" class="btn-ghost" id="plan-cap-video-save" onclick="saveVideoPlanningCaps()" style="border:1px solid var(--border)">Save video caps</button>
      </div>
      <p style="font-size:12px;color:var(--muted);margin:0;line-height:1.45">Per type: caps apply to each flow family (synonyms share one limit). Empty = default <strong>${DEFAULT_VIDEO_FLOW_PLAN_CAP}</strong> per family. Saving updates System limits and affects the next Start or Re-plan.</p>
      ${videoPlanCapRowsHtml}
      <p id="plan-cap-video-hint" class="runs-ops-hint" style="margin:0;max-width:none">Loading…</p>
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

  <div id="run-content-log-modal" class="sp-modal-overlay" onclick="if(event.target===this)closeRunContentLog()">
    <div class="card sp-modal-card" onclick="event.stopPropagation()" style="max-width:1100px">
      <div class="card-h" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <span>Run content log — carousel &amp; video outcomes</span>
        <button type="button" class="btn-ghost" onclick="closeRunContentLog()">Close</button>
      </div>
      <div id="run-content-log-body" style="padding:16px 20px 20px"></div>
    </div>
  </div>

  <div id="run-output-review-modal" class="sp-modal-overlay" onclick="if(event.target===this)closeRunOutputReview()">
    <div class="card sp-modal-card" onclick="event.stopPropagation()" style="max-width:640px">
      <div class="card-h" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <span>Run output review</span>
        <button type="button" class="btn-ghost" onclick="closeRunOutputReview()">Close</button>
      </div>
      <div style="padding:16px 20px 20px">
        <p class="runs-ops-hint" style="margin:0 0 12px">Holistic notes on this run are merged into <strong>editorial analysis</strong> (engineering brief + optional OpenAI notes synthesis), scoped by the same rolling window as the analysis job.</p>
        <div class="form-group"><label>Review</label><textarea id="ror-body" rows="10" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:13px" placeholder="Overall quality, batch issues, what to change next run…"></textarea></div>
        <div class="form-group"><label>Reviewer (optional)</label><input type="text" id="ror-validator" style="width:100%;max-width:360px;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" placeholder="Name or handle"/></div>
        <div class="form-actions"><button type="button" class="btn" onclick="saveRunOutputReview()">Save</button><button type="button" class="btn-ghost" onclick="clearRunOutputReview()">Clear review</button></div>
        <p id="ror-msg" class="form-msg" style="margin-top:10px"></p>
      </div>
    </div>
  </div>

  <div id="upload-panel" class="panel card" style="display:none;max-width:520px">
    <div class="card-h">Upload Signal Pack (.xlsx)</div>
    <form id="upload-form" enctype="multipart/form-data">
      <div class="form-group"><label>File</label><input type="file" name="file" accept=".xlsx,.xls" required style="background:transparent;border:none;padding:6px 0"></div>
      <div class="form-group"><label>Run name (optional)</label><input type="text" name="run_name" maxlength="200" placeholder="Friendly label — stored on the run, does not change run_id"></div>
      <div class="form-group"><label>Source Window (optional)</label><input type="text" name="source_window" placeholder="e.g. 2026W14"></div>
      <div class="form-group"><label>Notes (optional)</label><textarea name="notes" rows="2" placeholder="Any notes about this pack..."></textarea></div>
      <div class="form-actions"><button type="submit" class="btn" id="upload-btn">Upload &amp; Create Run</button><button type="button" class="btn-ghost" onclick="togglePanel('upload-panel')">Cancel</button><span id="upload-msg" class="form-msg"></span></div>
    </form>
  </div>

  <div id="create-panel" class="panel card" style="display:none;max-width:520px">
    <div class="card-h">Create Run Manually</div>
    <form id="create-form">
      <div class="form-group"><label>Run ID (optional, auto-generated if empty)</label><input type="text" name="run_id" placeholder="e.g. SNS_2026W14"></div>
      <div class="form-group"><label>Run name (optional)</label><input type="text" name="name" maxlength="200" placeholder="Friendly label for this run"></div>
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
const DEFAULT_MAX_CAROUSEL=${config.DEFAULT_MAX_CAROUSEL_JOBS_PER_RUN};
const DEFAULT_MAX_VIDEO_AGG=${config.DEFAULT_MAX_VIDEO_JOBS_PER_RUN};
const DEFAULT_MAX_VIDEO_PER_FLOW=${DEFAULT_VIDEO_FLOW_PLAN_CAP};
const VIDEO_PLAN_CAP_GROUPS=${JSON.stringify(VIDEO_PLAN_CAP_GROUPS)};

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
function closeRunContentLog(){
  const m=document.getElementById('run-content-log-modal');
  if(m)m.style.display='none';
  try{delete window._runContentLogRows;}catch(_e){window._runContentLogRows=undefined;}
  try{delete window._runContentLogExport;}catch(_e){window._runContentLogExport=undefined;}
}
function closeRunOutputReview(){
  var m=document.getElementById('run-output-review-modal');
  if(m)m.style.display='none';
  try{delete window._rorRunId;}catch(_e){window._rorRunId=undefined;}
}
async function openRunOutputReview(runId){
  if(!SLUG){showToast('Pick a project in the sidebar first.',false);return;}
  window._rorRunId=runId;
  var modal=document.getElementById('run-output-review-modal');
  var bodyEl=document.getElementById('ror-body');
  var valEl=document.getElementById('ror-validator');
  var msg=document.getElementById('ror-msg');
  if(msg)msg.textContent='';
  if(bodyEl)bodyEl.value='Loading…';
  if(valEl)valEl.value='';
  if(modal)modal.style.display='flex';
  try{
    var r=await cafFetch('/v1/runs/'+encodeURIComponent(SLUG)+'/'+encodeURIComponent(runId)+'/output-review');
    var raw=await r.text();
    var d;try{d=JSON.parse(raw);}catch(e){throw new Error(r.ok?'Invalid JSON':'HTTP '+r.status+' '+raw.slice(0,80));}
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'Load failed'));
    if(bodyEl)bodyEl.value=(d.review&&d.review.body)?String(d.review.body):'';
    if(valEl)valEl.value=(d.review&&d.review.validator)?String(d.review.validator):'';
  }catch(err){
    if(bodyEl)bodyEl.value='';
    showToast(err.message||String(err),false);
  }
}
async function saveRunOutputReview(){
  if(!SLUG||!window._rorRunId){showToast('Nothing to save',false);return;}
  var bodyEl=document.getElementById('ror-body');
  var valEl=document.getElementById('ror-validator');
  var msg=document.getElementById('ror-msg');
  var txt=(bodyEl&&bodyEl.value||'').trim();
  try{
    var r=await cafFetch('/v1/runs/'+encodeURIComponent(SLUG)+'/'+encodeURIComponent(window._rorRunId)+'/output-review',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:txt,validator:(valEl&&valEl.value||'').trim()||undefined})});
    var raw=await r.text();
    var d;try{d=JSON.parse(raw);}catch(e2){throw new Error(r.ok?'Invalid response':'HTTP '+r.status);}
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'Save failed'));
    showToast(d.deleted?'Review cleared.':'Run review saved.',true);
    if(msg)msg.textContent=d.deleted?'Cleared.':'Saved — picked up by the next editorial analysis for this project.';
    if(d.deleted&&bodyEl)bodyEl.value='';
  }catch(err){showToast(err.message||String(err),false);}
}
async function clearRunOutputReview(){
  var bodyEl=document.getElementById('ror-body');
  if(bodyEl)bodyEl.value='';
  await saveRunOutputReview();
}
function copyRunContentLogAll(){
  const ex=window._runContentLogExport;
  if(!ex||!Array.isArray(ex.outcomes)||ex.outcomes.length===0){showToast('Nothing to copy',false);return;}
  const payload={
    project:ex.project,
    run_id:ex.run_id,
    exported_at:ex.exported_at,
    outcome_count:ex.outcomes.length,
    outcomes:ex.outcomes
  };
  copyTextToClipboard(prettyObj(payload),'full content log');
}
async function copyTextToClipboard(text,label){
  const t=String(text||'');
  if(!t){showToast('Nothing to copy',false);return;}
  try{
    await navigator.clipboard.writeText(t);
    showToast(label?('Copied '+label):'Copied',true);
  }catch(_e){
    try{
      const ta=document.createElement('textarea');
      ta.value=t;
      ta.setAttribute('readonly','');
      ta.style.position='fixed';
      ta.style.left='-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast(label?('Copied '+label):'Copied',true);
    }catch(__e){
      showToast('Copy failed',false);
    }
  }
}
function copyRunContentLogTask(idx){
  const arr=window._runContentLogRows;
  if(!arr||arr[idx]==null){showToast('Nothing to copy',false);return;}
  copyTextToClipboard(arr[idx].task_id,'task_id');
}
function copyRunContentLogSummary(idx){
  const arr=window._runContentLogRows;
  if(!arr||arr[idx]==null){showToast('Nothing to copy',false);return;}
  copyTextToClipboard(arr[idx].summary,'summary JSON');
}
async function openRunContentLog(runId){
  const modal=document.getElementById('run-content-log-modal');
  const body=document.getElementById('run-content-log-body');
  if(!modal||!body)return;
  try{delete window._runContentLogExport;}catch(_e){window._runContentLogExport=undefined;}
  body.innerHTML='<p class="empty">Loading…</p>';
  modal.style.display='flex';
  if(!SLUG){
    body.innerHTML='<p class="empty" style="color:var(--yellow)">Open this page with a project in the URL, e.g. <span class="mono">/admin/runs?project=SNS</span>.</p>';
    return;
  }
  try{
    const r=await cafFetch('/v1/admin/runs/content-outcomes?project='+encodeURIComponent(SLUG)+'&run_id='+encodeURIComponent(runId));
    const raw=await r.text();
    let d;
    try{d=JSON.parse(raw);}catch(_e){throw new Error(r.ok?'Invalid JSON from server':'HTTP '+r.status+' — '+raw.slice(0,120));}
    if(!r.ok||!d.ok){
      body.innerHTML='<p class="empty">'+esc(apiErr(d,'Request failed'))+'</p>';
      return;
    }
    const rows=Array.isArray(d.outcomes)?d.outcomes:[];
    if(!rows.length){
      body.innerHTML='<p class="empty">No rows yet. Apply migration <span class="mono">007_run_content_outcomes.sql</span>, then run <strong>Process</strong> on jobs — outcomes append after each carousel/video render attempt.</p>';
      return;
    }
    window._runContentLogRows=rows.map(function(o){return{task_id:String(o.task_id||''),summary:prettyObj(o.summary)};});
    window._runContentLogExport={project:SLUG,run_id:runId,exported_at:new Date().toISOString(),outcomes:rows};
    let h='<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 14px">';
    h+='<button type="button" class="btn" onclick="copyRunContentLogAll()" title="Copy entire log as JSON (paste into chat or a doc)">Copy full log</button>';
    h+='<span style="font-size:12px;color:var(--muted)">Copies project, run_id, and all '+rows.length+' outcome row(s) as one JSON block.</span></div>';
    h+='<p style="font-size:12px;color:var(--muted);margin:0 0 10px;line-height:1.45">Pipeline outcomes (newest first). Per row: <strong>Copy ID</strong> / <strong>Copy summary</strong> for a single cell.</p>';
    h+='<table class="sp-modal-table"><thead><tr><th>When</th><th>task_id</th><th>Kind</th><th>Flow</th><th>Outcome</th><th>Slides</th><th>Assets</th><th>Job status</th><th>Error</th><th>Summary</th></tr></thead><tbody>';
    for(var i=0;i<rows.length;i++){
      var o=rows[i];
      h+='<tr><td>'+esc(fmtDate(o.created_at))+'</td>';
      h+='<td class="mono" style="font-size:10px;max-width:160px;word-break:break-all;vertical-align:top">';
      h+='<button type="button" class="btn-ghost" style="font-size:10px;padding:2px 8px;margin:0 0 6px;cursor:pointer;border:1px solid var(--border);border-radius:4px;background:transparent;color:var(--fg);display:block" onclick="copyRunContentLogTask('+i+')" title="Copy task_id to clipboard">Copy ID</button>';
      h+='<a href="/admin/jobs?project='+encodeURIComponent(SLUG)+'&search='+encodeURIComponent(o.task_id)+'">'+esc(o.task_id)+'</a></td>';
      h+='<td>'+esc(o.flow_kind)+'</td><td class="mono" style="font-size:10px">'+esc(o.flow_type)+'</td>';
      h+='<td>'+badge(o.outcome)+'</td>';
      h+='<td>'+(o.slide_count==null||o.slide_count===''?'—':esc(String(o.slide_count)))+'</td>';
      h+='<td>'+(o.asset_count==null||o.asset_count===''?'—':esc(String(o.asset_count)))+'</td>';
      h+='<td>'+esc(o.job_status||'—')+'</td>';
      h+='<td style="max-width:160px;word-break:break-word;font-size:10px">'+esc(o.error_message||'')+'</td>';
      h+='<td style="vertical-align:top">';
      h+='<button type="button" class="btn-ghost" style="font-size:10px;padding:2px 8px;margin:0 0 6px;cursor:pointer;border:1px solid var(--border);border-radius:4px;background:transparent;color:var(--fg);display:block" onclick="copyRunContentLogSummary('+i+')" title="Copy summary JSON to clipboard">Copy summary</button>';
      h+='<pre style="font-size:9px;max-width:300px;max-height:140px;overflow:auto;margin:0;white-space:pre-wrap">'+esc(prettyObj(o.summary))+'</pre></td></tr>';
    }
    h+='</tbody></table>';
    body.innerHTML=h;
  }catch(e){
    body.innerHTML='<p class="empty" style="color:var(--red)">'+esc(e.message||String(e))+'</p>';
  }
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
  let h='<table><thead><tr><th>Run ID</th><th>Name</th><th>Status</th><th>Jobs</th><th>Created</th><th>Started</th><th>Completed</th><th>Actions</th></tr></thead><tbody>';
  for(const run of runs){
    const meta=run.metadata_json&&typeof run.metadata_json==='object'&&!Array.isArray(run.metadata_json)?run.metadata_json:{};
    const dn=(typeof meta.display_name==='string'&&meta.display_name.trim())?meta.display_name.trim():'';
    const canStart=run.status==='CREATED';
    /** Start leaves the run in GENERATING with jobs still PLANNED until the user clicks Process. Also allow retry after a failed start if jobs were planned. */
    const canProcess=['GENERATING','RENDERING','PLANNED','REVIEWING'].includes(run.status)
      || (run.status==='FAILED' && (run.total_jobs||0) > 0);
    const canCancel=!['COMPLETED','FAILED','CANCELLED'].includes(run.status);
    const canReplan=!!run.signal_pack_id&&run.status!=='PLANNING'&&!(run.status==='CREATED'&&(!run.total_jobs||run.total_jobs===0));
    h+='<tr><td class="mono" style="color:var(--accent)"><a href="/admin/jobs?run_id='+encodeURIComponent(run.run_id)+'&project='+encodeURIComponent(SLUG)+'">'+esc(run.run_id)+'</a>';
    if(run.source_window)h+='<br><span style="font-size:11px;color:var(--muted)">'+esc(run.source_window)+'</span>';
    h+='</td>';
    h+='<td style="max-width:220px">'+(dn?esc(dn):'<span style="color:var(--muted)">—</span>')+'</td>';
    h+='<td>'+badge(run.status)+'</td>';
    h+='<td>'+run.jobs_completed+'/'+run.total_jobs+'</td>';
    h+='<td>'+fmtDate(run.created_at)+'</td><td>'+fmtDate(run.started_at)+'</td><td>'+fmtDate(run.completed_at)+'</td>';
    h+='<td><div class="run-actions">';
    h+='<a class="btn-ghost" style="font-size:11px;padding:4px 10px;text-decoration:none;border:1px solid var(--border);border-radius:6px" href="/admin/run-candidates?project='+encodeURIComponent(SLUG)+'&run_id='+encodeURIComponent(run.run_id)+'">Candidates</a> ';
    h+="<button type='button' class='btn-ghost' style='font-size:11px;padding:4px 10px;border:1px solid var(--border);border-radius:6px;cursor:pointer;background:transparent;color:var(--fg)' onclick='openRunContentLog("+JSON.stringify(run.run_id)+")' title='Carousel slide counts + copy preview; video script preview + assets'>Content log</button> ";
    h+="<button type='button' class='btn-ghost' style='font-size:11px;padding:4px 10px;border:1px solid var(--border);border-radius:6px;cursor:pointer;background:transparent;color:var(--fg)' onclick='openRunOutputReview("+JSON.stringify(run.run_id)+")' title='Holistic run review → editorial analysis'>Run review</button> ";
    if(run.signal_pack_id)h+='<a class="btn-ghost" style="font-size:11px;padding:4px 10px;text-decoration:none;border:1px solid var(--border);border-radius:6px" href="/admin/signal-pack?project='+encodeURIComponent(SLUG)+'&id='+encodeURIComponent(run.signal_pack_id)+'">Pack</a> ';
    if(canStart)h+="<button type='button' class='btn' id='"+runBtnId(run.run_id,'start')+"' onclick='runAction("+JSON.stringify(run.run_id)+","+JSON.stringify("start")+")'>Start</button>";
    if(canProcess)h+="<button type='button' class='btn-ghost' id='"+runBtnId(run.run_id,'process')+"' onclick='runAction("+JSON.stringify(run.run_id)+","+JSON.stringify("process")+")' title='After Start: runs LLM → QC → render for each PLANNED job (can take several minutes)'>Process</button>";
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
    if(action==='process'&&r.status===202&&d.ok){
      showToast(d.message||'Processing started in the background — open Jobs and refresh to watch all jobs advance (can take many minutes).',true,32000);
      loadRuns(runsPage);
      return;
    }
    if(!r.ok||!d.ok)throw new Error(apiErr(d,action+' failed'));
    const msgs={start:'Run started — '+(d.planned_jobs||0)+' jobs planned',cancel:'Run cancelled',process:'Pipeline processing triggered',replan:'Re-planned — removed '+(d.deleted_jobs||0)+', '+(d.planned_jobs||0)+' jobs planned',delete:'Run deleted — '+((d.content_jobs_deleted!=null)?d.content_jobs_deleted:0)+' job row(s) removed'};
    showToast(msgs[action]||'Done',true);
    loadRuns(runsPage);
  }catch(err){showToast(err.message,false);}
  finally{if(btn){btn.disabled=false;btn.textContent=action==='start'?'Start':action==='process'?'Process':action==='replan'?'Re-plan':action==='delete'?'Delete':'Cancel';}}
}

function normalizePerFlowCapsClient(raw){
  if(raw==null)return {};
  if(typeof raw==='string'){
    var st=raw.trim();
    if(!st)return {};
    try{return normalizePerFlowCapsClient(JSON.parse(st));}catch(e){return {};}
  }
  if(typeof raw!=='object'||Array.isArray(raw))return {};
  var out={};
  for(var i=0,ks=Object.keys(raw);i<ks.length;i++){
    var k=ks[i];
    var val=raw[k];
    var n=typeof val==='number'?val:Number(val);
    if(Number.isFinite(n)&&n>=0)out[k]=Math.min(Math.floor(n),1000000);
  }
  return out;
}

async function loadPlanningCaps(){
  const cinp=document.getElementById('plan-cap-carousel');
  const chint=document.getElementById('plan-cap-carousel-hint');
  const cbtn=document.getElementById('plan-cap-carousel-save');
  const aggInp=document.getElementById('plan-cap-video-agg');
  const vHint=document.getElementById('plan-cap-video-hint');
  const vBtn=document.getElementById('plan-cap-video-save');
  if(!cinp&&!aggInp)return;
  if(cinp)cinp.placeholder=String(DEFAULT_MAX_CAROUSEL);
  if(aggInp)aggInp.placeholder=String(DEFAULT_MAX_VIDEO_AGG);
  VIDEO_PLAN_CAP_GROUPS.forEach(function(g){
    var el=document.getElementById('plan-cap-video-'+g.id);
    if(el)el.placeholder=String(DEFAULT_MAX_VIDEO_PER_FLOW);
  });
  if(!SLUG){
    if(cinp){cinp.disabled=true;if(cbtn)cbtn.disabled=true;if(chint)chint.textContent='Pick a project in the sidebar (or ?project=slug) to edit planning caps.';}
    if(aggInp){aggInp.disabled=true;if(vBtn)vBtn.disabled=true;}
    VIDEO_PLAN_CAP_GROUPS.forEach(function(g){var el=document.getElementById('plan-cap-video-'+g.id);if(el)el.disabled=true;});
    if(vHint)vHint.textContent='Pick a project to edit video caps.';
    return;
  }
  if(cinp){cinp.disabled=false;if(cbtn)cbtn.disabled=false;}
  if(aggInp){aggInp.disabled=false;if(vBtn)vBtn.disabled=false;}
  VIDEO_PLAN_CAP_GROUPS.forEach(function(g){var el=document.getElementById('plan-cap-video-'+g.id);if(el)el.disabled=false;});
  if(chint)chint.textContent='Loading…';
  if(vHint)vHint.textContent='Loading…';
  try{
    const r=await cafFetch('/v1/admin/config?project='+encodeURIComponent(SLUG));
    const d=await r.json();
    if(!d.ok){
      var errMsg=esc(apiErr(d,'Could not load constraints'));
      if(chint)chint.textContent=errMsg;
      if(vHint)vHint.textContent=errMsg;
      return;
    }
    if(cinp){
      const cv=d.constraints&&d.constraints.max_carousel_jobs_per_run;
      const cHas=cv!=null&&cv!=='';
      cinp.value=cHas?String(cv):'';
      const cEff=cHas?Number(cv):DEFAULT_MAX_CAROUSEL;
      if(chint)chint.textContent='Effective when you Start or Re-plan: '+cEff+' carousel job(s) per run ('+(cHas?'from System limits':'server default '+DEFAULT_MAX_CAROUSEL)+'). Clear the field and Save cap to use the default.';
    }
    if(aggInp){
      const vv=d.constraints&&d.constraints.max_video_jobs_per_run;
      const vHas=vv!=null&&vv!=='';
      aggInp.value=vHas?String(vv):'';
      var vEffAgg=vHas?Number(vv):DEFAULT_MAX_VIDEO_AGG;
      var ov=normalizePerFlowCapsClient(d.constraints&&d.constraints.max_jobs_per_flow_type);
      var parts=[];
      VIDEO_PLAN_CAP_GROUPS.forEach(function(g){
        var el=document.getElementById('plan-cap-video-'+g.id);
        var set=false,val=0;
        for(var i=0;i<g.keys.length;i++){
          if(Object.prototype.hasOwnProperty.call(ov,g.keys[i])){val=ov[g.keys[i]];set=true;break;}
        }
        if(el)el.value=set?String(val):'';
        var eff=set?val:DEFAULT_MAX_VIDEO_PER_FLOW;
        parts.push(g.label.split('(')[0].trim()+': '+eff);
      });
      if(vHint)vHint.textContent='Aggregate video limit: '+vEffAgg+' / run ('+(vHas?'saved in System limits':'server default '+DEFAULT_MAX_VIDEO_AGG)+'). Per family: '+parts.join(' · ')+'. Clear a row and Save video caps to use defaults for that family.';
    }
  }catch(err){
    var msg='Could not load constraints: '+esc(err.message||String(err));
    if(chint)chint.textContent=msg;
    if(vHint)vHint.textContent=msg;
  }
}

async function saveVideoPlanningCaps(){
  if(!SLUG){showToast('Select a project in the sidebar first.',false);return;}
  const aggInp=document.getElementById('plan-cap-video-agg');
  const vBtn=document.getElementById('plan-cap-video-save');
  const aggRaw=(aggInp&&aggInp.value||'').trim();
  if(aggRaw!==''){
    var an=parseInt(aggRaw,10);
    if(!Number.isFinite(an)||an<0){showToast('Video aggregate: enter a non-negative integer or leave empty for the server default.',false);return;}
  }
  for(var gi=0;gi<VIDEO_PLAN_CAP_GROUPS.length;gi++){
    var g=VIDEO_PLAN_CAP_GROUPS[gi];
    var inp=document.getElementById('plan-cap-video-'+g.id);
    var tr=(inp&&inp.value||'').trim();
    if(tr!==''){
      var tn=parseInt(tr,10);
      if(!Number.isFinite(tn)||tn<0){showToast('Each video type: non-negative integer or empty.',false);return;}
    }
  }
  if(vBtn)vBtn.disabled=true;
  try{
    var r0=await cafFetch('/v1/admin/config?project='+encodeURIComponent(SLUG));
    var d0=await r0.json();
    if(!d0.ok)throw new Error(apiErr(d0,'Could not load constraints'));
    var merged=normalizePerFlowCapsClient(d0.constraints&&d0.constraints.max_jobs_per_flow_type);
    for(var gj=0;gj<VIDEO_PLAN_CAP_GROUPS.length;gj++){
      var grp=VIDEO_PLAN_CAP_GROUPS[gj];
      var inpg=document.getElementById('plan-cap-video-'+grp.id);
      var rawg=(inpg&&inpg.value||'').trim();
      for(var ki=0;ki<grp.keys.length;ki++)delete merged[grp.keys[ki]];
      if(rawg!==''){
        var ng=parseInt(rawg,10);
        for(var kj=0;kj<grp.keys.length;kj++)merged[grp.keys[kj]]=ng;
      }
    }
    var body={_project:SLUG,max_jobs_per_flow_type:merged};
    if(aggRaw==='')body.max_video_jobs_per_run='';
    else body.max_video_jobs_per_run=parseInt(aggRaw,10);
    var r=await cafFetch('/v1/admin/config/constraints',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var rawText=await r.text();
    var dj;try{dj=JSON.parse(rawText);}catch(e2){throw new Error(r.ok?'Invalid response':'HTTP '+r.status);}
    if(!r.ok||!dj.ok)throw new Error(apiErr(dj,'Save failed'));
    showToast('Video planning caps saved.',true);
    await loadPlanningCaps();
  }catch(err){showToast(err.message,false);}
  finally{if(vBtn)vBtn.disabled=false;}
}
async function saveCarouselCap(){
  if(!SLUG){showToast('Select a project in the sidebar first.',false);return;}
  const inp=document.getElementById('plan-cap-carousel');
  const btn=document.getElementById('plan-cap-carousel-save');
  const raw=(inp&&inp.value||'').trim();
  const body={_project:SLUG};
  if(raw==='')body.max_carousel_jobs_per_run='';
  else{
    const n=parseInt(raw,10);
    if(!Number.isFinite(n)||n<0){showToast('Enter a non-negative integer, or leave empty for the server default.',false);return;}
    body.max_carousel_jobs_per_run=n;
  }
  if(btn)btn.disabled=true;
  try{
    const r=await cafFetch('/v1/admin/config/constraints',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const rawText=await r.text();
    let d;try{d=JSON.parse(rawText);}catch{throw new Error(r.ok?'Invalid response':'HTTP '+r.status);}
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'Save failed'));
    showToast('Carousel job cap saved.',true);
    await loadPlanningCaps();
  }catch(err){showToast(err.message,false);}
  finally{if(btn)btn.disabled=false;}
}

loadRuns(1);
loadPlanningCaps();
window.addEventListener('pageshow',function(ev){if(ev.persisted)setTimeout(function(){loadRuns(runsPage);loadPlanningCaps();},0);});

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

  app.get("/admin/scene-lab", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const projects = await listProjects(db);
    const project = await resolveProject(db, query.project);
    const currentSlug = project?.slug ?? "";
    const packs = project ? await listSignalPacks(db, project.id, 80, 0) : [];
    const packOptions = packs
      .map((p) => {
        const n = Array.isArray(p.overall_candidates_json) ? p.overall_candidates_json.length : 0;
        const label = `${p.run_id} · ${n} overall rows · ${String(p.created_at).slice(0, 10)}`;
        return `<option value="${esc(p.id)}">${esc(label)}</option>`;
      })
      .join("");

    const bodyNoProject = `
<div class="ph"><div><h2>Scene assembly lab</h2><span class="ph-sub">Script + scenes; optional full media pipeline</span></div></div>
<div class="content"><p class="empty">Pick a project in the sidebar (or open <span class="mono">/admin/scene-lab?project=YOUR_SLUG</span>).</p></div>`;

    const body = project
      ? `
<div class="ph"><div><h2>Scene assembly lab</h2><span class="ph-sub">LLM script + scene bundle, then (by default) QC and full scene-pipeline</span></div></div>
<div class="content">
  <p class="runs-ops-hint">Creates a <span class="mono">LAB_SA_*</span> run and one <span class="mono">FLOW_SCENE_ASSEMBLY</span> job. By default, after a successful generation Core runs the same pipeline as <strong>Process</strong>: QC, scene clips, voice, subtitles, and mux (requires working <span class="mono">VIDEO_ASSEMBLY_BASE_URL</span> / Sora config as in production). Check <strong>LLM only</strong> below to skip that step (dry run). Results: <a href="/admin/jobs?project=${esc(currentSlug)}">Jobs</a>.</p>
  <div class="card" style="margin-bottom:16px">
    <div class="card-h">Options</div>
    <div class="config-form" style="padding:12px 16px 16px">
      <label class="form-group" style="margin:0;display:flex;align-items:flex-start;gap:10px;cursor:pointer">
        <input type="checkbox" id="slab-llm-only" style="margin-top:4px">
        <span><strong>LLM only</strong> — skip QC and media pipeline (no scene videos, voice, or assembly). Same as API <span class="mono">start_pipeline: false</span>.</span>
      </label>
    </div>
  </div>
  <div class="card" style="margin-bottom:16px">
    <div class="card-h">New lab run</div>
    <form id="slab-new" class="config-form" style="padding:12px 16px 16px">
      <div class="form-group">
        <label for="slab-pack">Signal pack (stored folder / row)</label>
        <select id="slab-pack" name="signal_pack_id" required>${packOptions || '<option value="">No signal packs for this project</option>'}</select>
      </div>
      <div class="form-group">
        <label for="slab-platform">Platform</label>
        <select id="slab-platform" name="platform"><option>TikTok</option><option>Instagram</option></select>
      </div>
      <div class="form-group">
        <label for="slab-cand">Optional candidate JSON (merged over lab defaults — e.g. content_idea, summary, candidate_id)</label>
        <textarea id="slab-cand" name="candidate_json" rows="6" placeholder='{ "content_idea": "…", "summary": "…" }'></textarea>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn" id="slab-new-btn">Run lab</button>
        <span id="slab-new-msg" class="form-msg"></span>
      </div>
    </form>
  </div>
  <div class="card" style="margin-bottom:16px">
    <div class="card-h">Regenerate an existing scene job</div>
    <form id="slab-regen" class="config-form" style="padding:12px 16px 16px">
      <p class="runs-ops-hint" style="margin-top:0">Optional JSON is <strong>merged</strong> into the job’s existing <span class="mono">candidate_data</span> before the LLM runs (same keys are overwritten). Use this to push a longer <span class="mono">content_idea</span> / <span class="mono">summary</span>, scene-count hints, or brand notes without creating a new lab job.</p>
      <div class="form-group">
        <label for="slab-task">task_id</label>
        <input type="text" id="slab-task" name="task_id" placeholder="Paste task_id from Jobs" required>
      </div>
      <div class="form-group">
        <label for="slab-regen-cand">Optional candidate JSON (merged over stored candidate_data)</label>
        <textarea id="slab-regen-cand" name="regen_candidate_json" rows="6" placeholder='{ "content_idea": "…", "summary": "…" }'></textarea>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-ghost" id="slab-regen-btn">Regenerate + pipeline</button>
        <span id="slab-regen-msg" class="form-msg"></span>
      </div>
    </form>
  </div>
  <div class="card" style="margin-bottom:16px">
    <div class="card-h">Merge clips only (Supabase folder)</div>
    <form id="slab-merge" class="config-form" style="padding:12px 16px 16px">
      <p class="runs-ops-hint" style="margin-top:0">Lists <span class="mono">*.mp4</span> under in-bucket path <span class="mono">assets/scenes/{run_id}/{task_id}/</span> (matches the Storage tree <em>assets → assets → scenes → …</em>). Uses <strong>signed URLs</strong> so private buckets work (anonymous <span class="mono">/object/public/assets/assets/scenes/…</span> often returns 400). Then <strong>concat → TTS → mux</strong> with <strong>captions burned in</strong> (<span class="mono">captions.srt</span> via video-assembly ffmpeg). <span class="mono">pipeline.subtitles_burned_into_video</span> in JSON confirms burn. <strong>Last response</strong>: <span class="mono">http_status</span> + <span class="mono">body</span>. No new Sora clips. <span class="mono">OPENAI_API_KEY</span> for voice.</p>
      <div class="form-group">
        <label for="slab-merge-task">task_id</label>
        <input type="text" id="slab-merge-task" name="task_id" placeholder="Job’s task_id (must exist in Jobs)" required>
      </div>
      <div class="form-group">
        <label for="slab-merge-expand">Voiceover length</label>
        <select id="slab-merge-expand" name="expand_voiceover" style="max-width:100%">
          <option value="never" selected>Never (default) — keep script from script flow; only re-link clips + mux</option>
          <option value="auto">Auto — LLM expand only if script looks short vs timeline</option>
          <option value="always">Always — rewrite spoken_script (recovery / lab only)</option>
        </select>
      </div>
      <div class="form-actions" style="flex-wrap:wrap;gap:8px;align-items:center">
        <button type="submit" class="btn" id="slab-merge-btn">Merge from storage</button>
        <button type="button" class="btn btn-ghost btn-sm" id="slab-merge-copy-btn" title="Copy merge log (same box as below)">Copy merge log</button>
        <span id="slab-merge-msg" class="form-msg"></span>
      </div>
    </form>
  </div>
  <div class="card" style="margin-bottom:16px">
    <div class="card-h">Resume pipeline (URLs already on job)</div>
    <form id="slab-resume" class="config-form" style="padding:12px 16px 16px">
      <p class="runs-ops-hint" style="margin-top:0">Runs <strong>concat → TTS → mux</strong> using <span class="mono">rendered_scene_url</span> / <span class="mono">video_url</span> already stored on each scene in the job — <strong>no Sora, no HeyGen, no folder scan</strong>. Use after clips exist (e.g. stuck in <span class="mono">scene_import_concat</span>) to retry assembly only.</p>
      <div class="form-group">
        <label for="slab-resume-task">task_id</label>
        <input type="text" id="slab-resume-task" name="task_id" placeholder="Job’s task_id" required>
      </div>
      <div class="form-actions" style="flex-wrap:wrap;gap:8px;align-items:center">
        <button type="submit" class="btn" id="slab-resume-btn">Resume scene pipeline</button>
        <span id="slab-resume-msg" class="form-msg"></span>
      </div>
    </form>
  </div>
  <div class="card">
    <div class="card-h" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <span>Last response <span class="runs-ops-hint" style="font-weight:normal">(merge: HTTP envelope + body — use Copy)</span></span>
      <button type="button" class="btn btn-ghost btn-sm" id="slab-copy-btn" title="Copy JSON to clipboard">Copy</button>
    </div>
    <pre id="slab-out" class="json" style="max-height:420px;margin:0;border-radius:0;border:none;border-top:1px solid var(--border)">—</pre>
  </div>
</div>
<script>
const SLUG=${JSON.stringify(currentSlug)};
function pretty(v){try{return JSON.stringify(v,null,2);}catch(e){return String(v)}}
function slabStartPipeline(){
  const c=document.getElementById('slab-llm-only');
  return !(c&&c.checked);
}
async function postLab(payload,msgEl,btn){
  const out=document.getElementById('slab-out');
  if(btn)btn.disabled=true;
  if(msgEl){
    msgEl.textContent=slabStartPipeline()?'Running (LLM + pipeline — may take a long time)…':'Running (LLM only)…';
    msgEl.style.color='var(--accent)';
  }
  try{
    const r=await cafFetch('/v1/admin/scene-assembly-lab',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const d=await r.json();
    if(out)out.textContent=pretty(d);
    if(msgEl){
      if(d.ok){
        if(d.pipeline&&d.pipeline.ran&&d.pipeline.ok===false){
          msgEl.textContent='Generation ok; pipeline failed — see JSON';
          msgEl.style.color='var(--amber, #d97706)';
        }else if(d.pipeline&&d.pipeline.skipped){
          msgEl.textContent='Done (job skipped offline pipeline)';
          msgEl.style.color='var(--amber, #d97706)';
        }else{
          msgEl.textContent='Done';
          msgEl.style.color='var(--green, #22c55e)';
        }
      }else{msgEl.textContent=d.error||'Failed';msgEl.style.color='var(--red)';}
    }
  }catch(e){
    if(out)out.textContent=String(e&&e.message||e);
    if(msgEl){msgEl.textContent='Request error';msgEl.style.color='var(--red)';}
  }finally{if(btn)btn.disabled=false;}
}
document.getElementById('slab-new').addEventListener('submit',function(e){
  e.preventDefault();
  const pack=document.getElementById('slab-pack').value.trim();
  if(!pack)return;
  let candidate_data=undefined;
  const raw=document.getElementById('slab-cand').value.trim();
  if(raw){
    try{candidate_data=JSON.parse(raw);}catch(err){
      document.getElementById('slab-new-msg').textContent='Invalid JSON in candidate field';document.getElementById('slab-new-msg').style.color='var(--red)';return;
    }
  }
  postLab({
    mode:'new',
    project_slug:SLUG,
    signal_pack_id:pack,
    platform:document.getElementById('slab-platform').value,
    candidate_data,
    start_pipeline:slabStartPipeline()
  },document.getElementById('slab-new-msg'),document.getElementById('slab-new-btn'));
});
document.getElementById('slab-regen').addEventListener('submit',function(e){
  e.preventDefault();
  const tid=document.getElementById('slab-task').value.trim();
  if(!tid)return;
  let candidate_data=undefined;
  const raw=document.getElementById('slab-regen-cand').value.trim();
  if(raw){
    try{candidate_data=JSON.parse(raw);}catch(err){
      document.getElementById('slab-regen-msg').textContent='Invalid JSON in optional candidate field';document.getElementById('slab-regen-msg').style.color='var(--red)';return;
    }
  }
  const payload={mode:'regenerate',project_slug:SLUG,task_id:tid,start_pipeline:slabStartPipeline()};
  if(candidate_data!==undefined)payload.candidate_data=candidate_data;
  postLab(payload,document.getElementById('slab-regen-msg'),document.getElementById('slab-regen-btn'));
});
function copyTextToClipboard(text,btn,okLabel){
  const idle=btn.textContent;
  function flash(l){btn.textContent=l;setTimeout(function(){btn.textContent=idle;},1600);}
  if(!String(text||'').trim()){flash('Nothing to copy');return Promise.resolve();}
  return navigator.clipboard.writeText(text).then(function(){flash(okLabel||'Copied');}).catch(function(){flash('Copy failed');});
}
document.getElementById('slab-merge').addEventListener('submit',function(e){
  e.preventDefault();
  const tid=document.getElementById('slab-merge-task').value.trim();
  if(!tid)return;
  const out=document.getElementById('slab-out');
  const btn=document.getElementById('slab-merge-btn');
  const msgEl=document.getElementById('slab-merge-msg');
  if(btn)btn.disabled=true;
  if(msgEl){msgEl.textContent='Merging (concat / TTS / mux)…';msgEl.style.color='var(--accent)';}
  const ep='/v1/admin/scene-assembly-merge-from-storage';
  var expandVo=document.getElementById('slab-merge-expand');
  var expand_voiceover=expandVo&&expandVo.value?String(expandVo.value):'never';
  cafFetch(ep,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project_slug:SLUG,task_id:tid,expand_voiceover:expand_voiceover})})
    .then(async function(r){
      const raw=await r.text();
      let body;
      try{body=JSON.parse(raw);}catch(_e){body={ok:false,error:'invalid_json',raw_response_excerpt:raw.slice(0,4000)};}
      return{http_status:r.status,http_ok:r.ok,endpoint:'POST '+ep,body};
    })
    .then(function(env){
      if(out)out.textContent=pretty(env);
      if(msgEl){
        var p=env.body&&env.body.pipeline;
        if(env.body&&env.body.ok){
          if(p&&p.mux_completed===false&&(p.mux_error||((p.warnings||[]).length>0))){
            msgEl.textContent='Done — concat ok; check pipeline.mux_error / warnings in JSON';
            msgEl.style.color='var(--amber, #d97706)';
          }else if(p&&p.mux_completed===true){
            msgEl.textContent='Done (mux + final video)';
            msgEl.style.color='var(--green, #22c55e)';
          }else{
            msgEl.textContent='Done';
            msgEl.style.color='var(--green, #22c55e)';
          }
        }else{
          msgEl.textContent=(env.body&&env.body.error)||('HTTP '+env.http_status);
          msgEl.style.color='var(--red)';
        }
      }
    })
    .catch(function(err){
      if(out)out.textContent=pretty({endpoint:'POST '+ep,http_status:0,http_ok:false,body:{ok:false,error:String(err&&err.message||err)}});
      if(msgEl){msgEl.textContent='Request error';msgEl.style.color='var(--red)';}
    })
    .finally(function(){if(btn)btn.disabled=false;});
});
document.getElementById('slab-resume').addEventListener('submit',function(e){
  e.preventDefault();
  const tid=document.getElementById('slab-resume-task').value.trim();
  if(!tid)return;
  const out=document.getElementById('slab-out');
  const btn=document.getElementById('slab-resume-btn');
  const msgEl=document.getElementById('slab-resume-msg');
  if(btn)btn.disabled=true;
  if(msgEl){msgEl.textContent='Resuming (concat / TTS / mux)…';msgEl.style.color='var(--accent)';}
  const ep='/v1/admin/scene-assembly-resume-pipeline';
  cafFetch(ep,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project_slug:SLUG,task_id:tid})})
    .then(async function(r){
      const raw=await r.text();
      let body;
      try{body=JSON.parse(raw);}catch(_e){body={ok:false,error:'invalid_json',raw_response_excerpt:raw.slice(0,4000)};}
      return{http_status:r.status,http_ok:r.ok,endpoint:'POST '+ep,body};
    })
    .then(function(env){
      if(out)out.textContent=pretty(env);
      if(msgEl){
        var p=env.body&&env.body.pipeline;
        if(env.body&&env.body.ok){
          if(p&&p.mux_completed===false&&(p.mux_error||((p.warnings||[]).length>0))){
            msgEl.textContent='Done — concat ok; check pipeline.mux_error / warnings';
            msgEl.style.color='var(--amber, #d97706)';
          }else if(p&&p.mux_completed===true){
            msgEl.textContent='Done (mux + final video)';
            msgEl.style.color='var(--green, #22c55e)';
          }else{
            msgEl.textContent='Done';
            msgEl.style.color='var(--green, #22c55e)';
          }
        }else{
          msgEl.textContent=(env.body&&env.body.error)||('HTTP '+env.http_status);
          msgEl.style.color='var(--red)';
        }
      }
    })
    .catch(function(err){
      if(out)out.textContent=pretty({endpoint:'POST '+ep,http_status:0,http_ok:false,body:{ok:false,error:String(err&&err.message||err)}});
      if(msgEl){msgEl.textContent='Request error';msgEl.style.color='var(--red)';}
    })
    .finally(function(){if(btn)btn.disabled=false;});
});
var slabMergeCopy=document.getElementById('slab-merge-copy-btn');
if(slabMergeCopy)slabMergeCopy.addEventListener('click',function(){
  var out=document.getElementById('slab-out');
  copyTextToClipboard((out&&out.textContent)?String(out.textContent):'',this,'Copied');
});
document.getElementById('slab-copy-btn').addEventListener('click',async function(){
  const out=document.getElementById('slab-out');
  const btn=this;
  const text=(out&&out.textContent)?String(out.textContent):'';
  const idle='Copy';
  function flash(label){btn.textContent=label;setTimeout(function(){btn.textContent=idle;},1600);}
  if(!text.trim()||text.trim()==='—'){flash('Nothing to copy');return;}
  try{
    await navigator.clipboard.writeText(text);
    flash('Copied');
  }catch(_e){
    flash('Copy failed');
  }
});
</script>`
      : bodyNoProject;

    reply
      .header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
      .type("text/html")
      .send(page("Scene lab", "scene-lab", body, projects, currentSlug, adminHeadTokenScript(config)));
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
    const snap=d.run.prompt_versions_snapshot;
    const snapKeys=snap&&typeof snap==='object'&&!Array.isArray(snap)?Object.keys(snap):[];
    const hasSnap=snapKeys.length>0;
    let h='<div class="card" style="margin-bottom:14px"><div class="card-h">Run</div><div style="padding:12px 16px 16px;font-size:13px">'+
      '<p style="margin:0 0 8px"><span class="mono">'+esc(d.run.run_id)+'</span> · '+esc(d.run.status)+' · jobs '+esc(String(d.run.jobs_completed))+'/'+esc(String(d.run.total_jobs))+'</p>'+
      '<ul style="margin:0;padding-left:18px;color:var(--muted);font-size:12px;line-height:1.5">'+
      '<li>'+esc(notes.stored_signal_pack||'')+'</li><li>'+esc(notes.planner||'')+'</li><li>'+esc(notes.jobs||'')+'</li><li>'+esc(notes.prompt_versions_snapshot||'')+'</li></ul>';
    if(hasSnap){
      h+='<details style="margin-top:12px"><summary style="cursor:pointer;font-size:12px;font-weight:600">Prompt versions snapshot</summary>'+
        '<p style="margin:8px 0 4px;font-size:11px;color:var(--muted)">Stored on <span class="mono">runs.prompt_versions_snapshot</span> at plan time (learning / attribution).</p>'+
        '<pre style="margin:0;font-size:10px;max-height:320px;overflow:auto;white-space:pre-wrap;word-break:break-word;background:var(--card2);padding:10px;border-radius:8px;border:1px solid var(--border)">'+esc(pretty(snap))+'</pre></details>';
    }else{
      h+='<p style="margin:10px 0 0;font-size:11px;color:var(--muted)">No prompt snapshot yet (empty object, or apply migration <span class="mono">008_run_prompt_versions_snapshot</span> and re-plan).</p>';
    }
    h+='</div></div>';

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
.jobs-main-table{table-layout:fixed}
.jobs-main-table th:nth-child(1),.jobs-main-table td:nth-child(1){width:240px}
.jobs-main-table th:nth-child(2),.jobs-main-table td:nth-child(2){width:170px}
.job-cell-inner{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#toast-area{position:relative;z-index:200}
.toast{margin:0 0 16px;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:500;animation:jobsToastIn .25s ease-out}
.toast-ok{background:var(--green-bg);color:var(--green);border:1px solid rgba(34,197,94,.2)}
.toast-err{background:var(--red-bg);color:var(--red);border:1px solid rgba(239,68,68,.2)}
@keyframes jobsToastIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
</style>
  <div id="toast-area"></div>
  <div class="jobs-live-row" style="margin:0 0 12px">
    <button type="button" class="btn-ghost" style="border:1px solid var(--border)" onclick="reworkPendingNeedsEdit()" title="Queues rework for every job whose status is NEEDS_EDIT (runs in background)">
      Rework pending NEEDS_EDIT
    </button>
    <span style="font-size:12px;color:var(--muted)">Uses stored NEEDS_EDIT instructions when present; system NEEDS_EDIT (no review row) runs partial rework from QC context. Full/partial: same task_id, new job_drafts row, full pipeline + render. Override-only: patch generated_output on the same job.</span>
  </div>
  <div class="filter-row" id="filters">
    <div><label>Search</label><input type="text" id="f-search" placeholder="task_id or run_id..." value=""></div>
    <div><label>Status</label><select id="f-status"><option value="">All</option></select></div>
    <div><label>Platform</label><select id="f-platform"><option value="">All</option></select></div>
    <div><label>Flow type</label><select id="f-flow"><option value="">All</option></select></div>
    <div><label>Run ID</label><select id="f-run"><option value="">All</option></select></div>
    <div><button class="btn" onclick="loadJobs(1)">Filter</button></div>
    <div><button type="button" class="btn-ghost" style="color:var(--red);border:1px solid var(--border)" onclick="deleteJobsForFilteredRun()" title="Uses Run ID dropdown, else ?run_id= URL, else Search text as run id. Typo in run id removes 0 rows — use Erase matching filters if you filtered the table with Search.">Erase jobs for this run</button></div>
    <div><button type="button" class="btn-ghost" style="color:var(--red);border:1px solid var(--border)" onclick="deleteJobsMatchingFilters()" title="Deletes jobs that match your Search / Run / Status / Platform / Flow filters (same as the table). Max 5000. Click Filter first so the table preview matches.">Erase matching filters</button></div>
    <div><button type="button" class="btn-ghost" style="color:var(--red);border:1px solid var(--border)" onclick="eraseAllJobsInProject()" title="Deletes every job in this project (all pages). Runs and signal packs stay. You must type the project slug to confirm.">Erase all jobs in project</button></div>
  </div>
  <div class="jobs-live-row">
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="jobs-live" checked> Auto-refresh every 4s (only when this tab is visible)</label>
    <span id="jobs-live-status" style="font-size:12px;color:var(--muted)"></span>
  </div>
  <p style="font-size:12px;color:var(--muted);line-height:1.45;margin:0 0 12px;max-width:920px"><strong>Phase</strong> shows pipeline position (LLM → QC → render → review). <strong>NEEDS_EDIT</strong> keeps the same <code>task_id</code>; rework regenerates in place and archives prior output in <code>generation_payload.rework_history</code> and <code>job_drafts</code>. The <strong>Render</strong> column for NEEDS_EDIT shows whether the last render was a prior pass (reference) vs still waiting. Use <strong>Re-run</strong> to reset and run the full pipeline, or <strong>Rework pending NEEDS_EDIT</strong> for batch rework. Expand a row for human review timeline, drafts, and API audit.</p>
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
let jobsToastTimer=null;
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function escAttr(s){return esc(s).replace(/"/g,'&quot;');}
function trunc(s,n){if(s==null||s==='')return '—';s=String(s);return s.length<=n?s:s.slice(0,Math.max(0,n-1))+'…';}
function showToast(msg,ok,durationMs){
  const area=document.getElementById('toast-area');
  if(!area){if(!ok)alert(String(msg||''));return;}
  if(jobsToastTimer)clearTimeout(jobsToastTimer);
  area.innerHTML='<div class="toast '+(ok?'toast-ok':'toast-err')+'">'+esc(msg)+'</div>';
  const ms=durationMs!=null&&durationMs>=0?durationMs:(ok?8000:16000);
  jobsToastTimer=setTimeout(function(){area.innerHTML='';jobsToastTimer=null;},ms);
}
function currentJobFilterBody(){
  return {
    project:JOB_SLUG,
    status:String((document.getElementById('f-status')||{}).value||'').trim(),
    platform:String((document.getElementById('f-platform')||{}).value||'').trim(),
    flow_type:String((document.getElementById('f-flow')||{}).value||'').trim(),
    run_id:String((document.getElementById('f-run')||{}).value||'').trim(),
    search:String((document.getElementById('f-search')||{}).value||'').trim()
  };
}
async function deleteJobsMatchingFilters(){
  if(!JOB_SLUG){showToast('Select a project first',false);return;}
  var b=currentJobFilterBody();
  if(!b.search&&!b.run_id&&!b.status&&!b.platform&&!b.flow_type){
    showToast('Set Search, Run ID, Status, Platform, or Flow first. Click Filter to confirm the table shows the rows you want to remove.',false);
    return;
  }
  if(!confirm('Erase every job that matches the current filters (up to 5000), same rules as the table below? This cannot be undone.'))return;
  try{
    var r=await cafFetch('/v1/admin/jobs/delete-matching-filters',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
    var d=await r.json().catch(function(){return{};});
    if(!r.ok||!d.ok)throw new Error(d.message||d.error||('HTTP '+r.status));
    var extra=d.cap_hit?' (hit 5000 cap — run again if more remain)':'';
    if((d.content_jobs_deleted|0)===0){
      showToast('No jobs matched these filters (0 removed). Broaden Search or fix a typo in the run id.',false);
    }else{
      showToast('Removed '+d.content_jobs_deleted+' job row(s)'+extra,true);
    }
    jobDetailOpenTaskId=null;
    loadFacets().then(function(){return loadJobs(1);});
  }catch(err){showToast(err.message||String(err),false);}
}
async function deleteJobsForFilteredRun(){
  if(!JOB_SLUG){showToast('Select a project first (open /admin/jobs?project=YOUR_SLUG)',false);return;}
  var runEl=document.getElementById('f-run');
  var runId=runEl&&runEl.value?String(runEl.value).trim():'';
  if(!runId&&initRunId)runId=String(initRunId).trim();
  if(!runId){
    var s=String((document.getElementById('f-search')||{}).value||'').trim();
    if(s)runId=s;
  }
  if(!runId){
    showToast('Pick Run ID in the dropdown, or type the full run id in Search, or use “Erase matching filters” after Filter.',false);
    return;
  }
  if(!confirm('Permanently delete ALL jobs, drafts, audits, and assets linked to run id:\\n'+runId+'\\n\\n(Run and signal pack rows are not removed.)'))return;
  try{
    var r=await cafFetch('/v1/admin/jobs/delete-by-run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:JOB_SLUG,run_id:runId})});
    var d=await r.json().catch(function(){return{};});
    if(!r.ok||!d.ok)throw new Error(d.message||d.error||('HTTP '+r.status));
    var n=d.content_jobs_deleted|0;
    if(n===0){
      showToast('No jobs matched run id '+runId+' (0 removed). Check spelling (e.g. …UKAD vs …UKAI) or use “Erase matching filters” with Search + Filter.',false);
    }else{
      showToast('Removed '+n+' job row(s) for '+runId,true);
    }
    jobDetailOpenTaskId=null;
    loadFacets().then(function(){return loadJobs(1);});
  }catch(err){showToast(err.message||String(err),false);}
}
async function eraseJobByTaskId(tid){
  if(!JOB_SLUG){showToast('Select a project first',false);return;}
  tid=String(tid||'').trim();
  if(!tid){showToast('Missing task id. Reload the table with Filter.',false);return;}
  if(!confirm('Permanently erase this job and its drafts, audits, transitions, and assets?\\n\\n'+tid))return;
  try{
    var r=await cafFetch('/v1/admin/jobs/delete-one',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:JOB_SLUG,task_id:tid})});
    var d=await r.json().catch(function(){return{};});
    if(!r.ok||!d.ok)throw new Error(d.message||d.error||('HTTP '+r.status));
    showToast('Erased job ('+d.content_jobs_deleted+' row)',true);
    jobDetailOpenTaskId=null;
    loadFacets().then(function(){return loadJobs(jobsPage);});
  }catch(err){showToast(err.message||String(err),false);}
}
async function reprocessJobEntirely(ev,tid){
  if(ev)ev.stopPropagation();
  if(typeof window.cafFetch!=='function'){alert('cafFetch is missing. Hard-refresh this page (Ctrl+Shift+R).');return;}
  if(!JOB_SLUG){showToast('Pick a project in the sidebar, then open Jobs again.',false);return;}
  tid=String(tid||'').trim();
  if(!tid){showToast('Missing task id for this row. Click Filter to reload the table.',false);return;}
  if(!confirm('Re-run this job from scratch?\\n\\nClears generated output, QC, renders, and assets for this task, sets status to PLANNED, then runs LLM → QC → diagnostics → render again. Editorial review history is kept.\\n\\n'+tid))return;
  showToast('Sending re-run request…',true,4000);
  try{
    var r=await cafFetch('/v1/admin/jobs/reprocess-full',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:JOB_SLUG,task_id:tid})});
    var d=await r.json().catch(function(){return{};});
    if(r.status===202&&d.ok){
      showToast(d.message||('Re-run started for '+tid+'. The table will update as the pipeline runs; refresh if needed.'),true,28000);
      loadFacets().then(function(){return loadJobs(jobsPage,true);});
      return;
    }
    if(!r.ok||!d.ok){
      var detail=(d&&d.details)?JSON.stringify(d.details):'';
      throw new Error((d&&d.message)||(d&&d.error)||detail||('HTTP '+r.status));
    }
    showToast('Done — status: '+(d.status||'—'),true);
    loadFacets().then(function(){return loadJobs(jobsPage,true);});
  }catch(err){showToast(err.message||String(err),false,22000);}
}
async function resumeJob(ev,tid){
  if(ev)ev.stopPropagation();
  if(typeof window.cafFetch!=='function'){alert('cafFetch is missing. Hard-refresh this page (Ctrl+Shift+R).');return;}
  if(!JOB_SLUG){showToast('Pick a project in the sidebar, then open Jobs again.',false);return;}
  tid=String(tid||'').trim();
  if(!tid){showToast('Missing task id for this row. Click Filter to reload the table.',false);return;}
  showToast('Sending resume request…',true,4000);
  try{
    var r=await cafFetch('/v1/admin/jobs/resume',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:JOB_SLUG,task_id:tid})});
    var d=await r.json().catch(function(){return{};});
    if(r.status===202&&d.ok){
      showToast(d.message||('Resume started for '+tid+'. Refresh will show progress.'),true,24000);
      loadFacets().then(function(){return loadJobs(jobsPage,true);});
      return;
    }
    if(!r.ok||!d.ok){
      var detail=(d&&d.details)?JSON.stringify(d.details):'';
      throw new Error((d&&d.message)||(d&&d.error)||detail||('HTTP '+r.status));
    }
    showToast('Resume requested — status: '+(d.status||'—'),true);
    loadFacets().then(function(){return loadJobs(jobsPage,true);});
  }catch(err){showToast(err.message||String(err),false,22000);}
}
function reprocessOneJobEntirely(ev,ix){
  if(ev)ev.stopPropagation();
  reprocessJobEntirely(ev,jobRowTaskIds[ix]);
}
function resumeOneJob(ev,ix){
  if(ev)ev.stopPropagation();
  resumeJob(ev,jobRowTaskIds[ix]);
}
function eraseOneJob(ev,ix){
  if(ev)ev.stopPropagation();
  eraseJobByTaskId(jobRowTaskIds[ix]);
}
async function eraseAllJobsInProject(){
  if(!JOB_SLUG){showToast('Select a project first',false);return;}
  if(!confirm('Delete EVERY job in project '+JOB_SLUG+'? This ignores list filters and removes all pages of jobs. Runs and signal packs are not deleted.'))return;
  var typed=window.prompt('Type the project slug exactly to confirm ('+JOB_SLUG+'):');
  if(typed==null)return;
  if(String(typed).trim()!==JOB_SLUG){
    showToast('Slug did not match — cancelled',false);
    return;
  }
  try{
    var r=await cafFetch('/v1/admin/jobs/delete-all',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:JOB_SLUG,confirm_slug:String(typed).trim()})});
    var d=await r.json().catch(function(){return{};});
    if(!r.ok||!d.ok)throw new Error(d.message||d.error||('HTTP '+r.status));
    showToast('Erased '+d.content_jobs_deleted+' job row(s) for project '+JOB_SLUG,true);
    jobDetailOpenTaskId=null;
    loadFacets().then(function(){return loadJobs(1);});
  }catch(err){showToast(err.message||String(err),false);}
}
async function reworkPendingNeedsEdit(){
  if(!JOB_SLUG){showToast('Select a project first (open /admin/jobs?project=YOUR_SLUG)',false);return;}
  if(!confirm('Trigger rework for ALL pending NEEDS_EDIT jobs for '+JOB_SLUG+'?\\n\\nWork runs in the background (sequential). Refresh the table to watch progress.'))return;
  showToast('Sending rework queue…',true,5000);
  try{
    const r=await cafFetch('/v1/admin/rework/pending',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project_slug:JOB_SLUG,limit:200})});
    const d=await r.json().catch(()=>({}));
    if((r.status===202||r.ok)&&d.ok){
      showToast(d.message||('Queued '+(d.queued||0)+' rework job(s). Refresh the table; each job may take several minutes.'),true,32000);
      loadFacets().then(function(){return loadJobs(jobsPage,true);});
      return;
    }
    if(!r.ok||!d.ok){throw new Error((d&&d.message)||(d&&d.error)||('HTTP '+r.status));}
  }catch(err){
    showToast(err.message||String(err),false,22000);
  }
}
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
function compactReworkHistory(gp){
  try{
    var rh=gp&&gp.rework_history;
    if(!Array.isArray(rh)||!rh.length)return null;
    return rh.map(function(e){
      return { kind:e.kind, archived_at:e.archived_at, had_draft:!!e.draft_id };
    });
  }catch(e){return null;}
}
function renderJobDetailHtml(d){
  const j=d.job||{};
  var gen=prettyJson(j.generation_payload);
  if(gen.length>14000)gen=gen.slice(0,14000)+'\\n… truncated';
  var lines=[];
  lines.push('<div class="job-detail-toolbar" style="display:flex;gap:8px;align-items:center;margin:0 0 12px;flex-wrap:wrap">');
  lines.push('<button type="button" class="btn btn-sm" onclick="copyJobDetailFull(event)">Copy all for debug</button>');
  var rs=j.render_state||{};
  var canResume=(String(j.status||'').toUpperCase()==='RENDERING') && (String(rs.status||'').toLowerCase()==='pending' || String(rs.status||'').toLowerCase()==='in_progress');
  if(canResume){
    lines.push('<button type="button" class="btn-ghost btn-sm" style="border:1px solid var(--border)" onclick="event.stopPropagation();resumeJob(event,'+JSON.stringify(j.task_id||'')+')" title="Resume pipeline without clearing payload (picks up missing renders)">Resume</button>');
  }
  lines.push('<button type="button" class="btn-ghost btn-sm" style="border:1px solid var(--border)" onclick="event.stopPropagation();reprocessJobEntirely(event,'+JSON.stringify(j.task_id||'')+')" title="Clears output, QC, assets; runs LLM → QC → render again">Re-run entire pipeline</button>');
  lines.push('<button type="button" class="btn-ghost btn-sm" style="color:var(--red);border:1px solid var(--border)" onclick="event.stopPropagation();eraseJobByTaskId('+JSON.stringify(j.task_id||'')+')">Erase job</button>');
  lines.push('<span style="font-size:11px;color:var(--muted)">Same task_id for the job’s life; rework adds drafts + archived snapshots below</span>');
  lines.push('</div>');
  lines.push('<div class="job-h">Summary</div>');
  var sum={task_id:j.task_id,run_id:j.run_id,status:j.status,flow_type:j.flow_type,platform:j.platform,candidate_id:j.candidate_id,variation_name:j.variation_name,render_provider:j.render_provider,render_status:j.render_status,asset_id:j.asset_id,recommended_route:j.recommended_route,qc_status:j.qc_status,qc_block_reason:(d.qc_detail&&d.qc_detail.reason_short)||null,created_at:j.created_at,updated_at:j.updated_at};
  lines.push('<pre class="job-detail-pre">'+esc(prettyJson(sum))+'</pre>');
  if(d.qc_detail&&(d.qc_detail.passed===false||(d.qc_detail.blocking_count|0)>0||j.status==='BLOCKED'||String(j.qc_status||'').toUpperCase()==='FAIL')){
    lines.push('<div class="job-h">QC — why this job failed or was blocked</div>');
    lines.push('<pre class="job-detail-pre">'+esc(prettyJson(d.qc_detail))+'</pre>');
  }
  if(d.content_preview){
    lines.push('<div class="job-h">Content preview (carousel slides · video script/prompt · scene assembly)</div>');
    lines.push('<pre class="job-detail-pre">'+esc(prettyJson(d.content_preview))+'</pre>');
  }
  var crh=compactReworkHistory(j.generation_payload);
  if(crh&&crh.length){
    lines.push('<div class="job-h">Archived generations (rework_history)</div>');
    lines.push('<p style="font-size:12px;color:var(--muted);margin:0 0 8px">Snapshots taken before each full rework / override; full blobs stay inside generation_payload below.</p>');
    lines.push('<pre class="job-detail-pre">'+esc(prettyJson(crh))+'</pre>');
  }
  if(d.editorial_timeline&&d.editorial_timeline.length){
    lines.push('<div class="job-h">Human review timeline (newest first)</div>');
    lines.push('<p style="font-size:12px;color:var(--muted);margin:0 0 8px">Decisions and notes on this task_id. NEEDS_EDIT rows drive rework instructions.</p>');
    lines.push('<pre class="job-detail-pre">'+esc(prettyJson(d.editorial_timeline))+'</pre>');
  }
  if(d.drafts&&d.drafts.length){
    lines.push('<div class="job-h">LLM attempts (job_drafts)</div>');
    lines.push('<p style="font-size:12px;color:var(--muted);margin:0 0 8px">Each regeneration appends a row; same task_id.</p>');
    lines.push('<pre class="job-detail-pre">'+esc(prettyJson(d.drafts))+'</pre>');
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
  var h='<table class="jobs-main-table"><thead><tr><th>Task</th><th>Run</th><th>Platform</th><th>Flow</th><th>Status</th><th>Phase</th><th>Render</th><th>Error / last failure</th><th>Route</th><th>Score</th><th>QC</th><th>Updated</th><th style="white-space:nowrap">Actions</th></tr></thead><tbody>';
  for(var i=0;i<d.rows.length;i++){
    var j=d.rows[i];
    var rph=[j.render_provider,j.render_status,j.render_phase].filter(Boolean).join(' · ');
    var stJob=String(j.status||'').toUpperCase();
    if(stJob==='NEEDS_EDIT'){
      var rsl=String(j.render_status||'').toLowerCase();
      var rphLow=String(j.render_phase||'').toLowerCase();
      if(rsl==='completed'||rphLow.indexOf('completed')>=0)
        rph='prior render (reference) — not final · rework replaces';
      else
        rph='needs new render after rework · '+rph;
    }
    var isRendering=stJob==='RENDERING';
    var renderStatus=String(j.render_status||'').toLowerCase();
    var renderPhase=String(j.render_phase||'').toLowerCase();
    /** DB status can stay RENDERING if the worker died after writing render_state.failed; treat as failed in the list. */
    var badgeStatus=stJob;
    if (isRendering && renderPhase==='failed') badgeStatus='FAILED';
    var isFailedBadge=String(badgeStatus||'').toUpperCase()==='FAILED';
    var showResume=isRendering && (renderStatus==='pending' || renderStatus==='in_progress') && (renderPhase.indexOf('sora')>=0 || renderPhase.indexOf('heygen')>=0);
    h+='<tr class="job-row" onclick="toggleJobDetail('+i+')"><td class="mono" style="color:var(--accent)" title="'+escAttr(j.task_id)+'"><div class="job-cell-inner">'+esc(trunc(j.task_id,52))+' <span style="opacity:.5">▸</span></div></td>';
    h+='<td class="mono" style="font-size:11px" title="'+escAttr(j.run_id||"")+'"><div class="job-cell-inner">'+esc(j.run_id||'—')+'</div></td>';
    h+='<td>'+esc(j.platform||'—')+'</td><td style="font-size:12px">'+esc(j.flow_type||'—')+'</td>';
    h+='<td>'+badge(badgeStatus)+(isRendering&&renderPhase==='failed'?' <span style="font-size:10px;color:var(--muted)" title="Row still had status RENDERING in DB; render_state reports failed — re-run or erase">(render failed)</span>':'')+'</td>';
    h+='<td style="font-size:11px;line-height:1.35;color:var(--fg2);max-width:220px" title="'+escAttr(j.pipeline_phase||'')+'">'+esc(trunc(j.pipeline_phase||'—',120))+'</td>';
    h+='<td style="font-size:11px;color:var(--muted)">'+esc(rph||'—')+'</td>';
    h+='<td class="job-err-cell"><div class="job-err-inner"><span class="job-err-text" title="'+escAttr(j.last_error||'')+'">'+esc(trunc(j.last_error,200))+'</span>';
    if(j.last_error){
      h+='<button type="button" class="btn-ghost job-err-copy" title="Copy full error text" onclick="copyJobLastErr(event,'+i+')">Copy</button>';
    }
    h+='</div></td>';
    h+='<td style="font-size:12px">'+esc(j.recommended_route||'—')+(isFailedBadge&&String(j.recommended_route||'').toUpperCase()==='HUMAN_REVIEW'?' <span style="font-size:10px;color:var(--muted)" title="Planned route after QC if render had succeeded">(not reached)</span>':'')+'</td>';
    h+='<td>'+esc(j.pre_gen_score||'—')+'</td>';
    h+='<td>'+esc(j.qc_status||'—')+(isFailedBadge&&String(j.qc_status||'').toUpperCase()==='PASS'?' <span style="font-size:10px;color:var(--muted)" title="QC on LLM output passed; failure happened in a later step">(pre-render)</span>':'')+'</td>';
    h+='<td style="font-size:11px;color:var(--muted)">'+fmtDate(j.updated_at)+'</td>';
    h+='<td onclick="event.stopPropagation()" style="white-space:nowrap;vertical-align:middle"><div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;align-items:center">';
    if(showResume){
      h+='<button type="button" class="btn-ghost" style="font-size:10px;padding:4px 8px;border:1px solid var(--border)" onclick="resumeOneJob(event,'+i+')" title="Resume pipeline (no reset) — continues missing clips / mux">Resume</button>';
    }
    h+='<button type="button" class="btn-ghost" style="font-size:10px;padding:4px 8px;border:1px solid var(--border)" onclick="reprocessOneJobEntirely(event,'+i+')" title="Clear output/QC/renders/assets and run full pipeline again">Re-run</button><button type="button" class="btn-ghost" style="font-size:10px;padding:4px 8px;color:var(--red);border:1px solid var(--border)" onclick="eraseOneJob(event,'+i+')" title="Remove this job and related drafts, audits, assets">Erase</button></div></td></tr>';
    h+='<tr class="job-detail-row" id="job-detail-'+i+'" style="display:none" onclick="event.stopPropagation()"><td colspan="13"><div id="job-detail-body-'+i+'" class="job-detail-body" data-loaded="0" onclick="event.stopPropagation()"></div></td></tr>';
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
window.reprocessJobEntirely=reprocessJobEntirely;
window.reprocessOneJobEntirely=reprocessOneJobEntirely;
window.resumeJob=resumeJob;
window.resumeOneJob=resumeOneJob;
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
  document.getElementById('fe-dlg')?.remove();
  const dlg=document.createElement('dialog');
  dlg.id='fe-dlg';
  dlg.style.maxWidth='min(720px,96vw)';
  dlg.style.width='100%';
  let h='<h3>'+(data&&data.id?'Edit':'Add')+' '+type.replace(/-/g,' ')+'</h3>';
  h+='<form id="fe-form" class="config-form" style="max-width:100%;max-height:70vh;overflow-y:auto">';
  for(const f of fields){
    const v=data[f.k]!=null?data[f.k]:'';
    if(f.t==='checkbox')h+=fgCheck('fe_'+f.k,f.l,!!v);
    else if(f.ta)h+=fgTa('fe_'+f.k,f.l,v);
    else h+=fg('fe_'+f.k,f.l,v,f.t||'text',f.step);
  }
  h+='<div class="form-actions"><button type="submit" class="btn">Save</button> <button type="button" class="btn-ghost" onclick="document.getElementById(\\'fe-dlg\\').remove()">Cancel</button><span id="fe-msg" class="form-msg"></span></div>';
  h+='</form>';
  dlg.innerHTML=h;
  document.body.appendChild(dlg);
  if(typeof dlg.showModal==='function')dlg.showModal();else dlg.setAttribute('open','');
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

  app.get("/admin/prompt-labs", async (_, reply) => {
    const projects = await listProjects(db);
    const body = `
<div class="ph"><div><h2>Prompt labs</h2><span class="ph-sub">Flow Engine DB templates + runtime prompt layers (video duration, publishing fields, HeyGen agent)</span></div></div>
<div class="tabs" id="pl-tabs">
  <button type="button" class="tab active" onclick="plTab('pl-env',this)">Env &amp; tuning</button>
  <button type="button" class="tab" onclick="plTab('pl-tpl',this)">Prompts</button>
  <button type="button" class="tab" onclick="plTab('pl-heygen',this)">HeyGen agent</button>
  <button type="button" class="tab" onclick="plTab('pl-flow',this)">Flow definitions</button>
</div>
<div class="content" id="pl-root"><div class="empty">Loading…</div></div>
<script>
function plTab(id,btn){
  document.querySelectorAll('#pl-root .tab-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('#pl-tabs .tab').forEach(t=>t.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  btn.classList.add('active');
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function pre(txt){return '<pre class="mono-block" style="white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.45;background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:14px;max-height:420px;overflow:auto">'+esc(txt)+'</pre>';}
function trunc(s,n){s=String(s||'');return s.length>n?s.slice(0,n)+'…':s;}
function plFg(name,label,value,type,step){return '<div class="form-group"><label for="'+name+'">'+label+'</label><input type="'+(type||'text')+'" name="'+name+'" id="'+name+'" value="'+esc(value)+'"'+(step?' step="'+step+'"':'')+'></div>';}
function plFgTa(name,label,value){return '<div class="form-group"><label for="'+name+'">'+label+'</label><textarea name="'+name+'" id="'+name+'" rows="4">'+esc(value)+'</textarea></div>';}
function plVal(id){const el=document.getElementById(id);return el?String(el.value).trim():'';}
function plNum(id){const s=plVal(id);if(s==='')return null;const n=Number(s);return Number.isFinite(n)?n:null;}
function plOpenPromptEdit(ix){
  const data=window.__PL_TEMPLATES[ix];
  if(!data)return;
  const dlg=document.createElement('dialog');
  dlg.id='pl-prompt-dlg';
  dlg.style.maxWidth='min(920px,96vw)';
  dlg.style.width='100%';
  let h='<h3 style="margin-bottom:12px">Edit prompt template</h3><p style="font-size:12px;color:var(--muted);margin-bottom:14px">Saves to <span class="mono">caf_core.prompt_templates</span>. Use <strong>Description (notes)</strong> for what this prompt does in your team.</p><form id="pl-prompt-form" class="config-form" style="max-width:100%">';
  h+=plFg('pl_prompt_name','Prompt Name',data.prompt_name||'','text');
  h+=plFg('pl_flow_type','Flow Type',data.flow_type||'','text');
  h+=plFg('pl_prompt_role','Prompt Role',data.prompt_role||'','text');
  h+=plFgTa('pl_system_prompt','System prompt',data.system_prompt||'');
  h+=plFgTa('pl_user_prompt_template','User prompt template',data.user_prompt_template||'');
  h+=plFgTa('pl_output_format_rule','Output format rule',data.output_format_rule||'');
  h+=plFg('pl_schema_name','Output schema name',data.output_schema_name||'','text');
  h+=plFg('pl_schema_version','Output schema version',data.output_schema_version||'','text');
  h+=plFg('pl_temperature_default','Temperature',data.temperature_default!=null?String(data.temperature_default):'','number','0.01');
  h+=plFg('pl_max_tokens_default','Max tokens',data.max_tokens_default!=null?String(data.max_tokens_default):'','number');
  h+=plFg('pl_stop_sequences','Stop sequences',data.stop_sequences||'','text');
  h+=plFgTa('pl_notes','Description (notes)',data.notes||'');
  h+='<div class="form-actions"><button type="submit" class="btn">Save</button> <button type="button" class="btn-ghost" id="pl-prompt-cancel">Cancel</button><span id="pl-prompt-msg" class="form-msg"></span></div></form>';
  dlg.innerHTML=h;
  document.body.appendChild(dlg);
  document.getElementById('pl-prompt-cancel').onclick=function(){dlg.remove();};
  document.getElementById('pl-prompt-form').addEventListener('submit',async function(ev){
    ev.preventDefault();
    const body={
      prompt_name:plVal('pl_prompt_name'),
      flow_type:plVal('pl_flow_type'),
      prompt_role:plVal('pl_prompt_role')||null,
      system_prompt:plVal('pl_system_prompt')||null,
      user_prompt_template:plVal('pl_user_prompt_template')||null,
      output_format_rule:plVal('pl_output_format_rule')||null,
      output_schema_name:plVal('pl_schema_name')||null,
      output_schema_version:plVal('pl_schema_version')||null,
      temperature_default:plNum('pl_temperature_default'),
      max_tokens_default:plNum('pl_max_tokens_default'),
      stop_sequences:plVal('pl_stop_sequences')||null,
      notes:plVal('pl_notes')||null,
      active:true
    };
    const msg=document.getElementById('pl-prompt-msg');
    msg.textContent='Saving…';msg.style.color='var(--accent)';
    try{
      const res=await cafFetch('/v1/admin/flow-engine/prompt-tpl',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const j=await res.json();
      if(j.ok){msg.textContent='Saved';msg.style.color='var(--green)';setTimeout(function(){dlg.remove();loadPL();},600);}
      else{msg.textContent=j.error||'Failed';msg.style.color='var(--red)';}
    }catch(err){msg.textContent=String(err.message||err);msg.style.color='var(--red)';}
  });
  dlg.showModal();
}
function plRenderAddendumCard(key,meta,value){
  const m=meta[key]||{title:key,description:''};
  let out='<div class="card" style="margin-bottom:14px"><div class="card-h">'+esc(m.title||key)+'</div><div style="padding:0 4px 8px">';
  out+='<p style="font-size:13px;color:var(--fg2);line-height:1.5;margin-bottom:10px">'+esc(m.description||'')+'</p>';
  out+='<p style="font-size:11px;color:var(--muted);margin:0 0 8px">Composed at runtime from code + Env &amp; tuning values — edit on the <strong>Env &amp; tuning</strong> tab.</p>';
  out+=pre(value||'');
  out+='</div></div>';
  return out;
}
function plRenderPromptCard(p,globalIx){
  const prev=(p.user_prompt_template||'').replace(/\\s+/g,' ').slice(0,220);
  let out='<div style="border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px;background:var(--card2)">';
  out+='<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px">';
  out+='<div><span class="mono" style="font-weight:600;color:var(--accent)">'+esc(p.prompt_name)+'</span> <span style="color:var(--muted);font-size:12px">· '+esc(p.flow_type)+'</span>';
  out+=' <span class="badge '+(p.active!==false?'badge-g':'badge-r')+'" style="font-size:10px">'+(p.active!==false?'active':'off')+'</span></div>';
  out+='<button type="button" class="btn btn-sm" onclick="plOpenPromptEdit('+globalIx+')">Edit</button></div>';
  out+='<p style="font-size:12px;color:var(--muted);margin:0 0 6px">Role: <strong>'+esc(p.prompt_role||'—')+'</strong></p>';
  out+='<p style="font-size:13px;line-height:1.5;margin:0 0 8px;color:var(--fg)">'+esc(p.labs_short_description||'')+'</p>';
  if(p.labs_flow_description)out+='<p style="font-size:11px;color:var(--muted);margin:0 0 8px">Flow definition: '+esc(trunc(p.labs_flow_description,280))+'</p>';
  out+='<p style="font-size:11px;color:var(--fg2);margin:0"><span style="color:var(--muted)">User template preview:</span> '+esc(prev)+(p.user_prompt_template&&p.user_prompt_template.length>220?'…':'')+'</p>';
  out+='</div>';
  return out;
}
async function loadPL(){
  const root=document.getElementById('pl-root');
  const r=await cafFetch('/v1/admin/prompt-labs'); const d=await r.json();
  if(!d.ok){root.innerHTML='<div class="empty">Failed to load prompt labs</div>';return;}
  const e=d.env_tuning||{};
  const envHints=d.env_hints||{};
  const c=d.core_addenda||{};
  const meta=d.core_layer_meta||{};
  const h=d.heygen_video_agent||{};
  const heygenFlowSet=new Set(d.heygen_flow_types||['Video_Script_Generator','Video_Prompt_Generator']);
  const coreOrder=['publication_system_addendum','video_script_system_suffix','video_prompt_system_suffix','scene_assembly_system_suffix','user_footer_script_json','user_footer_video_plan'];
  const heygenAddendumKeys=coreOrder.filter(function(k){return (meta[k]&&meta[k].bucket==='heygen');});
  const generalAddendumKeys=coreOrder.filter(function(k){return k in c && !(meta[k]&&meta[k].bucket==='heygen');});

  let html='';

  // ── Env & tuning ──────────────────────────────────────────────────────
  html+='<div id="pl-env" class="tab-panel active"><div class="card"><div class="card-h">Environment-backed knobs (config / .env)</div>';
  html+='<p style="color:var(--muted);margin-bottom:12px">These knobs drive the runtime prompt addenda (duration band, scene counts). Change values in deployment env or <code>.env</code>, then restart the API.</p>';
  html+='<table><thead><tr><th>Variable</th><th>Value</th><th>What it does</th></tr></thead><tbody>';
  for(const k of Object.keys(e)){
    html+='<tr><td class="mono">'+esc(k)+'</td><td><strong>'+esc(String(e[k]))+'</strong></td><td style="font-size:12px;color:var(--fg2);max-width:360px">'+esc((envHints[k]&&(envHints[k].description||envHints[k]))||'—')+'</td></tr>';
  }
  html+='</tbody></table></div></div>';

  // ── Prompts (merged: all non-HeyGen Flow Engine templates + non-HeyGen addenda) ──
  const pt=d.prompt_templates||[];
  window.__PL_TEMPLATES=pt;
  const generalPrompts=[];
  const heygenPrompts=[];
  for(let i=0;i<pt.length;i++){
    const p=pt[i];
    const isHey=(p.labs_is_heygen===true)||heygenFlowSet.has(p.flow_type);
    (isHey?heygenPrompts:generalPrompts).push({p:p,ix:i});
  }

  html+='<div id="pl-tpl" class="tab-panel">';
  html+='<div class="card" style="margin-bottom:14px"><div class="card-h">Prompt templates ('+generalPrompts.length+')</div>';
  html+='<p style="color:var(--muted);margin-bottom:14px;font-size:13px">Every Flow Engine prompt template that is <em>not</em> part of the HeyGen path. Edit saves to <span class="mono">caf_core.prompt_templates</span>. HeyGen-flow prompts live on the <strong>HeyGen agent</strong> tab.</p>';
  if(generalPrompts.length){
    for(const row of generalPrompts) html+=plRenderPromptCard(row.p,row.ix);
  }else html+='<div class="empty">No rows</div>';
  html+='<p style="margin-top:6px"><a class="btn btn-sm" href="/admin/flow-engine">Flow Engine (all entity types)</a></p></div>';

  if(generalAddendumKeys.length){
    html+='<div class="card" style="margin-bottom:14px"><div class="card-h">Runtime addenda (applied to the generic prompts above)</div>';
    html+='<p style="color:var(--muted);margin-bottom:12px;font-size:13px">These are computed at runtime from code + <strong>Env &amp; tuning</strong>. They wrap whatever the Flow Engine template produces.</p>';
    for(const key of generalAddendumKeys) html+=plRenderAddendumCard(key,meta,c[key]);
    html+='</div>';
  }
  html+='</div>';

  // ── HeyGen agent (rubric + HeyGen-flow prompt templates + HeyGen addenda) ──
  html+='<div id="pl-heygen" class="tab-panel">';
  html+='<div class="card" style="margin-bottom:14px"><div class="card-h">HeyGen Video Agent — rubric</div>';
  html+='<p style="font-size:13px;color:var(--fg2);line-height:1.55;margin-bottom:10px">'+esc(h.intro||'')+'</p>';
  html+='<p style="color:var(--muted);margin-bottom:10px;font-size:12px">'+esc(h.note||'')+'</p>';
  html+='<p style="font-size:12px;font-weight:600;margin-bottom:6px">Rubric lines (prepended to every agent prompt)</p>';
  html+='<ul style="margin-left:18px;line-height:1.6;font-size:13px">';
  (h.rubric_lines||[]).forEach(function(line){html+='<li>'+esc(line)+'</li>';});
  html+='</ul>';
  html+='<p style="font-size:11px;color:var(--muted);margin-top:10px">Rubric lines are defined in <span class="mono">src/services/heygen-renderer.ts</span>.</p>';
  html+='</div>';

  html+='<div class="card" style="margin-bottom:14px"><div class="card-h">HeyGen-flow prompt templates ('+heygenPrompts.length+')</div>';
  html+='<p style="color:var(--muted);margin-bottom:14px;font-size:13px">Flow Engine prompt templates whose <span class="mono">flow_type</span> feeds the HeyGen path (script-led <span class="mono">Video_Script_Generator</span> and prompt-led <span class="mono">Video_Prompt_Generator</span>). All fields editable.</p>';
  if(heygenPrompts.length){
    for(const row of heygenPrompts) html+=plRenderPromptCard(row.p,row.ix);
  }else html+='<div class="empty">No HeyGen-flow prompt templates. Seed them from <a href="/admin/flow-engine">Flow Engine</a>.</div>';
  html+='</div>';

  if(heygenAddendumKeys.length){
    html+='<div class="card" style="margin-bottom:14px"><div class="card-h">HeyGen runtime addenda (applied to the templates above)</div>';
    html+='<p style="color:var(--muted);margin-bottom:12px;font-size:13px">Duration-band policy and user-prompt hard footer appended automatically at generation time.</p>';
    for(const key of heygenAddendumKeys) html+=plRenderAddendumCard(key,meta,c[key]);
    html+='</div>';
  }
  html+='</div>';

  // ── Flow definitions ──────────────────────────────────────────────────
  const fd=d.flow_definitions||[];
  html+='<div id="pl-flow" class="tab-panel"><div class="card"><div class="card-h">Flow definitions ('+fd.length+')</div>';
  html+='<p style="color:var(--muted);margin-bottom:12px;font-size:13px">Describes each <span class="mono">flow_type</span> for operators. Edit definitions on <a href="/admin/flow-engine">Flow Engine</a> → Flow Definitions.</p>';
  if(fd.length){
    html+='<div style="overflow-x:auto"><table><thead><tr><th>Flow type</th><th>Category</th><th>Description</th><th>Schema</th></tr></thead><tbody>';
    for(const f of fd){
      html+='<tr><td class="mono" style="font-size:12px">'+esc(f.flow_type)+'</td><td>'+esc(f.category||'—')+'</td><td style="font-size:12px;max-width:320px;color:var(--fg2)">'+esc(trunc(f.description||'—',200))+'</td><td class="mono" style="font-size:10px">'+esc((f.output_schema_name||'')+' '+(f.output_schema_version||''))+'</td></tr>';
    }
    html+='</tbody></table></div>';
  }else html+='<div class="empty">No rows</div>';
  html+='</div></div>';

  root.innerHTML=html;
}
loadPL();
</script>`;
    reply.type("text/html").send(page("Prompt labs", "prompt-labs", body, projects, "", adminHeadTokenScript(config)));
  });

  // --- Carousel templates (list DB rows + preview via renderer + edit metadata) ---
  app.get("/admin/carousel-templates", async (_, reply) => {
    const projects = await listProjects(db);
    const ctProjectsJson = JSON.stringify(
      projects.map((p) => ({
        slug: p.slug,
        display_name: (p.display_name && String(p.display_name).trim()) || p.slug,
      }))
    );
    const body = `
<div class="ph"><div><h2>Carousel templates</h2><span class="ph-sub">Map logical template keys to renderer <code>.hbs</code> files, preview slide 1, edit metadata</span></div></div>
<div class="content" id="ct-root"><div class="empty">Loading…</div></div>
<script>
window.__CT_PROJECTS=${ctProjectsJson};
function ctEsc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function ctVal(id){const el=document.getElementById(id);return el?String(el.value).trim():'';}
function ctNum(id){const s=ctVal(id);if(s==='')return null;const n=Number(s);return Number.isFinite(n)?n:null;}
function ctFg(name,label,value,type,step){return '<div class="form-group"><label for="'+name+'">'+label+'</label><input type="'+(type||'text')+'" name="'+name+'" id="'+name+'" value="'+ctEsc(value)+'"'+(step?' step="'+step+'"':'')+'></div>';}
function ctFgTa(name,label,value,rows){return '<div class="form-group"><label for="'+name+'">'+label+'</label><textarea name="'+name+'" id="'+name+'" rows="'+(rows||4)+'">'+ctEsc(value)+'</textarea></div>';}
/** Safe DOM id fragment for .hbs filenames (ctEsc breaks ids when names contain & etc.). */
function ctIdSafe(name){return String(name==null?'':name).replace(/[^a-zA-Z0-9._-]/g,'_');}

/** Absolute API URL so fetch is not affected by &lt;base href&gt; or odd relative resolution. */
function ctApiUrl(path){
  try{ return new URL(path, window.location.origin).href; }catch(_){ return path; }
}

async function ctFetchJson(url,timeoutMs){
  var ms=timeoutMs||30000;
  var c=new AbortController();
  var t=setTimeout(function(){try{c.abort();}catch(_){}},ms);
  try{
    var res=await cafFetch(url,{signal:c.signal});
    var j=null;
    try{ j=await res.json(); }catch(_){ j=null; }
    return {ok:res.ok,status:res.status,json:j};
  }finally{ clearTimeout(t); }
}

async function ctAddToProject(btn, htmlName){
  var card=btn&&btn.closest?btn.closest('.ct-card'):null;
  var sel=card?card.querySelector('[data-ct-project-select]'):null;
  var msgEl=card?card.querySelector('[data-ct-pin-msg]'):null;
  var slug=sel?String(sel.value||'').trim():'';
  if(!slug){ if(msgEl){msgEl.textContent='Choose a project first';msgEl.style.color='var(--red)';} return; }
  if(msgEl){msgEl.textContent='Saving…';msgEl.style.color='var(--muted)';}
  try{
    var res=await cafFetch(ctApiUrl('/v1/admin/config/project-carousel-template'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({_project:slug,html_template_name:htmlName}),credentials:'same-origin'});
    var txt=await res.text();
    var j={};
    try{ j=txt?JSON.parse(txt):{}; }catch(_){ j={ok:false,error:txt||'Bad response'}; }
    if(!res.ok||!j.ok){
      var errMsg=(j&&j.error)||('HTTP '+res.status);
      if(msgEl){msgEl.textContent=errMsg;msgEl.style.color='var(--red)';}
      console.error('ctAddToProject failed',res.status,j,txt);
      return;
    }
    if(msgEl){msgEl.textContent='Added to '+slug;msgEl.style.color='var(--green)';}
  }catch(err){
    if(msgEl){msgEl.textContent=String(err&&err.message||err);msgEl.style.color='var(--red)';}
    console.error('ctAddToProject',err);
  }
}

async function ctLoad(){
  var root=document.getElementById('ct-root');
  if(!root){ return; }
  root.innerHTML='<div class="empty">Loading…</div>';
  var dbRows=[];
  var fileTemplates=[];
  try{
    try{
      var fe=await ctFetchJson('/v1/admin/flow-engine',45000);
      var fj=fe.json||{};
      if(fj && fj.ok && Array.isArray(fj.carousel_templates)) dbRows=fj.carousel_templates;
      else if(Array.isArray(fj && fj.carousel_templates)) dbRows=fj.carousel_templates;
    }catch(e){ console.warn('carousel-templates flow-engine',e); }
    try{
      var fr=await ctFetchJson('/v1/admin/carousel-template-list',15000);
      var fd=fr.json||{};
      if(fd && fd.ok && Array.isArray(fd.templates)) fileTemplates=fd.templates;
    }catch(e){ console.warn('carousel-templates list',e); }
    window.__CT_DB_ROWS=dbRows;

    var byHtml={};
    for(var i=0;i<dbRows.length;i++){
      var r=dbRows[i];
      if(r && r.html_template_name){ (byHtml[r.html_template_name]=byHtml[r.html_template_name]||[]).push(r); }
    }
    var fileSet=new Set(fileTemplates);
    var orphanDbRows=dbRows.filter(function(r){return r && r.html_template_name && !fileSet.has(r.html_template_name);});

    var html='';
    html+='<div style="display:flex;gap:10px;flex-wrap:wrap;margin:4px 0 14px">';
    html+='<button type="button" class="btn btn-sm" onclick="ctOpenEdit(null)">+ New template mapping</button>';
    html+='<span style="color:var(--muted);font-size:12px;align-self:center">'+fileTemplates.length+' <code>.hbs</code> files · '+dbRows.length+' DB mappings</span>';
    html+='</div>';
    html+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px">';
    if(!fileTemplates.length){
      html+='<div class="empty" style="grid-column:1/-1">No <code>.hbs</code> files from the renderer. Set <code>RENDERER_BASE_URL</code> to your carousel renderer and ensure <code>GET /templates</code> lists <code>.hbs</code> files (or bundle templates under <code>CAROUSEL_TEMPLATES_DIR</code> on Core for template source).</div>';
    }
    for(var j=0;j<fileTemplates.length;j++){
      var name=fileTemplates[j];
      var rows=byHtml[name]||[];
      var idSuffix=ctIdSafe(name);
      html+='<div class="card ct-card" data-ct-name="'+ctEsc(name)+'" data-ct-id="'+ctEsc(idSuffix)+'" style="padding:14px;display:flex;flex-direction:column">';
      html+=ctSliderMarkup(name,idSuffix);
      html+='<div style="display:flex;flex-direction:column;gap:4px;margin-bottom:10px">';
      html+='<span class="mono" style="font-weight:600;color:var(--accent);word-break:break-all">'+ctEsc(name)+'</span>';
      if(rows.length){
        html+='<span style="font-size:11px;color:var(--muted)">Keys: '+rows.map(function(r){return '<code>'+ctEsc(r.template_key)+'</code>';}).join(', ')+'</span>';
        var plats=Array.from(new Set(rows.map(function(r){return r.platform||'—';}))).join(' · ');
        html+='<span style="font-size:11px;color:var(--muted)">Platform: '+ctEsc(plats)+'</span>';
      }else{
        html+='<span class="badge badge-y" style="font-size:10px;align-self:flex-start">No DB mapping</span>';
      }
      html+='</div>';
      html+='<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:auto">';
      html+='<button type="button" class="btn-ghost btn-sm" onclick="ctReloadCard('+JSON.stringify(name)+')" title="Re-render all 3 slides">Reload</button>';
      html+='<button type="button" class="btn-ghost btn-sm" onclick="ctShowSource('+JSON.stringify(name)+')">Source</button>';
      if(rows.length && rows[0] && rows[0].template_key!=null){
        html+='<button type="button" class="btn-ghost btn-sm" onclick="ctOpenEditByKey('+JSON.stringify(rows[0].template_key)+')">Edit mapping</button>';
      }else{
        html+='<button type="button" class="btn-ghost btn-sm" onclick="ctOpenEditWithHtml('+JSON.stringify(name)+')">+ Add mapping</button>';
      }
      html+='</div>';
      html+='<div style="margin-top:10px;padding-top:12px;border-top:1px solid var(--border)">';
      html+='<div style="font-size:11px;color:var(--muted);margin-bottom:6px">Pin for project <span style="opacity:.85">(also listed under Project Config → Carousel templates)</span></div>';
      html+='<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">';
      html+='<select data-ct-project-select="1" id="ct-proj-sel-'+ctEsc(idSuffix)+'" style="flex:1;min-width:150px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--card2);color:var(--fg);font-size:12px">';
      html+='<option value="">— Project —</option>';
      var pjList=window.__CT_PROJECTS||[];
      for(var pi=0;pi<pjList.length;pi++){
        var pj=pjList[pi];
        html+='<option value="'+ctEsc(pj.slug)+'">'+ctEsc(pj.display_name||pj.slug)+'</option>';
      }
      html+='</select>';
      html+='<button type="button" class="btn btn-sm" data-ct-add-to-project="1" data-ct-tpl="'+encodeURIComponent(name)+'">Add to project</button>';
      html+='</div>';
      html+='<div data-ct-pin-msg="1" id="ct-pin-msg-'+ctEsc(idSuffix)+'" style="font-size:11px;margin-top:6px;min-height:14px"></div>';
      html+='</div>';
      html+='</div>';
    }
    html+='</div>';

    if(orphanDbRows.length){
      html+='<div class="card" style="margin-top:18px"><div class="card-h">DB mappings without <code>.hbs</code> file ('+orphanDbRows.length+')</div>';
      html+='<p style="color:var(--muted);font-size:12px;margin-bottom:10px">These rows reference a renderer template that does not exist on the renderer. Either upload the file to <code>services/renderer/templates/</code> or delete / re-point the mapping.</p>';
      html+='<table><thead><tr><th>Key</th><th>Platform</th><th>Engine</th><th>HTML name</th><th></th></tr></thead><tbody>';
      for(var k=0;k<orphanDbRows.length;k++){
        var or=orphanDbRows[k];
        html+='<tr><td class="mono">'+ctEsc(or.template_key)+'</td><td>'+ctEsc(or.platform||'—')+'</td><td>'+ctEsc(or.engine||'—')+'</td><td class="mono">'+ctEsc(or.html_template_name||'—')+'</td><td><button type="button" class="btn-ghost btn-sm" onclick="ctOpenEditByKey('+JSON.stringify(or.template_key)+')">Edit</button></td></tr>';
      }
      html+='</tbody></table></div>';
    }
    root.innerHTML=html;
    ctObserveCards();
  }catch(err){
    root.innerHTML='<div class="empty" style="color:var(--red);max-width:720px">Could not load carousel templates. '+ctEsc(String(err&&err.message||err))+'</div><p class="empty" style="font-size:12px;color:var(--muted);margin-top:8px">If this persists, open DevTools → Network and check <code>/v1/admin/flow-engine</code> (DB) and <code>/v1/admin/carousel-template-list</code> (renderer proxy).</p>';
    console.error(err);
  }
}

// 3-slide preview: cover (slide_index 1), first body (2), CTA (4 — sample data has cover + 2 body + cta).
var CT_SLOTS=[
  {label:'Cover', idx:1},
  {label:'Body',  idx:2},
  {label:'CTA',   idx:4}
];
// Slide state lives in the DOM (data-state attr). Persistent caching is delegated to:
//   - the browser HTTP cache (Cache-Control: public, max-age=86400, immutable on the GET endpoint), and
//   - the renderer's deterministic on-disk cache (__previews__/<template>/<NNN>_slide.png).
// We only keep an in-memory dedupe set + priority queue here so first paint does covers-first
// across all visible cards instead of the natural document order.
var CT_DONE={};         // key 'name|idx' -> 'loaded' | 'error'
var CT_QUEUE=[];        // {name,idx,priority,bust}
var CT_INFLIGHT=0;
var CT_MAX_INFLIGHT=3;
var CT_LOADED_CARDS={}; // name -> true once cover is in flight (avoid re-triggering on observer churn)

function ctPreviewUrl(name, idx, bust){
  var qs='template='+encodeURIComponent(name)+'&slide_index='+encodeURIComponent(idx);
  if(bust){ qs+='&force=1&v='+encodeURIComponent(bust); }
  return '/v1/admin/carousel-template-preview?'+qs;
}

function ctSliderMarkup(name,idSuffix){
  var stage='<div class="ct-slider-stage" id="ct-slide-stage-'+ctEsc(idSuffix)+'" style="position:relative;width:100%;height:100%">';
  for(var s=0;s<CT_SLOTS.length;s++){
    var first=(s===0);
    stage+='<div class="ct-slide" data-slot="'+s+'" data-state="pending" id="ct-slide-'+ctEsc(idSuffix)+'-'+s+'" style="position:absolute;inset:0;display:'+(first?'flex':'none')+';align-items:center;justify-content:center;text-align:center">';
    stage+='<div class="ct-slide-msg" style="font-size:11px;color:var(--muted);padding:0 10px">'+(first?'Loading…':'—')+'</div>';
    stage+='</div>';
  }
  stage+='</div>';

  // idSuffix has been filtered to [a-zA-Z0-9._-] by ctIdSafe — safe to wrap in single quotes
  // inside an onclick="..." attribute (no escaping needed).
  var idArg="'"+idSuffix+"'";
  var nav='';
  nav+='<button type="button" class="ct-nav" aria-label="Previous slide" onclick="event.stopPropagation();ctNav('+idArg+',-1)" style="position:absolute;left:6px;top:50%;transform:translateY(-50%);width:26px;height:26px;border-radius:50%;border:1px solid var(--border);background:rgba(0,0,0,.55);color:#fff;cursor:pointer;line-height:1;padding:0;font-size:16px;display:flex;align-items:center;justify-content:center">‹</button>';
  nav+='<button type="button" class="ct-nav" aria-label="Next slide" onclick="event.stopPropagation();ctNav('+idArg+',+1)" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);width:26px;height:26px;border-radius:50%;border:1px solid var(--border);background:rgba(0,0,0,.55);color:#fff;cursor:pointer;line-height:1;padding:0;font-size:16px;display:flex;align-items:center;justify-content:center">›</button>';

  var dots='<div class="ct-dots" id="ct-dots-'+ctEsc(idSuffix)+'" style="position:absolute;bottom:8px;left:50%;transform:translateX(-50%);display:flex;gap:6px;background:rgba(0,0,0,.35);padding:5px 8px;border-radius:999px">';
  for(var d=0;d<CT_SLOTS.length;d++){
    var active=(d===0);
    dots+='<button type="button" data-dot="'+d+'" title="'+ctEsc(CT_SLOTS[d].label)+'" onclick="event.stopPropagation();ctGoto('+idArg+','+d+')" style="width:7px;height:7px;border-radius:50%;border:1px solid rgba(255,255,255,.6);background:'+(active?'#fff':'transparent')+';padding:0;cursor:pointer"></button>';
  }
  dots+='</div>';

  var label='<div class="ct-slide-label" id="ct-slide-label-'+ctEsc(idSuffix)+'" style="position:absolute;top:8px;left:8px;font-size:10px;color:#fff;background:rgba(0,0,0,.55);padding:2px 8px;border-radius:999px;letter-spacing:.04em;text-transform:uppercase">'+ctEsc(CT_SLOTS[0].label)+'</div>';

  return '<div class="ct-prev-wrap" data-ct-name="'+ctEsc(name)+'" data-ct-id="'+ctEsc(idSuffix)+'" data-current-slot="0" style="position:relative;aspect-ratio:4/5;background:repeating-linear-gradient(45deg,var(--card2),var(--card2) 10px,rgba(255,255,255,.02) 10px,rgba(255,255,255,.02) 20px);border:1px solid var(--border);border-radius:8px;margin-bottom:12px;overflow:hidden" id="ct-prev-wrap-'+ctEsc(idSuffix)+'">'+stage+nav+dots+label+'</div>';
}

function ctSlotElFor(name, idx){
  var slot=-1; for(var i=0;i<CT_SLOTS.length;i++){ if(CT_SLOTS[i].idx===idx){ slot=i; break; } }
  if(slot<0) return null;
  var ids=ctIdSafe(name);
  return { slot:slot, el:document.getElementById('ct-slide-'+ids+'-'+slot) };
}

function ctSetSlideMsg(name, idx, state, msg){
  var sl=ctSlotElFor(name, idx); if(!sl || !sl.el) return;
  sl.el.setAttribute('data-state', state);
  var color = state==='error' ? 'var(--red)' : 'var(--muted)';
  sl.el.innerHTML='<div class="ct-slide-msg" style="font-size:11px;color:'+color+';padding:0 10px;word-break:break-word">'+ctEsc(msg||'—')+'</div>';
}

function ctMountSlideImg(name, idx, img){
  var sl=ctSlotElFor(name, idx); if(!sl || !sl.el) return;
  sl.el.setAttribute('data-state','loaded');
  img.style.width='100%'; img.style.height='100%'; img.style.objectFit='contain';
  img.alt=name+' '+CT_SLOTS[sl.slot].label;
  sl.el.innerHTML='';
  sl.el.appendChild(img);
}

function ctRunNext(){
  while(CT_INFLIGHT<CT_MAX_INFLIGHT && CT_QUEUE.length){
    CT_QUEUE.sort(function(a,b){return b.priority-a.priority;});
    var t=CT_QUEUE.shift();
    var key=t.name+'|'+t.idx;
    // Already loaded into the DOM in this session and not a forced reload? Skip.
    if(!t.bust && CT_DONE[key]==='loaded'){ continue; }
    var sl=ctSlotElFor(t.name, t.idx);
    if(!sl || !sl.el){ continue; }
    CT_INFLIGHT++;
    ctSetSlideMsg(t.name, t.idx, 'loading', 'Rendering '+CT_SLOTS[sl.slot].label.toLowerCase()+'…');
    (function(task){
      var img=new Image();
      img.decoding='async';
      img.onload=function(){
        CT_DONE[task.name+'|'+task.idx]='loaded';
        ctMountSlideImg(task.name, task.idx, img);
        // Cover landed → kick off body + cta as background work (same bust value if any).
        if(task.idx===CT_SLOTS[0].idx){
          for(var s=1;s<CT_SLOTS.length;s++) ctQueueRender(task.name, CT_SLOTS[s].idx, 3, task.bust);
        }
        CT_INFLIGHT--; ctRunNext();
      };
      img.onerror=function(){
        // Cold-start of the renderer (Puppeteer warming up under load) can briefly 5xx/timeout.
        // Retry up to twice with backoff before giving up. Cache-bust each retry so we don't
        // hit a 5xx response cached by an intermediate.
        var attempts=(task.attempts||0)+1;
        if(attempts<=2){
          var delay=attempts===1?4000:12000;
          ctSetSlideMsg(task.name, task.idx, 'loading', 'Retrying ('+attempts+'/2)…');
          setTimeout(function(){
            CT_INFLIGHT--;
            ctQueueRender(task.name, task.idx, task.priority, Date.now(), attempts);
          }, delay);
          return;
        }
        CT_DONE[task.name+'|'+task.idx]='error';
        ctSetSlideMsg(task.name, task.idx, 'error', 'Render failed');
        CT_INFLIGHT--; ctRunNext();
      };
      img.src=ctPreviewUrl(task.name, task.idx, task.bust);
    })(t);
  }
}

function ctQueueRender(name, idx, priority, bust, attempts){
  var key=name+'|'+idx;
  if(!bust && CT_DONE[key]==='loaded'){ return; }
  // dedupe in queue — bump priority and adopt the strongest bust value if already queued
  for(var i=0;i<CT_QUEUE.length;i++){
    if(CT_QUEUE[i].name===name && CT_QUEUE[i].idx===idx){
      if(priority>CT_QUEUE[i].priority) CT_QUEUE[i].priority=priority;
      if(bust && (!CT_QUEUE[i].bust || bust>CT_QUEUE[i].bust)) CT_QUEUE[i].bust=bust;
      if(attempts && attempts>(CT_QUEUE[i].attempts||0)) CT_QUEUE[i].attempts=attempts;
      return;
    }
  }
  CT_QUEUE.push({name:name, idx:idx, priority:priority||1, bust:bust||0, attempts:attempts||0});
  ctRunNext();
}

function ctNav(idSuffix, dir){
  var wrap=document.getElementById('ct-prev-wrap-'+idSuffix);
  if(!wrap) return;
  var cur=Number(wrap.getAttribute('data-current-slot')||'0');
  var next=(cur+dir+CT_SLOTS.length)%CT_SLOTS.length;
  ctGoto(idSuffix,next);
}

function ctGoto(idSuffix, slot){
  var wrap=document.getElementById('ct-prev-wrap-'+idSuffix);
  if(!wrap) return;
  wrap.setAttribute('data-current-slot',String(slot));
  var stage=document.getElementById('ct-slide-stage-'+idSuffix);
  if(stage){
    var slides=stage.querySelectorAll('.ct-slide');
    for(var i=0;i<slides.length;i++) slides[i].style.display=(i===slot?'flex':'none');
  }
  var dotsEl=document.getElementById('ct-dots-'+idSuffix);
  if(dotsEl){
    var dots=dotsEl.querySelectorAll('[data-dot]');
    for(var k=0;k<dots.length;k++) dots[k].style.background=(k===slot?'#fff':'transparent');
  }
  var lab=document.getElementById('ct-slide-label-'+idSuffix);
  if(lab) lab.textContent=CT_SLOTS[slot].label;
  var name=wrap.getAttribute('data-ct-name');
  if(name){
    var idx=CT_SLOTS[slot].idx;
    var key=name+'|'+idx;
    // If this slot hasn't loaded yet (or errored), bump it past the background prefetch.
    if(CT_DONE[key]!=='loaded'){
      ctQueueRender(name, idx, 8);
    }
  }
}

function ctReloadCard(name){
  // Force-refresh: bypass renderer disk cache (force=1) AND browser cache (v=now).
  var bust=Date.now();
  for(var s=0;s<CT_SLOTS.length;s++){
    delete CT_DONE[name+'|'+CT_SLOTS[s].idx];
    ctSetSlideMsg(name, CT_SLOTS[s].idx, 'pending', s===0 ? 'Loading…' : '—');
  }
  ctQueueRender(name, CT_SLOTS[0].idx, 10, bust);
}

var CT_OBSERVER=null;
function ctObserveCards(){
  if(CT_OBSERVER){ try{ CT_OBSERVER.disconnect(); }catch(_){} CT_OBSERVER=null; }
  if(typeof IntersectionObserver==='undefined'){
    // Fallback: queue everything (slowly) — covers first.
    document.querySelectorAll('.ct-card').forEach(function(card){
      var name=card.getAttribute('data-ct-name'); if(name) ctQueueRender(name, CT_SLOTS[0].idx, 10);
    });
    return;
  }
  CT_OBSERVER=new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(!e.isIntersecting) return;
      var name=e.target.getAttribute('data-ct-name');
      if(!name || CT_LOADED_CARDS[name]) return;
      CT_LOADED_CARDS[name]=true;
      ctQueueRender(name, CT_SLOTS[0].idx, 10);
      CT_OBSERVER.unobserve(e.target);
    });
  },{ rootMargin:'200px 0px', threshold:0.05 });
  document.querySelectorAll('.ct-card').forEach(function(card){ CT_OBSERVER.observe(card); });
}

async function ctShowSource(name){
  let src='';
  try{
    const res=await cafFetch('/v1/admin/carousel-template-source?name='+encodeURIComponent(name));
    const j=await res.json();
    if(!res.ok || !j.ok){ alert(j.error||('Failed to load '+name)); return; }
    src=j.source||'';
  }catch(err){ alert(String(err && err.message || err)); return; }
  const dlg=document.createElement('dialog');
  dlg.style.maxWidth='min(980px,96vw)';
  dlg.style.width='100%';
  dlg.innerHTML='<h3 style="margin-bottom:12px">'+ctEsc(name)+' — Handlebars source</h3><p style="font-size:12px;color:var(--muted);margin-bottom:10px">Read-only view of the renderer <code>.hbs</code>. To change it, edit the file in <code>services/renderer/templates/</code> and redeploy.</p><pre class="mono-block" style="white-space:pre;overflow:auto;max-height:70vh;font-size:12px;background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:12px">'+ctEsc(src)+'</pre><div class="form-actions" style="margin-top:12px"><button type="button" class="btn-ghost" id="ct-src-close">Close</button></div>';
  document.body.appendChild(dlg);
  document.getElementById('ct-src-close').onclick=function(){dlg.remove();};
  dlg.showModal();
}

function ctOpenEdit(row){
  const data=row||{template_key:'',platform:'Instagram',default_slide_count:null,engine:'handlebars',html_template_name:'',adapter_key:null,notes:null,active:true};
  const dlg=document.createElement('dialog');
  dlg.style.maxWidth='min(720px,96vw)';
  dlg.style.width='100%';
  let h='<h3 style="margin-bottom:12px">'+(row?'Edit':'New')+' carousel template mapping</h3><p style="font-size:12px;color:var(--muted);margin-bottom:14px">Saves to <span class="mono">caf_core.carousel_templates</span>. <strong>HTML name</strong> must match a <code>.hbs</code> file served by the renderer.</p><form id="ct-form" class="config-form" style="max-width:100%">';
  h+=ctFg('ct_template_key','Template key (logical)',data.template_key||'');
  h+=ctFg('ct_platform','Platform',data.platform||'');
  h+=ctFg('ct_engine','Engine',data.engine||'handlebars');
  h+=ctFg('ct_html_template_name','HTML name (.hbs file)',data.html_template_name||'');
  h+=ctFg('ct_adapter_key','Adapter key',data.adapter_key||'');
  h+=ctFg('ct_default_slide_count','Default slide count',data.default_slide_count!=null?String(data.default_slide_count):'','number');
  h+=ctFgTa('ct_notes','Notes',data.notes||'',3);
  h+='<div class="form-actions"><button type="submit" class="btn">Save</button> <button type="button" class="btn-ghost" id="ct-cancel">Cancel</button>';
  if(row)h+=' <button type="button" class="btn-ghost" id="ct-delete" style="color:var(--red)">Delete</button>';
  h+='<span id="ct-msg" class="form-msg"></span></div></form>';
  dlg.innerHTML=h;
  document.body.appendChild(dlg);
  document.getElementById('ct-cancel').onclick=function(){dlg.remove();};
  if(row){
    document.getElementById('ct-delete').onclick=async function(){
      if(!confirm('Delete mapping "'+data.template_key+'"?')) return;
      try{
        const r=await cafFetch('/v1/admin/flow-engine/carousel-tpl/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({template_key:data.template_key})});
        const j=await r.json();
        if(j.ok){dlg.remove();ctLoad();}else alert(j.error||'Failed');
      }catch(err){alert(String(err.message||err));}
    };
  }
  document.getElementById('ct-form').addEventListener('submit',async function(ev){
    ev.preventDefault();
    const body={
      template_key:ctVal('ct_template_key'),
      platform:ctVal('ct_platform')||null,
      engine:ctVal('ct_engine')||null,
      html_template_name:ctVal('ct_html_template_name')||null,
      adapter_key:ctVal('ct_adapter_key')||null,
      default_slide_count:ctNum('ct_default_slide_count'),
      notes:ctVal('ct_notes')||null,
      active:true
    };
    const msg=document.getElementById('ct-msg');
    msg.textContent='Saving…';msg.style.color='var(--accent)';
    try{
      const res=await cafFetch('/v1/admin/flow-engine/carousel-tpl',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const j=await res.json();
      if(j.ok){msg.textContent='Saved';msg.style.color='var(--green)';setTimeout(function(){dlg.remove();ctLoad();},500);}
      else{msg.textContent=j.error||'Failed';msg.style.color='var(--red)';}
    }catch(err){msg.textContent=String(err.message||err);msg.style.color='var(--red)';}
  });
  dlg.showModal();
}
function ctOpenEditByKey(key){
  const row=(window.__CT_DB_ROWS||[]).find(function(r){return r.template_key===key;});
  ctOpenEdit(row||null);
}
function ctOpenEditWithHtml(name){
  ctOpenEdit({template_key:name.replace(/\\.hbs$/,''),platform:'Instagram',engine:'handlebars',html_template_name:name,default_slide_count:null});
}

(function(){
  var root=document.getElementById('ct-root');
  if(!root)return;
  root.addEventListener('click',function(ev){
    var t=ev.target;
    if(!t||!t.closest)return;
    var btn=t.closest('[data-ct-add-to-project]');
    if(!btn)return;
    ev.preventDefault();
    ev.stopPropagation();
    var enc=btn.getAttribute('data-ct-tpl');
    if(enc==null||enc==='')return;
    var tpl;
    try{ tpl=decodeURIComponent(enc); }catch(_){ return; }
    ctAddToProject(btn,tpl);
  });
})();

ctLoad();
</script>`;
    reply.type("text/html").send(page("Carousel templates", "carousel-templates", body, projects, "", adminHeadTokenScript(config)));
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
  <button class="tab" onclick="cfgTab('tab-product',this)">Product</button>
  <button class="tab" onclick="cfgTab('tab-constraints',this)">System Constraints</button>
  <button class="tab" onclick="cfgTab('tab-platforms',this)">Platform Constraints</button>
  <button class="tab" onclick="cfgTab('tab-carousels',this)">Carousel templates</button>
  <button class="tab" onclick="cfgTab('tab-flows',this)">Allowed Flow Types</button>
  <button class="tab" onclick="cfgTab('tab-risk',this)">Risk Rules</button>
  <button class="tab" onclick="cfgTab('tab-prompts',this)">Prompt Versions</button>
  <button class="tab" onclick="cfgTab('tab-refposts',this)">Reference Posts</button>
  <button class="tab" onclick="cfgTab('tab-heygen',this)">HeyGen Config</button>
  <button class="tab" onclick="cfgTab('tab-brand-assets',this)">Brand Assets</button>
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
  {k:'instagram_handle',l:'Instagram handle (carousel CTA, no @ required)'},
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

const PRODUCT_FIELD_GROUPS=[
  {title:'What the product is',fields:[
    {k:'product_name',l:'Product Name'},
    {k:'product_category',l:'Product Category (e.g. SaaS, course, mobile app, physical product)'},
    {k:'product_url',l:'Product URL'},
    {k:'one_liner',l:'One-liner (10–20 words)',ta:true},
    {k:'value_proposition',l:'Value proposition (what you give, to whom, with what outcome)',ta:true},
    {k:'elevator_pitch',l:'Elevator pitch (2–3 sentences)',ta:true},
  ]},
  {title:'Audience',fields:[
    {k:'primary_audience',l:'Primary audience',ta:true},
    {k:'audience_pain_points',l:'Audience pain points (concrete problems they have today)',ta:true},
    {k:'audience_desires',l:'Audience desires (what they wish were true instead)',ta:true},
    {k:'use_cases',l:'Top use cases / scenarios (1 per line)',ta:true},
    {k:'anti_audience',l:'Who this is NOT for (optional, helps sharpen targeting)',ta:true},
  ]},
  {title:'Why it is different',fields:[
    {k:'key_features',l:'Key features (1 per line — concrete, not abstract)',ta:true},
    {k:'key_benefits',l:'Key benefits (what the user gets out of each feature)',ta:true},
    {k:'differentiators',l:'Differentiators (why you, not them)',ta:true},
    {k:'proof_points',l:'Proof points (numbers, case studies, credentials)',ta:true},
    {k:'social_proof',l:'Social proof (testimonials, review highlights — verbatim where possible)',ta:true},
    {k:'competitors',l:'Competitors (comma-separated or 1 per line)',ta:true},
    {k:'comparison_angles',l:'Comparison angles (how you win in a head-to-head)',ta:true},
  ]},
  {title:'Commercial / offer',fields:[
    {k:'pricing_summary',l:'Pricing summary'},
    {k:'current_offer',l:'Current offer (discount, bonus, bundle)',ta:true},
    {k:'offer_urgency',l:'Urgency (deadline / scarcity hook, if any)'},
    {k:'guarantee',l:'Guarantee (refund, trial, warranty)'},
    {k:'primary_cta',l:'Primary CTA (e.g. "Start free trial")'},
    {k:'secondary_cta',l:'Secondary CTA (e.g. "Book a demo")'},
  ]},
  {title:'Language guardrails',fields:[
    {k:'do_say',l:'Always say / preferred phrasing',ta:true},
    {k:'dont_say',l:'Never say / forbidden phrasing',ta:true},
    {k:'taglines',l:'Approved taglines (1 per line)',ta:true},
    {k:'keywords',l:'SEO / talking-point keywords',ta:true},
  ]},
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
/**
 * Select field for inline admin config forms (flow-type heygen_mode, etc.).
 * options: [{v:'',l:'Default…'},{v:'script_led',l:'…'}]. Empty string "" means "use server default" (column NULL).
 */
function fgSel(name,label,value,options){
  var opts='';
  for(var i=0;i<options.length;i++){
    var o=options[i];
    var sel=String(value==null?'':value)===String(o.v)?' selected':'';
    opts+='<option value="'+esc(o.v)+'"'+sel+'>'+esc(o.l)+'</option>';
  }
  return '<div class="form-group"><label for="'+name+'">'+label+'</label>'
    +'<select name="'+name+'" id="'+name+'">'+opts+'</select></div>';
}

function cfgTab(id,btn){
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('#config-tabs .tab').forEach(t=>t.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  btn.classList.add('active');
}

async function cfgRemoveCarouselTemplate(htmlName){
  if(!confirm('Remove '+htmlName+' from this project?')) return;
  try{
    const r=await cafFetch('/v1/admin/config/project-carousel-template/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({_project:SLUG,html_template_name:htmlName})});
    const txt=await r.text();
    let j={}; try{ j=txt?JSON.parse(txt):{}; }catch(_){ j={ok:false}; }
    if(!r.ok||!j.ok){ alert((j&&j.error)||txt||'Failed'); return; }
    loadConfig();
  }catch(e){ alert(String(e&&e.message||e)); }
}

function cfgCarouselPickAll(on){
  var box=document.getElementById('cfg-carousel-picker');
  if(!box)return;
  box.querySelectorAll('input[name="cfg_ct_tpl"]').forEach(function(i){ i.checked=!!on; });
}

async function cfgSaveCarouselTemplates(){
  var box=document.getElementById('cfg-carousel-picker');
  var msg=document.getElementById('cfg-carousel-msg');
  if(!box)return;
  var names=Array.from(box.querySelectorAll('input[name="cfg_ct_tpl"]:checked')).map(function(i){ return i.value; });
  if(msg){msg.textContent='Saving…';msg.style.color='var(--muted)';}
  try{
    var res=await cafFetch('/v1/admin/config/project-carousel-templates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({_project:SLUG,html_template_names:names})});
    var txt=await res.text();
    var j={};
    try{ j=txt?JSON.parse(txt):{}; }catch(_){ j={ok:false,error:txt||'Bad response'}; }
    if(!res.ok||!j.ok){
      if(msg){msg.textContent=(j&&j.error)||('HTTP '+res.status);msg.style.color='var(--red)';}
      console.error('cfgSaveCarouselTemplates',res.status,j,txt);
      return;
    }
    if(msg){msg.textContent='Saved';msg.style.color='var(--green)';}
    loadConfig();
  }catch(e){
    if(msg){msg.textContent=String(e&&e.message||e);msg.style.color='var(--red)';}
  }
}

async function loadConfig(){
  const r=await cafFetch('/v1/admin/config?project='+encodeURIComponent(SLUG));const d=await r.json();
  if(!d.ok){document.getElementById('config-content').innerHTML='<div class="empty">'+(d.error||'Error')+'</div>';return;}
  let availTemplates=[];
  try{
    const tr=await cafFetch('/v1/admin/carousel-template-list');
    const td=await tr.json();
    if(tr.ok && td && td.ok && Array.isArray(td.templates)){
      availTemplates=td.templates.slice().sort(function(a,b){ return String(a).localeCompare(String(b)); });
    }
  }catch(e){ console.warn('carousel-template-list',e); }
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

  // === Product (editable) — drives FLOW_PRODUCT_* LLM + HeyGen prompts ===
  const pr=d.profile?.product||{};
  h+='<div id="tab-product" class="tab-panel">';
  h+='<div class="card"><div class="card-h">Product briefing';
  h+=' <span style="font-weight:400;color:var(--muted);font-size:11px;margin-left:8px">Feeds every FLOW_PRODUCT_* video: the LLM sees <code>product_profile</code> in its creation pack and HeyGen\\'s Video Agent receives a concise product briefing appended to its prompt.</span>';
  h+='</div>';
  h+='<form id="product-form" class="config-form">';
  for(const g of PRODUCT_FIELD_GROUPS){
    h+='<div class="card-h" style="margin-top:16px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);border:none;padding-left:0">'+g.title+'</div>';
    for(const f of g.fields){
      if(f.ta) h+=fgTa('p_'+f.k,f.l,pr[f.k]||'');
      else h+=fg('p_'+f.k,f.l,pr[f.k]||'','text');
    }
  }
  h+='<div class="form-actions"><button type="submit" class="btn">Save Product briefing</button><span id="product-msg" class="form-msg"></span></div>';
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
  h+=fgTa('max_jobs_per_flow_type','Max jobs per flow type (JSON; overrides defaults — carousel flows default to 10 each, scene assembly + 4 HeyGen paths default to 1)',JSON.stringify(c.max_jobs_per_flow_type&&typeof c.max_jobs_per_flow_type==='object'?c.max_jobs_per_flow_type:{},null,2));
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

  // === Carousel templates (pinned .hbs for this project) ===
  const ctp=d.profile?.carousel_templates||[];
  const mergedCarousel=[...new Set([...availTemplates,...ctp])].sort(function(a,b){ return String(a).localeCompare(String(b)); });
  h+='<div id="tab-carousels" class="tab-panel"><div class="card"><div class="card-h">Carousel templates ('+ctp.length+' selected)</div>';
  h+='<p style="color:var(--muted);font-size:13px;margin-bottom:12px">Pin renderer <code>.hbs</code> templates for <strong>'+esc(SLUG)+'</strong> (operator shortlist). Pipeline routing still uses Flow Engine template keys. You can also pin from <a href="/admin/carousel-templates">Carousel templates</a>.</p>';
  h+='<div id="cfg-carousel-picker">';
  if(mergedCarousel.length){
    h+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">';
    h+='<button type="button" class="btn btn-sm btn-ghost" onclick="cfgCarouselPickAll(true)">Select all</button>';
    h+='<button type="button" class="btn btn-sm btn-ghost" onclick="cfgCarouselPickAll(false)">Clear all</button>';
    h+='</div>';
    h+='<div style="max-height:min(420px,50vh);overflow:auto;border:1px solid var(--border);border-radius:8px;padding:12px;background:var(--card2)">';
    for(const t of mergedCarousel){
      const on=ctp.indexOf(t)>=0;
      h+='<label style="display:flex;gap:10px;align-items:flex-start;margin-bottom:8px;cursor:pointer;font-size:13px;line-height:1.35">';
      h+='<input type="checkbox" name="cfg_ct_tpl" value="'+esc(t)+'"'+(on?' checked':'')+'>';
      h+='<span class="mono" style="word-break:break-all">'+esc(t)+'</span></label>';
    }
    h+='</div>';
  }else{
    h+='<div class="empty" style="margin-bottom:10px">No templates listed. Ensure the API can reach the renderer template list (<code>/v1/admin/carousel-template-list</code>) or add <code>.hbs</code> files under Core&rsquo;s bundled carousel templates.</div>';
  }
  h+='<div class="form-actions" style="margin-top:12px"><button type="button" class="btn" onclick="cfgSaveCarouselTemplates()">Save carousel templates</button><span id="cfg-carousel-msg" class="form-msg"></span></div>';
  h+='</div></div></div>';

  // === Allowed Flow Types (grouped by output format) ===
  const ft=d.profile?.flow_types||[];
  const FT_META_STATIC={
    'Flow_Carousel_Copy':{label:'Carousel – Copy & Slides',cat:'Carousel',defaultNotes:'Instagram/TikTok carousel (text slides).'},
    'Video_Scene_Generator':{label:'Video – Multi-scene',cat:'Video (generic)',defaultNotes:'Multiple HeyGen scenes stitched together.'},
    'Video_Script_Generator':{label:'Video – Single (Script path)',cat:'Video (generic)',defaultNotes:'HeyGen script path (full dialogue).'},
    'Video_Prompt_Generator':{label:'Video – Single (Prompt path)',cat:'Video (generic)',defaultNotes:'HeyGen prompt path (short-form).'},
    'Hook_Variations':{label:'Hook Variations',cat:'Hooks & Scripts',defaultNotes:'Hook text experiments; feeds carousel/reel flows.'},
    'Reel_Script':{label:'Reel Script',cat:'Hooks & Scripts',defaultNotes:'Short-form Instagram/TikTok reel script.'}
  };
  const FORMAT_ORDER={'Carousel':1,'Video (generic)':2,'Product Video':3,'Product Image Ad':4,'Hooks & Scripts':5,'Other':9};
  const toTitle=function(s){return String(s||'').split(' ').filter(Boolean).map(function(w){return w.charAt(0).toUpperCase()+w.slice(1).toLowerCase();}).join(' ');};
  function ftMeta(id){
    if(FT_META_STATIC[id])return FT_META_STATIC[id];
    if(typeof id==='string'&&id.indexOf('FLOW_IMG_PRODUCT_')===0){
      var suf=id.replace('FLOW_IMG_PRODUCT_','').replace(/_/g,' ');
      return {label:'Product Image Ad – '+toTitle(suf),cat:'Product Image Ad',defaultNotes:'Static image ad — generation blocked until image tool is wired.'};
    }
    if(typeof id==='string'&&id.indexOf('FLOW_PRODUCT_')===0){
      var suf2=id.replace('FLOW_PRODUCT_','').replace(/_/g,' ');
      return {label:'Product Video – '+toTitle(suf2),cat:'Product Video',defaultNotes:'Product marketing video — maps to Video_Prompt_Generator templates.'};
    }
    return {label:(id||'—'),cat:'Other',defaultNotes:''};
  }
  const groups={};
  for(const f of ft){const m=ftMeta(f.flow_type);(groups[m.cat]=groups[m.cat]||[]).push({raw:f,meta:m});}
  const cats=Object.keys(groups).sort(function(a,b){return (FORMAT_ORDER[a]||9)-(FORMAT_ORDER[b]||9);});
  for(const k in groups){groups[k].sort(function(a,b){return (Number(b.raw.priority_weight)||0)-(Number(a.raw.priority_weight)||0);});}
  h+='<div id="tab-flows" class="tab-panel"><div class="card">';
  h+='<div class="card-h">Allowed Flow Types ('+ft.length+(cats.length?' in '+cats.length+' format'+(cats.length===1?'':'s'):'')+')';
  h+=' <span style="font-weight:400;color:var(--muted);font-size:11px;margin-left:8px">Grouped by output format. Raw <code>flow_type</code> IDs are shown below each label and are the join keys used by prompts, jobs, and history.</span>';
  h+=' <button type="button" class="btn btn-sm" style="float:right;text-transform:none;letter-spacing:0" onclick="cfgBeginInlineAdd(this,\\'flow-type\\')">+ Add Flow Type</button></div>';
  if(ft.length){
    for(const cat of cats){
      const list=groups[cat];
      h+='<div style="padding:14px 20px 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:600">'+esc(cat)+' <span style="color:#555;font-weight:400">· '+list.length+'</span></div>';
      h+='<div style="overflow-x:auto;padding:0 20px 12px"><table><thead><tr><th style="min-width:300px">Flow</th><th>Enabled</th><th>Variations</th><th>Platforms</th><th>Priority</th><th>Prompt Template</th><th>Notes</th><th></th></tr></thead><tbody>';
      for(const entry of list){
        const f=entry.raw;
        h+='<tr><td><div style="line-height:1.35"><strong>'+esc(entry.meta.label)+'</strong><br><span class="mono" style="font-size:11px;color:var(--muted)">'+esc(f.flow_type)+'</span></div></td>';
        h+='<td>'+(f.enabled?'<span class="badge badge-g">Yes</span>':'<span class="badge badge-r">No</span>')+'</td>';
        h+='<td>'+f.default_variation_count+'</td>';
        h+='<td>'+esc(f.allowed_platforms||'—')+'</td>';
        h+='<td>'+esc(f.priority_weight||'—')+'</td>';
        h+='<td class="mono">'+esc(f.prompt_template_id||'—')+'</td>';
        h+='<td>'+esc(f.notes||entry.meta.defaultNotes||'—')+'</td>';
        h+='<td style="white-space:nowrap"><button type="button" class="btn-ghost" onclick="cfgBeginInlineEdit(this,\\'flow-type\\',\\''+encodeURIComponent(JSON.stringify(f))+'\\')">Edit</button> ';
        h+='<button type="button" class="btn-ghost" style="color:var(--red)" onclick="cfgDel(\\'flow-type\\',\\''+encodeURIComponent(JSON.stringify({flow_type:f.flow_type}))+'\\')">Del</button></td></tr>';
      }
      h+='</tbody></table></div>';
    }
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

  // === Brand Assets (editable) ===
  const ba=d.profile?.brand_assets||[];
  h+='<div id="tab-brand-assets" class="tab-panel"><div class="card"><div class="card-h">Brand Assets ('+ba.length+')';
  h+=' <span style="font-weight:400;color:var(--muted);font-size:11px;margin-left:8px">Logos, palettes, fonts &amp; reference images — FLOW_PRODUCT_* video jobs send synced assets (<code>heygen_asset_id</code>) or public file URLs to HeyGen.</span>';
  h+=' <button type="button" class="btn btn-sm" style="float:right;text-transform:none;letter-spacing:0" onclick="baBeginAdd()">+ Add brand asset</button></div>';
  h+='<div id="ba-form-container" style="padding:0 20px"></div>';
  h+='<div id="ba-message" style="margin:0 20px 12px;font-size:12px"></div>';
  if(ba.length){
    h+='<div style="padding:12px 20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">';
    for(const a of ba) h+=baCardHtml(a);
    h+='</div>';
    h+='<div style="overflow-x:auto;padding:0 20px 16px"><table><thead><tr><th>Kind</th><th>Label</th><th>Preview / URL</th><th>HeyGen</th><th>Order</th><th>Actions</th></tr></thead><tbody>';
    for(const a of ba) h+=baRowHtml(a);
    h+='</tbody></table></div>';
  }else h+='<div class="empty">No brand assets yet.</div>';
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
  document.getElementById('product-form')?.addEventListener('submit',async(e)=>{
    e.preventDefault();
    const body={_project:SLUG};
    for(const f of document.getElementById('product-form').elements){
      if(!f.name)continue;
      const key=f.name.replace('p_','');
      body[key]=f.value;
    }
    await postForm('/v1/admin/config/product',body,'product-msg');
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
  'flow-type':[{k:'flow_type',l:'Flow Type',r:true},{k:'enabled',l:'Enabled',t:'checkbox'},{k:'default_variation_count',l:'Default Variation Count',t:'number'},{k:'requires_signal_pack',l:'Requires Signal Pack',t:'checkbox'},{k:'requires_learning_context',l:'Requires Learning Context',t:'checkbox'},{k:'allowed_platforms',l:'Allowed Platforms'},{k:'output_schema_version',l:'Output Schema Version'},{k:'qc_checklist_version',l:'QC Checklist Version'},{k:'prompt_template_id',l:'Prompt Template ID'},{k:'priority_weight',l:'Priority Weight',t:'number',step:'0.01'},{k:'heygen_mode',l:'HeyGen mode (product videos only — leave blank for code default)',t:'select',opts:[{v:'',l:'Default (FEATURE/COMPARISON/OFFER/USECASE \u2192 script-led; PROBLEM/SOCIAL_PROOF \u2192 prompt-led)'},{v:'script_led',l:'script_led \u2014 /v3/videos, avatar reads spoken_script verbatim'},{v:'prompt_led',l:'prompt_led \u2014 /v3/video-agents, HeyGen writes and speaks its own VO'}]},{k:'notes',l:'Notes',ta:true}],
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
    else if(f.t==='select')inner+=fgSel(id,f.l,v,f.opts||[]);
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

// ============================================================
// Brand Assets panel (upload / URL / palette / font)
// ============================================================
const BA_KINDS=['logo','reference_image','palette','font','other'];
const BA_GOOGLE_FONTS=['Inter','Roboto','Open Sans','Lato','Montserrat','Poppins','Raleway','Playfair Display','Merriweather','Source Sans 3','Nunito','Work Sans'];

function baParseHex(raw){
  const t=String(raw||'').trim();if(!t)return null;
  const m=t.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if(!m)return null;
  let h=m[1];if(h.length===3)h=h.split('').map(function(c){return c+c}).join('');
  return '#'+h.toLowerCase();
}

function baColorsFromMeta(meta){
  const out=['','','','',''];
  const c=meta&&meta.colors;
  if(Array.isArray(c)){
    for(let i=0;i<5;i++){
      const v=baParseHex(typeof c[i]==='string'?c[i]:'');
      if(v)out[i]=v;
    }
  }
  return out;
}

function baMsg(text,type){
  const el=document.getElementById('ba-message');if(!el)return;
  el.textContent=text||'';
  el.style.color=type==='error'?'var(--red)':(type==='success'?'var(--green)':'var(--muted)');
  if(text)setTimeout(function(){if(el.textContent===text)el.textContent='';},5000);
}

function baCardHtml(a){
  const hasUrl=typeof a.public_url==='string'&&a.public_url.trim().length>0;
  const synced=typeof a.heygen_asset_id==='string'&&a.heygen_asset_id.length>0;
  const isImg=(a.kind==='logo'||a.kind==='reference_image'||a.kind==='other')&&hasUrl&&!/\\.(woff2?|ttf|otf)$/i.test(a.public_url||'');
  let preview='';
  if(a.kind==='palette'&&a.metadata_json&&Array.isArray(a.metadata_json.colors)){
    preview='<div style="display:flex;gap:4px;flex-wrap:wrap">';
    const cols=a.metadata_json.colors.filter(function(c){return typeof c==='string'}).slice(0,5);
    for(const c of cols) preview+='<span title="'+esc(c)+'" style="width:28px;height:28px;border-radius:6px;background:'+esc(c)+';border:1px solid var(--border)"></span>';
    preview+='</div>';
  }else if(isImg){
    preview='<img src="'+esc(a.public_url)+'" alt="" style="width:100%;max-height:100px;object-fit:contain;border-radius:6px;background:var(--panel)">';
  }else if(a.kind==='font'){
    const fam=a.metadata_json&&typeof a.metadata_json.font_family==='string'?a.metadata_json.font_family:null;
    const src=a.metadata_json&&typeof a.metadata_json.font_source==='string'?a.metadata_json.font_source:null;
    preview='<div style="font-size:12px;color:var(--muted)">'+esc(fam||(hasUrl?'Font file':'—'))+(src?' · '+esc(src):'')+'</div>';
  }else{
    preview='<div style="font-size:11px;color:var(--muted);word-break:break-all">'+esc(hasUrl?(a.public_url.slice(0,80)+(a.public_url.length>80?'…':'')):'No URL')+'</div>';
  }
  const syncLabel=synced?'HeyGen':'Sync';
  const syncDisabled=!hasUrl||a.kind==='palette';
  const enc=encodeURIComponent(JSON.stringify(a)).replace(/'/g,'%27');
  return '<div class="card" style="padding:12px;display:flex;flex-direction:column;gap:8px;min-height:120px">'+
    '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)">'+esc(a.kind)+'</div>'+
    '<div style="font-weight:600;font-size:13px;line-height:1.3">'+esc(a.label||'—')+'</div>'+
    preview+
    '<div style="margin-top:auto;display:flex;gap:6px;flex-wrap:wrap">'+
      '<button type="button" class="btn-ghost" onclick="baBeginEdit(\\''+enc+'\\')">Edit</button>'+
      '<button type="button" class="btn-ghost"'+(syncDisabled?' disabled':'')+' onclick="baSyncHeygen(\\''+esc(a.id)+'\\')">'+syncLabel+'</button>'+
      '<button type="button" class="btn-ghost" style="color:var(--red)" onclick="baDelete(\\''+esc(a.id)+'\\')">Del</button>'+
    '</div>'+
  '</div>';
}

function baRowHtml(a){
  const hasUrl=typeof a.public_url==='string'&&a.public_url.trim().length>0;
  const synced=typeof a.heygen_asset_id==='string'&&a.heygen_asset_id.length>0;
  let preview='—';
  if(a.kind==='palette'&&a.metadata_json&&Array.isArray(a.metadata_json.colors)){
    const cols=a.metadata_json.colors.filter(function(c){return typeof c==='string'}).slice(0,5);
    preview='<span style="display:inline-flex;gap:4px">';
    for(const c of cols) preview+='<span title="'+esc(c)+'" style="width:14px;height:14px;border-radius:3px;background:'+esc(c)+';border:1px solid var(--border);display:inline-block"></span>';
    preview+='</span>';
  }else if(hasUrl){
    preview='<a href="'+esc(a.public_url)+'" target="_blank" style="max-width:240px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle">'+esc(a.public_url)+'</a>';
  }
  const heygenCell=synced
    ?'<span title="'+esc(a.heygen_synced_at||'')+'" style="color:var(--green)">✓ '+esc(String(a.heygen_asset_id).slice(0,10))+'…</span>'
    :'<span style="color:var(--muted)">not synced</span>';
  const disSync=!hasUrl||a.kind==='palette';
  const enc=encodeURIComponent(JSON.stringify(a)).replace(/'/g,'%27');
  return '<tr><td>'+esc(a.kind)+'</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(a.label||'—')+'</td>'+
    '<td>'+preview+'</td>'+
    '<td style="font-size:12px">'+heygenCell+'</td>'+
    '<td>'+esc(a.sort_order!=null?a.sort_order:0)+'</td>'+
    '<td style="white-space:nowrap">'+
      '<button type="button" class="btn-ghost" onclick="baBeginEdit(\\''+enc+'\\')">Edit</button> '+
      '<button type="button" class="btn-ghost"'+(disSync?' disabled':'')+' onclick="baSyncHeygen(\\''+esc(a.id)+'\\')">'+(synced?'Re-sync HeyGen':'Sync HeyGen')+'</button> '+
      '<button type="button" class="btn-ghost" style="color:var(--red)" onclick="baDelete(\\''+esc(a.id)+'\\')">Del</button>'+
    '</td></tr>';
}

function baFormHtml(data){
  const d=data||{};
  const kind=d.kind||'reference_image';
  const label=d.label||'';
  const url=d.public_url||'';
  const sort=d.sort_order!=null?d.sort_order:0;
  const meta=d.metadata_json||{};
  const hex=baColorsFromMeta(meta);
  const fontFamily=meta.font_family||BA_GOOGLE_FONTS[0];
  const fontSource=meta.font_source||'google';
  const isEdit=!!d.id;

  let fields='';
  // Kind selector
  fields+='<div class="form-group"><label>Kind</label><select id="ba_kind" onchange="baOnKindChange()">';
  for(const k of BA_KINDS) fields+='<option value="'+k+'"'+(k===kind?' selected':'')+'>'+k+'</option>';
  fields+='</select></div>';

  fields+='<div class="form-group"><label>Label</label><input type="text" id="ba_label" value="'+esc(label)+'" placeholder="e.g. Primary logo, Moodboard, Color palette"></div>';

  // Sections per kind — only one is visible; baOnKindChange() toggles visibility.
  fields+='<div id="ba_sec_image" class="ba-sec"><div class="form-group"><label>'+(isEdit?'Replace file (optional)':'Upload image(s) — one or many')+'</label><input type="file" id="ba_file" accept="image/*,.svg"'+(isEdit?'':' multiple')+'></div>';
  fields+='<div class="form-group"><label>Or Public URL</label><input type="text" id="ba_public_url" value="'+esc(url)+'" placeholder="https://…"></div></div>';

  fields+='<div id="ba_sec_palette" class="ba-sec"><div class="form-group"><label>Colors (hex, up to 5)</label><div style="display:flex;flex-direction:column;gap:8px">';
  for(let i=0;i<5;i++) fields+='<div style="display:flex;gap:8px;align-items:center"><input type="text" id="ba_hex_'+i+'" value="'+esc(hex[i])+'" placeholder="#RRGGBB" style="flex:1" oninput="baUpdateSwatch('+i+')"><span id="ba_swatch_'+i+'" style="width:36px;height:36px;border-radius:6px;border:1px solid var(--border);background:'+esc(hex[i]||'transparent')+'"></span></div>';
  fields+='</div></div></div>';

  fields+='<div id="ba_sec_font" class="ba-sec">';
  fields+='<div class="form-group"><label>Font source</label><select id="ba_font_source" onchange="baOnFontSourceChange()">';
  for(const s of [['google','Google Fonts (name + optional file URL)'],['url','Font file URL'],['upload','Upload font file']]) fields+='<option value="'+s[0]+'"'+(s[0]===fontSource?' selected':'')+'>'+s[1]+'</option>';
  fields+='</select></div>';
  fields+='<div class="form-group ba-font-google"><label>Google font family</label><select id="ba_font_family">';
  for(const f of BA_GOOGLE_FONTS) fields+='<option value="'+esc(f)+'"'+(f===fontFamily?' selected':'')+'>'+esc(f)+'</option>';
  fields+='</select></div>';
  fields+='<div class="form-group ba-font-url-or-google"><label>Direct font file URL (.woff2 / .ttf)</label><input type="text" id="ba_public_url_font" value="'+esc(url)+'" placeholder="https://…/font.woff2"></div>';
  fields+='<div class="form-group ba-font-upload"><label>Upload font file</label><input type="file" id="ba_file_font" accept=".woff2,.woff,.ttf,.otf,font/*"></div>';
  fields+='</div>';

  fields+='<div class="form-group"><label>Sort order</label><input type="number" id="ba_sort_order" value="'+Number(sort)+'"></div>';

  const actions='<div class="form-actions" style="margin-top:14px"><button type="button" class="btn" onclick="baSubmit()">'+(isEdit?'Save changes':'Save')+'</button> <button type="button" class="btn-ghost" onclick="baCancel()">Cancel</button> <span id="ba_form_msg" class="form-msg"></span></div>';
  const idHidden='<input type="hidden" id="ba_id" value="'+esc(d.id||'')+'">';
  return '<div class="config-form" style="padding:16px 0">'+(isEdit?'<p style="font-size:12px;font-weight:600;color:var(--muted);margin:0 0 12px;text-transform:uppercase;letter-spacing:.04em">Edit brand asset</p>':'<p style="font-size:12px;font-weight:600;color:var(--muted);margin:0 0 12px;text-transform:uppercase;letter-spacing:.04em">New brand asset</p>')+idHidden+fields+actions+'</div>';
}

function baOnKindChange(){
  const kind=(document.getElementById('ba_kind')||{}).value||'other';
  const show=function(id,on){const el=document.getElementById(id);if(el)el.style.display=on?'':'none'};
  show('ba_sec_image',kind==='logo'||kind==='reference_image'||kind==='other');
  show('ba_sec_palette',kind==='palette');
  show('ba_sec_font',kind==='font');
  if(kind==='font') baOnFontSourceChange();
}

function baOnFontSourceChange(){
  const src=(document.getElementById('ba_font_source')||{}).value||'google';
  document.querySelectorAll('.ba-font-google').forEach(function(el){el.style.display=src==='google'?'':'none'});
  document.querySelectorAll('.ba-font-url-or-google').forEach(function(el){el.style.display=(src==='google'||src==='url')?'':'none'});
  document.querySelectorAll('.ba-font-upload').forEach(function(el){el.style.display=src==='upload'?'':'none'});
}

function baUpdateSwatch(i){
  const input=document.getElementById('ba_hex_'+i);
  const sw=document.getElementById('ba_swatch_'+i);
  if(!input||!sw)return;
  const v=baParseHex(input.value);
  sw.style.background=v||'transparent';
}

function baCancel(){
  const c=document.getElementById('ba-form-container');
  if(c)c.innerHTML='';
}

function baBeginAdd(){
  const c=document.getElementById('ba-form-container');
  if(!c)return;
  c.innerHTML=baFormHtml({kind:'reference_image',sort_order:0});
  baOnKindChange();
  c.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function baBeginEdit(enc){
  let data;
  try{data=JSON.parse(decodeURIComponent(enc));}
  catch(e){alert('Could not open editor: '+e.message);return;}
  const c=document.getElementById('ba-form-container');
  if(!c)return;
  c.innerHTML=baFormHtml(data);
  baOnKindChange();
  c.scrollIntoView({behavior:'smooth',block:'nearest'});
}

async function baUploadFile(file){
  const fd=new FormData();
  fd.append('file',file);
  const r=await cafFetch('/v1/projects/'+encodeURIComponent(SLUG)+'/brand-assets/upload',{method:'POST',body:fd});
  const d=await r.json().catch(function(){return null});
  if(!r.ok||!d||d.ok===false) throw new Error((d&&(d.message||d.error))||('Upload failed '+r.status));
  return {public_url:d.public_url||null,storage_path:d.storage_path||null};
}

async function baSaveOne(payload,id){
  const isEdit=typeof id==='string'&&id.length>0;
  const url=isEdit
    ? '/v1/projects/'+encodeURIComponent(SLUG)+'/brand-assets/'+encodeURIComponent(id)
    : '/v1/projects/'+encodeURIComponent(SLUG)+'/brand-assets';
  const r=await cafFetch(url,{method:isEdit?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const d=await r.json().catch(function(){return null});
  if(!r.ok||!d||d.ok===false) throw new Error((d&&(d.message||d.error))||('Save failed '+r.status));
}

async function baSubmit(){
  const msg=document.getElementById('ba_form_msg');
  const setMsg=function(t,c){if(msg){msg.textContent=t||'';msg.style.color=c||'var(--muted)'}};
  setMsg('Saving…','var(--accent)');
  try{
    const id=(document.getElementById('ba_id')||{}).value||'';
    const kind=(document.getElementById('ba_kind')||{}).value||'other';
    const label=((document.getElementById('ba_label')||{}).value||'').trim();
    const sort=Number((document.getElementById('ba_sort_order')||{}).value||0)||0;

    if(kind==='palette'){
      const colors=[];
      for(let i=0;i<5;i++){
        const v=baParseHex((document.getElementById('ba_hex_'+i)||{}).value||'');
        if(v)colors.push(v);
      }
      if(colors.length===0){setMsg('Add at least one valid hex color (e.g. #ff5500).','var(--red)');return;}
      await baSaveOne({kind:'palette',label:label||'Color palette',sort_order:sort,public_url:null,storage_path:null,metadata_json:{colors:colors}},id);
    } else if(kind==='font'){
      const src=(document.getElementById('ba_font_source')||{}).value||'google';
      let publicUrl=null;let storagePath=null;const meta={};
      if(src==='google'){
        meta.font_source='google';
        meta.font_family=(document.getElementById('ba_font_family')||{}).value||BA_GOOGLE_FONTS[0];
        const u=((document.getElementById('ba_public_url_font')||{}).value||'').trim();
        if(u)publicUrl=u;
      } else if(src==='url'){
        meta.font_source='url';
        publicUrl=((document.getElementById('ba_public_url_font')||{}).value||'').trim()||null;
        if(!publicUrl||!/^https?:\\/\\//i.test(publicUrl)){setMsg('Enter a valid https URL to a font file.','var(--red)');return;}
      } else {
        const el=document.getElementById('ba_file_font');
        const file=el&&el.files&&el.files[0];
        if(!id&&!file){setMsg('Choose a font file to upload.','var(--red)');return;}
        meta.font_source='upload';
        if(file){
          const up=await baUploadFile(file);
          publicUrl=up.public_url;storagePath=up.storage_path;
          meta.original_filename=file.name;
        }
      }
      await baSaveOne({kind:'font',label:label||(src==='google'?meta.font_family:'Brand font'),sort_order:sort,public_url:publicUrl,storage_path:storagePath,metadata_json:meta},id);
    } else {
      // logo / reference_image / other
      const fileEl=document.getElementById('ba_file');
      const files=fileEl&&fileEl.files?Array.from(fileEl.files):[];
      const manualUrl=((document.getElementById('ba_public_url')||{}).value||'').trim()||null;

      if(!id&&files.length>1){
        // Multi-upload: create one row per file with label+i suffix.
        const prefix=label||(kind==='logo'?'Logo':(kind==='reference_image'?'Reference':'Asset'));
        for(let i=0;i<files.length;i++){
          const up=await baUploadFile(files[i]);
          await baSaveOne({kind:kind,label:prefix+' '+(i+1),sort_order:sort+i,public_url:up.public_url,storage_path:up.storage_path,metadata_json:{original_filename:files[i].name}});
        }
      } else {
        let publicUrl=manualUrl;let storagePath=null;let metaOut={};
        if(files.length>0){
          const up=await baUploadFile(files[0]);
          publicUrl=up.public_url;storagePath=up.storage_path;
          metaOut={original_filename:files[0].name};
        }
        if(!id&&!publicUrl){setMsg('Add a public URL or upload a file.','var(--red)');return;}
        const payload={kind:kind,label:label||null,sort_order:sort,public_url:publicUrl,storage_path:storagePath,metadata_json:metaOut};
        if(id&&files.length===0&&!manualUrl){
          // editing metadata-only: drop public_url/storage_path so they aren't wiped
          delete payload.public_url;delete payload.storage_path;
        }
        await baSaveOne(payload,id);
      }
    }
    setMsg('Saved','var(--green)');
    baCancel();
    baMsg('Brand asset saved','success');
    await loadConfig();
    baReopenTab();
  }catch(err){
    setMsg(err&&err.message?err.message:'Error','var(--red)');
  }
}

function baReopenTab(){
  // Keep user focused on the Brand Assets tab after loadConfig() re-renders the panel.
  const tabBtn=document.querySelector('#config-tabs .tab[onclick*="tab-brand-assets"]');
  if(tabBtn)tabBtn.click();
}

async function baDelete(id){
  if(!confirm('Delete this brand asset?'))return;
  try{
    const r=await cafFetch('/v1/projects/'+encodeURIComponent(SLUG)+'/brand-assets/'+encodeURIComponent(id),{method:'DELETE'});
    const d=await r.json().catch(function(){return null});
    if(!r.ok||!d||d.ok===false)throw new Error((d&&(d.message||d.error))||('Delete failed '+r.status));
    baMsg('Brand asset deleted','success');
    await loadConfig();
    baReopenTab();
  }catch(err){
    baMsg(err&&err.message?err.message:'Delete failed','error');
  }
}

async function baSyncHeygen(id){
  baMsg('Syncing to HeyGen…','info');
  try{
    const r=await cafFetch('/v1/projects/'+encodeURIComponent(SLUG)+'/brand-assets/'+encodeURIComponent(id)+'/sync-heygen',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const d=await r.json().catch(function(){return null});
    if(!r.ok||!d||d.ok===false)throw new Error((d&&(d.message||d.error))||('HeyGen sync failed '+r.status));
    baMsg('Uploaded to HeyGen','success');
    await loadConfig();
    baReopenTab();
  }catch(err){
    baMsg(err&&err.message?err.message:'HeyGen sync failed','error');
  }
}

loadConfig();
</script>`;
    reply.type("text/html").send(page(currentSlug + " — Config", "config", body, projects, currentSlug, adminHeadTokenScript(config)));
  });
}
