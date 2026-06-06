// ── Config ────────────────────────────────────────────────
const VERSION = 'v4.2';

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQZ12Nc-aBIdhgsZ2LVvLYz0PytxUhIyoa10ESs7EcOQ_nxIZv3cP1-92Q1mapu5wbBvf6fASMM8ifS/pub?gid=1704018109&single=true&output=csv';

const API_URL = 'https://orderguideapi.marketplacerest.com';
const API_KEY = 'og_live_0bdf8b575f3e1a75de89c775c7b870ba0edd8308e1584ada';

// ── Column map (sheet headers -> field keys) ──────────────
const COL = {
  'Supplier':           'supplier',
  'Product Name':       'product',
  'Product Code':       'code',
  'Stock Category':     'category',
  'Sub Stock Category': 'subcategory',
  'Price':              'price',
  'Pack Size':          'pack',
  'Unit Measure':       'measure',
  'Unit Cost':          'unitcost',
  'Last Update':        'lastupdate',
  'Area':               'area',
};

// ── OG State ──────────────────────────────────────────────
let products = [];
let opts     = { supplier: [], category: [], subcategory: [] };
let filters  = {
  area:        'all',
  search:      '',
  supplier:    new Set(),
  category:    new Set(),
  subcategory: new Set(),
};
let sorts = [{ field: 'supplier', dir: 'asc' }];

const SORT_FIELDS = [
  { v: 'supplier',    l: 'Supplier'      },
  { v: 'product',     l: 'Product Name'  },
  { v: 'code',        l: 'Product Code'  },
  { v: 'category',    l: 'Category'      },
  { v: 'subcategory', l: 'Sub Category'  },
  { v: 'price',       l: 'Price'         },
  { v: 'pack',        l: 'Pack Size'     },
  { v: 'unitcost',    l: 'Unit Cost'     },
  { v: 'lastupdate',  l: 'Last Update'   },
  { v: 'area',        l: 'Area'          },
];

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

// ── Boot ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('version-badge').textContent = VERSION;
  updateStickyOffset();
  loadData();

  document.addEventListener('click', e => {
    if (!e.target.closest('.ingredient-search-wrap') &&
        !e.target.closest('.ingredient-results')) {
      const res = document.getElementById('ingredient-results');
      if (res) res.classList.add('hidden');
    }
  });
});

window.addEventListener('resize', updateStickyOffset);

document.addEventListener('click', e => {
  if (!e.target.closest('.filter-wrap')) closeAll();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadData();
});

window.addEventListener('focus', loadData);

// ── Data loading ──────────────────────────────────────────
let initialLoad = true;

async function loadData() {
  if (initialLoad) {
    document.getElementById('loading').classList.remove('hidden');
  }
  try {
    const r = await fetch(CSV_URL + '&t=' + Date.now());
    if (!r.ok) throw new Error('HTTP ' + r.status);
    products = parseCSV(await r.text());
    if (!products.length) throw new Error('Sheet appears empty');
    buildOpts();
    renderSortRows();
    renderColHeaders();
    render();
    const t = new Date();
    document.getElementById('sync-label').textContent =
      t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('sync-pip').className = 'sync-pip ok';
    setError(null);
    checkStaleData();
  } catch (e) {
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
    hdrs.forEach((h, i) => {
      o[COL[h.trim()] || h.trim()] = (v[i] || '').trim();
    });
    return o;
  }).filter(Boolean);
}

function csvRow(line) {
  const res = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (c === ',' && !q) {
      res.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  res.push(cur);
  return res;
}

// ── Cascading filter options ───────────────────────────────
function productsUpTo(level) {
  let list = products;
  if (filters.area !== 'all')
    list = list.filter(p => (p.area || '').toLowerCase() === filters.area);
  if (level === 'supplier') return list;
  if (filters.supplier.size > 0)
    list = list.filter(p => filters.supplier.has(p.supplier));
  if (level === 'category') return list;
  if (filters.category.size > 0)
    list = list.filter(p => filters.category.has(p.category));
  return list;
}

function buildOpts() {
  rebuildDropdown('supplier');
  rebuildDropdown('category');
  rebuildDropdown('subcategory');
}

function rebuildDropdown(k) {
  const upstream = productsUpTo(k);
  opts[k] = [...new Set(upstream.map(p => p[k]).filter(Boolean))].sort();
  filters[k].forEach(v => { if (!opts[k].includes(v)) filters[k].delete(v); });
  renderDDItems(k);
  updatePill(k);
}

function renderDDItems(k) {
  if (opts[k].length === 0) {
    document.getElementById('dl-' + k).innerHTML =
      '<div style="padding:10px 14px;font-size:13px;color:var(--text3)">No options available</div>';
    return;
  }
  document.getElementById('dl-' + k).innerHTML = opts[k].map(v => `
    <div class="dd-item" onclick="onCheck('${k}','${esc(v)}',!this.querySelector('input').checked);this.querySelector('input').checked=!this.querySelector('input').checked">
      <input type="checkbox" onclick="event.stopPropagation();onCheck('${k}','${esc(v)}',this.checked)"
        ${filters[k].has(v) ? 'checked' : ''}>
      <span>${esc(v)}</span>
    </div>`).join('');
}

function ddSearch(ddId, q) {
  document.querySelectorAll('#' + ddId + ' .dd-item').forEach(el => {
    const span = el.querySelector('span');
    if (!span) return;
    el.style.display = span.textContent.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
  });
}

// ── Filter interactions ───────────────────────────────────
function setArea(a) {
  filters.area = a;
  document.querySelectorAll('.seg-btn')
    .forEach(b => b.classList.toggle('active', b.dataset.area === a));
  clearDownstream('area');
  render();
}

function onSearch(v) {
  filters.search = v;
  render();
}

function parseSearchTerms(raw) {
  const terms = [];
  const quotedRe = /"([^"]+)"/g;
  let match;
  let remainder = raw;
  while ((match = quotedRe.exec(raw)) !== null) {
    terms.push({ text: match[1].toLowerCase(), exact: true });
    remainder = remainder.replace(match[0], ' ');
  }
  remainder.trim().split(/\s+/).forEach(w => {
    if (w) terms.push({ text: w.toLowerCase(), exact: false });
  });
  return terms;
}

