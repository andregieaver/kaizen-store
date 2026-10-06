# The "Kaizen compared with Shopify" page

A draft platform page, made in Kaizen's own page builder content (`/admin/platform/pages`, address `/kaizen-vs-shopify`, id
`df7280b5-51cf-494b-930d-b280801643aa`). **It is a draft and must stay one until the claims below are true.** It was written on the
assumption that every wave of `docs/parity-plan.md` is built and tested; today that is not so.

**Correction, 6 October 2026:** the row was inserted already published (`published_at` set at 09:12 UTC) instead of as a draft. It was unpublished
by SQL (`published = null`, `published_at = null`) the same day, after the other comparison pages were added (`docs/comparison-pages.md`). Page caches may
have kept the page for a short time; `first_published_at` stays set, which only affects dates. Insert new platform pages with `published` left null.

## Rules the copy follows

- **Comparative advertising** (Directive 2006/114/EC, and the Norwegian Marketing Control Act): every statement about Shopify is objective and
  checkable, taken from a tracker row whose Shopify source was *read* (`shopify.fetched: true` in `docs/parity/rows`, read on 2 and 3 October 2026),
  and the page says so in its footnote. Where no source was read, the page says nothing about Shopify (the "Made for Nordic shops" and "Your data
  stays in Europe" cards, for example, only describe Kaizen). It also says where Shopify is the better fit.
- No superlatives, urgency or price claims (`findClaims()` finds nothing in the page). The only price is one app's, named and attributed
  ("Appointo, for example, starts at 14 USD a month").
- The legal pages and the AI are described as tools, never as legal advice or as a guarantee.

## What each claim rests on

| Claim on the page | Evidence | State today |
|---|---|---|
| Legal invoices and credit notes, gap-free, PDF and customer page | D159, `orders.invoices-and-vat-receipts-for-orders`, `orders.credit-notes-for-refunds` | Built; rows partial until a person has reviewed the texts |
| 30-day lowest price, only on a real reduction | `customers.omnibus-30-day-lowest-price-reference` | Full |
| Withdrawal function, exclusions, digital waiver, 14-day clock | D153, `international.withdrawal-exclusions-and-digital-waiver` | Full |
| Product safety information (GPSR) | `international.gpsr-safety-information` | Full |
| DAC7 report | `international.dac7-reporting`, D71 | Full |
| VAT per country, OSS and IOSS figures | D157, D161 | Built; the classification rules need an accountant |
| Appointments, stays, rentals, subscription boxes, downloads | `platform.bookings-appointments-rentals`, D65 to D70, D102 | Full |
| Hosts, own Stripe account, commission | D71, `platform.marketplace-and-multi-vendor` | Built; row partial |
| Several stores in one control center, store copies | `platform.multi-store-management`, D107, D129 | Full |
| AI manager, translate the whole store, pages from an interview, own AI provider | D73, D92, D94, D103 to D105, D110 | Built |
| Profit, lifetime value, cohorts, forecast, "why did sales change" | D152, `analytics.explaining-why-sales-changed` | Full |
| Wishlists, refer-a-friend | `customers.wishlists`, `customers.customer-referral-program` | Full |
| Loyalty credits with expiry reminders | D130, `customers.loyalty-and-rewards` | Built; row partial |
| Two-step sign-in, roles, activity log, collaborator access | D158 | Built |
| Carriers, pickup points, Brønnøysund, Tripletex, Slack, Zapier, Make | D41, D101, D124, D133 to D138 | Built; carrier checks are bucket B |
| Product CSV and redirects from Shopify, files out | D165, D168 | Built (products and redirects only: the page promises no more) |
| WordPress site with checkout in Kaizen | D169, D170 | Built; tried on a real site on 6 October 2026 |
| Database and servers in Ireland | `docs/plan.md`, `vercel.json` (`dub1`) | True |
| **Product reviews with moderation** | `customers.product-reviews-and-ugc` | **Missing: wave 5** |
| **Back-in-stock emails** | `customers.back-in-stock-notifications` | **Missing: wave 5** |
| **Pre-orders with a release date** | `catalogue.pre-orders` | **Missing: wave 3, second run** |
| **Tiered and volume discounts** | `customers.tiered-and-volume-discounts` | **Partial: wave 5** |
| **Scheduled report emails** | `analytics.scheduled-report-emails` | **Missing: wave 2** |
| **Vipps and MobilePay at checkout** | `checkout.vipps`, `international.vipps-and-mobilepay` | **Missing or partial: wave 4** |
| Labels also for PostNord | none | The page does not claim it: PostNord cannot book yet (D136) |

## Before it is published

1. Build the six bold rows above, or take their lines out of the page in the builder (each is one block in the comparison, plus a clause in the
   cards "Know why your numbers move", "Made for Nordic shops" and "Grow without an app bill").
2. Have the comparison read by a person: Shopify's pages change, and each Shopify line should be checked against its source again on the day.
3. Open the draft in the builder (`/admin/platform/pages`), look at the page on a phone, and publish. Publishing runs the accessibility checker.
4. The hero's heading uses the site's `gradient-text` class, as the home page does.
