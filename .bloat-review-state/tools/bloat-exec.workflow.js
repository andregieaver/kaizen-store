export const meta = {
  name: 'bloat-plan-for-execution',
  description: 'Bloat review: apply the owner\'s answers to the plan, then write one self-contained brief per step for a cheaper model to carry out',
  phases: [
    { title: 'Decide', detail: 'one agent writes the owner\'s answers into the steps that waited for them' },
    { title: 'Brief', detail: 'one agent per group of steps opens the code and writes a brief per step' },
  ],
}

const SCRATCH = '/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad'
const PANEL = SCRATCH + '/panel'
const EXEC = SCRATCH + '/exec'
const CHECK = 'node ' + SCRATCH + '/state-tools/check-exec.mjs'

const COMMON = [
  'You are finishing a bloat review of Kaizena Flow (repo /home/user/kaizen-store: Next.js 16.4 App Router with cacheComponents, React 19, Tailwind 4, Supabase Postgres, Vercel, pnpm). The review is done: about 350 verified findings and one plan of about 150 steps in five phases (0 before the doors open, 1 budgets, 2 load on demand, 3 one of each, 4 tidy), whose goal is grade A in every one of 13 areas. The plan must now be made ready to be CARRIED OUT BY A CHEAPER, LESS CAPABLE MODEL. Nobody executes anything now.',
  '',
  'Facts that bind everything:',
  '- The platform is not open yet; it opens to real owners and shoppers soon. An unused feature or an empty table is never a reason to remove anything.',
  '- The owner cannot afford more paid services. NO step may need a paid plan, a paid add-on or a larger paid machine (not Vercel\'s 16 GB build machine, not Observability Plus, not a paid monitoring service). Where a step assumed one, use the free way and say so.',
  '- The repo\'s own rules are in /home/user/kaizen-store/CLAUDE.md (read it once): commits go straight to main, which deploys; lint, the type check and the tests run before every push; a migration is never applied by hand and must keep running code working (add, never rename or drop in the same change); hot tables get indexes concurrently in a "-- kaizen:no-transaction" file; whatever is built for stores is built for the platform too; every decision gets a D-number row in docs/decisions.md; AGENTS.md says this Next.js differs from what you know, so the guides in node_modules/next/dist/docs/ decide.',
  '',
  'Where things are (all under ' + SCRATCH + '):',
  '- panel/plan.final.json: the plan (phases[].steps[]: id, title, what, closes, areas, effort, done_when, platform, owner_question), tolerated findings, owner_choices, ladders. panel/plan.exec.json, once it exists, is the same plan with the owner\'s answers written in (asked, decision): prefer it.',
  '- panel/card-<area>.final.json: each area\'s bar for an A (measures with today\'s value, target and how measured). panel/critic.json: the critic\'s decisions.',
  '- findings/<area-file>.json: every finding in full: where (file:line), evidence, fix_steps, tests_and_rules (what holds today\'s behaviour), depends_on, done_when, risk. digest/all-findings.json maps a finding id to its area file (field "key"). A step\'s "closes" lists finding ids; ids starting GAP- are gaps a challenger found, described in the card of that area (closed_shortfalls) and in critic.json.',
  '- m/: the measurements. The scripts that made them are in the repo at docs/audits/bloat-review-2026-11/scripts/.',
  '',
  'Rules for you: read-only in the repo (no edits, no git). Do not run builds, the type check, tests or servers; rg, wc, sed -n and node one-liners are fine. Do not query production or use the Supabase, Vercel or GitHub tools. Write only the files your task names. Plain English, short sentences, no filler.',
].join('\n')

const SUMMARY = {
  type: 'object',
  properties: {
    files_written: { type: 'number' },
    checker: { type: 'string', description: 'the checker\'s last output line' },
    notes: { type: 'string', description: 'three sentences at most: what was hard, what a step got wrong, what the owner should know' },
  },
  required: ['files_written', 'checker', 'notes'],
}

const stage = args && args.stage

