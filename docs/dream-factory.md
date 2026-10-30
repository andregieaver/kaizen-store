# Dream Factory: from one prompt to a live store

Status: **proposed** (30 October 2026). The site teases it (`/dream-factory`, "Coming soon" in the header); this file is the workflow the
AI follows, the owner watches and developers measure. Every step ends on a check made by **code against the store's data**, never on the
model's word, so a run can be scored the same way every time.

## Where things stand today

The parts exist; the run that joins them does not.

| Part | Built | How an owner reaches it today |
|---|---|---|
| Account and store | Self-serve sign-up (D359) | `/sign-up`, but the platform switch is **off** on production; until then a platform admin approves each request |
| A store from a description (D351) | Front page plus up to 3 pages, built as drafts, theme chosen, published on one yes | Home → *Start from a description*, or the setup wizard's first step, or the AI manager (`draft_store`) |
| Setup (D308 5.1) | `set_store_details`, `set_countries`, `set_languages`, `set_currencies`, `set_flat_shipping`, `save_shipping_method`, `setup_progress` | Setup wizard (7 steps) or the AI manager |
| Catalogue (D308 3) | `create_product`, `write_product_texts`, `set_prices`, categories, `set_product_status` | Products, or the AI manager |
| Brand and look (D330, D308 6.1) | `set_brand`, `design_look`, `make_brand_marks`, `add_theme`, `try_theme`, `make_theme_live` | Design, or the AI manager |
| Legal pages (D311) | Written from official sources and kept current | Turned on by the owner on Legal pages; `legal_pages_status` for the AI |
| Eyes (D310) | `look_at_page`, `look_at_store`, a score per page | The AI manager |
| Research (D329) | `search_web`, `read_web_page`, notes with sources | The AI manager |
| Goals and plans (D309, D328) | Plans of fixed steps, each checked by code, levels and budgets, a Decisions page | Autopilot page |
| Opening | `open_store`, never automatic | Setup → Open your store |

On production on 30 October 2026: **no store has been started from a description and no autopilot plan has run** (`store_drafts` and
`assistant_plans` are empty). The pilot drill (D406) showed the AI manager doing single owner tasks right; nothing has yet run the whole
road.

**Missing for a one-prompt run:**
1. **An entry:** `/dream-factory` explains but takes no prompt, and sign-up does not carry one into the new store.
2. **A conductor:** one run record that knows its steps, starts the parallel ones, waits on the owner's few presses and shows progress.
   Today each part is started by hand or by conversation.
3. **Product pictures by the AI manager:** *Make with AI* is in the library and the product editor (D349) but no tool lets the AI give a
   product a picture, and a product without one is refused publishing (the pilot hit this).
4. **A rehearsal on the new store:** the live drills (D406) need test orders that code places; a new store has none.
5. **A scorecard:** time, owner presses, AI cost and first-try passes per run, kept and compared.

## The workflow

Steps in the same lane run side by side; a lane starts when the steps it needs have passed. **Owner** marks the presses only a person
may make: the law's (identity for payments), money (a plan, a domain) and the moment the store opens to the public.

| # | Step | Lane | Needs | Who | Done when (checked by code) | Today |
|---|---|---|---|---|---|---|
| 0 | **Prompt** | — | — | Owner | A description of 20 to 2,000 characters, plus optionally pictures, links and the country; account made (sign-up) | Partial: sign-up exists, takes no prompt |
| 1 | **Brief** | — | 0 | AI | What is sold, to whom, countries, languages, currency, price range, name, tone: every field filled, at most 3 questions asked for what is missing; the business's legal name, organisation number and address come from the owner, never invented | Missing (the draft takes a description only) |
| 1b | **Confirm the brief** | — | 1 | Owner | One press on the brief as shown | Missing |
| 2 | **Research** | A | 1b | AI | At least 5 notes with a source each: market, 3 comparable shops, price levels, the countries' rules for what is sold | Built (tools), not joined |
| 3 | **Setup** | A | 1b | AI | `setup_progress`: details, countries and shipping all true; `tax_readiness` without a blocking line | Built (tools) |
| 4 | **Brand and look** | A | 1b | AI | Brand profile saved; logo made; a theme live in preview (not yet public); every new page's look score at least the agreed bar | Built (tools) |
| 5 | **Catalogue** | B | 2, 3 | AI | At least N products (agreed in the brief, default 6), each with texts, a price in every market, a category and a picture; no demo product left | Partial: no picture tool |
| 6 | **Website** | B | 4 | AI | Front page and up to 3 pages built and published to the store's preview, header and footer chosen, menus linked; zero serious accessibility findings by `pageIssues()` | Built (`draft_store`, header/footer tools) |
| 7 | **Legal** | B | 3 | AI, after the owner turned it on | `legal_pages_status`: terms, privacy, withdrawal and cookies published, every quote checked against its source | Built; the owner turns it on |
| 8 | **Payments** | C | 3 | Owner | Stripe's identity check done (`setup_progress.payments`); until then everything else goes on in test mode | Built (Stripe Connect) |
| 9 | **Plan** | C | 1b | Owner | A plan chosen (`setup_progress.plan`) | Built |
| 10 | **Domain** (optional) | C | 4 | AI proposes, Owner buys | Domain verified and serving the store | Built (`search_domains`, `buy_domain` gated) |
| 11 | **Rehearsal** | — | 5, 6, 7 | Code | In test mode: an order placed, paid, marked sent and refunded on the new store; `store_checkup` without a critical line; `look_at_store` passes | Partial: drills need a placed test order |
| 12 | **Open** | — | 8, 9, 11 | Owner | One press; the store answers 200 at its address and is in its sitemap | Built (`open_store`, never automatic) |
| 13 | **First goals** | — | 12 | AI | Two goals set (first sale, first 100 visitors) with a plan each waiting on the Decisions page | Built (D309, D328) |

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

## How it would be built

The autopilot already has what a run needs: plans of fixed step kinds, each checked by code after it runs, started on an owner's yes,
inside levels and budgets, with three failed tries becoming a question (D309). The Dream Factory is a **fixed launch plan** in that
machinery rather than a new engine:

1. **Entry:** `/dream-factory` takes the prompt; with sign-up on, it goes through `startSelfSignup()` and is kept with the request, and
   the new store starts its run on the confirm press. A signed-in owner starts it from Home.
2. **The run:** `commerce.dream_runs` (one per store) with the step table above as code, lanes started when their needs pass, each step's
   check one of `CHECK_KINDS`, the owner's steps on the Decisions page.
3. **The missing tool:** `make_product_picture` (gated by the AI budget, the picture kept in the library and marked `made_by`).
4. **The rehearsal:** a drill kind that places its own test order on the store (test mode only, an address at the test domain).
5. **The scorecard:** a Dream Factory page in the admin and on Platform → AI, the measures above per run.
6. **A drill for developers:** `dream_factory` in the live drills, running a fixed prompt on a test store end to end, so each change to a
   prompt or tool is measured like the safety eval.
