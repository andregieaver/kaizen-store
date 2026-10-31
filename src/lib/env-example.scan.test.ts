import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `.env.example` names every variable the code reads (PSI CODE-05: the README says so): a `process.env.NAME` in `src` that is neither
 * there nor set by the platform or a test runner fails here, so a new feature's key cannot be left for the next person to find.
 */
const SET_ELSEWHERE: Record<string, string> = {
  NODE_ENV: "Node and Next",
  NEXT_PHASE: "Next",
  NEXT_RUNTIME: "Next",
  NEXT_PUBLIC_STORE_HOSTS: "next.config.ts writes it at build time from the hosts in the database",
  VERCEL: "Vercel",
  VERCEL_GIT_COMMIT_SHA: "Vercel",
  VERCEL_PROJECT_PRODUCTION_URL: "Vercel",
  VERCEL_REGION: "Vercel",
  VITEST: "Vitest",
  PLAYWRIGHT_CHROMIUM_PATH: "the end-to-end tests' browser, CLAUDE.md",
  UPDATE_ADMIN_STRINGS: "a test's switch to rewrite its snapshot",
  WRITE_GLOSSARY: "a test's switch to rewrite its snapshot",
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe(".env.example names every variable the code reads", () => {
  it("has a line for each process.env name in src, or the name is set by the platform or a test runner", () => {
    const root = process.cwd();
    const example = new Set([...readFileSync(path.join(root, ".env.example"), "utf8").matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
    const read = new Set(sources(path.join(root, "src")).flatMap((file) => [...readFileSync(file, "utf8").matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1])));
    expect([...read].filter((name) => !example.has(name) && !(name in SET_ELSEWHERE)).sort()).toEqual([]);
  });
});
