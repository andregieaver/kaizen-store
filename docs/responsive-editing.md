# Responsive editing and visibility in the page builder (proposed D179)

Status: **phases 1 and 2 built** (phase 1: the model, the upgrade of saved pages, screen sizes in the theme and the part
stylesheet, section 9; phase 2: the builder's responsive mode, fields by size, visibility by size and the theme's screen
sizes, section 10). Phases 3–6 are not started. Agreed with the owner on 8 October 2026; built after D178
step 6, and before text colour and opacity (`docs/text-colour.md`, proposed D180). The model is Beaver Builder's: a value per
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
  store templates carry them); Kaizen's in its own design settings. Checked: rising, at least 160 px apart (`BREAKPOINT_GAP`; 320 could not hold the defaults, 256 apart), 480–2560.
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

## 9. Phase 1, as built

- **Screen sizes** (`src/lib/breakpoints.ts`): `SIZES`, `DEFAULT_BREAKPOINTS` (`md` 768, `lg` 1024, `xl` 1280: where
  Medium, Large and Extra large start), `breakpointsProblem()`/`breakpointsSchema`, `breakpointsOf()` and
  `breakpointQueries(theme, "media" | "container")` (`upTo` per smaller size, `only` per size; range syntax, `(width <
  768px)`). `ThemeSettings.breakpoints` is optional, every theme template carries the defaults, and `parseStoreTheme()`
  drops unusable widths alone (the rest of the theme is kept). The server reads a page owner's with `breakpointsFor()`
  (`src/server/breakpoints.ts`; Kaizen's pages take the defaults). There is no field to change them yet (phase 2); the
  rule of at least 320 px apart became 160 px, as the defaults that keep saved pages are 256 px apart.
- **The model** (`src/lib/responsive.ts`, `PartBase.at`, `PartSizeSettings`, `PartBase.visibility.hideAt`):
  `valueAt()`, `spacingAt()` (margin and padding walk on their own), `stackAt()` (a row stacks on Small unless set),
  `withAt()`, and the editor's present switches written in the new shape (`sideBySidePatch()`, `reversePatch()`,
  `hideOnPhonesPatch()`, `alignView()`/`alignPatch()`, `columnsView()`/`columnsPatch()`, `displayPatch()`), until the
  per-size editor of phase 2. `pageInput`'s schemas take `at` as the same rules made optional, and drop empty sizes.
- **The upgrade** runs as a `z.preprocess` on `pageRowSchema`, `pageColumnSchema` and `pageBlockSchema`
  (`upgradeRow()`/`upgradeColumn()`/`upgradeBlock()`; `upgradeResponsive()` does a whole page at once), so every reader
  that parses (pages, saved parts, globals, templates, page layouts, A/B versions, design profiles, the AI studio and
  the replicator's output) sees the new shape, and the stored JSON changes only on the next save. Folded:
  `sideBySide` → `stack: false` and `at.sm.gap: 8` (rows kept side by side were `gap-2 md:gap-8`); `reverseOnMobile` →
  `at.sm.reverse`; `hideOnPhones` → `visibility.hideAt: ["sm"]`; `stackOnPhones` → `at.sm.stack`; `carouselOn: "phones"`
  → `at.sm.display: "carousel"` with no base display; `GridColumns` → `columns` plus `at.md`/`at.sm` where they differ;
  `TextAlignments` → `align` plus `at.md`/`at.sm`, a screen with nothing set under a larger one set reading `left`.
  A value the old shape could not hold is left for the schema to refuse, as before. `responsive.test.ts` holds, for
  every alignment (64), every grid's columns, every row layout with every switch, and the phone switches, that the
  value at 375, 800, 1100 and 1400 px is the same read the old way and from the upgraded settings.
- **The part stylesheet** (`src/lib/part-css.ts`, drawn by `PartStyles` in `src/components/part-styles.tsx` beside every
  row `PageRowView` draws — pages, articles, headers, footers, product layouts, modals, working pages and Kaizen's pages —
  and by `CanvasPartStyles` in the builder): `rowStyle()`, `rowGridStyle()`, `columnStyle()`, `blockStyle()`,
  `gridListStyle()`, `partRules()`, `renderPartCss()`. Each element keeps `kz-{id}` (the stable hook for owners) and
  gets a class named by a hash of what its rules say (`kzr-…`), so the same id on two pages (a copy, an A/B version, a
  page kept hidden after client navigation) never takes the other's rules. To keep the cascade exactly as it was, what
  was an inline style is written `:where(.kzr-…){…!important}` (beats every normal rule, loses to every important one,
  as an inline style does), and what was a Tailwind class is `:where(.kzr-…){…}` unlayered (gives way to any page rule
  with a selector, beats the utilities). A property a larger size sets and a smaller one does not is given back with
  `revert-layer`. The stylesheet is a `<style href precedence>` (React hoists it and writes each once). The canvas is a
  `kz-page` inline-size container and its rules are container queries; hidden parts and the phone's menu button are
  hidden on the site only.
- **Moved off inline styles and fixed breakpoints**: rows' spacing, frame, colour and backdrop blur; rows' columns
  (stacking, reversing, gap, widths, order, alignment); columns' spacing, frame and colour; blocks' spacing and frame
  (a button's on `[data-button-frame]`), a picture's `--picture-width` and place, alignment (and a menu's links,
  `kz-menu-justify`), hidden at a size, a dual button's stacking, related products' and testimonials' columns, a
  content grid's columns and gap (`--grid-cols`, `--grid-gap`) and its carousel at some sizes only (laid out as a grid
  elsewhere, its controls hidden), and a modal panel's frame.
- **Left on the window's fixed breakpoints** (equal to the defaults, so only a store with its own sizes or the canvas
  sees them differ): heading and article title sizes (`md:text-*`, typography is phase 3), Tailwind's `sm:` (640 px) in
  field loops, custom fields and Kaizen's plans, the product listing's own grid, the product gallery's arrows, the
  standard header's menu button and `globals.css`'s carousel fallbacks (`--grid-mobile`…). The canvas's own window
  classes are phase 2.
