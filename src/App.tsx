/**
 * THE MENSWEAR INDEX
 * ------------------------------------------------------------------
 * Single-file React application. Everything the index needs lives here:
 *
 *   §1  Taxonomy & methodology constants (dimensions, weights, categories, tiers)
 *   §2  Data schema (TypeScript interfaces — mirrors docs/brand.schema.json)
 *   §3  Scoring engine (composite, confidence shrinkage, ranking)
 *   §4  Embedded seed dataset (strict JSON between @seed markers — the
 *       generator script parses this block, so it must stay valid JSON)
 *   §5  Data loading (external /brands.json with embedded fallback)
 *   §6  Fuzzy search
 *   §7  Persistence (localStorage bookmarks / personal tier list)
 *   §8  UI components
 *   §9  App shell
 *
 * Static-export friendly: no server runtime, no router dependency (hash deep
 * links only), no network calls other than fetching brands.json from the
 * same origin.
 */
import { memo, startTransition, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  BookmarkCheck,
  Check,
  Copy,
  Database,
  LayoutGrid,
  LayoutList,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';

/* ================================================================== */
/* §1  TAXONOMY & METHODOLOGY                                          */
/* ================================================================== */

const METHODOLOGY_VERSION = '1.0';

const DIMENSION_IDS = ['material', 'construction', 'design', 'longevity', 'value', 'reputation', 'consistency', 'transparency'] as const;
type DimensionId = (typeof DIMENSION_IDS)[number];
type Weights = Record<DimensionId, number>;

interface DimensionDef {
  id: DimensionId;
  label: string;
  short: string;
  abbr: string;
  weight: number;
  question: string;
  rationale: string;
}

const DIMENSIONS: DimensionDef[] = [
  {
    id: 'material',
    label: 'Material Integrity',
    short: 'Material',
    abbr: 'MA',
    weight: 0.2,
    question: 'Fibre, cloth, leather and hardware quality; mill and tannery provenance.',
    rationale: 'Materials set the ceiling on everything else — no amount of handwork rescues a poor cloth. Shared top weight with construction because the garment-as-object is what enthusiasts pay for.',
  },
  {
    id: 'construction',
    label: 'Construction & Craft',
    short: 'Craft',
    abbr: 'CR',
    weight: 0.2,
    question: 'Canvassing, welting, seam engineering, hand-finishing, factory provenance.',
    rationale: 'How a thing is made determines how it wears, ages and repairs. Together with materials, the physical object carries 40% of the index.',
  },
  {
    id: 'design',
    label: 'Design Originality',
    short: 'Design',
    abbr: 'DE',
    weight: 0.15,
    question: 'Point of view, silhouette authorship, influence on the wider field.',
    rationale: 'Weighted high enough that designer houses compete on their real strength, low enough that novelty can never outrank substance.',
  },
  {
    id: 'longevity',
    label: 'Longevity',
    short: 'Longevity',
    abbr: 'LO',
    weight: 0.15,
    question: 'Physical durability, repairability (resoling, re-waxing, recrafting), stylistic half-life.',
    rationale: 'Cost-per-wear is the enthusiast’s true price. Longevity rewards brands whose pieces are still in rotation a decade later.',
  },
  {
    id: 'value',
    label: 'Value Integrity',
    short: 'Value',
    abbr: 'VA',
    weight: 0.1,
    question: 'Quality delivered per dollar — scored against tier peers, not the whole market.',
    rationale: 'Tier-relative by rubric so luxury isn’t punished for being expensive and budget isn’t rewarded merely for being cheap. 10% keeps price from dominating a quality index.',
  },
  {
    id: 'reputation',
    label: 'Heritage & Reputation',
    short: 'Reputation',
    abbr: 'RE',
    weight: 0.1,
    question: 'Track record and standing among informed buyers, cutters, collectors and the trade.',
    rationale: 'Reputation is a useful prior, but capped at 10% so legacy names cannot coast on history while quality slides.',
  },
  {
    id: 'consistency',
    label: 'Consistency',
    short: 'Consistency',
    abbr: 'CO',
    weight: 0.05,
    question: 'QC variance across lines, factories and seasons.',
    rationale: 'Does the diffusion line live up to the mainline? Low weight because it is partly captured by craft and reputation already.',
  },
  {
    id: 'transparency',
    label: 'Transparency & Responsibility',
    short: 'Transparency',
    abbr: 'TR',
    weight: 0.05,
    question: 'Supply-chain disclosure, labour and environmental practice, repair & take-back.',
    rationale: 'Low weight reflects how little is independently verifiable today — not low importance. Scheduled to rise as disclosure improves.',
  },
];

const DEFAULT_WEIGHTS = Object.fromEntries(DIMENSIONS.map((d) => [d.id, d.weight])) as Weights;
const DIM_BY_ID = Object.fromEntries(DIMENSIONS.map((d) => [d.id, d])) as Record<DimensionId, DimensionDef>;

/** Composite = PRIOR + c · (BLEND·A + (1−BLEND)·G − PRIOR) — see Methodology tab. */
const BLEND = 0.75; // share of the weighted arithmetic mean; remainder is the weighted geometric mean
const PRIOR = 60; // "competent, unremarkable" baseline that low-evidence scores shrink towards
const MIN_CONFIDENCE = 0.5;

const CATEGORY_IDS = [
  'tailoring',
  'shirting',
  'trad',
  'heritage',
  'denim',
  'country',
  'technical',
  'designer',
  'contemporary',
  'streetwear',
  'essentials',
  'knitwear',
  'footwear',
  'accessories',
] as const;
type CategoryId = (typeof CATEGORY_IDS)[number];

interface CategoryDef {
  id: CategoryId;
  label: string;
  description: string;
  examples: string;
}

const CATEGORIES: CategoryDef[] = [
  { id: 'tailoring', label: 'Tailoring & Sartorial', description: 'Bespoke, made-to-measure and ready-to-wear suits and jackets; canvassing and cut are the craft.', examples: 'Savile Row, Neapolitan, Florentine, Japanese soft tailoring' },
  { id: 'shirting', label: 'Shirting & Haberdashery', description: 'Shirtmakers, neckwear and the small finishing pieces of a tailored wardrobe.', examples: 'Jermyn Street, Parisian chemisiers, Neapolitan camiceria' },
  { id: 'trad', label: 'Ivy, Prep & Trad', description: 'American natural-shoulder tradition: sack jackets, OCBDs, repp ties, Shetlands.', examples: 'Ivy League clothiers, Japanese Ivy revival' },
  { id: 'heritage', label: 'Heritage Workwear', description: 'Purpose-built American and European workwear and outdoor goods with long service histories.', examples: 'Chore coats, duck canvas, Mackinaw wool' },
  { id: 'denim', label: 'Denim & Repro', description: 'Selvedge denim, vintage reproductions and the Japanese repro movement.', examples: 'Okayama/Kojima mills, flight-jacket repro, loopwheel' },
  { id: 'country', label: 'Country & Sporting', description: 'Field, shooting and countryside clothing: waxed cotton, tweed, rubberised outerwear.', examples: 'Waxed jackets, shooting tweeds, wellingtons' },
  { id: 'technical', label: 'Technical & Outdoor', description: 'Performance outerwear and mountain equipment, from alpine shells to techwear.', examples: 'Gore-Tex shells, insulation, modular techwear' },
  { id: 'designer', label: 'Designer & Avant-Garde', description: 'Author-led fashion houses defined by silhouette, concept and runway influence.', examples: 'Japanese avant-garde, Antwerp, Paris runway' },
  { id: 'contemporary', label: 'Contemporary & Minimal', description: 'Design-led, wearable wardrobes; modern minimalism and fabric-forward basics.', examples: 'Scandinavian minimalism, Parisian contemporary' },
  { id: 'streetwear', label: 'Streetwear', description: 'Skate, hip-hop and youth-culture labels; drop and collaboration economies.', examples: 'Skate brands, Ura-Harajuku, NYC streetwear' },
  { id: 'essentials', label: 'Essentials & Basics', description: 'T-shirts, sweats, underwear and everyday staples where fabric and fit are everything.', examples: 'Loopwheel jersey, Supima tees, mass-market basics' },
  { id: 'knitwear', label: 'Knitwear', description: 'Specialist knitters and fibre houses: cashmere, merino, Shetland, Aran, Guernsey.', examples: 'Scottish Borders mills, fully-fashioned fine gauge' },
  { id: 'footwear', label: 'Footwear', description: 'Goodyear-welted and hand-welted shoemakers, bootmakers and sneaker makers.', examples: 'Northampton, Mallorca, Pacific Northwest boots' },
  { id: 'accessories', label: 'Leather Goods & Accessories', description: 'Bags, belts, hats, umbrellas, ties and small leather goods.', examples: 'Saddlery, hatters, umbrella makers' },
];
const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<CategoryId, CategoryDef>;

const TIER_IDS = ['atelier', 'luxury', 'premium', 'accessible', 'mainstream'] as const;
type TierId = (typeof TIER_IDS)[number];

interface TierDef {
  id: TierId;
  label: string;
  symbol: string;
  band: string;
  description: string;
}

const TIERS: TierDef[] = [
  { id: 'atelier', label: 'Atelier', symbol: '$$$$$', band: '$600+', description: 'Bespoke, made-to-order and the rarest fibres. Hand construction is the norm.' },
  { id: 'luxury', label: 'Luxury', symbol: '$$$$', band: '$350–600', description: 'Established luxury houses and top-flight ready-to-wear.' },
  { id: 'premium', label: 'Premium', symbol: '$$$', band: '$150–350', description: 'The enthusiast’s heartland: specialist makers and considered labels.' },
  { id: 'accessible', label: 'Accessible', symbol: '$$', band: '$60–150', description: 'Mid-market brands where value and consistency matter most.' },
  { id: 'mainstream', label: 'Mainstream', symbol: '$', band: 'under $60', description: 'High-street and mass-market labels.' },
];
const TIER_BY_ID = Object.fromEntries(TIERS.map((t) => [t.id, t])) as Record<TierId, TierDef>;
const TIER_BAND_NOTE = 'Bands are indexed to the brand’s core shirt-equivalent garment at full retail (USD).';

/* ================================================================== */
/* §2  DATA SCHEMA                                                     */
/* ================================================================== */

type OwnershipType = 'independent' | 'family' | 'group' | 'public' | 'private-equity';
type Provenance = 'curated' | 'ingested';

interface Brand {
  /** URL-safe slug, unique across the catalogue. */
  id: string;
  name: string;
  founded: number | null;
  origin: { country: string; countryCode: string; city?: string };
  /** Primary discipline — drives category rank. */
  category: CategoryId;
  subcategories?: CategoryId[];
  tier: TierId;
  /** Indicative retail range for the reference item. */
  priceUSD?: { from: number; to: number; reference?: string };
  /** ISO 3166-1 alpha-2 codes of principal manufacturing countries. */
  production?: string[];
  ownership?: { type: OwnershipType; parent?: string };
  /** Sub-dimension scores, 0–100. */
  scores: Record<DimensionId, number>;
  /** Evidence confidence 0.5–1.0; drives shrinkage toward PRIOR. */
  confidence: number;
  signatures: { name: string; note?: string }[];
  editorial: { summary: string; strengths: string[]; caveats: string[] };
  tags?: string[];
  website?: string;
  status?: 'active' | 'hiatus' | 'defunct';
  provenance: Provenance;
  updatedAt?: string;
}

interface BrandDataset {
  schemaVersion: string;
  methodologyVersion: string;
  generatedAt: string;
  weights: Weights;
  count: number;
  brands: Brand[];
}

interface SearchIndex {
  name: string;
  compact: string;
  nameWords: string[];
  text: string;
  words: string[];
}

interface RankedBrand extends Brand {
  arithmetic: number;
  geometric: number;
  balanced: number;
  composite: number;
  contributions: Record<DimensionId, number>;
  rank: number;
  categoryRank: number;
  categoryCount: number;
  percentile: number;
  search: SearchIndex;
}

/* ================================================================== */
/* §3  SCORING ENGINE                                                  */
/* ================================================================== */

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;
const nf = new Intl.NumberFormat('en-US');

function scoreBrand(scores: Record<DimensionId, number>, confidence: number, weights: Weights) {
  let wsum = 0;
  let a = 0;
  let lg = 0;
  for (const d of DIMENSION_IDS) {
    const w = weights[d];
    const s = clamp(scores[d], 1, 100);
    wsum += w;
    a += w * s;
    lg += w * Math.log(s);
  }
  const arithmetic = a / wsum;
  const geometric = Math.exp(lg / wsum);
  const balanced = BLEND * arithmetic + (1 - BLEND) * geometric;
  const c = clamp(confidence, MIN_CONFIDENCE, 1);
  const composite = PRIOR + c * (balanced - PRIOR);
  const contributions = {} as Record<DimensionId, number>;
  for (const d of DIMENSION_IDS) contributions[d] = round1((weights[d] * scores[d]) / wsum);
  return { arithmetic: round1(arithmetic), geometric: round1(geometric), balanced: round1(balanced), composite: round1(composite), contributions };
}

/** Composite descending; ties → construction, material, name. Competition ranking ("1-2-2-4"). */
function compareForRank(a: Omit<RankedBrand, 'rank' | 'categoryRank' | 'categoryCount' | 'percentile'>, b: typeof a) {
  return b.composite - a.composite || b.scores.construction - a.scores.construction || b.scores.material - a.scores.material || a.name.localeCompare(b.name);
}

function rankBrands(brands: Brand[], weights: Weights): RankedBrand[] {
  const scored = brands.map((b) => ({ ...b, ...scoreBrand(b.scores, b.confidence, weights), search: buildSearchIndex(b) }));
  scored.sort(compareForRank);
  const n = scored.length;
  const catSeen = new Map<CategoryId, { count: number; lastScore: number; lastRank: number }>();
  const catTotals = new Map<CategoryId, number>();
  for (const b of scored) catTotals.set(b.category, (catTotals.get(b.category) ?? 0) + 1);
  let lastScore = Number.NaN;
  let lastRank = 0;
  return scored.map((b, i) => {
    const rank = b.composite === lastScore ? lastRank : i + 1;
    lastScore = b.composite;
    lastRank = rank;
    const cs = catSeen.get(b.category) ?? { count: 0, lastScore: Number.NaN, lastRank: 0 };
    cs.count += 1;
    const categoryRank = b.composite === cs.lastScore ? cs.lastRank : cs.count;
    cs.lastScore = b.composite;
    cs.lastRank = categoryRank;
    catSeen.set(b.category, cs);
    return { ...b, rank, categoryRank, categoryCount: catTotals.get(b.category) ?? 1, percentile: n > 1 ? Math.round((1 - (rank - 1) / (n - 1)) * 100) : 100 };
  });
}

function dimensionMedians(brands: RankedBrand[]): Record<DimensionId, number> {
  const out = {} as Record<DimensionId, number>;
  for (const d of DIMENSION_IDS) {
    const vals = brands.map((b) => b.scores[d]).sort((x, y) => x - y);
    out[d] = vals.length ? vals[Math.floor(vals.length / 2)] : 50;
  }
  return out;
}

/* ================================================================== */
/* §4  EMBEDDED SEED DATASET                                           */
/*     Editorial assessments as of the updatedAt date. Strict JSON.    */
/* ================================================================== */

// prettier-ignore
const SEED_BRANDS: Brand[] = /* @seed:begin */ [
{"id":"anderson-sheppard","name":"Anderson & Sheppard","founded":1906,"origin":{"country":"United Kingdom","countryCode":"GB","city":"London"},"category":"tailoring","tier":"atelier","priceUSD":{"from":8000,"to":12000,"reference":"Bespoke two-piece suit"},"production":["GB"],"ownership":{"type":"independent"},"scores":{"material":95,"construction":97,"design":82,"longevity":96,"value":72,"reputation":97,"consistency":94,"transparency":68},"confidence":0.95,"signatures":[{"name":"Bespoke drape-cut lounge suit","note":"Soft shoulder, full chest, high armhole"},{"name":"Haberdashery cashmere cardigan"}],"editorial":{"summary":"The Savile Row standard-bearer for the soft English drape: a cut that favours comfort and movement over armour. Cutters are still trained in-house, and the Clifford Street haberdashery extends the aesthetic into knitwear and accessories.","strengths":["In-house cutting and making to a codified house style","Generous inlays and exceptional long-term wearability"],"caveats":["Multi-fitting process with lead times measured in months","Fixed house style — not the place for a sharp, structured look"]},"tags":["savile row","bespoke","drape cut","english tailoring"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"rubinacci","name":"Rubinacci","founded":1932,"origin":{"country":"Italy","countryCode":"IT","city":"Naples"},"category":"tailoring","tier":"atelier","priceUSD":{"from":6000,"to":9000,"reference":"Bespoke jacket"},"production":["IT"],"ownership":{"type":"family"},"scores":{"material":94,"construction":95,"design":86,"longevity":93,"value":68,"reputation":94,"consistency":90,"transparency":62},"confidence":0.9,"signatures":[{"name":"Bespoke Neapolitan jacket","note":"Spalla camicia shoulder, barchetta breast pocket"},{"name":"Printed silk ties and scarves"}],"editorial":{"summary":"Founded by Gennaro Rubinacci as London House, the atelier helped define the soft Neapolitan jacket and is now run by the third generation across Naples, Milan and London.","strengths":["Archive of rare vintage cloths","Lightweight, unlined construction with exemplary hand-finishing"],"caveats":["Ready-to-wear and accessories don’t always match the bespoke standard","Pricing at the very top of the market"]},"tags":["neapolitan","bespoke","spalla camicia","vintage cloth"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"cesare-attolini","name":"Cesare Attolini","founded":1930,"origin":{"country":"Italy","countryCode":"IT","city":"Naples"},"category":"tailoring","tier":"luxury","priceUSD":{"from":5000,"to":8000,"reference":"Ready-to-wear jacket"},"production":["IT"],"ownership":{"type":"family"},"scores":{"material":93,"construction":95,"design":80,"longevity":92,"value":58,"reputation":88,"consistency":92,"transparency":58},"confidence":0.88,"signatures":[{"name":"Handmade ready-to-wear sport coat","note":"Extensive handwork in the Casalnuovo workshop"},{"name":"Neapolitan double-breasted suit"}],"editorial":{"summary":"The Attolini family brought bespoke-grade handwork to ready-to-wear; Vincenzo Attolini is credited with deconstructing the Neapolitan jacket in the 1930s, and the workshop still produces largely by hand.","strengths":["Near-bespoke hand construction off the rack","Featherweight shoulders and fluid drape"],"caveats":["Ready-to-wear pricing rivals bespoke","Limited distribution"]},"tags":["neapolitan","handmade","ready-to-wear"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"liverano-liverano","name":"Liverano & Liverano","founded":1948,"origin":{"country":"Italy","countryCode":"IT","city":"Florence"},"category":"tailoring","tier":"atelier","priceUSD":{"from":5500,"to":8000,"reference":"Bespoke jacket"},"production":["IT"],"ownership":{"type":"family"},"scores":{"material":93,"construction":96,"design":88,"longevity":94,"value":70,"reputation":92,"consistency":92,"transparency":60},"confidence":0.88,"signatures":[{"name":"Bespoke Florentine jacket","note":"Long lapel roll, open quarters"},{"name":"Ready-to-wear sport coat"}],"editorial":{"summary":"Antonio Liverano’s Florentine house cuts one of the most recognisable silhouettes in tailoring — a long, confident lapel roll and open quarters — refined over seven decades in Florence.","strengths":["Singular, instantly identifiable house cut","Exclusive cloth programme"],"caveats":["House style is non-negotiable","Long waits between fittings outside Florence"]},"tags":["florentine","bespoke"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"brioni","name":"Brioni","founded":1945,"origin":{"country":"Italy","countryCode":"IT","city":"Rome"},"category":"tailoring","tier":"luxury","priceUSD":{"from":6000,"to":9000,"reference":"Ready-to-wear suit"},"production":["IT"],"ownership":{"type":"group","parent":"Kering"},"scores":{"material":92,"construction":90,"design":74,"longevity":88,"value":48,"reputation":86,"consistency":86,"transparency":62},"confidence":0.85,"signatures":[{"name":"Handmade Roman tailored suit"},{"name":"Cashmere and vicuña overcoats"}],"editorial":{"summary":"Roman tailoring house with its own tailoring school in Penne, Abruzzo; heavily handworked ready-to-wear with a fuller, more structured Roman shoulder.","strengths":["Large-scale handwork maintained in-house","Exceptional cloth selection"],"caveats":["Value lags smaller Italian workshops at similar quality","Brand identity has shifted with frequent creative changes"]},"tags":["roman tailoring","handmade"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"zegna","name":"Zegna","founded":1910,"origin":{"country":"Italy","countryCode":"IT","city":"Trivero"},"category":"tailoring","subcategories":["knitwear"],"tier":"luxury","priceUSD":{"from":3500,"to":6500,"reference":"Ready-to-wear suit"},"production":["IT","CH"],"ownership":{"type":"public","parent":"Ermenegildo Zegna Group"},"scores":{"material":93,"construction":85,"design":76,"longevity":86,"value":55,"reputation":88,"consistency":88,"transparency":80},"confidence":0.87,"signatures":[{"name":"Trofeo wool suiting","note":"Also supplied to tailors worldwide"},{"name":"Oasi cashmere overshirt"}],"editorial":{"summary":"A vertically integrated house — from its own Trivero wool mill to finished garments — whose cloths are cut by tailors worldwide. Ready-to-wear has moved toward relaxed, textural luxury.","strengths":["Mill-to-garment control of fibre and fabric","Published traceability work on wool and cashmere"],"caveats":["Retail pricing carries a brand premium","Footwear and accessories trail the cloth in quality"]},"tags":["wool mill","vertical","italian tailoring"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"ring-jacket","name":"Ring Jacket","founded":1954,"origin":{"country":"Japan","countryCode":"JP","city":"Osaka"},"category":"tailoring","tier":"premium","priceUSD":{"from":1300,"to":2500,"reference":"Sport coat"},"production":["JP"],"ownership":{"type":"independent"},"scores":{"material":86,"construction":88,"design":78,"longevity":88,"value":84,"reputation":84,"consistency":88,"transparency":66},"confidence":0.85,"signatures":[{"name":"Model 184 sport coat","note":"Soft shoulder, high gorge"},{"name":"Balloon wool travel suit"}],"editorial":{"summary":"Osaka manufacturer making some of the best-value soft tailoring in the world; the factory also produces for respected retailers’ house lines, and the Meister line adds extensive hand-finishing.","strengths":["Italian-grade soft construction with Japanese consistency","Strong value for fully canvassed tailoring"],"caveats":["Limited direct distribution outside Japan","Fit blocks skew short and slim for some"]},"tags":["japanese tailoring","soft shoulder","full canvas"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"suitsupply","name":"Suitsupply","founded":2000,"origin":{"country":"Netherlands","countryCode":"NL","city":"Amsterdam"},"category":"tailoring","tier":"accessible","priceUSD":{"from":500,"to":900,"reference":"Suit"},"production":["CN"],"ownership":{"type":"independent"},"scores":{"material":74,"construction":68,"design":72,"longevity":70,"value":90,"reputation":74,"consistency":72,"transparency":68},"confidence":0.88,"signatures":[{"name":"Havana-fit half-canvas suit","note":"Italian-milled cloth at a mid-market price"},{"name":"Made-to-measure programme"}],"editorial":{"summary":"Vertically controlled Dutch retailer that made half-canvassed suits in Italian mill cloth broadly affordable, backed by a strong in-store tailoring service.","strengths":["Big-name mill fabrics at mid-market prices","Fast, in-house alterations"],"caveats":["Half-canvas and fused construction, little handwork","Fashion-forward fits date quickly"]},"tags":["half canvas","made to measure","value tailoring"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"charvet","name":"Charvet","founded":1838,"origin":{"country":"France","countryCode":"FR","city":"Paris"},"category":"shirting","subcategories":["accessories"],"tier":"atelier","priceUSD":{"from":450,"to":700,"reference":"Ready-to-wear shirt"},"production":["FR"],"ownership":{"type":"family"},"scores":{"material":94,"construction":94,"design":85,"longevity":92,"value":62,"reputation":95,"consistency":92,"transparency":55},"confidence":0.9,"signatures":[{"name":"Bespoke shirt"},{"name":"Woven silk ties","note":"Famously extensive colour palette"}],"editorial":{"summary":"Place Vendôme shirtmaker since 1838, supplying monarchs and aesthetes; its silk tie palette and colour-blended shirting remain without peer.","strengths":["Unmatched depth of colour and weave in silks","In-house making in France"],"caveats":["Ready-to-wear sizing is idiosyncratic","Pricing reflects singular status"]},"tags":["chemisier","place vendome","silk ties","bespoke shirts"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"drakes","name":"Drake's","founded":1977,"origin":{"country":"United Kingdom","countryCode":"GB","city":"London"},"category":"shirting","subcategories":["trad","tailoring","accessories"],"tier":"premium","priceUSD":{"from":245,"to":320,"reference":"Oxford button-down shirt"},"production":["GB","IT"],"ownership":{"type":"independent"},"scores":{"material":84,"construction":82,"design":86,"longevity":85,"value":64,"reputation":86,"consistency":82,"transparency":70},"confidence":0.88,"signatures":[{"name":"Hand-rolled silk and wool ties"},{"name":"Oxford cloth button-down"},{"name":"Games blazer"}],"editorial":{"summary":"Began as a London tie maker and grew into the defining voice of modern English soft dressing — tailoring, workwear and Ivy styled together. Ties are still made in its own London workshop.","strengths":["Own factory for ties and accessories","Influential, coherent styling point of view"],"caveats":["Prices have climbed steeply","Some garments sourced from third-party makers"]},"tags":["ties","haberdashery","ivy","soft tailoring"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"kamakura-shirts","name":"Kamakura Shirts","founded":1993,"origin":{"country":"Japan","countryCode":"JP","city":"Kamakura"},"category":"shirting","tier":"accessible","priceUSD":{"from":89,"to":140,"reference":"Dress shirt"},"production":["JP"],"ownership":{"type":"independent"},"scores":{"material":78,"construction":80,"design":62,"longevity":80,"value":95,"reputation":78,"consistency":88,"transparency":60},"confidence":0.88,"signatures":[{"name":"Maker’s shirt","note":"Single-needle stitching, fine two-ply cotton"},{"name":"Vintage Ivy oxford button-down"}],"editorial":{"summary":"Japanese shirtmaker delivering single-needle construction and fine two-ply cottons at a price that embarrasses Western competitors.","strengths":["Best-in-class value for dress shirts","Consistent, precise sizing"],"caveats":["Narrow stylistic range","Limited store presence outside Japan and New York"]},"tags":["dress shirts","single needle","value"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"brooks-brothers","name":"Brooks Brothers","founded":1818,"origin":{"country":"United States","countryCode":"US","city":"New York"},"category":"trad","tier":"accessible","priceUSD":{"from":98,"to":150,"reference":"Oxford button-down shirt"},"ownership":{"type":"group","parent":"Authentic Brands Group / SPARC"},"scores":{"material":62,"construction":58,"design":64,"longevity":62,"value":66,"reputation":82,"consistency":52,"transparency":55},"confidence":0.85,"signatures":[{"name":"Original Polo button-down shirt","note":"The button-down collar, introduced 1896"},{"name":"Golden Fleece cashmere"}],"editorial":{"summary":"America’s oldest clothier and the originator of the button-down collar. Repeated ownership changes and a 2020 bankruptcy have left quality uneven, though its history remains unmatched.","strengths":["Unmatched American heritage","Frequent discounting makes basics accessible"],"caveats":["Quality has declined and varies by line","Heritage details diluted across seasons"]},"tags":["ivy","ocbd","american classic"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"j-press","name":"J.Press","founded":1902,"origin":{"country":"United States","countryCode":"US","city":"New Haven"},"category":"trad","tier":"premium","priceUSD":{"from":130,"to":175,"reference":"Oxford button-down shirt"},"ownership":{"type":"group","parent":"Onward Holdings"},"scores":{"material":72,"construction":70,"design":74,"longevity":76,"value":72,"reputation":82,"consistency":70,"transparency":55},"confidence":0.82,"signatures":[{"name":"Three-roll-two sack jacket","note":"Undarted, natural shoulder"},{"name":"Shaggy Dog Shetland sweater"}],"editorial":{"summary":"The last of the old Yale-campus clothiers, still selling the undarted natural-shoulder sack jacket and the Shaggy Dog sweater that defined Ivy style.","strengths":["Authentic Ivy patterns preserved","Distinctive Shaggy Dog knitwear"],"caveats":["Retail footprint has shrunk","Fit blocks feel dated to some"]},"tags":["ivy","sack suit","shetland","new haven"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"polo-ralph-lauren","name":"Polo Ralph Lauren","founded":1967,"origin":{"country":"United States","countryCode":"US","city":"New York"},"category":"trad","subcategories":["country"],"tier":"accessible","priceUSD":{"from":110,"to":150,"reference":"Oxford shirt"},"ownership":{"type":"public","parent":"Ralph Lauren Corporation"},"scores":{"material":68,"construction":64,"design":80,"longevity":70,"value":66,"reputation":88,"consistency":66,"transparency":62},"confidence":0.82,"signatures":[{"name":"Custom Fit oxford shirt"},{"name":"Cable-knit cashmere sweater"},{"name":"Mesh polo shirt"}],"editorial":{"summary":"Ralph Lauren’s mainline turned Ivy, Western and English country style into a global lifestyle; quality varies, but the design vocabulary is foundational.","strengths":["Coherent, hugely influential design vocabulary","Ubiquitous availability and frequent sales"],"caveats":["Construction is mass-market","Logo-heavy items dominate retail"]},"tags":["ivy","americana","preppy"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"barbour","name":"Barbour","founded":1894,"origin":{"country":"United Kingdom","countryCode":"GB","city":"South Shields"},"category":"country","tier":"premium","priceUSD":{"from":400,"to":550,"reference":"Waxed jacket"},"ownership":{"type":"family"},"scores":{"material":76,"construction":74,"design":78,"longevity":86,"value":76,"reputation":88,"consistency":74,"transparency":70},"confidence":0.88,"signatures":[{"name":"Bedale waxed jacket","note":"Designed for riding, 1980"},{"name":"Beaufort waxed jacket"},{"name":"Re-waxing and repair service"}],"editorial":{"summary":"The South Shields family firm behind the canonical waxed-cotton jacket; its re-waxing and repair service keeps jackets in rotation for decades.","strengths":["Factory repair and re-proofing programme","Instantly recognisable, timeless patterns"],"caveats":["Many lines now made outside the UK","Fit and quality vary across collaborations"]},"tags":["waxed cotton","country","repair"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"filson","name":"Filson","founded":1897,"origin":{"country":"United States","countryCode":"US","city":"Seattle"},"category":"heritage","subcategories":["country"],"tier":"premium","priceUSD":{"from":400,"to":600,"reference":"Mackinaw Cruiser"},"production":["US"],"scores":{"material":82,"construction":80,"design":70,"longevity":90,"value":72,"reputation":82,"consistency":74,"transparency":64},"confidence":0.85,"signatures":[{"name":"Mackinaw Cruiser","note":"Virgin wool, patented 1914"},{"name":"Tin Cloth field jacket"},{"name":"Rugged Twill duffle"}],"editorial":{"summary":"Gold Rush outfitter whose Seattle factory still turns out Mackinaw wool and oil-finished Tin Cloth built for the field, with long guarantees on core items.","strengths":["Seattle factory production for core items","Bombproof materials and long guarantees"],"caveats":["Sizing runs boxy","Non-core items increasingly made offshore"]},"tags":["mackinaw","tin cloth","made in usa"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"carhartt","name":"Carhartt","founded":1889,"origin":{"country":"United States","countryCode":"US","city":"Detroit"},"category":"heritage","tier":"mainstream","priceUSD":{"from":30,"to":60,"reference":"Work shirt"},"ownership":{"type":"family"},"scores":{"material":66,"construction":68,"design":62,"longevity":82,"value":92,"reputation":84,"consistency":74,"transparency":62},"confidence":0.85,"signatures":[{"name":"Duck Detroit jacket"},{"name":"Double-knee duck work pant"},{"name":"Acrylic watch hat"}],"editorial":{"summary":"Detroit workwear institution whose firm duck canvas is designed for job sites, not storefronts — and is better for it. Breaks in over years.","strengths":["Exceptional durability per dollar","Purpose-built, unpretentious design"],"caveats":["Stiff break-in","Quality varies between US-made and imported lines"]},"tags":["duck canvas","workwear","chore"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"engineered-garments","name":"Engineered Garments","founded":1999,"origin":{"country":"United States","countryCode":"US","city":"New York"},"category":"heritage","subcategories":["designer"],"tier":"premium","priceUSD":{"from":250,"to":400,"reference":"Work shirt"},"production":["US"],"ownership":{"type":"group","parent":"Nepenthes"},"scores":{"material":76,"construction":78,"design":90,"longevity":80,"value":66,"reputation":84,"consistency":78,"transparency":62},"confidence":0.85,"signatures":[{"name":"Bedford jacket"},{"name":"Fatigue pant"},{"name":"Loiter jacket"}],"editorial":{"summary":"Daiki Suzuki’s New York label reworks American workwear, military and Ivy patterns into eccentric, pocket-laden compositions, much of it sewn in the city’s garment district.","strengths":["Original pattern-making on American archetypes","Significant New York production"],"caveats":["Fits are deliberately unconventional","Fabric choices can favour texture over durability"]},"tags":["americana","workwear","nepenthes"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"the-real-mccoys","name":"The Real McCoy's","founded":1987,"origin":{"country":"Japan","countryCode":"JP"},"category":"denim","subcategories":["heritage"],"tier":"luxury","priceUSD":{"from":350,"to":500,"reference":"Selvedge jeans"},"production":["JP"],"ownership":{"type":"independent"},"scores":{"material":90,"construction":92,"design":82,"longevity":94,"value":72,"reputation":90,"consistency":92,"transparency":64},"confidence":0.88,"signatures":[{"name":"Type A-2 flight jacket","note":"Horsehide reproduction"},{"name":"Joe McCoy selvedge jeans"},{"name":"Loopwheel sweatshirt"}],"editorial":{"summary":"Obsessive Japanese reproduction house famous for military flight jackets — often more meticulous than the originals — alongside loopwheel sweats and heavy selvedge denim.","strengths":["Archival accuracy down to thread and hardware","Superb consistency"],"caveats":["Steep prices for flagship outerwear","Vintage-accurate fits aren’t for everyone"]},"tags":["repro","flight jacket","loopwheel","selvedge"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"iron-heart","name":"Iron Heart","founded":2003,"origin":{"country":"Japan","countryCode":"JP"},"category":"denim","tier":"premium","priceUSD":{"from":330,"to":420,"reference":"Selvedge jeans"},"production":["JP"],"ownership":{"type":"independent"},"scores":{"material":88,"construction":90,"design":66,"longevity":95,"value":78,"reputation":84,"consistency":90,"transparency":62},"confidence":0.85,"signatures":[{"name":"634S 21oz selvedge jeans"},{"name":"Ultra-heavy flannel shirt"},{"name":"21oz Type III denim jacket"}],"editorial":{"summary":"Built for motorcyclists, Iron Heart specialises in ultra-heavy denim and flannels engineered to survive anything — the heavyweight enthusiast’s benchmark.","strengths":["Extreme fabric weights with exceptional durability","Active repair culture around the brand"],"caveats":["Weight and stiffness aren’t for every climate","Design is functional rather than inventive"]},"tags":["heavyweight denim","selvedge","flannel"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"kapital","name":"Kapital","founded":1984,"origin":{"country":"Japan","countryCode":"JP","city":"Kojima"},"category":"denim","subcategories":["designer"],"tier":"luxury","priceUSD":{"from":450,"to":900,"reference":"Jeans"},"production":["JP"],"ownership":{"type":"family"},"scores":{"material":84,"construction":86,"design":96,"longevity":84,"value":58,"reputation":86,"consistency":80,"transparency":52},"confidence":0.85,"signatures":[{"name":"Century denim jeans"},{"name":"Boro patchwork jacket"},{"name":"Ring coat"}],"editorial":{"summary":"Kojima label that treats denim and Americana as raw material for folk art — sashiko, boro patchwork, hand-dyed indigo — with a theatrical, maximalist edge.","strengths":["Unmatched originality built on traditional Japanese techniques","Intricate handwork and dyeing"],"caveats":["Prices escalate quickly","Statement pieces date faster than basics"]},"tags":["boro","sashiko","indigo","kojima"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"levis","name":"Levi's","founded":1853,"origin":{"country":"United States","countryCode":"US","city":"San Francisco"},"category":"denim","tier":"mainstream","priceUSD":{"from":50,"to":100,"reference":"501 jeans"},"ownership":{"type":"public","parent":"Levi Strauss & Co."},"scores":{"material":62,"construction":64,"design":72,"longevity":74,"value":84,"reputation":92,"consistency":60,"transparency":74},"confidence":0.88,"signatures":[{"name":"501 Original jeans","note":"Riveted denim, patented 1873"},{"name":"Type III Trucker jacket"},{"name":"Levi's Vintage Clothing reproductions"}],"editorial":{"summary":"The originator of riveted denim. Mainline quality is mass-market, but the archive-driven Levi's Vintage Clothing line and the 501’s cultural reach keep it essential.","strengths":["Defining archetypes (501, Trucker)","Credible water and sustainability reporting"],"caveats":["Mainline fabric and construction vary widely","US production largely ended"]},"tags":["501","trucker","americana"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"arcteryx","name":"Arc'teryx","founded":1989,"origin":{"country":"Canada","countryCode":"CA","city":"North Vancouver"},"category":"technical","tier":"luxury","priceUSD":{"from":600,"to":900,"reference":"Hard-shell jacket"},"ownership":{"type":"group","parent":"Amer Sports"},"scores":{"material":90,"construction":92,"design":84,"longevity":88,"value":72,"reputation":92,"consistency":88,"transparency":74},"confidence":0.9,"signatures":[{"name":"Beta AR / Alpha SV shells","note":"Gore-Tex Pro, micro seam allowances"},{"name":"Atom hoody"},{"name":"Veilance Field jacket"}],"editorial":{"summary":"North Vancouver’s technical benchmark: laminated seams, micro seam allowances and patterning that set the standard for modern shells. The Veilance line translates that into urban tailoring.","strengths":["Industry-leading seam engineering","ReBird repair and resale programme"],"caveats":["Hype has inflated resale prices","Most production now in Asia"]},"tags":["gore-tex","shell","techwear","alpine"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"acronym","name":"Acronym","founded":1994,"origin":{"country":"Germany","countryCode":"DE","city":"Berlin"},"category":"technical","subcategories":["designer"],"tier":"luxury","priceUSD":{"from":1500,"to":2500,"reference":"Jacket"},"ownership":{"type":"independent"},"scores":{"material":90,"construction":88,"design":96,"longevity":84,"value":52,"reputation":90,"consistency":86,"transparency":60},"confidence":0.85,"signatures":[{"name":"J1A-GT interops jacket"},{"name":"P10 articulated cargo pant"}],"editorial":{"summary":"Errolson Hugh and Michaela Sachenbacher’s Berlin studio defined techwear: modular, gravity-pocketed outerwear designed as systems rather than garments.","strengths":["Genuinely inventive functional design","Small-batch, premium membranes and hardware"],"caveats":["Very high prices and scarce releases","Function-first aesthetics are polarising"]},"tags":["techwear","modular","gore-tex"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"patagonia","name":"Patagonia","founded":1973,"origin":{"country":"United States","countryCode":"US","city":"Ventura"},"category":"technical","tier":"premium","priceUSD":{"from":150,"to":300,"reference":"Fleece jacket"},"ownership":{"type":"independent","parent":"Patagonia Purpose Trust"},"scores":{"material":80,"construction":80,"design":66,"longevity":88,"value":78,"reputation":88,"consistency":82,"transparency":96},"confidence":0.9,"signatures":[{"name":"Synchilla Snap-T fleece"},{"name":"Better Sweater jacket"},{"name":"Worn Wear repair programme"}],"editorial":{"summary":"The industry’s reference point for responsibility — Fair Trade sewing, material traceability and the Worn Wear repair programme — with durable, if conservative, outdoor clothing.","strengths":["Best-in-class transparency and repair","Ironclad guarantee"],"caveats":["Conservative design","Mainline quality has softened over decades"]},"tags":["fleece","repair","responsibility","outdoor"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"stone-island","name":"Stone Island","founded":1982,"origin":{"country":"Italy","countryCode":"IT","city":"Ravarino"},"category":"technical","subcategories":["streetwear"],"tier":"luxury","priceUSD":{"from":300,"to":450,"reference":"Garment-dyed sweatshirt"},"production":["IT"],"ownership":{"type":"group","parent":"Moncler Group"},"scores":{"material":86,"construction":80,"design":90,"longevity":78,"value":58,"reputation":88,"consistency":80,"transparency":66},"confidence":0.85,"signatures":[{"name":"Ice Jacket","note":"Thermochromic fabric"},{"name":"Garment-dyed crewneck sweatshirt"},{"name":"Reflective jacket"}],"editorial":{"summary":"Massimo Osti’s research lab turned fashion house: decades of fabric experimentation and garment-dyeing, worn with terrace-culture cult status.","strengths":["Pioneering material and dye research","Deep, collectable archive"],"caveats":["Badge culture overshadows product","Core sweats overpriced for their construction"]},"tags":["garment dyed","fabric research","terrace"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"rick-owens","name":"Rick Owens","founded":1994,"origin":{"country":"France","countryCode":"FR","city":"Paris"},"category":"designer","tier":"luxury","priceUSD":{"from":500,"to":1200,"reference":"Shirt / top"},"production":["IT"],"ownership":{"type":"independent"},"scores":{"material":86,"construction":84,"design":97,"longevity":80,"value":52,"reputation":93,"consistency":84,"transparency":62},"confidence":0.88,"signatures":[{"name":"Geobasket sneaker"},{"name":"Stooges leather jacket"},{"name":"DRKSHDW denim"}],"editorial":{"summary":"Rick Owens and Michèle Lamy’s Paris house built a brutalist, gothic-glamour language entirely its own, produced largely through its own factory network in Concordia, Italy.","strengths":["Uncompromising, internally consistent vision","Strong Italian manufacturing"],"caveats":["Proportions demand commitment","Very high prices, even for diffusion lines"]},"tags":["avant-garde","leather","gothic"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"yohji-yamamoto","name":"Yohji Yamamoto","founded":1972,"origin":{"country":"Japan","countryCode":"JP","city":"Tokyo"},"category":"designer","tier":"luxury","priceUSD":{"from":500,"to":1100,"reference":"Shirt"},"production":["JP"],"ownership":{"type":"independent"},"scores":{"material":86,"construction":84,"design":98,"longevity":86,"value":52,"reputation":95,"consistency":86,"transparency":55},"confidence":0.88,"signatures":[{"name":"Pour Homme draped wool jacket"},{"name":"Gabardine long coat"},{"name":"Y-3 (with adidas)"}],"editorial":{"summary":"Yohji Yamamoto’s black-on-black, deconstructed tailoring changed menswear on the Paris runway in the early 1980s and still feels radical; Pour Homme is the core of Japanese avant-garde.","strengths":["Timeless, singular silhouettes","Exceptional Japanese fabrics, especially gabardines and wools"],"caveats":["Oversized cuts are not for everyone","Diffusion lines vary in quality"]},"tags":["avant-garde","japanese","black"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"comme-des-garcons","name":"Comme des Garçons","founded":1969,"origin":{"country":"Japan","countryCode":"JP","city":"Tokyo"},"category":"designer","tier":"luxury","priceUSD":{"from":300,"to":900,"reference":"Shirt"},"ownership":{"type":"independent"},"scores":{"material":80,"construction":80,"design":98,"longevity":80,"value":55,"reputation":95,"consistency":80,"transparency":50},"confidence":0.85,"signatures":[{"name":"Homme Plus runway pieces"},{"name":"CDG Shirt"},{"name":"Play heart-logo tee"}],"editorial":{"summary":"Rei Kawakubo’s company spans radical runway work and an ecosystem of lines from Homme Deux tailoring to Play basics — arguably the most influential independent fashion company of the past fifty years.","strengths":["Unrivalled creative influence","Lines span accessible to avant-garde"],"caveats":["Large quality spread between lines","Little supply-chain disclosure"]},"tags":["avant-garde","rei kawakubo","japanese"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"visvim","name":"Visvim","founded":2000,"origin":{"country":"Japan","countryCode":"JP","city":"Tokyo"},"category":"designer","subcategories":["heritage","footwear"],"tier":"atelier","priceUSD":{"from":600,"to":1200,"reference":"Shirt"},"production":["JP"],"ownership":{"type":"independent"},"scores":{"material":90,"construction":90,"design":90,"longevity":86,"value":48,"reputation":88,"consistency":86,"transparency":58},"confidence":0.85,"signatures":[{"name":"FBT moccasin sneaker"},{"name":"Christo sandal"},{"name":"Mud-dyed and indigo outerwear"}],"editorial":{"summary":"Hiroki Nakamura’s label fuses Native American, Japanese and vintage workwear references with natural dyes and archaic techniques — at stratospheric prices.","strengths":["Rare dyeing and textile techniques","Distinctive, research-led design"],"caveats":["Prices far outrun even excellent materials","Limited sizing and stock"]},"tags":["natural dye","japanese","americana"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"lemaire","name":"Lemaire","founded":1990,"origin":{"country":"France","countryCode":"FR","city":"Paris"},"category":"contemporary","subcategories":["designer"],"tier":"luxury","priceUSD":{"from":350,"to":550,"reference":"Shirt"},"ownership":{"type":"independent"},"scores":{"material":82,"construction":78,"design":90,"longevity":84,"value":62,"reputation":84,"consistency":82,"transparency":58},"confidence":0.85,"signatures":[{"name":"Twisted shirt"},{"name":"Croissant bag"},{"name":"Military-derived trench coat"}],"editorial":{"summary":"Christophe Lemaire and Sarah-Linh Tran’s quiet, fluid wardrobe of considered basics — the reference point for intelligent minimalism.","strengths":["Subtle, durable design language","Beautiful, tactile fabrics"],"caveats":["Muted palette can feel austere","Price creep in recent seasons"]},"tags":["minimal","parisian","quiet"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"our-legacy","name":"Our Legacy","founded":2005,"origin":{"country":"Sweden","countryCode":"SE","city":"Stockholm"},"category":"contemporary","tier":"premium","priceUSD":{"from":220,"to":330,"reference":"Shirt"},"ownership":{"type":"independent"},"scores":{"material":74,"construction":70,"design":86,"longevity":74,"value":66,"reputation":80,"consistency":72,"transparency":62},"confidence":0.82,"signatures":[{"name":"Box shirt"},{"name":"Third Cut jeans"},{"name":"Work Shop upcycled line"}],"editorial":{"summary":"Stockholm label that made fabric-led, slightly off-kilter basics the uniform of a generation; its Work Shop line upcycles deadstock.","strengths":["Inventive fabric sourcing","Strong, recognisable fits"],"caveats":["Construction is standard for the price","Some fabrics prioritise texture over wear"]},"tags":["scandinavian","fabric-led","deadstock"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"apc","name":"A.P.C.","founded":1987,"origin":{"country":"France","countryCode":"FR","city":"Paris"},"category":"contemporary","subcategories":["denim"],"tier":"premium","priceUSD":{"from":180,"to":250,"reference":"Raw denim jeans"},"ownership":{"type":"independent"},"scores":{"material":72,"construction":70,"design":78,"longevity":78,"value":70,"reputation":82,"consistency":72,"transparency":64},"confidence":0.85,"signatures":[{"name":"Petit New Standard raw jeans"},{"name":"Butler worn-jeans programme"}],"editorial":{"summary":"Jean Touitou’s Paris label introduced a generation to raw selvedge denim; the Butler programme takes back worn jeans for resale.","strengths":["Gateway raw denim with clean design","Butler take-back programme"],"caveats":["Denim sourcing has broadened beyond Japan","Minimal evolution across seasons"]},"tags":["raw denim","parisian","minimal"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"margaret-howell","name":"Margaret Howell","founded":1970,"origin":{"country":"United Kingdom","countryCode":"GB","city":"London"},"category":"contemporary","tier":"premium","priceUSD":{"from":250,"to":350,"reference":"Shirt"},"ownership":{"type":"independent"},"scores":{"material":80,"construction":78,"design":84,"longevity":84,"value":62,"reputation":82,"consistency":82,"transparency":64},"confidence":0.82,"signatures":[{"name":"Classic shirt in Irish linen"},{"name":"MHL. workwear line"},{"name":"Wide-leg trousers"}],"editorial":{"summary":"Margaret Howell’s understated British wardrobe — well-made shirts, workwear and tailoring — anticipated the quiet-menswear revival by decades.","strengths":["Enduring, utilitarian design","Much of the line made in the UK"],"caveats":["Prices high for simple designs","Limited US availability"]},"tags":["british","utilitarian","minimal"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"supreme","name":"Supreme","founded":1994,"origin":{"country":"United States","countryCode":"US","city":"New York"},"category":"streetwear","tier":"premium","priceUSD":{"from":120,"to":180,"reference":"Hooded sweatshirt"},"ownership":{"type":"group","parent":"EssilorLuxottica"},"scores":{"material":60,"construction":58,"design":78,"longevity":62,"value":56,"reputation":90,"consistency":62,"transparency":40},"confidence":0.85,"signatures":[{"name":"Box Logo hooded sweatshirt"},{"name":"Seasonal collaborations"}],"editorial":{"summary":"Downtown New York skate shop turned global streetwear institution; product quality is middling, but its drop-and-collaboration model rewrote the industry.","strengths":["Cultural influence and collaborations","Strong resale value"],"caveats":["Mass-market construction at premium prices","Quality varies widely by collaboration"]},"tags":["skate","drops","box logo"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"aime-leon-dore","name":"Aimé Leon Dore","founded":2014,"origin":{"country":"United States","countryCode":"US","city":"New York"},"category":"streetwear","subcategories":["trad"],"tier":"premium","priceUSD":{"from":150,"to":250,"reference":"Shirt"},"ownership":{"type":"independent"},"scores":{"material":70,"construction":66,"design":86,"longevity":66,"value":56,"reputation":82,"consistency":64,"transparency":46},"confidence":0.8,"signatures":[{"name":"New Balance 550 collaboration"},{"name":"Cable-knit sweater"},{"name":"Logo hoodie"}],"editorial":{"summary":"Teddy Santis’s Queens-raised label fuses Ivy, Mediterranean leisure and 1990s New York; its art direction influenced a whole generation of brands.","strengths":["Exceptional art direction and styling","Influential collaborations"],"caveats":["Product quality trails the imagery","Limited availability"]},"tags":["new york","ivy","art direction"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"uniqlo","name":"Uniqlo","founded":1984,"origin":{"country":"Japan","countryCode":"JP","city":"Yamaguchi"},"category":"essentials","tier":"mainstream","priceUSD":{"from":20,"to":50,"reference":"Oxford shirt"},"ownership":{"type":"public","parent":"Fast Retailing"},"scores":{"material":62,"construction":62,"design":62,"longevity":62,"value":94,"reputation":80,"consistency":82,"transparency":64},"confidence":0.88,"signatures":[{"name":"Supima cotton crew-neck tee"},{"name":"Uniqlo U","note":"Design-led capsule line"},{"name":"Ultra Light Down"}],"editorial":{"summary":"Fast Retailing’s flagship sets the global floor for well-engineered basics at scale: technical fabrics, consistent sizing and designer collaborations at mass prices.","strengths":["Unbeatable value and consistency","Fabric innovation (HEATTECH, AIRism)"],"caveats":["Mass production with limited longevity","Recurring supply-chain scrutiny"]},"tags":["basics","value","technical fabrics"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"sunspel","name":"Sunspel","founded":1860,"origin":{"country":"United Kingdom","countryCode":"GB","city":"Long Eaton"},"category":"essentials","tier":"premium","priceUSD":{"from":95,"to":160,"reference":"T-shirt / polo"},"production":["GB","PT"],"ownership":{"type":"independent"},"scores":{"material":84,"construction":80,"design":66,"longevity":82,"value":72,"reputation":82,"consistency":86,"transparency":72},"confidence":0.85,"signatures":[{"name":"Riviera polo"},{"name":"Classic crew-neck T-shirt","note":"Long-staple cotton jersey"}],"editorial":{"summary":"England’s historic underwear and T-shirt maker, still finishing pieces at its Long Eaton factory; the Riviera polo and long-staple cotton tees are benchmarks.","strengths":["Fine long-staple cotton jersey","Domestic manufacturing heritage"],"caveats":["Prices high for basics","Narrow product range"]},"tags":["t-shirt","polo","british made"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"merz-b-schwanen","name":"Merz b. Schwanen","founded":1911,"origin":{"country":"Germany","countryCode":"DE","city":"Albstadt"},"category":"essentials","tier":"premium","priceUSD":{"from":90,"to":160,"reference":"Henley / T-shirt"},"production":["DE"],"ownership":{"type":"independent"},"scores":{"material":82,"construction":86,"design":62,"longevity":88,"value":78,"reputation":78,"consistency":86,"transparency":72},"confidence":0.82,"signatures":[{"name":"215 loopwheeled henley"},{"name":"Good Originals T-shirts"}],"editorial":{"summary":"Revived Swabian knitter producing loopwheeled jersey on vintage circular machines — tubular bodies without side seams that age beautifully.","strengths":["Rare loopwheel construction","Made in Germany"],"caveats":["Vintage fits run short","Pricey for tees"]},"tags":["loopwheel","henley","made in germany"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"john-smedley","name":"John Smedley","founded":1784,"origin":{"country":"United Kingdom","countryCode":"GB","city":"Lea Mills"},"category":"knitwear","tier":"premium","priceUSD":{"from":200,"to":350,"reference":"Fine-gauge polo"},"production":["GB"],"ownership":{"type":"family"},"scores":{"material":88,"construction":88,"design":66,"longevity":86,"value":74,"reputation":86,"consistency":86,"transparency":78},"confidence":0.85,"signatures":[{"name":"Sea Island cotton polo"},{"name":"Extra-fine merino crew-neck"}],"editorial":{"summary":"Claims the world’s oldest manufacturing factory in continuous operation; extra-fine merino and Sea Island cotton knits fully fashioned in Derbyshire.","strengths":["Fully-fashioned fine-gauge knitting","Vertically controlled UK production"],"caveats":["Fine-gauge knits demand gentle care","Conservative styling"]},"tags":["fine gauge","merino","sea island cotton"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"johnstons-of-elgin","name":"Johnstons of Elgin","founded":1797,"origin":{"country":"United Kingdom","countryCode":"GB","city":"Elgin"},"category":"knitwear","subcategories":["accessories"],"tier":"luxury","priceUSD":{"from":400,"to":650,"reference":"Cashmere crew-neck"},"production":["GB"],"ownership":{"type":"independent"},"scores":{"material":92,"construction":88,"design":64,"longevity":88,"value":72,"reputation":86,"consistency":90,"transparency":84},"confidence":0.85,"signatures":[{"name":"Cashmere crew-neck sweater"},{"name":"Woven cashmere scarf"}],"editorial":{"summary":"Scotland’s vertical cashmere mill — from raw fibre to finished garment in Elgin and Hawick — and a quiet supplier to many luxury houses.","strengths":["True mill-to-garment vertical integration","Strong traceability reporting"],"caveats":["Plain designs","Branded pieces carry a luxury premium"]},"tags":["cashmere","scottish","mill"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"loro-piana","name":"Loro Piana","founded":1924,"origin":{"country":"Italy","countryCode":"IT","city":"Quarona"},"category":"knitwear","subcategories":["footwear","tailoring"],"tier":"atelier","priceUSD":{"from":1200,"to":2000,"reference":"Cashmere crew-neck"},"production":["IT"],"ownership":{"type":"group","parent":"LVMH"},"scores":{"material":98,"construction":90,"design":74,"longevity":88,"value":40,"reputation":94,"consistency":90,"transparency":58},"confidence":0.88,"signatures":[{"name":"Open Walk suede boot"},{"name":"Baby cashmere crew-neck"},{"name":"Storm System travel jacket"}],"editorial":{"summary":"The world’s leading source of noble fibres — vicuña, baby cashmere, fine merino — and the emblem of quiet luxury.","strengths":["Unmatched raw materials","Proprietary fabric finishes"],"caveats":["Extreme pricing","Subcontractor labour practices drew judicial scrutiny in Italy (2025)"]},"tags":["cashmere","vicuna","quiet luxury"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"edward-green","name":"Edward Green","founded":1890,"origin":{"country":"United Kingdom","countryCode":"GB","city":"Northampton"},"category":"footwear","tier":"luxury","priceUSD":{"from":1400,"to":1900,"reference":"Oxford shoe"},"production":["GB"],"ownership":{"type":"independent"},"scores":{"material":94,"construction":95,"design":84,"longevity":94,"value":66,"reputation":95,"consistency":92,"transparency":62},"confidence":0.9,"signatures":[{"name":"Dover split-toe derby","note":"Hand-stitched apron"},{"name":"Chelsea oxford"},{"name":"Top Drawer line"}],"editorial":{"summary":"Northampton’s most refined ready-to-wear shoemaker: elegant lasts, superb clicking and hand-sewn details, with patina finishes that approach bespoke.","strengths":["Exceptional leather selection and finishing","Elegant, distinctive lasts"],"caveats":["High price for Goodyear-welted footwear","Limited distribution"]},"tags":["goodyear welted","northampton","oxford"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"john-lobb-paris","name":"John Lobb (Paris)","founded":1902,"origin":{"country":"France","countryCode":"FR","city":"Paris"},"category":"footwear","tier":"luxury","priceUSD":{"from":1500,"to":2200,"reference":"Oxford shoe"},"production":["GB","FR"],"ownership":{"type":"group","parent":"Hermès"},"scores":{"material":93,"construction":92,"design":80,"longevity":92,"value":58,"reputation":94,"consistency":90,"transparency":62},"confidence":0.88,"signatures":[{"name":"City II oxford"},{"name":"William double monk"},{"name":"Lopez loafer"}],"editorial":{"summary":"Hermès-owned bootmaker whose ready-to-wear is made in Northampton; the William double monk and City II are reference designs.","strengths":["Benchmark ready-to-wear quality","Bespoke workshop in Paris"],"caveats":["Hermès-level pricing","Distinct from John Lobb Ltd. of St James's"]},"tags":["goodyear welted","monk strap","hermes"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"alden","name":"Alden","founded":1884,"origin":{"country":"United States","countryCode":"US","city":"Middleborough"},"category":"footwear","tier":"premium","priceUSD":{"from":650,"to":1000,"reference":"Derby shoe"},"production":["US"],"ownership":{"type":"family"},"scores":{"material":90,"construction":86,"design":70,"longevity":92,"value":74,"reputation":90,"consistency":72,"transparency":58},"confidence":0.88,"signatures":[{"name":"990 plain-toe blucher","note":"Horween shell cordovan"},{"name":"Indy boot (405)"},{"name":"Unlined loafers"}],"editorial":{"summary":"New England shoemaker revered for Horween shell cordovan and the Indy boot; construction is solid if old-fashioned, and quality control is a known lottery.","strengths":["Access to Horween shell cordovan","Classic American lasts"],"caveats":["Inconsistent QC","Cordovan allocation drives scarcity pricing"]},"tags":["shell cordovan","horween","goodyear welted"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"crockett-jones","name":"Crockett & Jones","founded":1879,"origin":{"country":"United Kingdom","countryCode":"GB","city":"Northampton"},"category":"footwear","tier":"premium","priceUSD":{"from":550,"to":900,"reference":"Oxford shoe"},"production":["GB"],"ownership":{"type":"family"},"scores":{"material":86,"construction":86,"design":72,"longevity":90,"value":82,"reputation":86,"consistency":86,"transparency":64},"confidence":0.88,"signatures":[{"name":"Audley oxford"},{"name":"Coniston boot"},{"name":"Boston loafer"}],"editorial":{"summary":"Family-owned Northampton maker with a huge catalogue of Goodyear-welted classics; the Hand Grade line rivals pricier houses.","strengths":["Best-in-class consistency for welted shoes","Factory resoling service"],"caveats":["Main collection leather a notch below Hand Grade","Conservative designs"]},"tags":["goodyear welted","northampton","resoling"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"carmina","name":"Carmina","founded":1866,"origin":{"country":"Spain","countryCode":"ES","city":"Inca"},"category":"footwear","tier":"premium","priceUSD":{"from":450,"to":750,"reference":"Loafer"},"production":["ES"],"ownership":{"type":"family"},"scores":{"material":86,"construction":86,"design":74,"longevity":88,"value":86,"reputation":80,"consistency":84,"transparency":60},"confidence":0.84,"signatures":[{"name":"Penny loafer on the Simpson last"},{"name":"Shell cordovan boots"}],"editorial":{"summary":"Mallorcan family maker offering Goodyear-welted shoes on sleek Spanish lasts, with shell cordovan priced well below English and American peers.","strengths":["Strong value in shell cordovan","Elegant, sleek lasts"],"caveats":["Lower recognition outside enthusiast circles"]},"tags":["mallorca","shell cordovan","loafer"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"paraboot","name":"Paraboot","founded":1908,"origin":{"country":"France","countryCode":"FR","city":"Saint-Jean-de-Moirans"},"category":"footwear","tier":"premium","priceUSD":{"from":450,"to":650,"reference":"Derby shoe"},"production":["FR"],"ownership":{"type":"family"},"scores":{"material":84,"construction":86,"design":76,"longevity":92,"value":82,"reputation":84,"consistency":86,"transparency":66},"confidence":0.85,"signatures":[{"name":"Michael tyrolean derby"},{"name":"Chambord"},{"name":"Avignon"}],"editorial":{"summary":"Isère shoemaker that vulcanises its own natural-rubber soles and Norwegian-welts rugged derbies; the Michael has become a fashion-world staple.","strengths":["Own sole production","Robust Norwegian-welt construction"],"caveats":["Chunky profile unsuited to formal settings"]},"tags":["norwegian welt","rubber sole","derby"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"common-projects","name":"Common Projects","founded":2004,"origin":{"country":"United States","countryCode":"US","city":"New York"},"category":"footwear","tier":"luxury","priceUSD":{"from":400,"to":480,"reference":"Leather sneaker"},"production":["IT"],"ownership":{"type":"independent"},"scores":{"material":74,"construction":72,"design":80,"longevity":66,"value":52,"reputation":80,"consistency":76,"transparency":46},"confidence":0.84,"signatures":[{"name":"Achilles Low sneaker","note":"Gold-stamped serial number"}],"editorial":{"summary":"Prathan Poopat and Flavio Girolami created the minimalist luxury sneaker; the Achilles Low remains the archetype despite a crowded field.","strengths":["Defining minimalist design","Made in Italy"],"caveats":["Cemented soles limit longevity","Pricing outruns construction"]},"tags":["sneaker","minimal","made in italy"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"allen-edmonds","name":"Allen Edmonds","founded":1922,"origin":{"country":"United States","countryCode":"US","city":"Port Washington"},"category":"footwear","tier":"accessible","priceUSD":{"from":300,"to":450,"reference":"Oxford shoe"},"ownership":{"type":"group","parent":"Caleres"},"scores":{"material":74,"construction":74,"design":58,"longevity":84,"value":80,"reputation":76,"consistency":64,"transparency":62},"confidence":0.84,"signatures":[{"name":"Park Avenue cap-toe oxford"},{"name":"Factory recrafting service"}],"editorial":{"summary":"American dress-shoe staple with 360° Goodyear welts and a factory recrafting service; quality has wobbled under corporate ownership.","strengths":["Factory recrafting","Reliable American dress staples"],"caveats":["QC and leather grade have slipped","Discount-driven pricing"]},"tags":["goodyear welted","recrafting","dress shoes"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"red-wing-heritage","name":"Red Wing Heritage","founded":1905,"origin":{"country":"United States","countryCode":"US","city":"Red Wing"},"category":"footwear","subcategories":["heritage"],"tier":"premium","priceUSD":{"from":330,"to":400,"reference":"Work boot"},"production":["US"],"ownership":{"type":"family"},"scores":{"material":80,"construction":82,"design":64,"longevity":92,"value":82,"reputation":88,"consistency":74,"transparency":66},"confidence":0.86,"signatures":[{"name":"Iron Ranger"},{"name":"Classic Moc 875"},{"name":"Beckman"}],"editorial":{"summary":"Minnesota bootmaker whose Heritage line turned work boots into menswear staples: triple-stitched, resoleable and cut from leathers from its own S.B. Foot tannery.","strengths":["Owns its tannery (S.B. Foot)","Long resole life"],"caveats":["Heavy break-in","Some QC variance"]},"tags":["work boot","resoleable","made in usa"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"cos","name":"COS","founded":2007,"origin":{"country":"United Kingdom","countryCode":"GB","city":"London"},"category":"contemporary","tier":"accessible","priceUSD":{"from":70,"to":120,"reference":"Shirt"},"ownership":{"type":"group","parent":"H&M Group"},"scores":{"material":58,"construction":56,"design":68,"longevity":56,"value":78,"reputation":64,"consistency":66,"transparency":62},"confidence":0.8,"signatures":[{"name":"Relaxed oxford shirt"},{"name":"Wool-blend overcoat"}],"editorial":{"summary":"H&M Group’s minimalist line offers clean, Scandinavian-leaning design at high-street prices; fabrics and construction are mass-market.","strengths":["Contemporary design at accessible prices"],"caveats":["Short garment lifespan","Frequent synthetic blends"]},"tags":["minimal","high street"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"},
{"id":"buck-mason","name":"Buck Mason","founded":2013,"origin":{"country":"United States","countryCode":"US","city":"Los Angeles"},"category":"essentials","tier":"accessible","priceUSD":{"from":45,"to":90,"reference":"T-shirt"},"ownership":{"type":"independent"},"scores":{"material":66,"construction":62,"design":62,"longevity":64,"value":74,"reputation":64,"consistency":70,"transparency":60},"confidence":0.78,"signatures":[{"name":"Venice Wash slub tee"},{"name":"Pima curved-hem tee"}],"editorial":{"summary":"Los Angeles brand built on vintage-inspired American basics — better than mall brands, not quite enthusiast grade.","strengths":["Well-cut everyday basics"],"caveats":["Fabric quality inconsistent"]},"tags":["basics","americana"],"status":"active","provenance":"curated","updatedAt":"2026-10-01"}
] /* @seed:end */;

/* ================================================================== */
/* §5  DATA LOADING                                                    */
/* ================================================================== */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []);

/** Defensive normaliser: external JSON is untrusted. Invalid records are dropped, not fatal. */
function sanitizeBrand(raw: unknown): Brand | null {
  if (!isObj(raw)) return null;
  if (raw.provenance === 'generated') return null; // real brands only — never render synthetic records
  const id = str(raw.id);
  const name = str(raw.name);
  if (!id || !name || !isObj(raw.scores)) return null;
  const scores = {} as Record<DimensionId, number>;
  for (const d of DIMENSION_IDS) {
    const v = Number(raw.scores[d]);
    if (!Number.isFinite(v)) return null;
    scores[d] = clamp(Math.round(v), 0, 100);
  }
  const origin = isObj(raw.origin) ? raw.origin : {};
  const category = (CATEGORY_IDS as readonly string[]).includes(raw.category as string) ? (raw.category as CategoryId) : 'contemporary';
  const tier = (TIER_IDS as readonly string[]).includes(raw.tier as string) ? (raw.tier as TierId) : 'premium';
  const editorial = isObj(raw.editorial) ? raw.editorial : {};
  const price = isObj(raw.priceUSD) ? raw.priceUSD : null;
  const own = isObj(raw.ownership) ? raw.ownership : null;
  const founded = Number(raw.founded);
  const provenance = raw.provenance === 'ingested' ? 'ingested' : 'curated';
  return {
    id,
    name,
    founded: Number.isInteger(founded) && founded > 1500 && founded < 2100 ? founded : null,
    origin: { country: str(origin.country) ?? 'Unknown', countryCode: (str(origin.countryCode) ?? 'XX').toUpperCase(), city: str(origin.city) },
    category,
    subcategories: strArr(raw.subcategories).filter((c): c is CategoryId => (CATEGORY_IDS as readonly string[]).includes(c) && c !== category),
    tier,
    priceUSD: price && Number.isFinite(Number(price.from)) ? { from: Number(price.from), to: Number(price.to ?? price.from), reference: str(price.reference) } : undefined,
    production: strArr(raw.production).map((c) => c.toUpperCase()),
    ownership: own && typeof own.type === 'string' ? { type: own.type as OwnershipType, parent: str(own.parent) } : undefined,
    scores,
    confidence: clamp(Number(raw.confidence ?? 0.75) || 0.75, MIN_CONFIDENCE, 1),
    signatures: Array.isArray(raw.signatures)
      ? raw.signatures.flatMap((s) => (isObj(s) && str(s.name) ? [{ name: str(s.name)!, note: str(s.note) }] : typeof s === 'string' ? [{ name: s }] : []))
      : [],
    editorial: { summary: str(editorial.summary) ?? '', strengths: strArr(editorial.strengths), caveats: strArr(editorial.caveats) },
    tags: strArr(raw.tags).map((t) => t.toLowerCase()),
    website: str(raw.website),
    status: raw.status === 'hiatus' || raw.status === 'defunct' ? raw.status : 'active',
    provenance,
    updatedAt: str(raw.updatedAt),
  };
}

function sanitizeWeights(raw: unknown): Weights | null {
  if (!isObj(raw)) return null;
  const w = {} as Weights;
  let sum = 0;
  for (const d of DIMENSION_IDS) {
    const v = Number(raw[d]);
    if (!Number.isFinite(v) || v < 0) return null;
    w[d] = v;
    sum += v;
  }
  if (sum <= 0) return null;
  for (const d of DIMENSION_IDS) w[d] = w[d] / sum;
  return w;
}

function parseDataset(json: unknown): Pick<BrandDataset, 'brands' | 'weights'> & { generatedAt?: string; dropped: number } {
  const list = Array.isArray(json) ? json : isObj(json) && Array.isArray(json.brands) ? json.brands : [];
  const seen = new Set<string>();
  const brands: Brand[] = [];
  for (const raw of list) {
    const b = sanitizeBrand(raw);
    if (b && !seen.has(b.id)) {
      seen.add(b.id);
      brands.push(b);
    }
  }
  const weights = (isObj(json) && sanitizeWeights(json.weights)) || DEFAULT_WEIGHTS;
  return { brands, weights, generatedAt: isObj(json) ? str(json.generatedAt) : undefined, dropped: list.length - brands.length };
}

interface DataState {
  status: 'loading' | 'ready';
  source: 'remote' | 'embedded';
  brands: Brand[];
  weights: Weights;
  generatedAt?: string;
  dropped?: number;
  error?: string;
}

function useDataset(): DataState {
  const [state, setState] = useState<DataState>({ status: 'loading', source: 'embedded', brands: SEED_BRANDS, weights: DEFAULT_WEIGHTS });
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`${import.meta.env.BASE_URL}brands.json`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`brands.json responded HTTP ${r.status}`);
        return r.json() as Promise<unknown>;
      })
      .then((json) => {
        const parsed = parseDataset(json);
        if (!parsed.brands.length) throw new Error('brands.json contained no valid records');
        startTransition(() => setState({ status: 'ready', source: 'remote', ...parsed }));
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setState((s) => ({ ...s, status: 'ready', source: 'embedded', error: err instanceof Error ? err.message : String(err) }));
      });
    return () => ctrl.abort();
  }, []);
  return state;
}

/* ================================================================== */
/* §6  FUZZY SEARCH                                                    */
/* ================================================================== */

const STOP_WORDS = new Set(['and', 'the', 'of', 'co', 'by']);

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildSearchIndex(b: Brand): SearchIndex {
  const name = normalize(b.name);
  const secondary = normalize(
    [
      ...b.signatures.map((s) => s.name),
      ...(b.tags ?? []),
      b.origin.city ?? '',
      b.origin.country,
      CATEGORY_BY_ID[b.category].label,
      ...(b.subcategories ?? []).map((c) => CATEGORY_BY_ID[c].label),
      TIER_BY_ID[b.tier].label,
      b.ownership?.parent ?? '',
    ].join(' '),
  );
  return {
    name,
    compact: name.replace(/ /g, ''),
    nameWords: name.split(' ').filter(Boolean),
    text: secondary,
    words: Array.from(new Set(secondary.split(' ').filter((w) => w.length > 1))),
  };
}

/** Bounded optimal-string-alignment distance with early exit. */
function withinDistance(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  const n = b.length;
  let prev2: number[] = [];
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return false;
    prev2 = prev;
    prev = cur;
  }
  return prev[n] <= max;
}

function isSubsequence(q: string, s: string): boolean {
  let i = 0;
  for (let j = 0; j < s.length && i < q.length; j++) if (s[j] === q[i]) i++;
  return i === q.length;
}

function tokenScore(t: string, ix: SearchIndex): number {
  if (ix.nameWords.includes(t)) return 95;
  if (ix.name.startsWith(t)) return 90;
  if (ix.nameWords.some((w) => w.startsWith(t))) return 80;
  if (t.length >= 3 && ix.compact.includes(t)) return 70;
  if (ix.words.some((w) => w.startsWith(t))) return 55;
  if (t.length >= 3 && ix.text.includes(t)) return 45;
  if (t.length >= 4) {
    const max = t.length >= 7 ? 2 : 1;
    if (ix.nameWords.some((w) => withinDistance(t, w, max) || (w.length > t.length && withinDistance(t, w.slice(0, t.length), max)))) return 50;
    if (ix.words.some((w) => w.length >= 4 && withinDistance(t, w, max))) return 30;
  }
  if (t.length >= 3 && isSubsequence(t, ix.compact)) return 20;
  return 0;
}

interface Query {
  tokens: string[];
  compact: string;
}

function parseQuery(q: string): Query {
  const all = normalize(q).split(' ').filter(Boolean);
  const meaningful = all.filter((t) => !STOP_WORDS.has(t));
  const tokens = meaningful.length ? meaningful : all;
  return { tokens, compact: all.join('') };
}

/** 0 = no match. AND semantics across tokens; 100 = whole query is a prefix of the name. */
function fuzzyScore(ix: SearchIndex, q: Query): number {
  if (q.compact.length >= 2 && ix.compact.startsWith(q.compact)) return 100;
  let total = 0;
  for (const t of q.tokens) {
    const s = tokenScore(t, ix);
    if (!s) return 0;
    total += s;
  }
  return total / q.tokens.length;
}

/* ================================================================== */
/* §7  PERSISTENCE                                                     */
/* ================================================================== */

type PersonalTier = 'S' | 'A' | 'B' | 'C' | 'U';
interface SavedEntry {
  tier: PersonalTier;
  addedAt: number;
}
type SavedMap = Record<string, SavedEntry>;

const SAVED_KEY = 'menswear-index:saved:v1';
const VIEW_KEY = 'menswear-index:view:v1';

const PERSONAL_TIERS: { id: PersonalTier; label: string; hint: string }[] = [
  { id: 'S', label: 'Grail', hint: 'The pinnacle — worth saving for' },
  { id: 'A', label: 'Core rotation', hint: 'Brands you buy and wear' },
  { id: 'B', label: 'Considering', hint: 'On the shortlist' },
  { id: 'C', label: 'Admire from afar', hint: 'Respect, but not for you' },
  { id: 'U', label: 'Unsorted', hint: 'Newly saved' },
];

function readSaved(): SavedMap {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '{}');
    if (!isObj(parsed)) return {};
    const out: SavedMap = {};
    for (const [id, v] of Object.entries(parsed)) {
      if (isObj(v) && typeof v.tier === 'string' && 'SABCU'.includes(v.tier)) out[id] = { tier: v.tier as PersonalTier, addedAt: Number(v.addedAt) || Date.now() };
    }
    return out;
  } catch {
    return {};
  }
}

function useSaved() {
  const [saved, setSaved] = useState<SavedMap>(readSaved);
  const hydrated = useRef(false);
  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
    } catch {
      /* storage unavailable (private mode, quota) — bookmarks stay in memory */
    }
  }, [saved]);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SAVED_KEY) setSaved(readSaved());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const toggle = useCallback((id: string) => {
    setSaved((s) => {
      const next = { ...s };
      if (next[id]) delete next[id];
      else next[id] = { tier: 'U', addedAt: Date.now() };
      return next;
    });
  }, []);
  const setTier = useCallback((id: string, tier: PersonalTier) => {
    setSaved((s) => ({ ...s, [id]: { tier, addedAt: s[id]?.addedAt ?? Date.now() } }));
  }, []);
  const remove = useCallback((id: string) => {
    setSaved((s) => {
      const next = { ...s };
      delete next[id];
      return next;
    });
  }, []);
  const clear = useCallback(() => setSaved({}), []);
  return { saved, toggle, setTier, remove, clear };
}

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

/* ================================================================== */
/* §8  UI COMPONENTS                                                   */
/* ================================================================== */

type SortKey = 'composite' | DimensionId | 'founded' | 'name';
type SortDir = 'asc' | 'desc';

interface Filters {
  query: string;
  categories: CategoryId[];
  tiers: TierId[];
  country: string;
  minScore: number;
  savedOnly: boolean;
  sort: SortKey;
  dir: SortDir;
}

const DEFAULT_FILTERS: Filters = { query: '', categories: [], tiers: [], country: '', minScore: 0, savedOnly: false, sort: 'composite', dir: 'desc' };

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: 'composite', label: 'Index score' },
  ...DIMENSIONS.map((d) => ({ id: d.id as SortKey, label: d.label })),
  { id: 'founded', label: 'Founding year' },
  { id: 'name', label: 'Name' },
];

const defaultDir = (k: SortKey): SortDir => (k === 'founded' || k === 'name' ? 'asc' : 'desc');

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

function originLine(b: Brand) {
  return [b.origin.city, b.origin.country].filter(Boolean).join(', ');
}

/* ---------- atoms ---------- */

function RankBadge({ rank, large = false }: { rank: number; large?: boolean }) {
  const top = rank <= 10;
  return (
    <span
      aria-label={`Rank ${rank}`}
      className={cx(
        'tnum inline-flex shrink-0 items-center justify-center font-medium',
        large ? 'h-11 min-w-11 px-2 text-base' : 'h-8 min-w-8 px-1.5 text-[13px]',
        top ? 'bg-ink text-paper' : 'border border-rule-strong text-ink-2',
      )}
    >
      {rank}
    </span>
  );
}

function TierMark({ tier }: { tier: TierId }) {
  const t = TIER_BY_ID[tier];
  return (
    <span className="inline-flex items-baseline gap-1.5 text-[11px] font-medium tracking-[0.12em] text-ink-2 uppercase" title={`${t.label} · ${t.band}`}>
      {t.label}
      <span className="tracking-normal text-muted" aria-hidden>
        {t.symbol}
      </span>
    </span>
  );
}

const SaveButton = memo(function SaveButton({ saved, onToggle, name, className }: { saved: boolean; onToggle: () => void; name: string; className?: string }) {
  const Icon = saved ? BookmarkCheck : Bookmark;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${name} from your list` : `Save ${name} to your list`}
      title={saved ? 'Saved — click to remove' : 'Save to your list'}
      className={cx(
        'relative z-10 inline-flex h-8 w-8 items-center justify-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
        saved ? 'text-oxblood' : 'text-muted hover:text-ink',
        className,
      )}
    >
      <Icon size={17} strokeWidth={1.6} fill={saved ? 'currentColor' : 'none'} />
    </button>
  );
});

/**
 * Score profile: one thin bar per dimension, in methodology order.
 * The shape reads at a glance (a "craft" brand vs a "design" brand); exact
 * values are in each bar's tooltip and in the deep-dive.
 */
const ScoreProfile = memo(function ScoreProfile({ scores, highlight, labelled = false }: { scores: Record<DimensionId, number>; highlight?: DimensionId; labelled?: boolean }) {
  const bw = labelled ? 13 : 6;
  const gap = labelled ? 5 : 2;
  const h = labelled ? 40 : 26;
  const labelH = labelled ? 13 : 0;
  const w = DIMENSIONS.length * (bw + gap) - gap;
  return (
    <svg width={w} height={h + labelH} viewBox={`0 0 ${w} ${h + labelH}`} role="img" aria-label={DIMENSIONS.map((d) => `${d.short} ${scores[d.id]}`).join(', ')} className="block overflow-visible">
      <line x1={0} x2={w} y1={h + 0.5} y2={h + 0.5} className="stroke-rule-strong" strokeWidth={1} />
      {DIMENSIONS.map((d, i) => {
        const v = scores[d.id];
        const bh = Math.max(2, (v / 100) * h);
        const x = i * (bw + gap);
        return (
          <g key={d.id}>
            <title>{`${d.label}: ${v}`}</title>
            {/* invisible hit target taller than the mark */}
            <rect x={x - gap / 2} y={0} width={bw + gap} height={h} fill="transparent" />
            <rect x={x} y={h - bh} width={bw} height={bh} rx={1} className={highlight === d.id ? 'fill-oxblood' : 'fill-ink-2'} />
            {labelled && (
              <text x={x + bw / 2} y={h + labelH - 1} textAnchor="middle" className={cx('text-[8px] font-semibold tracking-wide', highlight === d.id ? 'fill-oxblood' : 'fill-muted')}>
                {d.abbr}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
});

function Chip({ active, onClick, children, count }: { active: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 border px-2.5 py-1.5 text-[12px] whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink',
        active ? 'border-ink bg-ink text-paper' : 'border-rule bg-panel text-ink-2 hover:border-ink-2',
        count === 0 && !active && 'opacity-45',
      )}
    >
      {children}
      {count !== undefined && <span className={cx('tnum text-[10px]', active ? 'text-paper/70' : 'text-muted')}>{count}</span>}
    </button>
  );
}

function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('text-[10.5px] font-semibold tracking-[0.18em] text-muted uppercase', className)}>{children}</div>;
}

/* ---------- masthead ---------- */

function Masthead({ ranked, data, tab, setTab, savedCount }: { ranked: RankedBrand[]; data: DataState; tab: Tab; setTab: (t: Tab) => void; savedCount: number }) {
  const stats = useMemo(() => {
    const sorted = ranked.map((b) => b.composite).sort((a, b) => a - b);
    return {
      total: ranked.length,
      disciplines: new Set(ranked.map((b) => b.category)).size,
      countries: new Set(ranked.map((b) => b.origin.countryCode)).size,
      median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
    };
  }, [ranked]);
  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'index', label: 'The Index' },
    { id: 'list', label: 'My List', badge: savedCount },
    { id: 'method', label: 'Methodology' },
  ];
  return (
    <header className="border-b border-ink">
      <div className="mx-auto max-w-[1360px] px-4 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule py-2.5 text-[11px] tracking-[0.14em] text-muted uppercase">
          <span>Methodology v{METHODOLOGY_VERSION} · Edition {new Date().getFullYear()}</span>
          <span className="inline-flex items-center gap-1.5 normal-case tracking-normal">
            <Database size={12} aria-hidden />
            {data.status === 'loading' ? (
              <span>Loading full index…</span>
            ) : data.source === 'remote' ? (
              <span>brands.json{data.generatedAt ? ` · ${data.generatedAt.slice(0, 10)}` : ''}</span>
            ) : (
              <span title={data.error}>Embedded sample (brands.json unavailable)</span>
            )}
          </span>
        </div>
        <div className="grid gap-6 py-8 sm:py-12 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <h1 className="font-serif text-[clamp(2.75rem,8vw,6.25rem)] leading-[0.92] tracking-[-0.01em]">
              The Menswear <em className="italic">Index</em>
            </h1>
            <p className="mt-4 max-w-xl font-serif text-xl leading-snug text-ink-2 italic sm:text-2xl">
              A quantitative ranking of houses, ateliers and labels — weighted for what lasts.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4 lg:gap-x-10">
            {[
              ['Brands', nf.format(stats.total)],
              ['Disciplines', nf.format(stats.disciplines)],
              ['Countries', nf.format(stats.countries)],
              ['Median score', stats.median.toFixed(1)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[10.5px] font-semibold tracking-[0.18em] text-muted uppercase">{k}</dt>
                <dd className="tnum mt-1 font-serif text-3xl">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <nav aria-label="Sections" className="-mb-px flex gap-6">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={cx(
                'inline-flex items-center gap-2 border-b-2 pt-1 pb-3 text-[13px] font-medium tracking-wide transition-colors',
                tab === t.id ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink',
              )}
            >
              {t.label}
              {!!t.badge && <span className="tnum inline-flex h-4.5 min-w-4.5 items-center justify-center bg-oxblood px-1 text-[10px] text-paper">{t.badge}</span>}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}

/* ---------- control panel ---------- */

interface Facets {
  categoryCounts: Record<CategoryId, number>;
  tierCounts: Record<TierId, number>;
  countries: { code: string; name: string; count: number }[];
}

function ControlPanel({
  filters,
  setFilters,
  facets,
  resultCount,
  total,
  view,
  setView,
  searchRef,
}: {
  filters: Filters;
  setFilters: (f: (prev: Filters) => Filters) => void;
  facets: Facets;
  resultCount: number;
  total: number;
  view: View;
  setView: (v: View) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const activeCount =
    filters.categories.length + filters.tiers.length + (filters.country ? 1 : 0) + (filters.minScore > 0 ? 1 : 0) + (filters.savedOnly ? 1 : 0);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const toggleIn = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const isDirty = activeCount > 0 || filters.query !== '';

  return (
    <>
      {/* sticky search & sort bar */}
      <div className="sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2 py-3 sm:flex-nowrap sm:gap-3">
          <label className="relative order-1 flex min-w-0 flex-1 basis-full items-center sm:basis-auto">
            <span className="sr-only">Search brands, signature pieces, cities, tags</span>
            <Search size={16} className="pointer-events-none absolute left-3 text-muted" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={filters.query}
              onChange={(e) => set('query', e.target.value)}
              placeholder="Search brands, signature pieces, places…"
              autoComplete="off"
              spellCheck={false}
              className="h-10 w-full border border-rule bg-panel pr-16 pl-9 text-[14px] placeholder:text-muted/80 focus:border-ink focus:outline-none [&::-webkit-search-cancel-button]:hidden"
            />
            {filters.query ? (
              <button type="button" onClick={() => set('query', '')} aria-label="Clear search" className="absolute right-2 inline-flex h-7 w-7 items-center justify-center text-muted hover:text-ink">
                <X size={15} />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-3 hidden border border-rule px-1.5 text-[11px] text-muted sm:inline">/</kbd>
            )}
          </label>

          <div className="order-2 flex min-w-0 items-center gap-2">
            <label className="flex min-w-0 items-center">
              <span className="sr-only">Sort by</span>
              <select
                value={filters.sort}
                onChange={(e) => {
                  const k = e.target.value as SortKey;
                  setFilters((f) => ({ ...f, sort: k, dir: defaultDir(k) }));
                }}
                className="h-10 w-full max-w-[9.5rem] border border-rule bg-panel px-2.5 text-[13px] focus:border-ink focus:outline-none sm:max-w-[11.5rem]"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    Sort: {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => set('dir', filters.dir === 'desc' ? 'asc' : 'desc')}
              aria-label={filters.dir === 'desc' ? 'Sorted descending — switch to ascending' : 'Sorted ascending — switch to descending'}
              title={filters.dir === 'desc' ? 'Descending' : 'Ascending'}
              className="inline-flex h-10 w-10 items-center justify-center border border-rule bg-panel hover:border-ink"
            >
              {filters.dir === 'desc' ? <ArrowDown size={16} /> : <ArrowUp size={16} />}
            </button>
          </div>

          <div className="order-3 ml-auto flex items-center gap-2 sm:ml-0">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls="facet-panel"
              aria-label="Filters"
              className="inline-flex h-10 items-center gap-2 border border-rule bg-panel px-2.5 text-[13px] hover:border-ink md:hidden"
            >
              <SlidersHorizontal size={15} />
              <span className="hidden sm:inline">Filters</span>
              {activeCount > 0 && <span className="tnum bg-ink px-1.5 text-[10px] text-paper">{activeCount}</span>}
            </button>
            <div className="inline-flex border border-rule bg-panel" role="group" aria-label="Layout">
              {(
                [
                  ['list', LayoutList, 'Leaderboard'],
                  ['grid', LayoutGrid, 'Grid'],
                ] as const
              ).map(([v, Icon, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  aria-label={label}
                  title={label}
                  className={cx('inline-flex h-[38px] w-10 items-center justify-center', view === v ? 'bg-ink text-paper' : 'text-muted hover:text-ink')}
                >
                  <Icon size={16} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* facets */}
      <div id="facet-panel" className={cx('space-y-4 border-b border-rule py-5', !open && 'hidden md:block')}>
        <div>
          <Eyebrow className="mb-2">Discipline</Eyebrow>
          <div className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:-mx-8 sm:px-8 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
            {CATEGORIES.map((c) => (
              <Chip key={c.id} active={filters.categories.includes(c.id)} count={facets.categoryCounts[c.id]} onClick={() => set('categories', toggleIn(filters.categories, c.id))}>
                {c.label}
              </Chip>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div>
            <Eyebrow className="mb-2">Market tier</Eyebrow>
            <div className="flex flex-wrap gap-1.5">
              {TIERS.map((t) => (
                <Chip key={t.id} active={filters.tiers.includes(t.id)} count={facets.tierCounts[t.id]} onClick={() => set('tiers', toggleIn(filters.tiers, t.id))}>
                  {t.label} <span className="opacity-60">{t.symbol}</span>
                </Chip>
              ))}
            </div>
          </div>
          <label className="block">
            <Eyebrow className="mb-2">Origin</Eyebrow>
            <select value={filters.country} onChange={(e) => set('country', e.target.value)} className="h-8 w-48 border border-rule bg-panel px-2 text-[12px] focus:border-ink focus:outline-none">
              <option value="">All countries</option>
              {facets.countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.count})
                </option>
              ))}
            </select>
          </label>
          <label className="block w-44">
            <Eyebrow className="mb-2">
              Min. score <span className="tnum text-ink">{filters.minScore > 0 ? `≥ ${filters.minScore}` : 'any'}</span>
            </Eyebrow>
            <input type="range" min={0} max={90} step={5} value={filters.minScore} onChange={(e) => set('minScore', Number(e.target.value))} className="h-8 w-full" />
          </label>
          <div className="flex items-center gap-1.5">
            <Chip active={filters.savedOnly} onClick={() => set('savedOnly', !filters.savedOnly)}>
              <Bookmark size={12} /> Saved only
            </Chip>
            <button
              type="button"
              onClick={() => setFilters((f) => ({ ...DEFAULT_FILTERS, sort: f.sort, dir: f.dir }))}
              disabled={!isDirty}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-muted hover:text-ink disabled:opacity-40 disabled:hover:text-muted"
            >
              <RotateCcw size={12} /> Reset
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-baseline justify-between py-3 text-[12px] text-muted" aria-live="polite">
        <span>
          <span className="tnum text-ink">{nf.format(resultCount)}</span> of <span className="tnum">{nf.format(total)}</span> brands
        </span>
        <span className="hidden sm:inline">Ranked by composite index · click any brand for the full dossier</span>
      </div>
    </>
  );
}

/* ---------- leaderboard (virtualised) ---------- */

const ROW_HEIGHT = 76;

function useWindowVirtual(count: number, rowHeight: number, overscan = 8) {
  const ref = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<[number, number]>([0, Math.min(count, 24)]);
  useLayoutEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const scrolled = Math.max(0, -el.getBoundingClientRect().top);
      const start = Math.max(0, Math.floor(scrolled / rowHeight) - overscan);
      const end = Math.min(count, Math.ceil((scrolled + window.innerHeight) / rowHeight) + overscan);
      setRange((p) => (p[0] === start && p[1] === end ? p : [start, end]));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(raf);
    };
  }, [count, rowHeight, overscan]);
  return { ref, range };
}

interface ItemProps {
  brand: RankedBrand;
  saved: boolean;
  sortKey: SortKey;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
}

const LeaderRow = memo(function LeaderRow({ brand: b, saved, sortKey, onOpen, onToggle }: ItemProps) {
  const dim = (DIMENSION_IDS as readonly string[]).includes(sortKey) ? (sortKey as DimensionId) : undefined;
  return (
    <div className="group relative grid h-full grid-cols-[40px_minmax(0,1fr)_auto_32px] items-center gap-x-3 border-b border-rule px-1 transition-colors hover:bg-panel sm:px-4 md:grid-cols-[52px_minmax(0,2.4fr)_minmax(0,1.3fr)_88px_minmax(0,1.7fr)_80px_36px] md:gap-x-4">
      <RankBadge rank={b.rank} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpen(b.id)}
            className="truncate text-left font-serif text-[22px] leading-tight after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ink group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4"
          >
            {b.name}
          </button>
         
        </div>
        <div className="truncate text-[12px] text-muted">
          {originLine(b)}
          {b.founded ? ` · Est. ${b.founded}` : ''}
          <span className="md:hidden"> · {CATEGORY_BY_ID[b.category].label}</span>
        </div>
      </div>
      <div className="hidden min-w-0 md:block">
        <div className="truncate text-[13px] text-ink-2">{CATEGORY_BY_ID[b.category].label}</div>
        <TierMark tier={b.tier} />
      </div>
      <div className="hidden md:block">
        <ScoreProfile scores={b.scores} highlight={dim} />
      </div>
      <div className="hidden min-w-0 md:block">
        <div className="truncate font-serif text-[16px] text-ink-2 italic">{b.signatures[0]?.name ?? '—'}</div>
        {b.signatures.length > 1 && <div className="truncate text-[11.5px] text-muted">+ {b.signatures.slice(1).map((s) => s.name).join(', ')}</div>}
      </div>
      <div className="text-right">
        <div className="tnum font-serif text-[26px] leading-none">{b.composite.toFixed(1)}</div>
        {dim ? (
          <div className="tnum mt-1 text-[11px] text-oxblood">
            {DIM_BY_ID[dim].abbr} {b.scores[dim]}
          </div>
        ) : (
          <div className="tnum mt-1 text-[11px] text-muted">top {Math.max(1, 100 - b.percentile)}%</div>
        )}
      </div>
      <SaveButton saved={saved} onToggle={() => onToggle(b.id)} name={b.name} />
    </div>
  );
});

/** Column header; sticks directly beneath the 65px toolbar (md+ only, where the toolbar is one row). */
function LeaderHeader() {
  return (
    <div
      aria-hidden
      className="sticky top-[65px] z-20 hidden grid-cols-[52px_minmax(0,2.4fr)_minmax(0,1.3fr)_88px_minmax(0,1.7fr)_80px_36px] gap-x-4 border-b border-ink bg-paper/95 px-4 py-2 text-[10.5px] font-semibold tracking-[0.16em] text-muted uppercase backdrop-blur md:grid"
    >
      <span>Rank</span>
      <span>Brand</span>
      <span>Discipline · Tier</span>
      <span title={DIMENSIONS.map((d) => `${d.abbr} ${d.label}`).join('\n')}>Profile</span>
      <span>Signature</span>
      <span className="text-right">Score</span>
      <span />
    </div>
  );
}

function Leaderboard({ items, saved, sortKey, onOpen, onToggle }: { items: RankedBrand[]; saved: SavedMap; sortKey: SortKey; onOpen: (id: string) => void; onToggle: (id: string) => void }) {
  const { ref, range } = useWindowVirtual(items.length, ROW_HEIGHT);
  const [start, end] = range;
  return (
    <>
      <LeaderHeader />
      <div ref={ref} role="list" aria-label="Brand leaderboard" className="relative border-t border-ink md:border-t-0" style={{ height: items.length * ROW_HEIGHT }}>
        {items.slice(start, end).map((b, i) => (
          <div key={b.id} role="listitem" className="absolute inset-x-0" style={{ top: (start + i) * ROW_HEIGHT, height: ROW_HEIGHT }}>
            <LeaderRow brand={b} saved={!!saved[b.id]} sortKey={sortKey} onOpen={onOpen} onToggle={onToggle} />
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------- grid (paged infinite scroll) ---------- */

const GRID_PAGE = 48;

const BrandCard = memo(function BrandCard({ brand: b, saved, sortKey, onOpen, onToggle }: ItemProps) {
  const dim = (DIMENSION_IDS as readonly string[]).includes(sortKey) ? (sortKey as DimensionId) : undefined;
  return (
    <article className="group relative flex flex-col border border-rule bg-panel p-5 transition-colors hover:border-ink">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <RankBadge rank={b.rank} />
         
        </div>
        <SaveButton saved={saved} onToggle={() => onToggle(b.id)} name={b.name} className="-mt-1 -mr-1.5" />
      </div>
      <h3 className="mt-4">
        <button type="button" onClick={() => onOpen(b.id)} className="text-left font-serif text-[28px] leading-[1.05] after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ink">
          {b.name}
        </button>
      </h3>
      <p className="mt-1 text-[12px] text-muted">
        {originLine(b)}
        {b.founded ? ` · Est. ${b.founded}` : ''}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[12.5px] text-ink-2">{CATEGORY_BY_ID[b.category].label}</span>
        <TierMark tier={b.tier} />
      </div>
      <div className="mt-5 flex items-end justify-between gap-4 border-t border-rule pt-4">
        <ScoreProfile scores={b.scores} highlight={dim} labelled />
        <div className="text-right">
          <div className="tnum font-serif text-[40px] leading-none">{b.composite.toFixed(1)}</div>
          <div className="tnum mt-1 text-[11px] text-muted">{dim ? `${DIM_BY_ID[dim].short} ${b.scores[dim]}` : `#${b.categoryRank} in discipline`}</div>
        </div>
      </div>
      {b.signatures[0] && (
        <p className="mt-4 border-t border-rule pt-3 text-[12px] text-muted">
          <span className="tracking-[0.14em] uppercase">Signature</span> <span className="font-serif text-[15px] text-ink-2 italic">{b.signatures[0].name}</span>
        </p>
      )}
    </article>
  );
});

function GridView({ items, saved, sortKey, onOpen, onToggle }: { items: RankedBrand[]; saved: SavedMap; sortKey: SortKey; onOpen: (id: string) => void; onToggle: (id: string) => void }) {
  const [limit, setLimit] = useState(GRID_PAGE);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => setLimit(GRID_PAGE), [items]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || limit >= items.length) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setLimit((l) => Math.min(items.length, l + GRID_PAGE)), { rootMargin: '900px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [items.length, limit]);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {items.slice(0, limit).map((b) => (
          <BrandCard key={b.id} brand={b} saved={!!saved[b.id]} sortKey={sortKey} onOpen={onOpen} onToggle={onToggle} />
        ))}
      </div>
      {limit < items.length && (
        <div ref={sentinel} className="flex justify-center py-10">
          <button type="button" onClick={() => setLimit((l) => l + GRID_PAGE)} className="border border-ink px-5 py-2.5 text-[13px] hover:bg-ink hover:text-paper">
            Show more · {nf.format(items.length - limit)} remaining
          </button>
        </div>
      )}
    </>
  );
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="border-t border-ink py-24 text-center">
      <p className="font-serif text-3xl">Nothing on the rail.</p>
      <p className="mt-2 text-[14px] text-muted">No brands match the current search and filters.</p>
      <button type="button" onClick={onReset} className="mt-6 inline-flex items-center gap-2 border border-ink px-4 py-2 text-[13px] hover:bg-ink hover:text-paper">
        <RotateCcw size={14} /> Reset filters
      </button>
    </div>
  );
}

/* ---------- deep-dive drawer ---------- */

function DimensionBars({ brand, medians, weights }: { brand: RankedBrand; medians: Record<DimensionId, number>; weights: Weights }) {
  return (
    <div>
      <ul className="space-y-4">
        {DIMENSIONS.map((d) => {
          const v = brand.scores[d.id];
          const m = medians[d.id];
          const delta = v - m;
          return (
            <li key={d.id} title={`${d.label}: ${v} (catalogue median ${m}) — ${d.question}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-ink">
                  {d.label} <span className="tnum ml-1 text-[11px] text-muted">{Math.round(weights[d.id] * 100)}%</span>
                </span>
                <span className="tnum flex items-baseline gap-3">
                  <span className={cx('text-[11px]', delta >= 0 ? 'text-ink-2' : 'text-muted')}>
                    {delta >= 0 ? '+' : '−'}
                    {Math.abs(delta)} vs median
                  </span>
                  <span className="font-serif text-[22px] leading-none">{v}</span>
                </span>
              </div>
              <div className="relative mt-1.5 h-[6px] bg-rule/70">
                <div className="absolute inset-y-0 left-0 rounded-r-[3px] bg-ink" style={{ width: `${v}%` }} />
                <div className="absolute -top-[3px] -bottom-[3px] w-[2px] bg-oxblood ring-2 ring-paper" style={{ left: `calc(${m}% - 1px)` }} aria-hidden />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-[6px] w-4 bg-ink" aria-hidden /> Brand score
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-[2px] bg-oxblood" aria-hidden /> Catalogue median
        </span>
        <span>% = weight in composite</span>
      </div>
    </div>
  );
}

function BrandDrawer({
  brand: b,
  total,
  medians,
  weights,
  savedEntry,
  onClose,
  onToggle,
  onSetTier,
}: {
  brand: RankedBrand;
  total: number;
  medians: Record<DimensionId, number>;
  weights: Weights;
  savedEntry?: SavedEntry;
  onClose: () => void;
  onToggle: (id: string) => void;
  onSetTier: (id: string, t: PersonalTier) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => prev?.focus?.();
  }, []);
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
  }, [b.id]);
  // minimal focus trap
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const f = panelRef.current.querySelectorAll<HTMLElement>('button, select, a[href], [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  const cat = CATEGORY_BY_ID[b.category];
  const tier = TIER_BY_ID[b.tier];
  const facts: [string, ReactNode][] = [
    ['Founded', b.founded ?? '—'],
    ['Origin', originLine(b)],
    ['Discipline', [cat.label, ...(b.subcategories ?? []).map((c) => CATEGORY_BY_ID[c].label)].join(' · ')],
    ['Tier', `${tier.label} ${tier.symbol} · ${tier.band}`],
    ['Indicative price', b.priceUSD ? `$${nf.format(b.priceUSD.from)}–${nf.format(b.priceUSD.to)}${b.priceUSD.reference ? ` · ${b.priceUSD.reference}` : ''}` : '—'],
    ['Production', b.production?.length ? b.production.join(', ') : 'Undisclosed / mixed'],
    ['Ownership', b.ownership ? `${b.ownership.type.replace('-', ' ')}${b.ownership.parent ? ` · ${b.ownership.parent}` : ''}` : '—'],
    ['Record', `${b.provenance}${b.updatedAt ? ` · updated ${b.updatedAt}` : ''}`],
  ];
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="drawer-title" onKeyDown={onKeyDown}>
      <div className="animate-fade-in absolute inset-0 bg-ink/45" onClick={onClose} aria-hidden />
      <div ref={panelRef} className="animate-drawer-in absolute inset-y-0 right-0 flex w-full max-w-[640px] flex-col overflow-y-auto overscroll-contain bg-paper shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-rule bg-paper/95 px-6 py-3 backdrop-blur sm:px-10">
          <Eyebrow>Dossier · {cat.label}</Eyebrow>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close dossier" className="-mr-2 inline-flex h-9 w-9 items-center justify-center hover:bg-rule/50">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pt-8 pb-16 sm:px-10">
          <div className="flex items-start gap-4">
            <RankBadge rank={b.rank} large />
            <div className="min-w-0 text-[12px] leading-relaxed text-muted">
              <div>
                Ranked <span className="tnum text-ink">#{b.rank}</span> of <span className="tnum">{nf.format(total)}</span> overall
              </div>
              <div>
                <span className="tnum text-ink">#{b.categoryRank}</span> of <span className="tnum">{b.categoryCount}</span> in {cat.label}
              </div>
            </div>
          </div>
          <h2 id="drawer-title" className="mt-5 font-serif text-[clamp(2.4rem,7vw,3.75rem)] leading-[0.95]">
            {b.name}
          </h2>
          <p className="mt-2 text-[13px] text-muted">
            {originLine(b)}
            {b.founded ? ` · Est. ${b.founded}` : ''} · <TierMark tier={b.tier} />
          </p>

          <div className="mt-8 grid grid-cols-[auto_1fr] items-end gap-6 border-y border-ink py-6">
            <div>
              <Eyebrow>Index score</Eyebrow>
              <div className="tnum mt-1 font-serif text-[72px] leading-[0.85]">{b.composite.toFixed(1)}</div>
              <div className="mt-2 text-[12px] text-muted">Top {Math.max(1, 100 - b.percentile)}% of the catalogue</div>
            </div>
            <div className="flex justify-end">
              <ScoreProfile scores={b.scores} labelled />
            </div>
            <div className="tnum col-span-2 font-mono text-[11px] leading-relaxed text-muted">
              arithmetic {b.arithmetic.toFixed(1)} · geometric {b.geometric.toFixed(1)} → balanced {b.balanced.toFixed(1)} · confidence {b.confidence.toFixed(2)} → <span className="text-ink">{b.composite.toFixed(1)}</span>
            </div>
          </div>

          {b.editorial.summary && <p className="mt-8 font-serif text-[22px] leading-[1.35] text-ink">{b.editorial.summary}</p>}
          {(b.editorial.strengths.length > 0 || b.editorial.caveats.length > 0) && (
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <div>
                <Eyebrow className="mb-2">Strengths</Eyebrow>
                <ul className="space-y-1.5 text-[13.5px] leading-snug text-ink-2">
                  {b.editorial.strengths.map((s) => (
                    <li key={s} className="flex gap-2">
                      <span className="mt-[7px] h-px w-3 shrink-0 bg-ink" aria-hidden />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <Eyebrow className="mb-2">Caveats</Eyebrow>
                <ul className="space-y-1.5 text-[13.5px] leading-snug text-ink-2">
                  {b.editorial.caveats.map((s) => (
                    <li key={s} className="flex gap-2">
                      <span className="mt-[7px] h-px w-3 shrink-0 bg-oxblood" aria-hidden />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <section className="mt-10">
            <h3 className="mb-4 font-serif text-[26px]">Score breakdown</h3>
            <DimensionBars brand={b} medians={medians} weights={weights} />
          </section>

          {b.signatures.length > 0 && (
            <section className="mt-10">
              <h3 className="mb-3 font-serif text-[26px]">Signature pieces</h3>
              <ol className="divide-y divide-rule border-y border-rule">
                {b.signatures.map((s, i) => (
                  <li key={s.name} className="flex gap-4 py-3">
                    <span className="tnum w-5 pt-0.5 text-[12px] text-muted">{String(i + 1).padStart(2, '0')}</span>
                    <div>
                      <div className="font-serif text-[19px] leading-tight italic">{s.name}</div>
                      {s.note && <div className="mt-0.5 text-[12.5px] text-muted">{s.note}</div>}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="mt-10">
            <h3 className="mb-3 font-serif text-[26px]">Fact sheet</h3>
            <dl className="divide-y divide-rule border-y border-rule text-[13px]">
              {facts.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[9rem_1fr] gap-4 py-2.5">
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-ink-2 first-letter:uppercase">{v}</dd>
                </div>
              ))}
            </dl>
            {!!b.tags?.length && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {b.tags.map((t) => (
                  <span key={t} className="border border-rule px-2 py-0.5 text-[11px] text-muted">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="mt-10 border border-ink p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Eyebrow>Your list</Eyebrow>
                <p className="mt-1 text-[13px] text-ink-2">{savedEntry ? 'Saved on this device. Place it in your personal tier list:' : 'Save this brand to build a personal tier list (stored locally).'}</p>
              </div>
              <button
                type="button"
                onClick={() => onToggle(b.id)}
                className={cx('inline-flex items-center gap-2 border px-4 py-2 text-[13px]', savedEntry ? 'border-oxblood text-oxblood hover:bg-oxblood hover:text-paper' : 'border-ink bg-ink text-paper hover:bg-ink-2')}
              >
                {savedEntry ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
                {savedEntry ? 'Saved — remove' : 'Save brand'}
              </button>
            </div>
            {savedEntry && (
              <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Personal tier">
                {PERSONAL_TIERS.map((t) => (
                  <Chip key={t.id} active={savedEntry.tier === t.id} onClick={() => onSetTier(b.id, t.id)}>
                    <span className="font-semibold">{t.id === 'U' ? '—' : t.id}</span> {t.label}
                  </Chip>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/* ---------- my list / personal tier list ---------- */

function MyListView({
  byId,
  saved,
  onOpen,
  onSetTier,
  onRemove,
  onClear,
  onBrowse,
}: {
  byId: Map<string, RankedBrand>;
  saved: SavedMap;
  onOpen: (id: string) => void;
  onSetTier: (id: string, t: PersonalTier) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onBrowse: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const entries = Object.entries(saved);
  const missing = entries.filter(([id]) => !byId.has(id)).length;
  const groups = PERSONAL_TIERS.map((t) => ({
    ...t,
    brands: entries
      .filter(([id, e]) => e.tier === t.id && byId.has(id))
      .map(([id]) => byId.get(id)!)
      .sort((a, b) => a.rank - b.rank),
  }));
  const exportList = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      methodologyVersion: METHODOLOGY_VERSION,
      tiers: groups.map((g) => ({ tier: g.id, label: g.label, brands: g.brands.map((b) => ({ id: b.id, name: b.name, score: b.composite, rank: b.rank })) })),
    };
    navigator.clipboard
      ?.writeText(JSON.stringify(payload, null, 2))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => setCopied(false));
  };
  if (!entries.length) {
    return (
      <div className="py-24 text-center">
        <p className="font-serif text-4xl">Your list is empty.</p>
        <p className="mx-auto mt-3 max-w-md text-[14px] text-muted">Use the bookmark on any brand to save it, then sort your saves into a personal tier list. Everything stays in this browser.</p>
        <button type="button" onClick={onBrowse} className="mt-6 border border-ink px-5 py-2.5 text-[13px] hover:bg-ink hover:text-paper">
          Browse the index
        </button>
      </div>
    );
  }
  return (
    <div className="py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-serif text-5xl">My tier list</h2>
          <p className="mt-2 text-[13px] text-muted">
            {entries.length - missing} saved brand{entries.length - missing === 1 ? '' : 's'} · stored locally on this device
            {missing > 0 && ` · ${missing} not in the current dataset`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={exportList} className="inline-flex items-center gap-2 border border-rule bg-panel px-3 py-2 text-[12.5px] hover:border-ink">
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied JSON' : 'Copy as JSON'}
          </button>
          {confirmClear ? (
            <span className="inline-flex items-center gap-1 text-[12.5px]">
              <span className="text-muted">Clear all?</span>
              <button
                type="button"
                onClick={() => {
                  onClear();
                  setConfirmClear(false);
                }}
                className="border border-oxblood px-2.5 py-2 text-oxblood hover:bg-oxblood hover:text-paper"
              >
                Yes, clear
              </button>
              <button type="button" onClick={() => setConfirmClear(false)} className="px-2.5 py-2 text-muted hover:text-ink">
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmClear(true)} className="inline-flex items-center gap-2 px-3 py-2 text-[12.5px] text-muted hover:text-oxblood">
              <Trash2 size={14} /> Clear
            </button>
          )}
        </div>
      </div>
      <div className="mt-8 border-t border-ink">
        {groups.map((g) => (
          <section key={g.id} className="grid gap-4 border-b border-rule py-5 md:grid-cols-[200px_1fr]">
            <div className="flex items-baseline gap-3 md:block">
              <div className="font-serif text-5xl leading-none">{g.id === 'U' ? '—' : g.id}</div>
              <div>
                <div className="mt-1 text-[13px] font-medium">{g.label}</div>
                <div className="text-[11.5px] text-muted">{g.hint}</div>
              </div>
            </div>
            {g.brands.length ? (
              <ul className="flex flex-wrap gap-2">
                {g.brands.map((b) => (
                  <li key={b.id} className="flex items-stretch border border-rule bg-panel">
                    <button type="button" onClick={() => onOpen(b.id)} className="flex items-baseline gap-2 px-3 py-2 text-left hover:bg-paper">
                      <span className="font-serif text-[18px] leading-none">{b.name}</span>
                      <span className="tnum text-[11px] text-muted">
                        {b.composite.toFixed(1)} · #{b.rank}
                      </span>
                    </button>
                    <label className="flex items-center border-l border-rule">
                      <span className="sr-only">Move {b.name} to tier</span>
                      <select value={g.id} onChange={(e) => onSetTier(b.id, e.target.value as PersonalTier)} className="h-full bg-transparent px-1.5 text-[12px] focus:outline-none">
                        {PERSONAL_TIERS.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.id === 'U' ? '—' : t.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" onClick={() => onRemove(b.id)} aria-label={`Remove ${b.name}`} className="border-l border-rule px-2 text-muted hover:text-oxblood">
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="self-center text-[12.5px] text-muted italic">Nothing here yet.</p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

/* ---------- methodology ---------- */

function MethodologyView({ weights }: { weights: Weights }) {
  return (
    <article className="mx-auto max-w-3xl py-10">
      <Eyebrow>Methodology v{METHODOLOGY_VERSION}</Eyebrow>
      <h2 className="mt-2 font-serif text-5xl leading-none">How the index is built</h2>
      <p className="mt-6 font-serif text-[22px] leading-snug text-ink-2">
        The index asks one question: if you spent your money here, how good is what you would own — and for how long? Every brand is assessed on eight dimensions, each scored 0–100 against a written rubric, then combined into a single composite.
      </p>

      <h3 className="mt-12 border-t border-ink pt-4 font-serif text-3xl">1 · The eight dimensions</h3>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-ink text-[10.5px] tracking-[0.16em] text-muted uppercase">
              <th className="py-2 pr-4 font-semibold">Dimension</th>
              <th className="py-2 pr-4 text-right font-semibold">Weight</th>
              <th className="py-2 font-semibold">What is assessed · why this weight</th>
            </tr>
          </thead>
          <tbody>
            {DIMENSIONS.map((d) => (
              <tr key={d.id} className="border-b border-rule align-top">
                <td className="py-3 pr-4">
                  <div className="font-medium">{d.label}</div>
                  <div className="text-[11px] text-muted">{d.abbr}</div>
                </td>
                <td className="tnum py-3 pr-4 text-right font-serif text-2xl">{Math.round(weights[d.id] * 100)}%</td>
                <td className="py-3 text-ink-2">
                  <div>{d.question}</div>
                  <div className="mt-1 text-muted">{d.rationale}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-[13.5px] leading-relaxed text-ink-2">
        The distribution is deliberate: <strong className="font-semibold">40%</strong> on the physical object (materials, construction), <strong className="font-semibold">30%</strong> on how it lives with you (design, longevity),{' '}
        <strong className="font-semibold">20%</strong> on market context (value, reputation) and <strong className="font-semibold">10%</strong> on institutional behaviour (consistency, transparency).
      </p>

      <h3 className="mt-12 border-t border-ink pt-4 font-serif text-3xl">2 · The composite</h3>
      <div className="mt-4 overflow-x-auto border border-rule bg-panel p-5 font-mono text-[12.5px] leading-7">
        <div>A = Σ wᵢ·sᵢ{'                 '}weighted arithmetic mean</div>
        <div>G = Π sᵢ^wᵢ{'                 '}weighted geometric mean</div>
        <div>
          B = {BLEND}·A + {1 - BLEND}·G{'        '}balanced score
        </div>
        <div>
          Index = {PRIOR} + c·(B − {PRIOR}){'      '}confidence shrinkage, c ∈ [{MIN_CONFIDENCE}, 1]
        </div>
      </div>
      <ul className="mt-4 space-y-3 text-[13.5px] leading-relaxed text-ink-2">
        <li>
          <strong className="font-semibold text-ink">Balance over spikes.</strong> The geometric component penalises weak links: a brand with world-class design and poor construction cannot buy its way to the top with one spectacular dimension.
        </li>
        <li>
          <strong className="font-semibold text-ink">Confidence shrinkage.</strong> Each record carries an evidence confidence <em>c</em>. Thinly-evidenced scores are pulled toward a prior of {PRIOR} (“competent, unremarkable”), so a newcomer needs real evidence to outrank an established maker.
        </li>
        <li>
          <strong className="font-semibold text-ink">Dynamic ranks.</strong> Ranks are recomputed in the browser from raw sub-scores every time data loads, using competition ranking (1-2-2-4). Ties break on Construction, then Material, then name. Each brand also receives a discipline rank and a catalogue percentile.
        </li>
        <li>
          <strong className="font-semibold text-ink">Tier-relative value.</strong> Value Integrity is scored against peers in the same market tier, so it measures how much quality a brand delivers <em>for what it is</em>.
        </li>
      </ul>

      <h3 className="mt-12 border-t border-ink pt-4 font-serif text-3xl">3 · Market tiers</h3>
      <p className="mt-2 text-[13px] text-muted">{TIER_BAND_NOTE}</p>
      <dl className="mt-4 divide-y divide-rule border-y border-rule">
        {TIERS.map((t) => (
          <div key={t.id} className="grid grid-cols-[7.5rem_6rem_1fr] gap-4 py-3 text-[13px]">
            <dt className="font-medium">
              {t.label} <span className="text-muted">{t.symbol}</span>
            </dt>
            <dd className="tnum text-ink-2">{t.band}</dd>
            <dd className="text-ink-2">{t.description}</dd>
          </div>
        ))}
      </dl>

      <h3 className="mt-12 border-t border-ink pt-4 font-serif text-3xl">4 · Disciplines</h3>
      <p className="mt-2 text-[13px] text-muted">Each brand has one primary discipline (which determines its discipline rank) and optional secondary disciplines (which make it discoverable under those filters).</p>
      <dl className="mt-4 grid gap-x-8 sm:grid-cols-2">
        {CATEGORIES.map((c) => (
          <div key={c.id} className="border-b border-rule py-3">
            <dt className="font-serif text-xl">{c.label}</dt>
            <dd className="mt-1 text-[12.5px] leading-snug text-ink-2">{c.description}</dd>
            <dd className="mt-1 text-[11.5px] text-muted italic">{c.examples}</dd>
          </div>
        ))}
      </dl>

      <h3 className="mt-12 border-t border-ink pt-4 font-serif text-3xl">5 · Reading the scores honestly</h3>
      <ul className="mt-4 space-y-3 text-[13.5px] leading-relaxed text-ink-2">
        <li>Curated scores are editorial assessments synthesised from construction analysis, materials sourcing, ownership history and enthusiast consensus. They are informed opinion, not laboratory measurements or audits.</li>
        <li>Brands change — ownership, factories and quality drift. Every record carries an updated date; treat older assessments with proportionate caution.</li>
      </ul>
    </article>
  );
}

/* ================================================================== */
/* §9  APP SHELL                                                       */
/* ================================================================== */

type Tab = 'index' | 'list' | 'method';
type View = 'list' | 'grid';
const BRAND_HASH = '#brand/';

function idFromHash(): string | null {
  return window.location.hash.startsWith(BRAND_HASH) ? decodeURIComponent(window.location.hash.slice(BRAND_HASH.length)) : null;
}

export default function App() {
  const data = useDataset();
  const { saved, toggle, setTier, remove, clear } = useSaved();
  const ranked = useMemo(() => rankBrands(data.brands, data.weights), [data.brands, data.weights]);
  const medians = useMemo(() => dimensionMedians(ranked), [ranked]);
  const byId = useMemo(() => new Map(ranked.map((b) => [b.id, b])), [ranked]);

  const [tab, setTab] = useState<Tab>('index');
  const [view, setViewState] = useState<View>(() => readPref<View>(VIEW_KEY, ['list', 'grid'], 'list'));
  const setView = useCallback((v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  }, []);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const deferred = useDeferredValue(filters);
  const searchRef = useRef<HTMLInputElement>(null);

  /* ----- filtering, faceting & sorting (single pass over the catalogue) ----- */
  const { results, facets } = useMemo(() => {
    const q = parseQuery(deferred.query);
    const hasQuery = q.tokens.length > 0;
    const categoryCounts = Object.fromEntries(CATEGORY_IDS.map((c) => [c, 0])) as Record<CategoryId, number>;
    const tierCounts = Object.fromEntries(TIER_IDS.map((t) => [t, 0])) as Record<TierId, number>;
    const countryMap = new Map<string, { code: string; name: string; count: number }>();
    const cats = deferred.categories;
    const tiers = deferred.tiers;
    const hits: { b: RankedBrand; rel: number }[] = [];

    for (const b of ranked) {
      const c = countryMap.get(b.origin.countryCode) ?? { code: b.origin.countryCode, name: b.origin.country, count: 0 };
      c.count++;
      countryMap.set(b.origin.countryCode, c);

      let rel = 0;
      if (hasQuery) {
        rel = fuzzyScore(b.search, q);
        if (!rel) continue;
      }
      if (deferred.country && b.origin.countryCode !== deferred.country) continue;
      if (b.composite < deferred.minScore) continue;
      if (deferred.savedOnly && !saved[b.id]) continue;

      const catOk = !cats.length || cats.includes(b.category) || !!b.subcategories?.some((s) => cats.includes(s));
      const tierOk = !tiers.length || tiers.includes(b.tier);
      if (tierOk) {
        categoryCounts[b.category]++;
        b.subcategories?.forEach((s) => categoryCounts[s]++);
      }
      if (catOk) tierCounts[b.tier]++;
      if (catOk && tierOk) hits.push({ b, rel });
    }

    const key = deferred.sort;
    const dir = deferred.dir === 'asc' ? 1 : -1;
    hits.sort((x, y) => {
      if (hasQuery) {
        // relevance bands first so exact name hits lead, then the chosen sort within a band
        const bx = Math.round(x.rel / 15);
        const by = Math.round(y.rel / 15);
        if (bx !== by) return by - bx;
      }
      if (key === 'name') return dir * x.b.name.localeCompare(y.b.name);
      if (key === 'founded') {
        const fx = x.b.founded;
        const fy = y.b.founded;
        if (fx === null || fy === null) return fx === fy ? x.b.rank - y.b.rank : fx === null ? 1 : -1;
        return dir * (fx - fy) || x.b.rank - y.b.rank;
      }
      const vx = key === 'composite' ? x.b.composite : x.b.scores[key];
      const vy = key === 'composite' ? y.b.composite : y.b.scores[key];
      return dir * (vx - vy) || x.b.rank - y.b.rank;
    });

    return {
      results: hits.map((h) => h.b),
      facets: { categoryCounts, tierCounts, countries: [...countryMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)) },
    };
  }, [ranked, deferred, saved]);

  /* ----- deep links: #brand/<id> ----- */
  const [selectedId, setSelectedId] = useState<string | null>(idFromHash);
  const openedInApp = useRef(false);
  useEffect(() => {
    const onHash = () => setSelectedId(idFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const openBrand = useCallback((id: string) => {
    if (idFromHash() === id) return;
    if (!idFromHash()) openedInApp.current = true;
    window.location.hash = `brand/${encodeURIComponent(id)}`;
  }, []);
  const closeBrand = useCallback(() => {
    if (openedInApp.current && idFromHash()) {
      openedInApp.current = false;
      window.history.back();
    } else {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      setSelectedId(null);
    }
  }, []);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  /* ----- global keys & scroll lock ----- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedId) {
        e.preventDefault();
        closeBrand();
        return;
      }
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
      if (e.key === '/' && !typing && !selectedId && tab === 'index') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, closeBrand, tab]);
  useEffect(() => {
    if (!selected) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [selected]);

  const resetFilters = useCallback(() => setFilters((f) => ({ ...DEFAULT_FILTERS, sort: f.sort, dir: f.dir })), []);
  const changeTab = useCallback((t: Tab) => {
    setTab(t);
    window.scrollTo({ top: 0 });
  }, []);
  const savedCount = useMemo(() => Object.keys(saved).filter((id) => byId.has(id)).length, [saved, byId]);
  const stale = filters !== deferred;

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-ink focus:px-3 focus:py-2 focus:text-paper">
        Skip to content
      </a>
      <Masthead ranked={ranked} data={data} tab={tab} setTab={changeTab} savedCount={savedCount} />

      <main id="main" className="mx-auto max-w-[1360px] px-4 pb-24 sm:px-8">
        {tab === 'index' && (
          <>
            <ControlPanel
              filters={filters}
              setFilters={setFilters}
              facets={facets}
              resultCount={results.length}
              total={ranked.length}
              view={view}
              setView={setView}
              searchRef={searchRef}
            />
            <div className={cx('transition-opacity duration-150', stale && 'opacity-60')}>
              {results.length === 0 ? (
                <EmptyState onReset={resetFilters} />
              ) : view === 'list' ? (
                <Leaderboard items={results} saved={saved} sortKey={deferred.sort} onOpen={openBrand} onToggle={toggle} />
              ) : (
                <GridView items={results} saved={saved} sortKey={deferred.sort} onOpen={openBrand} onToggle={toggle} />
              )}
            </div>
          </>
        )}
        {tab === 'list' && <MyListView byId={byId} saved={saved} onOpen={openBrand} onSetTier={setTier} onRemove={remove} onClear={clear} onBrowse={() => changeTab('index')} />}
        {tab === 'method' && <MethodologyView weights={data.weights} />}
      </main>

      <footer className="border-t border-ink">
        <div className="mx-auto flex max-w-[1360px] flex-wrap justify-between gap-4 px-4 py-8 text-[12px] text-muted sm:px-8">
          <p className="max-w-2xl">
            Scores are editorial assessments for comparison and discussion — not audits, endorsements or purchase advice. Bookmarks are stored only in this browser.
          </p>
          <p className="font-serif text-[15px] text-ink italic">The Menswear Index</p>
        </div>
      </footer>

      {selected && (
        <BrandDrawer brand={selected} total={ranked.length} medians={medians} weights={data.weights} savedEntry={saved[selected.id]} onClose={closeBrand} onToggle={toggle} onSetTier={setTier} />
      )}
    </div>
  );
}
