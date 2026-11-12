# How to carry out the bloat plan

This is for whoever carries out a step of `docs/audits/bloat-review-2026-11.md`: a person or a model, in a fresh session, with
none of the review's context. Read this file once. Then read the brief of the step you were given, and nothing else of the plan.

The plan was written on 12 November 2026 and nothing was started. Its goal is grade A in every area. The owner has answered
every question (`decisions.md`). No step needs a paid plan, a paid add-on or a larger machine: if a brief seems to ask for
one, stop and say so.

## One step, start to finish

1. **Take one step.** Open the Progress table in `docs/audits/bloat-review-2026-11.md`. Take the step you were given, or the
   first Open step in the order at the end of this file. Check every step in its **After** column is Done. If one is not, do
   that one first, or stop.
2. **Read its brief**, `steps/<step>.md`, whole. Then read every file under *Before you start*. The repo's `CLAUDE.md` binds
   you as it binds everyone; where the brief and `CLAUDE.md` disagree, `CLAUDE.md` wins and you report the brief's error.
3. **Check the brief against the code before you edit.** The brief was checked on 12 November, and the code moves. Open each
   file the first commit names and see that the function, import or line it describes is there. If it is not as described,
   stop and report (see below). Do not guess what was meant.
4. **Set the step to In progress** in the Progress table, in your first commit.
5. **Do one commit at a time, in the brief's order.** Make the changes the commit lists and no others. Run the checks under
   *Before the push*, narrowest first, then `pnpm lint && pnpm typecheck && pnpm test`. All must pass. Then commit and push to
   `main` as `CLAUDE.md` says. Wait for the deploy to report the commit before the next commit (`scripts/await-deploy.mjs`
   does this in CI; a red run is yours to read and fix).
6. **Prove it.** Run each check under *Done when* and compare with **Expect**. A number that misses is not done: see *Stop*.
   Then do what *After the deploy* says, in production.
7. **Write it down**, in the same commit as the last change or the one after: the lines under *Write down*; the step's row in
   the Progress table set to Done with the date, the commit and the measured figure in Notes; a line in the change log.
8. **Do not raise a grade.** Only step 4.5 and the owner's review change a grade in the scorecard, and only for figures read
   in production.

## Rules that are easy to break

- **Only the step.** Do not tidy, rename or improve anything the brief does not name, even if it is plainly wrong. Write it in
  Notes instead. A second step may depend on the thing you would have tidied.
- **Never make a check pass by weakening it.** Do not skip, delete or loosen a test, raise a budget, add to an allow-list or
  lower a ratchet's baseline in the wrong direction, unless the brief says so in those words. If a test must change for your
  change to pass and the brief does not name that test, stop.
- **Unused is not a reason.** The platform is not open yet. Never remove a feature, a table, a route, a job or an AI tool
  because nothing uses it today. Remove only what the brief names.
- **Migrations.** Never apply one by hand. Add, never rename or drop, in the same change as the code that stops using
  something. On the hot tables (orders, order_lines, visits, products, product_variants, customers, carts, cart_lines) an
  index is built `concurrently` in a file whose first line is `-- kaizen:no-transaction`, and a constraint is added
  `not valid` first. After a custom migration run `node scripts/prune-snapshots.mjs`. After the deploy, read the security and
  performance advisors and record the file's version in `docs/decisions.md`.
- **Anything that deletes production data for good** (a dropped schema or table, pruned rows) waits for the owner to see the
  dump and the row counts first, even though the decision itself is made. The brief says where.
- **Stores and the platform together.** Where the brief names a platform file beside a store file, both change in the same
  commit.
- **Next.js here is not the one you know.** Before touching routing, caching, prefetching, the proxy, `next.config` or the
  build, read the guide the brief names under `node_modules/next/dist/docs/`.
- **A decision gets a number.** Each step that changes how the system behaves gets the next free D-number row in
  `docs/decisions.md`, as the brief says. Take the number when you write the row, not before.
- **Secrets and people's data** never go into a log line, a test fixture, a commit or a report.

## Stop, and report

Stop when the brief's *Stop and report if* says so, and also when:

- a file, function or number is not as the brief describes;
- a check under *Before the push* fails and the cause is not in the lines you changed;
- a *Done when* figure misses its **Expect** after the change is live;
- the change would need a file, a table or a setting the brief does not name;
- you have tried the same fix twice.

To stop: leave `main` green (revert your unpushed work, or push a revert of a commit that broke something), set the step's
Status back to Open or leave it In progress with the reason, and write in Notes what you found: the file and line, what the
brief said, what is there, and the command and output that show it. Do not go on to another step that lists this one under
After.

## Who does a step

