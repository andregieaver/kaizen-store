# Store templates (D175, D177)

The platform's admins prepare **store templates**: starting points for new stores, each a real store set up for one kind of
business (a spa taking appointments, a shop selling goods, downloads, rentals and stays, subscription boxes, services). A store
owner chooses one when creating a store, and so does a person asking for a store at `/sign-up`; the new store starts with the
template's grunt work: modules, settings, products and services, staff and rooms with their opening hours, pages, menus, legal page
drafts, shipping and checkout settings. The look (design themes) is not what this is for: a theme marketplace comes later, although the
template's theme comes along as the default template's does today.

In code they are **starters** (`stores.starter`, `commerce.store_starters`, `src/lib/store-starters.ts`,
`src/server/store-starters.ts`), so they are never confused with the page builder's templates (saved parts, D125) or page layouts (D127).
The interface calls them **Store templates**.

## 1. What a store template is

* A **real store** with `stores.starter = true`, made by `clone_store()` from the platform's default template store (`is_template`), so it
  starts complete, and edited in the normal store admin (`/admin/{slug}`) like any store.
* A row of **`commerce.store_starters`** describing it: `store_id` (unique, the store must be a starter), `title` (1 to 80), `summary` (up
  to 200, on the card), `description` (up to 2,000, plain text), `category` (`appointments`, `retail`, `downloads`, `rentals_stays`,
  `subscriptions`, `services`, `other`, a check), `picture_url` (optional; `https://…` or a path on the site, a check), `position` (the
  order owners see), `published` (only published templates are offered), `created_by`/`updated_by`/`created_at`/`updated_at`. Since D177
  (section 4a) also `draft` (details saved but not published), `published_store_id` (the frozen copy new stores are made from),
  `published_at`, and `archived_at`/`archived_by` (`not (published and archived_at is not null)`, a check).
* **`starter` and `is_template` are never both true** (`stores_starter_not_template`). The default template store stays as it is and is
  always offered as **Standard store**, first; it is not a row of `store_starters` and cannot be published as one. *Why:* the default is
  the source of every starter and of the demo storefront; giving it a second life as a starter would make its rules (it cannot be closed,
  it is prerendered) apply to something the platform can unpublish.
* **Once a starter, always a starter** (`stores_starter_rules()`): `starter` can be set on a store that has no orders and no customers, and
  never taken off. A template is retired by unpublishing or archiving it, and deleted only while nothing used it (D177, section 4a); its
  store is then closed, never deleted (D171).

## 2. A starter is not a real store

Everything that counts, lists, bills, scans or acts on stores as businesses leaves starters out, as it leaves out the default template.
The SQL condition is written `not (s.is_template or s.starter)`; `src/server/store-starters.scan.test.ts` fails when a server or app file
says `not s.is_template` (or `not is_template`) alone, and every file reading `is_template` is listed there with its meaning, so a new
reader forces a decision.

