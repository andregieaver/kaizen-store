@AGENTS.md

# Kaizen Store

An AI-native online store selling EU-wide, built from scratch. The research and
phased build plan are in `docs/plan.md`; read it before architectural work.

## Workflow

- Commit and push straight to `main`, which deploys to production (D5): no
  feature branches or pull requests. Development is fast and tested in
  production, so run lint, typecheck and the tests before every push.
- Production is deployed by CI (`docs/ci-migrations.md`): a push without a new migration deploys at once and
  the checks report beside it; one with a migration waits for the checks, applies it, then deploys. Pushes
  of `*.md` and `docs/**` alone run nothing.

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
- New migrations reach production through CI (`docs/ci-migrations.md`): push the file with the change; the
  `release` job applies it (a direct Postgres connection, so `DROP` and `DELETE` inside functions run as
  written) after the checks pass, and the deploy follows. **Never apply a migration to production by hand
  first**: CI would apply the file again. After the deploy, check the security and performance advisors
  (Supabase project `ybsozesfuxuitoacntfo`) and record the file's version in `docs/decisions.md` (Migration
  versions). A migration must keep the code that is still running working until the deploy finishes (add,
  never rename or drop in the same change).
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
  it; a change to domains deploys again. A store that sells in one country
  has no country in its addresses (D181, `docs/marketless-addresses.md`,
  `src/lib/store-address.ts`): `/s/{store}/home`, `/en/home`; the proxy
  rewrites them to the unchanged `[market]` routes and moves the long ones
  (308) both ways, and `marketPath()` makes them short from `store.address`,
  so never build a store link by hand, and use `marketHome()` where an
  address cannot be empty.
- Stores and their markets come from the database (`getStore()`, cached per
  store; `resolveShop()` for URL params). Every catalogue, cart and settings
  query takes a store id; never query a store-owned table without it.
- Interface text lives in `src/lib/i18n.ts` and `src/lib/email-text.ts`, by
  language, with English as the fallback. Legal texts do not: they need
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
- A model that sees pictures (D163, `src/lib/ai-vision.ts`, `src/server/ai-vision.ts`, `ai_providers.vision_model`, the *Model that sees pictures* field of both AI settings pages): anything that sends a picture to a model calls `seeing(connection)` first (the vision model, else the text model, else null: do not send a picture then) and never `connection.textModel` directly, so searches can stay on a quick text model; a model's name is never assumed to see, only *Check that it sees pictures* (`checkVisionFor()`, a random two-band picture and a colour question, one in twelve guesses right) shows it, and `visionModels` in `AI_PROVIDERS` only suggests. A new feature that sends pictures says so in its failure text and links to `/settings/ai#vision`.
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

- The admin's three levels (D107, `docs/admin-navigation.md`): platform
  (`/admin/platform`), the store owner's control center (`/admin`,
  `/admin/stores`, `/admin/account/…`) and a store (`/admin/{store}`), all in
  one shell, `AdminFrame`: the level switcher and account menu in the header
  (`LevelSwitcher`, `AdminAccountMenu`), the level's daily sections as `tabs`,
  the rest as sidebar `groups`. A level's layout supplies only those; a new
  page goes in exactly one level's tabs or groups and in `ADMIN_PAGES`. The
  platform's sections (D144) and their sidebars are `src/lib/platform-nav.ts` (a new platform page goes in one section's items, or in a section with no sidebar, and in `ADMIN_PAGES`; a test fails otherwise) and the shell takes them as `areas` (`NavArea`) with `wide`. The store (D147) and the owner's level are built the same way: `src/lib/store-nav.ts` (Orders, Products, Customers, Marketing, Website, Bookings, Settings; a new store page goes in one section's items, or Home's, and in `ADMIN_PAGES`, whose `group` follows the section; Website and Settings open on pages of cards) and `src/lib/owner-nav.ts` (Home, Stores, Work, Account); pages use the whole width, so no `max-w-*xl` on a page's root. The owner's overview is `controlCenter()` (`src/server/control-center.ts`, pure
  parts in `src/lib/control-center.ts`); the platform's is `platformOverview()`.
  Owner pages go under `/admin/account/…`, never a new `/admin/{word}`, which
  would take a store address. A layout's auth check does not stop its page
  streaming: every page checks for itself.