The **Who** column, and the first line of each brief:

- **cheap**: fully specified and mechanical; the checks catch a wrong edit. A smaller model does it alone.
- **review**: a smaller model does it, and a stronger model (or the owner) reads the whole diff before it is pushed. These
  touch money, sign-in, checkout, caching rules, hot tables or many files at once.
- **strong**: needs judgement the brief could not remove. The brief says what. A stronger model does it, or breaks it into
  smaller briefs first.

## Measuring

The numbers in *Done when* come from the scripts in `../scripts/` (the folder's `README.md` shows how to run them on a
production build), from a named test, or from a production query in `../evidence/production-database.md`. Step 1.x of the
plan moves these scripts into the repo's own commands; until a brief says a script has moved, use the path it gives. Measure
before your change as well as after when the brief gives today's figure: if today's figure is already different, say so in
Notes and compare against your own before.

## The order

Phases run in order: 0, then 1, then 2, then 3, then 4. Inside a phase the steps are independent unless **After** says
otherwise, so they may be done in any order that respects it; the order below is the suggested one (small and safe first,
and a step before the steps that build on it).

151 briefs: 21 cheap, 81 review, 49 strong.

### Phase 0: Before the doors open

| # | Step | What | Effort | Who | After |
|---|---|---|---|---|---|
| 1 | [0.1](steps/0.1.md) | Put the review's scripts and lists in the repo | S | strong |  |
| 2 | [0.2](steps/0.2.md) | Store a daily reading of production, so every later step has a 'before' | S | review |  |
| 3 | [0.3](steps/0.3.md) | Let the deploy job, not a visitor, meet the first cold page | S | review |  |
| 4 | [0.4](steps/0.4.md) | Cut the two import hubs: the unused schema and the chat module's helpers | S | review | 0.1, 0.3 |
| 5 | [0.5](steps/0.5.md) | Load sharp, the font parser and the AI manager's engine when they are used | S | review | 0.1, 0.3 |
| 6 | [0.6](steps/0.6.md) | Cut the import cycle of 229 server files | M | strong | 0.1, 0.3, 0.4 |
| 7 | [0.7](steps/0.7.md) | Give code outside the admin its own small word modules, so the admin's words leave shoppers' routes | M | review | 0.1, 0.3 |
| 8 | [0.8](steps/0.8.md) | Make a language translated by AI cost what it uses: at start, per document and per minute | M | strong | 0.1, 0.3, 0.4 |
| 9 | [0.9](steps/0.9.md) | Take Supabase's client, zod and the builder's English off every signed-in screen | S | review |  |
| 10 | [0.10](steps/0.10.md) | Keep the page builder and the rich text editor off screens that do not edit a page | M | review | 0.9 |
| 11 | [0.11](steps/0.11.md) | Take two whole tables out of client scripts: the Work invoice's words and the AI manager's tool definitions | S | review | 0.9, 0.10 |
| 12 | [0.12](steps/0.12.md) | Stop prefetching what a press cannot use on stores and on Kaizena Flow's site | S | cheap |  |
| 13 | [0.13](steps/0.13.md) | Fetch the admin's rail and list rows when a link is pointed at | M | review | 0.12 |
| 14 | [0.14](steps/0.14.md) | End the prefetch loop on /s/ addresses, and write both router settings down | S | cheap |  |
| 15 | [0.15](steps/0.15.md) | Make no server call after load for a visitor with nothing to fetch | M | review |  |
| 16 | [0.16](steps/0.16.md) | Send shoppers' first scripts only what the page draws | M | strong |  |
| 17 | [0.17](steps/0.17.md) | Cut what a menu and a progress poll cost in the admin | S | review |  |
| 18 | [0.18](steps/0.18.md) | Draw the route once per save | M | review |  |
| 19 | [0.19](steps/0.19.md) | Read the products, customers and stores lists a page at a time | M | review |  |
| 20 | [0.20](steps/0.20.md) | Stop asking for what does not change: a store's slug, the theme cards, the hosts list | S | cheap |  |
| 21 | [0.21](steps/0.21.md) | Read the AI connection only to call a model, and give search a ceiling | M | strong | 0.2 |
| 22 | [0.22](steps/0.22.md) | Work the cart and a shopper's facts out once per request, with no read for a feature that is off | S | review |  |
| 23 | [0.23](steps/0.23.md) | Filter a store's rows the way its index can serve | M | review | 0.2 |
| 24 | [0.24](steps/0.24.md) | Read one page, not all of them | M | review | 0.23, 0.1 |
| 25 | [0.25](steps/0.25.md) | Prune the scheduler's own log | S | cheap |  |
| 26 | [0.26](steps/0.26.md) | Drop the 13 duplicate indexes, and add the test that stops the next one | S | review |  |
| 27 | [0.27](steps/0.27.md) | Let the knowledge job read no document when nothing was published | M | review |  |
| 28 | [0.28](steps/0.28.md) | Make picture, alt-text and product upkeep cost one statement when nothing changed | M | review | 0.27 |
| 29 | [0.29](steps/0.29.md) | Let the listings' check record a try and read only reworded products | S | review | 0.28 |
| 30 | [0.30](steps/0.30.md) | Let the invoice job ask only stores it can issue for | S | review |  |
| 31 | [0.31](steps/0.31.md) | Run prunes daily, not every five minutes or every minute | S | cheap |  |
| 32 | [0.32](steps/0.32.md) | Serve pictures as stored, and give every file with a fixed address a long lifetime | S | review |  |
| 33 | [0.33](steps/0.33.md) | Keep an 800 px copy of every picture | M | strong | 0.32 |
| 34 | [0.34](steps/0.34.md) | Give the admin's colour names a value on public pages | S | review |  |
| 35 | [0.35](steps/0.35.md) | Point Tailwind at code only | S | cheap | 0.34 |
| 36 | [0.36](steps/0.36.md) | Delete what nothing uses | M | strong |  |
| 37 | [0.37](steps/0.37.md) | Remove the old admin redirects and the bookings and deliveries twin switch | M | review | 0.36 |
| 38 | [0.38](steps/0.38.md) | Run each check once in CI | S | review |  |
| 39 | [0.39](steps/0.39.md) | Let a test load only what it uses | M | review | 0.38 |
| 40 | [0.42](steps/0.42.md) | Compare by job the two pairs of engines nobody compared | S | strong | 0.1 |
| 41 | [0.43](steps/0.43.md) | Hold CLAUDE.md's core from the first day, and open a home for this plan's own sentences | S | cheap |  |
| 42 | [0.40](steps/0.40.md) | Wrap the long lines of the rules and every living doc, and keep history out of searches | S | cheap | 0.1, 0.43 |
| 43 | [0.41](steps/0.41.md) | Make the rules say what is so, and claim a decision's number on main before citing it | M | review | 0.43, 0.40, 0.1 |
| 44 | [0.44](steps/0.44.md) | Give pictures in page content the 800 px copy | M | review | 0.33 |
| 45 | [0.45](steps/0.45.md) | Cap the dispatcher at four jobs at a time | S | cheap |  |
| 46 | [0.46](steps/0.46.md) | Make the themes, the content packs and the seed write today's page shape | S | cheap |  |

