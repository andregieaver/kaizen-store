// Measures the comment share of src per top-level folder. Read-only.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.argv[2];
const exts = new Set([".ts", ".tsx", ".mts", ".mjs", ".js", ".css"]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (exts.has(path.extname(name))) yield p;
  }
}

const groups = {};
const big = [];
const perFile = [];
function bucket(file) {
  const rel = path.relative(root, file);
  const top = rel.split(path.sep)[0];
  const isTest = /\.(test|spec)\.[mc]?tsx?$/.test(file) || /\.int\.test\./.test(file) || /\.scan\.test\./.test(file);
  // data-like files: messages, fixtures
  const isMessages = /src\/lib\/(messages|admin-messages)\//.test(file);
  return `${top}${isTest ? " (tests)" : isMessages ? " (messages)" : ""}`;
}

for (const file of walk(root)) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  const g = (groups[bucket(file)] ??= { files: 0, lines: 0, bytes: 0, blank: 0, comment: 0, commentBytes: 0, dRefsInComments: 0, blocks10: 0, blocks10Lines: 0 });
  g.files++;
  g.lines += lines.length;
  g.bytes += Buffer.byteLength(text);
  let inBlock = false;
  let run = 0;
  let fileComment = 0;
  let fileCommentBytes = 0;
  const endRun = () => {
    if (run >= 10) {
      g.blocks10++;
      g.blocks10Lines += run;
      big.push({ file: path.relative(root, file), run });
    }
    run = 0;
  };
  for (const raw of lines) {
    const l = raw.trim();
    let isComment = false;
    if (inBlock) {
      isComment = true;
      if (l.includes("*/")) inBlock = false;
    } else if (l.startsWith("//")) {
      isComment = true;
    } else if (l.startsWith("/*")) {
      isComment = true;
      if (!l.includes("*/")) inBlock = true;
    } else if (l.startsWith("{/*") && l.endsWith("*/}")) {
      isComment = true;
    }
    if (isComment) {
      g.comment++;
      fileComment++;
      const b = Buffer.byteLength(raw) + 1;
      g.commentBytes += b;
      fileCommentBytes += b;
      const m = raw.match(/\bD\d{1,3}\b/g);
      if (m) g.dRefsInComments += m.length;
      run++;
    } else {
      if (l === "") g.blank++;
      endRun();
    }
  }
  endRun();
  perFile.push({ file: path.relative(root, file), lines: lines.length, comment: fileComment, commentBytes: fileCommentBytes, bytes: Buffer.byteLength(text) });
}

const rows = Object.entries(groups).sort((a, b) => b[1].commentBytes - a[1].commentBytes);
let T = { files: 0, lines: 0, bytes: 0, comment: 0, commentBytes: 0 };
console.log("group | files | lines | comment lines | share of lines | bytes | comment bytes | share of bytes | D refs in comments | blocks>=10 lines (lines)");
for (const [k, v] of rows) {
  console.log(
    `${k} | ${v.files} | ${v.lines} | ${v.comment} | ${((100 * v.comment) / v.lines).toFixed(1)}% | ${v.bytes} | ${v.commentBytes} | ${((100 * v.commentBytes) / v.bytes).toFixed(1)}% | ${v.dRefsInComments} | ${v.blocks10} (${v.blocks10Lines})`,
  );
  for (const key of Object.keys(T)) T[key] += v[key];
}
console.log(`TOTAL | ${T.files} | ${T.lines} | ${T.comment} | ${((100 * T.comment) / T.lines).toFixed(1)}% | ${T.bytes} | ${T.commentBytes} | ${((100 * T.commentBytes) / T.bytes).toFixed(1)}%`);
console.log("\nLongest comment runs:");
for (const b of big.sort((a, b) => b.run - a.run).slice(0, 25)) console.log(b.run, b.file);
console.log("\nFiles with most comment bytes:");
for (const f of perFile.sort((a, b) => b.commentBytes - a.commentBytes).slice(0, 25)) console.log(f.commentBytes, `${((100 * f.commentBytes) / f.bytes).toFixed(0)}%`, f.lines, f.file);
