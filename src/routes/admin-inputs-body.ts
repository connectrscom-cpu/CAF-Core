/** Inner HTML + script for GET /admin/inputs — upload INPUTS workbooks and browse import history. */

export function adminInputsBody(currentSlug: string): string {
  const SLUG = JSON.stringify(currentSlug);
  const pq = currentSlug ? `?project=${encodeURIComponent(currentSlug)}` : "";
  return `
<div class="ph"><div><h2>Inputs</h2><span class="ph-sub">Upload evidence workbooks · import history · open an import in Processing for scoring and insights</span></div></div>
<div class="content">
  <div class="card" style="margin-bottom:14px">
    <div style="padding:12px 16px 16px">
      <p class="runs-ops-hint">Upload an INPUTS workbook (same contract as <span class="mono">POST /v1/inputs-evidence/upload</span>). Use <a class="btn-ghost btn-sm" href="/admin/processing${pq}">Processing</a> to pick an import, review evidence by platform, run broad / top-performer analyses, and build signal packs.</p>
      <div id="imports-toolbar" style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <label class="btn btn-sm" style="position:relative;overflow:hidden;cursor:pointer;margin:0;display:inline-flex;align-items:center">
          Upload .xlsx
          <input type="file" id="inputs-xlsx-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;font-size:0" title="INPUTS — Sources for SNS workbook" />
        </label>
        <button type="button" class="btn btn-sm" id="btn-reload-imports">Reload imports</button>
        <span id="upload-busy" style="display:none;font-size:12px;color:var(--muted)">Uploading…</span>
        <span id="upload-msg" style="font-size:12px;color:var(--muted);max-width:420px"></span>
        <span id="imports-hint" style="font-size:12px;color:var(--muted)"></span>
      </div>
      <div id="imports-root" class="empty">Loading…</div>
    </div>
  </div>
</div>
<script>
const SLUG=${SLUG};
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function apiErr(d,fallback){return (d&&d.message)||(d&&d.error)||fallback;}
function processingHref(importId){
  var q=new URLSearchParams(window.location.search);
  if(SLUG)q.set('project',SLUG);else q.delete('project');
  if(importId)q.set('import',importId);else q.delete('import');
  return '/admin/processing'+(q.toString()?'?'+q.toString():'');
}
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
      var phref=processingHref(x.id);
      tb+='<tr><td>'+esc(String(x.created_at||'').slice(0,19))+'</td><td>'+esc(x.upload_filename||'—')+'</td><td>'+esc(x.stored_row_count)+'</td><td><a class="btn btn-sm" href="'+esc(phref)+'">Open in Processing</a></td></tr>';
    }
    tb+='</tbody></table>';
    root.innerHTML=tb;
    hint.textContent=rows.length+' import(s)';
  }catch(e){root.innerHTML='<div class="empty" style="color:var(--red)">'+esc(e.message||e)+'</div>';}
}
document.getElementById('btn-reload-imports')?.addEventListener('click',loadImports);
document.getElementById('inputs-xlsx-file')?.addEventListener('change',async function(ev){
  var input=ev.target;
  var file=input&&input.files&&input.files[0];
  if(input)input.value='';
  if(!file)return;
  if(!SLUG){alert('Select a project in the sidebar first.');return;}
  var busy=document.getElementById('upload-busy');
  var msg=document.getElementById('upload-msg');
  if(busy)busy.style.display='inline';
  if(msg){msg.textContent='';msg.style.color='';}
  try{
    var fd=new FormData();
    fd.append('file',file);
    fd.append('project_slug',SLUG);
    var r=await cafFetch('/v1/inputs-evidence/upload',{method:'POST',body:fd});
    var raw=await r.text();
    var d;try{d=JSON.parse(raw);}catch{throw new Error(raw.slice(0,400));}
    if(!r.ok||!d.ok)throw new Error(apiErr(d,'HTTP '+r.status));
    if(msg){
      msg.style.color='var(--green)';
      msg.textContent='Imported '+String(d.total_rows||0)+' rows · import '+String(d.inputs_evidence_import_id||'').slice(0,8)+'…';
    }
    await loadImports();
  }catch(e){
    if(msg){msg.style.color='var(--red)';msg.textContent=String(e.message||e);}
  }finally{
    if(busy)busy.style.display='none';
  }
});
if(SLUG)loadImports();
</script>`;
}
