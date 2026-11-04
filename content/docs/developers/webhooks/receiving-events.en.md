---
title: Receiving events
summary: How a store sends signed events to your own HTTPS endpoint, what a delivery holds, what counts as received, retries, tests, sending one again, and the Admin API's operations for endpoints.
track: developers
section: webhooks
kind: concept
areas: [webhooks, integrations, admin-api]
features: []
plans: []
admin: /admin/{store}/integrations/endpoints
order: 10
checked: 2026-11-04
sources: [D354, D438, D440]
operations: [webhooks.list, webhooks.create, webhooks.update, webhooks.delete, webhooks.deliveries, webhooks.resend]
---

## How it works {#how-it-works}

A store's owner adds up to ten endpoints under [Your own endpoints](/admin/{store}/integrations/endpoints) (*Integrations*, then
*Manage endpoints*). Each endpoint has a name, an HTTPS address and the topics it gets. Only an owner adds or changes an endpoint, as
endpoints get customers' details.

When something happens in the store, the database queues a delivery for every endpoint that is on and has chosen that topic, in the same
transaction as the change itself. Every minute, Kaizena Flow sends the deliveries that are due: each a signed `POST` of JSON to the
endpoint's address.

### The address {#address}

An endpoint's address:

- starts with `https://`, on a host name (not an IP address), with no port other than 443, no user name or password, and at most 500
  characters;
- leads only to public addresses: a host whose name points at a private, loopback or link-local address is refused.

The address is checked when it is saved and again at every send, and redirects are not followed. It is kept encrypted: the admin and the
Admin API show only its host name.

### The signing secret {#secret}