function matchesSearch(p, terms) {
  const haystack = [
    p.product, p.supplier, p.code, p.category, p.subcategory
  ].join(' ').toLowerCase();
  return terms.every(term => {
    if (term.exact) {
      const re = new RegExp('\\b' + term.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      return re.test(haystack);
    } else {
      return haystack.includes(term.text);
    }
  });
}

function onCheck(k, v, checked) {
  checked ? filters[k].add(v) : filters[k].delete(v);
  clearDownstream(k);
  updatePill(k);
  render();
}

function selAll(k) {
  filters[k] = new Set();
  clearDownstream(k);
  updatePill(k);
  render();
}

function clearDownstream(level) {
  const order = ['supplier', 'category', 'subcategory'];
  const startIdx = level === 'area' ? 0 : order.indexOf(level) + 1;
  for (let i = startIdx; i < order.length; i++) {
    filters[order[i]] = new Set();
  }
  const rebuildFrom = level === 'area' ? 0 : order.indexOf(level);
  for (let i = rebuildFrom; i < order.length; i++) {
    rebuildDropdown(order[i]);
  }
}

function removeTag(k, v) {
  filters[k].delete(v);
  clearDownstream(k);
  updatePill(k);
  render();
}

function updatePill(k) {
  const badge = document.getElementById('fb-' + k);
  const pill  = document.getElementById('fp-' + k);
  const n     = filters[k].size;
  if (n === 0) {
    badge.style.display = 'none';
    pill.classList.remove('active');
  } else {
    badge.textContent   = n;
    badge.style.display = 'inline';
    pill.classList.add('active');
  }
}

function clearAll() {
  filters.search = '';
  filters.area   = 'all';
  document.getElementById('search-input').value = '';
  document.querySelectorAll('.seg-btn')
    .forEach(b => b.classList.toggle('active', b.dataset.area === 'all'));
  ['supplier', 'category', 'subcategory'].forEach(k => { filters[k] = new Set(); });
  buildOpts();
  render();
}

function clearSearch() {
  filters.search = '';
  document.getElementById('search-input').value = '';
  render();
}

// ── Column header sort ────────────────────────────────────
function sortByCol(field) {
  if (sorts.length === 1 && sorts[0].field === field) {
    sorts[0].dir = sorts[0].dir === 'asc' ? 'desc' : 'asc';
  } else {
    sorts = [{ field, dir: 'asc' }];
  }
  renderSortRows();
  renderColHeaders();
}

function renderColHeaders() {
  document.querySelectorAll('th[data-col]').forEach(th => {
    const field     = th.dataset.col;
    const sortIndex = sorts.findIndex(s => s.field === field);
    const arrow     = th.querySelector('.sort-arrow');
    if (sortIndex === 0) {
      arrow.innerHTML  = sorts[0].dir === 'asc' ? '&#9650;' : '&#9660;';
      arrow.className  = 'sort-arrow active';
    } else {
      arrow.innerHTML  = '&#9650;';
      arrow.className  = 'sort-arrow';
    }
  });
}

function renderSortRows() {
  document.getElementById('sort-rows').innerHTML = sorts.map((s, i) => `
    <div class="sort-row">
      <select onchange="sorts[${i}].field=this.value;renderColHeaders();render()">
        ${SORT_FIELDS.map(f =>
          `<option value="${f.v}"${f.v === s.field ? ' selected' : ''}>${f.l}</option>`
        ).join('')}
      </select>
      <button class="sort-dir ${s.dir}"
        onclick="sorts[${i}].dir=sorts[${i}].dir==='asc'?'desc':'asc';renderSortRows()">
        ${s.dir === 'asc' ? 'ASC' : 'DESC'}
      </button>
      ${sorts.length > 1
        ? `<button class="sort-del" onclick="sorts.splice(${i},1);renderSortRows()">&#x2715;</button>`
        : '<span style="width:28px"></span>'
      }
    </div>`).join('');
  document.getElementById('add-sort').disabled = sorts.length >= 3;
  render();
  renderColHeaders();
}

function addSort() {
  if (sorts.length < 3) {
    sorts.push({ field: 'product', dir: 'asc' });
    renderSortRows();
  }
}

// ── Core render ───────────────────────────────────────────
function render() {
  let list = products;

  if (filters.area !== 'all')
    list = list.filter(p => (p.area || '').toLowerCase() === filters.area);

  ['supplier', 'category', 'subcategory'].forEach(k => {
    if (filters[k].size > 0) list = list.filter(p => filters[k].has(p[k]));
  });

  const rawSearch = filters.search.trim();
  const searchTerms = rawSearch ? parseSearchTerms(rawSearch) : [];
  if (searchTerms.length) list = list.filter(p => matchesSearch(p, searchTerms));

  list = [...list].sort((a, b) => {
    for (const s of sorts) {
      const av = a[s.field] || '', bv = b[s.field] || '';
      const na = parseFloat(String(av).replace(/[^0-9.]/g, ''));
      const nb = parseFloat(String(bv).replace(/[^0-9.]/g, ''));
      let c = (!isNaN(na) && !isNaN(nb))
        ? na - nb
        : String(av).localeCompare(String(bv));
      if (c !== 0) return s.dir === 'asc' ? c : -c;
    }
    return 0;
  });

  renderTable(list, searchTerms);
  renderTags();
  updateStickyOffset();

  document.getElementById('results-bar').innerHTML =
    `<strong>${list.length.toLocaleString()}</strong> of ${products.length.toLocaleString()} products`;

  const parts = [];
  if (filters.area !== 'all') parts.push('Area: ' + filters.area);
  if (filters.search) parts.push('Search: "' + filters.search + '"');
  ['supplier', 'category', 'subcategory'].forEach(k => {
    if (filters[k].size > 0 && !filters[k].has('__none__'))
      parts.push([...filters[k]].join(', '));
  });
  const d = new Date().toLocaleDateString('en-GB',
    { day: '2-digit', month: 'short', year: 'numeric' });
  document.getElementById('print-meta').textContent =
    (parts.length ? parts.join(' - ') + ' - ' : '') + d;
}

function renderTable(list, terms) {
  const tbody = document.getElementById('tbody');
  const empty = document.getElementById('empty');
  if (!list.length) {
    tbody.innerHTML = '';
    empty.classList.add('show');
    return;
  }
  empty.classList.remove('show');
  tbody.innerHTML = list.map(p => {
    const price    = fmt(p.price, 2);
    const unitcost = fmt(p.unitcost, 4);
    const cp = (val) => `onclick="copyCell('${esc(val)}')"`;
    return `
    <tr>
      <td class="col-product col-sticky copyable" ${cp(p.product || '')}>${hiTerms(p.product || '', terms)}</td>
      <td class="col-supplier copyable"            ${cp(p.supplier || '')}>${hiTerms(p.supplier || '', terms)}</td>
      <td class="col-code copyable"                ${cp(p.code || '')}>${hiTerms(p.code || '', terms)}</td>
      <td class="col-category copyable"            ${cp(p.category || '')}>${hiTerms(p.category || '', terms)}</td>
      <td class="col-price copyable"               ${cp(price)}>${price}</td>
      <td class="col-pack copyable"                ${cp(p.pack || '')}>${esc(p.pack || '')}</td>
      <td class="col-measure copyable"             ${cp(p.measure || '')}>${esc(p.measure || '')}</td>
      <td class="col-unitcost copyable"            ${cp(unitcost)}>${unitcost}</td>
      <td class="col-date copyable"                ${cp(p.lastupdate || '')}>${esc(p.lastupdate || '')}</td>
    </tr>`;
  }).join('');
}

function renderTags() {
  const bar  = document.getElementById('tag-bar');
  const tags = [];
  if (filters.search)
    tags.push(mkTag(`Search: "${esc(filters.search)}"`, `clearSearch()`));
  if (filters.area !== 'all')
    tags.push(mkTag('Area: ' + filters.area, `setArea('all')`));
  const labels = { supplier: 'Supplier', category: 'Category', subcategory: 'Sub Cat' };
  ['supplier', 'category', 'subcategory'].forEach(k => {
    filters[k].forEach(v =>
      tags.push(mkTag(labels[k] + ': ' + esc(v), `removeTag('${k}','${esc(v)}')`)));
  });
  if (tags.length) {
    bar.innerHTML = tags.join('') +
      `<button class="clear-all" onclick="clearAll()">Clear all</button>`;
    bar.classList.add('show');
  } else {
    bar.innerHTML = '';
    bar.classList.remove('show');
  }
}

function mkTag(label, onclick) {
  return `<div class="tag">${label}` +
    `<button class="tag-x" onclick="${onclick}">&#x2715;</button></div>`;
}

// ── Dropdowns ─────────────────────────────────────────────
function toggleDD(id, pillId) {
  const panel = document.getElementById(id);
  const pill  = pillId ? document.getElementById(pillId) : null;
  const open  = panel.classList.contains('open');
  closeAll();
  if (!open) {
    panel.classList.add('open');
    if (pill) pill.classList.add('open');
  }
}

function closeAll() {
  document.querySelectorAll('.dropdown.open, .sort-panel.open')
    .forEach(el => el.classList.remove('open'));
  document.querySelectorAll('.filter-pill.open')
    .forEach(el => el.classList.remove('open'));
}

// ── Utilities ─────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

function hiTerms(s, terms) {
  if (!terms || !terms.length) return esc(s);
  let result = esc(s);
  terms.forEach(term => {
    const pattern = term.exact
      ? '\\b' + term.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b'
      : term.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp('(' + pattern + ')', 'gi'), '<mark>$1</mark>');
  });
  return result;
}

