# GDPR export, erasure and retention (wave 1, unit 1g, decision D162 proposed)

Closes `international.gdpr-data-export-and-erasure` (bucket A, wave 1, weight 4). This file is the contract for the run: the foundation,
server, shopper, admin and analytics-and-ai agents build from it, and a disagreement is settled here first. It follows
`docs/wave-1.md` section 1g, `docs/wave-1b-invoices.md` (documents are immutable; `anonymise_expired_documents()` is the one allowed change),
`docs/wave-1-trust.md` (audit log, permissions) and `docs/returns.md` (the model of a contract doc).

**Nothing here is legal advice.** Every period and rule that comes from a law is written with its source, how much of the source was read and the
date (2026-10-04), is kept in data (`commerce.retention_rules`) or one pure function, and is flagged *needs review by an accountant or lawyer*.
Every consumer-facing text is hand-written in nb, sv, da and en, never machine-translated, never in `i18n.ts` or the AI catalogue, and flagged
for legal review (section 8). The admin is English only.

The unit's one idea: **personal data has an owner list.** A register (`PERSONAL_DATA`) names every table that can hold a person's data, how it
links to the person, what the export says about it and what erasure does to it, and a test fails when a table that looks personal is not in it.
Export, erasure and retention are three readers of that one list, so a table added later cannot be forgotten by all three at once.

---

## 1. Purpose and scope

### 1.1 What is closed

| Row | Gap today (read in the code, 2026-10-04) | After this unit |
|---|---|---|
| `international.gdpr-data-export-and-erasure` | `deleteCustomer()` removes the account, sessions, password, picture and standing lists; orders keep email, names and addresses **forever**; no export of a person's data (only `customerFieldExport()`); no staff erase; no retention schedule; several tables grow without end (section 1.4) | A person's data can be downloaded as one JSON file by staff and by the shopper; staff and the shopper erase, with orders under the bookkeeping duty restricted and then anonymised by the retention job; a retention schedule is data, runs daily and is tested; every export and erasure is in the audit log |

The row's four criteria become twelve testable acceptance criteria G1 to G12 (section 6). **Expected rating after this run: Full**, with two
stated caveats that go in the row's `gap` text and are not hidden: (a) the retention periods are seeded from statutes read at snippet or
secondary level for three of four countries and stay `verified = false` until an accountant has read them; (b) every consumer text needs legal
review (bucket D by nature; it does not block the rating, as for returns D153 and invoices D159). If the lead wants a stricter reading, the row
stays Partial until (a) is done; the code is the same either way.

### 1.2 What Shopify does (read 2026-10-04)

Source: <https://help.shopify.com/en/manual/your-account/privacy/processing-customer-data-requests> (fetched; the row's earlier read of
2026-10-02 agrees). What the page says, and nothing more:

- A merchant (owner or staff with customer permissions) handles a request in the admin: **Customers → the customer → More actions → Request
  customer data**; the export is shown after a refresh and, for the store owner, also emailed. The export is "a copy of the customer's data from
  visits to your store that is processed by Shopify".
- **Erase personal data** is under the same menu. Shopify processes it itself; the merchant has **10 days to cancel** the request.
- Erasure redacts personal identifiers (names, addresses). What was sold and the date and time of the sale stay visible in the admin.
- Erasure **cancels pre-authorised payments and subscriptions**; for those, remaining payments are not charged.
- Data held by Shop and Shop Pay is not erased by a merchant's request.
- The page says nothing about a waiting list of orders in the last six months, tax record-keeping, how long anything is kept, or what the export
  contains in detail. (An earlier assumption in the planning notes that Shopify refuses to erase customers with recent orders is **not** on this
  page and is not repeated here.)

What this unit does the same: a staff-triggered export and erase from the customer page; redaction that keeps the sale (number, date, amounts,
VAT); subscriptions end on erasure. What it does beyond Shopify: a shopper self-service download and delete (after a fresh sign-in), a register
that forces every new table to be classified, a retention schedule with sources and dates, a request log with the one-month clock, and the
audit log. What Shopify has that this unit does not: a 10-day cancel window (section 2.4 explains the replacement: preview, typed
confirmation, and the restriction of orders, which cannot be cancelled either way).

### 1.3 The law, read (sources and how much was read)

