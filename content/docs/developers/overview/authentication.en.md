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

Each route needs one scope. A token with a `:write` scope may also read what it changes.

| Scope | What it opens |
|---|---|
| `products:read`, `products:write` | Products (drafts), categories and tags, pictures and a product's gallery, price lists, the product file |
| `products:publish` | Publishing, unpublishing and archiving products, and changing a product that is on the site |
| `inventory:read`, `inventory:write` | Stock locations and levels; adjust or set stock |
| `orders:read`, `orders:write` | Orders and their fulfilments, notes and tags; draft orders and quotes; returns; subscriptions; invoices and credit notes as EN 16931 UBL |
| `orders:refund` | Refunds, through the admin's own refund |
| `customers:read`, `customers:write` | Customers and their tags, store credit and bonus credits; segments |
| `discounts:read`, `discounts:write` | Discount codes |
| `gift_cards:write` | Gift cards: issue, list and deactivate |
| `checkout:read`, `checkout:write` | Checkout rules and checkout questions |
| `content:read`, `content:write` | Pages, blog articles, content entries and menus, as drafts |
| `content:publish` | Publishing pages, blog articles and content entries |
| `settings:read` | The store's countries, currencies, languages, shipping, tax profile and price display |
| `reports:read` | Saved reports, run |
| `webhooks:write` | The owner's webhook endpoints and their deliveries |

`products:publish`, `orders:refund`, `gift_cards:write`, `content:publish` and `webhooks:write` are powers: what the AI manager would ask
the owner's yes for. Give them only to a token that must do that without asking.

A call outside the token's scopes is refused with `403 forbidden`, and the message names the scope it needs. Each route also asks what its
screen in the admin asks: the staff permission it needs (in a store that is suspended or closed, only what already happened can be read and
handled) and the store feature it stands behind. The OpenAPI document names both for each operation (`x-permission`, `x-feature`).

## Rate limits

Each token may make 120 calls a minute, and a store's tokens together 1,200. A call past either limit is answered `429 rate_limited`
with a `Retry-After` header: the seconds until the next minute begins. Wait that long and try again.

## Lists

A list answers `{ "data": [...], "next": "…" }`, newest first. Ask for up to 100 rows with `?limit=` (50 when you do not say). When `next`
is not null, pass it as `?after=` to get the next page; a page starts after the last row you got, whatever was added meanwhile. Every list
also takes `?updated_after=` (a time with its offset, such as `2026-11-03T12:00:00Z`): only what was made or changed since, for an
incremental sync.

## Doing a POST once

Send an `Idempotency-Key` header (1 to 255 printable characters of your choosing) with a POST, and it is done once: the same key with the
same request gets the first answer again for 24 hours, marked `Idempotent-Replayed: true`. What is shown once (a gift card's code, a
pay link, a webhook endpoint's secret) is in the first answer only: a replay answers it as `null`. The same key with another route or body is
refused, and while the first request is still running a second one is told to try again (`409 conflict`). If Kaizena Flow could not answer
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
| `gated` | 403 | The change needs a power the token does not have (a live product without `products:publish`), or the order is history copied from another store |
| `feature_off` | 403 | The store has switched off the feature the route stands behind (gift cards, subscriptions, the online shop) |
| `not_found` | 404 | No such route or method, or no such thing in this store (another store's ids are simply not found) |
| `conflict` | 409 | The request clashes with the store's state (an order that cannot be sent), or with another request using the same `Idempotency-Key` |
| `invalid` | 422 | The request is not one the route can read; the message says what is wrong |
| `rate_limited` | 429 | Past the rate limit; see `Retry-After` |
| `failed` | 500 | Something went wrong on Kaizena Flow's side, and nothing more was done |

Answers are JSON, never cached (`Cache-Control: no-store`).