function hi(s, q) {
  if (!q) return esc(s);
  const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
  return esc(s).replace(re, '<mark>$1</mark>');
}

function fmt(v, dp) {
  if (!v && v !== 0) return '';
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? esc(v) : '£' + n.toFixed(dp);
}

function setError(m) {
  const b = document.getElementById('error-banner');
  if (m) { b.textContent = m; b.classList.add('show'); }
  else   { b.classList.remove('show'); }
  updateStickyOffset();
}

// ── Table height calculator ───────────────────────────────
function updateStickyOffset() {
  const wrap = document.querySelector('.table-wrap');
  if (!wrap) return;
  const selectors = [
    'header', '.toolbar', '#error-banner', '#stale-banner',
    '#tag-bar', '.results-bar'
  ];
  let above = 0;
  selectors.forEach(sel => {
    const el = document.querySelector(sel);
    if (el) above += el.offsetHeight;
  });
  const nav  = document.getElementById('bottom-nav');
  const navH = nav ? nav.offsetHeight : 0;
  wrap.style.height = (window.innerHeight - above - navH) + 'px';
}

function checkStaleData() {
  if (!products.length) return;
  let latest = null;
  products.forEach(p => {
    if (!p.lastupdate) return;
    const parts = p.lastupdate.split('/');
    if (parts.length !== 3) return;
    const d = new Date(parts[2], parts[1] - 1, parts[0]);
    if (!isNaN(d) && (!latest || d > latest)) latest = d;
  });
  if (!latest) return;
  const ageHours = (Date.now() - latest.getTime()) / (1000 * 60 * 60);
  if (ageHours > 48) {
    const days = Math.floor(ageHours / 24);
    setStaleWarning(`Price data is ${days} day${days > 1 ? 's' : ''} old — sync may not have run recently.`);
  } else {
    setStaleWarning(null);
  }
}

