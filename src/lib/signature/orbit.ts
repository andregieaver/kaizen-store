import type { PackPicture } from "../content-pack-pages";
import type { ContentPack } from "../content-packs";
import { DESIGN_SNAPSHOT_VERSION, type DesignLayout } from "../design-presets";
import type { LaunchTheme } from "../launch-themes";
import type { PackPictureOf } from "../pack-designs";
import { newPageContent, type PageContent, type PageRow } from "../page-content";
import type { ThemeSettings } from "../theme";
import { coreStyles, em, lines, rem } from "../theme-kit";

/**
 * Orbit, the first signature theme (`docs/signature-themes.md` step 2): a theme for the night sky, made from scratch. Deep blue-black pages
 * under a field of stars that drifts and twinkles (still for reduced motion), starlight gold for the one thing to press, Unbounded's wide
 * letters over Manrope, a header that lies over the hero, a product page that sets the picture in a glow beside a buy box that stays in view,
 * and a demo store of its own, Far Light, selling prints of planets, nebulae and star charts, whose pictures are Orbit's own art
 * (`scripts/theme-art/orbit.js`, `public/demo/themes/orbit/`). Data only; every word passes `findClaims()` (`signature-themes.test.ts`).
 */

const ART = "/demo/themes/orbit";
const art = (name: string, width: number, height: number, alt: string): PackPicture => ({ url: `${ART}/${name}.webp`, width, height, alt });

// ---------------------------------------------------------------------------------------------------------------------------------------
// The demo store: Far Light
// ---------------------------------------------------------------------------------------------------------------------------------------

const PRINTS = [
  ["saturn", "Saturn, ring plane", "The ringed planet near its equinox, every ring drawn line by line, in pale gold on a deep night sky.", 790, "planets"],
  ["jupiter", "Jupiter and four moons", "The giant planet's belts and storms, with its four largest moons set out in a row beside it.", 790, "planets"],
  ["pale-blue-dot", "Pale blue dot", "Earth as one small point of light in a band of sunlight, seen from the edge of the solar system.", 690, "planets"],
  ["eclipse", "Total eclipse", "The Sun's corona in the minute of totality, with the last bead of light at the Moon's edge.", 790, "planets"],
  ["orion-nebula", "Orion nebula", "The cloud of gas and young stars in Orion's sword, in rose, violet and gold.", 890, "deep-sky"],
  ["andromeda", "Andromeda galaxy", "Our large neighbouring galaxy, its spiral arms tilted toward us and its bright core glowing.", 890, "deep-sky"],
  ["sky-chart", "Northern sky chart", "The brightest stars of the northern sky joined into their figures, in gold lines on midnight blue.", 890, "charts"],
  ["moon-phases", "A month of the Moon", "Eight phases set in a circle around a full moon, from new moon back to new moon.", 690, "charts"],
] as const;

