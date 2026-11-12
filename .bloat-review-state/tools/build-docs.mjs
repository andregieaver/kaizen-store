#!/usr/bin/env node
// Builds the bloat review's document and folder in the repo from the reviewers' and the panel's files (scratch tool of the review).
//   node build-docs.mjs
// Inputs under the scratchpad: findings/<area>.json (25 areas: verified and planned), panel/plan.json (the woven plan),
// panel/card-<area>.json (each scorecard area's final bar and grade; steward-<area>.json until a card exists), m/*.md (evidence),
// work/main-template.md (the hand-written parts, with {{PLACEHOLDERS}}).
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";

const S = "/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad";
const OUT = "/home/user/kaizen-store/docs/audits/bloat-review-2026-11";
rmSync(`${OUT}/findings`, { recursive: true, force: true }); // rebuilt whole each time
mkdirSync(`${OUT}/findings`, { recursive: true });
mkdirSync(`${OUT}/evidence`, { recursive: true });

const AREAS = [
  { key: "storefront-client", file: "storefront-browser", prefix: "SC", title: "What a shopper's browser loads" },
  { key: "client-bundles", file: "client-bundles", prefix: "BN", title: "The built client bundles, by page" },
  { key: "page-payload", file: "page-payload", prefix: "PL", title: "What a page sends: document, payload and requests" },
  { key: "prefetch", file: "prefetching", prefix: "PF", title: "Prefetching: what the router asks for unasked" },
  { key: "css", file: "styles", prefix: "CS", title: "Styles" },
  { key: "admin-client", file: "admin-browser", prefix: "AC", title: "What an owner's browser loads in the admin" },
  { key: "storefront-data", file: "storefront-server", prefix: "SD", title: "What the server does for a storefront request" },
  { key: "admin-data", file: "admin-server", prefix: "AD", title: "What the server does for an admin navigation" },
  { key: "server-graph", file: "server-module-graph", prefix: "SG", title: "The server code every route loads" },
  { key: "functions", file: "server-functions", prefix: "SF", title: "Server functions: size, cold start, per-request overhead" },
  { key: "caching", file: "caching", prefix: "CA", title: "Caching and rendering" },
  { key: "page-model", file: "page-builder-model", prefix: "PM", title: "The page builder's model and a built page's render" },
  { key: "cron", file: "scheduled-work", prefix: "CR", title: "Scheduled and background work" },
  { key: "db-queries", file: "queries", prefix: "DQ", title: "How data is asked for" },
  { key: "db-schema", file: "database-shape", prefix: "DS", title: "The database's shape" },
  { key: "ai-context", file: "ai-calls", prefix: "AI", title: "What every AI call carries" },
  { key: "i18n", file: "interface-text", prefix: "TX", title: "Interface text" },
  { key: "features", file: "features", prefix: "FT", title: "The product's surface" },
  { key: "families", file: "families", prefix: "FM", title: "Families and twins" },
  { key: "deps", file: "dependencies", prefix: "DP", title: "Dependencies" },
  { key: "assets", file: "files", prefix: "AS", title: "Files that ship or are stored" },
  { key: "unused-code", file: "unused-code", prefix: "DD", title: "Code nothing uses" },
  { key: "copied-code", file: "copied-code", prefix: "CP", title: "Copied code" },
  { key: "tests-ci", file: "tests-ci-build", prefix: "TC", title: "Tests, CI and the build" },
  { key: "docs-context", file: "written-rules", prefix: "DC", title: "The written rules and the agents' context" },
];
const SCORE = [
  { key: "shopper-browser", title: "What a shopper's browser gets" },
  { key: "owner-browser", title: "What an owner's browser gets" },
  { key: "server", title: "What the server loads and asks" },
  { key: "scheduled", title: "Scheduled work" },
  { key: "database", title: "The database" },
  { key: "page-model", title: "The page builder's model and a built page" },
  { key: "styles", title: "Styles" },
  { key: "text", title: "Interface text" },
  { key: "ai", title: "AI calls" },
  { key: "surface", title: "The product's surface" },
  { key: "code", title: "The code itself" },
  { key: "build", title: "Tests, CI and the build" },
  { key: "rules", title: "The written rules" },
];

