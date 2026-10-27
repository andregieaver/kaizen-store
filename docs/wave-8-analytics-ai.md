# Wave 8: analytics and AI (decisions D345 to D353)

The contract for wave 8 of `docs/parity-plan.md`. It covers:

- reports an owner builds and saves over one safe query layer, and questions asked in words on top of it;
- a live view, and search tied to what was sold;
- targets beyond a month's revenue, alerts and a briefing that come to the owner;
- pictures made and edited in the media library and the product editor;
- the AI manager telling people when background work is ready, and keeping their own skills;
- AI in the open builder, and a store drafted from one description;
- marketing email written from the store's own facts;
- an endpoint and feeds for shopping agents.

It was written on 2026-10-27 from the seventeen rows of `docs/parity/rows` marked wave 8 (as re-rated through 2026-10-27), the plan,
CLAUDE.md and a read of the code. Code, tests and texts follow this file. A unit that must change course says so here first.

**What exists today (read in the code).**

- **Analytics** (D152, `docs/analytics.md`): fixed pages under `/admin/{store}/analytics/`. These are the overview, finance, products,
  customers, inventory, marketing, traffic, subscriptions, payouts, tax, speed and settings.
  - One definition per figure: a paid order is `PAID` in `src/server/analytics-sql.ts`, and amounts are without VAT in the main currency,
    converted in code by `inMain()`.
  - The heavy reads go through `setBased()`. Several readers use `setBasedReplica()`.
  - Products are cut by product only (`analytics-products-data.ts`). There is no variant, SKU, category or shown-currency cut.
  - Finance has *Payments by method* (D288).
  - Every table has a CSV (D165, `ANALYTICS_TABLES`).
  - There is no saved report and no query layer.
- **The AI manager's analytics**: fixed, code-counted tools. They include `analytics_overview`, `explain_change`, `analytics_alerts`,
  `sales_summary`, `sales_trend`, `sales_funnel`, `product_performance`, `customer_insights`, `search_insights`, `vat_report` and
  `oss_return_data`. A question outside them has no answer.
- **Visits** (no cookie, no storage): one row per hashed visitor and store day, keeping `first_seen` and `last_seen`
  (`src/server/analytics-visits.ts`). A cart made that day carries `carts.visit_id`. Nothing reads `last_seen` for a live figure.
- **Search** (D72, D324): `search_queries` logs a page search (query, results, arm) for 90 days, and clicks go through `search/go`.
  - A search is not tied to a visit, so revenue after a search is "not tracked" (`revenueTracked: false`).
  - The Traffic page lists searches, searches with no results and click-through.
- **Alerts, targets, forecast** (`alertsFor()`, `analytics_targets`, `forecastMonth()`): computed on read and shown in the admin.
  - A target is one month's net revenue.
  - The forecast is that month's revenue.
  - Nothing is emailed except the autopilot's digest and weekly report (D309), and only to people whose plans run.
- **Pictures**: `generateImage()` calls `/images/generations` with the picture model named in the AI settings, and
  `makeSitePicture()`/`makePicture()` keep the result in the media library (D283).
  - The builder's picture fields offer *Make with AI*.
  - The media library and the product editor do not.
  - A made picture is not marked as made, and its alt text skips the claims filter.
  - Nothing sends a picture to a model to change it.
- **The AI manager** (D94 to D334): about 190 store tools and 24 of its own. Gated calls are kept for a yes.
  - Background work runs in jobs: page builds, follow-ups, plans and the autopilot.
  - Finished work is told only in the conversation, on the Autopilot page or by email. Nothing in the header or the launcher says so.
  - Skills are 41 playbooks in code (`ASSISTANT_SKILLS`). A person cannot save one.
- **The builder** (D92, D128, D150, D283): the page studio builds a new draft, *Make my page cool* plans motion unsaved, and pictures are
  made per field.
  - A described change to the open page goes through the AI manager's `edit_page`, which saves a draft. It is not applied unsaved in the
    editor.
  - The header and footer are not drafted by AI: `set_header_footer` chooses the standard one's menus and logo.
