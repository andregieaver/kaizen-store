# Email marketing's usability test (email plan M3.10, 20 November 2026)

The five timed tasks of the plan's pass mark (`email-marketing-2026-11.md`, "What ahead on ease means"), walked as Homer would: from
where he starts, pressing only what is on the screen, reading nothing. The walk is a browser test, `e2e/signed-in/marketing-usability.spec.ts`,
run in CI's signed-in job; each task counts what is pressed and typed against a limit that only falls, and writes its figures to
`test-results/marketing-usability.json`. Seconds are the machine's, a floor for a person's; the presses are what a person does too.

## The five tasks

| Task | From | Presses | Typed | Limit | What Homer does |
|---|---|---|---|---|---|
| A first flow on | Marketing | 4 | 0 | 4 presses, nothing typed, under 3 minutes | Flows, *Start* on Welcome new subscribers, *Test it*, *Switch on* |
| A broadcast to a segment | Marketing | 7 | 3 | 8 presses, 3 fields | Broadcasts, *Write your own*, a name, the segment, a subject, the words, *Save draft*, *Send now*, *Yes, send it* |
| A word changed in step 2 | Flows | 3 | 1 | 3 presses | The flow, *Change* on its second email, the words, *Save* |
| What a flow brought | Flows | 1 | 0 | 1 press | The flow: *The last 30 days* says it in a sentence, with one suggestion |
| A flow stopped | Flows | 2 | 0 | 2 presses | The flow, *Switch off* |

## Against the pass mark

1. **A working flow on within 3 minutes of opening Marketing, without reading anything: met** (4 presses, nothing typed). Its emails show the
   store's own products where the goal picks them (cross-sell, restock, browse), in every language the store writes (side by side, M3.4),
   from the owner's own automation's words when they wrote one. **Not yet:** a recipe's first words are the ready-made ones, not written
   in the store's voice until the owner presses *Write with AI* (M3.7); writing them at Start would need an AI turn on a press Homer
   expects to be instant.
2. **A sentence to the AI manager becomes a complete flow: in part.** The manager lists the flows and the goals the store lacks with whom
   each would reach, and starts one switched off (D855); nothing sends until *Switch on*. **Not yet:** a sentence with its own terms
   (*with 10 % off*) does not shape the flow: the manager starts the goal's recipe and the owner adds the offer in place. The next step is a
   tool that takes the goal, its days and an offer block from the store's running campaigns.
3. **Before anything sends, how many each email would reach, from real data, and one real customer walked through: met** (M3.5: the
   flow's reach, each email's reach, *See the emails* for the newest person, *Test it*).
4. **Every flow's report says what it brought in one sentence, with one suggestion: met** (M3.8), and Home and the briefing name a flow
   losing readers or switched off by the guard (M3.8, M3.9).
5. **Lisa reaches every setting from the same screen: met.** The canvas, each step's conditions, the words per language, the HTML as sent
   (*See the emails*, phone and desktop, light and dark), and the contact policy (how often a person may be emailed), linked from the flow's
   page to its card on Marketing (found by this test and fixed in the same change).

## Follow-ups

- The manager's flow tool takes a goal's days and an offer (pass mark 2): done 24 November 2026 with `create_flow` (D889).
- A recipe's first words written in the store's voice when the store has AI set up, in the background after *Start* (pass mark 1): done 25
  November 2026 (D897).
