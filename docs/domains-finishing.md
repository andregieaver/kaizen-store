# Finishing the domain work: what only the owner can do

Status: 24 October 2026. Everything in D315 (`docs/domains.md`) and D317 (`docs/domains-standalone.md`) that code can do is built and live,
behind three switches that are off. This is the list of what is left, in the order it unlocks things. Each step says why it matters,
exactly what to do, and how to know it is done. Nothing here needs a code change unless the step says so.

## The switches, and what each one waits for

| Switch (where) | What it turns on | Turn it on when |
|---|---|---|
| *Open buying to every store* (Platform → Domains) | Every open store can buy and renew generic domains (`.com`, `.shop`, …) | Steps 1 and 2 are done |
| One store at a time (Platform → Domains, *Open for this store*) | The same, for one store | Now, for a test store (step 2) |
| *Sell domains on their own* (Platform → Domains) | `/get-domain`, buying without a store, *Your domains* checkout | Steps 1 to 6 are done |
| `DOMAIN_CONNECT_PRIVATE_KEY` (Vercel) | *Connect automatically* on a store's Domains page | Step 8 is done |

## 1. Check the production environment (15 minutes)

**Why:** buying, DNS and the holding page all call Vercel's API; without these the pages say "not set up" and nothing is charged.

In Vercel → project `kaizen-store` → Settings → Environment Variables (Production), check that these exist:

* `VERCEL_API_TOKEN`: a token of the team that holds the project, with access to domains and DNS.
* `VERCEL_TEAM_ID` and `VERCEL_PROJECT_ID`.
* `VERCEL_DEPLOY_HOOK_URL`: a deploy hook on `main` (store domains are routed at build time).
* `SETTINGS_ENCRYPTION_KEY`: already used across the app; transfer codes and the holder assistant's proposals depend on it.
* `STRIPE_SECRET_KEY_LIVE` (and `_TEST`), and the billing webhook (`/api/stripe/billing/live`) subscribed to `invoice.paid` and
  `invoice.voided`: a domain is registered only when its invoice is paid.

**Done when:** Platform → Domains shows prices per currency with an example, and a store's Domains page shows *Get a domain*.

## 2. A real purchase on a test store (30 minutes, about 15 USD)

**Why:** the code is tested against a stand-in registrar and Stripe; one real purchase proves the whole path with real money.

1. Platform → Domains → *Open for this store*: your own test store's address.
2. In that store: Settings → Domains → *Get a domain*, search a cheap `.shop` or `.online` name, buy it for one year.
3. Pay the invoice (or let the plan's card pay it).
4. Within a few minutes: the purchase shows *Done*, the domain is the store's address, the DNS card shows its records, and you get the
   *{domain} is yours* email.
5. Try the DNS card (add a TXT record, then Undo), and the AI manager: "set up a DMARC record on {domain}".
6. Open the move page (*Move {domain}*) and read the checklist; don't move it.

**Done when:** all of the above happened. If anything failed, Platform → Domains → *Purchases that need a look* says why; send me that.

## 3. Vercel's written yes to reselling (S1) — email, a few days

**Why:** Vercel's domain terms (17 September 2025) neither allow nor forbid reselling to the public. Before selling domains to people who use
nothing else of Kaizena Flow's, get it in writing.

Write to Vercel (your account manager, or support from the team dashboard) and ask, in these words if you like:

> We run Kaizena Flow, a platform on Vercel (team `team_ZYCx8tB4iwp6cBCeHKPTAjj8`). Through the Registrar API we register domains for our
> stores' owners, and we would like to also sell domains to members of the public who don't use our store product: a domain shop, with
> the buyer as the registrant, paid to us first. 1) Is this allowed under your terms, and at what volume? 2) What do you expect of us on
> abuse (we review brand-like and phishing-like names before registering, cap new accounts at three domains in 30 days, and refuse
> unconfirmed VAT numbers)? 3) Should these domains live in a separate team? 4) How does a holder move a domain to another registrar: is
> the transfer code from the API enough, or must you release the domain?

**Done when:** you have their answer in writing. If they say no, *Sell domains on their own* stays off; nothing else changes.

## 4. The accountant (S2) — one meeting

**Why:** the checkout charges 25 % MVA in Norway, reverse charge to EU businesses with a VIES-checked number, nothing to businesses outside
the EU, and refuses consumers outside Norway. The accountant confirms this, and decides on non-Union OSS.

Ask them:

* That a domain registration is an electronically supplied service, and that the above is right for Kaizena Flow AS.
* That the invoice texts are right: *Reverse charge* with the buyer's VAT number, and *Outside the scope of Norwegian VAT*
  (`src/server/domain-purchases.ts`, `billTo()`).
