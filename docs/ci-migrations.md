# Migrations in CI, and the template database

Two tools that take waiting out of every unit of work: production's migrations are applied by CI
after the checks pass, and a lane gets its database from a template in about a second.

## Applying migrations to production from CI

`scripts/db-migrate.mjs` applies the files in `supabase/migrations` that a database has not had
yet, in name order. Each file runs in its own transaction together with its row in the ledger
`supabase_migrations.kaizen_files` (file name and SHA-256), so a failing file leaves nothing behind
and the run stops there. Rules it enforces:

- a file that was applied and edited since is refused (a new migration, never an edit);
- one run at a time (an advisory lock), `lock_timeout` 30 s and `statement_timeout` 10 min per file;
- a file whose first line is `-- kaizen:no-transaction` runs outside a transaction (below);
- a file whose first line is `-- kaizen:baseline-through=<file>` is recorded without running where the ledger has `<file>` (below);
- `MIGRATE_EXPECT` (the project ref) must appear in the connection string, so a wrong secret never
  reaches another database;
- the ledger must have rows before anything is applied (the baseline below), so a first run can never
  replay history.

### The baseline: squashed migrations (code review FD3, D572)

`supabase/migrations` starts with a baseline, not with every file ever written. The 789 files up to
`20261111172838_sms_campaign_index.sql` (47 days of work, 9.2 MB) became four, 3.9 MB:

- `20261111172839_baseline_1_schema.sql`, `…40_baseline_2_data.sql`, `…41_baseline_3_rules.sql`: the three sections of a `pg_dump`
  of a database built from all of them (types, tables and functions; the reference data they wrote; keys, indexes, triggers and row
  security), made by `scripts/squash-migrations.mjs`. Never edited.
- `20261111172842_baseline_4_roles_and_supabase.sql`: what one database's dump cannot carry, kept by hand: the `postgres` role's
  limits, and what exists only on Supabase (Storage's buckets, the scheduled jobs, the scheduler's Vault secret), written from
  production as it stood and guarded so plain Postgres skips it.

