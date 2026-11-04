---
title: The owner MCP server
summary: How an AI assistant works in a person's stores through /api/mcp, and how it connects: discovery, client registration, PKCE, the consent screen, scopes, changes that wait for a yes, tokens and how a connection ends.
track: developers
section: mcp
kind: concept
areas: [mcp, authentication, ai]
features: []
plans: []
admin: /admin/{store}/settings/api
order: 10
checked: 2026-11-04
sources: [D439, D438, D96, D350]
tools: [list_stores, ask_store_assistant]
---

## What it is for

The owner MCP server lets an AI assistant work in Kaizena Flow for a person who runs stores: an owner, or someone on a store's team. It
serves the AI manager's own tools: orders, products, customers, marketing, analytics, the website, settings and the rest. Any MCP client
can connect. The person signs in on Kaizena Flow's own page and chooses which stores it reaches and what it may do there.

- **Address:** `https://kaizenaflow.com/api/mcp`
- **Transport:** Streamable HTTP with JSON-RPC 2.0, protocol version `2025-06-18`. Answers are plain JSON. The server sends no event
  stream and keeps no session: `POST` only, and `GET` answers `405`.
- **Sign-in:** OAuth 2.1 with Kaizena Flow's own authorization server.
- **Tools:** every tool, with its inputs, scope and gate, is in the [MCP reference](/docs/reference/mcp), made from the catalogue at
  [/api/mcp/catalogue.json](/api/mcp/catalogue.json).

Every tool but `list_stores` takes the store it is for, by the slug `list_stores` gives. A person with several stores connects them all
at once.

What a connection may do is checked at every call. It is the smaller of two things: what the person allowed on the consent screen, and
what their role in the store allows now. A person removed from a store, or whose role loses a permission, loses it in every connection at
once.

## Finding the authorization server {#discovery}

A call without a token answers `401` and says where to look. Among its headers:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
WWW-Authenticate: Bearer resource_metadata="https://kaizenaflow.com/.well-known/oauth-protected-resource/api/mcp"

{"error":"A Kaizena Flow access token is needed: the resource metadata says where to get one."}
```

When a token was sent but is not valid (for example expired, revoked, or of a client that was blocked), the challenge also says
`error="invalid_token"`.

The protected resource metadata (RFC 9728) is at `/.well-known/oauth-protected-resource/api/mcp`. The same document is at
`/.well-known/oauth-protected-resource`:

```json
{
  "resource": "https://kaizenaflow.com/api/mcp",
  "authorization_servers": ["https://kaizenaflow.com"],
  "scopes_supported": [
    "stores:read", "orders:read", "products:read", "customers:read", "marketing:read", "analytics:read",
    "website:read", "bookings:read", "support:read", "settings:read", "billing:read", "staff:read"
  ],
  "bearer_methods_supported": ["header"],
  "resource_name": "Kaizena Flow",
  "resource_documentation": "https://kaizenaflow.com/docs/developers/mcp"
}
```

`authorization_servers` names Kaizena Flow's first. A second entry may follow: the sign-in [Kaizen Life](#kaizen-life) uses. Its
tokens are taken for Kaizen Life only, so use the first.

The authorization server's metadata (RFC 8414) is at `/.well-known/oauth-authorization-server`. Its issuer is `https://kaizenaflow.com`:

```json
{
  "issuer": "https://kaizenaflow.com",
  "authorization_endpoint": "https://kaizenaflow.com/oauth/authorize",
  "token_endpoint": "https://kaizenaflow.com/api/oauth/token",
  "revocation_endpoint": "https://kaizenaflow.com/api/oauth/revoke",
  "registration_endpoint": "https://kaizenaflow.com/api/oauth/register",
  "client_id_metadata_document_supported": true,
  "code_challenge_methods_supported": ["S256"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "response_types_supported": ["code"],
  "response_modes_supported": ["query"],
  "token_endpoint_auth_methods_supported": ["none", "client_secret_basic"],
  "revocation_endpoint_auth_methods_supported": ["none", "client_secret_basic"],
  "scopes_supported": [
    "stores:read", "orders:read", "orders:write", "products:read", "products:write", "customers:read", "customers:write",
    "marketing:read", "marketing:write", "analytics:read", "analytics:write", "website:read", "website:write",
    "bookings:read", "bookings:write", "support:read", "support:write", "settings:read", "settings:write",
    "billing:read", "billing:write", "staff:read", "staff:write", "owner"
  ],
  "authorization_response_iss_parameter_supported": true,
  "service_documentation": "https://kaizenaflow.com/docs/developers/mcp"
}
```

