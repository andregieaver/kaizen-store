// Reads the timings a CI run's jobs uploaded (`timings-*` artifacts, one JSON line per check: scripts/timed.mjs), through GitHub's API.
// Plain Node (fetch, and the `unzip` command the runners have). Used by scripts/runner-minutes.mjs and scripts/ci-budgets-check.mjs.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API = "https://api.github.com";

export function headers(token = process.env.GH_TOKEN) {
  return { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

/** GET a path of the GitHub API as JSON; throws with the status when it does not answer 2xx. */
export async function github(path) {
  const response = await fetch(`${API}${path}`, { headers: headers(), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
  return response.json();
}

/** Every `timings-*` artifact of a run, unzipped and read: the entries { label, key, seconds, sha, at } of all its jobs. Throws when it cannot. */
export async function timingsOfRun(repository, runId) {
  const { artifacts } = await github(`/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`);
  const entries = [];
  for (const artifact of artifacts.filter((a) => a.name.startsWith("timings-") && !a.expired)) {
    const response = await fetch(artifact.archive_download_url, { headers: headers(), signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`artifact ${artifact.name}: ${response.status}`);
    const dir = mkdtempSync(join(tmpdir(), "timings-"));
    try {
      writeFileSync(join(dir, "a.zip"), Buffer.from(await response.arrayBuffer()));
      execFileSync("unzip", ["-o", "-q", join(dir, "a.zip"), "-d", dir], { stdio: "ignore" });
      for (const file of readdirSync(dir).filter((name) => name.endsWith(".jsonl"))) {
        for (const line of readFileSync(join(dir, file), "utf8").split("\n").filter(Boolean)) {
          try {
            entries.push(JSON.parse(line));
          } catch {
            // A torn line is skipped.
          }
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return entries;
}
