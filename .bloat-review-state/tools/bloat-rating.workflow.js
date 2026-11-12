export const meta = {
  name: 'bloat-brief-ratings',
  description: 'Bloat plan: re-rate who can carry out each of the 151 step briefs, blind to the first rating, then settle disagreements',
  phases: [
    { title: 'Rate', detail: 'eight reviewers each rate about 19 briefs without seeing the first rating' },
    { title: 'Settle', detail: 'one judge reads both ratings and reasons where they differ and decides' },
  ],
}

const SCRATCH = '/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad'

const SCALE = [
  'The plan is carried out by a CHEAPER, LESS CAPABLE coding model (think a small fast model) in a fresh session with the repo, its CLAUDE.md and the one brief. It follows explicit instructions well. It does not notice what is unsaid, does not know which shortcut is wrong, misreads code it has not been pointed at, and tends to "make the test pass" when stuck. A STRONGER model is available but costs much more, so the owner wants as much as safely possible done by the cheap one. Every push goes straight to main, which deploys to production (the platform is not open to real users yet, but will be soon).',
  '',
  'Ratings:',
  '- "cheap": the cheap model can do the step alone. Every change is named precisely enough to need no design choice; the checks in the brief would catch a wrong edit before the push (a test, the type check, a count that must match); a mistake that slips through is easy to see and to revert, and touches no money, sign-in, permissions, personal data, checkout, payments, migrations on hot tables or production data.',
  '- "cheap-then-review": the cheap model can do it, but a stronger model (or the owner) must read the diff before the push, because a wrong edit could pass the checks and do harm: money, sign-in, permissions, checkout, caching rules (a stale or leaked page), a migration, many files at once, or a check that is weak for this change.',
  '- "strong": the brief cannot remove a design choice or a judgement (which of several ways, what to keep, how to split, reading measurements to decide the next cut), or the work is too large or too entangled to specify file by file. Name the choice.',
  '',
  'Be calibrated, not cautious by reflex. Do not rate "review" just because production is involved: say what a wrong edit would do that the checks miss. Do not rate "strong" because a step is long: long and fully specified is cheap or review. Do rate up when the brief itself leaves a choice ("decide", "if needed", "pick", "measure then cut") or names files that earlier steps create without saying exactly what they will contain.',
  'Also judge the brief: could a small change to it (named exactly) make the step one level cheaper? For a "strong" step, are its first commits cheap on their own (the plan can then hand only the rest to the stronger model)?',
].join('\n')

const RATING_SCHEMA = {
  type: 'object',
  properties: {
    written: { type: 'number' },
    notes: { type: 'string', description: 'three sentences at most: patterns across your briefs' },
  },
  required: ['written', 'notes'],
}

const stage = args && args.stage

if (stage === 'rate') {
  phase('Rate')
  const chunks = args.chunks
  const out = await parallel(chunks.map((ids) => () => agent(
    SCALE + '\n\nYOUR TASK: rate these step briefs: ' + ids.join(', ') + '. Each is ' + SCRATCH + '/exec-blind/<id>.json (for example ' + SCRATCH + '/exec-blind/0.4.json). Its rating was removed on purpose: judge it fresh.\n' +
    'For each brief: read it whole. Open the repo files its first commit changes (repo /home/user/kaizen-store; read-only: no edits, no git, no builds or tests; rg, sed -n, wc are fine) enough to judge whether the "how" is precise against the code as it is and whether the checks would catch a wrong edit. Do not rewrite the brief.\n' +
    'Write ' + SCRATCH + '/rating/<id>.json for each, exactly: {"id", "rating": "cheap"|"cheap-then-review"|"strong", "why": two or three sentences naming the concrete risk or the concrete choice, "harm_if_wrong": one sentence (what a wrong edit that passes the checks would do), "cheap_commits": [the 1-based numbers of the commits the cheap model could do alone, even if the step as a whole is rated higher], "make_it_cheaper": one sentence naming the exact change to the brief that would lower the rating a level, or "" when none would, "brief_problems": [short strings: anything in the brief that is wrong against the code or would mislead the cheap model; empty if none]}. Check each file parses with node -e.\n' +
    'Return written (how many files) and notes.',
    { label: 'rate:' + ids[0] + '-' + ids[ids.length - 1], phase: 'Rate', schema: RATING_SCHEMA },
  )))
  return out
}

if (stage === 'settle') {
  phase('Settle')
  const r = await agent(
    SCALE + '\n\nYOUR TASK: settle the ratings where two reviewers disagreed. ' + SCRATCH + '/work/rating-diff.json lists them: for each step id, the first rating with its reason (from the brief\'s writer, who had opened all the code for the step) and the second (a blind reviewer\'s, with harm_if_wrong, cheap_commits, make_it_cheaper and brief_problems). The full brief is ' + SCRATCH + '/exec/<id>.json. Read both reasons and the brief (open repo files when the two disagree on a fact; read-only).\n' +
    'Decide each: the final rating, and the commits the cheap model may do alone. Where make_it_cheaper is a real, small, exact change, say so (the brief will be edited). Where brief_problems name a real error, keep it; where it is wrong, drop it.\n' +
    'Write ' + SCRATCH + '/work/rating-final.json: {"decisions": [{"id","first","second","final","cheap_commits":[numbers],"why": one or two sentences,"edit_brief": exact change to make to the brief, or "","brief_problems":[kept ones]}], "summary": four plain sentences for the owner: how the ratings moved and what pattern explains it}. Check it parses. Return written 1 and notes.',
    { label: 'settle', phase: 'Settle', schema: RATING_SCHEMA },
  )
  return r || { failed: true }
}

return { error: 'pass args.stage: rate (with args.chunks) or settle' }
