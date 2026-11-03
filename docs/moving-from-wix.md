# Moving from Wix: the same three presses, built for the smallest shops (D439 proposed)

The Wix counterpart of `docs/moving-from-shopify.md` (D437). The owner (3 November 2026) asked for one plan per platform, each simple enough
for Homer Simpson. **This file is a plan only: nothing here is built yet.** The move engine is the one in the Shopify plan and is not
described again: `commerce.shop_moves` and `shop_move_items` (section 10 there), the rule that only existing writers write (8.1), the
address check (8.2), the reconciliation (8.3), *Undo this copy* (8.4), and *silent until Move* (7). This file says what is different for
Wix.

---

## 1. The promise

Homer has a Wix site with a shop on it. He pastes its address, presses **Connect Wix**, says yes on Wix's own page, and presses **Copy my
shop**. His new shop is ready to look at behind a password while Wix keeps selling. When he is happy, he presses **Move my shop**. His
domain, his old links, his products, customers, email list and orders all come over, and **so do his pages, which Wix has no other way to
give us** (section 4.4).

Wix owners are often the smallest shops: one person, a few dozen products, a site made in an afternoon in the Wix editor, and a domain
bought from Wix. So the promise is stricter here than for Shopify. **Homer is never sent to a developer page, a spreadsheet or a DNS
screen he has to understand.** When Wix makes him press something on its side, we show him exactly what he will see.

## 2. What is there today, and what we found

### 2.1 Built

Nothing reads Wix today.

- The product import (D165) knows Kaizena Flow's own file, Shopify's and WooCommerce's (`FileFormat`). A Wix product file is reported as
  *not a product file we know*.
- The customer import (D366) needs an email column, and so reads Wix's contact export only if the owner renames nothing and the columns
  happen to match.
- The redirect import (D168) wants the headings `Redirect from` and `Redirect to`. Wix's file has its old and new address in two columns
  with Wix's own headings (2.2), so today it fails.
- What helps already: the page replicator (D150) copies a live page into the builder; private mode (D339); domains (D315); the 404 report
  and its suggestions (D168).

### 2.2 What Wix allows (read 3 November 2026)

