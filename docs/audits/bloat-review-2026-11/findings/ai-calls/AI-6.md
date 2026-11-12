# AI-6 ✓ The autopilot's, follow-ups' and saved-skills' tools ride on every AI manager round

What every AI call carries (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P1. **Effort:** S. **Confidence:** high. **Step:** 2.36. **The owner's choice.**
- **Second check:** corrected.
- **Where:** `src/lib/manager-tools.ts:19-160`, `src/lib/tool-budget.ts:66-68`, `src/lib/tool-budget.ts:115-124`, `src/server/owner-assistant.ts:438`, `src/server/owner-assistant.ts:471`, `src/server/owner-assistant.ts:726-730`
- **Evidence:** The manager's own 26 tools are always sent and never cut (tool-budget.ts:66-68; owner-assistant.ts:726-730). 12 are the autopilot's (make_autopilot_plan 3,508 characters, revise_autopilot_plan 3,055, set_goal 1,868 and nine more: 12,417), 3 are follow-ups (1,708) and 2 are for saving skills (1,259): 15,384 characters a round, for every store and every question; the other 9 are 4,944 (my bundle, the same split as the skeptic's). The prompt also tells the model to use follow_up and save_skill (owner-assistant.ts:438, 471).
- **Cost today:** About 3,800 tokens on every AI manager round (estimate at 4 characters a token): about 10% of today's round, and 46% of the 33,800 characters of tools a lean round on Home would send after AI-1. Paid by: The server per AI manager call and the store's AI allowance.
- **Saving:** 15,384 characters a round (measured) on rounds where the group is not loaded; none if the owner keeps them always present.
- **Risk:** A model that does not see the tools will offer plans and reminders less often: that is the product question. A reminder asked for in words outside the list costs one load_tools round. Noticed by the eval cases and by the share of turns that end with a follow-up or goal in the round log.
- **Already tracked:** No. FA1 keeps 'the manager's own' in the default set; owner question 8 of the code review covers the default set in general.

## The fix

1. Put it to the owner with question 8 of the code review, as one choice: (a) the manager always holds these tools, so it can offer a plan or a reminder unprompted, at 3,800 tokens a round; or (b) they load when the talk turns to them. The steps below are (b).
2. src/lib/manager-tools.ts: export `AUTOMATION_TOOLS`, a set naming the 17 (save_skill, delete_skill, follow_up, list_follow_ups, cancel_follow_up, set_goal, list_goals, drop_goal and the nine *_autopilot_* tools).
3. src/lib/tool-budget.ts: `ToolArea` becomes the permission areas plus "automation", with `TOOL_AREAS = [...AREAS, "automation"]` used by the held-back loop (lines 89-94), loadToolsDefinition() and readLoadTools() (line 120 filters by AREAS today). AREAS itself, which permissions read, is not touched.
4. src/server/owner-assistant.ts, runTurn(): in a person's own turn pass the 17 through chooseTools() as offered tools of area "automation" instead of in the always-sent list (lines 726-730, 735). They are picked when one was used earlier in the conversation (`used`), when load_tools asks for automation, when the store has something of theirs alive, or when the message's words match. 'Alive' is one read beside those at lines 663-683: exists a row in commerce.assistant_goals, commerce.assistant_plans or commerce.assistant_follow_ups for this store and person that is not ended (open each table's status values when building). The words go in src/lib/tool-router.ts (AI-1): remind, reminder, follow up, every day, every week, every month, goal, plan, autopilot, skill, and the Norwegian påminn, minn meg, hver dag, hver uke, mål, plan, ferdighet.
5. Outside assistants' turns (OUTSIDE_MANAGER_TOOLS), autopilot steps and scheduled follow-ups keep exactly what they get today.
6. managerPrompt() lines 438 and 471: keep both hints and add that these tools are in the area automation, loaded with load_tools when missing. Without that the prompt names a tool the model cannot see.
7. Eval cases (with AI-14): 'Remind me on Friday at 9 to check order 1042' must call follow_up; 'Set a goal: 20% more repeat orders by March' must call set_goal; a question about orders must call neither.
8. docs/rules/admin/ai.md: under the follow-ups, autopilot and saved-skills rules, one line each that their tools are the automation group.

**Done when:** If (b): the default round in src/server/ai-round.scan.test.ts (AI-10) holds 9 of the manager's own tools and under 35,000 characters in all for a shop on Home (48,600 with all 26), and the two new eval cases pass in the committed recording. If (a): the choice is written in docs/decisions.md and nothing changes.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/tool-budget.test.ts: ALWAYS (line 11) changes from the manager's 26 plus 2 to 9 plus 2; add that automation is held back by default and loaded by load_tools.
- src/server/follow-ups.int.test.ts, src/server/autopilot-*.int.test.ts and src/server/owner-assistant.int.test.ts: turns that expect follow_up or set_goal to be offered need the words, a live goal or a load first.
- src/lib/agent-eval.test.ts (every tool a case names exists) and the replay: new recording.
- docs/rules/admin/ai.md (the AI manager's follow-ups, PSI AGT-04; the autopilot, D309; saved skills, D350).

**Comes after:** AI-1 (same change and eval run); AI-14; The owner's choice between (a) and (b); A new run of the agents' eval on Platform, AI in production after the deploy, and its recording committed as src/data/agent-eval-recording.json (a person with platform access does this; CI only replays it)

**Notes:** The skeptic removed the draft's argument from empty tables, rightly: before opening nobody has used anything. What remains is that these definitions are sent before anyone asks for them. It is a product choice, not waste; if the owner picks (a), close this with the decision.
