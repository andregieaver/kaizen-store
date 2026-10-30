# Rules: Storefront

Moved verbatim from CLAUDE.md on 30 October 2026 (consolidation 7), so the rulebook every session loads stays short. CLAUDE.md keeps one
line per rule pointing here; each rule below is as it was, under that line as its heading. Read the rule of the part you change before
changing it; a rule changes here, and its line in CLAUDE.md when its gist changes.

## Kaizen is multi-tenant (`docs/platform.md`)

- Kaizen is multi-tenant (`docs/platform.md`). `/` is the platform's home
  page, and Kaizen's own pages (D42) live at `/{page}`; each store lives at `/s/{store}`, a country chooser that suggests but
  never redirects (unless the store has one market), and `/s/{store}/{market}`
  (`no`, `se`, `dk`, …), each market its own root layout with its own
  `<html lang>`. With `NEXT_PUBLIC_STORE_DOMAIN` set (P7), stores are at
  `{store}.{domain}` on a domain of their own, routed by `src/lib/store-hosts.ts`
  in `next.config.ts`, and `/s/{store}/…` redirects there. Build links with
  `src/lib/paths.ts`, never by hand: `marketPath()` / `storeBase()` inside a
  store (empty base on its own host; `storeHome()` where a URL can't be
  empty), `storeHref()` to a store from the admin or Kaizen's pages, and
  `storeSiteUrl()` for full addresses (emails, Stripe, search engines).
  A store's primary domain of its own (P8, `src/server/domains.ts`) is read
  from the database when building, so routing and `storeOrigin()` follow
  it; a change to domains deploys again. A language may have a domain of its
  own, as an option (D313, `docs/language-domains.md`: `store_domains.language`,
  `setDomainLanguage()`), where its addresses leave the language out and the
  proxy reads it from the host (`languageHostDecision()`); so a full address is
  always `marketUrl()` (`marketOrigin()`), a page's metadata address
  `marketMetaPath()`, a link to another market `marketLink()`, never `storeSiteUrl() + marketPath()`. A store that sells in one country
  has no country in its addresses (D181, `docs/marketless-addresses.md`,
  `src/lib/store-address.ts`): `/s/{store}/home`, `/en/home`; the proxy
  rewrites them to the unchanged `[market]` routes and moves the long ones
  (308) both ways, and `marketPath()` makes them short from `store.address`,
  so never build a store link by hand, and use `marketHome()` where an
  address cannot be empty.

## Stores and their markets come from the database (`getStore()`, cached per store; `resolveShop()` for URL params)

- Stores and their markets come from the database (`getStore()`, cached per
  store; `resolveShop()` for URL params). Every catalogue, cart and settings
  query takes a store id; never query a store-owned table without it.

## Interface text lives in `src/lib/i18n.ts` (each hand-written language in `src/lib/messages/{lang}.ts`, D212: a visitor's client component reads…

- Interface text lives in `src/lib/i18n.ts` (each hand-written language in
  `src/lib/messages/{lang}.ts`, D212: a visitor's client component reads
  `browserText()` (`{lang}-browser.ts`, so a text it uses goes there in every
  language) or the withdrawal flow's `returnsText()`, never `t()`) and
  `src/lib/email-text.ts`, by language, with English as the fallback. Legal texts do not: they need
  human review. Norwegian, Swedish, Danish and English are written by hand;
  other languages are translated by AI into `commerce.ui_translations` from the
  catalogue of the English messages (D111: `src/lib/ui-catalog.ts`, templates in
  `src/lib/icu-lite.ts`) and read into `t()`/`emailText()` key by key. A new
  English message needs nothing more, except one that chooses by a number or a
  yes/no, which goes in `CHOOSING` with a case in `ui-catalog.test.ts`; a
  placeholder in a plain text is `{name}` only. The languages stores can offer
  are `commerce.platform_languages` (`/admin/platform/languages`), never a
  list in code; never read the texts from the database while rendering (they
  are in memory, `src/server/ui-text.ts`).

## Language and currency are apart from the country (D109; offered only while Several languages and Several currencies are on, D178 step 4)

- Language and currency are apart from the country (D109; offered only while Several languages and Several currencies are on, D178 step 4): a market address is
  `{country}[-{lang}][-{currency}]` (`no`, `no-en`, `no-eur`, `no-en-eur`,
  `src/lib/market-slug.ts`), and `Market` is the country as shown: `currency`
  and `locale` are what the shopper sees, `nativeCurrency` and `ownLocale` what
  the country keeps. A store's languages and currencies are
  `store.localization` (`stores.locales`, `store_currencies`, edited at
  `/admin/{store}/settings/localization`), never `store.markets.map(m =>
  m.locale)`. Amounts are stored in the country's own currency and converted
  when read: use `shown(market, minor)` (and `convertedSql()` in queries),
  never a stored amount as it is, and write anything to the database (a
  subscription, a delivery) in `nativeCurrency`. Build links with
  `marketPath()`, which keeps the view. A new money read needs a euro scenario
  in `checkout-kinds.int.test.ts`. Page translations can be written by AI from
  the builder's sidebar (`src/lib/page-translate-ai.ts`); it only suggests, and
  every answer is checked (shape, length, `findClaims()`).
  A whole store is translated from `/admin/{store}/translate` (D110,
  `src/lib/store-translate.ts`, `src/server/store-translate.ts`): suggestions
  are read and ticked by a person before `applyTranslations()` writes them;
  pages are only saved as drafts, and legal texts (`isLegalPage()`, a product's
  safety information) start unticked. Never fall back to a currency of your own
  (`mainCurrency(store)`), and a new translatable text is added to that module's
  worklist as well as to the editor.

## Catalogue reads in `src/server/catalog.ts` are cached (`'use cache'`, tag `catalog` and `catalog:{storeId}`); stock is read per request inside…

- Catalogue reads in `src/server/catalog.ts` are cached (`'use cache'`, tag
  `catalog` and `catalog:{storeId}`); stock is read per request inside
  `<Suspense>`.

## Search (D72, `src/server/search.ts`, pure parts in `src/lib/search.ts`)

- Search (D72, `src/server/search.ts`, pure parts in `src/lib/search.ts`):
  keyword search in Postgres, no AI: `product_translations.search` (a
  generated tsvector, stemmed per locale by `commerce.search_config()`) and
  trigram indexes (`pg_trgm` lives in the `extensions` schema, so call
  `extensions.word_similarity()` and use `extensions.gin_trgm_ops`). The
  search page is `/s/{store}/{market}/search`, type-ahead goes through
  `suggestAction` (keyword only, never a model call), and page searches are
  logged in `search_queries` for 90 days. AI search parts (Phase 2, S2–S5)
  must fall back to this when their model is unavailable. Search by meaning
  (D74): product translations' vectors are in `product_embeddings` (pgvector
  in `extensions`: write `extensions.vector` and `OPERATOR(extensions.<=>)`;
  the table is SQL only, outside the Drizzle schema), kept current by
  `refreshEmbeddings()` in the five-minute cron and `refreshStoreEmbeddings()`
  after a product is saved; `rankedSearch()` merges keyword and meaning by
  reciprocal rank fusion, and only compares vectors of the same `space`.
  Query understanding (D75, `src/lib/query-understanding.ts`,
  `src/server/query-understanding.ts`): the text model turns a search into
  `SearchFilters`, always through `cleanFilters()` (the store's own slugs,
  only categories and tags the search names (`namesTerm()`), words the
  shopper typed with the thing wanted kept, prices to minor units in code), applied by
  `filterClause()`; the model never names products or prices. Change the
  prompt or filters together with the eval (`src/lib/query-eval.ts`) and
  run it from the AI pages.
  A search's vector and filters are kept in `commerce.search_cache`
  (`cached()` in `src/server/search-cache.ts`, keyed by everything the
  answer depends on, 30 days), not in `'use cache'`, whose memory is per
  server instance.
  The search test (D77, `src/server/search-experiment.ts`): while one runs,
  the search page draws each search's arm (`drawArm()`), the keyword arm
  passes no `vectorFor` or `understand`, and result links go through
  `search/go`, which records the opened result (`search_clicks`). Set no
  cookie or storage for it: the unit is the search.

