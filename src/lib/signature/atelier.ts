import type { PackPicture } from "../content-pack-pages";
import type { ContentPack } from "../content-packs";
import { DESIGN_SNAPSHOT_VERSION, type DesignLayout } from "../design-presets";
import type { LaunchTheme } from "../launch-themes";
import type { PackPictureOf } from "../pack-designs";
import { newPageContent, type PageContent, type PageRow } from "../page-content";
import type { ThemeSettings } from "../theme";
import { coreStyles, em, lines, rem } from "../theme-kit";

import { EYEBROW, button, heading, image, paragraph, phonesHidden, photo, product, productGrid, shot, site, text, uuid, type Look } from "./kit";

/**
 * Atelier, a signature theme (`docs/signature-themes.md` step 3): quiet luxury in the manner of a ceramics studio's lookbook, made from
 * scratch. Warm plaster pages with a paper grain, Cormorant Garamond's fine letters over Jost, espresso-dark buttons with small capitals, a
 * two-row header with the name set in the middle, lots of room, thin rules, roman numerals, a picture for every collection with its words
 * beneath it, and a product page that gives the piece the larger half. Its demo store, Ostra Studio, sells hand-thrown stoneware, drawn by
 * `scripts/theme-art/atelier.js` (`public/demo/themes/atelier/`). Data only; every word passes `findClaims()` (`signature-themes.test.ts`).
 */

const ART = "/demo/themes/atelier";
const art = (name: string, width: number, height: number, alt: string): PackPicture => ({ url: `${ART}/${name}.webp`, width, height, alt });

const SERIF = "Cormorant Garamond";

// ---------------------------------------------------------------------------------------------------------------------------------------
// The demo store: Ostra Studio
// ---------------------------------------------------------------------------------------------------------------------------------------

const PIECES = [
  ["tall-vase", "Tall vase, chalk", "A slender vase thrown in one pull and glazed in chalk white, with a little iron showing through at the rim.", 1290, "vases", 1600, "A tall slender vase in chalk white on a plinth"],
  ["moon-jar", "Moon jar", "A round jar made of two bowls joined at the middle, in warm white with a soft seam where they meet.", 1890, "vases", 2400, "A round moon jar in warm white on a plinth"],
  ["bud-vases", "Bud vases, set of three", "Three small vases for a single stem each, in sage, ochre and chalk.", 690, "vases", 900, "Three small bud vases in sage, ochre and chalk"],
  ["ridge-bowl", "Ridged bowl", "A bowl with ridges carved into its side while the clay was still soft, raw outside and glazed in cream within.", 590, "tableware", 700, "A clay bowl with carved ridges, cream inside"],
  ["serving-dish", "Shallow serving dish", "A wide, low dish in charcoal glaze with a pale rim, for bread, fruit or a slow lunch.", 890, "tableware", 1400, "A wide shallow dish in charcoal glaze with a pale rim"],
  ["cups", "Cups, pair", "Two handleless cups that sit warm in the hand, one in sage and one in chalk.", 490, "tableware", 600, "Two handleless cups in sage and chalk"],
  ["pitcher", "Pitcher", "A pitcher with a pulled spout and a strap handle, glazed in ochre.", 790, "objects", 1100, "An ochre pitcher with a spout and handle"],
  ["candle-holders", "Candle holders, pair", "Two low candle holders in charcoal glaze for dinner candles.", 450, "objects", 800, "Two low charcoal candle holders with cream candles"],
] as const;

/** What each piece's product photograph shows (D270). */
const PIECE_SHOTS: Record<(typeof PIECES)[number][0], string> = {
  "tall-vase": "a tall, slender stoneware vase in matte chalk-white glaze with a little iron speckle and a darker rim",
  "moon-jar": "a large round moon jar in warm white glaze with a soft horizontal seam at its middle and a small unglazed foot",
  "bud-vases": "three small stoneware bud vases in sage, ochre and chalk-white glazes, grouped close together",
  "ridge-bowl": "a stoneware bowl with vertical ridges carved into its raw terracotta outside, glazed cream inside, seen slightly from above",
  "serving-dish": "a wide, shallow stoneware serving dish in charcoal glaze with a pale rim, seen slightly from above",
  cups: "two handleless stoneware cups, one in sage glaze and one in chalk white, with unglazed feet",
  pitcher: "an ochre-glazed stoneware pitcher with a pulled spout and a strap handle",
  "candle-holders": "two low stoneware candle holders in charcoal glaze, each holding an unlit cream dinner candle",
};

