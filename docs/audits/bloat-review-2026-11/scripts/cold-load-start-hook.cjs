// Times what an instance does before its first request: instrumentation's register() (imports the interface-text module, then one read of ui_translations on a local review database).
// node docs/audits/bloat-review-2026-11/scripts/cold-load-start-hook.cjs (from the repository root, after a build; DATABASE_URL below names the local database it reads)
const path = process.getBuiltinModule("node:path");
const load = process.getBuiltinModule("node:module").createRequire(path.join(process.cwd(), "package.json"));
globalThis.AsyncLocalStorage = process.getBuiltinModule("node:async_hooks").AsyncLocalStorage;
process.env.NODE_ENV = "production"; process.env.NEXT_RUNTIME = "nodejs";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/bloat_review";
const t0 = process.hrtime.bigint(); const m0 = process.memoryUsage().rss;
const mod = load(path.resolve(".next/server/instrumentation.js"));
Promise.resolve(mod.register()).then(() => { const ms = Number(process.hrtime.bigint() - t0) / 1e6; console.log(JSON.stringify({ ok: true, ms: Math.round(ms), rssMB: Math.round((process.memoryUsage().rss - m0) / 1048576) })); process.exit(0); }, (e) => { console.log(JSON.stringify({ ok: false, err: String(e && e.message).slice(0, 300) })); process.exit(0); });
