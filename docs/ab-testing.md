# A/B testing

Design for an A/B testing tool that platform admins and store owners use to find out whether a change to a page earns
its place. Status: **phases 1 to 9 built** (9: modals and working pages) (4: the AI manager's tools; 5: the platform's view; 6: the guardrail email; 7: search and recommendations on the engine; 8: the platform assistant's tools) (D148): the engine, tests of whole store pages and of a part of one (a row, column or component chosen in the builder), scheduled starts, and tests of a store's header, footer and product layouts; see "What phase 1 built", "What phase 2 built" and "What phase 3 built" below. The AI manager's tools are phase 4 ("What phase 4 built"). Modals and working pages are phase 9; the platform's own pages are later. It builds on [`measurement.md`](measurement.md), whose principles
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

## What phase 3 built: the header, the footer and the product layouts

A store can test **its header, its footer, or one of its product layouts** (and a row, column or component of them: the builder's
"A/B test this" is in those editors too). These are not pages with an address a request can be rewritten to, and the header is on every
page, so the serving is different from a page test's:

- **The visitor's versions travel in the market part of the address the proxy rewrites to.** A visitor in another version of a test of
  the header or footer is served every page of the store (the front page, product pages, the cart, the checkout, the account) under
  `/s/{store}/no~3fa9c1d2b/…`, one token per site-wide test (the test's first eight characters and the version's letter, `src/lib/ab-site.ts`);
  a test of a product layout does the same for product pages (`p/{handle}`) only. The route is the same route: `resolveShop()` takes the
  tokens off and returns them as `ab`, so the market is the real one, every link made from it is the real address, the visitor's browser
  never sees the rewritten one, and the page and its caches are one more prerender of the same page. A visitor in the original gets no suffix,
  so they, and everyone else, are served from the pages as they were. The proxy rewrites every method (a server action is a POST to the
  address the visitor is on), so a cart action keeps the visitor's header. A rewritten page says `noindex` and names the real address as its
  canonical one. A page test and a site test on the same request compose (`/s/{store}/no~…/{slug}/ab/b`).
- **Rendering.** The market layout draws the header and footer through `siteLayoutForVisitor()`, which returns the chosen one, or, while a
  test of it runs and the address carries the visitor's other version, that version's page (`siteVersionContent()`, cached with the tests
  and the pages, carrying the original's header overlay so a page lies under it as it did). The product page does the same with
  `productLayoutForVisitor()`. Both return the running test and the version drawn, for the marker (`AbMarker`, as a page test's): the
  header and footer's marker is in the market layout (the first page a visitor sees counts), the layout's on the product page, and only
  on a product that uses the layout.
- **Targets and rules.** A test's target is now a page, a product layout, a header or a footer (`targetKindOf()`); the database lets a
  header or footer be tested only while it is the one the store uses, a layout only while the store, a category, a tag or a product uses
  it, and keeps the store from choosing another header or footer while a test of it runs (`stores.experiment`). A version is still a page
  of type `variant`, a copy; what it may hold is what its target may hold (`savePage(…, { variantOf })`, so a header version can hold site
  components and a layout version product components, and the builder offers them: `PageOwnerContext.variantOf`). Publishing a change
  to the header, footer or layout in a running test is refused like a page's, and so is unpublishing or deleting it. Applying a winner
  replaces the target's content (the part's, for a part test) and keeps its place.
- **What is counted** is the same: exposure at the first page view in the version (any page for a header or footer), carts, checkouts and
  paid orders from then on, a click on a chosen button inside the header, footer or layout.

Tested end to end in a browser (`e2e/ab-site-tests.spec.ts`): a header version on a full load, after a click on a footer link and after adding to
the cart; the original and the unenrolled; accepting statistics; a product layout's version on product pages only.

Not done in phase 3 (modals and working pages came in phase 9): Kaizen's own pages (the platform's header, footer and
plans page), a store on its own host (the proxy knows the address form, and the host rewrite in `next.config.ts` has not been checked
with the market suffix), and the Vercel check of the caching of rewritten pages, which phase 0 left open and which now matters more:
every page of an enrolled visitor in another version of a header test is a rewrite.

## What phase 4 built: the AI manager's tools

Seven tools in the AI manager's catalogue (`OWNER_TOOLS`, so Kaizen Life's assistant has them through the store's MCP server too), in
`src/lib/owner-tools.ts` (definitions, approval summaries), `src/lib/experiment-tools.ts` (the pure part) and `src/server/experiment-tools.ts`
(the handlers). The model suggests, words and drafts; the store counts, checks and decides what is true.

| Tool | What it does | Gate |
|---|---|---|
| `list_experiments` | The store's tests with status, what is tested, visitors counted and, for a running or just stopped test, the verdict's headline | none |
| `explain_results` | One test's results from `experimentResults()`: the verdict (kind, headline, detail), each version's visitors and rate or revenue per visitor against the original with the chance it is better, the steps visitors took, revenue without VAT, the split check, the guardrail, what can be done next. For a draft: what is left before it can start | none |
| `suggest_experiments` | Facts for choosing: what can be tested (pages, header, footer, product layouts) with each block's id and words, earlier tests on it, the share of cookie choices that accepted statistics, paid orders and the cart-to-order figures over 30 days, room for more tests; with `visitors_per_day` and `current_rate_percent` how long a test takes, from `estimateRuntime()` | none |
| `draft_experiment` | A draft test: a copy as version B with the model's words put into named headings, buttons or texts. One changed block makes a part test of it, several a test of the page; no change an unchanged copy to edit in the builder | none: nothing is live |
| `start_experiment` | Starts a draft, now | `public` |
| `stop_experiment` | Stops a running test | `public` |
| `apply_winner` | A version (or `original`) ends the test; a running test is stopped first, in the same yes | `public` |

How it holds the line the design set:

- **The model never states a number or a verdict.** `explain_results` returns the verdict the code reached and tells the model not to
  call a winner it does not; `suggest_experiments` returns counts and, for how long, only what `estimateRuntime()` works out from
  numbers the owner gave, and says so when they have not.
- **Every word it writes is checked** before anything is made: the claims filter (`findClaims()`: generic green claims, urgency, best
  price, money, stock), the lengths, and that the block is a heading, button or text on the page (`applyChanges()`); text goes in as plain
  text nodes, never markup.
- **Deciding is kept for a yes, and checked first.** `preflightExperimentTool()` refuses a start that could not start (a version still
  the original, an unpublished page, the limit), a stop of what is not running and a choice of a version that is not there, so no one is
  asked to approve it. The approval's text is written from the test itself (`experimentApprovalSummary()`: its name, what it tests, the
  goal, the versions, the share), not from the model's arguments.
