# Tripletex: keeping a Norwegian store's books in step with Kaizen (design proposal)

Adding **Tripletex** (Norwegian accounting, API v2) as an integration, so a store
owner such as **Human Web** (a Norwegian consultancy invoicing through Work) has
Tripletex's ledger follow the store. This is a design document for the people who
build it. It contains no application code and changes no other file.

Status: proposal, written 2026-09-29. Nothing is built. `src/lib/integrations.ts`
already lists Tripletex as "coming soon", and `docs/work.md` 4.5 point 8 promised
"a Tripletex integration later".

Reading guide. Evidence is marked so nobody builds on a guess:

* **[spec]** read in Tripletex's official OpenAPI file, version 2.75.12
  (`https://tripletex.no/v2/openapi.json`, downloaded 2026-09-29).
* **[docs]** read on `developer.tripletex.no`, in Tripletex's GitHub repository
  (`Tripletex/tripletex-api2`: README, `changelog.md`) or on `tripletex.no`, 2026-09-29.
* **[3P]** a third-party page; treat as a hint.
* **[repo]** read in this repository.
* **[U]** *not verified.* Needs a sandbox test (Appendix A) or a question to Tripletex or the
  accountant. Anything marked [U] is a risk until then.

Sources are listed in Appendix B.

## 0. Summary

1. **Recommended first slice (T1, about 19 working days for one engineer):** one-way
   push from Work to Tripletex for **NOK invoices and credit notes**, as **ledger
   vouchers** that debit the customer's receivable and credit income and VAT, with
   the customer created in Tripletex on demand. Configured by the owner at
   `/admin/{store}/integrations/tripletex` with an API token from Tripletex and a
   mapping of VAT codes and accounts. Idempotent, retried by the five-minute job,
   with "Sync again" per object. No payments read back yet.
2. **Slice 2 (about 5 days):** payments recorded in Tripletex become payments on the Work
   invoice (polling), plus the invoice PDF attached to each voucher.
3. **Source of truth:** **Work is the legal invoice.** Its gap-free number (`W-1042`) is the
   only number the customer sees. Tripletex holds the accounting entry and carries
   Work's number as its external voucher number and as the invoice number on the
   receivable posting. Tripletex's own invoice numbers are never used (section 3.1).
4. **Why vouchers and not Tripletex invoices:** the Tripletex API has no external id on
   customers, orders or invoices, its invoice module assigns its own numbers and by
   default emails the customer, and its credit note call cancels a whole invoice only.
   A voucher has an `externalVoucherNumber` with a lookup endpoint, so retries can never
   double-book. A decision gate (spike S0, section 3.1) confirms this in a sandbox
   before the sync engine is built.
5. **Credentials:** for Human Web, nobody applies for anything. Tripletex lets a company
   generate its **own API token (JWT)** under *Company > API tokens* for a single-company
   integration [docs]. The owner pastes it into Kaizen; Kaizen keeps it encrypted and
   exchanges it for short-lived session tokens. A Kaizen-wide **consumer token** (2 to 3
   weeks to approve [docs]) is needed only if Kaizen offers Tripletex to many stores;
   apply for it before opening the integration beyond Human Web.
6. **Where the connection lives:** the store's Integrations page, owner-only. Work shows a
   status card and a per-invoice panel that link to it (section 6.2).
7. **Level 2 (webshop orders as daily summary vouchers, with VAT split) and level 3
   (products, stock)** are later; L3 is recommended never (section 2.2).
8. **What can hurt:** double-booking (prevented by external numbers and lookup before
   retry), booking into a closed accounting period (blocked with a message, never
   silently redated), a wrong VAT code (owner-confirmed mapping, accountant sign-off), and
   an invoice with no PDF attached (a go-live gate).
9. **Open questions the owner must answer** are in section 10; the ones that decide the
   build are: which Tripletex company and who generates its token, whether the accountant
   accepts vouchers with a customer ledger posting instead of Tripletex invoices, the
   income and VAT accounts, the VAT code for services to foreign businesses, and the start
   date.
10. **Effort:** L1 complete (push, payments, PDF, AI tools) about 25 days; L2 (order
    summaries, Stripe fees) about 9 more, and webhooks, foreign currency and reconcile
    about 4.5. Work packages TP0 to TP14 in section 9.

## 1. What Tripletex offers (research)

### 1.1 Access, environments, limits

| Fact | Evidence |
|---|---|
| Base URL production `https://tripletex.no/v2`; test `https://api-test.tripletex.tech/v2`. Tokens do not work across the two. Test tokens are prefixed `test-`. The old `api.tripletex.io` test host is gone. | [spec] servers; [docs] auth page, changelog 2.71.19 and its `test-` entry |
| Test accounts are self-service (a form), expire after 6 months (extendable), contain no data, and **send no emails** from the test environment. | [docs] getting-started/1 |
| Three token kinds: **consumerToken** (given to an integrator after approval), **employeeToken** (made by a user admin in the Tripletex GUI, given entitlements), **sessionToken** (from `/token/session/:create`). | [spec] intro |
| Session token: `POST /token/session/:create` with a JSON body `{consumerToken, employeeToken, expirationDate}`. The `PUT` form with query parameters is marked **legacy** ("use POST", tokens in the URL are worse). Older articles say PUT; the spec supersedes them. The token expires at midnight CET on the given date. | [spec]; [docs] auth page |
| Basic auth: username `0` (or blank) = the company of the employee token's owner; any other value = an accountant's client company id (found with `GET /company/>withLoginAccess`); password = the session token. | [spec] intro; [docs] auth page |
| **Single-company integrations need no consumer token.** A user admin creates an **API token (JWT)** in Tripletex under *Company > API tokens* (needs the **Integrations** module active); the JWT is shown once and is exchanged with `POST /token/session/:createFromRefreshToken` `{refreshToken, ttlSeconds}`; the session token then lives 300 to 28 800 seconds. A lost JWT is deleted and replaced. Refresh tokens carry a `tlxr_` prefix. | [docs] auth page ("Internal integrations"); [spec] (TTL and prefix) |
| **Commercial or multi-tenant integrations** (offered to several customers) must apply for a consumer token by form; approval "2 to 3 weeks", no fast track. Customers then enter the application name when creating an employee token. Integration Marketplace listing is a separate thing and needs a live integration. | [docs] getting-started/3, faq, marketplace |
| Rate limit: per employee, per API consumer. Headers `X-Rate-Limit-Limit`, `X-Rate-Limit-Remaining`, `X-Rate-Limit-Reset` (seconds left); when hit, every call returns **429** until the period ends. **The numbers are not published.** | [spec] intro; numbers [U] |
| Result sets are capped at 10 000 objects ("Result set too large"); page with `from` and `count`; use `fields` to shrink answers; `version` on every persisted resource gives optimistic locking (a PUT with a stale version fails with 409 code 8000). Every response carries `x-tlx-request-id` for support. | [spec]; [docs] faq/general |
| Errors: JSON envelope with `status`, `code`, `message`, `developerMessage`, `validationMessages[{field,message}]`, `requestId`. 409 covers revision, duplicate (14000) and state conflicts. | [spec] |
| Some endpoints exist only in some Tripletex packages; the cost of the Integrations module and which package API access needs is not stated. | [spec] intro; cost [U] |

### 1.2 The objects we would use

