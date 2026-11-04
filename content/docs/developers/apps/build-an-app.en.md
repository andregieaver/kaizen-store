---
title: Build an app
summary: Turn on developer mode, make an app, let a store install it, swap the code for tokens and call the Admin API and the MCP server as the person who installed it.
track: developers
section: apps
kind: how-to
areas: [apps, authentication, admin-api, mcp]
features: []
plans: []
admin: /admin/account/developer
order: 10
checked: 2026-11-04
sources: [D441, D439, D440, D355]
---

An app is software of yours that many stores install. Each store's install gives it tokens of its own, which work on the
[Admin API](/docs/reference/admin-api) and the [owner MCP server](/docs/developers/mcp/owner-mcp) in that one store. A call does only what
both the app's scopes and the role of the person who installed it allow at the time of the call.

> [!NOTE]
> Apps are new. Private and unlisted apps work today, with their events. Listing an app in a directory waits for Kaizena Flow's review
> and the developer terms' legal review.

## Turn on developer mode

Open [Account, Developer](/admin/account/developer), tick that you accept the
[developer terms](/docs/developers/apps/developer-terms) and press **Turn on developer mode**. An account makes up to 25 apps.

## Make the app

Press **New app** and give:

- **Name** and **What it does**: shown to the person installing it.
- **Redirect URIs**: one per line, `https://` only. Kaizena Flow sends the person back to one of them with the code, and matches it
  exactly.
- **What it needs**: the scopes, one per area, `products:read` or `products:write` and so on. A `write` scope includes its `read`.
- **What it may do without asking each time**: the powers, such as `products:publish` or `orders:refund`, under their own fold. The
  install screen names each one.
- **Who can install it**: *Private* (only stores you work in), *Unlisted* (any store you send to it) or *Listed* (asks for Kaizena
  Flow's review).
- **Events**, under their own fold: the `https://` address they are sent to, and the topics you want.

Press **Make the app**. The page shows the **client ID** (`kfapp_…`), the **client secret** (`kfas_…`) and the **events secret**
(`kfws_…`) once. Copy them now: Kaizena Flow keeps only a hash of the client secret. **Renew** on the app's page makes a new one and the
old one stops working at once.

## Let a store install it

Your app sends the person to Kaizena Flow's authorization endpoint, as any OAuth 2.1 client does, with PKCE:

```text
https://kaizenaflow.com/oauth/authorize
  ?response_type=code
  &client_id=kfapp_…
  &redirect_uri=https://app.example/oauth/callback
  &code_challenge=…            (S256 of a random verifier you keep)
  &code_challenge_method=S256
  &state=…                     (a random value you check on return)
  &resource=https://kaizenaflow.com/api/admin/v1
```

`resource` must be the Admin API's address: an app asks for nothing else. The person signs in, sees your app, its host and what it asks
for, chooses **one store** and presses **Install**. A store is offered only where their role holds every permission your app asks for; a
private app is offered only on your own stores. They come back to your redirect URI with `code`, your `state` and `iss`.

## Swap the code for tokens

Your server swaps the code at the token endpoint within a minute, authenticated with your client ID and secret by HTTP Basic:

```bash
curl -X POST 'https://kaizenaflow.com/api/oauth/token' \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d grant_type=authorization_code \
  -d code="$CODE" \
  -d code_verifier="$VERIFIER" \
  -d redirect_uri='https://app.example/oauth/callback'
```

The answer holds an `access_token` (`kfa_…`, one hour) and a `refresh_token` (`kfr_…`). Each refresh gives a new refresh token: use
the new one. Using an old one ends every token of that install, as a stolen one would be ended.

## Call the store

Send the access token as a bearer token:

```bash
curl 'https://kaizenaflow.com/api/admin/v1/products?limit=10' -H "Authorization: Bearer $ACCESS_TOKEN"
```

Each call is checked when it is made:

- the install holds the operation's permission, and its power when the operation needs one;
- the person who installed the app may still do it in the store, with the role they have now;
- each install has its own budget of 120 calls a minute, and its own `Idempotency-Key`s.

A call outside the install's scopes answers `403` and names what is missing. If the person leaves the store, or the store's owner
removes the app, the tokens stop working at once and the call answers `401`. The same token works on `https://kaizenaflow.com/api/mcp`,
where a change that asks the owner's yes still waits for it.

## Receive events

Each install sends your events address the topics you chose that its scopes read: `order.paid` needs `orders:read`, `product.updated`
`products:read`, and so on (each topic's `receivers` in the [catalogue](/api/webhooks/v1/topics.json) says `apps` when an app may be sent
it). `customer.erased` is always sent: forget that customer. Every delivery is signed with your events secret, the same way as an owner's
own endpoint; [Verify signatures](/docs/developers/webhooks/verify-signatures) shows how to check it. Changing the address, the topics or the
events secret on your app's page changes every install at once. The store's owner never sees or changes this address.

Two topics are yours alone, sent whatever you chose:

- `app.uninstalled`, at once when the app is removed from a store: by the owner, because the person who installed it left the store,
  or because the app was blocked. Its tokens no longer work.
- `store.erase_requested`, 48 hours later: erase what you keep of that store, its customers and its orders. It is not sent if the store
  installs the app again before then.

Both carry `data.installation`: its `id`, your app's `client_id` and `removed_at`. Nothing else is sent to a removed app.

## Installed, changed and removed

- Installing again on the same store replaces the install: the old tokens stop working, and its events go on to the new one.
- The store's owner sees the app under **Settings**, **Apps and API**, **Installed apps**, and **Remove** ends it.
- When you add scopes to your app, each install keeps what it was given until the store agrees: the store sees **Asks for more** and
  gives it with one press, as long as the person who installed it may give it. Its tokens reach the new scopes at once.
- Your app's page shows how many stores it is installed on, never which.
