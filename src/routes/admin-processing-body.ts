/** Inner HTML + script for GET /admin/processing — imports, evidence by platform, insights, top-performer passes, profile. */

export function adminProcessingBody(currentSlug: string): string {
  const SLUG = JSON.stringify(currentSlug);
  const inputsPq = currentSlug ? `?project=${encodeURIComponent(currentSlug)}` : "";
  return `
<div class="ph"><div><h2>Processing</h2><span class="ph-sub">Pre-LLM evidence · broad LLM · top-performer image, carousel, video · profile · signal packs</span></div></div>
<div class="content">
  <div class="card" style="margin-bottom:14px">
    <div style="padding:12px 16px 8px">
      <p class="runs-ops-hint">Select an import, then use the segments below. Carousels need ≥2 HTTPS URLs (e.g. <span class="mono">carousel_slide_urls</span>). Video uses <span class="mono">analysis_frame_urls</span> + transcript — no raw MP4 in Core.</p>
      <div id="imports-toolbar" style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button type="button" class="btn btn-sm" id="btn-reload-imports">Reload imports</button>
        <a class="btn-ghost btn-sm" href="/admin/inputs${inputsPq}">Upload on Inputs</a>
        <span id="imports-hint" style="font-size:12px;color:var(--muted)"></span>
      </div>
      <div id="imports-root" class="empty">Loading…</div>
      <div id="import-workbench" style="display:none;margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
        <div style="display:flex;gap:8px;border-bottom:1px solid var(--border);padding:0 0 8px;flex-wrap:wrap">
          <button type="button" class="btn btn-sm" id="seg-evidence" style="border-radius:8px 8px 0 0">Evidence</button>
          <button type="button" class="btn-ghost btn-sm" id="seg-broad" style="border-radius:8px 8px 0 0">Insights (broad)</button>
          <button type="button" class="btn-ghost btn-sm" id="seg-top" style="border-radius:8px 8px 0 0">Top performers</button>
          <button type="button" class="btn-ghost btn-sm" id="seg-profile" style="border-radius:8px 8px 0 0">Profile &amp; audit</button>
        </div>
        <div id="panel-evidence" style="padding:12px 0 0">
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
            <button type="button" class="btn btn-sm" id="btn-build-pack">Build signal pack</button>
            <span id="build-msg" style="font-size:12px;color:var(--muted)"></span>
          </div>
          <pre id="import-stats" style="font-size:11px;background:var(--bg);padding:10px;border-radius:8px;overflow:auto;max-height:180px;margin-bottom:12px"></pre>
          <div id="prellm-root">
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
              <button type="button" class="btn btn-sm" id="btn-run-broad-insights">Run broad LLM (text)</button>
              <span id="prellm-insight-msg" style="font-size:12px;color:var(--muted);max-width:520px"></span>
            </div>
            <div id="prellm-kind-bar" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px"></div>
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px">
              <label style="font-size:13px">Min pre-LLM score <span id="prellm-min-val" class="mono">0.00</span></label>
              <input type="range" id="prellm-min-score" min="0" max="1" step="0.01" value="0" style="width:min(420px,100%)" />
            </div>
            <pre id="prellm-counts" style="font-size:12px;background:var(--bg);padding:10px;border-radius:8px;margin-bottom:10px;white-space:pre-wrap"></pre>
            <div id="prellm-table-wrap" style="font-size:12px;max-height:480px;overflow:auto;border:1px solid var(--border);border-radius:8px"></div>
          </div>
        </div>
        <div id="panel-broad" style="display:none;padding:12px 0 0">
          <p class="runs-ops-hint" style="margin-bottom:10px">Text-only <span class="mono">broad_llm</span> rows stored per evidence row. Filter by platform tab.</p>
          <div id="broad-kind-bar" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px"></div>
          <button type="button" class="btn-ghost btn-sm" id="btn-reload-broad">Reload broad insights</button>
          <pre id="broad-meta" style="font-size:12px;background:var(--bg);padding:10px;border-radius:8px;margin:10px 0;white-space:pre-wrap"></pre>
          <div id="broad-table-wrap" style="font-size:12px;max-height:520px;overflow:auto;border:1px solid var(--border);border-radius:8px"></div>
        </div>
        <div id="panel-top" style="display:none;padding:12px 0 0">
          <p class="runs-ops-hint" style="margin-bottom:10px"><strong>Top performers</strong> — single image (<span class="mono">top_performer_deep</span>), carousel deck (<span class="mono">top_performer_carousel</span>, ≥2 <span class="mono">carousel_slide_urls</span>), video frames (<span class="mono">top_performer_video</span>). Tune caps in <span class="mono">criteria_json.top_performer</span> and <span class="mono">inputs_insights</span>.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
            <button type="button" class="btn btn-sm" id="btn-run-deep-image-insights">Run top-performer (images)</button>
            <button type="button" class="btn btn-sm" id="btn-run-deep-carousel-insights">Run top-performer (carousel)</button>
            <button type="button" class="btn btn-sm" id="btn-run-deep-video-insights">Run top-performer (video frames)</button>
            <span id="top-insight-msg" style="font-size:12px;color:var(--muted);max-width:560px"></span>
          </div>
          <h4 style="font-size:13px;margin:16px 0 8px">Image deep rows</h4>
          <button type="button" class="btn-ghost btn-sm" id="btn-reload-deep-image">Reload</button>
          <div id="deep-image-table" style="margin-top:8px;font-size:12px;max-height:360px;overflow:auto;border:1px solid var(--border);border-radius:8px"></div>
          <h4 style="font-size:13px;margin:16px 0 8px">Carousel deck rows</h4>
          <button type="button" class="btn-ghost btn-sm" id="btn-reload-deep-carousel">Reload</button>
          <div id="deep-carousel-table" style="margin-top:8px;font-size:12px;max-height:360px;overflow:auto;border:1px solid var(--border);border-radius:8px"></div>
          <h4 style="font-size:13px;margin:16px 0 8px">Video frame rows</h4>
          <button type="button" class="btn-ghost btn-sm" id="btn-reload-deep-video">Reload</button>
          <div id="deep-video-table" style="margin-top:8px;font-size:12px;max-height:360px;overflow:auto;border:1px solid var(--border);border-radius:8px"></div>
        </div>
        <div id="panel-profile" style="display:none;padding:12px 0 0">
          <p class="runs-ops-hint">Models, caps, <span class="mono">criteria_json</span> (pre-LLM, top_performer, insight column labels). OpenAI audit tail for inputs pipeline steps.</p>
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
  </div>
</div>
<script>
const SLUG=${SLUG};
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function apiErr(d,fallback){return (d&&d.message)||(d&&d.error)||fallback;}
let selectedImportId='';
var prellmKind='';
var prellmKinds=[];
var broadKind='';
var broadKinds=[];
var prellmTimer=null;
var currentSeg='evidence';

function readImportFromUrl(){
  try{
    var u=new URLSearchParams(window.location.search);
    var imp=u.get('import');
    if(imp&&/^[0-9a-f-]{36}$/i.test(imp))selectedImportId=imp;
  }catch(e){}
}

function setImportInUrl(id){
  var url=new URL(window.location.href);
  if(id)url.searchParams.set('import',id);else url.searchParams.delete('import');
  window.history.replaceState({},'',url.toString());
}

function showSeg(which){
  currentSeg=which;
  document.getElementById('panel-evidence').style.display=which==='evidence'?'block':'none';
  document.getElementById('panel-broad').style.display=which==='broad'?'block':'none';
  document.getElementById('panel-top').style.display=which==='top'?'block':'none';
  document.getElementById('panel-profile').style.display=which==='profile'?'block':'none';
  var ids=[['seg-evidence','evidence'],['seg-broad','broad'],['seg-top','top'],['seg-profile','profile']];
  for(var i=0;i<ids.length;i++){
    var el=document.getElementById(ids[i][0]);
    if(!el)continue;
    el.className='btn btn-sm'+(which===ids[i][1]?'':' btn-ghost');
  }
  if(which==='broad')initBroadPanel();
  if(which==='top'){loadDeepImageTable();loadDeepCarouselTable();loadDeepVideoTable();}
  if(which==='profile'){loadProfile();loadAudit();}
}

document.getElementById('seg-evidence')?.addEventListener('click',function(){showSeg('evidence');});
document.getElementById('seg-broad')?.addEventListener('click',function(){showSeg('broad');});
document.getElementById('seg-top')?.addEventListener('click',function(){showSeg('top');});
document.getElementById('seg-profile')?.addEventListener('click',function(){showSeg('profile');});

async function loadImports(){
  var root=document.getElementById('imports-root');
  var hint=document.getElementById('imports-hint');
  var wb=document.getElementById('import-workbench');
  if(!SLUG){root.innerHTML='<div class="empty">Select a project in the sidebar.</div>';return;}
  root.innerHTML='Loading…';
  try{
    var r=await cafFetch('/v1/inputs-evidence/'+encodeURIComponent(SLUG));
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var rows=d.imports||[];
    if(rows.length===0){root.innerHTML='<div class="empty">No evidence imports for this project.</div>';hint.textContent='';wb.style.display='none';return;}
    var tb='<table class="sp-modal-table"><thead><tr><th>Created</th><th>File</th><th>Rows</th><th></th></tr></thead><tbody>';
    for(var i=0;i<rows.length;i++){
      var x=rows[i];
      var sel=x.id===selectedImportId?'btn btn-sm':'btn-ghost btn-sm';
      tb+='<tr><td>'+esc(String(x.created_at||'').slice(0,19))+'</td><td>'+esc(x.upload_filename||'—')+'</td><td>'+esc(x.stored_row_count)+'</td><td><button type="button" class="'+sel+' sel-import" data-id="'+esc(x.id)+'">Select</button></td></tr>';
    }
    tb+='</tbody></table>';
    root.innerHTML=tb;
    hint.textContent=rows.length+' import(s)';
    root.querySelectorAll('.sel-import').forEach(function(btn){
      btn.addEventListener('click',function(){
        selectedImportId=btn.getAttribute('data-id')||'';
        setImportInUrl(selectedImportId);
        wb.style.display='block';
        loadImportStats();
        loadPrellmKindsAndPreview();
        showSeg(currentSeg);
        loadImports();
      });
    });
    if(selectedImportId){
      wb.style.display='block';
      loadImportStats();
      loadPrellmKindsAndPreview();
      showSeg(currentSeg);
    }
  }catch(e){root.innerHTML='<div class="empty" style="color:var(--red)">'+esc(e.message||e)+'</div>';}
}

async function loadImportStats(){
  var pre=document.getElementById('import-stats');
  if(!SLUG||!selectedImportId||!pre){pre.textContent='';return;}
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

async function loadPrellmKindsAndPreview(){
  if(!SLUG||!selectedImportId)return;
  var bar=document.getElementById('prellm-kind-bar');
  if(!bar)return;
  bar.innerHTML='Loading kinds…';
  try{
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/stats');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var bk=d.stats&&d.stats.by_kind||{};
    prellmKinds=Object.keys(bk).filter(function(k){return (bk[k]||0)>0;}).sort();
    if(prellmKinds.length===0){bar.innerHTML='<span class="empty">No rows in this import.</span>';return;}
    if(!prellmKind||prellmKinds.indexOf(prellmKind)<0)prellmKind=prellmKinds[0];
    var h='';
    for(var i=0;i<prellmKinds.length;i++){
      var k=prellmKinds[i];
      h+='<button type="button" class="'+(k===prellmKind?'btn btn-sm':'btn-ghost btn-sm')+' prellm-kind" data-kind="'+esc(k)+'">'+
        esc(k)+' <span style="color:var(--muted)">('+String(bk[k]||0)+')</span></button>';
    }
    bar.innerHTML=h;
    bar.querySelectorAll('.prellm-kind').forEach(function(btn){
      btn.addEventListener('click',function(){
        prellmKind=btn.getAttribute('data-kind')||'';
        loadPrellmKindsAndPreview();
      });
    });
    schedulePrellmPreview();
    syncBroadKindsFromStats(bk);
  }catch(e){bar.innerHTML='<span style="color:var(--red)">'+esc(e.message||e)+'</span>';}
}

function syncBroadKindsFromStats(bk){
  broadKinds=Object.keys(bk).filter(function(k){return (bk[k]||0)>0;}).sort();
  if(!broadKind||broadKinds.indexOf(broadKind)<0)broadKind=broadKinds[0]||'';
}

function schedulePrellmPreview(){
  if(prellmTimer)clearTimeout(prellmTimer);
  prellmTimer=setTimeout(loadPrellmPreview,220);
}

async function loadPrellmPreview(){
  var counts=document.getElementById('prellm-counts');
  var wrap=document.getElementById('prellm-table-wrap');
  var minEl=document.getElementById('prellm-min-score');
  var minVal=document.getElementById('prellm-min-val');
  if(!SLUG||!selectedImportId||!prellmKind||!counts||!wrap||!minEl)return;
  var minScore=parseFloat(minEl.value)||0;
  if(minVal)minVal.textContent=minScore.toFixed(2);
  counts.textContent='Loading…';
  wrap.innerHTML='';
  try{
    var q='evidence_kind='+encodeURIComponent(prellmKind)+'&min_score='+encodeURIComponent(String(minScore))+'&limit=80&offset=0';
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/pre-llm-evidence?'+q);
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    var t=d.totals||{};
    counts.textContent=JSON.stringify({
      evidence_kind:d.evidence_kind,
      min_score_cutoff:d.min_score_cutoff,
      profile_min_score:d.profile_min_score,
      rows_in_kind:t.rows_in_kind,
      sparse_text_dropped:t.sparse_text_dropped,
      below_profile_min_dropped:t.below_profile_min_dropped,
      passing_profile_min:t.passing_profile_min,
      after_user_cutoff:t.after_user_cutoff,
      showing_page:d.rows?d.rows.length:0
    },null,2);
    var rows=d.rows||[];
    if(rows.length===0){wrap.innerHTML='<div class="empty" style="padding:12px">No rows at or above this cutoff.</div>';return;}
    var tb='<table class="sp-modal-table"><thead><tr><th>Score</th><th>URL</th><th>Caption</th><th>Hashtags</th></tr></thead><tbody>';
    for(var i=0;i<rows.length;i++){
      var x=rows[i];
      var urlCell=x.url?('<a href="'+esc(x.url)+'" target="_blank" rel="noopener">'+esc(x.url.slice(0,140))+'</a>'):'<span style="color:var(--muted)">—</span>';
      tb+='<tr><td class="mono">'+esc(String(x.pre_llm_score))+'</td><td style="max-width:200px;word-break:break-all">'+urlCell+'</td><td style="max-width:360px;white-space:pre-wrap;word-break:break-word">'+esc(x.caption||'')+'</td><td style="max-width:200px;word-break:break-word">'+esc(x.hashtags||'')+'</td></tr>';
    }
    tb+='</tbody></table>';
    wrap.innerHTML=tb;
  }catch(e){counts.textContent=String(e);}
}
document.getElementById('prellm-min-score')?.addEventListener('input',schedulePrellmPreview);

document.getElementById('btn-run-broad-insights')?.addEventListener('click',async function(){
  var msg=document.getElementById('prellm-insight-msg');
  if(!SLUG||!selectedImportId){if(msg)msg.textContent='Select an import first.';return;}
  if(msg){msg.textContent='Running broad LLM…';}
  try{
    var body={evidence_kind:prellmKind||null,max_rows:800,rescan:false};
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/run-broad-insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json().catch(function(){return {};});
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    if(msg)msg.textContent='Broad done: upserted '+String(d.upserted||0)+' · batches '+String(d.batches||0)+' · total '+String(d.broad_insights_total||0)+'.';
  }catch(e){if(msg){msg.textContent=String(e.message||e);msg.style.color='var(--red)';}}
});

document.getElementById('btn-run-deep-image-insights')?.addEventListener('click',async function(){
  var msg=document.getElementById('top-insight-msg');
  if(!SLUG||!selectedImportId){if(msg)msg.textContent='Select an import first.';return;}
  if(msg){msg.textContent='Running image vision…';msg.style.color='';}
  try{
    var minScore=parseFloat(document.getElementById('prellm-min-score')?.value||'0.35')||0.35;
    var body={max_rows:24,min_pre_llm_score:minScore,rescan:false};
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/run-deep-image-insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json().catch(function(){return {};});
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    if(msg)msg.textContent='Image deep: analyzed '+String(d.rows_analyzed||0)+' · pool '+String(d.candidates_with_image||0)+' · skipped carousel '+String(d.skipped_carousel||0)+' · skipped video-like '+String(d.skipped_video||0)+' · no image URL '+String(d.skipped_no_image||0)+' · total deep '+String(d.deep_insights_total||0)+'.';
    loadDeepImageTable();
  }catch(e){if(msg){msg.textContent=String(e.message||e);msg.style.color='var(--red)';}}
});

document.getElementById('btn-run-deep-carousel-insights')?.addEventListener('click',async function(){
  var msg=document.getElementById('top-insight-msg');
  if(!SLUG||!selectedImportId){if(msg)msg.textContent='Select an import first.';return;}
  if(msg){msg.textContent='Running carousel vision (all slides)…';msg.style.color='';}
  try{
    var minScore=parseFloat(document.getElementById('prellm-min-score')?.value||'0.35')||0.35;
    var body={max_rows:12,min_pre_llm_score:minScore,max_slides:12,rescan:false};
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/run-deep-carousel-insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json().catch(function(){return {};});
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    if(msg)msg.textContent='Carousel deep: analyzed '+String(d.rows_analyzed||0)+' · slide pool '+String(d.candidates_with_slides||0)+' · deck-shaped rows '+String(d.carousel_deck_rows||0)+' · total '+String(d.carousel_insights_total||0)+'.';
    loadDeepCarouselTable();
  }catch(e){if(msg){msg.textContent=String(e.message||e);msg.style.color='var(--red)';}}
});

document.getElementById('btn-run-deep-video-insights')?.addEventListener('click',async function(){
  var msg=document.getElementById('top-insight-msg');
  if(!SLUG||!selectedImportId){if(msg)msg.textContent='Select an import first.';return;}
  if(msg){msg.textContent='Running video frame bundle…';msg.style.color='';}
  try{
    var minScore=parseFloat(document.getElementById('prellm-min-score')?.value||'0.35')||0.35;
    var body={max_rows:16,min_pre_llm_score:minScore,max_frames:10,rescan:false};
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/run-deep-video-insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json().catch(function(){return {};});
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    if(msg)msg.textContent='Video deep: analyzed '+String(d.rows_analyzed||0)+' · frame pool '+String(d.candidates_with_frames||0)+' · video rows '+String(d.video_evidence_rows||0)+' · no-frame skips '+String(d.skipped_no_frames||0)+' · total '+String(d.video_insights_total||0)+'.';
    loadDeepVideoTable();
  }catch(e){if(msg){msg.textContent=String(e.message||e);msg.style.color='var(--red)';}}
});

async function initBroadPanel(){
  var bar=document.getElementById('broad-kind-bar');
  var meta=document.getElementById('broad-meta');
  var wrap=document.getElementById('broad-table-wrap');
  if(!bar||!SLUG||!selectedImportId)return;
  if(!broadKinds.length){
    bar.innerHTML='Loading kinds…';
    try{
      var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/stats');
      var d=await r.json();
      if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
      syncBroadKindsFromStats((d.stats&&d.stats.by_kind)||{});
    }catch(e){
      bar.innerHTML='<span style="color:var(--red)">'+esc(e.message||e)+'</span>';
      return;
    }
  }
  if(!broadKinds.length){
    bar.innerHTML='<span class="empty">No rows in this import.</span>';
    if(meta)meta.textContent='';
    if(wrap)wrap.innerHTML='';
    return;
  }
  var h='';
  for(var i=0;i<broadKinds.length;i++){
    var k=broadKinds[i];
    h+='<button type="button" class="'+(k===broadKind?'btn btn-sm':'btn-ghost btn-sm')+' broad-kind" data-kind="'+esc(k)+'">'+esc(k)+'</button>';
  }
  bar.innerHTML=h;
  bar.querySelectorAll('.broad-kind').forEach(function(btn){
    btn.addEventListener('click',function(){
      broadKind=btn.getAttribute('data-kind')||'';
      initBroadPanel();
    });
  });
  loadBroadTable();
}

async function loadBroadTable(){
  var meta=document.getElementById('broad-meta');
  var wrap=document.getElementById('broad-table-wrap');
  if(!SLUG||!selectedImportId||!broadKind||!meta||!wrap)return;
  meta.textContent='Loading…';
  wrap.innerHTML='';
  try{
    var q='tier=broad_llm&evidence_kind='+encodeURIComponent(broadKind)+'&limit=80&offset=0';
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/evidence-insights?'+q);
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    meta.textContent=JSON.stringify({counts:d.counts,evidence_kind:broadKind},null,2);
    var rows=d.insights||[];
    if(rows.length===0){wrap.innerHTML='<div class="empty" style="padding:12px">No broad insights for this platform yet. Run broad from Evidence.</div>';return;}
    var tb='<table class="sp-modal-table"><thead><tr><th>Kind</th><th>Why it worked</th><th>Hook</th><th>Emotion</th></tr></thead><tbody>';
    for(var i=0;i<rows.length;i++){
      var x=rows[i];
      tb+='<tr><td class="mono">'+esc(x.evidence_kind)+'</td><td style="max-width:360px;white-space:pre-wrap">'+esc(x.why_it_worked||'')+'</td><td>'+esc(x.hook_text||'')+'</td><td>'+esc(x.primary_emotion||'')+'</td></tr>';
    }
    tb+='</tbody></table>';
    wrap.innerHTML=tb;
  }catch(e){meta.textContent=String(e);}
}
document.getElementById('btn-reload-broad')?.addEventListener('click',loadBroadTable);

function renderInsightTable(rows,cols){
  if(!rows.length)return '<div class="empty" style="padding:12px">No rows.</div>';
  var tb='<table class="sp-modal-table"><thead><tr>';
  for(var c=0;c<cols.length;c++)tb+='<th>'+esc(cols[c].label)+'</th>';
  tb+='</tr></thead><tbody>';
  for(var i=0;i<rows.length;i++){
    var x=rows[i];
    tb+='<tr>';
    for(var j=0;j<cols.length;j++){
      var v=x[cols[j].key];
      tb+='<td style="max-width:420px;white-space:pre-wrap;word-break:break-word">'+esc(typeof v==='string'?v:JSON.stringify(v||''))+'</td>';
    }
    tb+='</tr>';
  }
  tb+='</tbody></table>';
  return tb;
}

async function loadDeepImageTable(){
  var el=document.getElementById('deep-image-table');
  if(!SLUG||!selectedImportId||!el)return;
  el.innerHTML='Loading…';
  try{
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/evidence-insights?tier=top_performer_deep&limit=80&offset=0');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    el.innerHTML=renderInsightTable(d.insights||[],[
      {key:'evidence_kind',label:'Platform'},
      {key:'why_it_worked',label:'Why'},
      {key:'caption_style',label:'Caption style'},
      {key:'hook_text',label:'Hook'}
    ]);
  }catch(e){el.textContent=String(e);}
}

async function loadDeepVideoTable(){
  var el=document.getElementById('deep-video-table');
  if(!SLUG||!selectedImportId||!el)return;
  el.innerHTML='Loading…';
  try{
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/evidence-insights?tier=top_performer_video&limit=80&offset=0');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    el.innerHTML=renderInsightTable(d.insights||[],[
      {key:'evidence_kind',label:'Platform'},
      {key:'why_it_worked',label:'Why'},
      {key:'hook_text',label:'Hook visual'},
      {key:'hook_type',label:'Format'}
    ]);
  }catch(e){el.textContent=String(e);}
}

async function loadDeepCarouselTable(){
  var el=document.getElementById('deep-carousel-table');
  if(!SLUG||!selectedImportId||!el)return;
  el.innerHTML='Loading…';
  try{
    var r=await cafFetch('/v1/inputs-processing/'+encodeURIComponent(SLUG)+'/import/'+encodeURIComponent(selectedImportId)+'/evidence-insights?tier=top_performer_carousel&limit=80&offset=0');
    var d=await r.json();
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    el.innerHTML=renderInsightTable(d.insights||[],[
      {key:'evidence_kind',label:'Platform'},
      {key:'why_it_worked',label:'Why'},
      {key:'hook_text',label:'Slide arc'},
      {key:'cta_type',label:'CTA clarity'}
    ]);
  }catch(e){el.textContent=String(e);}
}
document.getElementById('btn-reload-deep-image')?.addEventListener('click',loadDeepImageTable);
document.getElementById('btn-reload-deep-carousel')?.addEventListener('click',loadDeepCarouselTable);
document.getElementById('btn-reload-deep-video')?.addEventListener('click',loadDeepVideoTable);

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

readImportFromUrl();
showSeg('evidence');
if(SLUG)loadImports();
</script>`;
}
