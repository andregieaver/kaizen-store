# Kaizena Flow's own site on themes: phase 4 of the theme store plan

Phase 4 of `docs/theme-store.md` (section 9): Kaizena Flow's own site switches theme as a store does. Today its look is a store's shape kept
on `platform_settings` (D235: `theme`, `fonts`, `custom_css`, `header_id`, `footer_id`), edited in Kaizena Flow's page builder's Theme tab,
with no library of installed themes, and no theme can be applied to it. Built in steps, each pushed on its own.

| Step | Builds | Done when |
|---|---|---|
| 1. The library | Kaizena Flow's installed themes (its *Custom* look first), adding a published theme without going live, switching, removing, at `/admin/platform/themes` | a platform admin adds a launch theme, switches the site to it and back, and no page, menu, word or picture of Kaizena Flow's changes |
| 2. Try before switching | a non-live install's preview on Kaizena Flow's own pages, customising it, *What changes*, updates of a followed theme | an admin previews and customises a theme before switching, and a new version reaches Kaizena Flow's site as it reaches a store |

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
holds the behaviour. Previewing and customising an install before switching, and updates of a followed theme, are step 2.
