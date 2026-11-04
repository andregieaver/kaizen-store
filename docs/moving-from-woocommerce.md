# Moving from WooCommerce: one button, and the WordPress site may stay (D446 proposed)

The owner (3 November 2026) asked for a "moving from" plan per platform, like `docs/moving-from-shopify.md` (D445), "so simple and easy to
follow that Homer Simpson could do it without breaking a sweat". This is WooCommerce's.

**This file is a plan only: nothing here is built yet.** The move engine is the one D445 plans. This file does not describe it again, and
refers to it by section ("Shopify 8.2"):

| Part of the engine | Where in the Shopify plan |
|---|---|
| The three presses, Connect, Check and Copy, then Move | 3 |
| `commerce.shop_moves` and `shop_move_items` | 10 |
| The writers-only rule, running again changes nothing, resumable, silent until Move | 8.1 |
| The address check | 8.2 |
| The reconciliation | 8.3 |
| *Undo this copy* | 8.4 |
| The email list | 6.2 |
| Gift cards | 6.4 |
| The 14 days after | 4.8 |

Everything here is what is **different** for WooCommerce. Section 13 holds the owner's decisions and section 14 the spikes.

---

## 1. The promise

Homer has a WordPress site with WooCommerce in it. He pastes the site's address and presses **Connect WooCommerce**. WordPress asks him
to approve once. He presses **Copy my shop**. His new shop is ready behind a password while WooCommerce keeps selling.

Then **one question nobody on Shopify gets**:

> **Keep your WordPress site?**
> **Move everything**: your whole site moves here, and you can switch WordPress off.
> **Keep WordPress for my pages and blog, move only the shop**: your shop moves here, your WordPress pages show your products from the
> new shop, and *Add to cart* goes to the new shop.

Whichever he picks, he presses **Move my shop**. His products, customers, orders, coupons, reviews and old links come over, and the switch
is guided step by step at his web host.

He never installs anything by hand, never makes an API key, never downloads a file, and never reads "REST", "consumer secret",
"permalink" or "DNS".

## 2. What is there today, and what we found

### 2.1 Built

| Piece | Where | What it leaves to the owner |
|---|---|---|
| WooCommerce's product file (D384) | Products → Import, `src/lib/product-csv-woocommerce.ts` | Exporting it. **A product's address is guessed** from its name (`wooSlug()`, D384 course change 2), because the file has no address column |
| Customers from a file (D366) | Customers → Import | Its headings are Kaizena Flow's own or Shopify's, **not WooCommerce's**: WooCommerce has no customer export in core |
| Order history (D384) | `readShopifyOrders()` | **Shopify's order file only.** No WooCommerce order history at all today |
| Redirects (D168) | Redirects → Import | A file with *Redirect from* and *Redirect to* |
| The WordPress plugin (D169, D170) | `wordpress-plugin/kaizen-store/` | Shows a Kaizena Flow store's products on a WordPress site, with a product page and a cart that hands over to the store's checkout. That is the "keep WordPress" half of section 4.6, already built |
| The page replicator (D150) | | One page at a time |

### 2.2 What WooCommerce allows (read 3 November 2026)