function setStaleWarning(msg) {
  const banner = document.getElementById('stale-banner');
  if (msg) { banner.textContent = '⚠️  ' + msg; banner.classList.add('show'); }
  else      { banner.classList.remove('show'); }
  updateStickyOffset();
}

// ── Copy on tap ───────────────────────────────────────────
let copyToast = null;

function copyCell(val) {
  if (!val) return;
  navigator.clipboard.writeText(val).then(() => {
    showToast('Copied: ' + val);
  }).catch(() => {
    showToast('Could not copy');
  });
}

function showToast(msg) {
  if (copyToast) clearTimeout(copyToast);
  const toast = document.getElementById('copy-toast');
  toast.textContent = msg;
  toast.classList.add('show');
  copyToast = setTimeout(() => toast.classList.remove('show'), 2500);
}

function openSearchInfo() {
  document.getElementById('search-modal').classList.add('open');
}

function closeSearchInfo(e) {
  if (!e || e.target === document.getElementById('search-modal')) {
    document.getElementById('search-modal').classList.remove('open');
  }
}


// ══════════════════════════════════════════════════════════
// RECIPES
// ══════════════════════════════════════════════════════════

// ── Navigation ────────────────────────────────────────────
function switchTab(tab) {
  if (tab === currentTab) return;
  currentTab = tab;

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  const screenOg      = document.getElementById('screen-og');
  const screenRecipes = document.getElementById('screen-recipes');
  const printBtn      = document.getElementById('print-btn');

  if (tab === 'og') {
    screenOg.classList.remove('hidden');
    screenRecipes.classList.add('hidden');
    if (printBtn) printBtn.style.display = '';
    updateStickyOffset();
  } else {
    screenOg.classList.add('hidden');
    screenRecipes.classList.remove('hidden');
    if (printBtn) printBtn.style.display = 'none';
    if (!recipesLoaded) loadRecipes();
  }
}

// ── API Helpers ───────────────────────────────────────────
async function apiGet(path) {
  const r = await fetch(API_URL + path, {
    headers: { 'X-API-Key': API_KEY }
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'API ' + r.status);
  }
  return r.json();
}

async function apiPost(path, body) {
  const r = await fetch(API_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'API ' + r.status);
  }
  return r.json();
}

async function apiPut(path, body) {
  const r = await fetch(API_URL + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'API ' + r.status);
  }
  return r.json();
}

async function apiDelete(path) {
  const r = await fetch(API_URL + path, {
    method: 'DELETE',
    headers: { 'X-API-Key': API_KEY }
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'API ' + r.status);
  }
  return r.json();
}

// ── Recipe list ───────────────────────────────────────────
async function loadRecipes() {
  const cardsEl = document.getElementById('recipe-cards');
  cardsEl.innerHTML = '<div class="recipe-list-state">Loading recipes\u2026</div>';

  try {
    const list = await apiGet('/recipes');

    if (list.length === 0) {
      allRecipes    = [];
      recipesLoaded = true;
      renderRecipeList();
      return;
    }

    // Fetch full details (with items) in parallel for live cost display
    allRecipes    = await Promise.all(list.map(r => apiGet('/recipes/' + r.id)));
    recipesLoaded = true;
    renderRecipeList();
  } catch (e) {
    cardsEl.innerHTML = '<div class="recipe-list-state error">Could not load recipes: ' + esc(e.message) + '</div>';
  }
}

function setRecipeTypeFilter(type) {
  recipeTypeFilter = type;
  document.querySelectorAll('#recipe-type-seg .seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.rtype === type);
  });
  renderRecipeList();
}

function renderRecipeList() {
  const cardsEl = document.getElementById('recipe-cards');
  const list = recipeTypeFilter === 'all'
    ? allRecipes
    : allRecipes.filter(r => r.type === recipeTypeFilter);

  if (!list.length) {
    const msg = allRecipes.length === 0
      ? 'No recipes yet. Tap <strong>New</strong> to create your first.'
      : 'No ' + recipeTypeFilter + ' recipes.';
    cardsEl.innerHTML = '<div class="recipe-list-state">' + msg + '</div>';
    return;
  }

  cardsEl.innerHTML = list.map(r => recipeCardHTML(r)).join('');
}

