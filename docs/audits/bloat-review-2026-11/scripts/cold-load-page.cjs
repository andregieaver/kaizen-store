// Times loading a built page function's server code in a fresh process (no request is made, nothing is written).
// node docs/audits/bloat-review-2026-11/scripts/cold-load-page.cjs ".next/server/app/s/[store]/[market]/page.js" (from the repository root)
const path = process.getBuiltinModule("node:path");
const load = process.getBuiltinModule("node:module").createRequire(path.join(process.cwd(), "package.json"));
globalThis.AsyncLocalStorage = process.getBuiltinModule("node:async_hooks").AsyncLocalStorage;
process.env.NODE_ENV = "production"; process.env.NEXT_RUNTIME = "nodejs";
try { load("next/dist/server/node-environment"); } catch {}
try { load("next/dist/server/require-hook"); } catch {}
const target = process.argv[2];
const t0 = process.hrtime.bigint(); const m0 = process.memoryUsage().rss;
let ok = true, err = "";
try { load(path.resolve(target)); } catch (e) { ok = false; err = String(e && e.message).slice(0, 240); }
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(JSON.stringify({ target, ok, ms: Math.round(ms), rssMB: Math.round((process.memoryUsage().rss - m0) / 1048576), err }));
process.exit(0);
