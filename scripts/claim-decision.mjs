// Claims a decision's number on main before it is cited (bloat review step 0.41):
//
//   node scripts/claim-decision.mjs "short title"
//
// It pushes ONE new commit on top of origin/main that adds the decision's own file (docs/decisions/D<n>.md) and its row in the
// index of docs/decisions.md, built with git plumbing in a temporary index: the working tree, the index and the session's branch are never touched, nothing is forced. A push that touches only docs
// runs no CI and no deploy (ci.yml's paths, vercel.json's deploymentEnabled); the script checks both facts first. When main moved
// since it read, the push is refused and it reads again and takes the next number. On success it prints one line, 'D<number>', on
// standard output; every note goes to standard error.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { claimIsFree, claimWith } from "./lib/claim-decision.mjs";

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024, ...options });
}

function fail(line) {
  process.stderr.write(`${line}\n`);
  process.exit(1);
}

function makeIo() {
  let base = "";
  return {
    read: async () => {
      git(["fetch", "origin", "main"]);
      base = git(["rev-parse", "origin/main"]).trim();
      return git(["show", `${base}:docs/decisions.md`]);
    },
    push: async (files, message) => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "claim-"));
      const env = { ...process.env, GIT_INDEX_FILE: path.join(dir, "index") };
      try {
        git(["read-tree", base], { env });
        for (const [file, text] of Object.entries(files)) {
          const blob = git(["hash-object", "-w", "--stdin"], { input: text }).trim();
          git(["update-index", "--add", "--cacheinfo", `100644,${blob},${file}`], { env });
        }
        const tree = git(["write-tree"], { env }).trim();
        const commit = git(["commit-tree", tree, "-p", base, "-m", message]).trim();
        try {
          git(["push", "origin", `${commit}:refs/heads/main`]);
          return true;
        } catch (error) {
          git(["fetch", "origin", "main"]);
          if (git(["rev-parse", "origin/main"]).trim() !== base) return false;
          throw error;
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

async function main() {
  const title = process.argv.slice(2).join(" ").trim();
  if (!title) fail('Give the decision a short title: node scripts/claim-decision.mjs "title"');
  git(["fetch", "origin", "main"]);
  const ci = git(["show", "origin/main:.github/workflows/ci.yml"]);
  const vercel = git(["show", "origin/main:vercel.json"]);
  if (!claimIsFree(ci, vercel)) fail("A docs push would run CI or deploy: claim by hand and tell the owner.");
  const id = await claimWith(makeIo(), title, new Date().toISOString().slice(0, 10));
  process.stdout.write(`D${id}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    const why = String(error?.stderr ?? "").trim().split("\n").pop();
    fail(`${String(error?.message ?? error).split("\n")[0]}${why ? `: ${why}` : ""}`);
  });
}
