import "server-only";

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { docsApiReference } from "@/lib/docs-api-reference";
import { compileDocs, DOCS_ROOT, type DocReference, type DocsIndex, type DocSource } from "@/lib/docs-content";

import { log } from "./log";
import { BUDGETS } from "./request-budget";

/**
 * The docs' index (wave 14 unit E2, D442): every file under `content/docs/` read from disk and compiled by `compileDocs()`. Read when the
 * docs are built (each page is prerendered) and kept for the server's life; while developing it is read again on every call, so an edited
 * article shows on the next load. The files are read, not imported, so an article is never code; the build traces them into the docs'
 * routes (`outputFileTracingIncludes` in `next.config.ts`) for the addresses drawn at run time (a 404, the feedback route's check).
 *
 * A file with a problem is left out and logged; `src/lib/docs-content.test.ts` compiles every file in CI and fails on any problem, so
 * none reaches a deploy. Beside the articles, the generated reference (unit E4): made from unit A's contracts in code, not from files.
 */

let kept: DocsIndex | null = null;

/**
 * The folder the articles are in. A fixed path (the working directory and a literal), and every file below it is joined to it from a
 * relative part, so the build traces `content/docs/` alone: a path built from a variable folder would make Turbopack trace the whole
 * repository into the docs' routes.
 */
const DOCS_DIR = path.join(process.cwd(), "content/docs");

/** Every file under `content/docs/`, with its path from the repository's root. */
export function readDocSources(): DocSource[] {
  const out: DocSource[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(path.join(DOCS_DIR, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && /\.(md|json)$/.test(entry.name)) {
        out.push({ file: `${DOCS_ROOT}/${child}`, text: readFileSync(path.join(DOCS_DIR, child), "utf8") });
      }
    }
  };
  try {
    walk("");
  } catch (error) {
    log("error", "docs.read_failed", {}, error);
  }
  return out;
}

let reference: DocReference | null = null;

/**
 * The generated reference (wave 14 unit E4, D442), made from unit A's contracts with the MCP servers' budgets, which no contract publishes.
 * Made once a server's life: it changes only with the code, and a changed module is a new server while developing.
 */
export function docsReference(): DocReference {
  if (reference) return reference;
  const made = docsApiReference({ limits: { mcp: BUDGETS.mcp, agent: BUDGETS.agent } });
  if (made.problems.length > 0) log("warn", "docs.reference_problems", { count: made.problems.length, pages: new Set(made.problems.map((p) => p.path)).size });
  reference = made.reference;
  return reference;
}

/** The docs as compiled from the repository's files, with the generated reference beside the articles. */
export function docsIndex(): DocsIndex {
  if (kept && process.env.NODE_ENV === "production") return kept;
  const { index, problems } = compileDocs(readDocSources(), {}, docsReference());
  if (problems.length > 0) log("warn", "docs.problems", { count: problems.length, files: new Set(problems.map((p) => p.file)).size });
  kept = index;
  return index;
}
