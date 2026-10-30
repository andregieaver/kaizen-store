# Dream Factory: from one prompt to a live store

Status: **built** (D409, 30 October 2026). An owner starts it by ticking *Build my store with AI* under "What will you sell?" at self-serve
sign-up (on since 30 October 2026), or on the store's own Dream Factory page (`/admin/{store}/dream-factory`, where an owner of a store not
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
  opens; money and messages still ask). Products are made one a turn, each with a picture the store's picture model makes (`create_product`'s
  picture `make`), until the brief's number are on sale.
- **Code's steps:** the brief (one answer of the model, its business details kept only where the owner wrote them, `ownBusiness()`), the
  website (D351's draft from the brief, built in the background, then published), the legal pages (D311's writer turned on and awaited;
  skipped where the business is outside Norway, Sweden and Denmark) and the rehearsal (the store's checkup with nothing blocking, every
  product still on sale everywhere).
- **The owner's steps:** the business details the description did not hold, the yes to the brief, payments (Stripe's identity check), a plan
  (the trial counts) and opening. A step that fails its check three times becomes a question with *Try again*.
- **A test run** is one whose owner is at the drills' test address (`@resend.dev`): its yes is pressed by the drill and counted, it pays in
  test mode, needs no plan, stays private and ends ready to open. The live drill `dream_factory` signs up through the real self-serve path
  with the fixed prompt (`DRILL_PROMPT`) and its run is scored on Platform → AI.

**Not yet:** the rehearsal does not place and pay a test order (paying needs Stripe's own checkout page in a browser); a domain is the
owner's on Domains, outside the run; `/dream-factory` on Kaizena Flow's own site still says "Coming soon" (its text is the owner's page).

## The workflow

Steps in the same lane run side by side; a lane starts when the steps it needs have passed. **Owner** marks the presses only a person
may make: the law's (identity for payments), money (a plan, a domain) and the moment the store opens to the public.

| # | Step | Lane | Needs | Who | Done when (checked by code) |
|---|---|---|---|---|---|
| 0 | **Prompt** | — | — | Owner | A description of 20 to 2,000 characters (sign-up's "What will you sell?" with *Build my store with AI* ticked, or the Dream Factory page) |
| 1 | **Brief** | — | 0 | AI | What is sold, to whom, countries, languages, currency, price range, name, tone, products (3 to 12, default 6) and up to 3 pages; the business's legal name, address, email and country only where the owner wrote them, else asked (`briefQuestions()`) |
| 1b | **Confirm the brief** | — | 1 | Owner | One press on the brief as shown; it also agrees to the legal pages being written |
| 2 | **Research** | A | 1b | AI | At least 3 research notes made in the step, each with a source |
| 3 | **Setup** | A | 1b | AI | `getSetupProgress()`: business details, countries, and a shipping price for every country |
| 4 | **Brand and look** | A | 1b | AI | A brand profile with a tagline or voice, and a theme in the library |
| 5 | **Products** | B | 2, 3 | AI | The brief's number of the store's own products active, each with a picture and a price in every active country; no demo product on sale |
| 6 | **Website** | B | 4 | Code | The draft's pages built and published, the first the front page (D351) |
| 7 | **Legal pages** | B | 3 | Code | The writer's pages all settled, none failed, at least one published; skipped outside Norway, Sweden and Denmark |
| 8 | **Payments** | C | 3 | Owner | Live card payments active; a test run skips it |
| 9 | **Plan** | C | 1b | Owner | A plan or a running trial; a test run without one skips it |
| 10 | **Rehearsal** | — | 5, 6, 7 | Code | The store's checkup without a blocking finding (setup, drafts, numbering, stock history) and every product still on sale everywhere |
| 11 | **Open** | — | 10, 8, 9 | Owner | The store open; a test run stays private and skips it |
| 12 | **First goals** | — | 11 | AI | Two active goals |

**Owner presses in a full run: five** (prompt, brief, payments identity, plan, open), plus a domain if wanted. Everything else is the AI's,
inside the levels and budgets the store already has.

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
