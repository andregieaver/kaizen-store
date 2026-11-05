# Wave 14: the developer platform and the docs portal

Asked for by the owner on 3 November 2026: a documentation portal at **docs.kaizenaflow.com**, segmented for store owners and for
developers, with a solid search and filter engine and an AI guide; and, before it, the externally available APIs and MCP that the portal
documents. This file is the contract for the wave. It was written from the code as it stood on 3 November 2026 (main at `d0b5d36d`) and
from the MCP specification revision **2026-07-28**; each unit records its decision (D438 to D444) when it ships.

## 1. Where we start

What outside systems can use today, read from the code:

| Surface | What it is | Who | Its gaps |
|---|---|---|---|
| Admin API v1 (D355) `/api/admin/v1` | REST, `kf_` tokens made by an owner for one store, 12 scopes, cursor pages, `takeBudget("api")` (120 a minute a token, 1,200 a store), `Idempotency-Key` on POST | An owner's own integrations | About 25 operations against 252 AI-manager tools; routes in two hand-kept lists (`routeOf()`, `API_ROUTES`); no request or response schemas; discount, checkout and tag bodies unvalidated at the API; live products and publishing refused as `gated` |
| Storefront API v1 (D362) | Products, categories, cart, checkout hand-off; `kfs_` market tokens; `openapi.json` generated from `STOREFRONT_ROUTES` | Headless sites | The OpenAPI document has no body or response schemas; no test ties the list to the route files |
| Webhooks (D41, D354) | 14 topics queued by database triggers (`queue_integration_event()`), signed (`Kaizena-Webhook-*`, HMAC-SHA256), retries 1 min to 6 h, a delivery log, an endpoint switched off after 3 days failing | Owners, 10 endpoints | `data` has no per-topic type or schema; no order created/updated, refund, customer update, quote or inventory-change events; no API to manage endpoints or read deliveries |
| Owner MCP (D96) `/api/mcp` | JSON-RPC, the 252 owner tools plus `list_stores` and `ask_store_assistant`, gated calls kept for the owner's yes | **Kaizen Life only** (`client_id` must be `KAIZEN_LIFE_CLIENT_ID`) | No `aud` or scope check; no rate limit or batch cap; every gated call lands in one "From Kaizen Life" conversation; audit does not name the client; consent page words identity scopes only; clients registered by hand in Supabase |
| Shopping-agent MCP (D353) `/api/ucp/{store}/mcp` | Catalogue search, lookup, cart; `structuredContent`; budgeted, batches of 10 | Any shopping agent | None for this wave |
| Custom apps (D363) | The AI manager calling an owner's own MCP server | Owners, 5 a store | Outbound only |
| Docs | None public. `docs/` is the team's internal record; the platform has no search for visitors, entries have no hierarchy or taxonomy, and the site has one English-only chat agent | | Everything in unit E |

## 2. Principles

1. **Contracts first, generated, tested.** Every route, payload and tool is described once in code (zod), and the OpenAPI documents, the
   webhook catalogue, the MCP catalogue and the docs' reference pages are generated from that one description. A test fails when they drift.
2. **One authorization server** for everything outside: the open MCP (unit B) and apps (unit D) use the same OAuth 2.1 server, the same
   grants, the same revocation screen and the same audit.
3. **The person behind it, every time.** An outside caller acts as a person in one store and can never do more than that person may
   (`memberCan()`, the staff permissions of D158), checked at every call, not only when the grant was made. Gated tools still wait for a yes.
4. **Additive within v1.** Nothing a v1 caller relies on is renamed or removed; a breaking change is a v2 with at least 12 months beside v1,
   announced with `Deprecation` and `Sunset` headers (RFC 9745, RFC 8594) and in the changelog.
