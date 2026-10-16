# Presets and showcases: phase 1 of the theme showcase plan

Phase 1 of `docs/theme-showcase.md`: a theme gets **presets** (named designs over it) and each preset is shown on a **content pack** (a
clean demo store for one trade), so a theme can show a fashion store, a café and a spa rather than one borrowed demo store. Built in steps,
each pushed on its own; this file says what each step is and, once built, what it found.

| Step | Builds | Done when |
|---|---|---|
| 1. Presets (built, D256) | a theme's presets in its versions (`snapshot.variations`), edited on the theme's *Presets* tab, checked and published with the theme; previews, installs, applying and updates by preset; the theme page shows them | a platform admin adds a preset, publishes, sees it on the theme page, and an owner adds that preset to a store and gets it through updates |
| 2. Content packs (built, D257) | six demo stores for trades (fashion, beauty, food and drink, home, electronics, services) made from data in code, kept as store templates, with AI-made pictures that can be replaced | a platform admin sets up the packs, makes their pictures and publishes them; each is a clean store of its trade |
| 3. Showcases | a preset names its pack and its previews and card show it there; Calm, Hearth, Signal and Fjord get 2 to 4 presets each on fitting packs | each launch theme's page shows its presets, each on its own trade's store |
| 4. Starting from a preset | *Start with this theme* carries the preset; the new store is made from the preset's pack with its look, its demo content marked and removable in one press; an existing store may take a preset's home page, with undo | a person signs up from a preset and gets that store; an owner removes the demo content in one press |

## Decisions

* **Names.** The interface says *Presets*. In code a preset is a **variation** (`commerce.design_variations`, `DesignSnapshot.variations`,
  `src/lib/design-variations.ts`), never "preset" alone: `design_presets` are themes (D176, D241), and "variant" is a product's or an A/B
  test's. A theme's own look is its first preset and carries the theme's name; it is not a variation.
* **Presets live in the theme's versions.** A version's snapshot holds its presets, so a store that installed a preset gets that preset's
  next version through the same update (D245), and the theme page reads them from the published version. That makes the snapshot **version
  2** (`v: 2`, `variations` added; version 1 is read as version 2 with none), as `docs/design-profiles.md` asks of anything new a theme
  carries.