if (stage === 'decide') {
  phase('Decide')
  const r = await agent(
    COMMON + '\n\nYOUR ROLE: write the owner\'s answers into the plan. The owner read the questions and said, in these words: "For the questions directed at me in the review. I trust your judgement to choose the recommended approach to each of them, with one exception that is down to cost. We can not change the vercel build engine, i can\'t afford it: Step 1.21. Pay for Vercel\'s 16 GB build machine, or build in CI and deploy the prebuilt output? ... Other than that, finalise the plan for execution. Do not start to execute it. A cheaper, though less capable model will do the actual work."\n' +
    'So every question is now answered, by this rule: (a) the option the step, its area\'s card or critic.json recommends or proposes; (b) where critic.json (what_stands_in_the_way) says an answer must be a yes for an area to reach an A, it is a yes; (c) where either answer reaches the bar, the one that costs less to build and to run and is easiest to reverse; (d) never an option that costs money. Step 1.21: the paid build machine is ruled out for good. First the two free source-map switches are measured, as the step says; if the peak does not come down to its bar, the build is made in CI and deployed prebuilt (vercel build, then vercel deploy --prebuilt). Open .github/workflows/ and docs/ci-migrations.md and docs/build-memory.md to write this truthfully: what the release job does today, what would change, how the health gate (scripts/await-deploy.mjs) and migrations-before-deploy keep working, and whether the CI runner has the memory (say what you found; if the repo is private and minutes are metered, say what a build would add in minutes, and keep it inside what CI already spends by reusing the build CI already makes).\n' +
    'Read ' + PANEL + '/plan.final.json whole, critic.json, and the card of each area a question touches. Then write ' + PANEL + '/plan.exec.json: a copy of plan.final.json in which\n' +
    '1. every step that has an owner_question gets "asked" (the question, unchanged), "decision" (the answer in one to three plain sentences: what is chosen, and why in a clause), and owner_question set to null. Rewrite that step\'s "what" and "done_when" so they describe the chosen way only, with no "if the owner says". Where a question had two halves, answer both. Keep ids, closes, areas and effort (change effort only if the decision changes the work, and say so in the decision).\n' +
    '2. every entry of owner_choices gets "decision" by the same rule. These are product choices no step depends on: the recommended answer is usually "leave as built", unless the entry itself proposes otherwise. If a decision needs work, name the step that carries it or add a small step at the end of the right phase (next free number, same shape, plus "added_why").\n' +
    '3. a decision that deletes or changes production data for good (dropping a schema or table, pruning rows by a retention period, removing the old site\'s tables) stays decided, but the step\'s "what" must say: take and verify a dump first, and show the owner the dump and the row counts before the destructive migration is pushed. For retention periods use the periods the privacy text or docs already state; open them and quote the file.\n' +
    '4. nothing else changes. Do not reword steps that had no question.\n' +
    'Also write ' + PANEL + '/decisions.md: a table for the owner, one row per question and per choice: step or finding, the question in a few words, the decision, what it changes for a person (owner, staff or shopper) if anything, and how to undo it. Mark with "TELL ME IF NOT" the three or four decisions the owner is most likely to want to overrule (anything a shopper or owner will see, anything that changes CLAUDE.md, anything that deletes data).\n' +
    'Check: ' + CHECK + ' plan must print OK. Return files_written (2), the checker\'s last line, and notes.',
    { label: 'decide', phase: 'Decide', schema: SUMMARY },
  )
  return r || { failed: true }
}

