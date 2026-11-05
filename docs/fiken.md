# Fiken: keeping a Norwegian store's books in step with Kaizena Flow (D460)

Fiken is the accounting system most small Norwegian businesses keep their own books in (sole traders and small AS); with Tripletex
(D453) and PowerOffice it covers most of Norway. This connection books a store's issued invoices and credit notes, Work's and the shop's,
in its Fiken company, on the engine built for Tripletex: the same documents read the same way, the same queue with its claims, retry
ladder and "Needs you", the same alerts. What is Fiken's own is how it lets us in and what a booking is there.

Status: built 5 November 2026 against Fiken's published spec and an in-memory Fiken; **not yet tried against a real Fiken company**
(section 6 says what to check first). It is offered only once Kaizena Flow's app at Fiken is set up (`FIKEN_CLIENT_ID`,
`FIKEN_CLIENT_SECRET`).

Evidence is marked as in `docs/tripletex.md`: **[spec]** read in Fiken's OpenAPI file (`https://api.fiken.no/api/v2/docs/swagger.yaml`,
version 2.0.0, downloaded 2026-11-05); **[U]** not verified, a risk until tried in a Fiken test company.

## 1. What Fiken offers

| Fact | Evidence |
|---|---|
| Base URL `https://api.fiken.no/api/v2`; TLS only. No test environment: a **test company** is made in Fiken itself ("Registrer et foretak som ikke er i Brønnøysundregistrene"), and `company.testCompany` says which. | [spec] intro, `company` |
| A third party must use **OAuth2** (authorization code, `https://fiken.no/oauth/authorize`, token `https://fiken.no/oauth/token` with HTTP Basic client id and secret). **Personal API tokens in a third-party app break Fiken's terms** and may end API access. | [spec] intro |
| PKCE (`S256`) is optional for a confidential client and recommended; access tokens last about a day (`expires_in` 86157 in the example); a refresh may return a new refresh token (always, for a public client). Revoke: `POST https://fiken.no/oauth/revoke` with the access token. | [spec] intro |
| The owner chooses in Fiken which companies the app may open (Rediger konto → Sikkerhet → Apper du har gitt tilgang til). `GET /companies` lists them, with `hasApiAccess`. | [spec] `/companies`, `company` |
| The company pays for the API module: **99 kr a month**, ordered under Settings → Module access. Development allows **5 users**; production status by email to api@fiken.no after 2 to 3 real users. | [spec] intro |
| **One request at a time**; slowed past **4 a second**; 429 when broken. `X-Request-ID` recommended. | [spec] intro |
| Amounts are **integers in øre**. Accounts are four digits (`3000`) or a ledger account (`1500:10001`). | [spec] intro |
| A POST answers **201 with an empty body and a `Location`** of what it made. | [spec] intro |
| `POST /companies/{slug}/sales` is **"Annet salg"**: "should be used when the invoice document and invoice number have been created outside Fiken". Kind `external_invoice` (a receivable on the customer) or `cash_sale`; `saleNumber`, `date`, `dueDate`, `customerId`, `currency`, `lines` of `{description (200), netPrice, vat, account, vatType}`. `GET /sales?saleNumber=` finds by number. A deleted sale keeps its row with `deleted: true` and a reversal. | [spec] `/sales`, `saleRequest`, `orderLine` |
| VAT types for sales: `NONE` (7), `HIGH` (3), `MEDIUM` (31), `RAW_FISH` (32), `LOW` (33), `EXEMPT_IMPORT_EXPORT` (52), `EXEMPT` (5), `OUTSIDE` (6), `EXEMPT_REVERSE` (51). | [spec] intro table |
| Contacts: `customer: true`, `organizationNumber`, `email`, `language` (NORWEGIAN/ENGLISH), `address` (its `country` is a name, "Norway"), `daysUntilInvoicingDueDate`; found by `organizationNumber`; `PUT /contacts/{id}`. | [spec] `contact` |
| Attachments: `POST /sales/{id}/attachments` (multipart `filename` and `file`, `attachToSale=true`). | [spec] |
| The error body is not documented: only the statuses (400, 401, 403, 404, 405, 415). | [spec] intro |

## 2. Decisions

1. **OAuth2 with PKCE, never a pasted token.** Connect sends the owner to Fiken's consent page; a signed cookie (`sealFikenState()`)
   carries the nonce, the store, the account and the PKCE verifier for 15 minutes; the callback (`/api/integrations/fiken/callback`)
   checks it and the owner signed in now before the code is spent. The grant is kept encrypted in `commerce.fiken_connections`,
   refreshed under the row's lock (`fikenAccess()`), and revoked at Fiken on Disconnect.
