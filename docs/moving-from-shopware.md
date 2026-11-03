# Moving from Shopware: the German shop, kept German-proof (D442 proposed)

The owner (3 November 2026) asked for a "moving from" plan per platform, as simple as `docs/moving-from-shopify.md` (D437), "so simple and
easy to follow that Homer Simpson could do it without breaking a sweat". This is Shopware's.

**This file is a plan only: nothing here is built yet.** The move engine is the one in `docs/moving-from-shopify.md` and is not described
again here:
- `commerce.shop_moves` and `shop_move_items` (Shopify plan, section 10), with `source` `shopware6` or `shopware5`;
- only the existing writers write (8.1);
- the address check (8.2), the reconciliation (8.3) and *Undo this copy* (8.4);
- private mode, silent emails, frozen gift cards and discounts switched off until Move (7);
- the 14 days after and *You can close …* (4.8).

This file covers only what is different for Shopware. Code, tests and texts follow this file. If they disagree, this file is corrected
first.

---

## 1. The promise

Homer runs a Shopware shop, most likely in Germany, Austria or Switzerland. He installs the **Kaizena Flow** app from the Shopware Store
in his own Shopware admin, or pastes two keys. Then he presses **Copy my shop**, looks at the new shop behind a password, and presses
**Move my shop**.

What comes over:
- His products in every language, with manufacturers and unit prices;
- his legal pages (Impressum, AGB, Widerrufsbelehrung, Datenschutzerklärung);
- the customers who confirmed his newsletter;
- his past orders, reviews and voucher codes;
- every old link, including the ones Shopware itself kept from earlier URLs.

The German rules he already follows keep holding: the unit price (Grundpreis), the lowest price of the last 30 days, VAT IDs checked and
double opt-in. His email keeps working because we never touch his mail records.

As for Shopify: no file, no order to remember, no word like "API", "Sales Channel", "SEO URL" or "DNS", and no question his shop can
answer itself.

## 2. What is there today, and what we found

### 2.1 Built

Nothing reads Shopware. The product import knows Kaizena Flow's own file, Shopify's and WooCommerce's (`isWooCommerce()`, D384), and a
Shopware export lands on *This is not a product file we know*. Everything the Shopify plan reuses is here too: the redirect service (D168),
`legacy-path.ts`, the customer, order-history and review writers, private mode, domains (D315), unit price (D160) and B2B (D63, D108,
wave 6 C).

### 2.2 What Shopware is (read 3 November 2026)