export const ATELIER_PACK: ContentPack = {
  key: "ceramics",
  version: 1,
  title: "Ceramics studio",
  summary: "Hand-thrown stoneware for everyday rituals: the demo store made for the Atelier theme.",
  description:
    "Ostra Studio, a demo shop of stoneware vases and tableware, with three collections, its story and an about page. Replace the pieces, words and pictures with your own.",
  category: "retail",
  storeName: "Ostra Studio",
  headline: "Made slowly, for everyday rituals",
  tagline: "Stoneware vases and tableware, thrown by hand in small batches and glazed in quiet colours.",
  points: [
    { title: "Thrown by hand", text: "Every piece is shaped on the wheel and trimmed by hand, so no two are quite alike." },
    { title: "Fired twice", text: "A first firing makes the clay strong, and a second one melts the glaze into its surface." },
    { title: "Made to be used", text: "Glazed for the table and the kitchen, for mornings, long lunches and flowers from the garden." },
  ],
  storyTitle: "A studio by the water",
  story:
    "Ostra Studio began with one wheel in an old boathouse. We still make every piece there, a few dozen at a time, and mix our glazes in the colours of the shore outside.",
  about: [
    "Ostra Studio is a small ceramics workshop making vases, bowls and cups in stoneware. Each season we make a short collection and fire it in small batches.",
    "This is a demo store made for the Atelier theme. Its pieces, words and pictures are examples: replace them with your own.",
  ],
  categories: [
    { slug: "vases", name: "Vases" },
    { slug: "tableware", name: "Tableware" },
    { slug: "objects", name: "Objects" },
  ],
  products: PIECES.map(([handle, title, description, price, category, grams]) => ({
    handle,
    title,
    description,
    price,
    category,
    picture: `${title} in stoneware on a plinth against a plaster wall`,
    grams,
  })),
  look:
    "Shot by a professional still-life photographer for a ceramics studio's catalogue, on a medium-format digital camera with a 120 mm macro lens at f/8 and ISO 100 on a tripod. Soft daylight from a tall window at the left, a white bounce card at the right and gentle natural shadows. A warm off-white limewashed plaster wall and pale travertine surfaces; a muted, earthy palette of chalk white, sage, ochre, charcoal and terracotta; true-to-life colour with a subtle warm film grade and fine grain. Real glaze texture with iron speckles, drips and the small irregularities of hand-thrown work. A calm, minimal composition with generous space.",
  heroPicture: "Three stoneware vessels on a low plinth in window light against a plaster wall",
  storyPicture: "Shelves of drying pots in a ceramics studio",
  art: {
    hero: art("hero", 2560, 1440, "A tall vase, a moon jar and a dark bowl on a plinth in window light"),
    story: art("story", 1600, 1200, "Shelves of raw and glazed pots drying in the studio"),
    detail: art("detail", 2400, 1200, "A speckled cream glaze dripping over raw terracotta clay"),
    "tile:vases": art("tile-vases", 1200, 1500, "A tall vase, a moon jar and three bud vases"),
    "tile:tableware": art("tile-tableware", 1200, 1500, "A ridged bowl, a shallow dish and two cups"),
    "tile:objects": art("tile-objects", 1200, 1500, "A pitcher and two candle holders"),
    ...Object.fromEntries(PIECES.map(([handle, , , , , , alt]) => [`product:${handle}`, art(`piece-${handle}`, 1200, 1600, alt)])),
  },
  photos: {
    hero: shot(
      "landscape",
      "A tall white vase, a round moon jar and a low charcoal bowl on a travertine plinth in window light",
      "A wide still life for a website's opening picture: a tall slender stoneware vase in chalk-white glaze, a large round moon jar in warm white and a small low bowl in charcoal glaze stand together on a long, pale travertine plinth in the right half of the frame. The soft shadow of window bars falls diagonally across the plaster wall. The left half of the frame is calm, empty plaster wall with room for a headline.",
    ),
    story: shot(
      "landscape",
      "Oak shelves of drying pots in a small pottery studio, a potter's wheel in the foreground",
      "Inside a small pottery studio in an old wooden boathouse: plain oak shelves on a plaster wall lined with drying pots in raw terracotta, pale bisque and grey clay among a few glazed pieces, and a potter's wheel holding a damp clay cylinder softly out of focus in the foreground, in daylight from a window. No people.",
    ),
    detail: shot(
      "landscape",
      "A close-up of a speckled cream glaze dripping over raw terracotta clay",
      "An extreme macro close-up of a speckled cream glaze breaking over raw terracotta stoneware at the foot of a pot: thick glossy drips frozen at the edge, tiny pinholes and iron speckles, a shallow depth of field and even soft light. The texture fills the whole frame, with no background.",
    ),
    "tile:vases": shot(
      "portrait",
      "A tall vase, a moon jar and three bud vases on a travertine plinth",
      "A group on a pale travertine plinth: a tall chalk-white vase, a round moon jar in warm white and three small bud vases in sage, ochre and chalk glazes, with the soft diagonal shadow of a window on the plaster wall above.",
    ),
    "tile:tableware": shot(
      "portrait",
      "A ridged terracotta bowl, a charcoal serving dish and two cups on a travertine plinth",
      "Tableware on a pale travertine plinth: a bowl with carved vertical ridges in raw terracotta, glazed cream inside; a wide, shallow charcoal-glazed dish with a pale rim holding a chalk-white cup; and a sage handleless cup beside them.",
    ),
    "tile:objects": shot(
      "portrait",
      "An ochre pitcher and two charcoal candle holders on a travertine plinth",
      "An ochre-glazed pitcher with a pulled spout and a strap handle beside a pair of low charcoal-glazed candle holders holding unlit cream dinner candles, on a pale travertine plinth, with a window's soft shadow on the wall.",
    ),
    ...Object.fromEntries(
      PIECES.map(([handle, , , , , , alt]) => [
        `product:${handle}`,
        shot(
          "portrait",
          alt,
          `A product photograph for an online shop: ${PIECE_SHOTS[handle]}, standing alone in the middle of a small, pale travertine plinth against a warm off-white plaster wall, photographed straight on at the height of the piece, the whole piece in frame with even space around it.`,
        ),
      ]),
    ),
  },
  design: "atelier",
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// The demo store's pages
// ---------------------------------------------------------------------------------------------------------------------------------------

const eyebrow = (words: string) => text([words], "atelier-eyebrow", EYEBROW);
const LEAD: Look = { size: rem(1.15), lineHeight: lines(1.7) };
const square = { shape: "square" };
const COLLECTIONS: [slug: string, name: string, line: string][] = [
  ["vases", "Vases", "Tall forms, moon jars and vases for a single stem"],
  ["tableware", "Tableware", "Bowls, dishes and cups for every day"],
  ["objects", "Objects", "Pitchers and candle holders for the table"],
];

/** Ostra Studio's home page: the still life, a statement, the collection, three collections, a glaze band, the making, the studio, a last call. */
export function atelierHomePage(pack: ContentPack, picture: PackPictureOf): PageContent {
  const hero = {
    id: uuid(),
    type: "row",
    layout: "1",
    width: "full",
    height: 86,
    align: "middle",
    sectionStyle: "hero",
    className: "atelier-hero",
    background: photo(picture("hero"), 0, "#f4efe7"),
    columns: [
      {
        id: uuid(),
        className: "atelier-hero-copy",
        blocks: [
          eyebrow("Stoneware, thrown by hand"),
          heading("Made slowly, for <em>everyday</em> rituals", 1),
          text([pack.tagline], "atelier-lead", LEAD),
          {
            id: uuid(),
            type: "dualButton",
            first: { label: "Shop the collection", href: "/products", variant: "filled" },
            second: { label: "Visit the studio", href: "#studio", variant: "outline" },
            size: "lg",
            ...square,
            gap: 12,
          },
        ],
      },
    ],
  };
  const statement = {
    id: uuid(),
    type: "row",
    layout: "1",
    sectionStyle: "plain",
    contentMax: 920,
    className: "atelier-statement",
    columns: [
      {
        id: uuid(),
        blocks: [
          text(
            ["We make a small number of pieces each season, in stoneware and in glazes we mix ourselves. They are made to be handled, used and kept."],
            "atelier-statement-text",
            { family: SERIF, size: rem(2), lineHeight: lines(1.35), align: "center", weight: 400 },
          ),
        ],
      },
    ],
  };
  const collection = {
    id: uuid(),
    type: "row",
    layout: "1",
    sectionStyle: "plain",
    htmlId: "collection",
    className: "atelier-section",
    style: { padding: { top: 24, right: 20, bottom: 96, left: 20 } },
    at: { sm: { style: { padding: { top: 8, right: 18, bottom: 64, left: 18 } } } },
    columns: [
      {
        id: uuid(),
        typography: { text: { align: "center" } },
        blocks: [
          eyebrow("The collection"),
          heading("Pieces for the table and the shelf", 2),
          productGrid(6, { columns: { mobile: 2, tablet: 2, desktop: 3 }, gap: 40 }),
          button("View all pieces", "/products", "outline", { ...square, align: "center", className: "atelier-more" }),
        ],
      },
    ],
  };
  const tile = ([slug, name, line]: [string, string, string]) => ({
    id: uuid(),
    className: "atelier-tile",
    link: { href: `/category/${slug}`, label: name },
    blocks: [image(picture(`tile:${slug}`), "atelier-tile-image"), heading(name, 3, "atelier-tile-name"), text([line], "atelier-tile-line")],
  });
  const collections = {
    id: uuid(),
    type: "row",
    layout: "3",
    sectionStyle: "plain",
    className: "atelier-section atelier-collections",
    style: { padding: { top: 0, right: 20, bottom: 112, left: 20 } },
    at: { sm: { style: { padding: { top: 0, right: 18, bottom: 64, left: 18 } } } },
    columns: COLLECTIONS.map(tile),
  };
  const band = {
    id: uuid(),
    type: "row",
    layout: "1",
    width: "full",
    height: 64,
    align: "middle",
    className: "atelier-band",
    background: photo(picture("detail"), 38, "#1f1c18"),
    columns: [
      {
        id: uuid(),
        typography: { text: { align: "center", color: "#f4efe7" } },
        blocks: [
          text(["From the studio"], "atelier-band-eyebrow", { ...EYEBROW, color: "#f4efe7" }),
          heading("The glaze decides the last part.", 2, "atelier-band-quote", { family: SERIF, style: "italic", weight: 300, size: rem(3.25), color: "#f4efe7" }),
        ],
      },
    ],
  };
  const numerals = ["I", "II", "III"];
  const making = {
    id: uuid(),
    type: "row",
    layout: "3",
    sectionStyle: "feature",
    className: "atelier-section atelier-steps",
    columns: pack.points.map((point, i) => ({
      id: uuid(),
      className: "atelier-step",
      blocks: [
        text([numerals[i] ?? String(i + 1)], "atelier-numeral", { family: SERIF, style: "italic", weight: 300, size: rem(3.25), lineHeight: lines(1) }),
        heading(point.title, 3),
        text([point.text]),
      ],
    })),
  };
  const story = {
    id: uuid(),
    type: "row",
    layout: "2",
    sectionStyle: "plain",
    htmlId: "studio",
    align: "middle",
    className: "atelier-section atelier-story",
    columns: [
      { id: uuid(), width: 56, blocks: [image(picture("story"), "atelier-framed")] },
      {
        id: uuid(),
        width: 44,
        className: "atelier-story-copy",
        blocks: [eyebrow("The studio"), heading(pack.storyTitle, 2), text([pack.story]), button(`About ${pack.storeName}`, "/about", "text")],
      },
    ],
  };
  const last = {
    id: uuid(),
    type: "row",
    layout: "1",
    sectionStyle: "muted",
    className: "atelier-finale",
    columns: [
      {
        id: uuid(),
        typography: { text: { align: "center" } },
        blocks: [
          heading("Pieces for slow mornings", 2),
          text(["Eight pieces in three collections, made in small batches."], "atelier-lead", LEAD),
          button("Shop the collection", "/products", "filled", { ...square, align: "center", size: "lg" }),
        ],
      },
    ],
  };
  return { ...newPageContent(), title: "Home", slug: "welcome", rows: [hero, statement, collection, collections, band, making, story, last] as unknown as PageRow[] };
}

/** Ostra Studio's about page: who they are over the glaze, then their words beside the studio's shelves. */
export function atelierAboutPage(pack: ContentPack, picture: PackPictureOf): PageContent {
  const rows = [
    {
      id: uuid(),
      type: "row",
      layout: "1",
      width: "full",
      height: 52,
      align: "middle",
      className: "atelier-band",
      background: photo(picture("detail"), 42, "#1f1c18"),
      columns: [
        {
          id: uuid(),
          typography: { text: { align: "center", color: "#f4efe7" } },
          blocks: [text(["About us"], "atelier-band-eyebrow", { ...EYEBROW, color: "#f4efe7" }), heading(`About ${pack.storeName}`, 1, undefined, { color: "#f4efe7" })],
        },
      ],
    },
    {
      id: uuid(),
      type: "row",
      layout: "2",
      align: "middle",
      sectionStyle: "plain",
      className: "atelier-section atelier-story",
      columns: [
        { id: uuid(), width: 44, className: "atelier-story-copy", blocks: [heading(pack.storyTitle, 2), text(pack.about), button("Shop the collection", "/products", "filled", square)] },
        { id: uuid(), width: 56, blocks: [image(picture("story"), "atelier-framed")] },
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
  menus: { "atelier-header-menu": "header" },
  rows: [
    {
      id: "atelier-header-row",
      type: "row",
      width: "full",
      contentWidth: "content",
      layout: "3",
      stack: false,
      align: "middle",
      className: "atelier-header",
      style: { padding: { top: 26, right: 28, bottom: 10, left: 28 } },
      at: { sm: { gap: 6, style: { padding: { top: 14, right: 12, bottom: 14, left: 12 } } } },
      // On a phone the logo's column takes half the row, so the name is never cut short between the icons.
      columns: [
        {
          id: "atelier-header-start",
          inline: true,
          at: { sm: { width: 26 } },
          blocks: [site("atelier-header-menu-button", "menuButton"), site("atelier-header-search", "search")],
        },
        { id: "atelier-header-brand", inline: true, justify: "center", at: { sm: { width: 48 } }, blocks: [site("atelier-header-logo", "logo", { className: "atelier-logo" })] },
        {
          id: "atelier-header-tools",
          inline: true,
          justify: "end",
          at: { sm: { width: 26 } },
          blocks: [site("atelier-header-account", "account", phonesHidden), site("atelier-header-wishlist", "wishlist"), site("atelier-header-cart", "cart")],
        },
      ],
    },
    {
      id: "atelier-header-nav-row",
      type: "row",
      width: "full",
      contentWidth: "content",
      layout: "1",
      className: "atelier-nav-row",
      style: { padding: { top: 4, right: 28, bottom: 16, left: 28 } },
      ...phonesHidden,
      columns: [
        {
          id: "atelier-header-nav",
          blocks: [
            {
              id: "atelier-header-menu",
              type: "menu",
              align: "center",
              className: "atelier-nav",
              itemHover: { kind: "line", edge: "below", travel: "grow", thickness: 1, active: true },
            },
          ],
        },
      ],
    },
  ] as unknown as PageRow[],
};

const footer: DesignLayout = {
  css: "",
  menus: { "atelier-footer-menu": "footer" },
  rows: [
    {
      id: "atelier-footer-statement",
      type: "row",
      width: "full",
      contentWidth: "content",
      layout: "1",
      className: "atelier-footer-top",
      style: { padding: { top: 96, right: 28, bottom: 48, left: 28 } },
      at: { sm: { style: { padding: { top: 64, right: 18, bottom: 32, left: 18 } } } },
      columns: [
        {
          id: "atelier-footer-statement-column",
          blocks: [
            {
              id: "atelier-footer-line",
              type: "richText",
              className: "atelier-footer-line",
              doc: { type: "doc", content: [paragraph("Until next time.")] },
              typography: { text: { family: SERIF, size: rem(2.75), weight: 300, lineHeight: lines(1.15), align: "center" } },
              at: { sm: { typography: { text: { size: rem(1.9) } } } },
            },
          ],
        },
      ],
    },
    {
      id: "atelier-footer-row",
      type: "row",
      width: "full",
      contentWidth: "content",
      layout: "4",
      className: "atelier-footer",
      style: { padding: { top: 48, right: 28, bottom: 56, left: 28 } },
      columns: [
        { id: "atelier-footer-brand", blocks: [site("atelier-footer-logo", "logo", { className: "atelier-logo" })] },
        { id: "atelier-footer-links", blocks: [{ id: "atelier-footer-menu", type: "menu", direction: "column" }] },
        {
          id: "atelier-footer-help",
          blocks: [
            site("atelier-footer-cookies", "cookies"),
            site("atelier-footer-withdrawal", "withdrawal"),
            site("atelier-footer-markets", "markets", { display: "list", direction: "column" }),
          ],
        },
        { id: "atelier-footer-company", blocks: [site("atelier-footer-business", "business")] },
      ],
    },
  ] as unknown as PageRow[],
};

const productLayout: DesignLayout = {
  css: "",
  menus: {},
  rows: [
    {
      id: "atelier-product-row",
      type: "row",
      layout: "2",
      className: "atelier-product",
      style: { padding: { top: 32, right: 20, bottom: 72, left: 20 } },
      columns: [
        { id: "atelier-product-media", width: 58, className: "atelier-gallery", blocks: [product("atelier-product-back", "back"), product("atelier-product-gallery", "gallery")] },
        {
          id: "atelier-product-details",
          width: 42,
          className: "atelier-buybox",
          blocks: [
            product("atelier-product-title", "title"),
            product("atelier-product-price", "price"),
            product("atelier-product-campaigns", "campaigns"),
            product("atelier-product-notice", "notice"),
            product("atelier-product-host", "host"),
            product("atelier-product-buy", "buy"),
            product("atelier-product-withdrawal", "withdrawal"),
            product("atelier-product-description", "description"),
            product("atelier-product-fields", "fields"),
            product("atelier-product-safety", "safety"),
          ],
        },
      ],
    },
    {
      id: "atelier-related-row",
      type: "row",
      layout: "1",
      className: "atelier-section atelier-related",
      style: { padding: { top: 64, right: 20, bottom: 96, left: 20 } },
      columns: [
        {
          id: "atelier-related",
          blocks: [product("atelier-product-related", "related", { heading: "You may also like", limit: 3, columns: 3, at: { sm: { columns: 2 } } })],
        },
      ],
    },
  ] as unknown as PageRow[],
};

/**
 * Atelier's stylesheet: the plaster grain behind every page, the two-row header with the name in the middle, small capitals
 * for the menu and the buttons, thin rules, the collection's tiles that lift their picture, the roman numerals in clay, framed pictures, and
 * a product page whose buy box stays in view. Written for the site's own classes and Atelier's own (`atelier-…`); every motion stops for
 * reduced motion.
 */
const CSS = `
:root, :scope[data-site-css] { --atelier-rule: color-mix(in srgb, var(--foreground) 14%, transparent); --atelier-clay: #a0583a; }
body::before, :scope[data-site-css]::before { content: ""; position: fixed; inset: 0; pointer-events: none; z-index: -1; background: url(/demo/themes/atelier/paper.webp) 0 0 / 512px repeat; opacity: .6; }

h1, h2 { text-wrap: balance; }
h1 em, h2 em { font-style: italic; font-weight: 300; }
.atelier-eyebrow.atelier-eyebrow .rich-text p { color: var(--muted); margin: 0 0 1.2rem; }
.atelier-lead.atelier-lead .rich-text p { color: var(--muted); max-width: 32rem; }
.atelier-finale .atelier-lead.atelier-lead .rich-text p { margin-inline: auto; }

.button-primary, .kz-btn { text-transform: uppercase; letter-spacing: .18em; font-size: .74rem; }
.atelier-more { margin-top: 3rem; }

.atelier-header { border-bottom: 0; }
.atelier-logo a > span { font-family: var(--site-heading-font, serif); font-size: 1.9rem; font-weight: 400; letter-spacing: .04em; }
@media (max-width: 767px) { .atelier-logo a > span { font-size: 1.45rem; letter-spacing: .02em; } }
.atelier-nav-row { border-bottom: 1px solid var(--atelier-rule); }
.atelier-nav a { font-size: .72rem; letter-spacing: .22em; text-transform: uppercase; }

/* The still life is always light, so the hero keeps the light palette's ink in every preset and mode (Noir's too). */
.atelier-hero { --background: #f4efe7; --surface: #ebe5db; --foreground: #1f1c18; --muted: #6b635a; --border: #ddd5c9; --accent: #2b2622; --accent-foreground: #f4efe7; color: var(--foreground); }
.atelier-hero-copy { max-width: 36rem; }
@media (max-width: 767px) { .atelier-hero-copy { background: color-mix(in srgb, var(--background) 82%, transparent); padding: 1.5rem; } }
.atelier-statement { text-align: center; }

.product-card { background: transparent; }
.product-card-image { background: var(--surface); }
.product-card h3 { font-family: var(--site-heading-font, serif); font-size: 1.35rem; font-weight: 400; letter-spacing: 0; }

.atelier-tile { display: flex; flex-direction: column; gap: .5rem; }
.atelier-tile-image { overflow: hidden; }
.atelier-tile-image img { aspect-ratio: 4 / 5; object-fit: cover; transition: transform 1.4s cubic-bezier(.2,.7,.2,1); }
.atelier-tile:hover .atelier-tile-image img { transform: scale(1.04); }
.atelier-tile-name { margin-top: 1rem; }
.atelier-tile-line.atelier-tile-line .rich-text p { color: var(--muted); margin: 0; }
.atelier-collections { gap: 32px; }

.atelier-numeral.atelier-numeral .rich-text p { color: var(--atelier-clay); margin: 0 0 1rem; }
.atelier-step { padding-top: 1.6rem; border-top: 1px solid var(--atelier-rule); }
.atelier-band-eyebrow.atelier-band-eyebrow .rich-text p { margin: 0 0 1.2rem; opacity: .85; }
.atelier-framed img { box-shadow: 0 30px 60px -40px rgba(31,28,24,.45); }
.atelier-story-copy { padding-inline: clamp(0px, 3vw, 48px); }

.atelier-footer-top { border-top: 1px solid var(--atelier-rule); }
.atelier-footer { border-top: 1px solid var(--atelier-rule); }

.atelier-gallery .product-gallery, .atelier-gallery img { background: var(--surface); }
@media (min-width: 1024px) { .atelier-buybox { position: sticky; top: 140px; align-self: start; padding-left: 24px; } }
.atelier-buybox h1 { font-weight: 300; }

@media (prefers-reduced-motion: reduce) {
  .atelier-tile-image img { transition: none; }
  .atelier-tile:hover .atelier-tile-image img { transform: none; }
}
`.trim();

/** The core section styles at Atelier's scale: a large, light hero heading that keeps to the screen on phones, and generous room. */
function atelierStyles() {
  const styles = coreStyles({ heroSize: 5.25, band: "#2b2622", bandText: "#f4efe7", space: 96, quoteFamily: SERIF });
  return {
    ...styles,
    hero: {
      ...styles.hero,
      h1: { typography: { text: { size: rem(5.25), lineHeight: lines(1.02), weight: 300 } }, at: { md: { typography: { text: { size: rem(4) } } }, sm: { typography: { text: { size: rem(2.75) } } } } },
    },
    plain: { row: { style: { padding: { top: 96, right: 20, bottom: 96, left: 20 } }, at: { sm: { style: { padding: { top: 64, right: 18, bottom: 64, left: 18 } } } } } },
    muted: { ...styles.muted, row: { ...styles.muted.row, style: { padding: { top: 112, right: 20, bottom: 112, left: 20 } } } },
  };
}

const LIGHT = { background: "#f4efe7", surface: "#ebe5db", text: "#1f1c18", muted: "#6b635a", border: "#ddd5c9", accent: "#2b2622", accentText: "#f4efe7" };
const DARK = { background: "#1c1916", surface: "#26221e", text: "#efe8dd", muted: "#b3a99b", border: "#3a342e", accent: "#efe8dd", accentText: "#1c1916" };

const settings: ThemeSettings = {
  mode: "light",
  visitorSwitch: false,
  light: LIGHT,
  dark: DARK,
  fonts: { heading: SERIF, body: "Jost" },
  headings: { weight: "normal", case: "normal" },
  buttons: { style: "filled", corners: "square" },
  corners: { cards: "none", fields: "none" },
  layout: { width: "wide", maxWidth: 1280, headerAlign: "center", headerBackground: "page" },
  productCards: { image: "portrait", style: "plain", align: "left" },
  elements: {
    h1: { typography: { text: { size: rem(4.5), lineHeight: lines(1.04), weight: 300, letterSpacing: em(-0.01) } }, at: { sm: { typography: { text: { size: rem(2.6) } } } } },
    h2: { typography: { text: { size: rem(3), lineHeight: lines(1.1), weight: 300 } }, at: { sm: { typography: { text: { size: rem(2.1) } } } } },
    h3: { typography: { text: { size: rem(1.5), lineHeight: lines(1.25), weight: 400 } } },
    p: { typography: { text: { size: rem(1.0625), lineHeight: lines(1.75), weight: 300 } } },
    button: { typography: { text: { weight: 500 } } },
  },
  sectionStyles: atelierStyles(),
  hover: { button: "darken", duration: 400 },
} as unknown as ThemeSettings;

export const ATELIER: LaunchTheme = {
  key: "atelier",
  version: 1,
  signature: true,
  title: "Atelier",
  summary: "Quiet luxury for makers: warm plaster, fine serif letters and room to breathe.",
  description:
    "Made from scratch for studios and makers with a sense of craft. Warm plaster pages with a fine paper grain, Cormorant Garamond's fine letters over Jost, a two-row header with your name in the middle, small capitals and thin rules, collections shown as pictures with their words beneath, roman numerals for how things are made, and a product page that gives the piece the larger half. Its demo store, Ostra Studio, sells hand-thrown stoneware.",
  notes: null,
  listing: {
    kinds: ["home", "crafts", "fashion"],
    styles: ["minimal", "classic", "artistic"],
    pack: "ceramics",
    highlights: {
      devices: { title: "A lookbook for your shop", text: "Atelier's plaster pages, fine serif letters and quiet buttons on a computer and on a phone." },
      collage: { title: "Room for every piece", text: "A still life to open with, a statement, collections as pictures with their words beneath, and the story beside the studio." },
      closeup: { title: "The piece comes first", text: "The larger half for the picture, with the price and the button to add to the cart kept in view beside it." },
    },
  },
  snapshot: { v: DESIGN_SNAPSHOT_VERSION, theme: { base: "minimal", settings }, header, footer, productLayout, css: CSS },
  presets: [
    {
      key: "linen",
      name: "Linen",
      pack: "home",
      changes: {
        light: { background: "#eef0ea", surface: "#e2e6dc", text: "#1d231c", muted: "#5d665a", border: "#d2d8cb", accent: "#37452f", accentText: "#f2f4ee" },
      },
    },
    {
      key: "noir",
      name: "Noir",
      pack: "fashion",
      changes: {
        mode: "dark",
        dark: { background: "#141210", surface: "#1e1b18", text: "#f1ebe1", muted: "#b0a698", border: "#35302a", accent: "#d9b98c", accentText: "#17130e" },
      },
    },
  ],
};