2. **A document is a sale ("Annet salg", `external_invoice`), not a free journal entry.** It is what Fiken offers for invoices numbered
   outside Fiken, keeps the receivable on the customer (1500 and the customer's number, so there is no receivable account to choose), and
   takes each line's net and VAT as the document charged them, so nothing is worked out again.
3. **The sale number is the document's own number**, as the accountant reads it on the PDF. Before every send the sale is looked up by its
   number: the same sale (same day, net and VAT, not deleted) is adopted, whether its answer was lost or the owner had booked it by hand;
   another sale with the number waits for a person (`number_taken`). So a document is never booked twice, and moving from booking by hand
   to the connection is safe.
4. **A credit note is a sale with its lines negative**, on the same customer, numbered as the credit note, its lines saying what they credit
   ("Kreditnota K-7 for faktura 1042: …"). **[U]** that Fiken takes negative lines on an external invoice; a refusal waits visibly with
   Fiken's words, and the alternative is a general journal entry (section 6).
5. **The same documents and customers as Tripletex**: a Work client is a contact of its own, a Norwegian business that bought in the shop
   is that business, every shopper is one contact per store ("Nettbutikkunder (Kaizena Flow)"). No shopper's name or address leaves.
6. **One system per store.** Fiken is refused while Tripletex is connected and the other way round, so a document is never in two sets of
   books. The checkup, the briefing and the daily alert name whichever it is (`accountingAttention()`, `sendAccountingAlert(…, system)`).
7. **NOK only** in this version, as Tripletex; another currency waits visibly (`currency_unsupported`).
8. **Shop documents are external invoices too**, so their payments are matched in Fiken as Tripletex's are (a later step may book them as
   cash sales to a clearing account for the payment provider).

## 3. What is shared with Tripletex

| Part | File |
|---|---|
| The VAT buckets, the documents read into one shape (`BookingDoc`, with each line's net and VAT), customers' keys | `src/lib/accounting-docs.ts` (Tripletex's modules re-export it) |
| Reading a document and the buckets a store used | `src/server/accounting-documents.ts` |
| Which system a store uses and what needs a person there | `src/server/accounting.ts` |
| The daily alert, worded for either system | `sendAccountingAlert()` in `src/server/staff-alerts.ts` |

## 4. Built

| Part | Files |
|---|---|
| Addresses, state cookie, PKCE, sale numbers, `Location` ids | `src/lib/fiken.ts`, `fiken.test.ts` |
| Settings (account and VAT type per bucket) | `src/lib/fiken-settings.ts` |
| Setup from the company's accounts, and its check | `src/lib/fiken-setup.ts` |
| Documents to sales, customers to contacts | `src/lib/fiken-map.ts`, `fiken-map.test.ts` |
| Failures and their words | `src/lib/fiken-errors.ts` |
| Tables | `commerce.fiken_connections`, `commerce.fiken_sync` (`20261105164532_fiken.sql`), `src/db/fiken.test.ts` |
| HTTP client (one call at a time, a quarter of a second apart; the token endpoint; revoke) | `src/server/fiken-client.ts` |
| Connect, choose the company, Start, Pause, settings, Disconnect, counts, attention | `src/server/fiken.ts` |
| Sync engine and its job (`fiken` in the five-minute dispatcher) | `src/server/fiken-sync.ts` |
| Fiken in memory, and the tests against a real database | `src/server/fiken-test-support.ts`, `src/server/fiken.int.test.ts` |
| The page, its actions, the callback, the Integrations list, Work's settings card | `src/app/admin/(gated)/[store]/integrations/fiken/`, `src/app/api/integrations/fiken/callback/route.ts`, `src/components/admin/fiken-card.tsx` |
| Words (a server-only area) | `src/lib/admin-messages/fiken.{en,nb}.ts` |

Not yet: the per-document panel on a Work invoice (Tripletex's `TripletexDocumentsPanel` has one), AI manager tools, payments read back,
foreign currency, a shop sale booked as paid.

## 5. Setting up Kaizena Flow's app (once, for the platform)

1. Sign in to Fiken as a developer (Rediger konto → Profil → Andre innstillinger → "Jeg er utvikler").
2. Under the API tab, make an app *Kaizena Flow*, confidential (with a client secret), redirect URL
   `https://kaizenaflow.com/api/integrations/fiken/callback`.
3. Set `FIKEN_CLIENT_ID` and `FIKEN_CLIENT_SECRET` in Vercel (production) and redeploy.
4. Make a test company and ask hjelp@fiken.no for free access beyond the 30-day trial; connect it from a store and run section 6.
5. After 2 to 3 real stores use it, ask api@fiken.no for production status (until then, at most 5 users).

## 6. To find out in a Fiken test company

1. That a sale of kind `external_invoice` takes negative `netPrice` and `vat` (a credit note). If not: book credit notes as a general journal
   entry (`POST /generalJournalEntries`: debit the income account with its VAT code, credit `1500:{customerNumber}`).
2. Whether a sale line takes account 2900 (a gift card sold, a debt) with `NONE`.
3. The error body's shape for a refused sale (the words are read from `message`, `error_description` or a list; check they show).
4. Whether `GET /sales?saleNumber=` returns deleted sales (the sync ignores them either way).
5. The refresh token's life for a confidential client, and whether a refresh rotates it.
6. That `GET /companies/{slug}/transactions/{id}` gives the journal entry number shown as the "bilag".
