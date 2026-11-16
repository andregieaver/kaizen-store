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
checked: 2026-11-16
sources: [D357, D438, D439, D440, D441, D458, D464, D511, D512, D585, D599, D606, D618, D621, D632, D635, D640, D653, D673]
---

Every change to a published contract gets a version here, newest first: the Admin API (`/api/admin/v1/openapi.json`), the storefront API
(`/api/storefront/v1/openapi.json`), the webhook topics (`/api/webhooks/v1/topics.json`) and the MCP catalogues (`/api/mcp/catalogue.json`,
`/api/ucp/catalogue.json`). Within a major version nothing a caller relies on is renamed or removed; answers and payloads may gain fields.

## 1.28 — 2026-11-16

An addition to the owner MCP's catalogue for A/B tests (D673).

- `apply_winner`: takes an optional `learning` (3 to 280 characters): one sentence on what the test taught, in the owner's words, kept
  with the test and shown on its page and in the list of what the store's tests taught. Its other fields and answer are as before; the
  answer also says `learned` when a learning was kept.

## 1.27 — 2026-11-16

Additions to the owner MCP's catalogue for email automations and cart reminders (D653).

- `write_email_automation`: takes the new kinds `cross_sell` (goes well with) and `replenish` (time to restock), and an optional `step`
  (2 or 3 writes a follow-up: the automation's second or third email, sent its days after the one before to readers who have not
  ordered since). Needs approval; `marketing:write`.
- `switch_email_automation`: takes the new kinds, and `cart_reminders` to switch the reminders about carts left at checkout.
- `cart_reminder_stats`: also answers whether the reminders are on (`on`) and lists them (`reminders`: id, when each goes, whether it
  is on, its discount code and subject); its other fields are as before.
- `write_cart_reminder`: writes or adds a reminder about a cart left at checkout in the store's main language: its words, when it
  goes, whether it is on and a discount code. Needs approval; `marketing:write`.

## 1.26 — 2026-11-15

An addition to the owner MCP's catalogue for support (D640).

- `carry_out_address_change`: changes an order's delivery address to the one its customer gave in a support request, when the person
  asking is the order's own customer signed in on the store's chat and nothing of the order is sent or held; the request is then
  marked done and the customer told. Needs approval; `orders:write`.

## 1.25 — 2026-11-15

An addition to the owner MCP's catalogue for orders (D635).

- `tell_customer_about_order`: tells an order's customer, in the store's own fixed words and their language, that the order is `delayed`,
  or that its parcel was not delivered (`parcel_attempted`), has a problem (`parcel_problem`) or is on its way back (`parcel_returning`).
  Refused when the store's records do not bear it out, and sent once per order and update. Needs approval; `orders:write`.

## 1.24 — 2026-11-15

Additions to the owner MCP's catalogue for email automations and text messages (D632).

- `write_email_automation`: the store's AI writes a lifecycle automation's words (`welcome`, `after_purchase`, `win_back`) in the store's
  main language from a brief, and sets its `days` when given; it is not switched on or off. Needs approval; `marketing:write`.
- `list_text_messages`: whether a 46elks account is connected, this month's spend against the cap, subscribed numbers and the latest text
  messages with their status and, once sent, delivered and cost. Never a number. Read only; `marketing:read`.
- `draft_text_message`: saves a draft text message for everyone subscribed or a segment; nothing is sent. `marketing:write`.
- `send_text_message`: sends a draft, priced first and refused past the monthly cap. Always needs the owner's approval; `marketing:write`.
- `list_email_automations` answers also carry `orders_after`, `revenue_after` and `orders_after_means`.

## 1.23 — 2026-11-15

Additions to the owner MCP's catalogue for orders and stock (D621).

- `cancel_order`: cancels a paid order that is not sent yet: what was paid is refunded, the items go back in stock and the customer may be
  emailed. An order sent, partly sent, unpaid or with a change waiting for payment is refused. Always needs the owner's approval;
  `orders:write`.
- `create_purchase_order`: makes and places a purchase order with a supplier from SKUs and units (the variant's cost unless `unit_cost` is
  given), at a stock location, and emails it to the supplier when the store has its order address. Needs approval; `products:write`.
- `list_supplier_orders`: the drop-shipping suppliers' orders, refused and late ones first (`which`: `attention`, `open`, `all`), with a
  refused one's reason in the supplier's words. Read only; `products:read`.
- `answer_supplier_order`: sends a supplier's order again or cancels it, by the customer's order number. Needs approval; `products:write`.

## 1.22 — 2026-11-15

Checkout questions asked only for some baskets (D357, task 4).

- `conditions` on a checkout field: the checkout rules' own conditions (country, basket value, weight, products, categories, tags,
  customer groups). The question is asked only when every one holds for the basket; `[]` or none asks it always, and a change without
  `conditions` keeps them.

## 1.21 — 2026-11-14

More kinds of checkout question (D357, task 4).

- `kind` on a checkout field may now also be `number` (a whole number), `date` (a day), `email` and `phone`, each checked for its shape
  when the shopper answers.
