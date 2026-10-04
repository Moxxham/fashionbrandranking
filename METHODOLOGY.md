# The Menswear Index — Methodology v1.0

The index answers one question: **if you spent your money here, how good is what you would own, and for how long?**
Every brand is scored 0–100 on eight dimensions against a written rubric. The scores are combined into one composite and ranked dynamically.

The constants below are implemented in `src/App.tsx` (§1 and §3) and `scripts/generate-brands.mjs`. The generator writes `weights` into every `brands.json`, and the app recomputes composites from those weights when it loads, so the data and the UI cannot drift apart.

---

## 1. Taxonomy

### 1.1 Disciplines (primary category plus optional secondaries)

Each brand has one **primary** discipline, which determines its discipline rank. It can also have **secondary** disciplines, which make it discoverable under those filters. Drake's, for example, is primary *Shirting & Haberdashery*, with *Trad* and *Tailoring* as secondaries.

| ID | Discipline | Scope | Typical references |
|---|---|---|---|
| `tailoring` | Tailoring & Sartorial | Bespoke, MTM and RTW suits/jackets; canvassing and cut | Savile Row, Neapolitan, Florentine, Japanese soft tailoring |
| `shirting` | Shirting & Haberdashery | Shirtmakers, neckwear, finishing pieces | Jermyn Street, Parisian chemisiers |
| `trad` | Ivy, Prep & Trad | Natural-shoulder American tradition | Ivy League clothiers, Japanese Ivy revival |
| `heritage` | Heritage Workwear | Purpose-built work and outdoor goods | Duck canvas, chore coats, Mackinaw |
| `denim` | Denim & Repro | Selvedge denim and vintage reproduction | Okayama/Kojima, flight-jacket repro, loopwheel |
| `country` | Country & Sporting | Field, shooting and countryside clothing | Waxed cotton, tweed, wellingtons |
| `technical` | Technical & Outdoor | Performance outerwear through techwear | Gore-Tex shells, modular systems |
| `designer` | Designer & Avant-Garde | Author-led houses, runway influence | Japanese avant-garde, Antwerp, Paris |
| `contemporary` | Contemporary & Minimal | Design-led, wearable wardrobes | Scandinavian and Parisian minimalism |
| `streetwear` | Streetwear | Skate, hip-hop and youth culture; drop economies | Ura-Harajuku, NYC skate |
| `essentials` | Essentials & Basics | Tees, sweats, underwear; fabric and fit | Loopwheel jersey, Supima, mass basics |
| `knitwear` | Knitwear | Specialist knitters and fibre houses | Scottish Borders, fully-fashioned fine gauge |
| `footwear` | Footwear | Welted shoemakers, bootmakers, sneakers | Northampton, Mallorca, Pacific Northwest |
| `accessories` | Leather Goods & Accessories | Bags, belts, hats, umbrellas, ties | Saddlery, hatters, umbrella makers |

### 1.2 Market tiers

Tiers are indexed to the brand's **core shirt-equivalent garment at full retail (USD)**, which makes a tailoring house comparable to a T-shirt maker. The `priceUSD.reference` field records the actual item the price range describes.

| Tier | Symbol | Shirt-equivalent band | Character |
|---|---|---|---|
| `atelier` | $$$$$ | $600+ | Bespoke, made-to-order, rarest fibres |
| `luxury` | $$$$ | $350–600 | Established luxury and top-flight RTW |
| `premium` | $$$ | $150–350 | The enthusiast heartland |
| `accessible` | $$ | $60–150 | Mid-market; value and consistency matter most |
| `mainstream` | $ | under $60 | High-street and mass-market |

---

## 2. The scoring algorithm

### 2.1 Dimensions and weights

| # | Dimension | Weight | Assesses |
|---|---|---|---|
| MA | Material Integrity | **20%** | Fibre, cloth, leather, hardware; mill and tannery provenance |
| CR | Construction & Craft | **20%** | Canvassing, welting, seam engineering, hand-finishing, factory provenance |
| DE | Design Originality | **15%** | Point of view, silhouette authorship, influence |
| LO | Longevity | **15%** | Durability, repairability (resoling, re-waxing, recrafting), stylistic half-life |
| VA | Value Integrity | **10%** | Quality per dollar, **relative to tier peers** |
| RE | Heritage & Reputation | **10%** | Track record and standing with informed buyers and the trade |
| CO | Consistency | **5%** | QC variance across lines, factories, seasons |
| TR | Transparency & Responsibility | **5%** | Supply-chain disclosure, labour/environment, repair and take-back |

**Why this distribution.** The weights fall into four bands: 40% on the physical object, 30% on how it lives with you, 20% on market context and 10% on institutional behaviour.

- **Materials and construction (40%)** carry the most weight because the garment as an object is what enthusiasts pay for. Materials set the ceiling, and construction decides whether the garment reaches it. Neither can rescue the other, so they share the top weight.
- **Design (15%)** is weighted high enough that designer houses compete on their real strength, and low enough that novelty can't outrank substance.
- **Longevity (15%)** stands in for cost-per-wear, the enthusiast's true price. It rewards repair programmes and pieces that stay in style.
- **Value (10%)** is scored *within the tier* by rubric. Luxury isn't penalised for being expensive, and a budget brand isn't rewarded just for being cheap. At 10% it can't turn a quality index into a price index.
- **Reputation (10%)** is a useful prior, capped so legacy names can't coast on history while quality slides.
- **Consistency (5%)** is partly captured by craft and reputation already, so it carries a light weight.
- **Transparency (5%)** has a low weight because so little is independently verifiable today, not because it matters little. It is the first candidate to rise in v2 as disclosure improves.

