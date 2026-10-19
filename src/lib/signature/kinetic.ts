import type { PackPicture } from "../content-pack-pages";
import type { ContentPack } from "../content-packs";
import { DESIGN_SNAPSHOT_VERSION, type DesignLayout } from "../design-presets";
import type { LaunchTheme } from "../launch-themes";
import type { PackPictureOf } from "../pack-designs";
import { newPageContent, type PageContent, type PageRow } from "../page-content";
import type { ThemeSettings } from "../theme";
import { coreStyles, em, lines, rem } from "../theme-kit";
import type { ThemeSection, ThemeSections } from "../theme-sections";

import { EYEBROW, heading, iconList, image, paragraph, phonesHidden, photo, product, productGrid, shot, site, text, twoButtons, uuid, type Look } from "./kit";

/**
 * Kinetic, a signature theme (`docs/signature-themes.md`): a sportswear brand on the move, made from scratch. Chalk-white pages, Barlow
 * Condensed in bold italic capitals over Inter, a header that lies over a hero as wide as the screen, a band of words that runs across the
 * page, women's and men's kit side by side as two tall pictures, square buttons with an arrow, outlined numerals, a cut corner on pictures,
 * and a floodlit band to end on. Its demo store, Halden Athletic, sells running and training wear for women and men, photographed with
 * women and men athletes (D270) and drawn by `scripts/theme-art/kinetic.js` until then (`public/demo/themes/kinetic/`). Data only; every
 * word passes `findClaims()` (`signature-themes.test.ts`).
 */

const ART = "/demo/themes/kinetic";
const art = (name: string, width: number, height: number, alt: string): PackPicture => ({ url: `${ART}/${name}.webp`, width, height, alt });

const DISPLAY = "Barlow Condensed";

// ---------------------------------------------------------------------------------------------------------------------------------------
// The demo store: Halden Athletic
// ---------------------------------------------------------------------------------------------------------------------------------------

const KIT = [
  ["tempo-tights", "Women's tempo tights", "High-rise running tights with a wide waistband, a zipped pocket at the back and reflective details at the ankle.", 799, "women", 260, "Black high-rise running tights with a zipped pocket at the back"],
  ["training-tank", "Women's training tank", "A light, close-fitting tank with a racer back and flat seams that lie smooth under a running vest.", 399, "women", 120, "A coral racer-back training tank"],
  ["wind-jacket", "Women's wind jacket", "A light shell with a hood and thumb loops that folds into its own chest pocket.", 1199, "women", 210, "A pale blue running jacket with a hood"],
  ["split-shorts", "Men's split shorts", "Light running shorts with split hems, a liner and a key pocket at the back.", 449, "men", 140, "Black running shorts with split hems"],
  ["base-layer", "Men's base layer", "A long-sleeve half-zip in brushed jersey for cold mornings and winter intervals.", 549, "men", 230, "A charcoal long-sleeve base layer with a half zip"],
  ["training-tee", "Men's training tee", "A light tee with mesh panels at the back and a cut that stays put mid-stride.", 349, "men", 150, "A white training tee with mesh panels at the back"],
  ["trail-shoes", "Trail running shoes", "Deep lugs, a rock plate and a snug heel for rough paths, loose gravel and wet roots.", 1599, "gear", 620, "A red and black trail running shoe with deep lugs"],
  ["running-vest", "Running vest", "A close-fitting vest with two soft flasks at the chest and room for a jacket at the back.", 899, "gear", 300, "A black running vest with two soft flasks at the chest"],
] as const;

/** What each product's photograph shows (D270): the kit alone, never worn by a person. */
const KIT_SHOTS: Record<(typeof KIT)[number][0], string> = {
  "tempo-tights": "black high-rise running tights with a wide waistband and a small zipped pocket at the back, on an invisible mannequin",
  "training-tank": "a coral racer-back training tank with flat seams, on an invisible mannequin",
  "wind-jacket": "a pale blue lightweight running jacket with a hood, thumb loops and a chest pocket, zipped up on an invisible mannequin",
  "split-shorts": "black running shorts with split hems and a small key pocket, on an invisible mannequin",
  "base-layer": "a charcoal long-sleeve half-zip base layer in brushed jersey, on an invisible mannequin",
  "training-tee": "a white short-sleeve training t-shirt with fine mesh panels, on an invisible mannequin",
  "trail-shoes": "a single red and black trail running shoe with deep rubber lugs, seen from the side",
  "running-vest": "a black running vest with two soft flasks of water in its chest pockets, standing upright as if worn",
};

