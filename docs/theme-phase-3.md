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
