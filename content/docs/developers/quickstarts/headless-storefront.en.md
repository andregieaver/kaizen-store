---
title: Build a headless storefront
summary: Show a store's products on your own site with the storefront API, keep a cart in the store and send the shopper to the store's own checkout.
track: developers
section: quickstarts
kind: tutorial
areas: [storefront-api, products, orders]
features: []
plans: []
admin: /admin/{store}/settings/api
order: 20
checked: 2026-11-04
sources: [D362, D398, D170, D323, D431]
---

In this tutorial you build the parts of a shop front of your own: a product list, a product page, a cart and the step to checkout. Your
site draws everything. Kaizena Flow answers what one market of the store shows any visitor, keeps the cart, and takes the order and the
payment on the store's own checkout.

You need a store that is open, has the online shop switched on and is not in private mode. The storefront API answers nothing for any
other store, nor for a demo store or starting content.

## Make a storefront token

1. Open [Settings, Apps and API](/admin/{store}/settings/api). Only an owner of the store can make a token.
2. Under **Storefront API**, give the token a name (1 to 60 characters, such as "My site"), choose the **Country** it shows, and press
   **Make a storefront token**.
3. Copy the token from the list. It starts with `kfs_`.

A storefront token belongs to one market of the store. It sees that market's products, prices, language and currency, as a visitor of that
country does. For a site that sells in two countries, make a token for each. A store can have at most 10 storefront tokens in use, and the
same page revokes one at once.

> [!NOTE]
> A storefront token is public by design: it opens only what any visitor of its market sees, so it may sit in your site's own code. The
> list keeps showing it in full. It is not an Admin API token, and it cannot read orders, customers or settings.

The same card lists every route with your store's address, and links the contract.

## Make a first call

Every call goes to `https://kaizenaflow.com/api/storefront/v1/{store}/…`, where `{store}` is the store's slug: the name in its admin
address, `/admin/{store}/…`. Send the token in the `X-Storefront-Token` header.

```bash
curl "https://kaizenaflow.com/api/storefront/v1/your-store/categories" \
  -H "X-Storefront-Token: $KAIZENA_STOREFRONT_TOKEN"
```

```json
{
  "categories": [
    { "id": "4f0c2a7e-1d3b-4c5a-9e8f-2b6d7c8a9e01", "name": "Bags", "depth": 0 },
    { "id": "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d", "name": "Totes", "depth": 1 }
  ],
  "tags": [{ "id": "0b8c6d2e-7f1a-4b3c-9d5e-6f7a8b9c0d1e", "name": "Organic cotton" }]
}
```

Categories come as a tree in reading order: each category by name, followed by its own, with its `depth` (0 at the top). Tags come by
name.

A call without a token, or with a token of another store, is answered `401 unauthorized`. The answer never says which of the two it was.

## List products

`GET /products` lists the products as the token's market lists them.

| Parameter | Value | Default |
|---|---|---|
| `category` | A category's `id` from `/categories` | All products |
| `tag` | A tag's `id` from `/categories` | All products |
| `sort` | `newest`, `oldest`, `title`, `priceLow` or `priceHigh` | `newest` |
| `limit` | 1 to 48 | 12 |

```bash
curl "https://kaizenaflow.com/api/storefront/v1/your-store/products?limit=1&sort=priceLow" \
  -H "X-Storefront-Token: $KAIZENA_STOREFRONT_TOKEN"
```

