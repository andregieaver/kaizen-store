# Kaizena Flow and the Digital Services Act

How Kaizena Flow meets the Digital Services Act (Regulation (EU) 2022/2065) for content on the stores it hosts. Written 31 October 2026
(D411, PSI REG-12). The articles were read on EUR-Lex; this is a working reading, not legal advice: the owner's lawyer is to confirm it.

## Roles

Kaizena Flow stores what its stores' owners publish (products, pages, pictures, reviews) and shows it to the public at their request. That
makes it a **hosting service** (art. 3(g)(iii); this citation was not re-read against the Official Journal, as EUR-Lex did not answer when it was checked on 31 October 2026), and most likely an **online platform** (art. 3(i): a hosting service that "stores and
disseminates information to the public" at a recipient's request). The stores are the recipients of the service. Kaizena Flow does not
choose or check what a store sells before it is published, and the DSA does not ask it to: there is no general obligation to monitor
(art. 8), and checks Kaizena Flow chooses to make, in good faith and diligently, do not cost it the liability exemption (art. 7).

**For the lawyer:** art. 19(1) (its wording checked on EUR-Lex) excludes providers that qualify as micro or small enterprises (Recommendation 2003/361/EC) from the
online-platform section (arts. 20 to 28, except art. 24(3)). Whether Kaizena Flow qualifies decides whether the internal complaint system of
art. 20 and the out-of-court settlement of art. 21 bind it now. The hosting duties below (arts. 16 and 17) apply whatever its size.

## What is built (D411)

| Duty | Where |
|---|---|
| Art. 16(1): a notice mechanism, easy to access, electronic | `/report` and `/no/report` (`src/components/platform-routes/report.tsx`), linked as *Report illegal content* from every store's footer and Kaizena Flow's own, beside Cookies (`ReportContentLink`); the address of the page is filled in from `?url=` or the page the visitor came from |
| Art. 16(2): what a notice holds | the reasons (a), the exact address (b), the sender's name and email (c), not needed for offences against children (Directive 2011/93/EU arts. 3 to 7, category `minors`), and the good-faith statement (d) (`reportInput()`, `src/lib/content-reports.ts`; the table's checks in `commerce.content_reports`) |
| Art. 16(4): a confirmation of receipt | `platform.content_report_received`, sent at once when the sender gave an address |
| Art. 16(5): the decision, with the ways to redress | `platform.content_report_decided`: what was done (or that nothing was), the reason, and the redress (ask again, the Digital Services Coordinator of their country, the courts) |
| Art. 16(6): timely, diligent, non-arbitrary, objective; automated means said | a platform admin decides each notice at `/admin/platform/reports` with a reason of at least 10 characters; every admin is emailed when one arrives (`platform.content_report_new`); each decision is in the audit log (`platform.content_report_decided`); `content_reports.ai_used` makes the emails say whether automated means were used (none until part 2) |
| Art. 17: a statement of reasons to the store | `platform.content_report_restricted` to the store's owners when content is restricted: what, where, why, the ground, that a notice started it, whether automated means were used, and redress; the sender is not named |
| GDPR | the sender's name and address are blanked 12 months after the decision (`pruneContentReports()`, the five-minute dispatcher's `contentReports` job); the table is in the register (`PERSONAL_DATA`) |

Restricting the content itself is done by the admin where it lives (hiding the product, removing the picture, closing the store); the
notice records what was done and why.

## Part 2: AI reads first, a person decides

An AI will read each notice when it arrives: sort it, say how urgent it looks, and draft a decision and its reason for the admin, who
confirms or changes it. It may also check new and changed listings for clear signs of illegal goods (art. 7) and put what it finds in the
same queue. Nothing is restricted by the AI alone. When it took part, `ai_used` is set and both emails say automated means were used
(arts. 16(6) and 17(3)(c)). A notice's words come from strangers, so the prompt treats them as untrusted text (`src/lib/prompt-safety.ts`).

## Left for the owner

1. The lawyer's confirmation of the roles and of art. 19 (above).
2. A single point of contact for authorities and recipients (arts. 11 and 12), named on Kaizena Flow's site, and a legal representative only
   if Kaizena Flow is established outside the EU (art. 13).
3. The terms of service saying how content is moderated (art. 14).
