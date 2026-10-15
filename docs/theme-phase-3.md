# The theme store: phase 3 of the theme store plan

Phase 3 of `docs/theme-store.md` (sections 6 and 9): a public place where anyone sees Kaizena Flow's themes, looks at each on a demo
store at computer and phone widths, and starts a store with one, or tries one in a store they already have. Built in steps, each pushed on
its own; this file says what each step is and, once built, what it found.

| Step | Builds | Done when |
|---|---|---|
| 1. The list and a theme's page | a theme's listing (address, kinds of store, styles; features worked out from the theme), `/themes` with filters, `/themes/{slug}` with previews, what it includes, changelog and *Start with this theme*, structured data, the sitemap | a person signed out finds a theme, previews it at both widths, and lands on sign-up with it chosen; search engines can read and index both pages |
| 2. Try it in your store | *Try it in your store* (sign in, choose a store where they may change the website, install it without making it live, open its preview of D244) and *Add a theme* under Website, Themes in the admin | an owner adds a theme from the store or the admin, and visitors see nothing until they switch |
| 3. Its own address | `themes.kaizenaflow.com` routed to the pages of step 1 by host, `themes` kept from stores' addresses, canonical addresses and the sitemap on the host | the pages answer on the host, the platform's `/themes` moves there, and nothing on a store's host changed |

## Decisions

* **The listing is not a draft.** A theme's look and its card details are drafts until Publish (D177). Its listing (address, kinds of
  store, styles) is shop-window data and takes effect when saved; it is shown only while the theme is published.
* **Features are facts.** What a theme includes (light and dark, the visitor's switch, its own header, footer or product page, its own
  fonts, its section styles, its own CSS) is worked out from its published version, never typed in, so a listing cannot claim what the
  theme does not do.
* **Free first.** Every theme is free in phase 3; paid themes are phase 5. The pages say *Free* and structured data carries no price.
* **Previews are the existing preview.** A theme's previews are its public preview (D176, inert, `noindex`) in a frame at two widths, so
  what a visitor sees is what applying places.

## Step 1: the list and a theme's page

**Listing.** `design_presets.slug` (the address, unique, of `THEME_SLUG`'s shape) and `design_presets.listing` (`{ kinds, styles }`,
read only through `readListing()`), saved by `saveThemeListing()` from the *Theme store listing* card on a theme's Details tab
(`parseListing()`, an address another theme has is refused) and refreshing `DESIGNS_TAG`. A launch theme (D246) is listed at its key with
the listing in `LAUNCH_THEMES`, kept in step by `syncLaunchThemes()`. What a theme includes is `themeFeatures()` of its published snapshot:
light and dark, the visitor's switch, its own header, footer or product page, its own fonts, section styles beyond the core six.

