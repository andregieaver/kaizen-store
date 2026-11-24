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
   off until tested again. *Part c, the same day:* Customise opens the canvas (now drawn and dragged, below): every step, a step of any kind
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
   *Part b:* six more events start a flow (`EVENT_TRIGGERS`: an order sent, a subscription started or ended, a form sent, a quote asked
   for, a signed-in customer's review), the person found by the address their subject is about (`emailOfSubject()`); Customise says what
   starts a flow and changes it with one press (a new trigger stops replacing an automation), and Your own flow starts from one email.
   *Part c:* an email may carry products picked for each reader by code (`picks`: bought together, buy again, looked at; `picksFor()`,
   D653, D691), from their latest paid order; with none to show it is not sent and the run goes on. Customise sets it per email; the goals
   Sell more to buyers and Remind them to buy again (`crossSell()`, `restock()`) replace those automations. Texts (M2.7) wait for 46elks.
   *Part d:* the date trigger `customer.browsed` (1 to 5 days after a signed-in subscriber's latest product view, nothing paid since,
   once per day viewed; `enterBrowsed()`) and the goal Remind them what they looked at (`browseReminder()`, replacing the browse
   automation). Views are kept while the browse automation or such a flow is on (`BROWSE_ON`), and go when the last is off (D691).
   *Part e, 23 November 2026:* two more steps. *Wait until* holds a person until they order or press a link in the flow's emails since
   entering, or until its days pass (`until`, its deadline on the run in `flow_runs.wait_ends_at`, looked at again each hour); the story
   says it on the emails after it (*once they order, or 3 days later*). *Tag them*, the first store action, puts the store's tag on the
   address as a sign-up form's tags are (`tagFromForm()`), for segments. Both set from the canvas with the actions it had, so they add no
   server reference. M2.1 is done but texts, which wait for 46elks (M2.7).
   *Part f, 24 November 2026:* seven more events start a flow: an order refunded, a return asked for, a support conversation ended or
   rated, a deal made or won, a contract signed. The person is the order's buyer, the conversation's contact (or its customer) and the
   deal's or contract's customer (`emailOfSubject()`). The canvas names a trigger by its story sentence (`triggerLabel()`), so each
   trigger has one wording per language.
   *Part g, the same day:* a birthday starts a flow (`customer.birthday`, `DAY_TRIGGERS`): a person on the list whose customer gave a
   birthday (D401) at least 30 days before, as the birthday credit, enters on that day in the store's time zone, once a year
   (`enterBirthdays()`).
   *Part h, the same day (D887):* a person entering one of the store's saved segments starts a flow (`segment.entered`,
   `trigger_segment_id`). The segment is read once an hour per switched-on flow (`enterSegments()`) and who it held is kept
   (`flow_segment_members`): a newcomer starts the flow, one who left is forgotten, and the first read after switching on only notes who is
   in. Customise chooses the segment; the story names it.
   *Part i, the same day:* a flow may run on the owner's calendar (`schedule`): everyone on the list, or the people of a segment, starts it
   at a time typed on the store's clock (`schedule_at`), once or every 7, 14 or 30 days (`enterScheduled()`); a time missed by more than a
   day (the flow was off) is skipped, never sent late. The story says when and to whom (*Every 7 days from 1 Dec, 09:00, to everyone on
   your list*).
   *Part k, the same day:* a tag starts a flow (`tag.added`, `trigger_tag`): a person on the list given the flow's tag after it was switched
   on (`enterTagged()`, by the tags' (store, key) index, at most three days back), once per time given. The AI manager's `create_flow`
   does not set one yet (its tools stay as the eval recorded them). An app's own events start a flow too (`custom.event`, `trigger_event`): the store's app
   sends one with the Admin API's `POST /events` (a name and a subscriber's address, kept in the log as `custom.{name}` with the
   subscriber's id), and a flow naming it starts for them; the flows' log reader asks for the names switched-on flows wait for.
   *Part j, the same day (M3.1):* the goal Get reviews (`reviews()`): two weeks after an order is sent, each buyer is shown what they bought
   (picks `bought`, the order's products still on sale, each linking to its page) and asked for a review. No automation did it, so it is a
   flow-only goal (`FLOW_ONLY_GOALS`, kept in `replaces`), and a store has it once. The goal Nurture business leads (`nurtureLeads()`) is
   the second: when someone on the list sends a form, two days later how the store helps businesses, a week later one more, ended by an order. And
   Customise writes the whole flow in the store's voice with one press (*Write every email in your voice with AI*): each email from its own
   words, in the store's first language, through the broadcast writer (D330's voice, its claims checked), saved as one version, off until
   tested.
5. **A flow from a sentence** (M3.2, 24 November 2026). The AI manager's `create_flow` takes the owner's sentence as the model's draft (what
   starts it, its emails, each its days after the one before and for whom), and code builds the steps (`draftSteps()`,
   `src/lib/flow-draft.ts`), checks every word for claims and the brand's words to avoid, finds the segment and the time on the store's
   clock, and saves it off and untested; it answers with the story, who it would reach and the contact policy that holds it. `change_flow`
   changes one by its name as a new version. Both are held out of the manager (`HELD_FOR_EVAL`) until the agents' eval is run with them.

