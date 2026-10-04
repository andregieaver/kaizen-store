# VAT, OSS and IOSS reports (wave 1, unit 1c; decision D161 proposed)

The contract for unit 1c of `docs/wave-1.md`: a VAT report per country and rate made from the store's invoices and credit notes, the
quarterly OSS (Union scheme) and monthly IOSS return data in euro at the European Central Bank's rate, a reconciliation of the report
against Finance and the orders, and CSV exports in the owner's own period. `docs/wave-1.md` section 1c is the agreed outline; this file
elaborates it (law with sources and read dates, exact data, files, acceptance mapped to tests) and does not contradict it except where
section 1.4 says so. Where reading the code showed the outline needs a refinement, section 1.4 lists it and the lead settles it before the
run starts. Code, tests and texts follow this file, and a disagreement is settled here first. **This file is documentation only: nothing
here is built yet.**

**These reports are the owner's data for the owner's accountant. They are never a tax return and never a filing.** Every page and every
file says so. Nothing here is legal or tax advice: every rule that comes from a law is written with its source and the date it was read, is
marked *needs review by an accountant*, and lives in one pure function or in data, so a correction is a change in one place and not a
rewrite. The admin is English only, so this unit adds no consumer text (section 8 lists what an accountant should still read).

Lane note: no other lane runs. Units 1a (D157), 1b (D159) and 1e/1f (D158) are in the tree and are the model. 1c reads what 1b froze:
`invoices` and `credit_notes` (`docs/wave-1b-invoices.md` 3.4, "What unit 1c reads"), and what 1a froze on the order
(`orders.vat_kind`, `vat_treatment`, `shipping_tax_rate`, `store_tax_profile`).

---

## 1. Purpose and scope

### 1.1 Rows this unit closes, and what each can honestly reach

