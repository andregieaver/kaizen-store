# Work in Kaizen Life: a summary from Kaizena Flow, and Life's own Work retired (proposal)

Status: **proposed 9 November 2026**, no decision number yet. The owner: *now that Work is built into Kaizena Flow, Work can go
from Kaizen Life; what Life needs instead is a summary of Work across the person's stores, with links back to Kaizena Flow.
Information and navigation between the two must be intuitive, relevant and seamless.* The owner's answer to the one question
asked: **only Work goes; personal Finances stays in Kaizen Life.**

This is a plan, not a design: each phase gets its decision when it is built. "Life" is `/home/user/lifesaver-app`
(kaizenlifetracker.com); "Flow" is this repository. The Life-side checklist, file by file, is in Life's
`docs/work-moves-to-kaizena-flow.md`. Pictures: `docs/life-work-summary/mockup.png` (what Life shows) and
`docs/life-work-summary/flow.svg` (how data and taps travel).

Evidence is marked: **[repo]** read in the code on 9 November 2026; **[prod]** counted in the production databases
the same day (counts only, no person's data read); **[docs]** a vendor's own documentation; **[U]** not verified.

## 0. Summary

1. **Flow is the one home of Work; Life shows only what needs you, and every line opens the exact Flow screen.** Life keeps no
   copy of a client, invoice or hour. It reads one summary from Flow when a page draws and forgets it.
2. **One reader, one door.** Flow gets `workSummary(account, grant)`, built from readers that already exist (`workStoresFor`,
   `getOwnerOverview`, `getRunningTimer`). It is served as the MCP tool `work_summary`, which WP13 of `docs/work.md`
   planned and never built. Life's Today card, Life's Work page and Life's assistant all call that one tool over the
   connection Life already has. There is no new API and no second grant.
3. **One tap, no second sign-in.** Every link in the summary is built by Flow and goes through one door,
   `/admin/from/kaizen-life?next=…`. Signed in to Flow, it goes straight through. Signed out, it signs in with Kaizen Life
   and goes on to the same screen; after the first consent this is silent, because Life's consent page already skips a
   client the person has approved [repo, docs]. Today a signed-out deep link into Flow loses where it was going [repo]; that
   is fixed for every link, not only Life's.
4. **The way back.** Flow's account menu gets *Kaizen Life ↗* for accounts linked to Life. Today Flow never links to Life [repo].
5. **Life's Work goes, its Finances stay.** The `/app/work` address stays and becomes the summary, so the Money door, its Work
   tile, bookmarks and saved nav bars keep working. Clients, invoices, time, repeating invoices, reports, print pages and the
   revenue wall (Views) go. **Organizations stay**: they are employers and businesses with salary, reimbursable and repeating
   costs, and they feed personal Finances (`docs/work.md` §0.1 says the same). They move under Money.
6. **Data first.** Human Web's Life Work was imported on 30 September and Life's Work has not been touched since
   [prod, `docs/work.md` "Import run for Human Web"]. A second Life space was never imported: 4 invoices (1 draft, 2 paid,
   1 sent, the last made 17 August) [prod]. The owner decides its fate (open question 1). Everything Life holds is exported to
   an archive before any table is dropped, and the drop waits 30 days after the code is gone.
7. **Now is the cheapest moment.** Nobody has connected Life to Flow in production (no `kaizen_store` connection in Life) and
   nobody has signed in to Flow with Kaizen Life (no `custom:kaizen-life` identity in Flow) [prod]. So the connection can move to
   Flow's own OAuth server (D439), and Life's out-of-date names ("Kaizen Store", `kaizenstore.cloud`) can be put right, with
   no one to migrate.

![What Kaizen Life shows](life-work-summary/mockup.png)

## 1. What is there today

### 1.1 Life's Work [repo, prod]

* **Screens.** `/app/work` (tabs: overview and organizations), `/app/work/invoices`, `/app/work/invoices/[id]`,
  `/app/work/clients/[id]`, `/app/work/organizations/[id]`, `/app/work/reports` and its print page, `/app/work-invoice-print/[id]`,
  the revenue wall `/app/views` (and its public `/views/[token]`), `/api/work/report`, `/api/agent/work`, and the cron job
  `/api/cron/work-recurring-invoices` (`vercel.json`). The Money door (`components/app-shell/nav-defs.tsx:75-80`) lights for
  `/app/money`, `/app/finances` and `/app/work`. The Money hub (`app/app/money/page.tsx`) shows two tiles: Finances and Work.
* **Data.** Across two spaces: 8 clients, 8 assignments, 16 tasks, 28 time entries, 17 invoices (5 paid, 10 sent, 2 drafts),
  no repeating invoice, no running timer. The newest invoice was made on 16 September, and no time was logged after September.
  The revenue wall has never been shared (no `view_share_tokens` row).
* **Tied to Finances.** Invoices write expected income into the personal budget (`finance_work_invoice_projections`, 13 rows;
  `lib/work/finance-sync.ts`, `recurring-invoice-sync.ts`). A paid invoice links to its Finances transaction
  (`work_invoices.finance_transaction_id`, the "Payment received" badge). `lib/finance/comparison.ts` takes VAT out of invoice
  payments. A Finances category cannot be deleted while Work uses it.
* **Organizations are not Work in Flow's sense.** These are `life_area_groups` with domain `work` (5), with a salary (1),
  reimbursable expenses (2) and repeating costs (11), feeding employment income and expense projections in Finances. Flow did
  not port them, on purpose.
* **"Work" also means tasks.** Two other things use the word and are not touched: task and project work items
  (`work_activity_messages`, `lib/work/{fields,due,primary-project,project-tasks}.ts`, `docs/work.md` §1 table, row B), and
  the *Work room*, a Life space of kind `work`.

### 1.2 What Flow already has [repo, prod]

* **Readers over all of a person's stores** (D123, `src/server/work-owner.ts`). `workStoresFor(account)` covers owner and admin
  memberships that hold `settings:read`. `getOwnerOverview()` returns a `CombinedOverview`: money per currency, never added
  across currencies (unbilled, drafts, receivables not yet due, due soon and overdue, paid this month); a part per store; and
  attention lists (overdue invoices, unbilled time per client, running timers), each tagged with its store.
  `getRunningTimer(account)` (`src/server/work-time.ts:568`) returns the one running timer across stores. Every Work address is
  made by `workBase()` (`src/lib/work-paths.ts`).
* **The bridge to Life** (D95, D96, D439). Each Supabase project is the other's OpenID provider (`KAIZEN_LIFE_SSO`).
  `/api/mcp` takes Life's Supabase tokens, which reach only the stores the person *owns* (`store-mcp.ts:89`), and Flow's own
  `kfa_` tokens, which reach what the grant and the role allow. Flow's MCP Work tools are per store, answer with preformatted
  strings and relative links, and none covers all stores or the timer (`src/server/work-tools.ts`).
* **Gaps.**
  * No reader answers "my Work across stores" for another app.
  * `workAttention()` writes English sentences only. Another app needs numbers it can word itself.
  * A signed-out visit to any `/admin/...` page lands on plain `/admin/sign-in` and forgets the page asked for
    (`src/components/admin/session.tsx`, `requireAccount()` in `src/server/auth.ts`).
  * Nothing in Flow's admin links to Life.
* **In production.** Work is on in 2 stores. Human Web holds 49 invoices (48 of them imported: from Life on 30 September and
  from Tripletex, D494), 9 clients and 14 tasks. No time is logged in Flow today, so "unbilled" starts at nothing.

### 1.3 Life's link to Flow [repo, prod]

* Provider `kaizen_store` (`lib/integrations/kaizen-store.ts`). It uses OAuth with PKCE against Flow's Supabase OAuth server
  (scopes `openid email`) and calls `${site}/api/mcp` with JSON-RPC `tools/call`. Tokens are kept encrypted in
  `integration_connections`, which is **per person** (`user_id`), not per space.
* The default site is `https://kaizenstore.cloud` (`lib/integrations/env.ts:153`). Every text says "Kaizen Store". There are
  no wrappers yet for Flow's Work tools.
* In production nobody has connected it: no `kaizen_store` row.

## 2. What the person should experience

### 2.1 Rules the design keeps

1. **One home per thing.** Work is done in Flow. Life never offers a form that changes Work, so nobody wonders where the truth is.
2. **Relevant before complete.** The Today card shows only what needs the person: overdue invoices, a running timer, time ready to
   invoice, repeating invoices ready to go out. When nothing does, it is one quiet line ("Nothing waiting at work", with what is on
   its way). The full picture is one tap away on `/app/work`. Homer reads the card. Lisa opens the page: per store, per currency,
   paid this month, her own hours this week.
3. **Every line is a door to the exact screen.** "2 invoices overdue" opens Flow's invoices filtered to overdue, in that store or
   across stores. The timer opens the store's Work, where the timer strip is. "Ready to invoice" opens the invoices. A store row
   opens that store's Work overview. *Open Work in Kaizena Flow* opens the combined view.
4. **Never a second sign-in.** See 3.4.
5. **Money stays honest.** It is per currency and never added across currencies (Flow's rule). It is formatted in the person's
   language by Life's own `formatMoney`. Durations show as hours and minutes.
6. **Personal, not shared.** The summary is the person's, read with the person's own connection. It never appears for other
   members of a shared space, even on a shared Today.
7. **Honest about freshness and failure.** It says when it was read ("Updated 07:15"). If Flow does not answer within 4
   seconds, the card says so in one line and links to Flow. It never shows old numbers as if they were new, and it never shows a
   blank card or a spinner that never ends.
8. **Life writes its own words.** Flow sends numbers, names, dates and links. Life words them in its five languages (en, nb,
   sv, de, es). Client and store names are shown as text, never as HTML.

### 2.2 The journeys

* **Morning, in the Work room.** Today shows the Work card between the day's tasks and the calendar (picture A). One tap on a
  line lands on that Flow screen, signed in.
* **Money → Work.** The Work tile (picture C, last) says in a few words what is waiting. `/app/work` (picture B) shows *Needs you*,
  then *Money* per currency, *By store*, and the one main button, *Open Work in Kaizena Flow*.
* **An old Life address.** `/app/work/invoices/…`, `/app/work/clients/…`, `/app/work/reports` and `/app/views` land on
  `/app/work` with one line: *Work has moved to Kaizena Flow*. Life's ids are not Flow's, so nothing is guessed.
* **Not connected yet.** The card and the page offer *Connect Kaizena Flow* once: one consent in Flow, then back to the same
  page with the summary. *Not now* hides it for good. The offer shows only in the Work room or to someone who used Life's Work;
  it is never shown to someone with no reason to care.
* **Asking.** "What's overdue at work?" in Life's assistant is answered from the same `work_summary` tool, grounded and
  untrusted like every Flow tool in Life (`lib/agent/untrusted.ts`).
* **From Flow back to Life.** *Kaizen Life ↗* in Flow's account menu opens Life's Today. Only accounts linked to Life see it.

## 3. How it works

![How data and taps travel](life-work-summary/flow.svg)

### 3.1 Flow: `workSummary(account, grant)`

A pure shaper in `src/lib/work-summary.ts`; its reads in `src/server/work-summary.ts`. It reads with the readers that exist
(`workStoresFor` → `getOwnerOverview` → `getRunningTimer`, about five queries on `readDb()`, all scoped to the person's
memberships), limited to the stores the grant reaches and those where the person holds `settings:read`, as Work's screens
require. A store with Work off is listed only by name, for Lisa ("Turn Work on in …"). Kaizena Flow's own store is covered like
any other the person belongs to (platform parity).

The answer is data, not sentences:

```ts
type WorkSummary = {
  asOf: string;                                   // ISO time the figures were read
  open: string;                                   // the combined Work view, through the handoff door (3.4)
  needs: Array<{                                  // what needs the person, most urgent first; empty when nothing does
    kind: "overdue" | "timer" | "unbilled" | "recurring_ready" | "drafts_waiting";
    urgent: boolean;                              // overdue 14 days or more, timer 12 hours or more (workAttention's rules)
    store: { slug: string; name: string } | null; // null when the line covers several stores
    count?: number;
    money?: { minor: string; currency: string };  // bigint as a string; one currency per line
    minutes?: number;
    since?: string;                               // oldest due date, timer start or oldest unbilled day
    client?: string;                              // the timer's client; never a list of names
    task?: string;
    href: string;                                 // absolute, through the handoff door
  }>;
  currencies: Array<{ currency: string; onItsWay: string; overdue: string; dueSoon: string;
                      paidThisMonth: string; drafts: { count: number; minor: string };
                      unbilled: { minutes: number; minor: string } }>;
  stores: Array<{ slug: string; name: string; workOn: boolean; href: string;
                  currencies: WorkSummary["currencies"]; unbilledMinutes: number }>;
  myMinutesThisWeek: number;                      // the person's own time, Monday to now, in each store's time zone
};
```

* **Links are Flow's.** Every `href` is built with `workBase()` and wrapped in the handoff door, so Life never builds a Flow
  address. When Flow moves a screen, Life follows.
* **Least data.** Client names appear only where a line is about one client (the timer, a single overdue invoice). Lists of
  people never cross. Both projects are in eu-west-1.
* **Served as the MCP tool `work_summary`.** It takes no `store` argument, like `list_stores`. The JSON is in
  `structuredContent`, with a short text rendering for models. Flow's own AI manager can be offered it too, under
  `settings:read`. MCP calls stay audited and budgeted as now (`takeMcpBudget()`: 120 a minute a grant). A new tool description
  means a new agent-eval run and its recording (CLAUDE.md, *AI features must stay grounded*).
* **Why not a REST endpoint.** A `kfa_` token is bound to one resource (D439). Life holds an `mcp` grant for its assistant, and
  a second resource would mean a second consent and a second token for the same person. A REST door can be added later from the
  same reader if a client other than Life needs one.

### 3.2 Life: reading it

* `lib/integrations/kaizena-flow-work.ts`: `getWorkSummary(userId)` calls `work_summary` through the person's connection
  (`getValidAccessToken`, which refreshes), gives up after 4 seconds, checks the answer's shape with zod (an answer of another
  shape is a failure, never half drawn), and returns `null` on any failure.
* **Today.** A new section id `work` in `SECTION_ORDER` (`app/app/today/page.tsx`) and its label in five languages. The main
  wave does only the cheap check: does the person have a Flow connection? The section itself is an async server component in
  `<Suspense>` with a skeleton, as `flagged-emails-section.tsx` does (Life's AGENTS.md, *Slow or external reads*). It is on by
  default in the Work room; in other rooms it can be added from Today's edit mode, and it shows there only when a line is urgent
  (open question 4).
* **`/app/work`.** The summary page (picture B), same pattern, same gate (`page.work`, so module sections, onboarding and plans
  need no change).
* **No cache, so no write-through.** Life stores nothing it reads, and changes nothing in Flow. Life's AGENTS.md rule on synced
  data therefore has nothing to write through. If Life ever stops the timer from the card (phase 5), that action must update the
  card at once (optimistic), since there is no cache to refresh.

### 3.3 The connection: Flow's own OAuth server

Recommended (open question 3): Life becomes a pre-registered first-party client of Flow's authorization server (D439). The
change:

* **In Flow.** A `commerce.oauth_clients` row named *Kaizen Life* with the redirect `…/api/integrations/kaizen_store/callback`
  and resource `mcp`.
* **In Life.** Point the issuer at `https://kaizenaflow.com` (RFC 8414 discovery). Point the site at `https://kaizenaflow.com`.

What it gains:

* Life shows in Flow's *Connected apps and assistants*, with *Disconnect* and per-store *Cut off*.
* The person picks the level on Flow's consent screen. The summary needs only *Read*; the assistant keeps whatever was chosen.
* It reaches stores the person runs as an admin, not only those they own.

There is nobody to migrate. Flow's Supabase-token path for Life (D96) is removed one step later, once Life has switched.
Keeping Supabase tokens also works, but then the summary covers owned stores only.

### 3.4 One tap, no second sign-in

* **The door.** `src/app/admin/from/kaizen-life/route.ts` reads `next` through `safeNext()` (`/admin…` only, same origin).
  * A signed-in person goes straight to `next`.
  * A signed-out person, while `KAIZEN_LIFE_SSO` is on, goes straight into *Sign in with Kaizen Life*: the same action as the
    sign-in page's button (`src/app/admin/sign-in/actions.ts:94`), carrying `next` through `/auth/callback?via=kaizen-life`.
    Life's consent page redirects at once for a client the person approved before (`app/app/oauth/consent/page.tsx:32`; Supabase's
    `getAuthorizationDetails` returns a redirect when consent exists [docs]). So the second time, the person sees nothing but
    the page they tapped.
  * With SSO off, the person goes to `/admin/sign-in?next=…`.
  * `admitFromKaizenLife()` still admits owners and platform admins only. An admin who is not an owner signs in with their
    password, and `next` survives that too.
* **Every signed-out deep link keeps its destination.** This fixes more than Life's links: invoice emails, push notifications and
  shared links gain it too.
  * The `(gated)` layout's `SessionRecovery` goes to `/admin/sign-in?next=<this page>`.
  * `requireAccount()` does the same with the requested path.
  * Both are checked by `safeNext()`.
* **Switch `KAIZEN_LIFE_SSO` on in production.** Check first that it works end to end; no identity has ever been linked [prod].

### 3.5 The way back

`AdminAccountMenu` (`src/components/admin/admin-shell-parts.tsx`) gets *Kaizen Life ↗*, opening `KAIZEN_LIFE_URL` (default
`https://kaizenlifetracker.com`, `src/server/kaizen-life-link.ts:34`) at `/app/today`. It appears only when the account has a
linked Kaizen Life identity (`kaizenLifeIdentity()`) or a live grant to the Kaizen Life client. Its words are in the admin's
catalogue (D312).

## 4. Retiring Life's Work, keeping Finances

The file list is in Life's `docs/work-moves-to-kaizena-flow.md`. In short:

* **Goes.** The clients, assignments, tasks, time, timers, invoices, repeating invoices, reports and print screens, and their
  actions, queries and components. Also:
  * `/api/work/report`, `/api/agent/work` and the cron job;
  * the revenue wall (Views: it is Work revenue, never shared);
  * Analytics' Work tab;
  * settings for invoice VAT;
  * the Contacts "make client" card;
  * the activity feed's links to Work items (the events stay as history; their links go to `/app/work`);
  * 471 keys of `work.json` per language, less what the summary reuses.
* **Moves.**
  * Organizations move to the Money hub as their own tile (*Jobs and income*, open question 2): the life-area domain `work`
    keeps its key, and its `basePath` becomes `/app/money`. An organization page loses its client list. In its place, if the
    person is connected, a line: *Your clients are in Kaizena Flow ↗*.
  * The repeating-cost helpers that life areas share move from `lib/work/` to `lib/life-area/`.
  * Organization tools and their scopes (`read:work`, `write:work`, tool domain `work`, which also routes the taxonomy
    tools) keep their names; only Work's invoice and client reads go.
* **Finances keeps working without Work.**
  * The two invoice projection syncs and their reads go. The budget no longer shows expected income from Life's invoices;
    phase 5 can bring it back from Flow.
  * The "Payment received" link goes with `work_invoices`; the transactions stay.
  * The category guard goes.
  * `comparison.ts` stops taking VAT out of invoice payments: income is counted as entered, which affects at most the 13
    projections there are today.
* **Navigation.**
  * `/app/money` keeps `/app/work` in its match prefixes.
  * `/app/views` leaves the More list. Saved bars and the command palette that point at it are sent to `/app/work`.
  * The assistant's sitemap names the summary.
* **Marketing.** Life's features page, *The entrepreneur* use case, `llms.txt` and `marketing.json` stop promising invoicing
  in Life and say *invoices and time with Kaizena Flow*.
* **Database, last.** One migration, 30 days or more after the code is gone, drops what only Work used:
  * the `work_*` tables of Work proper, their enums and triggers;
  * `finance_work_invoice_projections` and `finance_work_recurring_invoice_projections`;
  * `spaces.work_default_vat_percent`;
  * `view_share_tokens`.

  It keeps `life_area_*`, `work_activity_messages` and everything task-related. It is named with the version production
  records (Life's AGENTS.md, *Migrations*). Life's `docs/compliance/data-map.md` changes in the same step.

## 5. Phases

Each phase is shippable alone, in this order. In each repo, `main` deploys to production, so every phase passes that repo's
checks first (Flow: lint, typecheck, unit and integration tests; Life: `npm run check` and `npm run smoke`).

| Phase | Where | What | Done when |
| --- | --- | --- | --- |
| **0. Data** | Life, owner | Export every Life Work row of both spaces to a private archive. The owner decides the second space (open question 1); if it is to be imported, run `scripts/import-life-work.mjs` for it. Confirm nothing changed in Human Web's Life Work since 30 September (newest invoice 16 September [prod]). | The archive is kept. Each Life invoice is in Flow or in the archive, in a reconciliation note added to `docs/work.md`. |
| **1. Flow** | Flow | `work_summary` (3.1) with tests (pure shaper, `work-summary.int.test.ts` across two stores and two currencies, a left store hidden, a cut-off store hidden, an admin without `settings:read` sees nothing). The handoff door and the kept `next` (3.4), with tests. The account menu link (3.5). Life as an OAuth client (3.3). Agent-eval run and recording. Docs: a decision, `docs/rules/admin/integrations.md` (Kaizen Life), `commerce.md` (Work), `docs/work.md` (WP13's `work_summary` built). | A Flow `kfa_` token for a test account gets the summary through `/api/mcp`. A signed-out tap lands on the right screen after signing in. |
| **2. Life: the summary** | Life | Names: "Kaizena Flow", `kaizenaflow.com`; the provider id `kaizen_store` stays in code. The connection on Flow's server. `getWorkSummary()`. The Today section and the `/app/work` page with all their states (picture C). The redirects from old Work addresses. The Money tile's live line. The assistant's `work_summary` wrapper, its untrusted entry and its tool domain. Words in five languages. Smoke checks: the zod guard accepts what Flow sends, and the configured client reaches `work_summary`. | The owner sees picture B with Human Web's real figures, and every line opens the right Flow screen on a phone. |
| **3. Life: Work removed** | Life | Section 4, except the database, in one change, with `tools:check`, `i18n:check` and `i18n:scope` clean. Organizations under Money. | No Life screen writes Work. Finances, life areas, household and the forecast work as before, except the invoice projections. |
| **4. Life: tables dropped** | Life | The drop migration, 30 days after phase 3. Advisors checked. `types/database.ts` regenerated. The account export's table list trimmed. | Life's database has no Work tables, and the archive from phase 0 still opens. |
| **5. Later, if wanted** | both | See the list after this table. | Each by the owner's choice. |

The candidates for phase 5:

* Expected payments from Flow in the personal forecast, opt-in per space, from `currencies[].dueSoon` and `onItsWay` by due month.
* *Stop timer* on the card (a Flow tool behind `settings:write`, and the card updated at once).
* The revenue wall rebuilt as a Flow screen.
* Work webhook topics (invoice paid, timer left running), so Life can notify.
* *Add as a client in Kaizena Flow* from Life's Contacts.
* A line about overdue invoices in Life's morning briefing.

## 6. Open questions for the owner

1. **The second Life space** (4 invoices: 1 draft, 2 paid, 1 sent, the last from August). Recommended: keep it in the phase 0
   archive only, unless that work goes on. Import it into a store only if it does. If those were real invoices to customers, the
   Bookkeeping Act wants their documentation kept for five years [U]: the archive is that copy.
2. **What Organizations are called under Money.** *Jobs and income* is proposed. They hold employers and businesses, salary,
   reimbursable and repeating costs.
3. **Move Life's connection to Flow's own OAuth server now?** Recommended: yes. There is nobody to migrate, it reaches stores the
   person runs as an admin, and the person sees and controls it in Flow.
4. **The Work card outside the Work room.** Recommended: only when something is urgent (an invoice 14 or more days overdue, or a
   timer running 12 hours or more), and the person can add it for good from Today's edit mode.
5. **The revenue wall (Views).** Recommended: retire it with Life's Work (it has never been shared), and rebuild it in Flow only
   if it is missed.
6. **The name.** The request says "Kaizena Life". Is Kaizen Life being renamed? This plan uses today's name, and Flow's
   brand test keeps "Kaizen Life" as another product's name.

## 7. Evidence

* **[repo]** Flow:
  * `src/server/work-owner.ts`, `src/lib/work-owner.ts`, `src/lib/work-overview.ts`, `src/server/work-attention.ts`,
    `src/lib/work-paths.ts`, `src/server/work-time.ts`;
  * `src/server/store-mcp.ts`, `src/server/work-tools.ts`, `src/lib/oauth.ts`, `src/server/kaizen-life.ts`,
    `src/app/admin/sign-in/actions.ts`, `src/app/admin/(gated)/layout.tsx`, `src/components/admin/session.tsx`,
    `src/server/auth.ts`;
  * `docs/work.md` (§0, §1, WP13, WP15 and the import run), `docs/decisions.md` D95, D96, D122, D123, D439.
* **[repo]** Life:
  * `components/app-shell/nav-defs.tsx`, `app/app/money/page.tsx`, `app/app/finances/page.tsx`, `app/app/work/**`,
    `lib/life-area/domains.ts`, `lib/integrations/{kaizen-store,env}.ts`, `app/app/oauth/consent/page.tsx`,
    `app/app/today/page.tsx`, `app/app/today/flagged-emails-section.tsx`, `lib/agent/{mcp-tools,tool-domains}.ts`,
    `app/api/agent/organizations/route.ts`;
  * Life's `AGENTS.md`.
* **[prod]**, counts only, 9 November 2026:
  * Life (`ugljipgbugzilpfmeprc`): Work and finance table counts, invoices per space and status, `integration_connections`
    per provider, `view_share_tokens`, organizations and their salaries and costs. Life's and Flow's invoice numbers were compared
    as hashes only.
  * Flow (`ybsozesfuxuitoacntfo`): `commerce.work_*` counts, stores with Work on, `auth.identities` for `custom:kaizen-life`.
* **[docs]** Supabase, *OAuth 2.1 Server: Getting started* and `oauth.getAuthorizationDetails`: a previously approved client is
  answered with a redirect, not a consent screen.