* **A preset is a look over the theme, not another theme.** It holds a whole `theme` (the D60 template and every setting: colours light and
  dark, fonts, headings, buttons, corners, layout, product cards, elements, section styles, hover). The theme's header, footer, product
  layout and CSS are shared by its presets (a preset's own header and footer may come later; nothing in phase 1 needs one). Applying a preset
  is applying the theme with the preset's settings in place of the theme's (`variationSnapshot()`), so every check, writer and preview of a
  theme serves a preset unchanged.
* **At most six presets a theme**: the theme's own look and five variations (`VARIATIONS_MAX`). Each passes `themeCheck()` before Publish,
  as the theme does.
* **A preset's key is fixed.** Installs remember the preset by its key (`store_theme_installs.variation`); a name can change, a key cannot.
  A preset taken out of a later version leaves its installs on the theme's own look at their next update, and *What's new* says so.
* **Content packs are store templates.** A pack is a real store marked `starter` (D175), made from data in code (`CONTENT_PACKS`, as
  `LAUNCH_THEMES` are) and published as any store template, so its frozen copy is what previews draw and what a new store is copied from
  (`starter_source()`), and owners can choose it as *Fashion store* and so on. It is written in **English** (its main language `en-GB` at its
  country's own address; new stores made from it can change language as any store does), sells where the default template does, and holds
  only its trade's demo: no test pages, no other trade's products.
* **Pictures are made by AI and replaceable.** A pack's pictures are made by Kaizena Flow's picture model (`generateImage()`, metered as the
  feature `content_pack`), one per request from the pack's page, prompts from the pack's data (no text or logos in a picture), kept in the
  pack store's media library; a platform admin may replace any picture in the pack's own store admin. A pack is published only once every
  product has a picture.
* **Demo content is marked.** What a pack brings into a new store is marked as demo, so *Remove demo content* takes it out in one press
  (step 4), never touching what the owner made.

## Step 1: presets

**Data.**

* `commerce.design_variations`: a theme's presets as drafted (`preset_id`, `key` (fixed, `^[a-z0-9][a-z0-9-]{0,39}$`, unique per theme),
  `name` (1 to 40), `position`, `theme` (the D60 `{ base, settings }`), `created_by`/`updated_by`/`created_at`/`updated_at`), at most
  `VARIATIONS_MAX` a theme, the key fixed (`design_variations_rules()`). Deleted with its theme; outside `COPY_RULES` (no store), in
  `NOT_PERSONAL`.
* `design_presets.snapshot` and `design_preset_versions.snapshot` accept version 2; Publish writes version 2.
* `store_theme_installs.variation` and `platform_theme_installs.variation`: the preset an install was made from (null: the theme's own
  look), fixed like the theme.

**Platform admin** (`/admin/platform/design-profiles/{id}/presets`, a tab after *Theme*): the theme's own look first (its name, *Edit* goes
to the Theme tab), then each preset with *Edit*, *Rename*, *Move up* / *Move down*, *Remove* and *Preview*; *Add a preset* (a name; it
starts as a copy of the theme's drafted settings). A preset's page (`…/presets/{key}`) is the theme editor (`ThemeEditor`) saving into the
row through the theme's own actions (`requirePlatformAdmin()`, the row of that theme, `checkStoreTheme()` against the workspace for fonts).
Presets are part of the draft: *Unpublished changes* shows while they differ from the published version (`designChanged()`), and Publish
checks each one (`themeCheck()` of `variationSnapshot()`, the core section styles kept) and writes them into the version. Audited
`platform.design_variation_added`, `_renamed`, `_moved`, `_removed`, `_saved`.

**Previews.** `designPreviewPath(…, { variation })` adds `preset={key}`; the public preview draws the published version's preset, the
admin's draft preview the drafted one. An unknown key is not found.

**Stores.** Adding a theme to a store (*Add to my themes*, *Try it in your store*, the platform's *Apply to this store*) offers its presets
when it has more than one, the theme's own look chosen; `installDesignPreset()` and `applyDesignPreset()` take the preset's key and place
`variationSnapshot()`; the install keeps the key, and `updateThemeInstall()` lays the new version's same preset under the owner's changes
(the theme's own look when the preset is gone). Kaizena Flow's own site does the same (`installPresetOnPlatform()`).

**The theme store.** A theme with presets lists them on its page above the previews: choosing one shows it in both frames (a small client
part; without JavaScript each is a link to its preview). Its card says how many presets it has. Presets' own addresses and the stage come
in phase 3.

**Tests.** `src/lib/design-variations.test.ts` (keys, the snapshot laid over, version 1 read as 2, limits), the PGlite test (the key
fixed, the limit, version 2 accepted, installs' preset fixed), `src/server/design-variations.int.test.ts` (add, edit, publish into a
version, a preset that fails the check refuses Publish, preview by preset, install and apply by preset, an update following the preset and
falling back when it is gone), the view tests of the tab and the theme page, and `e2e/theme-store.spec.ts` (a theme's presets on its page).

**Built (D256).** `src/lib/design-variations.ts` (keys, `variationSnapshot()`, `installedLook()`, `presetLine()`, `publishedVariations()`,
`presetChoice()`), the version 2 snapshot in `src/lib/design-presets.ts` (`designVariationSchema`, `snapshotAsStored()`),
`src/server/design-variations.ts` and the drafted presets in `publishDesign()`, `designChanged()`, `designChecks()` (`draftedSnapshot()`,
`checkedDesign()`), the preview, `placeDesign()`, `installPresetOnPlatform()` and both updates; the *Presets* tab and a preset's page under
`/admin/platform/design-profiles/{id}/presets`; a card per preset in `DesignProfilePanel` and on Kaizena Flow's own themes page; presets on the
try page and `ThemePreviewStage` on the theme page. Held by `src/lib/design-variations.test.ts`, the PGlite tests in
`src/db/design-presets.test.ts`, `src/server/design-variations.int.test.ts`, the panel's and list's view tests and `e2e/theme-store.spec.ts`.
*Deviation:* an install keeps its preset's key for good, also while a version has no such preset (the plan let it fall to none); undoing an
update then needs nothing extra, and a version that brings the preset back brings the install back to it.


## Step 2: content packs

**Data.** `CONTENT_PACKS` (`src/lib/content-packs.ts`, pure, as `LAUNCH_THEMES` are): six packs, one a trade (`fashion`, `beauty`, `food`,
`home`, `electronics`, `services`), each a `version`, its store template's card (title, summary, description, category), the demo store's
name, its home page's words (headline, tagline, three points, a story), its about page, its categories and six to eight products (a fixed
handle, words, a price in Norway's kroner, a category, a weight for goods or minutes for an appointment, and what its picture shows), and the
art direction its pictures share. Everything is hand-written English free of claims (`findClaims()`). Prices: the same number in Sweden's
kronor, about two thirds in Denmark's, ending in 9 (`packPrice()`). `store_starters.pack_key` (unique), `pack_version` and `pack_pictures`
(the pictures made, by slot) mark a store template as a pack's.

**Setting up** (`syncContentPacks()`, `src/server/content-packs.ts`, platform admins, from *Content packs* on the Store templates page): a
pack without a template gets one (`createStarter()` from the default template, at `/s/pack-{key}`), and one whose template has an older
version is written again; an archived one is left alone. Writing a pack: features `shop` and `countries` (and `appointments` for services),
English as its only language (`stores.locales`, every market's `default_locale`), the template's products archived (so no copy carries them,
`clone_store()` skips archived ones) and its other pages, staff and product terms gone, the pack's categories, its products through the
product editor's own save (`saveProduct()`: checks, prices through `set_price` with the price entry, stock 40 as an opening movement, the
maker and EU responsible person the template has; a picture already on a product stays), its menus (Home, Shop or Services with the
categories under it, About), and its pages through the builder's save, published: its home page (`packHomePage()`, the front page), its
about page and its own All products page (`packProductsPage()`), in the core section styles so each theme and preset draws them its own way.
A pack is the code's: writing it again replaces its pages, words, prices and menus (not its pictures).

**Pictures** (`makeNextPackPicture()`): the next slot without a picture (the home page's hero, its story, then each product, `packSlots()`),
made by Kaizena Flow's picture model (`aiFor(null, { feature: "content_pack" })`; no picture model is said, never worked around) from the
pack's brief (`packPicturePrompt()`, no words, logos or faces), kept in the pack store's media library by `makePicture()`, placed (a
product's through the editor's save; the pages written again) and only then recorded in `pack_pictures`. One a request: the page's *Make
the pictures* asks again while some remain, can be stopped, and what is made stays. Until then a product shows `PACK_PLACEHOLDER`.

**Publishing** is the store template's own Publish, refused while a pack has pictures to make (`picturesMissing()`).

**Tests.** `src/lib/content-packs.test.ts` (six packs, words free of claims, whole small stores, briefs, prices),
`src/lib/content-pack-pages.test.ts` (the pages pass `pageInput`, pictures where made), `src/server/content-packs.int.test.ts` (each pack a
clean English store of its trade with its products, prices in every market, categories, pages, menus and staff; nothing done to a current
pack, a pack written again when older; pictures one a request until none is missing, refused without a picture model; Publish refused
before and done after, the copy holding the pack alone).

**Built (D257).** As above. *Deviations:* the pack's products are written through `saveProduct()` rather than SQL (the price-audit scan
holds every price to it); the pack keeps the template's `countries` so it sells where the template does.
