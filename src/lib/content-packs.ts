import type { PackPicture } from "./content-pack-pages";
import type { PackDesignKey } from "./pack-designs";
import { ARCADE_PACK } from "./signature/arcade";
import { ATELIER_PACK } from "./signature/atelier";
import { BOTANICA_PACK } from "./signature/botanica";
import { ORBIT_PACK } from "./signature/orbit";

/**
 * Kaizena Flow's content packs (`docs/theme-showcase-phase-1.md` step 2): a clean demo store for each of the first six trades, written here
 * as data (as `LAUNCH_THEMES` are) and set up as store templates by `syncContentPacks()`. A theme's preset is shown on its pack (step 3), and
 * a new store that starts from a preset is made from it (step 4). Everything a pack says is hand-written English, plain, and free of claims
 * (`findClaims()`: no environmental claims, no urgency, no prices or stock in words); its pictures are made by Kaizena Flow's picture model
 * from the briefs below and can be replaced. Change a pack by raising its `version`. Pure.
 */

/**
 * The packs: the six trades, then the demo stores signature themes bring of their own (`docs/signature-themes.md`), each written beside its
 * theme in `src/lib/signature/`.
 */
export const PACK_KEYS = ["fashion", "beauty", "food", "home", "electronics", "services", "astronomy", "ceramics", "neon", "plants"] as const;
export type PackKey = (typeof PACK_KEYS)[number];

/** A pack's product: goods (one variant, kept in stock) or, for services, an appointment of so many minutes. */
export type PackProduct = {
  /** Its address in the store, fixed for ever (a pack's sync finds it again by it). */
  handle: string;
  title: string;
  description: string;
  /** The price in Norway, in whole kroner with VAT; other countries get the same number in their own currency, Denmark about two thirds. */
  price: number;
  /** The slug of one of the pack's categories. */
  category: string;
  /** What its picture shows, for the picture model (the pack's `look` is added). */
  picture: string;
  /** Goods: its weight. */
  grams?: number;
  /** Services: an appointment of so many minutes. */
  minutes?: number;
};

export type ContentPack = {
  key: PackKey;
  /** Raised with every change here; a newer one is set up again. */
  version: number;
  /** The store template's name and card. */
  title: string;
  summary: string;
  description: string;
  /** `store_starters.category`. */
  category: "retail" | "services";
  /** The demo store's own name, drawn in its header. */
  storeName: string;
  /** Its home page: the hero's words, three short points, and a short story. */
  headline: string;
  tagline: string;
  points: { title: string; text: string }[];
  storyTitle: string;
  story: string;
  /** Its about page. */
  about: string[];
  categories: { slug: string; name: string }[];
  products: PackProduct[];
  /** The art direction every picture of the pack shares. */
  look: string;
  /** What the home page's large picture and the story's picture show. */
  heroPicture: string;
  storyPicture: string;
  /**
   * Pictures that come with the pack, by slot (`hero`, `story`, `product:{handle}`, and any its design reads): a signature theme's art, files
   * of the site (`public/demo/themes/{theme}/`), stored in the pack store's library when it is set up and never made by the picture model.
   */
  art?: Readonly<Record<string, PackPicture>>;
  /**
   * Photographs Kaizena Flow's picture model makes for the pack, by slot, each from a photographer's brief (`look` is the shoot's direction,
   * D270): a signature theme's demo store looks photographed, not drawn. The slot's art stands in until its photograph is made, and the
   * pack is published only once every one is (`picturesMissing()`).
   */
  photos?: Readonly<Record<string, PackPhoto>>;
  /** The theme its pages are designed for (`PACK_DESIGNS`, `src/lib/pack-designs.ts`), in place of the common pages. */
  design?: PackDesignKey;
};

/** One photograph a pack asks the picture model for: what is in it and how it is framed, as a photographer's brief, its shape and its alt text. */
export type PackPhoto = { brief: string; shape: "landscape" | "portrait" | "square"; alt: string };

