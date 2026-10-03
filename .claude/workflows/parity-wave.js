export const meta = {
  name: 'parity-wave',
  description: 'Run one wave of the Shopify parity plan: spec, foundation, server, surfaces, gates, adversarial review, fix, re-rate the tracker rows. Args: { wave, title, spec, rowIds, surfaces?, lenses? }',
  whenToUse: 'Starting a feature of docs/parity-plan.md section 3 that closes rows of docs/parity/rows. Same shape as D153 (withdrawals and returns). See docs/parity/WAVES.md.',
  phases: [
    { title: 'Spec', detail: 'contract doc from the rows, plan and CLAUDE.md; stops when a row needs a decision' },
    { title: 'Foundation', detail: 'schema, migrations, DB rules, pure libs, registries' },
    { title: 'Surfaces', detail: 'server first, then shopper, admin and analytics/AI in parallel' },
    { title: 'Gates', detail: 'lint, typecheck, unit, int on a fresh DB, db:check, build, e2e' },
    { title: 'Review', detail: 'adversarial lenses, findings reproduced before reporting' },
    { title: 'Fix', detail: 'confirmed findings with a regression test each' },
    { title: 'Re-rate', detail: 'rows updated from code and tests, then a skeptic, then pnpm parity:write' },
  ],
}

// ---------------------------------------------------------------- args

if (!args || typeof args !== 'object') {
  throw new Error('parity-wave needs args: { wave: number, title: string, spec: string, rowIds: string[], surfaces?: [{key, prompt}], lenses?: [{key, prompt}] }')
}
const WAVE = Number(args.wave)
const TITLE = String(args.title || '').trim()
const SPEC = String(args.spec || '').trim()
const ROW_IDS = Array.isArray(args.rowIds)
  ? args.rowIds.map(String)
  : typeof args.rowIds === 'string'
    ? args.rowIds.split(',').map(s => s.trim()).filter(Boolean)
    : []
if (!Number.isInteger(WAVE) || WAVE < 0 || WAVE > 9) throw new Error('args.wave must be an integer 0..9 (docs/parity-plan.md section 3)')
if (!TITLE) throw new Error('args.title is required')
if (!/^docs\/[A-Za-z0-9._\/-]+\.md$/.test(SPEC)) throw new Error('args.spec must be a docs/*.md path, e.g. docs/vat.md')
if (!ROW_IDS.length) throw new Error('args.rowIds must list the tracker rows this run closes (ids from docs/parity/rows/*.json)')

