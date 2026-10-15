# Themes and the theme store (Kaizena Flow): the plan

Status: phases 1 and 2 built (D241 to D246, 15 October 2026); phase 3 (the theme store) built in three steps (D247 to D250, `docs/theme-phase-3.md`); phase 4 (Kaizena Flow's own site on themes) built in three steps (D251 to D253, `docs/theme-phase-4.md`). The decision number is given when phase 1 is built (the waves in flight may take the next
numbers). This document is the contract for the work; each phase ends with its own section in `docs/decisions.md`.

## 0. Decisions already made by the owner (15 October 2026)

1. **Themes are declarative data, never code.** A theme is settings, layouts, sections and CSS that Kaizena Flow's own components draw; no
   theme ships a template language, server code or its own JavaScript.
2. **Switching theme is seamless.** It never changes, overrides or loses the owner's words, pictures, videos, links, products, menus, logo or
   business details (section 4).
3. **Order of work.** Kaizena-made free themes first, then the theme store that promotes them, and only when both work, third-party theme
   developers and paid themes (phase 5).
4. **The platform is renamed Kaizena Flow** (`kaizenaflow.com`); the theme store lives at `themes.kaizenaflow.com`.
5. The defaults proposed on 15 October are accepted, as written into the sections below:
   * the rename covers the whole product (name, domains, sender address, legal texts), with old addresses redirecting;
   * every store's current look becomes its own "Custom" theme on day one;
   * three to five launch themes are made from today's design profiles and store templates;
   * store templates (a kind of business, with content) and themes (a look) stay two things;
   * free themes update by themselves, and an update changes only the look, never the owner's settings for it;
   * Kaizena Flow's own site uses themes too, later;
   * the theme store is public and indexed, with *Start with this theme* leading into sign-up;
   * every theme, Kaizena's own included, passes the automatic checks third-party themes will face.

## 1. How Shopify does it (read 15 October 2026)