### Phase 1: Budgets, so it stays removed

| # | Step | What | Effort | Who | After |
|---|---|---|---|---|---|
| 1 | [1.1](steps/1.1.md) | Give every budget one home, and hold the written rules first | M | review | 0.43, 0.40, 0.41 |
| 2 | [1.2](steps/1.2.md) | Hold every route's first scripts | S | cheap | 0.9, 0.16, 1.1 |
| 3 | [1.3](steps/1.3.md) | Hold documents, stylesheets and requests on real store pages | M | review | 0.12, 0.16, 1.1 |
| 4 | [1.4](steps/1.4.md) | Put the admin under the import walk, and hold where the words go | M | review | 0.7, 0.9, 0.36, 1.1 |
| 5 | [1.5](steps/1.5.md) | Hold what a signed-in screen is handed, in English and in Norwegian | M | review | 0.9, 0.13, 0.1, 1.1 |
| 6 | [1.6](steps/1.6.md) | Put a launch-theme store into the measured set | M | strong | 1.3, 0.33, 0.44, 0.46, 0.1 |
| 7 | [1.7](steps/1.7.md) | Put a cart with products and the checkout's payment step into the measured set | M | strong | 1.3, 0.1 |
| 8 | [1.8](steps/1.8.md) | Hold what a server entry loads and carries | M | review | 0.1, 0.4, 0.36, 1.1 |
| 9 | [1.9](steps/1.9.md) | Count statements: one counter, and the admin's five screens | M | review | 1.1 |
| 10 | [1.10](steps/1.10.md) | Count the statements and rows of scheduled work and of a cold frame | M | strong | 1.9, 1.1 |
| 11 | [1.11](steps/1.11.md) | Hold the storefront's server side: statements per page, cached reads and render modes | M | review | 1.9, 0.1, 0.3, 1.1 |
| 12 | [1.12](steps/1.12.md) | Count a shop-only store's journey, and what one placed order writes | M | strong | 1.9, 1.10, 1.1 |
| 13 | [1.13](steps/1.13.md) | Flag in production what a test cannot see in the database | M | review | 0.2, 0.25, 1.9 |
| 14 | [1.14](steps/1.14.md) | Hold time on a slow phone with a nightly production figure | M | review | 1.6, 1.3 |
| 15 | [1.15](steps/1.15.md) | Hold the admin's speed with a line in the morning briefing | S | cheap |  |
| 16 | [1.16](steps/1.16.md) | Show cold starts as a production figure | M | review | 0.8, 1.8 |
| 17 | [1.17](steps/1.17.md) | Hold unused code, copies and the admin's repeats with ratchets of exact lists | M | review | 0.1, 0.36, 1.1, 1.10 |
| 18 | [1.18](steps/1.18.md) | Hold the surface: fourteen counts, the hot tables' indexes and triggers, and a new store's rows | S | cheap | 1.1, 0.26, 0.31, 0.42 |
| 19 | [1.19](steps/1.19.md) | Hold every agent's round, show real tokens per call, and let the eval see whether the model finds a tool | M | strong | 0.1, 1.1, 0.21 |
| 20 | [1.20](steps/1.20.md) | Record every check's seconds and the build's peak memory, with ceilings | M | review | 0.38, 1.8, 1.11, 1.1 |
| 21 | [1.21](steps/1.21.md) | Give the production build room, and fail a run before it runs out | M | review | 1.20, 0.38 |
| 22 | [1.22](steps/1.22.md) | Watch the scheduler from outside, and run the daily job once | S | review | 0.25 |
| 23 | [1.23](steps/1.23.md) | Count what is in the stylesheet, and read the style text owners write | S | review | 1.8, 0.1, 1.1 |
| 24 | [1.24](steps/1.24.md) | Measure what a session really loads, and hold source file size | M | cheap | 0.1, 0.40 |
| 25 | [1.25](steps/1.25.md) | Count tag refreshes and store page draws in production | S | review | 1.9 |
| 26 | [1.26](steps/1.26.md) | Let no job swallow its own failure | M | review | 1.22 |
| 27 | [1.27](steps/1.27.md) | Hold by name what a store page's first scripts may hold | S | cheap | 0.16 |
| 28 | [1.28](steps/1.28.md) | Count handed against named words at every hand-down site, without a browser | M | review |  |