Each endpoint has its own signing secret: `whsec_` and 43 characters. It is shown once, when the endpoint is added, and never again.
*New secret* makes another one, also shown once; the old one stops working at once, so update your receiver straight after.
[Verify a delivery's signature](/docs/developers/webhooks/verify-signatures) shows how to use it.

## Topics {#topics}

An endpoint gets the topics its owner chose for it, at least one. [The topics](/docs/reference/webhooks#topics) in the reference lists
every one with what it means and who it is sent to, and each topic's page has its payload and an example. The same catalogue is published
as JSON at `/api/webhooks/v1/topics.json`, and in the Admin API's OpenAPI document under `webhooks`.

Some topics also go to Zapier, Make and Slack; the others go to your own endpoints only. The admin offers the subscription topics only when
the store has subscriptions switched on.

## What a delivery holds {#delivery}

A delivery is a `POST` with `Content-Type: application/json`, `User-Agent: KaizenaFlow-Webhooks/1.0` and these headers:

| Header | What it holds |
|---|---|
| `Kaizena-Webhook-Id` | The delivery's id |
| `Kaizena-Webhook-Timestamp` | When it was signed, in whole seconds since 1970 (UTC) |
| `Kaizena-Webhook-Topic` | The topic, as the body's `topic` |
| `Kaizena-Webhook-Signature` | `v1=` and the HMAC-SHA256, in lowercase hex, of `{timestamp}.{body}` with the endpoint's secret |

Every topic's body has the same envelope:

```json
{
  "id": "0b7f6c1e-5d2a-4c8e-9f3b-6a1d2e4c8b90",
  "topic": "stock.low",
  "version": 1,
  "store": { "slug": "nordlys", "name": "Nordlys Kaffe" },
  "created_at": "2026-11-04T09:30:00.000Z",
  "data": {
    "stock": {
      "variant_id": "5e2c9a7d-1b3f-4d6e-8a2c-9f1e3b5d7a40",
      "sku": "BEANS-1KG",
      "product_id": "c3a1e9f7-2d4b-4f6a-9c8e-1b3d5f7a9c20",
      "available": 3,
      "stock_at_crossing": 5,
      "crossed_at": "2026-11-04T09:29:58.000Z"
    }
  }
}
```

| Field | What it is |
|---|---|
| `id` | The delivery's id. It stays the same on every retry and when the delivery is [sent again](#resend): do the work once per `id`. |
| `topic` | The topic, or `test` for a [test delivery](#test) |
| `version` | The payload's version, now 1. A change to a payload's shape raises it. |
| `store` | The store's `slug` and `name` |
| `created_at` | When the event happened |
| `data` | What the event is about, under its own name: `order`, `customer`, `product`, `stock` and so on |

`data` is built when the delivery is first sent, so it shows the subject as it is then, which can be a little after the event. Every retry
sends the same body. When what the event was about no longer exists by then, nothing is sent, and the log says *What it was about no
longer exists*.

Amounts in a payload are decimal numbers in the currency's units, such as `199.5`, not minor units as in the Admin API. The exception is a
fixed-amount discount code's `amounts`, in minor units of each market's currency. Each field's description in the reference says which.

## What counts as received {#success}

Kaizena Flow takes any 2xx status, answered within 10 seconds, as received. Anything else is a failed try:

- any other status, a redirect included;
- no answer within 10 seconds, or no connection at all;
- an answer whose body is larger than 16,384 bytes;
- an address that no longer passes [the checks](#address).

So answer at once, with an empty body or a short one, and do the work after.

## Retries {#retries}

A failed try is tried again after 1 minute, then after 5 minutes, 30 minutes, 2 hours and 6 hours: six tries in all, over about eight and
a half hours. When the sixth fails, the delivery has failed. It stays in the endpoint's log, from where it can be [sent again](#resend).

Each try is signed when it is sent, with a new timestamp and the secret the endpoint has then. The body is the same on every try.

## When an endpoint keeps failing {#failing}

The first failed try marks the endpoint as failing: the admin shows *Failing since* and the time. Any delivery that is received clears
it.

When an endpoint has been failing for three days with nothing received, its next failed try switches it off:

- the admin shows *Switched off: failing*;
- everything still waiting for it is marked failed;
- each of the store's owners gets one email, naming the endpoint, its host name and the last answer, never a payload.

While an endpoint is off, nothing is queued for it: events that happen then are not sent later. An endpoint its owner switches off does not
send what it has waiting either. Switch it on again in the admin, or with `PATCH /webhooks/{id}` and `"enabled": true`, and its count of
failures starts afresh; saving a new address clears it too. [Test deliveries](#test) never count.

## Order and duplicates {#order}

Do not rely on the order deliveries arrive in. Each minute, Kaizena Flow sends what is due, oldest first, but a delivery waiting for its
retry goes later while newer ones go on. When order matters, compare the times in `data` where the subject has them, or read the
subject's state now through the Admin API.

The same event can arrive more than once. A try whose answer does not reach Kaizena Flow within 10 seconds is tried again, even if your
receiver did the work, and an owner can send any delivery that has ended again. Do the work once per body `id`.

Several changes can arrive as one delivery. While a delivery about a subject waits for its first try, another change of the same subject
for the same topic adds no delivery: the one that goes shows the subject as it is when it is sent. A `product.updated` while the
product's `product.created` still waits is part of that `product.created`. `inventory.updated` waits until the next whole minute, so a
variant's stock moves within a minute arrive as one delivery, with the stock as it is then.

## Test deliveries {#test}

*Send a test*, on the endpoint in the admin, sends a delivery at once and says how it went: *The test arrived (200).*, or why it did not.
It is signed as any other delivery. Its topic is `test`, in the header and the body, and its `data` is `{ "test": true, "order": { … } }`:
the store's latest paid order, or a sample with the same fields when the store has none.

A test is tried once, never again, and does not count towards switching an endpoint off. It is sent to an endpoint that is switched off
too, so you can check a mended receiver before you switch it on. The Admin API has no operation that sends a test.

> [!NOTE]
> A test can carry a real customer's order. Treat it as you treat every delivery.

## Sending a delivery again {#resend}

The endpoint's log in the admin, *Recently sent*, shows its latest 25 deliveries; each that has ended, received or failed, has *Send
again*. Through the Admin API, it is `POST /webhooks/{id}/deliveries/{delivery_id}/resend`.

Sending again queues a new delivery with the same body, so the body's `id` is the one you saw before. It goes within a minute, with
retries of its own. Its `Kaizena-Webhook-Id` header is the new delivery's own id: do the work once per body `id`, not per header. A
delivery that ended before it was ever sent has no body yet, so it is built afresh, with a new `id`.

Sending again is refused for a delivery still waiting (`409 conflict` through the API), for an endpoint that is switched off (switch it on
first; `409 conflict`) and for a delivery about a person who was [erased](#erased). Deliveries are kept for 30 days.

## Deliveries about an erased person {#erased}

When a store erases a person at their request, every delivery about them (their account, orders, subscriptions, draft orders and reviews)
loses its body and is marked erased, in the same transaction. One still waiting is not sent: it fails with *Not sent: the person it was
about was erased.* None of them can be sent again: the admin says why, and the Admin API answers `409 conflict`.

The `customer.erased` topic tells your endpoint that it happened. Its `data` is the erased account's id alone, so you can erase what you
keep about the person too:

```json
{ "erasure": { "customer_id": "9a4e2c1b-7d3f-4b6a-8e2c-5f1d3b7a9c60" } }
```

## Endpoints through the Admin API {#admin-api}

A token with the power `webhooks:write` manages the store's endpoints as the admin does, and its maker must be an owner of the store.
Every one of these operations needs it, reading included.

| Operation | Method and path | What it does |
|---|---|---|
| `webhooks.list` | `GET /webhooks` | The endpoints, each with its topics, whether it is on, why it was switched off, since when it fails, its last delivery and its failed deliveries in the last 7 days. Never an address or a secret. |
| `webhooks.create` | `POST /webhooks` | Adds an endpoint, on, from its `name` (1 to 80 characters), `url` and `topics` (at least one). Answers `201` with its `secret`, this once. |
| `webhooks.update` | `PATCH /webhooks/{id}` | Changes its `name`, `url` or `topics`, or switches it on or off with `enabled`. Send only what changes. |
| `webhooks.delete` | `DELETE /webhooks/{id}` | Removes it. What it still has waiting is not sent, and its log goes too. |
| `webhooks.deliveries` | `GET /webhooks/{id}/deliveries` | Its latest deliveries, newest first, each with its status, its tries, the last HTTP status and error. Up to 100 with `?limit=`; 25 when you do not say. |
| `webhooks.resend` | `POST /webhooks/{id}/deliveries/{delivery_id}/resend` | Sends a delivery that has ended again, as [above](#resend). Answers `{ "data": { "queued": true } }`. |

```bash
curl https://kaizenaflow.com/api/admin/v1/webhooks \
  -X POST \
  -H "Authorization: Bearer $KAIZENA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Warehouse", "url": "https://hooks.example.com/kaizena-flow", "topics": ["order.paid", "stock.low"]}'
```

The `secret` in the answer is there this once: a replay with the same `Idempotency-Key` answers it as `null`. A store that has ten
endpoints already is answered `409 conflict`, and an address that fails the checks `422 invalid`.
[Webhook endpoints](/docs/reference/admin-api/webhook-endpoints) in the reference has every field and error.
