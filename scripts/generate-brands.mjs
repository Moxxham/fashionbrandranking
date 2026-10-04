#!/usr/bin/env node
/**
 * generate-brands.mjs — Menswear Index dataset builder
 * ------------------------------------------------------------------
 * Zero-dependency Node (>=18) CLI that assembles, validates, scores and ranks
 * the catalogue, then writes a `brands.json` that conforms to
 * docs/brand.schema.json and is consumed by src/App.tsx at runtime.
 *
 * Every record is a real brand. There is no synthetic/placeholder generation;
 * records marked provenance:"generated" are rejected outright.
 *
 * Sources, in precedence order (roster rows never overwrite seed ids;
 * --input deliberately overrides by id):
 *   1. Curated seed   — parsed from the @seed block embedded in src/App.tsx
 *                       (single source of truth; no duplication)
 *   2. Curated roster — compact editorial rows in scripts/roster.mjs
 *   3. Ingested input — optional --input file(s): JSON array, dataset
 *                       envelope, or NDJSON of raw records. Overrides by id.
 *
 * Stockist flags (where to buy) come from scripts/stockists.mjs and are
 * attached after all sources merge, so an ingested override keeps them.
 *
 * Records are validated and scored in batches of --batch.
 *
 * Usage
 *   node scripts/generate-brands.mjs [options]
 *
 *   --out <path>       output path (default public/brands.json)
 *   --batch <n>        validation/scoring batch size (default 100)
 *   --input <path>     raw records to ingest; repeatable
 *   --app <path>       App.tsx to read the embedded seed from (default src/App.tsx)
 *   --format json|ndjson   (default json)
 *   --pretty           pretty-print JSON
 *   --strict           exit non-zero if any record is invalid or duplicated
 *   --date <iso>       pin generatedAt / updatedAt (reproducible builds)
 *   --help
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ROSTER } from './roster.mjs';
import { RETAILER_IDS, STOCKISTS } from './stockists.mjs';

/* ================================================================== */
/* Methodology — keep in sync with §1/§3 of src/App.tsx.               */
/* The app reads `weights` from the envelope, so this file is the      */
/* authority for any dataset it produces.                              */
/* ================================================================== */

const SCHEMA_VERSION = '1.0';
const METHODOLOGY_VERSION = '1.0';
const DIMENSIONS = ['material', 'construction', 'design', 'longevity', 'value', 'reputation', 'consistency', 'transparency'];
const WEIGHTS = { material: 0.2, construction: 0.2, design: 0.15, longevity: 0.15, value: 0.1, reputation: 0.1, consistency: 0.05, transparency: 0.05 };
const BLEND = 0.75;
const PRIOR = 60;
const MIN_CONFIDENCE = 0.5;

const CATEGORIES = ['tailoring', 'shirting', 'trad', 'heritage', 'denim', 'country', 'technical', 'designer', 'contemporary', 'streetwear', 'essentials', 'knitwear', 'footwear', 'accessories'];
const TIERS = ['atelier', 'luxury', 'premium', 'accessible', 'mainstream'];
const OWNERSHIP = ['independent', 'family', 'group', 'public', 'private-equity'];

const COUNTRIES = {
  GB: 'United Kingdom', IT: 'Italy', JP: 'Japan', US: 'United States', FR: 'France', DE: 'Germany', SE: 'Sweden',
  DK: 'Denmark', NO: 'Norway', NL: 'Netherlands', ES: 'Spain', PT: 'Portugal', CA: 'Canada', AU: 'Australia',
  KR: 'South Korea', BE: 'Belgium', CH: 'Switzerland', IE: 'Ireland', HK: 'Hong Kong', HU: 'Hungary', RO: 'Romania',
  GG: 'Guernsey', AT: 'Austria', FI: 'Finland', IN: 'India', NZ: 'New Zealand', TR: 'Turkey', IS: 'Iceland', BR: 'Brazil', SK: 'Slovakia',
};