**The list** (`/themes`, Kaizena Flow's own site): every published, unarchived theme with an address and a readable snapshot
(`themeStoreCards()` in `src/server/theme-store.ts`, cached under `DESIGNS_TAG`), filtered by the address (`?kind=`, `?style=`,
`?feature=`; `parseThemeFilter()`, `filterThemes()`: a theme listed for no kind suits every kind), the filters plain links so every
filtered list has an address and needs no JavaScript; the unfiltered list is the prerendered fallback. A card shows the theme's picture,
else its light colours and heading font, and says *Free*.

**A theme's page** (`/themes/{slug}`, `themeStorePage()`): the summary, *Free* and the latest version, *Start with this theme*
(`/sign-up?theme={id}`, where `ThemeFromAddress` chooses that theme's card in the browser, so the sign-up page stays one page for
everyone), the preview at computer and phone widths (the public preview of D176 in frames: inert, `noindex`, cached), what it suits and
includes, its section styles, and the changelog (`themeChangelog()`: each version's *What's new* against the one before, D245). Structured
data is a free `CreativeWork` with no price (`themeJsonLd()`). Pages of published themes are prerendered; a theme published later is drawn on
its first visit.

**Search engines.** Kaizena Flow's sitemap lists `/themes` and every theme's page; `themes` is a reserved address for Kaizena's own pages.

**Built.** `src/lib/theme-store.ts`, `src/server/theme-store.ts`, `saveThemeListing()` and `markLaunchTheme()`'s listing in
`src/server/design-presets.ts`, `ThemeStoreList`, the two routes under `src/app/(platform)/themes/`, the listing card and its action,
`ThemeFromAddress`; held by `src/lib/theme-store.test.ts`, `theme-store-view.test.ts` (view), `src/server/theme-store.int.test.ts`, the
PGlite test of the address rules and `e2e/theme-store.spec.ts`.

**Not in step 1.** The list in a browser test with themes in it (the list is cached from the build, and a theme seeded before the build would
change the sign-up page every other test reads); more than one picture per theme; a link to the theme store from Kaizena Flow's own menus,
which are the platform admin's to add.

## Step 2: try it in your store

**Installing without going live.** `installDesignPreset()` (`src/server/design-presets.ts`) and `applyDesignPreset()` are one body,
`placeDesign(…, live)`: the same refusals, fonts, picture copies, page checks and new layout pages, and the install's `placed` (D245). Not
live, the look goes into the new `store_theme_installs` row's `look` and the store's columns are not touched, so visitors see nothing; no
`design_preset_uses` row is written (there is no look to put back) and the audit is `store.theme_installed`. A theme with an install counts
as used (`stores_using` counts installs too), so it cannot be deleted while a store holds it.

**From the theme store.** A theme's page links *Try it in your store* to `/themes/{slug}/try` (`themeTryLink()`), a route that knows who is signed
in (the theme's page is cached and cannot): it sends them to `/admin/account/themes/try/{slug}` (`themeTryPath()`), someone held at the
second step to finish it, and anyone else to sign in, each with `next` back to the page. It lists their stores where they hold
`website:write`, says which already have the theme (`storesWithTheme()`), and adds it with the store's own `installThemeAction`, which asks
the permission again and opens the install's page (D244) with `?added=1`: a note that visitors see nothing yet, and *Switch to it*.

**From the admin.** Design settings' theme cards offer *Add to my themes* beside *Apply* (the panel links to the theme store).

**Built.** `installDesignPreset()`, `storesWithTheme()`, `installThemeAction`, the try page, the install page's note and switch card; held by
`src/server/theme-store.int.test.ts` (not live, columns unchanged, counted as used, an outsider refused), the scan test (both go through
`placeDesign()`), `e2e/signed-in/theme-try.spec.ts` (owner adds from the theme store, a Read-only member is offered no store, signed out
goes to sign in) and the Try link in `e2e/theme-store.spec.ts`.

## Step 3: its own address

**The setting.** `NEXT_PUBLIC_THEMES_HOST` (`themes.kaizenaflow.com`), read when building as the store domain is (P7), through
`themesHost()` in `src/lib/theme-host.ts`. Without it nothing changes: the theme store stays at `/themes`. The host itself is set up outside
the code (`docs/kaizena-flow-switchover.md` 1.4).

**Routing** (`themeHostRoutes()`, in `next.config.ts` before the stores' rules): on the host, `/` serves the list, a one-part address of a
theme's shape serves that theme (`/themes/{slug}`), and `/sitemap.xml` and `/robots.txt` are the host's own (`themeStoreSitemap()`,
`themeStoreRobots()`); an address of more than one part goes to the same address on Kaizena Flow's site, and a one-part address that is no
theme (the header's `/pricing`, `/sign-up`) is sent there by the theme's page. On Kaizena Flow's own host, `/themes` and `/themes/{slug}` move
to the host for good (308); `/themes/{slug}/try` stays, as only that host sees the admin's sign-in. A store's own `/themes` is untouched.

**Never a store's host.** The host may be a name under the store domain (`themes.{domain}` when stores are under `kaizenaflow.com`):
`storeHostRoutes()` leaves its label out of the stores' host pattern, `storeOfHost()` returns no store for it, and `themes` is a reserved store
address (`stores_slug_not_reserved`, `RESERVED_STORE_SLUGS`; no store had it).

**Links.** In the theme store, `themeStorePath()` (a path on whichever host serves it), `themeStoreUrl()` (canonical addresses, the sitemap,
structured data) and `platformHref()` (sign-up, the try route and the previews, full addresses while the host is set). Kaizena Flow's own
sitemap leaves the theme store to the host's, as a sitemap lists only its own host's addresses.

**Built.** `src/lib/theme-host.ts`, the host's sitemap and robots routes, `storeHostRoutes()`'s `themesHost`, `storeOfHost()`, the reserved
address (migration `reserve_themes_slug`); held by `src/lib/store-hosts.test.ts` (routing as Next.js matches it, with the host under the store
domain and apart from it), the PGlite reserved-address test and `e2e/theme-host.spec.ts` in CI's `hosts` job, which sets the host to
`themes.localhost:3000` under the store domain `localhost:3000`.

**Not in step 3.** The header's home link on the host leads to the list, not to Kaizena Flow's front page; Open Graph pictures per theme
and more than one picture per theme are still to come.
