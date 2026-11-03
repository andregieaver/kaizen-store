# Moving from Squarespace: the same three presses, with the website in them (D440 proposed)

The owner (3 November 2026) asked for a "moving from" plan for each platform, made as simple as `docs/moving-from-shopify.md` (D437):
"so simple and easy to follow that Homer Simpson could do it without breaking a sweat".

**This file is a plan only: nothing here is built.** It reuses the move engine of `docs/moving-from-shopify.md` and doesn't repeat it:
- the `commerce.shop_moves` and `shop_move_items` tables (Shopify plan, 10);
- the rule that only the existing writers write (8.1);
- Copy → Move with everything silent until Move (3, 7);
- the address check (8.2), the reconciliation (8.3), *Undo this copy* (8.4);
- the 14-day watch (4.8).

This file covers what is different for Squarespace. Section 12 holds the owner's decisions and section 13 the spikes.

---

## 1. The promise

Homer's shop is on Squarespace, so his **website and his shop are one thing**: pages, a blog, perhaps a few products, perhaps
appointments. He presses **Connect Squarespace**, says yes on Squarespace's page, and presses **Copy my site**. His new site is then ready
behind a password, and Squarespace keeps running until he presses **Move my site**.

Compared with Shopify, two things are harder, and Homer should never notice either:
- Squarespace's API reaches the shop but not the website.
- Its redirects can't be read by any API.

Both are handled in section 4.3, at the cost of one extra press each, never a file he has to understand.

## 2. What is there today, and what we found

### 2.1 Today in Kaizena Flow

Nothing reads Squarespace. The product import knows Kaizena Flow's, Shopify's and WooCommerce's files only (D165, D384), and
`file.unknown_format` refuses anything else. The page replicator (D150) copies one live page at a time from any site, Squarespace's
included. The redirect import (D168) reads Shopify's two-column file, not Squarespace's URL Mappings lines.

### 2.2 What Squarespace's API allows (read 3 November 2026)

