# Moving from Shopify: one button, nothing lost (D445 proposed)

The owner (3 November 2026): "Let's say a store owner has a store set up with Shopify today and wants to migrate to Kaizena Flow. What are
the steps the store owner has to do, and how can we make the migration as painless, intuitive and robust as possible?" and then: "Write
the plan in docs/. Remember, we need to make the migration so simple and easy to follow that Homer Simpson could do it without breaking a
sweat."

**This file is the plan; section 17 says which steps are built.** Section 13 holds the questions only the owner can settle. Section 14 lists the
spikes to run before code. Code, tests and texts follow this file. If they disagree, this file is corrected first.

---

## 1. The promise

Homer has a Shopify shop. He pastes its address, presses **Connect Shopify**, says yes on Shopify's own page, and presses **Copy my shop**.
After that his new shop is ready to look at, behind a password, while Shopify keeps selling. When he is happy he presses **Move my shop**.
His domain, his old links, his customers, his email list, his orders and his gift cards are all in the new shop. Then the plan tells him
when it is safe to close Shopify.

He never downloads a file. He never has to know the right order to do things in. He never reads the word "CSV", "redirect", "DNS" or
"handle". He is never asked a question the shop he already has can answer. Nothing he has goes live, gets emailed or gets charged until he
presses **Move my shop**. Every step can be pressed again without harm.

Lisa gets every detail one step away (section 9): the report row by row, each mapping, the files, the address check, and *Undo this copy*.

## 2. What is there today, and what we found

### 2.1 Built (files, one at a time)

| Piece | Where | What it does | What it leaves to the owner |
|---|---|---|---|
| Product import (D165, D384) | Products → Import, `src/lib/product-csv-shopify.ts` | Reads Shopify's product file. Runs a dry run with findings, fetches pictures through `safeFetch()`, matches products by handle so a second import updates instead of duplicating, and makes a redirect from `/products/{handle}` | Asks whether prices include VAT. Leaves out compare-at prices, Vendor, Type, Product category and gift cards. A physical product with no picture or manufacturer stays a draft |
| Customer import (D366) | Customers → Import, `src/lib/customer-import.ts` | Shopify's customer file, read as it is | **Never reads marketing consent.** The email list starts empty |
| Order history (D384) | Orders → Export → *Import order history*, `src/lib/order-history.ts` | Shopify's order file becomes copied orders (`C-{name}`), never paid, emailed, invoiced or counted in sales | Customers must be imported first, because orders are tied to them by email |
| Reviews (D301) | `src/lib/review-import.ts` | Shopify Product Reviews' and Judge.me's export | — |
| Redirects (D168) | Redirects → Import, `src/lib/redirect-csv.ts` | Shopify's redirect file read as it is. Old paths with no country (`/collections/x`, `/pages/y`) are looked up as redirects (`src/lib/legacy-path.ts`) | — |
| Pages (D150) | The page replicator | Copies one live page into the builder | One page at a time |
| Domains (D315) | Settings → Domains | Connects a domain. The AI manager can change DNS we host | DNS at Shopify is changed by hand |
| Private mode (D339) | `src/server/private-mode.ts` | A shop behind a password | — |

The parity row `platform.migration-from-other-platforms` is rated **full** on its four criteria. This plan goes beyond the row, on purpose:
the row measures what can come in, and this plan measures how hard it is to get there.

### 2.2 What hurts

1. **Five exports from two apps, in an order the owner must know.** Shopify emails large exports instead of downloading them.
2. **The email list is lost.** For many shops it is their most valuable asset, and losing it can stop a move on its own.
3. **Collections, menus, pages, blog posts, gift card balances and discount codes don't come over.** These are the shop's structure and its
   promises to customers.
4. **The switch day has no guide.** Nothing covers orders placed during the move, changing the DNS at Shopify, or checking afterwards that
   every old link still works.
5. **There is no proof it worked.** Nothing says "312 products there, 312 here; the order totals match".

### 2.3 What Shopify's API allows (read 3 November 2026)

