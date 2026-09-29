# Work: consulting hours, clients and invoices in the store admin (proposal)

Porting the **Work** area of Kaizen Life (the owner's personal life-management
app, `/home/user/lifesaver-app`) into Kaizen Store, so that store owners who are
consultants can sell and manage hours in one system. This is a design and
porting document for the people who build it. It contains no application code.

Status: the core (W1: schema, libraries, servers, screens for clients,
assignments, tasks, time, timers, invoices, print pages, settings and overview)
is built and recorded as D122 in `decisions.md`, with the defaults of section 8.
Still to build: email and hosted page, credit-note email, recurring invoices,
reports and CSV, the customer/company link, hour products and ledger, online
payment, owner tools and events (WP7b, WP8, WP9, WP10, WP1b/WP11, WP12, WP13).

Reading guide. "Life" is `/home/user/lifesaver-app`; every Life path below is
relative to it. "Store" is this repository. A **source file** is where an
implementer reads the behaviour; a **target file** is where it should land.

## 0. Summary of findings and recommendations

1. **What Life's Work really is.** Clients, one *assignment* per invoice
   (called "invoice" in the UI: the assignment is the job, its single invoice
   the bill), tasks with estimates, time entries and one running timer per
   person, invoices with per-line VAT and discount, recurring invoices,
   estimate alerts, a client period report, and a hard link into Life's
   personal Finances (budget projections and an income category tree). About a
   third of the code (organizations, salaries, reimbursements, recurring
   expenses, budget projections, the Revenue "wall" view) exists only to feed
   Life's personal budget and should **not** be ported.
2. **What Life's Work does *not* do**, although the brief assumed it might:
   it never emails an invoice ("send" only marks it sent), it does not number
   invoices (the number is free text typed by the user), it has no seller or
   client legal details (no organisation number, VAT number, address, bank
   account) and its "PDF" is the browser's print dialog on an HTML page. It
   records payment only by linking a Finances transaction (full amount, ex
   VAT). A sent invoice can be edited back to a draft, and deleting a client
   silently deletes its paid and void invoices (foreign-key cascade). **Those are acceptable for a
   personal tool and not for a store that issues legal documents**, so the
   invoice half of the port is a redesign around Store's gap-free document
   series, immutable issued documents and credit notes, not a copy.
3. **Where it lives.** A store **module** `work`, switched on under
   Features (`stores.modules`, as `bookings` and `deliveries`), with its pages
   under `/admin/{store}/work/…`, a *Work* tab and sidebar group in the store
   admin, and customer-facing pages under `/s/{store}/{market}/account/…`.
4. **Data.** New store-scoped tables in the `commerce` schema (prefix `work_`),
   money as integer minor units, time as integer minutes, VAT from
   `commerce.vat_rate()`, invoice numbers from `commerce.next_document_number()`
   in **their own series** (`work_invoice`, `work_credit_note`). The existing
   `commerce.invoices` is order-bound and unused, so there is nothing to reuse
   and no print/PDF code either; the packing-slip print page (D27) is the
   template.
5. **Selling and managing hours together (the point of the port).** Link a
   work client to a store customer company (D108); sell **hour packages** as a
   new product kind `hours` whose paid order credits the client's **hour
   ledger**; logged billable time draws the ledger down before anything is
   invoiced; the balance shows to the owner and on the customer's account
   page; time not covered is invoiced. Online payment of work invoices
   through the store's Stripe Connect account comes **last**.
6. **Language.** The store admin is English only (verified: the admin's own
   labels, buttons and messages are English literals; only shopper-facing
   previews such as the packing slip call `t()`). The Work admin is therefore English;
   Life's `messages/*/work.json` (nb, sv, en, de, es) is the wording source.
   Customer-facing documents (invoice, credit note, emails, account pages) are
   in the client's language (nb, sv, da, en hand-written; anything else falls
   back to English) and the legal wording is **never** machine-translated.

Open questions (section 8) the owner must answer before build: continuing
invoice numbers, auto-issuing recurring invoices, hour-package expiry and
consumer rules, VAT scope at launch, who sees what in the client portal, and
the platform fee on invoice payments.

---

## 1. What Life's Work does

### 1.0 Scope and a naming trap

Life uses the word "work" for two unrelated things. **Only the first is the
Work area to port.**

| | Files | Belongs to |
|---|---|---|
| **A. The Work area** (consulting: clients, invoices, time) | `app/app/work/**`, `app/work-invoice-print/[id]/page.tsx`, `app/api/work/report/route.ts`, `app/api/agent/work/route.ts`, `app/api/agent/organizations/route.ts`, `app/api/cron/work-recurring-invoices/route.ts`, `components/work/*` (the files listed in 1.11), `components/settings/work-invoice-settings.tsx`, `lib/work/*` (except the four below), `server/actions/work*.ts`, `server/queries/work-data.ts`, `work-contacts.ts`, `server/services/work-line-task-sync.ts`, `server/services/agent-work.ts`, `messages/*/work.json`, `docs/events/work.md`, migrations in 2.7 | this port |
| **B. "Work" as the word for a piece of work in Life's task system** (checklist items, projects, boards, agent personas) | `components/work/work-activity.tsx`, `ask-persona-picker.tsx`, `project-item-stage-picker.tsx`; `server/queries/work-items.ts`, `work-activity.ts`, `project-work.ts`; `lib/work/fields.ts`, `due.ts`, `primary-project.ts`, `project-tasks.ts`; table `work_activity_messages` (renamed from `task_activity_messages`), enum `work_origin_kind`, enum `life_context`, `task_workflow_statuses`, `task_projects`, `primary_project_id` | **not ported** (no relation to clients or invoices; verified by reading every file and every foreign key) |

Consequences: `work_tasks` (assignment tasks) have **no link** to Life's
tasks, projects, checklists or workflow statuses. The "activity feed" in the
Work area is only the invoice's history panel (1.9), not
`work_activity_messages`.

Dead code in Life to ignore: `components/work/clients-tab.tsx`,
`work-assignment-detail.tsx`, `work-organization-expense-category-form.tsx`,
`work-organization-recurring-expense-form.tsx` are imported nowhere;
`markWorkInvoicePaid` (`server/actions/work-invoices.ts`) has no caller;
`work_milestones` is a table with no code; `addWorkInvoiceLineFromAssignment`
is reachable only from the dead assignment-detail screen.

### 1.1 Screens and routes

