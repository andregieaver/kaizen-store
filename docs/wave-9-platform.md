# Wave 9: platform and extensibility (decisions D354 to D363)

The contract for wave 9 of `docs/parity-plan.md`. It covers:

- events sent to the owner's own endpoints, signed;
- an Admin API with scoped tokens, for the owner's developers, warehouses and accounting tools;
- workflows: triggers, conditions and actions beyond an order paid, drafted by the AI manager on request;
- checkout rules and fields an owner sets without code;
- comparing versions, and a staging copy of a store's site merged back;
- self-serve sign-up with a trial;
- a public status page, incidents, and an alert to platform admins;
- an installable admin with push for new orders;
- a storefront API for a front end of the owner's own;
- a custom app's tools offered to the AI manager.

It was written on 2026-10-28 from the eleven rows of `docs/parity/rows` marked wave 9 (as re-rated through 2026-10-28), the plan,
CLAUDE.md and a read of the code. Code, tests and texts follow this file. A unit that must change course says so here first.

**What exists today (read in the code).**

- **Events out** (D41, `src/lib/integrations.ts`, `src/server/integrations.ts`): Zapier, Make and Slack only (`checkWebhookUrl()`), eight events
  (`EVENTS`), queued by the database, five retries over about 8.6 hours, a delivery log kept 30 days, encrypted addresses, a test send. No
  signature, no owner's own endpoint, no product, stock, return or discount events, no payload version.
- **Outside access**: `/api/mcp` serves Kaizen Life only (D96); the WordPress API (D169, D170) reads what a shopper sees for an approved site;
  the shopping agents' endpoint (D353) is public and read-mostly. No token an owner makes, no write API.
- **Automation**: order rules (D238, `src/lib/order-rules.ts`): one trigger (an order paid), a closed list of conditions and actions (tag,
  notify staff, hold, ask the AI manager), 50 a store, each run logged. Email automations (D298), reminders, the autopilot (D309).
- **Checkout logic**: the built-in rule types (campaigns, groups, codes, carriers, shipping methods, payment methods per country). No owner
  rule hides a shipping option or a payment method, and no field the shopper fills in at checkout (custom fields for orders are staff's).
- **Versions**: page versions (D305, newest 50), look versions (D340, newest 50), preview links for a draft or an installed theme (D340),
  store duplication (D129). No comparison of two versions; no staging copy merged back.
- **Sign-up**: invite-only with a platform admin's approval (P3); the setup wizard after (D178). A domain-only account is self-serve (D317).
- **Health**: `/api/health` (`src/lib/health.ts`), cron health on the platform home (D318). No public status page, no incident, no alert.
- **The admin on a phone**: responsive in places; no manifest, no service worker, no push.
- **A storefront API**: the WordPress API is one, for an approved site.

## 1. The units, in the order they are built

| Unit | Decision | What | Rows it closes |
|---|---|---|---|
| A | D354 | Events to the owner's own HTTPS endpoints: per-endpoint topics and a signing secret shown once, HMAC-SHA256 over a timestamp and the body, versioned payloads for orders, refunds, returns, withdrawals, customers, products, stock, subscriptions and discounts, retries, an endpoint switched off after days of failure with the owner told, a delivery sent again by hand | `platform.outgoing-webhooks` (3) |
| B | D355 | An Admin API with scoped tokens: an owner makes a named token for one store with chosen scopes, sees it once; REST endpoints for products, variants, stock, orders, customers and discount codes, cursor pages, money as minor units with the currency, every change audited with the token's name, gated actions refused, 429 with a retry time; a warehouse reads paid orders, posts a shipment with tracking and posts stock levels | `platform.public-admin-api-and-custom-apps` (3), `orders.3pl-and-fulfilment-network` (2) |
| C | D356 | Workflows: triggers (an order paid, a customer created, stock low, a return requested, a schedule), conditions on the event's fields, actions (tag, note, email staff, post to Slack, send a signed request to an endpoint through the address guard, ask the AI manager); saved off, tested before switched on, once per event, capped against loops; the AI manager drafts one from a sentence, saved off | `platform.workflow-automation-flow` (3) |
| D | D357 | Checkout rules and fields: declarative rules (a closed list of conditions and effects) that hide or rename a shipping option, hide a payment method, or refuse a basket with a reason; run by `cartSummary()` and `placeOrder()` alike, skipped and recorded when they fail; checkout fields the shopper fills in, seen by staff on the order | `platform.custom-logic-functions` (2), `checkout.checkout-extensibility-ui-extensions-functions` (2) |
| E | D358 | Versions compared, and a staging copy: two versions of a page, header, footer, product layout or the look compared side by side in words; a staging copy of a store's site (pages, theme, menus) made, edited and merged back, never touching products, orders or customers | `platform.store-duplication-staging-theme-versions` (3) |
| F | D359 | Self-serve sign-up: a store at once after the address is confirmed, a trial with a stated end, limits per address and network, private until opened, payments only after onboarding, a platform switch | `platform.self-serve-sign-up-and-onboarding` (4) |
| G | D360 | A status page: storefront, checkout, admin, database and email from real checks every few minutes, a 90-day history, incidents posted by platform admins, subscription by email or feed without an account; a failing check emails platform admins | `platform.hosting-cdn-uptime-status-page` (4, bucket D: part is company work) |
| H | D361 | An installable admin: a manifest, a service worker that opens the signed-in shell offline, push for new paid orders per device and store (order number and total only), switched off per device, gone with the membership; an e2e at 390 px | `platform.mobile-admin-app` (3) |
| I | D362 | A storefront API: public tokens per store and market that read the published catalogue as the market shows it and make and change a cart with the store's checks, handed to the store's checkout | `platform.storefront-api-and-headless` (2) |
| J | D363 | A custom app's tools for the AI manager: an owner registers an app's MCP endpoint with a scoped token, switches each of its tools on, read-only unless declared gated, metered, time-limited, its answers data | `ai.third-party-apps-extend-the-assistant` (1) |

A public app directory, POS, a marketplace and checkout UI extensions in code stay out (plan section 5, decisions 2, 3 and 7).

## 2. Rules for every unit

1. **Store-scoped, token-scoped.** Every outside call names one store and is refused for any other (a 404, never a hint it exists). A token
   carries scopes; an out-of-scope call is a 403 that names the scope. A token is kept only as a hash and shown once.
2. **The app's own writers.** The API, workflows and rules change data only through the functions the screens use (`saveProduct()`,
   `markSent()`, `withStockContext()` with source `api`, `addTag()`, …), so every check, audit and cache refresh is theirs. Nothing writes a
   table another way.