- **Broadcasts** (D297, D318): *Write with AI* writes from the staff's own words only. It is never told a product or a price.
- **Shopping agents**: `/api/mcp` serves owner tools to Kaizen Life only (D96).
  - Feeds (D302) are Google RSS and Meta, TikTok and Pinterest CSVs, on or off for the store as a whole.
  - `AI_ASSISTANT_BOTS` and `AI_TRAINING_BOTS` (`src/lib/seo.ts`) are robots.txt switches.
  - There is no public endpoint, no `/.well-known/ucp`, no AI-channel feed and no agent channel in analytics (`CHANNELS` has none).

## 1. The units, in the order they are built

| Unit | Decision | What | Rows it moves |
|---|---|---|---|
| A | D345 | The report layer and builder: a closed catalogue of metrics and dimensions, a typed report spec compiled to SQL in one module, saved reports, the standard sales cuts (variant and SKU, category, shown currency, payment method) as dimensions | `analytics.custom-report-builder-and-shopifyql` (3), `analytics.standard-sales-reports` (5) |
| B | D346 | Asking in words: the AI manager fills a report spec, code checks and runs it, the answer can be saved as a report, and a question the layer cannot answer is declined with what can be asked | `ai.natural-language-analytics-and-custom-reports` (3) |
| C | D347 | Live view and search revenue: active visitors from `last_seen`, today so far, carts and checkouts in progress; a search tied to the day's visit, with orders and revenue after it | `analytics.live-view` (2), `analytics.on-site-search-analytics` (2) |
| D | D348 | Targets, alerts and a briefing that come to the owner: targets for orders, conversion and AOV over a week, month or quarter, a forecast with a range for more than revenue, alert emails and a weekly briefing the owner turns on, and an alert handed to the AI manager | `analytics.targets-alerts-forecasting` (2), `ai.proactive-insights` (2) |
| E | D349 | Pictures: *Make with AI* in the media library and the product editor, made pictures marked and their alt text through the claims filter, and editing (background removed or replaced, a described change) as a new library item | `ai.ai-image-generation` (2), `ai.ai-image-editing` (2) |
| F | D350 | The AI manager tells and remembers: a notice in the header and the launcher when background work is ready, and skills a person saves, edits and deletes | `ai.admin-ai-assistant-that-performs-tasks` (3), `ai.assistant-memory-and-saved-skills` (2) |
| G | D351 | AI in the builder and a store from one description: a described change applied to the open page unsaved, a header or footer drafted by AI, and one description turned into a theme, front page, pages and menus as drafts | `ai.ai-page-and-theme-generation` (2), `storefront.ai-store-and-page-building` (2) |
| H | D352 | Marketing email from the store's own facts: the writer chooses products and campaigns by tool, their prices and pictures put in by code as blocks, never written by the model | `ai.ai-written-marketing-email` (3) |
| I | D353 | Shopping agents: a public catalogue endpoint (UCP discovery and MCP), a cart handed back as the store's own checkout address, feeds in the AI channels' specs with a switch per channel, and orders attributed to an agent channel without a cookie | `ai.agent-ready-ucp-or-mcp-endpoints` (2), `ai.agentic-storefronts-chatgpt-gemini-copilot` (3, bucket B) |

Each unit is its own commit, or a few. Each has its own migrations, tests and decision row, and is shipped before the next starts.

- Unit A is detailed in section 3. The others are outlined in section 4 and get their detail when their turn comes.
- A comes first because B stands on it, and D's targets and C's search conversions read their figures through it where they can.
- F, G and H touch the AI manager's registries (`OWNER_TOOLS`, `TOOL_WORDS`, `ASSISTANT_SKILLS`). They are built one after another, never
  in parallel.

