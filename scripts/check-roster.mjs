#!/usr/bin/env node
/**
 * check-roster.mjs — lint the curated roster before generating.
 *
 *   node scripts/check-roster.mjs [file.mjs …]
 *
 * Checks every row in scripts/roster.mjs (base + scripts/roster-more/) plus the
 * seed in src/App.tsx for: exact duplicates (same slug or folded name), likely
 * duplicates (one name is the other plus extra words, e.g. "Acne" / "Acne
 * Studios", or matches a known alias), and bad fields (category, tier, scores,
 * founded, confidence, country code missing from the generator's COUNTRIES).
 * With file arguments, only rows from those files are reported (still checked
 * against the whole catalogue). Exits non-zero on errors; near-duplicates are
 * warnings to review by hand.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROSTER } from './roster.mjs';
import { ALIASES } from './aliases.mjs';

const CATEGORIES = ['tailoring', 'shirting', 'trad', 'heritage', 'denim', 'country', 'technical', 'designer', 'contemporary', 'streetwear', 'essentials', 'knitwear', 'footwear', 'accessories'];
const TIERS = ['atelier', 'luxury', 'premium', 'accessible', 'mainstream'];
const gen = readFileSync('scripts/generate-brands.mjs', 'utf8');
const COUNTRY_CODES = new Set([...gen.slice(gen.indexOf('const COUNTRIES'), gen.indexOf('};', gen.indexOf('const COUNTRIES'))).matchAll(/\b([A-Z]{2}):/g)].map((m) => m[1]));

const fold = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`.]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const slug = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const app = readFileSync('src/App.tsx', 'utf8');
const seed = JSON.parse(app.match(/\/\* @seed:begin \*\/([\s\S]*?)\/\* @seed:end \*\//)[1]);

const only = new Set();
for (const f of process.argv.slice(2)) {
  const mod = await import(pathToFileURL(resolve(f)).href);
  for (const row of mod.default ?? Object.values(mod).flat()) only.add(row);
}

const all = [...seed.map((b) => ({ name: b.name, src: 'seed', row: null })), ...ROSTER.map((r) => ({ name: r[0], src: 'roster', row: r }))];
const bySlug = new Map();
const byFold = new Map();
for (const e of all) {
  for (const [m, k] of [
    [bySlug, slug(e.name)],
    [byFold, fold(e.name)],
  ]) {
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(e);
  }
}
const aliasOf = new Map();
for (const [name, list] of Object.entries(ALIASES)) for (const a of list) aliasOf.set(fold(a), name);

let errors = 0;
let warnings = 0;
const err = (name, msg) => (errors++, console.log(`✖ ${name}: ${msg}`));
const warn = (name, msg) => (warnings++, console.log(`⚠ ${name}: ${msg}`));
const report = (e) => !only.size || only.has(e.row);

// fields
for (const e of all.filter((x) => x.row && report(x))) {
  const [name, cc, city, founded, category, tier, s, sigs, summary, confidence = 0.8] = e.row;
  if (e.row.length < 9 || e.row.length > 10) err(name, `row has ${e.row.length} fields`);
  if (!COUNTRY_CODES.has(cc)) err(name, `country code ${cc} is not in COUNTRIES (scripts/generate-brands.mjs)`);
  if (city !== null && (typeof city !== 'string' || !city.trim())) err(name, 'city must be a string or null');
  if (founded !== null && !(Number.isInteger(founded) && founded >= 1500 && founded <= 2026)) err(name, `founded ${founded}`);
  if (!CATEGORIES.includes(category)) err(name, `category ${category}`);
  if (!TIERS.includes(tier)) err(name, `tier ${tier}`);
  if (!Array.isArray(s) || s.length !== 8 || s.some((v) => !Number.isInteger(v) || v < 1 || v > 100)) err(name, 'scores must be 8 integers 1–100');
  if (typeof sigs !== 'string') err(name, 'signatures must be a string');
  if (typeof summary !== 'string' || summary.length < 12) err(name, 'summary missing or too short');
  else if (!/[.!?]$/.test(summary)) warn(name, 'summary should end with a full stop');
  if (!(confidence >= 0.5 && confidence <= 1)) err(name, `confidence ${confidence}`);
}

// exact duplicates
for (const [k, list] of [...bySlug, ...byFold]) {
  if (list.length > 1 && list.some(report)) err(list[0].name, `duplicate (${k}): ${list.map((e) => `${e.name} [${e.src}]`).join(', ')}`);
}

// likely duplicates: one name's words are the start or end of the other's, or it matches an alias
const folded = all.map((e) => ({ ...e, f: fold(e.name) }));
const reported = new Set();
for (const a of folded.filter(report)) {
  if (aliasOf.has(a.f) && aliasOf.get(a.f) !== a.name) warn(a.name, `matches an alias of ${aliasOf.get(a.f)}`);
  for (const b of folded) {
    if (a === b || a.f === b.f) continue;
    const [short, long] = a.f.length < b.f.length ? [a.f, b.f] : [b.f, a.f];
    if (short.length < 4) continue;
    if (long.startsWith(`${short} `) || long.endsWith(` ${short}`)) {
      const key = [a.name, b.name].sort().join(' / ');
      if (reported.has(key)) continue;
      reported.add(key);
      warn(a.name, `similar to ${b.name} [${b.src}]`);
    }
  }
}

console.log(`\n${all.length} brands checked${only.size ? ` (${only.size} reported)` : ''} · ${errors} error(s) · ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
