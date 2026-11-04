---
title: Verify a delivery's signature
summary: Check that a delivery came from Kaizena Flow and is fresh, in Node.js, Python or PHP, before your receiver trusts it.
track: developers
section: webhooks
kind: how-to
areas: [webhooks, authentication]
features: []
plans: []
admin: /admin/{store}/integrations/endpoints
order: 20
checked: 2026-11-04
sources: [D354, D438]
---

## What is signed {#what-is-signed}

Every delivery to your endpoint carries two headers for the check:

| Header | What it holds |
|---|---|
| `Kaizena-Webhook-Timestamp` | When the delivery was signed, in whole seconds since 1970 (UTC) |
| `Kaizena-Webhook-Signature` | `v1=` and the HMAC-SHA256, in lowercase hex, of the timestamp, a full stop and the raw body (`{timestamp}.{body}`) |

The key is the endpoint's signing secret, used as it is: the whole text, `whsec_` included. Do not decode it. The secret is shown once, when the endpoint is added under [Your own endpoints](/admin/{store}/integrations/endpoints), or when you make a new one there.

## The check {#steps}

1. Read the body as it arrived, before any JSON parsing. The signature is over those exact bytes: a body parsed and written out again is not the same.
2. Refuse the delivery when the timestamp is more than five minutes (300 seconds) from your own clock, before it or after it. A captured delivery then cannot be played again later.
3. Compute the HMAC-SHA256 of `{timestamp}.{body}` with the secret, as lowercase hex, and put `v1=` before it.
4. Compare it, in constant time, with each signature in `Kaizena-Webhook-Signature`. The published catalogue allows several, separated by commas: one match is enough.
5. When it matches, answer with a 2xx status within 10 seconds, then do the work. Do it once per body `id`: a delivery that is tried again, or sent again by hand, keeps it.

When the check fails, answer `401` and do nothing else. Kaizena Flow counts any answer that is not 2xx as a failed try and [tries again later](/docs/developers/webhooks/receiving-events#retries).

Each example below keeps its secret out of the code, in the environment variable `KAIZENA_WEBHOOK_SECRET`, and refuses every delivery when that is empty.

## Node.js {#node}

With nothing to install:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SECONDS = 300;

// Whether a delivery came from Kaizena Flow and is fresh. `body` is the raw body (a Buffer), `timestamp` and
// `signatures` the Kaizena-Webhook-Timestamp and Kaizena-Webhook-Signature headers, `secret` the endpoint's.
export function verifyKaizenaWebhook(body, timestamp, signatures, secret) {
  if (!secret || typeof timestamp !== "string" || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  const digest = createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
  const expected = Buffer.from(`v1=${digest}`);
  return String(signatures ?? "")
    .split(/[ ,]+/)
    .some((part) => {
      const given = Buffer.from(part);
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
}
```

In a server built on `node:http`, in the same file. Node gives header names in lower case:

```js
import { createServer } from "node:http";

const secret = process.env.KAIZENA_WEBHOOK_SECRET ?? "";

createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const ok = verifyKaizenaWebhook(body, req.headers["kaizena-webhook-timestamp"], req.headers["kaizena-webhook-signature"], secret);
    if (!ok) {
      res.writeHead(401).end();
      return;
    }
    const delivery = JSON.parse(body.toString("utf8"));
    res.writeHead(204).end();
    // Do the work for delivery.topic here, once per delivery.id.
  });
}).listen(Number(process.env.PORT ?? 3000));
```

If your framework parses JSON bodies for you, switch that off for this route and read the raw body instead.

## Python {#python}

For Python 3.10 and later, with the standard library alone:

```python
import hashlib
import hmac
import re
import time

TOLERANCE_SECONDS = 300


def verify_kaizena_webhook(body: bytes, timestamp: str | None, signatures: str | None, secret: str) -> bool:
    """Whether a delivery came from Kaizena Flow and is fresh.

    body is the raw body (bytes); timestamp and signatures are the Kaizena-Webhook-Timestamp and
    Kaizena-Webhook-Signature headers; secret is the endpoint's.
    """
    if not secret or not timestamp or not re.fullmatch(r"[0-9]+", timestamp):
        return False
    if abs(time.time() - int(timestamp)) > TOLERANCE_SECONDS:
        return False
    digest = hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()
    expected = f"v1={digest}".encode()
    return any(hmac.compare_digest(part.encode(), expected) for part in re.split(r"[ ,]+", signatures or "") if part)
```

In a server built on `http.server`, in the same file:

```python
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

