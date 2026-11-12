export const meta = {
  name: 'bloat-grade-panel',
  description: 'Bloat review, final stage: set each area\'s bar for grade A, weave one plan that reaches it, challenge each bar',
  phases: [
    { title: 'Steward', detail: 'one steward per area: measures, the bar for an A, today\'s grade, work items' },
    { title: 'Weave', detail: 'one weaver merges all areas\' work into plan steps; every finding closed once' },
    { title: 'Challenge', detail: 'one challenger per area: is the bar truly an A, can the steps reach it' },
    { title: 'Critic', detail: 'one critic checks the grades are comparable across areas' },
  ],
}

const SCRATCH = '/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad'
const PANEL = SCRATCH + '/panel'
const CHECK = 'node ' + SCRATCH + '/state-tools/check-panel.mjs'

const AREAS = [
  { key: 'code', title: 'The code itself: unused, copied, packages, files', home: ['unused-code', 'copied-code', 'deps', 'assets', 'families'], also: [], note: 'deps and assets hold findings about what server functions load and carry (DP-1, DP-10, DP-11, DP-12, AS-1, AS-2 and the like): you own them, but mark each such work item as serving the "server" area. families holds true duplicates that the "surface" area also reads.' },
  { key: 'shopper-browser', title: 'What a shopper\'s browser gets', home: ['storefront-client', 'page-payload', 'prefetch'], also: ['client-bundles', 'css', 'page-model'], note: 'page-payload and prefetch also hold admin findings: you own them all, but mark admin ones as serving "owner-browser".' },
  { key: 'owner-browser', title: 'What an owner\'s browser gets in the admin', home: ['admin-client', 'client-bundles'], also: ['page-payload', 'prefetch', 'page-model', 'i18n'], note: 'client-bundles also holds storefront and public-site findings: you own them all, but mark those as serving "shopper-browser".' },
  { key: 'server', title: 'What the server loads and asks per request', home: ['storefront-data', 'admin-data', 'server-graph', 'functions', 'caching'], also: ['deps', 'assets', 'families', 'i18n', 'page-model'], note: 'The same import hubs were found by several reviewers (FM-2, DP-10, SG, SF, SD-1, DS-1, DP-1): name the overlaps in also_ids so the weaver can merge them.' },
  { key: 'scheduled', title: 'Scheduled and background work', home: ['cron'], also: ['db-queries', 'db-schema', 'features'], note: '' },
  { key: 'database', title: 'The database: its shape and how it is asked', home: ['db-queries', 'db-schema'], also: ['cron', 'page-model', 'caching'], note: '' },
  { key: 'ai', title: 'AI calls', home: ['ai-context'], also: ['features', 'admin-client'], note: '' },
  { key: 'surface', title: 'The product\'s surface: one of each, and what a feature costs a store that does not use it', home: ['features'], also: ['families', 'db-schema', 'cron'], note: 'The platform is not open, so use cannot be graded. Grade two things only: does a feature cost a store that does not use it (the reviewers measured: close to nothing, with named exceptions), and is anything built twice. Product choices are the owner\'s and are not waste: list them under owner_choices, never as work an A depends on.' },
  { key: 'rules', title: 'The written rules and the agents\' context', home: ['docs-context'], also: [], note: '' },
  { key: 'page-model', title: 'The page builder\'s model and a built page\'s render', home: ['page-model'], also: ['page-payload', 'storefront-data', 'db-queries', 'caching'], note: 'Several of your findings are the same fault other areas found (pages read whole: DQ-2, CA-3, SD-4, DS-4; the layout sent twice: SC-8; the owner filter: DQ-8, DS-7): name them in also_ids.' },
  { key: 'styles', title: 'Styles', home: ['css'], also: ['storefront-client', 'client-bundles'], note: '' },
  { key: 'text', title: 'Interface text', home: ['i18n'], also: ['families', 'admin-client', 'storefront-client'], note: '' },
  { key: 'build', title: 'Tests, CI and the build', home: ['tests-ci'], also: ['deps', 'assets'], note: '' },
]

