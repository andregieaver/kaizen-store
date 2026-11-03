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
checked: 2026-11-03
sources: [D438, D439]
---

Every change to a published contract gets a version here, newest first: the Admin API (`/api/admin/v1/openapi.json`), the storefront API
(`/api/storefront/v1/openapi.json`), the webhook topics (`/api/webhooks/v1/topics.json`) and the MCP catalogues (`/api/mcp/catalogue.json`,
`/api/ucp/catalogue.json`). Within a major version nothing a caller relies on is renamed or removed; answers and payloads may gain fields.

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
- Webhook endpoints (D354) with `webhooks:write`: `GET`, `POST /webhooks` (the signing secret answered once), `PATCH` and `DELETE
  /webhooks/{id}`, `GET /webhooks/{id}/deliveries` and `POST /webhooks/{id}/deliveries/{delivery_id}/resend`.
- The product file of the Data page (D165) as jobs: `POST /jobs/product-exports`, `POST /jobs/product-imports` (a one-time upload
  address), `POST /jobs/product-imports/{id}/check` (the dry run), `POST /jobs/{id}/apply`, `GET /jobs/{id}` and `GET /jobs/{id}/download`.
- A token may now hold every scope at once.

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
- `?updated_after=` on every list, and `updated_at` on orders, customers and discount codes, for incremental sync. A page's cursor now
  keeps its row's time to the microsecond, so rows made in one go are never skipped between pages.
- Each operation names the staff permission its screen asks for (`x-permission`) and the store feature it stands behind (`x-feature`): a
  store that is not open answers `forbidden` to what its admin refuses there (changes, and reading its products and website), and a
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
