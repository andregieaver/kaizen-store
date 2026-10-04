# Tax profile and VAT engine (wave 1, unit 1a; decision D157 proposed)

The contract for unit 1a of `docs/wave-1.md`: reduced-rate VAT categories and per-country rates with history, a store's tax
profile (VAT, OSS and IOSS registration), the EU VAT number check (VIES) with reverse charge, and the IOSS marking of
consignments of at most 150 EUR. `docs/wave-1.md` section 1a is the agreed outline; this file elaborates it (law with
sources and read dates, exact data, files, tests) and must not contradict it. Where reading the code showed that the outline
needs a refinement, it is listed in section 1.4 and the lead settles it before building. Code, tests and texts follow this file,
and a disagreement is settled here first. This file is documentation only: nothing here is built yet.

**Nothing here is legal or tax advice.** Every rule that comes from a law is written with its source and the date it was read,
is marked *needs review by an accountant or lawyer*, and lives in data or one pure function, so a correction is a data change
and not a rewrite. Every consumer-facing text is hand-written in nb, sv, da and en and is never machine-translated.

Lane note: this unit is built beside the trust lane (1e and 1f, another directory). The two meet only in the shared registries
and in the SQL functions `clone_store()` and `duplicate_store()` (patched by both, section 3.7), `audit()` and `requireMember()`
(1f replaces the second by permissions: 1a calls whatever exists and the lead reconciles at the merge).

---

## 1. Purpose and scope

### 1.1 What it closes, and what each row can honestly reach

