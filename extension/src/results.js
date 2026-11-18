/* Menswear Index — scan results (extension page).
 *
 * Shows the listings the content script collected across several Vinted result pages
 * (storage key mi-agg), live while the scan runs. Four views:
 *   Listings  every listing, filtered and sorted
 *   Brands    one row per brand: score, listings here, price spread, steals
 *   Steals    listings priced well below their brand's median price in this scan
 *   Saved     listings starred here, kept across scans
 * Hidden brands and saved listings are kept in storage (mi-muted, mi-saved).
 */
const api = globalThis.browser ?? globalThis.chrome;
const AGG_KEY = 'mi-agg';
const DATA_KEY = 'mi-data';
const SETTINGS_KEY = 'mi-settings';
const SAVED_KEY = 'mi-saved';
const MUTED_KEY = 'mi-muted';
const DEFAULT_SITE = 'https://menswear-index.pages.dev';

// a steal: at least STEAL_BELOW % under the brand's median price, among STEAL_MIN_LISTINGS+ priced listings of it here
const STEAL_MIN_LISTINGS = 4;
const STEAL_BELOW = 35;
const FILTER_OFF = 40; // the score slider's lowest stop means no minimum
const PAGE = 120; // listings drawn at a time

const BANDS = [
  [80, '#173c70', '#fff'],
  [75, '#3963a1', '#fff'],
  [70, '#b5cde7', '#161514'],
  [65, '#dcd9d3', '#161514'],
  [60, '#e7c0bc', '#161514'],
  [55, '#a74541', '#fff'],
  [0, '#722426', '#fff'],
];
const TIERS = [
  ['atelier', 'Atelier', '$$$$$'],
  ['luxury', 'Luxury', '$$$$'],
  ['premium', 'Premium', '$$$'],
  ['accessible', 'Accessible', '$$'],
  ['mainstream', 'Mainstream', '$'],
];
const TIER_SYMBOL = Object.fromEntries(TIERS.map(([id, , s]) => [id, s]));
const MODES = [
  ['listings', 'Listings'],
  ['brands', 'Brands'],
  ['steals', 'Steals'],
  ['saved', 'Saved'],
];
const SORTS = {
  items: [
    ['score', 'Score, high to low'],
    ['below', 'Furthest below brand median'],
    ['price-asc', 'Price, low to high'],
    ['price-desc', 'Price, high to low'],
    ['favourites', 'Most favourited'],
    ['order', 'Page order'],
  ],
  brands: [
    ['score', 'Score, high to low'],
    ['count', 'Most listings'],
    ['median', 'Median price, low to high'],
    ['steals', 'Most steals'],
  ],
};

