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
checked: 2026-11-04
sources: [D355, D362, D354, D96, D353, D363, D169, D438, D439, D440]
---

## What you can use today

| Surface | Address | For | Status |
|---|---|---|---|
| Admin API v1 | `/api/admin/v1` | An owner's own integrations: 123 operations across the catalogue, stock, orders, drafts and quotes, returns, customers, marketing, content, settings, reports and webhook endpoints | Available |
| Storefront API v1 | `/api/storefront/v1/{store}` | Headless storefronts: products, categories, carts, checkout | Available |
| Webhooks | Your own HTTPS endpoint | Signed events when something happens in a store | Available |
| Shopping-agent MCP | `/api/ucp/{store}/mcp` | Any shopping agent: search the catalogue, look up products, hand a cart to checkout | Available |
| Owner MCP | `/api/mcp` | Any MCP-capable AI assistant acting for a person in their stores, after they consent | Available |
| WordPress plugin | Installed in WordPress | Showing an owner's products on a WordPress site | Available |
| Apps for many stores | — | One app that many stores install | Being built |

Every address is on Kaizena Flow's own site (`https://kaizenaflow.com`). Money is always whole minor units (cents, øre) with the
currency's ISO 4217 code beside it. Every operation, route, webhook topic and MCP tool is in the [API reference](/docs/reference), made
from the same contracts the APIs check their calls against.

## Admin API

The Admin API acts on one store. Its owner makes a token under [Settings, Apps and API](/admin/{store}/settings/api), choosing the
scopes it needs; the token is shown once. Each call names its scope, and a call the token's scopes do not cover is refused with the scope
it needs. Lists come in pages under a cursor. [How a call is authenticated](/docs/developers/overview/authentication) has the details, and
[your first call](/docs/developers/quickstarts/admin-api-token) walks through one.

What the AI manager asks the owner's yes for (publishing, a product on the site, sending a draft, a refund, a customer's email, a
discount code changed, a gift card, a webhook endpoint) is a *power*: a token holds one only if the owner gave it, and a call that needs a
power it does not hold is refused as `gated`, naming it.

## Storefront API

The storefront API reads what any visitor of one market sees, so its token (`kfs_…`, made on the same settings page, one for each
market) is public and may sit in your site's own code. It sends the token in the `X-Storefront-Token` header. It answers products,
categories and what a cart costs now; a cart can be kept by the store and handed to the store's own checkout through a one-time address.
It never places an order or takes a payment: checkout is always the store's. Its OpenAPI document is at
`/api/storefront/v1/openapi.json`.

## Webhooks

An owner adds up to ten of their own HTTPS endpoints under [Your own endpoints](/admin/{store}/integrations/endpoints), or through the
Admin API with `webhooks:write`, and chooses the topics each one gets, from 30: orders, parcels, refunds, returns and withdrawals, draft
orders and quotes, products and stock, customers (an erased one by its id alone), subscriptions, discount codes, gift cards, reviews and
someone waiting in support. The [webhooks reference](/docs/reference/webhooks) has every topic with its payload.

Every delivery is signed. It carries `Kaizena-Webhook-Id`, `Kaizena-Webhook-Timestamp` (seconds) and
`Kaizena-Webhook-Signature: v1={hex}`, the HMAC-SHA256 of `{timestamp}.{body}` with the endpoint's secret. Recompute it over the raw body,
and refuse a timestamp more than five minutes from your own clock, so a captured delivery cannot be played again later.
[Receiving events](/docs/developers/webhooks/receiving-events) and [checking a signature](/docs/developers/webhooks/verify-signatures) have
the details.

## MCP

- **Shopping agents.** A store that allows them has a public MCP endpoint at `/api/ucp/{store}/mcp` and a profile at
  `/.well-known/ucp` on its own address. Its tools (`search_catalog`, `lookup_catalog`, `get_product`, `create_cart`) answer from the
  storefront's own reads, and a cart is handed to the store's own checkout. Nothing is ordered or paid there.
  [Shopping agents](/docs/developers/mcp/shopping-agents) has the details.
- **The owner's MCP** (`https://kaizenaflow.com/api/mcp`) gives an AI assistant the admin's tools in the stores a person chooses. Any MCP
  client connects through Kaizena Flow's own OAuth 2.1 sign-in: the person signs in, ticks the stores and chooses how much it may do
  (*Read only*, *Read and propose changes*, where every change waits for their yes, or *Read and change*), never more than their own
  role allows. [The owner MCP](/docs/developers/mcp/owner-mcp) has the details, and
  [connecting an AI assistant](/docs/developers/quickstarts/connect-an-ai-assistant) walks through it.
- **Your own MCP server** can be given to the AI manager in the admin, which then calls its tools for the owner.
  [Your own tools](/docs/developers/mcp/your-own-tools) has the details.

## Sites and themes

A store's own site can show its products on WordPress with the [WordPress plugin](/docs/developers/wordpress/wordpress-plugin), and a
theme made outside Kaizena Flow can be [built and submitted to the theme store](/docs/developers/themes/build-a-theme).

## What is being built

The contracts, the OAuth 2.1 sign-in for AI assistants and the Admin API's breadth are done (versions 1.0 to 1.4 in the
[changelog](/docs/changelog)). Next are apps that many stores can install: an app registered once by its developer, installed by each
store's owner through the same consent screen, with tokens of its own for the Admin API and the MCP. Until then an integration that
serves several stores uses one token per store.

Each step is announced in the changelog. The rule for every version: nothing a v1 caller relies on is renamed or removed, and a breaking
change comes as a new version beside the old one.
