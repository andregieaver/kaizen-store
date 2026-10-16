import { findClaims } from "./claims";
import { contentPack, packSlots, type ContentPack } from "./content-packs";
import { cssProblem } from "./custom-css";
import type { LaunchTheme } from "./launch-themes";
import { PACK_DESIGNS } from "./pack-designs";
import { blockText, type PageBlock, type PageRow } from "./page-content";
import { flowRows } from "./page-modal";
import { footerHasWithdrawal, footerRequired, siteBlocks } from "./site-layout";

/**
 * The bar a signature theme is held to (`docs/signature-themes.md`, "The bar, made checkable"): what code can tell of *unique* and
 * *converting*, so a theme made from scratch, by hand or later by the platform AI, cannot ship as settings over the standard layouts or
 * lose the shop's job to its art. *Artistic* and *beautiful* stay a person's look at the photographs (D264); contrast and fonts are
 * `themeCheck()`'s. Pure: the caller says which art files exist.
 *
 * Unique: its own header, footer, product page and stylesheet, and a demo store (content pack) whose home and about pages are designed for
 * it (`ContentPack.design`), with art for every picture, kept in `public/demo/themes/{key}/`.
 * Converting: the header always offers search and the cart; the product page's first row holds the title, the price, the gallery and the
 * buy part (so price, choice and *Add to cart* are on the first screen); the footer shows what the law asks of a store's footer (business
 * details, cookies, withdrawal at every size); and no word anywhere, the theme's, its listing's, its pack's or its pages', makes a claim
 * `findClaims()` stops.
 */

/** What the product page's first row must hold. */
export const FIRST_ROW_PARTS = ["title", "price", "gallery", "buy"] as const;

/** What the header must always offer. */
export const HEADER_PARTS = ["search", "cart"] as const;

type Rows = { rows: PageRow[] };

const blocksOf = (rows: readonly PageRow[]): PageBlock[] => rows.flatMap((row) => row.columns.flatMap((column) => column.blocks));

const partsOf = (rows: readonly PageRow[], type: "site" | "product"): string[] =>
  blocksOf(rows)
    .filter((block) => block.type === type)
    .map((block) => String((block as { part?: unknown }).part));

/** Every word a signature theme puts before a shopper or an owner: its listing, its presets' names, its pack and the pack's designed pages. */
export function signatureWords(theme: LaunchTheme, pack: ContentPack | null): string[] {
  const words = [theme.title, theme.summary, theme.description, ...theme.presets.map((preset) => preset.name)];
  for (const highlight of Object.values(theme.listing.highlights ?? {})) if (highlight) words.push(highlight.title, highlight.text);
  for (const layout of [theme.snapshot.header, theme.snapshot.footer, theme.snapshot.productLayout]) {
    if (layout) words.push(...blocksOf(layout.rows).map(blockText));
  }
  if (pack) {
    words.push(pack.title, pack.summary, pack.description, pack.storeName, pack.headline, pack.tagline, pack.storyTitle, pack.story, ...pack.about);
    words.push(...pack.points.flatMap((point) => [point.title, point.text]), ...pack.categories.map((category) => category.name));
    words.push(...pack.products.flatMap((product) => [product.title, product.description]));
    words.push(...Object.values(pack.art ?? {}).map((art) => art.alt));
    const design = pack.design ? PACK_DESIGNS[pack.design] : null;
    if (design) {
      const picture = (slot: string) => pack.art?.[slot] ?? null;
      for (const page of [design.home(pack, picture), design.about(pack, picture)]) words.push(page.title, ...blocksOf(page.rows).map(blockText));
    }
  }
  return words.filter((word) => word.trim().length > 0);
}

/** What keeps a signature theme from shipping, in plain sentences; none: it meets the bar code can check. */
export function signatureCheck(theme: LaunchTheme, options: { artExists: (url: string) => boolean }): string[] {
  const problems: string[] = [];
  if (!theme.signature) return [`${theme.title} is not marked as a signature theme.`];
  const { header, footer, productLayout, css } = theme.snapshot;

  // Unique: its own layouts and stylesheet.
  const own = (layout: Rows | null | undefined, name: string): layout is Rows => {
    if (layout && flowRows(layout.rows).length > 0) return true;
    problems.push(`It has no ${name} of its own.`);
    return false;
  };
  if (!css?.trim()) problems.push("It has no stylesheet of its own.");
  else {
    const problem = cssProblem(css);
    if (problem) problems.push(`Its stylesheet: ${problem}`);
  }

  // Converting: search and the cart in the header, the buy box on the product page's first screen, the footer the law asks for.
  if (own(header, "header")) {
    const parts = partsOf(header.rows, "site");
    for (const part of HEADER_PARTS) if (!parts.includes(part)) problems.push(`Its header has no ${part}.`);
  }
  if (own(footer, "footer")) {
    const parts = siteBlocks(footer).map((block) => block.part);
    for (const part of footerRequired("store")) if (!parts.includes(part)) problems.push(`Its footer has no ${part} part, which the law asks a store's footer to show.`);
    if (parts.includes("withdrawal") && !footerHasWithdrawal(footer)) problems.push("Its footer hides the withdrawal link at some screen size.");
  }
  if (own(productLayout, "product page")) {
    const [first] = flowRows(productLayout.rows);
    const parts = first ? partsOf([first], "product") : [];
    for (const part of FIRST_ROW_PARTS) if (!parts.includes(part)) problems.push(`Its product page's first row has no ${part}, so a shopper may have to scroll to buy.`);
  }

  // Its world: a demo store of its own with designed pages and art for every picture, bundled with the code.
  const pack = theme.listing.pack ? contentPack(theme.listing.pack) : null;
  if (!pack) problems.push(`Its demo store (${theme.listing.pack ?? "none"}) is not a content pack.`);
  else {
    if (!pack.design || !PACK_DESIGNS[pack.design]) problems.push(`Its demo store, ${pack.storeName}, has no pages designed for it.`);
    const art = pack.art ?? {};
    for (const slot of packSlots(pack)) if (!art[slot]) problems.push(`Its demo store has no art for ${slot}.`);
    const folder = `/demo/themes/${theme.key}/`;
    for (const [slot, picture] of Object.entries(art)) {
      if (!picture.url.startsWith(folder) || !picture.url.endsWith(".webp")) problems.push(`Its art for ${slot} is not a WebP in ${folder}.`);
      else if (!options.artExists(picture.url)) problems.push(`Its art for ${slot} (${picture.url}) is missing: run node scripts/theme-art.mjs ${theme.key}.`);
      if (!picture.alt.trim()) problems.push(`Its art for ${slot} has no alt text.`);
    }
    const others = theme.presets.filter((preset) => preset.pack === theme.listing.pack);
    if (others.length > 0) problems.push("A preset is shown on the theme's own demo store; each look needs a store of its own.");
  }

  for (const word of signatureWords(theme, pack)) {
    const found = findClaims(word);
    if (found.length > 0) problems.push(`"${word.slice(0, 60)}" makes a claim the filter stops (${found.map((f) => f.kind).join(", ")}).`);
  }
  return problems;
}