/* ================================================================== */
/* CLI                                                                 */
/* ================================================================== */

function parseArgs(argv) {
  const o = { out: 'public/brands.json', batch: 100, input: [], app: 'src/App.tsx', format: 'json', pretty: false, strict: false, date: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) die(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '--out': o.out = next(); break;
      case '--batch': o.batch = Math.max(1, int(next(), a)); break;
      case '--input': o.input.push(next()); break;
      case '--app': o.app = next(); break;
      case '--format': o.format = next(); if (!['json', 'ndjson'].includes(o.format)) die('--format must be json or ndjson'); break;
      case '--pretty': o.pretty = true; break;
      case '--strict': o.strict = true; break;
      case '--date': o.date = next(); if (Number.isNaN(Date.parse(o.date))) die('--date must be an ISO date'); break;
      case '-h': case '--help': printHelp(); process.exit(0);
      default: die(`Unknown argument: ${a} (try --help)`);
    }
  }
  return o;
}
function int(v, flag) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) die(`${flag} expects a non-negative integer`);
  return n;
}
function die(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}
function printHelp() {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const doc = src.slice(src.indexOf('/**') + 3, src.indexOf('*/')).replace(/^ \* ?/gm, '');
  console.log(doc.trim());
}
const log = (...a) => console.error(...a);

/* ================================================================== */
/* Scoring                                                             */
/* ================================================================== */

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round1 = (n) => Math.round(n * 10) / 10;

function scoreBrand(b) {
  let a = 0;
  let lg = 0;
  for (const d of DIMENSIONS) {
    const s = clamp(b.scores[d], 1, 100);
    a += WEIGHTS[d] * s;
    lg += WEIGHTS[d] * Math.log(s);
  }
  const balanced = BLEND * a + (1 - BLEND) * Math.exp(lg);
  return round1(PRIOR + clamp(b.confidence, MIN_CONFIDENCE, 1) * (balanced - PRIOR));
}

function rankAll(brands) {
  for (const b of brands) b.composite = scoreBrand(b);
  brands.sort(
    (x, y) => y.composite - x.composite || y.scores.construction - x.scores.construction || y.scores.material - x.scores.material || x.name.localeCompare(y.name),
  );
  let lastScore = NaN;
  let lastRank = 0;
  brands.forEach((b, i) => {
    b.rank = b.composite === lastScore ? lastRank : i + 1;
    lastScore = b.composite;
    lastRank = b.rank;
  });
  return brands;
}

/* ================================================================== */
/* Validation (mirrors docs/brand.schema.json)                         */
/* ================================================================== */

