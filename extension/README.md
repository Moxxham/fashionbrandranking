# Menswear Index — browser extension

Shows each brand's Menswear Index score, tier and a breakdown next to its name on **Yoox, Farfetch, SSENSE, Grailed, Vinted and eBay**. Where a listing shows both an RRP and a sale price, the badge adds a buy-at verdict.

- **Badge:** the score tile (coloured by band, as on the site) and the tier symbol. When the page shows a struck-through RRP, it adds **✓ Buy** (the discount meets the brand's buy-at threshold) or **Wait**.
- **Tooltip (hover or focus):** rank, band, tier, all eight dimension scores, and the discount against the threshold.
- **Click:** opens the brand's dossier on the site in a new tab, without following the product link.

## Build and install

```bash
npm run data:generate      # writes public/brands.json and public/extension.json
npm run extension:build    # writes extension/dist/chrome and extension/dist/firefox
```

- **Chrome / Edge / Brave:** open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and pick `extension/dist/chrome`.
- **Firefox (121+):** open `about:debugging` → This Firefox → **Load Temporary Add-on**, and pick `extension/dist/firefox/manifest.json`. Firefox asks you to allow the extension on each site the first time.

## How it works

| Part | File | What it does |
|---|---|---|
| Data | `public/extension.json` | Compact lookup (about 200 KB) written by the generator: id, name, aliases, score, rank, tier, buy-at threshold, eight dimension scores, discipline, provisional flag |
| Sync | `src/background.js` | Seeds from the copy bundled at build time, then refreshes daily from `<site>/extension.json` (a static file on Cloudflare Pages, so nothing to run or pay for). "Sync now" is in the popup |
| Overlay | `src/content.js` | Matches brand names, injects badges in shadow DOM so site CSS can't affect them, and watches for infinite-scroll cards with a MutationObserver |
| Settings | `src/popup.html` | Data status, Sync now, per-site switches, provisional brands on/off, and the site address |

**Matching.** Names are folded (case, accents, apostrophes, full stops, "&"/"and") and checked against catalogue names plus aliases from `scripts/aliases.mjs`. A card's brand is read, in order of reliability, from:
1. Brand-label elements (`itemprop="brand"`, brand/designer test ids and classes, and per-site selectors)
2. The product's structured data (JSON-LD)
3. A "Brand: …" title attribute
4. A short text in the card that exactly equals a brand name
5. The start of a listing title (eBay)

Brand names that are everyday words ("Next", "On", "Gap", "Closed", …) are matched only where the page labels the text as a brand, never by scanning titles.

**Buy-at verdict.** The extension never guesses an RRP. It reads a price as the RRP only if it's struck through, whether by `<s>`/`<del>` markup, a CSS line-through, or a class name such as `line-through` or `old-price`. With no RRP on the page (resale sites), the tooltip shows the threshold instead.

**Provisional brands** (placeholder scores) are hidden by default; switch them on in the popup.

## Before publishing

- **Set the site address.** The default is `https://menswear-index.pages.dev`, from the README's deploy command. If your Pages project has another address, change `DEFAULTS.endpoint` in `src/background.js`, `src/popup.js` and `DEFAULT_SITE` in `src/content.js`. Users can also change it in the popup.
- **CORS.** `public/_headers` serves `/extension.json` with `Access-Control-Allow-Origin: *`, which lets the extension fetch it with no host permissions.
- **Test status (October 2026):**
  - Vinted, live: one badge per listing.
  - SSENSE, on its real page markup: 46 of 46 cards badged, and all 9 sale items got the correct verdict.
  - eBay, Yoox and Farfetch block automated browsers, so they were tested on mocked grids served at their real addresses. Their selectors are best-effort until checked on the live sites.
  - Grailed renders listings in the browser, so its markup couldn't be captured; it relies on the generic matching.
  - Firefox is untested.
- **Store listing.** Chrome Web Store and Firefox Add-ons require zipping the build folders and writing a privacy note. The extension collects nothing and sends nothing; it only downloads `extension.json`.
