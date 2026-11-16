# A/B tests made plain (plan, 14 November 2026; updated for the admin redesign, 16 November 2026)

A review of the A/B tests (D148, [`ab-testing.md`](ab-testing.md)) for people who have never run one, and for the AI that helps
them. The page with the findings, screenshots of the screens as they were and mockups: https://claude.ai/artifact/Ep8Vp5BbKEs7QMpECrZqfs.
Steps 1 to 3 are built (phases 12 to 14 of D148, D659, D660 and D662); step 3b is built (D670, D673); step 4 is built (D677, D678, D680); step 2b is the plan.

The engine is sound and stays as it is: rules fixed before results, no verdict before the minimum, the split check, the guardrail,
the words written in code (`verdictOf()`), approval for start, stop and apply. What the person saw was the problem: three tables, an
unlabelled line and a paragraph. Every screen, email and AI answer should answer, in this order: **Is it working? When will I
know? What should I do?**

## In the redesign's terms

The plan was written before the admin redesign (rounds 1 to 17, D595 to D652). Its seven principles are the same three questions said for
every page, so the plan keeps its steps and is drawn with the redesign's patterns and parts:

| Principle (round 1) | The A/B tests |
|---|---|
| One page, one question | The test's page: *is it working, and when will I know?* The list: *what needs me?* A new test: *what do I want more of?* |
| One next step | One green button from the test's stage (`experimentCard().next`): *Start now*, *Use Version B*, *Keep the original*, or none while it learns |
| Show before you tell | The path (`StepPath`), progress bars (`ShareBar`), *How sure are we?* as a range, *What is different* in words, the trend with axes |
| Numbers that mean something | Every figure against the original and the minimum ("16 of 14 days", "2,380 of 200 visitors"), the range against no change |
| Depth, one step away | *How we worked this out* (`FoldOnHash`) holds every table; the rarer actions sit under *More* (`MoreMenu`) |
| Reassure, then celebrate | Deciding asks first and says what changes; the path ends at *Decided*; step 3 tells the owner the day there is an answer |
| Calm by default | Meadow's chart tokens (`--chart-compare` for the original, `--chart-1…` for versions); nothing drawn that only moves with luck |

So the test's page is a **record** (like the order, D595 step 4), the list a **list with a lead sentence** (like Campaigns, D633) and the new
test an **editor** with *Customise* folded (like the product, D595 step 5).

## What the code showed (14 November 2026)

| # | Finding | Status |
|---|---|---|
| 1 | The verdict and the table disagreed: "Too early to say" above "−12 %, 37 % chance"; "No clear difference" above "+16.1 %, 96 % chance" (two-sided range against a one-sided chance); "100 %" against "more than 99 %". | Fixed in step 1 |
| 1b | On a phone the tables wrapped and overflowed; while running the only button was *Stop*, above the verdict. | Fixed in step 1 |
| 2 | No progress bar and no date, only a sentence. | Fixed in step 1 |
| 3 | The one chart had no axes and swung hard in the first days. | Fixed in step 1 |
| 4 | Uncertainty was a number, never a shape. | Fixed in step 1 |
| 5 | The versions were never shown. | Steps 1 and 2: what is different in words; step 2b: side by side |
| 6 | The estimate asked the owner to type visitors a day and a rate; visits (D152), cookie choices and the funnel exist. | Fixed in step 2 |
| 7 | Eight decisions before anything is visible, and the draft page asked them again. | Fixed in step 2 |
| 8 | Nobody hears when there is an answer. | Fixed in step 3 (notice and email); step 3b: the autopilot |
| 9 | A decided test leaves nothing behind. | Fixed in step 3 (learnings, what it would mean) |
| 10 | The AI saw fewer facts than the screen. | Fixed in step 1 (`explain_results`) |
| 11 | Found while building: applying a whole-page winner renamed the live page "… (B)". | Fixed in step 1 |
| 12 | Found while building: an untouched copy of the template's front page counted as changed, so it could be started. | Fixed in step 2 |

## Steps

1. **Read at a glance (phase 12, D659, built 16 November 2026).** See `ab-testing.md`, "What phase 12 built".
2. **No numbers to guess, and a calmer start (phase 13, D660, built 16 November 2026).** See `ab-testing.md`, "What phase 13 built". Small
   shops meet the honest answer often (a 20 % change takes months at 70 visitors a day), so the form names the smallest change that could
   be found within six weeks and offers it in one press.
   2b. **The original and B side by side (no migration).** A preview route outside the admin's frame (`/admin/frame/{store}/…`, signed in,
   the same access checks), drawn in two scaled frames on the draft page and under *What is different* on a started test.
3. **News and a memory (phase 14, D662, built 16 November 2026).** See `ab-testing.md`, "What phase 14 built".
   3b. **The AI side of news and memory.** Part 1 built (D670): the autopilot's `test_answered` event. Part 2 built (D673): an optional
   `learning` on `apply_winner` (a separate tool would pass the 128 tools a turn carries), pushed on its own without a migration so it deploys after the quick gate, then one eval run on Platform → AI and
   its recording. The owner webhook event moved to step 4: it needs an `experiment` subject in the platform's event model (Admin API, apps,
   the docs portal).
4. **The list, ideas and eyes (phase 15, no migration).** Part 4a built (D677): the list grouped with its lead sentence, ideas to test,
   tests on Marketing and the platform's chips. Part 4b built (D678): the webhook event, CSV and the Admin API read. Part 4c built (D680): `look_at_page` takes a version's page id, which `explain_results` gives. An owner webhook event `experiment.answered` (an `experiment` subject in the event model). The list with a lead sentence (*One test has an answer.*) and rows grouped
   (needs your decision, still learning, ideas, what your tests taught you), each with its stage chip and a progress bar or sparkline; the
   Marketing page (D612) shows a test with an answer among *what runs now*. "Ideas to test" built in code from suggest's facts, without a
   model call; `look_at_versions` through page-look (D310); CSV and an Admin API read of the card. The platform's view
   (`/admin/platform/experiments`) uses the same card and chips (the parity rule; Kaizena Flow's own pages are not tested yet).