* Whether to register for the EU's non-Union OSS scheme (needed before selling to consumers in other EU countries; decision 1 waits for
  it). If yes, tell me and I'll open consumers in the EU with the right rates.
* That a domain bought by a store is still billed to the store with its plan's VAT (decision 6).

**Done when:** they've said yes, or told you what to change (send it to me).

## 5. The lawyer (S3) — one review

**Why:** a consumer gives up the right to withdraw once registration is complete (Directive 2011/83/EU art. 16 (a), angrerettloven § 22
bokstav a). The consent words, the confirmation email and a short *Domain terms* page need a lawyer's eye.

Send them:

* The consent words, in `src/lib/domain-buyer.ts` (`CONSENT_TEXT`, English and Norwegian), shown beside a tick box before paying.
* The confirmation email, which repeats them (`registered` in `src/lib/messages/platform-en.ts` and `-nb.ts`, `domainEmails`).
* That renewals are invoiced 30 days ahead and can be switched off at any time; the reminder emails at 30, 14, 7 and 1 days.
* Ask them to write a short *Domain terms* text (what is sold, registrant duties, the registry's rules, renewal, refunds when a
  registration can't be made, abuse and suspension, moving away), in English and Norwegian.

**Done when:** you have their approved words. Send them to me: I'll put the terms on a page of their own, linked from the checkout and
`/get-domain`, and change the consent words if they ask.

## 6. Turn on selling to the public (5 minutes)

**Why:** this is the launch (decision 5: quietly, no marketing until `.no` can be sold).

1. Build the *Domains* page on Kaizena Flow's own site: Platform → Website → Pages → New page, address `domains`, with a heading, a line
   of text and the *Domain search* component (it sends visitors to `/get-domain`). Add the Norwegian texts in the builder's translate mode.
   Publish it.
2. Platform → Domains → *Sell domains on their own*.
3. Test it from a private window with an email address that has no account: search on `/domains`, *Get started*, open the email link, buy.
4. Watch *Waiting for a look* on Platform → Domains: approve or refuse names held for review.

**Done when:** a person with no store bought a domain and sees it on *Your domains* with its holding page live.

## 7. Email forwarding (S4) — choose a provider

**Why:** next to Hover, a domain without email forwarding is thin (decision 8). It needs a provider first.

Find a provider with: processing in the EU, a data processing agreement, SRS (so forwarded mail isn't rejected), an API to make aliases per
domain, and a price per domain that fits the margin. Candidates to ask: ImprovMX (check EU processing), Forward Email (EU servers
available), Migadu (Swiss), or your mail host. Send me the provider and an API key in Vercel's environment and I'll build it (aliases on
*Your domains*, the MX and SPF records set by the DNS recipes, a privacy register entry).

## 8. Domain Connect (optional, a few weeks of waiting)

**Why:** with it, a store whose domain is at Cloudflare, GoDaddy, Domeneshop and others connects with one press instead of copying DNS
records. Follow `docs/domain-connect/README.md`:

1. Make the key pair (two `openssl` commands there).
2. Add the public key as TXT records at `_dcpubkeyv1.kaizenaflow.com` (wherever `kaizenaflow.com`'s DNS is).
3. Add `DOMAIN_CONNECT_PRIVATE_KEY` in Vercel (Production).
4. Open a pull request with the two files in `docs/domain-connect/` to <https://github.com/Domain-Connect/Templates>.

**Done when:** a provider has taken the templates in; *Connect automatically* then appears by itself on a waiting domain there.

## 9. `.no` and other country endings (D315 phase 5) — choose a registrar

**Why:** Vercel doesn't sell `.no`, `.se`, `.dk`, `.fi`, `.eu` or `.de`, and Norwegian stores want `.no` first. Decision 2a: an EU registrar
first, Norid's own accreditation once `.no` sales near 100 a year.

Choose an EU registrar with an API and Norid's agreement, and open a reseller account. Candidates to ask: Domeneshop (Norwegian, Norid
registrar; ask about a reseller API), Openprovider (Netherlands, wide country coverage), Hexonet/CentralNic, or Gandi (France). Ask each:
API for search, price, register, renew, transfer code, nameservers; `.no` with the applicant's declaration and person/organisation number;
prices; who they bill. Send me the choice and the API credentials (as environment variables) and I'll write its adapter behind the same
interface; nothing else in the product changes.

## 10. After each step

* When I push a change with a migration, CI applies it; I record its version in `docs/decisions.md`. Never apply one by hand.
* Platform → Domains → *The way in* shows whether domains bring stores: read the 90-day figure after six months (decision 10).
