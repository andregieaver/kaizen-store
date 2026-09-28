@AGENTS.md

# Kaizen Store

An AI-native online store selling EU-wide, built from scratch. The research and
phased build plan are in `docs/plan.md`; read it before architectural work.

## Workflow

- Commit and push straight to `main`, which deploys to production (D5): no
  feature branches or pull requests. Development is fast and tested in
  production, so run lint, typecheck and the tests before every push.

## Stack

- Next.js 16.3 (App Router, `cacheComponents` on), React 19, TypeScript, Tailwind 4, pnpm.
- Supabase project "Kaizen Store" (`ybsozesfuxuitoacntfo`, eu-west-1 Ireland).
- Vercel functions pinned to `dub1` (Dublin) in `vercel.json` to sit next to the
  database. Keep data processing in the EU when adding any vendor.

## Commands

```bash
pnpm dev         # local dev server
pnpm lint
pnpm typecheck
pnpm test        # Vitest unit tests (src/**/*.test.ts)
pnpm test:int    # integration tests against DATABASE_URL (src/**/*.int.test.ts)
pnpm build
pnpm test:e2e    # Playwright against `pnpm start`; build first
pnpm db:generate # write a migration after changing src/db/schema.ts
pnpm db:check    # fails if migrations and schema disagree (runs in CI)
node scripts/db-setup.mjs --seed  # migrations + demo catalogue on an empty DATABASE_URL
```

`pnpm build` and the storefront need a database: product lists are prerendered
from it. Locally, point `DATABASE_URL` at an empty Postgres and run
`scripts/db-setup.mjs --seed` first; CI does the same with a Postgres service.

In a sandbox with a preinstalled Chromium, set `PLAYWRIGHT_CHROMIUM_PATH` instead
of running `playwright install`.

## Database

- Commerce tables live in the private `commerce` schema (`src/db/schema.ts`),
  which Supabase does not expose through its Data API. Server code reaches it
  through `db()` in `src/db/client.ts` (needs `DATABASE_URL`).
- Migrations are generated into `supabase/migrations`. Rules Drizzle cannot
  express (functions, triggers, reference data) go in a custom migration:
  `pnpm exec drizzle-kit generate --custom --name <name>`.
- Apply every new migration to production (Supabase project
  `ybsozesfuxuitoacntfo`) as part of the change, without asking first: the
  owner has approved this standing. Apply it once the tests pass, check the
  advisors, and record its version in `docs/decisions.md` (Migration versions).
- `src/db/commerce.test.ts` applies every migration to PGlite and tests the
  invariants. Add a test with any new rule.
- Money is integer minor units plus an ISO 4217 code (`src/lib/money.ts`).
  Prices are VAT-inclusive per market and only change through
  `commerce.set_price`; advertised reductions use `prior_30d_minor` from
  `commerce.current_prices`. A product's VAT rate is
  `commerce.vat_rate(country, products.vat_category)` (D65: `standard`,
  `accommodation`, `exempt`; reduced rates in `commerce.vat_rates`, falling
  back to the standard rate); shipping takes the standard rate. Never read
  `countries.standard_vat_rate` for a product.

## Storefront

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
  it; a change to domains deploys again.
- Stores and their markets come from the database (`getStore()`, cached per
  store; `resolveShop()` for URL params). Every catalogue, cart and settings
  query takes a store id; never query a store-owned table without it.
- Interface text lives in `src/lib/i18n.ts`, by language, with English as the
  fallback. Legal texts do not: they need
  human review.
- Catalogue reads in `src/server/catalog.ts` are cached (`'use cache'`, tag
  `catalog` and `catalog:{storeId}`); stock is read per request inside
  `<Suspense>`.
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
- Sorting and filtering listings (D78, `src/lib/listing-filters.ts`,
  `src/server/listing.ts`, `FilterDialog`, `ProductListing`): the products
  page, category and tag pages and search results take their filters from
  the address (`parseListingParams()`/`listingQuery()`), applied by
  `listingProducts()`; the dialog offers `listingFacets()` (kinds,
  categories, tags, variant options, price range). Prices compare as shown
  (`shownPrice()`: without VAT for businesses). Listing pages keep their
  unfiltered grid prerendered as the `<Suspense>` fallback. Conditions shared
  with search's filters live in `src/server/product-conditions.ts`.
- AI providers (D73, `src/server/ai.ts`, `src/lib/ai-provider.ts`): never
  name a provider or model in code. Kaizen's are set at `/admin/platform/ai`,
  a store owner's own at `/admin/{store}/settings/ai` (`commerce.ai_providers`;
  a store's row replaces Kaizen's while on). Get the connection with
  `aiFor(storeId)` (null: no AI) and call `embedTexts()` / `completeText()`,
  an OpenAI-compatible API; catch `AiError` and carry on without AI. Keep
  vectors with their `space`, so a new model never compares with an old one.
