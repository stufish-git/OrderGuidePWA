// ── Config ────────────────────────────────────────────────
const VERSION = 'v1.4';

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQZ12Nc-aBIdhgsZ2LVvLYz0PytxUhIyoa10ESs7EcOQ_nxIZv3cP1-92Q1mapu5wbBvf6fASMM8ifS/pub?gid=1704018109&single=true&output=csv';

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

// ── State ─────────────────────────────────────────────────
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

// ── Boot ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('version-badge').textContent = VERSION;
  loadData();
});

document.addEventListener('click', e => {
  if (!e.target.closest('.filter-wrap')) closeAll();
});

// ── Data loading ──────────────────────────────────────────
async function loadData() {
  try {
    const r = await fetch(CSV_URL + '&t=' + Date.now());
    if (!r.ok) throw new Error('HTTP ' + r.status);
    products = parseCSV(await r.text());
    if (!products.length) throw new Error('Sheet appears empty');
    buildOpts();
    renderSortRows();
    render();
    const t = new Date();
    document.getElementById('sync-label').textContent =
      t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('sync-pip').className = 'sync-pip ok';
    setError(null);
  } catch (e) {
    setError('Could not load data: ' + e.message);
    document.getElementById('sync-pip').className = 'sync-pip error';
    document.getElementById('sync-label').textContent = 'Error';
    document.getElementById('results-bar').textContent = '';
  } finally {
    document.getElementById('loading').classList.add('hidden');
  }
}

async function refreshData() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.classList.add('spinning');
  await loadData();
  btn.disabled = false;
  btn.classList.remove('spinning');
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

// ── Filter options ────────────────────────────────────────
function buildOpts() {
  ['supplier', 'category', 'subcategory'].forEach(k => {
    opts[k] = [...new Set(products.map(p => p[k]).filter(Boolean))].sort();
    renderDDItems(k);
  });
}

function renderDDItems(k) {
  document.getElementById('dl-' + k).innerHTML = opts[k].map(v => `
    <div class="dd-item" onclick="onCheck('${k}','${esc(v)}',!this.querySelector('input').checked);this.querySelector('input').checked=!this.querySelector('input').checked">
      <input type="checkbox" onclick="event.stopPropagation();onCheck('${k}','${esc(v)}',this.checked)"
        ${filters[k].has(v) ? 'checked' : ''}>
      <span>${esc(v)}</span>
    </div>`).join('');
}

function ddSearch(ddId, q) {
  document.querySelectorAll('#' + ddId + ' .dd-item').forEach(el => {
    el.style.display = el.querySelector('label').textContent
      .toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
  });
}

// ── Filter interactions ───────────────────────────────────
function setArea(a) {
  filters.area = a;
  document.querySelectorAll('.seg-btn')
    .forEach(b => b.classList.toggle('active', b.dataset.area === a));
  render();
}

function onSearch(v) {
  filters.search = v;
  render();
}

function onCheck(k, v, checked) {
  checked ? filters[k].add(v) : filters[k].delete(v);
  updatePill(k);
  render();
}

function selAll(k) {
  filters[k] = new Set();
  renderDDItems(k);
  updatePill(k);
  render();
}

function removeTag(k, v) {
  filters[k].delete(v);
  renderDDItems(k);
  updatePill(k);
  render();
}

function updatePill(k) {
  const badge = document.getElementById('fb-' + k);
  const pill  = document.getElementById('fp-' + k);
  const n     = filters[k].size;
  if (n === 0 || filters[k].has('__none__')) {
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
  ['supplier', 'category', 'subcategory'].forEach(k => {
    filters[k] = new Set();
    renderDDItems(k);
    updatePill(k);
  });
  render();
}

function clearSearch() {
  filters.search = '';
  document.getElementById('search-input').value = '';
  render();
}

// ── Sort ──────────────────────────────────────────────────
function renderSortRows() {
  document.getElementById('sort-rows').innerHTML = sorts.map((s, i) => `
    <div class="sort-row">
      <select onchange="sorts[${i}].field=this.value;render()">
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

  // Area filter
  if (filters.area !== 'all')
    list = list.filter(p => (p.area || '').toLowerCase() === filters.area);

  // Multi-select filters — empty Set means no filter active
  ['supplier', 'category', 'subcategory'].forEach(k => {
    if (filters[k].size > 0) list = list.filter(p => filters[k].has(p[k]));
  });

  // Search
  const q = filters.search.trim().toLowerCase();
  if (q) list = list.filter(p =>
    (p.product     || '').toLowerCase().includes(q) ||
    (p.supplier    || '').toLowerCase().includes(q) ||
    (p.code        || '').toLowerCase().includes(q) ||
    (p.category    || '').toLowerCase().includes(q) ||
    (p.subcategory || '').toLowerCase().includes(q)
  );

  // Sort
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

  renderTable(list, q);
  renderTags();

  document.getElementById('results-bar').innerHTML =
    `<strong>${list.length.toLocaleString()}</strong> of ${products.length.toLocaleString()} products`;

  // Print meta
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

function renderTable(list, q) {
  const tbody = document.getElementById('tbody');
  const empty = document.getElementById('empty');
  if (!list.length) {
    tbody.innerHTML = '';
    empty.classList.add('show');
    return;
  }
  empty.classList.remove('show');
  tbody.innerHTML = list.map(p => `
    <tr>
      <td class="col-supplier">${hi(p.supplier  || '', q)}</td>
      <td class="col-product"> ${hi(p.product   || '', q)}</td>
      <td class="col-code">    ${hi(p.code      || '', q)}</td>
      <td class="col-price">   ${fmt(p.price,   2)}</td>
      <td class="col-pack">    ${esc(p.pack     || '')}</td>
      <td class="col-measure"> ${esc(p.measure  || '')}</td>
      <td class="col-unitcost">${fmt(p.unitcost, 4)}</td>
      <td class="col-date">    ${esc(p.lastupdate || '')}</td>
    </tr>`).join('');
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

function hi(s, q) {
  if (!q) return esc(s);
  const re = new RegExp(
    '(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'
  );
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
}