### 2.2 Composite

```
A     = Σ wᵢ·sᵢ                 weighted arithmetic mean
G     = Π sᵢ^wᵢ                 weighted geometric mean (sᵢ floored at 1)
B     = 0.75·A + 0.25·G         balanced score
Index = 60 + c·(B − 60)         confidence shrinkage, c ∈ [0.5, 1]
```

- **Balance over spikes.** The geometric term penalises weak links, so one spectacular dimension can't carry a brand with a poor one.
- **Confidence shrinkage.** Every record carries an evidence confidence `c`. Thinly evidenced scores are pulled toward a prior of **60** ("competent, unremarkable"). A newcomer needs real evidence to outrank an established maker. Well-documented curated records use 0.78–0.95, lesser-documented ones 0.70–0.75, and ingested records default to 0.70.
- **Worked example (Anderson & Sheppard):** A = 90.1, G = 89.5, B = 90.0 and c = 0.95, so Index = 60 + 0.95 × 30.0 = **88.5**.

### 2.3 Ranking

- Ranks are computed in the browser every time data loads, using **competition ranking** (1-2-2-4) on the composite rounded to one decimal place.
- Ties break on Construction, then Material, then name.
- Each brand also gets a **discipline rank** (within its primary discipline) and a **catalogue percentile**.
- Any dimension can be used as a sort key in the UI. The global rank badge always reflects the composite.

### 2.4 Buy-at threshold

Each brand gets a **buy-at** figure: the discount off RRP at which it becomes an instant buy. It is a discount rather than a price because one brand's tee and jacket share no price, but each carries an RRP. Off-price stores such as TK Maxx print the RRP on the ticket next to their own price.

```
buy-at = 60 − 0.9·(Index − 60) − 0.4·(Value − 60)     rounded to the nearest 5%, held within 10–70%
```

- **Quality lowers the bar.** Each index point above the prior takes 0.9 points off the discount needed.
- **Poor value raises it.** Value Integrity counts again here because it measures how fair the RRP is. A brand that is overpriced at full retail needs a deeper cut.
- **Typical results:** Patagonia and Schott NYC 35%, Barbour and Levi's 40%, Fred Perry 45%, Tommy Hilfiger 50%, Moncler and Versace 55%, H&M 60%, Philipp Plein 70%. Across the catalogue most brands fall between 40% and 60%.
- It is derived in the browser like the composite, so it follows any change to scores or weights. Constants live in `BUY_AT` in `src/App.tsx`.

---

## 3. Data schema

The canonical definitions are the TypeScript interfaces in `src/App.tsx` (§2) and the JSON Schema in [`docs/brand.schema.json`](docs/brand.schema.json).

```ts
interface Brand {
  id: string;                       // slug, unique; used for #brand/<id> deep links
  name: string;
  founded: number | null;
  origin: { country: string; countryCode: string; city?: string }; // ISO 3166-1 alpha-2
  category: CategoryId;             // primary discipline
  subcategories?: CategoryId[];
  tier: TierId;
  priceUSD?: { from: number; to: number; reference?: string };
  production?: string[];            // ISO-2 manufacturing countries
  ownership?: { type: 'independent' | 'family' | 'group' | 'public' | 'private-equity'; parent?: string };
  scores: Record<DimensionId, number>;  // 0–100 each
  confidence: number;               // 0.5–1.0
  signatures: { name: string; note?: string }[];
  editorial: { summary: string; strengths: string[]; caveats: string[] };
  tags?: string[];
  website?: string;
  stockists?: RetailerId[];         // editorial "often stocked at" flags, e.g. ['tkmaxx']
  status?: 'active' | 'hiatus' | 'defunct';
  provenance: 'curated' | 'ingested';  // no synthetic records, ever
  updatedAt?: string;               // ISO date
  composite?: number; rank?: number;// derived by the generator; recomputed client-side
}
```

**Scaling notes (designed for 2,000+ records; currently 1,000)**

- Records are flat and fixed-shape, at about 0.9 KB each: 2,000 records come to about 1.9 MB raw and about 300 KB with brotli or gzip.
- Only raw sub-scores are authoritative. Composites and ranks are derived, so a weight change never needs a data migration.
- The search index is built once per load from name, signatures, tags, city, country, discipline, tier and parent group.
- `provenance` separates editorial records from ingested ones. The generator and the app both reject any record marked `generated`.

---

## 4. Honest limits

- Curated scores are **editorial assessments**. They synthesise construction analysis, sourcing, ownership history and enthusiast consensus, and they are not audits or lab tests.
- Brands drift: ownership changes, factories move and quality slides. Every record carries `updatedAt`.
- **Buy-at is a threshold, not a forecast.** It says when to stop deliberating, not what a brand will be discounted to.
- **Where to look.** `stockists` flags (curated in `scripts/stockists.mjs`) record retailers a brand regularly turns up at, such as TK Maxx UK. They are editorial notes, not stock checks. The app turns each flag into a live retailer search, and offers open-market searches (Google Shopping, eBay UK, Vinted) for every brand.
- Every record is a real brand. Where a founding year or city is not confidently known it is left `null` rather than guessed, and lesser-documented brands carry lower confidence so their composites shrink toward the prior.
