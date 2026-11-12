// Prints finished (unverified) audits compactly: node audits.mjs key[,key] [evidenceChars] [fixChars]
import { readFileSync } from "node:fs";
const dir = "/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/audits";
const [keys, ev = "260", fx = "300", mode = ""] = process.argv.slice(2);
for (const key of keys.split(",")) {
  const d = JSON.parse(readFileSync(`${dir}/${key}.json`, "utf8"));
  console.log(`\n## ${key}\n${d.headline}`);
  if (mode !== "nometrics") console.log(`METRICS: ${d.metrics.map((m) => `${m.name}: ${m.value}`).join(" | ").slice(0, 1800)}`);
  console.log(`CLEAN: ${d.clean.join(" | ").slice(0, 1300)}`);
  for (const f of d.findings) {
    console.log(`- ${f.id} [${f.kind} ${f.effort} ${f.confidence}${f.owner_decision ? " OWNER" : ""}] ${f.title}`);
    console.log(`   at: ${f.where.slice(0, 3).join("; ").slice(0, 240)}`);
    if (Number(ev)) console.log(`   ev: ${f.evidence.slice(0, Number(ev))}`);
    if (Number(fx)) console.log(`   fix: ${f.fix.slice(0, Number(fx))}`);
    console.log(`   saves: ${f.saving.slice(0, 200)}${f.already_tracked !== "no" ? ` | tracked: ${f.already_tracked.slice(0, 110)}` : ""}`);
  }
}
