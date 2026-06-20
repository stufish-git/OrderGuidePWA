// ── Config ────────────────────────────────────────────────
const VERSION = 'v4.37';

const API_URL = 'https://orderguideapi.marketplacerest.com';
const API_KEY = 'og_live_0bdf8b575f3e1a75de89c775c7b870ba0edd8308e1584ada';

// ── OG State ──────────────────────────────────────────────
let products = [];
let opts     = { supplier:[], category:[], subcategory:[] };
let filters  = { search:'', supplier:new Set(), category:new Set(), subcategory:new Set() };
let sorts    = [{ field:'supplier', dir:'asc' }];
const SORT_FIELDS = [
  {v:'supplier',l:'Supplier'},{v:'product',l:'Product Name'},{v:'code',l:'Product Code'},
  {v:'category',l:'Category'},{v:'subcategory',l:'Sub Category'},{v:'price',l:'Price'},
  {v:'pack',l:'Pack Size'},{v:'unitcost',l:'Unit Cost'},{v:'lastupdate',l:'Last Update'},{v:'area',l:'Area'},
];

// ── App Settings ──────────────────────────────────────────
let appSettings = { vat_rate:20, misc_charge_pct:2, misc_on_default:true, gp_target_wet:75, gp_target_dry:70, gp_alerts_pending:'0' };

// ── Recipe State ──────────────────────────────────────────
let currentTab        = 'og';
let allRecipes        = [];
let recipesLoaded     = false;
let recipeTypeFilter  = 'all';
let editorMode        = 'new';
let editorKind        = 'food'; // 'food' | 'drink' | 'prep'
let editorRecipe      = null;
let pendingIngredient = null;
let ingSearchResults  = [];
const ingQtyTimers    = {};

let pendingDeleteId   = null;
let pendingDeleteMode = 'list'; // 'list' | 'editor'

const KIND_COLORS = { food:'#f59e0b', drink:'#1a73e8', prep:'#188038' };

function recipeKind(r){
  if(!r||r.type==='prep') return 'prep';
  return r.category==='drink' ? 'drink' : 'food';
}

// ── Menu State ────────────────────────────────────────────
let allMenuRecipes   = [];
let menuLoaded       = false;
let menuFullyLoaded  = false;
let menuTypeFilter   = 'all';
let menuSearchText   = '';
let menuIngFilters   = new Set(); // composite keys "name|||supplier" — OR logic
let menuIngredients  = [];
let menuMiscEnabled  = true;
let menuDetailRecipe = null;
let menuGPFilter     = null; // null = off | {mode:'below'|'above', pct:number}

// ── Price Alert State ─────────────────────────────────────
let priceAlerts = [];

// ── Settings State ────────────────────────────────────────
let settingsUnlocked = false;
let pinEntry         = '';

// ── Boot ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('version-badge').textContent = VERSION;
  const sv = document.getElementById('settings-version-badge');
  if (sv) sv.textContent = VERSION;
  const shv = document.getElementById('settings-header-version');
  if (shv) shv.textContent = VERSION;
  updateStickyOffset();
  loadData();
  loadSettings();
  loadPriceAlerts();
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
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { loadData(); refreshMenuData(); loadPriceAlerts(); } });
window.addEventListener('focus', () => { loadData(); refreshMenuData(); loadPriceAlerts(); });

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
    appSettings.gp_target_wet   = parseFloat(data.gp_target_wet)   || 75;
    appSettings.gp_target_dry   = parseFloat(data.gp_target_dry)   || 70;
    appSettings.gp_alerts_pending = data.gp_alerts_pending || '0';
    localStorage.setItem('og_settings', JSON.stringify(appSettings));
    renderGPAlertBanner();
    // Show last VBA push time in sync label — more meaningful to staff than page-load time
    if (data.products_last_sync) {
      const d = new Date(data.products_last_sync.replace(' ', 'T'));
      const syncEl = document.getElementById('sync-label');
      if (syncEl && !isNaN(d)) {
        syncEl.textContent =
          d.toLocaleDateString('en-GB', { day:'2-digit', month:'short' }) + ' ' +
          d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
      }
    }
  } catch(e) { /* use cached/defaults */ }
}

