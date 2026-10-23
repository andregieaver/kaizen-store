# Domains: buying, DNS by the AI manager, and moving away (D314, proposed)

The owner (22 October 2026): "If we wanted to implement a new domain search, and the ability purchase domain directly on our platform.
How could we offer such a service?" and then: "One big headache i want to release along the way is handling dns settings and other domain
related actions. The store's ai assistant needs to be able to handle this on behalf of the owner. Also, should the store owner choose to
move their domain elsewhere, let's make this easy too. Make the plan, touch no code."

This is a plan. Nothing here is built. The decision number is taken when section 12 is settled; its row then goes in `docs/decisions.md`.

## 1. What is there today, and what we found

* **Stores' own domains (P8, `docs/platform.md`).** An owner adds a domain at Settings → Domains (`commerce.store_domains`,
  `src/server/domains.ts`). It becomes the store's once its DNS carries our TXT record `_kaizen.{domain}` and points at Vercel
  (`dnsRecords()` in `src/lib/custom-domains.ts`). Then routing is built into the next deployment. D313 adds a domain per language. Today the
  owner creates every record at their DNS provider by hand. That is the step `setup_progress` calls "only the owner can do".
* **Vercel's Registrar API** (read 22 October 2026, `https://vercel.com/docs/rest-api`, *Domains Registrar*). It has endpoints to:
  * search 1 to 200 names with availability and price (`POST /v1/registrar/domains/search`);
  * read prices per name and per TLD;
  * read the extra contact fields a TLD needs (`/contact-info/schema`);
  * buy, with `expectedPrice` as a guard, and follow the order (`/orders/{id}`);
  * renew and set auto-renew;
  * set nameservers, where an empty list means Vercel's;
  * hand out the auth code for transferring a domain away (`/auth-code`);
  * transfer a domain in, and read its transfer status;
  * read whether the registrant's contact is verified (`/contact-verification`).

  Everything is billed to Kaizena Flow's Vercel team, in US dollars.
* **Vercel DNS** answers for any domain in the team that uses Vercel's nameservers. Records can be listed, created, updated
  (`PATCH /v1/domains/records/{id}`) and deleted one by one. A whole zone can be replaced from a BIND zone file
  (`PUT /domains/{domain}/records`). Vercel is also a Domain Connect DNS provider.
* **Which TLDs Vercel sells** (`GET /v1/registrar/tlds/supported`, called 22 October 2026). It sells `com`, `net`, `org`, `shop`,
  `store`, `online`, `site`, `io`, `co`, `me`, `app`, `dev`, `ch`, `cz`, `ro`, `li` and about 400 more. It sells **none** of `no`, `se`,
  `dk`, `fi`, `is`, `de`, `nl`, `fr`, `es`, `it`, `eu` or `uk` (only look-alikes such as `se.net`, `eu.com`, `uk.com`). For stores that
  sell in the Nordics first, the names they want most cannot be bought through Vercel. Section 4.1 is the answer.
* **Paying Kaizena Flow once** already exists for premium themes (D286, `src/server/theme-prices.ts`). It makes an invoice on Kaizena
  Flow's Stripe account to the store's account, charged to the plan's card or sent as an invoice. It adds VAT by `billingTaxRates()`,
  and the billing webhook settles it. Domains reuse that path.

## 2. The idea: three layers, kept apart

A domain is three things. Each may be with us or elsewhere, and the owner can move each one on its own.

| Layer | With Kaizena Flow | Elsewhere | What the AI manager may do |
|---|---|---|---|
| **Registration**: who the domain is registered with and who renews it | bought here, through a registrar adapter (4.1) | at the owner's own registrar | with us: renew, set renewal, prepare a move. Elsewhere: read its expiry (RDAP) and warn |
| **DNS**: who answers for its records | Vercel DNS in Kaizena Flow's team | at the owner's DNS provider | with us: change records, always after the owner's yes. Elsewhere: read, explain, write out the exact records, Domain Connect where the provider supports it |
| **Connection**: whether the store is served on it | `store_domains` (P8, as today) | (n/a) | connect, make primary, give a language (D313) |