### Phase 2: Load on demand

| # | Step | What | Effort | Who | After |
|---|---|---|---|---|---|
| 1 | [2.1](steps/2.1.md) | Leave a map in CLAUDE.md, and bring the always-loaded core under 10.5 KB | M | review | 1.1, 0.43, 0.41, 0.40 |
| 2 | [2.2](steps/2.2.md) | Send the store's layout once | M | review | 0.1, 1.3 |
| 3 | [2.3](steps/2.3.md) | Draw each fixed style sheet once per document | S | review | 2.2, 1.3, 1.6 |
| 4 | [2.4](steps/2.4.md) | Serve store pages with nothing per visitor as static files, and let Add to cart answer a number | M | strong | 0.15, 1.11, 2.2, 1.3 |
| 5 | [2.5](steps/2.5.md) | Give crawlers on Next's bot list the cached page | S | cheap | 2.4, 1.11 |
| 6 | [2.6](steps/2.6.md) | Route every link through one wrapper with a stated policy | M | review | 0.13, 1.3, 2.2 |
| 7 | [2.7](steps/2.7.md) | Keep a press on a built page's tile inside the app | M | review | 2.6, 1.3 |
| 8 | [2.8](steps/2.8.md) | Bound what a real listing fetches ahead, and decide partial prefetching by trial | M | review | 2.6, 0.14, 1.3 |
| 9 | [2.9](steps/2.9.md) | Let each working route load its own parts | M | review | 0.16, 2.2, 1.2, 1.3 |
| 10 | [2.10](steps/2.10.md) | Let a recommending grid bring its own words | M | strong | 1.27, 2.7 |
| 11 | [2.11](steps/2.11.md) | Give the storefront a stylesheet of its own | M | review | 1.21, 1.23, 1.3, 0.35, 0.34, 0.12 |
| 12 | [2.12](steps/2.12.md) | Draw a listing's grid once and read its list once | M | review | 2.10, 2.2 |
| 13 | [2.13](steps/2.13.md) | Ask the database for stock only on a product view | M | review | 1.11, 1.12, 0.22 |
| 14 | [2.14](steps/2.14.md) | Let a publish make only its own page stale | M | strong | 0.24, 1.11, 0.28 |
| 15 | [2.15](steps/2.15.md) | Let tagged reads live until their tag is refreshed | M | strong | 2.14, 1.11, 1.25 |
| 16 | [2.16](steps/2.16.md) | Keep a page's title and flags in columns | M | review | 0.24, 0.23 |
| 17 | [2.17](steps/2.17.md) | Let page lists, pickers and grids open no document | M | strong | 2.16, 0.24, 1.9, 0.19 |
| 18 | [2.18](steps/2.18.md) | Read a cold store page's frame in one wave | M | strong | 2.16, 0.24, 1.10, 1.11, 1.12, 2.2 |
| 19 | [2.19](steps/2.19.md) | Read nothing that grows with the catalogue, and read the cart and checkout in one wave | M | strong | 1.11, 1.9, 0.22, 2.13, 2.17, 2.15 |
| 20 | [2.20](steps/2.20.md) | Turn the proxy's readers into leaf modules | L | review | 1.8, 0.4, 0.6, 0.7 |
| 21 | [2.21](steps/2.21.md) | Read a page without importing the code that saves pages | M | strong | 2.20, 0.24, 2.17, 1.8, 0.6 |
| 22 | [2.22](steps/2.22.md) | Read a store without the Stripe SDK and without the whole page model | M | strong | 1.8, 0.4, 0.5, 0.6, 2.21 |
| 23 | [2.23](steps/2.23.md) | Trace the product taxonomy only beside routes that can read it | M | review | 1.8, 0.6, 0.5, 2.20 |
| 24 | [2.24](steps/2.24.md) | Shrink the server-reference manifest | L | strong | 1.8, 0.6, 2.20, 2.21, 0.4 |
| 25 | [2.25](steps/2.25.md) | Load the admin's words by area on admin routes too | L | strong | 0.7, 1.4, 1.8, 0.6 |
| 26 | [2.26](steps/2.26.md) | Take English catalogues out of the admin's client code | M | strong | 0.9, 1.4, 1.2 |
| 27 | [2.27](steps/2.27.md) | Hand each admin page only the words its parts read | L | strong | 0.9, 1.5, 1.28, 2.26, 0.10 |
| 28 | [2.28](steps/2.28.md) | Do not send the words again with a save | M | strong | 1.5, 2.27, 0.17 |
| 29 | [2.29](steps/2.29.md) | Let the builder paint first: the rich text editor and a store language load after | M | review | 0.10, 1.4, 1.2, 2.26 |
| 30 | [2.30](steps/2.30.md) | Load the builder's dialogs and each block's field form when they are opened | L | strong | 0.1, 2.29, 2.27, 2.28, 1.5 |
| 31 | [2.31](steps/2.31.md) | Keep the session without the whole Supabase client | M | review | 0.9, 1.5 |
| 32 | [2.32](steps/2.32.md) | Lighten the admin's shell and the store Home | M | review | 1.9, 0.17 |
| 33 | [2.33](steps/2.33.md) | Make no Supabase Auth call per request for an account without a second factor | S | review |  |
| 34 | [2.34](steps/2.34.md) | Let an untouched tab ask for notices less often | S | cheap | 0.17 |
| 35 | [2.35](steps/2.35.md) | Answer a store's own domain without a deployment | L | strong | 2.20, 1.8, 1.21 |
| 36 | [2.36](steps/2.36.md) | Send the AI manager a lean default round | M | strong | 1.19, 0.5, 0.11 |
| 37 | [2.37](steps/2.37.md) | Slim the tool schemas, so no first round is over 56,000 characters | M | strong | 1.19, 2.36 |
| 38 | [2.38](steps/2.38.md) | Use cached input | M | strong | 1.19, 2.36, 2.37 |
| 39 | [2.39](steps/2.39.md) | Give small jobs a quick model | M | strong | 1.19, 2.38 |
| 40 | [2.40](steps/2.40.md) | Keep one file per decision, with a generated index | M | review | 0.41, 1.1 |
| 41 | [2.41](steps/2.41.md) | Retire the frozen Migration versions list and the order to add to it | S | cheap | 2.40, 2.1, 1.1 |
| 42 | [2.42](steps/2.42.md) | Shorten the gate's type check | M | review | 0.38, 1.20 |
| 43 | [2.43](steps/2.43.md) | Add a related test run for the push | S | review | 0.38, 0.39, 1.20, 2.42 |
| 44 | [2.44](steps/2.44.md) | Show by trial whether component and database tests need a fresh worker | S | cheap | 0.39, 1.20 |
| 45 | [2.45](steps/2.45.md) | Cut what the largest paint waits for on a themed page | M | strong | 1.14, 1.6, 1.3 |
| 46 | [2.46](steps/2.46.md) | Keep schemas apart from the helpers beside them, so zod loads only where a screen runs one | L | review | 0.9, 1.4, 1.2 |
| 47 | [2.47](steps/2.47.md) | Take the order writer off pages that only show products | L | strong | 1.8, 2.9, 2.22 |
| 48 | [2.48](steps/2.48.md) | Give a placed order a ceiling, and stage placeOrder where the first figures are over it | M | review | 1.12, 1.9 |
| 49 | [2.49](steps/2.49.md) | Load motion.css where a page uses it | M | strong | 1.23, 2.11, 1.3 |
| 50 | [2.50](steps/2.50.md) | Let a catalogue file be imported by its area module only, and import no code | M | review | 2.25, 2.26, 1.4, 1.8 |