if (stage === 'brief') {
  phase('Brief')
  const chunks = (args && args.chunks) || []
  const out = await parallel(chunks.map((ids, i) => () => agent(
    COMMON + '\n\nYOUR ROLE: write the execution brief for each of these steps: ' + ids.join(', ') + '.\n' +
    'The reader of a brief is a cheaper, less capable coding model in a fresh session. It has the repo and CLAUDE.md, the brief, and nothing else: none of this review\'s context. It follows instructions well, but it does not notice what is unsaid, it does not know which shortcut is wrong, and it will not find a file from a vague description. So a brief names every file, says what to change in each in words exact enough to do without judgement, gives the commands that prove it, and says when to stop and hand back.\n' +
    'For each step: read it in ' + PANEL + '/plan.exec.json (plan.final.json if that does not exist yet). Read every finding it closes, in full, in findings/<area-file>.json (fix_steps, where, tests_and_rules, depends_on, risk, done_when). Then OPEN THE CODE as it is now (main has moved since the review: line numbers may be off, a file may have changed; trust the code) and check each fix against it: the file exists, the import or function is as described, the fix is possible as written. Correct what the finding got wrong and say so. Read the rule file CLAUDE.md points to for that part (docs/rules/...) and, for anything touching routing, caching, prefetch, the proxy, config or the build, the matching guide in node_modules/next/dist/docs/.\n' +
    'Write ' + EXEC + '/<step id>.json for each step (for example ' + EXEC + '/0.4.json), exactly this shape:\n' +
    '{"id": "0.4", "goal": one sentence: what is true when the step is done, "why": one or two sentences with the number today and the number after, "read_first": [repo-relative paths the executor must read before touching anything: the rule doc, the Next guide, the files it will change; at most 8], "depends_on": [{"id": a step id that must be done first, "why": a clause}] (only real order: this step builds on that one\'s file, script or migration; empty when none), "commits": [{"title": a commit title in the repo\'s style (plain sentence), "changes": [{"file": repo-relative path, "action": "edit"|"create"|"delete"|"move", "how": exactly what to do there: name the function, import, export, line of config or SQL; say what the new code does and what it must keep doing; for a move, where to}], "checks": [commands to run before this commit is pushed, each with what it must print or "exits 0"; always the narrowest test files first, then pnpm lint && pnpm typecheck && pnpm test, and pnpm test:int or pnpm build && pnpm test:e2e only when the change can affect them]}] (one commit per separately deployable change, small first; a step may be one commit or several, in order), "tests": [{"file": the test file to add or extend, "proves": what it fails on}] (the tests that hold the step\'s number from now on; empty only if a commit\'s checks already hold it), "migration": {"needed": boolean, "notes": if needed: generated or custom, which tables, hot-table rule, why running code keeps working, and that CI applies it}, "done_when": [{"check": a command, query or screen to look at, "expect": the exact result}] (the step\'s done_when turned into checks the executor can run; a number measured in a production build names the script and its arguments), "after_deploy": [what to read in production once the deploy is live, and the figure to expect; empty when nothing], "docs": [each doc line to write: the decision row in docs/decisions.md (say what it records), the rule file to correct, the row to set to Done in the plan\'s progress table, docs/platform-parity.md or psi-followups.md when touched], "do_not": [the wrong shortcuts: what must not be deleted, renamed, skipped or widened; what looks unused but is not], "stop_if": [conditions under which the executor stops and reports instead of going on: a check that does not give the expected figure, a file that is not as described, a test that must be changed to pass, anything destructive], "executor": "cheap" (mechanical, fully specified, a wrong edit is caught by the checks) | "cheap-then-review" (the cheap model can do it but a stronger one should read the diff before it is pushed: touches money, auth, checkout, caching rules, migrations on hot tables, or many files) | "strong" (needs design judgement the brief cannot remove: say what), "executor_why": one sentence, "checked_in_code": two to five sentences: what you opened, what matched, what you corrected in the finding or the step}.\n' +
    'Be concrete and complete rather than short: "how" may be several sentences. Never write "as appropriate", "where needed", "etc." or "similar files": list them (use rg to get the list, and give the rg command too when the list is long). If a step is too large to specify fully (an L step, a redesign), say so in executor "strong", and still write its commits as the sequence you would follow, with the first commit fully specified. If you find a step cannot work as written, write the brief for what does work and say it in checked_in_code.\n' +
    'Check as you go and at the end: ' + CHECK + ' briefs ' + ids.join(',') + ' must print OK; repair until it does. Return files_written, the checker\'s last line, and notes.',
    { label: 'brief:' + ids[0] + '-' + ids[ids.length - 1], phase: 'Brief', schema: SUMMARY },
  )))
  return out
}

return { error: 'pass args.stage: decide or brief (with args.chunks: arrays of step ids)' }
