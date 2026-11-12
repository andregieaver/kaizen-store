#!/usr/bin/env node
// Compares the brief writers' ratings with the blind second ratings; writes work/rating-diff.json for the judge.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
const S = "/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad";
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const ids = readdirSync(`${S}/exec`).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
const RANK = { cheap: 0, "cheap-then-review": 1, strong: 2 };
const grid = {}, diff = [], missing = [], bad = [];
for (const id of ids) {
  const a = json(`${S}/exec/${id}.json`);
  const p = `${S}/rating/${id}.json`;
  if (!existsSync(p)) { missing.push(id); continue; }
  let b; try { b = json(p); } catch { bad.push(id); continue; }
  if (!(b.rating in RANK)) { bad.push(id); continue; }
  const k = `${a.executor} -> ${b.rating}`; grid[k] = (grid[k] ?? 0) + 1;
  if (a.executor !== b.rating) diff.push({ id, first: { rating: a.executor, why: a.executor_why }, second: b });
}
writeFileSync(`${S}/work/rating-diff.json`, JSON.stringify(diff, null, 1));
const up = diff.filter((d) => RANK[d.second.rating] > RANK[d.first.rating]).length;
console.log(`rated ${ids.length - missing.length}/${ids.length}; disagree ${diff.length} (second higher ${up}, lower ${diff.length - up})`);
for (const [k, v] of Object.entries(grid).sort()) console.log(`  ${k}: ${v}`);
if (missing.length) console.log("missing:", missing.join(" "));
if (bad.length) console.log("bad:", bad.join(" "));
