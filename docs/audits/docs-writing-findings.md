# What writing the docs found (wave 14 E6, 4 November 2026)

Writing the owners' and developers' docs from the code (D442) meant reading every screen and its words in English and Norwegian. These
are the faults the writers found and did not fix, each confirmed in the code they name. The docs describe what the code does today; where
a fault is fixed, the page that mentions it is checked again. Fixed in the same changes as the docs: a resend's webhook id, the reference's
signature checks, two Admin API descriptions (contract 1.5) and the docs' Markdown reading a paragraph a line at a time.

## Behaviour

1. **An AI assistant's kept change shows only "Run {tool}."** `approvalSummary()` (`src/lib/owner-tools.ts`) falls back to the tool's name,
   so the owner approves *Run add_order_note.* without the order or the note. *Fixed 4 November: every tool that can be kept has words
   with its subject and values, the rest its title and its input in plain words.*
2. **The shopping agents' profile address can be dead.** For a store without its own domain, `agentProfileUrl()` gives
   `https://kaizenaflow.com/.well-known/ucp`, which is not served; the profile is at `/s/{store}/.well-known/ucp`. The agents' MCP also
   answers only the first ten calls of a batch, silently. *Fixed 4 November: the address is where the profile is served, a store that
   sells in one country serves it (it answered 404), and a batch over ten is refused whole.*
3. **The WordPress plugin refuses a cart line over 20 units**, though a quantity rule may allow 9,999 (D323). *Fixed 4 November in plugin
   1.2.1: a line takes up to 9,999.*
4. **The order page writes times in Oslo time** whatever the store's time zone (`"Europe/Oslo"` in `orders/[orderId]/page.tsx`). *Fixed
   5 November: the order page and its payment terms card write the store's own time zone. About 35 other store screens and components
   (customers, companies, wishlists, subscriptions, campaigns, experiments, cart reminders, the email log, domains and more) still write
   Oslo's; many are components without the store, so it is a change of its own.*
5. **A refused e-invoice shows staff a raw JSON error** (`einvoiceResponse()`, `src/server/einvoices.ts`). *Fixed 5 November: a short
   page in the staff member's admin language says why, each reason in words, with a link back.*
6. **Bundles have no quantity-rule fields** in the product editor (`BundleSection` replaces the variants section), though D323 E.1 gives
   bundles quantity rules.
7. **An option value removed in the editor may come back** after a reload, its variants unticked: the editor rebuilds options from every
   variant, switched-off ones included. Read from the code, not tried. *Confirmed by a test and fixed 5 November: the editor opens with the
   options of the variants sold (`editorOptions()`); the switched-off variant stays, unticked, so typing the value again brings it back
   rather than a new one; the product file still carries it as stored. Seen on the way: a value's place follows the variants' SKUs (S after
   M), not the order typed.*
