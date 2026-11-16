# Contracts for deals, signed on our own page (D695)

A design, not yet built. The owner's choice (16 November 2026): a contract builder for deals with signing **of our own**, not
DocuSign. Each step below gets its commit and its line under D695 when it is built.

![A contract's life](contracts.svg)

## 1. What Homer and Lisa get

**Homer**, on a deal's page: *New contract*. He picks a template (or the one the store uses), sees the contract filled in from
the deal (who, the company, the linked quote's lines, the store's business details), and presses **Send for signing**. The
customer gets an email with a link, reads, signs; Homer gets the signed PDF and the deal moves on by itself. He reads nothing
first.

**Lisa**, one step away (Customise): the template's clauses and optional clauses, the fields, who signs and in what order (the
store's signer first or last), a reminder schedule and an expiry, the signing level (section 5), a new version of a sent
contract, the audit trail of each signature.

## 2. What is reused

| Need | Reused from |
|---|---|
| A contract on a deal | `DEAL_LINK_KINDS` (`src/lib/deals.ts`) gains `contract` |
| The deal moving without a person | `deal_quote_sent()` / `deal_win()` and `deal_moves.via` (D464) |
| Fixed once sent | the invoice snapshot (`src/lib/invoice-snapshot.ts`) |
| The PDF, kept once with its SHA-256 | `src/server/invoice-pdf.ts`: `documentHtml()` → Chromium → private `documents` bucket |
| A link that is the whole access | `src/lib/document-token.ts`, a new kind `ctr_` (and `sig_` for each signer) |
| Fields | deals, `customer_companies`, `draft_orders`, business details, custom fields (D118) |
| Emails, reminders, expiry | email templates, `runJobs()` in the five-minute dispatcher |
| History | the customer timeline (D462, kind `contract`), the audit log |
| Text in other languages | `src/lib/messages/{lang}.ts`; a template has a drawing per store language |

## 3. The model (`commerce`)

- `contract_templates` (store, name, language, `blocks` jsonb, version, archived). Blocks are a small set: heading, paragraph,
  field, optional clause, the quote's lines, a signature box per signer role. Fields are a closed list worked out in code
  (`src/lib/contract-fields.ts`, pure), never free SQL or HTML.
- `contracts` (store, deal, template and its version, title, language, status, `snapshot` jsonb, `pdf_path`/`pdf_sha256` of the
  sent document, `signed_pdf_path`/`signed_pdf_sha256`, `token`, `expires_at`, `sent_at`, `completed_at`, `replaces_id`).
  Status: `draft → sent → (viewed) → signed | declined | expired | cancelled`.
- `contract_signers` (contract, role `store|customer|other`, name, email, order, `token`, `viewed_at`, `signed_at`,
  `declined_at`, reason, level, the evidence of section 5).
- `contract_events` (contract, signer, kind, at, ip, user agent, the document's SHA-256 at that moment), written by
  triggers and the signing route; never updated or deleted.

The database holds the rules: a contract's snapshot and sent PDF never change after `sent_at` (as invoices'); a change is a new
contract that `replaces_id` the old one and cancels it; a signed contract is never deleted while its retention lasts; a signer
signs at most once; `completed_at` is set only when every signer has signed. Tests in `src/db/commerce.test.ts`.

## 4. Deals

- Sent: the deal moves forward to its pipeline's **contract stage** (a new `deal_stages.contract_stage`, at most one per
  pipeline, as the quote stage), never back, never when closed; `deal_moves.via` `contract`.
- Signed by all: the deal is **won** (`deal_win()`), unless Lisa chose the stage it moves to instead.
- Declined: the deal stays open, the reason on its history; Homer sees *Declined: …* with *Send a new version*.

## 5. Signing

The signing page `/s/{store}/{market}/sign/{token}` (the store's look, its language, no account needed) shows the whole
contract as HTML from the same snapshot as the PDF, a download of the PDF, and one action: **Sign** (or Decline, with a reason).

**Level 1, simple electronic signature (eIDAS art. 3(10)), built first, no vendor:**

1. The signer proves the email the link was sent to with a six-digit code (limited tries, short life, counted per IP).
2. They type their full name, tick *I have read and agree*, and press Sign.
3. Kept as evidence: the code's check, name typed, time, IP, user agent, the SHA-256 of the document they were shown (it must
   equal `pdf_sha256`, or signing is refused), every view.
4. When the last signer signs, the server builds the **signed PDF**: the sent PDF with an added audit page (each signer, their
   evidence, the hashes), then **sealed** with Kaizena Flow's own certificate (a PAdES signature over the whole file) so any
   change to it shows in a PDF reader. Kept once in `documents`, emailed to every signer.

**Level 2, advanced signature (AdES) with national ID, step 5:** the same page, but step 1 is BankID (Norway), MitID, Freja,
Smart-ID … through one EU identity broker (chosen then: Criipto, Signicat or Scrive, processing in the EU). The broker's signed
identity assertion is kept as the evidence; the seal can become a qualified one from the same vendor. Its credentials are a
platform or store setting, never an environment variable (D15). Lisa chooses the level per template.

The store's signer signs inside the admin (already signed in with two-step), with the same evidence.

## 6. Around it

- **Emails**: sent, reminder, signed (with the PDF), declined, expired; to the deal's owner as staff alerts.
- **The AI manager** gets tools to draft a contract from a template for a deal, send it and read its status. It never writes
  a price or a clause's figures: those come from the linked quote and the template (grounding rule). A tool change means a new
  recording on Platform → AI.
- **Webhooks** (D354) `contract.sent|signed|declined`; the Admin API (D355) reads contracts.
- **Retention**: a signed contract is kept 3 years 6 months after the agreement ends (Bokføringsloven § 13(2)); erasure keeps it
  (legal obligation) and removes the person from everything else; the export lists contracts under purpose `sales`.
- **Permissions**: `contracts:read`, `contracts:write` (send), the store signer only by an owner or a member allowed to sign.
- **Usage and limits** counts contracts sent per month; the feature sits under `sales` (D464), offered as Deals is.
- **The platform**: Kaizena Flow's own store has Deals (D466), so it gets contracts in the same change (its own sales
  agreements); `docs/platform-parity.md` needs no new row.

## 7. Steps

1. Tables, rules and their tests; `contract-fields.ts`; snapshot and the sent PDF.
2. Templates: the editor (Homer's one template made on first visit in the store's language; Lisa's blocks), *New contract* on
   a deal.
3. The signing page at level 1, the email code, the signed PDF with its seal, emails, reminders and expiry (cron).
4. Deals' contract stage and win, the timeline, webhooks, the AI manager's tools.
5. Level 2: an EU identity broker for BankID and its neighbours.

## 8. Open questions for the owner

- Level 2 from the start, or after level 1 is in use?
- May a quote itself be signed as the contract (a template block of its lines is the default), or is a contract always apart?
- Who signs for the store: the deal's owner, or a named signer?
