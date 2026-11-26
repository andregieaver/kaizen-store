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

6 rows (read again 9 November 2026, after the site switch, D484; Kaizena Flow's money in the books and its payouts, D508, D509; the team's roles, D510; the home's figures, targets and briefing, D513; its own endpoints and *Add to Slack*, D515; workflows on its events, D516; its own API, D518; its owners by the month they joined and by channel, D522; sign-ups and first paid plans as ad conversions, D523; timed plan prices, D524;
Kaizena Flow's own site's alerts on the home and in the briefing, D757).

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
| Canva in the media library: *Edit in Canva*, *Import from Canva* (D898; a person's own Canva, used in every library they work in) | Website → Media, Integrations → Canva | Website → Media, Account → Connected apps |
| *Edit in Canva* on picture fields (D898 C2): the page builder's, and a product's photos (Kaizena Flow sells plans: no product editor) | The page builder, Products → a product | Kaizena Flow's page builder |
| *Send to my store* from Figma (D898 F1, F2): a frame as a draft page, its pictures in the library | Account → Connect Figma, then the page builder | Kaizena Flow's site is its house store's: its owner connects the plugin to that store |
| A look from a Figma file (D898 F3): its colours, typefaces and text styles as a look in the theme library, never live | Figma, *Send colours and type*, then Design settings → Themes | Kaizena Flow's site runs from its house store: the look is in that store's theme library |
| The AI manager and autopilot | AI manager | Settings → AI manager |
| Support desk and chat assistant | Support | Support (a store's handoff requests do not apply: Kaizena Flow's AI never acts on a store, `docs/support.md` 2.8) |
| Speed | Analytics → Speed | Usage and limits → speed (`own_speed_samples`) |
| SEO, cookies, Google reviews, emails, languages | Settings | Settings |
| The language switcher's look by screen size (D479) | Header and footer, *Languages* | Header and footer, *Languages* |
| Legal pages | Settings → Legal pages | Pages → *Write the legal pages* (terms, privacy, DPA, D408) |
| Social posts (D870 C1b) | Marketing → Social posts, from a product, a page or a topic | Kaizena Flow's store, Marketing → Social posts: from a page of kaizenaflow.com or a topic (it sells no products) |
| Facebook Page figures (D870 S1.2b) | Marketing → Social posts, the Facebook card | Kaizena Flow's store, Marketing → Social posts, the same card (its own Page) |
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
| The AI tunes prices (D309, D605; the platform's D854) | The autopilot changes product prices under its catalogue level, within its largest price change and lowest margin | Plans → AI and prices: off, suggests (each waits for a yes) or on its own within a range of the price a person last set, for plan, extension and bundle prices; every change kept with its reasons |
| Workflows (D356; the platform's D516) | Settings → Workflows | Settings → Workflows, on Kaizena Flow's events: email its owners, post in its Slack, send to its endpoint. The site's own events (a form sent, a page published) are its store's |
| Customers, with leads, notes, tags, timeline, import and export | Customers | Kaizena Flow's store (D466, D467): every owner and applicant, linked from Platform → Customers |
| The subscriber list, segments, broadcasts, email automations (D295 to D298) | Marketing | Kaizena Flow's store: its own pages' newsletter keeps who asks (D467); the platform's tags (plan, trial, overdue) for segments |
| Deals (D464) | Customers → Deals | Kaizena Flow's store: a Sign-ups pipeline, a deal per application, won when its plan is paid (D467) |
| Privacy requests (D162) | Customers → Privacy requests | Kaizena Flow's store, its erasure blanking the person's applications too (D467) |
| Subscriptions analytics (for Kaizena Flow: its plans) | Analytics → Subscriptions | Plans → Analytics (D470): monthly revenue, paying, late, trying and leaving stores, each plan, how revenue moved, and the way from asking to paying |
| Blogs (several, with authors) and their comments | Website → Blogs | Kaizena Flow's store, serving kaizenaflow.com (D484) |
| Redirects and the 404 report | Website → Redirects | Kaizena Flow's store: the site's missing addresses are recorded and can be sent on (D484) |
| Staging, and translating the whole site | Website | Kaizena Flow's store (D484) |
| A/B tests of pages | Marketing → A/B tests | Kaizena Flow's store, on the site's pages (D484), with sign-ups to Kaizena Flow as a goal only it has (D712) |
| The autopilot tests its page changes first (E4.1, D729) | Autopilot → Settings, *Test my page changes first* | Kaizena Flow's store's autopilot, on the site's pages (D484), by the same path, tested on its sign-ups per visit and only once page speed was watched too (E5.3, D757); Kaizena Flow's own Autopilot lists those tests and leads to the switch, and both can aim a goal at sign-ups per visit |
| Traffic and visits | Analytics → Traffic | Kaizena Flow's store: visits on kaizenaflow.com are counted (D484) |
| Which companies visited (D890) | Analytics → Companies, Analytics → Settings: only Kaizena Flow's own store may switch it on for now, its cost being Kaizena Flow's; opening it to every store is the next step | Kaizena Flow's store: the companies whose networks visited kaizenaflow.com, through Kaizena Flow's Leadfeeder connection (built platform first) |
| The market check (D900 M1 to M3) | Analytics → Markets: countries side by side, findings by code and their SWOT, *Make a plan*; rivals the owner adds, watched, their offers against the store's prices | Kaizena Flow's store, the same page: visits, searches and names by country, no orders or prices (it sells plans). Sign-ups by country (M1b) parked; its rivals, other platforms, stand beside its plans on Platform → Plans (M4) (`docs/market-check.md`) |
| Company facts from Brønnøysund and the bankruptcy watch (D891) | Customers → Companies → a company: the register's card, a Home item and an email when a company on payment terms is flagged | Stores → a store: its own business's card; the home and the morning briefing say when stores' businesses are flagged |
| Heatmaps and recordings of visits (D656) | Analytics → Heatmaps, Recordings; Analytics → Settings | Kaizena Flow's store: kaizenaflow.com is served from it (`site_from_store` on, read 16 November 2026), so its heatmaps and recordings are the site's; recordings run there while the platform's hold is closed for other stores. Usage and limits shows each store's count and holds the switch; platform admins never watch a store's recordings |
| The data protection officer (D763) | Your account (for all the account's stores); Settings → Company (a store's own) | Platform → Pages, beside the legal pages: the platform account's officer, named on Kaizena Flow's privacy notice |
| Company details, private mode, the accessibility statement | Settings | Kaizena Flow's store (D466, D484; private mode stays off while the store serves the site) |
| Finance and VAT (D161, D496) | Analytics → Finance, VAT; Settings → Books | Plans → Analytics: what Kaizena Flow sold by month with its VAT (D507), posted into the books of the business behind it with codes 3 and 52 (D508), so in that business's VAT return and accounts, Stripe's fees with each payout |
| Accounting (our ledger; Tripletex and Fiken compare with it) | Settings → Books | Plans → Analytics, *In the books* (D508): Kaizena Flow's sales, credit notes and Stripe payouts posted into the books the platform names (Human Web's) |
| Payouts (D290) | Analytics → Payouts | Plans → Analytics, *Payouts* (D509): Kaizena Flow's own Stripe payouts, live and test apart, each with Stripe's fees, the sales it carried line by line and whether it adds up; posted to the books (D508) |
| Team, roles and permissions (D158) | Settings → Team; a page's area named on its nav item (D851) | Settings → Team (D471, D510): owners, and Support, Content, Finance and Read-only, each reading everything and changing its own part, and working in Kaizena Flow's store in the same role; a page's area named on its nav entry, never its tab (D851) |
| A person's own name and email (D836) | Your account (everyone in a store) | Your account (everyone on the platform's team); Platform → Customers corrects a person's name and sends a link to their new address, never setting it |
| Alerts from the site's own pages and domain (E4.2, D729; the platform's D757) | Home, Analytics → Overview, the briefing | Platform home and briefing: Kaizena Flow's store's visitors stuck, a page turned slow and a domain, by the store's own rules, with kaizenaflow.com itself watched daily (`platform_settings.domain_watch`) |
| Home and Overview: revenue, a comparison, alerts and the briefing (D348) | Home, Analytics → Overview | Platform home (D513): this month's recurring revenue and how it moved, paying and trying stores, sales against last month to the same day, sign-ups today, what the figures raise in the attention list, and the morning briefing by email (daily or weekly, to owners and finance) |
| Targets (Analytics settings) | Analytics → Settings | Plans → Analytics, *Targets* (D513): a month's recurring revenue, sales, paying and new stores, their progress on the home and in the briefing |
| Live (sign-ups today) | Analytics → Live | Kaizena Flow's store for visitors (D484); the platform home for who asked for a store and opened one today (D513) |
| A list's search, views and filters, a hundred a page (D834; the platform's D847) | Customers, Products: one search bar, its views and filters in the same form, *Next 100* | Customers; Stores: by store, owner or domain, the store's state, plan and subscription, the pager keeping them |
| Basic and Advanced views, and a long sidebar in groups (D454; the platform's D884) | Every section's sidebar; the switch in the top bar, the phone's menu and Your account | Every platform sidebar's everyday pages in Basic (24 of 57), Settings in six groups, the same switch, one choice per person across the levels; the owner's Account in three groups with its Basic |
| Where you are: the section above a page's title, one link marked in each list of the menu (D873) | Every page with a page header; the rail, sidebars and phone menu | The same frame: every platform page in a section (Plans, Support, Settings…), and the owner's level (Stores, Account, Work) |

## Store-only: cannot apply to Kaizena Flow

Kaizena Flow sells plans, premium themes and domains through Stripe Billing (D18, D35), not goods: it has no catalogue, stock, carts,
parcels or returns. So these stay store-only: products, inventory, orders, draft orders, deliveries, returns, the store's invoices and
credit notes, gift cards, reviews of products, price lists, customer groups and company accounts, wishlists, bookings, hosts,
subscription boxes, recommendations, product layouts, product feeds, the bonus program, creators, drop shipping and its suppliers (D550), product passports (D554), marketplace channels such as eBay (D555), the Dream Factory, and a store's
setup, moving in, features, countries, closing and billing (the platform is what bills). Analytics of products and inventory follow
them. Its own domain is set in Vercel (D240), not on a Domains page.
