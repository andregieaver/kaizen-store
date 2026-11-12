#!/usr/bin/env node
// Builds the review's visual page from the panel's files (scratch tool of the bloat review).  node build-page.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const S = "/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad";
const old = readFileSync(`${S}/work/page-v4.html`, "utf8");
const between = (a, b) => old.slice(old.indexOf(a) + a.length, old.indexOf(b, old.indexOf(a)));
const style = between("<style>", "</style>");
const helpers = between("<script>", "const PAGES = [");
const pagesData = "const PAGES = [" + between("const PAGES = [", 'bars("c-scripts"');
const routesData = "const ROUTES = [" + between("const ROUTES = [", 'bars("c-server"');
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\s+/g, " ").trim();
const code = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
const planPath = existsSync(`${S}/panel/plan.final.json`) ? `${S}/panel/plan.final.json` : `${S}/panel/plan.json`;
const final = planPath.endsWith(".final.json");
const plan = json(planPath);
const { counts } = json(`${S}/work/findings-totals.json`);
const SCORE = [["shopper-browser", "What a shopper's browser gets"], ["owner-browser", "What an owner's browser gets"], ["server", "What the server loads and asks"], ["scheduled", "Scheduled work"], ["database", "The database"], ["page-model", "The page builder's model and a built page"], ["styles", "Styles"], ["text", "Interface text"], ["ai", "AI calls"], ["surface", "The product's surface"], ["code", "The code itself"], ["build", "Tests, CI and the build"], ["rules", "The written rules"]];
const card = (k) => { const f = `${S}/panel/card-${k}.final.json`; return json(final && existsSync(f) ? f : `${S}/panel/card-${k}.json`); };
const CLS = { A: "ga", B: "gb", C: "gc", D: "gd", E: "ge" };
const chip = (g) => `<span class="chip grade ${CLS[g] ?? ""}"><i></i>${esc(g)}</span>`;
const cards = SCORE.map(([k, title]) => ({ k, title, c: card(k) }));
const allA = cards.every((x) => x.c.ladder.after_all === "A");
const steps = plan.phases.flatMap((p) => p.steps);
const asked = steps.filter((s) => s.owner_question);
const today = (g) => cards.filter((x) => x.c.grade_today === g).length;
const num = (n) => Number(n).toLocaleString("en-GB");

const scoreRows = cards.map(({ title, c }) => `<tr><td>${esc(title)}</td><td>${chip(c.grade_today)}</td><td>${code(c.bar_in_a_sentence || c.measures.slice(0, 3).map((m) => `${m.name}: ${m.target_a}`).join(". "))}</td></tr>`).join("\n        ");
const ladderRows = cards.map(({ title, c }) => `<tr><td>${esc(title)}</td><td>${chip(c.grade_today)}</td><td>${chip(c.ladder.after_phase_0)}</td><td>${chip(c.ladder.after_phase_1)}</td><td>${chip(c.ladder.after_phase_2)}</td><td>${chip(c.ladder.after_all)}</td></tr>`).join("\n        ");
const phases = plan.phases.map((ph) => {
  const e = { S: 0, M: 0, L: 0 }; for (const s of ph.steps) e[s.effort]++;
  const own = ph.steps.filter((s) => s.owner_question).length;
  const top = [...ph.steps].sort((a, b) => b.closes.length - a.closes.length).slice(0, 6).sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  return `<li><div class="ph"><span class="eyebrow">Phase ${ph.n} · ${ph.steps.length} steps · ${e.S} small, ${e.M} medium, ${e.L} large${own ? ` · ${own} wait for you` : ""}</span><h3>${esc(ph.title)}</h3><p>${code(ph.notice)}</p></div>
        <ul>
          ${top.map((s) => `<li><span class="sid">${esc(s.id)}</span><span>${code(s.title)}</span></li>`).join("\n          ")}
          ${ph.steps.length > top.length ? `<li class="more">and ${ph.steps.length - top.length} more</li>` : ""}
        </ul></li>`;
}).join("\n      ");
const questions = asked.map((s) => `<li><strong>Step ${esc(s.id)}.</strong> ${code(s.owner_question)}</li>`).join("\n        ");
const choices = (plan.owner_choices ?? []).map((c) => `<li>${code(c.question)}</li>`).join("\n        ");

