// node docs/audits/bloat-review-2026-11/scripts/manifest-time.cjs, from the repository root after a build:
// in a fresh process, the milliseconds require() or JSON.parse takes for the server reference manifest, and its bytes.
const fs = process.getBuiltinModule("node:fs");
const path = process.getBuiltinModule("node:path");
const load = process.getBuiltinModule("node:module").createRequire(path.join(process.cwd(), "package.json"));
const dir = path.join(process.cwd(), ".next/server");
const file = ["server-reference-manifest.js", "server-reference-manifest.json"].map((n) => path.join(dir, n)).find((f) => fs.existsSync(f));
if (!file) { console.log(JSON.stringify({ ok: false, err: "no server-reference-manifest in .next/server" })); process.exit(1); }
globalThis.self = globalThis; // the .js manifest assigns self.__RSC_SERVER_MANIFEST
const bytes = fs.statSync(file).size;
const t0 = process.hrtime.bigint();
if (file.endsWith(".json")) JSON.parse(fs.readFileSync(file, "utf8")); else load(file);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(JSON.stringify({ file: path.relative(process.cwd(), file), bytes, ms: +ms.toFixed(1) }));
