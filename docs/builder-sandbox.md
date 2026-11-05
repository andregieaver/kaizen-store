# The page builder sandbox: try it without signing up

Status: **step S1 built** (D456, 5 November 2026), behind its platform switch, which is off; S2 to S4 follow (section 8). The owner's
choices of 5 November 2026: **no email at all** to start, and the recommendations of section 10.
A visitor presses *Try the builder* and is in the real builder, on a store of their own. An email is asked only when they choose to keep
that store, because an account is an email (`accounts.email` is not null).

## 1. What it is for

A store owner who has not signed up should feel the page builder before deciding: the real builder, not a video or a mock-up, on a store
that already looks finished, with every component, the Theme tab, text styles, versions, responsive editing, motion and the AI. When they
like what they made, *Keep this store* turns the sandbox into their store, with the 14-day trial self-serve sign-up gives (D359, D420),
so nothing they made is lost.

## 2. What the visitor sees (Homer first)

1. On kaizenaflow.com, *Try the builder* (and, on a theme's page in the theme store, *Try it with this theme*).
2. One screen with one button, *Start building*, and a line saying the store is theirs for 7 days, seen only by them, and needs no sign-up.
   The button is a form post, never a link, so a crawler or a link preview makes nothing (the pattern of `/sign-up/confirm/{token}`).
3. Two seconds later, the front page of a finished-looking store, open in the builder in the Basic view (D454), with a short guided path
   beside it: *Change the headline*, *Add a section*, *Try another look*, *See it on a phone*. Each step is skippable and none needs reading.
4. A bar that stays at the top: *Keep this store* (the main action once they have changed something), *Start over*, and how long the
   sandbox has left.
5. Lisa's depth one step away, as everywhere: Advanced view, own CSS, versions, per screen size, the header and footer.

The sandbox follows the browser's language for the admin (`ADMIN_LANGS`: English or Norwegian, D312) and the device's light or dark.

## 3. What it is built from

Most of the sandbox already exists; what is new is the way in, the limits and the cleanup.

- **The builder takes everything through one context.** `PageOwnerContext` (`src/components/admin/page-context.ts`) carries every save,
  upload, AI call and grid preview as a function. It already serves seven owners: a store's pages (`storePageContext()` in
  `src/app/admin/(gated)/[store]/pages/context.ts`), Kaizena Flow's own, a design profile's workspace (`draftOnly`), a theme's workspace,
  the staging set's copy (D358), an A/B test's version (D148) and the theme store's pages (`place`). The sandbox is an eighth.
- **A store is made in one statement.** `commerce.clone_store(source, slug, name, owner)` copies a template's pages, products, menus,
  theme, saved parts and terms (not its orders: `copy_orders()` is separate), with product pictures shared by address, not copied. Self-serve
  sign-up, demo stores (D277) and theme content (D275) all use it, with `commerce.starter_source()` choosing what may be copied.
- **A store can be private.** Private mode (D339) shows a visitor without a pass only the landing page; a `staff` unlock pass
  (`mintUnlock()` in `src/server/private-mode.ts`, signed by `src/lib/unlock-pass.ts`) lets one browser in for 12 hours.
- **The preview is drawn in the admin.** `PageDrawing` (`src/app/admin/(gated)/[store]/pages/drawing.tsx`) draws a draft in the store's
  theme, as the store's own *Preview* does.
- **Budgets and limits exist.** `takeBudget()` (`src/server/request-budget.ts`) counts a visitor and the whole platform per endpoint, keyed
  by hashes, never the address; per-store limits (D314, `src/server/limits.ts`) cap storage (`storage_bytes`, checked by
  `storageRefusal()`) and AI on Kaizena Flow's key (`ai_cost_month_micros`: `aiFor()` returns no connection once a store has no room left,
  so every AI feature stops by itself).
- **Sign-up exists.** `startSelfSignup()` and `confirmSelfSignup()` (`src/server/self-signup.ts`) make an account and a store from a
  confirmed email, private until opened, with a 14-day trial (`grantTrial()`, `src/server/store-trial.ts`).

## 4. The design