8. **The autopilot's *Do it and tell me*** keeps what it did (`told`) but nothing shows or sends it, so it behaves as *Just do it*. *Fixed
   5 November: the Autopilot page lists each change under its step or event (an event's are now kept), and the daily digest and weekly
   report say how many there were, reason enough to send.*
9. **"Ask the AI manager" from an alert sends the alert's words at once**, where D416 and `AskOnArrival` say they wait in the box unsent.
   *Fixed 5 November: from the briefing's email they wait in the box; the button beside an alert still sends them (D348).*
10. **The product editor cannot take a picture from the media library**; an AI-edited picture must be downloaded and uploaded again.
11. **Payouts' "Stripe's fees" column also holds Kaizena Flow's fee** (`feesMinor`, `src/lib/payouts.ts`). *Fixed 5 November: Kaizena
    Flow's fee has a column of its own on the page, in the totals and in the export (`kaizena_flow_fee`), read from each charge's payment.*
12. **A store with no country is billed with Norwegian VAT** (`store.details.country ?? "NO"`): safe for a Norwegian seller, worth knowing.
    *Fixed 5 November, as the owner decided: the country is mandatory. Nothing is billed without it (a plan, a premium theme or a domain
    waits, `NO_COUNTRY`), Billing says where to add it, and the business details ask for it with none chosen (D18).*
13. **Cancelling a plan makes a store that began with a trial private** when the plan ends, as at the trial's end. Confirm it is meant.
    *Decided 5 November: kept (a month paid should not keep a trial store public for good). Billing now warns while the plan is ending,
    and the banner says the plan ended instead of the trial (D420).*
14. **The deliveries list of a webhook endpoint defaults to 25** where the contract says 50. *Fixed 5 November: the Admin API's default is
    the contract's 50.*
15. **Two storefront API mismatches**: `POST /carts` takes an empty body though the document marks it required, and a missing cart is
    `not_found` on the line routes but `no_such_cart` on `GET /carts/{cart}` and checkout.
16. *Seen 5 November while making two end-to-end tests steady, not by the writers:* in WebKit, a quantity typed or a line removed in the
    cart in the moment after it loads, before its script has taken over, was sometimes lost (the tests now wait for the script; 1 run
    in 5 failed before, none after). A shopper on a slow phone could meet the same. Worth a look at whether the cart's forms should
    work, or refuse plainly, in that moment.

## Admin words that are out of date or wrong

- The Integrations page (`notifications` `carriersHint`) and the admin map say only Posten/Bring can be connected; all four carriers can
  (D136–D138). *Fixed 5 November: the hint says all four connect with the store's own agreement, and the admin map's Integrations and
  Shipping carrier entries say the same.*
- The staff dispute email says evidence is sent in Stripe's Dashboard; since D417 it is sent from *Prepare the evidence* on the order.
  *Fixed 5 November: the email says to prepare and send the evidence from the order with Prepare the evidence.*
- The invoice settings' notes say e-invoices (XRechnung, Peppol, EHF) are not built; D403 built them. *Fixed 5 November: the notes say each
  invoice and credit note downloads as an e-invoice from the order page (EN 16931 in UBL, the Peppol BIS Billing 3.0 format EHF uses), and
  that sending it through the Peppol network is not built.*
- The chat page's *How it works* says conversations are kept only in the visitor's tab; since D216 the site keeps them. *Fixed 5 November:
  it says the site keeps them, deleted a day after they end with support off, else after the support settings' 30, 60 or 90 days.*
- Staff alerts says staff emails are in English; they go in each person's admin language (D312, D395). `docs/analytics.md` says the same.
  *Fixed 5 November: the page says each person's emails are in their own admin language (the contact address in Norwegian when that is the
  store's main language, else English); `docs/analytics.md` and `staff-alerts.ts`'s comment say the same.*
- Staff alerts' defaults leave out disputes and overdue payments on terms, which owners get. The alert-level choice reuses the label *How
  often*. *Fixed 5 November: the defaults name disputes and overdue payments on terms, and the alert-level choice is labelled Which
  alerts.*
- The erase screen says kept sales are stored without the person's name, address and email; D162 removes those only when the bookkeeping
  period ends. *Fixed 5 November: the screen says kept sales keep the name, address and email until the period ends, set aside and never
  emailed, and are then made anonymous.*
- The admin map's *Export customers* says marketing consent is not recorded; the export has `marketing_consent` (D295). Its Roles line says
  six starting roles; there are seven (*Support agent*). Its Header and footer entry names business details the store's page does not have.
  *Fixed 5 November: Export customers names the `marketing_consent` column (the file is still not a mailing list), Roles names Support
  agent among the seven, and Header and footer sends business details to Company.*
- The Locations hint says a place's country is only a label, kept for later; D383 routes orders by it. *Fixed 5 November: the hint says the
  country decides which locations are the delivery country's when orders take those first.*
- D383 says routing takes `products:write`; the page offers it with `settings:write` only. *Fixed 5 November: the page was out of step, not
  the row: the Locations page offers the choice with `products:write`, the key its action already asked for.*
- The product import names only Kaizena Flow and Shopify files; WooCommerce files are read too (D384). *Skipped 5 November: the product
  import's words, `products.*.ts` and the moving files are another session's work at the same time.*
- *Prepare reorder* says press *Create*; the button is *Save as a draft*. *Fixed 5 November: it says press Save as a draft.*
- With gift cards off, the gift card list says checkout has no gift card field; cart and checkout always show it. *Fixed 5 November: it
  says the cart and the checkout keep the field, so cards already sold or issued can still be spent.*
- The Payments page tells non-owners only an owner can switch payments, but non-owners cannot open it; Analytics settings likewise. *Fixed
  5 November: the words nobody could see are gone (Payments' `ownerOnly` and Analytics settings' note Only owners can change these
  settings): both pages are the owner's alone (D158), as the navigation and the admin map say.*
- The Payments card puts Swish in Stripe's Dashboard; `mollie-card.tsx` says Stripe does not give Swish to stores on Kaizena Flow. *Fixed 5
  November: the Payments card says Swish comes through Mollie, not Stripe.*
- The registry's tracking line promises tracking emails for all four carriers; D238 says Bring's only, today. *Fixed 5 November: the two
  carrier notifications say Posten / Bring's reports send them; the other carriers' are shown on the order and send no email yet.*
- An order's tracking note says carriers are connected under Shipping; they are under Integrations. *Fixed 5 November: the note, the stop
  reason and the Check now refusal say Integrations.*
- A suppressed email shows as "the customer's address does not take emails"; suppression means an erased order or person, or a demo store.
  *Fixed 5 November: it says the order's customer was erased, or the store is a demo store.*
- The setup refusal names the *Plan* page, now *Billing*, in English only. Billing's trial line says a plan is first charged when the trial
  ends; in its last two days it is charged at once. *Fixed 5 November: the refusal names the Billing page and, with the setup's other
  refusal, is said in the owner's language; Billing's trial line says a plan chosen in the trial's last two days is charged at once. The
  Dream Factory's plan step names Billing too.*
- `settings.en.ts` (SEO description) misses "as ChatGPT"; `website.en.ts` (staging name placeholder) misses words. *Not confirmed 5
  November: `settings.en.ts` reads "AI assistants such as ChatGPT and Claude" and `website.en.ts` "What the changes are for, such as Spring
  launch", as they have since they were written (D312 A8, D358), the Norwegian with them; nothing changed.*
- The Pages list hands the header choice `"Your store"` in English, so the Norwegian admin reads *Your store viser denne toppteksten*.
  *Fixed 5 November: the list hands it the catalogue's words (Butikken din viser denne toppteksten), with the rest of the list's words
  (below).*
- The article editor's *Authors* link opens the Blogs page. The Advanced fold of the product editor names "where it is sold", which is
  under *Price and stock*. The reports page links *Settings, Invoices*; the menu says *Invoicing*. *Fixed 5 November: the editor's link
  opens Authors while the store has none, else Blogs, as it says; the reports page links Settings, Invoicing. Skipped: the product editor's
  Advanced fold, as `product-editor.tsx` and `product.*.ts` are another session's work at the same time.*
- Decision rows out of step with the code: D63 (no reverse charge; D157 added it, and the Selling to businesses rule and Company page still
  say prices are always charged with VAT), D359 (the trial's end stops nothing; D420 replaced it), D445 (nothing built; the Redirects *Old
  shop* tab is), D103 (staff cannot use the AI manager, while skills offer *Share with the store's staff*), D130 and `docs/bonus.md` (Bonus
  credits under Sales; the menu has Marketing; the expiry counts from earned or from usable). *Fixed 5 November: D63 says reverse charge
  since D157 (so do the Selling to businesses rule and the Company page); D359 that since D420 a trial that ends with no plan makes the
  store private; D103 that a skill shared with the store reaches its other owners, and the skill's share box says so (Share with the
  store's other owners: staff who are not owners have no AI manager); D130 and `docs/bonus.md` that Bonus credits is under Marketing and
  expiry counts from when credits become usable (the Bonus page's hint said earned, and now says usable). Skipped: D445, another session's
  row. The shopper's rules on the Bonus page still say "after you earn them": they are held to the storefront's own words in four
  languages, a change of its own.*
- The Norwegian withdrawal button reads *Bekreft angrer* (`nb-returns.ts`), most likely meant as *Bekreft angring*. Legal text: a person
  should read it. *Skipped 5 November: legal text, left for a person to read.*

## Norwegian words that differ between screens

The AI manager: *KI-assistenten*, also *KI-lederen*, *KI-sjefen*, and *AI-assistent(er)* in the shop chat and connected apps. A plan:
*abonnement* and *plan*. Two-step sign-in: *Innlogging i to trinn*, *Totrinnsinnlogging*, *Totrinns innlogging*. Carriers:
*Transportører* and *fraktselskaper*; booking *Book* and *Bestill*. A dispute: *tilbakeføring* and *tvist*. Pickup: *Hent* and *Hent selv*.
Customer tags: *Stikkord* and *Merke*. Reviews: *Anmeldelser* and *Omtaler*; *Bekreftet kjøp* and *verifiserte kjøp*. Bonus: *Bonuspoeng*
and *bonuskreditt*. Revenue: *Salgsinntekt* and *Omsetning*; returning customers *Gjenkommende* and *Gjenkjøpende*. Others: *Salg/Selg til
bedrifter*, *betalingsvilkår/betalingsbetingelser*, *Din konto/Kontoen din*, *Representant/mellommann* (IOSS), *utenom/utenfor*,
*Pakkseddel/pakkliste*, *Egen vare/Egendefinert vare*, *Lag kopi/Dupliser*, *Mønster for SKU/Varenummer*, *alternativ/valg*, *Fortsett å
selge når den er utsolgt/Selg videre når utsolgt*, *Legg i handlekurv/handlekurven*, *Nyhetsbrev* for both broadcasts and the sign-up block,
*Over siden* and *Over siden, ikke oppå* for the header's two overlays, and the Tax menu text calls the VAT number *organisasjonsnummer*.

## Screens still in English in the Norwegian admin

The product editor's *Write with AI* panel; the autopilot's retry choices; the Pages, Blog, Headers and Footers lists' buttons (*New page*,
*Create with AI*, *Front page*, *New article*, …) and the live site's edit buttons; *Copy of …*; the Domains page's title; *Where it's
used* on product layouts; the export jobs' *Download* and *Open*; the file formats (*Standard*, *Excel (Nordic)*); the order page's *VAT
treatment* panel; the carrier choice *Other*; and the extra VAT categories' names (*Food and drink*, *Books*, *Children's goods*). The
Norwegian docs name these in italics. *Fixed 5 November: the autopilot's retry choices (said in the admin's language, answered as the plan
wrote them); the Pages, Blog, Product layouts, Headers and Footers lists (titles, introductions, New …, Create with AI, Categories and
tags, Front page, All products page, Special pages with each place's words, the layouts' table with Where it's used) and the live site's
Edit page, Edit text, Done editing and Custom CSS, given in the editor's admin language by `/api/platform/editor`; Copy of … (Kopi av … in
the Norwegian admin); the Domains page's title and introduction; the export jobs' Download and Open; the order page's VAT treatment panel
and its reverse-charge row; the carrier choice Other; and the extra VAT categories' names and hints (`common.vatCategories`, in the product
editor's field and on draft orders). The Norwegian docs name them in Norwegian now. Skipped: the product editor's Write with AI panel and
the file formats (Standard, Excel (Nordic)), another session's files at the same time. Still in English: the rest of an export job's card
(Recent exports, rows, Your file is ready, from `data-admin.ts`, which the imports share) and the live site's text editor's own buttons.*
