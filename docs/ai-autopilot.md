# The AI manager's autopilot (decisions D308 to D311)

The contract for turning the AI manager (D94, D103 to D106) from an assistant that answers into a manager that works. Written on 2026-10-22
from the owner's goal, a read of the manager's code at commit `144ce5c` and the parity rows of the AI domain. Code, tests and texts follow
this file; a unit that must change course says so here first.

**The goal (the owner's words).** An AI manager that listens to a store owner's goals and vision, crafts a plan to bring it about, plans and
builds the store, works on the owner's behalf on its own, loops the owner in only for critical decisions, and reports progress, concerns and
challenges from time to time. The same for Kaizena Flow's own site, with the platform admin as the owner.

**What exists (read in the code).**

- The turn loop: `runTurn()` (`src/server/owner-assistant.ts`) streams from the store's AI connection with tools, up to ten rounds a
  turn, 300 turns a store a day; it already runs headless for Kaizen Life (`src/server/store-mcp.ts`), so a turn needs no browser.
- 103 store tools (`OWNER_TOOLS`), 17 platform tools, 9 manager tools, 41 playbooks (`ASSISTANT_SKILLS`) and memory per account (D103).
  The tools read, analyse and run operations; **none builds**: no tool creates or edits a product, saves or publishes a page, edits a
  menu, sets up shipping or applies a theme. The only page and product writes are `archive_product` and `unpublish_page`.
- Approvals: a tool with a gate (`send`, `public`, `spend`) is only kept (`assistant_approvals`) and runs on the person's yes
  (`decideApproval()`, `decide_approval` with `saysYes()` on the person's own message).
- Builders that run without a browser: `saveProduct()` (with `writeProduct()` in the content packs as the template), `savePage()`, the page
  studio's `planPage()`/`buildDraft()`/`fillPicture()`, `applyDesignPreset()`/`installDesignPreset()`, `saveStoreMenu()`,
  `saveNavigation()`, `saveShippingMethod()`, `saveShippingSettings()`, `saveStoreDetails()`, `setMarkets()`, `saveLanguages()`,
  `createLegalStarter()`, `setPageRole()`, `getSetupProgress()`.
- Jobs: the five-minute dispatcher, the every-minute marketing route and the pack-pictures route (300 s, work in `after()`, in the
  asker's name), scheduled by `pg_cron`; claims with an expiry as the data jobs do (`claimJob()`).
- Cost: every call metered (`metered()`, `ai_usage`, by feature); only recommendations have a monthly cap.
- Seeing: `seeing(connection)` gives a model that sees pictures; Chromium screenshots through `looking()` (one browser per look). Store page
  previews need a signed-in session; only the replicator's frame opens with a token.

**What is missing.** Hands (building tools), a will of its own (goals, a plan and a loop that runs without a person in the chat), a sense of
proportion (autonomy levels and budgets the owner sets), a voice (a decisions page and reports) and eyes (looking at what it built).

## 1. The units, in the order they are built

| Unit | Decision | What | Rows it moves |
|---|---|---|---|
| A1 | D308 | Catalogue tools: create and edit products (texts, variants, prices, pictures, categories and tags), as drafts or live | `ai.admin-ai-assistant-that-performs-tasks` |
| A2 | D308 | Website tools: build a page from a brief (the page studio, headless), change a page's words and rows, publish, choose a page's place, menus and the header and footer; on stores and on Kaizena Flow's own site | `ai.ai-page-and-theme-generation`, `ai.admin-ai-assistant-that-performs-tasks` |
| A3 | D308 | Setup tools: the store's details, countries, languages and currencies, flat rate and shipping methods, opening the store; the setup wizard's steps as tools | `ai.admin-ai-assistant-that-performs-tasks` |
| A4 | D308 | Design tools: list themes and presets, add one to the store's library, try it, make it live (a premium theme is a `spend`) | `ai.ai-page-and-theme-generation` |
| H | D302 | Product feeds (wave 5 unit H, outlined in `docs/wave-5-marketing.md` 10), woven in here: the agent uses them too | wave 5's rows |
| B1 | D309 | Goals and plans as data; the audit log says when the AI acted | `ai.assistant-memory-and-saved-skills` |
| B2 | D309 | The work loop: steps run in the background, checked in code, within the owner's autonomy levels and budgets | `ai.workflow-builder-with-ai-generation`, `ai.admin-ai-assistant-that-performs-tasks` |
| B3 | D309 | Decisions and reports: one page of what waits on the owner, a digest by email, a weekly report | `ai.proactive-insights` |
| L | D311 | Legal pages by AI: researched from fetched sources, checked in code, kept current | `international.legal-page-templates-and-policy-generator` |
| C | D310 | Eyes: the agent photographs its drafts and judges them with the model that sees pictures | `ai.ai-page-and-theme-generation` |
| D | D328 | The autopilot keeps going: it looks at each active goal again when a plan for it ends and on a schedule, makes the next plan, and starts it itself where the owner allows | `ai.workflow-builder-with-ai-generation`, `ai.proactive-insights` |
| E | D329 | Web research: search the web through a pluggable search service (Brave first) on Kaizena Flow's key, metered; read a public page; keep findings with their sources; compare options with scores worked out in code | `ai.admin-ai-assistant-that-performs-tasks` |
| F | D330 | Brand and look: a brand profile (tagline, voice, audience, values, words to avoid), a look of the store's own designed from a few brand colours and fonts (palette and contrast worked out in code, added to the theme library to try and make live), a logo and icon drawn by code from the brand's name in its font, and the brand given to the writers as guidance with its words to avoid found by code | `ai.ai-page-and-theme-generation` |
| G | D331 | Reacting to events: a customer waiting for a person, an A/B test that ended by itself and an urgent analytics alert each bring a turn of the autopilot at once, within the owner's levels and budgets | `ai.proactive-insights`, `ai.workflow-builder-with-ai-generation` |

Each unit is its own commit (or a few), with its own tests, decision row and parity moves, shipped before the next starts. Each unit's
section below is written in full before it is built; L is outlined and gets its detail when its turn comes.

## 2. Rules for every unit

1. **One way to write.** A tool calls the same function a screen calls, with the same validation (`productInput`, `pageInput`,
   `menuInput`, `methodInput`, …). No tool writes SQL of its own and no new writer of a table appears for the AI.
2. **Drafts are free, the public is gated.** Anything only staff see (a draft product, a draft page, a theme added but not live) is
   ungated. Anything shoppers or customers see or receive (publishing, making a product active, changing a live menu, prices on live
   products, emails, a theme going live) carries a gate (`public` or `send`), and anything that costs money a `spend`. Until B2 a gated call
   waits for the person's yes as today; from B2 the owner's autonomy level decides.
3. **Facts from tools, figures from code, words through the filters.** The model never states a price, a stock level or a figure it was not
   given; amounts are written by `formatMoney()`; public words pass `findClaims()`; legal words pass unit L's checks.
4. **Store-scoped and permitted.** Every tool takes the store from the principal, has a `TOOL_PERMISSIONS` entry (`products:write`,
   `website:write`, `settings:write`, …), a `TOOL_FEATURES` entry where a feature stands behind it, and works only on an open store.
   Kaizena Flow's own site uses the same tools with the platform principal (`store: null`), where a tool makes sense there.
5. **Refreshed and audited.** A tool refreshes the tags the screen refreshes (`catalogTag`, `pagesTag`, `designTags`, …) and is audited
   as the screen's action is; from B1 the entry also says the AI did it.
6. **Metered.** Every model call names its feature in `AI_FEATURES` (`ai_builder`, `autopilot`, `ai_eyes`, `legal_writer`).
7. **Homer and Lisa.** The owner talks to the manager; the screens stay the place to see and change everything it did.

## 3. Unit A1 (D308): catalogue tools

| Tool | What | Gate |
|---|---|---|
| `create_product` | A new product from the model's arguments: kind (goods only in A1), titles and descriptions per language, options and variants (SKU, price per market as text in the market's currency, stock, weight, delivery), categories and tags by slug (new ones made), pictures by URL from the media library or made by the picture model (D283's `makeSitePicture()`), status `draft` | none |
| `update_product` | A change to an existing product, given as the fields to change; read with `getProductForEdit()`, merged, saved whole | none while draft; `public` when the product is active and the change touches what shoppers see |
| `set_product_status` | Draft to active (checked by `productProblems()`: a price, a manufacturer, an EU responsible person) or back | `public` |
| `set_prices` | Prices of variants per market, through `saveProduct()` (so `commerce.set_price` and its history) | `public` on an active product |
| `write_product_texts` | Descriptions, SEO title and description and excerpt for products, from the product's own facts (D76's writer, now as a tool) | as `update_product` |

The tool input is a zod schema of its own (shorter than `productInput`, with defaults the screen would choose: the store's main market and
language, the standard VAT category, `txcd_99999999`), turned into a `ProductInput` by a pure `toProductInput()` (unit-tested) and saved by
`saveProduct()` with the owner's `actor`. A price is text in the market's currency read by the screen's own parser. The answer names the
admin page of the product. Tests: integration tests make, change, activate and price a product through the tools and read it back through
the product screen's reader; a product with problems is refused with the screen's words; another store's product is never found.

### 3.1 As built (2026-10-22)

- **Where.** Arguments and the pure conversion are `src/lib/product-tools.ts` (`createProductInput`, `updateProductInput`, `setPricesInput`,
  `setProductStatusInput`, `writeProductTextsInput`; `toProductInput()`, `mergeProduct()`, `pricesAsChange()`, `textJobs()`,
  `productApprovalSummary()`), the handlers `src/server/product-tools.ts`, registered in `OWNER_TOOLS`, `HANDLERS`, `TOOL_PERMISSIONS`
  (`products:write`), `TOOL_FEATURES` (`shop`) and `TOOL_WORDS`. They are owner tools, so the store's MCP server serves them too.
- **One save.** Every product is built on the editor's own blank product (`emptyProduct()`) or its own read (`getProductForEdit()`) and saved
  by `saveProduct()` with the person as `actor`: the editor's checks in its words, prices through `commerce.set_price`, the activity log. A
  change lays only the fields given over what is there (variants by SKU; a new SKU adds one, `active: false` switches one off, none is
  deleted); lists given (options, categories, tags, pictures) replace, `add_pictures` adds.
- **Stock.** An existing variant's stock is never written from these tools: `set_stock` keeps its history. A save passes the stock it read
  (`StockMode.loaded`), so a sale paid in between stays paid, and a new variant's opening stock is a movement whose source is `ai_manager`
  and whose actor is the person (`StockMode.source` now takes `ai_manager`).
- **The gate.** `create_product` and `write_product_texts` have none: a new product is always a draft, and texts are saved only on a
  product shoppers do not see (on a live one they are given back for `update_product`). `update_product` and `set_prices` are declared
  `public` but gated only while the product is live (`GATED_WHEN_LIVE`, `gateNeeded()` in `src/server/owner-tools.ts`, asked by the
  assistant's `callTool()` and the MCP server): a draft is changed at once. `set_product_status` is always gated. Every gated call is
  checked first by `preflightProductTool()` (the merge and `productProblems()` without making anything), and described from the product's
  own title and the store's currencies (`productApprovalWords()`). An archived product is refused (saving would bring it back as a draft):
  `archive_product` puts it back on the owner's yes.
- **Nothing made for nothing.** `create_product` checks everything it can first (prices, languages, countries, companies, library
  pictures, the editor's draft rules, claims) and only then makes new categories and tags (`createTerm()`) and pictures. A free address is
  found by appending `-2`, `-3`… A country or language the store does not offer (D178) is refused with the store's own list.
- **Pictures.** By address from the store's own media library (`libraryFilesByUrl()`), or `make`: D283's `makeSitePicture()` in the site's
  look (feature `page_pictures`, at most `MADE_PICTURES_MAX` = 3 a call). `MadeSitePicture` now carries the small copy's address.
- **Texts.** `write_product_texts` is D76's writer (`suggestProductText()`, feature `product_writer`) given the product's own words, options
  and term names (`factsOf()`, never a price or stock): the main language's description (written when empty, rewritten with `rewrite`),
  its search texts, and each other language translated from the main one. A field the claims filter finds is left out and named. No new
  AI feature was needed: `ai_builder` stays for a later unit's own kind of call.
- **Words in answers.** Amounts are `formatMoney()`'s; the answer names what changed, the countries the product is not priced in (not sold
  there), and for a draft what publishing still needs, in the editor's words.
- **Audit.** `store.assistant.create_product`, `…update_product`, `…set_prices`, `…set_product_status` and `…write_product_texts`, area
  `products`, besides the editor's own product entries.
- **`get_product`** now also gives the languages with words, options, categories, tags, pictures and the VAT category, so a change can name
  what is there.
- **Tests.** `src/lib/product-tools.test.ts` (the conversion, the merge, prices, text jobs, summaries) and
  `src/server/product-tools.int.test.ts` (made, changed, priced, published and taken off through `runOwnerTool()`, read back by
  `getProductForEdit()`; refusals before anything is made; the gate on a live product; another store's product never found; texts saved on
  a draft and only given on a live product).
- **Not in A1.** Appointments, stays, rentals, downloads and gift cards are made in the editor (they need staff, files or amounts); bulk
  changes across many products wait for unit B's background work.

## 4. Unit A2 (D308): website tools

| Tool | What | Gate |
|---|---|---|
| `build_page` | A page from a brief (title, purpose, audience, key points, facts, sections, call to action, tone, pictures yes or no): the page studio's `planPage()` then `buildDraft()` headless, pictures made one at a time after (`fillPicture()`); saved as a draft | none |
| `edit_page` | A change to a page's words or rows: replace a text (by `mapTexts()`'s keys, as find and replace does), add a row from the page studio's patterns, remove a row, move a row; checked by `pageInput`, saved as a draft (a page version is kept, D305) | none |
| `publish_page` | Publishes a draft (the accessibility checker's blocking issues refuse it unless the owner's level allows acknowledging them) | `public` |
| `set_page_place` | Front page, All products page, or a role (blog, search, 404, a working page, a legal role) | `public` |
| `save_menu` | A menu's items (pages, products, categories, tags, the site's links, an address) by `saveStoreMenu()` | `public` when the menu is in use |
| `set_header_footer` | Which menus the standard header and footer show, the logo from the media library (`saveNavigation()`) | `public` |

On Kaizena Flow's own site the same tools work with the platform principal (Kaizen's pages, `PageOwner` null), so the platform admin can say
"build a landing page for photographers" in the platform's manager. Tests: a page built from a brief is a valid draft with the brief's facts and
no claims; an edit keeps the rest of the page; publishing with a blocking issue is refused; a menu link to another store is refused.

