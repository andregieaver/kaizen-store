# Rules: Data in and out, APIs and integrations

Part of the admin's rules (`docs/rules/admin/README.md`), moved verbatim from `docs/rules/admin.md` on 31 October 2026 (PSI CODE-05).
CLAUDE.md keeps one line per rule pointing here; each rule is under that line as its heading.

## Data in and out (wave 2, D165, `docs/wave-2-data.md`)

- **Data in and out (wave 2, D165, `docs/wave-2-data.md`)**: imports and exports are `commerce.data_jobs` (`src/server/data-jobs.ts`; run in ticks by `after()`, the open page's tick route and the five-minute cron, each claim with an expiry; files are in the private `imports` and `exports` buckets, written only by the server through `DataStorage` in `src/server/data-job-store.ts`, deleted after 7 days by `pruneDataJobs()`, which lists the job's folder `{store}/{job}/` instead of trusting the row and sweeps folders no row names). Every CSV is written and read only by `src/lib/csv.ts` (`writeCsv()`, OWASP's formula characters escaped; amounts by `amountCell()` from integer minor units, never `decimalAmount()`, which is the D161 files'; Excel (Nordic) is a dialect); never join cells by hand (`csv-writers.test.ts`). A product import goes only through `getProductForEdit()` and `saveProduct()` (`product-import-writers.test.ts`), after the picture fetches and the term creation, reading the store again immediately before saving; it never deletes, never changes a handle, never imports a compare-at price, never turns `Vendor` into a manufacturer or `Charge tax` into the exempt VAT category, and fetches pictures only through `safeFetch()`. `saveProduct()` takes an optional `StockMode`, so an import or a bulk edit never writes back a stock it read before a sale was paid (the bulk 'adjust' is relative). A bulk action does the same and records before and after in `bulk_edit_items` for the undo; one audit entry per batch or job, never per product. Order and customer files are owner-only (`requireOwnerRole`), minimal by default, mark copied (`C-`), host and Stripe test-mode (`test_payment`) orders, carry no personal field of an erased person's order, never a secret or token (canary tests), are never emailed, and an erasure deletes only the ready files that can hold the person (`removePersonalExports()` with an `ExportScope`); the end of a date range is the store's next local midnight (the date plus one, never an interval on a timestamptz); the customer file's `marketing_consent` is `not_recorded` until wave 5 records consent. Main-currency columns are indicative and blank without a rate; a new money read here needs a euro scenario in `checkout-kinds.int.test.ts`. Every analytics table is in `ANALYTICS_TABLES` with a CSV button (`analytics-export-views.test.ts` fails for a table with none); its figures come from the page's own loaders, and the VAT, OSS and IOSS tables keep D161's files. New tables are `never` in `COPY_RULES`.

## The WordPress plugin (D169, `docs/wordpress-plugin.md`, `wordpress-plugin/kaizen-store/`, `public/downloads/kaizen-store-wordpress.zip`)

- **The WordPress plugin (D169, `docs/wordpress-plugin.md`, `wordpress-plugin/kaizen-store/`, `public/downloads/kaizen-store-wordpress.zip`)**: a site is connected by an owner's approval at `/admin/account/wordpress/connect` (`readApproval()` in `src/lib/wordpress.ts`: https only, the return address on the site's own origin) and a one-time code swapped for a token with a verifier (`exchangeCode()`); tokens and codes are kept only as hashes in `commerce.wordpress_connections`, written only by `src/server/wordpress.ts`. `/api/wordpress/v1/*` is read-only and starts with `asPlugin()`/`asPluginForStore()` (`src/server/wordpress-route.ts`: token, rate limit, the account's membership looked up on every call, a store that is not theirs is a plain 404); a view of products is `viewQuery` through `listGridProducts()` (the grid's own read) and its prices are written by `wordpressPrice()` from `<Price>`'s rules, so the plugin never works out a price, a VAT label, a reduction or a unit price. A view with nothing chosen shows nothing, never everything. Nothing private (orders, customers, settings) is ever served there, and a new route reads only what a shopper can see. The zip is built by `node scripts/build-wordpress-plugin.mjs` to the same bytes every time, and `src/lib/wordpress-plugin.test.ts` fails when it is not the plugin as it is: change the plugin, rebuild, commit both. **Product page and cart (D170)**: a cart held on the site is priced by `quoteCart()` (`src/server/wordpress-shop.ts`, live price, stock and words, a subtotal and nothing else) and handed over by `createHandoffCart()` (`src/server/cart-handoff.ts`): the same checks as adding in the store (`sellableQuantity()`), goods and downloads only (`cartableReason()` in `src/lib/wordpress-cart.ts`), never a cart when nothing can be bought, a link kept as a hash (`carts.handoff_hash`) that `/s/{store}/{market}/cart/resume` opens once to set the cart cookie; a new kind of product that needs more than a variant (a time, a plan, a choice) is not cartable until the store's own page can be bypassed for it, and anything that changes how the store prices a cart gets a case in `wordpress.int.test.ts`, which holds the quote to the cart the store shows. The plugin registers its scripts at `init` (block themes draw content before they queue scripts), and `node scripts/build-wordpress-plugin.mjs` is run after any change to it.

