# Domains on their own: a domain shop, and a way in (D317)

Status: being built, 2026-10-23. The owner took every recommendation of section 13 ("Let's go with your recommendations. Build it.").
It builds on D315 (`docs/domains.md`), which is built through phase 6: everything here reuses it. Section 17 says what each phase
built. Selling to the public stays off (`platform_settings.domains_public`) until the spikes of section 12 are answered: Vercel's written
yes to reselling (S1), the accountant on VAT (S2), the lawyer on the consent words (S3).

## 0. What this is

Anyone can buy a domain from Kaizena Flow without having a store, as from Hover: search, buy, manage its DNS (by hand or by asking the AI
manager), forward its email, renew it, move it away. The person needs only an account.

It is meant as a way in as much as a product. Someone buying a name is usually starting something, so the domain's holding page, its
dashboard and its renewal emails all offer the next step: a store on that domain, connected the moment it exists. Whether it works as a
lead channel is measured from the first day (section 9), not assumed.

What it is not: a cheaper registrar. Cloudflare sells at cost and others undercut on the first year; Kaizena Flow does not compete on
price. It competes on being easy (DNS that explains itself and fixes itself through the AI manager, email set up in one step) and on what
comes after.

## 1. What exists, and what ties it to a store

Built in D315 and reused as it is:

* search and prices (`searchDomains()`, `domainPrice()`, `commerce.domain_pricing`), the *Domain search* component on Kaizena Flow's
  own pages (its buttons go to sign-up with `?domain=` today);
* paying first on Kaizena Flow's Stripe invoice, then registering, renewals, refunds by credit note (`src/server/domain-purchases.ts`);
* the registrant (`domain_registrants`, `registrantInput`), health (`domainHealth()`), DNS editing with recipes and undo
  (`src/server/domain-dns.ts`), moving away and moving in, Domain Connect;
* the AI manager's domain tools.

What ties every one of them to a store today (read in the code, 23 October 2026):

* **Data.** `domain_registrations`, `domain_purchases`, `domain_registrants`, `dns_zones` and `dns_changes` all have `store_id not null`.
* **Billing.** A domain invoice's customer is the store's connected Stripe account (`billedAccount(storeId)` in `theme-prices.ts`, as
  plans and premium themes are). Its VAT is 25 % for a store in Norway and none elsewhere (`billingTaxRates()`): a business-to-business
  rule. A person without a store has no such account.
* **Who may buy.** `startDomainPurchase()` refuses anything but an open store's owner; `buyingOpen()` asks the store.
* **Signing in.** `admit()` admits only an email that already has a `commerce.accounts` row, and such rows are made only by approving an
  access request (`approve_access_request()`) or by an invitation to a store. There is no self-serve account today: `/sign-up` stores a
  request that a platform admin approves.
* **The pages and the assistant.** The domain pages are a store's (`/admin/{store}/settings/domains…`); the AI manager runs for a store's
  members or for platform admins (`Principal`: `{ account, store | null }`, where a null store means the platform).

## 2. The idea: a domain belongs to a person, and may be used by a store

The holder of a domain is an **account** (the person, or their company as the registrant), not a store. A store **uses** a domain
(P8's connection) and may be linked to the registration for display and the health check. This is closer to the truth than today's
model anyway: D315 decision 1 already makes the owner or their company the registrant, and closing a store already keeps its domains with
the owner (D315 9.3).

So:

* every registration, purchase, registrant, zone and DNS change gets an `account_id` (the holder), backfilled from the store's owner for
  what exists; `store_id` stays, nullable, meaning "used by this store";
* a domain moves between stores, or from none to one, without being transferred anywhere;
* billing follows the holder: a store's domain is still billed as today (the store's account as customer, decision 6), a domain held by
  an account without a store is billed to the account (section 6);
* the store's pages keep showing the domains it uses; the holder sees all their domains on the owner's level, *Your domains*
  (`/admin/account/domains`, under Account in `owner-nav.ts`; owner pages never take a new `/admin/{word}`).

Permissions: the holder account decides everything about its domains (renew, DNS, move, link to a store). A store's staff keep what they
have today for a domain the store uses (health, and DNS changes for owners), because linking a domain to a store is the holder's yes to
that. Unlinking gives it back.

## 3. What the person sees (Homer first, Lisa one step away)