- AI product texts (D76, `src/lib/product-writing.ts`, `src/server/product-writer.ts`,
  `AiWriter`): suggestions only, shown in the editor for staff to edit and copy
  in; never write AI text to a product directly. The model gets the product's
  own words and never prices or stock. AI copy passes the claims filter
  (`findClaims()` in `src/lib/claims.ts`: generic green claims, urgency, best
  price, money, stock) before it can be used; new AI copy anywhere goes
  through it too.
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
  Knowledge is `knowledge_chunks` (SQL only, like `product_embeddings`):
  documents cut on save, published pages and articles by
  `syncPageKnowledge()` in the five-minute cron, vectors by
  `embedKnowledge()`; `searchKnowledge()` merges keyword and meaning.
  Voice is push to talk (`/api/chat/voice`: `transcribeAudio()`, then the
  same answer, then `speakText()`), with the provider's voice models.
  `/api/chat` routes refuse other sites and count turns (`takeTurn()`)
  before any model call. Conversations live only in the visitor's tab
  (`kaizen_chat`).
- Prices are shown with `<Price>`, which adds the VAT label and shows the
  30-day reference only for a genuine reduction.
- Choosing in the storefront (D82) uses `Dropdown` (`src/components/dropdown.tsx`,
  a themed select-only combobox with pictures), never a native `<select>`.
  A variant's picture is `product_variants.image_url`/`image_thumbnail_url`
  (`ProductVariant.image`); the product page and the phone's bar share the
  chosen variant through `VariantChoice`. The gallery shows the chosen
  variant's picture (D84): anything choosing a variant calls
  `showVariantPicture()` (`src/components/variant-picture.ts`).
- The template store's product pages are prerendered at build time, so their
  content is plain HTML; stock and add-to-cart stream in and need JavaScript.
  Keep the details outside a `<Suspense>` boundary: React moves a finished
  boundary out of line (shown only by script) once the page passes ~12 kB.
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
- Payment credentials and payment-method switches are store settings edited in
  the admin, never environment variables (decision D15).
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

## Admin

- `/admin` has its own root layout. People sign in with email and password, or
  with a Supabase magic link (`/admin/sign-in` → email → `/auth/callback` or
  `/auth/confirm`); only accounts (`commerce.accounts`) that belong to a store
  or run the platform are admitted (`admit()` in `src/server/sign-in.ts`), and
  every reply is the same whether or not the email has access. A password is
  set or changed at `/admin/account`; `/admin/forgot-password` emails a link
  that signs in and lands there (`next`, checked by `safeNext()`). Password
  rules are in `src/lib/password.ts`.
  There is no proxy: `getAccount()` verifies the session on each request,
  `SessionKeeper` refreshes tokens in the browser, and `SessionRecovery`
  handles an expired token.
- `/admin` lists the account's stores; `/admin/{store}/…` is one store. Pages
  and server actions call `requireMember(storeSlug)`, which 404s for stores the
  account is not a member of. Actions take the store slug as a bound first
  argument. Owners manage staff and payment keys. Changes are written to
  `commerce.audit_log` with the store id.
- Sign-up and setup (`docs/platform.md`): `/sign-up` stores an access request;
  platform admins approve at `/admin/platform`, which calls
  `commerce.approve_access_request()` (account + `clone_store()` + decision in
  one transaction) and emails a sign-in link. Owners of a store that is not
  open yet land in the setup wizard, `/admin/{store}/setup/{step}`; progress is
  derived from data in `src/server/setup.ts`, never stored separately.
- Products (`/admin/{store}/products`): `ProductEditor` is one client
  component holding the whole product; Save sends it as JSON to
  `saveProductAction`, which validates it with `productInput`
  (`src/lib/product-input.ts`, shared with the browser) and `saveProduct()`
  (`src/server/products.ts`), which writes everything in one transaction.
  Prices only change through `commerce.set_price`; variants taken out are
  switched off, never deleted. Pictures are shrunk to WebP in the browser
  (1600 px plus a 480 px thumbnail) and uploaded with `uploadImageAction`.