## Events to an owner's own endpoints (wave 9 unit A, D354, `src/lib/webhook-signature.ts`, `src/server/webhook-endpoints.ts`)

- **Events to an owner's own endpoints (wave 9 unit A, D354, `src/lib/webhook-signature.ts`, `src/server/webhook-endpoints.ts`)**: an
  endpoint is `commerce.webhook_endpoints` (owners only, up to `ENDPOINTS_MAX`, written only by `webhook-endpoints.ts`: the address through
  `checkEndpointUrl()` and `hostProblem()`, address and secret encrypted, the secret shown once), queued by `commerce.queue_integration_event()`
  as a delivery of provider `webhook` with its `endpoint_id`, and sent only by `deliverDue()` through `postSigned()` (`safeFetch()`, no
  redirect) with `signWebhook()`'s headers and `endpointPayload()`'s versioned body (`PAYLOAD_VERSION`; a change to a shape raises it). A new
  topic is an id in `EVENTS` (in `ENDPOINT_ONLY` unless the services get it too), a trigger that calls `queue_integration_event()` where it
  happens, its case in `subjectData()` and its words in the `notifications` catalogues; never send an endpoint's payload a way of its own.

## The Admin API (wave 9 unit B, D355, `src/lib/admin-api.ts`, `src/server/api-tokens.ts`, `src/server/admin-api.ts`)

- **The Admin API (wave 9 unit B, D355, `src/lib/admin-api.ts`, `src/server/api-tokens.ts`, `src/server/admin-api.ts`)**: tokens are
  `commerce.api_tokens` (owners, Settings → Apps and API; a hash only, shown once), written only by `api-tokens.ts`; a call is
  `/api/admin/v1/{resource}` with a Bearer token read by `apiCaller()` (the maker's membership read again, owners only), routed by
  `routeOf()` with the one scope each route needs (`grants()`), budgeted by `takeBudget()` (`api`), and answered by `runApiRoute()` through the
  screens' own functions only, each change audited `integration.api_{what}` with the token's name. A new route is a case in `routeOf()` and
  `API_ROUTES` with its scope, a case in `runApiRoute()` over the screen's function, and a test; a gated effect (publishing, a live product,
  a refund, an email a person decides) is refused as `gated`, never run.

## The storefront API (wave 9 unit I, D362, `src/lib/storefront-api.ts`, `src/server/storefront-api.ts`, `src/server/storefront-route.ts`)

- **The storefront API (wave 9 unit I, D362, `src/lib/storefront-api.ts`, `src/server/storefront-api.ts`, `src/server/storefront-route.ts`)**:
  `/api/storefront/v1/{store}/…` answers only through `asStorefront()` (the store's own token, `storefrontProblem()`, the `storefront`
  budget) and only from the storefront's own reads (`viewOf()`, `productPageOf()`, `termsOf()`, `quoteCart()`, `handoffCart()`); tokens are
  written only by that module. A new route reads only what a visitor of the token's market sees, never prices or stocks a thing itself, and
  places no order. A cart kept through the API (D398) is a real cart (`carts.source = 'api'`) found only by its key's hash, changed only by
  `src/server/api-carts.ts` through the store's own line checks, read through `quoteCart()`, and handed to checkout by the one-time link that
  clears its key; a new route is an entry of `STOREFRONT_ROUTES` with its words, which the OpenAPI document (`storefrontOpenApi()`) is made from.