## Search merchandising (wave 6 unit F, D324, `docs/wave-6-catalogue.md` Unit F)

- Search merchandising (wave 6 unit F, D324, `docs/wave-6-catalogue.md` Unit F): a store's synonyms are `commerce.search_synonyms`
  (per language, `both` or `one_way`), written only by `src/server/search-synonyms.ts` and read per search by `synonymsFor()`; a search's
  alternatives are only `expandQuery()`, OR'd into keyword search and passed to query understanding as `aliases` (in its cache key). Pins,
  boosts, buries and search redirects are `commerce.search_rules`, written only by `src/server/search-rules.ts`; the order is only
  `merchandise()` in `searchProducts()` (the search's own order only; a pinned product the search missed only without filters, through
  `listGridProducts()`), a category's or tag's products through `termFacts()` (`inTerms()`), and a redirect only `searchRedirect()` in the
  search section, logged by `logRedirectedSearch()`: a reader that counts searches that found nothing leaves `redirected` out. The AI
  manager's `search_merchandising` reads them and `save_search_synonym`, `save_search_rule`, `delete_search_merchandising` (gate `public`,
  `preflightSearchTool()`) go through the same writers. Both tables are copied with a store (products and terms mapped).

## Videos and 3D in the product gallery (wave 6 unit G, D325, `docs/wave-6-catalogue.md` Unit G, `src/lib/product-media.ts`)

- **Videos and 3D in the product gallery (wave 6 unit G, D325, `docs/wave-6-catalogue.md` Unit G, `src/lib/product-media.ts`)**: a
  `product_media` item is a `kind` (`image`, `video`, `model`) with a video's `source` (`upload`, `youtube`, `vimeo`) and `media_url`, while
  `url`/`thumbnail_url` stay every item's picture (a video's or model's poster), so a reader of a product's picture never asks the kind; a writer
  of a plain picture uses `pictureItem()`. Limits are `mediaProblems()` (20 items, 5 videos, 3 models) and a file is the store's own only by
  `ownMediaFile()` (videos in `page-videos`, GLB models in `product-models`, `startModelUpload()`/`registerModel()`), both enforced by
  `saveProduct()`; a new place that keeps an item's file goes in `mediaUses()`, `rewriteAddresses()` and the store copy's files. The product
  page never plays a video by itself, loads YouTube or Vimeo only on a press and `<model-viewer>` only on *View in 3D* (a dynamic import,
  never in the first scripts). An item's words in other languages are `alts`, in the translation worklist as `media.{n}`.

## Content types (wave 6 unit H, D326, `docs/wave-6-catalogue.md` Unit H)

- **Content types (wave 6 unit H, D326, `docs/wave-6-catalogue.md` Unit H)**: an owner's own kinds of content (`commerce.content_types`, a
  fixed `key`, a web name, fields from `FIELD_TYPES`, title, summary and picture fields, `has_pages`, an `entry_layout` page) and their
  entries (`commerce.content_entries`, a draft and a published `EntryContent`), a store's (Website → Content) or Kaizena Flow's own (`store_id`
  null, `/admin/platform/content`, no money or file field); every query asks `store_id is not distinct from`. Types are written only by
  `src/server/content-types.ts` and entries only by `src/server/content-entries.ts`, values checked and drawn by the custom fields' own
  functions (`typeAsGroup()`); the screens are the shared views of `components/admin/content-views.tsx` given a `ContentSite`. The field type
  `entry` holds the owner's own entries of one type (`keepOwnRelations()`), drawn as a link while published (`entryTargets()`), and deleting
  an entry clears every reference in its transaction (`clearEntryRefs()`, `withoutEntry()`). A grid's `entries` source is `gridEntries()`; a
  type with pages serves `/{type}/{entry}` where no page has the address (`findEntryPage()`: a store's `EntryPageView` with its layout bound by
  `shownEntryFields()`, Kaizena Flow's `PlatformEntryView` in `/` and `/no/`), in the sitemap (`listIndexedEntries()`), leaving a redirect of
  kind `entry` when a published entry's address changes (stores only). Entries are in `mediaUses()`/`rewriteAddresses()`, the store copy,
  the translation worklist (scope `content`) and the AI manager's tools (`src/server/content-tools.ts`: publishing and type changes gated
  `public`). A new reader of a type's entries reads `published` only.

