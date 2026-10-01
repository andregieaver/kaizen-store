# A/B testing

Design for an A/B testing tool that platform admins and store owners use to find out whether a change to a page earns
its place. Status: **phases 1 and 2 built** (D148): the engine, tests of whole store pages and of a part of one (a row, column or component chosen in the builder), scheduled starts; see "What phase 1 built" and "What phase 2 built" below. Other page kinds, the AI manager and the platform's own pages are later phases. It builds on [`measurement.md`](measurement.md), whose principles
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

## What phase 1 built, and where it differs from the design

Code: `src/lib/experiments.ts` (vocabulary, cookies, start checks), `experiment-assign.ts`, `experiment-results.ts` (statistics
and the verdict sentences), `ab-routing.ts`; `src/server/experiments.ts` (serving, exposure, events), `experiment-admin.ts`
(make, start, stop, apply), `experiment-results.ts`, `experiment-jobs.ts`; `src/proxy.ts`; `src/app/api/ab/*`;
`src/components/ab/*` (the page marker and the assignment script); the admin at `/admin/{store}/experiments`
(`experiment-form.tsx`, `experiment-controls.tsx`, `experiment-results-view.tsx`); migration `ab_experiments`; tests in
`commerce.test.ts`, the `experiments*.test.ts` files, `experiments.int.test.ts` and `e2e/ab-tests.spec.ts`.

How it works, as built:

- A version is a page of the new type `variant` (no address, never listed, never in the sitemap), made as a copy of the
  page's published content and changed in the page builder. The database enforces the whole life cycle: draft, running,
  stopped, then applied or discarded; one running test per page, five per store; shares add up to one; the versions and
  what is measured are locked once it runs; a page in a running test cannot be unpublished (the editor refuses a publish
  of it too, so the results mean what was started).
- A visitor who has accepted `statistics` gets `kaizen_ab_{storeId}` (their id and a version per test, `0` meaning
  outside it) from `/api/ab/assign`, plus a marker cookie `kaizen_ab`, the only thing `src/proxy.ts` matches on, so no one
  else (and no crawler) reaches the proxy. The proxy rewrites a tested page's request to the version's route
  (`/s/{store}/{market}/{slug}/ab/{version}`, or the host-based form) and the version is drawn from the cache. A version's
  page names the original as its canonical address and is never indexed.
