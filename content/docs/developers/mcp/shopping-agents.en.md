---
title: The shopping agents' MCP server
summary: A store's public MCP server for AI agents that shop for people: its UCP profile, the switch that lets agents in, its four tools, carts handed to the store's own checkout, and its limits.
track: developers
section: mcp
kind: concept
areas: [shopping-agents, mcp]
features: []
plans: []
admin: /admin/{store}/feeds
order: 20
checked: 2026-11-04
sources: [D353, D438, D170]
tools: [search_catalog, lookup_catalog, get_product, create_cart]
---

## What it is

A store that allows them has a public MCP server for AI agents that shop for people, as the Universal Commerce Protocol (UCP, version
`2026-08-25`) describes it. An agent can search the store's products, read their prices and whether they can be bought, and put a cart
together. Nothing is ordered or paid there: the shopper pays in the store's own checkout.

It is apart from the [owner MCP server](/docs/developers/mcp/owner-mcp). It takes no token and sets no cookie, nobody signs in, and nothing
about a person is asked for or kept. It answers what any visitor of the store can see.

- **Address:** `https://kaizenaflow.com/api/ucp/{store}/mcp`, where `{store}` is the store's slug
- **Transport:** Streamable HTTP with JSON-RPC 2.0, protocol version `2025-06-18`. Answers are plain JSON, `POST` only
- **Tools:** [Shopping agents](/docs/reference/mcp/shopping-agents) in the reference, made from the catalogue at
  [/api/ucp/catalogue.json](/api/ucp/catalogue.json)

## Finding a store

A store's UCP business profile is at `/.well-known/ucp` on the store's own address. While a store is served under Kaizena Flow's own
address, it is at `https://kaizenaflow.com/s/{store}/.well-known/ucp`. The profile names the shopping service over MCP at the store's
endpoint, the three capabilities, and no payment handler:

```json
{
  "ucp": {
    "version": "2026-08-25",
    "services": {
      "dev.ucp.shopping": [
        {
          "version": "2026-08-25",
          "spec": "https://ucp.dev/2026-08-25/specification/overview",
          "transport": "mcp",
          "endpoint": "https://kaizenaflow.com/api/ucp/{store}/mcp",
          "schema": "https://ucp.dev/2026-08-25/services/shopping/mcp.openrpc.json"
        }
      ]
    },
    "capabilities": {
      "dev.ucp.shopping.catalog.search": [
        {
          "version": "2026-08-25",
          "spec": "https://ucp.dev/specification/shopping/catalog/",
          "schema": "https://ucp.dev/2026-08-25/schemas/shopping/catalog_search.json"
        }
      ],
      "dev.ucp.shopping.catalog.lookup": [
        {
          "version": "2026-08-25",
          "spec": "https://ucp.dev/specification/shopping/catalog/",
          "schema": "https://ucp.dev/2026-08-25/schemas/shopping/catalog_lookup.json"
        }
      ],
      "dev.ucp.shopping.cart": [
        {
          "version": "2026-08-25",
          "spec": "https://ucp.dev/specification/shopping/cart/",
          "schema": "https://ucp.dev/2026-08-25/schemas/shopping/cart.json"
        }
      ]
    },
    "payment_handlers": {}
  }
}
```

The store's `agents.md` and a line in its `llms.txt` give the profile's and the endpoint's addresses too.

## When a store answers

A store answers agents only while all of these are true:

- the store is open, and not a template;
- its owner switched *Shopping agents* on. It is off until then;
- the store is not private;
- its online shop is on;
- AI assistants are allowed to read the store under [SEO & Reach](/admin/{store}/settings/seo): *Let AI search and assistants read the
  store to answer people's questions*. An agent is one of them, so it is shut out with them.

Otherwise the profile answers `404`, and the endpoint `404` with the JSON-RPC error `-32001`, *This store does not take requests from
shopping agents.*

The switch is on the store's [Product feeds](/admin/{store}/feeds) page, in the *Shopping agents* card: *Let shopping agents in*, for
someone who may change marketing. While it is on, the card shows the profile's and the endpoint's addresses, or what still keeps agents
out.

## The tools

