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

## 8. Unit L (D311): legal pages by AI (outline)

This changes D158's rule that a legal page's words are hand-written starters and never a model's. The owner's decision (2026-10-22): a strong
agent can research and compile legal texts better than most store owners, so a store's legal pages are written and kept current by the AI,
with no person reviewing each text. What keeps them right is how they are made:

- **Sources, not memory.** A register of the official sources per country and topic (EUR-Lex for the directives and regulations, Lovdata,
  Riksdagen, Retsinformation, the consumer and data protection authorities' own pages), fetched by code through `safeFetch()`, kept with
  the day read and a hash. The model writes from the fetched text given as data, never from what it remembers (a model's memory still
  links the EU's ODR platform, repealed in 2025).
- **Citations checked word for word.** Each section names the source it rests on and quotes it; the code refuses a section whose quote is
  not in the fetched text.
- **The store's facts, checked against the store.** Every fact comes from `legalFacts()` and the store's settings, and the code checks the
  page against them: the return window and who pays return shipping as `return_settings` say, the withdrawal period never under 14 days,
  the seller's name, number and address as the store's details, the carriers and tracking tools the store uses, no `[[placeholder]]` left.
- **Every topic, every language.** `REQUIRED_TOPICS` and `CONDITIONAL_TOPICS` are checked as they are for the starters, in each of the
  store's languages; words pass the claims filter (no promise the store has not made).
- **Kept current.** Sources are fetched again on a schedule; a changed source or a changed store fact (a new country, a new carrier, a new
  tracking tool, another return window) writes the affected pages again, published at the owner's level for legal pages, with the reason
  in the report. Every version is kept (`page_versions`, and `legal_snapshots` for what a buyer accepted), with its sources and the model.
- **The owner's part** is one choice when they turn it on, said plainly once: the AI writes and keeps the store's legal pages, and as the
  seller the store stays responsible for them. The hand-written starters stay as the fallback when there is no model or a source cannot be
  read. Kaizena Flow may have a lawyer read the generator's rules and the source register once per country (recommended, not a gate).

The consumer texts that are part of the product itself (the withdrawal function, emails, the checkout's words, `HAND_WRITTEN_ONLY`) are not
in this unit and stay as they are until a later decision.

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
