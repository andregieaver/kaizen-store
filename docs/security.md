# Security: assets, trust boundaries and the controls that hold them

The threat model PSI asks for (SEC-01, `docs/audits/psi-2026-10-24.md`; wave 10 unit P, `docs/wave-10-must-haves.md`). Written
28 October 2026 from the code at `a1e5f117`, the audit, its re-score of the same week and `docs/pci.md`. It maps what an attacker
would want, where the lines of trust run, and for each line the control, the file that implements it and the test that holds it.
Where no test holds a control, it says so. Nothing here is a certification; the **owner should read it**, and it is kept true by the
change that alters a boundary (a new external interface, a new kind of token, a new place a model reads outside text).

Related: `docs/pci.md` (the pay routes and the card form), `docs/wave-1-trust.md` (two-step, roles), `docs/runbooks/breach.md` (what
to do when something here fails), `docs/runbooks/restore.md` (backups), `docs/residency-register.md` (where data goes).

---

## 1. Assets

| Asset | Where it lives | Why it matters |
|---|---|---|
| **Shoppers' personal data** | `commerce` tables listed in `PERSONAL_DATA` (`src/lib/personal-data.ts`: customers, orders and their addresses, carts, support conversations, reviews, subscribers, checkout answers, email copies in `email_messages`, ...); private buckets `documents`, `exports`, `imports`, `digital-files`, `review-pictures` | Each store is the controller and Kaizena Flow its processor (DPA in `src/lib/platform-legal/en.ts`); a leak is a breach for every store it touches |
| **Owners' and staff's personal data** | `accounts`, `store_members`, `access_requests`, `audit_log` (ids only), AI manager conversations and memories (`assistant_messages`, `assistant_memories`); Supabase Auth (passwords as hashes, TOTP factors) | Kaizena Flow is the controller; an account reaches every store it is a member of |
| **Payment facts** | `payments`, `refunds`, `payment_disputes`, `payouts` (Stripe's references, method, brand, risk; never a card number) | Card data never reaches Kaizena Flow (`docs/pci.md`, `src/lib/no-card-fields.test.ts`); what is held is enough to defraud or embarrass |
| **Secrets and tokens** | Vercel environment (section 4) and, encrypted with `SETTINGS_ENCRYPTION_KEY`, the database (Stripe webhook secrets, Mollie and Kaizen Life OAuth tokens, carriers' keys, AI and search keys, owners' webhook endpoints and custom apps, ad tokens); hashes of tokens handed out (Admin API, WordPress, preview links, support links, gift card codes, recovery codes) and the storefront API tokens, public by design | One key opens the rest; a leaked token acts as its holder |
| **Stores' content and settings** | Pages, themes, products, prices, menus, legal pages, custom code (`stores.custom_code`) | Defacing a store, changing a price, or putting a script in front of its shoppers |
| **The platform's money** | Plans and invoices on Kaizena Flow's Stripe account (`src/server/billing.ts`), the sale fee (`application_fee_amount`), theme purchases, referral credits, AI spend on Kaizena Flow's key (`ai_usage`) | Fees can be avoided, credits minted, or the AI bill run up |
| **Availability** | Vercel functions in `dub1`, Supabase `eu-west-1`, the scheduled jobs | A store that cannot sell loses money by the hour |

## 2. Who can act, and the lines between them

```
 Visitor / shopper ──(storefront, chat, forms, APIs a store opens)──┐
 Shopping agent, headless front end, WordPress site ──(tokens)──────┤
 Store staff by role ─┐                                             │
 Store owner ─────────┼──(admin, AI manager, Admin API)──────────── Kaizena Flow (Vercel dub1) ──── Supabase (commerce schema)
 Platform admin ──────┘                                             │
 Models (chat, support, AI manager, autopilot) ── text from anyone ─┤
 Stripe, Mollie, Resend, Vercel drain ──(signed or re-fetched)──────┤
 Owners' endpoints, custom apps, carriers, search, AI providers ◄───┘ (outbound, through safeFetch() or fixed hosts)
```

Every boundary below names the attacker it is drawn against, the controls, and the test. *Int* means an integration test
(`pnpm test:int`, against a real database); *scan* a test that reads the source tree and fails a new file that skips the rule.

### 2.1 The database's own door (everyone)

The app reaches data only through `DATABASE_URL` (`src/db/client.ts`). Supabase's Data API (PostgREST) is the door an attacker with
the public publishable key would try.

| Control | Where | Held by |
|---|---|---|
| Every `commerce` table has row-level security on and no policy, so the Data API is deny-all | migrations | `src/db/commerce.test.ts` (describe "row-level security", every migration applied to PGlite) |
| No grants on `commerce` to `anon`/`authenticated`; `commerce` not among the exposed schemas | migrations; Supabase dashboard | **No test.** Checked by hand on a migrated local database in the audit (24 October) and its re-score (28 October); production's grants and the dashboard's exposed-schemas setting were not checked |
| `public.rls_auto_enable()` EXECUTE revoked from the API roles | `supabase/migrations/20261024213329_revoke_rls_auto_enable.sql` | **no test found** in `src` (`docs/audits/psi-followups.md` says it was tested when made) |
| Public buckets, where anyone with a file's address can fetch it: `product-media`, `product-models`, `page-videos`, `field-files` and `avatars` (people's profile pictures); `documents`, `exports`, `imports`, `digital-files`, `review-pictures` are private and served by the server | bucket migrations (`supabase/migrations/*_bucket*.sql`, `*_rules.sql`) | the routes' own int tests (e.g. `src/server/review-pictures.int.test.ts`); no single test lists the buckets |

