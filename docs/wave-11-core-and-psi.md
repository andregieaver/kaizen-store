# Wave 11: the rest of the core the code can close, and the PSI's code items (decisions D380 onward)

The contract for wave 11. It was written on 2026-10-28, after wave 10 (D364 to D379), from the parity tracker as rated that day
(`docs/parity/rows`: 201 core rows, **86.2 %** weighted, must-have **90.6 %**) and from the PSI re-score of the same day
(`docs/audits/psi-2026-10-28.md`, **73.9** overall) with its open follow-ups (`docs/audits/psi-followups.md`). Each gap named below was
checked against the code on that day. Code, tests and texts follow this file. A unit that has to change course says so here first.

## Where things stand

- **Must-have rows (weight 4 and 5): nothing left that code alone can close.** Wave 10 built the code's part of all 16 partial must-have
  rows (D379). Each now waits on one named thing outside the code:
  - an accountant: VAT, OSS and IOSS, the reports, retention periods, verifying the rates;
  - a lawyer: legal pages, invoice and consumer texts, unit-price rules;
  - an independent accessibility audit;
  - the PCI SAQ A attestation;
  - a live check with a partner: Kaizena Flow's Mollie app, carriers' production services, one sign-in against the real Supabase two-step;
  - a promise the company publishes: hosting, uptime, support.

  So wave 11 does not move the must-have figure.
- **The core rows of weight 2 and 3 that code can still close: 14 rows, about 3.0 points.** All are bucket A.
  - Three rows' gap texts are partly out of date: the Customers list's tag filter (D366) and the campaigns-versus-codes choice (D367) are
    built. Their remaining gaps are taken from the code, not the old text.
  - If every unit A to I reaches Full, the headline goes from 86.2 % to about **89.1 %**.
- **Rows that need a decision first: about 1.1 points.** The app directory (`platform.app-store-and-ecosystem`, weight 3, bucket C), SMS
  marketing (weight 2, bucket C) and POS (weight 2) are not built in this wave unless the owner decides so (section 4).
- **The PSI.** The code items of the audit's ranked list that are not yet done are worth about **+1.2 overall** by the audit's own
  estimates (items 2, 6, 8, 10 and 11, and the code part of item 4). That lifts it to about 75. The single largest move, the restore drill
  (+2.1, lifts the Reliability cap), is the owner's.

## 1. The units, in the order they are built

| Unit | Decision | What | Rows or PSI items it closes |
|---|---|---|---|
| A | D380 | Segments everywhere: bulk tags, a segment as the audience of a code or campaign, a segment from a sentence, RFM lists | `customers.customer-segments-and-tags`, `customers.discount-stacking-and-customer-targeted-discounts`, `ai.ai-or-rule-based-customer-segmentation`, `analytics.rfm-segments-and-customer-lists` |
| B | D381 | Money held for customers: bonus credit on Finance, a roll-forward that adds up, a gift card's own amount, a code sent again | `analytics.liabilities-gift-card-and-store-credit`; `customers.gift-cards` to "waits only on a review" |
| C | D382 | Contact messages in the support inbox | `storefront.signup-and-contact-forms-feeding-customers-and-consent` |
| D | D383 | Stock transfers and purchase orders; the rest of several locations | `catalogue.inventory-transfers-and-purchase-orders`, `orders.multi-location-inventory-and-routing` |
| E | D384 | Moving in: a WooCommerce product file, redirects from old addresses, order history | `platform.migration-from-other-platforms` |
| F | D385 | A staging copy, and versions of the site's own CSS | `platform.store-duplication-staging-theme-versions` |
| G | D386 | Creators: applications, commission, payouts recorded, a creator's own page | `customers.affiliate-and-creator-programme` |
| H | D387 | Payments: MobilePay end to end; orders on terms counted the day they are paid, paid in part | `checkout.mobilepay`, `checkout.b2b-payment-terms` |
| I | D388 | Theme submissions with their own pages | `platform.themes-and-templates-marketplace` (with decision 4) |
| J | D389 | PSI, security and operations: deploys verified, a nonce-based CSP (Report-Only first), budgets and security logs, an alert for a failing job | REL-03, CODE-07 (code part), SEC-05, SEC-10, SEC-11, REL-02 |
| K | D390 | PSI, accessibility and speed: Kaizena Flow's front page contrast, the checker reading a page's own CSS, focus, speed measured in the admin | ACC (re-score's finding), ACC-02, PERF-01, PERF-02 |
| L | D391 | PSI, agents and privacy: the evals in CI against a recorded model, prompt versions, the DPIA's open findings in code | AGT-14, REG-07 (code part) |
| M | D392 | The code's part of the weight-3 rows still partial (as wave 10's N did for the must-haves) | `orders.exchanges`, `orders.edit-an-order-after-placement` and others named at its start |

