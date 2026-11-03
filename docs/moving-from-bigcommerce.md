# Moving from BigCommerce: one button, nothing lost (D449 proposed)

The BigCommerce counterpart of `docs/moving-from-shopify.md` (D445). The owner (3 November 2026) asked for "similar 'moving from' docs"
for the other platforms, as simple as the Shopify one: "so simple and easy to follow that Homer Simpson could do it without breaking a
sweat."

**This file is a plan only: nothing here is built.** It shares the move engine with the Shopify plan. Where that plan already says it, this
file points there by section and spends its words on what is different for BigCommerce. Section 13 holds the owner's decisions, and
section 14 the spikes to run before code.

---

## 1. The promise

The same as Shopify's (D445, section 1). Homer pastes his BigCommerce shop's address and presses **Connect BigCommerce**, then **Install**
on BigCommerce's own page, then **Copy my shop**. He looks at his new shop behind a password while BigCommerce keeps selling, then presses
**Move my shop**.

Two things are better than on Shopify, and Homer should feel both:

- **His gift cards keep their codes.** BigCommerce lets an app read a gift certificate's code (2.3), so a customer's old code simply works
  here. No new codes are emailed and nobody has to tell anybody anything.
- **His links keep working exactly.** BigCommerce lets the owner shape his own addresses (*Settings → General → URL Structure*), and every
  product, category, brand and page carries its own address in the API. We read each one as it is, not as a pattern, so we can redirect
  each address to the right place.

One thing is slower: BigCommerce gives every store a fixed number of API calls an hour, shared by all its apps (2.3). A big shop takes
longer to read. Homer sees *This takes about 40 minutes for a shop your size. We'll email you.*, and nothing else changes for him.

## 2. What is there today, and what we found

### 2.1 Built

Nothing reads BigCommerce today. The file imports know Kaizena Flow's own product file, Shopify's and WooCommerce's (D165, D384).
BigCommerce's product export (its *Bulk Edit* or *Default* CSV template) is not one of them. The redirect import reads any file with
*Redirect from* and *Redirect to* columns, not BigCommerce's own redirect export (`Old URL`, `New URL`). Everything else that a move
writes into is built, and listed in the Shopify plan, section 2.1.

### 2.2 What hurts a BigCommerce owner today

Everything that hurts a Shopify owner (D445, section 2.2), and also:

1. **There is no file reader for BigCommerce at all.** Homer would have to edit his products into Shopify's columns.
2. **Product options that are not variants** (BigCommerce's *modifiers*: a text field for an engraving, a checkbox for gift wrap, a price
   that changes with a choice) have nowhere obvious to land.
