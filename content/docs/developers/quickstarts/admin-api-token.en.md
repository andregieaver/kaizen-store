---
title: Your first Admin API call
summary: Make a token for one store, read its products, make a draft product once, and see what a token without a power is told.
track: developers
section: quickstarts
kind: tutorial
areas: [admin-api, authentication, products]
features: []
plans: []
admin: /admin/{store}/settings/api
order: 10
checked: 2026-11-04
sources: [D355, D440]
operations: [products.list, products.create, products.publish]
---

You need a store you own on Kaizena Flow and a terminal with `curl`. Every step works the same from any language that can send HTTPS.

## Make a token

1. In the admin, open [Settings, Apps and API](/admin/{store}/settings/api). Only an owner can make tokens.
2. Give it a **Name** after what will use it, such as `Warehouse` or `My script`.
3. Under **What it may do**, tick `products:read` and `products:write`. Leave the powers under *Customise* alone for now.
4. Press **Make a token** and copy the token. It is shown only this once: Kaizena Flow keeps a fingerprint of it, never the token.

Keep it in an environment variable, never in code:

```bash
export KAIZENA_TOKEN='kf_…'
```

> [!WARNING]
> Anyone with the token can do what its scopes allow in your store. Keep it on your own server. If it leaks, press **Revoke** on the same
> page: every call with it is refused from then on.

## Read your products

```bash
curl 'https://kaizenaflow.com/api/admin/v1/products?limit=5' \
  -H "Authorization: Bearer $KAIZENA_TOKEN"
```

The answer is a page of products, newest first:

```json
{
  "data": [
    {
      "id": "3f2b8c1e-6d4a-4b9e-8c7f-1a2b3c4d5e6f",
      "handle": "linen-shirt",
      "title": "Linen shirt",
      "status": "active",
      "kind": "goods",
      "created_at": "2026-11-04T09:30:00Z",
      "updated_at": "2026-11-04T09:30:00Z",
      "variants": [
        {
          "id": "7c9e2f4a-1b3d-4e5f-8a6b-9c0d1e2f3a4b",
          "sku": "LIN-M",
          "active": true,
          "options": null,
          "prices": [{ "market": "NO", "currency": "NOK", "amount_minor": 49900 }]
        }
      ]
    }
  ],
  "next": "…"
}
```

Money is in minor units with its currency: `49900` NOK is 499.00 kroner. When `next` is not null, send it back as `?after=` for the next
page. [Stores, money, times and versions](/docs/developers/overview/concepts) explains these.

## Make a draft product

A draft is not on the site. Send an `Idempotency-Key` you make yourself, so a retry after a dropped connection never makes two:

```bash
curl -X POST 'https://kaizenaflow.com/api/admin/v1/products' \
  -H "Authorization: Bearer $KAIZENA_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: first-shirt-1" \
  -d '{"title": "Linen shirt", "prices": {"NO": "499"}, "stock": 10}'
```

It answers `201` with the product, its `status` `draft`. Prices are written as the product editor takes them: for each market's code, the
price as text in that market's currency, VAT included as shoppers pay. The draft is in the admin's product list, where you can add its
pictures and check it.

## Publish it

```bash
curl -X POST "https://kaizenaflow.com/api/admin/v1/products/$PRODUCT_ID/publish" \
  -H "Authorization: Bearer $KAIZENA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

With the scopes you gave, this is refused:

```json
{ "error": { "code": "forbidden", "message": "This token does not have the scope products:publish." } }
```

Putting a product on the site is one of the **powers**: what the AI manager asks the owner's yes for. A token holds a power only if the
owner ticked it under *Customise* when making the token. So either publish the draft in the admin, or make a token that holds
`products:publish` for a system that must publish without asking. Changing a product that is already on the site needs the same power: a
`PATCH` without it answers `gated`.

## Where to go next

- [Authentication, scopes and limits](/docs/developers/overview/authentication): every scope and power, rate limits, pages, `Idempotency-Key`
  and errors.
- The [Admin API reference](/docs/reference/admin-api): every operation with its fields and an example.
- [Receive a webhook](/docs/developers/quickstarts/webhook-receiver) when something changes, instead of asking again and again.