const COMMON = [
  'You are on the final panel of a bloat review of Kaizena Flow (repo /home/user/kaizen-store: Next.js 16.4 App Router, React 19, Supabase Postgres, Vercel). 25 areas of the system were each read by an auditor, challenged by a skeptic and planned by a planner. Their verified findings (about 350) are on disk. The panel\'s job is the last step: turn them into ONE plan whose goal is grade A in every area.',
  '',
  'Two instructions from the owner bind everything:',
  '1. The platform is NOT open yet. The 60 stores are the team\'s own demo and test stores; it opens to real owners and shoppers imminently. An unused feature or an empty table is not a finding and never a reason to retire, park, hide or merge anything. What counts: what something costs per request, per cold start, per scheduled run, per AI call, per build or per agent session; what grows with stores, pages, products, orders or visits once it opens; and true duplicates. Before opening is the cheapest time for structural change.',
  '2. THE GOAL OF THE PLAN IS GRADE A IN EVERY AREA. The plan is done when every area is an A, not when its steps are ticked. Where the steps fall short of an A, the plan gets a step; the goal does not move.',
  '',
  'The grades mean the same in every area:',
  '- A: nothing in the area is loaded, fetched, run or shown without need, beyond a small tolerance that is stated in numbers, AND a test or a production figure holds each measure so it cannot slip back unseen. An A is what a strict senior engineer who knows this stack would call excellent, not merely "the findings are closed".',
  '- B: the large causes are gone and budgets exist; small findings remain.',
  '- C: a sound base with real waste; some of it is held, most is not.',
  '- D: every page, function or run carries far more than its job needs, and nothing holds it.',
  '- E: waste that hurts people or costs money today.',
  '',
  'Where things are (all under ' + SCRATCH + '):',
  '- digest/<area-file>.md: a compact digest of one audited area: headline, measures, what is well made, and every finding with id, priority (P0 do first, small and safe; P1 large saving, more work; P2 when next touched; P3 true but not worth doing now), effort, kind, verdict, evidence, the first fix step, done-when, saving, what it comes after. digest/INDEX.txt lists them.',
  '- findings/<area-file>.json: the same in full (all fix steps, the tests and rules that hold today\'s behaviour, risk). Open it when the digest is not enough.',
  '- m/: the measurements (routes.md: 32 pages in a browser; loaded.md and chunks.md: what each route loads; prod-db-stats.md: production\'s statistics; spike1-analyze.log; build.log). The scripts that made them are in the repo at docs/audits/bloat-review-2026-11/scripts/.',
  '- The repo holds a first DRAFT of the review, docs/audits/bloat-review-2026-11.md, written before the second reviewers ran. Its section 1 has draft bars for an A and its section 5 a draft plan. Both are superseded by what the panel decides: use them as a starting point, overrule them freely, and do not edit them.',
  '',
  'Rules: read-only in the repo (no edits, no git). Do not run builds, the type check, tests or servers; small rg, wc and node one-liners are fine. Do not query production or use the Supabase, Vercel or GitHub tools. Write only the file your task names. Plain English, short sentences, no filler: the owner reads this.',
].join('\n')

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    file: { type: 'string' },
    checker: { type: 'string', description: 'the checker\'s last output line' },
    grade_today: { type: 'string' },
    one_line: { type: 'string', description: 'the area in one sentence, with its most telling number' },
    reaches_a: { type: 'string', description: 'yes, or what is missing, in a sentence' },
  },
  required: ['area', 'file', 'checker', 'grade_today', 'one_line', 'reaches_a'],
}

const stage = args && args.stage
const keys = args && Array.isArray(args.areas) ? args.areas : AREAS.map((a) => a.key)
const chosen = keys.map((k) => AREAS.find((a) => a.key === k)).filter(Boolean)