function recipeCardHTML(r) {
  const totalCost = calcRecipeCost(r, allRecipes);
  const count     = (r.items || []).length;
  const countText = count + ' ingredient' + (count !== 1 ? 's' : '');

  let statsHtml = '';
  if (r.type === 'dish') {
    const gp        = parseFloat(r.gp_target) || 70;
    const sellPrice = totalCost > 0 ? totalCost / (1 - gp / 100) : null;
    statsHtml =
      '<div class="card-stat">' +
        '<span class="card-stat-label">Total cost</span>' +
        '<span class="card-stat-value">' + (totalCost > 0 ? '\u00a3' + totalCost.toFixed(2) : '\u2014') + '</span>' +
      '</div>' +
      '<div class="card-stat">' +
        '<span class="card-stat-label">Sell @ ' + gp + '% GP</span>' +
        '<span class="card-stat-value">' + (sellPrice ? '\u00a3' + sellPrice.toFixed(2) : '\u2014') + '</span>' +
      '</div>';
  } else {
    const batchSize   = parseFloat(r.batch_size) || 0;
    const costPerUnit = (batchSize > 0 && totalCost > 0) ? totalCost / batchSize : null;
    statsHtml =
      '<div class="card-stat">' +
        '<span class="card-stat-label">Batch cost</span>' +
        '<span class="card-stat-value">' + (totalCost > 0 ? '\u00a3' + totalCost.toFixed(2) : '\u2014') + '</span>' +
      '</div>' +
      '<div class="card-stat">' +
        '<span class="card-stat-label">Per ' + esc(r.batch_unit || 'unit') + '</span>' +
        '<span class="card-stat-value">' + (costPerUnit ? '\u00a3' + costPerUnit.toFixed(4) : '\u2014') + '</span>' +
      '</div>';
  }

  return '<div class="recipe-card" onclick="openRecipe(' + r.id + ')">' +
    '<div class="card-top">' +
      '<div class="card-name">' + esc(r.name) + '</div>' +
      '<div class="type-badge ' + r.type + '">' + r.type.toUpperCase() + '</div>' +
    '</div>' +
    '<div class="card-stats">' + statsHtml + '</div>' +
    '<div class="card-count">' + countText + '</div>' +
  '</div>';
}

// ── Cost calculation ──────────────────────────────────────
function lookupUnitCost(productCode, productName) {
  if (productCode) {
    const p = products.find(x => x.code && x.code === productCode);
    if (p && p.unitcost) return parseFloat(p.unitcost) || 0;
  }
  if (productName) {
    const p = products.find(x => x.product === productName);
    if (p && p.unitcost) return parseFloat(p.unitcost) || 0;
  }
  return 0;
}

function getPrepCostPerUnit(prepId, allRecs) {
  if (!prepId) return 0;
  const prep = (allRecs || allRecipes).find(r => r.id === prepId);
  if (!prep || !(prep.items || []).length) return 0;
  const batchCost = calcRecipeCost(prep, allRecs || allRecipes, 1);
  const batchSize = parseFloat(prep.batch_size) || 1;
  return batchCost / batchSize;
}

function calcRecipeCost(recipe, allRecs, depth) {
  depth = depth || 0;
  if (!recipe || !(recipe.items || []).length || depth > 2) return 0;
  let total = 0;
  for (const item of recipe.items) {
    const qty = parseFloat(item.quantity) || 0;
    if (item.item_type === 'product') {
      total += qty * lookupUnitCost(item.product_code, item.product_name);
    } else if (item.item_type === 'prep' && item.sub_recipe_id) {
      total += qty * getPrepCostPerUnit(item.sub_recipe_id, allRecs);
    }
  }
  return total;
}

// ── Recipe editor — open ──────────────────────────────────
function openNewRecipe() {
  editorMode   = 'new';
  editorRecipe = {
    id: null, name: '', type: 'dish',
    batch_size: null, batch_unit: '',
    gp_target: 70, notes: '', items: []
  };
  showEditor();
}

async function openRecipe(id) {
  try {
    const recipe = await apiGet('/recipes/' + id);
    editorMode   = 'edit';
    editorRecipe = recipe;
    showEditor();
  } catch (e) {
    showToast('Could not load recipe: ' + e.message);
  }
}

function showEditor() {
  document.getElementById('recipe-list-view').classList.add('hidden');
  document.getElementById('recipe-editor-view').classList.remove('hidden');

  document.getElementById('recipe-name-input').value = editorRecipe.name  || '';
  document.getElementById('gp-target-input').value   = editorRecipe.gp_target != null ? editorRecipe.gp_target : 70;
  document.getElementById('batch-size-input').value  = editorRecipe.batch_size || '';
  document.getElementById('batch-unit-input').value  = editorRecipe.batch_unit || '';
  document.getElementById('recipe-notes').value      = editorRecipe.notes || '';

  setRecipeType(editorRecipe.type || 'dish', false);

  const delBtn = document.getElementById('editor-delete-btn');
  delBtn.style.visibility = editorMode === 'edit' ? 'visible' : 'hidden';

  document.getElementById('editor-title').textContent =
    editorMode === 'new' ? 'New Recipe' : (editorRecipe.name || 'Recipe');

  document.getElementById('ingredient-search').value = '';
  const res = document.getElementById('ingredient-results');
  res.innerHTML = '';
  res.classList.add('hidden');
  ingSearchResults = [];

  renderIngredientList();
  recalcTotals();
}