/** Every picture of every pack: no words, letters, logos or faces, so nothing in it can mislead or need a licence. */
export const PICTURE_RULES = "No text, letters, numbers, logos, labels or watermarks anywhere in the picture. No recognisable faces.";

export const CONTENT_PACKS: readonly ContentPack[] = [
  {
    key: "fashion",
    version: 1,
    title: "Fashion store",
    summary: "Clothes and accessories: a lookbook front page, collections and products.",
    description: "A demo clothing store with shirts, knitwear, trousers and accessories, sorted into collections. Replace the products and pictures with your own.",
    category: "retail",
    storeName: "Field & Fold",
    headline: "Made for every day",
    tagline: "Linen, wool and cotton in quiet colours, cut to be worn often and kept for years.",
    points: [
      { title: "Natural fibres", text: "Linen shirts, merino knits and heavy cotton, chosen for how they wear." },
      { title: "Easy to combine", text: "A small palette, so every piece goes with the rest." },
      { title: "Made to last", text: "Sturdy seams and good buttons, mended rather than replaced." },
    ],
    storyTitle: "From our workroom",
    story: "We design a short collection twice a year and keep the pieces that work. Every garment is sampled, worn and washed before it reaches the shop.",
    about: [
      "Field & Fold is a demo store made by Kaizena Flow to show what a clothing store can look like.",
      "The products, words and pictures are samples. Replace them with your own whenever you are ready.",
    ],
    categories: [
      { slug: "tops", name: "Tops" },
      { slug: "bottoms", name: "Bottoms" },
      { slug: "accessories", name: "Accessories" },
    ],
    products: [
      { handle: "linen-shirt", title: "Linen shirt", description: "A relaxed shirt in washed linen with a soft collar and mother-of-pearl buttons.", price: 899, category: "tops", grams: 260, picture: "a folded off-white linen shirt" },
      { handle: "merino-sweater", title: "Merino sweater", description: "A fine-knit crew neck in merino wool, warm without bulk.", price: 1199, category: "tops", grams: 320, picture: "a folded oatmeal merino crew-neck sweater" },
      { handle: "striped-tee", title: "Striped tee", description: "A heavy cotton t-shirt with a narrow navy stripe and a straight fit.", price: 349, category: "tops", grams: 220, picture: "a folded cream t-shirt with thin navy stripes" },
      { handle: "wide-trousers", title: "Wide trousers", description: "High-waisted trousers in cotton twill with deep pockets.", price: 999, category: "bottoms", grams: 540, picture: "a pair of sand-coloured wide-leg trousers laid flat" },
      { handle: "denim-jeans", title: "Straight jeans", description: "Rigid denim jeans with a straight leg that softens as it is worn.", price: 1099, category: "bottoms", grams: 780, picture: "a pair of indigo straight-leg jeans laid flat" },
      { handle: "wool-scarf", title: "Wool scarf", description: "A long scarf in brushed wool with fringed ends.", price: 499, category: "accessories", grams: 180, picture: "a rolled camel-coloured wool scarf with fringes" },
      { handle: "canvas-tote", title: "Canvas tote", description: "A roomy tote in heavy canvas with leather handles.", price: 399, category: "accessories", grams: 400, picture: "an unbleached canvas tote bag with brown leather handles" },
      { handle: "knit-beanie", title: "Knit beanie", description: "A ribbed beanie in lambswool with a deep turn-up.", price: 299, category: "accessories", grams: 90, picture: "a rust-coloured ribbed knit beanie" },
    ],
    look: "Editorial product photograph on a warm light-grey seamless paper background, soft daylight from the side, gentle shadows, calm and minimal.",
    heroPicture: "a sunlit studio rail of linen and wool garments in neutral tones, wide shot",
    storyPicture: "a tailor's worktable with fabric swatches, scissors and a spool of thread, seen from above",
  },
  {
    key: "beauty",
    version: 1,
    title: "Beauty store",
    summary: "Skin care and body care: a soft front page, a routine and products by step.",
    description: "A demo skin care store with cleansers, serums, creams and body care, sorted by step. Replace the products and pictures with your own.",
    category: "retail",
    storeName: "Lumen Skin",
    headline: "Simple care for every skin",
    tagline: "A short routine of gentle formulas: cleanse, treat and protect.",
    points: [
      { title: "Three steps", text: "A routine that fits a busy morning and a slow evening." },
      { title: "Gentle formulas", text: "Mild textures and light scents, made for daily use." },
      { title: "Clear labels", text: "Every product lists what is in it and how to use it." },
    ],
    storyTitle: "Our routine",
    story: "Start with a cleanser, follow with a serum, and finish with a cream. Add body care and masks when you have time.",
    about: [
      "Lumen Skin is a demo store made by Kaizena Flow to show what a beauty store can look like.",
      "The products, words and pictures are samples. Replace them with your own whenever you are ready.",
    ],
    categories: [
      { slug: "face", name: "Face" },
      { slug: "body", name: "Body" },
      { slug: "sets", name: "Sets" },
    ],
    products: [
      { handle: "gentle-cleanser", title: "Gentle cleanser", description: "A milky cleanser that lifts the day away without tightness.", price: 249, category: "face", grams: 180, picture: "a frosted glass pump bottle of cleanser" },
      { handle: "hydrating-serum", title: "Hydrating serum", description: "A light serum with a dropper, for a dewy finish under cream.", price: 449, category: "face", grams: 90, picture: "an amber glass dropper bottle of serum" },
      { handle: "day-cream", title: "Day cream", description: "A soft cream that sinks in quickly and sits well under make-up.", price: 399, category: "face", grams: 120, picture: "a white ceramic jar of face cream with its lid beside it" },
      { handle: "clay-mask", title: "Clay mask", description: "A smooth clay mask for a weekly reset.", price: 299, category: "face", grams: 110, picture: "an open tin of pale pink clay mask with a small wooden spatula" },
      { handle: "lip-balm", title: "Lip balm", description: "A rich balm in a slim tube, for lips and dry spots.", price: 129, category: "face", grams: 20, picture: "a slim matte tube of lip balm" },
      { handle: "body-oil", title: "Body oil", description: "A silky oil for after the shower, with a light scent.", price: 349, category: "body", grams: 160, picture: "a clear glass bottle of golden body oil" },
      { handle: "hand-cream", title: "Hand cream", description: "A quick-absorbing hand cream in a pocket tube.", price: 179, category: "body", grams: 60, picture: "a soft aluminium tube of hand cream" },
      { handle: "routine-set", title: "Routine set", description: "Cleanser, serum and day cream in travel sizes, in a linen pouch.", price: 699, category: "sets", grams: 260, picture: "three small skin care bottles beside a linen pouch" },
    ],
    look: "Clean beauty product photograph on a pale blush stone surface, soft diffused light, subtle reflections, airy and calm.",
    heroPicture: "skin care bottles and jars arranged on a pale stone bathroom shelf in morning light, wide shot",
    storyPicture: "a single drop of serum on a dropper above a jar, close-up with a soft background",
  },
  {
    key: "food",
    version: 1,
    title: "Food and drink store",
    summary: "A pantry and coffee shop: a warm front page and products by kind.",
    description: "A demo food and drink store with coffee, tea and pantry goods, sorted by kind. Replace the products and pictures with your own.",
    category: "retail",
    storeName: "Harbour Pantry",
    headline: "Good things for the table",
    tagline: "Coffee roasted every week, loose-leaf tea and a small pantry of favourites.",
    points: [
      { title: "Roasted weekly", text: "Our coffee is roasted in small batches and packed the same day." },
      { title: "From small producers", text: "Honey, jam and oil from people we know by name." },
      { title: "Packed with care", text: "Sealed bags and jars, ready for the cupboard." },
    ],
    storyTitle: "From the roastery",
    story: "Every Tuesday the roaster fills the shop with the smell of fresh coffee. We taste each batch before it is packed.",
    about: [
      "Harbour Pantry is a demo store made by Kaizena Flow to show what a food and drink store can look like.",
      "The products, words and pictures are samples. Replace them with your own whenever you are ready.",
    ],
    categories: [
      { slug: "coffee", name: "Coffee" },
      { slug: "tea", name: "Tea" },
      { slug: "pantry", name: "Pantry" },
    ],
    products: [
      { handle: "house-espresso", title: "House espresso", description: "Whole beans with notes of dark chocolate and roasted nuts. 250 g.", price: 149, category: "coffee", grams: 270, picture: "a kraft paper bag of coffee beans with beans spilled beside it" },
      { handle: "filter-blend", title: "Filter blend", description: "A bright, fruity blend for pour-over and filter brewing. 250 g.", price: 139, category: "coffee", grams: 270, picture: "a pour-over coffee dripper on a glass carafe" },
      { handle: "breakfast-tea", title: "Breakfast tea", description: "A strong black tea that takes milk well. 100 g loose leaf.", price: 99, category: "tea", grams: 130, picture: "a tin of loose black tea with a scoop of leaves" },
      { handle: "chamomile-tea", title: "Chamomile", description: "Whole chamomile flowers for a calm evening cup. 40 g.", price: 89, category: "tea", grams: 70, picture: "a glass jar of dried chamomile flowers" },
      { handle: "wildflower-honey", title: "Wildflower honey", description: "Raw honey from summer meadows, thick and floral. 350 g.", price: 129, category: "pantry", grams: 450, picture: "a jar of golden honey with a wooden honey dipper" },
      { handle: "berry-jam", title: "Berry jam", description: "A loose jam of raspberries and blackcurrants. 300 g.", price: 79, category: "pantry", grams: 400, picture: "a jar of deep red berry jam with a spoon" },
      { handle: "olive-oil", title: "Olive oil", description: "Cold-pressed extra virgin olive oil from a single grove. 500 ml.", price: 189, category: "pantry", grams: 900, picture: "a tall dark glass bottle of olive oil beside a small dish of oil" },
      { handle: "oat-granola", title: "Oat granola", description: "Baked oats with almonds and a little honey. 400 g.", price: 99, category: "pantry", grams: 430, picture: "a glass jar of golden granola with a bowl of granola beside it" },
    ],
    look: "Warm food photograph on a rustic oak table, soft window light, earthy tones, natural shadows.",
    heroPicture: "a sunlit pantry shelf with coffee bags, tea tins and jars of honey and jam, wide shot",
    storyPicture: "freshly roasted coffee beans cooling in a roaster tray, close-up",
  },
  {
    key: "home",
    version: 1,
    title: "Home and interior store",
    summary: "Things for the home: a calm front page and products by room.",
    description: "A demo homeware store with ceramics, textiles and lighting, sorted by room. Replace the products and pictures with your own.",
    category: "retail",
    storeName: "Still House",
    headline: "A calmer home",
    tagline: "Ceramics, textiles and light for rooms that feel lived in.",
    points: [
      { title: "Made by hand", text: "Bowls and vases thrown in small studios, each a little different." },
      { title: "Soft textiles", text: "Linen and wool for sofas, beds and tables." },
      { title: "Warm light", text: "Lamps and candles that make evenings slower." },
    ],
    storyTitle: "Our studio",
    story: "We work with a handful of makers and visit each of them. What we sell is what we live with at home.",
    about: [
      "Still House is a demo store made by Kaizena Flow to show what a homeware store can look like.",
      "The products, words and pictures are samples. Replace them with your own whenever you are ready.",
    ],
    categories: [
      { slug: "ceramics", name: "Ceramics" },
      { slug: "textiles", name: "Textiles" },
      { slug: "lighting", name: "Lighting" },
    ],
    products: [
      { handle: "stoneware-vase", title: "Stoneware vase", description: "A hand-thrown vase with a speckled glaze, for a single branch or a bunch.", price: 549, category: "ceramics", grams: 900, picture: "a speckled cream stoneware vase with a dried branch" },
      { handle: "serving-bowl", title: "Serving bowl", description: "A wide bowl in matte glaze, for salads and fruit.", price: 429, category: "ceramics", grams: 1100, picture: "a wide matte grey ceramic serving bowl" },
      { handle: "mug-pair", title: "Pair of mugs", description: "Two mugs with a soft glaze and a comfortable handle.", price: 349, category: "ceramics", grams: 700, picture: "two handmade ceramic mugs side by side" },
      { handle: "linen-cushion", title: "Linen cushion", description: "A cushion cover in washed linen with a hidden zip.", price: 399, category: "textiles", grams: 300, picture: "a rust-coloured linen cushion on a light sofa" },
      { handle: "wool-throw", title: "Wool throw", description: "A heavy throw in wool with a subtle check.", price: 1290, category: "textiles", grams: 1400, picture: "a folded checked wool throw blanket" },
      { handle: "table-runner", title: "Table runner", description: "A long runner in linen, for everyday dinners and long tables.", price: 299, category: "textiles", grams: 250, picture: "a natural linen table runner on a wooden table" },
      { handle: "table-lamp", title: "Table lamp", description: "A small lamp with a ceramic base and a linen shade.", price: 1190, category: "lighting", grams: 1800, picture: "a table lamp with a ceramic base and a linen shade, lit" },
      { handle: "candle-holders", title: "Candle holders", description: "A pair of brass holders for dinner candles.", price: 449, category: "lighting", grams: 600, picture: "two brass candle holders with lit dinner candles" },
    ],
    look: "Interior product photograph in a bright room with pale plaster walls and light oak, soft natural light, calm Scandinavian styling.",
    heroPicture: "a calm living room with a linen sofa, ceramics on a shelf and afternoon light, wide shot",
    storyPicture: "a potter's hands shaping a bowl on a wheel, close-up, no face visible",
  },
  {
    key: "electronics",
    version: 1,
    title: "Electronics store",
    summary: "Gadgets and accessories: a bold front page and products by use.",
    description: "A demo electronics store with audio, charging and desk accessories, sorted by use. Replace the products and pictures with your own.",
    category: "retail",
    storeName: "Volt & Wire",
    headline: "Gear that just works",
    tagline: "Audio, charging and desk accessories, tested every day and built to last.",
    points: [
      { title: "Tested in use", text: "Every product is used daily by our team before it is listed." },
      { title: "Clear specifications", text: "What it connects to, how long it lasts and what is in the box." },
      { title: "Help when you need it", text: "Questions about a product are answered by people who use it." },
    ],
    storyTitle: "From the test bench",
    story: "We test battery life, range and sound side by side, and only keep what we would buy ourselves.",
    about: [
      "Volt & Wire is a demo store made by Kaizena Flow to show what an electronics store can look like.",
      "The products, words and pictures are samples. Replace them with your own whenever you are ready.",
    ],
    categories: [
      { slug: "audio", name: "Audio" },
      { slug: "charging", name: "Charging" },
      { slug: "desk", name: "Desk" },
    ],
    products: [
      { handle: "wireless-headphones", title: "Wireless headphones", description: "Over-ear headphones with soft cushions and a battery that lasts a long week.", price: 1990, category: "audio", grams: 280, picture: "matte black over-ear wireless headphones" },
      { handle: "portable-speaker", title: "Portable speaker", description: "A compact speaker with a fabric cover and a strap.", price: 1290, category: "audio", grams: 540, picture: "a compact cylindrical fabric-covered portable speaker" },
      { handle: "true-wireless-earbuds", title: "Wireless earbuds", description: "Small earbuds in a pocket case that charges them three times.", price: 1490, category: "audio", grams: 60, picture: "white wireless earbuds beside their open charging case" },
      { handle: "fast-charger", title: "Fast charger", description: "A compact wall charger with two USB-C ports.", price: 399, category: "charging", grams: 110, picture: "a small white USB-C wall charger" },
      { handle: "power-bank", title: "Power bank", description: "A slim power bank that charges a phone twice.", price: 549, category: "charging", grams: 220, picture: "a slim graphite power bank with a short cable" },
      { handle: "braided-cable", title: "Braided cable", description: "A two-metre USB-C cable with a braided sleeve.", price: 199, category: "charging", grams: 60, picture: "a coiled braided USB-C cable" },
      { handle: "mechanical-keyboard", title: "Mechanical keyboard", description: "A compact keyboard with quiet switches and a wired or wireless connection.", price: 1490, category: "desk", grams: 750, picture: "a compact mechanical keyboard with light grey keys" },
      { handle: "phone-stand", title: "Phone stand", description: "An aluminium stand that holds a phone upright or sideways.", price: 299, category: "desk", grams: 250, picture: "an aluminium phone stand on a desk" },
    ],
    look: "Crisp tech product photograph on a smooth charcoal surface with a subtle gradient, studio lighting, sharp detail, modern and clean.",
    heroPicture: "a tidy modern desk with headphones, a keyboard and a speaker under cool studio light, wide shot",
    storyPicture: "a circuit board and small tools on a workbench, close-up with shallow focus",
  },
  {
    key: "services",
    version: 1,
    title: "Services and bookings",
    summary: "A salon taking appointments: a welcoming front page and services to book.",
    description: "A demo hair salon whose services are booked by time, with a team and opening hours. Replace the services and pictures with your own.",
    category: "services",
    storeName: "North Hair Studio",
    headline: "Book your next appointment",
    tagline: "Cuts, colour and care in a calm studio. Choose a time that suits you.",
    points: [
      { title: "Book in a minute", text: "Pick a service and a time, and it is confirmed at once." },
      { title: "A calm studio", text: "Good light, good coffee and time for each guest." },
      { title: "Advice included", text: "Every appointment starts with a short talk about what you want." },
    ],
    storyTitle: "About the studio",
    story: "A small team in a bright studio, with time set aside for every guest and every question.",
    about: [
      "North Hair Studio is a demo store made by Kaizena Flow to show what a services store taking bookings can look like.",
      "The services, words and pictures are samples. Replace them with your own whenever you are ready.",
    ],
    categories: [
      { slug: "cuts", name: "Cuts" },
      { slug: "colour", name: "Colour" },
      { slug: "care", name: "Care" },
    ],
    products: [
      { handle: "haircut", title: "Haircut", description: "A wash, a cut and a finish, with advice on styling at home.", price: 690, category: "cuts", minutes: 45, picture: "salon scissors and a comb on a folded towel" },
      { handle: "short-cut", title: "Short cut", description: "A quick cut for short hair, with a neat finish.", price: 490, category: "cuts", minutes: 30, picture: "a barber's clippers and a brush on a marble counter" },
      { handle: "colour", title: "Colour", description: "A single colour from roots to ends, with a toning gloss.", price: 1290, category: "colour", minutes: 90, picture: "hair colour bowls and brushes on a salon trolley" },
      { handle: "highlights", title: "Highlights", description: "Highlights placed by hand for a soft, natural lift.", price: 1590, category: "colour", minutes: 120, picture: "strips of foil and a tint brush on a salon counter" },
      { handle: "treatment", title: "Deep treatment", description: "A nourishing mask and a scalp massage.", price: 450, category: "care", minutes: 30, picture: "salon hair treatment jars on a shelf with soft light" },
      { handle: "blow-dry", title: "Blow-dry", description: "A wash and a smooth or voluminous blow-dry.", price: 390, category: "care", minutes: 30, picture: "a hair dryer and a round brush on a salon counter" },
    ],
    look: "Bright salon photograph with pale wood, white tiles and plants, soft natural light, calm and inviting.",
    heroPicture: "a bright, empty hair salon with mirrors, chairs and plants in morning light, wide shot",
    storyPicture: "a neat salon station with a mirror, brushes and a plant, close-up",
  },
  ORBIT_PACK,
  ATELIER_PACK,
  ARCADE_PACK,
  BOTANICA_PACK,
];

