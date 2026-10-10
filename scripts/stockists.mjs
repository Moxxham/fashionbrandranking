/**
 * Curated stockists — where each brand can be bought (methodology v1.0).
 *
 * Keyed by retailer id; values are brand ids (slugs, as generated from the
 * brand name — see slugify in generate-brands.mjs). The generator attaches a
 * `stockists` array to each listed brand; `--strict` fails on an id that does
 * not resolve to a brand in the catalogue.
 *
 * Flags are editorial, not live stock. Off-price retailers buy
 * opportunistically, so "often at TK Maxx" means the brand turns up there
 * regularly — not that a given piece is on the rails today. The app pairs
 * each flag with a live search link rather than claiming availability.
 *
 * To add a retailer: add its id to RETAILER_IDS here, to RETAILERS in
 * src/App.tsx (§1) and to the `stockists` enum in docs/brand.schema.json.
 */
export const RETAILER_IDS = ['tkmaxx'];

export const STOCKISTS = {
  /** TK Maxx UK menswear: brands on the store’s own men’s brand list, then editorial additions. */
  tkmaxx: [
    // Confirmed: on TK Maxx UK’s own men’s brand list (supplied October 2026)
    'alan-paine', 'ben-sherman', 'bench', 'bewley-ritch', 'buffalo-david-bitton', 'celio', 'crew-clothing', 'dkny',
    'edwin', 'folk', 'gabicci', 'gant', 'gucci', 'hackett', 'hollister', 'jack-jones',
    'kilgour', 'lacoste', 'lyle-scott', 'nn07', 'norse-projects', 'only-sons', 'palm-angels', 'paul-costelloe',
    'remus-uomo', 'replay', 'richard-james', 'roberto-cavalli', 'scotch-soda', 'selected-homme', 'ted-baker', 'threadbare',
    '7-for-all-mankind', 'abercrombie-fitch', 'adidas', 'allsaints', 'asics', 'balmain', 'berghaus', 'blend',
    'body-glove', 'bomboogie', 'brave-soul', 'bugatti', 'calvin-klein', 'castore', 'casual-friday', 'cat-footwear',
    'champion', 'clean-cut-copenhagen', 'columbia', 'converse', 'cos', 'craghoppers', 'criminal-damage', 'crosshatch',
    'daniel-hechter', 'dc-shoes', 'dickies', 'diesel', 'dolce-gabbana', 'dsquared2', 'duck-and-cover', 'ecko-unltd',
    'ed-hardy', 'ellesse', 'emporio-armani', 'engbers', 'etnies', 'eton', 'express', 'farah',
    'fear-of-god', 'fila', 'fred-perry', 'french-connection', 'g-star-raw', 'gap', 'geox', 'good-for-nothing',
    'guess', 'guide-london', 'henleys', 'hurley', 'iceberg', 'john-richmond', 'k-swiss', 'kings-will-dream',
    'les-deux', 'levis', 'lindbergh', 'luke-1977', 'maison-kitsune', 'marshall-artist', 'members-only', 'merrell',
    'missoni', 'moschino', 'moss', 'nautica', 'neil-barrett', 'new-balance', 'nicce', 'nike',
    'oakley', 'off-white', 'original-penguin', 'orlebar-brown', 'passenger', 'paul-smith', 'pendleton', 'percival',
    'perry-ellis', 'pringle-of-scotland', 'puma', 'quiksilver', 'reebok', 'regatta', 'religion', 'river-island',
    'santa-cruz', 'seasalt-cornwall', 'seidensticker', 'skechers', 'spoke', 'spyder', 'steve-madden', 'sunflower',
    'superdry', 'lee', 'the-north-face', 'theory', 'thomas-pink', 'timberland', 'tm-lewin', 'tog-24',
    'trespass', 'true-religion', 'under-armour', 'vans', 'versace', 'von-dutch', 'walbusch', 'weekday',
    'weekend-offender', 'weird-fish', 'pull-bear', 'barena-venezia', 'schott-nyc', 'refrigiwear', 'bernard-weatherill', 'douglas-hayward',
    'jason-wu', 'john-partridge', 'point-zero', 'redefined-rebel', 'steel-jelly', 'the-savile-row-company', 'us-polo-assn', 'william-hunt',
    'william-rast', '883-police', 'zavetti-canada', 'alessandro-zavetti', 'alexandre-of-england', 'altinyildiz-classics', 'barrow', 'boardies',
    'c-c-california', 'casa-moda', 'cheap-monday', 'chelsea-peers', 'cinque', 'closure-london', 'costume-national', 'cruyff',
    'dare-2b', 'dml-jeans', 'dstrezzed', 'fat-moose', 'favela', 'fenchurch', 'geographical-norway', 'glorious-gangsta',
    'gym-coffee', 'hikerdelic', 'holland-esquire', 'house-of-cavani', 'iets-frans', 'ike-behar', 'invicta', 'jeff-banks',
    'jeremy-scott', 'lemieux', 'lerros', 'les-hommes', 'london-fog', 'majestic-filatures', 'marc-darcy', 'munich',
    'project-x-paris', 'redmond', 'simon-carter', 'tokyo-laundry', 'united-athle', 'venti', 'voile-bleue', 'weatherproof',
    'wesc', 'hatico', 'melka', 'collection-by-michael-strahan', 'limehaus', 'avalanche', 'rainforest', 'tallia',
    'antwerp-studios', 'aspen', 'beaufort-blake', 'carisma', 'ciao', 'cruna', 'lorenzo-magni', 'moncrief',
    'skovde', 'sorbino', 'thom-aaron', 'wilt', 'denim-flower', 'hoxton-denim', 'projek-raw', 'drill-clothing-co',
    'alpine-heritage', 'canada-trail', 'winnipeg-extreme-adventures', 'nordberg', 'navy-sport', 'workwear-redefined', 'curated-utility', 'statham-vintage',
    'antique-rogue', 'legenders', 'vtg-1946', 'garment-works', 'benetti', 'daniel-grahame', 'guards-london', 'harry-brown',
    'kensington-eastside', 'penrose-london', 'stamford-brook', 'taylor-hunt', 'thomas-goodwin', 'jk-attire', 'fratelli-uniti', 'lupi-romani',
    'belier', 'brooklyn-supply-co', 'brooklyn-boys', 'cheats-thieves', 'common-people', 'delusions-of-grandeur', 'dripmade', 'encrypted',
    'money', 'rum-knuckles', 'saint-sinner', 'saints-studio', 'super-massive', 'massive-luxury', 'syxth', 'the-power-for-the-people',
    'the-neighbourgoods', 'weekend-vibes', 'fully-paid', 'game-7', 'rgstr', 'risk-reward', 'urban-threads', 'uncle-ralph',
    'elite-brand', 'eighty-eight', 'd-f-ricky-singh', 'free-soul', 'gianni-feraud', 'foundation-kensetu-japan', 'plenum-studio', 'allfenix',
    'altryn', 'amongst-others', 'apoh-london', 'apollo', 'archive-design-studios', 'ashwood', 'authorized', 'balance-collection',
    'berna', 'blank-essentials', 'blank-laundry', 'bleubird', 'bull-berry', 'celebre', 'cobolt-of-sweden', 'craft-canvas',
    'dubbleware', 'elements', 'established-redefining-essentials', 'faded', 'fawn', 'fiftyfive', 'fisk-of-oslo', 'fresh-flavours',
    'fuyuka-lab-works', 'galtsand', 'gilmar', 'green-treat', 'harpoon', 'helium', 'hera', 'hertford-hope',
    'industry', 'jka', 'kapsule', 'larsson-co', 'legends', 'les-basics', 'm-collections', 'malibu',
    'mida', 'montserrat', 'nines-collection', 'noir', 'nordam', 'onadime', 'pas-de-monaco', 'premise',
    'public-supply', 'pure-cotton', 'pure-instinct', 'reason', 'report-collection', 'reserved-supply', 'rhode', 'rose-london',
    'saltwell-england', 'seinse', 'somo-atelier', 'spin', 'valere', 'valor', 'van-larsson', 'wear-london',
    'dgs-drifter',
    // Editorial: regularly seen off-price, not on the supplied list
    'wrangler', 'pepe-jeans', 'hudson-jeans', 'joes-jeans', 'paige', 'mavi', 'lee-cooper', 'tommy-jeans',
    'versace-jeans-couture', 'dr-denim', 'voi-jeans', 'mustang', 'tommy-hilfiger', 'armani-exchange', 'ea7', 'hugo-boss',
    'psycho-bunny', 'pretty-green', 'merc-london', 'lambretta', 'peter-werth', 'bellfield', 'kangol', 'sergio-tacchini',
    'kappa', 'umbro', 'le-coq-sportif', 'russell-athletic', 'starter', 'hype', 'sik-silk', 'gym-king',
    'hoodrich', 'fat-face', 'white-stuff', 'joules', 'animal', 'billabong', 'rip-curl', 'oneill',
    'volcom', 'polo-ralph-lauren', 'hummel', 'admiral', 'mitchell-ness', 'diadora', 'lotto', 'van-heusen',
    'eterna', 'olymp', 'double-two', 'pierre-cardin', 'racing-green', 'michael-kors', 'karl-lagerfeld', 'kenneth-cole',
    'tom-tailor', 'soliver', 'marc-opolo', 'camel-active', 'joop', 'strellson', 'antony-morato', 'esprit',
    'mcgregor', 'jaeger', 'austin-reed', 'reiss', 'kenzo', 'philipp-plein', 'vivienne-westwood', 'paul-shark',
    'trussardi', 'marcelo-burlon-county-of-milan', 'msgm', 'gcds', 'bikkembergs', 'cerruti-1881', 'barbour', 'belstaff',
    'napapijri', 'penfield', 'alpha-industries', 'gloverall', 'aquascutum', 'daks', 'parajumpers', 'mackage',
    'moose-knuckles', 'nobis', 'peuterey', 'save-the-duck', 'colmar', 'ciesse-piumini', 'rossignol', 'north-sails',
    'henri-lloyd', 'didriksons', 'tretorn', 'jack-wolfskin', 'helly-hansen', 'woolrich', 'pyrenex', 'hunter',
    'rains', 'musto', 'k-way', 'blauer-usa', 'holubar', 'eddie-bauer', 'duvetica', 'fay',
    'barneys-originals', 'oakwood', 'redskins', 'chevignon', 'matchless', 'protest', 'brunotti', 'picture-organic-clothing',
    'montane', 'mountain-hardwear', 'marmot', 'peak-performance', 'clarks', 'dr-martens', 'loake', 'barker',
    'base-london', 'hudson-london', 'oliver-sweeney', 'kurt-geiger', 'keen', 'teva', 'ecco', 'camper',
    'kickers', 'superga', 'gola', 'hush-puppies', 'rockport', 'cole-haan', 'ugg', 'crocs',
    'havaianas', 'toms', 'ariat', 'frye', 'eastland', 'minnetonka', 'sebago', 'sperry',
    'birkenstock', 'onitsuka-tiger', 'saucony', 'brooks-running', 'mizuno', 'herschel-supply-co', 'eastpak', 'jansport',
    'tumi', 'new-era', '47', 'goorin-bros', 'failsworth-hats', 'happy-socks', 'falke', 'burlington',
    'stance', 'jockey', 'bjorn-borg', 'saxx', 'derek-rose', 'tateossian', 'aspinal-of-london',
  ],
};
