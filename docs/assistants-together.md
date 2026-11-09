# The assistants together: Kaizena Flow's AI manager and Kaizen Life's assistant

Status: **steps 1 and 2 built (D517, D519, 9 November 2026).** Step 3 is planned below.

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

### Not yet

* The agent eval has no case for a report from Kaizen Life yet: adding one needs a new recorded run on Platform → AI (step 3).
* Life keeps no job of its own: a report to Flow that fails is tried three times at once, then left to Flow's job, which gives up a task
  Life never answered.

## 4. Step 3: what the person sees

* *Between your assistants* in each app: open handoffs, their status and their conversation, with the switch.
* A card in each chat when an assistant asked the other ("Asked Kaizen Life …"), and its answer when it comes.
* The agent eval (Flow) gets cases for the new tools, with a new recording; Life's `untrusted.ts` and smoke checks cover them.
* Both apps' privacy texts and data maps name the exchange.
