// ── Config ────────────────────────────────────────────────
const VERSION = 'v4.7';

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQZ12Nc-aBIdhgsZ2LVvLYz0PytxUhIyoa10ESs7EcOQ_nxIZv3cP1-92Q1mapu5wbBvf6fASMM8ifS/pub?gid=1704018109&single=true&output=csv';
const API_URL = 'https://orderguideapi.marketplacerest.com';
const API_KEY = 'og_live_0bdf8b575f3e1a75de89c775c7b870ba0edd8308e1584ada';

// ── Column map ────────────────────────────────────────────
const COL = {
  'Supplier':'supplier','Product Name':'product','Product Code':'code',
  'Stock Category':'category','Sub Stock Category':'subcategory',
  'Price':'price','Pack Size':'pack','Unit Measure':'measure',
  'Unit Cost':'unitcost','Last Update':'lastupdate','Area':'area',
};

// ── OG State ──────────────────────────────────────────────
let products = [];
let opts     = { supplier:[], category:[], subcategory:[] };
let filters  = { area:'all', search:'', supplier:new Set(), category:new Set(), subcategory:new Set() };
let sorts    = [{ field:'supplier', dir:'asc' }];
const SORT_FIELDS = [
  {v:'supplier',l:'Supplier'},{v:'product',l:'Product Name'},{v:'code',l:'Product Code'},
  {v:'category',l:'Category'},{v:'subcategory',l:'Sub Category'},{v:'price',l:'Price'},
  {v:'pack',l:'Pack Size'},{v:'unitcost',l:'Unit Cost'},{v:'lastupdate',l:'Last Update'},{v:'area',l:'Area'},
];

// ── App Settings ──────────────────────────────────────────
let appSettings = { vat_rate:20, misc_charge_pct:2, misc_on_default:true };

// ── Recipe State ──────────────────────────────────────────
let currentTab        = 'og';
let allRecipes        = [];
let recipesLoaded     = false;
let recipeTypeFilter  = 'all';
let editorMode        = 'new';
let editorRecipe      = null;
let pendingIngredient = null;
let ingSearchResults  = [];
const ingQtyTimers    = {};

// ── Settings State ────────────────────────────────────────
let settingsUnlocked = false;
let pinEntry         = '';

// ── Boot ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('version-badge').textContent = VERSION;
  updateStickyOffset();
  loadData();
  loadSettings();
  renderPinDots();

  document.addEventListener('click', e => {
    if (!e.target.closest('.ingredient-search-wrap') &&
        !e.target.closest('.ingredient-results')) {
      const res = document.getElementById('ingredient-results');
      if (res) res.classList.add('hidden');
    }
  });
});

window.addEventListener('resize', updateStickyOffset);
document.addEventListener('click', e => { if (!e.target.closest('.filter-wrap')) closeAll(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadData(); });
window.addEventListener('focus', loadData);

// ── Settings load (non-blocking) ──────────────────────────
async function loadSettings() {
  const cached = localStorage.getItem('og_settings');
  if (cached) {
    try { Object.assign(appSettings, JSON.parse(cached)); } catch(e) {}
  }
  try {
    const data = await apiGet('/settings');
    appSettings.vat_rate        = parseFloat(data.vat_rate)        || 20;
    appSettings.misc_charge_pct = parseFloat(data.misc_charge_pct) || 2;
    appSettings.misc_on_default = data.misc_on_default === '1' || data.misc_on_default === true;
    localStorage.setItem('og_settings', JSON.stringify(appSettings));
  } catch(e) { /* use cached/defaults */ }
}

// ── Data loading ──────────────────────────────────────────
let initialLoad = true;
async function loadData() {
  if (initialLoad) document.getElementById('loading').classList.remove('hidden');
  try {
    const r = await fetch(CSV_URL + '&t=' + Date.now());
    if (!r.ok) throw new Error('HTTP ' + r.status);
    products = parseCSV(await r.text());
    if (!products.length) throw new Error('Sheet appears empty');
    buildOpts(); renderSortRows(); renderColHeaders(); render();
    const t = new Date();
    document.getElementById('sync-label').textContent =
      t.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
    document.getElementById('sync-pip').className = 'sync-pip ok';
    setError(null); checkStaleData();
  } catch(e) {
    setError('Could not load data: ' + e.message);
    document.getElementById('sync-pip').className = 'sync-pip error';
    document.getElementById('sync-label').textContent = 'Error';
    document.getElementById('results-bar').textContent = '';
  } finally {
    document.getElementById('loading').classList.add('hidden');
    initialLoad = false;
  }
}

// ── CSV parser ────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const hdrs = csvRow(lines[0]);
  return lines.slice(1).map(l => {
    const v = csvRow(l);
    if (v.every(x => x === '')) return null;
    const o = {};
    hdrs.forEach((h,i) => { o[COL[h.trim()]||h.trim()] = (v[i]||'').trim(); });
    return o;
  }).filter(Boolean);
}
function csvRow(line) {
  const res=[]; let cur='',q=false;
  for (let i=0;i<line.length;i++) {
    const c=line[i];
    if (c==='"') { if (q&&line[i+1]==='"'){cur+='"';i++;} else q=!q; }
    else if (c===','&&!q) { res.push(cur); cur=''; }
    else cur+=c;
  }
  res.push(cur); return res;
}

// ── Filter options ────────────────────────────────────────
function productsUpTo(level) {
  let list = products;
  if (filters.area !== 'all') list = list.filter(p=>(p.area||'').toLowerCase()===filters.area);
  if (level==='supplier') return list;
  if (filters.supplier.size>0) list = list.filter(p=>filters.supplier.has(p.supplier));
  if (level==='category') return list;
  if (filters.category.size>0) list = list.filter(p=>filters.category.has(p.category));
  return list;
}
function buildOpts() { rebuildDropdown('supplier'); rebuildDropdown('category'); rebuildDropdown('subcategory'); }
function rebuildDropdown(k) {
  const upstream = productsUpTo(k);
  opts[k] = [...new Set(upstream.map(p=>p[k]).filter(Boolean))].sort();
  filters[k].forEach(v=>{ if(!opts[k].includes(v)) filters[k].delete(v); });
  renderDDItems(k); updatePill(k);
}
function renderDDItems(k) {
  if (!opts[k].length) {
    document.getElementById('dl-'+k).innerHTML='<div style="padding:10px 14px;font-size:13px;color:var(--text3)">No options</div>';
    return;
  }
  document.getElementById('dl-'+k).innerHTML = opts[k].map(v=>`
    <div class="dd-item" onclick="onCheck('${k}','${esc(v)}',!this.querySelector('input').checked);this.querySelector('input').checked=!this.querySelector('input').checked">
      <input type="checkbox" onclick="event.stopPropagation();onCheck('${k}','${esc(v)}',this.checked)" ${filters[k].has(v)?'checked':''}>
      <span>${esc(v)}</span>
    </div>`).join('');
}
function ddSearch(ddId,q) {
  document.querySelectorAll('#'+ddId+' .dd-item').forEach(el=>{
    const s=el.querySelector('span'); if(!s) return;
    el.style.display=s.textContent.toLowerCase().includes(q.toLowerCase())?'':'none';
  });
}