const $ = (id) => document.getElementById(id);
const plural = (n, w) => `${n.toLocaleString('en-GB')} ${w}${n === 1 ? '' : 's'}`;
const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`.]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const median = (sorted) => (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** A small element builder: h('div', { class: 'x', onclick }, child, 'text', …). Text is always set as text. */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

let agg = null;
let items = []; // agg.items, enriched
let brands = new Map(); // index id -> brand
let saved = {}; // listing id -> listing snapshot
let muted = {}; // brand key -> display name
let siteUrl = DEFAULT_SITE;
const blank = () => ({ min: 0, priceMin: '', priceMax: '', q: '', rated: false, multi: false, tiers: new Set(), sizes: new Set(), conditions: new Set(), brand: null });
let f = blank();
let mode = 'listings';
let sort = { items: 'score', brands: 'score' };
let limit = PAGE;

function buildBrands(data) {
  brands = new Map();
  if (!data?.brands) return;
  const dims = data.dimensions;
  for (const [id, name, , composite, rank, tier, buyAt, scores, category, provisional] of data.brands)
    brands.set(id, { id, name, composite, rank, tier, buyAt, scores: Object.fromEntries(dims.map((d, i) => [d, scores[i]])), category, provisional: !!provisional });
}

const keyOf = (it) => (it.brandId ? `id:${it.brandId}` : `raw:${fold(it.brandName) || '(no brand)'}`);

/** Attaches brand, score and how far each listing sits below its brand's median price in this scan. */
function enrich(list) {
  const byKey = new Map();
  for (const it of list) {
    it.brand = it.brandId ? brands.get(it.brandId) || null : null;
    it.score = it.brand?.composite ?? null;
    it.key = keyOf(it);
    it.label = it.brand?.name || it.brandName || 'No brand';
    if (!byKey.has(it.key)) byKey.set(it.key, []);
    byKey.get(it.key).push(it);
  }
  for (const group of byKey.values()) {
    const prices = group.map((i) => i.price).filter((p) => p > 0).sort((a, b) => a - b);
    const med = prices.length >= STEAL_MIN_LISTINGS ? median(prices) : null;
    for (const it of group) {
      it.groupSize = group.length;
      it.median = med;
      it.below = med && it.price > 0 ? Math.round((1 - it.price / med) * 100) : null;
    }
  }
  return list;
}

/* ------------------------------------------------------------------ */
/* Filtering and sorting                                               */
/* ------------------------------------------------------------------ */

function passes(it, { ignoreBrand = false } = {}) {
  if (muted[it.key]) return false;
  if (f.min > 0 && !(it.score >= f.min)) return false;
  if (f.rated && !it.brand) return false;
  if (f.multi && it.groupSize < 3) return false;
  const lo = parseFloat(f.priceMin);
  const hi = parseFloat(f.priceMax);
  if (Number.isFinite(lo) && !(it.price >= lo)) return false;
  if (Number.isFinite(hi) && !(it.price <= hi)) return false;
  if (f.tiers.size && !(it.brand && f.tiers.has(it.brand.tier))) return false;
  if (f.sizes.size && !f.sizes.has(it.size)) return false;
  if (f.conditions.size && !f.conditions.has(it.condition)) return false;
  if (f.q) {
    const q = fold(f.q);
    if (!fold(`${it.title} ${it.label} ${it.brandName}`).includes(q)) return false;
  }
  if (!ignoreBrand && f.brand && it.key !== f.brand.key) return false;
  return true;
}

const isSteal = (it) => it.below != null && it.below >= STEAL_BELOW;
const nullsLast = (a, b, fn) => (a == null) - (b == null) || (a == null ? 0 : fn(a, b));

function sortItems(list, by) {
  const cmp = {
    score: (a, b) => nullsLast(a.score, b.score, (x, y) => y - x) || (a.price || 1e9) - (b.price || 1e9),
    below: (a, b) => nullsLast(a.below, b.below, (x, y) => y - x) || nullsLast(a.score, b.score, (x, y) => y - x),
    'price-asc': (a, b) => (a.price || 1e9) - (b.price || 1e9),
    'price-desc': (a, b) => (b.price || 0) - (a.price || 0),
    favourites: (a, b) => nullsLast(a.favourites, b.favourites, (x, y) => y - x),
    order: (a, b) => (a.savedAt && b.savedAt ? b.savedAt - a.savedAt : a.order - b.order),
  }[by];
  return list.slice().sort(cmp);
}

function brandRows(list) {
  const rows = new Map();
  for (const it of list) {
    let r = rows.get(it.key);
    if (!r) rows.set(it.key, (r = { key: it.key, label: it.label, brand: it.brand, items: [], steals: 0 }));
    r.items.push(it);
    if (isSteal(it)) r.steals++;
  }
  for (const r of rows.values()) {
    const prices = r.items.map((i) => i.price).filter((p) => p > 0).sort((a, b) => a - b);
    r.count = r.items.length;
    r.min = prices[0] ?? null;
    r.median = prices.length ? median(prices) : null;
    r.score = r.brand?.composite ?? null;
  }
  const cmp = {
    score: (a, b) => nullsLast(a.score, b.score, (x, y) => y - x) || b.count - a.count,
    count: (a, b) => b.count - a.count || nullsLast(a.score, b.score, (x, y) => y - x),
    median: (a, b) => nullsLast(a.median, b.median, (x, y) => x - y),
    steals: (a, b) => b.steals - a.steals || nullsLast(a.score, b.score, (x, y) => y - x),
  }[sort.brands];
  return [...rows.values()].sort(cmp);
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function money(v, currency) {
  if (!(v > 0)) return '—';
  if (currency) {
    try {
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency, minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(v);
    } catch {
      /* unknown currency code */
    }
  }
  return v.toFixed(2);
}
const cur = () => agg?.items?.find((i) => i.currency)?.currency || '';

function scoreTile(score, title) {
  if (score == null) return h('span', { class: 'score none', title: 'Not in the index' }, '—');
  const [, bg, fg] = BANDS.find((b) => score >= b[0]);
  return h('span', { class: 'score', style: { background: bg, color: fg }, title }, score >= 100 ? '100' : score.toFixed(1));
}

function renderRun() {
  const box = $('run');
  if (!agg) {
    box.replaceChildren(h('div', { class: 'q' }, 'No scan yet'), h('div', { class: 's' }, 'Open a Vinted search, open the Menswear Index popup, and choose Scan.'));
    $('stop').hidden = true;
    return;
  }
  const live = agg.status === 'running' && Date.now() - agg.updatedAt < 90000;
  const of = agg.totalPages ? Math.min(agg.maxPages, agg.totalPages - agg.startPage + 1) : agg.maxPages;
  const how = agg.method === 'api' ? 'read in the background' : agg.method === 'pages' ? 'by clicking the page buttons' : '';
  const state = live
    ? `Scanning page ${Math.min(agg.pagesDone + 1, of)} of ${of}${how ? `, ${how}` : ''}…`
    : agg.status === 'stopped'
      ? `Stopped after ${plural(agg.pagesDone, 'page')}`
      : agg.status === 'running'
        ? `Interrupted after ${plural(agg.pagesDone, 'page')} (the Vinted tab was closed or left the search)`
        : `${plural(agg.pagesDone, 'page')} scanned${how ? `, ${how}` : ''}`;
  const rated = items.filter((i) => i.brand).length;
  const brandsSeen = new Set(items.filter((i) => i.brand).map((i) => i.key)).size;
  box.replaceChildren(
    ...[
    h('div', {}, h('a', { class: 'q', href: agg.startUrl, target: '_blank', rel: 'noopener', style: { color: 'inherit' } }, `“${agg.query}”`), h('span', { class: 's' }, ` on ${agg.site} · ${ago(agg.startedAt)}`)),
    h('div', { class: 's' }, `${state} · ${plural(items.length, 'listing')}, ${rated.toLocaleString('en-GB')} from ${plural(brandsSeen, 'brand')} in the index${agg.totalEntries ? ` · ${agg.totalEntries.toLocaleString('en-GB')} in the search` : ''}`),
    live ? h('div', { class: 'bar' }, h('i', { style: { width: `${Math.round((agg.pagesDone / of) * 100)}%` } })) : null,
    agg.error ? h('div', { class: 'err' }, agg.error) : null,
    ].filter(Boolean),
  );
  $('stop').hidden = !live;
}

function renderModes() {
  const savedCount = Object.keys(saved).length;
  const steals = items.filter((i) => passes(i) && isSteal(i)).length;
  $('modes').replaceChildren(
    ...MODES.map(([id, label]) => {
      const n = id === 'saved' ? savedCount : id === 'steals' ? steals : null;
      return h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(mode === id),
          onclick: () => {
            mode = id;
            limit = PAGE;
            if (id === 'steals' && sort.items === 'score') sort.items = 'below';
            if (id !== 'steals' && sort.items === 'below' && id !== 'saved') sort.items = 'score';
            render();
          },
        },
        n ? `${label} (${n})` : label,
      );
    }),
  );
}

function chipGroup(el, values, selected, labelOf = (v) => v) {
  el.replaceChildren(
    ...values.map(([v, n]) =>
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(selected.has(v)),
          onclick: () => {
            selected.has(v) ? selected.delete(v) : selected.add(v);
            limit = PAGE;
            render();
          },
        },
        labelOf(v),
        n != null ? h('span', { class: 'n' }, n) : null,
      ),
    ),
  );
  if (!values.length) el.replaceChildren(h('span', { class: 'hint', style: { marginTop: 0 } }, 'None yet'));
}

function counts(key) {
  const m = new Map();
  for (const it of items) if (it[key]) m.set(it[key], (m.get(it[key]) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function renderFilters() {
  $('min-value').textContent = f.min > 0 ? `${f.min}+` : 'Off';
  const tierCounts = new Map();
  for (const it of items) if (it.brand) tierCounts.set(it.brand.tier, (tierCounts.get(it.brand.tier) || 0) + 1);
  chipGroup(
    $('tiers'),
    TIERS.filter(([id]) => tierCounts.has(id)).map(([id]) => [id, tierCounts.get(id)]),
    f.tiers,
    (id) => TIERS.find((t) => t[0] === id)[1],
  );
  chipGroup($('sizes'), counts('size').slice(0, 30), f.sizes);
  chipGroup($('conditions'), counts('condition'), f.conditions);
  const mutedKeys = Object.keys(muted);
  $('muted-wrap').hidden = !mutedKeys.length;
  $('muted').replaceChildren(
    ...mutedKeys.map((k) =>
      h(
        'div',
        {},
        h('span', {}, muted[k]),
        h(
          'button',
          {
            class: 'link',
            type: 'button',
            onclick: async () => {
              delete muted[k];
              await api.storage.local.set({ [MUTED_KEY]: muted });
            },
          },
          'Show',
        ),
      ),
    ),
  );
  $('filters').style.opacity = mode === 'saved' ? '0.5' : '';
}

function renderSort() {
  const kind = mode === 'brands' ? 'brands' : 'items';
  const opts = SORTS[kind].map(([v, label]) => [v, mode === 'saved' && v === 'order' ? 'Recently saved' : label]);
  const sel = $('sort');
  sel.replaceChildren(...opts.map(([v, label]) => h('option', { value: v }, label)));
  sel.value = sort[kind];
  sel.onchange = () => {
    sort[kind] = sel.value;
    limit = PAGE;
    render();
  };
}

async function toggleSave(it) {
  if (saved[it.id]) delete saved[it.id];
  else {
    const { brand, score, key, label, groupSize, median: m, below, ...plain } = it;
    saved[it.id] = { ...plain, savedAt: Date.now(), savedMedian: m, savedBelow: below };
  }
  await api.storage.local.set({ [SAVED_KEY]: saved });
}

async function muteBrand(it) {
  muted[it.key] = it.label;
  await api.storage.local.set({ [MUTED_KEY]: muted });
}

function card(it) {
  const b = it.brand;
  const meta = [it.size, it.condition, it.favourites ? `♥ ${it.favourites}` : null].filter(Boolean).join(' · ');
  const steal = isSteal(it)
    ? h('div', { class: 'steal', title: it.groupSize ? `Median price of the ${it.groupSize} ${it.label} listings in this scan` : 'Median price in the scan it was saved from' }, `${it.below}% below ${it.label}'s median (${money(it.median, it.currency)})`)
    : null;
  const isSaved = !!saved[it.id];
  return h(
    'div',
    { class: 'card' },
    h(
      'a',
      { class: 'main', href: it.url, target: '_blank', rel: 'noopener' },
      h('div', { class: 'ph' }, it.photo ? h('img', { src: it.photo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null),
      h(
        'div',
        { class: 'body' },
        h('div', { class: 'top' }, scoreTile(it.score, b ? `Index score · rank #${b.rank.toLocaleString('en-GB')}` : ''), b ? h('span', { class: 'tier' }, TIER_SYMBOL[b.tier]) : null, h('span', { class: 'price' }, money(it.price, it.currency))),
        h('div', { class: 'bname' }, it.label),
        h('div', { class: 'title', title: it.title }, it.title || ' '),
        h('div', { class: 'meta' }, meta || ' '),
        steal,
      ),
    ),
    h(
      'div',
      { class: 'actions' },
      h('button', { type: 'button', class: isSaved ? 'saved' : '', 'aria-pressed': String(isSaved), onclick: () => toggleSave(it) }, isSaved ? '★ Saved' : '☆ Save'),
      mode !== 'saved' ? h('button', { type: 'button', title: `Hide every ${it.label} listing`, onclick: () => muteBrand(it) }, 'Hide brand') : null,
      b ? h('button', { type: 'button', title: 'Open the brand dossier', onclick: () => window.open(`${siteUrl}/#brand/${encodeURIComponent(b.id)}`, '_blank', 'noopener') }, 'Dossier') : null,
    ),
  );
}

function renderGrid(list) {
  const view = $('view');
  if (!list.length) {
    view.replaceChildren(h('div', { class: 'empty' }, mode === 'saved' ? 'Nothing saved yet. Use ☆ Save on a listing to keep it here.' : items.length ? 'No listings match these filters.' : 'No listings yet.'));
    return;
  }
  const shown = list.slice(0, limit);
  view.replaceChildren(
    h('div', { class: 'grid' }, shown.map(card)),
    list.length > shown.length
      ? h(
          'div',
          { class: 'more' },
          h(
            'button',
            {
              class: 'btn ghost',
              type: 'button',
              onclick: () => {
                limit += PAGE;
                render();
              },
            },
            `Show more (${(list.length - shown.length).toLocaleString('en-GB')} left)`,
          ),
        )
      : '',
  );
}

function renderBrands(rows) {
  const c = cur();
  if (!rows.length) {
    $('view').replaceChildren(h('div', { class: 'empty' }, items.length ? 'No brands match these filters.' : 'No listings yet.'));
    return;
  }
  $('view').replaceChildren(
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Score'), h('th', {}, 'Brand'), h('th', { class: 'hide-sm' }, 'Tier'), h('th', { class: 'num' }, 'Listings'), h('th', { class: 'num' }, 'From'), h('th', { class: 'num' }, 'Median'), h('th', { class: 'num' }, 'Steals'))),
      h(
        'tbody',
        {},
        rows.map((r) =>
          h(
            'tr',
            {
              tabindex: '0',
              title: `Show ${r.label} listings`,
              onclick: () => pickBrand(r),
              onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pickBrand(r)),
            },
            h('td', {}, scoreTile(r.score)),
            h('td', {}, h('b', {}, r.label), r.brand ? h('span', { class: 'tier' }, ` · #${r.brand.rank.toLocaleString('en-GB')}`) : h('span', { class: 'tier' }, ' · not in the index')),
            h('td', { class: 'hide-sm' }, r.brand ? TIERS.find((t) => t[0] === r.brand.tier)[1] : '—'),
            h('td', { class: 'num' }, r.count),
            h('td', { class: 'num' }, money(r.min, c)),
            h('td', { class: 'num' }, money(r.median, c)),
            h('td', { class: 'num' }, r.steals || ''),
          ),
        ),
      ),
    ),
  );
}