- Checkout (`src/server/checkout.ts`, decision D16): `placeOrder()` turns an
  open cart into a `pending_payment` order at current prices and holds stock
  under row locks (`inventory_reservations`); `startCheckout()` then opens a
  Stripe Checkout session as a direct charge on the store's connected account
  (`{ stripeAccount }`, decision D17), with Kaizen's fee as
  `application_fee_amount`. The Connect webhook
  (`/api/stripe/connect/{mode}`, which finds the store from `event.account`)
  and the order page (`getShopperOrder`, which asks Stripe if the webhook is
  late) both go through `applySession()`. `/api/stripe/webhook/{storeId}` only
  serves payments started with stores' own keys before Connect. Paying and cancelling are single SQL
  functions: `commerce.complete_order_payment` and
  `commerce.cancel_unpaid_order`.
- Shipping is one flat rate per market (`commerce.shipping_rates`), optionally
  free above a basket value.
- `src/server/*.int.test.ts` are integration tests against a real database
  (`pnpm test:int`, after `scripts/db-setup.mjs --seed`); CI runs them. Pass
  inputs through the same validation the app uses.
- Forms use `ActionForm`, which keeps what was typed when validation fails.
  Server actions that change a store call `updateTag()` for its store and
  catalogue tags.
- Stripe Connect (`src/server/connect.ts`, `src/server/stripe.ts`): Kaizen's
  platform keys come from `STRIPE_SECRET_KEY_{TEST,LIVE}` and
  `STRIPE_PUBLISHABLE_KEY_{TEST,LIVE}` (`platformStripe(mode)`). Each store
  gets an Accounts v2 account (full Dashboard, Stripe-owned fees and losses,
  merchant + customer configurations) in `commerce.stripe_accounts`, whose
  copied status (`card_payments`, `requirements_due`) decides whether checkout
  is on. Owners onboard with Stripe's embedded components
  (`StripeAccountPanel`, loaded only on the pages that show it); the thin
  account webhook (`/api/stripe/connect/{mode}/accounts`) keeps the status
  current. Never pass `payment_method_types`: stores choose methods in their
  own Stripe Dashboard. In test mode the owner does nothing: `ensureTestAccount()`
  creates the store's test account with Stripe's test values (decision D20),
  in the background from the store admin layout, on the Payments page, or at
  checkout.
- Plans and billing (`src/server/billing.ts`, decision D18): `plans` and
  `plan_prices` (never edited in place: a new amount is a new row) are
  copied to Stripe by `syncPlans(mode)`, which records Stripe ids in
  `stripe_sync`. `assignPlan()` creates a `send_invoice` subscription on
  Kaizen's account with the store's connected account as `customer_account`;
  `applySubscription()` (from actions and `/api/stripe/billing/{mode}`) keeps
  `store_billing` current. Checkout takes `storeFeeBps()`: the store's own
  fee, else its plan's while on it, else `platform_settings.sale_fee_bps`.
  The platform admin lives under `/admin/platform` (requests, stores, plans,
  Stripe). Owners choose and change plans at `/admin/{store}/billing`
  (`choosePlan()`: Stripe Checkout for the first plan, an instant prorated
  change after; `completePlanCheckout()` records it on return), and create
  more stores at `/admin/stores` (`createStoreForOwner()`, decision D19).