| Life route | Source | What it shows and does |
|---|---|---|
| `/app/work` | `app/app/work/page.tsx`, `components/work/work-tabs.tsx`, `work-home.tsx`, `organizations-tab.tsx` | Two segmented tabs, `overview` (default) and `organizations` (`?tab=organizations`; `clients` is an alias). Header links: Invoices, Reports, Revenue view (Life-only), and on the organizations tab "Add organization". **Overview:** three stat cards (client count; *active* = drafts among the eight most recently updated active/paused assignments; *unbilled* = sum of billable minutes on every assignment whose status is not `invoiced`); "Open invoices" = every draft, newest first (title, client, status badge, total incl. VAT); the client directory (name, "N active · X h logged"; add-client sheet); "Recent invoices" = the five latest non-draft, non-void; link "Create a period report". **Organizations tab:** per organization a block (name, notes, client count, add client, settings link, delete only when it has no clients) listing its clients and, under each, that client's invoices with status, hours and totals. |
| `/app/work/invoices` | `app/app/work/invoices/page.tsx`, `invoices-list.tsx`, `invoice-create-sheet.tsx`, `recurring-invoice-autosend-trigger.tsx` | Table of invoices: name, client, type (regular or recurring), issue date `dd.mm.yyyy`, amount incl. VAT, status badge, delete button on drafts. Filter chips All / Draft / Sent / Paid (**All hides void**; there is no void chip, voided invoices are reachable from the client page) and a client dropdown. "New invoice" sheet: name + client, which creates an hourly assignment plus its draft invoice and opens it. On mount it fires `runRecurringInvoiceAutosend()` (see 1.6). |
| `/app/work/invoices/[id]` | `app/app/work/invoices/[id]/page.tsx`, `invoice-detail.tsx`, `invoice-lines-editor.tsx`, `invoice-live-totals.tsx`, `invoice-totals-footer.tsx`, `invoice-work-panels.tsx`, `work-tasks-panel.tsx`, `work-time-panel.tsx`, `work-log-time-sheet.tsx`, `estimate-alerts.tsx`, `use-work-timer.ts`, `invoice-export-controls.tsx` | The workhorse. Header: client (eyebrow), title (assignment name, else client), status badge ("Payment received" when a Finances transaction is linked), `#number`, live total incl. VAT, due-date hint. Overflow menu: Details, Edit (assignment form), Client, PDF (opens the print page), CSV. Two tabs when the invoice has an assignment (recurring instances do not): **Billing** and **Work**. *Billing:* the lines editor (drag to reorder; description, qty/hours, rate, discount %, VAT %, excl., incl.; 600 ms autosave), live totals footer (subtotal excl., discount when >0, VAT, total incl.), "Round up hours" menu (15/30/60 min), and per status the forms: draft -> Mark as sent, Delete draft; sent -> Revert to draft, Void; void -> Recover to draft. *Work:* logged/billable hours and amount, estimate utilisation, "Log time", and sub-tabs Tasks (rapid-add, drag-reorder, rename, done toggle, estimate field, "h left / h over", play/stop clock, "+ time", delete) and Logged time (search, task filter, inline note, delete). Details sheet: invoice number, issue date, payment terms days, notes, estimate-alert settings. Below: "History" (last ten `space_events` for this invoice; link to Life's Activity page). |
| `/app/work/clients/[id]` | `app/app/work/clients/[id]/page.tsx`, `work-client-detail.tsx`, `client-contacts-card.tsx`, `work-client-form.tsx`, `work-client-recurring-invoices-panel.tsx`, `work-recurring-invoice-form.tsx`, `work-assignment-form.tsx` | Client name, primary contact and email, default rate; edit and delete. Contacts card (people from Life's Contacts whose company matches; primary starred; mailto/tel; add). Recurring-invoices panel (per template: amount, "every N period from date", paused badge; buttons send-current-period, pause/resume, edit, delete). Invoices list: assignments with billing type, logged hours, status, delete on drafts; recurring instances (period, amount, status). "New invoice" chooser: *Regular* (assignment form) or *Recurring* (template form). On render it generates missing **draft** occurrences for the client's active templates (`generateDueRecurringInvoices`). |
| `/app/work/assignments/[id]` | `app/app/work/assignments/[id]/page.tsx` | Legacy: redirects to the assignment's invoice. |
| `/app/work/organizations/[id]` | `app/app/work/organizations/[id]/page.tsx`, `work-organization-detail.tsx`, `lifeArea` components | Organization (name, notes), tabs General / Income (salary, reimbursements) / Expenses (categories, recurring expenses). **Life-only budgeting, see 3.** |
| `/app/work/reports` | `app/app/work/reports/page.tsx`, `work-reports-wizard.tsx` | Client period report wizard: pick client, period (this month / last month presets or dates), preview per assignment (billing type, period hours and amount, entry table date/task/hours), CSV download, print. |
| `/app/work/reports/print` | `reports/print/page.tsx`, `work-report-print.tsx` | Print view: client, period, total hours and amount, per assignment table date/task/note/hours. |
| `/work-invoice-print/[id]` | `app/work-invoice-print/[id]/page.tsx`, `invoice-auto-print.tsx` | A4 print page (opens the print dialog after 350 ms): organization name and notes as the seller block, "Invoice", number, issued, due, "Bill to" (client name, contact email, client notes), lines table, totals (excl., VAT, incl.), notes. Requires sign-in, not the feature gate. |
| `/api/work/report?format=csv\|json&clientId&start&end` | `app/api/work/report/route.ts` | The report as CSV download or JSON. |
| `/app/settings` (Work invoices section) | `components/settings/work-invoice-settings.tsx`, `updateSpaceWorkVat` | One field: default VAT % for the space (0-100, default 25), autosaved. |
| `/app/views/revenue` | `server/queries/views-revenue.ts` | The **Revenue view**: a wall display of the month's money in four tiers (paid, sent, drafted, estimated), VAT-inclusive, per currency, plus a moments feed and running clocks. Life-only, not ported (see 3). |

### 1.2 Entities and statuses

* **Client** (`work_clients`): name (required), contact email, primary contact
  (a Life Contact), default hourly rate, currency (3 letters, default NOK),
  payment terms in days (1-90, blank = inherit), notes (printed on the
  invoice's "Bill to"), sort order, and a required **organization**.
  A client and a Contacts company are one account when their names normalise
  the same way (`lib/work/client-company.ts`, `companySlug`); renaming the
  client renames the company on the contact cards
  (`renameContactsCompany`).
* **Assignment** (`work_assignments`): the job. Name, billing type
  `hourly | fixed_fee`, hourly rate override, fixed amount, estimated hours,
  start and end date, status `active | paused | done | invoiced`.
  `invoiced` is set **only** by sending its invoice (`work.useInvoiceToMarkInvoiced`
  refuses it in the form) and is undone (`done`, `invoiced_at` null) by
  revert or void. Creating an assignment **always creates its draft invoice**
  (`insertDraftInvoiceForAssignment`), and the database allows at most one
  invoice per assignment (`idx_work_invoices_one_per_assignment`). Deleting a
  draft invoice **deletes its assignment**, and through cascade every task and
  time entry logged on it.
* **Task** (`work_tasks`): title, status `open | done`, estimated hours
  (>= 0, blank = none; the estimate field accepts a comma and rounds to two
  decimals), sort order.
* **Time entry** (`work_time_entries`): date, minutes (integer > 0), billable
  flag, optional task, note (<= 500 chars, the only field editable after
  logging; changing minutes means delete and re-log), the person who logged it.
* **Timer** (`work_time_timers`): a running clock on an assignment and
  optionally a task. **One per person per space.**
* **Invoice** (`work_invoices`) and **lines** (`work_invoice_lines`): see 1.4.
* **Recurring invoice** (`work_recurring_invoices`): a template, see 1.6.

**Invoice status and transitions** (all in `server/actions/work-invoices.ts`
and `lib/work/send-invoice.ts`):

| From -> To | Rule |
|---|---|
| (new) -> `draft` | Created with the assignment (issue date today, currency of the client), or generated from a recurring template. |
| `draft` -> `sent` (`sendWorkInvoiceWithCtx`) | Needs >= 1 line. `issued_on` = the typed date, else today. `sent_at` = now. `due_on` = **the day it is sent** + payment days (see 1.5), UTC calendar. Totals frozen into `subtotal_excl_vat`, `total_vat`, `total_incl_vat`. Every assignment on the invoice (its own and the lines') becomes `invoiced`, `invoiced_at` = now. Budget projection synced (Life-only). Event `work_invoice.sent.v1`. Shared by the user action and the cron (`source` `web` or `cron`, actor `user` or `system`). |
| `sent` -> `draft` (`revertWorkInvoiceToDraft`) | Refused when a Finances payment is linked (`invoice.cannotRevertWithPayment`). Clears `due_on`, `sent_at`, `paid_at`; assignments -> `done`. Event `reverted_to_draft`. |
| `draft`/`sent` -> `void` (`voidWorkInvoice`) | The UI offers it only for `sent`; the action also accepts `draft`. Clears `sent_at`, `paid_at`; assignments -> `done`; projection deleted; the recurring template's projections resynced. A **paid** invoice cannot be voided ("in v1"). Event `voided`. |
| `void` -> `draft` (`recoverVoidWorkInvoiceToDraft`) | Needs >= 1 line, no linked payment, no other draft for the same client (legacy guard), and each assignment not already on another sent/paid invoice. |
| `sent` -> `paid` | Only through **Finances**: the user records an income transaction against the invoice (`createFinanceTransaction` in `server/actions/finance.ts`): the invoice must be `sent`, the category must be the invoice's own income category, and the transaction amount is forced to `subtotal_excl_vat` (**ex VAT**); the invoice gets `finance_transaction_id`, status `paid`, `paid_at` = the entered date at 12:00 UTC. Event `work_invoice.payment_received.v1`. The dormant `markWorkInvoicePaid` does the same without a transaction (`paid.v1`). Deleting the finance transaction does **not** revert the invoice (a Life gap, do not copy). `paid` is terminal. |
| `draft` -> deleted (`deleteWorkInvoice`) | Drafts only, not with a linked payment. Deletes the assignment (cascade) and re-syncs the recurring template. Event `deleted`. |

Other guards: a sent or paid invoice's lines cannot be edited or deleted
(`invoice.draftOnlyEdit`); a void invoice's meta cannot be edited; an
assignment already on a sent/paid invoice's lines cannot be added to another
invoice (`assertAssignmentBillable`, `invoice.alreadySentOrPaid`); a client
with draft or sent invoices cannot be deleted (`assertClientDeletable`, a
plain `Error`, shown raw), but the foreign key `work_invoices.client_id ... on
delete cascade` silently removes **paid and void invoices** with the client.

### 1.3 Invoice numbering

There is **none**. `work_invoices.invoice_number` is nullable free text typed in
the details sheet (editable while `draft` or `sent`), not unique, never
generated. It is shown as `#number`, in CSV/print, and used as a fallback name.
(Contrast Store, 4.4.)

### 1.4 Lines, VAT and totals: the exact formulas

Source: `lib/work/invoice-calc.ts` (client and server share it), stored by
`linePayloadToStored`. All amounts are JavaScript floats rounded with
`roundMoney(n) = Math.round(n * 100) / 100`.

```
qty      = max(0, quantity_hours)          rate = max(0, unit_rate)
disc     = clamp(discount_percent, 0..100) vat  = clamp(vat_percent, 0..100)
gross    = qty * rate
excl     = roundMoney(gross * (1 - disc/100))
discount = max(0, roundMoney(gross) - excl)          // only for display
vatAmt   = roundMoney(excl * vat/100)
incl     = roundMoney(excl + vatAmt)
invoice.subtotalExcl = roundMoney(sum of line excl)
invoice.totalVat     = roundMoney(sum of line vatAmt)     // VAT is rounded PER LINE
invoice.totalIncl    = roundMoney(sum of line incl)
invoice.totalDiscount= roundMoney(sum of line discount)
```

* **VAT resolution:** a line's `vat_percent` if it is a finite number, else the
  space default (`spaces.work_default_vat_percent`, 25). A blank VAT field is
  sent as `null` and stored as the default at save time. Per-line VAT allows
  0 % lines (Life's users zero-rate export clients this way; the Revenue view
  guesses a client's VAT from its latest invoice's lines).
* **Draft vs sent:** while `draft`, totals are always recomputed from the
  lines; on `sent`/`paid` the header columns are authoritative
  (`invoiceDisplayTotal`, `getWorkInvoiceDetail`).
* **`splitInclAmount(incl, vat)`** (recurring templates only): `incl` rounded,
  `excl = roundMoney(incl / (1 + vat/100))`, `vat = roundMoney(incl - excl)`.
  Recurring amounts are **VAT-inclusive** and split at the space default.
* **`roundUpHours(hours, step)`** for step in 15/30/60: `minutes =
  Math.round(hours*60)`, `periods = ceil(minutes/step)`, result
  `periods*step/60`; zero stays zero. The button (drafts only) rewrites every
  line's quantity; time logged afterwards rewrites the line again from the
  entries.
* **`UNNAMED_LINE = "Line item"`:** a line with no description is stored under
  this literal and edited as an empty field (not a translation, so it works in
  every UI language).
* **Line defaults:** "Add line": qty 1, rate = the client's default hourly
  rate (or empty), discount 0, VAT default. A line created from a task
  (below) is priced at the assignment's effective rate.
* **`effectiveHourlyRate`** = 0 for fixed-fee, else `assignment.hourly_rate ??
  client.default_hourly_rate ?? 0`. **`computeBillableAmount`** = the fixed
  amount for fixed-fee, else `minutesToHours(billableMinutes) * rate`, where
  **`minutesToHours(m) = round(m/60 * 100)/100`** (two decimals, so 20 min is
  0.33 h). `formatHours` shows `x,xx h`.
* Line constraints: description non-empty, amounts >= 0 (**no negative lines,
  no credit lines**), discount 0-100, VAT 0-100.

**Lines and tasks are two views of one piece of work**
(`server/services/work-line-task-sync.ts`, column `work_invoice_lines.task_id`,
`on delete set null`):

* Saving lines (`saveWorkInvoiceLines`) is an **upsert by id** that keeps ids,
  preserves list order in `sort_order`, deletes missing lines, and (when the
  invoice has an assignment) gives every unpaired line a task (estimate =
  the line's quantity, or none if 0), renames tasks to match their lines and
  deletes the tasks of removed lines.
* Adding or renaming a task mirrors it as a draft line (`syncTaskToDraftLine`),
  priced at the assignment's effective rate with **quantity = the task's
  estimate (else 0)**, VAT the default; deleting a task deletes its **draft**
  line only (sent lines are kept, the FK nulls their `task_id`).
* Logging or deleting time on a task rewrites its draft line's **quantity to
  the task's total billable minutes** as hours (`syncTaskHoursToDraftLine`,
  rate, discount and VAT kept, totals recomputed). **Fixed-fee assignments are
  skipped** (decided from the invoice's assignment *or* the line's, so hand
  typed fixed-fee lines are not rewritten as hours x fee; documented in the
  file after three past bugs). Non-billable entries are excluded. Time logged
  with no task changes no line.
* After every such write the invoice's budget projection is recomputed
  (Life-only).

### 1.5 Payment terms and due dates

`lib/work/payment-due-days.ts`, `lib/work/invoice-dates.ts`:

* `INVOICE_PAYMENT_DUE_DAYS = 14`; allowed 1-90 (`MIN/MAX_PAYMENT_DUE_DAYS`,
  form parse error `work.invalidPaymentDueDays`).
* `resolvePaymentDueDays({invoice, client})` = invoice override, else client
  default, else 14, clamped to 1-90.
* **At send:** `due_on = sentOn + days` where `sentOn` is **today (UTC)**, not
  the typed issue date, "otherwise an invoice sent late is already overdue"
  (comment in `send-invoice.ts`). `issued_on = typed ?? sentOn`.
* **Draft:** `due_on` is null; the UI shows an estimate = today + days
  ("Payment due (estimate)"), which moves until sent.
* Editing meta on a **sent/paid** invoice sets `due_on = issued_on + days`
  (a different base than at send: an inconsistency; do not copy).
* Recurring occurrences copy the template's `payment_due_days`.
* `dueOnFromIssuedDate` adds UTC calendar days
  (`lib/dates/utc-day-param.ts`); `payment-due-days.test.ts` fixes
  `2026-04-02 + 14 = 2026-04-16`.

### 1.6 Recurring invoices: schedule, generation, auto-send

Template (`work_recurring_invoices`): name (becomes the line description),
amount (**VAT-inclusive**, > 0), currency (copied from the client at creation),
`recurrence_interval` 1-4, `recurrence_period` `week | month | year`,
`recurrence_start_date`, `payment_due_days`, `is_active`, sort order.

**Schedule** (`lib/work/recurring-expense-schedule.ts`, shared with Life's
expenses; `listOccurrenceDates(rule, rangeStart, rangeEnd)`, UTC, all
computed from the start date so nothing drifts):

* `week`: `start + k * 7 * interval` days.
* `month`: `start + k * interval` months keeping the start's day-of-month,
  clamped to the month's last day (31 Jan -> 28 Feb -> 31 Mar). At most 240
  iterations.
* `year`: `start + k * interval` years by the same rule. At most 40.
* The window used everywhere is `[first day of (current month - 24), today]`
  (`recurringInvoiceProjectionMonthKeys`: 24 months back, 2 ahead).

**Generation** (`lib/work/recurring-invoice-generate.ts`):

* `generateRecurringInvoiceForPeriod(template, occurrenceDate)` is idempotent
  (returns the existing invoice for `(recurring_invoice_id, recurring_period)`,
  unique index `idx_work_invoices_recurring_period`). It inserts a **draft**
  invoice: `assignment_id null`, `issued_on = occurrence date`,
  `payment_due_days` from the template, one line (description = template name,
  qty 1, rate = the ex-VAT part of the amount, VAT = space default,
  totals from `splitInclAmount`), then event `work_invoice.created.v1`.
* `generateDueRecurringInvoices` (client detail page render) creates missing
  drafts for every due date in the window, never sends, and reports whether it
  generated anything (then the page refetches). It costs zero queries when the
  client is caught up (the diff is computed from data already loaded).

**Auto-send** (`lib/work/recurring-invoice-autosend.ts`, always on for every
active template, **there is no switch**): for each active template and each
due date <= today in the window: an existing **draft** occurrence is sent
whatever its age; a missing occurrence is generated then sent only if
`date >= today - 40 days` (`GENERATE_LOOKBACK_DAYS`, so a template created
long ago does not bill years at once); sent/paid/void occurrences are skipped.
Each send is in a try/catch and logged; the result is the number sent. "Send"
is `sendWorkInvoiceWithCtx`, i.e. **only a status change, no email**.

Triggers: daily Vercel cron `0 6 * * *` -> `GET /api/cron/work-recurring-invoices`
(`isAuthorizedCron`, `CRON_SECRET`; for each space with an active template, acts
as the space **owner** with the service-role client and `role: "owner"`;
`maxDuration` 60), and, as a fallback, the invoices page mount
(`RecurringInvoiceAutosendTrigger` -> server action, idempotent).
"Send current period" on a template (`sendRecurringInvoiceCurrentPeriod`)
takes the first due date whose occurrence is missing (generate) or a draft,
sends it, and errors `work.recurringInvoiceNothingToSend` otherwise.

Known quirks to fix in the port: deleting a **draft occurrence** removes the
row, so the next cron run regenerates **and sends** it while it is within 40
days; the template has no end date; no per-template switch for auto-send; the
cron runs as the owner, so multi-user attribution is lost.

### 1.7 Time entries and timers

* **Log time** (`logWorkTime`): assignment, date (default today, UTC ISO slice),
  minutes > 0 (rounded to integer), optional task, note, billable checkbox.
  The table trigger `work_time_entries_set_space` copies `space_id` from the
  assignment. Logging mirrors the task's hours onto its draft line (1.4) and
  emits `work_time.logged.v1`.
* **Timer rule: one per person per space** (`work_time_timers_one_per_user`
  unique on `(space_id, user_id)`; smoke test proves a second insert fails).
  `startWorkTimer` first **stops and logs** a running timer, then inserts. It is
  a database row, not a browser clock, so it survives reloads and devices, and
  the assistant can see it. `stopWorkTimer`: `minutes = max(1,
  ceil(elapsed / 60 s))`, `work_date` = the **UTC date the clock started**,
  `billable = true`, `note = null`; the timer row is deleted and an entry is
  inserted with the same code path as manual logging.
* Client: `use-work-timer.ts` is optimistic (the clock stops and the minutes
  show as already logged before the server answers; stale refreshes are
  ignored until the server agrees). `useRunningSeconds` ticks the live totals
  only when the timer's task has a line on this invoice.
* Entries panel: `filterTimeEntries` (`lib/work/time-entries.ts`): task filter
  (a task id, or `__none__` = invoice-level entries) and a case-insensitive
  search over the task title and the note. Delete removes an entry (also for
  entries on **sent** invoices: no lock in Life).

### 1.8 Estimate alerts

`lib/work/estimate-alerts.ts`, `components/work/estimate-alerts.tsx`, columns
`work_invoices.estimate_alert_minutes` (default 10, null = off, 1-480),
`estimate_alert_popup` (default true), `estimate_alert_sound` (default false),
edited in the invoice details sheet (`updateWorkInvoiceMeta`,
`parseEstimateAlertForm`, error `work.invalidEstimateAlertMinutes`).

* `remainingMinutes(estimatedHours, spent) = round(estimatedHours*60) - spent`
  (null when the task has no estimate).
* `estimateStage(remaining, threshold)`: `over` when remaining <= 0; `near`
  when remaining < threshold (**strictly less**: exactly the threshold has not
  fired); `ok` otherwise or when either input is null.
* Armed only while a timer runs on a task **with an estimate**, warnings are
  not off, and popup or sound is on. Checked every 5 s from the invoice page
  (so it fires from either tab): `spent = logged minutes on the task (billable
  or not) + floor(elapsed minutes)`. Each stage fires **once per running
  timer**, remembered in `localStorage` key `work-estimate-alert:{timerId}`.
  Popup = a sheet; sound = a Web Audio chime (two rising notes for near, three
  for over). No background process: only while the page is open.
* The row shows "1,50 h left / 0,25 h over / 0,75 h" and the running h:mm:ss.

### 1.9 Reports, exports and the history panel

* **Client period report** (`buildWorkReportPayload`, `workReportToCsv`): for a
  client and `[start, end]`, per assignment: entries in the window,
  `periodMinutes`, `periodBillableMinutes`, `periodAmount` =
  `round2(minutesToHours(periodBillableMinutes) * effectiveRate)` for hourly,
  `fixed_amount` for fixed-fee (the **whole fee in every period** it is shown:
  a Life bug), assignments with no entries and status `invoiced` are dropped,
  and the list is filtered to `periodMinutes > 0 || fixed_fee`. Totals:
  minutes, billable minutes, amount (**ex VAT**, from rates, not from invoice
  lines). CSV: header block, per-assignment rows (billing type, hours,
  billable hours, amount), an entries block (date, assignment, task, minutes,
  billable yes/no, note) and a total row. Print view adds the notes and
  `Total hours / Total`.
* **Invoice CSV** (`invoice-export-controls.tsx`, browser side): invoice
  number, organisation, client, client email, issued, due, currency, lines
  (description, qty, rate, discount %, VAT %, excl., incl.), subtotal, VAT,
  total; UTF-8 with BOM.
* **Invoice print** (`/work-invoice-print/[id]`): see 1.1. The "PDF" is the
  browser's Save as PDF. No seller identity beyond the organization's free
  text `notes`.
* **History panel** (`EntityHistory`, `listSpaceEvents`): the invoice's last 10
  events (`space_events` where `entity_type = work_invoice`); the shared
  Activity page (`/app/activity`, `components/activity/activity-feed.tsx`)
  shows work events of types `work_invoice`, `work_client`,
  `work_assignment`, `work_time_entry`.
* **Revenue view** (`server/queries/views-revenue.ts`): month money in tiers
  Paid (by `paid_at`), Sent (by `sent_at`), Drafted, Estimated (uninvoiced
  task estimates, priced at the rate and the client's inferred VAT), per
  currency, never summed across currencies. Life-only; the ideas that are worth
  keeping are in 6.5.
* Dashboards that read Work (`analytics-dashboard.ts`, `weekly-review.ts`) are
  Life features.

### 1.10 Contacts and organizations

* **Contacts.** No foreign key except `work_clients.contact_id` (the primary
  contact, the person the invoice goes to; choosing one fills the email when
  empty; `on delete set null`). Everything else is by **name**: contacts whose
  card's `company` normalises like the client's name appear on the client page,
  "add contact" files the person under the client's name, and the Contacts
  company page offers "make client" (`components/contacts/company-client-card.tsx`,
  `getClientForCompany`, `listClientsForContact`). Queries:
  `server/queries/work-contacts.ts`.
* **Organizations** (`life_area_groups` where `domain = 'work'`, the shared
  "life area" table also used by training, health and household): a
  **required** parent of every client (`work_clients.organization_id not null,
  on delete restrict`), unique name per space and domain, notes, and two
  Finances categories (income main, expense main). Its printed `name` and
  `notes` are the invoice's seller block. Tabs: Income (one fixed **salary**
  per organization with a recurrence, plus reimbursable expenses one-off or
  recurring) and Expenses (categories and recurring/one-off expenses), all of
  which write budget projections into Life's Finances
  (`finance_life_area_*_projections`, `lib/life-area/*`). Nothing in it is
  about selling to clients.

### 1.11 Permissions, gating, agent API, events, i18n

* **Permissions.** Every table has RLS with `is_space_member(space_id)` (through
  the parent for tasks, milestones and lines): **any member of the space,
  including role `viewer`, can read and write everything** (there are no role
  checks in the actions). Inserts additionally require `created_by =
  auth.uid()` (assignments, invoices) or `user_id = auth.uid()` (time entries,
  timers); timers can be deleted only by their owner and have no UPDATE policy.
  Gating: `requireFeaturePage("page.work", …)` in `app/app/work/layout.tsx`
  (subscription entitlement `page.work`); the print page checks sign-in only.
  The cron and the agent API use the service role.
* **Agent API** (`docs/agent-api.md`, `lib/agent/*`): `GET /api/agent/work`
  (scope `read:work`, feature `page.work`) returns `mapWorkPageData`: stats,
  recent invoices, organizations with clients and invoices, clients. `POST
  /api/agent/organizations` (scope `write:work`) and dispatch tools
  `create_organization`, `update_organization`, `delete_organization`
  (`server/services/agent-work.ts`; delete needs `confirm: true` and refuses an
  organization with clients). **Nothing** for clients, invoices, time or
  timers.
* **Events** (`emitDomainEvent` -> `space_events`, registry
  `lib/events/registry.ts`; `docs/events/work.md` is incomplete). Emitted by the
  Work code: `work_client.{created,updated,deleted,finance_category_linked}`,
  `work_assignment.{created,updated,deleted}` (+ legacy `invoiced`),
  `work_task.{created,updated,toggled,deleted,reordered}`,
  `work_time.{logged,deleted}`,
  `work_invoice.{created,updated,sent,reverted_to_draft,recovered_to_draft,paid,payment_received,voided,deleted,budget_projection.synced,finance_category_linked}`,
  `work_recurring_invoice.{created,updated,deleted,budget_projection.synced}`,
  and the organization/expense families (Life-only). A safety-net trigger
  (`work_time_entries_record_changed`, `tg_emit_record_changed`) writes
  `record.changed.v1` for direct table writes not covered by an event within 3
  seconds.
* **i18n.** Namespace **`work`** in `messages/{nb,sv,en,de,es}/work.json`:
  **471 flat dotted keys, identical in all five languages**. Prefixes: `page`,
  `auth.signInRequired`, `tabs`, `nav`, `stats`, `home`, `organizations`,
  `clients`, `client` (`client.detail`, `client.newInvoice`,
  `client.recurringInvoices`, `client.recurringInvoice`, `client.contacts`),
  `organization` (Life-only), `clientForm`, `assignmentForm`, `assignment`,
  `tasks`, `time`, `invoices`, `invoice` (`status`, `create`, `detail`,
  `lines`, `totals`, `export`, `roundUp`), `estimate` (`settings`, `alert`),
  `reports`, `lifeArea`, `company.card`. Also `settings.workInvoices.*`
  (`messages/*/settings.json`), the `errors` namespace codes `work.*`,
  `invoice.*` and `finance.*` (thrown as `AppError(code)` and mapped by
  `getErrorMessage`), and `activity` for the history panel. Loaded with
  `ExtraMessages namespaces={["contacts","lifeArea","work"]}`.

---

## 2. Life's data model, as it stands after every migration

Schema `public`, Supabase, RLS on. Folded from these migrations in
`supabase/migrations/` (in order): `20260529120000_work_module`,
`20260531120100/120200_space_events_safety_net(+_dedupe)`,
`20260601120000_work_invoices`, `20260602120000_invoice_line_vat_discount`,
`20260603120000_invoice_per_assignment`, `20260628120000_work_finance_integration`,
`20260629120000_work_organizations`, `20260630120000_work_organization_recurring_expenses`,
`20260631120000_work_organization_expense_categories`,
`20260701120000_work_recurring_expense_recurrence`,
`20260702120000_life_area_expense_unification`,
`20260728120000_work_invoice_finance_categories`,
`20260729120000_work_employment_income`,
`20260804120000_expense_one_off_and_recurring_invoices`,
`20260805120000_invoice_projection_vat_split`,
`20260825120000_work_payment_due_days`,
`20260826120000_recurring_invoice_instances`,
`20270407090000_work_model_alignment` (Life tasks only),
`20270411090000_work_activity_and_start` (Life tasks only),
`20270916090000_invoice_line_task_link`, `20270917090000_work_time_timers`,
`20270918090000_invoice_estimate_alerts`, `20270919090000_work_client_contact`,
`20270920091000_invoice_transition_dates`, `20270922091000_fk_covering_indexes`.
Not Work: `20260604120000_task_projects_workflow`,
`20270324090000_checklist_workflow_statuses`, `20261011120000_workflow_status_default_colors`,
`20261020120000_personal_work_context`, `20270908090000_contact_life_spaces`.
Helper functions used throughout: `public.is_space_member(uuid)` (security
definer: the caller has a row in `space_memberships` for the space, **role is
not checked**) and `public.touch_updated_at()` (sets `updated_at`).

Legend: **[L]** = exists only for a Life integration (Finances, Organizations,
Contacts, events); **[P]** = personal-finance budgeting; every table's `space_id
... on delete cascade` becomes `store_id`.

### 2.1 Enums

| Enum | Values | Note |
|---|---|---|
| `work_billing_type` | `hourly`, `fixed_fee` | |
| `work_assignment_status` | `active`, `paused`, `done`, `invoiced` | `invoiced` is system-set |
| `work_task_status` | `open`, `done` | |
| `work_invoice_status` | `draft`, `sent`, `paid`, `void` | |
| `work_invoice_budget_tag` | `estimate`, `sent` | **[L][P]** |
| `life_area_domain` | `work`, `training`, `health_nutrition`, `household` | **[L]** |
| `life_area_income_source_kind` | `salary`, `reimbursement` | **[L][P]** |
| `life_area_reimbursement_schedule_kind` | `recurring`, `one_off` | **[L][P]** (also used by expenses) |

### 2.2 `work_clients`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `space_id` | uuid not null | -> `spaces`, cascade |
| `name` | text not null | check `char_length(trim(name)) > 0` |
| `contact_email` | text | |
| `contact_id` | uuid | -> `contacts`, `on delete set null`; **[L]**; index `work_clients_contact_id_idx` |
| `default_hourly_rate` | numeric(14,2) | check `>= 0` or null |
| `currency` | text not null default `'NOK'` | check `char_length(trim(currency)) = 3` |
| `notes` | text | printed under "Bill to" |
| `payment_due_days` | integer | check null or 1-90 |
| `organization_id` | uuid not null | -> `life_area_groups`, `on delete restrict`; **[L]** |
| `finance_category_id` | uuid | -> `finance_categories`, set null; **[L][P]**; partial index where not null |
| `sort_order` | integer not null default 0 | |
| `created_at`, `updated_at` | timestamptz not null default now() | `work_clients_touch_updated_at` |

Indexes: `idx_work_clients_space_sort (space_id, sort_order, name)`,
`idx_work_clients_organization (organization_id, sort_order)`.

### 2.3 `work_assignments`

`id`, `space_id` (cascade), `client_id` -> `work_clients` **cascade**, `name`
(non-empty), `status` (`work_assignment_status`, default `active`),
`billing_type` (default `hourly`), `hourly_rate` numeric(14,2) (>= 0),
`estimated_hours` numeric(10,2) (>= 0), `fixed_amount` numeric(14,2) (>= 0),
`start_date` date, `end_date` date, `invoiced_at` timestamptz, `sort_order`,
`created_by` -> `auth.users` cascade, timestamps (`touch_updated_at`).
Indexes: `idx_work_assignments_client (client_id, sort_order)`,
`idx_work_assignments_space_status (space_id, status)`,
`idx_work_assignments_created_by` (fk covering).

### 2.4 `work_tasks`

`id`, `assignment_id` -> `work_assignments` cascade (**no `space_id`**), `title`
(non-empty), `status` (`work_task_status`, default `open`), `estimated_hours`
numeric(10,2) (>= 0), `sort_order`, timestamps. Index
`idx_work_tasks_assignment_sort (assignment_id, sort_order)`.

### 2.5 `work_time_entries`

`id`, `space_id` (cascade; **filled by trigger** `tg_work_time_entries_set_space`
before insert or update of `assignment_id`, from the assignment), `assignment_id`
-> `work_assignments` cascade, `task_id` -> `work_tasks` **set null**, `user_id`
-> `auth.users` cascade, `work_date` date, `minutes` integer (check `> 0`),
`billable` boolean default true, `note` text, timestamps. Indexes:
`idx_work_time_entries_assignment_date (assignment_id, work_date desc)`,
`idx_work_time_entries_space_date (space_id, work_date desc)`, covering
indexes on `task_id`, `user_id`. Trigger `work_time_entries_record_changed`
(after insert/update/delete; safety-net event) **[L]**.

### 2.6 `work_time_timers`

`id`, `space_id` (cascade), `user_id` (cascade), `assignment_id` -> assignments
cascade, `task_id` -> tasks **cascade**, `started_at` default now(),
`created_at`. **Unique index `work_time_timers_one_per_user (space_id,
user_id)`** (the "one running timer per person" rule). No `updated_at`, no
UPDATE policy. Covering indexes on `assignment_id`, `task_id`, `user_id`.

### 2.7 `work_milestones` (unused)

`id`, `assignment_id` cascade, `name`, `period_start`, `period_end` (check
`period_start <= period_end`), `created_at`. Index on `assignment_id`. No code
reads or writes it. **Leave out.**

### 2.8 `work_invoices`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `space_id` | uuid not null | cascade |
| `client_id` | uuid not null | -> `work_clients` **cascade** |
| `assignment_id` | uuid | -> `work_assignments` **cascade**; **unique partial index `idx_work_invoices_one_per_assignment` where not null** (1:1) |
| `status` | `work_invoice_status` not null default `draft` | |
| `invoice_number` | text | free text, not unique |
| `issued_on` | date | |
| `due_on` | date | set at send |
| `sent_at`, `paid_at` | timestamptz | real timestamps (not the typed `issued_on`); backfilled from `space_events` [L]; index `idx_work_invoices_space_paid_at (space_id, paid_at desc nulls last)` |
| `currency` | text not null default `'NOK'` | check length 3; copied from the client at creation |
| `notes` | text | |
| `payment_due_days` | integer | check null or 1-90 |
| `subtotal_excl_vat`, `total_vat`, `total_incl_vat` | numeric(14,2) | **frozen at send**; null on drafts |
| `recurring_invoice_id` | uuid | -> `work_recurring_invoices`, **set null** |
| `recurring_period` | date | the occurrence date; **unique partial index `idx_work_invoices_recurring_period (recurring_invoice_id, recurring_period)`** where `recurring_invoice_id is not null`; plain index on `recurring_invoice_id` |
| `estimate_alert_minutes` | integer default 10 | check null or 1-480 |
| `estimate_alert_popup` | boolean not null default true | |
| `estimate_alert_sound` | boolean not null default false | |
| `finance_transaction_id` | uuid | -> `finance_transactions` set null; **[L]** |
| `finance_category_id` | uuid | -> `finance_categories` set null; **[L][P]**; partial index |
| `created_by` | uuid not null | -> `auth.users` cascade |
| `created_at`, `updated_at` | timestamptz | `touch_updated_at` |

Other indexes: `idx_work_invoices_space_status_issued (space_id, status,
issued_on desc nulls last)`, `idx_work_invoices_client_status (client_id,
status)`. The original "one draft per client per space" unique index was
**dropped** by `invoice_per_assignment`.

### 2.9 `work_invoice_lines`

`id`, `invoice_id` -> invoices cascade, `assignment_id` -> assignments **set
null**, `task_id` -> tasks **set null** (index `work_invoice_lines_task_id_idx`),
`description` (non-empty), `quantity_hours` numeric(10,2) (>= 0, nullable),
`unit_rate` numeric(14,2) (>= 0, nullable), `discount_percent` numeric(5,2) not
null default 0 (0-100), `vat_percent` numeric(5,2) (0-100, nullable, in practice
always set), `amount_excl_vat`, `vat_amount`, `amount_incl_vat` numeric(14,2)
**not null, each >= 0**, `sort_order`, timestamps. The legacy `amount` column
was dropped. Indexes: `idx_work_invoice_lines_invoice_sort (invoice_id,
sort_order)`, partial `idx_work_invoice_lines_assignment` where not null.

### 2.10 `work_recurring_invoices`

`id`, `space_id`, `client_id` -> clients cascade, `name` (non-empty), `amount`
numeric(14,2) **> 0** (VAT-inclusive), `currency` (length 3), `recurrence_interval`
smallint 1-4, `recurrence_period` text in (`week`,`month`,`year`),
`recurrence_start_date` date, `payment_due_days` (null or 1-90),
`finance_category_id` **[L][P]**, `is_active` default true, `sort_order`,
timestamps. Index `idx_work_recurring_invoices_client_sort (client_id,
sort_order, name)`, covering indexes.

### 2.11 Settings on `spaces`

`spaces.work_default_vat_percent numeric(5,2) not null default 25` with check
0-100. There is no other Work setting (no seller details, bank account,
numbering, terms).

### 2.12 RLS and grants

All Work tables `enable row level security`; policies, for role
`authenticated`:

* `work_clients`, `work_assignments`, `work_time_entries`, `work_invoices`,
  `work_recurring_invoices`: select/insert/update/delete with
  `is_space_member(space_id)`; insert adds `created_by = auth.uid()`
  (assignments, invoices) or `user_id = auth.uid()` (time entries).
* `work_tasks`, `work_milestones`, `work_invoice_lines`: the same through
  `exists (select 1 from <parent> where ... is_space_member(parent.space_id))`.
* `work_time_timers`: select for members; insert `is_space_member and user_id =
  auth.uid()`; **delete only own**; no update.
* Grants: `select, insert, update, delete` to `authenticated` on each table.
* The cron and agent API bypass RLS (service role).

### 2.13 Triggers and functions

`tg_work_time_entries_set_space` (denormalises `space_id`); `touch_updated_at`
triggers on clients, assignments, tasks, time entries, invoices, lines,
recurring invoices; `work_time_entries_record_changed` -> `tg_emit_record_changed`
(**[L]**, drops out); no business rule lives in the database (transitions,
numbering, totals are all application code).

### 2.14 Life-integration tables and columns (all **not** ported)

* Finances: `finance_work_invoice_projections` (one row per invoice: `space_id`,
  `invoice_id` unique, `category_id`, `budget_month` (first of month),
  `amount` (> 0), `amount_excl_vat`, `vat_amount`, `tag` estimate/sent),
  `finance_work_recurring_invoice_projections` (`recurring_invoice_id`,
  `budget_month`, `amount`, `due_on`, `occurrence_count`, VAT split; unique
  `(recurring_invoice_id, budget_month)`); columns `work_clients.finance_category_id`,
  `work_invoices.finance_category_id`, `work_invoices.finance_transaction_id`,
  `work_recurring_invoices.finance_category_id`.
* Organizations: `life_area_groups` (was `work_organizations`: `domain`,
  `name`, `notes`, `finance_income_category_id`, `finance_expense_category_id`,
  unique `(space_id, domain, lower(trim(name)))`), `life_area_expense_categories`,
  `life_area_recurring_expenses` (interval 1-4 + `week|month|year` + start date,
  `schedule_kind`, `budget_month`, `purchase_date`), `life_area_income_categories`,
  `life_area_org_salaries` (one per group), `life_area_reimbursable_expenses`,
  `finance_life_area_expense_projections`, `finance_life_area_income_projections`,
  and the `work_clients.organization_id` column.
* Contacts: `work_clients.contact_id` (and the by-name link, no column).
* Events: the record-changed trigger and `space_events` reads.
* Provenance for Life tasks (`work_origin_kind`, `origin_kind/_ref`,
  `blocked_*`, `primary_project_id`, `start_at`, `context`) is **not Work**.

### 2.15 What is Work-native

Clients (minus organization, finance, contact FKs), assignments, tasks, time
entries, timers, invoices (minus finance columns), invoice lines, recurring
invoices (minus finance category), the estimate-alert columns, the
`payment_due_days` columns, `sent_at`/`paid_at`, the default VAT setting.

---

## 3. Life-only dependencies: port, replace or leave out

| Dependency in Life | Where | Decision | Reasoning and how |
|---|---|---|---|
| **Spaces and membership** (`spaces`, `space_memberships`, `space_id` on everything, `is_space_member` RLS, `AppContext.activeSpace`, `getAppContext()`) | migrations 2.x, `server/queries/app-context.ts` | **Replace** with store + store members | Every Work row gets `store_id` (P1). Access = `requireMember(storeSlug)` (`src/server/auth.ts`, 404 for non-members) and every query filters by store id. `commerce` tables have RLS on with **no policies** (the Data API never sees them), so no policy port. Roles are `owner` and `admin` (P5); Life's "any member incl. viewer can write" is not carried over (see 4.9). |
| **Users** (`auth.users` in `created_by`, `user_id`) | tables | **Replace** with `commerce.accounts.id` | Time entries, timers, assignments and invoices are created by an **account** (`accounts` is the platform-wide person). |
| **Feature entitlement** `page.work`, `requireFeaturePage`, `feature-keys.ts` | `app/app/work/layout.tsx` | **Replace** with `stores.modules` containing `work` | Plans in Store carry only a sale fee (no feature flags), so gating is the store's own switch (Features page), exactly as bookings and deliveries. Needs a migration to widen the `stores_modules` check (`array['bookings','deliveries']` -> add `'work'`). |
| **Default VAT % on the space** | `spaces.work_default_vat_percent`, `updateSpaceWorkVat`, `components/settings/work-invoice-settings.tsx` | **Replace** with Work settings + `commerce.vat_rate()` | See 4.5. A fixed percentage per store is wrong across countries and categories. |
| **Finances**: `finance_transactions`, `finance_categories` tree (organization -> client -> invoice leaf), budgets, `finance_work_*_projections`, `lib/work/finance-sync.ts`, `lib/work/recurring-invoice-sync.ts` (the sync half), `ensureWorkInvoiceProjectionsForMonth`, `getSpaceFinanceCurrency`, `createFinanceTransaction` invoice linking, category-delete guards in `server/actions/finance.ts`, `/app/finances` | ~2 000 lines | **Leave out** | It is personal-budget bookkeeping (expected income by month, income categories per client). A store owner's books live in their accountant's system. Replace the two useful outcomes: **payment recording** by `work_invoice_payments` (4.6) and **"expected money"** by a computed receivables/overdue block on the Work overview (6.5). Do not create any Finances-like tree. |
| **Organizations** (`life_area_groups` domain `work`, expense categories, recurring expenses, income categories, salaries, reimbursables, their projections; `work-organizations.ts`, `work-organization-*.ts`, `lib/life-area/*`, `lifeArea` components and messages) | see 1.10 | **Leave out** | They model the consultant's **employer**: a salary, reimbursements and expenses that feed the personal budget. The store *is* the seller, so there is no organization above a client. Its two user-visible uses are replaced: the invoice's seller block (the organization's free-text notes) becomes the store's legal details plus Work settings (4.5), and grouping clients is not needed (Kaizen already has customer companies and tiers). If an owner invoices through several legal entities they use several stores (a store can be created per entity, D19). |
| **Contacts** (`contacts` table, name-based company match, `work_clients.contact_id`, `renameContactsCompany`, `company-client-card.tsx`) | `lib/work/client-company.ts`, `server/queries/work-contacts.ts` | **Replace** with `customers` and `customer_companies` | The bridge becomes a real foreign key: a client links to a `customer_companies` row (D108) and/or a `customers` person (6.1). "People at this client" = the company's members. No name matching, no rename side effect. |
| **Life tasks, projects, checklists, workflow statuses, `primary_project_id`, provenance, blockers, personas** | 1.0 (B) | **Leave out** | Not related to Work (verified). Work tasks stay a small standalone list under an assignment (title, estimate, done, order). Do not add a project or status model. |
| **Assistant / agent API and personas** (`/api/agent/work`, `agent-work.ts`, scopes `read:work` `write:work`, dispatch tools, personas) | 1.11 | **Replace** with Store's AI manager tools and MCP | The owner assistant's `OWNER_TOOLS` (`src/lib/owner-tools.ts`, `src/server/owner-tools.ts`) with gates, also served to Kaizen Life's assistant through `/api/mcp` (D96, `store-mcp.ts`). This is a strict upgrade: Life's API could only read and manage organizations. See work package WP13. |
| **Events**: `space_events`, `emitDomainEvent`, `lib/events/registry.ts`, `docs/events/work.md`, the `record.changed` safety-net trigger, `EntityHistory`, the Activity feed | 1.11 | **Replace** with `commerce.work_events` (history) + D41 integration events + `audit()` | 4.9. Drop the safety-net trigger. |
| **Print/PDF via browser print** | `app/work-invoice-print/[id]/page.tsx` | **Port the approach**, then extend | Store already prints packing slips this way (D27, `orders/[orderId]/packing-slip/page.tsx`, `PrintButton`). A server PDF and an emailable/hosted document are new (4.7). |
| **Cron** `/api/cron/work-recurring-invoices` (daily, owner as actor, service role) | 1.6 | **Replace** with a step in Store's five-minute cron | `src/app/api/cron/cart-reminders/route.ts` (misnamed: the every-five-minutes job called by Supabase's scheduler, `cronAuthorised()`). Add `prepareDueRecurringWork()` there (idempotent, per store time zone); no new schedule and no `vercel.json` change. |
| **Revenue view** (wall display, `views-revenue.ts`, `view-shares`, `use-vault-audio`, `/api/views/revenue`) | 1.9 | **Leave out** | A Life "vault" feature. The four-tier idea (paid, sent, drafted, estimated) is reused in the overview (6.5). |
| **Analytics/weekly-review reads** of Work tables | `analytics-dashboard.ts`, `weekly-review.ts` | **Leave out** | Life dashboards. |
| **Autosave, UI kit and helpers** (`useAutosave`, `SaveStatus`, `useSyncOnChange(s)`, `Sheet`, `Segmented`, `ListRow`, `Select`, `SelectMenu`, `Toaster`, `AnimateList`, `getErrorMessage`/`AppError`, `useRunningSeconds`) | `components/ui/*`, `lib/hooks/*` | **Reimplement** with Store's admin components | Store's admin uses `ActionForm`/`FormState` (`src/components/admin/action-form.tsx`), server actions bound to the store slug, and zod. `@dnd-kit` is already a dependency (page builder), so drag-reorder needs no new package. Keep the *behaviours* (600 ms line autosave with save-in-flight queueing, optimistic timer, rapid-fire task add) because they are what made the screens pleasant. |
| **Date helpers** `lib/dates/utc-day-param.ts`, `lib/finance/month.ts` | | **Port** the few pure functions | Small, pure. Store time zone (`stores.time_zone`) replaces "UTC date" wherever a *calendar day* matters (4.4, 4.5). |
| **Money formatting** `lib/finance/format-currency` | | **Replace** with `src/lib/money.ts` (`formatMoney(minor, currency, locale)`) | Currencies limited to `OFFERABLE_CURRENCIES` (EUR, SEK, DKK, NOK, PLN, CZK, HUF, RON, CHF, GBP, USD). Life also offered CAD and AUD: not supported by `minorUnitDigits()`, add only if wanted. |
| **i18n** `next-intl`, `messages/*/work.json`, `errors` codes | | **Replace** (admin English; customer documents via `src/lib/…` text modules) | 4.8. |
| **Mobile shell** (`capacitor.config.ts`, `android/`, `ios/`, `capacitor-www`, `components/capacitor/*`, service-worker registrar, `MOBILE_RELEASE.md`) | | **Leave out** | Not used by Work beyond app-wide chrome. Store's admin is responsive web; the timer works in a phone browser (it is a database row). |
| **`browser-worker/`, `vps/browser-worker/`, `worker/`, `lib/browse/*`, `docs/browser-worker.md`** | | **Leave out** | Life's self-hosted browsing/agent workers; no Work reference (the grep hits are the word "worker"). |
| **Demo seed** `scripts/seed-demo.ts`, `scripts/smoke.ts` | | **Reuse as test specification** | The smoke cases for line/task pairing, one timer per person, estimate stages and round-up (`scripts/smoke.ts` around lines 13884-14160) are the acceptance tests to port to Vitest. |

Things Life gets right that must survive the port: per-line VAT and discount;
autosave; the optimistic one-per-person timer; the estimate alert stages;
task/line pairing; period report; client default rate and payment terms;
recurring schedule arithmetic (month-end clamping, no drift).

Things Life does that must **not** survive: hard-delete cascades from client and
assignment into invoices and time; sent invoices editable back to draft;
free-text invoice numbers; float money; payments recorded ex VAT through a
budgeting tool; viewers able to write; auto-sending every active recurring
invoice with no switch; regenerating deleted draft occurrences.

---

## 4. Mapping to Kaizen Store

### 4.1 Conventions to follow (from `CLAUDE.md` and `src/db/schema.ts`)

* Schema `commerce`, Drizzle in `src/db/schema.ts`, migrations generated with
  `pnpm db:generate`; rules Drizzle cannot express (functions, triggers, checks
  on arrays, reference data) in a custom migration
  (`pnpm exec drizzle-kit generate --custom --name work_rules`). Apply every new
  migration to production and record its version in `docs/decisions.md`
  (Migration versions), as the project instructions say.
* Every table has `store_id uuid not null references stores(id)`. Parents are
  `unique (store_id, id)` and children reference `(store_id, parent_id)`, so a
  row cannot point into another store (P1). RLS on, no policies.
* Money is `bigint` minor units with a `char(3)` currency (`money()` helper in
  the schema). Records with legal weight are append-only through
  `commerce.forbid_change()` triggers.
* Snapshots are copied onto documents (addresses, titles, tax rates) so later
  edits never rewrite what was issued.
* Server code is `src/server/work*.ts` with raw `sql` through `db()`, `import
  "server-only"`, actions bound to the store slug, `requireMember()`, `audit()`
  for settings changes, `updateTag()` where a cached read changes.
* Pure logic lives in `src/lib/work*.ts` with a `*.test.ts` beside it. Every
  new database rule gets a test in `src/db/commerce.test.ts` (PGlite).

### 4.2 Proposed tables

All in `commerce`, all with `store_id`. `(pk)` = primary key,
`fk(store_id, x)` = composite foreign key to the parent's `(store_id, id)`.
"Account" = `commerce.accounts.id`.

**`work_settings`** (pk `store_id`): one row per store, created lazily.
`vat_registered boolean not null default true`, `vat_number text`,
`default_payment_days int default 14 check 1..90`, `default_currency char(3)`,
`bank_account text` (IBAN or national number), `bic text`,
`payment_note text` (e.g. how to pay, KID), `invoice_footer text`,
`late_payment_note text`, `estimate_alert_minutes int default 10 check
null or 1..480`, `estimate_alert_popup bool default true`,
`estimate_alert_sound bool default false`, `show_time_notes_to_clients bool
default false`, `updated_at`, `updated_by`. **Numbering is not here** (it is
`document_series`, 4.4). The legal identity (legal name, organisation number,
address, contact email, country) stays on `stores` (Company page).

**`work_clients`** (`id`, `unique (store_id, id)`): `name` (1-120),
`legal_name`, `organisation_number`, `vat_number`, `country char(2) references
countries`, `billing_address jsonb`, `billing_email`, `contact_name`, `phone`,
`locale text` (the language of its documents, e.g. `nb-NO`),
`currency char(3)` (from `OFFERABLE_CURRENCIES`),
`default_hourly_rate_minor bigint check >= 0`, `payment_days int check
null or 1..90`, `business boolean not null default true`, `vat_treatment text
check in ('domestic','reverse_charge','outside_scope','exempt') default
'domestic'` (4.5), `customer_company_id uuid` (`fk(store_id, x) -> 
customer_companies`, `on delete set null (customer_company_id)`), `customer_id
uuid` (primary person, `fk -> customers`, same), `use_prepaid boolean not null
default true`, `notes text`, `archived_at`, `sort_order`, timestamps. Index
`(store_id, sort_order, name)`, `(store_id, customer_company_id)`. **Clients
are archived, never deleted once they have an invoice** (`work_invoices.client_id`
is `on delete restrict`); a client with no documents may be deleted.
Life's `organization_id`, `finance_category_id`, `contact_id`, `notes printed
under Bill to` are dropped (notes stay internal; the "Bill to" block prints
`legal_name`/address/VAT number).

**`work_assignments`**: `client_id fk restrict`, `name`, `status check in
('active','paused','done')`, `billing_type ('hourly','fixed_fee')`,
`hourly_rate_minor`, `fixed_amount_minor`, `estimated_minutes int`,
`start_date`, `end_date`, `estimate_alert_minutes/popup/sound` (moved here from
the invoice, since one assignment now has many invoices, 4.6), `created_by`
account, `sort_order`, timestamps. `invoiced` is **derived** (the assignment has
an issued invoice line and, for fixed fee, its fee line), not stored.

**`work_tasks`**: `assignment_id fk cascade`, `title`, `status ('open','done')`,
`estimated_minutes int`, `sort_order`, timestamps.

**`work_time_entries`**: `assignment_id fk restrict`, `task_id fk` (set null on
task delete), `account_id` (who), `work_date date`, `minutes int check between 1
and 1440`, `billable bool`, `note text (<= 500)`, `prepaid_minutes int not null
default 0 check between 0 and minutes` (covered by the hour ledger, 6.2),
`invoice_line_id uuid` (`fk`, set when a **draft** line includes it, kept when
issued; an entry attached to an issued invoice cannot be changed or deleted:
trigger), timestamps. Indexes `(store_id, assignment_id, work_date desc)`,
`(store_id, work_date desc)`, `(store_id, account_id, work_date desc)`,
`(store_id, invoice_line_id)`. There is no `space_id`-style denormalisation
trigger: the composite FK already fixes the store.

**`work_timers`** (pk `(store_id, account_id)` = **one running timer per person
per store**): `assignment_id`, `task_id` (cascade), `started_at default now()`.
Start and stop are one SQL function each (`commerce.work_start_timer`,
`commerce.work_stop_timer`) so stop-then-start and "minutes = max(1,
ceil(elapsed/60s))" are atomic.

**`work_invoices`**: `client_id fk restrict`, `assignment_id fk restrict null`,
`recurring_invoice_id fk null`, `recurring_period date null`, `status check in
('draft','sent','paid','void')`, `series text default 'work_invoice'`,
`number bigint null`, `document_number text null` (**null while draft**; unique
`(store_id, document_number)` and `(store_id, series, number)` where not null),
`issued_on date`, `due_on date`, `sent_at`, `paid_at`, `currency`, `locale`,
`payment_days int`, `service_from date`, `service_to date` (period the lines
cover, from the entries), `notes`, `reference text` (the client's PO or a
payment reference/KID), `subtotal_minor`, `vat_minor`, `total_minor` (kept
current while draft, **frozen and checked at issue**), `vat_home_minor`,
`fx_rate numeric` (foreign-currency VAT in the store's currency, 4.5),
`seller jsonb`, `buyer jsonb` (**snapshots at issue**: names, organisation and
VAT numbers, addresses, bank account, email), `vat_notes jsonb` (statutory
notes chosen from the client's VAT treatment), `public_token text unique`
(hosted invoice link, 6.4), `sent_to text`, `created_by`, timestamps.
Constraints: `total = subtotal + vat`; `number is not null` iff
`status <> 'draft'`; **at most one draft per assignment** (`unique (store_id,
assignment_id) where status = 'draft'`); unique `(store_id, recurring_invoice_id,
recurring_period)` where not null. Indexes `(store_id, status, issued_on desc)`,
`(store_id, client_id, status)`, `(store_id, due_on) where status = 'sent'`.
A trigger forbids changing anything but `status`, `paid_at`, `sent_to` and
payment fields once `status <> 'draft'`, and any change to lines (below).
Life's `estimate_alert_*`, `finance_*`, `invoice_number` are dropped.

**`work_invoice_lines`**: `invoice_id fk cascade` (drafts only can be deleted),
`position int`, `assignment_id`, `task_id`, `description` (1-500), `unit text
check in ('hour','unit')`, `quantity_hundredths int check >= 0`,
`unit_price_minor bigint check >= 0` (net), `discount_bp int check 0..10000`,
`vat_category text check in ('standard','exempt','reverse_charge','outside_scope')`,
`vat_rate numeric(6,4)` (snapshot, same scale as `order_lines.tax_rate`),
`excl_minor`, `vat_minor`, `incl_minor` (checks: `incl = excl + vat`, all
>= 0), `quantity_manual boolean not null default false`, timestamps. A trigger makes lines **immutable once the invoice is not a
draft** (`commerce.forbid_change()` variant that checks the parent).

**`work_invoice_payments`** (append-only, reversed by a negative row):
`invoice_id`, `amount_minor <> 0`, `currency`, `received_on date`, `method
check in ('bank','card','cash','other','stripe','prepaid')`, `reference`,
`provider_reference` (Stripe session id, unique per store where not null),
`reverses uuid null`, `recorded_by`, `created_at`. The invoice becomes `paid`
when the sum of payments (plus credit notes) covers the total, and back to `sent`
if a reversal drops it below (the only allowed status step backwards, and it
is by a logged reversal, not by editing the invoice).

**`work_credit_notes`** (append-only; series `work_credit_note`): `invoice_id
fk restrict`, `series`, `number`, `document_number`, `issued_on`, `currency`,
`reason text`, `subtotal_minor`, `vat_minor`, `total_minor` (positive numbers,
document says credit), `lines jsonb` (snapshot of the credited lines; full or
partial), `seller`, `buyer`, `created_by`. **A "void" of a sent invoice is a
full credit note** and sets the invoice `void`; a paid invoice can be credited
too (Life refused: "paid invoices cannot be voided in v1"), which leaves a
refund to record as a negative payment.

**`work_recurring_invoices`**: `client_id fk restrict`, `name`, `description`
(the line text), `unit`, `quantity_hundredths default 100`,
`unit_price_minor` (**net**; Life's inclusive amount is converted, 4.3),
`discount_bp`, `vat_category`, `currency`, `recurrence_interval 1..4`,
`recurrence_period ('week','month','year')`, `start_date`, `end_date null`,
`payment_days`, `auto_issue boolean not null default false`, `is_active`,
`skipped_periods date[] not null default '{}'` (occurrences the owner
deleted, never regenerated), `sort_order`, timestamps. Instances are ordinary
`work_invoices` with `recurring_invoice_id` + `recurring_period`.

**`work_hour_products`** (pk `(store_id, product_id)`, `fk -> products`
cascade): `minutes_per_unit int check > 0`, `valid_days int null` (null = no
expiry). **`work_hour_credits`** (the ledger, 6.2): `client_id null` (null =
an **unassigned** purchase waiting for the owner, then `customer_id` and
`order_id` say whose), `entry_type check in ('purchase','usage','adjustment',
'expiry','refund')`, `minutes int check <> 0` (signed), `expires_on date null`,
`order_line_id fk null`, `time_entry_id fk null` (a usage row and its later
reversal share it), `note`, `created_by null`, `created_at`; **append-only**;
`unique (store_id, order_line_id) where entry_type = 'purchase'` (one credit
per order line however often payment is applied); balance = `sum(minutes)`
per client; index `(store_id, client_id, created_at)`.

**`work_events`** (append-only, `id bigint identity`): `entity_type text`,
`entity_id uuid`, `type text` (`invoice.issued`, ...), `data jsonb` (no secrets,
no client email), `account_id null` (null = system/cron), `created_at`. Index
`(store_id, entity_type, entity_id, created_at)`, `(store_id, created_at)`.
This is the invoice history panel and the Work activity list; `audit_log`
keeps only settings-level changes.

Not created: milestones, organizations, projections, categories.

#### 4.2a As built in WP1a (schema and database rules)

Migrations `20260929211910_work_module.sql` (tables, generated) and
`20260929211920_work_rules.sql` (rules). Tables, columns and constraint names
follow 4.2; what differs or was decided while building, briefly:

* **Tables:** `work_settings`, `work_clients`, `work_assignments`, `work_tasks`,
  `work_time_entries`, `work_timers`, `work_invoices`, `work_invoice_lines`,
  `work_invoice_payments`, `work_credit_notes`, `work_recurring_invoices`,
  `work_events`. **Not created** (WP1b): `work_hour_products`, `work_hour_credits`.
  `work_time_entries.prepaid_minutes` (default 0) is there already.
  Money is `bigint` minor units, durations integer minutes, line quantity
  integer hundredths, discounts basis points, VAT rates fractions
  (`numeric(6,4)`), foreign amounts `fx_rate numeric(18,8)`.
* **Nullability the doc left open:** `work_clients.currency` is not null (no
  default: the server chooses from settings or the country); `billing_address`
  is `jsonb not null default '{}'` shaped `{ line1, line2, postalCode, city }`;
  `created_by`, `recorded_by`, `account_id` on events are nullable (system,
  cron, Stripe). A consumer client (`business = false`) must be `domestic` (check).
  Line VAT rate must be 0 unless the category is `standard` (check).
  Caps as 4.3: quantity 0..10 000 000 (100 000.00), unit price 0..1 000 000 000
  minor units, discount 0..10 000 bp, time entry 1..1440 minutes.
* **Deletion rules:** everything referencing clients, assignments, invoices,
  credit notes and payments restricts. Composite foreign keys that only null
  their own column (`ON DELETE SET NULL (col)`, added in the rules migration):
  `work_clients.customer_company_id` / `customer_id`,
  `work_time_entries.task_id` (the key also names the assignment, so a task is
  always the entry's own assignment's) and `.invoice_line_id`,
  `work_invoice_lines.assignment_id` / `task_id`. A timer cascades with its
  assignment or task. **A repeating invoice that has produced invoices cannot be
  deleted** (restrict): switch it off. `work_invoices.series` is checked to be
  `work_invoice`, `work_credit_notes.series` `work_credit_note`.
* **Invoice numbering constraints:** `(status = 'draft') = (number is null)`
  and `(number is null) = (document_number is null)`; so WP15's imported
  invoices with a `legacy_number` will need that check relaxed. Unique
  `(store_id, series, number)`, `(store_id, document_number)`,
  `(store_id, recurring_invoice_id, recurring_period)`, partial unique
  `(store_id, assignment_id) where status = 'draft'`, and `public_token`
  (globally).
* **`work_credit_notes` extras:** `vat_home_minor`, `fx_rate`, `vat_notes`
  (copied from the invoice, so the document is complete alone), `reason`
  (null allowed). `lines` is a jsonb array of
  `{ line_id, position, description, unit, quantity_hundredths,
  unit_price_minor, discount_bp, vat_category, vat_rate, excl_minor, vat_minor,
  incl_minor }` for the credited part.
* **`work_invoices.vat_notes`** is a jsonb array of keys, for the text module to
  map: `reverse_charge`, `outside_scope`, `exempt` (lines of those categories on
  a VAT-registered store's invoice) or `["not_registered"]`. `locale` and
  `payment_days` are frozen at issue (the client's, else the store's first
  language or `en`; the invoice's, else the client's, else the settings', else 14).
* **Timer `work_date`** is the day the clock started **in the store's time
  zone** (Life used UTC), and a timer left running is logged at most 1440 minutes.
* **Fully crediting an invoice releases its time entries** (`invoice_line_id`
  set null by `credit_work_invoice`), so the time can be billed again on the
  replacement invoice; a partial credit leaves them attached. Entries on a
  `sent` or `paid` invoice cannot change or be deleted, and only billable
  entries of the line's own assignment can be put on a *draft* invoice's line.
* **Series rules (4.4):** `commerce.work_set_series()` sets prefix (up to 10 of
  `A-Za-z0-9._/-`) and next number; a trigger on `document_series` for the two
  work series refuses lowering the next number **once a document has been
  issued in that series** (before the first issue it may go either way, which
  is how the owner fixes a mistyped start). The first number is therefore set
  in settings, before the first issue. The issue date is refused if later than
  today in the store's time zone, or earlier than the previous invoice's unless
  the caller confirms (`p_allow_earlier_date`); a credit note may not be dated
  before its invoice.
* **Not registered for VAT** is `work_settings.vat_registered = false` (rate 0
  on every line, note `not_registered`). Readiness (`work_invoice_problems`)
  wants every line's VAT category to fit the client's treatment
  (`domestic`: `standard` or `exempt`; `reverse_charge`, `outside_scope`,
  `exempt`: only that category; skipped for a store not registered).
* **D41 events are queued in SQL** (trigger, like orders): `work_invoice.sent`
  (draft to sent), `work_invoice.paid` (each move to paid), `work_invoice.credited`
  (each credit note), `work_client.created`. `hours.*` come with WP1b. WP13 must
  add the four names to `IntegrationEvent`/`EVENTS` (`src/lib/integrations.ts`),
  `buildPayload()` and Slack; until then no integration lists them and none are
  queued. Subject id is the invoice or client id.
* **`work_events` the database writes** (WP3/WP4 must not duplicate them):
  `invoice.issued`, `invoice.credited`, `invoice.paid`, `invoice.reopened`
  (paid back to sent), `payment.recorded`, `payment.reversed`, `payment.refunded`
  (`entity_type` `invoice`, `entity_id` the invoice), and `time.logged` with
  `source: "timer"` (`entity_type` `time`). The server writes the rest
  (`client.*`, `assignment.*`, `task.*`, `invoice.created`, `invoice.deleted`,
  `invoice.emailed`, manual `time.logged`, `recurring.*`) with
  `commerce.work_event(store, entity_type, entity_id, type, data, account)`.
* **Status follows the money:** `paid` when payments plus credit notes cover the
  total (`paid_at` = the last payment's `received_on` at noon in the store's
  time zone), back to `sent` if a reversal drops it below, `void` when credit
  notes cover it. A trigger refuses any other status change (also by hand), and
  any change to an issued invoice except `status`, `paid_at`, `sent_to`,
  `public_token` (`updated_at`). Payments must be in the invoice's currency, on
  an issued invoice, and a `void` one takes only negative rows; a reversal must
  take back exactly one earlier positive payment of the same invoice, once.
  Zero-total invoices are not issued (`zero_total`).

**Function contracts** (all `commerce.`, all errors are `RAISE`s whose message
starts with a `work_*.<reason>` code, so the server can map them):

* `issue_work_invoice(p_store uuid, p_invoice uuid, p_account uuid = null,
  p_issued_on date = null, p_expected_total_minor bigint = null,
  p_fx_rate numeric = null, p_allow_earlier_date boolean = false)` returns the
  issued `work_invoices` row (`select * from ...`). One transaction, gap-free.
  Reasons: `work_invoice.not_found`, `.not_draft`, `.not_ready: <codes>`
  (`no_lines`, `zero_total`, `seller_name`, `seller_address`, `seller_country`,
  `seller_organisation_number`, `seller_vat_number`, `seller_bank_account`,
  `buyer_address`, `buyer_country`, `buyer_vat_number`,
  `vat_category_mismatch`), `.total_changed`, `.date_in_future`,
  `.date_before_previous`, `.fx_rate_required`. `p_fx_rate` = units of the
  seller's currency per 1 of the invoice's, required exactly when the invoice
  currency differs from the seller country's (`vat_home_minor` = VAT x rate).
  Recomputes every line (rate from `commerce.vat_rate(store country,
  'standard')` for standard lines of a registered store, else 0; amounts as 4.3)
  and writes them to the lines, then freezes totals, snapshots `seller`
  (`legal_name, organisation_number, vat_registered, vat_number, address,
  country, email, bank_account, bic, payment_note, invoice_footer,
  late_payment_note`) and `buyer` (`name` = legal name else name, `client_name,
  organisation_number, vat_number, address, country, email, contact_name,
  business, vat_treatment`), `service_from/to` (from the time on its lines, unless
  set), sets `due_on = issued_on + payment_days`, `sent_at = now()`.
* `work_invoice_problems(p_store, p_invoice) returns text[]`: the same checklist
  as codes, no lock, for the "ready to issue?" panel (`{}` = ready).
* `credit_work_invoice(p_store uuid, p_invoice uuid, p_account uuid = null,
  p_reason text = null, p_lines jsonb = null, p_issued_on date = null,
  p_allow_earlier_date boolean = false)` returns the `work_credit_notes` row.
  `p_lines` null credits all that is left; else `[{ "line_id": uuid,
  "quantity_hundredths": int }]` (quantity optional = all that is left of the
  line); the last part of a line takes exactly what is left of its amounts, so
  credit notes add up to the invoice. Reasons: `work_credit_note.not_found`,
  `.status`, `.lines`, `.quantity`, `.nothing_to_credit`, `.date_in_future`,
  `.date_before_invoice`, `.date_before_previous`, `.currency`, `.too_much`.
  The refund of money already received is a separate negative payment (the
  caller records it).
* `work_start_timer(p_store, p_account, p_assignment, p_task = null) returns
  table (timer_started_at timestamptz, stopped_entry_id uuid)`: stops and logs a
  running timer first (`stopped_entry_id` null if none), in one transaction.
  `work_stop_timer(p_store, p_account, p_note = null) returns setof
  work_time_entries`: zero rows when nothing runs; minutes = clamp(ceil(elapsed
  / 60 s), 1, 1440), billable, on the start day in the store's time zone.
* `work_invoice_amounts(p_store, p_invoice)` returns `total_minor, paid_minor,
  credited_minor, outstanding_minor`; `work_today(p_store)` the store-time-zone
  date; `work_line_excl(qty_hundredths, unit_price_minor, discount_bp)` and
  `work_line_vat(excl_minor, rate)` the 4.3 formulas (half up, exact);
  `work_set_series(p_store, p_series, p_prefix, p_next_number)`
  (`work_series.prefix|lower|number|unknown`); `work_event(...)` as above;
  `work_invoice_computed(p_store, p_invoice)` what a draft would be issued as.
* Tenancy is by composite key; the guards look rows up by `store_id` too, so a
  cross-store reference fails either on its foreign key or on a `work_*` guard.

### 4.3 Money, hours and rounding

* **Life numeric(14,2) -> minor units:** `round(amount * 100)` per value (all
  supported currencies have two minor digits). Life's `unit_rate`,
  `default_hourly_rate`, `fixed_amount`, line amounts, totals.
* **Hours -> minutes:** `estimated_hours` -> `estimated_minutes = round(h * 60)`;
  time entries are already integer minutes (unchanged).
* **Invoice line quantity:** stored as **hundredths** (`quantity_hours * 100`),
  so an invoice can be checked by hand: quantity x unit price = amount. Time to
  quantity keeps Life's rule `hours = round(minutes / 60, 2)` (20 min = 0.33 h),
  now `quantity_hundredths = round_half_up(minutes * 100 / 60)`. State this rule
  on the invoice screen ("hours are rounded to two decimals"); "Round up hours"
  (15/30/60) is ported unchanged as an editing helper (it rewrites a draft
  line's quantity; time logged later is *not* re-synced into a line that was
  hand-edited: the line's `quantity_manual` flag, set when the owner types or
  rounds the quantity, makes the sync skip it; a small improvement over Life,
  which silently overwrote it).
* **Exact integer arithmetic** (no floats), half-up, per line:

  ```
  excl_minor = round_half_up( quantity_hundredths * unit_price_minor * (10000 - discount_bp) / 1_000_000 )
  vat_minor  = round_half_up( excl_minor * vat_bp / 10000 )      // vat_bp = round(vat_rate * 10000)
  incl_minor = excl_minor + vat_minor
  invoice: subtotal = sum(excl); vat = sum(vat) [per line, as Life]; total = sum(incl)
  ```

  Products can overflow `Number` (2^53): compute with `BigInt` in
  `src/lib/work-calc.ts`, and cap quantity at 100 000.00 h and a unit price at
  10 000 000.00. The same function runs in the browser (live totals) and on the
  server, and **the database re-checks `incl = excl + vat` and, at issue, that
  the header equals the sum of lines** (`commerce.issue_work_invoice`).
* **Discounts** are basis points (Life 0-100 with 2 decimals = exact bp).
  **VAT rates** are stored as fractions like `order_lines.tax_rate` (0.2500).
* **VAT summary by rate:** the printed document lists net, rate and VAT per
  rate (needed on the document); totals are still the sum of the per-line
  rounded VAT. LEGAL: some tax authorities prefer VAT computed on the net
  total per rate. Per-line rounding is what Life and Store's own order lines
  do; confirm with the accountant before launch.
* **Currency:** per client and per invoice, from `OFFERABLE_CURRENCIES`. Store
  never converts a work invoice (D109's read-time conversion is for catalogue
  prices); the invoice is in its agreed currency. LEGAL: when the invoice
  currency differs from the seller's country's currency, the VAT amount must
  usually be stated in the national currency: keep `vat_home_minor` and
  `fx_rate` from the ECB reference rate for the issue date (`src/lib/ecb.ts`
  exists), and show both.
* **Import from Life (optional, WP15):** recurring template amount `A` (incl.)
  -> `unit_price_minor = round_half_up(A*100 / (1 + v))` with `v` the space
  default; totals recomputed and compared with Life's stored
  `subtotal_excl_vat/total_vat/total_incl_vat` (differences are reported, not
  silently fixed).

### 4.4 Invoice numbering and Store's document series

Facts: `commerce.document_series (store_id, series, prefix, next_number)` and
`commerce.next_document_number(store, series)` give **gap-free** numbers (the
row lock serialises callers and a rollback returns the number) and are meant to
be called in the issuing transaction. `commerce.initialise_store()` creates the
series `invoice` (`INV-`), `credit_note` (`CN-`) and `order` (1001). But
`commerce.invoices` and `commerce.credit_notes` are **order-bound and unused**:
`order_id` is `not null`, nothing in `src/` inserts into them (only
`src/db/commerce.test.ts` does), order invoices are Stripe's own (`payment_providers.order_invoices`),
and there is **no invoice print/PDF/email code** to reuse (only the packing-slip
print page and `sendEmail`).

Decision: **Work invoices get their own series**, not `invoice`:

* `work_invoice` (default prefix `W-`, the owner's choice in settings) and
  `work_credit_note` (`WCN-`), inserted for
  every existing store by the migration and for new stores by an extended
  `commerce.initialise_store()` (like the `order` series was in
  `20260924072554_checkout_rules.sql`).
* Reason: different documents, different tables, and `commerce.invoices`
  would need `order_id` made nullable and its append-only trigger reasoned
  about. Keeping series per document type also lets a store keep its Stripe
  order invoices (a different system numbers those) without collisions.
  LEGAL: numbering rules require a unique, sequential number per document; the
  accountant should confirm that separate series for order invoices, work
  invoices and credit notes are acceptable for each launch country.
* **The number is taken at issue, never at draft**: `commerce.issue_work_invoice(
  p_store, p_invoice, p_issued_on, ...)` runs in one transaction: locks the
  invoice (`for update`), checks it is a draft with lines and complete legal
  settings, recomputes and freezes totals, snapshots seller and buyer, calls
  `next_document_number`, sets `document_number = prefix || number`, `status =
  'sent'`, `sent_at`, `due_on`, writes the `work_events` row and queues the D41
  event. Deleting a draft therefore never burns a number.
* **Continuing an existing sequence** (open question): the owner may have been
  issuing invoices elsewhere (in Life or their accounting tool). Settings lets
  an owner **raise** `next_number` and edit the prefix while no invoice of the
  series exists after the change point (never lower; the function refuses a
  value <= the highest issued number). Show the next number in settings.
* Issue date: the store-time-zone calendar day of issue by default (the
  settings may allow a backdate of a few days for a paper invoice; the function
  refuses a date earlier than the previous document's date in the series
  unless the owner confirms). LEGAL: some countries expect issue dates to be
  non-decreasing with the number.
* Life's free-text number is **not** imported into the series: imported
  historical invoices keep `legacy_number text` and no `number`, and are
  marked `imported` (WP15).

### 4.5 VAT (per Store's rules) and everything legal in one place

**How Store computes VAT today.** Prices are VAT-inclusive per market; a
product's rate is `commerce.vat_rate(country, products.vat_category)` (D65:
`standard`, `accommodation`, `exempt`; reduced rates in `commerce.vat_rates`,
fallback the standard rate; exempt = 0); never `countries.standard_vat_rate`
directly. Businesses see prices without VAT (D63, `src/lib/b2b.ts`:
`withoutVat`, `withVat`) but **VAT is always charged**. Store has **no**
reverse-charge model, **no** EU VAT number or VIES check for customers or
stores (`stores` has `organisation_number` only; hosts have `vat_registered`
and `vat_number` for DAC7), and **no** "not VAT registered" flag for a store.

**What Work needs.**

1. **Rates:** a work line's rate = `commerce.vat_rate(store country,
   line vat_category)` frozen on the line at issue. Categories offered:
   `standard` (default), `exempt`, and the two special ones below
   (`reverse_charge`, `outside_scope`, 0 %). A line carries a category, **not a
   free percentage**. This narrows Life's free 0-100 field on purpose: a wrong
   free number becomes a wrong tax document. (If an accountant needs another
   real rate, e.g. a reduced rate, add it as a category backed by
   `commerce.vat_rates`, which is reference data reviewed by a human.)
2. **The store's registration** (`work_settings.vat_registered`, `vat_number`):
   a store that is **not** VAT registered issues invoices with 0 % and the
   statutory note "not VAT registered"; a registered store cannot issue without a
   VAT number (checklist blocks issue, like the setup wizard blocks launch).
   `stores.organisation_number` is not a VAT number (Norway prints it as
   `NNN NNN NNN MVA`, Sweden as `SE` + number + `01`, Denmark uses the CVR
   number).
3. **Client VAT treatment** (`work_clients.vat_treatment`, chosen by the owner,
   default from the client's country):
   * `domestic` (client in the store's country, or a consumer): store rate.
   * `reverse_charge` (business in **another EU country**, with a VAT number,
     for B2B services): 0 % with the statutory note; needs the client's VAT
     number on the document. LEGAL: place of supply, the seller's own
     reporting (EC Sales List / the country's equivalent), and the exact
     statutory wording differ per country.
   * `outside_scope` (client outside the store's VAT territory, e.g. a
     Norwegian store invoicing an EU business; Norway is outside the EU):
     0 % with the country's "outside the scope" wording.
   * `exempt`: exempt services (e.g. certain health, education).
   Each treatment has its note in **nb, sv, da, en** in a hand-written text
   module (`src/lib/work-invoice-text.ts`), reviewed by a human like the legal
   texts; other languages fall back to English, **never** machine-translated
   (the D111 catalogue is derived from `src/lib/i18n.ts` messages, so these
   texts must live outside it).
4. **Consumers:** an invoice to a consumer always has domestic VAT and no
   reverse charge. Prepaid hour packages sold to consumers have withdrawal
   rights (6.3).
5. **Prepayments:** VAT on hour packages sold online is due when paid (Store's
   normal order VAT at the order's country rate). LEGAL: the accountant
   should confirm the package is a single-purpose voucher (place and rate
   known at sale), not a multi-purpose one.
6. **What an issued invoice must show** (checklist that `issue_work_invoice`
   enforces, from EU VAT Directive Art. 226 and national rules; the
   accountant must confirm the list per country: NO, SE, DK first): issue
   date; unique sequential number; seller legal name, address, organisation
   and VAT number (and, in Norway, the register mark for companies where
   required); buyer name, address and, for reverse charge, VAT number;
   description, quantity and unit price excl. VAT, discounts; supply date or
   period if different from the issue date (`service_from/to`); net amount,
   rate and VAT per rate; totals; due date; payment details (bank account,
   reference); the exemption or reverse-charge note; VAT in national
   currency when the invoice is in a foreign currency. Life's print page shows
   almost none of the identity fields.
7. **Retention and erasure:** issued invoices, credit notes and their
   snapshots must be kept for the legal period (typically 5 to 7 years by
   country; confirm). GDPR erasure of a client therefore **anonymises the live
   client row** but leaves the snapshots on issued documents; time-entry notes
   are personal work data of the consultant and, if shown to clients, of the
   client. Deleting a store's data is a platform matter (D10, residency
   register: no new vendor may process client data outside the EU: a PDF
   service, if ever used, is added to `docs/residency-register.md` first).
8. **Kaizen is an invoicing tool, not certified bookkeeping.** Owners keep
   their books in their accountant's system. Provide CSV exports (invoices,
   lines, payments, credit notes) in W2 and a Tripletex integration later
   (already listed as "coming soon" in `src/lib/integrations.ts`). LEGAL: for
   Norway, whether the invoicing module must meet requirements for accounting
   systems is an accountant/lawyer question before launch.
9. **E-invoicing** (EHF/Peppol for Norwegian and Swedish public buyers, and
   EU e-invoicing timelines) is out of scope; the snapshots (seller, buyer,
   lines, VAT per rate) are shaped so a Peppol BIS export can be added.
10. **Late fees and reminders:** do not automate interest or collection
    charges. Overdue is a derived status (`sent` and `due_on < today` in the
    store's time zone), with an owner-triggered reminder email later.

### 4.6 Invoice lifecycle in Store (redesign)

```
draft  --issue-->  sent  --payments cover the total-->  paid
  |                  |                                    |
  delete             credit note (full) -> void           credit note (full) -> void,
  (no number used)   (partial: stays sent)                 with a negative payment for the refund
```

* **Drafts** are freely editable, deletable, unnumbered (`document_number` null),
  and are the only rows whose lines can change. Deleting a draft **never
  deletes** its assignment, tasks or time entries (Life did); it only releases
  the entries' `invoice_line_id`.
* **Issued** (`sent`) documents are immutable (trigger): no revert to draft, no
  editing lines, number or issue date. Corrections are **credit notes**
  followed by a new invoice. The **due date is `issued_on + payment_days`**
  (in the store's calendar): Life computed it from the send day for exactly
  this reason and in Store issuing *is* sending, so the two coincide; the typed
  "issue date" disappears.
* **Payments** are rows (`work_invoice_payments`): manual ("Record payment":
  date, amount, method, reference; partial payments allowed, unlike Life),
  online (6.4) or from the hour ledger (`prepaid`, 6.2). `paid_at` = the
  received date (store-time noon, as Life did for the same reason).
* **Overdue** and **due soon** are derived.
* **`void`** = fully credited; a paid invoice can be credited (Life could not).
* **One draft per assignment** (partial unique index) replaces Life's 1:1
  invoice-to-assignment rule, so an ongoing hourly engagement is billed
  monthly without creating a new assignment each time; **time entries are
  attached to exactly one draft line** (`invoice_line_id`) so nothing is billed
  twice and prepaid coverage is respected. This is the biggest deliberate
  deviation from Life; the mirror UX (task <-> line) is kept, see WP4.
* Every transition writes `work_events`, `audit()` only for settings, and queues
  the D41 events (4.9).

### 4.7 Documents: print, PDF, email, hosted page

* **Print page** (W1): `/admin/{store}/work/invoices/{id}/print`, modelled on
  the packing slip (`PrintButton`, `@media print`), in the invoice's language,
  from the **snapshot** for issued invoices. Replaces Life's
  `/work-invoice-print/[id]` (which was outside the admin and used live data).
* **Hosted customer page** (W2): `/s/{store}/{market}/account/invoice/{token}`
  (a token page like a subscription's, no sign-in needed, `noindex`), showing
  the same document, "Print / save as PDF", and (W4) "Pay now". A new top-level
  `/s/{store}/{market}/{word}` would reserve a page address (Store convention),
  hence `/account/…`.
* **Email** (W2): `sendEmail` (`src/server/email.ts`; kept in `email_messages`
  first, Resend, idempotency key `work-invoice:{invoiceId}`) with a rendered
  email (`src/lib/email-layout.ts`) in the client's language and a link to the
  hosted page. **Attachments:** `sendEmail`'s `attachments` are UTF-8 **text**
  only (`Buffer.from(content, "utf8")`), fine for `.ics`, not for a PDF. Either
  send the link only (recommended for W2), or extend `OutgoingEmail.attachments`
  with a base64 binary variant and generate the PDF (below). Email text goes in
  `src/lib/email-text.ts`-style hand-written nb/sv/da/en; the invoice body
  itself is the legal text module.
* **PDF** (W5, optional): the installed tools are `@sparticuz/chromium` +
  `playwright-core` (only `cookie-scan-runner.ts` loads Chromium, and the
  instructions keep it out of other routes' imports). A separate route handler
  `/api/work/pdf/{token}` may print the hosted page to PDF **inside the same
  function region**; no third-party PDF service (residency). Until then "Save
  as PDF" is the browser's, as in Life.
* **Reusing** anything from order invoicing: nothing exists to reuse except the
  numbering function, the append-only trigger pattern, `formatMoney`, and the
  packing-slip print page.

### 4.8 Language: admin and customer text

Verified: the store admin has **no interface translation**. Labels, buttons
and messages are English literals in the layout and pages
(`src/app/admin/(gated)/[store]/layout.tsx`, `settings/features/page.tsx`);
only pages that show **shopper-facing** content (packing slip, order page,
localization, menus, SEO) call `t()` from `src/lib/i18n.ts`. Therefore:

* **Work admin UI: English**, inline strings, in Store's style. Copy wording
  from `messages/en/work.json` (471 keys; roughly 250 relevant after dropping
  organizations and Life-only screens). Life's nb, sv, de and es strings are
  kept in that repo as the future source if the admin ever gets i18n.
* **Customer-facing text** (invoice and credit note document, invoice email,
  reminder, account pages, hosted page, hour-balance block on My account,
  order lines of an hour package): nb, sv, da, en **hand-written**, English
  fallback. UI strings for the customer account and hosted page go in
  `src/lib/i18n.ts` (D111 then AI-translates the other languages); **legal
  wording (document labels, VAT notes, late-payment note) goes in a separate
  hand-written module that is not in the catalogue** (`src/lib/work-invoice-text.ts`).
* Dates, numbers and money follow the document's `locale`
  (`formatMoney(minor, currency, locale)`).

### 4.9 Permissions, audit, events

* **Who:** owners and admins may use Work; `owner` only for Work settings
  (VAT registration, bank details, series), credit notes, deleting clients,
  adjusting hour balances and switching the module on (as `saveBookingsModuleAction`
  requires an owner). Time entries and timers belong to the account that made
  them; an admin edits others' entries only on drafts. Life's "any member
  writes anything" is not kept. (Open question 1.)
* **Audit** (`audit()` -> `commerce.audit_log`): `work.enabled`, `work.disabled`,
  `work.settings.saved`, `work.series.changed`, `work.client.deleted`,
  `work.hours.adjusted`. Business events (invoice created, issued, paid,
  credited, time logged) go to `work_events`, not the audit log.
* **Integration events** (D41): extend `IntegrationEvent` and `EVENTS`
  (`src/lib/integrations.ts`) with `work_invoice.sent`, `work_invoice.paid`,
  `work_invoice.credited`, `work_client.created`, `hours.purchased`,
  `hours.low`; queue them from SQL (`commerce.queue_integration_event`, in the
  same transaction, as the order events are), build payloads in
  `buildPayload()` (`src/server/integrations.ts`), and give Slack a message per
  event through `slackMessage()` (D101: never client emails or phones; text
  from staff or clients escaped). Life's per-mutation events (about 40) are
  **not** all exported: only what an outside automation needs. Mapping in 7.4.
* **Multi-tenant safety:** every query takes the store id; a cross-store
  reference is impossible by composite FK; test it in `commerce.test.ts`
  (insert a line whose invoice belongs to another store -> error).

### 4.10 Module switch, settings and demo data

* `stores.modules` gains `work` (migration widens `stores_modules`); `Store`
  gets `workOn` (`src/server/stores.ts`, like `bookingsOn`, `deliveriesOn`);
  `setWorkModule()` + `saveWorkModuleAction` + a card on the Features page
  (owner only), audit `work.enabled/disabled`.
* **WP1a did the data level only:** `Store.workOn` (`src/server/stores.ts`),
  `MODULES` / `StoreModule` (`src/lib/store-modules.ts`) and the widened
  `stores_modules` check. **WP5 must wire:** the Features card and
  `setWorkModule()` (same `array_agg(distinct m) ... array_remove` update as
  `src/server/bookings.ts`), the store admin layout tab and group,
  `PageNeeds` (`src/lib/admin-map.ts`: add `"work"`) with its use in
  `src/server/owner-assistant.ts` (`needs` map beside `bookings`/`deliveries`)
  and `admin-map.test.ts`, and any `Store` object literals in tests
  (`workOn: false`, done for `products.int.test.ts`).
* Turning it **off** hides the pages and stops the cron for that store; data is
  kept.
* `clone_store()` must **not** copy Work data (clients are the owner's own).
  It copies `work_hour_products` (with the demo hours product, next bullet).
* Demo products rule (CLAUDE.md): the new product kind `hours` needs
  `commerce.add_demo_hours()` (a "Demo: 10 hours" package, `delivery = service`,
  picture in `public/demo/`, called by the migration for production's template
  and by `supabase/seed.sql`, and `clone_store()` copying `work_hour_products`).

---

## 5. Where it lives in the admin

### 5.1 Module and navigation (D65, D102, D107)

* **Switch:** Features page (`src/app/admin/(gated)/[store]/settings/features/page.tsx`
  and `actions.ts`), a "Work and time" card, owner only, `saveWorkModuleAction`
  -> `setWorkModule()` (pattern: `setDeliveriesModule` in
  `src/server/standing-orders.ts`: update `stores.modules`, `audit()`),
  `updateTag(storeTag(...))`.
* **Store type:** `workOn` beside `bookingsOn` and `deliveriesOn`
  (`src/server/stores.ts`).
* **Navigation** (`src/app/admin/(gated)/[store]/layout.tsx`, D107): the *daily*
  surface goes in the header **tabs** and the rest in a **sidebar group**, both
  only `...(store.workOn ? [...] : [])`:
  * Tab: `{ href: base/work, label: "Work" }` (after Orders).
  * Group **Work**: Overview (`/work`, `exact`), Clients, Invoices, Recurring
    invoices (optional page), Time (optional page), Reports, Work settings
    (`/settings/work`).
* **`ADMIN_PAGES`** (`src/lib/admin-map.ts`): one entry per page (below), with
  `needs: "work"`. Extend `PageNeeds` with `"work"` and the option object of
  `pagesFor()`/`findPages()` (as `deliveries: true` today), and update
  `src/lib/admin-map.test.ts` if it lists needs. The test walks the `page.tsx`
  files under `(gated)/[store]`, so it fails until every new page is listed and
  nothing stale remains. Route handlers (`route.ts`) are not pages.
* **Pages check for themselves** (`requireMember(storeSlug)` in every page and
  action; `if (!store.workOn) notFound()` or an "switched off" panel like the
  deliveries page). A layout's check does not stop a page streaming.
* No new top-level `/admin/{word}`: everything is under `/admin/{store}/work`
  and `/admin/{store}/settings/work` (the store slug reserves other first
  segments).
* `FULL_WIDTH` in the layout is only for editors; the invoice detail uses the
  normal width like Life's `max-w-3xl`.

### 5.2 Routes to create

| Store route | Mirrors (Life) | Components (target `src/components/admin/work/`) | Notes |
|---|---|---|---|
| `/admin/{store}/work` | `/app/work` overview | `work-overview.tsx` (stat cards: clients, drafts, unbilled hours; open drafts; recent invoices; **receivables and overdue**, 6.5), `timer-strip.tsx` (the running clock, stop button, on every Work page) | Life's Organizations tab is dropped. |
| `/admin/{store}/work/clients` | client directory in `work-home.tsx` | `clients-list.tsx`, `client-form.tsx` (sheet) | Search, archived toggle, "Make client from customer/company". |
| `/admin/{store}/work/clients/{clientId}` | `/app/work/clients/[id]` | `client-detail.tsx`, `client-form.tsx`, `client-people.tsx` (customers of the linked company, replaces `client-contacts-card.tsx`), `assignment-form.tsx`, `recurring-panel.tsx`, `recurring-form.tsx`, `client-invoices.tsx` (incl. void/credited), `hours-balance-card.tsx` (6.2, new) | Generating drafts on render (Life) becomes the cron's job plus "Generate now"; **no writes while rendering.** |
| `/admin/{store}/work/invoices` | `/app/work/invoices` | `invoices-list.tsx` (chips All, Draft, Sent, **Overdue**, Paid, **Void**; client filter; "New invoice" sheet), `invoice-create-sheet.tsx` | Unlike Life's, All includes void, or a Void chip exists. |
| `/admin/{store}/work/invoices/{invoiceId}` | `/app/work/invoices/[id]` | `invoice-detail.tsx` (Billing and Work tabs), `invoice-lines-editor.tsx`, `invoice-live-totals.tsx`, `invoice-totals-footer.tsx`, `invoice-work-panels.tsx`, `tasks-panel.tsx`, `time-panel.tsx`, `log-time-sheet.tsx`, `estimate-alerts.tsx`, `use-work-timer.ts`, `invoice-details-sheet.tsx`, `issue-dialog.tsx` (readiness checklist and preview), `payment-dialog.tsx`, `credit-note-dialog.tsx`, `invoice-history.tsx` (from `work_events`) | Editable only while `draft`; after issue the page shows the snapshot and actions (record payment, credit, send again, copy hosted link). |
| `/admin/{store}/work/invoices/{invoiceId}/print` | `/work-invoice-print/[id]` | `invoice-document.tsx` (shared by print, hosted page and email), `PrintButton` | From the snapshot; language of the invoice. |
| `/admin/{store}/work/reports` | `/app/work/reports` | `reports-wizard.tsx`, `report-preview.tsx` | Same wizard (client, presets, dates). |
| `/admin/{store}/work/reports/print` | `/app/work/reports/print` | `report-print.tsx` | |
| `/admin/{store}/work/reports/csv` (route handler) | `/api/work/report` | none | `route.ts` with `requireMember()`, like `hosts/dac7/[year]/[part]/route.ts`; uses `toCsv()` from `src/lib/dac7.ts` so text is safe for spreadsheets. |
| `/admin/{store}/settings/work` | `work-invoice-settings.tsx` + missing seller details | `work-settings-form.tsx` (`ActionForm`): VAT registration and number, default payment days, currency, bank, payment note, footer, **numbering** (prefix, next number, read-only last issued), estimate-alert defaults, whether clients see time notes | Owner only to save; readiness list ("you can issue invoices when...") shown here and in the issue dialog. |
| `/admin/{store}/work/recurring` (optional) | none (Life kept it in the client page) | `recurring-list.tsx` | One list of templates with next date and last instance; useful for "what will bill this week". |
| `/admin/{store}/work/time` (optional, W5) | none | `time-log.tsx`, `quick-log.tsx` | Cross-client "my time this week", start a clock on any assignment; Life only had this inside one invoice. |
| `/admin/{store}/work/hours` (W3) | none | `hours-overview.tsx` | Balances of all clients, low and expiring, manual adjust. |
| `/s/{store}/{market}/account/invoices` | none | `account-invoices.tsx` (in `AccountSection` or its own page) | Signed-in, verified, linked customers only (6.1). |
| `/s/{store}/{market}/account/invoice/{token}` | none | `invoice-document.tsx` + `PayButton` (W4) | Hosted, tokenised, `noindex`. |
| (My account block) | none | `hours-block.tsx` in `src/app/s/[store]/[market]/account/account-section.tsx` | Balance, purchases and a usage statement. |

Server actions live beside the pages (`.../work/actions.ts`), bound to the store
slug, returning `FormState` (`ActionForm`), calling `updateTag()` for any cached
read they change. The invoice editor keeps Life's **JSON save** for the lines
(one call with the whole list, idempotent upsert by id) because autosave with
600 ms debounce and in-flight queueing depends on it; validate with zod
(`workLinesInput`, shared with the browser like `productInput`).

---

## 6. Selling and managing hours in one system

This is the reason for the port. Five ideas, in build order, then what to
build now and what to leave.

### 6.1 (a) Work clients linked to store customers and companies

* **Link, not copy.** `work_clients.customer_company_id` -> `customer_companies`
  (D108) and/or `customer_id` -> `customers` (the primary person). A company
  can be linked to **one** client (partial unique index); a client with neither
  is a plain client that never shops online.
* **Creating clients from the store's customers:** "Make client" on
  `/admin/{store}/customers/{customerId}` and `/companies/{companyId}` (both
  exist) prefilling name, organisation number, billing email, address, country,
  locale and the company's tier note; and "Open work client" links back. The
  company page and the customer page show a **Work strip**: unbilled hours,
  hour balance, open and overdue invoices. This replaces Life's name-based
  Contacts bridge with real keys.
* **People at a client** = customers whose `company_id` is the linked company,
  their role (`owner` main account, `employee`) shown; the invoice goes to the
  client's `billing_email`, defaulting to the primary person's email.
* **Who sees what in My account** (default, open question 5): only a **verified**
  customer (`emailVerifiedAt`, the existing rule that an unverified registrant
  sees nothing of others') linked as the client's primary person or as the
  **main account** of the linked company sees invoices and the hour statement;
  employees see the hour **balance** only. Time-entry notes are hidden unless
  `work_settings.show_time_notes_to_clients` is on.
* **Automatic linking** happens only from an **order paid by a company
  account** (its `company_id`), or by an explicit owner action. **Never** by
  email match: anyone can type another person's email at checkout.
* Deleting a customer or company sets the link null (`on delete set null (column)`,
  the column-list form needs PostgreSQL 15 or later, which Supabase runs);
  the client, its invoices and its ledger stay.

### 6.2 (b) Hours as a product: packages and retainers

**Product.** A new `products.kind = 'hours'` (widen `products_kind`), variants
`delivery = 'service'` (no stock, shipping or files, as appointments), one row
in `work_hour_products` (`minutes_per_unit`, `valid_days` or none). Price is
per package, VAT-inclusive per market like every product (`vat_category
standard`), so it uses the standard cart, prices (D63 shows business buyers a
net price), campaigns, discount codes, customer tiers and checkout unchanged.
The product editor gains an "Hours" section (like Appointment settings);
`order_lines` gains `credit_minutes int null`, **a snapshot of what one unit
gave as sold** (Store's snapshot rule: a later edit of the product never
changes credits already bought). A new kind of product needs a scenario in
`src/server/checkout-kinds.int.test.ts` (project rule) and a demo product.

**Crediting.** A paid order credits the ledger, in the same transaction as the
payment, by an `AFTER INSERT OR UPDATE OF status ON commerce.orders` trigger
for `status = 'paid'` (the pattern of `orders_bookings_follow`, but also on
INSERT because a subscription's renewal order is **inserted already paid**, as
`integration_order_events` handles it; `complete_order_payment` may also pay an
order that had been cancelled): for each line with `credit_minutes`,
`work_hour_credits` gets a `purchase` row (`minutes = quantity x credit_minutes`,
`expires_on` from `valid_days` in the store's time zone, `order_line_id`,
unique per line so a repeated `complete_order_payment` credits once).
**Which client?** The order's customer -> their company's linked client, else
the customer's own linked client, else (setting "create clients from
purchases", default on) a new client is created from the order's company or
billing details and linked, else the credit waits as an **unassigned** row
(`client_id null`, customer and order recorded) for the owner to assign.
Emails: the order confirmation states the hours credited.

**Drawing down.** When billable time is logged on an **hourly** assignment of a
client with `use_prepaid`, `commerce.work_apply_prepaid(time_entry)` (SQL, in
the logging transaction, `for update` on the client row) covers
`min(balance, minutes)`: it sets `prepaid_minutes` on the entry and writes a
`usage` row (negative), taking from the **earliest expiring**, then oldest,
purchase (FIFO by `expires_on` nulls last). Deleting or making an unbilled
entry non-billable writes the reversing row (positive). Fixed-fee assignments
and non-billable time never draw. An entry attached to an issued invoice is
immutable, so a usage row is never reversed after billing.
**Partial coverage:** an entry of 90 minutes with 60 left is 60 prepaid + 30
unbilled; invoicing takes `minutes - prepaid_minutes`. The rules are pure
functions in `src/lib/work-hours.ts` (unit tested) and applied by the SQL
function; keep them equal by testing both against the same cases.

**Balances.**
* Owner: `hours-balance-card.tsx` on the client (balance, expiring soon, purchases
  with their order numbers, usage list), `/work/hours` across clients, low
  balance alerts (`hours.low` D41 event and a control-center item when the
  balance falls below the client's threshold, default 2 h).
* Customer: My account block "Your hours" (balance, next expiry, purchases,
  usage statement per date and task; notes only if allowed), in nb/sv/da/en.
* Manual **adjustments** (owner only, audited) cover hours sold outside the
  store, corrections and goodwill.

**Expiry.** `valid_days` null by default (no expiry). If set, the five-minute
cron writes an `expiry` row for the unused remainder after `expires_on`.
LEGAL: expiring prepaid services sold to **consumers** is restricted in many
countries and must be in the terms; default off and only offered on
business-only products (open question 3).

**Refunds and cancellation.** Extend the order refund flow
(`src/server/order-admin.ts`) so a refund of an hours line shows how much was
used and offers to refund only the **unused** hours (a `refund` ledger row
negative); refunding used hours requires an owner-confirmed adjustment. A
cancelled paid order reverses the unused credit the same way.

**Retainers.** A monthly retainer is a subscription (D25, selling plan on an
`hours` product): each paid renewal is an order, so the same trigger credits a
new month with the plan's minutes, optional expiry at period end (no rollover
by default). Verify that selling plans are allowed on `service` variants before
promising it; build in a follow-up, not in W3.

### 6.3 Legal rules that change how hours may be sold

* **Business vs consumer.** Recommended default: hour packages are
  `products.audience = 'businesses'` (company details at checkout,
  `companyRequired()`), which also makes the credit go to a company client.
  For consumers the 14-day withdrawal right applies to services: the buyer may
  cancel, and for services begun within the period pays proportionally for
  what was used (CRD Art. 16(a), 14(3)); Store's `withdrawal_exclusion` has no
  value for "service", so a package sold to consumers stays `none` and the
  refund rule above (refund unused hours) is the mechanism. LEGAL: needs a
  lawyer's read before consumer sales (open question 3).
* **Vouchers and VAT.** Covered in 4.5 (5).
* **Terms.** Whether the hours expire, are transferable between the company's
  people, and how used hours are counted (rounding, minimum increments) must be
  in the store's terms page; add fields to the product page text, not code.

### 6.4 (c) Invoicing time that is not prepaid

This is Life's core flow, kept. Time is logged against an assignment (and
optionally a task); the draft invoice for the assignment mirrors tasks as
lines with hours from the logged billable time (`syncTaskHoursToDraftLine`
semantics: rate, discount and VAT kept; fixed-fee lines left alone); the owner
adjusts lines, rounds up hours, issues, and the client pays. What changes in
Store:

* Lines take hours from **unbilled, uncovered** entries
  (`invoice_line_id is null`, `minutes - prepaid_minutes`), and attach them.
* A **"New invoice from unbilled time"** action (client -> pick assignments and
  date range -> draft) covers time logged outside a task and monthly billing
  of an ongoing engagement.
* Prepaid coverage appears as an informational zero line ("12 h paid in
  advance, order 1042") so the statement adds up for the client.
* Issue is the gap-free numbered document of 4.4 with VAT per 4.5.

### 6.5 The Work overview (the useful residue of Life's Finances and Revenue view)

Counted in code, per currency, never summed across currencies (as
`controlCenter()`): **unbilled** (billable minutes and net value at the rate,
per client), **drafts** (count, value), **receivables** = sent and unpaid,
in buckets *not yet due / due within 7 days / overdue* with the oldest first,
**paid this month** (by `paid_at`), **hours balances low**. `workOverview()` in
`src/server/work-overview.ts` (pure parts in `src/lib/work-overview.ts`, unit
tested) feeds the Work page and the control center's "Needs your attention"
(`attentionFor()`): "N invoices overdue", "N h unbilled for over 30 days",
"N recurring invoices ready to issue".

### 6.6 (d) Online payment of a work invoice through the store's Stripe Connect account

Design (build last):

* **Reuse** `getCheckoutAccount(storeId)`, `platformStripe(mode)`,
  `ensureTestAccount()`, `storeFeeBps()`/`saleFee()`, and the direct-charge
  pattern of `startCheckout()` (`src/server/checkout.ts`): `{ stripeAccount }`,
  `application_fee_amount`, **no `payment_method_types`** (the store's own
  Stripe Dashboard chooses methods, which for B2B invoices usually includes
  bank methods).
* A Checkout Session **in payment mode, hosted** (`success_url` back to the
  hosted invoice page, `cancel_url` its page), one line (description = the
  document number), amount = the **outstanding** amount, currency = the
  invoice's, `client_reference_id` = invoice id, metadata `{ work_invoice_id,
  store_id, amount_minor }`, `expires_at` in a day. Store `work_invoice_payments`
  as pending only on the webhook, not before.
* **Webhook:** the Connect webhook (`/api/stripe/connect/{mode}`, finds the
  store from `event.account`) already calls `handleStripeEvent` ->
  `applySession()`. Add a branch **before** the `commerce.payments` lookup (which
  is order-only: `payments.order_id` is not null): if
  `session.metadata.work_invoice_id`, call `applyWorkInvoiceSession()`: verify the
  invoice belongs to the store, insert the payment idempotently (unique
  `provider_reference`), set `paid` if covered, write `work_events`, queue
  `work_invoice.paid`, email a receipt. The page's return path also asks
  Stripe when the webhook is late (as `getShopperOrder` does).
* **Edge cases:** invoice paid by bank and by card (record both; show
  "overpaid", owner refunds in Stripe's Dashboard); invoice credited while a
  session is open (close it); currency the connected account settles in
  (Stripe converts and fees apply); refunds from the Stripe Dashboard must be
  mirrored by a negative payment row (`charge.refunded` / `refund.*` events).
* **Fee:** applying the store's normal sale fee to invoice payments is a
  platform decision (open question 6).
* **Not in scope:** offering credit. Store's plan says "first-party pay by
  invoice" is never for launch because of credit risk and CCD2 for shoppers;
  work invoices are professional services billed after delivery, which is a
  different thing, but **do not** offer hour packages "on invoice" to consumers.

### 6.7 What to build now, later, and never

| | Recommendation | Why |
|---|---|---|
| Work module with Life's core flows (clients, assignments, tasks, time, timers, invoices to issue, payments recorded, print, settings) | **Now (W1)** | It is the port; also the basis of everything else. |
| Client <-> customer/company link and Work strips on customer pages | **Now (W3, small)** | Cheap, no legal weight, makes the two halves feel like one system. |
| Hour ledger, manual crediting, balance card | **Early (W3a)** | Useful even before online sales (hours sold by invoice or contract). |
| `hours` product kind, online purchase crediting, draw-down at logging, My account block | **W3b** | The heart of "sell and manage hours"; needs the ledger and a lawyer's read on consumer terms. |
| Recurring invoices with **owner-approved** auto-issue and email | **W2** | Life parity, but with a switch, skips and a legal document. |
| Online payment of invoices | **Later (W4)** | Money movement, fees, refunds and disputes; bank transfer plus "record payment" is enough at first. |
| Retainers by subscription | **Later** | Depends on selling plans for services. |
| PDF generated on the server, email with PDF attached | **Later** | The hosted page plus browser print covers it; adds Chromium or a dependency and a binary-attachment change to `sendEmail`. |
| Finances/budget projections, organizations, Revenue wall | **Never** | Life's personal-finance features. |
| Automatic interest, reminders, collection | **Never automatic** | Owner-triggered reminders only. |

### 6.8 Risks in one list

* **Accounting:** Store is not a bookkeeping system; provide exports and keep
  numbering, snapshots and append-only rules airtight; two numbering systems
  (Stripe order invoices, Work invoices) for one seller.
* **VAT:** wrong treatment prints a wrong tax document. Ship with manual,
  owner-chosen VAT treatments, accountant-approved notes for NO, SE, DK, EN,
  block issue when the store's VAT data is incomplete, and no VIES automation
  at first.
* **Legal:** invoice content by country, retention, consumer rights on prepaid
  hours, expiry of prepaid credits, e-invoicing to public buyers, late-payment
  interest, GDPR (time-entry notes; erasure vs retention).
* **Money integrity:** ledger and time entries must agree (test both, lock the
  client row, immutable billed entries); float math is forbidden; refunds of
  used hours.
* **Behaviour drift from Life:** the one-draft-per-assignment change and
  immutable issued invoices alter workflows the owner is used to; show a short
  "how this differs from Life" note on the Work settings page.

---

## 7. Phased implementation plan

### 7.1 Phases

| Phase | Ships | Work packages |
|---|---|---|
| **W0** | Decisions, legal texts, accountant sign-off on 4.4 and 4.5 | WP0 |
| **W1 Core** | Module switch; clients, assignments, tasks, time, timers; invoices from draft to issued and paid (manual payment); print page; settings; overview | WP1a, WP2, WP3, WP4, WP5, WP6, WP7a |
| **W2 Documents and automation** | Email and hosted page; credit notes; recurring invoices; reports and CSV | WP7b, WP8, WP9 |
| **W3 One system** | Customer link, hour ledger, hours product, My account | WP10, WP1b, WP11 |
| **W4 Payments, AI, events** | Online payment, owner tools, D41 events, Slack | WP12, WP13 |
| **W5 Extras** | Time page, server PDF, Life import, retainers | WP15 and follow-ups |

### 7.2 Work packages (disjoint; several engineers in parallel)

Each package lists its Life **source files** (read them) and its Store
**target files**. `int` = integration tests against a real database.

**WP0 Decisions and legal groundwork** (owner, accountant; no code)
Answers to section 8; hand-written nb/sv/da/en legal texts (document labels,
VAT notes, late-payment note); accountant sign-off on 4.4 (series) and 4.5;
`docs/decisions.md` D122 and this file's status; nothing new for
`docs/residency-register.md` (Resend already listed).

**WP1a Schema, migrations, database rules** (blocks WP3, WP4, WP8)
Source: Life migrations in section 2 (read), `scripts/smoke.ts` cases 13884-14160.
Target: `src/db/schema.ts` (tables of 4.2 except hours); generated migration +
custom `..._work_rules.sql`: widen `stores_modules`; series `work_invoice`,
`work_credit_note` for existing stores and `initialise_store()`;
`commerce.issue_work_invoice()`, `commerce.credit_work_invoice()`,
`commerce.work_start_timer()`, `commerce.work_stop_timer()`; immutability and
append-only triggers; one-draft and numbering constraints; D41 queue triggers
for `work_invoice` status changes; `src/db/commerce.test.ts` (numbering has no
gaps under concurrency; issued lines and invoices cannot change; entries on
issued invoices cannot change; second timer rejected; cross-store references
rejected; ledger append-only). Apply to production and record the version in
`docs/decisions.md` (Migration versions).

**WP1b Hours schema** (with WP11)
`products_kind` + `hours`; `work_hour_products`, `work_hour_credits`;
`order_lines.credit_minutes`; `commerce.work_credit_hours()` and the
order-paid trigger; `commerce.work_apply_prepaid()`; `add_demo_hours()`;
`clone_store()` copy of `work_hour_products`; tests in `commerce.test.ts`.

**WP2 Pure libraries and unit tests** (no database; can start at once)
Source -> target (all under `src/lib/`, each with a `*.test.ts`):
`lib/work/invoice-calc.ts` -> `work-calc.ts` (integer/BigInt math of 4.3,
`roundUpHours`, line and invoice totals, `UNNAMED_LINE`);
`lib/work/billing.ts` -> `work-calc.ts` (`effectiveRate`, minutes to
hundredths of an hour); `lib/work/payment-due-days.ts`, `invoice-dates.ts`,
`lib/dates/utc-day-param.ts` -> `work-dates.ts` (store-time-zone calendar
days, due date, overdue); `lib/work/recurring-expense-schedule.ts` ->
`work-recurrence.ts` (`listOccurrenceDates` unchanged in behaviour, the
40-day generation window, skipped periods); `lib/work/estimate-alerts.ts` ->
`work-estimate.ts`; `lib/work/time-entries.ts` -> `work-time.ts`;
`workReportToCsv`, `buildCsv` (`invoice-export-controls.tsx`) -> `work-csv.ts`;
new: `work-vat.ts` (treatments, notes selection), `work-hours.ts` (FIFO draw
down, expiry, refund maths), `work-overview.ts`, `work-invoice-text.ts`
(hand-written legal text, nb/sv/da/en/en fallback), `work-input.ts` (zod
schemas shared with the browser). Port Life's tests: `lib/work/payment-due-days.test.ts`
(node:test -> Vitest) and the smoke cases for estimate stages, round-up and
line/task pairing, as unit tests here.

**WP3 Server: clients, assignments, tasks, time, timers**
Source: `server/actions/work.ts`, `server/queries/work-data.ts` (list and detail
readers, `summarizeAssignment`), `server/services/work-line-task-sync.ts` (task
half), `use-work-timer.ts` (the semantics). Target: `src/server/work.ts`
(clients, assignments, tasks), `src/server/work-time.ts` (entries, timers,
prepaid hook), actions in `src/app/admin/(gated)/[store]/work/actions.ts`,
`src/server/work.int.test.ts`. Rules: archive not delete; assignments with time
cannot be deleted; owners edit all, admins own entries; entries on issued
invoices immutable; timer functions from WP1a.

**WP4 Server: invoices**
Source: `server/actions/work-invoices.ts`, `lib/work/send-invoice.ts`,
`lib/work/invoices.ts`, `server/services/work-line-task-sync.ts` (line/task
mirror, task hours to line), `server/queries/work-data.ts` (`listWorkInvoices`,
`getWorkInvoiceDetail`), `server/actions/finance.ts` (only the *idea* of payment
recording). Target: `src/server/work-invoices.ts`: create draft (with an
assignment or standalone), `saveLines` (JSON upsert by id, order = list order),
mirror sync (tasks <-> lines) and unbilled-time generation with
`invoice_line_id` attachment, `issueInvoice` (calls the SQL function; readiness
checklist), `creditInvoice`, `recordPayment` / `reversePayment`, delete draft,
readers; `src/server/work-invoices.int.test.ts` (draft -> issue -> pay ->
credit; numbers; VAT scenarios; immutability; concurrent issue; one draft per
assignment; prepaid coverage lines).

**WP5 Admin UI: module, navigation, clients, list, settings, overview**
Source: `components/work/work-tabs.tsx`, `work-home.tsx`, `work-client-form.tsx`,
`work-client-detail.tsx`, `work-assignment-form.tsx`, `invoices-list.tsx`,
`invoice-create-sheet.tsx`, `components/settings/work-invoice-settings.tsx`.
Target: `.../[store]/layout.tsx` (tab and group), `settings/features/*` (card and
action), `src/server/stores.ts` (`workOn`), `src/lib/admin-map.ts` + test, pages
in 5.2 for overview, clients, client detail, invoices list, settings, and their
components in `src/components/admin/work/`. E2E `e2e/work.spec.ts` (switch on,
create client, settings).

**WP6 Admin UI: the invoice screen**
Source: `invoice-detail.tsx`, `invoice-lines-editor.tsx`, `invoice-live-totals.tsx`,
`invoice-totals-footer.tsx`, `invoice-work-panels.tsx`, `work-tasks-panel.tsx`,
`work-time-panel.tsx`, `work-log-time-sheet.tsx`, `estimate-alerts.tsx`,
`use-work-timer.ts`. Target: the invoice detail page and its components
(5.2). Keep: 600 ms autosave with in-flight queue, optimistic timer, live
totals only ticking when a running clock's task is on the invoice, rapid-fire
task add, drag reorder (`@dnd-kit`), estimate alerts (stages, once per timer
via `localStorage`, Web Audio chime; still page-open only). Change: totals via
`work-calc.ts`, lines read-only after issue, issue dialog with readiness list,
payment and credit dialogs.

**WP7 Documents** (a: print, b: email/hosted/CSV)
Source: `app/work-invoice-print/[id]/page.tsx`, `invoice-auto-print.tsx`,
`invoice-export-controls.tsx`. Target: (a, W1) `invoice-document.tsx` and the
print page from the snapshot, `PrintButton`; (b, W2) `src/server/work-emails.ts`
(`sendInvoice`, `sendCreditNote`, reminder; idempotency key
`work-invoice:{id}`; content by `renderEmail`), the hosted page
`/s/{store}/{market}/account/invoice/{token}`, invoice and payments CSV routes.
Optional: binary attachments in `src/server/email.ts`; server PDF route.
`src/server/work-emails.int.test.ts` (email kept and logged when Resend is not
set up, as `email.test.ts` does).

**WP8 Recurring invoices and cron**
Source: `lib/work/recurring-invoice-generate.ts`, `recurring-invoice-autosend.ts`,
`recurring-expense-schedule.ts`, `server/actions/work-recurring-invoices.ts`,
`work-recurring-invoice-form.tsx`, `work-client-recurring-invoices-panel.tsx`,
`app/api/cron/work-recurring-invoices/route.ts`, `recurring-invoice-autosend-trigger.tsx`
(not ported). Target: `src/server/work-recurring.ts`
(`prepareDueRecurringWork()`: for each store with the module on, generate missing
drafts in the store's time zone within the 40-day window, skip
`skipped_periods`, then issue and email those whose template has `auto_issue`;
never in a page render, never in a client trigger), one line added to the
five-minute job in `src/app/api/cron/cart-reminders/route.ts`, the panel and
form under the client page, "Generate now", "Skip this period", "Issue now".
`work-recurring.int.test.ts` (idempotent, skip list, lookback, month-end
clamping, auto-issue off by default).

**WP9 Reports and overview**
Source: `buildWorkReportPayload`, `workReportToCsv`, `work-reports-wizard.tsx`,
`work-report-print.tsx`, `app/api/work/report/route.ts`, `reports/*`.
Target: `src/server/work-reports.ts` (fix Life's quirk: a **fixed fee counts once**,
in the period it is invoiced, not in every period shown; amounts from
invoice lines where issued), report pages and CSV route (5.2), `work-overview.ts`
wiring into `src/server/control-center.ts` and `src/lib/control-center.ts`
(attention items, tested like the existing ones).

**WP10 Customer and company link**
Source: `lib/work/client-company.ts`, `server/queries/work-contacts.ts`,
`client-contacts-card.tsx`, `components/contacts/company-client-card.tsx`.
Target: `src/server/work-clients.ts` link functions; "Make client" and Work
strips on `.../[store]/customers/[customerId]/page.tsx` and
`.../[store]/companies/[companyId]/page.tsx`; My account invoices list and
hosted-page authorisation (`src/server/customers.ts` helpers, verified email
rule); nb/sv/da/en account strings in `src/lib/i18n.ts`;
`src/server/work-clients.int.test.ts`; e2e `e2e/work-account.spec.ts`.

**WP11 Hours product and ledger UI** (depends on WP1b, WP4, WP10)
Target: product kind `hours` through `src/lib/product-input.ts`,
`src/server/products.ts`, the product editor, product page part, cart and
`placeOrder()` snapshot (`order_lines.credit_minutes`), `cartSummary()` parity,
**`src/server/checkout-kinds.int.test.ts` scenario**, the order-paid trigger,
refund handling in `src/server/order-admin.ts`, `hours-balance-card.tsx`,
`/work/hours`, My account block, expiry step in the five-minute cron,
`hours.low` event, demo product and `clone_store()`. `work-hours.int.test.ts`
(paid order credits once; partial coverage; FIFO by expiry; reversal on delete;
refund of unused hours only; two concurrent time logs cannot overdraw).

**WP12 Online payment of invoices** (depends on WP4, WP7b)
Target: `src/server/work-payments.ts` (`startInvoicePayment`,
`applyWorkInvoiceSession`), the branch in `src/server/stripe-webhooks.ts`,
`PayButton` on the hosted page, refund mirroring. `work-payments.int.test.ts`
modelled on `checkout-stripe.int.test.ts`.

**WP13 AI manager, events, Slack, audit**
Target: tools in `src/lib/owner-tools.ts` (zod arguments, descriptions) and
handlers in `src/server/owner-tools.ts` (answers from Store's data; amounts
by `formatMoney`; sums in code; a line in `TOOL_WORDS`; gate where needed),
served to Kaizen Life through `store-mcp.ts` automatically (owner tools are
all served there): `work_summary`, `list_work_clients`, `get_work_client`,
`create_work_client`, `log_work_time`, `start_work_timer`, `stop_work_timer`,
`list_work_invoices`, `create_work_invoice_draft`, `hour_balance`,
`send_work_invoice` (**gate `send`**: issues a legal document and emails the
client), `credit_work_invoice` (**gate `send`**), `record_work_payment`,
`adjust_hours` (owner-only, approval text names the client and minutes); a skill
in `src/lib/assistant-skills.ts` ("invoice a client for unbilled time");
`ADMIN_PAGES` entries; D41 events, Slack messages (`src/lib/slack.ts`,
`src/server/slack.ts`), `EVENTS` list; `src/server/owner-assistant.int.test.ts`
cases; docs.

**WP14 Tests and documentation** (continuous)
Vitest units (WP2), PGlite rules (WP1), int (WP3-WP12), e2e: `e2e/work.spec.ts`
(switch on, client, log time, timer, issue, print, record payment, credit),
`e2e/work-account.spec.ts`, `e2e/work-hours.spec.ts`; update `docs/decisions.md`
(D122, migration versions), `docs/plan.md` if it lists modules, and this file
(what was done differently, as `bookings.md` and `custom-fields.md` do).

**WP15 Import from Life (optional)** A script (`scripts/import-life-work.mjs`)
reading the owner's Life project (service role, read-only) and writing to a
store: clients (no organizations), assignments, tasks, time entries, invoices
and lines (converted per 4.3, statuses mapped, numbers kept as `legacy_number`,
`imported = true`, no series numbers, no emails, no D41 events), recurring
templates converted to net amounts, `paid` invoices with a payment row dated
`paid_at`. Dry-run report of every total that does not reconcile. Never run
without the owner's explicit go-ahead.

### 7.3 Order and parallelism

```
Day 1 in parallel:  WP0   WP1a   WP2
After WP1a+WP2:     WP3 ∥ WP4          (WP4 needs WP3's entry types: agree the
                                        interfaces in WP2 first)
                    WP5 (after WP1a; stubs until WP3)   WP6 (after WP4 shape)
                    WP7a (after WP4)   WP9 (after WP3)   WP8 (after WP4)
W2:                 WP7b ∥ WP8 ∥ WP9
W3:                 WP10 ∥ WP1b, then WP11
W4:                 WP12 ∥ WP13
Continuous:         WP14
```

Disjointness: WP2 owns `src/lib/work-*.ts`; WP3/WP4/WP8/WP9/WP10/WP12 each own
their own `src/server/work-*.ts` file; WP5/WP6/WP7 own disjoint component
files; the shared files (`schema.ts`, `layout.tsx`, `admin-map.ts`,
`owner-tools.ts`, `integrations.ts`, `cart-reminders/route.ts`,
`i18n.ts`) are edited by **one package each per phase** (WP1a: schema;
WP5: layout, admin-map, stores; WP8: cron; WP10 and WP7b: i18n strings;
WP13: owner tools and integrations) to avoid merge conflicts.

### 7.4 Life event -> Store mapping

| Life event | Store `work_events.type` | D41 integration event |
|---|---|---|
| `work_client.created/updated/deleted` | `client.created`, `client.updated`, `client.archived` | `work_client.created` |
| `work_client.finance_category_linked`, all `*budget_projection*`, `*finance_category_linked*`, `work_organization*`, `work_organization_*` | dropped | none |
| `work_assignment.created/updated/deleted` | `assignment.created`, `.updated`, `.deleted` (only if empty) | none |
| `work_assignment.invoiced` | dropped (derived) | none |
| `work_task.created/updated/toggled/deleted` | `task.created`, `.updated`, `.done`, `.reopened`, `.deleted` | none |
| `work_task.reordered` | dropped | none |
| `work_time.logged/deleted` | `time.logged`, `time.deleted` | none (too chatty) |
| `work_invoice.created` | `invoice.created` | none |
| `work_invoice.updated` (every autosave) | dropped | none |
| `work_invoice.sent` | `invoice.issued` (+ `invoice.emailed`) | `work_invoice.sent` |
| `work_invoice.reverted_to_draft`, `.recovered_to_draft` | dropped (not allowed) | none |
| `work_invoice.paid`, `.payment_received` | `payment.recorded` (`invoice.paid` when covered) | `work_invoice.paid` |
| `work_invoice.voided` | `invoice.credited` | `work_invoice.credited` |
| `work_invoice.deleted` | `invoice.deleted` (draft) | none |
| `work_recurring_invoice.created/updated/deleted` | `recurring.created`, `.updated`, `.deleted`; new `.generated`, `.skipped`, `.issued` | none |
| (new) | `hours.purchased`, `.used` (not logged per entry), `.adjusted`, `.expired`, `.refunded` | `hours.purchased`, `hours.low` |

### 7.5 Test matrix

* **Unit** (Vitest): every `src/lib/work-*.ts`; the round-trip of money math
  including the cases of `invoice-calc` (0 % lines, 100 % discount, rounding
  at .5, 61 minutes = 1.02 h, round-up steps, empty quantity), payment
  days, month-end recurrence, estimate stages (strictly less than, exactly at,
  over), time filter, CSV escaping, FIFO hours, VAT treatment notes.
* **DB rules** (`src/db/commerce.test.ts`): gap-free numbers, immutability,
  one timer, one draft per assignment, ledger append-only, cross-store FK.
* **Integration** (`pnpm test:int`): lifecycle, VAT scenarios, recurring,
  hours, payments, tools; **a euro scenario in `checkout-kinds.int.test.ts`** for
  the new product kind (project rule for new money reads) and for any price
  read in `shown()`/`convertedSql()` terms.
* **E2E** (Playwright, against `pnpm start`, build first): the Work flow, the
  customer's account view, and the hours purchase-to-draw-down flow.
* Before every push: lint, typecheck, tests (project workflow: commit and push to
  `main`, which deploys to production, so **the module stays behind its switch
  and no existing behaviour changes until an owner turns it on**).

---

## 8. Open questions for the owner

Only true product decisions. Each has a recommended default.

1. **Invoice numbers.** Which number should the first Work invoice in Store
   have, and what prefix? Are invoices also still issued elsewhere (Life or an
   accounting tool)? *Default:* a separate series `W-`, starting at the owner's
   last used number plus one, set in settings before the first issue.
2. **Auto-issuing recurring invoices.** Life sends every active recurring
   invoice on its date with no switch. *Default:* generate a draft and notify;
   **issue and email automatically only for templates the owner switches to
   auto-issue.**
3. **Prepaid hours: expiry and consumers.** Do hour packages expire? Are they
   sold to consumers or only to businesses? *Default:* no expiry; packages are
   business-only (`audience = 'businesses'`); consumer sales wait for a
   lawyer's review of withdrawal and refund wording.
4. **VAT at launch.** Support only what the accountant has approved.
   *Default:* domestic VAT from `commerce.vat_rate()`, "not VAT registered",
   and manually chosen reverse charge / outside scope / exempt with
   hand-written statutory notes for Norway, Sweden, Denmark and English; no
   automatic VIES lookup; issue blocked until the store's VAT and bank details
   are complete.
5. **What clients see in My account.** *Default:* the verified main account of
   a linked company (and the linked person) sees invoices and the hour
   statement; other employees see the balance; time-entry notes hidden unless
   switched on per store.
6. **Platform fee on online invoice payments.** Apply the store's normal sale
   fee to invoice payments through Stripe? *Default:* yes, the same fee as
   sales (`storeFeeBps()`), stated on the settings page.
7. **Who may do what.** *Default:* owners and admins use Work; only owners
   change settings, credit invoices, adjust hour balances and delete clients.
8. **Admin language.** English (like the rest of the admin) or Norwegian for
   Work? *Default:* English now; Life's nb/sv/de/es strings stay as the source
   for a later admin translation.
9. **Life data.** Import Life's clients, invoices and time into the store, or
   start clean? *Default:* start clean; offer the import script once W1 is
   stable and only for the owner's own store.
10. **Assignment and invoice model.** Life has exactly one invoice per
    assignment. Store's default allows many invoices per assignment (one draft
    at a time) so an ongoing hourly engagement can be billed monthly.
    *Default:* many, as designed in 4.6; say so if the owner prefers Life's
    exact rule.
