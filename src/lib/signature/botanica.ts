import type { PackPicture } from "../content-pack-pages";
import type { ContentPack } from "../content-packs";
import { DESIGN_SNAPSHOT_VERSION, type DesignLayout } from "../design-presets";
import type { LaunchTheme } from "../launch-themes";
import type { PackPictureOf } from "../pack-designs";
import { newPageContent, type PageContent, type PageRow } from "../page-content";
import type { ThemeSettings } from "../theme";
import { coreStyles, em, lines, rem } from "../theme-kit";

import { EYEBROW, heading, iconList, image, paragraph, phonesHidden, photo, product, productGrid, shot, site, text, uuid, type Look } from "./kit";

/**
 * Botanica, a signature theme (`docs/signature-themes.md` step 3): a plant shop drawn on paper, made from scratch. Warm cream pages with a
 * paper grain, Fraunces' soft letters with an italic word over DM Sans, a header that floats as a rounded bar, pictures shaped as arches and
 * soft blobs, a fern sprig that sways in the hero's corner, collections on cards, care told with small icons, and a leafy band to end on.
 * Its demo store, Fernhouse, sells house plants, drawn by `scripts/theme-art/botanica.js` (`public/demo/themes/botanica/`). Data only;
 * every word passes `findClaims()` (`signature-themes.test.ts`).
 */

const ART = "/demo/themes/botanica";
const art = (name: string, width: number, height: number, alt: string): PackPicture => ({ url: `${ART}/${name}.webp`, width, height, alt });

const SERIF = "Fraunces";

// ---------------------------------------------------------------------------------------------------------------------------------------
// The demo store: Fernhouse
// ---------------------------------------------------------------------------------------------------------------------------------------

const PLANTS = [
  ["monstera", "Monstera", "Big, glossy leaves split and holed as they grow, on a plant that fills a corner in a year or two.", 549, "big-leaves", 6000, "A monstera with large split leaves in a cream glazed pot"],
  ["fiddle-fig", "Fiddle-leaf fig", "Large, violin-shaped leaves on a woody stem, for a bright spot it can call its own.", 749, "big-leaves", 7000, "A fiddle-leaf fig with violin-shaped leaves in a terracotta pot"],
  ["bird-of-paradise", "Bird of paradise", "Long paddle leaves on tall stalks that bring a little of the tropics indoors.", 899, "big-leaves", 8000, "A bird of paradise with long paddle leaves in a woven basket"],
  ["snake-plant", "Snake plant", "Upright, banded leaves with golden edges that keep their shape with little care.", 349, "easy-care", 3500, "A snake plant with upright, banded, yellow-edged leaves in a sage pot"],
  ["zz-plant", "ZZ plant", "Arching stems of glossy leaflets that are happy in a darker corner.", 399, "easy-care", 3000, "A ZZ plant with arching stems of glossy leaflets in a cream pot"],
  ["pilea", "Chinese money plant", "Round, coin-like leaves on thin stalks, and little offshoots to share with friends.", 249, "easy-care", 1200, "A Chinese money plant with round leaves in a woven basket"],
  ["fern", "Bird's-nest fern", "A rosette of wavy fronds that loves a steamy bathroom or a shady shelf.", 299, "trailing", 1800, "A bird's-nest fern with wavy fronds in a sage bowl"],
  ["string-of-pearls", "String of pearls", "Trailing strands of small round beads that spill over the edge of a shelf.", 279, "trailing", 900, "A string of pearls in a terracotta bowl on a small oak stand, its strands hanging down"],
] as const;

/** What each plant's product photograph shows (D270). */
const PLANT_SHOTS: Record<(typeof PLANTS)[number][0], string> = {
  monstera: "a monstera with large split leaves in a cream glazed ceramic pot",
  "fiddle-fig": "a fiddle-leaf fig with violin-shaped leaves on a woody stem in a raw terracotta pot",
  "bird-of-paradise": "a bird of paradise with long paddle-shaped leaves on tall stalks in a woven seagrass basket",
  "snake-plant": "a snake plant with upright, banded leaves edged in yellow in a sage glazed pot",
  "zz-plant": "a ZZ plant with arching stems of glossy oval leaflets in a cream glazed pot",
  pilea: "a Chinese money plant with round, coin-shaped leaves on thin stalks in a small woven seagrass basket",
  fern: "a bird's-nest fern with wavy, glossy fronds in a sage glazed bowl",
  "string-of-pearls": "a string of pearls in a terracotta bowl on a small oak plant stand, its beaded strands hanging down",
};