- **Access without the owner making a key**
  (<https://woocommerce.github.io/woocommerce-rest-api-docs/>, fetched): an app sends the owner to
  `{site}/wc-auth/v1/authorize?app_name=…&scope=read&user_id=…&return_url=…&callback_url=…`.
  - The owner approves on his own site.
  - WooCommerce POSTs `consumer_key`, `consumer_secret` and `key_permissions` to our `callback_url`, which must be HTTPS.
  - `scope=read` gives a read-only key.
  - Calls then use HTTP Basic over HTTPS. A site still on plain HTTP needs OAuth 1.0a one-legged, with HMAC-SHA1 or SHA256 and a
    15-minute timestamp window.
- **What the WooCommerce API reads** (v3, same page):
  - products, variations, attributes and their terms, categories, tags, shipping classes, reviews;
  - orders, order notes, refunds;
  - customers, coupons;
  - tax rates and classes, shipping zones and their methods;
  - settings (where *prices entered with tax* lives), payment gateways;
  - countries and currencies.
  - Pages hold 10 by default, set by `per_page`, with totals in `X-WP-Total`. A product carries its real `permalink` and `slug`, so
    **the API ends D384's guessing**.
- **WordPress content** (<https://developer.wordpress.org/rest-api/reference/>, fetched): posts, pages, media, categories, tags,
  comments, users and settings at `/wp/v2/…`. The reference page lists **no menu routes**. WordPress 5.9 added `/wp/v2/menus` and
  `/wp/v2/menu-items` behind sign-in, and block themes keep menus as `wp_navigation` posts (spike W3).
- **WordPress application passwords**
  (<https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/>): since 5.6, an app sends the owner to
  `wp-admin/authorize-application.php`. On approval, `success_url` (HTTPS only) receives `site_url`, `user_login` and `password`. That is
  how we read WordPress's own routes, private pages and drafts. WooCommerce's key reaches only `/wc/v3`.
- **What core WooCommerce does not have**, each a plugin when the shop has it:
  - **Gift cards**: WooCommerce's *Gift Cards* extension, PW Gift Cards, YITH and others, each with its own tables and its own routes or
    none.
  - **Subscriptions**: WooCommerce Subscriptions keeps the payment provider's ids (`_stripe_customer_id`, and `_payment_method_id` or
    `_stripe_source_id`) on each subscription
    (<https://woocommerce.com/document/subscriptions/migrating-subscribers-woocommerce-subscriptions/>).
  - **Email consent**: there is no consent field in core. MailPoet's checkout box puts a customer on its *WooCommerce Customers* list as
    *Unconfirmed* until they confirm (<https://kb.mailpoet.com/article/385-adding-an-opt-in-checkbox-to-the-woocommerce-checkout-page>).
    Mailchimp for WooCommerce, Klaviyo and others keep consent outside WordPress altogether.
  - **Redirects**: none in core. They live in the *Redirection* plugin, Yoast SEO Premium or Rank Math, each with a CSV export in its
    admin (<https://rankmath.com/kb/how-to-manage-redirects-via-csv/>, <https://yoast.com/features/redirect-manager/csv-import-export/>)
    and, as far as their documentation says, no public API for it.
- **No platform behind it.** Every shop is self-hosted: its own server, PHP version, security plugins, caching plugins (which may block or
  cache the API), and DNS wherever the owner's host or registrar keeps it. **No two WooCommerce shops are alike.** That is the main
  difference from Shopify, and it shapes this plan.

## 3. The idea: a small plugin of our own does the reading

The REST API alone reaches the core shop. It cannot reach:
- gift card codes and balances;
- MailPoet's consent record;
- redirects;
- menus on older sites;
- the SEO plugin's titles and descriptions.

It also breaks where a security plugin blocks `/wp-json`. So **Connect installs a small read-only plugin of ours**, the *Kaizena Flow
mover*, from WordPress.org (spike W1), with one press.

The plugin:
- serves one signed route, `/wp-json/kaizena-mover/v1/…`, with what we need, paged;
- reads only. It writes nothing in WordPress except its own settings and token;
- tells us which plugins the shop uses, so Check knows what it can read;
- is removed with one press after the move.

**The fallback is the plain path:** the WooCommerce key from `wc-auth` plus an application password, without our plugin, for an owner
who won't install one. It reads the core shop, and the report says what it couldn't read. Files (D384) stay as the last fallback.

It may become our existing WordPress plugin (D169) with a mover section, instead of a second plugin. That is Decision 1. The case for
one plugin: an owner who keeps WordPress (4.6) needs D169's plugin afterwards anyway, so one install does both jobs.

## 4. What Homer sees

### 4.1 Where he starts

The same places as Shopify (Shopify 4.1). Sign-up's *Do you sell somewhere already?* adds **Yes, on WooCommerce (WordPress)**.

### 4.2 Connect

> **Bring your WooCommerce shop**
> Paste your website's address. We only read it: nothing changes on your site, and it keeps selling.
> `[ myshop.com                                ]`
> **Connect WooCommerce**

What happens behind the button:
1. We check that the address is WordPress with WooCommerce: `/wp-json/` names `wc/v3`.
2. We send him to his own WordPress to sign in, if he isn't already, and to **install our mover**. This is a one-press link to the plugin's
   install screen (*Plugins → Add New*, prefilled; spike W1).
3. The mover's own screen shows one button: **Allow Kaizena Flow to read my shop**. That creates the read-only connection and sends him
   back.

If his user can't install plugins (a shop run by an agency or a web host), the plain path asks him to approve the WooCommerce key
instead, which is one *Approve* on WooCommerce's own screen.

When something goes wrong, there is one sentence and one button:

| What went wrong | What Homer sees |
|---|---|
| A security plugin blocks the API | *Your site's security plugin {name} stopped us. Turn on "{the setting}" in {name}, or ask whoever looks after your site to.* **Try again**. We know the five most common plugins by name (spike W2) |
| The site is on plain HTTP | *Your site needs a padlock (HTTPS) before we can read it safely. Your web host can switch it on, usually for free.* (We never send a key over HTTP, even though WooCommerce allows OAuth 1.0a there) |
| A caching plugin serves stale answers | We ask with headers that bypass the cache. If that fails, the report says which plugin and what to switch off for an hour |

### 4.3 Check: "Here's your shop"

The same report as Shopify 4.3, with WooCommerce's words. Homer is again asked nothing:

| Today's question | Where the answer comes from |
|---|---|
| Do prices include VAT? | WooCommerce's *Prices entered with tax* setting (`woocommerce_prices_include_tax`) |
| Which countries, which currency? | The shop's currency and its *Selling location(s)*, plus WPML/WooCommerce Multilingual or Aelia currency switcher prices where the mover finds them (spike W5) |
| Shipping | Shipping zones and their methods: flat rate, free shipping above an amount, local pickup |
| VAT treatment of a product | Its *tax status* and *tax class* (zero-rate and reduced-rate classes become VAT categories where they match D65's; the rest are said) |
| Look | The site's logo, colours and fonts, from its theme settings and the live pages (D330) |

*Good to know* (at most three) is WooCommerce's own:
- *Your sale prices won't show as sales* (as on Shopify).
- *We found 3 grouped products: each product in them comes over on its own.*
- *Your gift cards are in {plugin}: we'll give each one a new code.*

### 4.4 Copy, then "Your new shop is ready"

As Shopify 4.4 and 4.5: the checklist (payments first) and **Who makes your products?** once per brand. WooCommerce has no Vendor field.
The brand comes from a *Brand* attribute or taxonomy where there is one (WooCommerce Brands, Perfect Brands), else the question is asked
per category.

### 4.5 The one question: keep WordPress?

Asked after Copy, because by then Homer has seen his new shop and can judge:

> **Keep your WordPress site?**
>
> **Move everything** (recommended if WordPress is only your shop)
> Your pages and blog come here too. After the move you can switch WordPress off and stop paying for its hosting.
>
> **Keep WordPress for my pages and blog**
> Your shop moves here, and your WordPress pages show your products from the new shop. Your blog stays where it is.

The recommendation is chosen for him from what Check found: a site with fewer than 10 pages and no blog posts in the last year gets *Move
everything* as the default. Otherwise the two are shown without a default and with one line each on what changes.

### 4.6 Keep WordPress: what changes

"Keep WordPress" is a real choice, because the WordPress plugin (D169, D170) already draws products, a product page and a cart that
hands over to our checkout. The move then:
- sets the WordPress plugin up for him: the mover becomes it, or installs it (Decision 1). It connects the plugin to the new store, makes
  one saved view per old WooCommerce category, and points the shop's old product pages at D170's product page;
- **switches WooCommerce's shop off** on move day without deleting it: the mover puts the shop pages into "moved" mode, and each
  `/product/{slug}` and `/product-category/{slug}` answers with a permanent redirect to the new store. Deactivating WooCommerce itself is
  left to the owner, later (4.8);
- moves the shop to its own address. The natural choice is `shop.{his domain}`, offered with **Use shop.myshop.com**, because his main
  domain stays on WordPress.

### 4.7 Move day

As Shopify 4.6 and section 7, with two differences.

**First, where the domain lives.** For *Move everything*, the domain moves to us. For *Keep WordPress*, only `shop.` points at us, which
is one new record and **nothing on his WordPress site changes**. Homer sees the same list as Shopify 4.7, with the most common EU web hosts
written out (one.com, Domeneshop, Hostinger, Loopia, IONOS, SiteGround, WP Engine; spike W4). Some of them support Domain Connect.

**Second, the catch-up.** It reads orders modified since Copy (`modified_after`), not only new ones, because WooCommerce shops often edit
orders by hand.

### 4.8 After the move

As Shopify 4.8. *You can close WooCommerce now* depends on the choice:
- **Move everything**: *Keep your WordPress site running for 30 days so old links still reach us, then cancel your hosting.* Each old
  address is redirected by the mover in those 30 days, and by our own proxy once the domain points here.
- **Keep WordPress**: *You can deactivate WooCommerce now.* **Show me how**. The mover's redirects stay as long as the plugin does.

## 5. What comes over

Only what differs from Shopify's mapping (Shopify 5.1). Every row goes through the existing writer.

| WooCommerce | Kaizena Flow | Notes |
|---|---|---|
| Simple and variable products, variations, attributes | Products, variants, options | As D384's reader, from the API instead of a file. The address is the real `permalink`, not a guess |
| Grouped products | Each child on its own; the group becomes a category of its own | Said once |
| External/affiliate products | — | Listed, never bought here |
| Virtual and downloadable products | Downloads where we have them; virtual becomes "no shipping" | The files are fetched through `safeFetch()` from the shop's download URLs |
| Regular and sale price | The price (sale price while its dates hold); never compare-at | As D384 |
| Tax status and tax class | VAT category (D65) where the class matches one, else standard, and listed | Never "exempt" from tax status alone (D165's rule) |
| Product categories with parents | Categories with levels, description, picture, SEO texts | `/product-category/{slug}` redirected |
| Brands (WooCommerce Brands or a Brand attribute) | Brand, **never manufacturer** | Section 4.4 |
| Product meta / ACF fields | Custom fields (D118) | Private until the owner chooses. Internal keys (`_edit_lock`, …) never |
| Yoast/Rank Math title and description | SEO texts | Through the mover |
| Customers (registered), billing and shipping addresses | Customers, saved addresses | **Guest buyers** are not customers in WooCommerce. They come over as customers made from their orders' emails only when Decision 3 says so |
| Orders, all statuses, refunds, notes from the shop | Order history (`C-{number}`) | A reader `readWooOrders()` beside `readShopifyOrders()`. `pending` and `failed` orders are skipped and counted. Customer notes are kept, private notes not (personal data the order history doesn't need) |
| Coupons | Discounts (D299), off until Move | Percent, fixed cart and fixed product, with usage limits, minimum spend, product and category limits and expiry. The rest are listed |
| Reviews | Reviews (D301) | Verified-owner flag kept. Ratings without text kept as ratings |
| Gift cards (by plugin) | New gift cards, same balance and expiry | As Shopify 6.4. The mover reads balances from the plugin's own tables (spike W6) |
| MailPoet or core checkout opt-in | Subscribers | Section 6.2 |
| Pages, posts, media (Move everything) | Pages, blog articles (D341), media | Block content becomes our blocks where they map (paragraph, heading, image, list, quote, gallery, columns), else rich text. Shortcodes are stripped and listed |
| Menus | Menus (D85) | Links rewritten to the new shop |
| Redirects (Redirection, Yoast, Rank Math) | Redirects (D168) | Read by the mover from each plugin's own table |
| Users (shop managers) | — | Never. Staff are invited here (D158) |

## 6. What doesn't come over, and what we do instead

### 6.1 Said once, plainly

| Left behind | What we say and do |
|---|---|
| WooCommerce Payments, the Stripe and Klarna plugins | *Connect payments here.* Their keys never move |
| Plugins | A list from the mover, with ours beside each where we have one (*WooCommerce Subscriptions → Subscription boxes*, *YITH Wishlist → nothing here yet*). Never a guess |
| Theme, PHP, shortcodes, page builders (Elementor, Divi) | The look comes over (D330), not the code. Elementor and Divi pages are copied by the page replicator (D150) from the live page, not from their data |
| Subscriptions with saved cards | Spike W7. WooCommerce Subscriptions keeps Stripe's customer and payment method ids. If the owner's Stripe account is the same one he connects here, the ids may carry over with Stripe's help; otherwise each subscriber is invited to sign up again. Listed with the next date until then |
| Multisite, several shops on one WordPress | One shop per move. The report names the others |

### 6.2 The email list

Shopify gave evidence. WooCommerce usually doesn't, so the rule is stricter:
- **MailPoet** `Subscribed`, with its subscription date and source: imported as Shopify 6.2 recommends (Decision 1 of D445 settles both
  plans), with `source` `woocommerce`. MailPoet's `Unconfirmed` is not subscribed.
- **Mailchimp or Klaviyo**: the list isn't in WordPress. The report says *Your email list is in Mailchimp* and offers what D295 already
  has: the list stays there, or he exports it, and it is read as Shopify 6.2 would read it only if the file carries status and date
  (Decision 2).
- **Nothing found**: nobody is subscribed. The report says so in one line.

## 7. Move day, what differs

1. **Stock and orders.** WooCommerce has no "freeze". The catch-up reads orders changed since Copy, and the mover can put the shop into
   *catalogue mode* for the minutes of the switch (*Add to cart* hidden, a notice *We're moving: back in 10 minutes*). This is Decision 4;
   the recommendation is yes.
2. **The old addresses.** For *Move everything*, the mover turns the WordPress site into a redirector for 30 days: each product, category,
   page and post answers `301` to its new address, from the address check's own list. This covers visitors whose DNS hasn't switched yet,
   and any address our proxy would not see.
3. **The domain** (4.7).

## 8. Robust by construction

Everything in Shopify 8 holds. On top:
- **Every WooCommerce shop is different**, so Check is a real dry run of the reading too. It reads one page of every kind first, and
  stops with a plain sentence if a kind can't be read. It never fails halfway through Copy for a reason Check could have found.
- **The mover is read-only by construction.** Its routes are `GET`, it checks our signature and its own token on every call, and its only
  writes are its settings and, on move day, the redirect list and catalogue mode, both turned on by the owner's press, both undone by
  *Undo*.
- **Slow hosts.** Small pages (`per_page` 50), at most two calls at once, and waits after a `429` or `503`. A shared host is not a Shopify.
  A shop of 5,000 products may take an hour to read, and the screen says so instead of looking stuck.

## 9. Lisa, one step away

As Shopify 9, plus:
- *Which plugins did you find?* — the mover's list.
- The tax class to VAT category mapping.
- The block to builder-block mapping per page.
- *Keep WordPress* settings: which views were made, which old addresses redirect.

## 10. Data, permissions and law

As Shopify 10, plus:
- **The keys we hold**: the mover's token and, on the plain path, the WooCommerce key and the application password. Each is encrypted
  (`secret-box.ts`). Each is revoked when the move is closed: we delete the WooCommerce key through its own route, and the application
  password and the mover's token by the mover's *Disconnect*. Each is shown to the owner under Lisa's details with *Disconnect*.
- **The mover plugin**: GPL, as WordPress.org requires. It is built by a script to the same bytes every time, with a test that fails when
  it isn't the plugin as it is (D169's rule). Its readme says plainly what it reads and that nothing leaves the site except to Kaizena Flow
  over HTTPS.
- **Guest buyers' data**: an order's buyer comes over inside the order history (D384), never as a customer, unless Decision 3.

## 11. The AI manager

The *Moving from Shopify* skill becomes *Moving from another shop*, with the platform as a fact, not a second skill. On WooCommerce it
also explains:
- the *keep WordPress* choice;
- the security plugin's setting;
- the web host's DNS steps.

It never installs or removes a plugin.

## 12. Build order

D445's steps 1 (the address check and reconciliation) and 7 (move day) are shared, and built once.

1. **The plain path**: `wc-auth` read key, Check and Copy of products, customers, orders, coupons and reviews. `readWooOrders()`
   replaces the gap in 2.1.
2. **The mover plugin**: one-press install, its route, plugins found, redirects, SEO texts, gift cards, MailPoet.
3. **WordPress content**: pages, posts, media and menus for *Move everything*.
4. **Keep WordPress**: the D169 set-up, the shop's "moved" mode, `shop.` subdomain.
5. **Move day's WooCommerce parts**: catalogue mode, the 30-day redirector.

## 13. Decisions for the owner

1. **One plugin or two**: the mover as a part of the existing WordPress plugin (D169), recommended because a *Keep WordPress* owner needs
   it anyway, or a separate plugin used once and removed.
2. **An email list from Mailchimp or Klaviyo**: read their export with status and date as evidence (as D445 Decision 1), or leave the
   list where it is.
3. **Guest buyers**: make customers of them from their orders' emails (they can then sign in and see their orders), or keep them in order
   history only (recommended: a customer who never made an account didn't ask for one).
4. **Catalogue mode for the switch**: yes (recommended), or keep selling on WooCommerce through the switch and catch up after.
5. **WordPress.org listing**: list the plugin there (one-press install from his own admin, needs WordPress.org's review), or a zip from
   us (two steps more for Homer). Recommended: WordPress.org.

**The owner's answers (4 November 2026):**
- Decision 1: **one plugin**. The mover is a part of the existing WordPress plugin (D169).
- Decision 2: open; asked when the email list is built (step 2).
- Decision 3: **order history only**. Guest buyers never become customers.
- Decision 4: **pause buying** (catalogue mode) for the switch.
- Decision 5: **a zip from us**, not a WordPress.org listing. Connect links to the zip and to *Plugins → Add New → Upload Plugin* on the
  owner's own site, with the steps written out; spike W1 is no longer needed. Until the mover is built (step 2), step 1's plain path
  (WooCommerce's own read-only key) works without any plugin.

## 14. Spikes before code

| # | Question | How |
|---|---|---|
| W1 | One-press install of a WordPress.org plugin from an outside link | `wp-admin/plugin-install.php?tab=plugin-information&plugin={slug}` on a fresh site, and with the common security plugins |
| W2 | Which security plugins block `/wp-json`, and the setting that allows it | Wordfence, Solid Security, All In One WP Security, Sucuri, Cloudflare's WAF |
| W3 | Menus: `/wp/v2/menus` on classic themes, `wp_navigation` on block themes | A classic and a block theme site, WordPress 6.x |
| W4 | DNS at the common EU hosts: steps and Domain Connect support | one.com, Domeneshop, Hostinger, Loopia, IONOS, SiteGround, WP Engine |
| W5 | Multi-currency and multi-language: WPML/WooCommerce Multilingual, Polylang, Aelia, CURCY | What their data looks like and what maps to our countries and languages |
| W6 | Gift card plugins' tables: WooCommerce Gift Cards, PW Gift Cards, YITH | Balances, expiry and holder email for each; whether codes are readable (if they are, keep the old codes, Decision 2 of D445 changes for them) |
| W7 | WooCommerce Subscriptions with Stripe: can a subscription's Stripe ids continue under the owner's Stripe account connected here? | Stripe Connect's terms for an existing account; a test with a Stripe test account |
| W8 | Large shops on shared hosting | 5,000 products and 50,000 orders on a cheap host: time and errors |
| W9 | HPOS (WooCommerce's own order tables) and the old post-based orders | The REST API answers both, but the mover's direct reads must handle both |

## 15. Tests

As Shopify 15, plus:
- **A stand-in WooCommerce** (`e2e/fixtures/woocommerce-stub.mjs`) answering `/wc/v3`, `/wp/v2` and the mover's route, including a
  blocked API, plain HTTP and a slow host.
- **The mover plugin's own PHP tests**, for its read-only routes and signature check, and the bytes test (D169's).
- **Pure readers**: `readWooOrders()` and the block-to-builder mapping, with fixtures from real exports.
- **Keep WordPress end to end**: the views are made, an old `/product/{slug}` redirects, and *Add to cart* lands in the new store's cart.

## 16. What this does not do

- It never changes the WordPress site except through the mover, by the owner's press, and only to point old addresses at the new shop or
  pause the shop for the switch.
- It never deactivates WooCommerce or deletes anything on the site.
- It never moves a WordPress user, a password, a payment plugin's key or a saved card.
- It never runs PHP, shortcodes or theme code from the old site.
- It never subscribes anyone without a record of their consent.
