const api = globalThis.browser ?? globalThis.chrome;
const SETTINGS_KEY = 'mi-settings';
const STATUS_KEY = 'mi-status';
const DEFAULTS = { endpoint: 'https://menswear-index.pages.dev', enabled: true, showProvisional: false, sites: {}, spotlight: 0 };
const SITES = [
  ['vinted', 'Vinted'],
  ['ssense', 'SSENSE'],
  ['grailed', 'Grailed'],
  ['farfetch', 'Farfetch'],
  ['yoox', 'Yoox'],
  ['ebay', 'eBay'],
];
const $ = (id) => document.getElementById(id);

async function getSettings() {
  const got = await api.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULTS, ...(got[SETTINGS_KEY] || {}) };
}
async function patch(change) {
  const s = await getSettings();
  await api.storage.local.set({ [SETTINGS_KEY]: { ...s, ...change } });
}

const ago = (t) => {
  if (!t) return 'never';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

async function renderStatus() {
  const st = (await api.storage.local.get(STATUS_KEY))[STATUS_KEY];
  if (!st) {
    $('status').textContent = 'No data yet.';
    return;
  }
  const built = st.generatedAt ? new Date(st.generatedAt).toLocaleDateString('en-GB') : 'unknown';
  $('status').textContent = `${(st.count || 0).toLocaleString('en-GB')} brands · data from ${built} · ${st.source === 'remote' ? `synced ${ago(st.syncedAt)}` : 'bundled copy (not yet synced)'}`;
  const err = st.lastError && (!st.syncedAt || st.lastAttempt > st.syncedAt);
  $('error').hidden = !err;
  if (err) $('error').textContent = `Last sync failed: ${st.lastError}`;
}

/* ---------- on this page ---------- */
const BANDS = [
  [80, '#173c70', '#fff'],
  [75, '#3963a1', '#fff'],
  [70, '#b5cde7', '#161514'],
  [65, '#dcd9d3', '#161514'],
  [60, '#e7c0bc', '#161514'],
  [55, '#a74541', '#fff'],
  [0, '#722426', '#fff'],
];
const TIER_SYMBOL = { atelier: '$$$$$', luxury: '$$$$', premium: '$$$', accessible: '$$', mainstream: '$' };
const SPOTLIGHT = [
  [0, 'Off'],
  [70, '70+'],
  [75, '75+'],
  [80, '80+'],
];
let tabId = null;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function renderPage(page) {
  const empty = $('page-empty');
  const list = $('page-list');
  if (page === undefined && tabId != null) {
    try {
      page = await api.tabs.sendMessage(tabId, { type: 'mi-page' });
    } catch {
      page = null; // no content script here (unsupported site, or the page predates the extension)
    }
  }
  renderFilter(page);
  if (!page) {
    list.hidden = true;
    $('page-count').textContent = '';
    empty.hidden = false;
    empty.textContent = 'Open a listings page on Vinted, SSENSE, Grailed, Farfetch, Yoox or eBay. If one is already open, reload it.';
    return;
  }
  const n = page.brands.length;
  const shownBrands = page.brands.filter((b) => b.shown > 0).length;
  $('page-count').textContent = !n
    ? ''
    : page.shownListings === page.listings
      ? `${plural(n, 'brand')} · ${plural(page.listings, 'listing')}`
      : `${shownBrands} of ${plural(n, 'brand')} · ${page.shownListings} of ${plural(page.listings, 'listing')} showing`;
  if (!n) {
    list.hidden = true;
    empty.hidden = false;
    empty.textContent = `No ranked brands found on this ${page.site} page yet. Scroll to load more listings.`;
    return;
  }
  empty.hidden = true;
  list.hidden = false;
  const scroll = list.scrollTop;
  list.replaceChildren(
    ...page.brands.map((b) => {
      // the best deal score where a listing shows its RRP, otherwise the index score
      const main = b.bestDeal ?? b.composite;
      const [, bg, fg] = BANDS.find((x) => main >= x[0]);
      const li = document.createElement('li');
      const gone = b.shown === 0;
      li.className = gone ? 'gone' : '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = gone ? `No ${b.name} listings showing: all hidden by a filter` : `Jump to ${b.name} on the page`;
      if (gone) btn.setAttribute('aria-disabled', 'true');
      // whether the brand still has a tile on screen
      const vis = document.createElement('span');
      vis.className = `vis ${gone ? 'off' : 'on'}`;
      vis.textContent = gone ? '' : '✓';
      vis.setAttribute('aria-label', gone ? 'Not showing' : 'Showing');
      const score = document.createElement('span');
      score.className = 'score';
      score.style.background = bg;
      score.style.color = fg;
      score.textContent = main >= 100 ? '100' : main.toFixed(1);
      score.title = b.bestDeal != null ? `Best deal score here (index score ${b.composite.toFixed(1)})` : 'Index score';
      const mid = document.createElement('span');
      mid.style.minWidth = '0';
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = b.name;
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = `${b.bestDeal != null ? `Deal · index ${b.composite.toFixed(1)} · ` : ''}#${b.rank.toLocaleString('en-GB')} · ${TIER_SYMBOL[b.tier]} · ${b.shown === b.count ? plural(b.count, 'listing') : gone ? `${plural(b.count, 'listing')}, all hidden` : `${b.shown} of ${b.count} showing`}${b.provisional ? ' · provisional' : ''}`;
      mid.append(name, sub);
      const right = document.createElement('span');
      right.className = 'buy';
      right.textContent = b.buys ? `✓ ${b.buys} buy${b.buys === 1 ? '' : 's'}` : '';
      if (b.bestDiscount != null) right.title = `Best discount here: ${b.bestDiscount}% (buy at ${b.buyAt}%+)`;
      btn.append(vis, score, mid, right);
      btn.addEventListener('click', () => !gone && api.tabs.sendMessage(tabId, { type: 'mi-reveal', id: b.id }).catch(() => {}));
      li.append(btn);
      return li;
    }),
  );
  list.scrollTop = scroll;
}

/* ---------- score filter (lives in the page, so it resets when the page reloads) ---------- */
const FILTER_OFF = 40; // the slider's lowest stop means no filter
let filterSynced = false;
const sliderMin = () => Number($('filter-min').value);

function renderFilter(page) {
  $('filter').hidden = !page;
  if (!page) return;
  // take the page's current filter once, so the 2-second refresh doesn't fight the slider
  if (!filterSynced) {
    filterSynced = true;
    $('filter-min').value = String(page.filter.min > FILTER_OFF ? page.filter.min : FILTER_OFF);
    $('filter-unrated').checked = page.filter.unrated;
  }
  $('filter-unrated-row').hidden = !page.unratedFilter;
  const min = sliderMin();
  $('filter-value').textContent = min > FILTER_OFF ? `${min}` : 'Off';
  const on = min > FILTER_OFF || (page.unratedFilter && $('filter-unrated').checked);
  $('filter-note').textContent = on
    ? `${plural(page.filteredOut, 'listing')} hidden. For this page only: reloading or closing the tab shows everything again.`
    : 'For this page only: reloading or closing the tab shows everything again.';
}

async function sendFilter() {
  const min = sliderMin();
  $('filter-value').textContent = min > FILTER_OFF ? `${min}` : 'Off';
  try {
    const page = await api.tabs.sendMessage(tabId, { type: 'mi-filter', min: min > FILTER_OFF ? min : 0, unrated: $('filter-unrated').checked });
    renderPage(page);
  } catch {
    /* the page went away */
  }
}

function renderSpotlight(current) {
  $('spotlight').replaceChildren(
    ...SPOTLIGHT.map(([v, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(current === v));
      b.addEventListener('click', async () => {
        await patch({ spotlight: v });
        renderSpotlight(v);
        setTimeout(renderPage, 400); // the page rescans when settings change
      });
      return b;
    }),
  );
}

async function init() {
  const s = await getSettings();
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  renderSpotlight(s.spotlight || 0);
  $('filter-min').addEventListener('input', sendFilter);
  $('filter-unrated').addEventListener('change', sendFilter);
  renderPage();
  // keep the list current while the popup is open (infinite scroll keeps adding listings)
  setInterval(() => renderPage(), 2000);
  $('enabled').checked = s.enabled;
  $('provisional').checked = s.showProvisional;
  $('endpoint').value = s.endpoint;
  for (const [id, name] of SITES) {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = s.sites?.[id] !== false;
    box.addEventListener('change', async () => {
      const cur = await getSettings();
      await patch({ sites: { ...cur.sites, [id]: box.checked } });
    });
    label.append(box, ` ${name}`);
    $('sites').append(label);
  }
  $('enabled').addEventListener('change', (e) => patch({ enabled: e.target.checked }));
  $('provisional').addEventListener('change', (e) => patch({ showProvisional: e.target.checked }));
  $('save').addEventListener('click', async () => {
    const v = $('endpoint').value.trim().replace(/\/+$/, '');
    if (!/^https:\/\/[^/\s]+/.test(v)) {
      $('error').hidden = false;
      $('error').textContent = 'Enter the site address, starting https://';
      return;
    }
    await patch({ endpoint: v });
    $('save').textContent = 'Saved';
    setTimeout(() => ($('save').textContent = 'Save'), 1200);
  });
  $('sync').addEventListener('click', async () => {
    $('sync').disabled = true;
    $('sync').textContent = 'Syncing…';
    await api.runtime.sendMessage({ type: 'mi-sync' });
    $('sync').disabled = false;
    $('sync').textContent = 'Sync now';
    renderStatus();
  });
  renderStatus();
  // data may still be seeding or syncing when the popup opens
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes[STATUS_KEY] || changes['mi-data'])) renderStatus();
  });
}
init();
