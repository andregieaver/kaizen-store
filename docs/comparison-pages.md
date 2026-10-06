# The comparison pages (WooCommerce, Wix, BigCommerce, Shopware, Squarespace, and the `/compare` overview)

Drafts of platform pages, in Kaizen's page builder content (`/admin/platform/pages`), written on 6 October 2026 next to the Shopify page
(`docs/comparison-page.md`). **They are all drafts and must stay drafts until the Kaizen claims below are true.**

| Address | Page |
|---|---|
| `/kaizen-vs-shopify` | Shopify (see `docs/comparison-page.md`) |
| `/kaizen-vs-woocommerce` | WooCommerce |
| `/kaizen-vs-wix` | Wix |
| `/kaizen-vs-bigcommerce` | BigCommerce |
| `/kaizen-vs-shopware` | Shopware 6 |
| `/kaizen-vs-squarespace` | Squarespace |
| `/compare` | Overview that links the six and says how the pages were written |

The five pages are made by one generator from one list of Kaizen's lines and one list of the other platform's lines
(`compare-lib.ts` and `compare-specs.ts`, kept out of the repository because they only produce page JSON). What each line says about
another platform comes from `docs/comparison-evidence/{platform}.md`: one row per topic, with the status the researcher found
(native, extension, higher plan, unverified), the sentence, the address that was read and the date (6 October 2026).

## Rules the copy follows

- **Comparative advertising** (Directive 2006/114/EC, the Norwegian Marketing Control Act): only statements that were *read* on the other
  platform's own help pages, documentation or listings, dated in each page's footnote. Where we found no statement either way the line is **left out**
  (the pages say so): "we found nothing" is never written as "it does not exist". Where a platform's own page says something is not possible
  (Wix's help centre on volume discounts and the 30-day price, Squarespace on pre-orders and per-customer VAT exemption, BigCommerce's blog on its
  own withdrawal function) the page says "according to ..." and names the source.
- A platform's **real strengths are on the page** ("Where X is the better fit"), taken from the same evidence: ownership and hosting (WooCommerce,
  Shopware), headless and B2B (BigCommerce, Shopware), templates and first-party tools (Wix, Squarespace).
- Prices are the platform's list prices on the day, in the currency read (no conversion); an extension's price is its listing partner's, named.
- No superlatives, urgency or Kaizen prices (`findClaims()` finds only the other platforms' named prices and product names).
- Importing: Kaizen's product import reads **Shopify's** file layout and its **own** (`docs/wave-2-data.md` 4.1). The pages say a direct importer
  for the platform is **not built** and that the export must be arranged in Kaizen's layout first. The WooCommerce page also offers the
  WordPress plugin (D169, D170), which is true today.

## Claims about Kaizen that are not true yet

The same six as on the Shopify page, in the same lines of every page, plus one thing the pages depend on:

| Claim | State |
|---|---|
| Product reviews with moderation | Missing: wave 5 |
| Back-in-stock emails | Missing: wave 5 |
| Pre-orders with a release date | Missing: wave 3, second run |
| Tiered and volume discounts | Partial: wave 5 |
| Scheduled report emails | Missing: wave 2 |
| Vipps and MobilePay at checkout | Missing or partial: wave 4 |
| "A business buyer's VAT number is checked before VAT is left off" | Built (D157); VIES behaviour needs an accountant's reading |

To publish a page earlier, take the unbuilt lines out of it in the builder (each is one block in the comparison, plus a clause in the cards
"Know why your numbers move", "Made for Nordic shops" and "Grow without an app bill").

## Before any of them is published

1. Build the rows above, or remove their lines.
2. Re-read each other platform's pages for the lines on the day: most were read on 6 October 2026, and some rest on a search excerpt only (see
   each evidence file's cautions). Squarespace's help pages were updated between August and October 2026; Shopware's Bring and Vipps plugins name
   older versions, which the page says.
3. Open each draft in the builder, look at it on a phone, and publish (publishing runs the accessibility checker).
4. Pages also state the Kaizen side's hero heading with the site's `gradient-text` class, as the home page does.
5. A person should read the legal-sensitive lines (the withdrawal and VAT rows, which describe other platforms' compliance features).

## Not on the pages, on purpose

DAC7 for any other platform (nothing verified), "Kaizen explains why sales changed" against others (nothing verified), Porterbuddy and Helthjem
integrations of others (not found, so not claimed missing), BigCommerce B2B specifics (sources conflict), WooCommerce's refer-a-friend, wishlist
and scheduled-report features (not verified), Wix's withdrawal handling and EU data region (not verified), and Squarespace's GPSR, Omnibus, Vipps,
MobilePay, loyalty, wishlist, marketplace and scheduled-report features (the help centre search found nothing, which is not proof).
