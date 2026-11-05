---
title: Changelog
summary: What changed for callers of the Admin API, the storefront API, webhooks and the MCP servers, version by version.
track: developers
section: changelog
kind: changelog
areas: [api, webhooks, mcp]
features: []
plans: []
order: 1000
checked: 2026-11-05
sources: [D438, D439, D440, D441, D457]
---

Every change to a published contract gets a version here, newest first: the Admin API (`/api/admin/v1/openapi.json`), the storefront API
(`/api/storefront/v1/openapi.json`), the webhook topics (`/api/webhooks/v1/topics.json`) and the MCP catalogues (`/api/mcp/catalogue.json`,
`/api/ucp/catalogue.json`). Within a major version nothing a caller relies on is renamed or removed; answers and payloads may gain fields.

## 1.9 — 2026-11-05

An addition to the Admin API (D457, D458).

- Marking an order as sent takes `instabox`, `dhl_paket` and `nshift` as its `carrier`, beside the carriers it took before; Instabox and DHL
  Paket give the parcel their tracking page. Instabox, DHL Express, UPS, DHL Paket and nShift are now carriers a store connects, and their
  parcels name them.

## 1.8 — 2026-11-04

The Admin API's document names how an app calls it (D441).

- A second security scheme, `appOAuth`: OAuth 2.1's authorization code flow with PKCE, its authorization and token addresses, and every
  scope and power an app may ask for. Each operation lists it beside `adminToken`, with what an app's token needs for it: the operation's
  permission and, where the operation needs one, its power. The webhook endpoints' operations, which only the owner may use, list no app.

## 1.7 — 2026-11-04

Apps for many stores (D441): what an installed app is sent.

- Two new webhook topics, sent only to an app's installation: `app.uninstalled`, at once when the app is removed from a store (by an
  owner, because the person who installed it left the store, or because the app was blocked), and `store.erase_requested`, 48 hours
  later, when the app should erase what it keeps of the store. Both carry `data.installation` (`id`, `client_id`, `removed_at`). Nothing
  else is sent to a removed app, and an app installed again within the 48 hours is not sent `store.erase_requested`.
- Each topic in the catalogue says whether `apps` may be sent it (`receivers`): a topic an app chose whose area its installation's scopes
  read, and the two above, which every installed app is sent. `customer.erased` is always sent to an installed app.

## 1.6 — 2026-11-04

An addition to the owner MCP server (D445).

- A new read-only tool, `shopify_move`: where the store's move from Shopify stands (the connection, each part of the copy with its stage
  and counts, *Ready to move?*, the move's steps, the shop's own address and where its DNS is kept, the 14 days after and whether the copy
  can be undone). The owner's: a token or member without the owner's role is refused. It changes nothing.

## 1.5 — 2026-11-04

Corrections: what the contract said is now what happens.

- A delivery sent again by hand (`POST /webhooks/{id}/deliveries/{delivery_id}/resend`, or *Send again* in the admin) now carries its
  body's `id` in `Kaizena-Webhook-Id`, as the contract always said. Until now the header carried a new id on a resend while the body kept
  the old one, so a receiver that did the work once per header could do it twice. Retries were never affected.
- The signature checks in the reference (JavaScript, Python and PHP) refuse every delivery when the secret is empty, as when its
  variable is not set: before, a delivery signed with an empty key passed the PHP check. The Python check compares bytes, so a header
  with other characters is refused instead of raising an error. If you copied a check, add the same guard.
- `POST /products` and `PATCH /products/{id}` now say what a token with the power `products:publish` may do since 1.1: pictures are
  added with `POST /products/{id}/media`, a product is published with `POST /products/{id}/publish`, and a product on the site is changed
  with `PATCH` only by a token that holds the power (without it, `gated`). Their descriptions still said both were the owner's, in the
  admin.
- The shopping agents' MCP server (`/api/ucp/{store}/mcp`) refuses a batch of more than 10 calls, or an empty one, as the owner MCP
  server does: `400` with the JSON-RPC error `-32600`, *A batch holds 1 to 10 calls.* Until now it answered the first 10 calls and
  dropped the rest without a word. Its limit on a body is 50,000 bytes. It counted characters, so a body of `€` signs could be three
  times as large.
- A store's `agents.md`, its `llms.txt` and its Product feeds page give its UCP profile's address where it is served. For a store under
  Kaizena Flow's address that is `https://kaizenaflow.com/s/{store}/.well-known/ucp`: they gave `https://kaizenaflow.com/.well-known/ucp`,
  which serves nothing. A store that sells in one country now serves its profile and its `agents.md` at their addresses: both answered
  with the store's 404 page.

## 1.4 — 2026-11-03

Content, the store and operations (wave 14 unit C4, D440).