## A standard product taxonomy (wave 6 unit I, D327, `docs/wave-6-catalogue.md` Unit I)

- **A standard product taxonomy (wave 6 unit I, D327, `docs/wave-6-catalogue.md` Unit I)**: Shopify's open Standard Product Taxonomy
  (release `v2026-10`, MIT, its notice kept) is files in `src/data/product-taxonomy/` (made by `scripts/product-taxonomy.mjs`), read on the
  server only by `src/server/product-taxonomy.ts` (`taxonomy()`, `taxonomyWords()`, never an import: traced into every route by
  `outputFileTracingIncludes`), the rules pure in `src/lib/product-taxonomy.ts`. A product's `standard_category` (an id) and
  `standard_attributes` (`{attributeId: [valueIds]}`) are apart from its own categories and the tax code, checked by `standardProblems()` in
  `saveProduct()` and kept by a save that leaves them out; copies carry them. Listings filter by `t.<attribute>=<value>` (handles,
  `attributeFilters()`), feeds take Google's category and colour, material and pattern from them, the structured data its path, the CSV
  Shopify's `Product Category`. A model only suggests (`categoryCandidates()` by code, `readCategoryChoice()` keeps a listed id, feature
  `product_taxonomy`), staff accept; the AI manager names a category by id or English path and attributes by name, resolved by code. A new
  release that moves or retires an id comes with a migration mapping products' ids.

## Speed (wave 7 unit B, D336, `docs/analytics.md` Speed, `src/lib/picture-sizes.ts`, `src/lib/speed.ts`, `src/server/analytics-speed.ts`)

- **Speed (wave 7 unit B, D336, `docs/analytics.md` Speed, `src/lib/picture-sizes.ts`, `src/lib/speed.ts`, `src/server/analytics-speed.ts`)**: a
  library picture is drawn with both its files by width through `SizedPicture` (`pictureSources()`, `sizes` from `gridSizes()` or
  `fixedSizes()`), so a new place that draws a product's or a page's picture passes the small copy and its sizes; a picture with one file is
  drawn as before. Speed is measured only by `SpeedBeacon` (inside `OffPayRoutes`, while the store counts visits, never with GPC or Do Not
  Track, no cookie or identifier) and kept only by `recordSpeed()` in `commerce.speed_samples` as the page's kind (`speedKind()`) and the
  screen; every figure is `speedRows()` (75th percentile, `MIN_SPEED_SAMPLES`, Google's `SPEED_THRESHOLDS`), never stored, and one with too
  few page loads says how many there are. The page, the CSV `speed.figures` and the AI manager's `speed_report` read `speedReport()`. CI's
  budgets are `SPEED_BUDGETS` in `e2e/performance.spec.ts`: a change past one is a regression to look at, not a number to raise. Kaizena Flow's own
  site and the admin are measured the same way (D390: `SpeedBeacon own`, `src/server/own-speed.ts`, the only writer of `own_speed_samples`,
  shown on Platform → Usage and limits).

## Each country's own (wave 7 unit D, D338, `docs/wave-7-storefront.md` D)

- **Each country's own (wave 7 unit D, D338, `docs/wave-7-storefront.md` D)**: a store's page or article is for the countries in
  `PageContent.markets` (none: every country), asked only through `pageInMarket()` (the routes, `hreflang`, the sitemap, llms.txt, content
  grids), so a new place that lists or draws a store's pages asks it too. A product's description for one country is `product_market_texts`,
  written only by `saveProduct()` (`countryTexts`, left out = kept) and read by `getProduct()`; the title stays the language's everywhere. A menu
  label for one country is the label key `{locale}@{COUNTRY}`, read only by `menuLabel()` given the market's country and kept by `cleanLabels()`.
  A country's own domain is `store_domains.market` (written only by `setDomainCountry()`; never with language domains, never the primary):
  `countryHostDecision()` routes it before `languageHostDecision()`, and `marketHost()`/`marketPath()` write a market on it without its country,
  so full addresses still come only from `marketUrl()` and `marketMetaPath()`. The country suggestion is `CountryHintSection` (per request in its
  `<Suspense>`, off the pay routes, never a crawler, never a redirect, dismissal in memory only).

## Private mode (wave 7 unit E, D339, `docs/wave-7-storefront.md` E)

- **Private mode (wave 7 unit E, D339, `docs/wave-7-storefront.md` E)**: whether a store is private is `stores.private_mode` (its password a scrypt hash
  in `private_password`, its `private_version`), written only by `src/server/private-mode.ts` (audited); a store template or demo store never is.
  The proxy serves a private store's pages to a visitor without the unlock pass (`kaizen_unlock_{storeId}`, `src/lib/unlock-pass.ts`, checked by
  `unlocks()`) from its landing page (`privateGate()` over `privateDecision()`, the page role `private` at `/s/{store}/private/{market}` under a
  layout of its own): a new path a buyer reaches after the sale goes in `PRIVATE_OPEN_SEGMENTS`, and a new route a visitor reaches outside the
  pages (the proxy never sees `/api`) asks `lockedOut()`. A private store is never `indexable` and its robots.txt shuts everything. A new store
  is private until `completeSetup()` opens it; the test databases start stores public, so a test of it switches it on.

## What is sold where (wave 7 unit A1, D335, `docs/wave-7-storefront.md` A.1)

- **What is sold where (wave 7 unit A1, D335, `docs/wave-7-storefront.md` A.1)**: a product or a variant is switched off in one market by a row
  of `commerce.market_availability` (no variant: the whole product), its price kept; written only by `saveProduct()` (`writeAvailability()`,
  `ProductInput.availability`, left out = kept, only the countries the editor shows replaced). `commerce.current_prices` leaves out a variant
  that is off in its market (and a bundle with such a component), so every shopper-facing read, the cart and `placeOrder()` treat it as not sold
  there; the admin's own price reads use `commerce.kept_prices` (every current price). Who may read `commerce.prices` or `kept_prices` is
  `price-readers.scan.test.ts`: a new reader that decides what a shopper is sold reads `current_prices`. The CSV's `not_sold_in` and the AI
  manager's `not_sold_in` go through the same save.