const rename = (id) => String(id).replace(/^FN-/, "SF-"); // the code review's FN is navigation; server functions are SF here
const clean = (s) => String(s ?? "").replace(/\/home\/user\/kaizen-store\//g, "").replace(/\/tmp\/claude-0\/[^\s;,)`]*scratchpad\/m\//g, "evidence/").replace(/\/tmp\/claude-0\/[^\s;,)`]*scratchpad\/work\/[^\s;,)`]*/g, "a scratch script").replace(/\/tmp\/claude-0\/[^\s;,)`]*scratchpad\/?/g, "the review's scratch folder/").replace(/\bFN-(\d+)/g, "SF-$1").replace(/\s+/g, " ").trim();
const cell = (s) => clean(s).replace(/\|/g, "\\|");
const KIND = { dead: "dead", duplicate: "duplicate", eager: "eager", oversize: "oversize", speculative: "ahead of use", process: "no check" };
const json = (p) => JSON.parse(readFileSync(p, "utf8"));

// ---- The plan: where each finding is closed.
const plan = existsSync(`${S}/panel/plan.json`) ? json(`${S}/panel/plan.json`) : null;
const STEP_OF = {};
if (plan) {
  for (const ph of plan.phases) for (const st of ph.steps) for (const id of st.closes) STEP_OF[rename(id)] = st.id;
  for (const t of plan.tolerated ?? []) STEP_OF[rename(t.finding_id)] = "tolerated";
  for (const c of plan.owner_choices ?? []) for (const id of c.finding_ids) STEP_OF[rename(id)] ??= "your choice";
}

// ---- The areas' folders: an index and one small file per finding; and the list of all findings.
let summary = "";      // findings/README.md: every finding, by area
let areaIndex = "| Area | Findings | P0 | P1 | P2 | P3 | Refuted | In full |\n|---|---|---|---|---|---|---|---|\n"; // the main document's section 4
const totals = { findings: 0, confirmed: 0, corrected: 0, added: 0, refuted: 0, owner: 0, byKind: {}, byEffort: {}, byPriority: {} };
const seen = new Set();
const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
for (const area of AREAS) {
  const d = json(`${S}/findings/${area.key}.json`);
  const dir = `${OUT}/findings/${area.file}`;
  mkdirSync(dir, { recursive: true });
  const sorted = [...d.findings].sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9));
  let table = `| ID | Finding | Kind | Priority | Effort | Step |\n|---|---|---|---|---|---|\n`;
  for (const f of sorted) {
    const id = rename(f.id);
    if (seen.has(id)) console.log("DUPLICATE ID:", id);
    seen.add(id);
    const tick = f.verdict === "confirmed" || f.verdict === "corrected" ? " ✓" : "";
    const step = STEP_OF[id] ?? "?";
    if (plan && step === "?") console.log("NO STEP:", id, "|", f.priority, "|", f.title.slice(0, 80));
    totals.findings++; totals[f.verdict] = (totals[f.verdict] ?? 0) + 1; if (f.owner_decision) totals.owner++;
    totals.byKind[f.kind] = (totals.byKind[f.kind] ?? 0) + 1; totals.byEffort[f.effort] = (totals.byEffort[f.effort] ?? 0) + 1; totals.byPriority[f.priority] = (totals.byPriority[f.priority] ?? 0) + 1;
    let md = `# ${id}${tick} ${clean(f.title)}\n\n${area.title} (\`README.md\` beside this file), part of \`docs/audits/bloat-review-2026-11.md\`.\n\n- **Kind:** ${KIND[f.kind]}. **Priority:** ${f.priority}. **Effort:** ${f.effort}. **Confidence:** ${f.confidence}. **Step:** ${step}.${f.owner_decision ? " **The owner's choice.**" : ""}\n- **Second check:** ${f.verdict === "added" ? "added by the planner, not checked a second time" : f.verdict}.\n- **Where:** ${f.where.map((w) => `\`${clean(w)}\``).join(", ")}\n- **Evidence:** ${clean(f.evidence)}\n- **Cost today:** ${clean(f.cost)} Paid by: ${clean(f.who_pays)}\n- **Saving:** ${clean(f.saving)}\n- **Risk:** ${clean(f.risk)}\n${f.already_tracked && f.already_tracked !== "no" ? `- **Already tracked:** ${clean(f.already_tracked)}\n` : ""}\n## The fix\n\n${f.fix_steps.map((x, i) => `${i + 1}. ${clean(x).replace(/^(step\s*)?\d+[.):]\s*/i, "")}`).join("\n")}\n\n**Done when:** ${clean(f.done_when)}\n`;
    if (f.tests_and_rules.length) md += `\n**Tests and rules that hold today's behaviour, and change with it:**\n\n${f.tests_and_rules.map((x) => `- ${clean(x)}`).join("\n")}\n`;
    if (f.depends_on.length) md += `\n**Comes after:** ${f.depends_on.map((x) => rename(clean(x))).join("; ")}\n`;
    if (f.notes) md += `\n**Notes:** ${clean(f.notes)}\n`;
    writeFileSync(`${dir}/${id}.md`, md);
    table += `| [${id}](${id}.md)${tick} | ${cell(f.title)}${f.owner_decision ? " *(your choice)*" : ""} | ${KIND[f.kind]} | ${f.priority} | ${f.effort} | ${step} |\n`;
  }
  const count = (p) => d.findings.filter((f) => f.priority === p).length;
  let readme = `# ${area.title} (${area.prefix})\n\nPart of \`docs/audits/bloat-review-2026-11.md\`, on commit 0bd814c. Read by one reviewer, challenged by a second (who re-opened every citation, re-measured every number and applied the owner's note that the platform is not open yet) and planned by a third. A tick (✓) marks a finding the second reviewer confirmed or corrected; one the planner added has none. Each finding has a file of its own beside this one.\n\n**In short.** ${clean(d.headline)}\n\n## Findings\n\n${table}`;
  if (d.refuted.length) { totals.refuted += d.refuted.length; readme += `\n## Refuted by the second reviewer\n\nThese were in the first reading and did not hold. They are in no step.\n\n${d.refuted.map((r) => `- **${clean(r.title)}.** ${clean(r.why)}`).join("\n")}\n`; }
  readme += `\n## Measured\n\n| Measure | Value | How |\n|---|---|---|\n${d.metrics.map((m) => `| ${cell(m.name)} | ${cell(m.value)} | ${cell(m.how)} |`).join("\n")}\n\n## Well made, and should stay\n\n${d.clean.map((c) => `- ${clean(c)}`).join("\n")}\n`;
  writeFileSync(`${dir}/README.md`, readme);
  summary += `## ${area.title} (${area.prefix})\n\n${clean(d.headline).split(/(?<=[.!?])\s+/).slice(0, 2).join(" ")} Folder: \`${area.file}/\`.\n\n${table.replace(/\]\(([A-Z]+-\d+)\.md\)/g, `](${area.file}/$1.md)`)}\n`;
  areaIndex += `| ${area.title} | ${d.findings.length} | ${count("P0")} | ${count("P1")} | ${count("P2")} | ${count("P3")} | ${d.refuted.length} | \`findings/${area.file}/\` |\n`;
}
writeFileSync(`${OUT}/findings/README.md`, `# Every finding of the bloat review, by area\n\nPart of \`docs/audits/bloat-review-2026-11.md\`. One folder per area: its \`README.md\` has the area in short, its measures and what is well made; each finding has a small file of its own with the evidence, the fix in steps, the tests and rules that change with it, and the check that says it is done. A tick (✓) marks a finding that passed its second check. "Step" is the step of the plan that closes it; *tolerated* means an A lives with it; *your choice* means it is the owner's product choice.\n\n${summary}`);
if (plan) for (const id of Object.keys(STEP_OF)) if (!seen.has(id) && !/^(GAP-|L-)/.test(id)) console.log("PLAN NAMES A MISSING FINDING:", id, "->", STEP_OF[id]);

