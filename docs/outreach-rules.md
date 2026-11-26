# Contacting businesses by country: the rules the outreach tool would follow (draft)

Email plan P5.3 (`docs/audits/email-marketing-2026-11.md`, phase 5, D720). Written 24 November 2026, before any of phase 5 is built.

> **Draft for the owner and a lawyer.** It sets out, for each country, what the outreach tool would be allowed to do and why we think
> so, with the sources we read. It does not conclude that anything is lawful. Every row marked *to verify* is a point we could not
> confirm from the primary text. The lawyer's view is to be written in beside each row, and the code follows the rows as the lawyer
> leaves them. Nothing in phase 5 is switched on before that.

Related: `docs/audits/email-marketing-2026-11.md` (phase 5's steps P5.1 to P5.9), `docs/dpia-recordings.md` (the same kind of draft
for recordings, read by a lawyer on 18 November 2026).

---

## 1. What the tool would do, and what it would never do

The tool helps a store, and first Kaizena Flow itself (P5.8), find **companies** that might want what it sells, and write to them one
at a time.

- **It finds companies, not people.** Candidates come from public company registers (P5.1: Norway's Enhetsregisteret, Denmark's CVR,
  and the like), filtered by industry code, place, size and age.
- **It contacts a company only by a route the company publishes for enquiries.** That is its general address (`post@`, `info@`,
  `kontakt@`) or a contact form, read from its own website (P5.2).
- **It never collects, guesses or buys a person's address.** No scraping of LinkedIn or similar, no `firstname.lastname@` patterns,
  and no bought lists.
- **One email at a time.** Each is written for that company from what its own site says, sent from the store's own domain on a
  separate outreach subdomain, plain text, signed by a person. It says where the address came from and how to say no (P5.5).
- **A no is final, everywhere.** A reply asking to stop, the link in the email, or a complaint puts the address and the company's
  domain on one do-not-contact list shared by every store and the platform, checked before every send (P5.6).
- **The model never sends.** The owner approves each email.

The questions for the lawyer are therefore narrow. For each country, may a business send **one first marketing email**, without
prior consent, to **another company's general enquiry address**, and on what conditions?

## 2. The rules that apply everywhere in the EU and EEA

These hold in every country below; the country rows only add to them.

| Rule | What it means for the tool | Source |
|---|---|---|
| A named person's work address is personal data | We avoid collecting any. A general address like `post@firma.no` is usually not personal data, but one that reaches a single named person (a sole trader's) may be. | GDPR art. 4(1) |
| A lawful basis is needed for any personal data kept | Legitimate interest, with a written balancing test per campaign (P5.4). Consent is not the basis, since we would not have it. | GDPR art. 6(1)(f) |
| People must be told where their data came from | Within a month, and at the latest at the first contact: the first email says what was kept, where it came from, why and for how long. | GDPR art. 14(1)-(3) |
| A no to direct marketing must always be honoured | Stopped at once and kept on the do-not-contact list. | GDPR art. 21(2)-(3) |
| Keep only what is needed, only as long as needed | Delete a prospect 90 days after the last contact with no answer. | GDPR art. 5(1)(c) and (e) |
| The ePrivacy rules on marketing email are national | Each country below sets its own rule for email to businesses. | Directive 2002/58/EC art. 13 |

**A warning case.** In December 2024 the CNIL fined KASPR €240,000. KASPR's browser extension collected the contact details of
LinkedIn users, kept them too long, and told the people concerned late and in English only. The tool is designed so that none of this
can happen: no personal profiles, short retention, and the notice in the first email, in the country's language.

## 3. The country rules

Each row reflects what we read; *to verify* marks what we could not confirm from the primary text. The proposed rule for the code is in
section 4.

