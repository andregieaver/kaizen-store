# Choosing a Peppol access point for Kaizena Flow

Read 7 November 2026. Answers question 4 in section 8 of `docs/own-books-and-sales.md`. Only the vendor's adapter is missing (D463).

## 1. What the deadline really is

**Norway (checked against Skatteetaten and Lovdata):**

- **Public sector, since 2 April 2019.** Public buyers must require EHF / Peppol BIS Billing 3.0, and may hold back payment until
  one arrives.
- **1 January 2027: sending.** A business that keeps books must send e-invoices (EHF or Peppol BIS Billing 3.0 or later) to other
  businesses that keep books. Until 2030 this applies only when the buyer is registered in ELMA/Peppol; others may still get a PDF.
  Until 2030 other structured formats (EDIFACT, E2B) are also allowed.
- **1 January 2028.** The buyer's organisation number goes on every sales document, and the document is always sent to the buyer.
- **1 January 2030: receiving.** Every business must receive e-invoices and keep its books in an electronic system (exempt up to
  NOK 50,000 turnover a year).
- Adopted **29 September 2026** (FOR-2026-09-29-1933). The repo's date of 1 January 2027 is correct.

**What this means here:** the access point must be live for Human Web's first invoice of 2027. When Human Web becomes an AS, its new
organisation number must be registered and verified again.

**Other EU countries (brief, from secondary sources):** Belgium has required B2B invoices through Peppol since 1 January 2026.
Germany: receive since 2025, send from 2027 (over €800k turnover) and 2028 (all); email is allowed. France: all receive and large
businesses send from 1 September 2026, small ones send from 1 September 2027, always through an accredited platform (*plateforme
agréée*, PA), so Peppol alone is not enough. Poland's KSeF is a government system, not Peppol: large businesses from 1 February
2026, the rest from 1 April 2026, micro-businesses from 2027. These rules mostly cover businesses established there.

## 2. Comparison

All five are on OpenPeppol's certified list (3 November 2026), and any certified provider reaches Norwegian receivers. They were
picked for an API built for software that sends for many companies.

| | **Recommand** (BE) | **Storecove** (NL) | **Inexchange / Maventa** (FI/SE, Visma) | **Invopop** (ES) | **Tickstar / Galaxy Gateway** (SE, owned by Xero) |
|---|---|---|---|---|---|
| Norway | Guide for Norway. Registers each company in ELMA and checks it against Enhetsregisteret | Supports EHF. No Norway page found | Sends and receives EHF. Registers each company in ELMA automatically | Guide for Norway. Registers each company in ELMA | Norway not mentioned |
| Other countries | France through a partner PA (Arratech). Germany, Netherlands. Poland and Italy "partially supported" | Own French PA accreditation. Italy (SDI). Poland claimed, but no KSeF connection described | Germany, Poland, France, Belgium, the Nordics. Details not given | Italy (SDI), Poland (KSeF), France, Germany and more, as paid "apps" | Over 20 countries |
| Many stores in one account | Yes: unlimited companies, documents pooled | Yes: one "legal entity" per company; approval takes up to a day | Yes: partner account, one company each | Yes: "parties" | Yes: an API for managing participants |
| Identity checks on each store (KYC) | Built in: ID check (Didit) plus signing rights in Enhetsregisteret | Not described | Not described | Proof of ownership; takes up to 72 hours | Not described |
| Takes our own UBL unchanged | Yes (raw XML) | Yes (claimed) | Yes (Peppol BIS 3.0 files) | No: sends from its own JSON format (GOBL) | Yes (accepts any document type) |
| Delivery status / receiving | Webhooks / yes | Webhooks / yes | Webhooks (delivered, failed, received) / yes | Job status; webhooks not described / yes | API; webhooks not described / yes |
| Test environment | Free "playgrounds" plus the Peppol test network | 30-day sandbox | Free test account | Sandbox | Free trial |
| Where data is kept | EU. Email notices go through a US provider (Postmark) under standard contractual clauses (SCCs). DPA included in the terms | Ireland (AWS), "all servers in the EU". DPA not published | Not on the pages read: ask. A third party's papers say Finland and EU (AWS) | EU (Belgium, Germany). DPA published | Not stated ("multi-region") |
| Price at low volume | **Published:** free for 25 documents a month, then €0.30 each. €29 a month includes 200, €99 includes 1,000. No setup fee, no commitment | **Not published.** Priced per entity. Production starts after a signed contract | **Partner price not published.** Direct customers in Norway pay NOK 3.20 per invoice sent or received at 0–49 a month, falling to 2.20. No fixed fees | **Published, hard to compare.** Free "Dev" plan (200 Pops, 1 user), "Pro" €500 a month. My sum: about €0.08 per Peppol send and €4–8 per registered company a month | **Not published** |
| How fast to start | Self-serve sign-up today | Sales process | Self-serve test account, then sales. Their record from start to finish: under two days | Self-serve | Self-serve trial, then sales |

