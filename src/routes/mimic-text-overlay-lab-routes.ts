import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { getSignalPackById } from "../repositories/signal-packs.js";
import {
  composeMimicTextOverlayLabFromFixture,
  renderMimicTextOverlayLabHtml,
  type MimicTextOverlayLabFixture,
} from "../services/mimic-text-overlay-lab.js";
import {
  listCarouselMimicReferencesFromSignalPack,
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
  signal_pack_id: z.string().uuid().optional(),
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
${adminPhWithPipelineHtml("Mimic text overlay lab", "signal_pack", currentSlug, "Import a signal pack → pick mimic carousel reference → preview Document AI text placement")}
<div class="content">
  <p class="runs-ops-hint">Preview on-image copy at <strong>Document AI</strong> bbox positions with <strong>Nemotron</strong> roles — same <span class="mono">buildMimicDocAiRenderTextLayers</span> path as production. No image generation.</p>
  <div class="card" style="margin-bottom:16px">
    <div class="card-h">Import from signal pack</div>
    <form id="mtol-form" class="config-form" style="padding:12px 16px 16px">
      <div class="form-group">
        <label for="mtol-pack">Signal pack</label>
        <select id="mtol-pack" name="signal_pack_id">
          <option value="">— select project in sidebar, then load packs —</option>
        </select>
        <span id="mtol-pack-hint" class="form-msg"></span>
      </div>
      <div class="form-group">
        <label for="mtol-ref">Mimic carousel reference</label>
        <select id="mtol-ref" name="insights_id" disabled>
          <option value="">— pick a signal pack first —</option>
        </select>
        <span id="mtol-ref-hint" class="form-msg"></span>
      </div>
      <div class="form-group">
        <label for="mtol-insights">insights_id (advanced / manual)</label>
        <input type="text" id="mtol-insights" name="insights_id_manual" placeholder="Filled when you pick a reference above" style="font-family:var(--mono)">
      </div>
      <div class="form-group">
        <label for="mtol-slide">Slide index (1-based)</label>
        <input type="number" id="mtol-slide" name="slide_index" value="1" min="1" style="max-width:120px">
        <span id="mtol-slide-hint" class="form-msg"></span>
      </div>
      <div class="form-group">
        <label for="mtol-copy">llm_slide JSON (headline/body or text_blocks)</label>
        <textarea id="mtol-copy" name="llm_slide_json" rows="8" placeholder='{"headline":"…","body":"…"}'></textarea>
        <button type="button" class="btn btn-ghost btn-sm" id="mtol-fill-copy-btn" style="margin-top:6px">Reset copy from reference slide</button>
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
      <iframe id="mtol-frame" title="Mimic text overlay preview" style="width:100%;min-height:720px;height:72vh;max-height:900px;border:0;background:#0f0f14"></iframe>
    </div>
  </div>
</div>
<script>
(function(){
  const SLUG=${JSON.stringify(currentSlug)};
  var form=document.getElementById('mtol-form');
  var frame=document.getElementById('mtol-frame');
  var msg=document.getElementById('mtol-msg');
  var slideHint=document.getElementById('mtol-slide-hint');
  var packSel=document.getElementById('mtol-pack');
  var refSel=document.getElementById('mtol-ref');
  var insightsInput=document.getElementById('mtol-insights');
  var copyTa=document.getElementById('mtol-copy');
  function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');}
  function insightsId(){
    return (refSel&&refSel.value||insightsInput&&insightsInput.value||'').trim();
  }
  function packId(){ return (packSel&&packSel.value||'').trim(); }
  async function loadPacks(){
    var hint=document.getElementById('mtol-pack-hint');
    if(!SLUG){ if(hint)hint.textContent='Select a project in the sidebar'; return; }
    if(hint)hint.textContent='Loading packs…';
    try{
      var r=await cafFetch('/v1/admin/signal-packs?project='+encodeURIComponent(SLUG)+'&limit=120');
      var d=await r.json();
      if(!r.ok)throw new Error(d.error||('HTTP '+r.status));
      var rows=Array.isArray(d.rows)?d.rows:[];
      if(!packSel)return;
      packSel.innerHTML='<option value="">— choose signal pack —</option>'+rows.map(function(p){
        var label=(p.run_id||'pack')+' · '+String(p.created_at||'').slice(0,10)+' · ideas '+String(p.ideas_count||0);
        return '<option value="'+esc(p.id)+'">'+esc(label)+'</option>';
      }).join('');
      if(hint)hint.textContent=rows.length?rows.length+' pack(s)':'No signal packs for '+SLUG;
      var qs=new URLSearchParams(window.location.search);
      var wantPack=qs.get('signal_pack_id');
      if(wantPack&&rows.some(function(p){return p.id===wantPack;})){
        packSel.value=wantPack;
        await loadReferences();
        var wantIns=qs.get('insights_id');
        if(wantIns&&refSel){ refSel.value=wantIns; await onReferencePicked(false); }
      }
    }catch(e){
      if(hint)hint.textContent=e.message||String(e);
    }
  }
  async function loadReferences(){
    var hint=document.getElementById('mtol-ref-hint');
    var pid=packId();
    if(!pid){
      if(refSel){ refSel.innerHTML='<option value="">— pick a signal pack first —</option>'; refSel.disabled=true; }
      return;
    }
    if(hint)hint.textContent='Loading mimic carousel refs…';
    try{
      var r=await cafFetch('/v1/admin/mimic-text-overlay-lab/signal-packs/'+encodeURIComponent(pid)+'/carousel-references?project='+encodeURIComponent(SLUG));
      var d=await r.json();
      if(!r.ok)throw new Error(d.error||d.message||('HTTP '+r.status));
      var refs=Array.isArray(d.references)?d.references:[];
      if(!refSel)return;
      refSel.disabled=refs.length===0;
      refSel.innerHTML=refs.length?refs.map(function(row){
        var label=row.title+' · '+row.predicted_render_label+(row.has_inspection_media?' · media':'');
        return '<option value="'+esc(row.insights_id)+'">'+esc(label)+'</option>';
      }).join(''):'<option value="">No mimic carousel references in this pack</option>';
      if(hint)hint.textContent=refs.length?refs.length+' carousel reference(s)':'No top_performer_carousel entries — run Processing on carousel posts first';
      if(refs.length===1){ refSel.value=refs[0].insights_id; await onReferencePicked(false); }
    }catch(e){
      if(hint)hint.textContent=e.message||String(e);
    }
  }
  async function fillDefaultCopy(){
    var id=insightsId();
    var slideIndex=parseInt(document.getElementById('mtol-slide').value,10)||1;
    if(!id||!copyTa)return;
    var r=await cafFetch('/v1/admin/mimic-text-overlay-lab/insights/'+encodeURIComponent(id)+'/default-llm-slide?slide_index='+slideIndex);
    var d=await r.json();
    if(!r.ok)throw new Error(d.error||('HTTP '+r.status));
    copyTa.value=JSON.stringify(d.llm_slide,null,2);
  }
  async function onReferencePicked(autoPreview){
    var id=insightsId();
    if(insightsInput)insightsInput.value=id;
    if(!id)return;
    try{
      await fillDefaultCopy();
      await loadSlides();
      if(autoPreview!==false)form.dispatchEvent(new Event('submit',{cancelable:true}));
    }catch(e){
      if(msg)msg.textContent=e.message||String(e);
    }
  }
  async function loadSlides(){
    var id=insightsId();
    if(!id){ if(slideHint)slideHint.textContent='Pick a mimic reference or enter insights_id'; return; }
    if(slideHint)slideHint.textContent='Loading…';
    try{
      var r=await cafFetch('/v1/admin/mimic-text-overlay-lab/insights/'+encodeURIComponent(id)+'/slides');
      var d=await r.json();
      if(!r.ok)throw new Error(d.error||d.message||('HTTP '+r.status));
      var slides=Array.isArray(d.slides)?d.slides:[];
      if(slideHint){
        slideHint.innerHTML=slides.length?slides.map(function(s){
          return '<button type="button" class="btn-ghost btn-sm" data-slide="'+s.slide_index+'" style="margin:2px 4px 2px 0">S'+s.slide_index+(s.has_document_ai?' docai':'')+': '+esc((s.preview_text||'').slice(0,28))+'</button>';
        }).join(''):'No slides on insights row';
        slideHint.querySelectorAll('button[data-slide]').forEach(function(btn){
          btn.addEventListener('click',async function(){
            document.getElementById('mtol-slide').value=btn.getAttribute('data-slide');
            await fillDefaultCopy();
            form.dispatchEvent(new Event('submit',{cancelable:true}));
          });
        });
      }
    }catch(e){
      if(slideHint)slideHint.textContent=e.message||String(e);
    }
  }
  if(packSel)packSel.addEventListener('change',function(){ loadReferences(); });
  if(refSel)refSel.addEventListener('change',function(){ onReferencePicked(true); });
  document.getElementById('mtol-load-slides-btn').addEventListener('click',loadSlides);
  document.getElementById('mtol-fill-copy-btn').addEventListener('click',async function(){
    try{ await fillDefaultCopy(); if(msg)msg.textContent='Copy reset from reference'; }catch(e){ if(msg)msg.textContent=e.message||String(e); }
  });
  form.addEventListener('submit',async function(ev){
    ev.preventDefault();
    if(msg)msg.textContent='Rendering…';
    var insightsIdVal=insightsId();
    var slideIndex=parseInt(document.getElementById('mtol-slide').value,10)||1;
    var copyRaw=(copyTa&&copyTa.value||'').trim();
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
    if(insightsIdVal)payload.insights_id=insightsIdVal;
    if(packId())payload.signal_pack_id=packId();
    if(llmSlide)payload.llm_slide=llmSlide;
    try{
      var r=await cafFetch('/v1/admin/mimic-text-overlay-lab/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      var html=await r.text();
      if(!r.ok)throw new Error(html.slice(0,200));
      if(frame)frame.srcdoc=html;
      if(msg)msg.textContent='Preview updated';
    }catch(e){
      if(msg)msg.textContent=e.message||String(e);
    }
  });
  loadPacks();
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

  app.get("/v1/admin/mimic-text-overlay-lab/signal-packs/:packId/carousel-references", async (request, reply) => {
    const { packId } = request.params as { packId: string };
    const query = request.query as { project?: string };
    const project = await resolveProject(db, query.project);
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });
    const pack = await getSignalPackById(db, packId.trim());
    if (!pack || pack.project_id !== project.id) {
      return reply.code(404).send({ ok: false, error: "signal_pack_not_found" });
    }
    const references = listCarouselMimicReferencesFromSignalPack(pack);
    return {
      ok: true,
      signal_pack_id: pack.id,
      run_id: pack.run_id,
      references,
    };
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

  app.get("/v1/admin/mimic-text-overlay-lab/insights/:insightsId/default-llm-slide", async (request, reply) => {
    const { insightsId } = request.params as { insightsId: string };
    const query = request.query as { slide_index?: string };
    const slideIndex = Math.max(1, parseInt(query.slide_index ?? "1", 10) || 1);
    try {
      const fixture = await loadMimicTextOverlayFixtureFromInsights(db, insightsId.trim(), slideIndex);
      return { ok: true, insights_id: insightsId, slide_index: slideIndex, llm_slide: fixture.llm_slide };
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
        if (b.signal_pack_id) {
          const pack = await getSignalPackById(db, b.signal_pack_id);
          if (!pack) {
            return reply.code(404).send({ ok: false, error: "signal_pack_not_found" });
          }
          const refs = listCarouselMimicReferencesFromSignalPack(pack);
          if (!refs.some((r) => r.insights_id === b.insights_id)) {
            return reply.code(400).send({
              ok: false,
              error: "insights_id not found in signal pack mimic carousel references",
            });
          }
        }
        fixture = await loadMimicTextOverlayFixtureFromInsights(db, b.insights_id, b.slide_index);
      } else {
        return reply.code(400).send({
          ok: false,
          error: "Provide insights_id (from signal pack reference) or fixture in request body",
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
