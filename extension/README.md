# Menswear Index — browser extension

Shows each brand's Menswear Index score, tier and a breakdown next to its name on **Yoox, Farfetch, SSENSE, Grailed, Vinted and eBay**. Where a listing shows its RRP, the badge shows a **deal score** instead, which weighs the brand's score against the price.

- **Badge:** a score tile (coloured by band, as on the site) and the tier symbol. When the listing shows its RRP, the tile is the deal score and the badge adds **✓ Buy** (the discount meets the brand's buy-at threshold) or **Wait**. With no RRP, the tile is the index score and there's no verdict.
- **Tooltip (hover or focus):** rank, tier, the deal score (when there is one), the index score, all eight dimension scores, and the discount against the threshold.
- **Click:** opens the brand's dossier on the site in a new tab, without following the product link.

## Best brands on a page

Open the popup on any supported listings page:

- **On this page** ranks every recognised brand on the page, best first: by its best deal score where one of its listings shows an RRP, otherwise by index score. Each row shows that score, rank, tier, how many listings it has here, and how many of those are a ✓ Buy. The list refreshes while the popup is open, so brands loaded by infinite scroll appear too.
- **Click a brand** to scroll to its listings and flash them.
- **Spotlight** (Off / 70+ / 75+ / 80+) outlines every listing whose score (deal score if it has one, otherwise index score) is at or above that level, on this page and as more load. It's a setting, so it stays on across pages and sites. It outlines the good listings rather than dimming the rest, because an unrecognised brand isn't necessarily a bad one.

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

**Deal score.** The index score adjusted for the price paid:

```
deal score = index score + (discount − buy-at threshold) ÷ 0.9      (clamped to 0–100)
```

The 0.9 comes from the buy-at formula, which lowers the threshold by 0.9 discount points for each index point. So the extension reuses the index's own exchange rate between quality and discount rather than adding a new one. At exactly the threshold, the deal score equals the index score. Each point of discount past it adds about 1.1, and each point short of it takes about 1.1 away. For example, Gucci (index 72.2, buy at 55%) at €40 instead of €520 is 92% off and scores 100. Uniqlo (index 67.0, buy at 40%) scores 67.0 at 40% off and 22.6 at full price. A brand with a high Value score has a lower threshold, so its full price already counts as fairer.

**Reading the RRP.** The extension never guesses an RRP; a listing without one keeps the index score. It reads a price as the RRP only when:
- it's struck through, whether by `<s>`/`<del>` markup, a CSS line-through, or a class name such as `line-through` or `old-price`;
- the page labels it in words: "RRP", "Was", "Reference price" (Yoox), "Original price", "Retail price", "List price", "Regular price", "Compare at", "UVP" or "statt". The label must be in the same element, just before it, or in a small block holding no other price. Label words and a trailing "(-84%)" are ignored when reading a price, so "NOW £ 46" reads as £46; or
- the site is a full-price retailer verified on its real markup (currently SSENSE only), and the card shows exactly one price. That price is the RRP, so the listing is 0% off. Two different unstruck prices could be a sale it failed to read, so they count as unknown.

Resale listings (Vinted, Grailed, most of eBay) have no RRP. Estimating one would mean inventing what each brand's item costs new, so they get no deal score.

**Provisional brands** (placeholder scores) are hidden by default; switch them on in the popup.

## Before publishing

- **Set the site address.** The default is `https://menswear-index.pages.dev`, from the README's deploy command. If your Pages project has another address, change `DEFAULTS.endpoint` in `src/background.js`, `src/popup.js` and `DEFAULT_SITE` in `src/content.js`. Users can also change it in the popup.
- **CORS.** `public/_headers` serves `/extension.json` with `Access-Control-Allow-Origin: *`, which lets the extension fetch it with no host permissions.
- **Test status (October 2026):**
  - Vinted, live: one badge per listing.
  - SSENSE, on its real page markup: 46 of 46 cards badged; all 9 sale items got the correct verdict and deal score, and full-price items scored as 0% off.
  - eBay, Yoox and Farfetch block automated browsers, so they were tested on mocked grids served at their real addresses. Their selectors are best-effort until checked on the live sites.
  - Grailed renders listings in the browser, so its markup couldn't be captured; it relies on the generic matching.
  - Firefox is untested.
- **Store listing.** Chrome Web Store and Firefox Add-ons require zipping the build folders and writing a privacy note. The extension collects nothing and sends nothing; it only downloads `extension.json`.