if (stage === 'steward') {
  phase('Steward')
  const out = await parallel(chosen.map((a) => () => agent(
    COMMON + '\n\nYOUR ROLE: the steward of one area of the scorecard.\nAREA "' + a.key + '": ' + a.title + '.\nYou OWN the findings of these audited areas (digest and findings files of the same names): ' + a.home.join(', ') + '. Every one of their findings must end up in exactly one place: a work item, the tolerated list, or the owner\'s choices.\n' + (a.also.length ? 'READ ALSO, without owning them: ' + a.also.join(', ') + ' (their findings may be the same fault as yours, or may move your measures).\n' : '') + (a.note ? 'Note: ' + a.note + '\n' : '') +
    '\nDo this, in order:\n' +
    '1. Read your digests whole, then the related ones. Open a findings JSON or the code where a number or a claim needs checking.\n' +
    '2. MEASURES: choose 3 to 8 measures that together say whether this area is an A. Each has a name, today\'s value with its source, the target for an A, how it is measured (a script in docs/audits/bloat-review-2026-11/scripts, a production query, a test, a file\'s size: something that exists or that a named work item creates), and why that target is an A and not a B (what the floor is: what cannot be removed, such as the framework\'s own size, and what tolerance you allow above it). Do not set a bar the findings happen to reach; set the bar a strict expert would, then see whether the findings reach it.\n' +
    '3. GRADE TODAY, A to E by the scale above, with the reasons in two or three sentences. Be strict and fair: the first draft graded on unverified numbers.\n' +
    '4. WORK ITEMS: group your findings into work items, each a change one engineer could make in one go. Each has a title, finding_ids (yours), also_ids (ids from areas you only read that are the same fault), phase (now: small and safe, to do before the platform opens; next: larger or riskier; later: when the area is next touched), effort (S under a day, M a few days, L a week or more), done_when (one measurable check, taken from the planners where they gave one), moves (which measure it moves and to what value), serves (the area key it mostly serves, if not yours), and owner_decision.\n' +
    '5. TOLERATED: findings an A can live with (the planners\' P3 and any other you judge so), each with the reason. This is the stated tolerance: keep it short and honest.\n' +
    '6. OWNER\'S CHOICES: findings that are a product choice, not waste, each as a question the owner can answer in a line.\n' +
    '7. GAPS: with real effort in the code and the measurements, find up to three things an A in this area needs that no finding covers (for example a measure with no budget, a page nobody measured, a cost that will appear only at opening). Each needs evidence you opened and a proposed work item. None is a fine answer.\n' +
    '8. LADDER: the grade after the "now" items, after "next", after "later". If "later" is not an A, your gaps must say what is missing.\n' +
    '\nWrite the result as JSON to ' + PANEL + '/steward-' + a.key + '.json with exactly this shape: {"area": "' + a.key + '", "title": string, "grade_today": "A|B|C|D|E", "grade_reasons": string, "measures": [{"name","today","target_a","how_measured","why_this_is_a"}], "work_items": [{"title","finding_ids":[string],"also_ids":[string],"phase":"now|next|later","effort":"S|M|L","done_when","moves","serves","owner_decision":boolean}], "tolerated": [{"finding_id","why"}], "owner_choices": [{"finding_ids":[string],"question"}], "gaps": [{"title","evidence","proposed_work_item"}], "ladder": {"after_now","after_next","after_later"}}. Then run: ' + CHECK + ' steward ' + PANEL + '/steward-' + a.key + '.json and repair the file until it prints OK (it lists any finding of yours that is in no place, or in two).\nReturn the short summary the schema asks for.',
    { label: 'steward:' + a.key, phase: 'Steward', schema: SUMMARY_SCHEMA },
  )))
  return out.map((r, i) => r || { area: chosen[i].key, failed: true })
}