/** Each pack's trade in a word or two, for a theme's cards and its looks' choices (`docs/theme-showcase-phase-1.md` step 3). */
export const PACK_TRADES: Record<PackKey, string> = {
  fashion: "Fashion",
  beauty: "Beauty",
  food: "Food and drink",
  home: "Home",
  electronics: "Electronics",
  services: "Services",
  astronomy: "Astronomy and space",
  ceramics: "Ceramics",
  neon: "Neon signs",
  plants: "Plants",
};

/** What a pack's store is, after its name: "Field & Fold, a demo fashion store". */
export const PACK_DEMO_WORDS: Record<PackKey, string> = {
  fashion: "a demo fashion store",
  beauty: "a demo skin care store",
  food: "a demo food and drink store",
  home: "a demo home and interior store",
  electronics: "a demo electronics store",
  services: "a demo hair salon taking bookings",
  astronomy: "a demo shop of night sky prints",
  ceramics: "a demo ceramics studio",
  neon: "a demo neon sign workshop",
  plants: "a demo plant shop",
};

/** A pack by its key, or null. */
export const contentPack = (key: string): ContentPack | null => CONTENT_PACKS.find((pack) => pack.key === key) ?? null;

/** The prompt for one of a pack's pictures: what it shows, in the pack's look, by the rules every pack picture keeps. */
export const packPicturePrompt = (pack: ContentPack, subject: string): string => `${subject}. ${pack.look} ${PICTURE_RULES}`;

