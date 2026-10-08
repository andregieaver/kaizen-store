# Responsive editing and visibility in the page builder (proposed D179)

Status: **planned, not started.** Agreed with the owner on 8 October 2026; built after D178 step 6 ships, and
before text colour and opacity (`docs/text-colour.md`, proposed D180). The model is Beaver Builder's: a value per
screen size on the settings of every row, column and component, a responsive editing mode in the builder, and
visibility by screen size, sign-in or conditions in each part's Advanced tab.

References: [Beaver Builder, Visibility](https://docs.wpbeaverbuilder.com/beaver-builder/layouts/advanced-tab/visibility),
[Responsive fields reference](https://docs.wpbeaverbuilder.com/beaver-builder/developer/custom-modules/responsive-fields-reference).

## 1. Decisions taken with the owner

| Question | Answer |
|---|---|
| Screen sizes | Four, as Beaver: **Extra large, Large, Medium, Small**, widths adjustable per store |
| Which way values pass | **Larger to smaller**: a value set on Extra large holds on smaller sizes until one of them sets its own |
| What gets a value per size | Spacing; typography; sizes and layout; colours, backgrounds, borders, corners and shadows |
| Logged in / logged out | On a store's pages a shopper signed in to their customer account; on Kaizen's own pages a person signed in to the admin |
| Conditions | Shopper facts, place and language, time, cart and address; rules combined with AND and OR |
| How login and conditions hide | **Left out of the page by the server**; screen-size visibility stays CSS |
| Where | Everything the builder edits: pages, articles, headers, footers, product layouts, modals, working pages, Kaizen's pages |
| Builder | **Like Beaver**: device icon by each field switches the whole canvas; top bar with breakpoint, width × height, zoom and Exit; hidden parts faded with an eye |
| Typography | **Beaver's full panel** on every component with text, per size |
| Old phone switches | **Folded into the new system**; saved pages look the same |
| Animation | Entrance effects (D128) get **delay and duration** |

## 2. Screen sizes

- `BREAKPOINTS` in `src/lib/breakpoints.ts`: `xl`, `lg`, `md`, `sm` with labels Extra large, Large, Medium, Small.
- Default widths keep every saved page as it is today (Kaizen's phone < 768, tablet 768–1023, computer ≥ 1024):
  **Small < 768, Medium 768–1023, Large 1024–1279, Extra large ≥ 1280.** (Beaver's own defaults are 768/992/1200;
  ours differ so nothing moves.)
- A store sets its own in Design settings (`ThemeSettings.breakpoints`, part of the theme, so design profiles and
  store templates carry them); Kaizen's in its own design settings. Checked: rising, at least 320 px apart, 480–2560.
- One function gives the queries: `breakpointQueries(theme)` → `@media (max-width: …)` for the site and
  `@container kz-page (max-width: …)` for the builder's canvas (section 5).

## 3. The model

- **Per-size values are overrides.** A part's settings as today are its Extra large values; `PartBase.at?: { lg?,
  md?, sm? }` holds, per smaller size, only the settings that differ (the same keys and the same zod schemas made
  partial: spacing, typography, widths and heights, column widths and order, gaps, grid columns, image size, carousel,
  background, border, corners, shadow, and from D180 text colour and opacity). Reading a value at a size walks up:
  `sm → md → lg → base` (`valueAt(part, key, size)`, one pure function in `src/lib/responsive.ts`).
- **One CSS writer.** Today `frameStyle()` and friends draw settings as inline styles, which media queries cannot
  override. Every setting that can vary by size moves to a stylesheet of rules by part id
  (`.kz-{partId}` classes; `partRules(content)` → `renderPartCss(rules, queries)`), drawn once per page in
  `<style>` next to `<CustomCss>`. Settings that never vary stay inline. The class is always present, so owner CSS
  and the replicator's rules keep their hooks.
- **Visibility** (`PartBase.visibility?`): `hideAt?: Size[]` (CSS, `display: none` at those sizes) and `show?:
  "always" | "never" | "signedIn" | "signedOut" | { rules: ConditionGroup[] }` (server, section 6).
- **Old switches folded in** by one upgrade on read, like `upgradeLegacy` (`upgradeResponsive()`, run by `pageInput`
  and by every reader, so the stored JSON changes only when a page is saved):
  `hideOnPhones` → `hideAt: ["sm"]`; `stackOnPhones` / `reverseOnMobile` / `carouselOn: "phones"` → `at.sm` values;
  `GridColumns { mobile, tablet, desktop }` → base = desktop, `at.md` = tablet, `at.sm` = mobile;
  `TextAlignments` (today smaller-to-larger) → explicit values per size, then reduced to overrides larger-to-smaller.
  A property test holds: for every saved shape, the old and the upgraded settings give the same value at every width.

## 4. Typography panel and animation

- One `Typography` settings group on every component with text (and on rows and columns, which pass it down): family
  (installed fonts, D59), weight, size with unit (px, em, rem, %, vw), line height (unitless or px), alignment, letter
  spacing, transform, decoration, style, variant, text shadow (colour, x, y, blur). Every key can vary by size.
  Blocks with several kinds of text (an accordion's titles and bodies, a testimonial's quote and name, a grid tile's
  title, text and price, a form's labels) get a group per kind. `blockFonts()` still lists every family used.
- Entrance effects (D128) take `delay` (0–10 s) and `duration` (0.1–5 s) as `--fx-delay`/`--fx-duration`; reduced
  motion still shows content at once, and the failsafe still reveals it.

## 5. The builder

- **Responsive mode.** A device icon beside every field that can vary; clicking it switches the whole builder to that
  size (Beaver's behaviour), as does a breakpoint menu in a top bar with width × height, zoom (50–100 %) and Exit.
- **Fields at a size** show the inherited value as a placeholder and a small "set here" mark; clearing one goes back to
  inheriting. Editing at Extra large edits the base value.
- **The canvas at a size.** The canvas is the page root `kz-page` with `container-type: inline-size`, set to the
  size's width; the part rules, the blocks' own layout classes and the owner's CSS are written with container queries
  in the canvas and media queries on the site (`breakpointQueries()`; `ScopedCss` rewrites the owner's `@media
  (max-width|min-width)` to `@container` in the canvas only). Blocks' fixed Tailwind breakpoints (`md:`, `lg:`) that
  shape layout are moved onto the store's breakpoints (container variants on `kz-page`), so the canvas and the site agree.
- **Hidden parts** stay on the canvas, faded, with an eye: blue for Never, signed in or signed out, red for conditions,
  grey for hidden at this size. A toolbar switch shows or hides them; the outline lists them.
- Parts saved for reuse, globals (D98), templates (D125) and A/B versions (D148) carry the new settings like any
  other; `partChanges()` compares them; `copyRow()` and co. copy them.

## 6. Visibility by sign-in and conditions

- **Server-side.** A part whose `show` is not `always` is drawn by `<VisiblePart>`: `never` draws nothing on the
  site; the others are a `<Suspense>` hole that reads the request's facts and draws the part or nothing. The page
  around it stays cached and prerendered (cacheComponents). Nothing hidden this way is in the HTML.
- **Facts** (`visitorFacts()` in `src/server/visibility.ts`, once per request through `perRequest()`):
  signed in (store: `customer_sessions`; Kaizen: `getAccount()`), customer group, company account, business or
  private buyer, has bought before (paid orders, `restricted_at is null`), market country, language, currency, the
  store's local date, weekday and hour, cart value (as shown) and contents (product ids, categories), and a query
  parameter's value. No new cookie or storage; nothing is recorded.
- **Rules** (`src/lib/visibility.ts`, pure, tested): `ConditionGroup[]` (OR between groups, AND within), each
  condition `{ fact, op, value }` from a closed list with zod; values that name ids (groups, products, categories)
  are checked against the store when saved, dropped by `sanitizeTemplate()`/`template-content.ts` and the store-copy
  rules when a part crosses to another store, and shown as "removed" if the thing is deleted. Kaizen's pages offer
  only the facts that exist there (signed in, language, time, address).
- **Limits and costs.** At most 30 conditional parts a page; each is one small per-request read. Working pages and
  pay routes keep their rules (no conditions inside the checkout's payment piece). Search engines see what a
  signed-out visitor sees.

## 7. Phases

1. Model, `upgradeResponsive()`, breakpoints in the theme, the CSS writer and the move from inline styles; a
   Playwright parity check of the seeded pages at 375, 800, 1100 and 1400 px (computed styles before and after).
2. Builder: responsive mode, device icons, fields at a size, container-query canvas, hidden parts faded.
3. Typography panel and animation delay and duration.
4. Visibility: sizes (CSS), Never, signed in and out, conditions with the rule builder and server holes.
5. The replicator writes phone values as `at.sm` instead of a media query in the page's CSS (optional, after).
6. Docs (this file to "built", CLAUDE.md, `docs/decisions.md` D179), parity rows if any apply.

## 8. CI

Page content is JSON in `pages.draft`/`published` and the theme in `stores.theme`, so **no migration is expected**.
Each push touching code runs CI: without a migration it deploys at once and the checks report beside it, so every
phase is verified locally first (lint, typecheck, unit, integration on a fresh database, build, e2e). This file alone
runs nothing.