if (stage === 'weave') {
  phase('Weave')
  const r = await agent(
    COMMON + '\n\nYOUR ROLE: the weaver. Thirteen stewards have each written a file ' + PANEL + '/steward-<area>.json (areas: ' + AREAS.map((a) => a.key).join(', ') + '): the area\'s measures and bar for an A, today\'s grade, work items (with the findings each closes, also_ids naming the same fault in other areas, a phase, a done-when), tolerated findings, the owner\'s choices, and gaps.\n' +
    '\nWeave them into ONE plan, written to ' + PANEL + '/plan.json:\n' +
    '1. Read ' + PANEL + '/stewards-compact.md whole: it holds every area\'s measures and bar, and all 248 work items (ids W-<area>-<n>) with the findings each closes, the same fault elsewhere (also), its phase, done-when and what it moves, plus the tolerated findings, the owner\'s choices and the gaps (GAP-<area>-<n>). Read ' + PANEL + '/clusters.md: a script\'s first grouping of work items that name the same findings (a hint: its largest group is many steps that only touch). Open a steward\'s full file, a digest or a findings file when you need more. digest/all-findings.json lists every finding id with its area and priority.\n' +
    '2. MERGE work items that are the same change: the stewards flag overlaps with also_ids, and the same fault often has four or five ids (for example reading every published page whole; the layout sent twice; the import hubs; the owner filter that no index can serve; the scheduler\'s routes). One step closes all of them. Do not merge things that only sound alike.\n' +
    '3. ORDER the steps into phases. Phase 0 "Before the doors open": small and safe changes with the largest effect, and anything that is cheaper before real data exists; no step depends on another where avoidable. Phase 1 "Budgets, so it stays removed": every check, ratchet and budget (an A needs each measure held). Phase 2 "Load on demand": the structural work. Phase 3 "One of each": true duplicates, and the gates that make cost follow use. Phase 4 "Tidy": small things done when an area is next touched. Number steps by phase (0.1, 0.2, ... 1.1, ...). Aim for about 60 to 85 steps: a step is one coherent change that one engineer makes in one go, not one finding and not a whole theme. Give each step the stewards\' work-item ids it came from in a field "from" (an array of W- ids), so the merge can be checked.\n' +
    '4. Each step: id, title (an instruction, as "Read one page, not all of them"), what (two to five short sentences naming the files or mechanism and the key numbers, written for an engineer with this repo and no other context), closes (every finding id it closes), areas (the area keys whose measures it moves), effort, done_when (one measurable check that names a script, a query, a test or a file), platform (one sentence: what the step means for /admin/platform and Kaizena Flow\'s own site, by the house rule in CLAUDE.md that the platform gets what stores get), owner_question (null, or the question the owner must answer first).\n' +
    '5. The stewards\' GAPS become steps too where they are needed for an A: give each gap an id GAP-<area>-<n> and put it in a step\'s closes.\n' +
    '6. tolerated: every finding the stewards tolerated, with the reason. owner_choices: the owner\'s product choices as questions, each with its finding ids and areas. A finding is in exactly one place: one step, or tolerated, or an owner\'s choice.\n' +
    '7. ladders: for each area, to_b (the step ids after which it is a B) and to_a (the further step ids after which it is an A). Use the stewards\' ladders and measures; every area must reach an A, and if the stewards\' items cannot get one there, add the step that does and say so in its "what".\n' +
    '\nShape: {"phases": [{"n": 0, "title", "goal", "notice" (what a person will notice when the phase is done), "steps": [{"id","title","what","closes":[string],"from":[string],"areas":[string],"effort":"S|M|L","done_when","platform","owner_question"}]}], "tolerated": [{"finding_id","why"}], "owner_choices": [{"finding_ids":[string],"question","areas":[string]}], "ladders": {"<area>": {"to_b":[step ids],"to_a":[step ids]}}}. Then run: ' + CHECK + ' plan ' + PANEL + '/plan.json and repair until it prints OK: it lists every finding that is in no place or in two, every unknown id and every ladder that names a missing step. Work in passes if the file is large: write it, check it, fix what the checker lists.\nReturn the summary: area "plan", the file, the checker\'s last line, grade_today "-", one_line (the number of steps per phase), reaches_a (yes, or which area still falls short).',
    { label: 'weave', phase: 'Weave', schema: SUMMARY_SCHEMA },
  )
  return r || { failed: true }
}

if (stage === 'weave-review') {
  phase('Weave')
  const r = await agent(
    COMMON + '\n\nYOUR ROLE: the reviewer of the woven plan. The weaver merged the thirteen stewards\' 248 work items (' + PANEL + '/stewards-compact.md; pre-grouping in ' + PANEL + '/clusters.md) into the plan ' + PANEL + '/plan.json: steps by phase, each with the findings it closes, the work items it came from, the areas it serves, a done-when; tolerated findings; the owner\'s choices; ladders per area.\n' +
    'Review it as someone who must carry it out, and FIX what is wrong in the file itself:\n' +
    '1. MERGES. For each step with three or more work items behind it: are they truly one change by one engineer in one go? Split a step that is several changes (different files, different risks, different phases). Find pairs of steps that are the same change in two areas and join them. Check the largest group in clusters.md was split sensibly.\n' +
    '2. PHASES. Phase 0 holds only small, safe changes (and what is cheaper before real data exists); move out anything that restructures routes, changes what a shopper sees, or needs the owner\'s answer first. Every check, ratchet and budget is in phase 1 and names the measure it holds. Nothing in phase 0 or 1 waits for a step in a later phase.\n' +
    '3. EACH STEP: the "what" names real files or mechanisms (spot-check at least fifteen steps against the code with rg) and reads as plain short sentences; done_when is one measurable check that proves the step (a script, a query, a test, a file\'s size), not "the finding is fixed"; effort is honest; platform is one true sentence; owner_question is set wherever the owner must choose first.\n' +
    '4. NOTHING LOST: every gap the stewards named (GAP-<area>-<n>) is closed by a step or stated as dropped with the reason in a top-level field "dropped_gaps"; every finding is in exactly one place.\n' +
    '5. LADDERS: for each area, after its to_b steps and its to_a steps, do the stewards\' measures reach the bar? Add the missing step ids, or the missing step.\n' +
    'Keep the shape of the file and the checker passing: after your edits run ' + CHECK + ' plan ' + PANEL + '/plan.json until it prints OK. Write a short log of what you changed to ' + PANEL + '/weave-review.md (splits, joins, moves between phases, steps added, done-whens rewritten).\nReturn the summary: area "plan-review", the file, the checker\'s last line, grade_today "-", one_line (how many splits, joins, moves and additions), reaches_a (yes, or which area still falls short).',
    { label: 'weave-review', phase: 'Weave', schema: SUMMARY_SCHEMA },
  )
  return r || { failed: true }
}