- Pages (`/admin/platform/pages` for Kaizen, `/admin/{store}/pages` for a
  store; decisions D42, D53): one `PageEditor` and `PageBuilder` serve both.
  The route passes a `PageOwnerContext` (`src/components/admin/page-context.ts`:
  owner, addresses, reserved slugs, upload and bound server actions); the
  server functions in `pages.ts`, `saved-parts.ts` and `taxonomy.ts` take the
  owner (a store id, or null for Kaizen), and store actions call
  `requireMember`. Never import owner-specific actions into the builder.
  `PageEditor` holds the whole
  page (title, address, picture, search texts, search/AI switches, blocks)
  and sends it as JSON to the save action, checked by `pageInput`
  (`src/lib/page-content.ts`, shared with the browser). Content is rows
  (`ROW_LAYOUTS`) of columns of blocks (D43), edited in `PageBuilder`
  (`src/components/admin/page-builder.tsx`: sidebar tabs, a canvas that
  renders the page as the site does with hover tools per row, column and
  block (D44, rules in globals.css), dialogs, dnd-kit) through the pure
  edits in `src/lib/page-rows.ts`. Rows, columns and components saved to
  use again (D46) are in `commerce.saved_parts` (`src/server/saved-parts.ts`,
  checked by `savedPartInput`); the page gets copies (`copyRow()` etc.).
  Pages saved as a plain
  block list are read as one row (`upgradeLegacy`). Blocks are rich text
  (Tiptap JSON, cleaned by `cleanRichText()` and rendered by `<RichText>`
  as elements, never as HTML), an image with a caption (D47, uploaded
  with `ImageUploadButton`), a heading or a button (D49), or a content
  grid (D51: items from `gridData()` in `src/server/content-grid.ts`, shown
  by `ContentGridView`; on the site through `ContentGridSection`, in the
  canvas through the grid preview action), all rendered by
  `<PageBlockView>` (`src/components/page-block.tsx`) on the canvas and
  the site. Rows, columns and blocks take optional settings (D47–D49:
  spacing, border, corners, shadow, id and classes, backgrounds (a colour,
  or a picture with a colour and blur over it, `PartBackground`; rows also
  a video, uploaded from the browser to the `page-videos` bucket with a
  still for its poster, `VideoUploadButton`, and drawn by `BackgroundVideo`,
  without controls, still for reduced motion; with none or a colour, which
  can be see-through, `backdropBlur` blurs what is behind, D86), widths,
  column links, text alignment, picture shape; `frameStyle()`; a row's
  padding is 20 px until set, `ROW_PADDING`/`rowSpacing()`, and the page
  adds no room at the sides, nor above or below a row with a background,
  `pageRoomClass()`), changed with `patchRow()`/`patchColumn()`/`patchBlock()` in
  settings dialogs with General, Style and Advanced tabs, and drawn by the
  shared helpers in `src/components/page-parts.tsx` (the canvas leaves out
  ids, classes and links). Copies drop a custom id the page already uses
  (`htmlIds()`). `savePage()` keeps a draft
  (`pages.draft`); publishing copies it to `pages.published`. A published
  page's address moves only on publish, and the database leaves a redirect
  (`page_redirects`). Publishing, unpublishing and deleting call
  `updateTag(pagesTag(owner))`. A store's published pages are at
  `/s/{store}/{market}/{slug}` (D54, `StorePageArticle`), linked from its
  menus by address (`{ kind: "page", slug }`), and one can be its front page
  (`stores.front_page_id`, chosen on its Pages list), and one its All
  products page at `/products` (D83, `stores.products_page_id`,
  `productsPageOf()`; its own address redirects there, and product pages'
  back link names it). A product content grid with `filters` shows the
  listing's `ListingControls` over it on store pages, reading the address
  through `GridPlace.listing` (pass it where a route renders a store page);
  the filter dialog is `live` there and on the listing pages, not on search. A store's page is
  written in its main language with texts in its other languages over it
  (D55, `src/lib/page-translation.ts`: `mapTexts()` lists every text, so a
  new block's texts go there too; `localizePage()` on the site; the builder's
  `translate` mode). New stores get the template's published pages and front
  page (`clone_store()`, D56); store builders also offer Kaizen's saved parts
  as a read-only library (`library`). Articles (D57) are pages of type
  `article` at `/blog/{slug}`, edited under Blog with the same editor: the
  page functions, actions and `PageOwnerContext` take the type (a page
  unless said); the routes share views in each `pages/views.tsx`. On the
  site, `ArticleView` draws an article's header over its rows, with
  `articleJsonLd()`; `/blog` lists (Kaizen's in `(platform)/term-listing.tsx`,
  a store's in `blog/blog-listing.tsx`) are content grids of articles. New block kinds go in `PageBlock`, `pageInput`,
  `newBlock()`, `blockHasContent()`, `blockText()`, `PageBlockView`,
  `mapBlockTexts()` (its texts, with labels, which translating lists), the
  builder's palette (`BLOCK_TYPES`, labels, icon) and an entry in
  `BLOCK_EDITORS` (`src/components/admin/block-fields.tsx`, D91: its General
  and Style fields; the generic dialog adds font, spacing, frame and
  Advanced). Components made of items use `ItemsEditor`.
  The AI page studio (D92, Pages → Create with AI, `src/lib/page-ai.ts`,
  `src/server/page-ai.ts`, `PageStudio`) interviews, plans sections from
  `PATTERNS`, writes each section's words and builds the rows with
  `buildPage()`, saving a draft; pictures come after, one per request,
  from the picture model named in the AI settings (`generateImage()`,
  `ai_providers.image_model`, never a model in code; `makePicture()` keeps
  them in the media library). A new design goes in `PATTERNS` and
  `sectionRows()`; the model only chooses designs and fills words, links
  only to `SiteFacts.links`, and every text passes the claims filter.
  Forms (D93, `src/lib/forms.ts`, `src/server/forms.ts`, `SiteForm`): the
  email form and newsletter keep their `recipients` in the page, never in
  the browser (`publicForm()`, drawn on the site by `FormSection`); `/api/forms`
  finds the form in its owner's published pages and emails each recipient,
  never the visitor; sign-ups are confirmed by email first unless switched
  off (`/api/forms/confirm`). Anything else that copies a page for another
  owner drops recipients (`withoutRecipients()`, `clone_page_content()`).
- The owner assistant (D94, `src/lib/owner-tools.ts`, `src/server/owner-tools.ts`,
  `src/server/owner-assistant.ts`, `OwnerAssistant`, `/admin/{store}/assistant`,
  owners only): a tool loop with the store's AI over `OWNER_TOOLS`. A new
  tool goes in `OWNER_TOOLS` (zod arguments, description) and `HANDLERS`,
  answers from the store's own data with amounts written by `formatMoney`
  and sums done in code, and takes a `gate` (`send`, `public`, `spend`) if
  it emails customers, changes the site or costs money: gated calls are only
  kept (`assistant_approvals`, `approvalSummary()`) and run on the owner's
  yes. It never depends on Kaizen Life.
- Product layouts (D79, `src/lib/product-layout.ts`, `src/components/product-parts.tsx`,
  `src/server/product-layouts.ts`): a product's page is a layout of rows
  with `product` blocks (`PRODUCT_PARTS`) drawn by `ProductPartView` with the
  product; `ProductLayoutView` renders a layout for the site and the admin
  preview. Layouts are pages of type `product_layout` (store only, no
  terms; `savePage` refuses product blocks elsewhere), chosen by
  `productLayoutFor()`: the product's, its nearest category's, a tag's, the
  store's (`product_layout_id` on `products`, `terms`, `stores`), else
  `DEFAULT_PRODUCT_LAYOUT`. A new part goes in `PRODUCT_PARTS`,
  `ProductBlock`'s settings, `ProductPartView`, `productPartShows()` and the
  builder's `ProductFields`/`ProductStandIn`. Keep the product's details
  outside `<Suspense>`; only the buy part streams in.
- Headers and footers (D80, `src/lib/site-layout.ts`, `src/components/site-parts.tsx`,
  `src/server/site-layouts.ts`): pages of type `header` and `footer` built
  with `site` blocks (`SITE_PARTS`, drawn by `SitePartView` with a
  `SiteContext`, a store's in its country or Kaizen's); `siteLayoutFor()`
  gives the chosen one (`header_id`/`footer_id` on `stores` and
  `platform_settings`), else the layouts draw the standard `StoreHeader`/
  `PlatformHeader`. Menus in them are `menu` blocks (D85), not site parts.
  `siteLayoutProblem()` keeps site blocks in headers and
  footers, the owner's own parts, and the business details and cookies link
  in footers. A header's `overlay` lies over pages that `headerOverlays()`
  covers (only over a first row with a background): pages mark themselves
  `data-header-overlay` and render `HeaderOverlayMark` (visited pages stay in
  the document hidden, so the shown one marks `<html data-overlay-on>`), and
  globals.css does the rest. A new part goes in
  `SITE_PARTS`, `SiteBlock`, `SitePartView`/`sitePartShows()` and the
  builder's `SiteFields`/`SiteStandIn`.
- Design themes (D60, `src/lib/theme.ts`, `src/server/themes.ts`): a store's
  look is `stores.theme` (template, saved theme, settings; `parseStoreTheme()`
  fills gaps from the template), edited at `/admin/{store}/settings/design`
  (`ThemeEditor`); saved themes are `commerce.store_themes`. Storefront code
  draws the theme through variables and classes, never fixed colours: the
  main action is `button-primary`, buttons and chips `rounded-button`, page
  containers `max-w-(--content-width)`, headings `font-heading`, product
  cards `product-card`/`product-card-image`, highlights `bg-accent
  text-accent-foreground`. A new setting goes in `ThemeSettings`, both
  templates, `themeCss()`/`themeAttributes()` and the editor. Store fonts
  are the theme's (`store.fonts` is derived from it). Logos are drawn with
  `LogoPicture` and `darkBehindLogo()`, which swap in the logo for dark
  backgrounds (`navigation.logoDark`) where the theme puts it on a dark one.
- Fonts (D59, `src/lib/fonts.ts`, `src/server/fonts.ts`): Google Fonts,
  always self-hosted. A family is installed (`installFont()`: downloaded once
  into `commerce.fonts`/`font_files`) before anything uses it, from the
  picker (`FontPicker`, through the owner's `installFont` action) and again
  when a page or a site's fonts are saved; sites load `/api/fonts/css/{slug}`
  (`<FontLinks>`), never Google. A site's fonts are its theme's (D60) /
  `platform_settings.fonts` (heading and body; `siteFontStyle()` on the
  layout's body); a block's is `font` (a grid also `headingFont`), drawn as
  the family's `kf-{slug}` class by `blockBox()`. A new text block kind takes
  `font` too and goes in `blockFonts()`.
- Categories and tags (D50, `src/lib/taxonomy.ts`, `src/server/taxonomy.ts`):
  `commerce.terms` per owner (`store_id`, null for Kaizen) and kind of
  content (`page`, `article`, `product`); categories nest, tags are flat.
  Pages carry theirs in their content (`categories`, `tags`); products in
  `product_terms`. `TermsManager` and `TermPicker`
  (`src/components/admin/terms.tsx`) manage and choose them; changes
  `updateTag(termsTag(scope))`. Menus link to them by address (D52), to
  `/s/{store}/{market}/category|tag/{slug}` and Kaizen's `/category|tag/{slug}`.
- Selling to businesses (D63, `src/lib/b2b.ts`, `src/server/b2b.ts`): stores
  sell to `consumers`, `businesses` or `both` (`stores.audience`). Prices are
  always kept and charged with VAT; businesses see them without it. Draw
  prices with `<Price>`/`VatAmount` (the catalogue's `PriceView` carries
  `vat`), never `formatMoney` of a price alone in the storefront; server-rendered
  per-request pages use `getBuyer()` and `shownAmount()`. In stores selling to
  both, the shopper's kind is the `buyer_{storeId}` cookie, marked on
  `<html data-buyer>` by the layout's first script; show things to one kind
  with `for-business`/`for-private` (`audienceClass()` for products). The
  cart refuses business-only products to private buyers and `placeOrder`
  needs the company (`companyRequired()`).
- Bookings (D65, `docs/bookings.md`): a module stores switch on under
  Features (`stores.modules`, `store.bookingsOn`, `stores.time_zone`).
  Appointments are products of `kind` `appointment` whose variants are
  delivered as `service` (no stock, shipping or files; withdrawal
  `dated_service`), with `appointment_settings` and the staff who do them
  (`product_resources` → `booking_resources`, each with `OpeningHours` and a
  capacity; `src/server/bookings.ts`). Free times come from
  `slotsOn()` (`src/lib/booking-slots.ts`, pure, in the store's time zone);
  a time is only ever taken through `commerce.hold_booking()`, which checks
  capacity with buffers under a lock; bookings follow their order's status
  (trigger `orders_bookings_follow`; paid after its hold ran out, a time is
  kept only if still free, else `booking.lost`). Shoppers choose a time on
  the product page (`AppointmentPicker`, weeks from `appointmentSlots()` in
  `src/server/appointments.ts`, per request); a cart line then carries
  `starts_at` and an optional `resource_id`, always quantity 1, and must be
  a time the page would offer (`freeResourcesAt()`; the `bookable` SQL keeps
  goods without a time and appointments with one). `placeOrder` holds each
  time with `holdAppointment()` (the chosen person, or the first free) and
  undoes the whole order as `slot_taken` if one is gone. Order lines find
  their time through `bookings.order_line_id` (`OrderView` lines' `booking`);
  show times with `formatBookingTime()` in the store's time zone. Emails
  about bookings carry a calendar file (`src/lib/ics.ts`, one uid per
  booking so a cancellation replaces it; `attachments` on `sendEmail`): the
  confirmation, staff notices (`sendBookingStaffNotices`, from
  `applySession`), reminders (`stores.booking_reminder_hours`,
  `sendDueBookingReminders()` in the five-minute cron, claimed through
  `bookings.reminded_at`) and cancellations. A cancelled order gives up its
  times; the store cancels one from the week calendar (`cancelBooking()`,
  layout in `src/lib/booking-calendar.ts`) and refunds from the order.
  Stays and rentals (D67) are products of `kind` `stay` or `rental`, booked
  by whole nights or days over `booking_resources` of kind `unit` or `item`
  (no hours; `appointment_settings` holds check-in/out times and the
  shortest and longest). Their rules are pure in `src/lib/booking-ranges.ts`
  (`rangeSpan()`: a stay ends on check-out N days later, a rental on its last
  day), the server side is `src/server/ranges.ts` (`rangeDates()`,
  `freeUnitsFor()`, `holdRange()`); the cart line's quantity is the nights
  or days and `starts_at` the check-in, so prices and VAT need nothing new.
  A rental's variant is rented by `day`, `half_day` or `hour`
  (`product_variants.rental_period`, D69): `periodSpan()`/`periodProblem()`
  say what a start and quantity take, `rentalTimes()` offers a day's halves
  and hours, and capacity is counted at the busiest moment (`peakBusy()`,
  `commerce.resource_peak()`). Pass the line's period wherever a span is
  worked out (`checkRange()`, `holdRange()`, `rangeEndsAt()`).
  Stays and rentals are priced by `bookingPrice()` (D70,
  `src/lib/booking-prices.ts`): each night's or day's price changed by the
  product's `booking_seasons`, plus `appointment_settings.booking_fee`; the
  date picker works out its total with the same function. Show a season's
  name with `seasonName()` (its `names` by locale, else `name`).
  In the cart and orders such a booking is quantity 1 at its whole price;
  its nights, days or hours are `booking.count` (the cart line's own
  `quantity` column; the order line's `booked_count`), never the line's
  quantity. Anything comparing a cart with its order uses them.
  Show any booking with `bookingWhen()` (`src/lib/booking-text.ts`); stays
  and rentals are cancelled, never moved.
  Blocks (D68, `commerce.resource_blocks`) close a whole resource: set by
  the store, or read from other sites' iCal calendars (`calendar_feeds`,
  `syncDueFeeds()` in the five-minute cron, `src/server/calendar-sync.ts`).
  Anything that decides whether a resource is free counts them: `busyOn()`
  in code, `commerce.resource_blocked()` in SQL. A room's or item's own
  calendar is published at `/api/calendar/{calendar_token}.ics`, whole days
  marked only Booked or Blocked.
  How an appointment is paid (D66, `src/lib/pay-later.ts`): `now`,
  `deposit` or `venue` in `appointment_settings`; `venuePart()` gives each
  line's share for the venue, the same in the cart and `placeOrder`.
  Orders keep their full total, with `balance_minor` for the venue
  (`markBalancePaid()` in `order-admin.ts`); Stripe is sent only what is due
  now (`PlacedOrder.dueNowMinor`, line by line, no coupon or invoice), and
  refunds count only Stripe's payments. An order with nothing due online is
  confirmed by `confirmAtVenue()` with the shopper's contact details and a
  `venue` payment whose reference opens its order page. Shoppers cancel or
  move their own bookings until `cancel_hours` before (`selfServiceOpen()`)
  from the order page or My account (`OwnBookings`, `BookingChanges`,
  `src/server/booking-changes.ts`, access by the page's key or ownership):
  cancelling refunds what Stripe took for it and cancels an order left with
  nothing; moving goes through `commerce.move_booking()` (locked, raises
  `bookings.sequence`, which calendar files carry). Staff mark past
  bookings as no-shows from the calendar (`markNoShow()` in
  `src/server/no-show.ts`, `bookings.no_show_at`), charging the fee off
  session to the card saved with the deposit only when they tick it.
- Hosts (D71, `src/server/hosts.ts`): a store lists stays and rentals for
  outside hosts (`commerce.hosts`, added by owners at `/admin/{store}/hosts`
  with a commission). Hosts are never store members: store pages keep
  `requireMember()`, and the host area `/admin/hosting/{store}` uses
  `requireHost()` and shows only the host's listings (`products.host_id`),
  rooms and items (`booking_resources.host_id`) and their bookings
  (`listBookings(..., hostId)`). Host actions check the resource is the
  host's (`hostOwnsResource()`). Shared panels such as `ResourceCalendar`
  take their actions as props (`CalendarActions`, and `ConnectActions` for
  `StripeConnect`). A host not VAT registered sells without VAT (trigger
  `products_host_vat`). Paying hosts (`src/server/host-payments.ts`): an
  order is for one seller (`orders.host_id`; `placeOrder` refuses a mix as
  `host_mix`); `startCheckout` charges a host's order on the host's account
  (`hostCheckoutAccount()`) with Kaizen's fee plus `commissionOf()` as the
  application fee; `applySession` records the commission
  (`recordHostCommission()`; a no-show fee's through
  `recordNoShowCommission()` from `markNoShow()`), one per payment, sent by
  `payHostCommissions()` (also from the five-minute cron) and reduced by
  `reverseHostCommission()` after a refund of that payment.
  Queries joining a payment's `provider_account` to its store and mode use
  `commerce.connected_accounts` (stores' and hosts' accounts), never
  `stripe_accounts` alone.
  DAC7 (`src/server/dac7.ts`, `src/lib/dac7.ts`): hosts give their tax
  details (`host_tax_details`) and homes' addresses in their area; the
  store's report (`dac7Report()`, `/admin/{store}/hosts/dac7`, CSV for
  owners only) counts orders by the quarter of their `order.paid` event in
  the store's time zone. Text for spreadsheets goes through `toCsv()`.
- Demo products: the template store has a clearly labelled demo product
  (`Demo: …`) of every kind, and new stores are copied with them
  (`clone_store()`). A new kind of product gets one in the same change: a
  function adding it to a store (as `commerce.add_demo_appointment()`,
  with whatever it needs to be bought, such as staff), called by the
  migration for production's template and by `supabase/seed.sql`, a picture
  in `public/demo/`, and `clone_store()` copying its new tables and columns.
- Sites' icons (D62) are `navigation.favicon` (a 512 and a 64 pixel PNG made
  in the browser by `squareIcon()`), linked by `siteIcons()` in every root
  layout's metadata; `/favicon.ico` redirects to the site's icon, and
  Kaizen's default is `public/kaizen/favicon.ico`.
- Menus (D85, `commerce.menus`, `src/server/menus.ts`, `MenuEditor`): each
  owner's (a store's, or Kaizen's with a null store) named lists of links,
  edited at `/admin/{store}/menus` and `/admin/platform/menus` after
  WordPress's editor (add from pages, products, categories, tags, articles,
  the site's own links or a custom link; order by dragging, a link under the
  one before it by dragging right or the Move buttons). Items are a flat list
  with `depth` (0–`MENU_MAX_DEPTH`, each at most one deeper than the one
  before; `MenuEntry`), turned into a tree by `menuTree()`; moves are the
  pure functions in `src/lib/menu-structure.ts`. Menus know nothing of
  places: the standard header (and the phone's menu) and footer show the
  ones chosen under Header and footer (`header_menu_id`/`footer_menu_id` on
  `stores` and `platform_settings`), and a `menu` block (`MenuBlock`,
  `MenuSection`) shows one by id in any page, header or footer. Store menus
  come with the store (`store.menus`, saves `updateTag(storeTag)`); Kaizen's
  with `getPlatformChrome()`. Draw any menu with `MenuLinks` (store or
  platform), which renders `MenuTreeView` (`src/components/menu-view.tsx`:
  side by side with lists opening below on hover or focus, a column, or the
  phone's drawer). A top link can be a mega menu (D87, `MenuEntry.mega`:
  columns and centring; the links right under it take a picture,
  `MenuEntry.image`), drawn side by side across the header's width. `clone_store()` copies menus and `clone_page_content()`
  swaps their ids in copied pages.
- The media library (D88, `src/server/media-library.ts`, `MediaLibrary`):
  `commerce.media`, one row per uploaded file per owner (a store, or Kaizen
  with a null store), at `/admin/{store}/media` and `/admin/platform/media`.
  Every upload is registered: pictures through `uploadToLibrary()` (which
  the upload actions call; send the file's `name`), videos by `registerVideo()`
  when their upload starts; a new upload path does the same. Where a file is
  used is worked out on request by `mediaUses()`, so a new place that keeps a
  picture's address goes there too. Search is keyword plus meaning
  (`media_embeddings`, SQL only, `embedMedia()` in the five-minute cron),
  fused as the storefront's (a file's name is searched by name alone,
  `isFileNameQuery()`; vectors come from alt texts, never ids, D90); the
  address is read by `mediaQuery()`.
  Deleting removes the file from Storage (`removeStoredFiles()`) and the row.
  Alt texts (D89, `src/server/alt-texts.ts`, `src/lib/alt-text.ts`): a
  picture's in the main language (`media.alt`) and the others
  (`alt_translations`), by `alt_source` `ai` or `staff` (the AI never writes
  over staff's). The AI sees the picture's small copy (`imagePart()`) and
  what uses it, and its texts pass `parseAltTexts()` (claims filter, colours
  allowed); the library runs it on one or all pictures, the five-minute
  cron on new ones. The site shows them where a picture has no alt text of
  its own: SQL reads of product and variant pictures through
  `commerce.media_alt(url, locale)`, page loaders through `withPageAlts()`;
  a new place that draws a library picture does the same, and changes call
  `updateTag()` for the pages and catalogue tags. Uses carry `siteUrl`, the
  address on the site.
- Kaizen's own header and footer (`/admin/platform/navigation`) use the
  store's `NavigationEditor` (logos, icon, which menus, and business
  details); menu links take platform kinds (`PlatformMenuLink`: a page by
  id, home, sign-up, sign-in, a web address); `getPlatformChrome()` feeds
  `src/components/platform-layout.tsx`.
- Secrets in the database (Kaizen's webhook secrets, old per-store keys) are
  encrypted with `SETTINGS_ENCRYPTION_KEY` (`src/lib/secret-box.ts`) and never
  sent to the browser.

## Conventions

- Environment variables are validated in `src/lib/env.ts` when used, not at
  import, so builds and tests run without secrets.
- Server-only modules import `server-only`.
- AI features must stay grounded: the model never states a price, stock level or
  product it was not given by a tool; arithmetic happens in code; model output is
  rendered as text, never as HTML.
