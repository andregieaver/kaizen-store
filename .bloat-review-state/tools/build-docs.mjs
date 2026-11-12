#!/usr/bin/env node
// Builds the bloat review's folder in the repo from the audits and the evidence (scratch tool of the review).
//   node build-docs.mjs
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";

const S = "/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad";
const OUT = "/home/user/kaizen-store/docs/audits/bloat-review-2026-11";
mkdirSync(`${OUT}/findings`, { recursive: true });
mkdirSync(`${OUT}/evidence`, { recursive: true });

export const AREAS = [
  { key: "storefront-client", file: "storefront-browser", prefix: "SC", title: "What a shopper's browser loads" },
  { key: "storefront-data", file: "storefront-server", prefix: "SD", title: "What the server does for a storefront request" },
  { key: "admin-client", file: "admin-browser", prefix: "AC", title: "What an owner's browser loads in the admin" },
  { key: "admin-data", file: "admin-server", prefix: "AD", title: "What the server does for an admin navigation" },
  { key: "caching", file: "caching", prefix: "CA", title: "Caching and rendering" },
  { key: "cron", file: "scheduled-work", prefix: "CR", title: "Scheduled and background work" },
  { key: "db-queries", file: "queries", prefix: "DQ", title: "How data is asked for" },
  { key: "db-schema", file: "database-shape", prefix: "DS", title: "The database's shape" },
  { key: "deps", file: "dependencies", prefix: "DP", title: "Dependencies" },
  { key: "assets", file: "files", prefix: "AS", title: "Files that ship or are stored" },
  { key: "ai-context", file: "ai-calls", prefix: "AI", title: "What every AI call carries" },
  { key: "features", file: "features", prefix: "FT", title: "The product's surface" },
  { key: "families", file: "families", prefix: "FM", title: "Families and twins" },
  { key: "docs-context", file: "written-rules", prefix: "DC", title: "The written rules and the agents' context" },
  { key: "page-model", file: "page-builder-model", prefix: "PM", title: "The page builder's model and a built page's render" },
  { key: "css", file: "styles", prefix: "CS", title: "Styles" },
  { key: "i18n", file: "interface-text", prefix: "TX", title: "Interface text" },
  { key: "tests-ci", file: "tests-ci-build", prefix: "TC", title: "Tests, CI and the build" },
  { key: "functions", file: "server-functions", prefix: "SF", title: "Server functions: size, cold start, per-request overhead" },
  { key: "server-graph", file: "server-module-graph", prefix: "SG", title: "The server code every route loads" },
  { key: "client-bundles", file: "client-bundles", prefix: "BN", title: "The built client bundles, by page" },
  { key: "page-payload", file: "page-payload", prefix: "PL", title: "What a page sends: HTML, RSC payload and requests" },
  { key: "prefetch", file: "prefetching", prefix: "PF", title: "Prefetching: what the router asks for unasked" },
  { key: "unused-code", file: "unused-code", prefix: "DD", title: "Code nothing uses" },
  { key: "copied-code", file: "copied-code", prefix: "CP", title: "Copied code, measured" },
];

// Which step of the plan closes each finding.
export const STEP_OF = {};
const assign = (step, ids) => { for (const id of ids.split(/[ ,]+/).filter(Boolean)) STEP_OF[id] = step; };
assign("0.1", "FM-2 DS-1 DP-1");
assign("0.2", "AS-1 DP-2");
assign("0.3", "CR-1 DQ-1 DP-7 CR-6 CR-7 CR-12");
assign("0.4", "CR-2 CR-3 DQ-5 FT-3 DS-3 CR-8 CR-9 CR-11");
assign("0.5", "CR-5 DS-8");
assign("0.6", "DQ-2 CA-3 SD-4");
assign("0.7", "DQ-8 DS-7");
assign("0.8", "DQ-9 CA-9 SD-10 DQ-12 DS-2 SD-7 CA-12 DQ-4 AI-2");
assign("0.9", "CA-4 SC-1 CA-5 AC-12 SC-10");
assign("0.10", "AC-1 DP-4");
assign("0.11", "SC-9 CA-6");
assign("0.12", "CA-8 AS-5 AS-4");
assign("1.2", "AS-3 DP-6 SD-13 FM-13");
assign("1.3", "AC-10 AC-11 SC-6");
assign("1.4", "DQ-11 AD-12 CR-14");
assign("1.5", "FT-2 DS-12");
assign("1.6", "AI-10 DC-3");
assign("2.1", "FM-1 SC-3 AC-4 AC-6 AC-7 AC-9");
assign("2.2", "CA-1 SC-8 SC-7");
assign("2.3", "SD-2 SD-5 SD-9 SD-11 SD-12");
assign("2.4", "SC-2 SC-4 SC-11 SC-5 AS-7");
assign("2.5", "AC-2 AC-3 DP-5 AC-5 AC-8 AI-4");
assign("2.6", "AD-1 AD-2 AD-3 AD-4 AD-5 AD-6 AD-7 AD-8 AD-9 AD-11 AI-12");
assign("2.7", "CA-2 CA-10 SD-8 SD-3 CA-11 CA-13 CA-14 CA-7");
assign("2.8", "SD-1 SD-6 DP-3 AS-2");
assign("2.9", "AI-1 AI-3 AI-6 AI-8 AI-9 AI-11 AI-7");
assign("2.10", "CR-4 DQ-6 DS-5 AI-5 DQ-3 DS-10 CR-10 CR-13 DS-13 DS-4 DQ-10 DQ-7");
assign("3.1", "FT-1 FT-4 FT-7 FT-14");
assign("3.2", "FT-5 FM-3 DS-6");
assign("3.3", "FT-10 FM-5 FM-4");
assign("3.4", "FT-8 FT-9 FT-13 FT-12");
assign("3.5", "FT-6 FT-11 FM-9");
assign("4.1", "DS-9 DS-14 DS-11 DQ-13 DQ-14 AD-10");
assign("4.2", "FM-6 FM-7 FM-8 FM-10 FM-11 FM-12");
assign("4.3", "DP-8 DP-9 AS-6");
assign("4.4", "DC-1 DC-2 DC-4 DC-5 DC-6 DC-7 DC-8 DC-9 DC-10 DC-11 AS-8");

