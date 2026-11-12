#!/usr/bin/env node
// Bloat review, state saver: pulls every finished agent's result out of the workflow journals into plain files, and writes the status.
//   node extract.mjs <scratchpad> <workflows-dir>
// audit:<key>  -> <scratchpad>/audits/<key>.json     (the auditor's report)
// verify:<key> -> <scratchpad>/verified/<key>.json   (the skeptic's corrected report)
// plan:<key>   -> the planner itself writes <scratchpad>/findings/<key>.json; its summary goes to <scratchpad>/verified/<key>.plan-summary.json
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
const [S, W] = process.argv.slice(2);
for (const d of ["audits", "verified", "findings"]) mkdirSync(join(S, d), { recursive: true });
const KEYS = ["storefront-client", "storefront-data", "admin-client", "admin-data", "caching", "cron", "db-queries", "db-schema", "deps", "assets", "ai-context", "features", "families", "docs-context", "page-model", "css", "i18n", "tests-ci", "functions", "server-graph", "client-bundles", "page-payload", "prefetch", "unused-code", "copied-code"];
const runs = existsSync(W) ? readdirSync(W).filter((d) => existsSync(join(W, d, "journal.jsonl"))).map((d) => ({ d, t: statSync(join(W, d, "journal.jsonl")).mtimeMs })).sort((a, b) => a.t - b.t) : [];
const running = {};
for (const { d } of runs) {
  const label = new Map();
  for (const line of readFileSync(join(W, d, "journal.jsonl"), "utf8").split("\n")) {
    if (!line) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type === "started") { label.set(e.key, e.label); running[e.label] = d; }
    if (e.type !== "result" || !label.has(e.key)) continue;
    const [stage, key] = label.get(e.key).split(":");
    delete running[label.get(e.key)];
    if (!e.result || !KEYS.includes(key)) continue;
    if (stage === "audit" && Array.isArray(e.result.findings)) writeFileSync(join(S, "audits", `${key}.json`), JSON.stringify(e.result, null, 1));
    if (stage === "verify" && Array.isArray(e.result.findings)) writeFileSync(join(S, "verified", `${key}.json`), JSON.stringify(e.result, null, 1));
    if (stage === "plan") writeFileSync(join(S, "verified", `${key}.plan-summary.json`), JSON.stringify(e.result, null, 1));
  }
}
const planned = (key) => { try { const j = JSON.parse(readFileSync(join(S, "findings", `${key}.json`), "utf8")); return Array.isArray(j.findings) && typeof j.headline === "string"; } catch { return false; } };
const status = KEYS.map((key) => ({ key, audit: existsSync(join(S, "audits", `${key}.json`)), verify: existsSync(join(S, "verified", `${key}.json`)), plan: planned(key) }));
const todo = status.filter((s) => !s.plan);
const args = { keys: todo.map((s) => s.key), audited: status.filter((s) => s.audit).map((s) => s.key), verified: status.filter((s) => s.verify).map((s) => s.key) };
writeFileSync(join(S, "status.json"), JSON.stringify({ at: new Date().toISOString(), status, relaunch: args }, null, 1));
const mark = (b) => (b ? "done" : "to do");
writeFileSync(join(S, "STATUS.md"), `# Where the reviewers stand (${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC)\n\n| Area | Read (audit) | Challenged (verify) | Planned |\n|---|---|---|---|\n${status.map((s) => `| ${s.key} | ${mark(s.audit)} | ${mark(s.verify)} | ${mark(s.plan)} |`).join("\n")}\n\nDone: ${status.filter((s) => s.plan).length} of ${status.length} areas through all three stages; ${status.filter((s) => s.verify).length} challenged; ${status.filter((s) => s.audit).length} read.\n\nTo relaunch what is left, pass these args to the workflow (split the keys over several launches of three or four):\n\n\`\`\`json\n${JSON.stringify(args)}\n\`\`\`\n`);
console.log(`audits ${status.filter((s) => s.audit).length}/25, verified ${status.filter((s) => s.verify).length}/25, planned ${status.filter((s) => s.plan).length}/25`);