## Producer responsibility (wave 7 unit H, D342, `docs/wave-7-storefront.md` H as built)

- **Producer responsibility (wave 7 unit H, D342, `docs/wave-7-storefront.md` H as built)**: a store's registrations per scheme
  (`PRODUCER_SCHEMES`, a product's `product_schemes`) and country, or an exemption in the owner's words, are `commerce.producer_registrations`,
  written only by `src/server/producer-registrations.ts` (Settings → Producer responsibility, `settings:*`; the AI manager's
  `save_producer_registration`, gate `public`, never automatic) after `checkRegistration()`, never copied. Whether a product is sold in a country
  for want of one is only the database's `commerce.registration_blocks()` (the gaps of `registration_gaps()` the store is on record for: a
  registration covers its last day on the store's own day, so sales stop the next; nothing recorded blocks too, the owner's decision of
  27 October 2026, so new products tick no scheme by default; a store template or demo store never blocks), read for a line by `commerce.line_unregistered()` in `getCart()` (status
  `unregistered`), `sellableQuantity()` and `placeOrder()` (problem `unregistered`), and by `blockedSchemes()` on the product page; never decide it
  again elsewhere, and a new way to put goods in a cart or an order asks it too (with a euro scenario). The numbers shown on product pages are
  the registrations with `show_number` valid today (`shownRegistrationNumbers()`, the safety part); shopper words are `m.producer`
  (`HAND_WRITTEN_ONLY`, for legal review). The invoice does not carry the number yet.

## Customs and duties (wave 7 unit I, D343, `docs/wave-7-storefront.md` I as built)

- **Customs and duties (wave 7 unit I, D343, `docs/wave-7-storefront.md` I as built)**: duty rates are the platform's own table
  (`commerce.duty_rates`: per destination country or `EU` and HS heading prefix, a rate in basis points, an origin's preference, a base row's
  duty and VAT-at-sale thresholds per consignment or item, a fixed amount per sub-heading, the import VAT rate where it differs, dates, `applies_to`
  a VAT scheme (IOSS, VOEC) or not, the source address, `verified`), written only by `src/server/duty-rates.ts` (platform admins, audited,
  `/admin/platform/duty-rates`); never add a rate without the address it was read from. The estimate is only `dutyEstimate()` (`src/lib/duties.ts`,
  BigInt, half up per line; a line without an HS code, a heading with no rate or an amount with no rate gives no estimate and its reason, never
  zero; no estimate where nothing crosses a customs border) through `loadCustomsFacts()`/`decideCustoms()` (`src/server/customs.ts`), which
  `cartSummary()` and `placeOrder()` both call on the tax decision's lines and shipping. A store's choice per country is `commerce.customs_settings`
  (DAP, no row, by default; DDP collects at checkout), written only by `saveCustomsSetting()` (Settings → Duties and import VAT, `settings:*`),
  never copied. What DDP collects is `orders.duties_minor`, OUTSIDE `total_minor` (so the invoice, VAT reports and every sales figure are
  untouched): the payment is the total plus it (`PlacedOrder.dutiesMinor` in `dueNowMinor`, a Stripe line of its own, no sale fee on it, never paid
  by a gift card); a subscription, a host's listing, a venue part or payment terms fall back to DAP; DDP with no estimate is refused (`customs`).
  The order keeps `orders.customs` (`OrderCustoms`: who pays, the estimate, its sources), shown on the order page and the confirmation by
  `orderCustomsSentence()`. Shopper words are `src/lib/customs-text.ts` (hand-written nb, sv, da, en, for legal review, never in the AI catalogue).
  A carrier's `book()` asks `bookingCustomsProblem()` first and refuses a parcel across a customs border without its lines (`BookingRequest.customs`,
  `bookingCustomsFor()`); Bring then declares them to its Customs API (`customsDeclarationBody()`), a refusal said and the booking kept. A new money
  read here needs a euro case in `checkout-kinds.int.test.ts`.

## Prices worked out per country (wave 7 unit A2, D335, `docs/wave-7-storefront.md` A.2)

- **Prices worked out per country (wave 7 unit A2, D335, `docs/wave-7-storefront.md` A.2)**: a market may take its prices from another of the
  store's by a rule (`commerce.market_price_rules`: base, percentage, `net` or `gross`, rounding step, ending; never chained, by trigger and
  `ruleProblem()`), worked out only by `derivedPrice()` (`src/lib/market-prices.ts`, BigInt) and written only by `src/server/market-prices.ts`
  through `commerce.set_price` with `prices.derived` (the only change the price history guard allows on an open row); a price typed by hand is
  fixed and never touched, an empty one follows the rule, gift cards and computed bundles are left alone; a rule between currencies needs
  both rates (`rateProblem()`), and a missing rate never ends its prices. Prices derive again in
  `saveProduct()`'s transaction (`deriveForProducts()`), on a rule's save, on a currency save and after the ECB's rates, each change logged
  (a product's in its save's entries, a batch as one entry); taking a rule away keeps its prices, fixed. A new writer of base prices or rates
  calls `deriveForProducts()`; a new caller of `set_price` is in `price-audit-scan.test.ts`. The AI manager's `market_price_rules` and the
  gated `set_market_price_rule` (never automatic) go through the same saver.

## Blogs in depth (wave 7 unit G, D341, `docs/wave-7-storefront.md` G)

