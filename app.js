// ── Config ────────────────────────────────────────────────
const VERSION = 'v2.5';

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

// Auto-refresh when app comes back to foreground
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
// Each dropdown only shows values valid given upstream selections.
// Changing a level auto-clears everything downstream.

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
  // Remove any selections no longer valid
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

// Parse search string into an array of term objects
// Each term: { text, exact } where exact=true means whole-word match
function parseSearchTerms(raw) {
  const terms = [];
  // Pull out quoted phrases first
  const quotedRe = /"([^"]+)"/g;
  let match;
  let remainder = raw;
  while ((match = quotedRe.exec(raw)) !== null) {
    terms.push({ text: match[1].toLowerCase(), exact: true });
    remainder = remainder.replace(match[0], ' ');
  }
  // Remaining unquoted words
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
      // Whole word boundary match
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
    // Same column — just toggle direction
    sorts[0].dir = sorts[0].dir === 'asc' ? 'desc' : 'asc';
  } else {
    // New column — replace entirely with single sort level
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

  // Area filter
  if (filters.area !== 'all')
    list = list.filter(p => (p.area || '').toLowerCase() === filters.area);

  // Multi-select filters — empty Set means no filter active
  ['supplier', 'category', 'subcategory'].forEach(k => {
    if (filters[k].size > 0) list = list.filter(p => filters[k].has(p[k]));
  });

  // Search
  const rawSearch = filters.search.trim();
  const searchTerms = rawSearch ? parseSearchTerms(rawSearch) : [];
  if (searchTerms.length) list = list.filter(p => matchesSearch(p, searchTerms));

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

  renderTable(list, searchTerms);
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
    const price = fmt(p.price, 2);
    const copyData = `copyRow('${esc(p.product)}','${esc(p.code)}','${price}')`;
    return `
    <tr onclick="${copyData}" title="Tap to copy">
      <td class="col-product col-sticky"> ${hiTerms(p.product   || '', terms)}</td>
      <td class="col-supplier">           ${hiTerms(p.supplier  || '', terms)}</td>
      <td class="col-code">               ${hiTerms(p.code      || '', terms)}</td>
      <td class="col-category">           ${hiTerms(p.category  || '', terms)}</td>
      <td class="col-price">              ${price}</td>
      <td class="col-pack">               ${esc(p.pack     || '')}</td>
      <td class="col-measure">            ${esc(p.measure  || '')}</td>
      <td class="col-unitcost">           ${fmt(p.unitcost, 4)}</td>
      <td class="col-date">               ${esc(p.lastupdate || '')}</td>
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

// Keep hi() for any legacy use
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

// ── Stale data warning ────────────────────────────────────
// Reads the lastupdate field from the first product to gauge
// how fresh the data is. Warns if older than 48 hours.
function checkStaleData() {
  if (!products.length) return;

  // Find the most recent lastupdate date across all products
  let latest = null;
  products.forEach(p => {
    if (!p.lastupdate) return;
    // Parse dd/MM/yyyy
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
}

// ── Copy on tap ───────────────────────────────────────────
let copyToast = null;

function copyRow(product, code, price) {
  const text = [product, code, price].filter(Boolean).join(' — ');
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied: ' + text);
  }).catch(() => {
    showToast('Could not copy — try long press');
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
  // Close if clicking backdrop or close button
  if (!e || e.target === document.getElementById('search-modal')) {
    document.getElementById('search-modal').classList.remove('open');
  }
}
