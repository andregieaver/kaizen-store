# Invoices and credit notes for shop orders (wave 1, unit 1b; decision D159 proposed)

The contract for unit 1b of `docs/wave-1.md`: a legal invoice for every paid shop order, in the store's own gap-free series, issued by SQL inside the
payment transaction; a credit note for every succeeded refund (and for a return refunded outside Kaizen), in its own gap-free series; a PDF of each,
stored privately; and the screens, emails, export and tests that go with them. `docs/wave-1.md` section 1b is the agreed outline; this file elaborates it
(law with sources and read dates, exact data, files, acceptance mapped to tests) and does not contradict it. Where reading the code showed the outline
needs a refinement, section 1.4 lists it and the lead settles it before the run starts. Code, tests and texts follow this file, and a disagreement is
settled here first. **This file is documentation only: nothing here is built yet.**

**Nothing here is legal or tax advice.** Every rule that comes from a law is written with its source and the date it was read, is marked *needs review by
an accountant or lawyer*, and lives in data or one pure function, so a correction is a data change and not a rewrite. Every consumer-facing text is
hand-written in nb, sv, da and en, is never machine-translated, and is kept out of the AI catalogue (section 5.3).

Lane note: this run is the money lane's second unit. Unit 1a (tax profile and VAT engine, D157) and the trust lane (1e/1f, D158) are already in the tree and
are the model: `orders.vat_kind`, `vat_relief_minor`, `vat_treatment`, `shipping_tax_rate`, `store_tax_profile`; `requirePermission()`/`checkPermission()`,
`AUDIT_AREAS`, `TOOL_PERMISSIONS`, the permission scan tests, `legalFacts()`, the pay-route import graph. Units 1c (reports), 1d (unit price) and 1g (GDPR)
are not built here; section 3.7 and 5.5 say exactly what 1c reads and which hook 1g calls.

---

## 1. Purpose and scope

### 1.1 Rows this unit closes, and what each can honestly reach

| Row | Weight | Bucket | What 1b does | Honest rating when 1b is done |
|---|---|---|---|---|
| `orders.invoices-and-vat-receipts-for-orders` | 4 | A | Criteria 1 to 4: an invoice per paid order in the store's own series, issued once and immutable (seller, buyer, VAT per rate, currency); the shopper downloads a PDF from the order page and the order email, staff reprint it; a business order carries the buyer's company and VAT number and the reverse-charge note; copied history and hosts' orders never get one. | **full** by the criteria and the tests of section 6. The lead holds it at **partial** under `docs/parity/WAVES.md` step 4 until a person has read the invoice wording (section 8): the rule is that a row resting on unreviewed legal text is not Full. |
| `orders.credit-notes-for-refunds` | 3 | A | Criteria 1 to 3: a credit note per succeeded refund, linked to the invoice, with the refunded amount and VAT per rate; a return's refund (D153) makes one credit note with its working and the shopper gets it with the refund email; immutable and never above what the invoice left uncredited. | **full** by criteria and tests, held at partial under the same rule until the wording is reviewed. |
| `international.legal-invoices-and-credit-notes-for-orders` | 4 | A | Criteria 1 to 4: the invoice with PDF and link in the email and account; credit note referencing the invoice and listing the refunded lines and VAT; totals equal to the order's and the refunds' in scenarios in `checkout-kinds.int.test.ts` (bonus credit, group and code discounts, euro view); copied and host orders get none; numbers cannot be skipped, lowered or deleted. | **full** by criteria and tests, held at partial under the same rule. The national-currency VAT line (3.4, 4.5) and the buyer-address rule (4.3) are the points an accountant is most likely to change. |

None of the three is bucket B, C or D, and no owner decision from `docs/parity-plan.md` section 5 is needed. Three **defaults** that change real behaviour are
taken in section 1.4 and in `Decisions taken with defaults` of `docs/wave-1.md`; the lead may veto any.

Ratings are changed by `history` entries in the rows and `pnpm parity:write`, by the lead at the end of the run from what the tests hold. The rows are not
edited in this spec. The rows' `evidence.files` and `evidence.tests` are updated at re-rating to the files of section 5 and the tests of section 6.

### 1.2 What Shopify does (read on 2026-10-04)

