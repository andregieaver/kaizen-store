---
title: The autopilot
summary: Give the AI manager goals, let it work through plans in your name while you are away, and choose how far it may go without asking you.
track: owners
section: ai
kind: how-to
areas: [ai, analytics]
features: []
plans: []
admin: /admin/{store}/assistant/autopilot
order: 20
checked: 2026-11-04
sources: [D309, D328, D331, D334, D418]
---

The autopilot is the work [the AI manager](/docs/owners/ai/the-ai-manager) does on its own: it works toward your goals in plans of
steps, in the background, and asks you when something needs your yes or an answer. Open the AI manager's page and choose the tab
**Autopilot**, or go to [Autopilot](/admin/{store}/assistant/autopilot). Only the store's owners have it.

## Set a goal

Tell the AI manager what you want to achieve, in your own words: "I want 50 orders a month by June". It keeps the goal with up to five
targets, and measures them from your store's own figures, never by guessing:

- net sales, or paid orders, over the last 30 days;
- conversion over the last 30 days, while your store counts visits;
- the store open by a date;
- how many active products, or published pages, the store has.

Net sales are without VAT, less refunds, in your store's main currency. The **Goals** tab shows each goal's progress. A goal is
*Met* when every target is; a figure that cannot be known is *Not measured*, never 0. **Drop** drops a goal. A store keeps up to five
active goals.

## Make a plan and start it

On the **Plans** tab, press **Ask the AI manager for a plan**, or ask in a conversation. It suggests a plan of up to 30 steps: changes
it makes with one of its tools, tasks it works on, questions for you, and waits until a date. Read it, and ask for changes until it
is right.

Nothing runs until you start it: approve the card *Starts work in your name*, or press **Start** on the Plans tab. You start exactly
the version you were shown; if the plan changes afterwards, it waits to be started again.

Then it runs one step at a time, in your name and with what your role may do. Each plan has its own conversation in the AI manager,
*Autopilot:* and the plan's title, so your own conversations stay yours. After each step, code checks that it worked. A step that
fails is tried again; after three tries it becomes a question with the choices *Try again*, *Skip this step* and *Stop the plan*.

The Plans tab shows each plan with its steps, what each did and how many are done. **Pause** and **Resume** a plan, or **Stop** it
for good; what it already did stays. A plan pauses by itself if the person it runs for no longer works in the
store.

## Decisions: what waits for you

**Decisions** is the first tab, and its name counts what waits:

- *Waiting for your yes*: changes it kept for you, each with **Approve** and **Decline**;
- *Questions*: a plan's questions, answered with **Answer**;
- *Only you can do this*: setting up payments, and choosing a plan with Kaizena Flow;
- *What the AI manager will come back to*: its follow-ups, each with **Cancel**.

You also get a notice in the AI manager, and an email at most once a day, after 18:00 in your store's time, when a step finished or
something waits for you. The email says what was done and what waits, never what a customer wrote.

## Choose how far it may go

On the **Settings** tab:

1. **Autopilot on**. Off pauses every plan; nothing is lost.
2. **What it may do**: for each area (Products, Website, Design, Store setup, Marketing, Messages to customers, Money), choose a level:
   - **Ask me first** (the start for every area): it keeps each change for your yes;
   - **Do it and tell me** or **Just do it**: it makes the change itself, and the step's result on the Plans tab says what it did.
3. Press **Save**.

Drafts and things only you see are always fine; the levels are about what customers see or receive, and what costs money.

> [!IMPORTANT]
> Some changes always ask, whatever you choose: who works in the store, your domains, a broadcast to your list, refunds and order
> changes, credits and gift cards, your plan with Kaizena Flow, features and opening the store. A theme that costs money always asks
> too.

### Limits

Under **Limits**, the autopilot stops or asks at the line you set:

| Limit | Starts at | What it does |
|---|---|---|
| **AI cost a month (USD)** | 5 | What the autopilot's own AI may cost in a month, pictures and page builds included. Reached, its plans pause. Empty: no limit of its own. |
| **Deepest offer (%)** | 20 | A discount code or campaign deeper than this always asks. |
| **Largest price change (%)** | 10 | A price change larger than this always asks. |
| **Emails to customers a week** | 5 | Emails to one customer and answers in support it may send itself in seven days; past this they ask. 0: every one asks. |

The store's owners get an email when the autopilot has used 80 % of its AI cost for the month, and another when it is spent.

## The weekly report and what it did

Every Monday from 08:00 in your store's time, the people whose plans ran get a weekly report by email: net sales and orders of the
last seven days beside the seven before, the goals' targets met, the steps done and what waits. A few sentences of what it sees are
written by the AI, without figures of its own. The latest report is also on the Decisions tab, under *Your latest weekly report*.

The **Results** tab, *What the AI did*, measures each change the autopilot made itself, two weeks after it was made: a change to a
product on that product's sales, anything else on the store's sales, over the 14 days before and the 14 after, beside the store's own
over the same days. It is a comparison of before and after, not proof that the change caused it. On the first of each month, the
people whose plans ran get *What the AI did* in the month by email, when there is something to tell.

Every change the autopilot makes is in the **Activity log** under the plan's person, marked *through the autopilot*.

## More options

### Keep working toward my goals

Off at first. Switch on **Keep working toward my goals**, and when a plan for a goal ends, and every few days, the autopilot looks at
the goal again and makes the next plan. Under it:

- **A plan it makes for a goal**: **Waits for my yes** (the start), or **Starts at once**;
- **Look at each goal again every (days)**: 7 at first;
- **Plans it may start itself in a week**: 3 at first; past this, a new plan waits for your yes.

A plan it starts itself still follows your levels and limits. The Goals tab shows when it last looked at each goal and what came of
it.

### React to what happens

Off at first. With **React to what happens** on, the autopilot looks at once when:

- a customer has waited for a person longer than **Minutes a customer waits before it looks** (15 at first): it leaves a note with a
  suggested reply for whoever answers, never a word to the customer;
- an A/B test ends by itself: it chooses the winner as your levels allow;
- an urgent alert fires: it plans what to do, and the plan starts as **A plan it makes for a goal** says.

The Decisions tab lists *What the autopilot reacted to*.

> [!NOTE]
> Kaizena Flow can pause every AI that works on its own across the platform. Your plans then wait, and carry on where they were when
> it ends. Your own conversations with the AI manager are never paused.
