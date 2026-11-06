# Own books and sales: making Tripletex, Pipedrive and a separate CRM unnecessary (proposal)

Status: **proposed 6 November 2026**, no decision number yet. The owner's aim: a store owner should need neither an accounting system
(Tripletex, Fiken), a sales pipeline (Pipedrive) nor a separate CRM beside Kaizena Flow. Open to every store owner on the platform in
the end; **Human Web is the pilot**, and each step is proven there before it opens to others. Human Web is HUMAN WEB ANDRÉ GIÆVER, a
sole proprietorship (ENK, organisation number 915 429 777, VAT registered; Brønnøysund's register, read 2026-11-06), not an AS as
`docs/tripletex.md`'s examples say. It runs no payroll, invoices its clients through Work and keeps its books in Tripletex today. It
has no outside accountant **until its turnover passes NOK 5 million a year; then the owner's wife, an accountant, takes that role**
(the owner's rule, 6 November 2026; section 4.4). The owner's goal is to **turn Human Web into an AS in 2027** (section 4.5).

This is a plan, not a design: each unit below gets its own design (and decision) when it starts, as Tripletex did (`docs/tripletex.md`).

Reading guide. Evidence is marked so nobody builds on a guess:

* **[repo]** read in this repository on 2026-11-06.
* **[docs]** read on an authority's or vendor's own pages (Skatteetaten, Tripletex's API spec as quoted in `docs/tripletex.md`).
* **[3P]** a consultancy's or directory's summary; treat as a hint until the source text is read.
* **[U]** *not verified.* A question for the authority, the vendor, an accountant or a lawyer.

Sources are listed at the end.

## 0. Summary

1. **Two goals of very different size.** Replacing Pipedrive and a CRM is a product problem: one build serves every store in the EU, no
   regulator is involved, and most of the parts exist. Replacing Tripletex is a regulated problem: bookkeeping, VAT returns, e-invoicing
   and annual accounts are national, so it is **one build per country**, and for most small companies the outside accountant chooses the
   system. Sales first and everywhere; books in Norway first, and only Norway for a long while.
2. **Why it can work at all.** Most of a store's money already starts here: invoices and credit notes without gaps (D159, Work D122),
   refunds, Stripe payouts and fees (D290), gift cards (D300), what is owed to customers (D381), purchase orders and cost history (D383),
   VAT, OSS and IOSS reports (D161), EN 16931 invoices (D403). The Tripletex and Fiken syncs (D453, D460) already decide which account and
   VAT code each of those goes to. What a webshop's books lack after that is purchases, the bank, and the reports to the authorities.
3. **The law sets the clock** (Norway, Bookkeeping Act amended June 2026, regulations 29 September 2026 [3P]): from **1 January 2027**
   sales to Norwegian businesses that can receive them must be invoiced as EHF / Peppol BIS; from **1 January 2028** the buyer's
   organisation number is on every sales document; from **1 January 2030** every business must receive e-invoices and keep its books in
   an electronic system that processes them automatically. Every small Norwegian business rethinks invoicing in 2027 and bookkeeping by
   2030: a window for a system that does both.
4. **The first unit has a deadline whatever else is decided.** Kaizena Flow books its invoices into Tripletex as vouchers, not as
   Tripletex invoices, so Tripletex does not send them as EHF. On 1 January 2027 a Norwegian store (Human Web among them, through Work)
   that invoices a business able to receive EHF has no way to send one from Kaizena Flow. B1 (EHF out through a Peppol access point) is
   needed before then.
5. **The pilot leaves Tripletex at B5, and needs B6 before NOK 5 million.** Human Web runs no payroll and keeps its own books, so it can
   leave Tripletex once the ledger, purchases, bank and the VAT return work (B2 to B5). Once its turnover passes NOK 5 million a year it
   takes an outside accountant, the owner's wife (section 4.4), so accountants' access (B6) is built and proven at Human Web before it
   opens to other stores. Payroll, through a partner (B7), is the one unit the pilot will not prove.
6. **Tripletex and Fiken stay, as the bridge.** A store keeps them until its books move to Kaizena Flow at a period boundary; during the
   pilot, Tripletex's books are the reference our ledger is compared with. No new accounting connectors (PowerOffice, Fortnox, e-conomic,
   Visma) are started: that effort goes to our own books.
7. **Human Web becomes an AS in 2027** (the owner's goal). A tax-free conversion takes effect from 1 January of its year, so the AS's
   books start on 1 January 2027 with what the ENK hands over. The AS brings what the ENK did not have: annual accounts, an audit
   threshold, and payroll if the owner takes a salary. And it gives the platform a unit every growing ENK will need: changing the
   business behind a store (B8, section 4.5).

## 1. Principles

* **Homer and Lisa.** Homer sees "3 customers to follow up today", "2 supplier invoices to approve", "VAT for September–October is
  ready: Send". Lisa reaches every stage, account, VAT code, journal entry and period lock one step away.
* **One truth for money.** A deal points to its quotes and orders and takes its value from them once one exists. The ledger is posted
  from documents (invoices, credit notes, payouts, supplier invoices, bank lines), never typed twice; a hand-made journal entry is
  Lisa's, with an attachment and a reason.
* **Nothing booked without a person, where a person is needed.** A supplier invoice read by AI is a draft until someone approves it; a
  VAT return is sent by a person; the AI proposes and explains, it never files.
* **Grounded AI, as everywhere** (`src/lib/prompt-safety.ts`): an email or supplier invoice on a timeline is untrusted text; amounts come
  from the document or from code, never from the model; every new AI manager tool means a new run of the agents' eval.
* **Shadow first.** Each booking unit runs beside Tripletex for the pilot and is compared before it becomes the record. A store has one
  system of record per period, never two.
* **Countries as packs.** The ledger itself is country-neutral; a country pack brings the chart of accounts, VAT codes, the VAT return,
  e-invoicing and year-end. Norway is the first pack.
* **Switched on per store** with store features (D178, `src/lib/store-features.ts`): a `sales` feature (EU-wide) and a `books` feature
  (offered only where a country pack exists and the store fits the ring it is in).
* **EU processing for every vendor** (access point, bank data, payroll), as CLAUDE.md requires.
* **The owner can always leave with their books**: a SAF-T export and the documents, at any time, and after closing (D171) or leaving
  (D377); books are kept for the seller's country's period (Norway 5 years, Bokføringsloven § 13(2), already in `retention_rules`, D162).

## 2. Rings: who gets what, when

| Ring | Who | Sales (S units) | Books (B units) | Needs first |
|---|---|---|---|---|
| 0 | Human Web (an AS from 2027) | S1 to S7 | B1 to B5 with an AS's year-end; B6 before its turnover passes NOK 5 million; B7 if the owner takes a salary; B8 for the conversion | the pilot's own exit criteria (sections 3 and 4) |
| 1 | Norwegian stores without employees whose owner keeps the books (Fiken's crowd) | all stores (sales opens EU-wide after ring 0) | B1 to B5 | a full year closed at Human Web; accountant's review of the Norway pack |
| 2 | Norwegian stores with an outside accountant | | B1 to B6 | B6 proven at Human Web with its accountant (section 4.4), and accountants who agree to work in it |
| 3 | Norwegian stores with payroll | | B1 to B7 | B7 (a payroll partner) |
| 4 | Stores in other countries | | their country's pack | a pack per country, chosen by where stores sign up |

B1 (EHF out) is not ring-gated: every Norwegian store that invoices businesses needs it on 1 January 2027, whether its books are ours or
not.

## 3. Sales: replacing Pipedrive and a separate CRM

### 3.1 What exists [repo]

| Part | Where |
|---|---|
| People: notes, tags, merging, import, staff-made accounts | D366, `src/server/customer-staff.ts`, `commerce.customer_notes` |
| Companies: locations, buyers and approvers, price lists, organisation numbers | D108, D321 |
| Segments and customer tags | D296 |
| Quote requests as drafts of `source = 'quote'`, *Send quote* with a pay link, decline with a reply | D431 |
| Work clients linked to customers and companies (`work_clients.customer_id`, `customer_company_id`), assignments, hours, invoices | D122, D123 |
| The support inbox, with email in through Resend (a reply address per conversation) | D216, D332, `src/server/support-inbound.ts` |
| Forms, workflows, email automations, broadcasts | D356, D298, D297 |
| Custom fields on customers and companies | D118 |
| Bookings (meetings with a time and a place) | D65 |
| The installable admin with push | D361 |
| The AI manager: `customer_insights`, follow-ups that come back to a person | D104, D318 |
| Moving in from another platform (the import pattern) | D445, D384 |

### 3.2 The units

**S1. A timeline per person and per company** (built 6 November 2026, D462). One read across what exists: orders, quotes, support conversations, emails sent, notes,
Work invoices, returns, reviews, bookings, and later deals and activities. Nothing new is stored. Homer reads it top to bottom; Lisa
filters it by kind.

**S2. Deals and pipelines** (built 6 November 2026, D464; offered to a pilot store first). A deal exists before any quote ("met them at the fair"), so it needs a small table of its own: title,
company or person, owner (a staff member), pipeline and stage, expected close date, an estimated value while nothing is linked, won or
lost with a reason. It links to quote drafts, orders and Work assignments; once one is linked, the deal's value is theirs (one truth). A
paid order or an issued Work invoice can win it. Homer gets one board with sensible stages (New, Talking, Quote sent, Won, Lost); Lisa
gets several pipelines, stage probabilities, custom fields (D118) and the time a deal has sat in a stage.

**S3. Activities.** Calls, meetings and tasks with a due time and a person; a *Today* list on the store's home; push when one is due
(D361). "Book a meeting with me" is a booking link (D65) whose booking lands on the timeline. The AI manager's follow-ups (D318) remind a
person; an activity belongs to a customer or deal and is seen by the team: both stay, each for its own job. *Built (D468), but the booking
link's meetings on the timeline.*

**S4. A leads inbox.** People who are not customers yet but asked for something: quote requests, product questions, chats, form
answers, new subscribers. One list; *Make a deal* or *Dismiss*.

**S5. Email on the timeline.** The main reason people stay in Pipedrive. First, a per-store forwarding address (`bcc-{key}@` the inbound
domain already set up for support, D332): staff copy or forward mail to it and it is filed on the matching person, company and deal by
address. Later, two-way sync with Microsoft 365 (Graph) and Gmail. Gmail's restricted scopes need Google's security assessment, renewed
yearly [U: cost and lead time], so Gmail comes last. An email's words are personal data and untrusted text: a retention rule, the
erasure list (D162) and, if AI reads them, the DPIA (`docs/dpia-ai.md`) and the chat's notice.

**S6. Sales reports.** Forecast (open value by expected month, weighted on Lisa's view), conversion per stage, won and lost per person,
time to win. In Analytics, beside Reports (D345).

**S7. Moving from Pipedrive or HubSpot.** An import by the service's API token or its CSV export: organisations to companies, persons to
customers (D366's rules: no password, email not proven, nothing emailed, nobody subscribed), deals with their pipelines and stages,
activities, notes, products matched by name or SKU. A dry run first, then a count of what came and what did not. [U: each service's
current export and API limits.]

**AI that the others cannot do.** The AI manager sees orders, payments, stock and Work hours: "who should I call today", a deal's summary
from its timeline, a follow-up email drafted from the facts, a company whose orders came every 30 days and stopped 90 days ago. New
tools need the eval run and its recording (CLAUDE.md).

### 3.3 The pilot's exit

Human Web's sales data imported (S7) and checked by the owner; one full month of selling with Pipedrive unused; nothing the team needed
was missing, or what was missing is built. Then `sales` opens to every store, EU-wide.

## 4. Books: replacing Tripletex (Norway first)

### 4.1 The rules and their dates (Norway)

| Date | What | Evidence |
|---|---|---|
| 1 January 2027 | Domestic B2B sales (not cash sales) invoiced as EHF / Peppol BIS Billing 3.0 to buyers that can receive them; foreign businesses with Norwegian bookkeeping duties are covered | [3P] KPMG, Sovos |
| 1 January 2028 | The buyer's organisation number on sales documents; sales documents always sent to buyers with bookkeeping duties | [3P] KPMG |
| 1 January 2030 | Every business with bookkeeping duties receives e-invoices; bookkeeping in an electronic accounting system that processes e-invoices automatically; other structured formats' transition ends | [3P] KPMG, Sovos |
| Exemptions | Turnover not over NOK 50 000 a year (with conditions) | [3P] KPMG |
| Now | VAT returns (mva-melding) by system: validated, then submitted through an Altinn 3 app; in 2026 the person signs in with ID-porten; a *systembruker* (a non-personal user acting for the business) is planned as the main way later | [docs] Skatteetaten |
| Now | Suppliers of end-user systems apply to Skatteetaten for access to the reporting APIs (test, then production) | [docs] Skatteetaten |
| Now | Accounting material kept 5 years after the financial year ends; contracts, correspondence and the like 3 years and 6 months | Bokføringsloven § 13(2), read for D162 |
| [U] | Whether the amended regulations put duties on the *vendor* of an accounting system (system documentation, a declaration) | to read in the regulation text |

### 4.2 What exists [repo]

Invoices and credit notes per series without gaps, frozen with a PDF (D159, D141; Work's own series, D122); EN 16931 / UBL 2.1 XML for each
(D403, generated, not sent); VAT, OSS and IOSS reports (D161); Stripe payouts and real fees (D290); gift card and store-credit liabilities
(D300, D381); purchase orders and cost history (D383); profit per order (D415); the documents read into one shape for booking and the
buckets each goes to (`src/lib/accounting-docs.ts`, `src/server/accounting-documents.ts`); Tripletex's setup from a company's chart
(`src/lib/tripletex-setup.ts`); inbound email (D332); a model that reads pictures and PDFs (D163); the retention schedule (D162).

### 4.3 The units

**B1. EHF out through a Peppol access point (by 1 January 2027; everything but the vendor built 6 November 2026, D463).** Before an invoice or credit note to a business is sent, the buyer's
organisation number is looked up in the Peppol directory (ELMA in Norway): one that can receive gets the D403 document through the
access point, the others the email and PDF as today. Each document shows *Sent as e-invoice*, *Delivered* or *Refused* with the reason.
Work invoices and shop invoices alike. Also: the organisation number on every sales document to a business (2028). The access point is a
vendor with an API, chosen by the owner (section 6); DFØ approves access points in Norway [3P]. Choose one that also serves the other EU
mandates (Belgium, Germany, Poland) [U], so the same unit carries to other countries. The same connection receives (B3).

*Pilot exit:* Human Web's Work invoices to businesses that can receive EHF go out as EHF, and one is confirmed received by a client.

**B2. Our own ledger, in shadow.** A double-entry journal: entries numbered per series, immutable once posted, corrected only by a
reversing entry; accounting periods that can be locked; a chart of accounts per store from the country pack (Norway: NS 4102, with the
SAF-T standard VAT codes); opening balances. Posted from the same documents the Tripletex sync reads, plus payouts and fees, gift cards
and store credit, and refunds. Reports: trial balance, profit and loss, balance sheet, VAT by code and period. Hand-made entries for Lisa.
The ledger also knows each store's turnover over the last twelve months, which the threshold watch reads (section 4.4).

For the pilot it runs beside Tripletex: a daily comparison, per account and period, with Tripletex's postings read back through the
client we have (`GET /ledger/posting` [docs, Tripletex's spec]); a difference is a line in *Needs you* with both sides. Opening balances
for a store moving off Tripletex or Fiken are read from their APIs at the switch; from anywhere else, a SAF-T import [U].

*Pilot exit:* three consecutive months where our ledger and Tripletex agree to the øre on every account Kaizena Flow posts to.

**B3. Purchases.** Supplier invoices in by Peppol (B1's connection), by email to a per-store address (D332's inbound), or uploaded or
photographed; an EHF's amounts are the document's, a PDF's are read by the model (D163) into a draft a person approves. A supplier
register (organisation number, account, VAT, payment terms); due dates on Homer's home; receipts and expenses from the phone; a supplier
invoice can be matched to a purchase order (D383). This is also what the 2030 rule asks for: e-invoices processed automatically.

**B4. Bank.** Three ways in, built in this order, all landing in one table of bank lines so the matching is written once:

1. **A statement file** (first, needs no contract): the owner uploads the bank's export (ISO 20022 camt.053, or the bank's CSV) [U: which
   formats DNB's netbank exports for a small business]. Works for any bank in any country, and lets the matching be built and proven at
   Human Web while the contracts below are agreed.
2. **Open banking** (the platform's way: every bank, one contract): transactions and balances through a licensed account-information
   provider in the EEA. Candidates: Neonomics (Oslo, licensed by Finanstilsynet [3P]), Tink [3P], Enable Banking [U], and Mastercard Open
   Banking, the former Nordic API Gateway that DNB's own app uses to show other banks' accounts [3P]. Kaizena Flow does not seek a
   licence of its own. The owner consents with BankID and renews the consent when asked [U: how often for business accounts in Norway;
   the EU rule is 180 days]. To ask each provider before choosing: DNB business accounts for an ENK and for an AS (no source read
   confirms it for any provider), whether the KID and the payer's reference come through, EU processing, price.
3. **DNB's bank integration** (*bankintegrasjon*, the way Norwegian accounting systems read a bank; DNB first because it is the largest
   bank and Human Web's): ordered by the business from its accounting system or in DNB's netbank (*Administrasjon → Bankintegrasjon*),
   files in ISO 20022 (statements as camt.053 in DNB's own variant) over DNB File Gateway (SFTP) [3P]. DNB lists accounting systems
   that offer ordering it, among them DNB Regnskap, Fiken, Cordel, Continia and Hogia [3P]. It adds what open banking may not carry:
   the detail of incoming payments for matching and, later, paying supplier invoices from Kaizena Flow with approval in the bank [U:
   which messages a small business gets]. Becoming an accounting system DNB offers it for is an agreement with DNB, not a public
   sign-up; no public process was found (contact: DNB's technical integration team) [U: terms, price, lead time]. DNB sells its own
   accounting system (DNB Regnskap), so this is a business conversation as much as a technical one. Other banks (SpareBank 1, Nordea,
   Handelsbanken) have their own [U].

Matching: lines to invoices by KID, invoice number and amount, Stripe payouts to their payout (D290), supplier payments to supplier
invoices; what does not match waits in *Needs you*. Paying supplier invoices (through the bank integration, or payment initiation
through the provider) later.

*Pilot exit:* Human Web's DNB account read every day for a month through route 2 or 3, every line matched or explained.

Not a reason to change banks: the platform must read DNB for other owners whatever Human Web does, and the pilot is the place to find
out how well it can.

**B5. Reports to the authorities, and the year.** The VAT return through Skatteetaten's API (built from B2, validated by their
validation API, signed in by the person with ID-porten in 2026's way, a *systembruker* when Skatteetaten offers it); a corrected return
when one is needed (a new complete return). SAF-T Financial export. Year-end: closing entries, simple depreciation, accruals, the figures
for the annual accounts and the business's tax return [U: what can be submitted by API for an AS, what is filed by hand from our
figures]. An ENK without a duty to file annual accounts, as Human Web is until its 2026 year-end, ends its year in the business's part of the owner's own
tax return (*næringsspesifikasjon*) [U: confirm, and whether it goes by Skatteetaten's tax return API]; an AS also files annual
accounts with Brønnøysund and is audited unless it may opt out (section 4.4).

*Pilot exit, and the ring 0 finish line:* one VAT period computed by us and compared with the return filed from Tripletex; the next filed
from Kaizena Flow; then a full financial year closed in Kaizena Flow (at the earliest the AS's first year, 2027, kept beside Tripletex;
section 4.5). Human Web stops paying for Tripletex.

**B6. Accountants (proven at Human Web, then the gate for ring 2).** An accountant is a person with access to many clients' stores: a
role template *Accountant* (today's templates are Orders, Products, Marketing, Content, Analytics, Support agent and Read-only,
`src/lib/permissions.ts`) with new `books:read`/`books:write` permissions, an invitation from the owner, and a screen across all their
clients: VAT due, bank lines not matched, supplier invoices not approved, periods not locked. The accountant locks a period, and the
owner cannot post into it until the accountant opens it again; everything the accountant does is in the audit log under their name
(D158). Built and proven at Human Web, with the owner's wife as its accountant, before Human Web's turnover passes NOK 5 million
(section 4.4). Then a partner programme for accounting firms: they are both the gate and the channel.

**B7. Payroll (gate for ring 3).** Through a partner, not built: pay slips, a-melding, holiday pay, tax deductions and pension have their
own rules and their own Skatteetaten reporting. The partner's postings come into the ledger. [U: which partner, in the EU, with an
API.]

### 4.4 The pilot's accountant, and the thresholds that change a store's duties

**The owner's rule** (6 November 2026): when Human Web's turnover passes **NOK 5 million over twelve months**, Human Web takes an
outside accountant, and that is the owner's wife, an accountant. What it means for the plan:

1. **B6 is ready before then**, and Human Web is where it is proven: the owner invites the accountant, the accountant gets the
   *Accountant* role, locks periods, reviews the VAT return before the owner sends it, and closes the year.
2. **A threshold watch** (with B2): the ledger's turnover over the last twelve months against the thresholds that change a store's
   duties. Homer's home says it before it happens, for example "Turnover NOK 4.3 million over the last 12 months: invite your accountant
   before NOK 5 million", and the store checkup (`accountingAttention()`) carries it, so the AI manager's checkup and the briefing say it
   too. An owner can add a threshold of their own (Human Web's NOK 5 million); the country pack brings the legal ones.
3. **Before then, as a design partner, if the owner's wife agrees**: reviewing the Norway pack (section 6, item 4) and shaping B6 from
   read-only access to the pilot's books. Whether and when is the owner's and the wife's choice; nothing in the plan waits for it.

**The law nearby.** No rule was found that requires an accountant at NOK 5 million; this is the owner's choice. The rules that sit near it:

| Rule | What it means here | Evidence |
|---|---|---|
| Doing bookkeeping for others *as a business* requires authorisation as an accountant (*regnskapsførerloven* § 1); the regulation's exceptions found concern groups of companies | The owner's wife keeps Human Web's books as an authorised accountant, or the arrangement is checked first | [3P] search summary of the act and Skatteetaten's notices; [U] whether she is authorised, and whether keeping a spouse's books unpaid falls under the rule |
| A spouse is a close relation (*nærstående*) under the auditor's independence rules | The owner's wife can be the accountant but never the auditor, if Human Web ever needs one | [3P] Stortinget's committee report on the auditors' act |
| An AS may opt out of audit with operating revenue under NOK 7 million, a balance under NOK 27 million and on average no more than ten full-time employees; the two amounts are set in a regulation | Watched for every AS on our books; Human Web's from 2027 (section 4.5) | [3P] Stortinget 2025–2026, Brønnøysund 2023; [U] check the current regulation |
| An ENK files annual accounts (and is audited) only above size limits on assets or employees | Watched for every ENK on our books; Human Web is far below them today | [U] read *regnskapsloven* § 1-2 and the auditors' act for the numbers |
| NOK 50 000 a year: the e-invoicing and electronic bookkeeping exemptions (section 4.1) | The lowest threshold in the pack | [3P] KPMG |

### 4.5 Human Web becomes an AS in 2027, and B8

**The owner's goal** (6 November 2026): Human Web goes from an ENK to an AS in 2027.

**How it is done, as far as read.** A tax-free conversion (*skattefri omdanning*, skatteloven § 11-20 and FSFIN §§ 11-20-1 to
11-20-11): the ENK's business is transferred to a newly formed AS in return for its shares, whose cost for tax is the values
transferred; the conversion always takes tax effect from 1 January of its year, so it is planned in the autumn before; the business must
exist when it is transferred; the ENK need not transfer its debts [docs: Skatteetaten; 3P: KPMG, Sticos, a Skatteklagenemnda decision as
summarised]. [U: by when in 2027 the AS must be founded to keep the 1 January effect (FSFIN § 11-20-3); whether the statement on the
contribution in kind must be confirmed by an auditor (aksjeloven § 2-6), who then could not be the owner's wife (section 4.4).] An
adviser or accountant plans the conversion; this plan only follows it.

**What changes for Human Web, and so for the pilot:**

| Change | What the plan does |
|---|---|
| The ENK's last year is 2026, ending in the owner's tax return | Done from Tripletex, as today |
| The AS's books open on 1 January 2027 with what the ENK handed over | B2 runs in shadow on the AS's books from their opening balance, a clean start to compare with Tripletex (where the AS is a new company) |
| Annual accounts to Brønnøysund, the AS's tax return, the shareholder register statement, the board's and the general meeting's minutes | B5 covers an AS before the AS's first year ends; 2027 is the first full year that can be closed beside Tripletex |
| An audit unless the AS may opt out (under NOK 7 million revenue, section 4.4), decided by the general meeting | The threshold watch adds it; the owner's NOK 5 million rule stays |
| A salary to the owner makes the AS an employer: an a-melding every month, tax withheld, employer's contribution, holiday pay [U: occupational pension for a sole owner-employee]; dividends alone do not | The owner's choice with their adviser. A salary makes B7 (payroll through a partner) a pilot unit, ready before the first salary |
| A new organisation number, VAT registration [U: from which date], and a bank account in the AS's name | B1 registers the AS for EHF (ELMA); B4's consent and DNB's bank integration are set up for the AS's account |
| Invoices from the AS from the change: its name, numbers and its own number series [U: whether it may continue the ENK's] | B8 |
| Stripe: a new legal entity [U: whether Stripe changes the connected account's business or a new account is needed] | B8's checklist |
| Customers' and clients' data held by the AS: the privacy notice, and clients told who invoices them now [U: a lawyer on the transfer] | B8's checklist |

**B8. Changing the business behind a store** (for every owner; proven at Human Web in 2027). Every ENK on the platform that grows meets
this, so it is a unit of its own, not a one-off for the pilot. Today a store has one legal name, organisation number and VAT number
(`stores.legal_name`, `stores.organisation_number`, `store_tax_profile.vat_number`) [repo]. Issued invoices and credit notes keep the
seller's details they were issued with (D159), so past documents are safe, but reports by period and the ledger must know which business
a period belongs to. B8: the business behind the store changes from a date; from that date new documents carry the new business and its
own series; the books close for the old business and open for the new one with the balance handed over (B2); VAT returns and reports
split at the date; and a checklist of what must be set up again (bank, Stripe, Peppol and ELMA, an accounting connection, payment
providers, the privacy notice, Kaizena Flow's own plan), each step with its button where Kaizena Flow can do it. Homer sees "Your business
is becoming an AS", one step at a time; Lisa sees every date and setting.

## 5. Tripletex and Fiken from here

* Kept and supported: they are how a store keeps its accountant's system while trying ours, and how the pilot is checked.
* Work in flight is finished only as far as the bridge needs it (the AI manager's two tools, which wait for an eval run). Payments read
  back (T2) is replaced by B4 for stores on our books; build it only if ring 2 stores stay on Tripletex for long.
* A store moves at a period boundary (a VAT term or a year): the sync stops for documents dated after it, our ledger starts from the
  balances read at the switch. Never both as the record for the same period.
* No new accounting connectors.

## 6. What only a person can do

1. **Choose a Peppol access point and sign with it** (EU processing, API, price, the countries it serves). Needed now for 1 January.
2. **Apply to Skatteetaten for API access** (test, then production) as a supplier of an end-user system.
3. **Bank access** (B4): put B4's questions to two or three account-information providers and sign with one; ask DNB's technical
   integration team (tci@dnb.no) how an accounting system becomes one DNB offers bank integration for, on what terms and how soon.
   Human Web's own DNB adviser can open that door.
4. **An authorised accountant to review** the Norway pack (chart, VAT codes, what each document posts) and B5's return before ring 1.
   The first choice is the owner's wife, Human Web's accountant from NOK 5 million (section 4.4), if willing and authorised [U].
5. **A lawyer**: Kaizena Flow's terms as a bookkeeping system; the vendor's duties, if any, under the amended regulations; the data
   processing terms for the access point, the bank provider and, later, payroll.
6. **For the pilot**: where Human Web's sales are kept today and access to export them (S7); Tripletex stays connected through B5.
7. **The conversion to an AS** (section 4.5): an adviser or accountant to plan it this autumn, since its tax effect is from 1 January;
   the choice between a salary and dividends, which decides whether payroll (B7) is a pilot unit; an independent auditor if the
   contribution in kind needs one confirmed.

## 7. Order of work

Two tracks side by side. External lead times (the access point's contract, Skatteetaten's access, the bank provider's contract) decide
the dates more than the code does, so section 6's items 1 to 3 start now.

| Order | Sales track | Books track |
|---|---|---|
| Now | S1 timeline (built, D462) | **B1 EHF out** (deadline 1 January 2027; built but the access point's adapter, D463) |
| Next | S3 activities (built, D468) | B8 before the AS issues its first invoice; B2 the ledger in shadow on the AS's books from their opening balance, with B4's statement upload |
| Then | S4 leads, S5 email (forwarding address), S7 import; Human Web leaves Pipedrive | B3 purchases, B4 bank |
| Then | S6 reports; `sales` opens to every store | B5 the VAT return, SAF-T, year-end; Human Web leaves Tripletex after a full year |
| Then | | B6 accountants, ready before Human Web's turnover passes NOK 5 million (the threshold watch says when it is near); then ring 2 |
| Later | S5 Microsoft 365 and Gmail sync | B7 payroll partner (ring 3), a second country pack (ring 4) |

## 8. Open questions [U]

1. Do the amended Bookkeeping Regulations (29 September 2026) put duties on the vendor of an accounting system?
2. When can a *systembruker* send the VAT return, so no one signs in with ID-porten each time?
3. What of the annual accounts and the business's tax return can be submitted by API for a small AS?
4. Which access point serves Norway and the other EU e-invoicing mandates, with an API and EU processing, at what price?
5. Account-information providers: DNB business accounts (ENK and AS), the KID in the transaction data, consent length, payment
   initiation, price. DNB's bank integration: the terms for an accounting system, the messages a small business gets, lead time.
6. Gmail's security assessment: cost and time.
7. Pipedrive's and HubSpot's export and API limits for S7.
8. Is the owner's wife an authorised accountant, and does keeping a spouse's books need the authorisation if it is unpaid?
9. The conversion (section 4.5): by when in 2027 the AS must be founded to keep the 1 January effect; whether the contribution in kind
   needs an auditor's confirmation; the AS's VAT registration date; whether the AS may continue the ENK's invoice series; what Stripe
   requires for a new legal entity; whether a sole owner-employee brings occupational pension.
10. The size limits above which an ENK files annual accounts and is audited, and how an ENK's year-end reaches Skatteetaten by system.

## Sources

* Norway's amended Bookkeeping Act and regulations: KPMG, *Norway: Final digital reporting and e-invoicing regulations* (October 2026),
  <https://kpmg.com/us/en/taxnewsflash/news/2026/10/norway-final-digital-reporting-e-invoicing-regulations.html>; KPMG, *Norway: Mandatory
  digital bookkeeping and e-invoicing requirements enacted* (June 2026),
  <https://kpmg.com/us/en/taxnewsflash/news/2026/06/tnf-norway-mandatory-digital-bookkeeping-and-e-invoicing-requirements-enacted.html>;
  Sovos, <https://sovos.com/regulatory-updates/global-vat/norway-regulation-on-mandatory-e-invoicing-and-digital-bookkeeping-adopted/>.
* Skatteetaten, accounting systems and the reporting APIs:
  <https://www.skatteetaten.no/om-skatteetaten/fremtidens-innkreving/systemleverandorer/regnskapssystem/>; applying for access:
  <https://www.skatteetaten.no/samarbeidspartnere/sluttbrukersystemer/sbs-nyheter/her-kan-du-soke-om-tilgang-til-tjenester-for-innrapportering-til-skatteetaten/>;
  Altinn 2 to Altinn 3 for mva and skattemelding (ID-porten in 2026):
  <https://www.skatteetaten.no/en/our-partners/end-user-systems/sbs-nyheter/nyttig-a-vite-om-overgangen-fra-altinn-2-til-altinn-3-for-de-moderniserte-losningene-mva-og-skattemelding/>;
  system users: <https://www.skatteetaten.no/samarbeidspartnere/reetablering-altinn/systemleverandor/>; the VAT return API:
  <https://skatteetaten.github.io/mva-meldingen/english/api>.
* Peppol in Norway: DFØ as Peppol authority, <https://anskaffelser.no/public-procurement/e-procurement/peppol>; country profile,
  <https://peppol.org/learn-more/country-profiles/norway/>.
* Account information: Neonomics, <https://openbankingtracker.com/neonomics>; Neonomics and Tink compared,
  <https://openbankingtracker.com/api-aggregators/neonomics/vs/tink>; aggregators covering Norway,
  <https://www.openbankingtracker.com/api-aggregators?country=NO>; DNB's app on Nordic API Gateway,
  <https://finextra.com/pressarticle/77782/dnb-joins-nordic-api-gateway> (all [3P]).
* DNB's bank integration (read through search summaries; the pages refused a direct fetch):
  <https://www.dnb.no/bedrift/konto-kort-og-betaling/bankintegrasjon.html>, <https://www.dnb.no/bedrift/dagligbank/bankintegrasjon>;
  DNB Regnskap's integrations, <https://www.dnb.no/bedrift/dagligbank/regnskap/nyttig-informasjon/integrasjoner>.
* Bookkeeping retention: Bokføringsloven § 13, <https://lovdata.no/lov/2004-11-19-73/§13> (as read for `docs/wave-1g-gdpr.md`).
* Human Web's entry in the Central Coordinating Register: <https://data.brreg.no/enhetsregisteret/api/enheter/915429777>.
* Converting an ENK to an AS: Skatteetaten,
  <https://www.skatteetaten.no/person/skatt/hjelp-til-riktig-skatt/aksjer-og-verdipapirer/om/fastsette-inngangsverdien/skattefri-omdanning-fra-enkeltpersonsforetak-eller-selskap-med-deltakerfastsetting-til-aksjeselskapa/>;
  KPMG, <https://kpmg.com/no/nb/innsikt/skatt-regulatorisk/skattefri-omdanning-aksjeselskap.html>; Sticos,
  <https://www.sticos.no/fagstoff/6-praktiske-tips-ved-omdanning-til-aksjeselskap>; Skatteklagenemnda,
  <https://www.skatteetaten.no/en/rettskilder/type/vedtak/skatteklagenemnda/bfu---sporsmal-om-skattefri-omdanning-av-enkeltpersonforetak-til-aksjeselskap/>.
* Audit thresholds for an AS: Stortinget, Innst. 165 S (2025–2026),
  <https://stortinget.no/globalassets/pdf/innstillinger/stortinget/2025-2026/inns-202526-165s.pdf>; Brønnøysund's answer of April 2023,
  <https://www.regnskapnorge.no/contentassets/9ad24c8fdd874a849914a5ea0dcfd761/230425---svar-fra-brreg---endring-av-terskelverdier-for-revisjon.pdf>;
  Skatteetaten, <https://www.skatteetaten.no/en/rettskilder/type/kunngjoringer/terskelverdiene-for-revisjonsplikt-justeres/>.
* Accountants' authorisation: Skatteetaten,
  <https://www.skatteetaten.no/en/rettskilder/type/skattedirektoratets-meldinger/regnskapsforeres-plikter-etter-lov-og-forskrift-om-autorisasjon-av-regnskapsforere2.-oversendelse-av-opplysninger-til-finanstilsynet-nar-regnskapsforere-har-misligholdt-sine-plikter/>;
  a spouse as an auditor's close relation: Stortinget, Innst. O. nr. 44 (2005–2006),
  <https://stortinget.no/no/Saker-og-publikasjoner/Publikasjoner/Innstillinger/Odelstinget/2005-2006/inno-200506-044/?lvl=0>.
* Tripletex's API: `docs/tripletex.md` sections 1.1 and 1.2 and its Appendix B.
