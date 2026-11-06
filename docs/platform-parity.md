# The platform has what stores have

The owner, 6 November 2026: *anything developed for store owners or stores must be developed for the platform and the main store as
well.* Kaizena Flow's own site and store are run from the platform admin (`/admin/platform`); its rows are `store_id is null` or
`platform_*` tables. The rule is in `CLAUDE.md` (Conventions). This file is its list: what a store's admin has, and whether the
platform has it. Tick a row (move it to *Built for both*) in the change that brings it.

Found by comparing the store admin's sections (`src/app/admin/(gated)/[store]/`) with the platform's (`…/platform/`) on 6 November 2026,
then reading each. A row marked *check* was not read in depth: decide it when it is next touched.

## Missing on the platform, and it applies

| Store feature | Store admin | What it is for Kaizena Flow | State |
|---|---|---|---|
| Zapier, Make and Slack (D41, D101) | Integrations | Kaizena Flow's own events (a store asked for, a store made or opened, a plan started or ended, a notice of illegal content) to the operator's Slack channel and automations | Missing |
| Events to own endpoints (D354) | Integrations → Your own endpoints | The same platform events, signed, to Kaizena Flow's own systems | Missing |
| "Add to Slack" (D101) | Integrations → Slack | Picking the platform's channel through Slack's own page, not a pasted address | Missing |
| Accounting: Tripletex, Fiken (D453, D460) | Integrations | Kaizena Flow's plan invoices in Human Web's books. They are Stripe's invoices (D35), not Kaizena Flow's own series, so this is Stripe's payouts and invoices into the books: to decide | To decide |
| Analytics (D152) | Analytics | Kaizena Flow's own site: visits, sign-ups, the funnel to a paid plan | Check |
| Redirects and the 404 report (D168) | Website → Redirects | Kaizena Flow's moved and missing pages | Missing |
| The subscriber list, segments, broadcasts, automations (D295 to D298) | Marketing | Email to owners and leads who asked for it (today: plan reminders only) | Missing |
| Ads and conversions (D303) | Sales → Ads | Sign-ups and plans as conversions for Kaizena Flow's own ads | Check |
| Deals and pipelines (D464) | Sales → Deals | Access requests and owners as leads | Missing |
| Versions compared and staging (D358) | Website → Staging | Trying a change to Kaizena Flow's site before it is live | Check |
| Staff and permissions (D158) | Settings → Staff | Platform admins, and what each may do | Check |
| Translate (D312) | Website → Translate | Kaizena Flow's pages in each language (Norwegian is being built, D312) | Check |
| Personal data requests (D162) | Settings → Privacy | A person's data held by Kaizena Flow itself (retention and the record of processing exist) | Check |
| Campaigns (D114) | Sales → Campaigns | Timed prices on plans (plan discount codes exist) | Check |
| Custom fields (D118) | Settings → Fields | Fields of Kaizena Flow's own on its customers and stores | Check |
| Site search merchandising (D324) | Search | Kaizena Flow's site's own search, if it gets one | Check |

## Built for both

| Feature | Store | Platform |
|---|---|---|
| Pages, blog, content types, media, menus, headers, footers, fonts, design | Website | Website |
| Templates, themes | Website, Design | Themes, Templates |
| The AI manager and autopilot | AI manager | Settings → AI manager |
| Support desk and chat assistant | Support | Support |
| A/B tests | Experiments | Settings → A/B tests |
| SEO, cookies, Google reviews, emails, languages | Settings | Settings |
| Referrals and affiliates | Affiliates | Plans → Referrals |
| Abandoned checkout reminders | Cart reminders | Plans → Reminders |
| Discount codes | Discounts | Plans → Discounts |
| Activity log | Activity | Settings → Activity log |
| Apps and AI assistants (D439, D441) | Settings → Apps and API | Settings → AI assistants and apps, App listings |

## Store-only: cannot apply to Kaizena Flow

Kaizena Flow sells plans, premium themes and domains through Stripe Billing (D18, D35), not goods: it has no catalogue, stock, carts,
parcels or returns. So these stay store-only: products, inventory, orders, deliveries, returns, the store's invoices and credit notes,
gift cards, price lists, customer groups and company accounts, bookings, hosts, subscription boxes, wishlists, recommendations, product
layouts, product feeds, the bonus program, creators, the Dream Factory, store setup and billing (the platform is what bills).