### 2.2 Other stores (tenancy)

Attacker: a member of store A, or a shopper of store A, reaching store B's data.

| Control | Where | Held by |
|---|---|---|
| Every store admin page, action and route asks `requirePermission()`/`checkPermission()` (or a listed guard) with its area's key; a non-member or a missing key is a 404 | `src/server/permissions.ts`, names in `src/lib/permission-guards.ts` | `src/lib/permissions.scan.test.ts` (against `permissions.baseline.json`), `permissions.matrix.test.ts`, `permissions.test.ts`, `src/server/permissions.int.test.ts`, `e2e/signed-in/permissions.spec.ts` |
| Actions take the store slug as a bound first argument, so a form cannot name another store | `src/app/admin/(gated)/[store]/**/actions.ts` | the same scan |
| Every store-owned query takes the store id | a convention (CLAUDE.md) | **No single test.** Many int tests try another store's ids (e.g. `admin-api.int.test.ts` "another store's ids", `edit-pass.int.test.ts` "is no pass for another store", `privacy-erasure.int.test.ts` cross-store cases) |
| A closed or suspended store's members may only read and handle what already happened | `memberCan()` and `allowedWhenNotOpen()` (`src/lib/store-closure.ts`) | `src/server/store-closure.int.test.ts` |
| An expired collaborator is no member | readers of `store_members` | `src/server/store-members-expiry.test.ts` |
| A copied store gets no secret, payment account, domain or AI key | `COPY_RULES` (`src/lib/store-copy-rules.ts`), `commerce.duplicate_store()` | `src/lib/store-copy-rules.test.ts` |
| A store's own code runs only on the store's own host, never on Kaizena Flow's, where the admin's session is | `liveCustomCode()` (`src/lib/custom-code.ts`) | `src/lib/custom-code.test.ts` |

### 2.3 Shoppers and visitors

Attacker: anyone on the internet, including a shopper of the store.