- **Blogs in depth (wave 7 unit G, D341, `docs/wave-7-storefront.md` G)**: a store's blogs are `commerce.blogs` (the first, `main`, at `/blog`,
  made for every store by `stores_first_blog()`; others at `/blogs/{handle}`), its authors `commerce.blog_authors`, both written only by
  `src/server/blogs.ts` and read cached under `pagesTag(store)`. An article's blog and author are its content's `blogId`/`authorId` (kept by
  `savePage()` only when the store's own; none, or a blog gone, is the first blog's: ask `blogOfArticle()`); its address is only
  `articlePath()` (`blogPath()`, `feedPath()` in `src/lib/blogs.ts`), and an article asked for under another blog's address moves there
  (308), so a new place that links an article in its own blog asks `articlePath()` (an old `/blog/{slug}` link still arrives). Each blog's
  Atom feed is `{blog}/feed.atom`, only `blogFeed()` over `atomFeed()` (`src/lib/atom.ts`), linked in the page head (`feedAlternate()`).
  Comments are `commerce.blog_comments`, written only by `src/server/blog-comments.ts`: posted to `/api/blog/comments` (same site, no
  cookie or storage, counted per visitor under a keyed hash of the address in `chat_usage`, never the address), checked by `spamReasons()`
  and kept only as `commentOutcome()` says for the blog's `comments` setting (`moderated` by default, `automatic`, `off`); only `approved`
  ones are drawn (`approvedComments()`, `commentsTag()`), as plain text, and a visitor's words never reach a model (the AI manager's
  `blog_comments` gives ids and facts; `moderate_blog_comment` is never automatic). They are personal data (export `comments`, erasure,
  retention `blog_comments`). A page's or article's draft published at a set time is `commerce.page_schedules` (the start of D340's model),
  written only by `src/server/page-schedules.ts` and run only by `runSchedules()` in the five-minute dispatcher through `savePage()`, in the
  maker's name read again, never for a store that is not open or a page in a running A/B test; times are the store's clock
  (`scheduleInstant()`). F adds a way back and the other kinds to this table and module, never a second scheduler.

## Themes from outside (wave 7 unit J, D344, `docs/wave-7-storefront.md` J)

- **Themes from outside (wave 7 unit J, D344, `docs/wave-7-storefront.md` J)**: a store's live look is sent as a theme (or as the next version of
  a theme the sender is the author of) only through `src/server/theme-submissions.ts` (`submitTheme()`, `submitThemeUpdate()`; `website:write`, a real
  open store, the look by `takeSnapshot()` kept with the row, never its words or products), the only writer of `commerce.theme_submissions` and of a
  theme's `author_id`/`author_name`; the database moves a submission only forward. Kaizena Flow's admins review it at Themes → Submissions:
  `reviewSubmission()` makes a draft theme (`createDesign()`'s `look` origin, or `writeDesignLook()` for an update), `approveSubmission()` publishes
  only through `publishDesign()`, `rejectSubmission()` needs a reason the author reads. A theme from outside is free (`theme_prices_author_free()`),
  names its author on its page with the stores using it (`themeStorePage()`), and a new install waits for the owner's Update (`follows_updates`
  off by default, decision 4); a new way to bring a theme in goes through the same module. A submission may carry the store's published pages (D388, `src/server/submission-content.ts`: `pagesToSubmit()` copies them as a template when sent, never a page chosen for a place; the review's `makeSubmittedContent()` places them in a store template of their own; `adoptSubmittedContent()` makes it the theme's content only on approval), so a new kind of thing a submission sends is copied by `sanitizeTemplate()` there and never carries products, customers, recipients or secrets.

## By the clock, and links to share (wave 7 unit F, D340, `docs/wave-7-storefront.md` F as built)

- **By the clock, and links to share (wave 7 unit F, D340, `docs/wave-7-storefront.md` F as built)**: a page's, article's, header's or
  footer's draft is published at a time and, with `revert_at`, the published content from before (`before_content`, none: taken off the
  site) put back at another, both legs of `commerce.page_schedules` (written only by `src/server/page-schedules.ts`); an installed theme
  made live at a time and the theme before put back is `commerce.theme_schedules` (written only by `src/server/theme-schedules.ts`, through
  `switchToInstall()`). Both run only in `runSchedules()` (the five-minute dispatcher), in the maker's name read again, never for a store
  that is not open or a page in a running A/B test; each leg is settled once by its rules trigger, a way back touches only a page or look
  still as the schedule left it (`published_hash`, the live install) and fails with the reason otherwise, a publish whose way-back time
  passed first fails (`expired`), and a schedule never spends money (a premium theme not owned is refused, `themeScheduleProblem()`).
  Times are `scheduleInstant()`/`revertInstant()` on the store's clock; what waits or failed is drawn only by `scheduleChip()` in the lists
  and the theme library; a new kind of thing scheduled joins these modules and `runSchedules()`. A preview link is `commerce.preview_links`
  (written only by `src/server/preview-links.ts`, a token read only by `previewLinkOf()`): the token (`newPreviewToken()`, server only in
  `src/lib/preview-token.ts`) is shown once and kept as its SHA-256, 1 to 30 days, revoked once, for a page's or article's draft or an
  installed theme of the same store; `/admin/account/share/{token}` draws the draft per request (`getPageForEdit()`, `PageDrawing`) or the
  theme on the store's pages (`InstallPreviewView`, shared with the signed-in preview), `noindex`, `referrer: no-referrer`, no cookie,
  never the published page or a cache of it; it is made from the builder's *Share* and a theme's page (`ShareLinks`), never by a model
  (no tool: a token is a key). The live look's saves (`saveStoreTheme()`: Design settings, the Theme tab, saved colours) each keep the
  theme in `commerce.look_versions` in the same transaction, only through `keepLookVersion()` (never changed, the newest 50), taken back
  only into the theme editor as unsaved changes (`LookVersionsDialog`, the editor's `load()`). The words are the `schedules` catalogue; the
  AI manager has `list_scheduled_changes` and the gated `schedule_site_change`. All three tables are `never` in `COPY_RULES`.

## Sorting and filtering listings (D78, `src/lib/listing-filters.ts`, `src/server/listing.ts`, `FilterDialog`, `ProductListing`)

- Sorting and filtering listings (D78, `src/lib/listing-filters.ts`,
  `src/server/listing.ts`, `FilterDialog`, `ProductListing`): the products
  page, category and tag pages and search results take their filters from
  the address (`parseListingParams()`/`listingQuery()`), applied by
  `listingProducts()`; the dialog offers `listingFacets()` (kinds,
  categories, tags, variant options, price range). Prices compare as shown
  (`shownPrice()`: without VAT for businesses). Listing pages keep their
  unfiltered grid prerendered as the `<Suspense>` fallback. Conditions shared
  with search's filters live in `src/server/product-conditions.ts`.

## A model that sees pictures (D163, `src/lib/ai-vision.ts`, `src/server/ai-vision.ts`, `ai_providers.vision_model`, the *Model that sees pictures*…

- A model that sees pictures (D163, `src/lib/ai-vision.ts`, `src/server/ai-vision.ts`, `ai_providers.vision_model`, the *Model that sees pictures* field of both AI settings pages): anything that sends a picture to a model calls `seeing(connection)` first (the vision model, else the text model, else null: do not send a picture then) and never `connection.textModel` directly, so searches can stay on a quick text model; a model's name is never assumed to see, only *Check that it sees pictures* (`checkVisionFor()`, a random two-band picture and a colour question, one in twelve guesses right) shows it, and `visionModels` in `AI_PROVIDERS` only suggests. A new feature that sends pictures says so in its failure text and links to `/settings/ai#vision`.

## AI providers (D73, `src/server/ai.ts`, `src/lib/ai-provider.ts`)

- AI providers (D73, `src/server/ai.ts`, `src/lib/ai-provider.ts`): never
  name a provider or model in code. Kaizen's are set at `/admin/platform/ai`,
  a store owner's own at `/admin/{store}/settings/ai` (`commerce.ai_providers`;
  a store's row replaces Kaizen's while on). Get the connection with
  `aiFor(storeId)` (null: no AI) and call `embedTexts()` / `completeText()`,
  an OpenAI-compatible API; catch `AiError` and carry on without AI. Keep
  vectors with their `space`, so a new model never compares with an old one.

