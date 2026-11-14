/* Menswear Index — marketplace overlay (content script).
 *
 * Finds brand names on product grids and listings, and injects a badge with
 * the brand's index score, tier and a breakdown tooltip. Where the page shows
 * both an RRP and a sale price, the badge shows a deal score instead: the
 * index score adjusted for the discount against the brand's buy-at threshold. Badges render in shadow DOM so site CSS can't reach them;
 * a MutationObserver picks up cards added by infinite scroll. From the popup, listings scoring
 * below a chosen level can be hidden until the page reloads.
 */
(() => {
  'use strict';
  if (window.__menswearIndex) return;
  window.__menswearIndex = true;

  const api = globalThis.browser ?? globalThis.chrome;
  const DATA_KEY = 'mi-data';
  const SETTINGS_KEY = 'mi-settings';
  const DEFAULT_SITE = 'https://menswear-index.pages.dev';
  const DIM_LABELS = {
    material: 'Material',
    construction: 'Construction',
    design: 'Design',
    longevity: 'Longevity',
    value: 'Value',
    reputation: 'Reputation',
    consistency: 'Consistency',
    transparency: 'Transparency',
  };
  const TIERS = {
    atelier: ['Atelier', '$$$$$'],
    luxury: ['Luxury', '$$$$'],
    premium: ['Premium', '$$$'],
    accessible: ['Accessible', '$$'],
    mainstream: ['Mainstream', '$'],
  };
  // same bands and colours as the site
  const BANDS = [
    [80, 'Exceptional', '#173c70', '#fff'],
    [75, 'Excellent', '#3963a1', '#fff'],
    [70, 'Strong', '#b5cde7', '#161514'],
    [65, 'Solid', '#dcd9d3', '#161514'],
    [60, 'Fair', '#e7c0bc', '#161514'],
    [55, 'Weak', '#a74541', '#fff'],
    [0, 'Poor', '#722426', '#fff'],
  ];
  const band = (v) => BANDS.find((b) => v >= b[0]);
  const fmt = (v) => (v >= 100 ? '100' : v.toFixed(1));

  // Deal score: the index score adjusted for the price paid, only where the page shows the RRP.
  // The buy-at formula moves the threshold 0.9 discount points per index point, so the
  // price-adjusted score is index + (discount - threshold) / 0.9. RRPs are often inflated, so
  // the deal score is weighted towards the brand: it averages the index score with that
  // price-adjusted score (so the price moves it half as far either way), and a discount can add
  // at most DEAL_MAX_GAIN. At exactly the threshold the deal score equals the index score.
  const DEAL_RATE = 0.9;
  const DEAL_WEIGHT = 0.5;
  const DEAL_MAX_GAIN = 15;
  const dealGain = (brand, discount) => (DEAL_WEIGHT * (discount - brand.buyAt)) / DEAL_RATE;
  const dealScore = (brand, discount) =>
    discount == null
      ? null
      : Math.round(Math.max(0, Math.min(100, brand.composite + Math.min(DEAL_MAX_GAIN, dealGain(brand, discount)))) * 10) / 10;
  // the score a listing is judged by: its deal score where there is one, else the brand's index score
  const mainScore = (brand, discount) => dealScore(brand, discount) ?? brand.composite;

  /* ------------------------------------------------------------------ */
  /* Sites                                                               */
  /* ------------------------------------------------------------------ */

  // Brand-label elements common across retailers (exact-match only).
  const GENERIC_LABEL =
    '[itemprop="brand"],[data-testid*="brand" i],[data-test*="brand" i],[class*="brandName" i],[class*="brand-name" i],[class*="designerName" i],[class*="designer-name" i]';

  /**
   * label: elements whose whole text is a brand name.
   * card:  product cards; the brand is read from structured data, a "Brand:" title
   *        attribute, an exact-text leaf, or the start of a listing title.
   * title: listing-title elements whose text starts with the brand (eBay).
   * fullPrice: the site sells new at retail, so a lone unstruck price is the RRP (0% off).
   *        Only where verified on real markup; resale sites never qualify.
   * item:  the grid cell around each listing, hidden whole by the score filter so the grid closes
   *        up. Only where verified on real markup; elsewhere the filter hides the card itself.
   */
  const SITES = [
    { id: 'vinted', name: 'Vinted', host: /(^|\.)vinted\.[a-z.]+$/, label: '[data-testid$="--description-title"]', card: null, title: null, item: '[data-testid="grid-item"]' },
    { id: 'ssense', name: 'SSENSE', host: /(^|\.)ssense\.com$/, label: '', card: 'a[href*="/product/"]', title: null, fullPrice: true },
    { id: 'grailed', name: 'Grailed', host: /(^|\.)grailed\.com$/, label: '[class*="designer" i]', card: 'a[href*="/listings/"]', title: null },
    { id: 'farfetch', name: 'Farfetch', host: /(^|\.)farfetch\.com$/, label: '[data-component="ProductCardBrandName"],[data-component="ProductBrand"]', card: 'a[href*="/shopping/"]', title: null },
    { id: 'yoox', name: 'Yoox', host: /(^|\.)yoox\.com$/, label: '[class*="brand" i]', card: 'a[href*="/item"]', title: null },
    {
      id: 'ebay',
      name: 'eBay',
      host: /(^|\.)ebay\.[a-z.]+$/,
      label: '',
      card: 'li.s-item, li.s-card, .s-item, .s-card',
      title: '.s-item__title, .s-card__title, .x-item-title__mainTitle, h1.x-item-title',
    },
  ];
  const site = SITES.find((s) => s.host.test(location.hostname));
  if (!site) return;

  /* ------------------------------------------------------------------ */
  /* Matching                                                            */
  /* ------------------------------------------------------------------ */

  const fold = (s) =>
    String(s)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/['’`.]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  // Brand names that are also everyday words: matched only where the page labels
  // the text as a brand, never by scanning card text or listing titles.
  const COMMON = new Set(
    'on next gap head hope folk lee arena element elements baker money industry spin noir reason valor faded malibu helium hera apollo curated cos mango market wilson rebel legends closed frame closure sunflower blend hunter champion express theory crew vince coach guess bench animal patrick rhythm insight former quasi hockey hype luke mida berna premise fawn reserved'.split(
      ' ',
    ),
  );

  let index = new Map(); // folded name/alias -> brand
  let settings = { enabled: true, showProvisional: false, sites: {}, endpoint: DEFAULT_SITE, spotlight: 0 };
  let total = 0;
  let maxKeyWords = 1;

  function buildIndex(data) {
    const map = new Map();
    total = data.brands.length;
    const dims = data.dimensions;
    maxKeyWords = 1;
    for (const row of data.brands) {
      const [id, name, aliases, composite, rank, tier, buyAt, scores, category, provisional] = row;
      if (provisional && !settings.showProvisional) continue;
      const brand = { id, name, composite, rank, tier, buyAt, scores: Object.fromEntries(dims.map((d, i) => [d, scores[i]])), category, provisional: !!provisional };
      const keys = [name, ...aliases].map(fold).filter(Boolean);
      keys.forEach((k, i) => {
        // a brand's own name beats another brand's alias; otherwise the higher-ranked brand keeps the key
        const prev = map.get(k);
        if (!prev || (i === 0 && !prev.own) || (prev.own === (i === 0) && prev.brand.rank > rank)) map.set(k, { brand, own: i === 0 });
        maxKeyWords = Math.max(maxKeyWords, k.split(' ').length);
      });
    }
    index = map;
  }

  const lookup = (text, { allowCommon }) => {
    const k = fold(text);
    if (!k || k.length > 60) return null;
    const hit = index.get(k);
    if (!hit) return null;
    if (!allowCommon && (COMMON.has(k) || k.length < 3)) return null;
    return hit.brand;
  };

  /** Longest brand name the text starts with ("Barbour Bedale wax jacket" -> Barbour). */
  function lookupPrefix(text) {
    const words = fold(text).split(' ').slice(0, maxKeyWords);
    for (let n = words.length; n > 0; n--) {
      const k = words.slice(0, n).join(' ');
      const hit = index.get(k);
      if (hit && !COMMON.has(k) && k.length >= 3) return hit.brand;
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Prices                                                              */
  /* ------------------------------------------------------------------ */

  // a short text that is a number with a currency marker, allowing a few stray characters around it
  const PRICE_RE = /^[^\d]{0,5}\d[\d.,\s]*[^\d]{0,5}$/;
  const CURRENCY_RE = /[£$€¥]|\b(?:usd|gbp|eur|chf|sek|dkk|nok|pln|zł|kr|kč|ft|lei)\b/i;
  // words a price may carry in the same element ("NOW £ 46", "RRP £298", "£ 298 (-84%)"), stripped before reading it
  const PRICE_WORDS = /^(?:now|sale price|sale|our price|price|rrp|was|reference price|ref\.? price|original price|retail price|list price|regular price|uvp|statt)\s*:?\s*/i;
  const PRICE_PCT = /\s*\(?\s*[-−–]\s*\d{1,2}\s*%\s*\)?\s*$/;
  const cleanPrice = (t) => t.trim().replace(PRICE_WORDS, '').replace(PRICE_PCT, '');
  const looksLikePrice = (t) => PRICE_RE.test(t) && CURRENCY_RE.test(t);
  const isLeaf = (el) => el.childElementCount === 0;
  // a price the page calls the RRP in words, without striking it through (Yoox: "Reference price £ 298")
  const RRP_LABEL = /\b(?:rrp|was|reference price|ref\.? price|original price|retail price|list price|regular price|compare at|uvp|statt)\b/i;
  const PRICE_COUNT = /[£$€¥]\s?\d|\d[\d.,]*\s?(?:€|kr|zł|eur|usd|gbp)\b/gi;
  function labelledRrp(el) {
    if (RRP_LABEL.test(el.textContent)) return true;
    for (let n = el, d = 0; n && d < 3; n = n.parentElement, d++) {
      // a label just before the price, or before the block holding it
      const prev = n.previousElementSibling;
      if (prev && prev.textContent.length <= 30 && !/\d/.test(prev.textContent) && RRP_LABEL.test(prev.textContent)) return true;
      // a small block holding this price and its label, and no other price
      if (d > 0 && n.textContent.length <= 40 && (n.textContent.match(PRICE_COUNT) || []).length === 1 && RRP_LABEL.test(n.textContent)) return true;
    }
    return false;
  }

  function parseAmount(text) {
    let t = text.replace(/[^\d.,]/g, '');
    if (!t) return NaN;
    const lastComma = t.lastIndexOf(',');
    const lastDot = t.lastIndexOf('.');
    if (lastComma > lastDot) t = t.replace(/\./g, '').replace(',', '.'); // 1.234,56
    else t = t.replace(/,/g, ''); // 1,234.56
    return parseFloat(t);
  }

  // an RRP is struck through by markup, by computed style, or by a class name that says so
  const WAS_CLASS = /line-?through|strike|old-?price|was-?price|original-?price|price-?before|retail-?price/i;
  const struck = (el) =>
    !!el.closest('s, del, strike') ||
    /line-through/.test(getComputedStyle(el).textDecorationLine || '') ||
    [el, el.parentElement].some((n) => n && WAS_CLASS.test(`${n.className || ''} ${n.getAttribute?.('data-test') || ''} ${n.getAttribute?.('data-testid') || ''}`));

  /**
   * Discount (%) when the card shows an RRP (struck through, or labelled "RRP", "Was",
   * "Reference price" and so on) and a lower current price. On a
   * full-price retailer, a single unstruck price is the RRP itself, so 0. Otherwise null.
   */
  function readDiscount(from) {
    let node = from;
    for (let depth = 0; depth < 7 && node && node !== document.body; depth++, node = node.parentElement) {
      const prices = [...node.querySelectorAll('span, div, p, s, del, strong, b, ins, mark, em')]
        .filter((el) => isLeaf(el) && el.textContent.trim().length <= 32 && looksLikePrice(cleanPrice(el.textContent)))
        .map((el) => ({ el, value: parseAmount(cleanPrice(el.textContent)), was: struck(el) || labelledRrp(el) }))
        .filter((p) => p.value > 0);
      if (!prices.length) continue;
      const was = prices.filter((p) => p.was).map((p) => p.value);
      const now = prices.filter((p) => !p.was).map((p) => p.value);
      if (!now.length) return null;
      // one price and nothing struck through: full price on a retailer, unknown anywhere else
      // (two different unstruck prices could be a sale we failed to read, so they stay unknown)
      if (!was.length) return site.fullPrice && new Set(now).size === 1 ? 0 : null;
      const rrp = Math.max(...was);
      const cur = Math.min(...now);
      if (!(cur < rrp)) return null;
      return Math.round((1 - cur / rrp) * 100);
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* UI                                                                  */
  /* ------------------------------------------------------------------ */

  const siteUrl = () => (settings.endpoint || DEFAULT_SITE).replace(/\/+$/, '');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const BADGE_CSS = `
    :host { all: initial; }
    button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 4px; height: 18px; padding: 0 5px 0 0;
      font: 600 10.5px/1 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #161514; background: #fbfaf7;
      border: 1px solid #b3ada1; border-radius: 2px; cursor: pointer; white-space: nowrap; letter-spacing: 0; }
    button:focus-visible { outline: 2px solid #161514; outline-offset: 1px; }
    .score { display: inline-flex; align-items: center; height: 100%; padding: 0 4px; font-variant-numeric: tabular-nums; }
    .tier { color: #5c5750; font-weight: 500; }
    .verdict { font-weight: 600; }
    .buy { color: #173c70; } .wait { color: #722426; }
    .prov { opacity: .6; }
  `;

  function makeBadge(brand, discount) {
    const host = document.createElement('span');
    host.className = 'mi-badge-host';
    host.style.cssText = 'all:initial;display:inline-block;vertical-align:middle;margin:0 0 0 6px;position:relative;z-index:2;line-height:0;';
    const root = host.attachShadow({ mode: 'open' });
    // with a known RRP the tile shows the deal score and a verdict; without one, the index score alone
    const deal = dealScore(brand, discount);
    const shown = deal ?? brand.composite;
    const [, label, bg, fg] = band(shown);
    const verdict = deal == null ? '' : discount >= brand.buyAt ? '<span class="verdict buy">✓ Buy</span>' : '<span class="verdict wait">Wait</span>';
    const aria =
      deal == null
        ? `${esc(brand.name)} scores ${fmt(shown)}, ${label}`
        : `deal score ${fmt(deal)} for ${esc(brand.name)} at ${discount}% off; index score ${brand.composite.toFixed(1)}`;
    root.innerHTML = `<style>${BADGE_CSS}</style><button type="button" class="${brand.provisional ? 'prov' : ''}" aria-label="Menswear Index: ${aria}">
      <span class="score" style="background:${bg};color:${fg}">${fmt(shown)}</span><span class="tier">${TIERS[brand.tier][1]}</span>${verdict}</button>`;
    const btn = root.querySelector('button');
    const show = () => tooltip.show(btn, brand, discount);
    btn.addEventListener('mouseenter', show);
    btn.addEventListener('focus', show);
    btn.addEventListener('mouseleave', () => tooltip.hide());
    btn.addEventListener('blur', () => tooltip.hide());
    // badges sit inside product links: don't follow them, open the dossier instead
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(`${siteUrl()}/#brand/${encodeURIComponent(brand.id)}`, '_blank', 'noopener');
    });
    for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart']) btn.addEventListener(t, (e) => e.stopPropagation());
    return host;
  }

  /** One shared tooltip on <body>, so card overflow:hidden can't clip it. */
  const tooltip = (() => {
    let host, root, box, hideTimer;
    const css = `
      :host { all: initial; }
      .tip { position: fixed; z-index: 2147483647; width: 264px; padding: 12px 14px; background: #fbfaf7; color: #161514; border: 1px solid #161514;
        box-shadow: 0 8px 24px rgba(0,0,0,.18); font: 12px/1.4 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; pointer-events: none; }
      .name { font-size: 14px; font-weight: 600; margin: 0 0 2px; }
      .meta { color: #5c5750; font-size: 11px; margin: 0 0 8px; }
      .head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
      .head:has(+ .head) { margin-bottom: 6px; }
      .score { font-size: 15px; font-weight: 600; padding: 3px 6px; font-variant-numeric: tabular-nums; }
      .band { font-size: 11px; color: #5c5750; }
      .dims { display: grid; grid-template-columns: 82px 1fr 22px; gap: 3px 8px; align-items: center; font-size: 11px; }
      .bar { height: 4px; background: #dcd7cd; } .bar i { display: block; height: 100%; background: #3a3834; }
      .num { text-align: right; font-variant-numeric: tabular-nums; }
      .buy { margin-top: 10px; padding-top: 8px; border-top: 1px solid #dcd7cd; font-size: 11.5px; }
      .ok { color: #173c70; font-weight: 600; } .no { color: #722426; font-weight: 600; }
      .foot { margin-top: 8px; font-size: 10.5px; color: #5c5750; }
      .prov { margin-top: 6px; font-size: 10.5px; color: #722426; }
    `;
    function ensure() {
      if (host?.isConnected) return;
      host = document.createElement('div');
      host.style.cssText = 'all:initial;position:fixed;top:0;left:0;z-index:2147483647;';
      root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${css}</style><div class="tip" hidden></div>`;
      box = root.querySelector('.tip');
      document.body.appendChild(host);
    }
    function show(anchor, b, discount) {
      ensure();
      clearTimeout(hideTimer);
      const [, label, bg, fg] = band(b.composite);
      const [tierName, tierSym] = TIERS[b.tier];
      const ds = dealScore(b, discount);
      const dims = Object.keys(DIM_LABELS)
        .map((d) => `<span>${DIM_LABELS[d]}</span><span class="bar"><i style="width:${b.scores[d]}%"></i></span><span class="num">${b.scores[d]}</span>`)
        .join('');
      const off = discount >= b.buyAt ? `<span class="ok">✓ ${discount}% off</span>` : `<span class="no">${discount}% off</span>`;
      const gap =
        ds >= 100
          ? 'capped at 100'
          : discount != null && dealGain(b, discount) > DEAL_MAX_GAIN
            ? `${DEAL_MAX_GAIN} above the index score, the most a discount can add (RRPs are often inflated)`
            : `${Math.abs(ds - b.composite).toFixed(1)} ${ds >= b.composite ? 'above' : 'below'} the index score`;
      const deal =
        discount == null
          ? `No RRP on this listing, so no deal score. Buy at <b>${b.buyAt}%</b> off RRP or more.`
          : `${off} against a ${b.buyAt}% buy-at threshold, so the deal score is ${gap}.`;
      const dealHead =
        ds == null ? '' : `<div class="head"><span class="score" style="background:${band(ds)[2]};color:${band(ds)[3]}">${fmt(ds)}</span><span class="band">Deal score · ${band(ds)[1]}</span></div>`;
      box.innerHTML = `
        <p class="name">${esc(b.name)}</p>
        <p class="meta">Rank #${b.rank.toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')} · ${tierName} ${tierSym}</p>
        ${dealHead}<div class="head"><span class="score" style="background:${bg};color:${fg}">${b.composite.toFixed(1)}</span><span class="band">Index score · ${label}</span></div>
        <div class="dims">${dims}</div>
        <div class="buy">${deal}</div>
        ${b.provisional ? '<div class="prov">Provisional: too little public information to assess; scores are placeholders.</div>' : ''}
        <div class="foot">Click the badge for the full dossier · Menswear Index</div>`;
      box.hidden = false;
      const r = anchor.getBoundingClientRect();
      const w = 264;
      const h = box.offsetHeight;
      let left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
    }
    function hide() {
      hideTimer = setTimeout(() => box && (box.hidden = true), 60);
    }
    return { show, hide };
  })();

  /* ------------------------------------------------------------------ */
  /* Scanning                                                            */
  /* ------------------------------------------------------------------ */

  const DONE = 'data-mi-done';
  /** The product card around an element: the largest ancestor (up to 6 levels) that still links to a single product. */
  function containerOf(el) {
    let card = el;
    for (let n = el, d = 0; n && n !== document.body && d < 6; n = n.parentElement, d++) {
      const hrefs = new Set([...n.querySelectorAll('a[href]')].map((a) => a.getAttribute('href').split(/[?#]/)[0]));
      if (n.matches('a[href]')) hrefs.add(n.getAttribute('href').split(/[?#]/)[0]);
      // stop before an ancestor that holds a second product (distinct link, or a second card element)
      if (hrefs.size > 1 || (site.card && n.querySelectorAll(site.card).length > 1)) break;
      card = n;
    }
    return card;
  }
  const hasBadge = (el) => !!el?.querySelector?.('.mi-badge-host');

  function inject(anchor, brand) {
    if (anchor.hasAttribute(DONE)) return;
    anchor.setAttribute(DONE, '1');
    const card = containerOf(anchor);
    if (card && card !== document.body && hasBadge(card)) return;
    const discount = readDiscount(anchor);
    anchor.insertAdjacentElement('afterend', makeBadge(brand, discount));
    register(brand, card && card !== document.body ? card : anchor, discount);
  }

  /* ------------------------------------------------------------------ */
  /* Page summary & spotlight                                            */
  /* ------------------------------------------------------------------ */

  /** Every badged listing on the page, by brand: brand id -> { brand, listings: [{ card, discount }] }. */
  const registry = new Map();

  function register(brand, card, discount) {
    let entry = registry.get(brand.id);
    if (!entry) registry.set(brand.id, (entry = { brand, listings: [] }));
    entry.listings.push({ card, discount });
    spotlightCard(card, mainScore(brand, discount));
  }

  const SPOT = 'data-mi-spot';
  function spotlightCard(card, score) {
    const on = settings.spotlight > 0 && score >= settings.spotlight;
    if (on && !card.hasAttribute(SPOT)) {
      card.setAttribute(SPOT, card.style.outline || '');
      card.style.outline = '2px solid #173c70';
      card.style.outlineOffset = '3px';
    } else if (!on && card.hasAttribute(SPOT)) {
      card.style.outline = card.getAttribute(SPOT);
      card.style.outlineOffset = '';
      card.removeAttribute(SPOT);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Score filter                                                        */
  /* ------------------------------------------------------------------ */

  // Hides listings scoring below filter.min (and, where the site marks out each listing, listings of
  // brands not in the index). It lives in this page's memory only: reloading or closing the tab clears it.
  const filter = { min: 0, unrated: false };
  let filteredOut = 0;
  const HIDE = 'data-mi-hide';
  let hideStyle = null;

  const scanning = () => index.size > 0 && settings.enabled && settings.sites?.[site.id] !== false;

  /** The element to hide for a listing: its grid cell where known, else the card and any wrappers it fills alone. */
  function tileOf(card) {
    const cell = site.item && card.closest(site.item);
    if (cell) return cell;
    let t = card;
    for (let d = 0; d < 4 && t.parentElement && t.parentElement !== document.body && t.parentElement.childElementCount === 1; d++) t = t.parentElement;
    return t;
  }

  function applyFilter() {
    if (!hideStyle?.isConnected) {
      hideStyle = document.createElement('style');
      hideStyle.textContent = `[${HIDE}]{display:none!important}`;
      (document.head || document.documentElement).appendChild(hideStyle);
    }
    const hide = new Set();
    if (scanning()) {
      if (filter.min > 0)
        for (const { brand, listings } of registry.values())
          for (const l of listings) if (l.card.isConnected && mainScore(brand, l.discount) < filter.min) hide.add(tileOf(l.card));
      // a listing the page labels with a brand that isn't in the index
      if (filter.unrated && site.item && site.label)
        for (const cell of document.querySelectorAll(site.item)) if (!hasBadge(cell) && cell.querySelector(site.label)) hide.add(cell);
    }
    for (const el of document.querySelectorAll(`[${HIDE}]`)) if (!hide.has(el)) el.removeAttribute(HIDE);
    for (const el of hide) if (!el.hasAttribute(HIDE)) el.setAttribute(HIDE, '');
    filteredOut = hide.size;
  }

  /** Whether a listing is still on screen: not removed, and not hidden by this filter, the site, or another extension. */
  const visible = (card) =>
    card.isConnected && (typeof card.checkVisibility === 'function' ? card.checkVisibility({ visibilityProperty: true }) : card.getClientRects().length > 0);

  function summary() {
    const brands = [];
    let listings = 0;
    let shownListings = 0;
    for (const { brand, listings: all } of registry.values()) {
      const live = all.filter((l) => l.card.isConnected);
      if (!live.length) continue;
      listings += live.length;
      const shown = live.filter((l) => visible(l.card)).length;
      shownListings += shown;
      const discounts = live.map((l) => l.discount).filter((d) => d != null);
      brands.push({
        id: brand.id,
        name: brand.name,
        composite: brand.composite,
        rank: brand.rank,
        tier: brand.tier,
        buyAt: brand.buyAt,
        provisional: brand.provisional,
        count: live.length,
        shown,
        buys: discounts.filter((d) => d >= brand.buyAt).length,
        bestDiscount: discounts.length ? Math.max(...discounts) : null,
        // best deal score among its listings with a known RRP; the brand ranks by this where it has one
        bestDeal: discounts.length ? dealScore(brand, Math.max(...discounts)) : null,
      });
    }
    const main = (b) => b.bestDeal ?? b.composite;
    // brands still on screen first, then those whose listings are all hidden
    brands.sort((a, b) => (b.shown > 0) - (a.shown > 0) || main(b) - main(a) || b.composite - a.composite || b.count - a.count);
    return { site: site.name, brands, listings, shownListings, total, filter: { ...filter }, filteredOut, unratedFilter: !!(site.item && site.label) };
  }

  /** Scroll to a brand's first listing in screen order and flash all of its listings still on screen. */
  function reveal(id) {
    const entry = registry.get(id);
    const cards = entry?.listings.map((l) => l.card).filter(visible) ?? [];
    if (!cards.length) return false;
    cards.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const first = cards.find((c) => c.getBoundingClientRect().top >= 0) || cards[0];
    first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    for (const c of cards) {
      c.animate(
        [
          { boxShadow: '0 0 0 0 rgba(23,60,112,0)' },
          { boxShadow: '0 0 0 6px rgba(23,60,112,.55)', offset: 0.25 },
          { boxShadow: '0 0 0 0 rgba(23,60,112,0)' },
        ],
        { duration: 1600, easing: 'ease-out' },
      );
    }
    return true;
  }

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'mi-page') sendResponse(summary());
    else if (msg?.type === 'mi-reveal') sendResponse(reveal(msg.id));
    else if (msg?.type === 'mi-filter') {
      filter.min = Math.max(0, Math.min(100, Number(msg.min) || 0));
      filter.unrated = !!msg.unrated;
      applyFilter();
      sendResponse(summary());
    }
    else return false;
    return false;
  });

  function brandFromStructuredData(card) {
    for (const s of card.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const d = JSON.parse(s.textContent);
        const name = typeof d?.brand === 'string' ? d.brand : d?.brand?.name;
        if (name) return lookup(name, { allowCommon: true });
      } catch {
        /* not JSON-LD we understand */
      }
    }
    return null;
  }

  function brandFromTitleAttr(card) {
    const t = [card, ...card.querySelectorAll('[title]')].map((e) => e.getAttribute?.('title') || '').find((v) => /Brand:\s*[^,]+/i.test(v));
    const m = t && t.match(/Brand:\s*([^,]+)/i);
    return m ? lookup(m[1], { allowCommon: true }) : null;
  }

  function scanLabels(root) {
    const sel = [site.label, GENERIC_LABEL].filter(Boolean).join(',');
    for (const el of root.querySelectorAll(sel)) {
      if (el.hasAttribute(DONE) || el.closest('.mi-badge-host') || el.childElementCount > 2) continue;
      const text = el.textContent.trim();
      if (!text || text.length > 60) continue;
      const brand = lookup(text, { allowCommon: true });
      if (brand) inject(el, brand);
    }
  }

  function scanCards(root) {
    if (!site.card) return;
    const cards = root.matches?.(site.card) ? [root, ...root.querySelectorAll(site.card)] : root.querySelectorAll(site.card);
    for (const card of cards) {
      if (card.hasAttribute(DONE)) continue;
      card.setAttribute(DONE, '1');
      if (hasBadge(containerOf(card))) continue;
      const hinted = brandFromStructuredData(card) || brandFromTitleAttr(card);
      const leaves = [...card.querySelectorAll('span, p, div, h2, h3, h4, strong')].filter((el) => isLeaf(el) && el.textContent.trim().length >= 2 && el.textContent.trim().length <= 40);
      let anchor = null;
      let brand = hinted;
      if (hinted) anchor = leaves.find((el) => lookup(el.textContent, { allowCommon: true })?.id === hinted.id);
      if (!brand) {
        for (const el of leaves) {
          const b = lookup(el.textContent, { allowCommon: false });
          if (b) {
            brand = b;
            anchor = el;
            break;
          }
        }
      }
      if (!brand && site.title) {
        const t = card.querySelector(site.title);
        if (t) {
          brand = lookupPrefix(t.textContent);
          anchor = t;
        }
      }
      if (brand) inject(anchor || leaves[0] || card, brand);
    }
  }

  function scanTitles(root) {
    if (!site.title) return;
    for (const t of root.querySelectorAll(site.title)) {
      if (t.hasAttribute(DONE)) continue;
      const brand = lookupPrefix(t.textContent);
      if (brand) inject(t, brand);
      else t.setAttribute(DONE, '1');
    }
  }

  function scan(root = document.body) {
    if (!index.size || !settings.enabled || settings.sites?.[site.id] === false) return;
    scanLabels(root);
    scanCards(root);
    scanTitles(root);
  }

  function clearAll() {
    document.querySelectorAll('.mi-badge-host').forEach((h) => h.remove());
    document.querySelectorAll(`[${DONE}]`).forEach((e) => e.removeAttribute(DONE));
    for (const { listings } of registry.values()) for (const { card } of listings) spotlightCard(card, -1);
    registry.clear();
  }

  // infinite scroll and client-side navigation: rescan added subtrees, batched
  let pending = new Set();
  let timer = 0;
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) for (const n of m.addedNodes) if (n.nodeType === 1 && !n.classList?.contains('mi-badge-host')) pending.add(n);
    if (pending.size && !timer)
      timer = setTimeout(() => {
        timer = 0;
        const roots = [...pending].filter((n) => n.isConnected);
        pending = new Set();
        roots.forEach((r) => scan(r));
        applyFilter();
      }, 250);
  });

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  async function load() {
    const got = await api.storage.local.get([DATA_KEY, SETTINGS_KEY]);
    settings = { ...settings, ...(got[SETTINGS_KEY] || {}) };
    if (got[DATA_KEY]?.brands) buildIndex(got[DATA_KEY]);
  }

  api.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !(changes[DATA_KEY] || changes[SETTINGS_KEY])) return;
    await load();
    clearAll();
    scan();
    applyFilter();
  });

  // Wait for the page to finish loading and go idle before touching it: React/Next.js
  // sites hydrate server-rendered markup first, and editing it earlier causes a
  // hydration mismatch (seen on Vinted).
  const afterHydration = () =>
    new Promise((resolve) => {
      const settle = () => setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(resolve, { timeout: 3000 }) : resolve()), 1200);
      if (document.readyState === 'complete') settle();
      else window.addEventListener('load', settle, { once: true });
    });

  Promise.all([load(), afterHydration()]).then(() => {
    scan();
    applyFilter();
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();
