# Signature themes: themes made from scratch

Status: steps 1 and 2 built (D267, 16 October 2026; two storefront fixes found on the way are D268). Steps 3 to 6 are the plan.

## Why

The owner (16 October 2026): "The current generated themes are all based off of the demo store in admin. If any developer were to create a
theme they would do it from scratch. A space theme, completely different from a retail theme and so on. It's these kind of themes we need
to be able to create and promote, either by you or the platform AI. The themes need to be unique, artistic, beautiful and converting."

Today's four launch themes (D246) are settings over the same standard header, footer and product page, with no CSS, shown on the same demo
store or the six trade packs, whose home pages are all built by one function (`packHomePage()`). They differ in colour and type, not in
world. A theme made from scratch has a world of its own: its own layouts, its own art, its own demo store with words and pictures written
for it, and sections nobody else has.

## The bar, made checkable

| Quality | What it means here | How it is held |
|---|---|---|
| **Unique** | its own header, footer, product page, stylesheet and home page design; a look no other theme has | `signatureCheck()`: a signature theme carries all three layouts and its own CSS, and its home page is not `packHomePage()`'s |
| **Artistic** | an art direction: a motif (stars, paper, neon, grain), type with character, art made for it | art made by code from a seed (`scripts/theme-art.mjs`) or by the picture model from art-directed briefs; reviewed by eye on every version's photographs (D264) |
| **Beautiful** | composition, rhythm, contrast, restraint | `themeCheck()` (contrast in light and dark, fonts, sizes) and a person looking at the photographs before it ships |
| **Converting** | the shop's job first: what it sells and one clear action on the first screen; price, choice and *Add to cart* on the product page's first screen on a computer and a phone; search, account and cart always in the header; real facts beside the button (the right of withdrawal, delivery), never invented claims; fast | `signatureCheck()` (the buy part in the product page's first row, the header's cart and search, the footer's required parts), the photographs measured (`ShotParts`), the D211 budget, `findClaims()` on every word |

## What a signature theme is

A theme (D241: settings, presets, header, footer, product page, CSS, section styles) **plus its world**:

* **Art**: pictures made for it, kept with the code in `public/demo/themes/{key}/` (made by `scripts/theme-art.mjs`, generative and seeded,
  so the same every time; WebP, no words, letters, logos or faces) and drawn by its CSS and its demo store.
* **Its own demo store**: a content pack (D257) of its own, for the trade it is made for (Orbit's is *Far Light*, a shop of framed prints
  of the night sky), whose pictures may be the theme's own art (bundled, so nothing waits for the picture model) and whose home and about pages are
  designed for the theme (`ContentPack.design`), not built by the common function.
* **Presets** that keep the world and change its mood (Orbit: Nebula, Mars).

Switching to a signature theme still never touches an owner's words (D241's rule): the world reaches a store through the theme's layouts,
CSS and section styles, and, for a new store started from the theme, through its demo store (D259 to D261: marked demo, removable, and an
existing store can take its home page with undo).

## Steps

| Step | Builds | Homer | Lisa |
|---|---|---|---|
| **1. Foundation** | `scripts/theme-art.mjs` (art drawn in Chromium from a seed, saved as WebP); packs with bundled art (`ContentPack.art`) and designed pages (`ContentPack.design`); pack keys beyond the six trades; launch themes carrying their own header, footer, product page and CSS; `signatureCheck()` | nothing changes for him yet | can read how a theme is put together |
| **2. Orbit** | the first signature theme: a space theme with its demo store *Far Light* (framed prints of the night sky), two presets, art made for it, its photographs and highlights | sees a theme that is a world, starts a space store from it in one press | changes every setting, keeps the art or replaces it |
| **3. Three more worlds** | proposed: *Atelier* (editorial, quiet luxury), *Arcade* (neon and retro games), *Botanica* (organic, plants and paper); the owner may change the list | picks the world that fits his store | compares them on the theme store |
| **4. The theme's sections** | a theme offers its signature rows in the builder while it is live (snapshot version 3, `sections`, planned in `docs/theme-store.md` 3): an Orbit hero on an owner's own page | adds an Orbit hero to his page with one press | edits it as any row |
| **5. The platform AI makes them** | the AI theme studio (`docs/theme-showcase.md` phase 5) for platform admins, and the platform AI manager's theme tools: a brief becomes a draft signature theme, composed from the hand-made library (headers, heroes, sections, product pages, motifs and art recipes of steps 2 and 3), its colours built and corrected by code, its words through `findClaims()`, its art by `theme-art` recipes or the picture model; always a draft, published by a person | describes the world in a sentence, picks one of three | regenerates a part, locks the rest |
| **6. Promote** | the theme store's *Featured* and *New*, a *Themes* block for Kaizena Flow's own pages, *New themes* on the owners' Design settings, a launch article drafted by the platform AI (through `findClaims()`), the share images and highlights (D264 to D266) | sees the new world where he already looks | turns the notices off |

