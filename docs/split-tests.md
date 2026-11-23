# Split tests in broadcasts and flows (email plan M2.5, D868)

The plan for M2.5, written before any of it is built: *subject, words, send time or a branch, judged by D148's engine with unsubscribes
and complaints as guardrails; a broadcast's winner goes to the rest*. This page is the design. Each slice gets its own commit and a line
under "Built".

## What Homer sees

- **A broadcast.** Under the subject, *Try another subject* (or *Try other words*) opens a second version beside the first. The AI's three
  subject lines (M3.7) offer *Test these*. One line says what happens, with the numbers filled in: *1 in 5 of your 4,210 readers get one
  of the two; after 4 hours the one more people press goes to the other 3,368.* Nothing else to set. *Send now* works as before.
- **After the test.** The broadcast's page says it in one sentence: *"Autumn is here" got 31 % more presses (412 against 315 people);
  it went to the other 3,368 at 14:05.* Or: *no clear difference after 4 hours, so the first version went to the rest.*
- **A flow.** A step *Split* sends people one way or the other, half and half by default. The flow's report (M3.8) says which way earns
  more, and when the difference is clear, one press keeps the better way and removes the other (a new version, tested like any change).

Lisa's depth sits under *Customise* on the test: the share tested (10 to 50 %), how long to wait (1 to 24 hours), the goal (presses or
orders), and the counted figures with the engine's interval.

## Rules

1. **The engine judges.** `callRates()` (`src/lib/experiment-units.ts`) with a new unit, `recipient`, the interval rule and the same split
   check. Nothing is called with a broken split or under the floor. Code counts and calls; a model never declares a winner.
2. **The goal is fixed before sending**: presses (a person who pressed any link in their version, M1.3) or orders (D761's one rule, each
   order to one message). Presses are the default: orders come too slowly for a wait of hours.
3. **Guardrails.** Per version, unsubscribes and spam complaints within the wait. A version whose unsubscribes or complaints are clearly
   higher (the engine's rule, lower is better) never wins, whatever its presses. If both are clearly worse than the store's usual, the rest
   is not sent at all and the owner is told why (the store's sending guard, D730, already stops worse).
4. **Fair split.** A recipient's version is fixed from their subscriber id and the broadcast id (a keyed hash), kept on their
   `broadcast_recipients` row (`version`). The rest are rows held (`status = 'held'`) until the call, then sent the winner. The contact
   policy (D764) counts the test email like any other: a held reader is never sent two versions.
5. **Big enough or not offered.** A test needs at least the floor in each version: with `MIN_PER_ARM` (200), a list must give 400 readers
   to the tested share, so *Try another subject* shows only when the audience is at least 2,000 at 20 % (or the share raised under
   Customise). Below that it says how many more readers it needs, never runs a test that cannot be read.
6. **One language at a time is fine.** Each version holds the same languages as the broadcast; a reader gets their language of their
   version. The call is over all languages together.
7. **Flows.** A `split` step names two branches and a share. A person's branch is fixed from their run (keyed hash of the run id) and kept
   on the run's path, so the report counts each branch's goal. Applying a winner is the owner's press, never automatic: a flow is
   versioned and tested before it runs (D767).
8. **Send time** (the plan's third kind) is left to M4.4, send time per person, which supersedes a test of one hour against another.
9. **The platform.** Kaizena Flow's own broadcasts and flows run in its house store (D467), so they get the same tests.

## Slices

| Slice | What | Migration |
|---|---|---|
| 1 | Broadcast versions: version B's subject and preview (`broadcasts.test`), the share and the wait; `broadcast_recipients.version` and the `held` status; the hash; the send claims the tested share only; the line Homer reads. | `productive_reaper`, `broadcast_test_rules` |
| 2 | The call: after the wait, presses, unsubscribes and complaints per version, called with the engine; the rest get the winner (or A on no clear difference) and the figures stay on the broadcast; the sentence on its page; an audit row. Orders as a goal and B's own words come later. | none |
| 3 | *Test these* on the AI's three subject lines (M3.7); the AI manager's broadcast tools take a second subject (contract bump). | none |
| 4 | Flows: the `split` step on the canvas and in the story, the branch kept on the run, the report per branch, *Keep this way*. | `flow_split` |
| 5 | The autopilot suggests a test where a broadcast or flow step has enough readers (M3.9's last part). | none |

## Built

- **Slices 1 and 2, 23 November 2026.** *Try another subject* in a broadcast's editor writes subject B (and its preview) per language;
  the line under it says the share, the readers and when the rest get the winner, or how many more readers a test needs. `startBroadcast()`
  refuses a test below the floor (`testTooSmall()`), splits the tested share by `md5(broadcast || subscriber)` order, alternating A and B,
  and holds the rest (`held`, a new recipient status the database lets become only `queued` or `skipped`; a version once given never
  changes). `callDueTests()`, in every broadcast run, calls each test whose hours are over with `callBroadcastTest()` (presses, and
  readers who left as the guardrail, by the engine's interval rule) once, keeps the result on the broadcast (`test_result`) and queues the
  held readers with the winner. The sent broadcast's page says the call in one sentence. Goal: presses only; orders and B's own words wait.