## AI product texts (D76, `src/lib/product-writing.ts`, `src/server/product-writer.ts`, `AiWriter`)

- AI product texts (D76, `src/lib/product-writing.ts`, `src/server/product-writer.ts`,
  `AiWriter`): suggestions only, shown in the editor for staff to edit and copy
  in; never write AI text to a product directly. The model gets the product's
  own words and never prices or stock. AI copy passes the claims filter
  (`findClaims()` in `src/lib/claims.ts`: generic green claims, urgency, best
  price, money, stock) before it can be used; new AI copy anywhere goes
  through it too.

## The chat agent (D81, `src/lib/chat.ts`, `src/server/chat-agent.ts`, `src/server/knowledge.ts`, `ChatWidget`)

- The chat agent (D81, `src/lib/chat.ts`, `src/server/chat-agent.ts`,
  `src/server/knowledge.ts`, `ChatWidget`): Kaizen's and each store's
  (`commerce.chat_agents`, edited at `/admin/{store}/chat` and
  `/admin/platform/chat`), shown by `StoreChat`/`KaizenChat` in the layouts
  while on and the site's AI has a text model (`chatWidgetFor()`, tagged
  `chatTag()` and `AI_TAG`). `runChat()` gives the model the rules
  (`systemPrompt()`: only the site, facts only from tools) and the site's
  own reads as tools (`storeTools()`/`kaizenTools()`); a new tool answers
  from Kaizen's own data, never the model's. `navigate` only opens the
  site's existing pages, built with `marketPath()`. Answers pass
  `cleanReply()`; products are cards drawn by the widget with `VatAmount`.
  The picture's frame (D233: fill, border, shadow; `chat_agents.avatar_style`) is read only
  through `cleanAvatarStyle()` and drawn only by `avatarFrameStyle()` (`src/lib/chat-avatar.ts`, no zod).
  Knowledge is `knowledge_chunks` (SQL only, like `product_embeddings`):
  documents cut on save, published pages and articles by
  `syncPageKnowledge()` in the five-minute cron, vectors by
  `embedKnowledge()`; `searchKnowledge()` merges keyword and meaning.
  Voice is push to talk (`/api/chat/voice`: `transcribeAudio()`, then the
  same answer, then `speakText()`), with the provider's voice models.
  `/api/chat` routes refuse other sites and count turns (`takeTurn()`)
  before any model call. Conversations are kept by the site (D216, below):
  the tab holds only its conversation's reference and a copy
  (`kaizen_chat` v2), and sends only the new message.

## Support (D216, `docs/support.md`, built in steps; §11 says what each step found)