export const KINETIC_PACK: ContentPack = {
  key: "sports",
  version: 1,
  title: "Sportswear store",
  summary: "Running and training wear for women and men: the demo store made for the Kinetic theme.",
  description:
    "Halden Athletic, a demo store of running and training wear for women and men, with shoes and gear, its story and an about page. Replace the products, words and pictures with your own.",
  category: "retail",
  storeName: "Halden Athletic",
  headline: "Run your own race",
  tagline: "Running and training wear for women and men, cut to move and made for the long miles.",
  points: [
    { title: "Worn on the track first", text: "Every piece starts as a sample our club wears through a winter of intervals and long runs." },
    { title: "Cut for women and for men", text: "Each style has its own pattern for women and for men, never one shape stretched to fit both." },
    { title: "Pockets where you reach", text: "Zipped pockets sit where a hand finds them mid-stride, sized for a phone, keys and a gel." },
  ],
  storyTitle: "Born on a running track",
  story:
    "Halden Athletic began as a running club that met on a cinder track every Tuesday night. We still wear every piece there, in all weathers, before it comes to the shop.",
  about: [
    "Halden Athletic makes running and training wear for women and men, and a small range of shoes and gear for the trails.",
    "This is a demo store made for the Kinetic theme. Its products, words and pictures are examples: replace them with your own.",
  ],
  categories: [
    { slug: "women", name: "Women" },
    { slug: "men", name: "Men" },
    { slug: "gear", name: "Shoes and gear" },
  ],
  products: KIT.map(([handle, title, description, price, category, grams]) => ({
    handle,
    title,
    description,
    price,
    category,
    picture: `${title} on a light grey background`,
    grams,
  })),
  look:
    "Shot by a professional sports photographer for a running brand's campaign, on a full-frame camera with a 35 mm or 85 mm lens and a fast shutter that freezes the stride, a little motion blur left in the background. Natural light: a low sun from the side at sunrise or late afternoon, or floodlights at night; strong contrast, real texture of skin, fabric and track. Athletic women and men of different builds and backgrounds in plain running and training wear without any branding. Crisp and full of energy, true-to-life colour with a cool grade and warm highlights, fine grain. Product photographs on a light grey seamless background in soft, even studio light.",
  heroPicture: "A woman and a man sprinting side by side on a red running track at sunrise",
  storyPicture: "A running club of women and men jogging together on a track at dusk",
  art: {
    hero: art("hero", 2560, 1440, "Drawn runners, a woman and a man, sprinting side by side on a red running track against a sunrise sky"),
    story: art("story", 1600, 1200, "Drawn runners, women and men, jogging together along a track at dusk under floodlights"),
    track: art("track", 2400, 1200, "A drawn floodlit running track at night, two runners far down its curving lanes"),
    "tile:women": art("tile-women", 1200, 1500, "A drawn female runner mid-stride in a coral tank and black tights against a warm sky"),
    "tile:men": art("tile-men", 1200, 1500, "A drawn male runner mid-stride in a white tee and black shorts against a cool morning sky"),
    "tile:gear": art("tile-gear", 1200, 1500, "A drawn red trail running shoe and a black running vest on dark rock"),
    ...Object.fromEntries(KIT.map(([handle, , , , , , alt]) => [`product:${handle}`, art(`kit-${handle}`, 1200, 1600, alt)])),
  },
  photos: {
    hero: shot(
      "landscape",
      "A woman and a man sprinting side by side on a red running track at sunrise",
      "A woman and a man sprinting side by side down the home straight of a red running track at sunrise, photographed from the front at a three-quarter angle with a long lens at track level, both at full stride with their arms driving, their faces clearly visible, focused and determined, sweat catching the low golden sun behind them. They fill the right two thirds of the frame; the left third is calm, softly blurred track and warm sky with room for a headline.",
      { people: true },
    ),
    story: shot(
      "landscape",
      "A running club of women and men jogging together along a track at dusk under floodlights",
      "A running club of women and men of different ages and backgrounds jogging together along a cinder running track at dusk, photographed from the front at a little distance as they come toward the camera, talking and smiling mid-stride, their faces lit by the floodlights just coming on above the stand.",
      { people: true },
    ),
    track: shot(
      "landscape",
      "A woman and a man running toward the camera along a floodlit track at night",
      "A woman and a man running toward the camera along the outside lane of a floodlit running track at night, photographed with a long lens from a little distance, their faces lit by the floodlights, breathing hard and focused, their long shadows stretched across the red surface. They are in the lower third of the frame; the middle and the top are calm, dark sky with room for a heading.",
      { people: true },
    ),
    "tile:women": shot(
      "portrait",
      "A female runner mid-stride on a running track in a coral tank and black tights",
      "A female runner mid-stride on a red running track in black running tights and a coral racer-back tank, photographed from the front at a three-quarter angle at hip height with a long lens, her face focused and determined, her ponytail flying, low warm side light on her face, shoulders and legs. She fills the upper two thirds of the frame; the bottom is calm track.",
      { people: true },
    ),
    "tile:men": shot(
      "portrait",
      "A male sprinter driving out of the starting blocks on a running track",
      "A male sprinter driving out of the starting blocks on a red running track in black split shorts and a white training tee, photographed from the front at track level with a long lens, his face intense and concentrated as he rises from the crouch, the white lane lines leading away behind him into a cool morning haze. He fills the upper two thirds of the frame; the bottom is calm track.",
      { people: true },
    ),
    "tile:gear": shot(
      "portrait",
      "A red and black trail running shoe and a black running vest on dark rock beside a mountain trail",
      "A pair of red and black trail running shoes with deep lugs and a black running vest with two soft flasks, laid together on a wet slab of dark rock beside a mountain trail, morning mist and a blurred slope behind, no person in the frame.",
    ),
    ...Object.fromEntries(
      KIT.map(([handle, , , , , , alt]) => [
        `product:${handle}`,
        shot(
          "portrait",
          alt,
          `A product photograph for a sportswear shop: ${KIT_SHOTS[handle]}, alone in the middle of a light grey seamless background in soft, even studio light, the whole piece in frame with even space around it and a faint shadow below.`,
        ),
      ]),
    ),
  },
  design: "kinetic",
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// The demo store's pages
// ---------------------------------------------------------------------------------------------------------------------------------------

const eyebrow = (words: string) => text([words], "kinetic-eyebrow", { ...EYEBROW, letterSpacing: em(0.24), weight: 700 });
const LEAD: Look = { size: rem(1.15), lineHeight: lines(1.6) };
const ON_DARK = "#f4f4f1";
const NUMERAL: Look = { family: DISPLAY, size: rem(5), lineHeight: lines(0.9), weight: 800, style: "italic" };

/** What Kinetic's designed home page says: its demo store's words, or any store's when one of its sections is placed (D272). */
type KineticWords = {
  hero: { eyebrow: string; heading: string; lead: string; first: [string, string]; second: [string, string] };
  ticker: string[];
  split: { picture: string; href: string; name: string; line: string }[];
  kit: { eyebrow: string; heading: string; more: string };
  points: { eyebrow: string; heading: string; lines: [icon: string, words: string][] };
  steps: { title: string; text: string }[];
  story: { eyebrow: string; heading: string; text: string; button: [string, string] };
  finale: { heading: string; lead: string; button: string };
};

/** Halden Athletic's own words. */
const haldenWords = (pack: ContentPack): KineticWords => ({
  hero: {
    eyebrow: "Running and training wear",
    heading: "Run your <em>own</em> race",
    lead: pack.tagline,
    first: ["Shop women", "/category/women"],
    second: ["Shop men", "/category/men"],
  },
  ticker: ["Run", "Train", "Recover", "Repeat"],
  split: [
    { picture: "tile:women", href: "/category/women", name: "Women", line: "Tights, tanks and a jacket cut for women" },
    { picture: "tile:men", href: "/category/men", name: "Men", line: "Shorts, tees and layers cut for men" },
  ],
  kit: { eyebrow: "The kit", heading: "Ready for the <em>next session</em>", more: "See all the kit" },
  points: {
    eyebrow: "Shoes and gear",
    heading: "For the <em>long way</em> round",
    lines: [
      ["mountain", "Lugs that bite on rock, gravel and roots"],
      ["droplet", "Two soft flasks within reach at the chest"],
      ["package", "Room at the back for a jacket and a snack"],
      ["zap", "Light enough to forget you are wearing it"],
    ],
  },
  steps: pack.points,
  story: { eyebrow: "Our story", heading: pack.storyTitle, text: pack.story, button: ["About us", "/about"] },
  finale: { heading: "Your next <em>session</em> starts here", lead: "Eight pieces for women and men, from the track to the trail.", button: "Shop all the kit" },
});

/** The words a section brings to any store: what to write there, never Halden Athletic's. */
const SECTION_WORDS: KineticWords = {
  hero: {
    eyebrow: "Welcome",
    heading: "Your <em>headline</em> here",
    lead: "One or two sentences about what you sell and who it is for.",
    first: ["Shop now", "/products"],
    second: ["Learn more", "#story"],
  },
  ticker: ["Your", "Four", "Words", "Here"],
  split: [
    { picture: "tile:women", href: "/products", name: "First collection", line: "A line about what it holds" },
    { picture: "tile:men", href: "/products", name: "Second collection", line: "A line about what it holds" },
  ],
  kit: { eyebrow: "Just in", heading: "Our <em>newest</em> products", more: "See all products" },
  points: {
    eyebrow: "Good to know",
    heading: "Four <em>short</em> points",
    lines: [
      ["mountain", "A first point, in a few words"],
      ["droplet", "A second point, in a few words"],
      ["package", "A third point, in a few words"],
      ["zap", "A fourth point, in a few words"],
    ],
  },
  steps: [
    { title: "The first step", text: "A sentence about how it starts." },
    { title: "The second step", text: "A sentence about what happens next." },
    { title: "The last step", text: "A sentence about what the customer gets." },
  ],
  story: { eyebrow: "Our story", heading: "Where it began", text: "A few sentences about who you are and why you do it.", button: ["About us", "/about"] },
  finale: { heading: "Your <em>last</em> word", lead: "A sentence that invites a visitor to look around.", button: "Shop now" },
};

/**
 * Kinetic's designed rows: the hero as wide as the screen, a band of words that runs, women's and men's kit side by side, the products,
 * gear beside four points, three numbered steps, the story, and a floodlit band to end on.
 */
function kineticSections(words: KineticWords, picture: PackPictureOf): ThemeSection[] {
  const hero = {
    id: uuid(),
    type: "row",
    layout: "1",
    width: "full",
    height: 94,
    align: "bottom",
    sectionStyle: "hero",
    className: "kinetic-hero",
    background: photo(picture("hero"), 28, "#07080a"),
    columns: [
      {
        id: uuid(),
        className: "kinetic-hero-copy",
        typography: { text: { color: ON_DARK } },
        blocks: [
          eyebrow(words.hero.eyebrow),
          heading(words.hero.heading, 1, "kinetic-display", { color: ON_DARK }),
          text([words.hero.lead], "kinetic-lead kinetic-on-dark", LEAD),
          twoButtons(words.hero.first, words.hero.second, { shape: "square", className: "kinetic-hero-buttons" }),
        ],
      },
    ],
  };
  // The band: the words twice over, so the line can run on for ever (`kinetic-run`), and still for reduced motion.
  const run = Array.from({ length: 4 }, () => words.ticker.join("  /  ")).join("  /  ");
  const ticker = {
    id: uuid(),
    type: "row",
    layout: "1",
    width: "full",
    sectionStyle: "contrast",
    className: "kinetic-ticker",
    style: { padding: { top: 18, right: 0, bottom: 18, left: 0 } },
    columns: [{ id: uuid(), blocks: [text([`${run}  /  ${run}  /`], "kinetic-ticker-line", { family: DISPLAY, size: rem(2.25), weight: 800, style: "italic", transform: "uppercase", lineHeight: lines(1) })] }],
  };
  const half = (item: KineticWords["split"][number]) => ({
    id: uuid(),
    className: "kinetic-half",
    link: { href: item.href, label: item.name },
    background: photo(picture(item.picture), 22, "#07080a"),
    typography: { text: { color: ON_DARK } },
    blocks: [heading(item.name, 2, "kinetic-half-name", { color: ON_DARK }), text([item.line], "kinetic-half-line kinetic-on-dark")],
  });
  const split = {
    id: uuid(),
    type: "row",
    layout: "2",
    width: "full",
    sectionStyle: "plain",
    className: "kinetic-split",
    style: { padding: { top: 0, right: 0, bottom: 0, left: 0 } },
    columns: words.split.map(half),
  };
  const kit = {
    id: uuid(),
    type: "row",
    layout: "1",
    sectionStyle: "plain",
    htmlId: "kit",
    className: "kinetic-section",
    columns: [
      {
        id: uuid(),
        blocks: [
          eyebrow(words.kit.eyebrow),
          heading(words.kit.heading, 2),
          productGrid(8, { columns: { mobile: 2, tablet: 3, desktop: 4 }, gap: 24 }),
          { id: uuid(), type: "button", label: words.kit.more, href: "/products", variant: "outline", shape: "square", align: "center", className: "kinetic-more" },
        ],
      },
    ],
  };
  const points = {
    id: uuid(),
    type: "row",
    layout: "2",
    align: "middle",
    sectionStyle: "muted",
    className: "kinetic-section kinetic-points",
    columns: [
      { id: uuid(), width: 50, blocks: [image(picture("tile:gear"), "kinetic-cut")] },
      {
        id: uuid(),
        width: 50,
        className: "kinetic-points-copy",
        blocks: [eyebrow(words.points.eyebrow), heading(words.points.heading, 2), iconList(words.points.lines, { className: "kinetic-list" })],
      },
    ],
  };
  const steps = {
    id: uuid(),
    type: "row",
    layout: "3",
    sectionStyle: "feature",
    className: "kinetic-section kinetic-steps",
    columns: words.steps.map((step, i) => ({
      id: uuid(),
      className: "kinetic-step",
      blocks: [text([`0${i + 1}`], "kinetic-numeral", NUMERAL), heading(step.title, 3), text([step.text])],
    })),
  };
  const story = {
    id: uuid(),
    type: "row",
    layout: "2",
    align: "middle",
    sectionStyle: "plain",
    htmlId: "story",
    className: "kinetic-section kinetic-story",
    columns: [
      {
        id: uuid(),
        width: 45,
        className: "kinetic-story-copy",
        blocks: [
          eyebrow(words.story.eyebrow),
          heading(words.story.heading, 2),
          text([words.story.text], "kinetic-lead", LEAD),
          { id: uuid(), type: "button", label: words.story.button[0], href: words.story.button[1], variant: "filled", shape: "square" },
        ],
      },
      { id: uuid(), width: 55, blocks: [image(picture("story"), "kinetic-cut kinetic-cut-left")] },
    ],
  };
  const finale = {
    id: uuid(),
    type: "row",
    layout: "1",
    width: "full",
    height: 72,
    align: "middle",
    sectionStyle: "contrast",
    className: "kinetic-finale",
    background: photo(picture("track"), 40, "#07080a"),
    columns: [
      {
        id: uuid(),
        typography: { text: { align: "center", color: ON_DARK } },
        blocks: [
          heading(words.finale.heading, 2, "kinetic-display", { color: ON_DARK, size: rem(4.5) }),
          text([words.finale.lead], "kinetic-lead kinetic-on-dark", LEAD),
          { id: uuid(), type: "button", label: words.finale.button, href: "/products", variant: "filled", shape: "square", align: "center", size: "lg" },
        ],
      },
    ],
  };
  const section = (key: string, name: string, description: string, thumb: string | null, row: unknown): ThemeSection => ({
    key,
    name,
    description,
    thumb,
    row: row as PageRow,
  });
  return [
    section("hero", "Full-screen hero", "Your headline over a picture as wide as the screen, with two buttons", "hero", hero),
    section("ticker", "Running words", "A band of four words that runs across the page", null, ticker),
    section("split", "Two tall pictures", "Two collections side by side, each a tall picture with its name", "tile:women", split),
    section("products", "Newest products", "Your newest products in four columns, with a link to all", null, kit),
    section("points", "Picture and four points", "A picture with a cut corner beside four short points with icons", "tile:gear", points),
    section("steps", "Three numbered steps", "Three short points under large outlined numbers", null, steps),
    section("story", "Story", "A few sentences and a button beside a wide picture", "story", story),
    section("finale", "Floodlit band", "A heading, a line and a button over a picture as wide as the screen", "track", finale),
  ];
}

/** Halden Athletic's home page: Kinetic's sections in its own words. */
export function kineticHomePage(pack: ContentPack, picture: PackPictureOf): PageContent {
  return { ...newPageContent(), title: "Home", slug: "welcome", rows: kineticSections(haldenWords(pack), picture).map((section) => section.row) };
}

/** Kinetic's sections as an owner places them (D272): its rows in words for any store. */
export const KINETIC_SECTIONS: ThemeSections = (picture) => kineticSections(SECTION_WORDS, picture);

/** Halden Athletic's about page: its name over the club's picture, then its words beside the night track. */
export function kineticAboutPage(pack: ContentPack, picture: PackPictureOf): PageContent {
  const rows = [
    {
      id: uuid(),
      type: "row",
      layout: "1",
      width: "full",
      height: 64,
      align: "bottom",
      sectionStyle: "hero",
      className: "kinetic-about-hero",
      background: photo(picture("story"), 35, "#07080a"),
      columns: [
        {
          id: uuid(),
          className: "kinetic-hero-copy",
          typography: { text: { color: ON_DARK } },
          blocks: [eyebrow("About us"), heading(`About <em>${pack.storeName}</em>`, 1, "kinetic-display", { color: ON_DARK })],
        },
      ],
    },
    {
      id: uuid(),
      type: "row",
      layout: "2",
      align: "middle",
      sectionStyle: "plain",
      className: "kinetic-section",
      columns: [
        {
          id: uuid(),
          blocks: [
            heading(pack.storyTitle, 2),
            text([pack.story, ...pack.about]),
            { id: uuid(), type: "button", label: "Shop all the kit", href: "/products", variant: "filled", shape: "square" },
          ],
        },
        { id: uuid(), blocks: [image(picture("track"), "kinetic-cut")] },
      ],
    },
  ];
  return { ...newPageContent(), title: "About us", slug: "about", rows: rows as unknown as PageRow[] };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// The theme
// ---------------------------------------------------------------------------------------------------------------------------------------

const header: DesignLayout = {
  css: "",
  overlay: { where: "front", textColor: "#ffffff" },
  menus: { "kinetic-header-menu": "header" },
  rows: [
    {
      id: "kinetic-header-row",
      type: "row",
      // Its stripe spans the screen; its content keeps to the page's width.
      width: "full",
      contentWidth: "content",
      layout: "fit-sides",
      stack: false,
      align: "middle",
      className: "kinetic-header",
      style: { padding: { top: 16, right: 28, bottom: 16, left: 28 } },
      at: { sm: { gap: 8, style: { padding: { top: 12, right: 16, bottom: 12, left: 16 } } } },
      columns: [
        { id: "kinetic-header-brand", inline: true, blocks: [site("kinetic-header-menu-button", "menuButton"), site("kinetic-header-logo", "logo", { className: "kinetic-logo" })] },
        {
          id: "kinetic-header-nav",
          blocks: [
            {
              id: "kinetic-header-menu",
              type: "menu",
              align: "center",
              className: "kinetic-nav",
              itemHover: { kind: "line", edge: "below", travel: "slide", thickness: 3, active: true },
              ...phonesHidden,
            },
          ],
        },
        {
          id: "kinetic-header-tools",
          inline: true,
          justify: "end",
          blocks: [
            site("kinetic-header-search", "search"),
            site("kinetic-header-account", "account", phonesHidden),
            site("kinetic-header-wishlist", "wishlist"),
            site("kinetic-header-cart", "cart"),
          ],
        },
      ],
    },
  ] as unknown as PageRow[],
};

const footer: DesignLayout = {
  css: "",
  menus: { "kinetic-footer-menu": "footer" },
  rows: [
    {
      id: "kinetic-footer-row",
      type: "row",
      // Its dark band spans the screen; its content keeps to the page's width.
      width: "full",
      contentWidth: "content",
      layout: "4",
      className: "kinetic-footer",
      background: { type: "color", color: "#0d0f12" },
      typography: { text: { color: ON_DARK } },
      style: { padding: { top: 88, right: 28, bottom: 56, left: 28 } },
      columns: [
        {
          id: "kinetic-footer-brand",
          blocks: [
            site("kinetic-footer-logo", "logo", { className: "kinetic-logo" }),
            {
              id: "kinetic-footer-line",
              type: "richText",
              className: "kinetic-footer-line",
              doc: { type: "doc", content: [paragraph("See you out there.")] },
              typography: { text: { family: DISPLAY, style: "italic", weight: 800, transform: "uppercase", size: rem(2.4), lineHeight: lines(1) } },
            },
          ],
        },
        { id: "kinetic-footer-links", blocks: [{ id: "kinetic-footer-menu", type: "menu", direction: "column" }] },
        {
          id: "kinetic-footer-help",
          blocks: [
            site("kinetic-footer-cookies", "cookies"),
            site("kinetic-footer-withdrawal", "withdrawal"),
            site("kinetic-footer-markets", "markets", { display: "list", direction: "column" }),
          ],
        },
        { id: "kinetic-footer-company", blocks: [site("kinetic-footer-business", "business")] },
      ],
    },
  ] as unknown as PageRow[],
};

const productLayout: DesignLayout = {
  css: "",
  menus: {},
  rows: [
    {
      id: "kinetic-product-row",
      type: "row",
      layout: "2",
      className: "kinetic-product",
      style: { padding: { top: 32, right: 20, bottom: 64, left: 20 } },
      columns: [
        { id: "kinetic-product-media", className: "kinetic-gallery", blocks: [product("kinetic-product-back", "back"), product("kinetic-product-gallery", "gallery")] },
        {
          id: "kinetic-product-details",
          className: "kinetic-buybox",
          blocks: [
            product("kinetic-product-title", "title"),
            product("kinetic-product-price", "price"),
            product("kinetic-product-campaigns", "campaigns"),
            product("kinetic-product-notice", "notice"),
            product("kinetic-product-host", "host"),
            product("kinetic-product-buy", "buy"),
            product("kinetic-product-withdrawal", "withdrawal"),
            product("kinetic-product-description", "description"),
            product("kinetic-product-fields", "fields"),
            product("kinetic-product-safety", "safety"),
          ],
        },
      ],
    },
    {
      id: "kinetic-related-row",
      type: "row",
      layout: "1",
      className: "kinetic-section",
      columns: [
        {
          id: "kinetic-related",
          blocks: [product("kinetic-product-related", "related", { heading: "Complete the kit", limit: 4, columns: 4, at: { sm: { columns: 2 } } })],
        },
      ],
    },
  ] as unknown as PageRow[],
};

/**
 * Kinetic's stylesheet: headings in bold italic capitals with the accent on the italic word, a header that is glass over the hero and
 * chalk with a stripe of the accent elsewhere, a hero whose bottom edge is cut on a slant, a band of words that runs, two tall pictures that
 * lean in a little on hover, product cards with a sharp edge and a bar of the accent that slides in, pictures with a cut corner, outlined
 * numerals, and a dark footer. Written for the site's own classes and Kinetic's own (`kinetic-…`); every motion stops for reduced motion.
 */
const CSS = `
:root, :scope[data-site-css] { --kinetic-line: color-mix(in srgb, var(--foreground) 14%, transparent); --kinetic-cut: 44px; }
@keyframes kinetic-run { to { transform: translateX(-50%); } }

h1, h2, h3 { font-style: italic; text-wrap: balance; overflow-wrap: break-word; hyphens: auto; }
h1 em, h2 em { color: var(--accent); font-style: italic; }
.kinetic-display em { color: var(--accent); }
.kinetic-eyebrow.kinetic-eyebrow .rich-text p { color: var(--accent); margin: 0 0 1rem; }
.kinetic-lead.kinetic-lead .rich-text p { color: var(--muted); max-width: 34rem; }
.kinetic-on-dark.kinetic-on-dark .rich-text p { color: rgba(244,244,241,.86); }
.kinetic-finale .kinetic-lead.kinetic-lead .rich-text p { margin-inline: auto; }

.button-primary, .kz-btn { text-transform: uppercase; letter-spacing: .08em; font-weight: 700; }

.kinetic-header { position: relative; }
.kinetic-header::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: var(--accent); transform-origin: left; }
html[data-overlay-on] .kinetic-header { background: linear-gradient(180deg, rgba(7,8,10,.55), transparent); }
html[data-overlay-on] .kinetic-header::after { transform: scaleX(.18); }
.kinetic-logo a > span { font-family: var(--site-heading-font, sans-serif); font-size: 1.6rem; font-weight: 800; font-style: italic; text-transform: uppercase; letter-spacing: .01em; }
.kinetic-nav a { font-size: .82rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }

.kinetic-hero { position: relative; overflow: hidden; clip-path: polygon(0 0, 100% 0, 100% calc(100% - 64px), 0 100%); }
.kinetic-hero-copy { max-width: 46rem; padding-bottom: 32px; }
.kinetic-hero h1 { font-size: clamp(3.2rem, 9vw, 8rem); line-height: .86; text-shadow: 0 2px 30px rgba(7,8,10,.45); }
.kinetic-hero .kinetic-eyebrow.kinetic-eyebrow .rich-text p, .kinetic-about-hero .kinetic-eyebrow.kinetic-eyebrow .rich-text p { color: #f4f4f1; }
.kinetic-hero-copy .rich-text p { text-shadow: 0 1px 16px rgba(7,8,10,.5); }
@media (max-width: 767px) { .kinetic-hero-copy { background: radial-gradient(closest-side, rgba(7,8,10,.55), transparent); } .kinetic-logo a > span { font-size: 1.2rem; } }
.kinetic-hero .kz-btn-outline, .kinetic-finale .kz-btn-outline { color: #f4f4f1; border-color: rgba(244,244,241,.85); }
.kinetic-hero .kz-btn-outline:is(:hover, :focus-visible) { background: #f4f4f1; color: #0d0f12; }
.kinetic-about-hero { clip-path: polygon(0 0, 100% 0, 100% calc(100% - 48px), 0 100%); }
@media (max-width: 767px) { .kinetic-hero, .kinetic-about-hero { clip-path: polygon(0 0, 100% 0, 100% calc(100% - 28px), 0 100%); } }

.kinetic-ticker { overflow: hidden; margin-top: -1px; }
.kinetic-ticker-line .rich-text p { margin: 0; white-space: nowrap; display: inline-block; animation: kinetic-run 38s linear infinite; }

.kinetic-split { gap: 0; }
.kinetic-half { min-height: 78vh; display: flex; flex-direction: column; justify-content: flex-end; padding: 48px; position: relative; isolation: isolate; overflow: hidden; }
.kinetic-half::after { content: ""; position: absolute; inset: 0; z-index: -1; background: linear-gradient(180deg, transparent 45%, rgba(7,8,10,.82)); pointer-events: none; }
.kinetic-half h2 { font-size: clamp(3rem, 7vw, 6rem); line-height: .9; margin: 0 0 .5rem; transition: transform var(--kz-hover-dur, .35s) ease; }
.kinetic-half h2::after { content: " \\2192"; color: var(--accent); }
.kinetic-half:hover h2 { transform: translateX(10px); }
.kinetic-half-line.kinetic-half-line .rich-text p { margin: 0; }
@media (max-width: 767px) { .kinetic-half { min-height: 62vh; padding: 28px; } }

.kinetic-section h2 { margin-bottom: 2rem; }
.kinetic-more { margin-top: 2.4rem; }
.product-card { position: relative; transition: transform var(--kz-hover-dur, .3s) ease; }
.product-card::after { content: ""; position: absolute; left: 0; right: 0; bottom: -8px; height: 3px; background: var(--accent); transform: scaleX(0); transform-origin: left; transition: transform var(--kz-hover-dur, .3s) ease; }
.product-card:hover { transform: translateY(-4px); }
.product-card:hover::after { transform: scaleX(1); }
.product-card-image { background: var(--surface); clip-path: polygon(0 0, 100% 0, 100% calc(100% - 24px), calc(100% - 24px) 100%, 0 100%); }
.product-card h3 { font-style: normal; text-transform: uppercase; letter-spacing: .03em; font-size: 1.15rem; }

.kinetic-cut img { clip-path: polygon(0 0, 100% 0, 100% calc(100% - var(--kinetic-cut)), calc(100% - var(--kinetic-cut)) 100%, 0 100%); }
.kinetic-cut-left img { clip-path: polygon(var(--kinetic-cut) 0, 100% 0, 100% 100%, 0 100%, 0 var(--kinetic-cut)); }
.kinetic-list li { font-size: 1.05rem; padding: .55rem 0; border-bottom: 1px solid var(--kinetic-line); }
.kinetic-list li svg { color: var(--accent); }
.kinetic-numeral.kinetic-numeral .rich-text p { color: transparent; -webkit-text-stroke: 1.5px var(--accent); margin: 0 0 1rem; }
.kinetic-step { padding-top: 1.4rem; border-top: 3px solid var(--foreground); }
.kinetic-finale { text-align: center; }

.kinetic-footer { --background: #0d0f12; --surface: #16191e; --foreground: #f4f4f1; --muted: #a3a9b1; --border: #2a2e35; color: var(--foreground); }
.kinetic-footer .kinetic-logo a > span { color: #f4f4f1; }
.kinetic-footer a { color: inherit; }
.kinetic-footer-line { margin-top: 1rem; }
.kinetic-footer-line.kinetic-footer-line .rich-text p { color: var(--accent); }

.kinetic-gallery img { clip-path: polygon(0 0, 100% 0, 100% calc(100% - 36px), calc(100% - 36px) 100%, 0 100%); }
.kinetic-buybox h1 { font-size: clamp(2.2rem, 4vw, 3.4rem); line-height: .95; }
@media (min-width: 1024px) { .kinetic-buybox { position: sticky; top: 100px; align-self: start; } }

@media (prefers-reduced-motion: reduce) {
  .kinetic-ticker-line .rich-text p { animation: none; }
  .product-card:hover, .kinetic-half:hover h2 { transform: none; }
  .product-card::after { transition: none; }
}
`.trim();

/** The core section styles at Kinetic's scale: a hero heading that keeps to the screen on phones, generous room between sections. */
function kineticStyles() {
  const styles = coreStyles({ heroSize: 7, band: "#0d0f12", bandText: ON_DARK, space: 96 });
  return {
    ...styles,
    hero: {
      ...styles.hero,
      row: { style: { padding: { top: 120, right: 28, bottom: 120, left: 28 } }, at: { sm: { style: { padding: { top: 96, right: 18, bottom: 72, left: 18 } } } } },
      h1: { ...styles.hero.h1, at: { md: { typography: { text: { size: rem(5) } } }, sm: { typography: { text: { size: rem(3.25) } } } } },
    },
    plain: { row: { style: { padding: { top: 96, right: 20, bottom: 96, left: 20 } }, at: { sm: { style: { padding: { top: 56, right: 18, bottom: 56, left: 18 } } } } } },
  };
}

const LIGHT = { background: "#f4f4f1", surface: "#e9e9e4", text: "#0d0f12", muted: "#50565e", border: "#d5d6d0", accent: "#d6342a", accentText: "#ffffff" };
const DARK = { background: "#0b0d10", surface: "#16191e", text: "#f2f4f5", muted: "#9aa2ab", border: "#272c33", accent: "#c8ff2e", accentText: "#0b0d10" };

const settings: ThemeSettings = {
  mode: "light",
  visitorSwitch: false,
  light: LIGHT,
  dark: DARK,
  fonts: { heading: DISPLAY, body: "Inter" },
  headings: { weight: "bold", case: "upper" },
  buttons: { style: "filled", corners: "square" },
  corners: { cards: "none", fields: "small" },
  layout: { width: "wide", maxWidth: 1320, headerAlign: "left", headerBackground: "page" },
  productCards: { image: "portrait", style: "plain", align: "left" },
  elements: {
    h1: { typography: { text: { size: rem(6), lineHeight: lines(0.9), letterSpacing: em(-0.005) } }, at: { sm: { typography: { text: { size: rem(3.25) } } } } },
    h2: { typography: { text: { size: rem(3.5), lineHeight: lines(0.95) } }, at: { sm: { typography: { text: { size: rem(2.4) } } } } },
    h3: { typography: { text: { size: rem(1.6), lineHeight: lines(1.05) } } },
    p: { typography: { text: { size: rem(1.0625), lineHeight: lines(1.65) } } },
    button: { typography: { text: { weight: 700 } } },
  },
  sectionStyles: kineticStyles(),
  hover: { button: "arrow", duration: 220 },
} as unknown as ThemeSettings;

export const KINETIC: LaunchTheme = {
  key: "kinetic",
  version: 1,
  signature: true,
  title: "Kinetic",
  summary: "A sportswear brand on the move: bold italic capitals, a hero as wide as the screen and words that run.",
  description:
    "Made from scratch for sports and outdoor brands. Chalk-white pages, Barlow Condensed in bold italic capitals over Inter, a header that lies over a hero as wide as the screen, a band of words that runs across the page, women's and men's kit side by side as two tall pictures, square buttons with an arrow, pictures with a cut corner, outlined numerals, and a floodlit band to end on. Its demo store, Halden Athletic, sells running and training wear for women and men.",
  notes: null,
  content: "sports",
  listing: {
    kinds: ["fashion", "services"],
    styles: ["bold", "minimal"],
    highlights: {
      devices: { title: "Built for speed on every screen", text: "Kinetic's bold italic capitals, full-screen hero and square buttons on a computer and on a phone." },
      collage: { title: "Sections with momentum", text: "A hero as wide as the screen, words that run across the page, women's and men's kit side by side, and a floodlit band to end on." },
      closeup: { title: "A product page that gets to the point", text: "The picture with a cut corner beside the price and the button to add to the cart, kept in view." },
    },
  },
  snapshot: { v: DESIGN_SNAPSHOT_VERSION, theme: { base: "minimal", settings }, header, footer, productLayout, css: CSS },
  sections: KINETIC_SECTIONS,
  presets: [
    {
      key: "night-run",
      name: "Night run",
      changes: { mode: "dark" },
    },
    {
      key: "glacier",
      name: "Glacier",
      changes: {
        light: { background: "#f1f5f7", surface: "#e1eaef", text: "#0a1822", muted: "#475a68", border: "#c9d6de", accent: "#0b63a3", accentText: "#ffffff" },
        dark: { background: "#081219", surface: "#102029", text: "#e8f1f6", muted: "#93a8b6", border: "#1f3340", accent: "#5cc3ff", accentText: "#081219" },
      },
    },
  ],
};
