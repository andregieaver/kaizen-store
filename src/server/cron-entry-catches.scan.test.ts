import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * No scheduled job fails in silence (bloat review step 1.26): the entry function of every dispatcher job (`DISPATCHER_JOBS` in
 * `dispatcher-jobs.ts`, and the dispatcher route's own `tracked("dispatcher.…")` calls) reports what it catches (`report(error, part)`,
 * handed in by `runJobs()`/`tracked()`), or rethrows it, so the run is counted as failed after its other parts ran. A catch that only logs
 * is silent too: the ledger would say ok. And a cron route's work after its answer (`after()`) runs inside `trackedWork()` or `tracked()`.
 */

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** The index of the bracket that closes the one at `open`. */
function closing(text: string, open: number, pair: "{}" | "()" = "{}"): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === pair[0]) depth++;
    else if (text[i] === pair[1] && --depth === 0) return i;
  }
  return text.length - 1;
}

/** The names a file imports from a module, with the module's file. */
function importsOf(file: string): Map<string, string> {
  const text = read(file);
  const found = new Map<string, string>();
  for (const m of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)) {
    const from = m[2];
    let base: string | null = null;
    if (from.startsWith("@/")) base = join("src", from.slice(2));
    else if (from.startsWith("./") || from.startsWith("../")) base = join(dirname(file), from);
    if (!base) continue;
    const path = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((p) => existsSync(join(ROOT, p)));
    if (!path) continue;
    for (const part of m[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "");
      if (!name) continue;
      const [orig, alias] = name.split(/\s+as\s+/);
      found.set((alias ?? orig).trim(), path);
    }
  }
  return found;
}

/** The body of `export (async) function name` or `export const name = (async) (…) =>` in a file, with its first line's number. */
function bodyOf(file: string, name: string): { body: string; line: number } | null {
  const text = read(file);
  const start = text.search(new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b|export\\s+const\\s+${name}\\s*=`));
  if (start < 0) {
    // One hop through a re-export: `export { name } from "./x"`.
    const again = text.match(new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*"([^"]+)"`));
    if (!again) return null;
    const base = again[1].startsWith("@/") ? join("src", again[1].slice(2)) : join(dirname(file), again[1]);
    const path = [`${base}.ts`, `${base}.tsx`].find((p) => existsSync(join(ROOT, p)));
    return path ? bodyOf(path, name) : null;
  }
  // The parameters, then the first `{` outside a type: the body.
  const params = text.indexOf("(", start);
  let i = closing(text, params, "()") + 1;
  let angle = 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === "<") angle++;
    else if (c === ">" && text[i - 1] !== "=") angle--;
    else if (c === "{" && angle === 0) {
      // A type literal after `:` (a return type) is skipped.
      const before = text.slice(0, i).trimEnd();
      if (before.endsWith(":") || before.endsWith("|") || before.endsWith("&")) {
        i = closing(text, i);
        continue;
      }
      break;
    }
  }
  const end = closing(text, i);
  return { body: text.slice(i, end + 1), line: text.slice(0, i).split("\n").length };
}

type Job = { job: string; fn: string; from: string; module?: string };

