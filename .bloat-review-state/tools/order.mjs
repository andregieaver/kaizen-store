#!/usr/bin/env node
// Bloat review: the order of the steps, from the briefs' depends_on.  node order.mjs  -> work/order.md, and problems on stdout
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const S = "/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad";
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const planPath = [`${S}/panel/plan.exec.json`, `${S}/panel/plan.final.json`].find((p) => existsSync(p));
const plan = json(planPath);
const steps = plan.phases.flatMap((ph) => ph.steps.map((s) => ({ ...s, phase: ph.n })));
const byId = new Map(steps.map((s) => [s.id, s]));
const num = (id) => id.split(".").map(Number);
const cmp = (a, b) => num(a)[0] - num(b)[0] || num(a)[1] - num(b)[1];
const briefs = new Map();
for (const s of steps) if (existsSync(`${S}/exec/${s.id}.json`)) briefs.set(s.id, json(`${S}/exec/${s.id}.json`));
const deps = (id) => (briefs.get(id)?.depends_on ?? []).map((d) => d.id).filter((d) => byId.has(d));
const problems = [];
for (const s of steps) {
  if (!briefs.has(s.id)) problems.push(`no brief: ${s.id}`);
  for (const d of deps(s.id)) if (byId.get(d).phase > s.phase) problems.push(`step ${s.id} (phase ${s.phase}) comes after step ${d} of a later phase`);
}
// Order inside each phase: a step after the steps it builds on; otherwise by number.
const order = [];
const done = new Set();
for (const ph of plan.phases) {
  const left = ph.steps.map((s) => s.id).sort(cmp);
  while (left.length) {
    const i = left.findIndex((id) => deps(id).every((d) => done.has(d) || byId.get(d).phase > ph.n));
    if (i < 0) { problems.push(`a loop among: ${left.join(", ")}`); order.push(...left); left.forEach((x) => done.add(x)); break; }
    const [id] = left.splice(i, 1);
    order.push(id); done.add(id);
  }
}
// Files more than one step changes: the later step must read the earlier one's result.
const touched = new Map();
for (const id of order) for (const c of briefs.get(id)?.commits ?? []) for (const ch of c.changes ?? []) { if (/[*{]/.test(ch.file)) continue; const l = touched.get(ch.file) ?? []; if (!l.includes(id)) l.push(id); touched.set(ch.file, l); }
const shared = [...touched].filter(([, l]) => l.length > 1).sort((a, b) => b[1].length - a[1].length);
const WHO = { cheap: "cheap", "cheap-then-review": "review", strong: "strong" };
const count = (w) => [...briefs.values()].filter((b) => b.executor === w).length;
let md = `${briefs.size} briefs: ${count("cheap")} cheap, ${count("cheap-then-review")} review, ${count("strong")} strong.\n\n`;
for (const ph of plan.phases) {
  const ids = order.filter((id) => byId.get(id).phase === ph.n);
  md += `### Phase ${ph.n}: ${ph.title}\n\n| # | Step | What | Effort | Who | After |\n|---|---|---|---|---|---|\n`;
  ids.forEach((id, i) => { const s = byId.get(id), b = briefs.get(id); md += `| ${i + 1} | [${id}](steps/${id}.md) | ${s.title.replace(/\|/g, "\\|")} | ${s.effort} | ${b ? WHO[b.executor] : ""} | ${deps(id).join(", ")} |\n`; });
  md += "\n";
}
md += `### Files more than one step changes\n\nWhen you edit one of these, a step before yours may already have changed it: read the file as it is, not as your brief quotes it.\n\n| File | Steps, in order |\n|---|---|\n${shared.slice(0, 60).map(([f, l]) => `| \`${f}\` | ${l.join(", ")} |`).join("\n")}\n`;
writeFileSync(`${S}/work/order.md`, md);
console.log(`briefs ${briefs.size}/${steps.length} | cheap ${count("cheap")} review ${count("cheap-then-review")} strong ${count("strong")} | shared files ${shared.length}`);
console.log(problems.length ? problems.join("\n") : "order OK");