- **The Commerce APIs** (<https://developers.squarespace.com/commerce-apis/overview>, fetched):
  - **Products**: physical, service, gift card and download products. A download product can be read but not created. There are up to
    100 pictures per product. **"Categories used by store pages aren't available through this API."**
    (<https://developers.squarespace.com/commerce-apis/products-overview>)
  - **Inventory**: stock per variant.
  - **Orders**: order history, 50 per page with a cursor. Each order has `orderNumber`, `channel` (`web` or `pos`), `customerEmail`,
    `lineItems`, `discountLines`, `shippingLines`, `refundedTotal`, `testmode` and, usefully, `priceTaxInterpretation` (`INCLUSIVE` or
    `EXCLUSIVE`). The docs state no limit on how far back it reaches
    (<https://developers.squarespace.com/commerce-apis/retrieve-all-orders>).
  - **Contacts**: customers, mailing-list subscribers and donors, with up to 50 addresses each. Each contact's email carries an
    **opt-in status with the date they joined and the date they left**, but no field for the source and none for double opt-in
    (<https://developers.squarespace.com/commerce-apis/contacts-overview>). Profiles, the older read-only API, is in maintenance mode.
  - **Discounts**: full access: codes, fixed amount, percentage, buy X get Y, free shipping, minimum basket, dates, use limits
    (<https://developers.squarespace.com/commerce-apis/discounts-overview>).
  - **Transactions** and **Webhook subscriptions**. Webhooks are OAuth only.
- **Access** (<https://developers.squarespace.com/commerce-apis/authentication-and-permissions>, fetched):
  - **API keys** are made by the owner under Settings → Advanced → Developer API Keys, and only on the **Advanced** plan. A key is shown
    once.
  - **OAuth** is for *Squarespace Extensions*, which work "on any plan". The OAuth client is requested at Squarespace's developer apps page
    (spike S1: what approval it needs).
  - **So we build an Extension**, as for Shopify. "Paste a key" would reach only Advanced shops and ask Homer to find a settings page.
- **What no API reaches**: pages, blog posts, the store page's categories, events, the site's look, URL Mappings, gift card codes (spike
  S4), and member areas.
- **The site export** (Settings → Advanced → Import / Export → Export → WordPress; third-party guides read 3 November 2026, e.g.
  <https://www.wpbeginner.com/wp-tutorials/how-to-properly-move-from-squarespace-to-wordpress/>): a WordPress XML (WXR) file with **one
  blog**, its posts (title, body, author, date, categories, tags, comments) and the basic pages, with pictures as links to Squarespace's
  servers. Products, store pages, events, galleries, audio and video, folders, custom CSS and the design are not in it. It is a download
  to his computer: no API starts it.
- **URL Mappings** (Settings → Advanced → URL Mappings; <https://www.collaborada.com/blog/squarespace-redirects>, a third-party guide): one
  text box, one rule per line, `/old -> /new 301`. Nothing reads it but the owner, so it can only be copied out of that box.
- **Addresses**:
  - A product lives at `/{store page}/p/{slug}`. The store page's slug is the owner's own (`/shop`, `/store`, …), and older
    products may carry a generated tail (`/store/p/earth-sky-planter-4awkk-nazcb-lbzst`; a community observation:
    <https://community.elfsight.com/t/squarespace-how-to-find-product-item-url/102935>).
  - Blog posts are at `/{blog}/{slug}`, or with a date (`/blog/2024/3/5/slug`).
  - Category filters are at `/{store page}?category=…` or `/{store page}/{category}` (spike S5).
  - Every Squarespace site serves `/sitemap.xml`, which is all the address check (Shopify plan 8.2) needs.
- **Mailing lists** (Marketing → Email Campaigns → Mailing Lists → ⋯ → Export List; community post
  <https://community.elfsight.com/t/how-to-export-subscribers-from-squarespace/58578>): a CSV per list. Subscribers kept in Mailchimp or
  Google Drive by a form never reach Squarespace at all.
- **Domains** (<https://www.squarespace.com/transfer-a-domain>; third-party guides, e.g.
  <https://www.snagged.com/guides/how-to-transfer-a-domain-away-from-squarespace>): Squarespace Domains holds many shops' domains,
  including the former Google Domains customers.
  - DNS is edited under Settings → Domains → the domain → DNS.
  - Moving the domain away means turning off its lock and asking for the auth code, which is emailed to the domain's contact.
  - A domain registered or moved in the last 60 days can't leave yet.

### 2.3 What that means

The **shop** comes over by API as fully as Shopify's, and in some ways better: an order says whether its prices included VAT, and
discounts can be read. The **website** needs two helpers: the WordPress file, for the blog and simple pages, and the page replicator, for
every page as it looks. The **redirects** need one paste.

## 3. The idea

```
 Connect ──► Check ──► Bring your website (one file, one paste) ──► Copy ──► look, fix, pay ──► Move ──► Watch ──► Close
```

This is the Shopify plan's path (Shopify plan, 3) with one step added, **Bring your website**, which is only offered when the API can't see
what the site has. When the site is just a shop with a home page, the step doesn't appear.

## 4. What Homer sees

### 4.1 Where he starts

He starts in the same places as for Shopify (Shopify plan, 4.1). At sign-up, *Do you sell somewhere already?* gets **Yes, on
Squarespace**.

### 4.2 Connect

> **Bring your Squarespace site**
> Paste your site's address. We only read it: nothing changes on Squarespace, and it stays live.
> `[ mysite.com                              ]`
> **Connect Squarespace**

Squarespace's own page asks him to allow the extension, and he comes back. Any address works: we find the site from its public pages
(spike S2).

### 4.3 Check, and "Bring your website"

The counts come in as for Shopify. Squarespace doesn't tell the API about pages, so the counts for pages and posts come from the public
sitemap:

> **Here's your site**
> 48 products in 6 categories · 1,120 customers · 870 of them get your emails · 3,400 past orders · 4 discount codes
> 14 pages · a blog with 96 posts · 230 links from Google and elsewhere
>
> **Two things only you can hand us** (about 2 minutes)
>
> **1. Your blog and pages.** Squarespace keeps these to itself, so we need a file from you.
> In Squarespace, open **Settings → Advanced → Import / Export Content → Export → WordPress**, then drop the file here.
> `[ Drop the file here ]` *Show me with pictures*
>
> **2. Your old redirects** (only if you made some). Open **Settings → Advanced → URL Mappings**, select everything in the box, copy it, and
> paste it here.
> `[                                    ]` *I never made any*
>
> **Copy my site**

What Homer can count on here:
- **Both are optional.** **Copy my site** works without them, and each can be added later from the checklist.
- **A skipped file costs nothing.** Without the file, the blog and pages come from the live site through the page replicator instead (5.2).
- **A skipped paste costs nothing either.** Without it, the address check (Shopify plan, 8.2) still finds every page Google knows, from the
  sitemap.
- ***Show me with pictures*** shows three screenshots of Squarespace's own screens, kept current by spike S7.
- **The file is checked the moment it lands.** If it's the wrong file, he sees: *This isn't Squarespace's WordPress file. Use Export →
  WordPress.*

Homer is asked nothing else. The answers come from the site:
- whether prices include VAT, from the orders' `priceTaxInterpretation` (spike S3 for products);
- currency and country, from the site's store settings;
- shipping, from the shipping options where the API or the order lines show them (spike S6), else our default flat rate with a line on
  the checklist;
- the look, from the live pages (5.3).

### 4.4 Copy, the checklist, Move

These are as for Shopify (Shopify plan, 4.4 to 4.8):
- *Your new site is ready to look at*, side by side with the old one;
- the checklist: payments first, then *Who makes your products?* per brand;
- **Move my site**, with the catch-up, the address check, the domain, then open.

**The domain step** (Shopify plan, 4.7) gains one case: **DNS at Squarespace Domains** (former Google Domains included). His steps are
written for Squarespace's screens (*Settings → Domains → mysite.com → DNS → …*), with Copy buttons, and we detect when it's done. *Or let
us look after your domain* offers moving it to us (D315), and says plainly when it can't move yet: *Squarespace keeps a domain for 60 days
after it arrives; you can move it from 14 January.*

**You can close Squarespace now** (day 14) warns him about the one thing that's easy to lose: *If you use Squarespace Email Campaigns,
Scheduling or Member Areas, export them before you cancel. Your domain stays yours if you've moved it, or if you keep paying for it at
Squarespace.*

## 5. What comes over

### 5.1 By API

| Squarespace | Kaizena Flow | Through | Notes |
|---|---|---|---|
| Physical products, variants, SKUs, weights, pictures | Products | the product import's neutral rows → `saveProduct()` | Matched by slug, as Shopify by handle |
| Prices | Prices for the main country, VAT-inclusive | `commerce.set_price` | Squarespace has one currency per site |
| Sale price (`onSale`) | — | — | Never as a reduction (98/6/EC Art. 6a): the sale price is not imported as a reduction. **Decision 2** says which price becomes the price |
| Stock | Stock at the one location | inventory writer (D172) | |
| Service products | Products with no shipping | as above | A bookable service (Scheduling) is listed, not copied (6) |
| Download products | Digital products | the digital writers | The file itself is fetched through `safeFetch()` where the API gives an address (spike S8) |
| Gift card products | Our gift card product (D300) | | The product, not cards already sold (6.2) |
| Tags | Tags | | |
| Store page categories | Categories | from the live store page (spike S5) | The API doesn't give them |
| Contacts (customers) | Customers and addresses | the customer import's writer (D366) | |
| Contacts' opt-in | Subscribers | as Shopify plan 6.2, source `squarespace` | **Decision 1** |
| Orders | Order history `C-{orderNumber}` | `insertHistoryOrder()` (D384) | `testmode` orders left out. `pos` orders kept, marked as in person |
| Discounts | Discounts (D299), off until Move | `discounts.ts` | Only the rules ours can express; the rest listed |

### 5.2 By the file and the live site

| What | From | Into |
|---|---|---|
| Blog posts with authors, dates, tags, categories and comments | the WordPress file | Blog articles (D341); comments kept as approved only where blog comments are on (spike S9) |
| Basic pages | the WordPress file | Pages, as rich text |
| Every page **as it looks** (home, about, landing pages) | the page replicator (D150), one run per page in the sitemap | Pages in the builder, as drafts. Homer chooses on one screen: *Keep my pages as they look* (default) or *Start from a Kaizena Flow theme* |
| A blog with no file | the live blog's pages, through the replicator's text reader | Articles, text and pictures only, said in the report |
| Pictures | Squarespace's image servers, through `safeFetch()` | the media library (D88) |
| Navigation | the live site's header and footer | Menus (D85), each link pointed at the new pages |
| URL Mappings | the pasted text | Redirects (D168), each line read by a new pure reader `readUrlMappings()` (`/a -> /b 301`; a `302` comes in as a permanent one with a finding) |

When the file and the replicator both have a page, the replicator's version wins for layout and the file's for text, and the report says
which.

### 5.3 The look

Brand and look (D330) read the live site: logo, favicon, colours, fonts and the button style. The theme picker then opens with a
suggested theme already wearing them (*This one looks most like your site*). Squarespace's template code is never copied.

## 6. What doesn't come over

| Left behind | What we say |
|---|---|
| Gift cards already sold | Spike S4: if the API gives balances and holders, the Shopify plan's 6.4 applies (new codes, frozen until Move, emailed on move day). If not, the checklist says: *Squarespace doesn't share your gift cards. Make a list from Commerce → Gift cards and add them here*, with a small form for code ending, balance and email |
| Scheduling (Acuity) appointments | *Your bookings stay in Scheduling. Set up Bookings here* (D65), with the services already made as products |
| Member areas, courses, paid content | Listed. Nothing here yet for paywalled content |
| Email Campaigns' designs | Not copied. The subscribers come over (Decision 1) |
| Subscribers in Mailchimp or Google Drive | *Your sign-up form sent people to Mailchimp; they were never on Squarespace*, with a pointer to the subscriber import |
| Squarespace Payments, Stripe or PayPal connections | *Connect payments here*. His Stripe account may be the same Stripe account, but it is connected again, through Stripe Connect |
| Events, galleries, audio, video blocks | Kept as they look through the replicator where it can, else listed with the page they were on |
| Custom code and CSS | Never run. Listed, so Lisa can carry what she needs into Own CSS (D100) by hand |
| Analytics | As for Shopify (Shopify plan, 6.1) |

### 6.1 The email list (Decision 1)

Squarespace's contact says *opted in*, *when they joined* and *when they left*, but not how they joined or whether they confirmed. That is
less evidence than Shopify gives. The recommendation stays the same as for Shopify (Shopify plan, 6.2), with one difference:
- each subscriber is written with `confirmedAt` empty;
- the consent text is *Joined {site}'s list on {date}, as Squarespace recorded it*;
- a contact who left is never subscribed;
- if a mailing list's export is dropped in, it adds the list's name, and nothing else.

### 6.2 Customer accounts

As for Shopify (Shopify plan, 6.3): customers sign in here with a code, so no password moves.

## 7. The switch day

This is the Shopify plan's section 7, with two differences:
- **The catch-up reads orders by `modifiedAfter`** (the time of the last copy), so it reads only what changed.
- **The website is part of the move.** The address check also covers the pages and blog posts, and *Move* opens the new pages.

Squarespace's webhooks (OAuth only) could tell us about an order the moment it is placed. We use them during the 14-day watch, so a late
order on the old site is copied within minutes, not by the next day's check.

## 8. Robust by construction

Everything in the Shopify plan's section 8 holds. Squarespace adds four things:
- **The WordPress file is untrusted input.** It is parsed by a strict XML reader with no external entities, held to a size limit, and
  stored in the private `imports` bucket. Its HTML is turned into our rich text, never kept as HTML.
- **The pasted URL Mappings** are read line by line by a pure reader. A line it can't read is named, never guessed at. A loop or a chain
  is shown by the D168 checks.
- **The replicator's runs are rate-limited** per site and resumable per page, as one stage of the move job.
- **The API has no stated rate limit** (spike S1). We start politely, back off on `429`, and keep the cursor in the job, so a stopped tick
  resumes from the same page of orders.

## 9. Lisa, one step away

Everything in the Shopify plan's section 9, plus:
- per page, *as it looks* or *as text*;
- the WordPress file's posts one by one;
- the URL Mappings as read, line by line, with each line's finding;
- *From an API key instead*, for an Advanced plan site whose owner would rather not install an extension.

## 10. Data, permissions and law

As in the Shopify plan's section 10. Also:
- the extension's token is encrypted and deleted at the end of the move;
- the WordPress file and the pasted mappings are kept 7 days, as data jobs' files are (D165);
- the replicated pages are the owner's own content, copied at his request, from his own site.

## 11. The AI manager

As in the Shopify plan's section 11. The skill also:
- explains where Squarespace's export is (*Settings → Advanced → Import / Export Content*);
- reads the URL Mappings the owner pastes into the chat and offers to add them (through the same reader, with his yes).

The blog posts, pages and pasted text are untrusted (`UNTRUSTED_TEXT`). The eval case from the Shopify plan gets a Squarespace twin: a
blog post that asks the agent to publish something.

## 12. Build order

This builds after the Shopify plan's steps 1 to 3, which build the engine.

1. **The URL Mappings reader** into the redirect import (useful at once, with no extension): `readUrlMappings()`, a format in
   `FileFormat`, the paste box on Redirects → Import.
2. **The WordPress (WXR) reader** into blogs and pages. It serves WooCommerce's and WordPress's movers too.
3. **The Extension and Connect**, then **Check**, from the API and the sitemap.
4. **Copy**: products, stock, contacts, orders, discounts.
5. **Bring your website**: the replicator over the sitemap, the menus from the live header and footer, the look.
6. **Move day** with Squarespace Domains' steps, and webhooks for the 14 days.
7. **Gift cards**, after S4.

## 13. Decisions for the owner

1. **The email list** (6.1): the same choice as Shopify's Decision 1, on weaker evidence (no confirmation, no source). Recommended:
   import those opted in, with the date, after the same legal read.
2. **A product on sale**: import the **sale price as the price** (what shoppers pay today; recommended) or the regular price. Either
   way, no reduction is shown until the store has 30 days of its own prices.
3. **Pages**: *Keep my pages as they look* (the replicator, recommended) or *Start from a theme* as the default for Homer.
4. **The extension's listing** in Squarespace's Extensions marketplace (findable, needs Squarespace's review) or unlisted.

## 14. Spikes before code

| # | Question | How |
|---|---|---|
| S1 | What a Squarespace Extension needs: approval, review time, scopes per API, rate limits | Request an OAuth client; read the extension terms |
| S2 | From `mysite.com` to the site's id with no sign-in | Read a few live sites' HTML and `?format=json` answers (spike only, no product dependency on an unstable format) |
| S3 | Whether a product's price says VAT-inclusive, and how a site's tax settings are read | The Products API's pricing fields; three EU sites |
| S4 | Gift cards: can the API read cards sold, their balances, holders and codes? | The Products and Transactions APIs; Squarespace support |
| S5 | Store page categories: their addresses and where to read them | Five live stores; the store page's JSON |
| S6 | Shipping options: reachable or only from order lines? | API docs; a test site |
| S7 | The export and URL Mappings screens as they are today, for *Show me with pictures* | A test site on each plan |
| S8 | Download products: can the file be fetched? | A test download product |
| S9 | What the WordPress file holds on a real site: pictures, comments, more than one blog | Three exports |
| S10 | End to end on a test site with products, a blog, pages, discounts, 1,000 orders | A Squarespace trial site |

## 15. Tests

- `readUrlMappings()`: every line shape, comments, blank lines, `302`, full URLs, a malformed line.
- The WXR reader: a real export as a fixture; no external entity is ever resolved; HTML becomes rich text; a size limit.
- Mapping from API answers (fixtures from real responses) to neutral rows.
- Integration against a Squarespace stand-in (`e2e/fixtures/squarespace-stub.mjs`): a full move, a second run that changes nothing, a
  catch-up by `modifiedAfter`, a test-mode order left out, a contact who left never subscribed.
- e2e: Homer's path, with and without the file and the paste.

## 16. What this does not do

- It never writes to Squarespace, and never cancels or changes anything there.
- It never copies Squarespace's template code or custom code.
- It never moves appointments, member areas or courses: it says what to use instead.
- It never shows an imported sale price as a reduction.
- It never subscribes anyone Squarespace didn't record as opted in.
