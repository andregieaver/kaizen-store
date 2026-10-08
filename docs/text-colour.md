# Text colour and opacity in the page builder (proposed D180)

Status: **planned, not started.** Built after responsive editing (`docs/responsive-editing.md`, proposed D179), whose
per-size values, CSS writer and Typography panel it uses.

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
