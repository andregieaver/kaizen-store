# Dream Factory: from one prompt to a live store

Status: **built** (D409, 30 October 2026); changing a store that exists, D527, 9 November 2026. An owner starts it by ticking *Build my store with AI* under "What will you sell?" at self-serve
sign-up (on since 30 October 2026); an owner of a store, or a platform admin, builds as many more as their plan allows from *Build a store
with AI* on Your stores (`/admin/stores`, linked from Platform → Stores and Platform → AI); or on the store's own Dream Factory page (`/admin/{store}/dream-factory`, where an owner of a store not
yet open lands from Home while a run is going; the setup wizard offers it). The AI follows the steps below, the owner watches them on that
page and developers score every run on Platform → AI. Every step ends on a check made by **code against the store's data**, never on the
model's word, so a run can be scored the same way every time.

## How it is built

- **The run:** `commerce.dream_runs`, one in progress a store, written only by `src/server/dream-factory.ts`; the steps, their needs, the
  brief, the AI steps' words and tools and the scorecard are pure in `src/lib/dream-factory.ts`.
- **The conductor:** `/api/cron/dream-factory` every minute claims the runs due one at a time and moves each on: the steps waiting on
  background work or the owner are looked at again, then the ones whose needs have passed are started, at most one AI turn a run a minute.
- **The AI's steps** (research, setup, brand and look, products, first goals) are turns of the AI manager in the owner's name, limited to the
  step's own tools (`STEP_TOOLS`), at *Just do it* for catalogue, website, design and setup (nothing reaches the public before the store
  opens; money and messages still ask). So a run starts only on a store not yet open, and a run whose store is opened by hand before its
  last step stops, the store's own levels taking over (PSI re-score of 31 October). Products are made one a turn, each with a picture the store's picture model makes (`create_product`'s
  picture `make`), until the brief's number are on sale.
- **Code's steps:** the brief (one answer of the model, its business details kept only where the owner wrote them, `ownBusiness()`), the
  website (D351's draft from the brief, built in the background, then published), the legal pages (D311's writer turned on and awaited;
  skipped where the business is outside Norway, Sweden and Denmark) and the rehearsal (the store's checkup with nothing blocking, every
  product still on sale everywhere).
- **The owner's steps:** the business details the description did not hold, the yes to the brief, payments (Stripe's identity check), a plan
  (the trial counts) and opening. A step that fails its check three times becomes a question with *Try again*.
- **A test run** is one whose owner is at the drills' test address (`@resend.dev`): its yes is pressed by the drill and counted, it pays in
  test mode, needs no plan, stays private and ends ready to open. The live drill `dream_factory` signs up through the real self-serve path
  with the fixed prompt (`DRILL_PROMPT`) and its run is scored on Platform → AI. The drill counts as passed only once the run is ready:
  its result stays `waiting` until then, and failed when the run failed or was stopped (`settleDreamDrills()`, `dreamDrillOutcome()`).

**The trial and who can look (D420):** every run gives its store the 14-day free trial (once a store), and the plan step counts it, so
an owner looks at the store, changes it and may open it before choosing a plan; when the trial ends with no plan an open store becomes
private again until a plan starts. The platform admin who asks for the drill becomes an owner of the drill's store for 14 days, so it is on
their Your stores, its admin opens and the watch page on Platform → AI offers *See the store* and *Open the store's admin*. *See your store*
on a finished run goes through the members' preview, since a store not yet open is private.

**Start over and discard (D421):** before the store opens, the run's page has *Not what you hoped for?* one step away. *Start over* takes an
edited description, clears what the run made (its pages and the redirects their deletion left, its products archived, its goals dropped,
the front page unset, an open draft discarded) and starts a new run in the same store; the brand, the pictures, the research notes and the
business details stay. *Discard this store* closes it, the address typed to confirm, and it moves to Closed stores.

**Changing a store that exists (D527):** a second kind of run, a *rework*, changes a store that is already there, open or not; see
*Changing a store that exists* below. A store that is open is never built again: its Dream Factory page asks what to change.