Both documents are public, may be read from any origin and may be cached for an hour.

## Registering your client {#clients}

Your client is known to Kaizena Flow in one of two ways: a metadata document at your own address, or registration. Either way it is a
public client: it holds no secret, and PKCE protects its codes. `client_secret_basic` is only for clients Kaizena Flow makes itself.

### A metadata document at your own address

Use an HTTPS address of yours as your `client_id` (Client ID Metadata Documents). Kaizena Flow fetches the document the first time a
person is sent to the consent screen, and again when the copy it kept is out of date.

- **The address:** `https://`, a public host name, a path, and no port, user name or fragment. Write it exactly as a URL parser writes
  it back, or it is not read as an address.
- **The fetch:** within 5 seconds, at most 64 KB, answered as JSON (`application/json` or a `+json` type). A redirect is not followed.
- **What it must hold:** `client_id`, equal to the address it was fetched from; a `client_name`; and 1 to 20 `redirect_uris`, each
  HTTPS or plain `http` to a loopback address (`127.0.0.1`, `[::1]` or `localhost`).
- **What it may hold:** `logo_uri` and `client_uri`, both HTTPS. It may not hold `client_secret`. A `token_endpoint_auth_method`, if
  given, is `none`; `grant_types`, if given, include `authorization_code`.
- **How long it is kept:** what its `Cache-Control: max-age` says, between a minute and a day. With `no-store` or `no-cache`, a minute.

```json
{
  "client_id": "https://assistant.example.com/oauth/client.json",
  "client_name": "Example Assistant",
  "redirect_uris": ["https://assistant.example.com/oauth/callback"],
  "logo_uri": "https://assistant.example.com/logo.png"
}
```

### Dynamic registration

A client that publishes no document registers itself (RFC 7591) with a JSON body of at most 16 KB:

```bash
curl -X POST https://kaizenaflow.com/api/oauth/register \
  -H "Content-Type: application/json" \
  -d '{"client_name":"Example Assistant","application_type":"native","redirect_uris":["http://127.0.0.1:33418/callback"]}'
```

- `redirect_uris` is required: 1 to 20. A `web` client's are HTTPS and not on a loopback host. A `native` client's may also be plain
  `http` to a loopback address. Without `application_type`, both kinds are taken.
- Only public clients register: `token_endpoint_auth_method` is `none` when given, `grant_types` include `authorization_code`, and
  `response_types` is `code`. No secret is ever issued.
- One address may register 10 clients an hour. After that it is answered `429` with `slow_down` and `Retry-After: 3600`.
- A registered client that has not been used 30 days after it registered is removed.

The answer is `201` with a generated `client_id` and what was kept:

```json
{
  "client_id": "3f6c2b9e-5d1a-4f0e-9a7b-2c8d4e6f1a3b",
  "client_id_issued_at": 1793750400,
  "client_name": "Example Assistant",
  "redirect_uris": ["http://127.0.0.1:33418/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none",
  "application_type": "native"
}
```

A refusal is OAuth's own shape, with `invalid_redirect_uri` or `invalid_client_metadata` and an `error_description` that says what is
wrong.

### Names and redirect URIs

- A client's name is shown as Kaizena Flow cleans it: letters, digits, spaces and a little punctuation, at most 60 characters. A
  registration without a name is shown as *An unnamed app*.
- A name that could pass for Kaizena Flow, or that says *Verified* or *Official*, is refused, in a registration and in a metadata
  document.
- The `redirect_uri` of an authorization request must be one the client registered, exactly. Only a loopback address's port may differ
  (RFC 8252), as a native client picks a free port each time. Custom schemes (`myapp://`) are not taken, nor a fragment.

### Verified and blocked clients