const DB = 'w' + WAVE + '_' + (SPEC.replace(/^docs\//, '').replace(/\.md$/, '').replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 24))

const SURFACES = Array.isArray(args.surfaces) && args.surfaces.length
  ? args.surfaces
  : [
    {
      key: 'shopper',
      prompt: 'the SHOPPER side: storefront pages and routes under /s/{store}/{market}, checkout and cart parts, the order page and My account, shopper emails, footer or entry-point links, structured data. Everything the spec says a shopper sees or does, and nothing it does not. Texts in src/lib/i18n.ts and src/lib/email-text.ts (nb, sv, da, en by hand, English fallback; other languages come from the catalogue, so check the ui-catalog tests and CHOOSING). Links with marketPath()/storeBase(). Server actions are thin and call the server modules and resolve the shop with resolveShop(). No cookie or storage unless it is in KNOWN_COOKIES with its category. renderToString tests for presentational components and an e2e spec in e2e/ for the main path (you write it; the Gates agent runs it). Accessibility: labelled fields, focus on step change, errors announced. A page that must not be indexed is noindex and out of the sitemap and llms.txt. If the spec has nothing for shoppers, build nothing and say so.',
    },
    {
      key: 'admin',
      prompt: 'the ADMIN side: pages under /admin/{store} (or /admin/platform or /admin/account when the spec says so), written in the admin tokens of CLAUDE.md "The admin\'s look", never a full-width max-w-*xl root, with loading.tsx. Every page and server action checks requireMember(storeSlug) (or the platform or owner check) itself; actions take the store slug as a bound first argument and call updateTag/refresh like their neighbours; owner-only forms are enforced in the action. Navigation: the right section of src/lib/store-nav.ts (or platform-nav.ts, owner-nav.ts) and an ADMIN_PAGES entry in src/lib/admin-map.ts (their tests must pass; update the expected lists). Store Home or control-center attention when something needs a person. New translatable texts go in the store translation worklist (src/lib/store-translate.ts). The admin is English only. Settings pages that save set audit_log entries. renderToString tests for the views. If the spec has no admin work, build nothing and say so.',
    },
    {
      key: 'analytics-and-ai',
      prompt: 'ANALYTICS, AI and STRUCTURED DATA: (1) analytics per docs/analytics.md: define each new figure in that doc first, implement it once, amounts in the store main currency without VAT, copied and host orders excluded, a data table behind every chart, minimum volumes, a figure that cannot be known is shown as what is missing and never as zero; unit tests and int tests, including a store with no data. (2) the AI manager: owner tools in src/lib/owner-tools.ts with HANDLERS in src/server/owner-tools.ts, a line in TOOL_WORDS, skills in src/lib/assistant-skills.ts, a gate (send, public, spend) for anything that emails, changes a live site or costs money; answers from the site\'s own data with amounts through formatMoney and sums in code; platform tools only when the spec says so. (3) structured data and the chat agent where the spec has facts they should state, from the site\'s data and never from the model. (4) the plan comparison (D132, plan_features) when the feature belongs in a plan. AI features stay grounded and have a no-AI fallback; AI copy for customers passes findClaims(). If the spec has nothing here, build nothing and say so.',
    },
  ]

const LENSES = Array.isArray(args.lenses) && args.lenses.length
  ? args.lenses
  : [
    {
      key: 'law',
      prompt: 'LAW AND BEHAVIOUR. Compare the implementation to the spec and to the law or standard the spec cites (EU directives and regulations, Norwegian and Nordic rules, VAT rules, GDPR, accessibility, consumer law; use web search with standard mode to confirm article numbers and wording, preferring official sources). Read every consumer-facing text in nb, sv, da and en for wrong or risky legal claims, and check that each is flagged for human review in the spec and that none claims to be legal advice. Check that every acceptance criterion of the rows really holds in the running product, not only in a function. Report only real defects with file:line and a concrete failing scenario.',
    },
    {
      key: 'security',
      prompt: 'SECURITY, PRIVACY AND ABUSE. Try to break it: IDOR across stores and orders (every query takes the store id; staff actions require requireMember; owner-only things are owner-only), enumeration (timing, shape, status codes, error text, email side effects), token strength and what a public page leaks, CSRF on actions, XSS or header injection in emails and pages (user text rendered as text only, addresses https only), SSRF where a person gives an address (safeFetch), rate limits and flooding (database growth), cookie/storage/IP use against KNOWN_COOKIES and the privacy claims, GDPR (what is stored, retention, deletion with the customer), copied-order and host-order guards, race conditions (double submit, double email, double charge), secrets reaching the browser, and migrations that open a table to the Data API (RLS, grants, the private commerce schema, functions with a fixed search_path). Report only real defects with file:line and a concrete exploit or failing scenario; write a failing test where you can.',
    },
    {
      key: 'money',
      prompt: 'MONEY AND DATA INTEGRITY. Verify every amount with real numbers: integer minor units, rounding and the remainder rule, VAT-inclusive prices and the rate chosen by commerce.vat_rate(), discounts of every kind (code, campaign, member group, bonus credit, referral), shipping, multi-currency (stored in the country\'s own currency, shown() only for display, euro scenario for every new money read), gift lines, booking lines, subscriptions, venue-paid balances, orders paid outside Kaizen\'s Stripe, copied and host orders (never counted), idempotency and retries (success at the provider but failure in the database), analytics definitions (docs/analytics.md: a refund counts once, in the period it was made), gap-free numbering, DB rules under concurrency, and that cartSummary(), placeOrder() and checkout behaviour are unchanged unless the spec says so (checkout-kinds.int.test.ts). Report only real defects with file:line and a concrete failing scenario; write a failing test where you can.',
    },
  ]

// ---------------------------------------------------------------- shared prompt

const COMMON = [
  'You are working on wave ' + WAVE + ' of the Shopify parity plan for Kaizen Store, in /home/user/kaizen-store: "' + TITLE + '".',
  'The contract is ' + SPEC + ' (written by the Spec step of this run; read it completely before anything else). The tracker rows this run closes are: ' + ROW_IDS.join(', ') + ' (docs/parity/rows/*.json; contract of the tracker: docs/parity/README.md). The plan is docs/parity-plan.md. Follow the spec; if you must deviate, change the spec in the same edit and say so in your report. Also follow CLAUDE.md (the repo rules: money in minor units, store id on every query, i18n by language with English fallback, ActionForm, requireMember, updateTag, admin tokens and so on). AGENTS.md says this Next.js has breaking changes: read the relevant guide in node_modules/next/dist/docs/ before writing routes, actions or caching.',
  '',
  'STANDING RULES (learned in D153, they apply to every agent in this run):',
  '- Do NOT git commit or push. Do NOT touch the production Supabase project (no Supabase MCP tools: not apply_migration, not execute_sql) and no Vercel tools. The LEAD applies production migrations, checks the advisors, records the decision and pushes. New migration files are NOT applied anywhere yet, so editing your own new migration files in place is fine; never edit a migration that is already committed.',
  '- Other agents edit the same working tree at the same time. Only edit files in your own area. For shared files (src/db/schema.ts, src/lib/i18n.ts, src/lib/email-text.ts, src/lib/admin-map.ts, src/lib/store-nav.ts, src/lib/store-copy-rules.ts, docs/*, CLAUDE.md) make small targeted Edits in your own region, re-read the file right before each edit, and never rewrite a whole shared file. Do not edit CLAUDE.md or docs/decisions.md or docs/shopify-parity.md: the lead does; put a draft in your report instead. The rows in docs/parity/rows are edited only by the Re-rate step (and the Spec step may not either).',
  '- EVERY AGENT USES ITS OWN DATABASE. Postgres 16 runs locally (postgres://postgres:postgres@localhost:5432/postgres). Create yours: psql postgres://postgres:postgres@localhost:5432/postgres -c "create database ' + DB + '_<yourlabel>" and run DATABASE_URL=postgres://postgres:postgres@localhost:5432/' + DB + '_<yourlabel> node scripts/db-setup.mjs --seed. Integration tests: DATABASE_URL=... pnpm test:int <file>. Unit tests: pnpm test <file>. If Postgres was restarted (the container can restart at any time), recreate or reset your database before trusting a failure.',
  '- NEVER use pkill -f or pgrep -f (they kill your own shell). Find a process with ps or ss -ltnp and kill it by PID.',
  '- Builds and e2e run DETACHED and are polled, because the container can restart and a foreground command dies with it: nohup pnpm build > /tmp/<name>.log 2>&1 & echo $! > /tmp/<name>.pid, then poll the log with short sleeps (never one long foreground wait). If the log shows the process died without finishing (a restart), start it again. Builders do not run pnpm build or e2e unless the spec makes it necessary; the Gates agent does. Playwright serves the app on port 3000, so only one e2e run at a time: check that port 3000 is free (ss -ltnp) before starting one, set PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium (no playwright install), and kill the server by PID afterwards.',
  '- The Supabase migration tool cancels statements that contain DELETE or DROP inside function bodies. Where a migration needs one (for example a function that deletes expired rows, or DROP in a replaced function), keep it as small and separate as you can in its own statement, and LIST each such statement (file, statement, why) in the ownerStatements field of your report so the lead can hand it to the owner to run by hand. Say "none" when there are none. Additive migrations only: destructive changes to existing tables or data are a separate, reviewed step and are not part of a wave.',
  '- A Postgres enum value added in a migration cannot be used in the same migration: put ALTER TYPE ... ADD VALUE in its own migration file (see supabase/migrations/20260926215234_bookings.sql) or use text with a check. Generate migrations with pnpm db:generate and, for rules Drizzle cannot express, pnpm exec drizzle-kit generate --custom --name <name>; never hand-edit generated snapshots. pnpm db:check must pass once your files exist. To change a function that exists in production, patch the live definition the way supabase/migrations/20261002143638_analytics_rules.sql did for duplicate_store and clone_store.',
  '- Consumer-facing legal texts (terms, privacy, returns, shipping, withdrawal, imprint, consent wording, invoices and credit notes shown to shoppers, anything a regulator could read) are HAND-WRITTEN in Norwegian (nb), Swedish, Danish and English, plain and careful, never claimed to be legal advice, and each one is listed in the spec under "Needs human legal review". They are bucket D work to be reviewed by a person; never mark such a row Full on the strength of the text alone.',
  '- Keep the CLAUDE.md conventions: store id on every query of a store-owned table; a euro scenario (a market in another currency than the store\'s own) for every new money read, in checkout-kinds.int.test.ts or the nearest equivalent; every new store-owned table classified in COPY_RULES (src/lib/store-copy-rules.ts) and handled in clone_store() and duplicate_store() when copied; every cookie or storage item in KNOWN_COOKIES; interface text in src/lib/i18n.ts and src/lib/email-text.ts by language with English as fallback; prices through <Price>/VatAmount and amounts through formatMoney; VAT only through commerce.vat_rate(); server-only modules import server-only; AI never states a price, stock or product it was not given by a tool, arithmetic in code, output rendered as text, claims through findClaims(); never a provider or model named in code; payment credentials are store settings, never environment variables.',
  '- Tests ship with everything you add: unit tests for pure code, PGlite tests in the style of src/db/commerce.test.ts for DB rules, *.int.test.ts for server code against the real database (inputs through the same validation the app uses), renderToString tests for presentational components, e2e specs for main paths. Do not weaken, skip or delete an existing test to get green; fix the cause. Keep pnpm lint and pnpm typecheck passing for the files you touch.',
  '- Be honest and skeptical in what you report. Say what you could not do and what surprised you. A row is not Full because code exists; the criteria must hold in the running product and a test must hold them.',
  '- Finish with a SHORT report in the schema asked for: what you built (file paths), the exported API other agents need (function names and signatures, table and column names), what you could not do, and ownerStatements.',
].join('\n')

const REPORT = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    api: { type: 'string', description: 'exported functions and signatures, tables and columns the next agents need' },
    gaps: { type: 'string', description: 'what could not be done, and anything surprising; empty when nothing' },
    ownerStatements: { type: 'string', description: 'migration statements with DELETE or DROP inside functions, for the owner to run by hand; "none" when there are none' },
  },
  required: ['summary', 'api'],
}

