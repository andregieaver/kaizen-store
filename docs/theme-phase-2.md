# Seamless switching: phase 2 of the theme store (D242)

Phase 2 of `docs/theme-store.md` (section 9): an owner switches between themes and back with no word, picture, video, link or menu changed,
and the look follows. Built in steps, each pushed on its own; this file says what each step is and, once built, what it found.

| Step | Builds | Done when |
|---|---|---|
| 1. Section styles | `ThemeSettings.sectionStyles`, `PageRow.sectionStyle`, the core names, layering, the Theme tab and the row's choice | a row naming a style looks as the live theme says, a theme without it gives its Plain, and pages that name none look as before |
| 2. The page migration for real | `detachThemeValues()` run per store with the page's content before kept, undo, report | a store's pages look the same after (parity test) and follow the theme from then on |
| 3. Try and preview | customising a theme that is not live, a preview of the store's own pages in it, *What changes* | an owner sees their own pages in another installed theme without visitors seeing anything |
| 4. Updates | owner's changes kept apart from the version, follow updates, *What's new* | a new version reaches installs that follow, with the owner's changes laid over it again |
| 5. Launch themes and `themeCheck()` | the checks of `docs/theme-store.md` 7 and 3 to 5 Kaizena themes | every launch theme passes, and the switch e2e (every content field the same before and after) passes on each |

## Step 1: section styles

**What it is.** A *section style* is a named set of theme elements (D182: row, h1 to h6, p, list, button) for the rows that name it. A row
naming `hero` takes, for itself and what it holds, the theme's `hero` elements laid over the theme's own elements (`layerUnder()`), and its
own settings win over both, at the sizes it sets them (as D182). Nothing is ever written into the page: a row stores only the name.

**Names.** `CORE_SECTION_STYLES` (`src/lib/section-styles.ts`): `plain`, `hero`, `feature`, `muted`, `contrast`, `quote`, each with a label
and a hint. Every Kaizena theme defines the core names, so switching between them always lands; a theme may add its own (a lowercase name
of letters, digits and hyphens, at most 12 in all). A row naming a style the live theme does not have takes the theme's `plain`; with no
`plain` either, the theme's own elements, as a row naming none.

**Data.** `ThemeSettings.sectionStyles?: Record<name, ThemeElements>` (part of the theme's settings, so it travels with a design profile's
snapshot, a theme's versions, installs and saved themes without anything new); `PageRow.sectionStyle?: string` (a name, never CSS; kept by
copies and templates, as any setting of a row).

**Drawing.** `themedRows(rows, elements, sections)` takes the section styles beside the elements; `themeLayersFor(owner)` reads both (the
store's theme, or Kaizena Flow's own, D235). The builder's canvas lays them the same way, so the canvas and the site agree.

**Editing.** The Theme tab edits the site's elements or one section style's (a choice at the top: *Whole site* or a style), with the same
fields. A row's General tab chooses its section style (*None* keeps the row on the site's elements). Saved by `saveThemeTab()` with the rest
of the tab.

**Built (D242).** `src/lib/section-styles.ts`, `layerElement()` and `sectionStylesSchema` in `src/lib/theme-elements.ts`, `themeLayersFor()` in `src/server/theme-elements.ts`, the Theme tab's *Elements for* and the row's *Section style* in `page-builder.tsx`; held by `src/lib/section-styles.test.ts` and `e2e/theme-elements-live.spec.ts`.

**Not in step 1.** Section styles on components other than rows (a button already has its variants), and Kaizena's launch themes defining
them (step 5).

## Step 2: the page migration for real

**What it is.** *Let pages follow the theme* (Design settings, `website:write`) takes out of a store's pages every style setting of a row,
heading, button or dual button's text that only repeats the live theme (its elements and, for a row naming one, its section style), with
`detachThemeValues()` (D241): a setting goes only when the row laid under the theme comes out identical, so every page is drawn exactly as
before and, from then on, follows the theme it is switched to. Settings that differ from the theme are the owner's and stay. *Count the
settings* is the dry run; nothing runs by itself.

**Which pages.** Every page of the store (drafts and published versions), except: versions of an A/B test and pages in a running or
scheduled test (D148: its versions are compared setting by setting); headers, footers and product layouts that an installed theme that is
not live chose (they are drawn under that theme once switched to); and global parts (D98), left as they are on every page so no page
differs from its source.

**Undo.** A run is one transaction under the store's row lock; each page it changed keeps its draft and published versions before and after
in `commerce.page_theme_detaches` (the rows keep what they recorded; only `undone_at` changes, once). *Undo* puts back each version only
while it is still what the run left: a page changed since keeps the change, and the answer says how many. Runs are kept 90 days
(`pruneThemeDetaches()` in the daily job), then can no longer be undone.

**Built (D243).** `runDetach()`, `undoDetach()`, `listDetachRuns()`, `pruneThemeDetaches()` and the page choice in `src/server/theme-detach.ts`,
`ThemeFollow` (`src/components/admin/theme-follow.tsx`) on Design settings; held by `src/server/theme-detach.int.test.ts` (drawn the same before
and after, undo, a page changed since, a page a put-away theme keeps), `src/lib/theme-detach.test.ts` and the rules' test in
`src/db/commerce.test.ts`.