- A draft is not gated, unlike the design's `draft_variant`: it makes a version page and a draft test, never anything visitors see; it is
  audited (`experiment.drafted_by_assistant`) and the owner still has to look at it and say yes to start it. No model call is made by
  the tools themselves, so nothing is metered under a feature of its own (`AI_FEATURES` unchanged): the manager's turns are `ai_manager`.
- A playbook (`ab-test` in `ASSISTANT_SKILLS`) walks it through suggest, draft, the owner's look and yes, the 14-day wait and the verdict.

A fix on the way: the admin functions called `updateTag`, which only a server action may; the five-minute job and the assistant's route
are not one, so a stop, a scheduled start or a choice made there changed the database and then threw before refreshing the caches.
They now refresh through `refreshTag()` (`updateTag`, else `revalidateTag`).

Not done in phase 4: tools for the platform's assistant (a platform admin cannot edit a store's test). The guardrail emails came in phase 6.

## What phase 5 built: the platform's view of every store's tests

`/admin/platform/experiments` (Settings → A/B tests, `ADMIN_PAGES` id `experiments`) is read-only: a platform admin sees every store's
tests and tells the owner; nothing here starts, stops or changes one.

- **The read** (`src/server/platform-experiments.ts`, `platformExperiments()`): by default the tests that are running, scheduled or
  stopped and waiting for a decision, and drafts a scheduled start sent back; "Everything" adds the other drafts and the applied and
  discarded ones. At most the newest 300. For each running test it reads the results the store's owner sees (`experimentResults()`,
  four tests at a time), so the verdict sentence, the visitors per version and the guardrail's figure are the same numbers, never
  a second calculation.