function pickBrand(r) {
  f.brand = { key: r.key, label: r.label };
  mode = 'listings';
  limit = PAGE;
  render();
  window.scrollTo({ top: 0 });
}

/** The listings the current view shows, in order (also what Export CSV writes). */
function currentList() {
  if (mode === 'saved') {
    // keep how each compared with its brand in the scan it was saved from
    const list = enrich(Object.values(saved).map((s) => ({ ...s }))).map((i) => Object.assign(i, { below: i.savedBelow ?? null, median: i.savedMedian ?? null, groupSize: null }));
    return sortItems(list, sort.items);
  }
  const list = items.filter((i) => passes(i) && (mode !== 'steals' || isSteal(i)));
  return sortItems(list, sort.items);
}

function render() {
  renderRun();
  renderModes();
  renderFilters();
  renderSort();
  const pill = $('brand-pill');
  pill.replaceChildren(
    f.brand && mode !== 'saved' && mode !== 'brands'
      ? h(
          'span',
          { class: 'pill' },
          f.brand.label,
          h(
            'button',
            {
              type: 'button',
              'aria-label': 'Show all brands',
              onclick: () => {
                f.brand = null;
                render();
              },
            },
            '×',
          ),
        )
      : '',
  );
  const explain = {
    listings: '',
    brands: 'Each brand in the scan, with its listings that match the filters. Click a brand to see its listings.',
    steals: `Listings priced at least ${STEAL_BELOW}% below the median price of the same brand in this scan (only brands with ${STEAL_MIN_LISTINGS}+ priced listings here). Resale listings have no RRP, so this compares like with like: the same brand, in the same search. Check the condition and the photos; a low price can also mean a different item type.`,
    saved: 'Listings you saved, kept across scans until you remove them. Filters don’t apply here.',
  }[mode];
  $('explain').textContent = explain;
  $('explain').hidden = !explain;
  if (mode === 'brands') {
    const rows = brandRows(items.filter((i) => passes(i, { ignoreBrand: true })));
    $('count').textContent = plural(rows.length, 'brand');
    renderBrands(rows);
    return;
  }
  const list = currentList();
  $('count').textContent = plural(list.length, 'listing');
  renderGrid(list);
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

function exportCsv() {
  const list = mode === 'brands' ? sortItems(items.filter((i) => passes(i, { ignoreBrand: true })), 'score') : currentList();
  const cols = [
    ['score', (i) => i.score ?? ''],
    ['brand', (i) => i.label],
    ['in_index', (i) => (i.brand ? 'yes' : 'no')],
    ['tier', (i) => i.brand?.tier ?? ''],
    ['rank', (i) => i.brand?.rank ?? ''],
    ['title', (i) => i.title],
    ['price', (i) => (i.price > 0 ? i.price : '')],
    ['currency', (i) => i.currency],
    ['size', (i) => i.size],
    ['condition', (i) => i.condition],
    ['pct_below_brand_median', (i) => i.below ?? ''],
    ['favourites', (i) => i.favourites ?? ''],
    ['url', (i) => i.url],
  ];
  const cell = (v) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.map((c) => c[0]).join(','), ...list.map((i) => cols.map(([, fn]) => cell(fn(i))).join(','))].join('\n');
  const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `menswear-index-${fold(agg?.query || 'scan').replace(/ /g, '-') || 'scan'}-${mode}.csv` });
  document.body.append(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

function takeAgg(a) {
  agg = a?.items ? a : null;
  items = agg ? enrich(agg.items.map((i) => ({ ...i }))) : [];
}

let renderTimer = 0;
const renderSoon = () => {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 300);
};

