# features: The product's surface: features, screens and switches

The surface is large (560 pages, 110 store links, 254 AI manager tools, 83 five-minute jobs, 481 tables) but it is built with care: a new shop's default Basic view has 29 links, no admin screen is orphaned, and a feature a store does not use costs it close to nothing in the navigation, an AI round or scheduled work. One place breaks that and is cheap to fix before shoppers arrive: the cart page works out the whole basket twice per view (at least 14 statements too many), and every basket spends 5 statements learning that bonus, referrals and checkout rules are not in use. Two true duplicates are worth removing while there is no real data to move: order rules beside Workflows (about 1,900 lines) and the platform site's old copy (2,150 to 4,300 lines, already step 7 of its plan). The rest is the owner's product choice or already tracked; what is missing is a check that makes each new feature state what it costs a store that does not use it.

## Measures
- Source size: 768,202 lines in 4,139 non-test .ts and .tsx files under src; 325,579 test lines in 1,771 test files
- Pages and handlers: 560 page.tsx: store admin 264, platform admin 111, owner level 41, storefront /s 59, and 85 elsewhere (print views, sign-in and account pages, the platform's own site). 268 route handlers, 13 cron routes (9 every minute, 1 every five minutes, 2 daily, 1 run b…
- Store navigation: 110 sidebar links in 9 sections, 42 in Basic. A store with only the shop on: 94 links in Advanced, 29 in Basic (the default view). Settings: 35 links (11 in Basic), 50 settings page files
- Screens nothing links to: 0 of 288 admin screens with a fixed address; 2 of 560 pages only redirect
- Feature switches: 14 ids (13 optional). Of 110 store links: 16 behind an optional switch, 1 behind shop-or-Deals, 40 behind 'shop', 53 behind none. 122 of 264 store admin pages call requireFeature
- AI manager tools: 254 store tools (20 behind an optional switch, 101 behind 'shop', 133 behind none), 26 of the manager's own. A shop-only store is offered 234; a round sends at most 124
- Scheduled jobs: 83 jobs in the five-minute dispatcher (78 together, 5 after). Nine only prune: 23 statements a run, about 6,600 a day. Two run-log deletes inside every-minute runners: 2,880 a day
- The cart's reads: The cart page computes cartSummary() twice per view. One summary is at least 13 statements plus the cart's read; 5 of them ask about bonus (2), referrals (2) and checkout rules (1) whether or not the store uses them
- Order rules beside Workflows: Order rules: 294 + 69 + 435 lines in three modules, 558 lines in four settings pages, an editor, 2 tables, 1 AI tool, named in 40 other files. Store workflows: 1,316 lines
- The platform site's old copy: Sure part about 2,150 lines: site-only routes 347, their components 484, admin folders that edit only the site 1,047 (23 pages), platform-theme-installs.ts 273. Up to about 4,300 lines and 32 admin pages if the platform's own routes take their layout from the…
- A new store's own rows: 6 rows at creation (5 number series, 1 payment provider) plus a first blog and a first theme install; nothing per optional feature
- Build: 1,426 static pages generated in 28.9 s of a 263 s build; peak memory 7.6 GB on this machine. No feature switch changes this
- Tables never written: 245 of 481 tables have had no insert since 25 August. Under the owner's clarification this shows only that the platform has not opened; it is evidence against no feature

## Well made
- The switch system itself (D178): one registry with needs checked transitively, kept in step with the navigation, the admin map and the AI tools by tests; switching off deletes nothing (src/lib/store-features.ts).
- A new store starts with the shop alone (src/lib/store-features.ts:202) and every account starts in Basic (src/lib/admin-view.ts:14); the navigation is filtered by features and permissions in one place (src/lib/store-nav.ts:388-401), and the Settings and Websi…
- No admin screen is orphaned: each of the 288 admin screens with a fixed address is named in source outside its own folder, and only 2 of 560 pages are redirect stubs (the planner's scripts).
- Basic view has a budget that a test holds: at most 12 links a section and under half of all links (src/lib/store-nav.test.ts:245-253).
- Creating a store writes 6 rows of its own and nothing per optional feature (commerce.initialise_store()).
- Scheduled jobs follow use: almost every dispatcher job starts with one query on its own queue or table and ends when nothing is due, and jobs of switched features test the switch in SQL (commerce.feature_on() in cart-reminders.ts, standing-orders.ts, calendar…
- Product pages read reviews and subscriptions only while they are on, and the referral and creator programmes, recommendation settings and campaign notices through per-store caches (the skeptic's check). The cart is the exception: FT-15.
- Order rules are loaded on demand: the store-events runner imports ./order-rules only when an order.paid event is processed (src/server/staff-alerts.ts:944).
- Plan features only describe plans; they are not a second gating system (src/lib/plan-features.ts).
- One event intake feeds Zapier, Make, Slack, owners' endpoints and workflows (commerce.queue_integration_event()).
- Reuse where it could have been copied: email automations take the broadcast's content schema (src/lib/automations.ts:4), SMS marketing takes its audience from segments (src/server/sms.ts:35), the leads inbox reads leads where they are and keeps only decisions…
- The AI manager caps a round at 124 tools and loads the rest on request (src/lib/tool-budget.ts:15, 67-96).
- The developer platform (Admin API, OAuth server, MCP, storefront API, UCP) costs nothing until it is called; whether its doors are open on opening day is a product and security choice (was FT-6).
- Fiken and Tripletex are kept on purpose as the bridge to the own books (docs/own-books-and-sales.md:45); their shared client is code review step 3.12 (was FT-11).
- The ten carrier adapters are 1,702 lines behind one index; importing them all is immaterial beside the 10.9 to 12.1 MB of chunks every server entry requires, which belongs to the bundle dimensions (was FT-14).
- The theme cluster's tables that production has not written are all read and written by working code; none is dead.
- The old stores.modules list still mirrors two features (bookings, deliveries) through a trigger that fires only when features or modules are written, and carries Work's switch; a small leftover with no running cost.

## Findings (12)

### FT-15 [P0 S eager added] The cart page works out the whole basket twice per view, and every basket asks the database about bonus, referrals and checkout rules whether or not the store uses them
- evidence: Found as the completeness check; the report's clean line 'the storefront pays little for a feature a store does not use' was tested on product pages and cached programme reads, not on the cart. (1) Twice per view. loadCartView() runs cartSummary(...) and readCartBonus(store, market) side by side (cart-contents.tsx:76-78). readCartBonus() calls cartBonus() (cart/bonus.ts:24), which reads the cart again with getCart()…
- cost: Per cart view: one cart read and one full summary too many, at least 14 statements (lower bound, from reading). Per summary in a store that uses neither bonus, referrals nor checkout rules: 5 statements that tell it not… (The server and the database on every cart and checkout view; the shopper, who w…)
- fix: 8 steps; first: src/app/s/[store]/[market]/cart/cart-contents.tsx, loadCartView() (lines 76-80): take readCartBonus(store, market) out of the Promise.all and use `const bonus = summary.bonus` (cartSummary() already returns it, built by the same cartBonusOf() from the same si…
- done when: cart-contents.test.ts asserts cartSummary is called exactly once per cart render and ./bonus is not called; and a new unit test of cartSummary() with features ['shop'] (mocking ./bonus and ./affiliates) asserts bonusProgram, codeInPlay and friendState are not called.
- saving: Estimate from the code, not a measurement: per cart view one cart read and one summary fewer (at least 14 statements); per summary in a store without bonus and referrals 4 statements fewer (5 with the rules cache); per checkout view in a store without bonus a…
- after: nothing
- notes: This is the one place I found where a switched-off feature still costs a store per request. The storefront-data dimension looks at pages' reads too; if it plans the cart, do this once there.

### FT-8 [P1 M duplicate confirmed OWNER-CHOICE] Order rules ('Automation') and Workflows are two engines for one job
- evidence: Order rules (D238): when an order is paid and conditions hold, then tag, notify staff, hold or ask the AI manager (order-rules.ts:46), with 13 kinds of condition (:29) and all-or-any matching. Workflows (D356): on any store event, order.paid among them, conditions on the event's fields (all must hold), then tag_order, note_order, tag_customer, email_staff, post_slack, send_request, ask_ai_manager (workflows.ts:133).…
- cost: Two editors, two logs and two links with near-identical words for the owner; every change to order automation made in the right one of two places; two queues to keep correct. (An owner's admin (a choice between two doors), CI, anyone changing automation)
- fix: 12 steps; first: The owner decides that Workflows is the one engine; write the decision row in docs/decisions.md (it replaces the build note at docs/wave-9-platform.md:140) and say there that the hold action and the order facts are store-only (the platform sells no goods), as…
- done when: `find src -iname '*order-rule*' | wc -l` prints 0; the store navigation has 109 links (no /settings/automation); and src/server/workflows.int.test.ts has a case where a paid order over an amount in the main currency is put on hold and the staff email says so.
- saving: Estimate: about 1,900 lines, 528 test lines, 4 pages, 1 link and 1 AI tool removed now, 2 tables a release later, less the 300 to 500 lines Workflows gains for the hold action, 'any' and the order facts.
- after: The owner's decision to retire order rules; Code review step 2.4 (the page merge 'Workflows and Automation become one') can be this same change
- tracked: The page merge is audit phase 2 ('Workflows and Automation become one Automations', docs/audits/admin-usability-2026-11.md:199; code review step 2.4, Open). Me…
- notes: The case does not rest on the tables being empty; that only makes it cheap now: no rule of a real store has to be converted. After opening the same merge needs a converter and a notice to owners. Effort is M at the upper end because 40 files name order rules.

### FT-5 [P1 M duplicate corrected] Kaizena Flow's site is kept twice since the switch of 7 November
- evidence: kaizenaflow.com has been served from Kaizena Flow's own store since 7 November (platform-parity-plan.md:3); the older copy remains, and step 7 of that plan ('One copy') removes it. I measured the parts again. Site-only routes in (platform) and (platform-nb)/no (front page, [slug], blog, category, tag, cookies): 347 lines in 12 folders. Their components in src/components/platform-routes (home, page, entry, blog, term…
- cost: 2,150 to 4,300 lines and 23 to 32 admin pages in every build; about 10 links in the operator's Website section that edit a copy visitors no longer see; site code kept working on two paths (store_id is null beside the st… (The build, CI, the platform operator's admin, anyone changing site code)
- fix: 8 steps; first: Before anything: the plan's step 6 (one desk) is decided; the switch has stayed on and `node scripts/site-compare.mjs https://kaizenaflow.com --against before.json` passes; the media library's rows are moved to the store (the plan's 'still to do at the switch…
- done when: `rg -l "platform_theme_installs" src --glob '!*.test.*' | wc -l` prints 0; `ls 'src/app/(platform)'` shows no [slug], blog, category, tag or cookies; and site-compare.mjs --against before.json passes.
- saving: Estimate by file: at least 2,150 lines, 23 admin pages and 12 site route pages; up to about 4,300 lines and 32 admin pages if the platform's own routes take their layout from the store too. Not 6,800 lines.
- after: docs/platform-parity-plan.md step 6 (one desk); The switch kept on and compared clean with scripts/site-compare.mjs; The media library's rows moved to the store
- tracked: docs/platform-parity-plan.md step 7 'One copy' (not built; step 6 before it)
- notes: Corrected again by the planner: the plan's step 7 lists platform-layout.tsx and the roles and navigation files as removable, but they also serve the platform's own routes and the admin frame, so the sure part is about 2,150 lines and the rest needs the third …

### FT-2 [P1 S process corrected OWNER-CHOICE] Nothing makes a new feature state what it costs a store that does not use it
- evidence: Between 29 October and 11 November docs/decisions.md gained 158 rows (D406 to D572, the skeptic's count), many on the owner's instruction: the owner building towards opening, not a pause that failed. What is missing is a check on idle cost. Counted today: 83 dispatcher jobs (78 in runJobs() and 5 after it, cart-reminders/route.ts:128-275), 9 routes every minute (trackedRoute(..., 60) under src/app/api/cron), 560 pag…
- cost: Each addition raises fixed costs every store shares: statements every five minutes, definitions in an AI round up to the cap, pages in a build that peaked at 7.6 GB on this machine, a read on a shared path. None is stat… (The build, CI, the server every five minutes and per request, an agent's session)
- fix: 6 steps; first: scripts/lib/surface-count.mjs (new, pure, no database): count the dispatcher's jobs (keys of runJobs("dispatcher") plus tracked("dispatcher.…") in src/app/api/cron/cart-reminders/route.ts), every-minute cron routes, page.tsx files and route handlers under src…
- done when: `pnpm test src/lib/surface-budget.scan.test.ts` passes on main, and its own case shows that one more job in the dispatcher's list without `--raise` fails it.
- saving: No direct saving. It makes a feature's idle cost visible before it is built, when it is cheapest to avoid.
- after: nothing
- notes: Other dimensions of this review ask for budgets of their own (scheduled work, the schema, the size of an AI call, statements per screen, the server side). One baseline file and one script can hold all of them; this finding supplies the surface counts. Do it b…

### FT-4 [P1 M eager corrected] The AI manager sends up to 124 tool definitions a round whatever the store uses; gating tools by feature would not lower that
- evidence: OWNER_TOOLS holds 254 tools; 121 have a feature, 101 of them 'shop'; a shop-only store is offered 234 (my re-run of the counting script), beside the manager's own 26. chooseTools() sends everything when it fits and otherwise cuts a round to TOOLS_PER_TURN = 124 (tool-budget.ts:15, 67-96; called at owner-assistant.ts:733 with the manager's tools as 'always'). With more feature gates a shop-only store would still be o…
- cost: Estimate at 4 characters a token: 124 definitions of mean 400 characters are about 12,000 tokens of descriptions a round before their schemas, sent again each round of a turn. Paid whatever features the store uses. (An agent's session (the owner's AI allowance, the platform's AI bill))
- fix: 5 steps; first: Do step 3.18 of the code review ('Cheaper, faster AI rounds', docs/audits/code-review-2026-11.md:488). In src/lib/tool-budget.ts add a default budget of about 40 store tools: the core tools, the tools used earlier in the conversation and the area of the page …
- done when: A case in src/lib/tool-budget.test.ts shows chooseTools() over the whole registry with no area asked sends at most 40 store tools; the usage row of a second round shows cached input tokens above 0; a new eval recording is committed and agent-eval-replay.int.test.ts passes.
- saving: From feature gating alone: nothing. From step 3.18 (estimate): 124 to about 66 definitions a round, near 5,800 tokens of descriptions a round, plus schemas and what the cache saves.
- after: nothing
- tracked: docs/audits/code-review-2026-11.md FA1, step 3.18 'Cheaper, faster AI rounds' (Open) covers the 124, the default set and caching; FA6, step 3.21 (Open) covers …
- notes: The same work as the AI dimension's finding on 124 definitions per call; count it once there. Kept here only to say that more feature switches are not the way to a smaller round. The skeptic rated the comment fix S; step 3.18 itself is M in the code review.

### FT-3 [P2 S eager corrected] Nine dispatcher jobs only prune old rows and run 288 times a day, and two run logs are pruned every minute
- evidence: The dispatcher starts 78 jobs together and 5 after (counted in the route). Almost every job is one 'is anything due' statement for the whole platform, so cost follows what is due, and jobs of switched features test the switch in SQL (I checked bonus, referrals, cart reminders and subscription boxes). What is eager is small and exact. Nine jobs only delete rows older than 1 to 180 days: searches, cache, forms, chat, …
- cost: About 6,600 statements a day for the nine jobs (23 x 288) and 2,880 for the two run-log deletes, whatever the number of stores; 2,592 of the day's 23,904 job runs. A fixed cost that rises with each feature's own prune, … (The database, and one function run every five minutes and one every minute)
- fix: 6 steps; first: src/app/api/cron/subscription-reminders/route.ts (the daily route): run the seven prunes a day can wait for, each as `tracked("daily.<name>", 86400, …)` so the platform home shows them with a daily period: pruneSearchLog, pruneSearchCache, pruneFormSubmission…
- done when: The runJobs() block of src/app/api/cron/cart-reminders/route.ts has 69 entries (78 today), and a day after the deploy commerce.cron_jobs holds seven daily.* rows with every_seconds 86400 and two hourly.* rows with 3600, none late on Platform, Usage and limits.
- saving: By count from the code: about 2,500 job runs and 6,400 statements a day from the nine jobs, and about 2,900 statements a day from the two run-log deletes. No visible change in function time.
- after: nothing
- notes: Small and safe, worth doing with the next change to the dispatcher. The scheduled-work dimension owns the dispatcher's cadence as a whole (its tiers, the nine every-minute routes, the per-store loops of the media, alt-text, knowledge and embedding jobs, which…

### FT-12 [P2 S duplicate corrected OWNER-CHOICE] An owner's own look can be kept in two places: saved themes and the theme library
- evidence: 'Save as new theme' in the theme editor writes named settings to commerce.store_themes (D60; saveSavedTheme(), themes.ts:211-249; listed by listSavedThemes(), :46; deleted by deleteSavedTheme(), :251). The theme library keeps an own look as an install through addOwnLook() (theme-installs.ts:343-361), used by the Dream Factory and the brand tools. Both keep 'a look of my own under a name'. That is the one true overla…
- cost: Two save paths and two lists in one editor for the owner; one table and about 100 to 250 lines. (An owner's admin; anyone changing the theme editor)
- fix: 9 steps; first: The owner decides that an own look lives in the theme library only.
- done when: `rg -n "store_themes" src --glob '!*.test.*' | wc -l` prints 0 after the second migration, and src/server/themes.int.test.ts has a case where 'Save as new theme' adds a row to commerce.store_theme_installs.
- saving: Estimate: 100 to 250 lines and 1 table (store_themes). Not 1,000 to 1,500 lines and 6 tables.
- after: The owner's decision
- notes: Worth doing when the theme editor is next touched; before opening there are no owners' saved themes to convert.

### FT-7 [P2 M oversize corrected OWNER-CHOICE] What a new owner sees: 29 links in Basic, 94 in Advanced, 35 under Settings. A product question, mostly planned already
- evidence: Parsed from store-nav.ts (re-run by me): 110 links, 42 marked for Basic. With only the shop on: 29 in Basic, every account's default (admin-view.ts:14), and 94 in Advanced (Marketing 13, Analytics 13, Website 13, Settings 35). The two hub pages follow the view as the sidebar does (section-hub-cards.tsx:27). Settings has 50 page files. The doc still says 104 and 40 (admin-navigation.md:148). The cap test covers Basic…
- cost: Reading time for an owner in Advanced, and for the platform's operator, on every visit. No shopper cost. The admin's shell carries the whole menu on each response, which the admin-data dimension measures. (An owner's admin in Advanced view, and the platform operator's)
- fix: 3 steps; first: This is the owner's choice of what Homer and Lisa see, not waste. Do the agreed work as tracked: code review step 2.4 (the audit's phase 2 moves: settings into their sections, Campaigns and Coupons as one Discounts page, Workflows and Automation as one, docs/…
- done when: After step 2.4, the parser of src/lib/store-nav.ts gives at most 85 links in Advanced and at most 20 under Settings for a store with only the shop on, and the generated docs/admin-navigation.md states the same counts.
- saving: Estimate from the planned moves: Advanced for a new shop from 94 to about 85 links, Settings from 35 to about 20. No running-cost saving.
- after: FT-2 (the budget that holds the totals); FT-8 (Workflows and Automation as one); Code review steps 2.3, 2.4 and 4.3
- tracked: docs/audits/admin-usability-2026-11.md phase 2 and code review steps 2.3 (Open), 2.4 (Open), 2.5 (Open), 4.3 (Open), 4.6 (Open). Only the ceiling on the total …
- notes: A new owner meets 29 links, not 94: Basic is the default. What Basic lists first is the owner's product question (the clarification), so nothing here argues from use.

### FT-1 [P3 S eager corrected OWNER-CHOICE] Most features have no switch; adding more is a product choice, because a switch saves almost no running cost
- evidence: The registry has 14 ids, 13 optional. Of 110 store links, 16 stand behind an optional switch, 1 behind shop-or-Deals, 40 behind 'shop' and 53 behind none (my re-run of the parser). Of 254 AI tools, 20 stand behind an optional switch, 101 behind 'shop' and 133 behind none. What an unswitched feature costs a store that does not use it: in the navigation its links are in Advanced unless marked basic, and Basic is the d…
- cost: For an owner in Advanced: 94 links in a shop-only store. In run time: close to nothing per store. (An owner's admin in Advanced view)
- fix: 3 steps; first: Do not add a second tier of switches to remove bloat: it would not lower a running cost. Write that down in docs/store-features.md in one paragraph: switches are for what an owner sees and what shoppers can do, not for cost; where a feature costs a store that…
- done when: docs/store-features.md carries the paragraph; no code changes.
- saving: None in running cost. The earlier 'up to 100,406 lines, 41,575 test lines and 146 tables' is withdrawn: it argued from features being unused before opening.
- after: nothing
- notes: P3 because it is true but not bloat: a switch is a product decision. Not worth doing now for cost; worth a line in the doc so the next review does not propose it again.

### FT-9 [P3 S duplicate corrected OWNER-CHOICE] Campaigns and discount codes overlap at their edges; one page is planned, one engine is not worth it
- evidence: Campaigns have 7 kinds (campaigns.ts:24), discount codes 3 (discounts.ts:23). I listed both modules' exports. The shared part is small: a reaches() in each for the product and category reach (campaigns.ts:178, discounts.ts:380), a running and a status function in each (campaigns.ts:159 and :170, discounts.ts:401), and the three simple kinds. The bulk of each is its own: multi-buy, tiers, buy X get Y and the best off…
- cost: Two pages under one heading for the owner, and about 100 to 200 lines of parallel helpers. (An owner's admin; anyone changing pricing code)
- fix: 3 steps; first: Do the page merge already planned: one Discounts page with Automatic and Code (code review step 2.4; docs/audits/admin-usability-2026-11.md:198).
- done when: `rg -c "export function reaches" src/lib` counts one definition, and the money tests pass.
- saving: Estimate: one link (with step 2.4) and 100 to 200 lines of shared helpers.
- after: Code review step 2.4
- tracked: The page merge is audit phase 2 ('Campaigns and Coupons become one Discounts page', docs/audits/admin-usability-2026-11.md:198; code review step 2.4, Open).
- notes: P3: the saving is small and the code is money. Do the helpers only when that code is open for another reason.

### FT-10 [P3 L duplicate corrected OWNER-CHOICE] Four store engines have a platform twin with its own tables and runner: about 2,100 lines, built by the owner's own rule
- evidence: The parity rule of 6 November gives the platform every store feature (CLAUDE.md:403). For events it was built as separate platform_* tables and runners: workflows, integrations, own endpoints, a read-only API with tokens and ad conversions, about 2,090 lines by the skeptic's count, each on the owner's instruction (D465, D515, D516, D518; I read the rows). The twins share what they can (the workflow kit in src/lib/wo…
- cost: Each of these engines is kept and tested twice. At run time a few queue polls a minute for one tenant. (CI and anyone changing these engines; the server slightly)
- fix: 3 steps; first: The owner's choice, and not waste as it stands. Keep the twins and the rule unless the owner wants one engine.
- done when: A decision row says keep or fold. If fold: `rg -l "platform_workflows|platform_webhook_endpoints" src --glob '!*.test.*' | wc -l` prints 0.
- saving: Estimate if folded into Kaizena Flow's own store: about 2,100 lines, their tests and 8 tables. Nothing if kept.
- after: The owner's decision; FT-5 (the site served from the store first)
- tracked: no (docs/platform-parity.md tracks what the platform still lacks)
- notes: P3: a deliberate duplicate with a written reason and a small idle cost. The schema and duplication dimensions describe the same modelling question (null-store rows, platform_* twins and the house store); decide it once. Before opening is the cheapest time if …

### FT-13 [P3 L duplicate corrected OWNER-CHOICE] Bonus, referrals and creators are three reward models; whether to fold creators into referrals is a product choice
- evidence: Bonus credits (D130) are a ledger. The referral programme (D131) pays in those credits and needs Bonus on (store-features.ts:173), so it builds on bonus and does not copy it (affiliateProgram() takes the bonus programme it is given, affiliates.ts:58-69). Creators (D386) earn money commission with a code and have their own tables. The skeptic measured bonus at 4,008 lines, referrals and affiliates at 4,601 and creato…
- cost: Two attribution and payout models (referrals, creators) to keep correct in checkout and refunds. No cost per store once FT-15 is done. (Anyone changing checkout or refunds; CI)
- fix: 3 steps; first: The owner chooses the model: creators as a programme of their own (as built), or a creator as a kind of referrer whose reward is money, with one attribution table.
- done when: A decision row says keep or fold. If fold: `find src -iname '*creator*' ! -name '*.test.*' | wc -l` prints 0 and the money tests pass.
- saving: If folded (estimate): up to 1,411 lines and 5 tables, less what the referral programme gains. No running-cost saving either way.
- after: The owner's decision
- notes: P3: a product-model choice with no running cost. Not worth doing now as bloat removal.

## Refuted (not findings)
- FT-6 The developer platform (API, OAuth server, MCP, apps, endpoints) is open with no user: It argued for parking a feature because nobody uses it yet, which the owner's clarification rules out. Its only idle cost is two prune jobs (now in FT-3), and Kaizen Life's assistant already reaches the same MCP tools. …
- FT-11 Fiken is connected to no store while the aim is to make Fiken unnecessary: The case rested on an empty table. The plan it cited keeps Fiken and Tripletex as the bridge ('kept and supported'), and Fiken's idle cost is one statement every five minutes.
- FT-14 Checkout's delivery code imports all ten carrier adapters: The import is real but costs nothing that shows: the adapters are 1,702 lines inside shared server chunks of several megabytes, and a route that uses no carrier loads 10.9 MB anyway. Loading them on demand would touch n…