function validateBrand(b) {
  const e = [];
  const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
  if (!b || typeof b !== 'object') return ['record is not an object'];
  if (!isStr(b.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(b.id)) e.push('id must be a lowercase slug');
  if (!isStr(b.name)) e.push('name is required');
  if (b.founded !== null && !(Number.isInteger(b.founded) && b.founded >= 1500 && b.founded <= 2100)) e.push('founded must be an integer year or null');
  if (!b.origin || !isStr(b.origin.country) || !/^[A-Z]{2}$/.test(b.origin.countryCode ?? '')) e.push('origin.country and ISO-2 origin.countryCode required');
  if (!CATEGORIES.includes(b.category)) e.push(`category must be one of ${CATEGORIES.join(', ')}`);
  if (b.subcategories && (!Array.isArray(b.subcategories) || b.subcategories.some((c) => !CATEGORIES.includes(c)))) e.push('subcategories contains unknown category');
  if (!TIERS.includes(b.tier)) e.push(`tier must be one of ${TIERS.join(', ')}`);
  if (!b.scores || typeof b.scores !== 'object') e.push('scores object required');
  else for (const d of DIMENSIONS) if (!(typeof b.scores[d] === 'number' && b.scores[d] >= 0 && b.scores[d] <= 100)) e.push(`scores.${d} must be 0–100`);
  if (!(typeof b.confidence === 'number' && b.confidence >= MIN_CONFIDENCE && b.confidence <= 1)) e.push(`confidence must be ${MIN_CONFIDENCE}–1`);
  if (!Array.isArray(b.signatures) || b.signatures.some((s) => !s || !isStr(s.name))) e.push('signatures must be [{ name }]');
  if (!b.editorial || typeof b.editorial.summary !== 'string' || !Array.isArray(b.editorial.strengths) || !Array.isArray(b.editorial.caveats)) e.push('editorial { summary, strengths[], caveats[] } required');
  if (b.ownership && !OWNERSHIP.includes(b.ownership.type)) e.push('ownership.type invalid');
  if (b.priceUSD && !(b.priceUSD.from > 0 && b.priceUSD.to >= b.priceUSD.from)) e.push('priceUSD.from/to invalid');
  if (b.stockists !== undefined && (!Array.isArray(b.stockists) || b.stockists.some((r) => !RETAILER_IDS.includes(r)))) e.push(`stockists must be retailer ids from ${RETAILER_IDS.join(', ')}`);
  if (b.provenance === 'generated') e.push('synthetic/placeholder records are not allowed — real brands only');
  else if (!['curated', 'ingested'].includes(b.provenance)) e.push('provenance invalid');
  return e;
}

/* ================================================================== */
/* Source 1 — curated seed embedded in App.tsx                         */
/* ================================================================== */

function loadSeed(appPath) {
  if (!existsSync(appPath)) {
    log(`⚠ ${appPath} not found — skipping embedded seed`);
    return [];
  }
  const src = readFileSync(appPath, 'utf8');
  const m = src.match(/\/\* @seed:begin \*\/([\s\S]*?)\/\* @seed:end \*\//);
  if (!m) die(`No /* @seed:begin */ … /* @seed:end */ block found in ${appPath}`);
  try {
    return JSON.parse(m[1]);
  } catch (err) {
    die(`Seed block in ${appPath} is not valid JSON: ${err.message}`);
  }
}

/* ================================================================== */
/* Source 2 — curated roster (rows live in ./roster.mjs)               */
/* ================================================================== */

const STRENGTH = {
  material: 'Exceptional raw materials and sourcing',
  construction: 'Construction and finishing above tier norms',
  design: 'Distinctive, influential design language',
  longevity: 'Built to last — and to be repaired',
  value: 'Strong quality-per-dollar within its tier',
  reputation: 'Long, well-regarded track record',
  consistency: 'Reliable quality control across lines',
  transparency: 'Above-average supply-chain disclosure',
};
const CAVEAT = {
  material: 'Materials trail the price point',
  construction: 'Construction trails tier peers',
  design: 'Design is conservative or derivative',
  longevity: 'Pieces tend to wear out or date quickly',
  value: 'Pricing outruns the product',
  reputation: 'Limited track record or recognition',
  consistency: 'Quality varies between lines or seasons',
  transparency: 'Little disclosure about where and how things are made',
};

function editorialFromScores(scores) {
  const ranked = DIMENSIONS.map((d) => [d, scores[d]]).sort((a, b) => b[1] - a[1]);
  const strengths = ranked.slice(0, 2).filter(([, v]) => v >= 75).map(([d]) => STRENGTH[d]);
  const [weakDim] = ranked[ranked.length - 1];
  return { strengths: strengths.length ? strengths : [STRENGTH[ranked[0][0]]], caveats: [CAVEAT[weakDim]] };
}

const slugify = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function expandRoster(row, today) {
  const [name, cc, city, founded, category, tier, s, sigs, summary, confidence = 0.8] = row;
  const scores = Object.fromEntries(DIMENSIONS.map((d, i) => [d, s[i]]));
  const { strengths, caveats } = editorialFromScores(scores);
  return {
    id: slugify(name),
    name,
    founded: founded ?? null,
    origin: { country: COUNTRIES[cc] ?? cc, countryCode: cc, ...(city ? { city } : {}) },
    category,
    tier,
    scores,
    confidence,
    signatures: sigs.split('|').map((x) => ({ name: x.trim() })).filter((x) => x.name),
    editorial: { summary, strengths, caveats },
    tags: [category],
    status: 'active',
    provenance: 'curated',
    updatedAt: today,
  };
}

/* ================================================================== */
/* Source 3 — ingestion                                                */
/* ================================================================== */

function loadInput(path) {
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return [];
  if (raw.startsWith('[') || raw.startsWith('{"schemaVersion') || (raw.startsWith('{') && raw.includes('"brands"'))) {
    const json = JSON.parse(raw);
    return Array.isArray(json) ? json : json.brands ?? [];
  }
  return raw
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch (err) {
        return { __parseError: `line ${i + 1}: ${err.message}` };
      }
    });
}