const SPEC_REPORT = {
  type: 'object',
  properties: {
    specPath: { type: 'string' },
    summary: { type: 'string' },
    rowPlan: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rowId: { type: 'string' },
          bucket: { type: 'string' },
          closedBy: { type: 'string', description: 'the acceptance criteria and the test that will close the row' },
          expectedRating: { type: 'string', description: 'full, partial or missing once this run is done; honest about bucket B, C and D limits' },
        },
        required: ['rowId', 'closedBy', 'expectedRating'],
      },
    },
    missingRows: { type: 'array', items: { type: 'string' }, description: 'row ids not found in docs/parity/rows' },
    criteriaChanges: { type: 'string', description: 'criteria of rows that the spec found wrong or untestable, with the proposed text; empty when none' },
    legalReview: { type: 'string', description: 'consumer legal texts this wave adds that need human review; empty when none' },
    blockers: { type: 'string', description: 'decisions the owner must make before building (docs/parity-plan.md section 5, bucket C, a missing credential or agreement that stops the work itself); empty when the run can go ahead' },
  },
  required: ['specPath', 'summary', 'rowPlan', 'blockers'],
}

const GATES = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    ran: { type: 'string', description: 'exactly which commands were run and their results, with counts' },
    failuresLeft: { type: 'string', description: 'failures that could not be fixed, with their cause; empty when green' },
    ownerStatements: { type: 'string' },
  },
  required: ['summary', 'ran', 'failuresLeft'],
}

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          severity: { type: 'string' },
          scenario: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['title', 'file', 'scenario', 'fix'],
      },
    },
  },
  required: ['findings'],
}