// ---- The scorecard, from the panel's cards.
let scorecard = "";
let ladder = "";
const cards = {};
if (existsSync(`${S}/panel`)) {
  scorecard = `| Area | Today | Why | Grade A when | Steps that get it there |\n|---|---|---|---|---|\n`;
  ladder = `| Area | Today | After phase 0 | After phase 1 | After phase 2 | After all |\n|---|---|---|---|---|---|\n`;
  for (const a of SCORE) {
    const cardPath = `${S}/panel/card-${a.key}.json`, stewardPath = `${S}/panel/steward-${a.key}.json`;
    if (existsSync(cardPath)) {
      const c = json(cardPath); cards[a.key] = c;
      const bar = c.bar_in_a_sentence ? clean(c.bar_in_a_sentence) : c.measures.map((m) => `${clean(m.name)}: ${clean(m.target_a)}`).join(". ");
      scorecard += `| ${a.title} | ${c.grade_today} | ${cell(clean(c.grade_reasons).split(/(?<=[.!?])\s+/).slice(0, 2).join(" "))} | ${cell(bar)} | ${c.steps_to_a.join(", ")} |\n`;
      ladder += `| ${a.title} | ${c.grade_today} | ${c.ladder.after_phase_0} | ${c.ladder.after_phase_1} | ${c.ladder.after_phase_2} | ${c.ladder.after_all} |\n`;
    } else if (existsSync(stewardPath)) {
      const c = json(stewardPath);
      const short = (t, n) => { t = clean(t); return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, "") + "…" : t; };
      scorecard += `| ${a.title} | ${c.grade_today} | ${cell(clean(c.grade_reasons).split(/(?<=[.!?])\s+/).slice(0, 2).join(" "))} | ${cell(c.measures.slice(0, 5).map((m) => `${short(m.name, 60)}: ${short(m.target_a, 90)}`).join(". "))} | ${plan?.ladders?.[a.key] ? [...(plan.ladders[a.key].to_b ?? []), ...(plan.ladders[a.key].to_a ?? [])].join(", ") : ""} |\n`;
      ladder += `| ${a.title} | ${c.grade_today} | ${c.ladder.after_now} | | ${c.ladder.after_next} | ${c.ladder.after_later} |\n`;
    }
  }
}
// Each area's bar in full: measures, today's value, the target and how it is measured.
let bars = "";
for (const a of SCORE) {
  const c = cards[a.key]; if (!c) continue;
  bars += `### ${a.title}\n\n**Today: ${c.grade_today}.** ${clean(c.grade_reasons)}\n\n| Measure | Today | Grade A | Measured by |\n|---|---|---|---|\n${c.measures.map((m) => `| ${cell(m.name)} | ${cell(m.today)} | ${cell(m.target_a)} | ${cell(m.how_measured)} |`).join("\n")}\n\n**Steps to an A:** ${c.steps_to_a.join(", ")}. **Can they reach it?** ${clean(c.can_the_steps_reach_a)}\n\n${c.tolerated?.length ? `**An A lives with:** ${c.tolerated.map(clean).join("; ")}\n\n` : ""}`;
}
writeFileSync(`${OUT}/grade-a-bars.md`, `# What grade A means, area by area\n\nPart of \`docs/audits/bloat-review-2026-11.md\` (its section 1 has the short form). Each area's bar was set by a steward, challenged by a second reviewer (is this truly an A; can the plan's steps reach it) and compared across areas by a critic. A grade is raised only for fixes seen working in production, measured as the table says.\n\n${bars || "The panel's cards are not written yet.\n"}`);