if (stage === 'challenge') {
  phase('Challenge')
  const out = await parallel(chosen.map((a) => () => agent(
    COMMON + '\n\nYOUR ROLE: the challenger for the area "' + a.key + '": ' + a.title + '.\nThe steward\'s file is ' + PANEL + '/steward-' + a.key + '.json (measures, the bar for an A, today\'s grade, work items). The woven plan is ' + PANEL + '/plan.json (steps by phase, each with the areas it serves; ladders per area). The audited areas behind this one: ' + a.home.concat(a.also).join(', ') + '.\n' +
    '\nChallenge it on four points, with the code and the measurements open, and default to doubt:\n' +
    '1. IS THE BAR TRULY AN A? For each measure: is the target what a strict senior engineer who knows Next.js, Postgres and Vercel would call excellent for this kind of product, or just what the findings reach? Check the floor the steward claims (measure it where you can: the framework\'s size in m/loaded.md, the lean route in m/chunks.md, a number in the digest). Tighten a target that is lenient; loosen one that cannot be reached without harm (say what harm). Is a measure missing that an A plainly needs? Is one not measurable as written (does the script, query or test exist, or does a named step create it)?\n' +
    '2. IS TODAY\'S GRADE RIGHT by the common scale? Compare the reasons with the verified findings, not the first draft.\n' +
    '3. CAN THE PLAN\'S STEPS REACH THE BAR? Take each measure from today\'s value to the target using only steps in the plan that serve this area, with the savings the findings state (verified numbers over estimates). Do the sums. Where the steps stop short, say by how much and propose the step that closes the distance (title, what, done_when). Where a step\'s done_when is weaker than the bar, say so.\n' +
    '4. THE LADDER: the grade after phase 0, after phase 1, after phase 2 and after all phases, by the scale. An A needs both the value and a check that holds it, so an area cannot be an A before its budget step.\n' +
    '\nWrite the final card as JSON to ' + PANEL + '/card-' + a.key + '.json: {"area": "' + a.key + '", "title": string, "grade_today": "A|B|C|D|E", "grade_reasons": string (two or three sentences), "verdict_on_bar": string (what you kept, tightened, loosened, added, and why), "measures": [{"name","today","target_a","how_measured"}] (the FINAL bar, 3 to 8 measures), "bar_in_a_sentence": string (the bar as one or two plain sentences an owner can read), "steps_to_a": [step ids from the plan, in order], "can_the_steps_reach_a": string (yes with the sums in brief, or no with the distance), "shortfalls": [{"what","proposed_step_title","proposed_step_what","proposed_done_when"}], "ladder": {"after_phase_0","after_phase_1","after_phase_2","after_all"}, "tolerated": [string] (what an A lives with here, in plain words), "owner_choices": [string]}. Then run: ' + CHECK + ' card ' + PANEL + '/card-' + a.key + '.json and repair until OK.\nReturn the short summary the schema asks for (reaches_a: yes, or the shortfall in a sentence).',
    { label: 'challenge:' + a.key, phase: 'Challenge', schema: SUMMARY_SCHEMA },
  )))
  return out.map((r, i) => r || { area: chosen[i].key, failed: true })
}