- The page's marker (`AbMarker`) reports the first sight of a version once per visitor and test (only with consent and a
  cookie that matches), reloads once if the browser's cached copy was the wrong version, and reports clicks on the chosen
  button. Carts and checkouts are tied to the visitor (`experiment_carts`), and an order counts when it is paid
  (`paid`, `fulfilled`, `closed`; never a copied or a host's order) and was started after the first sight and before the stop.
- Results are worked out in code on every look (no rollup table yet): the primary goal per version, a funnel (saw it, added
  to the cart, started checkout, ordered, clicked), revenue per visitor without VAT (shipping included, in the store's
  main currency at its rates, one very large order capped at the 99th percentile), a day-by-day and week-by-week view, a
  check that visitors were split as promised, and a verdict in six plain kinds. Several versions are each compared with the
  original at a stricter level. A job (`runExperimentJobs()`, in the five-minute cron) stops a test a week after its planned
  end or at 90 days, and stops one that is clearly selling less once every version has 1,000 visitors.

Where it differs from the design above:

- **Goals**: orders, revenue per visitor, adding to the cart, reaching checkout and clicks on a chosen button. Visiting a
  page and signing up are later.
- **No `finished` status and no rollup table**: a stopped test is decided (apply a version or keep the original); the
  numbers are read from the tables each time, which holds up at the traffic a store of this size sees. Add the daily
  rollup when a look takes more than a moment.
- **Signed-in customers** are not yet enrolled without the cookie (the legal reading is still open, and a signed
  assignment needs its own design); only the cookie path exists.
- **Audience**: devices and countries (a country, whatever its language or currency). New or returning visitors is in the
  engine, not in the form.
- **Gating**: a store sees the feature unless the platform adds a switch; the plan comparison has the row ("A/B tests of
  pages", in no plan yet) and nothing in code reads it, as for every other feature there (D132).
- **Not yet** (phase 1; the first two are phase 2's, below): a scheduled start, tests of parts; still not: the guardrail's email, preview links
  for owners to share, CSV export, the platform's own admin (Kaizen's pages), the AI manager's tools.
- The runtime estimate before launch is the owner's own guess of visitors and rate (the form works it out in the browser);
  Kaizen has no page-view numbers to base it on yet.

Still open from phase 0: the Vercel preview run of `scripts/ab-ttfb.mjs` and where the Node proxy runs (the residency
decision, D5), a test through a store's own host, and the legal check before a first live test.

## What phase 2 built: tests of a part, and scheduled starts

A test can be about one **row, column or component** instead of the whole page. In the page builder every part's tools have
an **A/B test this** button (a flask) on a published store page; it opens the new-test form for that part, which fixes the
page, names the part ("Heading “Welcome” in row 1") and offers, for a click goal, only the buttons inside it. Nothing in
serving, counting or results changed: a version of a part test is still a page of type `variant`, a full copy of the page.
What a part test adds is one rule and one change:

- **The version may differ in the part only.** `partChanges()` (`src/lib/experiment-parts.ts`, pure) replaces the part in the
  version with the original's and compares the whole of what is left, and the other languages' texts of every other part
  (`block.{id}.…`, `column.{id}.…`); the page's own title, address and search texts are left out, as they differ by design.
  The result (`ok`, `outside`, `missing`) is on each version (`VariantInfo.scope`), shown in the setup screen in words, and
  `startProblems()` refuses a start while a version changes more than the part ("Version B changes more than Heading …: put
  everything else back as it was, or test the whole page instead") or has lost it.
- **Applying changes the part only.** `applyPart()` puts the winner's part, with its texts in other languages, into the page *as it
  is now* (published, and the draft too where it still has the part), so anything edited elsewhere while the test ran or
  after it stopped stays. A page that has lost the part refuses, in words. Audited with the part's id.

Where it is kept: `experiments.target_part` and `target_part_kind` (both set or both null, locked once the test leaves draft),
the one-running-test-per-page rule is unchanged (a part test and a page test of the same page exclude each other). The
builder's "Testing: Version B against the original" banner (`testOfVersionPage()`) says which part may be changed and links to
the original and back to the test. Rows that are modals, and parts that hold the shop's working components, a site component
or a product component, are not offered (`testablePart()`).

**Scheduled start.** A draft that passes the start checks can be scheduled (`scheduleExperiment()`, a time between a minute and
ninety days ahead): the status `scheduled` locks it like a running test except for the time, which can move; it goes back to a draft
(`unscheduleExperiment()`) to be changed. The five-minute job (`runExperimentJobs()`) starts a due one with the same checks as a
start by hand; one that can no longer start (the page was unpublished, a version put back as the original) goes back to a draft with
the reason in `schedule_problem`, shown to the owner. While scheduled nothing is served and the pages stay free to edit.

**The estimate** of how long a test takes is on the new-test form and the setup screen (`RuntimeEstimate`), from the owner's own
guess of daily visitors and today's rate; Kaizen has no page-view numbers yet. **Preview** is the admin's preview of each version
(signed in, never counted); a shareable link that forces a version on the live site is not built.

What phase 2 did not do: the five steps as separate screens with a summary rail (the flow is two screens: the form, then the setup
page), the moderated check with two owners that phase 2's "done when" asks for, and an end-to-end test of the builder button (the
e2e suite has no signed-in owner yet; the button and the screens are covered by rendering tests, the rules by database, unit and
integration tests).

## Principles (kept from `measurement.md`)

- Randomise who is eligible, then compare everyone assigned; never compare people who used a thing with those who did
  not.
- One chosen goal per test, decided before it starts, and the decision rule is fixed in advance.
- Guardrails can stop a winner. A split that is not the split we asked for means broken data, not a result.
- Run whole weeks, at least two, and show each week apart.
- Assignment is on the server. Visitors who are not enrolled never reach any code of ours on the way to the page. The
  proxy (Next.js 16, Node runtime) is used only for enrolled visitors, and only after its region is confirmed (see below);
  `measurement.md`'s older note that middleware runs outside the EU was written for the Edge runtime.
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

### Design (after the phase 0 spike, below)

1. **First view: the original, for everyone.** The cached page is sent as today. After consent, a small script asks
   `POST /api/ab/assign`, which draws the assignment (random), sets `kaizen_ab`, and returns it. Nothing is logged yet
   and nothing changes on screen.
2. **Next views: the assigned version, from cache.** A variant of a page is a page of its own at
   `/s/{store}/{market}/{slug}/ab/{variant}` (not indexed, canonical to the original), prerendered or rendered on
   its first request and cached after that, like any store page. A **`src/proxy.ts`** with
   `matcher: [{ source: ..., has: [{ type: "cookie", key: "kaizen_ab" }] }]` runs only for requests carrying the
   cookie, looks up the running experiments for that page (a short in-memory cache of one database read), and rewrites
   to the variant's route. Visitors without the cookie, and crawlers, never reach the proxy and are served from the
   cache as today.
3. **The page says which version it is.** Every page that is the target of a running test (the original too) renders
   a small marker (`data-ab="{experiment}.{variant}"`) with a client component that compares it with the cookie.
   - Equal: it sends the **exposure** beacon (first time only; idempotent on the server).
   - Different (the visitor's browser still holds the original from before they were assigned): it reloads once
     with a hard navigation, and the exposure is counted by the page that follows.
   - So exposure is counted only for what was shown, and first views and stale views count for no arm. This is the
     same in every arm, so it leaves the comparison fair; it only makes each visitor start counting from their
     second page view.
4. **For a part**, the variant is a page copy that differs in that part only, so the plumbing is the same.
5. **Signed-in customers** are matched by a second matcher entry on the session cookie; the proxy (Node runtime)
   derives the assignment from the account, so their first view is already the assigned one.
6. **Starting and stopping a test changes a row**, then `updateTag()`s the page's tags and the proxy's cached list.
   No deploy, no routing change, no vendor API.

### What the spike found (phase 0, run on a local production build against a seeded database)

| Question | Result |
|---|---|
| Can a cookie choose a prerendered variant from the cache with no function call for others? | **Yes.** A cookie-conditioned rewrite served the variant's prerendered HTML (`x-nextjs-prerender: 1`), the original unchanged for visitors without the cookie, canonical to the original, `noindex`. A proxy with a cookie-conditioned matcher does the same and is the chosen mechanism. |
| Time to first byte (300 requests, median / 95th percentile, ms) | Original, no cookie: **4.1 to 4.8 / 7.0 to 8.8**. Variant by cookie-conditioned rewrite: 4.6 to 4.7 / 7.4 to 8.8. Variant by proxy: **5.0 to 5.6 / 8.3 to 8.7**. The proxy adds about **0.5 to 0.9 ms** for visitors with the cookie and nothing for others. |
| Does it survive client-side navigation? | **Yes.** From the front page with the cookie, a link click showed the variant, URL unchanged, no console errors or hydration warnings. |
| Is a page the browser already holds stale after assignment? | **Yes, a real hazard.** After visiting the original (no cookie), getting the cookie and clicking the link again, the browser's cache showed the *original* (about five minutes of stale time) until a reload. Hence the marker and reload guard (step 3 above). |
| Does a variant created while the site is running need a deploy? | **No.** A variant page that was not in the build was rendered on its first request (154 ms) and cached after that (4 to 11 ms). Only the *routing* would have needed a deploy with config rewrites, which the proxy avoids. |
| Does a wildcard variant in the cookie 404? | A rewrite that matches any letter sent `exp1.a` to a variant route that does not exist (404). The proxy names the exact experiment and treats `a` (the control) and unknown experiments as no rewrite. |
| Alternative: dynamic hole (the varied part in a `<Suspense>` that reads the cookie) | Same speed (TTFB 4.2 to 4.4 ms), but the original paints first and is replaced 170 to 200 ms later on a fast connection: **a visible flicker.** Rejected for tests the visitor can see above the fold. Usable as a last-resort fallback for parts below the fold. |
| Does the build slow down? | **Not established.** The build with a variant route and one prerendered variant took 5 min 32 s; there is no build without the spike to compare it with. A variant is an ordinary route (one prerender per market), and variants made while the site runs are not built at all, so the effect is expected to be small. Open until measured against a clean build. |

Measurements are from `scripts/ab-ttfb.mjs` (sequential requests over one connection, 20 warm-up requests).

### What the spike could not answer, and what to do about it

- **Vercel's own network.** Local numbers show the cost of our code, not of a function call in front of the CDN. The
  Vercel account connected to this session holds a different project (`kia-configurator`), not Kaizen's, so the
  proxy could not be tried against the real deployment from here. **Action for the owner:** deploy the spike branch
  to a Vercel preview of Kaizen's project (the spike code is in `docs/ab-testing-spike/`) and run
  `node scripts/ab-ttfb.mjs <preview-url> /s/demo/no/om-oss "kaizen_ab=exp1.b"` against the original, with and
  without the cookie. Pass: median within 20 ms of the original, 95th percentile within 50 ms, and the
  cookie-less response identical.
- **Where the proxy runs.** Next.js 16's proxy runs on the Node.js runtime; whether Vercel runs it in the function
  region (Dublin, `vercel.json`) or elsewhere decides whether this fits the data-residency rule (D5). What it sees is a
  random id and a path, but it still has to be confirmed in the Vercel docs for our plan, and on the preview (the
  `x-vercel-id` header names the regions a request touched).
- **Stores on their own hosts** (P7/P8). The proxy runs before the host rewrites, so on `{store}.{domain}` it sees
  `/om-oss`, not `/s/{store}/{market}/om-oss`. It must resolve the store from the host with the same logic as
  `src/lib/store-hosts.ts`. Not tried; a phase 1 task with its own test.
- **Signed-in customers' session cookie** and the second matcher entry: designed, not tried.

### Alternatives, in the order we would fall back to them

1. Config rewrites with a cookie condition (no proxy, no function call at all). Rejected as the main design: they are
   fixed at build time, so every test start or stop would need a deploy (5 to 6 minutes here).
2. Vercel's project-level routing rules, changed through its API without a deploy. Possible, but adds a platform
   credential and a vendor API to every test start, with unknown limits for many stores; not tried.
3. The dynamic hole, for parts below the fold only.

Rejected: client-side swapping of hidden copies (layout shift, doubled HTML, crawlers see both).

**Pass criteria for the spike** (from the first version of this file) and the result: time to first byte of an enrolled
view within 20 ms of an unenrolled one (**met locally, 0.5 to 0.9 ms; to be confirmed on Vercel**); no layout shift from
the swap (**met**: no swap happens); Lighthouse unchanged (not run; nothing is added to the page but a marker);
crawlers and no-cookie requests byte-identical to today (**met**: they never reach the proxy); build time unchanged
(**open**, see above).

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
| **0** | Spike (done locally, see above; **Vercel preview run and region check pending**), legal check, `plan_features` row, final stats choice | The preview numbers meet the criteria; the legal note is written; this file is updated |
| **1** (built) | Engine and **page** tests for store pages: tables and rules, assignment, `/api/ab/assign`, exposure beacon, order attribution, daily rollup job, split check, results page (verdict sentence, charts), start/stop/apply, audit, tests incl. an end-to-end test with two variants | A test runs on the demo store from creation to applied, in the browser, with consented and unconsented visitors |
| **2** (built, minus the moderated check) | **Part** tests in the builder (click a part, "Test this"), the five-step flow, estimates, preview links, scheduled start | A person who has never seen it creates a test in a few minutes (a moderated check with two owners) |
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
| Variant serving costs speed | We built fast pages | Only enrolled visitors pass the proxy; spike numbers (local) and the Vercel preview check; the fallbacks are named |
| A bad variant hurts sales | Real revenue at stake | Guardrail auto-stop, preview/QA step, small traffic share option |
| Editing a running test | Invalidates results | Variants are locked once running |
| Two tests collide | Effects mix | One running test per target, database-enforced |
| Statistical misuse | False winners | One goal, fixed rule, no peeking verdicts, exploratory segments labelled |
| Legal reading changes | The consent design is wrong for a market | The check is a phase-0 gate; the cookie and the signed-in path are each one switch |

## Open questions

1. The signed-in path: consent or legitimate interest, per country (phase 0).
   (Technical side: the session-cookie matcher, see the spike.)
2. Whether the plan feature has tiers (a limit on running tests per plan) or is on/off.
3. Whether owners can export results (CSV through `toCsv()`) in version 1.
4. Whether a variant of a *translated* page tests the translation alone (variants per language) or all languages.
   Default: a test is per market, and a variant carries its own translations.
