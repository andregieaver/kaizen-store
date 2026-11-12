// node docs/audits/bloat-review-2026-11/scripts/ai-round.mjs, from the repository root: bundles ai-round.ts (it imports from '@/lib/...')
// with esbuild and runs it; prints the size of each agent's round of tools. esbuild is the one drizzle-kit brings, found through it.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import url from "node:url";
import { createRequire } from "node:module";
const viaDrizzleKit = createRequire(createRequire(path.join(process.cwd(), "package.json")).resolve("drizzle-kit"));
const esbuildModule = await import(url.pathToFileURL(viaDrizzleKit.resolve("esbuild")).href);
const esbuild = esbuildModule.default ?? esbuildModule;
const stub = path.join(os.tmpdir(), "ai-round-server-only.mjs");
fs.writeFileSync(stub, "export {};\n");
// The bundle keeps its packages external, so it must sit where node resolves them: under node_modules/.cache, not os.tmpdir().
const outfile = path.join(process.cwd(), "node_modules/.cache/ai-round.bundle.mjs");
await esbuild.build({
  entryPoints: [path.join(process.cwd(), "docs/audits/bloat-review-2026-11/scripts/ai-round.ts")],
  bundle: true, platform: "node", format: "esm", outfile,
  alias: { "@": path.join(process.cwd(), "src"), "server-only": stub },
  packages: "external", logLevel: "warning",
});
await import(url.pathToFileURL(outfile).href);
