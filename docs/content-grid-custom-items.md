# Custom grid items, carousel behaviour and grid detection in the replicator (D155, spec)

Three connected pieces, built and shipped in this order (each is useful alone):

- **A. Custom grid items.** A content grid (D51) can hold items the owner writes by hand, with the fields a tile of a page,
  an article or a product shows, next to the three sources it has today.
- **B. Carousel behaviour.** The grid's carousel (and the testimonials' one, which shares it) gains what real carousels do:
  dots, rewind, snap choice and an optional autoplay that is safe to use.
- **C. Grid and carousel detection in the replicator (D150).** Repeated cards on the page being copied become one grid
  block of custom items (a carousel where the source scrolls sideways), instead of columns of loose blocks.

This file is the contract. A disagreement is settled here first. Owner's decision already taken: **a custom item's price is
plain text** (no live price, no VAT label, no add-to-cart).

## Why

The replicator builds rows of columns of rich text, picture and button blocks and styles them with measured CSS. A row of
cards becomes N columns of loose blocks: it looks right but cannot be edited as a set, a carousel on the source becomes a
plain sideways scroll with no arrows, snapping or dots, and every card spends blocks from the page's 100-block cap
(`BLOCKS_MAX`). A grid of custom items fixes all three, and is also what an owner wants for a feature list, a logo strip,
a team, a set of offers or a menu of services that are not products, pages or articles.

## What it does not do (said in the editor and on the report)

Slides that are arbitrary layouts (a hero slider with text and buttons over a picture), tabs, accordions and marquees; vertical
carousels; fade, cube and other effects; thumbnails; video slides; a grid inside a card; live prices; filters (those are for
product grids). A hero slider is a separate follow-up: a *Slider* block whose slides are rows.

---

## A. Custom grid items

### Data (page content is JSON: no migration expected)

`GridSource` (`src/lib/page-content.ts`) gains `{ type: "custom" }`; `GRID_CONTENT` gains `custom: "Custom items"`. The items
live in the block, as testimonials' do:

```ts
export const CUSTOM_ITEMS_MAX = 60;            // beyond ITEMS_MAX (30) because a copied grid can be large; still one block
export type CustomGridItem = {
  id: string;                                   // keeps the item's texts' translations (page-ids.ts)
  title: string;                                // 200
  text: string;                                 // plain, 600; clamped by the grid's excerptLines
  picture: { url: string; width: number; height: number; alt: string } | null;   // validated as the image block's
  link: ItemLink | null;                        // see below
  buttonLabel: string;                          // 60; empty uses the grid's, then "Read more"
  date: string | null;                          // YYYY-MM-DD, drawn like an article's date
  badge: string;                                // 40, e.g. "New", "-20 %": the owner's words, over the picture
  priceText: string;                            // 60, plain text, e.g. "From 199 kr": NOT a price (see rules)
  details: { label: string; text: string }[];   // at most TILE_FIELDS_MAX (3), one line each, as custom-field tile lines
};
export type ContentGridBlock = PartBase & { /* … as today … */ source: GridSource; items?: CustomGridItem[] };
```

`ItemLink` is the menu link shape (D52/D85: a page, product, category, tag or article **by slug**, the site's own
places, or a web address) and is resolved at render with `marketPath()`/the platform's paths, so a copied page or
store never carries another store's ids. Addresses pass `isSafeAddress()`. (Use the menu link type and its resolver;
do not invent a second one.)

### Rules

1. **A custom item is never a product.** `priceText` is drawn as plain text in the price's place with no VAT label, no
   30-day reference, no cart, never in structured data, feeds, search, recommendations or the chat agent. The editor says so
   beside the field ("Not a live price: shoppers pay what the checkout charges"). Where a product's own price is wanted, use
   a product grid.
2. **Categories, tags, sort and limit do not apply** to custom items (the order is the owner's, all items show, up to
   `limit` if smaller). The editor hides those controls for this source; `pageInput` requires `categories` and `tags` empty.
   `filters` (D83) is refused: they filter products.
3. **Items show once they have something to show**: a title, a picture or text; an empty item is skipped, not drawn as a gap.
4. **Pictures** are the library's (same validation as the image block, same size limits); alt text is typed per item
   (empty = decorative, said in the editor) and passes the claims filter when written by AI. Pictures go through `uploadToLibrary()` like every
   upload.