const RERATE = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { rowId: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, why: { type: 'string' } },
        required: ['rowId', 'from', 'to', 'why'],
      },
    },
    unchanged: { type: 'string', description: 'rows left as they were and why, one line each' },
    commands: { type: 'string', description: 'what was run (pnpm parity:write, the parity test) and the result, or that the command does not exist yet' },
    decisionDraft: { type: 'string', description: 'text for the decisions row (D154 onward style) for the lead; empty if the skeptic step' },
    claudeMdDraft: { type: 'string', description: 'the CLAUDE.md bullet for the lead; empty if the skeptic step' },
    followUps: { type: 'string', description: 'what the lead must still do or decide: production migrations, owner statements, third-party approvals, human legal review' },
  },
  required: ['summary', 'changes', 'commands'],
}

// ---------------------------------------------------------------- Spec

phase('Spec')
log('wave ' + WAVE + ': ' + TITLE + ' (' + ROW_IDS.length + ' rows, spec ' + SPEC + ')')
const spec = await agent([
  'You are working on wave ' + WAVE + ' of the Shopify parity plan for Kaizen Store, in /home/user/kaizen-store: "' + TITLE + '". You write the CONTRACT that every later agent of this run builds from. You write documentation only: no application code, no migrations.',
  'Read, in this order: docs/parity/README.md (the tracker contract), the rows ' + ROW_IDS.join(', ') + ' in docs/parity/rows/*.json (the Shopify side, our gap, the acceptance criteria, the evidence), docs/parity-plan.md (the buckets, section 3 for wave ' + WAVE + ', section 4 how a wave runs, section 5 decisions), the relevant part of docs/shopify-parity.md, CLAUDE.md (every convention that touches this area), docs/decisions.md and the existing docs of neighbouring features (docs/returns.md is the model of a contract doc), and then THE CODE that exists today for this area: the tables in src/db/schema.ts, the server modules, pages and tests, so the spec builds on what is there and does not invent a parallel system. If a row\'s Shopify side is marked fetched: false and the behaviour matters, read Shopify\'s own page (load the tools first: ToolSearch with query "select:WebFetch,WebSearch"; standard search mode; prefer help.shopify.com, shopify.dev, shopify.com/blog, changelog.shopify.com) and, for law, the official source, and write what you found into the spec with its URL. Do not edit the rows.',
  'Write ' + SPEC + ' with these sections: (1) Purpose and scope, which rows it closes and what Shopify does (with the URLs read). (2) Behaviour, written so a tester can follow it: shopper side, staff side, platform side, emails, edge cases, failure behaviour, what happens with copied orders, host orders, other currencies, other languages. (3) Data: tables, columns, constraints, the rules the database itself enforces (triggers, checks), what is private, what is copied by clone_store() and duplicate_store() and the COPY_RULES class of every new table, retention. (4) Rules and law: the exact rules (amounts and rounding, deadlines, who may do what), each with its source. (5) Where things live: the file for each module (pure libs under src/lib, server under src/server, routes, components), the registries to extend (store-nav, admin-map, i18n, email-text, KNOWN_COOKIES, plan features, owner tools, store-translate, sitemap, structured data), and which agent area each belongs to (foundation, server, shopper, admin, analytics-and-ai) so that areas do not share files except through the registries. (6) Acceptance criteria, row by row, mapped to the tests that will hold them (unit, PGlite, int, e2e): this is how each row closes. Do not weaken a row\'s criteria; where one is wrong or untestable say so under criteria changes. (7) What is deliberately NOT done and why (and which later wave or bucket takes it). (8) Needs human legal review: every consumer legal text the wave adds. (9) For the lead: migrations expected, statements with DELETE or DROP inside functions that the Supabase migration tool would cancel (so the owner runs them), advisors to check, drafts of the decision row and the CLAUDE.md bullet.',
  'Honesty: for each row say what rating it can honestly reach in this run. Rows in bucket B (live only with a third party), C (needs a decision) or D (not reachable by code) are built as far as code goes and keep their rating until the approval, decision or evidence exists; never promise Full for them. If a row of this wave needs an owner decision from docs/parity-plan.md section 5 before building, or a credential that stops the work itself, put it in blockers (and still write what you can in the spec); leave blockers empty when the run can go ahead.',
  'Finish with the schema asked for.',
].join('\n'), { label: 'spec', phase: 'Spec', schema: SPEC_REPORT })