| Country | A company's general address | A named employee's work address | Our reading | Sources |
|---|---|---|---|---|
| **Norway** | Allowed without consent, with a clear way to say no. | Consent needed: an employee is a natural person under § 15. | § 15 protects natural persons, so email to a company's general address is not caught by the consent rule. *To verify:* Forbrukertilsynet's current guidance on employees' own work addresses. | Markedsføringsloven § 15; Forbrukertilsynet, *Veiledning om markedsføring via e-post, SMS o.l.* (2018) |
| **Sweden** | Allowed without consent, with a clear way to say no in every email. | Probably allowed when the address belongs to the employer. *To verify.* | 19 § requires consent for natural persons only; 20 § requires an opt-out address in marketing to legal persons too. | Marknadsföringslag (2008:486) 19-20 §§; prop. 2003/04:43 |
| **Denmark** | Consent needed. | Consent needed. | § 10 covers businesses as well as consumers: a first marketing email to a company needs its prior consent. The tool would not email Danish companies cold. | Markedsføringsloven § 10; Forbrugerombudsmanden, *Vejledning om spamforbuddet* (2021) |
| **Finland** | Probably allowed unless the company has refused. *To verify.* | Consent needed. *To verify.* | The 2014 act splits natural persons (consent) from legal persons (opt-out). We could not confirm the wording of §§ 200 and 202. | Laki sähköisen viestinnän palveluista (917/2014) §§ 200-203 |
| **Germany** | Consent needed. | Consent needed. | § 7 UWG treats email advertising without prior express consent as an unacceptable nuisance, to businesses as well as consumers. A published address is not consent. Sources differ on whether it is § 7(2) no. 2 or no. 3; *to verify* against the current text. The tool would not email German companies cold. | UWG § 7(2)-(3); IHK guidance; LG Nürnberg-Fürth, 4 HK O 655/21 (2022) |
| **France** | Allowed without consent when the message relates to the recipient's work, with a way to say no. *To verify.* | Allowed on the same conditions, as a professional acting in their role. *To verify.* | Secondary sources say L34-5's consent rule does not reach a professional addressed about their profession. We did not find the CNIL's own wording of this. | CPCE art. L34-5; CNIL, *La prospection commerciale par courrier électronique* |

**Other channels.** Phone and letters have their own rules, such as Norway's Reservasjonsregisteret and Denmark's Robinson list. The
tool would not phone or post anything in its first version, so they are listed here only to be decided later.

**Other countries.** Each EU and EEA country gets its own row, read the same way, before the tool may contact a company there. Until a
row is read by the lawyer, the tool treats the country as *consent needed* and contacts no one there.

## 4. The rule the code would follow

`src/lib/outreach-rules.ts` (P5.3) would hold one entry per country, as the lawyer leaves the rows above:

```ts
type Route = "allowed_with_opt_out" | "consent_first" | "not_at_all";
type CountryRule = {
  country: string; // ISO 3166-1, such as "NO"
  generalAddress: Route; // a company's published enquiry address
  personalWorkAddress: Route; // never collected by the tool; kept for completeness
  readBy: string | null; // who read the row, and when; null means not yet read, so treated as consent_first
  sources: string[];
};
```

From the reading above, before the lawyer's view:

- **Norway, Sweden:** a general address is `allowed_with_opt_out`.
- **France, Finland:** a general address is `allowed_with_opt_out` once the *to verify* points are confirmed; `consent_first` until then.
- **Denmark, Germany:** `consent_first`, so the tool would not email cold.
- **A personal work address:** never collected, whatever the row says.
- **A row with no `readBy`:** treated as `consent_first`, so the tool contacts no one in a country the lawyer has not read.

## 5. Questions for the lawyer

1. For each row in section 3, is our reading right, and what conditions must the first email meet (how to say no, who the sender is,
   the GDPR art. 14 notice)?
2. A sole trader's general address can be the owner's own (`kari@karisbakeri.no`). Should the tool treat sole traders (ENK in Norway,
   enskild firma in Sweden) as natural persons and leave them out entirely?
3. Is legitimate interest a sound basis for keeping a company's general address for up to 90 days after the last unanswered contact,
   with the balancing written per campaign (P5.4)?
4. Is one shared do-not-contact list across all stores, kept as hashes of the address and the company's domain, acceptable?
5. The platform would prospect for itself first (P5.8), as the sender of its own emails. When a store uses the tool, who is the
   controller of the prospect data, the store or Kaizena Flow, and what agreement does that need?
6. Which countries should be read next, after the six above?

