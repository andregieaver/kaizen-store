// For each dispatcher job body: the commerce tables its own body names, and which of them never held a row in production.
import fs from "node:fs";
const stats = fs.readFileSync("/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/m/prod-db-stats.md", "utf8");
const start = stats.indexOf("## The 255 tables that have never held a row");
const end = stats.indexOf("(An empty table is not proof");
const empty = new Set(stats.slice(start, end).split("\n").slice(2).join(" ").split(",").map((s) => s.trim()).filter(Boolean));
const bodies = fs.readFileSync("jobs-bodies.txt", "utf8").split("\n=========== ").slice(1);
let allEmpty = 0, some = 0, none = 0, noTables = 0;
const rows = [];
for (const b of bodies) {
  const [head] = b.split("\n");
  const job = head.split(" :: ")[0];
  const tables = [...new Set([...b.matchAll(/commerce\.([a-z_0-9]+)\b(?!\()/g)].map((m) => m[1]))].filter((t) => !["store_is_active", "feature_on", "house_store"].includes(t));
  const e = tables.filter((t) => empty.has(t));
  const kind = tables.length === 0 ? "no-table-in-body" : e.length === tables.length ? "ALL-EMPTY" : e.length > 0 ? "some-empty" : "used";
  if (kind === "ALL-EMPTY") allEmpty++; else if (kind === "some-empty") some++; else if (kind === "used") none++; else noTables++;
  rows.push(`${kind}\t${job}\tempty=[${e.join(",")}]\tother=[${tables.filter((t) => !empty.has(t)).join(",")}]`);
}
console.log(rows.sort().join("\n"));
console.log({ emptyTables: empty.size, allEmpty, some, none, noTables });