if (!spec) throw new Error('the Spec agent returned nothing; resume the run to retry it')
if (spec.missingRows && spec.missingRows.length) {
  log('rows not found in docs/parity/rows: ' + spec.missingRows.join(', '))
}
if (spec.blockers && spec.blockers.trim()) {
  log('STOPPED after the Spec: the owner must decide first: ' + spec.blockers)
  return { stopped: true, reason: spec.blockers, spec }
}

// ---------------------------------------------------------------- Foundation

phase('Foundation')
const found = await agent(COMMON + '\nSPEC REPORT (the spec is written, read it in full): ' + JSON.stringify(spec) + '\n' + [
  'YOUR AREA: the foundation. Do these in order, skipping what the spec does not need (say so):',
  '1. src/db/schema.ts: the tables and columns of the spec "Data" section, with checks and constraints. New store-owned tables get RLS like their siblings, a store_id on every row, composite keys where neighbours have them.',
  '2. A custom rules migration: every invariant the spec says the database enforces (triggers, functions, checks, gap-free numbering, lifecycle that only moves forward, copied-order refusal, quantities and amounts that may not exceed what is left), functions with a fixed search_path in the style of the neighbours, and clone_store() and duplicate_store() patched (the live definitions, as analytics_rules.sql did) when new data is copied. Reference data such as VAT rates goes in a migration too. A new kind of product also needs its demo product (CLAUDE.md "Demo products").',
  '3. src/lib/store-copy-rules.ts COPY_RULES for every new store-owned table (a test fails otherwise).',
  '4. The pure libraries named in the spec (src/lib/...: the maths, the rules, the status tables, the input schemas shared with the browser), with thorough unit tests, including rounding and boundaries and, for money, a currency other than the store\'s own.',
  '5. PGlite tests of every DB rule you add (src/db/commerce.test.ts applies all migrations; add a file next to it if it grows long).',
  '6. pnpm db:check must report nothing to migrate once your migration files exist (an untracked-file complaint is fine until the lead commits).',
  'Report the exact exported API of the libraries and the table and column names the server agent needs.',
].join('\n'), { label: 'foundation', phase: 'Foundation', schema: REPORT })