| Control | Where | Held by |
|---|---|---|
| Card details go only to Stripe's form; pay routes send a strict CSP and draw no owner code, chat or consent manager; every entry is a full page load | `src/lib/csp.ts` (`checkoutCsp()`), `src/lib/pay-routes.ts`, `OffPayRoutes` | `src/lib/no-card-fields.test.ts`, `src/lib/csp.test.ts`, `src/lib/next-config-headers.test.ts`, `src/lib/pay-routes.graph.test.ts`, `e2e/csp.spec.ts` |
| Owner HTML is never drawn as HTML: rich text, inline markup, CSS and custom code go through their cleaners | `cleanRichText()` (`src/lib/page-content.ts`), `<Inline>` (`src/lib/inline-text.ts`), `cssProblem()` (`src/lib/custom-css.ts`) | `src/lib/inline-text.test.ts`, `src/lib/custom-css.test.ts` and the page-content tests |
| Routes acting for a signed-in person or a visitor refuse another site's request | `sameSite()` (`src/lib/same-site.ts`) on the chat, forms, blog comments, speed, private-store and editor routes | the routes' int tests; **no scan** lists which routes must call it |
| Shopper sign-in codes: five tries a code, a lockout; a session is *fresh* only after a proof, and export or deletion needs a fresh one | `src/server/customers.ts` | `src/server/session-freshness.scan.test.ts`, `src/server/customers.int.test.ts` |
| A shopper's own data only: a support conversation found only by its token's hash on its own site; an order in support only among the signed-in customer's own | `visitorConversation()` (`src/server/support.ts`), `src/server/support-tools.ts` | `src/server/support.int.test.ts`, `support-tools.int.test.ts` |
| Budgets on costly public endpoints: search suggestions, feeds, private-store passwords, the shopping agents' endpoint, the Admin and storefront APIs | `takeBudget()` (`src/server/request-budget.ts`) | `src/server/request-budget.int.test.ts` |
| Chat turns counted before any model call | `takeTurn()` (`src/server/chat-route.ts`) | `src/server/chat.int.test.ts` |
| A private store's pass is HMAC-signed with a derived key, compared in constant time, bound to the store's own host | `src/lib/unlock-pass.ts`, `src/server/private-mode.ts` (`lockedOut()`) | `src/lib/unlock-pass.test.ts`, `src/server/private-mode.int.test.ts`, `e2e/private-mode.spec.ts` |
| Everything a visitor or a person points the server at is fetched through the address guard: public addresses only, the checked address connected to, each redirect checked, size and time limited | `safeFetch()` and `hostProblem()` (`src/server/replicate-fetch.ts`), `parseReplicaUrl()`/`isBlockedAddress()` (`src/lib/replicate-url.ts`) | `src/server/replicate-fetch.test.ts`, `src/lib/replicate-url.test.ts` |
| `X-Content-Type-Options: nosniff` on every response | `SITE_HEADERS` (`src/lib/csp.ts`) | `src/lib/next-config-headers.test.ts` |

### 2.4 Store staff, by role, and the owner

Attacker: a member who wants more than their role gives, a removed member, or someone with a member's password.

| Control | Where | Held by |
|---|---|---|
| Roles are permission keys; owner-only areas need the `owner` key | `src/lib/permissions.ts`, `store_roles` | the permission tests in 2.2 |
| The session is verified on every request from the signed token (`getClaims()`), the second step from the signed `aal` claim or a server-side `getUser()`, never the cookie's user; a disabled account (`accounts.disabled_at`) is no one at once | `readSession()` (`src/server/auth.ts`) | `src/server/account-gate.int.test.ts` ("never reads the cookie's own copy of the user", "a disabled member and a closed store are not members"), `src/server/two-step.int.test.ts` |
| Two-step: TOTP, tries reserved under a lock before a code is checked, ten single-use recovery codes kept as HMACs | `src/server/two-step.ts` (`reserveAttempt()`), `src/server/recovery-codes.ts` | `src/lib/two-step.test.ts`, `src/server/two-step.int.test.ts`, `src/lib/recovery-codes.test.ts` |
| Password sign-in: 10 wrong tries in 15 minutes stop it for that address, counted under a keyed hash for every address alike; passwords at least 12 characters, not the email | `src/server/sign-in-limit.ts`, `src/lib/password.ts` | `src/server/sign-in-limit.int.test.ts`, `src/lib/password.test.ts` |
| Closing a store needs a sign-in from the last ten minutes | `signedInRecently()` (`src/server/auth.ts`), `closeStore()` | `src/server/store-closure.int.test.ts` |
| The activity log is append-only, 24 months, written with who acted (`person`, `ai_manager`, `autopilot`), never a secret or an email | `audit()`/`auditChange()` (`src/server/audit.ts`), `commerce.guard_audit_log()` | `src/server/privacy-audit.scan.test.ts`, `src/lib/audit.test.ts`, `src/server/audit-coverage.int.test.ts` |
| An Admin API token is the owner's, scoped per route, shown once and kept as a SHA-256; each call reads the maker's membership again and refuses once they are no longer the owner | `src/server/api-tokens.ts` (`apiCaller()`), `src/lib/admin-api.ts`, `src/server/admin-api.ts`; route `src/app/api/admin/v1/[...path]/route.ts` | `src/lib/admin-api.test.ts`, `src/server/admin-api.int.test.ts` |
| Editing words on the live site from a store's own domain goes on a signed, 30-minute HttpOnly pass whose cookie is sent only to the editing routes under `/api/platform/editor`, read again against the person's access on every call | `src/lib/edit-grant.ts`, `src/server/edit-pass.ts`, `checkPassPageTypeAccess()`, `checkPassPermission()` | `src/lib/edit-grant.test.ts`, `src/server/edit-pass.int.test.ts`, `src/app/api/platform/editor/pass-routes.test.ts` |
| Order, customer and privacy exports are owner-only (customer data export `customers:write`), never emailed, deleted after 7 days | `src/server/data-jobs.ts`, `src/server/privacy-export.ts` | `src/server/data-jobs.int.test.ts`, `privacy-export.int.test.ts` |

