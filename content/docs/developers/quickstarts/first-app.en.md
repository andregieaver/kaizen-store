---
title: A first app
summary: Make an app, install it on your own store with a short Node script, swap the code for tokens and read the store's products.
track: developers
section: quickstarts
kind: tutorial
areas: [apps, authentication, admin-api]
features: []
plans: []
admin: /admin/account/developer
order: 50
checked: 2026-11-04
sources: [D439, D441]
operations: [products.list]
---

This takes about ten minutes and needs Node 22. [Build an app](/docs/developers/apps/build-an-app) explains each step in full.

## Make the app

1. Open [Account, Developer](/admin/account/developer), accept the developer terms and press **New app**.
2. Name it and give a redirect URI you can serve over `https://` (an app's redirect URIs are `https://` only), such as a tunnel to your
   machine: `https://your-tunnel.example/callback`.
3. Tick **See products** under what it needs, choose **Private** and press **Make the app**.
4. Copy the client ID (`kfapp_…`) and the client secret (`kfas_…`): the secret is shown once.

## Install it

Save this as `first-app.mjs`, set `CLIENT_ID`, `CLIENT_SECRET` and `REDIRECT_URI` in your shell, and run `node first-app.mjs`. It prints an address to open; your tunnel
must send `/callback` to port 3000.

```js
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const CLIENT_ID = process.env.CLIENT_ID; // kfapp_…
const CLIENT_SECRET = process.env.CLIENT_SECRET; // kfas_…
const REDIRECT_URI = process.env.REDIRECT_URI; // https://your-tunnel.example/callback
const SITE = "https://kaizenaflow.com";

const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(16).toString("base64url");

const authorize = new URL(`${SITE}/oauth/authorize`);
authorize.search = new URLSearchParams({
  response_type: "code",
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  code_challenge: challenge,
  code_challenge_method: "S256",
  state,
  resource: `${SITE}/api/admin/v1`,
}).toString();
console.log(`Open ${authorize}`);

createServer(async (request, response) => {
  const url = new URL(request.url, REDIRECT_URI);
  if (url.searchParams.get("state") !== state) return response.writeHead(400).end("Wrong state");
  // Swap the code for tokens, with the app's own client ID and secret.
  const token = await fetch(`${SITE}/api/oauth/token`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}` },
    body: new URLSearchParams({ grant_type: "authorization_code", code: url.searchParams.get("code"), code_verifier: verifier, redirect_uri: REDIRECT_URI }),
  }).then((r) => r.json());
  // Read the store's products with the access token.
  const products = await fetch(`${SITE}/api/admin/v1/products?limit=5`, { headers: { authorization: `Bearer ${token.access_token}` } }).then((r) => r.json());
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(products, null, 2));
}).listen(3000);
```

Open the printed address, sign in, choose your store and press **Install**. The browser lands on your callback and shows five of the
store's products.

## What to try next

- Ask for `products:write` on the app's page: the store sees **Asks for more** until it gives it. Then make a draft product with
  `POST /api/admin/v1/products`.
- Give the app an events address and the topic `product.updated`, then change a product: your address receives it, signed with the
  events secret. [Verify signatures](/docs/developers/webhooks/verify-signatures) shows how to check it.
- Remove the app under **Settings**, **Apps and API**: your token answers `401`, and your events address receives `app.uninstalled`.
