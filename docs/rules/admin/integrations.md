# Rules: Data in and out, APIs and integrations

Part of the admin's rules (`docs/rules/admin/README.md`), moved verbatim from `docs/rules/admin.md` on 31 October 2026 (PSI CODE-05).
CLAUDE.md keeps one line per rule pointing here; each rule is under that line as its heading.

## Data in and out (wave 2, D165, `docs/wave-2-data.md`)

- **Data in and out (wave 2, D165, `docs/wave-2-data.md`)**: imports and exports are `commerce.data_jobs` (`src/server/data-jobs.ts`; run in ticks by `after()`, the open page's tick route and the five-minute cron, each claim with an expiry; files are in the private `imports` and `exports` buckets, written only by the server through `DataStorage` in `src/server/data-job-store.ts`, deleted after 7 days by `pruneDataJobs()`, which lists the job's folder `{store}/{job}/` instead of trusting the row and sweeps folders no row names). Every CSV is written and read only by `src/lib/csv.ts` (`writeCsv()`, OWASP's formula characters escaped; amounts by `amountCell()` from integer minor units, never `decimalAmount()`, which is the D161 files'; Excel (Nordic) is a dialect); never join cells by hand (`csv-writers.test.ts`). A product import goes only through `getProductForEdit()` and `saveProduct()` (`product-import-writers.test.ts`), after the picture fetches and the term creation, reading the store again immediately before saving; it never deletes, never changes a handle, never imports a compare-at price, never turns `Vendor` into a manufacturer or `Charge tax` into the exempt VAT category, and fetches pictures only through `safeFetch()`. A product's `price_on_request` and its words around the price (`price_words`, `price_prefix[:locale]`, `price_suffix[:locale]`, D434) are read as the editor's own: each word checked by `priceWordProblem()`, a blank flag or choice and an absent column keeping the product's; a new product-level column follows the same rule (absent keeps, compared in `canonical()`, a finding code with its `FIX_FOR`). `saveProduct()` takes an optional `StockMode`, so an import or a bulk edit never writes back a stock it read before a sale was paid (the bulk 'adjust' is relative). A bulk action does the same and records before and after in `bulk_edit_items` for the undo; one audit entry per batch or job, never per product. Order and customer files are owner-only (`requireOwnerRole`), minimal by default, mark copied (`C-`), host and Stripe test-mode (`test_payment`) orders, carry no personal field of an erased person's order, never a secret or token (canary tests), are never emailed, and an erasure deletes only the ready files that can hold the person (`removePersonalExports()` with an `ExportScope`); the end of a date range is the store's next local midnight (the date plus one, never an interval on a timestamptz); the customer file's `marketing_consent` is `not_recorded` until wave 5 records consent. Main-currency columns are indicative and blank without a rate; a new money read here needs a euro scenario in `checkout-kinds.int.test.ts`. Every analytics table is in `ANALYTICS_TABLES` with a CSV button (`analytics-export-views.test.ts` fails for a table with none); its figures come from the page's own loaders, and the VAT, OSS and IOSS tables keep D161's files. New tables are `never` in `COPY_RULES`.

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
  Each topic's `data` is typed in `WEBHOOK_TOPICS` (D438, `src/lib/webhook-topics.ts`): a builder returns its `WebhookSubject<…>` and
  `subjectData()` checks what it built against the topic's schema, logging a drift (`webhooks.payload_shape`, paths only) and never holding a
  delivery back; within `PAYLOAD_VERSION` 1 a payload only gains fields. A new topic or subject also gets its schema there, its subject made
  in `webhook-topics.int.test.ts`, and the contract's next version (*API contracts*, under the Admin API).

## The Admin API (wave 9 unit B, D355, `src/lib/admin-api.ts`, `src/server/api-tokens.ts`, `src/server/admin-api.ts`)