A component a signature theme needs and Kaizena Flow lacks is built for everyone, with its builder fields, never as theme code
(`docs/theme-store.md` 10). The first candidates: a *Delivery and returns* product part drawn from the store's own shipping rates and
withdrawal period (facts beside the button, for conversion), and art motifs as background effects (stars, grain).

## Built (steps 1 and 2, D267)

* **Art**: `scripts/theme-art.mjs` draws each recipe of `scripts/theme-art/{key}.js` on a canvas in Chromium with the helpers of
  `scripts/theme-art/lib.js` (seeded random numbers, simplex noise, skies, star fields, nebulae, lit spheres, framed prints, grain) and saves
  WebP. Orbit's sixteen pictures (a planet's sunrise for the hero, a star tile and a twinkle tile its CSS drifts, eight framed prints, three
  collection tiles, star trails and the Milky Way) weigh 5 to 63 KB each.
* **Packs**: `ContentPack.art` (pictures by slot, placed into the pack store's library once, recorded in `pack_pictures` with the art's
  address so a new version places nothing again) and `ContentPack.design` (its home and about pages, `PACK_DESIGNS`); a pack with art
  needs no picture model (`picturesMissing()`). Far Light is the pack `astronomy`.
* **Store links**: a path in a store's rows is the store's (`withStoreLinks()`), so a designed page's `/products` and `/category/planets` reach
  the store in every market.
* **The theme**: `src/lib/signature/orbit.ts` holds Far Light, its pages, Orbit's header (over the hero on the front page, glass, a gliding
  menu line), footer, product page (the picture in a glow, a buy box that stays in view on a computer, related prints), its CSS (about 6 KB:
  the drifting stars, the hero's ring, glass cards, outlined numerals, reduced motion respected) and settings (dark, Unbounded and Manrope,
  starlight gold, pill buttons, its section styles), with the presets Nebula (violet, on the beauty pack) and Mars (rust, on the electronics
  pack). `signatureCheck()` holds it; its card photograph by hand is `public/demo/themes/orbit-v1.webp`.
* **Dressing**: `dressSignaturePacks()` puts Orbit on Far Light and makes it the template's recommended look, so the store template's own
  preview, its cards and the stores made from it are Orbit.

## Built (step 3, D269)

* **Atelier** (`src/lib/signature/atelier.ts`): quiet editorial luxury. Cormorant Garamond over Jost on warm paper with a grain, a header of
  two quiet rows (search and the menu button, the logo in the middle, account and cart; the menu under it), small-capital square buttons, a
  hero still life, collection tiles that zoom slowly, a glaze band, roman numerals for the making, a buy box that stays in view. Its store
  *Ostra Studio* (pack `ceramics`) sells eight stoneware pieces in three collections. Presets: *Linen* (home pack) and *Noir* (dark,
  fashion pack).
* **Arcade** (`src/lib/signature/arcade.ts`): neon and retro games. Tilt Neon headings that glow over Space Grotesk on a dark screen with
  scan lines, pixel labels in Silkscreen, "Level 1 to 3" for the collections, a blinking cursor, sign cards like screens. Its store *Neon
  Alley* (pack `neon`) sells eight neon signs. Presets: *Vapor* (beauty pack) and *Terminal* (electronics pack).
* **Botanica** (`src/lib/signature/botanica.ts`): organic, plants and paper. Fraunces over DM Sans, a floating pill header, arched and
  leaf-shaped pictures, a sprig that sways (still for reduced motion), care notes with icons, rounded cards. Its store *Fernhouse* (pack
  `plants`) sells eight house plants. Presets: *Terracotta* (food pack) and *Night garden* (dark, services pack).
* **Shared blocks**: the four themes write their rows with `src/lib/signature/kit.ts` (text, headings, buttons, pictures, grids, icon lists,
  site and product parts), so a page reads as the builder would have saved it.
* **A fix for everyone**: a row taller than its content (`height`) with its columns in the middle or at the bottom now places them there
  (`rowGrid()`); before, they stayed at the top.

## Built (step 4, D272)

