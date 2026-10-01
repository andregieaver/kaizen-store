# A/B testing

Design for an A/B testing tool that platform admins and store owners use to find out whether a change to a page earns
its place. Status: **design, nothing built** (D148). It builds on [`measurement.md`](measurement.md), whose principles
it keeps, and on what already exists: the page builder, `src/lib/experiment-stats.ts`, the search test (D77) and the
recommendations test (D139/D140).

## Decisions

Settled with the owner before this was written:

1. **Who is counted: only visitors who have given consent, and signed-in customers.** Everyone else sees the original,
   is never enrolled, and nothing is stored about them. Results describe those visitors, and the results page says so.
   The legal reading (below) is checked before the first experiment goes live, not after.
2. **What can be tested in version 1: whole pages and parts of pages** (a row, a column or a block). Prices,
   discounts, shipping and anything that changes what a customer is charged are out (see "Not testable").
3. **Who can run tests: store owners and staff** (anyone who may edit pages, and by the same rule: staff publish pages
   today). Platform admins run tests on Kaizen's own pages.
4. **A paid-plan feature.** One row in the plan comparison (D132) says which plans include it; nothing in the engine is
   gated by code other than that row.

Assumption to confirm: question 3 was answered "yes" to "staff or only owners", read as *staff may start tests*.
Applying a winner uses the same rule as publishing a page, so it is the same people. If owners only is wanted, it is
one check in `requireMember()`'s caller.

## Principles (kept from `measurement.md`)

- Randomise who is eligible, then compare everyone assigned; never compare people who used a thing with those who did
  not.
- One chosen goal per test, decided before it starts, and the decision rule is fixed in advance.
- Guardrails can stop a winner. A split that is not the split we asked for means broken data, not a result.
- Run whole weeks, at least two, and show each week apart.
- Assignment is on the server and deterministic; no routing middleware (it runs outside the EU).
- Money is minor units plus a currency, never added across currencies.
- No names, emails or free text in anything an experiment records.

## What a test is made of

