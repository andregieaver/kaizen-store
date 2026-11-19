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

Some *review* and *strong* steps have commits a smaller model may still do alone: the Who column says "commit 1, 2 cheap"
and the brief marks each such commit. Hand the step over to the stronger model at the first commit that is not marked.
Every rating was made by the brief's writer and checked by a second reviewer who did not see it (12 November). Each brief was then checked against the code and against the briefs of the steps before it, and its errors fixed; the
last line of *Checked against the code* says what was corrected.

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

{{ORDER}}