## Step 3: try and preview

**Customise.** Each installed theme that is not live has a page, `/admin/{store}/settings/design/themes/{install}` (*Customise* in the theme
library; *Open* for someone who may only look): the same theme editor as the live theme's, saved into the install
(`saveInstallLook()`, checked by `checkStoreTheme()` as the live theme's save is), its own CSS (`cssProblem()`), and its header, footer and
product page, which are pages of the store with *Edit* links. The live theme is still edited on Design settings; its page address goes there.
Visitors see nothing of an install until the store switches to it. Audited `store.theme_customised`.

**Preview.** `/admin/{store}/settings/design/themes/{install}/preview` draws one of the store's published pages or articles (a list of them
above it), or one of its products, with the install's settings, section styles, header, footer, product page and CSS in place of the live
ones, without writing anything (`installPreview()`, `previewPageContent()`). The plan's 4.5 put the preview on the storefront (`?theme=` with a
signed token, served like the A/B tests' versions); it is served from the admin instead, in the `(print)` group (no admin frame, the session
checked, `website:read`), read per request, `noindex`, no cookie, its content inert: no visitor and no cached page of the site can ever be
handed it, and nothing on the storefront's proxy or caches had to change. What it gives up: the store's own domain and moving around the
site by its links (the list of pages above it stands in).

**Rows in another theme.** `GridPlace.theme` carries the layers to lay under the rows in place of the owner's live ones
(`PageRowView` reads it before `themeLayersFor()`); the preview passes the install's, and a store's own header, footer and product layout
pass the store's they are drawn with (`themeLayersOf(store.theme.settings)`, the same as before on the live site). The design-profile
preview (D176) now draws its front page's rows in the profile's theme too, where they took the store's live one.

**What changes.** `whatChanges()` (`src/lib/theme-changes.ts`, pure) over the live look, the install's and the store's pages and articles as
visitors see them (`whatChangesFor()`): the layouts that change, by title or as the standard one; each section style the pages name, how
many pages, and whether the other theme has it (else its Plain, else its site-wide elements); the settings that are the owner's own against
the other theme and stay; the settings that only repeat the live theme and so keep today's look (with a pointer to *Let pages follow the
theme*); the fonts that come in; and where owner CSS is involved. Sentences in code from facts; nothing about colours or taste, which the
preview shows.

**Built (D244).** `src/lib/theme-changes.ts`, `src/server/theme-preview.ts`, `installLook()` and `saveInstallLook()` in
`src/server/theme-installs.ts`, `checkStoreTheme()` in `src/server/themes.ts`, the theme page and its actions, the preview page,
`ThemeChanges`, the library's links and the theme editor's `installed` wording; held by `src/lib/theme-changes.test.ts`,
`src/server/theme-preview.int.test.ts`, `theme-changes.test.ts` and `theme-library.test.ts` (views) and `e2e/signed-in/themes.spec.ts`.

**Not in step 3.** The page builder's canvas still draws a non-live theme's header, footer or product layout in the live theme; *Add this
theme's pages as drafts* (4.5) waits for themes with demo pages (step 5).


## Step 4: updates

**Versions stay; what was placed is kept.** A published version never changes (D241; its *What's new* note, `design_preset_versions.notes`,
is written with it and fixed by the same trigger). An install now keeps what it placed in the store when it was applied or last updated
(`store_theme_installs.placed`: the settings and CSS written, and each layout page with a fingerprint of its rows and CSS), so the owner's
own changes are what differs from that. An install from before step 4 takes its version's snapshot as what was placed, and its layouts
as the owner's.

**An update.** `updateThemeInstall()` lays the new version under the owner's changes again, in one transaction under the store's and the
install's row locks: each setting the owner left as placed takes the new version's, one they changed stays theirs (`mergeSettings()`, a
three-way merge key by key; a list is one setting), the same for the CSS (`cssFate()`); a header, footer or product page the owner has not
touched is replaced by a new page of the new version's, one they edited or chose stays and the new version's is made beside it as a draft
(`layoutFate()`); a version without one gives the standard one where the owner's was untouched. The merged settings pass the theme's
schema, or nothing is changed. A live install writes the store's columns, any other its `look` (D241). The database lets an install's
version move only to another version of its own theme.

**Following updates.** `store_theme_installs.follows_updates` (on unless the owner turns it off, per installed theme, `setFollowsUpdates()`,
audited `store.theme_follows_updates`): the five-minute job (`runThemeUpdates()`, twenty a run, open real stores only) updates installs
that follow, made for the person who installed the theme or else the owner. Others wait for *Update now*.

**What's new.** `whatsNew()` (`src/lib/theme-update.ts`, pure): the theme's own note first (written by the platform's admin in *Publish…*,
at most 2000 characters), then from facts the areas of settings that changed, new, changed and removed section styles, layouts and CSS.
Shown on Design settings beside each waiting update (`ThemeUpdates`).

