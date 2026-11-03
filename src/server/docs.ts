import "server-only";

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { compileDocs, DOCS_ROOT, type DocsIndex, type DocSource } from "@/lib/docs-content";

import { log } from "./log";

/**
 * The docs' index (wave 14 unit E2, D442): every file under `content/docs/` read from disk and compiled by `compileDocs()`. Read when the
 * docs are built (each page is prerendered) and kept for the server's life; while developing it is read again on every call, so an edited
 * article shows on the next load. The files are read, not imported, so an article is never code; the build traces them into the docs'
 * routes (`outputFileTracingIncludes` in `next.config.ts`) for the addresses drawn at run time (a 404, the feedback route's check).
 *
 * A file with a problem is left out and logged; `src/lib/docs-content.test.ts` compiles every file in CI and fails on any problem, so
 * none reaches a deploy.
 */

let kept: DocsIndex | null = null;

/** Every file under `content/docs/`, with its path from the repository's root. */
export function readDocSources(root = process.cwd()): DocSource[] {
  const base = path.join(root, DOCS_ROOT);
  const out: DocSource[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.(md|json)$/.test(entry.name)) {
        out.push({ file: path.relative(root, full).split(path.sep).join("/"), text: readFileSync(full, "utf8") });
      }
    }
  };
  try {
    walk(base);
  } catch (error) {
    log("error", "docs.read_failed", {}, error);
  }
  return out;
}

/** The docs as compiled from the repository's files. */
export function docsIndex(): DocsIndex {
  if (kept && process.env.NODE_ENV === "production") return kept;
  const { index, problems } = compileDocs(readDocSources());
  if (problems.length > 0) log("warn", "docs.problems", { count: problems.length, files: new Set(problems.map((p) => p.file)).size });
  kept = index;
  return index;
}
