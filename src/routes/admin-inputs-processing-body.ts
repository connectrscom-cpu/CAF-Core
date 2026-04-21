/** Inner HTML + script for GET /admin/inputs-processing (tabbed Inputs vs Processing). */

export function adminInputsProcessingBody(currentSlug: string): string {
  const SLUG = JSON.stringify(currentSlug);
  return `
<div class="ph"><div><h2>Inputs &amp; processing</h2><span class="ph-sub">Evidence from XLSX uploads · criteria · OpenAI audit · build signal packs for runs</span></div></div>
<div class="content">
  <div class="card" style="margin-bottom:14px">
    <div style="display:flex;gap:8px;border-bottom:1px solid var(--border);padding:0 12px">
      <button type="button" class="btn btn-sm" id="tab-inputs" style="border-radius:8px 8px 0 0">Inputs</button>
      <button type="button" class="btn-ghost btn-sm" id="tab-processing" style="border-radius:8px 8px 0 0">Processing</button>
    </div>
    <div id="panel-inputs" style="padding:12px 16px 16px">
      <p class="runs-ops-hint">Imports come from <span class="mono">POST /v1/inputs-evidence/upload</span> or Review → Pipeline. Pick a row to see sheet-level stats (posts, subreddits, handles, registry links).</p>
      <div id="imports-toolbar" style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button type="button" class="btn btn-sm" id="btn-reload-imports">Reload imports</button>
        <span id="imports-hint" style="font-size:12px;color:var(--muted)"></span>
      </div>
      <div id="imports-root" class="empty">Loading…</div>
      <div id="import-detail" style="margin-top:16px;display:none">
        <h3 style="font-size:14px;margin-bottom:8px">Selected import</h3>
        <pre id="import-stats" style="font-size:11px;background:var(--bg);padding:10px;border-radius:8px;overflow:auto;max-height:220px"></pre>
        <p style="margin-top:10px">
          <button type="button" class="btn btn-sm" id="btn-build-pack">Rate rows (OpenAI) + build signal pack</button>
          <span id="build-msg" style="margin-left:10px;font-size:12px;color:var(--muted)"></span>
        </p>
      </div>
    </div>
    <div id="panel-processing" style="display:none;padding:12px 16px 16px">
      <p class="runs-ops-hint">Criteria live in <span class="mono">criteria_json.weights</span> (component → weight). Caps control cost. OpenAI calls use steps <span class="mono">inputs_rating_batch</span> and <span class="mono">inputs_signal_pack_synthesize</span> in <span class="mono">api_call_audit</span>.</p>
      <form id="profile-form" class="config-form" style="max-width:720px">
        <div class="form-group"><label>Rating model</label><input type="text" name="rating_model" id="pf-rating-model" placeholder="gpt-4o-mini"></div>
        <div class="form-group"><label>Synthesis model</label><input type="text" name="synth_model" id="pf-synth-model" placeholder="gpt-4o-mini"></div>
        <div class="form-group"><label>Max rows to rate (per import)</label><input type="number" name="max_rows_for_rating" id="pf-max-rows" min="1" max="5000"></div>
        <div class="form-group"><label>Rows per OpenAI batch</label><input type="number" name="max_rows_per_llm_batch" id="pf-batch" min="1" max="80"></div>
        <div class="form-group"><label>Max ideas in signal pack</label><input type="number" name="max_ideas_in_signal_pack" id="pf-ideas" min="1" max="200"></div>
        <div class="form-group"><label>Min LLM score to include before synthesis pool</label><input type="number" name="min_llm_score_for_pack" id="pf-min" step="0.01" min="0" max="1"></div>
        <div class="form-group"><label>criteria_json (JSON)</label><textarea name="criteria_json" id="pf-criteria" rows="8" style="width:100%;font-family:ui-monospace,monospace;font-size:11px"></textarea></div>
        <div class="form-group"><label>Extra instructions (prepended to rating prompt)</label><textarea name="extra_instructions" id="pf-extra" rows="4" style="width:100%"></textarea></div>
        <button type="submit" class="btn">Save profile</button>
      </form>
      <h3 style="font-size:14px;margin:20px 0 8px">Recent OpenAI / pipeline audit</h3>
      <button type="button" class="btn-ghost btn-sm" id="btn-reload-audit">Refresh audit</button>
      <div id="audit-root" style="margin-top:10px;font-size:11px;max-height:420px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px">Loading…</div>
    </div>
  </div>
</div>
<script>
const SLUG=${SLUG};
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function apiErr(d,fallback){return (d&&d.message)||(d&&d.error)||fallback;}
let selectedImportId='';
function showTab(which){
  document.getElementById('panel-inputs').style.display=which==='inputs'?'block':'none';
  document.getElementById('panel-processing').style.display=which==='processing'?'block':'none';
  var a=document.getElementById('tab-inputs');
  var b=document.getElementById('tab-processing');
  if(a&&b){
    a.className='btn btn-sm'+(which==='inputs'?'':' btn-ghost');
    b.className='btn btn-sm'+(which==='processing'?'':' btn-ghost');
  }
}
document.getElementById('tab-inputs')?.addEventListener('click',function(){showTab('inputs');});
document.getElementById('tab-processing')?.addEventListener('click',function(){showTab('processing');if(SLUG)loadProfile();if(SLUG)loadAudit();});

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
    var tb='<table class="sp-modal-table"><thead><tr><th>Created</th><th>File</th><th>Rows</th><th></th></tr></thead><tbody>';
    for(var i=0;i<rows.length;i++){
      var x=rows[i];
      tb+='<tr><td>'+esc(String(x.created_at||'').slice(0,19))+'</td><td>'+esc(x.upload_filename||'—')+'</td><td>'+esc(x.stored_row_count)+'</td><td><button type="button" class="btn-ghost btn-sm sel-import" data-id="'+esc(x.id)+'">Select</button></td></tr>';
    }
    tb+='</tbody></table>';
    root.innerHTML=tb;
    hint.textContent=rows.length+' import(s)';
    root.querySelectorAll('.sel-import').forEach(function(btn){
      btn.addEventListener('click',function(){
        selectedImportId=btn.getAttribute('data-id')||'';
        document.getElementById('import-detail').style.display='block';
        loadImportStats();
      });
    });
  }catch(e){root.innerHTML='<div class="empty" style="color:var(--red)">'+esc(e.message||e)+'</div>';}
}
async function loadImportStats(){
  var pre=document.getElementById('import-stats');
  if(!SLUG||!selectedImportId){pre.textContent='';return;}
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
    document.getElementById('pf-rating-model').value=p.rating_model||'';
    document.getElementById('pf-synth-model').value=p.synth_model||'';
    document.getElementById('pf-max-rows').value=p.max_rows_for_rating;
    document.getElementById('pf-batch').value=p.max_rows_per_llm_batch;
    document.getElementById('pf-ideas').value=p.max_ideas_in_signal_pack;
    document.getElementById('pf-min').value=p.min_llm_score_for_pack;
    document.getElementById('pf-criteria').value=JSON.stringify(p.criteria_json||{},null,2);
    document.getElementById('pf-extra').value=p.extra_instructions||'';
  }catch(e){alert(e.message||e);}
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
document.getElementById('btn-build-pack')?.addEventListener('click',async function(){
  var msg=document.getElementById('build-msg');
  if(!SLUG||!selectedImportId){msg.textContent='Select an import first.';return;}
  msg.textContent='Working (OpenAI)…';
  try{
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/build-signal-pack',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    var raw=await r.text();
    var d;try{d=JSON.parse(raw);}catch{throw new Error(raw.slice(0,400));}
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    msg.innerHTML='Done. Signal pack <a class="btn-ghost btn-sm" href="/admin/signal-pack?project='+encodeURIComponent(SLUG)+'&id='+encodeURIComponent(d.signal_pack_id)+'">open</a> · insights pack <span class="mono">'+esc(d.insights_pack_id||'')+'</span> · '+d.overall_candidates_count+' ideas · rated '+d.rows_rated+'/'+d.rows_considered_for_rating+' rows.';
  }catch(e){msg.textContent=String(e);msg.style.color='var(--red)';}
});
showTab('inputs');
if(SLUG)loadImports();
</script>`;
}