// ---- The plan's text and the Progress table.
let progress = "", planText = "", choices = "", tolerated = "";
if (plan) {
  rmSync(`${OUT}/plan`, { recursive: true, force: true });
  mkdirSync(`${OUT}/plan`, { recursive: true });
  const fileOf = (id) => { for (const a of AREAS) if (id.startsWith(a.prefix + "-")) return `../findings/${a.file}/${id}.md`; return null; };
  for (const ph of plan.phases) {
    progress += `**Phase ${ph.n}: ${clean(ph.title)}**\n\n| Step | What | Closes | Effort | Status | Notes |\n|---|---|---|---|---|---|\n`;
    planText += `### Phase ${ph.n}: ${clean(ph.title)}\n\n**Goal:** ${clean(ph.goal)} **A person will notice:** ${clean(ph.notice)} ${ph.steps.length} steps (${["S", "M", "L"].map((e) => `${ph.steps.filter((s) => s.effort === e).length} ${e}`).join(", ")}), in full in \`bloat-review-2026-11/plan/phase-${ph.n}.md\`.\n\n`;
    let file = `# Phase ${ph.n}: ${clean(ph.title)}\n\nPart of \`docs/audits/bloat-review-2026-11.md\`: its Progress table says where each step stands. **Goal:** ${clean(ph.goal)} **A person will notice:** ${clean(ph.notice)}\n\nEach step names the findings it closes; a finding's own file has the evidence, the fix in detail, and the tests and rules that change with it.\n`;
    for (const st of ph.steps) {
      const ids = st.closes.map(rename);
      progress += `| ${st.id} | ${cell(st.title)}${st.owner_question ? " *(owner)*" : ""} | ${ids.join(", ")} | ${st.effort} | Open | |\n`;
      file += `\n## ${st.id} ${clean(st.title).replace(/\.$/, "")}\n\n${clean(st.what)}\n\n- **Closes:** ${ids.map((id) => (fileOf(id) ? `[${id}](${fileOf(id)})` : id)).join(", ")}\n- **Effort:** ${st.effort}. **Areas it moves:** ${st.areas.map((k) => SCORE.find((x) => x.key === k)?.title ?? k).join("; ")}.\n- **Done when:** ${clean(st.done_when)}\n- **Platform:** ${clean(st.platform)}\n${st.owner_question ? `- **The owner's question first:** ${clean(st.owner_question)}\n` : ""}`;
    }
    progress += "\n";
    writeFileSync(`${OUT}/plan/phase-${ph.n}.md`, file);
  }
  const asked = plan.phases.flatMap((p) => p.steps).filter((s) => s.owner_question);
  let n = 0;
  choices = [...asked.map((s) => `${++n}. **Step ${s.id}, ${clean(s.title).replace(/\.$/, "")}.** ${clean(s.owner_question)}`), ...(plan.owner_choices ?? []).map((c) => `${++n}. ${clean(c.question)} (${c.finding_ids.map(rename).join(", ")})`)].join("\n");
  tolerated = (plan.tolerated ?? []).map((t) => `- **${rename(t.finding_id)}.** ${clean(t.why)}`).join("\n");
}
const steps = plan ? plan.phases.flatMap((p) => p.steps) : [];
const counts = { STEPS: steps.length, PHASES: plan?.phases.length ?? 0, FINDINGS: totals.findings, CONFIRMED: totals.confirmed ?? 0, CORRECTED: totals.corrected ?? 0, ADDED: totals.added ?? 0, REFUTED: totals.refuted, NOCHECK: totals.byKind.process ?? 0, P0: totals.byPriority.P0 ?? 0, P1: totals.byPriority.P1 ?? 0, P2: totals.byPriority.P2 ?? 0, P3: totals.byPriority.P3 ?? 0, EAGER: totals.byKind.eager ?? 0, OVERSIZE: totals.byKind.oversize ?? 0, DUPLICATE: totals.byKind.duplicate ?? 0, DEAD: totals.byKind.dead ?? 0, AHEAD: totals.byKind.speculative ?? 0, SMALL: totals.byEffort.S ?? 0, MEDIUM: totals.byEffort.M ?? 0, LARGE: totals.byEffort.L ?? 0, OWNER: totals.owner, TOLERATED_COUNT: plan?.tolerated?.length ?? 0 };
writeFileSync(`${S}/work/findings-totals.json`, JSON.stringify({ totals, counts }, null, 1));
console.log(JSON.stringify(counts));