Each starts `-- kaizen:baseline-through=20261111172838_sms_campaign_index.sql`. On an empty database (CI, a lane, `db-setup.mjs`,
the tests' PGlite) they run like any file. In production `db-migrate.mjs` sees the ledger already has the file they name, and records
them (`applied_by = 'baseline'`) without running them. The squashed files are in `supabase/archive/20261111172838/`, outside every
path that applies migrations. Tests check the database the baseline and the newer files build; the archive is history that no
test reads (bloat review step 0.39 removed `src/db/migration-files.ts`). The runner counts the archive as applied history.

The script checks before it writes. It builds one database from the files and one from the baseline, and compares a `pg_dump` of each:
the schema line by line (a line may differ only in a check's parentheses, which Postgres regroups on reading `(a AND b) AND c`; 63 did)
and the data row by row. On 11 November 2026 both were the same.

**Repeat it each quarter**, on a local server (never production):
`DATABASE_URL=postgres://…/postgres node scripts/squash-migrations.mjs --through=<newest file>`, then again with `--write` once
the check passes. It carries `baseline_4` forward and lists the squashed files with a Storage, scheduler or role step: fold any it
lacks into it first. Push it alone, with no other migration: CI's `release` job records the four files, and the deploy follows.
The run log's prune (`kaizen-cron-log-retention`, daily at 03:41, seven days) is scheduled by the migration `…_cron_run_log_retention.sql`; at the next squash fold it into the new baseline's scheduler block by hand.

### Migrations that keep the busiest tables writable (code review FD4, D569)

A plain `create index` blocks every insert and update on its table until the index is built, and `add constraint … foreign key`
or `check` reads the whole table under a lock as strong: nothing while the tables are small, a checkout that stalls once they are
not. On the hot tables (`orders`, `order_lines`, `visits`, `products`, `product_variants`, `customers`, `carts`, `cart_lines`), a
migration therefore:

- builds an index `concurrently` (`create index concurrently if not exists …`), in a file of its own whose **first line is
  `-- kaizen:no-transaction`**. Postgres refuses a concurrent build inside a transaction, so `db-migrate.mjs` (and `db-setup.mjs`,
  `db-template.mjs` and the tests' PGlite) run such a file statement by statement, split at `--> statement-breakpoint`, outside a
  transaction, with `lock_timeout` 30 s and `statement_timeout` 30 min; its ledger row follows the last statement. When one fails,
  the statements before it stay applied (so each is written to run again: `if not exists`), and an index the file names that was
  left half built (invalid) is dropped again, concurrently, so the next run starts clean. `pnpm db:generate` writes a plain
  `create index`: move it out of the generated file into a custom one (`pnpm exec drizzle-kit generate --custom --name …`) with the
  marker and `concurrently`.
- adds a constraint `not valid` (it holds for new rows at once) and checks the old rows with `alter table … validate constraint …`
  in a later file, or later in a marked one, so the first lock is let go before the long read (validating lets writes through).

A table the same file creates is empty, and anything goes there. `src/db/migration-safety.scan.test.ts` holds every migration after
`20261111172838_sms_campaign_index.sql` to this; `src/db/migrate-no-transaction.int.test.ts` runs the marker on a scratch database.
It sits beside the other rule for a migration: add, never rename or drop in the same change.

An index written by hand is checked against the table's other indexes by `src/db/index-duplicates.test.ts`; when it replaces a declared one, the declared line leaves `src/db/schema.ts` in the same change.

A push to `main` takes one of two paths, chosen by reading production's ledger (the `pending` job runs
`db-migrate.mjs --status` on the checked-out commit):

- **No pending migration** (most pushes): the `pending` job calls the Vercel hook itself, right after reading
  the ledger, about two minutes after the push. The checks run beside it and report on the commit (GitHub emails a failure), but do not
  hold it back; run lint, typecheck and the tests before pushing, as the workflow in CLAUDE.md says.
- **A pending migration** (the push adds a file in `supabase/migrations`, or an earlier one never
  got applied): `release` waits for the `static`, `integration` and `e2e` jobs (side by side, about ten
  minutes once a runner is free), applies the files and then asks for the deploy, all in the GitHub
  environment `production`. A failed check
  or migration deploys nothing, so new code never meets the old schema.

The `integration` job runs the integration files in three shards, each on a database of its own seeded fresh; shard 1 first runs
`src/server/query-budget.int.test.ts` alone, which counts statements and rows read per scheduled job with 1 and with 20 stores, and the
sharded run leaves it out (bloat review step 1.10).
Every check and build of CI runs through `scripts/timed.mjs`, which prints its seconds, adds them to the run's summary and fails above the key's ceiling in `scripts/ci-budgets.json`
(empty until ten runs on `main` have been read; bloat review step 1.20); each job uploads its `timings.jsonl`, and a `timings` job adds the push's runner minutes.
A weekly workflow (`.github/workflows/ci-budgets.yml`) goes red when a ceiling is more than 25% above the median of the last ten runs.
In the `e2e` job the build is followed by `scripts/trace-sizes.mjs --check` and `scripts/route-budget.mjs` (what a function carries and
what a route loads: a breach fails the job with the figure, bloat review step 1.8), then by `scripts/render-modes.mjs` (which routes
are static, how many holes each has), and Playwright by
`scripts/server-budget.mjs` (statements per store page): both fail the job, so a push with a migration waits for them (bloat review step 1.11).

Either way the job then waits for production to run the commit (D389, `scripts/await-deploy.mjs`): it reads `/api/health` until the
`commit` there is this one, or a later one that includes it, and fails, saying what production reports, after twenty minutes. Once it is live it prints `Push to live: N s` (from `PUSHED_AT`, the push's time) and adds it to the run's summary. Set the
repository variable `PRODUCTION_URL` when the site's address is not `https://kaizenaflow.com`. It then requests the pages of `SMOKE_PAGES` (a repository variable; by default Kaizena Flow's home and the template store's Norwegian front page), one after the other and each twice: the job, not a visitor, pays the first cold draw, the log shows each page's status, bytes and cache headers, and a page that does not answer 200 fails the job (bloat review step 0.3).

Both need the repository variable `AUTO_MIGRATE` to be `true` (the `pending` job is off without it, and
every push then deploys only after the three checks, in `release`). A run on `main` is never cancelled by a newer push (it may be
mid-migration) and never waits for another: each has a concurrency group of its own, so a quick deploy is not
queued behind the previous push's checks. The next migration run applies everything still pending, so a
skipped intermediate commit loses nothing. Pushes that only change `*.md` or `docs/**` do not run CI or
deploy, except the docs portal's articles under `content/` (D442): they are part of the product, checked by the
unit tests and built into the deployment. Supabase's own history table gets a row per file too, where it can be written.

### One-time setup (owner)

(The step-by-step version, with the Vercel hook and the variables, was given in the conversation that
added this; the order matters: secret, baseline run, hook, then the two variables, then `vercel.json`.)

1. In the repository's *Settings → Secrets and variables → Actions* add the secret
   `PRODUCTION_DATABASE_URL`: Supabase *Connect → Session pooler* connection string for the
   `postgres` role (`postgres://postgres.<ref>:<password>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`).
   Use the session pooler: GitHub's runners have no IPv6 for the direct host and the transaction
   pooler (port 6543) cannot hold the advisory lock or a multi-statement transaction.
2. Settings → Environments → `production`: optionally add yourself as a required reviewer, which makes
   every production migration wait for a click.
3. Run *Actions → CI → Run workflow* once with `baseline_through` set to the newest file production
   already has (today `20261004152302_order_invoices_fixes.sql`, or later files already applied by hand).
   It records those files as applied without running them.
4. Set the repository variable `AUTO_MIGRATE` to `true` (a *variable*, see Deploying below).

From then on, a migration file committed to `main` reaches production after the tests pass.

### Deploying

Vercel's own build of `main` is switched off in `vercel.json` (`git.deploymentEnabled.main: false`;
pull-request previews are unaffected), and so is its build of the agents' working branches (`claude/**`, and `ccr-*`
from 2026-11-05): the
build prerenders from the database, and the preview environment has no `DATABASE_URL`, so every such build
failed (2026-10-23). Production gets new code from the `pending` and `release` jobs in
`ci.yml`, which call a Vercel deploy hook (paths above). The jobs are off until the repository variable
`DEPLOY_VIA_CI` is `true`; the secret `VERCEL_DEPLOY_HOOK_URL` is the hook (Vercel → project → Settings →
Git → Deploy Hooks, branch `main`). `AUTO_MIGRATE` and `DEPLOY_VIA_CI` are repository *variables*, not secrets
(the *Variables* tab: the workflow reads `vars.…`, and a secret of the same name is invisible to it).
*Actions → CI → Run workflow → redeploy* deploys the head of main by hand (to test the hook, or after a
failed deploy). A hook builds the head of `main` at the moment it is called, so two quick pushes make
two builds of the newest commit.

**The quick gate (D526).** A push without a migration no longer deploys the moment it lands. The `pending` job first runs
`pnpm lint`, `pnpm typecheck` and `pnpm test:smoke` (the unit tests of money, cart, checkout, discounts and VAT), in the same
job so there is no second runner to wait for, and asks for the deploy only when all three pass. Vercel's build skips the type
check (D378), so this is the only type check between a push and production. A failed gate deploys nothing and the job is red;
production stays on the commit it has. The full checks (`static`, `integration`, `e2e`, `hosts`, `signed-in`) still run beside
the deploy and report after it. A push with a migration waits for every one of them, `hosts` and `signed-in` included.

**A push of tests alone is not deployed (bloat review step 0.38).** After the gate and the head check, `pending` runs
`scripts/deploy-needed.mjs`, which reads the commit production reports at `/api/health`, lists the files that differ between it
and the pushed commit, and decides `deploy=false` only when there is at least one and every one is a test: `*.test.ts(x)`,
`*.spec.ts`, `e2e/`, `e2e-live/`, `test/` or `src/test/` (Vitest's setup files, which no deployed module imports). Scripts, the
workflow, `package.json`, configs, `supabase/` and `content/` are never tests. Any doubt means deploy: production's commit unknown,
the files not listable, or the same commit. The deploy and the wait steps are then skipped, and the next code push deploys the
tests-only commit with it. Because it compares with what production runs, a tests-only push after a failed deploy still deploys.
A push with a migration always deploys through `release`, which this does not touch.

**The head is checked before every deploy (D530).** The hook builds the head of `main`, which may be newer than the commit whose
run calls it. Just before the call, `pending` and `release` fetch the head and read the ledger against its migration files; a
head with a migration production has not had is not deployed by this run, and waits for its own run's `release`.

**A stale run leaves the deploy to the newer one (D710).** When several pushes land within minutes, every run that reached the
hook built the same head (three builds of `61dcec1` on 17 November 2026). After the head check, `scripts/newer-push.mjs` compares
the run's commit with the head: when the head is newer and the files between include one that starts a CI run (anything but
`*.md` and `docs/**`, with `content/**` back in, as the push trigger's paths), the run skips the hook and the wait. The newer
run deploys the head, which includes this commit, and its wait verifies it. A newer commit of words only (a decision claimed
by `claim-decision.mjs`) starts no run, so the run deploys as before; so does any doubt. If the newer run's gate fails, neither
commit is deployed and production stays where it was (before, the stale run deployed that unchecked head).

**A run that left its deploy makes sure it happens (D741).** On 17 November 2026 run 1544 passed, applied its migrations and left
the deploy to 1545, whose gate failed: production stayed hours behind and nothing said so. Now a run that defers (to a newer run, or to the head's
own release because the head brings a migration, as run 1551 did) runs `scripts/deploy-fallback.mjs`: it waits while newer push runs go on, and is done once `/api/health` reports this commit or a later
one that includes it. When every newer run has finished and production still lacks the commit, it deploys THIS commit (which
passed every check, and whose migrations are applied) through Vercel's API with its sha (the hook would build the failing head),
then `await-deploy.mjs` verifies it. It needs the repository secret `VERCEL_TOKEN` (a Vercel token for the team that may create
deployments); without it the job fails red saying so. Once it has waited 40 minutes (30 in `release`) it deploys this commit even
while newer runs go on (D793: runs take about 30 minutes, so with pushes every few minutes a newer run was always going and the wait
ran out, leaving production's code behind migrations already applied), unless a newer run's `pending` or `release` job is deploying
right then: that one it waits for, ten minutes more at most.

A deploy that should not have gone out: roll back in Vercel (*Deployments → the earlier one → Promote to
Production*, seconds) and push the fix.

Turning it off again: delete the `git` block from `vercel.json` (Vercel builds `main` itself again)
and set `DEPLOY_VIA_CI` to anything but `true`.

### Rules for migrations that ship this way

- Because the deploy waits for the migration, new code never meets the old schema, but the *old*
  code runs against the new schema from the moment the migration lands until the deploy finishes
  (minutes). Write migrations so the running code still works: add columns and tables, and never rename
  or drop in the same change as the code that stops using them; do the removal in a later push.
- A migration is plain SQL for a real Postgres: the production connection is not Supabase's migration
  tool, so `DROP` statements, triggers and multi-statement files run as written.
- Advisors (RLS, search path, indexes) are still checked by hand after every migration. A clean check is not written down. A new
  finding is written as a line in `docs/audits/psi-followups.md` with the migration's file name. The ledger
  `supabase_migrations.kaizen_files` is the record of what was applied and when; the Migration versions list in the decisions is
  frozen (4 October 2026) and nothing is added to it.
- A migration that adds a table, or an index or trigger on a hot table, raises the surface budget
  (`src/lib/surface-budget.scan.test.ts`); the scan runs with the full checks, so for a push without a migration it reports
  beside the deploy and does not hold it back.
- If a migration fails, the job is red, nothing from that file is applied and later files wait; fix it
  with a new file (or, when it never ran, edit it: only a file that is not in the ledger may change).
- A changed AI prompt or tool may go out beside a migration (D793). The agents' eval replay (D391) only warns while its recording is
  behind (an annotation on the run): the recording can only be made on production running the change, so failing on it held every
  release back. Once the change is live, record the eval on Platform → AI and commit its recording; while it matches, a replay that
  fails still fails the checks.

### Until `AUTO_MIGRATE` is on

Migrations are applied by hand as before (CLAUDE.md, Database). Add each applied file to the ledger so
CI will not repeat it:

```sql
INSERT INTO supabase_migrations.kaizen_files (file, checksum, applied_by)
VALUES ('<file>.sql', '<sha256sum of the file>', 'manual');
```

(only once the baseline has created the table).

## When main is red (D803)

A dozen sessions push to main at once and a run takes about 30 minutes, so the commit that broke a check is usually under several
others when its run fails, and every later run fails with it. CI's last job, `main-health` (`scripts/main-health.mjs`), keeps one
open GitHub issue labelled `ci-red` for the newest finished run on main. It lists the failed checks and the failing tests, and the
commits since the last green run with the Claude session of each one. It closes itself when the newest finished run is green.

- After a push, follow its run (GitHub tools: `actions_list` for `ci.yml` on main). While main is red, read the open `ci-red`
  issue (`list_issues` with the label) before starting more work on top of it.
- Your session is listed and a failing test touches what you changed: fixing it, or reverting your commit, is the next thing you
  push. Say so in a comment on the issue. A budget's number rises only as its row in `docs/rules/budgets.md` says.
- A failure that no commit in the range explains, or that passes on the next run, is a flake. Fix the test so it cannot fail that
  way (a fixed clock passed in, a wait on the real condition), with a note on the issue. Never skip, quarantine or retry it into
  green.
- Before pushing a change to the storefront, the builder or a budget's subject, run the checks CI would fail it on, not only lint,
  the type check and the unit tests. Run the spec of the area (`pnpm build`, then `pnpm exec playwright test e2e/<spec>`) and the
  area's integration tests against a local database (`bash scripts/ensure-postgres.sh`, `export DATABASE_URL=$(pnpm -s db:clone
  <lane> | tail -1)`, `pnpm test:int <files>`). Merge `origin/main` first, so what you test is what you push.

## The template database

`scripts/db-template.mjs` builds one database with every migration and the demo seed applied, and
makes copies of it with `CREATE DATABASE … TEMPLATE`:

```bash
bash scripts/ensure-postgres.sh                   # start the local Postgres if a restart left it down
pnpm db:template build                            # make or update the template (about 3 s here)
export DATABASE_URL=$(pnpm -s db:clone w2_lane | tail -1)   # a fresh copy, ready for tests and dev
pnpm db:template clone w2_lane --force            # replace a copy
pnpm db:template drop w2_lane
pnpm db:template list
pnpm db:template prune w1_ --yes                  # drop every database whose name starts with w1_
```

The server is `DATABASE_URL` (its database name is ignored; default
`postgres://postgres:postgres@localhost:5432/postgres`). The template is named after the checkout
(`kaizen_template_<hash of its path>`, or `TEMPLATE_DB`), so two worktrees with different
migrations never rebuild each other's. It remembers what it was built from in its database comment:
new migration files are applied on top of it; an edited file or a changed `seed.sql` rebuilds it.
A clone has the same tables, functions and rows as `node scripts/db-setup.mjs --seed` (checked
when this was written: 192 tables, 219 functions, the demo catalogue); CI still uses `db-setup.mjs`,
so the two paths stay checked against each other. Lanes: clone once per lane and reuse it; clone
again with `--force` when a migration of the lane changes.