Kaizena Flow's platform admins see every client that has asked, with how many people use it. Once they have checked a client they mark it
verified, and the consent screen then says *Verified by Kaizena Flow* instead of *Not verified by Kaizena Flow*. A metadata document that
later names another app, or other redirect URIs, loses the mark. A client they block can ask nobody again: its tokens stop working and
every connection it has ends.

## Asking a person {#authorization}

Send the person's browser to `https://kaizenaflow.com/oauth/authorize` with these query parameters, each once:

| Parameter | Value |
|---|---|
| `response_type` | `code` |
| `client_id` | Your metadata document's address, or the id registration gave you |
| `redirect_uri` | One of your registered redirect URIs |
| `code_challenge` | The S256 hash of your code verifier, base64url: 43 characters |
| `code_challenge_method` | `S256`. No other method is taken, and PKCE cannot be left out |
| `state` | Required, at most 1,000 characters. It comes back with the answer |
| `resource` | `https://kaizenaflow.com/api/mcp` (RFC 8707). Required |
| `scope` | Optional, space-separated. Unknown scopes are ignored. The person's choice decides what is given |

The address sends the request on, unchanged, to the consent page in Kaizena Flow's admin. A person who is not signed in signs in first
and comes back to it. The page is never shown in a frame: open it in a browser window or tab.

When the request is wrong:

- **A client or redirect URI Kaizena Flow does not know.** The page says so and sends nothing anywhere.
- **Anything else** (no PKCE, no `state`, another `resource`). For a client Kaizena Flow vouches for (one it verified or made itself),
  the error goes back to the redirect URI as `error` and `error_description`, with `state` and `iss`. For any other client, the page says
  what is wrong and gives a plain link to the redirect URI's origin. This keeps the endpoint from sending people to any address.

The person's decision always goes back to your redirect URI:

- **Allow:** `code`, `state` and `iss=https://kaizenaflow.com`.
- **Cancel:** `error=access_denied`, `error_description=The person declined.`, `state` and `iss`.

Check that `state` is yours and that `iss` is `https://kaizenaflow.com` (RFC 9207) before you use the code.

## The consent screen {#consent}

The person sees, in Kaizena Flow's own admin:

- The heading *{name} wants to work with your stores*, the client's logo, *From* and a host, and *Verified by Kaizena Flow* or
  *Not verified by Kaizena Flow*. The host is the metadata document's, or else the redirect URI's; never a `client_uri`, which anyone may
  write. When the code goes back to another host than the one shown, the page adds *It sends you back to* that host.
- **Stores to connect.** Every store where the person's role holds any permission, ticked. A store that requires two-step sign-in is
  offered only once the person has signed in with their second step. A store whose owner cut this client off for this person is shown
  but cannot be ticked.
- **What it may do.** One choice of three levels.
- **Choose permissions**, folded away: each permission, ticked as the level gives it, to untick.
- **Allow** and **Cancel**, and where to disconnect it later.

The levels:

| Level | What the connection holds | What happens to a change |
|---|---|---|
| *Read only* | `stores:read` and the reading permissions the person holds | No change can be made |
| *Read and propose changes* (the default) | Every permission the person holds | Every change waits for the person's yes in the admin |
| *Read and change* | Every permission the person holds | Changes are made at once, as the person could make them. A change behind a gate still waits for the yes |

The screen says each level in one sentence:

- *Read only*: "It can look at your stores: orders, products, customers and the rest your role lets you see. It changes nothing."
- *Read and propose changes*: "It can look at your stores and propose changes. Nothing changes until you say yes in Kaizena Flow."
- *Read and change*: "It can look at your stores and make the changes you may make yourself. Anything that sends, publishes or costs
  money still waits for your yes."

The `scope` your client asks for does not decide what is given: the level, the ticked permissions and the person's role do. A connection
never holds more than the person holds in the stores they ticked, and it always holds `stores:read`. The token answer's `scope` says what
was given.

A person has one connection for each client. Saying yes again replaces it, with the new stores, level and permissions.

## Scopes {#scopes}

There is one scope for each staff permission, plus `stores:read`:

- `stores:read`: list the stores the connection reaches. Every connection holds it.
- `{area}:read` and `{area}:write` for `orders`, `products`, `customers`, `marketing`, `analytics`, `website`, `bookings`,
  `support`, `settings`, `billing` and `staff`. A `:write` scope also reads its area.