// ---- Evidence: the readable summaries.
const trimList = (line, n) => { const i = line.indexOf(": "); if (i < 0) return line; const items = line.slice(i + 2).replace(/\.$/, "").split(", "); return items.length <= n ? line : `${line.slice(0, i + 2)}${items.slice(0, n).join(", ")}, and ${items.length - n} more.`; };
const NAMES = { "prod-db-stats.md": "production-database.md", "prod-pages.md": "production-pages.md", "dead.md": "unused-code.md", "clones.md": "copied-code.md", "chunks.md": "server-and-client-by-route.md", "loaded.md": "scripts-by-page.md" };
for (const f of ["routes.md", "prod-db-stats.md", "prod-pages.md", "prefetch-storm.md", "dead.md", "clones.md", "chunks.md", "loaded.md"]) {
  if (!existsSync(`${S}/m/${f}`)) continue;
  let text = readFileSync(`${S}/m/${f}`, "utf8").replace(/\/tmp\/claude-0\/[^\s`)]*scratchpad\/work\//g, "scripts/").replace(/<scratch>\/work\//g, "scripts/").replace(/`work\//g, "`scripts/");
  const n = f === "loaded.md" ? 22 : f === "chunks.md" ? 14 : 0;
  if (n) { const out = []; let rows = 0; for (const line of text.split("\n")) { if (/^(Largest|By package|First load by|Loadable later|Server \(|Server, behind|Traced files)/.test(line)) { out.push(trimList(line, n)); continue; } if (line.startsWith("| `")) { rows++; if (rows > 8) continue; } else if (!line.startsWith("|")) rows = 0; out.push(line); } text = out.join("\n"); }
  writeFileSync(`${OUT}/evidence/${NAMES[f] ?? f}`, text);
}

// ---- How far the panel has come, said truthfully.
const haveCards = SCORE.every((a) => existsSync(`${S}/panel/card-${a.key}.json`));
const reviewed = existsSync(`${S}/panel/weave-review.md`);
const criticDone = existsSync(`${S}/panel/critic.json`);
const panelState = haveCards && criticDone
  ? "A reviewer went over the plan as someone who must carry it out; a challenger per area tested whether the bar is truly an A and whether the plan's steps reach it; one critic compared the grades across areas."
  : `**Not finished as this is written:** ${[reviewed ? null : "the plan's reviewer (steps may still be split, joined or moved between phases)", haveCards ? null : "a challenger per area (is the bar truly an A; can the plan's steps reach it)", criticDone ? null : "the critic who compares grades across areas"].filter(Boolean).join("; ")}. Until then the grades and bars below are the stewards' own.`;

// ---- The folder's index.
writeFileSync(`${OUT}/README.md`, `# Bloat review, November 2026: the plan in full, the findings, the bars, the evidence

The review is \`docs/audits/bloat-review-2026-11.md\`: read it first. Its Progress table lists every step. This folder holds
what stands behind it. Open the file of the step or the finding you are working on, not the folder.

| Here | What |
|---|---|
| \`plan/phase-N.md\` | each phase's steps in full: what to change, the findings it closes, the check that says it is done, what it means for the platform |
| \`findings/README.md\` | every finding by area, with its priority and the step that closes it |
| \`findings/<area>/README.md\` | one area in short: its findings, what was refuted, its measures, what is well made |
| \`findings/<area>/<ID>.md\` | one finding: where, the evidence, the cost today, the fix in steps, the tests and rules that change with it, done-when, risk |
| \`grade-a-bars.md\` | what grade A means for each area: the measures, today's values, the targets and how each is measured |
| \`evidence/\` | the measurements (below) |
| \`scripts/\` | what made them |

## evidence/

| File | What it is |
|---|---|
| \`routes.md\` | 32 pages of the production build in a browser: bytes by kind, what each document is made of, requests after load, script bytes that ran |
| \`scripts-by-page.md\` | for 14 of those pages, the scripts really loaded, matched to source modules |
| \`server-and-client-by-route.md\` | for 19 routes, the modules the server loads and the client code reachable, from Next's analyzer |
| \`spike.md\` | two import edits measured in a copy (the plan's import-hub step) |
| \`production-database.md\` | production's statistics on 11 November, read before the reviewers checked them: sizes, tables with no row yet, the costliest and most-called statements, the schedule; and the queries, to run them again. Two of its first readings were corrected by the reviewers: a round of jobs takes about 1.3 s, not the sum of its jobs' times, and status checks are pruned at 91 days |
| \`production-pages.md\` | three production documents, to check the local shares |
| \`prefetch-storm.md\` | the prefetch loop on \`/s/\` listing and search pages, as first seen (its cause is in \`findings/prefetching/PF-1.md\`) |
| \`unused-code.md\`, \`copied-code.md\` | the two scans' first lists of suspects (checked in \`findings/unused-code/\` and \`findings/copied-code/\`) |

## scripts/

Run from the repository root. They were written for this review on one machine; a step of the plan makes them commands.

\`\`\`bash
pnpm build                                    # as CI's signed-in job builds it
pnpm start --port 3000 &                      # with e2e/fixtures/auth-stub.mjs beside it, for the admin pages
E2E_SIGNED_IN=1 pnpm exec playwright test --project=signed-in-setup   # saves e2e/.auth/owner.json and admin.json
node docs/audits/bloat-review-2026-11/scripts/measure-routes.mjs out '{"product":"<a product id of e2e-shop>","pageId":"<a page id of e2e-shop>"}'
node docs/audits/bloat-review-2026-11/scripts/routes-table.mjs out      # routes.json to routes.md
node docs/audits/bloat-review-2026-11/scripts/storm.mjs "http://localhost:3000/s/demo/no/search?q=lampe" 8 phone

pnpm exec next analyze --output               # about 8 minutes; writes .next/diagnostics/analyze
node docs/audits/bloat-review-2026-11/scripts/server-graph.mjs out      # modules and KB per route, server and client
node docs/audits/bloat-review-2026-11/scripts/scripts-by-page.mjs out   # needs out/routes.json and the analyzer's data

node docs/audits/bloat-review-2026-11/scripts/unused-code.mjs out       # files and exports nothing uses (suspects)
node docs/audits/bloat-review-2026-11/scripts/copied-code.mjs out       # exact copies
\`\`\`

\`PLAYWRIGHT_CHROMIUM_PATH\` names the browser where one is preinstalled; \`BASE_URL\` another address than \`http://localhost:3000\`.
`);

// ---- The main document.
const template = readFileSync(`${S}/work/main-template.md`, "utf8");
let main = template.replace("{{PANEL_STATE}}", panelState).replace("{{PROGRESS}}", progress.trimEnd()).replace("{{SCORECARD}}", scorecard.trimEnd()).replace("{{LADDER}}", ladder.trimEnd()).replace("{{FINDINGS_TABLES}}", areaIndex).replace("{{PLAN}}", planText).replace("{{CHOICES}}", choices).replace("{{TOLERATED}}", tolerated);
for (const [k, v] of Object.entries(counts)) main = main.replaceAll(`{{${k}}}`, String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ","));
const left = main.match(/\{\{[A-Z0-9_]+\}\}/g);
if (left) console.log("UNFILLED:", [...new Set(left)].join(", "));
writeFileSync("/home/user/kaizen-store/docs/audits/bloat-review-2026-11.md", main);
console.log("main doc bytes:", main.length, "lines:", main.split("\n").length);