- **Access scopes** (<https://shopify.dev/docs/api/usage/access-scopes>, fetched):
  - `read_products`, `read_customers`, `read_orders`, `read_content` (pages, blogs and articles), `read_online_store_navigation`
    (named for `UrlRedirect`), `read_discounts`, `read_price_rules`, `read_gift_cards`, `read_inventory`, `read_locations`,
    `read_shipping`, `read_markets` and `read_themes`.
  - `read_orders` reaches only the **last 60 days** of orders. `read_all_orders` reaches all of them. An app created under a Partner
    organization must ask Shopify's approval before it declares that scope.
  - Menus are not named under any scope on that page (spike S1).
- **Custom apps** (Shopify's community notice, <https://community.shopify.dev/t/starting-january-1-2026-you-will-not-be-able-to-create-new-legacy-custom-apps-this-will-not-impact-any-existing-apps/26798>):
  since 1 January 2026 a merchant can no longer create a legacy custom app with a pasted token in their admin; apps are made in the Dev
  Dashboard. So "paste a token" is not a path for Homer anyway. **We build one Shopify app of our own** (section 4.1).
- **Email consent** (<https://shopify.dev/docs/api/admin-graphql/latest/objects/CustomerEmailMarketingConsentState>, fetched): each
  customer carries `marketingState`, `marketingOptInLevel` (single or confirmed opt-in, after M3AAWG), `consentUpdatedAt` and
  `sourceLocation`. That is evidence a file never carries (section 6.2).
- **Gift cards** (<https://shopify.dev/docs/api/admin-rest/latest/resources/gift-card>; community thread
  <https://community.shopify.com/t/how-can-i-access-full-gift-card-data-for-platform-migration/247454>): a card's code cannot be read after
  it was made, only its **last four characters**, through the API and in the export alike. Balances, expiry and the customer can be read.
  Old codes therefore cannot work here; section 6.4 says what we do instead.
- **Bulk operations** (`bulkOperationRunQuery`): one query over a whole shop, answered as a JSON Lines file. This is how a shop of any size
  is read without hitting the per-call limits.

## 3. The idea: three presses, then a move day

```
 Connect ──► Check ──► Copy ──► (look, fix, pay) ──► Move ──► Watch ──► Close Shopify
  (once)    (reads,   (writes   behind a password     (switch   (14 days)  (we say when)
            writes    nothing   Shopify still sells)  day)
            nothing)  live)
```

- **Connect** installs our Shopify app with read-only scopes. We never write to Shopify.
- **Check** reads the whole shop and writes **nothing** in Kaizena Flow. It shows one plain report, the dry run of D165 made whole.
- **Copy** writes everything into the new shop in the right order by itself (section 5.2), with private mode on and every email and
  automation silent.
- **Move** does a last catch-up copy, checks every old link, switches the domain, opens the shop and turns emails on.
- **Watch** follows the 404 report and the old shop's traffic for 14 days.
- **Close** tells Homer when it is safe, and how to cancel Shopify without losing anything.

There is one job behind all of this, `commerce.shop_moves`, one row per store and source (section 10). Each step is a D165 data job, so
it is resumable, claimed with an expiry, and run in ticks.

## 4. What Homer sees

### 4.1 Where he starts

- **At sign-up** (D359): after the store's name, one question: *Do you sell somewhere already?* with **No, I'm starting fresh** /
  **Yes, on Shopify** / **Yes, somewhere else**. Choosing Shopify skips the template and demo content. His own shop is the template.
- **On the store's home**, a card for a store with no orders: *Moving from Shopify? Bring everything over in a few minutes.* with
  **Bring my Shopify shop**.
- **In Settings → Moving in**, the same page.
- **The AI manager**: "I'm on Shopify" leads to the same page (section 11).

### 4.2 Connect

> **Bring your Shopify shop**
> Paste your shop's address. We only read it: nothing changes on Shopify, and it keeps selling.
> `[ myshop.com                                ]`
> **Connect Shopify**

Any address works: `myshop.com`, `www.myshop.com`, `myshop.myshopify.com`, or a link to a product. We find the shop's `myshopify.com`
name ourselves (spike S2). Pressing the button opens Shopify's own approval page, the app install screen with its list of what it may
read. The owner presses **Install** and comes back. If he isn't signed in to Shopify, Shopify asks him to sign in. That is Shopify's page,
not ours.

If it fails, there is one sentence and one button, for example: *That address isn't a Shopify shop. Check it, or copy it from your
browser while you're in your Shopify admin.* **Try again**.

### 4.3 Check: "Here's your shop"

While the shop is read, the counts appear one by one (*Products… 312 ✓*), and he can leave: we email and push when it's ready. Then:

> **Here's your shop**
> 312 products · 41 collections · 18 pages · a blog with 52 posts
> 2,180 customers · 1,340 of them get your emails
> 9,400 past orders · 3 gift cards with money left · 6 discount codes
> 610 links from Google and elsewhere that will keep working
>
> **Good to know** (at most three, each one sentence)
> · Your "compare at" prices won't show as sales. In the EU a sale must be compared with your lowest price in the last 30 days, so we'll
>   show your current prices and you can start a sale here when you want.
> · 4 apps on your shop do things we do differently. We'll show you what to use instead.
>
> **Copy my shop**
> Nothing goes live, nobody gets an email, and Shopify keeps selling.

Homer is asked **nothing** on this page. Every answer comes from his shop:

| Today's question | Where the answer comes from |
|---|---|
| Do prices include VAT? | Shopify's own shop setting (`taxesIncluded`, spike S3) |
| Which country does the plain price belong to? | The shop's primary market and currency |
| Which countries do you sell in, in which currency? | Shopify Markets: each market becomes a country here, with its currency and its own prices where it has them |
| Shipping | Shipping zones and rates become a flat rate per country, free above a basket value where it was (D237 where they map; the rest listed) |
| Logo, colours, fonts | The live shop's theme settings (`read_themes`) and its pages, through brand and look (D330) |

If the shop can't answer a question, it becomes one plain question on this page with a sensible default already chosen, never a blank.

### 4.4 Copy, then "Your new shop is ready"

> **Your new shop is ready to look at**
> It's behind a password, so only you can see it. Shopify is still selling as before.
> **Look at my new shop** (opens it side by side with the old one)
>
> **Before you move, 3 things** ✓ ✓ ○
> ✓ Your products, customers and orders are here
> ○ **Get paid**: connect payments (about 5 minutes; your bank may take a day or two to check) → Stripe Connect
> ○ **Who makes your products?** EU law asks for it on 120 products → one screen (section 4.5)
> ✓ Shipping is set up as it was on Shopify

The checklist is the store's existing setup progress (`setup_progress`), with a *Moving* group. Everything already done is shown done, so
Homer sees only what is left. Payments come first because the bank's check takes days. That is the one wait we can't remove, so we start it
earliest.

### 4.5 "Who makes your products?" (one screen, not 120)

Today a product with no manufacturer stays a draft (product safety, R5), and Vendor is never turned into a manufacturer: that is a legal
designation the owner makes. We keep that rule, but ask once per vendor, not once per product:

> **Who makes your products?**
> EU law asks every shop to name the maker of what it sells.
> **Nordic Wool** · 84 products — Is Nordic Wool the maker? **Yes** / **No, someone else**
> **Fjell Design** · 36 products — **Yes** / **No, someone else**

**Yes** opens Nordic Wool's address fields, filled from what we can find (the vendor's name). Saving it sets the manufacturer on all 84
products in one bulk edit (D172's bulk action, with its undo). The owner presses **Yes**, so the designation is his act, not ours.

### 4.6 Move day

> **Ready to move?**
> ✓ Payments work · ✓ 612 of 612 old links lead somewhere · ✓ Nothing waiting for you
> When you press Move, we copy anything new from Shopify, switch your address to the new shop, and open it. It takes about 10 minutes.
> Shoppers in the middle of paying on Shopify can finish there.
> **Move my shop** · or *Choose a time* (it happens by itself, for example tonight at 23:00)

Then a list that ticks itself off: *Copying the last orders… ✓ · Checking every old link… ✓ · Switching your address… (step 4.7) ·
Opening your shop… ✓ · Turning on emails… ✓*. When it's done: **Your shop has moved. 🎉** with what happens next (section 4.8).

### 4.7 Switching the address: the one step we may need him for

How we switch depends on where his domain's DNS lives. We find that out ourselves (the nameservers, spike S4), and Homer sees only one of
these:

| Where the DNS is | What Homer does |
|---|---|
| With us (bought here or moved here, D315) | Nothing. We change it |
| At a provider that supports Domain Connect (D315) | Presses **Switch it for me**, then **Allow** on his provider's page |
| **At Shopify** (bought through Shopify; common) | Follows our steps, written for Shopify's own screens (*In Shopify, open Settings → Domains → myshop.com → Domain settings → Edit DNS settings. Change the A record to `…`.*), with a **Copy** button for each value. We check every 30 seconds and say **Done ✓** by ourselves. *Or let us look after your domain* offers moving it to us (D315's transfer in) when it's free to leave Shopify |
| Anywhere else | The same steps, written for his provider when we know it (the five most common get their own words), else general ones with Copy buttons |

**One day before** the chosen move time, we ask him to lower the records' TTL where we can't do it ourselves, so the switch takes minutes,
not hours. If he doesn't, it still works, only more slowly, and the screen says so honestly.

### 4.8 The 14 days after, and "You can close Shopify now"

For 14 days, the store's home carries one card: *Your move: all good* or *3 old links nobody found: fix them* (one press each, from the 404
report's own suggestions). We also check, once a day, that no new orders have come in on Shopify (a shopper on an old bookmark, a
marketplace channel still selling there) and copy them as history with a notice if one does.

On day 14, or when every check is green:

> **You can close Shopify now**
> 1. In Shopify, cancel your apps first (they bill separately). **Show me how**
> 2. Then Settings → Plan → Deactivate store. **Show me how**
> We keep a full copy of what we read from Shopify for 90 days, in case you ever need it. **Download it**

We never press anything on Shopify. The owner does that, and we only write the way there.

## 5. What comes over

### 5.1 The mapping

Every row reuses the writer that already owns that table. The move has no writer of its own, and that is the rule that keeps it robust
(section 8).

| Shopify | Kaizena Flow | Through | Notes |
|---|---|---|---|
| Products, variants, options, SKUs, barcodes, weights | Products and variants | The product import's neutral rows → `saveProduct()` (D165) | Same rules: never deletes, never changes a handle |
| Prices per market | Prices per country, VAT-inclusive | `saveProduct()` → `commerce.set_price` | Net prices worked up by the shop's `taxesIncluded` and each country's rate |
| Compare-at price | — | — | Never (98/6/EC Art. 6a). Said once, in plain words (4.3) |
| Cost per item | Cost | as today | |
| Stock per location | Stock per location (D172) | the inventory import | Shopify locations become locations |
| Pictures, alt texts, videos | Media, product gallery (D325) | `safeFetch()`, the media library | Videos and 3D where the gallery takes them |
| Tags | Tags (D50) | as today | |
| Manual collections | Categories with their products in their order, description, picture, SEO texts | the taxonomy writers (D50, wave 6) | Address `/collections/{handle}` redirected |
| Smart collections | Categories with the same rule where ours can express it (tag, type, vendor, price), else filled once as a manual list and listed | as above | Spike S5: which rules map |
| Product type, Shopify product category | Standard taxonomy (D327), product type | the taxonomy | Today they are read and dropped. Now they are kept |
| Vendor | Brand, **never manufacturer** | | The manufacturer screen (4.5) asks |
| Metafields | Custom fields (D118) | `custom-fields.ts` | Kept private until the owner chooses, as D118 says |
| Pages | Pages | the page writer; body as rich text, not HTML | Address `/pages/{handle}` redirected |
| Blogs and articles | Blogs and articles (D341) | blog writers | Authors, tags, published dates, pictures; `/blogs/{blog}/{article}` redirected |
| Menus | Menus (D85) | `menus.ts` | Each link rewritten to the new shop's own pages, products and categories |
| URL redirects | Redirects (D168) | `addRedirects()`, origin `import` | |
| Customers, addresses, tags, notes | Customers, saved addresses (D304), customer tags | the customer import's writer (D366) | Passwords don't matter: customers sign in with an email code |
| Email consent | Subscribers | `marketing-subscribers.ts`, source `shopify` | **Decision 1** (section 6.2) |
| Companies (B2B) | Company accounts (D108) | `companies.ts` | Where Shopify has them |
| Orders, refunds, fulfilments | Order history (`C-{name}`) | `insertHistoryOrder()` (D384) | Now through the API, so all years (`read_all_orders`) and refunds and fulfilment dates too, not just the file's columns |
| Gift cards with a balance | New gift cards, same balance and expiry | the gift card writer (D300) | Section 6.4 |
| Discount codes | Discounts (D299) | `discounts.ts` | Where ours can express the rule; the rest listed. Created switched **off** until the move |
| Reviews | Reviews (D301) | the review import | From the app the shop uses (Shopify Product Reviews, Judge.me) by its API where it has one, else its file (spike S6) |
| Theme | Brand, colours, fonts, logo, favicon (D330, D62) | brand tools | We copy his look, not Shopify's theme code. The home page through the replicator (D150) if he wants (*Make it look like my old shop*) |
| Shipping zones and rates | Shipping per country (D237) | shipping writers | |
| Shop policies | Legal pages (D158, D311) | | Kept as his draft. The AI's own legal pages are offered beside them, never in their place |
| Shopify Payments, payouts, apps, analytics history | — | — | Section 6 |

### 5.2 The order, which Homer never sees

Settings and countries → locations → taxonomy (categories, tags, types) → custom field definitions → products → stock → customers →
subscribers → companies → orders → gift cards → discounts → reviews → pages → blogs → menus → redirects → the address check.

Each stage waits for the one before. A stage that fails stops only the stages that need it: reviews never wait for gift cards. Each stage
is a step of the job, and a stage that is run again does nothing it already did (section 8).

## 6. What doesn't come over, and what we do instead

### 6.1 Said once, plainly

The report names everything we leave behind. It never says "unsupported": it says what to do instead.

| Left behind | What we say and do |
|---|---|
| Compare-at prices | 4.3: *your current prices show; start a sale here when you want* |
| Shopify Payments | *Connect payments here* (4.4). His Stripe account under Shopify can't come with him |
| Apps | A list of his apps (spike S7: what the API shows) with ours beside each where we have one (*Klaviyo → Email automations*, *Judge.me → Reviews*) and *nothing here yet* where we don't. Never a guess |
| Analytics history | *Your sales history is here as past orders; your visitor numbers start fresh*. Copied orders aren't counted in sales (D129), so the report has a *Before the move* view, read from copied orders and kept apart from revenue (Decision 3) |
| Theme code, Liquid, scripts | Never run. His look comes over, not the code |
| Subscriptions with saved cards | Spike S8. Payment tokens can't move without the payment provider's help. Until then: listed, with each subscriber's next date, so he can invite them to sign up again |

### 6.2 The email list (Decision 1)

The rule today is "people join the list themselves" (D295, D366), and for a file that's right: a file proves nothing. Shopify's API gives
**evidence**: each customer's `marketingState`, `marketingOptInLevel` and `consentUpdatedAt`, kept by the same shop owner (the same
controller) who now moves. GDPR Art. 7(1) asks the controller to be able to show consent. That record is the proof, and it moves with him.

**Recommended:** a customer whose state is `SUBSCRIBED` becomes a subscriber with:
- `source` `shopify`;
- `consentedAt` = `consentUpdatedAt`;
- `confirmedAt` set only when the opt-in level is confirmed (double opt-in);
- `consentText` *Agreed to email from {shop} while it was on Shopify, as Shopify recorded it*.

The raw record goes into `marketing_consent_events`. Any other state comes over as not subscribed, unsubscribed included, so nobody who
left the list is ever added back. A customer with no `consentUpdatedAt` is not added.

The first broadcast after a move carries a one-line notice, *{shop} has moved to a new home; you'll keep getting our emails, unsubscribe
any time*, with the existing one-click unsubscribe. Needs a legal read (section 12).

The alternatives are (b) importing everyone and sending a "stay subscribed?" email, which typically keeps well under half the list, and
(c) today's rule. The owner chooses.

### 6.3 Customer accounts

Customers sign in with a code sent by email here, so no password needs to move and none is asked for. Nobody is emailed about their
account (D366: the import emails no one). After the move, a customer who signs in finds their order history, because their copied orders
are tied to them by email.

### 6.4 Gift cards

Shopify never reveals a card's full code (2.3). So for every card with money left:
- we issue a gift card here with the **same balance, currency and expiry**, tied to the same customer;
- on move day we email each holder: *Your gift card from {shop} has a new code: XXXX. Balance €40.* This is a service message about money
  they already hold, not marketing;
- a card with no email goes on a list for the owner with its last four characters, so he can recognise it if someone comes in with it.

**Until move day the new cards are frozen** and the emails wait, so nobody can spend the same balance in both shops. On move day the
balances are read again, just before the cards are released. Section 7 covers a card spent on Shopify during the catch-up.

## 7. The switch day, robustly

1. **Before** (chosen time minus 24 h): an email and push say what will happen. We lower the TTL where we can, and ask him to where we
   can't.
2. **Catch-up copy**: products, prices, stock, customers, subscribers, orders and gift card balances are read again. A product updates by
   its handle. An order already imported is skipped (D384). A gift card's balance is set again from Shopify's current balance.
3. **Stock**: the stock read in step 2 is the count from that moment. Orders paid here afterwards reduce it, as usual (`StockMode`, D165).
   Orders still paid on Shopify in the minutes the DNS takes to switch are caught by the daily check (4.8): copied as history, with a notice
   to adjust stock (one press: *Take 2 off Wool Hat*).
4. **The address check** (8.2) must be green, or the owner is shown what's red with one press to fix each.
5. **The switch** (4.7).
6. **Open**: private mode off. Gift cards are released and their emails sent. Discounts are switched on. Automations and notifications are
   turned on (until now silent, `shop_moves.silent`).
7. **Done** (4.6), and the 14-day watch begins.

If anything in steps 2 to 4 fails, nothing has switched: the old shop still sells, and the screen says *Not moved yet: {one sentence}.
Try again*. If the switch itself is slow (DNS), the shop is already open on its new address for whoever reaches it, and the screen says
*Some people still see the old shop for a little while. That's normal.*

## 8. Robust by construction

### 8.1 Rules

- **One writer per table, the existing one.** The move only reads Shopify and calls the writers that already guard each table (the
  product import's `saveProduct()`, `insertHistoryOrder()`, `addRedirects()`, the subscriber writer). So every rule those tables already
  have (VAT, Omnibus, product safety, copied orders, consent statuses) holds without being written again.
- **Run again, change nothing.** Every item keeps its source id (`shop_move_items`: kind, Shopify GID, our id, a hash of what we wrote). A
  second run updates what changed in Shopify, skips what's the same, and never duplicates.
- **We never write to Shopify.** All scopes are `read_*`.
- **Nothing reaches a shopper before Move**: private mode, silent emails, frozen gift cards, discounts off.
- **Resumable.** Each stage is a D165 job tick, claimed with an expiry. A bulk operation's file is downloaded to the private `imports`
  bucket and read from there, so a failed tick starts again from the file, not from Shopify.
- **Shopify's limits.** Bulk operations for the big reads. The GraphQL cost budget is respected with waits, and a `429` waits and tries
  again later.

### 8.2 The address check

We read the old shop's `sitemap.xml` and its child sitemaps (products, collections, pages, blogs), plus every redirect Shopify had. Each
address must, on the new shop, either serve a page (`200`) or redirect permanently in one hop to one that does.

- An address that doesn't gets a suggested target: the same handle under the new shape, else the closest product or category by its
  title, from the 404 report's own suggester (D168).
- The owner sees *612 of 612 old links lead somewhere ✓*, or *3 don't: fix them* with one press each.
- Requests go through `safeFetch()`, read the old shop at a polite rate, and stop at the sitemap's own limit (spike S9: the shop's size).

### 8.3 The reconciliation

When Copy is done, and again on move day, the report compares Shopify with Kaizena Flow per kind:

| Kind | Compared |
|---|---|
| Products, variants, collections, pages, articles, customers, subscribers, gift cards | Count |
| Orders | Count, and the sum of totals per currency (integer minor units) |
| Gift cards | The sum of balances per currency |

Every difference is named with its reason (*2 products left as drafts: no picture*). Homer sees one line, *Everything is here ✓*, or one
line per kind that differs, each with what to do.

### 8.4 Undo this copy

A store with **no real orders yet** can press *Undo this copy* (Lisa's side, behind a confirmation). It removes everything the move made,
using `shop_move_items`, and leaves what the owner made himself. After the first real order, Undo is gone, and the page says why.

## 9. Lisa, one step away

*Details* on each screen opens:

- **The report, row by row**: every item with what we did and why, filterable, as a CSV too (written by `csv.ts`).
- **What to bring**: switches per kind (*Don't bring blog posts*, *Bring orders from the last 2 years only*).
- **Mapping**: which Shopify market is which country, which location is which, which smart collection rule became what.
- **The address check**: every address, its status and target, editable.
- **The files**: the bulk-operation files we read, for 90 days.
- **Run again**: Check or Copy again at any time before Move.
- **Undo this copy** (8.4).
- **From files instead**: today's file imports, unchanged, for shops that won't install an app.

## 10. Data, permissions and law

- **Tables**: `commerce.shop_moves` (one per store and source: status, the Shopify shop's domain, scopes granted, each stage's state,
  silent, the chosen move time) and `commerce.shop_move_items` (kind, source id, our id, hash, finding). Both are `never` in `COPY_RULES`.
- **Token**: Shopify's access token is encrypted with `SETTINGS_ENCRYPTION_KEY` (`secret-box.ts`) and deleted when the move is closed,
  after 14 days, or on *Disconnect Shopify*. We also handle Shopify's `app/uninstalled` webhook and its three mandatory privacy webhooks.
- **Who**: owners only (`requireOwnerRole`), as the order and customer files are (D165). One audit entry per stage, never per item.
- **Logs**: counts and ids only (`log()`), never a person's data.
- **Where**: the files are in our EU storage. Shopify's API is called from `dub1`. No new vendor holds data. Our Shopify app is a
  listing, not a processor of ours.
- **Personal data**: an erasure (D162) of a person reaches `shop_move_items` and the kept files, through `removePersonalExports()`'s pattern.
- **Our Shopify app**: built in Shopify's Dev Dashboard under Kaizena Flow's Partner organization, distributed as an app any shop can
  install, read-only scopes, with `read_all_orders` requested from Shopify (spike S1). Its name and listing say Kaizena Flow.

## 11. The AI manager

A *Moving from Shopify* skill in `assistant-skills.ts`. It:
- explains each finding in plain words;
- says what's left on the checklist (`setup_progress`'s Moving group);
- opens the right page (`open_admin_page`);
- answers "is it safe to close Shopify yet?" from the 14-day watch;
- writes the DNS steps for the owner's provider.

It never presses Copy, Move or Undo: those are the owner's. It never connects Shopify, because that needs the owner's own approval on
Shopify. Every text it reads from Shopify (descriptions, pages, notes) is untrusted (`UNTRUSTED_TEXT`), and the safety eval gets a case
with instructions hidden in a product description that came from a move.

## 12. Build order

Each step ships on its own and is useful on its own.

1. **The address check and the reconciliation, on today's file imports.** Read the old sitemap, check every address, suggest targets,
   compare counts. Cheap, reuses D168 and D165, and removes the biggest fear (Google) at once.
2. **The Shopify app and Connect.** OAuth, the token, the uninstall and privacy webhooks, finding the shop from any address (S2).
3. **Check.** Bulk reads into the private bucket, the report, no writes. Answers from the shop's own settings (4.3).
4. **Copy, part 1**: what today's files carry (products, stock, customers, orders, reviews, redirects) through the same writers, plus
   countries, shipping and look.
5. **Copy, part 2**: collections, pages, blogs, menus, metafields, discounts.
6. **The manufacturer screen** (4.5).
7. **Move day**: catch-up, the switch with each DNS case, open, the 14-day watch, *You can close Shopify now*.
8. **Gift cards and the email list**, once Decisions 1 and 2 are settled.
9. **Undo this copy**, Lisa's details, the AI manager's skill.

Each step runs end to end against a Shopify development store first (spike S10).

## 13. Decisions for the owner

1. **The email list** (6.2): import `SUBSCRIBED` customers with Shopify's own record as the evidence (recommended), ask them all again, or
   keep today's rule. Needs a legal read (GDPR Art. 7(1); the Norwegian *markedsføringsloven* § 15 and the other countries' rules on email
   marketing) before it's built.
2. **Gift cards** (6.4): new codes emailed on move day (recommended), or new codes given to the owner only, to hand out himself.
3. **History in analytics**: a *Before the move* view read from copied orders, kept apart from revenue (recommended), or no history at all
   in analytics (today).
4. **Shopify's app listing**: listed in Shopify's App Store (findable, needs Shopify's review) or unlisted, installed only from our link
   (recommended to start).
5. **Other platforms next**: the same three presses for WooCommerce (its REST API), then Wix and Squarespace? Recommended: WooCommerce
   next, because its file reader already exists (D384).

## 14. Spikes before code

| # | Question | How |
|---|---|---|
| S1 | Which scopes reach menus; does Shopify approve `read_all_orders` for a migration app, and how long does it take? | Read the GraphQL `Menu` docs; apply from the Partner organization |
| S2 | From `myshop.com` to `myshop.myshopify.com` with no sign-in | Try the shop's `/meta.json` and its HTML's `Shopify.shop` on ten real shops; else let Shopify's own install page ask |
| S3 | Where `taxesIncluded` lives now, per market or per shop | The `Shop` and `Market` objects of the current API version |
| S4 | Telling DNS at Shopify from DNS elsewhere | Nameservers of ten real shops' domains |
| S5 | Which smart collection rules map to ours | Every `CollectionRuleColumn` against our category rules |
| S6 | Reviews: Judge.me's and Shopify Product Reviews' APIs or files | Read their docs; one real export each |
| S7 | Can the API list a shop's installed apps? | The `appInstallations` query and its scope |
| S8 | Subscriptions with saved cards | What Shopify Subscriptions and the big apps allow, and Stripe's card migration terms |
| S9 | The largest sitemap we must check, and its speed | Ten real shops |
| S10 | An end-to-end run | A Shopify development store with products in three markets, collections of both kinds, a blog, gift cards, discounts and 5,000 orders |

## 15. Tests

- **Pure mapping**: each Shopify object to our neutral rows, with fixtures taken from real bulk-operation lines
  (`src/lib/shopify-move*.test.ts`).
- **Integration** (`src/server/shop-move.int.test.ts`) against a stand-in Shopify (`e2e/fixtures/shopify-stub.mjs`, the auth stand-in's
  pattern): a full move, a second run that changes nothing, a run after Shopify changed one product, a stage that fails and resumes, Undo.
- **The rules hold**: no compare-at price, no manufacturer from Vendor, copied orders never in revenue, no email or gift card before Move,
  an unsubscribed person never subscribed, no write call to Shopify ever (the stub fails on any mutation).
- **The address check**: a fixture sitemap with each kind of address, a chain, a loop, an address with nothing to point at.
- **Reconciliation**: sums per currency in minor units.
- **e2e**: Homer's path end to end against the stub, with only the main buttons pressed.
- **Agent eval**: the hidden-instruction case (section 11).

## 16. What this does not do

- It never writes to Shopify, and never closes, cancels or changes anything there.
- It never moves a payment account, a saved card or a payout.
- It never runs Shopify theme code or apps.
- It never imports a compare-at price, or turns a vendor into a manufacturer without the owner's yes.
- It never emails anyone before Move, and never subscribes anyone Shopify didn't record as subscribed.

## 17. What is built

**Step 1, the old shop's links (3 November 2026).** Redirects → *Old shop*. The owner types the old shop's address and presses *Check my
old shop*. Its sitemap is read once (`src/server/old-shop.ts`), and the page says *612 of 650 old links lead somewhere*, offers **Fix 38
for me** for every old link whose same thing is live here (a product imported from Shopify keeps its handle, so `/products/{handle}` goes
to `/p/{handle}`), and lists the rest with the 404 report's suggestions. Below it, the old shop's products, collections, pages and blog
posts are counted beside this store's: the reconciliation of 8.3, from the sitemap, until step 3 reads Shopify's own counts. *Check
again* after each import picks up what was imported since.

As built, differences from 8.2:

- **Nothing is fetched from this store.** Where an old address leads is worked out from the database by the resolver's own rule
  (`followChain()`), so the check is the same answer a shopper would get, without a request per address.
- **Only the sitemap is read**, so it works before Connect exists, for any shop with a sitemap (WooCommerce's shapes are mapped too), and
  copies nothing.
- **Shopify's own redirects** are not read yet (they need the API, step 3). Their file can be imported on the Import tab as before.
- **The limits**: 60 sitemap files and 20,000 addresses (Shopify lists 5,000 per file); the page says when a shop lists more.

**Step 2, Connect (3 November 2026).** Settings → *Moving in* (`/admin/{store}/settings/moving`, the owner's). Homer types any address of
his shop and presses **Connect Shopify**; Shopify's own page asks him to allow Kaizena Flow to read the shop, and he comes back to
*Connected to {shop name}* with what it holds (*312 products · 2,180 customers · 940 orders*, counted by Shopify), one press to **Check
your old links** (step 1, read from the shop's own domain), the file imports for the rest until step 4, and *Disconnect*.

- **The app** (`kaizena-flow-3` in Shopify's Dev Dashboard, released from this file with `shopify app deploy` on 3 November 2026; the dashboard's form has no place for webhooks, and Shopify refuses them in the file while the legacy install flow is on, so the app uses Shopify managed installation with the same scopes as the authorize address) is Kaizena Flow's own, described in `shopify/shopify.app.toml` (read scopes only, not embedded, the callback, `app/uninstalled`
  and the three privacy topics). It is made once in Shopify's Dev Dashboard; until `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` are set
  in production the page offers the file imports alone, in their order.
- **The token**: Shopify now asks new public apps for *expiring* offline tokens (`expiring=1`: an access token of an hour and a refresh
  token of 90 days, read 3 November 2026 at
  <https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant>). Both are encrypted in
  `commerce.shop_moves` and refreshed a minute early under the row's lock; a refused refresh, a 401, `app/uninstalled` or *Disconnect*
  drops them, and `shop/redact` deletes the row.
- **The callback** spends the code only after the sealed state (the store, the account that pressed and the shop), Shopify's HMAC over
  the query, the anchored `myshopify.com` name and the same owner signed in now all agree.
- **Spike S2 answered**: every Shopify storefront answers `/meta.json` with its `myshopify_domain` (tried on a live shop on 3 November
  2026), and its pages carry `Shopify.shop = "…"`; `findShopifyShop()` asks the first, then the second. A bare handle, a
  `myshopify.com` address and Shopify's admin address (`admin.shopify.com/store/{handle}`) are read as they are.
- **Left for the owner** (section 13 and 14): make the app in Shopify's Dev Dashboard under Kaizena Flow's Partner organization (set its
  `client_id` in the file and deploy it with the Shopify CLI), set the two variables in Vercel, ask Shopify for `read_all_orders` (then
  add it to the file and set `SHOPIFY_ALL_ORDERS=1`) and for protected customer data (names, emails and addresses need Shopify's approval
  of the app's data use before Copy can read them). Until `read_all_orders` is approved, Shopify counts and gives the last 60 days of
  orders.

**Step 3, Check (3 November 2026).** Once connected, Settings → *Moving in* shows **Here's your shop**: Shopify's own counts
(products, collections, pages, blog posts; customers and how many get the shop's emails; past orders, gift cards with money left,
discounts; the redirects made in Shopify), what the shop's settings already answer (*Prices include VAT ✓* from `taxesIncluded`, the
countries and currencies of its markets), and at most three things good to know (prices without VAT, compare-at prices, gift card codes,
orders beyond 60 days, customers Shopify held back), each worded once. Homer is asked nothing.

As built, differences from the plan (3 and 12, step 3):

- **No bulk read and nothing kept.** The report needs counts, not rows, so it is seven small read queries
  (`src/server/shopify-report.ts`: the shop, the catalogue, content, customers, orders, money, markets), asked again on each view and
  kept nowhere; `shopReport()` in `src/lib/shopify-report.ts` turns them into the report. The bulk operations and the private bucket move
  to step 4, Copy, which is what needs every row.
- **One group refused spoils only itself.** Each group is its own query, so a field Shopify refuses (a scope held back, protected
  customer data not yet approved) leaves its figures unknown (a dash), never 0, and the good-to-know says why.
- **The subscribers** are counted by Shopify's customer segment query (`email_subscription_status = 'SUBSCRIBED'`, its `totalCount`):
  `customersCount` filters only by dates and ids (read 3 November 2026 at
  <https://shopify.dev/docs/api/admin-graphql/latest/queries/customersCount>).
- **Counts are exact or marked**: Shopify caps a count unless `limit: null` is asked, which every query here asks; a count Shopify still
  gives as a lower bound shows as *10,000+*.
- **Compare-at prices** are judged from a sample of 250 variants, enough to know whether to say it.

**Step 4, Copy, part 1 (3 November 2026).** Under *Here's your shop*, **Copy my shop** reads the connected shop and lines up products,
customers, past orders and redirects; a line for each says where it is (*Reading from Shopify …*, *Ready · 312 found · 4 need a look*,
*Here ✓*), with *See what will happen* on the import's own page. Nothing is saved until **Bring it over**, which saves them in that order.

As built (`src/lib/shopify-copy.ts` pure, `src/server/shopify-copy.ts`):

- **The move writes nothing of its own.** Each feed is read by one Shopify bulk operation (one at a time per shop), written as the very file
  Shopify's own export makes (its product, customer and order exports, its redirect file), and handed to the import that already guards
  its table: registered, then its dry run, then, after *Bring it over*, its apply. Every rule of those imports holds unchanged (the VAT
  question, no compare-at price, a product without a picture or maker saved as a draft, the old product address redirected, copied orders
  never paid or counted, customers never subscribed); the file and its findings are on the import's own page for Lisa.
- **What Homer is not asked**: the product import's VAT question is answered from the shop's own `taxesIncluded`, and its prices go to the
  store's country in the shop's currency.
- **The progress** is `shop_moves.copy` (`copyStateOf()` reads it back field by field), moved on by the open page every few seconds under a
  90-second lease, so two tabs never start the same read. A read left half-way goes on at the next visit; Shopify keeps a finished read's file
  for a week. A feed Shopify refuses (protected customer data not yet approved, for instance) is said in one sentence with the file import
  beside it, and the rest goes on.
- **Order**: customers are applied before orders, so a past order is tied to its customer by email.
- **A variant without a SKU** (Shopify allows it; the import needs one to find a variant again) is given its product's handle and option
  values (`bag`, `bag-s-red`), unique within the file. Found on the first real copy (3 November 2026): one product of a development store had
  none, and its whole product was refused. A part whose check finds nothing to bring over says *Nothing here could come over as it is* with
  its import's page, and the last line says how many parts could not come over instead of *Everything is here*.
- **The limits are the imports'**: a feed whose file would pass 15 MB is refused with a sentence and the file imports beside it.
- **Copied products show at once** unless the shop is behind a password (private mode, D339): the page says so before *Bring it over*, with
  the link. Turning private mode on by itself is left for move day (step 7), where opening the shop is part of the plan.

### Step 5, part 1: collections, pages, blog posts and menus (built 3 November 2026)

The copy reads four more parts, in the same list and under the same *Bring it over*:

- **Collections** become categories. Their bulk read lists each collection's products and variants, written as a small file of
  `handle, sku, variant id, categories` (`collectionsFile()`, names joined by ` | `, a `/` or `|` in a name made `-`), applied after the
  products by the product import in update mode with no redirects: the import adds the categories to products it already has and makes
  nothing else. A smart collection comes over as the products it holds that day, not its rules. Its description and picture are not
  brought over.
- **Pages and blog posts** have no import, so they go to the page writer itself (`savePage()`, and `saveBlog()` for a second Shopify blog;
  the first becomes the store's main blog). Shopify's HTML is turned into the editor's rich text in code (`htmlToRichText()`,
  `src/lib/html-rich-text.ts`: paragraphs, headings 2 to 4, bold, italic, underline, links the editor takes, lists, quotes, lines and line
  breaks; scripts, styles and frames left out; pictures left out and counted), checked by `cleanRichText()`, never kept as HTML. A page
  the writer asks to confirm is saved as a draft. An address already taken here is left alone and counted. A post's author is kept; its
  date, pictures and tags are not.
- **Menus** are read last by one small query (Shopify has no bulk read for them) and written by `saveStoreMenu()`, two levels deep,
  each link turned into our address where we have the same thing (`menuLinkOf()`), else kept as its address; a menu whose name is taken
  is left alone.
- Pages, posts and menus are written in batches of 15, 15 and 5 per tick, so a big blog never holds one request long.

A copy started before this step shows the four new parts as empty; *Start again* reads them.

### Step 5, part 2: countries, shipping, discount codes and the look (built 3 November 2026)

Four more parts, each read by one ordinary query (none has a bulk read; `src/lib/shopify-settings.ts`) and written after *Bring it
over* only by the writer that owns it here (`src/server/shopify-settings-copy.ts`). The order is now countries, shipping, products,
collections, customers, past orders, discount codes, pages, posts, menus, redirects, look.

- **Countries**: every country of every Shopify market, added through `setMarkets()` beside the ones the store sells to. A country is
  only added, never taken away. With *Several countries* off, none is added and the rest are counted for the owner. A new country gets
  its own currency here, not the market's in Shopify.
- **Shipping**: the general profile's rates as one flat rate per country (`shippingOf()`): the cheapest active rate without a condition,
  and free above the lowest *at least this much* of a free rate. A rate by weight or by a carrier's own price, and rest of world, are left
  out. Written by `saveShippingSettings()` only for a country the store sells to in the same currency and with no rate of its own; a
  country whose own rate differs keeps it and is counted (*needs a look*, with the shipping page).
- **Discount codes**: basic codes (a whole percentage, a fixed amount on the order, free shipping), for everything, for products by
  handle or for collections by their category here, with their minimum, dates, use limit and combinations, written by `saveDiscount()`
  **switched off** until the move. Left out and counted: buy X get Y and app discounts, codes for some customers only, an amount on each
  item, variants, a part percentage, a free shipping cap, expired codes, and a code naming a product or category that is not here. A code
  already here is left alone. Up to 20 pages of 25 codes.
- **The look**: the live theme's `config/settings_data.json` (its first colour scheme's button, background and text, else the older
  settings' names; its heading and body fonts) given to the AI manager's own `design_look`, which makes every text readable and adds
  *{theme} · Shopify* to the theme library, **not live**. A font Google Fonts does not have (Shopify's own library) stays the store's.
  The logo is not brought yet.
- A part with no Shopify file to use instead links to its own screen here (*Set it up here*), and one done with things left out links
  there too (*Look at it*).
- Found by the test: a code on categories alone sent `saveDiscount()` an empty product list, which its check read as `in ()`; it now
  looks products up only when there are some, and the copy sends no list, as the editor does. One code the writer cannot take is counted
  and never holds up the rest.

The queries for shipping, codes and the look were written from Shopify's reference and are first met on a real shop when the owner
presses *Start again*; one Shopify refuses says so on its own line and the rest goes on.

### Step 6: *Who makes your products?* (built 3 November 2026)

On Moving in, once the copy has stopped moving: one row per Shopify vendor whose copied products here still have no manufacturer
(`makerGroups()`, `src/lib/shopify-makers.ts`), most products first, products without a vendor in a row of their own.

- **Where the vendors come from**: the products' bulk read now asks for `vendor`, and the vendors are kept beside the products' file
  (`shopify-vendors.jsonl` in the imports bucket, `copy.feeds.products.vendors`), so the screen reads no Shopify and works after a
  disconnect. A copy started before step 6 kept none: *Start again* reads them.
- **The question**: *Is Nordic Wool the maker?* **Yes** opens Nordic Wool as a new company with its name filled in (or the store's company
  of that name); **No, someone else** opens one of the store's companies or a blank one. The product editor's own company picker
  (`OperatorPicker`, now `src/components/admin/operator-picker.tsx`). Where the countries the store sells to ask for a responsible person
  (D452, `docs/product-safety-eea.md`: one in the EU for an EU country, never one in Norway, Iceland or Liechtenstein instead), it is
  asked for too, and nothing is saved without one. The vendor is never taken as the maker without the owner's press.
- **Saving** (`saveVendorMaker()`, `src/server/shopify-makers.ts`): the company is kept as the editor keeps one (`chooseOperator()`), then
  the bulk editor's new action *Set the manufacturer* (`manufacturer`, field `maker`, migration `20261103220311_bulk_makers` widening the
  two checks) names it on every product of that vendor still without one, 500 at a time, with the bulk editor's seven-day undo
  (*Undo* links to the bulk page). Then the ones that were on sale in Shopify are put on sale by its *Set status* action, whose save
  refuses one still missing something (a picture), and the page says how many.

### Step 7a: *Ready to move?* and the move (built 4 November 2026)

On Moving in, once the copy has been brought over (`src/lib/shopify-move.ts` pure, `src/server/shopify-move.ts`, the state in
`shop_moves.move`, migration `20261104083148_shop_moves_move`):

- **Ready to move?** Four lines. *Payments work* (the live account takes cards and payments are on) and *Your shop is copied* (brought
  over, every part settled) hold the move back. *Old links lead somewhere* and *Nothing waiting for you* (products still without a maker)
  are said with their link, and the owner may move anyway.
- **Move my shop**, or **Choose a time** (a wall-clock time in the store's time zone, five minutes to 30 days ahead; *Cancel* takes it
  back). The five-minute job (`runDueMoves()`, `shopMoves` in the dispatcher) starts a due move as the owner who chose it
  (`passMembership()`, checked again each time). A move that is not ready at its time does not start, and the page says so.
- **The steps**, each through the writer that owns it, each safe to repeat, moved on by the open page and by the job under a 90-second
  lease:
  1. *Copying what's new on Shopify*: a catch-up copy (`startCatchUp()`) reads only what Shopify made since the copy began
     (`created_at:>=` on products, customers and past orders, `catchUpQuery()`), through the same imports, brought over without asking.
     The earlier copy's vendors are carried over.
  2. *Pointing your old links here*: the old shop's links, read if they never were, and `fixOldShop()` for every one with a sure
     counterpart.
  3. *Opening your shop*: private mode off through `setPrivateMode()`. A store not yet set up, or whose trial ended, says so.
- A step that cannot finish says why with its own screen, and the move goes on. When all have settled: *Your shop has moved*, and the
  address (7b) is what comes next.
- **Emails.** No step sends one. Nothing the copy or the catch-up writes emails anyone: imported customers are never subscribed, copied
  orders are never confirmed. The store's own emails follow its own orders from the moment it opens, as for any store. So there is no
  switch to turn on, and the plan's *Turning on emails* line is not shown.
- The look: Shopify's newer themes (Horizon) name their colours differently, so those names are read too. A theme whose look still
  can't be read logs the names of its settings (never their values) as `shopify.copy_look_unread`, so it can be added.

### Step 7b: the address (built 4 November 2026)

On Moving in, once the shop has moved (`src/lib/shopify-address.ts` pure, `src/server/shopify-address.ts`, `ShopAddress`):

- **Which addresses**: the Shopify shop's primary domain and the other of its bare and `www.` names (`addressesToMove()`); a shop with only
  a `myshopify.com` address has nothing to point, and the page offers an address of its own instead.
- **Point it here** adds them through the domains page's own writers: `connectOwnedDomain()` at once where the domain is registered here
  or its DNS is kept here (D315), else `addStoreDomain()`, waiting for the TXT proof and the pointing records (`dnsRecords()`). Safe to
  press again. Shopify's own primary becomes the store's address once it works (`setPrimaryDomain()`).
- **Where the DNS is kept** is read from the nameservers (`dnsHostOf()`): ours, Shopify's, Cloudflare, GoDaddy, Namecheap, Domeneshop,
  one.com, Squarespace, or anywhere else. Homer reads one sentence for his provider, written for its own screens (Shopify's: *Settings →
  Domains → {domain} → Domain settings → Edit DNS settings*), then the records with a **Copy** button each, and that a record for the
  same name pointing to Shopify is changed, not doubled. Where the provider takes our Domain Connect template, one press does it.
- **The check**: the open page asks every 30 seconds (`checkAddress()`, the domains page's `checkStoreDomain()`), says *Leads here ✓*
  per name by itself, and whether a name still answers from Shopify (`23.227.38.0/24` or `shops.myshopify.com`, `leadsToShopify()`).
- *Or let us look after your domain* links to moving its DNS here (D315).
- A move with a chosen time says, with it, to lower the address's TTL the day before.
- The provider sentences name today's menus of each provider: check them against the provider when one changes its screens.

Left for later: the logo and favicon, metafields, gift cards and the email list (step 8); reviews (they live in review apps, not in
Shopify, spike S6); a catch-up copy on move day.

**How steps 1 and 2 reached production.** A new admin page is a new entry in the admin map, and the map is part of the AI manager's
prompt, so the agents' eval replay (D391) fails until the eval is recorded again on production; a push with a migration waits for every
check, so step 1's first push (CI #929) neither applied its migration nor deployed. The tables and the server went first, without the
pages (`a4441a2`, both migrations); the pages followed in a push of their own without a migration, which deploys at once. **After it
deploys, press *Check the assistants' safety* in the Test card of Platform → AI, then *Download the recording* of that run (listed under *Earlier runs* with "the prompts as they are"), and commit it as `src/data/agent-eval-recording.json`**, so CI's replay
passes again. A later step that adds a page and a migration ships the same way: migration first, page after.

