# The platform has what stores have

The owner, 6 November 2026: *anything developed for store owners or stores must be developed for the platform and the main store as
well.* Kaizena Flow's own site and store are run from the platform admin (`/admin/platform`); its rows are `store_id is null` or
`platform_*` tables. The rule is in `CLAUDE.md` (Conventions). This file is its list: what a store's admin has, and whether the
platform has it. Tick a row (move it to *Built for both*) in the change that brings it.

**How the gap closes:** [`platform-parity-plan.md`](platform-parity-plan.md) (proposed 6 November 2026, waiting for the owner's choice):
Kaizena Flow's site and its customers move into a store of its own, which gets every store page for a website by itself (*Store*, with
the plan's step), and the platform console gets what is about running the business (*Console*, C1 to C6).

Read page by page on 6 November 2026: every page in a store's sections (`src/lib/store-nav.ts`) against the platform's
(`src/lib/platform-nav.ts`), the tables behind each and the server code that reads them.

## Missing or partial on the platform, and it applies

39 rows.

### Website

| Store page | Kaizena Flow today | Comes by |
|---|---|---|
| Blogs (several, with authors) | One blog at `/blog`; `blogs` and `blog_authors` need a store | Store, step 5 |
| Blog comments | None; `blog_comments` needs a store and its page | Store, step 5 |
| Redirects and the 404 report | Only the automatic redirect when a page's address changes (`page_redirects`); `redirects` and `not_found_hits` need a store, and the platform's 404 records nothing | Store, step 5 |
| Staging | Page versions and CSS versions; no set of changes compared and made live together (`site_stagings` needs a store) | Store, step 5 |
| Translate the store | Page by page in the builder's translate mode; no whole-site pass with review (`store-translate.ts` needs a store) | Store, step 5 |

### Marketing

| Store page | Kaizena Flow today | Comes by |
|---|---|---|
| A/B tests | None for its own pages. Settings → A/B tests only reads the stores' tests; `experiments.store_id` is not null, keyed to the page's store. (Listed as built for both until 6 November: it was not.) | Store, step 5 |
| Subscribers | None. The newsletter block works on its pages but keeps nobody, it only emails the recipients (`src/server/forms.ts`); accounts have only a plan-reminder opt-out | Store, step 2 |
| Segments | None | Store, step 2, with the platform's customer tags (plan, store open, trial, overdue) |
| Broadcasts | None (`src/server/email.ts` already sends for a null store) | Store, step 2 |
| Email automations | None | Store, step 2; onboarding series need a trigger on a tag added, built for stores |
| Ads and conversions | Tags only: GA4, GTM and Meta Pixel; Google Ads, TikTok and Pinterest are left out for the platform (`STORE_ONLY_TOOLS`); no server-side conversions | Store, step 5; a sign-up or a paid plan as a conversion, built for stores as a form sent |
| Campaigns | Discount codes only; no timed price on a plan | Console, C5 |

### Analytics

| Store page | Kaizena Flow today | Comes by |
|---|---|---|
| Overview | The platform home counts stores, paying, overdue, without a plan, new this week, requests; no revenue, no comparison with a period, no funnel | Console, C2 |
| Subscriptions (for Kaizena Flow: its plans) | None: no monthly recurring revenue, churn or failed renewals. The largest gap for a business that sells plans | Console, C2 |
| Customers | None: no cohorts of owners, no lifetime value | Console, C2 |
| Marketing | Referral totals, recovered plan checkouts; no channels or cost per new owner | Console, C2 |
| Reports | None | Console, C2 (later) |
| Analytics settings | None: no targets | Console, C2 |
| Live | None | Store, step 5 (visitors); Console, C2 (sign-ups today) |
| Traffic | Requests and errors per day under Usage and limits, the sandbox funnel, docs reads; no visits counted on kaizenaflow.com (`visits.store_id` is not null; the site loads only the speed beacon) | Store, step 5 |
| Finance | Single invoices under each store; no totals of plans, themes and domains sold, or fees | Console, C3 |
| Payouts | None: the platform's own Stripe payouts are not shown | Console, C3 |
| VAT | None for its own sales (Settings → VAT is the stores' rate tables) | Console, C3 |

### Customers

| Store page | Kaizena Flow today | Comes by |
|---|---|---|
| Customers | Platform → Customers lists accounts that have a store, with their stores, plans, invoices and emails; no leads, notes, tags, timeline, import or export | Store, step 2 |
| Deals | Requests: approve or decline an access request; no pipeline | Store, step 2 (a Sign-ups pipeline) |
| Privacy requests | Retention rules, the record of processing, and owners erase their own account; no log of people's requests with the month's clock, no copy of a person's data | Store, step 2, covering the account too |
| Custom fields | On content types only; none on Kaizena Flow's customers or on stores (`field_groups` needs a store) | Store, step 2 (customers); Console (fields on stores) |

### Settings

| Store page | Kaizena Flow today | Comes by |
|---|---|---|
| Company | Four business details under Header and footer (legal name, organisation number, address, email); no places, phone or VAT number | Store, step 1 |
| Private mode | None (`/holding` is a holding page per domain) | Store, step 1 |
| Accessibility | None: no accessibility statement for kaizenaflow.com | Store, step 5 |
| Search | None: the site has no search; Settings → Search is the stores' search experiment | Store, step 5, if wanted |
| Workflows | Kaizena Flow's events go to Slack, Zapier and Make (D465); no rules on them | Console, C4; the site's own events, Store |
| Integrations: own endpoints | None | Console, C4 (next of D465) |
| Integrations: *Add to Slack* | A pasted webhook (D465) | Console, C4 (next of D465) |
| Integrations: accounting (Tripletex, Fiken) | Kaizena Flow's plan invoices are Stripe's (D35), not a series of its own: Stripe's payouts and invoices into Human Web's books, to decide | Console, C3 |
| E-invoices (EHF, D463) | Kaizena Flow's plan invoices are Stripe's and go by email; from 1 January 2027 an owner's business registered in ELMA is owed EHF, which needs Kaizena Flow's own documents sent through B1's sender | Console, C3, with the books |
| Apps and API | Settings → AI assistants and apps and App listings oversee others' apps; no Admin API for the platform (`api_tokens` needs a store) | Console, C4 |
| AI | Has more than a store (pause, web search, prices, the eval); lacks how long AI manager conversations are kept | Console |
| Team | None: a platform admin is one boolean, `accounts.platform_admin`, set by SQL; no roles, invitations or screen | Console, C1 |

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
| Legal pages | Settings → Legal pages | Pages → *Write the legal pages* (terms, privacy, DPA, D408) |
| Payments | Settings → Payments (Stripe Connect) | Settings → Stripe (Stripe Billing) |
| Referrals and affiliates | Affiliates | Plans → Referrals (creators: referrers with a commission) |
| Abandoned checkout reminders | Cart reminders | Plans → Reminders |
| Discount codes | Discounts | Plans → Discounts |
| Activity log | Activity | Settings → Activity log |
| Apps and AI assistants (D439, D441) | Settings → Apps and API | Settings → AI assistants and apps, App listings |
| Zapier, Make and Slack (D41, D101; the platform's D465) | Integrations | Settings → Integrations: Kaizena Flow's own events (a store requested, made or opened, a plan started, changed, cancelled or not paid, a notice of illegal content) |

## Store-only: cannot apply to Kaizena Flow

Kaizena Flow sells plans, premium themes and domains through Stripe Billing (D18, D35), not goods: it has no catalogue, stock, carts,
parcels or returns. So these stay store-only: products, inventory, orders, draft orders, deliveries, returns, the store's invoices and
credit notes, gift cards, reviews of products, price lists, customer groups and company accounts, wishlists, bookings, hosts,
subscription boxes, recommendations, product layouts, product feeds, the bonus program, creators, the Dream Factory, and a store's
setup, moving in, features, countries, closing and billing (the platform is what bills). Analytics of products and inventory follow
them. Its own domain is set in Vercel (D240), not on a Domains page.