if (stage === 'critic') {
  phase('Critic')
  const r = await agent(
    COMMON + '\n\nYOUR ROLE: the critic across areas. The thirteen final cards are ' + PANEL + '/card-<area>.json (areas: ' + AREAS.map((a) => a.key).join(', ') + ') and the plan is ' + PANEL + '/plan.json.\n' +
    'Read all of them. Then judge:\n1. ARE THE GRADES COMPARABLE? Rank the areas by how much waste each really carries today (use the measures) and see whether the grades follow the ranking. Name any area graded harder or softer than its neighbours and give the grade it should have.\n2. ARE THE BARS EQUALLY STRICT? Name any area whose A would be only a B by another area\'s standard, and say what its bar should be.\n3. SHORTFALLS: list every shortfall the challengers found, and for each say whether the proposed step should join the plan (which phase, after which step) or the bar should move, and why.\n4. THE PLAN AS A WHOLE: any step that is two steps, any two that are one, any phase 0 step that is not small and safe, any step whose done_when does not prove what it claims. Is every area an A when all steps are done? If not, what is missing.\n' +
    'Write ' + PANEL + '/critic.json: {"grade_changes": [{"area","from","to","why"}], "bar_changes": [{"area","measure","from","to","why"}], "steps_to_add": [{"phase": number, "after": step id or "", "title","what","closes":[string],"areas":[string],"effort","done_when","platform"}], "step_changes": [{"id","change","why"}], "all_areas_reach_a": boolean, "what_is_missing": string, "summary": string (five sentences for the owner)}. Check it parses with node -e.\nReturn the summary: area "critic", the file, checker "parsed", grade_today "-", one_line (the number of changes of each kind), reaches_a (yes, or what is missing).',
    { label: 'critic', phase: 'Critic', schema: SUMMARY_SCHEMA },
  )
  return r || { failed: true }
}