SECRET = os.environ.get("KAIZENA_WEBHOOK_SECRET", "")


class Receiver(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        ok = verify_kaizena_webhook(
            body,
            self.headers.get("Kaizena-Webhook-Timestamp"),
            self.headers.get("Kaizena-Webhook-Signature"),
            SECRET,
        )
        self.send_response(204 if ok else 401)
        self.end_headers()
        if ok:
            delivery = json.loads(body)
            # Do the work for delivery["topic"] here, once per delivery["id"].


HTTPServer(("", int(os.environ.get("PORT", "3000"))), Receiver).serve_forever()
```

Compare the bytes, as here: `hmac.compare_digest()` refuses text with characters outside ASCII with an error, and a header can hold them.

## PHP {#php}

For PHP 8:

```php
<?php

// Whether a delivery came from Kaizena Flow and is fresh. $body is the raw body, $timestamp and $signatures the
// Kaizena-Webhook-Timestamp and Kaizena-Webhook-Signature headers, $secret the endpoint's.
function verify_kaizena_webhook(string $body, ?string $timestamp, ?string $signatures, string $secret): bool
{
    if ($secret === '' || $timestamp === null || !preg_match('/\A[0-9]+\z/', $timestamp)) {
        return false;
    }
    if (abs(time() - (int) $timestamp) > 300) {
        return false;
    }
    $expected = 'v1=' . hash_hmac('sha256', $timestamp . '.' . $body, $secret);
    foreach (preg_split('/[ ,]+/', $signatures ?? '', -1, PREG_SPLIT_NO_EMPTY) as $part) {
        if (hash_equals($expected, $part)) {
            return true;
        }
    }
    return false;
}
```

Below it, in the script your endpoint's address runs. PHP gives a header `Kaizena-Webhook-Timestamp` as `$_SERVER['HTTP_KAIZENA_WEBHOOK_TIMESTAMP']`:

```php
$body = file_get_contents('php://input');
$ok = verify_kaizena_webhook(
    $body,
    $_SERVER['HTTP_KAIZENA_WEBHOOK_TIMESTAMP'] ?? null,
    $_SERVER['HTTP_KAIZENA_WEBHOOK_SIGNATURE'] ?? null,
    (string) getenv('KAIZENA_WEBHOOK_SECRET'),
);
if (!$ok) {
    http_response_code(401);
    exit;
}
$delivery = json_decode($body, true);
http_response_code(204);
// Do the work for $delivery['topic'] here, once per $delivery['id'].
```

`(string) getenv(…)` is an empty secret when the variable is not set, and the check refuses an empty secret: without that, anyone could sign a delivery with an empty key.

## Try your check {#try}

This delivery was signed by Kaizena Flow's own signer with the secret `whsec_ZXhhbXBsZS1zZWNyZXQtZm9yLXRoZS1kb2NzLW9ubHk`, at `1793784605` (2026-11-04T09:30:05Z). The body is one line, as it arrives; its store's name has a letter outside ASCII, so it also shows that you sign the body's UTF-8 bytes:

```http
Kaizena-Webhook-Timestamp: 1793784605
Kaizena-Webhook-Signature: v1=8b57dee7364c05c52a7e5872bd07399abf528cc34fab8f53dcafa63816f2d862

{"id":"7d0c5b9e-3f6a-4a52-9a1e-2b8f4c6d1e90","topic":"support.waiting","version":1,"store":{"slug":"bolge","name":"Bølge Kaffe"},"created_at":"2026-11-04T09:30:00.000Z","data":{"support":{"waiting":2,"admin_url":"https://kaizenaflow.com/admin/bolge/support"}}}
```

Your HMAC of `1793784605.` and that body must give the same hex. Your whole check takes the delivery only with your clock near that time, so leave the time check out while you try it, then put it back. Change any character of the body and it must refuse it.

## When deliveries keep failing the check {#troubleshooting}

The endpoint's log, *Recently sent*, shows each delivery your receiver refused with the status it answered. The usual causes:

- **The body was parsed first.** Sign the raw bytes, not a body your framework parsed and wrote out again.
- **The secret is not the endpoint's now.** *New secret* stops the old one at once, and each endpoint has its own. Copy the whole secret, `whsec_` included, without spaces or a line break.
- **Your clock is off.** A server more than five minutes from the right time refuses every delivery. Keep it set by a time service.

An endpoint whose deliveries all fail for three days is switched off, and the store's owners are emailed. [When an endpoint keeps failing](/docs/developers/webhooks/receiving-events#failing) says what then.