| Row | Bucket | What 1a does | Honest rating when 1a is done |
|---|---|---|---|
| `checkout.eu-vat-by-destination-vat-inclusive-prices-reduced-rates` (weight 5) | A | Criteria 1 to 4 and the audit half of 6: reduced-rate categories in the product editor, the cart, the order take the country's rate for the category; platform admins edit categories and rates with history through one function; shipping follows a per-country rule; every seeded rate has a source and a checked date; edits are audit-logged and apply to new carts only. | **partial** (gap narrowed). Criterion 5 (the VAT report as CSV in the OSS layout) and the reconciliation half of 6 are unit 1c; "the invoice takes the rate" is unit 1b. Full when 1b and 1c have shipped and their tests exist. |
| `checkout.b2b-vat-id-reverse-charge-exemption` (weight 3) | A | A business enters an EU VAT number, VIES checks it, a valid number for another member state takes the VAT off the order; the number, result and time are kept on the order; unavailable VIES never blocks and never silently exempts; the order page, emails (and the Stripe invoice option's fields) say "Reverse charge" with both numbers; never for consumers or the seller's own country. | **partial**. The criterion "the invoice says reverse charge" is satisfied by Kaizen's own invoice only in unit 1b. Full when 1b has shipped. |
| `checkout.oss-and-ioss-support` (weight 4) | B | The OSS and IOSS registrations are recorded; destination VAT as the registration requires (already the rule); consignments of at most 150 EUR from outside the EU are marked IOSS on the order. | **partial**, never Full in this run: the OSS/IOSS reports (criterion 2 and the refund half of 4) are unit 1c, the invoice marking is 1b, and the IOSS side is live only with a registration number the owner holds (bucket B). |
| `international.ioss` (weight 3) | B | Criteria 1 (number, intermediary, markets) and 2 (at most 150 EUR marked and charged destination VAT; above 150 EUR not an IOSS sale) and the "off and says why" half of 4. | **partial** (from missing). The monthly IOSS report (criterion 3) is 1c; live only with a registered number or intermediary agreement (bucket B). |

Ratings are changed by `history` entries in the rows and `pnpm parity:write`, by the lead at the end of the run from what the tests hold. The rows are not
edited in this spec.

### 1.2 What Shopify does (read on 2026-10-03)

- *Rates and exemptions.* Shopify sets rates automatically (Shopify Tax, or manual settings) and lets the merchant override the rate for
  products with special rates; Shopify does not remit or file tax (<https://help.shopify.com/en/manual/taxes/eu>, read for the tracker row on 2026-10-03).
- *OSS and IOSS.* The merchant registers the OSS credentials (EU-based, "if your annual sales to all other EU member countries are equal or
  greater than 10,000 EUR") or an IOSS number (non-EU merchants, orders of at most 150 EUR collected at checkout); the page warns that the
  EU is removing the 150 EUR customs duty exemption from 1 July 2026 (<https://help.shopify.com/en/manual/taxes/eu/eu-tax-reference>, read 2026-10-03). Shopify does not file the return.
- *VAT number and reverse charge.* Since February 2026 checkout validates a company VAT number and applies the reverse charge for EU to EU
  (destination country different from the fulfilment location's country) and EU to UK orders. It needs Shopify Tax in the EU or UK, at least one
  fulfilment location in the EU and the *Company VAT number* field set to optional; Shopify advises merchants to check suspicious numbers
  in VIES themselves and may rate-limit repeated validation attempts (<https://changelog.shopify.com/posts/vat-number-validation-available-in-checkout>, read 2026-10-03). The page does not
  say what happens when the validation service is unavailable.

Where Kaizen goes the same way: destination VAT, the registration numbers on the store, validation at checkout, reverse charge only for EU to
EU. Where it differs on purpose: Kaizen keeps the VIES answer on the order, a VIES failure never exempts and never blocks, the seller must have a
checked number, and services, subscriptions and host orders are never reverse-charged (section 4).

### 1.3 Sources read for this spec (and what was not read)

| Source | Used for | Read |
|---|---|---|
| VIES REST API specification, <https://ec.europa.eu/assets/taxud/vow-information/swagger_publicVAT.yaml> | endpoint `POST /check-vat-number`, request fields (`countryCode`, `vatNumber`, `requesterMemberStateCode`, `requesterNumber`, trader match fields) and response fields (`valid`, `requestDate`, `requestIdentifier`, `name`, `address`, match fields); statuses 200, 400, 500 | 2026-10-03 |
| Commission, One Stop Shop, <https://vat-one-stop-shop.ec.europa.eu/one-stop-shop_en> | three schemes (Union, non-Union, Import), 10,000 EUR threshold, 150 EUR limit for the import scheme, most non-EU businesses must register for IOSS through an EU intermediary, while a business established in a country with a VAT mutual assistance agreement with the EU (Norway) can register directly (the Commission page names the intermediary rule; Norway's exception is a review finding and the agreement is not read: verify), quarterly returns (Union, non-Union) and monthly (Import) | 2026-10-03 |
| Directive 2006/112/EC Art. 226 (as in <https://www.legislation.gov.uk/eudr/2006/112/article/226>, the text at the UK's exit) | invoice content: points 3 and 4 (both VAT numbers), 11 (exemption reference), 11a ("Reverse charge") | 2026-10-03 |
| Directive 2006/112/EC Art. 138 (same site, text at the UK's exit) | intra-Community supply: goods dispatched to another member state, to a taxable person identified for VAT in another member state | 2026-10-03 |
| Commission, VAT rates page, <https://taxation-customs.ec.europa.eu/vat-rates_en> | up to two reduced rates in categories of Annex III, one super-reduced and one zero rate; the Taxes in Europe Database (TEDB, <https://ec.europa.eu/taxation_customs/tedb/>) is where each state's rates are published | 2026-10-03 |
| Skatteetaten, <https://www.skatteetaten.no/en/rates/value-added-tax/> | Norway: 25 % general, 15 % food and water and wastewater, 12 % passenger transport, accommodation, public broadcasting, entry to cinemas, sporting events, amusement parks and activity centres; newspapers (including electronic ones that are mainly text) exempt from VAT, books and magazines under the VAT Act's exemption rule | 2026-10-03 |
| hellotax EU VAT table (<https://hellotax.com/blog/vat-rates-in-europe/>, dated 30 June 2026) | **secondary**, a cross-check only for the Nordic and German rows (Denmark has no reduced rate beyond 0 % newspapers; Sweden 12 %/6 %; Finland 25.5 % standard, 14 %/10 %; Germany 7 % food, books, newspapers) | 2026-10-03 |
| Secondary snippets (search results only, not the pages): Directive (EU) 2018/1910 "quick fixes" making the buyer's VIES-listed VAT number a substantive condition of the Art. 138 exemption (sovos.com, 2020); OSS corrections applying the ECB rate of the last day of the quarter the return relates to (marosavat.com); IOSS number `IM` + 10 digits, non-Union OSS `EU` + 9 digits (python-stdnum, <https://arthurdejong.org/python-stdnum/doc/stdnum.eu.oss>) | marked *verify* where they are used | 2026-10-03 |

**Not read in this run** (so every use below says *verify*): the TEDB itself (a script-driven application), Directive Art. 44, 59c, 78, 196 and
369l ff., Implementing Regulation 282/2011 (Art. 18 proof of the VAT number; the definition of *intrinsic value*), the national acts (Norway's
merverdiavgiftsloven, Sweden's mervärdesskattelag and so on), and each state's rule for the VAT on shipping. The foundation agent reads the
sources it seeds data from and writes the URL and date into the row (section 3.2); a value it cannot source is not seeded.

### 1.4 Refinements of `docs/wave-1.md` 1a found by reading the code

None changes what the unit delivers; each makes the outline buildable. The lead confirms them before the run starts.

1. **Where the VAT number is typed.** The outline says "checkout piece `checkout_company`". No such piece exists: the company name and organisation number are
   typed in the cart's `cart_checkout` piece and carried by `checkoutAction()` (`src/app/s/[store]/[market]/cart/actions.ts`). The VAT number field sits beside them there, and
   the cart summary shows the effect before checkout starts. A separate piece would be a new key in `STORE_PIECES`; not needed.
2. **How the net order is stored.** The database refuses an order whose total is not `subtotal + shipping - discount` and a line whose total is not
   `unit price * quantity - discount` (`orders_total_adds_up`, `order_lines_total_adds_up`). A reverse-charge order keeps those checks by the
   precedent of bonus credits (D130): **the VAT not charged is part of the discount** (`orders.vat_relief_minor`, included in `discount_minor`, with each line's
   share in `order_lines.vat_relief_minor`, included in the line's discount), `tax_minor` is 0 and `total_minor` is the net amount, as the outline says. `OrderView.discountMinor`
   leaves the relief out, as it leaves out credits (section 3.5).
3. **Rounding.** "One `exVat()` rule: per line, remainder to the last line" is satisfied more simply: the relief of a line is `vatIncluded(line total after every discount and credit, rate)`,
   the same function and the same inputs that give the tax today, and the shipping's relief is `vatIncluded(shipping - shipping discount, shipping rate)`. A reverse-charge order's total is therefore
   **exactly today's total minus today's tax**, in the cart and in `placeOrder()`. There is no remainder to hand out, because nothing is split. The "remainder to the last line" rule
   is needed only where a net amount is spread over lines it was not computed per line, which 1a has none of (Stripe's lines fold their discounts, section 2.1).
4. **Who qualifies** (adds to the outline's rule 2): the seller's own VAT number must have been checked valid; only goods and downloads are relieved; a basket with a booking
   (appointment, stay, rental), a subscription, or a host's listing is charged VAT in full with the reason said; IOSS marks only private buyers.
5. **Added data** beyond the outline's list: `countries.time_zone` (the date a rate takes effect is the country's own date), `store_tax_profile.dispatch_country`,
   `store_tax_profile.oss_member_state`, `store_tax_profile.ioss_registered_on`, `store_tax_profile.vat_number_check_id`, `orders.vat_kind`, `orders.vat_relief_minor`, `orders.shipping_tax_rate`,
   `orders.vat_check_id`, `order_lines.vat_relief_minor`, `carts.vat_number`, `carts.vat_check_id`, `vat_checks.cart_id`, and one more seeded category (`children_goods`, because the tracker row names children's goods).
6. **Standard rates get history too.** `commerce.vat_rate()` reads the `standard` category from `vat_rates` as well; `countries.standard_vat_rate` stays as a cache kept equal to today's row and
   as the fallback (section 3.2), and nothing but that function and the shipping rule reads it (a source-scan test holds this).

---

## 2. Behaviour

Terms: the **seller** is the store; the **buyer** is the shopper; the **market** is the delivery country (a store market is one country, D109); a **business buyer**
is a cart with a company name and organisation number (D63); a **valid check** is a VIES answer of "valid" no older than 24 hours; **relief** is the VAT a reverse-charge order does not charge.

### 2.1 Shopper side

**Prices and VAT, unchanged where nothing special applies.** Prices stay VAT-inclusive per market and charged with VAT; businesses see them without VAT where the store shows it so (D63). A product's rate is
`commerce.vat_rate(country, product's category, now)`; a missing rate row means the standard rate (never a silent different number). Cart lines, order lines, the cart summary, the checkout and the order
page show the rate each line was charged at, as today.

**Reduced rates.** An owner puts a product in a category such as *Food*, *Books*, *Periodicals*, *Medicines*, *Culture and events*, *Children's goods*; the cart, checkout and order take the destination country's rate for that
category where one is known, else the standard rate. A basket may hold several rates; the summary shows the VAT as one amount (as today), the order page lists it per rate when there is more than one.

**The VAT number field** (business buyers, only where reverse charge could apply):

- It is drawn in the cart's `cart_checkout` piece under the company fields when: the buyer is a business (company fields are shown), the market's country is in the EU, the store's tax profile says it is VAT-registered in an EU member state
  and its number was checked valid, the market is not the seller's country, and the cart has no booking and no subscription. Otherwise it is not drawn (a private buyer never sees it; a basket with a booking shows the one-line reason instead).
- The buyer types the number (with or without the country prefix, spaces and dots allowed; Greece's prefix is `EL`) and presses *Check*. A server action normalises it (`src/lib/vat-number.ts`), checks its shape, asks VIES (section 4.3) and stores the answer on the cart.
  The cart summary then shows, in the shopper's language, one of:
  - **valid, another member state than the seller's, same as the delivery country:** the VAT line reads *0 (reverse charge)*, the totals are without VAT, a note says the buyer accounts for the VAT in their own country;
  - **valid but for another country than the delivery country** ("the number is for {country}, the goods go to {market}"): VAT is charged;
  - **not valid:** "This VAT number was not accepted. VAT is charged."; the number stays typed so it can be corrected;
  - **could not be checked now:** "The VAT number could not be checked right now. VAT is charged. Try again in a moment." (never "exempt", never blocks the sale);
  - **the buyer's own country is the seller's:** nothing is offered; VAT is charged (domestic sale).
- Changing the market, the basket (a booking or a subscription is added), the company, or the 24 hours passing re-evaluates all of this on the next read: the cart summary and `placeOrder()` ask the same function.
- Checking is rate limited by what has been done, taken **before** VIES is asked and atomically (one upsert-and-count per bucket in `commerce.chat_usage`, the whole clock hour, so parallel requests cannot all pass; *review finding, built*): at most 10 live requests per cart, 20 per client (a keyed hash of the address for the day, never the address: `viesClientKey()`; skipped when there is no address or no server secret), and 60 per store for the shoppers together; a cart that already holds a valid answer and asks again (a stale one before checkout) may use a reserve of 30 more. The store owner's own *Check now* has a pool of 20 an hour of its own, so shoppers cannot use up the owner's. Repeating the same number within 24 hours is a cache hit and costs nothing. Over a limit the answer is the *could not be checked now* one and nothing is asked or logged. Honest limits: whole-hour windows allow a burst of twice a limit across the turn of an hour, and a visitor with many addresses can still spend the store's shoppers' 60 (they then see "could not be checked", VAT is charged, never a block); this bounds the harm, it does not make it impossible.

**Checkout and payment.** `startCheckout()` refreshes an expired check outside the transaction (a VIES call is never made while an order is being placed), `placeOrder()` reads the cart's check and freezes the treatment on the order. With reverse charge the order's lines carry
tax 0, the order total is the net amount, and **Stripe is sent the order's own amounts**: each line as quantity 1 at its net amount due now (title prefixed with the quantity as the part-payment path already does), no coupon (the
discounts are inside the line amounts), the shipping option at its net amount. The sum of Stripe's lines plus shipping equals `dueNowMinor`; a test holds it. A Stripe invoice (the store's `orderInvoices` option) gets custom fields *Reverse charge*, the seller's and the buyer's VAT numbers.

**Order page, emails.** The order page (`/order/{id}`, the account's order page) and the order confirmation email show, for a reverse-charge order: the line *VAT: 0*, the words **Reverse charge**, the buyer's VAT number and the seller's VAT number,
all in the order's language (hand-written nb, sv, da, en; other languages show the English words for this legal wording, section 5.3). An IOSS order shows *VAT has been collected at checkout under IOSS ({number}); no further VAT is due on delivery* (same rule). The buyer's number is shown only on the order's own page
(key or ownership) and in the shopper's own email; never on a page anyone can open.

**Import notice (not VAT collection).** A store that dispatches from outside the EU and has an EU market shows, for an order above 150 EUR (or any order when the store has no IOSS number) from the cart on, one line: *Import VAT and customs charges may be collected on delivery.* This is the outline's "the screen says so"
extended to the shopper, because Art. 6 of the Consumer Rights Directive requires extra charges to be stated; the text is flagged (section 8).

### 2.2 Staff side (store)

- **Tax settings** `/admin/{store}/settings/tax` (Settings > Selling, owners only): *Registered for VAT* (yes/no), the VAT number with **Check now** (VIES for EU numbers; Brønnøysundregistrene's open register through D124's lookup for a Norwegian number, showing "registered in the VAT register" or not), where goods are sent from
  (defaults to the company's country), OSS (none / Union scheme with the member state of identification and the registration date / non-Union scheme with its `EU` number), IOSS (number `IM` + 10 digits, the intermediary's name, the markets it applies to, the registration date). Every field has one sentence of plain help; the screen shows the warnings of section 4.1 in plain words
  (destination VAT is charged on every consumer sale; the 10,000 EUR threshold and the origin-country rule are not applied, "ask your accountant if you are not registered for OSS or in that country"; reverse charge is off until the seller's number is checked valid; IOSS above 150 EUR is not handled; a Norwegian store cannot use reverse charge).
  Saving writes `audit_log` (`store.tax_profile_updated`, field names only, never the numbers' values in the details of a failed check). A readiness list under the form says what is missing for each feature ("Reverse charge: off. Needs: a VAT number that has been checked valid.").
- **Product editor**: the *VAT category* select lists the active categories with their names and, for the product's markets, the current rate and whether it is the standard rate by fallback ("no reduced rate known here"). `accommodation` is offered only for stays and rentals; a product keeps a category that was later switched off and shows it as *inactive*.
- **Order page**: a *VAT treatment* panel: kind (standard, reverse charge, IOSS), the reason in plain words, both VAT numbers, the VIES result and time (and VIES's registered name and address beside the company the buyer typed, as a hint that never blocks anything), the relief amount, the consultation number when VIES gave one.
- **Store checkup** (`store_checkup` / setup readiness) reports: registered for VAT without a number; a number never checked valid; IOSS markets without an IOSS number; IOSS number without markets; OSS selected without its details.

### 2.3 Platform side

`/admin/platform/vat` (Settings > VAT; platform admins) holds four things, each a card on one page and `/admin/platform/vat/[country]` for one country's detail:

1. **Categories**: add a category (code, English name, description, sort, active); switch one off; the built-in `standard`, `exempt` and `accommodation` cannot be renamed, deleted or switched off. Categories are never deleted.
2. **Rates**: per country and category, the current rate, its source URL, the date it was checked, whether a person has verified it; **Set rate** (new rate, from date, source, checked on, note) calls `commerce.set_vat_rate()`; **Mark verified** records who and when. A change from a date in the future is a scheduled change shown as such. A rate is never edited in place: the old period ends, a new one begins.
3. **Unverified list**: every rate row whose `verified_at` is null, with its source, so a person can work through it with an accountant.
4. **Coverage**: category by country, each cell showing the rate or *no reduced rate known here: the standard rate (X %) applies*; countries in use by any active store come first.
5. **Shipping VAT rule** per country (`standard`, `follows_goods`, `highest`), with source and verified flag; only a verified rule other than `standard` is ever applied (section 4.2).

Every change is audit-logged (`vat.category_added`, `vat.category_active`, `vat.rate_set`, `vat.rate_verified`, `vat.shipping_rule_set`, store id null), applies to new carts and orders only, and is immediate: the cart is not cached (cart summary reads per request), the catalogue's cached `PriceView.vat` rate is refreshed by `updateTag("vat")` and the catalogue tags (section 5).

### 2.4 Emails

`email-text.ts` gets, in nb, sv, da, en (hand-written, flagged): the order confirmation's reverse-charge block (words, both numbers) and IOSS block; the refund email repeats the treatment word ("net of VAT, reverse charge") so a refund of a net order is not read as a gross one. The staff notices are unchanged. The Stripe-side receipt is the store's own business.
Nothing is emailed because of a VIES failure.

### 2.5 Edge cases and failure behaviour

| Case | What happens |
|---|---|
| VIES times out (4 s), answers 5xx or malformed JSON, or reports the member state unavailable | one retry; then status `unavailable`, VAT charged, reason `number_unavailable`, the buyer told, the order is placed normally; the failed attempt is a `vat_checks` row with its error code. No exemption, no block. |
| VIES says not valid | status `invalid`; VAT charged; reason `number_invalid`. Not retried. |
| A valid check is older than 24 h when the order is placed | treated as unknown: VAT charged, reason `number_stale`; `startCheckout()` normally re-checks first, so this appears only when VIES was down at that moment. |
| Buyer's number equals the seller's own | refused as typed ("This is the store's own VAT number"); VAT charged. |
| Buyer number's country is not an EU member state (Norway, UK, Switzerland, Northern Ireland `XI`) | not accepted for reverse charge in 1a (`number_not_eu`); VAT charged. |
| Seller's number never checked valid, or not registered | reverse charge off for the store; the field is not drawn; the profile screen says why. |
| Seller outside the EU (Norway) | reverse charge off, always; IOSS available. |
| Cart has a booking, a subscription, or a host's listing | no reverse charge; reason said; VAT in full. |
| Cart is private (no company) | no reverse charge, no IOSS exemption question; VAT as today. |
| A rate changes the day between cart and order | the order takes the rate in force at placement (`now()` in the destination country's time zone); a cart's displayed rate refreshes on its next read. |
| A category's rate row is missing for the country | standard rate; the admin coverage view says so. |
| A category is switched off | existing products keep it; the editor marks it *inactive*; new products cannot take it. |
| Currency other than the country's own (D109, `no-eur`) | relief and tax are computed on the **shown** amounts (`shown(market, minor)`), exactly as today's VAT; the stored order is in the currency shown. A euro scenario holds it (section 6). |
| Copied orders (`C-...`, D129) | never get a treatment: `copy_orders()` copies `vat_kind`, `vat_relief_minor` and `shipping_tax_rate` so the database's checks hold, never `vat_treatment`, `vat_check_id` or any VAT number. They count in no VAT figure. |
| Host orders (D71) | always `standard`, relief 0 (the seller is the host; a host without VAT registration already sells at rate 0 by trigger). |
| Subscription renewals (D25) and standing deliveries (D102) | no reverse charge (the VAT number is not kept on them). A renewal's order lines take the rate in force **at the renewal date** (`vat_rate(..., now)`), with the amount charged by Stripe unchanged (prices are VAT-inclusive, so the VAT part is recomputed); shipping takes the shipping rule. |
| Bonus credits, codes, campaigns, group discounts, welcome discount | all come off the VAT-inclusive prices as today; relief is computed last on what is left, so credits are used at their VAT-inclusive value (an open question for the reviewer, section 8). |
| Refund or return of a reverse-charge order | refunds are capped by what was paid (net); `refundFor()` uses the lines' net totals; the shipping refunded is the shipping paid net (`shippingPaidMinor()` is total minus lines, already net). A test holds that a full refund of a net order equals its total. |
| Order paid, then the owner changes the tax profile | the order keeps its frozen treatment and the seller number it was placed with (database rule, section 3.6). |
| Language other than nb, sv, da, en | the interface strings come from the catalogue as usual; the two legal statements (reverse charge, IOSS) show in English there (section 5.3). |

---

## 3. Data

All new tables live in `commerce` (private schema), have row-level security enabled with no policy (as every commerce table), are in `src/db/schema.ts`, and every foreign key has an index. Money is integer minor units plus an ISO code; rates are `numeric` fractions as today (`0.2550`).

### 3.1 Categories

`commerce.vat_categories (code text pk, name_en text not null, description text not null default '', sort int not null default 0, active boolean not null default true, built_in boolean not null default false, created_at, updated_by uuid null)`:

- code `^[a-z][a-z0-9_]{1,30}$`; name 1 to 60 characters; description at most 200.
- Seeded: `standard`, `exempt`, `accommodation` (built in, active) and the reduced-rate categories `food` (Food and drink for people), `books` (Books, including e-books where the country applies the rate), `periodicals` (Newspapers and periodicals), `medicines` (Medicines and medical aids), `culture_events` (Admission to cultural events, cinemas and attractions), `children_goods` (Children's clothing, footwear and car seats). Platform admins add more; owners only choose.
- Triggers raise on: deleting any row; changing `code` or `built_in`; switching off or renaming a built-in. (Raising triggers contain no `DELETE`.)
- `products.vat_category` stays `text not null default 'standard'` and gains a **foreign key** to `vat_categories(code)` replacing the check constraint `products_vat_category`; the three old values exist as rows, so no product is lost. Test: every existing product row keeps its category.
- `exempt` is always 0 % (as `commerce.vat_rate()` does today) and has no rate rows. `standard` has rows (3.2).

### 3.2 Rates with history

`commerce.vat_rates` is widened in place: `(country_code char(2) fk countries, category text fk vat_categories(code), rate numeric(5,4), valid_from date not null, valid_to date null, source text not null, checked_on date not null, note text not null default '', verified_by uuid null fk accounts, verified_at timestamptz null, created_at, created_by uuid null)`, primary key `(country_code, category, valid_from)`.

- The check `vat_rates_category` (only `accommodation`) is dropped; `vat_rates_rate` (0 <= rate < 1) stays; add `valid_to is null or valid_to > valid_from`; `source` 8 to 400 characters (a URL or a named act); `category <> 'exempt'`.
- **No overlaps** and append-only history, enforced by trigger (not by an exclusion constraint: `btree_gist` is not loaded by the PGlite test database): inserting a row whose period overlaps another row of the same (country, category) raises; an `UPDATE` may change only `valid_to` (from null to a date after `valid_from`, once), `verified_by`, `verified_at`, `note`; a `DELETE` raises. A mistake is corrected by ending the period and adding a new one with a note.
- **`commerce.set_vat_rate(p_country char(2), p_category text, p_rate numeric, p_valid_from date, p_source text, p_checked_on date, p_note text, p_account uuid)`** is the only writer used by the application: it closes the open period of that key at `p_valid_from` (only when `p_valid_from` is after its start), inserts the new row, and writes the `audit_log` row `vat.rate_set` in the same transaction. It refuses a `valid_from` that is not after the start of the latest period, a rate for `exempt`, and an unknown category or country. Like prices through `commerce.set_price`.
- **`commerce.vat_rate(p_country char(2), p_category text, p_at timestamptz)`** (stable, `search_path = ''`; *built: no default for `p_at`, because a default would make the two-argument call ambiguous with the old function*) is the only reader of a product's rate. The local date is `(p_at at time zone coalesce(countries.time_zone, 'UTC'))::date`. Order of precedence: category `exempt` gives 0; the row of (country, category) whose period contains that date; for any category but `standard`, the `standard` row containing the date; `countries.standard_vat_rate`; 0. The existing two-argument function stays, so every current caller keeps working and nothing is dropped. *Built: it carries its own copy of the body with `now()`, not a call to the three-argument function (a SQL function with a fixed `search_path` is not inlined and one calling another measured twenty times slower per call, which the catalogue pays per product); a PGlite test holds the two to the same answer for every country and category.*
- `countries.time_zone text` (IANA, seeded for every country in the table; a country with several uses its capital's) is new; `countries.standard_vat_rate` stays as the cache and fallback, kept equal to the `standard` row valid today by `set_vat_rate()` for the standard category and by `commerce.sync_standard_vat_rates()` (*built as a SQL function with no DELETE or DROP, which the daily cron calls; the spec said an application job*), so a future-dated change takes effect on its day.
- **Seed** (migration `..._tax_engine_rules.sql`, `source` and `checked_on` on every row, `verified_*` null everywhere, `valid_from = '2026-01-01'`, the date the seeded figures describe; Kaizen has no order before September 2026, so earlier history is not loaded):
  - `standard` for every country in `countries` (EU 27 and Norway), equal to `countries.standard_vat_rate` as of the seed (Finland 0.2550, Estonia 0.24, Romania 0.21, Slovakia 0.23 included: the existing seed already carries them), source the Commission's TEDB. *Built: the source reads "Kaizen's table of September 2026 (migration 20260924072554); to check against the Commission's TEDB" and `checked_on` is 2026-09-24, because TEDB was not read and a row must not claim a check that was not made.*
  - `accommodation`: the three rows that exist (NO 0.12, SE 0.12, DE 0.07) keep their rates, gaining source and date (Norway: Skatteetaten, read 2026-10-03, which names accommodation at 12 %).
  - The six new reduced-rate categories: **only rows the agent can source** from the TEDB or the country's tax authority at the time it builds, each with the exact URL and date read. Known from this spec's reading and to be confirmed the same way: Norway `food` 0.15, `culture_events` 0.12 (cinema, sporting events, amusement parks), `books` and `periodicals` 0.00 (exemption rule of the VAT Act: read as a zero rate, flagged), Denmark has no reduced rate (so no rows: the standard rate applies, which the coverage page shows), Germany `food`, `books`, `periodicals` 0.07, Sweden `food` 0.12 and `books`, `periodicals` 0.06, Finland `food` 0.14 and `books`, `periodicals`, `culture_events` 0.10 (all four from the secondary table, to be confirmed against TEDB before they are verified).
    A count of seeded rows per category is printed by the migration's test so a reviewer sees the coverage; a missing row is the honest answer, a guessed row is not.
    *Built (read 2026-10-03; WebFetch returned summaries of the pages, so every figure is unverified): Norway `food` 0.15 and `culture_events` 0.12 (Skatteetaten page, read), `books` and `periodicals` 0.00 (the exemption, flagged as not stated on the page); Sweden `food` 0.12 until 2026-04-01 and **0.06 from 2026-04-01** (the Skatteverket page names the cut: the spec's 0.12 was out of date), `books` and `periodicals` 0.06; Finland `food` 0.135 (not 0.14: the Vero page names 13.5 % from 1 January 2026) and `periodicals` 0.10; Germany `food`, `books`, `periodicals` 0.07 (the act's page answered 503 twice, so these rows say they come from Kaizen's earlier table). Not seeded because no source could be read or the sources disagreed: Finland `books`, `medicines`, `culture_events`; Sweden `culture_events` (museums 12 %, performing arts 6 %: one category cannot hold both); Germany `culture_events`; `medicines` and `children_goods` everywhere; Denmark has no reduced rate.*
- A test fails if a seeded row has no source, no `checked_on`, a `verified_at`, a `valid_from` after today, or a rate not between 0 and 0.30.

### 3.3 Shipping VAT rule

`commerce.shipping_vat_rules (country_code char(2) pk fk, rule text not null default 'standard' check in ('standard','follows_goods','highest'), source text not null default '', checked_on date null, verified_by uuid null, verified_at timestamptz null, note text not null default '', updated_at)`. Seeded: `standard` for every country. A function `commerce.shipping_vat_rule(p_country)` returns the rule **only when `verified_at` is not null**, else `'standard'` (so an unverified row can never change what is charged). Changes go through a platform action that audit-logs `vat.shipping_rule_set`.

### 3.4 Store tax profile

`commerce.store_tax_profile (store_id uuid pk fk stores, vat_registered boolean not null default false, vat_number text null, vat_number_check_id uuid null, vat_number_checked_at timestamptz null, vat_number_valid boolean null, dispatch_country char(2) null (*built: no foreign key, only `^[A-Z]{2}$`, because `countries` holds the EU and Norway only and a store sending from China or the UK must be able to say so*), oss_scheme text not null default 'none' check in ('none','union','non_union'), oss_member_state char(2) null fk countries, oss_number text null, oss_registered_on date null, ioss_number text null, ioss_intermediary text null, ioss_markets text[] not null default '{}', ioss_registered_on date null, updated_at, updated_by uuid null fk accounts)`.

- Checks: `vat_number` normalised form `^[A-Z]{2}[0-9A-Z+*.]{2,12}$`; `ioss_number ~ '^IM[0-9]{10}$'` (python-stdnum, *verify*); `oss_number ~ '^EU[0-9]{9}$'` when the scheme is `non_union` (*verify*); `oss_scheme = 'union'` requires `oss_member_state`; `ioss_markets` entries are two-letter codes of countries with `in_eu` each once (checked by trigger, as arrays cannot carry a foreign key); *built also: a stored check must be the seller's check of this very number with its result copied (trigger), and no check, result or time without a number (check constraint)*; the Union scheme has no number of its own (registration is under the national VAT number, *verify against the Commission's OSS guidelines*).
- The seller's VAT number's prefix must equal the store's country (`stores.country`; `EL` for `GR`): a number from another state is refused in 1a, said on the screen. A store outside the EU (Norway) may hold a Norwegian number (nine digits + `MVA`, validated by `organisationNumber()` and the register lookup) which is shown on documents and never used for reverse charge.
- `vat_number_valid` and `vat_number_checked_at` are copies of the latest seller check (`vat_checks` row `vat_number_check_id`); saving a different number clears all three.
- A row is created on first save; absence means all defaults. `COPY_RULES`: **`settings`**, note "Registration facts; a copy keeps the choices but not the numbers". `duplicate_store()` copies `vat_registered`, `oss_scheme`, `oss_member_state`, `dispatch_country`, `ioss_markets` and blanks `vat_number*`, `oss_number`, `oss_registered_on`, `ioss_number`, `ioss_intermediary`, `ioss_registered_on` (a number belongs to one legal entity; reverse charge stays off in the copy until its owner checks its own number). `clone_store()` copies nothing (the template has no registration: the row is created lazily).

### 3.5 Carts, orders, lines, and the check log

- `carts`: `vat_number text null`, `vat_check_id uuid null` (fk `(store_id, vat_check_id)` to `vat_checks`). Cleared when the company is cleared. Never copied (carts are `never`).
- `orders`: `vat_kind text not null default 'standard' check in ('standard','reverse_charge','ioss')`, `vat_relief_minor bigint not null default 0 check (>= 0)`, `shipping_tax_rate numeric(6,4) null`, `vat_treatment jsonb null`, `vat_check_id uuid null` (fk, `on delete restrict`). Checks: `vat_relief_minor between 0 and discount_minor`; `vat_kind = 'reverse_charge'` implies `tax_minor = 0 and vat_relief_minor > 0`; any other kind implies `vat_relief_minor = 0`. **`orders.shipping_tax_rate`** records the rate the shipping was charged at (today `OrderView.shippingVatRate` is re-read from the country's current rate, which is wrong after a rate change); backfilled for existing orders from `countries.standard_vat_rate` of their market (what was charged).
- `order_lines`: `vat_relief_minor bigint not null default 0` (included in `discount_minor`; check `between 0 and discount_minor`). `tax_rate` keeps the rate that **would** have applied on a reverse-charge line (so relief per rate can be reported), with `tax_minor` 0.
- `orders.vat_treatment` shape (frozen at placement): `{ kind, reason, sellerVatNumber, sellerCountry, buyerVatNumber, buyerCountry, vies: { status: 'valid'|'invalid'|'unavailable'|'not_checked', checkedAt, requestIdentifier, registeredName, registeredAddress }, iossNumber, consignmentEur, shippingRule }`. Registered name and address are VIES's, kept for staff and never shown to shoppers. Fields are null where not applicable; `sellerVatNumber` is recorded on every order of a registered store (the invoice in 1b reads it from here, never from the live profile).
- `commerce.vat_checks (id uuid pk, store_id uuid fk, purpose text check in ('buyer','seller'), cart_id uuid null, number text not null (normalised, with prefix), country_prefix text not null, status text check in ('valid','invalid','unavailable'), source text check in ('vies','brreg'), name text null, address text null, request_identifier text null, error text null, requested_at timestamptz default now())`. Indexes: `(store_id, number, requested_at desc)` for the 24-hour cache, `(store_id, cart_id, requested_at)` for the rate limit. Immutable: a trigger refuses `UPDATE`; `DELETE` only by the retention job (the foreign keys from `orders`, `carts` and the profile refuse deleting a row they use).
- A trigger on `orders` refuses changing `vat_kind`, `vat_relief_minor`, `vat_treatment`, `shipping_tax_rate` or `vat_check_id` once the status is not `pending_payment`.
- Retention (*review finding, built*): `pruneVatChecks()` first makes a cart that expired more than 30 days ago (or is converted and untouched for 30 days) let go of its `vat_number` and `vat_check_id` (nothing deletes carts, so without this the number and VIES's name and address for it would live for ever), then deletes the checks older than 30 days that no order, cart or profile points at (the foreign key would refuse otherwise); a buyer's number and VIES's answer therefore live at most 30 days past the end of their cart unless an order rests on them. Original rule: a `vat_checks` row used by no order, cart or profile is deleted after **30 days** by `pruneVatChecks()` (application code, in the five-minute cron's daily branch, never SQL); rows an order uses live as long as the order (unit 1g's retention rules). The registered name and address are personal data only for sole traders; they are in the 1g register (`PERSONAL_DATA`) when that exists.

### 3.6 What the database itself enforces

Category and rate triggers and checks above; the foreign key from products; non-overlapping rate periods; `set_vat_rate()` as the writer; unverified shipping rules ignored; order checks on relief and kind; frozen treatment after payment; immutable check log; ioss markets in the EU.
Every function sets `search_path = ''`. No function contains `DELETE`, `TRUNCATE` or `DROP`.

### 3.7 Copy, retention, privacy

| Table | `COPY_RULES` class | Note |
|---|---|---|
| `store_tax_profile` | `settings` | choices copied by `duplicate_store()`, numbers blanked; see 3.4 |
| `vat_checks` | `never` | an audit log of this store's checks |
| `vat_categories`, `vat_rates`, `shipping_vat_rules` | (no `store_id`, outside the audit) | platform reference data |

`duplicate_store()` and `clone_store()` are patched with the `pg_get_functiondef` idiom of `20261002215352_returns_rules.sql` (one statement inserted before the last `RETURN`, idempotent by a `position(...)` check, raising loudly if the anchor is not found), so this patch and the trust lane's compose in either order. `copy_orders()` is patched the same way if it lists columns explicitly (3.5, copied orders row). `COPY_RULES` entries are added in `src/lib/store-copy-rules.ts`. Privacy: a buyer's VAT number and VIES name and address are visible to the store's staff with order access, to the shopper on their own order, in their own email, in the store's own Stripe invoice fields; never in analytics exports, integration events (they carry the treatment kind and the VAT amount only), the chat agent, search, feeds, sitemap, structured data, `llms.txt`, recommendations or the AI manager's order tools. A source-scan test (`vat-readers.test.ts`, like `field-values-readers.test.ts`) lists the modules allowed to read `carts.vat_number`, `vat_checks` and `orders.vat_treatment` and fails if another does.

---

## 4. Rules and law

Every rule sits in one pure function (`src/lib/vat-treatment.ts` and its neighbours) with its source in a comment, a matrix test, and *needs review by an accountant or lawyer*.

### 4.1 Which VAT an order carries: `vatTreatment()`

Input (all plain data, no I/O): `seller { country, inEu, registered, numberValid, number, dispatchCountry, dispatchInEu }`, `buyer { kind: 'private'|'business', vat: { state: 'none'|'valid'|'invalid'|'unavailable'|'stale', number, prefixCountry } }`, `delivery { country, inEu }`, `basket { hasService, hasSubscription, hasGoodsOrDigital, hasPhysical, hostOrder, taxedAmountPositive }` (`hasGoodsOrDigital`: a line that is not a booking, what reverse charge needs; `hasPhysical`: at least one line is shipped, what IOSS, the dispatch rule and the import notice look at), `ioss { number, markets }`, `consignmentEur: number | null` (null when the currency has no rate; *built as `consignmentEurMinor`, euro cents, so the 150.00 / 150.01 boundary is integer arithmetic, rounded up so a value on the border is never taken to be inside*). Output: `{ kind: 'standard'|'reverse_charge'|'ioss', reverseCharge: boolean, reason, notes[] }` where `reason` is one code from a closed list, each with a plain sentence for staff and one for the shopper.

Rules, evaluated in this order; the first that applies decides:

1. **Host order** (`hostOrder`): `standard`, reason `host_order`. The seller is the host (D71).
2. **Private buyer.** Destination country's VAT, as today. If the store has an IOSS number, the delivery country is an EU country listed in `ioss.markets`, goods are dispatched from outside the EU, the basket has shipped goods and no booking or subscription (**a download is not a consignment: only the physical lines count for eligibility, for the consignment's value and for the import notice; a basket of downloads alone is `consumer`**), and `consignmentEur <= 150`: `ioss` (reason `ioss`); with `consignmentEur > 150`: `standard`, reason `ioss_over_limit` (the buyer may pay import VAT at the border: said to staff, and the import notice shown to the shopper); with no euro rate: `standard`, reason `ioss_no_rate`. Otherwise `standard`, reason `consumer`. *Source:* Commission OSS page (Import scheme: consignments of an intrinsic value not exceeding 150 EUR; most non-EU businesses need an intermediary, Norway-established ones can register directly: verify), read 2026-10-03; Shopify's tax reference, read 2026-10-03. The value is the shipped goods after discounts, without VAT and without separately charged shipping, in euro at the store's rate; whether that is the legal *intrinsic value* is **not read (Reg. 282/2011 and the customs code): needs review**. An order is one consignment (stated).
3. **Business buyer without a valid, current, other-country number** keeps `standard`: reason `no_buyer_vat_number`, `number_invalid`, `number_unavailable`, `number_stale`, `number_not_eu`, `number_other_country` (the number's country differs from the delivery country), `own_number` (equals the seller's), or `same_country` (the delivery country is the seller's country).
4. **Seller conditions.** The seller must be established in an EU member state (`seller.inEu`), registered (`registered` and a number), and the number checked valid (`numberValid`). Otherwise `standard`, reasons `seller_not_eu`, `seller_not_registered`, `seller_number_unverified`.
5. **Basket conditions.** Only goods and downloads can be relieved. A booking (appointment, stay, rental: their place of supply follows the property, the event or the place of performance, not the buyer) or a subscription (the VAT number is not kept for renewals) makes the whole order `standard`, reasons `has_service`, `has_subscription`.
   **5b. Where the goods are sent from** (review finding, built): when the basket has shipped goods, an intra-Community supply needs the goods to go from one member state to another (Directive 2006/112/EC Art. 138(1), read 2026-10-03). Goods sent from outside the EU (`seller.dispatchInEu` false: the owner's "goods are sent from" fact, defaulting to the store's country) are an import, and goods sent from the buyer's own country (`dispatchCountry` equals the delivery country) are a domestic sale there: both `standard`, reasons `dispatch_outside_eu` and `dispatch_domestic`, and the VAT number field is not offered. Downloads are not sent, so a basket of downloads alone does not look at it. The tax screen's reverse-charge line says it needs goods sent from an EU country. If every line's VAT would be zero (exempt goods) the order is `standard` with reason `nothing_taxable` (no "reverse charge" is written on an order that carries no VAT).
6. **Reverse charge.** Seller EU-established, registered with a valid number, goods (if any are shipped) sent from an EU country other than the delivery country; buyer a business with a valid number (checked within 24 hours) in an EU member state other than the seller's; delivery country equals the buyer's number's country; basket goods or downloads only: `reverse_charge`. The VAT is not charged; the buyer accounts for it. *Sources:* goods shipped to a business in another member state identified for VAT there are an exempt intra-Community supply (Directive 2006/112/EC Art. 138(1)), with the buyer's identification number a condition (Directive 2018/1910, secondary source, *verify*); downloads to a business buyer are supplied where the buyer is established (the general B2B rule, Art. 44 and 196, **not read**: *verify*); the invoice must carry both numbers and the words "Reverse charge" (Art. 226 points 3, 4 and 11a, read 2026-10-03). VIES confirms registration only; it does not say the goods are exempt, and the owner remains responsible (said on the tax screen).

Consequences stated once so nobody guesses: **Kaizen charges the buyer's country VAT on consumer sales** (as today; right for an OSS-registered EU seller and for IOSS; the profile screen says a store not registered for OSS or in that country should ask its accountant, and that neither the 10,000 EUR threshold nor the origin-country rule is applied: this is a risk accepted in the wave's defaults); a Norwegian store charges the destination country's VAT, never reverse charge; services never get reverse charge in 1a; Northern Ireland and the UK are not EU for this purpose. Norway's own scheme for foreign sellers (VOEC) and the EU's flat customs duty on low-value parcels (Shopify's page says from 1 July 2026) are not built.

### 4.2 Amounts, rounding, shipping VAT

- All VAT arithmetic is on the **shown** amounts in the order's currency, integer minor units, with the existing `vatIncluded(amount, rate) = round(amount * rate / (1 + rate))` (`src/lib/checkout.ts`) and `withoutVat()` (`src/lib/b2b.ts`). Nothing new rounds.
- Per line: `tax_i = vatIncluded(total_i, rate_i)` where `total_i` is after campaigns, group discount, welcome discount, code and credits. **Reverse charge:** `relief_i = tax_i`, `total_i := total_i - relief_i`, `tax_i := 0`, `discount_i += relief_i`, `vat_relief_minor_i = relief_i`. Shipping: `relief_ship = vatIncluded(shipping - shipping discount, shipping_rate)`; `orders.discount_minor += sum(relief_i) + relief_ship`; `orders.vat_relief_minor = sum(relief_i) + relief_ship`; `orders.tax_minor = 0`; `orders.total_minor = subtotal + shipping - discount_minor`. Therefore a reverse-charge total equals the ordinary total minus the ordinary tax, to the minor unit.
- **Shipping rate** (`src/lib/shipping-vat.ts`, `shippingRate(rule, goodsRates, standard)`): `standard` is the destination country's standard rate (as today, everywhere by default); `follows_goods` is the common rate when every taxable goods line has the same rate, else the standard rate; `highest` is the highest rate among the goods lines (never below zero). A rule other than `standard` is applied only for a country where a person has verified it (3.3). The rate chosen is stored as `orders.shipping_tax_rate` and used for the shipping's tax. The principle that ancillary charges such as transport follow the supply they belong to (Directive Art. 78(a) and the case law on ancillary supplies) is **from memory, not read: verify**; each state's practice differs, which is why the default is `standard` until a person verifies a country.
- **Rate in force**: the rate at placement, `now()` read in the destination country's time zone; `valid_from` is the first day of the new rate. A rate stored on an order line never changes afterwards.
- IOSS conversion to euro uses the store's own rate (`store_currencies`, units per 1 EUR, `convertMinor`); a currency with no rate gives no marking (`ioss_no_rate`), counted in the store checkup, never a guess.

### 4.3 The VIES check

- Endpoint `https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number`, `POST`, JSON body `{ countryCode, vatNumber, requesterMemberStateCode, requesterNumber }` (the last two when the store has a number that was checked valid, so the answer carries a `requestIdentifier`, the consultation number the seller can keep as proof; swagger read 2026-10-03). The **host and path are constants** in `src/lib/vies.ts`; no address or part of one ever comes from a person. Only the normalised country code (from a closed list of the 27 prefixes, Greece `EL`) and the number's characters (`[0-9A-Za-z+*.]{2,12}`) enter the body.
- `fetch` is injectable (`checkVatNumber(input, { fetch })`, default the platform's), `cache: 'no-store'`, **4 s timeout** (`AbortSignal.timeout`), one retry on timeout, network error or 5xx, none on a definite answer, response read as text up to 16 KB and parsed defensively. Any answer that is not HTTP 200 with a boolean `valid` is `unavailable` with a short error code; the response's `name` and `address` of `---` mean *not disclosed* and are stored as null. The VIES site's own error codes are not in the swagger file; they are not relied on.
- A test-only base address (`VIES_TEST_URL`) is honoured only when `VIES_ALLOW_TEST_URL=1` and `VERCEL` is unset (the `allowPrivate()` pattern of `replicate-fetch.ts`); on Vercel it is ignored, so production has exactly one host.
- 24-hour cache per store and number (`vat_checks`); live requests are rate limited (2.1). A Norwegian seller number is checked against Brønnøysundregistrene through `lookupCompany()` (`vatRegistered`), a different host with its own fixed constant.
- Shape check before any call (`normaliseVatNumber(country, input)`): strip spaces, dots, dashes, the prefix; upper-case; the per-country patterns are a table in `src/lib/vat-number.ts`, each sourced from the Commission's VIES page or python-stdnum by the agent that writes it, with the loose shape `^[0-9A-Z+*.]{2,12}$` as the fallback for a country whose pattern it could not confirm. The authority is VIES; a shape check never rejects what VIES might accept beyond obvious typos.

### 4.4 Who may do what

Owners (role `owner`) edit the store's tax profile and run *Check now*; admins and other staff may read the profile and the order's treatment. Platform admins edit categories, rates and shipping rules and verify them; a store cannot. Shoppers type a number for their own cart only (the cart's cookie). Rates and rules apply to new carts and orders; nobody can change a placed order's treatment.

---

## 5. Where things live

### 5.1 Files, by agent area

Areas do not share files except through the registries in 5.2.

**Foundation** (schema, migrations, pure libraries, database tests)
- `supabase/migrations/<ts>_tax_engine.sql` (generated by `pnpm db:generate` from `src/db/schema.ts`: the new tables, the widened `vat_rates`, the FK on `products`, new columns) and `<ts>_tax_engine_rules.sql` (custom, `pnpm exec drizzle-kit generate --custom --name tax_engine_rules`: functions, triggers, seeds, the `duplicate_store()`/`clone_store()`/`copy_orders()` patches, the plan-feature row, `countries.time_zone` seed). `src/db/schema.ts`.
- Pure: `src/lib/vat.ts` (categories become data: `BUILT_IN_VAT_CATEGORIES`, `VatCategoryRow`, rate labels), `src/lib/vat-treatment.ts` (`vatTreatment()`, reason codes and their sentences), `src/lib/vat-relief.ts` (`reliefFor()`: per-line and shipping relief, the one place the arithmetic of 4.2 lives, used by cart and order), `src/lib/shipping-vat.ts`, `src/lib/vat-number.ts`, `src/lib/vies.ts` (constants, request building, response parsing, status mapping), `src/lib/ioss.ts` (`consignmentEur()`, eligibility, number format), `src/lib/tax-profile.ts` (profile type, `profileProblems()`, `readiness()`).
- Tests: `src/lib/vat-treatment.test.ts`, `vat-relief.test.ts`, `shipping-vat.test.ts`, `vat-number.test.ts`, `vies.test.ts`, `ioss.test.ts`, `tax-profile.test.ts`, `vat.test.ts` (extended), `src/db/vat.test.ts` (PGlite).

**Server**
- `src/server/vies.ts` (the call), `vat-checks.ts` (cache, log, rate limit, `pruneVatChecks()`), `tax-profile.ts` (read, save, *Check now*, readiness), `vat-categories.ts` (cached read, `'use cache'`, tag `vat`), `vat-admin.ts` (platform: categories, `setVatRate()`, verify, shipping rules, coverage), `tax-treatment.ts` (loads the facts for a cart or an order and calls the pure function: **the one function `cartSummary()` and `placeOrder()` both use**).
- Edits: `checkout.ts` (rate at date, treatment, relief, Stripe lines, order columns, `PlacedOrder` gains `vatKind`, `vatReliefMinor`, `shippingReliefMinor`), `cart-summary.ts` (same inputs, same outputs: `vat`, `reverseCharge`, `reliefMinor`, `treatment`), `cart.ts` (`setCartVatNumber()`, `Cart.company` gains the number and the check), `orders.ts` (`OrderView.vatTreatment`, `vatKind`, `vatReliefMinor`, `shippingVatRate` from `orders.shipping_tax_rate`; `discountMinor` excludes the relief), `subscriptions.ts` (renewal rate at date, shipping rule), `standing-orders.ts` and `delivery-options.ts` (shipping rule instead of reading `standard_vat_rate`), `products.ts` (editor's rate hints through `vat_rate()`), `integrations.ts` (treatment kind only), `store-copy.ts` (nothing: SQL does it), the cron route (`pruneVatChecks()`, `syncStandardRates()`).
- Actions: `src/app/s/[store]/[market]/cart/actions.ts` (`vatNumberAction`), `src/app/admin/(gated)/[store]/settings/tax/actions.ts`, `src/app/admin/platform/vat/actions.ts`.
- Tests: `src/server/vies.test.ts` (injected fetch), `vat-engine.int.test.ts`, `tax-profile.int.test.ts`, `vat-admin.int.test.ts`, additions to `checkout-kinds.int.test.ts`, `src/lib/vat-readers.test.ts` (source scans).

**Shopper**
- `src/components/vat-number-field.tsx` (client component inside `cart_checkout`; no storage, no cookie), edits to `cart/cart-contents.tsx` (summary rows, field, notices), `checkout/checkout-section.tsx` (totals: relief row and the words), `order/[orderId]/order-section.tsx`, `account/orders/[orderId]/page.tsx`, `src/server/shopper-emails.ts` and `src/lib/email-text.ts` (confirmation and refund blocks), `src/lib/i18n.ts` (`m.vatNumber`, `m.reverseCharge`, `m.ioss`, `m.importNote`).
- Tests: `cart-contents.test.ts`, `checkout-section.test.ts`, `order-section.test.ts` (render), `shopper-emails` tests, `e2e/vat-reverse-charge.spec.ts`.

**Admin** (store and platform)
- `/admin/{store}/settings/tax` page and `src/components/admin/tax-profile-form.tsx` (`ActionForm`), the order page's treatment panel (`src/components/admin/vat-treatment-panel.tsx`, edit of `orders/[orderId]/page.tsx`), `product-editor.tsx` (the select), `src/components/admin/vat/*` (platform pages: categories, rates, unverified, coverage, shipping rules), `/admin/platform/vat/page.tsx` and `/admin/platform/vat/[country]/page.tsx`, the store checkup list.
- Tests: render tests for each screen with `renderToString`, `admin-css.test.ts` scoping unaffected (admin tokens only, no fixed colours).

**Analytics and AI**
- `src/server/analytics-sql.ts` and `analytics-totals.ts` (the shipping split reads `vat_relief_minor`: for a reverse-charge order shipping income is `shipping - shipping discount - shipping relief`, because the order's `tax_minor` is 0; revenue without VAT stays `total_minor - tax_minor`), `docs/analytics.md` (definition: VAT charged versus VAT relieved), `finance-view.tsx` label, `src/server/owner-tools.ts` + `src/lib/owner-tools.ts` (`get_tax_profile`, `tax_readiness`: read only), `src/lib/assistant-skills.ts` (a playbook "VAT and reverse charge"), the plan comparison row (D132), `store_checkup`.
- Tests: `analytics-totals.int.test.ts` (a reverse-charge order), `owner-tools` tests, the skill's test.

### 5.2 Registries to extend (one small edit each; the lead merges)

| Registry | Edit |
|---|---|
| `src/lib/store-nav.ts` | Settings > Selling: `item("/settings/tax", "Tax", "VAT registration, VAT number, OSS and IOSS, and how the store charges VAT.")` |
| `src/lib/platform-nav.ts` | `SETTINGS_ITEMS`: `item("/vat", "VAT", "VAT categories and rates per country with history, the unverified list and shipping VAT rules.")` |
| `src/lib/admin-map.ts` | `store("tax", "/settings/tax", ...)`, `platform("vat", "/vat", ...)`, `platform("vat.country", "/vat/[country]", ...)` (the walking test fails otherwise) |
| `src/lib/i18n.ts`, `src/lib/email-text.ts` | nb, sv, da, en by hand; a new English message that chooses by a number goes in `CHOOSING` with a case in `ui-catalog.test.ts`; a placeholder is `{name}` only |
| `src/lib/ui-catalog.ts` | the two legal statements are marked not-for-AI (5.3) |
| `src/lib/cookie-consent.ts` `KNOWN_COOKIES` | **no entry: 1a sets no cookie and uses no storage** (the VAT number is on the cart row); a test asserts the field component uses neither |
| `src/lib/store-copy-rules.ts` | `store_tax_profile: settings(...)`, `vat_checks: never(...)` |
| Plan features (D132) | a row in the migration: category "Selling", name "EU VAT: reduced rates, VAT number check, reverse charge and IOSS marking", *Built: listed in no plan, as the recommendations precedent (D139) does; which plans include it is the platform admin's choice.* |
| `src/lib/owner-tools.ts`, `src/server/owner-tools.ts` | `get_tax_profile`, `tax_readiness` (ungated reads; **no tool changes a VAT number, a registration or a rate**: a legal responsibility stays with a person) |
| `src/lib/assistant-skills.ts` | one playbook |
| `src/lib/store-translate.ts` | nothing: the categories' names are admin-only English; no new shopper-facing store text is owned by a store |
| Sitemap, structured data, `llms.txt`, feeds | nothing: no VAT number or treatment is ever published; JSON-LD prices are unchanged |
| `next.config.ts` | nothing (no Chromium here) |

### 5.3 Legal wording is not machine-translated

The reverse-charge and IOSS statements and the import notice are legal text. The AI catalogue (`ui-catalog.ts`) would translate every English message; so these keys are listed in a small set `HAND_WRITTEN_ONLY` there (and tested in `ui-catalog.test.ts`): nb, sv, da, en show the hand-written text, every other language shows English. If the lead prefers another mechanism for this, it is the one place to change.

---

## 6. Acceptance criteria, row by row, mapped to tests

Test names are for orientation; the agents choose exact ones. `PG` is the PGlite suite (`src/db/vat.test.ts`, no network), `INT` the integration suite against a fresh database (`pnpm test:int` after `scripts/db-setup.mjs --seed`), `E2E` Playwright on port 3000. Every money read has a euro scenario (`no-eur`, `dk-eur` style views through `shown()` / `convertedSql()`).

### 6.1 `checkout.eu-vat-by-destination-vat-inclusive-prices-reduced-rates`

| Criterion (unchanged) | Test | Closed by |
|---|---|---|
| 1. An owner puts a product in a reduced-rate category and the cart, order and invoice take that country's rate (a scenario in `checkout-kinds.int.test.ts`) | INT scenario per seeded category: the product in the cart summary, `placeOrder()` order line `tax_rate`, `tax_minor`, order `tax_minor`, in the market's own currency **and** the euro view; a mixed basket (standard + food + exempt); the editor's select saves the category (`products.int.test.ts`); `cartSummary()` equals `placeOrder()` in each. The invoice half is 1b. | 1a (cart, order); 1b (invoice) |
| 2. Platform admins edit categories and per-country rates in the admin, with history; a rate is only read through `commerce.vat_rate()` | PG: `set_vat_rate()` closes and opens periods, refuses overlap, back-dating, `exempt`; `vat_rate(country, cat, at)` before and after a change date, and across time zones (a midnight change); a rate of a missing row falls back to standard. INT (`vat-admin.int.test.ts`): the actions, audit rows, a non-platform account refused. `vat-readers.test.ts` source scan: no module outside the allowed list reads `vat_rates` or `countries.standard_vat_rate`. | 1a |
| 3. Shipping takes the rate the law requires for the goods, or the standard rate where stated | unit `shipping-vat.test.ts` matrix (each rule, uniform and mixed baskets, exempt goods); INT: a country with a verified `follows_goods` and one with an unverified rule that is ignored; the order's `shipping_tax_rate`; euro view. | 1a |
| 4. Every seeded rate carries its source and the date it was checked | PG: every row has `source`, `checked_on`, no `verified_at`; the coverage query lists the count per category. | 1a |
| 5. A VAT report per country and rate, exported as CSV in an OSS return's layout; refunds and credit notes reduce it | none in 1a: **unit 1c** | 1c |
| 6. The report agrees with Σ `tax_minor`, leaves out copied and host orders; edits to categories and rates are audit-logged and apply to new carts and orders only | audit half: INT (rate edit writes `vat.rate_set`; an order placed before the edit keeps its rate; the next cart takes the new one). Reconciliation half: **unit 1c**. | 1a (audit); 1c (report) |

Also: the check constraint replaced by the foreign key without losing old products (PG, with a pre-existing `accommodation` and `exempt` product); category triggers (PG); `vat_rate()` two-argument wrapper still works (PG); a renewal's rate at date (INT, `subscriptions.int.test.ts`).
**Rating reached by 1a: partial.** Full when 1b and 1c have shipped with their tests.

### 6.2 `checkout.b2b-vat-id-reverse-charge-exemption`

| Criterion | Test | Closed by |
|---|---|---|
| A business enters an EU VAT number; it is checked against VIES; a valid one for another member state takes the VAT off the order | `vat-treatment.test.ts` full matrix (every reason code); INT scenarios with an injected fetch: valid (SE seller, DE buyer, DE market, goods) and a downloads-only cart; `cartSummary()` equals `placeOrder()`; the order's lines `tax_minor` 0, `total_minor` = old total - old tax to the minor unit, `vat_relief_minor`, the check constraints; the euro view with a DK market (`dk-eur`) and a CZ one; Stripe's lines (fake client) sum to `dueNowMinor`; with a code, a campaign, a group discount, bonus credits and a welcome discount. | 1a |
| The number, the result and its time are kept on the order; unavailable VIES never blocks the sale and never silently exempts | INT: injected fetch that times out, answers 500, malformed JSON, `valid:false`, returns after a slow answer; each ends in a placed order with VAT charged, reason code and `vat_checks` row; a stale check (24 h + 1 min, with an injected clock); `vies.test.ts`: one retry, timeout, no retry on a definite answer, `---` stored as null, the test URL ignored when `VERCEL` is set, only the constant host is ever requested. | 1a |
| The invoice and order email say "reverse charge" with both numbers | order page and email render tests (nb, sv, da, en) hold the words and both numbers; Stripe invoice custom fields (fake client); **Kaizen's own invoice: unit 1b** | 1a (page, email); 1b (invoice) |
| Exemption never applies to consumers or to the seller's own country | matrix and INT: private buyer with a number typed (ignored), `same_country`, `own_number`, non-EU seller (Norwegian store), seller number unchecked, a basket with a booking, a subscription, a host's listing, a number of another country than the market, a non-EU buyer number; each charges VAT with its reason. | 1a |

Also: no VAT number appears in anything public (`vat-readers.test.ts`: allowed readers listed; render tests of public routes contain no number; integration payload test); VIES unavailable at the shopper's *Check* (injected) shows the "could not be checked" message; rate limit (11th live request per cart per hour answers `unavailable`, cache hits do not count); the VAT field is not drawn for a private buyer, a booking basket, the seller's own market. **E2E** (`e2e/vat-reverse-charge.spec.ts`): in a test store (seller SE, registered, number checked valid by the stub) a business adds goods in the DE market, enters a number, the stub VIES (a local server named by `VIES_TEST_URL`, `VIES_ALLOW_TEST_URL=1`, started by the spec's global setup) says valid, the cart shows *Reverse charge* and the net total; the stub then answers 503 and the same flow charges VAT and still reaches the payment form.
**Rating reached by 1a: partial** (the Kaizen invoice is 1b); Full after 1b.

### 6.3 `checkout.oss-and-ioss-support` and `international.ioss` (bucket B)

| Criterion | Test | Closed by |
|---|---|---|
| (oss 1, ioss 1) An owner records an OSS or IOSS registration, the intermediary and the markets; checkout uses destination VAT as the registration requires | `tax-profile.test.ts` (formats, markets only EU, Union needs a member state, the number prefix equals the store's country), `tax-profile.int.test.ts` (save, audit entry without numbers' values, owners only, copy rule: `duplicate_store()` blanks numbers and keeps choices, `clone_store()` creates none); render test of the screen; the readiness list. | 1a |
| (oss 3, ioss 2) A consignment of at most 150 EUR from outside the EU is charged destination VAT at checkout and the order records the IOSS number; above 150 EUR it is not an IOSS sale | `ioss.test.ts` and matrix: exactly 150.00 EUR marked, 150.01 not; a NOK market converted at the store's rate, a currency with no rate (`ioss_no_rate`); a business buyer not marked; an EU-dispatching seller not marked; a market not in `ioss_markets` not marked; INT: price unchanged against the same cart without an IOSS number, order `vat_kind = 'ioss'`, `vat_treatment.iossNumber`, order page and email words; euro view. Invoice marking: **1b**. | 1a (order); 1b (invoice) |
| (ioss 4) Live only with a registered number or intermediary agreement; until then off and says why | INT and render: no number means no marking and the screen's readiness line says "IOSS: off. Needs an IOSS number and the markets it applies to."; with a number and no markets, the same. | 1a |
| (oss 2, ioss 3, oss 4) Quarterly and monthly reports as CSV; a refund reduces the period's VAT | **unit 1c** | 1c |

**Rating reached by 1a: partial for both, never Full in this run** (reports 1c; the invoice 1b; live only with a number the owner holds, bucket B).

### 6.4 Cross-cutting tests

`checkout-kinds.int.test.ts` gets a new `describe` ("VAT categories and treatments, D157") using the file's existing helpers and the euro view; `src/lib/store-copy-rules.test.ts` (the two entries); `admin-map` and nav tests (new pages registered); `ui-catalog.test.ts` (the legal keys); `parity.test.ts` after the lead re-rates; `pnpm db:check`; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:int`, `pnpm build`, `pnpm test:e2e`.

### 6.5 Criteria changes proposed (no row is edited)

1. `checkout.eu-vat-...`: criteria 5 and the reconciliation half of 6 are reports, which `docs/wave-1.md` assigns to 1c, and "invoice" in criterion 1 is 1b. They are untestable in 1a. Proposal: keep the text; add to the row's `gap` that 1a leaves them to 1c and 1b, and move the row's closing to **1c**; the table in `docs/wave-1.md` ("Rows closed") should say "1a, 1b, 1c" for it.
2. `checkout.b2b-vat-id-...`: "the invoice says reverse charge" is satisfied by Kaizen's invoice only in 1b; the row closes with 1b. Same for the "marked IOSS on the order and invoice" half of `checkout.oss-and-ioss-support` criterion 3.
3. `international.ioss` criterion 2: "charged destination VAT at checkout" is already true of every consumer sale; the new part is the marking. The wording is kept; the test checks both.
4. `wave-1.md` 1a acceptance "no VAT number appears in anything public" is read as: **a buyer's number and VIES answer** never; the **seller's** number is public by design on documents and, from 1e, on the imprint, because the E-Commerce Directive requires a trader to state it (Art. 5(1)(g), **from memory, verify**) and 1a adds it to no JSON-LD, feed, sitemap or `llms.txt`.

---

## 7. What is deliberately not done, and who takes it

| Not done | Why | Taken by |
|---|---|---|
| Invoices, credit notes, the invoice's reverse-charge and IOSS wording | unit 1b builds Kaizen's own series; 1a only freezes the facts on the order for it (`vat_treatment`, `shipping_tax_rate`, `vat_relief_minor`) | wave 1, unit 1b |
| VAT, OSS and IOSS reports and CSV, EC Sales List data of reverse-charge sales (buyer country and net amount are on the order) | unit 1c | wave 1, unit 1c |
| Unit price | unit 1d | wave 1, unit 1d |
| Reverse charge for services: bookings (appointments, stays, rentals), subscriptions' renewals, standing deliveries | place-of-supply rules differ by kind of service and the VAT number is not kept on renewals; the order is charged VAT in full with the reason said | later tax wave, with the accountant's guidance |
| Reverse charge when the seller is outside the EU or Norwegian VAT (MVA) special cases, Norway's VOEC for foreign sellers into Norway | out of the outline's rule 2; needs Norwegian law reading | later |
| Applying the 10,000 EUR distance-sales threshold and origin-country VAT for small EU sellers | the wave's default: destination VAT everywhere, warned on the screen | later, if a store needs it |
| Pricing for IOSS above 150 EUR (no VAT at checkout, import VAT at the border) and the EU's flat customs duty on low-value parcels | outline: "not changed in this wave"; the import notice and the order's reason say so | later |
| Stripe Tax, tax by postal code or region inside a country, US-style tax | Kaizen's model is a rate per country and category | not planned |
| VAT number of a buyer kept on a customer account or company (D108) for reuse at checkout | the number lives on the cart and the order only | later |
| A buyer's VAT number for subscriptions and for standing deliveries | see the services row | later |
| Qualified confirmation in writing from a tax authority (Reg. 282/2011) | VIES's consultation number is kept; written confirmation is a person's act | company work (bucket D) |
| Any AI tool that changes a VAT number, a registration, a category rate or the profile | legal responsibility stays with a person | not planned |
| Per-country VAT number checksum validation | VIES is the authority; the pre-check only catches typos | not planned |
| Seeding rates no source confirms | the standard rate applies and the coverage page shows the gap | the platform admin, with an accountant (bucket D for verification) |

## 8. Needs human legal review

Consumer-facing and legal-adjacent texts this unit adds, each hand-written in nb, sv, da and en, unreviewed, marked in code with a comment `// legal: needs review`:

1. The **Reverse charge** statement on the cart, checkout, order page and order confirmation, with both VAT numbers (the exact words an invoice needs are 1b's; here they are the shopper-facing wording).
2. The VAT number field's label, help, and the four outcome sentences (accepted, other country, not valid, could not be checked).
3. The **IOSS** statements: the one for a paid order, and the neutral one an unpaid order shows instead (*This order falls under IOSS (number). The VAT is collected when the order has been paid.*, nb, sv, da, en, `iossPending` in `vat-text.ts`). The IOSS statement on the order page and email ("VAT has been collected at checkout under IOSS ...; no further VAT is due on delivery"): a promise about what happens at the border, which depends on the intermediary actually declaring the consignment.
4. The **import notice** (customs charges may be collected on delivery) and its conditions.
5. The refund email's "net of VAT" wording.
6. Admin screens' warnings (English only, for an accountant's eyes): destination VAT everywhere, the threshold and origin-country rules not applied, reverse charge conditions, IOSS above 150 EUR, VIES confirming registration only, the shipping-VAT rule.
7. The **seeded rates and rules** themselves (data, not text): every rate starts unverified; a person with an accountant verifies them in `/admin/platform/vat` before they are relied on. Until then the screen lists them as unverified and the products page says nothing different to shoppers.
8. Open questions for the reviewer: whether relief on a credit-used order should refund credit at its VAT-inclusive value (the choice here); the definition of intrinsic value for the 150 EUR test; the treatment of downloads sold to a business in another state; the rule for VAT on shipping of mixed baskets; whether goods dispatched from a store's own country but stocked abroad need a per-location dispatch country (1a uses one profile value).

## 9. For the lead

### 9.1 Migrations expected

Two files after the foundation agent runs `pnpm db:generate` and `drizzle-kit generate --custom`: `<ts>_tax_engine.sql` (DDL: `vat_categories`, `vat_rates` widening with its primary key replaced, `shipping_vat_rules`, `store_tax_profile`, `vat_checks`, new columns on `countries`, `carts`, `orders`, `order_lines`, the foreign key on `products`; drops of the constraints `vat_rates_category`, `products_vat_category` and the old `vat_rates` primary key) and `<ts>_tax_engine_rules.sql` (functions `set_vat_rate`, `vat_rate` (3 args) with its 2-arg wrapper, `shipping_vat_rule`, the triggers, RLS enable, the seeds, the `pg_get_functiondef` patches of `clone_store`, `duplicate_store` and, if needed, `copy_orders`, the plan-feature row). Apply to production (`ybsozesfuxuitoacntfo`) after the tests pass, record both versions in `docs/decisions.md` (Migration versions).
`clone_store()` and `duplicate_store()` are patched by this unit and by the trust lane: apply the lanes' migrations in the order merged; each patch is idempotent and fails loudly if its anchor line moved.

### 9.2 Statements the Supabase migration tool may cancel (the owner runs them in the SQL editor if so)

The design contains **no `DELETE`, `TRUNCATE` or `DROP` inside a function**: pruning (`pruneVatChecks()`) and the daily `syncStandardRates()` are application code; the category, rate and check triggers only `RAISE`. The migration does contain top-level `ALTER TABLE ... DROP CONSTRAINT` statements (the old `vat_rates_category` check, the old primary key of `vat_rates`, `products_vat_category`) and a backfill `UPDATE` of `orders.shipping_tax_rate`; if the tool cancels any of these, list it for the owner, with the exact statement, and do not report the wave shipped until it has run. The `EXECUTE v_new` in the `DO` blocks of the function patches follows the existing, applied precedent.

### 9.3 Advisors to check after applying

Security: RLS enabled on the four new tables (no policies, as the others); `search_path` set on every new function; no new exposed view. Performance: an index for every new foreign key (`vat_checks`: `store_id`, `(store_id, number, requested_at)`, `(store_id, cart_id, requested_at)`; `orders.vat_check_id`; `carts.vat_check_id`; `store_tax_profile.updated_by`; `vat_rates.verified_by`, `created_by`; `vat_categories.updated_by`), and the primary-key change on `vat_rates` not leaving a duplicate index.

### 9.4 Decision row (draft)

| D157 | **A tax profile and a VAT engine with history, reduced-rate categories, EU VAT number check and reverse charge, and IOSS marking.** `commerce.vat_categories` (built in `standard`, `exempt`, `accommodation`; seeded `food`, `books`, `periodicals`, `medicines`, `culture_events`, `children_goods`, more added by platform admins) and `commerce.vat_rates` with `valid_from`/`valid_to`, `source`, `checked_on` and a verified flag (written only by `commerce.set_vat_rate()`, never edited in place, no overlaps); `commerce.vat_rate(country, category, at)` is the only reader of a product's rate (a missing row means the standard rate, said on `/admin/platform/vat`); shipping takes the standard rate unless a person has verified a `shipping_vat_rules` entry. A store's `store_tax_profile` holds its VAT, OSS and IOSS registration (numbers never copied). A business shopper's VAT number is checked against VIES (`src/server/vies.ts`: fixed host, injectable fetch, 4 s, one retry, kept in `vat_checks`, 24 h cache); `vatTreatment()` (`src/lib/vat-treatment.ts`) decides `standard`, `reverse_charge` or `ioss` from facts, and `cartSummary()` and `placeOrder()` both use it through `tax-treatment.ts`. Reverse charge only for an EU-established, registered, checked seller; a valid buyer number for another member state that is the delivery country; goods and downloads only; never for consumers, a host's order, a booking or a subscription; an unavailable VIES charges VAT and never blocks. The VAT not charged is part of the order's discount (`orders.vat_relief_minor`), so the totals still add up and the total is the ordinary total minus the ordinary tax. IOSS marks private buyers' goods consignments of at most 150 EUR dispatched from outside the EU to a listed EU market with an IOSS number; prices do not change. Rows `checkout.eu-vat-...`, `checkout.b2b-vat-id-...` partial until 1b and 1c; `checkout.oss-and-ioss-support` and `international.ioss` partial (bucket B). Seeded rates are unverified; every rule and text needs an accountant's and a lawyer's review. (`docs/wave-1a-tax.md`) |

### 9.5 CLAUDE.md bullet (draft)

- VAT and the tax profile (D157, `docs/wave-1a-tax.md`): a product's rate is only `commerce.vat_rate(country, category, at)` (`vat_rates` has history and is written only by `set_vat_rate()`; a missing row is the standard rate; never read `countries.standard_vat_rate` or `vat_rates` elsewhere, `vat-readers.test.ts` holds it), categories are `commerce.vat_categories` (platform admins at `/admin/platform/vat`), shipping takes the standard rate unless a verified `shipping_vat_rules` entry says otherwise (`src/lib/shipping-vat.ts`). A store's registration is `store_tax_profile` (`/admin/{store}/settings/tax`, owners; numbers never copied). Which VAT an order carries is only `vatTreatment()` (`src/lib/vat-treatment.ts`: `standard`, `reverse_charge`, `ioss`, each with a reason code), loaded by `tax-treatment.ts` for both `cartSummary()` and `placeOrder()`, which must agree (`checkout-kinds.int.test.ts`, euro view). Reverse charge needs an EU-established, registered seller with a number checked valid, a business buyer with a valid VIES number (`src/server/vies.ts`: constant host, injectable fetch, 4 s, one retry, kept in `vat_checks`; never called while an order is placed; failure never blocks and never exempts) for another member state that is the delivery country, goods or downloads only; the VAT not charged is `orders.vat_relief_minor`, inside `discount_minor` (`OrderView.discountMinor` excludes it), and `placeOrder()` sends Stripe the net lines. A buyer's VAT number and VIES answer are on the cart, the order and the shopper's own pages and email only. Copied and host orders carry no treatment. A new place that adds up VAT reads `orders.shipping_tax_rate` and `vat_relief_minor`, never recomputes a rate.

### 9.6 Merge notes

Shared files this unit edits and the other lane may too: `src/lib/i18n.ts`, `src/lib/email-text.ts`, `src/lib/store-nav.ts`, `src/lib/platform-nav.ts`, `src/lib/admin-map.ts`, `src/lib/store-copy-rules.ts`, `src/db/schema.ts`, `docs/decisions.md`, `CLAUDE.md`, the migrations directory (timestamps differ), `src/server/auth.ts` consumers. Edit each registry with one small block at a known anchor so a textual merge applies. Decision numbers: this spec proposes **D157** (D156 is the wave spec); the trust lane takes the next ones; the lead renumbers at the merge.

---

## 10. As built: the server (unit 1a, server step)

What the server step built, where it differs from sections 3 to 5 (this section wins where they disagree), and what it left to later steps.

### 10.1 Modules

| Module | What it is |
|---|---|
| `src/server/vies.ts` | `checkVatNumber(number, requester, { fetch, timeoutMs, endpoint })`: one `POST` to the constant address (`viesAddress()`: the test URL only with `VIES_ALLOW_TEST_URL=1` and never on Vercel), body of country code and number only, 4 s, one retry after a timeout, a network error or a 5xx, at most 16 KB read; never throws, anything not definite is `unavailable`. |
| `src/server/vat-checks.ts` | The log, the 24 h cache and the rate limit: `checkCartVatNumber(shop, cartId, typed, deps)` (normalise with the delivery country's prefix, the store's own number and a non-EU number are kept without asking, a definite answer under 24 h old is reused, 10 live requests per cart and 60 per store per hour, over the limit nothing is asked or logged and the answer is `unavailable`), `refreshStaleCartCheck()` (called by `startCheckout()` outside the order's transaction; never throws), `checkSellerNumber()` (VIES, or the open register for a Norwegian number), `recordCheck()`, `getCheck()`, `setCartVat()`, `stateOfCheck()`, `pruneVatChecks()` (30 days, only rows nothing points at). |
| `src/server/tax-profile.ts` | `getTaxProfile()`, `storeCountry()`, `taxProfileView()` (profile, country, `readiness()` lines, latest check), `saveTaxProfile(membership, form)` (owners only, `parseTaxProfile()`, saving another number clears its check in the same statement, audit `store.tax_profile_updated` with field names), `checkOwnVatNumber(membership, deps)` (owners only, audit `store.tax_number_checked` with status and source), `taxCheckupFindings()` (in `store_checkup`). |
| `src/server/tax-treatment.ts` | The one function both `cartSummary()` and `placeOrder()` reach: `loadTaxFacts(runner, { storeId, market, cartId })` and the pure `decideTax(facts, basket)` (`vatTreatment()` + `reliefFor()` + the shipping rule + IOSS), `vatFieldFor()`, `cartTaxOf()`. |
| `src/server/vat-categories.ts` | `listVatCategories()`, `ratesNow()` (every country's rate per category and whether it is a row of its own). **Not cached** (deviation from 5.1: nothing on the shopper's side reads it; the catalogue's cached prices are refreshed through `CATALOG_TAG`). |
| `src/server/vat-admin.ts` | Platform admins only: `addVatCategory`, `setVatCategoryActive`, `setVatRate` (percentage in, `commerce.set_vat_rate()`), `verifyVatRate`, `listVatRates`, `unverifiedRates`, `vatCoverage`, `setShippingVatRule`, `listShippingVatRules`, `syncStandardRates()` (daily). |
| Actions | `src/app/s/[store]/[market]/cart/actions.ts` `vatNumberAction(store, market, typed, company?)`; `src/app/admin/(gated)/[store]/settings/tax/actions.ts` `saveTaxProfileAction`, `checkVatNumberAction`; `src/app/admin/(gated)/platform/vat/actions.ts` (five actions). Thin: every rule is in the server modules. |

### 10.2 Order of the calculation (the same in the cart and in `placeOrder()`)

Campaigns, group discount, welcome discount, code, credits (all as before) → each line's total with VAT → `decideTax()` → with reverse charge each line's relief is `vatIncluded(total, rate)` (so the total is the ordinary total minus the ordinary VAT) and is added to the line's discount, the shipping's relief to the order's discount → `order.discount_minor` = all of it, `vat_relief_minor` = lines' and shipping's relief. Gifts (a campaign's free products) are left out of the decision and the shipping rule's goods. Credits are used at their VAT-inclusive value (the spec's open question stays open); what an order earns is counted on the lines' net totals, as the database counts it (`cartSummary()` agrees).

- `PlacedOrder` gains `vatKind`, `vatReliefMinor`, `shippingReliefMinor`, `treatment`; `taxMinor` is 0 for reverse charge. `orders.vat_check_id` is the cart's check (business buyers only); `orders.vat_treatment` is null for a host's order.
- `cartSummary()` gains `tax` (`CartTax`: `kind`, `reason`, `reverseCharge`, `notes`, `importNotice`, `reliefMinor`, `shippingRate`, the buyer's typed number and its state, the seller's number, `field`: whether the VAT number field is offered or why not), `reliefMinor`, `reliefLine(i)`. `total` is net of the relief; `discountMinor` leaves it out, as it leaves out credits.
- A VAT number typed after an order was placed changes `orders.vat_check_id` against the cart's, so `getOpenCheckout().changed` is true and checkout starts again. Checkout re-asks a stale or unavailable check first, so a shopper may pay less than a stale cart page said; never more.
- A number with no stored check is read as: a non-EU prefix or the store's own number: state `valid` (so the decision reaches `number_not_eu` or `own_number`: nothing was asked); anything else (over the rate limit): `unavailable`.
- Stripe, reverse charge: net lines at quantity 1 at their amount due, no coupon, shipping net (`shipping - shipping discount - shipping relief`); sums to `dueNowMinor` (held by a test). The Stripe invoice option's four custom fields are the words ("Reverse charge"/nb/sv/da, hand-written, `// legal: needs review`), both numbers, and the company's name; IOSS orders add an `IOSS` field.

### 10.3 What else reads the new columns

`OrderView` (`orders.ts`): `vatKind`, `vatReliefMinor`, `shippingReliefMinor`, `vat` (what a **shopper** may see: reason, both numbers, the IOSS number, the VIES verdict and time, never VIES's name or address), lines' `vatReliefMinor`; `shippingVatRate` is `orders.shipping_tax_rate` (the country's rate on the day it was placed for an order without one); `discountMinor` leaves the relief out. Staff read the whole treatment with `getOrderTreatment(storeId, orderId)`. Integrations' order payload adds `vat_kind` and `vat_relief` and counts the relief in `discount`; the AI manager's `get_order` adds `vat_treatment` (kind and relief only). Analytics (`analytics-totals.ts`, `analytics-products-data.ts`, `analytics-discounts-data.ts`, `discounts.ts`) take `vat_relief_minor` out of every discount figure and subtract the shipping's relief from shipping income, and read the shipping's VAT rate from the order (`docs/analytics.md`). Subscription renewals take each line's rate on the renewal date and the shipping rule's rate (`orders.shipping_tax_rate` set). The product editor's context (`EditorContext`) has `vatCategories` and, per market, `vatRates` for every category and `vatRows` (a row of its own, else the standard rate by fallback); `saveProduct()` refuses an unknown category and a switched-off one the product does not already have.

Emails: `src/lib/email-text.ts` has the VAT wording apart from `text` (so the AI catalogue never sees it): `vatEmailText()`, `orderVatReliefRows()`, `orderVatParagraph()`, `refundVatNote()`; the order confirmation shows the relief row before the total and the statement with both numbers (reverse charge) or the IOSS statement; the refund email says the refund is without VAT. nb, sv, da, en by hand, every other language English; `// legal: needs review`.

AI manager (read only): `get_tax_profile`, `tax_readiness`; `store_checkup` reports the profile's findings.

### 10.4 Left to the surface step

The VAT number field (`vatNumberAction` is ready), the cart/checkout/order/account pages' rows and words (`i18n.ts`: `m.vatNumber`, `m.reverseCharge`, `m.ioss`, `m.importNote`, with `HAND_WRITTEN_ONLY` for the legal ones), the tax settings page and its form, the order page's treatment panel, the platform VAT pages, the product editor's category select, the registries (`store-nav`, `platform-nav`, `admin-map`), the plan comparison text if wanted, the assistant skill. `refreshTag`-style helpers: `vat-admin.ts` refreshes `CATALOG_TAG` only.

**Known red until the admin surface lands:** the two action files sit in the folders of pages that do not exist yet (`src/app/admin/(gated)/[store]/settings/tax/` and `src/app/admin/(gated)/platform/vat/`), so `src/lib/store-nav.test.ts` ("settings/tax is in a sidebar") and `src/lib/platform-nav.test.ts` ("vat is in 0 sections") fail until the admin surface adds the nav items, the `ADMIN_PAGES` entries and the `page.tsx` files (5.2). Both are expected and say exactly what is missing; nothing else in `pnpm test` fails.

---

## 11. As built: the admin surface (unit 1a, admin step)

What the admin step built, where it differs from sections 2.2, 2.3 and 5, and what it did not do.

| Piece | Where |
|---|---|
| Tax settings page (owners edit, staff read) | `src/app/admin/(gated)/[store]/settings/tax/page.tsx` and `loading.tsx`; `src/components/admin/tax-profile-form.tsx` (`TaxProfileForm`, `OwnNumberCheckCard`, `ReadinessList`, `TaxWarnings`). Settings > Selling in `store-nav.ts`; `ADMIN_PAGES` id `tax` (owner only). The *Check now* button is its own form: it checks the number as saved. |
| Order page | `VatTreatmentPanel` and `VatReliefRow` (`src/components/admin/vat-treatment-panel.tsx`) in `orders/[orderId]/page.tsx`: kind, reason, both numbers, VIES result and time, VIES's name and address beside the company the buyer typed (a hint, nothing is blocked), consultation number, relief, IOSS number, consignment value, shipping rule and rate. The totals get a *VAT not charged (reverse charge)* row before Total, because the relief is inside the order's discount. |
| Product editor | `VatCategoryField` (`src/components/admin/vat-category-field.tsx`) replaces the three radios with a select of `categoriesFor()`, with the rate per market or *no reduced rate known here: the standard rate (X) applies*. `LegalSection` passes `context.vatCategories`. |
| Platform VAT | `/admin/platform/vat` (cards: not verified yet, coverage, set a rate, categories, VAT on shipping) and `/admin/platform/vat/[country]` (today, full rate history, set a rate, the country's shipping rule), `src/components/admin/vat/*`. `SETTINGS_ITEMS` in `platform-nav.ts`; `ADMIN_PAGES` ids `vat` and `vat.country`. |
| Attention | `src/server/tax-attention.ts` (`taxAttention(storeIds)`, one query) feeds `StoreFigures.tax`; `attentionFor()` shows an owner (never staff) *the tax settings need a look* with `checkupFindings()`'s words. Not urgent. |
| AI manager | the playbook `vat-and-reverse-charge` in `assistant-skills.ts` (it names the read-only tools `tax_readiness` and `get_tax_profile` and the pages `tax` and `order`). |

Deviations: the per-country *Shipping VAT rule* is a form plus a table of the countries that have a rule of their own, not a select on every row; only a platform admin can set it, and a rule saved without the verified tick is shown as a draft that is not applied. Platform VAT pages are not cached (they call `connection()` like the other platform pages). No new cookie or storage item; nothing is added to the store translation worklist (the admin is English only). The two pages list their warnings in English for an accountant's eyes (`TAX_WARNINGS`, the platform page's intro, the shipping rule's help): they are in section 8.6 and need review.

Not done: a render test of the two `page.tsx` files themselves (the views are tested with `renderToString`; the pages are thin), and no e2e of the admin screens (needs a signed-in session; the walking tests `store-nav`, `platform-nav` and `admin-map` hold their registration).

## 12. As built: the shopper surface (unit 1a, shopper step)

What the shopper step built, where it differs from sections 2.1, 5.1 and 5.3 (this section wins where they disagree).

### 12.1 What a shopper sees

| Place | What | Files |
|---|---|---|
| Cart, the slide-out cart and the cart's `CartCheckout` piece | The **VAT number field** under the company's fields (label, one sentence of help, a *Check number* button, the answer in a live region). It is drawn for a shopper who buys as a business when `cartSummary().tax.fieldIfBusiness` says the cart could take the VAT off (an EU market that is not the seller's country, a seller registered with a number checked valid, goods and downloads only). A cart with a booking or a subscription shows one line saying why not instead. A private buyer never sees it. | `src/components/vat-number-field.tsx` (presentational), `src/components/checkout-button.tsx` (the state and the action), `cart-contents.tsx` |
| Cart summary | With reverse charge: a business sees amounts without VAT and the VAT row reads *VAT (reverse charge)* with 0; a shopper who sees prices with VAT gets one row *VAT not charged (reverse charge) -X* before the total, and "incl. VAT" is not said. Under the totals: the statement and both VAT numbers. The import notice for goods from outside the EU. Business shipping is shown without VAT at `tax.shippingRate` (the shipping rule's), not the standard rate. | `cart-contents.tsx`, `src/components/vat-notes.tsx` |
| Checkout | The VAT row says reverse charge, the statement and both numbers sit under the totals; with more than one rate each rate is a row; the import notice when the order was above the IOSS limit. IOSS is *not* said here: "has been collected" is only true once paid. | `checkout/checkout-section.tsx` |
| Order page and My account's order | The relief row before the total, the VAT row (reverse-charge words, or one row per rate when there is more than one rate), the reverse-charge statement with both numbers, or the IOSS statement with the store's IOSS number, or the import notice. | `order/[orderId]/order-section.tsx`, `account/orders/[orderId]/page.tsx`, `src/components/order-vat.tsx` |
| Emails | Built by the server step (`vatEmailText()` and friends); not touched. | |

The check: pressing *Check number* (or Enter in the field, which never starts the checkout) calls `vatNumberAction()`, which keeps the company typed beside it and asks the server; the page refreshes and the sentence under the field is what the server worked out for the number on the cart (`vatNumberMessage()`, by the decision's reason). **Pressing pay with a number typed and not checked checks it first**, so a number is never left out by mistake; VIES being down is not a problem there (VAT is charged and the sale goes on), only a number that cannot be asked about (too short, no country, characters) stops it, with the sentence saying so and how to go on (clear the field). The number lives in the cart row: the component sets no cookie and uses no storage (a source-scan test holds it), so `KNOWN_COOKIES` has no entry.

### 12.2 Deviations from sections 2.1, 5.1, 5.3

1. **The wording is `src/lib/vat-text.ts`, not `i18n.ts`.** The server step already put the order's VAT statements apart from the AI catalogue (`vatEmailText()` in `email-text.ts`); the shopper pages use the same module for the statements (reverse charge, both numbers' labels, IOSS, import notice, the relief row) and add what only the pages need (the field's label and help, the outcome sentences, the problems, the two basket lines, "of which VAT 25 %", the VAT row for reverse charge). nb, sv, da and en are by hand; every other language shows English. Because nothing of it is in `i18n.ts`, `ui-catalog.ts` needs no `HAND_WRITTEN_ONLY` set and `ui-catalog.test.ts` has nothing to add: the AI catalogue cannot see it. Every string is flagged `// legal: needs review` through the module's header (section 8 lists it).
2. **One additive server edit:** `tax-treatment.ts` gets `vatFieldFor(facts, basket, asBusiness = facts.business)` and `CartTax.fieldIfBusiness`, because the first time a business sees the cart it has no company on it yet (so `field` says `private`) and the cart must still decide whether to draw the field. `field` is unchanged. `orders.ts` adds `taxMinor` to an order's lines (`order_lines.tax_minor`) for the per-rate rows.
3. **VAT per rate on the order page** is `src/lib/order-vat.ts`: the lines' own `tax_minor` grouped by rate, the rest of the order's VAT being the shipping's at `shippingVatRate`; nothing is recomputed, so the rows add up to the order's VAT. Listed only when there is more than one rate; a reverse-charge order lists none. The import notice on the order and checkout pages is read from the reason (`ioss_over_limit`, `ioss_no_rate`), so a store with no IOSS number and goods from outside the EU shows the notice on the cart only (the order does not keep that fact).
4. **The e2e does not press Checkout** (section 12.4).

### 12.3 Tests

`src/lib/vat-text.test.ts` (every string in nb, sv, da, en; same keys everywhere; English fallback; each outcome sentence says VAT is charged and never "exempt" unless reverse charge applies; every action outcome has a text or is not a problem), `src/lib/order-vat.test.ts`, `src/components/vat-number-field.test.ts` (labelled input, live region and alert, Enter does not submit, no cookie or storage in the four components, the notes), additions to `cart-contents.test.ts` (reverse charge for a business and for a shopper who sees VAT, nb and da words, the field's offer in every case and each outcome's sentence), `checkout-section.test.ts` and `order-section.test.ts` (reverse charge with both numbers in nb, sv, da, en; IOSS; the import notice; VAT per rate). Fixtures of the three existing section tests gained the new `OrderView`/`cartSummary()` fields.

### 12.4 The end-to-end test

`e2e/vat-reverse-charge.spec.ts` with a stand-in VIES (`e2e/fixtures/vies-stub.mjs`, started by `playwright.config.ts` as a second web server on port 3911, and the app started with `VIES_TEST_URL` and `VIES_ALLOW_TEST_URL=1`): a Swedish store (registered, number checked valid, payments on through a live account so no Stripe keys are needed) sells to a Danish business: valid takes the VAT off the cart in Danish with both numbers; an invalid answer charges it again; 503 charges VAT, says it could not be checked, and leaves the *Til kassen* button enabled; the field is absent in the seller's own country; a mistyped number is told, not sent; Enter checks and does not leave the cart. **It stops before pressing Checkout:** a test database has no Stripe, so "reaches the payment form" is held by `vat-engine.int.test.ts` (VIES failing, the order placed, Stripe's lines at `dueNowMinor`) and not by a browser. A server already running without the stub's address (`reuseExistingServer`) would ask the real VIES: restart it.

---

## 13. Review fixes (unit 1a, fix step)

Findings of the adversarial review, each fixed at its cause (the working tree is not committed; the lead applies and checks). Where the spec above said otherwise it has been changed in the same edit (4.1, 2.1, 3.5, 1.3).

| Finding | Fix | Tests |
|---|---|---|
| IOSS marking, the 150 EUR consignment value and the import notice counted downloads | `TaxLine.physical` (the line's delivery is `physical`), `basket.hasPhysical`; IOSS eligibility, the consignment's value and the import notice use shipped lines only; a basket of downloads alone is `consumer` | `vat-treatment.test.ts` (IOSS: downloads, mixed), `tax-treatment.test.ts` (download-only, mixed value 100 EUR, import notice), `vat-engine.int.test.ts` (mixed in DE, download-only, mixed in euro), `vat-money-review.int.test.ts` |
| Reverse charge ignored where the goods are sent from | reasons `dispatch_outside_eu` and `dispatch_domestic` (rule 5b); `vatFieldFor()` does not offer the field; the tax screen's reverse-charge line needs goods sent from an EU country; downloads alone are not asked | `vat-treatment.test.ts` (where the goods are sent from), `tax-treatment.test.ts`, `tax-profile.test.ts`, `vat-engine.int.test.ts` (outside the EU, buyer's own country, third member state, downloads alone) |
| The IOSS statement said *VAT has been collected* on unpaid and cancelled orders | `OrderVatNotes` says it only when the order is paid, fulfilled or closed; a pending order shows the neutral `iossPending` line; a cancelled order none | `order-section.test.ts` (pending, cancelled, fulfilled, closed) |
| Admin help said a non-EU store needs an intermediary | reworded: most non-EU stores must register through an EU intermediary, stores established in Norway can register directly (still *verify*: the agreement is not read); spec 1.3, `src/lib/ioss.ts` | `tax-profile-form.test.ts` (existing render) |
| VIES rate limit not atomic | a slot is taken before VIES is asked: one atomic upsert-and-count per bucket (`commerce.chat_usage`); no schema change | `vat-security.int.test.ts` (40 parallel on one cart: 10 calls; 80 parallel over 8 carts: 60 calls) |
| One visitor could use the store's whole budget and switch reverse charge off | per-client limit (keyed hash of the address for the day), the owner's checks in a pool of their own, a reserve for a cart refreshing a valid answer, the refused cost the store nothing | `vat-security.int.test.ts` (client limit, another client unaffected, owner pool, reserve, key without the address) |
| A buyer's number and VIES's name and address were never forgotten | `pruneVatChecks()` lets expired and converted carts go of the number and the check after 30 days, then deletes the old checks, and one check still pointed at no longer stops the others | `vat-security.int.test.ts` (retention) |
| Cached catalogue kept the old rate after a scheduled change | the daily job (`syncStandardRates()`) also refreshes the catalogue when a rate of any category began or ended in the last two days | `vat-admin.int.test.ts` |

Not fully fixed, said plainly: (1) the cached label can still show the old rate between the country's midnight and the next run of the job (the cron is daily) for up to the cache's lifetime; (2) VIES's registered name and address of a buyer are still stored on the check row (the order needs them at placement, and the row is immutable), now for at most 30 days past the end of the cart instead of for ever; (3) the VIES limit bounds the harm of a visitor with many addresses, it does not remove it.