- The admin's look (D149, `src/app/admin/admin.css`): the admin's colours are semantic tokens (`bg-background`, `bg-surface`, `border-border`, `text-muted`, `bg-foreground` for the main action), re-tinted and given depth and motion only under `html[data-admin]` (set by the admin's root layout, which alone imports the file); write admin pages in those tokens and never a fixed colour or a one-off shadow or transition, so they follow it, in light and dark, for free. The main action is a `bg-foreground … text-background` button (brand colour, lifts on hover); a field is an `input`/`select`/`textarea` with `border-border` (brand ring on focus); a form that works sets `aria-busy` on itself (`ActionForm` does) and its disabled submit button shows a spinner; a loading placeholder is `animate-pulse rounded-lg bg-background` (it sweeps). Everything that restyles an element carries `:not(:is([data-theme-canvas], [data-theme-preview]) *)`, so a store's page previewed in the admin keeps the store's look, and every motion has a `prefers-reduced-motion` stop (`admin-css.test.ts` holds the scoping).
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
  and server actions call `requirePermission(storeSlug, key)` (D158; it 404s for stores the
  account is not a member of and for a member whose role lacks the key), never a bare
  `requireMember()`. Actions take the store slug as a bound first
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
- Order numbers (D141, `src/lib/order-numbers.ts`, `src/server/order-numbers.ts`) are one sequence per store, without gaps, as some countries require: only `placeOrder()` and the subscription renewal insert an order, and each takes its number from `commerce.next_document_number(store, 'order')` in the same transaction (a unit test scans the source for this). The database refuses to renumber or delete an order, or to lower, skip or re-prefix an issued series; never write code that deletes an order (cancel it) or numbers one another way, and a test that needs fewer orders cancels them. Copied orders (`C-…`) are outside it. `commerce.order_number_audit()` checks a store, and `store_checkup` reports a broken sequence.
- Shipping is one flat rate per market (`commerce.shipping_rates`), optionally
  free above a basket value; a store with a carrier connected can also offer its
  services at checkout next to it (D135).
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
  A global one (D98, `src/lib/global-parts.ts`, `src/server/global-parts.ts`)
  is kept the same on every page using it: pages hold copies marked
  `global` (ids from `src/lib/part-ids.ts`, parts inside marked `local` are
  each page's own), and a change is written to every page by
  `spreadGlobals()`; the editor sends the globals it changed as
  `globalEdits`. Copy parts with `copyRow()` and co., which keep uses uses.
  Pages saved as a plain
  block list are read as one row (`upgradeLegacy`). Blocks are rich text
  (Tiptap JSON, cleaned by `cleanRichText()` and rendered by `<RichText>`
  as elements, never as HTML), an image with a caption (D47, uploaded
  with `ImageUploadButton`; drawn at its own size, never wider and never stretched, shrinking to a narrower column or a phone: `maxWidth` makes it narrower and `align` places it, D151; the size is worked out only by `imageDisplaySize()`, and the wrapper `blockBox()` draws is the picture-sized box, limited by the class `max-w-(--picture-width)`, never an inline width, so owner CSS and the replicator's rules can override it), a heading or a button (D49), or a content
  grid (D51: items from `gridData()` in `src/server/content-grid.ts`, shown
  by `ContentGridView`; on the site through `ContentGridSection`, in the
  canvas through the grid preview action), all rendered by
  `<PageBlockView>` (`src/components/page-block.tsx`) on the canvas and
  the site. The plain text fields of blocks (a heading, a button's words, a caption, tab and
  question titles, an icon list's lines, testimonials' quotes, a form's button and success text, a custom
  grid item's title, price text and button) may hold inline markup (`src/lib/inline-text.ts`,
  `<Inline>`): `span` (a class, which the page's CSS styles; also `<span="name">`), `strong`, `b`, `em`, `i`,
  `u`, `s`, `mark`, `small`, `sub`, `sup`, `br`, and `a` only where `links` is on (never inside a link or
  button), read into elements and never drawn as HTML; every other tag or attribute stays the text typed, a
  class is a plain name, a link goes through `isSafeAddress()`. A new place that draws such a text uses
  `<Inline>` (a product's or a page's own title does not), and a place that needs the words alone (search,
  excerpts, `aria-label`s, structured data, the checks) uses `inlinePlain()`. Rows, columns and blocks take optional settings (D47–D49:
  spacing, border, corners, shadow, id and classes, backgrounds (a colour,
  or a picture with a colour and blur over it, `PartBackground`; rows also
  a video, uploaded from the browser to the `page-videos` bucket with a
  still for its poster, `VideoUploadButton`, and drawn by `BackgroundVideo`,
  without controls, still for reduced motion; with none or a colour, which
  can be see-through, `backdropBlur` blurs what is behind, D86), widths,
  column links, text alignment, picture shape, size and position; `frameStyle()`; a row's
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
  back link names it).
  A store's blog, search page and 404 page are chosen the same way (D112,
  `commerce.page_roles`, `pageForRole()`, `PAGE_ROLES` in `src/lib/page-roles.ts`:
  a new place is a role there, a route that draws `pageForRole()` with the
  standard page as its fallback, a starter in `starterPage()`, and its page's
  address left out of the sitemap); the *Search* block (`SearchSection`) draws
  the store's search in any store page. The working pages are roles too (D113:
  cart, checkout, order, account, sign_in, wishlist, subscription, deliveries,
  cookies): a route draws its page with `<RolePage role route>` (the standard
  page as children), and the page holds a *shop component* (`StorePartBlock`,
  `STORE_PARTS` in `src/lib/store-parts.ts`, drawn by `StorePartSection`) that
  draws only on its own route (`GridPlace.route`), from the route's
  `*-section.tsx` (never inline in a `page.tsx`); a new working page is a role,
  a part, a section, a case in `StorePartSection` and a starter.
  The cart, checkout and order also come in pieces (D117, `STORE_PIECES`,
  `routeOfPart()`, each a `storePart` block): the section draws the whole from
  the same functions the pieces are (`cart-contents.tsx`, `checkout-section.tsx`,
  `order-section.tsx`), reading the cart, checkout or order once per request
  through `perRequest()`; a piece is bare and draws nothing when it has nothing
  to show, so a new one is a key in `STORE_PIECES`, a function in the section,
  a case in `StorePartSection` and a place in the starter, never a role.
  A product content grid with `filters` shows the
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
- Copying another website's page (D150, `docs/page-replicator.md`, `src/lib/replicate*.ts` pure, `src/server/replicate*.ts`, `ReplicatePanel` on `/admin/{store}/pages/ai`): a job in `commerce.page_replications` (one active per store; `COPY_RULES` `never`) is run in ticks by the open page (`tickReplication()`; routes under `pages/ai/replicate/`, which check `getMembership()` and `sameSite()`; the browser work is `src/lib/replicate-open.ts`, free of server-only modules so `e2e/replicate.spec.ts` runs it). The page is built only from what the browser measured (`buildReplica()`: rows, columns, blocks, and a style model of rules by part id, `renderStyles()` into the page's CSS, phone rules in one media query); a model never writes structure, text or CSS: it describes (`analyse()`) and proposes declarations on existing parts (`parsePatchPlan()`/`applyPatchPlan()`, only `cleanDecl()`'s properties and values), and the page's own words reach it as data between `<page-data>` markers. Every fetch from another site goes through `safeFetch()` and every address through `parseReplicaUrl()`/`isBlockedAddress()` (never a plain `fetch` of a person's address; `REPLICATE_ALLOW_PRIVATE` is for tests and ignored on Vercel). Chromium is loaded only by `src/server/browser.ts` (the cookie scan's and this): keep it out of other routes. The copy's preview page `/admin/account/replica/{job}?t=` is open to a token (`src/lib/replicate-token.ts`) for one job's draft only. The summary (`buildSummary()`) is written in code from facts and must not flatter. A new thing the builder cannot hold is a note in `buildReplica()` (so the summary says it), a new property a pass may set is in `PROPS` with its value kind, and a new kind of block the copy may use goes in `makeBlock()` with its own rules. A copy's picture is told to fill its measured box (`#id img{width:100%}`, a poster-only video included), never left to its own size, and `.rp.rp` sets `box-sizing:border-box`; the converter never sets a picture's `maxWidth` or `align`. AI usage is the feature `page_replica`. The report (`src/lib/replicate-report.ts`, `summary.report`, copied from the panel as Markdown) is the brief for improving it: a new gap is a finding in `findingsOf()` with evidence, the change and the files, and anything the converter leaves out goes through `drop()` so the report can name it. Every look at a page is one browser of its own, closed after, with a time limit (`looking()` in `src/lib/replicate-look.ts`, `LOOK`): on the server Chromium is one process, and a second page opened in a browser that had a first hung for good (found on kia.no); never reuse a browser across looks or call `page.evaluate` or `screenshot` outside `looking()`. Chromium needs its files traced for each route that launches it (`outputFileTracingIncludes` in `next.config.ts`: the cookie scan and the replicate tick route); a new route that calls `launchBrowser()` is added there.
- The AI manager (D94, D103; `src/server/owner-assistant.ts`, `AiManagerChat`,
  `AiManagerLauncher`): the admin's assistant for a store's owners
  (`/admin/{store}/assistant`) and platform admins (`/admin/platform/assistant`,
  conversations with a null `store_id`), opened from the headers' button or
  ⌘K as a panel beside the page. `runTurn()` takes a `Principal`
  (`{ account, store | null }`) and the page's `path`; turns go through
  `assistantTurn()` (`src/server/assistant-route.ts`). Tools: the store's
  `OWNER_TOOLS` (`src/lib/owner-tools.ts`, `HANDLERS` in
  `src/server/owner-tools.ts`) or `PLATFORM_TOOLS`, plus `MANAGER_TOOLS`
  (`src/lib/manager-tools.ts`, `src/server/manager-tools.ts`: find and open
  admin pages, skills, memory). A new tool has zod arguments and a
  description, answers from the site's own data with amounts written by
  `formatMoney` and sums done in code, a line in `TOOL_WORDS`, and a `gate`
  (`send`, `public`, `spend`) if it emails, changes a site or costs money:
  gated calls are only kept (`assistant_approvals`, `approvalSummary()`) and
  run on the person's yes. A new admin page goes in `ADMIN_PAGES`
  (`src/lib/admin-map.ts`; its test fails otherwise); a playbook in
  `ASSISTANT_SKILLS` (`src/lib/assistant-skills.ts`). Memory
  (`commerce.assistant_memories`, SQL only, `src/server/assistant-memory.ts`)
  is per account: `remember`/`forget`, `learnFromTurn()` after each turn and
  thumb (`readLearned()` refuses personal details and secrets),
  `memoriesFor()` each turn, `fadeMemories()` daily; people see and change
  it on the Memory tab and can turn learning off. It never depends on Kaizen
  Life. Analyses (D104, `src/server/owner-insights.ts`) count in code from
  paid orders (a captured payment); AI text for customers (`email_customer`)
  passes `findClaims()`. Voice mode (D104, `useVoice` in
  `src/components/admin/voice-mode.ts`, pure text rules in
  `src/lib/speech-text.ts`): hands-free listening by loudness, the site's
  speech-to-text, the answer spoken sentence by sentence through
  `assistantSpeech()` (`…/assistant/speak`), barge-in; turns carry `voice`.
  A kept change is approved in words only through `decide_approval`, whose
  handler checks `saysYes()` on the person's own message and that the
  change was kept before it.
  Live voice (D105, `src/server/live-voice.ts`, `useLiveVoice` in
  `src/components/admin/live-voice.ts`): with a live model in the AI
  settings (`AiConnection.live`), voice mode is a WebRTC call made by
  `…/assistant/live` (the key stays on the server); the voice has no tools
  and delegates to `…/live/delegate`, which runs the request as a `runTurn()`
  in voice mode (`live`), and the transcript is kept by `…/live/transcript`.
  AI usage (D106, `src/server/ai-usage.ts`, `src/lib/ai-usage.ts`,
  `commerce.ai_usage`): every model call in `src/server/ai.ts` goes through
  `metered()`, which records it for the store its connection was made for:
  get connections with `aiFor(storeId, { feature, accountId })` and name what
  the call is for (`AI_FEATURES`; a new feature is added there). A new kind of
  call is wrapped in `metered()` with the provider's own token figures
  (`tokensOrEstimate()`). Reports: `/admin/platform/ai/usage` and
  `/admin/account/usage` (`UsageReport`); sums are worked out in
  `src/lib/ai-usage.ts`. Cost (D145, `src/lib/ai-cost.ts`, `src/server/ai-prices.ts`, `commerce.ai_model_prices`, `/admin/platform/ai/prices`): prices per model are data the platform's admin keeps, a call is priced by the price in force when it was made (`priceFor`, `costMicrosSql`, `unpricedSql` in `src/server/ai-price-sql.ts`, the one place SQL reads a price; `matchPrice()` and `callCost()` in code). D146: pictures, speech and live calls are priced too (`per_image`, `per_audio_minute`, `per_million_characters`, null = no price); a new kind of use gets its own unit price there, never a new SQL copy. Any new page that shows tokens or other usage shows `costWords()` beside it, and a model with no price shows as such ("No price", a "+" on totals), never as free. Never a price in code.
- Store analytics (D152, `docs/analytics.md`, `/admin/{store}/analytics/…`, store section Analytics): the owner's cockpit. One definition per figure, written in `docs/analytics.md` and implemented once: a paid order is `PAID` in `src/server/analytics-sql.ts` (captured payment, never copied or host orders; a cancelled paid order still counts and its refund is subtracted), amounts are in the store's main currency without VAT, grouped by currency in SQL and converted in code (`inMain()`/`toMain()`, a currency with no rate is left out and counted, never summed silently), days are the store's (`dayStart()`/`inPeriod()`). Pure parts are `src/lib/analytics-*.ts` (period, KPIs, finance bridge, customers: cohorts, RFM, LTV, repeat rate; products, inventory, discounts, subscriptions, traffic and channels, targets, alerts, forecast, diagnosis), the queries `src/server/analytics-*.ts` (`periodTotals()`/`overviewData()` first), the pages thin loaders over presentational `*-view.tsx` components with `renderToString` tests (`src/components/admin/analytics/`, hand-drawn SVG charts in the admin's `--chart-*` tokens, every chart with a data table behind it). A new figure is defined in the doc first; a figure that cannot be known is shown as what is missing and how to add it, never as zero; an estimate says so; profit says how much of sales it covers (`costCoverageOf()`: line-based, shipping income is not a product). Cost is `product_variants.cost_minor`, copied to `order_lines.unit_cost_minor` when sold (`placeOrder()`, the renewal, `copy_orders`), so later changes never rewrite history; payment fees, shipping costs, fixed costs and the LTV lifespan are the owner's estimates in `analytics_settings`; ad spend is `marketing_spend`; targets `analytics_targets`; all are `never` in `COPY_RULES`. Every analytics query takes the store id and the heavy ones run through `setBased()` (a read-only transaction without nested loops, so a store with no planner statistics cannot explode; `analytics-perf.int.test.ts` guards it). Visit counting (`stores.visit_counting`, default off; `/api/visit`, `VisitBeacon`, `src/server/analytics-visits.ts`) sets no cookie and uses no storage, keeps no IP address or user agent, stores only a whitelisted landing path (`placeOfPath()`: never an id or token) and a visitor hash that changes every store day, and ties a visit to a cart made that day (`carts.visit_id`) so orders know their channel and device; any new claim about it must stay true to that. Alerts, the forecast and the diagnosis are code (`alertsFor()`, `forecastMonth()`, `explainChange()`), with minimum volumes; the AI manager's `analytics_overview`, `explain_change` and `analytics_alerts` repeat them and never make a number.
- Withdrawals and returns (D153, `docs/returns.md`, `/s/{store}/{market}/withdraw`, `/admin/{store}/returns`): the withdrawal function is two steps and a durable-medium acknowledgement (`src/server/withdrawals.ts`, `confirmWithdrawal()` sends the email in the same request; a failed email never undoes the withdrawal), the physical return is `returns` (`src/server/returns.ts`: lifecycle in `src/lib/return-status.ts` and mirrored by the database's rules, forward only; a withdrawal return is never declined or cancelled), eligibility and the 14-day clock are only `lineEligibility()`/`withdrawalWindow()` (`src/lib/withdrawal.ts`: the period counts from a recorded receipt, never an estimate), and the refund amount is only `refundFor()` (`src/lib/return-refund.ts`) paid through `refundOrder()`, never a second Stripe path (claimed on the return first). Never ask a reason for a withdrawal, never email an address the shopper typed (the order's own address), never answer differently for a wrong email or order number, set no cookie or storage there, and count abuse by hashed keys in the database, not by IP. `placeOrder()` keeps who pays return shipping and the standard delivery cost on the order (so refunds agree with what was shown); a new money read here needs a euro scenario. Every consumer text is hand-written and needs legal review; new tables are `never` in `COPY_RULES` except `return_settings`.
- The parity tracker (D154, `docs/parity/README.md`, `docs/parity-plan.md`): the gap to Shopify is `docs/parity/rows/*.json`, and `docs/shopify-parity.md`'s tables are generated from it (`pnpm parity:write`; never edit between the `parity:generated` markers). A row is Full only with existing evidence files and a test (or `untested: true`, counted as debt), a rating change needs a `history` entry, a claim about Shopify is `fetched: true` only when the page was read (with its date), and a new Shopify feature is one row, never repeated in two domains. A finished feature updates its rows in the same change and runs `pnpm parity:write`; `pnpm parity:check` and `src/lib/parity.test.ts` hold it. Waves start from `.claude/workflows/parity-wave.js`.
- Custom grid items and the carousel (D155, `docs/content-grid-custom-items.md`, `src/lib/custom-grid.ts`, `src/lib/custom-picture.ts`, `src/lib/grid-source.ts`, `src/lib/carousel-settings.ts`, `src/components/carousel.tsx`): a content grid's `custom` source holds the owner's items in the block (`items`, `CUSTOM_ITEMS_MAX` 60), answered by `gridData()` from the block itself. A custom item's price is plain text (`priceText`), never `<Price>` and never in structured data, sitemap, llms.txt, search, feeds, recommendations or the chat agent; words by AI pass `claimsInItem()`; a picture passes `custom-picture.ts` everywhere it is read or copied; a link is a menu link by slug. Every reader of `block.source.type` goes through `sourceTraits()` (`grid-source.ts`, a table keyed by every source, so a new source is a compile error) and is listed in `grid-source.test.ts`. A carousel's settings (`carousel?: CarouselSettings` on content grids and testimonials) keep autoplay safe by construction (off by default, never under reduced motion, stops on any interaction, a Pause button always), rewind uses the real tiles only, and the track must stay a scrolling row without JavaScript. A grid that lies still on computers but scrolls on phones is a carousel at Small only (D179: `display` per screen size in `at.sm`, `carouselOnPhonesOnly()` in `src/lib/responsive.ts`; old `carouselOn: "phones"` is upgraded on read): a grid from Medium up, its arrows hidden there. New words go in nb, sv, da and en. The replicator (D155 C, `src/lib/replicate-grid.ts`, `src/lib/replicate-watch.ts`, `scripts/replicate-calibrate.ts`) builds a grid of custom items only when every word and link of every card fits an item (otherwise columns, with the reason via `drop()`), keeps every item word a measured word (property-tested), reads script sliders from geometry with class names as hints only, drops clones, bounds the autoplay watch in time, tries a grid scoring under 60 % as columns in the same pass (`weakGrids()`, `revertGrids()`), and says plainly in the report what it did and could not do. A grid's tile is measured as a column of parts (`pictureFrameOf()`, `flowAt()`: the picture's panel, each part's `order` and the space above it, a badge by its corner), a grid is judged against columns only from the first pass on, and calibration measures stacked columns each from its own top. The calibration script launches Chromium and fetches pictures outside the app's routes and `safeFetch()`: it is a developer tool, never imported by the app. Rows kept as a picture (D164, `docs/page-replicator.md`, `src/lib/replicate-backdrop.ts`, `startBackdrops()`): the original is photographed twice (also with its glyphs not painted, `Opened.textless`), a row still under `BACKDROP_BELOW` after the page was corrected by measuring (two rounds) is rebuilt as that strip with its words placed over it (`BuildInput.backdrop`, `backdropKey(path, top)`), and `buildFitted()` makes a row picture-only (words hidden) when words over a picture would not fit the page's 50 KB CSS (`renderStyles().level`); never use it before the measuring has had its pass, never for a row that only drifted (`stretchMatch` with `copyY`), and keep the page's words as text in both forms. Phone nodes are found by `alignTrees()` when paths disagree (`PATHS_AGREE`). Rows kept as pictures are a trial (`backdropTrial`, `revertBackdrops()`): they stay only if the page, corrected by measuring once more, matches no worse than before (`BACKDROP_WORSE`), and they go back if the look at the rebuilt page fails; a look that fails is tried again once (`copyLookFailed()`, `lookTries`); the strip with its words (`plain`) is cut and kept only for a row that is only a picture (the library fills fast); a group of more than six cards is never tried as columns (`COLUMNS_MAX`).
- Tax profile and VAT engine (D157, `docs/wave-1a-tax.md`, `src/lib/vat.ts`, `src/lib/vat-treatment.ts`, `src/lib/ioss.ts`, `src/lib/tax-profile.ts`, `src/server/tax-treatment.ts`, `src/server/vat-checks.ts`, `src/server/vies.ts`, `src/server/vat-admin.ts`, `/admin/platform/vat`, `/admin/{store}/settings/tax`): VAT categories are rows (`commerce.vat_categories`; a product's `vat_category` is a foreign key); rates are `commerce.vat_rates` with validity dates, source, checked-on date and a verified flag, written only by `commerce.set_vat_rate()` (audit-logged, never edited in place) and read only through `commerce.vat_rate(country, category, at)` (`vat-readers.test.ts` scans the source); no row means the standard rate, and shipping takes the standard rate unless a person verified a country's rule (`shipping-vat.ts`). Never read `vat_rates` or `countries.standard_vat_rate` elsewhere. The store's registration is `store_tax_profile` (settings in `COPY_RULES`; `duplicate_store()` blanks the numbers, `clone_store()` copies none). What VAT an order carries is only `vatTreatment()` (pure, one reason code per refusal) through `decideTax()` in `tax-treatment.ts`, which `cartSummary()` and `placeOrder()` both call; a new money read needs a euro scenario in `checkout-kinds.int.test.ts`. Reverse charge: a private buyer, the seller's own country, a booking, subscription or host listing, goods sent from outside the EU or from the delivery country, a seller number not checked valid, a stale check or a number for another country all charge VAT; the VAT not charged is `orders.vat_relief_minor` inside `discount_minor` (like D130 credits), the order keeps `vat_kind`, the check and both numbers, and Stripe gets net amounts at quantity 1 with no coupon. IOSS marks only private buyers' shipped goods of at most 150 EUR sent from outside the EU to a listed market; downloads are no consignment. VIES (`vies.ts`) is reached only through an injectable fetch with the one constant host, 4 s, one retry; never call it while placing an order; its failure never blocks and never exempts; limits are taken atomically from `commerce.chat_usage` (buckets `vies:*`: cart 10, client 20, store 60 plus a reserve of 30, owner pool 20, per clock hour); answers are logged in `vat_checks` (24 h cache), and `pruneVatChecks()` clears carts' numbers 30 days after the cart ends, then old checks. A buyer's number and VIES's answer never appear in anything public. Consumer VAT texts (`vat-text.ts`) are hand-written nb/sv/da/en, flagged for legal review, and kept out of the AI catalogue.
- **Legal pages and terms at checkout (D158, `docs/wave-1-trust.md`)**: a store's terms, privacy, returns, shipping, withdrawal-information, imprint and accessibility pages are *linked roles* (`LEGAL_ROLES` in `src/lib/legal-roles.ts`, rows of `page_roles`, served at their own address, in the sitemap when published, never A/B tested, `isLegalPage()`); starters are made as drafts from `legalFacts()` by `legalStarter()` (`src/lib/legal-starters/{nb,sv,da,en}.ts`, hand-written, never AI, each with the `legal-review-notice` row and `[[placeholders]]`, which the builder's checker blocks publishing over, in every language of the page). Never link the EU ODR platform (repealed). `stores.terms_at_checkout` (`link`, `checkbox`, `off`) draws the `checkout_terms` piece (and `CheckoutPayment` when the page has none); the pay press calls `recordTermsAcceptance()` before Stripe's `confirm`, writing `order_terms` and the immutable `legal_snapshots` (never columns on `orders`; copied orders refuse). A new legal kind is a role, a starter in each language with its `REQUIRED_TOPICS`, and an entry in `LEGAL_REVIEW_MANIFEST`. Every text needs human review; the row stays partial until one has.
- **Accessibility (D158)**: `pageIssues()` (`src/lib/page-a11y.ts`) is the one checker; `savePage()` re-runs it and publishing with a blocking issue needs `acknowledgedIssues` and writes `page.published_with_issues`. The statement (`src/lib/a11y-statement.ts`) never says "conforms" without an audit entry; `ENFORCEMENT_BODIES` entries carry `verified`. CI: `e2e/a11y.spec.ts` (axe, tags up to `wcag22aa`, fails on serious and critical; signed-out admin pages only); the Stripe form and signed-in admin are checked by hand. An audit is the company's, never counted by code.
- **Pay routes (D158, `docs/pci.md`)**: `/cart`, `/checkout` and `/order` send `checkoutCsp()` (`next.config.ts` `headers()`, every address shape, with and without the market (D181); `CSP_ENFORCE` is the one-line Report-Only fallback), draw nothing from `OffPayRoutes` (consent manager, owner code, chat, affiliate capture, business popup), and are entered by full page loads (`PayRouteGuard`, a scan test); the checkout page may not hold an `html` or embed-video block. A test fails if the layout or a pay route imports a module in `FORBIDDEN_ON_PAY_ROUTES`. Never add a script origin to the policy without a reason in `docs/pci.md`. Keep zod out of the pay routes' client bundle (its JIT probe is reported as a CSP violation) or set it jitless there; the SAQ A is the company's.
- **Staff security (D158)**: `getAccount()` is the *assured* account (null for an enrolled `aal1` session and for a platform admin without `aal2`); `getSessionAccount()` is for the sign-in and two-step pages only. Enrolment is read from the signed `aal` claim or a server-side `getUser()` for `aal1`, **never the cookie's `user`**; `accounts.two_step_since` is a display mirror. Recovery codes are `account_recovery_codes` (HMAC, single use, ten per set); using one deletes the account's factors with `SUPABASE_SECRET_KEY`. A try is reserved under a per-account advisory lock before a code is checked (`reserveAttempt()`). `ADMIN_TWO_STEP=off` is the break-glass. Two-step pages live under `/admin/sign-in/two-step` and `/admin/account`.
- **Permissions (D158)**: every store admin page, action, route and helper asks `requirePermission(slug, key)`, `checkPermission`, `requireOwnerRole`, `requireAnyPermission`/`checkAnyPermission` or `requirePageTypeAccess`/`checkPageTypeAccess` (`src/server/permissions.ts`, names in `src/lib/permission-guards.ts`); Work's screens ask `settings:*`; nothing else compares `role` with `"owner"` or calls `requireMember`/`getMembership` (`permissions.scan.test.ts`, against `permissions.baseline.json`). A page's key is its navigation section (`sectionOf`), `/staff…` is `staff`, `/billing` is `billing`; owner-only pages need `owner`; `staff:write` and `billing:write` are owner-held. Roles are `store_roles` made by `ensureStoreRoles()`; a custom-role member has the enum `admin` and a `role_id`. A new page: one nav item, `ADMIN_PAGES`, a guard with its area. A new owner tool: a row in `TOOL_PERMISSIONS`. Collaborators are members with `kind = 'collaborator'` and `expires_at`: any reader of `commerce.store_members` ignores an expired one (`store-members-expiry.test.ts`), and Home and the control center show only the figures a member's role may read (`StoreFigures.hides`).
- **Audit log (D158)**: `audit()` keeps its signature and takes an optional `{ area, target, changes }`; `auditChange()` writes allowlisted diffs (`ALLOWED_FIELDS`), never secrets; a new action needs an area in `AUDIT_AREAS` (a scan test). The log is append-only, deletable only after 24 months by `pruneAuditLog()` (`commerce.guard_audit_log()`); `/admin/{store}/activity` shows an owner everything and others their readable areas; the CSV is owners'.
- Invoices and credit notes for shop orders (D159, `docs/wave-1b-invoices.md`): an invoice is issued **only** by `commerce.issue_order_invoice()` inside `commerce.complete_order_payment()` (a sub-block: a failure rolls back only itself and never stops the payment) and a credit note **only** by `commerce.issue_credit_note()`, which a deferred constraint trigger runs at commit for every refund that becomes `succeeded`, by any path (`refundOrder()`, the Stripe `refund.created`/`refund.updated` handler `applyStripeRefund()`, D153 returns, a refund made in Stripe, raw SQL), and for a return refunded outside; never write code that inserts into `invoices` or `credit_notes` (a scan test), numbers one another way, or deletes or edits one (the database refuses; only a one-time `pdf_path` and `anonymise_expired_documents()` may change a row). A new refund path needs no call but must be listed in the enumeration of spec 2.6 and tested. Documents are the snapshot (`src/lib/invoice-snapshot.ts`: `buildInvoiceSnapshot()` is the oracle `invoice-parity.test.ts` holds the SQL to), drawn only from it by `OrderDocumentView`; a credit note never exceeds the invoice per rate (`creditAllocation()`, `creditVatConverted()`, `src/lib/credit-allocation.ts`) and a refund of a payment that is not on the invoice (a no-show fee) gets none (`payment_on_invoice()`). Copied (`C-…`), host, Stripe-test-mode (`payments.test_mode`) and invoicing-off orders get none; a store with incomplete details, a non-VAT-registered seller whose order charged VAT, or no exchange rate waits (`invoice_eligibility()`, `issueWaitingInvoices()`, the five-minute job). The VAT in the seller's currency is `vatHome` (`homeVatRequirement()`); `vatMain` and `buckets[*]` are what unit 1c reads. A new money read here needs a euro scenario in `checkout-kinds.int.test.ts` (it checks the invoice and its credit notes). A PDF is `renderToStaticMarkup()` of the same view loaded into Chromium with every request refused (`src/server/invoice-pdf.ts`; Chromium only there, the two PDF routes and `/api/cron/document-pdfs`, each in `outputFileTracingIncludes`), stored once in the private `documents` bucket, the print page the fallback. The hosted page is `/s/{store}/{market}/account/documents/{token}` (token `inv_`/`crn_`, no cookie, noindex, no tracking or chat extras: `isNoExtrasPath()`). Admin: `/admin/{store}/invoices` (`orders:read`; CSV and *Check again* `orders:write`), `/admin/{store}/settings/invoices` (owner). Invoicing is off for stores with live history until the owner turns it on. All consumer wording is `src/lib/invoice-text.ts`: hand-written, flagged for review, never in `i18n.ts` or the AI catalogue.
- Unit price (D160, `docs/wave-1d-unit-price.md`, `src/lib/unit-price.ts`, `unit-price-rules.ts`, `unit-price-text.ts`, `unit-price-editor.ts`): a goods variant's `measure_amount`/`measure_unit`/`measure_base` (the pack's total and the owner's preferred base) become the price per kg, litre, metre, m2 or piece beside every price. The per-measure figure is **only** worked out by `unitPrice()` (BigInt, half up to the minor unit) and asked for through `unitPriceShown()`, from the price **as the surface shows it** (after `shown()` for the currency and the VAT display, `withoutVat()` first for a business buyer). It is never converted from another currency's unit price and never taken from `referenceMinor`. It is `null` when it equals the price, the price is 0 or it rounds to nothing, and it never changes a total. `checkout-kinds.int.test.ts` holds it in every scenario through `expectUnitPrices()`, euro included, and `unit-price-readers.test.ts` keeps the arithmetic in one file. `order_lines.measure_*` is a frozen snapshot copied by `placeOrder()`, the subscription renewal and `copy_orders()`, so the order page, checkout, emails and subscription page never read the variant; the cart reads the variant live. Naming: `unitPriceMinor` is the price per item; the per-measure figure is `unit` or `measure`, never `unitPrice` as a field. Which base a market shows is `effectiveBase()` from `UNIT_PRICE_COUNTRY_RULES`: no country allows 100 g or 100 ml today (Germany, Norway and Sweden read, Denmark unread and closed), and the market's country decides, not its language or currency. Tests open a country with `allowSmallBase()` and restore it. Required: `commerce.unit_price_required()` (product `sold_by_measure`, or a product category or ancestor with `requires_unit_price`) and the deferred trigger `check_unit_price()` refuse an active product without a measure on an active physical goods variant, and a measure on a service or download; a category marked later grandfathers, reported by `productsNeedingMeasure()`. Basket-level reductions never change the line's unit price. Draw it with `<Price>` (its unit line), never by hand; a new surface that shows a price per item shows the unit price too, and a new money read needs a euro scenario. JSON-LD uses `priceSpecification` (`UnitPriceSpecification`, `referenceQuantity`, `valueReference`), not `unitPricingMeasure` (a feed attribute, wave 5). Words are in `m.unitPrice` (nb, sv, da and en by hand). No new table, so nothing new in `COPY_RULES`; `clone_store()`, `duplicate_store()` and `copy_orders()` are patched. Every rule that comes from a law is flagged for review.
- **VAT, OSS and IOSS reports (D161, `docs/wave-1c-reports.md`, `/admin/{store}/analytics/tax?view=vat|oss|ioss`, `src/lib/tax-*.ts`, `oss-return.ts`, `ecb-history.ts`, `src/server/tax-reports.ts`, `tax-reconciliation.ts`, `tax-report-exports.ts`, `ecb-rates.ts`)**: the owner's data for their accountant, never a tax return or a filing; the page and every file say so. Reports read documents only (invoices and credit notes, D159) through the one reader `commerce.tax_document_groups()`; never recompute VAT from orders. An order with no document (invoicing off, waiting, test mode) is counted and itemised in the reconciliation by cause, never added. Delivery country is `orders.market_code`. Dispatch country, seller country and member state of identification are frozen on `orders.vat_treatment` (`dispatchCountry`, `sellerCountry`, `ossMemberState`; a live-profile fallback is counted as assumed), so editing the store later never moves a filed period. Where a sale is reported is only `classify()` (`tax-classes.ts`: Union 2a, 2b, 2d, non-Union NU, IOSS, national, or a named reason it is in no return); a non-EU market is the store's national return only when the store is established there, else `non_eu_market_foreign`. Euro figures of OSS and IOSS convert from the document's own currency, once per group in BigInt, at the ECB reference rate of the period's last day or the next publication day (`commerce.ecb_reference_rates`, append-only, filled by the daily job; the owner's audited override in `tax_rate_overrides`); never at today's rate and never through `vatMain`, which is used only for the main-currency VAT table. A missing rate makes the return incomplete and the return CSV is refused. Books mode counts a credit note in its own period; filing mode nets same-quarter credits and makes later ones Part 3 corrections of the original period, and negative Part 4 balances are not in Part 5. Part 2b and 2d are totalled per Member State of dispatch. The reconciliation ties the report to Finance's `periodTotals().vatMinor` and to sum(`tax_minor`) of PAID orders by named, counted causes, exact per currency; the page, the AI tools and exports read it in one REPEATABLE READ snapshot (`taxSnapshot()`). CSV layouts are fixed (`tax-csv.ts`, formula-safe, the reconciliation has a direction column); exports are POST with `analytics:write`, logged in `tax_report_exports` with a drift line; ECB rate fetch and override are owner-only, and ECB fetches are limited to 10 an hour per store and 60 in all (`takeEcbSlot()`, `chat_usage` bucket `ecb:fetch`). The AI manager's `vat_report` and `oss_return_data` are read-only and ungated. A new part of a return is a case in `classify()` with a test and a row in spec 4.3; a new money read gets a euro scenario. The classify() rules, the dating by payment day (Directive Art. 63 and 65, not 66a) and the euro conversion need an accountant before real use. The EC Sales List and national return mapping are not built (wave 2). Scheme users keep records 10 years (`retentionCutoff(..., { scheme })`).
- **Personal data (D162, `docs/wave-1g-gdpr.md`)**: every table that can hold a person's data is in `PERSONAL_DATA` (`src/lib/personal-data.ts`) with how it links to them, the export section that carries it and what erasure does (`delete`, `anonymise`, `restrict`, `keep`), or in `NOT_PERSONAL` with a reason; `src/db/privacy.test.ts` fails for a table with `customer_id`, `email`, `phone`, `address`, `*_name` or postal-code columns, a foreign key to a shopper anchor, or a free-text or payload column that is in neither, and a new kind of `sendEmail()` must be in `EMAIL_KINDS`. A new table of shopper data therefore needs a register entry, an export section in `exportCustomerData()`, an erasure step in `eraseSubject()`, a retention rule if it grows, and a `COPY_RULES` decision. The export (`src/server/privacy-export.ts`) is one JSON file by `store_id`, never emailed, amounts in the order's own currency; staff need `customers:write` (a POST, same site), the shopper a fresh sign-in (`customer_sessions.verified_at`, 10 minutes) and at most `EXPORTS_PER_HOUR`; both are audit-logged with ids and counts and never an email or a name. `resolveSubject()` gives a shopper only the account's own proven email: never match emails, forms, codes or carts by an address a person typed. Erasure (`src/server/privacy-erasure.ts`) never deletes an order (D141): a sale is restricted (`orders.restricted_at`, `customer_id` null) and anonymised by `commerce.anonymise_order()` when the seller's country's period ends (`commerce.retention_rules`, read only through `retentionRule()`, written only by `set_retention_rule()`); unpaid orders are cancelled through `cancel_unpaid_order()` after `closeSession()` and then anonymised; every query that matches orders to a person by email adds `restricted_at is null` (`restricted-orders.scan.test.ts`), and `sendEmail()` refuses an email for a restricted or anonymised order; late writers (`saveCustomer()`, `updateOrderContact()`) skip an anonymised order. The anonymising SQL functions contain no `DELETE`; deletions are application code (`runRetention()` in the daily cron, `src/server/retention.ts`). The one-month request clock is `privacyDeadline()`. Consumer wording is `src/lib/privacy-text.ts` (hand-written nb, sv, da, en, needs legal review, never in `i18n.ts`). An audit entry for any of this never holds personal data.
- **Data in and out (wave 2, D165, `docs/wave-2-data.md`)**: imports and exports are `commerce.data_jobs` (`src/server/data-jobs.ts`; run in ticks by `after()`, the open page's tick route and the five-minute cron, each claim with an expiry; files are in the private `imports` and `exports` buckets, written only by the server through `DataStorage` in `src/server/data-job-store.ts`, deleted after 7 days by `pruneDataJobs()`, which lists the job's folder `{store}/{job}/` instead of trusting the row and sweeps folders no row names). Every CSV is written and read only by `src/lib/csv.ts` (`writeCsv()`, OWASP's formula characters escaped; amounts by `amountCell()` from integer minor units, never `decimalAmount()`, which is the D161 files'; Excel (Nordic) is a dialect); never join cells by hand (`csv-writers.test.ts`). A product import goes only through `getProductForEdit()` and `saveProduct()` (`product-import-writers.test.ts`), after the picture fetches and the term creation, reading the store again immediately before saving; it never deletes, never changes a handle, never imports a compare-at price, never turns `Vendor` into a manufacturer or `Charge tax` into the exempt VAT category, and fetches pictures only through `safeFetch()`. `saveProduct()` takes an optional `StockMode`, so an import or a bulk edit never writes back a stock it read before a sale was paid (the bulk 'adjust' is relative). A bulk action does the same and records before and after in `bulk_edit_items` for the undo; one audit entry per batch or job, never per product. Order and customer files are owner-only (`requireOwnerRole`), minimal by default, mark copied (`C-`), host and Stripe test-mode (`test_payment`) orders, carry no personal field of an erased person's order, never a secret or token (canary tests), are never emailed, and an erasure deletes only the ready files that can hold the person (`removePersonalExports()` with an `ExportScope`); the end of a date range is the store's next local midnight (the date plus one, never an interval on a timestamptz); the customer file's `marketing_consent` is `not_recorded` until wave 5 records consent. Main-currency columns are indicative and blank without a rate; a new money read here needs a euro scenario in `checkout-kinds.int.test.ts`. Every analytics table is in `ANALYTICS_TABLES` with a CSV button (`analytics-export-views.test.ts` fails for a table with none); its figures come from the page's own loaders, and the VAT, OSS and IOSS tables keep D161's files. New tables are `never` in `COPY_RULES`.
- **Redirects and the 404 report (wave 2, D168, `docs/wave-2-redirects.md`)**: an address that changes leaves a permanent redirect: pages and articles in `page_redirects` (D42, by the page's id), products, categories and tags in `commerce.redirects` (kinds `product`, `category`, `tag`, written only by the triggers `products_leave_redirect()`/`terms_leave_redirect()`, pointing at the thing so they never chain, deleted when a thing takes the address), and **manual** redirects (kind `manual`, written only by `src/server/redirects.ts`, `validateRedirect()` in `src/lib/redirects.ts` is the one check: market-relative exact paths in the normal form of `src/lib/redirect-path.ts`, case-insensitive, never from a live address or a working page, never to another website, loops refused by the service, the import plan and `commerce.redirects_no_loop()`, 100,000 a store). A redirect is looked up **only where a request would be a 404**, through `missOrRedirect()` (`src/server/redirect-resolve.ts`: a cached lookup tagged `redirectsTag(store)` with a `revalidate` of one second, because a dynamic miss streams with status 200 (section 10), 308 or 404 before the first flush, a bounded lookup that follows up to 10 hops and treats a loop or a failure as a 404); the five store routes' `notFound()` and the catch-all `[market]/[...rest]` call it, and `src/proxy.ts` calls it for a path with **no market** of a store that sells in several countries (`storeRequestAnswer()`, `parseLegacyRequest()`; D181's `STORE_MATCHER` kept in step by a test): never add a redirect lookup to a path that can be a live page. Imports and exports of redirects are D165 jobs (`redirect_import`, `redirect_export`, Shopify's `Redirect from` and `Redirect to`), never a second pipeline. The 404 report (`commerce.not_found_hits`, `record_not_found()`, `recordablePath()`) keeps the address, the day and counts only: never an IP, user agent, cookie, referrer or query string, never a working page's, a token's or a person's address (eight or more digits, spelled any way, are a number a person could own: `recordablePath()`); `pruneNotFound()` in the daily cron. Categories' and tags' SEO title and description are `terms.seo` per language (`termSeoFor()`, never another language's text), in the store translation worklist (scope `terms`) and in the sitemap (`listIndexedTerms()`, live addresses only). New tables are `never` in `COPY_RULES`; `terms.seo` is copied by `clone_store()` and `duplicate_store()`.
- **The WordPress plugin (D169, `docs/wordpress-plugin.md`, `wordpress-plugin/kaizen-store/`, `public/downloads/kaizen-store-wordpress.zip`)**: a site is connected by an owner's approval at `/admin/account/wordpress/connect` (`readApproval()` in `src/lib/wordpress.ts`: https only, the return address on the site's own origin) and a one-time code swapped for a token with a verifier (`exchangeCode()`); tokens and codes are kept only as hashes in `commerce.wordpress_connections`, written only by `src/server/wordpress.ts`. `/api/wordpress/v1/*` is read-only and starts with `asPlugin()`/`asPluginForStore()` (`src/server/wordpress-route.ts`: token, rate limit, the account's membership looked up on every call, a store that is not theirs is a plain 404); a view of products is `viewQuery` through `listGridProducts()` (the grid's own read) and its prices are written by `wordpressPrice()` from `<Price>`'s rules, so the plugin never works out a price, a VAT label, a reduction or a unit price. A view with nothing chosen shows nothing, never everything. Nothing private (orders, customers, settings) is ever served there, and a new route reads only what a shopper can see. The zip is built by `node scripts/build-wordpress-plugin.mjs` to the same bytes every time, and `src/lib/wordpress-plugin.test.ts` fails when it is not the plugin as it is: change the plugin, rebuild, commit both. **Product page and cart (D170)**: a cart held on the site is priced by `quoteCart()` (`src/server/wordpress-shop.ts`, live price, stock and words, a subtotal and nothing else) and handed over by `createHandoffCart()` (`src/server/cart-handoff.ts`): the same checks as adding in the store (`sellableQuantity()`), goods and downloads only (`cartableReason()` in `src/lib/wordpress-cart.ts`), never a cart when nothing can be bought, a link kept as a hash (`carts.handoff_hash`) that `/s/{store}/{market}/cart/resume` opens once to set the cart cookie; a new kind of product that needs more than a variant (a time, a plan, a choice) is not cartable until the store's own page can be bypassed for it, and anything that changes how the store prices a cart gets a case in `wordpress.int.test.ts`, which holds the quote to the cart the store shows. The plugin registers its scripts at `init` (block themes draw content before they queue scripts), and `node scripts/build-wordpress-plugin.mjs` is run after any change to it.
- **Closing a store (D171, `docs/store-closure.md`)**: `stores.status` is `active`, `suspended` or `closed`; the steps are the database's (`stores_status_rules()`), and a store that is not open takes no order (`orders_store_open()`, even a renewal) and is a 404 on the storefront. Nothing is deleted (orders, invoices and the audit log cannot be, almost no foreign key cascades): a closed store stays for its members, and `memberCan()` is the one place that limits every role there to `orders`, `customers`, `analytics`, `billing:read`, `staff:read` and the owner's key (`allowedWhenNotOpen()`), so a new key a closed store may use is added to that list on purpose. The owner closes from `/admin/{store}/settings/close` (`closeStore()`: a sign-in from the last ten minutes, `signedInRecently()`; the address typed in; blocked by paid unsent goods, subscriptions and weekly deliveries, `closureBlockers()`), reopens for 30 days (`ownerMayReopen()`); the platform suspends, closes (forced) and reopens at `/admin/platform/stores/{store}`. Closing ends the plan at period end *first*, cancels orders waiting for payment, releases the domains and emails the owners (`store.status`). A new job that emails shoppers, calls a model or syncs something per store skips a store that is not open with `commerce.store_is_active()`. Counts of what is open are only `storeObligations()`.
- **Store features (D178, `docs/store-features.md`, `src/lib/store-features.ts`, `src/server/store-features.ts`, `/admin/{store}/settings/features`)**: a master switch for the online shop (`shop`; off, the store is a website) and a switch per feature (`subscriptions`, `boxes`, `appointments`, `bookings`, `countries`, `languages`, `currencies`, `business`, `bonus`, `referrals`). `stores.features` holds what the owner keeps on; what is *on* is only `featureOn(store, id)` (kept, with everything in its `needs`; SQL `commerce.feature_on()`), so a feature's switch is remembered while the shop is off; never test `store.features.includes()` for "on". `store.bookingsOn`/`deliveriesOn` are derived from it, and `stores.modules`' `bookings`/`deliveries` follow it by trigger (`stores_features_sync()`, both ways) for older code. Only owners switch, through `setFeature()` (needs enforced, `featureBlockers()` refuse where customers would be hit, `featureWarnings()` need `confirmed`, audited `store.feature`); nothing is deleted, history and shoppers' after-sale links stay. Off means hidden in the admin (a `feature` on its `STORE_SECTIONS` item and `ADMIN_PAGES` entry, held equal by `store-nav.test.ts`; `requireFeature(member, feature)` from `components/admin/feature-off.tsx` after a gated page's permission check; `TOOL_FEATURES` for AI manager tools, refused in `runOwnerTool()` and listed per store over MCP), and, from later steps, in the storefront and refused by the server. A new feature is an id in `FEATURE_IDS` and an entry in `STORE_FEATURES` (needs transitively complete), the `stores_features` check and `commerce.feature_needs()` in a migration, a backfill for stores that use it, its counts in `FeatureFacts`/`featureFacts()` with its blockers, warnings and `featureInUse()`, and `feature` tags on its pages and tools. The Selling group (step 3, `docs/store-features.md` 4c): a product is offered to shoppers only while its kind's feature is on (an appointment Appointments, a stay or rental Stays and rentals, one sold only as a subscription Subscriptions), asked only through `OFFERED` (`commerce.kind_offered()`, `kindOffered()`), and a purchase option only through `plansOffered()` (`selling-readers.scan.test.ts`); a booking's times only while its feature is on (`loadOffer()`, `loadRange()`), a resource's changes and calendars by its kind's feature (`resourceFeatureOn()`); `saveProduct()` refuses making a product of a kind that is off and keeps purchase options as stored while Subscriptions is off; a shop component that serves shoppers' links to what they already have is `afterSale` (still drawn, left out of the palette). Never read `stores.modules` for bookings or boxes: ask the feature. Hiding a feature's parts (step 2, `docs/store-features.md` 4a): admin parts ask `featureOn()` and show `FeatureOffNote`, storefront routes resolve with `resolveFeatureShop()` (404 while off), builder parts carry a `feature` tag (`STORE_PARTS`/`STORE_PIECES`, `SITE_PART_FEATURES`, `PRODUCT_PART_FEATURES`, read by `partFeatureOn()`: not drawn, not in the palette, "Switched off" on the canvas), and a `KNOWN_COOKIES` entry may carry `feature`. The Customers group (4b): who a store sells to is only `effectiveAudience()` (`store.audience`; the owner's choice is `chosenAudience`, edited on the Company page) and `commerce.store_audience()`/`STORE_AUDIENCE` in SQL (`audience-readers.scan.test.ts`): with `business` off the store sells to consumers; a product for one kind of buyer is offered only where the store sells to that kind (`OFFERED`/`commerce.product_offered()` on every shopper-facing product read, the cart and `placeOrder()`); switching it off clears open carts' company and VAT number. The bonus program works when the feature and `bonus_settings.enabled` are on (`commerce.bonus_program_on()`, `BonusProgram.on`); expiry pauses while it is off (`bonus_settings.paused_at`, `bonus_resume()` moves the dates that passed). The referral program works when its feature, its switch and the bonus program are on (`affiliate_program_on()`); an order attributed while it was on is still rewarded when paid. The Countries and languages group (step 4, 4d): the store's own country is `homeMarket(store)` (`store.markets[0]`, SQL `commerce.home_market()`); `store.markets` is the countries *offered* (`offeredMarkets()`: its own alone with `countries` off), `keptMarkets` every active one, `allMarkets` every one it had; `store.localization` follows `languages` and `currencies` (`languageChoice`/`currencyChoice`, `languageChoices()`, `marketChoices()`; `locales` in use, `keptLocales` all kept, `rates` every kept currency's, for history). A save writes only what its editor shows and keeps the rest (hidden countries' prices, fees and amounts, hidden languages' texts): a new per-country or per-language save does the same. Storefront pages resolve with `resolveShop()` and, finding none, call `marketMoved()` (308 to `movedMarketSlug()`; a page that streams calls `pageShopOrMoved()` before its `<Suspense>`); after-sale routes use `resolveAfterSaleShop()` (a new after-sale route too), pay and change links stay strict; carts, `placeOrder()` and drafts ask `commerce.market_offered()`; WordPress uses `offeredMarketIn()`, page parts `marketIn()`. Website mode (step 5, 4e): with `shop` off nothing is offered (`OFFERED` asks `feature_on(store, 'shop')`; the database refuses new orders, `orders.shop_off`), the shop's pages call `sellingPageOr404()` (the 404 or a manual redirect) and its actions and routes resolve with `resolveSellingShop()`, and the admin's selling pages carry `feature: "shop"`; the pages of what was sold (`AFTER_SALE_ADMIN_PATHS`) ask `requireShopOrAfterSale()`, and the withdrawal link and the checkout's legal pages (`LEGAL_ROLE_NEEDS`, `legalRoleNeeded()`) stay while `afterSaleOf()` (`src/server/after-sale.ts`, judged by `lineEligibility()`) says an order can still be withdrawn from or a return is open; a new selling page, action or route does the same, and a new place that draws products, a cart or a price asks the shop. Onboarding (step 6, 4f): the setup wizard asks "What will you sell?" first; answers become features only through `featuresForAnswers()` (`src/lib/onboarding.ts`) and `setFeatures()` (a whole set, with `setFeature()`'s rules, used by the wizard and store templates' pages), the answer is known from a `store.features_chosen` activity entry, and the wizard's steps are `setupStepsFor(features)` (`src/lib/setup-steps.ts`: a new step that needs a feature says so in `stepApplies()`); the AI manager's `list_features` and `set_feature` (gated, warnings kept with the approval as `approved_warnings`) switch as the page does.
- **Inventory (wave 3, D172, `docs/wave-3-inventory.md`)**: stock is `inventory_levels` per variant and location, and every change of it is an append-only row of `inventory_movements` written by a trigger (reason, source, account, order, return), with the why passed by `withStockContext()` (`src/server/stock-context.ts`; `stock-writers.scan.test.ts` fails for a writer without it). Never write a level another way, and never edit or delete a movement (the guard refuses; only `pruneInventoryMovements()` removes any older than 24 months, and the newest of each level stays). Stock is read only through `commerce.variant_availability` (`getVariantStock()`), never `available_stock` directly (`inventory-readers.test.ts`); `in_stock` floors each location at zero as `allocate()` does. A variant with `stock_policy = 'continue'` (physical only, `backorder_days` 1 to 90 required) may go below zero and nothing else may (trigger). `placeOrder()` allocates with `allocate()` (`src/lib/stock-routing.ts`: keep an order together, else by location rank, the backordered remainder at the first location that stocks the variant) and locks level rows in (variant, location) order. `commerce.draw_order_stock()` (inside `complete_order_payment()`) keeps each checkout's physical claim (`inventory_reservations.backorder_quantity` is the part beyond stock) and writes `order_lines.backorder_quantity`. Refunds, cancels and returns restock through `restockPlan()`/`restockRoom()` (never above what the order took) to the original location or one staff choose. Backorder wording is `m.backorder.*` and `emailText().backorder`: hand-written nb, sv, da and en, flagged for legal review, never machine-translated (`HAND_WRITTEN_ONLY` in `src/lib/ui-catalog.ts`); policy and days are read per request, never in a `'use cache'` function; a gift or a weekly box is never backordered (`noBackorder`). Locations: staff add, rename and rank, owners deactivate (`locationImpact()` first; refused while checkouts hold stock there or for the last active one), never delete one. Low-stock level per variant: `stock_alerts` and `sendLowStockNotices()` (one digest email per store per run, one per crossing). Stock files are D165 jobs (`inventory_import`, `inventory_export`); `on_hand_was` makes a row a conflict when the stock moved. New money reads here need a euro scenario in `checkout-kinds.int.test.ts`; a new stock reason widens the `inventory_movements` check and `MOVEMENT_REASONS`; `inventory-perf.int.test.ts` guards the reads and the 20-line order (note: flaky on a busy or long-lived database).
- **Orders: list, tags, archive, drafts, gift (wave 3, D173, `docs/wave-3-orders.md`)**: the Orders page's state is its address, parsed only by `parseOrderListParams()` (`src/lib/order-list.ts`; unknown keys dropped, invalid values ignored) and turned into SQL only by `orderListWhere()` (`src/server/order-list-sql.ts`: the list, the count, the bulk "all matching", saved views and the AI tool); never build a list condition elsewhere. Search matches number, email, name, line title and SKU, tag and tracking number, with `restricted_at is null` on email and name (D162) and every `LIKE` word escaped and bound; paging is keyset, and the total sort compares converted totals (`valueFactors()`), never `total_minor` across currencies. Saved views are `order_views` (the store's, 30 at most, `title` not `name`); bulk actions (`runBulk()`, 250 at most) run order by order and report each refusal; the actions behind the screen are `list-actions.ts` and `ops-actions.ts` (`orders:write`, held by `order-actions.int.test.ts`). Tags are `order_tags` (`normaliseTag()`: 40 code points, 250 per order, case-folded key; the history event carries the words in `data.note` so erasure covers it); archive is `orders.archived_at`, a visibility flag set only by `src/server/order-archive.ts` under `archiveBlock()`; both work on copied orders (the two copied-order guard functions allow exactly `archived_at` and three event types). **Orders are inserted and numbered only in `src/server/order-insert.ts`** (called by `placeOrder()`, the renewal and `placeDraftOrder()`; a scan test). A draft (`draft_orders`) is priced only by `priceDraft()` (`src/lib/draft-order.ts`, built from `decideTax()`, `basketShipping()`, `allocate()` and half-up rounding; equal to `cartSummary()` for the same goods) and becomes an order when **sent** (order `pending_payment`, `source = 'draft'`, stock held to the draft's expiry, tags carried over); sells goods and custom service items only (a custom item is for businesses until the legal review, `custom_consumer`; the delivery address must be in the market's country). The buyer pays through `/s/{store}/{market}/account/pay/{token}` (token kept only as a hash, only under the order's own market, Stripe's **hosted** session with an idempotency key per press, `isNoExtrasPath()`); `applySession()` never cancels a draft's order on a session expiry, `expireDrafts()` does at the draft's expiry; a Stripe session is closed only when Stripe says it is gone (`settleOrderSessions()`). Money taken outside Kaizen is a `payments` row with `provider = 'manual'`, a method and `received_on` (owner-only unless `order_settings.staff_mark_paid`; cash ceilings are data in `cash-limits.ts`, `verified: false`), the invoice says `paid_outside` and a staff discount is its own invoice kind, and a refund of it is a `refunds` row recorded `succeeded` with no Stripe call, capped under the order lock and by `refunds_manual_cap`; never add a reader of `payments.provider` outside `payment-readers.scan.test.ts`'s list. No campaigns, codes, credits or VAT-number checks on a draft; no AI tool records a payment; the gated `send_draft_order` sends only the version the owner was shown. A staff-made order counts everywhere except conversion, the funnel and channels (`docs/analytics.md`). Gift messages (`order_settings.gift_messages`, default off): `carts` and `orders` carry `is_gift`, `gift_to`, `gift_from`, `gift_message`, cleaned by `cleanShopperText()` (`src/lib/gift.ts`, no zod: the cart is a pay route), refused not cut, frozen by a trigger, shown to the buyer, staff and the price-free slip, never in `sendShipped()` and never emailed to anyone but `order.email` (`gift-shipping.int.test.ts`). New words are hand-written and flagged (`HAND_WRITTEN_ONLY`); consumer texts need legal review.
- **Fulfilment and order editing (wave 3, D174, `docs/wave-3-fulfilment.md`)**: shipments are written only by `markSent()`, which always writes `shipment_lines` (no lines = everything still to send; older shipments are `legacy`), and the database refuses a parcel that is not legacy and has no lines at commit (`shipments_have_lines`, a deferred constraint trigger: write a shipment and its lines in one transaction). Units still to send are read only through `toSend()`/`commerce.line_to_send()` (quantity − shipped − withdrawn − closed: withdrawal returns only, `withdrawn_quantity()`; units staff closed as never to be sent, `commerce.unsent_closures`, append-only, written by `refundOrder({ notSent })`), never computed elsewhere; a closed unit is counted as taken for withdrawals (`loadFacts()`). An order stays `paid` while *Partly sent* and becomes `fulfilled` only through `refresh_fulfilment()`; `markDelivered()` needs it sent in full, and each parcel has its own email listing its lines. A parcel is undone, never deleted, only by `undoShipment()` (`commerce.undo_shipment()`, under the order's lock; refused after a return or withdrawal made since the parcel, while a change waits for payment, on a copy or an order that is not paid or sent): an undone parcel (`shipments.undone_at`) counts nowhere (what is sent, the order's state, slips, labels, emails, the list, the shopper's page, the AI tools: a new reader of `shipments` filters `undone_at is null`), a `fulfilled` order goes back to `paid`, the receipt date is cleared, and a carrier's booking is not cancelled at the carrier (staff are told) nor is the customer emailed. An order's lines and amounts change after `pending_payment` **only** inside `applyOrderEdit()` and the change payment (`src/server/order-edits.ts`, edit context `kaizen.order_edit`; triggers refuse anything else; `order-edit-writers.scan.test.ts`): sold units keep their price and discounts (`splitLine()`), added goods are priced by `priceOrderEdit()` with `shown()` and `decideTax()` and equal `cartSummary()`, a lower total is claimed under the order lock before Stripe is asked and refunded through `refundOrder({ within: tx })`, a higher total applies only when the customer pays the link (`/s/{store}/{market}/account/change/{token}`, Stripe's hosted page; `applySession()` branches on `payments.order_edit_id`) or staff record it paid outside Kaizen under D173's cash ceiling (`checkEditCash()`). Never charge a saved card for a change and never renumber (D141). `refundOrder()` splits any refund over the order's captured payments (`splitRefund()`); a new refund path goes through it. Only orders `editBlock()` allows are edited. A change issues documents only through `commerce.issue_edit_documents()` (an edit credit note and a `kind = 'order_edit'` invoice referring to the original); the order's documents are one pool for later credits; a change's refund gets no credit note and is not a refund in analytics; a late change payment is refunded in full and moves no bonus or affiliate credit (`commerce.payment_of_order()`). Slips print what is still to send (`packingSlipData()`) or one parcel (`parcelSlipData()`); the pick list is `pickList()` (`src/lib/pick-list.ts`). The change emails, the pay page, the parcel words and the edit documents are hand-written nb, sv, da and en (`HAND_WRITTEN_ONLY`), never tell a business buyer of a statutory withdrawal right, and need legal review.
- **Store templates (D175, D177, `docs/store-templates.md`, `src/lib/store-starters.ts`, `src/server/store-starters.ts`, `/admin/platform/store-templates`)**: starting points for new stores, called *starters* in code (never confuse them with D125's templates) and *Store templates* in the interface. A starter is a real store marked `stores.starter` (never also `is_template`, never unmarked, only a store with no orders or customers becomes one), made by `createStarter()` from the default template and set up in the normal store admin, described by `commerce.store_starters`. D177 (`docs/store-templates.md` 4a, `src/lib/lifecycle.ts`): details (the recommended design profile among them) are saved as a `draft` and reach owners on Publish; Publish (`publishStarter()`) freezes the working store with `commerce.freeze_starter()` (`clone_store()` into a hidden copy, `stores.starter_copy_of`, `published_store_id`; the copy it replaces is closed); unpublish, archive (`archived_at`, never published while archived) and restore; delete only while no store was made from it and no access request names it (the database refuses, `store_starters.used`/`.requested`), its stores closed and kept. What a new store is copied from is decided only by `commerce.starter_source(starter)` (a published, unarchived starter's frozen copy, its working store if published before D177 and not since, else the template; anything else refused): `createStoreForOwner()` and `approve_access_request()` (the request's `starter_id`; one no longer offered gives way to the template, said to the admin) call it, and a scan test fails for a `clone_store()` call that does not. A starter described by no `store_starters` row (a frozen copy, a design profile's workspace, a deleted template's store) is the platform's: `loadMembership()` honours no membership of it, and nothing lists it (filter `not s.starter or exists (… store_starters …)` where memberships are listed). A starter source adds `commerce.clone_starter_setup()` at the end of `clone_store()`: a new setting a template should carry goes there, never a secret, a person's data or a registration. A starter is not a real store: write `not (s.is_template or s.starter)` wherever a store must be a real business (`store-starters.scan.test.ts` lists every reader of `is_template` with its meaning); `store_is_active()` is false for it, `orders_store_open()` refuses its orders (`orders.store_starter`), `sendEmail()` holds back its shopper and sign-in emails, its storefront is `noindex` and not `indexable` (no sitemap, no llms.txt) with `m.starterNotice`, and the cart shows `m.starterCheckout` (`getCheckoutInfo().starter`). Owners' and sign-up cards are `StarterCards` (Preview opens `storeHref()` in a new window), read through `starterCards()` (cached under `STARTERS_TAG`: every change to a template's details, order or publishing calls `updateTag(STARTERS_TAG)`).
- **Design profiles (D176, D177, `docs/design-profiles.md`, `src/lib/design-presets.ts`, `src/server/design-presets.ts`, `/admin/platform/design-profiles`)**: a store's look kept to use again and applied to any store, called *design presets* in code (`commerce.design_presets`; never "template", "starter" or "theme" alone) and *Design profiles* in the interface. A profile is a versioned snapshot (`designSnapshotSchema`, `v: 1`) of the look only (`LOOK_FIELDS`: the theme's settings, the chosen header, footer and standard product layout as rows with CSS, the site's CSS), never the brand or content (`BRAND_FIELDS`: name, `navigation` logos, business details, menus' links, pages, products); it is cleaned when taken by `snapshotLayout()` (field components out, menus by role, then `sanitizeTemplate()`), and has no `store_id` (outside `COPY_RULES`). D177 (`docs/design-profiles.md` 2a): made from a store or from scratch, each profile has a **workspace** (`design_presets.workspace_store_id`, a hidden starter store copied from the default template, described by no template) whose theme, header, footer, product page and CSS are edited only from `/admin/platform/design-profiles/{id}/…` (`ThemeEditor`, `PageEditor` in `draftOnly` mode with the profile's own actions in `workspace-actions.ts`, each calling `requirePlatformAdmin()` and `workspaceOf()`; never a store's actions); writing a look into it goes through `writeWorkspaceLook()`, which shares `placeSnapshot()` with applying and records no use; `snapshot` is the published look (Publish takes `takeSnapshot(workspace, { drafts: true })`), details are a `draft` until Publish, "unpublished changes" is `designChanged()`; unpublish, archive (clears it as every template's recommendation), restore, and delete only while unused (`design_presets.used`/`.requested`; the workspace closed and kept). `applyDesignPreset()` is the only writer of a profile's look into a store (`design-presets.scan.test.ts`; the workspace's writer is its internal variant): it refuses a store that is not open or not the account's, a store the platform keeps (a frozen copy, a workspace), an archived profile and an unpublished one (a platform admin may try one on a store template), installs the fonts, copies pictures into the store's library as `applyTemplate()` does, checks pages with `pageInput`/`pageRulesProblem()`, and in one transaction keeps the look before (a saved theme "Before …" and `design_preset_uses.previous`, put back by `restoreDesignLook()`), makes new published header, footer and product layout pages with the store's own menus by role (`layoutForStore()`, never over its own pages) and chooses them, and writes the theme and CSS; callers refresh `designTags()`. Owners apply from Design settings (`website:write`), platform admins from `/admin/platform/stores/{store}`; creation and sign-up choose one after the store template (`access_requests.design_preset_id`, a template's `recommended_design` as the default), applied after the store is made in application code, a failure keeping the store. The public preview (`/admin/account/design-profiles/{id}/preview`, `noindex`, inert, cached) draws a published profile on a published store template (its frozen copy) through `layoutForStore()`, never by applying it; `as=admin&draft=1` draws the workspace's draft for platform admins. A new look setting is part of `ThemeSettings` (and so of the snapshot); anything else a profile should carry is a new snapshot version.
- Kaizen Life (D95, `src/server/kaizen-life.ts`): each Supabase project is
  the other's OpenID Connect provider. "Sign in with Kaizen Life" (only with
  `KAIZEN_LIFE_SSO=on`) goes through `/auth/callback?via=kaizen-life` and
  `admitFromKaizenLife()`, which admits owners and platform admins only;
  apps asking to sign someone in with Kaizen Store land on
  `/admin/oauth/consent` (owners only). Sign-in shares identity, never
  store data. Kaizen Life's assistant reaches the owner's stores through
  `/api/mcp` (D96, `src/server/store-mcp.ts`): tokens from the store's
  OAuth server for `KAIZEN_LIFE_CLIENT_ID` only, every owner tool with a
  `store` argument, gated tools only kept (`keepForApproval()`) in the
  owner's Kaizen Life conversation (`kaizenLifeConversation()`), and
  `ask_store_assistant` runs a turn there with `fromKaizenLife`. A new owner
  tool is served there too (manager and platform tools are not). The other way, an owner connects Kaizen Life
  for the assistant under Your account (`src/server/kaizen-life-link.ts`,
  tokens encrypted in `kaizen_life_links`); the assistant then has
  `ask_kaizen_life` (`ASK_KAIZEN_LIFE`, not an owner tool), never in turns
  Kaizen Life asked for.
- Templates (D125, `src/lib/templates.ts`, `src/lib/template-content.ts`, `src/server/templates.ts`, `TemplatesTab`/`TemplatesModal`): saved parts (D46) have `sharing` (`private`, `stores` = the account's other owned stores, `marketplace`), chosen by owners only (`setPartSharing()`, `createSavedPart`/`updateSavedPart` refuse a staff change); Kaizen's own parts (null store) are always `marketplace`, on by default, and stores switch templates on or off in `commerce.template_activations`. Who sees a template is only `visibleTo()`; a hidden one (`hidden_at`, platform admins at `/admin/platform/templates`) is in no list. Using is a copy: `applyTemplate()` sanitises (`sanitizeTemplate()`) and copies pictures into the using store's library, and the builder gives it fresh ids with its own copy functions. Never place another store's part without going through it, and a new block kind's foreign references (ids, links, files) go in `template-content.ts` too. Templates actions are bound in each `pages/context.ts` (`templates`, null for Kaizen's own builder).
- Page layouts and preview (D127, `src/lib/page-layout.ts`, `src/lib/page-layout-apply.ts`, `previewTemplate()`, `TemplatesPreview`, `SaveTemplateDialog`): a whole page's rows and CSS are a saved part of kind `page` (`PageLayout`, only for pages of its own `pageType`, never global), shared, switched on and moderated like the other templates; a new kind of saved-part content goes through `sanitizeTemplate()`/`mapTemplateMedia()` for every row it holds. Using one is `applyPageLayout()` (replace or add, never past the row and block caps). Every template can be previewed before it is switched on or used: `TemplateActions.previewStore` (a plain string: everything the server hands the builder must be serializable, so never a function that is not a server action) names the store for `templatePreviewPath()`, a chrome-free, inert page drawn by `PageDrawing` in the store's theme (`/admin/account/templates/s/{store}/{id}/preview`, `(print)` group, `previewTemplate()` behind the same `visibleTo()`); it never copies, saves or audits anything, so a new way to see a template must not use `applyTemplate()`.
- Motion (D128, `src/lib/motion.ts`, `src/lib/motion-attrs.ts`, `src/lib/motion-runtime.ts`, `src/app/motion.css`, `src/lib/motion-plan.ts`, `src/server/motion-ai.ts`): owners choose effects from curated lists (`ENTER_EFFECTS`, `HOVER_EFFECTS`, `SCROLL_EFFECTS`, `BACKGROUND_EFFECTS`, gradient backgrounds) stored as names on `PartBase.motion` and `backgroundMotion`; never let owner data become CSS or script. Render motion only through `partFx()`/`backgroundFx()` (attributes and `--fx-*` properties, in `PageRowView`, `SiteRows`, `PartBackground` and the builder's canvas preview); a new effect is an id in the catalogue, its CSS in `motion.css` (a test fails if an id has none), its case in `motion-attrs.ts` and in the runtime if it needs JS. Content must stay reachable without JS, with reduced motion and after the failsafe; the first flow row uses CSS only and never starts a picture transparent; only `transform`, `opacity`, `filter` and `clip-path` move. The runtime loads only where `pageUsesMotion()` says so. "Make my page cool": the model only picks catalogue and part ids, `cleanMotionPlan()` validates everything, the summary is built in code, `ruleBasedPlan()` is the no-AI fallback, and a plan is applied to the editor unsaved (`applyMotionPlan()` keeps the owner's own motion). An entrance's `delay` (0–10 s) and `duration` (0.1–5 s, over its speed; D179 phase 3) are milliseconds on it, edited in the Advanced tab's Animation (`AnimationFields`) and drawn as `--fx-delay`/`--fx-duration` (registered as not inherited); a plan never sets a duration.
- Duplicating a store (D129, `docs/store-copy.md`, `src/lib/store-copy.ts`, `src/lib/store-copy-rules.ts`, `src/server/store-copy.ts`, `commerce.duplicate_store()`): the content step is one SQL transaction, pictures, customers and orders follow as a resumable job run from the five-minute cron. Every store-owned table is classified in `COPY_RULES` (settings, catalogue, pages, people, orders, derived, never) and a test fails when a table is missing, so a new store-owned table, secret or per-store identifier needs a decision there, in `duplicate_store()` if it is copied, and in the media rewriting if it holds file addresses. A copied order is history (`orders.copied_from`, number `C-…`): never add code that pays, refunds, ships, invoices, emails, reserves stock for or counts one in revenue; new readers of `orders` that add up money or act on orders skip `copied_from is not null`. Customers are copied without credentials or consents; never copy a Stripe account, payment credential, domain, integration, AI key, invoice series or Work data.
- The bonus program (D130, `docs/bonus.md`, `src/lib/bonus.ts`, `src/server/bonus.ts`, SQL `commerce.bonus_*`): credits (money in `bonus_settings.currency`, the store's main currency) that signed-in customers earn on what they pay and use as a price reduction. The ledger (`bonus_entries`, `bonus_allocations`) is append-only and only the `bonus_*` functions write it, each once per idempotency key; never update or delete an entry, never compute a balance in code from anything but `commerce.bonus_balance()`. Orders reach the ledger through triggers (paid, cancelled, refunds), not from application code, so a new way to pay, cancel or refund an order needs no extra call. Used credits are a discount: `orders.credit_minor` is included in `discount_minor` (`OrderView.discountMinor` excludes it), with each line's share in `order_lines.bonus_discount_minor`; `cartSummary()` and `placeOrder()` both use `redeemLimit()` and must agree (`checkout-kinds.int.test.ts`). Credits are applied last, after campaigns, group discounts and codes, never on shipping, sign-up fees, subscriptions or a venue's balance. Copied orders (D129) and hosts' orders never earn; store copies carry the settings, never balances. Amounts shown in another currency are converted with `convertCredits()`, never stored. New emails and texts go in `email-text.ts`/`i18n.ts`; an AI tool changing the program is gated.
- The affiliate program (D131, `docs/referrals.md`, `docs/affiliates.md`): two levels. Platform (`src/lib/referrals.ts`, `src/server/referrals.ts`, `src/server/referral-billing.ts`, SQL `commerce.referral_*`, `/admin/account/referrals`, `/admin/platform/referrals`, `/r/{code}`): store owners refer store owners and earn credit, per currency and never converted, on the referred store's plan invoices and Kaizen's sale fee, put on their own Kaizen invoices by the billing webhook (`invoice.created`: ledger entry first, then one Stripe line, given back on failure or void). Store (`src/lib/affiliates.ts`, `src/server/affiliates.ts`, SQL `commerce.affiliate_*`, `/account/referrals`, `/admin/{store}/affiliates`): customers refer customers; the friend's welcome discount is decided only by `friendState()` and is part of `discount_minor` (`orders.referral_discount_minor`, lines' shares), so `cartSummary()` and `placeOrder()` agree (`checkout-kinds.int.test.ts`); the referrer's reward is a bonus credit lot (`bonus_entries.kind = 'referral'`, no order id on the entry) granted and reversed by triggers, with every guard (self, not new, blocked, cap, copied and host orders) in SQL. Both ledgers are append-only and written only by their SQL functions, each once per idempotency key. Cookies `kaizen_ref` and `kaizen_aff_{storeId}` are marketing, set only after consent (`KNOWN_COOKIES`); a code is also kept in memory, never in storage before consent. A referrer or an affiliate never sees who a friend is. Two foreign keys (`customers_referred_by_fk`, `affiliate_attributions_friend_fk`) are `ON DELETE SET NULL (column)` in SQL, which Drizzle cannot express: never regenerate them from `schema.ts`. A new fee Kaizen takes from a store earns the referrer through `commerce.referral_earn()`.
- Kaizen's plans on its own pages (D142, `src/lib/plan-offer.ts` pure, `src/server/public-plans.ts`, `PlansView`/`PlansSection`, block `plans`): cards and the comparison table read from `plans`, `plan_prices` and `plan_features` where the page is shown, cached under `PLANS_TAG`, which any new way of changing a plan, its prices or its features must `updateTag()`. Only Kaizen's pages hold the block (`plansProblem()`), never a store's; the visitor sees only what `getPublicPlans()` returns (no Stripe ids, no store counts); prices are what stores pay Kaizen, shown without VAT.
- Kaizen's own front page, blog and 404 page (D143, `src/lib/platform-roles.ts`, `src/server/platform-roles.ts`, `commerce.platform_page_roles`, `PagePlaceForm`, `PlatformPageView`): one of Kaizen's published pages is chosen for each at `/admin/platform/pages` (Special pages); `/`, `/blog` and the platform's `not-found.tsx` draw it through `platformPageForRole()`, the page's own address redirects to the place's, and anything listing Kaizen's pages by address (sitemap, llms.txt) leaves a page with a place out. A new place is a role in `PLATFORM_ROLES` with its copy and starter, the table's check, and its route; every change to a place or to pages `updateTag(PAGES_TAG)`.
- The plan comparison (D132, `src/lib/plan-features.ts`, `src/server/plan-features.ts`, `PlanFeatureTable`, `/admin/platform/plans/features`): `commerce.plan_features` (rows grouped by `category`) and `plan_feature_grants` (a row: the plan includes the feature). It only describes what plans include; it enables nothing. A new feature of the product that belongs in a plan is added there (the editor, or a migration like the seed's), and one the platform takes away is removed there.
- Shipping carriers (D133, `docs/shipping-carriers.md`, `src/lib/shipping-carriers.ts`, `src/server/shipping-carriers.ts`, `/admin/{store}/integrations/shipping/{carrier}`): Posten / Bring (D134), PostNord (D136), Porterbuddy (D137) and Helthjem (D138) are connected, each as far as its `available` features in the registry say: the store's own agreement (non-secret details, encrypted secrets with hints) is saved in `commerce.shipping_carriers`. A carrier's connection implements `ShippingCarrierAdapter`, gets its agreement only from `carrierContext()` (secrets never reach a page or an action), confirms its credential fields against the carrier's documentation, falls back to the flat rate when the carrier fails, and keeps `cartSummary()` and `placeOrder()` in agreement. A new carrier is an id in `CARRIER_IDS`, an entry in `CARRIERS`, the table's `carrier` check, a mark colour in `IntegrationMark`, and it stays out of store copies.
- Posten / Bring (D134, `src/lib/bring.ts`, `src/server/carriers/bring.ts`, `src/server/bring-shipping.ts`): the first carrier connection. Pure request/response code lives in `lib/bring.ts`; the adapter takes an injectable `fetch` and never throws raw errors to a page (plain sentences); orders are booked only through `bringBook()`, which in the store's test environment books a test shipment and does NOT mark the order sent, and otherwise marks it sent through `markSent()` with its `booking` (carrier id, consignment number, label address). Labels are fetched from Bring when printed and never stored; only `api.bring.com` addresses are fetched, with the agreement's keys, for staff. A new carrier connection follows the same shape and is registered in `carriers/index.ts` with its `available` features in the registry.
- Delivery options at checkout (D135, `src/lib/delivery-options.ts`, `src/server/delivery-options.ts`, `src/server/delivery-choice.ts`, `DeliveryChoice`, piece `checkout_delivery`): the shopper gives a postal code, `quoteDelivery()` keeps the carrier's services for the cart as `commerce.delivery_quotes` (price = carrier price + the country's standard VAT + the store's percentage and amount, via `shopperPrice()`, in the country's own currency; shown with `shown()`), `chooseDelivery()` puts one on `carts.delivery_quote_id`, and `chosenDelivery()` is the only reader: a quote of the cart, its country, not expired, pickup point chosen when needed. `cartSummary()` and `placeOrder()` both use it as the basket's shipping rate in place of the flat rate (`commerce.shipping_rates`, which stays as the default and the fallback, so stores keep it set up), so they agree (scenarios in `checkout-kinds.int.test.ts`; a new delivery kind or price rule gets one, euro included). Never call a carrier while placing an order, and never read a quote's price from anywhere but `chosenDelivery()`. Subscriptions ignore the choice (flat rate on each delivery). The order keeps `orders.delivery` (`readOrderDelivery()`); name the service with `order.delivery?.label ?? m.shipping`, the pickup point with `pickupPointLine()`. A new carrier's checkout services add to `CHECKOUT_SERVICES`, `CHECKOUT_COUNTRIES` and its adapter's `rates`/`pickupPoints`.
- PostNord (D136, `src/lib/postnord.ts`, `src/server/carriers/postnord.ts`): connected for the check, service points and tracking only; the adapter has no `rates` or `book`. A carrier's checkout services are priced by `CHECKOUT_PRICING`: `carrier` (its `rates()` plus `shopperPrice()`) or `store` (what the owner entered in `checkout_prices`, with VAT, per country: never add VAT or a markup to it). `quoteDelivery()` asks every active carrier (`activeCarriers()`) and lists their services together; a new carrier with its own price service is `carrier`, one without is `store`. Booking and labels for PostNord wait for its EDI specification.
- Porterbuddy (D137, `src/lib/porterbuddy.ts`, `src/server/carriers/porterbuddy.ts`, `src/server/porterbuddy-shipping.ts`): sells delivery *windows*. `rates()` is an availability request and returns options with a `window` (and `includesVat` for a price made for the shopper); at checkout each is a quote with `window_start/window_end` (read with `chosenDelivery()`, kept on `orders.delivery.window`, shown with `formatWindow()` in the store's time zone). Never book with the token the shopper saw: `porterbuddyBook()` asks again and uses the fresh one, and books nothing when the window is gone. Labels of every connected carrier are served by `carrierLabel()` (only the carrier's own hosts are fetched, never kept).
- Helthjem (D138, `src/lib/helthjem.ts`, `src/server/carriers/helthjem.ts`, `src/server/helthjem-shipping.ts`): `store`-priced like PostNord, with a weight limit per service (`CHECKOUT_SERVICES[...].maxWeightGrams`, checked against the cart's weight in `offersFrom()`). Our service ids are `home` and `collect`; what Helthjem books is the store's own transport solution for each (`solutionFor()`), never a fixed id in code. The token lives in a module-level cache (`forgetHelthjemTokens()` in tests). Only Helthjem's own hosts are sent the token (`isHelthjemUrl()`).
- Product recommendations (D139, `docs/recommendations.md`, `src/lib/recommendations.ts` pure, `src/server/recommend.ts` engine, `recommend-settings.ts`, `recommend-events.ts`, `recommend-grid.ts`, `/api/recommendations`, `/admin/{store}/recommendations`, `RecommendedGrid`, `RecommendTracker`, `RecommendField`): a product content grid with `source.recommend` (`GridRecommend`; keep it through `ownProducts()` when a block is copied to another store) shows the page's stand-in (`standInFor()`: for everyone, cached under `recommendTag()` and the catalogue, no cookies, no AI) and the browser swaps in the shopper's own. Candidates come only from the store's data; every product passes `recommendable()` (SQL) and the code's exclusions (anchors, cart, `purchasedProductIds()`, never-with); `classify()`/`chooseMix()` are pure and tested. The model only orders ids from that list (`parseRerank()`, `applyRerank()`, `reasonFits()`), through `aiFor(storeId, { feature: "recommendations" })` and `metered()`, kept in `search_cache` (`rerank`), under the owner's monthly token cap, never for the held-out arm; the text under a product is `m.recommend.*` with a store-held title, never model text. A new money read here needs a euro scenario; a new recommendation source is a `Source` with a weight in `SOURCE_WEIGHT`. The tab's session (`kaizen_rec`, `src/lib/recommend-session.ts`) is session storage only and set only while the store's recommendations are on; events carry a random tab id and never a person. The chat agent calls `recommendForChat()` (no AI re-rank). New store-owned tables here are `never` in `COPY_RULES`. D140: category and tag pages are page roles (`category`, `tag`, the parts of the same names draw `TermListing`; `GridPlace.term` makes a grid recommend around the term); `compareArms()` (`src/lib/recommend-eval.ts`) judges the AI's ranking against the plain one on tabs, never on impressions, and only with 100 tabs in each; `replayOnOrders()` replays past orders leaving the replayed order out (`exceptOrder`), so never let a check learn from what it is checking; the AI manager's recommendation tools share `settingsProblems()` and `saveRecommendSettingsValues()` with the form.
- A/B tests of pages (D148, `docs/ab-testing.md`, `src/lib/experiments.ts`, `src/server/experiments.ts`, `experiment-admin.ts`, `experiment-results.ts`, `src/proxy.ts`, `/admin/{store}/experiments`): a version is a page of type `variant` (a copy, no address, edited in the builder from its test), a test is `commerce.experiments` with a life cycle the database enforces (draft, running, stopped, applied or discarded; one running per page, five per store; versions locked once it runs; a page in a running test stays published and no change to it is published: `runningTestOf()`). Only visitors who accepted `statistics` are enrolled: `/api/ab/assign` sets `kaizen_ab_{storeId}` and the marker `kaizen_ab` (both in `KNOWN_COOKIES`), the proxy matches only the marker (its literal name is in `config`, a test keeps it in step) and rewrites to `/s/{store}/{market}/{slug}/ab/{version}`; never read a cookie or call the database for a test for a visitor without the marker (the address shape's facts, D181, are read once per store every few seconds, not per visitor). Exposure, clicks and carts are recorded once per visitor and only while the test runs; an order counts when paid, from a cart tied to an exposed visitor, never a copied or host's order; revenue is without VAT in the store's main currency (`convertMinor`), capped; results are computed on read, the verdict only in `verdictOf()`'s plain words and only after the minimum. A new goal is an entry in `GOAL_WORDS`, a recorder, and a column in the results; a new money read needs a euro scenario. Never let a test change prices, shipping or discounts, or a legal page. A test of a part (phase 2: `experiments.target_part`, `src/lib/experiment-parts.ts`, the builder's "A/B test this" through `onTestPart`/`context.experimentsHref`) is a page test whose versions may differ in that part only (`partChanges()`, checked at every start) and whose apply puts only the part into the page as it is then (`applyPart()`); anything that copies or compares page content for a test goes through those. A scheduled start (`status 'scheduled'`, `scheduleExperiment()`, started by `runExperimentJobs()` with the same checks, back to a draft with `schedule_problem` when it cannot) keeps nothing served until it runs. A test of the header, footer or a product layout (phase 3, `src/lib/ab-site.ts`) is served by the visitor's versions in the market param (`no~{token}{version}`: the proxy rewrites, `resolveShop()` strips them into `ab`, and the market layout and product page read them through `siteLayoutForVisitor()`/`productLayoutForVisitor()`); so a new reader of the header, footer or a product's layout draws it that way, any code taking the market from a store route's params goes through `resolveShop()`, and a version of one of these is a `variant` page saved with `variantOf`. The AI manager's A/B tools (phase 4, `src/lib/experiment-tools.ts`, `src/server/experiment-tools.ts`): `explain_results` repeats `experimentResults()`'s verdict and never makes one, a draft's words pass `findClaims()` and `applyChanges()`, and `start_experiment`/`stop_experiment`/`apply_winner` are `public`-gated with `preflightExperimentTool()` and a summary written from the test; admin functions refresh caches through `refreshTag()`, never `updateTag` directly, so the cron and the assistant's route work. The platform's view (phase 5, `src/lib/platform-experiments.ts`, `src/server/platform-experiments.ts`, `/admin/platform/experiments`) is read-only: it reads results through `experimentResults()` like the owner's page and says what needs a look only in `flagsOf()`; a platform admin never changes a store's test, and a new kind of trouble is a flag there with a test. The guardrail's stop emails the store's owners and the test's maker through `notifyGuardrailStop()` (`src/server/experiment-emails.ts`, words in `src/lib/experiment-emails.ts`): after the stop, once each (`experiment.guardrail:{test}:{account}`), never for a person's or the planned end's stop, never throwing, and the email says what the counted figures say and never why. The search test and the recommendations held-out ranking (phase 7) count with the engine's arithmetic, never a formula of their own: `callRates()`, `splitP()` and `sayCall()` in `src/lib/experiment-units.ts` (the interval rule for search, the pooled two-proportion rule for recommendations, units `search` and `tab`, each with its floor), and `experiment-parity.test.ts` holds them to the old formulas in `experiment-legacy.ts` (tests only; never import it in the app). They keep their own logs and units and set no cookie: a new test of an anonymous unit is an arm and a rate going through `callRates()`, a row in `platformUnitTests()` and a parity case, never visitor tables. The platform AI manager's A/B tools (phase 8, `list_ab_tests` and `explain_ab_test` in `PLATFORM_TOOLS`, `src/server/platform-experiment-tools.ts`) are read-only and ungated: they repeat the platform view's flags and the owner's own verdicts, advise only through `adviceFor()` (what to tell the owner), and a platform tool that starts, stops or changes a store's test is never added; they are not owner tools, so the store's MCP server does not serve them. Modals and working pages (phase 9): a modal row is a part like any other, with `partChanges()`'s two rules (it keeps its address name and stays a modal; one that opens by itself, `opensByItself()`, may be left out of a version, and `applyPart()` then takes it out of the page), and a working page (`WORKING_ROLES` in `src/lib/ab-site.ts`: the page chosen for the cart, checkout, order, account, sign-in, wishlist, subscription or deliveries role, kind `role`) is tested by a part around the shop's own component only, never as a whole and never the component itself (`testablePart()`), served from its own route: `RolePage` draws `rolePageForVisitor()` and its marker, the proxy adds the version token only for that route (`ROLE_SEGMENT`), `experimentOfPage()` leaves it out, and a new working page or route goes in `WORKING_ROLES`, `ROLE_SEGMENT`, `ROLE_NAMES`, the migration's list and `RolePage`'s caller passing `ab`; the cookies page and the content pages are still refused (migration `ab_working_pages`). The front page and the All products page (phase 10, `commerce.page_place()`, `OWN_PLACES`/`TESTED_PLACES` in `src/lib/ab-site.ts`, `placePageForVisitor()`, migration `ab_front_pages`) are tested whole or by a part, served from their routes like a working page (the front page matches an empty `ROLE_SEGMENT`: nothing after the market), held in place while a test runs (`stores_experiment_guard`); anything asking what place a page was chosen for asks `page_place()`, never `page_roles` alone, and a part test compares the original as it would be saved (`asSaved()`, because saving keeps only the store's own languages). The goal `form` (phase 11, `recordFormSent()` called by `submitForm()`, `formsWithin()`/`goalCandidates()`, `BLOCK_CHOICE`, migration `ab_form_goal`) counts a visitor once per form, in the version they were shown, when the site has accepted their answer (never a robot's, a refused or repeated one, or one outside the test); a goal that counts a block takes `goal_params.block` and a draft's block is checked against the page (`goalCandidates()`), so a new goal of that kind is an entry in `GOAL_WORDS` with its `block`, a recorder, the two check constraints and a column in the funnel.
- **Responsive editing (D179, `docs/responsive-editing.md`, phases 1 to 4 built)**: four screen sizes (`src/lib/breakpoints.ts`: Small, Medium from 768, Large from 1024, Extra large from 1280, `ThemeSettings.breakpoints`), a part's settings as its Extra large values with per-size overrides in `PartBase.at` (`lg`, `md`, `sm`, read only through `valueAt()` in `src/lib/responsive.ts`, larger to smaller) and `visibility.hideAt`; old one-off phone switches (`hideOnPhones`, `stackOnPhones`, `reverseOnMobile`, `sideBySide`, `carouselOn`, `GridColumns`, `TextAlignments`) are folded in by the schemas' upgrade on read and never written again. Settings that vary by size are written as CSS rules (`src/lib/part-css.ts`, drawn by `PartStyles`/`CanvasPartStyles`; media queries on the site, container queries on the canvas's `kz-page`), `:where()`-scoped so owner CSS and the replicator's `#id` rules still win; every part keeps its `kz-{id}` class. A new setting that can vary by size goes in `at`'s schema and the CSS writer, never inline; `e2e/responsive-parity.spec.ts` holds saved pages unchanged. The builder edits one size at a time (phase 2, `src/components/admin/responsive-edit.tsx`: responsive mode with its bar, Ctrl/Cmd+Shift+R, the canvas's `kz-page` at the size's width, owner CSS's width `@media` as `@container` there by `containerCss()`, hidden parts faded by `canvasHiddenCss()`): a field of such a setting has its device icon (`SizeMark`) and writes the size only through `setAt()`/`clearAt()` (shown with `viewAt()`/`sizeSource()`), and a part is hidden by size in its Advanced tab's Visibility (`visibilityPatch()`), never by a switch of its own. Text's look is `Typography` (phase 3, `src/lib/typography.ts`: family, weight, size with unit, line height, alignment, letter spacing, transform, decoration, style, variant, shadow) per kind of text in `PartBase.typography` and `at.*.typography`, drawn only by `typographyRules()` in the part stylesheet and edited by `TypographyFields` in every Style tab; old size, weight, font and text-alignment fields are folded in on read (`foldTypography()`); a new text of a block is a kind in `TEXT_FIELDS` with a role in `textRoles()` (its element marked `data-kz-text` where no selector names it), which `typography.test.ts` holds for every text. A component's own Tailwind breakpoints are `kzb-md-…`/`kzb-lg-…` classes (`BREAKPOINT_CLASSES`, drawn by `BreakpointSheet` on the store's sizes and on the canvas), never `sm:`/`md:`/`lg:` inside a block. Who sees a part (phase 4) is `visibility.show` (never, signed in, signed out, or conditions: rules pure and closed in `src/lib/visibility.ts`, OR between groups, AND within, at most 30 such parts a page): the site draws every row, column and block through `<VisiblePart>`, a `<Suspense>` hole that reads `visitorFacts()` (`src/server/visibility.ts`, each kind once per request through `perRequest()`, from the request and the store's own rows) and draws the part or nothing, so hidden words are never in the HTML, and what a page says about itself (`pageExcerpt()`, the chat's knowledge) reads only `publicRows()`; nothing is stored or set. Ids in rules are the store's own on save (`keepOwnRuleIds()`) and dropped by `sanitizeTemplate()`; the checkout's payment form and terms and the withdrawal link always show (`displayLocked()`).
- **Theme elements, content width and resizing (D182, `docs/theme-elements.md`)**: the builder's Theme tab edits `ThemeSettings.elements` (row, h1 to h6, p, list, button: Typography, spacing, frame, a row's colour, per size), `layout.maxWidth` (px, over Narrow/Normal/Wide) and the palette's body background, saved by `saveThemeTab()` and nothing else of the theme. The theme is laid under parts only when they are drawn (`themedRows()`, `layerUnder()`: a part's own setting wins at the sizes it sets it at; rich text's inner paragraphs, headings and lists are `themeInner`, written as `& .rich-text p`), never saved into a page: a new reader that draws a store's rows goes through `PageRowView` or `themedRows()`, and a new part's setting that a theme element can hold goes in `layerUnder()`. A row's own width is `contentMax` (px, per size in `at`), drawn by `rowWidthStyle()` as `--content-width` on the element with `max-w-(--content-width)`. Canvas resizing is `RowWidthHandles` and `ColumnDividers` (`row-resize.tsx`, arithmetic in `src/lib/resize.ts`), writing at the size edited through `setAt()`/`setColumnShares()`; a canvas row's frame is `rowFrame()`, so it is as wide as the site's. A part's settings open in `FloatingPanel` (`SettingsPanel` in the builder), never a modal `<dialog>`; a dialog opened from it is still modal.
- **Saved colours and gradients (D183, `docs/theme-elements.md`)**: `ThemeSettings.library` (`src/lib/colour-library.ts`, `ColourLibraryProvider`, `SavedColours`, `SavedGradients`) is copied into a part when used, never referenced; kept only by `saveLibraryAction`. `Typography.gradient` is a text gradient (`typographyDecl()`, a rule that makes the element fit its words); `GradientBackground.opacity`/`overlay` are drawn by `GradientLayer`. A pixel field uses `PixelRange` beside its number field.
- **Lines of columns in a row (D187)**: a row's columns can sit in several lines, one under another (Beaver Builder's column groups). `PageRow.layout` is the first line's layout and `moreLines` the layouts of the lines under it (at most `ROW_LINES_MAX` lines of `LINE_COLUMNS_MAX` columns, 6 and 6); `columns` stays one flat list, line after line, which `columnLines(row)` and `rowLayouts(row)` split (the last line takes what is left, and `pageInput` refuses a count that does not add up), so a row of one line is stored, drawn and styled exactly as before. Column order, layout and shares are per line, and every edit goes through the pure functions in `src/lib/page-rows.ts` (`moveColumnAt()`, `insertColumnAt()`, `addColumn()`, `setLineLayout()`, `setLineShares()`/`clearLineShares()`, `removeColumn()`, `duplicateColumn()`; `linesOf()`, `locateColumn()`), never by splicing `row.columns`: a column dropped among others, or moved from a line to another, makes each line it touches share its width evenly again (any share set by hand at any size is taken back; a reorder inside a line keeps them), a line left without a column goes, and a line holding six columns takes no more. The site, the canvas and the modal preview draw a row of several lines as a box per line inside the row's grid (`RowMarkup`, `PreviewRow`; `rowGridStyle()` in `src/lib/part-css.ts` makes the row a flex column and each line its own grid or stack, per screen size, the order rules per line). In the canvas a column dragged by its handle can be dropped between columns or on a *New line* strip above or below a line (`NewLineZone`, drawn only while a column is dragged; `columnSpotFor()`), and the sidebar's Rows tab has a *Column* tile, dragged into a row (`palette-column`) or pressed (`onAddColumn`), that adds an empty column and shares the line's width evenly again. The row's layout choice and the Size tab's shares act on the line of the column they are opened from (`ColumnDividers` per line). A new reader of a row's columns that cares about their lines asks `columnLines()`, never `ROW_LAYOUTS[row.layout]` alone; `row-lines.test.ts`, `row-lines-render.test.ts` and `builder-lines.test.ts` hold the model, the markup and the builder's wiring.
- **Text colour (D180, `docs/text-colour.md`)**: a text's colour and opacity are two more `Typography` keys (`color` as `#rrggbb`, `opacity` 0–100, solid unless set), per kind of text and per screen size like the others, on every component, row and column; the part stylesheet writes them (`colourCssAt()` in `typographyRules()`) as `:where()` rules with `!important`, as the inline styles they replace were, and a row's or column's passes down. The Typography panel opens with Colour (`ColorField` in `src/components/admin/colour-field.tsx`: picker, hex, ×, opacity slider, the theme's swatches from `PageOwnerContext.colours`, `themeSwatches()`/`platformSwatches()`). A colour with an opacity becomes CSS only through `colourCss()` (`src/lib/colour.ts`, text and colour backgrounds alike). Text colours kept on their own before (a heading's, a button's, each of a dual button's two in its `first`/`second` role, a grid's and a form's button's) are folded in on read by `foldTypography()`; never write `textColor` on a block again (a header's overlay keeps its own, a social link's custom colour and an icon list's icon colour are not text colours). Rich text's colour is the `textStyle` mark, kept by `cleanRichText()` only as `#rrggbb` and 0–100 and drawn by `<RichText>` as a style on a span; inline markup in plain text fields stays classes only. `pageIssues()` blends a colour with its opacity over its background (`blend()`) before `contrastRatio()`, at every screen size (`valueAt()`, `colourAt()`), taking a block's colour from its column or row where it sets none, and checks rich text's marked colours.
- Duplicating pages (D126, `src/lib/page-duplicate.ts`, `src/server/page-duplicate.ts`, `DuplicateButton`): a copy goes through `savePage` as an unpublished draft (never anything but that), from the builder with the editor's current content minus `globalEdits`/`fields`; anything new kept per page (like custom field values) is copied there too.
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
- Custom fields (D118, `docs/custom-fields.md`, `src/lib/custom-fields.ts`,
  `src/server/custom-fields.ts`): a store's own groups of fields
  (`commerce.field_groups`, made at `/admin/{store}/fields` by
  `FieldGroupEditor`) and what was entered in them for products, pages and
  articles (`commerce.field_values`: one row per thing and language, `locale`
  empty for what is the same in all, keyed by the field's `id`, never its
  name). A group applies by its location rules (`groupApplies()`, OR of AND,
  evaluated in the browser as the thing changes and on the server when it is
  saved); a field shows by its conditional logic (`fieldShows()`), and a hidden
  one is kept but never required. The entry form is `FieldsForm`/`EntityFields`
  (`applicableGroups()`); values travel in the editor's own JSON (`fields`:
  `changesFrom()`, a `null` takes a value away) and are written by
  `saveFieldData()` in the same transaction, checked by `parseFieldChanges()`
  against the groups the finished thing gets. A new field type is a key in
  `FIELD_TYPES`, its case in `parseValue()`, `displayText()`, `FieldInput` and
  the renderer. Only texts are per language (`isTranslatable()`). Fields are
  private until the owner makes them public: the site reads only public ones
  through `shownFieldsFor()` (cached under `fieldsTag`, read inside the
  product page's own cached read), drawn by `CustomFieldsView` in the product
  layouts' `fields`/`field` parts and the page builder's `customField` block;
  any change to a group or to values calls `updateTag(fieldsTag())`. Never
  render a field's value as HTML.
  Phase 2 (D119): a **group** and a **repeater** hold `subFields`; their
  structure and non-text cells are in the shared row and only translatable sub
  fields' texts in the locale rows, each repeater row with a stable id
  (`newRowId()`) so a translation follows its row. Read and write a field only
  through `readField()`/`writeField()`/`parseStructural()`, never the storage
  shape (the form shows another language its own view, `ownView()`). **Link**
  (a page, product, category, tag or web address), **product/page/term**
  relations and **file** hold ids and addresses, never names: the server drops
  ids that are not the store's (`keepOwnRelations()`) and files outside
  `field-files/{storeId}/` (`isOwnFieldFile()`, uploaded straight from the
  browser to the public bucket by `startFieldFileUploadAction`), and
  `shownFieldsFor()` turns them into links in the shopper's market
  (`resolveRelations()`), leaving out what no longer exists; links are drawn
  only if `isSafeAddress()`. Things with fields (`FIELD_ENTITIES`): products,
  **variants** (`shownFieldsForVariants()`, `ProductDetail.variantFields`, drawn
  per variant by the `fields`/`field` parts through `VariantFields`, which
  follows the picker via `announceVariant()`; entered in the product editor by
  SKU as `variantFields`) and **categories and tags** (`term`,
  `saveTermFields()`, the Fields button in `TermsManager`, drawn on the term's
  page); their rules are `termKind`/`content`. A field with `filter`, `search`
  or `chat` (public fields only; the generator's Storefront tab) is a listing
  filter (`f.<name>` in the address, `listingFacets().fields`,
  `field-filters.ts`), part of keyword search (`commerce.field_search`, rebuilt
  by `refreshFieldSearch()` on every save and `refreshStoreFieldSearch()` when
  groups change; `matchingIds()` reads it), and a fact the chat agent may say
  (`chatDetails()`); public simple fields are also `additionalProperty` in the
  product's JSON-LD (`structuredProperties()`). A heading, rich text, image or
  button block can be **bound** to a field (`bind`, `src/lib/field-binding.ts`:
  `bindPage()` on product layouts, `bindForPlace()` on pages, only when the
  content has a binding). Field texts are in the store translation worklist
  (scope `fields`, `src/lib/field-translate.ts`) and the AI manager reads and
  fills them (`list_field_groups`, `get_fields`, `set_fields` and
  `create_field_group`, the last two gated). A new kind of thing with fields is
  an entry in `FIELD_ENTITIES`, `LOCATION_PARAMS`, `Facts` and `factsFor()`, a
  cleanup trigger, `clone_store()` and its own editor.
  Phase 3 (D120): **money** fields (`{ amountMinor, currency }`, only in a
  currency the store offers, `moneyCurrencies(store)`; shown converted to the
  market's currency at the store's rates by `convertMinor`, else in its own,
  never with a VAT label; never `chat`, never a structured-data property) and
  **flexible content** (`layouts`, each a named set of sub fields; rows are
  `{ id, layout, …cells }`, stored like a repeater's: use `rowFieldsOf()`,
  rows of a layout that is gone are dropped on save and skipped on read).
  The **store** (`entity 'store'`, id = the store's; edited at
  `/admin/{store}/fields/store`, shown by a `customField` block, a product
  part or a binding with `source: 'store'`, allowed in headers and footers only
  so) and **customers** and **orders** (`staffGroupProblem()`: groups only for
  those two, no rules, nothing public, no picture, gallery or file; never read
  on the shopper's side: `field-values-readers.test.ts` lists the modules that
  may read `field_values` and fails if another does; customer values go with
  the customer, `customerFieldExport()` is the export). A **field loop**
  (`fieldLoop` block, product part `loop`, `src/lib/field-loop.ts`) draws a
  repeater's rows as cards, a list, a grid or columns from slots (picture,
  title, text, link, badge) filled with the row's sub fields, never nested
  links. A content grid's `tileFields` (up to three plain fields) are read for
  all its items at once (`shownFieldsForItems()`, one batch, group rules
  honoured). A number or measurement field with `filter` is a range filter
  (`f.<name>.min`/`.max`, a measurement compared in its first unit only).
- Modals (D121, `src/lib/page-modal.ts`, `src/components/page-modal.tsx`, `ModalFields`): a row with `modal` set (`RowModal`: key, triggers, frequency, look) is not in the page's flow; `PageRowView` draws it through `ModalRow` in a native `<dialog>` (`PageModal`), so pages, articles, headers and footers (site-wide), product layouts and Kaizen's pages all get it. Its content is an ordinary row; its Style tab is the panel's (`rowBox(row, mode, true)`, `modalPanelStyle()`). Anything counting rows for the page's flow uses `flowRows()` (`pageRoomClass`, `headerOverlays`, main heading); a new such count does too. Its dialog id `modal-{key}` is a page id (`htmlIds()`, `repeatedHtmlId()`), and `copyRow()` gives a copy a fresh key. Triggers are delegated listeners (one click listener on `document`, `hashchange`, timers, `mouseout`), never inline handlers; the timer and exit intent open by themselves at most once per page view, never over another modal, never on working pages (`autoAllowed()`) or in the builder. Frequency (`shouldAutoOpen()`, `rememberClose()`) is stored as `kaizen_modal_{key}`, a `preferences` item in `KNOWN_COOKIES`, written only after consent (`mayRemember()`), and declared by `usesRememberedModals()`. New interface text goes in `m.modal`.
- Work (D122, D123, `docs/work.md`, module `work` switched on per store in the owner's Work settings, at the store OWNER's level: `/admin/account/work` is the combined view over all the account's stores (`src/server/work-owner.ts`, money per currency, never added across currencies) and one store's screens are `/admin/account/work/s/{store}/…`; build every Work link with `workBase()` from `src/lib/work-paths.ts`, never by hand; old `/admin/{store}/work…` addresses redirect; one running timer per person across stores): clients, assignments and tasks, time entries and timers, invoices and credit notes, ported from Kaizen Life's Work area. Tables are `commerce.work_*` (`db/schema.ts`), all with `store_id` and composite keys; money is integer minor units, hours integer minutes, invoice quantities hundredths of an hour: the maths is only in `src/lib/work-calc.ts` (BigInt, no floats), VAT in `work-vat.ts`, dates in the store's time zone in `work-dates.ts`, input schemas shared with the browser in `work-input.ts`. Servers: `src/server/work.ts` (clients, assignments, tasks), `work-time.ts` (entries, timers), `work-invoices.ts` (drafts, lines, issue, credit, payments, document data), `work-settings.ts`, `work-overview.ts`; refusals of the SQL rules are `work_*.reason` codes mapped to plain messages by `work-errors.ts` (`workGuard()`); actions are in `.../work/actions.ts`, `invoice-actions.ts`, `settings-actions.ts`, each behind `requireMember` and the module switch, owner-only for settings, credit notes and deletes. **An invoice is issued only by `commerce.issue_work_invoice()`** (gap-free number from series `work_invoice`, readiness checks, frozen snapshot; the server never computes an issued amount itself) and afterwards is immutable, corrected by `credit_work_invoice()` (the one exception is `imported = true`, WP15: history from Kaizen Life with its own number in `legacy_number`, shown as the `document_number` label, no series number, made only by `scripts/import-life-work.mjs`'s SQL under `commerce.work_importing`, never emailed); payments are append-only and set the status by trigger, which also writes the payment and invoice events (never write them again in code). Tasks and time keep their draft invoice line in step in the same transaction (`work-draft-sync.ts`). Documents are drawn from the snapshot by `InvoiceDocumentView` (print routes under the `(print)` route group, no admin chrome); the customer-facing texts are hand-written in `work-invoice-text.ts` and need review before real use. Sending and exports (`work-emails.ts`: `sendInvoiceEmail()` idempotent by key, the hosted page `/s/{store}/{market}/account/invoice/{token}` from `work_invoices.public_token`, CSVs in `work-exports.ts`); recurring invoices (`work-recurring.ts`, `prepareDueRecurringWork()` in the five-minute cron: drafts within 40 days, a deleted draft's period is skipped for good, auto-issue off by default and an email failure never undoes an issued invoice); reports (`work-reports.ts`: per currency, a fixed fee counts once in the period it is invoiced) and `workAttention()` feeding the control center. A client can be filled in from Brønnøysundregistrene's open register (D124: `src/lib/brreg.ts`, `src/server/brreg.ts`, `BrregLookup` on the client form and on a shop's company accounts (`CompanyFields`); a number or a name, only that is sent, nothing is saved from the lookup). The admin is English only.
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
  layout's body); a row's, column's or block's is its typography's `family`
  (D179, per kind of text and size), drawn as the family's `kf-{slug}` class
  by `blockBox()` (a family that differs by size as a rule), and listed by
  `partFonts()`/`pageFonts()` for its stylesheet and its install on save.
- Categories and tags (D50, `src/lib/taxonomy.ts`, `src/server/taxonomy.ts`):
  `commerce.terms` per owner (`store_id`, null for Kaizen) and kind of
  content (`page`, `article`, `product`); categories nest, tags are flat.
  Pages carry theirs in their content (`categories`, `tags`); products in
  `product_terms`. `TermsManager` and `TermPicker`
  (`src/components/admin/terms.tsx`) manage and choose them; changes
  `updateTag(termsTag(scope))`. Menus link to them by address (D52), to
  `/s/{store}/{market}/category|tag/{slug}` and Kaizen's `/category|tag/{slug}`.
- Campaigns (D114, `src/lib/campaigns.ts`, `src/server/campaigns.ts`,
  `/admin/{store}/campaigns` under Sales): offers without a code, for a time: a
  percentage off, "buy N pay for M", a free product over an amount, for the
  store, products, or categories and tags. `evaluateCampaigns()` is what the
  cart (`cartSummary()`) and `placeOrder()` both use, so they agree
  (`checkout-kinds.int.test.ts` needs a scenario for a new kind). Campaigns come
  off goods bought once before the group's discount (D108) and codes (D31),
  which count what is left; a free product is an ordinary order line at a full
  discount (`order_lines.gift`), left out of the cart-changed check and of free
  shipping's basket. A new kind of price or line that discounts keeps these
  together. Campaigns may be limited to customer groups, to a number of orders
  (locked in `placeOrder()`) and may stack (D115). They are announced on product
  pages (the `campaigns` product part) and cards from `campaignNotices()`, a
  cached read like the catalogue's: never read them per request there, keep the
  cache's expiry past five minutes, and refresh `campaignsTag` when a campaign
  changes (`updateTag` in an action, `ctx.invalidate` in an AI tool).
  A campaign may also be per customer (signed in, D116), for some countries
  only, and a stacking "buy N pay for M" works on the units still to be paid
  for; the chat agent's cards carry the offers (`offersOn()`), worded by the
  site, never by the model.
- Customer groups and company accounts (D108, `src/lib/customer-tiers.ts`,
  `src/server/customer-tiers.ts`, `src/server/companies.ts`): a group is a
  fixed percentage (`customer_tiers`, `customers.tier_id`); a company
  (`customer_companies`, `customers.company_id`/`company_role`) has a group and
  the share of it its employees get. A customer's discount is always read from
  their membership by `memberDiscountFor()`, never copied, so leaving stops it
  at once. It comes off what is bought once, before any code: `cartSummary()`
  and `placeOrder()` both use `memberLineOff()`, and the order keeps its part
  (`member_discount_minor`, `member_label`, `member_percent`); a new kind of
  price or line that discounts must keep the two together
  (`checkout-kinds.int.test.ts`). Draw an order's discount row with
  `discountNote()`. Invitations and sign-in links keep only a hash of their
  token and act from a page with a button, never from opening the link;
  accepting goes through `acceptInvite()` only. Customer routes for these live
  under `/account/…`, as a new top-level `/s/{store}/{market}/{word}` would
  reserve a page address.
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
  Deleting removes the file from Storage (`removeStoredFiles()`) and the row; several are deleted together from *Choose files* (`deleteMediaMany()`, `MEDIA_DELETE_MAX` 100 a request, the library asks again for a larger choice, one audit entry a request, the confirmation says how many are in use).
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
- Profile pictures (D97, `src/server/avatars.ts`, `src/lib/avatar.ts`,
  `src/lib/gravatar.ts`): accounts and customers have `avatar_path` in the
  public `avatars` bucket, set with `AvatarPicker`. Draw anyone with
  `<Avatar avatar={avatarFor(person)} />`: their picture, else their
  Gravatar through the signed `/api/gravatar/{hash}` proxy (never link to
  Gravatar from a page), else their initials.
- Light and dark (D99, `src/lib/color-mode.ts`): a person's choice is
  `data-color-mode` on `<html>`, else the device's; globals.css, `dark:`,
  store themes (`themeCss()`) and logos (`LogoPicture`) follow it, so never
  read `prefers-color-scheme` directly (use `showsDark()`/`useShowsDark()`).
  The admin's is the account's (`accounts.color_mode`, Your account and the
  headers' switch); a store's visitors choose where `visitorSwitch` is on.
- Owners' own CSS (D100, `src/lib/custom-css.ts`, `CssPanel`): a page's
  (`PageContent.css`) and the site's (`stores.custom_css`,
  `platform_settings.custom_css`, `saveSiteCss()`), edited in the builder's
  Custom CSS panel. Draw it only through `<CustomCss>` on the site and
  `<ScopedCss>` in the admin (kept inside its box), which check it with
  `cssProblem()` again; never put owner CSS in a page any other way.
- Slack (D101, `src/lib/slack.ts`, `src/server/slack.ts`): a third
  integration (`store_integrations.provider` `slack`) with D41's events,
  queue and retries, sent as messages by `slackMessage()`: never shoppers'
  emails, phones or addresses, and everything they or staff wrote through
  `escapeSlack()`/`slackLink()`. Owners connect with "Add to Slack" (only
  the `incoming-webhook` scope, `SLACK_CLIENT_ID`/`_SECRET`, callback
  `/api/integrations/slack/callback`) or paste a webhook; Kaizen keeps no
  Slack token. A new event gets a message there too.
- Subscription boxes (D102, named so in every text shoppers and staff read; `src/lib/standing-orders.ts`, `src/server/standing-orders.ts`,
  `/s/{store}/{market}/deliveries`, `/admin/{store}/deliveries`): a module
  (`deliveries`). A shopper's standing list (`standing_orders`, lines in
  `standing_order_lines`) on a store's delivery day (`delivery_schedules`)
  becomes that delivery's order at the cutoff (`prepareDueDeliveries()` in the
  five-minute cron, `standing_deliveries` once per list and day), always
  through `placeOrder()` from a cart of its own; a change after a cutoff first
  makes that delivery (`prepareDueFor()`). The order waits for payment until
  sent: Mark sent calls `chargeDelivery()` (the card saved in Stripe's setup
  mode, off session) and only a paid order is marked sent; a refusal emails a
  pay link (`startDeliveryPayment()`), and `applySession()` neither cancels a
  delivery's order nor changes its address. Rounds and cutoffs come from
  `nextRound()`/`currentRound()` in the store's time zone.
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