### Phase 3: One of each

| # | Step | What | Effort | Who | After |
|---|---|---|---|---|---|
| 1 | [3.1](steps/3.1.md) | Run one tick a minute, and call a route only when work waits | L | review | 0.23, 1.10, 1.26, 1.22 |
| 2 | [3.2](steps/3.2.md) | Let the three feature routes follow what is due | M | strong | 3.1, 1.10 |
| 3 | [3.3](steps/3.3.md) | Run the dispatcher from a registry: a cadence and a time budget per job | L | strong | 0.45, 1.26, 1.10, 0.28 |
| 4 | [3.4](steps/3.4.md) | Give every daily function a ledger row of its own | M | review | 3.3, 3.1, 1.22, 1.26 |
| 5 | [3.5](steps/3.5.md) | Give every table that grows by time a delete rule | M | strong | 0.2 |
| 6 | [3.6](steps/3.6.md) | Let per-store jobs find due work by a mark, and look hourly | M | review | 3.3, 1.10, 0.28 |
| 7 | [3.7](steps/3.7.md) | Call the PDF route when a document waits | S | review | 3.1 |
| 8 | [3.8](steps/3.8.md) | Drop the duplicate idempotency table and the leftover schema, after a verified dump | S | review | 0.2 |
| 9 | [3.9](steps/3.9.md) | Keep one kaizenaflow.com | L | strong |  |
| 10 | [3.10](steps/3.10.md) | Run the platform's workflows, own endpoints and integration deliveries on the stores' engine with a scope | M | strong | 1.17 |
| 11 | [3.11](steps/3.11.md) | Fold order rules into Workflows | M | strong | 3.10 |
| 12 | [3.12](steps/3.12.md) | Save an own look in one place: the theme library | S | review |  |
| 13 | [3.13](steps/3.13.md) | Give the five file imports one core | M | strong | 1.17 |
| 14 | [3.14](steps/3.14.md) | Draw Work once for store and account, and keep one Domains move page | M | review | 1.17, 3.13 |
| 15 | [3.15](steps/3.15.md) | Keep one of each small thing: helpers, SQL fragments, English word lists | M | review | 1.17, 3.13 |
| 16 | [3.16](steps/3.16.md) | Draw an order's totals from one part | S | review |  |
| 17 | [3.17](steps/3.17.md) | Keep one stored page shape | M | strong | 0.46 |
| 18 | [3.18](steps/3.18.md) | Build twice per push, and lint and type-check once | M | strong | 0.38, 1.20 |
| 19 | [3.19](steps/3.19.md) | Let a burst of pushes share one deploy | S | review | 0.38, 1.21 |
| 20 | [3.20](steps/3.20.md) | Show how long due work waits, and say so when it is too long | S | review | 3.1, 1.22 |