- `bounds` (`{ min?, max? }`) gives a `number` its lowest and highest value, and a `date` its earliest and latest day counted from the
  store's today (0 to 730). Only those two kinds have it; a change without `bounds` keeps them while the kind stays.

## 1.20 — 2026-11-14

An addition to the owner MCP's catalogue (D606).

- `profit_overview`: what a period earned after what it cost, counted as the Analytics pages count it: net sales, the cost of goods, fees,
  shipping, marketing and lost disputes, gross and contribution profit, contribution margin, profit per krone of marketing and revenue
  per visitor, with the month's forecast for 30 days or this month. `period` is `7d`, `30d`, `month`, `last_month` or `since` (with
  `since`, a first day). Read only; `analytics:read`.

## 1.19 — 2026-11-14

New kinds of checkout question (D357, task 4).

- `kind` on a checkout field may now also be `textarea` (several lines, at most 2,000 characters, its lines kept), `select` (one option
  from a closed list) and `radio` (one option, all shown). A `select` or `radio` question has `options` like a `checklist` (2 to 30, no
  `none` option) and may be `sensitive`; the other kinds have no options.

## 1.18 — 2026-11-14

An addition to the owner MCP's catalogue (D599).

- `wallet_status`: the store's AI wallet, when its owner connected their Airwallex account: whether it is on, whose app the cards appear
  in, its currency, its monthly limit and what is left.
- `request_purchase`: asks for one purchase (what, the merchant and its page, the most it may cost, why). It costs money, so it waits for
  the owner's yes, and only the store's owner may ask; on the yes a single-use card for at most that amount appears in their Airwallex app.
- `list_purchases` (the owner's only): the purchases approved. `cancel_purchase` (`settings:write`): calls an open one off, its card closed.

## 1.17 — 2026-11-14

An addition to the Admin API's checkout questions (D357, task 3).

- A question's `kind` may be `checklist`: one question with several options to tick. It has `options` (1 to 30, each with `label` words per
  language and an `id`; `none` marks the option that clears the others) and `sensitive`: when true, the cart asks the shopper's explicit
  consent once an option other than `none` is ticked (GDPR article 9, such as allergies). Every question now returns `sensitive`.
- Writing a question takes `options` and `sensitive` as optional fields: left out on a change, a checklist keeps its options and its consent.

## 1.16 — 2026-11-14

An addition to the Admin API's checkout questions (D357, task 2).

- A question has `width`: `full` or `half`. The cart draws two half-width questions next to each other on one line, and one alone on the left
  half; a narrow cart draws every question full width. `GET /checkout/fields` returns it. `POST` and `PATCH /checkout/fields` take it as an
  optional field: left out, a new question is full width and a changed one keeps its width.

## 1.15 — 2026-11-13

An addition to the owner MCP's catalogue (D357).

- `checkout_questions`: the questions the store's checkout asks, in order, with their words per language, kind, required and on or off.
- `save_checkout_question`: adds a question, or changes one's words, kind, required, on or off and place (1 is first). Shoppers are
  asked it, so it waits for the owner's yes. Deleting one stays on the Checkout rules page.

## 1.14 — 2026-11-13

An addition to the Admin API's checkout questions (D357).

- `PATCH /checkout/fields/{id}` takes `position`: the place to move the question to, 0 being first. The other questions keep their
  order, and the checkout asks them in that order. `{ position }` alone moves the question; it may also come with `enabled` or with the
  whole question. A place past the end is the end; a negative place is refused (`invalid`).

## 1.13 — 2026-11-13

An addition to the owner MCP's catalogue (D585).

- `list_ad_budgets`: the store's Meta ad account, when its owner connected it: this month's spend, where the month ends at today's
  budgets, the AI's monthly limit and each campaign's or ad set's budget.
- `set_ad_budget`: changes one of those budgets (a daily amount, on or paused). It costs money, so it waits for the owner's yes, and
  only the store's owner may ask for it. Meta bills the owner as before.

## 1.12 — 2026-11-09

An addition to the scopes an app or assistant may ask for (D512).

- `books:read` and `books:write`: a store's own books (Settings → Books), now an area of their own so an accountant may keep them
  without the rest of Settings. Nothing already granted changes.

## 1.11 — 2026-11-09

An addition to the owner MCP's catalogue (D511).

- `work_summary`: what needs the person in Work across the stores the connection reaches, in one call that takes no store. It returns
  overdue invoices, their own running timer, time ready to invoice, repeating invoices ready and drafts left waiting, urgent first. Money
  is per currency in minor units, never added across currencies. It also gives each store's figures and a link to each screen in
  Kaizena Flow. It reads only, and needs the scope `settings:read`, as Work's screens do.

## 1.10 — 2026-11-06

An addition to the MCP catalogues (D464).

- The owner tools that list and switch a store's features (`list_features`, `set_feature`) know Deals, as the feature `sales`. A store
  sees it once Kaizena Flow has opened Deals to it.

## 1.9 — 2026-11-05

An addition to the Admin API (D458, D459).

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
