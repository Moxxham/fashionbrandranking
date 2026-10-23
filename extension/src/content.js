/* Menswear Index — marketplace overlay (content script).
 *
 * Finds brand names on product grids and listings, and injects a badge with
 * the brand's index score, tier and a breakdown tooltip. Where the page shows
 * both an RRP and a sale price, it compares the discount with the brand's
 * buy-at threshold. Badges render in shadow DOM so site CSS can't reach them;
 * a MutationObserver picks up cards added by infinite scroll.
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
   */
  const SITES = [
    { id: 'vinted', name: 'Vinted', host: /(^|\.)vinted\.[a-z.]+$/, label: '[data-testid$="--description-title"]', card: null, title: null },
    { id: 'ssense', name: 'SSENSE', host: /(^|\.)ssense\.com$/, label: '', card: 'a[href*="/product/"]', title: null },
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
  let settings = { enabled: true, showProvisional: false, sites: {}, endpoint: DEFAULT_SITE };
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
  const looksLikePrice = (t) => PRICE_RE.test(t) && CURRENCY_RE.test(t);
  const isLeaf = (el) => el.childElementCount === 0;

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

  /** Discount (%) when the card shows a struck-through RRP and a lower current price; otherwise null. */
  function readDiscount(from) {
    let node = from;
    for (let depth = 0; depth < 7 && node && node !== document.body; depth++, node = node.parentElement) {
      const prices = [...node.querySelectorAll('span, div, p, s, del, strong, b, ins')]
        .filter((el) => isLeaf(el) && el.textContent.trim().length <= 20 && looksLikePrice(el.textContent.trim()))
        .map((el) => ({ el, value: parseAmount(el.textContent), was: struck(el) }))
        .filter((p) => p.value > 0);
      if (!prices.length) continue;
      const was = prices.filter((p) => p.was).map((p) => p.value);
      const now = prices.filter((p) => !p.was).map((p) => p.value);
      if (!was.length || !now.length) return null;
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
    const [, label, bg, fg] = band(brand.composite);
    const verdict = discount == null ? '' : discount >= brand.buyAt ? '<span class="verdict buy">✓ Buy</span>' : '<span class="verdict wait">Wait</span>';
    root.innerHTML = `<style>${BADGE_CSS}</style><button type="button" class="${brand.provisional ? 'prov' : ''}" aria-label="Menswear Index: ${esc(brand.name)} scores ${brand.composite.toFixed(1)}, ${label}">
      <span class="score" style="background:${bg};color:${fg}">${brand.composite.toFixed(1)}</span><span class="tier">${TIERS[brand.tier][1]}</span>${verdict}</button>`;
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
      const dims = Object.keys(DIM_LABELS)
        .map((d) => `<span>${DIM_LABELS[d]}</span><span class="bar"><i style="width:${b.scores[d]}%"></i></span><span class="num">${b.scores[d]}</span>`)
        .join('');
      const deal =
        discount == null
          ? `Buy at <b>${b.buyAt}%</b> off RRP or more.`
          : discount >= b.buyAt
            ? `<span class="ok">✓ ${discount}% off</span>: at or past the ${b.buyAt}% buy-at threshold.`
            : `<span class="no">${discount}% off</span>: below the ${b.buyAt}% buy-at threshold.`;
      box.innerHTML = `
        <p class="name">${esc(b.name)}</p>
        <p class="meta">Rank #${b.rank.toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')} · ${tierName} ${tierSym}</p>
        <div class="head"><span class="score" style="background:${bg};color:${fg}">${b.composite.toFixed(1)}</span><span class="band">${label}</span></div>
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
    anchor.insertAdjacentElement('afterend', makeBadge(brand, readDiscount(anchor)));
  }

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
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();