- **Support (D216, `docs/support.md`, built in steps; §11 says what each step
  found)**: a desk is a store's or Kaizen's (`store_id` null) with a `mode`
  (`off`, `ai_first`, `people`; made with `off` on its first conversation by
  `ensureDesk()`). Messages are written only by `commerce.support_add_message()`
  and a conversation's state only by `commerce.support_transition()` (the
  database's copy of `nextState()` in `src/lib/support-state.ts`; triggers refuse
  any other writer), through `addMessage()`/`transition()` in
  `src/server/support.ts`; a `Desk` comes only from `src/server/support-desk.ts`
  (`visitorDesk()` for the chat routes, `systemDesk()` for jobs). The chat's
  routes (`/api/chat`, `/feed`, `/end`, `/voice`) share `support-route.ts`; a
  visitor's conversation is found only by its token's hash on its own site
  (`visitorConversation()`), and the visitor never sees a note or the partner's
  help (`visitorFeed()`). The AI's history comes from the database
  (`runSupportTurn()`). Staff read conversations in the inbox at three levels
  (`/admin/{store}/support`, the owner's `/admin/account/support`, the platform's
  `/admin/platform/support`; `src/components/admin/support/`, one set of
  components given a `SupportDeskContext`), through `staffList()`,
  `staffConversation()` and the GET feeds in `src/server/support-inbox.ts`; a
  store's files ask `support:read`/`support:write` themselves and make the desk
  with `memberDesk()`, the owner's level only the stores `ownerDesks()` gives
  (where the role holds `support:read`), the platform's only Kaizen's desk
  (`kaizenDesk()`). Transcripts go after the desk's period (support off: a
  day after the end) and anonymised records after 24 months (`runRetention()`);
  the export's `support` section and the erasure (`anonymiseConversations()`)
  include them. In mode `people` the AI never writes to a customer; the silent
  partner reads with the agent's own permissions through read-only owner
  tools, never acts and never writes to the customer; platform admins never
  read a store's conversations; tone is customers' only; realtime only pings,
  polling is always there; the chat never runs on pay routes.
  A desk's mode and the rest are saved at `…/support/settings` by
  `saveDeskSettings()` (transcript days owner-only; a mode change ends the
  open conversations the new mode cannot serve, then `updateTag(chatTag())`);
  `chatWidgetFor()` and `chatContext()` serve a desk in `ai_first` or `people`
  without an agent or a model, and with the AI first a conversation goes to the
  queue when the AI asks (`handoff_to_human`), fails or is missing (`no_ai`) or
  hits the daily limit (`limit`), never a 429. Answer emails (`support.reply`)
  and waiting alerts (`support.waiting`) are `sendSupportEmails()` in
  `/api/cron/integrations` (every minute); an email's link carries a new token
  each time (only the newest opens the conversation; the store's
  `account/support/{token}` and Kaizen's `/support/c/{token}` are no-extras
  paths, `isSupportLinkPath()`), and a typed email is never proof (*Email not
  verified*).
  Tone (step 6, `src/server/support-tone.ts`): `scoreTone()` runs in `after()`
  from the visitor's message (support on, `tone_on`, a text model, feature
  `support_tone`); a message's tone is written only by
  `commerce.support_record_tone()` (once, a customer's; messages are otherwise
  never changed), the conversation's tone and alert come from `rollingTone()`/
  `toneFell()` under its lock, the hand-over at the line from `crossedLine()`;
  a missing score is *not measured*, never 0, and the customer never sees one.
  Summaries (step 7, `src/server/support-summary.ts`): `summarise()` in
  `after()` where a person or the visitor ends a conversation and
  `summarisePending()` in the five-minute dispatcher (a try is taken first,
  `SUMMARY_TRIES` in all, then `failed`; no text model or summaries off:
  `skipped`, never an invented summary); the model reads `transcriptOf()`
  (notes marked, never the partner's help) and only `parseSummary()`'s answer
  is kept; the brief is made on take-over and *Brief me* (kept per message
  number); staff edits audit `support.summary_edited`; the rating is
  `/api/chat/rate` on an ended conversation.
  The silent partner (step 8, `src/server/support-partner.ts`,
  `partner-panel.tsx`): `runPartner()` runs for the assignee 4 s after the
  last customer message the open inbox saw (agent act `partner`) and after a
  take-over, only when `partnerMayRun()` (desk switch, the person's own in
  `support_agents.partner`, not paused here, a text model) and
  `support_take_partner_turn()` allow; *Ask the partner* (`ask_partner`) for
  anyone who may answer. Its tools are `PARTNER_OWNER_TOOLS` the person's
  role may read (`partnerToolsFor()`, `toolOffered()`, through
  `runOwnerTool()` with their holder) and its own; a fact must name a tool it
  called, a draft passes `cleanReply()` and `guardedForVisitor()`, and its
  answer is a `partner` message the customer never sees.
  Help with orders (step 9, `src/server/support-tools.ts`): `supportToolsFor()` gives a store's desk with the AI first the
  read-only tools of 4.3a, `needs` checked by the server before each handler (never the model); an order is found only among the
  signed-in customer's own (another's is `not_found`), amounts are `formatMoney()` in the order's own currency (a new money read
  here needs a euro case in `support-tools.int.test.ts`), links are `SupportChip`s made by code and passed `isSafeAddress()`, never
  in the model's text. Who a conversation is for is only `customerFor()` (a different customer signed in on the browser is not
  signed in here); the sign-in card is the store's own code sign-in through `/api/chat/sign-in` and `/sign-in/code`.
  Actions and requests (step 10, `src/server/support-actions.ts`): the AI only proposes a customer action (`proposeAction()`,
  checked by `prepare()`, kinds allowed by the owner's `ai_actions`); it runs only through `confirmAction()` on the customer's
  Confirm (`/api/chat/confirm`), once, before it expires, for the conversation's own signed-in customer, through the existing
  self-service function (`perform()`); a new kind is a schema in `CUSTOMER_ACTIONS`, a case in `prepare()` and `perform()`, words in
  `m.chat.actions.summary` (4 languages) and `ACTION_KIND_WORDS`, and a test. Anything else is a staff request a person decides on
  the Requests page (`decideRequest()`, the line in the chat, `support.request_done` when away); never a refund, a withdrawal, an
  order edit, a code or credit from the AI.
  Kaizen's desk for owners and staff (step 11, `src/server/support-kaizen.ts`, `/admin/account/kaizen-support`, *Contact Kaizen
  support* in the account menu, the manager tool `contact_kaizen_support`): source `admin`, `requester_id` the account, no token;
  every reader takes the account (`requesterConversation()` and co.), and Kaizen's tools (`kaizenToolsFor()`, also the partner's
  there) read only stores the account is a member of and never change one.
  Realtime (step 12): the database only pings (`support_ping()`, `{at}`); clients join through `useSupportChannel()` (loaded
  dynamically, nothing without the public Supabase settings) and then fetch as they would on their timer (`visitorDelay()`,
  `staffDelay()`: the safety net while connected). A topic (`sc:`/`sd:` key) is handed out only after the check that guards its
  data, typing carries only who, and polling must always work alone.
  Saved replies and translation (step 13, `src/server/support-replies.ts`, `src/server/support-translate.ts`): a desk's replies are
  edited at `…/support/replies` and put in with `/` in the composer, filled in by the server (`repliesFor()`,
  `fillPlaceholders()`: `{customer_first_name}`, `{agent_first_name}`, `{store}`; a name not known is left out, never an email
  address), every one with a shortcut (the key treats empty ones as the same); a translation (feature `support_partner`) is only
  shown to the person or put in their composer, never stored or sent, and a reply they send translated carries `data.translated`
  (*Translated by AI*, `m.chat.translatedByAi`).
  Reports (step 14, `docs/analytics.md` Support): every figure is `supportReport()` (`src/lib/support-reports.ts`) over the rows
  `deskReport()` reads (`src/server/support-reports.ts`: times, `desk_mode` (the desk's mode at the start, kept by a trigger),
  outcome and topics, never words or a customer); a rate or median needs `MIN_SUPPORT_SAMPLE` and otherwise says what is missing;
  per desk, never per agent. The platform's per-store totals are `src/server/support-platform.ts` only (counted columns, a scan
  test); the AI manager's `support_overview`/`list_support_conversations` (owner, `support:read`; answering, D318: `get_support_conversation`, `add_support_note`, `end_support_conversation` and the `send`-gated `reply_to_support`, only through `agentAct()` with `managerStaffDesk()`) and the platform's
  `support_overview` repeat them; the control center says how many wait (`supportWaiting`); the integrations' `support.waiting`
  carries the count and the inbox, never who.
  Email (step 16, D332, `src/server/support-inbound.ts`, pure parts `src/lib/inbound-email.ts`): Resend's `email.received` reaches
  `/api/resend/webhook`, kept as `support_inbound_emails` and processed by `processInboundEmails()` (after the answer and every minute);
  a desk's address is `deskEmailAddress()`, a conversation's reply address its `reply_key`, and a reply continues a conversation only
  from that conversation's own address. A conversation by email (source `email`) is never tied to a customer by the address; the AI
  answers it only with the AI first, through `runSupportTurn(..., { email: true })` (no tool that needs a signed-in customer or a
  button, `NOT_BY_EMAIL`), and its answers go back by `sendReplyEmails()` as a reply in the thread, each marked as the AI's (`aiLabel`, `aiNote`, D334).
  Contact forms (D382, `src/server/support-forms.ts`): a store's email form's message is a conversation of source `form` through `formToInbox()` while the desk is on and its `form_messages` is not `email` (the recipients emailed too unless it is `inbox`); it is people only (the database starts it in the queue, never lets it go to the AI and skips its summary), so no model ever reads its words: a new AI helper on a conversation (tone, brief, partner, translation, a manager tool) leaves `source = 'form'` out. Its answers go back as a conversation by email's do, and a customer with its address is shown, never tied (`addressCustomer`).

