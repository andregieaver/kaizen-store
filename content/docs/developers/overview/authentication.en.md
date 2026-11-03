---
title: Authentication, scopes and limits
summary: How an Admin API call proves which store it acts on, what its token may do, how often it may call, and what an error says.
track: developers
section: overview
kind: reference
areas: [admin-api, authentication, rate-limits, errors]
features: []
plans: []
admin: /admin/{store}/settings/api
order: 20
checked: 2026-11-03
sources: [D355, D314, D440]
---

## Tokens

An Admin API token belongs to one store. The store's owner makes it under [Settings, Apps and API](/admin/{store}/settings/api), gives
it a name and chooses its scopes. The token is shown once, when it is made: Kaizena Flow keeps only a hash of it. The same page shows
when each token was last used, and revokes one at once.

A token looks like `kf_` and 43 characters. Send it in the `Authorization` header of every call:

```bash
curl https://kaizenaflow.com/api/admin/v1/products?limit=10 \
  -H "Authorization: Bearer $KAIZENA_TOKEN"
```

A token acts as the owner who made it. Each call checks again that this person is still an owner of the store: a token whose maker is no
longer an owner stops working.

> [!WARNING]
> A token is a password to the store. Keep it on your server, never in a web page or an app people download. For a site's own code, use
> the storefront API's public token instead.

## Scopes

Each route needs one scope. Every scope of an area also reads that area: a token with `products:write` or `products:publish` may read
products.

| Scope | What it allows |
|---|---|
| `products:read` | Read products, categories and tags, the media library and products' galleries, price lists and their prices, the product file's jobs |
| `products:write` | Make products and change drafts |
| `products:manage` | Make categories and tags, upload pictures, import the product file as drafts, put a draft in a category or tag and change its gallery |
| `inventory:read`, `inventory:write` | Read stock locations and levels; adjust or set stock |
| `orders:read` | Read orders with their addresses, invoices and credit notes (EN 16931 UBL), refunds and notes, draft orders and quotes, returns and subscriptions |
| `orders:write` | Record parcels with tracking |
| `orders:manage` | Make and change draft orders; add notes and tags to orders |
| `customers:read` | Read customers and their tags, store credit and bonus credits, and segments |
| `customers:write` | Tag customers |
| `customers:manage` | Add customers and change their name, phone, address and company |
| `discounts:read`, `discounts:write` | Read discount codes; make discount codes |
| `checkout:read`, `checkout:write` | Read and change checkout rules and checkout questions |
| `content:read`, `content:write` | Read pages, blog articles, content entries and menus; write their drafts (nothing on the site changes) |
| `settings:read` | Read the store's countries, currencies, languages, shipping, tax profile and price display |
| `reports:read` | Run saved reports |

The powers are what the AI manager asks the owner's yes for. On the token screen they wait under *Customise*; give them only to a token
that must do that without asking:

| Power | What it allows |
|---|---|
| `products:publish` | Publish, unpublish, archive and bring back products; change a product on the site (its fields, gallery, categories and tags); rename and delete categories and tags; set price lists' prices; import a file that does any of these |
| `orders:send` | Send draft orders and decline quotes; approve, decline and receive returns; pause and cancel subscriptions. Each emails the customer |
| `orders:refund` | Refund orders through the admin's own refund, and cancel orders not paid yet |
| `customers:email` | Change the email a customer signs in with |
| `discounts:publish` | Change discount codes and switch them off |
| `gift_cards:write` | Issue, read and deactivate gift cards |
| `content:publish` | Publish pages, blog articles and content entries, and change the address of one on the site |
| `webhooks:write` | The owner's webhook endpoints: add, change, remove, read their deliveries and send one again |

A token made before version 1.1 keeps what its scopes allowed then: each new write has a scope of its own, so it gains nothing new beyond
reading its areas.

A call outside the token's scopes is refused with `403 forbidden`, and the message names the scope it needs. A call that would also do what
a power allows (a product on the site, a customer's email, an import that publishes) without it is refused with `403 gated`, naming the
power. Each route also asks what its screen in the admin asks: the staff permission it needs and the store feature it stands behind. A store
that is suspended or closed, as in the admin, keeps open only its orders, customers, reports and the owner's own pages such as its webhooks;
its products, discounts, website and settings are refused, read or changed. The OpenAPI document names both for each operation
(`x-permission`, `x-feature`), and the reference's [Scopes](/docs/reference/scopes) page lists each scope with every
operation that needs it.

## Rate limits

Each token may make 120 calls a minute, and a store's tokens together 1,200. A call past either limit is answered `429 rate_limited`
with a `Retry-After` header: the seconds until the next minute begins. Wait that long and try again. [Rate limits](/docs/reference/rate-limits)
has the other APIs' limits too.

## Lists

A list answers `{ "data": [...], "next": "…" }`, newest first. Ask for up to 100 rows with `?limit=` (50 when you do not say). When `next`
is not null, pass it as `?after=` to get the next page; a page starts after the last row you got, whatever was added meanwhile. A list of
the store's records also takes `?updated_after=` (a time with its offset, such as `2026-11-03T12:00:00Z`): only what was made or changed
since, for an incremental sync. The short lists that belong to one thing do not: stock locations, a product's gallery, an order's refunds
and notes, content types, and webhook endpoints and their deliveries.

## Doing a POST once

Send an `Idempotency-Key` header (1 to 255 printable characters of your choosing) with a POST, and it is done once: the same key with the
same request gets the first answer again for 24 hours, marked `Idempotent-Replayed: true`. What is shown once (a gift card's code, a
pay link, a webhook endpoint's secret, an upload address) is in the first answer only: a replay answers it as `null`. A request is its
method, its whole path (`POST /orders/{id}/refunds` of one order is another request than of the next) and its body: the same key with
another of them is refused, and while the first request is still running a second one is told to try again (`409 conflict`). If Kaizena Flow could not answer
at all, the key is let go and your retry runs again.

## Errors

Every error answers the same shape:

```json
{ "error": { "code": "forbidden", "message": "This token does not have the scope orders:write." } }
```

| Code | Status | When |
|---|---|---|
| `unauthorized` | 401 | No token, or one that is not valid (revoked, or its maker is no longer an owner) |
| `forbidden` | 403 | The token does not have the scope the route needs, or its owner may not do this in the store now |
| `gated` | 403 | The change needs a power the token does not have (a product on the site without `products:publish`, a customer's email without `customers:email`), or the order is history copied from another store |
| `feature_off` | 403 | The store has switched off the feature the route stands behind (gift cards, subscriptions, the online shop) |
| `not_found` | 404 | No such route or method, or no such thing in this store (another store's ids are simply not found) |
| `conflict` | 409 | The request clashes with the store's state (an order that cannot be sent), or with another request using the same `Idempotency-Key` |
| `invalid` | 422 | The request is not one the route can read; the message says what is wrong |
| `rate_limited` | 429 | Past the rate limit; see `Retry-After` |
| `failed` | 500 | Something went wrong on Kaizena Flow's side, and nothing more was done |

Answers are JSON, never cached (`Cache-Control: no-store`). Each operation's page in the [API reference](/docs/reference/admin-api) says
which of these it can answer, and [Errors](/docs/reference/errors) lists every code with the operations that answer it.
