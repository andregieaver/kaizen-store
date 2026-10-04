# Copying another website's page (D150)

On a store's **Create a page with AI** page (`/admin/{store}/pages/ai`) the owner can give the address of a page on another
website, choose how many times the AI may improve its copy (1–10), confirm they have the right to copy it, and press
**Replicate**. The page is rebuilt in the page builder as a draft, step by step in front of the owner, who can stop it at any time.

## What the owner sees

- A bar and a stepper: *Opening the page → Examining design and layout → Downloading the text → Downloading pictures, videos and
  fonts → Building the page → Checking and improving → Summary*, with what the AI is doing in a sentence and a running log.
- Under the bar, a **live preview**: a photograph of the original beside a photograph of the copy as it was last measured, at
  computer or phone width, scrolling together, with the match after each pass.
- **Abort**, which stops the job at its next safe point (or at once when nothing is running) and gives a summary of what was done.
- At the end a **summary** in plain sentences, written in code from facts (never by a model): what went well, what failed or is
  not as it was, the match with the original at both widths, and links to preview the draft and open it in the builder.

## How it works

A job (`commerce.page_replications`) is run by **ticks**: `POST /admin/{store}/pages/ai/replicate/{job}/tick` does the next unit of
work under a lock and returns the job as the panel reads it (`ReplicaJob`). The open page keeps asking, and asks
`GET …/replicate/{job}` while a tick runs to show the log. A job left standing (the tab was closed) is taken up again where it
stopped when the owner returns, and is replaced if nobody comes back for two hours. Nothing runs without a person at the page:
no cron holds Chromium.

| Step | What it does |
|---|---|
| open | Opens the page in Chromium at 1440 and 390 px (`src/lib/replicate-open.ts`): scrolls it through so lazy pictures load, stills animations, hides what floats over it (cookie banners, chat widgets), photographs it, reads every box and its styles (`extractPage()`, `src/lib/replicate-extract.ts`), and photographs the pictures that are drawn rather than files (icons, canvases, widgets). |
| examine | The site's AI (the *Model that sees pictures* of the AI settings, D163, else the text model: `seeing()`) looks at the photographs and the browser's digest and describes the design (palette, type, sections, what will be hard): `analyse()`. Without a text model that sees pictures it reads from the facts alone, or is skipped, and the summary says so. |
| copy | Counts and shows the text, exactly as the page has it (headings, paragraphs, lists, buttons, links). |
| assets | Downloads the pictures (kept as the store's own in the media library, WebP), video files (to the page-video bucket) and installs the typefaces that are in Google Fonts. Resumable; a tick works for up to 190 s. |
| build | `buildReplica()` (`src/lib/replicate-build.ts`) turns the measured boxes into rows, columns and blocks and a style sheet; the page is saved as a draft through `savePage()`. |
| refine | Pass 0 measures the first copy; each following pass (up to the owner's number) sets spacing right by measuring, lets the AI change what it can see is off, saves, and measures again. A copy that matches as closely as pixels allow ends the job early. |

### The copy is built from measurements

Nothing about the page's structure is written by a model. Sections become rows, boxes side by side become columns, a line of
pieces (a menu, two buttons) becomes a column of side-by-side components, and text, pictures, buttons, videos and thin lines
become blocks; paragraphs of one look join into one rich-text block. Every size, space, colour and font is the original's
computed value, at both widths, kept as a **style model** (`src/lib/replicate-styles.ts`) of rules per part id, written into the
page's own CSS (D100) with the phone's rules in one media query. The builder's limits (50 rows, 100 blocks, 50 000 characters
of CSS) are kept, and what is cut is said in the summary. What the builder cannot hold is left out or simplified, and said: form
fields, fixed overlays, boxes inside boxes side by side (the contents are stacked), decorative shapes, text in more than one
colour inside a paragraph, a background picture that spans several rows (it is on the first).

### Repeated cards become a grid (D155, C1)

Boxes side by side that are *the same card repeated* (three or more in a row, or wrapped in equal rows; two in a track that scrolls
sideways with arrows beside it) are one `contentGrid` block of custom items, not columns of loose blocks (`src/lib/replicate-grid.ts`,
integrated in `flow()`/`rowSpecs()`/`makeGrid()` of `replicate-build.ts`). Only the page's own sections are looked at (a card inside a
painted box inside a section is flattened as before), and never a footer's columns, a menu, a form or boxes one under another.

- **Same card**: the same pieces in the same order and depth (a badge may come and go; a second picture or button is what mapping reports),
  widths within 10 %, heights within 20 %, equal gaps within 4 px, in equal rows.