- **Parity** (`e2e/responsive-parity.spec.ts`): a store's front page, an "about" page, a page of every old switch (rows
  of five layouts, reversed, side by side, equal height, columns with frames and colours, alignments by screen,
  pictures placed by screen, content grids and a carousel on phones only, a dual button, testimonials in a grid and a
  carousel), a header and a footer of site parts and menus hidden on phones, a product layout with related products,
  and Kaizen's front page, each at 375, 800, 1100 and 1400 px: every element's box and 31 computed properties
  (display, position, paddings, margins, borders, radius, shadow, background, backdrop filter, text-align,
  flex-direction and wrap, order, grid-template-columns, align-items, justify-content, gaps, max-width), captured from a
  build of `origin/main` before the change and compared with the build after: 3,512 elements, 108,872 values, no
  difference. The same spec holds a store with the pages in the old shape against one with them upgraded.

## 10. Phase 2, as built

- **Responsive mode** (`src/components/admin/responsive-edit.tsx`, wired in `PageBuilder`): off, the builder edits Extra large
  and the canvas is as wide as the column, as before. The toolbar's **Responsive** button, Ctrl or Cmd + Shift + R (not while
  typing in a field) or any field's device icon turns it on; a bar over the canvas (`ResponsiveBar`) then has the size (a
  menu of the four, with their pixel ranges), the canvas's width (typed, kept within the size: `sizeRange()`, `clampWidth()`)
  × height, a zoom of 50–100 % and **Exit**. A size opens at a typical screen's width and height (`TYPICAL_SCREENS`: 1440 ×
  900, 1100 × 800, 820 × 1180, 390 × 844; the middle of the size where a store's own widths leave the typical one out,
  `typicalWidth()`), zoomed to fit the column until a zoom is chosen (`fitZoom()`). The state is the builder's only
  (`useResponsiveMode()`); fields read the size from `SizeEditContext` (`useSizeEdit()`).
- **The canvas at a size**: the page (`kz-page`) is given the width and the section around it CSS `zoom`, inside a frame of
  the height that scrolls, so phase 1's container queries see exactly the size's width. Owner CSS on the canvas has its
  width-only `@media` rules turned into `@container kz-page` ones (`containerCss()` in `src/lib/custom-css.ts`, through
  `ScopedCss`'s `container`; strings, comments, lists, `not` and other features are left alone); the site keeps the CSS
  as written. Parts hidden at the size stay on the canvas, faded, with a grey eye (`HiddenBadge`), or left out with the
  toolbar's **Hidden parts** switch (`canvasHiddenCss()` in `src/lib/part-css.ts`: container queries on `data-builder-id`,
  so they follow the size shown even outside responsive mode).
