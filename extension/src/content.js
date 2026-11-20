/* Menswear Index — marketplace overlay (content script).
 *
 * Finds brand names on product grids and listings, and injects a badge with
 * the brand's index score, tier and a breakdown tooltip. Where the page shows
 * both an RRP and a sale price, the badge shows a deal score instead: the
 * index score adjusted for the discount against the brand's buy-at threshold. Badges render in shadow DOM so site CSS can't reach them;
 * a MutationObserver picks up cards added by infinite scroll. From the popup, listings scoring
 * below a chosen level can be hidden until the page reloads, and the grid sorted by score.
 * On Vinted, the aggregate mode collects every listing across several result pages for the
 * results tab (results.html).
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
    'on next gap head hope folk lee arena element elements baker money industry spin noir reason valor faded malibu helium hera apollo curated cos mango market wilson rebel legends closed frame closure sunflower blend hunter champion express theory crew vince coach guess bench animal patrick rhythm insight former quasi hockey hype luke mida berna premise fawn reserved ale antigua antler armada atoms bark barracuda bather beams bianco blenders boast bodega bonsai brokers buff calibre castro challenger chapeau cherokee chums commas commoners copa cyclone date diverse doppler druids fanatics flexi frau fulton furor gerry gilbert giro gotcha grasshoppers grinders held henderson herringbone highlander holden homage hydrogen icicle incarnation ingram janus kipling knox laredo lexington lumberjack madness madras mains merlin monos morrison myths outil oxbow painkiller parkside pedro peerless pistil planks pronounce quay ramsey reef richards rifle roadster roar royalties rusty sibling silhouette skins snipe snitch stafford swims think topper troubadour tween unrecorded velour victoria westbury woodland zephyr blackstone barrett saddlebred hathaway holloway dobbs delong bowen'.split(
      ' ',
    ),
  );
  // multi-word names that are also everyday phrases
  for (const p of ['being human', 'hot topic', 'plan b', 'first ascent', 'junk food', 'family first', 'free country', 'the executive', 'outdoor products', 'sense of place', 'wild country', 'five ten', 'more mile', 'mad rock', 'fresh service', 'retro brand', 'far afield', 'native youth', 'town team', 'blue marble', 'blue industry', 'la paz'])
    COMMON.add(p);

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
  const filter = { min: 0, unrated: false, sort: false };
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
    applySort();
  }

  /* ------------------------------------------------------------------ */
  /* Sort this page by score                                             */
  /* ------------------------------------------------------------------ */

  // Reorders the grid best-first with the CSS `order` property, so the page's own markup is untouched.
  // Works where the listings sit in a flex or grid container (Vinted); elsewhere it has no effect.
  const ORDER = 'data-mi-order';
  function applySort() {
    const want = new Map();
    if (filter.sort && scanning()) {
      for (const { brand, listings } of registry.values())
        for (const l of listings) {
          if (!l.card.isConnected) continue;
          const tile = tileOf(l.card);
          const v = Math.round((100 - mainScore(brand, l.discount)) * 10);
          if (!want.has(tile) || want.get(tile) > v) want.set(tile, v);
        }
      // everything else in the same grid (unrecognised brands, promotions) goes after the scored listings
      const grids = new Set([...want.keys()].map((t) => t.parentElement).filter(Boolean));
      for (const g of grids) for (const child of g.children) if (!want.has(child)) want.set(child, 1001);
    }
    for (const el of document.querySelectorAll(`[${ORDER}]`))
      if (!want.has(el)) {
        el.style.order = '';
        el.removeAttribute(ORDER);
      }
    for (const [el, v] of want)
      if (el.getAttribute(ORDER) !== String(v)) {
        el.style.order = String(v);
        el.setAttribute(ORDER, String(v));
      }
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
    return { site: site.name, brands, listings, shownListings, total, filter: { ...filter }, filteredOut, unratedFilter: !!(site.item && site.label), aggregate: aggStatus() };
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

  /* ------------------------------------------------------------------ */
  /* Aggregate (Vinted)                                                  */
  /* ------------------------------------------------------------------ */

  // Collects every listing across several result pages into storage for the results tab
  // (results.html). It first reads Vinted's own catalogue API, which serves the same listings as the
  // page buttons, 96 at a time, without touching this tab. If that fails or disagrees with the grid on
  // screen, it steps through the page buttons in this tab instead, picking up again after each page
  // load (the run is remembered in sessionStorage, which is per tab and survives reloads).
  const AGG_KEY = 'mi-agg';
  const RUN_KEY = 'mi-agg-run';
  const AGG_MAX_PAGES = 50;
  const AGG_MAX_ITEMS = 6000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Firefox runs content-script fetch as the extension; content.fetch makes the request as the page, with its cookies
  const pageFetch = typeof globalThis.content?.fetch === 'function' ? globalThis.content.fetch.bind(globalThis.content) : globalThis.fetch.bind(globalThis);
  let agg = null;
  let aggIds = new Set();
  let aggActive = false;

  const itemIdOf = (href) => (String(href || '').match(/\/items\/(\d+)/) || [])[1] || null;
  const gridIds = () =>
    site.item ? [...new Set([...document.querySelectorAll(`${site.item} a[href*="/items/"]`)].map((a) => itemIdOf(a.getAttribute('href'))).filter(Boolean))] : [];
  const currentPage = () => Math.max(1, parseInt(new URL(location.href).searchParams.get('page'), 10) || 1);
  const aggSupported = () => site.id === 'vinted' && (/^\/(catalog|brand)(\/|$)/.test(location.pathname) || gridIds().length > 0);
  const queryLabel = () =>
    new URL(location.href).searchParams.get('search_text') || document.title.replace(/\s*[|–-]\s*Vinted.*$/i, '').trim() || location.pathname;
  const CURRENCY_CODES = [
    [/£/, 'GBP'],
    [/€/, 'EUR'],
    [/\$/, 'USD'],
    [/zł/i, 'PLN'],
    [/kč/i, 'CZK'],
    [/\bft\b/i, 'HUF'],
    [/\blei\b/i, 'RON'],
  ];
  const currencyOf = (text) => CURRENCY_CODES.find(([re]) => re.test(text))?.[1] || '';

  function aggStatus() {
    return {
      supported: aggSupported(),
      running: aggActive,
      method: agg?.method ?? null,
      pagesDone: agg?.pagesDone ?? 0,
      maxPages: agg?.maxPages ?? 0,
      items: agg?.items.length ?? 0,
    };
  }

  async function saveAgg() {
    agg.updatedAt = Date.now();
    try {
      await api.storage.local.set({ [AGG_KEY]: agg });
    } catch (e) {
      aggActive = false;
      agg.error = `Couldn't save the results: ${e.message || e}`;
    }
  }

  async function aggFinish(status, error) {
    aggActive = false;
    try {
      sessionStorage.removeItem(RUN_KEY);
    } catch {
      /* storage blocked */
    }
    if (!agg) return;
    agg.status = status;
    if (error) agg.error = error;
    await saveAgg();
  }

  /** Adds listings not seen yet; returns how many were new. */
  function ingest(items, page) {
    let added = 0;
    for (const it of items) {
      if (!it.id || aggIds.has(it.id) || agg.items.length >= AGG_MAX_ITEMS) continue;
      aggIds.add(it.id);
      const b = it.brandName ? lookup(it.brandName, { allowCommon: true }) : null;
      agg.items.push({ ...it, brandId: b?.id ?? null, page, order: agg.items.length });
      added++;
    }
    return added;
  }

  /* --- Vinted's catalogue API --- */

  /** The API query for this catalogue page: its filters, with "catalog[]=1&catalog[]=2" as "catalog_ids=1,2". */
  function apiQuery() {
    const u = new URL(location.href);
    const m = u.pathname.match(/^\/(catalog|brand)(?:\/(\d+))?/);
    if (!m) return null;
    const out = new URLSearchParams();
    const multi = new Map();
    for (const [k, v] of u.searchParams) {
      if (['page', 'per_page', 'time', 'search_id', 'catalog_from', 'search_by_image_uuid'].includes(k)) continue;
      if (!k.endsWith('[]')) {
        out.set(k, v);
        continue;
      }
      const name = k === 'catalog[]' ? 'catalog_ids' : k.slice(0, -2);
      if (!multi.has(name)) multi.set(name, []);
      multi.get(name).push(v);
    }
    // the category or brand can be in the path: /catalog/2050-clothing, /brand/53-nike
    const pathKey = m[1] === 'catalog' ? 'catalog_ids' : 'brand_ids';
    if (m[2] && !multi.has(pathKey)) multi.set(pathKey, [m[2]]);
    for (const [k, vs] of multi) out.set(k, vs.join(','));
    return out;
  }

  async function apiPage(params, page) {
    const q = new URLSearchParams(params);
    q.set('page', String(page));
    q.set('per_page', '96');
    const res = await pageFetch(`${location.origin}/api/v2/catalog/items?${q}`, { credentials: 'include', headers: { accept: 'application/json, text/plain, */*' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    if (!Array.isArray(d?.items)) throw new Error('unexpected response');
    return d;
  }

  const num = (v) => {
    const n = parseFloat(v?.amount ?? v);
    return Number.isFinite(n) ? n : NaN;
  };
  function fromApi(it) {
    const thumb = it.photo?.thumbnails?.find((t) => /310x430|310/.test(t.type || ''))?.url;
    return {
      id: String(it.id),
      url: it.url ? new URL(it.url, location.origin).href : `${location.origin}/items/${it.id}`,
      title: it.title || '',
      brandName: it.brand_title || '',
      size: it.size_title || '',
      condition: typeof it.status === 'string' ? it.status : '',
      price: num(it.price),
      total: num(it.total_item_price),
      currency: it.price?.currency_code || it.currency || '',
      photo: thumb || it.photo?.url || '',
      favourites: Number.isFinite(it.favourite_count) ? it.favourite_count : null,
      views: Number.isFinite(it.view_count) ? it.view_count : null,
    };
  }

  /** The first page from the API, if it works and returns the listings this page shows. */
  async function apiFirstPage() {
    const params = apiQuery();
    if (!params) return null;
    try {
      const data = await apiPage(params, agg.startPage);
      if (!data.items.length) return null;
      // sanity check: most of the grid on screen should be in the API's page (ordering can differ slightly)
      const dom = gridIds();
      if (dom.length >= 10) {
        const got = new Set(data.items.map((i) => String(i.id)));
        if (dom.filter((id) => got.has(id)).length / dom.length < 0.25) return null;
      }
      return { params, data };
    } catch {
      return null;
    }
  }

  async function runApi({ params, data }) {
    agg.method = 'api';
    let page = agg.startPage;
    let d = data;
    try {
      while (aggActive) {
        if (agg.totalPages == null) {
          agg.totalPages = d.pagination?.total_pages ?? null;
          agg.totalEntries = d.pagination?.total_entries ?? null;
        }
        const added = ingest(d.items.map(fromApi), page);
        if (added) agg.pagesDone++; // a page with nothing new (past the last page) doesn't count
        await saveAgg();
        if (!aggActive || !added || agg.pagesDone >= agg.maxPages || (agg.totalPages && page >= agg.totalPages) || agg.items.length >= AGG_MAX_ITEMS) break;
        page++;
        await sleep(800 + Math.random() * 700); // paced, so it reads like someone paging through
        if (!aggActive) break;
        d = await apiPage(params, page).catch(async (e) => {
          if (!/HTTP 429/.test(e.message)) throw e;
          await sleep(6000); // rate-limited: wait once, then try again
          return apiPage(params, page);
        });
      }
      if (aggActive) await aggFinish('done');
    } catch (e) {
      if (aggActive) await aggFinish('done', `Stopped early: page ${page} failed to load (${e.message || e}).`);
    }
  }

  /* --- stepping through the page buttons --- */

  /** Every listing in the grid on screen. */
  function harvestDom() {
    const out = [];
    for (const cell of document.querySelectorAll(site.item)) {
      const a = cell.querySelector('a[href*="/items/"]');
      const id = a && itemIdOf(a.getAttribute('href'));
      if (!id) continue;
      // the link's title reads "Wax jacket, brand: Barbour, condition: Very good, size: M, £45.00, …"
      const attr = a.getAttribute('title') || '';
      const field = (k) => (attr.match(new RegExp(`(?:^|,)\\s*${k}:\\s*([^,]+)`, 'i')) || [])[1]?.trim() || '';
      const text = (sel) => cell.querySelector(sel)?.textContent.trim() || '';
      const sub = text('[data-testid$="--description-subtitle"]').split(/\s*·\s*/);
      const priceText = text('[data-testid$="--price-text"]') || (attr.match(/[£$€]\s?\d[\d.,]*|\d[\d.,]*\s?(?:€|zł|kr|Kč|Ft|lei)/) || [])[0] || '';
      const img = cell.querySelector('img');
      out.push({
        id,
        url: new URL(a.getAttribute('href'), location.href).href,
        title: attr.split(/,\s*[\p{L} ]+:/u)[0].trim() || img?.alt || '',
        brandName: text(site.label) || field('brand'),
        size: field('size') || sub[0] || '',
        condition: field('condition') || sub[1] || '',
        price: parseAmount(cleanPrice(priceText)),
        total: NaN,
        currency: currencyOf(priceText),
        photo: img?.currentSrc || img?.src || '',
        favourites: null,
        views: null,
      });
    }
    return out;
  }

  async function waitUntil(test, ms) {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if (test()) return true;
    return !!test();
  }

  /** Waits for a grid that differs from `prev` and has stopped changing; returns its listing ids. */
  async function waitForGrid(prev) {
    let last = '';
    let stable = 0;
    for (let t = 0; t < 60; t++) {
      const ids = gridIds();
      const key = ids.join(',');
      const fresh = ids.length > 0 && (!prev || ids.some((id) => !prev.has(id)));
      if (fresh && key === last) {
        if (++stable >= 2) return ids;
      } else stable = 0;
      last = key;
      await sleep(250);
    }
    return gridIds();
  }

  /** The control that goes to the next page: a link to page N+1, a "next" button, or failing those, the address itself. */
  function findNext() {
    const want = String(currentPage() + 1);
    const links = [...document.querySelectorAll('a[href]')].filter((a) => {
      if (a.closest(site.item)) return false;
      try {
        const u = new URL(a.href);
        return u.pathname === location.pathname && u.searchParams.get('page') === want;
      } catch {
        return false;
      }
    });
    const el =
      links.find((a) => /next/i.test(`${a.getAttribute('rel') || ''} ${a.getAttribute('aria-label') || ''} ${a.dataset.testid || ''}`)) || links[0];
    if (el) return { el, href: el.href };
    const btn = [...document.querySelectorAll('nav button, [data-testid*="pagination" i] button, [class*="pagination" i] button')].find(
      (b) => !b.disabled && b.getAttribute('aria-disabled') !== 'true' && /next|›|→|»/i.test(`${b.getAttribute('aria-label') || ''} ${b.dataset.testid || ''} ${b.textContent}`),
    );
    if (btn) return { el: btn, href: null };
    if (agg.totalPages && Number(want) > agg.totalPages) return null;
    const u = new URL(location.href);
    u.searchParams.set('page', want);
    return { el: null, href: u.href };
  }

  async function runWalker() {
    agg.method = 'pages';
    let prev = null;
    try {
      while (aggActive) {
        const ids = await waitForGrid(prev);
        if (!aggActive) return;
        const added = ingest(harvestDom(), currentPage());
        if (added) agg.pagesDone++; // a page with nothing new (past the last page) doesn't count
        await saveAgg();
        if (!aggActive || !ids.length || !added || agg.pagesDone >= agg.maxPages || agg.items.length >= AGG_MAX_ITEMS) break;
        const next = findNext();
        if (!next) break;
        prev = new Set(ids);
        await sleep(700 + Math.random() * 600);
        if (!aggActive) return;
        if (!next.el) {
          location.assign(next.href); // full page load: the script restarts and resumes from RUN_KEY
          return;
        }
        const before = location.href;
        next.el.click();
        // a client-side navigation keeps this script running; a full page load restarts it, and it resumes
        const moved = await waitUntil(() => location.href !== before || gridIds().some((id) => !prev.has(id)), 8000);
        if (!moved) {
          if (next.href) {
            location.assign(next.href);
            return;
          }
          throw new Error("the next page didn't load");
        }
      }
      if (aggActive) await aggFinish('done');
    } catch (e) {
      if (aggActive) await aggFinish('done', `Stopped early: ${e.message || e}.`);
    }
  }

  async function aggStart(msg) {
    if (aggActive) return aggStatus();
    if (!aggSupported()) return { ...aggStatus(), error: 'Open a Vinted search or catalogue page first.' };
    aggActive = true;
    agg = {
      v: 1,
      id: Date.now(),
      site: site.name,
      origin: location.origin,
      startUrl: location.href,
      query: queryLabel(),
      method: null,
      status: 'running',
      startPage: currentPage(),
      maxPages: Math.max(1, Math.min(AGG_MAX_PAGES, Number(msg.pages) || 10)),
      pagesDone: 0,
      totalPages: null,
      totalEntries: null,
      tabId: msg.tabId ?? null,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      error: null,
      items: [],
    };
    aggIds = new Set();
    await saveAgg();
    const first = msg.method === 'pages' ? null : await apiFirstPage();
    if (first) runApi(first);
    else {
      agg.method = 'pages';
      try {
        sessionStorage.setItem(RUN_KEY, String(agg.id));
      } catch {
        /* without sessionStorage a full page load ends the run; client-side navigation still works */
      }
      runWalker();
    }
    return aggStatus();
  }

  async function aggStop() {
    if (aggActive) return aggFinish('stopped');
    // a page-button run between page loads, not yet resumed here
    const got = (await api.storage.local.get(AGG_KEY))[AGG_KEY];
    if (got?.status === 'running') {
      agg = got;
      await aggFinish('stopped');
    }
  }

  /** After a full page load, carry on a page-button run started in this tab. */
  async function aggResume() {
    let id = null;
    try {
      id = sessionStorage.getItem(RUN_KEY);
    } catch {
      return;
    }
    if (!id) return;
    const got = (await api.storage.local.get(AGG_KEY))[AGG_KEY];
    if (!got || String(got.id) !== id || got.status !== 'running' || got.method !== 'pages') {
      sessionStorage.removeItem(RUN_KEY);
      return;
    }
    agg = got;
    aggIds = new Set(got.items.map((i) => i.id));
    aggActive = true;
    runWalker();
  }

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'mi-page') sendResponse(summary());
    else if (msg?.type === 'mi-reveal') sendResponse(reveal(msg.id));
    else if (msg?.type === 'mi-filter') {
      filter.min = Math.max(0, Math.min(100, Number(msg.min) || 0));
      filter.unrated = !!msg.unrated;
      if ('sort' in msg) filter.sort = !!msg.sort;
      applyFilter();
      sendResponse(summary());
    } else if (msg?.type === 'mi-agg-start') {
      aggStart(msg).then(sendResponse);
      return true; // async response
    } else if (msg?.type === 'mi-agg-stop') {
      aggStop().then(() => sendResponse(aggStatus()));
      return true;
    }
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
    aggResume();
  });
})();
