---
paths:
 - "src/server/**"
 - "src/app/api/**"
---

# Server code: how-to

- New reads, and every read that carries money, describe their row with `col` and go through `typedRows()`/`typedRow()`
  (`src/server/typed-rows.ts`: each row checked with zod; a `bigint` sum is `col.minor`, a `char(3)` code `col.currency`; a row of
  another shape throws `RowShapeError`, naming the column, never the value; rows another runner fetched, such as analytics'
  `setBased()`, through `checkedRows()`); `coalesce()` a sum that may meet no rows. A writer of `commerce.stores` refreshes the
  store's tag itself (`refreshTag(storeTag(slug))`, `refreshStoreById()`; `store-writers.scan.test.ts`), which does nothing
  outside Next. Older `execute<Row>()` reads move over when touched (`gift-cards-admin.ts` is the first); unchecked reads and `as
  unknown as` only fall (`ratchet.scan.test.ts`, code review 1.2). A write that picks a store's row by its id names the store too
  (`and store_id = …`, or the file's `owned()`); the ratchet lets the count of those that do not, per file, only fall (code review
  1.3). A read of a store's or the platform's rows filters with `owned(storeId)` (`src/server/owned.ts`), never `store_id is not
  distinct from`: the ratchet counts that wording per file and only lets it fall (D622).
- New server code logs through `log(level, event, fields, error)` (`src/server/log.ts`: one JSON line, ids and counts, never a
  person's data or a secret, D400: no `console.error` is left in `src/server` but `log.ts`). Every cron route has a `maxDuration`
  and runs inside `trackedRoute()`/`tracked()`, and the five-minute dispatcher runs each job through `runJobs()`
  (`src/server/cron-runs.ts`): each run is kept in `commerce.cron_jobs`, a job that throws is logged and the others finish, and
  the platform home and Usage and limits say which job is late or failing (`src/lib/cron-health.ts`); `cron-routes.scan.test.ts`
  holds new routes to it.