if (stage === 'finish') {
  // The critic, then the amender who applies what the critic and the challengers found, in one run.
  phase('Critic')
  const critic = await agent(
    COMMON + '\n\nYOUR ROLE: the critic across areas. The thirteen final cards are ' + PANEL + '/card-<area>.json (areas: ' + AREAS.map((a) => a.key).join(', ') + '): each has the area\'s final bar (measures with today\'s value, the target for an A and how it is measured), today\'s grade with reasons, a verdict on the bar, whether the plan\'s steps reach an A, a ladder by phase, and SHORTFALLS (what the plan lacks for an A, each with a proposed step or a tighter done-when). The plan is ' + PANEL + '/plan.json (134 steps in five phases, reviewed once; ' + PANEL + '/weave-review.md says what that review changed).\n' +
    'Read all thirteen cards whole and the plan\'s step list. Then judge, and decide:\n1. ARE THE GRADES COMPARABLE? Rank the areas by how much waste each really carries today (use the measures) and see whether today\'s grades follow the ranking. Name any area graded harder or softer than its neighbours, with the grade it should have. Three D and ten C stand now.\n2. ARE THE BARS EQUALLY STRICT? Name any area whose A would be only a B by another area\'s standard, or whose bar asks for more than an A needs, and say what its measure should be.\n3. EVERY SHORTFALL (there are about 73): decide one of: ADD (a new step: say the phase), TIGHTEN (change the done-when or the text of a named existing step), MERGE (it is the same as another area\'s shortfall: name it; the same gap is often raised by two or three cards), MOVE THE BAR (the bar asks too much: say the new target and why an A is still an A), or DROP (not needed for an A: why). Be strict about duplicates and about steps that only restate a done-when. The goal does not move: after your decisions every area must reach an A by the end of the plan, or you say exactly what stands in the way (an owner\'s answer counts: name the question).\n4. THE PLAN AS A WHOLE: any step that is two steps, any two that are one, any phase 0 step that is not small and safe, any step whose done-when does not prove what it claims. Keep this short: the plan was reviewed once.\n' +
    'Write ' + PANEL + '/critic.json: {"grade_changes": [{"area","from","to","why"}], "bar_changes": [{"area","measure","from","to","why"}], "shortfall_decisions": [{"area","shortfall" (its first words),"decision":"add|tighten|merge|move_bar|drop","detail" (for add: phase and where; for tighten: the step id and the new done-when; for merge: the area and shortfall it merges into; for move_bar: the new target; for drop: why)}], "step_changes": [{"id","change","why"}], "all_areas_reach_a": boolean, "what_stands_in_the_way": string, "summary": string (five plain sentences for the owner)}. Every shortfall of every card has one decision. Check the file parses: node -e "JSON.parse(require(\'fs\').readFileSync(\'' + PANEL + '/critic.json\',\'utf8\'))".\nReturn the summary: area "critic", the file, checker "parsed", grade_today "-", one_line (how many of each decision, and grade changes), reaches_a (yes, or what stands in the way).',
    { label: 'critic', phase: 'Critic', schema: SUMMARY_SCHEMA },
  )
  if (!critic) return { failed: 'critic' }
  const amend = await agent(
    COMMON + '\n\nYOUR ROLE: the amender. You apply what the panel decided, so that the plan as written reaches grade A in every area. Inputs under ' + PANEL + ': plan.json (134 steps in five phases; do NOT edit it), the thirteen card-<area>.json (do NOT edit them), and critic.json (grade changes, bar changes, one decision per shortfall: add, tighten, merge, move_bar or drop, and a few step changes).\n' +
    'Write NEW files, never the old ones, so that a cut-off leaves nothing half-done: ' + PANEL + '/plan.final.json and ' + PANEL + '/card-<area>.final.json for each of the thirteen areas.\n' +
    '1. plan.final.json starts as a copy of plan.json. Keep every existing step id as it is (other files name them). For each ADD decision write a new step at the end of its phase with the next free number in that phase (if phase 0 ends at 0.42, the first new one is 0.43), in the same shape as the others: id, title (an instruction), what (two to five short plain sentences naming the files or mechanism and the numbers; open the code to get them right), closes (one id per shortfall it closes, written GAP-<area>-s<n>, n counting that card\'s shortfalls from 1; merged shortfalls go in the same step), from (empty array), areas, effort, done_when (one measurable check that proves the bar\'s number, naming a script, a query, a test or a file), platform (one true sentence), owner_question (null, or the question). A new step in phase 0 must be small and safe and ask the owner nothing. For each TIGHTEN decision rewrite that step\'s done_when (and its text where needed) so it proves the bar; add the GAP id to its closes. Apply the critic\'s step_changes. Update "ladders" so each area\'s to_b and to_a list the steps, new ones included, after which its measures reach the bar.\n' +
    '2. Each card-<area>.final.json starts as a copy of its card. Apply the critic\'s grade_changes and bar_changes (a moved bar changes that measure\'s target_a, and bar_in_a_sentence if it names it). Set steps_to_a to the steps of plan.final.json that take the area to an A, in order. Set the ladder: after_phase_0, after_phase_1, after_phase_2 and after_all by the common scale, counting the amended plan. after_all must be A; if an owner\'s answer is needed on the way, it is still A, and can_the_steps_reach_a says which step waits for which answer. If something other than an owner\'s answer still stands in the way, do not write A: say exactly what in can_the_steps_reach_a. Replace "shortfalls" with an empty array once each is closed by a step, tightened, merged, moved or dropped, and put one line per shortfall in a new field "closed_shortfalls" (what it was, and the step id or the decision that settled it). Rewrite can_the_steps_reach_a in two or three plain sentences for the owner.\n' +
    '3. Check: ' + CHECK + ' plan ' + PANEL + '/plan.final.json must print OK (every finding in exactly one place; ladders name real steps); and for each area ' + CHECK + ' card ' + PANEL + '/card-<area>.final.json must print OK (its steps_to_a must be steps of plan.final.json: the checker reads plan.final.json when it exists). Repair until all fourteen print OK.\n' +
    '4. Write ' + PANEL + '/amend-log.md: how many steps were added per phase, how many done-whens tightened, what was merged, moved or dropped, any grade or bar changed, the final step count per phase, and for each area its grade today and its ladder. Say plainly if any area does not end at an A, and why.\n' +
    'Return the summary: area "amend", the file ' + PANEL + '/plan.final.json, the checker\'s last line for the plan, grade_today "-", one_line (steps per phase now, steps added, done-whens tightened), reaches_a (yes for all thirteen, or which area does not and why).',
    { label: 'amend', phase: 'Critic', schema: SUMMARY_SCHEMA },
  )
  return { critic, amend: amend || { failed: 'amend' } }
}

return { error: 'pass args.stage: steward, weave, weave-review, challenge, critic or finish' }
