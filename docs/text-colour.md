# Text colour and opacity in the page builder (D180)

Status: **built** (8 October 2026; section 6 is the record of what was built). Built after responsive editing
(`docs/responsive-editing.md`, D179), whose per-size values, CSS writer and Typography panel it uses. Sections 1 to 5 are
the plan as written; where the build went another way, section 6 says so.

## 1. The gap today

- Text colour exists only on headings, buttons (alone, in pairs, on grid tiles and forms), a social links block's
  custom colour, an icon list's icons, separator lines and a header lying over the page.
- No colour on: rich text, image captions, accordions, tabs, FAQs, testimonials, an icon list's words, forms and
  newsletters (apart from their buttons), content grid tiles' title, text and price, custom fields, field loops,
  plans, menus, search, and rows and columns themselves.
- No text colour anywhere has an opacity (only background colours and overlays do, 0–100).

## 2. What is built

1. **A text colour for every row, column and component**: `textColor` and `textOpacity` (0–100, solid when unset)
   on the settings every part shares, in the Style tab, with a value per screen size (D179). CSS `color` passes down,
   so every block, those added later included, follows its row or column unless it sets its own.
2. **A colour per kind of text** in blocks with several: an accordion's, tab's or FAQ's titles and bodies, a
   testimonial's quote, name and role, a grid tile's title, text and price, a form's labels, help and success text, a
   plan card's name, price and features, an icon list's words beside its icon colour, an image's caption. Each is a
   colour and an opacity in that block's Typography group.
3. **Colour in rich text**: a colour mark in the editor (`textStyle` with `color` and optional `opacity`), accepted
   by `cleanRichText()` only as `#rrggbb` and 0–100, drawn by `<RichText>` as a style, never as HTML. Inline markup
   (`src/lib/inline-text.ts`) keeps classes only.
4. **One colour field** for all of it: `ColorField` gains an optional opacity slider and the clear button and swatches
   of the theme's colours (as in the owner's screenshot); the stored value is always `#rrggbb` plus a number, and one
   helper (`colourCss(colour, opacity)`) writes the CSS colour. The heading's and buttons' existing colours gain the
   opacity, so saved pages keep working unchanged.
5. **The accessibility check counts opacity**: `pageIssues()` (`src/lib/page-a11y.ts`) blends the text colour with its
   opacity over the background before `contrastRatio()`, at every screen size where either differs, and walks down
   from a row's or column's colour to the blocks that inherit it. Faded text that is too light blocks publishing as
   today's contrast issue does.

## 3. Unchanged

Translation (a colour is not text), store templates and design profiles (no reference to another thing), store
copies, A/B tests (`partChanges()` compares settings already). The replicator may later write measured
semi-transparent text colours as colour plus opacity.

## 4. Tests

Colours and opacities accepted and refused when saving; the CSS written per size; the contrast check with opacity,
inheritance and per size; the rich text colour mark through `cleanRichText()` and `<RichText>`; an e2e check that a
colour reaches the live page at two sizes.

## 5. CI

No migration (page content is JSON). A push with code runs CI and deploys at once, so it is verified locally first.

## 6. As built

- **The model** (`src/lib/typography.ts`): `color` (`#rrggbb`) and `opacity` (a whole number 0–100, solid unless set) are
  two more `Typography` keys, so every kind of text of every component, row and column has them, per screen size through
  `at.*.typography` and walked key by key like the rest (`typographyAt()`). The plan's `textColor`/`textOpacity` on the
  shared settings became the `text` group's `color` and `opacity` on rows and columns, which is the same thing in D179's
  model. An opacity acts on the colour of its own group at that size (`colourAt()`); an opacity with no colour anywhere draws
  nothing (the slider is off until a colour is chosen). The schemas accept only these shapes (`hexColour`, `opacityValue` in
  `src/lib/colour.ts`).