| Purpose | Endpoint (all [spec] unless said) | Notes |
|---|---|---|
| Who am I, which company | `GET /token/session/>whoAmI` | Returns `company` with `id`, `name`, `organizationNumber`: lets us check the token belongs to the store's own company. |
| Customers | `GET/POST /customer`, `PUT /customer/{id}` | Fields: `name`, `organizationNumber`, `customerNumber`, `email`, `invoiceEmail`, `postalAddress`, `physicalAddress`, `language` (`NO` or `EN`), `isPrivateIndividual`, `invoiceSendMethod` (`EMAIL`, `EHF`, `PAPER`, `MANUAL`, ...), `invoicesDueIn`, `currency`, `isInactive`. Search by `organizationNumber`, `email`, `customerName`, `changedSince`. **No `externalId`, and no VAT-number field.** |
| Ledger vouchers | `POST /ledger/voucher`, `GET /ledger/voucher/{id}`, `PUT /ledger/voucher/{id}/:reverse?date=`, `GET /ledger/voucher/>externalVoucherNumber` | "Also creates postings. Only the gross amounts will be used. Amounts should be rounded to 2 decimals." `externalVoucherNumber` is text up to 70 characters (added 2022). `sendToLedger` defaults to true. `convertFromAmountGrossCurrency` (new 2026-09-28) converts foreign amounts. |
| Postings | inside a voucher: `account`, `customer`, `vatType`, `amountGross`, `amountGrossCurrency`, `currency`, `invoiceNumber`, `description`, `row`, `date` | A posting on a customer-ledger account **must** name the customer [docs] faq/ledger-voucher. Read: `GET /ledger/posting`, `GET /ledger/posting/openPost` (open receivables), each posting has `closeGroup`, `matched`, `type` (`INCOMING_PAYMENT`, ...). |
| VAT codes, accounts | `GET /ledger/vatType`, `GET /ledger/account`, `GET /ledger/vatSettings`, `GET /ledger/voucherType`, `GET /ledger/accountingPeriod` | An account has `legalVatTypes`, `vatLocked`, `ledgerType`, `isInactive`. Ids differ per company; **VAT codes and accounts are addressed by number and resolved to ids at run time.** |
| Attachments | `POST /ledger/voucher/{voucherId}/attachment` (multipart `file`: PDF, PNG, JPEG, TIFF; a second upload appends pages) | The bookkeeping document ("bilag"). |
| Invoices (not used in the recommendation) | `POST /order`, `PUT /order/{id}/:invoice`, `POST /invoice`, `PUT /invoice/{id}/:payment`, `PUT /invoice/{id}/:createCreditNote`, `GET /invoice/{id}/pdf`, `GET /invoice?status=OUTSTANDING\|CLOSED` | `Invoice.invoiceNumber`: "If value is set to 0, the invoice number will be generated" (whether another value is accepted is [U]). No `externalId`. Tripletex **sends created invoices by default** unless `sendToCustomer=false` [docs] faq/invoice-order. `:createCreditNote` "nullifies the given invoice": whole invoices only. `amountOutstanding` = 0 means paid or credited. |
| Payments and bank | `GET /bank/statement/transaction`, `/bank/reconciliation/...` | Matching bank lines to postings happens inside Tripletex. |
| Webhooks (beta) | `POST /event/subscription`, `GET /event` (list of event keys) | Events are created per verb (`product.create`, `order.delete`, ...). Payloads are retried with exponential backoff over 30 hours; a subscription is disabled after a week of failures (status `DISABLED_TOO_MANY_ERRORS`, re-enabled by `PUT`). HMAC-SHA512 signing exists (header `x-request-signature`). `closeGroup.create` and `.delete` fire when postings are matched or reopened, **including automatic OCR matching of incoming payments**. Tripletex itself recommends a nightly bulk sync as well, "as rapid successive modifications might skip webhook versions". The full event list needs an authenticated `GET /event` and is **[U]**; the README says the list "is currently limited to a select few". |

### 1.3 Norwegian VAT codes for sales (Tripletex "mva-koder")

From Tripletex's own code list [docs, `tripletex.no/fagblogg/regnskap/mva-koder-et-oppslagsverk/`]:

| Code | Name (Tripletex) | Rate | Use for Work |
|---|---|---|---|
| **3** | Utgående avgift, høy sats | 25 % | `standard` at the store's 25 % rate |
| 31 | Utgående avgift, middels sats | 15 % | not offered by Work today |
| 33 | Utgående avgift, lav sats | 12 % | not offered by Work today |
| **5** | Ingen beregning av utgående avgift (innenfor mva-loven) | 0 % | `exempt` (accountant to confirm [U]) |
| **6** | Ingen beregning av utgående avgift (utenfor mva-loven) | 0 % | `outside_scope`; also the likely code for services sold to foreign businesses [U] |
| 52 | Avgiftsfri utførsel av varer og tjenester | 0 % | alternative for services sold abroad; **which of 6 or 52 applies is an accountant decision [U]** |
| 51 | Avgiftsfri innenlands omsetning med omvendt avgiftsplikt | 0 % | gold and climate quotas, not our case |
| 7 | Ingen avgiftsbehandling (inntekter) | none | not VAT related income |

Work's `reverse_charge` (an EU business buying from an EU seller) has no matching
Norwegian *sales* code in that list; a Norwegian seller's foreign B2B services are
outside Norwegian VAT. So the default map sends `reverse_charge` to code 6 and the
wizard asks the accountant to confirm or change it. Tripletex's default chart of
accounts (NS 4102: 1500 receivables, 3000 taxable sales income, 3100 exempt, 3200
outside the VAT area, 2700 output VAT high rate) is a well known convention but is
**[U]** for a given company: the wizard reads the company's real accounts.

### 1.4 What is missing from the API that shapes the design

* **No external id** on customers, orders or invoices (only `externalVoucherNumber` on
  vouchers). Identity of a customer is by organisation number or by our own mapping table.
* **Invoice numbers are Tripletex's own** unless an external number is accepted [U].
* **No partial credit notes** through `:createCreditNote`.
* **Rate limit numbers, entitlement names, Integrations module price, hosting region,
  and the webhook event list** are unpublished or behind login: all [U].

## 2. Recommendation and scope

### 2.1 What syncs, at three levels

Direction `→ T` = Kaizen writes to Tripletex; `← T` = Kaizen reads from Tripletex.

**L1: Work and the books (build now; Human Web's need).**

| # | What | Direction | Trigger and rule |
|---|---|---|---|
| L1.1 | Work client → Tripletex **customer** | → T | Created **on demand** when the client's first invoice is synced (never all clients up front: least personal data). Found first by organisation number, then linked; never matched by name alone. Later edits pushed only if a field we own changed. Nothing is read back. |
| L1.2 | Issued Work **invoice** → **voucher** | → T | Every invoice with `status <> 'draft'` and `issued_on >= sync_from`. One voucher per invoice, dated the invoice's `issued_on`. NOK only in T1. |
| L1.3 | Work **credit note** → **voucher** (reversal, partial or full) | → T | After its invoice's voucher exists. The credit note's own number is the external number. |
| L1.4 | **Payments** recorded in Tripletex → `work_invoice_payments` | ← T | Polled in the five-minute job (webhooks are beta and their event list is unverified). Opt-in switch. Slice 2. |
| L1.5 | Invoice **PDF** → voucher attachment | → T | Slice 2; needs a server PDF (work.md 4.7 "W5"). Go-live gate for real books. |
| L1.6 | Foreign-currency invoices, VAT in NOK | → T | Later (TP14). T1 marks them `blocked: currency_unsupported`, visibly. |
| L1.7 | Work assignments → Tripletex projects | → T | Not planned; open question 4. |
| L1.8 | Time entries | none | Never: Tripletex has its own time sheets and Work is the master of hours. |

**L2: webshop sales (later; needs the owner to want it, TP11 to TP12).**

| # | What | Direction | Rule |
|---|---|---|---|
| L2.1 | Paid **orders** → one **summary voucher** per store, market, currency and day (store time zone) | → T | Debit the payment clearing account, credit income per VAT code, output VAT, shipping income at the standard rate. No per-shopper customers in Tripletex. Vouchers are append-only: a refund of yesterday's order goes into today's voucher. |
| L2.2 | **Refunds** (`refunds`, `order.refunded`) | → T | Negative lines in the day's voucher. |
| L2.3 | Stripe **fees and payouts** | → T | Needs new Stripe reads (balance transactions, payouts): the repository has none today [repo]. Kaizen's own sale fee (`payments.kaizen_fee_minor`) is known. Later still. |
| L2.4 | EU sales, VOEC and OSS VAT | none at first | Only the Norwegian market in NOK is booked automatically; other markets go to a "to be booked" account with a note, until the accountant defines the VAT treatment [U]. |

**L3: products and stock.** Recommended **never**. The books need totals per VAT code, not
SKUs, and Kaizen is the stock master. Revisit only if a store uses Tripletex's own
inventory module (`/product/logisticsSettings`, package dependent [U]).

### 2.2 The first slice, and why

**T1 = L1.1 + L1.2 + L1.3** (push only) with the connection wizard, mapping, status UI,
retries, alerts and audit. **T2 = L1.4 + L1.5.** Reasons:

* Push is where the value is (the accountant no longer types invoices), and every write
  is idempotent and reviewable.
* Pull carries the double-payment risk (a payment entered in Work and again in Tripletex)
  and depends on how Tripletex shows payments against a voucher-based receivable, which
  sandbox spike S0 must first show.
* T1 needs no PDF service; T2 does.
* Human Web's own invoicing can run on T1 the day it works, with the accountant
  attaching or receiving PDFs from Work's existing CSV and hosted page meanwhile
  (open question 3).

## 3. Source of truth, numbering, idempotency, failure

### 3.1 Numbering: Work is the legal invoice

Work numbers invoices gap-free at issue (`commerce.issue_work_invoice()`, series
`work_invoice`, work.md 4.4) and prints, emails and hosts them. Tripletex's invoice module
numbers its own invoices in its own sequence, and Norwegian rules want one
unique running number per invoice.

**Decision (recommended default): Work's number is the invoice number. Tripletex holds an
accounting entry that quotes it.** Concretely:

* Voucher `externalVoucherNumber` = `kaizen/{store8}/{documentNumber}` (for example
  `kaizen/1a2b3c4d/W-1042`; at most 70 characters; `store8` = the first eight hex digits of
  the store id, so two stores in one Tripletex company never collide).
* The receivable posting's `invoiceNumber` = `W-1042` and its description starts with it.
* The Tripletex voucher id and its printed number are stored in `tripletex_sync`
  (section 5), **not on `work_invoices`**: an issued invoice is immutable, only `status`,
  `paid_at`, `sent_to`, `public_token` may change (a trigger, work.md 4.2a), and adding
  external ids there would mean loosening a legal record. The invoice page shows "Tripletex
  voucher 2026/145" from the side table.
* The customer never receives a Tripletex document, and Tripletex sends nothing (no invoice
  exists in it).

| | **V: vouchers** (recommended) | **I: Tripletex invoices** (fallback) |
|---|---|---|
| Customer-facing number | Work's only | two numbers for one invoice, unless `invoiceNumber` may be set [U] |
| Risk of Tripletex emailing the customer | none (no invoice) | on by default; must pass `sendToCustomer=false` on every call |
| Idempotency | `externalVoucherNumber` + lookup endpoint [spec] | none: no external id; needs our own mapping and a search on `comment` or `reference` |
| Partial credit note | a second voucher with the credited lines | whole-invoice only via `:createCreditNote`; partial needs a credit order |
| Prerequisites in the company | Integrations module, voucher entitlement | invoice module, bank account "ready", organisation number [spec `InvoiceSettings`] |
| Payment matching in Tripletex | postings on the customer ledger, matched by hand or by rules; automatic KID/OCR matching is built for Tripletex's own invoices [U] | native (`amountOutstanding`, `:payment`, OCR) |
| Reading payments back | posting and close-group reads [U] | `GET /invoice ... amountOutstanding` [spec], simple |
| Accountant familiarity | good (journal entries), less invoice tooling | best |

**Spike S0 (TP0, one day, before TP4) decides.** Build V unless the sandbox shows that
(a) Tripletex accepts a chosen `invoiceNumber` on `POST /invoice`, **and** (b) the owner
wants Tripletex to run reminders, KID and payment matching. Then switch to I, with Work's
number as Tripletex's invoice number, and everything else here (tables, states, cron,
UI) stays. If (a) is false, I is out: two numbers is a compliance problem.

