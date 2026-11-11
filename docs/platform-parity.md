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

6 rows (read again 9 November 2026, after the site switch, D484; Kaizena Flow's money in the books and its payouts, D508, D509; the team's roles, D510; the home's figures, targets and briefing, D513; its own endpoints and *Add to Slack*, D515; workflows on its events, D516; its own API, D518; its owners by the month they joined and by channel, D522; sign-ups and first paid plans as ad conversions, D523; timed plan prices, D524).

### Website

Nothing left: kaizenaflow.com is served from Kaizena Flow's store since the switch (D484, on in production), so every page of a store's
Website section is the site's (see *Built for both*).

### Marketing

Nothing left: Kaizena Flow's sign-ups and paid plans go to the ad platforms as conversions (D523) and its plans have timed prices
(D524; see *Built for both*).

### Analytics

| Store page | Kaizena Flow today | Comes by |
|---|---|---|
| Reports | None | Console, C2 (later) |

### Customers

| Store page | Kaizena Flow today | Comes by |
|---|---|---|
| Custom fields | On Kaizena Flow's customers through its store (D467); none on stores themselves | Console (fields on stores) |

### Settings

| Store page | Kaizena Flow today | Comes by |
|---|---|---|
| Search | None: the site has no search; Settings → Search is the stores' search experiment | Store, step 5, if wanted |
| E-invoices (EHF, D463) | Kaizena Flow's plan invoices are Stripe's and go by email; from 1 January 2027 an owner's business registered in ELMA is owed EHF, which needs Kaizena Flow's own documents sent through B1's sender | Console, C3, with the books |
| AI | Has more than a store (pause, web search, prices, the eval); lacks how long AI manager conversations are kept | Console |
| The language a visitor sees first (D479) | Kaizena Flow's site suggests a visitor's language and never sends them to it (D312); no choice of rule. The switcher's look (by name, code or flag, side by side, one under another or a list, by screen size) is built for both | Console: the same rule on `platform_settings`, read by the proxy at `/` (next of D479) |

### Home

Nothing left: the platform home shows this month's revenue and sales, what needs a look and the targets, and sends the morning briefing
(D513; see *Built for both*).

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
| Own endpoints and *Add to Slack* (D354, D101; the platform's D515) | Integrations | Settings → Integrations: Kaizena Flow's events, signed, to its own endpoints; its Slack channel picked in Slack |
| Customers' cohorts and lifetime value, channels and cost per customer (D152; the platform's D522) | Analytics → Customers, Marketing | Plans → Analytics: owners by the month they joined with what they paid for plans; new owners by the channel of their first visit against the spend entered, with the cost per store made and per paying owner |
| Ads and conversions: server-side conversion events (D303; the platform's D523) | Marketing → Ads and conversions | Kaizena Flow's store's tags and conversions on kaizenaflow.com's pages (D484); a sign-up made with marketing consent and the first plan its store paid sent as conversions through the platforms connected to Kaizena Flow's store, counted on Plans → Analytics (D523) |
| Campaigns: a timed price without a code (D114; the platform's D524) | Sales → Campaigns | Platform → Discounts, *New campaign*: a percentage or an amount off for the first payment, some months or always, on chosen plans, from a start to an end, one at a time; taken off a plan chosen while it runs without a code and shown on the plans pages and owners' Billing (D524) |
| The Admin API (D355; the platform's D518) | Settings → Apps and API | Settings → Integrations → API: a read-only API of its stores, plans, requests and figures for its own tools |
| Workflows (D356; the platform's D516) | Settings → Workflows | Settings → Workflows, on Kaizena Flow's events: email its owners, post in its Slack, send to its endpoint. The site's own events (a form sent, a page published) are its store's |
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
| Payouts (D290) | Analytics → Payouts | Plans → Analytics, *Payouts* (D509): Kaizena Flow's own Stripe payouts, live and test apart, each with Stripe's fees, the sales it carried line by line and whether it adds up; posted to the books (D508) |
| Team, roles and permissions (D158) | Settings → Team | Settings → Team (D471, D510): owners, and Support, Content, Finance and Read-only, each reading everything and changing its own part, and working in Kaizena Flow's store in the same role |
| Home and Overview: revenue, a comparison, alerts and the briefing (D348) | Home, Analytics → Overview | Platform home (D513): this month's recurring revenue and how it moved, paying and trying stores, sales against last month to the same day, sign-ups today, what the figures raise in the attention list, and the morning briefing by email (daily or weekly, to owners and finance) |
| Targets (Analytics settings) | Analytics → Settings | Plans → Analytics, *Targets* (D513): a month's recurring revenue, sales, paying and new stores, their progress on the home and in the briefing |
| Live (sign-ups today) | Analytics → Live | Kaizena Flow's store for visitors (D484); the platform home for who asked for a store and opened one today (D513) |

## Store-only: cannot apply to Kaizena Flow

Kaizena Flow sells plans, premium themes and domains through Stripe Billing (D18, D35), not goods: it has no catalogue, stock, carts,
parcels or returns. So these stay store-only: products, inventory, orders, draft orders, deliveries, returns, the store's invoices and
credit notes, gift cards, reviews of products, price lists, customer groups and company accounts, wishlists, bookings, hosts,
subscription boxes, recommendations, product layouts, product feeds, the bonus program, creators, drop shipping and its suppliers (D550), product passports (D554), the Dream Factory, and a store's
setup, moving in, features, countries, closing and billing (the platform is what bills). Analytics of products and inventory follow
them. Its own domain is set in Vercel (D240), not on a Domains page.
