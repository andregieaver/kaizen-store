# Kaizena Flow's own site on themes: phase 4 of the theme store plan

> **Since D273** the page described here as `/admin/platform/themes` is Website → Design at `/admin/platform/site-design` (and its install
> pages under it); `/admin/platform/themes` is the themes themselves (`docs/themes-unified.md`).

Phase 4 of `docs/theme-store.md` (section 9): Kaizena Flow's own site switches theme as a store does. Today its look is a store's shape kept
on `platform_settings` (D235: `theme`, `fonts`, `custom_css`, `header_id`, `footer_id`), edited in Kaizena Flow's page builder's Theme tab,
with no library of installed themes, and no theme can be applied to it. Built in steps, each pushed on its own.

| Step | Builds | Done when |
|---|---|---|
| 1. The library | Kaizena Flow's installed themes (its *Custom* look first), adding a published theme without going live, switching, removing, at `/admin/platform/themes` | a platform admin adds a launch theme, switches the site to it and back, and no page, menu, word or picture of Kaizena Flow's changes |
| 2. Try before switching | a non-live install's preview on Kaizena Flow's own pages, customising it, *What changes* | an admin previews and customises a theme before switching, and nothing visitors see changes until the switch |
| 3. Updates | a followed theme's new version reaching Kaizena Flow's installs (under its own changes, with undo), as a store's do (D245) | a new version reaches Kaizena Flow's site as it reaches a store |

## Decisions

* **A table of its own.** Kaizena Flow's installs are `platform_theme_installs`, not rows of `store_theme_installs` with no store: that
  table, its one-live index, its first-install trigger and the tables beside it (`design_preset_uses`, `theme_install_updates`) all need a
  store, and a null there would weaken every rule that holds for stores.
* **The live look stays where it is read.** As for a store (D241), the live install's look *is* `platform_settings`' columns, read as ever
  by the platform's layout and builder; a non-live install keeps it in `look`. Kaizena Flow's fonts are a column of their own (D235), so its
  look carries them: `{ theme, css, fonts, headerId, footerId }`.
* **One apply for both.** Adding a theme to Kaizena Flow goes through the same `placeSnapshot()` as a store's (fonts, pictures copied into
  Kaizena Flow's media library, layouts placed with its own menus and checked as a save is), with the platform as the owner. A theme's product
  page is a store's and is left out, said in the notes.
* **Nothing else of the site changes.** Switching writes only the look columns; pages, articles, menus, navigation, business details and the
  platform's settings stay.

## Step 1: the library

**Data.** `commerce.platform_theme_installs`: like `store_theme_installs` without the store (one live by a unique index on `live`, `look`
null exactly for the live one, the theme and version it came from fixed, the live one never removed: `platform_theme_installs_rules()`),
seeded with a live *Custom* install for the look the site has. A theme with one of Kaizena Flow's installs counts as used (its delete is
refused by the foreign key, and the themes list counts it).