| Reader | Means | Decision |
|---|---|---|
| `platform-overview.ts` (counts) | not a real store | `not (is_template or starter)` |
| `platform-customers.ts` (owners' stores, twice) | not a real store | `not (is_template or starter)` |
| `platform.ts` `createStoreForOwner()` (stores owned, for the limit) | not a real store | `not (is_template or starter)` |
| `platform.ts` / `approve_access_request()` (the copy's source) | THE template | replaced by `commerce.starter_source(starter)`: the chosen published starter, else the template |
| `wordpress.ts` (the account's stores, twice) | not a real store | `not (is_template or starter)` |
| `ai-usage.ts` `ownedStores()` | not a real store | `not (is_template or starter)` |
| `vat-admin.ts` (countries in use) | not a real store | `not (is_template or starter)` |
| `auth.ts` `listClosedStores()` | not a real store | `not (is_template or starter)` |
| `auth.ts` `listStores()` (level switcher, `/admin/stores`) | the account's working stores | `not s.starter` added: a starter is reached from the platform's Store templates page, not listed among the admin's own stores |
| `control-center.ts` (owner's overview) | the account's working stores | `not s.starter` added |
| `referrals.ts` `ownsAStore()` | not a real store | `not (is_template or starter)` |
| `experiments.ts` (A/B assignment) | not a real store | `not (is_template or starter)`: no test cookies in a preview |
| `manager-tools.ts` `list_stores` | not a real store | `not (is_template or starter)` |
| `platform-unit-tests.ts` | not a real store | `not (is_template or starter)` |
| `store-copy.ts` (owner's source, owned count) | not a real store | `not (is_template or starter)` (platform admins may still duplicate a starter: the copy is an ordinary store) |
| `billing.ts` `listStoreBilling()` (platform Stores list) | the template first | `not s.starter` added: starters are listed under Store templates |
| `content-grid.ts` `listGridStores()` (whose products a Kaizen grid shows) | the template first | `not s.starter` added |
| `cookie-scans.ts` (stores to scan) | template or open stores | `not s.starter` added: no Chromium time on previews |
| `seo.ts` `listPublicStores()` (`indexable`) | template or open | never indexable when `starter` |
| market and chooser layouts (`robots`, notice) | template or open | `noindex` and the template notice when `starter` |
| `settings/seo/page.tsx` (`open`) | template or open | not open when `starter` |
| `stores.ts` `templateStoreSlug()`, `billing.ts` `planCurrencies()`, `plan-reminders.ts`, `db/health.ts` | THE template | unchanged |
| `design-presets.ts` (D176: the Standard store a design profile is previewed on, and the template named among a snapshot's sources) | THE template | a starter is previewed and listed as a store template, by its own row |
| `store-closure.ts` (`isTemplate` cannot close) | THE template | unchanged: a starter may be closed like any store |
| migrations' demo and closure rules | THE template | unchanged |

**Starters the platform keeps for itself (D177).** A store template's frozen copies (`stores.starter_copy_of`) and a design profile's
workspaces (`design_presets.workspace_store_id`, `docs/design-profiles.md`) are starters too, so every row above leaves them out. They describe
no store template, so they are also never listed where starters are (every list of templates joins `store_starters`), and **nobody works in
them**: `loadMembership()` (`src/server/auth.ts`) honours a membership of a starter only while a `store_starters` row describes it (the
person who made one is its owner on paper, as `clone_store()` needs an owner), so its store admin is a 404; the same condition keeps them out
of `snapshotSources()` and `works()` (`design-presets.ts`), Kaizen Life's store list (`store-mcp.ts`) and Work's stores (`work-owner.ts`);
`applyDesignPreset()` and `restoreDesignLook()` refuse them. A deleted template's store is such a store too.

## 3. The preview storefront

* A starter's storefront is at its normal address, `/s/{slug}` and its markets (`{slug}.{store domain}` with P7), so a template can be
  reviewed exactly as a store made from it would look.
* **Never indexed**: `noindex` on every page (the market and chooser layouts), `indexable: false` in `listPublicStores()`, so it is in no
  sitemap and no llms.txt (Kaizen's or its own).
* A slim notice in the header: **"Store template preview: this store does not take orders."** (`m.starterNotice`, hand-written nb, sv, da,
  en), in place of the preview, demo and test notices.
* **No orders**: `commerce.orders_store_open()` refuses an order in a starter with its own reason, `orders.store_starter`, before the
  open-store check, whoever asks (a checkout, a renewal, a delivery, a draft, a copy). `getCheckoutInfo()` says `starter` and
  `paymentsOn: false`, so the cart shows `m.starterCheckout` in place of the checkout button, and the checkout page, which needs an order
  waiting for payment, sends the shopper back to the cart.
* **Not open for jobs**: `commerce.store_is_active(store)` is false for a starter, so every job that already skips a store that is not
  open skips it too (embeddings, knowledge, bonus, affiliates, low stock, archiving, draft expiry, calendar sync, experiments, order edits
  and drafts). The jobs that read `stores.status` directly add `not s.starter`: cart reminders, standing deliveries, alt texts and media
  embeddings by AI, cookie scans. Booking reminders need a booked order, which a starter never has.
* **No shopper email**: `sendEmail()` suppresses every `shopper` and `security` email of a starter (sign-in codes, form confirmations,
  welcome emails…), kept as a `failed` row with the reason, like an erased person's.
* **No Stripe set-up**: the store admin layout does not create a Stripe test account for a starter (`ensureTestAccount()`), and the setup
  wizard does not take over its admin's front page.

## 4. The platform admin (`/admin/platform/store-templates`)

The Stores section of the platform admin has a sidebar now (`STORE_ITEMS` in `src/lib/platform-nav.ts`): *All stores* and *Store
templates*. Platform admins only (`requirePlatformAdmin()` on every page and action).

* **List**: picture, title, category, published or not, position, the store's address, with *Edit details*, *Publish* / *Unpublish*,
  *Move up* / *Move down*, *Open the store's admin* and *Preview* (opens `storeHref(slug, storeBase(slug))` in a new window,
  `target="_blank" rel="noopener"`).
* **New store template** (title, store address, category, summary, description): `createStarter()` makes the store with `clone_store()`
  from the default template (the admin is its owner), marks it `starter`, adds the row at the end, unpublished, in one transaction.
* **Open the store's admin** (`openStarterAdmin()`): another platform admin who is not a member yet is added as an owner first (audited),
  so every platform admin can edit every template.
* **Edit details** at `/admin/platform/store-templates/{id}`: title, summary, description, category, picture (uploaded to Kaizen's media
  library like other platform pictures, or chosen from it by address).
* **Features** on the same page (D178 step 6, `docs/store-features.md` 4f): what a store made from the template starts with switched on, its
  working store's `stores.features`, set as a whole by `setStarterFeatures()` (`setFeatures()` with the platform admin as the store's owner,
  so needs, blockers, warnings and the `store.feature` audit hold). They reach new stores on the next Publish (the frozen copy keeps them and
  `clone_starter_setup()` copies them), and the owners' and sign-up cards say *Starts with: …* from the published copy's features. A store
  made from the template gets the setup's question "What will you sell?" pre-filled with them.
* Every change is in the audit log (`platform.starter_created`, `_updated`, `_published`, `_unpublished`, `_archived`, `_restored`,
  `_deleted`, `_moved`, `_joined`; area `platform`), with the starter's store id.

## 4a. Draft, publish, unpublish, archive, delete (D177)

The same buttons on the list and on each template's page (`LifecycleButtons`, the states and choices in `src/lib/lifecycle.ts`):

* **Save draft** (`saveStarterDraft()`): the details (title, summary, description, category, picture and the **recommended design
  profile**, which is one of the details now) go to `store_starters.draft`; owners keep reading the columns until Publish. A draft equal to
  what is published is none. The admin's pages show the draft in place of the published details and say so.
* **Publish** (`publishStarter()`, one transaction): the draft becomes the columns (a recommended profile archived since is dropped, and the
  admin is told), and the **working store is frozen**: `commerce.freeze_starter(starter, admin)` copies it with `clone_store()` (which, the
  working store being a starter, adds `clone_starter_setup()`) into a new store `{slug}-v{n}`, marks it `starter` with `starter_copy_of` and
  no `made_from_starter`, points `published_store_id` at it and closes the copy it replaces (`status = 'closed'` through
  `stores_status_rules()`, never deleted). `published = true`, `published_at = now()`. Refused while archived (`store_starters.archived`) or
  while the working store is not open (`.not_open`).
* What a new store is copied from is still decided only by **`commerce.starter_source()`**: now `starter_offered_source()`, the published
  and unarchived template's **frozen copy** (or, for a template published before D177 and not since, its working store, as before: the list
  says "Publish it again to keep a copy"). So changes in the working store after a Publish reach no new store until the next Publish, and
  owners' Preview cards (`listOfferedStarters()`) and the design profiles' public preview open the frozen copy. The admin previews both:
  *Preview its store* (the working store) and *Preview as published*.
* A store made from a frozen copy records the template (`clone_starter_setup()` reads `made_from_starter` from the source's own row or its
  `starter_copy_of`).
* **"Changed since published"**: a draft of the details, or an entry in the working store's activity log after `published_at` (not a
  `platform.` action). An estimate: not every change is logged.
* **Unpublish** (`unpublishStarter()`): out of the choices at once (`STARTERS_TAG`, `DESIGNS_TAG`); the admin is told how many pending access
  requests chose it. At approval such a request gets the **Standard store**: `approve_access_request()` takes the default template when the
  request's template is no longer offered (audit `starterFallback`), the request page leaves the choice empty with a sentence saying why,
  and the approval's message names the template that gave way (`ApproveResult.fellBack`). A template the admin chooses that is not offered
  is still refused.
* **Archive** (`archiveStarter()`): unpublished, and hidden from every list but *Archived* (`?show=archived`); moving skips archived ones.
  **Restore** brings it back unpublished.
* **Delete** (`deleteStarter()`), offered only while unused and behind a confirmation: refused by the database when a store was made from it
  (`store_starters.used`) or an access request names it (`store_starters.requested`), else its working store and every frozen copy are
  closed and kept, and its row goes (`stores.starter_copy_of` set null; the closed stores stay hidden, see section 2).

## 5. Choosing one

* **`/admin/stores`, Create a store**: published templates as cards (picture, title, category, summary) with a **Preview** link opening the
  template's storefront in a new window, and *Standard store* (the default template, previewed the same way) first and chosen by default.
  The form sends the starter's id (`store_starters.id`), never a store id.
* **`/sign-up`**: the same cards, optional, Standard by default; the choice is kept on the request (`access_requests.starter_id`, a dropped
  value when it is not a published starter, without a word, like a referral code). The platform admin sees it on the request and may change
  it before approving.
* **The server decides the source**: `commerce.starter_source(starter)` returns the starter's frozen copy (D177; its store when published
  before D177) when the starter is published and not archived, the default template when none is given, and raises
  `store_starters.not_offered` otherwise. `createStoreForOwner()` and `approve_access_request()` both use it, so an unpublished starter or any
  other store can never be the source (approval of a request whose template is gone takes the Standard store, section 4a).
* After the store is made, `stores.made_from_starter` keeps which template it came from (for the platform's counts on the list; nothing
  reads it to behave differently).

## 6. What a new store gets from a template

`clone_store()` copies what it always copied (section *What clone_store() copies* of `docs/platform.md` and the later D-rules): markets,
shipping rates, payment-method switches, product-safety operators, stock locations, the catalogue (products not archived, translations,
pictures by address, variants, prices as new prices, stock, subscription plans), categories and tags, booking resources (staff, rooms,
items, with their opening hours, never their email or a host's), appointment settings, seasons, product resources, published pages and
articles with the front page, All products page, product layouts, header and footer, menus and the menus chosen, page roles of published
pages, custom field groups and values, return settings, and the stores columns `navigation`, `fonts`, `theme`, `modules`, `time_zone`,
`booking_reminder_hours`.

When the source is a starter, `commerce.clone_starter_setup(source, store, owner)` (called at the end of `clone_store()`) copies the rest of
the operational set-up:

| Copied | Why |
|---|---|
| `stores`: `audience`, `business_popup`, `open_cart_on_add`, `terms_at_checkout`, `locales`, `rates_auto`, `custom_css` | Who it sells to, how the cart and checkout behave, which languages, the CSS its pages rely on. |
| `store_currencies` | The currencies it shows and their rates. |
| Draft pages and articles (not `variant`), as drafts, with their field values, and page roles that point at them | The legal page drafts (terms, privacy, returns…) and any page not yet published, never published for the owner. |
| `order_settings`: gift messages, automatic archiving, draft validity | Checkout and order handling choices (`staff_mark_paid` stays off: it is a power, the owner's to give). |
| `invoice_settings`: footer note, email with confirmation (enabled, no start date) | As `duplicate_store()` does. |
| `delivery_schedules` | A subscription box template's delivery days. |
| `customer_tiers` | Customer groups (companies are not: they are customers). |
| `bonus_settings`, `affiliate_settings` | The programs' rules; never a balance or a code. |

Never copied, from a starter or the template: orders, customers, carts, payments, Stripe accounts, payment credentials, domains,
integrations, carrier agreements, AI keys and the chat agent's setup, invoice and order series, documents, the audit log, analytics data and
settings, A/B tests, campaigns and discount codes, cart reminder steps, store locations (the template's addresses), the tax profile (a
registration is the owner's to state), business details, tracking ids and the owner's code, members (only the new owner), saved parts.
`COPY_RULES` (`src/lib/store-copy-rules.ts`) classifies `store_starters` as `never`: a starter's listing is the platform's.

Download files stay with the template, so a download product waits as a draft for the owner's files, as from the default template.
Pictures are copied **by address**: they stay in the template's folder of Storage. **Never delete a picture from a published template's
media library**: stores made from it would lose it (the same holds for the default template today; noted for the lead).

## 7. Not built

* A theme marketplace (later). A template's look as a separate choice is now **design profiles** (D176, `docs/design-profiles.md`): chosen
  after the store template when a store is made, a store template may recommend one, and any store can apply one later.
* An AI manager tool for store templates: none (the platform tools stay as they were); owners have none either.
* Changing a store's template after it is made: a template is only a starting point; later changes to the template reach no store.
* A precise "changed since published" for a template's store: it is estimated from the activity log (section 4a).