function closeEditor() {
  document.getElementById('recipe-editor-view').classList.add('hidden');
  document.getElementById('recipe-list-view').classList.remove('hidden');
  editorRecipe      = null;
  pendingIngredient = null;
  ingSearchResults  = [];
}

// ── Recipe type toggle ────────────────────────────────────
function setRecipeType(type, updateState) {
  if (updateState !== false && editorRecipe) editorRecipe.type = type;
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });
  document.getElementById('dish-fields').classList.toggle('hidden', type !== 'dish');
  document.getElementById('prep-fields').classList.toggle('hidden', type !== 'prep');
  recalcTotals();
}

function onEditorNameChange() {
  const name = document.getElementById('recipe-name-input').value;
  if (editorMode === 'edit' && name) {
    document.getElementById('editor-title').textContent = name;
  }
}

// ── Ingredient list render ────────────────────────────────
function renderIngredientList() {
  const listEl = document.getElementById('ingredient-list');
  const items  = editorRecipe ? editorRecipe.items || [] : [];

  if (!items.length) {
    listEl.innerHTML = '<div class="ing-empty">No ingredients added yet</div>';
    return;
  }

  listEl.innerHTML = items.map(function(item, idx) {
    const unitCost  = item.item_type === 'product'
      ? lookupUnitCost(item.product_code, item.product_name)
      : getPrepCostPerUnit(item.sub_recipe_id, allRecipes);
    const qty       = parseFloat(item.quantity) || 0;
    const lineCost  = qty * unitCost;
    const prepBadge = item.item_type === 'prep'
      ? '<span class="ing-prep-badge">PREP</span>' : '';
    const costStr   = lineCost > 0 ? '\u00a3' + lineCost.toFixed(4) : '\u2014';
    const ucStr     = unitCost > 0 ? ' \u00b7 \u00a3' + unitCost.toFixed(4) + '/unit' : '';

    return '<div class="ingredient-row">' +
      '<div class="ing-info">' +
        '<div class="ing-name">' + esc(item.product_name || '') + prepBadge + '</div>' +
        '<div class="ing-meta">' + esc(item.unit_measure || '') + ucStr + '</div>' +
      '</div>' +
      '<div class="ing-qty-wrap">' +
        '<input class="ing-qty" type="number" value="' + (qty || '') + '" ' +
          'min="0" step="0.001" placeholder="0" ' +
          'onchange="updateIngQty(' + idx + ', parseFloat(this.value) || 0)" ' +
          'onclick="event.stopPropagation()">' +
        '<span class="ing-unit-label">' + esc(item.unit_measure || '') + '</span>' +
      '</div>' +
      '<div class="ing-cost">' + costStr + '</div>' +
      '<button class="ing-remove" onclick="removeIngredient(' + idx + ')" title="Remove">\u00d7</button>' +
    '</div>';
  }).join('');
}

// ── Totals ────────────────────────────────────────────────
function recalcTotals() {
  if (!editorRecipe) return;

  const items = editorRecipe.items || [];
  let totalCost = 0;
  for (const item of items) {
    const qty      = parseFloat(item.quantity) || 0;
    const unitCost = item.item_type === 'product'
      ? lookupUnitCost(item.product_code, item.product_name)
      : getPrepCostPerUnit(item.sub_recipe_id, allRecipes);
    totalCost += qty * unitCost;
  }

  const section  = document.getElementById('recipe-totals-section');
  const totalsEl = document.getElementById('recipe-totals');

  if (!items.length) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  const type = editorRecipe.type || 'dish';
  let html = '<div class="totals-row">' +
    '<span class="totals-label">Total ingredient cost</span>' +
    '<span class="totals-value">\u00a3' + totalCost.toFixed(2) + '</span>' +
  '</div>';

  if (type === 'dish') {
    const gpEl = document.getElementById('gp-target-input');
    const gp   = parseFloat(gpEl ? gpEl.value : 70) || 70;
    if (totalCost > 0) {
      const sellPrice = totalCost / (1 - gp / 100);
      const gpCash    = sellPrice - totalCost;
      html += '<div class="totals-row">' +
        '<span class="totals-label">Sell price @ ' + gp + '% GP</span>' +
        '<span class="totals-value highlight">\u00a3' + sellPrice.toFixed(2) + '</span>' +
      '</div>' +
      '<div class="totals-row">' +
        '<span class="totals-label">GP cash</span>' +
        '<span class="totals-value">\u00a3' + gpCash.toFixed(2) + '</span>' +
      '</div>';
    }
  } else {
    const bsEl      = document.getElementById('batch-size-input');
    const buEl      = document.getElementById('batch-unit-input');
    const batchSize = parseFloat(bsEl ? bsEl.value : 0) || 0;
    const batchUnit = (buEl ? buEl.value : '') || 'unit';
    if (batchSize > 0 && totalCost > 0) {
      html += '<div class="totals-row">' +
        '<span class="totals-label">Cost per ' + esc(batchUnit) + '</span>' +
        '<span class="totals-value highlight">\u00a3' + (totalCost / batchSize).toFixed(4) + '</span>' +
      '</div>';
    }
  }

  totalsEl.innerHTML = html;
}