### 2.5 Platform admins

Attacker: anyone who gets a platform admin's sign-in, since one such account can change every store's plan, suspend any store and
reach Kaizena Flow's own site and settings.

| Control | Where | Held by |
|---|---|---|
| Platform admins must have the second step; without `aal2` they are no one | `getAccount()`, `src/lib/two-step.ts` | `src/server/account-gate.int.test.ts`, signed-in e2e through the real two-step page (`e2e/signed-in/`) |
| Platform admin pages ask `requirePlatformAdmin()` | `src/server/auth.ts` | **no scan** comparable to the store's; `src/lib/platform-nav.test.ts` checks pages are listed, not that they are guarded |
| Platform admins never read a store's support conversations; the platform's per-store support figures are counted columns only | `src/server/support-platform.ts` | `src/server/support-platform.scan.test.ts` |
| A platform admin enters a store's admin only as a member of it (`loadMembership()` has no platform bypass) | `src/server/auth.ts` | `src/server/account-gate.int.test.ts` (membership cases), `src/server/permissions.int.test.ts` |
| The break-glass `ADMIN_TWO_STEP=off` lifts the second step for everyone; each account that signs in while it is on is written to the log (`account.two_step_switch_off`, once in 12 hours) | `src/server/auth.ts`, `KILL_SWITCH_ACTION` in `src/lib/two-step.ts` | `src/server/account-gate.int.test.ts` |

The real top of the trust chain is whoever holds the Vercel project, the Supabase project (`ybsozesfuxuitoacntfo`), `DATABASE_URL`,
Stripe's platform account and the GitHub repository (pushing to `main` deploys, `CLAUDE.md`). **No list of those people, or of their
two-step status, is in the repository** (PSI SEC-09).

### 2.6 Visitor-facing AI (the chat, AI-first support, email answers)

Attacker: a visitor who writes instructions into the chat, or anyone whose words reach the model through a product text, a page,
a knowledge document or an inbound email.

| Control | Where | Held by |
|---|---|---|
| Every system prompt says outside text is data, never instructions | `UNTRUSTED_TEXT`/`RULES_STAND` (`src/lib/prompt-safety.ts`) | `src/lib/prompt-safety.scan.test.ts` |
| The model states only what tools return; tools read the site's own data; an order only among the signed-in customer's own; no tool needs an email typed in the chat | `systemPrompt()` (`src/lib/chat.ts`), `storeTools()`, `supportToolsFor()` (`src/server/support-tools.ts`) | `src/lib/chat.test.ts`, `src/server/support-tools.int.test.ts` |
| The answer is plain text: no Markdown, no written web address, no green, urgency or best-price claim; links are buttons made by code | `cleanReply()` (`src/lib/chat.ts`), `findClaims()` (`src/lib/claims.ts`), `SupportChip` | `chat.test.ts`, `claims.test.ts` |
| A customer action the AI proposes runs only on the customer's own Confirm, once, for the signed-in customer; refunds, cancellations and exceptions go to a person | `src/server/support-actions.ts` | `src/server/support-actions.int.test.ts` |
| By email nobody is signed in: no tool that needs a customer or a button | `NOT_BY_EMAIL` (`src/server/support-tools.ts`) | `src/server/support-inbound.int.test.ts` |
| An injection eval plays the chat and the AI manager with their real prompts and tools on scripted answers that hide instructions | `src/lib/agent-eval.ts`, `src/server/agent-eval.ts` | `src/lib/agent-eval.test.ts` (the cases exist); **the eval itself is run by hand from Platform → AI, not in CI** |