```json
{
  "store": { "slug": "your-store", "name": "Your Store" },
  "market": { "slug": "ie", "country": "IE", "name": "Ireland", "currency": "EUR", "language": "en" },
  "open": true,
  "products": [
    {
      "id": "6f1d3c2a-8b4e-4f7a-9c1d-2e3f4a5b6c7d",
      "handle": "canvas-tote",
      "title": "Canvas tote",
      "excerpt": "A sturdy tote in organic cotton canvas.",
      "url": "https://shop.example.com/ie/p/canvas-tote",
      "image": { "url": "https://shop.example.com/media/canvas-tote.jpg", "alt": "A natural canvas tote bag" },
      "price": {
        "text": "€29.00",
        "vat_label": "incl. VAT",
        "from_label": null,
        "prior_label": null,
        "prior_text": null,
        "unit_text": null,
        "amount_minor": 2900,
        "amount_decimal": "29.00",
        "currency": "EUR"
      },
      "cart": { "cartable": true, "reason": null, "variant_id": null, "variant_count": 2, "sold_out": false }
    }
  ],
  "shop_url": "https://shop.example.com/ie",
  "labels": { "addToCart": "Add to cart", "soldOut": "Sold out" }
}
```

What to do with each product:

- Link to your own product page by `handle`, or to the store's page by `url`.
- `cart` says whether the product can go in a cart from your site. When `cartable` is false, `reason` says why (`booking`, `subscription`,
  `business_only` or `service`): such a product needs a time, a plan or a business buyer, chosen on the store's own page, so link to `url`.
- `cart.variant_id` is set when the product has one variant, so a card can add it at once. With more variants it is null: open the
  product page and let the shopper choose. `cart.sold_out` is true when none of its shipped variants is in stock now.
- `labels` holds the storefront's own words in the market's language, such as `addToCart`. A `{n}` in one stands for a number you fill in.

A call answers at most 48 products, and there is no cursor for more. A product whose price is given on request is not listed, and
`GET /products/{handle}` answers `404` for it: it has no price to show and no cart.

## Read one product

`GET /products/{handle}` answers one product's page: its pictures, its options and every variant with its price, stock and quantity rule.

```bash
curl "https://kaizenaflow.com/api/storefront/v1/your-store/products/canvas-tote" \
  -H "X-Storefront-Token: $KAIZENA_STOREFRONT_TOKEN"
```

```json
{
  "store": { "slug": "your-store", "name": "Your Store" },
  "market": { "slug": "ie", "country": "IE", "name": "Ireland", "currency": "EUR", "language": "en" },
  "open": true,
  "product": {
    "id": "6f1d3c2a-8b4e-4f7a-9c1d-2e3f4a5b6c7d",
    "handle": "canvas-tote",
    "title": "Canvas tote",
    "description": "A sturdy tote in organic cotton canvas, with an inside pocket.",
    "seo_title": "Canvas tote",
    "seo_description": "A sturdy tote in organic cotton canvas.",
    "url": "https://shop.example.com/ie/p/canvas-tote",
    "images": [
      {
        "url": "https://shop.example.com/media/canvas-tote.jpg",
        "thumbnail": "https://shop.example.com/media/canvas-tote-thumb.jpg",
        "alt": "A natural canvas tote bag"
      }
    ],
    "options": [{ "name": "Colour", "values": ["Natural", "Black"] }],
    "variants": [
      {
        "id": "0c9e8d7f-6a5b-4c3d-8e2f-1a0b9c8d7e6f",
        "sku": "TOTE-NAT",
        "options": { "Colour": "Natural" },
        "price": {
          "text": "€29.00",
          "vat_label": "incl. VAT",
          "from_label": null,
          "prior_label": null,
          "prior_text": null,
          "unit_text": null,
          "amount_minor": 2900,
          "amount_decimal": "29.00",
          "currency": "EUR"
        },
        "image": null,
        "stock": { "level": "in_stock", "max": 20, "low": null },
        "backorder_days": null,
        "quantity_rule": { "min": 1, "max": 20, "step": 1, "text": null }
      },
      {
        "id": "1d0f9e8a-7b6c-4d5e-9f3a-2b1c0d9e8f7a",
        "sku": "TOTE-BLK",
        "options": { "Colour": "Black" },
        "price": {
          "text": "€29.00",
          "vat_label": "incl. VAT",
          "from_label": null,
          "prior_label": null,
          "prior_text": null,
          "unit_text": null,
          "amount_minor": 2900,
          "amount_decimal": "29.00",
          "currency": "EUR"
        },
        "image": null,
        "stock": { "level": "low", "max": 3, "low": 3 },
        "backorder_days": null,
        "quantity_rule": { "min": 1, "max": 20, "step": 1, "text": null }
      }
    ],
    "cartable": true,
    "reason": null
  },
  "labels": { "addToCart": "Add to cart", "chooseOptions": "Choose a variant", "lowStock": "Only {n} left" }
}
```