export const BOTANICA_PACK: ContentPack = {
  key: "plants",
  version: 1,
  title: "Plant shop",
  summary: "Potted house plants and their care: the demo store made for the Botanica theme.",
  description:
    "Fernhouse, a demo shop of potted house plants, with three collections, its story and an about page. Replace the plants, words and pictures with your own.",
  category: "retail",
  storeName: "Fernhouse",
  headline: "Bring the outside in",
  tagline: "House plants grown with care, potted and ready for a new home, with a care card in every box.",
  points: [
    { title: "Potted and ready", text: "Every plant arrives in its pot, settled in fresh soil and ready to place." },
    { title: "A care card with each plant", text: "Light, water and feeding on one card, so you know just what it needs." },
    { title: "Packed to travel", text: "We pack each plant upright in a box made for plants, with its leaves held still." },
  ],
  storyTitle: "Grown in our glasshouse",
  story:
    "Fernhouse began as a windowsill of cuttings shared with friends. Today we grow and pot every plant in our own glasshouse, and look after it until the day it leaves.",
  about: [
    "Fernhouse is a small plant shop and glasshouse. We grow, pot and pack house plants for homes and offices, and we write a care card for every one.",
    "This is a demo store made for the Botanica theme. Its plants, words and pictures are examples: replace them with your own.",
  ],
  categories: [
    { slug: "big-leaves", name: "Big leaves" },
    { slug: "easy-care", name: "Easy care" },
    { slug: "trailing", name: "Ferns and trailing" },
  ],
  products: PLANTS.map(([handle, title, description, price, category, grams]) => ({
    handle,
    title,
    description,
    price,
    category,
    picture: `A ${title.toLowerCase()} in its pot on cream paper`,
    grams,
  })),
  look:
    "Shot by a professional interior and product photographer for a plant shop's catalogue, on a full-frame camera with a 50 mm lens at f/5.6 and ISO 200. Soft natural daylight from a large window at the left and gentle shadows; a warm off-white plaster wall and a light oak floor or bench; healthy, glossy leaves with natural imperfections; pots in cream glaze, sage glaze and raw terracotta, and woven seagrass baskets. True-to-life greens, an airy, calm editorial look and fine grain.",
  heroPicture: "A lush arrangement of potted plants and big leaves against a warm plaster wall",
  storyPicture: "An arched glasshouse window full of plants",
  art: {
    hero: art("hero", 2560, 1440, "Potted plants on a low oak bench against cream paper: a monstera, a pilea, a snake plant and a string of pearls, a bird of paradise behind"),
    story: art("story", 1600, 1200, "An arched glasshouse window glowing with warm light, potted plants on an oak bench in front of it"),
    leaves: art("leaves", 2400, 1200, "A dense band of overlapping monstera, palm, fern and bird of paradise leaves in deep greens"),
    "tile:big-leaves": art("tile-big-leaves", 1200, 1500, "A fiddle-leaf fig, a bird of paradise and a monstera on a light oak floor"),
    "tile:easy-care": art("tile-easy-care", 1200, 1500, "A snake plant, a ZZ plant and a Chinese money plant on a light oak floor"),
    "tile:trailing": art("tile-trailing", 1200, 1500, "Two pots of string of pearls on an oak shelf above a bird's-nest fern"),
    ...Object.fromEntries(PLANTS.map(([handle, , , , , , alt]) => [`product:${handle}`, art(`plant-${handle}`, 1200, 1600, alt)])),
  },
  photos: {
    hero: shot(
      "landscape",
      "Potted plants on a low oak bench against a warm plaster wall in soft window light",
      "Potted plants on a low oak bench against a warm off-white plaster wall in soft window light: a monstera in a cream pot, a Chinese money plant, a snake plant and a trailing string of pearls, with a bird of paradise in a woven basket behind, all in the right half of the frame. The left half is calm, empty plaster wall with room for a headline.",
    ),
    story: shot(
      "landscape",
      "An arched glasshouse window in warm light with potted plants on an oak bench in front of it",
      "An arched glasshouse window glowing with warm afternoon light, potted plants on an oak bench in front of it: a snake plant, a Chinese money plant and a fern in terracotta and sage pots, with a monstera and a palm growing to either side.",
    ),
    leaves: shot(
      "landscape",
      "A dense wall of overlapping monstera, palm, fern and bird of paradise leaves in deep greens",
      "A dense wall of overlapping tropical leaves filling the whole frame: monstera, palm, fern and bird of paradise leaves in deep greens, darker toward the back, soft light catching their edges.",
    ),
    "tile:big-leaves": shot(
      "portrait",
      "A fiddle-leaf fig, a bird of paradise and a monstera on a light oak floor",
      "A fiddle-leaf fig in a raw terracotta pot, a bird of paradise in a woven seagrass basket and a monstera in a cream glazed pot standing together on a light oak floor against a warm plaster wall.",
    ),
    "tile:easy-care": shot(
      "portrait",
      "A snake plant, a ZZ plant and a Chinese money plant on a light oak floor",
      "A snake plant in a sage glazed pot, a ZZ plant in a cream glazed pot and a Chinese money plant in a raw terracotta pot, grouped on a light oak floor against a warm plaster wall.",
    ),
    "tile:trailing": shot(
      "portrait",
      "Two pots of string of pearls on an oak shelf above a bird's-nest fern",
      "Two terracotta pots of string of pearls on an oak wall shelf, their beaded strands hanging down, above a bird's-nest fern in a cream glazed pot on a light oak floor.",
    ),
    ...Object.fromEntries(
      PLANTS.map(([handle, , , , , , alt]) => [
        `product:${handle}`,
        shot(
          "portrait",
          alt,
          `A product photograph for an online shop: ${PLANT_SHOTS[handle]}, standing alone in the middle of a light oak floor against a warm off-white plaster wall, the whole plant and pot in frame with even space around it, photographed at the height of the pot's rim.`,
        ),
      ]),
    ),
  },
  design: "botanica",
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// The demo store's pages
// ---------------------------------------------------------------------------------------------------------------------------------------

const eyebrow = (words: string) => text([words], "botanica-eyebrow", { ...EYEBROW, letterSpacing: em(0.22) });
const LEAD: Look = { size: rem(1.15), lineHeight: lines(1.7) };
const COLLECTIONS: [slug: string, name: string, line: string][] = [
  ["big-leaves", "Big leaves", "Monsteras, figs and birds of paradise"],
  ["easy-care", "Easy care", "Plants that forgive a missed watering"],
  ["trailing", "Ferns and trailing", "Fronds and strands for shelves and bathrooms"],
];
const STEP_ICONS = ["sprout", "book", "package"];

/** Fernhouse's home page: the arch beside the words, the plants, three collections, how to care, how they come, and a leafy band to end on. */
export function botanicaHomePage(pack: ContentPack, picture: PackPictureOf): PageContent {
  const hero = {
    id: uuid(),
    type: "row",
    layout: "2",
    align: "middle",
    sectionStyle: "hero",
    className: "botanica-hero",
    columns: [
      {
        id: uuid(),
        width: 54,
        className: "botanica-hero-copy",
        blocks: [
          eyebrow("A plant shop and glasshouse"),
          heading("Bring the <em>outside</em> in", 1),
          text([pack.tagline], "botanica-lead", LEAD),
          {
            id: uuid(),
            type: "dualButton",
            first: { label: "Shop plants", href: "/products", variant: "filled" },
            second: { label: "Plant care", href: "#care", variant: "outline" },
            size: "lg",
            shape: "pill",
            gap: 12,
          },
        ],
      },
      { id: uuid(), width: 46, blocks: [image(picture("tile:big-leaves"), "botanica-arch")] },
    ],
  };
  const plants = {
    id: uuid(),
    type: "row",
    layout: "1",
    sectionStyle: "plain",
    className: "botanica-section",
    columns: [
      {
        id: uuid(),
        typography: { text: { align: "center" } },
        blocks: [eyebrow("Our plants"), heading("Ready for a <em>new home</em>", 2), productGrid(8, { gap: 28 })],
      },
    ],
  };
  const tile = ([slug, name, line]: [string, string, string]) => ({
    id: uuid(),
    className: "botanica-tile",
    link: { href: `/category/${slug}`, label: name },
    blocks: [image(picture(`tile:${slug}`), "botanica-arch"), heading(name, 3, "botanica-tile-name"), text([line], "botanica-tile-line")],
  });
  const collections = {
    id: uuid(),
    type: "row",
    layout: "3",
    sectionStyle: "plain",
    className: "botanica-section botanica-collections",
    style: { padding: { top: 0, right: 20, bottom: 96, left: 20 } },
    at: { sm: { style: { padding: { top: 0, right: 18, bottom: 64, left: 18 } } } },
    columns: COLLECTIONS.map(tile),
  };
  const care = {
    id: uuid(),
    type: "row",
    layout: "2",
    align: "middle",
    sectionStyle: "muted",
    htmlId: "care",
    className: "botanica-section botanica-care",
    columns: [
      { id: uuid(), width: 46, blocks: [image(picture("story"), "botanica-blob")] },
      {
        id: uuid(),
        width: 54,
        className: "botanica-care-copy",
        blocks: [
          eyebrow("Plant care"),
          heading("Care, <em>simply</em>", 2),
          iconList(
            [
              ["sun", "Bright light, out of the midday sun"],
              ["droplet", "Water when the top of the soil is dry"],
              ["leaf", "Wipe the leaves clean now and then"],
              ["sprout", "Feed a little in spring and summer"],
            ],
            { className: "botanica-care-list" },
          ),
        ],
      },
    ],
  };
  const steps = {
    id: uuid(),
    type: "row",
    layout: "3",
    sectionStyle: "feature",
    className: "botanica-section botanica-steps",
    columns: pack.points.map((point, i) => ({
      id: uuid(),
      className: "botanica-step",
      blocks: [iconList([[STEP_ICONS[i] ?? "leaf", point.title]], { className: "botanica-step-title" }), text([point.text])],
    })),
  };
  const last = {
    id: uuid(),
    type: "row",
    layout: "1",
    width: "full",
    height: 66,
    align: "middle",
    sectionStyle: "contrast",
    className: "botanica-finale",
    background: photo(picture("leaves"), 42, "#0f1a12"),
    columns: [
      {
        id: uuid(),
        typography: { text: { align: "center", color: "#f4efe3" } },
        blocks: [
          heading("Every room <em>deserves</em> a plant", 2, undefined, { color: "#f4efe3", size: rem(3.5) }),
          text(["Eight plants in three collections, potted and ready to go."], "botanica-lead botanica-on-dark", LEAD),
          { id: uuid(), type: "button", label: "Shop all plants", href: "/products", variant: "filled", shape: "pill", align: "center", size: "lg" },
        ],
      },
    ],
  };
  return { ...newPageContent(), title: "Home", slug: "welcome", rows: [hero, plants, collections, care, steps, last] as unknown as PageRow[] };
}

/** Fernhouse's about page: its name over the leafy hero, then their words beside the glasshouse. */
export function botanicaAboutPage(pack: ContentPack, picture: PackPictureOf): PageContent {
  const rows = [
    {
      id: uuid(),
      type: "row",
      layout: "1",
      width: "full",
      height: 60,
      align: "middle",
      sectionStyle: "hero",
      className: "botanica-about-hero",
      background: photo(picture("hero"), 0, "#f4efe3"),
      columns: [{ id: uuid(), className: "botanica-hero-copy", blocks: [eyebrow("About us"), heading(`About <em>${pack.storeName}</em>`, 1)] }],
    },
    {
      id: uuid(),
      type: "row",
      layout: "2",
      align: "middle",
      sectionStyle: "plain",
      className: "botanica-section",
      columns: [
        {
          id: uuid(),
          blocks: [
            heading(pack.storyTitle, 2),
            text([pack.story, ...pack.about]),
            { id: uuid(), type: "button", label: "Shop plants", href: "/products", variant: "filled", shape: "pill" },
          ],
        },
        { id: uuid(), blocks: [image(picture("story"), "botanica-blob")] },
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
  menus: { "botanica-header-menu": "header" },
  rows: [
    {
      id: "botanica-header-row",
      type: "row",
      layout: "fit-sides",
      stack: false,
      align: "middle",
      className: "botanica-header",
      style: { padding: { top: 10, right: 14, bottom: 10, left: 22 } },
      at: { sm: { gap: 8, style: { padding: { top: 8, right: 10, bottom: 8, left: 14 } } } },
      columns: [
        { id: "botanica-header-brand", inline: true, blocks: [site("botanica-header-menu-button", "menuButton"), site("botanica-header-logo", "logo", { className: "botanica-logo" })] },
        {
          id: "botanica-header-nav",
          blocks: [
            {
              id: "botanica-header-menu",
              type: "menu",
              align: "center",
              className: "botanica-nav",
              itemHover: { kind: "background", travel: "slide", radius: 40, active: true },
              ...phonesHidden,
            },
          ],
        },
        {
          id: "botanica-header-tools",
          inline: true,
          justify: "end",
          blocks: [
            site("botanica-header-search", "search"),
            site("botanica-header-account", "account", phonesHidden),
            site("botanica-header-wishlist", "wishlist"),
            site("botanica-header-cart", "cart"),
          ],
        },
      ],
    },
  ] as unknown as PageRow[],
};

const footer: DesignLayout = {
  css: "",
  menus: { "botanica-footer-menu": "footer" },
  rows: [
    {
      id: "botanica-footer-row",
      type: "row",
      width: "full",
      contentWidth: "content",
      layout: "4",
      className: "botanica-footer",
      style: { padding: { top: 88, right: 28, bottom: 56, left: 28 } },
      columns: [
        {
          id: "botanica-footer-brand",
          blocks: [
            site("botanica-footer-logo", "logo", { className: "botanica-logo" }),
            {
              id: "botanica-footer-line",
              type: "richText",
              className: "botanica-footer-line",
              doc: { type: "doc", content: [paragraph("Grow well.")] },
              typography: { text: { family: SERIF, style: "italic", size: rem(2), weight: 400, lineHeight: lines(1.2) } },
            },
          ],
        },
        { id: "botanica-footer-links", blocks: [{ id: "botanica-footer-menu", type: "menu", direction: "column" }] },
        {
          id: "botanica-footer-help",
          blocks: [
            site("botanica-footer-cookies", "cookies"),
            site("botanica-footer-withdrawal", "withdrawal"),
            site("botanica-footer-markets", "markets", { display: "list", direction: "column" }),
          ],
        },
        { id: "botanica-footer-company", blocks: [site("botanica-footer-business", "business")] },
      ],
    },
  ] as unknown as PageRow[],
};

const productLayout: DesignLayout = {
  css: "",
  menus: {},
  rows: [
    {
      id: "botanica-product-row",
      type: "row",
      layout: "2",
      className: "botanica-product",
      style: { padding: { top: 32, right: 20, bottom: 64, left: 20 } },
      columns: [
        { id: "botanica-product-media", className: "botanica-gallery", blocks: [product("botanica-product-back", "back"), product("botanica-product-gallery", "gallery")] },
        {
          id: "botanica-product-details",
          className: "botanica-buybox",
          blocks: [
            product("botanica-product-title", "title"),
            product("botanica-product-price", "price"),
            product("botanica-product-campaigns", "campaigns"),
            product("botanica-product-notice", "notice"),
            product("botanica-product-host", "host"),
            product("botanica-product-buy", "buy"),
            product("botanica-product-withdrawal", "withdrawal"),
            product("botanica-product-description", "description"),
            product("botanica-product-fields", "fields"),
            product("botanica-product-safety", "safety"),
          ],
        },
      ],
    },
    {
      id: "botanica-related-row",
      type: "row",
      layout: "1",
      className: "botanica-section",
      columns: [
        {
          id: "botanica-related",
          blocks: [product("botanica-product-related", "related", { heading: "Good company", limit: 4, columns: 4, at: { sm: { columns: 2 } } })],
        },
      ],
    },
  ] as unknown as PageRow[],
};

/**
 * Botanica's stylesheet: the paper grain behind every page, a header that floats as a rounded bar, the italic word in headings, pictures as
 * arches and blobs, a fern sprig that sways by the hero, product cards with arched pictures that rise a little, collections on cards, care
 * lines with round icons, and a soft rounded footer. Written for the site's own classes and Botanica's own (`botanica-…`); every motion
 * stops for reduced motion.
 */
const CSS = `
:root, :scope[data-site-css] { --botanica-line: color-mix(in srgb, var(--foreground) 12%, transparent); --botanica-leaf: color-mix(in srgb, var(--accent) 14%, transparent); }
body::before, :scope[data-site-css]::before { content: ""; position: fixed; inset: 0; pointer-events: none; z-index: -1; background: url(/demo/themes/botanica/paper.webp) 0 0 / 512px repeat; opacity: .7; }
@keyframes botanica-sway { 0%, 100% { transform: rotate(-14deg); } 50% { transform: rotate(-8deg); } }

h1, h2, h3 { text-wrap: balance; }
h1 em, h2 em { font-style: italic; color: var(--accent); }
.botanica-eyebrow.botanica-eyebrow .rich-text p { color: var(--accent); margin: 0 0 1rem; }
.botanica-lead.botanica-lead .rich-text p { color: var(--muted); max-width: 32rem; }
.botanica-finale .botanica-lead.botanica-lead .rich-text p { margin-inline: auto; color: rgba(244,239,227,.86); }
.botanica-finale h2 em { color: inherit; }

.site-header { border-bottom-color: transparent; background: transparent; backdrop-filter: none; -webkit-backdrop-filter: none; }
.botanica-header { max-width: min(1240px, calc(100% - 28px)); margin: 14px auto 0; border-radius: 999px; background: color-mix(in srgb, var(--background) 82%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid var(--botanica-line); box-shadow: 0 14px 34px -24px rgba(31,42,31,.45); }
.botanica-logo a > span { font-family: var(--site-heading-font, serif); font-size: 1.45rem; font-weight: 500; font-style: italic; }
.botanica-nav a { font-size: .92rem; }

.botanica-hero { position: relative; }
.botanica-hero::after { content: ""; position: absolute; left: -30px; bottom: -40px; width: 260px; height: 260px; background: url(/demo/themes/botanica/sprig.webp) center / contain no-repeat; pointer-events: none; transform-origin: 20% 90%; animation: botanica-sway 9s ease-in-out infinite; opacity: .85; }
@media (max-width: 767px) { .botanica-hero::after { width: 160px; height: 160px; left: auto; right: -20px; bottom: -30px; } }
.botanica-arch img { aspect-ratio: 4 / 5; object-fit: cover; border-radius: 999px 999px 28px 28px; }
.botanica-blob img { border-radius: 58% 42% 46% 54% / 52% 44% 56% 48%; }

.product-card { text-align: center; transition: transform var(--kz-hover-dur, .35s) ease; }
.product-card:hover { transform: translateY(-5px); }
.product-card-image { border-radius: 999px 999px 22px 22px; overflow: hidden; background: var(--surface); }
.product-card h3 { font-family: var(--site-heading-font, serif); font-size: 1.2rem; font-weight: 500; }

.botanica-section h2 { margin-bottom: 2rem; }
.botanica-collections { gap: 24px; }
.botanica-tile { background: var(--surface); border-radius: 32px; padding: 16px 16px 24px; text-align: center; transition: transform .4s ease, box-shadow .4s ease; }
.botanica-tile:hover { transform: translateY(-5px); box-shadow: 0 24px 40px -28px rgba(31,42,31,.5); }
.botanica-tile-name { margin-top: 1rem; }
.botanica-tile-line.botanica-tile-line .rich-text p { color: var(--muted); margin: 0; }

.botanica-care-list li svg, .botanica-step-title li svg { color: var(--accent); background: var(--botanica-leaf); border-radius: 999px; padding: 6px; box-sizing: content-box; }
.botanica-care-list li { font-size: 1.05rem; padding: .35rem 0; }
.botanica-step-title li { font-family: var(--site-heading-font, serif); font-size: 1.3rem; }
.botanica-step { padding: 1.6rem; border-radius: 28px; border: 1px solid var(--botanica-line); }

.botanica-footer { border-radius: 48px 48px 0 0; background: var(--surface); }
.botanica-footer-line { margin-top: 1rem; }
.botanica-footer-line.botanica-footer-line .rich-text p { color: var(--accent); }

.botanica-gallery img { border-radius: 28px; }
.botanica-buybox h1 { font-weight: 400; }
@media (min-width: 1024px) { .botanica-buybox { position: sticky; top: 110px; align-self: start; } }

@media (prefers-reduced-motion: reduce) {
  .botanica-hero::after { animation: none; }
  .product-card:hover, .botanica-tile:hover { transform: none; }
}
`.trim();

/** The core section styles at Botanica's scale: a generous hero heading that keeps to the screen on phones, and soft room between sections. */
function botanicaStyles() {
  const styles = coreStyles({ heroSize: 4.75, band: "#1f3d2b", bandText: "#f4efe3", space: 88, quoteFamily: SERIF });
  return {
    ...styles,
    hero: {
      ...styles.hero,
      row: { style: { padding: { top: 96, right: 20, bottom: 96, left: 20 } }, at: { sm: { style: { padding: { top: 48, right: 18, bottom: 64, left: 18 } } } } },
      h1: { ...styles.hero.h1, at: { md: { typography: { text: { size: rem(3.75) } } }, sm: { typography: { text: { size: rem(2.75) } } } } },
    },
    plain: { row: { style: { padding: { top: 88, right: 20, bottom: 88, left: 20 } }, at: { sm: { style: { padding: { top: 56, right: 18, bottom: 56, left: 18 } } } } } },
  };
}

const LIGHT = { background: "#f4efe3", surface: "#ebe3d2", text: "#1f2a1f", muted: "#5c6655", border: "#d8cfbb", accent: "#2f5e3d", accentText: "#f4efe3" };
const DARK = { background: "#101812", surface: "#18241a", text: "#edf0e4", muted: "#a8b4a0", border: "#2b3a2e", accent: "#a8d18f", accentText: "#0e170f" };

const settings: ThemeSettings = {
  mode: "light",
  visitorSwitch: false,
  light: LIGHT,
  dark: DARK,
  fonts: { heading: SERIF, body: "DM Sans" },
  headings: { weight: "normal", case: "normal" },
  buttons: { style: "filled", corners: "pill" },
  corners: { cards: "large", fields: "large" },
  layout: { width: "wide", maxWidth: 1240, headerAlign: "left", headerBackground: "page" },
  productCards: { image: "portrait", style: "plain", align: "center" },
  elements: {
    h1: { typography: { text: { size: rem(4.25), lineHeight: lines(1.05), letterSpacing: em(-0.015) } }, at: { sm: { typography: { text: { size: rem(2.6) } } } } },
    h2: { typography: { text: { size: rem(2.75), lineHeight: lines(1.1) } }, at: { sm: { typography: { text: { size: rem(2) } } } } },
    h3: { typography: { text: { size: rem(1.4), lineHeight: lines(1.25), weight: 500 } } },
    p: { typography: { text: { size: rem(1.0625), lineHeight: lines(1.7) } } },
    button: { typography: { text: { weight: 600 } } },
  },
  sectionStyles: botanicaStyles(),
  hover: { button: "lift", duration: 320 },
} as unknown as ThemeSettings;

export const BOTANICA: LaunchTheme = {
  key: "botanica",
  version: 1,
  signature: true,
  title: "Botanica",
  summary: "A plant shop on paper: soft serif letters, arched pictures and room to grow.",
  description:
    "Made from scratch for shops that grow things. Warm cream pages with a paper grain, Fraunces' soft letters with an italic word in each heading over DM Sans, a header that floats as a rounded bar, pictures shaped as arches and soft blobs, a fern sprig that sways by the hero, collections on rounded cards, care told with small icons, and a leafy band to end on. Its demo store, Fernhouse, sells house plants.",
  notes: null,
  listing: {
    kinds: ["home", "food", "beauty"],
    styles: ["natural", "warm", "artistic"],
    pack: "plants",
    highlights: {
      devices: { title: "Calm on every screen", text: "Botanica's paper pages, soft serif letters and rounded buttons on a computer and on a phone." },
      collage: { title: "Sections that breathe", text: "An arched picture beside the words, collections on cards, care with small icons, and a leafy band to end on." },
      closeup: { title: "A product page with room", text: "The picture with soft corners beside the price and the button to add to the cart, kept in view." },
    },
  },
  snapshot: { v: DESIGN_SNAPSHOT_VERSION, theme: { base: "minimal", settings }, header, footer, productLayout, css: CSS },
  presets: [
    {
      key: "terracotta",
      name: "Terracotta",
      pack: "food",
      changes: {
        light: { background: "#f6eee6", surface: "#eedfd2", text: "#2a1d16", muted: "#6e5a4d", border: "#e0cfc0", accent: "#a4472a", accentText: "#fff6ef" },
      },
    },
    {
      key: "night-garden",
      name: "Night garden",
      pack: "services",
      changes: { mode: "dark" },
    },
  ],
};