## The canvas (19 November 2026, the owner's ask: "a drag and drop canvas, as ActiveCampaign has")

Customise draws the flow as a chart (`flow-board.tsx`, `@dnd-kit`): the trigger's card at the top, each step a card joined by a line,
an `if` opening into its Yes and No columns. A card is dragged onto a place between cards, into a branch or above the first step
(`moveStep()`, never into its own branch), a kind is dragged from the palette onto a place (or added by a place's + from the keyboard),
and a card pressed opens its settings beside the chart (picks, days, condition, what starts it, Remove); an email's opens as it
reads, its subject and each heading, paragraph and button changed where it is and saved on clicking away (`changeFlowBlockAction()`,
`withBlockText()`, email plan M3.4); a + between blocks adds a heading, words, a button or a line, and a block's ✕ removes it, never the last
(`changeFlowBlocksAction()`, `withBlockAt()`); Product or offer there finds one of the store's products or running campaigns (the broadcast
editor's finder, `findBroadcastFactsAction()`), a block code draws for each reader's market when the email is made (D352), never a price
written by hand. With more than one language, a tab per store language sits above the email; one not
written yet starts from the first language's words, copied to translate in place (`startFlowLanguageAction()`, `withLanguageCopy()`,
never over words already written). Write with AI under the email (M3.7, `writeFlowEmailAction()`) takes a line of what it is about and
hands it to the store's writer (`suggestBroadcast()`: the store's facts, brand and rules) with who the email reaches and when
(`flowAudience()`: the trigger, its place, days and branch, picks it may not name); the words replace that language's, and an email with
picks takes no products the writer chose. Under the subject, three subject lines to choose from (`suggestSubjects()`, nothing
saved until one is pressed; a line making a claim AI may not make is left out), and Rewrite with AI: shorter, warmer or more direct
(`rewriteEmail()`: one text back for each of the email's own, put back in its block by code, so pictures, products and addresses never
move; refused on a claim). A language not written yet can also be translated with AI from the first (`translateEmail()`, the same
text-by-text way, the preview line left empty), to read over in place before the flow is tested. Before it writes, the writer reads what the flow's emails earned in 30 days
(`earnedWords()`: orders, the email that brought the most, readers leaving; counted in code, never put in the email). Each change is a new
version, off until tested; the story above is drawn from the same tree.

## Presses in a flow's emails (19 November 2026)

A flow's email's links go through the broadcasts' click route (`/api/marketing/c/{flow}/{step}~{link}`, `flowClickUrl()`,
`recordFlowClick()`), looked up in the flow's own saved words; a press by a reader still on the list is kept as theirs in `email_clicks`
(`flow_id`, `step_id`; a broadcast's or a flow's, never both: `email_clicks_source`), 180 days, in their export and erased with them
(D754). The condition "if they pressed a link" holds once they pressed a link of this flow since they entered. An email with picks
keeps its links plain: the picks move its blocks, so a link's key would not name the same block.

## Checks before switching on (19 November 2026, email plan M3.6)

`flowChecks()` (`src/lib/flow-checks.ts`, pure) lists, above Test and Switch on, each email's problem as a line saying what to fix:
blocking, an email not written in the store's first language (its readers in a missing language would get nothing) or a language half
written; warning, a picture without a description, one in a format many mail apps do not show, an email near Gmail's 102 KB
clipping. Switch on is refused while a blocking one stands, in the same words. Links need no check (refused when saved). A broadcast's
page shows the same warnings before sending (`contentChecks()`); what blocks a send is refused by `sendProblems()` as before.

## The dry run (19 November 2026, email plan M3.5 in part)