- `owner`: what only a store's owner may do, such as the plan, payments, domains, the team, and asking the store's AI manager, which reads
  every area of the store.

Each tool needs one scope: its `scope` in the catalogue. The reference's [Scopes](/docs/reference/scopes#mcp) page lists the tools that
need each one.

`tools/list` lists only the tools the connection can call now: its scope is in the grant, the person's role allows it in at least one of
the connection's stores, and the store feature it stands behind is on there.

A `tools/call` whose scope the grant does not hold answers `403`, and nothing in the request runs. One challenge names every scope the
request needs, all the calls of a batch together:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json
WWW-Authenticate: Bearer error="insufficient_scope", scope="orders:write", resource_metadata="https://kaizenaflow.com/.well-known/oauth-protected-resource/api/mcp", error_description="The token's grant does not include what this call needs."

{"error":"insufficient_scope","scopes":["orders:write"]}
```

To get a scope, send the person through the authorization again. Their new yes replaces the connection.

A call the grant has the scope for can still be refused in the store: the person's role there does not allow it now, the store is not one
the connection reaches, or a feature is off. That answer is a tool result with `isError: true` and words that say why.

## Changes that wait for a yes {#approvals}

A tool call is kept for the person's yes, and not done, when:

- the connection is at *Read and propose changes* and the tool is not read-only; or
- at any level, the tool has a gate and the gate applies. A gate marks a change that publishes, sends something in the store's name, costs
  money, changes a domain or who works in the store, or starts work in the person's name. Some gates apply only sometimes: for example,
  a product's change waits only while the product is on the site, a setup change only once the store is open. The reference lists the
  [gates](/docs/reference/mcp#gates).

The arguments are checked first, so a change that could not be made is refused at once rather than kept. A kept call answers:

```json
{
  "kept_for_approval": true,
  "what": "…",
  "where": "https://kaizenaflow.com/admin/{store}/assistant?c=…",
  "note": "Not done yet: the owner approves or declines it in Kaizena Flow's admin."
}
```

`what` is what the approval says, after the client's name: *{name} asks: …*. It says what the change does, in words made from the
call's arguments: what it changes and the values it gives. For `add_order_note`, for example: *{name} asks: Add a note to order 1042,
for the store's staff only: "Customer asked for gift wrap."*. Texts are put on one line and cut to a length. A tool with no words of
its own is named by its title, with its arguments in plain words. The person approves or declines it in the store's
[AI manager](/admin/{store}/assistant), in a conversation of the client's own, called *From* and the client's name. They also get a
notice under [AI manager notices](/admin/account/notices).

- The yes is given there, by the person, with *Approve*. Nothing an assistant writes ever gives it, `ask_store_assistant` included.
- The AI manager is the owner's, so only a connection that holds `owner`, of a person who owns the store, can have a change kept. For
  anyone else, a change that would wait is refused and nothing is done.
- A change with no answer in seven days is not done. It also ends, not done, when the connection ends, when an owner cuts the client off
  from the store, or when the client is blocked.

## Asking the store's AI manager {#ask-store-assistant}

`ask_store_assistant` puts a question, in words of up to 4,000 characters, to the store's own AI manager. It needs the `owner` scope, and
the person must own the store. The AI manager answers from the store's data with the store's tools, in the client's own conversation.
In that turn it has only its reading and guiding tools besides the store's: it writes no memory, skill, goal or plan, and learns nothing.

The answer holds `answer`. When the AI manager prepared changes, it also holds `waiting_for_approval`, each change in words, and `where`,
the conversation's address. Those changes wait for the person's yes like any other.

## Tokens {#tokens}

Swap the code at the token endpoint, as `application/x-www-form-urlencoded` (at most 16 KB, each parameter once). A public client names
itself with `client_id` and never sends a secret:

```bash
curl -X POST https://kaizenaflow.com/api/oauth/token \
  --data-urlencode grant_type=authorization_code \
  --data-urlencode client_id=https://assistant.example.com/oauth/client.json \
  --data-urlencode code=$CODE \
  --data-urlencode code_verifier=$VERIFIER \
  --data-urlencode redirect_uri=https://assistant.example.com/oauth/callback \
  --data-urlencode resource=https://kaizenaflow.com/api/mcp