### 4.1 As built (2026-10-22)

- **Where.** Arguments and the pure parts are `src/lib/site-tools.ts` (`getPageInput`, `buildPageInput`, `editPageInput`, `publishPageInput`,
  `setPagePlaceInput`, `saveMenuInput`, `setHeaderFooterInput`, Kaizena Flow's `setPlatformPlaceInput` and `savePlatformMenuInput`;
  `pageOutline()`, `applyPageEdits()`, `dryRunEdits()`, `sharedTextKeys()`, `briefOf()`, `toMenuEntries()`, `otherStoreAddress()` and the
  approval words), the handlers `src/server/site-tools.ts`. The page tools are `SITE_TOOLS` in `src/lib/owner-tools.ts`, served to a store
  (`OWNER_TOOLS`, so the store's MCP server too) and to Kaizena Flow's own site (`PLATFORM_TOOLS`, with the platform's `list_pages`,
  `set_page_place` and `save_menu`, whose links are its own). Permissions: `website:read` to read, `website:write` to change; a legal page's
  place is the owner's. Besides the spec's six tools there are three reads: `get_page`, `list_page_builds` and `get_menus`.
- **Building after the answer.** Planning a page and writing its sections can take longer than one turn may (300 s), so `build_page` only
  checks (a text model, no claim in the brief, at most three builds waiting) and keeps a job in `commerce.page_ai_jobs` (kind `build`);
  `runPageJobs()` runs it after the answer (`after()`) and from the every-minute job (`/api/cron/page-jobs`, scheduled by the migration), in
  the name of who asked, who must still be able to change the site (`passMembership()` and `website:write`, or a platform admin). The build
  is the page studio's own (`planPage()` then `buildDraft()`), saved as a new draft by `savePage()`; each picture is a job of its own
  (kind `picture`), placed by the studio's `fillPicture()`, which now says when trying again would not help (`gone`, `final`). Three tries,
  then `failed` with the reason; a store's jobs wait while it is not open (`commerce.store_is_active()`), and a demo store's pages are built
  from Pages, Create with AI. Done jobs go after 30 days (`prunePageJobs()`, the daily job). `list_page_builds` says how far each is.
- **Changing a page.** `edit_page` makes its changes in order on the page's draft (`set_text` by `mapTexts()`'s key, a rich text from
  paragraphs and lists, links only to the site's own addresses; `replace`; `add_section` in one of the studio's designs; `remove_row`;
  `move_row`) and saves them together with `savePage()`, so `pageInput` checks them and a version is kept (D305). Everything is tried on the
  page first (`dryRunEdits()`) so a key that is not there or a claim refuses the call before the model writes a section. A section is
  written by the studio's writer (`sectionForPage()`) in a plan of the page's rows around it, named by their headings; an opening goes only
  first; at most three sections a call. Texts in a part shared with other pages (a global part) are left to the builder (`sharedTextKeys()`),
  since a page's save puts a global's words back. A live page is unchanged until it is published.
- **Publishing.** `publish_page` (gated `public`, checked first) is refused while the page has a blocking accessibility issue (until unit B
  the AI manager never acknowledges one: the owner can publish past it in the builder) or is in a running A/B test.
- **Places, menus, the header and footer.** `set_page_place` goes through `setFrontPage()`, `setProductsPage()` and `setPageRole()` (Kaizena
  Flow's front page, blog and 404 page through `setPlatformPageRole()`); `save_menu` through `saveStoreMenu()` or `savePlatformMenu()`, the
  menu replaced whole, an item's mega menu and picture kept where its link stays; `set_header_footer` through `saveNavigation()` or
  `savePlatformNavigation()` (its business details passed back as they are), anything left out kept, a logo only from the site's own media
  library. A store's menu link into another store (its `/s/` address, its host on the store domain, or a domain of its own) is refused.
  `save_menu` waits for a yes only while the menu is shown (the standard header or footer, or a published page; `menuGateNeeded()`), so a
  new menu is made at once.
- **Gates on the platform.** The platform's AI manager used to keep every gated call for a yes; now `platformGateNeeded()` and
  `preflightPlatformTool()` (`src/server/manager-tools.ts`) do for Kaizena Flow's site what `gateNeeded()` and `preflightOwnerTool()` do for
  a store.
- **Audit.** `store.assistant.{tool}` and `platform.assistant.{tool}`, area `website`, besides the savers' own entries (`page_ai_built`,
  `page_saved`, `menu_updated`, `navigation_updated`, …).
- **Tests.** `src/lib/site-tools.test.ts` (outline, edits, shared texts, menus, other stores, words) and `src/server/site-tools.int.test.ts`
  (a page built from a brief by the real studio with the model played by code: a valid draft with the brief's facts and no claims, its
  picture placed after; an edit keeps the rest of the page and keeps a version; a section added between rows; publishing with a blocking
  issue refused, then allowed once fixed; another store's page never found; a menu link into another store refused; a new menu at once and
  a shown one waiting; places; a legal page the owner's; the same on Kaizena Flow's own site, for an admin only).

## 5. Unit A3 (D308): setup tools