- **One helper** (`src/lib/colour.ts`): `colourCss(colour, opacity)` writes the colour itself when solid, else
  `color-mix(in srgb, colour N%, transparent)`, as backgrounds always were; `colorDecl()` in `part-css.ts` (rows' and
  columns' colour backgrounds) and the rich text mark use it too. `blend()` is what the checker reads a see-through colour as
  over a solid background. A picture's or video's overlay keeps its element opacity (`PartBackground`): the same look by
  another route, and changing it would move every saved page's computed `opacity` and `background-color`.
- **Drawing** (`typographyRules()` in `src/lib/part-css.ts`): each role's colour is a rule of its own on the role's
  element, `:where()` with `!important` — what an inline style was: it beats every normal rule (a button's `text-accent-
  foreground`, a theme's rule) and gives way to every important rule of the page, so owners' CSS and the replicator keep
  their place. A row's or column's is on the part and passes down by inheritance to text that sets none (an element with a
  colour class of its own, such as a button or a grid's details, keeps its own). Components that draw the site's own pieces
  (`flatten`: a menu, a site part, a product part, the search) take a colour set as the colour of all they draw but their
  buttons (`color: inherit` below them, `FLATTEN_KEEPS`).
- **A dual button** has two more kinds of text, `first` and `second` (`data-kz-text`), each its own colour as each had its
  own text colour; the shared "Buttons' text" group's colour reaches both through `colourFrom`, and is not written on its own
  selector (`colour: false`), so a size's own colour of one button always wins over a shared one, whatever the size.
- **Folded on read** (`foldTypography()`, run by every block schema and `upgradeResponsive()`): a heading's and a button's
  `textColor` (into `text.color`), each of a dual button's `first.textColor`/`second.textColor` (into `first`/`second`), a
  content grid's, an email form's and a newsletter's `button.textColor` (into `button.color`). `textColor` is gone from the
  block types, the schemas and the dialogs (the heading's own colour field and the buttons' "Text colour" are in Typography
  now). Not folded, as they are not a text's colour: a header's overlay `textColor` (a page's setting that holds only while
  the header lies over the page, drawn as `--header-overlay-text`), a social links block's custom colour (it colours the
  icons and their fill, the names only by inheritance; the names have their own colour in Typography now), an icon list's
  icon colour, a button's fill, a separator's line, backgrounds and borders. The AI page studio writes its headings' and
  buttons' colours as typography; the replicator writes a grid button's measured text colour as the grid's `button.color`
  (its other measured colours stay in the page's CSS, where its `.rp.rp` rules already set them; moving them is not trivial
  and is left).
- **Rich text**: the `textStyle` mark (`Mark` in `page-content.ts`), kept by `cleanRichText()` only with `color` as
  `#rrggbb` (lower-cased) and an optional `opacity` 0–99 (100 is dropped as solid), one per text; anything else Tiptap may
  carry is dropped, a colour or opacity of another shape is refused, and a text style without a colour is no mark.
  `<RichText>` draws it as a `style` on a span inside any link, so the words take it over the link's colour. The editor
  (`rich-text-editor.tsx`) has its own Tiptap mark (`TextColour`, reading back only its own `span[data-color]`, so a pasted
  style never comes in) and a Text colour button that opens the same colour field. Inline markup in plain text fields
  (`src/lib/inline-text.ts`) is unchanged: classes only.
- **The builder**: the one colour field (`ColorField`, `src/components/admin/colour-field.tsx`, re-exported from
  `block-fields.tsx`): the browser's picker, the hex typed, a × where the caller allows none, an optional opacity slider with
  its number, and the theme's colours as swatches (`ColourSwatches`, given by the page editor from
  `PageOwnerContext.colours`: `themeSwatches()` of the store's theme, both looks where the site shows both; Kaizen's pages
  `platformSwatches()`, the colours of `globals.css`). Every colour field in the page editor offers them; rows' and
  columns' colour backgrounds use its opacity slider in place of their own. The Typography panel opens each kind of text's
  Font section with Colour and Opacity, each with its device icon, where its value comes from and a × per size (D179).
- **The checker** (`pageIssues()`, `src/lib/page-a11y.ts`): at every screen size it reads the background (`valueAt()`, the
  column's, else the row's) and the text's colour (the block's own, else its column's, else its row's: `colourAt()`), blends
  a see-through colour over the background (or the theme's background where the owner gave none) and holds the result to
  4.5:1; one issue a block, naming the sizes when only some fail ("… at Small."). It checks a heading's and rich text's
  text (with the theme's text colour where none is set, as before), buttons on their fill or over the background, each of a
  dual button's two (new), every other kind of text a block colours itself, and every colour marked in rich text (also in
  accordions', tabs' and FAQs' bodies). A see-through background is still not checked (what is behind it is not known).
- **Unchanged**: translation (a colour is not text), templates and design profiles (no reference to another thing),
  store copies (JSON copied as it is), A/B tests (`partChanges()` compares typography already); their tests pass unchanged.
- **Tests**: `src/lib/colour.test.ts` (the helper and the blend, swatches, every kind of text of every component with a
  colour and an opacity, rows and columns, sizes walked apart, a dual button's shared and own colours, the flatten rule,
  accepted and refused values, a property test that every old text colour — heading, and button, dual button side, grid
  button and form button over every variant × fill × colour — gives the same final colour at 375, 800, 1100 and 1400 px as
  its inline style did, the fold through `upgradeResponsive()`, and the mark through `cleanRichText()` and `<RichText>`),
  `typography.test.ts` (D179's every-text-has-a-size test now also requires a colour), `page-a11y.test.ts` (opaque passes,
  faded fails, inherited from the column and the row, differing at Small only and at the larger sizes only, a background
  that differs by size, rich text marks, dual buttons, a grid's titles), `typography-fields.test.ts` (the Colour field, its
  swatches, opacity and ×), `page-checks.int.test.ts` (an old heading colour saved and held by the check), and
  `e2e/text-colour.spec.ts` (a colour per size, a row's colour inherited, and a marked colour on the live page).
- **Parity**: `e2e/responsive-parity.spec.ts` captures `color` and `opacity` too, and its typography page holds every old
  text colour (filled, outline and text buttons with and without a fill, a dual button's two, a newsletter's and an email
  form's button). Captured from a build of `origin/main` (e9eb46d, D179 recorded) on its own fresh database and compared
  with the build after: 40 page widths, 7,147 elements, 300,174 values, no difference; the old shape against the same pages
  upgraded is the same too.
