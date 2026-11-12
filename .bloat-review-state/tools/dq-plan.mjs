// Assembles the db-queries findings file from its two parts and writes it as JSON.
import { writeFileSync } from "node:fs";
import { top, findingsA } from "./dq-plan-1.mjs";
import { findingsB } from "./dq-plan-2.mjs";
const out = process.argv[2];
const data = { ...top, findings: [...findingsA, ...findingsB] };
for (const f of data.findings) if (f.saving.length === 0) throw new Error(f.id);
writeFileSync(out, JSON.stringify(data, null, 1) + "\n");
console.log(data.findings.map((f) => `${f.id} ${f.priority} ${f.effort} ${f.verdict}`).join("\n"));