### 4.1 A sandbox is a store of its own

Each sandbox is a real store, made for one visitor and never given to another, so nobody can ever see another visitor's work.

- **Made by** `commerce.make_sandbox()`: `clone_store()` from the sandbox's source, at an address of `try-` and eight random letters and
  digits, owned by one platform account, *Kaizena Flow sandbox*, which is disabled (`accounts.disabled_at`), so `signInAccount()` never
  admits it. The visitor is never a member: their pass is their only key (4.2). The source is a demo store (D277) a platform admin offers in
  the sandbox (*Offer in the sandbox* on the demo store's page), else the Standard store; *Try it with this theme* starts from that theme's demo
  store.
- **Marked** by a new column, `stores.sandbox` (true only when made, false only through `adopt_sandbox()`, 4.7, both checked by a rule),
  and a row in `commerce.sandboxes` (4.8).
- **Not a template.** `starter` would be wrong three times over: template stores are public, exempt from limits, and can never be private
  (`src/server/stores.ts:301`). A sandbox is the opposite of all three.
- **What the database refuses for a sandbox store:** private mode off, a host or domain (D71, D317), payments on, an order
  (`orders_store_open()`), and any member but the sandbox account.
- **Every website feature on** (D178), so the builder offers every part.

### 4.2 The way in: a pass, not an account

The admin admits only signed-in accounts (`(gated)/layout.tsx`), and an account needs an email. So the visitor does not enter the admin:
they hold a **sandbox pass** for one sandbox.

- *Start building* (`/admin/try`, a form post) takes a budget first: a new `sandbox` entry in `BUDGETS`, a few an hour from one network and
  a ceiling for the whole platform, in `FAIL_CLOSED` (making a store costs, so a failed count refuses). Past it, and past the platform's
  daily cap, the page says to try again later. The whole feature is behind a platform switch, off until step S3 (section 8).
- The pass is a cookie, `kaizen_sandbox`: the sandbox's id and 32 random bytes, HttpOnly, Secure, SameSite Lax, path `/admin/try`. Only
  the bytes' SHA-256 is kept (`commerce.sandboxes.pass_hash`), compared in constant time, as self-serve keeps its confirm links. It lives
  as long as the sandbox and is strictly necessary, so it needs no consent (D58).
- One sandbox per browser at a time; *Start over* replaces it (4.8).
- The sandbox's address (`/admin/try/{sandbox}`) opens nothing without the pass, so there is nothing to share.
- `sandboxFor(id)` (`src/server/sandbox.ts`) is the only way in for every sandbox page, action and route: it reads the pass, checks the
  sandbox is open and not past its time, touches `last_seen_at` (at most once a minute) and returns the store and the sandbox account to act
  as. A scan test fails for an exported sandbox action or route that does not call it first.

### 4.3 The sandbox's own editor

The sandbox lives at `src/app/admin/try/…`, outside `(gated)`: it has the admin's root layout and look (`src/app/admin/layout.tsx`,
`admin.css`) and its own layout with the admin's text provider, but no gate and nothing of the account (no stores list, no control
centre, no AI manager, no billing). `try` becomes a reserved store address in `isStoreSlug()` (`src/lib/slug.ts`), and so does every
address starting `try-`.

`sandboxPageContext()` is a sibling of `storePageContext()`. Its actions are thin wrappers in `src/app/admin/try/[sandbox]/actions.ts`:
`sandboxFor()` first, then the same server function the store's action calls (`savePage()`, `listTemplates()` and the others), with the
sandbox's store and the sandbox account. **Only what is wired exists**: an allow-list, where letting visitors into the real admin would
have needed a deny-list across every account-level screen (making stores, the Dream Factory, domains, billing, staff invitations that send
email, the page copier that fetches outside addresses).

What the sandbox's context holds:

| Field of `PageOwnerContext` | In the sandbox | Why |
|---|---|---|
| `owner`, `type`, `features`, `languages`, `countries`, `viewCountry`, `reserved`, `parents`, `contentTypes`, `fonts`, `menus`, `standardMenus`, `theme`, `check`, `colours`, `siteCss`, `textStyles`, `fields.groups` | As the store's | The sandbox is a real store |
| `adminBase`, `dualPages.root`, `menusHref`, `blog.manageHref` | Inside `/admin/try/{sandbox}` (the menus and blogs links open the sandbox's home until those screens are offered) | No link leaves the sandbox; `page-editor.tsx` uses `adminBase` in 13 places |
| `actions.save`, `unpublish`, `remove`, `duplicate`, `versions` | On; *Publish* publishes into the private store | The visitor sees what publishing does, and nobody else does |
| `actions.createPart`, `updatePart`, `deletePart`, `createTerm`, `gridPreview`, `gridTerms`, `linkTargets`, `visibilityChoices` | On | Within the store |
| `actions.saveThemeTab`, `saveLibrary`, `saveSiteCss`, `cssVersions` | On | The Theme tab and CSS are the showcase |
| `actions.installFont` | On, a few families a sandbox | It copies a Google Fonts family into Kaizena Flow's shared fonts |
| `actions.motion` | On; the model's plan within the AI allowance (4.5), else the rules' plan | `planMotionAction` already falls back to rules |
| `templates.list`, `use`, `setActive` | On, the marketplace's templates only, previewed at the sandbox's own route (`previewBase`) | One account owns every sandbox, so "my stores" would be every other visitor's saved parts |
| `templates.setSharing` | Answers that it is not in the sandbox | It decides who in other stores may use a saved part |
| `themeSections` | On | A signature theme's own sections |
| `dualPages` | Step S3 | Dual page (D412) loads a second document through its own routes |
| `upload`, `media` | Step S3, within the storage allowance (4.5) | |
| `pictures`, `pictureEdit`, `aiChange`, `actions.translate` | Step S3, through the sandbox's own routes, within the AI allowance | The store's routes (`/admin/{store}/media/make`, `/media/edit`, `/pages/change`) check membership |
| `startVideo`, `fields.startFile` | Null | Large files; the source's own videos still show |
| `schedule` | Null | Nothing to schedule in a store nobody else sees |
| `share` | Null | A link that opens a draft without signing in would make the sandbox a free host |
| `experimentsHref` | Null | A test needs visitors |
| `signupCodes` | Empty | No discounts are copied |
| `plans`, `themeStore`, `draftOnly`, `place` | Absent, as for a store | |

The kinds offered: pages, the header and the footer first (S1), then articles and product layouts (S3). Each has the editor and its
*Preview* (`PageDrawing`, at `/admin/try/{sandbox}/{segment}/{id}/preview`). The sandbox's home lists its pages with *Edit the front
page* as the one main action.

The sandbox's routes stay out of the admin map (`src/lib/admin-map.ts`), whose pages the AI manager's prompt lists, so its prompt and the
agents' eval recording do not change.

### 4.4 Nothing leaves the sandbox

What a visitor makes is seen by that visitor only, and nothing in a sandbox reaches anyone else:

- **No public page.** The store is private from birth and has no host or domain; its pages are reached only through the sandbox's preview.
  There are no share links. So a sandbox cannot host a phishing page, and the HTML block and own CSS reach only the person who wrote them.
- **No email.** Nothing in a sandbox store sends one: the storefront's forms that would (contact, newsletter, customer sign-in, quotes,
  product questions, reviews, withdrawals) are not reachable while the store is private and has no pass for its storefront. When step S4
  lets the visitor walk their storefront (8), each of those senders is checked to send nothing for a sandbox store, and a test proves it.
- **No order.** The database refuses one (4.1).
- **No outside fetch.** The page copier (D150), web research and the AI manager are not wired.
- **No other store.** The wrappers act on the sandbox's own store only; part sharing is refused.

### 4.5 AI and uploads on an allowance

The AI is the best of the showcase, so it is on, on a small allowance, through `limit_overrides` rows the sandbox is made with:

- `ai_cost_month_micros`: the sandbox's AI on Kaizena Flow's key, for every feature at once (*Change with AI*, pictures by prompt, *Remove
  background*, motion, translation). When it is spent, `aiFor()` gives no connection and each feature says AI is not available here, with
  *Keep this store* beside it. Its value is a platform setting; the proposal is a few changes and three pictures' worth.