**Not in this wave.** `ai.ai-customer-support-chat-agent` is built (D216, steps 1 to 16). What keeps it partial is the human legal review
of the consumer texts in `docs/support.md` section 8. That is company work, listed in section 6. The workflow builder's AI half rides
with wave 9's Flow, as the plan says.

## 2. Rules for every unit

1. **One definition per figure.**
   - A new metric is written in `docs/analytics.md` first and implemented once.
   - A paid order is `PAID`, money is without VAT in the main currency, and it is converted in code (`inMain()`/`toMain()`).
   - A currency with no rate is left out and counted.
   - A figure that cannot be known says what is missing and how to add it, never zero.
   - An estimate says so.
   - A new money read gets a euro scenario.
2. **Never free SQL.**
   - Reports, questions in words, targets and the briefing read through the report layer or the existing loaders.
   - A model only fills a typed spec. Code checks it against the catalogue and compiles it.
   - The model never writes a query, a number, a price or a stock level. Arithmetic happens in code.
3. **Store-scoped and set-based.** Every query takes the store id and runs through `setBased()`, or `setBasedReplica()` where
   `replica-readers.scan.test.ts` lists the module. Never use the replica for a read after a write, tax reports or anything that decides a
   sale. An integration test shows one store cannot read another's report, notice, skill or picture.
4. **No new personal data in analytics.** The live view and search revenue read what visits already keep: a daily hash, `last_seen`, the
   cart's `visit_id`. There is no cookie, no storage, no IP address and no user agent. A briefing or alert email carries no shopper's
   name, email or address.
5. **AI stays grounded and metered.**
   - Every call goes through `aiFor(storeId, { feature })` and `metered()`, with a feature in `AI_FEATURES`. Pictures are priced
     `per_image`.
   - Every text passes `findClaims()` (and `findAvoided()` where the brand guide reaches it).
   - Every system prompt carries `UNTRUSTED_TEXT`.
   - Without a model the feature says so and nothing is spent.
6. **Gates and tools.**
   - A new AI manager tool has zod arguments, a `TOOL_WORDS` line, a permission key and a `gate` where it publishes, sends or spends.
   - A tool is served by the store MCP server like the rest.
   - A tool that changes what shoppers see is a draft until a yes.
7. **Jobs and emails.**
   - Jobs run through `runJobs()` in the five-minute dispatcher or a tracked cron route, in the name of who asked. That person is read
     again when the job runs (`passMembership()`).
   - Jobs never run for a store that is not open.
   - A briefing or alert email is sent once per period under an idempotency key. A new kind of email is in `EMAIL_KINDS`.
8. **Words.** New admin words go in the area's catalogues (en and nb, D312). Shopper words (the agent endpoint's errors, if any) go in nb,
   sv, da and en by hand.
9. **Public endpoints** (unit I) are rate-limited by `takeBudget()`, set no cookie, return no personal data, obey the store's crawler
   switches, and never take a payment.

## 3. Unit A (D345): the report layer and builder

### A.1 The catalogue