The rule that follows: **the AI changes only what we host, and only after the owner says yes.** For everything else it reads, explains and
prepares, and the owner does the one step. Every combination is allowed and stays working. Registration elsewhere with DNS here, and
registration here with DNS elsewhere, are both normal states, not errors. That is also what makes moving away easy (section 8): a move is one
layer at a time, each step checked by code before the next.

## 3. What the owner sees (Homer first, Lisa one step away)

Settings → Domains becomes the hub. Homer sees one line per domain and **one** main action, chosen by the state:

| State | Line | Main action |
|---|---|---|
| No domain | "Your store is at `{store}.kaizenstore.site`." | **Get a domain**, with the best available name and its price already shown |
| Bought here, connecting | "`example.com` is being set up. This takes a few minutes." | (none: it finishes by itself) |
| Working | "`example.com` ✓ Working. Renews 3 March 2027 for NOK 199." | (none) |
| Something wrong | "`example.com` doesn't reach your store yet: one record is missing." | **Fix it** (DNS here), or **Show me what to change** (DNS elsewhere) |
| Needs the owner | "Confirm your email for `example.com` by 4 November, or the registry stops it." | **Send the email again** |
| Renewal soon, no card | "`example.com` expires in 14 days." | **Renew for NOK 199** |

*Ask the AI manager* sits beside every line ("Set up Google Workspace email on example.com"). Lisa's depth is behind *Manage* on each
domain: every DNS record, the history of changes with *Undo*, email set-up, verification records, renewal years, nameservers, the zone
file, and *Move this domain*.

## 4. Getting a domain

### 4.1 Registrars behind one adapter

`DomainRegistrar` is an interface in `src/server/registrars/`, built the way payment providers (D292) and carriers (D133) are. It has
`search`, `price`, `contactSchema`, `buy`, `order`, `renew`, `setAutoRenew`, `setNameservers`, `authCode`, `transferIn`,
`transferStatus` and `contactVerification`. Each adapter takes an injectable `fetch` and never throws raw errors to a page. `REGISTRARS`
names them. Which registrar sells a TLD is data, read daily from each registrar's own list, never a list in code.

* **Vercel first**, for generic TLDs: `com`, `shop`, `store`, `online`, `net` and the rest. The domain lands on Vercel DNS in our team, so
  connecting it needs nothing from the owner.
* **An EU registrar second**, for `no`, `se`, `dk`, `fi`, `eu` and `de`. Which one is spike S2. It must keep the registrant's data in the
  EU and support those TLDs through a reseller API. At registration it sets Vercel's nameservers, so the domain joins the same DNS layer and
  connects the same way.

The owner never sees which registrar sells a name.

### 4.2 Search

Search is keyword only, never a model call. It is rate-limited per store and account in `chat_usage` buckets (`domains:search`), as VIES
is (D157).

The suggestions come from the store's own facts in code: its name and slug, its countries' TLDs and a few generic ones (`shop`, `store`,
`com`). The owner can also type their own name. Each answer is `available`, `taken` (with *I own this one* leading to 6 or 8.5), or
`premium`, which phase 1 doesn't offer. Every price shown comes from `commerce.domain_prices` (4.3) and nowhere else. A name the store
already holds says so.

### 4.3 Prices

`commerce.domain_prices` holds one price per TLD and currency (the plans' currencies), without VAT, for registering, renewing and
transferring in. A new amount is a new row, as in `plan_prices`. Platform admins set prices at `/admin/platform/domains`. The page shows
each registrar's cost today, converted at the ECB reference rate (`ecb_reference_rates`), and warns when our price is below cost plus the
floor the admin sets. There is never a price in code.

A store pays in its plan's currency, else its own country's, as for themes (D286). Norwegian stores pay 25 % MVA on top
(`billingTaxRates()`).

### 4.4 Paying, then buying

Registration cannot be undone, so the money comes first. A domain purchase is `commerce.domain_purchases`: kind `register`, `renew` or
`transfer_in`, years, our price, the registrar's quoted cost, and a status that only moves forward (`quoted`, `invoiced`, `paid`,
`registering`, `done`, or `refunded`, `failed`).

1. **Quote.** The registrar's price and availability are read again, and the owner presses a button that names the price (*Buy example.com
   for NOK 199 a year*).
