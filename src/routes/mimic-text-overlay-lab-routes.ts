import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import {
  composeMimicTextOverlayLabFromFixture,
  renderMimicTextOverlayLabHtml,
  type MimicTextOverlayLabFixture,
} from "../services/mimic-text-overlay-lab.js";
import {
  listInsightSlidesForOverlayLab,
  loadMimicTextOverlayFixtureFromInsights,
} from "../services/mimic-text-overlay-lab-load.js";
import { adminPhWithPipelineHtml } from "./admin-ui-shared.js";

type AdminProjectRow = {
  id: string;
  slug: string;
  display_name: string | null;
  active: boolean;
};

export type MimicTextOverlayLabAdminDeps = {
  db: Pool;
  config: AppConfig;
  wrapAdminPage: (
    title: string,
    activeSidebar: string,
    body: string,
    projects: AdminProjectRow[],
    currentSlug: string
  ) => string;
  listProjects: (db: Pool) => Promise<AdminProjectRow[]>;
  resolveProject: (db: Pool, slugParam: string | undefined) => Promise<AdminProjectRow | null>;
};

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const previewBodySchema = z.object({
  insights_id: z.string().min(1).optional(),
  slide_index: z.coerce.number().int().min(1).default(1),
  llm_slide: z.record(z.unknown()).optional(),
  background_image_url: z.string().nullable().optional(),
  show_debug_boxes: z.boolean().optional().default(true),
  show_reference_ghost_text: z.boolean().optional().default(false),
  fixture: z
    .object({
      llm_slide: z.record(z.unknown()),
      mimic: z.record(z.unknown()),
      slide_index: z.number().optional(),
      background_image_url: z.string().nullable().optional(),
      description: z.string().optional(),
    })
    .optional(),
});

function adminMimicTextOverlayLabBody(currentSlug: string): string {
  return `
${adminPhWithPipelineHtml("Mimic text overlay lab", null, currentSlug, "Document AI geometry + Nemotron roles → HTML/CSS on 1080×1350 (no image gen)")}
<div class="content">
  <p class="runs-ops-hint">Preview precise on-image copy placement using stored <strong>Document AI</strong> bboxes and <strong>Nemotron</strong> text block roles. Red dashed boxes = reference OCR regions. Uses the same <span class="mono">buildMimicDocAiRenderTextLayers</span> path as production carousel render.</p>
  <div class="card" style="margin-bottom:16px">
    <div class="card-h">Source</div>
    <form id="mtol-form" class="config-form" style="padding:12px 16px 16px">
      <div class="form-group">
        <label for="mtol-insights">insights_id (top_performer_carousel)</label>
        <input type="text" id="mtol-insights" name="insights_id" placeholder="UUID from Processing → insights row" style="font-family:var(--mono)">
      </div>
      <div class="form-group">
        <label for="mtol-slide">Slide index (1-based)</label>
        <input type="number" id="mtol-slide" name="slide_index" value="1" min="1" style="max-width:120px">
        <span id="mtol-slide-hint" class="form-msg"></span>
      </div>
      <div class="form-group">
        <label for="mtol-copy">llm_slide JSON (headline/body or text_blocks)</label>
        <textarea id="mtol-copy" name="llm_slide_json" rows="8" placeholder='{"headline":"…","body":"…"}'></textarea>
      </div>
      <div class="form-group">
        <label for="mtol-bg">Optional background plate URL</label>
        <input type="url" id="mtol-bg" name="background_image_url" placeholder="https://…">
      </div>
      <div class="form-group" style="display:flex;flex-wrap:wrap;gap:16px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="mtol-boxes" checked> Reference OCR boxes</label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="mtol-ghost"> Ghost reference text</label>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn" id="mtol-preview-btn">Update preview</button>
        <button type="button" class="btn btn-ghost" id="mtol-load-slides-btn">List slides</button>
        <span id="mtol-msg" class="form-msg"></span>
      </div>
    </form>
  </div>
  <div class="card">
    <div class="card-h">Live preview</div>
    <div style="padding:12px;background:#0d0d12;border-radius:0 0 8px 8px;overflow:auto">
      <iframe id="mtol-frame" title="Mimic text overlay preview" style="width:100%;min-height:1420px;border:0;background:#0f0f14"></iframe>
    </div>
  </div>
</div>
<script>
(function(){
  var form=document.getElementById('mtol-form');
  var frame=document.getElementById('mtol-frame');
  var msg=document.getElementById('mtol-msg');
  var slideHint=document.getElementById('mtol-slide-hint');
  function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');}
  async function loadSlides(){
    var id=(document.getElementById('mtol-insights').value||'').trim();
    if(!id){ if(slideHint)slideHint.textContent='Enter insights_id first'; return; }
    if(slideHint)slideHint.textContent='Loading…';
    try{
      var r=await cafFetch('/v1/admin/mimic-text-overlay-lab/insights/'+encodeURIComponent(id)+'/slides');
      var d=await r.json();
      if(!r.ok)throw new Error(d.error||d.message||('HTTP '+r.status));
      var slides=Array.isArray(d.slides)?d.slides:[];
      if(slideHint){
        slideHint.innerHTML=slides.length?slides.map(function(s){
          return 'S'+s.slide_index+(s.has_document_ai?' docai':'')+': '+esc((s.preview_text||'').slice(0,40));
        }).join(' · '):'No slides';
      }
    }catch(e){
      if(slideHint)slideHint.textContent=e.message||String(e);
    }
  }
  document.getElementById('mtol-load-slides-btn').addEventListener('click',loadSlides);
  form.addEventListener('submit',async function(ev){
    ev.preventDefault();
    if(msg)msg.textContent='Rendering…';
    var insightsId=(document.getElementById('mtol-insights').value||'').trim();
    var slideIndex=parseInt(document.getElementById('mtol-slide').value,10)||1;
    var copyRaw=(document.getElementById('mtol-copy').value||'').trim();
    var llmSlide=null;
    if(copyRaw){
      try{ llmSlide=JSON.parse(copyRaw); }catch(e){ if(msg)msg.textContent='Invalid llm_slide JSON'; return; }
    }
    var bg=(document.getElementById('mtol-bg').value||'').trim()||null;
    var payload={
      slide_index:slideIndex,
      show_debug_boxes:document.getElementById('mtol-boxes').checked,
      show_reference_ghost_text:document.getElementById('mtol-ghost').checked,
      background_image_url:bg
    };
    if(insightsId)payload.insights_id=insightsId;
    if(llmSlide)payload.llm_slide=llmSlide;
    try{
      var r=await cafFetch('/v1/admin/mimic-text-overlay-lab/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      var html=await r.text();
      if(!r.ok)throw new Error(html.slice(0,200));
      if(frame)frame.srcdoc=html;
      if(msg)msg.textContent='Preview updated ('+html.length+' bytes)';
    }catch(e){
      if(msg)msg.textContent=e.message||String(e);
    }
  });
})();
</script>`;
}