The `labels` above are trimmed: the answer holds every word a product page and a cart need.

- **Choosing a variant.** `options` lists each option's name and values in the owner's order. Each variant's `options` names its value of
  each, so the shopper's choices lead to one variant.
- **Stock.** `stock.level` is `in_stock`, `low` or `out`; `low` gives the number left when it is low. `stock.max` is the most one line may
  hold now. `backorder_days` is set for a variant that keeps selling when none is in stock: it says the days stated for delivery.
- **How many at a time.** `quantity_rule` gives the least (`min`), the most (`max`) and the step (`step`), and in `text` the shopper's
  words for it, or null when there is nothing to say. Start a quantity field at `min` and move it by `step`.
- **Words.** `description` is plain text, never HTML. Draw it as text.

## Show prices as the store does

Every price in an answer is written out for you, in the market's language and currency, with the store's own rules for VAT and reductions.

| Field | What it holds |
|---|---|
| `text` | The price as the store shows it, such as `€29.00` |
| `vat_label` | Whether that price includes VAT, in the market's language: `incl. VAT` or `excl. VAT` in English |
| `from_label` | "From" when the product's variants differ in price and this is the lowest; otherwise null |
| `prior_label`, `prior_text` | For a genuine reduction only: the words for the lowest price in the last 30 days, and that price. Otherwise null |
| `unit_text` | The unit price, such as a price per kg, when the product has a content to compare by; otherwise null |
| `amount_minor`, `currency` | The same amount in whole minor units (cents, øre) and its ISO 4217 code, for a site that formats it itself |
| `amount_decimal` | The same amount as a decimal written as text, such as `29.00`, for structured data |

The rules your page keeps:

- Show `vat_label` beside every price. A store that sells only to businesses shows its prices without VAT, and its amounts are the
  amounts without VAT. Any other store, one that sells to both included, shows prices with VAT.
- Show `prior_text` only when it is there. Never work out a reduction or a "was" price yourself: Kaizena Flow gives one only when the
  reduction is genuine.
- Never compute a price from another. A line in a cart is priced by the store at its quantity, so a price break is already in it.

## Make a cart and add lines

A cart kept by the store lives in the token's market. Make one with `POST /carts`, with its first lines or none:

```bash
curl -X POST "https://kaizenaflow.com/api/storefront/v1/your-store/carts" \
  -H "X-Storefront-Token: $KAIZENA_STOREFRONT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "lines": [{ "variantId": "0c9e8d7f-6a5b-4c3d-8e2f-1a0b9c8d7e6f", "quantity": 2 }] }'
```

It answers `201` with the cart, as `GET /carts/{cart}` reads it below, and the cart's key in `cart`: `kfc_` and a long secret. The store
keeps only a hash of it, so the key is shown in your answers only. Keep it with the shopper's session, and never in an address another
person could see: the key, with a token of the store for the cart's market, opens the cart.

Then change the cart's lines:

| Call | Body | What it does |
|---|---|---|
| `POST /carts/{cart}/lines` | `{ "variantId": "…", "quantity": 1 }` | Adds units of a variant: at least the rule's minimum, then whole steps, cut to what is available |
| `PATCH /carts/{cart}/lines/{variantId}` | `{ "quantity": 4 }` | Sets the line to exactly that quantity; 0 removes it |
| `DELETE /carts/{cart}/lines/{variantId}` | None | Removes the line |

