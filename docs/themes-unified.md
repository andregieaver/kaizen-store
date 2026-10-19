# Themes, one concept (D273)

Kaizena Flow had three names and three pages for what an owner sees as one thing:

| Before | What it was | Now |
| --- | --- | --- |
| Design profile (D176) | A whole look kept to use again: theme settings, header, footer, product page, CSS | **Theme** |
| Variation (D256) | A named look over a theme | **Preset** (unchanged) |
| Store template (D175) and content pack (D257) | A store copied into every new store: products, pages, menus, settings | **Demo store** |
| Themes on Kaizena Flow's own site (D251) | The themes installed on the platform's own site | **Design**, under Website |

The tables stay as they are (`design_presets`, `design_variations`, `store_starters`, `platform_theme_installs`), so no migration: the
unification is the interface, the choice a new store starts from, and the words.

## 1. The rule

A theme has its own look and up to five presets. Since D275 (`docs/themes-content-and-demo-stores.md`) every look is shown on the theme's
own content, and **a new store started from a theme begins as a copy of that content**: its products, pages and menus, marked as demo
content and removed by the owner in one press (D260). A theme with no published content starts new stores from the Standard store.
(Under D273 each look had a demo store of its own, chosen on the theme's page; that choice is gone.)

Nobody chooses the content apart from the look. The server works it out from the look:

* `demoStoreForLook({ id, variation })` (`src/server/design-presets.ts`): the theme must be published and not archived; the look is the
  preset when the theme's published version has it, else the theme's own look; its demo store is the published store template of the
  content pack the listing names for that look (`ThemeListing.pack` or `presetPacks[key]`, through `themeLooks()`); else null.
* Sign-up (`createAccessRequestAction`), *Create a store* (`createStoreAction`) and approving a request (`approveRequestAction`) send a
  theme choice only (`designLookChoice()`) and pass `demoStoreForLook()` as the starter. `createStoreForOwner()`,
  `approveAccessRequest()` and `commerce.starter_source()` are unchanged.

## 2. Owners

* The theme cards (`DesignCards`) are the one choice at sign-up and *Create a store*, the Standard card first. Each card and each preset
  says what it starts with: "Starts with the demo store {store}, {what}" (`Showcase.line`) or "Starts with the standard demo products".
* The store-template cards (`StarterCards`, `starterCards()`) and a template's recommended design are gone from every form.
* Access requests show the theme chosen; the platform's request form offers one *Theme* field listing each theme and preset with its demo
  store.

## 3. The platform

* **Stores → Themes** (a rail section of its own since D285; `/admin/platform/themes`, `THEMES_ADMIN`): the themes (as before), *Kaizena Flow's themes* (the launch themes),
  *New theme*, and the **Demo stores** card: each content pack's demo store with its state (not set up, newer version, pictures to make,
  making pictures, ready to publish, published), the themes that show it, *Make the pictures* (the job, D271) and *Publish* in the row.
  Store templates made by hand before D273 are listed under *Older demo stores*; no look starts from them and the admin makes no new one.
* **A theme's page** (`/admin/platform/themes/{id}`) has a **Demo stores** card: one choice per look (its own and each preset) with
  *Preview* there (published and draft), saved at once by `saveThemeDemoStores()`; the theme store listing's save keeps the choice. A look
  whose demo store is not chosen or not published is left out of the theme store (D274), and the card says so beside it.
* **A demo store's page** (`/admin/platform/themes/demo-stores/{id}`, `demoStoreHref()`): publish (freezes its store, D177), unpublish,
  archive, restore, delete while unused, open its admin, preview it, and the features a new store starts with.
* **Website → Design** (`/admin/platform/site-design`, `SITE_DESIGN`): Kaizena Flow's own site's installed themes, as D251 to D253 built
  them.
* The old addresses redirect (`LEGACY_THEME_REDIRECTS` in `src/lib/theme-admin-paths.ts`, used by `next.config.ts`):
  `/admin/platform/design-profiles/**` and `/admin/platform/store-templates` to the Themes page, a store template's page to its demo
  store's page, and `/admin/account/design-profiles/{id}/preview` to `/admin/account/themes/{id}/preview`. An id of one of Kaizena
  Flow's installs at a theme's address (the site's old page) goes on to Design (`designPage()`).

## 4. Words

What a person or an assistant reads says *theme*, *preset* and *demo store*: the admin, the storefront's notice on a demo store
(`m.starterNotice`, `m.starterCheckout` in nb, sv, da and en), refusals, the AI manager's map. `src/lib/theme-words.scan.test.ts` walks
every string literal, template text and JSX text of `src/` (never identifiers, property names, comments, SQL comments or the admin map's
search `keywords`, which keep the old names so a search for them still finds the page) and fails on *design profile*, *store template*,
*butikkmal*, *butiksmall* and *butiksskabelon*.

## 5. Tests

* `src/server/design-presets.int.test.ts`: a look's demo store, a gone preset, an unpublished demo store, an unpublished theme, no theme.
* `src/components/admin/design-cards.test.ts`: the one choice, Standard first, what each card starts with, no store-template field.
* `src/lib/theme-admin-paths.test.ts`: the addresses and the redirects.
* `e2e/signed-in/themes-unified.spec.ts`: the old pages land on Themes, the Demo stores card, the menus, choosing a look's demo store.
