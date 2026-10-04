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
  /** TK Maxx UK menswear: brands that regularly appear on the rails (denim, tees, shirts, jackets first). */
  tkmaxx: [
    // Denim
    'levis', 'lee', 'wrangler', 'diesel', 'g-star-raw', 'pepe-jeans', 'replay', 'guess',
    'true-religion', '7-for-all-mankind', 'hudson-jeans', 'joes-jeans', 'paige', 'mavi', 'jack-jones', 'lee-cooper',
    'tommy-jeans', 'versace-jeans-couture', 'scotch-soda', 'dr-denim', 'duck-and-cover', 'crosshatch', 'voi-jeans', 'only-sons',
    'selected-homme', 'mustang', 'blend',
    // Tees, polos & casual shirts
    'tommy-hilfiger', 'calvin-klein', 'armani-exchange', 'emporio-armani', 'ea7', 'hugo-boss', 'lacoste', 'fred-perry',
    'ben-sherman', 'farah', 'original-penguin', 'psycho-bunny', 'nautica', 'ted-baker', 'french-connection', 'abercrombie-fitch',
    'hollister', 'pretty-green', 'merc-london', 'lambretta', 'weekend-offender', 'marshall-artist', 'peter-werth', 'gabicci',
    'luke-1977', 'bench', 'henleys', 'bellfield', 'brave-soul', 'threadbare', 'kangol', 'fila',
    'ellesse', 'sergio-tacchini', 'kappa', 'umbro', 'le-coq-sportif', 'champion', 'russell-athletic', 'starter',
    'under-armour', 'castore', 'nicce', 'good-for-nothing', 'kings-will-dream', 'hype', 'sik-silk', 'gym-king',
    'hoodrich', 'religion', 'criminal-damage', 'fat-face', 'white-stuff', 'joules', 'crew-clothing', 'animal',
    'quiksilver', 'billabong', 'rip-curl', 'oneill', 'volcom', 'hurley', 'gant', 'hackett',
    'polo-ralph-lauren', 'lyle-scott', 'pringle-of-scotland', 'paul-smith', 'superdry', 'hummel', 'admiral', 'mitchell-ness',
    'puma', 'adidas', 'nike', 'reebok', 'new-balance', 'asics', 'diadora', 'lotto',
    // Shirting & smart casual
    'van-heusen', 'eterna', 'olymp', 'seidensticker', 'double-two', 'tm-lewin', 'pierre-cardin', 'paul-costelloe',
    'guide-london', 'racing-green', 'thomas-pink', 'michael-kors', 'dkny', 'karl-lagerfeld', 'kenneth-cole', 'perry-ellis',
    'tom-tailor', 'soliver', 'marc-opolo', 'camel-active', 'joop', 'strellson', 'antony-morato', 'daniel-hechter',
    'esprit', 'mcgregor', 'jaeger', 'austin-reed', 'reiss',
    // Designer (Gold Label)
    'versace', 'dolce-gabbana', 'moschino', 'kenzo', 'dsquared2', 'philipp-plein', 'roberto-cavalli', 'vivienne-westwood',
    'paul-shark', 'iceberg', 'trussardi', 'neil-barrett', 'palm-angels', 'marcelo-burlon-county-of-milan', 'msgm', 'gcds',
    'bikkembergs', 'john-richmond', 'cerruti-1881',
    // Jackets & outerwear
    'barbour', 'belstaff', 'napapijri', 'penfield', 'alpha-industries', 'schott-nyc', 'gloverall', 'aquascutum',
    'daks', 'parajumpers', 'mackage', 'moose-knuckles', 'nobis', 'peuterey', 'save-the-duck', 'colmar',
    'ciesse-piumini', 'spyder', 'rossignol', 'north-sails', 'henri-lloyd', 'didriksons', 'tretorn', 'berghaus',
    'regatta', 'craghoppers', 'jack-wolfskin', 'trespass', 'columbia', 'the-north-face', 'helly-hansen', 'timberland',
    'woolrich', 'pyrenex', 'hunter', 'rains', 'musto', 'k-way', 'refrigiwear', 'blauer-usa',
    'holubar', 'eddie-bauer', 'duvetica', 'fay', 'members-only', 'barneys-originals', 'oakwood', 'redskins',
    'chevignon', 'matchless', 'protest', 'brunotti', 'picture-organic-clothing', 'montane', 'mountain-hardwear', 'marmot',
    'peak-performance',
    // Footwear, accessories & underwear
    'clarks', 'dr-martens', 'loake', 'barker', 'base-london', 'hudson-london', 'oliver-sweeney', 'kurt-geiger',
    'skechers', 'merrell', 'keen', 'teva', 'ecco', 'geox', 'camper', 'kickers',
    'superga', 'gola', 'hush-puppies', 'rockport', 'cole-haan', 'steve-madden', 'ugg', 'crocs',
    'havaianas', 'toms', 'ariat', 'frye', 'eastland', 'minnetonka', 'sebago', 'sperry',
    'birkenstock', 'vans', 'converse', 'onitsuka-tiger', 'k-swiss', 'saucony', 'brooks-running', 'mizuno',
    'herschel-supply-co', 'eastpak', 'jansport', 'tumi', 'new-era', '47', 'goorin-bros', 'failsworth-hats',
    'happy-socks', 'falke', 'burlington', 'stance', 'jockey', 'bjorn-borg', 'saxx', 'derek-rose',
    'tateossian', 'aspinal-of-london',
  ],
};