// ── Filter interactions ───────────────────────────────────
function setArea(a) {
  filters.area=a;
  document.querySelectorAll('.seg-btn').forEach(b=>b.classList.toggle('active',b.dataset.area===a));
  clearDownstream('area'); render();
}
function onSearch(v) { filters.search=v; render(); }
function parseSearchTerms(raw) {
  const terms=[]; const re=/"([^"]+)"/g; let m,rem=raw;
  while((m=re.exec(raw))!==null) { terms.push({text:m[1].toLowerCase(),exact:true}); rem=rem.replace(m[0],' '); }
  rem.trim().split(/\s+/).forEach(w=>{ if(w) terms.push({text:w.toLowerCase(),exact:false}); });
  return terms;
}
function matchesSearch(p,terms) {
  const hay=[p.product,p.supplier,p.code,p.category,p.subcategory].join(' ').toLowerCase();
  return terms.every(t=>{
    if(t.exact) return new RegExp('\\b'+t.text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i').test(hay);
    return hay.includes(t.text);
  });
}
function onCheck(k,v,checked) { checked?filters[k].add(v):filters[k].delete(v); clearDownstream(k); updatePill(k); render(); }
function selAll(k) { filters[k]=new Set(); clearDownstream(k); updatePill(k); render(); }
function clearDownstream(level) {
  const order=['supplier','category','subcategory'];
  const si=level==='area'?0:order.indexOf(level)+1;
  for(let i=si;i<order.length;i++) filters[order[i]]=new Set();
  const ri=level==='area'?0:order.indexOf(level);
  for(let i=ri;i<order.length;i++) rebuildDropdown(order[i]);
}
function removeTag(k,v) { filters[k].delete(v); clearDownstream(k); updatePill(k); render(); }
function updatePill(k) {
  const badge=document.getElementById('fb-'+k), pill=document.getElementById('fp-'+k), n=filters[k].size;
  if(n===0){badge.style.display='none';pill.classList.remove('active');}
  else{badge.textContent=n;badge.style.display='inline';pill.classList.add('active');}
}
function clearAll() {
  filters.search=''; filters.area='all';
  document.getElementById('search-input').value='';
  document.querySelectorAll('.seg-btn').forEach(b=>b.classList.toggle('active',b.dataset.area==='all'));
  ['supplier','category','subcategory'].forEach(k=>{filters[k]=new Set();});
  buildOpts(); render();
}
function clearSearch() { filters.search=''; document.getElementById('search-input').value=''; render(); }

// ── Sort ──────────────────────────────────────────────────
function sortByCol(field) {
  if(sorts.length===1&&sorts[0].field===field) sorts[0].dir=sorts[0].dir==='asc'?'desc':'asc';
  else sorts=[{field,dir:'asc'}];
  renderSortRows(); renderColHeaders();
}
function renderColHeaders() {
  document.querySelectorAll('th[data-col]').forEach(th=>{
    const si=sorts.findIndex(s=>s.field===th.dataset.col), arrow=th.querySelector('.sort-arrow');
    if(si===0){arrow.innerHTML=sorts[0].dir==='asc'?'&#9650;':'&#9660;';arrow.className='sort-arrow active';}
    else{arrow.innerHTML='&#9650;';arrow.className='sort-arrow';}
  });
}
function renderSortRows() {
  document.getElementById('sort-rows').innerHTML=sorts.map((s,i)=>`
    <div class="sort-row">
      <select onchange="sorts[${i}].field=this.value;renderColHeaders();render()">
        ${SORT_FIELDS.map(f=>`<option value="${f.v}"${f.v===s.field?' selected':''}>${f.l}</option>`).join('')}
      </select>
      <button class="sort-dir ${s.dir}" onclick="sorts[${i}].dir=sorts[${i}].dir==='asc'?'desc':'asc';renderSortRows()">
        ${s.dir==='asc'?'ASC':'DESC'}
      </button>
      ${sorts.length>1?`<button class="sort-del" onclick="sorts.splice(${i},1);renderSortRows()">&#x2715;</button>`:'<span style="width:28px"></span>'}
    </div>`).join('');
  document.getElementById('add-sort').disabled=sorts.length>=3;
  render(); renderColHeaders();
}
function addSort() { if(sorts.length<3){sorts.push({field:'product',dir:'asc'});renderSortRows();} }

// ── Core render ───────────────────────────────────────────
function render() {
  let list=products;
  if(filters.area!=='all') list=list.filter(p=>(p.area||'').toLowerCase()===filters.area);
  ['supplier','category','subcategory'].forEach(k=>{ if(filters[k].size>0) list=list.filter(p=>filters[k].has(p[k])); });
  const terms=filters.search.trim()?parseSearchTerms(filters.search.trim()):[];
  if(terms.length) list=list.filter(p=>matchesSearch(p,terms));
  list=[...list].sort((a,b)=>{
    for(const s of sorts){
      const av=a[s.field]||'',bv=b[s.field]||'';
      const na=parseFloat(String(av).replace(/[^0-9.]/g,'')),nb=parseFloat(String(bv).replace(/[^0-9.]/g,''));
      let c=(!isNaN(na)&&!isNaN(nb))?na-nb:String(av).localeCompare(String(bv));
      if(c!==0) return s.dir==='asc'?c:-c;
    }
    return 0;
  });
  renderTable(list,terms); renderTags(); updateStickyOffset();
  document.getElementById('results-bar').innerHTML=`<strong>${list.length.toLocaleString()}</strong> of ${products.length.toLocaleString()} products`;
  const parts=[];
  if(filters.area!=='all') parts.push('Area: '+filters.area);
  if(filters.search) parts.push('Search: "'+filters.search+'"');
  ['supplier','category','subcategory'].forEach(k=>{ if(filters[k].size>0) parts.push([...filters[k]].join(', ')); });
  const d=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  document.getElementById('print-meta').textContent=(parts.length?parts.join(' - ')+' - ':'')+d;
}
function renderTable(list,terms) {
  const tbody=document.getElementById('tbody'),empty=document.getElementById('empty');
  if(!list.length){tbody.innerHTML='';empty.classList.add('show');return;}
  empty.classList.remove('show');
  const cp=val=>`onclick="copyCell('${esc(val)}')"`;
  tbody.innerHTML=list.map(p=>`
    <tr>
      <td class="col-product col-sticky copyable" ${cp(p.product||'')}>${hiTerms(p.product||'',terms)}</td>
      <td class="col-supplier copyable" ${cp(p.supplier||'')}>${hiTerms(p.supplier||'',terms)}</td>
      <td class="col-code copyable" ${cp(p.code||'')}>${hiTerms(p.code||'',terms)}</td>
      <td class="col-category copyable" ${cp(p.category||'')}>${hiTerms(p.category||'',terms)}</td>
      <td class="col-price copyable" ${cp(fmt(p.price,2))}>${fmt(p.price,2)}</td>
      <td class="col-pack copyable" ${cp(p.pack||'')}>${esc(p.pack||'')}</td>
      <td class="col-measure copyable" ${cp(p.measure||'')}>${esc(p.measure||'')}</td>
      <td class="col-unitcost copyable" ${cp(fmt(p.unitcost,4))}>${fmt(p.unitcost,4)}</td>
      <td class="col-date copyable" ${cp(p.lastupdate||'')}>${esc(p.lastupdate||'')}</td>
    </tr>`).join('');
}
function renderTags() {
  const bar=document.getElementById('tag-bar'),tags=[];
  if(filters.search) tags.push(mkTag(`Search: "${esc(filters.search)}"`,`clearSearch()`));
  if(filters.area!=='all') tags.push(mkTag('Area: '+filters.area,`setArea('all')`));
  const labels={supplier:'Supplier',category:'Category',subcategory:'Sub Cat'};
  ['supplier','category','subcategory'].forEach(k=>filters[k].forEach(v=>tags.push(mkTag(labels[k]+': '+esc(v),`removeTag('${k}','${esc(v)}')`))));
  if(tags.length){bar.innerHTML=tags.join('')+`<button class="clear-all" onclick="clearAll()">Clear all</button>`;bar.classList.add('show');}
  else{bar.innerHTML='';bar.classList.remove('show');}
}
function mkTag(label,onclick){return`<div class="tag">${label}<button class="tag-x" onclick="${onclick}">&#x2715;</button></div>`;}

// ── Dropdowns ─────────────────────────────────────────────
function toggleDD(id,pillId) {
  const panel=document.getElementById(id),pill=pillId?document.getElementById(pillId):null;
  const open=panel.classList.contains('open'); closeAll();
  if(!open){panel.classList.add('open');if(pill)pill.classList.add('open');}
}
function closeAll() {
  document.querySelectorAll('.dropdown.open,.sort-panel.open').forEach(el=>el.classList.remove('open'));
  document.querySelectorAll('.filter-pill.open').forEach(el=>el.classList.remove('open'));
}

// ── Utilities ─────────────────────────────────────────────
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function hiTerms(s,terms){
  if(!terms||!terms.length) return esc(s);
  let r=esc(s);
  terms.forEach(t=>{
    const p=t.exact?'\\b'+t.text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b':t.text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    r=r.replace(new RegExp('('+p+')','gi'),'<mark>$1</mark>');
  });
  return r;
}
function fmt(v,dp){
  if(!v&&v!==0) return '';
  const n=parseFloat(String(v).replace(/[^0-9.]/g,''));
  return isNaN(n)?esc(v):'\u00a3'+n.toFixed(dp);
}
function setError(m){
  const b=document.getElementById('error-banner');
  if(m){b.textContent=m;b.classList.add('show');}else b.classList.remove('show');
  updateStickyOffset();
}
function updateStickyOffset() {
  const wrap=document.querySelector('.table-wrap'); if(!wrap) return;
  let above=0;
  ['header','.toolbar','#error-banner','#stale-banner','#tag-bar','.results-bar'].forEach(sel=>{
    const el=document.querySelector(sel); if(el) above+=el.offsetHeight;
  });
  const nav=document.getElementById('bottom-nav');
  wrap.style.height=(window.innerHeight-above-(nav?nav.offsetHeight:0))+'px';
}
function checkStaleData() {
  if(!products.length) return;
  let latest=null;
  products.forEach(p=>{
    if(!p.lastupdate) return;
    const pts=p.lastupdate.split('/'); if(pts.length!==3) return;
    const d=new Date(pts[2],pts[1]-1,pts[0]);
    if(!isNaN(d)&&(!latest||d>latest)) latest=d;
  });
  if(!latest) return;
  const ageH=(Date.now()-latest.getTime())/(1000*60*60);
  if(ageH>48){const days=Math.floor(ageH/24);setStaleWarning(`Price data is ${days} day${days>1?'s':''} old.`);}
  else setStaleWarning(null);
}
function setStaleWarning(msg) {
  const b=document.getElementById('stale-banner');
  if(msg){b.textContent='\u26a0\ufe0f  '+msg;b.classList.add('show');}else b.classList.remove('show');
  updateStickyOffset();
}
let copyToastTimer=null;
function copyCell(val){
  if(!val) return;
  navigator.clipboard.writeText(val).then(()=>showToast('Copied: '+val)).catch(()=>showToast('Could not copy'));
}
function showToast(msg, persist){
  if(copyToastTimer) clearTimeout(copyToastTimer);
  const t=document.getElementById('copy-toast');
  t.textContent=msg; t.classList.add('show');
  copyToastTimer=setTimeout(()=>t.classList.remove('show'), persist?8000:2500);
}
function openSearchInfo(){document.getElementById('search-modal').classList.add('open');}
function closeSearchInfo(e){if(!e||e.target===document.getElementById('search-modal'))document.getElementById('search-modal').classList.remove('open');}

// ══════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════
function switchTab(tab) {
  if(tab===currentTab) return;
  currentTab=tab;
  document.querySelectorAll('.nav-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.tab===tab));
  ['og','recipes','settings'].forEach(s=>{
    const el=document.getElementById('screen-'+s);
    if(el) el.classList.toggle('hidden',s!==tab);
  });
  const printBtn=document.getElementById('print-btn');
  if(printBtn) printBtn.style.display=tab==='og'?'':'none';
  if(tab==='og') updateStickyOffset();
  else if(tab==='recipes'&&!recipesLoaded) loadRecipes();
}

// ══════════════════════════════════════════════════════════
// API HELPERS — capture raw text so PHP errors don't hide
// ══════════════════════════════════════════════════════════
async function apiCall(method, path, body) {
  const opts = {
    method,
    headers: { 'X-API-Key': API_KEY }
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(API_URL + path, opts);
  const text = await r.text();
  console.log('[API ' + method + ' ' + path + '] status=' + r.status + ' body=' + text.substring(0, 200));
  let data;
  try { data = JSON.parse(text); } catch(e) {
    throw new Error('Bad response (' + r.status + '): ' + text.substring(0, 120));
  }
  if (!r.ok) throw new Error(data.error || 'API ' + r.status);
  return data;
}
async function apiGet(path)          { return apiCall('GET',    path); }
async function apiPost(path, body)   { return apiCall('POST',   path, body); }
async function apiPut(path, body)    { return apiCall('PUT',    path, body); }
async function apiDelete(path)       { return apiCall('DELETE', path); }

// ══════════════════════════════════════════════════════════
// SETTINGS TAB
// ══════════════════════════════════════════════════════════
function renderPinDots() {
  const el=document.getElementById('pin-dots'); if(!el) return;
  const count=Math.max(4,pinEntry.length);
  el.innerHTML=Array.from({length:count},(_,i)=>`<span class="pin-dot${i<pinEntry.length?' filled':''}"></span>`).join('');
}

function pinKey(digit){
  if(pinEntry.length>=8) return;
  pinEntry+=digit; renderPinDots();
  document.getElementById('pin-error').innerHTML='&nbsp;';
}

function pinBackspace(){
  pinEntry=pinEntry.slice(0,-1); renderPinDots();
  document.getElementById('pin-error').innerHTML='&nbsp;';
}

async function pinSubmit(){
  if(!pinEntry){ document.getElementById('pin-error').textContent='Enter your PIN'; return; }
  const errEl=document.getElementById('pin-error');
  errEl.textContent='Checking\u2026';
  try {
    const r=await fetch(API_URL+'/settings/verify-pin',{
      method:'POST',
      headers:{'Content-Type':'application/json','X-API-Key':API_KEY},
      body:JSON.stringify({pin:pinEntry})
    });
    const data=await r.json();
    if(data.success){
      unlockSettings();
    } else {
      pinEntry=''; renderPinDots();
      errEl.textContent='Incorrect PIN';
      const dots=document.getElementById('pin-dots');
      dots.classList.add('shake');
      setTimeout(()=>{ dots.classList.remove('shake'); errEl.innerHTML='&nbsp;'; },600);
    }
  } catch(e){
    errEl.textContent='Connection error — try again';
    pinEntry=''; renderPinDots();
  }
}

function unlockSettings(){
  settingsUnlocked=true; pinEntry=''; renderPinDots();
  document.getElementById('pin-error').innerHTML='&nbsp;';
  document.getElementById('settings-locked').classList.add('hidden');
  document.getElementById('settings-unlocked').classList.remove('hidden');
  document.getElementById('s-vat').value       = appSettings.vat_rate;
  document.getElementById('s-misc-pct').value  = appSettings.misc_charge_pct;
  document.getElementById('s-misc-default').checked = appSettings.misc_on_default;
  document.getElementById('s-current-pin').value='';
  document.getElementById('s-new-pin').value='';
}

function lockSettings(){
  settingsUnlocked=false; pinEntry=''; renderPinDots();
  document.getElementById('settings-unlocked').classList.add('hidden');
  document.getElementById('settings-locked').classList.remove('hidden');
}

async function saveSettings(){
  const vatRate  = parseFloat(document.getElementById('s-vat').value) || 20;
  const miscPct  = parseFloat(document.getElementById('s-misc-pct').value) || 2;
  const miscOn   = document.getElementById('s-misc-default').checked;
  const btn      = document.getElementById('save-settings-btn');
  btn.disabled=true; btn.textContent='Saving\u2026';
  try {
    await apiPut('/settings',{vat_rate:String(vatRate),misc_charge_pct:String(miscPct),misc_on_default:miscOn?'1':'0'});
    appSettings.vat_rate=vatRate; appSettings.misc_charge_pct=miscPct; appSettings.misc_on_default=miscOn;
    localStorage.setItem('og_settings',JSON.stringify(appSettings));
    showToast('Settings saved');
  } catch(e){
    showToast('Save failed: '+e.message);
  } finally {
    btn.disabled=false; btn.textContent='Save';
  }
}

async function changePin(){
  const current=document.getElementById('s-current-pin').value;
  const newPin  =document.getElementById('s-new-pin').value;
  if(!current||!newPin){showToast('Enter current and new PIN');return;}
  if(!/^\d{4,8}$/.test(newPin)){showToast('New PIN must be 4\u20138 digits');return;}
  try {
    await apiPut('/settings/pin',{current_pin:current,new_pin:newPin});
    document.getElementById('s-current-pin').value='';
    document.getElementById('s-new-pin').value='';
    showToast('PIN changed');
  } catch(e){
    showToast('Failed: '+e.message);
  }
}

async function runDiagnostics(){
  const out=document.getElementById('diag-output');
  if(!out) return;
  out.innerHTML='Running\u2026';
  const lines=[];

  const check=async(label,fn)=>{
    try{
      const res=await fn();
      const preview=JSON.stringify(res).substring(0,80);
      lines.push('<span style="color:var(--green)">\u2713 '+label+'</span> &mdash; '+esc(preview));
    }catch(e){
      lines.push('<span style="color:var(--red)">\u2717 '+label+'</span> &mdash; '+esc(e.message));
    }
    out.innerHTML=lines.join('<br>');
  };

  await check('GET /settings',()=>apiGet('/settings'));
  await check('GET /recipes', ()=>apiGet('/recipes'));

  // Check DB columns exist by creating and immediately deleting a test recipe
  let testId=null;
  try{
    const r=await apiPost('/recipes',{name:'__diag_test__',type:'dish',category:'food',gp_target:70,misc_enabled:1,misc_pct:2,selling_price:null,actual_gp:null,notes:null});
    testId=r.id;
    lines.push('<span style="color:var(--green)">\u2713 POST /recipes (DB columns OK)</span>');
  }catch(e){
    lines.push('<span style="color:var(--red)">\u2717 POST /recipes &mdash; '+esc(e.message)+'</span>');
  }
  out.innerHTML=lines.join('<br>');

  if(testId){
    try{await apiDelete('/recipes/'+testId);lines.push('<span style="color:var(--green)">\u2713 DELETE /recipes/'+testId+' (cleanup OK)</span>');}
    catch(e){lines.push('<span style="color:var(--amber)">\u26a0 Cleanup failed (test recipe id '+testId+' left in DB)</span>');}
    out.innerHTML=lines.join('<br>');
  }
}

// ══════════════════════════════════════════════════════════
// RECIPE LIST
// ══════════════════════════════════════════════════════════
async function loadRecipes(){
  const cardsEl=document.getElementById('recipe-cards');
  cardsEl.innerHTML='<div class="recipe-list-state">Loading recipes\u2026</div>';
  try {
    const list=await apiGet('/recipes');
    if(!list.length){allRecipes=[];recipesLoaded=true;renderRecipeList();return;}
    // Fetch full details in parallel; don't let one failure kill the whole list
    allRecipes=await Promise.all(list.map(r=>
      apiGet('/recipes/'+r.id).catch(e=>{
        console.error('Failed to load recipe '+r.id+':',e);
        return Object.assign({},r,{items:[]});
      })
    ));
    recipesLoaded=true; renderRecipeList();
  } catch(e){
    console.error('loadRecipes failed:',e);
    cardsEl.innerHTML='<div class="recipe-list-state error">Could not load recipes: '+esc(e.message)+'</div>';
  }
}

function setRecipeTypeFilter(type){
  recipeTypeFilter=type;
  document.querySelectorAll('#recipe-type-seg .seg-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.rtype===type));
  renderRecipeList();
}

function renderRecipeList(){
  const cardsEl=document.getElementById('recipe-cards');
  const list=recipeTypeFilter==='all'?allRecipes:allRecipes.filter(r=>r.type===recipeTypeFilter);
  if(!list.length){
    const msg=allRecipes.length===0?'No recipes yet. Tap <strong>New</strong> to create your first.':'No '+recipeTypeFilter+' recipes.';
    cardsEl.innerHTML='<div class="recipe-list-state">'+msg+'</div>'; return;
  }
  cardsEl.innerHTML=list.map(r=>recipeCardHTML(r)).join('');
}

function recipeCardHTML(r){
  const adjustedCost=calcRecipeCost(r,allRecipes);
  const count=(r.items||[]).length;
  const countText=count+' ingredient'+(count!==1?'s':'');
  let statsHtml='';
  if(r.type==='dish'){
    const vat=parseFloat(appSettings.vat_rate)||20;
    const gp=parseFloat(r.gp_target)||70;
    const sellExVat=adjustedCost>0?adjustedCost/(1-gp/100):null;
    const sellIncVat=sellExVat?sellExVat*(1+vat/100):null;
    const actualSell=parseFloat(r.selling_price)||null;
    const actualGp=parseFloat(r.actual_gp)||null;
    statsHtml=
      '<div class="card-stat"><span class="card-stat-label">Cost</span><span class="card-stat-value">'+(adjustedCost>0?'\u00a3'+adjustedCost.toFixed(2):'\u2014')+'</span></div>'+
      '<div class="card-stat"><span class="card-stat-label">Menu price</span><span class="card-stat-value">'+(actualSell?'\u00a3'+actualSell.toFixed(2):(sellIncVat?'~\u00a3'+sellIncVat.toFixed(2):'\u2014'))+'</span></div>'+
      '<div class="card-stat"><span class="card-stat-label">Actual GP</span><span class="card-stat-value">'+(actualGp?actualGp.toFixed(1)+'%':'\u2014')+'</span></div>';
  } else {
    const batchSize=parseFloat(r.batch_size)||0;
    const cpu=(batchSize>0&&adjustedCost>0)?adjustedCost/batchSize:null;
    statsHtml=
      '<div class="card-stat"><span class="card-stat-label">Batch cost</span><span class="card-stat-value">'+(adjustedCost>0?'\u00a3'+adjustedCost.toFixed(2):'\u2014')+'</span></div>'+
      '<div class="card-stat"><span class="card-stat-label">Per '+(esc(r.batch_unit||'unit'))+'</span><span class="card-stat-value">'+(cpu?'\u00a3'+cpu.toFixed(4):'\u2014')+'</span></div>';
  }
  return '<div class="recipe-card" onclick="openRecipe('+r.id+')">' +
    '<div class="card-top"><div class="card-name">'+esc(r.name)+'</div><div class="type-badge '+r.type+'">'+r.type.toUpperCase()+'</div></div>' +
    '<div class="card-stats">'+statsHtml+'</div>' +
    '<div class="card-count">'+countText+'</div>' +
  '</div>';
}

// ══════════════════════════════════════════════════════════
// COST CALCULATION (includes misc)
// ══════════════════════════════════════════════════════════
function lookupUnitCost(productCode,productName){
  if(productCode){const p=products.find(x=>x.code&&x.code===productCode);if(p&&p.unitcost)return parseFloat(p.unitcost)||0;}
  if(productName){const p=products.find(x=>x.product===productName);if(p&&p.unitcost)return parseFloat(p.unitcost)||0;}
  return 0;
}
function getPrepCostPerUnit(prepId,allRecs){
  if(!prepId) return 0;
  const prep=(allRecs||allRecipes).find(r=>r.id===prepId);
  if(!prep||!(prep.items||[]).length) return 0;
  const batchCost=calcRecipeCost(prep,allRecs||allRecipes,1);
  return batchCost/(parseFloat(prep.batch_size)||1);
}
function calcRecipeCost(recipe,allRecs,depth){
  depth=depth||0;
  if(!recipe||!(recipe.items||[]).length||depth>2) return 0;
  let total=0;
  for(const item of recipe.items){
    const qty=parseFloat(item.quantity)||0;
    if(item.item_type==='product') total+=qty*lookupUnitCost(item.product_code,item.product_name);
    else if(item.item_type==='prep'&&item.sub_recipe_id) total+=qty*getPrepCostPerUnit(item.sub_recipe_id,allRecs);
  }
  // Apply this recipe's stored misc charge
  if(recipe.misc_enabled&&parseFloat(recipe.misc_pct)>0)
    total=total*(1+parseFloat(recipe.misc_pct)/100);
  return total;
}

// ══════════════════════════════════════════════════════════
// RECIPE EDITOR — OPEN
// ══════════════════════════════════════════════════════════
function openNewRecipe(){
  editorMode='new';
  const cat='food';
  editorRecipe={
    id:null,name:'',type:'dish',category:cat,
    gp_target:70,batch_size:null,batch_unit:'',
    misc_enabled:appSettings.misc_on_default?1:0,
    misc_pct:appSettings.misc_charge_pct||2,
    selling_price:null,actual_gp:null,notes:'',items:[]
  };
  showEditor();
}

async function openRecipe(id){
  try{
    const recipe=await apiGet('/recipes/'+id);
    editorMode='edit'; editorRecipe=recipe; showEditor();
  } catch(e){ showToast('Could not load recipe: '+e.message); }
}

function showEditor(){
  document.getElementById('recipe-list-view').classList.add('hidden');
  document.getElementById('recipe-editor-view').classList.remove('hidden');

  document.getElementById('recipe-name-input').value  = editorRecipe.name||'';
  document.getElementById('recipe-notes').value        = editorRecipe.notes||'';
  document.getElementById('batch-size-input').value    = editorRecipe.batch_size||'';
  document.getElementById('batch-unit-input').value    = editorRecipe.batch_unit||'';
  document.getElementById('misc-pct-input').value      = editorRecipe.misc_pct!=null?editorRecipe.misc_pct:(appSettings.misc_charge_pct||2);
  document.getElementById('misc-enabled').checked      = !!editorRecipe.misc_enabled;

  const spEl=document.getElementById('selling-price-input');
  if(spEl) spEl.value=editorRecipe.selling_price?parseFloat(editorRecipe.selling_price).toFixed(2):'';

  const gpVal=editorRecipe.gp_target!=null?editorRecipe.gp_target:(editorRecipe.category==='drink'?75:70);
  const gpEl=document.getElementById('gp-target-input');
  if(gpEl) gpEl.value=gpVal;
  const gpDisp=document.getElementById('gp-value-display');
  if(gpDisp) gpDisp.textContent=parseFloat(gpVal).toFixed(1)+'%';

  setRecipeType(editorRecipe.type||'dish',false);
  setRecipeCategory(editorRecipe.category||'food',false);

  const delBtn=document.getElementById('editor-delete-btn');
  delBtn.style.visibility=editorMode==='edit'?'visible':'hidden';
  document.getElementById('editor-title').textContent=editorMode==='new'?'New Recipe':(editorRecipe.name||'Recipe');

  document.getElementById('ingredient-search').value='';
  const res=document.getElementById('ingredient-results');
  res.innerHTML=''; res.classList.add('hidden');
  ingSearchResults=[];

  renderIngredientList();
  recalcTotals();
}

function closeEditor(){
  document.getElementById('recipe-editor-view').classList.add('hidden');
  document.getElementById('recipe-list-view').classList.remove('hidden');
  editorRecipe=null; pendingIngredient=null; ingSearchResults=[];
}

// Keep allRecipes in sync when items change in the editor so cards update immediately
function syncRecipeToList(){
  if(editorRecipe&&editorRecipe.id){
    allRecipes=allRecipes.map(r=>r.id===editorRecipe.id?JSON.parse(JSON.stringify(editorRecipe)):r);
  }
}

// ── Type / Category ───────────────────────────────────────
function setRecipeType(type,updateState){
  if(updateState!==false&&editorRecipe) editorRecipe.type=type;
  document.querySelectorAll('.type-btn:not(.cat-btn)').forEach(btn=>btn.classList.toggle('active',btn.dataset.type===type));
  document.getElementById('dish-fields').classList.toggle('hidden',type!=='dish');
  document.getElementById('prep-fields').classList.toggle('hidden',type!=='prep');
  document.getElementById('totals-selling').classList.toggle('hidden',type!=='dish');
  recalcTotals();
}

function setRecipeCategory(cat,updateState){
  if(updateState!==false&&editorRecipe) editorRecipe.category=cat;
  document.querySelectorAll('.cat-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.cat===cat));
  // Update GP default for new recipes when switching category
  if(editorMode==='new'){
    const defaultGp=cat==='drink'?75:70;
    const gpEl=document.getElementById('gp-target-input');
    if(gpEl){gpEl.value=defaultGp;document.getElementById('gp-value-display').textContent=defaultGp.toFixed(1)+'%';}
  }
  recalcTotals();
}

function onGpSliderChange(val){
  const disp=document.getElementById('gp-value-display');
  if(disp) disp.textContent=parseFloat(val).toFixed(1)+'%';
  recalcTotals();
}

function onEditorNameChange(){
  const name=document.getElementById('recipe-name-input').value;
  if(editorMode==='edit'&&name) document.getElementById('editor-title').textContent=name;
}

// ── Ingredient list render ────────────────────────────────
function renderIngredientList(){
  const listEl=document.getElementById('ingredient-list');
  const items=editorRecipe?editorRecipe.items||[]:[];
  if(!items.length){listEl.innerHTML='<div class="ing-empty">No ingredients added yet</div>';return;}
  listEl.innerHTML=items.map(function(item,idx){
    const uc=item.item_type==='product'?lookupUnitCost(item.product_code,item.product_name):getPrepCostPerUnit(item.sub_recipe_id,allRecipes);
    const qty=parseFloat(item.quantity)||0;
    const lc=qty*uc;
    const badge=item.item_type==='prep'?'<span class="ing-prep-badge">PREP</span>':'';
    const ucStr=uc>0?' \u00b7 \u00a3'+uc.toFixed(4)+'/unit':'';
    return '<div class="ingredient-row">'+
      '<div class="ing-info"><div class="ing-name">'+esc(item.product_name||'')+badge+'</div><div class="ing-meta">'+esc(item.unit_measure||'')+ucStr+'</div></div>'+
      '<div class="ing-qty-wrap"><input class="ing-qty" type="number" value="'+(qty||'')+'" min="0" step="0.001" placeholder="0" onchange="updateIngQty('+idx+',parseFloat(this.value)||0)" onclick="event.stopPropagation()"><span class="ing-unit-label">'+esc(item.unit_measure||'')+'</span></div>'+
      '<div class="ing-cost">'+(lc>0?'\u00a3'+lc.toFixed(4):'\u2014')+'</div>'+
      '<button class="ing-remove" onclick="removeIngredient('+idx+')" title="Remove">\u00d7</button>'+
    '</div>';
  }).join('');
}

// ── Totals ────────────────────────────────────────────────
function tRow(label,value,cls){
  return '<div class="totals-row"><span class="totals-label">'+label+'</span><span class="totals-value'+(cls?' '+cls:'')+'">'+value+'</span></div>';
}

function recalcTotals(){
  if(!editorRecipe) return;
  const items=editorRecipe.items||[];
  const type=editorRecipe.type||'dish';

  // Read misc from UI inputs (live values, not stored)
  const miscEnabled=document.getElementById('misc-enabled')?.checked;
  const miscPct=parseFloat(document.getElementById('misc-pct-input')?.value)||0;

  // Raw ingredient cost (prep items use their stored misc via getPrepCostPerUnit)
  let rawCost=0;
  for(const item of items){
    const qty=parseFloat(item.quantity)||0;
    const uc=item.item_type==='product'?lookupUnitCost(item.product_code,item.product_name):getPrepCostPerUnit(item.sub_recipe_id,allRecipes);
    rawCost+=qty*uc;
  }
  const miscAmt=miscEnabled&&miscPct>0?rawCost*miscPct/100:0;
  const adjCost=rawCost+miscAmt;

  const section=document.getElementById('recipe-totals-section');
  if(!items.length){section.classList.add('hidden');return;}
  section.classList.remove('hidden');

  // ── Costs block ───────────────────────────────────────
  let costsHtml='<div class="totals-sub-label">Costs</div>';
  if(miscEnabled&&miscAmt>0){
    costsHtml+=tRow('Ingredients','\u00a3'+rawCost.toFixed(2));
    costsHtml+=tRow('Misc ('+miscPct+'%)','+\u00a0\u00a3'+miscAmt.toFixed(2),'sub');
    costsHtml+='<hr class="totals-divider">';
    costsHtml+=tRow('Total cost','\u00a3'+adjCost.toFixed(2));
  } else {
    costsHtml+=tRow('Total cost','\u00a3'+adjCost.toFixed(2));
  }
  document.getElementById('totals-costs').innerHTML=costsHtml;

  if(type==='dish'){
    const vat=parseFloat(appSettings.vat_rate)||20;
    const gpTarget=parseFloat(document.getElementById('gp-target-input')?.value)||70;

    // ── Target block ────────────────────────────────────
    let targetHtml='';
    if(adjCost>0){
      const tExVat=adjCost/(1-gpTarget/100);
      const tIncVat=tExVat*(1+vat/100);
      targetHtml='<div class="totals-sub-label" style="margin-top:10px">Target @ '+gpTarget.toFixed(1)+'% GP</div>';
      targetHtml+=tRow('Target ex VAT','\u00a3'+tExVat.toFixed(2));
      targetHtml+=tRow('Target inc '+vat+'% VAT','\u00a3'+tIncVat.toFixed(2),'hi');
    }
    document.getElementById('totals-target').innerHTML=targetHtml;
    document.getElementById('totals-selling').classList.remove('hidden');

    // ── Actual block ────────────────────────────────────
    const sellPrice=parseFloat(document.getElementById('selling-price-input')?.value)||0;
    let actualHtml='';
    if(sellPrice>0&&adjCost>0){
      const exVat  =sellPrice/(1+vat/100);
      const actGp  =((exVat-adjCost)/exVat)*100;
      const gpCash =exVat-adjCost;
      const vatComp=sellPrice-exVat;
      const gpTarget2=parseFloat(document.getElementById('gp-target-input')?.value)||70;
      const gpCls  =actGp>=(gpTarget2-0.5)?'ok':actGp>=(gpTarget2-5)?'warn':'bad';
      actualHtml='<div class="totals-sub-label" style="margin-top:10px">Actual</div>';
      actualHtml+=tRow('Price ex '+vat+'% VAT','\u00a3'+exVat.toFixed(2));
      actualHtml+=tRow('Actual GP',actGp.toFixed(1)+'%',gpCls);
      actualHtml+=tRow('GP cash','\u00a3'+gpCash.toFixed(2));
      actualHtml+=tRow('VAT ('+vat+'%)','\u00a3'+vatComp.toFixed(2),'sub');
      editorRecipe._actualGp=parseFloat(actGp.toFixed(2));
      editorRecipe._sellingPrice=sellPrice;
    } else {
      editorRecipe._actualGp=null;
    }
    document.getElementById('totals-actual').innerHTML=actualHtml;

  } else {
    // Prep — no VAT, no selling price
    document.getElementById('totals-target').innerHTML='';
    document.getElementById('totals-selling').classList.add('hidden');
    const batchSize=parseFloat(document.getElementById('batch-size-input')?.value)||0;
    const batchUnit=(document.getElementById('batch-unit-input')?.value||'unit').trim()||'unit';
    let actualHtml='';
    if(batchSize>0){
      actualHtml=tRow('Cost per '+esc(batchUnit),'\u00a3'+(adjCost/batchSize).toFixed(4),'hi');
    }
    document.getElementById('totals-actual').innerHTML=actualHtml;
  }
}

// ── Qty update ────────────────────────────────────────────
function updateIngQty(idx,qty){
  const item=editorRecipe?.items?.[idx]; if(!item) return;
  item.quantity=qty; renderIngredientList(); recalcTotals();
  if(editorMode==='edit'&&item.id){
    clearTimeout(ingQtyTimers[item.id]);
    const rid=editorRecipe.id,iid=item.id,so=item.sort_order||0;
    ingQtyTimers[iid]=setTimeout(async function(){
      try{await apiPut('/recipes/'+rid+'/items/'+iid,{quantity:qty,sort_order:so});}
      catch(e){showToast('Could not save quantity');}
    },600);
  }
}

// ── Remove ingredient ─────────────────────────────────────
async function removeIngredient(idx){
  if(!editorRecipe?.items) return;
  const item=editorRecipe.items[idx]; if(!item) return;
  if(editorMode==='edit'&&item.id){
    try{await apiDelete('/recipes/'+editorRecipe.id+'/items/'+item.id);}
    catch(e){showToast('Could not remove: '+e.message);return;}
  }
  editorRecipe.items.splice(idx,1);
  renderIngredientList(); recalcTotals();
  syncRecipeToList();
}

// ── Ingredient search ─────────────────────────────────────
function onIngredientSearch(query){
  const resEl=document.getElementById('ingredient-results');
  if(!query.trim()){resEl.innerHTML='';resEl.classList.add('hidden');ingSearchResults=[];return;}
  const q=query.toLowerCase();
  const prodHits=products.filter(p=>(p.product||'').toLowerCase().includes(q)||(p.code||'').toLowerCase().includes(q)||(p.supplier||'').toLowerCase().includes(q))
    .slice(0,6).map(p=>({type:'product',name:p.product||'',unit:p.measure||'',code:p.code||null,unitCost:parseFloat(p.unitcost)||0,supplier:p.supplier||''}));
  const showPreps=editorRecipe&&editorRecipe.type==='dish';
  const prepHits=showPreps?allRecipes.filter(r=>r.type==='prep'&&r.id!==(editorRecipe?editorRecipe.id:null)&&(r.name||'').toLowerCase().includes(q))
    .slice(0,3).map(r=>({type:'prep',name:r.name||'',unit:r.batch_unit||'unit',recipeId:r.id,unitCost:getPrepCostPerUnit(r.id,allRecipes)})):[];
  ingSearchResults=prodHits.concat(prepHits);
  if(!ingSearchResults.length){resEl.innerHTML='<div class="ing-no-results">No results found</div>';resEl.classList.remove('hidden');return;}
  let html='';
  if(prodHits.length){
    html+='<div class="ing-result-section-label">Products</div>';
    prodHits.forEach((r,i)=>{
      const sub=(r.supplier&&r.unit)?r.supplier+' \u00b7 '+r.unit:(r.supplier||r.unit||'');
      html+='<div class="ing-result" onclick="selectIngredient('+i+')"><div class="ing-result-left"><div class="ing-result-name">'+esc(r.name)+'</div><div class="ing-result-sub">'+esc(sub)+'</div></div><div class="ing-result-right"><span class="ing-result-cost">'+(r.unitCost>0?'\u00a3'+r.unitCost.toFixed(4):'')+'</span></div></div>';
    });
  }
  if(prepHits.length){
    html+='<div class="ing-result-section-label">Prep Recipes</div>';
    prepHits.forEach((r,i)=>{
      const idx=prodHits.length+i;
      html+='<div class="ing-result" onclick="selectIngredient('+idx+')"><div class="ing-result-left"><div class="ing-result-name">'+esc(r.name)+'</div><div class="ing-result-sub">per '+esc(r.unit)+'</div></div><div class="ing-result-right"><span class="prep-badge">PREP</span><span class="ing-result-cost">'+(r.unitCost>0?'\u00a3'+r.unitCost.toFixed(4):'')+'</span></div></div>';
    });
  }
  resEl.innerHTML=html; resEl.classList.remove('hidden');
}

function selectIngredient(idx){
  const result=ingSearchResults[idx]; if(!result) return;
  pendingIngredient=result;
  document.getElementById('qty-modal-name').textContent=result.name;
  document.getElementById('qty-modal-meta').textContent=result.unitCost>0?'\u00a3'+result.unitCost.toFixed(4)+' per '+result.unit:(result.unit||'');
  document.getElementById('qty-unit').textContent=result.unit||'';
  document.getElementById('qty-input').value='';
  document.getElementById('qty-modal').classList.remove('hidden');
  setTimeout(()=>{const inp=document.getElementById('qty-input');if(inp)inp.focus();},80);
}
function cancelQty(){document.getElementById('qty-modal').classList.add('hidden');pendingIngredient=null;}

async function confirmQty(){
  const qty=parseFloat(document.getElementById('qty-input').value);
  if(!qty||qty<=0||!pendingIngredient){document.getElementById('qty-input').focus();return;}
  document.getElementById('qty-modal').classList.add('hidden');
  const so=(editorRecipe?.items||[]).length;
  const itemBody={item_type:pendingIngredient.type,product_name:pendingIngredient.name,unit_measure:pendingIngredient.unit,quantity:qty,sort_order:so,
    product_code:pendingIngredient.type==='product'?(pendingIngredient.code||null):null,
    sub_recipe_id:pendingIngredient.type==='prep'?pendingIngredient.recipeId:null};
  if(editorMode==='edit'&&editorRecipe?.id){
    try{const created=await apiPost('/recipes/'+editorRecipe.id+'/items',itemBody);editorRecipe.items=(editorRecipe.items||[]).concat([created]);}
    catch(e){showToast('Could not add: '+e.message);pendingIngredient=null;return;}
  } else {
    if(!editorRecipe.items) editorRecipe.items=[];
    editorRecipe.items.push(Object.assign({},itemBody,{id:null}));
  }
  pendingIngredient=null;
  document.getElementById('ingredient-search').value='';
  document.getElementById('ingredient-results').classList.add('hidden');
  ingSearchResults=[];
  renderIngredientList(); recalcTotals();
  syncRecipeToList();
}

// ══════════════════════════════════════════════════════════
// SAVE / DELETE
// ══════════════════════════════════════════════════════════
async function saveRecipe(){
  const name=(document.getElementById('recipe-name-input').value||'').trim();
  if(!name){showToast('Please enter a recipe name');document.getElementById('recipe-name-input').focus();return;}
  const type   =editorRecipe.type||'dish';
  const cat    =editorRecipe.category||'food';
  const gpVal  =parseFloat(document.getElementById('gp-target-input')?.value)||70;
  const bsVal  =parseFloat(document.getElementById('batch-size-input')?.value);
  const buVal  =(document.getElementById('batch-unit-input')?.value||'').trim();
  const miscOn =document.getElementById('misc-enabled')?.checked?1:0;
  const miscPct=parseFloat(document.getElementById('misc-pct-input')?.value)||2;
  const sellPr =type==='dish'?(parseFloat(document.getElementById('selling-price-input')?.value)||null):null;
  const actGp  =type==='dish'?(editorRecipe._actualGp||null):null;
  const notes  =(document.getElementById('recipe-notes')?.value||'').trim();

  const body={
    name,type,category:cat,
    gp_target:  type==='dish'?gpVal:null,
    batch_size: type==='prep'?(isNaN(bsVal)?null:bsVal):null,
    batch_unit: type==='prep'?(buVal||null):null,
    misc_enabled:miscOn,misc_pct:miscPct,
    selling_price:sellPr,actual_gp:actGp,
    notes:notes||null,
  };

  const btn=document.getElementById('save-btn');
  btn.disabled=true; btn.textContent='Saving\u2026';

  try {
    if(editorMode==='new'){
      console.log('[save] Creating recipe, body:', JSON.stringify(body));
      const created=await apiPost('/recipes',body);
      console.log('[save] Recipe created, id:', created.id, 'items to post:', (editorRecipe.items||[]).length);

      for(const item of (editorRecipe.items||[])){
        const itemBody={
          item_type:item.item_type,product_name:item.product_name,unit_measure:item.unit_measure,
          quantity:item.quantity,sort_order:item.sort_order||0,
          product_code:item.product_code||null,sub_recipe_id:item.sub_recipe_id||null,
        };
        console.log('[save] Posting item:', itemBody);
        await apiPost('/recipes/'+created.id+'/items', itemBody);
        console.log('[save] Item posted OK');
      }

      console.log('[save] Loading full recipe:', created.id);
      const full=await apiGet('/recipes/'+created.id);
      console.log('[save] Full recipe loaded, items:', (full.items||[]).length);
      editorMode='edit'; editorRecipe=full;
      allRecipes=[full].concat(allRecipes);
      document.getElementById('editor-delete-btn').style.visibility='visible';
      document.getElementById('editor-title').textContent=full.name;
      renderIngredientList(); recalcTotals();
      showToast('Recipe created!');
    } else {
      console.log('[save] Updating recipe', editorRecipe.id, body);
      await apiPut('/recipes/'+editorRecipe.id,body);
      const full=await apiGet('/recipes/'+editorRecipe.id);
      console.log('[save] Recipe updated OK');
      editorRecipe=full;
      allRecipes=allRecipes.map(r=>r.id===full.id?full:r);
      document.getElementById('editor-title').textContent=full.name;
      renderIngredientList(); recalcTotals();
      showToast('Recipe saved!');
    }
  } catch(e){
    console.error('[save] FAILED:', e);
    alert('Save failed:\n\n' + e.message + '\n\nCheck browser console for details (F12 \u2192 Console tab).');
  } finally {
    btn.disabled=false; btn.textContent='Save Recipe';
  }
}

async function confirmDeleteRecipe(){
  if(!editorRecipe?.id) return;
  if(!confirm('Delete "'+editorRecipe.name+'"?\n\nThis cannot be undone.')) return;
  try{
    await apiDelete('/recipes/'+editorRecipe.id);
    allRecipes=allRecipes.filter(r=>r.id!==editorRecipe.id);
    showToast('Recipe deleted'); closeEditor(); renderRecipeList();
  } catch(e){ showToast('Delete failed: '+e.message); }
}
