# Kaizena Flow's own site: the design

**Read this before making or changing any page of kaizenaflow.com.** It records the look the owner has chosen for the platform's own
site, read from production on 4 November 2026: the front page (`home`), *Move your store* (`move-your-store`), the feature pages (such as
`get-started-fast`), the header, the main menu, the theme, the site CSS and the text styles. A new page is built from the recipes in
section 6, so it looks as if the owner made it. When the owner changes the look in the builder, this file is corrected to match: the
site is the truth, this file describes it.

---

## 1. Where the site lives

Nothing of the site's look or words is in code. All of it is data in the production database (Supabase `ybsozesfuxuitoacntfo`):

| What | Where | Edited at |
|---|---|---|
| Pages, header, footer | `commerce.pages` with `store_id` null (`type` `page`, `header`, `footer`) | Website → Pages, `/admin/platform/pages` |
| Theme, fonts, site CSS, which header, footer and menu | `commerce.platform_settings` (`theme`, `fonts`, `custom_css`, `header_id`, `footer_id`, `header_menu_id`) | Website → Design, and the builder's Theme tab |
| Text styles (`ts-…` classes) | `commerce.text_styles` with `store_id` null | The builder's *Style* menu |
| Main menu | `commerce.menus` *Main menu* (`f01f9fbd-0de9-46ca-9821-8734c542a7da`) | Website → Menus |
| Pictures | the media library, `product-media/platform/…` in Storage | Media |

A page's content is the JSON the builder saves (`PageContent`, checked by `pageInput` in `src/lib/page-content.ts`): rows of columns of
blocks, each with optional settings, and settings per screen size under `at` (`sm` is a phone, `md` a tablet; `lg` and `xl` are wide).
The rules for pages are in `docs/rules/admin/website.md` (*Pages*).

## 2. Who a page is for, and the words

Every page serves Homer first (CLAUDE.md, Conventions): one idea per row, one clear button, words for what he gets, nothing to understand
before pressing it. Lisa's detail goes in the documentation (`/docs`) or one link away, never in Homer's way.

- **The name** is *Kaizena Flow*, shortened to *Flow* (*Get Started with Flow*, *About Flow*). Products are named *Kaizena …*: *Kaizena
  Store Manager*, *Kaizena Page Builder*, *Kaizena Theme Store*, *Kaizena Growth Engine*, *Kaizena Dream Factory*. Never *Kaizen* or
  *Kaizen Store* in words a visitor reads.