function dispatcherJobs(): Job[] {
  const jobs: Job[] = [];
  const file = "src/server/dispatcher-jobs.ts";
  const text = read(file);
  const open = text.indexOf("{", text.indexOf("export const DISPATCHER_JOBS = {"));
  const object = text.slice(open, closing(text, open));
  for (const m of object.matchAll(/^ {2}(\w+):\s*(?:async\s*)?\(\w*\)\s*=>\s*(?:\(\s*)?(?:await\s+)?(\w+)\(/gm)) {
    // A job loaded when it runs (`(await import("@/server/x")).fn()`) is read from that module itself.
    if (m[2] !== "import") jobs.push({ job: m[1], fn: m[2], from: file });
  }
  for (const m of object.matchAll(/^ {2}(\w+):\s*async\s*\(\w*\)\s*=>\s*\(await import\("@\/([\w/-]+)"\)\)\.(\w+)\(/gm)) {
    jobs.push({ job: m[1], fn: m[3], from: file, module: `src/${m[2]}.ts` });
  }
  const route = "src/app/api/cron/cart-reminders/route.ts";
  for (const m of read(route).matchAll(/tracked\("dispatcher\.([\w-]+)",\s*EVERY,\s*(?:async\s*)?\(\w*\)\s*=>\s*(?:\(\s*)?(?:await\s+)?(\w+)\(/g)) {
    jobs.push({ job: m[1], fn: m[2], from: route });
  }
  return jobs;
}

/** Jobs whose entry function the scan cannot read, each with why. */
const NOT_FOUND_OK: Record<string, string> = {};

/**
 * Catches that handle a normal state, not a fault (the owner's choice, 20 November 2026): reporting them would count the job failed on
 * every run while the outside world is as it is. Keyed by the job and a piece of the catch's text; each with its reason. A business outcome
 * inside a catch that also meets faults (a declined card, Stripe's or a registrar's refusal, an account Instagram refuses) is not listed:
 * the catch reports only the other errors (`if (!(error instanceof BillingProblem)) report(…)`).
 */
const NORMAL_STATES: Record<string, string> = {
  "status status.probe_failed": "A part of the platform found down is what the status check measures: it is recorded as a failed check, and admins are told by the status page's own alert.",
  "widgetSites support.widget_site_list_failed": "An owner's website that cannot be listed (down, refusing robots, a bad sitemap) is the owner's site's state; it is tried again on its next turn.",
  "widgetSites support.widget_page_read_failed": "A page of an owner's website that cannot be read (gone, refused) is that site's state; it is read again later.",
  "domainWatch .catch(() => null)": "A domain that does not answer its probe or its registry (RDAP) is what the watch records as its health; null is that answer.",
};

describe("scheduled jobs' entry functions", () => {
  it("report or rethrow every error they catch", () => {
    const jobs = dispatcherJobs();
    expect(jobs.length, "the dispatcher's jobs were read").toBeGreaterThanOrEqual(74);
    const silent: string[] = [];
    const missing: string[] = [];
    const used = new Set<string>();
    for (const { job, fn, from, module } of jobs) {
      const file = module ?? importsOf(from).get(fn);
      const found = file ? bodyOf(file, fn) : null;
      if (!file || !found) {
        if (!(job in NOT_FOUND_OK)) missing.push(`${job} (${fn})`);
        continue;
      }
      const { body, line } = found;
      const catches: { at: number; text: string }[] = [];
      for (const m of body.matchAll(/catch\s*(\([^)]*\))?\s*\{/g)) {
        const open = m.index + m[0].length - 1;
        catches.push({ at: m.index, text: body.slice(m.index, closing(body, open) + 1) });
      }
      for (const m of body.matchAll(/\.catch\(/g)) {
        const open = m.index + m[0].length - 1;
        catches.push({ at: m.index, text: body.slice(m.index, closing(body, open, "()") + 1) });
      }
      for (const c of catches) {
        if (/report\(|throw\s|throw;/.test(c.text)) continue;
        const named = Object.keys(NORMAL_STATES).find((key) => key.startsWith(`${job} `) && c.text.includes(key.slice(job.length + 1)));
        if (named) {
          used.add(named);
          continue;
        }
        const at = line + body.slice(0, c.at).split("\n").length - 1;
        silent.push(`${job} ${file}:${at} ${c.text.replace(/\s+/g, " ").slice(0, 60)}`);
      }
    }
    expect(missing, "an entry function the scan cannot find: list it in NOT_FOUND_OK with a reason").toEqual([]);
    expect(Object.keys(NORMAL_STATES).filter((key) => !used.has(key)), "a normal state named that no catch has any more: take it off NORMAL_STATES").toEqual([]);
    expect(silent, 'report the error: catch (error) { report(error, "<part>"); … } — see src/server/cron-runs.ts').toEqual([]);
  });

  it("the seven routes that work after answering keep that work as a job of its own (trackedWork)", () => {
    for (const name of ["autopilot", "page-jobs", "broadcasts", "pack-pictures", "page-looks", "theme-shots", "cookie-scan"]) {
      expect(read(`src/app/api/cron/${name}/route.ts`), name).toContain(`trackedWork("route.${name}"`);
    }
    // No route works after its answer outside a job of its own (the Dream Factory's is `tracked("dream-factory.advance", …)`).
    const routes = readdirSync(join(ROOT, "src/app/api/cron"), { withFileTypes: true }).filter((d) => d.isDirectory());
    const loose: string[] = [];
    for (const dir of routes) {
      const path = `src/app/api/cron/${dir.name}/route.ts`;
      if (!existsSync(join(ROOT, path))) continue;
      const text = read(path);
      for (const m of text.matchAll(/\bafter\(/g)) {
        const call = text.slice(m.index, closing(text, m.index + m[0].length - 1, "()") + 1);
        if (!/trackedWork\(|tracked\(/.test(call)) loose.push(`${path}: ${call.replace(/\s+/g, " ").slice(0, 60)}`);
      }
    }
    expect(loose, "work after a route's answer runs inside trackedWork(\"route.<name>\", …)").toEqual([]);
  });
});