- `storage_bytes`: the uploads a sandbox may keep, refused past it by `storageRefusal()` as in any store. The proposal is 50 MB.

Unlike templates and demo stores, which are never limited (D314), a sandbox always is: `src/server/limits.ts:51` exempts
`is_template or starter`, never `sandbox`.

### 4.6 Kept out of the platform's numbers and jobs

A sandbox store must not show up as a store: not on Platform → Stores, its counts, Usage and limits, the stores an owner may have (the
sandbox account owns them all), sitemaps, `llms.txt`, feeds, shopping agents, the storefront API, the WordPress plugin, support or any job.

- **The queries that already leave templates out leave sandboxes out too.** 56 lines in 43 files leave out `is_template or starter` today
  (and one SQL function); each also leaves out `sandbox`. A scan test fails for a query that names `is_template` with `starter` but not
  `sandbox`.
- **Jobs skip them.** `commerce.store_is_active()` returns false for a sandbox store (it is `status = 'active'` today), so the jobs that
  already leave a store that is not open alone (67 references in `src/server`) leave sandboxes alone. Step S1 checks that none of those
  callers is on the builder's path.

### 4.7 Keep this store

*Keep this store* is the self-serve sign-up form, inside the sandbox's bar: their name, the store's name and their email (the first and
only time one is asked). It is counted as any sign-up (`signupBucket()`: 3 an address a day, 20 a network an hour) and kept as a request
(`commerce.access_requests`, with a new column, `sandbox_id`), whose confirmation link is emailed as today.

- While a request is pending, its sandbox does not expire (its time is pushed to the link's end plus a day).
- The link may be opened in another browser: the request names the sandbox, not the pass.
- `confirmSelfSignup()` sees the request's sandbox and, while it is still open, calls `adoptSandbox()` instead of
  `approveAccessRequest()`. In one transaction (`commerce.adopt_sandbox()`), it makes or links the account as approval does, gives the
  store its name and a free address (`freeSlug()`), clears `stores.sandbox`, makes the new account its owner and removes the sandbox
  account, and marks the sandbox kept. Then the trial (`grantTrial()`, with a new `via`, `sandbox`), the audit entry (`store.sandbox_kept`)
  and the store's tag refreshed under both addresses (`refreshTag(storeTag(…))`, held by `store-writers.scan.test.ts`).
- The store stays private until its owner opens it (D339), as every new store does.
- If the sandbox has gone by then, the request is approved the normal way, from the template.
- With self-serve sign-up switched off, the request waits for a platform admin, as any request does.

**Renaming a store's address is not built anywhere today** (no code updates `stores.slug`, and the address is the store's subdomain). A
sandbox is the one safe case: it was never public, had no host, was in no sitemap and nobody outside could link to it. `adopt_sandbox()`
renames only a sandbox, once. Step S2 checks what else is keyed by the address (the store's cache tag, the page content's own links) and
that the source stores hold no link to their own address.

### 4.8 Start over, expiry and cleanup

`commerce.sandboxes` (one row a sandbox, written only by `src/server/sandbox.ts` and the SQL functions below; RLS on; never copied):
the store, its source, `pass_hash`, `state` (`open`, `kept`, `expired`, `purged`), when it was made and last seen, its time, the keep
request, and the times of the first change, the first publish and the keep, for the funnel (8).

- **Time:** 7 days after the last visit, 30 at most after it was made. The bar says how long is left.
- ***Start over*** makes a new sandbox (the same budget) and expires the old one at once.
- **Expiry:** the five-minute dispatcher's `sandboxes` job (`runJobs()`) marks sandboxes past their time `expired` (the pass stops
  working) and the store `closed` with the reason *Sandbox ended*, written by `expire_sandbox()` without the closing emails of D171.