// ---------------------------------------------------------------- Server (own step of Surfaces)

phase('Surfaces')
const server = await agent(COMMON + '\nSPEC REPORT: ' + JSON.stringify(spec) + '\nFOUNDATION REPORT (already built, read the code): ' + JSON.stringify(found) + '\n' + [
  'YOUR AREA: the server side, before any page. Build the server modules named in the spec (src/server/...): reads and writes through db() with the store id on every query of a store-owned table, transactions and row locks where the spec says, idempotency keys where a retry could repeat an effect, the guards for copied and host orders, audit_log entries and order_events with the documented types, emails (texts in src/lib/email-text.ts by language; reuse the shopper email helpers in src/server/shopper-emails.ts: idempotent by key, kept in email_messages; never email an address a shopper typed unless the spec says so), cron hooks (find src/app/api/cron and hook in like pruneVisits or sendDueBookingReminders; one daily and one five-minute job exist), cache tags (updateTag, or refreshTag in admin functions that the cron or the assistant may call), and anything that touches Stripe goes through the existing code (src/server/stripe.ts, checkout.ts, order-admin.ts) extended minimally, never a second path.',
  'Integration tests (*.int.test.ts) against your own database: the full path of the feature, partial and repeated use, every refusal with its reason, cross-store access refused, copied-order refusal, idempotent retry, and for any money read a euro scenario and, where the product kinds matter, a scenario for each kind of product in checkout-kinds.int.test.ts. If cartSummary() and placeOrder() are touched they must still agree.',
  'Do not build any page or form yet; the surface agents do that next, in parallel.',
].join('\n'), { label: 'server', phase: 'Surfaces', schema: REPORT })

const surfaces = await parallel(SURFACES.map(s => () => agent(COMMON + '\nSPEC REPORT: ' + JSON.stringify(spec) + '\nFOUNDATION REPORT: ' + JSON.stringify(found) + '\nSERVER REPORT: ' + JSON.stringify(server) + '\nYOUR AREA (' + s.key + '): ' + s.prompt + '\nOther surface agents work in parallel on the other areas of the spec; touch the shared registries only with small targeted edits. If the container restarted and part of your area is already in the working tree (git status), inspect it against the spec and finish it; do not redo or duplicate it.', { label: 'surface:' + s.key, phase: 'Surfaces', schema: REPORT })))

