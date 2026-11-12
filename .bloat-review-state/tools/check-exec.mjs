#!/usr/bin/env node
// Bloat review, execution briefs: checks the decided plan or the briefs of some steps.
//   node check-exec.mjs plan                 checks panel/plan.exec.json against panel/plan.final.json
//   node check-exec.mjs briefs 0.1,0.2,...   checks exec/<id>.json for each id (no ids: every step of the plan)
import { readFileSync, existsSync } from "node:fs";
const S = "/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad";
const REPO = "/home/user/kaizen-store";
const [kind, list = ""] = process.argv.slice(2);
const problems = [];
const str = (v) => typeof v === "string" && v.trim().length > 0;
const arr = (v) => Array.isArray(v);
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const stepsOf = (plan) => plan.phases.flatMap((ph) => ph.steps.map((s) => ({ ...s, phase: ph.n })));

if (kind === "plan") {
  let fin, exe;
  try { fin = read(`${S}/panel/plan.final.json`); exe = read(`${S}/panel/plan.exec.json`); } catch (e) { console.log("NOT JSON: " + e.message); process.exit(1); }
  const a = stepsOf(fin), b = stepsOf(exe);
  const ids = new Set(b.map((s) => s.id));
  for (const s of a) if (!ids.has(s.id)) problems.push(`step ${s.id} of plan.final.json is missing`);
  const before = new Map(a.map((s) => [s.id, s]));
  for (const s of b) {
    const was = before.get(s.id);
    for (const k of ["id", "title", "what", "done_when", "platform"]) if (!str(s[k])) problems.push(`step ${s.id}: "${k}" missing`);
    if (s.owner_question) problems.push(`step ${s.id}: owner_question must be null now (move its words to "asked" and write "decision")`);
    if (was?.owner_question && (!str(s.asked) || !str(s.decision))) problems.push(`step ${s.id}: had a question, so it needs "asked" and "decision"`);
    if (was && JSON.stringify([...was.closes].sort()) !== JSON.stringify([...(s.closes ?? [])].sort()) && !s.dropped) problems.push(`step ${s.id}: closes changed`);
    if (!was && !str(s.added_why)) problems.push(`step ${s.id}: new step needs "added_why"`);
  }
  for (const [i, c] of (exe.owner_choices ?? []).entries()) if (!str(c.decision)) problems.push(`owner_choices[${i}]: "decision" missing`);
  if ((exe.owner_choices ?? []).length !== (fin.owner_choices ?? []).length) problems.push("owner_choices: count changed");
  if (/16 ?GB build machine|Enhanced build|larger build machine/i.test(JSON.stringify(b.map((s) => [s.what, s.done_when, s.decision]))) && !/not|never|no paid|cannot|without/i.test(b.find((s) => s.id === "1.21")?.decision ?? "")) problems.push("step 1.21: the decision must rule out the paid build machine");
}

if (kind === "briefs") {
  const planPath = existsSync(`${S}/panel/plan.exec.json`) ? `${S}/panel/plan.exec.json` : `${S}/panel/plan.final.json`;
  const steps = stepsOf(read(planPath));
  const known = new Set(steps.map((s) => s.id));
  const ids = list ? list.split(",").map((x) => x.trim()).filter(Boolean) : steps.map((s) => s.id);
  for (const id of ids) {
    const f = `${S}/exec/${id}.json`;
    if (!known.has(id)) { problems.push(`${id}: not a step of the plan`); continue; }
    if (!existsSync(f)) { problems.push(`${id}: exec/${id}.json missing`); continue; }
    let d; try { d = read(f); } catch (e) { problems.push(`${id}: not JSON (${e.message})`); continue; }
    const P = (m) => problems.push(`${id}: ${m}`);
    if (d.id !== id) P(`"id" must be "${id}"`);
    for (const k of ["goal", "why", "executor_why", "checked_in_code"]) if (!str(d[k])) P(`"${k}" missing`);
    if (!["cheap", "cheap-then-review", "strong"].includes(d.executor)) P('"executor" must be cheap, cheap-then-review or strong');
    if (d.cheap_commits !== undefined && (!arr(d.cheap_commits) || d.cheap_commits.some((n) => !Number.isInteger(n) || n < 1 || n > (d.commits ?? []).length))) P('"cheap_commits" must list commit numbers');
    for (const k of ["read_first", "depends_on", "commits", "tests", "done_when", "after_deploy", "docs", "do_not", "stop_if"]) if (!arr(d[k])) P(`"${k}" must be an array`);
    for (const [i, x] of (d.depends_on ?? []).entries()) { if (!known.has(x?.id)) P(`depends_on[${i}].id "${x?.id}" is not a step`); if (x?.id === id) P("depends on itself"); if (!str(x?.why)) P(`depends_on[${i}].why missing`); }
    if (arr(d.commits) && !d.commits.length) P("give at least one commit");
    for (const [i, c] of (d.commits ?? []).entries()) {
      if (!str(c?.title)) P(`commits[${i}].title missing`);
      if (!arr(c?.changes) || !c.changes.length) P(`commits[${i}].changes must list at least one change`);
      for (const [j, ch] of (c?.changes ?? []).entries()) {
        if (!str(ch?.file) || !str(ch?.how)) P(`commits[${i}].changes[${j}] needs "file" and "how"`);
        if (!["edit", "create", "delete", "move"].includes(ch?.action)) P(`commits[${i}].changes[${j}].action must be edit, create, delete or move`);
        if (str(ch?.file) && ch.file.startsWith("/")) P(`commits[${i}].changes[${j}].file must be relative to the repo`);
        if (ch?.made_by !== undefined && !known.has(ch.made_by)) P(`commits[${i}].changes[${j}].made_by "${ch.made_by}" is not a step`);
        if (ch?.made_by && !(d.depends_on ?? []).some((x) => x.id === ch.made_by)) P(`commits[${i}].changes[${j}] is made by step ${ch.made_by}, which depends_on must name`);
        if (str(ch?.file) && ["edit", "delete", "move"].includes(ch?.action) && !ch?.made_by && !/[*{]/.test(ch.file) && !existsSync(`${REPO}/${ch.file}`) && !(d.commits ?? []).some((c2) => (c2.changes ?? []).some((x) => x.action === "create" && x.file === ch.file))) P(`commits[${i}].changes[${j}].file does not exist: ${ch.file}`);
      }
      if (!arr(c?.checks) || !c.checks.length) P(`commits[${i}].checks must name at least one command`);
    }
    for (const [i, x] of (d.read_first ?? []).entries()) if (!str(x) || (!/[*{ ]/.test(x) && !existsSync(`${REPO}/${x.split(":")[0]}`))) P(`read_first[${i}] does not exist: ${x}`);
    if (arr(d.done_when) && !d.done_when.length) P("give at least one done_when check");
    for (const [i, x] of (d.done_when ?? []).entries()) if (!str(x?.check) || !str(x?.expect)) P(`done_when[${i}] needs "check" and "expect"`);
    if (typeof d.migration?.needed !== "boolean" || (d.migration.needed && !str(d.migration.notes))) P('"migration" must be {needed: boolean, notes}');
    if (arr(d.stop_if) && !d.stop_if.length) P("give at least one stop_if");
  }
}

if (kind !== "plan" && kind !== "briefs") { console.log("usage: check-exec.mjs plan | briefs [ids]"); process.exit(1); }
if (problems.length) { console.log(problems.slice(0, 60).join("\n")); console.log(`${problems.length} PROBLEMS`); process.exit(1); }
console.log("OK");
