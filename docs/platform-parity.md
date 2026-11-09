# The platform has what stores have

The owner, 6 November 2026: *anything developed for store owners or stores must be developed for the platform and the main store as
well.* Kaizena Flow's own site and store are run from the platform admin (`/admin/platform`); its rows are `store_id is null` or
`platform_*` tables. The rule is in `CLAUDE.md` (Conventions). This file is its list: what a store's admin has, and whether the
platform has it. Tick a row (move it to *Built for both*) in the change that brings it.

**How the gap closes:** [`platform-parity-plan.md`](platform-parity-plan.md) (chosen 6 November 2026, D466; steps 1 to 5 built: Kaizena Flow's store exists, its owners and applicants are its customers (D467), and it serves kaizenaflow.com (D484, on)):
Kaizena Flow's site and its customers move into a store of its own, which gets every store page for a website by itself (*Store*, with
the plan's step), and the platform console gets what is about running the business (*Console*, C1 to C6).

Read page by page on 6 November 2026: every page in a store's sections (`src/lib/store-nav.ts`) against the platform's
(`src/lib/platform-nav.ts`), the tables behind each and the server code that reads them.

## Missing or partial on the platform, and it applies

20 rows (read again 9 November 2026, after the site switch, D484; Kaizena Flow's money in the books, D508).

### Website

Nothing left: kaizenaflow.com is served from Kaizena Flow's store since the switch (D484, on in production), so every page of a store's
Website section is the site's (see *Built for both*).

### Marketing

| Store page | Kaizena Flow today | Comes by |
|---|---|---|
| Ads and conversions | The store's tags and conversions on kaizenaflow.com's pages, through Kaizena Flow's store (D484); a sign-up or a paid plan is not yet sent as a conversion (the platform's own events) | Console, with C2 |
| Campaigns | Discount codes only; no timed price on a plan | Console, C5 |

### Analytics

| Store page | Kaizena Flow today | Comes by |
|---|---|---|
| Overview | The platform home counts stores, paying, overdue, without a plan, new this week, requests; no revenue, no comparison with a period, no funnel | Console, C2 |
| Customers | None: no cohorts of owners, no lifetime value | Console, C2 |
| Marketing | Referral totals, recovered plan checkouts; no channels or cost per new owner | Console, C2 |
| Reports | None | Console, C2 (later) |
| Analytics settings | None: no targets | Console, C2 |
| Live | Visitors on kaizenaflow.com now, through Kaizena Flow's store (D484); no sign-ups today | Console, C2 (sign-ups today) |
| Payouts | Kaizena Flow's own Stripe payouts read and posted to the books with their fees (D508), counted on Plans → Analytics; no list of them and what each settled | Console, C3 (next of D508) |

### Customers

| Store page | Kaizena Flow today | Comes by |
|---|---|---|
| Custom fields | On Kaizena Flow's customers through its store (D467); none on stores themselves | Console (fields on stores) |

### Settings

| Store page | Kaizena Flow today | Comes by |
|---|---|---|
| Search | None: the site has no search; Settings → Search is the stores' search experiment | Store, step 5, if wanted |
| Workflows | Kaizena Flow's events go to Slack, Zapier and Make (D465); no rules on them | Console, C4; the site's own events, Store |
| Integrations: own endpoints | None | Console, C4 (next of D465) |
| Integrations: *Add to Slack* | A pasted webhook (D465) | Console, C4 (next of D465) |
| E-invoices (EHF, D463) | Kaizena Flow's plan invoices are Stripe's and go by email; from 1 January 2027 an owner's business registered in ELMA is owed EHF, which needs Kaizena Flow's own documents sent through B1's sender | Console, C3, with the books |
| Apps and API | Settings → AI assistants and apps and App listings oversee others' apps; no Admin API for the platform (`api_tokens` needs a store) | Console, C4 |
| AI | Has more than a store (pause, web search, prices, the eval); lacks how long AI manager conversations are kept | Console |
| Team (roles) | Platform → Settings → Team adds and removes platform admins (D471); every one can do everything: no roles yet | Console, C1 |
| The language a visitor sees first (D479) | Kaizena Flow's site suggests a visitor's language and never sends them to it (D312); no choice of rule. The switcher's look (by name, code or flag, side by side, one under another or a list, by screen size) is built for both | Console: the same rule on `platform_settings`, read by the proxy at `/` (next of D479) |

### Home

| Store page | Kaizena Flow today | Comes by |
|---|---|---|
| Home | An attention list (requests, failing jobs, overdue and suspended stores, failed emails and AI) and counts; no briefing, revenue or alerts | Console, C2 |

## Built for both

| Feature | Store | Platform |
|---|---|---|
| Pages, blog (one), content types, media, menus, headers, footers, fonts, design | Website | Website (a twin: `platform_theme_installs`, `platform_page_roles`) |
| Templates, themes | Website, Design | Themes, Templates |
| The AI manager and autopilot | AI manager | Settings → AI manager |
| Support desk and chat assistant | Support | Support (a store's handoff requests do not apply: Kaizena Flow's AI never acts on a store, `docs/support.md` 2.8) |
| Speed | Analytics → Speed | Usage and limits → speed (`own_speed_samples`) |
| SEO, cookies, Google reviews, emails, languages | Settings | Settings |
| The language switcher's look by screen size (D479) | Header and footer, *Languages* | Header and footer, *Languages* |
| Legal pages | Settings → Legal pages | Pages → *Write the legal pages* (terms, privacy, DPA, D408) |
| Payments | Settings → Payments (Stripe Connect) | Settings → Stripe (Stripe Billing) |
| Referrals and affiliates | Affiliates | Plans → Referrals (creators: referrers with a commission) |
| Abandoned checkout reminders | Cart reminders | Plans → Reminders |
| Discount codes | Discounts | Plans → Discounts |
| Activity log | Activity | Settings → Activity log |
| Apps and AI assistants (D439, D441) | Settings → Apps and API | Settings → AI assistants and apps, App listings |
| Zapier, Make and Slack (D41, D101; the platform's D465) | Integrations | Settings → Integrations: Kaizena Flow's own events (a store requested, made or opened, a plan started, changed, cancelled or not paid, a notice of illegal content) |
| Customers, with leads, notes, tags, timeline, import and export | Customers | Kaizena Flow's store (D466, D467): every owner and applicant, linked from Platform → Customers |
| The subscriber list, segments, broadcasts, email automations (D295 to D298) | Marketing | Kaizena Flow's store: its own pages' newsletter keeps who asks (D467); the platform's tags (plan, trial, overdue) for segments |
| Deals (D464) | Customers → Deals | Kaizena Flow's store: a Sign-ups pipeline, a deal per application, won when its plan is paid (D467) |
| Privacy requests (D162) | Customers → Privacy requests | Kaizena Flow's store, its erasure blanking the person's applications too (D467) |
| Subscriptions analytics (for Kaizena Flow: its plans) | Analytics → Subscriptions | Plans → Analytics (D470): monthly revenue, paying, late, trying and leaving stores, each plan, how revenue moved, and the way from asking to paying |
| Blogs (several, with authors) and their comments | Website → Blogs | Kaizena Flow's store, serving kaizenaflow.com (D484) |
| Redirects and the 404 report | Website → Redirects | Kaizena Flow's store: the site's missing addresses are recorded and can be sent on (D484) |
| Staging, and translating the whole site | Website | Kaizena Flow's store (D484) |
| A/B tests of pages | Marketing → A/B tests | Kaizena Flow's store, on the site's pages (D484) |
| Traffic and visits | Analytics → Traffic | Kaizena Flow's store: visits on kaizenaflow.com are counted (D484) |
| Company details, private mode, the accessibility statement | Settings | Kaizena Flow's store (D466, D484; private mode stays off while the store serves the site) |
| Finance and VAT (D161, D496) | Analytics → Finance, VAT; Settings → Books | Plans → Analytics: what Kaizena Flow sold by month with its VAT (D507), posted into the books of the business behind it with codes 3 and 52 (D508), so in that business's VAT return and accounts, Stripe's fees with each payout |
| Accounting (our ledger; Tripletex and Fiken compare with it) | Settings → Books | Plans → Analytics, *In the books* (D508): Kaizena Flow's sales, credit notes and Stripe payouts posted into the books the platform names (Human Web's) |

## Store-only: cannot apply to Kaizena Flow

Kaizena Flow sells plans, premium themes and domains through Stripe Billing (D18, D35), not goods: it has no catalogue, stock, carts,
parcels or returns. So these stay store-only: products, inventory, orders, draft orders, deliveries, returns, the store's invoices and
credit notes, gift cards, reviews of products, price lists, customer groups and company accounts, wishlists, bookings, hosts,
subscription boxes, recommendations, product layouts, product feeds, the bonus program, creators, the Dream Factory, and a store's
setup, moving in, features, countries, closing and billing (the platform is what bills). Analytics of products and inventory follow
them. Its own domain is set in Vercel (D240), not on a Domains page.