**Server.** `src/server/platform-theme-installs.ts` (the only writer of the table besides the apply in `src/server/design-presets.ts`;
a scan test): `listPlatformInstalls()`, `putAwayPlatformLive()` (the columns into the live row's `look`), `writePlatformLook()` (a kept look
checked as it goes in: its header and footer still Kaizena Flow's published pages of their type, its CSS through `cssProblem()`),
`switchPlatformInstall()`, `removePlatformInstall()`; `installPresetOnPlatform()` in `design-presets.ts` adds a published theme without going
live. Every one is a platform admin's, audited `platform.theme_*`, and the callers refresh the platform's look tags
(`PLATFORM_NAVIGATION_TAG`, `PAGES_TAG`).

**Admin.** `/admin/platform/themes` under Website: the library (live first, *Switch to it*, *Remove*) and the published themes to add.

**Built.** The migrations `platform_theme_installs` and `platform_theme_installs_rules`, `src/server/platform-theme-installs.ts`,
`installPresetOnPlatform()` (with `placeSnapshot()` and `copyToLibrary()` taking the platform as owner), the page and its actions under
`src/app/admin/(gated)/platform/themes/`, Kaizena Flow's theme and kept looks in `mediaUses()` and `rewriteAddresses()`; held by the PGlite
test of the rules, `src/server/platform-theme-installs.int.test.ts` (added without going live, switched to and back with the look alone
changed and pages, menus and settings the same, the live one kept, a theme in use not deleted, admins only) and the scan tests of the
table's and the look columns' writers (`theme-installs.scan.test.ts`).

**Not in step 1.** No browser test: the signed-in fixtures have no platform admin (who would need two-step sign-in); the integration test
holds the behaviour. Previewing and customising an install before switching are step 2; updates of a followed theme are step 3.

## Step 2: try before switching

**Server.** `savePlatformInstallLook()` in `src/server/platform-theme-installs.ts` keeps theme settings (checked as the live theme's are,
`checkPlatformTheme()` in `src/server/themes.ts`; the settings' fonts written into the look's `fonts` as well) or its own CSS (`cssProblem()`)
in an install that is not live, refused for the live one, audited `platform.theme_customised`. `platformInstallLook()` reads any install with
its look (the live one's from `platform_settings`). `src/server/platform-theme-preview.ts`: `platformInstallPreview()` (the look with its fonts
laid over it by `platformTheme()`, its header and footer while they are Kaizena Flow's published pages, Kaizena Flow's published pages and
articles), `platformPreviewPage()` and `whatChangesForPlatform()` (the store's `whatChanges()`; Kaizena Flow has no product page, so that
layout is never named).

**Admin.** `/admin/platform/themes/{install}` (from the library's *Preview and customise*): *Switch to it*, *What changes*, its header and
footer to edit, the store's `ThemeEditor` (without saved themes: Kaizena Flow keeps none) and its own CSS; the live one goes back to the
library. `/admin/platform/themes/{install}/preview` in the admin's `(print)` group: one of Kaizena Flow's pages or articles (its front page
first) with the install's look, inert and `noindex`, the header and footer given the install's layers (`KaizenSiteHeader`/`KaizenSiteFooter`
`theme`).

**Built.** The above, held by `src/server/platform-theme-installs.int.test.ts` (the preview reads the install's look, *What changes* names the
fonts and never a product page, customising leaves the live look as it was and is refused for the live one and for non-admins, switching wears
the customised look with nothing else changed). No migration. No browser test, as in step 1.

## Step 3: updates (D253)

**Data.** `platform_theme_installs.follows_updates` (on unless switched off, as a store's) and `commerce.platform_theme_install_updates`: the
look before and after each update and what was kept as the admins' own, as `theme_install_updates` is a store's (only `undone_at` changes,
once; removed with its install; deleted after `THEME_UPDATE_KEEP_DAYS` by `pruneThemeUpdates()`). The install's rule now lets its version move,
only to another version of its own theme (`platform_theme_installs_rules()`, as `store_theme_installs_rules()`).

**Server.** In `src/server/design-presets.ts`, beside the store's: `updatePlatformInstall()` (the new version's fonts and pictures through
`placeSnapshot()` with the platform as the owner, then under `platform_settings`' row lock the settings by `mergeSettings()` against what was
placed, Kaizena Flow's fonts counted as its settings, the CSS by `cssFate()`, the header and footer by `layoutFate()`, an edited one kept and the
new one a draft beside it; no product page), `undoPlatformThemeUpdate()` (only while the install shows exactly what the update left),
`platformThemeUpdates()` (what is waiting with *What's new*, the installs and the latest updates; shares `updatesView()` with the store's
`themeUpdates()`) and `runPlatformThemeUpdates()` in the five-minute job, which refreshes Kaizena Flow's look tags when it updated one.
`setPlatformFollowsUpdates()` is in `platform-theme-installs.ts`. Audited `platform.theme_updated` (with `automatic` for the job),
`platform.theme_update_undone`, `platform.theme_follows_updates`.

**Admin.** The store's `ThemeUpdates` card on `/admin/platform/themes`, with Kaizena Flow's own words: *Update now*, *What's new*, whether each
theme updates by itself, the latest updates with *Undo*.

**Built.** The migrations `platform_theme_updates` and `platform_theme_updates_rules`, the functions above, the card and its actions; held by the
PGlite test of the rules, `src/server/platform-theme-updates.int.test.ts` (a new version laid under fonts chosen on the Fonts page and an edited
footer, the untouched header replaced as a Kaizena Flow page, the footer's new version a draft, undone back to the look before, the job updating
only an install that follows updates, admins only, the site's look as it was once switched back) and the scan test of the update log's writers.
No browser test, as in step 1.