function bindFilters() {
  $('min').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    f.min = v > FILTER_OFF ? v : 0;
    limit = PAGE;
    render();
  });
  const text = (id, key) =>
    $(id).addEventListener('input', (e) => {
      f[key] = e.target.value;
      limit = PAGE;
      renderSoon();
    });
  text('price-min', 'priceMin');
  text('price-max', 'priceMax');
  text('q', 'q');
  for (const [id, key] of [
    ['rated', 'rated'],
    ['multi', 'multi'],
  ])
    $(id).addEventListener('change', (e) => {
      f[key] = e.target.checked;
      limit = PAGE;
      render();
    });
  $('reset').addEventListener('click', () => {
    f = blank();
    $('min').value = String(FILTER_OFF);
    for (const id of ['price-min', 'price-max', 'q']) $(id).value = '';
    $('rated').checked = $('multi').checked = false;
    limit = PAGE;
    render();
  });
  $('csv').addEventListener('click', exportCsv);
  $('stop').addEventListener('click', async () => {
    $('stop').disabled = true;
    try {
      if (agg?.tabId != null) await api.tabs.sendMessage(agg.tabId, { type: 'mi-agg-stop' });
    } catch {
      // the tab is gone: mark the scan stopped here
      if (agg) await api.storage.local.set({ [AGG_KEY]: { ...agg, status: 'stopped', updatedAt: Date.now() } });
    }
    $('stop').disabled = false;
  });
}

async function init() {
  const got = await api.storage.local.get([AGG_KEY, DATA_KEY, SETTINGS_KEY, SAVED_KEY, MUTED_KEY]);
  buildBrands(got[DATA_KEY]);
  siteUrl = (got[SETTINGS_KEY]?.endpoint || DEFAULT_SITE).replace(/\/+$/, '');
  saved = got[SAVED_KEY] || {};
  muted = got[MUTED_KEY] || {};
  takeAgg(got[AGG_KEY]);
  bindFilters();
  render();
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[DATA_KEY]) {
      buildBrands(changes[DATA_KEY].newValue);
      takeAgg(agg);
    }
    if (changes[AGG_KEY]) takeAgg(changes[AGG_KEY].newValue);
    if (changes[SAVED_KEY]) saved = changes[SAVED_KEY].newValue || {};
    if (changes[MUTED_KEY]) muted = changes[MUTED_KEY].newValue || {};
    if (changes[DATA_KEY] || changes[AGG_KEY] || changes[SAVED_KEY] || changes[MUTED_KEY]) renderSoon();
  });
  // keep "x min ago" and the interrupted check current
  setInterval(renderRun, 30000);
}
init();