// ── Ingredient qty update ─────────────────────────────────
function updateIngQty(idx, qty) {
  const item = editorRecipe && editorRecipe.items ? editorRecipe.items[idx] : null;
  if (!item) return;
  item.quantity = qty;
  renderIngredientList();
  recalcTotals();

  if (editorMode === 'edit' && item.id) {
    clearTimeout(ingQtyTimers[item.id]);
    const recipeId = editorRecipe.id;
    const itemId   = item.id;
    const sortOrd  = item.sort_order || 0;
    ingQtyTimers[itemId] = setTimeout(async function() {
      try {
        await apiPut('/recipes/' + recipeId + '/items/' + itemId, { quantity: qty, sort_order: sortOrd });
      } catch (e) {
        showToast('Could not save quantity');
      }
    }, 600);
  }
}

// ── Ingredient remove ─────────────────────────────────────
async function removeIngredient(idx) {
  if (!editorRecipe || !editorRecipe.items) return;
  const item = editorRecipe.items[idx];
  if (!item) return;

  if (editorMode === 'edit' && item.id) {
    try {
      await apiDelete('/recipes/' + editorRecipe.id + '/items/' + item.id);
    } catch (e) {
      showToast('Could not remove: ' + e.message);
      return;
    }
  }

  editorRecipe.items.splice(idx, 1);
  renderIngredientList();
  recalcTotals();
}

// ── Ingredient search ─────────────────────────────────────
function onIngredientSearch(query) {
  const resultsEl = document.getElementById('ingredient-results');

  if (!query.trim()) {
    resultsEl.innerHTML = '';
    resultsEl.classList.add('hidden');
    ingSearchResults = [];
    return;
  }

  const q = query.toLowerCase();

  const productHits = products
    .filter(p =>
      (p.product  || '').toLowerCase().includes(q) ||
      (p.code     || '').toLowerCase().includes(q) ||
      (p.supplier || '').toLowerCase().includes(q)
    )
    .slice(0, 6)
    .map(p => ({
      type:     'product',
      name:     p.product  || '',
      unit:     p.measure  || '',
      code:     p.code     || null,
      unitCost: parseFloat(p.unitcost) || 0,
      supplier: p.supplier || '',
    }));

  const showPreps = editorRecipe && editorRecipe.type === 'dish';
  const prepHits  = showPreps
    ? allRecipes
        .filter(r =>
          r.type === 'prep' &&
          r.id !== (editorRecipe ? editorRecipe.id : null) &&
          (r.name || '').toLowerCase().includes(q)
        )
        .slice(0, 3)
        .map(r => ({
          type:     'prep',
          name:     r.name || '',
          unit:     r.batch_unit || 'unit',
          recipeId: r.id,
          unitCost: getPrepCostPerUnit(r.id, allRecipes),
        }))
    : [];

  ingSearchResults = productHits.concat(prepHits);

  if (!ingSearchResults.length) {
    resultsEl.innerHTML = '<div class="ing-no-results">No results found</div>';
    resultsEl.classList.remove('hidden');
    return;
  }

  let html = '';

  if (productHits.length) {
    html += '<div class="ing-result-section-label">Products</div>';
    productHits.forEach(function(r, i) {
      const sub = (r.supplier && r.unit) ? r.supplier + ' \u00b7 ' + r.unit
                : (r.supplier || r.unit || '');
      html += '<div class="ing-result" onclick="selectIngredient(' + i + ')">' +
        '<div class="ing-result-left">' +
          '<div class="ing-result-name">' + esc(r.name) + '</div>' +
          '<div class="ing-result-sub">' + esc(sub) + '</div>' +
        '</div>' +
        '<div class="ing-result-right">' +
          '<span class="ing-result-cost">' + (r.unitCost > 0 ? '\u00a3' + r.unitCost.toFixed(4) : '') + '</span>' +
        '</div>' +
      '</div>';
    });
  }

  if (prepHits.length) {
    html += '<div class="ing-result-section-label">Prep Recipes</div>';
    prepHits.forEach(function(r, i) {
      const idx = productHits.length + i;
      html += '<div class="ing-result" onclick="selectIngredient(' + idx + ')">' +
        '<div class="ing-result-left">' +
          '<div class="ing-result-name">' + esc(r.name) + '</div>' +
          '<div class="ing-result-sub">per ' + esc(r.unit) + '</div>' +
        '</div>' +
        '<div class="ing-result-right">' +
          '<span class="prep-badge">PREP</span>' +
          '<span class="ing-result-cost">' + (r.unitCost > 0 ? '\u00a3' + r.unitCost.toFixed(4) : '') + '</span>' +
        '</div>' +
      '</div>';
    });
  }

  resultsEl.innerHTML = html;
  resultsEl.classList.remove('hidden');
}

// ── Qty modal ─────────────────────────────────────────────
function selectIngredient(idx) {
  const result = ingSearchResults[idx];
  if (!result) return;
  pendingIngredient = result;

  document.getElementById('qty-modal-name').textContent = result.name;
  document.getElementById('qty-modal-meta').textContent =
    result.unitCost > 0
      ? '\u00a3' + result.unitCost.toFixed(4) + ' per ' + result.unit
      : result.unit || '';
  document.getElementById('qty-unit').textContent = result.unit || '';
  document.getElementById('qty-input').value = '';

  document.getElementById('qty-modal').classList.remove('hidden');
  setTimeout(function() {
    const inp = document.getElementById('qty-input');
    if (inp) inp.focus();
  }, 80);
}