- **What needs a look** (`src/lib/platform-experiments.ts`, `flagsOf()`, pure and tested): a version that clearly lowers orders (the
  hourly check stops it), visitors divided unevenly (a broken split), a running test nobody has seen in three days (the page, the consent
  banner or the proxy is not doing its part), a test past its planned end (and when it stops counting), a scheduled start that went back
  to a draft, a test the guardrail stopped, and one stopped for fourteen days without a decision. Those come first, then running,
  scheduled, stopped and the rest, newest first.
- Totals at the top: running (and in how many stores), scheduled, stopped, and how many need a look.

## What phase 6 built: the guardrail's email

When the hourly check stops a test because a version clearly lowers orders, Kaizen emails the store's owners and whoever made the test
(`src/server/experiment-emails.ts`, `notifyGuardrailStop()`; the words in `src/lib/experiment-emails.ts`, `guardrailEmail()`, pure).

- **When:** only for the guardrail's stop, after the stop has happened (`runExperimentJobs()`); a stop by a person or at the planned end sends nothing,
  as the person knows. A failure to send never undoes the stop and never throws: the test's page and the platform's view show a guardrail stop anyway.
- **To whom:** each active owner of the store and the person who made the test if they are still a member; never a disabled member, other staff
  or the platform. Once each: the key is `experiment.guardrail:{test}:{account}`, so a second run of the check, or a retry, sends nothing more.
  The email is kept in `email_messages` like every email (kind `experiment.guardrail`), and goes out when email is set up.
- **What it says:** the test, what it tested, the days it ran, the version's and the original's orders per visitor with the counts, that nobody new is
  given a version and that everyone sees the page as before, and that the owner can read the results, discard or apply another version. It does not say
  why the version did worse, promises nothing and applies nothing. The figures are `experimentResults()`'s, the same as the results page.

## What phase 7 built: the search and recommendations tests on the engine's arithmetic

The search test (D77) and the recommendations held-out ranking (D140) now count with the engine's own code, and are read beside page tests
in the platform's view. What "onto the engine" means here, and what it does not:

- **Shared:** the comparison of two rates and its 95 % interval (`compareToOriginal()`), the split check (`splitCheckP()`), the normal curve
  and the rule for calling a difference, in `src/lib/experiment-units.ts` (`callRates()`, `splitP()`, `sayCall()`). There are two rules, each
  fixed before any result was in and unchanged: the engine's interval (the search test) and the two-proportion test with p under 0.05 (the
  recommendations test). `experiment-stats.ts` keeps only the primitives (`erfc`, `rate`, the floor) and `recommend-eval.ts` no longer has a
  normal curve of its own; `compareShares()` and the search results call `callRates()`.
- **Kept, on purpose:** the units (a search, a tab) and their logs (`search_queries`, `search_clicks`, `recommendation_events`,
  `recommendation_adds`); no experiment row, no cookie, no new storage, no migration. A page test counts visitors who accepted statistics;
  these two count units nobody is ever identified by, so putting them in the visitor tables would have made them store what they were built
  not to. Their life cycles stay what they were: the search test is started and stopped on its page, the held-out share is a setting.
- **Same numbers on the same data:** `experiment-parity.test.ts` runs the old formulas, kept word for word in `experiment-legacy.ts`
  (tests only), and the engine's on a grid of counts and four thousand seeded random ones, and they agree on every call, interval, share and
  split verdict (p-values to the third decimal, as shown). Two normal-curve approximations differ by under 1e-6, which could move a rounded p-value
  by 0.001 at a boundary and nothing else.