- **Purge:** the same job runs `commerce.purge_sandbox()` on expired sandboxes. It refuses any store that is not a sandbox, deletes every row
  of the store in every `commerce` table in order, and its library's files (`removeStoredFiles()` on its own library rows, never the
  addresses its copied products point at, which belong to the source). The `stores` row stays as a tombstone: `commerce.audit_log`
  references stores and is append-only for 24 months, so the bare row is deleted only when its audit entries have gone
  (`pruneAuditLog()`).
- **Retention:** a new retention kind and step, `sandboxes` (`src/lib/retention.ts`, `src/server/retention.ts`), seeded at 7 days after
  the last visit, so the rule is on Platform → Data retention (`/admin/platform/retention`) beside the others.

D171 did not build deleting a store because orders, invoices and the audit log cannot go. A sandbox never had an order or an invoice, and
the audit log is answered by the tombstone, so this purge is the small case that is safe.

**Why not a pool of stores reused between visitors:** a reset that missed one table would show one visitor's work to the next. A store per
sandbox can only ever leave rows behind, never hand them over. If making one takes more than about two seconds in production, the
dispatcher keeps a few fresh copies ready, never given to anyone before, and *Start building* takes one.

### 4.9 The front door

- **On kaizenaflow.com:** a *Try the builder* page built from `docs/site-design.md` and saved as a draft for the owner to publish, and the
  button on the front page and the plans; each links to `/admin/try`.
- **In the theme store:** *Try it with this theme* beside *See it live* (D277), to `/admin/try?theme={theme}`, starting from that theme's
  demo store offered in the sandbox.

## 5. What could go wrong, and what stops it

| Risk | What stops it |
|---|---|
| A free, anonymous host for phishing or spam pages | Private from birth, no host or domain, no share links (4.4); the database refuses private mode off |
| Email sent to people who did not ask | Nothing in a sandbox sends email; the visitor's own address only through sign-up's limits (4.7) |
| Many stores made by a script | The `sandbox` budget per network and for the platform, fail closed, the daily cap, the switch (4.2) |
| AI spend | The per-sandbox AI allowance through `limit_overrides`; `aiFor()` stops at it (4.5) |
| Storage | `storage_bytes` per sandbox; no video or file uploads; purge after 7 days (4.5, 4.8) |
| Reaching another store or the platform | No account; the pass names one store; only wired actions exist, each calling `sandboxFor()` first (4.2, 4.3) |
| Requests to outside addresses (SSRF) | The page copier, research, webhooks and integrations are not wired (4.4) |
| One visitor seeing another's work | A store per sandbox, never reused (4.8) |
| Sandboxes counted as stores, or run by jobs | 4.6, with a scan test |
| The pass stolen | HttpOnly, Secure, path-limited; it opens one throwaway store, never an account |

## 6. Personal data

The visitor is anonymous, but what they type or upload may be personal data, so:

- Kept: the sandbox's content and uploads, and the budget's counts under keyed hashes (as sign-up keeps them, never the address). Nothing
  else about the visitor.
- Gone 7 days after the last visit (the retention rule, 4.8), or theirs to keep through sign-up.
- Kaizena Flow's privacy notice gets a paragraph on the sandbox, and the start screen links to it in one line.
- What the AI reads is sent to the platform's AI provider, as for any store on Kaizena Flow's key: `docs/dpia-ai.md` adds sandbox visitors
  as people whose text it reads, and pictures made by AI are marked as elsewhere (`docs/ai-act.md`).
- Everything stays in the EU, where the platform already runs; no new vendor. If bots get past the budgets, an EU check (Friendly Captcha,
  Germany) is the fallback, with its entry in `docs/residency-register.md`.

## 7. What is new

- **Database:** `stores.sandbox`; `commerce.sandboxes`; `access_requests.sandbox_id`; platform settings `sandbox_on`, `sandbox_daily_cap`,
  `sandbox_ai_micros`, `sandbox_storage_bytes`; the sandbox account; *Offer in the sandbox* on store templates; functions `make_sandbox()`,
  `adopt_sandbox()`, `expire_sandbox()`, `purge_sandbox()`; `store_is_active()` and `orders_store_open()` changed for sandboxes; the rules
  of 4.1. A custom migration for the functions and rules.
