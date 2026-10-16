# Pictures made automatically: phase 2 of the theme showcase plan

Phase 2 of `docs/theme-showcase.md`: a theme's pictures are photographs of its looks, taken by Kaizena Flow after each Publish, so no one
uploads a picture to list a theme (Homer) and anyone may still put their own in its place (Lisa). Built in steps, each pushed on its own;
this file says what each step is and, once built, what it found.

| Step | Builds | Done when |
|---|---|---|
| 1. Shots on publish | every Publish (and every new showcase) photographs each look of the theme on its showcase store at a computer's and a phone's width, in the background: full length, first screen, a card crop and a share image; the theme store, the theme page, its share image and the design cards use them | a platform admin publishes a theme and, within a few minutes, its card, its page and its share image show the version just published, each look on its own trade's store |
| 2. Highlights | three pictures per theme composed from its shots (a computer and two phones, a collage of the page's sections, a close-up of the products), with words a person writes or accepts from an AI suggestion that passed the claims filter | each theme's page shows its three highlights with their words; launch themes' words are in code |
| 3. Swapping | any made picture can be replaced with one from Kaizena Flow's media library, and put back; launch themes' syncs keep the replacements; the library counts them as uses | a platform admin replaces a made picture with their own, sees it on the theme page, and puts the made one back |

Short silent loops of a page scrolling are left for later (see *Later*): they need a video encoder the serverless browser does not have.

## Decisions

* **A photograph is of the published look on its showcase, through the public preview.** The browser opens
  `designPreviewPath(theme, starter, { embed: true, variation })`: the theme's published version, the look's own showcase (D258,
  `themeLooks()`: its pack's published store template, else the Standard store), drawn alone (`embed=1`: no banner). Never a draft, never a
  store's own site, never a page a visitor could not open. What is photographed is therefore what the theme store shows live.
* **Made in the background, never in Publish's request.** Publish and every change of where a look is shown only ask for pictures; a job
  takes them, one look at one width per unit of work, each unit in a browser of its own with a time limit (`looking()`, `launchBrowser()`,
  D150's rule: one browser per look). A unit is small enough that a run of the job does several within its limit.
* **A set of pictures belongs to a version and a showcase.** It is made for the theme's latest version and the store its look is drawn on
  (the pack's frozen copy, `store_starters.published_store_id`, which changes when the pack is published again). When either moves on, a new
  set is wanted, and the old one is kept for a week (cached pages still name its files) and then deleted with its files.
* **Kept as files of the platform, not in the media library.** Made pictures live in the public `product-media` bucket under
  `platform/theme-shots/`; the library is for what people upload and choose. A replacement (step 3) is chosen from the library.
* **Pictures carry no words.** Words about a theme are text beside its pictures (alt texts and captions in the page), so they stay readable,
  searchable and checkable. AI only suggests words, always through `findClaims()`, and nothing it writes is kept until a person saves it.
* **The theme's own pictures win.** A main picture set on the theme's details page (`design_presets.picture_url`), and in step 3 any
  replacement, is shown in place of the made one. Launch themes' photographs in `public/demo/themes/` stay as the fallback until a set is
  made (and where none can be, as in development and the browser tests).
* **Fonts are the theme's own web fonts.** The preview loads Kaizena Flow's self-hosted fonts (D59), and the browser waits for
  `document.fonts.ready` before photographing; the serverless Chromium has few system fonts of its own, so the first sets made in production
  are looked at by eye for missing glyphs.

## Sizes

| Picture | Made from | Size | Format |
|---|---|---|---|
| Computer, full length | the preview at 1440 × 900, scrolled through | 1440 wide, at most `SHOT_HEIGHT_MAX` (9,000) tall | WebP |
| Computer, first screen | the top 1440 × 900 | 1440 × 900 | WebP |
| Card | the top 1440 × 1080 (4:3) | 800 × 600, as the launch photographs | WebP |
| Share image | the top 1440 × 756 (1200:630) | 1200 × 630 | JPEG (social sites read it everywhere) |
| Phone, full length | the preview at 390 × 844 | 390 wide, at most 9,000 tall | WebP |
| Phone, first screen | the top 390 × 844 at twice the pixels | 780 × 1688 | WebP |
| Highlights (step 2) | the shots above, and a close-up at twice the pixels | 1600 × 1000 each | WebP |

A file larger than the bucket allows (5 MB) is written again at a lower quality, then narrower, until it fits.

## Step 1: shots on publish

**Data.** `commerce.theme_shots`: one unit of work and what it made.

* `preset_id` (the theme; deleted with it), `version` (its version number), `variation` (the preset's key; null for the theme's own look),
  `starter_id` (the showcase's store template; null for the Standard store) and `showcase_store_id` (the store drawn: the template's frozen
  copy, or the default template's store), `kind` (`computer` or `phone`), unique together (nulls not distinct).
* `status` (`waiting`, `running`, `done`, `failed`, `superseded`), `tries`, `claimed_until`, `problem` (a plain sentence), `created_at`,
  `finished_at`, `superseded_at`.
* `pictures` (what was made, by kind of picture: each its storage path, address, width, height and bytes) and `parts` (the boxes of the
  page's header, rows, product and footer as measured, which step 2 cuts by).
* No store owns it (`showcase_store_id` names the store photographed, never an owner's), so it is outside `COPY_RULES`, and it holds no
  person's data (`NOT_PERSONAL`). Row-level security on, no policy, as every commerce table.
* A minute's schedule calls the job (`kaizen-theme-shots`, `pg_cron` and `pg_net` as the cookie scan's, in the rules migration, only where
  the extensions exist).

**What is wanted** (`wantedShots()`, pure, `src/lib/theme-shots.ts`): for each published, unarchived theme with a readable snapshot and a
version, each of its looks (`themeLooks()`: its own and every preset of the published version) with the store it is shown on, at both
widths, at the latest version. `queueThemeShots()` (`src/server/theme-shots.ts`) inserts what is wanted and missing and marks waiting or
failed units that are no longer wanted as superseded; it runs at the start of every run of the job, and after Publish, a listing's save and a
store template's publish, so the admin sees the pictures waiting at once.

**The job** (`/api/cron/theme-shots`, its own route so Chromium stays out of the others; `cronAuthorised()`; answers at once and works in
`after()`, as the cookie scan does; in `outputFileTracingIncludes` and `chromium-trace.test.ts`): claims the oldest waiting unit (`for update
skip locked`, or a running one whose claim ran out, fewer than three tries), checks it is still wanted (the theme's latest version and the
showcase's store unchanged; otherwise superseded), and photographs it (`shootLook()`, `src/lib/theme-shoot.ts`, free of server-only modules
so a browser test can run it): open the preview at the width (reduced motion, so entrances are shown finished), wait for the page, its
fonts and its pictures (lazy ones made eager, the page scrolled through), measure its parts, take the full-length photograph and the first
screen. `sharp` cuts and sizes the pictures (`src/server/theme-shot-files.ts`), which are uploaded, and only then the unit is `done` with
its `pictures`. A failure (`lookProblem()`) is kept and the unit waits for its next try; after the third it is `failed`. Units are taken one
after another while the run has time (each within `SHOT.ms`), then the run ends. When a unit is done the theme store's reads are refreshed
(`revalidateTag(DESIGNS_TAG)`). `pruneThemeShots()` (in the five-minute job, no Chromium) deletes the files and rows of sets superseded more
than seven days ago.

**Where they are shown.**

* `themeShotsFor()` reads, inside the theme store's cached reads, the latest done set of each look: `ThemeLook.shots` (`computer` and
  `phone`: first screen and full length) and on the card `madeCard` and `madeShare`.
* The card: the theme's own picture, else the made card, else a launch photograph, else the swatch.
* The theme page: its own pictures (main and further ones) as before; without any, each look's first screens at both widths. Its share
  image: its own picture, else the made share image, else the drawn card (`themeShareCard()`). Its structured data names the same picture.
* The stage (`ThemePreviewStage`): each look's frame shows its first screen while the live preview loads.
* The design cards at sign-up and *Create a store* (`DesignCards`): a look's made card where it has no own picture.
* A launch photograph is now only a fallback: `launchShotFor()` gives the newest photograph in `public/demo/themes/` at or below the theme's
  version, and raising a version no longer needs a new one.

**Platform admin.** The theme's details page has *Pictures*: each look's two widths with what they show, the time they were made and of
which version, or *Being made* (and how many wait), or *Could not be made* with the reason and *Try again* (resets the tries).
`platform.theme_shots_retried` is audited. Nothing to do for Homer: publishing is enough.

**Tests.** `src/lib/theme-shots.test.ts` (what is wanted: looks, showcases, versions, superseded; the crops' rectangles and sizes),
the PGlite test (the unit unique, its statuses, superseded rows), `src/server/theme-shots.int.test.ts` (queued after Publish and after a
showcase changes, claimed once, superseded when a newer version is published or the pack is published again, the files and the read
through an injected photographer and storage, pruned after a week), `src/server/theme-shot-files.test.ts` (sharp's crops and sizes from
a made-up photograph), the theme store view tests (the card's and the page's choice of picture), and `e2e/theme-shots.spec.ts` (the job's
photographer against a running preview: both widths, parts measured, nothing blank).

## Step 2: highlights

**Pictures.** Made from the theme's own look's latest set, once both its widths are done (a unit of kind `highlights` in `theme_shots`,
taken by the same job; no browser is needed but for the close-up, photographed with the computer unit), on a backdrop in the theme's own
light colours:

* **Devices** (`trio`): the computer's first screen in a drawn computer frame, two phones beside it: the phone's first screen and the phone
  at its product.
* **Collage** (`collage`): the computer's page cut at its measured rows, three or four sections laid out in two staggered columns.
* **Close-up** (`closeup`): the product grid or the product's buy part at twice the pixels.

Frames and layout are drawn by code (SVG composed by `sharp`), never by a model.

**Words.** `ThemeListing.highlights`: each highlight's title (at most 60) and line (at most 160), edited on the theme's details page beside
its picture; *Suggest words* asks Kaizena Flow's text model (feature `theme_highlights`) with the theme's facts only (its name, summary,
what it includes, its presets and the trades they are shown on) and puts the suggestions in the fields, unsaved; each passes `findClaims()`
or is not offered. A highlight without words shows its picture with an alt text made by code (*Calm on a computer and two phones*). Launch
themes' words are written by hand in `LAUNCH_THEMES` and written by `launchListing()`.

**The theme page** shows *Highlights* (the three, each a picture with its title and line) under the stage.

**Tests.** Composition from made-up shots (sizes, each part placed inside the picture), the words' limits and the claims filter, the
suggestion through a stand-in model, the page's view test.

## Step 3: swapping

**Slots.** Every made picture the theme store shows is a slot: the card (the theme's main picture, `picture_url`, as now), the share image,
each highlight, and each look's first screens. A platform admin replaces a slot from the theme's *Pictures* with a file from Kaizena Flow's
media library (or one uploaded there), and *Use the made picture* puts it back. Replacements are `ThemeListing.own` (slot → address, read
by `readListing()`, only addresses of the platform's library), kept by `saveThemeListing()` and by `markLaunchTheme()`, and
`syncLaunchThemes()` no longer clears a launch theme's main picture. `mediaUses()` counts a theme's main picture, further pictures and
replacements as uses of the library's files. Audited `platform.theme_picture_replaced` and `platform.theme_picture_restored`.

**Tests.** The listing's slots (unknown slots and foreign addresses dropped), the readers' choice (own over made over fallback), a launch
sync keeping them, `mediaUses()`.

## Later: scrolling loops

A few seconds of a page scrolling, silent. On Kaizena Flow's own pages this needs no video: phase 3 moves the full-length shot in its
frame (on hover, and never under reduced motion). A video file to share elsewhere is not in this phase: making one on the server needs an
encoder (Playwright's own is not in the serverless Chromium). When it comes it is made from the full-length shots, so it needs no second
look at the page.