export function registerMimicTextOverlayLabRoutes(app: FastifyInstance, deps: MimicTextOverlayLabAdminDeps): void {
  const { db, wrapAdminPage, listProjects, resolveProject } = deps;

  app.get("/admin/mimic-text-overlay-lab", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const projects = await listProjects(db);
    const project = await resolveProject(db, query.project);
    const currentSlug = project?.slug ?? "";
    const body = adminMimicTextOverlayLabBody(currentSlug);
    reply
      .header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
      .type("text/html")
      .send(wrapAdminPage("Mimic text overlay lab", "mimic-text-overlay-lab", body, projects, currentSlug));
  });

  app.get("/v1/admin/mimic-text-overlay-lab/insights/:insightsId/slides", async (request, reply) => {
    const { insightsId } = request.params as { insightsId: string };
    try {
      const slides = await listInsightSlidesForOverlayLab(db, insightsId.trim());
      return { ok: true, insights_id: insightsId, slides };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.code(400).send({ ok: false, error: message });
    }
  });

  app.post("/v1/admin/mimic-text-overlay-lab/preview", async (request, reply) => {
    const parsed = previewBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const b = parsed.data;
    try {
      let fixture: MimicTextOverlayLabFixture;
      if (b.fixture) {
        fixture = {
          description: b.fixture.description,
          slide_index: b.fixture.slide_index ?? b.slide_index,
          background_image_url: b.fixture.background_image_url,
          llm_slide: b.fixture.llm_slide,
          mimic: b.fixture.mimic as MimicTextOverlayLabFixture["mimic"],
        };
      } else if (b.insights_id) {
        fixture = await loadMimicTextOverlayFixtureFromInsights(db, b.insights_id, b.slide_index);
      } else {
        return reply.code(400).send({
          ok: false,
          error: "Provide insights_id or fixture in request body",
        });
      }
      if (b.llm_slide) fixture.llm_slide = { ...fixture.llm_slide, ...b.llm_slide };
      if (b.background_image_url !== undefined) fixture.background_image_url = b.background_image_url;
      fixture.slide_index = b.slide_index;

      const composed = composeMimicTextOverlayLabFromFixture(fixture);
      const html = renderMimicTextOverlayLabHtml(composed, {
        title: "Mimic text overlay preview",
        description: fixture.description,
        showDebugBoxes: b.show_debug_boxes,
        showReferenceGhostText: b.show_reference_ghost_text,
      });
      return reply.header("Cache-Control", "no-store").type("text/html; charset=utf-8").send(html);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.code(400).type("text/html").send(`<pre>${esc(message)}</pre>`);
    }
  });
}