### Phase 4: Tidy

| # | Step | What | Effort | Who | After |
|---|---|---|---|---|---|
| 1 | [4.1](steps/4.1.md) | Build the admin kit and move action files onto the shared wrapper, area by area | L | strong | 1.17, 3.14 |
| 2 | [4.2](steps/4.2.md) | Fold the remaining twins | M | strong | 1.17, 3.16, 3.10, 4.1 |
| 3 | [4.3](steps/4.3.md) | Tidy the tests' side: exports only a test keeps alive, shared mocks and one tree walker | M | strong | 1.17, 3.15 |
| 4 | [4.4](steps/4.4.md) | Make the last reads fetch what they show | M | review | 1.9, 2.32 |
| 5 | [4.5](steps/4.5.md) | Measure everything again, and read each area against its bar | M | strong | 4.1, 4.2, 4.3, 4.4, 1.20, 1.8, 1.21 |
| 6 | [4.6](steps/4.6.md) | Let a logged time entry be corrected in Work, and delete two invoice actions no screen uses | S | cheap |  |
| 7 | [4.7](steps/4.7.md) | Say that live drills are a console tool | S | cheap |  |

### Files more than one step changes

When you edit one of these, a step before yours may already have changed it: read the file as it is, not as your brief quotes it.

| File | Steps, in order |
|---|---|
| `docs/decisions.md` | 0.14, 0.15, 0.16, 0.17, 0.18, 0.19, 0.20, 0.21, 0.22, 0.23, 0.24, 0.25, 0.26, 0.27, 0.28, 0.29, 0.30, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.37, 0.38, 0.39, 0.41, 2.12, 2.14, 2.15, 2.16, 2.17, 2.18, 2.19, 2.20, 2.21, 2.22, 2.23, 2.24, 2.40, 2.43, 3.8, 3.19, 4.7 |
| `docs/performance.md` | 0.3, 0.4, 0.5, 0.6, 0.8, 0.9, 0.10, 0.11, 0.12, 0.14, 0.16, 0.32, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 1.9, 1.11, 1.12, 1.14, 1.15, 1.23, 1.27, 1.28, 2.5, 2.6, 2.8, 2.9, 2.11, 2.15, 2.20, 2.21, 2.22, 2.23, 2.24, 2.45, 2.48, 2.49 |
| `docs/audits/bloat-review-2026-11.md` | 0.1, 0.27, 0.28, 0.29, 0.30, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.37, 0.38, 0.39, 0.42, 2.12, 2.14, 2.15, 2.16, 2.17, 2.18, 2.19, 2.20, 2.21, 2.22, 2.23, 2.24, 2.30, 4.5 |
| `src/db/schema.ts` | 0.2, 0.8, 0.23, 0.26, 0.27, 0.28, 0.29, 0.30, 0.33, 0.37, 1.13, 1.16, 1.19, 1.25, 2.16, 2.23, 2.39, 3.2, 3.3, 3.4, 3.6, 3.7, 3.8, 3.9, 3.11, 3.12, 3.20, 4.4 |
| `docs/rules/storefront.md` | 0.3, 0.8, 0.10, 0.15, 0.21, 0.23, 0.27, 0.28, 0.44, 2.1, 2.2, 2.4, 2.5, 2.6, 2.8, 2.12, 2.14, 2.18, 2.19, 2.23, 3.19 |
| `docs/audits/code-review-2026-11.md` | 0.4, 0.6, 0.9, 0.13, 0.19, 0.26, 0.38, 0.39, 0.41, 2.17, 2.19, 2.20, 2.21, 2.22, 2.24, 2.33, 2.39, 2.40 |
| `.github/workflows/ci.yml` | 0.3, 0.38, 1.1, 1.2, 1.4, 1.6, 1.8, 1.11, 1.20, 1.21, 1.23, 2.35, 2.42, 2.43, 3.17, 3.18, 3.19 |
| `CLAUDE.md` | 0.3, 0.9, 0.14, 0.23, 0.38, 0.39, 0.41, 1.1, 2.1, 2.11, 2.40, 2.41, 2.43, 3.10, 3.19 |
| `src/db/commerce.test.ts` | 0.23, 0.27, 0.28, 0.36, 0.37, 0.39, 1.16, 1.18, 1.25, 2.16, 2.23, 2.39, 2.48, 3.1, 3.6 |
| `docs/rules/admin/website.md` | 0.7, 0.10, 0.15, 0.28, 0.36, 0.41, 2.3, 2.9, 2.11, 2.16, 2.17, 2.20 |
| `e2e/performance.spec.ts` | 0.16, 0.33, 0.44, 1.3, 1.6, 1.7, 1.14, 2.2, 2.3, 2.9, 2.45, 2.49 |
| `docs/ci-migrations.md` | 0.3, 0.25, 0.26, 0.38, 0.39, 1.8, 1.18, 1.21, 2.41, 2.43, 3.19 |
| `next.config.ts` | 0.14, 0.32, 0.37, 0.38, 1.20, 1.21, 2.5, 2.15, 2.23, 2.35, 4.5 |
| `src/server/ratchet.baseline.json` | 0.36, 1.3, 1.10, 1.12, 1.17, 1.24, 2.6, 2.13, 2.17, 2.18, 4.1 |
| `docs/rules/admin/platform.md` | 0.9, 0.13, 0.18, 0.37, 0.41, 0.45, 1.23, 1.26, 2.25, 4.7 |
| `docs/rules/budgets.md` | 0.43, 0.40, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7 |
| `src/app/api/cron/subscription-reminders/route.ts` | 0.2, 0.31, 1.13, 1.16, 1.22, 3.4, 3.5, 3.20 |
| `src/server/pages.ts` | 0.20, 0.23, 0.24, 2.14, 2.15, 2.16, 2.17, 2.21 |
| `src/app/api/cron/cart-reminders/route.ts` | 0.28, 0.31, 1.10, 1.26, 2.14, 3.3, 3.6, 3.7 |
| `src/server/cron-runs.ts` | 0.31, 0.45, 1.16, 1.25, 1.26, 3.3, 3.4, 3.7 |
| `src/app/admin/(gated)/[store]/layout.tsx` | 0.11, 0.12, 0.17, 1.9, 1.16, 2.27, 2.32 |
| `docs/build-memory.md` | 0.35, 0.38, 1.20, 1.21, 2.11, 2.42, 4.5 |
| `package.json` | 0.36, 0.38, 1.20, 1.23, 2.31, 2.42, 2.43 |
| `src/server/stores.ts` | 0.6, 0.16, 0.20, 2.15, 2.22, 2.35 |
| `src/app/s/[store]/[market]/layout.tsx` | 0.8, 1.16, 1.25, 2.2, 2.4, 2.18 |
| `e2e/signed-in/admin-scripts.spec.ts` | 0.9, 0.10, 0.13, 1.5, 2.28, 2.29 |
| `src/components/content-grid.tsx` | 0.16, 0.33, 0.34, 2.7, 2.10, 2.29 |
| `scripts/lib/ratchet-count.mjs` | 0.23, 1.3, 1.17, 1.24, 2.6, 4.1 |
| `scripts/ratchet.mjs` | 1.3, 1.10, 1.17, 1.24, 2.6, 4.1 |
| `src/server/cron-routes.scan.test.ts` | 1.10, 3.1, 3.2, 3.3, 3.4, 3.7 |
| `src/app/admin/(gated)/platform/capacity/page.tsx` | 1.13, 1.16, 1.23, 1.25, 3.3, 3.20 |
| `src/server/owner-assistant.ts` | 1.19, 2.19, 2.36, 2.37, 2.38, 2.39 |
| `docs/audits/bloat-review-2026-11/README.md` | 0.1, 0.9, 0.44, 1.23, 1.24 |
| `src/server/ai.ts` | 0.21, 0.23, 1.19, 2.38, 2.39 |
| `src/server/media-library.ts` | 0.23, 0.28, 0.33, 1.26, 3.7 |
| `src/server/catalog.ts` | 0.33, 2.13, 2.19, 2.23, 3.16 |
| `src/app/globals.css` | 0.34, 0.35, 2.11, 2.12, 2.49 |
| `README.md` | 0.41, 2.1, 2.40, 2.41, 2.43 |
| `src/server/ratchet.scan.test.ts` | 1.3, 1.17, 1.24, 2.6, 4.1 |
| `src/components/admin/admin-bundle.scan.test.ts` | 1.4, 2.26, 2.29, 2.31, 2.46 |
| `src/lib/admin-messages/capacity.en.ts` | 1.13, 1.15, 1.16, 1.23, 1.25 |
| `src/lib/admin-messages/capacity.nb.ts` | 1.13, 1.15, 1.16, 1.23, 1.25 |
| `src/server/content-packs.ts` | 0.5, 0.28, 0.33, 3.1 |
| `src/server/customers.ts` | 0.6, 0.15, 0.22, 2.4 |
| `src/server/seo.ts` | 0.6, 0.24, 2.15, 2.17 |
| `src/server/platform-briefing.ts` | 0.7, 1.13, 1.15, 1.16 |
| `src/server/staff-alerts.ts` | 0.7, 1.26, 3.11, 3.15 |
| `src/components/admin/admin-catalogues.scan.test.ts` | 0.7, 0.9, 2.25, 2.26 |
| `docs/audits/psi-followups.md` | 0.9, 0.41, 1.3, 3.7 |
| `src/lib/page-content.ts` | 0.10, 0.44, 2.22, 3.17 |
| `src/components/admin/product-editor.tsx` | 0.10, 0.32, 2.27, 2.46 |
| `src/test/eager-lazy-views.ts` | 0.10, 0.16, 2.29, 2.30 |
| `src/app/admin/(gated)/platform/layout.tsx` | 0.11, 1.9, 1.16, 2.27 |
| `docs/rules/admin/ai.md` | 0.11, 0.21, 2.34, 2.36 |
| `src/components/store-layout.tsx` | 0.12, 2.4, 2.6, 2.18 |
| `src/components/site-parts.tsx` | 0.12, 2.3, 2.4, 2.6 |
| `e2e/prefetch.spec.ts` | 0.12, 0.14, 1.3, 2.45 |
| `src/lib/storefront-bundle.scan.test.ts` | 0.16, 1.27, 2.9, 2.10 |
| `src/server/content-grid.ts` | 0.20, 0.23, 2.15, 2.17 |
| `src/components/cart-link.tsx` | 0.22, 2.2, 2.4, 2.6 |