1. **Kaizena Flow's own site**, a page *Domains* (`/domains`, and `/no/domains` in Norwegian) built in the page builder around the existing *Domain
   search* component, with the prices shown as the person pays them (section 6).
2. **Search, choose, buy.** A free name's button opens a short checkout: an email (signed in with a code sent to it, so no password is
   needed), the registrant filled in from what they type once, the price, and Pay. Paying first, as D315 does.
3. **Your domains.** One line per domain: working, renews on a date, and the one thing to do if anything (D315's health). *Customise*
   holds the DNS editor, recipes, renewal, the holding page and moving away.
4. **The holding page.** Until the domain is used, it shows a calm page with the name (section 8), and the holder can point it elsewhere
   instead.
5. **The next step**, everywhere and never in the way: *Start a store on {domain}*.

Lisa gets every DNS record, the zone file, the transfer code page, and the AI manager for her domains.

## 4. Accounts without a store

* **A domain-only account** is an ordinary `commerce.accounts` row made at checkout, after the email is proven by a code (Supabase's
  email code, as the admin's magic link is today). It holds domains, nothing else; it belongs to no store and runs no platform.
* **`admit()`** admits an account that holds a domain (or is waiting for its first one to be paid), besides store members and platform
  admins. Its admin is the owner's level with *Your domains* and *Your account* only; the store sections are not there.
* **The control center** (`controlCenter()`) for such an account shows its domains and the next step; with stores, it shows both.
* **Two-step sign-in** is offered as to owners; it is required before a transfer code is shown, as D315 asks a fresh sign-in.
* **Becoming a store owner.** *Start a store on {domain}* opens the sign-up request with the domain filled in; approving it makes the
  store and connects the domain at once (`connectOwnedDomain()`, no records to create). Whether a domain holder skips the approval is
  decision 3.

## 5. What changes in the data (outline, for the build)

* `account_id` (holder) on `domain_registrations`, `domain_purchases`, `domain_registrants`, `dns_zones`, `dns_changes`; backfill from
  each store's first owner; `store_id` made nullable in a later migration, after the code reads `account_id` (add, never drop, in one
  change: CLAUDE.md's migration rule).
* `accounts.origin` (`access_request`, `invitation`, `domain`), so the lead channel can be counted without asking anyone.
* `domain_holding_pages` (per registration: `parked`, `redirect` with an address, `off`), and, if decision 8 says so,
  `email_forwards` (alias, destination, verified at).
* Every new table: `PERSONAL_DATA` (the registrant and forwarding addresses are personal data: export, erasure that never deletes a
  registration but restricts it as D162 does orders, retention), `COPY_RULES` `never`, RLS on.
* The writers stay the D315 modules; a new reader that filters by store learns to ask by holder.

## 6. Money and VAT

Kaizena Flow is a Norwegian seller. Today it bills only businesses (stores): 25 % MVA in Norway, reverse charge elsewhere. Selling to
anyone changes that:

* **Consumers in Norway:** 25 % MVA, prices shown with it (Norwegian law requires prices to consumers to include VAT).
* **Businesses anywhere:** as today (Norwegian MVA in Norway, reverse charge in the EU, with the buyer's VAT number, checked as D157 does).
* **Consumers in the EU:** a domain registration is very likely an electronically supplied service, taxed where the consumer lives. A
  seller outside the EU accounts for it through the EU's non-Union OSS scheme (one registration in one member state, quarterly returns,
  each country's rate). That is a real obligation for the company, not a setting: decision 1 asks whether to take it on now, and S2 asks
  the accountant.
* **Billing a person without a store.** The account needs a Stripe customer on Kaizena Flow's own account (an Accounts v2 account with
  only the customer configuration, as stores' accounts carry it, or a classic Customer): S5 reads which, and how Stripe Tax or our own
  rates apply. Card first; an invoice only for businesses.
* **Prices.** The same table (`domain_pricing`: the registrar's price at the ECB rate, the margin, rounded, a floor) with VAT added for
  consumers where it applies; the checkout names the total before Pay.
* **Refunds.** Vercel's own terms say registration payments are final and non-refundable (Domain Name Registration and Services Terms,
  updated 17 September 2025). So a refund after registration costs Kaizena Flow the registrar's price; section 7 matters.

## 7. Consumer law, terms and privacy

* **Withdrawal.** A consumer has 14 days to withdraw from a distance contract (Directive 2011/83/EU; angrerettloven in Norway). The
  exception that fits is a service fully performed, when performance began with the consumer's prior express consent and acknowledgement
  that the right is then lost (Article 16(a); angrerettloven § 22 a). A registration is complete when the registrar confirms it. So the
  checkout asks for that consent and acknowledgement in so many words, registration starts only after it, and the confirmation email
  repeats it on a durable medium. Before registration completes, withdrawal is free and refunded in full. A lawyer confirms this (S3)
  before consumers can buy.
* **Terms.** A short *Domain terms* page of Kaizena Flow's own (hand-written, English and Norwegian, as D312 P5's legal pages are):
  what is bought, renewal and what happens on expiry (a `.no` is deleted, D315 9.1), moving away, abuse, and that the registration is held
  through Vercel and its registrars (Tucows and Name.com today), whose terms and ICANN's policies apply.
* **Privacy.** The registrant's data goes to Vercel and the registrar, which acts as controller for the registration (Vercel's terms),
  and to the registry; Vercel is in the United States. The privacy notice names them, the transfer and its safeguard, in both languages.
  The public registration record is redacted by the registries and registrars for natural persons under GDPR; the plan does not promise a
  "privacy" product beyond what they do.

## 8. The holding page, forwarding and email

* **Holding page.** A domain with its DNS here and used by no store is added to Kaizena Flow's Vercel project and answered by a route
  that reads the host at request time (`src/proxy.ts`: a host that is no store's and no Kaizena Flow host, looked up in
  `domain_holding_pages`), so a new domain never needs a deployment, unlike stores' hosts (P7). The page shows the name and "coming
  soon" in the holder's language, a small *Made with Kaizena Flow* link, `noindex`, no cookies or tracking. The holder may switch it off or
  make it a redirect to any address of theirs (checked by `isSafeAddress()`, 308).
* **Email forwarding** (`hello@theirdomain` to their own mailbox) is what domain buyers use most. Vercel's DNS can't do it; it needs an
  inbound mail service with EU processing, a data processing agreement, and SRS so forwarded mail passes SPF and DMARC. S4 chooses one.
  D315's email recipes already set up real mailboxes (Google Workspace, Microsoft 365, any provider's records); forwarding is for those
  who don't want one.