// Findings the lead checked a second time, against the code, the build or production.
export const CHECKED = new Set("FM-2 DS-1 DP-1 CR-1 CR-2 DQ-1 CR-5 DS-8 DQ-2 CA-3 SD-4 DQ-8 DS-7 DQ-9 CA-9 DQ-12 DS-2 SD-7 CA-12 CA-1 CA-4 CA-5 SC-9 CA-6 AC-1 DP-4 SC-3 AS-1 AS-2 AI-1 DC-1 SC-1".split(" "));

const clean = (s) => String(s).replace(/\/home\/user\/kaizen-store\//g, "").replace(/\/tmp\/claude-0\/[^\s;,)]*scratchpad\/m\//g, "evidence/").replace(/\/tmp\/claude-0\/[^\s;,)]*scratchpad\/work\//g, "scripts/").replace(/\s+/g, " ").trim();
const cell = (s) => clean(s).replace(/\|/g, "\\|");
const KIND = { dead: "dead", duplicate: "duplicate", eager: "eager", oversize: "oversize", speculative: "ahead of use", process: "no check" };

let summary = "";
const totals = { findings: 0, checked: 0, owner: 0, refuted: 0, added: 0, byKind: {}, byEffort: {}, areas: 0, areasChecked: 0 };
const rename = (id) => String(id).replace(/^FN-/, "SF-"); // the code review's FN is navigation; server functions are SF here
const seenIds = new Set();
for (const area of AREAS) {
  const verifiedPath = `${S}/findings/${area.key}.json`;
  const auditPath = `${S}/audits/${area.key}.json`;
  const verified = existsSync(verifiedPath);
  if (!verified && !existsSync(auditPath)) { console.log("NO REPORT:", area.key); continue; }
  const d = JSON.parse(readFileSync(verified ? verifiedPath : auditPath, "utf8"));
  totals.areas++; if (verified) totals.areasChecked++;
  const how = verified
    ? "Read by one reviewer, challenged by a second (who re-opened every citation and re-measured every number, with the owner's note that the platform is not open yet) and planned by a third. A tick (✓) marks a finding the second reviewer confirmed or corrected; a finding the planner added has no tick unless the lead checked it."
    : "One reviewer's reading of this area. A tick (✓) marks a finding the lead checked a second time; the others were not checked.";
  let md = `# ${area.title} (${area.prefix})\n\nPart of \`docs/audits/bloat-review-2026-11.md\`, on commit 0bd814c. ${how} "Step" is the step of the plan that closes the finding.\n\n**In short.** ${clean(d.headline)}\n\n## Measured\n\n| Measure | Value | How |\n|---|---|---|\n`;
  for (const m of d.metrics) md += `| ${cell(m.name)} | ${cell(m.value)} | ${cell(m.how)} |\n`;
  md += `\n## Well made, and should stay\n\n${d.clean.map((c) => `- ${clean(c)}`).join("\n")}\n\n## Findings\n`;
  summary += `### ${area.title} (${area.prefix})\n\n${clean(d.headline).split(/(?<=[.!?])\s+/).slice(0, 2).join(" ")} In full: \`bloat-review-2026-11/findings/${area.file}.md\`.\n\n| ID | Finding | Kind | Effort | Step |\n|---|---|---|---|---|\n`;
  for (const f of d.findings) {
    const id = rename(f.id);
    if (seenIds.has(id)) console.log("DUPLICATE ID:", id);
    seenIds.add(id);
    const second = verified && (f.verdict === "confirmed" || f.verdict === "corrected");
    const tick = second || CHECKED.has(id) ? " ✓" : "";
    const step = STEP_OF[id] ?? "?";
    if (step === "?") console.log("NO STEP:", id, "|", f.title, "|", f.priority ?? "", f.effort, f.kind);
    totals.findings++; if (tick) totals.checked++; if (f.owner_decision) totals.owner++; if (f.verdict === "added") totals.added++;
    totals.byKind[f.kind] = (totals.byKind[f.kind] ?? 0) + 1; totals.byEffort[f.effort] = (totals.byEffort[f.effort] ?? 0) + 1;
    md += `\n### ${id}${tick} ${clean(f.title)}\n\n- **Kind:** ${KIND[f.kind]}. **Effort:** ${f.effort}.${f.priority ? ` **Priority:** ${f.priority}.` : ""} **Confidence:** ${f.confidence}. **Step:** ${step}.${f.owner_decision ? " **The owner's decision.**" : ""}${verified ? ` **Second check:** ${f.verdict === "added" ? "added by the planner, not checked a second time" : f.verdict}.` : ""}\n- **Where:** ${f.where.map((w) => `\`${clean(w)}\``).join(", ")}\n- **Evidence:** ${clean(f.evidence)}\n- **Cost today:** ${clean(f.cost)} Paid by: ${clean(f.who_pays)}\n`;
    if (verified) {
      md += `- **Fix:**\n${f.fix_steps.map((x, i) => `  ${i + 1}. ${clean(x).replace(/^\d+[.)]\s*/, "")}`).join("\n")}\n`;
      if (f.tests_and_rules.length) md += `- **Tests and rules that hold today's behaviour:** ${f.tests_and_rules.map(clean).join("; ")}\n`;
      if (f.depends_on.length) md += `- **Comes after:** ${f.depends_on.map((x) => rename(clean(x))).join("; ")}\n`;
      md += `- **Done when:** ${clean(f.done_when)}\n`;
    } else md += `- **Fix:** ${clean(f.fix)}\n`;
    md += `- **Saving:** ${clean(f.saving)}\n- **Risk:** ${clean(f.risk)}\n${f.notes ? `- **Notes:** ${clean(f.notes)}\n` : ""}${f.already_tracked && f.already_tracked !== "no" ? `- **Already tracked:** ${clean(f.already_tracked)}\n` : ""}`;
    summary += `| ${id}${tick} | ${cell(f.title)}${f.owner_decision ? " *(owner)*" : ""} | ${KIND[f.kind]} | ${f.effort} | ${step} |\n`;
  }
  if (verified && d.refuted.length) {
    totals.refuted += d.refuted.length;
    md += `\n## Refuted by the second reviewer\n\nThese were in the first reading and did not hold. They are in no step.\n\n${d.refuted.map((r) => `- **${rename(r.id)} ${clean(r.title)}.** ${clean(r.why)}`).join("\n")}\n`;
    summary += `\nRefuted on the second check and in no step: ${d.refuted.map((r) => `${rename(r.id)} (${cell(r.title)})`).join("; ")}.\n`;
  }
  summary += "\n";
  writeFileSync(`${OUT}/findings/${area.file}.md`, md);
}
for (const id of Object.keys(STEP_OF)) if (!seenIds.has(id)) console.log("STEP MAPS A MISSING FINDING:", id, "->", STEP_OF[id]);
writeFileSync(`${S}/work/findings-summary.md`, summary);
writeFileSync(`${S}/work/findings-totals.json`, JSON.stringify(totals));
console.log(totals);