Above Test, the flow says about how many people would start it in the next 30 days, judged from the last 30 (`flowReach()`, read only):
for an event, the people on the list behind its events of the last 30 days (the event log keeps 90); for a lapse, the customers whose
lapse falls in the next 30; for browsing, the signed-in subscribers with views kept now. Test walks the newest subscriber through it,
sending nothing. See the emails (`?see=1`, `drawFlowEmails()`) draws each email the newest subscriber would get, in their language and
market with their picks and plain links, only when asked, at a desktop's or a phone's width, light or as a mail app that turns it dark shows it (colours reversed, pictures kept:
`darkPreview()`, M3.4); nothing is sent, entered or marked tested. Each email in the story says how many of those would get it
(`stepReach()`, `flowStepPast()`): its share of the flow's own ended ways through once 20 have ended, before that everyone who starts
before a branch, or up to that inside one.

## The report in words (19 and 20 November 2026, email plan M3.8)

A flow's page says its last 30 days (`flowReport()`): who started it, its emails sent, the paid orders after them and their money,
the email that brought the most, who left the list on the way (runs ended as stopped), and one suggestion chosen in code
(`flowSuggestion()`: space out when more than one in twenty leave, picks when emails bring nothing, build on the step that works).
Orders are credited by D761's one rule, flows now a fourth sender (`flow:{flow}:{step}` in `orderCredit()`, Flows in Analytics →
Marketing). Home and the morning briefing say when a flow switched on is losing readers (`space_out`'s numbers, `LOSING`), through
E2.1's one source (`losingFlowCounts()` in `src/server/attention.ts`, the item `flows_losing`), for a member who may read marketing; it
opens the flow, or Flows when there are several.

## The flow guard (20 November 2026, email plan M3.9 in part)

A switched-on flow whose readers leave the list after its emails is switched off before it trips the store's sending guard (D730) for
every email: hourly (`guardFlows()`, from the every-minute flows job `tickFlows()`), of the people who got one of its emails in the last 7 days, those who
left the list within 48 hours of it (unsubscribed, or marked it as spam, which unsubscribes them); with 30 or more readers and more than
3 in 100 leaving (`flowGuardPauses()`, `src/lib/flow-guard.ts`), the flow goes off, the counts are kept on it (`guard_paused_at`,
`guard_counts`) and audited (`marketing.flow_guard_paused`). Its page says why in those numbers, Home and the morning briefing name it as
urgent for 14 days (`flows_paused`, counted in `heldCounts()`'s one statement), and the owner switches it on again after a test, which
clears the mark. The Flows page's goals say what each would reach in the store's own data (`flowProposals()`: joined, bought or
not ordered for 90 days, bought twice; counts only), each above its Start. The AI manager reads the same (`list_flows`, D855) and starts a
goal's flow switched off and untested (`start_flow`), so the autopilot can propose one; switching it on stays the owner's, on the
flow's page after a test. Still to come in M3.9: suggesting split tests (with M2.5).


## Split tests (email plan M2.5, D868)

An *if* step whose condition is `split` sends half the people each way, by `splitDraw()` (`src/lib/flows.ts`, a hash of the run id and
the step id); a test or dry run uses the person's own key, so it shows one way. Details and what is still to come: `docs/split-tests.md`.

## Keep your list awake, the sunset (20 November 2026, email plan M2.8)

The date trigger `subscriber.asleep` starts a flow for a subscriber who has pressed no link in the store's emails for its days (90 to 180,
180 by default; presses are kept 180, no opens are kept, M0.1 b), counted from their last press or from when they joined, once per time
they fall asleep (`enterAsleep()`, entry key `asleep:{subscriber}:{day}`). Those already asleep when the flow is switched on enter at most
50 a day per flow, so switching it on never emails a whole quiet list at once. The goal Keep your list awake (`sunset()`, replacing no
automation, so the Flows page counts it made by its trigger, `goalsMade()`) is one email asking whether they still want the store's news,
with a button to the store, then 14 days. Who pressed no link since entering is paused when the run ends (`pauseSunsetRuns()`,
`marketing_subscribers.paused_at`): still subscribed, never deleted, but `sendEmail()` holds their broadcasts and flow and automation
emails (`suppressed()`); a press on any link in the store's emails clears it (`keepClick()`, `keepFlowClick()`). The subscribers list and a
subscriber's page call them paused. The Flows page's goal says how many on the list it would reach now (`flowProposals()`), and the AI
manager can start it (`start_flow`'s goal `sunset`, API 1.52).