**Not shortlisted:** ecosio, Pagero, Basware, Edicom, Avalara, Banqup and Logiq (NO) are certified but sell to large companies
through sales, with no API prices. Qvalia is €39 a month per company (API, 100 messages); platform terms on request. FakturaAPI (NO)
is not itself certified.

## 3. Recommendation

**First choice: Recommand.**
- Built for this shape: one account, a company per store, volume pooled, so the price per document falls as stores join.
- Identity checks on each store's representative are built in (Enhetsregisteret), so Kaizena Flow never handles ID papers.
- Takes the UBL we already produce (D403, D463) unchanged. Webhooks report delivery and incoming invoices; ELMA registration
  serves receiving (B3) later.
- EU hosting, DPA in the terms, ISO 27001 since October 2026. Public prices; Human Web fits the free tier. Can be live this week.
- Open-source code, which lowers lock-in.
- Risks: young, small company (BRBX BV, Hasselt); Poland and Italy only partly covered; one email provider in the US.

**Fallback: Storecove.**
- Ten years old, its own French PA accreditation, data in Ireland, an API for many legal entities with webhooks.
- Against it: no public prices and a signed contract first, so open talks now in case Recommand fails a test.

**If a large Nordic vendor matters more than public prices, also ask Inexchange (Maventa, Visma)**, the established partner API in
Norway, with a test account today.

## 4. Questions to ask before signing

1. Can we send our own Peppol BIS 3.0 UBL unchanged? Do you reject a resend that carries the same reference of ours?
2. What do webhooks report (handed over, refused and why), and how long do you retry?
3. How is each store's representative verified (Norwegian ENK and AS), how long does it take, and can it carry our brand?
4. What happens when Human Web's organisation number changes (ENK to AS)? How is a store moved to another access point (SMP
   migration) if we leave?
5. Full price: per document sent and received, per company a month, setup, minimum, notice period; the cost at 1, 50 and 500 stores?
6. Where is data stored and processed, which subprocessors are outside the EEA, the DPA, and how long are documents kept?
7. Which countries do you cover yourselves and which through partners: France (PA), Germany, Belgium, Poland (KSeF), Italy (SDI)?
8. Uptime commitment (SLA), support hours, status page?
9. Can we be in production, with Human Web verified, before 1 January 2027?

## 5. Sources (all read 7 November 2026)

- Skatteetaten, regulations on digital bookkeeping and e-invoicing (30 Sep 2026): https://www.skatteetaten.no/en/rettskilder/type/uttalelser/uttalelser/forskrifter-til-lovendringer-om-digital-bokforing-og-e-fakturering/
- Lovdata, FOR-2026-09-29-1933: https://lovdata.no/dokument/LTI/forskrift/2026-09-29-1933
- Lovdata, e-invoices in public procurement (FOR-2019-04-01-444): https://lovdata.no/dokument/SF/forskrift/2019-04-01-444
- DFØ as Peppol Authority (updated 15 Dec 2025): https://anskaffelser.no/nb/public-procurement/e-procurement/peppol
- OpenPeppol certified service providers (list of 3 Nov 2026): https://peppol.org/members/peppol-certified-service-providers/
- EU mandates (secondary): https://www.invoicenavigator.eu/answers/eu-e-invoicing-requirements-2026 , https://finbite.eu/en/e-invoicing-mandates-europe-2026/
- Recommand: https://recommand.eu/en/pricing , https://docs.recommand.eu/getting-started/norway/platform/sending.mdx , https://recommand.eu/en/security , https://recommand.eu/en/legal/subprocessors , https://recommand.eu/en/countries
- Storecove: https://www.storecove.com/us/en/solutions/e-invoicing-api , https://www.storecove.com/us/en/mystorecove/faq/ , security and privacy PDFs at https://www.storecove.com/fileadmin/editors-filemount/documents/ , https://www.storecove.com/blog/en/storecove-accredited-as-plateforme-agreee/ , https://www.storecove.com/fileadmin/Your_Invoice_Our_Envelope.pdf
- Inexchange / Maventa: https://inexchange.com/en/solutions/partner-api , https://documentation.maventa.com/services-and-reach/norway/ , https://documentation.maventa.com/peppol-api/ , https://documentation.maventa.com/integration-guide/integration-tools/webhooks/ , Norway price list 1-2026: https://maventa.com/hubfs/Pricing/Direct%20pricelists/Maventa%20price%20list%20-%20Direct%20customers%20-%20NO%20-%201-2026.pdf , https://maventa.com/support/update-to-our-subprocessor-list
- Invopop: https://www.invopop.com/pricing , https://docs.invopop.com/guides/no-peppol , https://docs.invopop.com/apps/peppol , https://invopop.com/legal-documents
- Tickstar: https://tickstar.com/services/peppol-access-point/ , https://tickstar.com/faqs/ , https://www.accountingtoday.com/news/xero-to-buy-swedish-e-invoicing-company-tickstar
- Others: https://qvalia.com/pricing , https://fakturaapi.no/ , https://amili.no/no/bestill-aksesspunkt
