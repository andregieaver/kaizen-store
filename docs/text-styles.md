# Text styles (D393)

*Text styles* are named looks for words, made once and applied by selecting words and choosing one. Examples are a gradient, a
highlighter, an outline or a glow. They are kept site-wide, one library per store and one for Kaizena Flow's own site. They are called
*snippets* in no interface text, and *text styles* in the code (`text_styles`).

This is the owner's request of 29 October 2026: style the second word of "My awesome heading" by marking it and choosing a style, with
the canvas changing at once, and never write a class or `<span>` by hand. On the same day the owner asked for a Visual / HTML toggle
in the rich-text editor.

## 1. What a person does

- **Homer.**
  - Makes a style: in the builder's sidebar, *Styles*, then *New style*. He picks a look from the gallery: Gradient, Highlighter,
    Outline, Underline, Glow, Colour, Small caps or Spaced capitals.
  - He chooses its colours with the colour field he knows (saved colours and gradients included), names it and saves.
  - A preview shows "Aa" and a sample sentence in the style the whole time.
  - He applies it: select words where a text is edited, press *Style* (the paintbrush), and choose. Each style in the menu is drawn
    in its own look. *No style* takes it off. He never sees a class or a tag.
- **Lisa.** Under *Advanced*, writes the style's CSS declarations herself (text properties only; section 3), and edits any rich text
  as HTML with the *Visual / HTML* toggle.

## 2. Where styles apply

- **Step 1 (built first):**
  - Rich text, in the panel's editor and in place on the canvas: a mark of its own.
  - A heading in place on the canvas: the in-place editor becomes a rich one-line editor that shows marks as they look and writes
    the stored inline markup.
  - The Visual / HTML toggle on the panel's rich-text editor.
- **Step 2 (built):** every plain text field of the settings panel that takes inline markup (D191 `<Inline>`): button words, captions,
  titles, list lines, a form's words, a testimonial's quote and role, a table's caption and a custom grid item's words. Each is the same
  one-line editor (`MarkupInput`), so styled words show as they look there too. A table's cells stay plain fields: their icon tokens
  (`{{name}}`) are typed in them.
  - *Edit text* on the live site edits a heading with the same one-line editor. It offers the site's styles to apply, never to make or
    change one (`TextStylesView`).

Stored formats do not change:
- **Plain fields** keep inline markup, `<span class="ts-{slug}">awesome</span>`, which `parseInline()` already reads and `<Inline>`
  already draws as elements.
- **Rich text** gets the mark `{ type: "textClass", attrs: { name: slug } }`, which `cleanRichText()` keeps only for a slug's shape
  and `<RichText>` draws as `<span class="ts-{slug}">`.

## 3. The CSS

- **The class.** A style's class is `ts-{slug}`. The slug is made from the name and fixed once made, so renaming never breaks a use.
  The prefix keeps a style from ever colliding with the site's own classes or Tailwind's.
- **What it is drawn from.** Its declarations come only from `textStyleDeclarations()` (`src/lib/text-styles.ts`): a gallery look's
  settings, each a checked colour, number or choice, turned into CSS by code.
  - Advanced CSS (changed on 29 October 2026, the owner's request: no limits on what a style can do) is the body of the style's rule,
    written in the code editor (D394): any property, `!important`, and nested rules such as `&:hover { … }`, `&::before { … }` or
    `@media (…) { … }`, drawn by the browser's own nesting. A whole rule pasted (`.name { … }`) is kept as its body.
  - It is refused only where the site's own CSS would be (`styleCssProblem()`, `cssProblem()`): `<`, unbalanced braces (the body must
    balance on its own, so it can never close its rule and write another), `@import`, and addresses on other sites. Up to 10,000 characters.
  - Words wearing a style are outlined with a dashed line in every editor of words (the panel's fields, the rich text editor, the canvas
    while editing, the live site's editing), so what is customised shows; visitors never see the outline.
- **Where it is drawn.** The site's stylesheet of styles is `textStylesCss()`, one rule per style, drawn:
  - in the store's layouts and Kaizena Flow's root, after the theme and before the owner's own CSS, so their own CSS can still say
    otherwise;
  - on the builder's canvas from the builder's own copy, so a style made or changed shows at once, before it is saved;
  - in the style menu's previews.

## 4. Visual / HTML

- **What the toggle shows.** It shows the rich text as the HTML its parts make: paragraphs, headings 2 to 4, lists, quotes, lines,
  bold, italic, underline, links, colours and text styles as `<span class="ts-…">`.
- **Switching back.** The HTML is read into the editor's parts (the editor's own schema). Anything it cannot hold is dropped, and the
  panel names what: other tags, inline `style`, scripts, frames and unknown classes.
- **Saving.** What is saved is still the structured rich text, checked by `cleanRichText()` on the server, never HTML. Raw HTML stays
  the HTML component's (D93's `html` block).

## 5. Rules

- **One writer.** `commerce.text_styles` is written only by `src/server/text-styles.ts` (audited `website.text_style_*`, area
  `website`). It is read through `textStylesFor(owner)`, cached under `textStylesTag(owner)`.
- **Who.** A store's styles need `website:write`; Kaizena Flow's need a platform admin.
- **Deleting.** A style in use says where it is used. Deleting it leaves the words as they are, unstyled.
- **Copies.** Copied with a store: `COPY_RULES` settings, `copy_text_styles()` in the copy's transaction, and from a store template in
  `clone_starter_setup()`. In the store export, not personal data.
- **Carried.** Content placed from another site brings the styles its words wear (`carryTextStyles()`, after the content's own
  transaction, never failing the placing): a template used, a demo store's home page taken, a theme placed (from the store it was taken
  from) and a submitted theme's pages. A style the receiving site already has by that slug keeps its own look; the limit of 50 holds.
- **The checker.** `pageIssues()` reads a style's colour as the colour of the words it is on (unit K's class colours).
- **Limits.** At most 50 styles per site; a name is at most 60 characters.
