---
title: Stores, money, times and versions
summary: What the APIs mean by a store and a market, how they write ids, times and money, and how a version changes without breaking you.
track: developers
section: overview
kind: concept
areas: [admin-api, storefront-api, markets]
features: []
plans: []
order: 30
checked: 2026-11-04
sources: [D355, D362, D438, D440, D335]
---

## A store and its markets

Everything you read or change belongs to one store. An Admin API token is made in one store and acts there alone; a storefront token
belongs to one market of one store. An id from another store is simply not found.

A store sells in one or more **markets**. A market is a country with its own storefront, main language and currency, written by the country's
ISO 3166-1 code (`NO`, `SE`, `DE`). A product has a price for each market it is sold in, and is not sold where it has none. `GET /settings`
answers the store's markets, currencies and languages, its shipping, its tax profile and how it shows prices.

## Ids and times

An id is 32 hexadecimal digits in the 8-4-4-4-12 form, such as `3f2b8c1e-6d4a-4b9e-8c7f-1a2b3c4d5e6f`. Treat it as text you keep and send
back; never build one yourself.

A time is ISO 8601 with its offset, such as `2026-11-04T09:30:00Z`. Records carry `created_at`, and the ones a sync follows (products,
orders, customers, discount codes and more) carry `updated_at`. To sync, keep the time of your last run and ask a list of the store's
records for `?updated_after=` that time: you get only what was made or changed since. The short lists that belong to one thing, such as an
order's refunds, do not take it.

## Money

An amount in an answer is a whole number of the currency's **minor units** (øre, cents) beside its ISO 4217 code: never a decimal. A
product's price answers as

```json
{ "market": "NO", "currency": "NOK", "amount_minor": 24900 }
```

which is 249.00 kroner. Prices include VAT where the store's prices do, as shoppers pay them. Divide by the currency's minor units only to
show an amount to a person, and do sums in minor units.

When you write a product's prices, you give them as the product editor takes them: for each market's code, the price as text in that
market's own currency, such as `"249"` or `"249,50"`. A market you leave out is not priced, and the product is not sold there until it is.

## Versions

Each API has a published contract, made from the same code that checks every call:

| Contract | Address |
|---|---|
| Admin API | `/api/admin/v1/openapi.json` |
| Storefront API | `/api/storefront/v1/openapi.json` |
| Webhook topics | `/api/webhooks/v1/topics.json` |
| Owner MCP's tools | `/api/mcp/catalogue.json` |
| Shopping agents' tools | `/api/ucp/catalogue.json` |

The major version is in the address (`v1`). The Admin API's document also names the contract's version (`x-contract-version` in its
`info`), and every version is in the [changelog](/docs/changelog) with what changed.

Within a major version, nothing a caller relies on is renamed or removed. Answers and webhook payloads may gain fields, so read the
fields you need and ignore the rest. A breaking change comes as a new major version beside the old one.

## Where to go next

- [Authentication, scopes and limits](/docs/developers/overview/authentication): tokens, scopes, powers, rate limits, pages, doing a POST
  once, and errors.
- [Your first Admin API call](/docs/developers/quickstarts/admin-api-token), step by step.
- The [API reference](/docs/reference), made from the contracts above.
