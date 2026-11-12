// Finds .transaction(...) callbacks whose own text holds no write statement and no function call that takes tx (read-only transactions). Read-only heuristic.
import fs from "node:fs";
import path from "node:path";
const root = process.argv[2];
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !/test-support|test-fixture/.test(e.name)) files.push(p); } })(root);
let total = 0; const readOnly = []; const single = [];
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const re = /\.transaction\(\s*(?:async\s*)?\(?\s*(\w+)\s*\)?\s*=>\s*/g; let m;
  while ((m = re.exec(src))) {
    total++;
    const tx = m[1];
    let i = m.index + m[0].length; let body;
    if (src[i] === "{") { let j = i + 1, d = 1; for (; j < src.length && d > 0; j++) { if (src[j] === "{") d++; else if (src[j] === "}") d--; } body = src.slice(i, j); }
    else { let j = i, d = 0; for (; j < src.length; j++) { if (src[j] === "(") d++; else if (src[j] === ")") { if (d === 0) break; d--; } } body = src.slice(i, j); }
    const line = src.slice(0, m.index).split("\n").length;
    const stmts = (body.match(/sql`\s*(select|with|insert|update|delete|set|lock|call)\b/gi) || []).map((s) => s.replace(/sql`\s*/, "").toLowerCase());
    const writes = stmts.filter((s) => /insert|update|delete|call|lock/.test(s)).length;
    const hasWriteWord = /\b(insert into|update commerce|delete from|for update|pg_advisory|pg_try_advisory|set local|longerTimeout)\b/i.test(body);
    const passesTx = new RegExp(`\\(\\s*${tx}\\b|,\\s*${tx}\\s*[,)]`).test(body);
    if (!hasWriteWord && writes === 0 && !passesTx && stmts.length > 0) readOnly.push(`${path.relative(root, f)}:${line} statements=${stmts.length}`);
    if (stmts.length === 1 && !passesTx && body.length < 1500) single.push(`${path.relative(root, f)}:${line} ${stmts[0]}`);
  }
}
console.log("transactions:", total, "| read-only by text:", readOnly.length, "| one statement only (no helper given tx):", single.length);
console.log("--- read-only"); console.log(readOnly.join("\n"));
console.log("--- single statement"); console.log(single.join("\n"));