3. **Gates.** Anything that emails a customer, publishes, refunds or spends goes through the AI manager's gate categories: refused over the API
   (the owner does it in the admin) or kept for a yes in a workflow, never run silently.
4. **Outbound requests** go through `safeFetch()` and the address guard (`isBlockedAddress()`): no private, loopback or link-local address, a
   time limit, no redirect to one. A body is signed; a secret is encrypted with `SETTINGS_ENCRYPTION_KEY` and never logged.
5. **Limits.** Per token and per store (`takeBudget()` or a counter of its own), 429 with `Retry-After`; workflows capped per hour and per run.
6. **Money** is minor units with the ISO code, in the order's or market's own currency; a new money read gets a euro scenario.
7. **Personal data.** Events and API answers carry a customer's details only to a token or endpoint whose scope reads customers, never in a
   log; push carries no name or address; new tables are in `PERSONAL_DATA` or `NOT_PERSONAL` and in `COPY_RULES` (`never` for tokens,
   endpoints, workflows' runs).
8. **Words.** New admin words go in the area's catalogues (en and nb, D312); shopper words (checkout fields' errors, sign-up) in nb, sv, da and
   en by hand.
9. **Homer and Lisa.** Each screen opens with one clear action (Add an endpoint, Make a token, New workflow, Add a rule); the details are one
   step away.

## 3. Units in detail