function cancelQty() {
  document.getElementById('qty-modal').classList.add('hidden');
  pendingIngredient = null;
}

async function confirmQty() {
  const qty = parseFloat(document.getElementById('qty-input').value);
  if (!qty || qty <= 0 || !pendingIngredient) {
    const inp = document.getElementById('qty-input');
    if (inp) inp.focus();
    return;
  }

  document.getElementById('qty-modal').classList.add('hidden');

  const sortOrder = (editorRecipe && editorRecipe.items ? editorRecipe.items.length : 0);
  const itemBody  = {
    item_type:     pendingIngredient.type,
    product_name:  pendingIngredient.name,
    unit_measure:  pendingIngredient.unit,
    quantity:      qty,
    sort_order:    sortOrder,
    product_code:  pendingIngredient.type === 'product' ? (pendingIngredient.code || null) : null,
    sub_recipe_id: pendingIngredient.type === 'prep'    ? pendingIngredient.recipeId : null,
  };

  if (editorMode === 'edit' && editorRecipe && editorRecipe.id) {
    try {
      const created = await apiPost('/recipes/' + editorRecipe.id + '/items', itemBody);
      editorRecipe.items = (editorRecipe.items || []).concat([created]);
    } catch (e) {
      showToast('Could not add ingredient: ' + e.message);
      pendingIngredient = null;
      return;
    }
  } else {
    if (!editorRecipe.items) editorRecipe.items = [];
    editorRecipe.items.push(Object.assign({}, itemBody, { id: null }));
  }

  pendingIngredient = null;
  document.getElementById('ingredient-search').value = '';
  document.getElementById('ingredient-results').classList.add('hidden');
  ingSearchResults = [];

  renderIngredientList();
  recalcTotals();
}

// ── Save recipe ───────────────────────────────────────────
async function saveRecipe() {
  const name = (document.getElementById('recipe-name-input').value || '').trim();
  if (!name) {
    showToast('Please enter a recipe name');
    document.getElementById('recipe-name-input').focus();
    return;
  }

  const type   = editorRecipe.type || 'dish';
  const gpEl   = document.getElementById('gp-target-input');
  const bsEl   = document.getElementById('batch-size-input');
  const buEl   = document.getElementById('batch-unit-input');
  const notEl  = document.getElementById('recipe-notes');
  const gpVal  = parseFloat(gpEl ? gpEl.value : 70);
  const bsVal  = parseFloat(bsEl ? bsEl.value : '');
  const buVal  = ((buEl ? buEl.value : '') || '').trim();
  const notes  = ((notEl ? notEl.value : '') || '').trim();

  const body = {
    name,
    type,
    gp_target:  type === 'dish' ? (isNaN(gpVal) ? 70 : gpVal) : null,
    batch_size: type === 'prep' ? (isNaN(bsVal) ? null : bsVal) : null,
    batch_unit: type === 'prep' ? (buVal || null) : null,
    notes:      notes || null,
  };

  const saveBtn = document.getElementById('save-btn');
  saveBtn.disabled    = true;
  saveBtn.textContent = 'Saving\u2026';

  try {
    if (editorMode === 'new') {
      const created  = await apiPost('/recipes', body);
      const recipeId = created.id;

      for (const item of (editorRecipe.items || [])) {
        await apiPost('/recipes/' + recipeId + '/items', {
          item_type:     item.item_type,
          product_name:  item.product_name,
          unit_measure:  item.unit_measure,
          quantity:      item.quantity,
          sort_order:    item.sort_order || 0,
          product_code:  item.product_code  || null,
          sub_recipe_id: item.sub_recipe_id || null,
        });
      }

      const fullRecipe = await apiGet('/recipes/' + recipeId);
      editorMode   = 'edit';
      editorRecipe = fullRecipe;
      allRecipes   = [fullRecipe].concat(allRecipes);

      document.getElementById('editor-delete-btn').style.visibility = 'visible';
      document.getElementById('editor-title').textContent = fullRecipe.name;
      renderIngredientList();
      recalcTotals();
      showToast('Recipe created!');

    } else {
      await apiPut('/recipes/' + editorRecipe.id, body);
      const fullRecipe = await apiGet('/recipes/' + editorRecipe.id);
      editorRecipe     = fullRecipe;
      allRecipes       = allRecipes.map(function(r) {
        return r.id === fullRecipe.id ? fullRecipe : r;
      });
      document.getElementById('editor-title').textContent = fullRecipe.name;
      renderIngredientList();
      recalcTotals();
      showToast('Recipe saved!');
    }

  } catch (e) {
    showToast('Save failed: ' + e.message);
  } finally {
    saveBtn.disabled    = false;
    saveBtn.textContent = 'Save Recipe';
  }
}

// ── Delete recipe ─────────────────────────────────────────
async function confirmDeleteRecipe() {
  if (!editorRecipe || !editorRecipe.id) return;
  if (!confirm('Delete "' + editorRecipe.name + '"?\n\nThis cannot be undone.')) return;

  try {
    await apiDelete('/recipes/' + editorRecipe.id);
    allRecipes = allRecipes.filter(function(r) { return r.id !== editorRecipe.id; });
    showToast('Recipe deleted');
    closeEditor();
    renderRecipeList();
  } catch (e) {
    showToast('Delete failed: ' + e.message);
  }
}