### 2.7 The AI manager, the autopilot and the store's MCP server

Attacker: text in the store's own data (a customer's note, a product imported from a file, a web page read for research, an owner's
custom app's answer) that tries to make the manager act; or a member using the manager to do what their role does not allow.

| Control | Where | Held by |
|---|---|---|
| Each tool call is checked against the member's role and the store's features before it runs | `requireToolPermission()`, `mayUseTool()` (`src/lib/owner-tool-permissions.ts`), `toolOffered()` | `src/lib/owner-tool-permissions.test.ts`, `src/server/owner-tool-permissions.int.test.ts` |
| A tool that emails, publishes, spends or changes who has access is only kept (`assistant_approvals`) and runs on the person's yes; a yes in words is checked on the person's own message | `keepForApproval()` (`src/server/owner-assistant.ts`), `decide_approval` | `src/server/owner-assistant.int.test.ts` ("keeps a change for the owner's yes, and runs exactly that call once approved") |
| The autopilot runs a gated call only as the owner's autonomy level and budgets allow; some tools are never automatic | `autopilotDecision()` (`src/server/autopilot-gate.ts`), `autonomyDecision()` and `NEVER_AUTOMATIC` (`src/lib/autopilot-autonomy.ts`) | `src/lib/autopilot-autonomy.test.ts` ("every gated tool has a place", "never runs what is never automatic") |
| Background work runs in the maker's name, read again each time (`passMembership()`), so a removed member's plans stop | `src/server/autopilot-runner.ts`, `src/server/follow-up-runner.ts` | `src/server/autopilot-runner.int.test.ts` |
| Kaizen Life's MCP (`/api/mcp`) takes only Kaizen Life's client's unexpired tokens for an owner, `aal2` for a platform admin or a store that requires two-step; changes are kept for the owner's approval in the store's admin | `src/server/store-mcp.ts` | `src/server/store-mcp.int.test.ts` |
| A custom app's tools are offered only to owners, never in an autopilot step; only `read` tools run without a yes; the app's answer is text only, as data | `appToolsFor()`, `callAppTool()` (`src/server/custom-apps.ts`) | `src/lib/custom-apps.test.ts`, `src/server/custom-apps.int.test.ts` |
| Web pages the manager reads go through `safeFetch()`; searches only to the configured service's one host | `src/server/research.ts`, `searchHostOk()` (`src/lib/web-search.ts`) | `src/lib/research.test.ts`, `src/server/research.int.test.ts` |
| Memory learned from a turn refuses anything with an `@`, a long number or a password, and the prompt forbids customers' personal details (names are not refused by code) | `readLearned()` (`src/server/assistant-memory.ts`) | `src/server/ai-manager.int.test.ts` (learning and fading); **no test of the refusal itself** |

### 2.8 Inbound calls from services

Attacker: anyone posting to a webhook address.

