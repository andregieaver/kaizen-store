import type { PackPicture } from "../content-pack-pages";
import type { ContentPack } from "../content-packs";
import { DESIGN_SNAPSHOT_VERSION, type DesignLayout } from "../design-presets";
import type { LaunchTheme } from "../launch-themes";
import type { PackPictureOf } from "../pack-designs";
import { newPageContent, type PageContent, type PageRow } from "../page-content";
import type { ThemeSettings } from "../theme";
import { coreStyles, em, lines, rem } from "../theme-kit";

import { button, heading, image, paragraph, phonesHidden, photo, product, productGrid, site, text, uuid, type Look } from "./kit";

/**
 * Arcade, a signature theme (`docs/signature-themes.md` step 3): an arcade at night, made from scratch. Near-black violet pages with faint
 * scanlines, headings in Tilt Neon that glow like bent glass, small labels in a pixel face (Silkscreen) with a blinking cursor, hot pink for
 * the button that matters and cyan for what answers the pointer, cards like lit screens, and levels for how things are made. Its demo store,
 * Neon Alley, sells LED neon signs, drawn by `scripts/theme-art/arcade.js` (`public/demo/themes/arcade/`). Data only; every word passes
 * `findClaims()` (`signature-themes.test.ts`).
 */

const ART = "/demo/themes/arcade";
const art = (name: string, width: number, height: number, alt: string): PackPicture => ({ url: `${ART}/${name}.webp`, width, height, alt });

const PIXEL = "Silkscreen";
const NEON = "Tilt Neon";

// ---------------------------------------------------------------------------------------------------------------------------------------
// The demo store: Neon Alley
// ---------------------------------------------------------------------------------------------------------------------------------------

const SIGNS = [
  ["lightning", "Lightning bolt", "A jagged bolt in electric yellow that lights a corner like a storm on its way.", 1490, "night", "A yellow neon lightning bolt sign on a clear acrylic backer, mounted on a dark brick wall"],
  ["crescent", "Crescent moon", "A thin crescent in cool cyan for a bedroom, a hallway or a quiet bar.", 1590, "night", "A cyan neon crescent moon sign on a clear acrylic backer, mounted on a dark brick wall"],
  ["palm", "Palm tree", "A palm with lime fronds and an orange trunk, for a little summer all year.", 1890, "night", "A neon palm tree sign with lime fronds and an orange trunk, mounted on a dark brick wall"],
  ["heart", "Heart", "A full heart in hot pink, bent as one continuous line.", 1290, "love", "A pink neon heart sign mounted on a dark brick wall"],
  ["star", "Shooting star", "A yellow star with a pink trail streaking behind it.", 1690, "love", "A yellow neon star sign with three pink trails behind it, mounted on a dark brick wall"],
  ["joystick", "Joystick", "An arcade joystick with two buttons, in cyan and pink, for a games room or a desk.", 1990, "retro", "A neon arcade joystick sign: a pink ball on a cyan stick above a cyan base with two pink buttons"],
  ["cassette", "Cassette", "A cassette tape with both reels, in violet and pink, for the music corner.", 1790, "retro", "A neon cassette tape sign: a violet outline with a pink window and two pink reels"],
  ["cherries", "Cherries", "Two cherries on their stems with a leaf, straight from the fruit machine.", 1390, "retro", "A neon sign of two pink cherries on lime stems with a lime leaf, mounted on a dark brick wall"],
] as const;

