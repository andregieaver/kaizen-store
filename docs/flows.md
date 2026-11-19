# Flows: one engine of triggers, steps and goals (D767)

Email plan M2.1 to M2.3 with M3.1 to M3.3 (`docs/audits/email-marketing-2026-11.md`). Today a store has fixed automation kinds (D298,
D653, D691), each finding who is due with its own SQL, and Workflows (D356), store-level rules with no per-person place. A flow is
both: a trigger, a tree of steps a person moves along, and goals that end it early.

## The model

- **A flow** (`commerce.flows`): a store's, or Kaizena Flow's own with no store; a name, a trigger, its steps as a tree, its goals,
  `enabled`, `version` and `tested_version`. Saved off; switched on only after a test of the version saved, as workflows are.
- **Its trigger**: an event of the log (`commerce.events`, D718), for a slice 1 start `subscriber.subscribed`, `order.paid` and
  `checkout.abandoned`; slice 4 adds the rest of M2.3 and dates on the person.
- **Its steps**, a tree, each with an id:
  - `email`: words per language, as a broadcast's (`BroadcastContent`), sent through the marketing email path, the sending guard
    (D730), the contact policy (D764), the plan's room and quiet hours.
  - `wait`: a number of hours or days.
  - `if`: a condition on who the person is or what they did (has ordered since they entered, is in a segment, clicked an email of
    this flow), with a `then` branch and an `else` branch.
  - `end`.
  - Later slices: `text` (M2.7), `wait until` an event or a time, `split` (M2.5), store actions (a tag, a task), each as one more kind.
- **Its goals**: a person who meets one (an order placed, by default) leaves the flow at once, counted as a goal reached.
- **A person's place** (`commerce.flow_runs`): one row per person per entry, with the flow's version, the step they are at, when they
  wake, and how they left. Every email is keyed `flow:{run}:{step}`, so a step is never sent twice. Personal data, by the subscriber:
  exported, erased with the person, kept 90 days after it ends.

## How it runs

- **Entering**: a reader of the event log (`readEventsAfter("flows", …)`, D718's cursor) finds the events that are a switched-on flow's
  trigger and makes a run for the person the event names, once per person per flow while one is running.
- **Moving on**: the every-minute marketing job takes the runs due (`wake_at <= now`), and `advance()` (pure) walks the tree from the
  step it is at: it sends an email, sets the next wake for a wait, takes a branch, or ends. A goal is checked before every step.
- **The version**: a run follows the version it entered on; a saved change makes a new version, and runs in flight finish the old one.

## Slices

1. **The engine core.** The tree, `checkFlow()` and `advance()` pure and tested; the two tables; entering from the log and moving on in
   the every-minute job; a test that walks the newest person through the flow and sends nothing. No screen yet, beyond a store's flows
   listed for the platform's own check.
2. **The story** (M3.3), built in parts. *Part a, 18 November 2026:* `/admin/{store}/flows` lists the flows and starts the welcome series
   (`welcomeSeries()`, `src/lib/flow-recipes.ts`); a flow's page reads it as sentences (`storyLines()`, `src/lib/flow-story.ts`) with each
   email drawn as its subject and first words, Test and Switch on. *Part b, the same day:* under each email, Change edits its subject and
   words in its first language and the days of the wait before it (`withEmailWords()`, `withWaitDays()`), each save a new version switched
   off until tested again. *Part c, the same day:* Customise opens the canvas (`canvas.tsx`): every step as a tree, a step of any kind
   added after another or first in a branch, one removed (an `if` with both branches, said on its button), an `if`'s condition chosen
   (`insertStep()`, `removeStep()`, `withCondition()`). *Part d, 19 November:* under Change, every language of the store side by side,
   each saved on its own, and each email names the languages not yet written (their readers get the store's first language, `languageFor()`). Slice 2 is done.
   The whole of it: a flow read as sentences, the emails as pictures (*When someone joins, the same day: Welcome. Three days
   later, if they have not ordered: our best sellers*); *Customise* opens the canvas. One model, so a change in either shows in both.
3. **Recipes** (M2.2, M3.1): today's automations as flows on the engine, their tests carried over, and the front page that starts
   from a goal. *Part a, 19 November:* the flows page starts from a goal (`RECIPES`, `src/lib/flow-recipes.ts`: welcome, after a
   purchase), one Start each; a recipe names the automation it does the work of (`flows.replaces`), switching the flow on switches that
   automation off in the same transaction, and the automation is refused while the flow is on, so nobody gets both. Kaizena Flow's own
   flows replace nothing: its automations are a store's. *Part b:* a goal whose automation the owner already wrote starts from their own
   words, days and follow-ups (`flowFromAutomation()`). Cart reminders stay their own (D33): they reach shoppers not on the list, on
   checkout's notice, with their own cart; flows reach only the list. *Next:* win-back and the picked kinds (cross-sell, restock, browse),
   which need date triggers and product picks (slice 4's triggers).
4. **Triggers from the whole system** (M2.3), texts in flows (M2.7) and store actions. *Part a, 19 November:* the first date trigger,
   `customer.lapsed` (`DATE_TRIGGERS`): a person on the list whose latest paid order is the flow's days old (30 to 730, `trigger_days`)
   with nothing paid since, entered once per such order (`lapse:{order}`) by `enterLapsed()`, one statement on each tick while a flow is
   on, counting only lapses since the flow was switched on (`enabled_at`) and at most three days back. The goal Bring back customers
   (`winBack()`, replacing the win-back automation, or from its own words) and its days changed under the story's first sentence.
