#!/usr/bin/env node
// Bloat review: a compact digest of each area's verified and planned findings, for the grade panel.  node digest.mjs <scratchpad>
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
const S = process.argv[2];
mkdirSync(`${S}/digest`, { recursive: true });
const cut = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").replace(/\/home\/user\/kaizen-store\//g, "").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const rename = (id) => String(id).replace(/^FN-/, "SF-");
let index = "";
const all = [];
for (const file of readdirSync(`${S}/findings`).filter((f) => f.endsWith(".json")).sort()) {
  const d = JSON.parse(readFileSync(`${S}/findings/${file}`, "utf8"));
  const key = file.replace(".json", "");
  let md = `# ${key}: ${d.title}\n\n${cut(d.headline, 1400)}\n\n## Measures\n${d.metrics.map((m) => `- ${cut(m.name, 110)}: ${cut(m.value, 260)}`).join("\n")}\n\n## Well made\n${d.clean.map((c) => `- ${cut(c, 260)}`).join("\n")}\n\n## Findings (${d.findings.length})\n`;
  for (const f of d.findings) {
    const id = rename(f.id);
    all.push({ key, id, title: f.title, priority: f.priority, effort: f.effort, kind: f.kind, verdict: f.verdict, owner: f.owner_decision });
    md += `\n### ${id} [${f.priority} ${f.effort} ${f.kind} ${f.verdict}${f.owner_decision ? " OWNER-CHOICE" : ""}] ${cut(f.title, 220)}\n- evidence: ${cut(f.evidence, 420)}\n- cost: ${cut(f.cost, 220)} (${cut(f.who_pays, 80)})\n- fix: ${f.fix_steps.length} steps; first: ${cut(f.fix_steps[0], 260)}\n- done when: ${cut(f.done_when, 320)}\n- saving: ${cut(f.saving, 260)}\n- after: ${f.depends_on.map(rename).join("; ").slice(0, 160) || "nothing"}${f.already_tracked && f.already_tracked !== "no" ? `\n- tracked: ${cut(f.already_tracked, 160)}` : ""}${f.notes ? `\n- notes: ${cut(f.notes, 260)}` : ""}\n`;
  }
  if (d.refuted.length) md += `\n## Refuted (not findings)\n${d.refuted.map((r) => `- ${rename(r.id)} ${cut(r.title, 120)}: ${cut(r.why, 220)}`).join("\n")}\n`;
  writeFileSync(`${S}/digest/${key}.md`, md);
  index += `${key}: ${d.findings.length} findings (${["P0", "P1", "P2", "P3"].map((p) => `${p} ${d.findings.filter((f) => f.priority === p).length}`).join(", ")}), ${d.refuted.length} refuted, ${md.length} bytes\n`;
}
writeFileSync(`${S}/digest/INDEX.txt`, index);
writeFileSync(`${S}/digest/all-findings.json`, JSON.stringify(all));
const ids = all.map((a) => a.id); const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
console.log(index + `total ${all.length} findings; duplicate ids: ${[...new Set(dup)].join(", ") || "none"}`);