- **Fields at a size**: every field `at` takes has a device icon (`SizeMark`/`SizeSwitch`): spacing (margin and padding
  apart), border, corners, shadow, a row's or column's colour and backdrop blur, a row's columns side by side or one under
  another, last first and the space between them (`RowSizeFields`), a column's share and place (`ColumnSizeFields`; new
  `PageColumn.width`/`order` are its Extra large values), alignment and a picture's position (`TextAlignFields`), a
  picture's width (`ImageSizeFields`), a grid's columns, gap and grid or carousel (`GridDisplayFields`, `ColumnsFields`),
  related products' columns and a dual button's stacking. At Extra large a field edits the part's own value; below it, the
  pure helpers in `src/lib/responsive.ts` write the size: `setAt(part, size, patch)` (only what differs from what the size
  inherits, an equal value takes the override away, "none" over an inherited border, shadow, colour, blur or width is
  `null`, no spacing over inherited spacing is zeros, square corners are 0; settings that never vary go to the part),
  `clearAt(part, size, field)` (the × that gives an override back), `sizeSource()` (the "From Large" note, or the size's
  own mark) and `viewAt()` (what the fields show at the size). An inherited value is shown greyed (`inheritedClass()`). A
  picture, video or gradient background is the part's own at every size; below Extra large the background is a colour or
  none (`BackgroundAtSize`). `at`'s schema takes `null` for those five settings.
- **The old phone switches are gone from the dialogs** (side by side and reversed on phones, one under another on phones,
  carousel on phones only, columns per phone, tablet and computer, alignment per screen, hide on phones): their places are
  the fields above at Small, and the Advanced tab's **Visibility → Breakpoint** (`VisibilityFields`: four device buttons,
  pressed where the part shows, `visibilityPatch()`), offered on rows (not modals), columns and blocks; the withdrawal link
  (D153) and the phone's menu button cannot be hidden there. Display (always, never, signed in, conditions) is phase 4 and
  has its place marked in `VisibilityFields`. Hidden rows and columns are now left out on the site too (`hiddenRules()` in
  `rowStyle()`/`columnStyle()`; blocks were in phase 1), so nothing changes on a saved page until an owner hides one.
- **Screen sizes in Design** (`BreakpointFields` in `ThemeEditor`): Medium from, Large from and Extra large from, checked by
  `breakpointsProblem()` as typed (Save waits for usable widths) with a button back to the standard sizes. Design profiles'
  snapshots carry them as part of the theme (held by `responsive-copies.test.ts`). **Kaizen's own pages have no editor**:
  Kaizen has no theme, and `platform_settings` has no place for them without a migration (or putting them in another
  setting's column); its pages keep the defaults (`breakpointsFor(null)`). A follow-up adds a `breakpoints` jsonb column
  or a design settings page for Kaizen.
- **Copies**: duplicating, saved parts, templates (`sanitizeTemplate()`), globals and their uses and A/B tests of a part
  (`partChanges()`/`applyPart()`) keep `at` and `visibility` as they are (`src/lib/responsive-copies.test.ts`); there is no
  copy-and-paste of styles in the builder to carry them.
- **Tests**: `src/lib/responsive-edit.test.ts` (the helpers, the canvas's widths and zoom, the hidden parts' rules, the
  `@media` → `@container` rewrite), `src/components/admin/responsive-edit.test.ts` (the bar, a field at a size with its
  icon, note and ×, Visibility, the toolbar and canvas, the shortcut, the theme's widths, drawn with `renderToString`),
  `image-size-fields.test.ts` (a picture's width and position at a size). There is no e2e of the builder: e2e has no admin
  sign-in. `e2e/responsive-parity.spec.ts` still holds the site unchanged, also against a capture of phase 1's build
  (4718782): 20 page widths, 3,544 elements, 109,864 values, no difference.
- **Still on the window's breakpoints in the canvas**: Tailwind's `md:`/`lg:`/`sm:` classes inside blocks (heading and
  article title sizes, field loops, custom fields, Kaizen's plans, the listing's grid, the gallery's arrows, the standard
  header's menu button) follow the admin's window, not the canvas, so at Small in a wide window a heading keeps its large
  size there. Heading sizes move to the part rules with typography (phase 3); the rest to container variants after.
