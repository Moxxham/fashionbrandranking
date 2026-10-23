const api = globalThis.browser ?? globalThis.chrome;
const SETTINGS_KEY = 'mi-settings';
const STATUS_KEY = 'mi-status';
const DEFAULTS = { endpoint: 'https://menswear-index.pages.dev', enabled: true, showProvisional: false, sites: {} };
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

async function init() {
  const s = await getSettings();
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