5. **Homer and Lisa** (the house rule): the owner meets one clear step (Connect an AI assistant, Install an app, the docs' search box);
   the depth (scopes, tokens, webhooks, the reference) is one deliberate step away.
6. **Docs are code.** Articles live in the repository beside the features they describe, are checked in CI (links, admin paths, operation
   ids, tool names), and ship in the same commit as the change they document.

## 3. The units, in the order they are built

The owner asked for this order: contracts (A), the open MCP (B), the Admin API's breadth and events (C), apps for many stores (D). The docs
portal (E) is built alongside: its shell, content and search do not depend on B to D, its generated reference follows A, and each later
unit adds its pages in the same commit.

### Unit A: contracts (D438)

**A1. One registry for the Admin API.** `ADMIN_API` in `src/lib/admin-api-routes.ts` (pure) replaces both `routeOf()`'s hand-written
branches and `API_ROUTES`: one entry per operation with `method`, `path` (`/products/{id}`), `name` (`products.get`), `scope`, `summary`,
`description`, `params` (zod), `query` (zod), `body` (zod, for writes), `response` (zod) and the error codes it can answer. `routeOf()` is
derived from it. Every write gets a zod body at the API layer (discounts, checkout rules and fields, tags too), so a caller is told what is
wrong in the API's own words before a screen's checks run; the screens keep their checks. Every answer is built through its `response`
schema (`productOut` and the others become `z.output` types), and the integration tests parse every answer they get with it.

**A2. OpenAPI 3.1, generated.** `adminOpenApi()` builds the document from `ADMIN_API` with `z.toJSONSchema()`: paths, parameters, request
bodies, responses (the success shape and the error envelope `{ error: { code, message } }` with each code's status), the bearer scheme
(`kf_` tokens; OAuth 2.1 from unit B on), scopes per operation (`x-required-scope` and the `security` requirement), pagination
(`next`, `?after=`), the rate limit headers and `Idempotency-Key`. Served at `/api/admin/v1/openapi.json` (public, cached). The storefront
document gains its request and response schemas from the zod it already has (`cartBody`, `productsQuery`, …). Tests: every registry entry
has its schemas; every `route.ts` under `api/admin/v1` and `api/storefront/v1` is matched by a registry entry and the other way round; the
document is valid OpenAPI 3.1 (a structural check against the published JSON Schema of the format, kept in `src/data/`).

**A3. Webhook contracts.** `WEBHOOK_TOPICS` (pure) holds each topic's id, description, who may receive it (services, endpoints, apps) and
the zod schema of its `data`; `subjectData()` builds each topic's `data` through that schema, and an integration test makes every topic
happen and parses what would be sent. The catalogue is in the OpenAPI document's `webhooks` section and at `/api/webhooks/v1/topics.json`,
with `PAYLOAD_VERSION`, the headers and how to check the signature (the same steps as `verifyWebhook()`).

**A4. The MCP catalogue.** `/api/mcp/catalogue.json` (public): every owner tool with its `name`, a `title`, `description`, input JSON
Schema, gate, the permission it needs and the feature it stands behind, and MCP tool `annotations` (`readOnlyHint` for tools without a
gate, `destructiveHint` for gates `spend`, `domain`, `access` and deletions, `idempotentHint`, `openWorldHint` for tools that reach outside
services). `tools/list` on `/api/mcp` answers the same annotations and titles. The shopping-agent catalogue (`AGENT_TOOLS`) is published
the same way.

**A5. Versions and the changelog.** The generated contract (Admin API, storefront, webhooks, MCP catalogue) is hashed into
`src/data/api-contract.json` with its version (`1.<n>`); CI fails when the generated contract differs from the recorded one and
`content/docs/developers/changelog.md` has no entry for the new version, so no change reaches callers unannounced. A removed or renamed
field fails the same test unless it is a new major version.

### Unit B: the open owner MCP and Kaizena Flow's authorization server (D439)

**Why our own server.** Supabase's OAuth 2.1 server (used for Kaizen Life) offers identity scopes only and Dynamic Client Registration,
which the MCP revision 2026-07-28 deprecates in favour of Client ID Metadata Documents; it has no resource indicators, so its tokens are
not bound to `/api/mcp` as the specification requires, and its grants live outside our admin. We need consent per store and per
permission, grants we list and revoke, the client named in every audit entry and approval, and the same server for apps (unit D). So the
app becomes an OAuth 2.1 authorization server of its own. Kaizen Life's Supabase tokens stay accepted until Kaizen Life moves to a
pre-registered client of ours; nothing changes for it on the day this ships.

**B1. Discovery and metadata.**
- `/.well-known/oauth-authorization-server` (RFC 8414), issuer `https://kaizenaflow.com`: `authorization_endpoint` `/oauth/authorize`,
  `token_endpoint` `/api/oauth/token`, `revocation_endpoint` `/api/oauth/revoke` (RFC 7009), `registration_endpoint` `/api/oauth/register`
  (RFC 7591, kept for older clients), `client_id_metadata_document_supported: true`, `code_challenge_methods_supported: ["S256"]`,
  `grant_types_supported: ["authorization_code", "refresh_token"]`, `response_types_supported: ["code"]`,
  `token_endpoint_auth_methods_supported: ["none", "client_secret_basic"]`, `scopes_supported`,
  `authorization_response_iss_parameter_supported: true`.
- `/.well-known/oauth-protected-resource` (RFC 9728) for `/api/mcp` names our issuer first (and Supabase's while Kaizen Life uses it),
  `scopes_supported` the minimal read set, `resource_documentation` the docs page.

**B2. Clients.** `commerce.oauth_clients`: `id`, `kind` (`metadata_document` | `registered` | `preregistered` | `app`), `client_id`
(an HTTPS URL for a metadata document, a generated id otherwise), `name`, `logo_url`, `client_uri`, `redirect_uris`, `secret_hash` (apps
only), `verified` (Kaizena Flow checked who it is), `created_at`, `last_seen_at`, `blocked_at`.
- A metadata-document client is fetched on first use through `safeFetch()` (a public address, HTTPS, 5 seconds, at most 64 KB, no
  redirect), checked (`client_id` equals the URL exactly; `client_name` and `redirect_uris` present; each redirect URI HTTPS or a loopback
  address) and kept, refreshed when the cache headers allow, at most daily.
- A registered client (RFC 7591) is a public client with loopback or HTTPS redirect URIs, `application_type` honoured, at most 10
  registrations an hour from one address.
- Redirect URIs are matched exactly, except the port of a loopback address (RFC 8252). The consent page always shows the client's host,
  with *Not verified by Kaizena Flow* unless `verified`.

**B3. Scopes.** One scope per staff permission (D158): `products:read`, `products:write`, `orders:read`, `orders:write`, `customers:read`,
… the same keys `TOOL_PERMISSIONS` and the Admin API use, plus `stores:read` (list the stores and what each offers). A token's power in a
store is **the grant's scopes ∩ the person's permissions there now**, checked at every call. A tool whose permission is outside the token
answers `403` with `WWW-Authenticate: Bearer error="insufficient_scope", scope="…", resource_metadata="…"`, all the scopes the call needs
in one challenge. `tools/list` lists only the tools the token can call, each store's features applied as today.

**B4. Authorization.** `/oauth/authorize` is a page of the admin's own frame:
- A person not signed in signs in first and comes back. A platform admin needs the second step (`aal2`), as today.
- The request must carry PKCE `S256`, `resource` (the canonical `https://kaizenaflow.com/api/mcp`, or the Admin API's for apps), `state`
  and a redirect URI of the client's.
- The consent screen (Homer's view): the client's name, logo and host, its verified mark, one sentence of what it will be able to do, the
  stores to connect (ticked: the person's stores where they may do anything at all), and one choice: *Read only*, or *Read and propose
  changes* (the default; every change still waits for a yes in the admin), or *Read and change* (only the person's own permissions, and
  gated tools still wait). Lisa's step, *Choose permissions*, shows the scopes one by one.
- Approve or deny. The answer redirects with `code`, `state` and `iss` (RFC 9207). The page cannot be framed
  (`frame-ancestors 'none'`). Every decision is audited (`oauth.approved`, `oauth.denied`) with the client, stores and scopes.

**B5. Tokens and grants.**
- `commerce.oauth_grants`: account, client, `store_ids`, scopes, resource, `created_at`, `last_used_at`, `revoked_at`.
- `commerce.oauth_tokens`: kind (`code`, `access`, `refresh`), `token_hash` (SHA-256), grant, family, `expires_at`, `used_at`.
- An authorization code lives 60 seconds and is used once. An access token (`kfa_`, opaque) lives one hour and is bound to its
  `resource` (audience). A refresh token (`kfr_`) is rotated at every use; using an old one revokes the whole family (theft detection).
  Refresh tokens end after 90 days unused.
- The token endpoint takes `client_secret_basic` for apps and nothing for public clients (PKCE).
- Revocation (RFC 7009) and the screens below end a grant at once.

**B6. The MCP server.**
- `/api/mcp` accepts our access tokens (issuer, audience `…/api/mcp`, not expired, the grant alive) and Kaizen Life's as today.
- Each call is budgeted per grant (`takeBudget("mcp")`, 120 a minute a grant, 1,200 a store), batches at most 10, bodies at most 100 KB.
- A gated call lands in a conversation per client and person ("From Claude", "From ChatGPT", …), with the client named on the approval
  and in the notice (D350). Every call is audited with `via: "mcp"` and the client.
- `ask_store_assistant` keeps working for every client. Its words "Kaizen Life" become the client's name, which changes the prompt's drawing:
  a new prompt version and a new eval recording.

**B7. Screens.**
- Account → *Connected apps and assistants*: each grant's client, stores, access level, last used, and *Disconnect*.
- Store → Settings → Apps and API → *AI assistants and apps connected to this store*: the owner sees every grant that reaches the store,
  whoever made it, and can cut it for this store.
- `/admin/platform/oauth`: clients seen, *Verify*, *Block*.
- The docs page *Connect an AI assistant* gives the one address to paste: `https://kaizenaflow.com/api/mcp`.

**B8. Security review before it ships.** An adversarial review of the server against the MCP security considerations (token audience
and theft, code interception, mix-up, open redirects, metadata-document fetching, clickjacking), the OAuth 2.1 draft and the PSI's
checklist. Tests:
- unit: PKCE, redirect matching, metadata documents, scope math, metadata;
- integration: the whole flow with a metadata-document client and a registered client, refresh rotation and reuse, revocation, audience
  mismatch refused, the scope challenge, a person's permission removed after the grant;
- signed-in e2e: the consent screen.

### Unit C: the Admin API's breadth and more events (D440)

Built in four slices on unit A's registry, each with its OpenAPI entries, tests and docs pages. New scopes are added to the registry,
the token screen, the consent screen and the docs together.

**C1. Catalogue.** Categories and tags (list, get, create, update, delete; put a product in or out). Product media: an upload address
(`POST /media/uploads` gives a signed one-time URL, the file is checked as the library checks it, D88, D213) and a product's gallery.
Publishing and changing live products with a new scope `products:publish`, so a token made for it can do what `update_product` asks a
yes for. Price lists' prices (D321). Updated-since filters (`?updated_after=`) on every list, for incremental sync.

**C2. Orders.**
- Draft orders and quotes: list, get, create, change lines and prices, send, decline (D173, D431).
- Refunds (`orders:refund`, a new scope, through `refundOrder()` only, D174).
- Returns: list, get, approve, decline, receive (D153).
- Order notes and tags, and cancelling an unpaid order.

**C3. Customers and marketing.**
- Customers: create, update, find by email.
- Segments, read (D296).
- Discounts: update and switch off.
- Gift cards (`gift_cards:write`, D300): issue, list, disable. No code is ever answered after issue.
- Subscriptions: list, get, pause, cancel (D102).
- Store credit and loyalty, read.

**C4. Content, store and operations.**
- Pages, blog articles and content entries: read, write drafts, and publish with `content:publish`.
- Menus, read.
- The store's settings, read: markets, currencies, languages, shipping rates and methods, tax profile, price display.
- Saved reports, run (D345).
- Webhook endpoints and their deliveries (`webhooks:write`): list, create, update, delete, read deliveries, resend.
- Bulk jobs on the D165 pipeline: start an import or export, poll it, download it.

**New topics**, each typed in `WEBHOOK_TOPICS` (A3) with its trigger and tests:

| Area | Topics |
|---|---|
| Orders | `order.created`, `order.updated` (an edit, D174), `fulfilment.created`, `fulfilment.updated` (tracking, D238), `refund.created`, `return.updated` |
| Customers | `customer.updated`, `customer.erased` (ids only, D162) |
| Stock and catalogue | `inventory.updated` (coalesced per variant per minute), `product.archived` |
| Quotes and drafts | `quote.requested`, `draft.sent` |
| Other | `subscription.renewed`, `subscription.payment_failed`, `gift_card.issued` (no code), `review.created` |

### Unit D: apps for many stores (D441)

- **Developers.** Any account can turn on *Developer* (accepting the developer terms) and make apps at `/admin/developer`.
- **An app** has:
  - a name, logo, description and homepage;
  - privacy policy and support addresses;
  - redirect URIs;
  - the scopes it asks for (Admin API and MCP);
  - its webhook topics and address, signed with the app's own secret;
  - an uninstall address and the data-deletion events (`app.uninstalled`, `customer.erased`, `store.erase_requested` 48 hours after an
    uninstall).
  - It is an OAuth client of unit B with a secret (`kind: app`).
- **Distribution** is *Private* (the developer's own stores), *Unlisted* (an install link), or *Listed* (after Kaizena Flow's review, in
  an app directory).
- **Installing** is unit B's flow with the app's client: the owner chooses the store, sees the scopes, and approves. Each installation has
  its own tokens, usable on the Admin API (`Authorization: Bearer kfa_…`) and on the MCP server. A changed scope list asks the owner again.
- **Powers (D440 review).** The Admin API's powers (`products:publish`, `orders:send`, `orders:refund`, `customers:email`,
  `discounts:publish`, `gift_cards:write`, `content:publish`, `webhooks:write`) are no OAuth scope yet and no level grants one. Before
  `kfa_` tokens work on the Admin API, each power a grant holds is checked against the person's current permission at every call (as the
  route checks the operation's own permission), and the consent screen says what each one does without asking, in words that claim only
  that.
- **Uninstalling** revokes the installation's tokens at once, sends `app.uninstalled`, and stops the app's webhooks.
- **Controls:** a budget per installation, the app named in every audit entry, and the store's *Apps* screen listing what is installed
  with *Remove*.
- **Legal:** the developer terms, the data processing terms an app accepts for the customer data it receives, and the review checklist are
  written by hand and need legal review before any app is listed.

**D in detail (4 November 2026), built in three slices.**

*D1, apps and installing them.*
- **Developer mode.** `commerce.developers` (an account, the terms version it accepted, when). Account → Developer (`/admin/account/developer`, as
  built) offers *Become a developer* with the developer terms (`/docs/developers/apps/developer-terms`, a draft for legal review, its version in `DEVELOPER_TERMS_VERSION`); after
  it, the account's apps (at most 25). An account that is erased takes its developer row with it; its apps are blocked, never handed on.
- **An app** is `commerce.apps` beside its `oauth_clients` row (`kind = 'app'`, a secret kept as its SHA-256, shown once, *Renew*):
  name, logo, description (500 characters), homepage, privacy policy and support address (HTTPS, and an email), redirect URIs (B2's rules,
  HTTPS only), the scopes it asks for (unit B's, plus the Admin API's powers, `APP_POWERS`: all of `API_POWERS` but `webhooks:write`,
  whose operations are the owner's alone; an app is sent its own events in D2), and its events address and topics (D2 sends
  them). `distribution` is `private` (only stores the developer works in), `unlisted` (anyone with the install link) or `listed` (asked for
  in D1, granted by Kaizena Flow's review in D3).
- **Installing** is B4's flow with the app's client and the resource `https://kaizenaflow.com/api/admin/v1`. The consent screen shows the
  app, its host, its verified mark, what it asks for in words (each scope, then the powers: *Without asking you each time, it may also …*),
  and **one store** to install it on: a store is offered only where the person holds every permission the app asks for (a power rests on
  the permission its operations need, `POWER_PERMISSION`, which asking for the power asks for too), and, for a private app, only the
  developer's own. No level choice: an app gets what it asked for.
  Approving makes the installation: a grant with `resource = 'admin'`, `store_id` that store, its scopes the app's, `access = 'change'`
  (gated tools still wait for a yes). One live installation per app and store (`oauth_grants_app_store_key`); installing again replaces
  it. The token endpoint takes the app's `client_secret_basic` (B5); codes, rotation and theft detection are B's.
- **Its tokens** (`kfa_`) work on the Admin API and the owner MCP. On the Admin API (`apiCaller()`): the grant's store, the person's
  membership read now, and each operation allowed only when the grant holds the operation's permission (`scopeHeld()`), the power when the
  operation's scope is one, and the person may do it now (`memberCan()`), as a `kf_` token's maker must. Budget `api` per installation;
  idempotency keys in `api_app_idempotency_keys`; every change audited with the app named (`via: "app"`). On the MCP: B6, the installation
  as a grant for its one store.
- **Screens.** Store → Settings → Apps and API lists the installed apps (name, who installed it, when, last used, its scopes) with
  *Remove* (an owner): the grant ends at once with every token (`oauth.app_removed`). Account → Connected apps and assistants lists them
  too. An app's page shows its installations count, never the stores.

*D2, events and uninstalling.*
- An installation gets an endpoint of its own (`webhook_endpoints.app_grant_id`), its address and secret the app's (encrypted), its topics
  the app's that the installation may read (a topic's subject → the permission it needs to read). It is not the owner's to change, and
  is not counted in their ten. Changing the app's address, secret or topics changes every installation's endpoint at once.
- `customer.erased` always goes to an installed app, whatever its topics. Uninstalling (*Remove*, the person leaving, the app blocked)
  ends the grant, switches the endpoint off (`disabled_reason = 'uninstalled'`) and queues `app.uninstalled` at once and
  `store.erase_requested` 48 hours later, both sent to that endpoint though it is off; nothing else is.
- **Scopes asked again.** When the app's scopes grow, an installation keeps its own until the store approves the new list: the Apps
  screen says *Asks for more* and *Review* runs the consent again.
- **As built (4 November 2026).** The installation's endpoint is `src/server/app-endpoints.ts`'s (`syncInstallationEndpoint()`): made
  with the installation, brought up to date when the app's address, secret or topics change, taken away when the app has no address.
  Ending is the database's: a deferred trigger on `oauth_grants` (`app_installation_ended()`) switches the endpoint off and queues the
  two events on every way an installation ends (Remove, a password or second step changed, the app blocked, the installer's membership
  deleted by `store_member_left_apps()`, which covers an erased account too); installing again moves the old endpoint to the new
  installation in the same transaction, so it sends neither, and cancels a `store.erase_requested` still waiting. *Review* is a fold on
  the Apps screen listing what is newly asked in words with *Give it this* (an owner; the installation's scopes become the app's in
  place, so its tokens keep working), shown only while the person who installed it may give all of it. Erasing a developer's account
  blocks their apps (every installation ends) and removes developer mode. The two topics are contract 1.7.

*D3, listing and the docs.*
- *Request listing* puts a listed app in Kaizena Flow's review queue (`/admin/platform/apps`: approve with a note, or decline with the
  reason, both emailed). The directory (`/apps`) shows approved apps only once the legal texts are approved (`APP_DIRECTORY_OPEN`, off).
- The data processing terms an app accepts and the review checklist are drafts for legal review, as the developer terms are.
- Docs: *Build an app* and the quickstart *A first app* (developers' track), the Admin API's OpenAPI document gains the OAuth security
  scheme, the webhook catalogue the app events (contract 1.6, changelog), and the owners' *Apps* page.
- **As built (4 November 2026).** A listed app asks for review when it is saved as *Listed* (again after a decline). Platform → App
  listings (`/admin/platform/apps`, `listingRequests()`, `decideListing()`) approves with an optional note or declines with the reason;
  the developer is emailed in their admin's language (`platform.app_listing_decided`) and the app's page shows it. The directory's read
  (`directoryApps()`) answers nothing while `APP_DIRECTORY_OPEN` is off; its page is built when the legal texts are approved, because a
  route at `/apps` would hide a page of Kaizena Flow's own site at that address while it showed nothing. The data processing terms and the
  review checklist are drafts beside the developer terms. The app events were contract 1.7 (with D2); the OAuth security scheme
  (`appOAuth`, each operation with the permission and power an app's token needs) is contract 1.8. *A first app* is a Node script; the
  owners' page is *Apps from other companies* (English and Norwegian).
- **Where the directory lives (the owner, 5 November 2026):** at `kaizenaflow.com/apps`, never a subdomain such as
  `extensions.kaizenaflow.com`: one site keeps search engines' trust in one place and owners' sign-in in one place, and the developer
  guides stay on `docs.kaizenaflow.com`. When `APP_DIRECTORY_OPEN` is turned on, link `/apps` from the site's *Custom Extensions*
  page (`/custom-extensions`, whose question *Is there an app store?* then changes) and from *Integrations*.

### Unit E: the docs portal (D442 to D444)

**E1. The host and the frame (D442).**
- **Host:**
  - `NEXT_PUBLIC_DOCS_HOST=docs.kaizenaflow.com` and `docsHostRoutes()` in `next.config.ts`, as the theme store's host does (D249,
    `src/lib/theme-host.ts`): the host's addresses serve `/docs/…`, and Kaizena Flow's `/docs` moves there.
  - The host has its own `sitemap.xml`, `robots.txt` and `llms.txt`, plus `llms-full.txt` (every page as plain Markdown for AI tools), and
    every page also answers as Markdown (`…/page.md`).
- **The frame:**
  - A top bar: *Store owners*, *Developers*, *API reference*, *Changelog*, *Status* and the search box (⌘K).
  - The track's tree on the left, *On this page* on the right, breadcrumbs, previous and next.
  - *Was this helpful?* (a yes or no and an optional sentence, kept for the platform's admins, never a person's data beyond that).
  - The page's last check date, light and dark, and print.
  - English and Norwegian for the owners' track (D312's `/no/` prefix); English only for developers.
  - Accessible as every page is (axe in CI), fast as every page is (prerendered, the CI budget of D336).
- **A person must** add the DNS record at the registrar, add the domain in Vercel, and set the variable:
  - `docs` CNAME `cname.vercel-dns.com.` (kaizenaflow.com's DNS is at the registrar, not at Vercel);
  - the same steps as `docs/kaizena-flow-switchover.md` §1.4.

**E2. Content as code (D442).** Articles are Markdown files in the repository, `content/docs/{track}/{section}/{slug}.{lang}.md`, with front
matter:

```yaml
title: Price a product on request
summary: Show no price and let shoppers ask for a quote instead.
track: owners            # owners | developers
section: products
kind: how-to             # tutorial | how-to | concept | reference | troubleshooting | changelog
areas: [products, orders, quotes]
features: []             # D178 features the page needs, if any
plans: []                # plans it is on, if not all
admin: /admin/{store}/products/{id}   # where in the admin it happens, checked against the admin map
order: 40
checked: 2026-11-03      # when it was last checked against the product
sources: [D431, D433]    # internal: the decisions it describes
```

- **A pure compiler** (`src/lib/docs-content.ts`) turns the files into a typed index at build time. The Markdown is a safe subset:
  headings, lists, tables, code with highlighting, callouts, images from the repository, and links. No HTML, no scripts.
- **CI checks every file:**
  - the front matter;
  - internal links and anchors;
  - `admin` paths against the admin map (D107);
  - API operation names against `ADMIN_API`, tool names against the catalogue, decision numbers against `docs/decisions.md`;
  - that the Norwegian page of an English one exists or is listed as missing.
- **Generated reference** (E4) is not written by hand.
- **A changed decision** that a page names as its source makes the page *due a check*. A list for the platform's admins says which, and
  the page shows its check date.

**E3. Search and filters (D443; built, see D443 in `docs/decisions.md`).**
- **The index:** `commerce.docs_index` holds one row per article section and per reference item (an operation, a webhook topic, a tool, an
  error code, a scope). It is written by a job after each deploy when the content's hash changed. Each row carries:
  - track, kind, areas, features, plans, language, URL;
  - title, headings and text;
  - a `tsvector` (with the language's dictionary), trigram text for typos (`pg_trgm`), and an embedding (the D81 knowledge machinery).
- **Search** is `/api/docs/search?q=&track=&kind=&area=&lang=&sort=`:
  - keyword and meaning results merged by rank (as `searchKnowledge()` merges them);
  - title and heading matches weighted;
  - synonyms (VAT, MVA, moms; quote, offer, tilbud);
  - facet counts for every filter;
  - sorting by relevance, recently checked, A to Z, or most read (anonymous counts);
  - a page of 20 with a cursor.
- **On the page:**
  - the search box opens a dialog that searches as you type (debounced) with the filters as chips;
  - every result shows its track, kind and breadcrumb;
  - the filters live in the address, so a search can be shared;
  - the keyboard works throughout;
  - no result offers the AI guide with the question already filled in, and is counted for the docs' gap list.
- **Lists of a section** (and the API reference's lists) use the same filters and sorts.

**E4. The generated reference (D442; built, see D442 in `docs/decisions.md`).** From unit A's contracts:
- **Admin and storefront APIs:** one page per resource with every operation's method, path, scope, parameters, body and answer (schemas
  rendered as tables), errors, and an example request in curl, JavaScript and Python.
- **Webhooks:** one page per topic with its payload and an example, plus signature checks in JavaScript, Python and PHP.
- **MCP:** the tool catalogue by area with each tool's gate, permission and inputs.
- **Scopes, errors and rate limits** as their own pages.
- **The changelog** from `content/docs/developers/changelog.md`.
- **As built:** every page is made at build from the registries (`docsApiReference()`, `src/lib/docs-api-reference.ts`), at
  `/docs/reference/…` (`/reference/…` on the docs' host); an MCP area is the area of the permission a tool needs; the search's reference
  items lead to their headings there, and the reference is one section of the developers' track (`developers/reference`).

**E5. The docs guide (D444; built, see D444 in `docs/decisions.md`; its eval is recorded on production after the deploy).**
- **What it is:** a second chat agent for the docs host, with its own settings and a screen at `/admin/platform/docs/guide`. *As built:* its
  settings are a table of its own (`commerce.docs_guide`, one row), not a second `chat_agents` row, whose key (`UNIQUE NULLS NOT DISTINCT
  (store_id)`) every writer's upsert names; its conversations are tables of its own kept by the platform chat's periods and retention kinds,
  not support's, since a docs reader is anonymous and no person takes a docs conversation over.
- **Tools:**
  - `search_docs` (E3's search with its filters);
  - `read_doc` (a page's sections);
  - `api_operation`, `webhook_topic` and `mcp_tool` (from the contracts);
  - `navigate` (to a docs page, and for a signed-in person to an admin page by its path). It never opens a store's data.
- **Rules:**
  - It answers only from what its tools return, and every answer links the pages it used.
  - It says plainly when the docs do not cover something, and offers Kaizena Flow support.
  - It asks whether the person runs a store or builds on the platform when it cannot tell.
  - It answers in English or Norwegian.
  - It never asks for or repeats a token, a key or a password.
  - Its prompt carries `UNTRUSTED_TEXT` and is versioned (D391).
- **Eval cases:**
  - an article with hidden instructions;
  - a request to act on a store;
  - a token pasted into the chat;
  - an off-topic question;
  - a comparison with another platform, answered from the docs only.
  - A new recording is committed with it (recorded on production after the deploy).
- **Retention:** conversations are kept as the platform chat's are (D216), and questions it could not answer feed the gap list
  (`docs_search_misses.guide_misses`, beside the searches).
- **As built, also:** the hand-over is `offer_support` (the admin's *Kaizena Flow support* and the platform's email); `navigate` to the
  admin only for a signed-in person, which on the docs' own host nobody is (the admin's session is a cookie of Kaizena Flow's host); tokens,
  keys and passwords are taken out of a reader's message in code before it is kept or sent; the panel loads only when it is opened.

**E6. The content (D442).**

| Owners (English and Norwegian) | Developers (English) |
|---|---|
| Getting started (a store, the setup list, plans and billing) | Overview (concepts, authentication, scopes, rate limits, errors, pages, idempotency, money, versions) |
| Products (variants, prices, price on request, bundles, quantity rules, pictures and video, categories, import) | Quickstarts: an Admin API token, a headless storefront, a webhook receiver, connecting an AI assistant over MCP, a first app |
| Stock | Admin API reference (generated) |
| Orders (drafts and quotes, sending, returns and withdrawals, refunds, exchanges, invoices) | Storefront API reference (generated) |
| Payments (Stripe, methods per country, capture, payouts, disputes) | Webhooks (concepts, signatures, retries; topics generated) |
| Shipping and delivery | MCP (the owner MCP and its tools; shopping agents and UCP) |
| Countries, languages, currencies and tax (VAT, OSS, IOSS, customs, producer responsibility) | Apps (install flow, distribution, review) |
| The website (builder, themes, pages, blog, content types, menus, SEO, redirects, domains) | WordPress plugin |
| Marketing (discounts, campaigns, email, segments, gift cards, reviews, loyalty, creators, feeds) | Themes (building and submitting) |
| Customers (accounts, companies and B2B, groups, personal data) | Changelog and deprecations |
| AI (the AI manager, the autopilot, the chat, AI texts and pictures) | Status |
| Reports and analytics | |
| Team and settings (staff, permissions, security, notifications, integrations) | |
| Troubleshooting | |

- **Each page is written from the rules** (`docs/rules/…`) and the code, never from memory. It names its sources and is checked before it
  is published.
- **The first release** covers getting started, every developer page, and in the owners' track the areas most asked about in support,
  with the rest following section by section.

## 4. The order of work and how it ships

| Step | What | Depends on | Ships with |
|---|---|---|---|
| 1 | A1 to A5: contracts | | D438; the docs' reference pages start from it |
| 2 | B: the authorization server and the open MCP | A (scopes, catalogue) | D439, its security review, the prompt's new version and eval recording |
| 2′ | E1, E2, E3 and the first E6 pages (alongside B) | A for E4 | D442, D443 |
| 3 | C1 to C4: the Admin API's breadth and new topics, a slice at a time | A | D440, each slice's reference pages |
| 3′ | E4, E5 (alongside C) | A, E3 | D442, D444, the guide's eval recording |
| 4 | D: apps for many stores | B, C | D441; the app directory waits for the legal texts |

Every step runs the house checks before its push (lint, type check, unit, integration, browser tests), takes its migrations to production
through CI, checks the Supabase advisors and records the migration versions, and updates the standing document. A step that changes a
tool's description or a prompt is pushed without a migration, then the eval is recorded again on production and its recording committed.

## 5. What only a person can do

- Add the DNS record for docs.kaizenaflow.com at the registrar, add the domain to the Vercel project, and set `NEXT_PUBLIC_DOCS_HOST` (E1).
- Have the developer terms, the apps' data processing terms and the app review checklist reviewed by a lawyer before any app is listed (D).
- Decide whether Kaizen Life moves to a pre-registered client of the new authorization server, and when (B).
- Read the owners' pages in Norwegian before they are published (E6). The English pages are checked against the rules.

## 6. Decisions to record

- D438 Contracts: one registry per API, generated OpenAPI 3.1, typed webhook topics, the MCP catalogue, versions and changelog.
- D439 Kaizena Flow's OAuth 2.1 authorization server and the open owner MCP.
- D440 The Admin API's breadth and the new topics.
- D441 Apps for many stores.
- D442 The docs portal: host, frame, content as code, generated reference, content.
- D443 The docs' search and filter engine.
- D444 The docs guide.