| Caller | Control | Held by |
|---|---|---|
| Stripe (Connect, account notifications, billing; legacy per-store keys) | `constructEvent()` / `parseEventNotification()` with per-mode secrets kept encrypted in `platform_webhooks` (`getPlatformWebhookSecret()`, `src/server/connect.ts`); handlers idempotent; the endpoints' addresses follow the site's own (`keepStripeWebhooksCurrent()` in the five-minute dispatcher, D406: until 29 October they pointed at the old domain, which answers 308, and Stripe follows no redirect, so no event arrived) | `src/server/checkout.int.test.ts` ("refuses an event with a wrong signature", "refuses bad signatures"), `billing.int.test.ts`, `stripe-endpoints.int.test.ts`; the `webhooks` live drill checks production (D406) |
| Mollie | The body names only a payment id; the payment is always fetched from Mollie with the store's token before anything changes (`handleMollieWebhook()`, `src/server/payment-providers/mollie.ts`) | `src/server/mollie.int.test.ts` |
| Resend (delivery events, inbound support email) | svix signature with `RESEND_WEBHOOK_SECRET`; off (503) without it (`src/app/api/resend/webhook/route.ts`, `verifyEmailEvent()`) | `src/server/email-events.int.test.ts`, `support-inbound.int.test.ts` |
| Vercel log drain | HMAC with `USAGE_DRAIN_SECRET`, constant-time compare; keeps no IP, user agent, path or query (`src/app/api/usage/drain/route.ts`, `src/lib/usage-drain.ts`) | `src/lib/usage-drain.test.ts` |
| Scheduled jobs | `Bearer` `CRON_SECRET` or the Vault secret `kaizen_cron_secret`, constant-time compare (`src/server/cron-auth.ts`) | `src/server/cron-routes.scan.test.ts` (every cron route runs inside `trackedRoute()`); `src/app/api/cron/subscription-reminders/route.test.ts` checks that route asks `cronAuthorised()` first; no test of the comparison itself |
| Carriers | **No inbound webhook**: tracking is polled (`pollTracking()`) and labels fetched from the carriers' own hosts only | `src/lib/bring.test.ts` and the other carriers' unit tests |

### 2.9 Outbound: interfaces the platform opens to others

| Interface | Who holds the key | Controls | Held by |
|---|---|---|---|
| Owners' webhook endpoints (D354) | the owner sets an https address | address checked at save (`checkEndpointUrl()`, `hostProblem()`), sent through `safeFetch()` with no redirect, HMAC-SHA256 over timestamp and body, address and secret encrypted (`src/server/webhook-endpoints.ts`, `src/lib/webhook-signature.ts`) | `src/lib/webhook-signature.test.ts`, `src/server/webhook-endpoints.int.test.ts` |
| Admin API (D355) | the owner's token | see 2.4 | as 2.4 |
| Storefront API (D362) | a public per-store token (it is meant to sit in a browser) | answers only what a visitor of the token's market sees, never an order or a price of its own (`asStorefront()`, `storefrontProblem()`); 404 for a private or closed store; budget `storefront` | `src/lib/storefront-api.test.ts`, `src/server/storefront-api.int.test.ts` |
| Shopping agents' MCP (D353) | none (public) | answers only while `agentProblem()` finds nothing, from the storefront's own reads; hands over a cart, orders and pays nothing, keeps nothing of a person; budget `agent` (`src/server/shopping-agents.ts`) | `src/lib/shopping-agents.test.ts`, `src/server/shopping-agents.int.test.ts` |
| Owners' MCP apps (D363) | the owner's endpoint and token, encrypted | see 2.7 | as 2.7 |
| WordPress API (D169) | a site approved by the owner; tokens kept as hashes | `asPlugin()` reads the account's membership on every call; read-only, what a shopper sees (`src/server/wordpress-route.ts`, `src/server/wordpress.ts`, `readApproval()` in `src/lib/wordpress.ts`) | `src/lib/wordpress.test.ts`, `src/server/wordpress.int.test.ts` |
| Kaizen Life's MCP (D96) and the owner's link to Kaizen Life | Kaizen Life's OAuth client; the owner's tokens encrypted in `kaizen_life_links` | see 2.7; `src/server/kaizen-life-link.ts` | `src/server/store-mcp.int.test.ts`, `src/server/kaizen-life-link.int.test.ts` |
| AI providers | Kaizena Flow's key or the store's own, encrypted in `ai_providers` | `aiFor()` (`src/server/ai.ts`); every call metered (`metered()`); a store's own provider only at a public https address | `src/server/ai.int.test.ts`, `ai-usage.int.test.ts` |
| Web push (D361) | VAPID keys in the environment | only to a push service's host (`isPushEndpoint()`, `src/lib/push.ts`), no customer data in a push | `src/lib/push.test.ts` |

