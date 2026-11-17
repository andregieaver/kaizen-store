#!/usr/bin/env node
/**
 * Decides whether a newer push's run will deploy instead of this one (D710). The deploy hook builds the head of main when it is
 * called, not this run's commit (D530), so when several pushes land within minutes every run that reaches the hook builds the same
 * head: on 17 November 2026 three runs built `61dcec1` side by side. A run whose commit is no longer the head leaves the hook and the
 * wait to the newer run, whose deployment includes this commit and whose wait verifies it (`await-deploy.mjs` counts a later commit).
 *
 * Only a newer commit that CI runs for counts: one that changes only words (`*.md`, `docs/**`, but not the docs portal's
 * `content/**`; the paths of ci.yml's push trigger) starts no run, so nothing else would call the hook for it.
 *
 *   GITHUB_SHA      the commit this run checks
 *   HEAD_SHA        the head of main now (the caller fetches it)
 *   GITHUB_OUTPUT   when set, `newer=true` or `newer=false` is appended to this file
 *
 * Any doubt means deploy as before (`newer=false`): the head unknown, the files between not listable. Exits 0 always.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Whether a push of this path starts a CI run: ci.yml's push paths, `**`, then not `*.md` or `docs/**`, then `content/**` back in. */
export function startsRun(file) {
  if (file.startsWith("content/")) return true;
  return !(file.endsWith(".md") || file.startsWith("docs/"));
}

/** Whether a newer run deploys: `head` the head of main, `sha` this run's commit, `files` the paths changed between them (null when unknown). */
export function newerPush({ sha, head, files }) {
  if (!sha || !head) return { newer: false, why: "the head of main is unknown" };
  if (head === sha) return { newer: false, why: "this commit is the head of main" };
  if (files === null || files === undefined) return { newer: false, why: "the files changed since this commit could not be listed" };
  if (!files.some(startsRun)) return { newer: false, why: `the head ${head.slice(0, 8)} changed only words, which start no run` };
  return { newer: true, why: `the head ${head.slice(0, 8)} is newer and its own run deploys it, with this commit` };
}

/** The paths that differ between two commits; null when git cannot say. Both are in the checkout (this one, and the fetched head). */
function changedFiles(sha, head) {
  try {
    const out = execFileSync("git", ["diff", "--name-only", sha, head], { encoding: "utf8" });
    return out.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  } catch {
    return null;
  }
}

function main() {
  const sha = process.env.GITHUB_SHA;
  const head = process.env.HEAD_SHA;
  const files = sha && head && sha !== head ? changedFiles(sha, head) : null;
  const { newer, why } = newerPush({ sha, head, files });
  console.log(`A newer push deploys: ${newer ? "yes, so this run calls no hook" : "no"} (${why})`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `newer=${newer}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