5. **Words by AI** (the page studio, the replicator's describe step): every item text passes `findClaims()`; a replica's text is
   the source's own words as measured, never invented.
6. **No cookie, no storage, no third-party script.**

### Rendering

`gridData()` (`src/server/content-grid.ts`) answers a custom source from the block itself (no query, no cache entry),
after `localizePage()` has put the language's texts over it. The rest of `ContentGridView` is reused: picture shape, tile
look, heading level and size, columns by screen, gap, button look, carousel. New in the view: the badge over the picture,
`priceText` in the price's place (`block.show.price` switches it), `details` lines like tile fields. The button label is the
item's, else the grid's, else "Read more" (`m.readMore`). The grid is drawn on the canvas and the site by the same component.

### Builder

`ItemsEditor` (D91) for the list: add (up to `CUSTOM_ITEMS_MAX`), drag to order, duplicate, delete, collapse. Per item: picture
(`ImageUploadButton` and the library), alt, title, text, link picker, button label, date, badge, price text, details. A button
**Copy current items** on a pages, articles or products grid turns what it shows now into custom items (a snapshot, titles,
excerpts, pictures and links by slug; a product's price becomes nothing, never text) so an owner can start from real content.
`BLOCK_EDITORS` gets the source choice and the item fields; `newBlock()` has no default items.

### Everywhere an item-based block is wired (testimonials is the model; every site below needs the new source)

`PageBlock`/`pageInput` (zod, limits, refinements), `blockHasContent()`, `blockText()`, `mapBlockTexts()` (`page-translation.ts`:
title 200, text 600, badge 40, priceText 60, buttonLabel 60, details label and text, picture alt 200, each keyed `${item.id}.…`),
the store translation worklist (`store-translate.ts`), `template-content.ts` (`mapTemplateMedia()` resolves every item picture; a link
by slug needs no swapping), `mediaUses()` (`media-library.ts`: a picture used by a custom item is "used"), `copyRow()` and `copyBlock()`
(fresh item ids, as testimonials), the page AI studio (`page-ai.ts`: `PATTERNS` may use a custom grid for feature cards and
logo strips; links only to `SiteFacts.links`), `motion-plan.ts`/`motion-ai.ts` (a grid takes part motion as before), A/B part
tests (`experiment-parts.ts`: a grid's items are part content), the duplicate-page copy, store copy (`COPY_RULES` needs nothing: page content), and
every place that reads `block.source.type` (the "View product"/"Read more" choice, `themed`, `ownProducts()`, the product-only
conditions, recommendations, the builder's grid preview action, `ContentGridSection`): find them with
`grep -rn "source.type" src` and decide each, with a test that the exhaustive switch fails to compile when a new source is added.

### Acceptance (A)

Unit: schema accepts a custom grid and refuses one with categories, filters, over `CUSTOM_ITEMS_MAX`, a long text, an unsafe
link, a foreign picture address; `gridData()` returns the items in order, skips empty ones, honours `limit`; the view draws badge,
priceText (no VAT label, no `<Price>`), details, the right button label; renderToString test of the grid and of the carousel
form. Translation: `mapBlockTexts()` lists every text and `localizePage()` puts them back; the worklist offers them. Templates:
a copied grid's pictures are the using store's. `mediaUses()` finds an item's picture. E2E: an owner adds three items in the
builder, publishes, the store page shows them as a grid and, switched to carousel, as a carousel; the market in another language
shows its translated texts. A test scans that no custom item reaches structured data, the sitemap, llms.txt, search or feeds.

---

## B. Carousel behaviour

`Carousel` (`src/components/carousel.tsx`) stays the browser's own scrolling with snapping and arrows, so it works with touch, trackpads, the
keyboard and **without JavaScript** (the track scrolls). It gains settings, shared by the content grid and testimonials:

```ts
export type CarouselSettings = {
  arrows?: boolean;                       // default true
  dots?: boolean;                         // default false: one dot per page of tiles, a button "Go to slide n", aria-current
  snap?: "start" | "center" | "none";     // default "start"
  rewind?: boolean;                       // default false: past the last tile the next arrow goes back to the first (no cloned tiles, no hidden duplicates)
  autoplay?: { seconds: number };         // default off; 3 to 15
};
// ContentGridBlock / TestimonialsBlock: carousel?: CarouselSettings   (display: "carousel" and peek stay as they are)
```

Rules:

1. **Autoplay is safe by construction**: never with `prefers-reduced-motion`; it stops for good once the visitor scrolls, drags,
   focuses inside or presses an arrow or dot; pauses while the pointer is over it and while the tab is hidden; a visible Pause/Play button is
   always present with autoplay on (WCAG 2.2.2); it announces nothing (`aria-live="off"` while playing, polite when paused by hand).
   Default is off, and the editor says that automatic movement is unwelcome to many visitors.
2. **Rewind, not infinite loop.** A real loop clones tiles, which duplicates content for screen readers and breaks "Nth of M". Rewind gives
   the effect with the real tiles only. (The replicator maps a source's loop to rewind.)
3. **Dots** are computed from `tiles / visible per screen`; they follow scrolling (an IntersectionObserver or the track's `scroll` event), are
   buttons in a labelled group (`m.carouselGoTo`), and hide when there is one page.
4. **Only `transform`/scroll move** (D128). The CSS is in `motion.css`/the component, never owner CSS; reduced motion uses `auto` scrolling.
5. New words (`m.carouselGoTo`, `m.carouselPause`, `m.carouselPlay`) in nb, sv, da, en by hand in `i18n.ts`; other languages come from the catalogue (D111).
6. Everything is reachable after the failsafe: with the JavaScript off, the tiles are a scrolling row and every link works.

Acceptance (B): unit tests for the dots' page maths, the settings schema and defaults; a component test with a fake scroller for
arrows' ends, rewind, dots and the autoplay stop conditions (reduced motion, interaction, hidden tab); e2e: a carousel with dots and
rewind in a real browser, keyboard operable, no autoplay under reduced motion, tab order and focus visible; the testimonials carousel
keeps working unchanged by default.

---

## C. The replicator makes grids and carousels

Today `buildReplica()` turns a `split` of N boxes into N columns and a box that scrolls sideways into a row with `overflow-x:auto`
(`scroller`). New: when the boxes are *the same card repeated*, build one `contentGrid` block of custom items instead. Pure code in
`src/lib/replicate-build.ts` plus a new `src/lib/replicate-grid.ts` (detection and mapping); capture (`replicate-capture.ts`,
`replicate-extract.ts`) gains what it must read; `ReplicatePanel`'s report names what was done.

### 1. Detect a repeated card group

A candidate is a parent with at least 3 sibling boxes (2 for a carousel with arrows) in one row or one scrolling/clipped track. They are
*the same card* when:

- their **signature** matches: the ordered kinds of their leaves (picture, heading-like text, paragraph, link or button, short label) and the
  nesting depth, with at most one optional leaf different (a badge);
- their **geometry** matches: widths within 10 %, heights within 20 %, equal gaps within 4 px, all on one line (or wrapped in equal rows);
- they are **not** structurally different siblings (a hero next to two small boxes), not a menu, not a form, not a footer column set
  (site parts keep their own handling), not inside another detected grid.

### 2. Map a card to an item, or refuse

Per card, map leaves to fields: the largest picture → `picture` (alt from the source's `alt`, else empty); the first heading, else the
largest-type short text → `title`; paragraphs → `text` (first paragraphs joined, cut at 600 on a word); a link or button → `link` and `buttonLabel`
(if the whole card is the link, the card's link and the grid's button off); a short text over the picture or a pill → `badge`; text that matches a
price pattern (a currency sign or code and digits) → `priceText`; a date pattern → `date`; remaining short label and value lines → `details` (three at most).

A card that has anything the item cannot hold (an icon set, a second picture, a rating widget, a form, a video, two buttons) **fails the mapping**. If
more than 20 % of the cards fail, or any card loses text, the group **stays as columns** exactly as today and `drop()` records why ("kept as columns: 3 of 6
cards hold a second button") so the report (`findingsOf()`) can name it. The converter never invents text or links; every item word is a measured word.

### 3. Style the grid from what was measured

`columns` (desktop, tablet if captured, phone) from the measured cards per row at each captured width; `gap`; `tile` (background, padding, border,
radius, shadow) from the card's painted box; `imageShape` from the pictures' aspect ratios (`original` when they vary); `headingLevel` and `headingSize`
nearest the title's tag and size; fonts through the existing font pipeline; text alignment and the rest through the style model's rules on the grid part
(`#id`), so the AI patch plan (`parsePatchPlan()`, place `grid`/`inside`) can still adjust it within `cleanDecl()`'s properties. The converter never sets
a picture's `maxWidth` or `align` (D150 rules stand).

### 4. Detect a carousel and read its settings

- **Native scrollers** (`node.scroll`, `overflow-x:auto|scroll` with `scroll-snap`): `display: "carousel"`, `snap` from `scroll-snap-align`.
- **Script sliders**: a clipped box (`overflow:hidden|clip`) holding a track whose children lie beyond its width, laid out by `transform: translate*` or a
  non-wrapping flex, whatever the library (hints, not requirements: roles `carousel`/`slider`, classes such as `swiper-wrapper`, `slick-track`, `splide__list`,
  `glide__slides`, `embla__container`, `owl-stage`, `flickity-slider`, `keen-slider`).
- **Clones are dropped**: tiles marked as clones (`swiper-slide-duplicate`, `slick-cloned`, `splide__slide--clone`, `owl-item cloned`, `data-swiper-slide-index`
  repeats) and, as a fallback, tiles whose content hash repeats a tile already kept; the order follows the source's own index when it has one. A loop that had clones
  becomes `rewind: true`.
- **Hidden slides** (fade sliders, `display:none`, `visibility:hidden`, off-screen) are read by their text and `src` without geometry (capture reads
  `textContent` and `img` sources of every candidate tile whether visible or not); the group is built only if the tiles' signature still matches.
- **Settings read**: `arrows` when previous/next buttons exist near the track (by label, role or class); `dots` when a tablist or a row of buttons equals the
  number of pages; `autoplay` only when two captures of the track some seconds apart show it moved with no interaction (the period becomes `seconds`, clamped
  3 to 15), else off, and the report says "autoplay observed" or "not observed"; tiles per screen by breakpoint from measured widths.
- A carousel the converter cannot understand stays as today (columns in a scrolling track) and the report says so.

### 5. Caps and fallbacks

Items are limited to `CUSTOM_ITEMS_MAX` (the rest are dropped and counted in the report). The grid is one block against `BLOCKS_MAX`. After a pass, if the
diff score for the grid's rows is clearly worse than the columns would have been (the pass's `weakest` list names the grid under 60 %), the next iteration
**rebuilds that group as columns** and records "grid reverted" with the evidence, so a grid can never make a copy worse than before. Pictures follow the assets plan
(`replicate-assets-plan.ts`) into the media library as image blocks' do.

### 6. The report (D150 rule: written in code from facts, never flattering)

New lines in `buildSummary()` and `findingsOf()`: grids built (cards, fields mapped, carousel settings read), groups kept as columns and why, clones dropped,
cards that failed mapping, autoplay observed or not, grids reverted. A new unmappable thing is a note via `drop()`.

### Acceptance (C)

Unit (fixtures are captured trees, no browser): a static 4-card grid; a 6-card native scroller with arrows; a Swiper-shaped track with clones; a Slick-shaped track with
cloned and hidden slides; a fade slider (kept as columns with the reason); cards with a badge, a price, a date; cards with a second button (kept as columns);
equal cards of different heights (refused); a footer's column set (refused); the style model for the grid is deterministic; items equal the cards' words
exactly (a property test: no word in an item that is not in the capture). Integration: `replicate-oda`-style test that a page with two grids and one carousel builds
three grid blocks and the block count drops against the columns' version. E2E: a local fixture page (handwritten markup and a small script that mimics a Swiper-like
slider with clones, served by the test server, `REPLICATE_ALLOW_PRIVATE`) copied end to end; the copy has a grid block with the right number of items, a carousel
with arrows (and dots where the source had them), and the original's clones are not items. A manual calibration list (`replicate-calibrate.ts`) of about ten real
sites reports item-count equality, field-mapping coverage and carousel detection, run by hand, not in CI, with the numbers written into `docs/page-replicator.md`.

---

## Decisions taken with defaults (say if one is wrong)

| Question | Default |
|---|---|
| Most custom items in a grid | 60 (one block; the pages' other item lists stay at 30) |
| Autoplay | off by default; opt-in per carousel; stops on any interaction; never under reduced motion |
| Infinite loop | no: rewind with real tiles only |
| Link kinds on an item | the menu link kinds, by slug; web addresses must pass `isSafeAddress()` |
| Badge and price text | the owner's plain words; no claims check on the owner's own words, a check on AI-written ones |
| Alt text | typed per item; empty means decorative and the editor says so |
| Copying current items into custom ones | included, prices dropped |
| Testimonials | shares the new carousel settings, otherwise unchanged; a replica never makes a testimonials block (a quote grid is a custom grid) |
| Hero sliders, tabs, accordions | not in this decision; a Slider block (slides are rows) is the follow-up |

## How it is built

Three workflow runs from `.claude/workflows/parity-wave.js`'s shape (spec already written, so they start at Foundation): **A** custom items (schema, view,
editor, translation, templates, media uses, tests); **B** carousel behaviour (component, settings, editor, tests); **C** replicator detection (pure library,
capture additions, report, calibration). A and B can run in parallel (disjoint files except `page-content.ts` and `i18n.ts`, owned by A for the first edit); C starts after
A. No database migration is expected; if one turns out to be needed the lead applies it (destructive statements in functions are listed for the owner). After each: lint,
typecheck, unit, integration, build and the storefront e2e; adversarial review in the lenses privacy and safety (links, pictures, autoplay accessibility), correctness
(detection never loses or invents words), and compatibility (existing grids and testimonials unchanged); then the decision row (D155), a CLAUDE.md bullet and the
tracker (`pnpm parity:write` if a row's criteria are now held).