- **Two generations.**
  - **Shopware 6** is current: 6.7 is the stable version on developer.shopware.com.
  - **Shopware 5** stopped being developed at the end of July 2024, with no more security fixes after that, only reactive fixes for
    subscription contracts (<https://docs.shopware.com/en/shopware-5-en/end-of-life>). Paid long-term support is offered by a third
    party.
  - Many Shopware 5 shops still run, and they are the owners with the strongest reason to move: their own platform asks them to migrate
    anyway (to 6 with Shopware's Migration Assistant, <https://github.com/shopware/swagmigrationassistant>).
- **Self-hosted or cloud.**
  - The Community Edition runs only on the owner's own server.
  - The paid plans Rise, Evolve and Beyond run self-hosted, as PaaS or as SaaS. SaaS shops can use only **apps**, not plugins
    (<https://hub.shopware.com/learn/unit/solutions-architect-shopware-plans-and-delivery-models.md>).
  - So an app is the one way in that works on every Shopware 6 shop.
- **The Admin API** (<https://developer.shopware.com/docs/guides/integrations-api/>, fetched).
  - An **integration** is made under Settings → System → Integrations. Its *Access key ID* and *Secret access key* are an OAuth
    `client_id` and `client_secret` for `POST /api/oauth/token` with `grant_type=client_credentials`, which returns a short-lived bearer
    token.
  - Reads are `POST /api/search/{entity}` with a criteria body: `filter`, `sort`, `page` and `limit`, `associations` (nested criteria
    included), `ids`, and `total-count-mode` (0 none, 1 exact, 2 "is there a next page")
    (<https://developer.shopware.com/docs/guides/integrations-api/general-concepts/search-criteria.html>).
  - Every entity is reachable the same way. One reader serves them all.
- **Apps** (<https://developer.shopware.com/docs/v6.6/guides/plugins/apps/app-base-guide.html>,
  <https://developer.shopware.com/docs/v6.6/resources/references/app-reference/manifest-reference.html>).
  - An app declares its permissions entity by entity in `manifest.xml` (`<read>product</read>` and so on).
  - At install, the shop makes a signed request to the app's registration URL. Both sides prove the shared secret. The app then receives
    the shop's URL, its id and **API credentials** limited to the declared permissions.
  - A Store app's secret is issued through the Shopware Account, and a hard-coded secret cannot be uploaded to the Store.
- **Prices** (`Framework/DataAbstractionLayer/Pricing/Price.php` on GitHub `shopware/shopware`, trunk, read).
  - A product's `price` is a list, one per currency: `net`, `gross`, `linked`, `listPrice` (the struck-through price), `percentage`, and
    **`regulationPrice`**, the lowest price before a reduction that the Omnibus directive asks for.
  - Amounts are **floats**.
  - *Advanced prices* (`product_price`) are prices per rule and quantity range.
- **Products** (`Content/Product/ProductDefinition.php`, read).
  - Variants are child products of a `parentId`, made from configurator **options**. A child's empty field **inherits** the parent's.
  - Filterable **properties** are separate from options.
  - A product has `productNumber`, `ean`, `stock`, `weight`, `taxId`, and `purchaseUnit`, `referenceUnit` and `unit`: the data of the
    German *Grundpreis*.
  - A product has a real **manufacturer** (`product_manufacturer`: name, link, description, logo). It carries no postal address in core.
    GPSR data is kept in the manufacturer's custom fields by plugins, each under its own keys
    (<https://www.shopware.com/en/news/implementing-product-safety-regulation/>).
- **SEO URLs** (`Content/Seo/SeoUrl/SeoUrlDefinition.php`, read).
  - `seo_url` holds, per sales channel and language, `pathInfo` (the technical route, `/detail/{id}`), `seoPathInfo` (the pretty one),
    `isCanonical`, `isModified` and `isDeleted`.
  - When a URL changes, the old row stays as non-canonical, and Shopware redirects it (301) to the new one.
  - So **the shop already holds its full history of old addresses.** No other platform hands us that.
- **Newsletter** (`NewsletterRecipientDefinition.php` and `NewsletterSubscribeRoute.php`, read).
  - `newsletter_recipient` has `email`, names, `status`, `confirmedAt`, `languageId` and `salesChannelId`.
  - `status` is one of:
    - `notSet`: double opt-in asked, not yet confirmed;
    - `optIn`: confirmed;
    - `direct`: subscribed with double opt-in switched off;
    - `optOut`.
- **Gift cards** aren't in Shopware's core. Shops use plugins, or **promotions with individual codes** as vouchers (*Gutscheine*), whose
  codes the API can read.
- **Sales channels.** One Shopware install may run several storefronts. Each has its domains, and each domain has a language, a currency
  and a snippet set. Headless and other API channels sell elsewhere.

### 2.3 What that means

1. **Better data than Shopify's.** It has real manufacturers, unit prices, every language, readable voucher codes and the full history of
   old URLs. Most of the Shopify plan's compromises go away.
2. **A harder door.** There is no single platform to install from. A self-hosted shop may be on any version, behind any firewall, at any
   hoster. Shopware 5 speaks a different API.
3. **A German owner.** He knows his legal duties and will notice if one slips. The Impressum, the Widerruf, the Grundpreis, double opt-in,
   the VAT ID of a business customer and keeping invoices (GoBD) must all visibly survive the move.

## 3. The idea

The same presses as for Shopify (its section 3): **Connect → Check → Copy → (look, fix, pay) → Move → Watch → Close**. What differs is how
we connect (4.2), what Check must ask (4.3), and the address switch at a German hoster (4.6).

## 4. What Homer sees

The words are written in English here, as the Shopify plan's are. They reach the owner in the admin's languages, **German first** for this
path (section 12, Decision 5).

### 4.1 Where he starts

As for Shopify (its 4.1), with *Yes, on Shopware* among the answers at sign-up, and the card *Moving from Shopware? Bring everything over
in a few minutes.*

### 4.2 Connect

> **Bring your Shopware shop**
> Paste your shop's address. We only read it: nothing changes in Shopware, and it keeps selling.
> `[ www.mein-laden.de                          ]`
> **Continue**

We look at the address (spike S1) and show **one** of three ways:

**Shopware 6 (all plans, also cloud): the app, recommended.**

> **Install Kaizena Flow in your Shopware**
> 1. **Open my Shopware admin** (opens `{shop}/admin#/sw/extension/store` in a new tab)
> 2. Search for *Kaizena Flow* and press **Install**, then **Activate**.
> 3. Come back here. We'll notice by ourselves.
>
> *Shopware will show you what we may read. It's only reading.*

The app's manifest asks for `read` permissions only (section 9). Its registration confirms the shop and hands us the shop's API
credentials. The page turns to *Connected ✓ mein-laden.de* on its own.

**Shopware 6 without the Store** (an old 6.x, or an owner whose admin can't reach the Store): two keys.

> **Make a key for us in Shopware**
> 1. In Shopware, open **Settings → System → Integrations** and press **Add integration**.
> 2. Name it *Kaizena Flow*, leave *Administrator* off, and give it the role **Kaizena Flow (read only)**. *Don't have that role? Here's
>    how to make it in one minute* (one screen of ticks, with a picture).
> 3. Copy the two keys here:
>    `[ Access key ID      ]`  `[ Secret access key ]`
> **Connect**

The role is spike S2: Shopware's ACL roles can be read-only per entity. The screen never asks for an *Administrator* key. If one is pasted
anyway, it still works, and we say once *This key can change your shop; we only read. You can delete it after the move.*

**Shopware 5.**

> **Your shop runs Shopware 5**
> Shopware 5 hasn't had security updates since July 2024, so moving is a good idea. We can bring it over too.
> 1. In Shopware, open **Settings → User administration**, edit your user, tick **API access**, and press **Save**.
> 2. Copy the **API key** shown there, and your user name, here.
> **Connect**

Shopware 5's REST API (`/api/articles`, `/api/customers`, `/api/orders` and the rest, digest authentication with a user's API key) is a
reader of its own (section 11, step 7).

**What can go wrong**, each with one sentence and one button:

| What went wrong | What Homer reads |
|---|---|
| The admin is behind HTTP password protection | *Your Shopware asks for a password before it opens. Type it here, only for us.* |
| A firewall answers nobody | *Your shop doesn't let us in. Ask your hoster to allow Kaizena Flow's address* (a list, from `vercel.json`'s region; spike S3) |
| An old 6.x has no app system | Leads to the keys path |

### 4.3 Check: "Here's your shop", and the few questions only a German shop has

> **Here's your shop**
> 1,240 products in German and English · 38 manufacturers · 64 categories · 22 pages
> 3,400 customers, 410 of them businesses · 1,180 confirmed your newsletter
> 18,600 past orders · 1,060 reviews · 240 voucher codes still open
> 2,950 old links that will keep working
> Your Impressum, AGB, Widerruf and privacy policy come along as you wrote them.
>
> **Copy my shop**

The questions, and how most of them never reach Homer:

| Question | Answer |
|---|---|
| **Which storefront?** | One sales channel of type *Storefront*: no question. Several: *You have two shops in this Shopware: mein-laden.de and mein-laden.at. Bring both?* Each becomes its own store (recommended) or a country of one store (Lisa, section 8) |
| **Prices with VAT?** | Shopware keeps both `gross` and `net`. We take `gross`, so there is no question |
| **Which VAT category is 7 %?** | Each Shopware tax rate is matched against our reduced rates for the shop's country (`commerce.vat_rates`). Where one rate fits one category, no question. Where 7 % could be food, books or something else: *Your products at 7 % VAT: what are they?* with the categories as buttons, asked **once per tax rate**, not per product |
| **Prices in other EU countries** | Shopware may keep one gross price everywhere, or work it out from the net price and each country's VAT (spike S4). We read which, and do the same with our country prices. Homer sees *Your prices in Austria stay as they are* |
| **Languages and currencies** | From the sales channel's domains: each language becomes a language of the store (D109). A domain per language becomes a language domain (D313) |
| **Shipping** | Shopware's shipping methods with their price matrix become a flat rate per country and a free-shipping threshold where the matrix is that simple. Otherwise *We set €4.90 for Germany, the price most of your orders paid. Check it* (one press to open it) |
| **Payment** | His payment methods are read (PayPal, Klarna, Mollie, Unzer, invoice purchase and so on). The checklist names the ones he can have here, by country (D291), and says honestly which he can't |

### 4.4 Copy, then "Your new shop is ready"

As for Shopify (its 4.4). The checklist differs:
- **Get paid** comes first, as there.
- **Who makes your products?** asks only for what is missing. Shopware already names the manufacturer, and the owner chose it, so it comes
  over as the manufacturer. If a GPSR plugin kept addresses in custom fields, we read them (spike S5). Otherwise: *We need the address of 12
  of your 38 manufacturers*, with one form per manufacturer, not per product. The same applies to the EU responsible person (R5).
- **Your legal pages** shows his Impressum, AGB, Widerruf, privacy policy and shipping-and-payment page side by side with ours (D158).
  *Use mine* is the default, because a German owner's texts are often written by a lawyer or a legal service. If his texts came from a
  service that updates them automatically (an *AGB-Schnittstelle*), we say so: *Your AGB were kept up to date by {service}. Connect it
  here, or let us look after them* (D311).

### 4.5 Move day

As for Shopify (its 4.6 and 7). Two things differ:

- **Voucher codes keep their codes.** Shopware's codes are readable (2.2), so a voucher bought in the old shop works in the new one with
  the same code. Copied vouchers are frozen until Move. On Move, each code still open in Shopware is opened here and **closed in the
  report** for Shopware. We can't close it in Shopware, because we only read. So the move-day page asks Homer for one press in Shopware,
  with the exact steps: *Deactivate the promotion "Gutscheine 2026"*. Until he does, the daily check (Shopify plan, 4.8) watches for a code
  used in both shops.
- **Shopware 5 shops** get the same steps, worded for its backend.

### 4.6 Switching the address at a German hoster

Self-hosted Shopware sits at a hoster, and its domain's DNS is usually there too, **often with the shop's email in the same place**. That
changes the rule:

- **We change only the website's records** (the `A`/`AAAA` record of the bare domain, `www`'s `CNAME`) and **never the nameservers,
  never `MX`, never `TXT` records we didn't make.** The steps say it in his words: *Your email stays exactly where it is.*
- The hosters most of these shops use get their own written steps:
  - IONOS, STRATO, Hetzner, ALL-INKL, netcup, Hostinger and Mittwald;
  - the general steps for any other.
  Each value has a **Copy** button, and we check every 30 seconds by ourselves, as for Shopify (its 4.7). Whether any of them supports
  Domain Connect, so that *Switch it for me* works there, is spike S6.
- **Shopware cloud (SaaS) shops** point their domain to Shopware the same way. The steps are written for that too.
- **The shop's own server keeps running** until he cancels it. *You can close Shopware now* (Shopify plan, 4.8) adds one honest line for
  self-hosted shops: *Your hosting contract with {hoster} is separate. Keep it until you've downloaded your backup* (8.2).

## 5. What comes over

| Shopware | Kaizena Flow | Notes |
|---|---|---|
| Products, parents and variants | Products and variants | Read with inheritance resolved (spike S7), so a variant has its parent's values where its own are empty |
| Configurator options (size, colour) | Variant options | |
| Properties (filterable) | Filters and attributes (D78), custom fields (D118) where they aren't filters | |
| `productNumber`, `ean`, weight, dimensions | SKU, barcode, weight, dimensions | |
| `price`: gross per currency | Prices per country, VAT-inclusive, through `set_price` | Floats turned into integer minor units with the currency's decimals, rounded half-even, any difference above 0.005 named (8.1) |
| `listPrice` (struck-through) | — | Never, as Shopify's compare-at (98/6/EC Art. 6a) |
| `regulationPrice` (lowest of 30 days) | — | Not needed: we keep our own price history from the move on. What Homer reads: *Your sales stay legal: we work out the 30-day lowest price ourselves* |
| Advanced prices by customer group | Customer group prices (D108) | Only rules that test a customer group, and quantity ranges (wave 6 C). Any other rule is listed, never guessed |
| Tax rate | VAT category (D65) | 4.3 |
| `purchaseUnit`, `referenceUnit`, `unit` | Unit price (D160) | The Grundpreis keeps working, so PAngV duties hold |
| Manufacturer: name, link, logo, description | **Manufacturer** | The owner named it in Shopware. Addresses from GPSR custom fields where we know the plugin (S5) |
| Media, alt texts, cover, order | Media, gallery | Through `safeFetch()` |
| Category tree | Categories with their order, descriptions, pictures, SEO texts | A category of type *link* becomes a menu link. A *folder* (*Strukturelement*) becomes a menu heading |
| The main navigation (the sales channel's root category) and the footer and service menus | Menus (D85) | Shopware builds its menus from the tree, so his menus come for free |
| Shopping Experiences layouts (sections, blocks, slots) | Page blocks | Text, image, image-text, gallery, product box and slider, category listing and video map to our blocks (spike S8). A block we don't know falls back to the page replicator (D150) for that section, so nothing is blank |
| Landing pages | Pages | |
| Translations in every language | Translated fields | |
| `seo_url`, canonical **and** old rows | Redirects (D168) | 5.1 |
| Customers, salutation, title, addresses, customer group | Customers, saved addresses, groups | Customers sign in with a code, so no password moves |
| A customer's company and `vatIds` | Company accounts (D108), B2B (D63) | Each VAT ID checked again through VIES before it changes a price |
| Newsletter recipients | Subscribers (D295) | 6.2 |
| Orders: number, state, lines, addresses, deliveries, refunds | Order history (`C-{orderNumber}`, D384) | Three states (order, payment, delivery) become paid, fulfilled or cancelled |
| Order documents (invoices, credit notes, delivery notes) | Kept as files on the copied order, read only | 6.3 |
| Promotions with codes (fixed and individual) | Discounts (D299), or gift cards when it's a voucher of value | 4.5. Rules we can't express are listed |
| Product reviews (`product_review`, core) | Reviews (D301) | With their status: hidden stays hidden |
| Cross-selling | Recommendations (D139) where they are a fixed list | Dynamic product groups are listed |
| Custom fields | Custom fields (D118), private until he chooses | |
| Theme settings (colours, logo, favicon, fonts) | Brand and look (D330, D62) | His look, not the Twig code |
| Legal pages (from *Basic information*) | Legal pages (D158), as his own | 4.4 |

### 5.1 Old links, better than anywhere else

- **Canonical rows.** For every product, category and landing page, the canonical `seoPathInfo` per language becomes the source of a
  redirect to the new page.
- **Old rows.** Every non-canonical row (`isDeleted` false) is an **old** address Shopware itself still redirects. It becomes a redirect
  **straight** to the new page, never through the canonical one, so there is one hop, not two.
- **Technical routes.** Shopware's technical routes (`/detail/{id}`, `/navigation/{id}`) get redirects too, because shops and feeds link
  them.
- **Language prefixes.** A domain with a language prefix (`/en/`) keeps the prefix as a source.
- **The check.** The address check (Shopify plan, 8.2) reads Shopware's own `sitemap.xml` on top, and the counts are then compared:
  *2,950 of 2,950 old links lead somewhere ✓*.

## 6. What doesn't come over, and what we do instead

### 6.1 Said once, plainly

| Left behind | What we say and do |
|---|---|
| Plugins and Twig themes | Never run. His look comes over. The list of his plugins and apps (spike S9) shows ours beside each where we have one: *Pickware → Inventory*, *Mollie → Payments*, *Klaviyo → Email automations*, and *nothing here yet* where we don't |
| Rule Builder rules beyond customer group and quantity | Listed with their names (*"Wholesale Austria, more than €500"*), so Lisa can make the same in workflows (D356) or discounts |
| Flow Builder flows | Listed. Workflows (D356) are offered beside them |
| Several sales channels in one store | By default, one store each (4.3) |
| Payment providers' contracts | He keeps his PayPal, Mollie or Klarna accounts, but connects them here again (D292) |

### 6.2 The newsletter (Decision 1)

In Germany, double opt-in is the norm courts expect for email marketing (§ 7 UWG and the case law on it). Shopware records exactly that, so
we treat its statuses by their meaning:

| Shopware status | Here |
|---|---|
| `optIn` with `confirmedAt` | Subscriber, `confirmedAt` set, `source` `shopware`, `consentedAt` = `confirmedAt`, `consentText` *Confirmed the newsletter of {shop} by email while it was on Shopware* |
| `direct` (double opt-in was off) | **Decision 1**: recommended not subscribed, but listed (*312 people subscribed without confirming by email. Ask them to confirm?*), with one press sending them our double opt-in email from the new shop after the move |
| `notSet` (never confirmed) | Not subscribed |
| `optOut` | Not subscribed, ever |

The recipient's language and sales channel become the subscriber's locale and country. This is stricter than the Shopify plan's
recommendation, because the evidence and the law are different. Section 12 says why.

### 6.3 Invoices he must keep (GoBD)

German law makes him keep invoices and credit notes for years (§ 147 AO, § 14b UStG). They live in Shopware as documents.

- We download each order's documents as PDFs into the private store and attach them to the copied order, read only. The copied order is
  never invoiced again by us (D129).
- *Your old invoices are kept with each past order, and you can download all of them at once.*
- We don't take over his archive duty, and we say so. The move-day page and *You can close Shopware now* both say: *Keep a full backup of
  your Shopware (your hoster can make one) for as long as the law asks you to keep invoices.*
- Which documents can be read through the API, and how fast, is spike S10.

## 7. The switch day

As for Shopify (its section 7), plus:
- **Step 2, catch-up**: new orders since Copy are read by `createdAt` and `updatedAt`. Products, prices, stock and vouchers are read
  again.
- **Vouchers** (4.5).
- **The DNS rule** (4.6): only the website's records, never mail.
- **Shopware 5**: the catch-up runs on its API the same way.

## 8. Robust by construction

The Shopify plan's section 8 holds whole. What Shopware adds:

### 8.1 Reading

- **Paging.** One reader for every entity: `POST /api/search/{entity}` with `total-count-mode: 1` once for the count, then pages in a
  stable order (`id` ascending, keyset where the version allows it, spike S11) so that rows changing during the read are neither skipped nor
  read twice.
- **Inheritance and languages.** Inheritance is resolved (S7), and each language is read once.
- **Keeping the file.** Each page is written to the private bucket before it's mapped, as for Shopify's bulk files.
- **Tokens.** The bearer token is short-lived and renewed on a `401`. A `429` or a `5xx` waits and tries again later.
- **A gentle reader.** A self-hosted shop is often a small server: we read at most a few requests at a time, and slow down when its answers
  slow down. Homer's shop must keep selling during Check.
- **Money.** Floats to minor units, by the currency's own decimals: €19.99 is 1999. The reconciliation (Shopify plan, 8.3) compares order
  totals per currency both as Shopware's floats summed and as our integers, and names any difference.

### 8.2 The backup we keep

Everything read is kept for 90 days, as for Shopify. For a self-hosted shop, this is often the only copy he has outside his hoster.

## 9. Lisa, one step away

As for Shopify (its section 9), plus:
- **Sales channels**: which storefront is which store, or which country.
- **Rules**: each advanced-price rule, with what it became or why it didn't.
- **Tax rates**: each Shopware tax rate and its VAT category.
- **Old links**: every `seo_url` row and its redirect.
- **Documents**: the archive download.

## 10. Data, permissions and law

As for Shopify (its section 10). Different:

- **Credentials.** The app's shop secret and API credentials, or the pasted keys, are encrypted with `SETTINGS_ENCRYPTION_KEY`. They are
  deleted when the move is closed, after 14 days, or on *Disconnect Shopware*, and the app's uninstall webhook deletes them at once. The
  screen also reminds him to delete the integration in Shopware.
- **The app's permissions** are `read` on the entities in section 5 and nothing else: no `create`, `update` or `delete`, and no
  `system:` privileges. It never takes an Administrator integration.
- **Its listing** in the Shopware Store needs a Shopware Account and Shopware's review (spike S12). Its texts are in German and English.
- **Where.** Shopware is called from `dub1`. The documents and pages read are kept in our EU storage. Shopware AG (Germany) is not a
  processor of ours. The owner's own hoster is his.
- **Erasure.** A person's data in `shop_move_items`, the kept files and the archived documents is reached by an erasure (D162). The archive
  of invoices is kept apart as his legal record. An erasure there follows the retention duty, as invoices already do (D159).

## 11. The AI manager and build order

**The AI manager** gets a *Moving from Shopware* part in the moving skill (Shopify plan, 11). It knows the German words (*Grundpreis*,
*Widerrufsbelehrung*, *Gutschein*, *Hersteller*) and answers in the owner's language. It never connects, copies, moves or undoes. Texts
read from Shopware are untrusted (`UNTRUSTED_TEXT`), with an eval case for an instruction hidden in a Shopping Experiences text block.

**Build order.** This comes after the Shopify plan's steps 1 to 3, which make the engine. Each step is useful on its own.

1. **The Shopware 6 reader** behind the two keys (4.2, second way): Check only.
2. **Copy, part 1**: products with variants, options, properties, manufacturers, unit prices, every language, tax categories (4.3),
   customers, orders, reviews, the redirects from `seo_url` (5.1).
3. **Copy, part 2**: categories as menus, Shopping Experiences pages, legal pages, promotions and vouchers, the newsletter (once Decision 1
   is settled), documents (6.3).
4. **Move day** with the German hosters' steps (4.6).
5. **The Shopware Store app** (4.2, first way), once it is listed.
6. **Sales channels as several stores.**
7. **Shopware 5**: its own reader over its REST API, into the same neutral rows.

## 12. Decisions for the owner

1. **The newsletter's `direct` subscribers** (6.2). Recommended: not subscribed, with a one-press double opt-in email after the move. The
   alternative is to subscribe them as Shopware did, which a German court might not accept for people who never confirmed. Needs a legal
   read with Decision 1 of the Shopify plan.
2. **Old invoices** (6.3): kept as read-only files on the copied orders (recommended), or not read at all, leaving the archive wholly with
   the owner's backup.
3. **Several storefronts** (4.3): one store each (recommended), or countries of one store.
4. **Shopware 5**: build its reader (recommended, because it's the group that must move anyway), or offer Shopware's own route to 6 first.
5. **German in the admin**: this path is mostly used in German. Do the moving screens and the checklist get hand-written German (D212)
   before this ships? Recommended: yes, as `de` joins the hand-written languages for the admin's moving screens.

## 13. Spikes before code

| # | Question | How |
|---|---|---|
| S1 | Telling Shopware 6, Shopware 5 and not Shopware from an address | `/api/_info/version` (6), `/backend` and the HTML generator (5), on twenty real shops |
| S2 | A read-only ACL role an integration can be given, and a way for the owner to make it in one step | Shopware's ACL roles in 6.5 to 6.7 |
| S3 | Shops behind firewalls: what addresses we call from, and whether they're stable | Vercel's egress for `dub1`; otherwise a fixed-address proxy in the EU |
| S4 | One gross price everywhere, or net plus each country's VAT? | Shopware's tax and currency settings with a test order to Austria |
| S5 | GPSR plugins' custom field keys for the manufacturer's address | The five most installed GPSR extensions in the Shopware Store |
| S6 | Domain Connect at IONOS, STRATO, Hetzner, ALL-INKL and netcup | Their docs and the Domain Connect templates list |
| S7 | Reading with inheritance resolved through the Admin API | The `sw-inheritance` header against a shop with variants |
| S8 | Which Shopping Experiences blocks map to ours | Every block type in core 6.7 against our blocks |
| S9 | Listing installed plugins and apps | The `plugin` and `app` entities, and whether a read-only role reaches them |
| S10 | Reading order documents as PDFs, and how fast | The document endpoints on a shop with 20,000 orders |
| S11 | Stable paging on a large table | Keyset on `id` versus `page` under writes |
| S12 | Listing an app in the Shopware Store: review, account, cost, time | Shopware's Store guidelines |
| S13 | An end-to-end run | A Shopware 6.7 development shop (Docker) with two languages, variants, a GPSR plugin, advanced prices, a voucher promotion, double opt-in recipients of every status and 5,000 orders; then a Shopware 5.7 one |

## 14. Tests

As for Shopify (its section 15), with a stand-in Shopware (`e2e/fixtures/shopware-stub.mjs`) that answers `/api/oauth/token` and
`/api/search/{entity}` from fixtures taken from a real 6.7 shop, and fails on any write. Also:
- **Floats to minor units**, including 0.1 + 0.2 cases and three-decimal currencies.
- **Inheritance**: a variant with empty fields gets the parent's.
- **Newsletter**: each status lands as section 6.2 says, and an `optOut` is never subscribed.
- **Redirects**: an old non-canonical row points straight to the new page, in one hop, per language.
- **Tax**: a 7 % rate asks once, a rate that fits one category asks nothing.
- **Vouchers**: frozen until Move, then usable with the same code.
- **Documents**: attached, read only, never re-invoiced.
- **The DNS steps** never mention an `MX` or a nameserver.
- **The agent eval**: the hidden-instruction case.

## 15. What this does not do

- It never writes to Shopware, never deactivates a promotion there, and never deletes his integration. It tells him the one press.
- It never touches nameservers or mail records.
- It never runs plugins, Twig or Flow Builder flows.
- It never imports a struck-through price or Shopware's `regulationPrice`.
- It never subscribes anyone who didn't confirm, unless Decision 1 says so.
- It never takes over the owner's duty to keep his invoices.
