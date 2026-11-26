# Projects and checklists: Kaizena Life's project management in Kaizena Flow (D903; working plan)

Porting the **projects and checklists** of Kaizen Life (the owner's personal life-management app, `/home/user/lifesaver-app`) into
Kaizena Flow, so a store's team plans its work where it sells: a product launch, the season's campaign, opening a shop, a client's
job. This is the design and porting document, and the working plan: find a step's row by id, and in the same change set it to Done
with the date and the commit (as `CLAUDE.md` asks of every working plan). It follows the route the Work port took (`docs/work.md`,
D122): what Life does, Life's data model, what is Life-only, the mapping to Flow's conventions, then packages.

Reading guide. "Life" is `/home/user/lifesaver-app`; every Life path below is relative to it. "Flow" is this repository.

Evidence is marked **[repo]** (read in the code, 25 November 2026), **[prod]** (counted in Life's production database the same
day: counts only, no person's data read) and **[U]** (not verified).

## 0. The owner's answers (25 November 2026)

1. ~~A store feature on every plan, not a paid extension.~~ **Changed 26 November 2026 (D904): a paid extension that stands alone**, as
   the other extensions (D748): subscribed to on its own, used without a store in a standalone account's workspace, and doing more with
   every other arm the account has (the octopus, `docs/platform.md` P9). Built in P8; the store feature `projects` stays under it.
2. **Store level.** A store's team shares its projects; every row belongs to a store (P1). A combined view across the owner's stores
   may follow, as Work's did (D123).
3. **One kind of task.** A checklist item is Flow's task. Work's tasks (`work_tasks`, 13 rows in one store [prod Flow]) move into
   checklist items in step P6.1, and CRM tasks (`activities` of kind `task`, 6 rows) are weighed in P6.2.
4. **Pushed to `main`**, as `CLAUDE.md` says, each push mirrored to the session's branch.

And, the owner's requirement: **everything about lists, items and statuses is as rich in Flow as in Life.** Section 5 lists every
Life capability with the step that brings it; no capability is dropped for being little used. What is left out (section 3) is what
only makes sense in a personal life app, each with the Flow concept that takes its place.

## 1. What Life's system does

### 1.1 Production use [prod]

| What | Rows | What it tells |
|---|---|---|
| Projects (`task_projects`) | 15 | |
| Checklists | 92 | Most lists stand alone: 20 are in a project, none in two |
| Checklist items | 670 | 489 assigned to a person, 160 to the assistant, 45 with a due date, 41 with a priority, 17 repeating, 5 with a start date, 2 with a cost |
| Subtasks | 312 | All on checklist items |
| Workflow statuses | 90 | 53 per project, 37 defaults, 0 per checklist |
| Project stages (`project_item_statuses`) | 19 | |
| Sections | 19 | |
| Activity messages | 11 | |
| Shares | 3 | |
| List reminders, linked reminders, project conversations | 0 | |

### 1.2 Screens [repo]

- `app/app/checklists/page.tsx`: open and archived lists, *Shared with you*, Routines.
- `app/app/checklists/[id]/page.tsx`: one list (`components/checklists/checklist-detail-body.tsx`, 1,022 lines, and
  `checklist-items-sortable-list.tsx`, 1,828): items and sections dragged in one order, the Done line, drag across lists, bulk
  status, delete and move, swipe actions, filters (`checklist-item-filter.tsx`), the item editor (`edit-checklist-item-modal.tsx`,
  `add-checklist-item-modal.tsx`), subtasks (`components/subtasks/*`), cost summary, due countdown.
- `app/app/checklists/[id]/settings`: the list's statuses and its advanced fields. `app/app/checklists/settings`: the default statuses.
- `components/checklists/checklist-all-items.tsx`: every item across lists, flat.
- `app/app/tasks/projects/page.tsx`: projects with a status bar each. `[id]/page.tsx` (`components/life/task-project-body.tsx`):
  List, Board (`task-project-kanban.tsx`, dnd-kit), Calendar (`task-project-calendar.tsx`) and Timeline (`task-project-gantt.tsx`,
  `lib/tasks/project-timeline.ts`, hand-written), linked lists, notes, chats and reminders, the status panel and health badge.
  `[id]/settings`: the project's stages (`workflow-status-editor.tsx`). `[id]/items/[itemId]`: an item with its activity thread.

### 1.3 Behaviour worth keeping exactly [repo]

- **A plain list until Advanced.** A list is a title and a checkbox until *Advanced list* is switched on, which brings every item
  field at once; per-field switches then take away what this list has no use for (`lib/checklists/advanced-features.ts`). Only a
  switch turned off is stored, so a field added later appears on every advanced list, and hiding a field never clears its data.
  A routine list also hides status, assignment, category and tags (`effectiveFeatures()`). This is Homer and Lisa (`CLAUDE.md`).
- **Statuses with buckets.** Every status is in a bucket, `active`, `done` or `archived`. Ticking an item moves it to the first done
  status, unticking to the first active one, and choosing a done status ticks it. A new item gets the list's first active status
  (first done if it is created ticked). Defaults: Backlog, To do, Done, Archived.
- **Which statuses a list has.** Its own statuses merged with the defaults by slug, its own winning
  (`checklist_effective_statuses()`, migration `20270328090000`).
- **Two axes on a project.** An item's own status says what the work *is* (Ongoing, Blocked, Done); its stage in a project says
  where it sits in *that* project's process (Prospect, Shortlist, Deployment). Neither overwrites the other; a missing stage means
  the project's first (`20270413090000_project_item_status.sql`).
- **Membership, not containment.** A list belongs to zero or more projects, and one of them is its home (`primary_project_id`,
  `20270407090000_work_model_alignment.sql`), for breadcrumbs and for the context an assistant reads.
- **Sections** are named separators in the same order as the items; the Done line is fixed and not stored. Folding a section or
  the Done line is each person's own (`checklist_folds`).
- **Recurrence** (`lib/checklists/recurrence.ts`): daily, weekly on weekdays, every N days from an anchor, or monthly on days of
  the month every N months, at one or more times of day. Completing a repeating item moves it to its next due time, counts a streak,
  and can be skipped (`server/services/checklist-recurrence.ts`, hourly job `app/api/cron/checklist-recurrence`).
- **Projects** carry a status (planning, active, blocked, done, archived), a health (green, amber, red), a next action, a target
  date and when the status was last reviewed.

## 2. Life's data model, as it stands after every migration [repo]

Everything is scoped by `space_id` (spaces of type personal, household, project, team), with RLS by membership, and inside a space by
`context` (personal or work) and `life_space_id` (rooms).

| Table | Columns that matter |
|---|---|
| `task_projects` | `name, description, color, sort_order, status, health, next_action, target_date, status_reviewed_at` |
| `checklists` | `title, description, status (open/done/archived), due_at, all_day, sort_order, assigned_to, assigned_to_assistant, persona_id, primary_project_id, is_routine, is_advanced, advanced_features, goal, purpose, store` |
| `checklist_items` | `checklist_id, title, description, is_done, completed_at, is_archived, sort_order, workflow_status_id, assigned_to, assigned_contact_id, assigned_to_assistant, persona_id, due_at, start_at, all_day, priority (low/medium/high), recurrence, next_due_at, last_completed_at, streak, skipped_at, blocked_reason, blocked_by_item_id, agent_claimed_at, origin_kind, origin_ref, cost numeric(14,2), quantity, store, weight_kg` |
| `checklist_sections` | `checklist_id, title, sort_order` |
| `checklist_folds` | `user_id, checklist_id, section_id` (null: the Done line) |
| `subtasks` | `parent_type, parent_id` (no foreign key; a trigger deletes them), `title, is_done, is_goal, sort_order, due_at, all_day, assigned_to, assigned_contact_id, assigned_to_assistant, persona_id, workflow_status_id` |
| `task_workflow_statuses` | four scopes in one table (task default, checklist default, per project, per checklist): `name, slug, color, bucket, sort_order, applies_to` |
| `project_item_statuses` | `(project_id, item_id) → workflow_status_id` |
| `task_project_checklist_members` | `project_id, checklist_id` (and the same for notes, conversations and reminders) |
| `checklist_item_reminders` | `item_id, remind_at` or `offset_minutes`, `channels[], alarm, fired_at, fired_for` |
| `checklist_reminders` | `checklist_id, remind_at, recurrence, time_zone, channels[], fired_at` |
| `work_activity_messages` | `item_id, author_user_id, role, content, images` |
| `checklist_shares`, `sharing_invites` | a list shared with someone by email |

Weak spots not to carry over: the four status scopes in one table, with the merge written twice (in SQL and in TypeScript); subtasks
without a foreign key (93% were once orphans); `task_project_members`, empty but still read for the projects' counts; statuses
backfilled five times; grocery columns in the generic list; share recipients who see a list but not its subtasks or statuses.

## 3. Life-only: port, replace or leave out

| Life | In Flow |
|---|---|
| Spaces, households, rooms, work/personal context | The store (every row carries `store_id`) |
| Moving a list between spaces | Left out (a store's lists stay in it) |
| Sharing a list by email, invites | The store's team and roles: the new permission area `projects` |
| Assigned to a person | A member of the store's team (`accounts.id`) |
| Assigned to a contact | A customer of the store, in step P4.7 |
| Assigned to the assistant, personas, `agent_claimed_at` | The AI manager working tasks, step P5.3 |
| Notes, AI conversations and reminder `life_items` linked to a project | Left out; a project links to Flow's own things instead (P6) |
| Category and tags (`taxonomy`) | The list's own labels, step P4.6 |
| Attachments (`media_files`) | The store's media library, step P4.5 |
| Grocery columns (`purpose`, `quantity`, `store`, `weight_kg`) | Left out |
| Live updates (Supabase realtime on `public`) | Flow's `commerce` schema is not exposed to the Data API, so not this way; a page shows a change on the next read, and step P4.10 weighs a light poll |
| Native alarms, push to the Life app | Flow's own push and email notices, step P4.3 |
| Calendar marks, the Today board, the routine wheel | Left out; Home's attention list counts what is due (P4.9) |
| `cost numeric(14,2)` | `cost_minor` and `cost_currency`, Flow's money (`src/lib/money.ts`) |
| `color` as a hex value | A palette key the admin's colour schemes draw (`docs/admin-style.md`): a signal for a status, a chart tone for a project |

## 4. Mapping to Flow

### 4.1 Where it lives

- **Feature** `projects` (D178): `FEATURE_IDS`, the `stores_features` check and `commerce.feature_needs()`; it needs nothing, so a
  website or a workspace (D748 E7) has it too. Off for new stores, switched on under Features.
- **Navigation:** a store section *Projects* (`src/lib/store-nav.ts`) with *Projects* and *Checklists* in Basic, and *Statuses* in
  Advanced. Pages under `/admin/{store}/projects/…` and `/admin/{store}/checklists/…`.
- **Permission area** `projects` (`src/lib/permission-keys.ts`): read and write, a working area, in a workspace too.
- **The platform** (`CLAUDE.md`, parity): Kaizena Flow's own team gets projects through its own store, as Deals (D464); the platform
  admin's own projects (`store_id is null`) are step P7, and `docs/platform-parity.md` gets the row.

### 4.2 Tables (`commerce` schema)

Every table carries `store_id`, has `unique (store_id, id)`, references its parents by `(store_id, id)`, has row-level security on
with no policy, and its rules are in the custom migration `projects_rules`.

| Table | Columns | From Life |
|---|---|---|
| `projects` | `name, description, colour, status, health, next_action, target_date, status_reviewed_at, sort_order, created_by` | `task_projects` |
| `project_statuses` | `project_id` (null: the store's default stages), `name, slug, colour, bucket, sort_order` | `task_workflow_statuses` (task default and per project) |
| `checklists` | `title, description, status, due_at, all_day, assigned_to, primary_project_id, is_routine, is_advanced, advanced_features, goal, sort_order, created_by` | `checklists` |
| `project_checklists` | `project_id, checklist_id, created_at` | `task_project_checklist_members` |
| `checklist_statuses` | `checklist_id` (null: the store's default statuses), `name, slug, colour, bucket, sort_order` | `task_workflow_statuses` (checklist default and per checklist) |
| `checklist_sections` | `checklist_id, title, sort_order` | `checklist_sections` |
| `checklist_items` | `checklist_id, title, description, done_at, archived_at, sort_order, status_id, assigned_to, due_at, start_at, all_day, priority, recurrence, next_due_at, last_completed_at, streak, skipped_at, blocked_reason, blocked_by_item_id, cost_minor, cost_currency, created_by` | `checklist_items` |
| `project_item_stages` | `(project_id, item_id) → status_id` | `project_item_statuses` |
| `checklist_subtasks` | `item_id` (a real foreign key, cascading), `title, done_at, is_goal, sort_order, due_at, all_day, assigned_to, status_id` | `subtasks` |
| `checklist_folds` | `checklist_id, account_id, section_id` (null: the Done line) | `checklist_folds` |

Later steps add `checklist_item_reminders` and `checklist_reminders` (P4.3), `checklist_item_comments` (P4.4), attachments (P4.5) and
labels (P4.6), each in its own migration.

Status tables split by what they are for: the four scopes of Life's one table become two tables of two scopes each, and the merge is
written once, in SQL (`commerce.checklist_effective_statuses()`), which the server reads.

### 4.3 Rules in the database (`projects_rules`)

- **Done and status agree.** A trigger on `checklist_items` and `checklist_subtasks`: ticking moves to the first done status,
  unticking to the first active one, a done status ticks; a new row without a status gets the list's default (first done if created
  ticked, else first active). Every writer (screens, the AI manager, the API) gets it.
- **A status belongs where it is used.** An item's or a subtask's status is the store's default or its own list's; a stage is the
  store's default stage or its own project's.
- **The home project is a member.** Linking a list to a project makes it the home when it has none; unlinking moves the home to
  another member or clears it, and deletes the list's items' stages in that project.
- A fold's section is its own list's; a blocking item is in the same store.
- Text lengths, buckets, statuses, priorities, colours, `jsonb` shapes and money as checks.

### 4.4 Server and screens

- Pure parts in `src/lib/projects*.ts`: the advanced fields (from `lib/checklists/advanced-features.ts`), recurrence (from
  `lib/checklists/recurrence.ts`), the timeline's arithmetic (from `lib/tasks/project-timeline.ts`), the default statuses.
- Server in `src/server/projects*.ts` (`server-only`): reads through `typedRows()`, writes naming `store_id`, inputs checked with
  zod, results `{ ok: true } | { ok: false, problems }`, actions through `storeAction()`.
- Screens on the admin kit (`src/components/admin/ui/`); the board follows the deal board (`deal-board.tsx`: dnd-kit, a keyboard
  *Move to*, refusals read out); sorting follows Work's tasks panel. Words in `src/lib/admin-messages/projects.{en,nb}.ts`.

## 5. Parity with Life, step by step

Status: Planned, Building, Done (date and commit).

### P1: the database

| Id | Step | Status |
|---|---|---|
| P1.1 | Tables of 4.2, rules of 4.3, `src/db/projects.test.ts`; the feature, the permission area and the store copy, export and personal-data registrations | Done, 26 Nov 2026 (e6afd15, bfba4d3) |

### P2: the server

| Id | Step | Status |
|---|---|---|
| P2.1 | Pure parts (advanced fields, defaults, dates in the store's zone, the operations) with tests; recurrence is P4.1's | Done, 26 Nov 2026 (e6afd15, bfba4d3) |
| P2.2 | Projects: create, edit, status and health, reorder, archive, delete; link and unlink lists, home project | Done, 26 Nov 2026 (e6afd15, bfba4d3) |
| P2.3 | Lists: create, edit, advanced fields, routine, goal, reorder, archive, done, reset (untick all), delete (duplicate is P4.2) | Done, 26 Nov 2026 (e6afd15, bfba4d3) |
| P2.4 | Items and sections: add, edit every field, tick, archive, delete, reorder with sections, move across lists, bulk status, delete and move | Done, 26 Nov 2026 (e6afd15, bfba4d3) |
| P2.5 | Subtasks: add, edit, tick, reorder, delete, promote to an item | Done, 26 Nov 2026 (e6afd15, bfba4d3) |
| P2.6 | Statuses and stages: defaults made in the store's language, per list and per project, reorder, buckets, colours, delete with a replacement | Done, 26 Nov 2026 (e6afd15, bfba4d3) |
| P2.7 | Integration tests (`src/server/projects*.int.test.ts`) | Done, 26 Nov 2026 (e6afd15, bfba4d3) |

### P3: the screens

| Id | Step | Status |
|---|---|---|
| P3.1 | Feature card, navigation section, permission area in the role editor | Done, 26 Nov 2026 (e6afd15, bfba4d3) |
| P3.2 | Checklists: the list of lists (open, done and archived, routines) | Done, 26 Nov 2026 (e6afd15, bfba4d3) |
| P3.3 | A list: items and sections in one dragged order, the Done line, folds, bulk actions, the item editor with the advanced fields, subtasks (filters are P4.11) | Done, 26 Nov 2026 (e6afd15, bfba4d3) |
| P3.4 | A list's settings: Advanced list and its fields, routine, goal, its statuses | Done, 26 Nov 2026 (e6afd15, bfba4d3) |
| P3.5 | Projects: the list with each project's status bar and health; a project's List and Board views; linked lists | Done, 26 Nov 2026 (e6afd15, bfba4d3) |
| P3.6 | A project's settings: details, status and health, stages | Done, 26 Nov 2026 (e6afd15, bfba4d3) |
| P3.7 | Statuses: the store's default statuses and stages | Done, 26 Nov 2026 (e6afd15, bfba4d3) |
| P3.8 | Signed-in e2e spec (`e2e/signed-in/projects.spec.ts`), screenshots to the owner | Done, 26 Nov 2026 (e6afd15) |

### P4: the rest of Life's richness

| Id | Step | Status |
|---|---|---|
| P4.1 | Recurrence and routines: the editor, completing moves to the next due time, streak, skip and undo; the job in the five-minute dispatcher | Done, 26 Nov 2026 (b7b673b) |
| P4.2 | Duplicate a list with its options (templates are P4.12) | Done, 26 Nov 2026 (50c0dbf) |
| P4.3 | Reminders: on an item (at a time or before its due time) and on a list (repeating), through Flow's push and email | Done 26 November 2026 (6835062; below) |
| P4.4 | Comments on an item (Life's activity thread) | Done, 26 Nov 2026 (a9d0ea8) |
| P4.5 | Attachments from the media library | Planned |
| P4.6 | Category and tags (Life's taxonomy) | Done, 26 Nov 2026 (a9d0ea8) |
| P4.7 | A customer on an item (Life's contacts) | Planned |
| P4.8 | Every task across lists (Life's *All items*, with P4.11's filters); a list's cost summary; its due countdown (calendar and timeline are P4.13) | Done, 26 Nov 2026 (87d9db8) |
| P4.9 | What is due on Home's attention list | Done, 26 Nov 2026 (a190512) |
| P4.10 | A light refresh while a list is open, for a team working together | Done, 26 Nov 2026 (9fbb82c) |
| P4.11 | Filters on a list (Life's `checklist-item-filter.tsx`): by status, person, priority and due; across lists with P4.8 | Done, 26 Nov 2026 (50c0dbf) |
| P4.12 | Templates: a list kept as a template and offered when a list is made (a won deal's project, P6.3, starts from one) | Done, 26 Nov 2026 (7fd75cc) |
| P4.13 | Calendar and Timeline views of a project (its tasks by due day; start to due as bars) | Done, 26 Nov 2026 (ab702af) |

### P5: the AI manager and events

| Id | Step | Status |
|---|---|---|
| P5.1 | Life's project and checklist tools as AI manager tools (listed below), held for the eval as `.claude/rules/ai-prompts.md` says | Planned |
| P5.2 | Events in `commerce.events` (project created, status changed; list created, archived; item done, assigned), workflow triggers and webhook topics | Planned |
| P5.3 | Tasks the AI manager works on (Life: assigned to the assistant) | Planned |

Life's tools for P5.1: `list_projects`, `create_project`, `update_project`, `set_project_status`, `review_project`,
`link_checklist_to_project`, `delete_project`, `add_task_to_project`, `list_checklists`, `get_checklist`, `create_checklist`,
`update_checklist`, `archive_checklist`, `delete_checklist`, `add_checklist_item`, `update_checklist_item`, `toggle_checklist_item`,
`delete_checklist_item`, `move_checklist_item`, `add_checklist_separator`, `update_checklist_separator`, `organize_checklist`,
`complete_subtask`.

### P6: joins with the rest of Flow

| Id | Step | Status |
|---|---|---|
| P6.1 | Work's tasks become checklist items: an assignment has its list; time entries and timers point at items | Replaced 26 November 2026 by P8.3d: Work stands alone (D904), so its tasks stay its own; a list sends its time to an assignment and its tasks log time there |
| P6.2 | CRM tasks (`activities` of kind `task`): weighed against items linked to a customer | Planned |
| P6.3 | A won deal starts a project from a template | Done 26 November 2026 as P8.3b (3d7ee2c) |
| P6.4 | Kaizen Life shows the projects of a linked account (the door of D511) | Planned |

### P7: the platform

| Id | Step | Status |
|---|---|---|
| P7.1 | The platform admin's own projects, and the row in `docs/platform-parity.md` | Done 26 November 2026 (43e4e7d; below: in Kaizena Flow's store, not `store_id is null`) |

### P8: an extension that stands alone (D904)

| Id | Step | Status |
|---|---|---|
| P8.1 | The extension `projects` in the catalogue (its id, its row, the owner's price, its trial, bundles and plans), its gates on `/projects` and `/checklists` (`EXTENSION_PATHS`), the store feature `projects` under it; stores already using it get the trial D748 gives existing accounts | Done 26 November 2026 (bc2c881, 073eb4b; below) |
| P8.2 | Standalone: an account with only Projects uses it in its workspace (no store), with its landing page on kaizenaflow.com (a draft) and its place in the combined sign-up | Done 26 November 2026 (below) |
| P8.3 | The octopus' pairs, each lit only when both arms are there: Deals (a won deal starts a project from a template, P6.3), Work (time and assignments on tasks, P6.1), Support desk (a conversation becomes a task), the shop (an order, a return or a review makes a task), Email automation (a task's people told when it is theirs), the AI manager (P5) | Done 26 November 2026 in the steps below; the workflow and webhook pair is P5.2 |
| P8.3a | **The shop and the support desk:** *Make a task* from an order, a return, a review or a support conversation; the task links back, and an order's and a return's page show their tasks | Done 26 November 2026 (2a9f9d4; below) |
| P8.3b | **Deals:** a won deal starts a project (its lists from templates if chosen); the deal and the project name each other | Done 26 November 2026 (3d7ee2c; below) |
| P8.3c | **The AI manager:** its Projects tools (P5's first part): read what is open and due, add and tick tasks, each only while the store has Projects | Done 26 November 2026 (4b57e25; below) |
| P8.3d | **Work:** a list's time goes to a Work assignment, and its tasks log time there (P6.1's pair); **a task's person told by email** when someone else gives it to them | Done 26 November 2026 (e79c547; below) |

## 6. Tests

- `src/db/projects.test.ts` (PGlite, every migration): each rule of 4.3, each check, the composite keys refusing another store's rows.
- `src/lib/projects*.test.ts`: the pure parts, with Life's cases (`lib/checklists/*`, the smoke checks named in `scripts/smoke.ts`
  that cover this system, about 68).
- `src/server/projects*.int.test.ts`: the server against Postgres.
- `e2e/signed-in/projects.spec.ts`: a list made, items ticked, a status chosen, a project's board dragged and moved by keyboard.

## As built: steps P1 to P3 (26 November 2026)

- **Where.** The feature `projects` (group *Working together* on the Features page, off for a new store, needing nothing), a store menu
  section *Projects* with *Projects*, *Checklists* (Basic) and *Statuses*, and the permission area `projects` (an admin with the default set
  has it; a custom role gets it from its owner). Pages: `/projects`, `/projects/{id}` (List and Board), `/projects/{id}/settings`,
  `/projects/statuses`, `/checklists`, `/checklists/{id}`, `/checklists/{id}/settings`.
- **Server.** `src/server/projects.ts` (projects, membership, stages, the team), `projects-lists.ts`, `projects-items.ts`,
  `projects-statuses.ts`; every change of a screen is one typed operation (`src/lib/projects-ops.ts`) run by `runProjectsOp()` through the
  area's one action (`projectsAction`), plus the forms that make a project or a list and save their details.
- **Differs from Life, on purpose.**
  - A list's or a project's own statuses *replace* the store's (Life merged them by name, so a list could not drop one); *Statuses of its
    own* copies the store's to start from and moves the tasks along, *Use the store's statuses* moves them back by name.
  - The store starts with *To do*, *In progress*, *Done*, *Archived* (Life: Backlog, To do, Done, Archived), made in the person's language.
  - On a board a ticked task without a stage of its own is in the first done stage (Life: always the first stage).
  - Ticking a task already in a finished status keeps it there, so a status moved to the done bucket ticks its tasks without moving them.
  - A subtask is a plain step until it is given a status (Life's subtasks start without one); then its tick and status agree as a task's.
  - The rules live in the database (`projects_rules`), so the AI manager and the API get them as the screens do.
- **Elsewhere.** `permissionsOf()` read the areas from a list of its own and now from `AREAS`; the Read-only role template reads projects (an owner
  grants them to other roles); a section whose one sidebar group is named as it sends no heading (the sidebar names it by
  the tab), which makes room in the menu's budget; Statuses is reached from Projects, not the menu.
- **Tests.** `src/db/projects.test.ts` (20, the rules), `src/lib/projects*.test.ts` (the pure parts), `src/server/projects.int.test.ts` (13,
  the server against Postgres), `e2e/signed-in/projects.spec.ts`.

## As built: step P4.1, repeating tasks (26 November 2026)

- **The rule.** Kept on the task as `recurrence` in Life's shape (`src/lib/projects-recurrence.ts`): every day, on weekdays, every so many
  days, or on days of the month every so many months, at one or more times of the day, read in the store's zone. The 31st is a shorter
  month's last day. An every-so-many rule counts from the day it is set (`anchor`, kept while its kind stays the same).
- **The editor.** *Repeats* (an Advanced list's field, switched off like the others): Homer chooses how often; the weekdays, the days of the
  month, the gaps and the times of the day (morning, midday, evening; none is 09:00) are one look further. A rule is sent only when it
  changed, since a task given a rule is open again.
- **The row.** How often, the run (*3 in a row*), when a ticked task is back, *Skipped*; *Skip* on an open repeating task, and an *Undo* for
  a moment after its tick or skip, which puts back what the tick changed (the run and the next time cannot be worked out afterwards).
- **Coming back.** `src/server/projects-repeat.ts`: a task whose next time has passed is open again at the time after, its subtasks
  unticked; a task ticked in time keeps its run, one not ticked loses it, and a skip is forgotten with its time. A list's page rolls its
  tasks before drawing them, and the dispatcher's `repeats` does every store's within five minutes; each write repeats the condition, so the
  second finds nothing and a late write never unticks a task ticked in between.
- **Differs from Life.** Saving a task's other fields never unticks it (Life's form unticked a task whenever it carried the repeat, which
  it always did); skipping an open task keeps its next time (it is already the next); a rollover clears the skip.

## As built: steps P4.2 and P4.11 (26 November 2026)

- **Duplicate** (More, on a list): the copy is named first, its name filled in as *{title} (copy)* and chosen, so Enter makes it; the page
  moves to the copy (`duplicateChecklist()`). It brings the list's settings, own statuses, projects and home, sections, and its open and done
  tasks with their notes, people, priorities, costs, a blocker inside the list (pointed at its copy) and subtasks, every task open in the
  list's first status and no run. Due dates, repeats and archived tasks stay behind, as in Life. One transaction; each task's new id is
  chosen before the insert so blockers and subtasks find their copies.
- **Filters** (*Filter*, beside *Select*, for anyone who can read the list): a group for each field the list uses (status, who does it,
  priority, due: late, today, this week, no date), offering only the values its tasks have, each with its count over the whole list
  (`src/lib/projects-filter.ts`). Within a group any value matches, across groups every one must. While filtering, a section shows only when
  a task under it matches, dragging rests, and the line says *Showing 3 of 12 tasks*. Kept on the page only, not in the address.

## As built: steps P4.6 and P4.4 (26 November 2026)

- **Labels.** The store's categories (a task has one) and tags (several), each with a colour and an order, made on the Statuses page with
  the statuses' editor (`project_labels`; a task's category is `checklist_items.category_id`, its tags `checklist_item_tags`). The rules
  migration `projects_labels_rules` holds a category to its kind and a tag to its, never lets a label change kind, and takes a deleted label
  off its tasks. An Advanced list's Category and Tags fields put them in the editor and on the row, and the filters gain both groups. A
  duplicated list carries its tasks' category and tags, as Life's did.
- **Comments.** A thread under every task, in its editor (Life's activity thread, `checklist_item_comments`): who wrote it and when, the
  writer edits or deletes their own, and the row counts them. Read with the list; shown as text. Not in the whole-store file (people's own
  words), not copied with a store, and classed as staff's own in the personal-data register.

## As built: step P4.8 (26 November 2026)

- **All tasks** (Checklists, beside *Lists*): every open task of the store's open lists, routines apart, the soonest due first, at most
  1,000 (`openTasks()`); each names its list (a link), shows the fields its own list uses, is ticked off there, and is filtered by who does it,
  priority, due, category and tags (a status is each list's own, so not across lists). A list's row and this view draw their fields with one
  function (`task-facts.tsx`).
- **Costs**: an Advanced list with Cost on shows its total, what is done and what is left, a line a currency; an unpriced task is unknown,
  not free, and is left out (`costSummary()`).
- **Countdown**: an open list with a due date says how long is left ("3d, 4h left") or how late it is, in the danger colour, to the end of
  a due day in the store's zone, kept true every half minute while the page is open (`dueTarget()`, `countdown()`, units in the person's
  language).

## As built: step P4.9 (26 November 2026)

- **Home's attention**: checklist tasks late or due today are a queue of the one attention source (`taskRead()` in
  `src/server/attention.ts`, kinds `tasks_overdue` and `tasks_today`), so the store's Home, the owner's Home across stores and the morning
  briefing say the same. A member's own and nobody's (a one-person store assigns nobody), the team's in the briefing; only while Projects
  is on and for who may read projects, and only lists that show due dates. The item opens All tasks. One CTE more in the queues' one
  statement.

## As built: step P4.12 (26 November 2026)

- **Templates**: a list's settings switch *Template* (`checklists.as_template`); a template is listed apart under Templates, has no tasks to
  do (All tasks and Home's attention leave it out), and is offered as *Start from* when a list is made, on Checklists and in a project. The
  new list is the template's copy (`duplicateChecklist()`, all open, not a template), in the project chosen.

## As built: step P4.13 (26 November 2026)

- **Calendar** (a project's views: List, Board, Calendar, Timeline): the month in whole weeks, Monday first, each task on its due day in the
  store's zone, late ones in the danger colour, done ones struck through, each a link to its list; *Earlier* and *Later* move a month (the
  month is in the address). **Timeline**: a bar from each task's start (or its due day) to its due day in its stage's colour, cut to the
  month, the earliest first. Both drawn on the server (`project-calendar.tsx`, `monthWeeks()`, `timelineBar()`), no browser script and no
  class the stylesheet lacked.

## As built: step P4.10 (26 November 2026)

- **Light refresh**: a list's page asks every twenty seconds, while it is shown, for the list's fingerprint (`listFingerprint()`: how many
  tasks, sections, subtasks and comments it has and when each last changed, one statement) through `listStatusAction`, and is drawn again
  only when it changed (`RefreshWhile`, as the scans' pages do). A hidden tab asks nothing and looks once when shown again. What a person is
  typing or has open stays, since a redraw keeps the page's own state.

## As built: step P8.1, Projects as a paid extension (26 November 2026)

- **The catalogue** (migrations `20261126064631_projects_extension_id` and `20261126064730_projects_extension`, the owner's answers): the
  extension `projects`, standalone, one size *5 people* (`{"people": 5}`) at €25 a month and €19 founding (NOK ×10, a year ten months),
  €4 a person beyond (NOK 40), in the *Everything* bundle at its price, and included in Grow, Advanced and Plus at that size. Every number
  is the platform admin's at Platform → Plans → Extensions.
- **The gates.** `EXTENSION_PATHS.projects` is `projects` and `checklists`: every page there draws `requireExtension(member, "projects")`
  before the feature's gate (the extension's marker with its trial for an account without it), every action passes `extension: "projects"`
  to `storeAction()` (refused while the account lacks it or it is read-only), and the store menu and the admin map carry the tag.
  `projectsOn(store)` (`src/lib/extensions.ts`) is the feature and the extension together, asked by Home's queue of tasks due
  (`attention.ts`, `control-center.ts`). The five-minute job rolls repeating tasks on only where `commerce.extension_on()` says so; a
  read-only list rolls on when its page is read.
- **People.** `peopleOf(organisation, "projects")` counts each person once who may change projects (`projects:write`) in a store with
  Projects on; a read-only member is free. `EXTRA_UNIT_OF.projects` is `person`, so use beyond five is billed as Work's and Deals' is.
- **Existing accounts.** Extensions launched on 19 November, so the migration gives an account already using Projects (a checklist, or the
  feature on, in a counted store) whose plan does not include it the launch's 60-day trial with its 14-day grace; on 26 November no store
  in production used it, so none was written. The launch's evidence (`extension-launch.ts`) counts a checklist too.
- **Its workspace.** A workspace starts with the store feature `projects` on beside `sales` (`commerce.make_workspace()`, and the one
  workspace in production was given it), and its Home has a Projects card opening `/projects` (`WORKSPACE_STARTS`), so an account with
  only Projects works in it. Its landing page and its place in the combined sign-up are P8.2.
- **The AI round** rose by 22 characters: the extension tools' id lists name `projects`.
- **Every screen's words.** Each extension's line on its marker moved out of the shared words (`common.extensions.pitch`) into the server
  area `extensionPitch`, which `requireExtension()` hands to `ExtensionOffPanel`: every admin screen carries about 600 bytes less in each
  language, more than Projects' own line added (the Norwegian platform home had gone over its allowance in `admin-handed.baseline.json`).
- **In production** (run 1991, 073eb4b): both migrations applied; the catalogue holds `projects` (standalone, position 6) with its four
  prices and founding prices, €4 and NOK 40 a person beyond, the Everything bundle and the grants to Grow, Advanced and Plus; the one
  workspace has `projects` and `sales`; no trial was written (no account used it). The advisors list only the INFO kinds every commerce
  table has (RLS on with no policy, indexes not used yet): nothing for `docs/audits/psi-followups.md`.

## As built: step P8.2, Projects on its own (26 November 2026)

- **Its workspace** came with P8.1: a workspace starts with the store feature `projects` on, and its Home has a Projects card.
- **The sign-up and Add to your account** read the catalogue's `standalone`, so both offer Projects with nothing changed: the sign-up for
  extensions (`/sign-up/extensions?with=projects`) ticks it, at €25 a month, and the Everything bundle names it.
- **Its page**: `/projects` on kaizenaflow.com, made by `docs/site-pages/standalone-products.test.ts` (`PROJECTS`) from `docs/site-design.md`
  in the other product pages' shape, saved as a draft of Kaizena Flow's own store for the owner to publish (row
  `fa016e02-6bf6-463d-b3f0-47ed756411c1`, `docs/site-pages/README.md`). Only what is built is claimed.

## As built: step P8.3a, tasks from the shop and the support desk (26 November 2026)

- **The link.** A task has at most one source (`checklist_items.order_id`, `return_id`, `review_id`, `conversation_id`, the check
  `checklist_items_one_source`): its store's order, return or review by their composite keys, a conversation by its id with the trigger
  `checklist_items_conversation_store` holding it to the task's store (migrations `20261126110413_checklist_item_sources` and
  `20261126110415_checklist_item_sources_rules`). Each is cleared when what it points at goes; the task stays. A copied list does not carry
  its tasks' sources.
- **Making one.** `item.addFrom` (`addSourceTask()`, `src/server/projects-sources.ts`): a title and a list, or none, which files it in the
  store's open list named *Follow-ups* in the person's words (`projectSources.followUps`), made the first time.
- **Where.** An order's and a return's page draw the card `SourceTasks` (their tasks, ticked there, each linking its list, and *Make a
  task* with the title written and the list to choose); a review in the reviews list and a conversation in the inbox have `QuickTask`
  (one field, to Follow-ups). Each only while the store has Projects (`projectsOn()`) and the person may read or change it; the inbox's only
  at a store's own desk.
- **Back.** A list's page links each task to its source (`sourceLinks()`): *Order 1042*, *Return 12*, *Review by Kari*, *Conversation with
  Kari*, only while the source's arm is there (reviews on; the support desk in the account) and the person may open its page.
- **Words.** The card's in the server area `projectSources` (handed to it by the page, so no screen carries them otherwise); the links'
  in `projects.sources`.

## As built: step P8.3b, a project from a won deal (26 November 2026)

- **The link** is Projects': `projects.deal_id` (migrations `20261126113521_project_deal` and `20261126113524_project_deal_rules`, the
  store's own deal by its composite key, cleared when the deal is deleted while the project stays), so Deals' tables know nothing of
  Projects and either arm can go without leaving the other broken.
- **Starting one.** A deal's page has a *Projects* card while the store has Projects (`DealProjects`): the projects the deal started, each a
  link, and once the deal is won *Start a project*: named after the deal and linked to it, empty or with a copy of a list marked as a
  template, at home in the new project (`project.fromDeal`, `startDealProject()` in `src/server/projects-deals.ts`; the right to change
  projects and to read customers).
- **Back.** A project's page names the deal it came from, a link, while Deals are on and the person may read customers.

## As built: step P8.3c, the AI manager's Projects tools (26 November 2026)

- **Three tools** (`src/server/projects-tools.ts`, their inputs in `src/lib/owner-tools.ts`), offered only while the store has the Projects extension
  and its feature (`TOOL_EXTENSIONS`, `TOOL_FEATURES`): `projects_overview` reads the open projects, the open lists and the open tasks with a
  due day the soonest first, late ones marked, the team's or the person's own (`projects:read`); `add_task` adds a task to a list named by
  its title or id, or to Follow-ups (made the first time), and `tick_task` ticks one off by its id or title, listing them when several share
  it (`projects:write`, no gate: they change only the store's own lists and nobody is told).
- **What reaches the model.** Task and list titles are the team's own words. The titles *Make a task* writes in advance carry only a number
  the system made (*Follow up order 1042*), never a name a customer typed, since task titles reach the manager.
- **The eval.** New tools change `toolsVersion()`: the agents' eval is recorded again on Platform → AI and its recording committed (D391);
  until then the replay warns (D793). The AI round rose by 30 characters (`load_tools` names them).

**In production (26 November 2026).** P8.3a and P8.3b came out together after another session's red run (the admin's `/pages` scripts,
fixed in d03d5b0): both migrations applied (the four task sources, their keys and the conversation's trigger; `projects.deal_id` and its
key). The advisors list only INFO: the new link indexes are not used yet; no new unindexed key, nothing for `docs/audits/psi-followups.md`.
P8.3c needed no migration. Left of P8.3: **P8.3d** (Work's time on tasks with P6.1, a task's person told by email with P4.3's reminders),
and the agents' eval recorded again on Platform → AI for the three new tools.

## As built: step P7.1, Kaizena Flow's own projects (26 November 2026)

- **Where they live.** In Kaizena Flow's own store (`kaizenaflow`), as its customers and deals do (D466's route, D467), not as rows with
  no store: every Projects table holds its rules by `(store_id, id)` keys, which hold nothing for a row with no store, and the store
  already has every extension (the platform's account) and every pair (its deals, its support desk, the AI manager).
- **The way in.** The platform admin's Settings → *Running the platform* → *Projects* (`/admin/platform/projects`) opens that store's
  Projects for someone on its team; anyone else is told its owner adds them under Team. The store's own page offers to switch the feature on
  when it is off. The row in `docs/platform-parity.md` is ticked.

## As built: step P8.3d, Work's pair and a task's person told (26 November 2026)

- **A list's time goes to a Work assignment.** A list's settings show *Client work* while the store has Work and the person may see it
  (Work's right, `settings:read`): one of Work's assignments, by client, or none (`checklists.assignment_id`, the store's own, cleared when
  the assignment is deleted; `list.assignment`, `setListAssignment()` in `src/server/projects-work.ts`). The list's page names the client and
  the assignment, a link to Work's page for it, and the time logged from its tasks.
- **Time on a task.** A task of such a list shows its time, and *Log time* for someone who may log time in Work (`settings:write`): the time
  as Work's own form reads it (1:30, 1h 30m, 90) and the day, today in the store unless changed. It goes in through Work's `logTime()`, so
  Work's rules hold (1 minute to 24 hours, no day to come, billable, on the assignment's draft invoice like any entry), noted with the task's
  title; Projects keeps the link (`checklist_item_time`, one task an entry, gone with either). A row shows a task's time beside its facts.
- **Work's side.** An assignment's page lists the checklists whose time goes to it, with their open tasks, while the store has Projects and
  the person may read it (`listsOfAssignment()`). Work's tables hold nothing of Projects: switching either off leaves the other whole.
- **A task's person told.** Giving a task its person marks who gave it and when (`assigned_by`, `assigned_at`; a save to the same person
  marks nothing). The five-minute dispatcher's `projectsAssigned` job (`src/server/projects-notices.ts`) claims each marked task two minutes
  later, so a person chosen by mistake and changed at once is never told, and emails its person once, one email a run for all their new tasks
  in a store, in their own admin language: each task's title and list and who gave it, and a link to the list (or to every task for several).
  Nobody is told of a task they took themselves, a task done or archived, one a day old, or in a store without Projects; the person must still
  be on the team with the right to read projects (`staff.task_assigned`, a staff email).
- **Why not Email automation.** The email is to the store's own team, not to its customers, so it is part of Projects rather than a pair
  with Email automation (which writes to customers): a team's tasks need their people told whatever else the account has. P4.3's reminders
  (a time before a task is due) stay their own step.

## As built: step P4.3, reminders (26 November 2026)

- **One table for both.** Life's item and list reminders are one table here, `checklist_reminders`: on a task (at a moment, or so many
  minutes before its due time) or on a list (at a moment, or repeating by a repeating task's rule, P4.1), each sent by email, as a
  notification on the person's devices, or both. A task or a list has at most five. `next_at` is when one comes next: the rules migration
  arms a reminder before a due time from the task's due time, again whenever that moves (sent before or not), and clears it when the task
  has none; a whole-day task's due time is noon, so its reminders count from noon. Moments and rules are armed by `addReminder()`
  (`src/server/projects-reminders.ts`); a repeating one starts no earlier than the day chosen.
- **Where.** A task's editor has *Reminders*: when it is due, 15 minutes, an hour or a day before (offered once the task has a due date),
  or at a day and time; *Send by* email and notification, both ticked. A list's Customise has *Reminders*: a day, a time and *Once*, *Every
  day*, *Every week* or *Every month* from then. A task with a reminder shows a bell on its row.
- **Who and how.** The dispatcher's `projectsReminders` job (`runTaskReminders()` in `src/server/projects-notices.ts`) claims each reminder
  whose time has come, moves a repeating one of an open list to its rule's next time in the store's zone, and tells the task's or the list's
  person, or whoever set it when there is none: an email in their admin language (`staff.task_reminder`: the task and its list and when it
  is due, or how many tasks the list has open) and a notification (`sendProjectsPush()`), each once. A reminder of a task done or archived,
  of a list not open, a day late, or for someone who may no longer read projects, is passed over. Its words are Projects' own
  (`project-sources` area), so the screens that load the staff emails' words carry none of them.

**In production (26 November 2026).** P8.3d (e79c547) and P4.3 (6835062) are deployed and their migrations applied: Work's link and
the task-time join, who gave a task its person, and the reminders table with its two triggers. The advisors list only INFO for them (no
policy on a table with RLS, as every `commerce` table; new indexes not used yet), nothing for `docs/audits/psi-followups.md`.

