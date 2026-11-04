# Moving from WooCommerce: one button, and the WordPress site may stay (D446 proposed)

The owner (3 November 2026) asked for a "moving from" plan per platform, like `docs/moving-from-shopify.md` (D445), "so simple and easy to
follow that Homer Simpson could do it without breaking a sweat". This is WooCommerce's.

**Steps 1 to 2b are built (section 17); the rest is a plan.** The move engine is the one D445 plans. This file does not describe it again, and
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
- Decision 2: **read their export** (answered 4 November 2026): a Mailchimp or Klaviyo export counts only with a subscribed status and its
  date.
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

## 17. As built

### Step 1: the plain path (4 November 2026)

What it is: *Connect WooCommerce*, *Copy my shop* and *Bring it over* for products (with their variations and categories), customers,
past orders and coupons, through WooCommerce's own read-only key. No plugin is needed for this step.

- **Connect** (`src/lib/woocommerce.ts` pure, `src/server/woocommerce-connect.ts`):
  - A second card on Settings → Moving in, *Bring your WooCommerce shop*: the owner types any address of his site.
  - The site's REST root (`/wp-json/`, else `/?rest_route=/` for a site without pretty addresses) must name `wc/v3`. The address
    WordPress gives itself settles the folder it lives in (`siteFromIndex()`).
  - The owner then approves a `scope=read` key on WooCommerce's own *authorize* page (`wc-auth`) on his site.
  - WooCommerce posts the key to `/api/woocommerce/callback` with a note sealed here (`user_id`: the store, the owner, the site, 60 minutes).
    The post comes from WooCommerce's server, not the owner's browser, so the owner is checked again from the note (`passMembership()`).
  - A key that can write is refused. The key is tried once (`woocommerce_currency`) and kept encrypted in `shop_moves` (`source`
    `woocommerce`, `shop_domain` the site's host and folder, `scopes` `read`).
  - A store moves from one shop at a time: connecting WooCommerce or Shopify is refused while the other is connected (`other_shop`).
- **Every call to the site** goes through `safeFetch()` (any host the owner names, never a private network), over HTTPS, with the key as
  HTTP Basic. `safeFetch()` gained `headers`, sent only to the first request's origin, never after a redirect to another. When a host drops
  the `Authorization` header, the key is sent in the query instead, as WooCommerce allows over HTTPS.
- **The copy** is D445's engine (`src/server/shopify-copy.ts`), now for whichever shop is connected (`copySource()`); only the reading
  differs (`readWoo()` beside `readShopify()`):
  - Each feed is read a page of 50 at a time, oldest first. A tick reads at most 8 pages or 20 seconds, keeping the lines between ticks in
    a part file in the imports bucket.
  - The pages are written as the lines Shopify's bulk reads give (`src/lib/woocommerce-copy.ts`), so `fileOfFeed()`, the imports, their
    dry runs, *Bring it over*, *Undo this copy* and the import pages carry over unchanged. Files are named `woocommerce-*.csv`.
  - **Products** keep their real address (`slug`; D384's guessing ends here). Their variations are read beside each page. The price is
    what it sells for now, never a compare-at price. Stock is copied where WooCommerce manages it, and the weight in the shop's unit.
    Published products are live; drafts, pending and private ones come as drafts. Grouped products (their products come on their own) and
    external ones stay, counted in the log.
  - **Categories** come from the products' own lines (`collectionLines()`), flat by name, through the product import (`later`).
  - **Customers**: registered ones, with their billing address. Guest buyers stay in the order history only (Decision 3). No consent is
    written: WooCommerce records none.
  - **Orders**: completed is fulfilled; processing and on hold are paid; cancelled and refunded are cancelled. Pending, failed, drafts and
    the bin stay. A line is at its price before the coupon, as WooCommerce's line subtotal says.
  - **Coupons** become step 5b's discount lines (`couponLine()`), saved switched off by `saveDiscount()`: percent and fixed-cart coupons,
    with minimum spend, usage limits, expiry, *Individual use only* and the products and categories they are limited to. A fixed-per-product
    coupon, one limited to some customers' emails, or one excluding products is said and left.
  - *Prices entered with tax* and the currency come from WooCommerce's own settings (`wooPrices()`).
- **The page** shows only the parts step 1 brings, says the rest come later, and words the problems of WooCommerce, not Shopify
  (`copy.problemsWoo`). *Details* holds *Undo this copy*. *Disconnect* forgets the key and says where the owner removes it on his site
  (WooCommerce → Settings → Advanced → REST API): WooCommerce has no route to delete a key from outside.
- **Tests**: `woocommerce.test.ts` (addresses, the REST root, the note, the key), `woocommerce-copy.test.ts` (each converter read back by
  the import's own reader: `productsFile()`, `collectionsFile()`, `customersFile()`, `ordersFile()` with `readShopifyOrders()`, and the
  coupons), and `woocommerce-copy.int.test.ts` end to end against a stand-in site: connect, copy, bring over, undo, disconnect.

Migration version: `20261104161134_woocommerce_moves` (`shop_moves` takes `source` `woocommerce`, and a site's host and folder as its
address).

### Step 1b: reviews (4 November 2026)

- A copy part of its own, `reviews` (`FEED_KIND` `direct`), read from `wc/v3/products/reviews` (`status=all`), a page at a time with the
  handles of the products they are about read beside each page.
- `reviewLines()` keeps WooCommerce's *approved* reviews (shown there) and *hold* ones (waiting there), each with its stars, the reviewer's
  name, the words as plain text (`htmlToText()`) and its day. Spam and the bin stay, and so do reviews without stars, of a product not
  read, or without a name; all are counted in the log.
- At *Bring it over* they are written only by the review import's own writer (`importReviews()`, D301 G3b) from its own file
  (`reviewsFile()`), as `import` reviews from *WooCommerce*: the approved ones published, the held ones waiting for the owner, 2,000 a
  tick. A review already here is not added twice (the import's own key), and a row it refuses is counted.
- **Never a verified purchase.** WooCommerce's *verified owner* is not carried: here a review is verified only when it is a buyer's of an
  order line in this store (D301), and the storefront says which are which. The plan's "verified-owner flag kept" (section 5) is dropped.
- The store must take reviews (feature `reviews`); otherwise the part says so (`feature_off`) and nothing is written.
- `importReviews()` now returns the ids it wrote, and *Undo this copy* deletes exactly those (`shop_move_items` kind `review`) as a
  mistaken import is deleted (`kaizen.review_delete`).
- Shopify's copy has no reviews of its own: the part is empty there and not listed.
- Tests: `woocommerce-copy.test.ts` reads the file back with `readReviewFile()`; `woocommerce-copy.int.test.ts` brings an approved, a held
  and a spam review over and undoes them.

Migration version: `20261104170733_woocommerce_reviews` (`shop_move_items` takes the kind `review`).

### Step 2a: our plugin reads what WooCommerce's key cannot (4 November 2026)

Decision 2 answered (4 November 2026): **read their export**. A Mailchimp or Klaviyo export is read as evidence only when it carries a
subscribed status and its date (step 2b).

- **The mover is our WordPress plugin** (Decision 1), 1.3.0: `includes/class-kaizen-store-mover.php`, installed from our zip (Decision 5).
- **Connecting it** is `wc-auth`'s shape:
  - *Connect the plugin* on the WooCommerce card opens the plugin's page *Move to Kaizena Flow* on the owner's site, with a note sealed
    here (`sealMoverState()`: the store, the owner, the site, 60 minutes).
  - The owner presses Allow there. The plugin makes a secret (32 random bytes, hex) and posts it with the note, server to server, only to
    the Kaizena Flow address it is set up with (`Kaizen_Store_Settings::api_url()`), never to one from the link.
  - `/api/woocommerce/mover` (`finishMoverConnect()`) checks the note, the owner again (`passMembership()`) and the site. It tries the
    secret with one signed call before keeping it encrypted in `shop_moves.mover_secret`, then sends the owner back.
- **Every call is signed:** HMAC-SHA256 over `{time}\n{method}\n{route}\n{query}`, the query sorted and RFC 3986 encoded
  (`moverSignature()`; PHP `verify()`, held equal by `woocommerce-mover.test.ts`, which runs the plugin's PHP). The plugin refuses a call
  more than five minutes off. The routes (`/wp-json/kaizena-mover/v1/…`) are `GET` and only read:
  - `plugins`: each active plugin's folder and name. The page lists them with what becomes of the ones we know (`KNOWN_PLUGINS`).
  - `redirects`: Redirection's, Rank Math's and Yoast SEO Premium's, 500 a page. Patterns stay; exact ones go to the redirect import.
  - `seo`: Yoast's or Rank Math's own title and description of up to 100 products. One with a variable (`%%title%%`) is left. They come
    with the products into the product import's SEO columns.
  - `subscribers`: MailPoet's *subscribed* only, with when they subscribed and whether MailPoet recorded a confirmation. *Unconfirmed* is
    not subscribed.
- **The copy** gains `redirects` and `subscribers` for a WooCommerce shop once the plugin reads (`WOO_MOVER_FEEDS`). The subscribers go
  through the email list's own writer as Shopify's do, with `source` `woocommerce` and MailPoet's record as the words kept with the consent
  (`movedConsentText(…, "woocommerce")`). Their first broadcast says the shop moved, as Shopify's do.
- *Stop the plugin reading* forgets the secret here; the plugin's *Stop Kaizena Flow reading* forgets it there; uninstalling the plugin
  deletes it; *Disconnect* forgets it with the key.
- Tests: `woocommerce-mover.test.ts` (the signature both ways, the note, each answer's reader) and `woocommerce-mover.int.test.ts` (connect
  through the real route against a stand-in that checks every signature, then redirects, subscribers and SEO words brought over).

Migration version: `20261104173022_woocommerce_mover` (`shop_moves.mover_secret`, and `woocommerce` a subscriber's source).

**Every Yoast and Rank Math field, preserved** (4 November 2026, the owner's ask; plugin 1.3.1):
- The plugin's `seo` (products) and `seo_terms` (product categories) routes read every field of both plugins: the title and description,
  focus keyword, canonical address, robots (Yoast's two flags or Rank Math's list), the Facebook and X titles, descriptions and pictures,
  the breadcrumb title and the primary category (by name). Yoast's keys are read first, then Rank Math's.
- A title or description written with the plugin's variables (`%%title%% %%sep%% %%sitename%%`, `%title%`) is expanded on the site by the
  plugin's own function (`wpseo_replace_vars()`, `RankMath\Helper::replace_vars()`). That is the text shoppers saw, and it becomes the
  product's or category's own SEO title and description here. One that cannot be expanded is not taken as the words, but is still kept as
  written.
- Every field, as the plugin kept it, goes into a custom field group *SEO from Yoast / Rank Math* (`seo-from-wordpress`, on products and
  categories, every field private, in the editor's side column), made once by `saveFieldGroup()`. The values are written by
  `saveFieldData()` (products) and `saveTermFields()` (categories): a copy part of its own, `seo`, after the products and categories are in.
- A category's own SEO title and description are written by the taxonomy's writer (`updateTerm()`, nothing else of the category changed),
  only where it has none of its own yet.
- *Undo this copy* deletes the group with what was written in it (`shop_move_items` kind `field_group`).
- WooCommerce's default category, *Uncategorized*, no longer comes over as a category.

Migration version: `20261104185119_woocommerce_seo_fields` (`shop_move_items` takes the kind `field_group`).

### Step 2b: gift cards and an email list outside WordPress (4 November 2026)

The owner's answer (4 November 2026): **new codes, emailed on move day**, as Shopify's, though the gift card plugins keep their codes
readable. Checkout keeps taking only our own code format.

- **Gift cards** (plugin 1.3.2, route `gift_cards`): the cards with money left of WooCommerce Gift Cards (`woocommerce_gc_cards`), PW Gift
  Cards (`pimwick_gift_card`, the balance the sum of its activity) and YITH Gift Cards (post type `gift_card`), in the shop's currency:
  balance, expiry and holder, and only the last four characters of a code. A spendable code never leaves the site.
  - `giftCardLinesOf()` makes them D445's gift card lines (`woo:{plugin}:{id}`). They are the copy's `gift_cards` part, read now and made
    on move day by D445's own writer (`moveGiftCards()`).
  - **Move day for WooCommerce is step 5:** until it is built, they wait, as the page says (*made on move day*).
- **Mailchimp or Klaviyo** (Decision 2: read their export): *Your email list in Mailchimp or Klaviyo?* on the WooCommerce card takes the
  export (`readListExport()`).
  - Mailchimp's subscribed file: `OPTIN_TIME` and `CONFIRM_TIME`. Its unsubscribed and cleaned files are refused whole.
  - Klaviyo's profiles: `Email Marketing Consent` `SUBSCRIBED` with its timestamp.
  - Only rows with a subscription and its moment come over, through `addMovedSubscribers()` (`source` `woocommerce`, *as Mailchimp
    recorded it*), written down for *Undo this copy*. Someone already on the list is left as they are, and nobody is emailed.
- *Undo this copy* now also removes subscribers moved from WooCommerce. It removed only Shopify's before: MailPoet's from step 2a would
  have stayed.

**Not in steps 1 and 1b:**
- The mover plugin and what it reads (step 2).
- Pages, posts, menus (step 3); keep WordPress (step 4); move day (step 5).
- Categories with their parents, and a check report (*Here's your shop*) for WooCommerce.
