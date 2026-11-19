#!/usr/bin/env node
// Checks one findings file of the bloat review: node validate-findings.mjs <file.json>. Prints OK or the problems.
import { readFileSync } from "node:fs";
const file = process.argv[2];
const problems = [];
let data;
try {
  data = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  console.log(`NOT JSON: ${error.message}`);
  process.exit(1);
}
const str = (v) => typeof v === "string" && v.trim().length > 0;
const arr = (v) => Array.isArray(v);
for (const key of ["key", "title", "headline"]) if (!str(data[key])) problems.push(`top: "${key}" must be a non-empty string`);
for (const key of ["metrics", "clean", "refuted", "findings"]) if (!arr(data[key])) problems.push(`top: "${key}" must be an array`);
for (const [i, m] of (data.metrics ?? []).entries()) for (const key of ["name", "value", "how"]) if (!str(String(m?.[key] ?? ""))) problems.push(`metrics[${i}].${key} missing`);
const KINDS = ["dead", "duplicate", "eager", "oversize", "speculative", "process"];
const required = ["id", "title", "kind", "evidence", "cost", "who_pays", "done_when", "saving", "effort", "risk", "confidence", "priority", "already_tracked", "verdict"];
for (const [i, f] of (data.findings ?? []).entries()) {
  for (const key of required) if (!str(f?.[key])) problems.push(`findings[${i}] (${f?.id ?? "?"}): "${key}" must be a non-empty string`);
  for (const key of ["where", "fix_steps", "tests_and_rules", "depends_on"]) if (!arr(f?.[key])) problems.push(`findings[${i}] (${f?.id ?? "?"}): "${key}" must be an array`);
  if (typeof f?.owner_decision !== "boolean") problems.push(`findings[${i}] (${f?.id ?? "?"}): "owner_decision" must be true or false`);
  if (f?.kind && !KINDS.includes(f.kind)) problems.push(`findings[${i}]: kind must be one of ${KINDS.join(", ")}`);
  if (f?.effort && !["S", "M", "L"].includes(f.effort)) problems.push(`findings[${i}]: effort must be S, M or L`);
  if (f?.priority && !["P0", "P1", "P2", "P3"].includes(f.priority)) problems.push(`findings[${i}]: priority must be P0, P1, P2 or P3`);
  if (f?.verdict && !["confirmed", "corrected", "added"].includes(f.verdict)) problems.push(`findings[${i}]: verdict must be confirmed, corrected or added`);
  if (arr(f?.where) && f.where.length === 0) problems.push(`findings[${i}] (${f?.id ?? "?"}): "where" is empty`);
  if (arr(f?.fix_steps) && f.fix_steps.length === 0) problems.push(`findings[${i}] (${f?.id ?? "?"}): "fix_steps" is empty`);
}
if (problems.length) {
  console.log(problems.join("\n"));
  process.exit(1);
}
console.log(`OK: ${data.findings.length} findings, ${data.refuted.length} refuted, ${data.metrics.length} metrics`);
