// The compiled module graph of one built route: parses every chunk the entry loads (acorn), reads each module factory's eager
// imports (calls of the runtime's `i`/`r` import helpers that are not inside a nested function: they run when the module is evaluated),
// then walks from the entry module. Says whether a target module id is reached at load, and how many modules evaluate.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire("/home/user/kaizen-store/node_modules/.pnpm/acorn@8.18.0/node_modules/acorn/package.json");
const acorn = require("acorn");
const root = "/home/user/kaizen-store/.next/server";
const entry = process.argv[2]; const targets = process.argv.slice(3).map(Number);
const page = fs.readFileSync(path.join(root, entry), "utf8");
const chunks = [...page.matchAll(/R\.c\("([^"]+)"\)/g)].map((m) => m[1].replace(/^server\//, ""));
const entryId = +page.match(/R\.m\((\d+)\)/)[1];
const mods = new Map(); // id -> { eager:Set, lazy:Set, size, chunk }
function walk(node, fn, depth, param, rec) {
  if (!node || typeof node.type !== "string") return;
  let d = depth;
  if (node !== fn && (node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression" || node.type === "FunctionDeclaration")) d = depth + 1;
  if (node.type === "CallExpression" && node.callee.type === "MemberExpression" && node.callee.object.type === "Identifier" && node.callee.object.name === param && node.callee.property.type === "Identifier" && node.arguments[0] && node.arguments[0].type === "Literal" && typeof node.arguments[0].value === "number") {
    const p = node.callee.property.name;
    if (p === "i" || p === "r") (d === 0 ? rec.eager : rec.lazy).add(node.arguments[0].value);
    else if (p === "A" || p === "l") rec.lazy.add(node.arguments[0].value);
  }
  for (const k in node) { const v = node[k]; if (k === "type" || !v || typeof v !== "object") continue; if (Array.isArray(v)) for (const c of v) walk(c, fn, d, param, rec); else if (typeof v.type === "string") walk(v, fn, d, param, rec); }
}
let parsed = 0, bytes = 0;
for (const c of chunks) {
  const src = fs.readFileSync(path.join(root, c), "utf8"); bytes += src.length;
  let ast; try { ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "script" }); } catch (e) { console.error("parse failed", c, e.message); continue; }
  parsed++;
  let arr = null;
  const find = (node, depth) => { if (!node || typeof node.type !== "string" || arr || depth > 8) return; if (node.type === "AssignmentExpression" && node.left.type === "MemberExpression" && node.left.object.name === "module" && node.right.type === "ArrayExpression") { arr = node.right; return; } for (const k in node) { const v = node[k]; if (k === "type" || !v || typeof v !== "object") continue; if (Array.isArray(v)) for (const c of v) find(c, depth + 1); else if (typeof v.type === "string") find(v, depth + 1); } };
  find(ast, 0);
  if (!arr) { console.error("no module array in", c); continue; }
  const els = arr.elements; let ids = [];
  const handle = (list) => { let pending = []; for (const el of list) { if (!el) continue; if (el.type === "Literal" && typeof el.value === "number") pending.push(el.value); else if (el.type === "ArrowFunctionExpression" || el.type === "FunctionExpression") { const param = el.params[0]?.name; const rec = { eager: new Set(), lazy: new Set(), size: el.end - el.start, start: el.start, end: el.end, chunk: c, async: false }; 
        // async modules: e.a(async (handle, done) => { ...body... }) : the inner function's top level is the module's top level
        let body = el; if (el.body.type === "CallExpression" && el.body.callee.type === "MemberExpression" && el.body.callee.property.name === "a" && el.body.arguments[0]) { rec.async = true; body = el.body.arguments[0]; walk(body.body, body, 0, param, rec); }
        else if (el.body.type === "BlockStatement" && el.body.body.length === 1 && el.body.body[0].type === "ReturnStatement" && el.body.body[0].argument?.type === "CallExpression" && el.body.body[0].argument.callee.property?.name === "a") { rec.async = true; body = el.body.body[0].argument.arguments[0]; walk(body.body, body, 0, param, rec); }
        else walk(el.body, el, 0, param, rec);
        for (const id of pending) mods.set(id, rec); pending = []; } else if (el.type === "ArrayExpression") handle(el.elements); else if (el.type === "ObjectExpression") { /* re-export maps */ pending = []; } }
  };
  handle(els);
}
console.log(`${entry}: chunks ${chunks.length} (parsed ${parsed}), JS ${(bytes / 1048576).toFixed(1)} MB, modules defined ${mods.size}, entry module ${entryId}`);
const prev = new Map([[entryId, null]]); const q = [entryId];
// The route template loads the user's module (and a page's layouts and page) through loaders it calls on the first request:
// the entry module's own lazy references are therefore seeds too ("evaluated by the first request").
for (const d of mods.get(entryId)?.lazy ?? []) if (!prev.has(d)) { prev.set(d, entryId); q.push(d); } let evalBytes = 0, n = 0; const missing = new Set(); const counted = new Set(); let allBytes = 0; for (const m of new Set(mods.values())) allBytes += m.size;
while (q.length) { const id = q.shift(); const m = mods.get(id); if (!m) { missing.add(id); continue; } n++; if (!counted.has(m)) { counted.add(m); evalBytes += m.size; } for (const d of m.eager) if (!prev.has(d)) { prev.set(d, id); q.push(d); } }
console.log(`modules evaluated by the first request (entry, its loaders, and their static imports): ${n} of ${mods.size} (${(evalBytes / 1048576).toFixed(1)} MB of ${(allBytes / 1048576).toFixed(1)} MB of module code); ids not found in these chunks: ${missing.size}`);
for (const t of targets) { if (!prev.has(t)) { console.log(`target ${t}: NOT reached by eager imports`); continue; } const chain = []; for (let c = t; c != null; c = prev.get(c)) chain.unshift(c); console.log(`target ${t}: reached at load, ${chain.length - 1} steps: ${chain.join(" > ")}`); }

// Which marker-bearing modules are evaluated: for each marker string, the module functions whose source text holds it, and whether the walk reached them.
{
  const markers = { "stripe SDK": "StripeSignatureVerificationError", "opentype.js": "Unsupported OpenType", "supabase auth": "AuthSessionMissingError", "drizzle schema": '"payout_reads"', "zod": "ZodError", "pg-core (PgDialect)": "PgDialect" };
  const srcCache = new Map();
  const idsByRec = new Map(); for (const [id, m] of mods) { if (!idsByRec.has(m)) idsByRec.set(m, []); idsByRec.get(m).push(id); }
  for (const [name, marker] of Object.entries(markers)) {
    let found = 0, evaluated = 0, bytes = 0;
    for (const [m, ids] of idsByRec) {
      if (!srcCache.has(m.chunk)) srcCache.set(m.chunk, fs.readFileSync(path.join(root, m.chunk), "utf8"));
      const text = srcCache.get(m.chunk).slice(m.start, m.end);
      if (!text.includes(marker)) continue; found++; bytes += m.size; if (ids.some((id) => prev.has(id))) evaluated++;
    }
    console.log(`  ${name.padEnd(22)} modules holding it: ${found}, evaluated by the first request: ${evaluated}, ${(bytes / 1024).toFixed(0)} KB`);
  }
}
