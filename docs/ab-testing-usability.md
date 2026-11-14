# A/B tests made plain (proposal, 14 November 2026)

A review of the A/B tests (D148, [`ab-testing.md`](ab-testing.md)) for people who have never run one, and for the AI that helps
them. The page with mockups: https://claude.ai/artifact/Ep8Vp5BbKEs7QMpECrZqfs. Nothing here is built yet; the steps below are
proposed as phases 12 to 15 of D148.

The engine is sound and stays as it is: rules fixed before results, no verdict before the minimum, the split check, the guardrail,
the words written in code (`verdictOf()`), approval for start, stop and apply. What the person sees is the problem: three tables, an
unlabelled line and a paragraph. Every screen, email and AI answer should answer, in this order: **Is it working? When will I
know? What should I do?**

## What the code shows today

| # | Finding | Where |
|---|---|---|
| 1 | While the verdict says "Too early to say", the table already shows a change and "94 % chance it is better": it invites the early peeking the design rules out. | `experiment-results-view.tsx`, column "Against the original" |
| 2 | No progress: how far the test is from an answer is one sentence ("Wait for 412 more visitors … and 6 more days"); no bar, no date. | `verdictOf()` → `earlyDetail` |
| 3 | The one chart (cumulative rate) has no axes, no gridlines, no minimum-days marker; early days swing wildly. | `Trend` in `experiment-results-view.tsx` |
| 4 | Uncertainty is a number, never a shape: `Comparison.low/high` are computed and never drawn. | `compareToOriginal()` |
| 5 | The versions are never shown: only "Change it" and "Preview" links. `compareVersions()` (D358) and `DualFrame` (D412) exist. | `DraftPanel`, results view |
| 6 | The runtime estimate asks the owner to type visitors a day and today's rate. Kaizena Flow now counts visits by landing path (D152), cookie choices and the cart funnel; "no page-view numbers yet" is out of date (also in `suggest_experiments`). | `RuntimeEstimate`, `suggestExperimentsTool()` |
| 7 | Eight decisions before anything is visible (five cards), and the draft page asks most of them again. | `experiment-form.tsx`, `DraftPanel` step 2 |
| 8 | Nobody hears when there is an answer: only a guardrail stop emails; the autopilot hears `test_ended`, not a verdict. | `experiment-emails.ts`, `autopilot-events.ts` |
| 9 | A decided test leaves nothing behind: no learning, no "what it means a month". | `applyVariant` / discard |
| 10 | The AI sees fewer facts than the screen: `explain_results` has no range, no progress or expected date, not what B changed, no daily series. | `explainResultsTool()` |

## Stages for the person

The statuses stay. On screen, `running` is shown as **Still learning** (before the minimum days and visitors) and **Has an answer**
(after it, while the verdict is better, worse or even); `stopped` waiting for a choice is also **Has an answer**. Each stage has one
main button: Start, Keep it running, Use B / Keep the original, and after deciding, the learning.

## Steps

1. **Read at a glance (phase 12, no migration).** A pure `experimentCard()` in `src/lib` (state, progress with an expected date,
   range, next step) that the results page, `explain_results`, `explain_ab_test` and the emails all read. The results page: a verdict
   card with progress meters and one main button; a range chart (dot and likely range against "no change"); the trend with axes,
   gridlines and the day-14 marker; funnel bars; the split as a bar; today's tables under "How we worked this out". Peek-proof: no change
   or chance figures while the verdict is `few` or `early`. Re-run the agent eval (a tool's answer changes).
2. **No numbers to guess (phase 13, no migration).** `trafficFor(target)`: consenting visitors a day for a page (landing visits by
   path; the store's total for the header and footer) and the goal's baseline from the 30-day funnel. The estimate fills itself in; each
   goal says how soon it answers; a recommended goal for small shops. The new-test form becomes one screen with Customise; the draft page
   shows A and B side by side with `compareVersions()`' list and a ticked checklist. `suggest_experiments` returns traffic and an
   estimate per candidate. The visits read is on a hot table: check it against `visits`' indexes.
3. **News and a memory (phase 14, one migration).** `experiments.answered_at` and `experiments.learning` (nullable). A `verdict_reached`
   event raised once by `runExperimentJobs()`: an AI manager notice (D350), an email to the owners, an autopilot event (D309) and an owner
   webhook event (D354). "If everyone saw it" computed from the range and the counted traffic. Learnings written on deciding (280
   characters, claims filter), listed as "What your tests taught you", a gated `record_learning` tool, and earlier learnings returned by
   suggest and explain.
4. **Ideas and eyes (phase 15, no migration).** The list grouped (needs your decision, still learning, ideas, learnings) with
   sparklines and progress; "Ideas to test" built in code from suggest's facts, without a model call; `look_at_versions` through
   page-look (D310); a one-time 30-second explainer; CSV and an Admin API read of the card. The platform's view uses the same card and
   chips (the parity rule). A new tool needs its eval case and a new recording (D391).