## 6. The owner's positions, and the lawyer's view still to come

**The owner's positions (26 November 2026, Legal reviews, every point).** Written by the owner, not a lawyer; each says *subject to legal
confirmation*. In code as `src/lib/outreach-rules.ts` (D906), where no row lets anything be sent until a lawyer's reading is recorded.

| Point | The owner's position |
|---|---|
| Norway | Allowed to a verified general enquiry address, one to one, relevant to the company, the sender named, a free way to stop. Named employees, sole traders and other natural persons excluded. *The view's last line names Sweden; read as Norway, as the rest of it and section 3 say. The owner confirms.* |
| Sweden | The same as Norway. |
| Denmark | Consent first. No cold email to any Danish business, general addresses included, and never a first email to ask for consent. |
| Finland | Allowed to verified legal entities that have not refused such marketing, the sender named, an easy free way to stop. Sole traders and addresses naming a person excluded. |
| Germany | Consent first. A published or general address is not consent. |
| France | Allowed when the email is about the recipient's professional activity, the sender named, the source and purpose said, a free way to stop. General addresses preferred; named employees excluded unless reviewed. |
| Q1, the first email | The sender, the company and the purpose said; where the address came from; the GDPR art. 14 notice where it applies; a free, working way to say no; no deceptive subject, false personalisation or implied relationship; relevant to the company; approved by the owner one by one. The country rule is combined with what the recipient and the address are. |
| Q2, sole traders | Left out by default: Norway's ENK, Sweden's enskild firma and their kind elsewhere, until a country's rules are read for them. |
| Q3, legitimate interest | Possible for limited B2B prospecting with a balancing test per campaign. 90 days after the last unanswered contact is the most, not the default; delete sooner, keeping only what stops a new contact. |
| Q4, the shared list | Supported: the least data, keyed hashes, used for nothing but stopping contact, a no lifted only by the recipient's documented basis. Its basis, retention, notice and controller to be documented. |
| Q5, controllers | Kaizena Flow controls its own prospecting; a store using the tool is generally the controller with Kaizena Flow its processor (an art. 28 agreement); Kaizena Flow may control the shared list alone. Advice asked on the arrangements. |
| Q6, the next countries | United Kingdom, Netherlands, Ireland, Belgium, Austria, Spain, Italy, Poland, Portugal, Switzerland (the UK and Switzerland outside the EU and EEA). Until read, consent first. |
| Overall | A gate before an email is written and again before it is sent; the recipient's kind and the address's kind, not the country alone; a record of every check and decision; no deceptive or falsely personal AI text; no tracking pixel; no country not read; no way round the rules through another store, domain, campaign or account. Sending stays off until the rules, controller roles, privacy documents, suppression procedures and safeguards are approved. |

**The lawyer's view.** *Still to be written in, with the date, for each row of section 3 and each question in section 5, in Legal reviews by an
account with the Legal role.*

## Sources read

- [Forbrukertilsynet: Veiledning om markedsføring via e-post, SMS o.l.](https://www.forbrukertilsynet.no/wp-content/uploads/2018/01/Veiledning-om-markedsføring-via-epost-sms-ol.pdf)
- [Marknadsföringslag (2008:486)](https://www.riksdagen.se/sv/dokument-lagar/dokument/_sfs-2008-486); [prop. 2003/04:43](https://data.riksdagen.se/dokument/GR0343.html)
- [Forbrugerombudsmanden: Vejledning om spamforbuddet (2021)](https://forbrugerombudsmanden.dk/media/bjajzdv1/vejledning-om-spamforbuddet-2021-a.pdf)
- [Laki sähköisen viestinnän palveluista (917/2014), Finlex](https://finlex.fi/api/media/statute/26580/mainPdf/main.pdf)
- [UWG § 7, gesetze-im-internet.de](https://www.gesetze-im-internet.de/uwg_2004/__7.html); [IHK München: E-Mail-Marketing](https://www.ihk-muenchen.de/email-marketing/)
- [CNIL: La prospection commerciale par courrier électronique](https://www.cnil.fr/fr/la-prospection-commerciale-par-courrier-electronique-sms-mms-et-automate-dappel)