/** What every photograph of a pack is, said to the model in so many words. */
export const REAL_PHOTO = "A real photograph, not a 3D render, illustration, painting or digital art.";

/** The prompt for one of a pack's photographs: the slot's brief, the shoot's direction (`look`), and the rules every pack picture keeps. */
export const packPhotoPrompt = (pack: ContentPack, photo: PackPhoto): string => `${photo.brief} ${pack.look} ${REAL_PHOTO} ${PICTURE_RULES}`;

/** A price in Norway's kroner as the minor units a market's price is set in: the same number in Sweden, about two thirds in Denmark. */
export function packPrice(price: number, market: string): number {
  if (market === "DK") return Math.max(9, Math.round((price * 0.68) / 10) * 10 - 1) * 100;
  return price * 100;
}

/** The store addresses the packs' templates take (`pack-fashion` …), never a store's own. */
export const packSlug = (key: PackKey): string => `pack-${key}`;

/** A pack's pictures by slot: its home page's two, the other photographs its designed pages read, then one per product. */
export function packSlots(pack: ContentPack): string[] {
  const products = pack.products.map((p) => `product:${p.handle}`);
  const own = Object.keys(pack.photos ?? {}).filter((slot) => slot !== "hero" && slot !== "story" && !products.includes(slot));
  return ["hero", "story", ...own, ...products];
}

/**
 * Whether a slot still needs its picture made, from what the template keeps for it: a photograph not made yet (art placed there only
 * stands in, and is kept with the address it came from), or a picture neither made nor brought as art.
 */
export function slotMissing(pack: ContentPack, slot: string, kept: unknown): boolean {
  const held = kept && typeof kept === "object" ? (kept as { art?: unknown }) : null;
  if (pack.photos?.[slot]) return !held || typeof held.art === "string";
  return !held && !pack.art?.[slot];
}

/** How many of a pack's pictures are still to make, from what its template keeps (`store_starters.pack_pictures`); art needs none unless a photograph is to replace it. */
export function picturesMissing(pack: ContentPack, pictures: unknown): number {
  const kept = pictures && typeof pictures === "object" && !Array.isArray(pictures) ? (pictures as Record<string, unknown>) : {};
  return packSlots(pack).filter((slot) => slotMissing(pack, slot, kept[slot])).length;
}
