# Themes as one thing: phase 1 of the theme store (D241)

Phase 1 of `docs/theme-store.md` (section 9). It makes a theme **one thing a store installs**, with several installed and one live, and changes
nothing a visitor sees on the day it ships. Seamless switching of content pages (section styles, the migration run for real, preview links,
updates) is phase 2.

## 1. Names (settled here, as section 10 of the plan asked)

| In the interface | In code and the database | What it is |
|---|---|---|
| **Theme** | design preset, `commerce.design_presets` | Kaizena Flow's whole look: settings, header, footer, product layout, CSS. The platform's, no `store_id`. |
| **Version** | `commerce.design_preset_versions` | What one Publish of a theme gave stores; append-only, numbered from 1. |
| **Installed theme**, **Theme library** | `commerce.store_theme_installs` | A theme in a store; several, one live. *Custom* is the store's own look. |
| **Theme settings**, **Saved theme** | `stores.theme`, `commerce.store_themes` (D60) | The live theme's settings, and the owner's saved versions of them. Unchanged. |

The plan's `commerce.themes` and `commerce.theme_versions` are therefore `design_presets` and `design_preset_versions`: a design profile
*is* a theme (its workspace, snapshot, cleaning, publish, archive and preview are what a theme needs), so a second table would have been a
copy. The platform's admin page keeps its address (`/admin/platform/design-profiles`) and is titled *Themes*.

## 2. The data

* `design_preset_versions (preset_id, number, snapshot, published_at, published_by)`: written only by `publishDesign()`, in the same
  statement as the snapshot, and only when the look differs from the latest version's (publishing the same look twice adds none). Never
  changed; deleted only with its theme (a theme is deleted only while unused, D177). Every theme published before has its version 1.
* `store_theme_installs (store_id, preset_id | null, version_id | null, title, look | null, live, installed_by, installed_at, switched_at)`:
  one live per store (a unique index), the live one's `look` null and every other's an object (a check). The live install's look **is the
  store's columns** (`stores.theme`, `custom_css`, `header_id`, `footer_id`, `product_layout_id`), which every reader reads as before; a
  non-live install keeps `{ theme, css, headerId, footerId, productLayoutId }`. An install keeps the theme and version it came from; the live
  one is never removed (`store_theme_installs_rules()`).
* Every store has an install from its first moment: `stores_first_install()` (after insert on `stores`) makes the live *Custom*. Every
  existing store got one; a store wearing a design profile (its newest use not put back) has that profile's name and version on it.
* `design_preset_uses` gains `install_id` and `previous_install_id` (set null when the install is removed; never otherwise changed).
* `COPY_RULES`: installs are `never` (a copy starts with its own *Custom*; the other installs' pages are the original's). In `PERSONAL_DATA`'s
  `NOT_PERSONAL`. The media library counts files a put-away install's look names as uses, and Compress rewrites them (D213).

## 3. What happens

* **Applying a theme** (`applyDesignPreset()`, from Design settings or the platform's store page) installs it and makes it live: the live
  install is put away with the look as it is now (`putAwayLive()`, every change kept), a new install of the theme's latest version becomes
  live, and the look is written as before. No "Before …" saved theme is made any more: the library holds the look before. At most
  `INSTALLS_MAX` (20) themes are installed in a store.
* **Switching** (`switchToInstall()`, *Switch to* in the library): one transaction under the store's row lock puts the live one away and
  writes the chosen one's look into the store's columns, checked as it goes in: a layout page only while it is still the store's, of its
  kind and published (else the standard one, said to the person), a saved theme only while it exists, the CSS only while `cssProblem()`
  passes it. A running A/B test of the header or footer refuses it (D148). Audited `store.theme_switched`.
* **Putting back the look from before** (`restoreDesignLook()`) switches to the install that was live before the latest use; a use from
  before installs makes its recorded look a new live *Custom*, so nothing is lost either way.
* **Removing** (`removeInstall()`) only one that is not live; the pages it chose stay in the store's pages. Audited `store.theme_removed`.
* Words, pictures, videos, links, products, prices, menus, the logo and business details are never touched by any of these.
* Writers of `store_theme_installs` are only `src/server/theme-installs.ts` and `applyDesignPreset()`; writers of the store's look columns
  are listed in `src/server/theme-installs.scan.test.ts` with what each writes, so phase 2 knows every writer it moves.

## 4. The migration of the plan's 4.4, as a dry run

`detachThemeValues(rows, elements)` (`src/lib/theme-detach.ts`) takes out of a page every setting of a row, heading, button or dual
button's text that only repeats the theme: one setting at a time, kept out only when the row laid under the theme (`themedRows()`) comes
out identical, so the page is drawn exactly as before by construction. Phase 1 only counts: `detachDryRun(store)`
(`src/server/theme-detach.ts`) reports per page how many settings would follow the theme and how many are the store's own, from
*Theme migration (dry run)* on the platform's store page. Nothing is written.

## 5. Not in phase 1

Customising a theme that is not live, a preview link on the store's own site, section styles, the migration run for real, updates of an
installed theme to a new version, the *What changes* summary, and the theme store site. The live look is still read from the store's
columns by its many readers; `liveLook()` is the one reader of the look as a whole, which phase 2 grows.