- New scopes: `content:read`, `content:write`, `content:publish` (publishing), `settings:read`, `reports:read` and `webhooks:write`.
- Pages and blog articles: `GET /pages`, `GET /pages/{id}`, `POST /pages` and `PATCH /pages/{id}` (drafts, through the editor's own
  save and checks), `POST /pages/{id}/publish` (with `content:publish`; a blocking issue of the checker not acknowledged answers
  `conflict` naming it), and the same under `/articles`.
- Content types and entries (D326): `GET /content-types`, `GET` and `POST /content-types/{id}/entries`, `GET` and `PATCH
  /content-entries/{id}`, `POST /content-entries/{id}/publish`.
- Menus: `GET /menus` and `GET /menus/{id}`. The store's settings: `GET /settings` (markets, currencies, languages, shipping rates and
  methods, tax profile, price display).
- Saved reports (D345): `GET /reports` and `GET /reports/{id}/run`.
- Webhook endpoints (D354) with `webhooks:write`: `GET`, `POST /webhooks` (the signing secret answered once: a replay under its `Idempotency-Key` answers it as `null`), `PATCH` and `DELETE
  /webhooks/{id}`, `GET /webhooks/{id}/deliveries` and `POST /webhooks/{id}/deliveries/{delivery_id}/resend`.
- The product file of the Data page (D165) as jobs: `POST /jobs/product-exports`, `POST /jobs/product-imports` (a one-time upload
  address), `POST /jobs/product-imports/{id}/check` (the dry run), `POST /jobs/{id}/apply`, `GET /jobs/{id}` and `GET /jobs/{id}/download`.
- A token may now hold every scope at once.
- Every write added since 1.1 has a scope no token made before it holds, so an older token gains nothing beyond reading its own areas:
  `products:manage` (categories and tags made, pictures uploaded, the product file imported as drafts, a draft put in a category or given
  pictures), `orders:manage` (draft orders made and changed, an order's notes and tags) and `customers:manage` (customers added and
  changed, never their email). Every scope of an area also reads it.
- What the AI manager asks the owner's yes for is a power: `products:publish` also renames and deletes categories and tags and sets price
  lists' prices; `orders:send` (new) sends draft orders, declines quotes, decides and receives returns, and pauses and cancels
  subscriptions; `orders:refund` also cancels an order not paid yet; `customers:email` (new) changes the email a customer signs in with;
  `discounts:publish` (new) changes discount codes and switches them off. A call that needs a power beside its scope answers `gated`,
  naming it.
- An import by a token without `products:publish` is checked as drafts only: `counts.dry.onShop` counts the products the file would
  publish, archive, bring back or change on the site, and `POST /jobs/{id}/apply` refuses them as `gated` and cancels the import.
- A page's or article's draft that carries `globalEdits` is refused: global parts change in the admin. A page's new address that moves
  published pages under it, and a published entry's new address, take `content:publish`.
- `Idempotency-Key` stands for the method, the whole path and the body: the same key on another order's route is refused, never answered
  with the first one's answer.
- Upload addresses (`POST /media/uploads`, `POST /jobs/product-imports`) are answered once: a replay answers `upload_url` as `null`.
  Pictures go to a bucket of their own and may be at most 20 MB and 50 million pixels.
- `GET /inventory/levels` pages by variant and location, so no level is skipped between pages.
- A webhook delivery about a person who was erased loses its payload, and resending it answers `conflict`.

## 1.3 — 2026-11-03

Customers and marketing (wave 14 unit C3, D440).

- Customers: `POST /customers`, `PATCH /customers/{id}` and `GET /customers?email=` to find one by email; a customer's store credit
  (`GET /customers/{id}/store-credit`) and bonus credits (`GET /customers/{id}/loyalty`).
- Segments (D296): `GET /segments` and `GET /segments/{id}` with how many people each holds now (never who).
- Discount codes: `GET` and `PATCH /discounts/{id}`, and `POST /discounts/{id}/disable` to switch one off.
- Gift cards with a new scope, `gift_cards:write`: `GET /gift-cards`, `GET /gift-cards/{id}`, `POST /gift-cards` (issue: the code is
  answered once, at issue; a replay of the request under its `Idempotency-Key` answers without it) and `POST /gift-cards/{id}/disable`.
