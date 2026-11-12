#!/usr/bin/env node
// Bloat review, grade panel: checks one of the panel's files.  node check-panel.mjs steward|plan|card <file> [scratchpad]
import { readFileSync, existsSync, readdirSync } from "node:fs";
const [kind, file, S = "/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad"] = process.argv.slice(2);
const problems = [];
let d;
try { d = JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.log("NOT JSON: " + e.message); process.exit(1); }
const str = (v) => typeof v === "string" && v.trim().length > 0;
const arr = (v) => Array.isArray(v);
const GRADES = ["A", "B", "C", "D", "E"];
const all = JSON.parse(readFileSync(`${S}/digest/all-findings.json`, "utf8"));
const known = new Map(all.map((f) => [f.id, f]));
const HOME = { code: ["unused-code", "copied-code", "deps", "assets", "families"], "shopper-browser": ["storefront-client", "page-payload", "prefetch"], "owner-browser": ["admin-client", "client-bundles"], server: ["storefront-data", "admin-data", "server-graph", "functions", "caching"], scheduled: ["cron"], database: ["db-queries", "db-schema"], ai: ["ai-context"], surface: ["features"], rules: ["docs-context"], "page-model": ["page-model"], styles: ["css"], text: ["i18n"], build: ["tests-ci"] };
if (kind === "steward") {
  for (const k of ["area", "title", "grade_reasons"]) if (!str(d[k])) problems.push(`"${k}" must be a non-empty string`);
  if (!GRADES.includes(d.grade_today)) problems.push(`grade_today must be one of ${GRADES.join(", ")}`);
  for (const k of ["measures", "work_items", "tolerated", "owner_choices", "gaps"]) if (!arr(d[k])) problems.push(`"${k}" must be an array`);
  if (arr(d.measures) && (d.measures.length < 3 || d.measures.length > 8)) problems.push("give 3 to 8 measures");
  for (const [i, m] of (d.measures ?? []).entries()) for (const k of ["name", "today", "target_a", "how_measured", "why_this_is_a"]) if (!str(m?.[k])) problems.push(`measures[${i}].${k} missing`);
  for (const [i, w] of (d.work_items ?? []).entries()) {
    for (const k of ["title", "done_when", "moves"]) if (!str(w?.[k])) problems.push(`work_items[${i}].${k} missing`);
    if (!["now", "next", "later"].includes(w?.phase)) problems.push(`work_items[${i}].phase must be now, next or later`);
    if (!["S", "M", "L"].includes(w?.effort)) problems.push(`work_items[${i}].effort must be S, M or L`);
    if (!arr(w?.finding_ids)) problems.push(`work_items[${i}].finding_ids must be an array`);
    if (typeof w?.owner_decision !== "boolean") problems.push(`work_items[${i}].owner_decision must be true or false`);
  }
  for (const k of ["after_now", "after_next", "after_later"]) if (!GRADES.includes(d.ladder?.[k])) problems.push(`ladder.${k} must be a grade`);
  // Every finding of the area's home dimensions is accounted for exactly once.
  const mine = all.filter((f) => (HOME[d.area] ?? []).includes(f.key)).map((f) => f.id);
  if (!HOME[d.area]) problems.push(`unknown area "${d.area}"`);
  const placed = new Map();
  const put = (id, where) => placed.set(id, [...(placed.get(id) ?? []), where]);
  for (const [i, w] of (d.work_items ?? []).entries()) for (const id of w.finding_ids ?? []) put(id, `work_items[${i}]`);
  for (const t of d.tolerated ?? []) put(t.finding_id, "tolerated");
  for (const c of d.owner_choices ?? []) for (const id of c.finding_ids ?? []) put(id, "owner_choices");
  for (const id of mine) if (!placed.has(id)) problems.push(`finding ${id} (${known.get(id).priority}: ${known.get(id).title.slice(0, 70)}) is in no work item, tolerated or owner choice`);
  for (const [id, where] of placed) { if (!known.has(id)) problems.push(`unknown finding id ${id} in ${where.join(", ")}`); else if (mine.includes(id) && where.length > 1) problems.push(`finding ${id} is placed ${where.length} times: ${where.join(", ")}`); }
}
if (kind === "plan") {
  if (!arr(d.phases)) problems.push('"phases" must be an array');
  const placed = new Map();
  const put = (id, where) => placed.set(id, [...(placed.get(id) ?? []), where]);
  const stepIds = new Set();
  for (const ph of d.phases ?? []) {
    for (const k of ["title", "goal", "notice"]) if (!str(ph?.[k])) problems.push(`phase ${ph?.n}: "${k}" missing`);
    for (const st of ph.steps ?? []) {
      for (const k of ["id", "title", "what", "done_when", "platform"]) if (!str(st?.[k])) problems.push(`step ${st?.id}: "${k}" missing`);
      if (!["S", "M", "L"].includes(st?.effort)) problems.push(`step ${st?.id}: effort must be S, M or L`);
      if (!arr(st?.closes)) problems.push(`step ${st?.id}: closes must be an array`);
      if (!arr(st?.areas) || !st.areas.length) problems.push(`step ${st?.id}: areas must name at least one area`);
      for (const a of st?.areas ?? []) if (!HOME[a]) problems.push(`step ${st?.id}: unknown area ${a}`);
      if (stepIds.has(st.id)) problems.push(`step id ${st.id} used twice`); stepIds.add(st.id);
      for (const id of st.closes ?? []) put(id, `step ${st.id}`);
    }
  }
  for (const t of d.tolerated ?? []) put(t.finding_id, "tolerated");
  for (const c of d.owner_choices ?? []) for (const id of c.finding_ids ?? []) put(id, "owner_choices");
  for (const f of all) if (!placed.has(f.id)) problems.push(`finding ${f.id} [${f.key} ${f.priority}] ${f.title.slice(0, 60)}: in no step, tolerated or owner choice`);
  for (const [id, where] of placed) { if (!known.has(id) && !/^L-\d+$/.test(id) && !/^GAP-/.test(id)) problems.push(`unknown finding id ${id} in ${where.join(", ")}`); else if (where.length > 1) problems.push(`finding ${id} is placed ${where.length} times: ${where.join(", ")}`); }
  for (const a of Object.keys(HOME)) if (!arr(d.ladders?.[a]?.to_a)) problems.push(`ladders.${a}.to_a must list the steps that take the area to an A`);
  for (const [a, l] of Object.entries(d.ladders ?? {})) for (const id of [...(l.to_b ?? []), ...(l.to_a ?? [])]) if (!stepIds.has(id)) problems.push(`ladders.${a} names step ${id}, which does not exist`);
}
if (kind === "card") {
  for (const k of ["area", "title", "grade_reasons", "verdict_on_bar", "can_the_steps_reach_a"]) if (!str(d[k])) problems.push(`"${k}" must be a non-empty string`);
  if (!GRADES.includes(d.grade_today)) problems.push("grade_today must be a grade");
  for (const k of ["measures", "steps_to_a", "shortfalls", "tolerated", "owner_choices"]) if (!arr(d[k])) problems.push(`"${k}" must be an array`);
  for (const [i, m] of (d.measures ?? []).entries()) for (const k of ["name", "today", "target_a", "how_measured"]) if (!str(m?.[k])) problems.push(`measures[${i}].${k} missing`);
  for (const k of ["after_phase_0", "after_phase_1", "after_phase_2", "after_all"]) if (!GRADES.includes(d.ladder?.[k])) problems.push(`ladder.${k} must be a grade`);
  if (existsSync(`${S}/panel/plan.json`)) { const plan = JSON.parse(readFileSync(`${S}/panel/plan.json`, "utf8")); const ids = new Set(plan.phases.flatMap((p) => p.steps.map((s) => s.id))); for (const id of d.steps_to_a ?? []) if (!ids.has(id)) problems.push(`steps_to_a names step ${id}, which is not in the plan`); }
}
if (problems.length) { console.log(problems.slice(0, 60).join("\n") + (problems.length > 60 ? `\n… and ${problems.length - 60} more` : "")); process.exit(1); }
console.log("OK");