- **In the platform's view** (`/admin/platform/experiments`, "Tests that run on their own"; `src/lib/platform-unit-tests.ts`,
  `src/server/platform-unit-tests.ts`): the running search test (or the one that ended within 30 days) and every store with recommendations
  on, a held-out share and tabs in the last 30 days, each as a sentence in the engine's words ("Hybrid search is better than Keyword search",
  "Too early to say") with its counts, and flagged when the split is uneven or nobody is counted. The recommendations rows also get the
  engine's split check against the store's held-out share, a new reading shown only here: the stores' own report is unchanged.

Not done: a guardrail for the search or recommendations tests (they do not stop themselves).

## What phase 8 built: the platform assistant's A/B tools

The platform's AI manager (D103) reads every store's tests, with two tools in `PLATFORM_TOOLS` (`src/lib/manager-tools.ts`; handlers in
`src/server/platform-experiment-tools.ts`). Both are read-only and ungated, and there is no tool to start, stop, apply or draft: a platform
admin cannot edit a store's test (the design's rule), so the assistant says what to tell the owner and never offers a button it does not have.

- **`list_ab_tests`** (`store`, `status` active or all, `needs_attention`, `limit`): the platform's view in words (`platformExperiments()`,
  `platformUnitTests()`): totals, then each test with its store, what it tests, its age, visitors per version, the verdict sentence and what
  needs a look (`flagsOf()`), what stopped it and the winner of a decided one; plus the search test and each store's held-out recommendations.
  A store's list includes the search test, which runs in every store.
- **`explain_ab_test`** (`test`: an id from the list): a page test is the owner's own account (`explainResultsTool()`: the same figures, split
  check and verdict), with `what_next` replaced by `adviceFor()`'s sentences for the platform (nothing to do yet; tell the owner the split is
  broken; a version is clearly better; the guardrail stopped it and the owners were emailed) and the links into the store's own admin left out;
  a test not yet started says so; the search test and `recommendations:{store}` are read as the platform view reads them, with a second
  measure beside the first (searches finding nothing; tabs putting a recommended product in the cart).
- **The playbook** `ab-tests-platform` (platform area): what needs a look first, the verdict repeated and never made, what the platform
  cannot do, and what the hourly check already does.
- The reads are not owner tools, so the store's MCP server (Kaizen Life) and a store's assistant do not have them: they show every store's tests.

Not done: nothing is planned for the A/B tools; the open items are the ones listed before (modals and working pages, Kaizen's own pages, the
moderated usability check, signed-in customers, the shareable preview link and the three pre-launch checks).


## What phase 9 built: modals and working pages

**A modal (D121) can be tested.** A modal is a row with a `modal` setting, so it is a part like any other (the builder offers "A/B test
this" on it): a version may change what it says, how it looks and when it opens. Two rules in `partChanges()` keep the test about the
popup (`src/lib/experiment-parts.ts`):

- **It keeps its address name and stays a modal** (scope `modal`): a link to `#modal-newsletter` elsewhere on the site, or a class that
  opens it, must still work in every version, so a version that renames it, or turns it into an ordinary row (or an ordinary row into
  a modal), is refused in words at the start.
- **A popup that opens by itself may be left out of a version altogether.** That is the test of whether it helps at all: the version is the page
  without it. Only a modal that opens by a timer or on exit intent (`opensByItself()`) can be left out; one that a link or a class opens stays
  in every version, because those links would be dead. A winner that leaves it out takes the row, with its texts in other languages, out of
  the page as it is then (`applyPart()`).

What is counted is the page test's: exposure at the first page view in the version, whether or not the popup opened (an intention-to-treat
count, so a popup that is never seen is not a better popup), carts, checkouts, orders, and clicks on a button inside the popup (its buttons are
offered like any part's). A modal in a header or a footer is a part of that test. There is no goal for sending a form yet.

**A working page can be tested by a part of it.** The page a store chose for the cart, the checkout, the order confirmation, My account,
sign-in, wishlists, a subscription or weekly deliveries (`WORKING_ROLES`, `src/lib/ab-site.ts`) is a target of kind `role`, by a part of it
only: a row, a column or a component around the shop's own component, never the component itself (`testablePart()` already refuses a part that
holds a `storePart`) and never the page as a whole, since the whole holds the cart or the payment form. The cookies page is a legal page, and
the front page, the All products page, the blog, search, 404 and the category and tag pages cannot be tested yet.