/** Light coercion so loosely-typed inputs (CSV→JSON exports) can pass validation. */
function coerceIngested(r, today) {
  if (!r || typeof r !== 'object' || r.__parseError) return r;
  const out = { ...r };
  if (!out.id && out.name) out.id = slugify(out.name);
  if (out.founded === undefined || out.founded === '') out.founded = null;
  else if (typeof out.founded === 'string') out.founded = Number.parseInt(out.founded, 10);
  if (out.origin && out.origin.countryCode) out.origin = { ...out.origin, countryCode: String(out.origin.countryCode).toUpperCase(), country: out.origin.country ?? COUNTRIES[String(out.origin.countryCode).toUpperCase()] };
  if (out.scores) out.scores = Object.fromEntries(DIMENSIONS.map((d) => [d, Number(out.scores[d])]));
  out.confidence = out.confidence === undefined ? 0.7 : Number(out.confidence);
  if (Array.isArray(out.signatures)) out.signatures = out.signatures.map((s) => (typeof s === 'string' ? { name: s } : s));
  else out.signatures = [];
  if (!out.editorial && out.scores) {
    const { strengths, caveats } = editorialFromScores(out.scores);
    out.editorial = { summary: out.summary ?? '', strengths, caveats };
  }
  delete out.summary;
  delete out.composite;
  delete out.rank;
  out.provenance = 'ingested';
  out.updatedAt = out.updatedAt ?? today;
  return out;
}