2. **Invoice.** Kaizena Flow's Stripe account invoices the store's account, as `invoiceOne()` does for themes: the plan's card at once,
   or a hosted invoice to pay now. Nothing is registered before it is paid.
3. **Register.** On `invoice.paid` (the billing webhook, with the five-minute job as a fallback), a job claims the purchase and calls
   `buy` with `expectedPrice` set to the quoted cost. It follows the order until it is done.
4. **Refund when it fails.** If the name was taken meanwhile, the price rose, or the registry refused, the purchase becomes `failed`, the
   invoice gets a credit note and a refund at once, and the owner is told in plain words. Every step is safe to repeat: idempotency keys,
   claims with an expiry, and longer waits after each failure, as `chargeDueThemePurchases()` does.
5. **Connect by itself.** With Vercel's nameservers in place, the job:
   * adds the domain to the project;
   * writes the store's records (4.6);
   * inserts the `store_domains` row as already proven (we registered it, so no TXT challenge is needed);
   * makes it the primary address if the store has none, and asks for the deployment as `requestDeploy()` does.

   Stripe's payment-method domain (`ensurePaymentDomain()`) follows as it does for any active domain.

### 4.5 The registrant

The domain is registered to **the store's owner or their company, never to Kaizena Flow**. The form is filled in from the store's
business details and the owner's account, and Homer only confirms. The extra fields a TLD needs come from `contactSchema` and are drawn
from it (`.no`, for example, wants an organisation number and Norid's own rules, which S2 reads). The registrant is kept in
`commerce.domain_registrants`.

ICANN requires the registrant's email to be verified, or the domain is suspended. Kaizena Flow reads `contactVerification` and puts it on
Home's attention list with the date the registrar gives, plus a button to send the email again.

### 4.6 Records the store needs

These records are the store's to have and Kaizena Flow's to keep right, so they are *protected*:
* the apex A or ALIAS record;
* the `www` CNAME (with the redirect Vercel makes between the two);
* `_kaizen` TXT;
* Vercel's challenges;
* a CAA record, if one is ever needed, allowing the certificate authority Vercel uses.

They are written without asking when the owner connects the domain. They are shown as *Kept by Kaizena Flow for your store*. Neither the
editor nor the AI changes them, except through *Connect* or *Disconnect*.

## 5. DNS we host

### 5.1 Changes as plans

Every change, from the editor, the AI manager, a recipe, an import or Kaizena Flow itself, goes through one pure function:
`planDns(current, changes, protectedNames)` in `src/lib/dns-plan.ts`.

It returns the zone after the change, what is added, changed and removed, the **effects** in words ("Email for example.com will go to
Google Workspace", "blog.example.com will show your Ghost site"), and the problems it refuses:
* a CNAME next to other records, or at the apex;
* a second SPF record, where it offers to merge the two instead;
* an MX pointing at a CNAME;
* a TTL out of bounds;
* a value that is not its type's shape;
* a protected record.

Records are checked by `dnsRecordInput` (zod, per type: A, AAAA, ALIAS, CNAME, MX, TXT with long values split, SRV, CAA). Only
`src/server/domain-dns.ts` writes DNS, which a scan test holds.

It applies a plan this way:
1. It locks the domain (an advisory lock), reads the **live** records from Vercel, and refuses when they are not what the plan was made on.
   Each plan carries a `rev` of the records it read, like the text editor's revisions (D192), so an approval never applies to records that
   changed after the owner saw it.
2. It writes record by record with the per-record endpoints. The zone file endpoint is used only to fill an empty zone (5.4).
3. It asks Vercel's own nameservers whether every record is there. If a step fails, it takes back what it wrote and says so.
4. It records the change in `commerce.dns_changes`: before and after, the source, who made it, the approval, and Vercel's record ids.
   This table is append-only by trigger; only `undone_at` is set, and only once.

*Undo* puts the records back as they were, only while they are still what the change left (D305's rule for versions). Propagation is
said honestly: "Live at our nameservers now; some networks may show the old answer for up to an hour (the record's TTL)."

### 5.2 Recipes for what owners actually need

`DNS_RECIPES` (`src/lib/dns-recipes.ts`) is data. Each recipe has the records, the values the owner must bring (named, with where to find
them), the source page, `checkedOn`, and `verified`, which is true only when the page was read, as the parity rows have it. The first set:

* **Email.** Google Workspace, Microsoft 365, Zoho Mail, Proton Mail, Fastmail; Nordic email hosts after spike S4.
* **Proving the domain.** Google Search Console, Meta, Pinterest, Microsoft. Each is a TXT record holding the value the service gave the owner.
* **Email trust.** SPF built from the providers the zone already has, and a starting DMARC policy (`p=none`), which says it is a start.
* **Pointing a subdomain elsewhere.** A CNAME or A record to a host the owner names (a blog, a booking site).

A recipe is a change set like any other, so it goes through `planDns()`, the owner's yes and *Undo*.

### 5.3 The domain's health

`domainHealth(facts)` (`src/lib/domain-health.ts`, pure) turns what the server gathers (`src/server/domain-health.ts`) into findings. Each
finding has a severity, words from the `domains` catalogues in English and Norwegian, and its fix: a tool, a page, or the owner's one step.
The server gathers:
* the store's checks (P8);
* the registration's expiry, renewal and contact verification;
* the nameservers;
* the zone's records;
* public DNS answers;
* RDAP for domains registered elsewhere (expiry and registrar), through a fixed client using IANA's bootstrap file, with a time limit.

The findings cover:
* not pointing at the store;
* a certificate still waiting;
* expiring without renewal;
* a renewal payment that failed;
* an unverified registrant;
* a CAA record that blocks the certificate;
* two SPF records;
* DKIM missing for a provider whose MX is present;
* no DMARC (advice only);
* a domain elsewhere that expires soon.

Serious findings go to Home's attention list and the control center (`attentionFor()`, a `{ one, many }` pair in both `home` catalogues).
The AI manager repeats them and never makes one up.

### 5.4 Moving DNS here (for a domain registered elsewhere)

*Let Kaizena Flow handle DNS* is the step that ends the headache for domains bought elsewhere:

1. **Bring the records.** Best is a zone file exported from the current provider, read by `parseZone()` (`src/lib/zone-file.ts`, pure,
   refusing `$INCLUDE` and anything it cannot hold). Without one, we probe the usual names (`PROBE_NAMES`: apex, `www`, `mail`, MX, TXT,
   `_dmarc`, the known DKIM selectors, `autodiscover`, …). The page then says plainly that a name we did not find won't move unless the
   owner adds it.
2. **Compare.** Every record is checked against the current provider's own nameservers (`zoneMatchesLive()`), so the zone we fill is
   what the internet sees today.
3. **Fill** the empty zone on Vercel and check it at Vercel's nameservers.
4. **The owner changes the nameservers** at their registrar. We name the registrar from RDAP and show the two values. Then we watch public
   DNS until the nameservers are ours and say so.

If something was missed, the zone on Vercel is still there to fix. Nothing about their email or other services changes on the day the
nameservers move.

## 6. Domains whose DNS stays elsewhere

The owner may keep DNS where it is. Then:
* the AI manager and the page explain the domain's health (5.3);
* they write out the exact records with copy buttons (as today);
* they name the provider when DNS shows it.

**Domain Connect** (S3) is the one-press version. Kaizena Flow becomes a Domain Connect service provider, with a template holding the
store's records and the claim's token as a variable. Where the owner's DNS provider supports it, *Connect automatically* sends them to
their provider to sign in and approve. The connection then completes as usual (P8's checks still decide). Where the provider does not
support it, nothing changes.

## 7. The AI manager

### 7.1 Tools

The new tools are in `OWNER_TOOLS`. Each has zod arguments, a line in `TOOL_WORDS`, a row in `TOOL_PERMISSIONS`, and approval words written
by the server from the plan, never by the model. Pure parts go in `src/lib/domain-tools.ts`, handlers in `src/server/domain-tools.ts`. As
owner tools, they are also served to Kaizen Life over `/api/mcp`, where gated calls are only kept for approval (D96).

Gate `domain` is a new `GateCategory`. Its `GATE_WORDS` are "Changes your domain: where it points, its email or its renewal". `spend` and
`public` are the existing gates.

| Tool | Gate | Who | What it does |
|---|---|---|---|
| `list_domains` | (none) | `settings:read` | Each domain: connection, primary, language, where it is registered and its DNS hosted, expiry, renewal, health in one line |
| `check_domain` | (none) | `settings:read` | Runs `domainHealth()` now: findings, each with its fix |
| `search_domains` | (none) | owner | Names with availability and our price from `domain_prices`. Never another price |
| `buy_domain` | `spend` | owner | Quote, then the owner's yes (price, years, registrant), then 4.4. Connects by itself |
| `renew_domain` | `spend` | owner | Renews now, for the years asked |
| `set_domain_renewal` | `domain` | owner | Turns renewal on or off. Turning off says the date the domain stops |
| `list_dns_records` | (none) | `settings:read` | DNS here only. Marks protected and email records |
| `change_dns` | `domain` | owner | A change set. `planDns()` runs first: problems go back to the model, effects go on the approval |
| `set_up_email` | `domain` | owner | Applies an email recipe with the values the owner gave |
| `verify_domain_for` | `domain` | owner | Adds a service's verification record from the value the owner pasted |
| `undo_dns_change` | `domain` | owner | Puts a change back, while it is still as it left it |
| `connect_domain` | `public` | owner | Connect, make primary, give a language (the existing savers) |
| `start_dns_move_here` | (none) | owner | Starts 5.4 and returns the page. Probing and comparing change nothing |
| `plan_domain_move` | (none) | owner | The checklist for a move the owner chose (section 8), with each step's state and the page. Never the transfer code |
| `switch_nameservers` | `domain` | owner | Moves DNS away (8.2), only after `nameserverSwitchCheck()` passed |

**Never from the AI.** The transfer code; the registrant's identity; deleting a registration or a zone; anything on a domain the store
does not hold. A DNS change always waits for a yes. The only exception is the store's own records when the owner connects a domain, because
connecting is the yes.

**Grounding.** The model never writes a record value it was not given by a tool (a recipe, a finding) or by the owner in the conversation,
and never a price. Changes on a busy store go through the same plan, revision and undo as the editor's.

### 7.2 Playbooks and setup

* **Playbooks.** `ASSISTANT_SKILLS` gets three: *My domain isn't working* (`check_domain` first), *Set up email on my domain*, and *Move my
  domain*.
* **Setup.** `setup_progress` stops listing a domain's DNS as the owner's only step when the domain is ours: the tools do it. For a domain
  elsewhere it names the one step, or Domain Connect.
* **Platform AI manager.** `domains_overview` is read-only in `PLATFORM_TOOLS`: registrations, failures and margins.

## 8. Moving away, made easy

The owner opens *Move this domain* and picks what they want in plain words. Each journey is a checklist. Code checks every step, so the
owner never has to guess whether it is safe to take the next one. The page is in the `focus` layout (D229) and works on a closed store
(9.3).

### 8.1 "Keep it working here, move the registration to another registrar"

1. **Checks** (`transferBlockers()`, pure):
   * the registrar's lock after registration or an earlier transfer (we show its end date; ICANN's rules set it, 60 days for most gTLDs
     today);
   * a renewal or transfer already in progress;
   * an unverified registrant;
   * expiry within 15 days, where the advice is to renew first or ask the new registrar.
2. **The registrant email.** It is shown, because the registrar's approval may be sent there. Whether changing it starts a lock is read in
   S1.
3. **The transfer code.** It is shown only on the page, only to an owner, only after a sign-in from the last ten minutes
   (`signedInRecently()`, as closing a store requires). It is read live from the registrar each time and never stored, logged, emailed,
   given to the AI or served over MCP. A canary test holds that. The audit (`domain.transfer_code_shown`) records who and when, never the
   code.
4. **Watching.** We follow the transfer status (and RDAP) until the registrar has changed. Then the registration is `transferred_out`,
   renewal and charges stop, and the owner is told.

DNS stays with us and the store keeps working. This is the "registration elsewhere, DNS here" state.

### 8.2 "Move DNS to another provider"

1. **Take the records.** A BIND zone file (`writeZone()`, which round-trips with `parseZone()` in tests), a CSV through `writeCsv()`
   (`src/lib/csv.ts`), and a printable list. The store's protected records are marked, so the owner knows to recreate them.
2. **Check the new provider.** The owner names the new nameservers. `nameserverSwitchCheck()` asks those nameservers for every record and
   lists anything missing. The switch is offered only when nothing is missing, or when the owner removed or accepted what is.
3. **Switch.** With the registration here, `setNameservers` does it (`switch_nameservers`, the owner's yes). With the registration
   elsewhere, the owner does it at their registrar and we watch.
4. **Keep a way back.** For 30 days the zone stays on Vercel, read-only, with *Switch back*. Then it is removed from the team.

### 8.3 "Use it somewhere else" (the domain stays, the store doesn't use it)

*Disconnect from this store* removes the connection and the store's protected records only. Email and every other record stay. With DNS
here, the owner (or the AI, after a yes) points the apex or a subdomain where they want it.

### 8.4 "Leave Kaizena Flow with my domain"

This is 8.2 then 8.1, in that order, with the checklist joining them. The store's address falls back to `{store}.kaizenstore.site`.
Nothing is charged after the transfer completes.

### 8.5 The other way: moving in

* **"I own this one"** leads to 5.4 (DNS here) or 6 (DNS stays).
* **Transfer in** (phase 6): the registration moves to us through `transferIn` with the owner's auth code, which is used once and never
  kept. Vercel's records start empty unless a zone file is given, so 5.4's steps fill and compare it first.

## 9. Renewal, expiry and closing a store

### 9.1 Renewal

The owner's renewal choice is ours to carry out. Thirty days before expiry the renewal is invoiced as in 4.4, with reminders at 30, 14, 7
and 1 days (owner emails in the account's admin language).

The registrar's own auto-renew stays on as a safety net while renewal is on and paid. It is turned off when the owner turns renewal off,
or when a renewal is still unpaid three days before expiry (decision 4). Then the owner is told the date the domain stops, and what the
registry's grace and redemption periods allow, as the registrar states them.

### 9.2 Expiry

An expired domain stays visible with the registrar's own way back, priced as the registrar prices it. Nothing is deleted.

### 9.3 Closing a store (D171)

Closing a store today "releases the domains". For a domain we registered or whose DNS we host, closing:
* disconnects it (removes the store's records from the project and the zone);
* keeps the registration and the zone, so the owner's email keeps working;
* turns renewal off unless the owner keeps it, and emails them.

The domain pages need only the owner's key, which `allowedWhenNotOpen()` already allows, so 8.1 to 8.4 work from a closed store.
`docs/store-closure.md` changes with this.

## 10. Data, permissions, money and law

### Tables (proposed)

All are `never` in `COPY_RULES`. Domains are never copied.

| Table | Holds |
|---|---|
| `domain_registrations` | Store, apex, registrar and its reference, status, registered and expiry dates, renewal, registrant, lock end, `transferred_out_at` |
| `domain_registrants` | Person or company, name, company, organisation number, email, phone, address, country, the TLD's extra fields, `verified_at` |
| `domain_purchases` | 4.4, forward-only by trigger, never deleted |
| `domain_prices` | 4.3 |
| `dns_zones` | Store, apex, host `vercel`, status (`importing`, `active`, `leaving`, `left`), nameservers last seen, `left_at` |
| `dns_changes` | 5.1 |

`store_domains` gains a nullable `zone_id`.

### Rules for each kind of data

* **Personal data.** `domain_registrants` holds the owner's or their company's details, so it is an entry in `PERSONAL_DATA`
  (`src/db/privacy.test.ts` would refuse it otherwise). It is kept while the domain is registered with us and for the period the
  registrar's contract asks after it leaves; erasure follows that. Registrant data goes to the registrar and the registry by the nature of
  a registration. WHOIS/RDAP redaction is the registrar's default for gTLDs (S1 confirms).
* **Permissions (D158).** Reading needs `settings:read`. Buying, renewing, DNS changes, moving and the transfer code are **owner only**
  (`requireOwnerRole`), as today's add and remove are. A role's own `domains` key can come later if owners ask.
* **Audit.** A new area `domains` in `AUDIT_AREAS`: `domain.bought`, `domain.renewed`, `domain.renewal_set`, `domain.dns_changed`,
  `domain.dns_undone`, `domain.nameservers_changed`, `domain.transfer_code_shown`, `domain.transferred_out`. Diffs name record types and
  names, never a secret.
* **Emails.** New owner emails are kinds in `EMAIL_KINDS`: `domain.registered`, `domain.failed_refunded`, `domain.renewal_due`,
  `domain.renewed`, `domain.renewal_failed`, `domain.expiring`, `domain.verify_contact`, `domain.transfer_out_done`. They are written in the
  owner's admin language (D312, `domains` catalogues, English and Norwegian by hand).
* **Money.** Invoices are Kaizena Flow's to the store, as plans and themes are, with VAT by `billingTaxRates()`. Registrations are not
  refundable once made (the terms say so, and the buy button links to them), but a failed registration is always refunded in full. Domains
  earn no referral credit (decision 7).
* **Law and vendors.**
  * The registrar(s) are named as sub-processors in Kaizena Flow's privacy notice and data processing agreement, in both languages (D312 P5).
  * Kaizena Flow's terms get a domains section. The registrant accepts the registrar's registration agreement and ICANN's registrant rights,
    linked at the buy button, as resellers must.
  * Vercel is a US company. The EU registrar for ccTLDs keeps those registrations in the EU (CLAUDE.md: keep data processing in the EU
    when adding a vendor).
* **Plans and parity.** `plan_features` gets *Buy and manage domains* (decision 3). The parity tracker gets one new row,
  `platform.buy-domains` (Shopify sells domains natively), rated as the phases land, with `pnpm parity:write`.

## 11. Build order

**The way out is built before buying opens to every store** (decision 9). Until phase 4 is done, buying is offered only on stores the
platform's admins choose.

| Phase | What | Done when |
|---|---|---|
| 0. Spikes | S1 to S5 (section 13) | Each answered in this doc with its date and source |
| 1. Foundation | Registrar adapter (Vercel), DNS host layer, `domainHealth()`, the hub page in its Homer form, `list_domains` and `check_domain` | Every store's domain shows its health, and the AI explains it |
| 2. Buying (generic TLDs) | Search, prices, purchases, registration job, automatic connection, renewals, contact verification, `search_domains`, `buy_domain`, `renew_domain`, `set_domain_renewal`, the platform's domains page | A test store buys a domain and is live on it with no DNS step. A failed registration refunds by itself |
| 3. DNS by hand and by the AI | `planDns()`, the record editor, recipes, history and undo, `change_dns`, `set_up_email`, `verify_domain_for`, `undo_dns_change`, the `domain` gate | The AI sets up Google Workspace email on a test domain after one yes, and *Undo* puts it back |
| 4. Moving away | Zone export, `nameserverSwitchCheck()`, the transfer code page, watching transfers, the move checklists, closing a store (9.3) | A test domain is moved to another registrar and DNS host with the store working throughout. Then buying opens to all stores |
| 5. Country TLDs | The EU registrar's adapter (S2): `no`, `se`, `dk`, `fi`, `eu`, `de` | A Norwegian test company buys a `.no` and is live on it |
| 6. Moving in | Move DNS here with zone import and comparison (5.4), Domain Connect (S3), transfer in | A domain with live email at another provider moves its DNS here with no lost record |

Phase 5 is what makes buying useful to most Nordic stores. Because it sits behind the adapter, it can start as soon as S2 is answered,
alongside phase 3 or 4.

## 12. Decisions for the owner

| # | Question | Recommendation |
|---|---|---|
| 1 | Who is the registrant? | The store's owner or their company, never Kaizena Flow. They own their domain |
| 2 | Country TLDs (`.no`, `.se`, `.dk`, `.eu`), which Vercel does not sell? | A second registrar, in the EU, behind the same adapter (phase 5) |
| 3 | Pricing and plans | Platform admins set prices per TLD (cost plus a margin, rounded). On every plan. No free first year for now |
| 4 | A renewal not paid | Don't renew unpaid. Remind at 30, 14, 7 and 1 days, then turn the registrar's auto-renew off three days before expiry |
| 5 | The AI and DNS | Every change after the owner's yes (the new `domain` gate), except the store's own records when connecting |
| 6 | Staff | Only owners buy, renew, change DNS and move. Staff with `settings:read` see |
| 7 | Referral credit on domains | None: a domain is a registrar's cost passed on, not Kaizena Flow's fee |
| 8 | Closing a store | It keeps its domains with its owners (registration and DNS), renewal off unless kept: a change to D171 |
| 9 | Opening buying | Only once moving away (phase 4) exists |
| 10 | Premium names (registry-priced) | Not offered in phase 2 |

## 13. Spikes before code

* **S1, Vercel as a registrar for a platform.**
  * Do Vercel's terms allow reselling registrations to our customers with them as registrant? Is there a programme for it?
  * How is the platform billed (currency, invoice)?
  * What happens around transfers: does `auth-code` unlock the domain, who approves the transfer, the lock after registration, whether
    changing the registrant email starts a lock?
  * Is WHOIS privacy on by default?
  * Who receives the contact verification email?
  * What are the rate limits?

  This needs one cheap test domain bought in a test team and transferred out.
* **S2, the EU registrar.** Candidates to evaluate (not yet verified against their pages): Openprovider (NL), CentralNic Reseller (DE),
  Realtime Register (NL), Gandi (FR). Judge them on:
  * support for `no`, `se`, `dk`, `fi`, `eu` and `de` through a reseller API;
  * setting nameservers at registration;
  * transfer-out codes;
  * EU data;
  * terms and price.

  Also read Norid's, the Swedish Internet Foundation's and Punktum dk's rules: who may hold a domain, the declarations a holder signs, and
  organisation numbers.
* **S3, Domain Connect.** What becoming a service provider takes (a template in the Domain Connect templates repository, signing keys),
  and which providers our owners use support it (Domeneshop, one.com, Loopia, Simply, GoDaddy, Cloudflare, …).
* **S4, Recipes.** Read each email provider's own set-up page (Google Workspace, Microsoft 365, Zoho, Proton, Fastmail, and the Nordic
  hosts owners use) and record the source and date in each recipe.
* **S5, Vercel DNS behaviour.** Record limits, whether `PUT /domains/{domain}/records` replaces everything (assume so: it is used only on
  an empty zone), how a domain already in another Vercel team is claimed (P8's challenges), and CAA defaults.

## 14. Tests

* **Pure.**
  * `planDns()`: a property test that it never touches a protected record and never leaves two SPF records or a CNAME beside another
    record; the effects' words.
  * `parseZone()`/`writeZone()` round trip.
  * `domainHealth()` per finding.
  * `transferBlockers()`, `nameserverSwitchCheck()` with fake answers.
  * The prices' margin check.
* **Adapters.** The registrar adapter against a recorded fake `fetch`: search, buy, order, renew, auth code, errors in words.
* **Integration** (`*.int.test.ts`):
  * a purchase paid, then registered and connected;
  * a purchase paid with the name taken, then refunded with a credit note;
  * a renewal, unpaid, then auto-renew turned off;
  * a DNS change applied, then a stale approval refused, then undo;
  * a closed store keeps its domains.
* **Scans.**
  * Only `src/server/registrars/` calls a registrar.
  * Only `domain-dns.ts` writes DNS.
  * The transfer code never reaches a log, the database, an email, a tool result or MCP (canary).
  * New tools have `TOOL_PERMISSIONS` and `TOOL_WORDS`.
* **End to end.**
  * Signed in as an owner (`e2e/signed-in/`) against a registrar and DNS stand-in built as the Auth stand-in is: search, buy, see it live,
    set up email, undo, take the zone file, see the transfer code after a fresh sign-in.
  * The stand-in is the only fake.

## 15. What this does not do

* **Email hosting or forwarding.** We set up the provider the owner chose; we don't host mailboxes.
* **DNSSEC.** Vercel DNS's support is read in S5. Until then it is neither offered nor promised.
* **Kaizena Flow's own domains.** They stay as they are, outside this.
* **Store emails from the owner's domain.** Sending them through Resend from the store's own domain becomes a recipe once DNS is hosted
  here, but it is a feature of its own.