// ── Data loading ──────────────────────────────────────────
let initialLoad = true;
async function loadData() {
  if (initialLoad) document.getElementById('loading').classList.remove('hidden');
  try {
    const data = await apiGet('/products');
    // Remap DB column names to the internal field names used throughout the app
    products = data.map(p => ({
      product:     p.product_name             || '',
      code:        p.product_code             || '',
      supplier:    p.supplier                 || '',
      category:    p.category                 || '',
      subcategory: p.sub_category             || '',
      price:       p.price    != null ? p.price    : '',
      pack:        p.pack_size                || '',
      measure:     p.unit                     || '',
      unitcost:    p.unit_cost != null ? p.unit_cost : '',
      lastupdate:  p.last_update              || '',
      area:        '',  // not in products table
    }));
    if (!products.length) throw new Error('No products returned');
    buildOpts(); renderSortRows(); renderColHeaders(); render();
    const t = new Date();
    document.getElementById('sync-label').textContent =
      t.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
    document.getElementById('sync-pip').className = 'sync-pip ok';
    setError(null);
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

// ── Filter options ────────────────────────────────────────
function productsUpTo(level) {
  let list = products;
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
  filters.search='';
  document.getElementById('search-input').value='';
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
      <td class="col-unitcost copyable" ${cp(fmt(p.unitcost,2))}>${fmt(p.unitcost,2)}</td>
      <td class="col-date copyable" ${cp(p.lastupdate||'')}>${esc(p.lastupdate||'')}</td>
    </tr>`).join('');
}
function renderTags() {
  const bar=document.getElementById('tag-bar'),tags=[];
  if(filters.search) tags.push(mkTag(`Search: "${esc(filters.search)}"`,`clearSearch()`));
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
  ['og','menu','builder','settings'].forEach(s=>{
    const el=document.getElementById('screen-'+s);
    if(el) el.classList.toggle('hidden',s!==tab);
  });
  const printBtn=document.getElementById('print-btn');
  if(printBtn) printBtn.style.display=tab==='og'?'':'none';
  if(tab==='og') updateStickyOffset();
  else if(tab==='builder'){
    recipesLoaded=false;
    loadRecipes();
  } else if(tab==='menu'){
    if(!menuLoaded) loadMenuRecipes();
    else { updateMenuMiscBtn(); refreshMenuData(); }
  }
}

// ══════════════════════════════════════════════════════════
// API HELPERS — capture raw text so PHP errors don't hide
// ══════════════════════════════════════════════════════════
async function apiCall(method, path, body) {
  const opts = {
    method,
    cache: 'no-store',
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
async function apiGet(path){
  const sep = path.includes('?') ? '&' : '?';
  return apiCall('GET', path + sep + '_=' + Date.now());
}
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
  document.getElementById('s-gp-wet').value    = appSettings.gp_target_wet;
  document.getElementById('s-gp-dry').value    = appSettings.gp_target_dry;
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
  const gpWet    = parseFloat(document.getElementById('s-gp-wet').value) || 75;
  const gpDry    = parseFloat(document.getElementById('s-gp-dry').value) || 70;
  const btn      = document.getElementById('save-settings-btn');
  btn.disabled=true; btn.textContent='Saving\u2026';
  try {
    await apiPut('/settings',{vat_rate:String(vatRate),misc_charge_pct:String(miscPct),misc_on_default:miscOn?'1':'0',gp_target_wet:String(gpWet),gp_target_dry:String(gpDry)});
    appSettings.vat_rate=vatRate; appSettings.misc_charge_pct=miscPct; appSettings.misc_on_default=miscOn;
    appSettings.gp_target_wet=gpWet; appSettings.gp_target_dry=gpDry;
    localStorage.setItem('og_settings',JSON.stringify(appSettings));
    if (currentTab === 'menu') { renderMenuList(); renderGPAlertBanner(); updateMenuMiscBtn(); }
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
  await check('GET /products',()=>apiGet('/products'));
  await check('GET /menu',    ()=>apiGet('/menu'));

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
  let list=allRecipes;
  if(recipeTypeFilter==='food')  list=list.filter(r=>r.type==='dish'&&(r.category||'food')==='food');
  else if(recipeTypeFilter==='drink') list=list.filter(r=>r.type==='dish'&&r.category==='drink');
  else if(recipeTypeFilter==='prep')  list=list.filter(r=>r.type==='prep');
  if(!list.length){
    const msg=allRecipes.length===0?'No recipes yet. Tap <strong>New</strong> to create your first.':'No '+recipeTypeFilter+' recipes.';
    cardsEl.innerHTML='<div class="recipe-list-state">'+msg+'</div>'; return;
  }
  cardsEl.innerHTML=list.map(r=>recipeCardHTML(r)).join('');
}

function recipeCardHTML(r){
  const kind=recipeKind(r);
  const borderColor=KIND_COLORS[kind]||'var(--border)';
  const count=(r.items||[]).length;
  const adjCost=calcRecipeCost(r,allRecipes);
  let statsHtml='';

  if(kind==='prep'){
    const batchSize=parseFloat(r.batch_size)||0;
    const cpu=(batchSize>0&&adjCost>0)?adjCost/batchSize:null;
    statsHtml=
      cStat('Batch cost', adjCost>0?'\u00a3'+adjCost.toFixed(2):'\u2014')+
      cStat('Per '+(r.batch_unit||'unit'), cpu?'\u00a3'+cpu.toFixed(4):'\u2014');
  } else {
    const vat=parseFloat(appSettings.vat_rate)||20;
    const gp=parseFloat(r.gp_target)||70;
    const sellIncVat=adjCost>0?(adjCost/(1-gp/100))*(1+vat/100):null;
    const actualSell=parseFloat(r.selling_price)||null;
    const actualGp=parseFloat(r.actual_gp)||null;
    const gpCol=!actualGp?'var(--text)':actualGp>=(gp-0.5)?'var(--green)':actualGp>=(gp-5)?'var(--amber)':'var(--red)';
    const priceDisp=actualSell?'\u00a3'+actualSell.toFixed(2):(sellIncVat?'~\u00a3'+sellIncVat.toFixed(2):'\u2014');
    statsHtml=
      cStat('Cost', adjCost>0?'\u00a3'+adjCost.toFixed(2):'\u2014')+
      cStat('Menu price', priceDisp)+
      cStatRaw('Actual GP', actualGp?'<span style="color:'+gpCol+'">'+actualGp.toFixed(1)+'%</span>':'\u2014');
  }

  return '<div class="recipe-card" onclick="openRecipe('+r.id+')" style="border-left-color:'+borderColor+'">'+
    '<div class="card-main">'+
      '<div class="card-name">'+esc(r.name)+'</div>'+
      '<div class="type-badge '+kind+'">'+kind.toUpperCase()+'</div>'+
      '<button class="card-bin-btn" onclick="event.stopPropagation();showDeleteModal('+r.id+')" title="Delete recipe" aria-label="Delete '+esc(r.name)+'">'+
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>'+
      '</button>'+
    '</div>'+
    '<div class="card-stats-section">'+statsHtml+'</div>'+
    '<div class="card-footer">'+count+' ingredient'+(count!==1?'s':'')+'</div>'+
  '</div>';
}
function cStat(label,value){
  return '<div class="card-stat"><span class="card-stat-label">'+esc(label)+'</span><span class="card-stat-value">'+esc(String(value))+'</span></div>';
}
function cStatRaw(label,valueHtml){
  return '<div class="card-stat"><span class="card-stat-label">'+esc(label)+'</span><span class="card-stat-value">'+valueHtml+'</span></div>';
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
  if(recipe.misc_enabled&&parseFloat(recipe.misc_pct)>0)
    total=total*(1+parseFloat(recipe.misc_pct)/100);
  return total;
}

// ══════════════════════════════════════════════════════════
// RECIPE EDITOR — OPEN
// ══════════════════════════════════════════════════════════
function openNewRecipe(){
  editorMode='new'; editorKind='food';
  editorRecipe={
    id:null,name:'',type:'dish',category:'food',
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

  editorKind = recipeKind(editorRecipe);
  setRecipeKind(editorKind, false);

  const delBtn=document.getElementById('editor-delete-btn');
  delBtn.style.visibility=editorMode==='edit'?'visible':'hidden';
  document.getElementById('editor-title').textContent=editorMode==='new'?'New Recipe':(editorRecipe.name||'Recipe');

  document.getElementById('ingredient-search').value='';
  const res=document.getElementById('ingredient-results');
  res.innerHTML=''; res.classList.add('hidden');
  ingSearchResults=[];

  renderIngredientList();
  recalcTotals();

  setTimeout(function(){
    var n=document.getElementById('recipe-name-input');
    if(n) n.focus();
  }, 150);
}

function closeEditor(){
  document.getElementById('recipe-editor-view').classList.add('hidden');
  document.getElementById('recipe-list-view').classList.remove('hidden');
  editorRecipe=null; pendingIngredient=null; ingSearchResults=[];
  recipesLoaded=false;
  loadRecipes();
}

function syncRecipeToList(){
  if(editorRecipe&&editorRecipe.id){
    allRecipes=allRecipes.map(r=>String(r.id)===String(editorRecipe.id)?JSON.parse(JSON.stringify(editorRecipe)):r);
    renderRecipeList();
  }
}

// ── Type / Category ───────────────────────────────────────
function setRecipeKind(kind,updateState){
  editorKind=kind;
  if(updateState!==false&&editorRecipe){
    editorRecipe.type     = kind==='prep'?'prep':'dish';
    editorRecipe.category = kind==='prep'?'food':kind;
  }
  document.querySelectorAll('.kind-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.kind===kind));
  const isPrep = kind==='prep';
  document.getElementById('dish-fields').classList.toggle('hidden',isPrep);
  document.getElementById('prep-fields').classList.toggle('hidden',!isPrep);
  document.getElementById('totals-selling').classList.toggle('hidden',isPrep);
  const miscEl=document.getElementById('misc-enabled');
  if(miscEl&&updateState!==false) miscEl.checked=kind==='drink'?false:(appSettings.misc_on_default!==false);
  if(editorMode==='new'&&updateState!==false){
    const gp=kind==='drink'?75:70;
    const gpEl=document.getElementById('gp-target-input');
    const gpDisp=document.getElementById('gp-value-display');
    if(gpEl) gpEl.value=gp;
    if(gpDisp) gpDisp.textContent=gp.toFixed(1)+'%';
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
  if(!items.length){listEl.innerHTML='<div class="ing-empty">Search above to add ingredients</div>';return;}
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

  const miscEnabled=document.getElementById('misc-enabled')?.checked;
  const miscPct=parseFloat(document.getElementById('misc-pct-input')?.value)||0;

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
    try{const created=await apiPost('/recipes/'+editorRecipe.id+'/items',itemBody);editorRecipe.items=[created].concat(editorRecipe.items||[]);}
    catch(e){showToast('Could not add: '+e.message);pendingIngredient=null;return;}
  } else {
    if(!editorRecipe.items) editorRecipe.items=[];
    editorRecipe.items.unshift(Object.assign({},itemBody,{id:null}));
  }
  pendingIngredient=null;
  document.getElementById('ingredient-search').value='';
  document.getElementById('ingredient-results').classList.add('hidden');
  ingSearchResults=[];
  renderIngredientList(); recalcTotals();
  syncRecipeToList();

  setTimeout(function(){
    var s=document.getElementById('ingredient-search');
    if(s) s.focus();
  }, 80);
}

// ══════════════════════════════════════════════════════════
// SAVE / DELETE
// ══════════════════════════════════════════════════════════
async function saveRecipe(){
  const name=(document.getElementById('recipe-name-input').value||'').trim();
  if(!name){showToast('Please enter a recipe name');document.getElementById('recipe-name-input').focus();return;}
  const kind   = editorKind;
  const type   = kind==='prep'?'prep':'dish';
  const cat    = kind==='prep'?'food':kind;
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
      const created=await apiPost('/recipes',body);
      for(const item of (editorRecipe.items||[])){
        const itemBody={
          item_type:item.item_type,product_name:item.product_name,unit_measure:item.unit_measure,
          quantity:item.quantity,sort_order:item.sort_order||0,
          product_code:item.product_code||null,sub_recipe_id:item.sub_recipe_id||null,
        };
        await apiPost('/recipes/'+created.id+'/items', itemBody);
      }
      const full=await apiGet('/recipes/'+created.id);
      editorMode='edit'; editorRecipe=full;
      showToast('Recipe created!');
      closeEditor();
    } else {
      await apiPut('/recipes/'+editorRecipe.id,body);
      const full=await apiGet('/recipes/'+editorRecipe.id);
      editorRecipe=full;
      showToast('Recipe saved!');
      closeEditor();
    }
  } catch(e){
    console.error('[save] FAILED:', e);
    alert('Save failed:\n\n' + e.message + '\n\nCheck browser console for details (F12 \u2192 Console tab).');
  } finally {
    btn.disabled=false; btn.textContent='Save Recipe';
  }
}

// ── Delete modal ──────────────────────────────────────────
function showDeleteModal(id, fromEditor){
  const recipe=allRecipes.find(r=>String(r.id)===String(id));
  if(!recipe) return;
  pendingDeleteId=id;
  pendingDeleteMode=fromEditor?'editor':'list';
  document.getElementById('del-modal-name').textContent=recipe.name;
  document.getElementById('del-modal').classList.remove('hidden');
}
function cancelDeleteModal(){
  document.getElementById('del-modal').classList.add('hidden');
  pendingDeleteId=null;
}
async function doDeleteRecipe(){
  if(!pendingDeleteId) return;
  document.getElementById('del-modal').classList.add('hidden');
  const id=pendingDeleteId; pendingDeleteId=null;
  try{
    await apiDelete('/recipes/'+id);
    allRecipes=allRecipes.filter(r=>String(r.id)!==String(id));
    showToast('Recipe deleted');
    if(pendingDeleteMode==='editor') closeEditor();
    else renderRecipeList();
  } catch(e){ showToast('Delete failed: '+e.message); }
}

function confirmDeleteRecipe(){
  if(!editorRecipe?.id) return;
  showDeleteModal(editorRecipe.id, true);
}


// ── Menu background refresh (on focus/visibility) ─────────
async function refreshMenuData() {
  if (currentTab !== 'menu' || !menuLoaded) return;
  try {
    allMenuRecipes  = await apiGet('/menu?with_items=1');
    menuFullyLoaded = true;
    renderMenuList();
    renderGPAlertBanner();
    buildMenuIngredientList();
  } catch(e) { /* silent */ }
}

// ══════════════════════════════════════════════════════════
// MENU TAB
// ══════════════════════════════════════════════════════════

async function loadMenuRecipes() {
  const cardsEl = document.getElementById('menu-cards');
  if (!cardsEl) return;
  cardsEl.innerHTML = '<div class="recipe-list-state">Loading\u2026</div>';

  menuMiscEnabled = appSettings.misc_on_default !== false;
  updateMenuMiscBtn();

  try {
    // Single call — returns list + all items together
    allMenuRecipes = await apiGet('/menu?with_items=1');
    menuLoaded      = true;
    menuFullyLoaded = true;
    renderMenuList();
    renderGPAlertBanner();
    buildMenuIngredientList();
    updateMenuSyncLabel();
  } catch(e) {
    cardsEl.innerHTML = '<div class="recipe-list-state error">Could not load: '+esc(e.message)+'</div>';
  }
}

async function updateMenuSyncLabel() {
  try {
    const s = await apiGet('/settings');
    if (s.menu_last_sync) {
      const d   = new Date(s.menu_last_sync.replace(' ','T'));
      const lbl = document.getElementById('menu-sync-label');
      if (lbl && !isNaN(d)) {
        lbl.textContent = 'Synced ' +
          d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'}) + ' ' +
          d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
      }
    }
  } catch(e) { /* silent */ }
}

function buildMenuIngredientList() {
  const seen  = new Set();
  const pairs = [];
  allMenuRecipes.forEach(r => {
    (r.items || []).forEach(item => {
      const name = (item.product_name || '').trim();
      const sup  = (item.supplier     || '').trim();
      if (!name) return;
      const key = name + '|||' + sup;
      if (!seen.has(key)) { seen.add(key); pairs.push({name, sup, key}); }
    });
  });
  // Sort by product name then supplier
  pairs.sort((a,b) => a.name.localeCompare(b.name) || a.sup.localeCompare(b.sup));
  menuIngredients = pairs;

  const listEl = document.getElementById('menu-ing-list');
  if (!listEl) return;
  if (!pairs.length) {
    listEl.innerHTML = '<div style="padding:10px 14px;font-size:13px;color:var(--text3)">No ingredients found</div>';
    return;
  }
  listEl.innerHTML = pairs.map(({name, sup, key}) => {
    const active  = menuIngFilters.has(key);
    const checked = active ? ' checked' : '';
    return '<div class="dd-item menu-ing-item'+(active?' ing-active':'')+
      '" data-key="'+esc(key)+'" onclick="toggleMenuIng(\''+esc(key)+'\')">'+
      '<input type="checkbox" class="dd-cb"'+checked+' style="pointer-events:none" tabindex="-1">'+
      '<span class="menu-ing-label">'+esc(name)+
      (sup ? '<span class="menu-ing-sup"> \u2014 '+esc(sup)+'</span>' : '')+
      '</span>'+
      '</div>';
  }).join('');
}

// ── Filters & search ─────────────────────────────────────

function setMenuTypeFilter(type) {
  menuTypeFilter = type;
  document.querySelectorAll('#menu-type-seg .seg-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.mtype === type));
  renderMenuList();
}

function onMenuSearch(val) {
  menuSearchText = val;
  renderMenuList();
}

function toggleMenuIng(key) {
  if (menuIngFilters.has(key)) menuIngFilters.delete(key);
  else                         menuIngFilters.add(key);

  const count = menuIngFilters.size;
  const badge = document.getElementById('menu-ing-badge');
  const pill  = document.getElementById('menu-ing-pill');
  if (badge) { badge.textContent = count || ''; badge.style.display = count ? 'inline' : 'none'; }
  if (pill)  { pill.classList.toggle('active', count > 0); }

  // Update the ticked row without closing the dropdown
  document.querySelectorAll('.menu-ing-item').forEach(el => {
    const k      = el.dataset.key;
    const active = menuIngFilters.has(k);
    el.classList.toggle('ing-active', active);
    const cb = el.querySelector('input[type=checkbox]');
    if (cb) cb.checked = active;
  });

  renderMenuList(); // filter updates live behind the open dropdown
}

function clearMenuIngFilter() {
  menuIngFilters.clear();
  const badge     = document.getElementById('menu-ing-badge');
  const pill      = document.getElementById('menu-ing-pill');
  const searchInp = document.getElementById('menu-ing-search');
  if (badge)     { badge.textContent = ''; badge.style.display = 'none'; }
  if (pill)      { pill.classList.remove('active'); }
  if (searchInp) { searchInp.value = ''; ddSearch('menu-ing-dd', ''); }
  document.querySelectorAll('.menu-ing-item').forEach(el => {
    el.classList.remove('ing-active');
    const cb = el.querySelector('input[type=checkbox]');
    if (cb) cb.checked = false;
  });
  renderMenuList();
}

function toggleMenuMisc() {
  menuMiscEnabled = !menuMiscEnabled;
  updateMenuMiscBtn();
  renderMenuList();
  if (menuDetailRecipe) renderMenuDetail();
}

function updateMenuMiscBtn() {
  const btn     = document.getElementById('menu-misc-btn');
  if (!btn) return;
  const miscPct = parseFloat(appSettings.misc_charge_pct) || 2;
  btn.textContent = 'Misc ' + miscPct + '%';
  btn.classList.toggle('active', menuMiscEnabled);
}

// ── List render ───────────────────────────────────────────

function renderMenuList() {
  const cardsEl = document.getElementById('menu-cards');
  if (!cardsEl) return;
  let list = allMenuRecipes;

  // Type filter
  if      (menuTypeFilter === 'wet')  list = list.filter(r => !r.is_prep && (r.plu_group||'').toLowerCase() === 'wet');
  else if (menuTypeFilter === 'dry')  list = list.filter(r => !r.is_prep && (r.plu_group||'').toLowerCase() === 'dry');
  else if (menuTypeFilter === 'prep') list = list.filter(r =>  r.is_prep);

  // Text search — PLU name and SKU
  if (menuSearchText.trim()) {
    const q = menuSearchText.trim().toLowerCase();
    list = list.filter(r =>
      (r.plu_name||'').toLowerCase().includes(q) ||
      (r.sku||'').toLowerCase().includes(q)
    );
  }

  // Ingredient filter — OR logic: recipe must contain at least one selected ingredient
  if (menuIngFilters.size > 0) {
    list = list.filter(r =>
      [...menuIngFilters].some(key => {
        const sepIdx  = key.indexOf('|||');
        const ingName = key.substring(0, sepIdx);
        const ingSup  = key.substring(sepIdx + 3);
        return (r.items||[]).some(item =>
          item.product_name === ingName && item.supplier === ingSup
        );
      })
    );
  }

  // GP filter — preps hidden while active; dishes matched by calculated GP
  if (menuGPFilter) {
    const vat     = parseFloat(appSettings.vat_rate)        || 20;
    const miscPct = parseFloat(appSettings.misc_charge_pct) || 2;
    const thresh  = menuGPFilter.pct;
    list = list.filter(r => {
      if (r.is_prep) return false;
      const group   = (r.plu_group||'').toLowerCase();
      const rawCost = parseFloat(r.total_cost) || 0;
      const cost    = rawCost * (menuMiscEnabled && group === 'dry' ? (1 + miscPct/100) : 1);
      const sell    = parseFloat(r.selling_price_inc_vat) || 0;
      if (sell <= 0 || cost <= 0) return false;
      const gp = ((sell/(1+vat/100) - cost) / (sell/(1+vat/100))) * 100;
      return menuGPFilter.mode === 'below' ? gp < thresh : gp > thresh;
    });
  }

  if (!list.length) {
    const msg = allMenuRecipes.length === 0
      ? 'No menu data. Run the Excel Push to App.'
      : 'No recipes match.';
    cardsEl.innerHTML = '<div class="recipe-list-state">'+msg+'</div>';
    return;
  }
  cardsEl.innerHTML = list.map(r => menuCardHTML(r)).join('');
}

function menuCardHTML(r) {
  const isPrep      = r.is_prep;
  const group       = (r.plu_group||'').toLowerCase();
  const borderColor = isPrep ? KIND_COLORS.prep
                    : group === 'dry' ? KIND_COLORS.food
                    : 'var(--accent)';
  const kindLabel   = isPrep ? 'PREP' : group === 'wet' ? 'WET' : group === 'dry' ? 'DRY' : 'DISH';
  const kindClass   = isPrep ? 'prep' : group === 'dry' ? 'dry' : 'wet';

  // Misc applies to dry and prep only
  const rawCost   = parseFloat(r.total_cost) || 0;
  const applyMisc = menuMiscEnabled && (isPrep || group === 'dry');
  const miscPct   = parseFloat(appSettings.misc_charge_pct) || 2;
  const cost      = applyMisc ? rawCost * (1 + miscPct / 100) : rawCost;

  const sell = parseFloat(r.selling_price_inc_vat) || 0;
  const vat  = parseFloat(appSettings.vat_rate) || 20;

  let statsHtml = '';
  if (isPrep) {
    statsHtml = cStat('Batch cost', cost > 0 ? '\u00a3'+cost.toFixed(2) : '\u2014');
  } else {
    let gpHtml = '\u2014';
    if (sell > 0 && cost > 0) {
      const sellEx = sell / (1 + vat / 100);
      const gp     = ((sellEx - cost) / sellEx) * 100;
      const gpCol  = gp >= 69.5 ? 'var(--green)' : gp >= 65 ? 'var(--amber)' : 'var(--red)';
      gpHtml = '<span style="color:'+gpCol+'">'+gp.toFixed(1)+'%</span>';
    }
    statsHtml =
      cStat('Cost',       cost > 0 ? '\u00a3'+cost.toFixed(2) : '\u2014') +
      cStat('Menu price', sell > 0 ? '\u00a3'+sell.toFixed(2) : '\u2014') +
      cStatRaw('GP', gpHtml);
  }

  const warnIcon = !r.costing_complete
    ? '<span class="menu-warn-icon" title="Some ingredient costs missing">\u26a0\ufe0f</span>' : '';
  const count = parseInt(r.item_count) || 0;

  return '<div class="recipe-card" onclick="openMenuDetail(\''+esc(r.recipe_code)+'\')" style="border-left-color:'+borderColor+'">' +
    '<div class="card-main">' +
      '<div class="card-name">'+esc(r.plu_name)+'</div>' +
      '<div class="type-badge '+kindClass+'">'+kindLabel+'</div>' +
      warnIcon +
    '</div>' +
    '<div class="card-stats-section">'+statsHtml+'</div>' +
    (count ? '<div class="card-footer">'+count+' ingredient'+(count!==1?'s':'')+'</div>' : '') +
  '</div>';
}

// ── Detail view ───────────────────────────────────────────

function openMenuDetail(code) {
  const recipe = allMenuRecipes.find(r => String(r.recipe_code) === String(code));
  if (!recipe) return;
  menuDetailRecipe = recipe;

  document.getElementById('menu-detail-title').textContent = recipe.plu_name || '';
  document.getElementById('menu-list-view').classList.add('hidden');
  document.getElementById('menu-detail-view').classList.remove('hidden');

  // Items pre-loaded via with_items fetch — always render immediately
  renderMenuDetail();
}

function closeMenuDetail() {
  document.getElementById('menu-detail-view').classList.add('hidden');
  document.getElementById('menu-list-view').classList.remove('hidden');
  menuDetailRecipe = null;
}

function renderMenuDetail() {
  if (!menuDetailRecipe) return;
  const r       = menuDetailRecipe;
  const isPrep  = r.is_prep;
  const group   = (r.plu_group||'').toLowerCase();
  const rawCost = parseFloat(r.total_cost) || 0;
  const sell    = parseFloat(r.selling_price_inc_vat) || 0;
  const vat     = parseFloat(appSettings.vat_rate) || 20;

  // Misc applies to dry and prep
  const applyMisc = menuMiscEnabled && (isPrep || group === 'dry');
  const miscPct   = parseFloat(appSettings.misc_charge_pct) || 2;
  const miscAmt   = applyMisc ? rawCost * miscPct / 100 : 0;
  const cost      = rawCost + miscAmt;

  document.getElementById('menu-detail-title').textContent = r.plu_name || '';

  let html = '';

  // ── Details section ──────────────────────────────────────
  html += '<div class="editor-section editor-section-details">';
  if (r.sku) html += menuDetailRow('SKU', r.sku, true);
  html += menuDetailRow('Receipe Code', r.recipe_code, true);
  html += menuDetailRow('Type', isPrep ? 'Prep item' : (group === 'wet' ? 'Wet' : group === 'dry' ? 'Dry' : 'Dish'), false);
  if (!r.costing_complete) {
    html += '<div class="menu-detail-warn">\u26a0\ufe0f One or more ingredient costs were missing '+
            'from the order guide when last synced. The total shown is incomplete.</div>';
  }
  html += '</div>';

  // ── Costs / GP section ───────────────────────────────────
  html += '<div class="editor-section" style="border-left-color:var(--green)">';
  html += '<div class="section-title">Costs'+(isPrep?'':' &amp; GP')+'</div>';

  if (rawCost > 0) {
    html += '<div class="totals-sub-label">Ingredient cost</div>';
    if (applyMisc && miscAmt > 0) {
      html += tRow('Ingredients',        '\u00a3'+rawCost.toFixed(2));
      html += tRow('Misc ('+miscPct+'%)', '+\u00a0\u00a3'+miscAmt.toFixed(2), 'sub');
      html += '<hr class="totals-divider">';
    }
    html += tRow('Total cost', '\u00a3'+cost.toFixed(2));
  }

  if (!isPrep) {
    if (sell > 0) {
      const sellEx = sell / (1 + vat / 100);
      const gp     = cost > 0 ? ((sellEx - cost) / sellEx) * 100 : null;
      const gpCls  = gp === null ? '' : gp >= 69.5 ? 'ok' : gp >= 65 ? 'warn' : 'bad';
      html += '<div class="totals-sub-label" style="margin-top:10px">Excel menu price</div>';
      html += tRow('Inc '+vat+'% VAT', '\u00a3'+sell.toFixed(2));
      html += tRow('Ex VAT',           '\u00a3'+sellEx.toFixed(2));
      if (gp !== null) html += tRow('Gross profit', gp.toFixed(1)+'%', gpCls);
    }

    // Local GP modelling — no write-back
    html += '<div class="totals-selling-wrap" style="margin-top:12px">';
    html += '<div class="selling-label">Model a menu price (inc VAT)</div>';
    html += '<div class="selling-input-row">';
    html += '<span class="selling-prefix">&pound;</span>';
    html += '<input type="number" id="menu-sell-input" class="selling-price-input" '+
            'min="0" step="0.01" placeholder="0.00" oninput="onMenuSellInput(this.value)">';
    html += '</div></div>';
    html += '<div id="menu-model-result"></div>';
  }

  html += '</div>';

  // ── Ingredients section ───────────────────────────────────
  const items = r.items || [];
  if (items.length) {
    html += '<div class="editor-section editor-section-ingredients" style="margin-bottom:12px">';
    html += '<div class="section-title">Ingredients</div>';
    html += '<div class="menu-ing-list">';
    items.forEach(item => {
      const lc = parseFloat(item.line_cost) || 0;
      const uc = parseFloat(item.unit_cost) || 0;
      const prepBadge = item.is_prep_line ? '<span class="ing-prep-badge">PREP</span>' : '';
      html += '<div class="menu-ing-row">' +
        '<div class="menu-ing-info">' +
          '<div class="menu-ing-name">'+esc(item.product_name||'')+prepBadge+'</div>' +
          '<div class="menu-ing-sub">'+esc(item.supplier||'') +
            (item.usage_description ? ' \u00b7 '+esc(item.usage_description) : '') +
          '</div>' +
        '</div>' +
        '<div class="menu-ing-costs">' +
          (uc > 0 ? '<div class="menu-ing-uc">'+esc(item.unit_measure||'')+' @ \u00a3'+uc.toFixed(2)+'</div>' : '') +
          '<div class="menu-ing-lc">'+(lc > 0 ? '\u00a3'+lc.toFixed(2) : '\u2014')+'</div>' +
        '</div>' +
      '</div>';
    });
    html += '</div></div>';
  }

  const body = document.getElementById('menu-detail-body');
  body.innerHTML = html;
  // Store raw cost and meta for GP model recalc
  body.dataset.rawcost = rawCost;
  body.dataset.vat     = vat;
  body.dataset.isprep  = isPrep;
  body.dataset.group   = group;
}

function menuDetailRow(label, value, mono) {
  return '<div class="menu-detail-row">' +
    '<span class="menu-detail-label">'+esc(label)+'</span>' +
    '<span class="menu-detail-value'+(mono?' mono':'')+'">'+esc(String(value||''))+'</span>' +
  '</div>';
}

function onMenuSellInput(val) {
  const sell    = parseFloat(val) || 0;
  const body    = document.getElementById('menu-detail-body');
  const rawCost = parseFloat(body ? body.dataset.rawcost : 0) || 0;
  const vat     = parseFloat(body ? body.dataset.vat  : 20) || 20;
  const isPrep  = body ? body.dataset.isprep === 'true' : false;
  const group   = body ? body.dataset.group  : '';
  const resEl   = document.getElementById('menu-model-result');
  if (!resEl) return;
  if (sell <= 0 || rawCost <= 0) { resEl.innerHTML = ''; return; }

  // Apply misc to cost for GP model (same logic as cards)
  const applyMisc = menuMiscEnabled && (isPrep || group === 'dry');
  const miscPct   = parseFloat(appSettings.misc_charge_pct) || 2;
  const miscAmt   = applyMisc ? rawCost * miscPct / 100 : 0;
  const cost      = rawCost + miscAmt;

  const sellEx = sell / (1 + vat / 100);
  const gp     = ((sellEx - cost) / sellEx) * 100;
  const gpCls  = gp >= 69.5 ? 'ok' : gp >= 65 ? 'warn' : 'bad';
  let html = '<div class="totals-sub-label" style="margin-top:8px">Model result</div>';
  html += tRow('Ex '+vat+'% VAT', '\u00a3'+sellEx.toFixed(2));
  html += tRow('Gross profit',    gp.toFixed(1)+'%', gpCls);
  html += tRow('GP cash',         '\u00a3'+(sellEx-cost).toFixed(2));
  resEl.innerHTML = html;
}

// ══════════════════════════════════════════════════════════
// PRICE ALERTS
// ══════════════════════════════════════════════════════════

async function loadPriceAlerts() {
  try {
    priceAlerts = await apiGet('/price-history/alerts');
    renderPriceAlertBanner();
  } catch(e) { /* silent — non-critical */ }
}

function renderPriceAlertBanner() {
  const banner = document.getElementById('price-alert-banner');
  const badge  = document.getElementById('og-alert-badge');
  const count  = priceAlerts.length;

  if (banner) {
    banner.classList.toggle('hidden', count === 0);
    const txt = document.getElementById('price-alert-text');
    if (txt) txt.textContent = count + ' price change' + (count !== 1 ? 's' : '') + ' since last check';
  }
  // Nav badge — visible from any tab
  if (badge) badge.classList.toggle('hidden', count === 0);
}

function showPriceAlertSheet() {
  if (!priceAlerts.length) return;

  const body = document.getElementById('price-alert-sheet-body');

  let html = '';
  priceAlerts.forEach(a => {
    const isInc   = (a.price_change || 0) > 0;
    const isDec   = (a.price_change || 0) < 0;
    const rowCls  = isInc ? 'price-up' : isDec ? 'price-down' : '';
    const arrow   = isInc ? '\u2191' : isDec ? '\u2193' : '\u2192';
    const pctVal  = a.diff_pct !== null ? parseFloat(a.diff_pct) : null;
    const pctStr  = pctVal !== null ? (pctVal > 0 ? '+' : '') + pctVal.toFixed(2) + '%' : '';
    const dateStr = a.effective_date
      ? new Date(a.effective_date + 'T00:00:00').toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'})
      : '';

    html += '<div class="price-alert-row ' + rowCls + '">' +
      '<div class="price-alert-main">' +
        '<div class="price-alert-name">' + esc(a.product_name || a.product_code || '') + '</div>' +
        '<div class="price-alert-meta">' + esc(a.supplier || '') + (dateStr ? ' \u00b7 ' + dateStr : '') + '</div>' +
      '</div>' +
      '<div class="price-alert-prices">' +
        '<div class="price-alert-old">' + (a.prev_price ? '\u00a3' + parseFloat(a.prev_price).toFixed(2) : '\u2014') + '</div>' +
        '<div class="price-alert-new">' + arrow + ' \u00a3' + parseFloat(a.price).toFixed(2) + '</div>' +
        (pctStr ? '<div class="price-alert-pct">' + pctStr + '</div>' : '') +
      '</div>' +
    '</div>';
  });

  body.innerHTML = html;
  document.getElementById('price-alert-sheet').classList.remove('hidden');
}

function closePriceAlertSheet() {
  document.getElementById('price-alert-sheet').classList.add('hidden');
}

async function acknowledgePriceAlerts() {
  try {
    await apiPut('/price-history/acknowledge', {});
    priceAlerts = [];
    renderPriceAlertBanner();
    closePriceAlertSheet();
  } catch(e) {
    showToast('Could not acknowledge: ' + e.message);
  }
}

// ══════════════════════════════════════════════════════════
// GP ALERTS
// ══════════════════════════════════════════════════════════

function renderGPAlertBanner() {
  const banner = document.getElementById('gp-alert-banner');
  if (!banner) return;

  const pending = appSettings.gp_alerts_pending === '1';
  const count   = allMenuRecipes.filter(r => r.below_target).length;

  banner.classList.toggle('hidden', !pending || count === 0);
  if (pending && count > 0) {
    const txt = document.getElementById('gp-alert-text');
    if (txt) txt.textContent = count + ' recipe' + (count !== 1 ? 's' : '') + ' below GP target';
  }
}

function showGPAlertSheet() {
  const body = document.getElementById('gp-alert-sheet-body');
  if (!body) return;

  const vat     = parseFloat(appSettings.vat_rate)        || 20;
  const miscPct = parseFloat(appSettings.misc_charge_pct)  || 2;
  const below   = allMenuRecipes.filter(r => r.below_target);

  let html = '';
  below.forEach(r => {
    const group   = (r.plu_group || '').toLowerCase();
    const target  = group === 'wet'
      ? (parseFloat(appSettings.gp_target_wet) || 75)
      : (parseFloat(appSettings.gp_target_dry) || 70);
    const rawCost  = parseFloat(r.total_cost) || 0;
    const applyMisc = menuMiscEnabled && group === 'dry';
    const cost     = rawCost + (applyMisc ? rawCost * miscPct / 100 : 0);
    const sell     = parseFloat(r.selling_price_inc_vat) || 0;
    const sellEx   = sell > 0 ? sell / (1 + vat / 100) : 0;
    const gp       = sellEx > 0 ? ((sellEx - cost) / sellEx * 100) : 0;
    const badge    = group === 'wet' ? 'WET' : 'DRY';
    const badgeCls = group === 'wet' ? 'wet' : 'dry';
    const gap      = gp - target;

    html += '<div class="gp-alert-row">' +
      '<div class="gp-alert-main">' +
        '<div class="gp-alert-name">' + esc(r.plu_name) + '</div>' +
        '<div class="gp-alert-meta"><span class="type-badge ' + badgeCls + '">' + badge + '</span>' +
          ' target ' + target + '%</div>' +
      '</div>' +
      '<div class="gp-alert-right">' +
        '<div class="gp-alert-gp bad">' + gp.toFixed(1) + '%</div>' +
        '<div class="gp-alert-gap">' + gap.toFixed(1) + '%</div>' +
      '</div>' +
    '</div>';
  });

  body.innerHTML = html || '<div class="recipe-list-state">No below-target recipes.</div>';
  document.getElementById('gp-alert-sheet').classList.remove('hidden');
}

function closeGPAlertSheet() {
  document.getElementById('gp-alert-sheet').classList.add('hidden');
}

async function acknowledgeGPAlerts() {
  try {
    await apiPut('/settings', {gp_alerts_pending: '0'});
    appSettings.gp_alerts_pending = '0';
    renderGPAlertBanner();
    closeGPAlertSheet();
  } catch(e) {
    showToast('Could not dismiss: ' + e.message);
  }
}

// ══════════════════════════════════════════════════════════
// MENU GP FILTER
// ══════════════════════════════════════════════════════════

function toggleGPPanel() {
  const panel = document.getElementById('menu-gp-panel');
  if (!panel) return;
  const opening = panel.classList.contains('hidden');

  if (!opening) {
    // Closing — hide panel and clear filter
    panel.classList.add('hidden');
    menuGPFilter = null;
    updateGPPill();
    renderMenuList();
    return;
  }

  // Opening — reset to defaults then apply immediately
  panel.classList.remove('hidden');
  const slider = document.getElementById('menu-gp-slider');
  if (slider) slider.value = 70;
  document.getElementById('menu-gp-value').textContent = '70%';
  document.getElementById('gp-mode-below').classList.add('active');
  document.getElementById('gp-mode-above').classList.remove('active');
  menuGPFilter = {mode: 'below', pct: 70};
  updateGPPill();
  renderMenuList();
}

function setGPMode(mode) {
  document.getElementById('gp-mode-below').classList.toggle('active', mode === 'below');
  document.getElementById('gp-mode-above').classList.toggle('active', mode === 'above');
  const pct = parseInt(document.getElementById('menu-gp-slider').value) || 70;
  menuGPFilter = {mode, pct};
  updateGPPill();
  renderMenuList();
}

function onGPSlider(val) {
  const pct = parseInt(val);
  document.getElementById('menu-gp-value').textContent = pct + '%';
  const mode = document.getElementById('gp-mode-above').classList.contains('active') ? 'above' : 'below';
  menuGPFilter = {mode, pct};
  updateGPPill();
  renderMenuList();
}

function clearGPFilter() {
  menuGPFilter = null;
  const slider = document.getElementById('menu-gp-slider');
  if (slider) slider.value = 70;
  const valEl = document.getElementById('menu-gp-value');
  if (valEl) valEl.textContent = '70%';
  document.getElementById('gp-mode-below').classList.add('active');
  document.getElementById('gp-mode-above').classList.remove('active');
  document.getElementById('menu-gp-panel').classList.add('hidden');
  updateGPPill();
  renderMenuList();
}

function updateGPPill() {
  const btn = document.getElementById('menu-gp-btn');
  if (!btn) return;
  const lbl = document.getElementById('menu-gp-label');
  if (menuGPFilter) {
    const sym = menuGPFilter.mode === 'below' ? '<' : '>';
    if (lbl) lbl.textContent = sym + '\u202f' + menuGPFilter.pct + '%';
    btn.classList.add('active');
  } else {
    if (lbl) lbl.textContent = 'GP';
    btn.classList.remove('active');
  }
}
