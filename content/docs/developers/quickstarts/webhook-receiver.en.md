---
title: Build a webhook receiver
summary: From nothing to a small Node.js server that takes a store's events, checks their signature, answers at once and handles each event once.
track: developers
section: quickstarts
kind: tutorial
areas: [webhooks]
features: []
plans: []
admin: /admin/{store}/integrations/endpoints
order: 30
checked: 2026-11-04
sources: [D354, D438]
---

## What you build {#what-you-build}

A receiver for a store's events: one file of Node.js with nothing to install. It reads each delivery's raw body, checks its signature, answers `204` at once and then handles the event, once per event. At the end you send it a test from the admin and switch it on for real topics.

You need:

- an owner's sign-in to the store: only an owner adds endpoints;
- Node.js (the code here was run on Node.js 22);
- an HTTPS address on the internet for the receiver, on the standard port 443. Kaizena Flow sends only to `https://` on a host name with public addresses, never to `localhost` or a private network. While you build, a tunnel that gives your computer a public HTTPS address will do.

## 1. Add the endpoint {#add}

1. In the admin, open [Your own endpoints](/admin/{store}/integrations/endpoints): *Integrations*, then *Manage endpoints*.
2. Under *Add an endpoint*, give it a *Name* you will know, such as *Warehouse*.
3. As its *Address*, write where the receiver will answer, with the path `/webhooks/kaizena-flow`: for example `https://hooks.example.com/webhooks/kaizena-flow`.
4. Under *Events to send*, *Order paid*, *Order sent*, *Order refunded* and *New customer account* are chosen already. Keep *Order paid*, and change the rest as you need.
5. Press *Add an endpoint*.

Kaizena Flow shows the endpoint's signing secret, `whsec_` and 43 characters. **Copy it now: it is shown only this once.** If you lose it, *New secret* makes another, and the old one stops working at once.

Keep the secret on the server, in an environment variable, never in your code:

```bash
export KAIZENA_WEBHOOK_SECRET='whsec_…'
```

## 2. Write the receiver {#receiver}

Save this as `receiver.mjs`:

```js
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const SECRET = process.env.KAIZENA_WEBHOOK_SECRET ?? "";
const PORT = Number(process.env.PORT ?? 3000);
const PATH = "/webhooks/kaizena-flow";

if (!SECRET) throw new Error("Set KAIZENA_WEBHOOK_SECRET to the endpoint's signing secret.");

// The signature check: HMAC-SHA256 of "{timestamp}.{raw body}" with the secret, compared in constant time,
// and a timestamp at most five minutes from this server's clock.
function verify(body, timestamp, signatures) {
  if (typeof timestamp !== "string" || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const digest = createHmac("sha256", SECRET).update(`${timestamp}.`).update(body).digest("hex");
  const expected = Buffer.from(`v1=${digest}`);
  return String(signatures ?? "")
    .split(/[ ,]+/)
    .some((part) => {
      const given = Buffer.from(part);
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
}

// The events already handled, by the body's id. Keep them in your database in production.
const handled = new Set();

async function handle(event) {
  switch (event.topic) {
    case "test":
      console.log(`Test from ${event.store.name}: order ${event.data.order.number}`);
      break;
    case "order.paid": {
      const { order } = event.data;
      console.log(`Order ${order.number} paid: ${order.total} ${order.currency}`);
      break;
    }
    default:
      console.log(`${event.topic} received, not handled yet`);
  }
}

createServer((req, res) => {
  if (req.method !== "POST" || req.url !== PATH) {
    res.writeHead(404).end();
    return;
  }
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    if (!verify(body, req.headers["kaizena-webhook-timestamp"], req.headers["kaizena-webhook-signature"])) {
      res.writeHead(401).end();
      return;
    }
    const event = JSON.parse(body.toString("utf8"));
    // Answer first: Kaizena Flow waits 10 seconds at most, and counts anything but 2xx as a failed try.
    res.writeHead(204).end();
    if (handled.has(event.id)) return;
    handled.add(event.id);
    handle(event).catch((error) => console.error(`Handling ${event.id} failed:`, error));
  });
}).listen(PORT, () => console.log(`Listening on http://localhost:${PORT}${PATH}`));
```

What it does, in order:

- **It reads the raw body** into a `Buffer` and checks the signature over those bytes, before it parses anything.
- **It refuses** a delivery whose signature does not match, or whose timestamp is more than five minutes from its clock, with `401`.
- **It answers `204` at once**, then handles the event. A slow answer would count as a failed try, and the delivery would come again.
- **It handles each event once**, by the body's `id`, which stays the same when a delivery is tried again or sent again by hand.

> [!IMPORTANT]
> Once you have answered, Kaizena Flow does not send that delivery again by itself. If losing an event would matter, store it (in a table or a queue) before you answer, and handle it from there.

Run it:

```bash
node receiver.mjs
```

## 3. Try it on your computer {#try-locally}

Before Kaizena Flow sends anything, sign a delivery yourself, as Kaizena Flow does, and send it to the receiver. Save this as `send-test.mjs`, beside it:

```js
import { createHmac, randomUUID } from "node:crypto";