| Row | Weight | Bucket | What 1c does | Honest rating when 1c is done |
|---|---|---|---|---|
| `analytics.tax-and-vat-reports-by-rate-and-jurisdiction` | 5 | A | All four criteria: a VAT report per country and rate (net, VAT, gross, documents, orders; shipping and reduced rates included) that reconciles to Finance and to the orders; an OSS quarterly view in euro at a stated rate with a formula-safe CSV; credit notes reduce the period they are made in, copied and host orders never count; a euro scenario with a store selling in more than one currency. | **full** by the criteria and the tests of section 6. It is bucket A and holds no consumer text. What stays outside code is an accountant's reading of section 4 (what goes in which part of a return): said on every page and in section 8. If the lead applies `docs/parity/WAVES.md` step 4 to accounting rules as well as to consumer text, hold it at **partial** until a person has read section 4; this spec recommends Full. |
| `checkout.oss-and-ioss-support` | 4 | **B** | Criterion 2 (the quarterly OSS and monthly IOSS return data as CSV) and criterion 4 (a refund reduces the period's VAT). Criteria 1 and 3 are 1a and 1b, already in the tree. | **partial**, never Full in this run. Every criterion has a test after 1c, but the row is bucket B: live only with an OSS or IOSS registration the owner holds, and no code here files a return or checks a number against a register. The row's gap text is rewritten at re-rating (1.5). |
| `international.ioss` | 3 | **B** | Criterion 3 (the monthly IOSS report per member state and rate, exported). Criteria 1, 2 and 4 are 1a. | **partial**, same reason. |

Rows touched only by text, not by their rating: `checkout.eu-vat-by-destination-vat-inclusive-prices-reduced-rates` (criteria 5 and 6 are closed by
1c's tests; criterion 1's "invoice" half by 1b) and `checkout.b2b-vat-id-reverse-charge-exemption` (its criterion 3 "the invoice says reverse charge" is
met by 1b's invoice). Both keep **partial** for reasons that are not code: the eu-vat row's rate data is thin and unverified (13 reduced-rate rows; 24 of the 28 countries have
none, so a French food product is taxed at the standard rate until a platform admin enters the rate), and the b2b row's gaps 2, 3, 7 and
8 (VIES never called live; a private buyer who types a company and a third party's VAT number is relieved of VAT; the stub-only e2e). Section 1.5 gives
the corrected gap sentences.

None of the three rows needs an owner decision from `docs/parity-plan.md` section 5, and no credential stops the work (the ECB's reference rates are
public). Ratings are changed by `history` entries in the rows and `pnpm parity:write`, by the lead at the end of the run from what the tests hold. The
rows are not edited in this spec.

### 1.2 What Shopify does (read on 2026-10-04)

- **Tax reports.** Shopify's tax reports page lists the United States Sales Tax and Canada Sales Tax reports (jurisdiction summaries and a detailed
  transactions report, exportable), a "Taxes" report ("a summary of the sales taxes that were applied to your sales", not region specific), "Total
  sales by order" (gross sales, net sales, taxes, returns and shipping, as CSV) and Managed Markets taxes (Canada and the United Kingdom only). The page
  names **no EU VAT-by-country-and-rate report and no OSS or IOSS report**, and does not say Shopify files or remits tax
  (<https://help.shopify.com/en/manual/taxes/tax-reports>, fetched 2026-10-04; the tracker row's own reading was 2026-10-03).
- **OSS and IOSS.** Shopify tells the merchant to "report sales and remit VAT to the OSS" and to the IOSS directly, i.e. the merchant files; the page
  says nothing about where a merchant gets the data for a return, and notes that from 1 July 2026 the EU removes the 150 euro customs duty exemption
  (<https://help.shopify.com/en/manual/taxes/eu/eu-tax-reference>, fetched 2026-10-04).
- So the Shopify side is "native but narrower than the row claims for the EU", as the row says; third-party apps fill the OSS gap. Kaizen goes further
  on purpose: the return data is made by the store itself, from its own gap-free documents, with the euro conversion shown and an owner override that is
  audit-logged. It stops where Shopify stops: Kaizen does not file or remit anything (section 7).

### 1.3 Sources read for this spec (and what was not read)

| Source | Used for | Read |
|---|---|---|
| European Commission, *One Stop Shop Guidelines* (original of 30 July 2021, English, <https://vat-one-stop-shop.ec.europa.eu/document/download/a316a98a-3b2b-4991-a9c0-3b5905d369fc_en>; the page <https://vat-one-stop-shop.ec.europa.eu/guides_en> lists a revised guide dated 1 January 2027 and revised explanatory notes with ViDA changes, **not read**) | Part 1 (scope, Member State of consumption, the EUR 10,000 threshold), Part 2 (return: tax period quarter for the non-Union and Union scheme and month for the import scheme; submission and payment by the end of the month following the period, Q1 30 April, Q2 31 July, Q3 31 October, Q4 31 January; contents per Member State of consumption; **Part 3 corrections** carry the tax period, the Member State of consumption and the VAT amount; Part 4 balance per Member State, Part 5 total with negative balances not counted; **Q11** corrections for periods from 1 July 2021 are made in a *subsequent* return, within three years; **Q12** "the credit note should be dealt with by making a correction to the OSS VAT return for the period in which the supply was declared"; **Q13** Part 2 cannot be negative, Part 3 can; **Q15** one currency, in general euro, converted at the "exchange rate as published by the European Central Bank on the last date of the tax period"), Part 4 (records kept **10 years** from the end of the year of the transaction, Council Regulation 282/2011 Art. 63c; invoicing is not obligatory under the schemes), Annex 3 (the return's boxes, from Implementing Regulation (EU) 2020/194 Annex III), and footnote 1 of Part 1 ("a taxable person established in a third country with which the Union has concluded an agreement on mutual assistance does not need to appoint an intermediary ... (e.g. Norway) for supplies of goods that are dispatched from that country") | 2026-10-04 |
| Skatteverket, "Report and pay VAT through the One Stop Shop", <https://www.skatteverket.se/servicelankar/otherlanguages/englishengelska/businessesandemployers/startingandrunningaswedishbusiness/declaringtaxesbusinesses/vat/applytoreportdistancesalesthroughonestopshoposs/reportandpayvatthroughtheonestopshop.4.16f588619a39f2c14a1da1.html> | a Swedish identification state requires the return and payment **in euro**, at the ECB's rate "for the last day of the reporting period", corrections within three years through the e-service, VAT to two decimals | 2026-10-04 |
| Directive 2006/112/EC Art. 369h as in <https://www.legislation.gov.uk/eudr/2006/112/article/369h/data.html> (the text at the UK's exit, the old MOSS wording) and Art. 369g at the same site | "The conversion shall be made by applying the exchange rates published by the European Central Bank for that day, or, if there is no publication on that day, on the next day of publication"; the return states per Member State of consumption the total value excluding VAT, the rates and the VAT due. **The article numbers after the 2021 renumbering were not read**: the rule is cited through the Commission's guide, and the number is marked *verify* | 2026-10-04 |
| ECB euro foreign exchange reference rates, <https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html> | published about 16:00 CET each working day except TARGET closing days; feeds `eurofxref-daily.xml`, `eurofxref-hist-90d.xml` (read: 70 KB, 90 days, `<Cube time="2026-09-30">` with NOK 10.9015, SEK 11.331, DKK 7.4755), `eurofxref-hist.xml` (8.2 MB, all history); "published for information purposes only. Using the rates for transaction purposes is strongly discouraged" (a disclaimer the screen repeats) | 2026-10-04 |
| ECB data portal, `https://data-api.ecb.europa.eu/service/data/EXR/D.NOK.EUR.SP00.A?startPeriod=2026-09-28&endPeriod=2026-09-30&format=csvdata` | one currency, a date range, CSV with `TIME_PERIOD` and `OBS_VALUE` (answered with the rows 2026-09-28 to 2026-09-30 when called with curl; answered 503 to the fetch tool, so a client must treat any non-200 as "unavailable") | 2026-10-04 |
| Shopify, the two help pages of 1.2 | the Shopify side | 2026-10-04 |
| `docs/wave-1a-tax.md`, `docs/wave-1b-invoices.md` (law read there is not re-read here: Directive Art. 226 and 230, the Norwegian, Swedish and Danish documentation rules) | what is frozen on orders and documents | 2026-10-04 |

**Not read in this run** (so every use below says *verify*): the Directive's own Union-scheme and import-scheme articles in their current numbering
(Art. 369a to 369k, 369l to 369x, and Art. 63 and 65 on when VAT becomes chargeable: Art. 66a was cited here wrongly in the first draft, see 2 point 2), Implementing Regulation (EU) 282/2011 Art. 61a, 63c and 61(2), Implementing
Regulation (EU) 2020/194 Annex III itself (the guide reproduces it), each Member State's own OSS pages other than Sweden's, how a Member State treats a
*zero* rate in the "reduced rate" boxes, the Norwegian merverdiavgiftslov, and the revised OSS guidelines of 2027. The foundation agent reads the
Directive's current text on EUR-Lex before it freezes `src/lib/oss-return.ts` and writes the URL and date in each rule's comment; a rule it cannot source
is a visible `needs review` flag, never an assertion.

### 1.4 Refinements of `docs/wave-1.md` 1c and of the 1a and 1b contracts found by reading the code

None changes what the unit delivers except points 1 and 3, which the lead confirms before the run starts.

1. **The reports read documents only; orders with no document are itemised, never added.** The outline says "from invoices and credit notes where they exist and
   from the orders' lines otherwise". The brief for this unit says reports read invoices and credit notes and never recompute VAT from orders. Both are
   kept by one rule: the **figures** are the documents'; an order that has none (invoicing switched off, paid before it was switched on, waiting, failed,
   test mode) is **counted and its VAT is shown on the reconciliation, by cause**, but is not in the by-rate table, the OSS data or the CSV. The page says
   at the top how many paid orders in the period have no document and links the invoices page's Waiting tab. Reason: one implementation of "what VAT a sale
   carried" (the order's frozen rate buckets, built once by `commerce.build_invoice_snapshot()`), no second grouping of order lines that could drift from the
   invoice, and a report whose every figure can be tied to a numbered document.
2. **Which dates.** An invoice is dated by its `supply_date` (the payment day in the store's time zone, the tax point of 1b 4.2: for goods, downloads and fees
   the day the payment was accepted. The basis is Directive Art. 63 (VAT becomes chargeable when goods are delivered or services performed) with Art. 65 (a payment received on account before then makes VAT chargeable on the amount received), *verify*; Art. 66a, "payment accepted", covers only a deemed supplier under Art. 14a (a marketplace or platform) and is **not** the basis for a store's own sales; an order paid in one period and supplied in a later one is dated by the payment under Art. 65 only for the amount received); a credit note by its
   `issued_on`. Finance dates an order by `placed_at`; the difference is a named line of the reconciliation (4.7), not an error.
3. **`vatMain` is not used for euro.** The brief says amounts are converted "only through the stored vatMain/vatHome figures". That holds for the **VAT
   report in the store's main currency**: each bucket is converted with the `fxRate` stored on its document (`snapshot.vatMain.fxRate`, the store's own rate on
   the day of issue), so the Σ of the converted VAT of an invoice's buckets equals its `vatMain.vatMinor` exactly (a test holds it). It cannot hold for the
   **OSS and IOSS euro figures**: the law asks for the ECB's rate of the *last day of the tax period*, not the store's rate on the day of issue, and the main
   currency may be the krone, not the euro. So the return view converts from the **document's own currency** (the buckets, stored, immutable) at the ECB rate
   of the period's last day, kept in `commerce.ecb_reference_rates` with its date (section 3). No rate is read from anywhere else, and nothing is converted at
   today's rate (4.5). A document in euro is not converted at all. `vatHome` is the seller's-country currency line of an invoice (Directive Art. 230) and is
   not read by 1c.
4. **Per-line facts the report needs, read from the snapshot.** 1b 3.4 says 1c reads only `buckets[*]`, `treatment.kind`, `vatMain` and `order.number`. The
   return views also need, from the snapshot: `buyer.type` (consumer or business), and the kinds of the lines (`lines[*].kind`: goods, download, service,
   booking, fee, gift), reduced to three booleans in SQL. None is personal data and all survive `anonymise_expired_documents()` (read:
   `commerce.anonymised_snapshot()` replaces name, company, numbers, email, address and delivery place only). The member state of consumption is **never**
   read from the snapshot (its address is anonymised later) but from `orders.market_code`, which is the delivery country (D109).
5. **The dispatch country (and, added after review, the seller's country and member state of identification) is not frozen on the order.** Whether goods go from a member state to another (Union scheme, part 2b or 2d), or into the EU from
   outside (import: IOSS or nothing), depends on where the store dispatches from. 1a keeps it only in the live profile (`store_tax_profile.dispatch_country`),
   so a later change would reclassify old orders. 1c adds one field to what the order freezes: `orders.vat_treatment.dispatchCountry`, written by `placeOrder()` from
   the same fact `decideTax()` already used (`seller.dispatchCountry`). Orders without it (renewals, which carry no treatment; orders from before this change) use the
   live profile's value and are counted as `dispatch_assumed` on the page. Production has no real history before September 2026, so the assumed set is small.
6. **Test-mode orders are in Finance.** `PAID` (`analytics-sql.ts`) does not exclude orders paid in Stripe's test mode, while 1b never invoices them. The reconciliation
   shows them as their own cause. Whether Finance should leave them out is a decision for the lead (a one-line change to `PAID` that moves every Finance figure);
   this unit does not make it.
7. **Retention for scheme users.** The OSS guide keeps records 10 years from the end of the year of the transaction (Reg. 282/2011 Art. 63c, read in the guide). 1b's
   constants anonymise a Norwegian invoice after 5 years. `retentionCutoff()` gains an option: for a store with an OSS registration or an IOSS number the period is
   at least 10 years (section 3.6). Nothing calls the anonymiser yet (1g does).

### 1.5 Gap texts the lead should rewrite at re-rating (the rows are not edited here)

1. `checkout.b2b-vat-id-reverse-charge-exemption`, gap item (1) is stale: "the invoice criterion is satisfied only by Kaizen's own invoice, unit 1b; until then no document
   says 'reverse charge'". Since D159 the invoice and the credit note print "Reverse charge" with both VAT numbers (`snapshot.treatment.statements`, `invoice-text.ts`,
   held by `order-document-view.test.ts`, `invoice-snapshot.test.ts`, `invoice-issue.int.test.ts`, `invoice-refunds.int.test.ts`). Replace it with: "(1) the invoice and credit
   note carry the reverse-charge statement and both numbers (D159); the wording is hand-written and unreviewed".
2. `checkout.oss-and-ioss-support` gap items (1) and (2), and `international.ioss` gap item (1): the OSS and IOSS reports are built by 1c, and the invoice carries the IOSS
   statement and the IOSS number (D159, `treatment.iossNumber`; held by `order-document-view.test.ts`). The remaining gaps are bucket B (a registration the owner holds, no
   register check), the unreviewed wording, the intrinsic-value question, and that **no return is filed by Kaizen**.
3. `checkout.eu-vat-by-destination-...` gap items (1) and (2): the report and its reconciliation are 1c; "the invoice takes that country's rate" is 1b (the snapshot's buckets
   carry each line's rate; held by `checkout-kinds.int.test.ts`). Items (3) to (6) stand.
4. `analytics.tax-and-vat-reports-...` gap: replaced by whatever remains after the tests hold (section 6): the reports are not a filing, an accountant must read them, and no
   browser test opens the page (section 6.5).

---

## 2. Behaviour

Written so a tester can follow it. "Store day" is the store's calendar day in `stores.time_zone`. "Document" is an invoice or a credit note of 1b. A **period** is half open,
`[from, to)` in whole store days, as in D152. Money is integer minor units with an ISO code; the store's **main currency** is `mainCurrency(store)`.

### 2.1 Shopper side

Nothing. No shopper page, route, email, cookie or storage item is added or changed (`KNOWN_COOKIES` unchanged; a source scan of the new files holds it). A shopper cannot reach
a report, and no report names a buyer: the reports hold no buyer name, address, email, company or VAT number (3.5).

### 2.2 Staff side (store)

**One page, three views**, `/admin/{store}/analytics/tax` (Analytics section, `analytics:read`), chosen by `?view=vat|oss|ioss`, with a period that depends on the view:

- **VAT** (default): the D152 period picker (today to this year, or a custom range of at most 800 days; the comparison control is not offered), default *last month*.
- **OSS**: a quarter, `?quarter=2026-Q3`, default the last completed quarter, and a mode `?mode=filing|books` (default `filing`).
- **IOSS**: a month, `?month=2026-09`, default the last completed month, and the same two modes.

Every view starts with a one-line statement that is always visible: *"These are your own figures, made from your invoices and credit notes, for you and your accountant. They are not a
tax return and Kaizen files nothing."* and a line "Made from N invoices and M credit notes. K paid orders in this period have no document and are not included (see Reconciliation)." with
a link to Invoices > Waiting when K > 0.

**The VAT view.** (a) Cards: *VAT charged* (invoices), *VAT credited* (credit notes), *VAT after credits*, *Net sales after credits*, *Invoices*, *Credit notes*, all in the main currency.
(b) **VAT by country and rate**: one row per delivery country, VAT rate, basis (`standard`, `reverse_charge`, `exempt`), document currency **and the place it is reported in** (a row never straddles two returns; **refined at build**): net, VAT, gross, invoices, orders, credit notes, VAT credited, VAT after
credits, and a last column *Reported in* naming the place the VAT belongs (4.3: *your own country's return*, *OSS Union 2b/2d/2a*, *IOSS*, *EC sales list / not VAT*, *not in an OSS return: reason*). Shipping is
inside the rates it was charged at (its bucket), as on the invoice. Rows are listed with the store's own country first, then by VAT after credits in the main currency, largest first (rows with no conversion last), then by country. Under the table a small stacked bar chart of VAT by country in the
admin's `--chart-*` tokens, **with its data table behind it** (D152). (c) **Reconciliation** (2.2.1). (d) The *not in the table* counts: documents left out because their currency has no stored rate (4.5), and
paid orders with no document.

**The OSS view** shows, for the chosen quarter and mode, as one table per part in the order of the return's layout (Commission guide Annex 3): **Part 2** supplies by part (*2a* services from the Member
State of identification, *2b* goods dispatched from it, *2d* goods dispatched from another Member State), per Member State of consumption, per rate: taxable amount, VAT, in euro, with the rate kind (standard
or reduced); **Part 3** corrections of earlier quarters (filing mode); **Part 4** the balance per Member State and **Part 5** the total due, with the guide's rules (a negative balance is shown, is reimbursed
by that Member State, and is never set off against another: it is not counted in Part 5). Under it: **Conversion** (the ECB rate and its date per currency, or the owner's override and its reason),
**Not in this return** (by reason: domestic sales that belong in the national return, reverse charge, business buyers, services, goods dispatched from outside the EU, exempt, markets outside the EU),
**Registration** (what the profile says and whether the sales fit it: 4.3) and the **deadline** ("Q3 2026: submit and pay by 31 October 2026", 4.4). A store with no OSS registration sees the same figures under
the heading *"What an OSS return would hold: no OSS registration is recorded (Settings > Tax)"*; nothing is hidden, and the exports say `registration = none`.

**The IOSS view** is the same, monthly, for sales marked `ioss` (D157), with the IOSS number and intermediary from the profile. **It is off when the store has no IOSS number and no sale marked IOSS**: the view says
*"IOSS: off. Needs an IOSS number and the markets it applies to (Settings > Tax). Until then no order is marked IOSS and there is nothing to report."* with the link (the row's criterion 4). With history (an order marked IOSS before the number was
removed) it shows that history. When the profile names an intermediary, the page says the intermediary normally files the return and that the file is the data to give them.

**Modes** (OSS and IOSS). *Filing* is what a return for that period holds, built to the law's rules: Part 2 is the period's invoices less credit notes **of the same period**; a credit note issued in a later period is a
**Part 3 correction** of the period of its invoice (4.6). *Books* is the bookkeeping view: every credit note counts in the period it was issued, as Finance counts a refund, so Part 2 can be negative. A line under the mode switch
says which one is open and what the other is for.

**Exports** (`analytics:write`, a POST, 2.2.2): the VAT view has *VAT by country and rate (CSV)*; the OSS and IOSS views have *Return data (CSV)* and *Conversion detail (CSV)*; the reconciliation has its own CSV.

#### 2.2.1 Reconciliation

A panel under the VAT view for the same period. It shows, **in each currency the store sold in** and then in the main currency, the bridge of 4.7: *Finance's VAT* (Σ `tax_minor` of paid orders placed in the period,
the figure of Finance's VAT card) → the named differences → *this report's VAT charged* (invoices in the period), each line with a count of orders and a plain sentence, and a sentence under it: *"Equal: every
difference is named."* A bridge that does not balance (a bug, never expected) says **"Does not reconcile"** in the alert colour and writes nothing else; the check is a test (6.1). Under the bridge, an informational line compares
*Finance's refunds without VAT* with *credit notes without VAT* for refunds made in the period and says the usual reasons they differ (rounding of up to one minor unit per refund, refunds of orders with no document, refunds still
pending). The main-currency bridge adds one named line, *Exchange-rate difference* (the report converts at each document's stored rate, Finance at today's rate), and one named *Rounding* line, as Finance's own bridge has.

#### 2.2.2 Exports, the log and drift

- Every export is a **POST** form on the page (`analytics:write`; a member who may only read sees the figures and a sentence *"Exports need the analytics role with write access"*), is formula-safe (`toCsv()`), and is written to the activity log (`analytics.tax_report_exported`, area `analytics`: period, view, mode, row count, never the amounts) and to `commerce.tax_report_exports` with its totals (3.2).
- **Drift.** When a period was exported before and its figures are now different (a waiting invoice issued with a supply date in it, a credit note, a corrected rate), the view says *"Changed since you exported this on {date}: VAT {+/-}{amount}. If you have already filed it, the difference belongs in your next return as a correction."* The comparison is the totals recorded at the last export; it is advice, never a block.
- An **incomplete** return is never exported as complete: if any group in the OSS or IOSS return has no euro rate (4.5) the *Return data* export is refused with the reason and the currency and date, and the *Conversion detail* export (which shows the gap) is allowed. The VAT export is never refused for a missing main-currency rate: it is written per document currency and leaves the main-currency columns empty and flagged (4.8).

**Euro rates.** A card on the OSS and IOSS views lists the currencies of the period, each with the ECB rate, its date and where it came from. A missing rate shows *Fetch from the ECB* and *Enter a rate*. Both are the **owner's** (`requireOwnerRole`, an `OWNER_ONLY_EXTRA` entry in the permission scan with its reason): fetching asks the ECB for that day only; entering needs a reason of at least 10 characters, is audit-logged (`analytics.tax_rate_override_set` with currency, date, old and new value) and is shown wherever the rate is used as *"owner's rate: {reason}"*. An override never changes a document.

**What needs you.** (analytics-and-ai area) The owner's overview and the store's Home add one "not urgent" attention item when the store has an OSS registration (`oss_scheme = 'union'` or `'non_union'`) or an IOSS number without an intermediary, a return period has ended, its deadline is within 14 days or has passed, and no *Return data* export is logged for that period in filing mode: *"Your OSS data for Q3 2026 has not been exported; it is due 31 October."* It never says a return is late for certain (Kaizen does not know what was filed).

**The AI manager** (read only, ungated, analytics-and-ai area): `vat_report` (VAT by country and rate for a period) and `oss_return_data` (a quarter or, with `scheme: "ioss"`, a month, in a mode) repeat the functions the page uses, with amounts written by `formatMoney`, and never make a number or a file. Both are served to Kaizen Life's assistant like every owner tool (D96). A playbook `vat-oss-ioss-reports` is added to `ASSISTANT_SKILLS` and the existing `vat-and-reverse-charge` playbook gets one line pointing to the new page.

### 2.3 Platform side

- No platform screen: a store's documents and reports are the store's (the 1b rule). Platform admins see nothing of a store's figures.
- The **daily job** (the `subscription-reminders` route, the daily one, where `syncStandardRates()` and `pruneVatChecks()` run; **corrected at build**: the spec first named the five-minute `cart-reminders` route) stores the ECB's latest rates once (`storeEcbRates()`): one request to `eurofxref-hist-90d.xml`, every day and currency inserted if absent. A failure is logged and never fails the job. So the rate of a quarter's last day is stored the next morning without anyone pressing a button.
- One row in the plan comparison (D132): *"VAT, OSS and IOSS reports"* (the migration inserts it; listed in no plan, as 1a and 1b did).

### 2.4 Emails

None. Nothing is emailed because of a report, an export, a drift or a missing rate.

### 2.5 A worked example (the numbers a tester can reproduce)

A Swedish store (SE), registered for the Union scheme with Sweden as Member State of identification, dispatching from Sweden, main currency SEK. In Q3 2026:

- 12 September, DE market, EUR: one invoice, net 100.00, VAT 19.00 at 19 %, gross 119.00.
- 12 September, DK market, DKK: one invoice, net 1,000.00, VAT 250.00 at 25 %, gross 1,250.00.
- 30 September's ECB rate is DKK 7.4755 per euro (the real value, read 2026-10-04).

OSS Q3 2026, **filing** mode, in euro: Part 2b, DE, 19 %: taxable 100.00, VAT 19.00 (no conversion). Part 2b, DK, 25 %: taxable `round(1000.00 / 7.4755) = 133.77`, VAT `round(250.00 / 7.4755) = 33.44`. Part 4: DE 19.00, DK 33.44. Part 5: **52.44**.
On 6 October the DK order is refunded half (gross 625.00, net 500.00, VAT 125.00): a credit note dated 6 October.
OSS Q4 2026, **filing**: Part 2: nothing. Part 3: Q3.2026, DK, VAT `-round(125.00 / 7.4755) = -16.72` (converted at the rate of the quarter it corrects, 4.6). Part 4, DK: -16.72 (Denmark reimburses it). Part 5: 0.00 (a negative balance is not counted). Q4 *books* mode shows the same VAT in Part 2 as a negative DK line at Q4's own rate. Q3 *filing* mode, opened again on 7 October, still shows 52.44 and, because the document set of Q3 is unchanged, no drift warning.

### 2.6 Edge cases

| Case | What happens |
|---|---|
| A paid order has no invoice (invoicing off, paid before `enabled_from`, waiting, failed) | Not in any table or file. Counted in the header line and in the reconciliation under its cause (`invoicing_off`, `waiting`), with a link to Invoices. |
| A paid order paid in Stripe's test mode | No invoice (1b), not in the report; in Finance, so a reconciliation line `test_mode`. |
| An invoice for an order Finance does not count as paid (a booking confirmed at the venue, payment still pending) | In the report; reconciliation line `not_captured`. |
| An order placed on 30 September at 23:50 and paid on 1 October | Report dates it 1 October (supply date), Finance 30 September: a `timing` line in each period, equal and opposite. |
| A credit note in a later quarter than its invoice | Books: counts in its own period. Filing: a Part 3 correction of the invoice's quarter (4.6). |
| A credit note in the same quarter as its invoice | Reduces Part 2 of that quarter (the return is not yet filed). If the owner has already filed that quarter, the drift line says so (2.2.2). |
| A credit note for a reverse-charge or exempt invoice | VAT 0; appears in the by-rate table under `reverse_charge` or `exempt`, never in an OSS return. |
| A refund of an order whose invoice is waiting, or a refund made while invoicing is off | No credit note (1b), so not in the report; the informational refunds line shows the difference. |
| A store that sells in several currencies | The VAT view is per document currency in the CSV and in the main currency on the page (stored rate per document). The OSS view groups by currency and converts each group once at the ECB rate (4.5). |
| A currency with no stored main rate on a document (`vatMain` null) | Left out of the main-currency table and counted ("N documents not converted: no rate was stored"); present in the CSV in its own currency with the main-currency columns empty. |
| A currency with no ECB rate for the period's last day (or the next publication day) | The OSS group is left out of the euro totals and counted; the totals say **incomplete**; the *Return data* export is refused; the owner can fetch or override (2.2.2). A quarter whose last day's rate is not yet published says "published after 16:00 CET on {day}". |
| The period's last day is not an ECB publication day | The next day of publication is used (Directive Art. 369h as read, 4.5); the card says which date was used. |
| A market outside the EU (Norway) | Never in an OSS or IOSS return. A store **established in that country** has the VAT in its own national return (`non_eu_market`); a store established anywhere else (a Swedish store with a Norway market) charged VAT of a country it is not established in: it is in no return here, listed under *Not in this return: market outside the EU, store not established there* (`non_eu_market_foreign`), and the page says the accountant must say where it is declared (a VAT registration in that country, import VAT). Changed after review: the first draft sent every non-EU market to *your national VAT return*. |
| Goods dispatched from outside the EU to an EU consumer, not marked IOSS | Not in a return here: listed under *dispatch outside the EU*, with the VAT that was charged at checkout (1a charges the destination country's VAT on every consumer sale); the page says an accountant must say where that VAT belongs (4.3). |
| A basket with a booking (appointment, stay, rental) | The order is not in an OSS return (place of supply follows the property or the performance, 4.3): *Not in this return: has a booked service*. |
| A business buyer without a valid VAT number (VAT charged) | Not in an OSS return (OSS is for supplies to non-taxable persons): *business buyer*. |
| Copied orders (`C-...`, D129) and hosts' orders (D71) | Never invoiced, so never in a table; never in a reconciliation line (Finance leaves them out too: `PAID`). |
| Anonymised documents (1g, after the retention period) | Identical in every figure: only personal fields are removed, never buckets, amounts, dates, kinds or the order's market (a test holds it). |
| Two exports of the same period | Both logged; the drift line compares with the latest. |
| The ECB feed is down | The daily job logs and carries on; the page shows the rate as missing and offers the fetch; a fetch failure says "the ECB could not be reached just now" and changes nothing. |
| Other languages | The admin is English only; CSV headers are fixed English identifiers. |

### 2.7 Failure behaviour

- The reports are read-only. A failing report query shows an error card for that view and never breaks the page's other views, the invoices page, Finance or checkout.
- A rate fetch, an override and an export write only their own rows; none touches a document, an order or a payment.
- The log write of an export happens in the same request as the file; if the log cannot be written the file is **not** served (an export that is not logged would defeat the drift line), and the page says to try again.
- A query that would exceed the budget (the perf test of 6.4: 5,000 documents in two seconds) is not cut short: the page streams its cards, each from its own `<Suspense>`, and the view never shows partial numbers as complete.

---

## 3. Data

All new tables live in `commerce` (private), have row-level security enabled with no policy (as every commerce table), are in `src/db/schema.ts` (migration by `pnpm db:generate`), and every foreign key has an index.
Money is integer minor units plus an ISO code; rates are `numeric`.

### 3.1 Reference data: the ECB's rates (platform-wide, no `store_id`)

`commerce.ecb_reference_rates (rate_date date not null, currency char(3) not null, rate numeric(18,6) not null check (rate > 0), source text not null default 'ecb' check (source in ('ecb')), fetched_at timestamptz not null default now(), primary key (rate_date, currency))`.
Units of the currency per 1 EUR, as the ECB publishes them (up to five decimals today, GBP 0.85463). **Append-only**: a trigger refuses an `UPDATE` and a `DELETE` (it raises; it contains no `DELETE`), because a stored rate is part of what a filed return rested on. A day already stored is never replaced: the writer inserts `on conflict do nothing`, and a difference between a stored and a re-fetched value is logged by the job (`ecb.rate_differs`), never applied. The euro itself has no row (rate 1).
It has no `store_id`, so it is outside `COPY_RULES`, like `vat_rates`. Kept for ever (about 30 currencies by 250 days by year; no personal data).

### 3.2 Per-store tables

- **`commerce.tax_rate_overrides (store_id, currency char(3), rate_date date, rate numeric(18,6) check (rate > 0), reason text not null check (length(btrim(reason)) between 10 and 300), set_by uuid not null fk accounts, set_at timestamptz not null default now(), primary key (store_id, currency, rate_date))`.** The owner's rate for a currency on a day, used instead of the ECB's for that store only. `rate_date` must be a quarter's or a month's last day or a day in the ECB table's reach (no check beyond a plausible window: not in the future, not before 2021-07-01). A change writes the audit entry with the old and new rate (the audit log is the history); the row is an upsert. `COPY_RULES`: **`never`** ("An owner's rate for a filed period belongs to that store's own returns").
- **`commerce.tax_report_exports (id uuid pk, store_id fk, report text check in ('vat','oss','oss_detail','ioss','ioss_detail','reconciliation'), scheme text null check in ('union','non_union','ioss'), period_key text not null ('2026-Q3', '2026-09' or '2026-09-01..2026-09-30'), mode text null check in ('books','filing'), rows integer not null, totals jsonb not null, exported_by uuid not null fk accounts, exported_at timestamptz not null default now())`.** `totals` holds only aggregate numbers: `{ currency, vatMinor, taxableMinor, documents, creditNotes, incomplete }`: no buyer, no document number. Append-only (a trigger refuses `UPDATE` and `DELETE`). Index `(store_id, report, period_key, exported_at desc)`. `COPY_RULES`: **`never`** ("A log of the original's exports"). Kept for ever (a handful of rows a year; no personal data).
- **No other table.** Reports are computed on read from the 1b and 1a tables.

### 3.3 Existing tables read, and one frozen fact added

- `commerce.invoices` and `commerce.credit_notes`: `id, order_id, invoice_id, document_number, supply_date, issued_on, currency, net_minor, tax_minor, total_minor, vat_kind, source`, and from `snapshot` only: `buckets[*]` (`rate`, `basis`, `netMinor`, `vatMinor`, `grossMinor`), `vatMain` (`currency`, `fxRate`), `buyer.type`, `lines[*].kind`. Nothing else of the snapshot is selected (3.5).
- `commerce.orders`: `market_code`, `copied_from`, `host_id`, `tax_minor`, `placed_at`, `vat_treatment->>'dispatchCountry'` (the new frozen field).
- `commerce.countries`: `in_eu`. `commerce.store_tax_profile`: `oss_scheme`, `oss_member_state`, `ioss_number`, `ioss_intermediary`, `dispatch_country`, `oss_registered_on`, `ioss_registered_on` (read in application code, never the numbers' check results).
- **Added to what an order freezes (1.4 point 5):** `OrderVatTreatment` gains `dispatchCountry: string | null` (`src/lib/vat-treatment.ts`: the type, `buildOrderTreatment()` and `parseOrderTreatment()`, additive and optional on read); `TreatmentFacts.dispatchCountry` is filled in `src/server/tax-treatment.ts` from the seller facts it already holds. `vat-readers.test.ts` is unaffected (the TypeScript does not read the column; the SQL function does).
- **New index** `invoices_supply_idx on invoices (store_id, supply_date)` (the VAT view's range scan); `credit_notes (store_id, issued_on)` and `invoices (store_id, issued_on)` exist.

### 3.4 The one database reader of documents: `commerce.tax_document_groups()`

`commerce.tax_document_groups(p_store uuid, p_from date, p_to date) returns table (...)`, `STABLE`, `LANGUAGE sql` or `plpgsql`, `SET search_path = ''`, **no `DELETE`, `TRUNCATE` or `DROP`**. It returns the documents whose **tax date** is in `[p_from, p_to)` (an invoice's `supply_date`, a credit note's `issued_on`), **grouped**, one row per distinct combination of the columns marked *key*, with the amounts summed. It is the only code that opens a document's snapshot for a report.

| Column | Meaning |
|---|---|
| `doc_kind` *key* | `invoice` or `credit_note` |
| `tax_date` *key* | the invoice's `supply_date`, the credit note's `issued_on` |
| `original_tax_date` *key* | for a credit note, the `supply_date` of its invoice; null for an invoice |
| `market_code` *key*, `market_in_eu` | `orders.market_code` of the document's order; `countries.in_eu` |
| `currency` *key*, `main_currency` | the document's currency; `commerce.main_currency(store)` (the store's main currency now) |
| `fx_state` *key*, `fx_rate` *key* | `same` (document currency = main), `stored` (`snapshot.vatMain.fxRate`, and only when `vatMain.currency` is the store's main currency now) or `missing` (currency differs and `vatMain` is null or converts to another currency) |
| `vat_kind` *key*, `buyer_type` *key* | the invoice's `vat_kind`; `snapshot.buyer.type` |
| `has_physical`, `has_download`, `has_service` *key* | from `lines[*].kind`: physical = `goods` or `gift`; download = `download`; service = `service` or `booking`; `fee` follows the rest of the order (4.3) |
| `dispatch_country` *key*, `dispatch_source` *key* | `orders.vat_treatment->>'dispatchCountry'` (`order`); else the live profile's effective dispatch country, which is the profile's `dispatch_country` or else the store's own country (`profile`); else null with the source `unknown` |
| `seller_country` *key*, `seller_oss_member_state` *key*, `seller_source` *key* | **added after review.** The country the store was established in and the member state it was identified in for the Union scheme, **as the order froze them**: `orders.vat_treatment->>'sellerCountry'` and `->>'ossMemberState'` (`order`, when both keys are present: a JSON null is a fact, so a store with no member state of identification keeps none); else the store's live country and the profile's `oss_member_state` (`profile`, an order placed before they were frozen, counted as `seller_assumed`). Editing the store's country or registration later therefore moves no document's sale to another part of a return. |
| `rate` *key*, `basis` *key* | the bucket's rate (a fraction) and basis (`standard`, `reverse_charge`, `exempt`, `ioss`) |
| `standard_rate` *key* | `commerce.vat_rate(market_code, 'standard', tax_date)` (the allowed reader), so the code can tell a standard from a reduced rate on that day |
| `documents`, `orders` | number of distinct documents in the row; for invoices the number of distinct orders (one per invoice), for credit notes 0 |
| `currency_orders`, `kind_documents` | totals that cannot be made by adding rows, because a document with two rates is in two rows: the distinct orders with an invoice in the period in that currency (the same on every row of the currency), and the distinct documents of that `doc_kind`, currency and `fx_state` (the same on every row of that combination). **Added at build.** |
| `net_minor`, `vat_minor`, `gross_minor` | sums of the buckets, in the document currency; a credit note's amounts are positive and `doc_kind` says they reduce |
| `net_main_minor`, `vat_main_minor`, `gross_main_minor` | the same sums in the main currency, **each bucket converted on its own** with the document's stored rate (`commerce.convert_with`, the snapshot's own conversion), so the converted VAT of an invoice equals its stored `vatMain.vatMinor` exactly; null when `fx_state` is `missing`. **Added at build:** converting a sum of many documents at once could not honour that equality. |

Rows are a few hundred per quarter even for a large store (days by countries by rates). The function filters `store_id` first and joins `orders` on `(store_id, order_id)`. Copied and host orders have no document, so none appears; the function does not need to test for them, and a database test proves it. The server calls it through `setBased()` (`src/server/analytics-totals.ts`: a read-only transaction with no nested loops), so a store with no planner statistics cannot explode (`tax-reports-perf.int.test.ts`).

### 3.5 What is private

The reports hold no buyer name, address, email, company, organisation number or VAT number, and no document number in an aggregate. Only the function above opens snapshots, and it names only the paths of 3.3. Held by tests: (a) the function's source (`pg_get_functiondef`) contains none of `name`, `company`, `address`, `email`, `vatNumber`, `organisationNumber`, `deliveryPlace`; (b) the TypeScript modules of this unit contain no `snapshot` path outside the list, and none of them is under `src/app/s/` (no shopper route reads them); (c) `document-readers.test.ts` lists exactly one new reader, `src/server/tax-reconciliation.ts` (it reads `invoices.order_id`, `supply_date`, `tax_minor`, `currency` only), and the other new modules call the function and name neither table; (d) none of the report, sitemap, `llms.txt`, feeds, search, chat agent, recommendations or integration payloads imports a tax-report module. The exports and tool answers hold only the aggregate columns of 4.8. The ECB and override tables hold no personal data.

### 3.6 Copy, retention, privacy summary

| Table or change | `COPY_RULES` / copy | Retention |
|---|---|---|
| `ecb_reference_rates` | no `store_id` (outside the audit) | for ever |
| `tax_rate_overrides` | `never` | for ever with the store |
| `tax_report_exports` | `never` | for ever (no personal data) |
| `commerce.tax_document_groups()` | a function; nothing to copy | none |
| `retentionCutoff(country, today, { scheme: boolean })` in `src/lib/invoice-retention.ts` | pure | for a store with `oss_scheme <> 'none'` or an IOSS number the period is `max(country period, 10 years)` (Reg. 282/2011 Art. 63c as the guide states, *verify*); 1g passes `scheme`; the 5-year floor of `anonymise_expired_documents()` is unchanged |

`duplicate_store()` and `clone_store()` need no patch: no copied table is added.

---

## 4. Rules and law

Every rule sits in one pure function with its source in a comment, a test table, and *needs review by an accountant*. This is where a correction is made.

### 4.1 What is read

Documents only (1.4 point 1). The tax date of a document is its `supply_date` (invoice) or `issued_on` (credit note) (1.4 point 2). The country of a document is its order's `market_code`. Amounts are the buckets' in the document's currency. Reverse-charge buckets have rate 0 and basis `reverse_charge`; an exempt product's bucket has rate 0 and basis `exempt`; IOSS is not a bucket basis but the order's `vat_kind` (1b 4.1). Shipping is inside the bucket of its rate (1b 4.1).

### 4.2 Definitions of the figures (the foundation agent writes this table into `docs/analytics.md` as "Tax reports (D161)" before any code, as D152 requires; the table here is the source)

| Term | Definition |
|---|---|
| **Document** | An invoice or a credit note (D159). Copied (`C-...`) and hosts' orders have none. |
| **Tax date** | Invoice: `supply_date`. Credit note: `issued_on`. Store days. |
| **VAT charged** | Σ `vat_minor` of the invoices whose tax date is in the period, per document currency; in the main currency Σ over documents of `round_half_up(vat_minor x fxRate)` per bucket with the document's stored `snapshot.vatMain.fxRate`, done in SQL per bucket (`vat_main_minor`; no conversion when the document is in the main currency). |
| **Net sales / Gross** | The same sums of `net_minor` and `gross_minor`. |
| **VAT credited** | Σ `vat_minor` of the credit notes whose tax date is in the period, converted in the same way (the credit note's own `vatMain.fxRate`, which is its invoice's). Shown negative in tables and files. |
| **VAT after credits** | VAT charged less VAT credited. Per document the main-currency conversion of a credit note can differ from its `vatMain.vatMinor` by at most one minor unit per bucket (its stored figure is the difference of cumulative conversions, 1b 4.5); a test holds the bound. |
| **Orders** | Per row, the number of distinct orders with an invoice in the period that has a bucket in the row; the total is the number of distinct orders (not the sum of the rows). |
| **Delivery country** | `orders.market_code` (D109: the market is the country). |
| **Not converted** | Documents in a currency other than the main one whose `vatMain` is null: left out of the main-currency table and counted; present in the CSV in their own currency. |
| **Finance's VAT** | `periodTotals().totals.vatMinor` (Σ `tax_minor` of `PAID` orders placed in the period, converted at today's rates), and per currency the unconverted Σ. |
| **Taxable amount, VAT amount (return)** | Σ `net_minor` and Σ `vat_minor` of the documents in a return's group (4.3), per document currency, converted once per group to euro (4.5). |

### 4.3 Where a sale is reported: `classify()` (`src/lib/tax-classes.ts`)

Pure, one function, a closed list of results, a test matrix. Input: the order-level facts of 3.4 (vat kind, buyer type, market and `market_in_eu`, the three line booleans, dispatch country, the seller's frozen country and member state of identification) and the bucket's basis. The seller is never read from the store's settings of today (`classOfGroup()` takes it from the group). Output: `{ place, part, reason }`. Evaluated in this order; the first that applies decides.

| # | Condition | Place | Part / reason |
|---|---|---|---|
| 1 | bucket basis `exempt` | not in a return | `exempt` (decided per bucket; all the following per order) |
| 2 | `vat_kind = 'ioss'` | IOSS return (monthly) | `IOSS` |
| 3 | `vat_kind = 'reverse_charge'` | not in a return | `reverse_charge` (an exempt intra-Community supply or a service the buyer accounts for; the EC sales list is not built, section 7) |
| 4 | buyer type `business` | not in a return | `business_buyer` (VAT was charged; OSS is for supplies to non-taxable persons) |
| 5 | market not in the EU, and the seller's frozen country = the market | national return | `non_eu_market` (a Norwegian store's sale to Norway: the VAT of Norway belongs in the Norwegian return) |
| 5b | market not in the EU, seller established elsewhere (or no country on record) | not in a return | `non_eu_market_foreign` (the VAT charged is for a country the store is not established in: neither an OSS or IOSS return nor the store's own national return; ask your accountant where it is declared) |
| 6 | order has a booking or service line | not in a return | `has_service` (the place of supply of an appointment, a stay or a rental follows the performance or the property, not the buyer: *verify*) |
| 7 | order has physical goods and the dispatch country is not an EU member state | not in a return | `dispatch_outside_eu` (an import: IOSS if it had qualified, else VAT is settled with customs; **the VAT charged at checkout has no return here: ask your accountant**) |
| 8 | order has physical goods and dispatch country = market | national return | `domestic` (a domestic sale of goods dispatched and delivered in the same country is not an intra-Community distance sale: it goes in that country's own VAT return) |
| 9 | order has physical goods, dispatch country in the EU and different from the market | Union scheme | `2b` when the dispatch country equals the Member State of identification (the profile's `oss_member_state`, else the store's country), else `2d` (guide Annex 3: 2b goods dispatched from the MSI, 2d from another Member State) |
| 10 | no physical goods (downloads and fees only), seller established in the EU, market = the seller's country | national return | `domestic` |
| 11 | no physical goods, seller established in the EU, market in the EU and different | Union scheme | `2a` (electronic services supplied from the MSI to a consumer in another Member State) |
| 12 | no physical goods, seller not established in the EU, market in the EU | non-Union scheme | `NU` (guide: the non-Union scheme covers services supplied to non-taxable persons in the EU) |

Notes, each a flag in the result and a count on the page: `fee` lines follow the order (an accessory supply takes the treatment of the principal one: *verify*); an order with both goods and downloads is classed by its goods (`mixed_goods_download`, the download is carried with them, *verify*); `dispatch_assumed` when the dispatch country came from the live profile; `seller_assumed` when the seller's country and member state came from the live settings because the order froze none. A credit note takes the class of its invoice's order, so a refund can never land in a different return than the sale. A **rate kind** is `standard` when the bucket's rate equals `standard_rate` on the tax date, else `reduced` (the guide's boxes know a standard and a reduced rate; how a Member State wants a *zero* rate declared is not read: it is shown as `reduced`, *verify*). Every fact falls into exactly one place (a partition test: Σ over places = Σ over all documents, per currency).

**Registration fit** (`registrationNotes()`, pure): a warning, never a block, when the classes found do not match the profile: sales that fit the Union scheme while `oss_scheme = 'none'`; services in the non-Union class while the profile says `union` (or goods while it says `non_union`, a scheme for services only); IOSS sales with no IOSS number; IOSS markets in the profile that no sale touched is *not* a warning. The country of an EU-established store is **never** a Member State of consumption in the Union scheme for services (guide Part 1: such supplies are domestic), which is rule 10.

The first column of the VAT table (*Reported in*) shows `place` and `part`; so the by-rate table and the returns can never disagree about where a sale belongs.

### 4.4 Periods, deadlines, dates (`src/lib/tax-periods.ts`)

- OSS (Union and non-Union): the calendar quarter, `Q1` 1 January to 31 March, and so on; return and payment due by the end of the month after: **30 April, 31 July, 31 October, 31 January** (guide Part 2 point 2, read). The deadline does not move for weekends or holidays (guide). A return may not be submitted before the period ends (guide): the view shows an open quarter as "in progress".
- IOSS: the calendar month; due by the end of the following month (guide, read).
- Period keys: `2026-Q3`, `2026-09`. `lastDay(period)` is the day before `to`. Store days throughout; a document's tax date is already a store day, so no time zone arithmetic is done on documents.
- Chargeable event: a store's own sales are dated by the payment day, the invoice's `supply_date` (1b 4.2), because a payment received on account makes VAT chargeable on the amount received (Directive Art. 65, with Art. 63 for the delivery or performance, *verify*). Art. 66a ("when the payment has been accepted") is the rule for a deemed supplier under Art. 14a only and is not relied on. An order paid in one period and supplied in a later one is dated by the payment only for the amount received: the accountant reads this. A booking's own date is not used (such orders are not in a return).

### 4.5 Conversion to euro (`src/lib/ecb-history.ts`, `src/lib/oss-return.ts`)

- The return is in **euro** (guide Q15; Skatteverket read). A Member State of identification that is outside the euro area may require its national currency (guide): the view says "your Member State may require {currency}: ask" for a store whose MSI's currency is not the euro, and does not convert to it (section 7).
- **The rate** for a currency is the ECB's reference rate of the period's **last day**, or, if none was published that day, **of the next day of publication** (Directive Art. 369h as read; guide Q15). `ecbRateFor(rates, currency, day)` returns `{ rate, date }` or `null` when that day is not yet published or the currency is not published. An owner's override for `(store, currency, lastDay)` wins and is labelled. A document in euro is not converted.
- **Where rates come from:** `commerce.ecb_reference_rates`, filled by the daily job from `eurofxref-hist-90d.xml` and, on demand for an older period, from the ECB data portal's single-series CSV for the needed days (`https://data-api.ecb.europa.eu/service/data/EXR/D.{CCY}.EUR.SP00.A?startPeriod={d}&endPeriod={d+7}&format=csvdata`; any answer that is not HTTP 200 with the expected columns is "unavailable") or, failing that, from `eurofxref-hist.xml` (8.2 MB: accepted up to 16 MB, only the wanted days parsed). The hosts and paths are **constants** in `src/lib/ecb-history.ts`; no part comes from a person or from stored data; the fetch is injectable, `cache: "no-store"`, 10 s timeout, the answer read as text with a size cap. Nothing is converted at today's rate: a period whose rate is not stored is incomplete, not estimated.
- **Arithmetic** (`toEuroMinor(amountMinor, rate)`, BigInt, no floats): `eur = round_half_up(amount / rate)` in minor units (every currency has two decimals, `src/lib/money.ts`), the rate read as a decimal string with at most six decimals; the amount's sign is kept and the rounding is applied to the absolute value, so a credit is the exact negative of the same invoice amount. **Conversion is done once per group**: the unit of conversion is `(period, part, Member State of consumption, rate, document currency)`; taxable amount and VAT are each summed in the document currency first and converted once. Rounding therefore does not accumulate per document; the price is that the euro VAT can differ from `taxable x rate` by a few cents. The conversion detail file and the page show both so an accountant can see it. *Whether a Member State tolerates this is not read: needs review.*
- **Corrections are converted at the rate of the period they correct** (4.6), once per `(period corrected, part, Member State, rate, document currency)` group (the conversion detail file shows each; the Part 3 line of the return sums them per period corrected and Member State), so the corrected period's total in euro is what that period's return would have shown had the credit existed. *Not read; needs review.*

### 4.6 Books and filing: credit notes and corrections (`src/lib/oss-return.ts`)

Both modes are a function of the same groups and rates; they differ only in where a credit note goes.

- **Books** (the Finance rule): a credit note is a negative line in the period of its own tax date. Part 2 can be negative; there is no Part 3.
- **Filing** (the law as read): a credit note whose tax date is in the **same period as its invoice's tax date** reduces Part 2 of that period; a credit note in a **later** period is a **Part 3 correction** of the invoice's period: rows `(period corrected, Member State of consumption, VAT amount)`, converted at the corrected period's rate (guide Part 2 Q4 and Q12; Q11: made in a subsequent return, within three years). A Part 2 group is never negative in filing mode because a credit never exceeds its invoice per rate (the database holds it, 1b 3.3). The balance per Member State (Part 4) is its Part 2 VAT plus its Part 3 corrections and may be negative; **the total due (Part 5) is the sum of the positive balances only** (guide: a negative balance is never set off against another Member State's). The three-year limit for corrections (guide Q11) is shown beside a correction older than three years ("after three years the correction is made with the Member State of consumption directly, not through the OSS").
- A credit note issued in the **same** quarter as its invoice is netted even when the owner has already filed that quarter; the drift line (2.2.2) is how the owner learns it.
- The sum over all periods of Part 2 plus Part 3 equals the sum of the invoices less the credit notes, per document currency (a property test in a one-currency store).

### 4.7 The reconciliation (`src/lib/tax-reconciliation.ts`, `src/server/tax-reconciliation.ts`)

Per document currency `c` and period `P`, in integer minor units (no conversion):

- `F` = Σ `orders.tax_minor` over `PAID` orders (`analytics-sql.ts`: not copied, not a host's, a captured payment exists) whose `placed_at` store day is in `P`. This is Finance's VAT, and also the brief's "Σ of the orders' `tax_minor`".
- `R` = Σ `invoices.tax_minor` with `supply_date` in `P`.
- The bridge: `R = F + timing_in + not_captured - timing_out - invoicing_off - test_mode - waiting - other`, where
  - `timing_in`: invoices in `P` of orders placed before `P`;
  - `not_captured`: invoices in `P` of orders that `PAID` does not count (no captured payment: a booking confirmed at the venue), wherever the order was placed (**refined at build**: "placed in `P`" left the case of an order placed earlier unnamed);
  - `timing_out`: `PAID` orders placed in `P` whose invoice's `supply_date` is outside `P` (after it in practice; before it cannot happen, and would be named here too, so the identity stays exact);
  - `invoicing_off`: `PAID` orders placed in `P` with no invoice because `commerce.invoice_eligibility()` says `disabled`;
  - `test_mode`: the same with `test_mode`;
  - `waiting`: the same where the order is eligible (`ok`) and the invoice is waiting or failed;
  - `other`: any remaining order without an invoice (`zero_total`, `not_paid`).
  Each cause is a Σ of `tax_minor` and a count of orders. The identity holds **exactly in every currency**; `reconcile()` returns `balanced` and the page and the tests use it. In the **main currency** each cause is converted at today's rates like Finance (the same `inMain()`/`toMain()`), the report's own figure is shown **at the stored rates** as well, and the two named lines *Exchange-rate difference* (stored against today) and *Rounding* close the bridge.
- **One snapshot** (added after review): the VAT view's documents, the bridge's two sums and the refunds line are read in one read-only `REPEATABLE READ` transaction (`taxSnapshot()`, `setBasedSnapshot()`), so an invoice issued by the cron while a page is made is in all of them or none and never produces a spurious *Does not reconcile*; the page, the AI tool and the standalone `reconciliation()` all use it.
- **No stored rate** (added after review): in the main-currency bridge, invoices whose row the VAT report leaves out of the main-currency figure because a document holds no stored conversion are carried on their own line, *Invoices with no stored rate* (their VAT converted at today's rate, counted), and are taken out of the report-today sum, so *Exchange-rate difference* holds only stored-against-today differences of documents that have a stored rate.
- The *Finance's VAT* line equals `periodTotals().totals.vatMinor` for the same period and store (a test holds it, 6.1), so the report reconciles to the Finance VAT card itself and not to a second query.
- **Credits:** the informational comparison of *Finance's refunds without VAT* (`refundsReport()` figures) with Σ credit notes' `net_minor` for refunds in the period has no identity; its tolerance in the simple test scenario is the number of refunds in minor units.

### 4.8 The exports (`src/lib/tax-csv.ts`, fixed layouts held by a test)

All use `toCsv()` and `decimalAmount()` (`src/lib/dac7.ts`: decimals with a point, formula-safe), UTF-8, CRLF, one header row, **no totals row** (an accountant sums; a total row mixed into data is a spreadsheet hazard). Credit amounts are negative. File names: `vat-{store}-{from}_{to}.csv`, `oss-{store}-{period}-{mode}.csv`, `oss-detail-...`, `ioss-...`, `reconciliation-...`.

1. **VAT by country and rate** (`vat`): `period_from,period_to,country,vat_rate_percent,basis,reported_in,currency,invoices,orders,net,vat,gross,credit_notes,credit_net,credit_vat,credit_gross,net_after_credits,vat_after_credits,gross_after_credits,currency_main,net_after_credits_main,vat_after_credits_main,main_converted`. One row per `(country, rate, basis, document currency, place reported in)` (refined at build: the place is part of the key, so `reported_in` is exact); `period_to` is the last day included; the main-currency columns are empty and `main_converted = false` when no stored rate exists; `reported_in` is the place and part of 4.3 as text.
2. **Return data** (`oss`, `ioss`): `scheme,tax_period,part,member_state_of_consumption,dispatch_member_state,vat_rate_percent,rate_kind,taxable_amount_eur,vat_amount_eur,correction_period,mode,registration,currency`. `dispatch_member_state` (**added after review**: Directive Art. 369g(2) asks for the totals per Member State of dispatch of goods) is set on `2b` rows (the Member State of identification) and `2d` rows (another Member State) and blank on services, Part 3, 4 and 5 and IOSS; two dispatch states for the same Member State of consumption and rate are two rows. The VAT or tax number the dispatch Member State allocated is **not** held by Kaizen: the owner enters it on the return (the page says so). Part 2 rows (`part` = `2a`, `2b`, `2d`, `NU`, `IOSS`) carry a rate and both amounts; **Part 3** rows (`part` = `3`) carry `correction_period` and only `vat_amount_eur` (the guide's Part 3 has no taxable amount), one row per `(period corrected, Member State)` summed over rates and currencies; **Part 4** rows (`4`) the balance per Member State; **Part 5** (`5`) one row with the total due. `registration` is `union`, `non_union`, `ioss` or `none`; `currency` is always `EUR`. Refused when a group has no rate (2.2.2).
3. **Conversion detail** (`oss_detail`, `ioss_detail`): `tax_period,part,member_state_of_consumption,dispatch_member_state,vat_rate_percent,rate_kind,original_currency,taxable_amount_original,vat_amount_original,conversion_rate,rate_date,rate_source,taxable_amount_eur,vat_amount_eur,invoices,credit_notes,correction_period`. One row per conversion group, so the records of the return (Reg. 282/2011 Art. 63c: currency, rate, amounts) are reproducible; `rate_source` is `ecb` or `owner: {reason}`.
4. **Reconciliation** (`reconciliation`): `period_from,period_to,currency,cause,direction,orders,vat_original`. One row per cause, including `finance` and `report`. `vat_original` is always positive; `direction` (**added after review**) is `1` for a cause that is added to Finance's figure on the way to the report's (`timing_in`, `not_captured`), `-1` for one taken away (the others) and blank on `finance` and `report`, so `finance + Σ(direction × vat_original) = report` can be checked in a spreadsheet for each currency.

The layouts are the interface to an accountant's spreadsheet: a change to a header is a change to this section first.

### 4.9 Who may do what

Members with `analytics:read` see the three views; `analytics:write` exports; **only owners** fetch or enter an ECB rate (the figure of a return depends on it). Platform admins see no store's reports. A shopper reaches nothing. Nobody edits a document through a report. The AI manager's tools need `analytics:read` and the connected owner's role through the existing tool-permission check.

---

## 5. Where things live

Areas: **foundation** (schema, migration, database function, pure libraries and their tests), **server**, **admin**, **analytics-and-ai**. There is **no shopper area** (2.1: nothing shopper-facing). An area edits only its own files; the registries are small edits by the area named, each at a known anchor.

### 5.1 Foundation

| File | What |
|---|---|
| `src/db/schema.ts` | `ecbReferenceRates`, `taxRateOverrides`, `taxReportExports`; the index `invoices_supply_idx` |
| `supabase/migrations/{ts}_tax_reports.sql` (generated by `pnpm db:generate`) and `{ts}_tax_reports_rules.sql` (custom: `pnpm exec drizzle-kit generate --custom --name tax_reports_rules`) | the tables, the append-only triggers (they only `RAISE`), `commerce.tax_document_groups()`, the plan-feature row (*"VAT, OSS and IOSS reports"*, in the existing analytics category of `plan_features` if there is one, else "Checkout and selling"; listed in no plan) |
| `src/lib/tax-periods.ts` | quarters and months, period keys, `lastDay()`, `deadlineOf()`, the guide's deadlines |
| `src/lib/ecb-history.ts` | the constants (hosts, paths), `parseEcbHistory()` (the 90-day and full XML), `parseEcbCsv()`, `ecbRateFor()` (the day or the next publication day), `toEuroMinor()` (BigInt) |
| `src/lib/tax-classes.ts` | `classify()` (4.3), the reason codes and their plain sentences, `registrationNotes()` |
| `src/lib/tax-report.ts` | the VAT table from the function's groups: rows, totals, distinct orders, `reported_in`, main-currency conversion with the stored rate, `notConverted` |
| `src/lib/oss-return.ts` | the Union, non-Union and IOSS return data: groups, parts, conversion once per group, books and filing, Part 3, Part 4, Part 5, `incomplete`, deadlines |
| `src/lib/tax-reconciliation.ts` | the bridge (4.7): `reconcile()`, `balanced`, the named lines, the main-currency lines |
| `src/lib/tax-csv.ts` | the four layouts (4.8), their header constants, file names |
| `src/lib/vat-treatment.ts` | **edit**: `dispatchCountry` on `OrderVatTreatment`, `buildOrderTreatment()` and the parser (additive) |
| `src/lib/invoice-retention.ts` | **edit**: `retentionCutoff()` takes `{ scheme }` (3.6) |
| `src/lib/store-copy-rules.ts` | **registry**: `tax_rate_overrides: never(...)`, `tax_report_exports: never(...)` |
| `docs/analytics.md` | **edit**: the section "Tax reports (D161)" with the table of 4.2 (written first) |
| tests | `tax-periods.test.ts`, `ecb-history.test.ts`, `tax-classes.test.ts`, `tax-report.test.ts`, `oss-return.test.ts`, `tax-reconciliation.test.ts`, `tax-csv.test.ts`, additions to `invoice-retention.test.ts` and `vat-treatment.test.ts`, `src/db/tax-reports.test.ts` (PGlite) |

### 5.2 Server

| File | What |
|---|---|
| `src/server/tax-reports.ts` | `vatReport(store, period)`, `returnView(store, scheme, period, mode)`: call `commerce.tax_document_groups()` through `setBased()`, then the pure libraries; read the profile; read rates; never name `commerce.invoices` |
| `src/server/tax-reconciliation.ts` | `reconciliation(store, period)`: the Σ queries of 4.7 over `PAID` (`analytics-sql.ts`), `commerce.invoices` and `commerce.invoice_eligibility()`; **the one TypeScript module of this unit that names `commerce.invoices`** (added to `document-readers.test.ts`'s list); it is not under `analytics-*` because that test forbids analytics modules to read documents |
| `src/server/ecb-rates.ts` | `storeEcbRates({ fetch })` (daily), `fetchRatesForDay(currency, day, { fetch })` (on demand), `ratesFor(store, currencies, lastDay)` (stored, with overrides), the injectable fetch |
| `src/server/tax-rate-overrides.ts` | `setRateOverride(membership, input)` (owners, audit `analytics.tax_rate_override_set`), `listOverrides()` |
| `src/server/tax-report-exports.ts` | `logExport()`, `lastExport()`, `driftOf()` (4.7's drift line), the refusal when incomplete, the CSV text through `tax-csv.ts` |
| `src/server/tax-treatment.ts` | **edit**: `TreatmentFacts.dispatchCountry` filled from `facts.seller.dispatchCountry` |
| `src/app/api/cron/subscription-reminders/route.ts` | **edit** (the daily route, not `cart-reminders`): `storeEcbRates()` beside `syncStandardRates()`; never throws |
| `src/server/ecb-fetch.ts` | **added at build**: the only module that asks the ECB (constants only, injectable fetch, timeout, size cap); `ecb-rates.ts` holds the database side |
| `src/server/tax-reports-fixture.ts` | **added at build**: test support (a store selling from Sweden or Norway, orders paid on a past day by taking invoicing off while they are paid and issuing the waiting invoices afterwards); `invoice-test-fixture.ts` gains a `consent` option |
| tests | `tax-reports.int.test.ts`, the reconciliation cases are in `tax-reports.int.test.ts` (**no separate file**), `ecb-fetch.test.ts` (injected fetch; replaces `ecb-rates.test.ts`), `ecb-rates.int.test.ts`, `tax-reports.scan.test.ts` (privacy and who reaches a report, added at build), `tax-report-exports.int.test.ts`, `tax-reports-perf.int.test.ts` (an `analytics-perf`-style budget), `src/server/document-readers.test.ts` (**registry edit**), additions to `checkout-kinds.int.test.ts` (the euro scenario, 6.1) |

### 5.3 Admin

| File | Guard (the permission scan holds the literal key) |
|---|---|
| `src/app/admin/(gated)/[store]/analytics/tax/page.tsx`, `loading.tsx` | `analyticsContext(slug, query)` (`analytics:read`, the delegated guard) |
| `src/app/admin/(gated)/[store]/analytics/tax/export/route.ts` | a **POST**: `checkPermission(slug, "analytics:write")`, then `sameSite()`; a refusal redirects back with `?export=incomplete|forbidden|failed`, which the page turns into a fixed sentence (never text from the address) |
| `src/app/admin/(gated)/[store]/analytics/tax/actions.ts` | `fetchEcbRateAction`, `setRateOverrideAction`: `requireOwnerRole(slug)`; a fetch is limited to 10 requests an hour per store and 60 for all stores together (`takeEcbSlot()`, `commerce.chat_usage` bucket `ecb:fetch`, as VIES's limits) and only for a currency the ECB publishes (`ECB_CURRENCIES`, or one the daily job has stored), taking no slot when the rate is already stored, the request is invalid or the day has not come (added after review: a code the ECB does not publish used to end in the 8 MB full-history download on every call); the file is added to `OWNER_ONLY_EXTRA` in `permissions.scan.test.ts` with the reason *"an exchange rate changes the figures a tax return is made from"* |
| `src/components/admin/analytics/tax-view.tsx` | the VAT view (cards, table, chart with its data table, reconciliation panel) |
| `src/components/admin/analytics/oss-view.tsx` | the OSS and IOSS views (parts, conversion card, not-in-this-return, registration, deadline, mode switch, exports, drift, rate forms) |
| `src/components/admin/analytics/tax-skeletons.tsx` | `animate-pulse` placeholders |
| `src/lib/store-nav.ts` | **registry**: Analytics tabs: `item("/analytics/tax", "VAT", "VAT by country and rate, the quarterly OSS and monthly IOSS return data, and how they agree with your invoices and Finance.")`, after Finance |
| `src/lib/admin-map.ts` | **registry**: `store("analytics.tax", "/analytics/tax", "VAT, OSS and IOSS reports", "Analytics", "...", { keywords: ["vat", "moms", "mva", "oss", "ioss", "one stop shop", "return", "rate", "country", "accountant", "reconciliation"] })` |
| `src/lib/permissions.scan.test.ts` | **registry**: `OWNER_ONLY_EXTRA` entry for `actions.ts` above |
| tests | `tax-view.test.ts`, `oss-view.test.ts` (`renderToString`: a data table behind the chart, the always-visible "not a tax return" line, the off and incomplete states, owners-only forms, read-only members), `src/server/tax-report-admin.int.test.ts` (the route and the actions against the real guards and a stand-in for the sign-in: read-only member, analytics role, owner, another store's owner, nobody signed in) |

**Refined at build (admin).** Files added beside the table: `src/lib/tax-admin.ts` (pure: the address's `view`, `quarter`, `month`, `mode`, the period options, `taxHref()`, the export form's parser `parseExportForm()` and the fixed export sentences), `src/components/admin/analytics/tax-parts.tsx` (the always-visible statement, the view tabs, the POST export button). Deviations, all deliberate: (a) the VAT view's chart is the admin's `HorizontalBars` (VAT after credits per country, a ranked list that carries its figures) with a *Data behind the chart* table under it, not a stacked bar chart; (b) amounts on this page are written in English with a decimal point whatever the store's first market speaks, so the screen reads like the CSV; (c) the VAT view's period picker has no comparison control and its preset links name their period (`PeriodPicker` and `AnalyticsHeader` gained `showCompare` and `explicitPeriod`, additive), the default is the last month; (d) the export route takes `from` and `last` (the last day included) or a quarter or month key and the mode, redirects with `?export=period|incomplete|forbidden|failed` and a 404 for a member without `analytics:write`; (e) not built: the "your Member State may require {currency}" line of 4.5 (the view has no data for a Member State's currency) and a list of earlier exports (only the last export's date and the drift line); (f) the owner's rate forms sit in each row of the *Euro rates* table (fetch when the rate is missing, enter or change at any time), not in a separate card.

### 5.4 Analytics and AI

| File | What |
|---|---|
| `src/lib/owner-tools.ts`, `src/server/owner-tools.ts`, `src/server/tax-report-tools.ts` | two read tools `vat_report` and `oss_return_data` (zod arguments, descriptions, `TOOL_WORDS` lines); handlers call `tax-reports.ts` and `tax-reconciliation.ts`; amounts written by `formatMoney`; sums in code |
| `src/lib/owner-tool-permissions.ts` | **registry**: `vat_report: "analytics:read"`, `oss_return_data: "analytics:read"` |
| `src/lib/assistant-skills.ts` | **registry**: the playbook `vat-oss-ioss-reports`; one added line in `vat-and-reverse-charge` |
| `src/server/store-mcp.ts` | the store's MCP server serves every owner tool, so both are served there |
| `src/lib/control-center.ts`, `src/server/control-center.ts`, the store Home's attention list | **registry**: the not-urgent *OSS or IOSS data not exported* item (2.2), one query, owners only (the `taxAttention()` pattern); a pure `returnsDue(profile, exports, today)` in `src/lib/tax-returns-due.ts` |
| `docs/analytics.md` | the foundation agent writes the definitions; this area adds the sentence that the AI manager repeats them |
| `src/lib/plan-features` data | **registry (in the migration)**: one row, describes only (D132) |
| tests | `tax-report-tools.int.test.ts` (numbers equal the page's, a read-only member refused, another store's data never, no buyer field), `tax-returns-due.test.ts`, `tax-attention.int.test.ts` additions, the skill's test |

### 5.5 Registries, once more, and what is deliberately untouched

`store-copy-rules.ts`: foundation. `store-nav.ts`, `admin-map.ts`, `permissions.scan.test.ts`: admin. `owner-tool-permissions.ts`, `assistant-skills.ts`, control center: analytics-and-ai. `cart-reminders/route.ts`, `tax-treatment.ts`, `document-readers.test.ts`: server. **Unchanged, deliberately:** `i18n.ts`, `email-text.ts`, `ui-catalog.ts` (admin is English only, no shopper text), `KNOWN_COOKIES` (nothing set or stored), `store-translate.ts`, the sitemap, structured data, `llms.txt`, feeds, integration events, `next.config.ts` (no Chromium: the reports render in the admin and the CSV is text).

---

## 6. Acceptance criteria, row by row, mapped to tests

Test kinds: **unit** (`pnpm test`, pure), **PGlite** (`src/db/tax-reports.test.ts`, applies every migration as `commerce.test.ts` does, fixtures from `src/db/invoice-fixture.ts`), **int** (`pnpm test:int` on a fresh database after `scripts/db-setup.mjs --seed`, fake Stripe through the existing `vi.mock("./stripe")` pattern, an injected fetch for the ECB), **render** (`renderToString`). **There is no Playwright test**: the pages are behind the admin sign-in and the project's e2e has no signed-in session (as in 1a and 1b); the pages are held by render tests and the route and actions by `tax-report-admin.int.test.ts`. That is a stated gap (6.5). A new money read has a euro scenario in `checkout-kinds.int.test.ts` (section 6.1, criterion 4).

### 6.1 `analytics.tax-and-vat-reports-by-rate-and-jurisdiction`

| Criterion | Held by |
|---|---|
| 1. A VAT report lists, per country and VAT rate (including reduced and shipping rates), the net sales, the VAT and the number of orders for a period, reconciling to the Finance VAT total | Unit `tax-report.test.ts`: rows per country, rate and basis from literal groups; shipping at a different rate than its goods in its own row; a reduced-rate row; reverse charge at 0 with its basis; distinct orders (an order with two rates counts once in the total, once in each row); the total equals Σ rows; `reported_in` for each place of 4.3. PGlite: the function over fixture orders of every kind (physical, digital, mixed, subscription renewal, appointment, stay, rental) returns buckets equal to each invoice's snapshot, per rate; `Σ vat_minor` = `Σ orders.tax_minor` of the same orders per currency. Int `tax-reports.int.test.ts`: the same through the server with real `placeOrder()` orders in NOK, SEK and EUR markets; **reconciliation**: `tax-reconciliation.int.test.ts` builds each cause of 4.7 (an order placed on the last evening and paid after midnight, a test-mode order, a store with invoicing off, a waiting invoice, a venue booking, a copied order, a host's order) and asserts `balanced` in every currency, that copied and host orders appear in no line, and that the *Finance's VAT* line equals `periodTotals().totals.vatMinor` for the same store and period. Render: `tax-view.test.ts` (the table and the data table behind the chart, the reconciliation panel, the *Does not reconcile* state). |
| 2. An OSS view groups EU B2C sales by destination country and rate per quarter, in euro at a stated rate, and exports as CSV (formula-safe) | Unit `oss-return.test.ts`: the classification table of 4.3 row by row through `classify()`; parts 2a, 2b, 2d, NU; one conversion per group; `toEuroMinor()` half-up and sign symmetric (a property test: `toEuroMinor(-x) = -toEuroMinor(x)`; 100.00 at 1 is 100.00; 1000.00 DKK at 7.4755 is 133.77; 250.00 at 7.4755 is 33.44); the rate of the last day and of the next publication day (a Sunday quarter end); the override wins and is labelled; a missing rate marks the return incomplete and leaves the group out. `ecb-history.test.ts`: the 90-day XML and the portal CSV parsed from literal samples (the 2026-09-30 row: NOK 10.9015, SEK 11.331, DKK 7.4755), a non-200 and malformed answers are `unavailable`, only the constant hosts are requested, the full file's size cap. `tax-csv.test.ts`: the header of each layout is the constant of 4.8; a name `=1+1`, `+x`, `-x`, `@x`, a tab, a quote and a comma are neutralised or quoted; amounts are decimals with a point; Part 3 rows have no taxable amount; no totals row. Int: the worked example of 2.5 end to end (a store in SE: DE and DK orders, ECB rates inserted for 2026-09-30) gives exactly the Part 2, Part 4 and Part 5 of 2.5 and the CSV text; the export route refuses an incomplete return and logs a complete one (`tax_report_exports`), serves nothing when the log write fails. Render: `oss-view.test.ts` (the parts, the conversion card with rate and date, the not-in-this-return table, the off banner for a store with no registration, the deadline). |
| 3. Refunds and later credit notes reduce the period they are made in; copied and host orders are excluded | Int `tax-reports.int.test.ts` and `invoice`-fixture orders: a partial refund in the same period (`refundOrder()`, path P1 of 1b), a refund in a **later quarter** (books: reduces that quarter; filing: a Part 3 correction of the quarter of the invoice, converted at its rate; Part 4 negative balance is not in Part 5), a return refunded through D153 (path P5, one credit note, same period), a return refunded outside Kaizen (P8). The property: in a one-currency (EUR) store the sum over all quarters of Part 2 plus Part 3 equals Σ invoices less Σ credit notes. PGlite: copied and host orders never appear (no document exists; asserted by the function's output); `anonymise_expired_documents()` leaves every figure unchanged. Unit: a credit note takes the class of its invoice's order (no refund lands in a different return than its sale); a credit never makes a filing Part 2 group negative. |
| 4. A euro scenario test covers a store selling in more than one currency | `checkout-kinds.int.test.ts`, a new `describe("tax reports, D161")` in the file's own helpers: a NOK store with an SE market, a DK market and the euro view (`no-eur`): one order of each product kind in each currency, the VAT report's main-currency figures equal the Σ of the documents converted at their stored rates, the document currency columns of the CSV equal the orders', and the main-currency VAT of an invoice's buckets equals its `vatMain.vatMinor` (a document in NOK, SEK and EUR); a document with no stored rate is counted in `notConverted` and present in the CSV with empty main columns; the OSS view of an EU store in the same scenario converts SEK and DKK at the stored ECB rates. |

### 6.2 `checkout.oss-and-ioss-support` (bucket B)

| Criterion | Held by |
|---|---|
| 1. An owner enters an OSS or IOSS registration; checkout uses destination VAT as the registration requires | 1a, already held (`tax-profile.test.ts`, `tax-profile.int.test.ts`, `vat-engine.int.test.ts`). 1c adds: `registrationNotes()` tests (sales that fit the Union scheme with `oss_scheme = 'none'`, goods with a non-Union registration, IOSS sales with no number). |
| 2. A quarterly (OSS) and monthly (IOSS) report gives sales, VAT base and VAT by country and rate, ready to file, as a CSV export | As 6.1 criterion 2 for the quarterly one; the monthly one: Int `ioss-return` cases in `tax-reports.int.test.ts` (a Norwegian store with an IOSS number, three marked orders in SE, DK and DE in a month, one above 150 EUR that is not marked and so listed under `dispatch_outside_eu`, a business buyer not marked, a credit note in the next month as a Part 3 correction), the CSV layout test of the IOSS file, the render test of the off state. "Ready to file" is read as *the data the return asks for, per its boxes*; Kaizen files nothing (section 7). |
| 3. A consignment of 150 euro or less from outside the EU is charged destination VAT at checkout and marked IOSS on the order and invoice | Order half: 1a (`ioss.test.ts`, `vat-engine.int.test.ts`). Invoice half: **1b, in the tree**: the invoice prints the IOSS statement and the IOSS number (`order-document-view.test.ts`, `invoice-snapshot.test.ts`); 1c's int scenario asserts the invoice's `vat_kind = 'ioss'` is what puts the sale in the IOSS return. |
| 4. A refund reduces the period's VAT in the report | As 6.1 criterion 3, in the IOSS view (books: the month of the refund; filing: a Part 3 correction of the month of the sale). |

**Rating reached: partial, never Full in this run.** Every criterion has a test, but the row is bucket B: it is live only with a registration the owner holds, the number's validity is checked against no register, and Kaizen files no return.

### 6.3 `international.ioss` (bucket B)

| Criterion | Held by |
|---|---|
| 1. A store can record an IOSS identification number, its intermediary and the markets | 1a (held). |
| 2. At most 150 EUR from outside the EU is charged destination VAT and the order records the IOSS number; above 150 EUR it is not an IOSS sale | 1a (held); 1c's IOSS int scenario shows the above-150 order under `dispatch_outside_eu` with the VAT charged and the statement that an accountant must place it. |
| 3. A monthly IOSS report per member state and rate can be exported | 6.2 criterion 2 (monthly). |
| 4. Live only with a registered number or intermediary agreement; until then off and says why | 1a's readiness line (held) and 1c's view: no number and no IOSS sale gives the off state with its sentence (render test), and no IOSS file is offered. |

**Rating reached: partial**, same reason. The two rows' `gap` texts at re-rating say what remains: bucket B, the unreviewed wording, the intrinsic-value question, and that no return is filed.

### 6.4 Cross-cutting tests

- **Permissions.** `permissions.scan.test.ts` (the page by `analyticsContext`, the export route `analytics:write` and mutating, the actions `owner` and in `OWNER_ONLY_EXTRA`), `store-nav.test.ts` and `admin-map.test.ts` fail if the page is not registered, `owner-tool-permissions.test.ts` fails for a tool with no key, `audit.test.ts` for an action with no area (`analytics.` prefixes the new actions: area `analytics`, no new migration of `audit_area_of()`).
- **Privacy.** `src/db/tax-reports.test.ts` (the function's definition) and `src/server/tax-reports.scan.test.ts` (the modules' sources, who imports them, 3.5), `document-readers.test.ts` (exactly one new reader), no tax-report module imported by a shopper route, the sitemap, feeds, the chat agent or an integration (a scan like the existing ones), no cookie or storage in the new components.
- **Database.** PGlite: the ECB and export tables refuse `UPDATE` and `DELETE`; the function is `STABLE` with `search_path` set and contains no `DELETE`, `TRUNCATE` or `DROP`; the plan-feature row exists once.
- **Perf.** `tax-reports-perf.int.test.ts`: 5,000 documents (4,000 invoices and 1,000 credit notes, cloned from real ones by set-based SQL under the replica role, as `analytics-perf.int.test.ts` seeds, never analysed) in one store, each of the VAT view's function, the OSS view and the reconciliation in under 2 seconds with `setBased()`. **Found at build:** the function took 1.2 s for those 5,000 documents because the planner folded the one-row `main` CTE into every place it was read and called `commerce.main_currency()` once per document and place; `MATERIALIZED` (and one `jsonb_to_record` per snapshot instead of repeated `->`) brought it to 0.2 s. Without `setBased()` (nested loops and JIT on) the same function took 16 s on a store with no statistics, which is why every read goes through it (`tax-reports.scan.test.ts` holds that the function has one caller).
- **Rates and fetch.** `ecb-rates.test.ts`: the daily job inserts only absent rows, never replaces a stored rate (a differing value is logged), a failing fetch changes nothing and never throws, only the constant hosts are requested (a request to any other is a test failure), the on-demand fetch writes the one needed day, an override needs a 10-character reason and an owner.
- **Retention.** `invoice-retention.test.ts`: a store with an OSS registration or an IOSS number gets at least 10 years; one without keeps its country's rule; the 5-year floor is unchanged.
- **Frozen dispatch.** `vat-treatment.test.ts` and `vat-engine.int.test.ts`: `placeOrder()` writes `vat_treatment.dispatchCountry`; the parser accepts an older order without it; a later change of the profile's dispatch country never reclassifies a placed order (the report's class is the same before and after).

### 6.5 Criteria changes proposed (no row is edited here)

1. **`analytics...` criterion 1, "reconciling to the Finance VAT total".** Equality of two differently dated figures is not a property a store can have: Finance dates by `placed_at`, a document by its tax date, test-mode orders are in Finance and never invoiced, and an order without an invoice is in Finance only. Proposed wording: "the report's VAT charged is tied to Finance's VAT total and to Σ `tax_minor` of the paid orders by a bridge in which every difference is named and counted, exact in every currency; copied and host orders appear in no line". It is testable as written in 6.1.
2. **`analytics...` criterion 2, "in euro at a stated rate"**: the stated rate is the ECB's reference rate of the period's last day (or the next publication day) per currency, shown with its date, or the owner's override with its reason. Not the stored `vatMain` rate (1.4 point 3): the brief's "only through the stored vatMain/vatHome figures" holds for the main-currency VAT report and cannot hold for the return's euro, which the law fixes to the period's last day.
3. **`analytics...` criterion 3, "refunds and later credit notes reduce the period they are made in"**: true of the *books* mode. The OSS and IOSS *filing* mode follows the law (guide Q11 and Q12): a credit note of a later period is a Part 3 correction made in the period it is issued and referring to the period of the sale. Both are tested; the criterion is met by the first and the second is the stricter reading for a return.
4. **`checkout.oss-and-ioss-support` criterion 4, "a refund reduces the period's VAT in the report"**: a refund reduces it **through its credit note**. A refund of an order with no invoice (invoicing off, waiting, test mode) has no credit note and is not in the report; the informational refunds line of 2.2.1 shows the difference.
5. **`checkout.oss-and-ioss-support` criterion 2 "ready to file"** is read as the data a return asks for, in its boxes. Kaizen has no tax authority API and files nothing.
6. `docs/wave-1.md` 1c, third bullet ("from invoices and credit notes where they exist and from the orders' lines otherwise, never twice"): replaced by 1.4 point 1 (documents only, the rest itemised). `docs/wave-1a-tax.md` section 7 gave **EC Sales List data of reverse-charge sales** to unit 1c: 1c declines it (section 7).

---

## 7. What is deliberately NOT done, and who takes it

| Not done | Why | Taken by |
|---|---|---|
| **Filing, submitting or paying anything** with a tax authority or intermediary; no marking a period "filed"; no stored copy of what was filed | There is no API to file against, a filed figure is the owner's act, and a wrong filing is the owner's liability. The export log and the drift line (2.2.2) are what is built | not planned; a "mark as filed" with a frozen copy is a later extension on the export log |
| **EC Sales List** (recapitulative statement) of reverse-charge sales | It needs each buyer's VAT number (a field no report reads) and each member state's own form; no row asks for it | wave 2 (accounting exports) |
| **National VAT return mapping** (Norway's *merverdiavgiftsmelding* codes, Sweden's *momsdeklaration* boxes, Denmark's, Germany's) | Each country's form differs and was not read; the VAT view is the data an accountant fills them from, with the place each sale belongs | per country, with an accountant, later |
| **The EUR 10,000 distance-sales threshold watch** and origin-country VAT for small EU sellers | 1a charges destination VAT on every consumer sale and does not apply the threshold; a watch that changes nothing would mislead | later, with the rule (a decision) |
| **Non-euro return currency** (a Member State of identification that requires its national currency) | The guide allows it for non-euro states; Sweden, read, requires euro. The view warns | on request |
| **Part 2c** (services from fixed establishments in other Member States) and **the VAT number each Member State of dispatch allocated** | One store has one dispatch country at a time and no per-establishment data (1a section 8 names the same limit). The totals per Member State of dispatch **are** in the return data (4.8); the dispatch state's own number is not held, and the owner enters it | later, with per-location dispatch |
| **Booked services in OSS** (appointments, stays, rentals) | The place of supply follows the performance or the property; such orders are listed as *not in this return* | later tax wave with an accountant |
| **IOSS above 150 EUR, customs duty, Norway's VOEC** | Out of 1a's rule 4 and the EU's changes from 1 July 2026 (not read) | later |
| **A "VAT report" for orders with no document** (a back-fill of invoices, or reading order lines) | One implementation of what VAT a sale carried (1.4 point 1); issuing invoices for earlier orders is 1b's "later, on request" | 1b's follow-up |
| **Excluding test-mode orders from Finance** | A change to `PAID` moves every Finance figure; the reconciliation names them (1.4 point 6) | the lead's decision |
| **Credit notes for refunds made only in Stripe's dashboard** | 1b's handler (P7) creates the refund row and its note; refunds Kaizen never hears of are in no report | already 1b's limit |
| **Scheduled report emails** | Wave 2 (scheduled report emails) | wave 2 |
| **Per-document drill-down** (which invoices make a row) | The aggregates are enough for the accountant; the invoices page already lists documents by period, and a drill-down would make buyer data reachable from analytics | later, behind `orders:read` |
| **Integration events and Slack messages** | Wave 9 | wave 9 |
| **Languages other than English** for the admin | The admin is English only | not planned |

---

## 8. Needs human legal review

This unit adds **no consumer-facing text** (nothing a shopper reads), so there is nothing to translate and nothing for the AI catalogue. What an **accountant** should read before any real use, each marked `// needs review: accountant` in the code that holds it:

1. The **classification table** (4.3): above all rule 7 (what happens to the VAT charged at checkout on goods dispatched from outside the EU that were not IOSS sales, which Kaizen charges as destination VAT but has no return for), rule 6 (booked services outside OSS), rule 4 (a business buyer charged VAT is not an OSS supply), the treatment of `fee` lines and of baskets with both goods and downloads, and whether a *zero* rate is declared as a reduced rate.
2. **Which date puts a sale in a period** (the payment day, on the footing of Directive Art. 63 and 65, not read here; Art. 66a covers deemed suppliers only and is not relied on) and the dating of a credit note by its issue day.
3. **The euro conversion** (4.5): the ECB rate of the last day or the next publication day (Directive Art. 369h as read at the UK's exit, guide Q15), conversion **once per group**, rounding half up, and the euro VAT not always equal to the taxable amount times the rate to the cent.
4. **Corrections** (4.6): Part 3 for a credit note of a later period, netting a same-quarter credit note even where the return was already filed, conversion of a correction **at the rate of the period it corrects**, and the three-year limit.
5. The **reconciliation's** reading of "paid" and of the causes, and the statement that Kaizen's reports are not a filing.
6. **Registration fit** warnings (4.3) and the deadline sentences (4.4).
7. The **admin warnings** the pages print (the always-visible "not a tax return" line, the off and incomplete states, the import warning on rule 7): English, for an accountant's eyes.
8. **Retention** of 10 years for scheme users (3.6): the guide's Part 4 and Reg. 282/2011 Art. 63c as the guide states them, not the regulation itself.
9. Open questions: whether the **Union scheme's** use by a Norway-based store with an EU dispatch country is permitted as the guide's Part 1 text reads; whether a Norwegian store can use the **import scheme directly** (footnote 1 of the guide, read: yes for goods dispatched from Norway, with the agreement on mutual assistance; the agreement itself was not read); what an **intermediary** needs from the store.

The analytics row is not held back by section 8 under the spec's recommendation (1.1); the two bucket B rows are not Full in any case.

---

## 9. For the lead

### 9.1 Migrations expected

**Two files**, timestamps after `20261004152302`: `{ts}_tax_reports.sql` (generated by `pnpm db:generate`: `ecb_reference_rates`, `tax_rate_overrides`, `tax_report_exports`, the index `invoices_supply_idx`) and `{ts}_tax_reports_rules.sql` (custom, `pnpm exec drizzle-kit generate --custom --name tax_reports_rules`: the three append-only triggers, `commerce.tax_document_groups()`, the plan-feature row). **Additive**; nothing is dropped; no existing function is replaced (the dispatch fact is a JSON field written by application code). **Do not apply to production in this run**: the lead applies them after the tests pass, checks the advisors and records the versions in `docs/decisions.md` (Migration versions).

### 9.2 Statements the Supabase migration tool may cancel (the owner runs them in the SQL editor if so)

**None expected.** No function in this unit contains `DELETE`, `TRUNCATE` or `DROP`: the triggers only `RAISE`, the function only reads, the daily rate job and every deletion-free write are application code. The migration has no top-level `DROP` (only `CREATE TABLE`, `CREATE INDEX`, `CREATE FUNCTION`, `CREATE TRIGGER`, `INSERT` of the plan-feature row). `ownerStatements`: none.

### 9.3 Advisors to check after applying

Security: RLS enabled with no policy on the three new tables; `search_path` set on the function and the trigger functions; no `SECURITY DEFINER` (none planned). Performance: an index for every new foreign key (`tax_rate_overrides.set_by`, `tax_report_exports.exported_by` and `(store_id, report, period_key, exported_at desc)`), `invoices_supply_idx`; run the perf test's timing on a store of 50,000 documents for the function.

### 9.4 Before pushing (the things CI cannot prove)

Read the OSS view of a real or realistic store with its accountant: one EU store (DE and DK orders, a refund in the next quarter), one Norwegian store with an IOSS number (the default Kaizen shape: Norway dispatching to EU consumers, D1), one store in several currencies. Check section 8 item 1 against what the accountant says goes where. Confirm the ECB job ran once in production (a row for the previous working day) and that the quarter's last-day rate is stored before the first OSS deadline (31 October 2026 for Q3). Confirm no other route imports a tax-report module.

### 9.5 Decision row (draft)

| D161 | **VAT, OSS and IOSS reports from the store's own invoices and credit notes.** `/admin/{store}/analytics/tax` (Analytics, `analytics:read`) has three views over the documents of D159: a **VAT report** per delivery country, rate and basis (net, VAT, gross, documents, orders, credit notes, and where each sale is reported), the **OSS return data** per quarter (Union scheme parts 2a, 2b, 2d and the non-Union part, per Member State of consumption and rate, Part 3 corrections, Part 4 balances, Part 5 total) and the **IOSS return data** per month, in euro at the ECB's reference rate of the period's last day (or the next publication day; an owner's override with a reason is audit-logged), each in a *books* mode (a credit note counts in the period it is issued, as Finance) and a *filing* mode (a credit note of a later period is a Part 3 correction of the period of its sale). One database function, `commerce.tax_document_groups()`, is the only reader of document snapshots for reports and selects only buckets, kinds and the buyer type; the classification of a sale to a place (`classify()`, `src/lib/tax-classes.ts`) and the euro arithmetic (BigInt, once per group) are pure. A **reconciliation** bridges Finance's VAT and Σ `tax_minor` to the report in every currency with every difference named (timing, test mode, invoicing off, waiting, not captured). Orders with no document are counted and itemised, never added. Four CSV layouts are fixed and formula-safe; every export is logged with its totals (`commerce.tax_report_exports`) so a later change to a period is shown as drift. `commerce.ecb_reference_rates` (append-only, stored by the daily job) and `commerce.tax_rate_overrides` are new; `orders.vat_treatment` freezes the dispatch country; scheme users keep records 10 years. **The reports are the owner's data for an accountant and are never a filing; Kaizen submits nothing.** Rows `analytics.tax-and-vat-reports-by-rate-and-jurisdiction` (Full by criteria), `checkout.oss-and-ioss-support` and `international.ioss` (partial, bucket B). Every rule needs an accountant's reading. (`docs/wave-1c-reports.md`) |

### 9.6 CLAUDE.md bullet (draft)

- VAT, OSS and IOSS reports (D161, `docs/wave-1c-reports.md`): `/admin/{store}/analytics/tax` (`?view=vat|oss|ioss`; `analytics:read`, exports POST `analytics:write`, ECB rate fetch and override owner-only). Reports read **documents only** (invoices by `supply_date`, credit notes by `issued_on`) through the one function `commerce.tax_document_groups()`, which opens a snapshot for its buckets, line kinds and buyer type and nothing personal; the delivery country is `orders.market_code`, never the snapshot. Never recompute a sale's VAT from orders for a report: an order with no document is counted and shown on the reconciliation by cause (`invoicing_off`, `waiting`, `test_mode`, ...), not added. Where a sale is reported is only `classify()` (`src/lib/tax-classes.ts`: Union 2a/2b/2d, non-Union, IOSS, or a named reason it is in no return); `placeOrder()` freezes `vat_treatment.dispatchCountry` for it. The VAT table converts to the main currency with each document's stored `vatMain.fxRate`; the OSS and IOSS euro figures convert from the document's own currency at the ECB rate of the period's last day (or the next publication day) kept in `commerce.ecb_reference_rates` (append-only, the daily job fills it) or an owner's override with a reason (`tax_rate_overrides`), once per `(period, part, Member State, rate, currency)` group with `toEuroMinor()` (BigInt), never at today's rate; a missing rate marks the return incomplete and refuses its CSV. *Books* mode counts a credit note in its own period; *filing* mode nets it within the quarter of its sale and makes it a Part 3 correction of that quarter otherwise (a negative Part 4 balance is not counted in Part 5). The reconciliation (`src/lib/tax-reconciliation.ts`) is exact per currency and ties to `periodTotals().totals.vatMinor`; a bridge that does not balance says so. CSV layouts are `src/lib/tax-csv.ts`, formula-safe, no totals row; every export is logged in `tax_report_exports` and a changed period shows drift. The reports are never a filing: say so on every page and file. A new place a sale can be reported is a row in `classify()`'s table with a test; a new figure is defined in `docs/analytics.md` first.

### 9.7 Merge notes

Shared files this unit edits (no other lane runs): `src/lib/store-nav.ts`, `src/lib/admin-map.ts`, `src/lib/store-copy-rules.ts`, `src/lib/permissions.scan.test.ts`, `src/lib/owner-tools.ts`, `src/lib/owner-tool-permissions.ts`, `src/lib/assistant-skills.ts`, `src/lib/control-center.ts`, `src/server/control-center.ts`, `src/server/document-readers.test.ts`, `src/lib/vat-treatment.ts`, `src/server/tax-treatment.ts`, `src/lib/invoice-retention.ts`, `src/db/schema.ts`, `src/app/api/cron/cart-reminders/route.ts`, `docs/analytics.md`, `docs/decisions.md`, `CLAUDE.md`, the migrations directory. Each is edited by one small block at a known anchor. The decision number **D161** is proposed; the lead renumbers at the merge.