* **A theme is a folder of code** ([architecture](https://shopify.dev/docs/storefronts/themes/architecture)): `layout/theme.liquid` (the
  wrapper, the only required file), `templates/` (one per page type; JSON templates "act only as a wrapper for sections", Liquid templates
  "contain code"), `sections/` (reusable modules merchants add to templates and to section groups such as the header and footer),
  `blocks/` (modules inside sections, added, removed and reordered), `snippets/` (code merchants never see), `assets/` (CSS, JavaScript,
  images), `config/settings_schema.json` (the theme's own settings) with `settings_data.json` (the merchant's values), and `locales/`.
* **Developers** work with the Shopify CLI: `shopify theme dev` previews the theme against a development store with hot reload, themes are
  pushed and pulled, and Theme Check lints them ([CLI](https://shopify.dev/docs/storefronts/themes/tools/cli)). Development themes are
  hidden and deleted after seven days of inactivity; an unpublished theme gives a lasting preview.
* **The Theme Store** ([store](https://shopify.dev/docs/storefronts/themes/store)): partners meet technical, performance, design and
  experience requirements, submit for review, write a listing, then support and update the theme; "Themes sold through the Shopify Theme
  Store are subject to a 15% revenue share."
* **Merchants** keep a library of themes: one live, others installed, each previewed and customised before it is published. A section's
  customisation belongs to the theme it was made in.

Kaizena Flow differs on purpose: every page is drawn by our own React components from stored rows (the builder's canvas draws exactly what
the site draws), so a theme cannot be code without a second renderer the builder could not edit, and without losing what that one path
guarantees: the pay routes' content security policy (D158), scripts only after consent (D58), the accessibility checker (`pageIssues()`),
the performance budget (D211) and the claims filter.

## 2. What exists today

| Piece | What it is | What the theme work takes from it |
|---|---|---|
| Theme settings (D60, D182, D183, D206) | `stores.theme` (`parseStoreTheme()`): palette in light and dark, fonts, buttons, corners, widths, screen sizes, **elements** (row, h1 to h6, p, list, button), the saved colours and gradients, hover timing | The global look of a theme, unchanged in shape |
| Theme elements laid under parts (D182) | `themedRows()`, `layerUnder()`: a part's own setting wins at the sizes it sets it; what it leaves unset comes from the theme when drawn, never saved into the page | **The mechanism of seamless switching** (section 4) |
| Layout pages (D79, D80, D112, D113, D140) | the header, footer, product layouts, and the pages chosen for page roles (cart, checkout, order, account, category, tag, search, blog, 404 …) | A theme's layouts |
| Design profiles (D176, D177) | a versioned snapshot of a look (theme, header, footer, product layout, CSS) with its own workspace store, publish, archive, a public preview on a store template, `applyDesignPreset()` with *Put back the look from before* | **The nearest thing to a theme today**: its workspace, snapshot, cleaning (`snapshotLayout()`, `sanitizeTemplate()`), media copying, preview and restore are reused |
| Store templates (D175, D177) | demo stores with content (`stores.starter`), frozen copies on publish | A theme's demo store |
| Templates marketplace (D125, D127) | saved parts and whole page layouts shared between stores, moderated, previewed before use | A theme's section library |
| Kaizen's own builder (D235, D236) | the platform's pages use the same builder, theme and templates | Kaizena Flow's own site can use themes later |

What is missing: a theme as **one** thing (today three ideas: profiles, templates, page layouts), **several themes installed in a store**
(today a store has one look and applying a profile overwrites it), **section styles** that follow the theme, and the theme store site.

## 3. What a theme is

A **theme** (`commerce.themes`, the platform's, no `store_id`) has versions (`commerce.theme_versions`, never edited once published). A
version is a validated, versioned **package** (`themePackageSchema`, `v: 1`; JSON, at most a few MB, pictures by address in the theme's own
library):

| Part | Holds | Notes |
|---|---|---|
| `settings` | a `ThemeSettings` (D60) | the same shape every store has, so the editor and the site need nothing new |
| `presets` | 1 to 4 named variations of `settings` ("Light", "Bold", …) | Shopify's "styles"; the owner picks one when installing |
| `layouts` | header, footer, the standard product layout, the category and tag pages, and the working pages (cart, checkout pieces, order, account, sign-in, search, 404) | rows of components, cleaned as `snapshotLayout()` cleans today; menus by role, never by id |
| `sectionStyles` | named looks for rows and their components ("Hero", "Feature grid", "Testimonials", "Plain") | section 4.3; the key to restyling content pages |
| `sections` | rows and page layouts offered in the builder while the theme is live | D125's saved parts and D127's page layouts, scoped to the theme |
| `css` | the theme's stylesheet | checked by `cssProblem()`, drawn only through `<CustomCss>`; never a script, never `@import` of another origin |
| `fonts` | Google Fonts families | installed on install (D59), always self-hosted |
| `demo` | the store template it is shown on | content for previews only, never copied into a live store (4.5) |
| `listing` | name, summary, description, pictures, features, the kinds of store it suits | for the theme store (section 6) |

**Never in a theme**: brand and content (`BRAND_FIELDS` today: the name, logos, icon, business details, menus' links, pages, products,
categories, prices, tracking, custom code, languages), a form's recipients, another store's file, an id of a store's own thing, a script,
an iframe address the site does not allow, a price or a claim (`findClaims()` on every word a theme brings, as for AI copy).

## 4. Switching without breaking anything

### 4.1 Who owns what

| | Owned by | On a switch |
|---|---|---|
| Words, pictures, videos, links, products, prices, menus and their links, the logo, business details, legal pages | the owner | never touched |
| Content pages' rows, columns and components (what they are and what they say) | the owner | never touched |
| Global look: palette, fonts, buttons, spacing, text styles (elements), hover and motion defaults, screen sizes | the theme | follows the new theme |
| Header, footer, product, category, cart, checkout and other working-page layouts | the theme, filled with the owner's own logo, menus and details by role | follows the new theme |
| A part's style setting the owner set on purpose (a red button, a row with a background picture) | the owner | kept |
| A part's style left unset, or set to a section style | the theme | follows the new theme |
| The owner's own header, footer or layout pages they built themselves | the owner | kept in the library, choosable again |

### 4.2 Inheritance as the rule

The site already lays the theme's elements under every part where the part sets nothing (D182). The theme work makes that the general rule:
**everything a part does not set comes from the live theme**, for every kind of setting a theme element or section style can hold
(`layerUnder()` grows with them; a new setting a theme can hold goes there, as CLAUDE.md already says). Saving a page never writes the
theme's values into it.

### 4.3 Section styles

A row (and each component kind) may name a **section style** (`PartBase.style`: a name, never CSS). The live theme's `sectionStyles` gives
that name its settings, laid under the part as theme elements are. A theme that has no style of that name gives its `Plain` one, so a
switch never leaves a part unstyled. Themes define the same core names (a fixed list, `CORE_SECTION_STYLES`, so switching between Kaizena's
themes always lands), and may add their own. The builder offers the live theme's styles as a choice on rows and components, with "Custom"
for the owner's own settings.

### 4.4 The one-time migration for today's pages

Stores' pages carry many style settings written in directly (copied from the theme at the time, or chosen by the builder's defaults). A
migration step, run when a store's look becomes its "Custom" theme (phase 1), compares each part's settings with what the theme would give
it: a setting **equal to what the theme gives** is taken out (so it follows the theme from then on), anything **different** is the owner's
and stays. It is pure (`detachThemeValues()`), dry-run first, per store, reported ("142 settings now follow the theme, 9 are your own"),
undoable (the page's previous content kept, as page history), and never changes how any page looks on the day it runs
(`e2e/responsive-parity.spec.ts`-style screenshot test before and after on the demo stores).

### 4.5 Try, preview, publish, undo

* **Install** a theme into the store's theme library (several installed, one live). Installing copies the theme's fonts and pictures into
  the store (as `applyDesignPreset()` does) and makes no change to what visitors see.
* **Customise** an installed theme that is not live: its settings, preset and layouts are edited in the builder against the store's own
  pages and products.
* **Preview** it on the store's own site: a preview link (`?theme={install}` with a signed token, owner and staff with `website:read`)
  served the way the A/B tests serve a version's header, footer and layouts to one visitor (`siteLayoutForVisitor()`,
  `productLayoutForVisitor()`, D148 phase 3), never indexed, never cached for others.
* **What changes** before publishing: a short summary written in code from facts: the layouts that change, the section styles each page
  uses and whether the new theme has them, the parts that keep the owner's own settings, fonts added.
* **Publish**: one transaction makes the install live; the previous theme stays installed, so *Go back to {theme}* is one press (today's
  restore, generalised).
* **The theme's demo pages** are never put into a live store; *Add this theme's pages as drafts* copies them as unpublished drafts
  (D126's duplication path) for an owner who wants them.

### 4.6 Updates

A theme version is immutable. An installed theme records the version it came from and the owner's own changes to it separately (the
settings they changed, the layouts they edited: Shopify's `settings_data.json`). A new version of a free Kaizena theme is applied by itself
to installs that follow updates (the default): the theme's parts change, the owner's changes are laid over them again, and a layout the
owner edited is kept as theirs (offered the new version beside it). A *What's new* note says what changed. Nothing in an update may remove a
core section style.

## 5. Data and rendering (phase 1)

* `commerce.themes` (id, slug, title, made_by `kaizena` | partner later, status draft/published/archived, workspace store, current
  version), `commerce.theme_versions` (theme, number, package, notes, published_at; append-only), `commerce.store_themes_installed` (store,
  theme or null for "Custom", version, preset, owner_settings, layouts chosen, follows_updates, installed_at, live boolean with one live per
  store by a unique index). `commerce.store_themes` (D60's saved themes) is renamed in meaning only if needed; the new table must not
  collide with it (name to settle in phase 1).
* **One reader of a store's look**, `liveLook(store)` (cached under the store's tag), gives the theme settings, the chosen layouts and the
  section styles; `getStore()`'s `theme`, `siteLayoutFor()`, `productLayoutFor()` and `pageForRole()` read through it. A scan test lists the
  readers of `stores.theme`, `header_id`, `footer_id` and `product_layout_id`, which become "Custom"'s storage and are written only by the
  install code.
* `COPY_RULES`: installs are `settings` (a copied store keeps its themes); `clone_store()` installs the store template's theme.
* Design profiles become themes (each published profile a Kaizena theme with one version; `design_preset_uses` kept as history), and
  `applyDesignPreset()` becomes *install and publish*. Store templates keep their content and name a theme instead of a recommended profile.

## 6. The theme store (phase 3)

* **Address**: `themes.kaizenaflow.com`, its own root layout in the app, routed by host in `next.config.ts`/`src/proxy.ts` as stores'
  own hosts are (P7), with the platform's look and its own pages built in Kaizena Flow's builder.
* **Pages**: the list (filters: kind of store, style, features; free first), a theme's page (pictures, presets, features, demo store,
  what it includes, changelog), *Preview* (the theme's demo store in a frame at computer and phone widths, `noindex`, inert as D127's
  preview), *Try it in your store* (signs in, picks a store with `website:write`, installs without publishing, opens the preview of 4.5),
  *Start with this theme* (sign-up with the theme chosen, `access_requests` naming it).
* **Search engines**: indexed, with a sitemap, structured data per theme (`CreativeWork`, no price while free), and Open Graph pictures.
* **In the admin**: owners find the same list under Website, Themes (the library of installed themes and *Add a theme*).

## 7. The checks every theme passes (`themeCheck()`)

Run on every version before it can be published (Kaizena's own too) and shown to whoever publishes:

1. the package parses (`themePackageSchema`), every layout passes `pageInput` and `pageRulesProblem()`, CSS passes `cssProblem()`;
2. accessibility: `pageIssues()` on every layout and on the demo store's pages, in light and dark, at every screen size; no blocking issue;
3. contrast of the palette and of every section style (`contrastRatio()` after `blend()`), as the admin schemes are held (`CONTRAST_RULES`);
4. the core section styles are all there; every working-page layout has its shop components (`STORE_PARTS`) and the checkout's payment and
   terms parts (`displayLocked()`);
5. pay routes: nothing a theme brings is in `FORBIDDEN_ON_PAY_ROUTES`, no embed or HTML component on checkout pages;
6. words: `findClaims()` on every text; no link off the site except the store's own (rewritten by role);
7. performance: the demo store's front, product and category pages under the D211 budget (`e2e/performance.spec.ts` style, in CI for
   Kaizena's themes);
8. phone: the responsive parity screenshots of the demo store at Small and Extra large.

## 8. The rename to Kaizena Flow (phase 0)

* **What changes**: every word a person reads (the admin, emails, the platform's pages, legal texts, store footers' "made with", the AI
  manager's and chat's own name where they name the platform), the email sender domain, the platform's domain, Open Graph and structured
  data, favicons and logos, docs titles.
* **What does not**: code identifiers (`Kaizen` in names, tables, comments: 783 source files mention it, mostly internally; renaming them
  is churn with no reader), cookie names (`kaizen_*`: renaming signs people out and breaks consent records; the cookie list says they are
  Kaizena Flow's), database names, the Supabase project.
* **Addresses**: `kaizenaflow.com` becomes the platform's address and stores' subdomains move to `{store}.kaizenaflow.com`
  (`NEXT_PUBLIC_STORE_DOMAIN`); the old domain redirects 308 path for path; stores' own domains (P8) are untouched; Stripe, OAuth
  (Kaizen Life, D95), the WordPress plugin's connection (D169) and email sender settings are moved with their callbacks, each checked
  before the old one is turned off.
* **Legal**: the company name and imprint, terms and privacy texts need a person's review (they are never changed by code alone).
* A test fails for user-facing text that still says "Kaizen" where the brand is meant (a scan of messages, email texts and the platform's
  pages, with an allow-list for "Kaizen Life", which keeps its name).

## 9. Phases

| Phase | Builds | Done when |
|---|---|---|
| **0. Rename** | section 8; a placeholder page at `themes.kaizenaflow.com` | the scan test passes, old addresses redirect, email and OAuth work on the new domain, legal texts reviewed |
| **1. Themes as one thing** (built, D241, `docs/theme-phase-1.md`: themes are `design_presets`, installs and versions as there; the migration a dry run) | section 5; design profiles become themes; every store gets its "Custom" install; `liveLook()`; the migration of 4.4 in dry run | every store looks exactly as before (screenshot parity on the demo stores and a sample of production stores), the scan of look readers passes |
| **2. Seamless switching** | section styles (4.3), inheritance for every themable setting (4.2), the migration run per store (4.4), the theme library in the admin, try, preview, publish and go back (4.5), updates (4.6); 3 to 5 Kaizena themes built and passing `themeCheck()` | an owner switches between all launch themes on a real store and back with no word, picture, video, link or menu changed (an e2e that compares every content field before and after), and the look follows |
| **3. The theme store** | section 6 | the list, a theme's page, preview, try in your store and start with this theme work signed out and signed in, indexed |
| **4. Kaizena Flow's own site on themes** | the platform's pages read `liveLook(null)` | the platform's site switches theme as a store does |
| **5. Third parties and paid themes (later)** | partner accounts, submission and review (platform admins, `themeCheck()` plus a person), listings, prices, licences per store, checkout on Kaizena Flow's Stripe account, payouts through Connect with a revenue share, updates and support, reviews; a file format and CLI (`validate`, `preview` against a development store, `push`, `package`) for developers who work in files | decided again before it starts |

Each phase is built as the parity waves are: a spec section, foundation, server, screens, the gates, an adversarial review, fixes with a
test each, then the decision row.

## 10. Risks and open points

* **The migration (4.4)** is the riskiest step: it rewrites many pages. It runs per store, dry run first, with screenshots, and is undoable.
* **Owner CSS** written against today's classes may break when layouts change: the *What changes* summary warns when the store has its own
  CSS, and themes keep the stable `kz-{id}` part classes and documented class names.
* **Components a theme cannot express**: if a launch theme needs a component Kaizena Flow does not have, it is built as a component for
  everyone (with its builder fields), never as theme code.
* **Performance**: a theme's CSS adds to every page; a size limit per theme (as the page CSS's 50 KB) and the D211 budget hold it.
* **Naming**: the existing `commerce.store_themes` (saved themes, D60) and "design presets" in code must not be confused with the new
  themes; phase 1 settles the names and the interface words ("Themes", "Theme library", "Saved theme settings").

## 11. Not part of this plan

Theme-specific JavaScript, a template language, per-theme custom setting schemas (a theme uses `ThemeSettings`; a new kind of setting is
added for everyone), and theme marketplaces outside Kaizena Flow.