3. **Several storefronts in one store** (BigCommerce's multi-storefront: channels, each with its own site, domain and price lists) don't fit
   one Kaizena Flow store without a question.

### 2.3 What BigCommerce's API allows (read 3 November 2026)

- **Apps and access** (<https://docs.bigcommerce.com/docs/start/authentication/api-accounts>, fetched; callbacks at
  <https://developer.bigcommerce.com/api-docs/apps/guide/callbacks>):
  - An app is a *single-click app*. The merchant presses **Install**, BigCommerce calls our `auth` callback with a code, and we exchange
    it for a permanent access token. `load` (required) is what opens when the owner clicks the app in BigCommerce. `uninstall` and
    `remove_user` tell us when it was removed.
  - Read-only scopes exist for everything we need:
    - `store_v2_products_read_only`
    - `store_v2_orders_read_only`
    - `store_v2_customers_read_only`
    - `store_v2_content_read_only`
    - `store_v2_marketing_read_only`
    - `store_v2_information_read_only`
    - `store_sites_read_only`
    - `store_channel_settings_read_only`
- **Who may install it** (BigCommerce's developer course, <https://docs.bigcommerce.com/developer/learn/courses/intro-to-bc-development/toolkit/apps>):
  a *draft* app installs only on stores owned by the account that registered it. Other merchants need it approved for the App Marketplace.
  Whether an unlisted but approved app is possible was not found (spike B1). Unlike Shopify since 2026, a BigCommerce owner can still make
  a **store-level API account** in his own control panel and paste its token: that stays our fallback (4.2).
- **Rate limits** (<https://docs.bigcommerce.com/docs/start/best-practices/api-rate-limits>):
  - 20,000 requests an hour (150 every 30 seconds) on Standard and Plus, and 60,000 on Pro. Enterprise varies.
  - The quota is the **store's**, shared by every app on it.
  - Each answer carries `X-Rate-Limit-Requests-Left`. A `429` carries `X-Rate-Limit-Time-Reset-Ms`.
  - There is no bulk export like Shopify's bulk operations: everything is read page by page over REST (and the GraphQL Storefront API for
    routes).
- **Catalog V3**: products with variants, options, **modifiers**, custom fields, images, bulk pricing rules, and per-item SEO fields with
  `custom_url` (`url`, `is_customized`); categories (trees per channel), brands, and **price lists** with records per variant and
  currency, assigned to channels and customer groups (<https://docs.bigcommerce.com/developer/api-reference/rest/admin/management/price-lists/get-price-lists>).
  Product **videos are YouTube only**: `type` is `youtube` with a `video_id` (<https://docs.bigcommerce.com/developer/api-reference/rest/admin/catalog/products/videos>).
- **Tax** (`/v3/tax/settings`): `tax_entered_with_prices` says whether prices include tax, plus a price display strategy and zones. Read
  from a third-party mirror, so to be confirmed against BigCommerce's own reference (spike B3).
- **Customers V3**: customers with addresses, groups, attributes and form fields. The customer's own
  `accepts_product_review_abandoned_cart_emails` covers review requests and abandoned cart emails, **not the newsletter**. Consent per
  customer is `/v3/customers/{id}/consent` (allow and deny lists). The **Subscribers** API lists newsletter sign-ups with a `consents`
  array (`marketing_newsletter`, `abandoned_cart`; empty means unsubscribed or never ticked), the date and the channel
  (<https://developer.bigcommerce.com/docs/store-operations/customers>,
  <https://docs.bigcommerce.com/developer/api-reference/rest/admin/management/subscribers/create-subscriber>).
- **Orders V2**: every order of every age, with products, shipping addresses, coupons, refunds and shipments. No 60-day window like
  Shopify's.
- **Gift certificates V2** (<https://docs.bigcommerce.com/developer/api-reference/rest/admin/content/marketing/gift-certificates/get-gift-certificates>,
  fetched): the list returns each certificate's **`code`** ("the saved, truncated code", at most 20 characters), `amount`, `balance`,
  `currency_code`, `status` (`active`, `pending`, `disabled`, `expired`), `expiry_date`, and the recipient's and buyer's name and email.
- **Promotions and coupons**: V3 promotions (automatic and coupon-based) and their codes; V2 coupons for older stores.
- **Content**: web pages (V3 content pages), blog posts (V2 `blog/posts`, with tags, author, `published_date` and `url`), and the
  store's 301 **redirects** (V3 `storefront/redirects`: `from_path`, `site_id`, and a `to` that is a product, brand, category, page, post
  or URL; <https://developer.bigcommerce.com/docs/rest-management/redirects>).
- **Multi-storefront**: channels and sites (V3 `channels`, `sites`), each with its own domain, currencies, category tree and price list.
- **Domains bought through BigCommerce** (BigCommerce's help, <https://support.bigcommerce.com/articles/en_US/Knowledge/Managing-DNS>,
  <https://support.bigcommerce.com/articles/en_US/Knowledge/Changing-Domains>): they are registered through Enom. Nameservers are fixed
  and read-only, but the owner can add and change A, CNAME and TXT records in *Settings → Domains*. Moving the registration away needs the
  domain unlocked and an EPP code, and is blocked for 60 days after registration or a WHOIS change.

## 3. The idea

The same three presses and a move day as Shopify (D445, section 3: Connect, Check, Copy, then Move, Watch, Close), on the same engine:
- `commerce.shop_moves` with `source = 'bigcommerce'` and `commerce.shop_move_items` (D445, section 10);
- only the existing writers write (D445, 8.1);
- silent until Move;
- the address check (D445, 8.2), the reconciliation (8.3) and *Undo this copy* (8.4).

What is BigCommerce's own is a **reader** that turns BigCommerce's API into the move's neutral rows, plus four new answers:

1. Read under a shared quota, politely (8).
2. Bring modifiers over as what they are (5.2).
3. Choose a storefront when there are several (4.3, Decision 2).
4. Bring gift cards over with their own codes (6.2).

A source platform is therefore a reader and its words. That is the line the WooCommerce reader (D384) already drew for files, and every
`moving-from-*` plan follows it.

## 4. What Homer sees

### 4.1 Where he starts

As on Shopify (D445, 4.1). At sign-up, *Do you sell somewhere already?* offers **Yes, on BigCommerce**. The home card, Settings → Moving
in and the AI manager lead to the same page.

### 4.2 Connect

> **Bring your BigCommerce shop**
> Paste your shop's address. We only read it: nothing changes on BigCommerce, and it keeps selling.
> `[ myshop.com                                ]`
> **Connect BigCommerce**

Any address works: his domain, `store-abc123.mybigcommerce.com`, or a product link. From it we find the store's hash (spike B2), then send
him to BigCommerce's install page for our app. He signs in to BigCommerce if he must, presses **Install**, and comes back.

**If our app can't be installed on his store yet** (spike B1: while it waits for BigCommerce's approval), Homer gets the fallback, written
step by step with pictures:

> **One more way in (3 minutes)**
> 1. In BigCommerce, open **Settings → Store-level API accounts → Create API account**. **Open it for me**
> 2. Name it *Kaizena Flow* and set each line to **read-only**, as in the picture.
> 3. Press **Save**, then copy the **Access token** here. `[            ]`
> **Connect**

We check the token's scopes at once and say which line is wrong if one is (*Orders isn't read-only yet: set it and save again*). We never
ask for a scope that can write.

### 4.3 Check: "Here's your shop"

The same report as Shopify's (D445, 4.3), with BigCommerce's own lines:

> **Here's your shop**
> 412 products · 38 categories · 22 brands · 14 pages · a blog with 80 posts
> 3,100 customers · 1,900 of them get your newsletter
> 11,200 past orders · 27 gift cards with money left, **their codes keep working**
> 9 discount codes · 1,450 links from Google and elsewhere that will keep working
>
> **Good to know**
> · Your "retail price" won't show as a sale. In the EU a sale must be compared with your lowest price in the last 30 days.
> · 31 products have choices like engraving or gift wrap. They come over as choices on the product.
>
> **Copy my shop**

**More than one storefront.** Only if his store has several channels with sites, the report asks one question first, with the answer
already chosen:

> **You have 3 shops in BigCommerce. Which ones are moving?**
> ✓ **myshop.com** (Norway, NOK) · ✓ **myshop.se** (Sweden, SEK) · ○ **wholesale.myshop.com** (for businesses)
> They'll be one shop here, selling in Norway and Sweden, each country with its own prices and address.

The default is every storefront that sells to consumers in one shop with one country each (Decision 2), and a business-only storefront
left out and listed, with *Bring it too, as prices for business customers*.

Like Shopify, nothing else is asked. Prices including VAT come from `tax_entered_with_prices`, countries and currencies from the channels'
currencies and price lists, shipping from the shipping zones (spike B4), and his look from the live site and his logo (D330).

### 4.4 to 4.8

Exactly as on Shopify (D445, sections 4.4 to 4.8): *Your new shop is ready to look at*, the checklist (payments first), *Who makes your
products?* asked once per brand (BigCommerce's *Brand* takes Vendor's place: a brand is never turned into a manufacturer without his
**Yes**), the move day, and the 14 days after. Three differences:

- **Gift cards**: the move day screen has no gift card emails (6.2), only a line: *Gift cards: 27 keep working with their codes ✓*.
- **The domain** (4.7 below).
- **Closing**: *You can close BigCommerce now* says how to cancel his apps first, then cancel the plan (*Settings → Account → Cancel*),
  and that BigCommerce may keep his store for a while after (spike B7 says how long, so we can tell him honestly). We keep what we read for
  90 days, as for Shopify.

### 4.7 Switching the address

As on Shopify (D445, 4.7), with BigCommerce's case in place of Shopify's:

| Where the DNS is | What Homer does |
|---|---|
| With us, or Domain Connect | As on Shopify |
| **At BigCommerce** (domain bought through BigCommerce, so Enom, with BigCommerce's nameservers) | Follows our steps written for BigCommerce's own screens (*In BigCommerce, open Settings → Domains → myshop.com → DNS. Change the A record to `…`*), with a **Copy** button for each value. BigCommerce lets him edit A, CNAME and TXT records, which is all we need. We check every 30 seconds and say **Done ✓** ourselves. Before he changes anything, we read his MX and TXT records so his **email keeps working**, and say so: *Your email stays as it is*. *Or let us look after your domain* offers the transfer in (D315), with the 60-day lock and the EPP code explained in one sentence each, if they apply |
| Anywhere else | As on Shopify |

## 5. What comes over

### 5.1 The mapping

Only BigCommerce's own differences are listed. Every row not named here maps as the Shopify plan's table (D445, 5.1) does, through the
same writers.

| BigCommerce | Kaizena Flow | Notes |
|---|---|---|
| Products, variants, options, SKUs, UPC/GTIN, MPN, weights and dimensions | Products and variants | `saveProduct()` |
| **Modifiers** (text, multi-line text, checkbox, date, file, number, and choices that change the price or weight) | Product choices where we have them (spike B5: personalisation fields, add-ons); else custom fields (D118) holding what they were, and a finding | Never dropped silently. A price-changing choice we can't express leaves the product as a draft with the reason |
| Price (with `tax_entered_with_prices`), sale price | Price per country | **Sale price**: a BigCommerce product on sale shows its sale price. We bring over the **price the shopper pays today**, never the list price as a "was" price (98/6/EC Art. 6a) |
| Retail price (RRP), MSRP | — | Never shown as a reduction; said once |
| Cost price | Cost | |
| **Price lists** per currency and channel | The prices of the country that channel and currency became | A price list made for a customer group goes to that group (D108) |
| Bulk pricing rules (quantity breaks) | Quantity rules and tiered prices (D323, D321) | Where they map; the rest listed |
| Categories (a tree per channel) | Categories | One tree; a second channel's extra categories merged by name, and listed |
| Brands | Brands (D204) | Never the manufacturer (4.5 of the Shopify plan, per brand) |
| Custom fields (name and value, shown on the product page) | Custom fields (D118), **shown**, because they were shown on BigCommerce | Unlike Shopify's metafields, which are private |
| Images, alt texts | Media | `safeFetch()` |
| Videos (YouTube) | Gallery videos (D325) as YouTube links | Spike B6: whether D325 takes an embedded YouTube video, or a link under the gallery until it does |
| Product, category, brand and page **`custom_url`** | Each item's old address, kept on its `shop_move_items` row | Every old address redirected to its new one, whatever URL Structure the owner chose |
| Inventory per location (Multi-Location Inventory) | Stock per location (D172) | Older stores have one location |
| Customers, addresses, customer groups | Customers, saved addresses, customer groups (D108) | Form fields and attributes become customer custom fields |
| Newsletter subscribers | Subscribers | Decision 1 (6.1) |
| Orders, refunds, shipments | Order history (`C-{id}`), as D384 | All years: BigCommerce has no 60-day window |
| **Gift certificates** with a balance | Gift cards **with the same code** | 6.2 |
| Promotions and coupons | Discounts (D299) | Switched off until Move; the rules we can't express are listed |
| Web pages, blog posts | Pages, blog articles (D341) | The body as rich text, never as HTML; old `url` redirected |
| Menus | Menus (D85) | Built from the theme's navigation and the categories' menu flags (spike B8) |
| 301 redirects (per site) | Redirects (D168) | `to` an entity is resolved to the entity's new address |
| Product reviews (built in) | Reviews (D301) | BigCommerce's own reviews through the Catalog API; an outside reviews app by its export (spike B9) |
| Store-front theme (Stencil) | Brand and look (D330) | His look comes over, never his theme code |

### 5.2 Modifiers, in Homer's words

A modifier is a question a shopper answers on the product: *Text on the engraving*, *Add gift wrap (+NOK 49)*. On the report Homer sees
*31 products have choices like engraving or gift wrap. They come over as choices on the product.*

- If a choice changes the price, and our product can carry a priced add-on (spike B5), it comes over as one.
- If not, the product comes over as a **draft**, with *This product's "Gift wrap (+NOK 49)" can't be added yet. Make gift wrap its own
  product, or sell it without.* and **Make it its own product** as the one press.
- A choice that never changes the price comes over as a question on the product, always.

## 6. What doesn't come over, and what we do instead

As on Shopify (D445, 6.1): compare-at and retail prices, the payment account (BigCommerce Payments or PayPal; his Stripe account, if
connected there, can't move with him either), apps, visitor analytics, and theme code. Below are only BigCommerce's differences.

### 6.1 The email list (Decision 1)

BigCommerce's record is thinner than Shopify's:
- The Subscribers API says **that** a person agreed (`marketing_newsletter` in `consents`), **when** (the subscriber's date) and **where**
  (the channel or checkout).
- It does not say whether the address was confirmed (no double opt-in level), and it doesn't keep the words they agreed to.

**Recommended**, as for Shopify (D445, 6.2): a subscriber whose `consents` include `marketing_newsletter` becomes a subscriber here with:
- `source` `bigcommerce`;
- `consentedAt` from the subscriber's date;
- `confirmedAt` left empty;
- `consentText` *Signed up for {shop}'s newsletter while it was on BigCommerce, as BigCommerce recorded it*.

The raw record goes into `marketing_consent_events`. An empty `consents` array never subscribes anyone.
`accepts_product_review_abandoned_cart_emails` is **not** newsletter consent and is never read as such. The legal read asked in the
Shopify plan covers this record too, and should say whether a record with no confirmation is enough.

### 6.2 Gift cards keep their codes

Our gift cards never store a code: they store its HMAC (`code_hash`) and `last4` (`commerce.gift_cards`, D300). So an imported card is the
old code, normalised the way our codes are and hashed. The shopper types what is printed on their card, and it works. For each certificate
that is `active` with a balance:

- a card here with the same balance, currency and expiry, its `source` a new value `import` (one migration: the check on `source`, and the
  ledger's opening entry written by the `gift_card_*` functions, never by hand);
- **frozen until Move**, so nobody spends the same balance in both shops; on move day the balances are read again first;
- no email at all, because nothing changed for the holder;
- a code that collides with one of the store's own (unlikely, never impossible) is given a new code instead, and the holder alone gets the
  Shopify plan's email (D445, 6.4).

A `pending` or `disabled` certificate comes over deactivated. An `expired` one doesn't come over, and is listed for the owner.

## 7. The switch day

As on Shopify (D445, section 7), step by step, with two changes:
- **Step 2**: BigCommerce's catch-up reads only what changed since the copy (`date_modified` filters on products, customers and orders),
  so it fits in the quota even for a big shop.
- **Step 6**: gift cards are released with no emails (6.2).

## 8. Robust by construction

D445, section 8, applies whole. BigCommerce's own parts:

- **The shared quota.** We read `X-Rate-Limit-Requests-Left` on every answer and **keep a third of the quota free** for the owner's other
  apps (his payment, shipping and email apps share it), waiting `X-Rate-Limit-Time-Reset-Ms` when we reach our part. A `429` waits as told.
- **The estimate is told up front.** Check counts first (each list's `meta.pagination.total`, a handful of calls), works out how many
  calls a full read takes at his plan's quota, and says how long it will take (4.3).
- **Pages as the unit.** With no bulk export file, each page of 250 items is the unit of work. The job's cursor is kept after each page, and
  each page is kept as a JSON Lines file in the private `imports` bucket, so a run that stops resumes from the next page, and a second run
  reads from the kept files where nothing changed since.
- **One read for each address.** Each product's, category's, brand's and page's `custom_url`, and each redirect's `from_path`, become the
  address check's list, beside the sitemap. The sitemap alone misses addresses an owner hid from it.

## 9. Lisa, one step away

As on Shopify (D445, section 9). Also:
- the storefronts and how each became a country;
- each modifier and what it became;
- each price list and which country or group it fed;
- *Use my own API account instead*, the fallback of 4.2, for a Lisa who prefers her own token.

## 10. Data, permissions and law

As on Shopify (D445, section 10), with BigCommerce's facts:

- **The token** is BigCommerce's access token from the app's OAuth, or the owner's own store-level API account token (4.2). Either is
  encrypted with `SETTINGS_ENCRYPTION_KEY` and deleted when the move is closed or BigCommerce calls `uninstall`.
- **Read-only scopes only** (2.3). A pasted token with a write scope is refused with the line that must change.
- **BigCommerce's privacy obligations for apps**: the app follows BigCommerce's app requirements for removing a store's data on uninstall
  (spike B1 reads the current terms).
- **Where**: BigCommerce's API is called from `dub1`. What we keep is in our EU storage.

## 11. The AI manager

The *Moving in* skill (D445, section 11) learns BigCommerce's words:
- modifiers, price lists, channels, brands;
- the store-level API account steps;
- the DNS steps on BigCommerce's own Domains screen.

It never asks the owner to paste a token into the chat. The token goes only into the Connect page's field.

## 12. Build order

After the Shopify plan's steps 1 to 3 (the address check, the app framework, Check), because the engine is shared:

1. **The BigCommerce reader**: catalogue, customers, orders, redirects and `custom_url`s into neutral rows, under the quota (8). With the
   store-level API account first, since it needs no approval.
2. **Check** for BigCommerce: the report, the storefront question, the estimate.
3. **Copy, part 1**: products (with modifiers as 5.2 says), price lists, customers, orders, redirects.
4. **Gift cards with their codes** (6.2): one migration and the import path in the `gift_card_*` functions.
5. **Copy, part 2**: pages, blog, menus, brands, custom fields, promotions, reviews.
6. **The single-click app**, once BigCommerce approves it (B1), and the domain steps for BigCommerce's DNS screen.
7. **The email list**, once Decision 1 is settled.

## 13. Decisions for the owner

1. **The email list** (6.1): BigCommerce's subscriber record without a confirmation level. Bring it as consent with its source
   (recommended, after the legal read), or ask everyone again.
2. **Several storefronts** (4.3): one shop with a country for each storefront that sells to consumers (recommended), or one Kaizena Flow
   shop per storefront (closer to how they were, but each needs its own plan, payments and checklist).
3. **The app or the token first**: ship with the store-level API account (works at once, three more steps for Homer) while the app waits
   for BigCommerce's approval (recommended), or wait for the app.

## 14. Spikes before code

| # | Question | How |
|---|---|---|
| B1 | Can a single-click app be installed by any store without being listed on the App Marketplace? What does approval take, and what are the current app terms on data removal? | Read BigCommerce's app publishing docs; ask BigCommerce's partner team |
| B2 | From a domain to the store hash with no sign-in | The storefront's HTML (`store_hash`, the CDN's `/s-{hash}/` paths) on ten real shops; else the install page asks |
| B3 | Is `tax_entered_with_prices` on `/v3/tax/settings` as named, and does it differ per channel or zone? | BigCommerce's own reference; a sandbox store set both ways |
| B4 | Shipping zones and methods through the API, and which map to a flat rate per country | `/v2/shipping/zones` on a sandbox store |
| B5 | Do our products have a priced add-on or a personalisation field, or does a modifier need a new kind of choice? | Read the product model; if none, a small plan of its own |
| B6 | Does the product gallery (D325) take a YouTube video? | Read `src/lib/product-media.ts` |
| B7 | How long BigCommerce keeps a cancelled store, and what the owner can still export | BigCommerce's help |
| B8 | Where a store's menu lives (the theme's navigation, the categories' flags, a page's `is_visible`) | A sandbox store with a Stencil theme |
| B9 | Built-in reviews' fields (rating, author, email, date, status) and the reviews apps most stores use | The Catalog API's reviews; a real store |
| B10 | An end-to-end run | A BigCommerce sandbox store with two channels in NOK and SEK, modifiers, price lists for a customer group, gift certificates and 5,000 orders |

## 15. Tests

The Shopify plan's tests (D445, section 15) run for BigCommerce, with a stand-in BigCommerce (`e2e/fixtures/bigcommerce-stub.mjs`) that
also enforces the quota and answers `429`. Also:
- the reader's mapping from fixture pages (`src/lib/move-bigcommerce*.test.ts`);
- each kind of modifier;
- a sale price never becoming a reduction;
- two channels becoming two countries;
- a gift certificate's code working at checkout after Move and not before;
- a colliding code;
- a run that stops at page 17 and resumes at page 18;
- the reader never spending more than its part of the quota;
- a pasted token with a write scope refused.

## 16. What this does not do

Everything the Shopify plan does not do (D445, section 16). And:
- it never writes to BigCommerce, never uses more than its part of the store's quota, and never asks for a scope that can write;
- it never reads `accepts_product_review_abandoned_cart_emails` as marketing consent;
- it never turns a retail price, an MSRP or a brand into anything a shopper reads as a reduction or a manufacturer.
