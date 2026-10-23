/* Menswear Index — background (MV3 service worker in Chrome, event page in Firefox).
 *
 * Keeps the brand lookup in storage.local: seeded from the copy bundled with
 * the extension on install, then refreshed daily from <site>/extension.json,
 * a static file on Cloudflare Pages, so there is no API to run or pay for.
 */
const api = globalThis.browser ?? globalThis.chrome;
const DATA_KEY = 'mi-data';
const STATUS_KEY = 'mi-status';
const SETTINGS_KEY = 'mi-settings';
const ALARM = 'mi-daily-sync';
const DEFAULTS = { endpoint: 'https://menswear-index.pages.dev', enabled: true, showProvisional: false, sites: {}, spotlight: 0 };

const valid = (d) => d && d.v === 1 && Array.isArray(d.brands) && d.brands.length > 100 && Array.isArray(d.brands[0]) && Array.isArray(d.dimensions);

async function settings() {
  const got = await api.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULTS, ...(got[SETTINGS_KEY] || {}) };
}

async function seedFromBundle() {
  const got = await api.storage.local.get(DATA_KEY);
  if (valid(got[DATA_KEY])) return;
  const res = await fetch(api.runtime.getURL('data/brands.json'));
  const data = await res.json();
  if (!valid(data)) return;
  await api.storage.local.set({ [DATA_KEY]: data, [STATUS_KEY]: { source: 'bundled', count: data.brands.length, generatedAt: data.generatedAt, syncedAt: null } });
}

async function sync() {
  const { endpoint } = await settings();
  const url = `${endpoint.replace(/\/+$/, '')}/extension.json`;
  const prev = (await api.storage.local.get(STATUS_KEY))[STATUS_KEY] || {};
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!valid(data)) throw new Error('unexpected data format');
    await api.storage.local.set({
      [DATA_KEY]: data,
      [STATUS_KEY]: { source: 'remote', count: data.brands.length, generatedAt: data.generatedAt, syncedAt: Date.now(), url },
    });
    return { ok: true, count: data.brands.length };
  } catch (e) {
    await api.storage.local.set({ [STATUS_KEY]: { ...prev, lastError: String(e.message || e), lastAttempt: Date.now(), url } });
    return { ok: false, error: String(e.message || e) };
  }
}

async function ensureAlarm() {
  if (!(await api.alarms.get(ALARM))) api.alarms.create(ALARM, { periodInMinutes: 24 * 60, delayInMinutes: 1 });
}

api.runtime.onInstalled.addListener(async () => {
  await seedFromBundle();
  await ensureAlarm();
  sync();
});
api.runtime.onStartup?.addListener(async () => {
  await seedFromBundle();
  await ensureAlarm();
});
api.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) sync();
});
api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'mi-sync') {
    sync().then(sendResponse);
    return true; // async response
  }
  return false;
});