- **Order Printer.** Shopify's own free app prints invoices, receipts, packing slips and pick lists "for single orders or in bulk" (up to 50 orders at once)
  from templates in HTML, CSS and Liquid, with colours, fonts, **invoice numbering**, barcodes and a logo. The app page does not mention credit notes
  (<https://apps.shopify.com/shopify-order-printer>, fetched 2026-10-04; the tracker's own reading of 2026-10-03 says the app "does not support credit notes,
  gift receipts or draft orders" and is the source of that sentence).
- **Legal invoicing and credit notes are an app.** The tracker rows record this as tier `app`. A third-party comparison states the difference plainly:
  "looking like an invoice and being a legally valid one are two very different things", and lists sequential numbering, credit notes, EU compliance and a
  proper PDF as what order printers lack (<https://sufio.com/blog/order-printer-apps-vs-invoicing-apps/>, fetched 2026-10-04; a vendor's blog, so a hint
  about the market and not a statement of Shopify).
- **Shopify's help centre** page on the Order Printer app, read for this spec, says nothing about invoices or credit notes
  (<https://help.shopify.com/en/manual/orders/order-printer-app>, fetched 2026-10-04: no invoice content on that page). The Shopify side of all three rows is
  therefore "an invoicing app from the App Store", as the rows say; nothing was found that makes it native.

Where Kaizen goes further than Shopify on purpose: the invoice and the credit note are issued by the database in the payment transaction (a number is never
printed that the database has not recorded), a refund can never leave an order without its credit note, and reverse charge and IOSS orders say so with the numbers.
Where it stops short: no custom invoice templates (the layout is fixed, section 7), no accounting-system push (Tripletex is a proposal, `docs/tripletex.md`).

### 1.3 Sources read for this spec (and what was not read)

| Source | Used for | Read |
|---|---|---|
| Council Directive 2006/112/EC (VAT Directive), Art. 226 as in <https://www.legislation.gov.uk/eudr/2006/112/article/226> (text at the UK's exit; the page was summarised by the fetch tool, and the 15 points match the Directive as the foundation agent knows it: **re-read against EUR-Lex before the list is frozen**, EUR-Lex itself would not load) | invoice content: 1 date, 2 sequential number, 3 supplier's VAT number, 4 customer's VAT number when the customer must account for the VAT, 5 names and addresses, 6 quantity and nature, 7 supply date when different, 8 taxable amount per rate, unit price excluding VAT, discounts, 9 rate, 10 VAT amount, 11 exemption reference, 11a "Reverse charge", 15 tax representative | 2026-10-04 |
| Directive Art. 219 (<https://www.legislation.gov.uk/eudr/2006/112/article/219>) | "Any document or message that amends and refers specifically and unambiguously to the initial invoice shall be treated as an invoice": a credit note is an invoice and must refer to the original unambiguously | 2026-10-04 |
| Directive Art. 222 (same site) | invoices for intra-Community supplies (Art. 138) and for supplies where the customer owes the VAT (Art. 196) are issued **no later than the 15th of the month after** the chargeable event; other supplies: member states may set a limit | 2026-10-04 |
| Directive Art. 227 and 232 and 238 (same site) | a member state may require the customer's VAT number in other cases (227); an electronic invoice needs the recipient's acceptance (232); simplified invoices may be allowed by a member state, for example between 100 and 400 EUR or where full compliance is hard in the trade (238, as summarised by the fetch tool; *verify*) | 2026-10-04 |
| Directive Art. 230 (same site) | "The amounts which appear on the invoice may be expressed in any currency, provided that the amount of VAT payable or to be adjusted is expressed in the national currency of the Member State, using the conversion rate mechanism provided for in Article 91" | 2026-10-04 |
| Norway: bokføringsforskriften § 5-1-1, <https://lovdata.no/forskrift/2004-12-01-1558/§5-1-1> | a sales document holds at least: number and documentation date; the parties; nature and extent of the supply; time and place of delivery; consideration and payment due date; VAT and other taxes "required specified"; **VAT is stated in Norwegian kroner**; "Omvendt avgiftsplikt – Merverdiavgift ikke beregnet" when the buyer calculates the VAT under mval. § 11-1 second or third paragraph. The date of documentation is the issue date unless otherwise stated | 2026-10-04 |
| Norway: bokføringsforskriften Delkapittel 5-1 (<https://lovdata.no/forskrift/2004-12-01-1558/§5-1-2>, the page returned the chapter's contents, summarised by the fetch tool) | § 5-1-2 parties' details incl. organisation numbers from the Business Register, with "MVA" after the number of a VAT-registered party; § 5-1-3 sequential numbering of sales documents or equivalent control; § 5-1-4 delivery date may be left out in some freight cases; § 5-1-5 sales subject to VAT, exempt, reverse charge and at different rates specified separately | 2026-10-04 (summary; *verify the wording*) |
| Norway: bokføringsloven § 13 (<https://lovdata.no/lov/2004-11-19-73/§13>) | **5 years** after the end of the fiscal year for documentation of booked information, annual accounts and the like; 3 years and 6 months for agreements, correspondence, outgoing packing slips and price lists; material to be kept in Norway, readable and printable, and may be moved to other media if it can still be verified | 2026-10-04 |
| Sweden: Skatteverket, "Momslagens regler om fakturering" (<https://www.skatteverket.se/foretag/moms/saljavarorochtjanster/momslagensregleromfakturering.4.58d555751259e4d66168000403.html>) | full invoice: date and unique sequential number, seller's VAT number, buyer's VAT number where reverse charge applies, names and addresses, quantity and nature, unit price excluding VAT and discounts not in the unit price, VAT rate, **the VAT amount**; **credit note**: a clear reference to the original invoice number, what changed, and the other information of a full or simplified invoice; **VAT in SEK** also when invoiced in another currency, at the latest known rate for the day of supply (ECB or Nasdaq OMX); special deadlines for construction services and intra-Community supplies (15th of the month after) | 2026-10-04 |
| Sweden: search results quoting Skatteverket and FAR Online on credit notes ("ändringsfaktura"; mervärdesskattelagen (2023:200) 17 kap. 22 to 24 §§) and on bokföringslagen 7 kap. 2 § (**seven years** after the end of the calendar year of the financial year) | credit note content; retention; *snippets only, the statute pages were not read* | 2026-10-04 |
| Denmark: Skattestyrelsen's legal guidance as mirrored on <https://tax.dk/jv-2025-1/ab/A_B_3_3_1_4.htm> (momsbekendtgørelsen § 58, § 97) and momsloven § 52 a (<https://danskelove.dk/momsloven/52a>) | a full invoice holds issue date, sequential number, seller's CVR or SE number, names and addresses, quantity and nature, delivery date if different, VAT base, unit price excluding VAT, discounts, VAT rate and VAT amount; the issue date is the day the invoice is printed or made available (no backdating to the delivery date); invoicing in euro needs only the euro VAT, **in another foreign currency the VAT in DKK or the exchange rate** must be on the invoice (§ 97); a document that specifically and unambiguously amends or refers to the original is an invoice, and **a cancelled invoice needs a credit note to the customer**; a non-registered person may not state VAT on an invoice (§ 52 a) | 2026-10-04 |
| Denmark: bogføringsloven § 12 as quoted by Skattestyrelsen's guidance (<https://tax.dk/jv-2025-1/ab/A_B_3_3_3_4.htm> and search results) | accounting material kept **5 years** after the end of the financial year | 2026-10-04 (snippet level) |
| Germany: UStG § 14 as summarised at <https://dejure.org/gesetze/UStG/14.html> (gesetze-im-internet.de returned 503; the summary was garbled, so the **list of points below is the foundation agent's own knowledge of § 14(4) and must be re-read**) | § 14(4): full name and address of supplier and recipient; tax number or VAT number; issue date; **consecutive number**, unique; quantity and nature or extent; time of supply; consideration by rate and exemption, with agreed reductions; rate and tax amount or the exemption note; retention notice in cases of § 14b(1) sentence 5; "Gutschrift" for a recipient-issued document; § 14(2): six months to issue in the cases there; small-amount invoices up to 250 EUR gross (§ 33 UStDV, *from memory*) | 2026-10-04 (secondary) |
| Germany: retention and e-invoicing, search results only (BEG IV in force 1 January 2025: booking vouchers **8 years** under § 147(3) AO and § 14b UStG; structured e-invoice for domestic B2B: receiving since 2025, issuing from 2027 above 800,000 EUR turnover and from 2028 for all; B2C and invoices up to 250 EUR excluded) | retention seed; the e-invoice mandate is **not built** (section 7) | 2026-10-04 (secondary) |
| Directive Art. 220 (invoice obligations), 91 (conversion rate), 63 and 65 (chargeable event), 226b (simplified invoice content), Art. 33 (distance sales) | the obligation to invoice a private buyer is mostly national (the Directive's Art. 220 covers supplies to taxable persons and legal persons, distance sales and advance payments), the rate mechanism, the date of supply, the simplified invoice | **not read** (from memory: *verify*) |
| National acts for NO, SE, DK, DE beyond the pages above (merverdiavgiftsloven, mervärdesskattelagen 17 kap. in full, momsloven in full, UStG § 14c, GoBD) and every other member state | everything outside the four countries; the exemption references per country and category; the date and rate for conversion in each | **not read** |

The foundation agent reads the primary sources again when it freezes `src/lib/invoice-snapshot.ts` and `src/lib/invoice-text.ts`, writes the URL and date into
each rule's comment, and does not rely on a summary for a statutory phrase. A value it cannot source is not asserted: it is a visible `needs review` flag.

### 1.4 Refinements of `docs/wave-1.md` 1b found by reading the code

None changes what the unit delivers; each makes the outline buildable or safe. The lead confirms them before the run starts.

1. **The payment is not "captured" when the invoice is issued.** `applySession()` calls `complete_order_payment()` first and `setPaymentStatus(... 'captured')`
   after it; `confirmAtVenue()` has a *pending* venue payment; a renewal inserts its payment captured before. So the invoice's payment section is read from the
   order's payment rows whatever their status except `failed` and `cancelled`, and the paid-on date is the transaction's store day, not a payment timestamp.
2. **A payment in Stripe's test mode never gets a legal invoice** (new rule, `test_mode` in 3.5). New stores take test payments with no setup (D20): a number from
   the legal series spent on a test order would leave the owner's first real invoice at number 37. The mode is read from `commerce.connected_accounts` for a
   Stripe payment, and from `payment_providers.active_mode` for a venue payment. The order page says "test order: no invoice". A payment with no known account
   is treated as live, so a missing row can only produce an invoice, never lose one.
3. **Invoicing has a switch, on for new stores and off for stores that already have real history** (`invoice_settings.enabled`, 3.1). The migration sets `enabled =
   false` for a store with at least one non-copied order that has an `order.paid` event, and `true` for every other store; the owner turns it on at
   `/admin/{store}/settings/invoices` once the readiness list is clear, and invoices are issued **from then on** (`enabled_from`), never backdated for earlier
   orders (offering that is a later piece, section 7). Reason: switching a legal numbering series on for stores that sell today, with their details unreviewed,
   would print documents nobody agreed to. The tests turn it on in their fixtures.
4. **A store that says it is not VAT-registered, whose order nevertheless charged VAT, gets no invoice.** Unit 1a charges the destination country's VAT whatever the
   registration says (it warns on the tax screen). A non-registered seller may not state VAT on an invoice (Denmark's momsloven § 52 a, read; the same principle
   is general). So `vat_registered = false` with `tax_minor > 0` makes the order **wait** with the reason `vat_charged_not_registered`, and the admin says
   what to do (correct the tax profile, or ask the accountant). A non-registered store whose order carries no VAT gets an invoice that says so.
5. **Series prefix defaults.** `docs/wave-1.md` says `F-` and `K-`. Production's series rows were created by `initialise_store()` as `INV-` and `CN-`, never used. The
   migration changes the prefix of every store's unissued `invoice` and `credit_note` series from the old defaults to `F-` and `K-` (the D141 guard allows a prefix
   change before the first number is issued), and replaces `initialise_store()` so new stores get them. The owner may choose any prefix (up to 10 characters of
   `A-Za-z0-9._/-`, the Work rule) and a first number, at the settings page, until the first document is issued.
6. **Credit note allocation uses the largest-remainder method, not "remainder to the largest bucket".** With the outline's rule, three buckets of 1 minor unit and a
   refund of 2 would put 2 in one bucket and break the cap. Section 4.6 defines the method (deterministic, never above a bucket's cap) and the pure function
   `creditAllocation()` holds it.
7. **A credit note has three possible sources, not one.** A succeeded refund (the rule), a **return refunded outside Kaizen** (D153: `refund_outside`, no refund row,
   section 2.6), and nothing else. Manual credit notes and a credit for a cancelled order that was never refunded are not built (section 7).
8. **The PDF is rendered from the same view, not by fetching the print page.** `renderToStaticMarkup()` of the document component is loaded into Chromium with
   `page.setContent()`, with every network request refused. No self-HTTP call, no session, no token in a URL, nothing to fetch (section 4.9). The print page is the
   same component and is the fallback.
9. **Binary attachments need one small change to email.** `deliver()` attaches a **UTF-8 text** file (`Buffer.from(content, "utf8")`), fit for a calendar file and
   not for a PDF. `OutgoingEmail.attachments` gains an optional `encoding: "base64"` (section 5.2). An email carries a link always, and the PDF only when it exists
   at send time and is at most 1 MB (a PDF is generated on demand, so most first confirmations carry the link, and the refund email of a return usually the file).
10. **`returns` stores the refund's working.** The credit note of a return needs the lines and the working (`refundFor()`, D153), which are not recoverable in SQL
    without repeating the cumulative rule. `record()` in `refundReturn()` writes the working it already holds into a new column `returns.refund_working jsonb`
    (section 3.2) in the same transaction as the refund.
11. **Refunds come from three places, and one of them does not exist yet.** The Stripe webhook handler ignores every refund event today, so a refund Stripe reports
    as `pending` stays pending for ever and a refund made in Stripe's dashboard is unknown to Kaizen. Section 2.6 enumerates every path and adds the handler.
12. **Decision number.** D156 to D158 are taken (wave spec, 1a, trust lane). This unit proposes **D159**; the lead renumbers at the merge.

---

## 2. Behaviour

Written so a tester can follow it. "Store day" is the store's calendar day in `stores.time_zone`. "Eligible" is defined once, in 2.1.

### 2.1 When an order gets an invoice

An order is **eligible** for an invoice when all of these hold (`commerce.invoice_eligibility(order)` returns the first that fails, a closed list of reason
codes; `src/lib/invoice-eligibility.ts` holds the same list and the words for each):

| Reason code | Meaning |
|---|---|
| `copied` | `copied_from is not null`: history copied from another store (D129), never invoiced |
| `host` | `host_id is not null`: the host is the seller (D71); the store does not invoice for it |
| `not_paid` | no `order.paid` event: pending, or cancelled before payment |
| `test_mode` | the order was paid in Stripe's test mode (1.4 point 2) |
| `disabled` | the store's invoicing is off, or the order was paid before `enabled_from` |
| `zero_total` | `total_minor = 0` (checkout does not place one today; nothing is invoiced for nothing) |
| `ok` | eligible |

An eligible order is then **ready** or **waiting** (`invoice_readiness`, a second closed list, in the same SQL function and its pure twin). It waits, and is issued
as soon as the cause is gone, when:

| Waiting reason | Cause | What the admin tells the owner |
|---|---|---|
| `seller_details` | `legal_name`, `postal_address`, `organisation_number` or `country` missing on the store; or the store is VAT-registered and the order carries a VAT number that is missing | "Complete your business details" with the field names, link to Company |
| `tax_profile_missing` | the store has no tax profile row, so it is not known whether it is VAT-registered | link to Tax |
| `vat_charged_not_registered` | 1.4 point 4 | link to Tax |
| `no_exchange_rate` | the seller's country needs the VAT in its own currency (4.5) and the store has no rate between the order's currency and it | link to Languages and currencies |

Never waiting, never refused: the payment. `complete_order_payment()` completes the order whatever the invoice does (2.7).

### 2.2 Shopper side

1. **Paying.** The shopper pays as today. In the same database transaction that marks the order paid, the invoice is numbered and frozen (4.1). Nothing on the
   checkout, cart or payment pages changes (the pay routes' CSP and import rules, section 5.4, are not touched).
2. **The order confirmation email** says "Your invoice {number}" with a button to the hosted invoice (`/s/{store}/{market}/account/documents/{token}`), and the
   PDF is attached only if it already exists (9 in 1.4). If the invoice is waiting, the email says nothing about it; when it is issued later the shopper gets a
   short email of its own (`invoice.issued`, once, idempotent), with the same link.
3. **The order page** (`/s/{store}/{market}/order/{orderId}`, reached with the order's key, or the signed-in owner's `account/orders/{orderId}`) lists the
   documents: "Invoice F-17, 4 October 2026 (PDF)" and under it each credit note "Credit note K-3, 9 October 2026 (PDF)", linking to the hosted page and its PDF. A test
   order says "Test order: no invoice". A waiting invoice says nothing to the shopper.
4. **The hosted page** `/s/{store}/{market}/account/documents/{token}` draws the document in the order's language (nb, sv, da or en; every other language shows
   English) in black on white, with **Download PDF** and **Print**. The token is the whole access (long, random, not indexed, no referrer, no cookie, no storage);
   it is the same for the shopper who is signed in and the one who is not. A token of another store, a malformed token, an anonymised document: the same 404.
5. **The PDF** (`.../documents/{token}/pdf`) is the same document as a file named `{document number}.pdf`, served `attachment`, `no-store`. Generated on the first
   download if it does not exist yet (a few seconds the first time), then stored and served from storage. If Chromium fails, the route redirects to the hosted page
   with `?print=1` (the browser's own print dialog saves a PDF) and nothing else is lost.
6. **A refund.** When a refund succeeds, a credit note is issued (2.5). The refund email (`order-refunded:{refundId}`, sent by the staff action or the return) links
   it and attaches the PDF when it exists; a refund that completes later (pending, or made in Stripe) gets the stand-alone `credit_note.issued` email.
7. **A business buyer.** The invoice's buyer block shows the company name, organisation number and the VAT number they typed, and a reverse-charge order says
   "Reverse charge" with both VAT numbers (4.3). The VIES answer and VIES's registered name and address are never printed (D157: staff only).
8. **Other currencies and languages.** The invoice is in the order's currency, whatever the shopper's view; where the seller's country needs the VAT in its own
   currency it says so with the rate (4.5). The language is the order's locale; `de`, `fi` and the rest show English (the four languages are hand-written; the others
   are not translated by machine, section 8).
9. **A shopper whose order has no invoice** (copied, host, test, switched off, waiting) sees no invoice section and no error.
10. **No new cookie, no storage item, no third-party request** on any shopper page or route of this unit (`KNOWN_COOKIES` unchanged; the hosted page sets nothing).
    **The hosted page draws none of the market layout's extras** (review fix): its address is the whole access to a buyer's document, and the consent banner's tracking tools and the owner's own code read `location.href`, so `isDocumentPath()` (`src/lib/pay-routes.ts`) puts `/account/documents/{token}` (and `/pdf`, on either shape of address) beside the pay routes in `isNoExtrasPath()`: `OffPayRoutes` draws no `MarketExtras` (no banner, tracking, owner code, chat, referral capture or popup) there, the page renders `PayRouteGuard` so it is entered by a full page load, and `PayDocumentWatcher` treats it as a route that no earlier script may have been loaded on. It is not a pay route (no card, no policy of its own). `placeOfPath()` already keeps no token (`(other)`).

### 2.3 Staff side (store)

All admin pages and actions call `requirePermission()` or `checkPermission()` with the key shown (5.4); a member without it gets a 404 or the refusal "You do not
have access to this."

- **`/admin/{store}/invoices`** (Orders section, `orders:read`): three tabs. *Invoices* and *Credit notes* list number, date, order (link), buyer name and country, net, VAT,
  total, currency, and a PDF link; search by document number, order number or buyer email; period filter in store days (default this month); paged. *Waiting*
  lists the eligible orders with no invoice and the reason in words (2.1) with the link that fixes it, and a **Check again** button (`orders:write`) that runs the
  same job the five-minute cron runs for this store; a count appears in the Orders section's tab and on the store Home alerts (`taxAttention`-style). Credit notes
  *waiting* (a succeeded refund with no note, which should never last) are listed on the same tab with the failure.
- **Reprint:** each row has *View* (the hosted view, admin chrome-free, `/admin/{store}/invoices/{id}/print`, `orders:read`) and *PDF*. A staff reprint is the same stored
  file, never a new rendering, so it cannot differ from what the shopper got.
- **CSV export for the accountant** (`/admin/{store}/invoices/export?type=invoices|credit_notes&from=&to=`, `orders:write` because it holds personal data, audit-logged
  as `invoice.exported`): one row per document: number, issue date, supply date, order number, document type, buyer type, buyer name, buyer country, buyer VAT number,
  currency, net, VAT, gross, then **VAT per rate** as paired columns for each rate present in the period (`vat_25_net`, `vat_25_vat`, ...), the VAT in the seller's
  currency and the rate used, the treatment (`standard`, `reverse_charge`, `ioss`), and for a credit note the invoice it credits. Amounts as decimals with a point.
  Every text cell goes through `toCsv()`, which neutralises formulas (a name starting with `=`, `+`, `-`, `@` or tab is prefixed).
- **The order page** (`/admin/{store}/orders/{orderId}`) gets a *Documents* card: the invoice (number, date, links), each credit note, or, when there is none, the
  reason in words and what to do. A staff member with `orders:write` can send the invoice or a credit note to the shopper again (the order's own address, never an
  address typed in; same rule as D153), which writes `invoice.emailed` to the order's history.
- **`/admin/{store}/settings/invoices`** (Settings > Selling, **owner only**, `owner` key like the tax page): the switch; the readiness list (what is missing, with
  links); the series prefix and first number for each series **until the first document of that series is issued**, after which they are shown and locked ("numbers
  already issued cannot be changed"); the footer note printed on every invoice and credit note (up to 1,000 characters, the store's main language, for example the
  bank details or a returns address; text only); whether the confirmation email carries the invoice (default yes); and a note that **Stripe's own invoice option is
  ignored while Kaizen's invoicing is on** (`payment_providers.order_invoices` is not read by `startCheckout()` then, and the Payments page greys the option and says
  why). Saving audit-logs `invoice.settings_updated` with the field names.
- **Customers' page** (`/admin/{store}/customers/{id}`, if it lists orders) links nothing new; the documents are on the order.

### 2.4 Platform side

Platform admins have no screen for a store's invoices (a store's documents are the store's; there is no cross-store view, and the platform's own *Kaizen billing invoices*
at `/admin/platform/stores/{store}/invoices/{invoiceId}` are unrelated and untouched). What the platform gets: the plan comparison row (5.5), `store_checkup` findings
(`invoice_numbers_broken`, `invoices_waiting`, `credit_note_missing`, from `commerce.document_audit()`), and the health of the PDF routes in the host's logs.

### 2.5 The credit note, as a tester follows it

A credit note is issued when a refund **succeeds** (4.6). Ten situations, each a test in section 6:

1. Staff refund part of an order through the order page (`refundOrder()`, Stripe answers `succeeded`): one credit note, allocated over the invoice's rate buckets in
   proportion to what is still uncredited, restock lines are not part of it.
2. Staff refund all that is left: a credit note that brings every bucket to exactly zero uncredited (no residue by rounding).
3. A second partial refund: allocated over what the first left, never above it.
4. A **return** (D153) refunded: one credit note whose lines are the returned lines, each at its own VAT rate, with the deductions for diminished value, the delivery
   given back and the return shipping the shopper pays as their own rows, and an adjustment row when staff raised the amount (the reason is not printed; it is in the
   audit and the order history).
5. A refund Stripe reports `pending` (a bank method): no credit note yet; when the Stripe event `refund.updated` brings `succeeded`, the handler updates the row and the credit
   note is issued then, and the shopper gets the stand-alone email.
6. A refund made in Stripe's dashboard (no Kaizen row): the `refund.created` event inserts it (`created_by` null, an `order.refunded` event with actor `stripe`), and the
   credit note follows.
7. A refund Stripe reports `failed`: no credit note, and the order's refundable amount is as before (the row is kept as today).
8. A refund of an order whose invoice is **waiting**: nothing now; when the invoice is issued the same job issues the credit notes of the refunds that succeeded meanwhile, in
   the order the refunds were made.
9. A refund of a host's, copied, test-mode or invoicing-off order: no credit note (no invoice exists).
10. A return **refunded outside Kaizen** (`refund_outside`, an order paid some other way): the credit note is issued from the return when staff record the refund, source
    `return_outside`, with the same working.

**A refund of a payment that is not on the invoice** (review fix: a no-show fee charged afterwards, D65, refunded in Stripe's Dashboard) reverses no sale and gets **no** credit note: `commerce.payment_on_invoice()` says a payment is the invoice's when it was made no later than the invoice and no `booking.no_show` order event names it; for any other payment `make_credit_note()` writes the order event `credit_note.not_invoiced` (once, with the refund's id) and returns null, and the retry job, the Waiting tab and the checkup leave it alone.

A credit note is never issued above what the invoice left uncredited per rate. If a refund is larger than that (a refund of a no-show fee, which is a payment beyond the
invoice, section 7), the credit note covers what is left and the rest is reported as `credit_note_short` on the Waiting tab and in `store_checkup`; the refund itself is never
held back by documents.

### 2.6 Every path by which a refund reaches `succeeded` (the enumeration the foundation, server and review agents hold themselves to)

The credit note is issued by **one database mechanism**, not by each caller: a deferred constraint trigger on `commerce.refunds` (`AFTER INSERT OR UPDATE OF status`, `WHEN
(NEW.status = 'succeeded')`, `DEFERRABLE INITIALLY DEFERRED`) and a second one on `commerce.returns` for the outside case. Deferred means it runs at commit, after the caller
has written everything else in the same transaction (in particular `returns.refund_id` and `returns.refund_working`, written by `record()` after the refund row). Any code,
present or future, that makes a refund succeed therefore gets a credit note without a call. The paths today:

| Path | Where | Status written | Credit note |
|---|---|---|---|
| P1. Staff refund on the order page | `refundOrder()` from `orders/actions.ts` | the status Stripe returned: `succeeded`, `pending` or `failed` | at commit if `succeeded` |
| P2. Cancel a paid order | `cancelOrder()` → `refundOrder()` | as P1 | as P1 |
| P3. A shopper cancels a booking | `booking-changes.ts` → `refundOrder()` | as P1 | as P1 |
| P4. The AI manager's refund (gated) | `owner-tools.ts` → `refundOrder()` | as P1 | as P1 |
| P5. A return's refund (D153) | `refundReturn()` → `refundOrder()` with `inTransaction: record` | as P1 | at commit, with the return's working |
| P6. A pending refund completes | **new** `refund.updated` webhook handler | `pending` → `succeeded` or `failed` | at commit if `succeeded` |
| P7. A refund made in Stripe | **new** `refund.created` webhook handler | inserted with Stripe's status | as P1 |
| P8. A return refunded outside Kaizen | `refundReturn()` with `outside` (no refund row, amount 0) | none | the `returns` trigger, source `return_outside` |
| P9. A restock-only call (amount 0) | `refundOrder()` | no refund row | none (nothing was refunded) |
| P10. Test fixtures and direct SQL | `analytics-insights-fixture.ts`, tests | any | by the trigger; fixtures that do not want one use an order with no invoice |

**Events out of order** (review fix): Stripe does not promise order, and Kaizen refuses the first `refund.created` of its own refunds on purpose, so a `pending` snapshot can arrive after the row is final. `applyStripeRefund()` therefore never moves a row to `pending` (the first state), and writes `refund.reversed_after_success` only when the event says `failed` and Stripe, asked with `refunds.retrieve()`, still says so (when it cannot be asked the event stands). **A staff retry** after Stripe accepted a refund whose row was not written: the idempotency key (`refundKey()`) counts only the refunds a person at Kaizen made (`isAdoptedRefund()` rows, written by the webhook, are not counted), so the retry replays the same Stripe refund, and `refundOrder()` claims the row the webhook wrote (`on conflict (store_id, provider_reference)`, setting reason, restock and `created_by`) instead of failing or refunding twice.

A status never goes back: a database rule (`refunds_succeeded_final`) refuses `succeeded` → anything else, so a note is never left standing for a refund that stopped existing. A
Stripe report that a refund failed after it succeeded is written as the order event `refund.reversed_after_success` and shown in `store_checkup`; it changes no status (7).

### 2.7 Failure behaviour

- **The invoice never stops a payment.** `issue_order_invoice()` runs inside a sub-block (`BEGIN ... EXCEPTION WHEN OTHERS`): on any error its own writes, including the number
  it took, are rolled back to the block's start (so the series stays gap-free), the order event `invoice.failed` records the error text, and `complete_order_payment()` carries on and
  returns true. The order then **waits** (`invoice_failed` in the queue); the five-minute job retries, and `store_checkup` counts the failures.
- **A credit note never stops a refund.** The deferred trigger wraps its work the same way; on error it writes `credit_note.failed` to the order's history and the refund stands. The
  job `issueMissingCreditNotes()` finds succeeded refunds with no note and retries them.
- **Chromium failing** never fails anything: 2.2 point 5; the failure is counted in `document_pdf_state` and logged; the five-minute job retries up to 5 times, then stops and the
  Waiting tab shows "PDF not made" with a *Try again* button.
- **Storage failing** while storing the PDF: the file is served from memory for that request and not recorded (`pdf_path` stays null); nothing is lost, the next request tries again.
- **Email failing** never undoes a document; the document is shown on the order page regardless, and the job sends the stand-alone email again (idempotent by key).
- **A webhook arriving twice** or out of order: `recordEvent()` deduplicates; the refund handler is idempotent by `provider_reference`.

### 2.8 Copied orders, host orders, other kinds, other currencies

- **Copied orders** (`C-…`, D129): never invoiced, never credited (the database refuses: eligibility `copied`, and the issue guard re-checks). `copy_orders()` copies no document and no
  `invoice_*` data; a copied order's page shows none.
- **Host orders** (D71): never invoiced by the store; their refunds make no credit note.
- **Subscriptions.** The first order is invoiced when its checkout payment completes; each paid renewal is a new order and is invoiced when its payment is recorded (the renewal calls
  `complete_order_payment()` in the same transaction as the payment). A renewal has no `vat_treatment` (it is placed by the webhook), so the seller's number comes from the live tax
  profile at issue and is frozen in the snapshot, and a renewal never reverse-charges (D157). **A free-trial start** (D29): the first order's recurring lines are not charged until the
  first renewal, which will be its own order and invoice; they are listed as `deferred` in the snapshot and **left out of the invoice's totals**, so the invoice equals what is due now.
  *Open: `placeOrder()` is read to confirm which lines a trial leaves unpaid (selling plan with `trial_days > 0`); the foundation agent proves it with a scenario before the rule is frozen.*
- **Standing deliveries** (D102): the order waits for payment until sent; it is invoiced when `chargeDelivery()` or the pay link completes it.
- **Bookings.** An appointment, stay or rental line shows its date and time (or nights) from `bookings`; its supply date is the booking's date, not the payment day. A stay or rental's
  quantity on the invoice is the nights, days or hours (`booked_count`) at the unit price (the order line is one booking at its whole price, so the invoice shows quantity 1 and the
  nights in the description, as the order page does). **Paid partly at the venue** (D66): the invoice is for the whole total and shows two payment lines, "Paid online" and "To pay at the
  **A booking left wholly for the venue** (review fix): nothing was paid, so the document asserts no payment. The snapshot keeps `order.paidOn` and `supplyDate` (the confirmation day) as data, but `OrderDocumentView` prints the *Paid online* date and the *Date of supply* only when a `paid_online` payment is in the snapshot's `payments`; otherwise the note under the totals is `supplyDateNoteVenue` ("booked services show their own dates") and the only payment line is "To pay at the venue". The last row of every invoice is a neutral *Total* (never "Total to pay": the sale is paid or its balance is the venue payment line).
- **A seller not registered for VAT** (review fix; Denmark's momsloven 52 a, read, forbids stating VAT or that an amount includes it): `hidesVat()` in the view (`seller.vatRegistered` false or the `not_registered` statement) draws the lines, the credit rows and the totals without rate, VAT amount, VAT table, ex-VAT/incl.-VAT headings or VAT in the seller's currency (one amount per row and one total), with the not-registered sentence. The other countries' acts were not read: the review list (section 8, item 10) names it.
  venue" with the balance; when staff mark the balance paid nothing changes on the invoice (no new document).
- **Digital goods and fees.** Downloads and sign-up fees are lines like any other (`delivery = 'digital'`, sku `SIGNUP-FEE`); a gift line (campaign) is shown at its list price with its
  whole discount and nets to zero.
- **Reverse charge and IOSS** (D157): 4.3.
- **Currency.** The order's currency; the buyer-facing amounts never change. The seller's-currency VAT line follows 4.5. A currency with no rate to the seller's currency waits
  (`no_exchange_rate`) when the law needs the line, and is simply not shown when it does not.

---

## 3. Data

All new tables live in `commerce` (private), have row-level security enabled with no policy (as every commerce table), are in `src/db/schema.ts` (migration by `pnpm db:generate`), and
every foreign key has an index. Money is integer minor units plus an ISO code. Rates are `numeric` fractions as everywhere (`0.2500`).

### 3.1 Settings

`commerce.invoice_settings (store_id uuid pk fk stores, enabled boolean not null default true, enabled_from timestamptz null, footer_note text null check (length <= 1000), email_with_confirmation
boolean not null default true, updated_at, updated_by uuid null fk accounts)`.

- A row is created lazily on first save; absence means `enabled = true` and `enabled_from = null` for a store the migration did not mark, so the migration inserts a row with `enabled = false` for every
  store with a non-copied paid order (1.4 point 3). `enabled_from` is set to `now()` whenever `enabled` goes from false to true, and cleared when it goes false.
- `COPY_RULES`: **`settings`**, note "Invoicing switch and footer note; a copy starts enabled with no start date; the series are never copied." `duplicate_store()` copies `footer_note` and
  `email_with_confirmation`, sets `enabled = true`, `enabled_from = null`. `clone_store()` copies nothing (row created lazily).

### 3.2 Documents: the existing tables, extended

`commerce.invoices` and `commerce.credit_notes` exist since the first schema (D141 guards the numbers; both are empty in production, and the migration **raises** if either holds a row, so the
`not null` columns below need no back-fill).

**`invoices`** (new columns): `kind text not null default 'order'` (check `in ('order')`), `issued_on date not null` (the store day of issue), `supply_date date not null` (4.2),
`locale text not null`, `net_minor bigint not null`, `vat_kind text not null` (the order's: `standard | reverse_charge | ioss`), `vat_home_currency char(3) null`, `vat_home_minor bigint null`,
`fx_rate numeric(18,8) null`, `fx_as_of date null`, `fx_source text null` (`ecb_auto | owner`), `snapshot jsonb not null`, `public_token text null unique` (null only once anonymised: the check says `anonymised_at is null` with a well-formed token, or set with none), `pdf_path text null`,
`pdf_sha256 text null`, `anonymised_at timestamptz null`. Existing: `id, store_id, order_id, series, number, document_number, currency, total_minor, tax_minor, issued_at`.
Constraints: `unique (store_id, order_id)` (**one invoice per order**), `series = 'invoice'`, `total_minor = net_minor + tax_minor` unless `vat_kind = 'reverse_charge'` (then `tax_minor = 0` and `total_minor =
net_minor`), `total_minor > 0`, `vat_home_minor` and `fx_rate` both null or both set, `public_token` well-formed unless anonymised (`^inv_[A-Za-z0-9_-]{43}$`), `(pdf_path is null) = (pdf_sha256 is null)`, `jsonb_typeof(snapshot) = 'object'
and snapshot ->> 'version' = '1'`.

**`credit_notes`** (new columns): `source text not null` (check `in ('refund', 'return_outside')`), `return_id uuid null` (fk `(store_id, return_id)` to `returns`), `issued_on date not null`, `locale text not
null`, `net_minor bigint not null`, `vat_home_currency`, `vat_home_minor`, `fx_rate`, `fx_as_of`, `fx_source` (copied from the invoice: a credit note is converted at the invoice's rate, 4.5), `snapshot jsonb not
null`, `public_token text null unique` (`^crn_...`, null only once anonymised), `pdf_path`, `pdf_sha256`, `anonymised_at`. `refund_id` is already there and stays nullable only for `return_outside`.
Constraints: `unique (store_id, refund_id)` where not null (**one credit note per refund**), `unique (store_id, return_id)` where `source = 'return_outside'`, `series = 'credit_note'`, `(source = 'refund' and refund_id is not null
and return_id is null) or (source = 'return_outside' and return_id is not null and refund_id is null)`, `total_minor > 0`, `total_minor = net_minor + tax_minor` (the credit note of a reverse-charge invoice has `tax_minor = 0`).

**`returns`**: `refund_working jsonb null`, written once by `record()` in the refund's transaction: `{ lines: [{ lineId, quantity, valueMinor, deductionMinor }], deliveryMinor, returnShippingMinor, adjustmentMinor,
amountMinor, outside }`. A check refuses a change once `refund_minor` is set.

**`document_series`** (existing): prefix defaults (1.4 point 5). One new function, `commerce.set_sales_series(store, series, prefix, next_number)`, for `invoice` and `credit_note` only, which refuses once a document of the
series exists (the D141 trigger `sales_series_guard()` already refuses it; the function gives the message). Every function that issues a number uses `next_document_number()` in the issuing transaction.

**`commerce.document_deliveries (id uuid pk, store_id, document_type text check in ('invoice','credit_note'), document_id uuid, email_message_id uuid fk email_messages, created_at)`**: which email carried which
document, so the stand-alone email is sent only for a document no earlier email carried. `unique (store_id, document_type, document_id, email_message_id)`. `COPY_RULES`: `never` ("Which emails carried which of the
original's documents").

**`commerce.document_pdf_state (store_id, document_type, document_id, attempts int not null default 0, last_attempt_at timestamptz, last_error text check (length <= 200), primary key (store_id, document_type, document_id))`**:
the only mutable table of the unit; it holds no personal data. `COPY_RULES`: `never` ("Render attempts of the original's documents").

`COPY_RULES` for the existing tables stay as they are (`invoices: never`, `credit_notes: never`, `document_series: never`), and `src/db/commerce.test.ts` already fails when a table with a `store_id` is missing there.

**The storage bucket** `documents` (private, no public policy) is created by the rules migration in the pattern of the `digital-files` bucket (`DO` block, only when the `storage` schema exists). Object path
`{store_id}/invoices/{invoice_id}.pdf` and `{store_id}/credit-notes/{credit_note_id}.pdf`. Only server code with the service key reads or writes it, through `src/server/invoice-pdf.ts`.

### 3.3 What the database itself enforces (and the tests that hold each)

1. **Immutability.** `invoices_append_only` and `credit_notes_append_only` (`forbid_change()`) are replaced by `guard_document_change()`: an `UPDATE` is refused unless it sets `pdf_path` and `pdf_sha256` from null
   to a value **once**, or is the anonymisation (3.6, a transaction-local setting `commerce.anonymising` that only `anonymise_expired_documents()` sets). A `DELETE` is always refused (`restrict_violation`).
2. **No insert except by the issuing functions.** A `BEFORE INSERT` trigger refuses a row unless the transaction-local setting `commerce.issuing_document` names the order (invoice) or refund/return (credit note), which only
   `issue_order_invoice()` and `issue_credit_note()` set (as `commerce.work_issuing`). Application code cannot insert a document, and a source scan holds that no file under `src/` contains `insert into commerce.invoices`
   or `credit_notes`.
3. **Gap-free numbers.** `next_document_number()` in the issuing transaction (a rolled-back transaction, or the failure sub-block of 2.7, gives the number back); `sales_series_guard()` (D141) refuses a prefix change, a
   skip, a lowering or a delete once a document is issued; `commerce.document_audit(store)` returns, per series, the count, first and last number, how many numbers are missing, `off_format`, and whether the next number follows
   (`ok`), as `order_number_audit()` does.
4. **One invoice per order, one credit note per refund**, by the unique constraints above.
5. **Copied, host, test-mode and unpaid orders refused** by the issuing function and re-checked by the insert guard (`orders.copied_from is null and host_id is null`).
6. **Credit never above invoice.** A `BEFORE INSERT` trigger on `credit_notes` sums, per VAT rate bucket, the net, VAT and gross of the invoice's earlier credit notes plus this one and refuses if any exceeds the invoice's bucket
   (`credit_note.over_invoice`). It reads the buckets from the two snapshots, so it needs no extra table.
7. **Frozen snapshot, matching columns.** A `BEFORE INSERT` check recomputes `net_minor`, `tax_minor`, `total_minor` from `snapshot.buckets` and refuses a mismatch (`document.totals_mismatch`); the invoice's total equals the order's
   total less deferred trial lines (`invoice.total_not_order`).
8. **A refund's `succeeded` is final** (`refunds_succeeded_final`, 2.6), and `returns.refund_working` is write-once.
9. **Every function sets `search_path = ''`**. **No function contains `DELETE`, `TRUNCATE` or `DROP`** (the production migration tool cancels them); the unit has no SQL that deletes. The storage object of an anonymised document is removed by application
   code (3.6).

### 3.4 The snapshot (the document's whole content, frozen)

`snapshot` is JSON, `version: 1`, defined by the TypeScript type `OrderInvoiceSnapshot` in `src/lib/invoice-snapshot.ts` (the pure builder `buildInvoiceSnapshot()` is the oracle the SQL is held to, 5.1).
The document is drawn **only** from it, never from live data. Fields, all in the order's currency unless said (amounts are integer minor units):

```
version, documentType: 'invoice' | 'credit_note', number: documentNumber, issuedOn, supplyDate (invoice), locale, language ('nb'|'sv'|'da'|'en'), currency,
seller: { legalName, organisationNumber, vatRegistered, vatNumber|null, address (the store's postal address, text), country, email, footerNote|null },
buyer:  { type: 'consumer'|'business', name, company|null, organisationNumber|null, vatNumber|null (the buyer's, only when the treatment is reverse charge, 4.3),
          address: { line1, line2, postalCode, city, country }, email, complete: boolean },
order:  { number, placedOn, paidOn, deliveryPlace: { city, country }|null },
lines:  [{ lineId, sku, title, kind: 'goods'|'download'|'service'|'booking'|'fee'|'gift', quantity, listNetMinor, discountNetMinor, netMinor, vatRate, basis, vatMinor, grossMinor,
           unitNetMinor (display, rounded: 4.1), serviceDate|null, service: { startsAt, endsAt, count }|null (local `YYYY-MM-DDTHH:MM` in the store's zone; replaces the outline's serviceDescription, which would have needed a language), wouldHaveRate|null (reverse charge) }],
shipping: { label, netBeforeMinor, discountNetMinor, netMinor, vatRate, basis, vatMinor, grossMinor, wouldHaveRate|null } | null,
discounts: [{ kind: 'campaign'|'member'|'code'|'credit'|'welcome', label|null, grossMinor }]   // informational, VAT-inclusive, as the shopper saw them
buckets: [{ rate, basis: 'standard'|'reverse_charge'|'exempt'|'ioss', netMinor, vatMinor, grossMinor }],     // the VAT per rate; the sum is the invoice
totals: { netMinor, vatMinor, grossMinor },
vatHome: { currency, vatMinor, fxRate, asOf, source }|null,  vatMain: { currency, vatMinor, fxRate|null }|null,   // 4.5; vatMain for unit 1c (fxRate null: the order is in the main currency)
treatment: { kind: 'standard'|'reverse_charge'|'ioss', reason, sellerVatNumber|null, buyerVatNumber|null, iossNumber|null, statements: ['reverse_charge'|'ioss'|'not_registered'|'exempt'...] },
payments: [{ kind: 'paid_online'|'pay_at_venue', amountMinor, provider }],
deferred: [{ lineId, title, grossMinor|null }],     // free-trial lines billed at the first renewal (2.8): a trial line is on the order with nothing to pay now, so the renewal price is not known and grossMinor is null
notes: ['buyer_incomplete', 'unit_price_rounded', ...]
```

A **credit note's** snapshot has the same seller, buyer, order, currency, language, and: `refersTo: { invoiceId, invoiceNumber, invoiceIssuedOn }`, `reason: { kind: 'refund'|'return', returnNumber|null }` (the document draws a fixed phrase in its language from `invoice-text.ts`, never the staff member's free text, which can hold personal remarks), `lines` of what is credited (a plain refund: one `refund` row per bucket with net, VAT and gross; for a return: the returned lines, one row per kind of working: *goods*, *deduction for diminished value*,
*delivery given back*, *return shipping*, *adjustment*, each with its gross only, since the VAT is the buckets'; an *adjustment* row also shows what the working could not put where it belongs: a staff-raised amount, or a return shipping at a rate with nothing returned), `buckets`, `totals`, `vatHome` (converted with the invoice's rate), `source`, and the cumulative position `invoiceTotal / creditedBefore / creditedNow / leftOnInvoice`.

**What unit 1c reads** (stable contract): the columns `invoices.net_minor/tax_minor/total_minor/currency/issued_on/vat_kind/vat_home_minor/fx_*`, `credit_notes` likewise plus `source`, `invoice_id` and `refund_id`, and from the
snapshot only `buckets[*]` (`rate`, `basis`, `netMinor`, `vatMinor`, `grossMinor`), `treatment.kind`, `vatMain` and `order.number`. 1c never reads a buyer's personal field.

### 3.5 What is private

Documents hold personal data (a buyer's name, address, email, company and VAT number). They are private: no document, token page or PDF is indexed (`robots: noindex`, `Referrer-Policy: no-referrer`, absent from the
sitemap, `llms.txt`, structured data, search, feeds, recommendations, the chat agent and every integration event); the AI manager's `list_invoices` shows numbers, dates and amounts, never a buyer's address; a source scan
(`document-readers.test.ts`, like `vat-readers.test.ts`) lists the modules allowed to read `invoices`, `credit_notes` and their `snapshot` and fails if another does. The VIES answer and VIES's registered name and address
are never in a snapshot. The Stripe invoice option's data is unaffected.

### 3.6 Retention and the hook of unit 1g

Documents are kept for the country's bookkeeping period, which unit 1g seeds as rows of `commerce.retention_rules` (this table is 1g's; until it exists the constants live in `src/lib/invoice-retention.ts`): **NO 5 years**
(bokføringsloven § 13, read), **SE 7 years** (bokföringslagen 7 kap. 2 §, snippet), **DK 5 years** (bogføringsloven § 12, snippet), **DE 8 years** (§ 147(3) AO and § 14b UStG as changed by BEG IV from 2025, search result), each
counted from the end of the calendar or financial year of the document, and **10 years as the fallback for any other country until a person has read its rule** (the longest of the four plus a margin: no document is
anonymised sooner than a rule says, and an unknown country is the safe side). Every row is flagged *needs review by an accountant*, with source and `checked_on`.

`commerce.anonymise_expired_documents(p_store uuid, p_before date) returns integer` is **built in this unit, not a stub**: for every invoice and credit note of the store with `issued_on < p_before` and no uncredited
open dispute it replaces the personal fields of the snapshot (`buyer.name`, `company`, `address`, `email`, `vatNumber`, `organisationNumber`, the delivery place) with the marker `"[removed]"`, sets `anonymised_at`,
nulls `public_token` and `pdf_path`/`pdf_sha256` (the transaction-local `commerce.anonymising` setting is the only exception to immutability) and writes the order event `document.anonymised`; it **refuses any `p_before` later
than `current_date - interval '5 years'`** (the shortest period of the four, a floor under a wrong rule) and never touches `net`, `vat`, `total`, numbers, dates, series, buckets or the seller. It contains no `DELETE`. The
application side, `anonymiseDocuments(storeId, cutoff)` in `src/server/invoice-retention.ts`, calls it and then removes the stored PDFs (`storage.remove`) for the rows it changed, because storage deletion cannot be SQL;
unit 1g's `runRetention()` calls this one function with the cutoff from its rules. Until 1g exists nothing calls it (a test calls it directly).

### 3.7 `clone_store()`, `duplicate_store()`, `copy_orders()`

`clone_store()` is patched (the `pg_get_functiondef` idiom of `20261002215352_returns_rules.sql`: one statement inserted before the last `RETURN`, idempotent by a `position(...)` check, raising loudly when the anchor is
missing, so this patch and the others compose in either order) only to give the new store its two series with the new prefixes if `initialise_store()` has not (it has: nothing to copy). `duplicate_store()` is patched for
`invoice_settings` (3.1). `copy_orders()` copies **no** invoice, credit note, token or snapshot, and its copied order has `invoice_eligibility = 'copied'`. `COPY_RULES` entries are added in `src/lib/store-copy-rules.ts`.

### 3.8 As built (foundation agent, 2026-10-04): what the migrations contain and where they differ from the text above

The three migrations are `20261004125309_order_invoices.sql` (generated; with a guard that raises when the document tables hold rows), `20261004125337_order_invoices_rules.sql` and `20261004125343_order_invoices_audit.sql`. Differences from, or additions to, what is written above (this file is the contract; these lines are its amendments):

1. **Functions come in two layers.** `commerce.make_order_invoice(store, order)` and `commerce.make_credit_note(store, refund, return)` do the work and raise on any problem (tests call them); `commerce.issue_order_invoice()` and `commerce.issue_credit_note()` wrap them in `BEGIN ... EXCEPTION WHEN OTHERS` and are what the payment, the triggers and the job call. A failure writes the order event `invoice.failed` or `credit_note.failed` (at most one an hour per order or refund, with `key` the refund or return id for credit notes) and returns null. `credit_note.short` (with `key`) is written once when a refund finds nothing left on the invoice or only part.
2. **`complete_order_payment()` is patched, not replaced**: the live definition is read with `pg_get_functiondef()` and one `PERFORM commerce.issue_order_invoice(...)` is put before the final `RETURN true` (the idiom of the returns migration), so a later patch to the function composes in either order. The same for `duplicate_store()` (copies `invoice_settings`) and `initialise_store()` (the `F-` and `K-` prefixes).
3. **The queue is SQL**: `commerce.waiting_invoices(store)` returns the eligible orders without an invoice with `reason` (a waiting reason, or `invoice_failed` when nothing is in the way); `commerce.issue_waiting_invoices(store, limit)` issues them and then calls `commerce.issue_missing_credit_notes(store)`, which makes the notes of succeeded refunds (and outside returns) that have none, in the order the refunds were made. These two are what `issueWaitingInvoices()` and `issueMissingCreditNotes()` in `src/server/invoice-issue.ts` call.
4. **Helpers** the server needs: `commerce.invoice_eligibility(order)`, `commerce.invoice_readiness(order)`, `commerce.fx_factor(store, from, to)`, `commerce.main_currency(store)`, `commerce.fx_as_of(store, a, b)`, `commerce.store_day(store, timestamptz)`, `commerce.document_audit(store)`, `commerce.set_sales_series(store, series, prefix, first)`, `commerce.expired_document_files(store, before)` (the stored PDFs `anonymiseDocuments()` removes after `commerce.anonymise_expired_documents(store, before)` has run), `commerce.new_document_token(prefix)`, `commerce.build_invoice_snapshot(order, issued_on, supply_date)` (the snapshot without its number).
5. **The seller's VAT number** is the order's frozen one when it has one, else the live profile's when the store is registered (a renewal has no treatment; an order placed before the store registered has no number in it). A registered store with no number waits (`seller_details`).
6. **Buyer type** is `business` when `company_name` is not blank (`commerce.nz()`), and the company is then printed.
7. **A line's net before discount** is `max(withoutVat(unit x quantity, rate), net)`, so a discount is never negative when the order's own VAT rounds differently by a minor unit; `ctid` order is the order of lines (an order line has no position column).
8. **Credit note rows and allocation of a return** (4.6) are as `src/lib/credit-allocation.ts` says: a bucket cannot go below 0 or above what is left; the difference is shared again by `distribute()` over the buckets that have room (those with something returned first) and shown as `adjustment` rows.
9. **`src/db/invoice-fixture.ts`** builds stores, orders (`placeOrder()`, as `placeOrder()` of the app writes them), payments, refunds and returns for the database tests; `src/db/invoice-parity.test.ts` holds `commerce.build_invoice_snapshot()` and `make_credit_note()` to `buildInvoiceSnapshot()` and `creditNoteSnapshot()` on 19 orders.
10. **Two existing tests were changed** because the contract forbids what they did: `src/db/commerce.test.ts` "keeps order events and invoices append-only" and "refuses an invoice against another store's order" inserted a document row by hand (the first with the old `INV-` prefix); they now make the row with the issuing function's setting (`insertInvoice()`) and the second expects the issuing guard's `document.order` (a document for an order of another store) as well as the composite foreign key.
11. **The only `DROP`s** are the two `DROP TRIGGER` statements that replace `invoices_append_only` and `credit_notes_append_only`, outside any function (3.3 point 9); the migration also drops the plain indexes `invoices_order_idx` and `credit_notes_refund_idx`, which the new unique constraints on the same columns make redundant (`DROP INDEX`, outside any function; the tables are empty).
12. **Review fixes (fourth migration `20261004152302_order_invoices_fixes.sql`, generated, with additions).** `payments.test_mode boolean not null default false` (schema column, `payments_venue_mode` BEFORE INSERT trigger: a venue payment takes the store's Stripe mode when it is made, so `invoice_eligibility()` reads a frozen mode and a store that goes live later never numbers a test order; existing venue payments take the store's current mode in the same file). In the rules migration, edited in place because it was not applied anywhere: `commerce.credit_vat_converted()` (4.5), `commerce.payment_on_invoice()` and the order event `credit_note.not_invoiced` in `make_credit_note()` (2.5), and `issue_missing_credit_notes()` leaving such refunds alone. No new `DELETE` or `DROP`.

---

## 4. Rules and law

Every rule sits in one pure function with its source in a comment, a test table, and *needs review by an accountant or lawyer*.

### 4.1 Amounts and rounding (the invoice from the order, to the minor unit)

All arithmetic is integer, in the order's currency, with the existing `vatIncluded(amount, rate) = round(amount × rate / (1 + rate))` and `withoutVat(amount, rate) = amount − vatIncluded(amount, rate)`
(`src/lib/checkout.ts`, `src/lib/b2b.ts`); nothing new rounds, and **nothing is recomputed from rates**: the VAT on a line is the `order_lines.tax_minor` that was charged, so the invoice equals the order to the minor unit.

- **A line.** `grossMinor = order_lines.total_minor` (after campaign, group, welcome, code and credit shares), `vatMinor = tax_minor`, `netMinor = grossMinor − vatMinor`, `vatRate = tax_rate`. The gross before discount is
  `unit_price_minor × quantity`; `listNetMinor = withoutVat(unit_price_minor × quantity, tax_rate)`; **`discountNetMinor = listNetMinor − netMinor`** (never negative, because `withoutVat` never decreases with its argument);
  the line's net before discount, the discount and the net after it therefore add up exactly. `unitNetMinor = round_half_up(listNetMinor / quantity)` is a display value; when `unitNetMinor × quantity ≠ listNetMinor` the snapshot says
  `unit_price_rounded` and the document footnotes it ("unit price rounded; the line amount is exact"). (Directive Art. 226 point 8 asks for the unit price excluding VAT; the line amount is what the VAT is computed on. *Needs review.*)
- **Reverse charge line.** The order stores the line net (`total_minor` already without the VAT, 1a) and `vat_relief_minor` = the VAT not charged; `vatMinor = 0`, `grossMinor = netMinor = total_minor`, `wouldHaveRate = tax_rate`. `listNetMinor`
  is `withoutVat(unit_price_minor × quantity, tax_rate)` as for any line (the VAT-inclusive price list is the shop's price), so `discountNetMinor` is computed by the same formula.
- **Shipping.** `shippingGrossMinor = orders.total_minor − Σ line.total_minor` (what was paid for delivery after any shipping discount and relief: the lines carry every other discount), `shippingVatMinor = orders.tax_minor − Σ line.tax_minor`,
  `shippingNetMinor = shippingGrossMinor − shippingVatMinor`, rate `orders.shipping_tax_rate` (the market's standard rate for an order without one, which 1a back-filled). `netBeforeMinor = withoutVat(orders.shipping_minor, rate)` and
  `discountNetMinor = netBeforeMinor − shippingNetMinor` (a free-shipping code shows as a shipping discount). A line is dropped when everything on it is 0.
- **Buckets.** One bucket per `(rate, basis)`: lines and shipping at the same rate and basis fall together; `basis` is `reverse_charge` for relieved lines (their rate is 0 on the document, with `wouldHaveRate` kept on the line), `exempt` for a product of category
  `exempt` (rate 0), `ioss` marks the order not the bucket (`treatment.kind`), `standard` otherwise. `Σ bucket.net = totals.net`, `Σ bucket.vat = totals.vat = orders.tax_minor`, `Σ bucket.gross = totals.gross = orders.total_minor` (less deferred).
- **Discounts block.** The informational list is built from `orders.member_discount_minor` (label `member_label`), `campaign_discount_minor` (`campaign_label`), `credit_minor` (bonus credits), `referral_discount_minor` (welcome discount) and the code's
  remainder, VAT-inclusive as the shopper saw them; it adds nothing to the totals.
- **Invariant tests** (section 6): invoice total = order total (less deferred), Σ invoice VAT per rate = the order's `tax_minor` grouped as `orderVatByRate()` groups it, Σ credit notes of an order = Σ succeeded refunds (capped), in every kind of product, with bonus credit, code, campaign and group discounts, a venue-paid booking, a subscription renewal and a reverse-charge order, **in the euro view** (an order in EUR in a NOK store).

### 4.2 Dates

- **Issue date** (`issued_on`): the store day on which the invoice is issued, which is the payment day unless the invoice waited. It is never backdated (Denmark: the issue date is the day the invoice is printed or made available, read; Norway: the date of documentation is the issue date).
- **Supply date** (`supply_date`): the store day of the payment for goods and downloads and fees; for a booking line the booking's own date (in the line's `serviceDate`), the document's header says "Date of supply: the payment date; booked services show their own dates". When the invoice waited, the
  supply date is still the **payment day** (the outline's rule), so an invoice issued a week after the sale says so. Directive Art. 226 point 7 asks for the supply date when it differs from the issue date; whether the payment day is the chargeable event for goods is **not read** (Art. 63, 65: *verify*; the outline's
  default stands).
- **Deadline.** Issued in the payment transaction, an invoice is always inside the Directive's 15th-of-next-month limit for intra-Community and reverse-charge supplies (Art. 222, read). A waiting invoice that would cross that day is shown **overdue** on the Waiting tab (a reverse-charge or intra-EU order waiting past the 15th of the next month, by the store's day), with the date. National limits for other supplies are not applied (*not read*).
- **A credit note's date** is the store day it is issued (the refund's success), and it names the invoice's number and date.

### 4.3 What an invoice carries (Directive Art. 226, and the four national lists)

Mapped to snapshot fields; **every row is what the pure builder includes and the document draws**.

| Content | Source of the rule | Where |
|---|---|---|
| Issue date; unique sequential number | Art. 226(1), (2); NO § 5-1-1(1), § 5-1-3; SE; DK § 58; DE § 14(4) | `issuedOn`, `number` (`documentNumber`, the series prefix and number) |
| Seller's full name and address | Art. 226(5); NO § 5-1-1(2); all | `seller.legalName`, `address` |
| Seller's VAT number; for Norway the organisation number followed by "MVA" when VAT-registered | Art. 226(3); NO § 5-1-2; DK CVR; DE tax or VAT number | `seller.vatNumber` (from the order's `vat_treatment.sellerVatNumber`, else the live profile for a renewal), `organisationNumber` |
| Buyer's full name and address | Art. 226(5); NO § 5-1-1(2); DK; DE § 14(4) | `buyer.*`; **see the rule below** |
| Buyer's VAT number when the buyer accounts for the VAT | Art. 226(4); SE | `buyer.vatNumber` only when `treatment.kind = reverse_charge` |
| Quantity and nature of the goods or extent of the service | Art. 226(6); NO § 5-1-1(3) | `lines[*].title`, `quantity`, `serviceDescription` |
| Date of supply, time and place of delivery when different | Art. 226(7); NO § 5-1-1(4) | `supplyDate`, `lines[*].serviceDate`, `order.deliveryPlace` |
| Taxable amount per rate, unit price excluding VAT, discounts | Art. 226(8); SE; DK | `lines[*]`, `buckets` |
| VAT rate and VAT amount payable | Art. 226(9), (10); NO § 5-1-1(6), § 5-1-5; SE; DK; DE | `lines[*].vatRate/vatMinor`, `buckets` |
| VAT in the seller's national currency when the invoice is in another | Art. 230; NO § 5-1-1(6); SE; DK § 97 | `vatHome` (4.5) |
| "Reverse charge" and both VAT numbers | Art. 226(11a), (3), (4) | `treatment` (the wording is `vat-text.ts`'s hand-written statement, nb "Omvendt avgiftsplikt", sv "Omvänd skattskyldighet", da "Omvendt betalingspligt", en "Reverse charge") |
| Exemption reference | Art. 226(11) | **not built** (section 7): an exempt line says "Exempt from VAT" and the statutory reference field stays empty with a visible review flag; the reference is per country and category and is data the platform does not hold yet |
| Not registered for VAT | DK § 52 a; general | `treatment.statements: ['not_registered']`, no VAT shown (1.4 point 4) |
| IOSS | Directive 2006/112/EC Title XII Ch. 6 (not read); D157 | `treatment.iossNumber`: "VAT collected under the Import One Stop Shop, IOSS number IM…" |
| Payment | NO § 5-1-1(5) (consideration and payment due date) | `payments`: paid online (amount) and, for a venue balance, "to pay at the venue (amount)"; there is no due date on a paid sale |
| Credit note: a clear and unambiguous reference to the invoice, what changed, VAT rate and amount, the reduction | Art. 219; SE; DK; NO | `refersTo`, `lines`, `buckets`, `totals` |

**Buyer details (a rule needing a lawyer).** Stripe Checkout collects a billing address only in part (`customer_details.address` often holds only country and postal code for a card) and a full shipping address only for
physical goods. The buyer block therefore uses: the billing address if it has a street line; else the shipping address; else the name, the email and the **country of the market** with `complete = false`
and the note `buyer_incomplete` (printed as nothing invented, and shown in the admin on the invoice's row). For a **business** order (`company_name` set) `startCheckout()` asks Stripe for `billing_address_collection: 'required'`
so a B2B invoice has a full address (Art. 226(5)). A full invoice to a consumer without an address is a legal question for each country (some allow a simplified invoice for small amounts: Art. 238, 226b, not read): the
document is titled *Invoice* in every case, the gap is flagged, and the review list (section 8) names it.

### 4.4 Reverse charge and IOSS on the invoice

The treatment is the order's (`orders.vat_kind`, `vat_treatment`), frozen in 1a; the invoice never decides VAT. `reverse_charge`: every line at rate 0 with `wouldHaveRate`, `vatMinor = 0`, the statement and both numbers (the buyer's
number is printed only here, so no other invoice carries a buyer's VAT number as a hidden field), total = net. `ioss`: the VAT is charged as always; the statement and the store's IOSS number are printed. A consignment above 150 EUR is not an IOSS sale (1a) and carries no
IOSS statement. A basket mixing a relieved line and a booking never reaches here as reverse charge (1a refuses it).

### 4.5 VAT in the seller's currency (and the main currency for 1c)

`homeVatRequirement(sellerCountry, orderCurrency)` (pure, `src/lib/invoice-snapshot.ts`) says whether the invoice must carry the VAT in the seller's country's currency: **no** when the order currency is that currency; **no** for a Danish seller invoicing in euro
(momsbekendtgørelsen § 97 as read: euro VAT is enough); **yes** otherwise (Directive Art. 230 read; NO § 5-1-1(6) and Skatteverket read; for every other country Art. 230 is the rule, *the national acts not read*). When required, `vatHome` is
`Σ over buckets of round_half_up(bucket.vatMinor × fxRate)`, so the document adds up, in `countries.currency` of the seller's country, with `fxRate` and `asOf` printed. The rate is the store's own rate table for the pair, derived from the store's euro-based
`store_currencies` rates (`convertMinor`, D109), **as of the rate's date** (`stores.rates_updated_at`, or the owner's), with `fx_source = 'ecb_auto'` when the store keeps its rates from the ECB and `'owner'` otherwise (the readiness list warns that an owner's own rate
needs the accountant; Directive Art. 91 and Skatteverket ask for the ECB or the national central bank's rate, and Norway's own rule for the rate is **not read**: *verify*). A credit note is converted **with the invoice's rate** (the reduction of the VAT
on the same supply). As **the difference of cumulative conversions per bucket** (`creditVatConverted()`, SQL `commerce.credit_vat_converted()`: convert(VAT credited so far including this note) − convert(VAT credited before it)), so the credit notes of an invoice add up to the invoice's converted VAT whatever the split (review fix; converting each note's parts on their own drifted by a minor unit or two); the same for `vatMain`. Every invoice also carries `vatMain` in `mainCurrency(store)` from the same rate (usually the same number); it is what unit 1c adds up.

### 4.6 Credit notes: when, how much, how allocated

- **When.** At the transition of a refund to `succeeded` (2.6), never for `pending` or `failed`. The note is dated the day it is issued (4.2) and refers to the invoice.
- **Cap.** Per rate bucket, `credited net`, `credited VAT` and `credited gross` over all the invoice's credit notes never exceed the invoice's (the database refuses, 3.3 point 6). A refund larger than what is left is credited up to what is left; the rest is `credit_note_short` (2.5).
- **A refund that is not a return** (`creditAllocation()`, `src/lib/credit-allocation.ts`, pure and mirrored in SQL): let `U_b` be the uncredited gross of bucket `b` (invoice gross − credited gross), `R` the refund (`R ≤ ΣU`, else capped). The share of
  bucket `b` is `floor(R × U_b / ΣU)`; the remaining minor units (fewer than the number of buckets) go one each to the buckets with the largest fractional part of `R × U_b / ΣU`, ties to the higher rate and then the lower index (largest-remainder method), so no share
  exceeds `U_b` and the shares sum to exactly `R`. In bucket `b` with share `s_b`: if `s_b = U_b` the VAT is the bucket's whole uncredited VAT, else `min(vatIncluded(s_b, rate_b), uncredited VAT)`; net is `s_b − VAT`. Hence two credits of 10 and 15 on a
  25 invoice leave exactly 0 uncredited with VAT adding up to the invoice's. A bucket of reverse charge or rate 0 is allocated like any (VAT 0).
- **A return** (D153): the credit note's lines are the working of `returns.refund_working`: for each accepted line, `valueMinor` at the line's own rate (`vatIncluded(valueMinor, rate)`; the last unit returns the remainder of the line's VAT, as `lineValue()` hands the remainder
  of the line's total, so a fully returned line credits exactly the line's VAT); *deductions for diminished value* are credit **reductions** at the line's rate (they reduce the credit, with the note printed as a row and its VAT effect); *delivery given back* at the shipping rate; *return shipping the shopper pays* a
  reduction at the shipping rate (**needs review**: whether the shopper's contribution to return postage is a separately taxed supply is **not read**; the default reduces the credited delivery); an *adjustment* (staff raised the refund) is allocated over the working's buckets by the same
  method; the sum is the refund's amount to the minor unit (a test holds `Σ credit = refund_minor`).
- **A return refunded outside** (source `return_outside`): the same, from `returns.refund_minor` and `refund_working`, issued when staff record it.
- **Reverse-charge invoice.** Its credit note carries the same statement and both numbers, VAT 0.
- **Immutable.** There is no edit and no void: a mistaken credit note is corrected by a further document (not built, section 7).

### 4.7 Who may do what

Owners and members with `orders:read` see and reprint documents; `orders:write` sends them again, exports CSV and presses *Check again*; **the invoicing settings are the owner's alone** (they change legal numbering). The shopper reaches only
the documents of their own order, by the document's token, the order's key, or being signed in as the order's customer. Platform admins have no access to a store's documents. Nobody can edit or delete a document; the only changes the database accepts are the
one-time `pdf_path` and the anonymisation (3.3).

### 4.8 Numbering and the series

`F-{n}` and `K-{n}` by default, no padding, starting at 1 or at the number the owner sets before the first issue (to continue numbers issued elsewhere, as Work's series). One series per document type per store, never shared with orders or Work. Locking: `next_document_number()` takes the series
row lock, and `issue_order_invoice()` takes it **last** (after the lines are read and the snapshot built), so payments of one store queue behind one short update, not behind the invoice's work.

### 4.9 The PDF

`renderInvoicePdf(document)` in `src/server/invoice-pdf.ts`: `renderToStaticMarkup(<OrderDocumentView snapshot=… />)` inside a minimal HTML shell with the document's `DOCUMENT_CSS`, loaded with `page.setContent(html, { waitUntil: 'load' })` after `page.route('**/*', route => route.abort())` (the document has no external
resource: no logo, no font, no image, system fonts only, so nothing is requested), `page.pdf({ format: 'A4', printBackground: true, margin: 16mm, preferCSSPageSize: true })`, closed in a `finally`, 20 s timeout. The browser is `launchBrowser()` from `src/server/browser.ts`, imported **only** by `invoice-pdf.ts`, the two PDF routes and the PDF cron route, and each of
them is added to `outputFileTracingIncludes` in `next.config.ts` (a glob: `"/s/**/account/documents/**/pdf"`, `"/admin/**/invoices/**/pdf"`, `"/api/cron/document-pdfs"`), checked in the build's `.nft.json`. The bytes are stored once at the path of 3.2 with their SHA-256; `pdf_path` and `pdf_sha256`
are set by the one allowed update, and a second renderer of the same document loses (the update matches `pdf_path is null`, the loser's file is removed). A per-document advisory lock (`pg_try_advisory_xact_lock`) stops two renders at once; a request that does not get the lock redirects to the print page.
Fonts: system sans, so a PDF differs in bytes between machines but never in content; the stored file is the one everybody gets.

---

## 5. Where things live

Areas: **foundation** (schema, migrations, database rules, pure libraries, their tests), **server**, **shopper**, **admin**, **analytics-and-ai**. An area edits only its own files; the registries are small edits by the area named, made at a known anchor.

### 5.1 Foundation

| File | What |
|---|---|
| `src/db/schema.ts` | `invoices`, `creditNotes` (columns of 3.2), `invoiceSettings`, `documentDeliveries`, `documentPdfState`, `returns.refundWorking` |
| `supabase/migrations/{ts}_order_invoices.sql` (generated by `pnpm db:generate`) and `{ts}_order_invoices_rules.sql` (custom: `pnpm exec drizzle-kit generate --custom --name order_invoices_rules`) | the empty-table check, columns and constraints; `guard_document_change()`; the insert guards; `invoice_eligibility()`; `issue_order_invoice()`; `complete_order_payment()` replaced (a full `CREATE OR REPLACE` of the **latest** definition, `20260924163034_digital_products_rules.sql`, plus one `PERFORM commerce.issue_order_invoice(v_order.store_id, p_order_id)` after the event insert and **before** the final `RETURN true`, the whole call being safe by 2.7); `issue_credit_note()`; `refunds_issue_credit_note()` and the two constraint triggers; `refunds_succeeded_final`; `set_sales_series()`; `document_audit()`; `anonymise_expired_documents()`; prefix defaults and `initialise_store()` replaced (latest definition: `20260929211920_work_rules.sql`); the `documents` bucket; the `invoice_settings` rows (1.4 point 3); the plan-feature row; `duplicate_store()` and `clone_store()` patches; the `audit_area_of()` replacement (a **new** migration, never an edit of a committed one) |
| `src/lib/invoice-snapshot.ts` | the types of 3.4, `buildInvoiceSnapshot()` (the pure oracle of 4.1), `homeVatRequirement()`, `vatHomeOf()`, `bucketsOf()`, rounding helpers; every rule with its source comment |
| `src/lib/credit-allocation.ts` | `creditAllocation()` (4.6), `returnCreditLines()` (the working into credit lines), `creditNoteSnapshot()` |
| `src/lib/invoice-eligibility.ts` | the reason codes of 2.1 in order, their words for staff and shopper, `invoiceFileName()`; the same list the SQL returns (a test compares the arrays) |
| `src/lib/invoice-readiness.ts` | `sellerReadiness(details, taxProfile)` (the missing fields), `waitingReason()`, the overdue day (4.2) |
| `src/lib/document-token.ts` | `newDocumentToken(kind)`, `isDocumentToken()`, `kindOfToken()` (`inv_`/`crn_` + 43 base64url characters from 32 random bytes) |
| `src/lib/invoice-text.ts` | the document's labels and statutory wording and the email sentences, **nb, sv, da, en by hand**, English for every other language, `// legal: needs review` in the module header and on each statutory string; kept out of `i18n.ts` and the AI catalogue (5.3) |
| `src/lib/invoice-csv.ts` | `invoiceCsv()`, `creditNoteCsv()`: columns of 2.3 through `toCsv()` |
| `src/lib/invoice-retention.ts` | the retention constants of 3.6 with source and `checked_on`, `retentionCutoff(country, today)`, `ANONYMISE_FLOOR_YEARS = 5` |
| `src/lib/audit.ts` | **registry**: `invoice.` → `orders` in `PREFIXES`; the exact `invoice.settings_updated` → `settings`; `credit_note.` → `orders`; `document.` → `orders`. Same entries in the SQL `audit_area_of()` of a new migration (the test that holds the two together fails otherwise) |
| `src/lib/store-copy-rules.ts` | **registry**: `invoice_settings: settings(...)`, `document_deliveries: never(...)`, `document_pdf_state: never(...)` |
| `src/db/invoices.test.ts` | the database tests of 6 |

### 5.2 Server

| File | What |
|---|---|
| `src/server/invoices.ts` | reads: `listInvoices()`, `listCreditNotes()`, `getInvoice()`, `findDocumentByToken()`, `getOrderDocuments(storeId, orderId)` (the one reader the order pages call), `waitingInvoices()`, `invoiceCounts()`; every query takes the store id |
| `src/server/invoice-issue.ts` | `issueWaitingInvoices(storeId)` (per waiting order calls `commerce.issue_order_invoice`), `issueMissingCreditNotes(storeId)`, `invoiceJobs()` for the five-minute job; never throws; returns counts |
| `src/server/invoice-settings.ts` | `getInvoiceSettings()`, `saveInvoiceSettings(membership, form)` (owners only, audit `invoice.settings_updated`), `setSeries(membership, ...)` through `commerce.set_sales_series()`, the readiness view |
| `src/server/invoice-pdf.ts` | `ensureInvoicePdf()`, `ensureCreditNotePdf()`, `renderPdf()` (4.9), `readPdf()`, `pdfJob()`; imports `src/server/browser.ts` and `@/components/documents/order-document-view` |
| `src/server/invoice-emails.ts` | `sendInvoiceNotice()` (`invoice.issued`, key `invoice:{id}`), `sendCreditNoteNotice()` (`credit_note.issued`, key `credit-note:{id}`), `documentLinks(order)` used by the order emails, `document_deliveries` bookkeeping; the PDF attached when it exists and is at most 1 MB |
| `src/server/invoice-export.ts` | `exportDocuments(storeId, type, from, to)` → CSV text |
| `src/server/invoice-retention.ts` | `anonymiseDocuments(storeId, cutoff)` (3.6) |
| `src/server/stripe-refunds.ts` | **new**: `applyStripeRefund(storeId, refund)` (P6, P7): idempotent by `provider_reference`; resolves the payment from `refund.payment_intent` (`checkout.sessions.list({ payment_intent })` on the store's account, then `payments.provider_reference`); inserts or updates; writes the order event; never regresses a status |
| `src/server/stripe-webhooks.ts` | **edit**: `handled` also matches `refund.created`, `refund.updated` (and `charge.refund.updated`), calling `applyStripeRefund()` |
| `src/server/stripe.ts` | **edit**: `WEBHOOK_EVENTS` gains `refund.created`, `refund.updated`; a helper (as `ensureSubscriptionEvents()`) adds the two events to the existing platform endpoint of each mode without replacing it, called once per mode from `startCheckout()` and from the new cron job (section 9.2: the lead also checks the endpoint in Stripe's Dashboard) |
| `src/server/checkout.ts` | **edit**: `startCheckout()` asks `billing_address_collection: 'required'` for an order with `company_name`; skips Stripe's `invoice_creation` when Kaizen invoicing is on for the store (`invoiceSettings.enabled`); nothing else. `complete_order_payment()` is the only place the invoice is issued |
| `src/server/returns.ts` | **edit**: `record()` also writes `returns.refund_working` (the working it already holds) in the same transaction; for the `outside` case it writes it with `refund_minor` |
| `src/server/order-admin.ts` | **edit**: none needed for issuing (the trigger does it); `getOrderAdmin()` gains nothing; the refund email calls `documentLinks()` |
| `src/server/shopper-emails.ts` | **edit**: the confirmation, shipped and refund emails add the document block through `documentLinks()`; `sendRefunded()` attaches the credit note PDF when it exists; `OutgoingEmail.attachments` gains `encoding?: 'base64'` in `src/server/email.ts` (`deliver()` uses it) |
| `src/server/store-checkup.ts` (and the file of the checkup findings) | **edit**: findings `invoice_numbers_broken`, `invoices_waiting`, `credit_note_missing`, `credit_note_short`, `refund_reversed_after_success`, `pdf_failing` from `commerce.document_audit()` and the queue |
| `src/app/api/cron/cart-reminders/route.ts` | **edit** (the five-minute job): `invoiceJobs()` (issue waiting invoices, missing credit notes, stand-alone emails). **No Chromium import** |
| `src/app/api/cron/document-pdfs/route.ts` | **new**, `CRON_SECRET`-checked like the others: renders up to 10 missing PDFs per run (`pdfJob()`); its own route so Chromium stays out of the others; scheduled by whatever schedules the five-minute job (9.2) |
| `next.config.ts` | **edit**: `outputFileTracingIncludes` for the three routes of 4.9 |

#### 5.2.1 As built (server agent, 2026-10-04): where the server differs from the table above

The table is the plan; these lines are what exists, and they amend it.

1. **Files.** `invoice-emails.ts` holds the document block of the emails and the `document_deliveries` bookkeeping and imports neither the shopper emails nor Chromium (so `shopper-emails.ts` and `return-emails.ts` can import it). The stand-alone emails are in `invoice-notices.ts` (`sendInvoiceNotice()`, `sendCreditNoteNotice()`, `sendDocumentAgain()`, `sendPendingDocumentNotices()`), which imports the shopper emails. The stored file is read and written only by `invoice-storage.ts` (`documentStorage()`, `readPdf()`, `pdfPathOf()`), which has no Chromium either, so the webhook and the emails can reach a stored PDF; `invoice-pdf.ts` alone renders. `document-html.tsx` is the one module that imports `react-dom/server` and `OrderDocumentView` (the surface's component, `src/components/documents/order-document-view.tsx`, props `{ snapshot }`, drawn for an invoice's or a credit note's snapshot): `documentHtml(snapshot)` is the HTML page the renderer loads. `invoice-issue.ts` holds `issueWaitingInvoices()`, `issueMissingCreditNotes()`, `retryPdfLater()` and `invoiceJobs()`.
2. **Who gets which email.** The confirmation and the shipped email carry the invoice (a link, and the PDF when it exists) unless the owner switched `email_with_confirmation` off; the refund email (staff) and the return's refund email carry the credit note of that refund or return. The stand-alone email goes for an invoice issued later than two minutes after its payment, and for a credit note that no earlier email carried when its refund was made by Stripe (`created_by is null`), completed later than two minutes after it was made, or already has an `order-refunded:{refund}` email that did not carry it (the credit note waited for its invoice); never for a refund staff made and chose not to tell the shopper about, and never sooner than two minutes after the note was issued, so the refund email has been sent and noted first. A refund that Stripe completes later is announced at once by `applyStripeRefund()` and again, idempotently, by the job.
3. **Refunds Stripe reports** (`stripe-refunds.ts`, new): `applyStripeRefund()` handles `refund.created`, `refund.updated`, `refund.failed` and `charge.refund.updated`; a refund of Kaizen's own (`metadata.order_id`) whose row is not written yet is refused with `RefundNotRecordedYet` (the webhook answers 500 and Stripe sends it again) for two minutes, then recorded from the event; a payment is found by the refund's PaymentIntent (the payment's own reference, then the Checkout session, then a subscription's invoice). **`reconcilePendingRefunds()` is new**: the five-minute job asks Stripe for Kaizen's own refunds still `pending` (every run for ten minutes to two hours old, then once an hour), so a bank refund completes even when the webhook is not set up for refund events; a refund made in the Dashboard still needs the webhook (`refund.created`). `ensureSubscriptionEvents()` is now called by every `startCheckout()` and by the job (it adds `refund.*` to the platform endpoint without replacing it); `WEBHOOK_EVENTS` gained `refund.created`, `refund.updated`, `refund.failed`.
4. **The PDF.** `ensureDocumentPdf(store, kind, id, deps)` returns `{ ok, bytes, stored, fileName }` or `{ ok: false, reason: not_found | anonymised | busy | render_failed }`; `deps` (renderer, HTML, storage) are for tests. `pdfJob({ limit, storeId })` takes an optional store (the cron passes none). `retryDocumentPdf()` renders at once (the PDF routes); **`retryPdfLater()` only forgets the failures** (the Waiting tab's *Try again*, so the page's action never imports Chromium).
5. **Reads.** `waitingCreditNotes()` also lists refunds that were credited in part (`state: 'short'`, the amount left uncredited), not only refunds with no note. `invoiceCounts()` and `invoiceCheckupFindings()` serve the Orders tab, Home and `store_checkup` (the finding list is added to `storeCheckup()` in `owner-tools.ts`; the codes are `invoice_numbers_broken`, `invoices_waiting`, `credit_note_missing`, `credit_note_short`, `refund_reversed_after_success`, `pdf_failing`). `findDocumentByToken(storeId, token)` takes the store (the route's own), so a token of another store is the same `null` as an unknown one.
6. **`startCheckout()`** asks Stripe for the billing address (`billing_address_collection: 'required'`) for an order with a company and skips Stripe's `invoice_creation` while `kaizenInvoicingOn(store)`.
7. **`returns.refund_working`** is written by `record()` in `refundReturn()` in the refund's own UPDATE (`deliveryMinor` is the delivery actually refunded, `adjustmentMinor` is `adjustmentOf()` of the rest), for the Stripe and the outside case.
8. **Tests** of this area: `invoice-settings.int.test.ts`, `invoice-issue.int.test.ts`, `invoice-refunds.int.test.ts`, `invoice-returns.int.test.ts`, `invoice-documents.int.test.ts` (emails, PDF, CSV, retention), the invoice and credit-note scenarios added to `checkout-kinds.int.test.ts` (every kind, euro, campaigns, delivery) and `vat-engine.int.test.ts` (reverse charge, IOSS), `document-readers.test.ts` (who reads and writes documents, where Chromium is loaded), `stripe-refunds.test.ts`; the rows are built by `src/server/invoice-test-fixture.ts`.

### 5.3 Shopper

| File | What |
|---|---|
| `src/components/documents/order-document-view.tsx` | `OrderDocumentView({ snapshot })`: the invoice and the credit note drawn from the snapshot, server-rendered, no hooks, black on white, A4 (`DOCUMENT_CSS` is imported from `src/components/work/invoice-document.tsx`; the styles and the helpers `moneyText`, `dayText`, `percentText`, `addressLines` from `src/lib/work-invoice-print.ts` are reused by import, no edit of Work's files except exporting what is not yet exported). It draws text only (no HTML from any field), the VAT table per rate, the footnotes of 4.1, the treatment statements, `vatHome`, the footer note, "page x of y" by CSS |
| `src/components/documents/order-documents.tsx` | `OrderDocuments({ documents, links })`: the small block of links on the order pages, **imports nothing the pay routes forbid** (`src/lib/pay-routes.ts`'s list; `pay-routes.graph.test.ts` holds it) |
| `src/app/s/[store]/[market]/account/documents/[token]/page.tsx` | the hosted page (`robots` noindex, `referrer: no-referrer`), reads `findDocumentByToken()` and checks the store; **Download PDF** and **Print** links |
| `src/app/s/[store]/[market]/account/documents/[token]/pdf/route.ts` | the PDF; 404 for an unknown token, a token of another store or an anonymised document; `?` nothing else |
| `src/app/s/[store]/[market]/order/[orderId]/order-section.tsx` | **edit**: renders `OrderDocuments` with `getOrderDocuments()` (read once per request through `perRequest()`) |
| `src/app/s/[store]/[market]/account/orders/[orderId]/page.tsx` | **edit**: the same block |
| `src/lib/email-text.ts` | **registry**: only the words the order emails already take from `email-text.ts`; **the invoice words are `invoice-text.ts`'s** (as D157's `vat-text.ts`), so nothing legal enters the AI catalogue; `src/lib/ui-catalog.ts` needs no `HAND_WRITTEN_ONLY` entry because nothing is added to `i18n.ts` |
| `src/lib/cookie-consent.ts` | **registry: unchanged.** The unit sets no cookie and uses no storage; a source-scan test holds it for the two new components and the two routes |

#### 5.3.1 As built (shopper agent, 2026-10-04): where the shopper side differs from the table above

1. **A piece as well as a block.** The order page's default is made of pieces (D117), so the documents block is also the piece `order_documents` ("Invoice and credit notes", `STORE_PIECES` in `src/lib/store-parts.ts`, `OrderDocuments` in `order-section.tsx`, a case in `StorePartSection`, a place after `order_totals` in the order starter in `src/lib/page-roles.ts`); `OrderDetails` (the standard page) draws it between the lines and the returns. The component is `OrderDocuments` in `src/components/documents/order-documents.tsx`, imported into the section as `DocumentLinks`. It takes plain props (`lang`, `locale`, `base`, `invoice`, `creditNotes`, `testOrder`), not the server's `OrderDocuments` type, so it imports nothing from `src/server/`.
2. **The test-order sentence is drawn in the market's language** from `invoice-text.ts` (`testOrder`), not from `getOrderDocuments().shopperNote`, which is English; the page passes `testOrder = no invoice and eligibility "test_mode"`.
3. **`DocumentText.totalCredited`** ("Kreditert totalt", "Krediterat totalt", "Krediteret i alt", "Total credited") is added to `invoice-text.ts`: a credit note's last line must not read "Total to pay".
4. **The hosted page's own print button** is `src/components/documents/document-print-button.tsx` (a client component, no cookie or storage): with `?print=1` (where the PDF route lands when the file could not be made) it opens the print dialog once and takes the parameter off the address. The hosted page, `OrderDocumentView` and the PDF route are as the table says; the view carries its own `<style>` (Work's `DOCUMENT_CSS` plus a few classes) so the print page and the hosted page need nothing else.
5. **Not drawn:** the buyer-incomplete note (the spec keeps it to the admin), the unit of a stay's or rental's count (the snapshot holds the count and the period, not the unit, so a booked line prints its start and end), and the invoice's `discounts` are informational only (listed under "Discounts given", never added).
7. **`react-dom/server` cannot be bundled into a route** (found by `pnpm build`: "You're importing a component that imports react-dom/server", and the server layer's stub throws). `src/server/document-html.tsx` therefore loads it at run time with Node's `createRequire` and a computed name, and `next.config.ts` gives the three PDF routes `DOCUMENT_PDF_FILES` (Chromium's files plus `react-dom`, `react` and `scheduler` from pnpm's folders) in `outputFileTracingIncludes`. Proved with `next dev` and `e2e/invoices.spec.ts` (a real PDF whose text holds the number and the total); **not** proved in a production build here (the sandbox lacks `@axe-core/playwright`, so `pnpm build` stops at the type check of `e2e/a11y.ts`) nor on Vercel: the lead checks a preview deployment (9.7). If the trace misses the packages, the fallback is the hosted page itself loaded by Chromium (the route's origin, JavaScript off, the article isolated with `page.evaluate`).
8. **The hosted page streams**, so for an unknown token its status line is 200 with `noindex` and the not-found page (as Work's hosted invoice); the PDF route answers a real 404.

6. **Tests of this area:** `order-document-view.test.ts` (every field of 4.3, text only, reverse charge, IOSS, VAT in the seller's currency, credit note, languages), `order-documents.test.ts`, `shopper-documents.test.ts` (no cookie, storage or request; no live data; noindex; one 404), the documents block in `order-section.test.ts`, `.../pdf/route.test.ts` (headers, 404s, the print redirect) and `e2e/invoices.spec.ts` (order page, hosted page, a real PDF whose text holds the number and the total, the print fallback landing, test mode).

### 5.4 Admin

| File | Guard (the permission scan holds the literal key) |
|---|---|
| `src/app/admin/(gated)/[store]/invoices/page.tsx`, `loading.tsx` | `requirePermission(slug, "orders:read")` |
| `src/app/admin/(gated)/[store]/invoices/actions.ts` | `checkPermission(slug, "orders:write")` for *Check again*, *Send again*, *Try again*; the settings actions are in `settings/invoices/actions.ts` |
| `src/app/admin/(gated)/[store]/invoices/export/route.ts` | `checkPermission(slug, "orders:write")` (a route handler takes its nearest page's area; the scan holds it), audit `invoice.exported` |
| `src/app/admin/(gated)/[store]/invoices/[invoiceId]/pdf/route.ts` and `.../credit-notes/[creditNoteId]/pdf/route.ts` | `requirePermission(slug, "orders:read")`; serve the stored file (render on first request) |
| `src/app/admin/(gated)/(print)/[store]/invoices/[invoiceId]/print/page.tsx` and `.../credit-notes/[creditNoteId]/print/page.tsx` | `requirePermission(slug, "orders:read")`; no admin chrome (the `(print)` group), `?auto=1` opens the print dialog |
| `src/app/admin/(gated)/[store]/settings/invoices/page.tsx`, `actions.ts` | `requireOwnerRole(slug)` / the `owner` key (the page is marked `needs: "owner"` in `ADMIN_PAGES`) |
| `src/app/admin/(gated)/[store]/orders/[orderId]/page.tsx` | **edit**: the *Documents* card; its send-again action in `orders/actions.ts` (`orders:write`) |
| `src/components/admin/invoices/*` | `invoices-view.tsx` (tabs, filters, tables, the waiting list), `documents-card.tsx`, `invoice-settings-form.tsx` (an `ActionForm`), all in the admin's semantic tokens (D149), `animate-pulse` loading states; presentational with `renderToString` tests |
| `src/lib/permissions.baseline.json` | **registry**: the scan's oracle holds every file that asked a legacy guard before roles; new files have no legacy entry. The new files above are **not** in the baseline (it records the state before the sweep); what the scan tests need is that each carries a literal guard key matching its area, and that the owner-only page is in `OWNER_ONLY_EXTRA` of `permissions.scan.test.ts` with its reason ("the invoicing settings change legal numbering") because the baseline cannot say it. The foundation of the admin area adds that line |
| `src/lib/store-nav.ts` | **registry**: `item("/invoices", "Invoices", "Invoices and credit notes for orders, the orders waiting for one, and a CSV for the accountant.")` in Orders; `item("/settings/invoices", "Invoicing", "Switch on invoices, the numbering, the note printed on every invoice and credit note.")` in Settings > Selling |
| `src/lib/admin-map.ts` | **registry**: `store("invoices", "/invoices", "Invoices", "Main", …)`, `store("invoice", "/invoices/[invoiceId]/print", "Invoice", "Main", …)` is a print route and is listed as `returns` print pages are by the map's test; `store("invoices.settings", "/settings/invoices", "Invoicing settings", "Sales", …, { needs: "owner" })`; `keywords: ["invoice", "faktura", "credit note", "kreditnota", "receipt", "pdf", "accountant"]` |
| `src/lib/audit.ts` | the area entries of 5.1; the actions written: `invoice.settings_updated`, `invoice.exported`, `invoice.emailed`, `invoice.series_set` |
| Payments page | the *invoices for orders* option greys with the sentence of 2.3 when Kaizen invoicing is on (`src/app/admin/(gated)/[store]/settings/payments`, owner-only already) |

#### 5.4.1 As built (admin agent, 2026-10-04): where the admin differs from the table above

1. **The CSV export is a POST, not a GET.** `/admin/{store}/invoices/export` takes the form of the invoices page (`type`, `from`, `to`) and answers a file. The permission scan holds a GET route to the page's `read` key and a mutating route to `write`; the export holds personal data and writes `invoice.exported`, so it is `orders:write` and therefore a POST (`checkPermission(slug, "orders:write")`, then `sameSite()`, as the assistant's and the replicator's routes do). A refusal redirects back to the page with `?export=period` or `?export=too_many`, which the page turns into a fixed sentence (`exportProblemOf()`: never text from the address). A period with more than 20,000 documents is refused rather than given cut short, because an accountant must be able to trust that a file is whole.
2. **The credit note's staff routes sit under `invoices/credit-notes/`**, so the `/admin/**/invoices/**/pdf` glob of `outputFileTracingIncludes` covers them: `/admin/{store}/invoices/credit-notes/{id}/pdf` and `.../print`. The invoice's are `/admin/{store}/invoices/{id}/pdf` and `.../print`.
3. **The print pages are not listed in `ADMIN_PAGES`.** The map's test lists the `(gated)/[store]` pages only, and a print page lives in the `(print)` group (no admin chrome), as Work's do. Instead `permissions.scan.test.ts` now also scans `src/app/admin/(gated)/(print)/[store]/` (the constant `STORE_PRINT`), so a print page without the right guard fails there. `ADMIN_PAGES` has `invoices` (Orders) and `invoices.settings` (Settings, `needs: "owner"`).
4. **Send again is in `invoices/actions.ts`, not `orders/actions.ts`**, with *Check again* and *Try again* (one file for the unit's admin actions; each `checkPermission(slug, "orders:write")`). The order page binds it per document.
5. **Files.** `src/lib/invoice-admin.ts` (tabs, query parsing, hrefs, labels, sentences, the notes for an accountant), `src/components/admin/invoices/` (`invoices-view.tsx`, `documents-card.tsx`, `invoice-settings-form.tsx`, `waiting-actions.tsx`, `skeletons.tsx`), `src/app/admin/(gated)/[store]/invoices/` (`page.tsx`, `loading.tsx`, `actions.ts`, `export/route.ts`, `[invoiceId]/pdf/route.ts`, `credit-notes/[creditNoteId]/pdf/route.ts`), `src/app/admin/(gated)/[store]/settings/invoices/` (`page.tsx`, `loading.tsx`, `actions.ts`), `src/app/admin/(gated)/(print)/[store]/invoices/...` (two print pages), the *Documents* card on `orders/[orderId]/page.tsx`, and the Payments page, whose Stripe invoice option is shown disabled (and kept as it was, through a hidden field, because a disabled box is not submitted) while Kaizen invoicing is on. One read was added to the allowed module `src/server/invoices.ts`: `failingPdfs(storeId)` (documents whose PDF failed five times), because `document-readers.test.ts` lets only the listed modules name `commerce.invoices`.
6. **Not built here, by the spec's own split:** the store Home and control-center attention (`src/server/control-center.ts`, `src/lib/control-center.ts`, 5.5, the analytics-and-ai area) and the count in the Orders tab (the navigation has no badges). The invoices page itself shows the counts and the Waiting tab leads the person to what needs doing.
7. **Existing test changed.** `admin-map.test.ts` asked for "invoice number prefix" to find Work's settings; the store's own invoicing settings now match those words too, so the question says "work invoice number prefix". The assertion (Work's page is found when Work is on) is unchanged.
8. **Tests:** `src/lib/invoice-admin.test.ts`, `src/components/admin/invoices/*.test.ts` (renderToString), `src/server/invoice-admin.int.test.ts` (the actions, the CSV route, the PDF routes with an injected renderer outcome, the print pages and the settings, against the real guards and a stand-in for the sign-in: read-only member, Orders role, owner, another store's owner and nobody signed in), and the new cases in `admin-map.test.ts`.

### 5.5 Analytics and AI

| File | What |
|---|---|
| `src/lib/owner-tools.ts`, `src/server/owner-tools.ts` | two read tools: `list_invoices` (numbers, dates, buyer country, amounts per document, filter by period and by waiting; **no names, no addresses, no emails**) and `invoice_readiness` (what is missing for invoicing); `HANDLERS`, `TOOL_WORDS` lines; both ungated (they read) |
| `src/lib/owner-tool-permissions.ts` | **registry**: `list_invoices: "orders:read"`, `invoice_readiness: "owner"` (like `get_tax_profile`) |
| `src/lib/assistant-skills.ts` | **registry**: the playbook `invoices-and-credit-notes` naming the two tools and the pages `invoices` and `invoices.settings` |
| `src/server/store-mcp.ts` | the store's MCP server serves every owner tool, so both are served there |
| `src/server/control-center.ts` and `src/lib/control-center.ts` | **registry**: the owner's overview counts *invoices waiting* beside the other attention items (the `taxAttention()` pattern: one query, owners only, "not urgent" except an overdue reverse-charge invoice) |
| `src/lib/plan-features` data | **registry (in the migration)**: one row in `commerce.plan_features`, category the existing orders category, name "Invoices and credit notes for orders", description of 5.5's feature; describes only, enables nothing (D132) |
| `docs/analytics.md` | **not edited here**: 1c defines the VAT figures from `invoices` and `credit_notes` (3.4's contract); 1b adds no figure to analytics |
| `src/lib/sitemap`, structured data, `llms.txt`, store-translate worklist, `KNOWN_COOKIES`, integration events | **unchanged, deliberately** (3.5, 2.2 point 10, section 7) |

### 5.6 The registries, once more, and who edits each

`src/lib/audit.ts`, `src/lib/store-copy-rules.ts`: foundation. `src/lib/store-nav.ts`, `src/lib/admin-map.ts`, `permissions.scan.test.ts`'s `OWNER_ONLY_EXTRA`: admin. `src/lib/owner-tool-permissions.ts`, `src/lib/assistant-skills.ts`, `src/lib/owner-tools.ts`, `control-center`: analytics-and-ai. `src/server/email.ts`, `shopper-emails.ts`, `stripe*.ts`, `checkout.ts`, `returns.ts`, `next.config.ts`, the cron routes: server. `src/db/schema.ts` and the migrations: foundation. Shared with the other lane (`/home/user/kaizen-trust` is a separate directory and is not touched): none of these files is edited by this lane beyond the blocks above, each at a known anchor so a textual merge applies.

---

## 6. Acceptance criteria, row by row, mapped to tests

Test kinds: **unit** (`pnpm test`, pure), **PGlite** (`src/db/invoices.test.ts`, applies every migration to PGlite as `commerce.test.ts` does), **int** (`pnpm test:int` against a real database after `scripts/db-setup.mjs --seed`, fake Stripe through the existing `vi.mock("./stripe")` pattern), **e2e** (`PORT=3000 pnpm test:e2e`, Chromium through `PLAYWRIGHT_CHROMIUM_PATH`). A new money read has a euro scenario in `checkout-kinds.int.test.ts`.

### 6.1 `orders.invoices-and-vat-receipts-for-orders`

| Criterion | Held by |
|---|---|
| 1. A paid order gets an invoice in the store's own gap-free series, once, immutable, with seller and buyer details, VAT per rate and the order's currency | PGlite: issue in `complete_order_payment`; second call returns the same row (idempotent); `UPDATE` and `DELETE` refused; direct `INSERT` refused; numbers 1..n with no gap after 50 concurrent payments (advisory-lock-free: the series row lock) and after a forced failure inside the issue (the number comes back); the failure sub-block keeps the payment. Unit: `buildInvoiceSnapshot()` rounding table (30+ cases: mixed rates, shipping at a different rate, a shipping discount, gift line, reverse charge, IOSS, discount remainders, quantity 3 at an odd price). Parity: PGlite issues from a fixture order and `buildInvoiceSnapshot()` of the same rows deep-equals the stored snapshot (`invoice-parity.test.ts`). Int, `checkout-kinds.int.test.ts`: for **every kind** (physical, digital, mixed, subscription start, subscription start with free trial, renewal, appointment paid now, with deposit and at the venue, stay, rental, gift campaign, sign-up fee) in the **euro view**: invoice total = order total (less deferred), Σ invoice VAT per rate = `orderVatByRate()`, the order's `tax_minor`. |
| 2. The shopper downloads a legal invoice PDF from the order page and the order email, staff can reprint it | Unit/render: `order-documents.test.ts` and `order-section.test.ts` (the block on the order page in nb, sv, da, en); `order-document-view.test.ts` (every Art. 226 field of 4.3 is drawn from a fixture snapshot, text only, no HTML injection from a title or a name, per-rate table adds up, footnotes). Int: `invoice-documents.int.test.ts`: the hosted page and PDF route find a document by token, not by another store's token, not after anonymising; the confirmation email contains the link and no secret other than the token; the PDF route with an **injected renderer** stores once and serves the stored file (the second request does not render); a renderer that throws gives the print redirect and an order that is intact; staff routes need `orders:read`. **E2E** (`e2e/invoices.spec.ts`, real Chromium): pay in a test store with an invoice-eligible fixture, open the order page, follow *Download PDF*, assert `application/pdf`, the `%PDF` magic and that the text layer holds the invoice number and the total; and the **no-Chromium fallback** (the route with the browser path unset) gives the print page. |
| 3. A business order carries the company and VAT number and the reverse-charge note | Unit: the statements in nb, sv, da, en carry both numbers (`invoice-text.test.ts`, reusing `vat-text.ts`); int (`checkout-kinds`, reverse-charge scenario of D157): the document's buyer block has company, organisation and VAT number, rate 0 lines with `wouldHaveRate`, total = net; a consumer's invoice never prints a buyer VAT number; the VIES name and address are in no snapshot. |
| 4. Copied history and hosts' orders never get an invoice from this store | PGlite: copied order and host order refused by the function and by the insert guard; int: `copy_orders()` copies no document; a host's checkout makes none; a test-mode payment makes none; invoicing off makes none; the waiting reasons (2.1) each tested. |

### 6.2 `orders.credit-notes-for-refunds`

| Criterion | Held by |
|---|---|
| 1. Every refund of a paid order can produce a credit note in its own gap-free series, linked to the invoice, with the refunded amount and VAT per rate | PGlite: each of the ten situations of 2.5 and **each path of 2.6** (P1 to P10), including a refund inserted pending and updated to succeeded (the trigger fires on the update), a refund inserted `succeeded` by raw SQL, a failed refund (none), `succeeded` → `failed` refused; one credit note per refund (the second insert is refused); series `credit_note` separate from `invoice` (numbers independent); gap-free after a rollback. Unit: `creditAllocation()` property tests (shares sum to R exactly, never above `U_b`, deterministic, independent of bucket order except by the stated tie rule, full refund leaves 0 and the VAT adds to the invoice's). Int: `invoice-refunds.int.test.ts` runs P1 to P7 through the real server code with the fake Stripe: `refundOrder()` (succeeded and pending), the **webhook** `refund.updated` completing a pending refund, `refund.created` for a refund made in Stripe (a payment found by payment intent), a replayed event (no second note), a failed refund. |
| 2. A return's refund (D153) produces one credit note with its working; the shopper gets the PDF with the refund email | Int (`invoice-returns.int.test.ts`, extending the D153 scenarios): a withdrawal of one of three lines with a deduction and return shipping paid by the shopper; a whole-order withdrawal that refunds the delivery; a staff-raised amount; a return refunded outside; `Σ credit note = returns.refund_minor`, lines are the returned lines at their rates, the deduction and return-shipping rows present, `returns.refund_working` write-once; the refund email links the note, and attaches the PDF as base64 when it exists (a fake `deliver` records the attachment's encoding and size) and the link only when it does not. |
| 3. A credit note is immutable and cannot exceed what the invoice left uncredited | PGlite: `UPDATE` and `DELETE` refused; a credit note above the per-rate remainder refused (`credit_note.over_invoice`) by the database; a refund over the remainder gives a capped note and `credit_note_short` (int); two concurrent refunds of the same order cannot together exceed the invoice (the second note is capped, tested with two connections). |

### 6.3 `international.legal-invoices-and-credit-notes-for-orders`

| Criterion | Held by |
|---|---|
| 1. A paid shop order gets a legal invoice (seller and buyer details, VAT per rate, VAT number, payment, date) issued once by an SQL function and immutable afterwards, with a PDF and a link in the order email and account | As 6.1 criteria 1 and 2; the **account**: `account/orders/[orderId]` page render test lists the invoice and its credit notes for the owner; the **queue**: PGlite and int: complete the seller's details after a payment, the invoice is issued by `issueWaitingInvoices()` with `issued_on` = the later day and `supply_date` = the payment day; the waiting list shows the reason; the VAT-not-registered and no-exchange-rate waits; an overdue waiting reverse-charge order is flagged after the 15th (injected clock). |
| 2. A refund or a withdrawal refund produces a credit note that references the invoice and lists the refunded lines and VAT | As 6.2 criteria 1 and 2; unit: the credit note document draws `refersTo` (number and date), the credited lines and the VAT per rate; the language of the order; the hosted page shows the credit note by its own token. |
| 3. Totals equal the order's and the refunds' (including bonus credit, group and code discounts, multi-currency), held by scenarios in `checkout-kinds.int.test.ts` | Int: the scenarios of 6.1 criterion 1 extended with a bonus-credit order, a group-discount order, a code and a campaign order, each in EUR in a NOK store, each refunded partly then fully: Σ credit notes = Σ succeeded refunds (up to the cap), invoice VAT − credited VAT = 0 after a full refund, `vatHome` = the sum of the rounded buckets at the stored rate and the credit notes' `vatHome` at the invoice's rate; `vatMain` equals `vatHome` in a NOK store with a NOK seller. |
| 4. Copied and host orders get none; the numbers cannot be skipped, lowered or deleted | As 6.1 criterion 4; PGlite: `document_series` prefix change, lowering and skipping refused after the first document (the D141 guard, now tested for these series), deleting any document or the series refused, `document_audit()` reports a hand-made gap (a number removed by superuser SQL in the test) and `ok` otherwise; `set_sales_series()` works before the first issue and refuses after. |

### 6.4 Cross-cutting tests

- **Permissions.** `permissions.scan.test.ts` (existing) fails if any new page, route or action lacks a literal guard of the right area; `permissions.matrix.test.ts` and `store-nav.test.ts`, `admin-map.test.ts` fail if a page is not registered; `owner-tool-permissions.test.ts` fails for a tool without a permission; `audit.test.ts` and `audit-coverage.int.test.ts` fail for an action without an area, and a test holds `audit_area_of()` equal to the TypeScript table.
- **Privacy.** `document-readers.test.ts` (source scan: only listed modules read `invoices`/`credit_notes`/`snapshot`); a test that no integration event, `list_invoices`, chat tool, sitemap or `llms.txt` contains a buyer field; the hosted page's headers (`noindex`, `no-referrer`, `no-store`); no cookie or storage (source scan of the new components and routes).
- **Pay routes.** `pay-routes.graph.test.ts` fails if the order page's new block imports a module outside the allowed graph; the documents routes are outside `/cart`, `/checkout`, `/order` and need no CSP change.
- **Chromium.** a build-output check (`.nft.json`) that the three routes carry the Chromium files and that no other route imports `invoice-pdf.ts` (a source-scan test like the cookie scan's).
- **Source scans.** nothing under `src/` inserts into `commerce.invoices` or `commerce.credit_notes`; `orderInvoices` is read only in `checkout.ts` and the payments settings, and `startCheckout()` does not create a Stripe invoice when Kaizen invoicing is on (int, fake Stripe records the session parameters).
- **Texts.** `invoice-text.test.ts`: the four languages have the same keys, English is the fallback, no string interpolates a free-text field into a statutory sentence, the module is not imported by `i18n.ts` or the AI catalogue.
- **CSV.** formula-safe (a name `=1+1`, `+x`, `-x`, `@x`, a tab, a quote and a comma), column layout fixed by a test, amounts decimal with a point, VAT per rate pairs per rate present.
- **Retention.** `anonymise_expired_documents()` refuses a cutoff younger than 5 years, leaves numbers, dates, totals, buckets and the seller untouched, nulls the token and the PDF path, and `anonymiseDocuments()` removes the stored file (fake storage); a document younger than the cutoff is untouched.
- **Refund webhook.** an event for another store's account is ignored; a refund for an unknown payment is recorded as an unmatched event and changes nothing; replays are idempotent; Stripe-side `charge.refund.updated` variants map to the same handler.

### 6.5 Criteria changes proposed (no row is edited here)

1. **`orders.invoices…` criterion 2 and `…credit-notes…` criterion 2, "the shopper downloads a PDF from the order email" / "gets the PDF with the refund email"** are met by a **link** in every email and by the **PDF attached when it exists** at send time (a PDF is made on demand, and a first confirmation is
   sent within seconds of payment). Proposed text: "the order email and the refund email link the document and attach the PDF when it exists; the shopper can always download it from the order page". Testable as written in 6.1 and 6.2.
2. **`…credit-notes…` criterion 1, "Every refund of a paid order can produce a credit note"** is exactly: every refund that **succeeds** on an order that has an invoice (a refund of a host's, copied, test-mode or invoicing-off order has none, and `pending` and `failed` refunds have none until they succeed).
3. **`international.legal-invoices…` criterion 3, "totals equal the order's"** is: equal to the order's total **less lines of a free-trial subscription that are billed at the first renewal** (2.8), and the credit notes' sum equals the refunds' **up to what the invoice left uncredited** (a refund above it, such as a no-show fee, is reported, 2.5).
4. **`international.legal-invoices…` criterion 4, "the numbers cannot be skipped, lowered or deleted"**: already enforced for the `invoice` and `credit_note` series by D141's guard; 1b adds the tests, and the criterion is satisfied by them.
5. **All three rows' "legal invoice"** is satisfied by the content of 4.3 for NO, SE, DK, DE and the Directive; it is not a claim about any other country (7), and several statutory points are marked *verify*. The tracker's `gap` text should say so when the rows are re-rated.
6. `docs/wave-1.md` says "remainder to the largest bucket" (replaced by the largest-remainder method, 1.4 point 6), "default `F-`/`K-`" (kept, 1.4 point 5), "rendered from the print view" (rendered from the same component, 1.4 point 8), "issued... as soon as the details are complete" (kept, plus the new waits of 2.1), and a store-wide switch (1.4 point 3) that the outline does not mention.

---

## 7. What is deliberately not done, and who takes it

| Not done | Why | Taken by |
|---|---|---|
| The **VAT, OSS and IOSS reports**, the VAT figures in analytics, the euro conversion at the ECB reference rate of the quarter's last day | unit 1c reads `invoices`/`credit_notes` through the contract of 3.4 | 1c |
| **GDPR export, erasure and the retention job**; `retention_rules` as a table | 1g; 1b gives it `anonymise_expired_documents()` and the constants | 1g |
| **Unit price** on lines | 1d | 1d |
| **Manual credit notes**, a credit for a **cancelled order that was never refunded** (the unpaid venue balance), a **corrective invoice** for a mistaken document, and a **void** | no way to correct a document except a further document; order editing and draft orders bring these | wave 3 (order editing, draft orders) |
| **Invoices for orders paid before invoicing was switched on**, and an **invoice for an order placed outside Kaizen** | the series is not backdated; an opt-in "issue for earlier orders" needs the owner's choice of date and the accountant | later, on request |
| **The no-show fee's invoice** (a charge made off session on a booking, D66) and **host commissions** | separate supplies with their own VAT questions; payments beyond an invoice's total are shown on the order page as *not invoiced* | wave 3 or a decision |
| **A structured e-invoice** (XRechnung, ZUGFeRD, Peppol, Norway's EHF, Denmark's OIOUBL) | Germany's domestic B2B mandate for issuing starts 2027 (search results: above 800,000 EUR turnover) and 2028; consumer invoices are outside it; Norway and Denmark have public-sector rules; none read | wave 7 or on demand |
| **Exemption references** for exempt lines (Art. 226 point 11) and **simplified invoices** (Art. 226b, 238) | per-country, per-category data not held; every invoice is a full invoice | platform VAT data, later |
| **Custom invoice templates, logo, bank details, a due-date and late-payment terms** | a paid sale has no due date; the layout is fixed; Work (D122) has these for service invoices | later |
| **Other languages** than nb, sv, da, en | statutory wording is hand-written; no machine translation | with a human translator |
| **Other countries' rules** (every member state beyond NO, SE, DK, DE) | not read; the defaults follow the Directive; the tax screen says so | per country, by an accountant |
| **Integration events** (`invoice.issued`, `credit_note.issued`) and Slack messages | wave 9's outgoing webhooks | wave 9 |
| **Pushing documents to an accounting system** (Tripletex and others) | `docs/tripletex.md` is a proposal for Work; level 2 (shop orders) later | wave 2 (accounting connectors) |
| **Shopper "email me my invoice again"** | an unauthenticated send is an abuse vector; the order page and the email already carry the link; staff can send again | later, rate-limited |
| **A platform-wide invoices view** and **cross-store reports** | a store's documents are the store's | never in this wave |
| **A refund Stripe reports as failed after it succeeded** | no status change (2.6); reported in the checkup; a corrective document waits for the line above | wave 3 |
| **Writing the invoice in the shopper's browser language** when it differs from the order's | the order's locale is the one frozen | not planned |

---

## 8. Needs human legal review

Every consumer-visible text of this unit is hand-written in nb, sv, da and en (`src/lib/invoice-text.ts`), unreviewed, and flagged `// legal: needs review` in the module header. Nothing is machine-translated, and every other language shows English.
**An accountant or lawyer per country reads, before any real use:**

1. The **document titles and labels** in four languages: *Invoice / Faktura / Faktura / Faktura*, *Credit note / Kreditnota / Kreditfaktura / Kreditnota*, date of issue, date of supply, seller, buyer, organisation number, VAT number, quantity, unit price excluding VAT, discount, VAT rate, VAT amount, net, total, paid online, to pay at the venue.
2. The **statutory statements**: "Reverse charge" with both VAT numbers (nb "Omvendt avgiftsplikt", sv "Omvänd skattskyldighet", da "Omvendt betalingspligt", en "Reverse charge": reused from `vat-text.ts`, already flagged in D157), the **IOSS** statement and number, "The seller is not registered for VAT", "Exempt from VAT" without a reference, and the footnote on rounded unit prices.
3. The **VAT in the seller's currency** line: its wording, the rate and date shown, the choice of rate source, and whether the store's own rate table satisfies Art. 91, Norway's rule, Skatteverket's rule and Denmark's momsbekendtgørelse § 97.
4. The **content list of 4.3** against each country's act: in particular **a full invoice without a buyer address** (digital goods to a consumer), whether the payment day is the date of supply, the **unit price excluding VAT shown rounded** with an exact line amount, and a credit note's content (Art. 219, Swedish 17 kap., Danish § 52 a, Norwegian rules).
5. **Deductions and return shipping on a credit note** (4.6): whether a deduction for diminished value and a return-shipping contribution reduce the credited VAT as the default treats them.
6. The **retention periods** of 3.6 (NO 5, SE 7, DK 5, DE 8, others 10), flagged for the accountant, with their sources; and the 5-year floor of the anonymising function.
7. The **emails**: subject and body of `invoice.issued` and `credit_note.issued` and the document block in the confirmation, shipped and refund emails in four languages.
8. The **admin's English warnings** (the invoicing settings page, the waiting reasons, the *not VAT-registered* explanation) are for an accountant's eyes and need review.
9. That an invoice is **issued automatically for every consumer sale** and a **free-trial start** shows only what is due now.
10. **Added by the review fixes.** (a) The document of a **seller not registered for VAT** is drawn with no VAT rate, VAT amount, VAT table, ex-VAT or incl.-VAT wording (`hidesVat()`): Denmark's momsloven 52 a was read; whether Norway, Sweden and Germany ask the same of such a seller was not. The words `unitPrice`, `discount` and `amount` (column heads without VAT) are new. (b) The **neutral total** label (*Totalt / Totalt / I alt / Total*) replaces "to pay" on every invoice, and the header's *paid online* label replaces *paid*. (c) `supplyDateNote` (the date of supply is the payment date) and the new `supplyDateNoteVenue` (a booking paid wholly at the venue: booked services show their own dates), and that such an invoice shows no payment date and no date of supply. (d) `creditCapped` ("the refund was more than was left on the invoice", printed on a consumer's credit note), which was missing from this list, and `testOrder` ("Test order: no invoice"). (e) That a refund of a payment that is not on the invoice (a no-show fee) is not credited at all.

The invoice row and the credit note rows are not Full until a person has read these (`docs/parity/WAVES.md` step 4).

---

## 9. For the lead

### 9.1 Migrations expected

**Four files** after the review fixes: the three below, then `20261004152302_order_invoices_fixes.sql` (generated: `payments.test_mode`, plus the venue-mode trigger and a one-statement backfill `UPDATE`, no `DELETE` or `DROP`; 3.8 point 12). None is applied anywhere yet. Two files, in order (timestamps after `20261004111101`): `{ts}_order_invoices.sql` (generated: columns, tables, constraints, indexes, drizzle-expressible parts) and `{ts}_order_invoices_rules.sql` (custom: everything of 5.1's second row). A **third**, `{ts}_order_invoices_audit.sql`, replaces `commerce.audit_area_of()` with the new prefixes: a new migration, never an edit of `20261003195109_staff_security_rules.sql`. The migrations are **additive**; nothing is dropped; the tables that gain `not null` columns are empty and the migration raises if they are not. Apply each to production (project `ybsozesfuxuitoacntfo`) once the tests pass, check the advisors, and record the versions in `docs/decisions.md` (Migration versions).
`complete_order_payment()` is the most delicate statement: it is replaced whole (the latest definition is in `20260924163034_digital_products_rules.sql`; the foundation agent diffs against `pg_get_functiondef` of the running function before writing, since other migrations may have patched it), and the new call is inside a sub-block, so a bug in the invoice cannot stop a payment. Run the whole payment int suite before applying.

### 9.2 Statements the Supabase migration tool may cancel (the owner runs them in the SQL editor if so), and things only the lead can do

- **No function in this unit contains `DELETE`, `TRUNCATE` or `DROP`**, by design (3.3 point 9, 3.6): the storage object of an anonymised document is removed by application code. `ownerStatements`: **none expected**. Statements the foundation agent should still check before applying: the `DROP TRIGGER invoices_append_only` and `DROP TRIGGER credit_notes_append_only` that replace the old guard (a `DROP` of a trigger **outside** a function is not what the tool cancels, but they are the unit's only `DROP`s: if the tool refuses them, the owner runs exactly those two statements in the SQL editor, then the rest of the file applies), and `DROP FUNCTION` for nothing (no function is dropped; replaced functions use `CREATE OR REPLACE`).
- **Stripe's webhook endpoint** must send `refund.created` and `refund.updated` for the platform's snapshot endpoint in each mode. The code adds them (5.2), but it can only do so when the platform key is configured; after deploy the lead checks the endpoint in Stripe's Dashboard (events list) in test and live. Until it does, refunds Stripe reports later or makes in the Dashboard are not seen, and the five-minute job's `issueMissingCreditNotes()` only covers what Kaizen recorded.
- **The PDF job** `/api/cron/document-pdfs` is a new route: schedule it where the five-minute job is scheduled (the repository's `vercel.json` lists only the daily job; the five-minute one is called from outside). Without it nothing breaks: a PDF is made on first download.
- **Chromium on Vercel** for the three routes: confirm in a preview deployment that a PDF is produced (the cookie scan's and the replicator's routes already prove the files are traced; the new globs are new).
- The `documents` bucket is created by the migration when the `storage` schema exists; check in the Supabase dashboard that it is **private** and has no policy.

### 9.3 Advisors to check after applying

Security: RLS enabled with no policy on the three new tables (as every commerce table); the new functions have `search_path` set (the linter's "mutable search path" must stay clean); the `documents` bucket is private; no new `SECURITY DEFINER` function without a reason (none planned: the functions run as the caller, which is the service role). Performance: foreign keys indexed (`credit_notes (store_id, return_id)`, `document_deliveries`, `document_pdf_state`), a partial index for the waiting query (`orders (store_id, placed_at) where copied_from is null and host_id is null`), the CSV export's range scan on `invoices (store_id, issued_on)` and `credit_notes (store_id, issued_on)`, the `invoices (public_token)` and `credit_notes (public_token)` unique indexes the hosted page uses. Run `analytics-perf`-style timing on a store with 50,000 invoices for the list and the CSV (a bounded read, paged), and on the waiting query.

### 9.4 Decision row (draft)

| D159 | **Invoices and credit notes for shop orders in the store's own gap-free series.** A paid order is invoiced by `commerce.issue_order_invoice()` called inside `complete_order_payment()` (so every path that pays an order, checkout, a renewal, a standing delivery, a venue booking, issues it, and a failure in the invoice rolls back only itself and never stops the payment); a succeeded refund (by any path, enforced by a deferred constraint trigger at commit), or a return refunded outside Kaizen, issues a credit note by `commerce.issue_credit_note()`, allocated by `creditAllocation()` (largest remainder over the invoice's VAT-rate buckets, or the return's own working) and never above what the invoice left uncredited, per rate, by a database trigger. Documents are frozen JSON snapshots (`invoices.snapshot`), immutable except a one-time `pdf_path`, with no delete and no direct insert; copied, host, test-mode and invoicing-off orders get none; a store with incomplete seller details, no VAT registration for an order that charged VAT, or no exchange rate to its country's currency **waits** and is issued later with the payment day as supply date. Content follows the VAT Directive Art. 226 and the national lists of NO, SE, DK and DE (read, with sources and gaps in `docs/wave-1b-invoices.md` 1.3), with the VAT in the seller's currency where Art. 230 and the national rules need it, reverse charge with both numbers and the IOSS number from D157. The PDF is the same React view rendered by Chromium (`src/server/browser.ts`), stored once in a private `documents` bucket, with the print page as fallback; documents are served by long random tokens (no cookie), listed on the order pages and My account, linked in the confirmation, shipped and refund emails (the PDF attached when it exists). The Stripe invoice option is ignored while Kaizen invoicing is on. New: refund webhook events (`refund.created`, `refund.updated`), `returns.refund_working`, a base64 email attachment. `anonymise_expired_documents()` is built for unit 1g. Invoicing is on for new stores and off for stores with history until the owner turns it on. All consumer wording is hand-written nb, sv, da, en and needs legal review. *Why:* the largest weighted gap after returns (rows `orders.invoices-and-vat-receipts-for-orders`, `orders.credit-notes-for-refunds`, `international.legal-invoices-and-credit-notes-for-orders`); every later money feature (draft orders, order editing, gift cards, payouts) and unit 1c depend on correct documents. |

### 9.5 CLAUDE.md bullet (draft)

- Invoices and credit notes for shop orders (D159, `docs/wave-1b-invoices.md`): an invoice is issued **only** by `commerce.issue_order_invoice()` inside `commerce.complete_order_payment()` (a failure rolls back only itself and never stops the payment) and a credit note **only** by `commerce.issue_credit_note()`, which a deferred constraint trigger runs at commit for every refund that becomes `succeeded` (any path: `refundOrder()`, the Stripe `refund.*` webhook handler `applyStripeRefund()`, D153 returns) and for a return refunded outside; never write code that inserts into `invoices` or `credit_notes` (a scan test), numbers one another way, deletes or edits one (the database refuses; only a one-time `pdf_path` and `anonymise_expired_documents()` may change a row). Documents are the snapshot (`src/lib/invoice-snapshot.ts`, `buildInvoiceSnapshot()` is the oracle the SQL is held to by `invoice-parity.test.ts`), drawn only from it by `OrderDocumentView`; a credit note never exceeds the invoice per rate (`creditAllocation()`, `src/lib/credit-allocation.ts`). Copied (`C-…`), host, test-mode and invoicing-off orders get none; a store with incomplete details waits (`invoice_eligibility()`, `issueWaitingInvoices()`, the five-minute job). The VAT in the seller's currency is `vatHome` (`homeVatRequirement()`), converted with the invoice's rate on its credit notes; `vatMain` and `buckets[*]` are what unit 1c reads. A PDF is `renderToStaticMarkup()` of the same view loaded into Chromium with every request refused (`src/server/invoice-pdf.ts`; Chromium only there, the two PDF routes and `/api/cron/document-pdfs`, each in `outputFileTracingIncludes`), stored once in the private `documents` bucket, the print page the fallback; the hosted page is `/s/{store}/{market}/account/documents/{token}` (token `inv_`/`crn_`, no cookie, noindex). Admin: `/admin/{store}/invoices` (`orders:read`; CSV and *Check again* `orders:write`), `/admin/{store}/settings/invoices` (owner). A new refund path needs no call but must be listed in the enumeration of 2.6 and tested. All consumer wording is `src/lib/invoice-text.ts`: hand-written, flagged for review, never in `i18n.ts` or the AI catalogue.

### 9.6 Merge notes

Shared files this unit edits and the other lane may too (`/home/user/kaizen-trust` is not touched by this run, and its work is already merged into this tree): `src/lib/audit.ts` (prefix entries), `src/lib/store-copy-rules.ts`, `src/lib/store-nav.ts`, `src/lib/admin-map.ts`, `src/lib/owner-tool-permissions.ts`, `src/lib/assistant-skills.ts`, `src/db/schema.ts`, `src/server/shopper-emails.ts`, `src/server/email.ts`, `src/server/stripe.ts`, `src/server/stripe-webhooks.ts`, `src/server/checkout.ts`, `src/server/returns.ts`, `next.config.ts`, `src/app/api/cron/cart-reminders/route.ts`, `docs/decisions.md`, `CLAUDE.md`, the migrations directory. Each is edited by one small block at a known anchor. Decision number **D159** is proposed; the lead renumbers at the merge. Unit 1c starts from section 3.4's contract; unit 1g from `anonymise_expired_documents()` and `invoice-retention.ts`.

### 9.7 Before pushing (the things CI cannot prove)

Run a **real PDF** in a deployed preview and read it against section 4.3 with an accountant for one Norwegian, one Swedish, one Danish and one German order, including a euro order in a NOK store (the VAT in NOK), a reverse-charge order and a credit note of a return. Place a **test-mode** order and confirm it gets no invoice. Switch invoicing on in a live store only after the readiness list is clear and the accountant has read the wording; until then production has it off for stores with history (1.4 point 3).