- **A (D354) Events to the owner's endpoints.** `store_integrations` gains the provider `webhook` (an HTTPS address of the owner's, through the
  address guard at save and at send), a signing secret (32 random bytes, encrypted, shown once, renewable) and its topics. Every delivery has
  `Kaizena-Webhook-Id`, `Kaizena-Webhook-Timestamp` and `Kaizena-Webhook-Signature: v1={hex HMAC-SHA256 of "{timestamp}.{body}"}`;
  `verifyWebhook()` (pure, exported for receivers' docs and tests) refuses a timestamp more than five minutes old. Events gain `order.refunded`
  already there, plus `return.requested`, `withdrawal.received`, `product.created`, `product.updated`, `stock.low`, `discount.created`; each
  payload is `{ id, topic, version: 1, store, created_at, data }`. An endpoint failing every delivery for three days is switched off and its
  owners emailed; a failed delivery can be sent again from the log. Zapier, Make and Slack are unchanged.
- **B (D355) The Admin API.** `commerce.api_tokens` (store, name, scopes, hash, last used, made by, revoked), made at Settings → Apps and API
  (owners). `/api/admin/v1/{resource}` with `Authorization: Bearer kf_…`: products and variants (read, write through `saveProduct()`), stock
  (read, adjust and set through the stock writers, source `api`), orders (read; fulfil: a shipment with tracking through `markSent()`), customers
  (read, tag), discount codes (read, create). Scopes `products:read|write`, `inventory:read|write`, `orders:read|write`, `customers:read|write`,
  `discounts:read|write`. Cursor pages (`?after=`, at most 100). Every write audits `api.{resource}_{verb}` with the token's name. 120 requests a
  minute a token. A gated effect (an email to a customer by a shipment, a published product) follows the admin's rules: a shipment emails as
  the admin's does (it is the fulfilment itself), publishing a product is refused (`publish` is the owner's in the admin).
- **C (D356) Workflows.** `commerce.workflows` (trigger, conditions, actions, on, made by) and `workflow_runs` (once per event key, the path,
  each action's outcome), written only by `src/server/workflows.ts`; order rules become workflows of the trigger `order.paid` (kept working
  under their tables until moved). Triggers come from the same events as unit A. Actions run through their screens' functions; `send_request`
  is a signed POST through the address guard; `email_customer` and anything that spends are kept for a yes. At most 100 runs an hour and 10
  actions a run per workflow; a workflow's own action never triggers it again. *Test* runs a workflow on the latest matching event without
  acting (each action says what it would do). The AI manager's `draft_workflow` saves one off.
- **D (D357) Checkout rules and fields.** `commerce.checkout_rules`: a condition list (country, basket total, weight, a product, a category,
  a customer group, a tag) and one effect (`hide_shipping`, `rename_shipping`, `hide_payment_method`, `refuse` with words), evaluated by one pure
  function (`applyCheckoutRules()`) in `cartSummary()` and `placeOrder()`; a rule that throws or names what is gone is skipped and recorded
  (`checkout_rule_skips`). A rule never changes a price, VAT or a legal page. `commerce.checkout_fields`: text or checkbox, required or not, per
  language, shown in the checkout's contact piece, kept on the order (`orders.checkout_answers`), shown to staff and in the order's export.
- **E (D358) Versions and staging.** A *Compare* view for two versions of a page or the look: texts that differ, rows added, removed or moved,
  settings changed, in words (`compareVersions()`, pure). A staging copy is a hidden store (`stores.staging_of`) with copies of the site's
  pages, theme and menus, edited in its own admin; *Merge back* writes the pages, theme and menus into the live store through `savePage()`,
  `saveStoreTheme()` and the menu saver, each a new version, with redirects for moved addresses and the tags refreshed.
- **F (D359) Self-serve sign-up.** With the platform switch on, `/sign-up` makes the account and a store at once after the address is
  confirmed (a link), through `commerce.approve_access_request()`'s own path; at most 3 sign-ups an address a day and 20 a network an hour (a
  hash, never the address); the store is private until opened, has a trial of 14 days (`store_billing.trial_ends_at`) and takes no payment
  before Stripe onboarding. Every sign-up is in the audit log. Off: the request and approval as today.
- **G (D360) The status page.** `commerce.status_checks` (a component, ok or degraded, the time) written by a five-minute job from the health
  checks; `/status` (and `/no/status`) shows each component's state and a 90-day bar; `commerce.status_incidents` and their updates posted by
  platform admins; subscribers by email (confirmed) or an Atom feed. A component degraded for two checks in a row emails platform admins once.