- **Server:** `src/server/sandbox.ts` (make, `sandboxFor()`, start over, expire, purge, the funnel's counts), new reads through
  `typedRows()`, logs through `log()`.
- **Pure:** `src/lib/sandbox.ts` (the pass's format, times, allowances, what the context switches off).
- **Routes:** `src/app/admin/try/` (the start screen, its layout, the sandbox's home, the editors and previews, its AI routes),
  `src/app/admin/try/[sandbox]/actions.ts`.
- **Changed:** `BUDGETS` (`sandbox`), `isStoreSlug()` (`try`, `try-`), the 43 files of 4.6, `confirmSelfSignup()`, `grantTrial()`'s
  `via`, the retention kinds and steps, the sign-up form (inside the sandbox), the theme store's theme page.

## 8. Steps

| Step | What | Done when |
|---|---|---|
| **S1** The sandbox, behind the switch | 4.1, 4.2, 4.3 for pages, the header and the footer (no uploads, no AI), 4.4, 4.6, expiry closing the store (4.8 without the purge); the switch and the daily cap keep the number small until S3 | A platform admin with the switch on starts a sandbox from `/admin/try` in a private window, edits and publishes the front page, sees the preview; nothing of it is on the storefront, Platform → Stores or any job's list |
| **S2** Keep this store | 4.7 | A sandbox kept through the emailed link is the new owner's store, at its own address, with its pages, a trial, private until opened |
| **S3** The rest of the builder, and cleanup | Uploads and the AI on their allowances (4.5), articles and product layouts, the purge, tombstones and the retention step (4.8), fresh copies kept ready if needed | An expired sandbox leaves only its tombstone; a spent allowance stops the AI with *Keep this store* beside it |
| **S4** The front door, opened | The guided path (2), *Try another look* (free themes; a premium one shown, never switched to, D286), walking the store's own storefront through a `staff` pass once its senders are proven silent (4.4), *Try it with this theme* (4.9), the funnel on Platform → Stores (made, changed something, published, kept), the kaizenaflow.com page as a draft; the switch on | The owner has watched the funnel for a week and publishes the page |

Each step goes to production as built (D5); the switch keeps S1 to S3 to platform admins' own tries.

### 8.1 S1 as built (5 November 2026)

- **Database** (migrations `sandbox`, `sandbox_rules`, `try_reserved`): `stores.sandbox` (only at a `try-` address, never a template or a
  store template), `commerce.sandboxes` (RLS on; never copied, never exported, no person's data), `platform_settings.sandbox_on`,
  `sandbox_daily_cap` (300) and `sandbox_source`; the sandbox account `sandbox@kaizenaflow.invalid`, disabled; `make_sandbox(starter, slug,
  pass_hash, days)` and `expire_sandbox(id)`; `stores_sandbox_rules()` (made only by `make_sandbox()`, stays a sandbox, stays private, no
  shopping agents or domain buying, keeps its address), `store_members_sandbox()`, `sandbox_doors()` on `store_domains` and
  `payment_providers`, `sandboxes_rules()` (describes a sandbox only, keeps its store, source, pass and first times, moves only forward,
  never deleted); `store_is_active()` false and `orders_store_open()` refusing (`orders.store_sandbox`) for a sandbox. `try` joins the
  reserved addresses (`NOT VALID`, so no older address can fail the release) and `slugProblem()` refuses `try-`; `freeSlug()` puts `my-`
  before a name that would start so. Held by `src/db/sandboxes.test.ts`.
- **Server:** `src/server/sandbox.ts` (the settings, `startSandbox()` within the `sandbox` budget, 5 an hour from one network and 200 for the
  platform, fail closed, and the cap; `sandboxFor()`; `currentSandbox()`; `noteSandboxChange()`; `endSandbox()`; `expireSandboxes()`, the
  dispatcher's `sandboxes` job) and `src/lib/sandbox.ts` (the pass, the address, the times, the kinds). A font installed from a sandbox is
  within its own budget, `sandbox_font`. The switch is a card on Platform → Access requests with the day's count and the open ones.
- **Routes:** `/admin/try` (the start screen and `startSandboxAction`), `/admin/try/{sandbox}` (the bar, the home), `…/{pages|headers|
  footers}/new`, `…/{id}` and `…/{id}/preview`, and `/admin/try/templates/{sandbox}/{template}/preview`; words in the `sandbox` catalogue,
  English and Norwegian.
- **Kept out:** besides the readers of `is_template` (now held for sandboxes by `store-starters.scan.test.ts`), the readers that leave
  store templates out by `not s.starter` alone: the AI's check of new listings, alt texts and the media library's vectors (each a model call
  a sandbox must never cost), cart reminders, deliveries, the control centre, the grid's stores and billing's list. `email.ts` refuses
  every email of a sandbox store, of any kind, which is stronger than 4.4 asked.
- **Found while building:** templates from "my stores" would have shown one visitor another's saved parts (one account owns every
  sandbox), so the sandbox lists, previews and applies the marketplace's only and keeps its own saved parts private; the store's template
  preview needs a signed-in account, so the sandbox has its own (`TemplateActions.previewBase`); the test databases' setup made every store
  public, which the database now refuses for a sandbox, so `e2e/global-setup.ts` and `test/integration-setup.ts` leave sandboxes private.
- **Not yet, as planned:** the editor's *View* link opens the store's private landing page until S4 lets the visitor walk the storefront;
  the purge (S3), so an ended sandbox stays a closed store until then, its number bounded by the switch and the cap.

## 9. Tests

Built with S1:

- **PGlite** (`src/db/sandboxes.test.ts`): the sandbox account; `make_sandbox()` and its refusals; a sandbox's store rules (no order, a
  copied one neither; made only by `make_sandbox()` and stays one; private, no agents, no domain buying, keeps its address; never a
  template; no other member, domain or payment provider); its row's rules; `expire_sandbox()`.
- **Unit** (`src/lib/sandbox.test.ts`): the pass, the address, the times, the kinds.
- **Scan:** `src/server/sandbox.scan.test.ts` (every action opens the sandbox with its pass first, every page reads it through the pass, the
  context leaves out what 4.3 leaves out, templates from the marketplace only, no AI, email or upload); `store-starters.scan.test.ts`
  (sandboxes left out wherever a reader means a real store, or listed with the reason; limits still apply; no email).
- **Integration** (`src/server/sandbox.int.test.ts`): the switch, the budget and the cap; the copy; the pass opening its own sandbox only;
  a visit pushing the time on; a page saved and published as the sandbox account; no email of any kind; left out of the grid's stores;
  Start over and the job ending sandboxes.
- **End to end** (`e2e/try-builder.spec.ts`): closed while the switch is off; then in a fresh browser without an account: start, edit and
  publish the front page in the real builder, the storefront still private, the preview, another browser refused, *Start over*.

To come with S2 and S3: `adopt_sandbox()` only for a sandbox and only once; `purge_sandbox()` refusing any other store and leaving, for
every table in `commerce` with a `store_id` column (read from the catalogue, so a future table is covered), no row of the sandbox's store
but its audit entries and its `stores` row.

## 10. Decided by the owner (5 November 2026)

The owner took the recommendations:

1. **The AI allowance:** on, a few *Change with AI* and three pictures' worth a sandbox (step S3).
2. **How long:** 7 days after the last visit, 30 at most.
3. **Cleanup:** a store per sandbox, purged with a tombstone, never a pool reused between visitors.
4. **Sources:** the Standard store by default (`platform_settings.sandbox_source` null); demo stores offered one by one.
5. **The daily cap:** 300 a day (`platform_settings.sandbox_daily_cap`), raised by the funnel's numbers.

## 11. Not in this plan

- Any part of the admin outside the website: products, orders, settings, marketing, billing, the AI manager, the Dream Factory (a *Build
  it with AI* sandbox would cost a run's AI per visitor; to decide after S4's numbers).
- The menu editor, media library page and design settings as screens of their own (the builder's Theme tab covers the look); they are the
  first to add if visitors ask.
- A sandbox shared with someone else, or a link to show it: the sandbox is the visitor's alone until it is kept.
