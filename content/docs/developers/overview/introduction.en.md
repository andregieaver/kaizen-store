---
title: Build on Kaizena Flow
summary: The APIs, events and MCP servers outside systems can use today, who each is for, and what is still being built.
track: developers
section: overview
kind: concept
areas: [admin-api, storefront-api, webhooks, mcp, shopping-agents]
features: []
plans: []
admin: /admin/{store}/settings/api
order: 10
checked: 2026-11-03
sources: [D355, D362, D354, D96, D353, D363, D169]
---

## What you can use today

| Surface | Address | For | Status |
|---|---|---|---|
| Admin API v1 | `/api/admin/v1` | An owner's own integrations: products, stock, orders, customers, discounts, checkout rules | Available |
| Storefront API v1 | `/api/storefront/v1/{store}` | Headless storefronts: products, categories, carts, checkout | Available |
| Webhooks | Your own HTTPS endpoint | Signed events when something happens in a store | Available |
| Shopping-agent MCP | `/api/ucp/{store}/mcp` | Any shopping agent: search the catalogue, look up products, hand a cart to checkout | Available |
| Owner MCP | `/api/mcp` | An AI assistant acting for a store's owner | Kaizen Life only, for now |
| WordPress plugin | Installed in WordPress | Showing an owner's products on a WordPress site | Available |

Every address is on Kaizena Flow's own site (`https://kaizenaflow.com`). Money is always whole minor units (cents, øre) with the
currency's ISO 4217 code beside it.

## Admin API

The Admin API acts on one store. Its owner makes a token under [Settings, Apps and API](/admin/{store}/settings/api), choosing the
scopes it needs; the token is shown once. Each call names its scope, and a call the token's scopes do not cover is refused with the scope
it needs. Lists come in pages under a cursor. [How a call is authenticated](/docs/developers/overview/authentication) has the details.

Some changes are kept for a person to make in the admin and are refused through the API as `gated`: publishing, making a product live, a
refund, an email a person decides on.

## Storefront API

The storefront API reads what any visitor of one market sees, so its token (`kfs_…`, made on the same settings page, one for each
market) is public and may sit in your site's own code. It sends the token in the `X-Storefront-Token` header. It answers products,
categories and what a cart costs now; a cart can be kept by the store and handed to the store's own checkout through a one-time address.
It never places an order or takes a payment: checkout is always the store's. Its OpenAPI document is at
`/api/storefront/v1/openapi.json`.

## Webhooks

An owner adds up to ten of their own HTTPS endpoints under [Your own endpoints](/admin/{store}/integrations/endpoints) and chooses the
topics each one gets, from 14: orders paid, sent, cancelled and refunded, new customer accounts, subscriptions started and cancelled,
returns and withdrawals, products created and changed, low stock, discount codes and someone waiting in support.

Every delivery is signed. It carries `Kaizena-Webhook-Id`, `Kaizena-Webhook-Timestamp` (seconds) and
`Kaizena-Webhook-Signature: v1={hex}`, the HMAC-SHA256 of `{timestamp}.{body}` with the endpoint's secret. Recompute it over the raw body,
and refuse a timestamp more than five minutes from your own clock, so a captured delivery cannot be played again later.

## MCP

- **Shopping agents.** A store that allows them has a public MCP endpoint at `/api/ucp/{store}/mcp` and a profile at
  `/.well-known/ucp` on its own address. Its tools (`search_catalog`, `lookup_catalog`, `get_product`, `create_cart`) answer from the
  storefront's own reads, and a cart is handed to the store's own checkout. Nothing is ordered or paid there.
- **The owner's MCP** (`/api/mcp`) gives an AI assistant the store's admin tools, with anything that changes the store waiting for the
  owner's yes. Today only Kaizen Life can connect to it. Connecting any AI assistant, with its own sign-in and scopes, is being built.
- **Your own MCP server** can be given to the AI manager in the admin, which then calls its tools for the owner.

## What is being built

Kaizena Flow is opening these surfaces further, in this order:

1. Published contracts: OpenAPI documents for both APIs and a typed payload for every webhook topic, generated from the code.
2. Kaizena Flow's own OAuth 2.1 sign-in, so any AI assistant can connect to the owner's MCP.
3. More of the admin through the Admin API, and more events.
4. Apps that many stores can install.

Each step is announced in the [changelog](/docs/changelog). The rule for every version: nothing a v1 caller relies on is renamed or
removed, and a breaking change comes as a new version beside the old one.