| Tool | What it does | Its arguments |
|---|---|---|
| `search_catalog` | Searches the products for sale in a country by keyword, ranked as the store's own search ranks them (never by an AI model). Without words, the newest. At most 10 | `catalog.query` (up to 200 characters), `catalog.pagination.limit` (up to 10), `catalog.context` |
| `lookup_catalog` | Gets products by their ids, or by their variants' ids. At most 20 ids | `catalog.ids`, `catalog.context` |
| `get_product` | Gets one product with every variant: options, price, whether it can be bought now, pictures and its page in the store | `catalog.id` (a product's or a variant's), `catalog.context` |
| `create_cart` | Puts variants in a cart in the store and answers the link where the shopper opens it | `cart.line_items` (up to 20, each `{ "item": { "id": … }, "quantity": … }`), `cart.context` |

Arguments are nested under `catalog` or `cart`, as UCP has them. An agent that sends them flat is understood too.

- **Ids** are `gid://kaizena-flow/Product/{uuid}` and `gid://kaizena-flow/ProductVariant/{uuid}`. A bare uuid is read as either.
- **The country** is `context.address_country`, an ISO 3166-1 alpha-2 code. It picks the country's prices and currency. Without it the
  store's own country is used. For a country the store does not sell to, the tool says which countries it does sell to.
- **Prices** are integer minor units with the currency's code, VAT included, as the store charges them in that country. A variant whose
  price is a reduction also has, as `list_price`, the lowest price of the 30 days before.
- **Whether it can be bought:** each variant has `availability.available`, from the stock now. A product's `metadata.cartable` says
  whether the endpoint can put it in a cart: goods bought once can be. An appointment, a stay or a subscription is booked in the store
  itself. A product priced on request is left out of every answer.

A tool's answer carries its JSON twice: as `structuredContent`, and as text in `content`. It holds a `ucp` block with the version and
the capability it answers for. A refusal is a tool result with `isError: true` and words that say what is wrong.

## Carts go to the store's checkout

A call of `create_cart`:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "create_cart",
    "arguments": {
      "cart": {
        "line_items": [{ "item": { "id": "gid://kaizena-flow/ProductVariant/…" }, "quantity": 2 }],
        "context": { "address_country": "NO" }
      }
    }
  }
}
```

Each line names a variant, and a quantity from 1 to 99. The lines are checked as adding them in the store would check them: a variant on
sale with a price in that country, goods only, and stock for the quantity. A quantity above the stock is cut to it. A line that cannot be
bought is left out, with a warning in `messages` (code `unavailable`). When nothing can be bought, the tool refuses.

| Field of the answer | What it is |
|---|---|
| `id` | The cart's id |
| `currency` | The country's currency |
| `line_items` | Each line kept: the variant's id, its title and unit price, the quantity and the line's subtotal |
| `totals` | The subtotal, with the store's VAT words as `display_text` |
| `continue_url` | Where the shopper opens the cart in the store |
| `expires_at` | When `continue_url` stops working |
| `messages` | A warning for each line left out |

Shipping, discounts and the total are worked out in the store's checkout, with the shopper's address.

The shopper opens `continue_url` once, within 15 minutes. It makes the cart theirs in the store, where they check out and pay as any
shopper does. Until then the cart belongs to no one and holds no stock. It is the same hand-off a WordPress site's cart uses. An order
from it counts in the store's *AI agents* channel in its analytics.

## Limits

| What | Limit |
|---|---|
| Requests from one caller | 60 a minute |
| Requests to one store, from every caller together | 1,200 a minute |
| Calls in one request | The first 10 of a batch are answered |
| A request's body | 50,000 characters |
| `search_catalog` | 10 products |
| `lookup_catalog` | 20 ids |
| `create_cart` | 20 lines, 99 of each |

One HTTP request counts once, however many calls its batch holds. Past a limit the answer is `429` with `Retry-After: 60` and the
JSON-RPC error `-32002`. A larger body is answered `413`.

## Who is calling

The server does not ask an agent who it is: it reads no token, key or signature, and needs none. It counts each caller by a hash of its
address and the day, so the address itself is never kept. Answers are sent with `Cache-Control: no-store` and `X-Robots-Tag: noindex`.

In a store's analytics, a visit from `chatgpt.com`, `chat.openai.com`, `perplexity.ai`, `copilot.microsoft.com` or `gemini.google.com`,
or with a `utm_source` naming one of them, counts in the *AI agents* channel. An order from an agent's cart counts there whatever visit
opened it.