## 3. Data that leaves for good

Some things, once out, cannot be called back: a broadcast sent, a webhook delivered, an Admin API read, a CSV downloaded, a prompt
sent to a provider. The controls are the gates in 2.7 (sending and spending wait for a person), owner-only tokens and exports (2.4),
erasure that refuses personal fields in files (`removePersonalExports()`, `src/server/data-jobs.ts`), and providers listed in
`docs/residency-register.md` before they touch production data (D10). The register is behind the code today (section 6).

## 4. Secrets: what each one opens

| Secret | Where | What it opens | Notes |
|---|---|---|---|
| `DATABASE_URL` (and `READ_DATABASE_URL` when set) | Vercel | everything in `commerce`, bypassing every control above | the highest-value secret |
| `SETTINGS_ENCRYPTION_KEY` | Vercel | decrypts every secret in the database (`src/lib/secret-box.ts`: AES-256-GCM, format `v1.<iv>.<tag>.<ciphertext>`, **no key id**); keys HMACs and signatures derived per use: recovery codes, gift card codes, sign-in buckets, edit passes, unlock passes, visit hashes, signup and comment buckets, the avatar proxy | rotating it is not a deploy: see section 6 and `docs/runbooks/breach.md` |
| `SUPABASE_SECRET_KEY` | Vercel | Supabase admin API and Storage (`src/server/supabase-admin.ts`, `media.ts`, `invoice-storage.ts`, `data-job-store.ts`, `review-picture-store.ts`) | private buckets |
| `STRIPE_SECRET_KEY_{TEST,LIVE}` | Vercel | Kaizena Flow's Stripe platform account, and through Connect every store's payments | |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | Vercel | sending email as every store; trusting delivery and inbound events | |
| `CRON_SECRET`, Vault `kaizen_cron_secret` | Vercel, Supabase Vault | running any scheduled job at will | |
| `MOLLIE_CLIENT_SECRET`, `SLACK_CLIENT_SECRET`, `KAIZEN_LIFE_OAUTH_CLIENT_SECRET` | Vercel | the OAuth apps | the tokens they got are in the database, encrypted |
| `VERCEL_API_TOKEN`, `VERCEL_DEPLOY_HOOK_URL` | Vercel | domains and deploys of the project (`src/server/vercel.ts`) | |
| `DOMAIN_CONNECT_PRIVATE_KEY`, `VAPID_PRIVATE_KEY`, `USAGE_DRAIN_SECRET` | Vercel | Domain Connect signatures, push, the drain | |

No secret is in the repository (PSI SEC-06: HEAD and history scanned; `.env*` ignored except `.env.example`, which holds only public
values). `sendEmail()` keeps codes out of the log (`secrets`, `src/server/email.ts`). Tokens handed out are kept as hashes only and
shown once (Admin API, WordPress, preview, support, invitation and hand-off links); the storefront API's tokens are public by design and kept
as they are (`storefront_tokens.token`).

## 5. Logs and what they can tell after the fact

| Source | Holds | Kept |
|---|---|---|
| `commerce.audit_log` | who (account, `acted_by`), store, action, area, target id; sign-ins, two-step events, break-glass use, API token use, exports | 24 months (`pruneAuditLog()`) |
| `commerce.email_messages` | every email sent, with address and body, and Resend's delivery events | bodies 12 months, then blanked |
| `commerce.ai_usage` | every model call: store, feature, account, tokens, cost; never the text | 400 days |
| `commerce.cron_jobs` | each job's last run, last success and last error (one row a job, not a history) | overwritten by the next run (`src/server/cron-runs.ts`) |
| Vercel runtime logs (`log()` lines: ids and counts only, `src/server/log.ts`) | errors and events | Vercel's plan; **not recorded here** |
| Supabase logs (Auth, Postgres, API) | sign-ins, failed queries, Data API calls | Supabase's plan; **not recorded here** |
| The usage drain | counts per store and day only | it cannot say who or what |

Not logged today: individual failed password sign-ins in the audit log (only the lock, as a `log()` line `admin_sign_in.locked`), and
permission denials (`src/server/permissions.ts` writes nothing). PSI SEC-11.