`set_store_details` (`saveStoreDetails()`), `set_countries` (`setMarkets()`), `set_languages` and `set_currencies` (D109's savers),
`set_flat_shipping` (`saveShippingSettings()`), `save_shipping_method` (`saveShippingMethod()`), `setup_status` (`getSetupProgress()` and
`setupStepsFor()` in words: what is done, what is next, what only the owner can do) and `open_store` (`completeSetup()`, gated `public`).
What only a person can do is said, never attempted: Stripe's or Mollie's onboarding (identity and bank, the owner's own), a carrier's
agreement, a domain's DNS records; the tool answers with the page and the one thing to do there. Tests: a store set up by the tools reaches
`readyToOpen` as the wizard's does.

### 5.1 As built (2026-10-22)

- **Where.** Arguments and the pure parts are `src/lib/setup-tools.ts` (`setStoreDetailsInput`, `setCountriesInput`, `setLanguagesInput`,
  `setCurrenciesInput`, `setFlatShippingInput`, `saveShippingMethodInput`; `detailsOver()`, `resolveLocale()`, `languagesOver()`,
  `currenciesOver()`, `flatRatesOver()`, `methodOver()`, `setupStatus()` and the approval words), the handlers `src/server/setup-tools.ts`.
  Each saves only through the saver its screen calls (`saveStoreDetails()`, `setMarkets()`, `saveLanguages()`, `saveCurrencies()`,
  `saveShippingSettings()`, `saveShippingMethod()` after `methodInput`, `completeSetup()`), and `saveLanguages()`'s checks are
  `languagesProblems()` in `src/server/localization.ts`, asked by both.
- **`setup_status` is `setup_progress`.** The tool that was there is the status: each step in the wizard's order with its page and either the
  tools that do it or the one thing only the owner does there (the payment provider's identity and bank account, switching payments on, the
  plan, bookable staff and places), `next`, and `owner_only` with a domain waiting for its DNS records and a carrier's agreement as optional.
  The name stayed, since the store checkup and the owner's conversations name it.
- **The gate.** While the store is being set up (`setup_completed_at` empty) its storefront is a preview nobody finds, so the six setup
  changes run at once; once it is open they wait for a yes (`GATED_WHEN_OPEN`, `setupGateNeeded()`, read from the database each call).
  `open_store` always waits. A change that would be refused is refused before it is kept (`preflightSetupTool()`), and the approval says
  what it does from the store as it is (`setupApprovalWords()`).
- **The store as it is now.** A turn may add a country and price its shipping in the next call while the cache still serves the store as it
  was (`revalidateTag(…, "max")`), so every setup tool reads `currentStore()` (`src/server/stores.ts`: the store's reader without the cache).
- **Permissions and features.** Details, languages, currencies and opening are the owner's, as on their pages; countries, the flat rate and
  methods need `settings:write`. `set_currencies` stands behind Several currencies, the shipping tools behind the online shop. A store that
  is closed or suspended is refused. Calls are audited in the Settings area.
- **Tests.** `src/lib/setup-tools.test.ts`; `src/server/setup-tools.int.test.ts` sets a store up through the tools and holds its progress
  equal to a store set up through the wizard's savers, opens it on a yes and shows that every change then waits.

## 6. Unit A4 (D308): design tools

`list_themes` (published themes and presets, with prices, `listOfferedDesigns()` and `themeCharge()`), `add_theme` (`installDesignPreset()`,
not live, ungated), `try_theme` (the install's preview address for the person) and `make_theme_live` (`applyDesignPreset()`: `public`, and
`spend` when the theme costs money and the store does not own it, with the charge the owner was shown). Tests: adding never changes the
live look; going live through the tool equals going live from Design settings; a premium theme is never made live without its charge.

### 6.1 As built (2026-10-25)

- `src/lib/design-tools.ts` (pure: the arguments, `chargeCosts()`, `chargeKey()`, `chargeTokenFor()`, `liveSummary()`) and
  `src/server/design-tools.ts`; owner tools only (a store's look), `website:read` for `list_themes` and `try_theme`, `website:write` for
  `add_theme` and `make_theme_live`, as Design settings asks. Kaizena Flow's own site's themes stay with a person (Website, Design).
- `list_themes` reads `listOfferedDesigns()` with `themeCharges()` (the price in words, `chargeLine()`) and the store's library
  (`listInstalls()`), each install with its page. `add_theme` is `installDesignPreset()`, at once and ungated (the function audits
  `store.theme_installed`); it answers with the install and its preview. `try_theme` gives the install's preview and page, for the manager
  to open (`open_admin_page`) rather than describe.
- `make_theme_live` takes an install (`switchToInstall()`) or a theme and preset (`applyDesignPreset()`), always gated, checked first by
  `preflightDesignTool()` (not installed, live already, not on offer, an unknown preset, the library full, a store not open or kept by the
  platform). `liveApprovalDetails()` writes the owner's question (`liveSummary()`), keeps the charge as `approved_charge` (`chargeKey()`:
  kind and price, a value the model passed replaced) and makes the approval a `spend` when the theme costs money now or when the store opens,
  else `public`. When the yes runs the charge is read again: any other charge is refused with `CHARGE_CHANGED` and nothing changes; a theme
  charged at once passes its price token to the database (`setThemeCharge()`) and is invoiced after the answer (`chargeDueThemePurchases()`).
- The autopilot (D309): `make_theme_live` is in the Design area; `autopilotDecision()` reads `liveCostsMoney()` first and a theme that costs
  money, or whose cost cannot be read, always waits for a yes.
- Tests: `src/lib/design-tools.test.ts`; `src/server/design-tools.int.test.ts` (adding never changes the store's look or charges anything,
  the tool's live theme equals Design settings' `applyDesignPreset()` on a twin store and its switch is the page's, a premium theme is
  refused without, or with another, charge and goes live with the kept one, the approval keeps the charge as a `spend`, the autopilot's
  decisions).

## 7. Unit B (D309): goals, plans and the work loop

Written in full on 2026-10-25, before B1 is built, from a read of `runTurn()`, `callTool()`, `keepForApproval()`, `decideApproval()`,
the follow-up runner (D318) and the setup and analytics readers. A plan is the model's idea of what to do; whether a step may run, what it
may touch, whether it worked and whether it needs the owner are the code's. Kaizena Flow's own site has the same goals, plans and loop with
the platform principal (`store_id` null), with the targets and checks that make sense there.

### 7.1 Goals (B1)

`commerce.assistant_goals`: a store's (or the platform's) goals, written only by `src/server/autopilot-goals.ts`.

- `title` (a short name), `vision` (the owner's words, up to 2,000 characters, never sent anywhere but the store's own model as data),
  `targets` (a list, at most five, read only through `goalTargetsSchema` in `src/lib/autopilot-goals.ts`), `due_on` (optional), `status`
  (`active`, `met`, `dropped`), who made it and when.
- A target is a kind from `GOAL_TARGETS` with a number, and is read by code from the store's own figures (`goalProgress()`), never by the
  model:

  | Kind | Read from | Store | Platform |
  |---|---|---|---|
  | `revenue_30d` | net sales of the last 30 store days, without VAT, in the main currency (`periodTotals()`: revenue less refunds) | yes | no |
  | `orders_30d` | paid orders of the last 30 store days (`periodTotals()`) | yes | no |
  | `conversion_30d` | checkout orders ÷ counted visits, last 30 days; *not measured* while visit counting is off, never zero | yes | no |
  | `open_by` | the store is open (`setup_completed_at`) on or before the date | yes | no |
  | `products` | active products, demo products left out (`isDemoProduct()`) | yes | no |
  | `pages` | published pages (type `page`) | yes | yes |
  | `stores` | open stores that are real businesses (`not (is_template or starter)`) | no | yes |

  A figure that cannot be known (no rate for a currency, no visits counted) is *not measured* with the reason, never 0 and never met.
  A goal is `met` when every target is met; the code marks it, the model never does.
- Tools (manager tools, so the platform has them too; ungated: goals are staff-only data): `set_goal` (make or change one, by id),
  `list_goals` (each with its progress written by code), `drop_goal`. At most five active goals per store.

### 7.2 Plans and steps (B1)

`commerce.assistant_plans` and `commerce.assistant_plan_steps`, written only by `src/server/autopilot-plans.ts` (and the loop's
`src/server/autopilot-runner.ts` for a step's run); the database holds the life cycle (`autopilot_plans_rules()`,
`autopilot_steps_rules()`).

- A plan: `title`, `summary`, the goal it serves (optional), the account it runs in (whoever made it: its steps run in their name and with
  their role, read again before every step), its own conversation (`Autopilot: {title}`, where its task turns and answers are kept, so the
  person's chats stay theirs), `version` (raised on every change of its steps), `status` (`draft`, `running`, `paused`, `done`,
  `stopped`) and `pause_reason`. Statuses move `draft → running ↔ paused`, `running → done`, and anything not finished `→ stopped`;
  a change of steps puts a running or paused plan back to `draft` (it must be started again).
- A step: `key` (`s1`…, unique in its plan), `title`, `kind`, its spec, `after` (the keys it waits for), `check`, `status`, `tries`,
  `result`, `question`, `answer`, `not_before`, a claim (`claimed_until`) and the approvals it waits on (`assistant_approvals.plan_step_id`).
  At most 30 steps; the steps after one another must form no loop (checked by `checkPlan()`, pure, before anything is written).
- `STEP_KINDS` (`src/lib/autopilot-plans.ts`):
  - `tool`: one call of an owner tool (a platform tool on the platform) with its arguments, checked by the tool's own schema
    (`readToolInput()`) when the plan is made and again when it runs. Run by code, not by the model.
  - `task`: a brief (up to 1,000 characters) and the tools it may use (1 to 12 names, each one the person's role may use and the store's
    features offer). Run as a headless turn (7.3).
  - `question`: a question for the owner with up to five options; the plan waits for the answer, which later steps' turns are given.
  - `wait`: until a date and time (at most 90 days ahead).
- `CHECK_KINDS`, each read by code after a `tool` or `task` step: `none` (the step's own success), `product` (a product with that title
  exists, and is active when asked), `page` (a page with that title or address exists, and is published when asked, with no blocking
  accessibility issue), `setup_step` (a step of `getSetupProgress()` is done), `store_open`, `count` (at least N active products or
  published pages). The platform has `none`, `page` and `count` of pages.
- Steps' statuses: `pending` (not yet run, or waiting for the steps it follows), `running` (claimed), `waiting` (on the owner's yes for
  calls it kept), `asking` (a question for the owner), `done`, `skipped`, `cancelled` (its plan stopped). A step that follows a skipped
  step is skipped too, with the reason; the plan is `done` when no step is left to run.
- Tools (manager tools, named `*_autopilot_plan` beside the billing plan's `change_plan` and the platform's `list_plans`):
  `make_autopilot_plan` (a draft from title, summary, goal and steps; every step checked, the whole plan refused with the first problem in
  words), `revise_autopilot_plan` (replaces the steps not yet done or running), `start_autopilot_plan` (gated `plan`: the owner's yes starts
  exactly the version they were shown, `approved_version` kept with the call as the draft orders' version is), `pause_autopilot_plan`,
  `resume_autopilot_plan` (gated `plan` as starting), `stop_autopilot_plan` (ungated: stopping is always safe), `get_autopilot_plan` and
  `list_autopilot_plans` (read), `answer_autopilot_question` (refused in a turn nobody is in: its words are not the person's choice).
- Gate category `plan` ("starts work in your name"): the `assistant_approvals_category` check widened, `GATE_WORDS.plan`, words in the
  `assistant` catalogues. A yes to it is run by `decideApproval()` through the plans module, as `contact_kaizen_support` is.

### 7.3 The loop (B2)

`/api/cron/autopilot`, every minute (`pg_cron` as the broadcasts' route, `maxDuration` 300, inside `trackedRoute()`), runs
`runAutopilot()`:

- Takes up to three runnable steps, at most one per store (and one for the platform), none where a step is already running: the plan is
  `running`, the store's autopilot is not paused (7.4), the store is active (`store_is_active()`, which a store being set up is), the steps it
  follows are `done` or `skipped`, `not_before` has passed. Each is claimed (`claimed_until`, ten minutes, `for update skip locked`).
- Reads the plan's person again (`principalFor()`, the follow-up runner's: an account disabled, a member removed or a platform admin no
  longer one pauses the plan with the reason; a closed store stops it).
- Runs the step:
  - `tool`: `readToolInput()`, then the autonomy decision (7.4) for a gated call: run now through `runOwnerTool()` (or the platform's),
    or keep it for the owner (`preflightOwnerTool()` first, then `keepForApproval()` in the plan's conversation with `plan_step_id`), the
    step `waiting`. An ungated call runs.
  - `task`: `runTurn({ scheduled: true, autopilot })` in the plan's conversation, with `AbortSignal.timeout(120 s)`, the connection made
    for the feature `autopilot` (so its cost is its own), the tools limited to the step's (plus `use_skill` and `recall`; never
    `decide_approval`, `answer_autopilot_question`, `follow_up` or the plan tools), the brief, the plan's title, the earlier steps' results and the
    owner's answers given as data. Gated calls in the turn meet the same autonomy decision, and those kept are tied to the step.
  - `question`: the step becomes `asking`.
  - `wait`: done when its time has come, else `not_before` is set to it.
- Then the check: passed is `done`; failed is another try in ten minutes; the third failure becomes a question with the last problem in
  words and the options *Try again*, *Skip this step* and *Stop the plan*.
- A kept call decided by the owner settles its step (`settleStepApproval()`, called by `decideApproval()`): once every call the step kept
  is decided, done or failed calls run the check, and declined ones alone skip the step.
- Never `decide_approval` or `answer_autopilot_question` in a turn the loop runs, and a scheduled turn sets no follow-up (D318's rule).
- Every change made inside the loop is audited with `by = 'autopilot'` (7.6).

### 7.4 Autonomy levels and budgets (B2)

`commerce.autopilot_settings`, one row per store (and one for the platform), written only by `src/server/autopilot-settings.ts`, owners
only (the platform's by platform admins):

- `paused`: the owner's switch to pause the autopilot of the whole store (plans keep their places).
- `levels`: per area, `ask` (*Ask me first*, the default for every area), `tell` (*Do it and tell me*) or `auto` (*Just do it*).
  Areas (`AUTONOMY_AREAS` in `src/lib/autopilot-autonomy.ts`): `catalogue`, `website`, `design`, `setup`, `marketing`, `messages` (to
  customers and staff), `money`. Every gated tool is in one area (`TOOL_AREAS`) or in `NEVER_AUTOMATIC`; a test fails for one in neither.
- `NEVER_AUTOMATIC` (always kept for a yes, whatever the level): the `access` and `domain` gates; refunds, order changes, exchanges'
  processing, credits and gift cards (`refund_order`, `change_order`, `process_exchange`, `adjust_customer_credits`, `issue_gift_card`);
  the plan with Kaizena Flow (`change_plan`, `end_plan`), domains bought or renewed, features switched (`set_feature`), opening the store
  (`open_store`), and the platform's access requests and referral program. The outline's "refunds over a budget" is stricter here: refunds
  are never automatic until a budget is asked for.
- `budgets`: the AI cost of the autopilot a month (US dollars, priced as D145 prices every call; reached, the plans pause with the reason),
  the deepest discount (percent; a discount or campaign deeper than it is kept for a yes), the largest price change (percent of a variant's
  current price; a larger one is kept for a yes). Theme purchases wait for A4.
- `autonomyDecision(settings, tool, args, facts)` (pure, with the facts read first: current prices, a discount's depth) is the one rule,
  used by the tool steps and inside the task turns: `run` (with `tell` true when the owner is to hear of it) or `ask` with the reason.

### 7.5 Decisions and reports (B3)

- The Autopilot page (`/admin/{store}/assistant/autopilot`, `/admin/platform/assistant/autopilot`, beside the AI manager's page and, like it, the owner's): **Decisions** first (Homer's view: what waits on the
  owner, each with its buttons: the kept calls with Approve and Decline, the questions with their options, and what only the owner can do,
  from `getSetupProgress()`), then **Plans** (each plan with its steps, statuses and results; Start, Pause, Resume, Stop), **Goals** (each
  with its progress from `goalProgress()`) and **Settings** (the switch, levels per area and budgets; owners only).
- A digest email (`autopilot.digest`, `src/lib/autopilot-report.ts`, staff email words in the `staffEmails` catalogue) at most once a day,
  after 18:00 in the store's time, to the person a plan runs for, when there is something to tell (a step finished, a decision or question
  waiting): what was done and what waits, with the link; never the content of a customer's message or a step's result.
- A weekly report (`commerce.autopilot_reports`, one per person, scope and week), from Monday 08:00 in the store's time: net sales and orders
  of the last seven store days and the seven before from `periodTotals()` (not measured when a currency has no rate), the goals' targets met,
  the steps done and what waits, drawn by code; a few sentences of concerns and next steps written by the model over those facts (feature
  `autopilot`, `UNTRUSTED_TEXT`, within the AI budget) kept only through `checkedNote()` (no digit, no claim `findClaims()` finds, at most
  600 characters; dropped, not shown, when it fails). Emailed (`autopilot.weekly`) and shown on the page's Decisions tab.

### 7.6 The audit log says who acted (B1)

`commerce.audit_log.by` (`person`, `ai_manager`, `autopilot`; `person` by default) is written by `audit()` from the actor of the moment
(`actingAs(by, fn)` in `src/server/actor.ts`, an `AsyncLocalStorage`), so no tool needs a new argument: the AI manager's turns run their
tools as `ai_manager` (a call approved by the person included: the AI made the change on their yes), the loop as `autopilot`. Activity
shows it beside the person's name.

### 7.7 As built: B1 (2026-10-25)

- Migrations `20261025120006_autopilot_plans` (the three tables, `assistant_approvals.plan_step_id`, the `plan` category,
  `audit_log.acted_by`) and `20261025120033_autopilot_plans_rules` (RLS, the plans' and steps' life cycles).
- Pure: `src/lib/autopilot-goals.ts` (`GOAL_TARGETS`, `targetFromInput()`, `targetProgress()`, `goalMet()`) and
  `src/lib/autopilot-plans.ts` (`STEP_KINDS`, `CHECK_KINDS`, `checkPlan()`, `findLoop()`, `skippedBehind()`, `planFinished()`).
- Server: `src/server/autopilot-goals.ts` (`setGoal()`, `goalFigures()`, `goalsWithProgress()`), `src/server/autopilot-plans.ts`
  (`makePlan()`, `revisePlan()`, `startPlanNow()`, `pausePlan()`, `stopPlan()`, `answerQuestion()`, `planWords()`),
  `src/server/autopilot-tools.ts` (the handlers), `src/server/offered-tools.ts` (the tools a person may use, shared by the turn and the
  plans), `src/server/actor.ts` (`actingAs()`, read by `audit()` and the transactional audit writers of redirects and the 404 report).
- Goal and plan audit entries are `ai.goal_*` and `ai.plan_*` (area Settings, or the platform's). Entries the database writes itself say
  `person`. Activity shows "through the AI manager" or "through the autopilot" after the person's name.
- Not yet: the loop, autonomy and budgets (B2), the page, digest and report (B3). Until B2, a started plan runs nothing.

### 7.8 As built: B2 (2026-10-25)

- Migrations `20261025123210_autopilot_settings` (`commerce.autopilot_settings`, one row per store and one for the platform, unique with
  nulls not distinct) and `20261025123242_autopilot_loop` (RLS, the every-minute `kaizen-autopilot` job calling `/api/cron/autopilot`).
- Pure: `src/lib/autopilot-autonomy.ts` (`AUTONOMY_AREAS`, `TOOL_AREAS`, `NEVER_AUTOMATIC`, `autonomyDecision()`, `discountDepth()`,
  `largestPriceChange()`; default budgets: 5 USD of AI a month, 20 % deepest offer, 10 % largest price change). A free product over an
  amount always asks: its depth against the basket is not known.
- Server: `src/server/autopilot-settings.ts` (`autonomyFor()`, `saveAutonomy()`, owners and platform admins only, `aiBudgetSpent()` from the
  month's `ai_usage` of the feature `autopilot` at D145's prices), `src/server/autopilot-gate.ts` (`autopilotDecision()`, facts read first:
  `priceChangePercent()` from the editor's own product), `src/server/autopilot-checks.ts` (`checkStep()`), `src/server/autopilot-runner.ts`
  (`runAutopilot()`: a store's advisory lock and a claim per step, a step died in hand goes back with a try counted), and in
  `src/server/autopilot-plans.ts` `completeStep()`, `failStep()`, `skipStep()` and `settleStepApproval()`, which `decideApproval()` calls
  for a call kept with `plan_step_id`.
- A task's turn is `runTurn({ scheduled: true, autopilot })` inside `actingAs("autopilot")`: the step's tools and `use_skill`, `recall`
  only (a call of another tool is refused in `callTool()` too), the autopilot's lines added to the system prompt, gated calls through
  `autopilotDecision()` and run at once or kept with the step's id.
- The page check is "published", which carries the builder's accessibility check (`publish_page` refuses a blocking issue).
- Settings have no AI manager tool: they are the owner's, on the page (B3).

### 7.9 As built: B3a, the page (2026-10-25)

- `/admin/{store}/assistant/autopilot` (`requireOwnerRole()`, as the AI manager's page) and `/admin/platform/assistant/autopilot`
  (`requirePlatformAdmin()`), linked as a third tab of the AI manager's page; one component, `AutopilotPage`
  (`src/components/admin/autopilot/autopilot-page.tsx`), with tabs Decisions (the count of what waits in its tab), Plans, Goals and
  Settings; words in the `assistant` catalogue's `autopilot` (both languages).
- What it reads is `autopilotOverview()` (`src/server/autopilot-overview.ts`): the person's own pending calls in the scope (with the plan a
  call came from), the questions of plans not finished, what only the owner can do (payments onboarding and the plan with Kaizena Flow, from
  `getSetupProgress()`), plans with their steps, goals with their progress, the settings and the month's AI cost.
- Its buttons are `src/server/autopilot-actions.ts` (`decideCall()` through `decideApproval()`, `answerStep()`, `changePlan()`: a press on
  Start or Resume is the person's yes for the version the page showed, `dropGoalFrom()`, `saveSettings()`), bound by each route's
  `actions.ts`, refreshing the page after a change.

### 7.10 As built: B3b, the digest and the weekly report (2026-10-25)

- `sendAutopilotReports()` (`src/server/autopilot-reports.ts`, the dispatcher's job `autopilotReports` in `/api/cron/cart-reminders`, 20
  emails a run) is the only writer of `commerce.autopilot_reports` (migrations `autopilot_reports` and `autopilot_reports_rls`; unique per
  store, account, kind and period, nulls not distinct, so Kaizena Flow's own site has one too). It looks at the people whose plans run,
  are paused or finished in the last eight days in an open store (or on the platform), reads each again (`activeAccount()`, then
  `passMembership()` for a store, a platform admin for the platform: someone who left gets nothing), and claims a period's row before its
  email goes (`on conflict do nothing`), so each is sent once; the email's idempotency key names the period too.
- The facts are `ReportFacts` (`src/lib/autopilot-report.ts`, kept as JSON with the row): the person's own steps done in the last day or
  week (at most eight titles listed, the count beside them), what waits for them (kept calls and questions), and for the weekly report the
  figures and the goals. The email is `autopilotEmail()` in the person's admin language; money is written by `formatMoney()`.
- The page reads the person's latest weekly report with `latestReport()` and shows it on Decisions.
- Personal data: `autopilot_reports` is in `PERSONAL_DATA` as a staff member's (counts, step titles and figures, never a customer); the email kinds `autopilot.digest` and
  `autopilot.weekly` are in `EMAIL_KINDS`; `never` in `COPY_RULES`.

### 7.11 Tests

PGlite: the plan and step life cycles the database holds, the audit `by` check. Unit: `checkPlan()` (unknown tool, bad arguments, a loop,
a missing key, too many steps, a tool the role may not use), `goalProgress()`'s arithmetic on fixed figures, `autonomyDecision()` for every
level, budget and `NEVER_AUTOMATIC`, every gated tool in one area. Integration: a plan made, started on a yes and run to the end by the loop
with a fake model (a tool step, a task step, a question answered, a step whose check fails three times and becomes a question), a kept call
settling its step, a removed member pausing the plan, another store's plan never touched.

## 8. Unit L (D311): legal pages by AI

This changes D158's rule that a legal page's words are hand-written starters and never a model's. The owner's decision (2026-10-22): a strong
agent can research and compile legal texts better than most store owners, so a store's legal pages are written and kept current by the AI,
with no person reviewing each text. What keeps them right is how they are made, and that is what this section specifies: the model writes
sentences from official text fetched by code; everything a sentence states about the store, and every quote from the law, is put there or
checked by code.

The consumer texts that are part of the product itself (the withdrawal function, emails, the checkout's words, `HAND_WRITTEN_ONLY`), the
accessibility statement (`a11y-statement.ts`, which never says "conforms" without an audit) and Kaizena Flow's own terms (P5) are not in this
unit and stay as they are. The hand-written starters stay, unchanged, as the fallback.

### 8.1 What is written

- **The six starter kinds** (`STARTER_ROLES`): terms of sale, privacy statement, returns policy, shipping policy, withdrawal information
  (with the model form) and imprint, each with the topics `REQUIRED_TOPICS` and `CONDITIONAL_TOPICS` already name. The topic list is code's;
  the model never adds, drops or merges a section.
- **Where the seller is established in a country the source register covers**: Norway, Sweden and Denmark first (the countries the starters
  were written for), with EU law for every EU market the store sells to. A store established elsewhere is told the AI cannot write its pages
  yet and keeps the starters.
- **In the store's languages among nb, sv, da and en**, as the starters are: the main language is the page, the others its D55 texts on the
  same blocks. Each language is written from the sources in that language where they exist (the directive in Swedish, Danish and English
  from the EU's own text; Norwegian law in Norwegian), never translated from another language's page. A store whose main language is none of
  the four gets the English page, saying so, as the starters do.

### 8.2 The source register

- **The register is code** (`src/lib/legal-sources.ts`, pure), as `LAUNCH_THEMES` is: each source has a key, its jurisdiction (`EU`, `NO`,
  `SE`, `DK`), the act's name and official id (CELEX, ELI, SFS number, Lovdata id), the route it is fetched by, the languages it exists in,
  and the topics each of its articles or sections may support (`TOPIC_SOURCES`: `withdrawal` → CRD Art. 9 to 16 and the national acts'
  sections on withdrawal, `complaint_authority` → the data protection authority's own page, and so on). Which sources a page uses is decided
  by code from the store's facts (its country, its markets, whether it sells to businesses, bookings), never by the model. The bodies a
  consumer may complain to (`DISPUTE_BODIES`: Forbrukerrådet and Forbrukerklageutvalget, Allmänna reklamationsnämnden, Nævnenes Hus and
  Forbrugerklagenævnet) and the data protection authorities are data in the register with the address of their own page, so the page names
  them from data and the starters' `[[Check: complaintBody]]` is answered. The EU's ODR platform is in no source and the checker refuses it.
- **Fetched by code, only from the register's hosts** (`LEGAL_SOURCE_HOSTS`), through `safeFetch()` with a size limit and an injectable fetch.
  The routes, each read in full from the sandbox on 2026-10-25 through the same code (production confirms them at its first reads, 8.10):
  - EU law through the Publications Office's Cellar: its SPARQL endpoint lists an act's consolidated versions and the newest is fetched
    (`publications.europa.eu/resource/celex/{CELEX}`, XHTML in the language asked for), so an amended directive is read as amended without a
    change here. EUR-Lex's own pages answer automated requests with an empty bot check and are not used.
  - Swedish law through Riksdagen's open data (`data.riksdagen.se/dokument/sfs-….text`): the act as in force with its amendments.
  - Danish law through Retsinformation's XML by ELI (`www.retsinformation.dk/eli/…/xml`). The consolidated act is named in the register; its
    `Status` is read each time and an act no longer in force fails the read, so the register is brought up to date.
  - Norwegian law through Lovdata's open data (`api.lovdata.no`, NLOD 2.0): one archive of every act in force, updated with its amendments
    (`gjeldende-lover.tar.bz2`, about 6 MB), downloaded once a run and unpacked; personopplysningsloven carries the GDPR's articles in
    Norwegian. (An earlier test with curl was refused, 405; through `safeFetch()` the archive answers. Lovdata's web pages are for reading,
    not for automated use, so only the open data is read.) The passages a person recorded (`LEGAL_WORDING_NB`) stay with the starters.
- **Each read is kept**: `commerce.legal_source_reads` (Kaizena Flow's, no store: the source's key, the language, the version read, when,
  `ok` with the text's hash or `failed` with its problem) and the text itself once per distinct content in `commerce.legal_source_texts`
  (the passages, by hash), both append-only and written only by `src/server/legal-sources.ts`. The text is cut into passages by code per route
  (`src/lib/legal-passages.ts`, tested on a stored copy of each route's answer); a read in which a passage the register names cannot be found
  is `failed`, never guessed at. Sources are read again weekly (8.5); reads older than 90 days are pruned except the newest `ok` read of each
  source and language (L3 keeps every read a live page cites), and texts no read names go with them.

### 8.3 How a page is written

1. **Facts.** `legalFacts(store)`, as the starters read them, become a fact sheet of named facts (`fact:returns.windowDays`,
   `fact:seller.legalName`, `fact:markets`, …) with the store's values, and links (`link:withdraw`, `link:cookies`, `link:privacy`) and
   bodies (`body:disputes`, `body:privacy_authority`) from the register.
2. **Plan.** Code lists the page's sections (the topics), and for each the passages it may rest on (from `TOPIC_SOURCES`, in the page's
   language where the source has it) and the facts it may use.
3. **The model writes** one page in one language per call, through `aiFor(store, { feature: "legal_pages" })`'s text model, with
   `UNTRUSTED_TEXT` (the passages are data), the passages between `<source-data>` markers and the fact sheet by name only. It answers JSON
   only: for each topic, a heading and paragraphs or lists; each paragraph is `statement` (says what the law gives or requires, and cites at
   least one passage with a quote from it of 20 to 300 characters) or `practical` (says how this store does something, and uses at least one
   fact). Every fact, link and body is written as its token (`{fact:returns.windowDays}`), never as a value: code fills it in.
4. **Code puts in what the model must not write**: the model withdrawal form (in sv, da and en the directive's Annex I(B) as the fetched text
   has it, in nb the form the starter holds, from the state form Q-0319B), the seller's details in the imprint (a table of facts), and a
   final **Sources** section listing every passage cited, with the act, the article and the official address, and the day each was read.
5. **Checked by code** (`checkLegalDraft()` in `src/lib/legal-writer.ts`, pure), every rule a refusal with its reason:
   - the topics are exactly the plan's, once each, in order;
   - every quote is in its passage word for word (spaces and quotation marks normalised), and every cited passage is one the plan offered;
   - every token is a known fact, link or body of the sheet, and every value is filled in from it (no `[[` left);
   - no figure, amount, date, web address, email address or organisation number appears outside a token or a quote (the model cannot state a
     number of its own), and the withdrawal period, wherever the page states one, is the `fact:withdrawal.days` token (never under 14);
   - topic rules: the withdrawal section uses the withdrawal days and, with `link:withdraw` present, the link; the returns window and who pays
     return shipping are the `return_settings` facts; the disputes section names a `body:disputes`; nothing names the ODR platform;
   - the words pass the claims filter (`findClaims()`: no promise the store has not made) and the page passes `pageIssues()` without a
     blocking issue;
   - each block is plain text (no HTML, no markup) within a length limit.
   A draft that fails is written again once with its reasons; a second failure keeps the page as it is (or makes the starter where the store
   has no page of that kind) and the write is `failed` with the reasons.

### 8.4 Pages, publishing and versions

- **Written into the role's page.** The kind's page (its `page_roles` row) is written again as a new version through `savePage()`, so its
  address stays and `keepVersion()` keeps every version; a store with no page of that kind gets one, placed in the role. **A page a person
  wrote is never written over**: a page the AI did not write, or an AI page edited since its last write (its draft differs from what the
  write saved), is left alone, and the AI makes a new page beside it as a draft and says so; the owner can hand a page back.
- **No review notice.** An AI page has no `legal-review-notice` row (no person reviews each text, D311). Its Sources section says it was
  prepared with AI from the sources listed, on the date written.
- **Published** when the checks pass, at the owner's choice made when turning it on (`publish`: `auto`, the default, or `ask`: the write is
  a draft and the owner publishes it from the Legal page). Publishing goes through `savePage()` with `publish: true`, so the checker runs
  again; a page in a running A/B test is never written (legal pages are never tested, D158). What a buyer accepted stays as it was
  (`legal_snapshots`, D158).
- **Every write is a row**, `commerce.legal_ai_writes` (store, kind, page, languages, why (`first`, `source_changed`, `facts_changed`,
  `asked`), status `queued`, `running`, `written`, `published`, `kept` (a person's page left alone) or `failed`, the sources as read ids and
  passage keys, the facts' hash, the model, tries, problems, timestamps), written only by `src/server/legal-writer.ts`; `never` in
  `COPY_RULES` (a copy of a store agrees for itself).

### 8.5 Kept current

The five-minute dispatcher's `runLegalUpkeep()`, for stores with it on that are open (`store_is_active()`):

- reads again weekly every source a live AI page cites; a cited passage whose text changed queues those pages (`source_changed`);
- compares, daily, the hash of the facts each page used with the store's facts now: a new country, carrier, tracking tool, return window,
  delivery method or seller detail queues the pages that use it (`facts_changed`);
- writes one page per store per run, at most `LEGAL_WRITES_PER_DAY` a store (a burst of changes waits), under the store's AI limits
  (`aiFor()` gives no AI past them, and the write waits).

With no model, a source that cannot be read or a failed write, the page stays as it is and the owner sees why on the Legal page and in the
autopilot's digest where it runs (B3b).

### 8.6 The owner's part

- **One choice, said once**, on Settings → Legal (owner only, `requireOwnerRole`): "Let AI write and keep your legal pages. It writes your
  terms, privacy, returns, shipping, withdrawal and imprint pages from the official sources and your store's settings, and writes them again
  when either changes. As the seller, your store is responsible for them." Turning it on records who, when and the version of that sentence
  (`commerce.legal_ai_settings`: store, on, `publish`, the sentence's version, by, at), audit `store.legal_ai_on`/`store.legal_ai_off`, and
  queues the first writes. Turning it off writes nothing more and leaves every page as it is.
- **Homer** sees each kind's page with one line: "Written by AI on 25 October from 7 sources" or why not. **Lisa**, one step away: the
  sources and passages, the versions, why each write happened, *Write again now*, *Stop writing this page* and *Hand back to AI*, and the
  publish choice.
- **The AI manager** gets `legal_pages_status` (read-only: what is written, when, from what, what waits). Turning it on, the publish choice
  and stopping a page are the owner's on the page, never a tool's.
- Kaizena Flow may have a lawyer read the register and the checker's rules once per country (recommended, not a gate); the words of each
  page are not reviewed by a person.

### 8.7 Tests

`src/lib/legal-sources.test.ts`: the register (hosts, ids, every required topic of every covered country has a source in each language,
no ODR), the cutters (`src/lib/legal-passages.test.ts`) on a stored answer of each route. `src/lib/legal-writer.test.ts`: `checkLegalDraft()` refuses a quote not in its
passage, an unoffered passage, a figure or address outside a token, a missing or extra topic, a withdrawal period that is not the token, the
ODR platform, a claim; fills tokens; the form and Sources section are code's. `src/server/legal-writer.int.test.ts` with a stand-in fetch
and model: turning on writes and publishes the six pages into their roles; a changed return window writes the returns policy and terms
again; a changed passage writes the pages citing it; a page edited by a person is kept and a draft made beside it; a draft that fails twice
keeps the page and records why; another store's pages are never touched. `agent-eval.ts`: a case where a source passage hides an
instruction (the canary must not appear in the page).

### 8.8 Steps

- **L1, the sources** (built, 8.10): the register, the fetch routes, the cutters, `legal_source_reads` and the weekly read. No model,
  nothing on pages.
- **L2, the writer** (built, 8.11): plan, prompt, `checkLegalDraft()`, the form and Sources section; *Write with AI* on the Legal page makes a
  draft of one kind (never published), so the result can be read before anything is automatic.
- **L3, kept current** (built, 8.12): turning it on, publishing, `runLegalUpkeep()`, the Legal page's lines, `legal_pages_status`, the report.

### 8.9 Decided by the owner (2026-10-25)

1. **Pages are published as soon as they pass the checks** (`auto` is the default; `ask` stays a choice).
2. **Each page says it was prepared with AI** from the sources it lists.
3. **Norway**: on the recorded passages while Lovdata refused fetches. Building L1 found Lovdata's open data answers (8.2), so Norwegian
   pages rest on the fetched law like the others; the recorded passages were not needed.
4. **Scope**: sellers in Norway, Sweden and Denmark, in nb, sv, da and en, first; others keep the starters.

### 8.10 As built: L1 (2026-10-25)

- `src/lib/legal-sources.ts`: the register. 13 sources: four EU acts (consumer rights, sale of goods, e-commerce, GDPR) in sv, da and en;
  three Swedish acts (distansavtalslagen, konsumentköplagen, e-handelslagen); two Danish (forbrugeraftaleloven LBK 1184/2025, købeloven
  LBK 1853/2021; e-handelsloven has no text in Retsinformation's XML, so Danish pages take those rules from the EU directive in Danish);
  four Norwegian (angrerettloven, forbrukerkjøpsloven, ehandelsloven, personopplysningsloven with the GDPR). `TOPIC_REFS` maps the
  topics of the six kinds of page to articles and sections, checked against the texts as read; `DISPUTE_BODIES`, `PRIVACY_AUTHORITIES` and
  `CONSUMER_AUTHORITIES` per covered country; `jurisdictionsFor()` and `refsFor()` decide what a store's pages rest on.
- `src/lib/legal-passages.ts`: the cutters (`cellarPassages()`, `riksdagenPassages()` with the version in force on the day,
  `retsinformationPassages()` up to the first `<Ikraft>`, `lovdataPassages()` without the amendment notes, `tarFile()`), the consolidation
  query, `cellarLanguage()` (Cellar answers in another language without saying so) and `normalisedLegalText()`, which quotes will be
  compared after. Tested on answers stored from each route (`src/lib/fixtures/legal/`).
- `src/server/legal-sources.ts`: the only writer of `commerce.legal_source_reads` (append-only) and `commerce.legal_source_texts` (one row per
  distinct text, by hash). `readDueLegalSources()` in the five-minute dispatcher (`legalSources`) reads three due pairs a run: a source a week
  after its last good read, a day after a failed one; a failed read never replaces a good one. A read fails when a passage the register names is
  missing, the answer is in another language, or a Danish act is no longer in force. `currentLegalTexts()` (L2) and `legalSourceStates()`
  read them. `seek-bzip` (MIT, pure JavaScript) unpacks Lovdata's archive.
- Found while building: angrerettloven § 20 a (the withdrawal function) is added by a law of 19 June 2026 not yet in force, so Lovdata
  gives it no text and no Norwegian page may cite it; the read refused it until the register stopped naming it.
- All 21 source and language pairs read in full from the sandbox, and again from production by the dispatcher's first runs (17:15 to
  17:45 UTC on 25 October 2026, no failure; Lovdata's archive and Cellar answer from Vercel too). Migrations
  `20261025163153_legal_sources` and `20261025163212_legal_sources_rules`, applied by CI in run 628.

### 8.11 As built: L2 (2026-10-25)

- `src/lib/legal-writer.ts` (pure): `planLegalPage()` (the kind's topics in the starters' order, each with the passages `refsFor()` offers in
  the page's language first and the tokens it must use, `TOPIC_NEEDS`; the model withdrawal form left to code), `writerMessages()` (the
  rules with `UNTRUSTED_TEXT`, the store's settings as values, the tokens by name and description only, the passages between `<source-data>`
  markers; a second call adds the refused answer and the reasons), `readWriterAnswer()`, `checkLegalDraft()` and `renderLegalPage()`. The
  checks refuse: sections not exactly the plan's; a quote not word for word in its passage (both normalised) or a passage not offered for that
  section; a statement without a cite or a practical block without a token; a needed token missing; a token not offered; a brace, markup,
  an email or web address written out; a number (digits, or a number word from two up in the four languages) in no quote the block cites;
  the ODR platform; a claim (`findClaims()`); lengths. Tokens are filled by code from `starterFactWords()` (`src/lib/legal-starters.ts`, the
  starters' own hand-written words: values, the settings sentences such as who pays for returns, the rate lists) and the register's bodies;
  a value the store lacks is the starters' `[[Add: …]]`. The form is the directive's Annex I(B) as read in sv, da and en, with the trader's
  details where it asks for them and its starred footnote (`fn_star1`, now cut from Cellar's answer), and the starter's in nb. Sources lists
  every passage cited with its act, the day read and the act's address, after the line that the page was prepared with AI on the day.
- `src/server/legal-writer.ts`: `askForLegalPage()` (owners of an open, real store; `legalWriterAvailability()`: a covered country, a good
  read of one of its sources, a text model) queues a row of `commerce.legal_ai_writes` (one active per kind); `runLegalWrites()` (after the
  press with four minutes, and in the five-minute dispatcher, `legalWrites`) claims it and writes one language a step, in the asker's name
  read again (`passMembership()`), then saves the page through `makeDraftPage()` with no review notice: the main language, the others as its
  texts (D55). A main language that fails ends the write; another that fails is left out and named. Audit `store.legal_ai_asked`,
  `store.legal_ai_draft_made` (with the model); the overview's newest draft includes AI drafts. AI usage is the feature `legal_pages`.
- The Legal page (`LegalPagesPanel`): *Written by AI* says what it does and that the store is responsible, or why it cannot (country, no
  text model, sources not read); each kind with a starter has *Write with AI* (*Write again* after one) and a line for its newest write
  (writing, with the screen refreshing; the draft to open and its languages; or why not). English and Norwegian words in the `legal` catalogue.
- The safety eval has a third agent, `legal`: the writer's real prompt with an official passage that hides an instruction
  (`legal-source-text`).
- Tested with a stand-in model (`legal-writer.test.ts`, `legal-writer.int.test.ts`, `legal-pages-panel.test.ts`); no real model has written a
  page here, as this sandbox has no AI key. Migrations `20261025171423_legal_ai_writes` and `20261025171450_legal_ai_writes_rules`.

### 8.12 As built: L3 (2026-10-25)

- **Turning it on** (`turnOnLegalAi()`, owners only): the sentence of 8.6 and the publish choice (*Publish each page once it passes the
  checks*, the default, or *Keep each page as a draft for me to publish*) on the Legal page; `commerce.legal_ai_settings` (one row a store:
  on, `publish`, `agreed` = `LEGAL_AI_TERMS_VERSION`, who and when, the stopped kinds, when the upkeep last compared) is written only by
  `src/server/legal-writer.ts`, audit `store.legal_ai_on`, `_off`, `_publish`, `_stopped`, `_handed_back`. Turning on queues the first writes
  at once; turning off fails the queued writes that were not asked for (*Turned off before it was written.*) and leaves every page as it is.
  A store copy does not carry it (`never`); it is staff data in the register (`turned_on_by`).
- **Where a write goes** (`savePageOf()`): into the kind's page as a new version at its address when the page is the AI's and nobody changed
  it since (a write of the store saved exactly the draft it holds, `saved_hash`), or when the owner handed it back (`overwrite`); otherwise a
  draft beside it (`kept`, the person's page untouched and still chosen), and a later write of that kind writes the same draft again while
  it stays as the AI left it (`draftBeside()`), so a person's page never collects drafts. A kind with no page gets the new page in its place
  once it is published (`setLegalRole()`). Published when the store has it on with `auto`, no fact is missing (`[[Add: …]]`) and the page is in
  no running A/B test; a publish `savePage()` refuses leaves the draft and says why. Statuses `written`, `published`, `kept`; each finished
  write keeps the passages it cited with their hashes (`sources`) and the facts' hash (`facts_hash`).
- **Kept current** (`runLegalUpkeep()`, the five-minute dispatcher's `legalUpkeep`): a few open, real stores with it on whose last comparison
  is older than `UPKEEP_EVERY_HOURS` (24), claimed with `for update skip locked`, each in the name of the owner who turned it on, read again
  (`passMembership()`; no longer an owner: skipped and logged). For each kind the store needs (`legalRoleNeeded()`) and the owner did not stop:
  `first` (never written, or the last write failed), `facts_changed` (`factsHash()` of the facts and languages differs) or `source_changed`
  (a cited passage reads differently in `currentLegalTexts()`, `passageHash()` after `normalisedLegalText()`; a source not read is no evidence
  of a change). At most `LEGAL_WRITES_PER_DAY` (12) a store in 24 hours besides the owner's own presses. The weekly reads of 8.10 keep the
  texts fresh; writes run in `runLegalWrites()` as in L2, and a write for a store that turned it off or stopped the kind since is not run.
- **The Legal page**: *Written by AI* shows since when and how pages are published, the choice to change and *Turn off*; each kind has *Write
  with AI* / *Write again*, *Stop writing this page*, and *Hand back to AI* where it is stopped or a draft was kept beside a person's page; the
  line says published, a draft, a draft beside the person's page, or why not, and why it was written (asked, first, a source changed, the
  store's details changed). While it is on, the starters' review notice is not shown. Words in the `legal` catalogue (en, nb).
- **The AI manager**: `legal_pages_status` (owner, read-only, ungated): on or off, the publish choice, the stopped kinds and each kind's
  newest write. Turning it on, the publish choice, stopping and handing back stay the owner's on the page.
- **The report**: the autopilot's digest and weekly report carry *Legal pages by the AI: n published, n drafts, n not written* for the
  period (`ReportFacts.legal`, counted by `workFacts()` from `legal_ai_writes` by `finished_at`); a period with legal writes is worth a digest.
- Tested with the stand-in model (`legal-writer.int.test.ts`: turning on publishes into the roles; facts and a cited passage changing write
  again at the same address, another passage does not; a person's page kept with one draft beside it until handed back; `ask` keeps drafts;
  a stopped kind and a store turned off are not written; the day's cap), `legal-pages-panel.test.ts` and `autopilot-report.test.ts`.
  Migrations `20261025175423_legal_ai_settings` and `20261025175447_legal_ai_settings_rules`.

## 9. Unit C (D310): eyes

The agent builds and changes pages, but until now it never saw one. Unit C lets it look: a page is photographed at a phone's and a computer's
width, measured by code in the browser, and judged by the model that sees pictures against a fixed list. What it finds comes back as
findings the agent can act on and the owner can read. A look reads and changes nothing; it costs one vision call.

### 9.1 What is looked at

- **A page's draft** (`look_at_page`): a store's page or article, its draft as the builder would publish it, drawn by `PageDrawing` (the
  store's theme, fonts, header and footer are not drawn: the page alone, as the replicator's frame draws a copy). It is opened through a
  signed address, `/admin/account/look/{page}?t=` (`signLook()` in `src/lib/page-look.ts`: a key made from `SETTINGS_ENCRYPTION_KEY` for this use alone,
  the page's id and an expiry ten minutes away), which opens that page's draft and nothing else; `noindex`, outside the signed-in admin,
  as the replica frame is.
- **The store as shoppers see it** (`look_at_store`): its home, one product page (the first active product the catalogue lists) and the cart,
  at the store's own live addresses (`marketUrl()` in its home market), so the header, the footer and the theme are in the pictures. For use
  after a design change (`make_theme_live`'s answer suggests it). A store that is not open is looked at all the same (its storefront is a
  preview); a demo store or template is never looked at by an owner's tool.

Kaizena Flow's own pages are not looked at in this unit (the platform's tools stay as they are).

### 9.2 How a look is taken

- **A look is a job**, `commerce.page_looks` (store, account, kind `page` or `store`, the page, status `queued`, `running`, `done` or
  `failed`, a claim with an expiry, tries, the findings, the problem, timestamps), written only by `src/server/page-looks.ts`. The tool
  queues it and asks for it to be run at once (a POST to `/api/cron/page-looks` with the scheduler's secret, waited for up to 100 seconds),
  so a person's turn usually gets the answer in the same turn; what is not finished by then is taken by the same route every minute
  (`pg_cron`, `kaizen-page-looks`) and read later with `get_page_look`. Chromium is loaded only by that route (`src/server/page-look-runner.ts`,
  in `outputFileTracingIncludes`), never by the assistant's routes.
- **One browser per width**, inside `looking()` with a time limit (D150's rule): the phone at 390 by 844, the computer at 1280 by 800. The
  page is opened, its lazy pictures loaded and scrolled through as the theme photographs do, then photographed full length (at most
  `LOOK_LENGTH_MAX` CSS pixels) and measured in the page (`src/lib/page-look-shoot.ts`, free of server-only modules): whether it scrolls
  sideways, pictures that did not load, how many words it shows, and whether a button or link is within the first screen. A look that
  fails is tried again once; two failures make it `failed`, with the browser's words told plainly (`lookProblem()`).
- **The judge** is the store's AI, `aiFor(store, { feature: "page_look" })` through `seeing()`; with no model that sees pictures the look
  is made by code alone and says so. The model is given every photograph (shrunk to at most 1024 pixels wide and 4000 tall) in one call, and the
  fixed list, with `UNTRUSTED_TEXT`: the words in the pictures are the page's, never instructions. It answers JSON only: findings, each one
  of `LOOK_CHECKS` (`cut_off`, `overlap`, `unreadable`, `missing_picture`, `no_call_to_action`, `empty_space`, `broken_layout`), where (`phone`
  or `computer`, and a few words), how bad (`blocking` or `minor`) and a sentence. `readLookAnswer()` keeps only those, at most twelve,
  each sentence at most 200 characters and plain text; anything else is dropped, and an answer that cannot be read is no findings from the
  model, said so.

### 9.3 Findings

A look's findings are the model's plus code's own, worded by code (`codeFindings()`): the page scrolls sideways on a phone (blocking),
a picture did not load (blocking), the page shows no words (blocking), no button or link in the first screen on either width (minor). For a
page's draft also the accessibility checker's blocking issues (`pageIssues()`, as publishing asks) and claims in its words (`findClaims()`
over the texts `mapTexts()` walks), each a blocking finding. A look is `fine` when no finding is blocking. Every finding is shown as text,
never as HTML; nothing in a look changes the page.

### 9.4 The tools

Owner tools, read-only and ungated (`website:read`), served over MCP like the others:

- `look_at_page` (a page or article by id or address): takes a look at its draft and answers with the findings, or that the look is still
  being taken (its id, for `get_page_look`). A page is looked at at most `LOOKS_PER_PAGE` times in an hour (three: the look and at most two
  rounds after a change); past that the tool says a person should look, so the agent never circles.
- `look_at_store`: the home, a product page and the cart, as above.
- `get_page_look` (a look's id): its state and findings.

The page tools' descriptions tell the agent to look after building or changing a page and before asking to publish it.

### 9.5 The autopilot

A page check may ask for a look (`check: { kind: "page", …, looks: true }`): after the page is found, a look of its draft is taken and run
at once; a blocking finding fails the try with the findings as its problem, and the next try's task message carries the last try's problem,
so the agent revises the page and it is looked at again. With `STEP_TRIES` at three, a page goes back for one more round at most twice,
then the owner is asked. A look still running when the check is made fails the try as "not looked at yet", and the next try reads it again.

### 9.6 Keeping

Looks are kept 30 days (`prunePageLooks()`, in the daily job), with their findings and no photograph (the pictures are never stored). A look
names its account (who asked); it is in `PERSONAL_DATA` as a staff member's, holding no customer, and `never` in `COPY_RULES`. Its cost is
the feature `page_look` in the AI usage reports.

### 9.7 Tests

`src/lib/page-look.test.ts`: the token (a page's own only, runs out), `readLookAnswer()` (unknown checks, long or HTML words, a broken
answer), `codeFindings()` and whether a look is fine. `src/server/page-looks.int.test.ts` with a stand-in photographer and judge: a look
queued, run and read back through `get_page_look`; the draft's blocking accessibility issue and a claim become findings; no model gives
code's findings only; the hourly limit; another store's page never looked at; the autopilot's page check with `looks` fails on a blocking
finding and passes on a fine look. `e2e/page-look.spec.ts`: the shoot run in a real browser against a small page (sideways scroll on a
phone, a broken picture, a button in the first screen).

### 9.8 As built (2026-10-25)

- `src/lib/page-look.ts` (pure: the widths, `LOOK_CHECKS`, `readLookAnswer()`, `codeFindings()`, `lookFine()`, the token),
  `src/lib/page-look-shoot.ts` (`shootPage()`, Playwright only), `src/server/page-looks.ts` (the only writer of `commerce.page_looks`,
  migrations `page_looks` and `page_looks_rules`: RLS and the every-minute `kaizen-page-looks` job), `src/server/page-look-runner.ts`
  (`browserLookPhotographer`, the only Chromium of the looks) and the route `/api/cron/page-looks` (in `outputFileTracingIncludes`; a POST
  with a look's id takes it and answers when done, any other call takes what waits after its answer). The look page is
  `src/app/admin/account/look/[pageId]/page.tsx`, drawn by `PageDrawing` from `lookDraft()`.
- A turn asks the route through `triggerLook()` with `cronBearer()` (`src/server/cron-auth.ts`: `CRON_SECRET`, else the scheduler's secret
  in Vault), waiting up to 100 seconds; with neither the look waits for the minute's run.
- A wrong or old token draws the not-found page (with status 200, as a streamed page's miss does), never the draft.
- The autopilot: the page check's `looks` (`stepCheckSchema`, the flat `stepInput`), `checkStep(store, check, { account, look })` (the
  runner passes the plan maker), and `taskMessage()` tells a retried task what its last try's check found.
- `make_theme_live`'s answer suggests `look_at_store`; `build_page` and `edit_page` suggest `look_at_page`.
- The agents' safety eval has `manager-page-look`: words in a page's picture that read as instructions, through `look_at_page`'s findings.
- Checked for real against the dev server (2026-10-25): a template page's draft photographed at both widths through the signed address and
  the route in about 11 seconds, with code's findings and, with no model configured, the note that only code looked. The judge's call to a
  real model is not run in tests (no key here); its answer is read by the tested `readLookAnswer()`.

## 10. What stays with a person

Identity and money (the payment provider's onboarding, the bank account, payouts), agreements with carriers, a domain's DNS records, physical
work (packing, real product photographs, counting stock), and the owner's own taste where they want it: the agent asks them to pick between
two or three options rather than to judge one. Everything else is the agent's to do within the levels and budgets the owner sets.

## 11. Tests

Each tool: an integration test through the tool and a read back through the screen's own reader; refusals in the screen's words; another
store's things never reached; gated tools only kept until the yes. B: PGlite tests of the plan and step rules; an integration test of a plan
run to the end by the loop with a fake model; the autonomy levels and budgets. L: the citation check refuses an invented quote; the fact
checks refuse a page that disagrees with the store; a changed source writes the page again. C: the findings reader on fixed answers.

## 12. Unit D (D328): the autopilot keeps going

Written on 2026-10-25 from the owner's goal ("manage and grow the business over time") and a read of unit B as built. Until now a plan
ended and the autopilot stopped: the next plan waited for a person to ask for it and say yes. Unit D gives each active goal a **review**: the
autopilot looks at the goal again, makes the next plan that moves it forward, and starts it itself where the owner allows. The plan is
still the model's idea; whether a review is due, what it may read, whether its plan starts and how many start are the code's.

### 12.1 Settings (`planning`)

`commerce.autopilot_settings.planning` (jsonb, read only through `autonomySettingsSchema`'s `planning`, written by `saveAutonomy()`):

- `continues` (off by default): *Keep working toward my goals*. Off, nothing in this unit runs, and stores behave as before.
- `starts`: `ask` (default: a plan a review makes waits on the Decisions page as a start for the owner's yes, the same kept call as
  `start_autopilot_plan`) or `auto` (it starts at once, as the autopilot, `startPlanByAutopilot()`).
- `reviewDays` (1 to 30, default 7): how long after its last review a goal is looked at again when nothing else brought it up.
- `plansPerWeek` (1 to 20, default 3): plans a review may start itself in seven days; past it a plan waits for a yes as under `ask`.

Starting a plan by itself gives the autopilot no power it did not have: each step still meets the levels per area and the budgets, and
`NEVER_AUTOMATIC` calls still wait. `start_autopilot_plan` and `resume_autopilot_plan` stay never automatic as tools the model calls: a
review's plan is started by code from the owner's setting, never by the model.

### 12.2 When a goal is reviewed

`dueReviews()` reads, per store with `continues` on and the autopilot not paused, each `active` goal with a person to run it for
(`created_by`), where no plan for the goal is a draft, running or paused, and either:

- the goal was never reviewed;
- a plan for the goal finished (done or stopped) after the last review, and the last review is at least `REVIEW_GAP_HOURS` (1) old;
- the last review is older than `reviewDays`;
- the last review failed and is older than `FAILED_REVIEW_HOURS` (6).

The store must be active (`store_is_active()`), the autopilot's AI budget not spent, and the store under `REVIEWS_PER_DAY` (6) reviews in
24 hours. A plan a review made that waits for the owner's yes therefore holds its goal's reviews until it is started, revised or stopped.

### 12.3 A review

`runGoalReviews()`, from `/api/cron/autopilot` after the steps, takes up to `REVIEWS_PER_RUN` (2) due goals, at most one per store, each
claimed as a row of `commerce.autopilot_reviews` (one `running` per goal by a unique index; a run that died leaves it `failed` once its
claim passes):

- The person is read again as the loop reads a plan's (`principalFor()`): gone or not an owner any more, the review is `skipped` with the
  reason; a closed store is never taken.
- The turn is a headless `runTurn({ scheduled: true, autopilot: { review: true } })` in the goal's own conversation (`Autopilot: {goal}`,
  kept on its first review and reused), for the feature `autopilot`, limited to `make_autopilot_plan`, `list_goals`,
  `list_autopilot_plans`, `get_autopilot_plan` and the read-only tools of `REVIEW_READ_TOOLS` the person's role and the store's features
  offer. No tool that changes the store is offered, gated or not.
- Its message (`reviewMessage()`) carries the goal, its progress from `goalProgress()` (written by code), the last plans for the goal with
  their steps' results, and the last review's outcome, as data; the system lines (`REVIEW_LINES`) say nobody is there, to make at most one
  plan for this goal or say in one sentence why nothing should be done now.
- After the turn, code finds the plans made in that conversation during it: none is an outcome of *nothing to do* with the model's
  sentence; more than one keeps the last and stops the others; the plan is tied to the goal if the model left it out. Then
  `startDecision()` (pure): `starts = auto` and under `plansPerWeek` starts it, otherwise the start is kept for the owner's yes.
- The review row keeps the plan, whether it started, the outcome in words (500 characters) and is `done`; an AI error or a time-out is
  `failed` with the reason.

### 12.4 What the owner sees

Settings: *Keep working toward my goals* (one switch, Homer's), and under it the start choice, the days between reviews and the plans a
week (Lisa's). Goals: each goal's last review (when, and what came of it). Decisions: a review's plan waiting to start, as any kept call.
The activity log says the autopilot made and started the plan (`acted_by = 'autopilot'`).

### 12.5 Tests

Unit: `startDecision()` for each setting and the weekly limit; the planning settings read with defaults; `reviewMessage()` carries the
progress and plans. Integration (a stand-in turn that makes a plan through `makePlan()`): nothing with `continues` off; a review makes a
plan that starts at `auto` and waits as a kept start at `ask`; no review while the goal's plan runs; another once it is done; the weekly
limit turns a start into a kept call; a turn that makes no plan is *nothing to do*; another store's goals never touched.

## 13. Unit E (D329): web research

Written on 2026-10-26 from the owner's goal ("research online business opportunities … evaluate them against each other") and their
answers: a pluggable search setting with Brave first, on Kaizena Flow's key, metered. Until now the AI manager knew only the store's own
data and what its model remembered. Unit E gives it eyes on the web that are read as data, never as instructions, and a place to keep
what it found with where it found it. What a page says, what a search returns and how options compare are the code's to fetch, keep and
add up; the model only chooses what to look for and writes the words of a note.

### 13.1 The search service

- `SEARCH_APIS` (`src/lib/web-search.ts`) is the registry of search APIs by shape: `brave` (Brave Search's web search: one constant host,
  `X-Subscription-Token`, results' title, address, description and age). A new service is an entry there with its request and its
  reader of answers (`parse…Results()`, pure, tested on a recorded answer), never a call written elsewhere.
- `commerce.search_settings` (one row for Kaizena Flow, `store_id` null; a store's own later), written only by
  `src/server/web-search-settings.ts` (platform admins, the *Web search* card on Platform → AI): the service and its key, encrypted with
  `SETTINGS_ENCRYPTION_KEY` (`secret-box.ts`), shown only by its hint. No row or switched off: no search, and the tool says so.
- Brave is a US company: a search sends only the words the agent chose (never a customer's data, never a store's figures), and the card
  says so. A service in the EU is a later entry of the registry.

### 13.2 Metering, limits and cost

- A search is a row of `commerce.ai_usage` of kind `search` (`searches` = 1, provider the service's id, model `web-search`), recorded by
  `recordUsage()` for the store it was for, with the feature `autopilot` inside the autopilot's turns (so it counts in its budget) and
  `web_research` otherwise. Its price is `ai_model_prices.per_thousand_searches` (US dollars per thousand searches; null: unpriced, shown as
  such), kept by the platform's admin on the prices page like any other price, read only through `costMicrosSql`/`callCost()`.
- Searches on Kaizena Flow's key count in the plan's `ai_cost_month_micros` (D314) like any AI on its key: a store past its limit has no
  search, and a store with no AI on its plan has none. At most `SEARCHES_PER_DAY` (100) a store in 24 hours, and `SEARCH_RESULTS_MAX` (10)
  results a search.

### 13.3 Reading a page

`read_web_page` fetches one public address through `safeFetch()` (never a plain `fetch`: private networks refused, redirects checked,
`PAGE_MAX_BYTES` 2 MB, 15 s), HTML or plain text only, and turns it into its title and readable text (`pageText()` in
`src/lib/web-page-text.ts`, pure: scripts, styles, navigation, headers, footers and forms left out, entities decoded, at most
`PAGE_TEXT_MAX` 12,000 characters, with whether it was cut). At most `PAGES_PER_DAY` (200) a store in 24 hours. It costs no AI and is not
metered as such.

### 13.4 Sources and notes

- Every search answered and every page read is a row of `commerce.research_sources` (the store, the address, its title, `search` or
  `page`, when, and for a page a hash of its text), written only by `src/server/research.ts`; kept 90 days (`pruneResearch()`, daily).
- A note (`commerce.research_notes`, the store's, written only by `src/server/research.ts`) is a topic, a finding (up to 2,000
  characters; staff-only, never shown to customers) and its sources: each source must be an address the store
  searched or read within 30 days (`research_sources`), checked by code, so a note never cites a page nobody opened. At most 500 notes a
  store; the oldest are not removed by themselves.
- A comparison (`compare_options`) is criteria with weights (1 to 5) and options scored 1 to 5 on each, with a reason; the totals,
  percentages and ranking are worked out in code (`compareOptions()` in `src/lib/research.ts`, integer arithmetic), never by the model,
  and the comparison is kept as a note of kind `comparison` with its table.

### 13.5 Tools

`search_web`, `read_web_page`, `save_research_note`, `list_research_notes` and `compare_options`, in the store's `OWNER_TOOLS` and Kaizena
Flow's `PLATFORM_TOOLS` with the same handlers (`RESEARCH_TOOLS`), none gated (they change nothing customers see and cost the store nothing
of its own), `marketing:read` for reading and `marketing:write` for keeping notes and comparisons. A search's results and a page's text are
other people's words: the manager's prompt already says so (`UNTRUSTED_TEXT`), and the agents' eval gets a case of a page that hides an
instruction. A goal's review (D328) may search, read and list notes.

### 13.6 Tests

Unit: `parseBraveResults()` on a recorded answer and on a broken one; `pageText()` (scripts and navigation left out, entities, the cut);
`compareOptions()` (weights, ties, a missing score refused); the search price in `callCost()` and its SQL twin. Integration (a stand-in
for the search API and a local page with `REPLICATE_ALLOW_PRIVATE`): a search recorded as usage and a source; no search without settings
or past the day's limit; a page read and kept as a source; a note refused for a source never opened; a comparison kept with its totals.

## 14. Unit F (D330): brand and look

Written on 2026-10-26 from the owner's goal ("create a branding and design profile") and a read of themes as built (D60, D241, D244, A4).
Until now the agent could only choose one of Kaizena Flow's themes. Unit F lets it set the brand down in words and give the store a look of
its own. The model chooses colours, fonts and a few named styles, and writes the brand's words. Code works out every colour the theme
needs, holds each pair to the readability the theme checker asks for, and places the look as a theme the owner tries before it goes live.
Built in two steps.

### 14.1 Step F1: the brand profile

- `commerce.brand_profiles` (one row per store, and one for Kaizena Flow's own site with no store), written only by `src/server/brand.ts`:
  `tagline` (up to 120 characters), `voice` (how the brand speaks, up to 600), `audience` (who it is for, up to 400), `values` (up to five
  short words) and `avoid` (up to ten words or phrases it never uses).
- The tagline passes `findClaims()` because it may be shown to customers. The rest is guidance for the AI's own writing and is never
  shown to customers.
- Tools: `get_brand` (`website:read`) and `set_brand` (`website:write`, ungated: only staff see it), for a store and for Kaizena Flow's
  own site.
- A goal's review (D328) may read the brand.

### 14.2 Step F1: a look of the store's own

- `design_look` (store only, `website:write`, ungated: it only adds a theme to the store's library, and visitors see nothing). It takes:
  - a title, and what to start from: the live look, or one of the built-in templates (`THEME_TEMPLATES`: minimal, warm, bold);
  - the brand's accent colour, and optionally its background and text colours and the colour mode;
  - heading and body fonts from the font catalogue (`findFont()`);
  - the named choices the Design page offers: heading weight and case, button style and corners, card and field corners, content width,
    header alignment and background, product card picture and style.
- `designedTheme()` (`src/lib/brand-design.ts`, pure) lays these over the base. It works out every colour of both palettes from the few
  given:
  - surface, secondary text and lines are mixed from the background and text;
  - text on the accent is white or near black, whichever reads better;
  - the dark set is tinted with the accent;
  - each pair `themeWarnings()` checks (text, secondary text and text on the surface against their backgrounds, and text on the accent) is
    moved until it reaches 4.5:1. The main text aims for 7:1, and an accent on the dark background for 3:1.
  - So a designed look never carries a readability warning (tested over many colours).
- `addOwnLook()` (`src/server/theme-installs.ts`, the installs' one module) adds it as an install that is not live (`preset_id` null, like
  *Custom*). It keeps the live look's header, footer, product page and CSS, so only colours, fonts and styles differ. It applies the same
  checks as editing an install (`lookChangeRefusal()`, `checkStoreTheme()`, `INSTALLS_MAX`), installs the fonts first (`installFonts()`)
  and is audited as `store.theme_designed`.
- It is then tried with `try_theme`, made live with `make_theme_live` (A4: always the owner's yes, or the autopilot at the owner's
  Design level, free since it is the store's own) and checked with `look_at_store` (D310).

### 14.3 Step F2: logo and icon (F2a), the brand in the writers (F2b)

**F2a, logo and icon.** The picture model writes no words reliably, so the marks are drawn by code from the brand's name in its own font.

- `make_brand_marks` (store and Kaizena Flow's own site, `website:write`, ungated: it only adds files to the media library) makes three:
  - a wordmark logo for light backgrounds;
  - a wordmark logo for dark backgrounds;
  - a square icon (512 px, with its 64 px copy as the library thumbnail) holding the monogram: one or two initials on the accent.
- Inputs, all optional: the text (the store's name unless given, up to 40 characters), the font (the live theme's heading font unless
  given, from the catalogue; a theme on system fonts uses a default family), the weight, the logo's colour (`text` or `accent`), the icon's
  shape (circle, rounded, square) and its letters (up to two).
- The font's outlines come from Google Fonts' TrueType file (`src/server/font-outlines.ts`: the CSS asked of `fonts.googleapis.com`, the
  file fetched only from `fonts.gstatic.com`, kept in memory, the nearest weight the family has), read by `opentype.js`.
- `brand-marks.ts` (pure) writes the shapes as an SVG of paths (no text, no font, nothing but paths and a fill).
- Colours come from the live theme's palettes (D330 F1 makes them readable). The logo's colour against its background, and the
  letters against the accent, are held to 3:1, WCAG's line for graphics; where the accent does not reach it, the text colour is used.
- `sharp` renders each to PNG: the logo 192 px high (with a 96 px copy) and the icon 512 and 64 px. They are kept in the media library by
  `storePicture()` with alt texts, under the owner's storage.
- `set_header_footer` gains `icon`: a square picture of at least 256 px from the library, with its thumbnail as the small icon, put in place
  by Header and footer's own save, gated as the logos are.
- A failure says what failed (the font could not be fetched, the name has no letters the font draws) and nothing is kept.

**F2b, the brand in the writers.** The brand reaches every writer as guidance, never as facts, and its words to avoid are found by code.

- `brandGuide()` (`src/lib/brand.ts`, pure) writes the brand for a prompt: the voice, who it is written for, the values, the tagline and the
  words to avoid, each quoted as the owner's words, under a line saying it is how to write and not what is true (a value or the tagline is
  never a fact about a product). It goes below the prompt's own rules, which still stand; an empty brand adds nothing.
- `findAvoided()` finds a word or phrase to avoid as a whole word, in any case, never inside another word ("artisan" is not in
  "artisanal"). It is a finding beside the claims filter's (`kind: "avoided"`, *A word the brand avoids*).
- The page studio (`siteFacts()` reads `brandOf()`, the store's or Kaizena Flow's own): the guide follows the site's facts in the interview,
  the plan and each section's words; a section with a word to avoid is asked again with the claims, and a sentence still holding one is
  left out (`copyClaims()`, `withoutClaims()`, `copyWithoutClaims()` take the words to avoid). The AI manager's `build_page` uses the same
  facts.
- The product writer (`suggestProductText()`): the guide for new words (write, improve, search texts), never for a translation, which keeps
  the text's own tone. A suggestion holding a word to avoid is asked again once; the answer carries the words (`avoid`), so the editor's
  *Write with AI* and `write_product_texts` treat one still there as a finding (`writtenFindings(written, avoid)`): not used until it is gone.
- Broadcasts' suggestions (`suggestBroadcast()`): the guide in the instructions, a word to avoid refused as a claim is.
- The chat agent: only the voice and the words to avoid (`brandVoiceGuide()`), for tone, placed after the rules and before the owner's own
  guidance; a brand that cannot be read leaves the chat as it was. Its answers are not filtered for the words: it is tone, not copy.

### 14.4 Tests

Unit: `designedTheme()` for each template and the live look; no `themeWarnings()` for a few hundred accent and background colours; fonts
and named choices kept; brand input limits; the monogram's letters, the marks' SVG (paths only, viewBox fitted) and their colours at 3:1. Integration: `set_brand` and `get_brand` per store and for the platform, a claim in the tagline
refused; `design_look` adds an install that is not live and changes nothing visitors see; switching to it makes the designed theme the
store's; a font not in the catalogue is refused. F2a, with a stand-in font made by `opentype.js` and a stand-in for Google and Storage:
the three marks kept in the library at their sizes, a name with no letters the font draws refused, `set_header_footer`'s `icon` refusing a
picture that is not square. F2b: `findAvoided()` (whole words, any case, letters beyond ASCII), the guide (empty brand nothing, no tagline
in the chat's), each writer's instructions carrying it (not a translation's), the page studio leaving out sentences with a word to avoid,
broadcasts counting one as a claim; the product writer asking again once and returning the words that stay.

## 15. Unit G (D331): reacting to events

Written on 2026-10-26 from the rating after unit F: the autopilot works on a schedule (plans, reviews), and nothing it does is set off by
what happens in the store. Unit G adds **events**: three things that happen, each found by code, each answered by one headless turn of the
autopilot with only the tools that thing needs, within the owner's levels and budgets as every autopilot turn is. What counts as an event,
when it is answered and what the turn may touch are the code's; what to say or do inside those limits is the model's.

### 15.1 The events

| Kind | Found when | The turn may | Never |
|---|---|---|---|
| `support_waiting` | A store's conversation has waited for a person (`handler = 'queue'`, open) longer than the owner's minutes (`waitMinutes`, 5 to 240, default 15) | Read the conversation, the customer's orders and the store's facts with read-only tools; write one staff note (`add_support_note`): what it checked and a reply a person could send | Write to the customer (`reply_to_support` is not offered: an answer in a person's name must come from the person), end or take over the conversation |
| `test_ended` | An A/B test stopped by itself (`stop_reason` `guardrail` or `planned_end`) in the last 7 days and is still `stopped` | Read its results (`explain_results`) and choose with `apply_winner`, gated as ever: it runs only where the owner's level for the website allows, else it waits for their yes | Choose a version the verdict does not support; touch another test |
| `alert` | An urgent or warning alert of `alertsFor()` (the Analytics alerts), checked once a day per store; one event per alert and ISO week | Look with a goal review's read tools and make at most one plan, which starts as a review's plan does (`startDecision()`, the plans a week) | Change anything itself in the turn |

Each event is a row of `commerce.autopilot_events` (store, kind, a reference: the conversation, the test, or the alert and its week;
unique per store, kind and reference, so an event is answered once), written only by `src/server/autopilot-events.ts`. Its facts (the
conversation's id and how long it waited, the test's id, name and why it stopped, the alert's words, severity and evidence) are written
by code and given to the model as data.

### 15.2 Settings (`planning.reacts`)

`autopilot_settings.planning` gains, read only through `autonomySettingsSchema`:

- `reacts` (off by default): *React to what happens*. Off, nothing in this unit runs.
- `waitMinutes` (5 to 240, default 15): how long a customer waits for a person before the autopilot looks.

The person the turns run for is the one who last saved the settings (`autopilot_settings.updated_by`), read again before each event as a
review's person is (`principalOf()`): gone, not an owner any more, or the store not open, the event is `skipped` with the reason. The
autopilot paused, the AI budget spent or `reacts` off, nothing is claimed.

### 15.3 Finding and answering

From `/api/cron/autopilot` (every minute), after the reviews:

- `detectEvents()`: per store with `reacts` on and the autopilot not paused, inserts the waiting conversations and the tests that ended
  (one query each), and once a day (`ALERT_CHECK_HOURS`, kept in `commerce.autopilot_event_checks`) the store's alerts through
  `alertsForStore()`. Conflicts on the reference do nothing.
- `runEvents()`: takes up to `EVENTS_PER_RUN` (2) pending events, at most one per store, under `EVENTS_PER_DAY` (12) per store in 24
  hours, each claimed (`running`, `claimed_until`); a run that died leaves it `failed` once its claim passes. A pending event older than
  `EVENT_STALE_HOURS` (24) is `skipped` as stale; a support event whose conversation has been answered, taken or ended since is `skipped`
  (*a person answered*); a test event whose test was applied or discarded since is `skipped`.
- The turn is `runTurn({ scheduled: true, autopilot: { event: kind } })` in one conversation per store for events (`Autopilot: what
  happened`), for the feature `autopilot`, with the kind's tools only (`EVENT_TOOLS`), the kind's own lines (`EVENT_LINES`) and the event's
  message (`eventMessage()`). Gated calls meet `autopilotDecision()` as in a step; kept ones wait on the Decisions page.
- After the turn: an `alert` event's plan is handled as a review's (the last one kept, `startDecision()`); the event is `done` with the
  turn's last sentences as its outcome (500 characters), `failed` on an AI error or a time-out.

### 15.4 What the owner sees

Settings: *React to what happens* (one switch) and, under it, the minutes a customer waits (Lisa's). The Autopilot page: *What the
autopilot reacted to*, the last events with what came of each. The activity log says the autopilot wrote the note or applied the winner
(`acted_by = 'autopilot'`).

### 15.5 Tests

Unit: the settings read with defaults; `eventMessage()` for each kind carries its facts; `EVENT_TOOLS` holds no tool that writes to a
customer and every name is a tool. Integration (a stand-in turn): nothing with `reacts` off; a conversation waiting longer than the
minutes becomes one event, answered once with a note, and a conversation answered before its turn is skipped; a test stopped by the
guardrail becomes an event whose `apply_winner` is kept for a yes at *Ask me first* and runs at *Just do it*; an alert becomes an event
whose plan waits as a review's does; another store's events are never touched; the daily limit holds.