## Prices are shown with `<Price>`, which adds the VAT label and shows the 30-day reference only for a genuine reduction

- Prices are shown with `<Price>`, which adds the VAT label and shows the
  30-day reference only for a genuine reduction.

## Choosing in the storefront (D82) uses `Dropdown` (`src/components/dropdown.tsx`, a themed select-only combobox with pictures), never a native…

- Choosing in the storefront (D82) uses `Dropdown` (`src/components/dropdown.tsx`,
  a themed select-only combobox with pictures), never a native `<select>`.
  A variant's picture is `product_variants.image_url`/`image_thumbnail_url`
  (`ProductVariant.image`); the product page and the phone's bar share the
  chosen variant through `VariantChoice`. The gallery shows the chosen
  variant's picture (D84): anything choosing a variant calls
  `showVariantPicture()` (`src/components/variant-picture.ts`).

## The template store's product pages are prerendered at build time, so their content is plain HTML; stock and add-to-cart stream in and need JavaScript

- The template store's product pages are prerendered at build time, so their
  content is plain HTML; stock and add-to-cart stream in and need JavaScript.
  Keep the details outside a `<Suspense>` boundary: React moves a finished
  boundary out of line (shown only by script) once the page passes ~12 kB.

## The cart (`src/server/cart.ts`) is per store and market, identified by an httpOnly cookie

- The cart (`src/server/cart.ts`) is per store and market, identified by an httpOnly
  cookie. Adding checks live stock and caps the quantity; stock is only held
  once checkout starts. Mutations are server actions that call `refresh()`.
  Its contents (`cart/cart-contents.tsx`) are the cart page and, on phones,
  the slide-out cart (D64): the market layout's `@drawer` slot intercepts
  `/cart` on client navigation (`(.)cart`, `CartDrawer`); `[...rest]` closes
  it on any other page, and larger screens load the cart page instead.
  Stores can open it on adding (`stores.open_cart_on_add`, `useOpenCartAfterAdd()`).
  Its totals come from `cartSummary()` (`src/server/cart-summary.ts`), which
  must agree with what `placeOrder()` charges; `checkout-kinds.int.test.ts`
  takes every kind of product from the cart to a paid order and holds the
  two together, so a new kind of product gets a scenario there.

## Payment credentials and payment-method switches are store settings edited in the admin, never environment variables (decision D15)

- Payment credentials and payment-method switches are store settings edited in
  the admin, never environment variables (decision D15).

## Cookie consent (D58, `src/lib/cookie-consent.ts`)

- Cookie consent (D58, `src/lib/cookie-consent.ts`): every cookie or storage
  item the site sets is listed in `KNOWN_COOKIES` with its category and
  purpose, so a new one goes there too. Only necessary ones need no consent;
  `<SiteConsent>` shows the banner only when the site uses an optional
  category (a tracking tool in `stores.tracking` / `platform_settings.tracking`).
  Third-party scripts load only from `ConsentManager` after consent, never
  directly in a layout. Choices are logged in `commerce.consents` (12 months)
  through `/api/consent`; the Cookies page lists what the site sets.
  `siteCookies()` adds what the latest scan found that Kaizen knows or the
  owner described (`cookie_notes`), so the banner follows the scan. The scan
  (`src/lib/cookie-scan.ts`, no database, tested in e2e against a small
  site) runs from `/api/cron/cookie-scan` via `cookie-scan-runner.ts`, the
  only module that loads Chromium; keep it out of other routes' imports.
  A store's own code (D61, `src/lib/custom-code.ts`, `stores.custom_code`)
  is added in the browser: necessary code at once, the rest by
  `ConsentManager` after consent. Pass it through `liveCustomCode()`, which
  gives none until stores have their own hosts (P7).