- **H (D361) The installable admin.** `/admin/manifest.webmanifest`, a service worker scoped to `/admin` that caches the shell and answers an
  offline page; Web Push with VAPID keys (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`): `push_subscriptions` (account, store, endpoint, keys,
  device name), switched on per device and store on Your account, sent from the staff alert event `order.paid` (number and total only),
  removed on a 404 or 410 from the push service and with the membership.
- **I (D362) The storefront API.** `storefront_tokens` (store, market, name, public value, revoked) made at Settings → Apps and API;
  `/api/storefront/v1/{store}/…` with `X-Storefront-Token`: products, a product, categories (as the market shows them, `wordpressPrice()`), and
  carts made and changed with the store's own checks (`sellableQuantity()`), handed to the store's checkout (`createHandoffCart()`). Cached by
  store tag, budgeted per token.
- **J (D363) A custom app's tools.** An owner registers an MCP endpoint with a bearer token (encrypted) under Apps and API; its `tools/list` is
  read, and the owner switches tools on; the AI manager offers them as `app__{name}`, read-only unless the owner marks one gated (`public`,
  `send` or `spend`), each call through the address guard, ten seconds, metered as `custom_app`, its answer passed as data (`UNTRUSTED_TEXT`).

## 4. As built

Each unit adds its own paragraph here when it is built.

- **A (D354), built 28 October 2026.** As section 3 says, with one change: endpoints are a table of their own
  (`commerce.webhook_endpoints`), not a provider of `store_integrations`, as a store keeps up to ten of them, each with its own address,
  secret and topics; deliveries are `integration_deliveries` of provider `webhook` with an `endpoint_id`, so the queue, retries, log and
  30 days are the services'. The new topics go to endpoints only (`SERVICE_EVENTS`), so Zapier, Make and Slack are unchanged. A product saved
  twice, or made and saved in one transaction, before its delivery is built gives one delivery, which carries it as it is when sent.
  `REPLICATE_ALLOW_PRIVATE` lets the integration test reach its own local server, as the replicator's tests do.
- **B (D355), built 28 October 2026.** As section 3 says, with these choices: a change to a product is made over the API only while it is a
  draft (changing a live product is what the AI manager's gate `public` holds back, so it is refused as `gated` here); a product is made through
  the AI manager's catalogue tools (`createProductTool()`, `updateProductTool()`), which build on the editor's own blank product and read and
  save through `saveProduct()`, and takes no pictures; another store's id is a 404 (rule 1), not a 403. Stock rows name a variant by id or SKU,
  as a warehouse knows it. The movement recorder's own source list had never learnt `exchange` (D239); the migration adds it with `api`.
- **C (D356), built 28 October 2026.** As section 3 says, with these choices: order rules stay as they are (not moved into workflows); an
  email to a customer and anything that spends are left out of the actions rather than kept for a yes (a person does them in the admin);
  *Email staff* goes to those chosen for automation under Notifications and, with none chosen, to the owners; the loop guard is that no
  action makes an event a workflow waits for, with the hourly cap behind it. A note on the order is an action too.

## 5. Decisions

| # | Decision | Options | Recommendation |
|---|---|---|---|
| 1 | **The Admin API's shape** (B, I) | REST with JSON, versioned in the path; GraphQL | REST: one handler per resource over the screens' functions, easy to scope and audit; GraphQL can come later over the same functions. |
| 2 | **Custom logic** (D) | A closed list of declarative conditions and effects; WebAssembly in a sandbox | Declarative: it covers hiding and renaming options and refusing a basket, cannot loop or reach the network, and a model can draft it safely. WebAssembly only if developers ask. |
| 3 | **Self-serve sign-up** (F) | Instant with a trial behind a platform switch; keep approval | Instant behind a platform switch, off until the platform admin turns it on, a 14-day trial, private until opened. |
| 4 | **Push** (H) | Web Push from the server with VAPID keys; a push service | Web Push with VAPID keys in the environment: no third party beyond the browsers' own push services. |
| 5 | **Staging** (E) | A hidden copy of the site merged back; branches of every table | A hidden copy of the site's pages, theme and menus only: products, orders and customers are never staged. |
| 6 | **Error tracking** (G) | An EU-hosted tool now; later | Later, as the company's choice (a vendor and its DPA); the status page, checks and alerts are built now. |

**Taken (2026-10-28).** The owner asked on 28 October to continue through the remaining waves without stopping, so each recommendation above
is the one built. Any of them can be changed before its unit is built.

## 6. Company work, not software

- The status page's error-tracking vendor and its DPA (decision 6), and a restore drill recorded in `docs/runbooks/restore.md`.
- VAPID keys in the environment (H) and the support channel's people (`platform.merchant-support-channels`).
- Deciding when self-serve sign-up goes on (F), and the terms a self-serve owner accepts.
