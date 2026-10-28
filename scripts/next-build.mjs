// `pnpm build` (docs/build-memory.md): `next build`, with a 7 GB heap for its type check everywhere but Vercel. Vercel's build machine
// has 8 GB and skips the type check (next.config.ts, `ON_VERCEL`), so a heap that size there only lets the compile hold more.
import { spawnSync } from "node:child_process";

const env = { ...process.env };
if (!env.VERCEL && !/max-old-space-size/.test(env.NODE_OPTIONS ?? "")) {
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --max-old-space-size=7168`.trim();
}
const run = spawnSync("next", ["build", ...process.argv.slice(2)], { stdio: "inherit", env, shell: process.platform === "win32" });
process.exit(run.status ?? 1);