- **Access** (<https://dev.wix.com/docs/build-apps/build-your-app/authentication/permissions>, fetched; search summary of
  <https://dev.wix.com/docs/rest/articles/getting-started/authentication>):
  - A third party reaches a site only through a **Wix app** the site owner installs.
  - The app declares permission scopes in Wix's app dashboard, and the owner grants them at install.
  - Tokens last 4 hours and are minted again from the app's client id and secret, with no refresh token.
  - API keys are not available to third-party apps.
  - An App Market app must ask only for the permissions it needs.
  - So, as for Shopify, **we build one Wix app of our own**, and Homer meets only Wix's install page.
- **Two catalogues** (<https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/catalog-v1-to-v3-migration-guide>;
  <https://dev.wix.com/docs/sdk/backend-modules/stores/catalog-v3/catalog-v3-intro>):
  - A site runs either Catalog V1 or Catalog V3, never both, and the Catalog Versioning API says which.
  - Calls to the wrong version fail, and apps must support both. Wix says V3 will replace V1 "over time".
  - In V3, every product has at least one variant, prices live on the variant (an actual price and a compare-at price), stock lives in the
    Inventory Items API, and V1's collections become nested categories.
  - Product searches in V3 return no variants; the read-only Variants API does.
  - **We read both** (`wixCatalog()` decides per site); this is the one real engineering cost of Wix.
- **Email consent**
  (<https://dev.wix.com/docs/api-reference/crm/communication/email-subscriptions/emailsubscription-object.md>; overview
  <https://dev.wix.com/api/rest/marketing/email-subscriptions>):
  - Each email address has a `subscriptionStatus`: `NOT_SET`, `PENDING` (confirmation asked, not given), `SUBSCRIBED`, `UNSUBSCRIBED`, or
    `UNKNOWN`.
  - Reading it needs the *Manage Email Subscriptions* scope.
  - Unlike Shopify's record, the object as summarised carries **no date of consent and no opt-in level**: spike W3.
- **Orders** (<https://dev.wix.com/docs/rest/business-solutions/e-commerce/orders/orders/search-orders>): the eCommerce Orders API's
  *Search Orders*, 100 a page, sorted by creation date; by default it leaves out orders still `INITIALIZED`. No 60-day limit is stated.
- **Gift cards** (<https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-cards/introduction>): as on Shopify, a code
  is shown in full only when it is made; every later answer shows the **last 4 characters**. The site must have Wix's Gift Card app.
- **Product file** (<https://support.wix.com/en/article/wix-stores-exporting-your-product-list>; the Swedish article
  <https://support.wix.com/sv/article/wix-stores-exportera-produkter>): Store Products → More Actions → Export, a CSV of at most 5,000
  rows. **Digital products are not exported.** Inventory and categories have files of their own.
- **Redirects** (<https://support.wix.com/en/article/importing-or-exporting-url-redirects-with-a-csv-file>): SEO → URL Redirect Manager
  → More Actions → *Export redirects*. Old address in the first column, new address in the second. Wix imports at most 500 per file;
  exports state no limit.
- **Addresses** (<https://support.wix.com/en/article/customizing-your-pages-url-structure-in-seo-settings>):
  - A product is at `/product-page/{slug}` unless the owner changed the prefix in SEO settings; Wix redirects old patterns by itself when
    it is changed.
  - Pages are at `/{page-slug}`. Older Wix sites and templates often have pages at `/blank-{n}` or `/copy-of-{name}`, or reached by the
    hash-bang addresses of very old sites (`/#!about/c1x2y`). Seen on real sites, not in Wix's documentation: spike W6.
  - Blog posts are at `/post/{slug}`.
- **Domains** (<https://support.wix.com/en/article/connecting-a-wix-domain-to-an-external-site>;
  <https://support.wix.com/en/article/request-changing-name-server-ns-records-for-a-wix-domain>):
  - A domain bought from Wix can point at another site by editing its DNS records in the Wix account (an A record for the root, a CNAME
    for `www`).
  - Its nameservers **cannot** be changed while it stays at Wix; that needs a transfer away.
  - A domain bought recently must wait before it can leave.
  - **Most Wix shops' domains are bought from Wix**, so this is the common case, not the edge.
- **Pages and content**: pages made in the Wix editor have **no API that returns their content** (none found). The Wix Blog has its own
  API: posts as rich content, with categories and tags (spike W4). So pages come over through the page replicator (D150), reading the live
  site as a visitor does.

### 2.3 What hurts in a Wix move, anywhere

1. **The look is the site.** Wix owners chose Wix for its editor; a move that brings the products but leaves an empty home page feels like
   losing the shop.
2. **The domain is at Wix, and Wix's DNS screen is the step they fear most.**
3. **Old links are messier** than Shopify's: renamed prefixes, `/blank-…` pages, and old hash-bang addresses Google still knows.
4. **Many Wix shops sell services and bookings too** (Wix Bookings), not just goods.

## 3. The idea

Three presses and a move day, as for Shopify (`docs/moving-from-shopify.md` 3), with two Wix-only stages in Copy:

- **Pages by the replicator**: every page in the live site's sitemap is copied into the builder (4.4).
- **Both catalogues**: the reader asks Wix which catalogue the site runs, then reads that one.

## 4. What Homer sees

Where he starts is the same as for Shopify (4.1 there): at sign-up, *Yes, on Wix*; the home card; Settings → Moving in; the AI manager.

### 4.1 Connect

> **Bring your Wix shop**
> Paste your site's address. We only read it: nothing changes on Wix, and it keeps selling.
> `[ myshop.com                                ]`
> **Connect Wix**

- Any address works: his own domain, `{user}.wixsite.com/{site}`, or a page of it.
- If his Wix account has several sites, Wix's own install page asks which one. We say so beforehand: *Wix will ask which site: pick the
  one with your shop.*
- If the site has no shop (Wix Stores not installed), we still offer to bring the pages and the email list, and say so in one sentence.

### 4.2 Check: "Here's your shop"

The same report as for Shopify (4.3 there), with the counts Wix has:

> 48 products · 6 categories · 9 pages · a blog with 14 posts
> 310 contacts · 190 of them get your emails
> 820 past orders · 2 gift cards with money left · 3 coupons
> 74 links from Google and elsewhere that will keep working

Homer is asked nothing:

| Today's question | Where the answer comes from |
|---|---|
| Do prices include VAT? | The site's tax settings (spike W2); else the business country's custom (an EU shop's prices include VAT), shown as a sentence he can change |
| Which country and currency? | The site's business info and currency (Wix sells in one currency; Wix's multicurrency only displays converted prices, so one country is set up, and more are offered later) |
| Shipping | Wix's shipping regions and rules, mapped where they fit |
| Logo, colours, fonts | Read from the live site by brand and look (D330) and the replicator's measurements |

### 4.3 "Your new shop is ready"

The same checklist as for Shopify (4.4 there): **Get paid** first, then **Who makes your products?** (4.5 there, once per brand, from
Wix's product *brand* field).

One line is added when Wix has **digital products**: *3 downloads need their files: Wix doesn't let us copy them. Add each file here*,
with one upload per product. The products are already there, as drafts, so nothing else is lost.

### 4.4 "Does it look right?" (Wix only)

The pages come from the replicator, so the copy of each page must be shown and approved:

> **Your pages**
> We copied your 9 pages from your live site. Have a look: most look just like before.
> [Home ✓] [About ✓] [Contact ✓] [FAQ: *2 parts kept as pictures*]
> **Looks good** · *Show me what's different*

- Pages the replicator could only keep as a picture (D164) are named, with *Make it editable with AI* beside each.
- Forms become the store's contact form block; members-only pages become ordinary pages under private mode, with a note to Homer.
- Wix-only widgets (bookings, events, music) are named: *Your booking calendar: set it up here in Bookings*.
- Each page keeps its old address, so no redirect is needed for it.

### 4.5 Move day

The same as for Shopify (4.6 there), with the domain step written for Wix:

| Where the domain is | What Homer does |
|---|---|
| **Bought from Wix** (most) | We show Wix's own screens step by step: *In Wix, open Domains → myshop.com → ⋯ → Manage DNS Records. Change the A record to `…` and the www CNAME to `…`.* Each value has a **Copy** button, a picture of where to paste it, and **Done ✓** appears by itself when we see the change. *Or let us look after your domain* offers a transfer to us (D315) once Wix allows it |
| Connected to Wix by nameservers, registered elsewhere | His registrar's steps, as for Shopify (4.7 there) |
| With us, or at a Domain Connect provider | Nothing, or one press |

Wix email on the domain (Google Workspace bought through Wix) uses MX records in the same Wix screen; **we never touch MX records**, and
the steps say so: *Leave the other records as they are: they keep your email working.*

### 4.6 Afterwards

The same 14 days and *You can close Wix now* (4.8 there), with the closing steps written for Wix:

1. Cancel the site's Premium plan and apps.
2. **Keep the domain where it is** unless he moved it to us. Cancelling a Premium plan doesn't cancel a domain, and the steps say so.

## 5. What comes over

| Wix | Kaizena Flow | Notes |
|---|---|---|
| Products (V1 or V3), options, variants, SKUs, weights | Products and variants | One reader per catalogue into the product import's neutral rows; then `saveProduct()` as always |
| Price, compare-at price | Price, never compare-at | V1's *discounted price* is the price shown, so that is what we import; the regular price is not a reduction we can show (Omnibus) |
| Modifiers and custom text (V3), options that make no variant (V1) | Product options or custom fields (D118) | Free text becomes a personalisation field where we have one; else listed |
| Stock (V3 Inventory Items, V1 inventory) | Stock (one location) | |
| Pictures, videos | Media and product gallery | `safeFetch()` from Wix's media addresses |
| Collections (V1) / categories (V3, nested) | Categories, nested as they are | |
| Brand | Brand, never manufacturer | 4.3 |
| Ribbons ("New", "Sale") | Product badges where we have them, else tags | |
| Digital products | Products as drafts, files missing | 4.3 |
| Pages | Pages, by the replicator | 4.4 |
| Blog posts, categories, tags | Blog and articles (D341) | Rich content converted to our blocks |
| Menu | Menus (D85) | Read from the live site's header, since the editor's menu has no API (spike W5) |
| Contacts and site members | Customers | Members' passwords don't matter: customers sign in with a code |
| Email subscription status | Subscribers | Decision 1 (6.2) |
| Orders | Order history `C-{number}` | `insertHistoryOrder()` (D384) |
| Gift cards | New cards, same balance | As Shopify 6.4 |
| Coupons | Discounts (D299), off until Move | |
| Redirects | Redirects (D168) | Through the API, else Wix's file, which the redirect import will read (section 12, step 1) |
| Product reviews (Wix Reviews app) | Reviews (D301) | Spike W7 |
| Bookings, events, pricing plans | — | Listed, with where it lives here (Bookings, D65) |

## 6. What doesn't come over

### 6.1 Said once, plainly

| Left behind | What we say and do |
|---|---|
| Compare-at prices | As Shopify 6.1 |
| Wix Payments and its payouts | *Connect payments here* (4.3) |
| Digital products' files | 4.3: the product is there; add the file |
| Wix apps and Velo code | Named, with ours beside where we have one; code is never run |
| Bookings, events, pricing plans, Wix Music, forums | Named, with *Set up Bookings here* where it applies (D65) |
| Site analytics | *Your past orders are here; visitor numbers start fresh* |
| Animations and effects the replicator can't measure | Named per page in 4.4 |

### 6.2 The email list (Decision 1)

Wix's record (2.2) has a status but, as far as we have read, **no date and no opt-in level**. That is weaker evidence than Shopify's.

- **Recommended**: if spike W3 finds a date (on the subscription, the contact's activity, or the webhook's record), use the same rule as
  Shopify 6.2: `SUBSCRIBED` comes over with `source` `wix` and that date; `PENDING` never comes over as subscribed.
- **If there is no date**: import `SUBSCRIBED` contacts as **not subscribed**, and offer Homer one press after the move: *Ask your 190
  subscribers to stay on your list*. That sends a single re-permission email; whoever confirms is subscribed with today's date and a
  confirmed opt-in.
- An `UNSUBSCRIBED` person is never added in either case.

### 6.3 Customers and site members

As Shopify 6.3. Wix site members who never bought anything come over as customers only if they have an email and at least one of: an
order, a subscription, a member-only page visit recorded. Otherwise they are listed, never added silently (Decision 3).

### 6.4 Gift cards

As Shopify 6.4: same balance, new code, frozen until Move, emailed on move day.

## 7. The switch day

As Shopify 7, with:

- step 5 using the Wix domain screens (4.5);
- one more check before Move: every page the replicator copied is approved (4.4) or knowingly skipped.

## 8. Robust by construction

The rules of Shopify 8 hold unchanged. What differs:

- **The catalogue version is read at the start of every run** (Catalog Versioning API). Wix may move a site from V1 to V3 between Check
  and Move. Items are matched by their product id and slug, which V3 keeps (spike W1). A changed version is a finding, never a duplicate.
- **The address check reads Wix's sitemap.** It also reads the site's redirect list, and a list of the old shapes:
  - `/product-page/{slug}` under its current prefix and any old prefix the redirects show;
  - `/post/{slug}`;
  - `/blank-{n}` pages;
  - hash-bang addresses. These never reach a server, so they are answered by a small script on the 404 page, which reads the hash and
    sends the visitor on (spike W6).
- **Wix's API limits**: each call is paced to Wix's published rate (spike W1), and tokens are minted again every 4 hours, never stored past
  the move.
- **The replicator runs per page** as a job item: a page that fails is retried and named, and never stops the products.

## 9. Lisa

As Shopify 9, plus:

- each copied page's report from the replicator (what was measured, what became a picture);
- the catalogue version the site ran;
- *From files instead*: Wix's product file (2.2) gets its own reader in `FileFormat`, for owners who won't install an app.

## 10. Data, permissions and law

As Shopify 10, with Wix's app:

- made in Wix's app dashboard under Kaizena Flow's developer account, with read-only scopes;
- Wix's own uninstall event deletes the token and stops the move;
- Wix's data-deletion requests reach `shop_move_items` as an erasure does (D162);
- reading the live pages is the replicator's reading (D150): `safeFetch()`, a visitor's view, no signed-in pages.

## 11. The AI manager

As Shopify 11, with Wix's words. It knows the Wix DNS screen and explains a domain bought from Wix. It never says a page "couldn't be
copied" without naming what to do (*Make it editable with AI*).

## 12. Build order

1. **Wix's files on today's imports**: a Wix product file reader in `FileFormat` (V1's and V3's export columns, spike W8), and the
   redirect import reading Wix's two-column file. Cheap, and useful the day it ships.
2. **The address check** on Wix's sitemap and old shapes, with the hash-bang script.
3. **The Wix app and Connect**, both catalogues.
4. **Check and Copy**: products, stock, categories, customers, orders, coupons, gift cards, blog.
5. **Pages by the replicator**, and the *Your pages* screen.
6. **Move day with Wix's domain screens.**
7. **The email list**, after Decision 1 and spike W3.

## 13. Decisions for the owner

1. **The email list** (6.2): Wix's status with a date where one exists, else the re-permission email (recommended); or always the
   re-permission email; or today's rule.
2. **Pages**: copy every page by the replicator (recommended), or only the home page and let the AI make the rest from the shop's facts
   (D351).
3. **Members without orders** (6.3): listed only (recommended), or imported as customers.
4. **Bookings**: should a Wix site's Bookings (services, staff, opening hours) come over into D65 in this plan, or a later one?
   Recommended later: the shop first.

## 14. Spikes

| # | Question |
|---|---|
| W1 | Wix's rate limits; whether a product keeps its id and slug when a site moves from V1 to V3 |
| W2 | Where a site's "prices include tax" setting is, and whether the API reads it |
| W3 | Whether a subscription carries a date, or a source, anywhere in the API or the contact's activity |
| W4 | The Blog API's rich content: which blocks map to ours |
| W5 | Whether any API returns the site's menu; else the replicator's reading of the header |
| W6 | Old address shapes on ten real Wix shops: `/blank-…`, `/copy-of-…`, hash-bang, renamed prefixes |
| W7 | Wix Reviews: API or file |
| W8 | The product file's columns for V1 and for V3 sites |
| W9 | An end-to-end run against a Wix developer site on each catalogue |

## 15. Tests

As Shopify 15, with Wix's stand-in (`e2e/fixtures/wix-stub.mjs`) answering both catalogues, plus:

- a site that moves from V1 to V3 between Check and Copy;
- a digital product;
- a `PENDING` subscriber who must never be subscribed;
- the hash-bang script on the 404 page;
- a page the replicator keeps partly as a picture.

## 16. What this does not do

As Shopify 16. It also never:

- copies a page a visitor can't see;
- runs Velo code;
- changes a Wix domain's MX records;
- moves Wix Bookings, Events or Pricing Plans in this plan.