// Evidence: the readable summaries, not the raw data.
for (const f of ["routes.md", "prod-db-stats.md", "prod-pages.md", "prefetch-storm.md", "dead.md", "clones.md", "chunks.md", "loaded.md"]) {
  if (!existsSync(`${S}/m/${f}`)) continue;
  let text = readFileSync(`${S}/m/${f}`, "utf8").replace(/\/tmp\/claude-0\/[^\s`)]*scratchpad\/work\//g, "scripts/").replace(/<scratch>\/work\//g, "scripts/").replace(/`work\//g, "`scripts/");
  const name = f === "prod-db-stats.md" ? "production-database.md" : f === "prod-pages.md" ? "production-pages.md" : f === "dead.md" ? "unused-code.md" : f === "clones.md" ? "copied-code.md" : f === "chunks.md" ? "server-and-client-by-route.md" : f === "loaded.md" ? "scripts-by-page.md" : f;
  writeFileSync(`${OUT}/evidence/${name}`, text);
}

// Trim the two long evidence lists: the full lists stay reproducible with the scripts.
const trimList = (line, n) => { const i = line.indexOf(": "); if (i < 0) return line; const items = line.slice(i + 2).replace(/\.$/, "").split(", "); return items.length <= n ? line : `${line.slice(0, i + 2)}${items.slice(0, n).join(", ")}, and ${items.length - n} more.`; };
for (const [name, n] of [["scripts-by-page.md", 22], ["server-and-client-by-route.md", 14]]) {
  const lines = readFileSync(`${OUT}/evidence/${name}`, "utf8").split("\n");
  const out = []; let rows = 0;
  for (const line of lines) {
    if (/^(Largest|By package|First load by|Loadable later|Server \(|Server, behind|Traced files)/.test(line)) { out.push(trimList(line, n)); continue; }
    if (line.startsWith("| `")) { rows++; if (rows > 8) continue; } else if (!line.startsWith("|")) rows = 0;
    out.push(line);
  }
  writeFileSync(`${OUT}/evidence/${name}`, out.join("\n"));
}

writeFileSync(`${OUT}/evidence/spike.md`, `# The two hub edits, measured in a copy (11 Nov 2026)

A throwaway copy of commit 0bd814c with exactly two edits, then \`next analyze --output\` and \`scripts/server-graph.mjs\`'s reading
of it. Nothing was type-checked or deployed: it measures the saving, it is not the fix.

1. In \`src/app/api/visit/route.ts\`, \`touch/route.ts\`, \`speed/route.ts\` and \`speed/own/route.ts\`:
   \`import { sameSite } from "@/server/chat-route"\` became \`import { sameSite } from "@/lib/same-site"\` (the chat module only
   re-exports it, at line 38).
2. In \`src/db/client.ts\`: \`import * as schema\` became \`import type * as schema\`, and \`drizzle({ client: pool, schema })\`
   became \`drizzle({ client: pool })\`.

| Route | Server code loaded with the route, before | After |
|---|---|---|
| /api/visit | 10,475 KB in 1,890 modules | 1,188 KB in 639 modules |
| /api/health | 1,155 KB in 308 modules | 417 KB in 259 modules |
| /api/shop/tiles | 10,478 KB in 1,893 modules | 9,863 KB in 1,887 modules |
| /s/[store]/[market] | 11,944 KB in 2,419 modules | 11,329 KB in 2,413 modules |
| /admin/[store] | 12,316 KB in 2,414 modules | 11,702 KB in 2,408 modules |

\`src/db/schema.ts\` (597 KB built) left every route. \`src/lib/admin-messages\` in the visit beacon fell from 2,903 KB to 85 KB;
the other routes still load all of it (step 2.1). What the beacon still loads comes through \`recordVisit()\` and \`getOpenStore()\`.
`);

// The main document.
const { PHASES } = await import("./plan-data.mjs");
let progress = "";
let plan = "";
for (const ph of PHASES) {
  progress += `**Phase ${ph.n}: ${ph.title}**\n\n| Step | What | Closes | Effort | Status | Notes |\n|---|---|---|---|---|---|\n`;
  plan += `### Phase ${ph.n}: ${ph.title}\n\n**Goal:** ${ph.goal} **A person will notice:** ${ph.notice}\n\n`;
  for (const st of ph.steps) {
    const owner = /owner's question/.test(st.done) ? " *(owner)*" : "";
    progress += `| ${st.id} | ${st.title}${owner} | ${st.closes.replace(/ ✓/g, "")} | ${st.effort} | Open | |\n`;
    plan += `${st.id.split(".")[1]}. **${st.title}.** ${st.what} Closes ${st.closes}. ${st.effort}. Done when: ${st.done} Platform: ${st.platform}\n`;
  }
  progress += "\n"; plan += "\n";
}
// Every finding has a step that names it.
const named = new Set(PHASES.flatMap((p) => p.steps).flatMap((s) => s.closes.replace(/ ✓/g, "").split(/,\s*/)));
for (const id of Object.keys(STEP_OF)) if (!named.has(id)) console.log("step text does not name", id, "(mapped to", STEP_OF[id] + ")");
for (const st of PHASES.flatMap((p) => p.steps)) for (const id of st.closes.replace(/ ✓/g, "").split(/,\s*/)) if (/^[A-Z]{2}-\d+$/.test(id) && STEP_OF[id] !== st.id) console.log("mismatch", id, "step", st.id, "map", STEP_OF[id]);
const main = readFileSync(`${S}/work/main-template.md`, "utf8").replace("{{PROGRESS}}", progress.trimEnd()).replace("{{FINDINGS}}", summary).replace("{{PLAN}}", plan);
writeFileSync("/home/user/kaizen-store/docs/audits/bloat-review-2026-11.md", main);
console.log("main doc bytes:", main.length, "lines:", main.split("\n").length);
