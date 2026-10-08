# Responsive editing and visibility in the page builder (proposed D179)

Status: **phases 1 to 4 built** (phase 1: the model, the upgrade of saved pages, screen sizes in the theme and the part
stylesheet, section 9; phase 2: the builder's responsive mode, fields by size, visibility by size and the theme's screen
sizes, section 10; phase 3: the Typography panel on every text, components' breakpoints on the store's sizes, and the
entrance's delay and duration, section 11; phase 4: Display by sign-in and conditions, left out by the server, section 12).
Phases 5 and 6 are not started. Agreed with the owner on 8 October 2026; built after D178
step 6, and before text colour and opacity (`docs/text-colour.md`, D180, built since). The model is Beaver Builder's: a value per
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
  size there. Heading sizes move to the part rules with typography (phase 3); the rest to container variants after. (Both done in
  phase 3, section 11.)

## 11. Phase 3, as built

- **The model** (`src/lib/typography.ts`): `Typography` (family, weight 100–900, size with unit px, em, rem, % or vw, line
  height unitless or px, alignment, letter spacing in px or em, transform, decoration, style, variant, text shadow with
  colour, x, y and blur) and its schemas (`typographyGroupsSchema`, `typographyAtSchema`, limits per unit), held per kind of
  text (`TextRole`: text, heading, title, body, excerpt, price, quote, name, meta, label, value, input, button, badge,
  message, caption) on `PartBase.typography`, with a size's own in `at.{size}.typography` (a shadow may be `null` there).
  Read key by key, smaller to larger (`typographyAt()`, `typographyValueAt()`), like spacing. Colour and opacity joined it in D180 (`docs/text-colour.md`).
- **Every text has a size** (the owner's addition): `textRoles(part)` gives each component's kinds of text and the element
  each is written on (a selector, with `data-kz-text` marks where none names it: grid titles, excerpts, prices, badges,
  details and buttons; testimonials' names and titles; social networks' names; plans' names, prices, features and
  buttons; field loops' titles, texts, badges and links; custom fields' labels and values). `TEXT_FIELDS` names the kind of
  every text `mapBlockTexts()` lists and of the texts a component draws that are not the page's words; `UNDRAWN_TEXTS` the
  few never drawn as words (alt texts, a video's and HTML frame's title, a form's email subject). `typography.test.ts`
  walks every block type filled with every text and fails for a text without a kind, a kind without a group, or a group
  whose size the stylesheet does not write. Texts that had no size setting before: buttons' and dual buttons' labels,
  image captions, accordion, tab and FAQ titles and bodies, testimonials' quotes, names and titles, icon list lines, social
  networks' names, forms' labels, fields, hints, choices, buttons and thank-you texts, the newsletter's, a grid's excerpts,
  prices, badges, details and buttons (titles had a preset), field loops' slots and headings, custom fields' labels, values
  and headings, plans' names, prices, features and buttons, menu links, the search box, site parts, product parts'
  words and headings, shop components, and rows' and columns' text. Components drawn from the site's own pieces (a
  menu, a site part, a product's parts, the search) take a size set as the size of all they draw (`flatten`:
  `font-size: inherit` below them), so their pieces' own sizes give way.
- **The upgrade** (`foldTypography()`, run after `upgradeBlock()` by `pageBlockSchema` and `upgradeResponsive()`): a heading's
  `size` (a preset), `weight` and `align`; `font` on every block (an image's is its caption's); a grid's `headingSize` and
  `headingFont` (its titles'); an accordion's and FAQ's `titleSize` (size and line height, as the class had); a button's and
  dual button's `weight`; rich text's and the aligned product parts' `align` (and their `at.*.align`); a product title's
  `size`. A preset is Tailwind's size from Medium up and on Small (`HEADING_PRESETS`, `presetTypography()`), its line height
  in pixels where the element had none of its own. A value the old shape could not hold goes with its key for the schema to
  refuse, as before. Old fields are gone from the types, the schemas and the dialogs.
- **Drawing** (`typographyRules()` in `src/lib/part-css.ts`, in `rowStyle()`, `columnStyle()` and `blockStyle()`): each role's
  settings on its element as `:where()` outside any layer (what was a Tailwind class: beats the utilities, gives way to any
  rule of the page, so owner CSS and the replicator's `#id` rules still win); rich text's and panel bodies' on `.rich-text`
  with the part's class, to win over its line height. Alignment of a text role whose alignment was the block's is on the
  block, as before. A heading's size by its level where none is set is written here by the store's screen sizes
  (`headingDefaultSize()`, Tailwind's `md:` before). A family at Extra large is its stylesheet's class (`boxFamilies()` on
  the part, `familyClassOf()` for a grid's titles), as before; a family that differs by size, or of a role with no class,
  is a rule with the part's class doubled (beating the class) and the system's sans serif as its fallback while loading
  (the rule does not know the family's kind; the class does). `pageFonts()` lists rows', columns' and every size's
  families, so saving installs them (D59) and `FontLinks` loads them (the page article draws rows' and columns' too).
- **Breakpoint classes** (`BREAKPOINT_CLASSES`, `breakpointClassCss()`): `kzb-md-…` and `kzb-lg-…` classes in place of
  Tailwind's `sm:` (now Medium, 768 px by default, from 640), `md:` and `lg:` in field loops, custom fields, Kaizen's plans,
  tabs' titles, testimonials, an article's title, the product listing's grid, the gallery's arrows, the standard header's
  menu button, account link and country choice and a site part's menu button, and the carousel's fallback columns
  (`globals.css`'s `@media` rules). Drawn by `BreakpointSheet` with the store's screen sizes beside the part stylesheet
  (`PartStyles`), in the store's head (`StoreThemeStyles`) and Kaizen's layout, and as container queries on the canvas
  (`CanvasPartStyles`), so the canvas at a size shows them right. Other storefront chrome (cart, checkout, account pages)
  keeps Tailwind's breakpoints.
- **The builder**: `TypographyFields` (`src/components/admin/typography-fields.tsx`) in every Style tab (rows, columns and
  every component with text), a folding group per kind of text, each with Font (family through the font picker, which
  installs it, weight, size and unit, line height, align where the component's Position does not place it), Style &
  spacing (letter spacing, transform Normal/Tt/TT/tt, decoration, style, variant) and Text shadow (colour, x, y, blur);
  every setting has its device icon (`TypoMark`), where it comes from at the size, greyed while inherited, and a × that gives
  a size's own back (`typographyPatch()`, `typographySource()`, `clearTypographyAt()`). The old Size, Weight, Text
  alignment and Font fields are gone (a button's, menu's, picture's and dual button's Position stays).
- **Animation** (D128): an entrance's `delay` is 0–10 s (was 2 s) and `duration` 0.1–5 s (new, over its speed), in
  milliseconds on the entrance, drawn as `--fx-delay` and `--fx-duration` by `partFx()`; `motion.css` takes `--fx-dur` from
  `--fx-duration`, registered as not inherited (`@property`), so a child never takes a parent's. Reduced motion, the
  no-script rules, the failsafe and the first row's rules are unchanged. The Advanced tab's **Animation** has Delay and
  Duration in seconds (`AnimationFields`); the Motion tab's delay slider is gone. A motion plan never sets a duration, keeps
  its delays as it did, and never touches an entrance the owner set (`applyMotionPlan()` fills empty slots only).
- **Copies, templates, tests and AI**: typography is part of the part, so copies, saved parts, globals, templates, A/B
  versions and design profiles keep it (`responsive-copies.test.ts` holds typography too); a template's families are
  installed when the page using it is saved, as before. The AI page studio writes its headings' looks through
  `headingLook()` and rich text's alignment through `alignTypography()`; the replicator writes measured families as
  typography and a grid's title preset with `presetTypography()`, and keeps measured sizes and letter spacing in the page's
  CSS (its `.rp.rp` rules win over typography anyway; moving them is not trivial and is left). `pageIssues()` reads levels,
  words and colours, which typography does not touch.
- **Tests**: `src/lib/typography.test.ts` (every text has a size; the property tests of every heading level × preset ×
  weight × alignment by screen, every title preset, every weight and font, at 375, 800, 1100 and 1400 px, against the old
  classes; drawing; editing; families), `src/components/admin/typography-fields.test.ts` (the panel and Animation),
  `motion-*.test.ts` (delay and duration).
- **Parity**: `e2e/responsive-parity.spec.ts` also captures font-size, font-weight, line-height, letter-spacing,
  text-transform, font-family, text-shadow, font-style and text-decoration-line, and draws a page of every old text setting
  (headings of every level and preset, weights, fonts, aligned rich text and buttons, accordions, FAQs, tabs, grids with
  title presets and fonts, testimonials, icon lists, social links, a menu), the product title with a preset, the product
  listing, and a store with the standard header and footer (its front page, listing and a product). Captured from a build of
  `origin/main` (c92fcd5, phase 2) on its own fresh database and compared with the build after: 40 page widths, 6,967
  elements, 278,680 values, no difference; the old shape against the same pages upgraded (now with `foldTypography()`) is
  the same too. The parts' stylesheet comes after the site's (`next`) and before the theme's and the fonts' in the head,
  which the `:where()` rules and the doubled class of a family by size rely on.

## 12. Phase 4, as built

- **The model** (`src/lib/visibility.ts`, pure): `PartBase.visibility.show` is `"never" | "signedIn" | "signedOut" | { rules:
  ConditionGroup[] }`, Always being nothing set (the schema drops `"always"`). `ConditionGroup` is `Condition[]`: OR between
  groups, AND within one (`showsFor()`, `conditionHolds()`). A condition is `{ fact, op, value }` from a closed zod union
  (`showSchema`, `conditionProblem()` for what the shape cannot say: a date's start before its end, two different times of
  day, a cart value's amounts, a parameter's value for is, is not and contains, a company's yes or no against its ids). At
  most 10 groups of 10 conditions, 50 choices in a condition, and **30 parts a page** shown by sign-in or conditions
  (`CONDITIONAL_PARTS_MAX`; Never is not counted), held by `pageInput` (`displaysProblem()`).
- **Facts and operators** (`FACTS`, `FACT_INFO`): visitor — signed in (is), customer group (is one of, is none of: tier
  ids), company account (is yes/no, or is one of / none of: company ids), buys as (is, is not: business or private), has
  bought before (is); place and language — country, language, currency (is one of, is none of); time — date and time
  (between, either end open; from inclusive, until exclusive), day of the week (is one of, is none of), time of day
  (between; a start after the end runs over midnight); cart and address — cart value (at least, at most, between), cart
  contains product, cart contains a product in category (is one of, is none of; a category's parents count), address
  parameter (is, is not, contains, is present, is not present). Times are local to the store's time zone
  (`stores.time_zone`; Kaizen's pages Europe/Oslo), compared as local `YYYY-MM-DDTHH:mm` strings, so a date or hour in the
  hour daylight saving skips never matches and one in the hour it repeats matches both times. A cart value is compared in
  minor units: written in a currency, it is held against the cart's shown currency by the store's rates without rounding
  (`conversionFactor()`); a currency without a rate never holds. A fact the place does not have (Kaizen's pages have no
  shop, a header no address) is null, and a condition on it never holds, whatever its operator. A condition left choosing
  no ids (a group deleted since) holds for nobody with "is one of" and for everybody with "is none of".
- **Where each fact can be asked** (`factsOffered()`, `displayFactsProblem()` in `pageRulesProblem()`): Kaizen's pages offer
  signed in (the admin, `getAccount()`), language, the three of time and the address parameter (`KAIZEN_FACTS`). The
  **address parameter** is offered on pages only: their routes hand the address to the page as a promise
  (`GridPlace.listing.query`, `GridPlace.route.query` on working, category and tag pages, the new `GridPlace.query` on
  Kaizen's pages), awaited only inside the part's hole, so the page stays prerendered. A header or footer is drawn by the
  layout, which has no address parameters, and articles and product layouts are drawn without them; reading them there
  would make every page dynamic, so the fact is not offered (nothing was dropped from the owner's list otherwise).
- **The server** (`src/components/visible-part.tsx`, `src/server/visibility.ts`): `PageRowView` and `RowMarkup` draw every
  row, column and block through `<VisiblePart>` — pages, articles, headers, footers, product layouts, modals, working pages
  and Kaizen's pages. Always draws the part; Never draws nothing; signed in, signed out and conditions are a `<Suspense
  fallback={null}>` hole whose `Shown` awaits `visitorFacts(place, show)` and draws the part or nothing, so the page around
  stays cached and prerendered and a hidden part's words are nowhere in the HTML or the RSC payload (the e2e reads the
  whole response). `visitorFacts()` calls `connection()` first (time and sign-in are the request's), reads only the facts
  the rule asks about, each kind once per request through `perRequest()`: the store's customer session (`getCustomer()`,
  `customer_sessions`), the customer's groups (`customerTierIds()`, as campaigns read them), company (only while it is on,
  selling to businesses is on and they are its owner or employee), has bought before (`bought` of `customer-admin.ts`: a
  paid, never copied order of the customer with `restricted_at is null`, D162), the buyer (`getBuyer()`), the market from
  the place (`marketIn()`), the store's time zone and rates, and the cart (`getCart()`: lines that can be bought, at the
  shown price, without VAT for a business buyer, before shipping and discounts; products and their categories with their
  parents). Nothing is written, no cookie or storage is set (no `KNOWN_COOKIES` entry), nothing is recorded, and no table
  was added, so the personal-data register (D162) and `COPY_RULES` are unchanged. A search engine has no session and no
  cart, so it sees what a signed-out visitor sees. The admin's previews of a draft (`inAdmin`) draw every part but a Never
  one. A heading in a part some visitors do not see is not the page's main heading (the title stays, for screen readers).
- **What the page says about itself** reads only what every visitor sees (`publicRows()`, `readByAnyone()`: Always only):
  the description when none is written (`pageExcerpt()`: meta, Open Graph, structured data, grids of pages,
  recommendations) and the chat agent's knowledge (`pageKnowledgeText()`), so a members' paragraph or a Never draft never
  leaks there. (Found by the e2e: the first build had the hidden words in the meta description.)
- **What must show to everyone**: the checkout, its payment form and its terms (`storePart` `checkout`,
  `checkout_payment`, `checkout_terms`, D158) and the withdrawal link (D153) cannot take a display, nor the row and column
  that hold them (`displayLocked()`; the builder disables the select and says why). Other pieces of the pay routes may
  (a part shown only to businesses on the cart page); the hole imports nothing in `FORBIDDEN_ON_PAY_ROUTES`.
- **Ids in rules** (tier, company, product and category ids): `savePage()` keeps only the store's own (`keepOwnRuleIds()` →
  `ownRuleIds()`: its groups, companies, products not archived and product categories); a template, a page layout and a
  design profile drop them all (`sanitizeTemplate()` → `withoutRuleIds()`, so `snapshotLayout()` too), keeping the
  conditions with nothing chosen. A store copy (`clone_store()`, `duplicate_store()`, `clone_page_content()`) copies the
  JSON in SQL: category ids are remapped already (it swaps every term id it knows), groups and companies are never copied,
  and products get new ids, so their ids in the copy are not the new store's — they never match a cart (facts come only
  from the store's own rows), show as **Removed** in the builder, and go on the next save. Remapping products in the copy
  itself needs a migration (`clone_page_content()` swaps term and menu ids only) and was not done. The builder marks any id
  the store's lists no longer hold as Removed, with a × to take it out.
- **A/B tests and copies**: a display is part of the part, so duplicating, saved parts, globals, templates (less foreign
  ids), page layouts, design profiles and A/B versions keep it, and `partChanges()`/`applyPart()` compare and copy it
  (`responsive-copies.test.ts` holds it with a display of each kind). A part under test may carry conditions.
- **The builder** (`src/components/admin/display-fields.tsx`): the Advanced tab's Visibility has **Display** under
  Breakpoint (`DisplayFields`: Always, Never, Signed-out visitors, Signed-in visitors, Conditional logic); a modal row has
  Display alone. Conditional logic opens the rule builder (`RuleBuilder`): groups joined by "Or", conditions joined by
  "And" (each with its fact grouped by Visitor, Place and language, Time, Cart and address, its operator and its value),
  "+ And" and "+ Or" buttons, the store's time zone above, each condition's problem under it. Values are the store's own:
  groups, companies (listed only for staff who may read customers, D158; others ask "has a company account"), products
  (with a search past eight), categories, countries, languages and currencies (`ruleChoices()`, through the page context's
  `visibilityChoices` action, `storeVisibilityChoicesAction` with the builder's read keys, loaded when the rule builder
  first opens and kept for the builder); dates and times are the browser's own pickers; a cart value is typed in the
  currency's major unit and kept in minor units. Kaizen's pages and a design profile's workspace have no choices action
  (Kaizen's offer only its facts; a workspace's ids would not reach a store). On the canvas every part with a display has
  an eye (`DisplayBadge`): blue for Never, signed in and signed out, red for conditions (`--chart-1` and `--danger`, the
  admin's tokens); a Never part is faded and the toolbar's **Hidden parts** switch leaves out every part with a display
  (`canvasHiddenCss()`); **Who sees what** (`DisplayLegend`) explains the eyes (blue, red, and phase 2's grey) and lists the
  parts, each opening its settings.
- **Tests**: `src/lib/visibility.test.ts` (shapes and refusals, every fact and operator, unknown facts, OR and AND, dates and
  hours in the store's time zone across both daylight-saving changes and midnight, weekdays across the date line, cart
  values at their edges and across currencies, the limits and the parts that must show, Kaizen's facts, ids found, kept,
  dropped by templates, and what a page says about itself), `src/components/admin/display-fields.test.ts` (the select, the
  lock, the rule builder with the store's choices and a removed id, the eyes, the legend, the canvas rules),
  `src/server/visibility.int.test.ts` (facts of a signed-in customer in a group and a company with a paid order and of a
  guest; a restricted order and a switched-off company; an expired session; the cart in a euro market, without VAT for a
  business, against amounts in euro and kroner; Kaizen's facts; ids kept on save; the builder's choices), and
  `e2e/visibility.spec.ts` (a store page with parts for signed-out and signed-in visitors, a column for signed-in ones, a
  Never part, a date that holds and one that ended, a country across Norway and Sweden and an address parameter; the
  whole HTML is read, signed out and with a customer session and its cookie). `e2e/responsive-parity.spec.ts` still finds
  saved pages unchanged against a capture of phase 3's build (4aa0759).