- **The voice**: short, warm, confident, a little playful (*We got you covered!*, *Promote us equals money*). Second person (*your
  store*). No jargon a shop owner would not use (no *CSV*, *DNS*, *redirect*, *handle*, *API* on Homer's pages).
- **A section's text** is a bold lead sentence, then one or two plain sentences: ***No need to hire.*** *Your AI Store Manager takes care of
  business.* Keep each to about 25 words.
- **Headings** are in title case for product names and short claims (*Move Your Store for Free*, *Kaizena Theme Store*) and sentence case
  for questions and longer lines (*What is Kaizena Flow?*, *Do you need assistance?*).
- **Claims** are only what the product does today (check the feature's file in `docs/` and its *What is built* section). A claim that is
  not built yet says *(Coming soon)* in grey (`greyed-text`).

## 3. The theme

`platform_settings.theme`: base **minimal**, colour mode **auto** (follows the visitor's system; no visitor switch).

| Setting | Light | Dark |
|---|---|---|
| Background | `#ffffff` | `#1c1c1c` |
| Surface | `#f5f5f4` | `#1c1c1c` |
| Text | `#171717` | `#ededed` |
| Muted text | `#525252` | `#a3a3a3` |
| Accent / accent text | `#171717` / `#ffffff` | `#ededed` / `#0a0a0a` |
| Border | `#e5e5e5` | `#2e2e2e` |

- **Fonts**: headings **Montserrat**, semibold, normal case; body **Inter**, paragraphs **18 px**. *Waterfall* is used only through the
  class `artistic-text`.
- **Buttons**: filled, **pill** corners (radius 63), shadow `md`. Cards' corners medium, fields' small.
- **Layout**: content up to **1440 px**, rows full width, a row's padding 20 px unless set. Breakpoints `md` 768, `lg` 1024, `xl` 1280.
- **Product cards** (not used on the platform's pages): left, square, plain.

### 3.1 The palette

The theme's library holds the site's named colours; use these, never a new colour without the owner.

| Name | Colour | Used for |
|---|---|---|
| brown (*sand*) | `#908064` | the site's signature: every row's gradient, and cards at 6 to 26 % opacity |
| lux-purple | `#242a60` | every button (the site CSS, 3.3), the first part of a dual heading |
| (button hover) | `#394293` | the button's fill under the pointer |
| (icon purple) | `#3a4293` | icon lists' icons |
| green (text style) | `#557400` | the *Green text* style (`ts-green-text`), the word *Flow* |
| Forrest | `#5e7714` | a dual heading's first part where set |
| Dark | `#1c1c1c` | dark bands (the header's announcement row) |
| (card line) | `#c4bcad` | the line round a highlighted card (6.5) |
| (light greys) | `#ededed`, `#f9f7f6`, `#f3f1ec`, `#eae8e3`, `#e1dcd5` | gradients' second colour, the mega menu, the menu's hover |
| blue, blue-green, Light-brown, Sea | `#adfeff`, `#00b9be`, `#c18a4a`, `#006a85` | kept in the library, not used on the pages yet |
| (gradient text) | `#4BD9ED` → `#27B8F4` → `#137DEF` → `#0F4BDF` at 120° | `gradient-text`, `gradient-span`, `gradient-first` |

## 4. Text styles and the site's CSS classes

### 4.1 Text styles (`commerce.text_styles`, applied with the *Style* menu)

| Class | Name | Look |
|---|---|---|
| `ts-green-text` | Green text | `#557400`, bold. The word *Flow* (*What is Kaizena <span class="ts-green-text">Flow</span>?*), a word to stress |
| `ts-colour` | Colour | `#242a60`, bold |
| `ts-button-in-text` | Button in text | a small green pill (`#53730f`, white line) inside a line, as the header's *NEW! Dream Factory* |
| `ts-gradient-test` | Gradient test | a trial; do not use |

### 4.2 Classes of the site CSS (`platform_settings.custom_css`)

Put these in a part's *Advanced → Classes*, or on words as `<span class="…">`.

| Class | On | Does |
|---|---|---|
| `heading-on-light` | a dual heading | its first part at 70 % size in `#242a60` (the eyebrow, 5.1) |
| `super-heading` with `light-color` or `dark-color` | the eyebrow's `<span>` | names the eyebrow; `dark-color` also gets a dark-mode colour. `green-text` is added on a hero's eyebrow |
| `border-image` | an image block | rounded 6 px with a 4 px see-through brown line: every screenshot |
| `compare-grid` | a brands block | each logo in a white-to-sand pill with a soft shadow |
| `greyed-text` | words | the theme's muted grey, for *(Coming soon)* |
| `gradient-text` | words | the blue gradient as the words' colour |
| `gradient-span`, `gradient-first` | a part with buttons | the blue gradient as the buttons' fill (all, or the first) |
| `artistic-text` | words | the *Waterfall* script |
| `hero` | the eyebrow's `<span>` on the front page | half size |
| `z-index-1` | a row | keeps it over the row after (the front page's hero overlaps the next row) |
| `display-screens` | a part with a frame | the screenshot's rounded line round an embedded frame |
| `white-bg` | a part | white behind its boxes |
| `over-footer` | a row before the footer | hides the footer's spacer |

The site CSS also makes every button `#242a60` with `#394293` under the pointer (`.kz-btn … !important`), so a fill chosen in a button's
settings does not show; leave buttons at the theme's fill. It styles the mega menu (6.8).

## 5. The building blocks

### 5.1 The dual heading (D425): every section's title

A heading with two parts, one under the other: a short **eyebrow** (one to three words) over the **title**. Always with `stack: true` and
the class `heading-on-light`, the eyebrow wrapped in `<span class="super-heading …">`:

```json
{ "type": "heading", "level": 2, "stack": true, "className": "heading-on-light",
  "text": "<span class=\"super-heading light-color\">Brand Yourself</span>",
  "second": "Kaizena Theme Store",
  "typography": { "text": { "color": "#171717" }, "first": { "size": { "unit": "px", "value": 18 } } } }
```

- **The page's `h1`** is the hero's: eyebrow `<span class="super-heading dark-color green-text">…</span>`, first part 30 px (*Switch* /
  *Move your store*).
- **A section's `h2`**: eyebrow 18 px, `light-color` and `dark-color` taking turns down the page.
- **An `h3` in a card** (*What is Kaizena Flow?*, *Sell Anything*): one part, 30 px, its first word in
  `<span class="green-text ts-colour">` (purple and bold in light mode).
- Older pages (`get-started-fast` and the feature pages copied from it) put the eyebrow and the title in one heading's text; new pages use
  the dual heading.

### 5.2 Text

Rich text, a **bold lead sentence** then plain sentences. Centred in a hero and in cards that are centred, left beside a picture.
Paragraphs are 18 px (the theme); the front page's hero lead is 25 px (22 px on a phone).

### 5.3 Buttons

- **The main action** is *Get Started with Flow* → `/sign-up`: a dual button, size `lg`, shape `pill`, the second side left empty,
  entering with the motion `blur-up`, gap 30, centred.
- **A second action is a text link, never a second button.** The site CSS paints every button `#242a60` (3.3), an outline or text-link
  button too, while those keep the page's dark text: on this site they cannot be read. So the second action is a rich-text link under the
  button (*Compare us to Shopify and others.* → `/compare`; *See how it works* → `#how-it-works`), centred, margin -20 above.
- **A section's link** is a single button (*Explore Themes*, *Explore the builder*) under the text. Beside a picture it is shown under the
  text on wide screens and under the picture on phones (two copies, each hidden at the other sizes, 6.9).

### 5.4 Icon lists

`icon: "check"`, `iconSize: "lg"`, `iconColor: "#3a4293"`, `gap` 20 to 21, words 18 to 20 px. Side by side (`layout: "row"`, centred) for
three or four short claims under a hero (*Build with AI · Automate everything · EU Compliant · Sell worldwide*), one under another in a card.

### 5.5 Pictures

Screenshots of the product, never stock photos: an image block with `className: "border-image"`, `shadow: "lg"`, `shadowOpacity: 20`, WebP or
AVIF from the media library, beside the section's text (6.3). **Always write the alt text** (what the screenshot shows); the pages made so far
left it empty, which the page checker flags.

### 5.6 Logos

A brands block for platforms and partners: `columns: 6`, `gap: 30`, `greyscale: true`, `colourOnHover: true`, `showNames: false`,
`className: "compare-grid"`. Logo files of 800 × 234.

## 6. Recipes: the parts of a page

Each recipe is the settings the owner's pages use; copy them as they are. Ids are new UUIDs for every row, column and block.

### 6.0 The owner's two rules (5 November 2026)

They hold for every new page and win over any older value below or on the pages made before them:

- **A column with a background** is always the *column box*: `background: { "type": "color", "color": "#ffffff", "opacity": 50 }`,
  `radius: 6`, `shadow: "md"` (cards, the highlighted card, the white card round a table). Its text keeps `#171717` (8).
- **A gradient background** is always at **35°** (`"angle": 35`): the hero, the section turns, the closing row.

Pages made before 5 November 2026 (the front page, *Move your store*, the move and comparison pages, Selling Products and Selling
Subscriptions) still have the older values (sand at 6 % with `radius: 20` cards, gradients at 215° and 240°) until they are made again.

### 6.1 The hero (every page starts with one)

```json
{ "type": "row", "layout": "1", "align": "middle", "height": 50,
  "style": { "padding": { "top": 150, "left": 20, "right": 20, "bottom": 100 } },
  "background": { "type": "gradient", "style": "shift", "flow": "still", "angle": 35, "colors": ["#908064", "#ffffff"], "opacity": 80 },
  "backgroundFixed": true, "contentMax": 968, "typography": { "text": { "align": "center" } },
  "at": { "sm": { "height": 100, "style": { "padding": { "top": 0, "left": 20, "right": 20, "bottom": 0 } } } } }
```

In it: the `h1` dual heading (5.1), a lead paragraph, and the main action (5.3) where the page asks for one. The front page's hero is the
exception: two columns (62/38) with the logo picture, `fullHeight`, gradient at 35°, `shadow: "xl"` at 12 %, and the class `z-index-1`.

### 6.2 Section backgrounds: sand gradients taking turns

Every row after the hero has a fixed (`backgroundFixed: true`), still, `shift` gradient from sand. Take them in turn down the page:

| Turn | Background |
|---|---|
| A | `{ "type": "gradient", "style": "shift", "flow": "still", "angle": 35, "colors": ["#908064", "#ededed"] }` |
| B | `{ "type": "gradient", "style": "shift", "flow": "still", "angle": 35, "colors": ["#908064", "#ffffff"] }` |
| C, a plain band | `{ "type": "color", "color": "#908064", "opacity": 9 }` (26 behind the logos on *Move your store*) |

### 6.3 A feature row: text beside a screenshot

```json
{ "type": "row", "layout": "2", "align": "middle", "gap": 70, "contentMax": 1000,
  "style": { "padding": { "top": 100, "left": 20, "right": 20, "bottom": 100 } },
  "background": "(turn A or B)", "backgroundFixed": true,
  "at": { "sm": { "contentMax": 320 } } }
```

Columns 40/60 (text/picture), or 50/50, or 38/62. The text column has `radius: 20` and `typography.text.color` `#171717` (8). Feature rows take turns: text left and picture right,
then picture left and text right with `at.sm.reverse: true` (the text comes first on a phone) and the text column padded 40 above and below.
On a phone the picture column moves up 40 px (`at.sm.style.margin.top: -40`).

### 6.4 Cards: a grid of short sections

A row of `layout: "2"` with `moreLines: ["2", "2"]` (six cards in three lines of two, the front page's last row) or `"3"` for three, `gap`
70, `contentMax` 1000, each column `radius: 20` holding a dual heading (eyebrow 18 px, title, text `#171717`) and its text. For cards with
their own box, the column takes the column box of 6.0 (white at 50 %, `radius: 6`, `shadow: "md"`) and padding 40 / 0 / 46 (*What is Kaizena
Flow?*), and the row `equalHeight: true`.

### 6.5 A highlighted card: the one thing to notice

One centred column with its own line, as *Do you need assistance?* on *Move your store*:

```json
{ "border": { "style": "solid", "color": "#c4bcad", "width": { "top": 5, "left": 1, "right": 1, "bottom": 1 } }, "radius": 6, "shadow": "md",
  "background": { "type": "color", "color": "#ffffff", "opacity": 50 },
  "style": { "padding": { "top": 20, "left": 30, "right": 30, "bottom": 30 } }, "typography": { "text": { "align": "center" } } }
```

### 6.6 Logos (*Select your current platform*)

A row of one column (`gap` 70, padding 100 / 20, `contentMax` 1000, background turn C at 26 %), the dual heading and the brands block (5.6).

### 6.7 The end of a page

The last row is a section like the others; the footer follows it. A page that sells ends on the main action (5.3) in a hero-like row
(turn B, centred, `contentMax` 968).

### 6.8 The header and the menu (shared; change only on request)

- **The header** (`custom-header`): an announcement row (dark `#1c1c1c`, 12 px white, *NEW! Dream Factory* in `ts-button-in-text`, now
  hidden) and the bar: `fit-sides`, full width, `shadow: "md"`, padding 10 / 16, a gradient at 205° from white to sand under 80 % white; the
  menu button and the logo (34 px) left, the main menu in the middle (18 px, weight 500, `#242a60`, a `#e1dcd5` background sliding under the
  pointer, hidden on phones), account and *Sign up* right.
- **The main menu**: *Explore* (a centred mega menu of six columns: *Build your store*, *Run your business*, *Sell anything*, *Sell
  anywhere*, *Marketing & Analytics*, *Get paid*, each a group of pages), then *Compare*, *Switch* (`move-your-store`), *Pricing*, *About
  Flow*. The site CSS draws the mega menu's groups as `#f3f1ec` tiles on `#f9f7f6`, the group names small and in capitals.
- A new page is linked from where a visitor would look for it: a feature page in its *Explore* group, a page under *Switch* from
  *Move your store*. Adding it to the menu is the owner's to approve.

### 6.9 Phones

Every page is checked at phone width in the builder. The owner's habits:

- Rows narrow to `contentMax` 320 to 390 on a phone (`at.sm.contentMax`), the hero loses its top and bottom padding (`at.sm`).
- A part shown in one place on wide screens and another on phones is two copies, each with `visibility.hideAt` (`["md", "sm"]` for the
  wide one, `["xl", "lg"]` for the phone's).
- Icon lists side by side become one under another; a dual button stacks (`at.sm.stack: true`) with margins 10 / 20 / 30.

### 6.10 A comparison table (the comparison pages, 5 November 2026)

A table block (D194) in a **white card** on a sand row, so its words read the same in both colour modes: the row is turn B, its second line
one column with the column box of 6.0 (white at 50 %, `radius: 6`, `shadow: "md"`), padding 24 (12 / 8 on a phone) and the text colour
`#171717`. The table:

```json
{ "type": "table", "header": true, "rowHeaders": true, "fixedHeader": "never",
  "headerColor": "#ffffff", "headerBackground": "#242a60",
  "sectionColor": "#171717", "sectionBackground": "#f3f1ec", "iconColor": "#3a4293",
  "caption": "Kaizena Flow and {platform}, read on {date}", "sections": ["(null, or a section's title above that row)"] }
```

Section rows set their own colours: left to the theme they would be the dark surface in dark mode under dark text. Cells start with
`{{check}}` where the thing is built in; on a phone each row stacks with its column names. Every page with a table says where each line
comes from (an accordion, `look: "boxed"`, at the foot).

### 6.11 A feature page (the owner's, 5 November 2026)

The feature pages published on 5 November (Selling Products, Campaigns, Discounts, Customer Care, Bonus Program and the others under
*Explore*) share one shape, read from production that day:

- **Gradients at 35°**, the hero's too (`angle: 35`, opacity 80), turns A and B taking turns, C (9 %) for a band of highlighted cards.
- **The hero** (6.1) with the main action, a text link to the first section (*See how it works* → `#{id}`) and three side-by-side checks.
- **Three cards under a heading**: one row of `layout: "1"` with `moreLines: ["3"]`, `contentMax` 1100, `equalHeight`; the first line the
  section's dual heading and lead, each card `radius: 6`, `shadow: "md"`, white at 50 % (`{ "type": "color", "color": "#ffffff", "opacity":
  50 }`), padding 40 / 24 / 46, an `h3` (5.1), a lead and three checks at 17 px, left-aligned.
- **Feature rows** (6.3) with a list of checks beside the words instead of a screenshot, taking turns side.
- **Highlighted cards**: a row of `layout: "3"` on turn C, each card as above with the line of 6.5 and an `h2` dual heading; one links on.
- **Questions** in one white card (`radius: 6`, `shadow: "md"`, padding 30 / 30 / 40), a `faq` block `look: "boxed"`, `single: true`, each
  answer a bold first sentence.
- **The end** (6.7) with the main action and *Compare us to others* → `/compare`.

## 7. A page's own settings

- **Title** as the menu would say it (*Move your store*, *Get started fast*). **Address** from the title (`pageSlugFromTitle()`); a page
  under another is `{parent}/{own part}` (up to four levels).
- **Search texts** (`seo.title`, `seo.description`) are always written: the title under 60 characters with *Kaizena Flow*, the description
  under 160, in plain words. Do not copy another page's.
- `searchEngines: true`, `aiAssistants: true`; a `thumbnail` (687 × 372 WebP) for pages that are shared.
- No page CSS: a look that is needed twice is a class in the site CSS (the owner's), or a text style.

## 8. Checks before a page is offered

- One `h1` (the hero's); `h2` for each section, `h3` inside cards, never skipping a level.
- Alt text on every picture; a button's and a link's words say where they go.
- Contrast holds in both colour modes. A row's sand gradient is the same in dark mode, but text left at the theme's colour turns
  `#ededed` there (3.3:1 on sand): **every column on a sand gradient sets its text colour to `#171717`** (`typography.text.color`), as
  the owner's columns do, and so does each section heading (5.1). The green `#557400` only where a light row is behind it (D408: the
  site CSS gives it another colour in dark mode where none is).
- The page passes `pageInput` and the page checker (`pageIssues()` in `src/lib/page-a11y.ts`, with the platform's theme, text styles and site
  CSS), as the builder's *Checks* do.
- Every claim is built (section 2).

## 9. How Claude makes a page

1. Read this file, the parent page and the feature's own file in `docs/` (for what is built).
2. Build the page's JSON from the recipes, with new UUIDs, and check it with `pageInput` and `pageIssues()` as the editor's save does.
3. Save it as a **draft** of Kaizena Flow (`commerce.pages`, `store_id` null, `type` `page`, `published` null, `created_by` the owner who
   asked) with its `saved` version in `commerce.page_versions`, as `savePage()` does. Nothing visitors see changes.
4. The owner opens it at Website → Pages, looks at it on every screen size and presses **Publish**, which runs the checks, refreshes the
   site's pages and writes the audit.
5. Say what to add to the menu, and which pictures would make it better (screenshots of the screens it talks about).

### 9.1 Pages made this way

| Page | Address | Made | State |
|---|---|---|---|
| Move from Shopify | `/move-your-store/move-from-shopify` | 4 November 2026, for Homer: three steps, what comes with you, no stress, the free move, six questions, the main action. Claims from `docs/moving-from-shopify.md` 17 | draft, for the owner to publish |
| Move from WooCommerce | `/move-your-store/move-from-woocommerce` | 4 November 2026, the Shopify page's twin, plus *Keep WordPress, or move everything* (two cards) and what comes *straight from WooCommerce* beside what *our free WordPress plugin* adds. Claims from `docs/moving-from-woocommerce.md` 17 | draft, for the owner to publish |

| Try the page builder | `/try-the-page-builder` | 5 November 2026, for the builder's sandbox (D457 S4): the hero with *Start building* (`/admin/try`) and signing up as the text link, three cards (start, change, keep), the real builder beside a list, five questions, the main action again. Built by `docs/site-pages/try-the-page-builder.test.ts` (no issues, no claims). Its button works once the owner turns the sandbox on | draft, for the owner to publish; then a link from the front page and the plans |
| The six comparison pages | `/kaizen-vs-{platform}` | 4 and 5 November 2026, made again by one generator (`docs/comparison-pages.md`): the hero, six reasons, the table (6.10), where the other is the better fit, moving over, questions, the main action, how we compared. `/compare` left as the owner made it | drafts over the live pages, for the owner to publish |
| Store Manager | `/store-manager` | 5 November 2026, by `docs/site-pages/store-manager.test.ts` (`docs/site-pages/README.md`): what the AI Store Manager does for an owner, in the feature pages' shape (6.11) with *You stay in charge* (the three levels) and three highlighted cards | published by the owner, 5 November |
| Languages and Currencies | `/languages-and-currencies` | 5 November 2026, by `docs/site-pages/languages-and-currencies.test.ts`: selling across borders (languages, currencies, payments, VAT, EU rules, shipping and customs, country by country), in the feature pages' shape (6.11) | draft over the live page, for the owner to publish |

| Selling Products | `/selling-products` | 5 November 2026, for physical and digital products: two cards (ship it or send it), three feature rows without pictures (catalogue, stock and shipping, downloads), four cards (prices, checkout, being found, the EU's rules), questions, the main action. Each claim a Full row of `docs/parity/rows` (backorders, a Partial row, left out) | draft over the live page, for the owner to publish |

| Selling Bookings | `/selling-bookings` | 5 November 2026, the first page with the owner's two rules (6.0): stays and rentals (the menu's *Bookings and rentals*; appointments have their own page), two cards, four feature rows (prices and seasons, calendars with Airbnb and Booking.com, payment, hosts), questions, the main action. Claims from D65 to D71 and `international.dac7-reporting` | draft over the live page, for the owner to publish |
| Selling Appointments | `/selling-appointments` | 5 November 2026, with the owner's two rules (6.0): one-to-one appointments and classes as two cards, three feature rows (your time, payment, no-shows), questions, the main action. Claims from D65, D66 and `docs/bookings.md` (B1, B2); gift cards in the same checkout not claimed | draft over the live page, for the owner to publish |
| Selling Subscriptions | `/selling-subscriptions` | 5 November 2026: subscriptions and subscription boxes as two cards, then three feature rows (customers in charge, billing, the numbers), questions, the main action. Claims from D25, D29, D102 and `analytics.subscription-analytics`; payment retries and subscriptions of downloads or services not claimed | draft over the live page, for the owner to publish |

A page for another platform (`move-from-{platform}`) is the same eight-part shape: the hero, the three steps, what is particular to that
platform (as WordPress's choice), what comes with you, no stress, the free move, its questions, the main action ending on *Compare us to
{platform}* (`/kaizen-vs-{platform}`). Its claims come only from that platform's `docs/moving-from-*.md` and what it says is built.

## 10. Found while reading the site (4 November 2026)

For the owner, not to copy:

- The pictures on the front page and feature pages have no alt text.
- *Move your store*'s search title and description are the comparison page's (*Kaizen compared with Shopify, WooCommerce, Wix and
  more*), with the old name: the page began as a copy of `/compare`.
- The Shopify logo on *Move your store* links nowhere; it can lead to `move-your-store/move-from-shopify` (brands' `href`, D205).
- *As your business grows - so does your Kaizena FLow.* (front page) and *KainzenaLabs* (the draft *Switch to Kaizena Flow*) are typos.
- (5 November) A second, published page at `/kaizena-store-manager` (*Kaizena Store Manager*) holds a copy of *About us* (*Products and
  Services*, *KaizenaLabs*, *Kaizen Life*) with no search texts, beside `/store-manager`; once the new Store Manager page is published it can
  be unpublished, or point to `/store-manager`.
- (5 November) The shop's interface words are hand-written in Norwegian, Swedish, Danish and English only: `commerce.ui_translations` is
  empty, so a store in any of the other 23 languages shows its buttons, checkout and emails in English until a platform admin presses
  *Translate and review* at Platform → Languages. Pages say *27 languages* only of a store's own words until then (`docs/site-pages/README.md`).