* **Paid mailboxes** are out of scope (section 16): the recipes point to providers who do that well.

## 9. The lead channel, and measuring it

The path: a search on Kaizena Flow's site, a domain bought, the holding page, *Start a store on {domain}*, an approved store using the
domain. Each step is counted from data that is already there or added in section 5, never from a cookie or a person's behaviour on the
holding page:

* searches on the *Domains* page (a count per day, no words kept, as D315's search keeps none);
* domain-only accounts made (`accounts.origin = 'domain'`), and purchases;
* *Start a store* requests from a domain account, and stores opened from them, with the days in between;
* renewal rate of domain-only accounts against store owners'.

The platform overview gets a *Domains* card with these as counts and rates (a rate needs a minimum sample, as D152's figures do). The
owner sets the bar in decision 10: a share of domain-only accounts that open a store within 90 days, read after six months, below which
the domain shop stays as a convenience and stops being marketed.

## 10. Abuse and risk

Every domain sits in Kaizena Flow's Vercel team, and Vercel's terms make Kaizena Flow the customer answerable for what is registered
(complaints, suspension "to maintain the security, integrity, and stability of Registration Services"). One phishing domain bought with a
stolen card can put the account that serves every store at risk. So, before consumers can buy:

* **Payment.** Card only for new accounts; a payment Stripe rates elevated or highest risk is held for a person to look at before the
  registrar is asked (D288's risk facts); a dispute suspends the domain's DNS here.
* **Limits.** At most three domains in an account's first 30 days (a limit row, D314's machinery), more after a paid renewal or a store.
* **Names.** A name that contains a well-known brand or a word phishing favours (`login`, `secure`, `verify`, `bank`, `wallet`, a list
  kept as data) waits for a platform admin's yes before registration. Pure, tested, never a model's guess.
* **Reports.** An abuse address on the *Domain terms* page and in the platform admin's domain view; a platform admin can suspend a domain's
  DNS here at once (a `kaizena` change, recorded and undoable) and report it to Vercel. Reports and actions are audited.
* **Separation.** S1 asks Vercel whether domains sold to the public should sit in a team of their own, so an abuse case there never touches
  the team that serves stores. If they say so, the registrar adapter takes a token per team (`vercelCall` already takes one).

## 11. Support and the AI manager

DNS questions are what domain support costs. D315's AI manager tools already answer them for stores; a domain-only account gets the AI
manager on its own level with the domain tools only (`list_domains`, `check_domain`, the DNS tools, renewal, moving), its approvals as
for stores and its DNS changes automatic only where the holder said so (D315 decision 5). Everything else (orders, products) is not
there. Kaizena Flow's own support desk (D216 step 11) takes the rest: an account with domains reaches it from the account menu as owners do.

## 12. Spikes before code

* **S1, Vercel.** Written confirmation that domains may be registered through the Registrar API for members of the public who use
  nothing else of Kaizena Flow's, at the volume hoped for; what they expect of us on abuse; whether a separate team is wise; and how a
  holder moves a domain away (community reports say domains bought through Vercel show a "third party" registrar that only Vercel can
  release; D315 phase 4 relies on the transfer code endpoint). Their published terms (updated 17 September 2025) neither allow nor forbid
  reselling; they ask the customer to have the consent of everyone whose data is sent to the registrar.
* **S2, VAT (an accountant).** That a domain registration is an electronically supplied service; what non-Union OSS takes for the company
  (registration, returns, records for ten years); and how Norwegian MVA applies to Norwegian consumers through Stripe.
* **S3, Withdrawal (a lawyer).** That the Article 16(a) / § 22 a route holds for a registration and a renewal, the exact consent wording in
  Norwegian and English, and what the confirmation must say.
* **S4, Email forwarding.** A provider with EU processing, a DPA, SRS, an API for aliases, and a price per domain that fits the margin.
* **S5, Stripe.** The customer object for an account without a store, tax on its invoices, and keeping the existing domain billing for
  stores unchanged.
* **S6, `.no`.** D315 decision 2a (a registrar in the EU first, Norid accreditation later) decides when Norwegian buyers can get the name
  they most want; see decision 5.

## 13. Decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| 1 | Who may buy at first | Consumers and businesses in Norway, businesses anywhere else. EU consumers only once the company has decided to register for non-Union OSS (S2). |
| 2 | Sign-up for domain buyers | Self-serve, no approval: an email code at checkout makes the account. Payment first and the limits of section 10 carry the risk that approval carries for stores. |
| 3 | Does a domain holder skip approval to open a store | No: *Start a store* sends the request with the domain filled in, and approving it connects the domain at once. Store approval stays one rule for everyone. |
| 4 | Where it lives and what it is called | Kaizena Flow's own site, *Domains* (`/domains`, and `/no/domains` in Norwegian), under the Kaizena Flow name. A host of its own later only if it earns one, as the theme store's (D249). |
| 5 | Launch against `.no` | Open quietly to existing visitors with the generic endings; market it only once `.no` can be sold (D315 phase 5a). |
| 6 | Billing a store's domains after the change | Unchanged: a domain a store uses and its owner holds is billed to the store's account, as today. Only domains held without a store are billed to the person. |
| 7 | The holding page | On by default: the name, "coming soon", a small *Made with Kaizena Flow* link; off or a redirect at the holder's choice. |
| 8 | Email forwarding | In the first release, once S4 has a provider; without it the product is thin next to Hover. |
| 9 | The AI manager for domain-only accounts | Yes, with the domain tools only, in the second release. |
| 10 | The bar for the lead channel | Set by the owner: the share of domain-only accounts that open a store within 90 days, read after six months. |
| 11 | Referral credit (D131) on domains | None, as D315 decided for stores' domains. |

## 14. Build order

| Phase | What | Done when |
|---|---|---|
| 0. Spikes | S1 to S5 answered in this doc with dates and sources; decisions 1 to 11 taken | Nothing in section 12 is unknown |
| 1. Holder, not store | `account_id` on the domain tables with backfill, readers by holder, *Your domains* on the owner's level for today's owners, a store using a domain it does not hold | Every existing owner sees their domains on their own level, and stores work as before |
| 2. Accounts without a store | The email-code checkout, `admit()` for holders, `accounts.origin`, billing to the account (S5), VAT per decision 1, the *Domain terms* page, consent per S3, the abuse checks of section 10 | A person with no store buys a generic domain, signs in, sees it, and is billed correctly in Norway |
| 3. Holding page and forwarding | The host route, the holding page and redirect, email forwarding (S4) | A new domain answers with its holding page within minutes, with no deployment; mail to it reaches the holder |
| 4. The way to a store | *Start a store on {domain}*, the request carrying the domain, approval connecting it; the platform's *Domains* card | A domain holder becomes a store owner on that domain with no DNS step, and the platform sees the path in figures |
| 5. The AI manager for holders | The owner-level assistant with the domain tools | A domain-only holder sets up email by asking, after one yes |

Phase 1 is worth building even if the rest never is: it makes a domain the person's, which D315 already assumes.

## 15. Tests

* **Pure:** the brand and phishing word check; the VAT choice per buyer and country; the consent wording present in every language;
  the holding page's host decision (a store's host, Kaizena Flow's, a held domain, none).
* **Integration:** a store's domain bought before phase 1 is the owner's afterwards and still billed to the store; a domain-only purchase
  billed to the account with Norwegian MVA for a Norwegian consumer and reverse charge for an EU business; a withdrawal before registration
  refunded, none offered after; the limits and the held payment; *Start a store* connecting the domain; the scan tests (`dns-writers`,
  permissions, `PERSONAL_DATA`) holding the new readers.
* **End to end:** search, buy (with the auth stand-in), *Your domains*, the holding page on a test host.

## 16. What this does not do

Paid mailboxes, web hosting outside a store, premium or aftermarket names, bulk tools for domain investors, a "privacy" product beyond
the registries' own redaction, and lower prices than the registrar market. Country endings follow D315's phase 5, not this plan.

## 17. What is built

**Phase 1 (2026-10-23).** Every registration, purchase, registrant and zone has an `account_id` (the holder, backfilled from whoever
made it, else the store's first owner) and a nullable `store_id` (the store that uses it), checked by `{table}_holder`. Every reader and
writer takes a `HolderRef` (`src/server/domain-holder.ts`: a store's id, as before, or `accountHolder(id)`; `heldBy()` is the one
condition). *Your domains* (`/admin/account/domains`, in Account for owners and anyone holding a domain, `holdsDomains()`) lists them
with the store that uses each (`heldDomains()`), moves one to another of the person's open stores (`linkDomain()`, the plan's room
checked, connected at once when its DNS is kept here) and back (`unlinkDomain()`: only while the store isn't connected to it, and never
for a domain bought for a store, which has no VAT terms of the person on file and stays billed to a store), and holds renewal, the DNS
editor and moving away (`/admin/account/domains/move/{domain}`) as the store's page does. The purchase path takes a holder too: an
account's purchase goes through `gate()` (the public switch, the new-account limit, `vatFor()`, VIES, a consumer's consent kept with
its words, `nameNeedsReview()`), is invoiced to the account's own customer on Kaizena Flow's Stripe account (`accountCustomer()`,
`accounts.stripe_customer_{mode}`) with MVA, or none with *Reverse charge* or *Outside the scope of Norwegian VAT* on the invoice, and
waits after payment for a platform admin's yes when it is in review (`claim()` skips it). Renewals of an account's domain carry the VAT
terms of its last purchase.

**Phase 2 (2026-10-23).** A domain search's *Get started* leads to `/get-domain` (and `/no/get-domain`), which sends a sign-in link
to the email (`startDomainCheckout()`): the account is made with `origin = 'domain'` when there is none (`startDomainAccount()`, at most
five starts a visitor and 200 in all an hour, an existing account never changed), and the answer is the same for every address. While
Kaizena Flow doesn't sell domains on their own the page goes to sign-up with the name, as before. Such accounts and anyone holding a domain
may sign in (`signInAccount()`), land on *Your domains*, and buy at `/admin/account/domains/buy` (`DomainCheckout`): who buys and where,
the price with the VAT worked out on the server (`checkoutQuoteAction()`), a consumer's consent, then the invoice is made at once and the
buyer pays on Stripe's page. Platform → Domains has the switch (*Sell domains on their own*) and the purchases waiting for a look, approved
or refused (`decideReview()`: a refused paid purchase is refunded in full, an unpaid one voided). Not built: the *Domain terms* page, which
needs the lawyer (S3); until then the checkout points to Kaizena Flow's terms and the switch stays off.

