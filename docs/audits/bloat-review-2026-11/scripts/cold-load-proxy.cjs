// Times loading the built proxy function's code in a fresh process (no request is made, nothing is written).
// node docs/audits/bloat-review-2026-11/scripts/cold-load-proxy.cjs (from the repository root, after a build)
const path = process.getBuiltinModule("node:path");
const load = process.getBuiltinModule("node:module").createRequire(path.join(process.cwd(), "package.json"));
process.env.NODE_ENV = "production";
process.env.NEXT_RUNTIME = "nodejs";
const t0 = process.hrtime.bigint();
const m0 = process.memoryUsage().rss;
let ok = true, err = "";
try { load(path.resolve(".next/server/middleware.js")); } catch (e) { ok = false; err = String(e && e.message).slice(0, 300); }
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(JSON.stringify({ ok, ms: Math.round(ms), rssMB: Math.round((process.memoryUsage().rss - m0) / 1048576), modules: Object.keys(load.cache).length, err }));
process.exit(0);