## 6. Known gaps, and what would close each

From the audit (24 October) and its re-score (28 October), checked again in the code at `a1e5f117`.

| Gap | Risk | What would close it |
|---|---|---|
| **No key id and no rotation for `SETTINGS_ENCRYPTION_KEY`** (SEC-06). `decryptSecret()` knows one key; a new key makes every stored secret unreadable at once. Gift card codes are kept only as HMACs under a key derived from it (`src/server/gift-card-codes.ts`), and the codes are never kept, so a new key loses every card's code for good; recovery codes likewise | a leaked key stays useful, or rotating it breaks payments, carriers, AI and gift cards | A `kid` in the format (`v2.<kid>.…`), reading with the old and new key during a window, a re-encrypt job over the tables in section 4, a gift-card hash kept under a key of its own that does not change with this one, and a written rotation procedure |
| **Script CSP only on the pay routes**, with `'unsafe-inline'` (SEC-05); the admin sends only `frame-ancestors`; the storefront and Kaizena Flow's pages send none | an injected script runs anywhere else | A nonce-based CSP, Report-Only first, on `/admin`, then the storefront |
| No `Permissions-Policy`; HSTS is Vercel's default without `includeSubDomains`; storefront and platform pages may be framed (SEC-07) | clickjacking of storefront pages | the headers in `baseRouteHeaders()` (`src/lib/csp.ts`) |
| `requireToolPermission()` treats a missing `holder` as an owner (`src/server/owner-tools.ts`) (SEC-03) | a new caller that forgets the holder runs with the owner's rights | make `holder` required in `OwnerToolContext` |
| No CI check that `commerce` keeps no grants to the API roles and stays out of the exposed schemas (SEC-03) | a dashboard change opens the Data API | a CI query on `pg_namespace`/grants, or the Supabase advisor |
| `takeBudget()` and the sign-in limit **fail open** on a database error; `/api/consent` and `/api/ab/*` have only a size cap (SEC-10) | password guessing on a private store while the database is struggling; cheap writes inflated | fail closed for `unlock` and sign-in; budgets on the four routes |
| Failed sign-ins and permission denials not in the audit log (SEC-11) | an attack is hard to see afterwards | log `account.sign_in_failed` under the hashed key, and denials |
| 86 `sql.raw` sites, all checked by hand, none held by a test (SEC-04) | a new one built from input | a scan test listing them |
| The agent safety eval's recording is not yet in the repository, so CI replays nothing (SEC-12); the last live runs (26 October) passed 5 of 13, 7 of the failures the tool limit since fixed (D333) | a prompt change weakens it unseen | the `agent_eval` live drill (D406) runs it on the platform's model and keeps the recording; commit it as `src/data/agent-eval-recording.json` |
| `/api/health` names the database host and connection mode to anyone (`src/lib/health.ts`) | a small information leak | drop the two fields from the public answer |
| No list of who holds production access, or their two-step (SEC-09); PITR off, Storage not backed up (`docs/runbooks/restore.md`) | an unknown person can reach everything; files lost for good | the list, and the daily bucket copy |
| A platform account can be disabled only by SQL (`accounts.disabled_at`; no screen sets it) | slower containment | a platform action that disables an account and signs it out |
| The `audit` job in CI reports and never blocks; no Dependabot (SEC-08) | a vulnerable dependency ships | Dependabot, and the job in a deploy's `needs` |
| No passkeys | phishing of a password and TOTP | WebAuthn for platform admins first |
| `docs/residency-register.md` lists every DPA as to do, the platform's AI as direct OpenAI in the US, and misses Brave Search (D329), Resend's inbound mail (D332) and carriers (PSI REG-06) | data leaves without a contract | sign the DPAs and bring the register up to date |
| Readers that asked `payments.test_mode` for a Stripe payment's mode (always false: its mode is its account's) sent test purchases to ad platforms as real and counted test orders as obligations (fixed 29 October, `testPayment()`) | test data treated as real money | every reader goes through `testPayment()` (`src/server/payment-mode-sql.ts`); a scan test for the pattern is still to write |