## Workflows (wave 9 unit C, D356, `src/lib/workflows.ts`, `src/server/workflows.ts`)

- **Workflows (wave 9 unit C, D356, `src/lib/workflows.ts`, `src/server/workflows.ts`)**: a workflow is `commerce.workflows`, written only by
  `workflows.ts` (saved off; on only once *Test* ran the version saved); its runs are made by the database's `queue_integration_event()` (once
  per workflow, event and transaction, capped at `RUNS_PER_HOUR`) and by `queueScheduledRuns()`, and run only by `runWorkflows()` in the
  integrations job, reading the event as `subjectData()` builds it. A new action is a kind in `ACTION_KINDS` with its schema, `actionsFor()`,
  its case in `act()` through its screen's function, words in the `notifications` catalogues and a test; it never emails a customer, refunds
  or spends, and never makes an event a workflow waits for. A new trigger is an event of `EVENTS` (unit A) with its fields in `WORKFLOW_FIELDS`.

## Moving in from another shop (wave 11 unit E, D384, `src/lib/product-csv-woocommerce.ts`, `src/lib/order-history.ts`,…

- **Moving in from another shop (wave 11 unit E, D384, `src/lib/product-csv-woocommerce.ts`, `src/lib/order-history.ts`, `src/server/order-history-import.ts`)**: WooCommerce's product export is read by `readWooCommerce()` into the product import's neutral rows, so it is planned and saved only as any product file is (D165); a product the import makes leaves a manual redirect from `oldProductAddress()` through `addRedirects()` in the starter's name read again (`ImportOptions.redirects`), so a new source shop's file is a reader, a format in `FileFormat` and the `data_jobs_format` check, and its old address there. Shopify's order export is the job kind `order_history_import` (the owner's), each order written only by `insertHistoryOrder()` in `order-insert.ts` as a copied order (`C-{name}`, `copied_from` a key of the store and the name), tied to a customer only by an email the store already has; nothing pays, emails, invoices or counts it, so a reader that skips copied orders needs nothing more.

## Kaizen Life (D95, `src/server/kaizen-life.ts`)

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

## Duplicating a store (D129, `docs/store-copy.md`, `src/lib/store-copy.ts`, `src/lib/store-copy-rules.ts`, `src/server/store-copy.ts`,…

- Duplicating a store (D129, `docs/store-copy.md`, `src/lib/store-copy.ts`, `src/lib/store-copy-rules.ts`, `src/server/store-copy.ts`, `commerce.duplicate_store()`): the content step is one SQL transaction, pictures, customers and orders follow as a resumable job run from the five-minute cron. Every store-owned table is classified in `COPY_RULES` (settings, catalogue, pages, people, orders, derived, never) and a test fails when a table is missing, so a new store-owned table, secret or per-store identifier needs a decision there, in `duplicate_store()` if it is copied, and in the media rewriting if it holds file addresses. A copied order is history (`orders.copied_from`, number `C-…`): never add code that pays, refunds, ships, invoices, emails, reserves stock for or counts one in revenue; new readers of `orders` that add up money or act on orders skip `copied_from is not null`. Customers are copied without credentials or consents; never copy a Stripe account, payment credential, domain, integration, AI key, invoice series or Work data.

## Slack (D101, `src/lib/slack.ts`, `src/server/slack.ts`)

- Slack (D101, `src/lib/slack.ts`, `src/server/slack.ts`): a third
  integration (`store_integrations.provider` `slack`) with D41's events,
  queue and retries, sent as messages by `slackMessage()`: never shoppers'
  emails, phones or addresses, and everything they or staff wrote through
  `escapeSlack()`/`slackLink()`. Owners connect with "Add to Slack" (only
  the `incoming-webhook` scope, `SLACK_CLIENT_ID`/`_SECRET`, callback
  `/api/integrations/slack/callback`) or paste a webhook; Kaizen keeps no
  Slack token. A new event gets a message there too.