Each answers the cart as it is now. A quantity in a body is a whole number: 1 to 999 when adding, 0 to 999 when setting. Each line is
checked as the store's own cart checks it: a variant sold in the market, goods only (never a gift card), the stock, and the variant's rule.
Setting a quantity below the rule's minimum, or between its steps, is refused and the line kept as it was. A cart holds at most 50 lines.
A line given to `POST /carts` that cannot be put in is left out, so read `lines` in the answer.

When nothing changed, the answer says why:

| Status | Code | When |
|---|---|---|
| `400` | `invalid_line` | The body or the variant's id cannot be read |
| `404` | `not_found` | No such cart: a wrong key, a cart handed to checkout, or one that has run out |
| `422` | `unavailable` | The variant cannot be bought in this market now |
| `422` | `quantity` | The variant's rule does not allow that quantity (see the line's `quantity_rule`) |
| `422` | `too_many_lines` | The cart already holds 50 lines |

A cart runs out 30 days after it was made or last changed.

## Read what it costs

`GET /carts/{cart}` answers what the cart holds and costs now, with live prices and stock:

```json
{
  "market": { "slug": "ie", "country": "IE", "name": "Ireland", "currency": "EUR", "language": "en" },
  "lines": [
    {
      "variant_id": "0c9e8d7f-6a5b-4c3d-8e2f-1a0b9c8d7e6f",
      "product_id": "6f1d3c2a-8b4e-4f7a-9c1d-2e3f4a5b6c7d",
      "handle": "canvas-tote",
      "title": "Canvas tote",
      "options": { "Colour": "Natural" },
      "image": { "url": "https://shop.example.com/media/canvas-tote-thumb.jpg", "alt": "A natural canvas tote bag" },
      "url": "https://shop.example.com/ie/p/canvas-tote",
      "quantity": 2,
      "status": "ok",
      "available": 20,
      "fitted": 2,
      "quantity_rule": { "min": 1, "max": 20, "step": 1, "text": null },
      "backorder": null,
      "unit": {
        "text": "€29.00",
        "vat_label": "incl. VAT",
        "from_label": null,
        "prior_label": null,
        "prior_text": null,
        "unit_text": null,
        "amount_minor": 2900,
        "amount_decimal": "29.00",
        "currency": "EUR"
      },
      "line_text": "€58.00"
    }
  ],
  "subtotal_minor": 5800,
  "subtotal_text": "€58.00",
  "vat_label": "incl. VAT",
  "count": 2,
  "labels": { "subtotal": "Subtotal", "shippingAtCheckout": "Shipping and delivery times are shown at checkout." },
  "cart": "kfc_…"
}
```

Each line's `status` is one of these:

| `status` | Meaning |
|---|---|
| `ok` | The quantity can be bought as it is |
| `insufficient` | More was asked than there is: `available` says how many can be |
| `quantity` | The variant's rule does not allow the quantity: `fitted` is what it allows, and `quantity_rule.text` says why |
| `unavailable` | It cannot be bought now, and it is left out of the subtotal |

`fitted` is the quantity counted in the subtotal and put in the checkout. `backorder` gives the units beyond the stock and the days stated
for them, for a variant that keeps selling when none is in stock. `count` is the number of units counted.

The total is a subtotal: shipping, discounts and campaigns are worked out at the store's checkout, with the shopper's address. Show
`labels.shippingAtCheckout` beside it.

## Hand the cart to checkout

`POST /carts/{cart}/checkout` answers the one-time address of the store's own checkout:

```json
{ "url": "https://shop.example.com/ie/cart/resume?t=kzwh_…" }
```

Send the shopper's browser to `url`. Do not fetch it from your server: opening it makes the cart this browser's in the store, then goes on
to the checkout. It works once, for fifteen minutes. A used or expired address opens the store's cart page instead.