**Undo.** Each update keeps the look before and after (`commerce.theme_install_updates`: only `undone_at` changes, once, by trigger;
kept 90 days, `pruneThemeUpdates()` in the daily job). `undoThemeUpdate()` puts the look and the version back only while the install
still has the look the update left; drafts it made stay in the store's pages. Audited `store.theme_updated` (with `automatic`) and
`store.theme_update_undone`.

**Core section styles.** `publishDesign()` refuses a version without a core section style (D242) the last version had
(`coreStylesRemoved()`), so no update takes one away.

**Built (D245).** `src/lib/theme-update.ts`; `updateThemeInstall()`, `undoThemeUpdate()`, `themeUpdates()`, `runThemeUpdates()`,
`pruneThemeUpdates()` and the `placed` record in `applyDesignPreset()` (`src/server/design-presets.ts`); `setFollowsUpdates()` in
`src/server/theme-installs.ts`; the publish note in `LifecycleButtons`; `ThemeUpdates` on Design settings; held by
`src/lib/theme-update.test.ts`, `src/server/theme-updates.int.test.ts`, `src/db/commerce.test.ts` and `theme-updates.test.ts` (view).

**Not in step 4.** No email tells an owner of an update; updates of the layouts' content are all or nothing per page (an edited page is
never merged row by row).

## Step 5: launch themes and `themeCheck()`

**The checks.** `themeCheck()` (`src/lib/theme-check.ts`, pure; the server passes it the page rules, `checkedSnapshot()`) runs on every
version before it is published, Kaizena's own included, and on a theme's Details tab (`ThemeChecks`, `designChecks()`, on the draft Publish
would take). Of the plan's 7 it holds: (1) the package reads (`designSnapshotSchema`) and each header, footer and product page passes
`pageInput` and `pageRulesProblem()` as the store would get it (`layoutForStore()`); (2) accessibility, `pageIssues()` on each layout in
every colour set the theme shows (`themeSetsOf()`), the footer's legal parts included; (3) contrast of the palette (text and buttons block,
secondary text and the surface warn) and of the site-wide elements and every section style, each kind of text over the row's own background
in light and dark (headings 3:1, the rest 4.5:1, `blend()` first); (4) the core section styles; (5) what the checkout's pages may not hold, in
the header and footer drawn on them (`pay_page_block`); (6) words through `findClaims()` and no link off the site (a full address, an email
or a phone number). A blocking finding refuses Publish with what to fix; warnings are said. Speed and phones (7, 8) are held for Kaizena's
themes by the switch e2e, in a browser.

**Every theme has the core styles.** A theme's workspace is given the core section styles it lacks (`withCoreStyles()`,
`NEUTRAL_CORE_STYLES`, legible on light and dark pages alike) when it is made from scratch or a look is written into it, so a theme from a
store passes the checks until the admin makes the styles its own.

**Launch themes.** Four, as data in `src/lib/launch-themes.ts` (`LAUNCH_THEMES`): Calm (from Minimal), Hearth (Warm classic), Signal (Bold
modern) and Fjord (a blue-grey palette on Minimal), each with its own palette or fonts, elements and all six core section styles, and the
standard header, footer and product page. *Add and update Kaizena Flow's themes* on the platform's Themes page (`syncLaunchThemes()`,
`src/server/launch-themes.ts`) makes and publishes each not there yet (found again by `design_presets.launch_key`) and publishes a new
version of one whose `version` in code is newer than the one published (`launch_version`), its `notes` as *What's new*, which installs
that follow updates take (D245). An archived one is left alone. A change to a launch theme is a raised `version` and a note.

**The switch e2e.** `e2e/signed-in/theme-switch.spec.ts`: the owner switches a store through every launch theme and back from Design
settings; every content field (pages and articles, products, their texts, variants and pictures, menus, the logo, business details and the
store's chosen pages) is fingerprinted in the database before and after each switch and must not change, the storefront's words (as the
page holds them, not as CSS capitalises them), pictures and links must be the same, the site must draw the theme's accent, and on a phone
nothing may run off the screen. Staff's own tools on the page (`data-staff-tools`, the way back to the admin) are not content.

**Built (D246).** `src/lib/theme-check.ts`, `src/lib/launch-themes.ts`, `src/server/launch-themes.ts`, `checkedSnapshot()`,
`designChecks()` and `writeDesignLook()` in `src/server/design-presets.ts`, `ThemeChecks`, the launch themes card and action; held by
`src/lib/theme-check.test.ts`, `theme-checks.test.ts` (view), `src/server/launch-themes.int.test.ts` and the switch e2e.

**Not in step 5.** Presets of a theme (the plan's 1 to 4 named variations), its own section rows offered in the builder, working-page
layouts and a demo store: a snapshot is still `v: 1`. The performance budget is not run per theme (a theme adds settings only, no layout or
CSS of its own). The launch themes are added on a platform admin's press, not by a migration.