const body = `<title>Kaizena Flow Bloat Review</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Space+Grotesk:wght@500;600&display=swap">
<style>${style}
.chip.grade { font-weight: 500; color: var(--ink); min-width: 2.6em; justify-content: center; }
.chip.ga i { background: var(--good); } .chip.gb i { background: var(--s1); } .chip.gc i { background: var(--warning); } .chip.gd i { background: var(--serious); } .chip.ge i { background: var(--critical); }
table.ladder td, table.ladder th { text-align: center; padding-right: 10px; } table.ladder td:first-child, table.ladder th:first-child { text-align: left; font-weight: 500; }
ol.phases .ph p { font-size: 0.9rem; color: var(--ink-2); }
ol.phases .sid { font-family: var(--mono); font-size: 0.78rem; color: var(--ink-3); min-width: 2.6em; display: inline-block; }
ol.phases li.more { color: var(--ink-3); font-size: 0.86rem; }
ol.phases ul li { display: flex; gap: 10px; align-items: baseline; } ol.phases ul li .sid { flex: none; }
.causes > div:last-child { grid-column: 1 / -1; } .causes > div:last-child p { max-width: 70ch; }
details.qs summary { cursor: pointer; font-family: var(--display); font-weight: 600; font-size: 1.02rem; padding: 6px 0; }
details.qs ol { margin: 10px 0 0; padding-left: 2.4em; display: flex; flex-direction: column; gap: 9px; max-width: 78ch; color: var(--ink-2); font-size: 0.95rem; }
details.qs li strong { color: var(--ink); font-weight: 600; }
</style>

<div class="page">
  <header class="top">
    <div class="eyebrow">Review · 11 and 12 November 2026 · commit 0bd814c</div>
    <h1>Is Kaizena Flow bloated?</h1>
    <p class="lede">Not in what it is. In how it loads, asks and checks. The platform is carefully built and not open yet: 0.35% of the code is dead, 1% is a copy, and a feature a store does not use costs it close to nothing. The waste has five causes, and almost all of it is cheap to remove before the doors open. The plan's goal is an A in every area.</p>
    <p class="note" id="status-note">25 areas of the system were each read by one reviewer, challenged by a second and planned by a third: <strong>${num(counts.FINDINGS)} findings stand and ${counts.REFUTED} claims were refuted</strong>, several of them this review's own first figures. A panel then set each area's bar for an A in numbers and wove one plan of <strong>${steps.length} steps</strong>. The full review is in the repository at <code>docs/audits/bloat-review-2026-11.md</code>.</p>
  </header>

  <section>
    <div class="head"><div class="eyebrow">The verdict, and the goal</div><h2>${today("D")} areas are a D today, ${today("C")} a C, none an A. The plan takes every one to an A.</h2>
      <p class="muted">An A means nothing in the area is loaded, fetched, run or shown without need, beyond a small stated tolerance, and a test or a production figure holds each number so it cannot slip back unseen. No area is an A today, the tidy ones included, because almost no number is held by a check. A grade is raised only for fixes seen working in production.</p></div>
    <div class="scroll"><table class="grades">
      <thead><tr><th>Area</th><th>Today</th><th>Grade A when</th></tr></thead>
      <tbody>
        ${scoreRows}
      </tbody>
    </table></div>
  </section>

  <section>
    <div class="head"><div class="eyebrow">The ladder</div><h2>How each area climbs, phase by phase</h2>
      <p class="muted">${allA ? "Where a challenger found the plan short of an area's bar, the missing step or the tighter check was added. An area cannot be an A before the step that holds its numbers." : "As the plan stands some areas stop at a B: their challengers named the missing steps, which are being added. The goal does not move."}</p></div>
    <div class="scroll"><table class="ladder">
      <thead><tr><th>Area</th><th>Today</th><th>After phase 0</th><th>After phase 1</th><th>After phase 2</th><th>After all</th></tr></thead>
      <tbody>
        ${ladderRows}
      </tbody>
    </table></div>
  </section>

  <section>
    <div class="head"><div class="eyebrow">Why</div><h2>Five causes explain most of the ${num(counts.FINDINGS)} findings</h2></div>
    <div class="causes">
      <div><h3>One import cycle ties the server together</h3><p>229 server modules import each other in a ring, so 559 of 562 pages and the proxy each load the same 10 to 11 MB whatever their job. A few dozen import changes cure it. No feature is removed.</p></div>
      <div><h3>Pages are drawn and sent more often than needed</h3><p>Every store page view runs a function to place two cart badges. The layout is sent twice in every page. A visitor who does nothing causes 11 to 50 prefetches.</p></div>
      <div><h3>Every admin screen loads twice the script it needs</h3><p>1.16 MB at the median, where about 0.6 MB will do. Three stray imports put a database client and a validation library on every screen.</p></div>
      <div><h3>Work is found by asking, data fetched whole</h3><p>13,250 scheduled calls a day find almost nothing. Finding one page reads every page of the store. A product view asks the database 18 times where one answer changes.</p></div>
      <div><h3>Nothing holds the numbers</h3><p>${counts.NOCHECK} findings are the same finding: no check would notice this growing. The one place with a budget, the storefront's first scripts, is the leanest place in the product.</p></div>
    </div>
    <p class="muted">Nothing is slow or broken today: the platform is not open, the database is idle and pages answer quickly. What is at stake at opening is that these causes grow with every store, page, product, order and visit. Before opening is the cheapest time to remove them: there is no real data to move and nobody to disturb.</p>
  </section>

  <section>
    <div class="head"><div class="eyebrow">Measured in the build</div><h2>Almost every route carries the whole server</h2>
      <p class="muted">Next's bundle analyzer lists the source modules behind each route. A route with a small job should load a small set. Only the health check does. On the review's machine a route inside the cycle takes about 1 s and 70 to 80 MB to start cold, against 0.16 s and 14 MB outside it.</p></div>
    <figure class="chart" id="c-server">
      <figcaption><b>Source modules a route's server code loads</b><span>modules · megabytes of built code</span></figcaption>
      <div class="bars"></div>
      <details class="numbers"><summary>Show the numbers</summary><div class="scroll"></div></details>
    </figure>
    <figure class="chart" id="c-spike">
      <figcaption><b>The visit beacon, before and after two one-line import edits tried in a copy</b><span>source modules</span></figcaption>
      <div class="bars"></div>
      <details class="numbers"><summary>Show the numbers</summary><div class="scroll"></div></details>
    </figure>
    <div class="reading">
      <p><strong>The visit beacon, called on every page view, loads 1,890 modules.</strong> It imports one ten-line check through the chat module, which brings the chat, the AI layer and the support desk with it.</p>
      <p><strong>The trial closed one of two doors.</strong> The reviewers confirmed the beacon's saving and found the admin reaches the same code through two files of its own. Cutting the cycle itself is step by step in phase 0.</p>
    </div>
  </section>

  <section>
    <div class="head"><div class="eyebrow">Measured in a browser</div><h2>More than half of the script a page loads has not run when the page is idle</h2>
      <p class="muted">Each page of the production build was opened once in a fresh browser, left alone until it went quiet, and asked which bytes of its scripts had executed.</p></div>
    <figure class="chart" id="c-scripts">
      <figcaption><b>Script loaded by a page, and how much of it ran</b><span>KB before compression · a visitor who presses nothing</span></figcaption>
      <div class="legend"></div><div class="bars"></div>
      <details class="numbers"><summary>Show the numbers</summary><div class="scroll"></div></details>
    </figure>
    <div class="reading">
      <p><strong>A shopper's page is the lean part.</strong> Its first scripts are 680 KB, of which 447 KB is the framework itself; the store's own code is about 80 KB compressed.</p>
      <p><strong>The admin is where the weight is.</strong> The median of 432 signed-in screens is 1.16 MB. Seven small import changes take it to about 0.6 MB in a simulation on the built files.</p>
      <p><strong>Kaizena Flow's own front page fetches 437 KB of admin scripts</strong> that a visitor cannot use.</p>
    </div>
  </section>

  <section>
    <div class="head"><div class="eyebrow">Measured in a browser</div><h2>Two thirds of every document is the page sent a second time</h2>
      <p class="muted">A page arrives as markup, then again as data so the browser can wake its interactive parts. On a store page that second copy is made by a function on every view, to place two cart badges and a country hint, and it carries the whole layout twice.</p></div>
    <figure class="chart" id="c-docs">
      <figcaption><b>What each HTML document is made of</b><span>KB before compression</span></figcaption>
      <div class="legend"></div><div class="bars"></div>
      <details class="numbers"><summary>Show the numbers</summary><div class="scroll"></div></details>
    </figure>
    <div class="reading">
      <p><strong>On the demo store's home page 98 of 138 KB</strong> comes from that function. Served from its static shell, the page would need no function run for a visitor without a cart.</p>
      <p><strong>The product editor hands the browser 238 KB of interface text</strong> and its parts read 79 KB of it.</p>
    </div>
  </section>

  <section>
    <div class="head"><div class="eyebrow">Read from production</div><h2>13,250 scheduled calls a day, nearly all finding nothing</h2>
      <p class="muted">From Postgres's own counters since 25 August and the job ledger. No personal data was read. With no shoppers yet, these are the fixed floor: what the platform does when nobody is there.</p></div>
    <div class="tiles">
      <div class="tile"><span class="v">13,250</span><span class="l">scheduled calls a day</span><span class="s">about 170,000 statements</span></div>
      <div class="tile"><span class="v">564 MB</span><span class="l">of the 731 MB database is the scheduler's own log</span><span class="s">nothing prunes it</span></div>
      <div class="tile"><span class="v">79,778</span><span class="l">times every page of a store was read whole to find one</span><span class="s">the costliest app query</span></div>
      <div class="tile"><span class="v">560,090</span><span class="l">lookups of one store's address, with no shoppers</span><span class="s">it never changes</span></div>
    </div>
  </section>

  <section>
    <div class="head"><div class="eyebrow">Checked, and found in good order</div><h2>What is not bloated</h2>
      <p class="muted">A review should say where things are well made. The usual suspects came back clean, and an unused feature is no finding before opening.</p></div>
    <div class="tiles">
      <div class="tile"><span class="v">0.35%</span><span class="l">of source lines have no caller</span><span class="s">about 2,700 of 772,000</span></div>
      <div class="tile"><span class="v">1.0%</span><span class="l">of code is an exact copy</span><span class="s">4.75% with every name normalised</span></div>
      <div class="tile"><span class="v">51</span><span class="l">runtime packages, every one used</span><span class="s">heavy ones load on the press that needs them</span></div>
      <div class="tile"><span class="v">340</span><span class="l">bytes a block in a stored page</span><span class="s">the page model is lean</span></div>
      <div class="tile"><span class="v">29</span><span class="l">links in a new shop's Basic view</span><span class="s">an unused feature costs close to nothing</span></div>
      <div class="tile"><span class="v">0</span><span class="l">snapshot tests</span><span class="s">326 K lines of tests that do not repeat each other</span></div>
    </div>
  </section>

  <section>
    <div class="head"><div class="eyebrow">The plan</div><h2>${steps.length} steps in five phases, one goal: an A in every area</h2>
      <p class="muted">Every finding is closed by exactly one step, tolerated with a stated reason (${plan.tolerated.length}), or left to you as a product choice (${(plan.owner_choices ?? []).length}). Each step names the check that says it is done. Phase 0 asks you nothing. The steps shown are the ones that close the most findings in each phase.</p></div>
    <ol class="phases">
      ${phases}
    </ol>
  </section>

  <section>
    <div class="head"><div class="eyebrow">Waiting for you</div><h2>${asked.length} steps wait for your answer; ${(plan.owner_choices ?? []).length} more are product choices</h2>
      <p class="muted">None of them holds up phase 0.</p></div>
    <details class="qs" open><summary>Questions that stop a step (${asked.length})</summary><ol>
        ${questions}
    </ol></details>
    <details class="qs"><summary>Product choices the reviewers met (${(plan.owner_choices ?? []).length}): not waste, and no step depends on them</summary><ol>
        ${choices}
    </ol></details>
  </section>

  <footer>
    <span>Method: a production build of commit 0bd814c, served locally with the demo catalogue; 32 pages measured in Chromium with a cold cache; Next's bundle analyzer for the module lists; production's statistics views for the database; then 25 areas each read, challenged and planned, and a panel that graded 13 areas and wove the plan.</span>
    <span>Limits: times and megabytes were measured on the review's machine, not on Vercel. Real cold starts and visitors' speed in production were not measured. Sizes are before compression unless a line says otherwise.</span>
  </footer>
</div>
<div id="tt" hidden></div>

<script>${helpers}${pagesData}bars("c-scripts", {
  unit: "KB", share: true,
  series: [{ key: "ran", label: "Ran before the page was idle", color: css("--s1") }, { key: "idle", label: "Loaded, not run", color: css("--rest") }],
  rows: PAGES.map((p) => ({ label: p.label, group: p.group, v: { ran: p.ran, idle: p.scripts - p.ran }, extra: [{ value: \`\${fmt(p.gz)} KB\`, label: "on the wire, compressed" }] })),
  cols: [{ label: "Not run", get: (r) => \`\${Math.round((r.v.idle / (r.v.ran + r.v.idle)) * 100)}%\` }],
});
bars("c-docs", {
  unit: "KB", share: true,
  series: [{ key: "markup", label: "Markup the visitor sees", color: css("--s1") }, { key: "rsc", label: "The same page as data, for the browser's scripts", color: css("--s2") }, { key: "rest", label: "Styles and other inline code", color: css("--s3") }],
  rows: PAGES.map((p) => ({ label: p.label, group: p.group, v: { markup: p.markup, rsc: p.rsc, rest: p.rest } })),
});
${routesData}bars("c-server", {
  unit: "modules", room: 190, rowHead: "Route",
  series: [{ key: "mods", label: "Source modules", color: css("--s1") }],
  rows: ROUTES.map((r) => ({ label: r.label, v: { mods: r.mods }, end: \`\${fmt(r.mods)} · \${r.mb.toFixed(1)} MB\`, mb: r.mb, extra: [{ value: \`\${r.mb.toFixed(1)} MB\`, label: "of built server code" }] })),
  cols: [{ label: "Built code (MB)", get: (r) => r.mb.toFixed(1) }],
});
bars("c-spike", {
  unit: "modules", room: 190, rowHead: "State",
  series: [{ key: "mods", label: "Source modules", color: css("--s1") }],
  rows: [
    { label: "Today", v: { mods: 1890 }, end: "1,890 · 10.5 MB", mb: 10.5, extra: [{ value: "10.5 MB", label: "of built server code" }] },
    { label: "With the two edits", v: { mods: 639 }, end: "639 · 1.2 MB", mb: 1.2, extra: [{ value: "1.2 MB", label: "of built server code" }] },
  ],
  cols: [{ label: "Built code (MB)", get: (r) => r.mb.toFixed(1) }],
});
</script>
`;
writeFileSync(`${S}/bloat-review.html`, body);
console.log("page bytes:", body.length, "| steps", steps.length, "| asked", asked.length, "| all areas end at A:", allA, "| plan:", final ? "final" : "not yet amended");
