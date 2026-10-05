# Running a parity wave

One wave is one feature of `docs/parity-plan.md` section 3 (as D153 or D152 were), run by the saved workflow
`.claude/workflows/parity-wave.js`. It builds the feature and moves the tracker rows (`docs/parity/rows`, contract in
`docs/parity/README.md`) from what was read in the code and tests, never to reach a number. The lead (you or the main
session) starts it, applies what only the lead may apply, and ships.

## Start it

Call the Workflow tool with `name: "parity-wave"` and `args` as real JSON (not a string):

```json
{
  "wave": 1,
  "title": "VAT depth and reporting",
  "spec": "docs/vat.md",
  "rowIds": ["international.eu-vat-depth", "checkout.vat-rates-by-category"]
}
```

| Arg | Meaning |
|---|---|
| `wave` | 0 to 9, the plan's wave number. |
| `title` | What this run builds, a few words. |
| `spec` | A `docs/*.md` path. The first agent writes this contract; every later agent builds from it. |
| `rowIds` | Tracker rows this run closes (ids from `docs/parity/rows/*.json`). Choose rows one feature closes together. |
| `surfaces` | Optional `[{key, prompt}]`. Default: `shopper`, `admin`, `analytics-and-ai`. Give your own to split or merge areas (for example a platform admin area). A surface with nothing to build says so. |
| `lenses` | Optional `[{key, prompt}]` of adversarial reviewers. Default: `law`, `security`, `money`. |

Phases: **Spec** (contract from the rows, the plan and CLAUDE.md) then **Foundation** (schema, migrations, DB rules,
pure libraries) then **Surfaces** (the server first, then the surface agents in parallel) then **Gates** (lint,
typecheck, unit, integration on a fresh database, `db:check`, build, e2e) then **Review** (the lenses, findings
reproduced before they are reported) then **Fix** (each finding with a regression test) then **Re-rate** (the rows are
updated, then a second agent tries to show each raised row is still short, then `pnpm parity:write` once that script
exists).

The run **stops after the Spec** and returns `{ stopped: true, reason }` when the spec finds an owner decision
(plan section 5, bucket C) or a missing agreement that blocks the work. Decide, then start again (the spec file stays; the new run's Spec agent
reads and updates it).

Agents never commit, never push and never touch production (no Supabase or Vercel tools). Every agent uses its own
database (`w{wave}_{spec name}_{label}`), never `pkill -f` or `pgrep -f`, runs builds and e2e detached with `nohup` and
polls them (the container can restart), and e2e uses port 3000, so one at a time. These rules are in the workflow's
prompts; they are the D153 lessons.

## After a restart or a pause

Relaunch with `resumeFromRunId` and the same args (or `scriptPath` of the persisted copy):

```json
{ "name": "parity-wave", "args": { "...": "the same args" }, "resumeFromRunId": "<runId from the first result>" }
```

The longest unchanged prefix of agent calls returns from cache and the first changed or unfinished call runs again.
The script is deterministic (prompts depend only on args and earlier results), so the same args give a full cache hit;
editing the script or the args re-runs from the first changed prompt. A surface agent that was cut off finds part of
its work in the working tree and is told to finish it, not redo it. Before diagnosing an empty result read the run's
`journal.jsonl`. After a container restart agents recreate their own databases.

## What the lead does after the run

The result holds every agent's report (`spec`, `found`, `server`, `surfaces`, `gates`, `findings`, `fixed`, `rerate`,
`skeptic`). Read the Gates and Fix reports, then:

1. **Re-verify from scratch.** The fixer's work, and the Gates run, are not taken on trust: on a fresh database run
   `pnpm lint`, `pnpm typecheck`, `pnpm test`, `node scripts/db-setup.mjs --seed` then `pnpm test:int`, `pnpm db:check`,
   `pnpm build` and the e2e (build and e2e detached, polled). Look at `git status` for files nobody owns.
2. **Migrations.** Do not apply them by hand: the push applies each new file in `supabase/migrations` to production
   through CI (`docs/ci-migrations.md`: the push waits for every check, then `migrate`, then the deploy), over a direct
   Postgres connection, so statements with `DELETE` or `DROP` inside functions run as written and the old
   "owner statements" step is gone (the Supabase migration tool, which cancelled them, is no longer the way in).
   Keep the agents' `ownerStatements` only for what is not a migration. After the deploy, check the security and
   performance advisors and fix what the migration caused. Migrations stay additive (the old code runs against the
   new schema until the deploy ends).
3. **Record.** Add the decision row (D154 onward) and the migration versions to `docs/decisions.md`; add the CLAUDE.md
   bullet (drafts are in the `rerate` report); update the plan comparison (D132) and the AI manager's tools and skills
   when the wave added a feature that belongs there.
4. **Legal texts.** List every consumer legal text the wave added (spec section "Needs human legal review") in the
   hand-over. They are hand-written and unreviewed; a row that rests on them is not Full until a person has read them.
5. **Re-rate.** Check the `rerate` and `skeptic` changes against the row files (history entry for every changed rating,
   evidence paths exist), run `pnpm parity:write` if the agents could not (and `pnpm parity:check`), and commit the
   regenerated `docs/shopify-parity.md` with the rows. Rows in bucket B, C or D stay short of Full until the approval,
   decision or evidence exists.
6. **Push.** Commit and push to `main` (it deploys to production) with lint, typecheck and tests green. Only one wave
   edits the shared registries (nav, admin map, i18n, `COPY_RULES`, plan features) at a time; run two waves in parallel
   only when their file areas are disjoint (`docs/parity-plan.md` section 4).

## Writing good args

- Pick rows that one spec closes; list all of them, or the Re-rate step will not touch the rest.
- A wave that changes ratings does not change weights.
- Keep `spec` unique per run (for example `docs/vat.md`, `docs/invoices.md`); it also names the agents' databases.
- Custom `surfaces` and `lenses` replace the defaults completely, so repeat a default you still want.
