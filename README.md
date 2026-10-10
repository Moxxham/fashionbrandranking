# The Menswear Index

A ranking of menswear brands on eight weighted dimensions. It is built as a fully static React app: Vite, Tailwind CSS v4 and Lucide icons, with no server runtime. It deploys to Cloudflare Pages as plain files.

- **Methodology** (taxonomy, tiers, weights, formula, schema): [`METHODOLOGY.md`](METHODOLOGY.md)
- **Application** (single file): [`src/App.tsx`](src/App.tsx)
- **Dataset builder** (zero-dependency Node CLI): [`scripts/generate-brands.mjs`](scripts/generate-brands.mjs)
- **JSON Schema:** [`docs/brand.schema.json`](docs/brand.schema.json)

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # type-check + static build → dist/
npm run preview      # serve dist/ locally
```

## Deploy to Cloudflare Pages

| Setting | Value |
|---|---|
| Framework preset | Vite (or None) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | 20.19+ — set `NODE_VERSION=22` in the Pages environment variables |

Or deploy straight from the CLI:

```bash
npm run build
npx wrangler pages deploy dist --project-name menswear-index
```

`public/_headers` is copied into `dist/`. It caches the hashed `/assets/*` immutably and gives `brands.json` a short cache with `stale-while-revalidate`. The app needs no SPA fallback rule, because deep links use the hash (`/#brand/edward-green`).

## Data

At runtime the app fetches `/brands.json`. If the fetch fails or the file is invalid, it falls back to the 53 curated brands embedded in `App.tsx`, and the masthead shows which source is live. External records are sanitised: invalid entries are dropped without breaking the page.

```bash
npm run data:generate                      # all real brands → public/brands.json (--strict)

node scripts/generate-brands.mjs --help
node scripts/generate-brands.mjs --pretty --date 2026-10-04
node scripts/generate-brands.mjs --input my-brands.ndjson --strict
node scripts/generate-brands.mjs --format ndjson --out dist-data/brands.ndjson
```

**Every record is a real brand.** There is no synthetic or placeholder generation. Both the generator and the app reject any record marked `provenance: "generated"`. The catalogue currently holds **2,203 brands**; the app was designed and tested for 2,000+. It grows by adding rows to `scripts/roster.mjs` or by ingesting files.

The pipeline combines three record sources, attaches stockist flags, and validates and scores records in batches (`--batch`, default 100):

1. **Curated seed:** 53 detailed records. These are parsed from the `/* @seed:begin */ … /* @seed:end */` JSON block in `App.tsx`, so the app's fallback and the dataset never diverge. The block must stay strict JSON.
2. **Curated roster:** 2,150 more real brands, stored as compact editorial rows in [`scripts/roster.mjs`](scripts/roster.mjs). Where a founding year or city isn't confidently known it is `null`, never guessed. Lesser-documented brands carry confidence 0.70–0.75 so their composites are shrunk toward the prior. A duplicate brand is skipped with a warning, and `--strict` fails the build on any duplicate. 137 rows are provisional: labels on TK Maxx UK's own men's brand list with too little public information to assess. They carry origin `ZZ` ("Origin unknown"), a flat placeholder score profile and the minimum confidence of 0.5, so their composites sit near the prior, and their summaries say so.
3. **Ingestion** (`--input`, repeatable): a JSON array, a dataset envelope, or NDJSON. Records are coerced (names → slugs, country codes → names, string signatures → objects), validated and reported. An ingested record overrides an existing record with the same `id`. See `docs/example-input.ndjson`.
4. **Stockists:** [`scripts/stockists.mjs`](scripts/stockists.mjs) maps retailers to brand ids, for example the 528 brands flagged "Often at TK Maxx" (353 confirmed from the store's own men's brand list, 175 editorial). The generator attaches them as `stockists` after all sources merge, and `--strict` fails on an id that doesn't resolve. The app's "Often at TK Maxx" filter and the dossier's stockist link read from this field. The dossier's buy-at discount is derived from scores (METHODOLOGY.md §2.4).

Pass `--date` to make the output byte-for-byte reproducible.

## Logos

Each brand on the ranking shows its logo where one exists, and a generated monogram otherwise. Logos are self-hosted in `public/logos/`, so visitors never call a third party.

- **Add or replace one by hand:** save the file as `public/logos/<brand-id>.svg` (or `.png`, `.webp`, `.jpg`) and run `npm run data:generate`. The brand id is the slug in its deep link, e.g. `/#brand/edward-green` → `edward-green.svg`. An SVG wins over a bitmap with the same id, and a file whose name matches no brand is reported.
- **Fetch automatically:** official websites live in [`scripts/websites.mjs`](scripts/websites.mjs). `node scripts/fetch-logos.mjs` downloads each brand's 128px icon via Google's favicon service. It first checks that the homepage title names the brand (a wrong domain would mean a wrong logo) and skips icons under 28px. It never overwrites existing files, and ids in `NO_LOGO` are skipped because their icon was wrong. Use `--only id,id` to target brands.
- Logos are trademarks of their owners and appear only to identify each brand.

## Performance notes

- One `useMemo` pass handles search, facet counts and filtering over the whole catalogue. `useDeferredValue` keeps typing responsive.
- **Fuzzy search:** prefix and word matching, bounded Damerau-Levenshtein for typos ("andersen shepard" → Anderson & Sheppard), subsequence matching, diacritic folding, and AND semantics across query tokens.
- **Leaderboard:** window-virtualised with fixed 64 px rows and revealed 25 at a time, so only about 20 DOM rows exist however large the catalogue grows (tested at 2,000).
- Bookmarks, the personal tier list (S/A/B/C) and hidden disciplines live in `localStorage`, sync across tabs, and fail safe when storage is unavailable. Hiding a discipline removes its brands from the ranking on this device only; ranks keep their catalogue-wide numbers.
