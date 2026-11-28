#!/usr/bin/env node
/**
 * Runs the Kaizena Life site importer (`import.ts`, D916, `docs/life-site-move.md`) with the tsx that vitest brings along, so the importer
 * builds pages with the page builder's own model, translations and checks. Run from the repository's root:
 *
 *   node scripts/life-site/run.mjs --life ../lifesaver-app --base http://127.0.0.1:3000 --host kaizena-life.localhost:3000 --token-file PATH
 *   node scripts/life-site/run.mjs --life ../lifesaver-app --base https://kaizena-life.kaizenstore.site
 *
 * `--dry DIR` writes each page's JSON there and saves nothing; `--only front,features` builds those pages alone (`site` the menus, header,
 * footer and look; `blog` the blog's articles, read from kaizenalife.com, or `blog:slug` one of them); `--copy-pictures` copies
 * Life's pictures into the store's media library (on the real store; a local copy has no storage) and points the pages at the copies;
 * `--make-live` publishes the header and footer and makes the look live (a token with `content:publish`). The store's main language must be
 * English, with Norwegian and Swedish offered.
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const store = join("node_modules", ".pnpm");
const tsx = readdirSync(store).find((name) => name.startsWith("tsx@"));
if (!tsx) {
  console.error("tsx is not in node_modules/.pnpm: run pnpm install first.");
  process.exit(1);
}
const cli = join(store, tsx, "node_modules", "tsx", "dist", "cli.mjs");
const result = spawnSync(process.execPath, [cli, "--tsconfig", "tsconfig.json", "scripts/life-site/import.ts", ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(result.status ?? 1);
