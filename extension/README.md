# Menswear Index — browser extension

Shows each brand's Menswear Index score, tier and a breakdown next to its name on **Yoox, Farfetch, SSENSE, Grailed, Vinted and eBay**. Where a listing shows its RRP, the badge shows a **deal score** instead, which weighs the brand's score against the price.

- **Badge:** a score tile (coloured by band, as on the site) and the tier symbol. When the listing shows its RRP, the tile is the deal score and the badge adds **✓ Buy** (the discount meets the brand's buy-at threshold) or **Wait**. With no RRP, the tile is the index score and there's no verdict.
- **Tooltip (hover or focus):** rank, tier, the deal score (when there is one), the index score, all eight dimension scores, and the discount against the threshold.
- **Click:** opens the brand's dossier on the site in a new tab, without following the product link.

## Best brands on a page

Open the popup on any supported listings page:

- **On this page** ranks every recognised brand on the page, best first: by its best deal score where one of its listings shows an RRP, otherwise by index score. Each row shows that score, rank, tier, how many listings it has here, and how many of those are a ✓ Buy. The list refreshes while the popup is open, so brands loaded by infinite scroll appear too.
- **Showing tick.** Each brand has a filled ✓ while at least one of its listings is still on screen. When all of them are hidden, whether by the score filter, the site's own filters or another extension, the row is greyed out with a hollow circle and moves to the bottom. A brand that's only partly hidden reads "2 of 6 showing". The header counts what's showing too.
- **Click a brand** to scroll to its listings that are still showing, and flash them.
- **Hide listings scoring below** is a slider from Off to 85. It hides every listing whose score (deal score if it has one, otherwise index score) is below the level, including listings that load as you scroll. On Vinted it hides the whole grid cell, so the grid closes up, and you can also tick **Also hide brands not in the index**. The filter is kept only in the page's memory: reloading the page or closing the tab shows everything again.
- **Sort this page by score** moves the best-scoring listings to the top of the grid, with unrecognised brands last. It uses the CSS `order` property, so the site's markup is untouched; it works where listings sit in a flex or grid container (Vinted) and does nothing elsewhere. Like the filter, it lasts until the page reloads.
- **Spotlight** (Off / 70+ / 75+ / 80+) outlines every listing whose score (deal score if it has one, otherwise index score) is at or above that level, on this page and as more load. It's a setting, so it stays on across pages and sites. It outlines the good listings rather than dimming the rest, because an unrecognised brand isn't necessarily a bad one.

## Scan several pages (Vinted)

On a Vinted search or catalogue page, the popup's **Scan several pages** collects every listing from 3, 5, 10, 20 or 50 result pages, starting at the current one, and opens them in a results tab.

**How it reads the pages.** Two ways:
- **In the background (default).** It reads Vinted's catalogue API (`/api/v2/catalog/items`) from the page, with your session, using the same filters as the page's address (`catalog[]=…` becomes `catalog_ids=…` and so on). That's 96 listings per request, and the tab isn't touched. Requests are 0.8–1.5 s apart; after an HTTP 429 it waits 6 s and tries once more. Before using the API it checks the first page against the grid on screen. If under a quarter of the listings on screen are in the API's page, it doesn't trust the API's filters and switches to clicking.
- **Clicking the page buttons in the tab.** This is used if the API fails or disagrees, or if you tick the box. It reads the grid, finds the next-page control (a link to page N+1, a "next" button, or failing those, the address with `page=N+1`), clicks it, waits for a new grid, and repeats. A full page load restarts the content script, so the run is kept in the tab's `sessionStorage` and picks up after each load. Leave the tab open while it runs.

Either way it stops at the page count, at the last page (a page with nothing new), at 6,000 listings, or when you press Stop (in the popup or the results tab). Results are kept in `storage.local` (`mi-agg`) until the next scan replaces them.

**The results tab** (`src/results.html`) updates live while the scan runs. Its views:
- **Listings:** every listing as a card with photo, index score, tier, price, size, condition and favourites. Sort by score, price, how far below the brand's median it is, favourites, or page order.
- **Brands:** one row per brand: score, rank, tier, listings, cheapest, median price and steals. Click a row to see that brand's listings.
- **Steals:** listings at least 35% below the median price of the same brand in this scan, counting only brands with 4+ priced listings. Resale listings have no RRP, so this compares like with like: the same brand, in the same search. A low price can also mean a different kind of item, so check the photos. The thresholds are `STEAL_BELOW` and `STEAL_MIN_LISTINGS` in `src/results.js`.
- **Saved:** listings you've starred. They're kept across scans (`mi-saved`).

Filters (in every view except Saved): minimum score (any minimum hides brands not in the index), price range, title or brand search, only brands in the index, only brands with 3+ listings here, tier, size and condition. **Hide brand** on a card hides that brand everywhere in the results until you show it again (`mi-muted`). **Export CSV** writes the current view.

**Tested (November 2026)** against a mock Vinted served at `https://www.vinted.co.uk` in Edge, covering the API path, clicking with full page loads, clicking with client-side navigation, asking for more pages than exist, and Stop. The API parameters and page-button selectors follow Vinted's known markup, but they haven't been checked on the live site yet.

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
| Settings | `src/popup.html` | Brands on this page, filter, sort, spotlight, scan several pages, data status, Sync now, per-site switches, provisional brands on/off, and the site address |
| Results | `src/results.html` | The listings from a multi-page scan: Listings, Brands, Steals and Saved views, filters, CSV export |

**Matching.** Names are folded (case, accents, apostrophes, full stops, "&"/"and") and checked against catalogue names plus aliases from `scripts/aliases.mjs`. A card's brand is read, in order of reliability, from:
1. Brand-label elements (`itemprop="brand"`, brand/designer test ids and classes, and per-site selectors)
2. The product's structured data (JSON-LD)
3. A "Brand: …" title attribute
4. A short text in the card that exactly equals a brand name
5. The start of a listing title (eBay)

Brand names that are everyday words ("Next", "On", "Gap", "Closed", …) are matched only where the page labels the text as a brand, never by scanning titles.

**Deal score.** The index score adjusted for the price paid, weighted towards the brand:

```
price-adjusted = index score + (discount − buy-at threshold) ÷ 0.9
deal score     = average of index score and price-adjusted score,
                 at most 15 above the index score, clamped to 0–100
```

The 0.9 comes from the buy-at formula, which lowers the threshold by 0.9 discount points for each index point. So the extension reuses the index's own exchange rate between quality and discount rather than adding a new one.

RRPs are often inflated, especially at outlets, so the deal score leans on the brand. Averaging halves the price's pull: each point of discount past the threshold adds about 0.55, and each point short of it takes about 0.55 away. A discount can add at most 15 points, so a headline "−85%" can't carry a middling brand into the top bands. At exactly the threshold, the deal score equals the index score.

Examples:
- Gucci (index 72.2, buy at 55%) at €40 instead of €520 is 92% off. It scores 87.2, which is the full +15.
- Buscemi (index 61.8, buy at 65%) at £46 from a £298 "reference price" scores 72.9.
- Uniqlo (index 67.0, buy at 40%) scores 67.0 at 40% off and 44.8 at full price.

A brand with a high Value score has a lower threshold, so its full price already counts as fairer. The weight and the cap are `DEAL_WEIGHT` and `DEAL_MAX_GAIN` in `src/content.js`.

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
