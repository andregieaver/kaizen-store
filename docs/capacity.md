# Capacity: usage, limits, scaling and hosting levels

Status: **phases 1 and 2 built; 3 and 4 built where no owner decision was needed; 5 is a proposal** (D314). This file is the
contract, and every phase below is written so that it can be built step by step by someone who has not seen the conversation it came
from. Read sections 0 to 2 before you
start any step, and read the step in full before you write code for it.

| Phase | What it gives | Status |
|---|---|---|
| 1 | Measuring what each store uses (storage, traffic, emails, AI, catalogue size), shown read-only | built; the drain waits on the owner |
| 2 | Limits per plan, owner and store; enforcement of the costly actions; alerts | built; the four plans' limits seeded (2026-10-23) |
| 3 | Protection inside the shared setup: timeouts, per-store budgets, firewall, read replica | 3.2, 3.4 (off) and 3.5 built; 3.1 and 3.3 wait on the owner |
| 4 | Peaks and reliability: peak calendar, checkout queue, load tests, SLOs, restore drills | 4.1, 4.3 and 4.5 built; 4.2 and 4.4 wait on the owner |
| 5 | Hosting levels: cells, moving a store, the first Dedicated store | spike written (`docs/cells.md`), waiting on the owner |
| 6 | Private cloud for one customer | planned (only on a signed customer) |

Update this table, and the step's own *Status* line, in the same commit that finishes a step.

### What the build changed from the plan

These are decisions made while building. Where this file and the code disagree below, the code and this list win.

- **Bandwidth is not measured.** Vercel's documented log-drain schema (vercel.com/docs/drains/reference/logs, read 2026-10-23) carries
  the request's host, path, status and time, but no response size. The drain gives `requests` and `server_errors`; `egress_bytes` stays
  a metric and a soft limit, and shows *Not measured yet* (never zero) until a source for it exists, such as Vercel's usage API per
  project, or per host once the cells exist.
- **One request is counted once** per drain batch, by its `requestId` (a function logs several lines per request).
- **Metric and limit lists in checks** are written by `sqlList()` from the TypeScript lists, as the schema does elsewhere, so
  `pnpm db:check` holds them together; no separate test was needed.
- **The storage sum is a plain SQL function**, not `SECURITY DEFINER`: no migration in this repository uses one, and the app's role
  already reads `storage.objects` as the media migration did.
- **Limits are read through a one-minute per-instance memo** (`storeLimits()`, `forgetLimits()`), not `'use cache'`: they are read in
  actions, routes, jobs and `aiFor()`, where a cache scope is not always there. The instance that changes a limit forgets it at once.
