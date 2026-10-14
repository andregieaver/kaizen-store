# The admin's style (colour schemes and layouts)

The admin's look, taken from one reference screen (`docs/admin-style/reference.jpg`: a customer page of a collections tool,
with a dark icon rail, a warm off-white canvas, white cards and one green) and written as rules that hold for every page of
the admin. It replaces the look of D149 (`src/app/admin/admin.css`: indigo, cool tint, bordered cards with shadows) when it is
built; nothing here is built yet. It is made of two things that can each have more than one version:

- a **colour scheme**: the values of a fixed set of colour *roles*, in light and dark (section 4). The reference's is `meadow`.
  Adding a scheme is writing one block of values and passing the contrast test (section 7).
- a **layout**: the arrangement of the shell's regions (rail, sidebar, top bar, page header, main, aside) (section 6). The
  reference's is `rail`. Adding a layout is one entry in a registry and one block of CSS (section 7).

Components never name a colour or a region's size. They name a role (`bg-card`, `text-muted`, `bg-positive-soft`) and sit in a
region. So a new scheme or layout changes nothing in a component.

Measurements are taken from the reference by sampling its pixels (colours: the median of a 5×5 patch for surfaces and the
darkest pixel of a word for text) and scaled to a 1440 px wide window, rounded to a 4 px grid. Contrast ratios are WCAG 2.2's.

---

## 1. What the reference does

### 1.1 Colours

The screen is almost entirely neutral: a near-black, a warm off-white, white and greys. Colour appears only where something is
said with it. Sampled values:

| What | Value | Notes |
|---|---|---|
| Rail (the dark column on the left) | `#101614` | A green-black, not a neutral black: the same hue as the brand green, darkened. |
| Canvas (the page under the cards) | `#f0f1eb` | Warm off-white with a hint of green-yellow. |
| Cards, tab bar, pills, round buttons | `#ffffff` | Pure white. |
| Sunken surface inside a card (the highlighted contact, a count badge, a track) | `#f6f7f2` | Halfway between card and canvas. |
| Ink (titles, values, table ids, amounts) | `#101614` | The rail's colour. 18.3:1 on white. |
| Secondary text (the meta line, inactive tabs, dates, score labels) | `#464a46` | 9.0:1 on white. |
| Muted text (card labels, descriptions, "since 2023", eyebrows) | `#777b77` | 4.3:1 on white: **just under 4.5**, see 1.2. |
| Faint text (axis labels, "91.9% of billed") | `#9d9f9c` | 2.7:1: decoration only, see 1.2. |
| Brand green (the main action, the active rail tile, the logo, "paid on time") | `#3bd968` | Light and loud. Dark ink on it reads 9.9:1, but white on it only 1.9:1. |
| Deep green (a notification's dot) | `#11a356` | A darker green for small marks on white. |
| Green text ("What changed", "Primary") | `#0b6630` | Green that reads as text: 6.2:1 on its tint. |
| Green tint (the AI insight panel) | `#e2f3e9` | A pale mint behind green text. |
| Green tint, lighter (the "Primary" chip) | `#ecf7ef` | |
| Amber (bars, the chart's line, a dot) | `#f0bf2e` | The "watch this" colour. |
| Amber text ("At risk", "72", "41 days", "Up 11 since June") | `#7a5d00` | A brown-gold that reads 5.5:1 on its tint and 6.2:1 on white. |
| Amber tint (the "At risk" and "Up 11" chips) | `#f9f1de` (`#ebe5cb` on the canvas) | |
| Red (a bar, a dot) | `#e4554f` | |
| Red text ("Overdue 18d") | `#9f2719` | 6.4:1 on its tint. |
| Red tint (the overdue chip) | `#fae8e5` | |
| Neutral chip ("Due in 8d") | `#f6f8f3` with a `#97a29a` dot and `#464a46` text | The same shape as a status chip, without colour: it is fine. |
| Hairlines (rows, a card's sections) | `#f0f1eb`–`#f7f7f7` | Barely there: the canvas colour itself. |
| Rail icons | `#a7abaa` | 8.0:1 on the rail. |
| The active tab's text, the dark button's text | `#ffffff` on `#101614` | |

The neutrals all lean warm and slightly green, which is why the screen reads calm rather than clinical. The brand green and the
rail share a hue, so the dark rail looks like the green's shadow rather than a separate black bar.

### 1.2 Contrasts

- **Between surfaces, the contrast is very low** on purpose: a white card on the canvas is 1.14:1, the sunken surface on a card
  barely differs. Cards are told apart from the page by colour alone, with no border and no shadow. This is what makes the
  screen feel soft and airy. It holds on a good screen in light mode. In dark mode, or under the system's high-contrast setting,
  a hairline border has to come back (sections 4 and 5).
- **Between text and its background, the contrast is high where it matters**: ink is 16–18:1, secondary text 9:1, and every
  coloured *text* (green, amber, red) is a dark version of its colour, never the bright one (5.5–6.5:1). Bright colours are only
  ever fills: bars, dots, the button, the tile.
- **Two greys are too faint for text.** The muted grey (`#777b77`) is 4.30:1 on white and 3.79:1 on the canvas, under the
  4.5:1 that body text needs. The faint grey (`#9d9f9c`) is 2.67:1. We keep the look and move the values: muted becomes
  `#676c68` (5.35:1 on white, 4.71:1 on the canvas), and the faint grey is kept only for what is not read as text (an axis
  tick, a disabled control, a placeholder's decoration), never for a figure's sub-line. "91.9% of billed" and "was 28 days" are
  information, so they are muted, not faint.
- **Bars are told by their words, not their colour**: a green bar is 1.7:1 against its track and the amber 1.6:1, far under the
  3:1 a graphic needs to stand on its own. In the reference every bar has its label and its number beside it, and that is the
  rule (section 5.8). A bar never stands alone.
- **White on the brand green fails (1.86:1).** The main action's words are ink, not white. This is the most important
  difference from D149's indigo button with white words.

### 1.3 How colour marks what matters

Colour is spent like money: almost nothing is coloured, so what is coloured is seen at once.

1. **One thread per page.** The page's story is "this customer is drifting into risk", and amber carries it from the top to
   the bottom: the "At risk" chip beside the eyebrow, the score "72", the "Up 11 since June" chip, the five score bars, the
   chart's line and its last dot, and "41 days". A reader who sees only the amber has read the page. The rule: **a page has at
   most one warning colour in play**, and everything that is part of the same story wears it.
2. **Status by colour, always with words.** Overdue is red ("Overdue 18d" with a red dot), coming due is neutral grey ("Due in
   8d"). Not yet late is deliberately *not* coloured: red is kept for what is wrong now, so it is not worn out.
3. **Green means "go" in two senses**: the good share ("Paid on time", the green bar) and the action to take ("Start collection
   plan"). The brand colour and the positive colour are the same green, which is why the main action feels like the right thing
   to do. A scheme may make them differ (section 4.3).
4. **AI is marked by a sign and a tint, not a colour of its own.** The sparkle icon marks everything the AI made or does: the
   collection risk card, "What changed", the "Start collection plan" button, the rail's AI item. The insight itself sits in a
   pale mint panel with its title in green text and "Updated today" in muted text: it reads as advice, apart from the facts.
5. **A choice among equals is a tint, not a colour.** The primary contact is shown by a sunken background and a small green
   "Primary" chip; the other contact is plain. Nothing shouts.
6. **The current place is the strongest contrast on screen.** The active tab is a black pill with white words on a white bar;
   the active rail item is a green tile on the black rail. These two are the only places with inverted colour, and both answer
   "where am I".
7. **Numbers carry the weight, not colour.** "$842,000", "41 days", "$42,800" are large and dark; their labels above and
   sub-lines below are small and muted. A number turns colour only when it is part of the page's thread ("72", "41 days").

### 1.4 Type

- **One family**, a neo-grotesque sans (the reference looks like Inter Display or a close relative: tight apertures, a
  single-storey `a` is absent, figures even). The admin already loads Inter, so we keep Inter and use its display cut for the
  largest sizes.
- **Two weights: regular (400) and medium (500). No bold.** Even the page title, "Alderney Ceramics", is regular weight at a
  large size with tight tracking. Hierarchy comes from size and colour, never from weight. This is a big part of the calm look,
  and it differs from today's admin, whose `h1` is 650.
- **Tracking tightens as size grows**: the title about −0.03 em, values about −0.015 em, body text 0, and the small uppercase
  eyebrows open up to about +0.06 em.
- **Eyebrows** ("CUSTOMERS", "WHAT BUILDS THIS SCORE") are small, uppercase, muted and tracked. They name a group, never
  carry information of their own.
- **Labels sit above values**, in muted sentence case ("Total invoiced"), and a value's context sits below it, smaller and
  muted ("since 2023").
- **Figures are tabular and right-aligned** in lists ("$42,800" over "$12,400"), and dates sit in their own column.
- **The meta line** under a title joins facts with a middle dot and spaces: "Manufacturing · Customer since March 2023 · Net 30
  · $18,000 per month". The same separator joins an invoice's description: "Platform licence · Q3 2026".

### 1.5 Calls to action

The page header has three buttons, from left to right in rising weight: an outlined secondary ("Message", white with a hairline
and an icon), the main action ("Start collection plan", the brand green, ink words, a sparkle icon), and a round "more" button.
Inside the risk card, a full-width black button ("Tighten their workflow") is the card's own conclusion.

- **Every button is a pill** (fully rounded), 44 px high in the header, with an icon at its start when it has one.
- **One green button per page.** It is the page's main action and sits at the top right of the page header.
- **A black button is a card's own main action**, full width at the foot of the card, below what justifies it. There is at
  most one per card.
- **Secondary actions are white with a hairline border**, never grey: they sit on the canvas, so white already lifts them.
- **Overflow goes into a round "more" button** (`···`), the same height as the buttons beside it.
- **Links to "see all" are text with a chevron** ("All invoices ›"), in secondary text, at the top right of a card's header,
  never a button.
- **Icon-only buttons are white circles** (the bell, the mail buttons on a contact), 40 px, with the icon in ink. A dot on the
  bell says there is something new (the deep green).

### 1.6 Structure and taste

- **The frame.** The whole app is one rounded block (a large radius, about 32 px at 1440) of a dark rail and a warm canvas. On
  a real screen the frame fills the window and only its left edge shows the rail.
- **The rail** (about 80 px wide, `#101614`) holds the logo (a green rounded square with the mark in ink) at the top, a column
  of icon buttons for the areas, and settings and help at the bottom. Icons are line icons of one weight, light grey; the
  active one sits on a green tile with its icon in ink. There are no labels: a tooltip names each.
- **The top bar has no bar.** Its parts float on the canvas: the section tabs in a white pill (left) and the notification and
  account pills (right). There is no border and no background behind them. The account pill shows the avatar, the name in ink,
  the email in muted text and a chevron.
- **The tabs are a segmented pill**: a white container with the tabs as plain words, and the active one a black pill with white
  words. They are the sections of the area the rail chose.
- **The page header** is an eyebrow with a status chip, a large regular-weight title, the meta line, and the actions aligned to
  the bottom right of the header, on the meta line's baseline.
- **The grid** is twelve columns with 16 px gutters: the main column takes eight (four KPI tiles, then wide cards), the aside
  four (the risk card, contacts). The aside starts level with the KPI tiles, not below them.
- **Cards** are white, borderless, shadowless, with a generous radius (about 20 px) and 24 px padding. A card's header is its
  title (with an icon when it is an analysis, and a count badge when it is a list) on the left and a link or a muted note on the
  right ("Last 18 invoices", "All invoices ›").
- **KPI tiles** are small cards: a muted label, a large value, a muted context line. Four in a row, equal width.
- **Lists inside cards** are rows divided by hairlines, with generous height (about 64 px), and no zebra striping and no header
  row: the columns explain themselves (an id, a description, a date, a status, an amount).
- **The taste** is calm, warm and editorial: few colours, two weights, large regular numbers, soft rounded shapes, no borders
  or shadows on what sits on the page, and space doing the work lines usually do. It looks like a well-set report more than a
  control panel, and the one green button is never in doubt.

---

## 2. Principles

1. **Neutral first.** A page is built in ink, greys, canvas and card. Colour is added only to say something (a state, the main
   action, the current place).
2. **One thread.** At most one warning colour per page, worn by everything that tells the same story.
3. **Colour never alone.** Every coloured state has words or a sign beside it (a chip's text, a bar's label and number, an
   arrow). A scheme can change every colour and nothing becomes unreadable.
4. **Bright fills, dark words.** A bright colour is a fill (a bar, a dot, a button, a tile). Text in a colour is always that
   colour's dark version (`*-text`), which meets 4.5:1 on its tint and on a card.
5. **Size and colour make the hierarchy, not weight.** Regular and medium only.
6. **Flat on the page, lifted only when moving.** Cards have no shadow and no border in light mode. A shadow appears only on
   what floats over the page (a menu, a dialog, a toast, the panel beside the page).
7. **One green button per page; one black button per card.** Everything else is secondary or a link.
8. **Everything is rounded**: pills for controls and chips, a large radius for cards, a larger one for the frame.
9. **Roles, not values.** No component names a colour, a radius or a region's width. It names a role, and the scheme and the
   layout give the values.

---

## 3. Tokens: three layers

```
primitives (a scheme's own palette)       --meadow-green-500: #3bd968; …
        ↓  a scheme maps its primitives onto the roles
roles (what every component uses)         --brand: var(--meadow-green-500); --card: #fff; …
        ↓  components read roles only (Tailwind: bg-card, text-muted, bg-brand …)
component tokens (a few, for shape)       --radius-card, --control-h, --rail-w …
```

- **Primitives** belong to one scheme and are never used outside its own file.
- **Roles** are the contract. Every scheme defines every role, in light and dark. A role's name says what it is for, never
  what it looks like (`--positive`, not `--green`).
- **Component tokens** are shape and size (radius, heights, gaps). They are shared by every scheme, and a layout may change a
  few of them (section 6).

The roles are the admin's existing tokens (`--background`, `--foreground`, `--surface`, `--border`, `--muted`, `--brand-*`,
`--danger`, `--chart-*`, `--tone-*`) plus the new ones below, so today's pages keep working while they move over (section 8).

---

## 4. Colour roles and the `meadow` scheme

### 4.1 Surfaces and text

| Role | Tailwind | Used for | `meadow` light | `meadow` dark |
|---|---|---|---|---|
| `--canvas` | `bg-canvas` | The page under the cards | `#f0f1eb` | `#0c100f` |
| `--card` | `bg-card` | Cards, the tab bar, pills, round buttons, the secondary button | `#ffffff` | `#151a19` |
| `--sunken` | `bg-sunken` | A highlighted row in a card, a count badge, a bar's track, a neutral chip | `#f6f7f2` | `#1b2120` |
| `--rail` | `bg-rail` | The icon rail | `#101614` | `#070a09` |
| `--rail-icon` | `text-rail-icon` | The rail's icons | `#a7abaa` | `#9aa09d` |
| `--ink` | `text-ink` | Titles, values, ids, amounts, the main text | `#101614` | `#eef0ea` |
| `--ink-2` | `text-ink-2` | Secondary text: the meta line, inactive tabs, dates, row labels | `#464a46` | `#b7bcb8` |
| `--muted` | `text-muted` | Labels, descriptions, context lines, eyebrows, captions | `#676c68` | `#8f9591` |
| `--faint` | `text-faint` | Decoration only: an axis tick, a disabled control | `#9d9f9c` | `#5f6562` |
| `--line` | `border-line` | Hairlines: a list's rows, a card's sections | `#ecede7` | `#262c2a` |
| `--edge` | `border-edge` | A control's border: the secondary button, a field | `#d9dbd2` | `#333a37` |
| `--inverse` | `bg-inverse` | The active tab, a card's black button | `#101614` | `#eef0ea` |
| `--inverse-ink` | `text-inverse-ink` | Words on `--inverse` | `#ffffff` | `#101614` |

Dark mode inverts the light ink but keeps the structure: the rail stays the darkest region (so a hairline `--line` separates it
from the canvas), cards are a step lighter than the canvas, and **cards get a 1 px `--line` border in dark mode**, because the
surfaces are too close in luminance (1.09:1) to be told apart by fill alone.

### 4.2 Brand and actions

| Role | Tailwind | Used for | `meadow` light | `meadow` dark |
|---|---|---|---|---|
| `--brand` | `bg-brand` | The main action's fill, the active rail tile, the logo tile | `#3bd968` | `#3bd968` |
| `--brand-ink` | `text-brand-ink` | Words and icons on `--brand` | `#101614` | `#0c100f` |
| `--brand-hover` | — | The main action under the pointer | `#33c95d` | `#52e07b` |
| `--brand-text` | `text-brand-text` | The brand as text (a link in a sentence, the active sidebar item) | `#0b6630` | `#5fe08a` |
| `--brand-soft` | `bg-brand-soft` | The brand as a tint (the active sidebar item, a selected option) | `#e6f6ec` | `rgb(59 217 104 / 0.14)` |
| `--focus` | — | The focus ring (the deep green of the bell's dot, darkened to reach 3:1 on the canvas) | `#0d944b` | `#5fe08a` |

`--brand-ink` is ink, not white: white on this green is 1.86:1. A scheme whose brand is dark (an indigo, say) sets
`--brand-ink` to white. The component never chooses.

### 4.3 Signals

Each signal has the same four roles, so a component written for one works for all:

| Signal | Meaning | `-solid` (fills: bars, dots) | `-text` (words) | `-soft` (chip and panel tint) | `-line` (a tinted edge, dark mode) |
|---|---|---|---|---|---|
| `positive` | Good, done, on time | `#3bd968` | `#0b6630` | `#ecf7ef` | `#bfe8cc` |
| `warning` | Watch this, at risk, drifting | `#f0bf2e` | `#7a5d00` | `#f9f1de` | `#ecdcae` |
| `danger` | Wrong now: overdue, failed | `#e4554f` | `#9f2719` | `#fae8e5` | `#f2c7c1` |
| `neutral` | Pending, not yet a state | `#97a29a` | `#464a46` | `#f6f8f3` | `#e2e4dc` |
| `insight` | What the AI noticed (the "What changed" panel) | `#11a356` | `#0b6630` | `#e2f3e9` | `#c4e6d1` |

Dark values follow the same rule: `-solid` stays bright, `-text` becomes the light version (positive `#5fe08a`, warning
`#f2c94c`, danger `#ff8a80`, neutral `#b7bcb8`), `-soft` becomes the colour at 14 % over the card. All measured: every
`-text` meets 4.5:1 on its `-soft` and on `--card`, in both modes (on its tint: positive 6.5, warning 5.5, danger 6.4,
neutral 8.4, insight 6.2 in light; 7.9, 8.3, 6.6, 7.3, 8.8 in dark). A `-solid` does not reach 3:1 on a card in light mode
(green 1.9, amber 1.7): that is why a dot or a bar always comes with its words.

`positive` and `brand` are the same green in `meadow`. That is the scheme's choice, not a rule: a scheme may give its brand a
colour of its own and keep `positive` green.

### 4.4 Charts

The existing chart roles (`--chart-1…6`, `--chart-seq-*`, `--chart-good/bad/warn`, `--chart-grid`, `--chart-axis`,
`--chart-compare`, `--tone-1…5`) stay and each scheme sets them. In `meadow`:

- A chart of one series that carries a judgement takes that judgement's signal: the "days to payment" line is `warning-solid`,
  its area a gradient from `warning-soft` to transparent, and its last point a dot of the same colour. A series without a
  judgement takes `--chart-1`.
- `--chart-grid` is `--line`, `--chart-axis` is `--faint`, and axis labels are `--muted` (they are read).
- The comparison figure in a chart's header ("28 › 41 days") is the old value in muted text, a chevron, and the new value in
  the series' `-text`.
- `--tone-1…5` (support's tone bands) map to danger, a red-amber, neutral, a light positive, positive.

### 4.5 Elevation

| Role | Light | Dark | Used for |
|---|---|---|---|
| `--shadow-none` | none | none | Cards, tiles, the tab bar, pills on the page |
| `--shadow-float` | `0 12px 32px -8px rgb(16 22 20 / 0.18), 0 2px 6px rgb(16 22 20 / 0.06)` | `0 12px 32px -8px rgb(0 0 0 / 0.6)` | Menus, popovers, the AI manager's panel, toasts |
| `--shadow-modal` | `0 24px 64px -12px rgb(16 22 20 / 0.28)` | `0 24px 64px -12px rgb(0 0 0 / 0.7)` | Dialogs |

---

## 5. Type, shape, spacing and components

### 5.1 Type scale (Inter; 1440 px window; fluid below `md`)

| Token | Size / line | Weight | Tracking | Used for |
|---|---|---|---|---|
| `display` | 40 / 44 | 400 | −0.03 em | The page title ("Alderney Ceramics") |
| `metric-lg` | 48 / 48 | 400 | −0.03 em | A single headline figure in a card ("72") |
| `metric` | 28 / 32 | 400 | −0.015 em | A KPI tile's value ("$842,000") |
| `title` | 17 / 24 | 500 | −0.01 em | A card's title ("Payment behaviour") |
| `body-lg` | 16 / 24 | 400 | 0 | The meta line under the page title, an insight's text |
| `body` | 14 / 20 | 400 | 0 | Most text: rows, labels, buttons, tabs |
| `body-strong` | 14 / 20 | 500 | 0 | An id or an amount in a row, a button's words |
| `caption` | 12 / 16 | 400 | 0 | A KPI's context line, an axis label |
| `chip` | 12 / 16 | 500 | 0 | A chip's words |
| `eyebrow` | 11 / 16 | 500 | +0.06 em, uppercase | "CUSTOMERS", "WHAT BUILDS THIS SCORE" |

Numbers in rows and tiles are `tabular-nums`. Never 600 or 700.

### 5.2 Shape and space

| Token | Value | Used for |
|---|---|---|
| `--radius-frame` | 28 px | The app's outer block (when the window is larger than the content) |
| `--radius-card` | 20 px | Cards and KPI tiles |
| `--radius-panel` | 16 px | A panel inside a card (the insight), a highlighted row |
| `--radius-pill` | 9999 px | Buttons, chips, the tab bar and its tabs, the account pill |
| `--radius-tile` | 12 px | The rail's tiles and the logo |
| `--control-h` | 44 px (header), 36 px (in a card), 32 px (dense) | Buttons, the tab bar, fields |
| `--icon-btn` | 40 px | Round icon buttons |
| `--gap` | 16 px | Between cards, both ways |
| `--pad-card` | 24 px | Inside a card (20 px in a KPI tile) |
| `--pad-page` | 32 px | Between the rail and the content, and at the top |
| `--row-h` | 64 px | A list's row in a card |

The spacing scale is 4, 8, 12, 16, 20, 24, 32, 40, 48.

### 5.3 The rail

80 px wide, `bg-rail`. The logo tile (40 px, `bg-brand`, mark in `brand-ink`) at the top, 32 px of space, then the areas as
44 px tiles with 20 px line icons in `rail-icon`, 12 px apart. The active area is `bg-brand` with its icon in `brand-ink`. A
hovered one is the rail's colour lightened 8 %. Settings and help sit at the bottom. Each tile has a tooltip and an
`aria-label`, and the active one is `aria-current="page"`.

### 5.4 The top bar

No background, no border. On the left, the tab bar: a `bg-card` pill, 44 px high with 4 px padding, holding the tabs as
36 px pills of `body` text in `ink-2`. The active tab is `bg-inverse text-inverse-ink`; a hovered one is `bg-sunken`. On the
right, a round notification button (`bg-card`, an unread dot in `--focus`) and the account pill (`bg-card`, the avatar, the
name in `ink`, the email in `muted` `caption`, a chevron).

### 5.5 The page header

An eyebrow line (`eyebrow` in `muted`, then a status chip), 8 px, the title (`display` in `ink`), 8 px, the meta line
(`body-lg` in `ink-2`, facts joined by " · "). The actions sit on the right, aligned to the meta line's bottom: secondary,
main, more. On a phone the actions wrap under the meta line and the main action takes the full width.

### 5.6 Buttons

| Kind | Look | When |
|---|---|---|
| Main | `bg-brand text-brand-ink`, pill, medium, optional icon at the start, hover `--brand-hover` | The page's one main action |
| Strong | `bg-inverse text-inverse-ink`, pill, full width in a card | A card's own conclusion, at its foot |
| Secondary | `bg-card text-ink border border-edge`, pill, hover `bg-sunken` | Every other action |
| Quiet | No fill, `text-ink-2`, hover `bg-sunken` | Toolbars, a row's own action |
| Icon | 40 px circle, `bg-card`, icon in `ink` | The bell, mail, more (`···`) |
| Link | `text-ink-2`, a chevron after, hover `text-ink` | "All invoices ›" |
| Danger | `bg-danger-soft text-danger-text`, pill | Deleting, ending, refusing |

Focus is a 2 px `--focus` outline (3.5:1 on the canvas) 2 px outside the button, on every kind. A disabled button keeps its shape at 45 % opacity.

### 5.7 Chips and badges

A chip is a pill, 24 px high, 10 px side padding, `chip` text, with a 6 px dot before the words when it is a state: `bg-{signal}-soft
text-{signal}-text`, the dot `{signal}-solid`. A **count badge** ("4" beside "Open invoices") is a 22 px circle or pill in
`bg-sunken` with `caption` text in `ink-2`. A **trend chip** ("^ Up 11 since June") is a chip with an arrow in place of the dot;
its signal is what the change means (worse is `warning` or `danger`), never its direction.

### 5.8 Cards, tiles, bars and lists

- **Card**: `bg-card`, `--radius-card`, `--pad-card`, no border or shadow in light mode (a `--line` border in dark mode and
  under `forced-colors`). Its header: the title (`title`, optional 18 px icon in `ink-2` before it, optional count badge after)
  on the left, and a muted note or a link on the right.
- **KPI tile**: a card with 20 px padding, label (`body`, `muted`), 8 px, value (`metric`, `ink`), 4 px, context (`caption`,
  `muted`).
- **Share bar** ("Paid on time 58%"): a line with a 8 px dot and a label in `ink-2` on the left, the figure in `body-strong`
  on the right, and a 8 px bar under it: the track `bg-sunken`, the fill `{signal}-solid`, both fully rounded. The label and
  figure are what is read; the bar repeats them.
- **Score bar** ("Payment history +22"): label (`ink-2`) left, a 112 px bar, the points (`muted`) right. One signal for the
  whole list (the page's thread).
- **Insight panel** ("What changed"): `bg-insight-soft`, `--radius-panel`, 20 px padding, a header of the sparkle icon and the
  title in `insight-text` `body-strong` on the left and the time in `muted` `caption` on the right, then the text in
  `body-lg` `ink`. Only for what the AI wrote, and always with when it was written.
- **List in a card**: rows of `--row-h`, divided by `border-line`, no header row, no zebra, no hover colour on rows that are
  not links (a linked row gets `bg-sunken` on hover). Columns: id (`body-strong`, `ink`), description (`body`, `muted`), date
  (`body`, `ink-2`), state (a chip), amount (`body-strong`, `ink`, right-aligned, tabular).
- **Highlighted row** (the primary contact): `bg-sunken`, `--radius-panel`, with a small `positive` chip naming why.
- **Avatar**: a circle, 40 px in a list, 32 px in the account pill.

### 5.9 Motion

The same rules as D149: colour, opacity and small transforms only, 150–200 ms with `--ease`, every motion stopped by
`prefers-reduced-motion`. A main button lifts 1 px under the pointer. Cards do not move. A linked card shows `bg-sunken` on its
header only.

---

## 6. Layouts

A **layout** is a named arrangement of the shell's regions. Every page is drawn in the same regions, and the layout decides
which exist, where they sit and how wide they are. Components fill regions and never ask which layout they are in.

### 6.1 The regions

| Region | Holds | Today (D107/D144) |
|---|---|---|
| `rail` | Area icons, the logo, settings and help | The level switcher and the areas (`NavArea`) |
| `sidebar` | A section's pages under headings | `StoreSidebar` / `AreaSidebar` (`groups`) |
| `topbar` | The tabs, notifications, the account | The header with `StoreTabs`, `actions`, `AccountMenu` |
| `page-header` | Eyebrow, status, title, meta, actions | Each page's own `<h1>` block |
| `main` | The page's content | `AdminMain` |
| `aside` | A right column of supporting cards | Pages that make their own |
| `panel` | The AI manager beside the page | `AiManagerChat` |

### 6.2 Layout tokens

Each layout sets these on `html[data-admin-layout="…"]` (or the shell element):

```css
--rail-w        /* 80px, or 0 when there is no rail */
--sidebar-w     /* 0, or 208px when the sidebar is shown */
--topbar-h      /* 64px floating, or 56px for a bordered bar */
--content-max   /* none for full width, or a max width */
--main-cols     /* how many of the 12 columns main takes when an aside is shown: 8 */
--frame-radius  /* --radius-frame, or 0 when the frame fills the window */
```

### 6.3 The layouts

| Layout | Regions | For |
|---|---|---|
| `rail` (the reference) | rail, topbar (floating: tabs, notifications, account), page-header, main + aside (8 + 4 columns) | Records and overviews: a customer, an order, the control center, a store's home |
| `rail-sidebar` | rail, sidebar (208 px), topbar, page-header, main | Sections with many pages: Settings, Website, the platform's sections. The rail picks the area, the sidebar the page, the tabs nothing (they are hidden) |
| `focus` | topbar (back link, title, actions), main only, `--content-max: 760px` | Forms and wizards: the setup wizard, a settings page that is one form, sign-in |
| `workspace` | rail (collapsed to 64 px), topbar, main at full width with its own columns | Tools with their own columns: the page builder, the support inbox, the media library |
| `classic` | No rail; topbar with the level switcher and tabs; sidebar | Today's admin (D107), kept until every level has moved |

A level (platform, owner, store) chooses its layout, and a page may ask for another one within its level (`focus` for a
wizard, `workspace` for the builder), as `fullWidth` does today. A phone (under `md`) draws every layout the same way: no rail
and no sidebar, the topbar with a menu button that opens the rail's areas and the sidebar's pages in the slide-out menu
(`MobileMenu`), and `aside` under `main`.

---

## 7. Adding a scheme or a layout

### 7.1 A colour scheme

1. **Choose its primitives** in a file of its own, `src/app/admin/schemes/{id}.css`, and map them onto **every role** of
   section 4, once for light (`html[data-admin][data-admin-scheme="{id}"]`) and once for dark (the same selector inside
   `@media (prefers-color-scheme: dark)` with `:not([data-color-mode="light"])`, and with `[data-color-mode="dark"]`, as
   `admin.css` does today):

   ```css
   html[data-admin][data-admin-scheme="clay"] {
     /* primitives: only used in this file */
     --clay-900: #1d1714; --clay-50: #f5efe9; --clay-500: #d9653b; …
     /* roles: every one of section 4 */
     --canvas: var(--clay-50);
     --card: #ffffff;
     --sunken: #faf6f1;
     --rail: var(--clay-900);
     --ink: var(--clay-900);
     --brand: var(--clay-500);
     --brand-ink: #ffffff;   /* white reads on this darker brand */
     …
   }
   ```

2. **Register it** in `ADMIN_SCHEMES` (`src/lib/admin-schemes.ts`): its id, its name in the interface, a swatch (canvas, rail,
   brand) for the picker, and whether it is offered (`offered: false` while it is being made).
3. **Run the contrast test** (`admin-schemes.test.ts`). It reads every scheme's values from its file and fails unless:
   - `ink`, `ink-2`, `muted` reach 4.5:1 on `card`, `canvas` and `sunken`;
   - `brand-ink` reaches 4.5:1 on `brand`, `inverse-ink` on `inverse`, `rail-icon` 4.5:1 on `rail`;
   - each signal's `-text` reaches 4.5:1 on its `-soft` and on `card`; a `-solid` is not tested, because a dot or a bar
     always comes with its words (section 1.2), and a test reads the page's markup for that instead (`signal-words.test.ts`);
   - `--focus` reaches 3:1 on `card` and `canvas`;
   - every role is set, in light and in dark.
4. **Look at it** on the scheme preview page (`/admin/account/appearance`, D222): one screen with every component of
   section 5 in each mode.

The second scheme to make is **`indigo`**: today's D149 colours expressed as roles. It proves the mechanism and lets anyone who
prefers the current look keep it.

### 7.2 A layout

1. **Register it** in `ADMIN_LAYOUTS` (`src/lib/admin-layouts.ts`): its id, the regions it draws, and which levels and pages
   may use it.
2. **Write its block** in `src/app/admin/layouts/{id}.css`: the tokens of section 6.2 and the grid that places the regions
   (`grid-template-areas` on the shell), plus its phone rules if they differ from the default.
3. **Draw it** in `AdminFrame`, which reads the layout and renders only its regions. A region a layout leaves out is not
   rendered (never hidden with CSS), so its links are not in the page twice.
4. **Test it**: `admin-layouts.test.ts` checks that every layout's regions are known and that every page in `ADMIN_PAGES` is
   reachable in it (from the rail, the sidebar, the tabs or the slide-out menu); `e2e/admin-layouts.spec.ts` (signed-out pages
   only, as `a11y.spec.ts`) checks no horizontal scroll at 375 px and that the main action stays in view.

### 7.3 Who chooses

The scheme is the account's, like its colour mode (D99): `accounts.admin_scheme`, chosen under Your account › Colour scheme, with
`meadow` the default. The platform may set a default for new accounts. The layout is the level's and the page's, not the
person's: what is drawn should be the same for everyone on the same page, so that help, screenshots and the AI manager's
directions are right.

---

## 8. Moving today's admin over

- **Roles that already exist keep their names**, so pages written in them change look without being touched:
  `bg-background` becomes the card (`--background: var(--card)`), `bg-surface` the sunken surface, `border-border` the line,
  `text-muted` the muted grey, `text-foreground` the ink. The page's own background becomes `--canvas`.
- **The main action**: today `bg-foreground text-background` is drawn as the brand with white words (D149). In `meadow` the
  same class draws `bg-brand text-brand-ink`, so the words turn ink automatically. The rule "white words on the brand" is gone:
  the scheme decides.
- **Headings drop to 400–500** (today `h1` is 650), and the large title uses `display`.
- **Cards lose their shadow** (today `.border.bg-background` gets `--shadow-sm`). Until the `Card` component lands they keep a
  hairline `--line` border in light mode too, because many pages nest bordered boxes inside a card and rely on it.
- **The header's gradient line goes.** The top bar has no bar in `rail`, and a plain `--line` under it in `classic`.
- **Red** (`text-red-700` etc., D149's `--danger`) becomes `danger-text`, and the soft reds become `danger-soft`.
- **New Tailwind names** (`bg-canvas`, `bg-card`, `bg-sunken`, `text-ink`, `text-ink-2`, `text-faint`, `bg-brand`,
  `text-brand-ink`, `bg-inverse`, `text-inverse-ink`, `bg-{signal}-soft`, `text-{signal}-text`, `bg-{signal}-solid`) are added
  to the admin's `@theme` so pages can say what they mean. Old pages move to them as they are touched.
- **Order of work**: roles and `meadow` in `admin.css` (light and dark), then the components of section 5 (`Button`, `Chip`,
  `Card`, `KpiTile`, `ShareBar`, `InsightPanel`, `ListRow`), then the `rail` layout for the store level, then the other
  levels, then `indigo` and the scheme picker.

**Built so far.** Step 1, the roles and `meadow` (D217): `src/app/admin/schemes/meadow.css` sets every role in light and dark,
`admin.css` maps the older names onto them and reads roles only (no colour of its own), the role names are in the `@theme`
of `globals.css`, the registry is `src/lib/admin-schemes.ts` (`ADMIN_SCHEMES`, `ADMIN_ROLES`, `CONTRAST_RULES`) and
`src/app/admin/admin-schemes.test.ts` holds every scheme to it.
Step 2, the components (D218): the type scale and shapes of 5.1 and 5.2 are Tailwind names in `globals.css`'s `@theme`
(`text-display`, `text-metric`, `text-title`, `text-body-strong`, `text-caption`, `text-chip`, `text-eyebrow`; `rounded-card`,
`rounded-panel`, `rounded-pill`, `rounded-tile`), and `src/components/admin/ui/` holds `Button`/`ButtonLink` (5.6), `Chip`,
`TrendChip`, `CountBadge` (5.7), `Card`, `KpiTile`, `ShareBar`, `ScoreBar`, `InsightPanel`, `List`/`ListRow` with `RowId`,
`RowText`, `RowDate`, `RowAmount` (5.8) and `PageHeader` (5.5), server components in the roles only (`ui.test.ts` scans them for
a colour, an older token or a bold weight). Pages move to them as they are touched.
Step 3, the `rail` layout for the store level (D219): `src/lib/admin-layouts.ts` (`ADMIN_LAYOUTS`: `classic` and `rail`,
their regions, `LEVEL_LAYOUTS`) and `AdminFrame`'s `layout`. In `rail` the store's sections are `AdminRail`'s icon tiles (Settings,
marked `foot` by `storeTabs()`, at the bottom; a waiting count on the tile and in its name), the top bar has no background,
line or tabs (the switcher, the actions, the account), and a section with pages of its own keeps its sidebar beside the rail
(the `rail-sidebar` arrangement, chosen by the section, not a layout of its own yet). The tokens of 6.2 are Tailwind classes in
the frame for now, not a `layouts/{id}.css`. Step 4 (D220): the platform (`platformTabs()` in `platform-nav.ts`, Settings at the
foot, the requests and support counts on their tiles) and the owner's level (`ownerTabs()`, Account at the foot) are `rail` too;
hosting, one page with no sections, stays `classic`. Step 5 (D221): `indigo` (`src/app/admin/schemes/indigo.css`, D149's look
as roles, white words on its brand) is the second scheme, and the picker is the *Colour scheme* field on Your account
(`SchemeField` in `src/components/admin/admin-scheme.tsx`): kept on the account (`accounts.admin_scheme`, a check listing every
scheme, held to `ADMIN_SCHEMES` by a test) and in the browser (`kaizen_admin_scheme`), put on `<html>` before the page is drawn
by `adminSchemeScript()`, and brought in line on another device by `AdminSchemeSync`. A new scheme widens the check in a
migration. A default for new accounts is not built.
Step 6 (D222): the scheme preview page is `/admin/account/appearance` (Account's sidebar, linked from Your account): light or
dark, the scheme, and every offered scheme in light and in dark side by side (`SchemePreview` in
`src/components/admin/scheme-preview.tsx`: every component of section 5 and a still rail on a sample page, `inert`, named by its
figure). A scheme's file also applies to an element marked `data-scheme-preview="{id}"` (and `data-preview-mode="dark"`), which is
what lets a page show a scheme it is not drawn in; a preview only reads roles, so the older names that `admin.css` maps on `<html>`
do not follow it, and a component meant for the preview uses the role names.
Step 7, moving the pages over (D223, started): a codemod moved what every page shared, in `src/app/admin` and
`src/components/admin`: page titles to `text-display text-ink` (205), every 600 and 700 weight to 500 (244), a section's card
(`rounded-lg … p-5` and larger) to `rounded-card` (141; boxes inside a card keep their corners), and the main action and the
bordered secondary buttons to pills (106). The overview parts (`Stat`, `Attention`, `Section`) are KPI tiles, a card of rows and a
title, so the platform's overview, the control center, a store's Home and the Work and invoice overviews follow; the store's Home
and the control center are on `PageHeader`, `Card` and `List`. Where a store's own look or a printed document is drawn (the builder's
stand-ins, the theme editor's preview, previews of a store's pages, packing slips, the print routes) nothing changed.
`admin-type.scan.test.ts` keeps it so.
Step 8, colours (D224): a second codemod wrote every page in the roles. The older names became roles (`bg-background` `bg-card`,
`bg-surface` `bg-sunken`, `border-border` `border-line`, or `border-edge` on a button, `divide-border` `divide-line`,
`text-foreground` `text-ink`, the main action `bg-brand text-brand-ink`, `bg-foreground` alone `bg-brand`, behind a variant or with
an opacity `bg-inverse`, `border-foreground` `border-brand`, `accent-foreground` `accent-brand`), and fixed palette colours became
signals (red `danger`, amber `warning`, green `positive`, blue `insight`, grey `neutral`; text `-text`, a pale fill `-soft`, a
strong fill `-solid`, a border `-line` or `-text`; their `dark:` twins removed, as the roles carry dark). A solid red button with
white words is the danger button (`bg-danger-soft text-danger-text`). `admin.css` matches both spellings while the old one is still
used where a store's look is drawn. The scan test now refuses an older name or a fixed colour in the admin, apart from colours that
are someone else's on purpose (the builder's resize handles, carriers' marks, the search engine's preview).
Step 9, structure (D225): every signed-in page is titled by `PageHeader`, which gained `back` (the page it belongs under, a chevron
link above the title) and `description` (a sentence at a 75-character measure, under the meta line). A codemod moved the 178
pages whose title block was a title, an optional back link and an optional description (the description's JSX moved as written,
its line breaks joined by JSX's own rule), and 13 detail pages with a badge, an avatar, a code or actions beside the title were
moved by hand (badges to `status`, facts to `meta`, buttons to `actions`). 49 section cards whose first child was their own `h2`
are `Card` (`compact` keeps their 20 px). The scan test refuses an `h1` of a signed-in page's own, except the compact tools and
notices (the setup wizard, the support inbox, the product editor, the switched-off notice, the printed report, the error page) and
screen-reader titles; the sign-in, two-step and OAuth pages keep theirs until the `focus` layout. Next: the 35 cards with an
action beside their title (to `Card`'s `aside`), tables to a list in a card where they are lists, and the `focus` layout.

Step 10, the remaining cards (D226): `Card` gained `description` (a muted sentence under the title) and `level={4}`. The 35
cards left moved: title and hint to `title` and `description`, an action beside the title (a switch, *Edit items*, *Add another
version*) to `aside`, and a box named another way (an `aria-label`, a screen-reader title, a fieldset, a form, a list item, a
notice) keeps its element with `CARD_CLASS`. No card is a bordered box of its own any more, and the scan test keeps it so. Next:
tables to a list in a card where they are lists, and the `focus` layout.

Step 11, lists (D227): a table whose rows are things you open, each with a few facts of its own, is a `List` in a `Card`. The
list parts gained `RowLead` (title, a link when the row has buttons of its own, a sub line, an avatar), `RowFact` (a fact that
names itself, since there is no header row) and `RowActions` (the row's buttons, quiet and dense, on the right); a status is a
`Chip`. Tables stay where figures are compared down a column, where rows are edited or selected, where a document's lines are
listed and where values are to be copied. Next: the `focus` layout for the signed-out pages.

Step 12, focus (D228): the sign-in, forgotten-password, two-step and consent pages are drawn by `FocusFrame`: Kaizen's mark in a
plain top bar and one card on the canvas (440 px, 560 px for the two-step set-up) with the page's `h1`, a sentence and the form,
and no level's navigation. `focus` is in `ADMIN_LAYOUTS`; the scan test requires it of every signed-out page. `SubmitButton` is a
pill. Not built yet: `focus` for signed-in pages that are one form (the setup wizard), and the `workspace` layout.

Step 13, the setup wizard (D229): a level's `AdminFrame` takes `focus` (the addresses drawn so, a way back, a title) and draws
those pages without the rail, the sidebar, the menu and the level's actions, the top bar holding the way back and what is being
done, the page in one 760 px column. The store's level asks it for its setup wizard. Next: the `workspace` layout.

Step 14, workspace (D230): a level's `fullWidth` and `workspaceLinks` addresses are drawn beside a rail narrowed to 64 px, without
the sidebar, at the whole width: the page editors, the media library and the support inbox at every level. The inbox's section
pages move to a row of links in the top bar (`AreaLinks`). Every layout of 6.3 is now built: `rail` (and its sidebar), `focus`,
`workspace` and `classic` (hosting).

---

## 9. Do and don't

- **Do** give every coloured thing its words. **Don't** use a colour to say something nothing else says.
- **Do** use one warning colour for the page's story. **Don't** mix amber and red for the same kind of problem.
- **Do** put bright colours in fills and dark ones in text. **Don't** write words in `-solid`.
- **Do** keep red for what is wrong now. **Don't** colour "due soon" red.
- **Do** make the page's main action green and the only green button. **Don't** put two main actions on a page.
- **Do** let space separate things. **Don't** add a border or a shadow to a card on the page.
- **Do** use regular and medium. **Don't** use bold for emphasis; use size or `ink`.
- **Do** mark what the AI made with the sparkle and its time. **Don't** give AI its own colour.
- **Do** keep figures tabular and right-aligned in lists. **Don't** centre numbers.
- **Do** name a role. **Don't** write a hex value, a fixed Tailwind colour (`text-gray-500`, `bg-green-400`) or a one-off shadow
  in a page.

## 10. Open questions

- The reference's rail has no labels. Kaizen's admin has many more areas than the reference's eight. Either the rail shows
  the level's sections only (Orders, Products, Customers, …, about nine) and the sidebar the rest, or it grows labels on hover.
  This document assumes the first.
- The brand green is also the positive colour. If Kaizen wants its brand to be something other than "good", a scheme can split
  them (section 4.3), but `meadow` as drawn keeps them together.
- Inter Display is not loaded today; the `display` size may use Inter with the same tracking until it is.