`src/lib/report-catalogue.ts` (pure, no zod in the browser's copy; schemas in `report-catalogue-schema.ts`) lists what can be asked.

- **Metrics** (`REPORT_METRICS`): each has a key, a kind (`money`, `count`, `rate`, `average`), English and Norwegian words, its definition
  in `docs/analytics.md`, the grain it is counted at (`order`, `line`, `visit`, `payment`) and the dimensions it can be cut by. They are:
  - net sales (`REVENUE_EX_VAT` less refunds, as Finance);
  - gross sales;
  - discounts;
  - refunds;
  - orders;
  - units sold;
  - average order value;
  - customers;
  - new and returning customers;
  - sessions and conversion (visit grain, only where visits were counted);
  - gross profit (with `costCoverageOf()` beside it);
  - VAT;
  - shipping.
- **Dimensions** (`REPORT_DIMENSIONS`):
  - day, week, month and quarter (in the store's time zone);
  - product, variant and SKU;
  - category (a product's terms; a product in two categories counts in both, and the report says the column does not add up);
  - tag, product kind and vendor (the manufacturer);
  - market (country), the currency the shopper saw (`orders.currency`) and channel;
  - device and discount code;
  - payment method (`methodGroup()`) and customer type (new or returning);
  - customer group and company;
  - subscription or bought once.
- **Filters**: any dimension, equal to one or several values. There is also `exclude_staff_made`, as the funnel does.
- **Allowed cuts**: a metric at `order` grain cut by a `line` dimension (product, variant, category) is counted from lines, with the line's
  share of order-level amounts as `analytics-products-data.ts` already does. The catalogue says which cuts a metric allows, and the
  builder offers only those.

### A.2 The spec and the one compiler

- **The spec.** `ReportSpec`: metrics (1 to 6), dimensions (0 to 2), filters (at most 10), period and compare (`AnalyticsParams`, D152),
  sort, limit (at most 500 rows) and chart (`table`, `bar`, `line`). It is checked by `reportSpecSchema`, then by `specProblems()` (a cut
  the catalogue does not allow, two time dimensions, a visit metric before visits were counted).
- **The compiler.** `src/server/report-query.ts` is the only module that turns a spec into SQL.
  - It starts from `PAID` orders in the period for the store, joins only what the chosen dimensions need, and groups by currency in SQL.
  - Converted in code, a currency with no rate is left out and counted.
  - Each metric's SQL fragment lives beside its definition in the module, written with `sql` fragments, never strings.
  - The result is typed rows (`typedRows()`), each money cell with its unconverted count.
  - A scan test fails if another module imports the fragments or builds a report query.
- **Reconciling.** `reportTotals()` checks that a cut by product, variant or currency adds up to the period's net sales from
  `periodTotals()` within rounding, and a test holds it for every money metric. A category cut says it may count a product twice.

### A.3 Saved reports and the screen

- **Storage.** `commerce.saved_reports` holds: `store_id`, `title`, `spec` jsonb (checked again on read; a spec that no longer passes shows
  why and opens in the builder), `created_by`, `updated_by`, `pinned` and timestamps. Rules:
  - At most 200 a store.
  - Written only by `src/server/saved-reports.ts`, audited `analytics.report_saved`/`_deleted`.
  - `COPY_RULES` `never`. Not personal data (`NOT_PERSONAL`: a definition of a figure, no person).
- **Analytics → Reports** (`/admin/{store}/analytics/reports`, `analytics:read`; saving `analytics:write`): a list of saved reports and
  *New report*. Building one is a single page with three parts:
  1. **Homer's start**: ten ready reports (sales by product, by variant, by category, by country, by currency, by payment method, by
     channel, by day, new and returning customers, discount codes), each one press away.
  2. **Lisa's builder**: metric and dimension pickers that offer only allowed cuts, filters, the period and compare model shared with the
     other pages, and sort.
  3. **The result**: the table always, a chart when asked, and the definition in words under it (`describeSpec()`: "Net sales by variant,
     1 to 31 October 2026, compared with September, paid orders, without VAT, in NOK; 2 orders in a currency with no rate left out").
- **CSV.** A report's CSV is an export of `ANALYTICS_TABLES`' kind (`report.saved`), through `writeCsv()`, POST with `analytics:write`, and
  refuses another store's report id.
- **The standard cuts.** The standard sales row's cuts are the ready reports above, so `analytics.standard-sales-reports` closes with the
  same code: variant and SKU, category, shown currency and payment method.

### A.4 Tests

- **Pure**: `report-catalogue.test.ts` (every metric has a definition, words in en and nb, allowed cuts; `specProblems()`;
  `describeSpec()`).
- **Integration**: `report-query.int.test.ts`.
  - Every metric by every allowed dimension on a seeded store.
  - A euro scenario.
  - Reconciling to `periodTotals()`.
  - Another store's report refused.
  - An unknown key refused.
  - `analytics-perf.int.test.ts` gains the widest cut.
- **Signed-in e2e**: `e2e/signed-in/reports.spec.ts` opens a ready report, saves a changed one, reopens it and downloads the CSV.

### A.5 Steps

1. The catalogue, spec and compiler with their tests.
2. Saved reports, the screen and the CSV.
3. The ready reports, the parity rows, `docs/analytics.md`, CLAUDE.md and D345.

### A.6 As built (27 October 2026)

Built as above, with these differences:

- **Figures.** Net sales, gross sales, discounts, refunds, orders, units sold, average order value, customers, gross profit and VAT. Not yet: sessions and conversion (visit grain), new and returning customers as figures (they are a cut, `customer_type`), and shipping.
- **Cuts.** Day, week, month, quarter, product, variant, SKU, category, tag, kind of product, country, currency, channel, device, discount code, payment method and new or returning customer. Not yet: vendor, customer group, company, and subscription or bought once.
- **Adding up.** A line cut carries a rest row (the orders' totals less their lines' sum: shipping and order amounts no line carries), so the column adds up to the period's figure; held to `periodTotals()` and `productsReport()` in `report-query.int.test.ts`, not by a `reportTotals()` of its own. A category or tag cut says its column does not add up and has no rest row.
- **CSV.** A POST to `reports/csv` (`analytics:write`, same site, audited `analytics.report_exported`), not an `ANALYTICS_TABLES` entry: a report's columns are its own.
- **Not built.** The scan test that no other module builds a report query, `pinned`, and filters on `exclude_staff_made`.
- **Tests.** `report-catalogue.test.ts`, `report-query.int.test.ts` (13 cases, a euro case among them), `report-view.test.ts`, the two widest cuts in `analytics-perf.int.test.ts`, and `e2e/signed-in/reports.spec.ts`.

## 4. The other units, outlined

- **B (D346) Asking in words.** The AI manager gets three tools:
  - `run_report`: arguments are a `ReportSpec`, checked by the same schema and `specProblems()`, run by the compiler, answering rows and
    `describeSpec()`. Ungated, `analytics:read`.
  - `save_report`: ungated (it changes nothing a shopper sees), `analytics:write`; it saves through `saved-reports.ts` and answers the
    report's address.
  - `report_catalogue`: what can be asked, in the catalogue's words.

  The prompt line for analytics tells the model to fill a spec and repeat the rows, never to add, average or convert. When a question
  cannot be put as a spec, the tool's refusal says what can be asked (`specProblems()` in words). Without a text model the fixed tools still
  answer. The feature is `analytics_question`. In the panel, an answer that came from `run_report` shows *Save as report*. The safety eval
  (`agent-eval.ts`) gains a case where a tool answer hides an instruction to state a different figure.

- **C (D347) Live view and search revenue.**
  - **Live** (`/admin/{store}/analytics/live`, `analytics:read`) polls every 10 seconds while open (decision 2) and reads
    `liveFigures()`:
    - visitors with `last_seen` in the last five minutes;
    - today's sessions, orders and net sales so far in the store's day (main currency without VAT, a euro scenario);
    - carts changed in the last 30 minutes;
    - checkouts in progress (orders `pending_payment` with an open session).
  - With visit counting off, the visitor figures say what is missing and link to turning it on. There is no map: visits keep a country, so
    a table by country is shown instead.
  - **Search**: the search page writes `search_queries.visit_id`, the day's visit for the same hashed visitor, worked out on the server as
    `/api/visit` does, only while the store counts visits and never with GPC or Do Not Track. The report gains orders and revenue from
    carts of that visit made after the search, the paid-order definition, and conversions over time.
  - Searches with no results and with low click-through are listed with links to synonyms and search rules (D324).
  - `docs/analytics.md`'s *Not tracked* line about search changes to say "before visit counting was switched on".

- **D (D348) Targets, alerts and a briefing.**
  - **Targets**: `analytics_targets` gains `metric` (net sales, orders, conversion, AOV) and `period` (week, month, quarter, custom up to
    two years). Progress is against the weekday-weighted expectation. One target per metric and period start.
  - **Forecast**: the forecast covers orders as well as revenue, with its range. It says it is an estimate, and says "too little history"
    under 14 days.
  - **Alert emails** (`analytics_alert_settings`: on or off, recipients among members whose role reads analytics, severity floor) are
    sent by `sendAlertEmails()` in the five-minute dispatcher once a day per store, once per alert and day (`analytics_alert_sends`, key
    store, alert, day), with the page's own minimum volumes. Copied and host orders are already out of `PAID`.
  - **The weekly briefing** (opt-in, decision 5; weekly or daily) is built in code from `alertsForStore()`, the store checkup and the
    week's totals:
    - each item links to the page that acts on it;
    - it is sent once per period (`briefing_sends`), and never for a quiet store (no paid order and no alert in the period);
    - it never goes to a platform admin as such;
    - an optional model note passes `checkedNote()` (no digit, no claim), as the autopilot's report does.
  - **To the AI manager**: an alert on Home and the Overview gets *Ask the AI manager*, which opens the panel with the alert's figures as
    the first message (the facts from `alertsFor()`, not the model's), to propose a gated next step.
  - Words go in the `analytics` and `staffEmails` catalogues.

- **E (D349) Pictures.**
  - **Making**: *Make with AI* opens in the media library and the product editor's pictures (the same dialog as D283's, through
    `makeSitePicture()`). The product editor's brief starts from the product's title and kind, never a price. The result is shrunk to WebP
    with its small copy and registered in the library.
  - **Marking made pictures**: `media.made_by` (`person`, `ai_made`, `ai_edited`) is shown as a chip in the library and in the picture's
    details. The alt text from the brief passes `findClaims()`; on a claim it is left empty for the AI alt-text pass (D89).
  - **Editing**: a library picture gets *Edit with AI*: *Remove the background*, *New background* (described) and *Change* (described).
    It goes through `editImage()` in `src/server/ai.ts`, the OpenAI-compatible `/images/edits` with the model named in the AI settings'
    new *Model that edits pictures* field (`ai_providers.image_edit_model`, never a model in code; decision 3).
    - The picture sent is the library's own file (`ownMediaFile()`), never an address a person typed.
    - The result is a new library item (`made_by = 'ai_edited'`, `edited_from` the original's id); the original is never overwritten.
    - It is metered `per_image` under the feature `picture_edit`.
    - Without an edit model the action shows as unavailable, with the reason and a link to `/settings/ai`.
    - `mediaUses()` and the copy rules are unchanged: an edited picture is an ordinary library file.
  - **Usage**: `checkLimit()` applies to AI on Kaizena Flow's key as for generation.

- **F (D350) The AI manager tells and remembers.**
  - **Notices**: `commerce.assistant_notices` holds `account_id`, `store_id` (null for the platform), the kind (`page_built`,
    `follow_up`, `plan_step`, `plan_question`, `approval_waiting`, `report_ready`), a reference, the words' key and facts, a link, `read_at`
    and timestamps. It is written only by `src/server/assistant-notices.ts` from the jobs that finish work (`runPageJobs()`,
    `runFollowUps()`, the autopilot loop, kept approvals).
    - A count shows on the AI manager's launcher and in the account menu. A list opens in the panel, and each notice opens its
      conversation or page.
    - Notices are kept 60 days.
    - They are personal to the account. Not shopper data: `NOT_PERSONAL`, a staff member's own work queue. `COPY_RULES` `never`.
    - The email the jobs already send is unchanged.
  - **Saved skills**: `commerce.assistant_skills` holds `account_id`, `store_id` or null (scope: mine, or the store's when an owner shares
    it), a key, a title, a description and the steps in words (at most 2,000 characters). Rules:
    - Written only by `src/server/assistant-saved-skills.ts`, after `readLearned()`'s filters (no secret, no customer's details) and
      `findClaims()`.
    - A key never takes a built-in id.
    - *Save as skill* sits on a conversation's request in the panel. The panel's Skills tab lists, edits and deletes them.
    - `use_skill` loads a saved skill as it loads a built-in one. Its steps can call only the tools the person may use, and gated tools
      stay gated.
    - The tools `save_skill` and `delete_skill` are ungated, the person's own.

- **G (D351) AI in the builder and a store from one description.**
  - **Change the page in front of you**: the builder's *Change with AI* takes a description. The model returns a plan of edits on the
    open page's existing parts (`parsePagePlan()`: the row and text edits of `src/lib/page-rows.ts` and `mapTexts()`, by part id; new
    sections only from `PATTERNS`), tried by `dryRunEdits()` and applied to the editor unsaved through `edit()` (one Undo step).
    - Nothing is saved until the person saves.
    - The model never writes CSS, script, structure outside the plan, or a link outside `SiteFacts.links`.
    - Every text passes `findClaims()`.
    - The feature is `page_change`.
  - **Header and footer**: `draft_header_footer` builds a header or footer page (type `header`/`footer`) from the theme's sections and
    `SITE_PARTS`, with the store's own menus and logo, saved as a draft. Making it the site's is gated (`set_header_footer`).
  - **A store from one description**: *Start from a description* in the setup wizard and the AI manager's `draft_store`. One description
    becomes a plan:
    - a theme or preset (`list_themes`) or a designed look (`design_look`);
    - a front page and three pages through the page studio;
    - a menu of those pages.

    Each step runs as the existing tools do (`build_page` jobs, an install not live). The owner reads the drafts on one *Your drafts*
    card and publishes with one press (gated as each tool is). Nothing is published or made live without a yes.
  - **Merging rows**: decision 7 merges the two rows.

- **H (D352) Marketing email from the store's own facts.**
  - *Write with AI* in the broadcast editor and the AI manager's `draft_broadcast` get read-only tools:
    - `find_products` (the store's offered products: title, kind, picture, the market's price as shown, through the catalogue's cached
      reads);
    - `running_campaigns` (`campaignNotices()`'s facts).
  - The model chooses products and campaigns by id and writes the words. Code puts in each chosen product as a broadcast `product` block,
    a new block in `broadcastContentSchema`, drawn by the email with its picture, the market's price written by `formatMoney()` from the
    read, and its link.
  - A price, discount or stock figure in the model's words is refused (`findClaims()`'s money rule).
  - The segment chosen shapes the words (its description, never its people).
  - Sending stays the person's press, or the gated `send_broadcast`, to subscribed addresses with the unsubscribe link.
  - A euro scenario covers a broadcast for a euro market's segment.

- **I (D353) Shopping agents.**
  - **Discovery**: `/.well-known/ucp` on a store's own host (and `/s/{store}/.well-known/ucp` until P7 domains) describes the store and its
    endpoint. `/agents.md` and llms.txt link it.
  - **The endpoint**: `/api/ucp/{store}/mcp` is a public MCP server, separate from `/api/mcp`, which stays Kaizen Life's only. Its tools
    are:
    - `search_catalog` (keyword and meaning, `rankedSearch()`, no query understanding, no cost);
    - `get_product` (the product page's own facts: title, description, variants, the market's VAT-inclusive price as `<Price>`'s rules
      give it, available or not, pictures);
    - `create_cart`: lines by variant and quantity, checked as adding in the store is (`sellableQuantity()`, quantity rules,
      registrations), answering the store's own address to open it, the hand-off of D170 (`createHandoffCart()`). Nothing is ordered or
      paid there.

    It has a budget per store and per hashed caller (`takeBudget()`), sets no cookie and holds no personal data. It answers only for an
    open store with the shop on, not private, with its *Shopping agents* switch on. Its replies are logged as counts.
  - **Feeds**: `FEED_CHANNELS` gains `openai` (ChatGPT shopping's product feed spec) and later `perplexity` and `copilot` once their
    specs are read (decision 4). Each is built from `storeFeed()`, with a per-channel switch that defaults to off (`feed_settings.channels`),
    and validated in a test against the spec's required fields.
  - **Attribution**: the visit's channel gains `ai_agent` (`CHANNELS`), from the referrer's host (`chatgpt.com`, `perplexity.ai`,
    `copilot.microsoft.com`, `gemini.google.com`) or a feed link's `utm_source`, with no cookie. A cart handed over by `create_cart`
    carries `carts.source = 'agent'`. Orders count by channel as before.
  - **Live**: the row is bucket B. It is live only once each channel's programme accepts the store, which the row says.

## 5. Decisions (to be taken by the owner)

| # | Decision | Options | Recommendation |
|---|---|---|---|
| 1 | **What a report can ask** (unit A) | A closed catalogue of metrics and dimensions compiled by one module; a query language of our own over views (ShopifyQL-like); free SQL for owners | The closed catalogue. It covers the standard cuts, keeps every figure to its one definition, and is what a model can fill safely (unit B). A query language can come later over the same compiler. |
| 2 | **How live the live view is** (unit C) | Polling every 10 seconds while the page is open; Supabase Realtime pushing visits | Polling. It needs nothing new, and the support inbox already shows that polling alone must always work. Realtime can be added later, as a ping only. |
| 3 | **Where pictures are edited** (unit E) | The provider's image-edit endpoint (OpenAI-compatible `/images/edits`) with an edit model named in the AI settings; background removal in the browser with a downloaded segmentation model; a background-removal service (remove.bg, outside the EU) | The provider's edit endpoint, named in the AI settings like every model, so a store's own provider or Kaizena Flow's decides where the picture goes (as for generation today). In-browser removal may follow if owners ask for it offline. |
| 4 | **Which shopping agents first** (unit I) | Our own public endpoint plus ChatGPT's product feed now, other channels as their specs are read; wait for each programme | Build the endpoint (UCP discovery and MCP), the ChatGPT feed and the switches now, every switch off by default; add Perplexity and Copilot when their feed specs are read. The row stays partial (bucket B) until a programme accepts a store. |
| 5 | **The weekly briefing and alert emails** (unit D) | Off until the owner turns them on; on by default for owners | Off by default, offered once on Home with one press to turn on (and the frequency), as the parity criterion asks; alert emails also off until chosen. |
| 6 | **Saved skills: whose** (unit F) | Each person's own; each person's, and an owner may share one with the store's staff | A person's own, with *Share with the store* for owners; a shared skill still runs with the runner's own permissions. |
| 7 | **The two AI building rows** (unit G) | Keep `ai.ai-page-and-theme-generation` and `storefront.ai-store-and-page-building`; merge them (README rule 8: one Shopify feature, Sidekick in the theme editor) | Merge into `storefront.ai-store-and-page-building`, keeping the stricter criteria of each. |

Unit A needs none of decisions 2 to 7. It is built first as decision 1 recommends, and the recommendation can be changed before unit B.

**Taken (2026-10-27).** The owner accepted every recommendation:
- reports over a closed catalogue compiled by one module (A, B);
- the live view polls every 10 seconds (C);
- pictures are edited through the provider's edit endpoint named in the AI settings (E);
- shopping agents get our own endpoint and ChatGPT's feed first, every channel off by default, others as their specs are read (I);
- the briefing and alert emails are off until the owner turns them on (D);
- saved skills are a person's own, shareable with the store by owners (F);
- the two AI building rows are merged into `storefront.ai-store-and-page-building` (G).

## 6. Company work, not software

- **Legal review of the support chat's consumer texts** (`docs/support.md` section 8), which is all that keeps
  `ai.ai-customer-support-chat-agent` partial.
- **Data processing for picture editing**: a picture sent to the provider is processed where the provider is. The AI settings page says
  so, as it does for generation.
- **Shopping programmes**: accepting each channel's terms (ChatGPT merchants, Perplexity, Copilot) is the store's or Kaizena Flow's, per
  programme.
