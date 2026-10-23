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

async function renderPage() {
  const empty = $('page-empty');
  const list = $('page-list');
  let page = null;
  if (tabId != null) {
    try {
      page = await api.tabs.sendMessage(tabId, { type: 'mi-page' });
    } catch {
      page = null; // no content script here (unsupported site, or the page predates the extension)
    }
  }
  if (!page) {
    list.hidden = true;
    $('page-count').textContent = '';
    empty.hidden = false;
    empty.textContent = 'Open a listings page on Vinted, SSENSE, Grailed, Farfetch, Yoox or eBay. If one is already open, reload it.';
    return;
  }
  const n = page.brands.length;
  $('page-count').textContent = n ? `${n} brand${n === 1 ? '' : 's'} · ${page.listings} listing${page.listings === 1 ? '' : 's'}` : '';
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
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = `Jump to ${b.name} on the page`;
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
      sub.textContent = `${b.bestDeal != null ? `Deal · index ${b.composite.toFixed(1)} · ` : ''}#${b.rank.toLocaleString('en-GB')} · ${TIER_SYMBOL[b.tier]} · ${b.count} listing${b.count === 1 ? '' : 's'}${b.provisional ? ' · provisional' : ''}`;
      mid.append(name, sub);
      const right = document.createElement('span');
      right.className = 'buy';
      right.textContent = b.buys ? `✓ ${b.buys} buy${b.buys === 1 ? '' : 's'}` : '';
      if (b.bestDiscount != null) right.title = `Best discount here: ${b.bestDiscount}% (buy at ${b.buyAt}%+)`;
      btn.append(score, mid, right);
      btn.addEventListener('click', () => api.tabs.sendMessage(tabId, { type: 'mi-reveal', id: b.id }).catch(() => {}));
      li.append(btn);
      return li;
    }),
  );
  list.scrollTop = scroll;
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
  renderPage();
  // keep the list current while the popup is open (infinite scroll keeps adding listings)
  setInterval(renderPage, 2000);
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
