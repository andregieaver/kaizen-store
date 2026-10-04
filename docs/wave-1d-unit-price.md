# Unit price indication: price per kilogram, litre, metre (wave 1, unit 1d; decision D160 proposed)

The contract for unit 1d of `docs/wave-1.md`: a variant can say what is in it (its total measure), every place that shows its price shows the price per kilogram,
litre, metre, square metre or piece beside it, worked out in code from the price **as that place shows it**, kept on the order line when sold, and put in the
product's structured data. `docs/wave-1.md` section 1d is the agreed outline; this file elaborates it (law with sources and read dates, exact arithmetic, data,
files, acceptance mapped to tests) and does not contradict it. Where reading the code or the sources showed the outline or the row's criteria need a
refinement, section 1.4 and section 6.5 say exactly what and why, and the lead settles it before the run starts. Code, tests and texts follow this file, and a
disagreement is settled here first. **This file is documentation only: nothing here is built yet.**

**Nothing here is legal or tax advice.** Every rule that comes from a law is written with its source and the date it was read, is marked *needs review by a
lawyer*, and lives in one pure function or one data table, so a correction is a data change and not a rewrite. Every shopper-facing word is hand-written in nb, sv,
da and en; the statutory terms (*enhetspris*, *jämförpris*, *enhedspris*, *Grundpreis*) are not left to a machine (section 8).

Lane note: this is the money lane's last unit. Units 1a (VAT engine, D157), 1b (invoices, D159) and the trust lane (D158) are in the tree and are the model:
`vatTreatment()`, `decideTax()`, `orders.vat_kind`/`vat_relief_minor`, the order lines' amounts, `order_invoices`. Unit 1d reads none of the VAT engine's
decisions and changes none of the money paths: a unit price is **display and a snapshot**, never an input to what is charged (section 2.8).

---

## 1. Purpose and scope

### 1.1 The row this unit closes, and what it can honestly reach

| Row | Weight | Bucket | What 1d does | Honest rating when 1d is done |
|---|---|---|---|---|
| `international.unit-price-indication` | 4 | A | All five criteria (with the two refinements of 6.5): a variant carries a total measure, a unit and a reference quantity; the product page, listing cards, cart, checkout (the pending order), order page and order emails, the chat's cards and the product's JSON-LD carry the price per measure, computed in code from the price as shown (VAT treatment as shown, converted per market like the price); a reduced price shows the unit price of the price charged; a product the owner says is sold by measure, or that sits in a category the owner marked, cannot be sold without a measure; a euro-view scenario in `checkout-kinds.int.test.ts` holds that the unit price shown equals the one computed from the charged price. | **full** by the criteria and the tests of section 6. Not bucket B, C or D, and no owner decision from `docs/parity-plan.md` section 5 is needed. The country table of section 4.3 (where a 100 g or 100 ml reference is allowed) and the choice that discounts do not change the indication (4.5) are law-shaped and unreviewed: the lead may hold the row at **partial** under `docs/parity/WAVES.md` step 4 until a person has read section 4 and the words of section 8. The default (1 kg, 1 l) is safe in every market, so nothing wrong is shown until an owner chooses otherwise. |

Ratings are changed by `history` entries in the row and `pnpm parity:write`, by the lead at the end of the run from what the tests hold. The row is not edited in this
spec; at re-rating its `evidence.files` and `evidence.tests` become the files of section 5 and the tests of section 6.

### 1.2 What Shopify does (read on 2026-10-04)