- **The database** (`ab_working_pages`): at the start a page chosen for a working place needs a `target_part`, one chosen for any other place
  (or the front page, the All products page) is refused as before; and a page in a running test cannot change the place it is chosen for or be
  chosen for one (`page_roles_experiment_guard`), as the header and footer cannot (`stores_experiment_guard`).
- **Serving.** These pages are drawn by their own routes (`/cart`, `/checkout`, `/order/{id}`, `/account`, `/wishlist`, `/subscription/{token}`,
  `/deliveries`), so a version travels in the market part of the address like a header's, only on requests to that route (`ROLE_SEGMENT`; the
  proxy's `variantPath()` adds the test's token for a request whose first segment is the route's). `RolePage` draws the visitor's version through
  `rolePageForVisitor()` (`src/server/role-pages.ts`: the page, or the version's content from `siteVersionContent()`, with the running test and the
  version for the marker) and renders the page marker; the routes pass `resolveShop()`'s `ab`. The page's own address is not where it is served:
  `experimentOfPage()` leaves a working page out, so the address of the page itself draws no marker.
- **The shop's logic is not tested.** Cart totals, shipping, discounts and payment are drawn by the same component in every version and read the
  same data; a test changes the rows around them. Nothing about prices, shipping or discounts may be varied between versions, and a version's
  words, like any page's, are the owner's to stand behind.
- **Admin.** The new-test form offers a working page only from the builder's "A/B test this" on a part of it (the whole-page list leaves it out),
  names it by its place (`ROLE_NAMES`: "Cart page: …"), and the checks say what is wrong in words. The platform's view and the assistants' tools
  name it the same way (`targetLabel(kind, slug, title, role)`), and `suggest_experiments` lists it as a working page to test one block of.

Tested: unit tests of the modal rules and the routing, database tests of the rules, an integration test of a popup left out and applied and of a
cart test served and applied, and a browser test (`e2e/ab-working-pages.spec.ts`) of the cart at its own address and of a popup left out.

Not done: the front page, the All products page, the cookies page and the content pages (blog, search, 404, categories, tags) as targets; a goal
for sending a form (the popup's usual aim); Kaizen's own pages (the platform's header, footer and plans page); and the checks that were open
before (the Vercel run of the caching of rewritten pages, a store on its own host, the legal check, the moderated usability check).

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
- **Existing tests** (search D77, recommendations D140) keep working. In phase 7 they moved onto the engine's statistics and
  words, with their per-search and per-tab units and their own logs kept (a unit other than the visitor, for tests that need
  no storage about anyone); see "What phase 7 built".

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
| **3** (header, footer and product layouts built) | Product layouts, headers and footers, modals; surrounding rows on working pages; Kaizen's own pages (platform) | Platform runs the plans-page test |
| **4** (the AI manager's tools built) | AI manager tools and drafts, the platform's cross-store view, guardrail auto-stop emails | Gated tools tested like other gated tools |
| **5** (the platform's view built) | The platform's cross-store view of tests | Flags tested on every kind of trouble |
| **6** (the guardrail's email built) | Guardrail emails to owners | Sent once to the right people, never on a person's stop |
| **7** (built) | Move search and recommendations tests onto the engine's arithmetic, and into the platform's view | Old and new give the same numbers on the same data |
| **8** (built) | The platform assistant's tools: read every store's tests, say what needs a look | Read-only, no tool that changes a store's test |
| **9** (built) | Modals; the surrounding rows of working pages | A popup and the cart's trust row tested, served and applied; the shop's own component never |

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
