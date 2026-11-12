// Prints the verified findings of the bloat review compactly: node summary.mjs [key ...] [--full id,id]
import { readFileSync, readdirSync } from "node:fs";
const dir = "/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/findings";
const args = process.argv.slice(2);
const fullIdx = args.indexOf("--full");
const full = fullIdx >= 0 ? new Set(args[fullIdx + 1].split(",")) : null;
const keys = args.filter((a, i) => !a.startsWith("--") && i !== fullIdx + 1 || (fullIdx < 0 && !a.startsWith("--")));
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).filter((f) => !keys.length || keys.includes(f.replace(".json", "")));
for (const file of files) {
  const d = JSON.parse(readFileSync(`${dir}/${file}`, "utf8"));
  if (full) {
    for (const f of d.findings.filter((x) => full.has(x.id))) {
      console.log(`\n### ${f.id} ${f.title}\n[${f.kind} ${f.priority} ${f.effort} ${f.verdict} conf=${f.confidence} owner=${f.owner_decision}] tracked: ${f.already_tracked}\nWHERE: ${f.where.join("; ")}\nEVIDENCE: ${f.evidence}\nCOST: ${f.cost} (${f.who_pays})\nSTEPS:\n${f.fix_steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}\nTESTS/RULES: ${f.tests_and_rules.join("; ")}\nDEPENDS: ${f.depends_on.join("; ")}\nDONE WHEN: ${f.done_when}\nSAVING: ${f.saving}\nRISK: ${f.risk}\nNOTES: ${f.notes ?? ""}`);
    }
    continue;
  }
  console.log(`\n## ${d.key}: ${d.title}\n${d.headline}`);
  console.log(`metrics: ${d.metrics.slice(0, 14).map((m) => `${m.name}=${m.value}`).join(" | ").slice(0, 1400)}`);
  console.log(`clean: ${d.clean.slice(0, 8).join(" | ").slice(0, 900)}`);
  for (const f of d.findings) console.log(` - ${f.id} [${f.priority} ${f.effort} ${f.kind}${f.owner_decision ? " OWNER" : ""} ${f.verdict}] ${f.title} => ${String(f.saving).slice(0, 230)}${f.already_tracked && f.already_tracked !== "no" ? ` {tracked: ${String(f.already_tracked).slice(0, 80)}}` : ""}`);
  if (d.refuted.length) console.log(` refuted: ${d.refuted.map((r) => `${r.id} ${r.title} (${String(r.why).slice(0, 120)})`).join(" || ")}`);
}