## 2. The units

### A. Segments everywhere (D380): built

**As built (28 October 2026).** Everything below is built and the four rows are Full (core parity 86.2 % to 87.1 %), with these changes from
the plan:
- **Bulk tagging** works on everyone the list's search and tag find, rather than on rows ticked one by one (the list rows are links): Homer
  narrows the list and presses once.
- **The RFM groups** of a segment are now the analytics page's own (`rfmGroups()`), not worked out over the segment's people. Before, the two
  pools differed (an erased person's order counted on the page only, and money was rounded differently), so the counts could disagree.
- **Membership at the cart** reads the buyer's facts alone, and the store's whole RFM pool only when the rules ask for a customer type.
- **The AI manager's tools** are `count_segment` (read) and `save_segment` (saves at once, no gate). No editor is opened unsaved.
- **A store's copy** switches a segment-limited code or campaign off, since segments are never copied.


**What is missing, checked in the code.**
- Staff tag customers only one at a time.
- A code or a campaign cannot be limited to a segment. They reach customer groups and named customers only (`reaches()`, `availability()`).
- The AI manager can list segments (`list_segments`) but cannot make one.
- An RFM group on the Customers analytics page does not open its people.
- A segment's people have no paged list beyond the first page and no CSV.
- No test holds a segment's RFM count to the analytics page's.

**Design.**
- **Bulk tagging.** Select on the Customers list (the page's own filter, or all that match it), then *Add tag* or *Remove tag*. It goes through
  `addTag()`/`removeTag()` with one audit entry a batch, never a person's address in it, and at most 1,000 people a press.
- **A segment as an audience.**
  - `discount_codes` and `campaigns` take an optional `segment_id`, the store's own.
  - Whether a buyer is in the segment is only `matches()` for that one person: the signed-in customer's proven address, worked out at the
    moment, never a stored list.
  - `cartSummary()` and `placeOrder()` ask the same function. A shopper outside it is told so with the code's existing words for a group.
  - A guest is never in a segment that needs anything a guest cannot prove.
  - Scenarios in `checkout-kinds.int.test.ts`, euro included.
- **A segment from a sentence.**
  - The AI manager's `draft_segment` turns words into `segmentRulesSchema` rules, checked by the editor's own validation, and opens the
    editor with them unsaved. `save_segment` keeps them. Both are gated by nothing, as a segment changes nothing a visitor sees.
  - The model never lists or counts people: the count is `countSegment()`, written out by code.
  - A case for it goes in the agents' eval.
- **RFM lists.**
  - Each group on the analytics page links to a segment of that group (made on the spot, not saved).
  - The segment's list is paged (keyset, by last order) and has a CSV for staff with `customers:read`. The CSV is through `writeCsv()`, a
    D165 export job, owner's only if it holds addresses as the customer file does.
  - An integration test holds "Champions" in a segment to the analytics page's count.

### B. Money held for customers (D381)

**B1 built (28 October 2026):** Finance's *Owed to customers* section, as designed below; `analytics.liabilities-gift-card-and-store-credit` is Full.
The gift card ledger is rolled forward from all its entries, with a hold and its release on one line (`held`, in *used*), so it adds up.
**B2 built (28 October 2026): a new code**, as designed below (`commerce.gift_card_new_code()`, *Send a new code* on the card's page).
**Course change:** the shopper's own amount is not built. It would be a second way a line is priced through every price reader, and the gift card
row stays partial on the voucher review whatever is built; fixed amounts stay until that review (D381).

**What is missing.**
- Bonus credit owed is shown only on the bonus page (`outstandingMinor`), not on Finance.
- Neither bonus credit nor gift cards have an opening balance, so no roll-forward adds up from opening to closing.
- A gift card's amount cannot be chosen by the shopper.
- A card's code cannot be sent again after delivery (codes are kept only as hashes).

**Design.**
- **Finance's liabilities section.**
  - Bonus credit owed now is the sum of `commerce.bonus_balance()` over customers, in the program's currency, converted for display only.
  - Gift cards stay per currency, as today.
  - Each has a roll-forward for the period: opening (the ledger's sum before the period's first instant), issued, redeemed, expired,
    reversed and changed, and closing.
  - A test fails if opening plus movements is not closing to the minor unit. A CSV comes with it.
- **The shopper's own amount.**
  - A gift card product may take an amount between the owner's lowest and highest, in whole units of the market's currency.
  - It is priced as a line of its own (`voucher`, never discounted, as today), equal in `cartSummary()` and `placeOrder()`, with a euro
    scenario.
- **Sending a code again.**
  - Staff with `products:write` press *Send a new code*. One SQL function of the ledger family (`gift_card_new_code()`) replaces the hash,
    so the old code stops working. It is audited, never with the code.
  - The new code is emailed only to the address the card was delivered to, and shown once to the staff member.
  - The balance is unchanged.
- The gift card row then waits only on the review of the voucher VAT treatment and the expiry rules.

### C. Contact messages in the support inbox (D382)

**Built (28 October 2026),** as designed below with two course changes (D382): a form's message reaches the inbox only while the desk is on
(with support off the form emails its recipients as before), and there is no *AI reads form messages*: a form's conversation is people only on
every desk. `storefront.signup-and-contact-forms-feeding-customers-and-consent` is Full.

**What is missing.** The email form only emails its recipients and counts a row in `form_submissions`. Nothing reaches an inbox with a status.

**Design.**
- A store's email form sends its message into the store's support desk as a conversation of source `form`, through
  `commerce.support_add_message()`, as the email path (D332) does.
  - It gets the inbox's states, assignee, notes and replies by email from the desk's address.
  - The form still emails its recipients unless the owner turns that off.
- The desk need not be on for this: a form conversation is staff's only, and the AI never answers it.
- **Linking to the customer** (criterion 3) keeps D216's rule that a typed email is never proof.
  - The conversation shows *A customer has this address: not verified*, with a link for staff with `customers:read`.
  - Nothing is tied, nothing of the customer reaches the sender, and the AI's tools never use it.
  - This is decision 5: if the owner prefers no link at all, the row stays partial on that criterion.
- A visitor's words never reach a model unless the desk puts the AI first and the owner turns on *AI reads form messages*: off by default.
- Retention, export and erasure follow support conversations.

### D. Stock transfers and purchase orders; the rest of several locations (D383)

**Built (D383).** D1: transfers, purchase orders, the cost history, incoming units and locations kept out of online orders, with the AI manager's two read tools. D2: the nearest-first routing rule, payment drawing only from online locations, CSV lines in and out, `create_transfer` (a draft), the perf test by plan and the e2e. Not built, with the reasons in D383: the payment-time shelf check (it would break what a shopper was told) and stock per location in the product editor.

**What is missing.**
- Nothing moves stock between locations or receives it from a supplier.
- Variant cost has no history of its own.
- For several locations:
  - `inventory-perf.int.test.ts`'s bound is flaky.
  - No signed-in browser test drives the locations page.
  - A hold's physical part is not checked against the shelf again at payment.
  - Stock per location is edited only on the Inventory page or by file.
  - There is one routing rule only, and no location can be kept out of online orders.

**Design.**
- **Transfers.**
  - `commerce.stock_transfers` and their lines go from a draft, to sent (each line's units leave the origin as a movement of reason
    `transfer_out`, never below zero), to received in parts (`transfer_in` at the destination), with cancelled returning what was sent and
    not received.
  - Incoming stock is shown at the destination and never sold.
  - Written only by `src/server/stock-transfers.ts` inside `withStockContext()`.
- **Purchase orders.**
  - `commerce.purchase_orders` (supplier name and reference, currency, lines with variant, quantity and cost) are received in parts:
    movements of reason `received`.
  - Each receipt writes the variant's cost and a row of `commerce.variant_cost_history`. Order lines keep the cost they froze (D152), so
    nothing earlier is rewritten.
  - CSV in and out are D165 jobs.
- **Several locations.**
  - Each location can be excluded from online orders (`fulfils_online`): `allocate()` skips it and the storefront's sellable sum leaves it
    out.
  - An optional second rule: nearest by country, then rank.
  - The product editor edits stock per location when the store has more than one.
  - At payment, `draw_order_stock()` notes a hold whose shelf fell below it as backorder, rather than going negative unnoticed.
  - The perf test asserts the plan (an index scan, no nested loop over the catalogue) instead of wall time on a shared server, so the bound
    is the criterion and not the machine.
  - A signed-in e2e drives the locations page, the deactivate dialog and a transfer.
- The AI manager gets `list_transfers` and `create_transfer` (gated `public`: it changes what is sellable) through the same module.

### E. Moving in from another platform (D384)

**Built (29 October 2026),** as designed below with four course changes (D384): an order is tied to a customer by the order's email matching
one the store already has (the customer import keeps no link from a row to a customer); a WooCommerce product's handle is its name as WordPress
slugs it (the file has no address column); a sale price's dates are judged on today's UTC date; an order number already taken counts as
imported. `platform.migration-from-other-platforms` is Full.

**What is missing.** A WooCommerce product file, redirects made from the old product addresses, and order history.

**Design.**
- **WooCommerce.** WooCommerce's own product CSV export (columns read from its documentation when the unit starts, `fetched` with its date)
  goes through the same product import job: dry run, findings, `safeFetch()` pictures, matched by its slug as Shopify's by handle.
- **Redirects.** An import may make manual redirects from the old addresses: Shopify's `/products/{handle}`, WooCommerce's
  `/product/{slug}`. They go through `validateRedirect()` and the redirect service, never over a live address.
- **Order history.**
  - Shopify's order CSV is imported as copied orders (`C-…`, `copied_from` naming the import), the way D129's copies are.
  - They are never paid, refunded, shipped, emailed, invoiced or counted in revenue.
  - They are tied to a customer only by the customer import's own rows. They carry the file's amounts as history, in the file's currency.
  - Owner's only (D165's order files rule).
- The customer criterion (no consent unless the file proves it, no password or payment data) is already met by D366's import. The row
  records it.

### F. A staging copy, and versions of the site's own CSS (D385)

**Built (29 October 2026),** as designed below with three course changes (D385): a theme switch's CSS keeps no CSS version (its look is kept by
the installs and `look_versions`); a refused *Make live* leaves the set open so no copy is lost; a version is compared by its lines.
`platform.store-duplication-staging-theme-versions` is Full.

**What is missing.**
- A staging set (D358) works on the store's live drafts, not on a copy, so a page staged is the draft anyone editing it sees.
- The site's own CSS keeps no versions.

**Design.**
- **The staging copy.**
  - A staging set holds its own copies of pages, articles, headers, footers and product layouts (`site_staging_pages.content`). They are
    edited in the builder in a *staging* mode (the page's ordinary draft untouched) and compared with the live page by
    `compareVersions()`.
  - *Make live* writes each through `savePage()` as today. A page whose live version changed since it was copied is refused, with the
    difference shown.
  - Addresses change only on publish, with D42's redirect, and the tags are refreshed by the savers.
  - Products, orders and customers are never in it.
- **CSS versions.** Each save of `stores.custom_css` (and Kaizena Flow's) keeps a version in `commerce.css_versions` (the newest 50,
  written in the save's transaction), listed, compared and taken back into the editor as unsaved, as page versions (D305) are.

### G. Creators (D386)

**Built (29 October 2026),** as designed below with four course changes (D386): the application is on My account's page (the signed-in
customer's proven address is the email asked for), not a page part; the programme has its switch on its own page, not a store feature;
commission per category, not per product; a refund that later fails leaves its reversal, as the referral program's does.

**What is missing.** The store's referral program (D131) is customers referring friends. There is no creator application, commission in
money, payout record or creator page.

**Design.**
- A store page part *Become a creator*: name, email, channel link, consent. The owner approves or declines.
- An approved creator gets a code and a link. They reuse the affiliate attribution (consent-gated cookie `kaizen_aff_{storeId}`), with a
  creator kind.
- **Commission.**
  - A percentage of paid goods without VAT, optionally per category.
  - It accrues by trigger on a paid order (`PAID`), is reversed on refund and cancellation, and never accrues on copied or host orders.
  - It is kept in an append-only `creator_commissions` ledger per currency, never converted.
  - Integration test with a euro case.
- **Payouts.** The owner records payouts (Kaizena Flow moves no money) and exports them as CSV.
- **The creator's page.** `/account/creator` shows clicks, orders and earnings, never a buyer.
- Personal data: register, export and erasure. Hand-written words in four languages, flagged for review.

### H. Payments: MobilePay, and orders on terms (D387)

**Built (29 October 2026),** as designed below with three course changes (D387): *Pay now* asks for the whole of what is left (a part is money
recorded outside or a later payment); the control center's glance and the AI manager's own analyses keep `placed_at`; subscription boxes stay card-only.

**MobilePay.**
- An integration test with the stand-in Stripe holds what Kaizena Flow sends for a Danish and a Finnish checkout (MobilePay not excluded)
  and for a Norwegian one (excluded, where the owner or the rules leave it out).
- A MobilePay payment, given as Stripe's `method_type`, ends as a paid order, and its refund is recorded.
- Which methods Stripe then shows is Stripe's, and the row says so.

**Payment terms.**
- An order on terms counts in sales on the day its balance is paid, not the day it was placed: criterion 3, a definition changed in
  `docs/analytics.md` first, for terms orders only, in `PAID`'s day.
- A balance can be paid in part: several Stripe payments or records outside, the order paid when the balance reaches zero.
- A store on Mollie alone gets *Pay now* through Mollie.
- A signed-in e2e chooses *Pay by invoice* at checkout.

### I. Theme submissions with their own pages (D388)

**Built (29 October 2026),** as designed below with three course changes (D388): the pages are copied when the look is sent and kept with
it, as the look is (the store may change after); a review places them in a store template of their own, tied to the theme only on approval
(an update's theme keeps its content until then), and the reviewer previews the look on them from the submission; pages chosen for a place
(legal pages, the cart, the blog) are never sent, as the content store has its own. The row stays partial on decision 4 alone.

- A submission (D344) may carry the author store's published pages as the theme's content. They are copied as a template is
  (`sanitizeTemplate()`, pictures into the theme's own content store, never products, customers, forms' recipients or secrets).
- They are reviewed with the look and become the theme's content (D275) on approval.
- Criterion 3's "never applied on its own" is unmet for installs that followed updates before D344, as wave 7's decision 4 chose (`docs/wave-7-storefront.md`, J).
  Decision 4 asks whether to switch them to *offer* updates. Until then the row stays partial on that alone.

### J. PSI: security and operations (D389)

**Built (29 October 2026),** as designed below with two course changes (D389): the site-wide policy is Report-Only without a nonce (a nonce
needs every page rendered per request, which the prerendered pages are not; it names every origin a script may come from and reports the
rest), and its reports are counted as log lines by `/api/csp-report` rather than kept. Deploy verification waits up to twenty minutes and
counts a later push's deployment that includes the commit.

- **Deploys verified.** After the deploy hook, CI polls `/api/health` until it reports the pushed commit, up to a time limit. The job fails
  and says so when it does not.

  This is the code part of the audit's first finding: production was 56 commits behind while CI was green. Whether the deploy should also
  wait for the checks is decision 6 (D5 deploys at once).
- **A nonce-based CSP.** On the admin and the storefront, sent as Report-Only first, reports counted in the log (SEC-05). The pay routes
  keep their enforced policy.
- **Budgets and security logs.**
  - Budgets on `/api/consent` and `/api/ab/*` (SEC-10).
  - Failed sign-ins and permission refusals logged through `log()` with ids only (SEC-11).
- **A failing job alert.** When a job turns failing (`cron-health.ts`), an email goes to platform admins once per turn (REL-02).

### K. PSI: accessibility and speed (D390)

- **Kaizena Flow's front page.** Fix the front page's contrast (the re-score found 12 serious findings in light and 14 in dark, from the
  page's own CSS classes) and the footer's *Cookies* link in dark mode.
- **The checker.** `pageIssues()` reads the colours a page's own CSS gives the classes its blocks use, so the builder blocks publishing over
  what axe finds.
- **Focus.** The AI manager's focus is kept by ref. The other storefront forms that disable their button while sending take
  `useKeepFocus()` (ACC-02, about 25).
- **Speed.** `SpeedBeacon` on the admin and Kaizena Flow's own site, under the same rules (no cookie, no identifier, GPC and Do Not Track
  honoured; PERF-01, PERF-02).

### L. PSI: agents and privacy (D391)

- **The evals in CI.** The agents' safety eval runs in CI against a recorded model: answers recorded once per prompt version and replayed.
  Each system prompt carries a hash, kept with every run and turn, so a changed prompt is a new version (AGT-14).
- **The DPIA's open findings that code can close** (`docs/dpia-ai.md`):
  - The AI manager's conversations get a retention period (owner's setting, default proposed 12 months, `runRetention()`).
  - Tone scoring and summaries tell the customer in the chat. The words are hand-written in four languages and flagged for legal review.
  - The owner is told on the support settings page that they are on.

### M. The code's part of the weight-3 rows still partial (D392)

As wave 10's N did, it closes what each gap names that code can do, so the row waits only on people. Known on 2026-10-28:

- `orders.exchanges`: the euro scenario moved into `checkout-kinds.int.test.ts`, where the spec asks for it.
- `orders.edit-an-order-after-placement`:
  - a refund owed after a failed change refund is shown in the control center;
  - a test of a D153 return refund after a paid change.

The rest is listed when the unit starts, from the rows as they stand then.

## 3. Rules for every unit

- **The house rules.** Each unit follows CLAUDE.md's rules for the modules it touches:
  - one writer per table, audited;
  - `COPY_RULES`, the personal-data register and the export for any new table;
  - a euro scenario for any new money read;
  - hand-written shopper words flagged for review;
  - `log()` and `typedRows()` for new server code.
- **Finishing a unit.** A unit is finished with:
  - its integration test, and a signed-in e2e where it adds a screen;
  - its parity rows re-rated with history entries (`pnpm parity:write`);
  - its decision row in `docs/decisions.md`;
  - its migration versions recorded after CI applies them.
- **Rating rows.** A row is rated Full only when no person's review is still named on it.

## 4. Decisions needed from the owner

1. **The app directory** (`platform.app-store-and-ecosystem`, weight 3, 0.46 points). Developers registering apps with scopes, an install
   screen, review and suspension, and extension points. The API, webhooks and custom apps it would rest on exist (D354, D355, D363).
   - The plan's decision 2 said: a directory only when outside developers ask.
   - Recommendation: keep it so, and plan it as wave 12 if one asks.
2. **SMS marketing** (weight 2, 0.30 points). Integrate one EU-hosted provider, or skip. The precondition the plan set (email broadcasts) is
   met.
   - Recommendation: decide by whether Nordic shops ask for it; it is not built in this wave.
3. **POS** (weight 2). Still deferred, as decided.
4. **Theme installs that followed updates before D344.** Switch them to *offer* updates (closes unit I's row), or keep them following.
5. **Contact messages and customers.** Show an unverified link from a form message to a customer with the same address (unit C), or no link.
6. **The deploy waits for the checks.** Today a push deploys at once (D5). Unit J makes CI say when a deploy did not go live. Waiting for the
   checks as well is the owner's call.

## 5. What still waits on people (unchanged by this wave)

- **The restore drill.** Lifts the PSI's Reliability cap, about +2.1 overall.
- **Reviews:**
  - an accountant's review of the VAT, OSS, IOSS and retention rules;
  - a lawyer's review of the consumer and legal texts;
  - an independent accessibility audit and a recorded screen-reader pass;
  - the SAQ A.
- **Partners and accounts:**
  - Kaizena Flow's Mollie app (PayPal, Swish);
  - carriers' production services (pickup points, labels, tracking, return labels);
  - one sign-in against the real Supabase two-step;
  - premium themes and pay links paid in Stripe's test mode on a real store.
- **The company:**
  - the DPAs and the platform's AI on the EU path;
  - the uptime and support promises.