| Rule | Source | Read | Used for |
|---|---|---|---|
| Time to answer: "without undue delay and in any event within one month of receipt"; may be extended by two further months when necessary, the data subject told within one month with the reasons; a refusal needs the reasons, the right to complain to a supervisory authority and to seek a judicial remedy, within the same month; free of charge, reasonable fee or refusal only for manifestly unfounded or excessive requests (the controller carries the burden); reasonable doubts about identity allow a request for more information | GDPR Art. 12(3), 12(4), 12(5), 12(6), <https://gdpr-info.eu/art-12-gdpr/> | page read | `privacy_requests` clock, extension, refusal, no fee |
| Access: confirmation whether data is processed; the data and the purposes, categories, recipients, storage period, source, rights; "a copy of the personal data undergoing processing", in a commonly used electronic form when asked electronically; shall not adversely affect the rights and freedoms of others | Art. 15(1) to (4), <https://gdpr-info.eu/art-15-gdpr/> | summary of the page (the eight information points are not quoted in full: the foundation agent must read the article before writing the `information` block) | the export's `information` block, `notIncluded` (others' data) |
| Portability: structured, commonly used, machine-readable; only data given by the subject, processed by automated means on consent or contract; does not override erasure; not to adversely affect others | Art. 20, <https://gdpr-info.eu/art-20-gdpr/> | page read | the file format (JSON); the whole export is offered, not only the Art. 20 part, because Art. 15 needs more |
| Erasure: grounds (no longer necessary, consent withdrawn, objection, unlawful processing, legal obligation, children); **exceptions** when processing is necessary "for compliance with a legal obligation which requires processing by Union or Member State law" (17(3)(b)) and "for the establishment, exercise or defence of legal claims" (17(3)(e)) | Art. 17(1), 17(3), <https://gdpr-info.eu/art-17-gdpr/> | page read (summary of the paragraphs used) | restriction of orders under the bookkeeping duty |
| The one-month period: the EDPB's Guidelines 01/2022 (final version published 17 April 2023) say it runs from receipt, may be paused while identity is verified if asked without undue delay, and extension is "the exception and not the rule"; a controller should use the authentication it already has (a confirmation email or message to the address the person registered with) | <https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-012022-data-subject-rights-right-access_en> | **search snippets only; the PDF could not be parsed** | fresh sign-in for the shopper; the clock in `privacyDeadline()` |
| How the month is counted (the same date next month, the last day of that month when there is none; whether a weekend extends it) | Regulation (EEC, Euratom) No 1182/71 as the EDPB applies it | **not read** (from memory, verify) | `privacyDeadline()` takes the safe side: the same date next month, clamped to the month's last day, **a weekend never extends it** |
| Storage limitation: data kept in a form that permits identification for no longer than necessary | GDPR Art. 5(1)(e) | not fetched (well known; the foundation agent cites the page it reads) | the whole retention schedule |
| Norway: accounting material (items 1 to 4) is kept **5 years after the end of the financial year**; items 5 to 8 (contracts, correspondence, shipping documents, price lists) 3 years and 6 months | Bokføringsloven § 13(2), <https://lovdata.no/lov/2004-11-19-73/§13> | page read | `bookkeeping` NO 5 years from end of year |
| Sweden: kept "fram till och med det sjunde året efter utgången av det kalenderår då räkenskapsåret avslutades" (to the end of the seventh year after the calendar year in which the financial year ended) | Bokföringslag (1999:1078) 7 kap. 2 §, <https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/bokforingslag-19991078_sfs-1999-1078/> | **text of 7 kap. 2 § read** (upgrades the "snippet" of wave 1b) | `bookkeeping` SE 7 years from end of year |
| Denmark: accounting material is kept 5 years after the end of the financial year it concerns (the search result cites bogføringsloven § 10 for the period and § 12 for how it is stored; the act's own page returned no text) | Skattestyrelsen guidance, <https://tax.dk/jv-2022-1/ab/A_B_3_1_3.htm> and a search result for Erhvervsstyrelsen | **snippet only; section number unconfirmed** | `bookkeeping` DK 5 years |
| Germany: booking records (invoices, receipts, order confirmations, delivery notes, payment documents) 8 years from 1 January 2025 (BEG IV, § 147(3) AO, § 257(4) HGB), down from 10 | search results (haufe.de among them); gesetze-im-internet.de returned 503 | **secondary** | `bookkeeping` DE 8 years |
| Anything else: no country has been read | none | fallback | `bookkeeping` default 10 years: the longest of the four plus a margin, so nothing is anonymised sooner than a rule says |
| DAC7: platform operators keep records for at least 5 and at most 10 years, member states may extend | search result summarising Directive (EU) 2021/514 | **secondary, not read** | `host_bookkeeping` 10 years (a host's order is reported by the store under D71) |
| Datatilsynet's position that the accounting act is no blanket reason to keep everything: it must be clear *which* personal data the law requires, data kept only for the legal reason should be **isolated for that use** and deleted when the period ends | search summary of Datatilsynet's consultation answers (regjeringen.no) | **snippet only** | the *restriction* design: kept data is not used for anything else (section 2.4) |

The seller's country decides the bookkeeping period (`stores.country`), not the buyer's: the duty is the seller's.

### 1.4 What already exists, and what the code does today (so this unit builds on it)

- `deleteCustomer()` (`src/server/customers.ts`): forgets standing lists (detaches the saved card at Stripe), unlinks orders, subscriptions and
  carts from the customer (`customer_id = null`), deletes the `customers` row; ON DELETE CASCADE removes sessions, sign-in links, wishlists
  and items, affiliates and the **bonus ledger** (credits are forfeited, tested in `bonus.int.test.ts`), checkout account rows; `customers_forget_field_values`
  removes custom-field values; the avatar file is removed from Storage. `deleteAccountAction()` calls it with **no re-authentication**.
- What it leaves: orders keep `email`, `billing_address`, `shipping_address`, `company_name`, `organisation_number` and `vat_treatment`
  (buyer VAT number, VIES name and address) forever; `subscriptions.email`/`shipping_address` and the **running Stripe subscription** (it is not
  cancelled: the shopper keeps being billed with no account); `email_messages` (full bodies of every email, forever; the sign-in code
  emails hold the plaintext code); `withdrawal_requests` name and email; `returns` free-text notes; `abandoned_checkouts`; `form_submissions` by email;
  `company_invites` by email; `carts` (company name, number, VAT number); Stripe webhook payloads (`webhook_events.payload` holds the customer's
  name, email and address); `customer_codes` (every email address that ever asked for a code, forever).
- Retention that exists: `search_queries` 90 days (`pruneSearchLog()`); `visits`/`product_views` 25 months (`pruneVisits()`); `consents` 12 months (a
  **pg_cron** job in a migration, only where the extension exists, so not locally and not in tests); `audit_log` 24 months (`pruneAuditLog()`); `form_submissions`
  30 days; `integration_deliveries` 30 days; `recommendation_events` 90 days; `ai_usage` 400 days; abandoned-checkout emails erased after 30 days;
  VAT checks and carts' VAT numbers 30 days; invitations and sign-in links of companies; withdrawal requests nobody confirmed in 24 hours.
- Retention that does **not** exist (found in this read; the schedule closes each): `customer_codes`, `customer_sessions` (expired rows), `email_messages`,
  `carts` (personal columns), `delivery_quotes` (postal codes), `webhook_events.payload`, orders, `withdrawal_requests`, `returns` notes,
  `privacy` request records (new), `idempotency_keys` (unused table, nothing to do).
- Existing building blocks: `commerce.anonymise_expired_documents(store, before)` and `anonymiseDocuments()` (1b, with a five-year floor in SQL),
  `src/lib/invoice-retention.ts` (the four countries' constants and `retentionCutoff()`; this unit moves the numbers into `retention_rules` and
  keeps the function), `customerFieldExport()`, `avatars`/`removeAvatarFiles()`, `commerce.bonus_balance()`, `findCustomer()`/`customer-admin.ts` (a person is an account id **or**
  a lowercase email, and guests have no account), the audit log with `area` (`customers`), `src/server/security-jobs.ts` (the model of a daily
  job: application code, a clock argument, batches, each step isolated), the daily cron `/api/cron/subscription-reminders`.
- Database rules this unit must work *with* (read in `pg_get_functiondef`, 2026-10-04): `orders_number_guard` (an order is never deleted, its number never
  changes; copied orders are the exception **in SQL**, but D141 says no code deletes an order, so nothing here does); `orders_vat_frozen` (refuses a change to
  `vat_treatment` after payment); `copied_orders_read_only` (a copied order cannot change at all except `customer_id`); `withdrawal_requests_rules`
  (name and email "are not changed afterwards", a confirmed withdrawal is never deleted); `returns_rules` (never deleted); `order_events_append_only`;
  `invoices`/`credit_notes` immutable except the 1b anonymising path (`commerce.anonymising`); `audit_log_guard` (append-only for 24 months);
  `email_messages_refuse_copied_order`.

---

## 2. Behaviour

### 2.1 Words

- **Subject** (the person): in one store, identified by an **account** (`customers.id`) and/or a **lowercase email**. A person with an account and
  earlier guest orders under the same email is one subject; an order placed signed in under another email belongs to the account. A guest is a
  subject without an account. The same person in two stores is two subjects (two exports, two erasures).
- **Export**: one JSON file of what the store holds about the subject (section 2.2).
- **Erasure**: closing the account and removing or restricting every register entry for the subject (section 2.4).
- **Restricted**: an order (and what hangs on it) that must be kept for the bookkeeping duty or legal claims keeps its personal fields until the end of
  the retention period but is cut loose from the person and used for nothing else (section 2.4). **Anonymised**: the personal fields replaced by a marker
  (`[removed]`, an empty address, `orders.anonymised_at` set); the sale (number, date, amounts, VAT, lines) stays.
- **Request**: a row in `privacy_requests` with a one-month clock. Staff log a request that arrives by email, post or phone; a shopper's own
  download or delete is logged by the system as a request already done.

### 2.2 The export (what a tester checks)

**Format.** One UTF-8 JSON file, named `{store-slug}-data-{YYYY-MM-DD}.json` (shopper: `{store-slug}-my-data-{YYYY-MM-DD}.json`), served with
`Content-Disposition: attachment` and `Cache-Control: no-store`. Never emailed, never put in a URL, never kept on a server after the response. Top level:

```jsonc
{
  "schema": "kaizen.customer-export", "version": 1,
  "generatedAt": "2026-10-04T10:00:00.000Z",
  "store": { "name": "...", "legalName": "...", "organisationNumber": "...", "contactEmail": "...", "country": "NO" },
  "subject": { "kind": "account" | "guest", "email": "...", "accountId": "..." | null },
  "information": { /* Art. 15(1): purposes, categories, recipients, storage periods, source, rights, in the shopper's language, section 8 */ },
  "sections": { /* the table below, every key always present: an empty list or null, never missing */ },
  "counts": { "orders": 3, "...": 0 },
  "notIncluded": [ { "what": "...", "why": "..." } ]
}
```

Amounts are `{ "amountMinor": 12345, "currency": "EUR" }`: the integer minor units and the **order's own currency** (what was charged, in the euro view too), never
converted. Dates are ISO 8601 UTC. Ids are the store's own ids. A section is always the same shape for any subject.

**Sections** (each source is a register entry; "excluded" says what is deliberately left out of the table's row):

| Section | Source (all by `store_id`) | Contains | Excluded |
|---|---|---|---|
| `profile` | `customers` | email, name, phone, address, locale, created, last sign-in, email-verified date, `hasPassword` (boolean), `hasAvatar` (boolean), company name and number, customer group (name, percent), company membership (company name, role) | password hash, lock state, failed-sign-in counts, the avatar file |
| `addresses` | the account's address, orders' billing and shipping addresses, subscriptions' and standing lists' addresses | the distinct addresses with where each came from | — |
| `orders` | `orders`, `order_lines`, `payments`, `refunds`, `shipments`, `order_downloads`, `order_terms`, `order_events`, `bookings` | per order: number, dates, status, currency, subtotal, shipping, discount (with member, campaign, credit and referral parts), tax, total, VAT kind and reason, delivery service, addresses, email used, company, discount code, lines (title, SKU, quantity, unit price, tax rate, totals, booked time), payments (provider, amount, currency, status, date, reference), refunds (amount, status, date, and the reason staff typed), shipments (carrier, tracking number), downloads (file name, count), terms accepted (mode, time, locale), the order's event types and dates (and the free text staff typed in a cancellation's reason or a note); `copied: true` for history copied from another store (D129); `host: true` for a host's order; `restrictedSince` and `keptUntil` for a restricted order | `client_secret`, `provider_account`, download tokens, event `data` other than `reason` and `note`, staff cost figures (`unit_cost_minor`), a booking's staff or room name (another person's data) |
| `invoices`, `creditNotes` | `invoices`, `credit_notes` | number, dates, series, currency, net, VAT, total, VAT per rate, the **snapshot** (the buyer block as issued, the seller, the lines); `anonymised: true` where the document was anonymised | hosted-page tokens, PDF paths |
| `returns` | `returns`, `return_lines`, `withdrawal_requests`, `withdrawal_request_lines` | number, kind, status, reason and the shopper's note, the store's decision note, refund note and **internal staff note** (personal data about the person: Art. 15 has no exemption for it; the staff screen warns before downloading, section 2.3), refund amounts and dates, lines; withdrawals: name, email, channel, submitted, confirmed, acknowledged | return label tokens, `public_token` |
| `subscriptions` | `subscriptions`, `subscription_lines` | number, status, interval, amounts, address, email, next date, lines | provider references, `manage_token` |
| `deliveries` | `standing_orders`, `standing_order_lines`, `standing_deliveries` | list, schedule name, address, lines, card label (for example "Visa ••4242"), consent date, skipped dates, each delivery's date and order number | Stripe ids, payment method id |
| `wishlists` | `wishlists`, `wishlist_items`, `wishlist_cart_adds` | each list (name), items (title, SKU, quantity, date added), what was added to a cart from it | the browser token hash |
| `bonus` | `bonus_entries`, `commerce.bonus_balance()` | the ledger (kind, amount, currency, date, expiry, order number, the staff's reason), the balance in the program's currency | — |
| `referrals` | `affiliates`, `affiliate_attributions` | their code, whether blocked and the staff's reason, counts and amounts of rewards and discounts, whether they were referred | **who** a friend is or who referred them (another person's data) |
| `consents` | `email_opt_outs`, `form_submissions`, `order_terms`, `orders.digital_consent_at`, `withdrawal_requests.acknowledged_at`, `abandoned_checkouts.opted_out_at`, `standing_orders.consent_at` | each consent or refusal that the store holds under their email or account, with its date and source | **cookie consent records**: they are kept under a random browser id and cannot be tied to a person (said in `notIncluded`) |
| `emails` | `email_messages` | emails sent to the subject's addresses (account email and the emails of their orders): kind, subject, sent date, status, the plain-text body, the order number | the HTML body, provider references, the sign-in code emails' bodies |
| `carts` | `carts`, `cart_lines`, `abandoned_checkouts` | their carts (lines, dates, status), the reminder record (captured date, reminders sent, clicked, recovered) | tokens |
| `forms` | `form_submissions` by email | kind, date, status | other visitors' texts |
| `company` | `customer_companies`, `company_invites` | the company they belong to, invitations to their email (status, dates) | other members |
| `customFields` | `customerFieldExport()` extended to orders | staff-entered custom fields on the customer and their orders: group, field label, value | — |

`notIncluded` always says: password and sessions (security); other people's data (friends who were referred, staff and rooms in bookings); pseudonymous
logs that cannot be tied to a person (counted visits, browser consent records, search queries, recommendation tabs); card data (the store never holds it:
Stripe does, on the store's own account); data held by the store's processors and recipients (Stripe, the email service, any Zapier, Make or Slack
connection the store set up); reviews and other later features: "not yet part of the store" until a table exists (the register test forces it into the export first).

**Rules of the export.** Every query has the store id; the file for a person who shops in two stores holds one store's data only. A subject with no data at
all still gets a file (`counts` all zero, `subject.kind: "guest"`): the answer to "do you hold data about me" is a file saying no. The whole file or an error:
a subject with more than 100,000 rows in all sections is refused with a plain sentence, never cut short (the same discipline as the invoice CSV).
A copied order (C-…), a host's order, a booking, a subscription renewal order and an order in another currency all appear as the rows they are.

### 2.3 Staff side

Pages and keys (permission names are `PermissionKey`s, `src/lib/permission-keys.ts`; there is no `export` key, so a bulk personal-data download is
`customers:write`, as the invoice CSV is `orders:write`):

1. **Customer page** (`/admin/{store}/customers/{key}`, `customers:read` to see): a new **Privacy** card with the subject's open request if any, the counts per
   section ("3 orders, 2 emails ..."), **Download data** (a POST, `customers:write`) and **Erase personal data** (`customers:write`). A banner shows when
   the subject has an overdue request. Before the first download the card says: *the file includes internal notes about the customer, because they are
   personal data; read them first if they must not be shared*.
2. **Download**: `POST /admin/{store}/customers/{key}/export` → the file; refuses with a redirect and a fixed sentence (`?export=too_large`), never text from the address;
   checks `sameSite()`; writes `customer.data_exported` (area `customers`; details: subject kind, customer id or null, counts; **never** the email or name) and, when
   a request is open for the subject, completes it (`outcome: exported`).
3. **Erase**: `/admin/{store}/customers/{key}/erase`, two steps. **Step 1, the preview** (`planErasure()`, read-only, same code as the real run): a table, one
   row per register entry that has data for this subject, with the **count**, the **action** (Deleted, Made anonymous, Kept restricted until {date}, Kept) and the
   **reason** in a sentence; a list of **what else happens** (subscriptions that will be cancelled now and not refunded; saved cards detached; bonus credits forfeited, with
   the amount per currency; open orders and returns that continue); a list of **warnings** (the email is also a staff or host account; the person is the main account
   of a company; the person is a Work client; copies of this customer exist in other stores of the same owner, which are not erased here; copied orders in other stores).
   **Step 2, confirm**: the staff member types the subject's email address (or, for a subject with none, the word `ERASE`) and presses the button. The run starts.
4. **Privacy requests** (`/admin/{store}/privacy`, Customers section, `customers:read` to list, `customers:write` to act): the log. *Log a request*: kind (export
   or erase), the person's email, **the date it was received** (default today; staff set an earlier one when it arrived by email, because the one-month clock runs from
   receipt), and a note. The row shows `due` (received + one month) with the days left, red when overdue. Actions on an open request: *Download data*, *Erase*,
   *Extend* (reason required; allowed once, up to two further months, only before the due date; sends the notice email), *Refuse* (a reason from a closed list and an
   optional note; sends the refusal email, section 2.6), *Close as "no data held"* (when the preview is empty), *Cancel* (logged as a mistake). A request is never
   deleted by staff. Identity: when staff doubt the person is who they say, *Waiting for identity* pauses nothing in the system (the clock is shown as it is; the law's
   pause is for staff to apply) but records the date; the page says the controller should use what it has (a reply to the address on file).
5. **Order page** (existing): a restricted order shows a banner "Personal data restricted since {date}. Kept until {date} because of the bookkeeping rules. Use it only for
   the accounts." An anonymised order shows `[removed]` for name, address and email, and the date.
6. **Lists and searches** (customers list, customer detail, orders search, analytics identity): a restricted order does not appear under a person any more (its `customer_id`
   is null and no reader matches it by email, section 3.5); it still counts in revenue and VAT as the sale it was.
7. **Notices to owners**: each staff-triggered erasure and each staff-triggered download emails every owner of the store (English, no personal data in it: who did it, when,
   the request id). The permission check, the typed confirmation and these notices are the controls in place of Shopify's 10-day cancel window.
8. **Roles**: reading the privacy list and the card is `customers:read`; downloading, erasing and logging are `customers:write` (a default, section 9 asks the lead to confirm
   it, the alternative being owner-only erasure through `requireOwnerRole`).

### 2.4 Erasure: what happens to every kind of data

Run by `eraseSubject(store, subject, by)` (section 5). The principle, per register entry: **delete** what no law needs; **anonymise** what must stay as a row but
not as a person; **restrict** what the bookkeeping duty or a legal claim requires until the end of the period and then anonymise; **keep** only what is not
personal or must be kept to honour the person's own wish (the email opt-out).

Order of operations (a run is resumable, every step idempotent, a per-subject advisory lock stops two at once):

1. **Plan** (`planErasure()`), written to the request row (`plan_summary`: counts only).
2. **External first, before any change**: cancel live subscriptions at once (`changeSubscription(..., "cancel_now", { actor })`; the `actor` list gains `"privacy"`; no
   refund, no proration), detach saved cards of standing lists (the existing call). A Stripe failure stops the run **before the database changes** with the plain message
   "Stripe did not answer; nothing was changed. Try again." and the request stays open. Stripe's own customer and payment records on the store's account are
   **not** deleted by this unit (they are the store's Stripe data and Stripe keeps its legal records): the screens say so.
3. **One database transaction** for the subject's rows (all of it or none):
   - Orders (non-copied, any status): for each, `commerce.anonymise_order(store, order, 'erasure')`. It anonymises at once an order that is **not a sale**
     (`pending_payment`, or `cancelled` with no captured payment) or **copied** (`copied_from` set: history, not this store's sale); every other order is **restricted**:
     `restricted_at = now()`, `customer_id = null`, an order event `order.restricted`. Its documents stay as they are (only `anonymise_expired_documents()` may change them).
   - Subscriptions: `email = '[removed]'`, `shipping_address = '{}'`, `manage_token` replaced by a new random one, `customer_id = null` (a subscription is a contract,
     not an accounting document; its renewal orders are the accounting records and are restricted as orders).
   - Withdrawal requests, returns and VAT checks of restricted orders: stay with the order (restricted) and are anonymised when it is, by the same function. Those of an
     order anonymised now are anonymised now.
   - Standing lists, their lines and deliveries, wishlists, sign-in links, sessions, sign-in codes for the email, company invitations to the email or account, form
     submissions by the email: **deleted**. Bonus entries and affiliates: deleted by cascade with the account (credits forfeited; stated in the preview). `affiliate_attributions`
     lose both customer ids (`ON DELETE SET NULL`, already so).
   - Carts of the account or with the email: `customer_id`, `company_name`, `organisation_number`, `vat_number`, `vat_check_id`, `affiliate_code` cleared; their
     `delivery_quotes` lose postal code and pickup points; `abandoned_checkouts` of those carts or by email: email and lines cleared (the existing erase), opt-out kept.
   - Emails (`email_messages`): rows whose `to_address` is the subject's email (or an address of their orders) have `to_address`, `subject`, `html`, `text` replaced by
     `[removed]`/empty; **rows are kept** (their `idempotency_key` stops a replayed webhook from sending the confirmation again), except emails of an **evidence kind**
     (`return.acknowledgement`: the withdrawal acknowledgement on a durable medium, D153), which stay until the order's retention ends. Emails to staff about the person's
     orders (booking notices) are blanked the same way.
   - Download links of the subject's orders are revoked (`order_downloads.expires_at = now()`), because the link opens a purchase without a sign-in.
   - The account: `customers` row deleted (field values go by the existing trigger); `email_opt_outs` is **kept** (a suppression record: erasing it would let the store email the
     person again; said in the preview and the confirmation).
4. **After commit**: the avatar file is removed from Storage (`removeAvatarFiles`); a failure is recorded (`filesLeft`) and retried by the daily job; staff custom-field values of the
   subject's orders that are anonymised now are deleted (a later retention run does the rest).
5. **Complete**: `privacy_requests` row → `done`, `subject_email = null`; audit `customer.erased` (area `customers`, details: customer id or null, counts per action, the retained-until
   dates as a range, never an email or name); the confirmation email (section 2.6); owners' notices when staff did it; the shopper's session cookie ends when they did it themselves.

**Restriction is not decoration.** From `restricted_at` on: the order is never matched to a person (`customer_id` null; every reader that matches orders by email adds
`restricted_at is null`, section 3.5); never emailed (`sendEmail()` refuses an order or subscription email whose order is restricted or anonymised and logs status `suppressed`); never used
by marketing, recommendations, analytics identity (a restricted order is its own anonymous customer, revenue unchanged), bonus, referrals; and not copied to another store
(`copy_orders()` skips it). Staff see the personal fields on the order page and in documents only, with the banner. The shopper's access by an order page's own key
keeps working until the order is anonymised (the person may still need it) and shows the restriction.

**Retention ends it.** When a restricted or ordinary order passes its period (section 2.5), `anonymise_order(..., 'retention')` replaces: `orders.email` with `[removed]`; `billing_address`
and `shipping_address` with `{}`; `company_name`, `organisation_number` with null; `vat_treatment`'s `buyerVatNumber`, `vies.registeredName`, `vies.registeredAddress` with null (`orders_vat_frozen`
is extended to let this pass, and only this); the order's `vat_checks` row (`name`, `address` null, `number` `[removed]`) when no other live order uses it; its withdrawal requests' `name` and
`email` and its returns' free-text notes (`reason_note`, `decision_note`, `staff_note`, `refund_note`) with the marker; sets `anonymised_at`; writes `order.anonymised`. Delivery services and
public pickup points are not personal and stay; a test pins the keys of `OrderDelivery` so a personal key added later fails it.

**What never changes**: order number, dates, status, currency, subtotal, shipping, discount, tax, total, VAT kind and relief, lines, payments, refunds, shipments, events, bookings,
terms acceptance, invoices' numbers, amounts and VAT per rate (the invoice documents themselves are anonymised only by `anonymise_expired_documents()` at the same cutoff, called first).

**Shopper self-service** (`/s/{store}/{market}/account/privacy`, linked from My account's "Your data" card):

- Needs a **fresh sign-in**: `customer_sessions.verified_at` within `FRESH_SIGN_IN_MINUTES` (10; a new session sets it; a stale session shows "Confirm it is you": a six-digit code
  emailed (the existing code flow, one step) or the password for password accounts, which sets `verified_at`). A stale session never downloads or deletes.
- **Download my data** → the file for the signed-in account (and guest orders under the same verified email, as `claimOrders` already joins them).
- **Delete my account**: a page that says in the shopper's language what goes, what stays and until when ("N orders are kept by the shop until {date} because bookkeeping law
  requires it; then your name, address and email are removed"), that subscriptions end now, saved cards are removed, bonus credits are lost, and that Stripe keeps its own payment
  records; one button. It runs `eraseSubject()` with `by: shopper`, ends the session, shows the result page and emails the confirmation. The current confirm-in-the-browser
  dialog is replaced. The behaviour change (subscriptions now end and a fresh sign-in is needed) is stated in the decision row.
- A guest (no account) has no self-service; the store's privacy page tells how to ask (the legal starter of 1e names the contact email). A public request form is not built (section 7).

### 2.5 Retention (the schedule, run daily)

Seeded in `commerce.retention_rules` with source, basis (`read`, `snippet`, `secondary`, `fallback`, `policy`), `checked_on` and `verified_at` (null until a platform admin marks a
row reviewed). **Policy** rows are Kaizen's own proportionality choices (GDPR Art. 5(1)(e)), not statutes, and say so. `runRetention(now)` (daily; application code; each step isolated, batched at 5,000,
a clock argument; never throws; returns counts) performs, in this order:

| # | Kind (rule) | Period (seed) | What the job does | Enforced by |
|---|---|---|---|---|
| 1 | `bookkeeping` (per `stores.country`; counts from the end of the calendar year of the document or sale) | NO 60 months `read`; SE 84 `read`; DK 60 `snippet`; DE 96 `secondary`; default 120 `fallback` | `anonymiseDocuments(store, cutoff)` first (1b), then `commerce.anonymise_expired_orders(store, today)`: orders (and their withdrawals, returns notes, VAT checks) whose anchor date is before the cutoff, **erased or not** | new |
| 2 | `host_bookkeeping` (a host's order) | 120 `secondary` (DAC7) | the same for orders with `host_id` | new |
| 3 | `unpaid_orders` | 30 days `policy` after `placed_at` | `anonymise_order(..., 'retention')` for orders never paid (not a sale): the row stays (the number is gap-free), the person goes | new |
| 4 | `email_bodies` | 12 months `policy` | blank `to_address`/`subject`/`html`/`text`, keep the row; evidence kinds wait for their order; platform emails (`store_id` null) the same | new |
| 5 | `security_emails` (sign-in codes, links, password resets, invitations) | 7 days `policy` | blank the same way | new |
| 6 | `carts` | 90 days `policy` after the cart ended (open: `expires_at`; else `updated_at`) | clear personal columns and unlink, as erasure does; keep the row | new |
| 7 | `delivery_quotes` | 30 days after `expires_at` `policy` | clear `postal_code`, `pickup_points` | new |
| 8 | `customer_codes` | 7 days after `expires_at` `policy` | delete | new |
| 9 | `customer_sessions` | 30 days after `expires_at` `policy` | delete | new |
| 10 | `webhook_payloads` | 90 days after processing `policy` | set `payload = '{}'` (the row stays: its event id de-duplicates) | new |
| 11 | `consents` | 12 months | delete (the pg_cron job does it too where it exists; the job is idempotent) | existing (pg_cron) + new app step |
| 12 | `privacy_request_contact` | 30 days after done `policy` | `subject_email = null` | new |
| 13 | `privacy_requests` | 24 months after done `policy` | delete the row (the one deletion the table's guard allows) | new |
| 14 | `search_queries` | 90 days (`SEARCH_LOG_DAYS`) | existing `pruneSearchLog()` | existing, five-minute cron |
| 15 | `visits` | 25 months (`RETENTION_MONTHS`) | existing `pruneVisits()` | existing, daily |
| 16 | `audit_log` | 24 months (`AUDIT_RETENTION_MONTHS`) | existing `pruneAuditLog()` | existing, daily |
| 17 | `form_submissions` 30 days, `integration_deliveries` 30 days, `abandoned_checkouts` 30 days, `recommendation_events` `EVENT_DAYS`, `ai_usage` `USAGE_KEEP_DAYS` | as coded | existing pruners | existing |

Rows 14 to 17 are *described* in the table (their `enforced_by` names the function) and the code's constants stay the source; a unit test asserts each seeded period equals its constant, so
the two cannot drift. A new pruner reads its period from the rule through `retentionRule()`.

**The anchor date of an order** (`commerce.order_anchor(order)`): the latest of the order's placed day, paid day, each refund's day, each credit note's `issued_on` and a return's refund day, in
the **store's** time zone (`commerce.store_day`); an order is anonymised when `anchor < retentionCutoff(country, storeToday)` (the 1b formula: the cutoff is 1 January of year − years). The
documents' `issued_on` are never later than the anchor, so documents are always anonymised no later than their order. The database refuses a `bookkeeping` cutoff younger than **5 years**
(the shortest of the four), as the documents' function does.

**Order of the daily run** and its isolation: documents, orders, then the small tables; a failure in one step is logged (`console.error`) and the next runs; the totals are written to the audit log
as one platform entry `retention.run` (store null) and, per store with anything removed, `privacy.retention_applied` (area `customers`, counts only) so an owner sees what the schedule did.

**The platform's page** (`/admin/platform/retention`): every rule with its source, basis, `checked_on` and verification; an unverified-rules banner; *Mark as reviewed* (writes `verified_at`,
`verified_by`, audit `retention.rule_verified`); *Change a period* (`commerce.set_retention_rule()`, never an edit in place: a new row with `valid_from`, the old one closed, audit
`retention.rule_set`; the 5-year floor for `bookkeeping` and a ceiling check); the register (read-only table of `PERSONAL_DATA`) and the last 30 daily results from the audit log.

### 2.6 Emails (new; every consumer text hand-written, section 8)

| Email | To | When | Language | Logged |
|---|---|---|---|---|
| **Erasure confirmation** | the subject's email | after an erasure completes (shopper or staff), the one send that survives | the account's `locale`, else the latest order's language, else the store's main language (nb, sv, da, en hand-written; others show English) | the row's `to_address` is `[removed]`, subject without a name; idempotency key `privacy.erased:{request}` |
| **Extension notice** (Art. 12(3)) | the subject | staff press *Extend* | as above | normal log row (it is part of the open request) |
| **Refusal notice** (Art. 12(4)): reasons, the right to complain to the supervisory authority (Datatilsynet for NO; the store's own authority named in its settings, a setting the starter already has) and to seek a judicial remedy | the subject | staff press *Refuse* | as above | normal |
| **Owners' notice** | every owner | a staff download or erase | English | normal |
| **Request due reminder** | every owner | 7 days before `due_at`, and once when overdue (keys `privacy.due:{id}`, `privacy.overdue:{id}`), from the daily job | English | normal |

The **export** is never emailed. A refusal and an extension are sent to the address held; the system never emails an address a person typed into a form (it only has the one staff entered or on file).

### 2.7 Edge cases

- **Guest with no account**: staff export and erase by email; the request, the plan and the run work from the email; `customer_id` handling is skipped.
- **Order placed under one email by an account with another**: belongs to the account (as `claimOrders()` and `findCustomer()` already say); the export and the erasure take both.
- **A subject is also a staff account, a host or a Work client**: the preview warns; nothing of those is touched (separate subjects, section 7).
- **Main account of a company**: the company stays with its employees and no owner; the preview warns, staff promote another first or accept it.
- **A copy of the customer in another store** (`customers.copied_from`): the owner is told in the preview; the other store is a different controller scope and is erased there.
- **Copied orders (C-…)**: exported (marked `copied`); anonymised at once on erasure (history, not this store's sale), by an exception in `copied_orders_read_only` that only the anonymising function can use; never deleted
  (D141); never exported to a third store (`copy_orders()` skips restricted and anonymised orders).
- **Host orders**: exported with `host: true`; erased as restricted until the `host_bookkeeping` period; the host is the seller and is another subject.
- **Other currencies**: nothing is converted; the preview shows restricted order totals **per currency**, never summed; the euro-view order exports and erases like any other (a euro scenario in `checkout-kinds.int.test.ts`).
- **Other languages**: every shopper text is hand-written nb, sv, da, en; other languages see English (as `invoice-text.ts`); the export's keys are English and the `information` block is in the shopper's language.
- **Erased person comes back**: a new, empty account; restricted orders never relink (`claimOrders`, `linkOrderToCustomer`, `emailHistory` exclude them), so they cannot see the old orders and the registration gate does not treat them as a known buyer.
- **Withdrawal after erasure** (within the 14 days of an order that is restricted): the withdrawal function still finds the order by its number and email (the contract right is not lost); this is the one reader allowed to match a restricted order by email, named in the scan test's allow-list.
- **Failure**: an error in the export gives the plain message and no file; an erasure that fails after the external step leaves the request `open` with `steps` showing where, the page offers *Continue*, and the daily job resumes open erasures (idempotent). A request logged
  for a subject with no data closes as `no_data`. Two erasures for the same email at once: the second waits on the advisory lock and finds nothing to do.
- **Audit**: no entry ever holds an email or a name; a test scans the details of every `customer.*`, `privacy.*` and `retention.*` write.

---

## 3. Data

### 3.1 Tables and columns (all additive; `src/db/schema.ts` then `pnpm db:generate`)

**`commerce.retention_rules`** (platform table, no `store_id`; not in `COPY_RULES`): `id uuid pk`, `kind text not null` (check against `RETENTION_KINDS`), `country char(2) null` (FK `countries.code`;
null = the default for every country), `period_value integer not null check (> 0)`, `period_unit text not null check in ('days','months')`, `counts_from text not null check in ('event','end_of_year')` (`end_of_year` only
with a `months` period that is a multiple of 12), `source text not null`, `source_url text null`, `basis text not null check in ('read','snippet','secondary','fallback','policy')`, `checked_on date not null`,
`valid_from date not null`, `valid_to date null`, `enforced_by text not null` (the job step or pruner), `note text not null default ''`, `verified_at timestamptz null`, `verified_by uuid null` (FK `accounts`, indexed),
`created_by uuid null`, `created_at timestamptz not null default now()`. Unique `(kind, coalesce(country,'--'), valid_from)`; at most one row with `valid_to is null` per `(kind, country)`. Written **only** by
`commerce.set_retention_rule()` (like `set_vat_rate()`: advisory lock, closes the previous row, audit-logs, refuses a `bookkeeping` period shorter than 60 months and a `valid_from` not after the latest); read **only**
through `commerce.retention_rule(kind, country, at)` and `retentionRule()` (`retention-readers.test.ts` scans the source).

**`commerce.privacy_requests`** (store-owned; `COPY_RULES`: `never`, "Requests and their clocks belong to the store's own people"): `id uuid pk default gen_random_uuid()`, `store_id uuid not null` (FK stores),
`kind text not null check in ('export','erasure')`, `channel text not null check in ('shopper','staff')`, `status text not null default 'open' check in ('open','done','refused','cancelled')`,
`subject_customer_id uuid null` (**no foreign key**: the account is deleted by the erasure), `subject_email text null check (subject_email = lower(subject_email))`, `received_at timestamptz not null default now()`,
`due_at timestamptz not null check (due_at >= received_at)`, `extended_until timestamptz null` (check `<= received_at + interval '3 months'` and `> due_at`), `extension_reason text null`, `identity_doubt_at timestamptz null`,
`completed_at timestamptz null`, `outcome text null check in ('exported','erased','no_data','refused','cancelled')`, `refusal_reason text null check in ('identity_not_confirmed','manifestly_unfounded','excessive','legal_hold','other')`,
`refusal_note text null`, `note text not null default ''`, `plan_summary jsonb null` (counts only), `steps jsonb not null default '{}'`, `handled_by uuid null` (FK `accounts`, indexed), `created_at`, `updated_at`.
Checks: `status = 'open'` iff `completed_at is null`; `done` needs an `outcome` in `exported|erased|no_data`; `refused` needs a `refusal_reason`; **`kind = 'erasure' and status = 'done'` ⇒ `subject_email is null`**.
Indexes: `(store_id, status, due_at)`; unique partial `(store_id, subject_email) where status = 'open' and kind = 'erasure'`. Trigger `privacy_requests_rules`: status moves only forward from `open`; a finished row's kind, store, subject
and dates never change; a delete is refused unless `completed_at < now() - interval '24 months'` (the retention step's one deletion, as `guard_audit_log()` does).

**Columns added to existing tables**:

- `commerce.orders.restricted_at timestamptz null`, `commerce.orders.anonymised_at timestamptz null`. An order anonymised by retention was never restricted, so no check ties the two columns together; the one check is
  `anonymised_at is null or (email = '[removed]' and billing_address = '{}'::jsonb and shipping_address = '{}'::jsonb and company_name is null and organisation_number is null)`, so the marker and the date cannot disagree.
- `commerce.customer_sessions.verified_at timestamptz not null default now()` (the last proof of identity: sign-in or step-up).

No other column. A table whose rows can be anonymised is recognised by a marker value (`[removed]`), as the invoices' snapshot marker is.

### 3.2 The database's own rules (the register's teeth)

All functions set `search_path = ''` and contain **no `DELETE`, `TRUNCATE` or `DROP`** (deletion lives in application code run by the job and the erasure; the production
migration tool cancels such statements). Anonymising is `UPDATE` only. The transaction-local setting `commerce.anonymising = 'on'` (the 1b one; set and reset only inside the
functions below) is the only exception to the immutability rules named here.

1. `commerce.order_anchor(p_order uuid) returns date` and `commerce.order_anonymisable_on(p_order uuid) returns date`: the earliest day the order's personal data may go (every order has one): a not-a-sale order (`pending_payment`, or `cancelled` with no captured payment): the day it was placed (+ the `unpaid_orders` period for the schedule, immediately for
   erasure); a **copied** order: immediately; a **sale** (anything else): 1 January of (anchor year + years + 1) of `bookkeeping`/`host_bookkeeping` for the **store's country** with a floor of 5 years (the 1b rule of 4.5: a sale of year Y goes on 1 January of Y + years + 1; the foundation corrected this sentence, which first said "anchor year + years").
2. `commerce.anonymise_order(p_store uuid, p_order uuid, p_mode text) returns text` (`'erasure'` | `'retention'`): checks the order belongs to the store; in `'retention'` mode raises `anonymise_not_due` unless
   `order_anonymisable_on(order) <= store today`; in `'erasure'` mode anonymises when due and otherwise **restricts** (`restricted_at`, `customer_id = null`, event `order.restricted`); returns `anonymised`, `restricted` or `already`.
   Anonymising updates exactly the fields listed in section 2.4 and writes `order.anonymised` (not for copied orders, whose events the database refuses: the function skips the event for them).
3. `commerce.anonymise_expired_orders(p_store uuid, p_today date, p_limit integer default 5000) returns integer`: calls `anonymise_order(..., 'retention')` for orders that are due; refuses a `p_today` that is not the store's
   date (like the 1b function refuses a young cutoff); idempotent.
4. **Triggers patched** (each by the `pg_get_functiondef` idiom of `20261002215352_returns_rules.sql`: one block inserted at a known anchor, idempotent by a `position(...)` check, failing loudly if the anchor is missing, so patches compose in
   either order): `orders_vat_frozen` (lets `vat_treatment` change only when the setting is `on`), `copied_orders_read_only` (lets the personal columns of a copied order change only when `on`; `copied_from` and the money still cannot),
   `withdrawal_requests_rules` (name and email only, only when `on`), `returns_rules` (the four note columns and `label_url`, only when `on`; placed before its update branch), `vat_checks_immutable` (name, address and number only, only when `on`; **added by the foundation**: the buyer's VIES answer cannot be anonymised without it), `copy_orders()` (skips orders with
   `restricted_at` or `anonymised_at`), and `guard_audit_log()` is **not** touched.
5. `commerce.retention_rule(kind, country, at)` returns `(period_value, period_unit, counts_from)`: the row of that country valid at `at`, else the default (null country), else the hard-coded fallback of `retention_rules`' seed
   (so an empty table never means "keep nothing" or "delete everything": it means the safe side, 120 months).
6. `commerce.set_retention_rule(...)`: as in section 3.1.
7. `commerce.audit_area_of()` is replaced in a **new** migration for the new prefixes (`privacy.` → customers, `retention.` → platform, `customer.data_exported`, `customer.erased` already `customer.` → customers).

### 3.3 What is private

Everything here is private data: the export holds the whole of a person's record. It is served only by the routes of section 5, with `no-store`, no cookie set, no analytics event; `robots` is irrelevant (POST, behind sign-in). The register page and the plan show counts and
table names, never values. The audit log, the request row (`plan_summary`) and the owners' emails hold counts and ids only. The AI manager's tools (section 5) read counts and request metadata, **never a person's data**, and there is no assistant tool that exports or erases.

### 3.4 Copying a store

`privacy_requests`: `COPY_RULES` `never`. `retention_rules`: platform data, not store-owned, so not in the map. `duplicate_store()` and `clone_store()` copy nothing new. `copy_orders()` skips restricted and anonymised orders (3.2 item 4).
`copy_customers()` is unchanged (it copies only customers who exist; an erased one is gone). The register's `PERSONAL_DATA` entry for each table carries its `COPY_RULES` group as a column of the doc table in 3.5.

### 3.5 The register: `PERSONAL_DATA` (`src/lib/personal-data.ts`)

```ts
export type PersonalEntry = {
  table: string;                // "orders", or "storage:avatars" for a bucket
  subject: "shopper" | "staff" | "host" | "owner" | "business" | "pseudonymous" | "none";
  link: { via: "customer" | "email" | "order" | "cart" | "subscription" | "standing_order" | "return" | "withdrawal" | "visitor" | "none"; columns: string[] };
  personal: string[];           // columns (or "col.jsonKey") that hold the data; empty only for "none"
  export: ExportSection | null; // the section (2.2) that carries it
  erasure: "delete" | "anonymise" | "restrict" | "keep" | "none";
  until?: RetentionKind;        // the rule that ends a restrict or a keep
  reason: string;               // one sentence; required for restrict, keep and none
};
export const PERSONAL_DATA: PersonalEntry[];
/** Tables that matched a detector and were looked at: why they hold no personal data. */
export const NOT_PERSONAL: Record<string, string>;
export const EMAIL_KINDS: Record<string, "shopper" | "staff" | "security" | "evidence">; // every kind passed to sendEmail()
```

**Detectors** (constants in `src/lib/personal-data.ts`, run by the test against PGlite after every migration; a table that matches any is *looked at* and must be in `PERSONAL_DATA` or `NOT_PERSONAL`):

- **A, by column name** (the row's criterion): `customer_id`, `email`, `phone`, `address`, `name` exactly; names ending `_email`, `_phone`, `_address` or starting `email_`, `phone_`, `address_`; and `legal_name`, `contact_name`, `first_name`, `last_name`,
  `full_name`, `ip`, `ip_address`, `user_agent`, `visitor`, `to_address`, `recipients`.
- **B, by anchor**: a foreign key to `customers`, `orders`, `carts`, `subscriptions`, `standing_orders`, `returns`, `withdrawal_requests`, `invoices`, `credit_notes`, `bookings`, `wishlists` or `hosts`. (`accounts` is not an anchor: ~80 tables point at it with `created_by`.)
- **C, by free text and payload** (where personal data hides in a `jsonb` or a note): a column named `payload`, `snapshot`, `details`, `changes`, `query`, `filters`, `choices`, `response`, `body`, `html`, `text`, `content`, `note`, `notes`, `reason_note`, `message`, `data`, `lines`.

Run on the schema at the date of this spec (192 tables in `commerce`) the detectors match **114 tables** (89 by A and B, 25 more by C; counted with the foundation database, `psql` against a clone of the template). The first-draft classification, which the foundation agent turns into the file and corrects where the code says otherwise:

| Group | Tables | `subject` / `erasure` / `until` |
|---|---|---|
| The person | `customers` (profile → `profile`; delete); storage `avatars` (delete) | shopper |
| Orders and what hangs on them | `orders` (`orders`, restrict → anonymise, until `bookkeeping`; not-a-sale and copied: anonymise now); `order_lines`, `payments`, `refunds`, `shipments`, `bookings`, `order_terms`, `legal_snapshots`, `inventory_reservations`, `document_deliveries`, `document_pdf_state` (not personal in themselves: `keep`, reason "no personal field; the sale record"); `order_events` (keep; a test scans event `data` keys for `email|name|address|phone`); `order_downloads` (revoke on erasure); `host_commissions` (keep) | shopper |
| Documents | `invoices`, `credit_notes` (`invoices`/`creditNotes`; restrict, until `bookkeeping`; only `anonymise_expired_documents()` changes them); storage `documents` (PDFs; removed with the row's anonymisation) | shopper |
| Withdrawal and returns | `withdrawal_requests` (name, email; restrict → anonymise), `withdrawal_request_lines`, `returns` (notes; restrict → anonymise), `return_lines`, `withdrawal_attempts` (hashed keys, a day: `pseudonymous`, none) | shopper |
| Subscriptions and lists | `subscriptions` (email, address; anonymise now), `subscription_lines`, `standing_orders`, `standing_order_lines`, `standing_deliveries` (delete), `checkout_accounts` (delete) | shopper |
| Sign-in | `customer_sessions`, `customer_codes`, `customer_sign_in_links` (delete; 9, 8 in the schedule) | shopper |
| Wishlists, carts | `wishlists`, `wishlist_items` (delete), `wishlist_cart_adds` (unlinked by the foreign key), `carts` (anonymise; schedule 6), `cart_lines`, `delivery_quotes` (schedule 7), `abandoned_checkouts` (anonymise now) | shopper |
| Loyalty | `bonus_entries`, `bonus_allocations`, `affiliates` (delete, forfeited), `affiliate_attributions` (ids set null), `referral_visits` (counts, `pseudonymous`) | shopper |
| Company | `customer_companies` (the company's data, `business`, keep), `company_invites` (delete by email) | shopper / business |
| Email and consent | `email_messages` (blank; schedule 4 and 5), `email_opt_outs` (**keep**, reason "a suppression record; erasing it would let the store email the person again"), `form_submissions` (delete), `consents`, `visits`, `product_views`, `experiment_exposures`, `experiment_events`, `experiment_carts`, `search_queries`, `search_clicks`, `recommendation_events`, `recommendation_adds`, `chat_usage` (`pseudonymous`: no link to a person; their own retention) | shopper / pseudonymous |
| Fields | `field_values` (the `customer` and `order` entities: `customFields`; delete with the customer; order values deleted when the order is anonymised) | shopper |
| Tax | `vat_checks` (buyer's number, VIES name and address: restrict → anonymise with the order); `store_tax_profile` (the seller's, `owner`) | shopper / owner |
| Processors' queues | `webhook_events` (payload; schedule 10), `integration_deliveries` (payload; 30 days, existing), `idempotency_keys` (`none`: unused) | shopper (in payloads) |
| The owner's own bookkeeping | `work_clients`, `work_invoices`, `work_credit_notes`, `work_events`, `work_invoice_lines`, `work_invoice_payments`, `work_recurring_invoices`, `work_time_entries`, `work_settings`, `work_assignments`, `work_tasks`, `work_timers` (`business`: Work is the owner's own accounting, kept under the bookkeeping duty, a separate subject; the preview warns when the person is a Work client) | business |
| Staff, hosts, owners, the platform | `accounts`, `store_members`, `store_roles`, `audit_log`, `account_recovery_codes`, `assistant_*`, `kaizen_life_links`, `hosts`, `host_tax_details`, `host_stripe_accounts`, `booking_resources` (staff/room/host contacts), `access_requests`, `abandoned_plan_checkouts`, `referrers`, `referral_entries`, `stores`, `store_locations`, `accessibility_settings`, `invoice_settings`, `economic_operators`, `google_places`, `return_settings` | `staff`/`host`/`owner`: **not this unit's subject** (section 7); each has an entry with `erasure: "none"` and the reason |
| Configuration whose `name`, `description` or `note` is not a person's | `campaigns`, `menus`, `terms`, `plans`, `plan_features`, `countries`, `field_groups`, `font_files`, `product_files`, `calendar_feeds`, `delivery_schedules`, `inventory_locations`, `customer_tiers`, `saved_parts`, `store_themes`, `chat_agents`, `cookie_notes`, `vat_rates`, `vat_categories`, `product_translations`, `ui_translations`, `knowledge_documents`, `knowledge_chunks`, `field_search`, `marketing_spend`, `shipping_vat_rules`, `ai_model_prices`, `platform_languages`, `experiments`, `experiment_variants`, and the like | `NOT_PERSONAL`, one-line reason each |

**The tests of the register** (`src/lib/personal-data.test.ts` pure, and the PGlite block in `src/db/privacy.test.ts`, "the heart of the unit"):

1. Every table matched by A, B or C is in exactly one of `PERSONAL_DATA` and `NOT_PERSONAL`; no entry or reason names a table that is gone; every `personal` column exists.
2. **A new table fails**: the test creates `commerce.zz_reviews (store_id uuid, customer_id uuid, body text)` and `commerce.zz_notes (store_id uuid, note text)` inside a PGlite transaction and asserts the detector reports both as unclassified (so a future wave that adds reviews, tickets or messages fails here until it classifies them, and, if shopper-linked, until the export has a section for it).
3. Every `export` section exists in `EXPORT_SECTIONS` and every section has at least one entry feeding it; every entry with `subject: "shopper"` and a `link` has an `erasure` other than `none`; `restrict` and `keep` carry a `reason`, a `restrict` names an `until` kind that is seeded in `retention_rules`.
4. Every table with a `store_id` has a `COPY_RULES` entry (existing test) and the register shows the same group in its `reason` for shopper tables that are `never` (a consistency check of words, not of data).
5. `EMAIL_KINDS`: a source scan of the `kind:` passed to `sendEmail()` (like `permissions.scan.test.ts`) fails for a kind that is not classified; `evidence` kinds are exactly `return.acknowledgement`.
6. **Restricted orders are not matched to a person** (`restricted-orders.scan.test.ts`): every `src/server` module that matches orders by `lower(o.email)`, `lower(email)` on orders, or `customer_id` must contain `restricted_at` in that query or appear in an allow-list with a reason. First allow-list: `withdrawals.ts` (the contract right, 2.7); `return-facts.ts`, `checkout.ts` (the buyer's own order at placement); the server agent walks `customers.ts`, `customer-admin.ts`, `cart-reminders.ts`, `recommend.ts`, `analytics-customers-data.ts`, `analytics-totals.ts`, `analytics-refunds-data.ts`, `owner-insights.ts`, `owner-tools.ts`, `manager-tools.ts`, `bonus-emails.ts`, `affiliate-emails.ts`, `companies.ts`, `campaigns.ts`, `discounts.ts`, `standing-orders.ts` (the files the grep of this spec found), and adds the guard or the allow-list entry.

---

## 4. Rules and law (exactly)

1. **Who may ask**: the data subject. For a shopper with an account, the proof is a **fresh sign-in** (a code to the address on file or the password, within 10 minutes). For a request logged by staff, staff are responsible for confirming identity (they reply to
   the address on file; the unit never emails a typed address). A refusal for identity (`identity_not_confirmed`) is allowed and carries the Art. 12(4) notice.
2. **Deadlines**: `due_at = received_at + one month` (`privacyDeadline(received)`: the same day of the next month, clamped to the month's last day, in UTC; **a weekend or holiday never extends it**, the safe side of an unread rule). An extension: once, with
   a reason, before the due date, **to at most received + 3 months** (one month plus two), the notice sent within the first month (Art. 12(3)). Overdue = `now > coalesce(extended_until, due_at)`.
3. **Free of charge** (Art. 12(5)): the screens never mention a fee. A refusal as manifestly unfounded or excessive is staff's reasoned choice, with the notice; the unit does not decide it.
4. **Erasure and the exceptions**: personal data under the bookkeeping duty (Art. 17(3)(b)) or needed for legal claims (17(3)(e)) is restricted, not erased, until the end of the period; nothing else is kept except the email opt-out (the person's own objection to marketing:
   a suppression record) and what has no personal field. The sentence the shopper reads says which and until when.
5. **Retention periods** are the rows of 2.5, per `stores.country`; the bookkeeping rows count from the **end of the calendar year** of the document or sale (the 1b rule: `cutoff = 1 January of (year of today − years)`, so a document of year Y goes on 1 January of Y + years + 1); the five-year floor in SQL; an unknown
   country is 10 years. A financial year that is not the calendar year is **not modelled** (the margin of the calendar-year reading is the safe side for Norway and Sweden, whose wording counts from the end of the financial year; stated, flagged).
6. **Amounts and rounding**: the export carries stored integers; nothing is recomputed; the preview's per-currency totals are sums of integers per currency, shown with `formatMoney`.
7. **Time zone**: the anchor date and "today" are the **store's** day (`commerce.store_day`, `stores.time_zone`); request clocks are UTC instants.
8. **Fresh sign-in window**: `FRESH_SIGN_IN_MINUTES = 10`, a constant in `src/lib/privacy-request.ts`.
9. **Export size**: 100,000 rows in all sections (`EXPORT_ROW_LIMIT`), refused, never cut.
10. **What an audit entry may hold**: ids, counts, kinds, dates, the actor; never an email, name, address, phone or free text (a test scans).

---

## 5. Where things live (and which agent area owns what)

Areas share files **only through the registries**. The foundation agent writes the registries' entries for every area (one commit before the others start); later agents add only the entries marked *theirs*.

### 5.1 Foundation (schema, migrations, pure libraries, texts, the register)

| File | Contents |
|---|---|
| `src/db/schema.ts` | `retentionRules`, `privacyRequests`; columns `orders.restricted_at`, `orders.anonymised_at`, `customer_sessions.verified_at` |
| `supabase/migrations/{ts}_gdpr.sql` (generated), `{ts}_gdpr_rules.sql` (custom: `pnpm exec drizzle-kit generate --custom --name gdpr_rules`), `{ts}_gdpr_audit.sql` (custom: replaces `audit_area_of()`) | the tables, checks, triggers, functions of 3.2, the seeds of 2.5, the plan-feature row (`Operations`, "GDPR data export and erasure and a data retention schedule", position 484, the 1f migration's idiom), the patched trigger functions and `copy_orders()` |
| `src/lib/personal-data.ts`, `.test.ts` | `PERSONAL_DATA`, `NOT_PERSONAL`, `EMAIL_KINDS`, the detectors, `EXPORT_SECTIONS` |
| `src/lib/retention.ts`, `.test.ts` | `RETENTION_KINDS`, `retentionCutoff(country, today, rules)` (replaces the constants of `invoice-retention.ts`, which re-exports it), `RETENTION_SEED` (the rows of 2.5, also read by the migration's seed through a generated list so they cannot differ), `periodCutoff()`, the constants-equal-rules test |
| `src/lib/privacy-export.ts`, `.test.ts` | the export's types, `shapeExport()` (pure: rows in, file out), `EXPORT_ROW_LIMIT`, `notIncluded` text, a JSON-schema-like validator the tests use |
| `src/lib/erasure-plan.ts`, `.test.ts` | `ErasurePlan` types, `summarisePlan()`, `retainedUntil()`, warning kinds, the preview's sentences' keys |
| `src/lib/privacy-request.ts`, `.test.ts` | statuses, `privacyDeadline()`, `extensionAllowed()`, `isOverdue()`, `FRESH_SIGN_IN_MINUTES`, `isFresh()`, refusal reasons |
| `src/lib/privacy-text.ts`, `.test.ts` | **all** consumer wording (nb, sv, da, en; section 8), the staff-facing English strings, the owners' emails (`src/lib/privacy-emails.ts` for the English ones, like `experiment-emails.ts`) |
| `src/lib/audit.ts` | prefixes `privacy.` → customers, `retention.` → platform; the three new actions' areas; (`AUDIT_AREAS` scan test) |
| `src/lib/store-copy-rules.ts` | `privacy_requests: never(...)` |
| `src/lib/invoice-retention.ts` | becomes a thin re-export; `ANONYMISE_FLOOR_YEARS` stays |
| tests | `src/db/privacy.test.ts` (PGlite: the register detectors, the SQL functions, the triggers, the floor, `copy_orders()`), `src/db/commerce.test.ts` untouched except that its "every store table has a COPY_RULES entry" test now sees `privacy_requests` |

### 5.2 Server

| File | Contents |
|---|---|
| `src/server/privacy-export.ts` | `exportCustomerData(storeId, subject)` → file or `too_large`; one query per section, all by `store_id`; `subjectOf(storeId, key)` resolves an account id, an order id or an email (via `findCustomer()`) |
| `src/server/privacy-erasure.ts` | `planErasure()`, `eraseSubject()`, the steps of 2.4, `resumeErasures()`, the advisory lock, `deleteCustomer()` becomes a call to it (kept as the shopper's entry for existing tests, which are updated) |
| `src/server/privacy-requests.ts` | log, list, extend, refuse, close, cancel, overdue lookups, `due` reminders, the email sends (through `sendEmail()`), `requestFor()` |
| `src/server/retention.ts` | `runRetention(now)` and each step (2.5), `retentionRule()` (the only reader of `retention_rules` besides the SQL), `retentionOverview()` for the platform page |
| `src/server/customers.ts` | `verified_at` set on sign-in and step-up, `startFreshSignIn()`/`confirmFreshSignIn()`, `claimOrders()`/`linkOrderToCustomer()`/`emailHistory()` exclude restricted orders; `deleteCustomer()` delegates |
| `src/server/email.ts` | `sendEmail()` refuses (`suppressed`) an email for a restricted or anonymised order or subscription; an option `logAddress: false` stores `[removed]`; `EMAIL_KINDS` scan |
| `src/server/subscriptions.ts` | `changeSubscription()` accepts `actor: "privacy"` for `cancel_now` |
| `src/server/customer-admin.ts` and the readers listed in 3.5 test 6 | the `restricted_at is null` guards |
| `src/server/security-jobs.ts` | unchanged (its model); `src/app/api/cron/subscription-reminders/route.ts` gets `runRetention()` and `resumeErasures()` in its `Promise.all` and its JSON |
| `src/server/invoice-retention.ts` | unchanged (called first by `runRetention()`) |

Registries the server area edits: the cron route; `src/server/permissions.ts` none (it uses `requirePermission` / `checkPermission`); `src/lib/permissions.baseline.json` for the new routes (the scan test).

### 5.3 Shopper

| File | Contents |
|---|---|
| `src/app/s/[store]/[market]/account/privacy/page.tsx`, `actions.ts`, `confirm/page.tsx` | "Your data": download, the step-up code, the delete page and its result; every action `signedIn()` and fresh |
| `src/app/s/[store]/[market]/account/privacy/export/route.ts` | `POST`, `sameSite()`, fresh sign-in, `no-store`, `attachment`; a stale session redirects to the step-up |
| `src/components/account-forms.tsx`, `src/app/s/[store]/[market]/account/account-section.tsx` | the "Your data" card replaces `DeleteAccountButton`; `StorePartSection`/`account` role unchanged (the card is inside the account section) |
| `src/lib/i18n.ts` | **remove** `account.deleteTitle`, `deleteIntro`, `deleteButton`, `deleteConfirm` (all languages; the catalogue follows by itself) in favour of `privacy-text.ts` |
| `src/lib/cookie-consent.ts` | **no change**: no cookie or storage is added (the step-up uses the existing session cookie and column) |
| tests | `e2e/privacy.spec.ts`, component `renderToString` tests for the card and the delete page in nb, sv, da, en |

### 5.4 Admin

| File | Contents |
|---|---|
| `src/app/admin/(gated)/[store]/privacy/page.tsx`, `[requestId]/page.tsx`, `new/page.tsx`, `actions.ts` | the request log, a request, logging one |
| `src/app/admin/(gated)/[store]/customers/[customerId]/page.tsx` (Privacy card), `export/route.ts`, `erase/page.tsx`, `erase/actions.ts` | the card, the download, the two-step erase |
| `src/app/admin/(gated)/platform/retention/page.tsx`, `actions.ts` | rules, review, change, the register, last runs |
| `src/components/admin/privacy/*.tsx` | the plan table, the request row, the rule table (admin tokens, `ActionForm`, no fixed colours) |
| registries | `src/lib/store-nav.ts`: Customers group, `item("/privacy", "Privacy requests", ...)`; `src/lib/platform-nav.ts`: `SETTINGS_ITEMS` `item("/retention", "Data retention", ...)`; `src/lib/admin-map.ts`: `store("privacy", "/privacy", ...)`, `store("privacy.request", "/privacy/[requestId]", ...)`, `store("customer.erase", "/customers/[customerId]/erase", ...)`, `platform("retention", "/retention", ...)`, with `tasks` and `keywords` (data request, subject access request, DSAR, GDPR, erase, delete customer, anonymise, forget me, right to be forgotten, personvern, innsyn, sletting); `src/lib/permissions.ts` path rules: `/privacy` is the customers area |
| tests | `src/components/admin/privacy/*.test.tsx` (`renderToString`), the nav/admin-map tests, `src/lib/permissions.scan.test.ts` baseline |

### 5.5 Analytics and AI

| File | Contents |
|---|---|
| `src/server/analytics-sql.ts` (and the data modules named in 3.5 test 6) | `PERSON_KEY`: a restricted order is its own anonymous customer; revenue, VAT, refunds unchanged; a test with a restricted and a normal order |
| `src/server/control-center.ts`, `src/lib/control-center.ts` | an attention item "N privacy requests are due this week or overdue" per store (`privacy_requests` counts) |
| `src/lib/owner-tools.ts`, `src/server/owner-tools.ts`, `src/lib/owner-tool-permissions.ts`, `TOOL_WORDS` | read-only tools `list_privacy_requests` and `explain_privacy_request` (counts and metadata only, `customers:read`, a row in `TOOL_PERMISSIONS`; also served by the store MCP server as every owner tool is); **no export or erase tool** (section 7) |
| `src/lib/assistant-skills.ts` | a playbook "A customer asks for their data or to be forgotten": log the request, open the privacy page, the one-month clock, what the preview says |
| `src/lib/plan-features` migration | done by the foundation agent |
| tests | tool schema and permission tests, the control-center test |

**Not touched by anything in this unit**: `KNOWN_COOKIES`, the sitemap, `llms.txt`, structured data (no public page is added), store translation (`src/lib/store-translate.ts`: no new translatable store text), `findClaims()` (no AI text), the pay routes (`PayRouteGuard`, `checkoutCsp()`: no pay route changes).

---

## 6. Acceptance criteria, row by row

Row `international.gdpr-data-export-and-erasure`. Its four criteria (kept as written) map to G1 to G12; a criterion is met when every G under it passes.

**Criterion 1.** *Staff (and the shopper from My account) can download a customer's data as a machine-readable file: profile, addresses, orders and lines, returns, consents, wishlists, reviews-to-be, custom-field values, emails sent.*

| ID | Behaviour | Held by |
|---|---|---|
| G1 | A subject with one of **every** kind of data (account, guest orders under the same email, copied order, host order, euro-view order, booking, subscription and renewal, standing list and delivery, wishlist, bonus entries, referral, return and withdrawal, invoice and credit note, emails, carts, abandoned checkout, opt-out, form sign-up, custom fields on customer and order) exports a file whose every section is present and whose **counts round-trip** (the number of rows inserted equals `counts`; each section's ids equal the inserted ids) | `src/server/privacy-export.int.test.ts` (new fixture `src/server/privacy-fixture.ts`) |
| G2 | The file is valid, stable JSON in the schema of 2.2: the validator accepts it; sections have the same keys for an empty subject; the **excluded** fields (password hash, tokens, client secrets, `staff cost`, provider ids) never appear (a deep scan of the whole file for the fixture's secret strings); the euro-view order carries `EUR` and the charged amounts; a guest with no data gets a file with zero counts | `privacy-export.test.ts` (pure), `privacy-export.int.test.ts`, one scenario in `checkout-kinds.int.test.ts` (export and erasure of a euro-view order: the CLAUDE.md rule for a new money read) |
| G3 | Staff download: `customers:write` gets the file with `attachment` and `no-store`; `customers:read` and a member of another store get 404 or the refusal; `sameSite()` is enforced; a subject over the row limit is refused, never cut | route test + `permissions.scan.test.ts` baseline + `privacy-export.int.test.ts` |
| G4 | Shopper download: signed in with a **fresh** session gets their file; a session whose `verified_at` is older than 10 minutes is redirected to the step-up and gets nothing; after the code (or password) it works; another customer's session never gets this subject's file | `src/server/privacy-shopper.int.test.ts`, `e2e/privacy.spec.ts` |
| G5 | **Another store's data is never in an export**: the same email as a customer in store A and store B, each with sentinel strings in orders, emails, carts and fields: A's file contains none of B's sentinels and the reverse; an id of B's order passed to A's export is not found | `privacy-export.int.test.ts` (multi-tenant) |

**Criterion 2.** *Staff can erase a customer on request: the account and personal fields go, and orders under the bookkeeping duty are anonymised or restricted (name, address, email removed after the retention period) with the reason logged in the audit log.*

| ID | Behaviour | Held by |
|---|---|---|
| G6 | **Erasure scenario, before and after the retention date** (a fixed clock): a subject with a paid order is erased; the account, sessions, codes, wishlists, standing lists, field values, bonus entries and carts' personal columns are gone; the paid order is **restricted** (`restricted_at`, `customer_id` null, email and address still there, the banner data present); a not-a-sale order and a copied order are anonymised at once; subscriptions are cancelled (Stripe called with an injected client) and anonymised; `email_messages` blanked except the evidence kind; `email_opt_outs` kept; download tokens revoked; then the clock passes the country's period and `runRetention()` anonymises the order, its documents (called first), its withdrawal request, return notes and VAT check; totals, VAT, numbers, dates, lines unchanged; the order is not deleted (D141) | `src/server/privacy-erasure.int.test.ts` |
| G7 | The database enforces it: `anonymise_order(..., 'retention')` raises `anonymise_not_due` for a young sale; the 5-year floor holds for a wrong rule; `anonymise_order(..., 'erasure')` restricts instead of anonymising a sale; `orders_vat_frozen`, `copied_orders_read_only`, `withdrawal_requests_rules`, `returns_rules` refuse the same changes **outside** the function and allow them inside it; an invoice is untouched by an erasure; no function contains `DELETE`/`TRUNCATE`/`DROP` (a scan of the migration) | `src/db/privacy.test.ts` |
| G8 | **A restricted order is used for nothing**: it is not relinked by `claimOrders()` when the same email signs up again, not counted by `emailHistory()`, not shown in the customers list or detail, not emailed (`sendEmail()` returns `suppressed`), not copied by `copy_orders()`, counted once in revenue and as its own anonymous customer in analytics; the scan test lists the readers | `restricted-orders.scan.test.ts`, `privacy-erasure.int.test.ts`, `analytics-customers.int.test.ts` (extended), `store-copy.int.test.ts` (extended) |
| G9 | **Audit**: every export and erasure writes its entry (action, area `customers`, ids and counts, actor), by staff or by the shopper (actor null, `by: shopper`); the entries never hold an email or a name; the erasure confirmation email's log row holds `[removed]`; owners are emailed when staff do it | `privacy-erasure.int.test.ts`, `privacy-requests.int.test.ts`, `audit.test.ts` (the scan for the new actions' areas) |
| G10 | Shopper delete: needs the fresh session; shows what stays and until when in nb, sv, da, en; runs the same erasure; ends the session; the old orders do not appear if they register again; **a failure after the external step leaves the request open and is resumed** | `privacy-shopper.int.test.ts`, `e2e/privacy.spec.ts`, component tests |

**Criterion 3.** *A retention schedule (orders, emails, search queries, carts) runs from the cron and a test shows what it removes and what it keeps.*

| ID | Behaviour | Held by |
|---|---|---|
| G11 | **The keep/remove table** with a fixed clock: for each row of 2.5 a fixture of one record just inside and one just outside the period, per country where it differs (NO, SE, DK, DE, and an unknown country at 10 years): `runRetention(now)` removes or anonymises exactly the outside ones and leaves the inside ones, returns the counts, is idempotent (a second run changes nothing), isolates a failing step, honours batches; the seeded periods of the existing pruners equal their constants; the rules carry source, basis, `checked_on`, `verified_at` null; the cron route calls it | `src/server/retention.int.test.ts`, `src/lib/retention.test.ts`, `src/db/privacy.test.ts`, the cron route test |

**Criterion 4.** *Another store's data is never in an export (multi-tenant test); the export and the erasure are audit-logged.*

G5 and G9. In addition **G12**: **the register is complete and teeth-bearing**: the detectors, the fake-table failure, the export section coverage, the email-kind scan, and the request rules (clock, extension to at most three months, refusal needs a reason, an erasure's `subject_email` is null once done, an erased subject's request never keeps the email) — `personal-data.test.ts`, `src/db/privacy.test.ts`, `privacy-request.test.ts`, `privacy-requests.int.test.ts`.

**Also checked** (not new criteria): a platform admin can change a retention period only through `set_retention_rule()` (history kept, the floor enforced) and only a platform admin can mark a rule reviewed (`retention-admin.int.test.ts`, `e2e/privacy.spec.ts` for the page); `e2e/a11y.spec.ts` covers any new **signed-out** page (none is added: the shopper pages are behind sign-in, so the shopper and admin pages are checked by hand and by `renderToString` tests, the existing statement for signed-in pages); `pnpm parity:check`.

**Criteria changes** (proposed; the rows are not edited by this run):

1. Criterion 1 lists *reviews-to-be*. There is no reviews table yet (wave 5), so it cannot be tested now. Proposed text: "...custom-field values, emails sent, and any table added later is in the register and the export (a test fails for one that is not)". G12 holds the second half and `notIncluded` names reviews as "not yet part of the store".
2. Criterion 1 lists *consents*. Cookie consent records are kept under a random browser id and cannot be tied to a person, so they cannot be in a person's export; the consents the store **can** tie to a person are listed in 2.2. Proposed text: "consents the store holds under the person's email or account (marketing sign-ups, opt-outs, terms and withdrawal acknowledgements); browser cookie consent is not linkable and is said so in the file".
3. Criterion 3 lists *carts* and *emails*; both are in 2.5 (they did not exist as retention at all before this unit). No change; noted so the lead sees that two of the four named kinds are new work, not description.
4. Criterion 2 reads "anonymised or restricted (name, address, email removed after the retention period)": kept as written; the retention period is per the **seller's** country and starts at the end of the year of the sale, which the criterion does not say.

**Rating this run can honestly reach**: `full` when G1 to G12 pass, with the two caveats of section 1.1 stated in the row. Bucket stays A for the build; the unverified periods and the legal review are listed, not hidden. Nothing in this unit needs a third party's approval.

---

## 7. What is deliberately NOT done, and why

| Not done | Why | Later |
|---|---|---|
| **A public "request my data" form for guests** | Needs identity verification of a stranger by email, which is a fraud and abuse surface (a stranger asking for another person's order history). Guests ask the store by email; staff log it; the starter privacy page names the contact | wave 5 (customer accounts depth) if wanted, with a signed-link flow |
| **A 10-day cancel window** like Shopify | Replaced by the preview, the typed confirmation, the owners' notice and the restriction (an erasure of a sale cannot lose the sale record anyway) | — |
| **Erasing data at Stripe, the email provider, Zapier, Make, Slack or any carrier** | Those are the store's own accounts and processors; Stripe keeps its own legal records. Only subscriptions are cancelled and saved cards detached. The screens say so, and the export's `notIncluded` names them | wave 4 (payments) may add a Stripe customer delete |
| **Staff, host, platform-owner and applicant data** (`accounts`, `store_members`, `hosts`, `access_requests`, Work clients, the AI manager's conversations and memories) | Different subjects with different rules (employment, DAC7, the owner's own bookkeeping). They are classified in the register with a reason, not handled. The AI manager's conversations hold what tools returned (customers' names): a retention period for them is the AI manager's owner's decision | a platform-privacy unit in wave 9 |
| **Inactive-account deletion and unverified-account cleanup** | A consumer-facing notice before deleting an account needs a new hand-written text and a decision about the period | wave 5 |
| **Per-store retention overrides** | The platform sets the periods; a store shortening a policy period is a feature, not a duty | later |
| **Financial years that are not calendar years** | Not modelled (4.5) | wave 1c or the accountant's review |
| **An assistant tool that exports or erases** | Irreversible and full of personal data; it would put a person's record into a model's context. Read-only counts and the playbook only | never without a design |
| **The Art. 15(1) "recipients" list generated from the store's integrations** | The `information` block is hand-written and generic; a per-store list of connected recipients is wave 9 (integrations registry) | wave 9 |
| **Notifying a recipient (Art. 19) that data was erased** | The integrations' events are one-way queues with no recipient contact; the owner is told which are connected in the preview | wave 9 |
| **Deleting orders, numbers or documents** | D141 and D159: never; the unit only anonymises | — |
| **Sending the export by email, or a zip with files** | A plaintext email is the weaker channel; the invoice PDFs are not in the file (their data is, in the snapshots) | — |
| **The bonus ledger as a retained record** | Credits are forfeited on erasure as today (cascade); said in the preview; a store that wants a ledger of liabilities keeps it in its books | wave 5 (gift cards and liability report) |

---

## 8. Needs human legal review

Every text below is hand-written in `src/lib/privacy-text.ts` (nb, sv, da, en), flagged `// legal: needs review`, kept out of `i18n.ts` and the AI catalogue; a unit test asserts all four languages exist for every key and that no key
puts a free-text field inside a statutory sentence. Reviewed by a lawyer in each country before real use:

1. The shopper's **Your data** card and the **delete page**: what goes, what stays and until when, the bookkeeping explanation, "Stripe keeps its own payment records", the subscription and bonus consequences.
2. The **erasure confirmation email** (what was removed, what is kept and until when, the opt-out kept, how to complain to the supervisory authority).
3. The export's **`information` block** (Art. 15(1): purposes, categories, recipients, storage periods, the rights, the source, the right to complain), in four languages, and the `notIncluded` sentences.
4. The **extension notice** (Art. 12(3)) and the **refusal notice** (Art. 12(4): reasons, the right to complain, the right to a judicial remedy), four languages.
5. The one-sentence **reasons** staff may show a person for each class of kept data ("kept for bookkeeping law until {date}", "kept so you are not emailed again", "kept to defend legal claims").
6. The **retention periods themselves** (accountant): NO read, SE read (text of the section), DK snippet, DE secondary, the default 10 years, the `host_bookkeeping` 10 years (DAC7, secondary), the five-year floor, the calendar-year reading of "end of the financial year", and every **policy** period (30, 90 days, 7 days, 12, 24 months).
7. The decision that internal staff notes are **included** in the export (Art. 15 has no exemption for them; staff are warned first).
8. The statement that the **email opt-out is kept** after erasure and the wording of its reason.
9. Whether `customers:write` (not owner-only) may erase.
10. The staff-facing English pages (preview wording, the request log) are not consumer texts but state the law (the one-month clock, the extension limit): a lawyer should read the clock sentences.

---

## 9. For the lead

### 9.1 Migrations expected

1. `{ts}_gdpr.sql` (`pnpm db:generate`): `retention_rules`, `privacy_requests`, the three columns, their checks and indexes (index every new foreign key: `privacy_requests.handled_by`, `store_id`; `retention_rules.verified_by`, `country`).
2. `{ts}_gdpr_rules.sql` (custom): the functions and triggers of 3.2, the `retention_rules` seeds (from `RETENTION_SEED`, with the sources of 1.3), the plan-feature row, the patched `orders_vat_frozen`, `copied_orders_read_only`,
   `withdrawal_requests_rules`, `returns_rules` and `copy_orders()`, the pg_cron note for consents (no change to the existing job).
3. `{ts}_gdpr_audit.sql` (custom): `commerce.audit_area_of()` replaced for `privacy.` and `retention.` (a **new** migration; never an edit of a committed one).

Apply to production **after** the tests pass (the standing rule), then check advisors and record the versions in `docs/decisions.md` (Migration versions). **This run applies nothing and pushes nothing** (lane rule); CI's `migrate` job
(`docs/ci-migrations.md`) applies committed files after the checks once the lead merges.

### 9.2 Statements the Supabase migration tool would cancel (so the owner runs them)

**None by design.** No function contains `DELETE`, `TRUNCATE` or `DROP`; every deletion is application code in `src/server/retention.ts` and `src/server/privacy-erasure.ts`. The migrations contain no `DROP` of a table, column or function (functions are
`CREATE OR REPLACE`; triggers are created, none dropped; the patched functions keep their triggers). `ownerStatements`: none expected. If the foundation agent finds one is unavoidable, it lists it here with the exact statement.
One thing the owner may want to do by hand: **confirm that `pg_cron` runs `kaizen-consent-retention` in production** (`select * from cron.job`), since the app step in 2.5 row 11 makes it redundant but harmless.

### 9.3 Advisors and checks after applying

Security: every new function `search_path = ''`; the new tables are in the private `commerce` schema (not exposed by the Data API; no policies expected, as for the existing tables). Performance: unindexed foreign keys on the new tables (listed in 9.1); the
retention steps run through `(store_id, ...)` indexes in batches: add `orders_retention_idx (store_id, placed_at) where anonymised_at is null` for the orders step; the email step uses the existing `email_messages_store_created_idx`; check the plan of `anonymise_expired_orders()` on a store with 100,000 orders (`retention.int.test.ts` has a size guard like `analytics-perf.int.test.ts`).

### 9.4 Decisions taken with defaults (say if one is wrong)

| Question | Default |
|---|---|
| Who may erase | `customers:write` + typed confirmation + owners' notice; the alternative is owner-only |
| Staff notes in the export | included, with a warning to staff |
| Subscriptions on erasure | cancelled at once, no refund (Shopify cancels too); today's account delete leaves them billing |
| Shopper delete needs a fresh sign-in (10 minutes) | yes; a behaviour change from today |
| Orders under the duty | restricted (kept, cut loose, unused) until the period, then anonymised; **orders past the period are anonymised even without a request** (storage limitation) |
| Bookkeeping periods | NO 5 / SE 7 / DK 5 / DE 8 / other 10 years from the end of the calendar year, flagged for the accountant |
| Email bodies | 12 months; security emails 7 days; evidence kinds with the order |
| Carts, quotes, codes, sessions, webhook payloads | 90 days, 30 days, 7 days, 30 days after expiry, 90 days |
| The email opt-out after erasure | kept |
| Guests | staff only (no public form) |
| Cookie consent log | not in an export (not linkable) |
| Retention numbers for existing pruners | stay constants, asserted equal to the rules |

### 9.5 Draft of the decision row (D162 proposed; the lead renumbers)

| D162 | **GDPR export, erasure and a retention schedule (wave 1, unit 1g).** A register (`PERSONAL_DATA`, `src/lib/personal-data.ts`) names every table that can hold a person's data, how it links to them, what the export says and what erasure does; three detectors (by column name, by foreign key to a shopper anchor, by free-text or payload column) fail a test for any table not in it, so a later wave cannot add personal data unnoticed. `exportCustomerData()` gives one JSON file (profile, addresses, orders with lines, payments, refunds, shipments, invoices and credit notes, returns and withdrawals, subscriptions and standing lists, wishlists, bonus, referrals, consents, emails, carts, custom fields) to staff (`customers:write`, a POST) and to the shopper after a fresh sign-in; the file is never emailed and never holds another store's or another person's data. `eraseSubject()` closes the account and removes or restricts every register entry: orders under the bookkeeping duty are **restricted** (cut loose from the person, unused, never emailed or relinked, not copied) and anonymised by the retention job after the **seller's country's** period (NO 5, SE 7, DK 5, DE 8, other 10 years from the end of the calendar year of the sale), subscriptions are cancelled, copied and unpaid orders are anonymised at once, email bodies are blanked (rows kept for their idempotency keys), the email opt-out is kept; nothing deletes an order (D141) and the invoices change only through `anonymise_expired_documents()` (D159). `commerce.retention_rules` holds every period with source, basis, date and a reviewed flag (written only by `set_retention_rule()`); `runRetention()` runs daily from the existing cron in application code with a clock argument and ends the gaps found in this read (customer codes and sessions, email bodies, carts, quotes, webhook payloads, orders). `commerce.privacy_requests` carries the one-month clock of GDPR Art. 12(3), extension to three months and a reasoned refusal. Every export and erasure is audit-logged with counts and ids only. All consumer wording is `src/lib/privacy-text.ts`: hand-written nb, sv, da, en, needing legal review. *Why:* the row `international.gdpr-data-export-and-erasure`; the account delete left names, addresses and emails in orders, email logs and webhook payloads for ever, and a running subscription billing nobody. |

### 9.6 Draft of the CLAUDE.md bullet

- **Personal data (D162, `docs/wave-1g-gdpr.md`)**: every table that can hold a person's data is in `PERSONAL_DATA` (`src/lib/personal-data.ts`) with how it links to them, the export section that carries it and what erasure does (`delete`, `anonymise`, `restrict`, `keep`), or in `NOT_PERSONAL` with a reason; a test (`src/db/privacy.test.ts`) fails for a table with `customer_id`, `email`, `phone`, `address` or `name` columns, a foreign key to a shopper anchor, or a free-text or payload column that is in neither, and a new kind of `sendEmail()` must be in `EMAIL_KINDS`. A new table of shopper data therefore needs: a register entry, an export section in `shapeExport()`/`exportCustomerData()`, an erasure step in `eraseSubject()`, a retention rule if it grows, and a `COPY_RULES` decision. The export (`src/server/privacy-export.ts`) is one JSON file by `store_id`, never emailed, with amounts in the order's own currency; staff need `customers:write`, the shopper a fresh sign-in (`customer_sessions.verified_at`, 10 minutes); both are audit-logged with ids and counts and **never an email or a name**. Erasure (`src/server/privacy-erasure.ts`) never deletes an order (D141): a sale is **restricted** (`orders.restricted_at`, `customer_id` null) and anonymised by `commerce.anonymise_order()` when the seller's country's period ends (`commerce.retention_rules`, read only through `retentionRule()`; written only by `set_retention_rule()`); every query that matches orders to a person by email adds `restricted_at is null` (`restricted-orders.scan.test.ts`), and `sendEmail()` refuses an email for a restricted or anonymised order. The anonymising SQL functions contain no `DELETE`; deletions are application code (`runRetention()` in the daily cron, `src/server/retention.ts`). The one-month request clock is `privacyDeadline()`; the consumer wording is `src/lib/privacy-text.ts` (hand-written nb, sv, da, en, needs legal review, never in `i18n.ts`). An audit entry for any of this never holds personal data.

### 9.7 Risks

- **Restriction relies on readers** adding `restricted_at is null` (about twenty modules); the scan test is what keeps a forgotten one from relinking an erased person's orders. It is the unit's largest piece of care.
- **Four patched trigger functions** touch immutability rules written by other units (returns D153, VAT D157, copy D129); each patch composes by the `pg_get_functiondef` idiom and has a test that the rule still holds outside the function.
- **Behaviour changes** for shoppers (fresh sign-in; subscriptions end) and for stores (orders are anonymised after the period without anyone asking; email bodies disappear after 12 months). Both are in the decision row and on the screens.
- **The retention numbers are not verified** (section 1.3); the page shows it until a platform admin marks them reviewed.
- **Daily job size**: the first run on a large production database anonymises everything older than the periods; batches and a per-run cap (`p_limit`) spread it over days, and the platform page shows progress.

---

## 10. Foundation notes: where the built code differs from the text above (written with the foundation, 2026-10-04)

The foundation built sections 3 and 5.1 (schema, three migrations, the pure libraries, the register and their tests). Where it had to differ, the code is right and this list says how:

1. **Anchor and due day**: `commerce.order_anonymisable_on()` returns 1 January of (anchor year + years + 1), as 4.5 says (3.2 item 1 is corrected above).
2. **Five patched trigger functions, not four**: `vat_checks_immutable` also gives way to the anonymising setting (only `name`, `address`, `number`). A check's `number` cannot be `[removed]` (its check needs a country prefix and 2 to 12 characters), so the marker is the prefix followed by `**` (`DE**`).
3. **What `anonymise_order()` changes beyond 2.4**: `customer_id` (also on anonymise, not only on restrict), `delivery.postalCode` (the postal code the delivery was priced for is the delivery address's), and a return's `label_url` (a carrier's label holds the address). Everything else in 2.4 is as written. The order's `order.restricted` event carries `until` (the first day the data may go) and `order.anonymised` carries `mode` and `was_restricted`; neither carries a person.
4. **`anonymise_expired_orders(p_store, p_today, p_limit)`** refuses a day *after* the store's own today (not a day that is not today): a fixed clock in a test is a past day with the data backdated; `anonymise_order(..., 'retention')` always judges by the real store day. The candidate scan is bounded by `orders_retention_idx (store_id, placed_at) where anonymised_at is null` and by the year of the shortest possible period.
5. **`retention_rules` unique indexes** use `coalesce(country, '__')` (the generator mangles the `'--'` of 3.1). `commerce.verify_retention_rule(id, account)` was added (the review: once, audit `retention.rule_verified`, as `verify_vat_rate()`); `retention_rules_guard` allows only `valid_to` (once) and the review to change.
6. **`privacy_requests`**: `received_at`, `due_at`, kind and channel never change, not only for a finished row; the database fills `due_at` (received + one month) when the application leaves it out; the state check uses `coalesce(...)` so a missing outcome cannot pass; an extension cannot be set at insert.
7. **The register** (`src/lib/personal-data.ts`) has an optional `also: ExportSection[]` on an entry (a table that feeds more than one section, such as `orders`: orders, addresses, consents), a `registerProblems()` that the PGlite test and the pure test share, and entries for tables the detectors do not match but that hold shopper data (`field_values`, `bonus_allocations`, `refunds`, `shipments`, `search_clicks` and the pseudonymous logs). `EMAIL_KINDS` also lists the six kinds of this unit (`privacy.erased`, `privacy.extended`, `privacy.refused`, `privacy.owners_notice`, `privacy.due`, `privacy.overdue`); `cart_reminder.test` is `staff`; `company.invite` is `security` (an invitation); a prefix table covers `subscription.*`, `security.*` and `booking.staff_*`.
8. **The export's shape** is `src/lib/privacy-export.ts`: every field is written by name (a whitelist) and `findExcluded()` scans for the keys that must never appear; `returns`, `wishlists`, `carts` and `company` are objects with named lists, the other sections lists; `counts` is one number per section (composite sections summed) and `countsOf()` is what the tests round-trip.
9. **Test harness**: `src/db/vat.test.ts` ("the tax migrations on a database that has data") now applies the migrations *before* the tax ones, then the data, then the tax ones, then the migrations *after* them, as production lived it; it used to apply every other migration first, which a migration that patches what the tax migrations made (the privacy rules) cannot survive. Its assertions are unchanged.
10. **Constants held equal by a source scan**: `SEARCH_LOG_DAYS`, `USAGE_KEEP_DAYS` and `KEEP_DAYS` (integrations) are `server-only` modules, so `retention.test.ts` reads their value from the source text; the lib-side constants (`RETENTION_MONTHS`, `AUDIT_RETENTION_MONTHS`, `EVENT_DAYS`) are imported.
11. **`invoice-retention.ts`** answers from `RETENTION_SEED`; its test now expects Sweden's basis to be `read` (the text of 7 kap. 2 § was read, 1.3) and Denmark's `snippet`.

---

## 11. Server notes: where the built server code differs from the text above (written with the server, 2026-10-04)

The server built section 5.2 and the test files of section 6 that belong to it. Where it differs, the code is right and this list says how:

1. **`sendEmail()` suppression** is logged as a row with status `failed` and the error `suppressed: the order or its person was erased` (address and subject `[removed]`, no bodies), and the call returns the new outcome `"suppressed"`: the `email_status` enum has no `suppressed` and an `ADD VALUE` needs its own migration, so none was added. The row keeps the idempotency key, so a retried webhook asks no more. The evidence kinds (`return.acknowledgement`) and every `privacy.*` kind are never suppressed. `logAddress: false` stores `[removed]` for address and subject.
2. **Restricted orders are not in the export** (2.2 says a restricted order carries `restrictedSince` and `keptUntil`): a restricted order is cut loose from the person (`customer_id` null) and "used for nothing" (2.4), and `resolveSubject()` leaves it out for staff and shopper alike, so the file's `restrictedSince`/`keptUntil` are always null for the orders it holds. What the person asked about after an erasure is answered by the file saying none.
3. **One module resolves the person**: `src/server/privacy-subject.ts` (`resolveSubject()`, `subjectOf()`, `privacyStore()`), re-exported where the spec names it. The shopper's resolution matches orders by email **only when the account's email is proven** (`email_verified_at`), as `claimOrders()` does; staff match by email always.
4. **Shopper entry points** are in `src/server/privacy-shopper.ts` (`shopperPrivacyState`, `shopperExport`, `shopperErasurePlan`, `shopperErase`); the step-up is in `customers.ts` (`startFreshSignIn`, `confirmFreshWithCode`, `confirmFreshWithPassword`, `isSessionFresh`, `sessionVerifiedAt`) and `startSession(storeId, customerId, { verified })` takes `verified: false` for a session that was not proven just now (the one-time sign-in after checkout, which the shopper agent must pass). The staff side is `src/server/privacy-admin.ts` (`privacyCard`, `erasurePreview`, `staffExport`, `staffErase` with the typed confirmation).
5. **`deleteCustomer()`** is now a call to `eraseSubject()` with the shopper as actor; it throws the plain message when Stripe did not answer.
6. **A request is completed only by the run that completes it** (`update ... where status = 'open' returning`), so two runs at once write one audit entry, one confirmation and one owners' notice.
7. **`resumeErasures()`** also retries a profile picture that would not go on an *answered* request (`steps.files = 'left'`), as 2.4 step 4 says ("retried by the daily job"); it never resumes a request whose run did not start.
8. **Retention**: `runRetention(now, { steps, batch })` (the injection is for tests); the orders step takes at most two batches per store per run (a large backlog spreads over days: 5,000 orders took 15 seconds), and `commerce.anonymise_expired_orders()` was changed in its (unapplied) migration to read the candidates in order into a set and ask the due-day function of only as many as the batch holds, with a candidate bound from the store's shortest own period (a store with 15,000 old orders cost 8.5 seconds a day before). Documents use the store's `bookkeeping` cutoff for every order including a host's (the 1b function takes one cutoff); a host's order keeps its longer period.
9. **Analytics identity**: `CUSTOMER_KEY` (`analytics-sql.ts`) gives a restricted or anonymised order the key `order:{id}` (its own anonymous customer; revenue, VAT and refunds unchanged), `HAS_CUSTOMER` counts it, `analytics-totals.ts`'s two key reads follow, and the two guest lookups of `analytics-customers-data.ts` and `analytics-refunds-data.ts` leave restricted orders out. An `order:` key has no account or name, so the top-customers list drops it. This is the analytics agent's 5.5 work in its smallest form; that agent extends the tests.
10. **Readers guarded** with `restricted_at is null and anonymised_at is null`: `customers.ts` (`claimOrders`, `linkOrderToCustomer`, `emailHistory`), `customer-admin.ts` (the list, the detail, the summary, `findCustomer`), `cart-reminders.ts`, `recommend.ts`, `owner-tools.ts` (`email_customer`), `owner-insights.ts`, the booking reminders in `shopper-emails.ts`; `withdrawals.ts` is the one allowed exception (2.7). `restricted-orders.scan.test.ts` holds this.
11. **Existing scan tests updated** with a reason each: `document-readers.test.ts` (the export and the erasure preview read invoices), `field-values-readers.test.ts` (the erasure and the retention schedule delete staff-entered order values; a `PRIVACY` list), and `privacy-erasure.ts` asks `expires_at` of the staff members it warns about (`store-members-expiry.test.ts`).
12. **Tests**: `privacy-export`, `privacy-erasure`, `privacy-shopper`, `privacy-requests`, `privacy-admin` and `retention` `.int.test.ts`; `restricted-orders.scan`, `retention-readers`, `privacy-audit.scan` and the cron route's source test; the euro scenario is inside `checkout-kinds.int.test.ts`'s euro scenarios (each kind of product: export in euro, erasure leaves the sale as it was). The fixture is `src/server/privacy-fixture.ts` (a person with one of every kind of data; `ageOrder()` makes a sale old).

---

## 12. Admin notes: where the built admin code differs from the text above (written with the admin surface, 2026-10-04)

The admin built section 5.4 (`src/app/admin/(gated)/[store]/privacy/…`, `customers/[customerId]/export` and `erase`, `platform/retention`, `src/components/admin/privacy/*`) and the registry entries. Where it differs:

1. **Read key for write-only pages**: `permissions.scan.test.ts` holds a page to its area's *read* key, so `/privacy/new` and the erase page ask `requirePermission(slug, "customers:read")` and then answer 404 when `memberCan(member, "customers:write")` is false. Every action and the export route ask `customers:write` themselves.
2. **A request offers both Download and Erase**, whatever its kind (2.3 item 4 lists both); the button for the request's own kind is the primary one. Downloading completes only an open *export* request; erasing completes the erasure request it was opened from (`?request=`).
3. **Order privacy state** is read by `orderPrivacy()` in `src/server/privacy-pages.ts` (a new file of the admin surface, with `requestSubject()`), not added to `OrderView`, so the many places that build an `OrderView` are untouched.
4. **The platform retention page marks a period "set in code"** when the row's note says the code's constant is the source (`search_queries`, `visits`, `audit_log`, `form_submissions`, `integration_deliveries`, `abandoned_checkouts`, `recommendation_events`, `ai_usage`): a new row there records the decision but does not change what is removed, and the page says so beside the row and above the form. Only the kinds read through `retentionRule()` change behaviour.
5. **Not built here**: the control-center attention item and the owner tools (5.5, the analytics and AI surface); the shopper pages (5.3); an e2e spec (admin pages behind sign-in are checked by hand, as `e2e/a11y.spec.ts` says).
6. **Tests**: `src/components/admin/privacy/*.test.ts` (`renderToString` for every view and form, the admin-token scan), `src/lib/privacy-admin.test.ts`, `src/server/privacy-pages.int.test.ts`; the nav, admin-map and permission scan tests pass with the new entries.

## 13. Review fixes: where the code differs from the text above (written with the review fixes, 2026-10-04)

1. **The shopper's own file and deletion act on addresses the shopper has proved, nothing else** (`resolveSubject(..., { channel: "shopper" })`, `privacy-subject.ts`). `addresses` is the account's own email when `email_verified_at` is set, otherwise empty; the emails typed on an order (Stripe's form, a venue booking) and an unproven account's registration address prove nothing. Every read and delete keyed by an address (email log and bodies, form sign-ups, abandoned checkouts, opt-outs, sign-in codes, company invitations) therefore finds nothing for an unproven account, which is shown and erases only what is linked to the account itself (its orders, subscriptions, carts, lists). Staff, who answer for the person's identity, keep the wide match (the account's email and the emails of the person's orders and subscriptions). Orders matched by email for the shopper still need a proven account (unchanged).
2. **An order still waiting for payment is cancelled, not anonymised and left open** (`eraseSubject()`). Outside the database transaction `closeOpenCheckouts()` expires the open Stripe Checkout session of each such order (`closeSession()` of `checkout.ts`, as `startCheckout()` does); a session paid in the meantime completes its order (`completeOrderPayment()`), which erasure then restricts as the sale it is, and a payment the shopper finished that has not arrived stops the erasure before anything changes (`problem: "stripe"`, retried). Inside the transaction each remaining `pending_payment` order goes through `commerce.cancel_unpaid_order()` (stock released), its pending payment is marked `cancelled`, a subscription that never started is `expired`, and only then `anonymise_order()` runs. A payment that still arrives (a race with Stripe) finds a cancelled order, which `complete_order_payment()` completes without the person's data, because `saveCustomer()` and staff's `updateOrderContact()` leave an order with `anonymised_at` alone (the check `orders_anonymised` would otherwise refuse the write and the webhook would fail for ever). The staff plan says so (`alsoHappens.ordersCancelled`; `openOrders` counts only paid orders, which continue restricted) and `EraseCounts` has `ordersCancelled`.
3. **Free text staff typed is personal data too**: `refunds.reason` and the `reason` and `note` keys of `order_events.data` (a cancellation's or refund's reason, a note) are in the export and are removed when the order is anonymised: `anonymise_order()` replaces a refund's reason with `[removed]` (the two reasons the Stripe webhook writes are system text and stay, because `refundKey()` reads them) and removes the two keys from the order's events. `forbid_change()` (the shared append-only trigger) is patched in the same migration to let `order_events` change in exactly that one way and only inside the anonymising path (`commerce.anonymising = 'on'`); every other change and every delete is refused as before.
4. **The shopper's download is limited**: five files per account per hour (`EXPORTS_PER_HOUR`, `takeExportSlot()` in `privacy-shopper.ts`, a keyed hash of the account in `chat_usage`, kept two days). The sixth gets `problem: "busy"` (the page says so in nb, sv, da, en: `tooMany`) and nothing is read or logged for it.
5. **The register's detector A** also matches `*_name` columns (except `NOT_A_PERSON_NAME`, now `file_name`), `postal_code`, `postcode`, `zip`, `zip_code` and birth-date columns; the PGlite test has a `*_name`-only table, a postal-code-only table and a `file_name` table.
6. **Texts**: the Norwegian texts name `bokføringsloven` (not `regnskapsloven`) as the ground for keeping orders; a Danish or Swedish store viewed in nb still names the Norwegian act (the text is chosen by language, not by the seller's country: left for the legal review). The staff clock sentence no longer states that a weekend or holiday never moves the month: it says what the system counts and sends the rule (Regulation 1182/71, unread) to a lawyer. Both stay on the legal-review list.



### Merge note: OSS and IOSS stores (D161 and D162)

The records of a store that uses the OSS or IOSS schemes are kept ten years (D161). `runRetention()`'s documents step honours that (`SCHEME_RETENTION_YEARS`, a store with `store_tax_profile.oss_scheme <> 'none'` or an IOSS number). The orders step, `commerce.anonymise_expired_orders()`, still uses the seller country's period (NO 5, SE 7, DK 5, DE 8 years), so an order's name, address and email of such a store go sooner than its documents' personal data. Whether the scheme's record duty reaches the buyer's personal data on the order is a question for the accountant; if it does, the scheme period moves into `order_anonymisable_on()` (a new migration).