| Concept | Meaning |
|---|---|
| **Experiment** | One question about one thing: "Does a shorter hero get more visitors to the product page?" Belongs to a store, or to Kaizen (null store) like pages do. |
| **Target** | What is varied: a **page** (published page, article, product layout, header, footer) or a **part** of one (a row, column or block, by its id). |
| **Variants** | The original (**A**, the control, always present) and one or more others (**B**, **C**, …). A variant of a page is a full copy of it (D126's `duplicatePage`, kept as a draft nobody else can publish); a variant of a part is a replacement for that part's JSON. Up to four variants in version 1. |
| **Goal** | What counts as success, chosen from a short list (below). One primary, a few guardrails. |
| **Audience** | Optional narrowing: markets, new or returning, device, signed in or not. Default: everyone enrolled. |
| **Traffic** | The share of eligible visitors enrolled (default 100 %) and how it is split between variants (default even). |
| **Status** | `draft` → `scheduled` or `running` → `stopped` (by a person, or by a guardrail) → `finished`; and from there, `applied` (a winner became the page) or `discarded`. |

### Goals

A goal is one of a fixed set, each with a defined way of counting, so no one writes event queries:

| Goal | Counted as | Notes |
|---|---|---|
| Paid orders | Share of enrolled visitors with a paid order after exposure | Primary choice for pages near checkout |
| Revenue per visitor | Paid orders' value (without VAT, shipping excluded) per enrolled visitor, per currency | Winsorised at the 99th percentile so one big order does not decide |
| Added to cart | Share who put something in the cart | Higher baseline: reaches an answer sooner |
| Reached checkout | Share who started checkout | |
| Clicked this | Share who clicked a chosen button or link in the variant | For a part: picked by clicking it in the builder; tracked by a data attribute, never by owner script |
| Viewed another page | Share who then opened a chosen page | For landing pages and article tests |
| Signed up | Share who submitted a chosen form, or signed up for the newsletter | Kaizen's own sign-up page uses this |

Guardrails are always on, whatever the goal: refund and return rate (read late, 30 days), order count and revenue per
visitor if the goal is something else, page speed (LCP of the variant against the original, from the browser's report)
and checkout errors. A guardrail that turns clearly bad stops the test (below).

## Not testable (version 1)

- **Prices, campaigns, discount codes, bonus credits, shipping prices and delivery options.** Showing different prices
  to comparable shoppers raises price-discrimination and price-indication rules (the 30-day reference price). A later
  decision, with legal input.
- **Legal and compliance pages** (terms, privacy, cookies, withdrawal) and anything `isLegalPage()` says is one, a
  product's safety information, and the cookie banner.
- **The logic of the working pages** (cart totals, checkout, payment). Their *surrounding* rows and blocks can be
  varied later, in phase 3, because they are ordinary parts around a shop component; the shop component itself cannot.
- **Anything with a recipient** (email forms, newsletter forms): a variant never carries recipients (they stay on the
  original).

## Who is counted, and the consent question

The store sets no non-essential cookies (D14, D58). A test needs a visitor to see the same version every time, which
needs something remembered. So:

- **Visitors who have accepted the `statistics` category** get one cookie, `kaizen_ab`, listed in `KNOWN_COOKIES` with
  that category and a purpose that says what it is. It holds a random id (never derived from anything about the
  person) and the variants assigned, and lasts 90 days. It is written only after consent, by the same
  `ConsentManager` path as other optional items, and removed when consent is withdrawn.
- **Signed-in customers** are assigned from their account: the assignment key is an HMAC of the customer id with a
  platform secret kept the way `SETTINGS_ENCRYPTION_KEY` is, so the raw id is never in an experiment table and the same customer
  sees the same version on every device. Whether this needs consent or rests on legitimate interest, plus a line in the
  store's privacy text, is part of the legal check. Until it is settled, signed-in customers are enrolled only if they
  have accepted `statistics` too.
- **Everyone else** sees the original. No cookie, no storage, no exposure row, no fingerprint (no IP or user-agent
  hashing). They are not "in the control group": they are outside the test.
- **Bots and crawlers** always get the original, never an exposure, so search engines see a stable page.

Consequences the product must be honest about: the sample is smaller than traffic (only consenting visitors), and it
may differ from non-consenting ones. The setup step shows "about N of your visitors can be enrolled" from the
consent log (`commerce.consents`), and the results page says "visitors who accepted statistics cookies, and signed-in
customers".

**Legal check before launch** (not legal advice, listed so it is not forgotten): ePrivacy treatment of the A/B cookie
for each market's regulator; whether signed-in assignment needs consent in each country; and the privacy-text wording. Output: a short note added to this file, and a decision row if anything
changes the above.

## Showing a variant without losing speed

Store pages are prerendered and cached (D54). A test must not turn them into slow dynamic pages, must not flicker or
shift layout, and must show crawlers the original. The constraint that makes it hard: the first time a consenting
visitor arrives they have no assignment yet.

**The design to prove in a spike (phase 0):**

1. **First view: the original, for everyone.** The cached page is sent as today. After consent, a small script asks
   `POST /api/ab/assign`, which draws the assignment (random, or the hash for signed-in customers), sets `kaizen_ab`,
   and returns it. Nothing is logged yet, and nothing changes on screen.
2. **Next views: the assigned version, from cache.** The page is prerendered once per variant (a variant is a page
   with its own address segment, `/s/{store}/{market}/{slug}/~{variantId}`, not indexed, canonical to the
   original), and a rewrite in `next.config.ts` chooses between them from the `kaizen_ab` cookie (`has` condition
   on the cookie, from a generated list of running experiments the way `store-hosts.ts` is generated: a change to a
   running experiment deploys again, like a domain change, P8). No request-time compute for the page itself.
3. **Exposure is counted when a variant is actually shown after assignment** (a tiny beacon on the variant's page),
   so first views count for no arm. This is the same in every arm, so it leaves the comparison fair; it only
   makes each visitor start counting from their second page view.
4. **For a part**, the page is rendered with the part's variants prerendered the same way (page variants where only
   that part differs), so a part test is a page test whose copies differ in one place; the builder hides the plumbing.
5. **Signed-in customers**: their pages are already dynamic (the session is read), so the variant is chosen on the
   server from the account's key, with no beacon delay. Spike confirms this is allowed without the cookie.

**Alternatives if the spike fails**, in order: (a) render the varied part in a dynamic hole (`<Suspense>`) that reads
the cookie, the original as its fallback (flicker for variant visitors only, and a measured cost in time to first
byte); (b) the Flags SDK's precompute approach, if it can run in the EU. Rejected: client-side swapping of hidden
copies (layout shift, doubled HTML, crawlers see both).

**Spike pass criteria**: time to first byte of an enrolled view within 20 ms of an unenrolled one; no layout shift
caused by the swap; Lighthouse performance unchanged; crawlers and no-cookie requests get byte-identical HTML to
today; build time for a store with 10 running experiments stays within a minute of today's. If it fails, we use the
fallback and say what it costs before building more.

## Data

All tables are store-owned (`store_id`, null for Kaizen's) and RLS-on like the rest of `commerce`. Each is classified
in `COPY_RULES`: the definitions (`experiments`, `experiment_variants`, `experiment_goals`) are `never` (a duplicated
store does not inherit a running test; pages it copied are the originals), and the rest are `derived`.

```
experiments          id, store_id, name, hypothesis (text, ≤500), target_type, target_id, part_id (null for a page),
                     status, split (jsonb: variant → share), traffic_share, audience (jsonb), primary_goal,
                     min_visitors, min_days, planned_end, started_at, stopped_at, stop_reason, applied_variant,
                     created_by, updated_by, created_at
experiment_variants  id, experiment_id, key ('a','b',…), name, page_id (a copied page) or part (jsonb), is_control
experiment_goals     experiment_id, goal, role ('primary'|'guardrail'), params (jsonb: page id, form id, element id)
experiment_exposures experiment_id, visitor (random id or HMAC), variant, first_seen, market, device, new_visitor
experiment_events    experiment_id, visitor, variant, goal, value_minor, currency, occurred_at   -- clicks, carts, signups
experiment_results   experiment_id, day, variant, visitors, conversions, revenue_minor (per currency), …  -- daily rollup
```

Rules the database holds, with tests in `commerce.test.ts`:

- At most one running experiment per target (a page, or a part): the **mutual exclusion** rule, a partial unique
  index. A page test and a part test on the same page also exclude each other. At most five running tests per store
  (a setting a plan may change).
- A variant row's page belongs to the experiment's store; a control exists; shares sum to 100; statuses move only
  forward (`draft → running → stopped → finished → applied/discarded`).
- Exposures are one row per visitor and experiment (a unique key makes recording idempotent). Events carry no
  personal data. Rows older than 400 days go (`pruneUsage()`'s pattern in the daily job); rollups stay.
- A running experiment's variants cannot be edited (a changed variant is a different test). Editing means copying to a
  new experiment. This is the rule that makes results mean something.

Orders are attributed from the order's own data: an exposure's visitor is joined to the cart (the `kaizen_ab` id is
stored with the cart when a cart is made by an enrolled visitor, like `recommendation_adds` does with the tab id) or
to the signed-in customer's key. Only orders placed after the exposure and paid count (`complete_order_payment`),
copied orders (D129) and host orders never do, and refunds reduce revenue by trigger-free recomputation in the
rollup, never by editing orders.

## Measuring, and saying it in words

- **Rates** (orders, add-to-cart, clicks…): the share of enrolled visitors per variant, the difference with a 95 %
  interval and "the chance B is better", from `experiment-stats.ts` (`difference`, normal approximation), extended
  with a Bayesian reading of the same counts for the plain-language line. **Revenue per visitor** uses the winsorised
  mean and a bootstrap interval, done in a job, not per page view.
- **Split check every day**: `sampleRatioP()`. A failing check makes the verdict "something is wrong with the data",
  with the likely causes listed (a rewrite not matching, a bot, a variant that breaks for one browser).
- **No peeking trap.** The verdict is only given once the planned minimum is reached (visitors per variant and whole
  weeks, whichever is later). Before that the page shows direction and the estimate's width and says "too early to
  say". The only early stop is a guardrail turning clearly bad.
- **Plain language, always the same shape:** "B got 12 % more orders than A (from 2.0 % to 2.2 %). We are 94 % sure
  B is better. This is based on 4,120 visitors who accepted statistics cookies, over 14 days." With one of four
  verdicts: *B is better*, *A is better*, *no clear difference*, *not enough visitors yet*, and the next step offered.
- **Before launch, the honest estimate:** from the page's recent enrolled traffic and the goal's baseline, "to see a
  15 % change you need about 9,000 visitors a variant, around 21 days at today's traffic". If that is more than six
  weeks, the flow says so and suggests a goal with a higher baseline (add-to-cart, a click) or a bolder change. This is
  `measurement.md`'s "traffic is the constraint" made visible; many small stores will see it.
- **Novelty check:** results are shown per week; a gap between week one and later weeks is flagged.
- **Segments** (market, device, new/returning) are shown only as exploratory, with the multiple-comparison warning,
  never as a verdict.

## The user experience

A guided flow, in the store's Marketing sidebar (**A/B tests**, `/admin/{store}/experiments`; Kaizen's at
`/admin/platform/experiments`, under Website), built from the admin's existing parts (`AdminFrame`, `ActionForm`,
the page builder). Version 1 is five steps, each one screen, with a summary rail:

1. **What do you want more of?** Pick a goal from the list in words ("more orders", "more people adding to the cart",
   "more clicks on a button"). The estimate of how long it will take updates as choices are made.
2. **What do you want to test?** Pick a page (from the pages list, with last month's visitors beside each) or open
   the page and **click the part** in the builder. Pages that cannot be tested say why.
3. **Make your version.** The builder opens on a copy (variant B) of the page or part, with a banner "Testing: B
   against the original", the original one tab away, and everything the builder does (blocks, styles, translation,
   AI help) available. **Create with AI** offers variants the owner may edit (see below).
4. **Who and how much.** Default: all enrolled visitors, even split. Optional: markets, device, new/returning,
   traffic share. Shows the estimated duration and flags a test that will take too long.
5. **Check and start.** A preview link that forces each variant (for QA, signed in only, never counted), a checklist
   (goal is reachable, variant publishes cleanly, no other test on the target, split is valid), and **Start**. A
   scheduled start and end are options.

While it runs, one **results page**: the verdict sentence first, then a chart per variant over time, visitors and
the daily split check, the goal and guardrails, and the weekly breakdown. Actions: **Stop**, **Extend**, **Apply B**
(copies the variant's content into the original page and publishes it, as one audited change, and ends the test),
**Keep A** (discard).

Principles for the screens: a plain-language sentence beside every number; no p-values on the main view (shown under
"How we worked this out"); every limit explained where it appears; nothing editable that would invalidate a running
test; mobile works for reading results and stopping a test.

## AI help (the AI manager and the page studio)

All of it suggests; none of it launches or applies. Tools in the AI manager (D94), each with zod arguments, amounts
in code, a line in `TOOL_WORDS` and, where it changes the site, a `gate`:

- `suggest_experiments` (read): from the store's pages and traffic, three things worth testing and why, with
  baselines counted in code. The model orders and words them; it never states a number it was not given.
- `draft_variant` (draft, gated `public`): writes a variant of a page's headline or text. Every text passes
  `findClaims()` (D76) before it can be used. It creates a draft variant the owner then edits, nothing live.
- `start_experiment` and `apply_winner` (gated `public`): kept for approval, run on the person's yes.
- `explain_results` (read): reads the verdict computed in code and explains it in the person's words and language; it
  cannot change a verdict.

Costs are metered (`aiFor(storeId, { feature: "experiments" })`, a new entry in `AI_FEATURES`) and counted in the usage
reports (D106, D145).

## Platform and stores

- **Store owners and staff** test their own stores; platform admins test Kaizen's pages (sign-up, plans, front page).
  The engine takes the owner as pages do (`storeId | null`), and the platform's actions are bound separately in a
  `context.ts`, as `PageOwnerContext` is.
- **Cross-store view** for the platform: a table of every running test, store, age and verdict (read-only), to spot
  stuck or harmful tests; platform admins cannot edit a store's test.
- **Existing tests** (search D77, recommendations D140) keep working. In phase 5 they move onto the engine's goals
  and statistics, with their per-search and per-tab units kept (the engine supports a "unit" other than the
  visitor, for tests that need no storage at all).

## Permissions, audit and limits

- Creating, starting, stopping and applying go through `requireMember()` (stores) or `requirePlatformAdmin()`, and are
  written to `commerce.audit_log` with the experiment id and what changed.
- Applying a winner is a normal page publish (`savePage`, `updateTag(pagesTag(owner))`), so redirects, sitemaps and
  caches behave as today.
- Limits: five running tests per store, four variants, 90-day maximum run, name and hypothesis lengths, 200 exposures
  per second per store (shed, never queued). A test that runs past its planned end shows "finished, decide" and stops
  counting after seven more days.
- A guardrail stop is automatic only for: checkout errors above the original's by a clear margin, LCP clearly
  worse, or orders per visitor clearly worse after the minimum. It stops the test and emails the owner.

## Privacy, residency, and what we store

- Everything is in our own database in Dublin (D5): no vendor sees an experiment. GrowthBook (considered in
  `plan.md`) is not used; the statistics are small and already in-house.
- The data kept per visitor is a random id, a variant, a market, a device class and timestamps. No IP, no user-agent,
  no names.
- The Cookies page lists `kaizen_ab` (`KNOWN_COOKIES`), the consent log records the choice, and the store's privacy
  text gets a sentence from the template when the first test is started (the owner confirms it).
- Withdrawing consent removes the cookie; the visitor's exposure rows stay but can no longer be linked to anyone.

## Build order

| Phase | What | Done when |
|---|---|---|
| **0** | Spike (variant serving, signed-in path), legal check, `plan_features` row, final stats choice | The spike meets its pass criteria; the legal note is written; this file is updated |
| **1** | Engine and **page** tests for store pages: tables and rules, assignment, `/api/ab/assign`, exposure beacon, order attribution, daily rollup job, split check, results page (verdict sentence, charts), start/stop/apply, audit, tests incl. an end-to-end test with two variants | A test runs on the demo store from creation to applied, in the browser, with consented and unconsented visitors |
| **2** | **Part** tests in the builder (click a part, "Test this"), the five-step flow, estimates, preview links, scheduled start | A person who has never seen it creates a test in a few minutes (a moderated check with two owners) |
| **3** | Product layouts, headers and footers, modals; surrounding rows on working pages; Kaizen's own pages (platform) | Platform runs the plans-page test |
| **4** | AI manager tools and drafts, the platform's cross-store view, guardrail auto-stop emails | Gated tools tested like other gated tools |
| **5** | Move search and recommendations tests onto the engine | Old and new give the same numbers on the same data |

Each phase ends the way every change here does: lint, typecheck, unit and integration tests, the e2e spec for the
new page, a migration applied to production with the advisors checked and its version recorded in `decisions.md`,
and the docs and `CLAUDE.md` updated. New admin pages go in `store-nav.ts` (Marketing) / `platform-nav.ts` (Website)
and in `ADMIN_PAGES`.

## Risks and how we hold them

| Risk | Why it matters | What holds it |
|---|---|---|
| Too little traffic | Most stores cannot detect a conversion lift; owners act on noise | The up-front estimate, a verdict only after the minimum, "too early" wording |
| Consent skews the sample | Consenting visitors differ | Said on the results page; later, compare to non-consenting traffic on the original |
| Variant serving costs speed | We built fast pages | The spike's criteria, run before anything else; the fallbacks are named |
| A bad variant hurts sales | Real revenue at stake | Guardrail auto-stop, preview/QA step, small traffic share option |
| Editing a running test | Invalidates results | Variants are locked once running |
| Two tests collide | Effects mix | One running test per target, database-enforced |
| Statistical misuse | False winners | One goal, fixed rule, no peeking verdicts, exploratory segments labelled |
| Legal reading changes | The consent design is wrong for a market | The check is a phase-0 gate; the cookie and the signed-in path are each one switch |

## Open questions

1. The signed-in path: consent or legitimate interest, per country (phase 0).
2. Whether the plan feature has tiers (a limit on running tests per plan) or is on/off.
3. Whether owners can export results (CSV through `toCsv()`) in version 1.
4. Whether a variant of a *translated* page tests the translation alone (variants per language) or all languages.
   Default: a test is per market, and a variant carries its own translations.