Who issues the legal number is open question 2. If the owner decides **Tripletex** must
issue invoices, Work's issue step and series stop being the legal source; that is a large
change to Work (its `issue_work_invoice()` and the immutable snapshot) and is out of scope
here.

### 3.2 Idempotency: never double-book

Layers, from the database outward:

1. **One sync row per object** (`tripletex_sync` primary key: store, mode, company, kind,
   local id). A second sweep finds the row and does nothing.
2. **Claim before sending**: `state = 'sending'` and `claimed_until = now() + 5 min`, taken
   with `for update skip locked` outside any transaction that spans the HTTP call (as
   `deliverDue()` does, `src/server/integrations.ts`). Two runs never send the same row.
3. **External number as the key.** Before every `POST /ledger/voucher` for a row that has
   ever been attempted (`attempts > 0`, or an expired claim), call
   `GET /ledger/voucher/>externalVoucherNumber?externalVoucherNumber=...`. A hit means the
   previous run succeeded but its answer was lost: **adopt it** (record its id, verify its
   date and gross total against ours) and never post again. A first attempt may skip the
   lookup to save a call.
4. **Write the result in one statement**: `their_id`, `their_ref`, `state = 'synced'`,
   `synced_at`, together with a `work_events` row. A crash between the POST and this write is
   the case layer 3 heals.
5. **Customers**: find by `organizationNumber` (exact), else create; the created id is
   recorded at once. A duplicate answer (409 code 14000) triggers the same search.
6. **Payments in** (T2): `work_invoice_payments.provider_reference` is unique per store
   (index `work_invoice_payments_provider_idx`, `where provider_reference is not null`
   [repo]); Tripletex payments use `tripletex:{companyId}:{closeGroupId}:{postingId}`.
7. **Never `PUT` or delete a voucher.** Corrections are new vouchers (credit note, or
   `:reverse`). This matches bookkeeping practice and removes update races.

### 3.3 Failure classes and retry