**Not yet:** the rehearsal does not place and pay a test order (paying needs Stripe's own checkout page in a browser); a domain is the
owner's on Domains, outside the run; `/dream-factory` on Kaizena Flow's own site still says "Coming soon" (its text is the owner's page).

## Watching it build (D419)

The owner's page is made to be watched, not only waited on. While a run goes it reads itself again every six seconds and shows:

- **The progress:** "Building {store}", a bar of the steps passed of all thirteen, how long ago it started, and a line for each step working
  now in plain words ("Making the products, each with a picture, words and a price"), or the next step when nothing works.
- **The timeline:** every step in order, ticked with its minutes once passed, turning while it works, its check's finding beneath it, *Try
  again* where a step became a question.
- **A sketch of the front page** in a browser frame with the store's address: the store's name or logo in the look's heading font, the pages
  as its menu, the brand's tagline, a *Shop now* button in the look's colours and the first four products with their pictures and prices.
  What is not made yet shimmers in grey, so the owner sees the store take shape as the brand, the logo, the pages and the products land.
- **Just made:** the newest eight things made, with how long ago ("Made the product Morning mug, 2 min ago").
- **Made so far:** the brand (voice, values, colours, fonts), the research notes with the sites they rest on, the products (each linked to its
  editor), the pages with their state (building, built, live) and a link to each, the legal pages and the first goals.
- **When ready:** *Your store is ready*, with *See your store*, *Edit the front page* and *See the products*.

Once the website is published the sketch gives way to the real front page, drawn in the store's live theme as the site draws it (D422), which is what the owner looks at and changes at the end of stage 1. On a phone it comes first, then the timeline. A test run (a drill's, whose store belongs to the test address) is watched the same way from Platform → AI: its line in the scorecard opens `/admin/platform/ai/dream/{run}`, read only, with no links into the store's admin and none of the owner's buttons; a real owner's run is not shown there (`testDreamRun()`). Everything shown is read from the store's own rows made since the run began
(`src/server/dream-showcase.ts`); every sentence is the code's own words, so nothing on the page is a model's account of what it did.

## The workflow

Two stages (D422). **Stage 1, the look:** the brief, the owner's yes, research, setup and the brand, then the first three products and
the website, so the owner sees the real front page in the store's own look and changes it with the AI until it is right. **Stage 2,
finish:** once the owner says *This is it*, the business details, the rest of the products, the legal pages, payments, a plan, the
rehearsal, opening and the first goals. Steps in the same lane run side by side; a lane starts when the steps it needs have passed.
**Owner** marks the presses only a person may make.

| # | Step | Stage | Needs | Who | Done when (checked by code) |
|---|---|---|---|---|---|
| 0 | **Prompt** | 1 | — | Owner | A description of 20 to 2,000 characters |
| 1 | **Brief** | 1 | 0 | AI | What is sold, to whom, countries, languages, currency, price range, name, tone, products (3 to 12, default 6) and up to 3 pages; asks only for what stage 1 needs (the name, what is sold, the countries, `briefQuestions()`). The business's details are kept only where the owner wrote them |
| 1b | **Confirm the brief** | 1 | 1 | Owner | One press on the brief as shown; it also agrees to the demo store's products being replaced and the legal pages being written |
| 2 | **Research** | 1 | 1b | AI | At least 3 research notes made in the step, each with a source |
| 3 | **Setup** | 1 | 1b | AI | Countries exactly the brief's and a shipping price for every country; business details set only where the description gave them |
| 4 | **Brand and look** | 1 | 1b | AI | A brand profile with a tagline or voice, and a theme in the library |
| 5 | **First products** | 1 | 2, 3, 4 | AI | Three of the store's own products (fewer when the brief asks for fewer) active with a picture and a price everywhere, in the brand's style; the demo store's products archived first, so the front page shows only the store's own |
| 6 | **Website** | 1 | 4 | Code | The draft's pages built and published (D351), then the brand's own look made live, so the pages wear it |
| 7 | **Your look** | 1 | 5, 6 | Owner | The owner says *This is it*. Before that they see the real front page in the live look and ask for changes: *Other colours*, *Other fonts*, *Another layout*, or their own words; each request is one turn of the AI with the design and page tools only (`LOOK_TOOLS`), at most `LOOK_ROUNDS` (10) rounds, then *This is it* or *Start over*. A test run's yes is pressed by the drill |
| 8 | **Business details** | 2 | 7 | Owner | The store's business details complete (`getSetupProgress().details`): what the description gave is set by code, the rest asked (`detailsQuestions()`) |
| 9 | **Products** | 2 | 7 | AI | The brief's number of products, as step 5 counts them; no demo product on sale. Prices in the home country only; other countries' worked out by code (D335's rules) |
| 10 | **Legal pages** | 2 | 3, 8 | Code | As before (D311's writer; starters for a person when the writer's check fails) |
| 11 | **Payments** | 2 | 7 | Owner | Live card payments active; a test run skips it |
| 12 | **Plan** | 2 | 7 | Owner | A plan, or the free trial running (D420); a test run skips it |
| 13 | **Rehearsal** | 2 | 9, 10 | Code | The store's checkup without a blocking finding and every product still on sale everywhere |
| 14 | **Open** | 2 | 13, 11, 12 | Owner | The store open; a test run stays private and skips it |
| 15 | **First goals** | 2 | 14 | AI | Two active goals |

**Owner presses in a full run:** the prompt, the brief, *This is it* (plus any look requests), payments identity, the business details
when the description did not give them, and opening. A plan is chosen within the trial.

## Changing a store that exists (D527)

A run is one of two kinds (`dream_runs.kind`). A **build** is everything above. A **rework** takes the owner's words for what to change
in a store that exists (*a warmer look, a front page that leads with the bestsellers, an FAQ page, livelier product descriptions*) and
works under one rule: **nothing a visitor sees changes before the owner presses *Make it live***. So it may run on an open store, where a
build may not.

**Where it starts:** `/admin/{store}/dream-factory`. On an open store the page's one form asks *What would you like to change?* (Home
links there); on a store not yet open the form that builds is first and *Change it as it is instead* is one step away; under a run that
has ended (a build or a rework) the same form starts the next. One run a store at a time, of either kind.

| # | Step | Who | Done when (checked by code) |
|---|---|---|---|
| 1 | **Plan** (`outline`) | AI | One answer of the model, from the owner's words and the store's facts read by code (`reworkFacts()`: its pages by id, its own products by handle, the live look), held to those facts by `readReworkPlan()`: a page or product the store does not have is dropped, never guessed at. The plan names a change to the look, up to 6 pages (changed or new), up to 6 new products, up to 8 changes to products, and what was asked for that a rework does not do (`outside`). An empty plan asks at once |
| 2 | **Your yes to the plan** (`agree`) | Owner | One press on the plan as shown |
| 3 | **New look** (`relook`) | AI | A look of the store's own added to the theme library since the run began, not live (`design_look`); skipped when none was asked for |
| 4 | **Pages** (`pages`) | AI and code | Each of the store's pages in the plan changed in its **draft**, one a turn (`get_page`, `edit_page`); each new page queued once with the page studio as a draft (`buildPageTool()`) and its build settled |
| 5 | **Products** (`products`) | AI | Each new product a **draft** with a picture and a price in every country, one a turn; each change to a product the store has prepared, one a turn: a product on the site is changed only through `update_product`, which the gate keeps for a yes |
| 6 | **Your review** (`review`) | Owner | The page lists what is prepared, in the code's words from the store's rows (`reworkPrepared()`): the look with *See your store in it* (the theme's preview), each page with what its draft changes (`compareVersions()`), the new products, and each kept change in the words it was kept with. *Make it live*; or one more change in the owner's words (one turn, at most `REVIEW_ROUNDS`); or *Discard these changes* |
| 7 | **Make it live** (`apply`) | Code | After the owner's press: the look through `switchToInstall()`, each prepared page through the builder's own Publish (`savePage()`), each new product through the editor's check (`setProductStatusTool()`), each kept change through `decideApproval()`. A part refused does not stop the others; the step says what went live and what was held back, and why |

**How it stays out of sight:** a rework's turns are AI manager turns limited to `REWORK_TOOLS`, none of which publishes, opens, sends or
costs, and at *Ask me first* in every area (a build's turns act without asking; a rework's never do), so a call the gate guards is kept
for the owner's yes and found again by the turn's conversation (`StepState.conversations`). The run ends `applied`. Setting it aside
(`stopDreamRun()`) leaves what was prepared as drafts in Pages, Products and the theme library, and declines the changes it kept, so no
later press makes them.

**What a rework does not change:** prices and stock of products on sale, shipping, payments, countries, discounts, emails, orders, the
business's details and menus. The plan names what was asked for of these under *Not changed here*; they are the AI manager's, with its own
approvals, or the owner's. A new page is published but not put in a menu.

**The platform:** the Dream Factory is store-only (`docs/platform-parity.md`: Kaizena Flow's own site is not built or changed by it), so
this is too; a platform admin reworks any store they own, and Platform → AI's scorecard lists a rework's run with its kind.

**Not yet:** the plan's prompt has no version in the agents' eval (`promptVersions()`), which needs a run recorded on Platform → AI with
the new prompt; the admin map's line for the page still describes a build only, as its words are part of the AI manager's versioned prompt.

## What a run is measured on

Kept per run, so runs can be compared across prompt versions and models:

| Measure | How | First target |
|---|---|---|
| Prompt to ready-to-open | Time from step 0 to step 11 passing, excluding time waiting on the owner | under 30 minutes |
| Owner presses | Count of owner steps and answered questions | 5, questions at most 3 |
| First-try passes | Steps whose check passed on the first try | 80 % |
| AI cost | Sum of the run's `ai_usage` | under the plan's monthly AI budget share agreed |
| Quality | Look score per page, accessibility findings, legal checker result | look ≥ bar, 0 serious, all quotes match |
| Rehearsal | The test order's four checks | 4 of 4 |
