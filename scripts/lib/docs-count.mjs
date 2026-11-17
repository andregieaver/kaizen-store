// Counters for the written rules (bloat review step 1.1, src/lib/docs-budget.scan.test.ts). Plain Node, built-ins only: no
// function reads process.cwd(), the caller passes the root.
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Repo-relative paths, sorted, of every *.baseline.json under src. */
export function baselineFiles(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".next") walk(rel);
      } else if (entry.isFile() && entry.name.endsWith(".baseline.json")) found.push(rel);
    }
  };
  if (existsSync(path.join(root, "src")) && statSync(path.join(root, "src")).isDirectory()) walk("src");
  return found.sort();
}

/** The files whose path is not a substring of the rule text. */
export function unnamedBaselines(files, ruleText) {
  return files.filter((file) => !ruleText.includes(file));
}
