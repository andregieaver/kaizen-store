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
| examine | The site's AI looks at the photographs and the browser's digest and describes the design (palette, type, sections, what will be hard): `analyse()`. Without a text model that sees pictures it reads from the facts alone, or is skipped, and the summary says so. |
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

Forms, carousels and animations (the report lists each one it finds, with where); fonts that are not in Google Fonts (the original's stack is used); pages that need a sign-in;
several pages at once; Kaizen's own pages (the platform's studio has no copy button).