- Source: <https://help.shopify.com/manual/products/details/product-pricing/unit-pricing> (the row's page, read again 2026-10-04). A merchant enters, per product or variant,
  a **total amount** (the product's whole measurement with a unit) and an optional **base measure** (the unit the price is compared in; a default follows from the total).
  The unit price appears automatically on **product pages, collection pages, the cart, checkout and order confirmation notifications** (Online Store 2.0 themes need no
  change; vintage themes need a manual edit).
- Limits the page states: units such as tonnes (t), centigrams (cg) and stones (st) are not offered; the units available follow the store's default unit system and must be
  compatible (a measure and a base measure of different kinds cannot be mixed); each product or variant has one unit price; unit pricing is optional for every product;
  **"Unit pricing displays the same unit type across all markets"** (a product cannot be $1.50/12ft in one market and €1.30/4yd in another); and "displaying the price per
  unit is a legal requirement in some regions. You need to determine whether your business is subject to this requirement."
- What the page does not say (so it is not claimed): rounding, how a reduced price or a discount code is treated, whether a business buyer's net price changes it, any
  structured data, and any check that refuses a sale for lack of a measure. Shopify leaves all of that to the merchant and the theme.

Where Kaizen goes further, on purpose: the measure is refused-when-missing for products the owner says need it (a product flag and a category flag), the arithmetic is one
pure function on integers that cannot disagree between surfaces, the measure is **snapshotted onto the order line** so an order and its email keep the unit price they were
sold with, the VAT treatment shown (including a business buyer's price without VAT) is followed, and the product's JSON-LD carries the measure. Where it stops short: no
bulk-weight "loose goods", no dosage or drained-weight units, no unit price on invoices, no sort or filter by unit price (section 7).

### 1.3 Sources read for this spec (and what was not read)

| Source | Used for | Read |
|---|---|---|
| Directive 98/6/EC (Price Indication Directive), Articles 1, 2, 3 and 5 as at <https://www.legislation.gov.uk/eudr/1998/6/article/1>, `/2`, `/3`, `/5` (the UK site's copy of the text; **the consolidated EU text on EUR-Lex would not load**, so the wording is the pre-Omnibus text and each article below was read through a page summary) | Art. 1: the purpose is to state "the selling price and the price per unit of measurement of products offered by traders to consumers". Art. 2: **selling price** = "the final price for a unit of the product, or a given quantity of the product, including VAT and all other taxes"; **unit price** = "the final price, including VAT and all other taxes, for one kilogramme, one litre, one metre, one square metre or one cubic metre of the product or a different single unit of quantity which is widely and customarily used in the Member State concerned in the marketing of specific products"; **products sold in bulk** = "not pre-packaged and measured in the presence of the consumer". Art. 3(1): the selling price and the unit price are indicated for all products of Art. 1, **the unit price need not be indicated if it is identical to the selling price**; 3(2): states may waive it for services, auctions and works of art and antiques; 3(3): bulk goods show only the unit price; 3(4): an **advertisement** that states a selling price also states the unit price. Art. 5: states may waive the unit price where it "would not be useful because of the products' nature or purpose or would be liable to create confusion", and may list non-food products where it still applies | 2026-10-04 |
| Directive 98/6/EC Art. 4 (legibility, place), Art. 6a (announced price reductions, the prior price of 30 days, inserted by Directive (EU) 2019/2161) and the Commission's notice 2021/C 526/02 on Art. 6a | whether the announced reduction needs a prior **unit** price and how an advertised reduction treats the unit price | **not read** (EUR-Lex would not load; only a search summary of 6a was seen: "the prior price applied by the trader for a determined period... the lowest price during not less than 30 days"). Section 4.5 rests on this and is flagged |
| Germany, Preisangabenverordnung 2022: § 4 (the unit price, "Grundpreis") and § 5 (the unit) at <https://lxgesetze.de/pangv/4> and `/5` (a mirror; gesetze-im-internet.de returned 503 twice) and § 11 (price reductions) at `/11` | § 4(1): offering goods by weight, volume, length or area to consumers requires the total price and the unit price, which may be left out when identical to the total price; § 4(2) loose goods: unit price only; § 4(3): exceptions (nominal weight or volume **under 10 g or 10 ml**, mixed products, services, vending machines, tobacco under 25 g, some cosmetics); **§ 5(1): "1 Kilogramm, 1 Liter, 1 Kubikmeter, 1 Meter oder 1 Quadratmeter"**, with 100 g and 100 ml only for **loose goods** (§ 5(2)); the older allowance for goods of up to 250 g or 250 ml is gone (a search snippet quoting the 2022 reform: "wird ersatzlos gestrichen"); § 5(4): the unit price of goods with a drained weight refers to the drained weight; § 11: the 30-day rule for announced price reductions, § 11(3) extending it to those who need to state only the unit price (loose goods). The § 9 text was seen only as a summary | 2026-10-04 (mirror and summaries) |
| Sweden, Konsumentverkets föreskrifter KOVFS 2012:1 on price information at <https://lagen.nu/kovfs/2012:1> (summary of the page), and Prisinformationslag (2004:347) (search results only) | 6 §: the unit price is stated in kronor per kilogram or tonne, per litre or cubic metre, and for rolls per metre, for surfaces per square metre (and per piece); 7 §: a multi-pack consumed singly states the unit price in the unit of the single item; **4 §: the unit price is rounded to two decimals** (the krona's own minor unit); **8 §: no unit price for packages of 50 g or less or 50 ml or less**, nor where the selling price equals the unit price. The page has **no** rule on reduced prices. **6 § read verbatim (re-read in the 1d fix step): the comparison price on goods uses kr/kg or kr/ton, kr/l or kr/m³, kr/m or kr/km, kr/m², kr/st or kr/100 st, kr/dos. Per 100 g and per 100 ml are not on the list** | 2026-10-04 |
| Norway, Forskrift om prisopplysninger mv. for varer og tjenester (FOR-2012-11-14-1066) at <https://lovdata.no/dokument/SF/forskrift/2012-11-14-1066> | § 4 defines the unit price (enhetspris) per litre or cubic metre, per kilogram, per metre or per square metre; § 7 allows only per piece, per 100 m of paper rolls and per standard wash. "100 gram" does not appear (read by the reviewers on 2026-10-04; not read again in the fix step) | 2026-10-04 |
| Denmark, the bekendtgørelse on price and unit price for consumer goods (BEK nr 1696 of 14 December 2017, the page titled "oplysning om salgspris og enhedspris for forbrugsvarer") | that Denmark has an equivalent rule and that the authority may exempt goods where a unit price "would not be useful or could create confusion" (search summary) | **not read** (the retsinformation PDF could not be decoded, lovguiden.dk gave 429) |
| Google Search Central, merchant listing structured data, <https://developers.google.com/search/docs/appearance/structured-data/merchant-listing> | the only structured-data form for a unit price: an `Offer`'s `priceSpecification` of type `UnitPriceSpecification` with `price`, `priceCurrency` and a **`referenceQuantity`** (a `QuantitativeValue` with `value` and `unitCode`, the pack's total) whose **`valueReference`** (a `QuantitativeValue`) is the base measure; the page's example is `price 200.00 EUR`, `referenceQuantity 200 ML`, `valueReference 100 ML`; unit codes "either the UN/CEFACT codes or their human-readable equivalents" | 2026-10-04 |
| schema.org `UnitPriceSpecification`, <https://schema.org/UnitPriceSpecification> | its properties (`referenceQuantity`, `unitCode`, `unitText`, `priceType`, `price`, `priceCurrency`, `valueAddedTaxIncluded`); **`unitPricingMeasure` and `unitPricingBaseMeasure` do not occur there** (they are attribute names of Google Merchant Center's product feed, which the row's criterion copied) | 2026-10-04 |
| UN/CEFACT Recommendation 20 unit codes (GRM, KGM, MLT, CLT, LTR, CMT, MTR, MTK, C62) and Google Merchant Center's list of units for `unit_pricing_measure` | the codes of 4.4 | **not read** (from memory; the Google page above says UN/CEFACT codes are accepted; *verify the list*) |
| The national acts for NO, DK and every member state other than Germany, and the statutes behind KOVFS | everything outside the sources above | **not read**; the country table of 4.3 says so per country |

The foundation agent re-reads the primary sources it can reach when it freezes `src/lib/unit-price-rules.ts`, writes the URL and date into each rule's comment, and does
not rely on a summary for a statutory phrase. A value it cannot source is not asserted: it is a visible `needs review` flag on its row.

### 1.4 Refinements of `docs/wave-1.md` 1d found by reading the code and the sources

1. **A "unit price" is already a word in the code.** `order_lines.unit_price_minor`, `CartLine.unitPriceMinor`, `OrderView.lines[].unitPriceMinor`, the invoices' `unitPrice`
   label and `work_invoice_lines.unit_price_minor` all mean the price **per item**. The new thing is the price **per measure**. In code the new field is always `unit` (on
   `PriceView`, cart and order lines: `{ measure, base }`) or `perMeasure` in a name, the stored columns are `measure_*`, the function stays `unitPrice()` in
   `src/lib/unit-price.ts` as `docs/wave-1.md` says, and the shopper's label is "Unit price" / "Enhetspris". Nobody renames the existing fields.
2. **The reference is not `measure / reference`.** The outline says "reference quantity (default 1 kg...; 100 g or 100 ml where the rule allows for small quantities)". The
   sources read say the opposite of a free choice for Germany (1 kg or 1 l only for packaged goods) and (the review's reading of the Norwegian and Swedish rules, 4.3) allow no 100 g or 100 ml in Norway or Sweden either; Denmark's text was not read. So the owner
   picks a *preferred* base per variant (`measure_base`, `kg` by default, or `100g`), and a **per-market rule** (`smallBaseAllowed(country)`, 4.3) decides whether it is
   used: where it is not allowed or not known, the market shows the large base. Today no country is allowed, so every market shows kg and l; the choice stays in the data for the day a source allows it, and the editor offers it only while one of the store's markets may show it. The same variant shows the same measure everywhere (Shopify's "same unit type across all
   markets" is kept for the unit *family*); only 100 g and 100 ml fall back to kg and l, per market.
3. **The product flag and the category mark are two things.** The outline has a product flag `sold_by_measure`; the row's criterion 4 says "a category the owner marked as
   requiring it", while the outline's editor note says the category hint is "a nudge, not a rule". Both are built and both are rules, because the row's text wins: a product
   is *required* when it has `sold_by_measure` or sits in (or under) a product category marked `requires_unit_price`. What stays a nudge is the **default**: nothing is
   required until the owner says so, and the editor suggests it for goods whose VAT category is `food` (D157 data, not a list of words in code).
4. **A measure is only for goods.** Not for appointments, stays, rentals (their price is per night, day or hour: `booking.count`, D70) and not for digital variants.
5. **The 30-day reference and the unit price do not meet.** `PriceView.referenceMinor` (`prior_30d_minor`, the Omnibus rule) is shown as "Lowest price in the last 30 days: X". The
   unit price is computed from `amountMinor` only and has no struck-through or "was" form (section 4.5). The row's wording "the 30-day reference is not misused for it" is
   made testable in 6.5.
6. **JSON-LD uses `priceSpecification`, not `unitPricingMeasure`.** See 1.3: those two names are not schema.org. Section 4.4 gives the form, 6.5 the criteria change.
7. **The cart and checkout have no copy of the measure to read.** The cart is read live (`getCart()`), so it takes the variant's current measure; the pending order, the order
   page, the email and the subscription page read the **order line**, so the measure must be copied onto it when the order is placed (3.2), or a later edit of the variant would
   rewrite what an old order says.

---

## 2. Behaviour

Written so a tester can follow it. The running example: *Kaffe, 250 g, 49,90 kr* (4990 minor, NOK, 25 % VAT in Norway), with base `kg`.

### 2.1 Shopper side

**Product page.** Under the price (and its VAT label, and the "Lowest price in the last 30 days" line when there is one) a muted line: **"199,60 kr/kg"** (nb), "199,60 kr/kg" (sv, with the
label *Jämförpris*), "199,60 kr/kg" (da, *Enhedspris*), "NOK 199.60/kg" (en). The visible text is the amount, a slash and the base's short label; a screen reader gets "Unit price:
199,60 kr per kg" (the label as visually hidden text and the words from `m.unitPrice`). Rules, in order:

1. The variant has no measure: no line. A product without any measured variant looks exactly as it does today.
2. The chosen variant decides, as the price does: choosing another variant (dropdown, `VariantChoice`) swaps its price and its unit price together. The headline price (the
   `price` product part) is the cheapest variant's, as today (`headlinePrice()`), and shows that same variant's unit price. A product sold **only by subscription** shows the
   subscriber's price and the unit price of *that* price; choosing a purchase option (`PlanPrice`, client side) recomputes the unit price from the reduced amount with the
   same pure function (it runs in the browser).
3. The VAT display decides the amount, as it does for the price: a consumer store shows the price with VAT, so the unit price is from the price with VAT; a business-only store
   shows both without VAT, so the unit price is from the price without VAT (`withoutVat()` first, then the unit price: 4.1); a store selling to both draws both inside
   `for-private` / `for-business` spans exactly as `VatAmount` does. The unit price carries the same "incl. VAT" / "excl. VAT" label as the price, once, on the price line, not
   again on the unit line.
4. **Omitted when it equals the price** (Directive Art. 3(1)): a variant whose measure equals its base quantity (1 kg with base kg, 1000 g with base kg, 100 g with base 100 g, one
   piece) shows no unit line. JSON-LD and the editor still carry the measure.
5. **Omitted when it cannot be stated truthfully**: the price is 0 (a gift line; free), the result rounds to less than one minor unit, or the result is beyond the safe integer
   range. Never shown as 0,00.
6. A reduced price (a lower `set_price` than 30 days ago) shows the unit price of the current price. Nothing is struck through for a unit price.
7. A campaign or notice (D114, "20 % off") does not change the line: the campaign takes the amount off in the cart and the page already says "the price above is the list price"
   (`MemberNotice`, D108). The same holds for a group discount, a code, the welcome discount (D131), credits (D130) and reverse-charge relief (D157): see 4.5.

**Listing cards, search results, wishlist, recommendations, the front page's product grid.** Every one of them draws a `ProductSummary` through `ProductCard` and `<Price>`; the card
shows the unit price of **the variant whose price the card shows**: the cheapest active variant in the market, ties broken by SKU (the same variant `getProduct()` lists first).
The card says "from X" when variants differ in price; the unit line carries no "from", because it belongs to the one offer named by the price above it. (A card never shows the
lowest unit price of a different variant than the price it sits under.)

**Phone's bottom bar (`ProductBar`).** Not changed: it repeats the chosen variant's amount beside Add to cart, and the full price block with its unit line is on the same page above it
(a deliberate choice, section 7).

**Cart and the slide-out cart (D64).** Under each goods line's title and options: "199,60 kr/kg", computed from **one unit's price as the cart shows it** (`line.unitPriceMinor`,
the list price per unit after a subscription option's reduction, in the currency shown; for a business buyer netted with the same `net()` the line uses), with the variant's current
measure. It does not depend on the quantity: 2 × 250 g shows the same unit price as 1 × 250 g. A subscription line in a free trial (the line's price today is 0) shows the unit price
of the plan's price, as the "after the trial" figure beside it does. Gift lines, bookings and fee lines show none. A line that is `unavailable` shows none.

**Checkout** (the page shows the pending order placed by `placeOrder()`): each line shows the unit price from the order line's own `unit_price_minor` and its **snapshot measure**, in the
same form, with the same VAT treatment as the line's amount on that page (`net()` for business buyers there).

**Order page, order emails (confirmation, shipped, refund), My account's order and the subscription page.** Each goods line shows "{qty} × {title}" and, muted beside or under it, the
unit price from the order line's snapshot (the amount the line shows, which on the order page and in emails is the amount with VAT as charged). A line of an order placed before this unit
shipped, or of a variant that had no measure, shows nothing. The subscription page and the standing-order (weekly delivery, D102) lists read the latest order line or the variant: the
subscription page shows the unit price of what one delivery costs; the weekly list shows the current variant's measure with the current price.

**Chat agent (D81).** A product card the widget draws carries the same unit line (computed in code as above, never by the model); the tool result the model sees may include the same
sentence as a fact; the model states no unit price of its own and `cleanReply()` is unchanged.

**What a shopper never sees**: the owner's category mark, the `sold_by_measure` flag, a measure for a service, a unit price in a currency other than the one shown.

### 2.2 Staff side (store)

**Product editor** (`/admin/{store}/products/{id}`, `ProductEditor`, one client component): in each goods variant's "Barcode, cost, weight and customs" details, a new group **Content**
(`Total content` amount, `Unit`, `Compare per`):

- amount: a decimal with up to four decimals ("0,75", "250", "1.5"), unit: one of `g, kg, ml, cl, l, cm, m, m²` and `piece`; for several items in one pack, a helper "Pack of N × amount"
  multiplies into the total (UI only; nothing about the pack is stored, the measure is the pack's total);
- *Compare per*: the unit family's default (`1 kg`, `1 l`, `1 m`, `1 m²`, `1 piece`), and for a mass or a volume also `100 g` or `100 ml`. Beside the choice, a note: *"A packaged product is compared per
  kg or l in every market: the rules of Germany, Norway and Sweden allow no other base for it, and no other country's rule has been checked."* (from the country table, 4.3). The choice of 100 g or 100 ml is offered only
  while one of the store's markets may show it (none today), or when it is already chosen (then labelled as not shown in the owner's markets);
- a **live preview** under the fields: *"Unit price in Norway (NOK): 199,60 kr/kg"* from the variant's typed price in the first market (and in each market when the details are open), using
  the same `unitPrice()` the shop uses; or *"Not shown: the unit price is the same as the price."* or *"Not shown: no price yet."*;
- hidden (and refused if sent) for digital variants and for products of kind appointment, stay or rental; a product that was goods with a measure and is changed to another kind loses its
  measures on save, with a notice.

At product level, in the compliance section, a checkbox **"Sold by measure: every variant needs its content"** (`sold_by_measure`); and a nudge, shown only while no measure is set and
the product's VAT category is `food` (or the product sits in a marked category: it then says which): *"Food is usually sold with a price per kg or litre. Add the content of each variant."*
It is a nudge only (the product saves and sells), until the owner ticks the box or marks a category.

**Refusals** (saving a product as `active`, or any save of an active product, with a required measure missing on an active physical goods variant): the save is refused and nothing is
written, with a sentence per variant in the admin's English: *"Add the content of Kaffe 250 g (SKU KAFFE-250): this product needs a price per kg or litre because it is sold by measure"* or *"... because
its category Food is marked as needing one."* A **draft** may be saved incomplete. The database refuses the same states if something goes round the application (3.3).

**Categories** (`/admin/{store}/products/categories`, `TermsManager`): on a product **category** (not a tag, not a page or article category) a checkbox *"Products in this category need a price
per kg or litre"* (`requires_unit_price`); it applies to the category's products and, as the layout rule does, to those of its subcategories. Marking it changes nothing in the shop at once; the
screen then says *"N active products in this category have no content yet"* with a link to the products page's filter. Unmarking changes nothing for products that already have measures.

**Products page** (`/admin/{store}/products`): when any active product is required and has no measure, a notice at the top with the count and a filter *"Needs content"* (`?needs=unit-price`)
listing them with the reason (flag or category), each linking to its editor. A required product that is already active and lacks a measure is **grandfathered**: it stays on sale and the shop
shows no unit line for it, and it is refused the next time it is saved. Nothing is hidden or deactivated by the system.

**AI manager (D94).** A read-only owner tool `unit_price_gaps` ("which products need a measure and have none, and which variants have a measure with the unit price now shown in each market") and a
longer answer from `get_product` (each variant's measure and the computed unit price per market, from `unitPrice()`, the model adds no arithmetic). The manager does not set measures (no gated
write tool: a measure changes what the law says the page must show, and the editor's refusals are the guard). The AI product writer (D76) is not given or asked for a measure.

**Staff order pages** are not changed: the staff view of an order keeps its lines as they are (section 7).

### 2.3 Platform side

Nothing visible to Kaizen's platform admin: no platform page, no platform setting. The plan comparison (D132, `/admin/platform/plans/features`) gets one row, *"Unit price (price per kg, litre, metre)"*,
in the `Selling` category, in no plan yet (the platform's admin ticks the plans that include it), added by the rules migration like the VAT row of D157 (category `Checkout and selling`, where the earlier wave-1 migration moved the VAT row; this file first said `Selling`). The country table of 4.3 is code, not a platform
setting (section 7 says what would make it data).

### 2.4 Emails

The order confirmation, the shipped and the refund emails that list the order's lines (`orderLines()` in `src/server/shopper-emails.ts`) put the unit price after the line's label in the same row
(`"2 × Kaffe 250 g · 199,60 kr/kg"`), from the order line's snapshot and the email's own `money()` (the amount with VAT as charged, in the order's currency and language: D109). No new email text key
is needed: the label is `m.unitPrice` from `t(lang)`, which `orderLines()` already receives. Gift lines and lines without a snapshot add nothing. The email's `lines` block does not otherwise change, so the
VAT, discount and total rows (D157, D130, D131) are untouched. Subscription renewal emails read the renewal order's lines, which carry the copied snapshot (3.2).

### 2.5 Edge cases

| Case | Result |
|---|---|
| A product has several variants, some measured, some not | Each variant shows its own; the unmeasured ones show no line. The card follows the cheapest variant. |
| Variants of the same product with different measures (250 g, 500 g) | Each has its unit price; the product page updates on choosing. |
| Measure `piece` (a 12-pack of eggs) | "6,50 kr/piece" (nb "stk.", sv "st", da "stk.", en "piece"); base is always one piece. |
| Measure `cl` or `cm` | Normalised to `l` or `m` by the arithmetic (4.1); the product page also says the content as typed ("33 cl") in the editor only, not in the shop (the product's own title and description say it). |
| Measure equal to the base quantity | No unit line (Art. 3(1)); JSON-LD still has the measure. |
| Price in the market is missing | No price, no unit price, nothing else changes. |
| `from` listing: min-priced variant has no measure but another has | The card shows no unit line. |
| A business buyer in a store selling to both | The unit price follows the buyer's VAT display (3 in 2.1); the cart's `net()` and the product page's spans do it. |
| Reverse-charge order (D157) | The order line's list price (with VAT) and the relief row are unchanged; the unit price is of the listed price. |
| Euro view of a krone store (D109) | Computed from the **shown** euro price (the converted, rounded amount), in euro; never converted from a krone unit price (4.1, the worked difference). |
| Language shown differs from the country's (`no-en`) | Words and number formats follow the language; the amounts and the base follow the market. |
| A subscription with a free trial | 2.1 (cart). |
| Quantity discount, 3-for-2, "buy N pay for M" (D114) | The unit price is of one unit's list price; the offer is its own row. |
| A product with `sold_by_measure` and a draft status | Allowed; refused on activating. |
| Deleting an active product's measure through the editor while it is required | Refused on save. |
| The variant's measure is edited after orders exist | Old orders keep their snapshot; the catalogue, cart and new orders use the new measure. |

### 2.6 Failure behaviour

The unit price is **display and a snapshot**, so no failure of it can change a total or block a sale:

- `unitPrice()` never throws: a missing price, a zero price, a zero result, a result beyond the safe integer range or an unknown unit return `null` with a reason code, and the caller draws nothing.
- Reading the variant's measure is part of the existing catalogue, cart and checkout reads (no extra query, no extra network call); there is nothing to time out.
- `placeOrder()` copies the three measure columns from the same row it already reads for the line (`v.measure_*` next to `v.cost_minor`); a variant without a measure copies nulls. The copy is part of the
  line's insert in the same transaction, so there is no state where the order exists without its snapshot, and no new reason for `placeOrder()` to refuse.
- A save that the unit price rules refuse (2.2) writes nothing and says why; the database's own refusal, if it is reached, is `unit_price.measure_required` or `unit_price.not_applicable`, mapped to the
  same sentences where `saveProduct()`'s errors are turned into messages (the server agent finds the place) and never shown raw.
- A product that is required but has no measure and is already active keeps selling (grandfathered) and is reported (2.2).

### 2.7 Copied orders, host orders, other kinds, other currencies, other languages

- **Copied orders** (`C-…`, D129, `copy_orders()`): the order lines' three snapshot columns are copied with the line, so a copy shows what the original showed; nothing else about a copied order changes.
  The copy rules do not treat the columns as personal or as money.
- **Host orders** (D71): hosts list stays and rentals only, which never carry a measure; a host's goods do not exist. If they ever do, the same rules apply (the unit price is a property of the line).
- **Other kinds**: appointments, stays, rentals and digital variants: no measure, no unit line, refused if sent (2.2, 3.3).
- **Other currencies**: 2.5, euro view; the base never changes with the currency; the amount is computed per shown currency at 4.1. `convertedSql()` is **not** needed: no SQL reads a unit price (it is
  computed from a price already converted by `shown()` where the catalogue is read); a new money read of a *different* kind would need its euro scenario, and here the one in 6.2 covers the display.
- **Other languages**: nb, sv, da, en are hand-written in `src/lib/i18n.ts` (`m.unitPrice`); other languages are filled by the AI catalogue (D111) from the English messages; the platform's language review
  page (D111) is where a person fixes the statutory term of a language the stores offer (German *Grundpreis*, Finnish *yksikköhinta*, ...), and section 8 says so. Numbers and currency follow `market.locale`.

---

## 3. Data

No new table. Columns on four existing tables, one function, one deferred constraint trigger, one freeze trigger. Everything is additive.

### 3.1 The measure on the catalogue

| Table | Column | Type | Meaning |
|---|---|---|---|
| `product_variants` | `measure_amount` | `numeric(12,4)` null | The variant's **total content** in `measure_unit` (the pack's total), up to four decimals. |
| | `measure_unit` | `text` null | One of `g, kg, ml, cl, l, cm, m, m2, piece`. |
| | `measure_base` | `text` null | The owner's preferred comparison base: `kg, 100g, l, 100ml, m, m2, piece`; null means the unit family's default (`kg` for g and kg, `l` for ml, cl and l, `m` for cm and m, `m2`, `piece`). |
| `products` | `sold_by_measure` | `boolean not null default false` | "Every active goods variant needs its content." |
| `terms` | `requires_unit_price` | `boolean not null default false` | On a product category only: its products (and its subcategories') need a measure. |

Checks (Drizzle `check()` in `src/db/schema.ts`, so `db:check` holds them):

- `product_variants_measure_pair`: `measure_amount` and `measure_unit` are both null or both set.
- `product_variants_measure_amount`: `measure_amount > 0 and measure_amount <= 1000000`.
- `product_variants_measure_unit`: `measure_unit` in the nine units.
- `product_variants_measure_base`: `measure_base` is null, or in the seven bases **and** of the unit's family (g, kg: `kg` or `100g`; ml, cl, l: `l` or `100ml`; cm, m: `m`; m2: `m2`; piece: `piece`); and `measure_base` is null when `measure_amount` is null.
- `products_sold_by_measure_goods`: `not sold_by_measure or kind = 'goods'`.
- `terms_requires_unit_price`: `not requires_unit_price or (content_type = 'product' and kind = 'category')`.

### 3.2 The measure on the sold line

| Table | Column | Type | Meaning |
|---|---|---|---|
| `order_lines` | `measure_amount`, `measure_unit` | as above | The variant's measure **when the line was sold**; both null when it had none. |
| | `measure_base` | `text` null | The **effective** base at that time: the owner's choice after the market rule (4.3) was applied, never null when the amount is set; it is what the order's page and email compare in. |

Checks: the same pair, range, unit and family rules as 3.1 (`order_lines_measure_*`), with `measure_base` not null exactly when `measure_amount` is. Written only by the places that insert a goods line:
`placeOrder()` (from the cart's variant row), the subscription renewal (`subscriptions.ts`, which copies the previous order's lines: the three columns are copied with them), `copy_orders()` (3.7), and tests'
fixtures. Fee lines, gift lines (their snapshot is stored, their unit line is not drawn) and lines of bookings have nulls except a gift of a measured product.

**Why a snapshot and not a join**: the order page, the email and the subscription page must say what the order said when it was placed, as the order says its tax rate and its title (`order_lines.tax_rate`,
`.title`); a join to the variant would rewrite old orders when the owner corrects a measure. The price is already on the line; the unit price is derived on read from it and the three columns (it is **not**
stored: a stored derived amount could disagree with the line).

### 3.3 What the database itself enforces

1. The column checks of 3.1 and 3.2.
2. **`commerce.unit_price_required(p_store uuid, p_product uuid) returns boolean`** (stable, `search_path` empty like the 1b helpers): true when the product has `sold_by_measure`, or when any product category assigned to it
   (`product_terms`) or any ancestor of one (`terms.parent_id`, recursive) has `requires_unit_price`. The one definition of "required": the trigger and the products page's report both call it.
3. **A deferred constraint trigger** `commerce.check_unit_price(product)`, fired after insert or update of `status, sold_by_measure, kind` on `products`, of `measure_amount, measure_unit, active, delivery` on `product_variants`
   and after insert on `product_terms` (taking a product out of a category can only make it less required, so there is no check on delete; changed in the foundation step), resolving the product and raising at commit:
   - `unit_price.not_applicable`: a variant of a product whose `kind <> 'goods'`, or whose `delivery <> 'physical'`, has a measure (a digital or booking variant cannot be measured);
   - `unit_price.measure_required` (with the SKUs in the detail): the product is `active`, `unit_price_required()` is true, and an **active, physical** goods variant has no measure.
   It is skipped while a store is being copied (`commerce.unit_price_copying` = `on`, set transaction-locally by `clone_store()` and `duplicate_store()`; added in the foundation step), so a grandfathered product is copied as it was and a copy never fails for the source's gaps; the `not_applicable` check is never skipped. It does **not** fire for a category being marked afterwards (that updates `terms`, which has no trigger here): existing active products are grandfathered and reported, never silently refused or hidden.
4. **`order_lines_measure_frozen`** (before update): the three `measure_*` columns of an order line cannot change after insert, by anyone, so a snapshot is as immutable as the line's price (an update that sets them to
   their present values is allowed, since `subscriptions.ts` updates other columns of the line).
5. `placeOrder()` is not given a new refusal and no function of `complete_order_payment()`, the invoices or the refunds reads the columns.

Tests (PGlite, `src/db/unit-price.test.ts`, 6.1): each check and each trigger above, with a rejected row for every rule and an accepted row next to it, the grandfather case, the category-ancestor case, the freeze,
tenant isolation (a category of another store never makes a product required), and that `commerce.test.ts` still passes (`COPY_RULES` has no new table).

### 3.4 What is private

Nothing here is personal data or secret. The measure and the flags are catalogue and admin settings; `sold_by_measure` and `requires_unit_price` are never rendered to a shopper. The tables stay in the private
`commerce` schema (no Data API); no new function is exposed. The measure columns are not touched by unit 1g's erasure: they are not personal data, and an order line's retention is the order's.

### 3.5 Retention

The snapshot lives and dies with the order line (the accounting retention of the invoice machinery, 1b 3.6). Catalogue measures live with the variant, which is never deleted (variants taken out are switched
off, never deleted). No new retention job, no cron.

### 3.6 `COPY_RULES`

No new table, so `src/lib/store-copy-rules.ts` is **unchanged** and `store-copy-rules.test.ts` keeps passing. The new columns ride on their tables' existing class: `product_variants` and `products` and `terms`
(catalogue: copied), `order_lines` (orders: copied only as history).

### 3.7 `clone_store()`, `duplicate_store()`, `copy_orders()`

All three are redefined the way 1a and 1b did it (`DO $patch$ ... pg_get_functiondef ... replace ...`, failing loudly when an anchor text is not found, the migration of
`20261003193902_tax_engine_rules.sql` is the model):

- `clone_store()` (from the template store): its demo catalogue has no measures, so only the column lists stay in step: `product_variants` copies `measure_amount, measure_unit, measure_base`, `products` copies
  `sold_by_measure`, `terms` copies `requires_unit_price` (in the same `INSERT`, not an `UPDATE`: it is a plain column, unlike `parent_id`), so a template that gets a measure later reaches new stores.
- `duplicate_store()`: the same three columns, with the term ids mapped (`commerce.clone_id()`).
- `copy_orders()`: the three `order_lines` columns, so a copied order's lines show what they showed.

The test `src/db/unit-price.test.ts` creates a store with measured variants, a marked category and an order, runs the three functions and compares. **Production's template store gets no measure** (no data migration), so
nothing changes for existing stores until an owner edits a product.

### 3.8 Migrations expected

Two files, names for the foundation agent to pick (the `20261004…` stamps are already past; use the next free stamp): `{stamp}_unit_price.sql` (generated by `pnpm db:generate` from the schema: the columns and the checks) and
`{stamp}_unit_price_rules.sql` (`pnpm exec drizzle-kit generate --custom --name unit_price_rules`: `unit_price_required()`, `check_unit_price()` and its triggers, the freeze trigger, the three patched functions, the plan
feature row). Neither is applied to production by this run (section 9).

---

## 4. Rules and law

### 4.1 Amounts and rounding (the one function)

`unitPrice(shownMinor, measure, base)` in `src/lib/unit-price.ts`, pure, no I/O, runs in the browser.

Inputs: `shownMinor` is the price **as the surface shows it**: an integer count of minor units of the currency shown, after `shown(market, nativeMinor)` has converted it (D109) and after the VAT display
(with VAT, or `withoutVat(amount, rate)` for a business buyer where the store shows prices without VAT: the price is netted and rounded to a minor unit **first**, as the page shows it, and the unit price is computed
from that integer). `measure` is `{ amount, unit }`; `base` is one of the seven bases.

Arithmetic (all integers, `BigInt`, no floats):

1. `A` = the amount as an integer in ten-thousandths (`parseMeasureAmount("0,75") = 7500`, from the column as a decimal string; never `Number()` of a float).
2. Each unit has an integer **factor into its family's smallest unit**: `g` 1, `kg` 1000 (mass, in grams); `ml` 1, `cl` 10, `l` 1000 (volume, in millilitres); `cm` 1, `m` 100 (length, in centimetres); `m2` 1 (area, in
   square metres); `piece` 1 (count).
3. Each base is a quantity in the same smallest unit: `kg` 1000 g; `100g` 100 g; `l` 1000 ml; `100ml` 100 ml; `m` 100 cm; `m2` 1 m²; `piece` 1.
4. `unit = round_half_up( shownMinor × R × 10000 / (A × f) )` where `R` is the base's quantity and `f` the unit's factor, with `round_half_up(n / d) = (2n + d) / 2d` using integer division, for `n ≥ 0`, `d > 0`.
5. `null` (with a reason) when: the family of the base differs from the unit's; `shownMinor <= 0` (`free`); `A × f == R × 10000` (`same_as_price`, Directive Art. 3(1)); `unit == 0` (`rounds_to_zero`); `unit` is above `Number.MAX_SAFE_INTEGER`
   (`too_large`).
6. The result is in the **currency shown** and is **not** rounded to the market's `step` (the step rounds payable prices; a unit price is information). Money is formatted by `formatMoney(unit, currency, locale)`.

Rounding to the minor unit is the Swedish rule read (KOVFS 2012:1 4 §: two decimals) and is the same in every market; the other sources read do not say.

**Pure rounding table** (every row is a test, 6.1):

| Shown price (minor) | Currency | Measure | Base | Unit price (minor) | Why |
|---|---|---|---|---|---|
| 4990 | NOK | 250 g | kg | 19960 | 4990 × 1000 / 250 |
| 4990 | NOK | 250 g | 100g | 1996 | 4990 × 100 / 250 |
| 1999 | NOK | 330 ml | l | 6058 | 6057,57… rounds half up |
| 1999 | NOK | 33 cl | l | 6058 | cl normalised: the same as 330 ml |
| 2999 | NOK | 0,75 l | l | 3999 | 3998,67 |
| 1250 | NOK | 6 piece | piece | 208 | 208,33 |
| 5 | NOK | 2 kg | kg | 3 | 2,5 rounds up (half up, never banker's) |
| 4990 | NOK | 1 kg | kg | null (`same_as_price`) | Art. 3(1) |
| 4990 | NOK | 1000 g | kg | null (`same_as_price`) | the same quantity in another unit |
| 0 | NOK | 250 g | kg | null (`free`) | a gift |
| 1 | NOK | 1000000 g | kg | null (`rounds_to_zero`) | 0,001 minor |
| 3992 | NOK | 250 g | kg | 15968 | a business buyer's price without VAT: `withoutVat(4990, 0.25)` = 3992, then × 4 |
| 3990 | NOK | 250 g | kg | 15960 | a reduced price: the unit price of the price charged, not of the old 4990 |
| 4999 | NOK | 250 g | kg | 19996 | in NOK |
| 435 | EUR | 250 g | kg | 1740 | the same product in a euro view at 1 EUR = 11,5 NOK, `roundTo` 1: shown = round(4999 / 11,5) = 435, then × 4 |
| 25 | EUR | 3 m | m | 8 | 8,33 |
| 12 | EUR | 0,5 m2 | m2 | 24 | m² is the base |

The **worked difference** that makes the rule matter: converting the krone unit price gives round(19996 / 11,5) = 1739 cents; computing from the shown euro price gives 1740. The shop shows 1740 (from the shown
price) everywhere, because that is the price the shopper reads, and a test (6.2) fixes it.

Property tests (6.1): the result is monotone in the price, anti-monotone in the amount; `unit × measure / base` is within half a minor unit of the price (before rounding); `cl`, `ml` and `l` give the same result for the same
quantity; the BigInt result equals an arbitrary-precision oracle (a rational comparison written in the test, no library); no float appears in the source (a test scans the file for `Math.round`, `parseFloat`, `Number(` on amounts).

### 4.2 Which units, which bases

- Units offered: `g, kg, ml, cl, l, cm, m, m2, piece` (the outline's list plus `cl`, which is the common unit for drinks). Not offered: tonnes, cubic metres, imperial units, millimetres, `cm2`, "per 100 pieces" (Shopify also withholds
  tonnes, centigrams and stones, 1.2).
- Directive Art. 2 allows "one kilogramme, one litre, one metre, one square metre or one cubic metre... or a different single unit of quantity which is widely and customarily used". `piece` is that "single unit of quantity". Cubic metres are
  not offered (nothing a small store sells by the cubic metre).
- A multi-pack's measure is the **pack's total** (6 × 33 cl = 198 cl); KOVFS 2012:1 7 § (a multi-pack consumed singly states the unit of the single item) is *not* applied: the owner who sells a six-pack of drinks gets the price per litre of
  the pack, which is the usual comparison and a valid reading of Art. 2; the editor's pack helper multiplies for them. *Needs review.*

### 4.3 Which base a market shows (the country table)

`src/lib/unit-price-rules.ts` holds `UNIT_PRICE_COUNTRY_RULES`, a table keyed by country code, and `effectiveBase(measure, owner's base, country)`:

```
{ DE: { smallBaseAllowed: false, verified: true,  source: PAngV 2022 § 5(1), read 2026-10-04 (mirror), "1 kg or 1 l for packaged goods; 100 g only for loose goods (§ 5(2))" },
  NO: { smallBaseAllowed: false, verified: true,  source: FOR-2012-11-14-1066 § 4 and § 7, read 2026-10-04: per l, m3, kg, m, m2, piece, 100 m of paper rolls, standard wash; no 100 g },
  SE: { smallBaseAllowed: false, verified: true,  source: KOVFS 2012:1 6 §, read verbatim 2026-10-04: kr/kg, kr/ton, kr/l, kr/m3, kr/m, kr/km, kr/m2, kr/st, kr/100 st, kr/dos; no 100 g },
  DK: { smallBaseAllowed: false, verified: false, source: BEK 1696/2017 not read in full; a search summary names kg, l, m, m2, m3 or a unit of its § 5; closed until read } }
```

and **every other country (including those not in the table) is `smallBaseAllowed: false`**: unknown means the large base. Rules:

1. The owner's `measure_base` is a preference. `effectiveBase()` returns it when it is the family's default, or when the country allows the small base; otherwise it returns the family's default (`100g` becomes `kg`, `100ml` becomes `l`).
2. The base is decided by the **market's country**, not the language or currency shown (D109): `no-en-eur` is Norway.
3. The effective base is what is shown, what the order line snapshots, and what JSON-LD's `valueReference` says (JSON-LD is per market page).
4. The editor's note and the choices it offers (2.2) read this table (`smallBaseNote()`, `compareChoices()`): 100 g and 100 ml are offered only while a market of the store may show them.
5. Every entry is closed (changed in the 1d fix step after review: Norway and Sweden had been left open as "unread", and their rules, once read, name no 100 g or 100 ml). A row is opened only by a person who has read a source that allows it, and the test then says which. The mechanism (owner's preference, per-market effective base, snapshot on the order line, JSON-LD `valueReference`) is kept and tested by opening a country for the length of a test (`allowSmallBase()` in `src/lib/unit-price-test-support.ts`). The table could become platform data like `vat_rates` (section 7); it is code now because nothing about it changes weekly.

Exemptions (Germany's under 10 g or 10 ml, Sweden's 50 g or 50 ml) are **not** applied by the system: showing a unit price where none is required is not a breach, and the owner decides whether to give a small product a measure.

### 4.4 Structured data (JSON-LD)

For every offer of a measured variant (`productJsonLd()`, `src/lib/structured-data.ts`), next to the existing `price`, add:

```json
"priceSpecification": {
  "@type": "UnitPriceSpecification",
  "price": "49.90",
  "priceCurrency": "NOK",
  "referenceQuantity": {
    "@type": "QuantitativeValue",
    "value": "250",
    "unitCode": "GRM",
    "valueReference": { "@type": "QuantitativeValue", "value": "1", "unitCode": "KGM" }
  }
}
```

as Google's merchant listing page (1.3) shows it: `price` is the offer's price for the pack (the same string as the offer's own `price`, with VAT, in the currency of the market page, built by `schemaPrice()`), `referenceQuantity` is
the pack's total, `valueReference` the effective base. `100g` is written as value `100` with `GRM`, `100ml` as `100` with `MLT`, `kg` as `1` with `KGM`. Unit codes: `g` GRM, `kg` KGM, `ml` MLT, `cl` CLT, `l` LTR, `cm` CMT, `m` MTR, `m2` MTK,
`piece` C62 (*from memory; Google accepts the codes or readable equivalents; verify against Merchant Center's unit list*). A variant without a measure gets no `priceSpecification`; a measure that equals its base is still written (a consumer
of the data wants the quantity even when the shop omits the line). The structured data always uses the consumer price with VAT, as the offer does. A product sold only by subscription uses the subscriber's price, as the offer does.

### 4.5 A reduced price, a discount, a business buyer: which price the indication follows

The rule is one sentence: **the unit price is computed from the selling price the surface shows for that unit, with the VAT treatment the surface shows.** What follows from it (all *need review by a lawyer*; section 8):

- **Reduced price** (`set_price`, `prior_30d_minor`): the unit price is of `amountMinor` (the price charged). The "Lowest price in the last 30 days" line (Directive Art. 6a, read only in summary) is unchanged and is
  **not** given a unit price: no "was 250 kr/kg" is ever computed (`referenceMinor` is not an input of `unitPrice()`, which a test asserts by signature and by a source scan). Whether Art. 6a or a national rule wants a
  prior **unit** price is **not read**; Germany's § 11(3) extends the 30-day rule to the unit price only for loose goods (read), which Kaizen does not sell.
- **Basket-level reductions** (a discount code, a campaign, a group or company discount, the friend's welcome discount, bonus credits): they are separate rows in the cart and on the order, not a price the shop *announces* for the product, so they
  do not change the unit price of the line. The product page says the listed price is the list price (`MemberNotice`), the cart lists each reduction as its own row, and `placeOrder()` stores the listed unit price and the reductions apart
  (`order_lines.unit_price_minor`, `discount_minor`). A reading under which a personal code should change the line's unit price would break the rule that the cart's lines equal the order's; this spec does not take it, and says so for review.
- **Business buyers** see prices without VAT where the store shows them so (D63): their unit price is of the price without VAT, as shown. The Directive's definition (Art. 2: including VAT) is about consumers; a business is not a consumer.
- **Reverse charge** (D157): the VAT not charged is a relief row; the line's listed price and its unit price are unchanged.
- **Subscriptions**: the price shown is the plan's price per delivery, and the unit price is of that. **Trials**: of the plan's price, not of today's 0.

### 4.6 Who may do what

| Action | Who |
|---|---|
| Set or change a variant's measure, the `sold_by_measure` flag | the product editor's guard (`products:write`, `saveProductAction`) |
| Mark or unmark a product category | the categories page's existing guard (`products:write`, `taxonomy.ts` actions) |
| See the report of products needing a measure | `products:read` |
| Use `unit_price_gaps` in the AI manager | `products:read` (`TOOL_PERMISSIONS`) |
| Read a unit price | everyone (public catalogue data) |

No new permission key, no owner-only rule. A collaborator or staff role that can edit products can set measures.

---

## 5. Where things live

Areas do not share files except through the registries listed in 5.6. Foundation runs first; the server next; then shopper, admin and analytics-and-ai in parallel.

### 5.1 Foundation (schema, migrations, pure libraries, shared types and text)

| File | What |
|---|---|
| `src/db/schema.ts` | the columns and checks of 3.1 and 3.2 |
| `supabase/migrations/{stamp}_unit_price.sql`, `…_unit_price_rules.sql` | 3.8 |
| `src/lib/unit-price.ts` (+ `.test.ts`) | `UNITS`, `BASES`, `Measure` (`{ amount: string; unit }`, the amount a decimal string as the column holds it), `ShownMeasure` (a measure plus its effective `base`), `UnitPriceResult` (`{ ok: true; minor; base } | { ok: false; reason }`), `parseMeasureAmount()` (ten-thousandths as an integer), `formatMeasureAmount()`, `measureFromColumns()`, `unitPrice()`, `unitPriceShown(amountMinor, vat: PriceVat, measure, buyer?)` (returns the incl value, the excl value, or both, per the store's VAT display: the one place a surface asks), `defaultBase()`, `unitCode()`, `measureProblem()` |
| `src/lib/unit-price-rules.ts` (+ test) | the country table, `effectiveBase()`, `smallBaseAllowed()`, `unitPriceProblems(product facts)` (pure: which variants need a measure and why, used by the editor, the save and the report) |
| `src/lib/unit-price-text.ts` (+ test) | `unitPriceText(unit, locale, labels)` ("199,60 kr/kg") and `baseLabel(base, m)`; no React |
| `src/lib/pricing.ts` | `PriceView.measure: ShownMeasure \| null` (the amount, the unit and the **effective base**, for the market), `priceView(..., measure = null)` last parameter; nothing else changes |
| `src/lib/product-input.ts` | per variant `measure: { amount: string, unit, base } \| null` (typed like a price: a decimal string, parsed by `parseMeasureAmount()`) and `soldByMeasure: boolean`; the zod refinements of 3.1 (no measure for digital or non-goods) |
| `src/lib/i18n.ts` | `m.unitPrice = { label, per, piece, ...}` in `nb`, `sv`, `da`, `en` (hand-written); `Messages` type |
| `src/db/unit-price.test.ts` (PGlite) | 3.3 |
| Test fixtures that build `OrderView` lines by hand (`order-section.test.ts`, `checkout-section.test.ts`, `email-vat.test.ts`, `src/components/admin/returns/test-fixtures.ts`, `analytics-insights-fixture.ts`) | get `measure: null` where the type now requires it |

### 5.2 Server

| File | What |
|---|---|
| `src/server/catalog.ts` | `listProducts()`, `getProduct()` and the content-grid read add `v.measure_*` (for the card the min-priced variant's, ties by SKU) and build `PriceView.measure` through `effectiveBase(…, market.code)`; `ProductVariant.measure` for JSON-LD and the client |
| `src/server/cart.ts` | `getCart()` selects `v.measure_*`; `CartLine.measure` |
| `src/server/checkout.ts` | the cart query adds `v.measure_*`; the line insert writes the snapshot with the effective base for `market.code` |
| `src/server/orders.ts` | `getOrder()` and its siblings select the three columns; `OrderView.lines[].measure` |
| `src/server/subscriptions.ts` | the renewal's line takes the variant's measure as it is when the delivery is placed (like `unit_cost_minor`: `subscription_lines` hold no measure, and the renewal does not copy a previous order's lines), with the base in effect in the subscription's market; the subscription page's read returns the variant's current measure (server step, changed from "copies the previous order's lines") |
| `src/server/standing-orders.ts` | the weekly list's read adds the variant's measure |
| `src/server/products.ts`, `src/server/product-audit.ts` | load and save the measures and `soldByMeasure`; `unitPriceProblems()` before writing; the audit snapshot and `ALLOWED_FIELDS` of the products area gain the measure and the flag (no secret) |
| `src/server/taxonomy.ts` | `requiresUnitPrice` on a product category's save, `updateTag(termsTag(scope))` and the catalogue tags as today |
| `src/server/unit-price-gaps.ts` (+ int test) | `productsNeedingMeasure(storeId)`: calls `commerce.unit_price_required()`; the products page and the AI tool read it |
| `src/server/shopper-emails.ts` | `orderLines()` adds the unit text to the label |
| `src/server/chat-agent.ts`, `src/lib/chat.ts` | `ChatProduct.price` carries the measure (the widget computes), the tool result may carry the sentence |
| `src/server/seo.ts` | none: `llms.txt` lists no prices today, so there is nothing to add the unit text to (server step) |
| `src/server/unit-price.int.test.ts`, `src/server/checkout-kinds.int.test.ts` | 6.2 |

Server step notes (the contract above, as built): `shownMeasureFromColumns()` (a variant's columns and a market's country into a `ShownMeasure`) and `snapshotMeasureFromColumns()` (an order line's frozen columns, the base never worked out again) are the only readers of the columns, listed by `unit-price-readers.test.ts`. A free-trial subscription line has `unit_price_minor` 0 on its first order, so the order page shows no unit price for it (the cart shows the plan's price; 2.1): nothing is computed from 0. `Term.requiresUnitPrice` and `termInput.requiresUnitPrice` (optional: left out means unchanged on an update, off on a new category) carry the category mark through the existing term actions, which already refresh the catalogue and terms tags; `src/server/unit-price-gaps.ts` has `categoryMarks()`, `productsNeedingMeasure()`, `categoryGaps()` and `variantUnitPrices()`.

### 5.3 Shopper

| File | What |
|---|---|
| `src/components/price.tsx` | `UnitLine` (the muted line, the VAT spans as `VatAmount`) and `<Price>` draws it when `price.measure` is set |
| `src/components/purchase-options.tsx` | `PlanPrice` takes `measure` and recomputes the line for the chosen option |
| `src/components/product-parts.tsx` | the `price` part, the variant picker's price node, and `ProductJsonLd` pass the measure (headline = cheapest variant) |
| `src/lib/structured-data.ts` | `ProductFacts.variants[].measure`, `priceSpecification` per 4.4 |
| `src/app/s/[store]/[market]/cart/cart-contents.tsx` | the unit line under each goods line |
| `src/app/s/[store]/[market]/checkout/checkout-section.tsx` | the same, from the order line |
| `src/app/s/[store]/[market]/order/[orderId]/order-section.tsx` | the same, from the order line (gross, as the line shows) |
| `src/app/s/[store]/[market]/subscription/[token]` and `deliveries/deliveries-section.tsx` | 2.1 |
| `src/components/chat-widget.tsx` | the card's unit line |
| `src/components/product-card.tsx` | **unchanged** (it draws `<Price>`) |

Shopper step notes (as built): the line is `UnitLine` (a price block: from `price.measure`, the VAT display of `unitPriceShown()`, `for-private`/`for-business` spans for stores selling to both) and `LineUnitPrice` (a cart, checkout, order, My account or list line: the caller passes one unit's price as the line shows it, netted with `withoutVat()` for a business buyer in the cart and at checkout, gross on the order page), both in `src/components/price.tsx`, each drawing the figure for the eye (`aria-hidden`) and the sentence for a screen reader (`sr-only`) and marked `data-unit-price`. A client component is given the words as plain data (`UnitLabels`, `unitLabelsOf(m)`, `unitPriceWords()`: the spoken sentence keeps `{amount}` and `{base}`), so `PlanPrice`, the chat widget's card (`ChatLabels.unit`) and the subscription form (`ContentsLine.unit`, written by `lineUnitWords()`) need no function across the server boundary. `Price` draws the unit line last, apart from the reference line. Surfaces done: the price part, the variants' price block and the purchase option, listing cards and grids (through `Price`), the cart and slide-out cart, checkout items, order page, My account's order, the subscription page, the weekly list, the chat card and the JSON-LD (`priceSpecification`). Not done in the e2e: checkout (no Stripe session to open the page with; its render test holds it).

### 5.4 Admin

| File | What |
|---|---|
| `src/components/admin/product-editor.tsx` | the Content group, the pack helper, the preview, the `sold by measure` checkbox, the nudge |
| `src/components/admin/terms.tsx` (`TermsManager`) and its actions | the category checkbox and the count message |
| `src/app/admin/(gated)/[store]/products/page.tsx` (and its list component) | the notice and the `?needs=unit-price` filter |
| `src/lib/admin-map.ts` | the text and keywords of `products`, `product` and `product.categories` mention the unit price (no new page: the map's coverage test keeps passing) |

No new admin page: nothing joins `store-nav.ts` and `ADMIN_PAGES` gets no new key.

Admin step notes (as built): the pure words and rules of the editor are `src/lib/unit-price-editor.ts` (`contentPreviews()`, `contentState()`, `categoryChain()`, `compareChoices()`, `withoutContentWhereNotGoods()`), the client parts `src/components/admin/unit-price-fields.tsx` (`ContentFields`, `SoldByMeasureField`) and the products page's `unit-price-gaps-view.tsx` (`NeedsContentNotice`, `NeedsContentList`); the pack total and the typed-content reader are `packTotal()` and `typedMeasure()` at the end of `unit-price.ts`, so no admin file reads the content columns or parses an amount (the scan test's allowlist is unchanged). Deviations from 2.2: (1) the preview line is `Unit price in {market} ({currency}): ...` per market that has a typed price and `Not shown in {market}: {reason}` per market where it cannot be shown (the literal "Not shown: no price yet." only when no market has a price); a business-only store's typed price is turned into the kept price with VAT first, as saving does, and shown without VAT; a store selling to both shows both. (2) A draft is told what it will need once published ("Before you publish this product:", from `contentState().pending`), an active product what stops the save now; the save itself is the server's. (3) A variant that stops being shipped goods (kind or delivery changed) loses its content at once in the editor, with a notice for a change of kind only (the server would refuse it otherwise). (4) An empty content is sent as none. (5) Store Home and the control center show nothing for unit prices (the spec names none): the products page's notice and the categories screen's counts are the places. (6) The categories screen sends `requiresUnitPrice` only on a store's product categories (`TermsManager`'s `unitPrice` prop); pages' and articles' categories never see the mark.

### 5.5 Analytics and AI

| File | What |
|---|---|
| `src/lib/owner-tools.ts`, `src/lib/owner-tool-permissions.ts`, `src/server/owner-tools.ts` | `unit_price_gaps` (read-only: zod arguments, description, a `TOOL_PERMISSIONS` row `products:read`, a `HANDLERS` entry, a `TOOL_WORDS` line); `get_product` adds each variant's measure and per-market unit price (from `unitPrice()`); served by the store's MCP server like the other owner tools (D96) |
| `src/lib/assistant-skills.ts` | optional: a short playbook *"Adding unit prices"* (find gaps, open the editor); no write tool |
| As built (analytics-and-ai step) | `unit_price_gaps` takes an optional `product` and a `limit`: without a product it lists `productsNeedingMeasure()` (id, title, handle, why, SKUs, editor link) with the count of variants that have content; with one it gives each variant's content and per-country unit price from `variantUnitPrices()`; `get_product` adds `content` and `unit_prices` per measured variant. The words are `src/lib/unit-price-tools.ts` (`contentWords()`, `unitPriceAnswer()`: no arithmetic); the playbook is the skill `unit-prices`. Tests: `src/lib/unit-price-tools.test.ts`, `src/server/unit-price-tools.int.test.ts`. Amounts are in each country's own currency (nothing converted), so no euro scenario applies to this read. |
| Analytics (D152) | **nothing**: no figure reads a unit price; the order line's new columns are not in `docs/analytics.md` |

### 5.6 The registries, once more, and who edits each

| Registry | Edit | Owner |
|---|---|---|
| `src/lib/i18n.ts` | `m.unitPrice` (nb, sv, da, en) | foundation (shopper and server consume it) |
| `src/lib/email-text.ts` | none | |
| `src/lib/ui-catalog.ts` | none (a plain English message is picked up; no `CHOOSING` entry: no message chooses by a number or yes/no) | |
| `src/lib/store-nav.ts` | none | |
| `src/lib/admin-map.ts` | three entries' text | admin |
| `src/lib/cookie-consent.ts` (`KNOWN_COOKIES`) | none (no cookie, no storage) | |
| plan features (D132) | one row in the rules migration | foundation |
| `src/lib/owner-tools.ts`, `owner-tool-permissions.ts`, `server/owner-tools.ts` | `unit_price_gaps` | analytics-and-ai |
| `src/lib/store-translate.ts` (D110 worklist) | none: the measure is numbers and a unit, not a translatable text; the unit labels are interface messages | |
| `sitemap`, `robots`, `llms.txt` | `llms.txt` note only | server |
| `src/lib/structured-data.ts` | `priceSpecification` | shopper |
| `src/lib/store-copy-rules.ts` | none (3.6) | |
| `docs/parity/rows`, `CLAUDE.md`, `docs/decisions.md` | the lead (section 9) | lead |

---

## 6. Acceptance criteria, row by row, mapped to tests

One row, five criteria. Test files are named so the agents create them; "unit" is `pnpm test`, "PGlite" is a `src/db/*.test.ts`, "int" is `pnpm test:int`, "e2e" is `pnpm test:e2e` (port 3100 in this lane).

### 6.1 `international.unit-price-indication`

| # | Criterion (the row's text) | Held by |
|---|---|---|
| 1 | A variant can carry a total measure and unit (g, kg, ml, cl, l, cm, m, m2, piece) and a reference quantity (default 1 kg, 1 l, 1 m, 1 m2, 1 piece; 100 g or 100 ml only where a market's country allows it, which none does today). | **unit** `src/lib/unit-price.test.ts`: the rounding table of 4.1 (every row), the property tests, `cl`, `parseMeasureAmount()` ("0,75", "1.5", "250", refusing "0", "-1", "1e3", more than four decimals), the family check, `effectiveBase()` for DE, NO, SE, DK and an unlisted country (always kg and l) and, with a country opened for the test, the owner's choice; `unit-price-rules.test.ts` (the table is complete for the four countries, every row is closed and carries its source and the verified flag). **PGlite** `src/db/unit-price.test.ts`: the column checks and every unit and base accepted and refused. **unit** `src/lib/product-input.test.ts`: the editor's JSON accepts and refuses the same. **int** `src/server/unit-price.int.test.ts`: `saveProduct()` round-trips a measure and a base and `getProduct()` reads them back. |
| 2a | The product page, listing cards, cart, checkout and order confirmation show the unit price... | **unit render tests** (`renderToString`, the repo's pattern): `src/components/price.test.ts` (the line under a price; hidden when no measure, when equal, when free; the VAT `choice` spans carry the incl and the excl value; the sr-only label), `src/components/purchase-options.test.ts` (the plan option recomputes), `product-parts` price part and variant dropdown, `src/components/product-card.test.ts` (the cheapest variant's line, no "from" on it), `src/app/s/[store]/[market]/cart/cart-contents.test.ts`, `checkout/checkout-section.test.ts`, `order/[orderId]/order-section.test.ts` (each with a measured line, a gift line, an unmeasured line and a business buyer), `src/server/shopper-emails.test.ts` (the label), `chat` card. **int** `unit-price.int.test.ts`: `getCart()`, `getOrder()`, the subscription page and the renewal keep the snapshot; an edit of the variant after the order leaves the order's line unchanged; `copy_orders()` copies the snapshot. **e2e** `e2e/unit-price.spec.ts`: a signed-out visitor sees the line on the product page (and after choosing another variant), on the listing, in the cart and in the slide-out cart, at checkout and on the order page of a paid fixture order, in nb and en. |
| 2b | ... with the shown VAT treatment, converted per market currency like the price, and computed in code from the shown price. | **unit** the table's business row (3992 → 15968) and the euro row (435 → 1740 against the converted 1739); a unit test of `unitPriceShown()` for `incl`, `excl` and `choice`; a source scan that no component or server file computes a per-measure amount except through `unitPrice()` (`unit-price-readers.test.ts`, like `vat-readers.test.ts`). **int** the euro scenario of 6.2. |
| 3 | A reduced price shows the unit price of the price charged; the 30-day reference is not misused for it. | **unit** the table's reduced-price row; a test that `unitPrice()`'s parameters cannot receive `referenceMinor` (a type test) and that the price block renders the "lowest price in the last 30 days" line **without** a unit line beside it; **int** a variant whose price was lowered (`commerce.set_price`) shows the lower unit price and the reference line unchanged. |
| 4a | Unit price appears in the product's JSON-LD... | **unit** `src/lib/structured-data.test.ts`: the `priceSpecification` of 4.4 for g, kg, ml, cl, l, m, m2, piece and for `100g`, a variant without a measure has none, a subscription-only product uses the subscriber's price, and the German page's `valueReference` is `KGM` even when the owner chose `100g`. **e2e** the page's `application/ld+json` contains it. (See the criteria change in 6.5 for the property names.) |
| 4b | ... and a unit price is refused when the measure is missing for a category the owner marked as requiring it. | **PGlite** `unit-price.test.ts`: an active product with `sold_by_measure` and a measureless active physical variant fails at commit with `unit_price.measure_required`; the same for a product under a marked category and under a marked **ancestor** category; a draft is accepted; marking a category afterwards leaves active products alone (grandfathered) and `unit_price_required()` is true for them; a measure on a digital, appointment, stay or rental variant fails with `unit_price.not_applicable`; another store's marked category never applies. **int** `saveProduct()` refuses with the sentences of 2.2, writes nothing, and `productsNeedingMeasure()` lists a grandfathered product with its reason. **unit** `unit-price-rules.test.ts` for `unitPriceProblems()`. **e2e** none (the admin has no signed-in e2e today); the editor's state is unit-tested through its pure functions. |
| 5 | A euro-view scenario in `checkout-kinds.int.test.ts` holds that the unit price shown equals the one computed from the charged price. | **int** `src/server/checkout-kinds.int.test.ts`: a `measured` fixture (a variant of the demo goods given a 250 g measure with base `kg`) joins **every** existing goods scenario and `euroScenarios`, through a shared check (`expectUnitPrices(orderId, cart)`) that, for every goods line: (a) the cart line's unit price (from `getCart()` and `unitPrice()` on `line.unitPriceMinor`) equals (b) the unit price computed from the **order line's** `unit_price_minor` and its snapshot, equals (c) an independent oracle in the test that works the number from the catalogue price and the euro conversion by BigInt, and that the three agree for a business buyer (net), a code, a campaign (3-for-2, a free product), a group discount, bonus credits and the welcome discount (none of which change it), a subscription with a trial, and a krone store shown in euro (the 435/1740 case, with the unit price 1739-by-conversion shown to be different and not the one used). The scenario also asserts `placeOrder()`'s totals are **identical with and without a measure** (a unit price changes no money). |

### 6.2 The euro scenario in detail (`checkout-kinds.int.test.ts`)

Add to the existing `Scenario` type an optional `measured?: boolean` (default true for goods, since the helper sets the measure on the fixture variant before the scenario and restores it after) and make `expectUnitPrices()` part of the same
`expectDocuments()` family of checks that every scenario already runs. The euro rate of the file (1 EUR = 11,5 NOK, `roundTo` 1, line 203 of the present file) gives the 435 / 1740 case with a price of 4999 minor; the fixture price is set with `commerce.set_price` in the test, as the other scenarios do. Every scenario that has a gift, a code or credits also asserts that the gift line shows no unit price and that the discount rows are unchanged.

### 6.3 Cross-cutting tests

- `src/lib/unit-price-readers.test.ts`: a scan that nothing outside `unit-price.ts` divides a price by a measure (words `measure_amount`, `measureAmount` appear only in the allowed files).
- `src/lib/product-input.test.ts`, `src/lib/i18n.test.ts` (the four languages have every `m.unitPrice` key), `src/lib/ui-catalog.test.ts` (unchanged).
- `src/lib/admin-map.test.ts` passes unchanged.
- `src/lib/permissions.scan.test.ts` and `owner-tool-permissions.test.ts` pass with the new tool's row.
- `store-copy-rules.test.ts` passes unchanged (no new table); `src/db/unit-price.test.ts` also checks `clone_store()`, `duplicate_store()` and `copy_orders()`.
- `pnpm db:check` (schema and migrations agree).
- Accessibility: the unit line is text with sufficient contrast in the theme tokens (`text-muted`), never colour alone; `e2e/a11y.spec.ts` (axe) is run on the product page of a measured product by adding that page to its list (the e2e agent adds it).
- Performance: no extra query per request; `listProducts()` and `getProduct()` stay cached (`'use cache'`, the catalogue tags): a product save already calls `updateTag(catalogTag(store))`.

### 6.4 What each test layer needs from the database

The PGlite test needs `createTestDatabase()` (all migrations) and a store from the file's own helper; the int tests need `scripts/db-setup.mjs --seed` or, in this lane, `node scripts/db-template.mjs clone w1_unitprice --force`; the e2e needs `PORT=3100 pnpm test:e2e` after a build.

### 6.5 Criteria changes proposed (no row is edited)

1. **Criterion 4, JSON-LD property names.** *Row says:* "Unit price appears in the product's JSON-LD (unitPricingMeasure and unitPricingBaseMeasure)". *Found:* those are attributes of Google Merchant Center's product feed, not schema.org properties (schema.org's `UnitPriceSpecification` page lists neither; read 2026-10-04), and the structured-data form Google documents for a unit price is an `Offer.priceSpecification` of type `UnitPriceSpecification` with `referenceQuantity` and `valueReference` (1.3, 4.4). *Proposed text:* "The product's JSON-LD offer carries a `priceSpecification` of type `UnitPriceSpecification` with `price`, `priceCurrency` and a `referenceQuantity` whose `valueReference` is the base measure, as Google's merchant listing documentation shows. The Merchant Center feed attributes `unit_pricing_measure` and `unit_pricing_base_measure` are produced by the feed row of wave 5 from the same data."
2. **Criterion 4, "refused when the measure is missing for a category the owner marked".** *Found:* "refused" has to mean *refused when saving an active product*, not a shop that stops selling existing products, and the owner needs a way to mark a product too (the outline's `sold_by_measure`). *Proposed text:* "A product the owner marked as sold by measure, or that is in a product category the owner marked as needing a unit price, cannot be saved active while an active physical variant has no measure; a draft can, an existing active product is reported rather than hidden, and the database refuses the same state."
3. **Criterion 3, "the 30-day reference is not misused for it".** *Found:* a negative with no observable. *Proposed text:* "A reduced price shows the unit price of the price charged; the unit price is never computed from, struck through against, or shown beside the 30-day reference price."
4. **Criterion 1, the unit list.** *Found:* the outline adds `cl`, and the reference choice is per market (DE, NO and SE refuse 100 g and 100 ml for packaged goods; Denmark unread, closed). *Proposed text:* "... (g, kg, ml, cl, l, cm, m, m2, piece) and a reference quantity (default 1 kg, 1 l, 1 m, 1 m2, 1 piece; 100 g or 100 ml only where a market's rule allows it: no country does today, so none)."
5. **Criterion 2.** *Found:* "checkout" is the page of the pending order, "order confirmation" is the order page and the confirmation email, "listing cards" show the cheapest variant's. *Proposed text:* "... the product page, listing cards (for the variant the card's price shows), cart, checkout, order page and order emails show..." and "the unit price shown equals the one computed from the charged price" in criterion 5 is defined as **the order line's unit price** (the listed price per unit; basket-level discounts are separate rows), so it is testable.

None weakens a criterion; 2, 3 and 5 make the existing ones testable, and 1 and 4 follow the sources.

---

## 7. What is deliberately not done, and who takes it

| Not done | Why | Taken by |
|---|---|---|
| Sort and filter listings by unit price | Shopify has neither; the listing filters (D78) compare prices as shown | a later storefront wave if asked |
| Unit price on invoices, credit notes, staff order pages | an invoice is not an offer (Directive Art. 3 is about offering and advertising); the invoice's own `unitPrice` is the per-item price (1b) | not planned |
| The Merchant Center feed's `unit_pricing_measure` and `unit_pricing_base_measure` | no feed exists yet | wave 5 (channels): the data model carries the measure and the effective base per market |
| A bottom-bar unit line on phones | the full block with its unit line is on the same page above; the bar repeats only the amount | revisit if a lawyer disagrees |
| Loose goods (sold by weight in the shopper's presence), a drained weight (§ 5(4) PAngV), dosage or "per standard wash" units (§ 5(5) PAngV; Sweden's dosage rule), cubic metres, imperial units, "per 100 pieces" | not what a small online store sells, or no source read | not planned |
| Automatic exemptions (50 g or 50 ml in Sweden, 10 g or 10 ml in Germany, "identical to the selling price" aside) | showing a unit price where none is required is not a breach; the owner decides | not planned |
| A per-market unit family (Shopify refuses it too) | one measure per variant | not planned |
| The country table as platform data with a verifier, like `vat_rates` | one of its rows (DK) is unread and nothing about it changes weekly; code with a `verified` flag is honest and easy to correct | wave 7 (markets), or when a person verifies DK or finds a country that allows 100 g |
| Bundles and kits with several measures; quantity breaks and price lists | one measure per variant | waves 6 (catalogue) will call `unitPrice()` for each tier's shown price |
| An AI tool that sets measures, or an AI suggestion of a measure from a title | a measure changes what the law says a page must show; the editor's refusals are the guard | not planned |
| Showing the unit price in the staff's order view or in analytics | no figure uses it | not planned |
| Retroactive snapshots on orders placed before this unit | the line cannot know what the variant said then; those orders show nothing | not planned |
| Norwegian and Danish rules read at the statute | the sources could not be read (1.3) | a person, before real use in those markets |
| The prior **unit** price in an announced reduction | Art. 6a and the Commission's notice were not read (4.5) | the lawyer review of section 8 |

---

## 8. Needs human legal review

The row's wording is interface text and a rule table, not a consumer legal document; nothing here is machine-translated; the following need a person (a lawyer for the rules, a native speaker for the words) before real use. Every item is in code with a flag, so a correction is small.

1. **The rule that discounts, codes, campaigns, group prices, credits and reverse-charge relief do not change a line's unit price** (4.5), and that a reduced list price (`set_price`) does. Specifically: whether Directive 98/6/EC Art. 6a and the national rules want a prior unit price when a reduction is announced (not read), and whether a campaign's announced percentage needs a unit price of the reduced price.
2. **The country table** (4.3): that Germany refuses 100 g and 100 ml for packaged goods (read in a mirror of PAngV 2022), that Norway and Sweden do not (FOR-2012-11-14-1066 § 4 and § 7; KOVFS 2012:1 6 §), that Denmark's text was not read (closed, `verified: false`), and that every other market uses 1 kg and 1 l.
3. **Business buyers' unit price without VAT** (4.5) where the store shows prices without VAT.
4. **A multi-pack's total as the measure** (4.2) against Sweden's 7 § (a multi-pack consumed singly states the price per single item).
5. **Rounding to the minor unit** in every market (4.1; read only in Swedish KOVFS 4 §).
6. **The shopper's words**, in nb, sv, da and en, each a short label or a unit symbol written in `m.unitPrice` (*Enhetspris*, *Jämförpris*, *Enhedspris*, *Unit price*; the screen-reader sentence; `stk.`, `st`, `stk.`, `piece`; "per" forms): the statutory term of each country, and the language review page for other languages (German *Grundpreis* in particular).
7. **The editor's notes**: "100 g and 100 ml are shown only where your country's rule allows it... check your country's rule", the nudge for food, and the refusal sentences (admin, English only; they state what the rule is in the owner's words).
8. **The JSON-LD unit codes** (4.4), read from memory and not against Merchant Center's list.

None of these is an item of the legal-starter pages (unit 1e) or the invoice wording (1b).

---

## 9. For the lead

### 9.1 Migrations expected

Two new files (3.8). Neither is applied to production by the run. With CI migrations on (`docs/ci-migrations.md`) they reach production after the checks pass on `main`; each file runs in one transaction, and an applied file is never edited (a mistake is a new file). The generated file adds columns and checks only (a column with a default on `products` and `terms` rewrites nothing on a modern Postgres; `order_lines` columns are nullable, no default).

### 9.2 Statements the Supabase migration tool may cancel (the owner runs them in the SQL editor if so), and things only the lead can do

- **None are expected to contain `DELETE`, `DROP` or `TRUNCATE` inside a function body**: `unit_price_required()` and `check_unit_price()` read only; the freeze trigger raises; the three patched functions are replaced with `CREATE OR REPLACE` text produced by `pg_get_functiondef` + `replace`, so **the bodies of `clone_store()`, `duplicate_store()` and `copy_orders()` already contain deletes** (they did for 1a and 1b) and the tool-based path cancelled those parts: the 1a precedent applied the file in parts. If the lead applies by hand rather than by CI, split the three patch blocks into their own parts and check each took (`select position('measure_amount' in pg_get_functiondef(...))`).
- No `DROP TRIGGER` is needed: nothing existing is replaced.
- The plan feature row is an `INSERT ... WHERE NOT EXISTS`.
- The `anchors` of the three patches (the column lists of the variant, product and term inserts) must match production's present definition (`pg_get_functiondef` there, not only the repository's: the repository's last definitions are in `20261002143638_analytics_rules.sql` and the patches of `20261003193902_tax_engine_rules.sql`, `20261004125337_order_invoices_rules.sql`); a patch that finds no anchor raises, which fails the file, as intended.

### 9.3 Advisors to check after applying

Security: the new functions are in the private `commerce` schema, `SET search_path = ''`, not granted to `anon`/`authenticated` (as the 1b helpers); no new table, so no RLS question. Performance: `unit_price_required()` is used by one deferred trigger on saves and by the staff report only; if the report is slow on a store with very many products, an index on `product_terms (store_id, product_id)` already exists for the recursive step (verify) and `terms (store_id, requires_unit_price) where requires_unit_price` (a partial index, small) may be added.

### 9.4 Decision row (draft)

(Recorded in `docs/decisions.md` (D160) and CLAUDE.md; this draft is no longer kept here.)

### 9.5 CLAUDE.md bullet (draft)

(Recorded in `docs/decisions.md` (D160) and CLAUDE.md; this draft is no longer kept here.)

### 9.6 Merge notes

- Shared files the other lanes also touch: `src/lib/i18n.ts` (one new group, `unitPrice`, add near the price messages), `src/lib/pricing.ts` (an added optional parameter), `src/lib/product-input.ts`, `src/db/schema.ts` (columns on four tables), `src/server/checkout.ts` (one column list and one values list), `src/server/checkout-kinds.int.test.ts` (a shared check), `src/lib/owner-tools.ts`. Each edit is small and local; 1c (reports) and 1g (GDPR) read none of the new columns.
- The migration stamps must sort after the other lanes' files; rename the two files when merging if needed (never after they are applied).
- No conflict with 1b: invoices read order lines by name; the new nullable columns do not enter an invoice snapshot, which the 1b parity test (`invoice-parity.test.ts`) confirms by passing unchanged.

### 9.7 Before pushing (the things CI cannot prove)

1. A person who reads Norwegian, Swedish and Danish reads `m.unitPrice` on a real product page.
2. Someone checks the Norwegian and Danish rules (1.3) and the Swedish rule on 100 g, and edits the country table.
3. Look at the product page, listing, cart and order page of a measured product in a krone store and in euro, with and without a group discount, once by eye.
4. Decide whether the lead holds the row at **partial** until item 2 and section 8 are done (1.1).

### 9.8 Blockers and risks

No owner decision and no credential stops the work. The risk is the unread rules (listed above, Denmark's among them) and the size of the shared-file edits (9.6).
