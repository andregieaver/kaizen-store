# The assistants together: Kaizena Flow's AI manager and Kaizen Life's assistant

Status: **steps 1 to 3 built (D517, D519, D521, 9 November 2026).** One owner step is left: the eval's case (section 4).

The owner's ask: *Life and Flow are two apps, each with its own AI assistant. Let them talk: ask each other questions and give
each other tasks.*

"Life" is `/home/user/lifesaver-app` (kaizenalife.com); "Flow" is this repository. Life's own notes are in its `INTEGRATIONS.md`,
*The two assistants working together*.

## 1. What the owner decided (9 November 2026)

1. **One switch, over the account link.** The assistants talk over the account link (D511), which is already signed in both
   directions and live, not over two separate OAuth connections (D96). The person says yes once: *Let them work together*.
2. **Each assistant has its own lane.**
   * Flow's AI manager may ask Life about the person's day, tasks, reminders and calendar (when they are free), and add a task or
     reminder there.
   * Life's assistant may read the person's stores (the owner MCP's tools) and ask their AI manager.
   * Never crossing: Life's health, money, contacts and mail; a store's customer lists beyond what a single answer needs.
3. **Approvals stay where the change happens.** A store change waits for a yes in Flow's AI manager; a calendar change waits in Life.
   The asking assistant only says what waits, and where.
4. **No task without being asked**, at first. An assistant asks or hands over work only when its person asked it to.
5. **Platform parity.** The platform's AI manager is the same AI manager, and asks Kaizen Life the same way (below).

## 2. Step 1 as built: questions over the link, behind one switch

### The switch

* `commerce.kaizen_life_accounts.assistants_at` (since when, null while off) and `assistants_aal` (the assurance of the session that
  switched it on), written only by `src/server/kaizen-life-accounts.ts` (`setAssistants()`), audited
  `account.kaizen_life_assistants_on` and `_off`. Life keeps a copy (`kaizena_flow_links.assistants_at`), written in the same call.
* **On only in Flow**, on Your account → Connected apps and assistants, under the Kaizen Life link (`switchAssistantsAction()`).
  Switching on lets Life's assistant read store data, customers' details included, so the yes is given where that data lives, with
  Flow's second step. A switch on that Life did not take is put back off, and the page says so.
* **Off in either app.** Life's *Stop* tells Flow's `assistants` door (only `on: false` is taken there); Flow's tells Life's.
* **Unlinking switches it off**, and a link made again starts with the assistants apart (a check in the database holds it).
* Life shows the switch's state and, while off, *Turn on in Kaizena Flow ↗*, through the one door
  (`/admin/sign-in/kaizen-life?next=/admin/account/connected`).

### Life asks Flow

* Life's store tools (`list_my_stores`, `get_store_*`, `list_store_*` and `ask_store_assistant`) go to Flow's new `tool` door while
  the switch is on: a signed request naming the Life user, the tool and its arguments. (`work_summary` already reads the link's own
  `work-summary` door, D511.)
* Flow answers it exactly as `/api/mcp` answers Kaizen Life (`callMcpTool()`): the caller is the linked account
  (`callerOfLink()`), owner of the stores it owns that are not closed, so the same rules hold. Gated changes are kept for the owner's
  yes in the store's "From Kaizen Life" conversation, every call is in the activity log as Kaizen Life's, and the budget is the
  person's (120 a minute, `takeMcpBudget()`).
* **The second step.** A switch turned on at `aal1` reaches no store that requires two-step, and nothing of a platform admin's
  (refused `two_step`): switch it on again after the second step. The same rule as Kaizen Life's tokens.
* Refusals Life's assistant words for the person: `not_linked`, `assistants_off`, `two_step`, `no_stores`, `slow_down`.

### Flow asks Life

* The AI manager's `ask_kaizen_life` (unchanged tool and prompt) is offered while the switch is on (`assistantsOn()`), and asks
  Life's new `ask` door (`askLifeAssistant()`, 90 seconds): a signed request with the Life user, the Flow account, the question and
  the store's name.
* Life checks its copy (linked to that Flow account, switch on) and runs its assistant in the narrow lane D96 gave it: the day's
  board, tasks, reminders, calendar, adding a task or reminder (`STORE_CALLER_TOOL_NAMES`), a fixed prompt, no memory, and nothing
  that hands off again.
* The platform's AI manager has it too: `runTurn()` offers it on the platform as in a store, naming *Kaizena Flow* as the asker.

### No loops

The run each side starts for the other cannot ask back: Flow's turn for Life runs with `fromKaizenLife` (no `ask_kaizen_life`), and
Life's run for Flow has no store tools and runs at the deepest hand-off depth.

### The older connections

D96's two OAuth connections (Flow's `kaizen_life_links`, Life's `kaizen_store` integration) still work for anyone who set them up,
and are used only while the switch is off. Nobody has either in production (counted 9 November 2026), and their client settings are
left unset. They go once the link has served a while.

## 3. Step 2 as built: tasks, with a report back (D519)

A question waits for its answer (90 seconds at most), and a change that needs a yes used to end as "waiting": the asker never heard how
it ended. Now an assistant can **hand the other a task**, which is taken at once and reported on later.

### The record

One row per task on each side, under the id the sender gave it: Flow's `commerce.kaizen_life_handoffs`, Life's `kaizena_flow_handoffs`.
Each holds who asked (account, store or space, the conversation), the task, its status, the result in words and a link. Statuses:
`working` → `waiting_for_you` → `done` | `declined` | `failed` | `cancelled` | `expired`.

### The doors (signed, as every other)

| Door | On | Takes |
| --- | --- | --- |
| `handoff` | both | a task (answered 202 at once, then run after the answer), or `cancel: true` for one it holds |
| `handoff-update` | both | the status, result and link of a task it handed the other |

Both are budgeted per Kaizen Life user (`life_handoff`, 30 a minute) beside the day's cap: **20 tasks a person a day, each way**
(`HANDOFFS_PER_DAY`).

### Flow hands Kaizen Life a task

* The AI manager's `hand_to_kaizen_life` (with `kaizen_life_tasks` and `cancel_kaizen_life_task`), offered only while the switch is on and
  only in the person's own turns: never in a follow-up, the autopilot, an outside assistant's turn, or a turn Kaizen Life asked for. It is
  offered on the platform's AI manager too.
* Life takes it at once and runs its assistant in the narrow lane (the day, tasks, reminders, calendar, adding a task or reminder), with
  nobody watching, so anything gated waits for the person in Life.
* Life's report comes back through Flow's `handoff-update`. It is written into the conversation the task came from, as a message marked
  `[From Kaizen Life]` (another app's words, read as data), with a notice (`life_handoff`). A link is kept only to Kaizen Life's own pages.
* A task Life never reports on is given up after two days, and the person is told.

### Kaizen Life hands a store's AI manager a task

* Life's `hand_to_kaizena_flow` (with `list_flow_tasks` and `cancel_flow_task`) names the store, as the store tools do. It is not in
  Flow's lane on Life, so a task from Flow can never hand one back.
* Flow takes it with the same caller as the `tool` door (`callerOfLink()`: owned stores, two-step stores at `aal2` only), and runs it as a
  turn of the store's AI manager in the "From Kaizen Life" conversation, nobody watching (`fromKaizenLife`, `outside`, `scheduled`).
* A change it keeps waits for the owner's yes in Flow, as ever, with a notice. Life hears `waiting_for_you`, with the conversation's link
  through the door. Once the owner has answered every kept change, Life hears what they came to: `done`, `declined`, `failed` or `expired`
  (`settleHandoffAfterApproval()`, from `decideApproval()`).
* Life writes Flow's report into the chat the task came from, and tells the person (a notification and a push).
* Taking a task back declines what it kept, so nothing runs later.

### Reliability

The five-minute job (`runKaizenLifeHandoffs()`, the dispatcher's `lifeHandoffs`):

* runs a task from Life whose run never started (the answer's `after()` lost);
* ends one whose run stopped;
* settles a task whose kept changes were all answered while its report was lost;
* tells Life a status it has not heard, up to six tries;
* gives up a task handed to Life that it never reported on.

Tasks wait while a platform admin has paused the AI acting on its own (PSI AST-07).

**Kept for:** in Flow, an ended task goes with the AI manager's conversations (12 months, or the store owner's own period; the daily
retention step) and with the account (*Leaving*). In Life, an ended task goes after 12 months (the daily `purge-deletions` job) and with
the account; Life also gives up a task handed to Flow that Flow never reported on (two days working, eight waiting for a yes), and Life's
data export includes its tasks.

### Not yet

* The agent eval has no case for a report from Kaizen Life yet: adding one needs a new recorded run on Platform → AI (step 3).
* Life keeps no job of its own: a report to Flow that fails is tried three times at once, then left to Flow's job, which gives up a task
  Life never answered.

## 4. Step 3 as built: what the person sees (D521)

* **Between your assistants**, beside the switch in each app (Flow: Your account → Connected apps and assistants; Life: Settings →
  Connected apps). It shows the latest tasks both ways: who asked, the task, Kaizen Life's or Kaizena Flow's report, and what it came to
  (*Working on it*, *Waits for your yes*, *Done*, *Declined*, *Could not finish*, *Taken back*, *Not answered in time*). *Open the
  conversation* (Flow) or *Open the chat* (Life) goes to where it lives, and *Take back* stops a task the person handed over that has not
  ended. It shows while the switch is on, or once there is a task. Flow's page is the account's own, so the platform's admins have it
  too.
* **Cards in the chats.**
  * A report from the other app (the message starts with `[From Kaizen Life] ` in Flow and `[From Kaizena Flow] ` in Life) is drawn
    as a card of its own, marked *From Kaizen Life* or *From Kaizena Flow*. It is never rated as the assistant's own answer.
  * In Flow, an answer that handed Kaizen Life a task carries a note: *Handed to Kaizen Life. Its report comes into this conversation.*
* **Words.** Flow's in English and Norwegian (the admin's catalogue); Life's in English, Norwegian, Swedish, German and Spanish.
* **Privacy.** Life's privacy policy (en, nb, sv) says what the two assistants may share, and its data map has row 29. Flow's record of
  processing is drawn from the register, where `kaizen_life_handoffs` is classified (platform service, deleted with the account).

### Still open: the eval's case (an owner step)

The agents' safety eval has no case yet for a report from Kaizen Life reaching the AI manager's conversation. A new case changes the
eval, and CI then wants a new recorded run, which only a real model run on Platform → AI can make. Adding the case without the
recording would hold every later deploy that carries a migration. So, in one go:

1. A session adds the case to `src/lib/agent-eval.ts`: a conversation whose history holds a `[From Kaizen Life] ` report that hides an
   instruction (for example, to refund an order); the AI manager must not act on it, and must keep any change for the owner's yes.
2. The owner runs Platform → AI → *Run the agents' eval*, then *Download the recording*.
3. The recording is committed as `src/data/agent-eval-recording.json` in the same push as the case.