// ---------------------------------------------------------------- Gates

phase('Gates')
const gates = await agent(COMMON + '\nALL BUILDERS ARE DONE. Spec report: ' + JSON.stringify(spec) + '\nBuilder reports to cross-check: foundation ' + JSON.stringify(found) + ' server ' + JSON.stringify(server) + ' surfaces ' + JSON.stringify(surfaces) + '\n' + [
  'YOUR AREA: make the whole tree green and consistent. In a FRESH database of your own (scripts/db-setup.mjs --seed) run: pnpm lint (0 errors), pnpm typecheck, pnpm test (all unit tests), pnpm test:int (all), pnpm db:check (fix real disagreements between migrations and schema; untracked-file complaints are fine), the parity tests if they exist (pnpm test src/lib/parity.test.ts; pnpm parity:check if the script exists), then pnpm build (needs the database), and the e2e: pnpm test:e2e after the build, at least the specs this wave added and the existing storefront specs. Build and e2e DETACHED with nohup and polled, as in the standing rules; if the container restarts mid-run, recreate your database and start again. Port 3000 only for you, kill the server by PID afterwards.',
  'Fix every failure at its cause in the right file (never weaken, skip or delete a test). Also verify by reading: the admin-map and store-nav tests, the COPY_RULES test, the i18n catalogue tests, the cookie list test (KNOWN_COOKIES), the sitemap and llms.txt exclusions, that no page of this wave sets a cookie or storage item that is not listed, that new routes are not reachable with another store\'s slug, that every new store-owned query takes the store id, and that every migration file is additive and that DELETE or DROP inside function bodies are listed in ownerStatements.',
  'Report exactly what you ran and the results with counts, and what is still red and why.',
].join('\n'), { label: 'gates', phase: 'Gates', schema: GATES })

// ---------------------------------------------------------------- Review

phase('Review')
const reviews = await parallel(LENSES.map(l => () => agent(COMMON + '\nTHE WAVE IS BUILT AND THE GATES WERE RUN. Spec report: ' + JSON.stringify(spec) + '\nGates: ' + JSON.stringify(gates) + '\nYOU ARE AN ADVERSARIAL REVIEWER (lens ' + l.key + '). Do NOT fix anything and do not edit files other than a failing test you add under your own new file name; report.\n' + l.prompt + '\nBe skeptical of your own findings: reproduce each one or trace it to the code before reporting it, and drop doubts. No style nits, no padding. An empty findings list is a valid answer when nothing real was found.', { label: 'review:' + l.key, phase: 'Review', schema: FINDINGS })))

const seen = new Set()
const all = []
for (const r of reviews.filter(Boolean)) {
  for (const f of r.findings || []) {
    const key = String(f.file || '').toLowerCase() + '|' + String(f.title || '').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    all.push(f)
  }
}
log(all.length + ' findings from ' + reviews.filter(Boolean).length + ' of ' + LENSES.length + ' reviewers')

// ---------------------------------------------------------------- Fix

phase('Fix')
let fixed = null
if (all.length) {
  fixed = await agent(COMMON + '\nSpec report: ' + JSON.stringify(spec) + '\nYOUR AREA: fix the reviewers\' findings below, each at its cause, with a regression test for each. If a finding is wrong, say why with evidence instead of changing code. Then, in a fresh database of your own, re-run pnpm lint, pnpm typecheck, pnpm test, the integration tests of every area you touched, and pnpm db:check. If you changed a migration file, note that it has NOT been applied anywhere yet (the lead applies it). Report each finding as fixed, disputed (with the evidence) or not fixed (with why), and list exactly which commands you ran with their counts: the LEAD re-verifies your work from scratch, so say plainly what you did not run. FINDINGS: ' + JSON.stringify(all), { label: 'fixer', phase: 'Fix', schema: REPORT })
}

// ---------------------------------------------------------------- Re-rate