- **The Admin API (wave 9 unit B, D355, `src/lib/admin-api.ts`, `src/server/api-tokens.ts`, `src/server/admin-api.ts`)**: tokens are
  `commerce.api_tokens` (owners, Settings → Apps and API; a hash only, shown once), written only by `api-tokens.ts`; a call is
  `/api/admin/v1/{resource}` with a Bearer token read by `apiCaller()` (the maker's membership read again, owners only), routed by
  `routeOf()` with the one scope each route needs (`grants()`), budgeted by `takeBudget()` (`api`), and answered by `runApiRoute()` through the
  screens' own functions only, each change audited `integration.api_{what}` with the token's name. `routeOf()` and `API_ROUTES` are made
  from `ADMIN_API` (D438, `src/lib/admin-api-routes.ts`), the one description of every operation. A new route is an entry there (method,
  path, name, scope, words, the zod of its parameters, query, body and answer, its errors), a case in `answerRoute()` over the screen's
  function that reads its body with `readBody()` (never a raw body: the API says what is wrong before the screen's own checks) and builds
  its answer as `AdminAnswer<name>`, and a call in `admin-api.int.test.ts`, which parses every answer with its schema and fails until every
  operation's was parsed; then the contract's next version (*API contracts*, under the Admin API). A gated effect (publishing, a live product, a refund,
  an email a person decides) is refused as `gated`, never run, unless the token holds the power scope for it (D440: `products:publish`),
  which is checked in the handler (`holds()`) on top of the route's own scope.
  **What a scope allows (D440 review):** the twelve scopes of D355 (`SCOPES_BEFORE_D440`) allow what they did then and never more, so an
  operation that existed keeps its scope and every new write gets a scope no older token holds (`products:manage`, `orders:manage`,
  `customers:manage`, `content:write`, or a power); a new read may sit under its area's read scope. What an owner tool asks the owner's
  yes for (`gate` `public`, `send` or `spend` in `OWNER_TOOLS`) is a power (`API_POWERS`: `products:publish`, `orders:send`,
  `orders:refund`, `customers:email`, `discounts:publish`, `gift_cards:write`, `content:publish`, `webhooks:write`), offered on the token
  screen under *Customise*; `admin-api-routes.test.ts` holds the registry to both. Every scope of an area reads it (`grants()`). Each
  scope's words say exactly what it allows: the token screen's (`scopeWords`, every language) and the contract's (`SCOPE_TEXT`). Powers
  are the Admin API's only: no OAuth level grants one, and before `kfa_` tokens reach this API (unit D) each power must be checked against
  the person's permission at every call.
  **Its breadth (wave 14 unit C, D440, `docs/wave-14-developer-platform.md` C1 to C4):** each slice's entries live in their own file
  (`src/lib/admin-api-catalogue.ts`, …) spread into `ADMIN_API`, written with `admin-api-shapes.ts`, and their handlers in the server file of
  the same name over `admin-api-kit.ts` (`ok()`, `fail()`, `readBody()`, `paging()` with `cursorAt()` and `sinceWhere()`, `record()`). Every
  entry names the staff `permission` (D158) its screen asks and, where it has one, the store `feature` (D178): the route refuses a missing
  permission as `forbidden` (`memberCan()`: a store that is not open keeps, as the admin does, only `orders:*`, `customers:*`,
  `analytics:*`, `support:read`, `billing:read`, `staff:read` and `owner`, so its products, discounts, website and settings are refused
  read or changed) and a feature off as `feature_off`, before the handler runs. A list of the store's records takes `?updated_after=` over
  the row's own change time (an order's is `ORDER_UPDATED`, its timeline's latest entry); the short lists of one thing do not (stock
  locations, a product's gallery, an order's refunds and notes, content types, webhook endpoints and deliveries). Every list pages under a
  cursor exact to the microsecond, keyed by what makes a row one (a stock level by variant and location). An `Idempotency-Key` stands for
  the method, the whole path and the body (`claimIdempotencyKey()`). Pictures come only through `POST /media/uploads` (a row of
  `commerce.api_uploads`, written only by `src/server/api-uploads.ts`, and a one-time signed address in the private `api-uploads` bucket,
  picture types only up to `UPLOAD_MAX_BYTES`, the bucket's own limit) and `POST /media`, which checks the file from its bytes (at most
  `UPLOAD_MAX_PIXELS`, read before it is decoded), shrinks it as the admin's browser does (`shrinkPicture()`), counts it against storage
  and keeps it with `storePicture()`; a product's gallery, categories and tags change only through `updateProductTool()`. `inventory.updated` waits for the next whole minute (`queue_integration_event()`), so a variant's moves in
  that minute are one delivery built as the stock is then. Orders (C2, `admin-api-orders.ts`): a draft changes only through the editor's own
  state (`formFromDraft()`, the API's change laid over it, `inputFromForm()`, `saveDraft()` against its version), is sent only by
  `sendDraft()` and a request declined only by `declineQuote()`; money goes back only through `refundOrder()` with the power `orders:refund`
  (a store credit's code is never answered); an unpaid order is cancelled only by `cancelUnpaidByStaff()` (its payment pages closed first);
  a return moves only through the returns page's steps; notes and tags through `addOrderNote()` and `changeOrderTags()`. The orders' topics are
  queued by triggers where they happen (`order.created` on insert, `order.updated` on `edited_at`, `fulfilment.*` on shipments and
  `shipment_tracking`, `refund.created` for money or store credit that went through, `return.updated` on a status, `quote.requested` and
  `draft.sent` on `draft_orders`), copied history never. Customers and marketing (C3, `admin-api-customers.ts`): a customer changes only through
  `createCustomer()`/`updateCustomer()` (the form's whole state from `staffFormValues()` with the change laid over it), a discount code only
  through `saveDiscount()` with its stored form (what it reaches and who may use it stay the admin's), a gift card only through
  `issueGiftCard()` and `deactivateGiftCard()` with the power `gift_cards:write`, a subscription only through `changeSubscription()` as staff
  (with the subscriber's email); a segment is answered with how many it holds, never who, and a subscription never with its manage link.
  Something shown once (a gift card's code, a draft's pay link, a webhook secret, an upload address) is answered once and never kept for a
  replay: the handler gives `ApiAnswer.replay` without it, and only that is kept under the `Idempotency-Key`. A customer's email (what they
  sign in with) changes only with the power `customers:email`. `customer.erased` is queued by `eraseSubject()` in its own transaction with
  the account's id alone, and its payload is built without reading anything; in the same transaction every delivery about the person (their
  account, orders, subscriptions, drafts and reviews) loses its payload and is marked `erased_at`, a waiting one is not sent, and
  `resendDelivery()` never sends one again. Content, the store and operations (C4,
  `admin-api-content.ts`): a page or article is written only through `savePage()` (a draft; publishing with the power `content:publish`, its
  checker's blocking issues acknowledged by id; a draft carrying `globalEdits` is refused, as global parts change every page using them; a
  new address of a page never published that moves published pages under it takes `content:publish`), an entry only through
  `saveEntry()`/`publishEntry()` (a published entry's new address takes `content:publish`), an endpoint only through the
  Integrations page's writers with the power `webhooks:write` (its secret answered once, its address never), a saved report run only by
  `runReport()`, and the product file only through the Data page's own steps with the storage named for each call (`jobDeps()`); order and
  customer files stay in the admin (owner-only, personal data). An import by a token without `products:publish` is checked with
  `draftsOnly` (the plan refuses a product it would publish, archive, bring back or change on the site, `product.on_site`, in the check and
  again in the apply's fresh plan; a job's options are fixed once checked) and counts them (`dry.onShop`): its apply is refused as `gated`
  and the job cancelled when the count is not 0, or when the job was not checked drafts only. Settings are read, never written, over the API.

- **API contracts (wave 14 unit A, D438, `src/lib/admin-api-routes.ts`, `src/lib/webhook-topics.ts`, `src/lib/mcp-catalogue.ts`, `src/lib/api-contract.ts`)**, for this API, the storefront API, the webhooks and the MCP servers:
  what outside callers rely on is described once, in code, and everything published is generated from it: the Admin API's operations
  (`ADMIN_API`) and the storefront's routes (`STOREFRONT_ROUTES`) as OpenAPI 3.1 (`adminOpenApi()`, `storefrontOpenApi()`, `jsonSchemaOf()`
  over `z.toJSONSchema()`), the webhook topics (`WEBHOOK_TOPICS`, `webhookCatalogue()`, also the Admin API document's `webhooks`), the owner
  MCP's tools (`MCP_TOOLS`, `mcpCatalogue()`) and the shopping agents' (`UCP_TOOLS`, `ucpCatalogue()`). They are served public, cached an
  hour and with no store's data at `/api/admin/v1/openapi.json`, `/api/storefront/v1/openapi.json`, `/api/webhooks/v1/topics.json`,
  `/api/mcp/catalogue.json` and `/api/ucp/catalogue.json`; never write a reference page or a list of routes, topics or tools by hand. A tool's
  title and MCP annotations are worked out beside it (`toolTitle()`, `toolAnnotations()`), never by changing its description or input (that
  would move the eval's `toolsVersion()`): a new owner tool that only reads but needs a permission not named `:read` goes in
  `OWNER_KEY_READS`, one that reaches a service or people outside in `OPEN_WORLD` (`mcp-catalogue.test.ts` asks). Within a major version
  nothing a caller relies on is renamed or removed, and a request is never made to send a new field; answers and payloads may gain fields.
  **Adding a route, a topic or a tool** is, in order: its entry (`ADMIN_API`, `STOREFRONT_ROUTES`, `WEBHOOK_TOPICS` with its subject's
  schema, or the tool in `OWNER_TOOLS`) with its zod; its handler or builder typed by it (`AdminAnswer<…>`, `WebhookSubject<…>`) and its
  test parsing what it answers; then `WRITE_API_CONTRACT=1 pnpm exec vitest run src/lib/api-contract.test.ts`, which records the new hash and
  surface in `src/data/api-contract.json` and `src/data/api-contract-surface.json` as the next `1.<n>` (the next major when something breaks);
  then the version's entry at the top of `content/docs/developers/changelog.md` (`## 1.<n> — YYYY-MM-DD`, what changed for callers). The
  contract test fails until all of it is done, and fails a removed path or field within the major version.

## Kaizena Flow's authorization server and the open owner MCP (wave 14 unit B, D439, `src/lib/oauth.ts`, `src/server/oauth.ts`, `src/server/oauth-clients.ts`)

- **Kaizena Flow's authorization server and the open owner MCP (wave 14 unit B, D439, `src/lib/oauth.ts`, `src/server/oauth.ts`, `src/server/oauth-clients.ts`)**:
  Kaizena Flow is an OAuth 2.1 authorization server (RFC 8414 metadata at `/.well-known/oauth-authorization-server`, issuer `siteUrl()`;
  the owner MCP's protected resource metadata at `/.well-known/oauth-protected-resource` and `…/api/mcp` names it first and Supabase's
  while Kaizen Life uses it). Clients are `commerce.oauth_clients`, written only by `oauth-clients.ts`: a Client ID Metadata Document is
  fetched only through `safeFetch()` (HTTPS, 5 seconds, 64 KB, no redirect), checked by `readClientMetadata()` and kept for its cache
  headers, at most a day; RFC 7591 registration (`/api/oauth/register`) is public only, HTTPS or loopback redirects by `application_type`,
  ten an hour from an address (`oauth_register`, failing closed); a redirect URI matches exactly but a loopback's port (`redirectMatches()`),
  and a request whose client or redirect URI does not check out is shown on the page, never sent anywhere. Grants and tokens are
  `commerce.oauth_grants` and `oauth_tokens`, written only by `oauth.ts`: CSPRNG strings kept only as SHA-256 and found by it; a code lives 60
  seconds, is used once, with PKCE S256 and its redirect URI; an access token (`kfa_`) lives an hour and is bound to its grant's resource
  (`OAUTH_RESOURCES`, read only with `oauthAccess(token, resource)`); a refresh token (`kfr_`) is rotated at every use, and a code or refresh
  token used twice ends its family; RFC 7009 revocation, *Disconnect* (Account → Connected apps and assistants) and an owner's *Cut off*
  (Settings → Apps and API) end it at once; a blocked client's grants end. The consent screen is `/admin/oauth/authorize` (`/oauth/authorize`
  sends the request there unchanged), never framed (`oauthRouteHeaders()`); its action reads the request again, offers only stores where the
  person holds something (one that requires two-step only at `aal2`, which the grant keeps) and makes the scopes with `grantScopes()` (the
  level's, narrowed by *Choose permissions*, never more than held); every decision is audited (`oauth.approved` per store, `oauth.denied`).
  A token's power is its grant's scopes ∩ the person's role **now**: the MCP reads the membership with `passMembership()` and caps it with
  `limit` (`PermissionHolder.limit`, which `can()` and so `memberCan()` and every tool's own check honour); a tool whose scope the grant lacks
  is a 403 with one `insufficient_scope` challenge (`scopesMissing()`, `toolScope()`), and `tools/list` lists only what the grant and the
  role allow. Under *Read and propose changes* every tool that is not read-only is kept for a yes (`ApprovalCategory` `change`); kept calls
  land in the client's conversation (`clientConversation()`, "From Claude"), named on the approval and in the notice, and only for a person
  who can open the AI manager. A turn an outside assistant asked for (`TurnInput.outside`, Kaizen Life's too) offers only
  `OUTSIDE_MANAGER_TOOLS` and no custom app (no memories, no referrals), never decides a kept change in words and learns nothing; a client
  of ours asks only in its own conversation (never the owner's admin one, which only Kaizen Life may go on in), and its outside approvals
  carry their grant and expire with it. A client's name is shown and passed on only through `safeClientName()`, and names that could pass
  for Kaizena Flow are refused. A wrong authorization request goes back only to a client Kaizena Flow vouches for (`sendsErrorsBack()`).
  A store's or the site's budget counts an ask only within the caller's own (`budgetRoom()`); the token endpoint is counted per client.
  MCP calls are held to `memberCan()`. Its prompt names the assistant (`managerPrompt()`'s `outside`, quoted by `assistantName()`, which
  cleans it with `safeClientName()`), and the manager's prompt version covers that drawing. Every MCP call, refused ones too, is audited
  (`integration.mcp_call`, `via: "mcp"` and the client) and budgeted (`takeMcpBudget()`: 120 a minute a grant, 1,200 a store), batches at
  most ten, bodies at most 100 KB. A new owner tool needs nothing here beyond its permission key; a new resource (the Admin API, unit D) is an
  entry of `OAUTH_RESOURCES` and of `oauth_grants_resource`, and its door reads tokens with `oauthAccess()`. Never log or audit a token, code
  or secret.

## The storefront API (wave 9 unit I, D362, `src/lib/storefront-api.ts`, `src/server/storefront-api.ts`, `src/server/storefront-route.ts`)

- **The storefront API (wave 9 unit I, D362, `src/lib/storefront-api.ts`, `src/server/storefront-api.ts`, `src/server/storefront-route.ts`)**:
  `/api/storefront/v1/{store}/…` answers only through `asStorefront()` (the store's own token, `storefrontProblem()`, the `storefront`
  budget) and only from the storefront's own reads (`viewOf()`, `productPageOf()`, `termsOf()`, `quoteCart()`, `handoffCart()`); tokens are
  written only by that module. A new route reads only what a visitor of the token's market sees, never prices or stocks a thing itself, and
  places no order. A cart kept through the API (D398) is a real cart (`carts.source = 'api'`) found only by its key's hash, changed only by
  `src/server/api-carts.ts` through the store's own line checks, read through `quoteCart()`, and handed to checkout by the one-time link that
  clears its key; a new route is an entry of `STOREFRONT_ROUTES` with its words, its query, body and answer as zod and its refusals (D438),
  which the OpenAPI document (`storefrontOpenApi()`) is made from, its `route.ts` under `src/app/api/storefront/v1/[store]`
  (`api-routes.scan.test.ts` holds the files and the entries together), its answer parsed with `asPublished()` in
  `storefront-api.int.test.ts`, and the contract's next version (*API contracts*, under the Admin API).

## Workflows (wave 9 unit C, D356, `src/lib/workflows.ts`, `src/server/workflows.ts`)

- **Workflows (wave 9 unit C, D356, `src/lib/workflows.ts`, `src/server/workflows.ts`)**: a workflow is `commerce.workflows`, written only by
  `workflows.ts` (saved off; on only once *Test* ran the version saved); its runs are made by the database's `queue_integration_event()` (once
  per workflow, event and transaction, capped at `RUNS_PER_HOUR`) and by `queueScheduledRuns()`, and run only by `runWorkflows()` in the
  integrations job, reading the event as `subjectData()` builds it. A new action is a kind in `ACTION_KINDS` with its schema, `actionsFor()`,
  its case in `act()` through its screen's function, words in the `notifications` catalogues and a test; it never emails a customer, refunds
  or spends, and never makes an event a workflow waits for. A new trigger is an event of `EVENTS` (unit A) with its fields in `WORKFLOW_FIELDS`.

## Moving in from another shop (wave 11 unit E, D384, `src/lib/product-csv-woocommerce.ts`, `src/lib/order-history.ts`,…

- **Moving in from another shop (wave 11 unit E, D384, `src/lib/product-csv-woocommerce.ts`, `src/lib/order-history.ts`, `src/server/order-history-import.ts`)**: WooCommerce's product export is read by `readWooCommerce()` into the product import's neutral rows, so it is planned and saved only as any product file is (D165); a product the import makes leaves a manual redirect from `oldProductAddress()` through `addRedirects()` in the starter's name read again (`ImportOptions.redirects`), so a new source shop's file is a reader, a format in `FileFormat` and the `data_jobs_format` check, and its old address there. Shopify's order export is the job kind `order_history_import` (the owner's), each order written only by `insertHistoryOrder()` in `order-insert.ts` as a copied order (`C-{name}`, `copied_from` a key of the store and the name), tied to a customer only by an email the store already has; nothing pays, emails, invoices or counts it, so a reader that skips copied orders needs nothing more. Moving from Shopify and the other platforms is planned in `docs/moving-from-*.md` (D445 to D451); a mover's writes go through these same writers, never its own, and the old shop's links are checked by D445 step 1 (`docs/rules/admin/website.md`, Redirects).

## Moving from Shopify (D445, `docs/moving-from-shopify.md`, `src/lib/old-shop.ts`, `src/lib/shopify.ts`, `src/server/shopify-connect.ts`)

- **Moving from Shopify (D445, `docs/moving-from-shopify.md`, `src/lib/old-shop.ts`, `src/lib/shopify.ts`, `src/server/shopify-connect.ts`)**: built in the plan's steps (section 17 says which). Step 1, the old shop's links, is a rule of Redirects (`docs/rules/admin/website.md`). Step 2 connects Kaizena Flow's own Shopify app (`shopify/shopify.app.toml`, `shopifyEnv()`; off without `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET`) at Settings → Moving in, the owner's alone: read scopes only (`SHOPIFY_SCOPES`, never a `write_`, the file and the code kept equal by `shopify.test.ts`), Shopify's authorization code grant with `expiring=1`, its callback checked for the sealed state (store, account, shop), Shopify's HMAC and an anchored `myshopify.com` name before the code is spent, the tokens encrypted in `commerce.shop_moves` (written only by `shopify-connect.ts`, `never` in `COPY_RULES`, `secret` in the store's file), refreshed under the row's lock (`shopifyAccess()`; a refused refresh or a 401 disconnects), and every call to Shopify built only from a name `isMyshopify()` passed. A later step reads Shopify only through `shopifyGraphql()`. Step 4's copy (`src/server/shopify-copy.ts`) writes no table but `shop_moves.copy`: each feed becomes Shopify's own export file (`src/lib/shopify-copy.ts`) and goes through its import's register, check and apply, never a writer of its own; a new feed is a bulk query, a file its import reads back (tested by reading the file with the import's own reader in `shopify-copy.test.ts`) and a row of `STEPS`. Where no import exists (pages, blog posts, menus) a feed goes to that table's own writer (`savePage()`, `saveBlog()`, `saveStoreMenu()`), never SQL of its own, leaves an address or name already taken alone, and turns HTML into rich text only through `htmlToRichText()` (`src/lib/html-rich-text.ts`), whose output `cleanRichText()` always takes. The shop's settings (countries, shipping, discount codes, look; `src/server/shopify-settings-copy.ts`) go only through `setMarkets()`, `saveShippingSettings()`, `saveDiscount()` and `design_look`: a country is only ever added, a rate or code of the store's own is never overwritten, every copied code is saved switched off and the look never made live, and what ours cannot say as Shopify did is counted, never bent to fit. *Who makes your products?* (step 6, `src/server/shopify-makers.ts`) never takes a vendor as the manufacturer without the owner's press, keeps a company only through `chooseOperator()`, and changes products only through the bulk editor (`manufacturer`, then `status`), so every change has its undo. Move day (step 7a, `src/server/shopify-move.ts`) writes only `shop_moves.move`; each step goes through its owner's writer (the copy's imports through `startCatchUp()`, `fixOldShop()`, `setPrivateMode()`), is safe to repeat and runs under the move's lease; a scheduled move runs only as the owner who chose it, checked again by `passMembership()` each time, and a new step is a case of `MOVE_STEPS` and of `advanceMove()`. The address (step 7b, `src/server/shopify-address.ts`) writes no domain itself: it goes through `addStoreDomain()`, `connectOwnedDomain()` (only where `storeRegistration()` or `storeZone()` says the domain is the store's), `checkStoreDomain()` and `setPrimaryDomain()`, and never touches Shopify; a new DNS host is a pattern in `dnsHostOf()` and a sentence in the catalogues. The 14 days after (step 7c) read Shopify only through the catch-up (`startCatchUp()` with customers and orders), at most once a day while `watchDue()`, and only show what to press; closing Shopify is always the owner's own act there. Whatever a move makes is written down in `commerce.shop_move_items` (`recordMoveItems()`, never an address) as it is made, so a new thing a move makes is a kind there and a line in `undoCopy()`; *Undo this copy* (`src/server/shopify-undo.ts`) takes back only those, through each thing's writer, only before the first real order, and never emails anyone; a copied order goes only through `commerce.delete_copied_order()`. Step 3's report (`src/server/shopify-report.ts`) keeps nothing it reads and shows a figure Shopify did not give as unknown, never as 0; a new figure is a field of one of its query groups and of `shopReport()`, with its case in `shopify-report.test.ts`. Shopify's webhooks (`/api/shopify/webhooks`) answer 401 without its HMAC over the raw body; `app/uninstalled` drops the tokens, `shop/redact` deletes the rows; a new topic is a case in `handleShopifyWebhook()` and in the app's file. Moving from WooCommerce (D446, `docs/moving-from-woocommerce.md` 17) is the same engine: a WooCommerce shop is a `shop_moves` row with `source` `woocommerce`, connected only by WooCommerce's own read-only key (`wc-auth`, `scope=read`; a key that can write is refused) posted to `/api/woocommerce/callback` with a note sealed here, checked again by `passMembership()`; every call to the owner's site goes through `safeFetch()` over HTTPS, the key only to the site's own origin (`wooGet()`). A store has one connected shop at a time, and the copy works from whichever it is (`copySource()`); a WooCommerce feed is a converter in `src/lib/woocommerce-copy.ts` to the lines `fileOfFeed()` already reads, tested by reading its file back with the import's own reader, and a case of `readWoo()`, never a writer of its own. Moved reviews go only through `importReviews()` as `import` reviews, never as a buyer's: a review is a verified purchase only when it is of an order line in this store. Our WordPress plugin's mover (`class-kaizen-store-mover.php`) only reads, through `GET` routes that refuse any call not signed with its secret within five minutes (`moverSignature()` and the PHP `verify()` held equal by a test that runs the PHP); its secret goes only to the Kaizena Flow address the plugin is set up with, never to one from a link, and is kept here only encrypted (`shop_moves.mover_secret`, written only by `woocommerce-connect.ts`). A new thing it reads is a route there, a reader in `src/lib/woocommerce-mover.ts` and a part of the copy that goes through the table's own writer. Yoast's and Rank Math's fields are all kept: the words shoppers saw as the SEO title and description, and every field as written in the custom field group `seo-from-wordpress` (`SEO_FIELDS`); a new field is a key in the plugin's `POST_FIELDS`/`TERM_FIELDS` and an entry of `SEO_FIELDS`.

## Tripletex (D453, `docs/tripletex.md`, `src/lib/tripletex*.ts`, `src/server/tripletex.ts`, `src/server/tripletex-client.ts`, `src/server/tripletex-sync.ts`)

- **Tripletex (D453, `docs/tripletex.md`, `src/lib/tripletex*.ts`, `src/server/tripletex.ts`, `src/server/tripletex-client.ts`, `src/server/tripletex-sync.ts`)**: being built
  (`docs/tripletex.md`, "Plan as of 4 November 2026", says what is). A store connects with the one token its owner pastes, read only by
  `readPastedToken()`: its kind (`tlxr_` the company's own API token, else an employee token used with Kaizena Flow's consumer token,
  `tripletexConsumerToken()`, an environment variable) and its environment (`test-`) come from the token, never from a choice. Tripletex is
  called only through `openSession()` and its session (`src/server/tripletex-client.ts`): one of the two addresses in `TRIPLETEX_BASE`, a
  path that is a constant of the code, a timeout, no redirect, no cache; an answer is JSON or a `TripletexFailure` (`classifyFailure()`),
  never a thrown error; a session token lives for one run and is never kept, logged or returned. `commerce.tripletex_connections` is
  written only by `src/server/tripletex.ts` (the owner's alone: connect, Start, Pause, settings, Disconnect, each audited
  `integration.tripletex_*` without the token); its token is encrypted and decrypted only by `tripletexCredential()`; one Tripletex
  company belongs to one store. Where things are booked is `TripletexSettings` (account and VAT code numbers, resolved to ids per run),
  chosen by `planSetup()` from the company's own chart and held by `checkSettings()` to what Tripletex takes, so a refusal is shown on the
  settings page before anything is sent; the owner is asked only about buckets the store's own documents use (`neededKeys()`). A
  document becomes a voucher only through `voucherBody()` (`src/lib/tripletex-map.ts`): the receivable on its customer, one posting per
  line (a shop credit note per VAT bucket), postings that sum to zero, amounts only through `decimalOf()`, Kaizena Flow's number as the
  receivable's invoice number and in `externalVoucherNumber()`; a shopper never becomes a customer in Tripletex (`shop_customers`), and a
  Work consumer is a name and a country. `commerce.tripletex_sync` is one row per object and company, kept on disconnect, never copied;
  a voucher is never sent without its external number, which is looked up before any retry. `commerce.tripletex_sync` is written only
  by `src/server/tripletex-sync.ts` and Disconnect, which marks what waited skipped (the dispatcher's `tripletex` job, `syncDueTripletex()`, never throws; `retryTripletex()` for Try
  again, which keeps one try counted so the next send looks the voucher up first): it sweeps documents issued since `sync_from`, claims
  with `for update skip locked` and an expiring claim, makes a customer card only for a document that can be booked, and classifies every
  failure (the ladder for Tripletex's own trouble, a rate limit waited out, a refused token pausing the store, anything else waiting for
  a person with a stable `error_key`); it never redates a voucher and never changes or deletes one. Every owner-facing failure is a sentence of
  the `notifications` catalogue's `integrations.tripletex` (`failures` keyed as `FAILURE_WORDS`, `blocks` as `BLOCK_WORDS`, `connectProblems`,
  `startProblems`), read through `failureWords()`; the server answers codes, never sentences, and never Tripletex's raw answer but a clipped
  validation message shown as what Tripletex said. A booked shop document's stored PDF is attached by `attachPdfs()` only, read through
  `readPdf()` (never Chromium), never touching its voucher on a refusal. What needs a person is `tripletexAttention()`, told by the store
  checkup (`accounting`, `accounting_token`) and the staff alert `accounting` (`sendAccountingAlert()`, once a day per store and recipient),
  never by a channel of its own. A document's own page shows it through `TripletexDocumentsPanel`. A voucher deleted in Tripletex is found
  only by Check (`checkTripletexDocument()`, read-only) and is never booked again but by the owner's Post again (`postTripletexAgain()`, the
  next external number). The page (`/admin/{store}/integrations/tripletex`, owners act, `settings:read` sees) is
  Homer's: one paste, then only the questions Tripletex would refuse (`checkTripletexSettings()` before Start), then Start; the card
  speaks only when something needs the owner; every account, code, the start day and the switches are under Customise. Tests run against `fakeTripletex()`
  (`src/server/tripletex-test-support.ts`), which must answer as Tripletex's spec does and never refuses a repeated external number;
  nothing in CI calls Tripletex.

## Fiken (D460, `docs/fiken.md`, `src/lib/fiken*.ts`, `src/server/fiken.ts`, `src/server/fiken-client.ts`, `src/server/fiken-sync.ts`)

- **Fiken (D460, `docs/fiken.md`, `src/lib/fiken*.ts`, `src/server/fiken.ts`, `src/server/fiken-client.ts`, `src/server/fiken-sync.ts`)**: Tripletex's
  engine with Fiken's own way in. What both share is shared, never copied: documents are read only through `src/lib/accounting-docs.ts` and
  `src/server/accounting-documents.ts`, a store's system and what needs a person there through `src/server/accounting.ts`, and the alert is
  `sendAccountingAlert(…, system)`; a third system goes through the same. A store keeps its books in one system: Fiken and Tripletex each refuse
  to connect while the other is. Fiken is connected only through OAuth2 with PKCE (never a pasted token: Fiken's terms forbid personal API
  tokens in a third-party app): `startFikenConnect()` seals the nonce, store, account and verifier into the state cookie, and
  `finishFikenConnect()` checks it and the owner signed in now before the code is spent. `commerce.fiken_connections` is written only by
  `src/server/fiken.ts` (the owner's alone, each change audited `integration.fiken_*` without a token); its tokens are decrypted only by
  `fikenAccess()`, which refreshes under the row's lock and stops the connection on a refused refresh; Disconnect revokes the grant at Fiken.
  Fiken is called only through `fikenApi()` (`src/server/fiken-client.ts`): `FIKEN_API` and a path that is a constant of the code or Fiken's
  own ids, a timeout, no redirect, no cache, one call at a time a quarter of a second apart; an answer is JSON with its `Location`, or a
  `FikenFailure` (`classifyFikenFailure()`). A document becomes a sale only through `saleBody()` (`src/lib/fiken-map.ts`): Annet salg,
  `external_invoice`, its own number as `saleNumber`, each line's net and VAT as the document charged them, a credit note's lines negative;
  a sale is never made without first asking Fiken for one with its number (`sameSale()` adopts it, another waits as `number_taken`).
  `commerce.fiken_sync` is written only by `src/server/fiken-sync.ts` and Disconnect, on the rules of `tripletex_sync`. Every owner-facing word
  is the server-only area `fiken` (`failures` keyed as `FIKEN_FAILURE_WORDS`, `blocks` as `FIKEN_BLOCK_WORDS`), never Fiken's raw answer but
  its words clipped and shown as what Fiken said. Tests run against `fakeFiken()` (`src/server/fiken-test-support.ts`), which answers as
  Fiken's spec does and never refuses a repeated sale number; nothing in CI calls Fiken.

## Changing the business behind a store (B8, D473, `src/lib/business-change.ts`, `src/server/business-change.ts`)

- **Changing the business behind a store (B8, D473, `src/lib/business-change.ts`, `src/server/business-change.ts`)**: a change of the legal
  business behind a store (`commerce.store_business_changes`) is planned only by the store's owner, one at a time, for a day after today,
  through `planBusinessChange()`, and takes effect only in `commerce.apply_business_change()`: the store's legal name, number, address, its
  VAT registration and Work's, and the series' prefixes in one transaction, keeping what was before and where each series stood. Every
  issuer calls it before it numbers anything, so nothing is issued on the day under the old business; a new issuer of documents calls it
  too. A sales series' prefix changes after numbers are issued only there (`sales_series_guard()`); numbers are never reset or skipped.
  Never write the store's legal identity from a date by hand: plan a change. Its checklist is `businessChecklist()`, drawn from the store
  (`businessChecklistFacts()`); a step the owner does elsewhere is ticked (`tickBusinessStep()`), never assumed.

## E-invoices through Peppol (D463, B1 of `docs/own-books-and-sales.md`, `src/lib/peppol.ts`, `src/lib/work-einvoice.ts`, `src/server/einvoice-sending.ts`)

- **E-invoices through Peppol (D463, B1 of `docs/own-books-and-sales.md`, `src/lib/peppol.ts`, `src/lib/work-einvoice.ts`, `src/server/einvoice-sending.ts`)**: a sales document to a business goes to it as EN 16931 UBL (Peppol BIS Billing 3.0, EHF in Norway) where the buyer
  receives it on the Peppol network. A shop's documents are D403's (`invoiceUbl()`, `creditNoteUbl()`), Work's `workDocumentUbl()` from the
  issued document only (its lines as they rounded, its VAT groups; reverse charge without the client's VAT number, outside scope beside VAT
  and totals that do not add up are refused, never sent). The buyer is a participant only by its country's scheme and organisation number
  (`participantOf()`: 0192 Norway with the check digit, 0007 Sweden, 0184 Denmark), and the network itself is asked (`receiverOf()`: the
  SML's NAPTR record at `base32(sha256(lowercase value))` per POLICY 7, then the SMP for the document type), an answer kept a day in
  `commerce.peppol_receivers`; a lookup that could not finish is not trusted and asked again. The dispatcher's `einvoices` job looks at each
  document issued to a business in the last two days once (never one issued before `EINVOICES_FROM`) and records its state in
  `commerce.einvoice_sends`: `not_valid` (with the reasons), `not_receiver`, `waiting` (receives, but no access point is connected: it went
  by email and is never sent later, so nothing reaches a buyer twice), or `pending`, then `sent`, `failed` (tried again with a growing wait,
  at most six times), `refused` or `delivered`. The access point is one adapter of `AccessPoint` (`src/server/access-point.ts`); none is
  configured until the owner signs with a vendor. The row never holds the buyer: the document does. Each document shows its line
  (`einvoiceLines()`, `screens.einvoiceState`) on the order page and on a Work invoice, where the XML is also downloaded
  (`…/work/s/{store}/invoices/{id}/xml`, `…/credit-notes/{id}/xml`). Email is unchanged in this step.

## Kaizen Life (D95, `src/server/kaizen-life.ts`)

- Kaizen Life (D95, `src/server/kaizen-life.ts`): each Supabase project is
  the other's OpenID Connect provider. "Sign in with Kaizen Life" (only with
  `KAIZEN_LIFE_SSO=on`) goes through `/auth/callback?via=kaizen-life` and
  `admitFromKaizenLife()`, which admits owners and platform admins only;
  apps asking to sign someone in with Kaizen Store land on
  `/admin/oauth/consent` (owners only). Sign-in shares identity, never
  store data. Kaizen Life's assistant reaches the owner's stores through
  `/api/mcp` (D96, `src/server/store-mcp.ts`), which since D439 also takes
  Kaizena Flow's own tokens (*Kaizena Flow's authorization server*, above):
  Kaizen Life's are tokens from the store's Supabase OAuth server for
  `KAIZEN_LIFE_CLIENT_ID` only, every owner tool with a
  `store` argument, gated tools only kept (`keepForApproval()`, named
  "Kaizen Life asks: …") in the
  owner's Kaizen Life conversation (`kaizenLifeConversation()`), and
  `ask_store_assistant` runs a turn there with `fromKaizenLife` and `outside`. A new owner
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

## Kaizena Flow's own integrations (D465, `docs/platform-parity.md`, `src/lib/platform-integrations.ts`, `src/server/platform-integrations.ts`)

- **Kaizena Flow's own integrations (D465, `docs/platform-parity.md`, `src/lib/platform-integrations.ts`, `src/server/platform-integrations.ts`)**: the platform's twin
  of a store's Zapier, Make and Slack (D41, D101), at Settings → Integrations (`/admin/platform/integrations`, platform admins only), for
  Kaizena Flow's own events (`PLATFORM_EVENTS`: `request.received`, `store.created`, `store.opened`, `plan.started`, `plan.changed`,
  `plan.cancelled`, `plan.payment_failed`, `report.received`). A connection is `commerce.platform_integrations` (one per service, the address
  checked by the stores' `checkWebhookUrl()` and kept encrypted) and each event `commerce.platform_integration_deliveries`, both written only
  by `platform-integrations.ts`. Every event is queued by the database where it happens (`commerce.queue_platform_event()` from triggers on
  `access_requests`, `stores`, `store_billing` and `content_reports`); `store.created` is a deferred constraint trigger that reads the store
  again at commit, so a demo store, a template or a sandbox flagged in the transaction that made it is never news, and a sandbox kept as a
  store (D457) is. `deliverPlatformDue()` sends them every minute in the integrations cron with the stores' `postToService()` and
  `RETRY_SECONDS`, and keeps them `PLATFORM_DELIVERY_KEEP_DAYS` (30). Zapier and Make get a request's name and email (the operator's own
  leads); Slack's message (`platformSlackMessage()`, everything escaped) names the person but never an email, and a notice gives its category
  and store, never its sender or words. Blanking a request (retention or the account's erasure) empties every delivery about it at once. A new
  platform event is an id in `PLATFORM_EVENTS`, a trigger that calls `queue_platform_event()`, its payload in `platformPayload()`, its message
  in `platformSlackMessage()`, its words in the `platform` catalogues (`integrations.events`, every language) and a case in
  `src/db/platform-integrations.test.ts`. Own endpoints (D354), *Add to Slack* and accounting are not on the platform yet
  (`docs/platform-parity.md`).

## Our own ledger (B2, D478, `src/lib/ledger.ts`, `src/server/ledger.ts`, `src/data/ledger/no-saft.json`)

- **Our own ledger (B2, D478, `src/lib/ledger.ts`, `src/server/ledger.ts`, `src/data/ledger/no-saft.json`)**: a book is one legal entity's
  (`commerce.ledger_books`, one open a store; a change of the business behind the store closes one and opens the next). Entries are written
  only by `commerce.ledger_post()`: balanced to the øre, on active accounts of their own book, within its days and after its lock, numbered
  in their series and year without gaps, and posted once for what they were posted from (`source_kind`, `source_id`). Nothing posted is
  ever changed or deleted: a mistake is put right by `commerce.ledger_reverse()`, once. Amounts are the book's currency's minor units, a
  debit positive. Norway's chart and VAT codes are Skatteetaten's published SAF-T files, kept as they are; an account reports as a standard
  account (or a sub-account of one). A document is posted where the store's Tripletex settings book it (`postingOfTripletex()`), so the
  books can be compared account by account. Never post around the function, and never post a document's amounts but through `entryOfDoc()`,
  a Work invoice's payment but through `entryOfPayment()` (the money where its method puts it, `PAYMENT_ACCOUNTS`, against the receivable;
  in another currency at the invoice's rate and the day's, the difference on 8060 or 8160), or a payment's reversal but through
  `entryOfPaymentReversal()`, which turns the payment's own entry; a shop's payment or refund through `entryOfPayment()` with its own source kind and
  account (`SHOP_PAYMENT_ACCOUNTS`, store credit 2900), and a payout only through `entryOfPayout()`. An entry typed by hand goes through `handEntryOf()` and `postHandEntry()` (the
  owner's, series `M` or `IB` only, audited); the books' screen reverses an entry only through `reverseLedgerEntry()`.

## Bank statements in the books (B4, D486, `src/lib/bank-statement.ts`, `src/lib/xml-read.ts`, `src/server/bank-statements.ts`)

- **Bank statements in the books (B4, D486, `src/lib/bank-statement.ts`, `src/lib/xml-read.ts`, `src/server/bank-statements.ts`)**: the
  owner uploads the bank's statement on Settings → Books (owner only, at most 3 MB, the admin form's 4 MB request in mind): ISO 20022
  camt.053, or a netbank's CSV whose columns are found by their names (`CSV_COLUMNS`). A file is read whole or refused whole
  (`readStatement()`): never in part, never in another currency than the book's. XML is read only by `parseXml()`, which reads no DTD and
  expands no entity but XML's five and character references; never parse a file people upload with anything else. Only booked entries
  (`BOOK`) are read. A line is kept once per book and account (`commerce.bank_lines`, unique on its key: the bank's own reference, else what
  the line says and how many identical lines came before it in the file), so an upload twice or two statements that overlap add nothing.
  A line is matched to the books only by `matchBankLines()`: one to one, the same amount to the øre on the bank's account (1920), at most
  `MATCH_DAYS` apart, nearest first, an entry that stands (neither reversed nor a reversal; a line matched to an entry later reversed is released by `matchBankStatement()`, also
  when the books' screen reverses it); a database index keeps an entry matched once.
  Matching runs at upload and again after the ledger's job posts (`matchAllBankStatements()`). Nothing is posted from a bank line, and
  nothing is sent to the bank. Each upload is audited (`work.bank_statement_imported`, counts only). A line of money in pays a Work
  invoice only through `payInvoiceFromBank()` (`src/server/bank-payments.ts`, D487): recorded by `recordPayment()` as paid by bank on the
  bank's day, never more than is outstanding, posted at once (`postWorkPaymentNow()`) and matched to its line, audited
  (`work.bank_payment_recorded`). Which invoice a line pays is `matchInvoices()` alone (`src/lib/bank-invoices.ts`): only a `certain` match
  (the invoice's printed number in the line, exactly what is outstanding, no other number) is recorded without the owner, and only when
  the owner uploads the statement; every other is offered on the Books screen for one press. Never record a payment from the ledger's job.