/* ================================================================== */
/* Pipeline                                                            */
/* ================================================================== */

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const t0 = performance.now();
  const now = opts.date ? new Date(opts.date) : new Date();
  const today = now.toISOString().slice(0, 10);
  const byId = new Map();
  const counts = { curated: 0, ingested: 0, rejected: 0, duplicates: 0, unresolvedStockists: 0 };

  const add = (rec, label) => {
    const errs = validateBrand(rec);
    if (errs.length) {
      counts.rejected++;
      log(`  ✖ ${label}: ${errs.join('; ')}`);
      return false;
    }
    byId.set(rec.id, rec);
    return true;
  };

  /** Validate + register a list of curated records in batches, skipping ids already taken. */
  const addBatched = (records, source) => {
    const batches = Math.ceil(records.length / opts.batch);
    for (let b = 0; b < batches; b++) {
      const tb = performance.now();
      let ok = 0;
      for (const r of records.slice(b * opts.batch, (b + 1) * opts.batch)) {
        if (byId.has(r.id)) {
          counts.duplicates++;
          log(`  ⚠ ${source} "${r.name}" duplicates existing id "${r.id}" — kept the earlier record`);
          continue;
        }
        if (add(r, `${source} "${r.name ?? r.id}"`)) ok++;
      }
      counts.curated += ok;
      log(`• ${source} batch ${b + 1}/${batches}: +${ok} (${(performance.now() - tb).toFixed(1)} ms)`);
    }
  };

  // 1 + 2: curated
  const seed = loadSeed(resolve(opts.app)).map((r) => ({ ...r, provenance: 'curated' }));
  addBatched(seed, 'seed');
  addBatched(ROSTER.map((row) => expandRoster(row, today)), 'roster');
  log(`• curated: ${counts.curated} real brands (${seed.length} seed + ${counts.curated - seed.length} roster)`);

  // 3: ingestion (overrides by id)
  for (const path of opts.input) {
    const records = loadInput(resolve(path));
    let ok = 0;
    records.forEach((raw, i) => {
      if (raw?.__parseError) {
        counts.rejected++;
        log(`  ✖ ${path} ${raw.__parseError}`);
        return;
      }
      const r = coerceIngested(raw, today);
      const prev = byId.get(r?.id);
      if (add(r, `${path}#${i + 1} "${r?.name ?? '?'}"`)) {
        ok++;
        if (prev?.provenance === 'curated') counts.curated--;
        if (prev?.provenance !== 'ingested') counts.ingested++;
      }
    });
    log(`• ingested ${ok}/${records.length} from ${path}`);
  }
  // 4: stockist flags (merged into any stockists a record already carries)
  const stockistCounts = {};
  for (const [retailer, ids] of Object.entries(STOCKISTS)) {
    if (!RETAILER_IDS.includes(retailer)) die(`stockists.mjs lists unknown retailer "${retailer}"`);
    stockistCounts[retailer] = 0;
    for (const id of ids) {
      const rec = byId.get(id);
      if (!rec) {
        counts.unresolvedStockists++;
        log(`  ⚠ stockists.${retailer}: no brand with id "${id}"`);
        continue;
      }
      if (!rec.stockists?.includes(retailer)) byId.set(id, { ...rec, stockists: [...(rec.stockists ?? []), retailer] });
      stockistCounts[retailer]++;
    }
  }
  if (opts.strict && (counts.rejected || counts.duplicates || counts.unresolvedStockists))
    die(`${counts.rejected} rejected, ${counts.duplicates} duplicate record(s), ${counts.unresolvedStockists} unresolved stockist id(s) (--strict)`);

  // score + rank
  const brands = rankAll([...byId.values()]);

  // write
  const envelope = {
    schemaVersion: SCHEMA_VERSION,
    methodologyVersion: METHODOLOGY_VERSION,
    generatedAt: now.toISOString(),
    generator: { name: 'generate-brands.mjs' },
    weights: WEIGHTS,
    counts: { total: brands.length, curated: counts.curated, ingested: counts.ingested },
    count: brands.length,
    brands,
  };
  const outPath = resolve(opts.out);
  mkdirSync(dirname(outPath), { recursive: true });
  const body =
    opts.format === 'ndjson'
      ? brands.map((b) => JSON.stringify(b)).join('\n') + '\n'
      : JSON.stringify(envelope, null, opts.pretty ? 2 : undefined) + '\n';
  writeFileSync(outPath, body);

  // report
  const scoresSorted = brands.map((b) => b.composite).sort((a, b) => a - b);
  const pct = (p) => scoresSorted[Math.min(scoresSorted.length - 1, Math.floor(p * scoresSorted.length))];
  log('');
  log(`✔ wrote ${brands.length} brands → ${opts.out} (${(Buffer.byteLength(body) / 1024).toFixed(0)} KB, ${opts.format})`);
  log(`  curated ${counts.curated} · ingested ${counts.ingested} · rejected ${counts.rejected} · duplicates skipped ${counts.duplicates}`);
  const byCat = {};
  for (const b of brands) byCat[b.category] = (byCat[b.category] ?? 0) + 1;
  log(`  by discipline: ${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(' · ')}`);
  log(`  stockists: ${Object.entries(stockistCounts).map(([r, n]) => `${r} ${n}`).join(' · ')}`);
  log(`  composite p10 ${pct(0.1)} · median ${pct(0.5)} · p90 ${pct(0.9)} · max ${scoresSorted.at(-1)}`);
  log(`  top 5: ${brands.slice(0, 5).map((b) => `${b.rank}. ${b.name} (${b.composite})`).join(' · ')}`);
  log(`  done in ${(performance.now() - t0).toFixed(0)} ms`);
}

main();