The key opens nothing after this: the cart is the shopper's in the store, and is ordered and paid there like any other cart. A call with
the key then answers `404 no_such_cart`. An empty cart is refused with `422 nothing_to_buy`.

## Without a kept cart

If your site keeps the cart itself, two calls take its lines as `{ "lines": [{ "variantId": "…", "quantity": 2 }] }`, 1 to 50 lines:

- `POST /cart` answers what the lines cost now, in the same shape as a kept cart without its key. Nothing is kept.
- `POST /checkout` makes a cart of the lines in the store and answers `{ "url": "…", "lines": [...] }`: the same one-time address, and
  each line's `variant_id`, `quantity` and `outcome` (`added`, `capped` when cut to the stock, or `unavailable`). When nothing can be bought
  it answers `422 nothing_to_buy`.

## In the browser

Any site may call the API from a browser: it allows every origin and answers the preflight a browser sends for the token's header.

```js
const BASE = "https://kaizenaflow.com/api/storefront/v1/your-store";
const TOKEN = "kfs_your_token"; // public by design: it may sit in your site's code

async function storefront(path, options = {}) {
  const response = await fetch(BASE + path, {
    ...options,
    headers: { "X-Storefront-Token": TOKEN, "Content-Type": "application/json" },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${body.error.code}: ${body.error.message}`);
  return body;
}

// A product list.
const { products, labels } = await storefront("/products?limit=12");

// A cart kept by the store, with one line.
let cart = await storefront("/carts", { method: "POST", body: JSON.stringify({ lines: [] }) });
const key = cart.cart; // keep it with the shopper's session
cart = await storefront(`/carts/${key}/lines`, {
  method: "POST",
  body: JSON.stringify({ variantId: "0c9e8d7f-6a5b-4c3d-8e2f-1a0b9c8d7e6f", quantity: 1 }),
});
console.log(cart.subtotal_text, cart.vat_label);

// To checkout: the browser goes to the store's own checkout.
const { url } = await storefront(`/carts/${key}/checkout`, { method: "POST" });
window.location.assign(url);
```

## What the API never does

- It places no order and takes no payment. The checkout is always the store's own page.
- It works out no price, stock or VAT of its own: every answer is the storefront's own read for the token's market.
- It has no shipping, discount codes or campaigns: those are the checkout's.
- It does not put bookings, subscriptions or gift cards in a cart.
- It reads no orders, customers or settings. For those, an owner's integration uses the Admin API.

## Errors and limits

Every refusal answers the same shape:

```json
{ "error": { "code": "quantity", "message": "The variant's quantity rule does not allow that quantity: see the line's quantity_rule." } }
```

| Status | Codes | When |
|---|---|---|
| `400` | `invalid_request`, `invalid_cart`, `invalid_line` | The query or body cannot be read |
| `401` | `unauthorized` | No storefront token of this store in `X-Storefront-Token` |
| `404` | `not_found`, `no_such_market`, `no_such_product`, `no_such_cart` | No such store (or it is not open, sells nothing or is private), the token's market is no longer offered, or no such product or cart |
| `422` | `unavailable`, `quantity`, `too_many_lines`, `nothing_to_buy` | Nothing changed, for the reason the code names |
| `429` | `rate_limited` | Too many calls; `Retry-After` says how many seconds to wait |

A token may make 1,200 calls a minute, and a store's tokens together 6,000. The answers to `/products`, `/products/{handle}` and
`/categories` may be kept for a minute (`Cache-Control: public, max-age=60`), so a change in the store can take that long to show. Cart
calls are never cached.

The contract is an OpenAPI 3.1 document at `https://kaizenaflow.com/api/storefront/v1/openapi.json`, made from the same routes the API
answers. The [storefront API reference](/docs/reference/storefront-api) has every route, its fields and its errors, and
[Rate limits](/docs/reference/rate-limits) has the other APIs' limits.