- **A card becomes an item** from the browser's measurements only: the largest picture (with its own alt text; a picture drawn as a box's background, the usual
  thumbnail, is the card's picture when it has no other; one under 8 by 8 pixels as drawn, a tracking pixel or a spacer, is no picture and is left out and named),
  the first heading else the largest short text as the title, a link and one button's words, a badge (short text over the picture or on a pill, or the one label that
  stands above the title, a number or an eyebrow), a price *as text* by pattern (`isPriceText()`), a date by pattern (`parseDate()`: never a guess), up to three
  label-and-value lines (two pieces on one line with room between them; with no more than a word space between they are one sentence), the rest joined as text.
  **Every word of an item is a word of its card and no word of a card is lost** (the order of the words is kept too): text beyond what an item holds, a second
  button or link, cards some of which are only linked and others have a button, a list (an item's text is one paragraph), or words above the title that an item
  would show below it keep the whole group as columns, and the report says why ("3 of 6 cards hold a second button"). A few cards (up to a fifth) may hold
  something that is no words an item cannot hold (a second picture, an icon set, a video, a link to an address the builder would not accept, a link inside a
  sentence, a button that runs a script, words drawn with CSS): it is left out and named (`grid-card`). **What is not a link is not made one**: the card's link
  is a link of its own (a box wrapping the card, a heading that is a link from end to end), never one of the words inside a sentence, and a button is the item's
  button only when it is a link to that same address; a `<button>` with no address is a line of words. **Dates**: `parseDate()` takes a text that is nothing
  but a date (a weekday's name may stand in front, no other word); a date field is drawn in the shopper's language from its day, so its words are the
  capture's date words by the date they came to (the one place a word of an item is not letter for letter a word of the capture), and a date with a weekday in
  front stays words, as an item's date cannot hold the weekday. Bold, italic, underline and line breaks inside the words are not kept by an item's plain text:
  the words are, and the report says how many cards lost which mark (`grid-simplified`). Every item is checked against the builder's own schema before the group
  is built as a grid (`customGridItemSchema`): one it would refuse (an address over 1000 characters) keeps the group as columns, so a copy never fails at its save.
  **The cards are listed in the order they are seen** (row after row, left to right), whatever order the markup gives them (CSS `order`, a reversed row, a
  right-to-left page); a script slider's slides keep the library's own order.
- **The look** is measured too: columns per width (tablets are estimated, only two widths are captured), gap, tile (colour, border, corners,
  shadow, padding; a picture to the card's edges with inset words is drawn with margins on the words), image shape, heading level and size,
  button look, fonts through the font pipeline, and rules on the grid part (`#id li[data-item-id] …`, `suffixOk()` allows exactly those
  places) so the AI's patch plan can still adjust it. A picture that does not fill its card (an icon) keeps its own width and place.
- **Native scrollers** (a box that scrolls sideways, with previous and next buttons and dots beside it) are `display: "carousel"` with
  `arrows`, `dots` and `snap` read from the page; autoplay is only what the watch saw (below), which the report says. Two cards are a carousel only with
  previous and next buttons beside them (three are enough without); the buttons are found by their shape and class and by what the browser read of them
  (`CaptureNode.controls`: label, role, class near the track), as a script slider's are.
- **Script sliders** (D155, C2: Swiper, Slick, Splide, Owl, Embla, Glide, Flickity and the ones that have no name a reader would know) are read
  whole. The extractor finds a track by geometry (`sliderOf()`: a box clipped by itself or one of the two above it, its children in one row
  with some beyond the clip, moved by a transform or a row that does not wrap; or slides on top of each other with one showing), with library class
  names as hints and never a requirement (a stack of `display: none` slides needs one), and leaves out a track that never stops (a ticker, an
  infinite CSS animation). Every child of the track is kept **whether it shows or not** (`tileNodes()`: hidden, `visibility: hidden`, see-through,
  beyond the box; a `display: none` slide is shown for as long as it takes to be measured and put back), with a mark (`CaptureNode.slide`: why it is
  not in view, the library's copy marker and its own number for the slide, its words and picture addresses as the page draws them, lazy `data-src`
  and `srcset` included, and its parts as a skeleton read from the elements, so a slide with no box has one). The track has what the browser found
  round it (`CaptureNode.slider`: the clipping box, the library hints, previous and next buttons found by label, role or class, the pagination the
  page names as such).
  - **The real slides** (`readSlider()`): copies made to loop are left out by the library's marker (`swiper-slide-duplicate`, `slick-cloned`,
    `splide__slide--clone`, `glide__slide--clone`, `tns-slide-cloned`, `bx-clone`, `cloned`), then by a number of its own seen again
    (`data-swiper-slide-index`, `data-slick-index`; the one in view is the real one), then by content (the same words, pictures **and addresses** as a slide
    already kept) **only where there is evidence of a loop**: a marker or a number somewhere on the track, or copies standing at both ends of it, or a run of
    two at one end (`loopedEnds()`). A list that ends as it began (`A B C A`) is a list, and slides that say the same and go to different places are different
    slides. The order is the library's own numbers when every slide has one. A slider that had copies is `rewind: true`. The slides out of view are read from the
    page's text and pictures and are items like the others. A copy told by its marker is read for its words and pictures only (a stub with no parts), and at
    most 200 tiles of one track are read (`CaptureSlider.unread` counts the rest, and the report says how many), so a loop of copies or thousands of hidden slides
    never spend the page's node budget or its time.
  - **Built only when the slides are one kind of card** (the same checks as a static group, and the skeletons of the slides read from the elements,
    hidden ones included, must agree; every word the page draws in a slide must be in its item). A slider the converter cannot understand (a hero with
    different slides, a second button, slides of another width) stays as it was, the slides in view as columns, and `drop("grid-columns")` and the
    report say why and **how many slides' words the copy lacks**. A fade slider (slides on top of each other) whose slides are one kind of card is a
    carousel of one to a screen; the report says the effect is not the original's, and the source's autoplay is not carried over (a fade is not a scroll). Slides on top
    of each other are a slider only when the page says so (a library's class name, previous and next buttons, or dots): tabs and an accordion look the same by
    geometry, and are left as they were.
  - **Slides per screen** are the whole slides inside the clipping box at each captured width (a library clones a different number of slides at each
    width, so a slide at phones' width is found by its place among the real slides: `mobileTiles()`); arrows, dots (a count of buttons equal to the
    pages, the slides, or the places the slider can rest, or the pagination found by name), and snap (a script slider rests at the start of a slide).
  - **Autoplay** (`src/lib/replicate-watch.ts`, `watchSliders()` in `replicate-open.ts`) is only what watching saw: after the capture, the stilling
    style is taken off and motion allowed, and each track (script sliders and sideways scrollers, at computers' width only) is sampled every 350 ms
    for up to 6.5 s with nobody touching the page (the first slider in view, the pointer away). A change in what a sample says (the track's transform,
    where its first tile stands, how far it is scrolled, which tiles show) is a move; moves within 1.2 s are one. Two moves give the period (the median
    gap, clamped to a carousel's 3 to 15 s); one move gives only a lower bound, and the report says "at least"; none says *not observed* and how long it
    was watched. A track that has moved once is watched on for its second move. **The time is bounded**: one window, one retry (only when a script
    slider is among the tracks and nothing moved), a hard 12 s in all, none at all when opening the page already took 70 s, and none at phones' width; and
    **every call to the page is bounded too** (`within()`, 2 s each, never past the watch's own total): a page whose main thread stops answering after it was
    read is a page that could not be watched (`the page stopped answering`), not a tick that runs to its 300 s. **A track that changes at nearly every sample for
    the whole window** (a logo ticker moved by script) is moving all the time and has no period: it is not autoplay of slides, the report says it moves all the
    time, and the copy's autoplay stays off.
    A period longer than the window, a library that waits for the visitor or reads reduced motion once at its start, look still: "not observed" means not
    seen, never that it does not play.
- **At most 60 items** (`CUSTOM_ITEMS_MAX`): the rest are counted and said (the excerpt is clamped to the lines measured, plus one line of room).
- **A grid never makes a copy worse than columns** (`weakGrids()`, `columnsBeatGrid()`, `startTrial()`/`settleTrial()` in `src/server/replicate.ts`): when a
  pass's weakest stretches name a grid under 60 % (at computers' width by the original's boxes, or at phones' by the phone's), nothing is decided on that figure
  alone: the draft is kept as it is, the page is rebuilt with those groups as columns and measured again **at the same pass** (it spends none of the owner's
  improving passes), and the two are compared over the stretch the grid stood in. Columns stay only when they match clearly better there (more than 2 points,
  the diff's own margin; the average of the widths measured); otherwise the grid is put back **exactly as it was** (its rows and style as saved, with the
  corrections of earlier passes) and is never tried again. A job tries columns at most twice (each costs the copy being opened and measured). Both figures are
  kept (`work.reverted`, `work.tried`) and the report says them: the grid and the columns, the stretch and the pass. A grid that stayed weak and was not tried
  (the job's trials were spent, or the page would not be rebuilt) is said to be weak and untried.
- The summary and the report say what was done (`gridLines()`, findings `grids-kept`, `grid-cards`, `grid-items-cut`, `grids-reverted`,
  `grids-weak`, `grid-simplified`, `grid-carousels`). Counts and lines are of the grids **the draft holds**: grids the builder's limits (fifty rows, a hundred
  blocks) cut away are not counted or reported. Groups rightly refused (a footer's columns, a menu, a form) are no problem of the copy: they are in the markdown
  report only (`grids.quiet`). A track that scrolls sideways that nobody asked for cards (in a column of a side-by-side layout, or deeper than a section's own
  boxes) is named as *not looked at*, so it is never silently skipped.
- **What changed for every page** (flow(), lines(), kids(), found by the review, not by a spec): a bar fixed to the screen and a sticky bar across the line are a
  row of their own (`lines()`), never a column beside the page; a "skip to content" link is left out and named; **decoration** (an absolutely placed box with no
  words or pictures, or a thin tall strip) is looked past only to see cards: `flow()` tries a box without it first and keeps that only when it finds a grid, and
  then says the decoration was left out; everywhere else such a box is read as it was before D155 (a thin painted strip is a separator, a plate or a darkening layer is
  a painted column), so a page with no repeated cards is built as it was. Text that is not seen (`visibility: hidden`, `opacity: 0`, a font size of 0, a part
  that is clipped, a pixel, or parked off the screen) is no text of the page, in runs and in slides alike.

### Improving a copy

- **Measuring** (`src/lib/replicate-calibrate.ts`): the copy's boxes are read from its own preview page and compared with where the
  original had each row and block; a line that wraps once more pushes everything under it down, and the next block's space above is
  made smaller by as much. This is arithmetic, applied to computers' and phones' rules.
- **Scoring** (`src/lib/replicate-diff.ts`): both photographs are made a quarter size, a square is wrong when a colour is more
  than a little off, and the page is judged in bands from top to bottom, so the weakest places are known.
- **The AI** (`src/lib/replicate-prompts.ts`, `src/lib/replicate-patches.ts`, `src/server/replicate-ai.ts`): sees the original
  beside the copy (and where they differ) in the weakest places and answers with a short JSON list of changes to parts that exist
  (an id from the list it was given, a place in it, properties and values). Only properties a copy may set and clean values in
  range are applied (`cleanDecl()`), at most 40 a pass; the rest is refused and counted. It never writes text, structure or
  pictures, and everything the page said is handed over between `<page-data>` markers as data.

### The preview page the browser measures

The copy is photographed through `/admin/account/replica/{job}?t={token}`, which draws the draft as the store's own pages are
drawn (`PageDrawing`, its theme, fonts and CSS) without the admin around it, painted with the original's page colour. It is not
behind a sign-in, as the job's browser has none: the token (`src/lib/replicate-token.ts`) names one job, is signed with a key
derived from `SETTINGS_ENCRYPTION_KEY`, and opens that job's draft for forty minutes, and nothing else.

## Working on it against a real site

`REPLICATE_PROBE_URL=https://example.com/ REPLICATE_PROBE_PASSES=3 pnpm test:e2e e2e/replicate-probe.spec.ts` (after `pnpm build`
and a seeded database, with `PLAYWRIGHT_CHROMIUM_PATH` in a sandbox) runs the replicator's own pipeline against any address
without the AI: opens both widths, downloads the pictures, installs the typefaces as the site does, builds, saves the draft,
measures and calibrates, and writes `test-results/probe/`: both photographs, the copy after each pass, the captures, the rows, the
CSS, and `report.md`. In a sandbox the browser goes through the proxy (the spec sets it up). Find the cause in the pictures,
fix it in the converter, add a case to `replicate-oda.test.ts`, run the probe again.

### The browser on the server (found on kia.no)

On Vercel Chromium runs as one process (`@sparticuz/chromium`: `--single-process`, software GL). Measured with those very flags on
kia.no: the computers' width took 13 s, and then **the phone's width in the same browser never answered**, and `page.evaluate` has
no time limit, so the tick waited until the platform killed it at 300 s, its lock (290 s) held the job still, and the next tick
started over and met a browser that could not photograph (`Protocol error (Page.captureScreenshot)`). Each look in a browser of
its own takes 7 to 12 s. So (`src/lib/replicate-look.ts`):

- **one browser for one look** (`looking()`): the original at each width, the copy at each width, in the open step and in every
  pass; never open a second page in a browser that has had a first;
- **a limit on each look** (`LOOK`): the browser is closed under work that does not answer, and the owner is told in a sentence
  (`lookProblem()`), never the browser's own message. The limits add up to less than the request's: 100 s, then two tries of 55 s
  at a phone's width (which is optional: the copy goes on without it);
- to reproduce on a machine: launch `@sparticuz/chromium`'s `executablePath()` and `args` with `setGraphicsMode = false`, and run the
  steps in the order the server does. Bundle the script with esbuild first: `tsx` adds a `__name` helper that does not exist in the page.

What copying lampan.no taught (D150, found with the probe on `https://lampan.no/`; run it offline on a saved capture with
`tsx` and `buildReplica()` to see the grid decisions without a browser):

- a box parked far above the page (a cookie tool's iframe at `top: -9999px`) was a row of its own, and every row after it was
  placed 9,963 px lower: `visible()` now leaves out what lies wholly above or left of the page (a slide scrolled out of its track
  is read as before: `force`);
- every product card had about six small icons (review stars, a heart), each a "second picture", so 24 cards stayed as columns
  at 48 blocks a row, which used the page's 100 blocks, then its style budget, and the rows after them collapsed to 40 px:
  a picture of at most 32 × 32 px (`ICON_MAX`) is decoration, said to be left out but no reason to keep the group as columns;
- two short labels above a title (a campaign and a brand) are one badge in their order, joined with " · ", where only the first was
  and the second made the group fall back to columns;
- the AI's answers ran out of tokens before the first word: a reasoning model counts its hidden reasoning against the limit.
  `replyWithRoom()` asks for low reasoning effort with a limit that leaves room, and once more with three times the room.

Result on the page: 100 blocks (the cap) to 85, one grid to five (37 items), nested-box sections 10 to 4, phones 24 % to 40 %.
Still open: pictures drawn as backgrounds under words (the hero banners), a form's block, a free-layout box, and the style budget
for a page this long (43,000 of 50,000 characters).

The second lampan.no report (found the same way; 56.8 % to 66.4 % on computers in the probe without the AI):

- the style budget: rules whose own element is the only one they style (`#rpN`, and a leaf's `#rpN img`) are merged by
  `mergedRules()` when they say the same, since the cascade cannot tell them apart (48,869 to 33,000 of 50,000 characters);
  anything with a descendant or a state in its selector is never merged;
- a hero's background picture was lifted onto the innermost box of the same size, which a later rule painted over, leaving the hero
  blank: `liftBackdrops()` now moves it to the outermost box of that size (within 3 px) that has no background picture of its own;
- a "read more" box (text 600 px tall, 170 px shown, `overflow: hidden`) was read at its text's height, pushing the rows after it
  380 px down: the extractor reads such a box as far as it is seen (`seenBottom()`); a visitor's *Read more* does not need copying
  for the page to line up;
- the probe serves the photographs from a library-style address (the pictures rules refuse a plain local address), so what it
  measures is what a stored copy looks like.

- a grid that lies still at computers' width but scrolls sideways on phones (the product rows: 990 px tall stacked, about 250 px as
  the original shows them, so the phone copy was 7,662 px against 3,846 px) is a carousel on phones only, `carouselOn: "phones"` on
  the content grid (`phoneScroller()`, `readPhoneCarousel()`; from tablets' width the same tiles lie in a grid of the same columns,
  and the arrows are hidden there). It needs three tiles in one row on the phone, some beyond the box; a page that draws only the
  tiles near the screen counts. A builder row now takes up to eight columns on computers (`GRID_COLUMNS_MAX`), as lampan's seven
  categories wrapped at six;
- **the phone's copy of every part was "not there" in two loads of three**: a box's address is its index among its parent's
  elements, and a cookie tool (Cookiebot) injected in front of the page's own boxes in one load and not the other renumbered all of
  them. Scripts, styles and what is fixed to the screen (other than a bar at the top) take no number (`counted()`), so the same box
  has the same address at both widths. The probe's 9.3 % on phones was this, not a converter fault.

Result of those (probe without the AI): 66.4 % to 79.5 % on computers, 25.7 % to 58.8 % on phones, heights 6,564 px against
6,428 px (computers) and 4,185 px against 3,846 px (phones).

Still open in that report: calibration passes that lower the phone match (63.6 % after the first pass, 58.8 % after the third),
the SEO text row (+110 px), forms, nested boxes and pseudo-element content.

What copying oda.com's front page taught (D150):

- a zero-size holder (`picture`, `display: contents`) hid the image laid out inside it: the extractor now flattens holders
  (`isHolder()`), and an image placed absolutely over a whole section is that section's background (`liftBackdrops()`);
- a link or button that paints and holds one piece of text (usually in a span) is folded into one button (`foldButtons()`), so it
  keeps its fill in any column;
- a painted box that makes several rows is drawn in slices (`sliceFrame()`), so a card is one card;
- content clipped out of sight (a folded menu, a slide scrolled out of a track) is not captured (`clippedAway()`), and a box that
  scrolls sideways is kept with all its cards (`scroll`) and copied as a scrolling row of the cards' own widths;
- a picture that fills a section on computers but is not there on phones is drawn by CSS so the phone's rule can remove it;
- **the page's CSS limit dropped every phone rule** when computers' and phones' rules together passed 50 000 characters: a part's
  box defaults are now stated once (`SHARED_CSS`, `BOX_DEFAULT`) and phone rules say only what differs from computers';
- typefaces: a family's name without a foundry's words ("Inter var" is Inter), then the nearest look-alike for the well-known
  commercial families (`replicate-fonts.ts`), and a cut font stack falls back to the kind of face, never the browser's serif;
- the second visit at a phone's width is tried twice and says why when it fails.

A copy's pictures are sized by their own rules (`#id img{width:100%}`, `#id{width;max-width}`, `.rp.rp{max-width:none;box-sizing:border-box}`),
which beat the builder's natural-size classes (D151) because they are unlayered; the converter never sets a picture block's width
or position setting.

## Grids and carousels (D155)

What repeated cards and sliders become is described under "Repeated cards become a grid" above. This section is how it was measured on real pages, what
the measuring found and fixed, and what it could not do. The figures are from one run by hand on 2026-10-03; they are evidence of how the detection behaves
on this set of pages, not a promise about any other page, and no threshold was tuned to one page.

### How it is run

Nothing here runs in CI and no site is opened more than once. `scripts/replicate-calibrate.ts` (a developer's tool, outside the app, and the one deliberate exception to D150's rules that
Chromium is launched only by `src/server/browser.ts` and that everything fetched goes through `safeFetch()`: `server-only` modules cannot be imported by a script, so it
checks a picture's address with `parseReplicaUrl()` and `isBlockedAddress()` (the host's every address, each redirect), reads at most 8 MB of it, and uses a plain
`fetch` for the rest) opens each page of its list once at computers' and once at phones' width with the replicator's own
`openOriginal()` (autoplay watch included), and keeps both captures and both photographs. From those files, offline, it builds the page twice with
`buildReplica()`: as the replicator builds it, and with every grid group rebuilt as columns (`reverted`, which is what the replicator did before D155).

```bash
export PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium   # a sandbox's own Chromium
pnpm exec tsx scripts/replicate-calibrate.ts --dir /tmp/calib [--only slug,slug]            # open once, keep, build, write results.md/json
pnpm exec tsx scripts/replicate-calibrate.ts --dir /tmp/calib --offline                     # build again from the kept captures; no site is touched
NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/replicate-calibrate.ts --dir /tmp/calib --offline --pictures   # keep each picture the pages loaded, once
pnpm exec tsx scripts/replicate-calibrate.ts --dir /tmp/calib --publish                     # put them in public/calibrate-tmp/ (before the app starts)
DATABASE_URL=… PORT=3000 REPLICATE_CALIB_DIR=/tmp/calib pnpm exec playwright test e2e/replicate-calibrate.spec.ts --workers=1   # the match, both ways
pnpm exec tsx scripts/replicate-calibrate.ts --dir /tmp/calib --unpublish                   # take them away again
```

In a sandbox the browser goes through the proxy and must trust its CA: the script gives Chromium that one CA's public-key hash
(`--ignore-certificate-errors-spki-list`), so certificate checking stays on for every other certificate. The spec renders both builds through the app's
preview page at both widths, scores each against the original's photograph with `compareRasters()` as a pass is scored, and calibrates the spacing twice
as the refine step does. The word rule is checked on the real pages: every word of every item must be a word some box of the capture holds
(`invented` in the results; also `replicate-real.test.ts`, which runs it on every captured tree kept as a fixture).

### The pages and what was found

26 public pages: the sites of Swiper, Slick, Splide, Embla, Glide, Owl Carousel 2, Flickity and Keen Slider (script sliders), of Bootstrap, Tailwind CSS,
daisyUI, Svelte, Astro, Laravel and KDE and the Mozilla, Python and Notion front pages (card grids, logo walls, testimonials), Vercel, Stripe and Shopify
(brands), Smashing Magazine, web.dev and freeCodeCamp (article lists and cards), Oda and Allbirds (shops). All 26 opened at both widths.

- **Built**: 33 grids of custom items on 16 of the 26 pages, from 220 cards to 220 items (none cut; one card had something an item does not hold and said
  so). 39 groups were kept as columns with a reason (below). 68 script-slider tracks were found by geometry; 13 became carousels (arrows 11, dots 7, rewind 10,
  79 copies made to loop left out; the others stayed columns or were not reached, see the limits).
- **Words**: 0 invented words in the 1 084 words of the items (a real check: `$` and `25` in two pieces of one price are the word `$25`).
- **Fields filled** (of 220 items): title 148, text 59, link 94, picture 61 (an icon drawn as an inline graphic is not counted: this tool does not photograph
  graphics), button label 4, price text 3 (all Flickity's), date 7, details 1, badge 0. No real page here had a badge the extractor read as one: that rule has
  only synthetic evidence.
- **Autoplay**: seen on 1 of 13 carousels (Slick's autoplay demo: the period read was clamped to a carousel's lowest, 3 s). Each track was watched 6.7 s.
  The others were *not observed*, which means not seen in 6.7 s with nobody touching the page; it was not checked against the sites' own settings, so the
  count of sliders that really play by themselves is not known.
- **Kept as columns, and why** (39): a footer's columns 9, a menu 5, structurally different siblings 9, a list of links in each box 3, the rows not starting at
  the same place 3 (a centred last row, below), the slides not one kind of card 3, unequal widths 2, overlapping 1, one piece of text each 1 (a row of words
  that all show), text longer than the six lines an item shows 1 (web.dev, 24 cards), a picture behind the words 1 (Notion), a second picture or icon set 1.
  Every one is a sentence in the report; the ones that lose slides out of view say how many words the copy lacks.

The match with the original, grid against columns (computers' width, after two passes; phones' width, same), on the 16 pages that built a grid, with the pages'
own pictures but no fonts and no inline graphics, in both builds alike:

| Page | Grids (cards → items) | Computers: grid vs columns | Phones: grid vs columns |
|---|---|---|---|
| slick | 11 (70 → 70) | 71.8 vs 56.3 | 36.8 vs 39.1 |
| tailwind | 1 (33 → 33) | 65.5 vs 55.4 | 70.9 vs 70.9 |
| owl | 1 (11 → 11) | 92.4 vs 91.5 | 87.3 vs 86.3 |
| notion | 1 (5 → 5) | 60.8 vs 59.1 | 30.8 vs 30.8 |
| bootstrap | 1 (3 → 3) | 73.1 vs 72.2 | 68.8 vs 68.4 |
| kde | 3 (17 → 17), one a Swiper carousel | 53.5 vs 52.9 | 51.9 vs 51.4 |
| oda | 2 (8 → 8) | 76.9 vs 76.5 | 46.4 vs 53.5 |
| python | 1 (4 → 4) | 75.9 vs 75.8 | 46.4 vs 44.0 |
| swiper | 2 (17 → 17) | 40.7 vs 41.0 | 52.5 vs 40.6 |
| flickity | 1 (3 → 3) | 68.1 vs 68.1 | 59.1 vs 56.2 |
| splide, daisyui, glide, allbirds | 1 each | equal to 1 point | equal to 2 points |
| shopify | 1 (3 → 3) | 55.6 vs 56.3 | 52.2 vs 56.6 |
| astro | 4 (20 → 20) | 48.9 vs 50.6 | 60.9 vs 63.3 |

The grid is **not worse than columns by more than a point at computers' width except on Astro (1.7)**, and clearly better where it takes slides the columns would have
lost or laid out beside each other (Slick +15.5, Tailwind +10.1). On phones it is worse on Oda (-7.1), Shopify (-4.4), Astro (-2.4) and Slick (-2.3) and better on Swiper
(+11.9), Flickity (+2.9) and Python (+2.4). The tool's scoring has a margin of a point or two, and the blocks the grid saves are real (Oda 71 against 89, Glide 9
against 18) but most of these pages are held at the builder's 100 blocks by something else, so the saving does not show there. The revert rule (`weakGrids()`: a grid
named under 60 % is rebuilt as columns on the next pass) is the safeguard for the rest and was not exercised by this tool, which does not run it. Astro's copy is
broken in both builds for a reason that is not the grid's (its hero's absolutely placed pictures become columns and the text column shrinks), so its figures say
little.

### Defects the measuring found, fixed (each with a captured tree as a fixture, `src/lib/fixtures/calibrate/`, tested in `src/lib/replicate-real.test.ts`)

1. **A bar fixed to the screen, or a sticky header the first section is drawn under, made the whole page "one row of two columns"** (`lines()`): every site with a
   header in the same wrapper as its content (Tailwind CSS and Shopify among these) was never looked at for cards. A fixed bar, and a sticky bar across the line, are a line
   of their own, and `detectGroup()` no longer counts them as cards (Tailwind's logo wall of 33: 0 → 1 grid).
2. **Decoration beside the content did the same** (`decoration()`): a layer of rules or a plate placed absolutely with no words or pictures, a tall thin strip down the
   page's side (a gutter's hatching), and a "skip to content" link placed over the page's corner and shown only to a keyboard. The skip link is left out of the flow and
   named (`drop("shape")`) wherever it is; the other two are looked past **only to see cards** (the review found that dropping them everywhere took a page's thin
   painted rules and its darkening layers out of pages with no cards at all): a box is read without them first, and that reading is kept only when it holds a grid, and
   the report says they were left out. A horizontal strip is a rule or a spacer and is kept.
3. **A slider of plain text was refused as "a menu or a row of words"** (`detectGroup()`), and the slides out of view were then missing from the copy. A script slider that has
   slides out of view, copies made to loop, buttons or dots is its content: Slick's nine numbered slides are now a carousel of nine items with arrows, dots and rewind
   (Slick 2 grids → 11, Owl Carousel 0 → 1). A row of words that all show in a box that merely clips is still refused.

### What it could not do (honest limits)

- **Cards inside one column of a side-by-side layout are not looked at** (`rowSpecs()` flows a split's columns without asking for groups; since the review a track that
  scrolls sideways in such a place is named as *not looked at* in the report, never skipped silently): a docs page with a sidebar
  keeps its cards as that column's blocks. Splide's site has 25 sliders in such a column; 24 were not found (1 grid built elsewhere on the page). This is the largest gap the
  calibration found, and the fix is a column that can hold a grid block (a column's contents are leaves today).
- **Wrapped rows centred on the last row** (Swiper's 5 + 2 feature cards and logo walls, 7 and 30 boxes) are kept as columns: the grid block has no way to centre a
  short last row, and the spec asks for equal rows. A `justify` setting on the grid would let them be built.
- **Only the page's own sections are asked** (depth 0 and 1): a group of cards inside a painted box inside a section is flattened as before.
- **Lazy pictures and content below the first screens**: Vercel's page was captured 5 900 px tall with its lower half empty; what a page loads only on interaction is not there.
- **Autoplay** is only what 6.7 s of watching saw; a slower period, a slider that waits for the visitor or reads reduced motion once looks still.
- **Slides that are different layouts** (Keen's, Allbirds' hero) stay columns, with how many slides' words the copy lacks.
- **Blog cards with long text** (web.dev: 24 cards of nine lines) are refused because an item shows six lines; the cards stay columns.
- **Picture boxes with a picture behind the words** (Notion's testimonial cards) are refused, as the item has no background picture.
- The match figures use no fonts and no graphics (icons drawn as inline vectors are not photographed here), the same in both builds; they say how the layout compares, not
  how the copy looks.

## The report for whoever improves it

Every job ends with a report (`summary.report`, `src/lib/replicate-report.ts`) that the panel offers to copy or download as
Markdown (`reportMarkdown()`), written to be pasted as the brief for the next change to the extractor, the converter or the
builder. It is counted and measured in code; only text marked "AI" is a model's. It holds:

- the verdict (match per width, passes, heights, what was built);
- **findings**, worst first, each with its evidence (what was counted and where in the original, by selector and y), the change
  that would close it, whether the **replicator** or the **builder** has to change (a component it lacks), and the files to start
  in: forms, nested boxes, decorative shapes, graphics that could not be kept, embeds, accordions and tabs, carousels, tables,
  pop-ups, pseudo-element content, animations, sticky elements, styles read but not written, gradients, pictures, videos and
  fonts that failed, the rows that differ most, height drift, a weak phone layout, the builder's size limits, the style budget,
  and what the AI could not fix or the whitelist refused;
- the page outline (each row's selector in the original, y, height, match on computers and phones, the copy's own height, its blocks);
- the largest box differences, part by part; what was left out, by selector; the original counted (tags, forms, gradients, patterns by
  class name, sticky, animated, sideways scrollers); assets; the AI's reading and what it said each pass; the log's warnings.

The extractor records a selector for each box (`CaptureNode.sel`) and what boxes do not say (`CaptureExtras`: pseudo-element content,
animations, sticky elements, sideways scrollers, roles). A new kind of gap is a finding in `findingsOf()` with a test, and a new
thing the converter leaves out is a `drop()` in `buildReplica()`, so it has a place and a selector in the report.

## Safety

- The address is checked by `parseReplicaUrl()` (`src/lib/replicate-url.ts`): http(s) only, no sign-in details, the usual ports,
  no machine-local names. Everything fetched from other sites goes through `safeFetch()` (`src/server/replicate-fetch.ts`): the
  name is looked up and **every** address must be public (`isBlockedAddress()`: private, loopback, link-local and cloud metadata,
  carrier-grade NAT, multicast, mapped and NAT64 forms of those), the connection is made to the address that was checked, each
  redirect goes through the same checks, and size, time and redirects are limited. The browser's requests for the original are
  refused the same way, name by name.
- `REPLICATE_ALLOW_PRIVATE=1` lets tests reach a local page; it is ignored on Vercel.
- The owner confirms they have the right to copy the page. The copy is a draft, hidden from search engines and AI assistants until
  they decide; its text is the original's, and the summary warns when it makes claims (`findClaims()`) a store must stand behind.
- One job at a time per store; a job's files (photographs for the panel) and the job itself are removed after thirty days.
- The captured page is dropped from the job when it ends.

## What it does not do (yet)

Forms, animations, and sliders whose slides are not one kind of card (a hero with a different layout on each slide; the report lists each one it finds, with where; slides of one kind of card are a carousel of custom items, see above); fonts that are not in Google Fonts (the original's stack is used); pages that need a sign-in;
several pages at once; Kaizen's own pages (the platform's studio has no copy button).
