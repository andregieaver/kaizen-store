# The product's surface (FT)

Part of `docs/audits/bloat-review-2026-11.md`, on commit 0bd814c. Read by one reviewer, challenged by a second (who re-opened every citation, re-measured every number and applied the owner's note that the platform is not open yet) and planned by a third. A tick (✓) marks a finding the second reviewer confirmed or corrected; one the planner added has none. Each finding has a file of its own beside this one.

**In short.** The surface is large (560 pages, 110 store links, 254 AI manager tools, 83 five-minute jobs, 481 tables) but it is built with care: a new shop's default Basic view has 29 links, no admin screen is orphaned, and a feature a store does not use costs it close to nothing in the navigation, an AI round or scheduled work. One place breaks that and is cheap to fix before shoppers arrive: the cart page works out the whole basket twice per view (at least 14 statements too many), and every basket spends 5 statements learning that bonus, referrals and checkout rules are not in use. Two true duplicates are worth removing while there is no real data to move: order rules beside Workflows (about 1,900 lines) and the platform site's old copy (2,150 to 4,300 lines, already step 7 of its plan). The rest is the owner's product choice or already tracked; what is missing is a check that makes each new feature state what it costs a store that does not use it.

## Findings

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [FT-15](FT-15.md) | The cart page works out the whole basket twice per view, and every basket asks the database about bonus, referrals and checkout rules whether or not the store uses them | eager | P0 | S | 0.22 |
| [FT-8](FT-8.md) ✓ | Order rules ('Automation') and Workflows are two engines for one job *(your choice)* | duplicate | P1 | M | 3.11 |
| [FT-5](FT-5.md) ✓ | Kaizena Flow's site is kept twice since the switch of 7 November | duplicate | P1 | M | 3.9 |
| [FT-2](FT-2.md) ✓ | Nothing makes a new feature state what it costs a store that does not use it *(your choice)* | no check | P1 | S | 1.18 |
| [FT-4](FT-4.md) ✓ | The AI manager sends up to 124 tool definitions a round whatever the store uses; gating tools by feature would not lower that | eager | P1 | M | 2.36 |
| [FT-3](FT-3.md) ✓ | Nine dispatcher jobs only prune old rows and run 288 times a day, and two run logs are pruned every minute | eager | P2 | S | 0.31 |
| [FT-12](FT-12.md) ✓ | An owner's own look can be kept in two places: saved themes and the theme library *(your choice)* | duplicate | P2 | S | 3.12 |
| [FT-7](FT-7.md) ✓ | What a new owner sees: 29 links in Basic, 94 in Advanced, 35 under Settings. A product question, mostly planned already *(your choice)* | oversize | P2 | M | your choice |
| [FT-1](FT-1.md) ✓ | Most features have no switch; adding more is a product choice, because a switch saves almost no running cost *(your choice)* | eager | P3 | S | tolerated |
| [FT-9](FT-9.md) ✓ | Campaigns and discount codes overlap at their edges; one page is planned, one engine is not worth it *(your choice)* | duplicate | P3 | S | tolerated |
| [FT-10](FT-10.md) ✓ | Four store engines have a platform twin with its own tables and runner: about 2,100 lines, built by the owner's own rule *(your choice)* | duplicate | P3 | L | your choice |
| [FT-13](FT-13.md) ✓ | Bonus, referrals and creators are three reward models; whether to fold creators into referrals is a product choice *(your choice)* | duplicate | P3 | L | your choice |

## Refuted by the second reviewer

These were in the first reading and did not hold. They are in no step.

- **The developer platform (API, OAuth server, MCP, apps, endpoints) is open with no user.** It argued for parking a feature because nobody uses it yet, which the owner's clarification rules out. Its only idle cost is two prune jobs (now in FT-3), and Kaizen Life's assistant already reaches the same MCP tools. Whether the doors are open on opening day is a product and security choice.
- **Fiken is connected to no store while the aim is to make Fiken unnecessary.** The case rested on an empty table. The plan it cited keeps Fiken and Tripletex as the bridge ('kept and supported'), and Fiken's idle cost is one statement every five minutes.
- **Checkout's delivery code imports all ten carrier adapters.** The import is real but costs nothing that shows: the adapters are 1,702 lines inside shared server chunks of several megabytes, and a route that uses no carrier loads 10.9 MB anyway. Loading them on demand would touch nine callers for no measurable gain.

## Measured

| Measure | Value | How |
|---|---|---|
| Source size | 768,202 lines in 4,139 non-test .ts and .tsx files under src; 325,579 test lines in 1,771 test files | find src ... \| xargs cat \| wc -l, test files apart, re-run by the planner |
| Pages and handlers | 560 page.tsx: store admin 264, platform admin 111, owner level 41, storefront /s 59, and 85 elsewhere (print views, sign-in and account pages, the platform's own site). 268 route handlers, 13 cron routes (9 every minute, 1 every five minutes, 2 daily, 1 run by another job) | find src/app -name page.tsx and route.ts* per folder; trackedRoute( periods under src/app/api/cron; re-run by the planner |
| Store navigation | 110 sidebar links in 9 sections, 42 in Basic. A store with only the shop on: 94 links in Advanced, 29 in Basic (the default view). Settings: 35 links (11 in Basic), 50 settings page files | the skeptic's parser of src/lib/store-nav.ts re-run by the planner; find for settings pages; src/lib/admin-view.ts:14 |
| Screens nothing links to | 0 of 288 admin screens with a fixed address; 2 of 560 pages only redirect | the planner's scripts work/ftplan/orphans.mjs (each static admin path searched in every non-test source file outside its own folder) and stubs.mjs |
| Feature switches | 14 ids (13 optional). Of 110 store links: 16 behind an optional switch, 1 behind shop-or-Deals, 40 behind 'shop', 53 behind none. 122 of 264 store admin pages call requireFeature | src/lib/store-features.ts:16-31; the nav parser; rg requireFeature in src/app/admin/(gated)/[store] |
| AI manager tools | 254 store tools (20 behind an optional switch, 101 behind 'shop', 133 behind none), 26 of the manager's own. A shop-only store is offered 234; a round sends at most 124 | the skeptic's tool script re-run; src/lib/tool-budget.ts:15 and :67-96 |
| Scheduled jobs | 83 jobs in the five-minute dispatcher (78 together, 5 after). Nine only prune: 23 statements a run, about 6,600 a day. Two run-log deletes inside every-minute runners: 2,880 a day | counted in src/app/api/cron/cart-reminders/route.ts; each prune function read; src/server/workflows.ts:458, src/server/platform-workflows.ts:374 |
| The cart's reads | The cart page computes cartSummary() twice per view. One summary is at least 13 statements plus the cart's read; 5 of them ask about bonus (2), referrals (2) and checkout rules (1) whether or not the store uses them | read in src/app/s/[store]/[market]/cart/cart-contents.tsx:76-78, src/server/bonus.ts:434-438 and :69-77, src/server/affiliates.ts:58-64 and :244-250, src/server/checkout-rules.ts:185-206; first statements of each callee counted by hand (a lower bound, not run) |
| Order rules beside Workflows | Order rules: 294 + 69 + 435 lines in three modules, 558 lines in four settings pages, an editor, 2 tables, 1 AI tool, named in 40 other files. Store workflows: 1,316 lines | wc -l on the files; rg for order-rules, order_rules and OrderRule outside their own files |
| The platform site's old copy | Sure part about 2,150 lines: site-only routes 347, their components 484, admin folders that edit only the site 1,047 (23 pages), platform-theme-installs.ts 273. Up to about 4,300 lines and 32 admin pages if the platform's own routes take their layout from the store | find and wc -l per folder under src/app/(platform), src/app/(platform-nb)/no, src/components/platform-routes and src/app/admin/(gated)/platform; rg for importers of the four twin files |
| A new store's own rows | 6 rows at creation (5 number series, 1 payment provider) plus a first blog and a first theme install; nothing per optional feature | commerce.initialise_store() and the AFTER INSERT triggers on commerce.stores in supabase/migrations (baseline 1 and 3) |
| Build | 1,426 static pages generated in 28.9 s of a 263 s build; peak memory 7.6 GB on this machine. No feature switch changes this | evidence/build-summary.txt, build-peak-kb.txt and build.log lines 30-34 |
| Tables never written | 245 of 481 tables have had no insert since 25 August. Under the owner's clarification this shows only that the platform has not opened; it is evidence against no feature | evidence/prod-db-stats.md (the skeptic's count); rg 'commerce.table(' src/db/schema.ts |

## Well made, and should stay

- The switch system itself (D178): one registry with needs checked transitively, kept in step with the navigation, the admin map and the AI tools by tests; switching off deletes nothing (src/lib/store-features.ts).
- A new store starts with the shop alone (src/lib/store-features.ts:202) and every account starts in Basic (src/lib/admin-view.ts:14); the navigation is filtered by features and permissions in one place (src/lib/store-nav.ts:388-401), and the Settings and Website hub pages follow the view too (src/components/admin/section-hub-cards.tsx:27).
- No admin screen is orphaned: each of the 288 admin screens with a fixed address is named in source outside its own folder, and only 2 of 560 pages are redirect stubs (the planner's scripts).
- Basic view has a budget that a test holds: at most 12 links a section and under half of all links (src/lib/store-nav.test.ts:245-253).
- Creating a store writes 6 rows of its own and nothing per optional feature (commerce.initialise_store()).
- Scheduled jobs follow use: almost every dispatcher job starts with one query on its own queue or table and ends when nothing is due, and jobs of switched features test the switch in SQL (commerce.feature_on() in cart-reminders.ts, standing-orders.ts, calendar-sync.ts, review-requests.ts, subscription-reminders.ts; the bonus job leaves a store whose programme is off alone, src/server/bonus.ts:543-549).
- Product pages read reviews and subscriptions only while they are on, and the referral and creator programmes, recommendation settings and campaign notices through per-store caches (the skeptic's check). The cart is the exception: FT-15.
- Order rules are loaded on demand: the store-events runner imports ./order-rules only when an order.paid event is processed (src/server/staff-alerts.ts:944).
- Plan features only describe plans; they are not a second gating system (src/lib/plan-features.ts).
- One event intake feeds Zapier, Make, Slack, owners' endpoints and workflows (commerce.queue_integration_event()).
- Reuse where it could have been copied: email automations take the broadcast's content schema (src/lib/automations.ts:4), SMS marketing takes its audience from segments (src/server/sms.ts:35), the leads inbox reads leads where they are and keeps only decisions (the comment on lead_decisions in src/db/schema.ts), Work's clients link to customers and companies and reuse the shop's e-invoice parts, and the Dream Factory's code steps are D351's draft and publish and D311's legal writer (docs/decisions.md:749).
- The AI manager caps a round at 124 tools and loads the rest on request (src/lib/tool-budget.ts:15, 67-96).
- The developer platform (Admin API, OAuth server, MCP, storefront API, UCP) costs nothing until it is called; whether its doors are open on opening day is a product and security choice (was FT-6).
- Fiken and Tripletex are kept on purpose as the bridge to the own books (docs/own-books-and-sales.md:45); their shared client is code review step 3.12 (was FT-11).
- The ten carrier adapters are 1,702 lines behind one index; importing them all is immaterial beside the 10.9 to 12.1 MB of chunks every server entry requires, which belongs to the bundle dimensions (was FT-14).
- The theme cluster's tables that production has not written are all read and written by working code; none is dead.
- The old stores.modules list still mirrors two features (bookings, deliveries) through a trigger that fires only when features or modules are written, and carries Work's switch; a small leftover with no running cost.
