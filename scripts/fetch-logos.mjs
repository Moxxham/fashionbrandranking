#!/usr/bin/env node
/**
 * fetch-logos.mjs — download brand icons into public/logos/<id>.png
 * ------------------------------------------------------------------
 * For every brand with an official website in scripts/websites.mjs:
 *   1. Check the domain belongs to the brand: the homepage <title> or
 *      og:site_name must contain a word from the brand name. A mismatch is
 *      reported and skipped (a wrong logo is worse than the monogram).
 *      Sites that block scripted requests are "unverified" and fetched,
 *      since the list is curated by hand.
 *   2. Download the brand's 128px icon via Google's favicon service and
 *      save it locally, so visitors never call a third party.
 *
 * Ids in NO_LOGO (scripts/websites.mjs) are skipped: their icon was wrong.
 * Existing files are never overwritten: drop your own <id>.svg/.png into
 * public/logos/ to set a logo by hand, and it wins. Re-run to fill gaps.
 *
 * Usage: node scripts/fetch-logos.mjs [--only <id,id>] [--force] [--no-verify]
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NO_LOGO, WEBSITES } from './websites.mjs';

const OUT = 'public/logos';
const CONCURRENCY = 8;
const args = process.argv.slice(2);
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
const force = args.includes('--force');
const verify = !args.includes('--no-verify');

// brand name -> id, from the generated catalogue (seed ids don't always equal the slugified name)
const idByName = new Map(JSON.parse(readFileSync('public/brands.json', 'utf8')).brands.map((b) => [b.name, b.id]));
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const STOP = new Set(['the', 'and', 'of', 'co', 'company', 'clothing', 'jeans', 'shoes', 'boots', 'london', 'paris', 'new', 'york', 'est']);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

mkdirSync(OUT, { recursive: true });
const have = new Set(readdirSync(OUT).map((f) => f.replace(/\.[a-z]+$/, '')));

const MIN_PX = 28; // smaller favicons look blurry at row size; the monogram is better
/** Image type and width from magic bytes (PNG/JPEG); null if unrecognised. */
function sniff(buf) {
  if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') return { ext: 'png', width: buf.readUInt32BE(16) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let o = 2; o < buf.length - 9; ) {
      if (buf[o] !== 0xff) return null;
      const marker = buf[o + 1];
      if (marker >= 0xc0 && marker <= 0xc3) return { ext: 'jpg', width: buf.readUInt16BE(o + 7) };
      o += 2 + buf.readUInt16BE(o + 2);
    }
  }
  return null;
}

const icon = (domain) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
const sha = (buf) => createHash('sha1').update(buf).digest('hex');

async function get(url, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en-GB,en' }, redirect: 'follow', signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** 'verified' | 'mismatch' (with the title found) | 'unverified' (site unreachable or blocking) */
async function checkDomain(name, domain) {
  try {
    const r = await get(`https://${domain}`);
    if (!r.ok) return { status: 'unverified', note: `HTTP ${r.status}` };
    const html = (await r.text()).slice(0, 200_000);
    const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '').trim();
    const site = html.match(/property=["']og:site_name["'][^>]*content=["']([^"']*)/i)?.[1] ?? '';
    const hay = fold(`${title} ${site} ${domain}`).replace(/[^a-z0-9]+/g, ' ');
    const words = fold(name).replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 1 && !STOP.has(w));
    if (!words.length || words.some((w) => hay.includes(w))) return { status: 'verified' };
    return { status: 'mismatch', note: title.slice(0, 80) || '(no title)' };
  } catch (e) {
    return { status: 'unverified', note: e.name === 'AbortError' ? 'timeout' : 'unreachable' };
  }
}

// Google's placeholder globe, returned when a site has no icon: learn its hash from a domain that can't exist.
const placeholder = sha(Buffer.from(await (await get(icon('no-such-domain-menswear-index.invalid'))).arrayBuffer()));

const jobs = Object.entries(WEBSITES)
  .map(([name, domain]) => ({ name, domain, id: idByName.get(name) }))
  .filter((j) => {
    if (!j.id) console.log(`  ⚠ ${j.name}: not in public/brands.json — run data:generate first`);
    return j.id && !NO_LOGO.has(j.id) && (!only || only.has(j.id)) && (force || !have.has(j.id));
  });

const tally = { saved: 0, verified: 0, unverified: 0, mismatch: 0, noIcon: 0, tooSmall: 0, failed: 0 };
const report = [];
let i = 0;
async function worker() {
  while (i < jobs.length) {
    const j = jobs[i++];
    const check = verify ? await checkDomain(j.name, j.domain) : { status: 'unverified', note: 'not checked' };
    tally[check.status]++;
    if (check.status === 'mismatch') {
      report.push(`  ✖ ${j.name} (${j.domain}): homepage title "${check.note}" — skipped, check the domain`);
      continue;
    }
    try {
      const r = await get(icon(j.domain));
      const buf = Buffer.from(await r.arrayBuffer());
      if (!r.ok || buf.length < 100 || sha(buf) === placeholder) {
        tally.noIcon++;
        report.push(`  · ${j.name} (${j.domain}): no icon available`);
        continue;
      }
      const img = sniff(buf);
      if (!img) {
        tally.failed++;
        report.push(`  ✖ ${j.name} (${j.domain}): unrecognised image format`);
        continue;
      }
      if (img.width < MIN_PX) {
        tally.tooSmall++;
        report.push(`  · ${j.name} (${j.domain}): icon only ${img.width}px, kept the monogram`);
        continue;
      }
      writeFileSync(`${OUT}/${j.id}.${img.ext}`, buf);
      tally.saved++;
      if (check.status === 'unverified') report.push(`  ? ${j.name} (${j.domain}): saved unverified (${check.note})`);
    } catch {
      tally.failed++;
      report.push(`  ✖ ${j.name} (${j.domain}): download failed`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(report.sort().join('\n'));
console.log(`\n${jobs.length} brands · saved ${tally.saved} · domain verified ${tally.verified}, unverified ${tally.unverified}, mismatched ${tally.mismatch} · no icon ${tally.noIcon} · too small ${tally.tooSmall} · failed ${tally.failed}`);