| Outcome | Class | Action |
|---|---|---|
| Network error, timeout (10 s), 5xx | transient | retry after 1, 5, 30 minutes, 2 and 6 hours (D41's ladder), then `failed`; after that one automatic try per day for 14 days; then `blocked`. |
| 429 | rate limit | wait `X-Rate-Limit-Reset` seconds (capped at 15 minutes); does not count as an attempt; the store's run stops for now. |
| 401 | credential | connection `auth_failed`: **all** syncing for the store pauses, owner alerted (section 6.6). Cleared by pasting a new token. |
| 403 | permission | `blocked: no_permission` with Tripletex's message; the owner grants the entitlement, then Retry. |
| 404 on something we hold an id for (a voucher or customer deleted in Tripletex) | drift | `drifted`: **not recreated automatically**; the invoice panel offers "Post again" (new voucher, external number suffix `#2`) or "Ignore". |
| 409 revision (8000) on a customer PUT | conflict | re-read the customer and retry once, else `failed`. |
| 409 duplicate (14000) | conflict | look up and adopt (layer 3 or 5). |
| 409 state/locked (25000, 10000) or 422 validation, for example a closed accounting period, an inactive account, a VAT code the account does not allow (`legalVatTypes`), a missing customer on a ledger account | rule | `blocked` with the mapped message and the request id (`x-tlx-request-id`). **Never redates a voucher** to get around a closed period. The owner fixes the cause and presses Retry. |
| Work-side problem (foreign currency, unmapped VAT category, client missing organisation number where Tripletex needs one) | our rule | `blocked: <code>` before any call. |

States: `pending → sending → synced`; `failed` (automatic retries continue), `blocked`
(needs a person), `drifted`, `skipped` (before `sync_from`, or the owner chose to ignore).
Every state change is one row update; the last error text is stored **without** tokens or
personal data (a filter test guards it).

### 3.4 The four situations asked about

* **Invoice credited.** The credit note row (`work_credit_notes`) becomes its own sync row
  (`kind 'credit_note'`) and its own voucher, external number
  `kaizen/{store8}/WCN-3`, description "Kreditnota WCN-3 for W-1042", posting
  `invoiceNumber = W-1042` so the accountant can match it against the receivable. It waits
  until the invoice's voucher is `synced` (a dependency check in the sweep). Partial credits
  use the credited lines from `work_credit_notes.lines` [repo]. The original voucher is never touched.
* **Client changed.** The client's `updated_at` moves; the sweep compares it to
  `tripletex_sync.source_updated_at`, builds the customer payload, hashes it and only calls
  `PUT /customer/{id}` (with the stored `version`) when the hash differs. Fields we own:
  name, organisation number, address, country, business/private, language, payment days,
  currency. Edits made in Tripletex to those fields are overwritten by the next Work change
  (stated on the settings page). Vouchers already posted are unaffected: they point at the
  customer id.
* **Payment or refund in Tripletex** (T2). See 4.5.
* **Manual "Sync again".** On an invoice or credit note: `failed`, `blocked`, `drifted` →
  `pending` with attempts reset (an owner or admin action, audited, `send` gate for the AI
  manager). On a `synced` object: **Check in Tripletex**, a read-only comparison
  (voucher exists, date, gross total, VAT total) that reports drift and changes nothing.
  Store-wide: *Retry all failed*, and *Reconcile period* (Work's issued documents against
  vouchers found by external number; result as a table and CSV for the accountant; T3).

## 4. Mapping details

### 4.1 Customer (Work client → Tripletex customer)

| Tripletex field | From | Rule |
|---|---|---|
| `name` | `legal_name`, else `name` | as printed on invoices |
| `organizationNumber` | `organisation_number` | digits only; for a foreign client with only a VAT number, leave empty and write the VAT number in `description` (no VAT-number field exists [spec]); Tripletex's validation of foreign numbers is [U] |
| `isPrivateIndividual` | `not business` | a consumer client sends **name and country only** |
| `postalAddress` | `billing_address`, `country` (looked up once through `GET /country`) | omitted for consumers unless the owner ticks it |
| `language` | client `locale` | `nb*` → `NO`, all else `EN` |
| `invoicesDueIn` (`DAYS`) | payment days | |
| `currency` | client currency | NOK only in T1 |
| `email`, `invoiceEmail`, `phoneNumber` | **not sent by default**; an owner switch "send contact email" adds `email` | minimal data |
| `invoiceSendMethod` | `MANUAL` | so nothing can be sent by Tripletex on a stray invoice [U on the exact meaning] |

### 4.2 Invoice → voucher

One voucher: `date` = `issued_on` (the store-time-zone date, Work's own), `description` =
"Faktura W-1042 · {client name}", `externalVoucherNumber` as in 3.1, `voucherType` chosen
in the wizard (a Tripletex voucher type for outgoing invoices; its name is [U]), and
these postings, all gross amounts with two decimals, minor units converted exactly (no
floats; the same BigInt style as `src/lib/work-calc.ts`):

| Posting | Account | Customer | VAT code | Amount |
|---|---|---|---|---|
| receivable | the receivable account (default 1500 [U]) | the customer | none | **+ total incl. VAT** |
| one per invoice line | the income account for the line's VAT bucket | none | mapped code | **− the line's `incl_minor`** |

Example (Acme AS, invoice W-1042, 10.00 hours at 1 200.00 excl., 25 %):

```
voucher  date 2026-09-29  description "Faktura W-1042 · Acme AS"
         externalVoucherNumber "kaizen/1a2b3c4d/W-1042"
  row 1  account 1500  customer {Acme}  invoiceNumber "W-1042"   amountGross  15000.00
  row 2  account 3000  vatType {number 3}  description "W-1042 Consulting 10 h"  amountGross -15000.00
         (Tripletex adds the 3 000.00 output VAT posting itself: [spec] "Also creates postings")
```

**One posting per line, not one per VAT code**, so Tripletex's VAT (derived from each gross
amount by rate) reproduces Work's per-line rounded VAT. Checked by brute force for this
design: for every line net amount from 0.00 to 2 000.00 at 25 %, 15 % and 12 %, with
Work's half-up rounding, `round_half_up(incl × rate ÷ (1 + rate))` equals Work's
`vat_minor` with **zero** mismatches. Tripletex's own rounding is [U], so after every
POST the sync reads the voucher back and compares its VAT total with `vat_minor`; a
difference is recorded as `synced` with `variance_minor` and shown, never a failure.

Description texts are hand-written Norwegian (`nb`), setting `English` available, clipped
to 100 characters (Tripletex's limit is [U]); never time-entry notes, never the hosted-link
token.

### 4.3 Credit note → voucher

Same shape with opposite signs: the receivable credited, income and VAT debited, with the
credited lines only. `description` "Kreditnota WCN-3 for W-1042".

### 4.4 VAT and accounts: the mapping the owner confirms

Work line `vat_category` (`standard`, `exempt`, `reverse_charge`, `outside_scope`) and its
frozen `vat_rate` map to a Tripletex VAT code **number** and an income account **number**
(both resolved to ids per company at run time):

| Work | Rate | Default VAT code | Default income account |
|---|---|---|---|
| `standard` | 0.2500 | 3 | 3000 taxable sales [U] |
| `standard` | 0.1500 / 0.1200 | 31 / 33 | 3000 [U] (Work does not offer these categories yet) |
| `exempt` | 0 | 5 | 3100 [U] |
| `outside_scope` | 0 | 6 | 3200 [U] |
| `reverse_charge` | 0 | 6 (accountant may choose 52) | 3200 [U] |
| store **not** VAT registered (`work_settings.vat_registered = false`) | 0 | none needed; the wizard compares with `GET /ledger/vatSettings` and refuses a mismatch | 3000 |

The wizard checks each choice against the real company: account exists, active,
`legalVatTypes` contains the code (or `vatLocked` matches), receivable account has a
customer ledger type. An unmapped combination blocks the object with a stable code
(`vat_unmapped`); nothing guesses. Every default above is a suggestion that the owner
and accountant sign; none is legal advice, as work.md 4.5 says for Work's own VAT.

### 4.5 Payments back (T2)

Opt-in (`settings.payments.pull`). Once per five-minute run, only for stores with a
synced invoice that Work still shows as outstanding:

1. Read the customer's postings since the invoice date (`GET /ledger/posting` with
   `customerId`, the receivable account and a date window; or `openPost`), looking for
   postings of type `INCOMING_PAYMENT` that share a close group with our receivable posting.
   The exact shape is spike-dependent [U].
2. For each new payment: insert into `work_invoice_payments` with `method 'bank'`,
   `received_on` = the payment posting's date, `reference` "Tripletex {voucher no.}",
   `provider_reference` = `tripletex:{companyId}:{closeGroupId}:{postingId}`, through a new
   `recordExternalPayment()` next to `recordPayment()` in `src/server/work-invoices.ts` (the
   existing one takes no `provider_reference`, and refuses more than the outstanding amount:
   a Tripletex payment that would overpay is `blocked: overpaid` for a person to look at). The
   database sets `paid` and writes `payment.recorded` and `invoice.paid`, and queues
   `work_invoice.paid` for Zapier and Slack as it does today.
3. A payment **reopened** in Tripletex (`closeGroup.delete`, or the posting is open again
   at the next read): `reversePayment()` adds the reversing row; the invoice returns to
   `sent` by the database's own rule.
4. **A payment already recorded by hand in Work** for the same amount within three days is
   linked, not doubled: the sync row for that payment gets the Tripletex id and no new row
   is inserted. When the switch is on, Work's Record payment screen says payments normally
   come from Tripletex.
5. Webhooks (`closeGroup.create`, HMAC-signed, [docs]) are a later latency improvement
   (TP13); the poll stays as the safety net, as Tripletex itself advises.

### 4.6 Currency, dates, attachments

* **Currency.** T1 books NOK invoices only. Later: `POST /ledger/voucher?convertFromAmountGrossCurrency=true`
  with `amountGrossCurrency` and the currency id (`GET /currency`), added by Tripletex on
  2026-09-28 [docs changelog 2.75.12]. Work freezes an ECB rate for the VAT-in-NOK figure
  (`fx_rate`, `vat_home_minor`); Tripletex uses its own (Norges Bank) rates, so the two can
  differ by a small amount, which the accountant must accept [U].
* **Dates** are the store's time zone dates, sent as `yyyy-MM-dd`. The wizard reads
  `GET /ledger/accountingPeriod`; a voucher date in a closed period is `blocked`.
* **PDF.** Work has no server PDF today (work.md 4.7). T2 attaches the PDF of the frozen
  document to the voucher (`POST .../attachment`, one call). It needs the "W5" server PDF
  route (Chromium is already installed for the cookie scan, but only
  `cookie-scan-runner.ts` may import it); until then attaching is **off** and the accountant
  receives PDFs by Work's existing email and hosted page. This is a **go-live gate** for real
  books (open question 3).

## 5. Data model

Conventions [repo, work.md 4.1]: schema `commerce` (private, not exposed by Supabase's
Data API), row-level security **on with no policies**, `store_id uuid not null references
stores(id)` on every table, every query takes the store id, Drizzle in `src/db/schema.ts`
plus a custom rules migration (`pnpm exec drizzle-kit generate --custom --name tripletex_rules`),
`src/db/commerce.test.ts` for each rule, migrations applied to production and recorded in
`docs/decisions.md` (Migration versions). Money in integer minor units.

### 5.1 `store_integrations`: registration only

Provider `tripletex` gets a row in the existing table so the Integrations list, its
status badge, `listIntegrations()`, the control center's "sends failed" line and the AI
manager's `list_integrations` all work unchanged: `enabled`, `webhook_hint` = "Human Web AS
· live", `events = '{}'`, `webhook_url_encrypted = ''`, `updated_by`. The migration widens
`store_integrations_provider` to `('zapier','make','slack','tripletex')` (as the Slack
migration did). `queue_integration_event()` will not queue anything for it (empty events),
and `deliverDue()` never sees it.

### 5.2 `commerce.tripletex_connections` (one row per store)

| Column | Type | Notes |
|---|---|---|
| `store_id` | uuid pk, fk `stores` | |
| `mode` | text check in (`test`,`live`) | the base URL is derived from it in code, **never typed by the owner** (SSRF safety, like `checkWebhookUrl()`) |
| `credential_encrypted` | text not null | `encryptSecret()` of JSON `{ kind: 'api_token', token }` or `{ kind: 'consumer_employee', consumerToken, employeeToken }` (`src/lib/secret-box.ts`, `SETTINGS_ENCRYPTION_KEY` via `encryptionKey()`); never in the browser, logs, audit or errors |
| `credential_hint` | text | `secretHint()` style, `tlxr_…9f2a` |
| `company_id`, `company_name`, `company_org_number` | bigint, text, text | from `>whoAmI` at connect; org number compared with `stores.organisation_number`, a mismatch needs an explicit confirmation |
| `state` | text check in (`connected`,`paused`,`auth_failed`) | `paused` = owner switched off; `auth_failed` set by a 401 |
| `sync_from` | date not null | first `issued_on` that is sent; default **today** so connecting never back-posts history; earlier only by an explicit choice with a count preview |
| `settings` | jsonb not null | `tripletexSettings` (zod, shared with the browser): account numbers, VAT code numbers, voucher type, description language, `payments.pull`, `attach.pdf`, `customerEmail`; no secrets |
| `payments_cursor` | date | last date read (T2) |
| `last_ok_at`, `last_error`, `last_error_at`, `failures_in_a_row` | timestamptz, text, timestamptz, int | for the status card and alert throttling |
| `created_at`, `updated_at`, `updated_by` | | `updated_by` references `accounts` |

Unique `(mode, company_id)`: one Tripletex company belongs to one store at a time. Not
copied by `clone_store()` (it is the owner's own).

### 5.3 `commerce.tripletex_sync`: mapping and state (like `stripe_sync`)

| Column | Type | Notes |
|---|---|---|
| `store_id` | uuid not null | |
| `mode`, `company_id` | text, bigint | the Tripletex company the row is for; reconnecting the same company reuses the rows (so history is not posted twice), a different company starts clean |
| `kind` | text check in (`client`,`invoice`,`credit_note`,`payment`,`orders_day`,`orders_refund`) | last two for L2 |
| `local_id` | text | uuid of the Work object, or a day key for L2 |
| `their_id` | text | Tripletex id (customer or voucher or close group) |
| `their_ref` | text | voucher number "2026/145", customer number |
| `their_version` | int | for `PUT` on customers |
| `external_key` | text | what we sent as `externalVoucherNumber` |
| `content_hash` | text | hash of the payload last sent |
| `source_updated_at` | timestamptz | the source row's `updated_at` at that time |
| `amount_minor`, `currency`, `variance_minor` | bigint, char(3), bigint | gross total for drift checks; VAT difference seen after posting |
| `state` | text check in (`pending`,`sending`,`synced`,`failed`,`blocked`,`drifted`,`skipped`) | |
| `error_code`, `last_error`, `request_id` | text | stable code, clipped text without secrets or personal data, `x-tlx-request-id` |
| `attempts`, `next_attempt_at`, `claimed_until` | int, timestamptz, timestamptz | retry ladder and claim |
| `synced_at`, `created_at`, `updated_at` | timestamptz | |

Primary key `(store_id, mode, company_id, kind, local_id)`; unique
`(store_id, mode, company_id, external_key) where external_key is not null`; index
`(store_id, state, next_attempt_at) where state in ('pending','failed')`; index
`(store_id, kind, their_id)`. Check: `state = 'synced'` implies `their_id is not null`.
Composite keys keep a row in its store; there is no foreign key to Work tables because
`local_id` is polymorphic, and issued Work documents are never deleted (foreign keys
restrict) so nothing is orphaned.

### 5.4 `commerce.tripletex_calls` (optional, TP7)

A 30-day request log for support: `store_id`, `at`, `method`, `path template` (no ids or
query values), `status`, `ms`, `request_id`, `sync_id`. **No bodies, no headers.** Purged
in the same job (as deliveries are, D41). Lets an owner or Kaizen give Tripletex support a
request id.

## 6. Where it plugs in

### 6.1 Provider registration

`src/lib/integrations.ts`: add `tripletex` to `Provider`, `PROVIDERS` and drop
`comingSoon` from its `INTEGRATIONS` entry (its summary text is reworded to "Work invoices
and credit notes straight into your Norwegian accounting"). Tripletex is **not** a webhook
provider: `checkWebhookUrl()` is left alone, and the generic `saveIntegrationAction`,
`sendTest` and `saveIntegration()` paths (which need a webhook URL) are never used for it;
guards in `src/server/integrations.ts` make `sendTest` and `removeIntegration` route to
Tripletex's own functions. New files own the rest: `src/lib/tripletex*.ts` (pure),
`src/server/tripletex*.ts`.

The D41 queue (`integration_deliveries`, five tries, purged after 30 days) is **not** the
outbox: it is a fire-and-forget delivery log, and accounting needs durable per-object state
with no expiry. `tripletex_sync` is the outbox. The queue's event names
(`work_invoice.sent`, `.paid`, `.credited`, WP1a [repo]) still matter as the later
low-latency wake-up (TP13); slice 1 finds its work by a sweep (6.3).

### 6.2 Admin: where the connection UI belongs

Integrations send a store's clients' data to another company and are **owner-only**
(`asOwner()` in `integrations/actions.ts`, D41). Work is moving to the owner's level
(`/admin/account/work`, `src/lib/work-paths.ts`), but a Tripletex company is per **legal
seller** (organisation number), which is a store. So:

* **The connection, mapping and log live at the store's Integrations page**:
  `/admin/{store}/integrations/tripletex` (status, connect or replace token, test
  connection, switches, recent syncs, "Retry all failed", Disconnect), and
  `/admin/{store}/integrations/tripletex/mapping` (the wizard: VAT codes, accounts, voucher
  type, start date, with live checks against the company). Both are new `page.tsx` files, so
  both go in `ADMIN_PAGES` (`src/lib/admin-map.ts`, keywords `tripletex`, `regnskap`,
  `accounting`, `bokføring`); its test fails otherwise.
* **Work shows, never configures**: a status card on the Work settings page
  (`/admin/account/work/s/{store}/settings`): "Accounting: Tripletex, live · 2 waiting · 1
  needs attention → Manage" linking to the page above with `storeHref()`-style helpers, and a
  **Tripletex panel on the invoice page** (`.../work/s/{store}/invoices/{invoiceId}`):
  voucher number, state, last error in words, *Sync again*, *Check in Tripletex*. Built with
  `workBase()` links, never by hand.
* **The owner's overview**: `/admin/account/work` gains an attention item per store with a
  failing Tripletex (section 6.6), so an owner of several stores sees it without opening each.

### 6.3 The job

Step 16 of the five-minute job (`src/app/api/cron/cart-reminders/route.ts`, after
`prepareDueRecurringWork()`): `syncDueTripletex({ now? })` in `src/server/tripletex-sync.ts`,
result under `tripletex` in the JSON. Rules, the same as WP8's: **never throws**; stores
handled one at a time (Tripletex limits are per employee); per store at most 25 objects per
run and an overall 40-second budget, so a slow Tripletex cannot hold up the other 15 steps
(the route sets no `maxDuration` today [repo]); a store's failure is counted and logged and
does not stop the others; nothing runs while a page renders. If the budget proves too small,
the same function moves unchanged to its own route with its own `pg_cron` entry (the pattern
of `kaizen-integrations`).

Per store: (1) skip unless the connection is `connected` and Work is on and the store is not
closed; (2) **sweep**: insert missing rows: issued invoices and credit notes with
`issued_on >= sync_from` and no row (`on conflict do nothing`), clients whose
`updated_at` is newer than their row; (3) claim due rows (`pending`, or `failed` whose time
has come); (4) get a session token once (from the JWT with `ttlSeconds` 3600, or by the
consumer plus employee token), send in dependency order (customer, invoice, credit note);
(5) T2: read payments for outstanding synced invoices. A session token is held in memory for
the run only, never stored.

### 6.4 Events consumed

| Event | Source | Use |
|---|---|---|
| `work_invoice.sent` | `commerce.integration_work_invoice_events` trigger [repo] | T1: none (the sweep finds it); TP13: wake-up |
| `work_invoice.credited` | `work_credit_notes_applied` trigger [repo] | same |
| `work_invoice.paid` | same trigger | none needed: payments come **from** Tripletex; but a payment recorded in Work by hand is *not* pushed in T1 (bank payments are matched in Tripletex) |
| `work_client.created` | trigger [repo] | none: customers are created on demand |
| `order.paid`, `order.refunded` | order and refund triggers [repo] | L2 only (TP11): marks the day's summary as needing a rebuild |

WP13 of `docs/work.md` adds the `work_invoice.*` names to `IntegrationEvent`/`EVENTS`;
TP13 must coordinate with it.

### 6.5 AI manager (`src/lib/owner-tools.ts`, `src/server/owner-tools.ts`)

Owner tools are served to Kaizen Life through `store-mcp.ts` automatically (D96), so every
description must say nothing it should not.

* `tripletex_status`: **ungated read**: connection state, counts by state, the latest five
  problems in plain words, next steps with links (`adminLink`). Sums by code, amounts by
  `formatMoney`.
* `tripletex_retry`: **gate `send`** ("Sends something in the store's name"): re-queues
  failed and blocked objects, optionally one invoice; the approval text is built by
  `approvalSummary()` from arguments ("Send 2 invoices and 1 credit note to Tripletex").
  Runs on the owner's yes only.
* Never a tool to connect, change or read a token: **credentials are never typed into a
  chat**. `readLearned()` already refuses secrets for memory; the tool descriptions and a
  line in `TOOL_WORDS` say to use the page.
* A playbook in `ASSISTANT_SKILLS`: "why is this invoice not in Tripletex".
* `owner-assistant` health check (`owner-tools.ts`, the "integrations failing" finding)
  counts Tripletex `failed`/`blocked` rows.

### 6.6 Audit, alerts, history

* **`audit()`** (`commerce.audit_log`; settings-level changes only, like Work's): 
  `tripletex.connected` (mode, company id, org number), `tripletex.token_replaced`,
  `tripletex.disconnected`, `tripletex.settings_saved` (which keys, not values that are
  secrets), `tripletex.sync_from_changed` (old and new date and the count previewed),
  `tripletex.retry_all`, `tripletex.paused`, `.resumed`. **Never the token, its hint's hidden
  part, or personal data.**
* **`work_events`** (the invoice's history panel; the server writes them with
  `commerce.work_event()`): `tripletex.synced` (voucher number, variance), `tripletex.failed`
  and `tripletex.blocked` (code; **at most once a day per object**, as `recurring.issue_failed`
  does, work.md WP8), `tripletex.payment_imported`. No client email, no token.
* **Alerts**: (a) an attention item (`AttentionItem`) from a `tripletexAttention()` read
  called by `controlCenter()`/`workAttention()`: "3 invoices could not be sent to Tripletex"
  or "Tripletex sign-in stopped working", pointing at the page; (b) an email to each owner
  once per day while something is `failed`, `blocked` or `auth_failed` (`sendEmail()`,
  idempotency key `tripletex-alert:{storeId}:{yyyy-mm-dd}`, English admin text, like plan
  reminders D33); (c) optionally Slack, if the store has Slack connected, through a new
  `accounting.failed` event in `EVENTS` and `slackMessage()` (D101: a new event gets a
  message; text through `escapeSlack()`; no client names, only counts and a link).

## 7. Security and GDPR

* **Data stays in the EEA.** Tripletex AS is a Norwegian company, and Norway is in the
  EEA, which GDPR treats like the EU. Its hosting region and sub-processors are **[U]**:
  ask Tripletex, then add Tripletex to `docs/residency-register.md` **before any production
  data is sent** (D10). Kaizen's functions are pinned to `dub1`; a call to `tripletex.no`
  from Dublin is fine.
* **Roles.** The store owner is the controller and already has Tripletex as a processor for
  the books; Kaizen sends on the owner's instruction, as it does for Zapier (D41: the page
  reminds the owner to have a data processing agreement). No Kaizen-side account with
  Tripletex is created for an owner.
* **Minimal personal data.** Sent: customer name, organisation number, address and country
  (consumers: name and country only), invoice number, line text, amounts. **Not sent:**
  email, phone, time-entry notes, the hosted-page token, payment details, anything about
  shoppers in T1. Line texts are the invoice's own wording, clipped; the owner sees an
  example payload on the wizard's last step.
* **Token storage.** Encrypted at rest (`encryptSecret`, AES-256-GCM, `SETTINGS_ENCRYPTION_KEY`);
  saving is refused when the key is missing (as `saveIntegration()` refuses); the browser
  only ever gets `credential_hint`; the paste field is write-only and the page never
  re-displays it; the token is decrypted only in the job and the test-connection action, and
  is never put in `last_error`, logs, audit or errors (a test scans for it). Session tokens
  live in memory for one run. The legacy `PUT /token/session/:create` (tokens in the URL) is
  never used; only `POST` with a body [spec].
* **Least privilege.** The owner creates a **dedicated API user** for Kaizen in Tripletex
  (not a person's own login) and gives it only what T1 needs: customers (read, create,
  change), ledger vouchers (create, read), accounts, VAT types and accounting periods (read),
  and, for T2, postings (read) and voucher attachments. Tripletex says employee tokens
  inherit the creator's permissions and excess ones disable, causing errors [3P]; the
  exact entitlement names are **[U]** and the wizard's "Test connection" reports which calls
  fail. Never an accountant token, never salary or bank permissions.
* **Revocation.** The owner deletes the token in Tripletex (the JWT can be deleted there
  [docs]); the next call answers 401 and Kaizen stops (3.3) and says so. *Disconnect* in
  Kaizen deletes the encrypted credential, switches the registration off, marks unsent rows
  `skipped`, and **keeps** the sync rows (ids and states only, no personal data) so that
  reconnecting the same company never posts twice. Kaizen never deletes anything in Tripletex.
* **SSRF and host safety.** The base URL comes from `mode` only (two fixed values), requests
  use `redirect: 'manual'`, a 10-second timeout and `cache: 'no-store'`, exactly as `post()`
  does in `src/server/integrations.ts`.
* **Who may act.** Connect, replace token, change mapping, change `sync_from`, Disconnect:
  **owner** only. Retry and "Sync again": owner or admin (they send data already agreed).
  Every server action calls `requireMember(storeSlug)` and checks the module and the role,
  as the Integrations actions do. Platform admins do not see tokens.
* **Retention and erasure.** Tripletex keeps the books for the legal period (Norwegian
  bookkeeping law; confirm the years with the accountant); Kaizen keeps invoice snapshots
  as work.md 4.5 point 7 says. A GDPR erasure of a client anonymises the live Work client and
  is **not** propagated into posted vouchers (legal retention); the owner handles the
  Tripletex customer card. `tripletex_sync` holds no personal data; `tripletex_calls` none
  either and expires in 30 days.
* **Terms.** Tripletex's Developer Terms (a PDF) were not read [U]; the owner or Kaizen
  must accept them before the first live call, and they may define who counts as a
  "commercial" integrator (open question 10).

## 8. Test strategy

**Unit (Vitest, no database).**

* `src/lib/tripletex-vat.test.ts`: every Work category and rate to a code, unmapped
  combinations, not-registered stores, wizard checks against a fake account list.
* `src/lib/tripletex-map.test.ts`: invoice and credit note to voucher (postings sum to
  zero, signs, one posting per line, gross amounts with two decimals, exact minor-to-decimal
  conversion including 0.01, 999 999 999.99, half-up cases), the external number (length
  at most 70, deterministic), description clipping and language, customer payload (consumer
  sends name and country only; no email by default), the hash changes exactly when a field
  we send changes; **the rounding property of 4.2** (Work's VAT equals VAT-from-gross for
  25, 15, 12 % over a range); a no-floats guard.
* `src/lib/tripletex-errors.test.ts`: status and error-code to class and owner text
  (401, 403, 404, 409 with 8000, 14000, 25000, 422 with `validationMessages`, 429 with reset,
  5xx, timeouts), texts contain no token.
* `src/lib/tripletex-payments.test.ts`: postings to payment events, dedupe key, reopen.
* `src/lib/tripletex-settings.test.ts`: the zod schema shared with the browser.
* `src/lib/integrations.test.ts` (extended): `tripletex` is a provider, not a webhook one.

**Database rules (`src/db/commerce.test.ts`, PGlite).** The new tables and constraints
(state check, `synced` implies `their_id`, unique external key, unique `(mode, company_id)`);
RLS is on for all; provider check accepts `tripletex`; `queue_integration_event()` queues
nothing for it; cross-store rows cannot collide; `clone_store()` copies neither table.

**Integration (`pnpm test:int`, real database, HTTP mocked).** Modelled on
`checkout-stripe.int.test.ts`, which replaces `./stripe` with a `vi.hoisted()` fake: here
`vi.mock('./tripletex-client')` is replaced by an in-memory Tripletex
(`src/server/tripletex-test-support.ts`: customers, vouchers keyed by external number,
accounts, VAT types, periods, postings and close groups; switches for 401, 403, 409-8000,
422 closed period, 429 with reset, 5xx, and **"created but answer lost"**). Files:
`tripletex.int.test.ts` (connect, wrong company, replace token, disconnect, secrets never
in `audit_log`, `last_error`, `tripletex_calls` or the page), `tripletex-sync.int.test.ts`
and `tripletex-payments.int.test.ts`. Scenarios:

1. issue an invoice, run the sweep: customer created, one voucher, row `synced`, an event in
   the history; a second run does nothing;
2. six overlapping runs post once (`skip locked` and the claim), as `work-recurring.int.test.ts` does;
3. answer lost after POST: the retry finds the voucher by external number and adopts it, no
   second voucher;
4. 5xx ladder and the daily tries; 429 waits the reset and does not count as an attempt;
5. 401 pauses the store and alerts once; a new token resumes;
6. closed period: `blocked`, not redated; after Retry with the period open: posted;
7. full and partial credit note: dependency on the invoice's voucher, signs, totals add up;
   credited before either synced;
8. client renamed: one `PUT` with the stored version; a 409-8000 re-read and one retry;
   edit of a field we do not send: no call;
9. `sync_from` respected; the connection never back-posts; reconnecting the same company
   posts nothing twice; a different company posts from `sync_from` only;
10. foreign-currency and unmapped-VAT invoices are `blocked` with their codes, and other
    invoices still go;
11. Work off, store closed, store isolation (two stores, one fake company: refused by the
    unique key);
12. T2: a payment appears, is recorded once (unique `provider_reference`), a reopened one is
    reversed, an overpayment is `blocked: overpaid`, a hand-recorded payment is linked not
    doubled;
13. **euro scenario** for the L2 read (project rule: a new money read needs one in
    `checkout-kinds.int.test.ts`), and Work invoices in EUR are blocked in T1.

**E2E (Playwright).** Only what needs no Tripletex: the Integrations list shows Tripletex
as available; the page for a store that is not connected; an admin who is not an owner
cannot save; the wizard's validation messages. No call to Tripletex from CI.

**Contract check.** A nightly job (not in CI's blocking path) fetches
`https://tripletex.no/v2/openapi.json` and fails when a field or endpoint we use (Appendix
C) disappears, because Tripletex changes v2 in place [docs changelog].

**Manual sandbox checklist:** Appendix A.

## 9. Work packages, order and effort

Estimates are ideal days for one engineer who knows the repository. Each package lists
its **target files**; shared files are edited by one package each, as work.md 7.3.

| WP | Content | Files | Days |
|---|---|---|---|
| **TP0** | **Spike S0 and decisions.** Get a test company (form, minutes). Run Appendix A items 1 to 12. Decide V or I (3.1). Answer the [U] items marked "S0". Owner answers section 10 questions 1 to 6. Write the decision (next free number: **D123 is already cited in code but is not in `decisions.md`, check**) and the residency register row. | `docs/decisions.md`, `docs/residency-register.md`, this file | 1.5 (+ owner time) |
| **TP1** | Schema and rules: the three tables, provider check, RLS, indexes, checks, `commerce.test.ts`; apply to production and record the version (standing approval in CLAUDE.md) | `src/db/schema.ts`, `supabase/migrations/…_tripletex.sql` (generated), `…_tripletex_rules.sql` (custom), `src/db/commerce.test.ts` | 1.5 |
| **TP2** | Pure libraries and unit tests: VAT map, payload builders, error classes, settings schema, external number, hash, payments-pure | `src/lib/tripletex.ts`, `tripletex-vat.ts`, `tripletex-map.ts`, `tripletex-errors.ts`, `tripletex-settings.ts`, `tripletex-payments.ts`, each with `.test.ts`; `src/lib/integrations.ts` (Provider, entry) | 3 |
| **TP3** | HTTP client and connection: session from JWT or from consumer and employee tokens, base URL by mode, timeouts, 429 handling, request id, pagination, `>whoAmI` check, `tripletex_calls`; connect, test, replace, disconnect; the in-memory fake | `src/server/tripletex-client.ts`, `src/server/tripletex.ts`, `src/server/tripletex-test-support.ts`, `tripletex.int.test.ts` | 2.5 |
| **TP4** | Sync engine: sweep, claim, customers on demand, invoice and credit note vouchers, adopt-by-external-number, state machine, retry ladder, `syncDueTripletex()`; step 16 in the five-minute job | `src/server/tripletex-sync.ts`, `tripletex-sync.int.test.ts`, `src/app/api/cron/cart-reminders/route.ts` | 4 |
| **TP5** | Admin UI: Integrations page for Tripletex, mapping wizard with live checks, actions (owner-only), status card on Work settings, invoice panel with Sync again and Check, `ADMIN_PAGES`, Integrations list badge | `src/app/admin/(gated)/[store]/integrations/tripletex/page.tsx`, `…/mapping/page.tsx`, `…/tripletex/actions.ts`, `src/components/admin/tripletex-panel.tsx`, `tripletex-status-card.tsx`, `…/work/s/[store]/settings/page.tsx`, `…/invoices/[invoiceId]/page.tsx`, `src/lib/admin-map.ts` (+ test) | 3 |
| **TP7** | Alerts, audit, history: `tripletexAttention()` into the control center, owner email, `work_events` types, `audit()` calls, optional Slack event | `src/server/tripletex-alerts.ts`, `src/server/control-center.ts`, `src/lib/control-center.ts`, `src/lib/email-text.ts`, `src/lib/slack.ts` | 1.5 |
| **TP10** | Tests, documentation, e2e, decision and "As built" section (continuous; final pass) | `e2e/tripletex.spec.ts`, this file | 2 |
| | **Slice T1 total** (TP0 to TP5, TP7, TP10) | | **19** |
| **TP6** | Payments pull: spike-dependent reads, `recordExternalPayment()`, reversals, link-not-double, opt-in switch | `src/server/tripletex-payments.ts`, `src/server/work-invoices.ts` (one function), `tripletex-payments.int.test.ts` | 2.5 |
| **TP9** | PDF attachment (needs Work's server PDF "W5"; **+3 days if that is not built**) | `src/server/tripletex-attach.ts`, `src/app/api/work/pdf/…` | 2 |
| **TP8** | AI manager tools, playbook, `TOOL_WORDS`, `owner-assistant` finding | `src/lib/owner-tools.ts`, `src/server/owner-tools.ts`, `src/lib/assistant-skills.ts`, `src/lib/admin-map.ts` | 1 |
| | **L1 complete** (T1 + TP6, TP8, TP9) | | **≈ 25** |
| **TP11** | L2: order-day summary vouchers (Norwegian market, NOK), VAT split by `order_lines.tax_rate` reconciled to `orders.tax_minor` (blocked on any difference), refunds, the euro scenario | `src/server/tripletex-orders.ts`, `src/lib/tripletex-orders.ts`, `checkout-kinds.int.test.ts`, `tripletex-orders.int.test.ts` | 5 |
| **TP12** | L2: Stripe fees and payouts (new Stripe reads on the connected account) | `src/server/tripletex-payouts.ts`, `src/server/stripe.ts` | 4 |
| **TP13** | Webhooks: `closeGroup.create` with HMAC check as a low-latency wake-up; `work_invoice.*` events as wake-ups; keep the poll | `src/app/api/integrations/tripletex/[store]/route.ts`, `src/server/tripletex-webhooks.ts` | 1.5 |
| **TP14** | Foreign currency (`convertFromAmountGrossCurrency`), *Reconcile period* report and CSV | `src/lib/tripletex-map.ts`, `src/server/tripletex-reconcile.ts` | 3 |
| | **L2 and extras** | | **≈ 13.5** |
| **TPX** | **Consumer token** (Kaizen applies to Tripletex; 2 to 3 weeks of waiting, an hour of form) and, if approved, a platform admin page to keep it encrypted in the database (never an environment variable, D15) and the connect option "consumer plus employee token" | `/admin/platform/…` page, `src/server/tripletex-consumer.ts` | 2 (+ wait) |

**Order.**

```
Day 1 in parallel:   TP0 (spike, owner answers)      TP2 (pure libs)     TPX form (only if other stores will use it)
After TP0 + TP2:     TP1 (schema)  ∥  TP3 (client and connection, needs TP2's error classes)
After TP1 + TP3:     TP4 (engine)  ∥  TP5 (UI, against the fake)
Then:                TP7, TP10; pilot on the Tripletex test company, then Human Web live
Slice 2:             TP6 ∥ TP9, then TP8
Later:               TP13, TP14, then L2 (TP11, TP12) if wanted
```

With two engineers T1 is about two and a half weeks. **Release gates:** (1) the module
stays behind the connection: nothing changes for any store until an owner connects; (2) a
test-mode dry run for Human Web with the accountant reading the vouchers; (3) attachments
decided (open question 3) before live; (4) the residency register row and Tripletex's
terms accepted; (5) `pnpm lint`, `typecheck`, `test`, `test:int`, `test:e2e`, `db:check`
green before every push to `main`, as the project workflow says.

## 10. Questions the owner must answer before the build

1. **Which Tripletex company, and who creates the token?** Is Human Web AS's company the
   one (organisation number, VAT registered, chart of accounts)? Is the **Integrations**
   module active or acceptable to buy, and who is the user admin who generates the API token
   (*Company > API tokens*) and a dedicated API user? Do we start with a Tripletex **test**
   company (free, self-service, sends no email)?
2. **Which system issues the legal invoice number?** Recommended: Work (`W-…`), with
   Tripletex only booking it. If Tripletex must issue invoices, this whole design changes
   (3.1).
3. **Does the accountant accept vouchers with a customer-ledger posting instead of
   Tripletex invoices**, and is a voucher without the PDF acceptable until TP9, or must
   the PDF be attached from day one (then W5's server PDF is a prerequisite)?
4. **Chart of accounts:** receivable account, income accounts for 25 % services, exempt,
   outside the VAT area; the voucher type; a department or a **project** per Work assignment
   (not planned; say if you want it); language of the voucher texts (Norwegian is the
   default).
5. **VAT:** the code for services sold to businesses abroad (6 or 52), which clients are
   foreign and in which currency (EUR, SEK, ...), and whether the store is VAT registered
   (Work's flag must agree with Tripletex's setting).
6. **Start date (`sync_from`) and closed periods:** the first invoice date that should be in
   Tripletex; which invoices issued in Kaizen before connecting are already booked
   elsewhere; is any period closed?
7. **Payments (T2):** should payments recorded in Tripletex (bank matching) become the
   payments in Work, and should Work's own "Record payment" stay available?
8. **Webshop orders (L2):** wanted at all, when, and with which clearing, fee and payout
   accounts; how are EU sales (OSS, VOEC) to be treated by the accountant?
9. **Who is alerted, and how:** owner emails, Slack, or the admin only?
10. **Other stores and the consumer token:** will Kaizen offer Tripletex to stores other than
    Human Web? If yes, apply for a consumer token now (2 to 3 weeks) and read Tripletex's
    Developer Terms; Human Web's own single-company token is "internal" use [docs], but
    Kaizen offering it to many is "commercial".
11. **Data processing:** who signs Tripletex's data processing terms for Human Web (the
    company itself, already a customer), and is a Kaizen-side note in the residency register
    enough?

## Appendix A. Sandbox checklist (TP0 and before each live release)

Create a test account at `https://api-test.tripletex.tech/execute/integrationEnvironment?site=en`
(it gives a consumer and an employee token; test tokens start with `test-`). Then, with
`POST /token/session/:create`, and Basic auth `0:{session}`:

1. `GET /token/session/>whoAmI`: company id, name, organisation number.
2. **Numbering (decides V or I):** `POST /invoice` with an order and `invoiceNumber` set to a
   number not yet used. Accepted? Which rules? With `0`: generated? Does `sendToCustomer`
   default to sending? (In test, no email is sent.)
3. `GET /ledger/vatSettings`, `GET /ledger/vatType?typeOfVat=...`, and the numbers 3, 5, 6, 52
   exist with the expected names; note their ids.
4. `GET /ledger/account`: 1500, 3000, 3100, 3200 exist? `ledgerType`, `legalVatTypes`,
   `vatLocked` for each.
5. `GET /ledger/voucherType`: which type fits an outgoing invoice booking?
6. `POST /ledger/voucher` as in 4.2 (receivable with customer and `invoiceNumber`, one
   income posting with VAT code 3): posted to the ledger (default `sendToLedger=true`)? VAT
   posting added? Row numbering? Description length limit? **Read it back: VAT total equals
   Work's?** Test with lines whose VAT lies on a half-øre boundary.
7. `GET /ledger/voucher/>externalVoucherNumber` with the number just used: returns it. With
   a duplicate external number on a second POST: rejected or allowed?
8. Credit-note voucher (reversed signs): appears in the customer ledger; matching against
   the receivable by `invoiceNumber`.
9. Register a payment in the Tripletex GUI (or import a bank line) against that receivable:
   how does it appear via `GET /ledger/posting` and `openPost`? Which posting type,
   `closeGroup`, dates? Reopen it: what changes? (Decides TP6.)
10. `GET /event` (authenticated): which events exist (`closeGroup.*`, `voucher.*`,
    `invoice.*`, `posting.*`)?
11. A voucher dated in a closed period (close a period in the GUI): the error code and text.
12. Rate limit: read `X-Rate-Limit-*` headers on a burst; note the limit.
13. `POST /ledger/voucher/{id}/attachment` with a PDF.
14. Token model: create an API token (JWT) in a test company if the GUI offers it, and call
    `POST /token/session/:createFromRefreshToken`; delete the token and confirm a 401.
15. A dedicated API user with minimal entitlements: which calls fail without which right?

Record results in `docs/tripletex.md` under "As built" and turn each [U] above into a fact.

## Appendix B. Sources read for this document

* Tripletex OpenAPI 2.75.12: https://tripletex.no/v2/openapi.json (interactive: https://tripletex.no/v2-docs/, test: https://api-test.tripletex.tech/v2-docs/)
* Authentication and tokens: https://developer.tripletex.no/docs/documentation/authentication-and-tokens/
* Getting started (test account, production): https://developer.tripletex.no/docs/documentation/getting-started/1-creating-a-test-account/ and `…/3-getting-ready-for-production/`
* Webhooks: https://developer.tripletex.no/docs/documentation/webhooks/
* FAQ (general, invoice and order, ledger and voucher): https://developer.tripletex.no/docs/documentation/faq/ (`general/`, `invoice-order/`, `ledger-voucher/`)
* Best practices: https://developer.tripletex.no/docs/documentation/integration-best-practices/
* Integration marketplace: https://developer.tripletex.no/docs/documentation/integration-marketplace/
* Repository and changelog: https://github.com/Tripletex/tripletex-api2 (`changelog.md`, `docs/webhooks/`)
* Norwegian VAT codes: https://www.tripletex.no/fagblogg/regnskap/mva-koder-et-oppslagsverk/
* Third party (hints only): https://www.apideck.com/blog/how-to-integrate-with-the-tripletex-api (its statement that "no refresh tokens exist" is out of date against the spec)
* Not readable (blocked, 403): Tripletex's help centre articles on API keys, and the Developer Terms PDF.

Repository files read: `CLAUDE.md`, `AGENTS.md`, `docs/work.md`, `src/lib/integrations.ts`,
`src/server/integrations.ts`, `src/lib/slack.ts`, `src/server/slack.ts`, `src/lib/secret-box.ts`,
`src/lib/work-paths.ts`, `src/server/work-invoices.ts`, `src/server/work-owner.ts`, `src/db/schema.ts`
(Work tables, `stripe_sync`), `supabase/migrations/20260925114152_integrations.sql`,
`…114154_integrations_rules.sql`, `…20260928233111_slack.sql`, `…20260929211920_work_rules.sql`,
`src/app/api/cron/cart-reminders/route.ts`, `src/app/api/cron/integrations/route.ts`, the
Integrations admin pages and actions, `src/server/checkout-stripe.int.test.ts`,
`src/lib/owner-tools.ts`, `src/lib/admin-map.ts`.

## Appendix C. Endpoints this design calls (for the contract check)

`POST /token/session/:create`, `POST /token/session/:createFromRefreshToken`,
`GET /token/session/>whoAmI`, `GET /company/{id}`, `GET/POST /customer`, `PUT /customer/{id}`,
`GET /country`, `GET /currency`, `GET /ledger/account`, `GET /ledger/vatType`,
`GET /ledger/vatSettings`, `GET /ledger/voucherType`, `GET /ledger/accountingPeriod`,
`POST /ledger/voucher`, `GET /ledger/voucher/{id}`, `GET /ledger/voucher/>externalVoucherNumber`,
`POST /ledger/voucher/{voucherId}/attachment`, `GET /ledger/posting`, `GET /ledger/posting/openPost`;
later `POST /event/subscription`, `GET /event`.