const secret = process.env.KAIZENA_WEBHOOK_SECRET ?? "";
const url = process.argv[2] ?? "http://localhost:3000/webhooks/kaizena-flow";

// A shortened test delivery: a real one's order has every field of an order.
const id = randomUUID();
const body = JSON.stringify({
  id,
  topic: "test",
  version: 1,
  store: { slug: "my-store", name: "My store" },
  created_at: new Date().toISOString(),
  data: { test: true, order: { number: "1001", total: 497, currency: "EUR" } },
});
const timestamp = Math.floor(Date.now() / 1000);
const signature = `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;

const response = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Kaizena-Webhook-Id": id,
    "Kaizena-Webhook-Timestamp": String(timestamp),
    "Kaizena-Webhook-Topic": "test",
    "Kaizena-Webhook-Signature": signature,
  },
  body,
});
console.log(`The receiver answered ${response.status}`);
```

In a second terminal, with the same secret in `KAIZENA_WEBHOOK_SECRET`:

```bash
node send-test.mjs
```

It prints `The receiver answered 204`, and the receiver prints `Test from My store: order 1001`. Run it with another secret and the receiver answers `401`.

## 4. Send a test from the admin {#test}

Put the receiver where the endpoint's address leads (through your tunnel while you build), with the endpoint's own secret. Then, on the endpoint in [Your own endpoints](/admin/{store}/integrations/endpoints), press *Send a test*.

Kaizena Flow sends it at once, signed as any other delivery, with the topic `test` and, as its `data.order`, the store's latest paid order (or a sample, when the store has none). The admin says *The test arrived (204).*, and your receiver prints the order's number. If it says *The test did not arrive*, the reason follows: the status your receiver answered, no answer within 10 seconds, or an address that could not be reached.

A test is tried once only, and does not count against the endpoint.

## 5. Go live {#go-live}

1. **Run the receiver on your own server**, at an HTTPS address on a host name, and keep the secret in its environment.
2. **Point the endpoint at it.** On the endpoint, *Change*, then *New address*; leave it empty to keep the address it has. The secret stays the same.
3. **Choose the topics** your system needs, and add a case to `handle()` for each. [The topics](/docs/reference/webhooks#topics) in the reference has each one's payload.
4. **Keep what you have handled** in your database, by the body's `id`, instead of the `Set` in memory.
5. **Watch the log.** *Recently sent* shows the endpoint's latest deliveries and how each went. One that failed can be sent again with *Send again*, keeping its `id`.

A delivery your receiver does not take is tried again for about eight and a half hours. An endpoint where everything fails for three days is switched off, and the store's owners are emailed. [Receiving events](/docs/developers/webhooks/receiving-events) explains retries, duplicates and order in full, and [Verify a delivery's signature](/docs/developers/webhooks/verify-signatures) has the check in Python and PHP too.