```

`code_verifier` and `redirect_uri` are required, and `redirect_uri` must be the one the code was given for. `resource` may be left out;
when it is sent, it must be `https://kaizenaflow.com/api/mcp`. The answer:

```json
{
  "access_token": "kfa_…",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "kfr_…",
  "scope": "stores:read orders:read orders:write …"
}
```

Send the access token in the `Authorization` header of every call to `/api/mcp`: `Authorization: Bearer kfa_…`. It is taken there only.

| What | Lifetime |
|---|---|
| Code (`kfc_…`) | 60 seconds, and used once |
| Access token (`kfa_…`) | An hour |
| Refresh token (`kfr_…`) | 90 days from when it was made. Each refresh gives a new one and uses up the old one |

To refresh, send `grant_type=refresh_token`, `client_id` and `refresh_token`. You may add `scope` to ask for fewer scopes than the grant
holds, never more (`invalid_scope`); the new access token then holds only those.

> [!WARNING]
> A code or refresh token used a second time ends every token made from that code, yours too. This includes two refreshes your client
> sends at the same moment: refresh one at a time, or the person has to connect again.

A refusal is OAuth's own shape, `{ "error": "…", "error_description": "…" }`: `invalid_client` (401), `invalid_grant`,
`invalid_request`, `invalid_scope`, `invalid_target`, `unsupported_grant_type`, or `slow_down` (429, with `Retry-After: 60`).

To end a connection from your side, revoke a token (RFC 7009) with `client_id` and `token` (an access or a refresh token):

```bash
curl -X POST https://kaizenaflow.com/api/oauth/revoke \
  --data-urlencode client_id=https://assistant.example.com/oauth/client.json \
  --data-urlencode token=$REFRESH_TOKEN
```

Revoking either token ends the whole connection: every token of it, and every change of it still waiting for a yes. The answer is `200`
whether or not the token was known.

## Limits {#limits}

| What | Limit |
|---|---|
| Requests to `/api/mcp` for one connection, across its stores | 120 a minute. Every JSON-RPC request with an `id` counts, `initialize` and `tools/list` too |
| Calls that name one store, from every connection together | 1,200 a minute |
| Requests in one batch | 1 to 10 |
| A request's body | 100 KB |
| Token and revocation requests from one address | 600 a minute |
| Token and revocation requests for one client | 3,000 a minute, counted once a request proved itself |
| Registrations from one address | 10 an hour |

A request past the per-minute limits answers the JSON-RPC error `-32000`. When the body held one request, the answer is also `429` with
`Retry-After: 60`. [Rate limits](/docs/reference/rate-limits) has every API's limits side by side.

## Seeing and ending connections {#connections}

- **The person** sees their connections under [Connected apps and assistants](/admin/account/connected), in their account: each one's
  app, stores, access level and when it was last used. *Disconnect* ends one at once.
- **A store's owner** sees, under [Settings, Apps and API](/admin/{store}/settings/api), every connection that reaches the store, whoever
  made it: *AI assistants and apps connected to this store*. *Cut off* takes the store out of that connection at once, and a connection
  left with no store ends. The store stays out even when the person connects the same app again, until an owner chooses *Let in again*
  on the same page.
- **The person's own security.** Setting or changing their password, or resetting or removing their second step, ends all their
  connections.
- **Kaizena Flow** ends every connection of a client it blocks.

Every call that names a store the connection reaches, refused ones too, is written in that store's
[activity log](/admin/{store}/activity) with the client's name. A store that
requires two-step sign-in is reached only by a connection the person approved after their second step. A suspended store can only be
read, and what already happened handled, through the server; a closed store is not reached at all.

## Kaizen Life {#kaizen-life}

Kaizen Life, another product, connects to the same server without the consent screen, with tokens that Kaizena Flow's account sign-in
issues to Kaizen Life alone. It reaches only the stores its person owns and that are not closed. A change behind a gate waits for the
owner's yes, in a conversation called *From Kaizen Life*. It is also the only client that may go on in the owner's own recent
conversation with the AI manager (within the last 24 hours), with `continue_admin_conversation` on `ask_store_assistant`. Any other
client always asks in its own conversation.