- **The words are a new admin catalogue `capacity`** (`src/lib/admin-messages/capacity.{en,nb}.ts`), not `billing`, because the
  owner's page, the platform's page and the Billing page all read them. Refusals written by server modules are English (the convention
  for a module's own words), from the same catalogue.
- **Owners' warning emails are English**, in `src/lib/usage-emails.ts`, as the store-closure emails to owners are; their kinds
  (`usage.near`, `usage.reached`, `capacity.upcoming`) are in `EMAIL_KINDS`. No change to `email-text.ts` was needed.
- **The plans' limits have a page of their own**, Plans → Limits (`/admin/platform/plans/limits`), so the plans editor stays simple.
- **The public plan cards** show the limits with words in `m.plans.limitNames` and `m.plans.unlimited` (nb, sv, da and en by hand).
- **The control center's item** reads the stores where the member may read billing (`billing:read`), not the owner role, as the
  permissions scan requires; the item itself is the owner's.
- **AI on Kaizena Flow's key** is checked in `aiFor()` only when the store's plan sets an AI limit, so nothing changes until one is set.
- **The broadcast check** counts the marketing emails written this month and refuses a send larger than what is left. Recipients of a
  send still under way are not yet emails, so two sends started in the same minute could together pass the limit by one batch.
- **Automations** at the limit are claimed with the outcome `suppressed` and never sent later.
- **Budgets (3.2)**: recommendations, forms and visit counting already had their own; only search type-ahead had none, and now has
  `takeBudget()`. A failure to count allows the request.
- **The read replica (3.4)** is used by the analytics pages' data modules through `setBasedReplica()`; `replica-readers.scan.test.ts`
  lists them. Tax reports, inventory and `setBasedSnapshot()` stay on the primary.

### Waiting on the owner

1. ~~The numbers per plan~~: decided 2026-10-23 (section 9, question 1), seeded by migration `20261023122903_capacity_plan_limits`.
   Overage (question 2): decided, only the offer of a bigger plan; nothing to build.
2. Creating the Vercel log drain (step 1.4, settings below) and setting `USAGE_DRAIN_SECRET` (and `USAGE_DRAIN_SAMPLE_RATE` if
   sampling) in Vercel's production environment.
3. Statement timeouts (3.1), the firewall (3.3), a read replica and `READ_DATABASE_URL` (3.4), the checkout queue (4.2), service levels
   and the status page (4.4), and confirming point-in-time recovery (4.5).
4. Accepting, changing or rejecting `docs/cells.md` (5.0).

---

## 0. How to use this plan

### 0.1 Read first

1. `CLAUDE.md` and `AGENTS.md` (the repository's rules; they win over anything here if they disagree, and then say so in
   this file).
2. `docs/ci-migrations.md` (how migrations reach production).
3. `docs/platform.md` (stores, hosts P6/P7, plans).
4. The files named in the step you are on. Every file and function named below exists today unless the step says
   *new*. If one does not exist, stop and search for what replaced it (`grep -rn`), and fix this file.

### 0.2 Words used in this plan

| Word | Meaning |
|---|---|
| **metric** | Something measured per store: storage bytes, requests, emails sent and so on. A *gauge* is a level measured at a moment (storage); a *counter* is a sum over time (requests). |
| **usage** | The value of a metric for a store over a day or a month. |
| **limit** | The most a store (or an owner) may use of a metric. `null` means unlimited. |
| **hard limit** | A limit that makes an action be refused (an upload, an invitation). |
| **soft limit** | A limit that only warns. Storefront traffic is always soft: a shop is never taken offline for being busy. |
| **override** | A limit set by a platform admin for one store or one owner, above or below the plan's. |
| **cell** | One complete running copy of Kaizena Flow: a Vercel project and its own Supabase project. Today there is one cell. |
| **level** | What the owner buys: *Shared*, *Dedicated* or *Private cloud*. The level decides which cell a store lives in. |

**Naming rule.** Never use the word `hosting` or `host` in a new code name, table, address or text for this
work: `/admin/hosting/{store}`, `commerce.hosts` and `src/server/hosts.ts` are D71's outside hosts of stays and
rentals. The code names here are `usage`, `limits`, `capacity` and `cells`. In the interface, say *Usage and limits*
and *Shared*, *Dedicated*, *Private cloud*.

### 0.3 Rules for every step

Check each of these before you push. Most of them are held by a test that fails if you forget.

- **Before pushing:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm test:int` when the step changes SQL or
  server code that reads the database (needs `DATABASE_URL` and `node scripts/db-setup.mjs --seed`). Commit and push
  as `CLAUDE.md`'s *Workflow* says.
- **Schema:** change `src/db/schema.ts`, then `pnpm db:generate`. Functions, triggers, checks Drizzle cannot express
  and `pg_cron` schedules go in a custom migration (`pnpm exec drizzle-kit generate --custom --name <name>`). Every new
  table gets `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` with the comment *Row-level security, no policy: the commerce
  schema is private to the server* (see `supabase/migrations/20261016153126_theme_shots.sql`). `pnpm db:check` must
  pass. **Never apply a migration to production by hand.** After the deploy, record the migration versions in
  `docs/decisions.md` (Migration versions) and check the Supabase advisors (project `ybsozesfuxuitoacntfo`).
- **Database rules get a test** in `src/db/commerce.test.ts` (PGlite applies every migration).
- **A new store-owned table** (one with `store_id`) needs:
  - an entry in `COPY_RULES` (`src/lib/store-copy-rules.ts`). Usage rows are `derived`; overrides and peak events
    are `never`;
  - an entry in `PERSONAL_DATA` or `NOT_PERSONAL` (`src/lib/personal-data.ts`). Everything planned here is
    `NOT_PERSONAL`, and must stay so;
  - a retention rule if it grows: a `prune…()` in the daily cron (`src/app/api/cron/subscription-reminders/route.ts`)
    that never throws.
- **A new admin page** needs:
  - one nav item, in `src/lib/store-nav.ts`, `src/lib/owner-nav.ts` or `src/lib/platform-nav.ts`;
  - an `ADMIN_PAGES` entry (`src/lib/admin-map.ts`), with its Norwegian title in
    `src/lib/admin-messages/pages.nb.ts` and its nav word in `nav.nb.ts`;
  - a permission guard: `requirePermission(slug, key)` for a store page, `requirePlatformAdmin()` for a platform
    page, and the owner checks the other `/admin/account/…` owner pages use;
  - its words in an admin catalogue (`src/lib/admin-messages/{area}.en.ts` and `.nb.ts`, read with `adminText()` or
    `useAdminText()`). Never write English into a component: `admin-strings.scan.test.ts` counts it;
  - the admin components (`PageHeader`, `Card`, `List`, `KpiTile`, `ScoreBar` and the rest in
    `src/components/admin/ui/`), the colour roles, and no `max-w-*xl` on a page's root.
- **A new audit action** needs an area in `AUDIT_AREAS` (`src/lib/audit.ts`). Its entry holds ids and numbers, never
  a person's data.
- **A new email kind** goes in `EMAIL_KINDS` (`src/lib/personal-data.ts`), with words in `src/lib/email-text.ts`
  (four hand-written languages).
- **Environment variables** are added to `src/lib/env.ts` and validated when used, never at import.
- **Server-only modules** start with `import "server-only";`.
- **Numbers are data.** No limit's number is written in code: plans' limits are rows the platform admin edits. Code
  holds only a metric's unit and kind and how its limit is enforced.
- **Templates and demo stores are never limited.** Starters, templates, frozen copies and theme workspaces
  (`s.is_template or s.starter`) get unlimited from `limitFor()` but are still measured.
- **Homer and Lisa** (`CLAUDE.md` *Conventions*):
  - the owner's view is a bar per limit ("3.2 GB of 10 GB") and one button (*See plans*);
  - the daily figures, the history and the CSV are one step away;
  - a refusal says what happened and the one thing to do, with the link.
- **Name:** the platform is *Kaizena Flow* in every string (`brand.scan.test.ts`).

### 0.4 Owner gates

Some steps say **Owner gate**. Stop there and ask the owner, giving the question and your recommendation. Do not
guess past a gate. The open questions are collected in section 9.

---

## 1. What was decided (D314)

1. **One platform, three levels of isolation**, not three hosting products. Owners choose a plan. A plan has a level
   (*Shared* by default). The level decides how isolated the store's database and compute are. Same code, same admin,
   same addresses.
2. **Measure first, limit second.** Phase 1 only measures and shows. Nothing is refused until phase 2.
3. **Never take a paying store's storefront offline for traffic.** Traffic and bandwidth limits are soft: they alert
   and offer a plan. Hard limits apply only to actions that cost money or space (uploads, products, staff, stores,
   domains, marketing email, AI on Kaizena Flow's key).
4. **Transactional and legal emails are never limited**: order confirmations, invoices, credit notes, the withdrawal
   acknowledgement, security emails.
5. **Abuse is stopped at the edge for every level** (firewall, BotID, rate limits by visitor), separately from plans.
6. **Resolution order of a limit:**
   1. the store's override;
   2. the store's plan, while the store is on it;
   3. the platform default;
   4. if none of these is set, unlimited.

   An owner-wide limit (how many stores an owner may have) uses the owner's override, then the best plan among the
   stores they own, then the platform default.
7. **The database is the shared resource to protect.** Vercel already scales functions per request. Scaling work goes
   to Postgres: timeouts, budgets, a read replica for heavy reads, and finally cells.
8. **Data stays in the EU** (as every vendor in `CLAUDE.md`). Traffic records keep no IP address, user agent, path or
   query string.

---

## 2. Where the code is today (facts the plan builds on)

- **Plans.** `commerce.plans`, `plan_prices` and `store_billing` are in `src/db/schema.ts` (around lines 1570–1730).
  `getStoreBilling()` and `storeFeeBps()` are in `src/server/billing.ts`, and their rule for "the plan while the store
  is on it" is in `toBilling()`. Reuse that rule; never write a second one.
- **The plan comparison.** `commerce.plan_features` and `plan_feature_grants` (`src/lib/plan-features.ts`,
  `src/server/plan-features.ts`) only *describe* plans and enable nothing. Public plan cards come from
  `getPublicPlans()` in `src/server/public-plans.ts`, cached under `PLANS_TAG`.
- **Files.**
  - `commerce.media` has `size_bytes` for every library file. Uploads are in `src/server/media.ts`:
    `uploadProductImage()`, the signed video upload (`VIDEO_MAX_BYTES`), field files, digital files and avatars.
    `uploadToLibrary()` and `registerVideo()` are in `src/server/media-library.ts`.
  - Bucket constants:
    - `media.ts`: `page-videos`, `field-files`, `digital-files`, `avatars`;
    - `invoice-storage.ts`: `documents`;
    - `data-job-store.ts`: `imports` and `exports`.
  - Paths start with the store id (`{storeId}/…`, or `platform/…` for Kaizena Flow), except avatars (per person).
    `supabase/migrations/20260928111304_media_rules.sql` shows how SQL reads `storage.objects` only where it exists.
- **Emails.** Every email is a row of `commerce.email_messages` (`store_id`, `kind`, `status`, `created_at`, unique
  `idempotency_key`), sent by `sendEmail()` in `src/server/email.ts`. `notifyOwners()` in `src/server/store-closure.ts`
  is the pattern for emailing a store's owners once each.
- **AI.** Every model call is a row of `commerce.ai_usage` with its store. Cost is priced in SQL only through
  `costMicrosSql` (`src/server/ai-price-sql.ts`). `aiFor(storeId, { feature })` (`src/server/ai.ts`) returns `null`
  for "no AI", and every feature already carries on without AI.
- **Rate limits.** `commerce.chat_usage` is a counter table of `(store_id, bucket, window, count)`. `takeEcbSlot()` in
  `src/server/ecb-rates.ts` is the pattern: insert on conflict add one, returning the count.
- **Scheduled jobs.** Supabase's `pg_cron` calls routes under `src/app/api/cron/` with a bearer token checked by
  `cronAuthorised()` (`src/server/cron-auth.ts`). The daily job is `subscription-reminders` and the five-minute
  dispatcher is `cart-reminders`; new heavy work gets a route of its own. The theme-shots migration above shows how a
  schedule is made.
- **The database client.** `src/db/client.ts`: node-postgres through Supabase's transaction pooler, `max: 5` per
  instance. `readDb()` retries cached reads once. `setBased()` (analytics) runs heavy reads in a read-only transaction.
- **Hosts and requests.**
  - Each store has its own host (P7, `src/lib/store-hosts.ts`) and possibly domains of its own
    (`src/server/domains.ts`).
  - `src/proxy.ts` answers address shapes, redirects and A/B tests, and reads store facts at most every few seconds.
  - `storeOfHost()` is in `src/lib/ab-routing.ts`.
- **The platform's admin pages** are under `src/app/admin/(gated)/platform/`; plans are at `…/platform/plans`, and
  one store is at `…/platform/stores/[store]`. **The owner's pages** are under `src/app/admin/(gated)/(owner)/account/`.
  **A store's Billing page** is `src/app/admin/(gated)/[store]/billing`. The admin catalogue `billing`
  (`src/lib/admin-messages/billing.{en,nb}.ts`) already exists.
- **There are two `formatBytes()` functions** (`src/lib/image-size.ts`, `src/lib/data-admin.ts`). Use one of them; do
  not add a third.

---

## 3. Phase 1: measuring

Goal: every store's usage is measured every day and shown read-only to the platform, to owners and on each store's
Billing page. Nothing is refused. Phase 1 can be built and shipped in five steps, each its own commit.

### Step 1.1: the metrics catalogue (pure)

Status: built.

*New* `src/lib/usage-metrics.ts`, no imports from server code, no zod:

```ts
export type MetricKind = "gauge" | "counter";
export type MetricUnit = "bytes" | "count" | "micros"; // micros: millionths of a US dollar, as ai-cost.ts
export type MetricSource = "storage" | "database" | "traffic" | "email" | "ai";

export const USAGE_METRICS = {
  storage_bytes:    { kind: "gauge",   unit: "bytes",  source: "storage" },
  products:         { kind: "gauge",   unit: "count",  source: "database" }, // products not archived
  staff_seats:      { kind: "gauge",   unit: "count",  source: "database" }, // active members, collaborators in time
  custom_domains:   { kind: "gauge",   unit: "count",  source: "database" },
  requests:         { kind: "counter", unit: "count",  source: "traffic" },
  egress_bytes:     { kind: "counter", unit: "bytes",  source: "traffic" },
  server_errors:    { kind: "counter", unit: "count",  source: "traffic" }, // 5xx answers
  emails:           { kind: "counter", unit: "count",  source: "email" },   // every email the store's row names
  marketing_emails: { kind: "counter", unit: "count",  source: "email" },   // broadcasts and automations only
  ai_cost_micros:   { kind: "counter", unit: "micros", source: "ai" },      // Kaizena Flow's key only (source 'platform')
} as const satisfies Record<string, { kind: MetricKind; unit: MetricUnit; source: MetricSource }>;

export type UsageMetric = keyof typeof USAGE_METRICS;
export const USAGE_METRIC_IDS = Object.keys(USAGE_METRICS) as UsageMetric[];
```

Pure helpers in the same file:

- `monthFigure(rows: { day: string; value: number }[], metric)`: for a gauge, the value of the latest day; for a
  counter, the sum. Days are UTC dates `YYYY-MM-DD`. **Metering is in UTC days and calendar months**, and the
  interface says "this month (UTC)" in Lisa's details only.
- `monthOf(date: Date): { start: string; end: string }` (first and last day, UTC).
- `MARKETING_EMAIL_KINDS`: the email kinds that count as marketing. Find them in `EMAIL_KINDS` and in
  `src/server/broadcasts.ts` and `src/server/automations.ts` (search for `sendEmail({ kind:`). List every kind
  explicitly; never use a prefix match.

Test `src/lib/usage-metrics.test.ts`:
- `monthFigure` for a gauge (latest day wins, even when days are out of order) and a counter (sum);
- an empty month gives `0`;
- every `MARKETING_EMAIL_KINDS` entry is in `EMAIL_KINDS`.

### Step 1.2: the usage table

Status: built (migrations `20261023104648_capacity`, `20261023104720_capacity_rules`).

*New* table in `src/db/schema.ts`, beside `chatUsage`:

```ts
/**
 * What a store used, per UTC day and metric (D314, docs/capacity.md): gauges as measured that day, counters summed over it.
 * `store_id` null is Kaizena Flow's own site. Written only by src/server/usage-meter.ts and the traffic drain route; kept 25 months.
 */
export const storeUsageDaily = commerce.table(
  "store_usage_daily",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    metric: text("metric").notNull(),
    value: bigint("value", { mode: "number" }).notNull().default(0),
    /** True when the value is scaled up from a sample (traffic with a drain sampling rate below 1). */
    estimated: boolean("estimated").notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("store_usage_daily_key").on(t.storeId, t.day, t.metric).nullsNotDistinct(),
    index("store_usage_daily_day_idx").on(t.day),
    check("store_usage_daily_value", sql`${t.value} >= 0`),
    check("store_usage_daily_metric", sql`${t.metric} in (/* every USAGE_METRIC_IDS, written out */)`),
  ],
);
```

- Write the metric check's list out by hand, and add a unit test that reads `USAGE_METRIC_IDS` and the generated
  migration's check, so the two cannot drift. Look for an existing test that compares a check constraint with a
  TypeScript list (search `src/db` for `check(` and `IN (`) and follow it.
- `COPY_RULES`: `store_usage_daily: derived("Measured again by the new store's own jobs.")`.
- `NOT_PERSONAL`: `store_usage_daily: "Counts and bytes per store and day; no person, address, path or query."`.
- *New* `pruneUsageDaily()` in `src/server/usage-meter.ts` deletes rows older than 25 months. Call it from the daily
  cron route; it never throws.

### Step 1.3: measuring what the database knows

Status: built.

*New* `src/server/usage-meter.ts` (`import "server-only";`):

- `measureDay(day: string): Promise<{ stores: number; written: number }>` writes, for every store
  (templates and starters too) and for `store_id` null:
  - `storage_bytes`: the sum, per store, of the objects in the store buckets. *New* SQL function
    `commerce.storage_bytes_by_store()` in a custom migration (`SECURITY DEFINER`, `SET search_path = ''`, owned by
    the migration role, `REVOKE ALL … FROM public`):
    - It returns `(store_id uuid, bytes bigint)` from `storage.objects` where `bucket_id` is one of `product-media`,
      `page-videos`, `field-files`, `digital-files`, `documents`, `imports` and `exports`, grouped by
      `split_part(name, '/', 1)` joined to `commerce.stores.id`. Rows under `platform/` go to `store_id` null.
    - Where `storage.objects` does not exist (PGlite, CI), it returns the sum of `commerce.media.size_bytes` per store
      instead. Copy the `to_regclass('storage.objects') IS NULL` guard of the media migration.
    - First check each bucket's path really starts with the store id: read every upload function in
      `src/server/media.ts`, `invoice-storage.ts` and `data-job-store.ts`. Write what you found as a comment in the
      migration, and leave out any bucket that does not.
  - `products`: products whose `status` is not `archived` (check the `product_status` enum for the exact values).
  - `staff_seats`: members not disabled, and collaborators whose `expires_at` has not passed.
    `store-members-expiry.test.ts` holds the rule; read it and use the same condition.
  - `custom_domains`: the store's rows in its domains table (find it from `src/server/domains.ts`).
  - `emails` and `marketing_emails`: `email_messages` rows of that UTC day per store, by `created_at`. Count every
    status except one that never reached a provider (check `emailStatus` for the values, and write the reason beside
    the condition).
  - `ai_cost_micros`: from `ai_usage` of that day where `source = 'platform'`, priced with `costMicrosSql`. Unpriced
    calls are counted as zero, and the platform page shows them as "No price" through the existing `unpricedSql`, as
    the AI usage pages do.
- Each metric is one `insert … select … on conflict (store_id, day, metric) do update set value = excluded.value,
  updated_at = now()`. Run it inside `setBased()` style limits (a read-only part first, then the write), and never
  loop per store in TypeScript.
- **Never write a traffic metric here** (`requests`, `egress_bytes`, `server_errors`): those are the drain's (step
  1.4), and this job must not overwrite them.

*New* route `src/app/api/cron/usage/route.ts`, copying the shape of `src/app/api/cron/theme-shots/route.ts`:
- `await connection()`, then `cronAuthorised()`;
- `measureDay(today)` for gauges and `measureDay(yesterday)` again for counters, so a late email or AI row is counted;
- answers JSON with the counts and `Cache-Control: no-store`.

Custom migration `usage_schedule`: `cron.schedule('kaizen-usage', '17 3 * * *', …)` calling
`https://kaizenaflow.com/api/cron/usage`, guarded exactly like the theme-shots migration.

Tests:
- `src/server/usage-meter.int.test.ts`. Seed a store with two media rows, three products (one archived), two members
  (one disabled), three emails of yesterday (one marketing kind) and one AI row with a price. Then check:
  - `measureDay()` writes the expected values;
  - running it twice gives the same values;
  - a traffic row written before is left as it was.
- `src/db/commerce.test.ts`: `storage_bytes_by_store()` exists and returns the media fallback on PGlite.

### Step 1.4: traffic from Vercel's log drain

Status: built; the drain itself is not created yet. **Owner gate**: a Vercel log drain has a cost per GB and needs the team's plan to
allow it (section 9, question 3).

**What the spike found (2026-10-23, vercel.com/docs/drains/reference/logs and vercel.com/docs/drains/security):**

| Field | Where | Read as |
|---|---|---|
| `proxy.host` | each request's log | the host, lower-cased, without a port |
| `proxy.path` | the same | only to find `/s/{slug}/` on Kaizena Flow's own host; never kept |
| `proxy.statusCode` (else `statusCode`) | the same | a 5xx is a server error |
| `proxy.timestamp` (else `timestamp`) | the same | its UTC day |
| `requestId` (else `id`) | every line a request logs | one request counted once per batch |
| `environment` | the same | only `production` is counted |

The body is a JSON array or NDJSON. The signature is the header `x-vercel-signature`, the body's HMAC-SHA1 in hex with the drain's
secret. **No response size is documented**, so bandwidth is not read from the drain (see *What the build changed*).

**The drain to create (the owner's action):**
- the project: the production Vercel project;
- environments: production only;
- sources: `static`, `lambda`, `edge` and `external` (pictures and scripts are requests too);
- the delivery: JSON to `https://kaizenaflow.com/api/usage/drain`;
- the secret: a long random string, also set as `USAGE_DRAIN_SECRET` in Vercel's production environment;
- the sampling: 100 % to start. If it is lowered, set `USAGE_DRAIN_SAMPLE_RATE` to the same share (for example `0.25`); the figures are
  then marked estimated.

**Spike first (write down what you find in this section before you write code):**
1. Read Vercel's documentation on log drains (the Vercel MCP `search_vercel_documentation` tool, or vercel.com/docs).
   Find:
   - the payload format (JSON array or NDJSON);
   - the signature header and how it is computed (HMAC over the raw body with the drain's secret);
   - the verification step when the drain is created;
   - which fields carry the request's host, status code, response size in bytes, cache status and timestamp;
   - the sampling setting.
2. Confirm that the drain is delivered from Vercel's region nearest `dub1`, and that the data stays in the EU in
   transit and at rest with us. It stays with us because we keep only counters.
3. Write the field names you will read in a table here, with the documentation's address and the date you read it.

**Build:**

- *New* pure `src/lib/usage-drain.ts`:
  - `parseDrainBody(text: string): DrainEntry[]` takes only `{ host, status, bytes, at }` from each entry and drops
    every other field at once. Never keep or log an IP address, user agent, path, query string, referrer or cookie.
  - `trafficTotals(entries, storeOf: (host: string, path: string) => StoreKey | null, sampleRate: number)` returns
    one total per `(storeKey, UTC day)` of `{ requests, egressBytes, serverErrors }`, scaled by `1 / sampleRate`, with
    `estimated` set when `sampleRate < 1`. `storeOf` may look at the path only to read `/s/{slug}/` from Kaizena
    Flow's own host; the path is never returned or kept.
- *New* `src/server/usage-traffic.ts`:
  - `storeOfHostCached()` resolves a host to a store id: the store domain's `{slug}.{domain}` through `storeOfHost()`,
    and stores' own domains from the domains table, read at most once a minute per instance (copy how
    `storeRequestAnswer()` keeps its facts). Kaizena Flow's own hosts go to `store_id` null. An unknown host is
    dropped and counted in the route's answer.
  - `addTraffic(totals)`: one statement, `insert … on conflict (store_id, day, metric) do update set value =
    store_usage_daily.value + excluded.value`.
- *New* route `src/app/api/usage/drain/route.ts` (POST):
  - verifies the signature against `USAGE_DRAIN_SECRET` (new in `src/lib/env.ts`, optional: without it the route
    answers 404) with `timingSafeEqual`;
  - answers 401 on a bad signature, and the verification answer the spike found when the drain is created;
  - parses, totals and writes, and always answers within a second or two (the drain retries on errors, so a
    duplicate delivery is possible: say in a comment that a retried batch can count twice, and that this is
    accepted for soft limits);
  - adds nothing to `src/proxy.ts` (`/api/` is outside its matcher).
- `USAGE_DRAIN_SAMPLE_RATE` (optional, default 1) in `env.ts`, which must match the drain's setting.
- **Creating the drain is the owner's action.** Write the exact settings here:
  - the project;
  - sources (edge and static included, so pictures and scripts count as bandwidth);
  - the delivery address `https://kaizenaflow.com/api/usage/drain`;
  - the secret;
  - the sampling rate.

  Ask the owner to create it, or to approve your creating it with the Vercel MCP `create_drain` tool. Never create
  one without that yes.

Tests:
- `src/lib/usage-drain.test.ts`:
  - a sample payload, written from the documentation's example, gives the right totals;
  - unknown hosts are dropped;
  - a 503 counts as a server error and a 404 does not;
  - sampling scales and marks `estimated`;
  - the result holds no key named like an IP address, agent or path (walk the object).
- `src/app/api/usage/drain/route.test.ts`: a bad signature gets 401, and a good one writes. Mock the database
  module, as other route tests do.

### Step 1.5: reading usage

Status: built.

*New* `src/server/usage.ts`:
- `storeUsage(storeId, month)` returns `{ metric, value, estimated }[]` for the month, through `monthFigure()`;
- `ownerUsage(accountId, month)` gives the same per store the account owns (owner role, not disabled), plus the
  totals. Find how owner pages list "the stores you own" (for example `src/app/admin/(gated)/(owner)/account/usage`)
  and use the same reader;
- `platformUsage(month)` gives one row per store: slug, name, plan, status, and every metric. It is sortable by a
  metric, and Kaizena Flow's own site is the first row;
- `usageHistory(storeId, metric, days)` returns daily values for Lisa's chart.

### Step 1.6: showing usage (read-only)

Status: built.

Three places. The words go in the `billing` catalogue (en and nb), and units are formatted with the existing
`formatBytes()` and number formatting.

1. **A store's Billing page** (`[store]/billing/page.tsx`, `billing:read`): a `Card` titled *Usage this month* with
   one row per metric that matters to an owner:
   - storage, products, staff, domains, visits (requests), bandwidth, marketing emails and AI;
   - a figure each (bars come in phase 2);
   - "estimated" beside sampled traffic;
   - a *Details* link that shows each metric's last 90 days from `usageHistory()` (Lisa).
2. **The owner's level**: *new* page `/admin/account/limits`, labelled *Usage and limits*, in `ACCOUNT_ITEMS` after
   *AI usage*, with `owner: true`. It has one `List` row per owned store with its main figures, and the stores' totals
   at the top.
3. **The platform**: *new* page `/admin/platform/capacity`, labelled *Usage and limits*, in `SETTINGS_ITEMS`
   (`src/lib/platform-nav.ts`) after *AI usage*. It is a table, because figures are compared down a column:
   - one row per store and metric columns, sortable through the address;
   - a CSV through `writeCsv()` (`src/lib/csv.ts`; never join cells by hand);
   - a month picker.

Each page: an `ADMIN_PAGES` entry, nb words, a guard, `PageHeader`. A `renderToString` test of each view component
(see `src/components/admin/analytics/` for the pattern) with fixed data.

When phase 1 is done: add a bullet to `CLAUDE.md` under *Admin* named **Usage and limits (D314,
`docs/capacity.md`)** that states the rules of sections 0.3 and 1 that later code must keep. The rules are:
- `store_usage_daily` is written only by `usage-meter.ts` and the drain;
- traffic keeps no person;
- metering is in UTC days.

---

## 4. Phase 2: limits and enforcement

Goal: the platform admin sets limits per plan, with a platform default and overrides per store or owner. Costly
actions are refused over a hard limit, owners are warned at 80 % and 100 %, and plan cards show the limits.

### Step 2.1: the limits catalogue (pure)

Status: built.

*New* `src/lib/limits.ts`:

```ts
export type Enforce = "hard" | "soft";
export type LimitScope = "store" | "owner";

export const LIMITS = {
  storage_bytes:          { metric: "storage_bytes",    period: "now",   enforce: "hard", scope: "store" },
  products:               { metric: "products",         period: "now",   enforce: "hard", scope: "store" },
  staff_seats:            { metric: "staff_seats",      period: "now",   enforce: "hard", scope: "store" },
  custom_domains:         { metric: "custom_domains",   period: "now",   enforce: "hard", scope: "store" },
  marketing_emails_month: { metric: "marketing_emails", period: "month", enforce: "hard", scope: "store" },
  ai_cost_month_micros:   { metric: "ai_cost_micros",   period: "month", enforce: "hard", scope: "store" },
  requests_month:         { metric: "requests",         period: "month", enforce: "soft", scope: "store" },
  egress_bytes_month:     { metric: "egress_bytes",     period: "month", enforce: "soft", scope: "store" },
  stores_owned:           { metric: null,               period: "now",   enforce: "hard", scope: "owner" },
} as const;
export type LimitKey = keyof typeof LIMITS;
```

Pure helpers:
- `effectiveLimit({ override, plan, platform }: { override?: Value; plan?: Value; platform?: Value })`, where
  `Value = { set: true; value: number | null } | undefined`. It returns the first source that is set; a set source
  whose value is `null` means unlimited; nothing set means unlimited. Keep the difference between "no row" and "row
  meaning unlimited".
- `limitState(used: number, limit: number | null): "ok" | "near" | "reached" | "over"`:
  - `near` is from 80 %, `reached` is from 100 %, and `over` is above 100 % (possible for soft limits, and for hard
    ones lowered below usage);
  - an unlimited limit is always `ok`;
  - a limit of 0 means none allowed: anything used is `over`, and nothing used is `reached`.
- `roomLeft(used, limit)` returns `Infinity` when unlimited, else `max(0, limit − used)`.

Test `src/lib/limits.test.ts`: every branch above. Every `LIMITS[*].metric` that is not null is in `USAGE_METRICS`,
and its period agrees with the metric's kind (gauges are `now`, counters `month`).

### Step 2.2: the limits tables

Status: built.

```ts
/** A plan's limits (D314). `plan_id` null is the platform default. A row whose value is null means unlimited. */
export const planLimits = commerce.table("plan_limits", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id").references(() => plans.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  value: bigint("value", { mode: "number" }),
  updatedAt: updatedAt(),
  updatedBy: uuid("updated_by").references(() => accounts.id),
}, (t) => [
  unique("plan_limits_key").on(t.planId, t.key).nullsNotDistinct(),
  index("plan_limits_updated_by_idx").on(t.updatedBy),
  check("plan_limits_value", sql`${t.value} is null or ${t.value} >= 0`),
  check("plan_limits_known", sql`${t.key} in (/* every LIMITS key */)`),
]);

/** A platform admin's limit for one store or one owner (D314), with the reason and an optional end. */
export const limitOverrides = commerce.table("limit_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  value: bigint("value", { mode: "number" }),
  reason: text("reason").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: createdAt(),
  createdBy: uuid("created_by").references(() => accounts.id),
}, (t) => [
  check("limit_overrides_target", sql`(${t.storeId} is null) <> (${t.accountId} is null)`),
  unique("limit_overrides_key").on(t.storeId, t.accountId, t.key).nullsNotDistinct(),
  check("limit_overrides_reason", sql`length(trim(${t.reason})) between 1 and 300`),
  check("limit_overrides_value", sql`${t.value} is null or ${t.value} >= 0`),
  // plus the same known-keys check, and indexes on account_id and created_by
]);
```

- `plan_limits` has no `store_id`: no `COPY_RULES` entry, the same as `plans`. Check that the copy-rules test agrees.
- `limit_overrides`: `COPY_RULES` `never` ("an admin's decision for this store only").
- `NOT_PERSONAL` entries for both. An account id is not personal data in itself, but the register's detectors may
  disagree; follow what the test says and how it treats `ai_usage.owner_account_id`.
- A test that the two key checks equal `Object.keys(LIMITS)`.
- **No seed values.** Every limit is unlimited until the platform admin sets one (step 2.6). Rollout then changes
  nothing until someone decides numbers (section 9, question 1).

### Step 2.3: resolving a limit

Status: built.

*New* `src/server/limits.ts`:

- `limitFor(storeId: string, key: LimitKey): Promise<number | null>`:
  1. Templates and starters (`s.is_template or s.starter`) get `null`.
  2. Otherwise one query reads:
     - the store's override that has not expired;
     - its plan's row, while the store is on the plan by `toBilling()`'s rule. Export a small helper from
       `billing.ts` if needed; never copy the rule;
     - the platform default (`plan_id is null`).
  3. Then `effectiveLimit()`.
  4. Cache with `'use cache'`, `cacheLife` a few minutes, tags `limitsTag(storeId)` and `LIMITS_TAG`, as
     `src/server/catalog.ts` does.
- `ownerLimitFor(accountId: string, key: LimitKey)`, for `scope: "owner"` keys: the account's override, then the
  largest plan value among the open stores the account owns (where any of them is unlimited, unlimited), then the
  platform default.
- `limitsTag(storeId)` and `LIMITS_TAG` are exported; every change of a limit, an override or a store's plan calls
  `updateTag()` (`applySubscription()` in `billing.ts` too).
- `usageNow(storeId, key)` gives the figure to compare:
  - **`storage_bytes`**: the latest `storage_bytes` row, plus the bytes of `media` rows made since that row's
    `updated_at` (a refusal must not wait a day);
  - **`products`, `staff_seats` and `custom_domains`**: counted live with the same conditions as step 1.3. Move the
    conditions into one SQL fragment both use; never write them twice;
  - **month keys**: `monthFigure()` of this month's rows, plus today's live count for `marketing_emails`, and for
    `ai_cost_micros` read through a 60-second per-instance memo, because `aiFor()` is called often.
- `checkLimit(storeId, key, adding: number): Promise<{ ok: true } | { ok: false; key; limit: number; used: number }>`
  checks `used + adding > limit` for hard keys, and is always `ok` for soft ones.

Test `src/server/limits.int.test.ts`:
- the order of the three sources;
- an expired override is ignored;
- a store whose subscription is cancelled falls to the default;
- templates are unlimited;
- an owner's best plan wins;
- the cache tag refreshes after a change (call the updater and read again).

### Step 2.4: enforcing the hard limits

Status: built. Each refusal is a plain sentence from the `capacity` catalogue, through
the caller's usual error shape, with a link to the store's Billing page:

> This store has used its 10 GB of storage. Delete files you no longer need, or choose a plan with more.

Where to check, and what is never checked:

| Key | Check in | Never check |
|---|---|---|
| `storage_bytes` | `uploadProductImage()`, the start of a video upload, the start of a field-file and of a digital-file upload in `src/server/media.ts`, `uploadToLibrary()` in `media-library.ts`. `adding` is the file's size. | Copies the platform makes: templates (`applyTemplate()`), themes (`applyDesignPreset()`, `placeSnapshot()`), demo content, theme sections, store copies (D129), the media library's Compress (it saves space). These are counted the next day but never refused. A product import (D165) that meets the limit goes on without the picture and reports it on the row, as it reports other refused pictures. |
| `products` | `saveProduct()` in `src/server/products.ts`, only when it creates a product (no id yet) whose status is not archived. Covers the editor, imports, the AI manager's `create_product` and the content packs (starters are unlimited). | Saving an existing product; un-archiving one is a creation for the check (count it). |
| `staff_seats` | `inviteStaff()` in `src/server/settings.ts`, `inviteCollaborator()` in `src/server/store-roles.ts`. | Removing members; the owner. |
| `custom_domains` | The function in `src/server/domains.ts` that adds a domain. | Releasing one. |
| `marketing_emails_month` | `startBroadcast()` in `src/server/broadcasts.ts`: refuse to start when the frozen recipients exceed `roomLeft()`. Automations (`runAutomations()`): a send that would cross the limit is skipped and counted, never queued for later. | Every email not in `MARKETING_EMAIL_KINDS`. Order, invoice, legal and security emails are never limited (decision 4). |
| `ai_cost_month_micros` | `aiFor()` in `src/server/ai.ts`: when the connection uses Kaizena Flow's key (not the store's own) and the store is at its limit, return `null`. Features then carry on without AI, as they do today. The support desk then hands over with `no_ai`. | A store's own AI key (they pay their provider); `storeId` null (Kaizena Flow's own). |
| `stores_owned` | `createStoreForOwner()` in `src/server/platform.ts`. | A platform admin approving an access request (the admin decides). |

For each row of the table, write a test: an int test that sets a limit, makes the action and expects the refusal,
and one that shows the exempt path still works. The storage tests mock Storage as the existing upload tests do. The
`aiFor()` test checks that `null` comes back only for the platform key.

The AI manager and the MCP server reach these through the same functions, so they need nothing more. Their tool
answers already pass the error text on; check one (`create_product`) in a test.

### Step 2.5: showing limits and warning

Status: built.

- **Bars.** Step 1.6's three places show `used of limit` with `ScoreBar` (or `ShareBar`), coloured by
  `limitState()`: warning from `near`, danger at `reached`/`over`. Unlimited shows "No limit". Soft limits over 100 %
  say "Your shop stays open", never anything that sounds like a shutdown.
- **Emails.** *New* kinds `usage.near` and `usage.reached` (`EMAIL_KINDS` class `staff`, words in `email-text.ts`,
  four languages by hand):
  - *new* `sendUsageAlerts(month)` in `src/server/usage-alerts.ts`, run by the usage cron after measuring;
  - for each store and limit whose state is `near` or worse, it emails each owner once per store, key, month and
    level. The idempotency key `usage:{store}:{key}:{YYYY-MM}:{near|reached}:{account}` makes `sendEmail()` refuse
    repeats, so no table is needed;
  - it skips stores that are not open (`commerce.store_is_active()`) and templates;
  - follow `notifyOwners()` in `store-closure.ts` to find owners. If `permissions.scan.test.ts` refuses a new
    comparison of `role` with `'owner'`, use the helper that file allows;
  - the email names the store, the limit, the figure and one link to Billing. It never names a customer.
- **The control center.** An attention item when a store is at or over a hard limit: a `{ one, many }` pair in both
  `home` catalogues, read through `countWords()`, in `attentionFor()` (`src/lib/control-center.ts`). Its figure comes
  from `controlCenter()` (`src/server/control-center.ts`).
- Tests:
  - `sendUsageAlerts` sends once and not again on a second run, and not for a closed store;
  - the attention item appears at 100 % and not at 79 %;
  - render tests of the bars for each state.

### Step 2.6: the platform admin edits limits

Status: built.

- **Plans page** (`src/app/admin/(gated)/platform/plans/page.tsx`): a *Limits* `Card` with one row per `LIMITS` key
  and one column per plan, plus a *Default* column (the `plan_id` null rows):
  - each cell is a number field in the key's unit (GB for bytes, with conversion in code using integers: GB × 1024³);
  - empty means "not set" and *Unlimited* is a tick;
  - saving writes only the changed cells, audited as `platform.plan_limit_changed` with plan, key, before and after;
  - it calls `updateTag(LIMITS_TAG)` and `updateTag(PLANS_TAG)`.
- **One store's page** (`…/platform/stores/[store]`): an *Override limits* `Card` showing each key's effective value
  and where it comes from (override, plan, default, unlimited):
  - set or remove an override with a required reason and an optional end date;
  - audited as `platform.limit_override_set` and `platform.limit_override_removed`;
  - `updateTag(limitsTag(store))`.
- **Owner overrides** (for `stores_owned`): on the platform's view of an account, if one exists. Otherwise on the
  store page, naming the store's first owner. Say which you chose in this file.
- **Public plan cards.** `getPublicPlans()` also returns each plan's limits that are set, and `PlansView` shows them
  as lines ("10 GB storage", "Unlimited products"). Never type limits into `plan_features`, and add nothing there for
  them.
- Words in the `billing` catalogue (platform pages use the admin catalogues too).
- Tests:
  - an int test of the save action (only changed cells are written, the audit entry holds no person);
  - a render test of the cards and `PlansView` with limits.

### Step 2.7: the AI manager reads usage

Status: built.

- Owner tool `usage_and_limits`: read-only and ungated. It has zod arguments `{ store }` (for MCP) and a description,
  a line in `TOOL_WORDS`, and a row in `TOOL_PERMISSIONS` (`billing:read`). Its answer comes from `storeUsage()` and
  `limitFor()`, with figures formatted in code.
- Platform tool `store_usage` in `PLATFORM_TOOLS`: read-only, the platform page's rows for one store or the top ten
  by a metric.
- Neither changes a limit. A tool that raises a limit is never added.

---

## 5. Phase 3: protection inside the shared setup

Goal: one busy or misbehaving store cannot slow down the others, and heavy reads leave the primary database alone.

### Step 3.1: statement timeouts

Status: waiting on the owner (it reads production). **Spike first:**
1. Find which database role `DATABASE_URL` connects as, read-only:
   - run `select current_user, current_setting('statement_timeout')` with the Supabase MCP `execute_sql` on the
     production project; ask the owner first, as this reads production;
   - check whether CI's migration connection (`PRODUCTION_DATABASE_URL`) uses the same role;
   - check whether Supabase's transaction pooler (Supavisor) passes startup options.
2. If the app has a role of its own, a migration sets `ALTER ROLE <app role> SET statement_timeout = '15s'`
   (**owner gate** for the value). If the app shares the `postgres` role with migrations and `pg_cron`, do not change
   the role. Write down the two choices for the owner:
   - (a) create a dedicated `kaizen_app` role with the grants the app needs and move `DATABASE_URL` to it (a project
     of its own);
   - (b) set `statement_timeout` with `SET LOCAL` inside `setBased()` and the other heavy readers only.
3. Either way, every long job that needs more (`measureDay`, retention, imports) sets its own `SET LOCAL
   statement_timeout` inside its transaction. List them in this file.

Test: an int test that a query longer than the timeout fails with `57014`, and that `isTransientDbError()` treats it
as transient (it does today). Make sure no caller retries a write after it (`retryTransient` is for reads only).

### Step 3.2: per-store budgets on costly public endpoints

Status: built.

- *New* `src/server/request-budget.ts`: `takeBudget(storeId: string | null, bucket: string, limit: number, window:
  "minute" | "hour"): Promise<boolean>` generalises `takeEcbSlot()` over `chat_usage`. The same table and the same
  upsert; buckets are named `budget:{endpoint}` for the store and `budget:{endpoint}:{visitor}` for one visitor.
- The visitor key is the same daily-rotating hash the chat uses (find how `takeTurn()` hashes a visitor in
  `src/server/chat-agent.ts`, and reuse that function). Never an IP address as it is.
- Apply to:
  - search type-ahead (`suggestAction`);
  - `/api/recommendations`;
  - `/api/forms`;
  - `/api/visit`;
  - the WordPress API, which already limits by token (leave it).

  Each gets a store-wide budget per minute and a visitor budget per minute. **The numbers are constants in the
  module only as a ceiling against abuse** (an owner gate, section 9, question 4), not per plan.
- Over budget:
  - an API answers 429 with `Retry-After`;
  - type-ahead answers no suggestions, never an error to the shopper;
  - **never** on a page load, the cart, checkout, payment or a webhook.
- `pruneChatUsage()` already removes old rows; check that it covers the new buckets.

Tests: a unit test of the bucket names; an int test that the 61st call in a minute is refused and the first of the
next minute is allowed (pass the clock in, as other jobs do).

### Step 3.3: the edge (firewall and bots)

Status: waiting on the owner. **Owner gate**: firewall changes are made on the owner's Vercel team.

- Read the current configuration with the Vercel MCP `get_firewall_config` and write it here.
- Propose, for the owner's yes:
  - Vercel's managed rule sets on;
  - a rate-limit rule per IP on `/api/*` (without the drain, Stripe, Mollie, the cron routes and the carriers'
    webhooks, which have their own checks);
  - attack challenge mode documented as the button to press in an incident;
  - BotID on checkout, sign-up and `/api/chat`, if `plan.md` section *Security* has not already been done. Check
    the code for `botid` first.
- Apply only after the yes (`put_firewall_config`), and write the final configuration here.

### Step 3.4: a read replica for heavy reads

Status: built, off until `READ_DATABASE_URL` is set. **Owner gate**: a Supabase read replica costs money.

- `READ_DATABASE_URL` (optional) in `env.ts`. *New* `replicaDb()` in `src/db/client.ts` returns a second pool to it,
  or `db()` when it is not set. It is read-only by construction: the pool runs `SET default_transaction_read_only =
  on` on connect, and a test proves a write fails.
- Use it **only** for:
  - the analytics pages' loaders (`setBased()` callers in `src/server/analytics-*.ts`);
  - the platform's usage page;
  - export jobs' reads (D165).
- **Never** for:
  - anything read after a write in the same request;
  - `'use cache'` reads that are refilled right after `updateTag()` (the catalogue, pages, the store). A lagging
    replica would put the old data back in the cache until the next change;
  - checkout, payments, stock, tax reports (D161 needs its snapshot to tie to the books);
  - support and anything a person just changed.
- A scan test (`replica-readers.scan.test.ts`) lists the modules allowed to import `replicaDb` and fails for any
  other, as `field-values-readers.test.ts` does for its table.

### Step 3.5: connections and compute

Status: built.

**Capacity runbook.**
- **Connections.** Each function instance keeps at most 5 connections (`max: 5` in `src/db/client.ts`) through Supabase's transaction
  pooler, which shares a fixed pool of real connections set by the project's compute size (*verify* the figure for the current size in
  Supabase's documentation). The platform's *Usage and limits* page shows the active connections now; when they stay near the pool's
  size at busy times, raise the compute size.
- **Before a very busy time** (the platform admins are emailed 7 days and 1 day before one, step 4.1):
  1. Look at the database's CPU and connections in Supabase's reports for the same weekday a week before.
  2. If either was above about 60 %, raise the compute size a day before (Supabase dashboard → Settings → Compute). It restarts the
     database for a moment, so do it at night.
  3. Check that Vercel's spend limit leaves room for the extra traffic.
  4. Lower the compute size again after the event.
- **When the database is slow now:** look at Supabase's query performance report for the slowest statements, and at the platform's
  *Usage and limits* page for the store with the most visits and server errors this month.

- Write a section *Capacity runbook* here:
  - the pool arithmetic (5 connections per function instance; Supavisor's pool size for the project's compute size;
    when to raise compute);
  - where to see connection saturation (Supabase reports, `pg_stat_activity`);
  - the steps to raise compute before a peak (phase 4.1), and who presses them (the owner).
- Add a line to the platform's *Usage and limits* page showing the database's current active connections and size
  (one cheap query, platform admins only, cached 30 s).

---

## 6. Phase 4: peaks and reliability

### Step 4.1: the peak calendar

Status: built.

- *New* table `commerce.capacity_events`:
  - columns `id`, `store_id`, `starts_at`, `ends_at` (at most 14 days after), `expected` (`normal`, `busy`,
    `very_busy`), `note` (≤ 300), `created_by`, `created_at`;
  - `COPY_RULES` `never`, `NOT_PERSONAL`, kept 12 months.
- On the store's Billing page, under usage: *Planning a big sale?* opens a small form (start, end, how busy). Words
  in `billing`. `billing:write`.
- During an event:
  - soft-limit alerts for traffic are not sent for that store;
  - the platform's usage page shows upcoming events first.
- Platform admins get an email (`capacity.upcoming`, class `staff`) 7 days and 1 day before a `very_busy` event,
  from the usage cron, once each by idempotency key. The email links to the capacity runbook (3.5).
- Tests: the form's validation (pure, in `src/lib/capacity-events.ts`); the emails go once.

### Step 4.2: a checkout queue under pressure

Status: waiting on the owner. **Owner gate** for the switch and its thresholds.

- `platform_settings.checkout_queue` takes `off` (default), `auto` or `on`, and is edited on the platform's *Usage
  and limits* page.
- *New* `src/server/checkout-pressure.ts`: `underPressure()` reads `count(*) from pg_stat_activity where state =
  'active'` at most every 5 seconds per instance. It is true when `on`, or when `auto` and the count is over the
  threshold. The threshold is a platform setting, not a constant.
- Only where an order is about to be placed from the checkout (find the server action that calls `placeOrder()` from
  `checkout-section.tsx`): when `underPressure()`, the shopper is told *Many people are checking out right now. We'll
  try again for you in a few seconds.* and the page retries by itself with growing waits (3 s, 6 s, 12 s, then a
  button).
  - The cart, its prices and its codes are untouched, and no stock is held by the queue.
  - The words are `browserText()` (`m.checkoutBusy`, hand-written nb, sv, da, en).
  - The retry code lives in the checkout's existing client component, with no new script, origin, zod or
    `FORBIDDEN_ON_PAY_ROUTES` module: the pay routes' CSP and scan tests must still pass (`docs/pci.md`).
- Never in front of a payment that has started, a webhook, or a confirmation page.
- Tests: `underPressure()` with a fake count; an e2e that, with the switch `on`, the checkout shows the message and
  places the order once it is turned off.

### Step 4.3: load tests

Status: built (`scripts/load/`); targets and first results wait on the owner.

- *New* `scripts/load/` with k6 scripts (a developer tool; k6 is installed by the developer, and nothing is added to
  `package.json`'s dependencies):
  - browsing (front page, a category, a product, search);
  - adding to a cart;
  - checkout up to Stripe's test page.
- **Never against production.** Only against a Vercel preview deployment pointed at a Supabase branch seeded with
  `scripts/db-setup.mjs --seed`. The script refuses to run when the target host is `kaizenaflow.com`, a store domain,
  or any production domain from `docs/platform.md`.
- Write the target figures here, as an owner gate (for example 200 page views a second and 20 orders a minute for
  one store with p95 under 800 ms). Also write the first results, and what broke first.

### Step 4.4: service levels and alerts

Status: waiting on the owner (targets and the status page vendor).

- Define here, as owner gates:
  - storefront availability: the share of requests without a 5xx, from the drain's counters;
  - checkout success: orders paid ÷ checkouts started, from the orders table;
  - p95 response time: from Vercel's observability.

  Targets per level: Shared 99.9 %, Dedicated 99.95 %.
- *New* `src/server/service-levels.ts` works these out per day and per store from existing data, and shows them on
  the platform's page. Nothing is promised to owners until the owner agrees the wording.
- Alerting: when the platform-wide 5xx share passes a threshold for 10 minutes (counted from the drain), email
  platform admins (`capacity.errors`, once per hour by idempotency key). A paging tool is for later.
- A status page for owners, from an EU vendor: **owner gate** for the vendor. Write the choice and its address here.

### Step 4.5: backups and restore drills

Status: built (`docs/runbooks/restore.md`); PITR to be confirmed by the owner.

- Confirm with the owner that point-in-time recovery is on (Supabase dashboard). Write the retention here.
- *New* `docs/runbooks/restore.md`: how to restore to a Supabase branch at a point in time, check it (order counts,
  the latest invoice numbers through `commerce.order_number_audit()`), and how a real restore would be done and
  announced.
- A drill every quarter. Its date and result are a line in that runbook.

---

## 7. Phase 5: hosting levels and cells

Goal: a store can live in a cell of its own (*Dedicated*) with the same admin, addresses and data, and can be moved
there and back by the platform without the owner doing anything.

**This phase starts with a spike and an owner gate. Do not build steps 5.1 onwards before the owner has accepted
`docs/cells.md`.**

### Step 5.0: the spike, `docs/cells.md`

Write `docs/cells.md` answering each question below. Each answer gets a proposal, what it costs, and what must be
verified in Vercel's and Supabase's documentation, with links and dates. The proposals written here are a starting
point, not decisions.

1. **What a cell is.** Proposal:
   - a Vercel project and a Supabase project, both in the EU, running the same commit of this repository;
   - the current deployment is cell `eu-1` (*Shared*) and is also the **control plane**.
2. **What the control plane keeps** and what each cell gets.
   - Proposal: accounts, sign-in, billing, plans, themes and the theme store, Kaizena Flow's own site and the
     platform admin stay in the control plane.
   - Each cell holds its stores' own rows (every table with `store_id`) and a one-way copy of the reference data its
     stores read: plans, design presets and versions, `platform_languages`, `ui_translations`, `vat_categories` and
     `vat_rates`, `ecb_reference_rates`, `retention_rules`, `ai_model_prices`, and the platform settings a store
     reads.
   - List every table by going through `src/db/schema.ts`, and classify each as *control plane*, *store* or
     *copied reference*. Add a test like `COPY_RULES`' so a new table needs a decision.
3. **Signing in to a store in another cell.** Proposal: the cell's Supabase Auth trusts the control plane as an
   OpenID Connect provider. This is the pattern D95 already uses between Kaizena Flow and Kaizen Life
   (`src/server/kaizen-life.ts`), and the cell admits only the store's members.
4. **Addresses.**
   - A store's own domains are attached to the cell's Vercel project.
   - `{slug}.{store domain}` and `/s/{slug}` on the control plane redirect (308) to the cell. Extend
     `src/lib/store-hosts.ts`'s build-time routing with the store's cell origin.
   - The admin's links to a store's pages go through `storeHref()`, which then names the cell.
5. **Webhooks and scheduled jobs.**
   - Stripe Connect events name the store's account (`event.account`), so the control plane can forward each event
     to the store's cell, or each cell can have its own webhook endpoint filtered by account. Compare the two.
   - Mollie, carriers and the Kaizen Life MCP need the same treatment.
   - Every cell runs its own `pg_cron` jobs for its stores.
6. **Order and invoice numbers** (D141, D159) must not change when a store moves. That forbids D129's copy, which
   makes `C-…` history. A move copies every row with its ids as it is.
7. **Moving a store.** Proposal:
   - make the store read-only for its admin and checkout for a few minutes. This needs a *new* `stores.moving_at`,
     refused by database rules like `orders_store_open()`;
   - copy every store row and its Storage objects;
   - check counts and checksums per table;
   - switch the domains;
   - lift read-only;
   - keep the source rows untouched and marked for 30 days before they are removed by a person.

   Estimate the read-only time for the largest store today (count its rows).
8. **Costs** per Dedicated cell per month (Vercel project, Supabase compute size, drain, backups), and what the
   level's price must cover.
9. **What Dedicated buys in practice**:
   - its own database compute and connection pool;
   - its own function concurrency and spend limits;
   - higher limits;
   - its own maintenance window;
   - SLO 99.95 %.
10. **Private cloud** (phase 6): what differs (the customer's chosen EU region, possibly their own Vercel team and
    Supabase organisation, their keys, a contract).

### Step 5.1: cells as data

Status: planned, after the owner accepts `docs/cells.md`.

- *New* `commerce.cells`:
  - columns `id` (text, `eu-1`, …), `name`, `kind` (`shared`, `dedicated`, `private`), `region`, `app_origin`,
    `status` (`active`, `draining`, `closed`) and `created_at`;
  - a migration inserts `eu-1`.
- `stores.cell` (text, references `cells`, default `'eu-1'`, not null).
- `plans.level` (`shared` default, `dedicated`, `private`).
- The platform's store page shows the cell, and the plans editor the level. Nothing routes by them yet.
- `COPY_RULES`: `stores.cell` is not copied (a copy starts in `eu-1`); check how column-level rules are written in
  `duplicate_store()`.

### Step 5.2: the store mover, dry run only

Status: planned.

- *New* `scripts/move-store.mjs`. It reads the classification of 5.0 question 2 from code, so a new table cannot be
  forgotten, and for one store:
  - exports every store row to files in the scratch folder;
  - lists its Storage objects;
  - prints counts and checksums.
- Dry run only: it never writes to a target and never changes the source.
- A test runs it against the seeded database, and checks that the export holds every table with a `store_id` that
  has rows for the seeded store.

### Step 5.3 onwards

Status: planned. Write them into this file once `docs/cells.md` is accepted:
- the read-only switch;
- the target import;
- address routing;
- webhook routing;
- one pilot store moved to a test cell and back with its numbers unchanged;
- assigning a Dedicated plan opening a platform task instead of moving anything automatically.

---

## 8. Phase 6: private cloud

Status: planned, only when a customer has signed. A private cloud is a cell of kind `private` built by phase 5's
tools, in the region and accounts the contract names. The contract work (data processing agreement, SLA, support
hours) is the company's. The code work is only what phase 5 did not already cover, written up in `docs/cells.md`
when it comes.

---

## 9. Questions for the owner

Ask these at the gates named above, one at a time, with the recommendation given.

1. **The limits per plan.** These are entered in Platform → Plans, never in code.
   - Recommendation for a start:

     | Limit | Start | Grow | Scale |
     |---|---|---|---|
     | Storage | 5 GB | 50 GB | 250 GB |
     | Products | 500 | 10,000 | unlimited |
     | Staff | 3 | 15 | unlimited |
     | Domains | 1 | 5 | 20 |
     | Marketing emails a month | 2,000 | 25,000 | 150,000 |
     | AI on Kaizena Flow's key a month | modest | higher | highest |
     | Traffic | soft only | soft only | soft only |
     | Stores per owner | 1 | 3 | 10 |

   - The default for stores without a plan: Start's.

   **Decided (2026-10-23, the owner's go-ahead on the recommendation).** Production's plans are Basic, Grow, Advanced and Plus, so
   the three tiers became four. Migration `20261023122903_capacity_plan_limits` writes them by plan name (a database without those
   plans gets nothing) and keeps any limit an admin set first:

   | Limit | Basic | Grow | Advanced | Plus |
   |---|---|---|---|---|
   | Storage | 5 GB | 50 GB | 250 GB | 1,000 GB |
   | Products | 500 | 10,000 | unlimited | unlimited |
   | Staff | 3 | 15 | 50 | unlimited |
   | Domains | 1 | 5 | 20 | 50 |
   | Marketing emails a month | 2,000 | 25,000 | 150,000 | 500,000 |
   | AI on Kaizena Flow's key a month | $5 | $20 | $75 | $250 |
   | Visits a month (warns only) | 1 million | 5 million | 25 million | unlimited |
   | Stores per owner | 1 | 3 | 10 | 25 |

   Bandwidth is left unset (not measured). **No platform default is set**, unlike the recommendation: a default would also limit
   the owner's own development stores, which have no plan, and every test database. A store without a plan stays unlimited until
   it chooses one; set a default on Plans → Limits if that should change. Real stores' usage on the day was far under every limit
   (at most 9 products, 1 staff, 1 domain, 1 MB of files), so nothing in use is refused.
2. **Overage.** **Decided: only the offer of a bigger plan**; nothing is billed for traffic. Should traffic over a soft limit be billed (a metered Stripe price), or only answered with an offer
   of the next plan? Recommendation: only the offer for now. Billing overage is a later step on `syncPlans()`.
3. **The Vercel log drain.** Is its cost per GB acceptable, at which sampling rate? Recommendation: start at 100 % and
   lower it if the bill says so; the figures are then marked estimated.
4. **Ceilings against abuse** for step 3.2's budgets, and the statement timeout of 3.1. Recommendation: 15 s, and
   budgets generous enough that no real shop meets them. Lower them only with evidence.
5. **A read replica** (3.4): the cost against analytics staying fast on the primary.
6. **The checkout queue** (4.2): on as `auto`, and at what threshold.
7. **Service levels and the status page vendor** (4.4).
8. **Phase 5**: accept, change or reject `docs/cells.md`, and the price of *Dedicated*.

---

## 10. File map (new files, by phase)

| Phase | File | What |
|---|---|---|
| 1 | `src/lib/usage-metrics.ts` | metrics catalogue, `monthFigure()` |
| 1 | `src/lib/usage-drain.ts` | pure drain parser and totals |
| 1 | `src/server/usage-meter.ts` | daily measuring, pruning |
| 1 | `src/server/usage-traffic.ts` | host to store, `addTraffic()` |
| 1 | `src/server/usage.ts` | readers for the three pages |
| 1 | `src/app/api/cron/usage/route.ts` | the daily job |
| 1 | `src/app/api/usage/drain/route.ts` | Vercel's drain |
| 1 | `src/app/admin/(gated)/(owner)/account/limits/page.tsx` | owner's *Usage and limits* |
| 1 | `src/app/admin/(gated)/platform/capacity/page.tsx` | platform's *Usage and limits* |
| 2 | `src/lib/limits.ts` | limits catalogue and state |
| 2 | `src/server/limits.ts` | `limitFor()`, `checkLimit()`, `usageNow()` |
| 2 | `src/server/usage-alerts.ts` | owners' emails |
| 3 | `src/server/request-budget.ts` | per-store budgets |
| 4 | `src/server/checkout-pressure.ts` | the checkout queue's signal |
| 4 | `src/lib/capacity-events.ts`, `scripts/load/`, `src/server/service-levels.ts`, `docs/runbooks/restore.md` | peaks and reliability |
| 5 | `docs/cells.md`, `scripts/move-store.mjs` | cells |
