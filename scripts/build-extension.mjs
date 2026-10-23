#!/usr/bin/env node
/**
 * build-extension.mjs — package the browser extension
 * ------------------------------------------------------------------
 * Writes extension/dist/chrome and extension/dist/firefox: the shared
 * sources from extension/src, a per-browser Manifest V3, PNG icons drawn
 * from the site's mark, and a snapshot of public/extension.json so the
 * extension works before its first sync. Run `npm run data:generate` first.
 *
 * Load unpacked: chrome://extensions → Developer mode → Load unpacked →
 * extension/dist/chrome. Firefox: about:debugging → This Firefox → Load
 * Temporary Add-on → extension/dist/firefox/manifest.json.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SRC = 'extension/src';
const OUT = 'extension/dist';
const DATA = 'public/extension.json';
if (!existsSync(DATA)) {
  console.error(`✖ ${DATA} not found — run npm run data:generate first`);
  process.exit(1);
}
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

// Sites the content script runs on. Match patterns can't wildcard a TLD, so country sites are listed.
const VINTED = ['co.uk', 'com', 'fr', 'de', 'it', 'es', 'nl', 'be', 'at', 'ie', 'pl', 'pt', 'lu', 'lt', 'cz', 'sk', 'se', 'dk', 'fi', 'hu', 'ro', 'hr', 'gr'];
const EBAY = ['com', 'co.uk', 'de', 'fr', 'it', 'es', 'ca', 'com.au', 'ie', 'at', 'ch', 'nl', 'be'];
const MATCHES = [
  '*://*.yoox.com/*',
  '*://*.farfetch.com/*',
  '*://*.ssense.com/*',
  '*://*.grailed.com/*',
  ...VINTED.map((t) => `*://*.vinted.${t}/*`),
  ...EBAY.map((t) => `*://*.ebay.${t}/*`),
];

/* ---------- icons: the three-bar mark, drawn as PNG without dependencies ---------- */
function png(size) {
  const ink = [22, 21, 20];
  const paper = [244, 242, 237];
  // geometry from public/favicon.svg (64-unit square)
  const bars = [
    [14, 16, 9, 32],
    [27.5, 25, 9, 23],
    [41, 34, 9, 14],
  ];
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size) * 64;
      const v = ((y + 0.5) / size) * 64;
      const on = bars.some(([bx, by, bw, bh]) => u >= bx && u < bx + bw && v >= by && v < by + bh);
      (on ? paper : ink).forEach((c, i) => (row[1 + x * 3 + i] = c));
    }
    rows.push(row);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

function manifest(target) {
  const icons = { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' };
  const m = {
    manifest_version: 3,
    name: 'Menswear Index',
    version,
    description: 'Shows Menswear Index scores, tiers and buy-at verdicts next to brand names on Yoox, Farfetch, SSENSE, Grailed, Vinted and eBay.',
    icons,
    action: { default_title: 'Menswear Index', default_popup: 'popup.html', default_icon: icons },
    permissions: ['storage', 'alarms'],
    content_scripts: [{ matches: MATCHES, js: ['content.js'], run_at: 'document_idle' }],
  };
  if (target === 'chrome') m.background = { service_worker: 'background.js' };
  else {
    m.background = { scripts: ['background.js'] };
    m.browser_specific_settings = { gecko: { id: 'menswear-index@extension', strict_min_version: '121.0' } };
  }
  return m;
}

rmSync(OUT, { recursive: true, force: true });
for (const target of ['chrome', 'firefox']) {
  const dir = `${OUT}/${target}`;
  mkdirSync(`${dir}/icons`, { recursive: true });
  mkdirSync(`${dir}/data`, { recursive: true });
  cpSync(SRC, dir, { recursive: true });
  for (const s of [16, 32, 48, 128]) writeFileSync(`${dir}/icons/${s}.png`, png(s));
  cpSync(DATA, `${dir}/data/brands.json`);
  writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest(target), null, 2) + '\n');
}
const data = JSON.parse(readFileSync(DATA, 'utf8'));
console.log(`✔ built extension v${version} → ${OUT}/chrome, ${OUT}/firefox · ${data.brands.length} brands bundled (${data.generatedAt.slice(0, 10)}) · ${MATCHES.length} site patterns`);