export const ORBIT_PACK: ContentPack = {
  key: "astronomy",
  version: 1,
  title: "Night sky print shop",
  summary: "Prints of planets, nebulae and star charts: the demo store made for the Orbit theme.",
  description:
    "Far Light, a demo shop of framed prints of the night sky, with three collections, its story and an about page. Replace the prints, words and pictures with your own.",
  category: "retail",
  storeName: "Far Light",
  headline: "Bring the night sky home",
  tagline: "Prints of planets, nebulae and the stars over your own sky, drawn with care and framed to hang.",
  points: [
    { title: "Drawn from the sky", text: "Each print starts from the positions and shapes of real stars, planets and nebulae." },
    { title: "Printed to last", text: "Matte, heavy paper with deep blacks, set in an ivory mat and a thin black frame." },
    { title: "Ready to hang", text: "Every print arrives framed, with its hanging cord already fitted." },
  ],
  storyTitle: "Made under dark skies",
  story:
    "Far Light began on clear winter nights, sketching what a small telescope showed us. Every print is still drawn in our studio and checked against the sky it shows before it goes to print.",
  about: [
    "Far Light is a small studio drawing the night sky. We make prints of the planets, the deep sky and the stars above us, for walls that deserve a window to space.",
    "This is a demo store made for the Orbit theme. Its prints, words and pictures are examples: replace them with your own.",
  ],
  categories: [
    { slug: "planets", name: "Planets and Moon" },
    { slug: "deep-sky", name: "Deep sky" },
    { slug: "charts", name: "Charts" },
  ],
  products: PRINTS.map(([handle, title, description, price, category]) => ({
    handle,
    title,
    description,
    price,
    category,
    picture: `A framed print of ${title.toLowerCase()} on a dark gallery wall`,
    grams: 1800,
  })),
  look: "Deep space art prints in midnight blue, violet and starlight gold, framed with an ivory mat on a dark gallery wall.",
  heroPicture: "A deep field of stars and violet nebulae with a planet's sunrise at the lower right",
  storyPicture: "Star trails turning over an observatory on a hill",
  art: {
    hero: art("hero", 2560, 1440, "A planet's sunrise under violet nebulae"),
    story: art("trails", 1600, 1200, "Star trails turning over an observatory on a hill"),
    sky: art("milkyway", 2400, 1200, "The Milky Way over a mountain ridge"),
    "tile:planets": art("tile-planets", 1200, 900, "Saturn and its rings"),
    "tile:deep-sky": art("tile-deep-sky", 1200, 900, "A nebula in rose and violet"),
    "tile:charts": art("tile-charts", 1200, 900, "A star chart in gold on midnight blue"),
    ...Object.fromEntries(PRINTS.map(([handle, title]) => [`product:${handle}`, art(`print-${handle}`, 1200, 1600, `${title}, framed`)])),
  },
  design: "orbit",
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// The demo store's pages
// ---------------------------------------------------------------------------------------------------------------------------------------

const uuid = () => globalThis.crypto.randomUUID();
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
type Look = Record<string, unknown>;
const text = (texts: string[], className?: string, look?: Look) => ({
  id: uuid(),
  type: "richText",
  doc: { type: "doc", content: texts.map(paragraph) },
  ...(className && { className }),
  ...(look && { typography: { text: look } }),
});
const heading = (words: string, level: number, className?: string, look?: Look) => ({
  id: uuid(),
  type: "heading",
  text: words,
  level,
  ...(className && { className }),
  ...(look && { typography: { text: look } }),
});
/** The small line in capitals over a heading, in the accent colour (the stylesheet's, so each preset has its own). */
const EYEBROW: Look = { size: rem(0.75), lineHeight: lines(1.4), letterSpacing: em(0.3), transform: "uppercase", weight: 600 };
const LEAD: Look = { size: rem(1.15), lineHeight: lines(1.6) };
const eyebrow = (words: string) => text([words], "orbit-eyebrow", EYEBROW);
const button = (label: string, href: string, variant: "filled" | "outline" | "text" = "filled", extra: Record<string, unknown> = {}) => ({
  id: uuid(),
  type: "button",
  label,
  href,
  variant,
  shape: "pill",
  ...extra,
});
const image = (picture: PackPicture | null, className?: string) => ({
  id: uuid(),
  type: "image",
  image: picture ? { ...picture } : null,
  caption: "",
  href: "",
  ...(className && { className }),
});
const photo = (picture: PackPicture | null, overlay = 35) =>
  picture ? { type: "image", image: { url: picture.url, width: picture.width, height: picture.height }, overlay: { color: "#05060f", opacity: overlay } } : undefined;
const productGrid = (limit: number, extra: Record<string, unknown> = {}) => ({
  id: uuid(),
  type: "contentGrid",
  source: { type: "products" },
  categories: [],
  tags: [],
  sort: "oldest",
  limit,
  columns: { mobile: 2, tablet: 2, desktop: 4 },
  show: { image: true, heading: true, excerpt: false, price: true, button: false },
  buttonLabel: "",
  emptyText: "",
  headingLevel: 3,
  excerptLines: 3,
  gap: 28,
  ...extra,
});

/** Far Light's home page: the hero over the planet's sunrise, new prints, the three collections, how they are made, the story, and a last call. */
export function orbitHomePage(pack: ContentPack, picture: PackPictureOf): PageContent {
  const hero = {
    id: uuid(),
    type: "row",
    layout: "1",
    width: "full",
    height: 92,
    align: "middle",
    sectionStyle: "hero",
    className: "orbit-hero",
    background: photo(picture("hero"), 10),
    columns: [
      {
        id: uuid(),
        className: "orbit-hero-copy",
        blocks: [
          eyebrow("Prints of the night sky"),
          heading(pack.headline, 1, "orbit-display", { weight: 300 }),
          text([pack.tagline], "orbit-lead", LEAD),
          { id: uuid(), type: "dualButton", first: { label: "Shop the prints", href: "/products", variant: "filled" }, second: { label: "Our story", href: "#story", variant: "outline" }, size: "lg", shape: "pill", gap: 14 },
        ],
      },
    ],
  };
  const fresh = {
    id: uuid(),
    type: "row",
    layout: "1",
    sectionStyle: "plain",
    htmlId: "prints",
    className: "orbit-section",
    columns: [
      {
        id: uuid(),
        blocks: [
          eyebrow("New in the studio"),
          heading("Fresh from the observatory", 2),
          productGrid(4),
          button("See all eight prints", "/products", "text", { align: "center", className: "orbit-more" }),
        ],
      },
    ],
  };
  const tile = (slug: string, name: string, line: string) => ({
    id: uuid(),
    className: "orbit-tile",
    link: { href: `/category/${slug}`, label: name },
    background: photo(picture(`tile:${slug}`), 30),
    blocks: [heading(name, 3), text([line], "orbit-tile-line", { size: rem(0.95), lineHeight: lines(1.5) })],
  });
  const collections = {
    id: uuid(),
    type: "row",
    layout: "3",
    sectionStyle: "plain",
    className: "orbit-section orbit-collections",
    // The tiles follow the prints' "See all" at once: the section above has already given the room.
    style: { padding: { top: 0, right: 20, bottom: 80, left: 20 } },
    at: { sm: { style: { padding: { top: 0, right: 18, bottom: 56, left: 18 } } } },
    columns: [
      tile("planets", "Planets and Moon", "Saturn, Jupiter, our Moon and the Sun in eclipse"),
      tile("deep-sky", "Deep sky", "Nebulae and galaxies far beyond the planets"),
      tile("charts", "Charts", "The figures of the stars and the Moon's month"),
    ],
  };
  const numbered = pack.points.map((point, i) => ({
    id: uuid(),
    className: "orbit-step",
    blocks: [text([`0${i + 1}`], "orbit-numeral", { family: "Unbounded", size: rem(4), lineHeight: lines(1), weight: 200 }), heading(point.title, 3), text([point.text])],
  }));
  const steps = { id: uuid(), type: "row", layout: "3", sectionStyle: "feature", className: "orbit-section orbit-steps", columns: numbered };
  const story = {
    id: uuid(),
    type: "row",
    layout: "2",
    sectionStyle: "plain",
    htmlId: "story",
    align: "middle",
    className: "orbit-section orbit-story",
    columns: [
      { id: uuid(), blocks: [image(picture("story"), "orbit-framed")] },
      { id: uuid(), blocks: [eyebrow("Our story"), heading(pack.storyTitle, 2), text([pack.story]), button(`About ${pack.storeName}`, "/about", "outline")] },
    ],
  };
  const last = {
    id: uuid(),
    type: "row",
    layout: "1",
    width: "full",
    sectionStyle: "contrast",
    className: "orbit-finale",
    background: photo(picture("sky"), 45),
    columns: [
      {
        id: uuid(),
        typography: { text: { align: "center" } },
        blocks: [
          heading("Find your own sky", 2, "orbit-display", { weight: 300, size: rem(3.25) }),
          text(["Eight prints in three collections, framed and ready to hang."], "orbit-lead", LEAD),
          button("Browse all prints", "/products", "filled", { align: "center", size: "lg" }),
        ],
      },
    ],
  };
  return { ...newPageContent(), title: "Home", slug: "welcome", rows: [hero, fresh, collections, steps, story, last] as unknown as PageRow[] };
}

/** Far Light's about page: who they are over the Milky Way, then the story beside the star trails. */
export function orbitAboutPage(pack: ContentPack, picture: PackPictureOf): PageContent {
  const rows = [
    {
      id: uuid(),
      type: "row",
      layout: "1",
      width: "full",
      height: 56,
      align: "middle",
      sectionStyle: "hero",
      className: "orbit-hero",
      background: photo(picture("sky"), 35),
      columns: [{ id: uuid(), className: "orbit-hero-copy", blocks: [eyebrow("About us"), heading(`About ${pack.storeName}`, 1, "orbit-display", { weight: 300 })] }],
    },
    {
      id: uuid(),
      type: "row",
      layout: "2",
      align: "middle",
      sectionStyle: "plain",
      className: "orbit-section orbit-story",
      columns: [
        { id: uuid(), blocks: [heading(pack.storyTitle, 2), text(pack.about), button("Shop the prints", "/products")] },
        { id: uuid(), blocks: [image(picture("story"), "orbit-framed")] },
      ],
    },
  ];
  return { ...newPageContent(), title: "About us", slug: "about", rows: rows as unknown as PageRow[] };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// The theme
// ---------------------------------------------------------------------------------------------------------------------------------------

const site = (id: string, part: string, extra: Record<string, unknown> = {}) => ({ id, type: "site", part, ...extra });
const product = (id: string, part: string, extra: Record<string, unknown> = {}) => ({ id, type: "product", part, ...extra });
const phonesHidden = { visibility: { hideAt: ["sm"] } };

const header: DesignLayout = {
  css: "",
  overlay: { where: "front", textColor: "#ffffff" },
  menus: { "orbit-header-menu": "header" },
  rows: [
    {
      id: "orbit-header-row",
      type: "row",
      // Its line and glass span the screen; its content keeps to the page's width.
      width: "full",
      contentWidth: "content",
      layout: "fit-sides",
      stack: false,
      align: "middle",
      className: "orbit-header",
      style: { padding: { top: 18, right: 28, bottom: 18, left: 28 } },
      at: { sm: { gap: 8, style: { padding: { top: 12, right: 16, bottom: 12, left: 16 } } } },
      columns: [
        { id: "orbit-header-brand", inline: true, blocks: [site("orbit-header-menu-button", "menuButton"), site("orbit-header-logo", "logo")] },
        {
          id: "orbit-header-nav",
          blocks: [
            {
              id: "orbit-header-menu",
              type: "menu",
              align: "center",
              className: "orbit-nav",
              itemHover: { kind: "line", edge: "below", travel: "slide", thickness: 1, active: true },
              ...phonesHidden,
            },
          ],
        },
        {
          id: "orbit-header-tools",
          inline: true,
          justify: "end",
          blocks: [
            site("orbit-header-search", "search"),
            site("orbit-header-account", "account", phonesHidden),
            site("orbit-header-wishlist", "wishlist"),
            site("orbit-header-cart", "cart"),
          ],
        },
      ],
    },
  ] as unknown as PageRow[],
};

const footer: DesignLayout = {
  css: "",
  menus: { "orbit-footer-menu": "footer" },
  rows: [
    {
      id: "orbit-footer-row",
      type: "row",
      // Its line and glass span the screen; its content keeps to the page's width.
      width: "full",
      contentWidth: "content",
      layout: "4",
      className: "orbit-footer",
      style: { padding: { top: 88, right: 28, bottom: 56, left: 28 } },
      columns: [
        {
          id: "orbit-footer-brand",
          blocks: [
            site("orbit-footer-logo", "logo"),
            {
              id: "orbit-footer-line",
              type: "richText",
              className: "orbit-footer-line",
              doc: { type: "doc", content: [paragraph("Clear skies.")] },
              typography: { text: { family: "Unbounded", size: rem(1.6), weight: 300, lineHeight: lines(1.3) } },
            },
          ],
        },
        { id: "orbit-footer-links", blocks: [{ id: "orbit-footer-menu", type: "menu", direction: "column" }] },
        { id: "orbit-footer-help", blocks: [site("orbit-footer-cookies", "cookies"), site("orbit-footer-withdrawal", "withdrawal"), site("orbit-footer-markets", "markets", { display: "list", direction: "column" })] },
        { id: "orbit-footer-company", blocks: [site("orbit-footer-business", "business")] },
      ],
    },
  ] as unknown as PageRow[],
};

const productLayout: DesignLayout = {
  css: "",
  menus: {},
  rows: [
    {
      id: "orbit-product-row",
      type: "row",
      layout: "2",
      className: "orbit-product",
      style: { padding: { top: 32, right: 20, bottom: 56, left: 20 } },
      columns: [
        { id: "orbit-product-media", className: "orbit-gallery", blocks: [product("orbit-product-back", "back"), product("orbit-product-gallery", "gallery")] },
        {
          id: "orbit-product-details",
          className: "orbit-buybox",
          blocks: [
            product("orbit-product-title", "title"),
            product("orbit-product-price", "price"),
            product("orbit-product-campaigns", "campaigns"),
            product("orbit-product-notice", "notice"),
            product("orbit-product-host", "host"),
            product("orbit-product-buy", "buy"),
            product("orbit-product-withdrawal", "withdrawal"),
            product("orbit-product-description", "description"),
            product("orbit-product-fields", "fields"),
            product("orbit-product-safety", "safety"),
          ],
        },
      ],
    },
    {
      id: "orbit-related-row",
      type: "row",
      layout: "1",
      className: "orbit-section",
      columns: [{ id: "orbit-related", blocks: [product("orbit-product-related", "related", { heading: "Also in the night sky", limit: 4, columns: 4, at: { sm: { columns: 2 } } })] }],
    },
  ] as unknown as PageRow[],
};

/**
 * Orbit's stylesheet: the sky behind every page (two layers of stars that tile, one drifting and one twinkling), starlight gold for the main
 * button with a soft glow, glass product cards that rise toward the pointer, the hero's orbit ring, the collections' tiles, the numbered
 * steps, the framed pictures, the glowing gallery and the buy box that stays in view. Written for the site's own classes and Orbit's own
 * (`orbit-…`), so it reads the same on any store's pages; every motion stops for reduced motion.
 */
const CSS = `
:root, :scope[data-site-css] { --orbit-glow: color-mix(in srgb, var(--accent) 55%, transparent); --orbit-violet: #8b6cff; --orbit-glass: rgba(255,255,255,.04); --orbit-line: rgba(255,255,255,.09); }
body, :scope[data-site-css] { background-color: var(--background); background-image: radial-gradient(1200px 700px at 80% -10%, rgba(139,108,255,.14), transparent 60%), radial-gradient(900px 600px at -10% 30%, rgba(46,120,200,.10), transparent 60%); background-attachment: fixed; }
body::before, :scope[data-site-css]::before { content: ""; position: fixed; inset: -50% 0 0 0; pointer-events: none; z-index: -1; background: url(/demo/themes/orbit/stars.webp) 0 0 / 1024px repeat; opacity: .5; animation: orbit-drift 240s linear infinite; }
body::after, :scope[data-site-css]::after { content: ""; position: fixed; inset: 0; pointer-events: none; z-index: -1; background: url(/demo/themes/orbit/twinkle.webp) 300px 200px / 1024px repeat; animation: orbit-twinkle 7s ease-in-out infinite alternate; }
@keyframes orbit-drift { to { transform: translateY(50%); } }
@keyframes orbit-twinkle { 0% { opacity: .15; } 50% { opacity: .7; } 100% { opacity: .35; } }
@keyframes orbit-ring { to { transform: rotate(360deg); } }

h1, h2, h3 { letter-spacing: -0.02em; text-wrap: balance; }
.orbit-eyebrow.orbit-eyebrow .rich-text p { color: var(--accent); margin: 0 0 1rem; }
.orbit-lead.orbit-lead .rich-text p { color: var(--muted); max-width: 34rem; }
.orbit-finale .orbit-lead.orbit-lead .rich-text p { margin-inline: auto; }

.button-primary, .kz-btn { letter-spacing: .04em; transition: box-shadow var(--kz-hover-dur, .3s) ease, transform var(--kz-hover-dur, .3s) ease; }
.button-primary:hover, .kz-btn:hover { box-shadow: 0 0 0 1px var(--orbit-glow), 0 10px 40px -8px var(--orbit-glow); transform: translateY(-1px); }

.orbit-hero { position: relative; overflow: hidden; isolation: isolate; }
.orbit-hero::after { content: ""; position: absolute; z-index: -1; width: 140vmax; aspect-ratio: 1; left: 45%; top: 55%; translate: -50% -50%; border-radius: 50%; border: 1px solid rgba(255,255,255,.08); box-shadow: inset 0 0 120px rgba(139,108,255,.06); animation: orbit-ring 180s linear infinite; pointer-events: none; }
.orbit-hero::before { content: ""; position: absolute; z-index: -1; width: 10px; height: 10px; left: calc(45% + 70vmax * .7071); top: calc(55% - 70vmax * .7071); border-radius: 50%; background: var(--accent); box-shadow: 0 0 24px 6px var(--orbit-glow); opacity: .8; pointer-events: none; }
.orbit-hero-copy { max-width: 40rem; }
@media (max-width: 767px) { .orbit-hero-copy { background: radial-gradient(closest-side, rgba(5,6,15,.6), transparent); } }
.orbit-hero h1 { text-shadow: 0 2px 40px rgba(5,6,15,.6); }

.product-card { background: var(--orbit-glass); border: 1px solid var(--orbit-line); border-radius: 22px; padding: 12px 12px 18px; transition: transform var(--kz-hover-dur, .35s) ease, box-shadow var(--kz-hover-dur, .35s) ease, border-color var(--kz-hover-dur, .35s) ease; }
.product-card:hover { transform: translateY(-6px); border-color: var(--orbit-glow); box-shadow: 0 30px 60px -30px rgba(139,108,255,.55); }
.product-card-image { border-radius: 14px; overflow: hidden; }

.orbit-section h2 { margin-bottom: 2.2rem; }
.orbit-more { margin-top: 2.2rem; }
.orbit-collections { gap: 22px; }
.orbit-tile { min-height: 360px; border-radius: 26px; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end; padding: 32px; border: 1px solid var(--orbit-line); transition: transform .5s ease, border-color .5s ease; }
.orbit-tile:hover { transform: translateY(-6px); border-color: var(--orbit-glow); }
.orbit-tile h3 { margin: 0 0 .35rem; }
.orbit-tile { position: relative; isolation: isolate; }
.orbit-tile::after { content: ""; position: absolute; inset: 0; z-index: -1; background: linear-gradient(180deg, transparent 35%, rgba(5,6,15,.88)); pointer-events: none; }
.orbit-tile-line.orbit-tile-line .rich-text p { color: rgba(238,240,255,.82); margin: 0; }
.orbit-numeral.orbit-numeral .rich-text p { color: transparent; -webkit-text-stroke: 1px var(--accent); margin: 0 0 1.2rem; }
.orbit-step { padding-top: 1.6rem; border-top: 1px solid var(--orbit-line); }
.orbit-framed img { border-radius: 26px; box-shadow: 0 40px 80px -40px rgba(0,0,0,.9), 0 0 0 1px var(--orbit-line); }
.orbit-finale { text-align: center; }

.orbit-header { border-bottom: 1px solid var(--orbit-line); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); background: rgba(7,8,22,.55); }
.orbit-nav a { font-size: .78rem; letter-spacing: .2em; text-transform: uppercase; }
.orbit-footer { border-top: 1px solid var(--orbit-line); background: linear-gradient(180deg, rgba(139,108,255,.08), transparent 240px); position: relative; }
.orbit-footer::before { content: ""; position: absolute; left: 10%; right: 10%; top: -1px; height: 1px; background: linear-gradient(90deg, transparent, var(--accent), transparent); }
.orbit-footer-line { margin-top: 1.4rem; }

.orbit-gallery { position: relative; }
.orbit-gallery::before { content: ""; position: absolute; inset: 8% 4%; z-index: -1; border-radius: 50%; background: radial-gradient(closest-side, rgba(139,108,255,.35), rgba(46,120,200,.12) 55%, transparent); filter: blur(30px); pointer-events: none; }
@media (min-width: 1024px) { .orbit-buybox { position: sticky; top: 100px; align-self: start; } }
.orbit-buybox h1 { font-weight: 300; }

@media (prefers-reduced-motion: reduce) {
  body::before, body::after, :scope[data-site-css]::before, :scope[data-site-css]::after, .orbit-hero::after { animation: none; }
  .product-card:hover, .orbit-tile:hover, .button-primary:hover, .kz-btn:hover { transform: none; }
}
`.trim();

/** The core section styles at Orbit's scale: a large hero heading on computers that keeps to the screen on phones, and generous room. */
function orbitStyles() {
  const styles = coreStyles({ heroSize: 4.5, band: "#121338", bandText: "#f3f0ff", space: 80 });
  return {
    ...styles,
    hero: { ...styles.hero, h1: { ...styles.hero.h1, at: { md: { typography: { text: { size: rem(3.5) } } }, sm: { typography: { text: { size: rem(2.6) } } } } } },
    plain: { row: { style: { padding: { top: 80, right: 20, bottom: 80, left: 20 } }, at: { sm: { style: { padding: { top: 56, right: 18, bottom: 56, left: 18 } } } } } },
  };
}

const DARK = { background: "#070816", surface: "#0f1229", text: "#eef0ff", muted: "#a4abd0", border: "#262b52", accent: "#f2c46d", accentText: "#14100a" };
const LIGHT = { background: "#f4f3ef", surface: "#e9e7e0", text: "#121528", muted: "#4d5270", border: "#d6d3ca", accent: "#2f33a8", accentText: "#ffffff" };

const settings: ThemeSettings = {
  mode: "dark",
  visitorSwitch: false,
  light: LIGHT,
  dark: DARK,
  fonts: { heading: "Unbounded", body: "Manrope" },
  headings: { weight: "normal", case: "normal" },
  buttons: { style: "filled", corners: "pill" },
  corners: { cards: "large", fields: "large" },
  layout: { width: "wide", maxWidth: 1240, headerAlign: "left", headerBackground: "page" },
  productCards: { image: "portrait", style: "plain", align: "left" },
  elements: {
    h1: { typography: { text: { size: rem(3.75), lineHeight: lines(1.05), letterSpacing: em(-0.02) } }, at: { sm: { typography: { text: { size: rem(2.5) } } } } },
    h2: { typography: { text: { size: rem(2.5), lineHeight: lines(1.1) } }, at: { sm: { typography: { text: { size: rem(1.9) } } } } },
    h3: { typography: { text: { size: rem(1.3), lineHeight: lines(1.25) } } },
    p: { typography: { text: { size: rem(1.0625), lineHeight: lines(1.7) } } },
    button: { typography: { text: { weight: 600, letterSpacing: em(0.04) } } },
  },
  sectionStyles: orbitStyles(),
  hover: { button: "glow", duration: 320 },
} as unknown as ThemeSettings;

export const ORBIT: LaunchTheme = {
  key: "orbit",
  version: 1,
  signature: true,
  title: "Orbit",
  summary: "A theme for the night sky: deep space, starlight gold and room to wonder.",
  description:
    "Made from scratch for stores with a sense of wonder. Pages under a field of stars that slowly drifts, Unbounded's wide letters over Manrope, starlight gold for the button that matters, a header that lies over the hero, glass product cards, and a product page that sets each picture in a soft glow beside a buy box that stays in view. Its demo store, Far Light, sells prints of the night sky.",
  notes: null,
  listing: {
    kinds: ["crafts", "home", "digital"],
    styles: ["bold", "artistic"],
    pack: "astronomy",
    highlights: {
      devices: { title: "A window to space", text: "Orbit's starry sky, wide letters and gold buttons on a computer and on a phone." },
      collage: { title: "Sections with a sense of wonder", text: "A hero over a planet's sunrise, collections as tiles, numbered steps and the story told beside its picture." },
      closeup: { title: "A product page that glows", text: "The picture in a soft glow, with the price and the button to add to the cart kept in view." },
    },
  },
  snapshot: { v: DESIGN_SNAPSHOT_VERSION, theme: { base: "minimal", settings }, header, footer, productLayout, css: CSS },
  presets: [
    {
      key: "nebula",
      name: "Nebula",
      pack: "beauty",
      changes: {
        dark: { background: "#0b0716", surface: "#170f2b", text: "#f3eeff", muted: "#b9acdb", border: "#33244f", accent: "#d4a8ff", accentText: "#160a26" },
      },
    },
    {
      key: "mars",
      name: "Mars",
      pack: "electronics",
      changes: {
        dark: { background: "#120a08", surface: "#1f1310", text: "#f7ece6", muted: "#cdb3a7", border: "#3d2620", accent: "#ff8a5c", accentText: "#1a0b05" },
      },
    },
  ],
};
