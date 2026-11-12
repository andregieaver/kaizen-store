#!/usr/bin/env node
// Bloat review, grade panel: one compact file of all stewards' work, and a first grouping of work items that name the same findings.
import { readFileSync, writeFileSync } from "node:fs";
const S = process.argv[2];
const AREAS = ["code", "shopper-browser", "owner-browser", "server", "scheduled", "database", "ai", "surface", "rules", "page-model", "styles", "text", "build"];
const cut = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const all = JSON.parse(readFileSync(`${S}/digest/all-findings.json`, "utf8"));
const info = new Map(all.map((f) => [f.id, f]));
let md = "# The thirteen stewards' work, compact\n\nEach work item: W-<area>-<n> [phase effort, serves] title | closes (own findings) | same fault elsewhere (also) | done when | moves.\n";
const items = [];
for (const a of AREAS) {
  const d = JSON.parse(readFileSync(`${S}/panel/steward-${a}.json`, "utf8"));
  md += `\n## ${a}: ${d.title}\nToday ${d.grade_today}; after now ${d.ladder.after_now}, after next ${d.ladder.after_next}, after later ${d.ladder.after_later}. ${cut(d.grade_reasons, 420)}\n\nMeasures (today -> the bar for an A; how measured):\n${d.measures.map((m) => `- ${cut(m.name, 90)}: ${cut(m.today, 150)} -> ${cut(m.target_a, 150)} (${cut(m.how_measured, 130)})`).join("\n")}\n\nWork items:\n`;
  d.work_items.forEach((w, i) => {
    const id = `W-${a}-${i + 1}`;
    items.push({ id, area: a, ids: w.finding_ids ?? [], also: w.also_ids ?? [], title: w.title, phase: w.phase });
    md += `- ${id} [${w.phase} ${w.effort}${w.serves && w.serves !== a ? `, serves ${w.serves}` : ""}${w.owner_decision ? ", OWNER" : ""}] ${cut(w.title, 170)} | closes ${(w.finding_ids ?? []).join(", ") || "-"}${(w.also_ids ?? []).length ? ` | also ${(w.also_ids ?? []).join(", ")}` : ""} | done when: ${cut(w.done_when, 230)} | moves: ${cut(w.moves, 150)}\n`;
  });
  md += `\nTolerated: ${d.tolerated.map((t) => `${t.finding_id} (${cut(t.why, 110)})`).join("; ") || "none"}\n\nThe owner's choices:\n${d.owner_choices.map((c) => `- ${(c.finding_ids ?? []).join(", ")}: ${cut(c.question, 260)}`).join("\n") || "- none"}\n\nGaps (an A needs these; no finding covers them):\n${d.gaps.map((g, i) => `- GAP-${a}-${i + 1} ${cut(g.title, 150)}: ${cut(g.proposed_work_item, 330)}`).join("\n") || "- none"}\n`;
}
writeFileSync(`${S}/panel/stewards-compact.md`, md);
// Group work items linked by a shared finding id (own or also).
const parent = new Map(items.map((w) => [w.id, w.id]));
const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
const owner = new Map();
for (const w of items) for (const id of w.ids) owner.set(id, w.id);
for (const w of items) for (const id of w.also) if (owner.has(id) && owner.get(id) !== w.id) parent.set(find(w.id), find(owner.get(id)));
const groups = new Map();
for (const w of items) { const r = find(w.id); groups.set(r, [...(groups.get(r) ?? []), w]); }
const multi = [...groups.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length);
let cl = `# Work items that name the same findings (grouped by a script: a hint for merging, not a decision)\n\n${multi.length} groups of two or more, out of ${items.length} work items. A large group may be several steps that only touch; split it by what one engineer changes in one go.\n`;
multi.forEach((g, i) => { cl += `\n## Group ${i + 1} (${g.length} items; findings ${[...new Set(g.flatMap((w) => w.ids))].join(", ")})\n${g.map((w) => `- ${w.id} [${w.phase}] ${cut(w.title, 150)}`).join("\n")}\n`; });
writeFileSync(`${S}/panel/clusters.md`, cl);
const unowned = [...new Set(items.flatMap((w) => w.also))].filter((id) => !owner.has(id) && info.has(id));
console.log(`work items ${items.length}; groups of 2+: ${multi.length} (largest ${multi[0]?.length}); compact ${md.length} bytes; clusters ${cl.length} bytes; also-ids owned by nobody's work item: ${unowned.length}`);
