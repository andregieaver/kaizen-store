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
- `MIGRATE_EXPECT` (the project ref) must appear in the connection string, so a wrong secret never
  reaches another database;
- the ledger must have rows before anything is applied (the baseline below), so a first run can never
  replay history.

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

Both need the repository variable `AUTO_MIGRATE` to be `true` (the `pending` job is off without it, and
every push then deploys only after the three checks, in `release`). A run on `main` is never cancelled by a newer push (it may be
mid-migration) and never waits for another: each has a concurrency group of its own, so a quick deploy is not
queued behind the previous push's checks. The next migration run applies everything still pending, so a
skipped intermediate commit loses nothing. Pushes that only change `*.md` or `docs/**` do not run CI or
deploy. Supabase's own history table gets a row per file too, where it can be written.

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
pull-request previews are unaffected). Production gets new code from the `pending` and `release` jobs in
`ci.yml`, which call a Vercel deploy hook (paths above). The jobs are off until the repository variable
`DEPLOY_VIA_CI` is `true`; the secret `VERCEL_DEPLOY_HOOK_URL` is the hook (Vercel → project → Settings →
Git → Deploy Hooks, branch `main`). `AUTO_MIGRATE` and `DEPLOY_VIA_CI` are repository *variables*, not secrets
(the *Variables* tab: the workflow reads `vars.…`, and a secret of the same name is invisible to it).
*Actions → CI → Run workflow → redeploy* deploys the head of main by hand (to test the hook, or after a
failed deploy). A hook builds the head of `main` at the moment it is called, so two quick pushes make
two builds of the newest commit.

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
- Advisors (RLS, search path, indexes) are still checked by hand after a migration that adds tables
  or functions; record the result in `docs/decisions.md` as before.
- If a migration fails, the job is red, nothing from that file is applied and later files wait; fix it
  with a new file (or, when it never ran, edit it: only a file that is not in the ledger may change).

### Until `AUTO_MIGRATE` is on

Migrations are applied by hand as before (CLAUDE.md, Database). Add each applied file to the ledger so
CI will not repeat it:

```sql
INSERT INTO supabase_migrations.kaizen_files (file, checksum, applied_by)
VALUES ('<file>.sql', '<sha256sum of the file>', 'manual');
```

(only once the baseline has created the table).

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