phase('Re-rate')
const RATE_RULES = [
  'RULES for rows (docs/parity/README.md is the full contract; read it again): a row is Full only when its acceptance criteria hold in the RUNNING product (not because a table or a function exists), evidence.files lists existing files (every path must exist), and evidence.tests lists existing tests that hold the criteria (or evidence.untested is true, which is counted as debt: prefer writing the missing test first). Partial and missing rows keep a gap, a bucket (A, B, C, D), a wave (or null) and criteria. Rows in bucket B stay short of Full until the third party\'s approval or credential exists; C until the decision is made; D never Full. Every rating change gets a history entry { on: the date from "date +%F" in the container, from, to, why } with a reason that names what you read; a rating changed without a history entry fails src/lib/parity.test.ts. Weights are never changed in a run that changes ratings. Rows whose findings from the review are still unresolved must not be rated above what the unresolved defect allows. Keep the JSON files\' formatting and key order as they are.',
].join('\n')

const rerate = await agent(COMMON + '\n' + RATE_RULES + '\nSpec report: ' + JSON.stringify(spec) + '\nGates: ' + JSON.stringify(gates) + '\nReview findings: ' + JSON.stringify(all) + '\nFixer: ' + JSON.stringify(fixed) + '\n' + [
  'YOUR AREA: re-rate the rows ' + ROW_IDS.join(', ') + ' in docs/parity/rows/*.json (and only those rows; if you find another row that is clearly affected, do not change it: name it in followUps). For each row: read its criteria, then find the code and the tests that hold each criterion, and run the cited tests (own database) rather than trusting the builders\' reports. Set kaizen.rating (full, partial or missing), kaizen.was to the previous rating when it changes, rewrite gap with evidence (empty when full), set bucket and wave (null when full), update criteria only as the spec\'s criteria changes say (' + (spec.criteriaChanges || 'none') + '), fill evidence.files, evidence.tests and evidence.untested, add the decision id when the lead gave one (otherwise leave decisions and say so in followUps), and add the history entry. Be honest: a criterion that is built but not tested, or tested only in a function and not through the screen or API a merchant uses, keeps the row Partial. Do not change the Shopify side (shopify.*) unless you read the page in this step (then fetched, checkedOn, url and text change together).',
  'Then, if the command exists (check package.json scripts), run pnpm parity:write to regenerate the report tables and pnpm test src/lib/parity.test.ts (and pnpm parity:check) and fix what they say about your rows. If pnpm parity:write does not exist yet, say so in commands and do not hand-edit the generated tables of docs/shopify-parity.md.',
  'Return the changes, the unchanged rows with a line each, drafts of the decision row and the CLAUDE.md bullet (what, where it lives, the rules: in the style of the existing bullets) for the lead, and followUps: production migrations to apply, ownerStatements to run by hand, advisors to check, third-party approvals, legal texts that need human review.',
].join('\n'), { label: 'rerate', phase: 'Re-rate', schema: RERATE })

const skeptic = await agent(COMMON + '\n' + RATE_RULES + '\nA colleague has just re-rated the rows of this wave: ' + JSON.stringify(rerate) + '\nSpec report: ' + JSON.stringify(spec) + '\n' + [
  'YOUR AREA: you are the SKEPTIC of the re-rate. For every row whose rating went UP, or that is Full, try to show it is still short: open each acceptance criterion, find the code that does it and the test that holds it, run those tests (own database), and look for a criterion that holds only in a function and not in the screen, route or API a merchant or shopper uses, for a test that passes without testing the criterion, for evidence paths that do not exist, for a bucket B, C or D row rated above its ceiling, and for review findings (' + JSON.stringify(all.map(f => f.title)) + ') that touch the row and are not fixed. Where you can show it, lower the rating in the JSON file and add a history entry with your reason (a second entry, keeping the first); where you cannot, leave it. Never raise a rating and never change weights. Afterwards run pnpm parity:write if the script exists (otherwise say it does not), and pnpm test src/lib/parity.test.ts.',
  'Return the changes you made (rowId, from, to, why), what you checked and left unchanged, the commands you ran with results, and followUps for the lead.',
].join('\n'), { label: 'rerate-skeptic', phase: 'Re-rate', schema: RERATE })

return { spec, found, server, surfaces, gates, findings: all, fixed, rerate, skeptic }