A signature theme's designed rows are offered on the builder's Rows tab while it is live, under *From {theme}*: Atelier's still life,
statement, newest products, three collections, quote band, three steps, story and last call; Arcade's, Botanica's and Orbit's in kind (at
least four each, `signatureCheck()`). Each is a `ThemeSection` (`src/lib/theme-sections.ts`: a key, a name, a line and the slot of the
picture its tile shows) made by the theme's own code (`LaunchTheme.sections`, `xSections(words, picture)` in each
`src/lib/signature/{key}.ts`), the same function that writes its demo store's home page with that store's words; offered, it brings
`SECTION_WORDS`, words for any store (what to write there, never the demo store's), and links to the store's own pages. Its pictures are the
theme's demo store's: the photograph once made (D270), else the art placed there, else the art from the site's own files as a full address.
`placeThemeSection()` (`src/server/theme-sections.ts`) copies them into the owner's library as using a template does, checks the row as a
saved row, audits `store.theme_section_used` (or `platform.theme_section_used`) and hands the builder a saved row, placed as a template's
is. Pages and articles only, in the store's builder and Kaizena Flow's own (not while translating, not for a test's version).

*Deviation from the plan:* the sections are the code's, found by the live install's `launch_key`, not a snapshot version 3. A theme made by
a person or by the platform AI (step 5) will need them in its version; that is step 5's snapshot change.

## Built (Kinetic, D281)

The owner (18 October 2026): "Programmatically create a new theme for a sports brand. Make sure that images has male and female athletes in
them."

* **Kinetic** (`src/lib/signature/kinetic.ts`): a sportswear brand on the move. Chalk-white pages, Barlow Condensed in bold italic capitals
  over Inter, tartan-track red as the accent, a header that lies over a hero as wide as the screen (glass on the front page, a stripe of the
  accent elsewhere), the hero's bottom edge cut on a slant, a band of words that runs across the page (still for reduced motion), women's and
  men's kit side by side as two tall pictures, square buttons with an arrow, pictures and product cards with a cut corner, outlined numerals,
  a dark footer, and a floodlit band to end on. Presets: *Night run* (dark, a volt accent) and *Glacier* (cool blue). Eight sections.
* **Its store**, *Halden Athletic* (pack `sports`), sells running and training wear for women and men (three pieces each) and shoes and
  gear, in the collections Women, Men and Shoes and gear.
* **Women and men athletes, with their faces, in action** (D282): the briefs of the hero (a woman and a man sprinting side by side at
  sunrise), the story (a running club of women and men coming toward the camera at dusk), the Women and Men pictures (a female runner
  mid-stride, a male sprinter driving out of the blocks) and the floodlit band (a woman and a man running toward the camera at night) are
  photographs of people (`PackPhoto.people`): the picture model is told to show natural, expressive faces of invented models, never a real
  or famous person (`PEOPLE_RULES`), in place of the packs' "no recognisable faces". The products and the gear picture show no one. The
  photographs are made by the platform's picture model with *Make the pictures*, as every pack's are; until then the art
  (`scripts/theme-art/kinetic.js`) stands in on the unpublished demo store only (pictogram runners and the kit on grey), and the store is
  not published before every photograph is made.

## Photographs (D270)

The owner found the drawn pictures fake and asked for pictures that look shot by a professional product photographer, made by the
platform's picture model. Every picture a signature pack's pages and products read now has a photographer's brief (`ContentPack.photos`),
and the pack's `look` is the shoot's direction, so a store's pictures look like one shoot:

* **Atelier**: a still-life photographer's catalogue, medium format, a 120 mm macro lens at f/8, window light from the left, limewashed
  plaster and travertine, an earthy palette and a warm film grade.
* **Arcade**: a night shoot with the signs as the only light, a 50 mm lens at f/2.8, real LED neon flex on acrylic with stand-offs and
  cables, dark painted brick, a little haze.
* **Botanica**: an interior and product shoot, a 50 mm lens at f/5.6, daylight from a window, warm plaster and light oak, pots in glaze,
  terracotta and seagrass.
* **Orbit**: long-exposure astrophotographs for the skies, and framed prints photographed on a dark gallery wall under one warm spotlight.

Heroes and bands say where the words sit, so their briefs keep that part of the frame calm. The photographs are made with *Make the
pictures* on the Store templates page, one at a time at the model's highest quality by a job on the server (D271: the page may be left),
and a pack is published only once all are made. The
drawn art stands in until then and stays as the themes' textures.

## Decided: the model never writes CSS (17 October 2026)

The owner chose the recommendation ("Let's go with your recommendations"). Hand-made themes (steps 2 and 3) use CSS freely, written and
reviewed in code. In step 5 the platform AI composes a theme from the hand-made library (headers, heroes, sections, product pages, motifs,
art recipes) and fills in its words and colours, and code writes every line of CSS from those choices; the model never writes a
declaration, a selector or a value. The alternative (model-written CSS through a strict checker) is not built. The three worlds of step 3 are
the ones proposed: Atelier, Arcade and Botanica.

## What production needs from a person

Signature themes reach production as the launch themes and packs do: a platform admin presses, on `/admin/platform/themes` (D273),
*Add and update Kaizena Flow's themes* and then *Bring it up to date* (or *Set up the starting content* the first time) on the *Starting
content* card after a deploy that changes them, then *Make the pictures* on
each signature pack, or *Make every picture* (D270: its photographs, made by the platform's picture model; D271: by a job, a minute or two
each, so the page may be closed), looks at them, and publishes the demo stores. A picture that did not come out well is made again
on its own from the theme's **Content** tab, *Its pictures* (D283): *Make again*, with its brief kept or changed; the new one takes the
old one's place wherever the store uses it (*Put back the one before* undoes it), and *Publish the content* takes it to the theme store.
