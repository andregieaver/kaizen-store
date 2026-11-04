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
4. **The order page writes times in Oslo time** whatever the store's time zone (`"Europe/Oslo"` in `orders/[orderId]/page.tsx`).
5. **A refused e-invoice shows staff a raw JSON error** (`einvoiceResponse()`, `src/server/einvoices.ts`).
6. **Bundles have no quantity-rule fields** in the product editor (`BundleSection` replaces the variants section), though D323 E.1 gives
   bundles quantity rules.
7. **An option value removed in the editor may come back** after a reload, its variants unticked: the editor rebuilds options from every
   variant, switched-off ones included. Read from the code, not tried.
8. **The autopilot's *Do it and tell me*** keeps what it did (`told`) but nothing shows or sends it, so it behaves as *Just do it*.
9. **"Ask the AI manager" from an alert sends the alert's words at once**, where D416 and `AskOnArrival` say they wait in the box unsent.
10. **The product editor cannot take a picture from the media library**; an AI-edited picture must be downloaded and uploaded again.
11. **Payouts' "Stripe's fees" column also holds Kaizena Flow's fee** (`feesMinor`, `src/lib/payouts.ts`).
12. **A store with no country is billed with Norwegian VAT** (`store.details.country ?? "NO"`): safe for a Norwegian seller, worth knowing.
13. **Cancelling a plan makes a store that began with a trial private** when the plan ends, as at the trial's end. Confirm it is meant.
14. **The deliveries list of a webhook endpoint defaults to 25** where the contract says 50.
15. **Two storefront API mismatches**: `POST /carts` takes an empty body though the document marks it required, and a missing cart is
    `not_found` on the line routes but `no_such_cart` on `GET /carts/{cart}` and checkout.

## Admin words that are out of date or wrong

- The Integrations page (`notifications` `carriersHint`) and the admin map say only Posten/Bring can be connected; all four carriers can (D136–D138).
- The staff dispute email says evidence is sent in Stripe's Dashboard; since D417 it is sent from *Prepare the evidence* on the order.
- The invoice settings' notes say e-invoices (XRechnung, Peppol, EHF) are not built; D403 built them.
- The chat page's *How it works* says conversations are kept only in the visitor's tab; since D216 the site keeps them.
- Staff alerts says staff emails are in English; they go in each person's admin language (D312, D395). `docs/analytics.md` says the same.
- Staff alerts' defaults leave out disputes and overdue payments on terms, which owners get. The alert-level choice reuses the label *How often*.
- The erase screen says kept sales are stored without the person's name, address and email; D162 removes those only when the bookkeeping period ends.
- The admin map's *Export customers* says marketing consent is not recorded; the export has `marketing_consent` (D295). Its Roles line says
  six starting roles; there are seven (*Support agent*). Its Header and footer entry names business details the store's page does not have.
- The Locations hint says a place's country is only a label, kept for later; D383 routes orders by it.
- D383 says routing takes `products:write`; the page offers it with `settings:write` only.
- The product import names only Kaizena Flow and Shopify files; WooCommerce files are read too (D384).
- *Prepare reorder* says press *Create*; the button is *Save as a draft*.
- With gift cards off, the gift card list says checkout has no gift card field; cart and checkout always show it.
- The Payments page tells non-owners only an owner can switch payments, but non-owners cannot open it; Analytics settings likewise.
- The Payments card puts Swish in Stripe's Dashboard; `mollie-card.tsx` says Stripe does not give Swish to stores on Kaizena Flow.
- The registry's tracking line promises tracking emails for all four carriers; D238 says Bring's only, today.
- An order's tracking note says carriers are connected under Shipping; they are under Integrations.
- A suppressed email shows as "the customer's address does not take emails"; suppression means an erased order or person, or a demo store.
- The setup refusal names the *Plan* page, now *Billing*, in English only. Billing's trial line says a plan is first charged when the trial
  ends; in its last two days it is charged at once.
- `settings.en.ts` (SEO description) misses "as ChatGPT"; `website.en.ts` (staging name placeholder) misses words.
- The Pages list hands the header choice `"Your store"` in English, so the Norwegian admin reads *Your store viser denne toppteksten*.
- The article editor's *Authors* link opens the Blogs page. The Advanced fold of the product editor names "where it is sold", which is
  under *Price and stock*. The reports page links *Settings, Invoices*; the menu says *Invoicing*.
- Decision rows out of step with the code: D63 (no reverse charge; D157 added it, and the Selling to businesses rule and Company page still
  say prices are always charged with VAT), D359 (the trial's end stops nothing; D420 replaced it), D445 (nothing built; the Redirects
  *Old shop* tab is), D103 (staff cannot use the AI manager, while skills offer *Share with the store's staff*), D130 and `docs/bonus.md`
  (Bonus credits under Sales; the menu has Marketing; the expiry counts from earned or from usable).
- The Norwegian withdrawal button reads *Bekreft angrer* (`nb-returns.ts`), most likely meant as *Bekreft angring*. Legal text: a person
  should read it.

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
Norwegian docs name these in italics.