export const ARCADE_PACK: ContentPack = {
  key: "neon",
  version: 1,
  title: "Neon sign workshop",
  summary: "Handmade LED neon signs: the demo store made for the Arcade theme.",
  description:
    "Neon Alley, a demo shop of neon signs for walls, rooms and counters, with three collections, its story and an about page. Replace the signs, words and pictures with your own.",
  category: "retail",
  storeName: "Neon Alley",
  headline: "Light up your walls",
  tagline: "LED neon signs bent by hand in our workshop, in shapes from the arcade, the night city and the heart.",
  points: [
    { title: "Drawn as one line", text: "Every sign starts as a single continuous line, so it reads clearly from across the room." },
    { title: "Bent by hand", text: "We shape each flexible tube by hand and fix it to a clear acrylic back cut to its outline." },
    { title: "Plug in and play", text: "Each sign comes with its wall fixings, a dimmer and a long cable." },
  ],
  storyTitle: "Made after dark",
  story:
    "Neon Alley started in a garage with a roll of LED tube and a soft spot for old arcades. We still draw, bend and test every sign there, one at a time, with the lights off.",
  about: [
    "Neon Alley is a small workshop making LED neon signs. We draw every shape ourselves and bend it by hand, from arcade icons to moons, palms and hearts.",
    "This is a demo store made for the Arcade theme. Its signs, words and pictures are examples: replace them with your own.",
  ],
  categories: [
    { slug: "retro", name: "Retro" },
    { slug: "night", name: "Night city" },
    { slug: "love", name: "Hearts and stars" },
  ],
  products: SIGNS.map(([handle, title, description, price, category]) => ({
    handle,
    title,
    description,
    price,
    category,
    picture: `A ${title.toLowerCase()} neon sign glowing on a dark brick wall`,
    grams: 2600,
  })),
  look: "Glowing neon signs on dark brick walls at night, synthwave grids and setting suns in hot pink, cyan, violet and yellow.",
  heroPicture: "A synthwave night with a grid floor, a striped setting sun and a city skyline",
  storyPicture: "Glowing neon tubes on a dark workbench",
  art: {
    hero: art("hero", 2560, 1440, "A synthwave night: a striped sun setting behind a city skyline, wireframe mountains and a glowing pink grid floor under a starry sky"),
    story: art("story", 1600, 1200, "A dark workbench at night with neon tubes being made: a cyan wave in a clamp stand, a pink heart half bent and blue gas jets on a burner"),
    wall: art("wall", 2400, 1200, "A dark brick wall at night with a pink neon heart, a small yellow lightning bolt and a cyan crescent moon"),
    "tile:retro": art("tile-retro", 1200, 900, "Three neon signs on a dark brick wall: a joystick, a cassette tape and cherries"),
    "tile:night": art("tile-night", 1200, 900, "Three neon signs on a dark brick wall: a palm tree, a crescent moon and a lightning bolt"),
    "tile:love": art("tile-love", 1200, 900, "Two neon signs on a dark brick wall: a pink heart and a yellow shooting star with pink trails"),
    ...Object.fromEntries(SIGNS.map(([handle, , , , , alt]) => [`product:${handle}`, art(`sign-${handle}`, 1200, 1200, alt)])),
  },
  design: "arcade",
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// The demo store's pages
// ---------------------------------------------------------------------------------------------------------------------------------------

/** A small label in the pixel face, in cyan with a blinking cursor (the stylesheet's). */
const PIXEL_LOOK: Look = { family: PIXEL, size: rem(0.8), lineHeight: lines(1.4), letterSpacing: em(0.08), transform: "uppercase" };
const label = (words: string, extra = "") => text([words], `arcade-pixel${extra ? ` ${extra}` : ""}`, PIXEL_LOOK);
const LEAD: Look = { size: rem(1.15), lineHeight: lines(1.6) };
const rounded = { shape: "rounded" };
const COLLECTIONS: [slug: string, name: string, line: string][] = [
  ["retro", "Retro", "Joysticks, tapes and fruit-machine cherries"],
  ["night", "Night city", "Palms, moons and a bolt of lightning"],
  ["love", "Hearts and stars", "A heart and a star with a trail"],
];

/** Neon Alley's home page: the synthwave hero, new signs, three collections, the levels, the workshop and a wall of signs to end on. */
export function arcadeHomePage(pack: ContentPack, picture: PackPictureOf): PageContent {
  const hero = {
    id: uuid(),
    type: "row",
    layout: "1",
    width: "full",
    height: 92,
    align: "middle",
    sectionStyle: "hero",
    className: "arcade-hero",
    background: photo(picture("hero"), 12, "#0b0710"),
    columns: [
      {
        id: uuid(),
        className: "arcade-hero-copy",
        blocks: [
          label("Press start"),
          heading(pack.headline, 1, "arcade-glow"),
          text([pack.tagline], "arcade-lead", LEAD),
          {
            id: uuid(),
            type: "dualButton",
            first: { label: "Shop the signs", href: "/products", variant: "filled" },
            second: { label: "How they are made", href: "#workshop", variant: "outline" },
            size: "lg",
            ...rounded,
            gap: 14,
          },
        ],
      },
    ],
  };
  const fresh = {
    id: uuid(),
    type: "row",
    layout: "1",
    sectionStyle: "plain",
    className: "arcade-section",
    columns: [
      {
        id: uuid(),
        blocks: [
          label("New in the workshop"),
          heading("Fresh off the bench", 2, "arcade-glow arcade-cyan"),
          productGrid(4, { gap: 24 }),
          button("See all eight signs", "/products", "outline", { ...rounded, align: "center", className: "arcade-more" }),
        ],
      },
    ],
  };
  const tile = ([slug, name, line]: [string, string, string]) => ({
    id: uuid(),
    className: "arcade-tile",
    link: { href: `/category/${slug}`, label: name },
    blocks: [image(picture(`tile:${slug}`), "arcade-tile-image"), heading(name, 3, "arcade-tile-name"), text([line], "arcade-tile-line")],
  });
  const collections = {
    id: uuid(),
    type: "row",
    layout: "3",
    sectionStyle: "plain",
    className: "arcade-section arcade-collections",
    style: { padding: { top: 0, right: 20, bottom: 88, left: 20 } },
    at: { sm: { style: { padding: { top: 0, right: 18, bottom: 56, left: 18 } } } },
    columns: COLLECTIONS.map(tile),
  };
  const levels = {
    id: uuid(),
    type: "row",
    layout: "3",
    sectionStyle: "feature",
    className: "arcade-section arcade-levels",
    columns: pack.points.map((point, i) => ({
      id: uuid(),
      className: "arcade-level",
      blocks: [label(`Level ${i + 1}`, "arcade-level-label"), heading(point.title, 3), text([point.text])],
    })),
  };
  const story = {
    id: uuid(),
    type: "row",
    layout: "2",
    sectionStyle: "plain",
    htmlId: "workshop",
    align: "middle",
    className: "arcade-section arcade-story",
    columns: [
      { id: uuid(), blocks: [label("The workshop"), heading(pack.storyTitle, 2, "arcade-glow"), text([pack.story]), button(`About ${pack.storeName}`, "/about", "outline", rounded)] },
      { id: uuid(), blocks: [image(picture("story"), "arcade-screen")] },
    ],
  };
  const last = {
    id: uuid(),
    type: "row",
    layout: "1",
    width: "full",
    height: 70,
    align: "middle",
    sectionStyle: "contrast",
    className: "arcade-finale",
    background: photo(picture("wall"), 40, "#0b0710"),
    columns: [
      {
        id: uuid(),
        typography: { text: { align: "center" } },
        blocks: [
          label("Game on"),
          heading("Keep the lights on", 2, "arcade-glow", { family: NEON, size: rem(4) }),
          text(["Eight signs in three collections, each one bent by hand."], "arcade-lead", LEAD),
          button("Browse all signs", "/products", "filled", { ...rounded, align: "center", size: "lg" }),
        ],
      },
    ],
  };
  return { ...newPageContent(), title: "Home", slug: "welcome", rows: [hero, fresh, collections, levels, story, last] as unknown as PageRow[] };
}

/** Neon Alley's about page: who they are over the wall of signs, then their words beside the workbench. */
export function arcadeAboutPage(pack: ContentPack, picture: PackPictureOf): PageContent {
  const rows = [
    {
      id: uuid(),
      type: "row",
      layout: "1",
      width: "full",
      height: 56,
      align: "middle",
      sectionStyle: "hero",
      className: "arcade-hero",
      background: photo(picture("wall"), 45, "#0b0710"),
      columns: [{ id: uuid(), className: "arcade-hero-copy", blocks: [label("About us"), heading(`About ${pack.storeName}`, 1, "arcade-glow")] }],
    },
    {
      id: uuid(),
      type: "row",
      layout: "2",
      align: "middle",
      sectionStyle: "plain",
      className: "arcade-section arcade-story",
      columns: [
        { id: uuid(), blocks: [heading(pack.storyTitle, 2, "arcade-glow"), text(pack.about), button("Shop the signs", "/products", "filled", rounded)] },
        { id: uuid(), blocks: [image(picture("story"), "arcade-screen")] },
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
  menus: { "arcade-header-menu": "header" },
  rows: [
    {
      id: "arcade-header-row",
      type: "row",
      width: "full",
      contentWidth: "content",
      layout: "fit-sides",
      stack: false,
      align: "middle",
      className: "arcade-header",
      style: { padding: { top: 16, right: 28, bottom: 16, left: 28 } },
      at: { sm: { gap: 8, style: { padding: { top: 12, right: 16, bottom: 12, left: 16 } } } },
      columns: [
        { id: "arcade-header-brand", inline: true, blocks: [site("arcade-header-menu-button", "menuButton"), site("arcade-header-logo", "logo", { className: "arcade-logo" })] },
        {
          id: "arcade-header-nav",
          blocks: [
            {
              id: "arcade-header-menu",
              type: "menu",
              align: "center",
              className: "arcade-nav",
              itemHover: { kind: "line", edge: "below", travel: "slide", thickness: 2, color: "#22e4ff", active: true },
              ...phonesHidden,
            },
          ],
        },
        {
          id: "arcade-header-tools",
          inline: true,
          justify: "end",
          blocks: [
            site("arcade-header-search", "search"),
            site("arcade-header-account", "account", phonesHidden),
            site("arcade-header-wishlist", "wishlist"),
            site("arcade-header-cart", "cart"),
          ],
        },
      ],
    },
  ] as unknown as PageRow[],
};

const footer: DesignLayout = {
  css: "",
  menus: { "arcade-footer-menu": "footer" },
  rows: [
    {
      id: "arcade-footer-row",
      type: "row",
      width: "full",
      contentWidth: "content",
      layout: "4",
      className: "arcade-footer",
      style: { padding: { top: 88, right: 28, bottom: 56, left: 28 } },
      columns: [
        {
          id: "arcade-footer-brand",
          blocks: [
            site("arcade-footer-logo", "logo", { className: "arcade-logo" }),
            {
              id: "arcade-footer-line",
              type: "richText",
              className: "arcade-footer-line arcade-glow",
              doc: { type: "doc", content: [paragraph("Keep the lights on.")] },
              typography: { text: { family: NEON, size: rem(1.9), lineHeight: lines(1.2) } },
            },
            {
              id: "arcade-footer-label",
              type: "richText",
              className: "arcade-pixel",
              doc: { type: "doc", content: [paragraph("Game over? Never.")] },
              typography: { text: PIXEL_LOOK },
            },
          ],
        },
        { id: "arcade-footer-links", blocks: [{ id: "arcade-footer-menu", type: "menu", direction: "column" }] },
        {
          id: "arcade-footer-help",
          blocks: [site("arcade-footer-cookies", "cookies"), site("arcade-footer-withdrawal", "withdrawal"), site("arcade-footer-markets", "markets", { display: "list", direction: "column" })],
        },
        { id: "arcade-footer-company", blocks: [site("arcade-footer-business", "business")] },
      ],
    },
  ] as unknown as PageRow[],
};

const productLayout: DesignLayout = {
  css: "",
  menus: {},
  rows: [
    {
      id: "arcade-product-row",
      type: "row",
      layout: "2",
      className: "arcade-product",
      style: { padding: { top: 32, right: 20, bottom: 64, left: 20 } },
      columns: [
        { id: "arcade-product-media", className: "arcade-gallery", blocks: [product("arcade-product-back", "back"), product("arcade-product-gallery", "gallery")] },
        {
          id: "arcade-product-details",
          className: "arcade-buybox",
          blocks: [
            product("arcade-product-title", "title"),
            product("arcade-product-price", "price"),
            product("arcade-product-campaigns", "campaigns"),
            product("arcade-product-notice", "notice"),
            product("arcade-product-host", "host"),
            product("arcade-product-buy", "buy"),
            product("arcade-product-withdrawal", "withdrawal"),
            product("arcade-product-description", "description"),
            product("arcade-product-fields", "fields"),
            product("arcade-product-safety", "safety"),
          ],
        },
      ],
    },
    {
      id: "arcade-related-row",
      type: "row",
      layout: "1",
      className: "arcade-section",
      columns: [{ id: "arcade-related", blocks: [product("arcade-product-related", "related", { heading: "Next level", limit: 4, columns: 4, at: { sm: { columns: 2 } } })] }],
    },
  ] as unknown as PageRow[],
};

/**
 * Arcade's stylesheet: a near-black violet sky with a pink and a cyan haze and faint scanlines behind every page, headings that glow like
 * bent glass (the hero's lights up once, as a sign does), pixel labels with a blinking cursor, cards and tiles like lit screens that answer
 * the pointer in cyan, and a product page whose picture sits in a glowing frame beside a buy box on its own panel. Written for the site's own
 * classes and Arcade's own (`arcade-…`); every motion stops for reduced motion.
 */
const CSS = `
:root, :scope[data-site-css] { --arcade-cyan: #22e4ff; --arcade-glow: color-mix(in srgb, var(--accent) 60%, transparent); --arcade-line: rgba(255,255,255,.09); --arcade-panel: rgba(255,255,255,.03); }
body, :scope[data-site-css] { background-color: var(--background); background-image: radial-gradient(1100px 650px at 88% -12%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 62%), radial-gradient(900px 620px at -12% 40%, rgba(34,228,255,.10), transparent 60%); background-attachment: fixed; }
body::before, :scope[data-site-css]::before { content: ""; position: fixed; inset: 0; pointer-events: none; z-index: -1; background: url(/demo/themes/arcade/scan.webp) 0 0 / 512px repeat; opacity: .7; }
@keyframes arcade-on { 0% { opacity: .15; } 6% { opacity: 1; } 9% { opacity: .35; } 12% { opacity: 1; } 55% { opacity: .82; } 58% { opacity: 1; } 100% { opacity: 1; } }
@keyframes arcade-blink { 50% { opacity: 0; } }

h1, h2, h3 { text-wrap: balance; }
.arcade-glow h1, .arcade-glow h2, h1.arcade-glow, h2.arcade-glow, .arcade-glow .rich-text p { text-shadow: 0 0 1px rgba(255,255,255,.55), 0 0 10px var(--arcade-glow), 0 0 34px color-mix(in srgb, var(--accent) 38%, transparent); }
.arcade-cyan h2, h2.arcade-cyan { text-shadow: 0 0 1px rgba(255,255,255,.55), 0 0 10px rgba(34,228,255,.6), 0 0 34px rgba(34,228,255,.35); }
.arcade-hero h1 { animation: arcade-on 1.8s ease-out 1 both; }
.arcade-pixel.arcade-pixel .rich-text p { color: var(--arcade-cyan); margin: 0 0 1rem; }
.arcade-pixel.arcade-pixel .rich-text p::after { content: "_"; margin-left: .2em; animation: arcade-blink 1.1s steps(1) infinite; }
.arcade-lead.arcade-lead .rich-text p { color: var(--muted); max-width: 34rem; }
.arcade-finale .arcade-lead.arcade-lead .rich-text p { margin-inline: auto; }

.button-primary, .kz-btn { text-transform: uppercase; letter-spacing: .1em; font-weight: 600; }
.arcade-more { margin-top: 2.2rem; }

.arcade-hero-copy { max-width: 40rem; }
@media (max-width: 767px) { .arcade-hero-copy { background: radial-gradient(closest-side, rgba(11,7,16,.72), transparent); } }

.product-card { background: var(--arcade-panel); border: 1px solid var(--arcade-line); border-radius: 16px; padding: 10px 10px 16px; transition: transform var(--kz-hover-dur, .3s) ease, border-color var(--kz-hover-dur, .3s) ease, box-shadow var(--kz-hover-dur, .3s) ease; }
.product-card:hover { transform: translateY(-4px); border-color: var(--arcade-cyan); box-shadow: 0 0 0 1px rgba(34,228,255,.5), 0 0 28px rgba(34,228,255,.28); }
.product-card-image { border-radius: 10px; overflow: hidden; }

.arcade-section h2 { margin-bottom: 2rem; }
.arcade-collections { gap: 22px; }
.arcade-tile { border: 1px solid var(--arcade-line); border-radius: 18px; padding: 12px 12px 20px; background: var(--arcade-panel); transition: border-color .3s ease, box-shadow .3s ease, transform .3s ease; }
.arcade-tile:hover { transform: translateY(-4px); border-color: var(--accent); box-shadow: 0 0 0 1px var(--arcade-glow), 0 0 32px color-mix(in srgb, var(--accent) 30%, transparent); }
.arcade-tile-image img { border-radius: 10px; }
.arcade-tile.arcade-tile { row-gap: .6rem; }
.arcade-tile-name { margin-top: .9rem; padding-inline: 4px; text-shadow: 0 0 14px var(--arcade-glow); }
.arcade-tile-line { padding-inline: 4px; }
.arcade-tile-line.arcade-tile-line .rich-text p { color: var(--muted); margin: 0; }
.arcade-level { padding: 1.4rem; border: 1px dashed var(--arcade-line); border-radius: 16px; }
.arcade-screen img { border-radius: 18px; box-shadow: 0 0 0 1px var(--arcade-line), 0 30px 80px -30px color-mix(in srgb, var(--accent) 45%, transparent); }
.arcade-finale { text-align: center; }

.arcade-header { border-bottom: 1px solid var(--arcade-line); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); background: rgba(11,7,16,.6); }
.arcade-logo a > span { font-family: var(--site-heading-font, sans-serif); font-size: 1.5rem; font-weight: 400; letter-spacing: .02em; text-shadow: 0 0 10px var(--arcade-glow); }
.arcade-nav a { font-size: .82rem; letter-spacing: .14em; text-transform: uppercase; }
.arcade-footer { border-top: 1px solid var(--arcade-line); background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 8%, transparent), transparent 260px); }
.arcade-footer-line { margin: 1.2rem 0 .6rem; }

.arcade-gallery { position: relative; }
.arcade-gallery img { border-radius: 14px; box-shadow: 0 0 0 1px rgba(34,228,255,.35), 0 0 40px rgba(34,228,255,.18); }
.arcade-buybox { border: 1px solid var(--arcade-line); border-radius: 20px; padding: 28px; background: var(--arcade-panel); }
@media (min-width: 1024px) { .arcade-buybox { position: sticky; top: 100px; align-self: start; } }

@media (prefers-reduced-motion: reduce) {
  .arcade-hero h1, .arcade-pixel.arcade-pixel .rich-text p::after { animation: none; }
  .product-card:hover, .arcade-tile:hover { transform: none; }
}
`.trim();

/** The core section styles at Arcade's scale: a big glowing hero heading that keeps to the screen on phones, and room between sections. */
function arcadeStyles() {
  const styles = coreStyles({ heroSize: 5, band: "#140c1e", bandText: "#f6f0ff", space: 80 });
  return {
    ...styles,
    hero: { ...styles.hero, h1: { ...styles.hero.h1, at: { md: { typography: { text: { size: rem(3.75) } } }, sm: { typography: { text: { size: rem(2.75) } } } } } },
    plain: { row: { style: { padding: { top: 80, right: 20, bottom: 80, left: 20 } }, at: { sm: { style: { padding: { top: 56, right: 18, bottom: 56, left: 18 } } } } } },
  };
}

const DARK = { background: "#0b0710", surface: "#150e1f", text: "#f6f0ff", muted: "#ab9dc4", border: "#2a2140", accent: "#ff2bd6", accentText: "#160313" };
const LIGHT = { background: "#faf6ff", surface: "#efe8fa", text: "#1a1026", muted: "#5d4f73", border: "#ddd2ee", accent: "#b3109a", accentText: "#ffffff" };

const settings: ThemeSettings = {
  mode: "dark",
  visitorSwitch: false,
  light: LIGHT,
  dark: DARK,
  fonts: { heading: NEON, body: "Space Grotesk" },
  headings: { weight: "normal", case: "normal" },
  buttons: { style: "filled", corners: "rounded" },
  corners: { cards: "medium", fields: "small" },
  layout: { width: "wide", maxWidth: 1240, headerAlign: "left", headerBackground: "page" },
  productCards: { image: "square", style: "plain", align: "left" },
  elements: {
    h1: { typography: { text: { size: rem(4.25), lineHeight: lines(1.05) } }, at: { sm: { typography: { text: { size: rem(2.6) } } } } },
    h2: { typography: { text: { size: rem(2.75), lineHeight: lines(1.1) } }, at: { sm: { typography: { text: { size: rem(2) } } } } },
    h3: { typography: { text: { size: rem(1.35), lineHeight: lines(1.25) } } },
    p: { typography: { text: { size: rem(1.0625), lineHeight: lines(1.65) } } },
    button: { typography: { text: { weight: 600 } } },
  },
  sectionStyles: arcadeStyles(),
  hover: { button: "glow", duration: 260 },
} as unknown as ThemeSettings;

export const ARCADE: LaunchTheme = {
  key: "arcade",
  version: 1,
  signature: true,
  title: "Arcade",
  summary: "An arcade at night: glowing neon headings, pixel labels and screens that light up.",
  description:
    "Made from scratch for shops with a playful streak. Near-black pages with faint scanlines, headings in Tilt Neon that glow like bent glass and light up as a sign does, pixel labels with a blinking cursor, hot pink for the button that matters and cyan for what answers the pointer, product cards like lit screens, levels for how things are made, and a product page whose picture sits in a glowing frame. Its demo store, Neon Alley, sells LED neon signs.",
  notes: null,
  listing: {
    kinds: ["home", "digital", "crafts"],
    styles: ["bold", "playful", "artistic"],
    pack: "neon",
    highlights: {
      devices: { title: "Lit up on every screen", text: "Arcade's glowing headings, pixel labels and neon buttons on a computer and on a phone." },
      collage: { title: "Sections that glow", text: "A synthwave hero, collections as lit screens, levels for how things are made, and a wall of signs to end on." },
      closeup: { title: "A product in the spotlight", text: "The picture in a glowing frame, with the price and the button to add to the cart on a panel beside it." },
    },
  },
  snapshot: { v: DESIGN_SNAPSHOT_VERSION, theme: { base: "minimal", settings }, header, footer, productLayout, css: CSS },
  presets: [
    {
      key: "vapor",
      name: "Vapor",
      pack: "beauty",
      changes: {
        dark: { background: "#100a1c", surface: "#1a1230", text: "#f4f0ff", muted: "#b6a9d6", border: "#2e2450", accent: "#7df9ff", accentText: "#071318" },
      },
    },
    {
      key: "terminal",
      name: "Terminal",
      pack: "electronics",
      changes: {
        dark: { background: "#050a06", surface: "#0b140d", text: "#d9ffe0", muted: "#8fbf98", border: "#1b2e1f", accent: "#39ff6a", accentText: "#031006" },
      },
    },
  ],
};