- Subscriptions (D29): `GET /subscriptions`, `GET /subscriptions/{id}`, `POST /subscriptions/{id}/pause` and `/cancel`.
- A draft's pay link sent with `create_link` is no longer kept for a replay either: a replay answers it as `null`.
- Webhooks: `customer.updated`, `customer.erased` (the account's id only), `subscription.renewed`, `subscription.payment_failed`,
  `gift_card.issued` (never its code) and `review.created`, with the new subjects `erasure`, `gift_card` and `review`.

## 1.2 — 2026-11-03

Orders (wave 14 unit C2, D440).

- Draft orders and requests for a quote (D173, D431): `GET /drafts` (`?status=`, `?quotes=true`), `GET /drafts/{id}`, `POST /drafts`,
  `PATCH /drafts/{id}` (its customer, addresses, notes, tags, discount, shipping and lines, or its lines' prices by SKU, against its
  `version`), `POST /drafts/{id}/send` (emails the pay link, or answers it once with `create_link`) and `POST /drafts/{id}/decline` with
  the reply a shopper is emailed. Each draft answers what it totals now and what would stop it being sent (`blocking`).
- Refunds with a new scope, `orders:refund`: `POST /orders/{id}/refunds` through the admin's own refund (to the payment or as store
  credit, units back in stock); `GET /orders/{id}/refunds` with `orders:read`. A store credit's code is never answered: it goes to the
  customer.
- Returns (D153): `GET /returns`, `GET /returns/{id}`, and `POST /returns/{id}/approve`, `/decline` and `/receive`.
- An order's notes (`GET` and `POST /orders/{id}/notes`), tags (`POST /orders/{id}/tags`, `DELETE /orders/{id}/tags/{tag}`), and
  `POST /orders/{id}/cancel` for an order waiting for payment.
- Webhooks: `order.created`, `order.updated` (an edit applied), `fulfilment.created`, `fulfilment.updated` (tracking moved on, or the
  parcel undone), `refund.created`, `return.updated`, `quote.requested` and `draft.sent`, with the new subjects `fulfilment`, `refund` and
  `draft`.

## 1.1 — 2026-11-03

The catalogue (wave 14 unit C1, D440).

- Categories and tags: list, get, create, change and delete them, and put a product in or take it out (`/categories`, `/tags`,
  `/categories/{id}/products`).
- Pictures: `POST /media/uploads` gives a one-time address to `PUT` a JPEG, PNG, WebP or AVIF to; `POST /media` checks the file as the
  media library checks an upload and keeps it there; `GET /media` lists the library. A product's gallery: `GET`, `POST` and `PATCH
  /products/{id}/media`, and `DELETE /products/{id}/media/{media_id}`.
- A new scope, `products:publish`: publish, unpublish, archive and bring back a product (`POST /products/{id}/publish`, `/unpublish`,
  `/archive`, `/unarchive`), and change a product that is on the site (its fields, categories, tags and pictures). With `products:write`
  alone those still answer `gated`, as before.
- Price lists (D321): `GET /price-lists`, and `GET` and `POST /price-lists/{id}/prices` with fixed prices in minor units.
- `?updated_after=` on every list of the store's records (not on the short lists that belong to one thing, such as an order's refunds and
  notes or a product's gallery), and `updated_at` on orders, customers and discount codes, for incremental sync. A page's cursor now
  keeps its row's time to the microsecond, so rows made in one go are never skipped between pages.
- Each operation names the staff permission its screen asks for (`x-permission`) and the store feature it stands behind (`x-feature`): a
  store that is not open answers `forbidden` to what its admin refuses there (its products, discounts, website and settings, read or
  changed; its orders, customers and reports stay open), and a
  feature switched off answers the new code `feature_off` (403).
- Webhooks: `inventory.updated` (a variant's stock on hand moved; one event per variant and minute, carrying the stock as it is then) and
  `product.archived`.

## 1.0 — 2026-11-03

Contracts published.

- The Admin API's OpenAPI 3.1 document, generated from the operations themselves: every operation's parameters, body, answer and
  refusals, the scope each needs, pages, the rate limit and `Idempotency-Key`. Every write now checks its body before anything runs and says
  what is wrong in a 422 (discount codes, checkout rules and questions, and customer tags included).
- The storefront API's document now holds every route's query, body and answer.
- The webhook topics with the shape of each payload's `data`, the headers and how to check a signature, at `/api/webhooks/v1/topics.json`
  and in the Admin API's document (`webhooks`). A test delivery's sample order now has every field a real order has.
- The owner MCP's tool catalogue and the shopping agents', each tool with a title and MCP annotations (read-only, destructive, idempotent,
  open world); `tools/list` answers them too.
- The owner MCP takes OAuth 2.1 tokens from Kaizena Flow's own authorization server (D439): any MCP client connects at
  `https://kaizenaflow.com/api/mcp`, finds the server through `/.well-known/oauth-protected-resource` and
  `/.well-known/oauth-authorization-server`, and asks the person on Kaizena Flow's consent screen. Each tool in the catalogue names the
  `scope` a token needs for it (one per staff permission, plus `stores:read`); a call outside the token's scopes answers 403 with an
  `insufficient_scope` challenge, and `tools/list` lists only what the token can call.
