import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { getContentJobByTaskId } from "../repositories/jobs.js";
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
import {
  listJobSlidesForOverlayLab,
  listMimicCarouselJobsForRun,
  loadMimicTextOverlayFixtureFromJob,
  persistLabSlideCopyToJob,
} from "../services/mimic-text-overlay-lab-job.js";
import { rerenderCarouselTextOverlay } from "../services/job-pipeline.js";
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
  task_id: z.string().min(1).optional(),
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
${adminPhWithPipelineHtml("Mimic text overlay lab", "signal_pack", currentSlug, "Preview Document AI text placement — signal pack references or production jobs with stored art-only plates")}
<div class="content">
  <p class="runs-ops-hint">Preview on-image copy at <strong>Document AI</strong> bbox positions — same <span class="mono">buildMimicDocAiRenderTextLayers</span> path as production. Use <strong>Production run</strong> to load stored <span class="mono">MIMIC_BACKGROUND</span> plates (no Flux) and reprint text to assets.</p>
  <div class="card" style="margin-bottom:16px">
    <div class="card-h" style="display:flex;gap:8px;flex-wrap:wrap;padding:10px 16px 0">
      <button type="button" class="btn btn-sm mtol-tab-btn" data-tab="signal">Signal pack</button>
      <button type="button" class="btn btn-sm btn-ghost mtol-tab-btn" data-tab="production">Production run</button>
    </div>
    <div id="mtol-tab-signal" class="mtol-tab-panel">
    <div class="card-h" style="border-top:0">Import from signal pack</div>
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
      <div class="form-actions">
        <button type="submit" class="btn" id="mtol-preview-btn">Update preview</button>
        <button type="button" class="btn btn-ghost" id="mtol-load-slides-btn">List slides</button>
        <span id="mtol-msg" class="form-msg"></span>
      </div>
    </form>
    </div>
    <div id="mtol-tab-production" class="mtol-tab-panel" style="display:none">
    <form id="mtol-prod-form" class="config-form" style="padding:12px 16px 16px">
      <div class="form-group">
        <label for="mtol-run">Run</label>
        <select id="mtol-run" name="run_id">
          <option value="">— select project in sidebar, then load runs —</option>
        </select>
        <span id="mtol-run-hint" class="form-msg"></span>
      </div>
      <div class="form-group">
        <label for="mtol-job">Mimic carousel job</label>
        <select id="mtol-job" name="task_id" disabled>
          <option value="">— pick a run first —</option>
        </select>
        <span id="mtol-job-hint" class="form-msg"></span>
      </div>
      <div class="form-group">
        <label for="mtol-prod-slide">Slide index (1-based)</label>
        <input type="number" id="mtol-prod-slide" name="slide_index" value="1" min="1" style="max-width:120px">
        <span id="mtol-prod-slide-hint" class="form-msg"></span>
      </div>
      <div class="form-group">
        <label for="mtol-prod-copy">llm_slide JSON (from job generation_payload)</label>
        <textarea id="mtol-prod-copy" name="llm_slide_json" rows="8" placeholder='{"headline":"…","body":"…","text_blocks":[…]}'></textarea>
        <button type="button" class="btn btn-ghost btn-sm" id="mtol-prod-fill-copy-btn" style="margin-top:6px">Reload copy from job</button>
        <p class="form-msg" style="margin-top:6px;line-height:1.45">Edit copy here, then <strong>Update preview</strong> to iterate layout. Reprint uses this textarea when <em>Use lab copy</em> is checked.</p>
      </div>
      <div class="form-group" style="display:flex;flex-wrap:wrap;gap:14px;align-items:center">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="mtol-prod-use-lab-copy" checked> Use lab copy for reprint</label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="mtol-prod-persist-copy"> Save lab copy to job before reprint</label>
      </div>
      <div class="form-group">
        <label for="mtol-prod-bg">Background plate URL (MIMIC_BACKGROUND / MIMIC_VISUAL_PLATE)</label>
        <input type="url" id="mtol-prod-bg" name="background_image_url" placeholder="https://…" readonly style="opacity:0.9">
        <span id="mtol-prod-bg-hint" class="form-msg"></span>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn" id="mtol-prod-preview-btn">Update preview</button>
        <button type="button" class="btn btn-ghost" id="mtol-prod-load-slides-btn">List slides</button>
        <button type="button" class="btn btn-ghost" id="mtol-prod-save-copy-btn">Save copy to job</button>
        <button type="button" class="btn btn-ghost" id="mtol-prod-reprint-btn">Reprint text to assets</button>
        <span id="mtol-prod-msg" class="form-msg"></span>
      </div>
    </form>
    </div>
  </div>
  <div class="card" style="margin-bottom:16px">
    <div class="card-h">Preview options</div>
    <div class="config-form" style="padding:12px 16px 16px;display:flex;flex-wrap:wrap;gap:16px;align-items:center">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="mtol-boxes" checked> Render target boxes</label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="mtol-ghost"> Ghost original reference text</label>
      <button type="button" class="btn btn-ghost btn-sm" id="mtol-copy-debug-btn">Copy debug log</button>
      <span id="mtol-copy-debug-hint" class="form-msg"></span>
    </div>
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
      var previewUrl='/v1/admin/mimic-text-overlay-lab/preview'+(SLUG?'?project='+encodeURIComponent(SLUG):'');
      var r=await cafFetch(previewUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      var html=await r.text();
      if(!r.ok)throw new Error(html.slice(0,200));
      if(frame)frame.srcdoc=html;
      if(msg)msg.textContent='Preview updated';
    }catch(e){
      if(msg)msg.textContent=e.message||String(e);
    }
  });
  document.querySelectorAll('.mtol-tab-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      var tab=btn.getAttribute('data-tab');
      document.querySelectorAll('.mtol-tab-btn').forEach(function(b){
        b.classList.toggle('btn-ghost',b.getAttribute('data-tab')!==tab);
      });
      document.getElementById('mtol-tab-signal').style.display=tab==='signal'?'':'none';
      document.getElementById('mtol-tab-production').style.display=tab==='production'?'':'none';
      if(tab==='production')loadRuns();
    });
  });
  var prodForm=document.getElementById('mtol-prod-form');
  var prodMsg=document.getElementById('mtol-prod-msg');
  var runSel=document.getElementById('mtol-run');
  var jobSel=document.getElementById('mtol-job');
  var prodCopyTa=document.getElementById('mtol-prod-copy');
  var prodSlideHint=document.getElementById('mtol-prod-slide-hint');
  function taskId(){ return (jobSel&&jobSel.value||'').trim(); }
  function runId(){ return (runSel&&runSel.value||'').trim(); }
  async function loadRuns(){
    var hint=document.getElementById('mtol-run-hint');
    if(!SLUG){ if(hint)hint.textContent='Select a project in the sidebar'; return; }
    if(hint)hint.textContent='Loading runs…';
    try{
      var r=await cafFetch('/v1/admin/runs?project='+encodeURIComponent(SLUG)+'&limit=80');
      var d=await r.json();
      if(!r.ok)throw new Error(d.error||('HTTP '+r.status));
      var rows=Array.isArray(d.runs)?d.runs:[];
      if(!runSel)return;
      runSel.innerHTML='<option value="">— choose run —</option>'+rows.map(function(run){
        var label=(run.run_id||'')+' · '+String(run.status||'')+' · jobs '+(run.jobs_completed||0)+'/'+(run.total_jobs||0);
        return '<option value="'+esc(run.run_id)+'">'+esc(label)+'</option>';
      }).join('');
      if(hint)hint.textContent=rows.length?rows.length+' run(s)':'No runs for '+SLUG;
      var qs=new URLSearchParams(window.location.search);
      var wantRun=qs.get('run_id');
      var wantTask=qs.get('task_id');
      if(wantRun&&rows.some(function(run){return run.run_id===wantRun;})){
        runSel.value=wantRun;
        await loadJobs();
        if(wantTask&&jobSel){ jobSel.value=wantTask; await onJobPicked(false); }
      }
    }catch(e){
      if(hint)hint.textContent=e.message||String(e);
    }
  }
  async function loadJobs(){
    var hint=document.getElementById('mtol-job-hint');
    var rid=runId();
    if(!rid){
      if(jobSel){ jobSel.innerHTML='<option value="">— pick a run first —</option>'; jobSel.disabled=true; }
      return;
    }
    if(hint)hint.textContent='Loading mimic jobs…';
    try{
      var r=await cafFetch('/v1/admin/mimic-text-overlay-lab/runs/'+encodeURIComponent(rid)+'/mimic-jobs?project='+encodeURIComponent(SLUG));
      var d=await r.json();
      if(!r.ok)throw new Error(d.error||d.message||('HTTP '+r.status));
      var jobs=Array.isArray(d.jobs)?d.jobs:[];
      if(!jobSel)return;
      jobSel.disabled=jobs.length===0;
      jobSel.innerHTML=jobs.length?jobs.map(function(j){
        var label=j.task_id+' · '+j.status+' · plates '+j.background_plate_count+'/'+j.slide_count;
        return '<option value="'+esc(j.task_id)+'">'+esc(label)+'</option>';
      }).join(''):'<option value="">No mimic carousel jobs in this run</option>';
      if(hint)hint.textContent=jobs.length?jobs.length+' job(s)':'No TOP_PERFORMER_MIMIC_CAROUSEL jobs';
      if(jobs.length===1){ jobSel.value=jobs[0].task_id; await onJobPicked(false); }
    }catch(e){
      if(hint)hint.textContent=e.message||String(e);
    }
  }
  async function loadJobFixture(slideIndex){
    var tid=taskId();
    if(!tid||!prodCopyTa)return;
    var r=await cafFetch('/v1/admin/mimic-text-overlay-lab/jobs/'+encodeURIComponent(tid)+'/fixture?project='+encodeURIComponent(SLUG)+'&slide_index='+slideIndex);
    var d=await r.json();
    if(!r.ok)throw new Error(d.error||('HTTP '+r.status));
    prodCopyTa.value=JSON.stringify(d.fixture.llm_slide,null,2);
    var bgEl=document.getElementById('mtol-prod-bg');
    var bgHint=document.getElementById('mtol-prod-bg-hint');
    if(bgEl)bgEl.value=d.fixture.background_image_url||'';
    if(bgHint)bgHint.textContent=d.fixture.background_image_url?'Plate loaded from storage':'No stored plate — reprint needs MIMIC_BACKGROUND assets';
    return d.fixture;
  }
  async function onJobPicked(autoPreview){
    var tid=taskId();
    if(!tid)return;
    try{
      var slideIndex=parseInt(document.getElementById('mtol-prod-slide').value,10)||1;
      await loadJobFixture(slideIndex);
      await loadProdSlides();
      if(autoPreview!==false)prodForm.dispatchEvent(new Event('submit',{cancelable:true}));
    }catch(e){
      if(prodMsg)prodMsg.textContent=e.message||String(e);
    }
  }
  async function loadProdSlides(){
    var tid=taskId();
    if(!tid){ if(prodSlideHint)prodSlideHint.textContent='Pick a mimic job'; return; }
    if(prodSlideHint)prodSlideHint.textContent='Loading…';
    try{
      var r=await cafFetch('/v1/admin/mimic-text-overlay-lab/jobs/'+encodeURIComponent(tid)+'/slides?project='+encodeURIComponent(SLUG));
      var d=await r.json();
      if(!r.ok)throw new Error(d.error||d.message||('HTTP '+r.status));
      var slides=Array.isArray(d.slides)?d.slides:[];
      if(prodSlideHint){
        prodSlideHint.innerHTML=slides.length?slides.map(function(s){
          var plate=s.has_background_plate?' plate':' no-plate';
          var preview=esc((s.headline_preview||s.body_preview||'').slice(0,28));
          return '<button type="button" class="btn-ghost btn-sm" data-slide="'+s.slide_index+'" style="margin:2px 4px 2px 0">S'+s.slide_index+plate+': '+preview+'</button>';
        }).join(''):'No slides';
        prodSlideHint.querySelectorAll('button[data-slide]').forEach(function(btn){
          btn.addEventListener('click',async function(){
            document.getElementById('mtol-prod-slide').value=btn.getAttribute('data-slide');
            await loadJobFixture(parseInt(btn.getAttribute('data-slide'),10));
            prodForm.dispatchEvent(new Event('submit',{cancelable:true}));
          });
        });
      }
    }catch(e){
      if(prodSlideHint)prodSlideHint.textContent=e.message||String(e);
    }
  }
  if(runSel)runSel.addEventListener('change',function(){ loadJobs(); });
  if(jobSel)jobSel.addEventListener('change',function(){ onJobPicked(true); });
  document.getElementById('mtol-prod-load-slides-btn').addEventListener('click',loadProdSlides);
  document.getElementById('mtol-prod-fill-copy-btn').addEventListener('click',async function(){
    try{
      var slideIndex=parseInt(document.getElementById('mtol-prod-slide').value,10)||1;
      await loadJobFixture(slideIndex);
      if(prodMsg)prodMsg.textContent='Copy reloaded from job';
    }catch(e){ if(prodMsg)prodMsg.textContent=e.message||String(e); }
  });
  prodForm.addEventListener('submit',async function(ev){
    ev.preventDefault();
    if(prodMsg)prodMsg.textContent='Rendering…';
    var tid=taskId();
    if(!tid){ if(prodMsg)prodMsg.textContent='Pick a mimic job'; return; }
    var slideIndex=parseInt(document.getElementById('mtol-prod-slide').value,10)||1;
    var copyRaw=(prodCopyTa&&prodCopyTa.value||'').trim();
    var llmSlide=null;
    if(copyRaw){
      try{ llmSlide=JSON.parse(copyRaw); }catch(e){ if(prodMsg)prodMsg.textContent='Invalid llm_slide JSON'; return; }
    }
    var bg=(document.getElementById('mtol-prod-bg').value||'').trim()||null;
    var payload={
      task_id:tid,
      slide_index:slideIndex,
      show_debug_boxes:document.getElementById('mtol-boxes').checked,
      show_reference_ghost_text:document.getElementById('mtol-ghost').checked,
      background_image_url:bg
    };
    if(llmSlide)payload.llm_slide=llmSlide;
    try{
      var previewUrl='/v1/admin/mimic-text-overlay-lab/preview'+(SLUG?'?project='+encodeURIComponent(SLUG):'');
      var r=await cafFetch(previewUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      var html=await r.text();
      if(!r.ok)throw new Error(html.slice(0,200));
      if(frame)frame.srcdoc=html;
      if(prodMsg)prodMsg.textContent='Preview updated';
    }catch(e){
      if(prodMsg)prodMsg.textContent=e.message||String(e);
    }
  });
  function parseProdLlmSlide(){
    var copyRaw=(prodCopyTa&&prodCopyTa.value||'').trim();
    if(!copyRaw)return null;
    return JSON.parse(copyRaw);
  }
  document.getElementById('mtol-prod-save-copy-btn').addEventListener('click',async function(){
    var tid=taskId();
    if(!tid){ if(prodMsg)prodMsg.textContent='Pick a mimic job'; return; }
    var slideIndex=parseInt(document.getElementById('mtol-prod-slide').value,10)||1;
    var llmSlide;
    try{ llmSlide=parseProdLlmSlide(); if(!llmSlide)throw new Error('Paste llm_slide JSON first'); }catch(e){ if(prodMsg)prodMsg.textContent=e.message||String(e); return; }
    if(prodMsg)prodMsg.textContent='Saving copy to job…';
    try{
      var r=await cafFetch('/v1/admin/mimic-text-overlay-lab/jobs/'+encodeURIComponent(tid)+'/save-slide-copy?project='+encodeURIComponent(SLUG),{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ slide_index:slideIndex, llm_slide:llmSlide })
      });
      var d=await r.json();
      if(!r.ok)throw new Error(d.error||d.message||('HTTP '+r.status));
      if(prodCopyTa&&d.llm_slide)prodCopyTa.value=JSON.stringify(d.llm_slide,null,2);
      if(prodMsg)prodMsg.textContent='Copy saved to job (slide '+slideIndex+')';
    }catch(e){
      if(prodMsg)prodMsg.textContent=e.message||String(e);
    }
  });
  document.getElementById('mtol-prod-reprint-btn').addEventListener('click',async function(){
    var tid=taskId();
    var reprintBtn=document.getElementById('mtol-prod-reprint-btn');
    if(!tid){ if(prodMsg)prodMsg.textContent='Pick a mimic job'; return; }
    if(reprintBtn)reprintBtn.disabled=true;
    if(prodMsg)prodMsg.textContent='Reprinting text overlay (reuses stored plates)…';
    var slideIndex=parseInt(document.getElementById('mtol-prod-slide').value,10)||1;
    var useLabCopy=document.getElementById('mtol-prod-use-lab-copy')&&document.getElementById('mtol-prod-use-lab-copy').checked;
    var persistCopy=document.getElementById('mtol-prod-persist-copy')&&document.getElementById('mtol-prod-persist-copy').checked;
    var body={ slide_indices:[slideIndex] };
    if(useLabCopy){
      try{
        var llmSlide=parseProdLlmSlide();
        if(!llmSlide)throw new Error('Use lab copy is on — paste valid llm_slide JSON');
        body.llm_slide=llmSlide;
      }catch(e){
        if(prodMsg)prodMsg.textContent=e.message||String(e);
        if(reprintBtn)reprintBtn.disabled=false;
        return;
      }
    }
    if(persistCopy)body.persist_copy=true;
    try{
      var r=await cafFetch('/v1/admin/mimic-text-overlay-lab/jobs/'+encodeURIComponent(tid)+'/reprint?project='+encodeURIComponent(SLUG),{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body)
      });
      var d=await r.json();
      if(!r.ok&&r.status!==202)throw new Error(d.error||d.message||('HTTP '+r.status));
      if(!d.ok)throw new Error(d.error||d.message||'Reprint failed');
      if(r.status===202||d.accepted){
        if(prodMsg)prodMsg.textContent=d.message||'Reprint started — refresh preview in 1–2 minutes.';
        window.setTimeout(function(){
          loadProdSlides().then(function(){ prodForm.dispatchEvent(new Event('submit',{cancelable:true})); });
        },90000);
        return;
      }
      if(persistCopy){
        await loadJobFixture(slideIndex);
      }
      await loadProdSlides();
      prodForm.dispatchEvent(new Event('submit',{cancelable:true}));
      var rendered=Array.isArray(d.rendered_slides)?d.rendered_slides:[];
      var hit=rendered.find(function(s){ return s.slide_index===slideIndex; })||rendered[0];
      if(hit&&hit.rendered_slide_url){
        var bust=hit.rendered_slide_url+(hit.rendered_slide_url.indexOf('?')>=0?'&':'?')+'t='+Date.now();
        if(prodMsg)prodMsg.innerHTML='Reprint done — <a href="'+esc(bust)+'" target="_blank" rel="noopener">open CAROUSEL_SLIDE '+slideIndex+'</a>';
      }else if(prodMsg){
        prodMsg.textContent=(d.message||'Reprint finished')+' (no CAROUSEL_SLIDE asset yet — check renderer logs)';
      }
    }catch(e){
      if(prodMsg)prodMsg.textContent=e.message||String(e);
    }finally{
      if(reprintBtn)reprintBtn.disabled=false;
    }
  });
  var qsTab=new URLSearchParams(window.location.search).get('tab');
  document.getElementById('mtol-copy-debug-btn').addEventListener('click',async function(){
    var hint=document.getElementById('mtol-copy-debug-hint');
    try{
      var doc=frame&&frame.contentDocument;
      if(!doc)throw new Error('Update preview first');
      var innerBtn=doc.getElementById('btn-copy-debug-log');
      if(innerBtn){ innerBtn.click(); if(hint)hint.textContent='Copied debug log'; return; }
      var ta=doc.getElementById('lab-debug-log-text');
      if(!ta)throw new Error('No debug log in preview');
      var text=ta.value||ta.textContent||'';
      await navigator.clipboard.writeText(text);
      if(hint)hint.textContent='Copied debug log';
    }catch(e){
      if(hint)hint.textContent=e.message||String(e);
    }
  });
  if(qsTab==='production'){
    document.querySelector('.mtol-tab-btn[data-tab="production"]').click();
  }else{
    loadPacks();
  }
})();
</script>`;
}

const reprintBodySchema = z.object({
  slide_indices: z.array(z.coerce.number().int().min(1)).optional(),
  llm_slide: z.record(z.unknown()).optional(),
  persist_copy: z.boolean().optional(),
});

const saveSlideCopyBodySchema = z.object({
  slide_index: z.coerce.number().int().min(1),
  llm_slide: z.record(z.unknown()),
});

export function registerMimicTextOverlayLabRoutes(app: FastifyInstance, deps: MimicTextOverlayLabAdminDeps): void {
  const { db, config, wrapAdminPage, listProjects, resolveProject } = deps;

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

  app.get("/v1/admin/mimic-text-overlay-lab/runs/:runId/mimic-jobs", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const query = request.query as { project?: string };
    const project = await resolveProject(db, query.project);
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });
    const jobs = await listMimicCarouselJobsForRun(db, project.id, runId.trim());
    return { ok: true, run_id: runId, jobs };
  });

  app.get("/v1/admin/mimic-text-overlay-lab/jobs/:taskId/slides", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const query = request.query as { project?: string };
    const project = await resolveProject(db, query.project);
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });
    try {
      const result = await listJobSlidesForOverlayLab(db, config, project.id, taskId.trim());
      return { ok: true, ...result };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const code = message === "job_not_found" ? 404 : 400;
      return reply.code(code).send({ ok: false, error: message });
    }
  });

  app.get("/v1/admin/mimic-text-overlay-lab/jobs/:taskId/fixture", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const query = request.query as { project?: string; slide_index?: string };
    const project = await resolveProject(db, query.project);
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });
    const slideIndex = Math.max(1, parseInt(query.slide_index ?? "1", 10) || 1);
    try {
      const fixture = await loadMimicTextOverlayFixtureFromJob(
        db,
        config,
        project.id,
        taskId.trim(),
        slideIndex
      );
      return { ok: true, task_id: taskId, slide_index: slideIndex, fixture };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.code(400).send({ ok: false, error: message });
    }
  });

  app.post("/v1/admin/mimic-text-overlay-lab/jobs/:taskId/save-slide-copy", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const query = request.query as { project?: string };
    const project = await resolveProject(db, query.project);
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });
    const parsed = saveSlideCopyBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    try {
      const saved = await persistLabSlideCopyToJob(
        db,
        project.id,
        taskId.trim(),
        parsed.data.slide_index,
        parsed.data.llm_slide
      );
      return { ok: true, task_id: taskId, ...saved, message: `Copy saved for slide ${parsed.data.slide_index}` };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.code(400).send({ ok: false, error: message });
    }
  });

  app.post("/v1/admin/mimic-text-overlay-lab/jobs/:taskId/reprint", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const query = request.query as { project?: string };
    const project = await resolveProject(db, query.project);
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found" });
    const parsed = reprintBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const job = await getContentJobByTaskId(db, project.id, taskId.trim());
    if (!job) return reply.code(404).send({ ok: false, error: "job_not_found" });
    const jobId = String(job.id ?? "");
    if (!jobId) return reply.code(400).send({ ok: false, error: "job_missing_id" });
    const indices = parsed.data.slide_indices;
    const primarySlide = indices?.[0] ?? 1;
    try {
      if (parsed.data.persist_copy && parsed.data.llm_slide) {
        await persistLabSlideCopyToJob(db, project.id, taskId.trim(), primarySlide, parsed.data.llm_slide);
      }
      const slideCopyOverrides =
        parsed.data.llm_slide != null
          ? [{ slide_index: primarySlide, llm_slide: parsed.data.llm_slide }]
          : undefined;

      void rerenderCarouselTextOverlay(db, config, jobId, indices, { slideCopyOverrides })
        .then(() => {
          request.log.info({ task_id: taskId, slide_indices: indices ?? "all" }, "admin lab text overlay reprint completed");
        })
        .catch((err) => {
          request.log.error({ err, task_id: taskId }, "admin lab text overlay reprint failed");
        });

      const slideHint =
        indices && indices.length > 0 ? `slide(s) ${indices.join(", ")}` : "all slides";
      return reply.code(202).send({
        ok: true,
        accepted: true,
        task_id: taskId,
        message: `Text overlay reprint started for ${slideHint} (reuses stored plates, no Flux). Refresh in 1–2 minutes.`,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.code(400).send({ ok: false, error: message });
    }
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
      } else if (b.task_id) {
        const query = request.query as { project?: string };
        const project = await resolveProject(db, query.project);
        if (!project) {
          return reply.code(404).send({ ok: false, error: "Project not found" });
        }
        fixture = await loadMimicTextOverlayFixtureFromJob(
          db,
          config,
          project.id,
          b.task_id,
          b.slide_index
        );
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
          error: "Provide task_id (production job), insights_id (signal pack reference), or fixture in request body",
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
        llmSlide: fixture.llm_slide,
        taskId: fixture.task_id,
        runId: fixture.run_id,
        backgroundImageUrl: fixture.background_image_url,
        renderedSlideUrl: fixture.rendered_slide_url,
      });
      return reply.header("Cache-Control", "no-store").type("text/html; charset=utf-8").send(html);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.code(400).type("text/html").send(`<pre>${esc(message)}</pre>`);
    }
  });
}
